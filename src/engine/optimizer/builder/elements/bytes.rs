//! Numbers at any offset of a view: the methods of `DataView`, and those that the embedder has for its buffers.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{Access, AccessFlags, Type, Unary, Value as Ssa};
use bun_engine_vm::{BufferAccessor, ElementType, Intrinsic, SpeculatedType as T};

use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::builder::fork::Odds;
use crate::graph::{ExitKind, IntegerRange, Kind, heaps};

const TYPES_OF_DATA_VIEW: [ElementType; 11] = [
    ElementType::Int8,
    ElementType::Uint8,
    ElementType::Int16,
    ElementType::Uint16,
    ElementType::Int32,
    ElementType::Uint32,
    ElementType::Float16,
    ElementType::Float32,
    ElementType::Float64,
    ElementType::BigInt64,
    ElementType::BigUint64,
];

fn size_of_bytes(bytes: u32) -> Size {
    match bytes {
        1 => Size::S8,
        2 => Size::S16,
        4 => Size::S32,
        _ => Size::S64,
    }
}

struct Bytes {
    address: Ssa,
    flags: AccessFlags,
    /// An I32 or an I64.
    offset: Ssa,
}

impl Builder<'_> {
    fn may_be_offset(&self, offset: Ssa) -> bool {
        self.is(offset, T::UNDEFINED) || self.may_be_index(offset)
    }

    /// Of a view whose elements are bytes. Exits unless it has that many at the offset.
    fn bytes_at(&mut self, view: Ssa, offset: Ssa, count: u32) -> Bytes {
        let is_wide = self.has_exited(ExitKind::Overflow)
            || self.has_exited(ExitKind::OutOfBounds)
            || self.is_large_constant(view);
        let offset = match (self.is(offset, T::UNDEFINED), is_wide) {
            (true, true) => self.word(0),
            (true, false) => self.int32(0),
            (false, true) => self.wide_index(offset, Default::default()),
            (false, false) => self.narrow_index(offset),
        };
        let end_of_starts = |this: &mut Self, length: Ssa| {
            if count == 1 {
                return length;
            }
            let mut ir = this.ir();
            let (ty, end) = (ir.type_of(length), ir.sub(length, count - 1));
            let (none, is_short) = (ir.zero(ty), ir.less_than(end, 0));
            ir.select(is_short, none, end)
        };
        let (index, flags) = if is_wide {
            let length = self.known_length(view);
            let end = end_of_starts(self, length);
            let is_past = self.ir().above_or_equal(offset, end);
            self.choose(is_past, Odds::Low, |this, is_past| {
                if is_past {
                    let length = this.node(Kind::UpdateViewLength, &[view], 0);
                    let end = end_of_starts(this, length);
                    let is_past = this.ir().above_or_equal(offset, end);
                    this.exit_if(is_past, ExitKind::ExoticObject);
                }
                None
            });
            (offset, AccessFlags::empty())
        } else {
            let length = self.narrow_length(view, 0);
            let end = end_of_starts(self, length);
            let index = self.check_bounds(offset, end);
            (self.ir().zero_extend(index), AccessFlags::ALWAYS_READABLE)
        };
        let vector = self.vector(view);
        Bytes {
            address: self.ir().add(vector, index),
            flags,
            offset,
        }
    }

    /// Reverses the low bytes unless the I32 says that the order is little endian.
    fn in_order(&mut self, bits: Ssa, bytes: u32, is_little_endian: Ssa) -> Ssa {
        if bytes == 1 || (self.graph.function).is_int_constant(is_little_endian, 1) {
            return bits;
        }
        let mut ir = self.ir();
        let swapped = ir.unary(Unary::SwapBytes(size_of_bytes(bytes)), bits);
        ir.select(is_little_endian, bits, swapped)
    }

    /// As `load_number`.
    fn load_in_order(&mut self, of: ElementType, at: &Bytes, is_little_endian: Ssa) -> Ssa {
        let bytes = of.size() as u32;
        if bytes == 1 || (self.graph.function).is_int_constant(is_little_endian, 1) {
            return self.load_number(of, (at.address, at.flags));
        }
        let unsigned = match bytes {
            2 => ElementType::Uint16,
            4 => ElementType::Uint32,
            _ => ElementType::BigUint64,
        };
        let bits = self.load_number(unsigned, (at.address, at.flags));
        let bits = self.in_order(bits, bytes, is_little_endian);
        match of {
            ElementType::Int16 => self.ir().unary(Unary::SignExtend(Size::S16), bits),
            ElementType::Float16 => self.node(Kind::HalfToDouble, &[bits], 0),
            ElementType::Float32 => {
                let float = self.ir().bitcast(bits);
                self.ir().convert(Unary::Promote, Type::F64, float)
            }
            ElementType::Float64 => self.ir().bitcast(bits),
            _ => bits,
        }
    }

    /// As `store_number`.
    fn store_in_order(&mut self, of: ElementType, at: &Bytes, mut element: Ssa, order: Ssa) {
        let function = &self.graph.function;
        if function.type_of(element).is_float() && !function.is_int_constant(order, 1) {
            element = self.ir().bitcast(element);
        }
        let element = self.in_order(element, of.size() as u32, order);
        self.store_number(of, at.address, element);
    }

    pub(in crate::builder) fn data_view_intrinsic(
        &mut self,
        which: Intrinsic,
        site: &CallSite<'_>,
    ) -> Option<Ssa> {
        let position = (which as usize).checked_sub(Intrinsic::DataViewGetInt8 as usize)?;
        let count = TYPES_OF_DATA_VIEW.len();
        let (of, writes) = (TYPES_OF_DATA_VIEW[position % count], position >= count);
        let undefined = self.undefined();
        let argument = |index| site.arguments.get(index).copied().unwrap_or(undefined);
        let (this, offset, value) = (argument(0), argument(1), argument(2));
        if position >= 2 * count
            || !T::DATA_VIEW.contains(self.expected(this))
            || !self.may_be_offset(offset)
            || writes && !self.may_become_element(of, value)
        {
            return None;
        }
        let view = self.check_type_or(this, T::DATA_VIEW, ExitKind::ExoticObject);
        let element = writes.then(|| self.to_element(of, value));
        let order = match of.size() {
            1 => self.int32(1),
            _ => self.to_boolean(argument(2 + usize::from(writes))),
        };
        let at = self.bytes_at(view, offset, of.size() as u32);
        if let Some(element) = element {
            self.store_in_order(of, &at, element, order);
            return Some(undefined);
        }
        let number = self.load_in_order(of, &at, order);
        Some(self.box_number(of, number, self.prediction_at(site.metadata)))
    }

    pub(in crate::builder) fn access_buffer(
        &mut self,
        accessor: BufferAccessor,
        site: &CallSite<'_>,
    ) -> Option<Ssa> {
        let undefined = self.undefined();
        let argument = |index| site.arguments.get(index).copied().unwrap_or(undefined);
        let position = 1 + usize::from(accessor.is_write);
        let (this, value, offset) = (argument(0), argument(1), argument(position));
        let bytes = match accessor.byte_size {
            0 if self.is(offset, T::UNDEFINED) => return None,
            0 => (self.constant_value(argument(position + 1))?.as_int32())
                .filter(|it| (1..=6).contains(it))? as u32,
            bytes => bytes.into(),
        };
        let of = TYPES_OF_DATA_VIEW.into_iter().find(|it| {
            it.size() == bytes as usize
                && it.is_float() == accessor.is_float
                && (it.is_float() || it.is_signed() == accessor.is_signed)
        });
        let needed = match of {
            Some(of) if of.is_bigint() => T::BIGINT,
            _ => T::BOXED_NUMBER,
        };
        if !T::UINT8_ARRAY.contains(self.expected(this))
            || !self.may_be_offset(offset)
            || accessor.is_write && !needed.contains(self.expected(value))
        {
            return None;
        }
        let view = self.check_type_or(this, T::UINT8_ARRAY, ExitKind::ExoticObject);
        let order = self.int32(accessor.is_little_endian.into());
        let range = IntegerRange {
            bytes,
            is_signed: accessor.is_signed,
        };
        if !accessor.is_write {
            let at = self.bytes_at(view, offset, bytes);
            let Some(of) = of else {
                return Some(self.load_in_two(&at, range, accessor.is_little_endian));
            };
            let number = self.load_in_order(of, &at, order);
            return Some(self.box_number(of, number, self.prediction_at(site.metadata)));
        }
        let element = match of {
            Some(of) if of.is_float() => self.to_element(of, value),
            Some(of) if of.is_bigint() => {
                let bigint = self.check_type_or(value, T::BIGINT, ExitKind::ExoticObject);
                self.node(Kind::BigIntInRange, &[bigint], range.to_data())
            }
            _ => self.integer_in_range(value, range),
        };
        let at = self.bytes_at(view, offset, bytes);
        match of {
            Some(of) => self.store_in_order(of, &at, element, order),
            None => self.store_in_two(&at, element, bytes, accessor.is_little_endian),
        }
        let end = self.ir().add(at.offset, bytes);
        Some(match self.graph.function.type_of(end) {
            Type::I32 => self.box_int32(end),
            _ => self.profiled_node(Kind::BoxInt52, &[end], 0, T::INT32 | T::INT52),
        })
    }

    /// An I64 if there are 3, 5 or 6 bytes, or else an I32.
    fn integer_in_range(&mut self, value: Ssa, range: IntegerRange) -> Ssa {
        let root = self.graph.root(value);
        if range.bytes.is_power_of_two() {
            let unsigned = self.graph.inside(root, Kind::UInt32ToNumber);
            return (unsigned.filter(|_| range.bytes == 4 && !range.is_signed))
                .unwrap_or_else(|| self.node(Kind::TruncateInRange, &[root], range.to_data()));
        }
        let integer = self.node(Kind::AsInt52, &[root], crate::graph::AS_INDEX);
        let mut ir = self.ir();
        let distance = ir.sub(integer, range.least());
        let is_outside = ir.above(distance, range.greatest() - range.least());
        self.exit_if(is_outside, ExitKind::ExoticObject);
        integer
    }

    /// The offsets and sizes of the low and of the high part.
    fn two_parts(bytes: u32, is_little_endian: bool) -> [(i32, u32); 2] {
        let low = 1 << bytes.ilog2();
        if is_little_endian {
            [(0, low), (low as i32, bytes - low)]
        } else {
            [((bytes - low) as i32, low), (0, bytes - low)]
        }
    }

    fn load_in_two(&mut self, at: &Bytes, range: IntegerRange, is_little_endian: bool) -> Ssa {
        let (order, access) = (
            self.int32(is_little_endian.into()),
            Access::new(heaps::TYPED_ELEMENTS, at.flags),
        );
        let parts = Self::two_parts(range.bytes, is_little_endian);
        let [low, high] = parts.map(|(offset, bytes)| {
            let (mut ir, size) = (self.ir(), size_of_bytes(bytes));
            let bits = match size {
                Size::S32 => ir.load(Type::I32, at.address, offset, access),
                _ => ir.load_narrow(size, Sign::Unsigned, at.address, offset, access),
            };
            let bits = self.in_order(bits, bytes, order);
            self.ir().zero_extend(bits)
        });
        let mut ir = self.ir();
        let high = ir.shl(high, parts[0].1 * 8);
        let mut number = ir.or(high, low);
        if range.is_signed {
            let unused = u64::BITS - range.bytes * 8;
            number = ir.shl(number, unused);
            number = ir.sar(number, unused);
        }
        if range.bytes < 4 {
            let number = ir.wrap(number);
            return self.box_int32(number);
        }
        self.profiled_node(Kind::BoxInt52, &[number], 0, T::INT32 | T::INT52)
    }

    fn store_in_two(&mut self, at: &Bytes, integer: Ssa, bytes: u32, is_little_endian: bool) {
        let (order, parts) = (
            self.int32(is_little_endian.into()),
            Self::two_parts(bytes, is_little_endian),
        );
        let high = self.ir().shr(integer, parts[0].1 * 8);
        for ((offset, bytes), part) in parts.into_iter().zip([integer, high]) {
            let part = self.ir().wrap(part);
            let (part, size) = (self.in_order(part, bytes, order), size_of_bytes(bytes));
            (self.ir()).store_sized(size, part, at.address, offset, heaps::TYPED_ELEMENTS);
        }
        (self.knowledge).note_write(&self.graph, heaps::TYPED_ELEMENTS);
        self.note_effect();
    }
}

const _: () = {
    let first = Intrinsic::DataViewGetInt8 as usize;
    assert!(Intrinsic::DataViewGetFloat16 as usize == first + 6);
    assert!(Intrinsic::DataViewSetInt8 as usize == first + TYPES_OF_DATA_VIEW.len());
    assert!(Intrinsic::DataViewSetBigUint64 as usize + 1 == first + 2 * TYPES_OF_DATA_VIEW.len());
};
