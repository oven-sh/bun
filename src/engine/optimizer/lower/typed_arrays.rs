//! What it takes to get numbers in and out of buffers.

use bun_engine_codegen::Target;
use bun_engine_codegen::ir::{Access, AccessFlags, Type, Unary, Value as Ssa};
use bun_engine_vm::{ArrayBuffer, JsArrayBufferView as View, JsBigInt, ViewMode};

use super::{Lowering, Odds};
use crate::graph::{ExitKind, IntegerRange, heaps};
use crate::runtime::operations::elements as operations;

impl Lowering<'_> {
    pub(super) fn size_as_int32(&mut self, size: Ssa) -> Ssa {
        let is_large = self.ir().above(size, i32::MAX);
        self.exit_if(is_large, ExitKind::Overflow);
        self.ir().wrap(size)
    }

    pub(super) fn half_to_double(&mut self, bits: Ssa) -> Ssa {
        if Target::host().has_half_floats() {
            return (self.ir()).convert(Unary::HalfBitsToFloat, Type::F64, bits);
        }
        self.call_leaf(operations::HALF_TO_DOUBLE, &[bits], Type::F64)
    }

    pub(super) fn double_to_half(&mut self, number: Ssa) -> Ssa {
        if Target::host().has_half_floats() {
            return (self.ir()).convert(Unary::FloatToHalfBits, Type::I32, number);
        }
        self.call_leaf(operations::DOUBLE_TO_HALF, &[number], Type::I32)
    }

    pub(super) fn bigint_from_digit(&mut self, digit: Ssa, sign: Ssa, allocation: u32) -> Ssa {
        let (zero, is_zero) = (self.operands()[2], self.ir().is_zero(digit));
        let make = |this: &mut Self| {
            let (bigint, one, heap) = (
                this.allocate(allocation),
                this.int32(1),
                heaps::OTHER_FIELDS,
            );
            this.store(one, bigint, JsBigInt::OFFSET_OF_LENGTH, heap);
            this.store(sign, bigint, JsBigInt::OFFSET_OF_SIGN, heap);
            this.store(digit, bigint, JsBigInt::OFFSET_OF_DIGITS, heap);
            bigint
        };
        self.choose(is_zero, Odds::Low, Type::I64, |_| zero, make)
    }

    pub(super) fn bigint_to_bits(&mut self, bigint: Ssa) -> Ssa {
        let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
        let at = |offset: usize| offset as i32;
        let length = (self.ir()).load(Type::I32, bigint, at(JsBigInt::OFFSET_OF_LENGTH), access);
        let is_zero = self.ir().is_zero(length);
        let lowest = |this: &mut Self| {
            let is_negative = this.load_byte(bigint, JsBigInt::OFFSET_OF_SIGN, access);
            let mut ir = this.ir();
            let digit = ir.load(Type::I64, bigint, at(JsBigInt::OFFSET_OF_DIGITS), access);
            let negated = ir.unary(Unary::Neg, digit);
            ir.select(is_negative, negated, digit)
        };
        self.choose(is_zero, Odds::Low, Type::I64, |this| this.word(0), lowest)
    }

    pub(super) fn bigint_in_range(&mut self, bigint: Ssa, range: u32) -> Ssa {
        let access = Access::new(heaps::OTHER_FIELDS, AccessFlags::IMMUTABLE);
        let (bits, is_negative) = (
            self.bigint_to_bits(bigint),
            self.load_byte(bigint, JsBigInt::OFFSET_OF_SIGN, access),
        );
        let mut ir = self.ir();
        let length = ir.load(Type::I32, bigint, JsBigInt::OFFSET_OF_LENGTH as i32, access);
        let is_long = ir.above(length, 1);
        let has_wrong_sign = if IntegerRange::from_data(range).is_signed {
            let looks_negative = ir.less_than(bits, 0);
            ir.xor(looks_negative, is_negative)
        } else {
            is_negative
        };
        let is_outside = ir.or(is_long, has_wrong_sign);
        self.exit_if(is_outside, ExitKind::ExoticObject);
        bits
    }

    pub(super) fn copy_view(&mut self, target: Ssa, source: Ssa) {
        let [to, from] = [target, source]
            .map(|view| self.load(Type::I64, view, View::OFFSET_OF_VECTOR, heaps::VIEW_VECTOR));
        let (operands, effects) = (self.operands(), self.graph.function.effects(self.at));
        let args = [self.ir().add(to, operands[2]), from, operands[3]];
        self.call_with_effects(operations::MOVE_BYTES, &args, &[], effects);
    }

    pub(super) fn update_view_length(&mut self, view: Ssa) -> Ssa {
        self.call_quietly(operations::LENGTH_OF_VIEW, &[view], Type::I64)
    }

    pub(super) fn current_view_offset(&mut self, view: Ssa) -> Ssa {
        self.call_quietly(operations::OFFSET_OF_VIEW, &[view], Type::I64)
    }

    pub(super) fn current_view_length(&mut self, view: Ssa, size_shift: u32) -> Ssa {
        let heap = heaps::VIEW_LENGTH;
        let mode = self.load_byte(view, View::OFFSET_OF_MODE, heap);
        let has = |this: &mut Self, flag: ViewMode| this.ir().and(mode, i32::from(flag.bits()));
        let is_shared = has(self, ViewMode::GROWABLE_SHARED);
        // A buffer that is detached has no bytes.
        let compute = |this: &mut Self| {
            let buffer = this.load(Type::I64, view, View::OFFSET_OF_BUFFER, heap);
            let bytes = this.load(Type::I64, buffer, ArrayBuffer::OFFSET_OF_BYTE_LENGTH, heap);
            let word = this.load(Type::I64, view, View::OFFSET_OF_BYTE_OFFSET, heap);
            let declared = this.load(Type::I64, view, View::OFFSET_OF_DECLARED_LENGTH, heap);
            let (is_auto, none) = (has(this, ViewMode::AUTO_LENGTH), this.word(0));
            let mut ir = this.ir();
            let offset = ir.and(word, View::BYTE_OFFSET_MASK);
            let rest = ir.sub(bytes, offset);
            let available = ir.sar(rest, size_shift);
            let length = ir.select(is_auto, available, declared);
            let (is_past, is_negative) =
                (ir.greater_than(length, available), ir.less_than(length, 0));
            let is_outside = ir.or(is_past, is_negative);
            ir.select(is_outside, none, length)
        };
        let ask = |this: &mut Self| this.update_view_length(view);
        self.choose(is_shared, Odds::Low, Type::I64, ask, compute)
    }
}
