//! `Atomics`, and what else the library has to say about views.

use bun_engine_asm::{AtomicOp, Sign, Size};
use bun_engine_codegen::ir::{Access, AccessFlags, Heap, Type, Unary, Value as Ssa};
use bun_engine_vm::{ArrayModes, ElementType, Intrinsic, SpeculatedType as T, ViewMode};
use smallvec::SmallVec;

use super::typed_arrays::TypedAccess;
use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::graph::{ExitKind, Kind, heaps};

impl Builder<'_> {
    fn likely_element_type(&self, value: Ssa) -> Option<ElementType> {
        let expected = self.expected(value);
        (ElementType::ALL.into_iter()).find(|it| expected == T::of_cell_type(it.cell_type()))
    }

    pub(in crate::builder) fn view_intrinsic(
        &mut self,
        which: Intrinsic,
        site: &CallSite<'_>,
    ) -> Option<Ssa> {
        let (update, count) = match which {
            Intrinsic::IsTypedArrayView | Intrinsic::ArrayBufferIsView => {
                let mut views = T::TYPED_ARRAY;
                views.set(T::DATA_VIEW, which == Intrinsic::ArrayBufferIsView);
                let answer = self.is_type(*site.arguments.get(1)?, views);
                return Some(self.box_boolean(answer));
            }
            Intrinsic::ValidTypedArrayLength => return self.valid_length(*site.arguments.get(1)?),
            Intrinsic::TypedArraySet => return self.set_from_typed_array(site.arguments),
            Intrinsic::AtomicsAdd => (Some(AtomicOp::Add), 1),
            Intrinsic::AtomicsAnd => (Some(AtomicOp::And), 1),
            Intrinsic::AtomicsExchange => (Some(AtomicOp::Exchange), 1),
            Intrinsic::AtomicsOr => (Some(AtomicOp::Or), 1),
            Intrinsic::AtomicsSub => (Some(AtomicOp::Sub), 1),
            Intrinsic::AtomicsXor => (Some(AtomicOp::Xor), 1),
            Intrinsic::AtomicsLoad => (None, 0),
            Intrinsic::AtomicsStore => (None, 1),
            Intrinsic::AtomicsCompareExchange => (None, 2),
            _ => return None,
        };
        let (&[_, array, index], rest) = site.arguments.split_first_chunk()?;
        let (values, of) = (rest.get(..count)?, self.likely_element_type(array)?);
        let failures = [ExitKind::OutOfBounds, ExitKind::Overflow];
        // What is stored is also the result.
        let must_be_int32 = which == Intrinsic::AtomicsStore && !of.is_bigint();
        if of.is_float()
            || of == ElementType::Uint8Clamped
            || !self.may_be_index(index)
            || failures.into_iter().any(|it| self.has_exited(it))
            || !values.iter().all(|&it| self.may_become_element(of, it))
            || must_be_int32 && !T::INT32.contains(self.expected(values[0]))
        {
            return None;
        }
        let ty = T::of_cell_type(of.cell_type());
        let view = self.check_type_or(array, ty, ExitKind::ExoticObject);
        let operands: SmallVec<[Ssa; 2]> = (values.iter())
            .map(|&value| match must_be_int32 {
                true => self.as_index(value),
                false => self.to_element(of, value),
            })
            .collect();
        let address =
            self.address_of_element(TypedAccess::new(view, of, index, ArrayModes::empty()));
        let is_odd = self.ir().and(address, of.size() - 1);
        self.exit_if(is_odd, ExitKind::ExoticObject);

        let access = Access::new(heaps::TYPED_ELEMENTS, AccessFlags::ATOMIC);
        let size = [Size::S8, Size::S16, Size::S32, Size::S64][of.size_shift() as usize];
        let mut ir = self.ir();
        let old = match (update, &*operands) {
            (Some(op), &[operand]) => Some(ir.atomic_update(op, size, operand, address, access)),
            (_, &[expected, new]) => {
                let expected = match size {
                    Size::S8 | Size::S16 => ir.and(expected, (1 << (size.bytes() * 8)) - 1),
                    _ => expected,
                };
                Some(ir.atomic_compare_exchange(size, expected, new, address, access))
            }
            (_, &[operand]) => {
                ir.store_sized(size, operand, address, 0, access);
                None
            }
            _ => Some(match size {
                Size::S32 => ir.load(Type::I32, address, 0, access),
                Size::S64 => ir.load(Type::I64, address, 0, access),
                _ => ir.load_narrow(size, Sign::Unsigned, address, 0, access),
            }),
        };
        let old = old.map(|old| match of {
            ElementType::Int8 | ElementType::Int16 => ir.unary(Unary::SignExtend(size), old),
            _ => old,
        });
        self.knowledge.note_write(&self.graph, Heap::EVERYTHING);
        self.note_effect();
        self.needs_invalidation_point = true;
        Some(match old {
            // There is no way back from here.
            Some(old) if of == ElementType::Uint32 => {
                let wide = self.ir().zero_extend(old);
                self.box_size(wide, true)
            }
            Some(old) => self.box_number(of, old, T::empty()),
            None if must_be_int32 => self.box_int32(operands[0]),
            None => values[0],
        })
    }

    /// To a buffer of a fixed length.
    fn check_is_attached_for_now(&mut self, view: Ssa) {
        let can_change = self.mode_has(view, ViewMode::RESIZABLE_OR_GROWABLE);
        self.exit_if(can_change, ExitKind::ExoticObject);
        let vector = self.vector(view);
        let is_detached = self.ir().is_zero(vector);
        self.exit_if(is_detached, ExitKind::ExoticObject);
    }

    fn set_from_typed_array(&mut self, arguments: &[Ssa]) -> Option<Ssa> {
        let (&[target, source], rest) = arguments.split_first_chunk()?;
        let types = [
            self.likely_element_type(target)?,
            self.likely_element_type(source)?,
        ];
        let offset = rest.first().filter(|&&it| !self.is(it, T::UNDEFINED));
        if !types[0].has_bits_of(types[1]) || !offset.is_none_or(|&it| self.may_be_index(it)) {
            return None;
        }
        let [target, source] = [(target, types[0]), (source, types[1])].map(|(value, of)| {
            let ty = T::of_cell_type(of.cell_type());
            let view = self.check_type_or(value, ty, ExitKind::ExoticObject);
            self.check_is_attached_for_now(view);
            view
        });
        let offset = match offset {
            Some(&offset) => self.as_index(offset),
            None => self.int32(0),
        };
        let (room, count) = (self.known_length(target), self.known_length(source));
        let mut ir = self.ir();
        let (is_negative, offset) = (ir.less_than(offset, 0), ir.zero_extend(offset));
        let end = ir.add(offset, count);
        let is_past = ir.above(end, room);
        let is_outside = ir.or(is_negative, is_past);
        let [offset, count] = [offset, count].map(|it| ir.shl(it, types[0].size_shift()));
        self.exit_if(is_outside, ExitKind::ExoticObject);
        self.node(Kind::CopyView, &[target, source, offset, count], 0);
        Some(self.undefined())
    }

    /// Of a typed array that is within the bounds of its buffer.
    fn valid_length(&mut self, array: Ssa) -> Option<Ssa> {
        if !T::TYPED_ARRAY.contains(self.expected(array)) || self.has_exited(ExitKind::Overflow) {
            return None;
        }
        let view = self.check_type_or(array, T::TYPED_ARRAY, ExitKind::ExoticObject);
        self.check_is_attached_for_now(view);
        let length = self.narrow_length(view, 0);
        Some(self.box_int32(length))
    }
}
