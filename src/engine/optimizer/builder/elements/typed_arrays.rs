//! Views on buffers.

use bun_engine_asm::{Sign, Size};
use bun_engine_codegen::ir::{Access, AccessFlags, Op, Type, Unary, Value as Ssa};
use bun_engine_vm::ic::AccessKind;
use bun_engine_vm::{
    ArrayModes, ElementType, Gc, JsArrayBufferView as View, JsBigInt, MAX_ARRAY_BUFFER_SIZE, Shape,
    SpeculatedType as T, ViewMode,
};

use crate::builder::Builder;
use crate::builder::fork::Odds;
use crate::graph::{AS_INDEX, ExitKind, Kind, ShapeSet, heaps};
use crate::runtime::cells::buffer_of_view;

const CONVERTS_QUIETLY: T = T::BOXED_NUMBER.union(T::BOOLEAN).union(T::NULLISH);
/// Not a field: where the length is remembered once it is known to be an int32.
const NARROW_LENGTH: i32 = View::OFFSET_OF_LENGTH as i32 + 1;

/// An access to a typed array that has been checked to be of that type.
#[derive(Clone, Copy)]
pub(super) struct TypedAccess {
    view: Ssa,
    of: ElementType,
    key: Ssa,
    modes: ArrayModes,
}

impl TypedAccess {
    pub(super) fn new(view: Ssa, of: ElementType, key: Ssa, modes: ArrayModes) -> Self {
        Self {
            view,
            of,
            key,
            modes,
        }
    }
}

/// An address, and how to load from there.
pub(super) type Place = (Ssa, AccessFlags);

impl Builder<'_> {
    /// A constant whose elements stay where they are, and as many.
    fn settled_view(&mut self, view: Ssa) -> Option<Gc<View>> {
        let view = self.constant_cell::<View>(view)?;
        if view.is_resizable_or_growable() || view.is_detached() {
            return None;
        }
        let buffer = buffer_of_view(self.vm, &view)?;
        self.watch(buffer.detach_watchpoints()).then_some(view)
    }

    pub(in crate::builder) fn vector(&mut self, view: Ssa) -> Ssa {
        match self.settled_view(view) {
            Some(settled) => self.word(settled.vector().addr()),
            None => {
                let offset = View::OFFSET_OF_VECTOR as i32;
                self.load(Type::I64, view, offset, heaps::VIEW_VECTOR)
            }
        }
    }

    /// An I64. If the length of the buffer can change, there may be more elements.
    pub(in crate::builder) fn known_length(&mut self, view: Ssa) -> Ssa {
        match self.settled_view(view) {
            Some(settled) => self.word(settled.known_length()),
            None => {
                let offset = View::OFFSET_OF_LENGTH as i32;
                self.load(Type::I64, view, offset, heaps::VIEW_LENGTH)
            }
        }
    }

    fn size_as_int32(&mut self, size: Ssa) -> Ssa {
        match self.graph.function.int_constant(size).map(i32::try_from) {
            Some(Ok(size)) => self.int32(size),
            _ => {
                let size = self.node(Kind::SizeAsInt32, &[size], 0);
                self.at_most(size, i32::MAX as u32)
            }
        }
    }

    /// The same as an I32 that is not negative. The elements are no smaller than the shift says.
    pub(super) fn narrow_length(&mut self, view: Ssa, size_shift: u32) -> Ssa {
        let (root, heap) = (self.graph.root(view), heaps::VIEW_LENGTH);
        if let Some(known) = self.knowledge.field(root, NARROW_LENGTH, heap) {
            return known;
        }
        let (length, greatest) = (self.known_length(view), MAX_ARRAY_BUFFER_SIZE >> size_shift);
        let length = if greatest <= i32::MAX as usize {
            let length = self.ir().wrap(length);
            self.at_most(length, greatest as u32)
        } else {
            self.size_as_int32(length)
        };
        (self.knowledge).learn_field(root, NARROW_LENGTH, heap, length);
        length
    }

    pub(super) fn is_large_constant(&self, view: Ssa) -> bool {
        (self.constant_cell::<View>(view)).is_some_and(|it| it.length() > i32::MAX as usize)
    }

    /// An I32, to be compared without a sign.
    pub(super) fn narrow_index(&mut self, key: Ssa) -> Ssa {
        let unsigned = (self.graph).inside(self.graph.root(key), Kind::UInt32ToNumber);
        unsigned.unwrap_or_else(|| self.as_index(key))
    }

    /// An I64 that is above any length if the key is negative.
    pub(super) fn wide_index(&mut self, key: Ssa, modes: ArrayModes) -> Ssa {
        let root = self.graph.root(key);
        if let Some(bits) = self.graph.inside(root, Kind::UInt32ToNumber) {
            self.ir().zero_extend(bits)
        } else if modes.contains(ArrayModes::UNUSUAL_INDEX) {
            self.node(Kind::AsInt52, &[root], AS_INDEX)
        } else {
            let index = self.as_index(key);
            self.ir().sign_extend(index)
        }
    }

    /// Both are I32, or both I64. If the length of the buffer can change, there may be more elements.
    fn index_and_length(&mut self, access: TypedAccess) -> (Ssa, Ssa) {
        let TypedAccess { view, key, .. } = access;
        let is_wide = (access.modes)
            .intersects(ArrayModes::UNUSUAL_INDEX | ArrayModes::RESIZABLE_TYPED_ARRAY)
            || self.has_exited(ExitKind::Overflow)
            || self.is_large_constant(view);
        if is_wide {
            return (self.wide_index(key, access.modes), self.known_length(view));
        }
        let index = self.narrow_index(key);
        (index, self.narrow_length(view, access.of.size_shift()))
    }

    /// Exits if there is no such element, as far as the view knows.
    pub(super) fn address_of_element(&mut self, access: TypedAccess) -> Ssa {
        let index = self.narrow_index(access.key);
        let length = self.narrow_length(access.view, access.of.size_shift());
        let index = self.check_bounds(index, length);
        self.address_in_view(access, index)
    }

    fn address_in_view(&mut self, access: TypedAccess, index: Ssa) -> Ssa {
        let vector = self.vector(access.view);
        let mut ir = self.ir();
        let index = match ir.type_of(index) {
            Type::I32 => ir.zero_extend(index),
            _ => index,
        };
        let offset = ir.shl(index, access.of.size_shift());
        ir.add(vector, offset)
    }

    fn has_fixed_length(&mut self, view: Ssa) -> bool {
        (self.constant_cell::<View>(view)).is_some_and(|it| !it.is_resizable_or_growable())
    }

    /// `finish` gets the place of the element, if there is such an element.
    fn at_element(
        &mut self,
        mut access: TypedAccess,
        finish: &mut dyn FnMut(&mut Self, Option<Place>) -> Option<Ssa>,
    ) -> Option<Ssa> {
        let (view, is_fixed) = (access.view, self.has_fixed_length(access.view));
        let is_resizable = !is_fixed
            && (access.modes.contains(ArrayModes::RESIZABLE_TYPED_ARRAY)
                || self.has_exited(ExitKind::BadShape));
        (access.modes).set(ArrayModes::RESIZABLE_TYPED_ARRAY, is_resizable);
        let (index, length) = self.index_and_length(access);
        if self.graph.function.type_of(index) == Type::I32 && !self.may_be_outside(access.modes) {
            let index = self.check_bounds(index, length);
            let address = self.address_in_view(access, index);
            return finish(self, Some((address, AccessFlags::ALWAYS_READABLE)));
        }
        let is_past = self.ir().above_or_equal(index, length);
        let is_outside = |builder: &mut Self| {
            let length = builder.node(Kind::UpdateViewLength, &[view], 0);
            builder.ir().above_or_equal(index, length)
        };
        let mut finish = |builder: &mut Self, is_outside: bool| {
            let address = (!is_outside).then(|| builder.address_in_view(access, index));
            finish(builder, address.map(|it| (it, AccessFlags::empty())))
        };
        if self.may_be_outside(access.modes) {
            return self.choose(is_past, Odds::Low, |builder, is_past| {
                if is_past && is_resizable {
                    let is_outside = is_outside(builder);
                    return builder.choose(is_outside, Odds::Even, &mut finish);
                }
                if is_past && !is_fixed {
                    let can_change = builder.mode_has(view, ViewMode::RESIZABLE_OR_GROWABLE);
                    builder.exit_if(can_change, ExitKind::BadShape);
                }
                finish(builder, is_past)
            });
        }
        if is_resizable {
            self.choose(is_past, Odds::Low, |builder, is_past| {
                if is_past {
                    let is_outside = is_outside(builder);
                    builder.exit_if(is_outside, ExitKind::OutOfBounds);
                }
                None
            });
        } else {
            self.exit_if(is_past, ExitKind::OutOfBounds);
        }
        finish(self, false)
    }

    pub(in crate::builder) fn mode_has(&mut self, view: Ssa, any_of: ViewMode) -> Ssa {
        let (mut ir, offset) = (self.ir(), View::OFFSET_OF_MODE as i32);
        let mode = ir.load_narrow(Size::S8, Sign::Unsigned, view, offset, heaps::VIEW_LENGTH);
        ir.and(mode, i32::from(any_of.bits()))
    }

    // Loads

    /// An I32 for an integer of up to 32 bits, an I64 for a larger one, and an F64 for any float.
    pub(super) fn load_number(&mut self, of: ElementType, (address, flags): Place) -> Ssa {
        let access = Access::new(heaps::TYPED_ELEMENTS, flags);
        let (mut ir, sign) = (self.ir(), sign_of(of));
        match of {
            ElementType::Float16 => {
                let bits = ir.load_narrow(Size::S16, sign, address, 0, access);
                self.node(Kind::HalfToDouble, &[bits], 0)
            }
            ElementType::Float32 => {
                let float = ir.load(Type::F32, address, 0, access);
                ir.convert(Unary::Promote, Type::F64, float)
            }
            ElementType::Float64 => ir.load(Type::F64, address, 0, access),
            _ => match of.size() {
                1 => ir.load_narrow(Size::S8, sign, address, 0, access),
                2 => ir.load_narrow(Size::S16, sign, address, 0, access),
                4 => ir.load(Type::I32, address, 0, access),
                _ => ir.load(Type::I64, address, 0, access),
            },
        }
    }

    /// Of what `load_number` gives. `seen` is what the result has been so far.
    pub(in crate::builder) fn box_number(&mut self, of: ElementType, number: Ssa, seen: T) -> Ssa {
        if of.is_float() {
            let expected = T::REAL_DOUBLE | seen & T::PURE_NAN;
            self.profiled_node(Kind::BoxDouble, &[number], 0, expected)
        } else if of.is_bigint() {
            self.bigint_from_bits(number, sign_of(of))
        } else if of == ElementType::Uint32 {
            let mut data = crate::graph::ArithmeticData::empty();
            let is_large = seen.intersects(T::BOXED_DOUBLE) || self.has_exited(ExitKind::Overflow);
            data.set(crate::graph::ArithmeticData::MAY_OVERFLOW_INT32, is_large);
            self.profiled_node(Kind::UInt32ToNumber, &[number], data.bits(), T::empty())
        } else {
            self.box_int32(number)
        }
    }

    pub(in crate::builder) fn bigint_from_bits(&mut self, bits: Ssa, sign: Sign) -> Ssa {
        let (magnitude, is_negative) = if sign == Sign::Signed {
            let mut ir = self.ir();
            let (negated, is_negative) = (ir.unary(Unary::Neg, bits), ir.less_than(bits, 0));
            (ir.select(is_negative, negated, bits), is_negative)
        } else {
            (bits, self.int32(0))
        };
        let zero = self.cell(JsBigInt::zero(self.vm).upcast());
        let data = self.allocation(self.vm.shapes.bigint(), JsBigInt::allocation_size(1));
        let operands = [magnitude, is_negative, zero];
        self.node(Kind::BigIntFromDigit, &operands, data.expect("small"))
    }

    pub(super) fn get_from_typed_array(&mut self, access: TypedAccess, seen: T) -> Option<Ssa> {
        self.at_element(access, &mut |builder, place| {
            Some(match place {
                Some(place) => {
                    let number = builder.load_number(access.of, place);
                    builder.box_number(access.of, number, seen)
                }
                None => builder.undefined(),
            })
        })
    }

    pub(super) fn is_in_typed_array(&mut self, access: TypedAccess) -> Option<Ssa> {
        self.at_element(access, &mut |builder, place| {
            Some(builder.value(place.is_some().into()))
        })
    }

    // Stores

    /// Whether `to_element` is worth trying.
    pub(in crate::builder) fn may_become_element(&self, of: ElementType, value: Ssa) -> bool {
        let quiet = if of.is_bigint() {
            T::BIGINT
        } else {
            CONVERTS_QUIETLY
        };
        quiet.contains(self.expected(value)) && !self.has_exited(ExitKind::ExoticObject)
    }

    /// An F32 or F64 for an array of those, or else an integer whose low bytes are to be stored.
    pub(in crate::builder) fn to_element(&mut self, of: ElementType, value: Ssa) -> Ssa {
        let root = self.graph.root(value);
        if of.is_bigint() {
            let bigint = self.check_type_or(value, T::BIGINT, ExitKind::ExoticObject);
            return self.node(Kind::BigIntToBits, &[bigint], 0);
        }
        if of == ElementType::Uint8Clamped {
            return self.node(Kind::Clamp, &[root], 0);
        }
        if !of.is_float() {
            return self.truncate(value);
        }
        let number = (self.graph.inside(root, Kind::BoxDouble))
            .unwrap_or_else(|| self.node(Kind::ToDouble, &[root], 0));
        match (of, *self.graph.function.op(number)) {
            (ElementType::Float16, _) => self.node(Kind::DoubleToHalf, &[number], 0),
            (ElementType::Float32, Op::Unary(Unary::Promote, float)) => float,
            (ElementType::Float32, _) => self.ir().convert(Unary::Demote, Type::F32, number),
            _ => number,
        }
    }

    pub(super) fn store_number(&mut self, of: ElementType, address: Ssa, element: Ssa) {
        let heap = heaps::TYPED_ELEMENTS;
        self.knowledge.note_write(&self.graph, heap);
        match of.size() {
            1 => (self.ir()).store_sized(Size::S8, element, address, 0, heap),
            2 => (self.ir()).store_sized(Size::S16, element, address, 0, heap),
            _ => self.ir().store(element, address, 0, heap),
        }
        self.note_effect();
    }

    pub(super) fn put_to_typed_array(&mut self, access: TypedAccess, value: Ssa) {
        let element = self.to_element(access.of, value);
        self.at_element(access, &mut |builder, place| {
            place.inspect(|&(address, _)| builder.store_number(access.of, address, element));
            None
        });
    }

    pub(in crate::builder) fn typed_array_of_zeros(
        &mut self,
        shape: Gc<Shape>,
        length: Ssa,
    ) -> Ssa {
        let (length, limit) = (self.as_index(length), self.int32(i32::MAX));
        let length = self.check_bounds(length, limit);
        let allocation = self.allocation(shape, size_of::<View>()).expect("small");
        let operands = [length, self.cell(shape.upcast())];
        let view = self.made_with_shape(Kind::NewTypedArray, &operands, allocation);
        (self.knowledge).learn_field(view, NARROW_LENGTH, heaps::VIEW_LENGTH, length);
        view
    }

    // What the getters of the library return

    /// Of an I64.
    pub(super) fn box_size(&mut self, size: Ssa, is_large: bool) -> Ssa {
        if is_large {
            return self.profiled_node(Kind::BoxInt52, &[size], 0, T::INT32 | T::INT52);
        }
        let size = self.size_as_int32(size);
        self.box_int32(size)
    }

    /// The shapes are those of views, and tell whether the length of the buffer is fixed.
    pub(in crate::builder) fn measure_view(
        &mut self,
        view: Ssa,
        shapes: ShapeSet,
        what: AccessKind,
        metadata: u32,
    ) -> Option<Ssa> {
        let is_large = self
            .prediction_or_exit(metadata)?
            .intersects(T::BOXED_DOUBLE)
            || self.has_exited(ExitKind::Overflow);
        let members = self.graph.shapes.members(shapes).iter();
        let types = members.map(|&it| ElementType::of_cell_type(self.graph.shapes[it].cell_type));
        let size_shift = types.flatten().map(ElementType::size_shift).min();
        let size_shift = size_shift.unwrap_or(0);
        let size = match what {
            AccessKind::TypedArrayLength if !is_large => {
                let length = self.narrow_length(view, size_shift);
                return Some(self.box_int32(length));
            }
            AccessKind::TypedArrayLength => self.known_length(view),
            AccessKind::TypedArrayByteLength => {
                let length = self.known_length(view);
                self.ir().shl(length, size_shift)
            }
            AccessKind::TypedArrayByteOffset => match self.settled_view(view) {
                Some(settled) => self.word(settled.declared_byte_offset()),
                None => {
                    let offset = View::OFFSET_OF_BYTE_OFFSET as i32;
                    let word = self.load(Type::I64, view, offset, heaps::VIEW_LENGTH);
                    self.ir().and(word, View::BYTE_OFFSET_MASK)
                }
            },
            AccessKind::DataViewByteLength => {
                let vector = self.vector(view);
                let is_detached = self.ir().is_zero(vector);
                self.exit_if(is_detached, ExitKind::BadShape);
                self.known_length(view)
            }
            AccessKind::ResizableTypedArrayByteOffset => {
                self.node(Kind::CurrentViewOffset, &[view], 0)
            }
            AccessKind::ResizableTypedArrayByteLength => {
                let length = self.node(Kind::CurrentViewLength, &[view], size_shift);
                self.ir().shl(length, size_shift)
            }
            _ => self.node(Kind::CurrentViewLength, &[view], size_shift),
        };
        Some(self.box_size(size, is_large))
    }
}

fn sign_of(of: ElementType) -> Sign {
    if of.is_signed() {
        Sign::Signed
    } else {
        Sign::Unsigned
    }
}
