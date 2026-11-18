//! Arithmetic and logic on integers.

use bun_engine_asm::arm64::{
    AddSub, Bitfield, ConstantMove, Logical, MultiplyAdd, MultiplyAddLong, Select, ShiftOp,
    Unary as UnaryOp, WithCarry,
};
use bun_engine_asm::{Sign, Size, Width};

use super::instruction::{Addend, Inst, Mask, ZERO};
use super::operand::{Matched, arithmetic_imm};
use crate::ir::{Binary, Checked, Load, Op, Type, Unary, Value, Wide};
use crate::machine::{Lowering, Role};

impl Lowering<'_, Inst> {
    pub(super) fn select_int_binary(&mut self, value: Value, op: Binary, lhs: Value, rhs: Value) {
        let width = self.type_of(value).width();
        match op {
            Binary::Add => self.select_add(value, lhs, rhs),
            Binary::Sub => self.select_sub(value, lhs, rhs),
            Binary::Mul => self.select_mul(value, lhs, rhs),
            Binary::And if self.select_field(value) || self.select_logic(value) => {}
            Binary::And => self.select_and(value, lhs, rhs),
            Binary::Or
                if self.select_logic(value) || self.select_join_of_fields(value, lhs, rhs) => {}
            Binary::Or => self.select_logical(value, Logical::Orr, lhs, rhs),
            Binary::Xor => self.select_xor(value, lhs, rhs),
            Binary::Div | Binary::TotalDiv => {
                self.select_plain(value, Inst::Divide(Sign::Signed, width), lhs, rhs);
            }
            Binary::UnsignedDiv => {
                self.select_plain(value, Inst::Divide(Sign::Unsigned, width), lhs, rhs);
            }
            Binary::TotalRem if self.int_constant(rhs).is_none_or(|divisor| divisor == 0) => {
                self.def(value);
                self.use_or_zero(lhs, Role::Use);
                self.use_register(rhs);
                self.finish(Inst::TotalRemainder(width));
            }
            Binary::Rem | Binary::TotalRem => {
                self.select_plain(value, Inst::Remainder(Sign::Signed, width), lhs, rhs);
            }
            Binary::UnsignedRem => {
                self.select_plain(value, Inst::Remainder(Sign::Unsigned, width), lhs, rhs);
            }
            Binary::MulHigh(sign) if width == Width::W32 => {
                let instruction = Inst::MultiplyLongAndShift(sign, ShiftOp::Lsr, 32);
                self.select_plain(value, instruction, lhs, rhs);
            }
            Binary::MulHigh(sign) => self.select_plain(value, Inst::MultiplyHigh(sign), lhs, rhs),
            Binary::Shr | Binary::Sar if self.select_shifted_product(value, op, lhs, rhs) => {}
            Binary::Shl => self.select_shift(value, ShiftOp::Lsl, false, lhs, rhs),
            Binary::Shr => self.select_shift(value, ShiftOp::Lsr, false, lhs, rhs),
            Binary::Sar => self.select_shift(value, ShiftOp::Asr, false, lhs, rhs),
            Binary::RotateRight => self.select_shift(value, ShiftOp::Ror, false, lhs, rhs),
            Binary::RotateLeft => self.select_shift(value, ShiftOp::Ror, true, lhs, rhs),
            Binary::Min | Binary::Max | Binary::CopySign => unreachable!("not of integers"),
        }
    }

    fn select_plain(&mut self, value: Value, instruction: Inst, lhs: Value, rhs: Value) {
        self.def(value);
        self.use_or_zero(lhs, Role::Use);
        self.use_or_zero(rhs, Role::Use);
        self.finish(instruction);
    }

    pub(super) fn select_one_operand(&mut self, value: Value, instruction: Inst, operand: Value) {
        self.def(value);
        self.use_or_zero(operand, Role::Use);
        self.finish(instruction);
    }

    pub(super) fn select_bit(&mut self, value: Value, source: Value, bit: u8) {
        let width = if bit < 32 { Width::W32 } else { Width::W64 };
        let instruction = Inst::Bitfield(Bitfield::Ubfm, width, bit, bit);
        self.select_one_operand(value, instruction, source);
    }

    fn finish_add_sub(&mut self, value: Value, matched: Matched<AddSub, Addend>) {
        self.def(value);
        self.use_add_sub(matched, Role::Use);
        let width = self.type_of(value).width();
        self.finish(Inst::AddSub(matched.op, width, matched.form));
    }

    fn select_sum_with_constant(&mut self, value: Value, lhs: Value, constant: i64) -> bool {
        const REACH_OF_TWO: u64 = 1 << 24;
        let width = self.type_of(value).width();
        if let Some(slot) = self.frame_offset(lhs)
            && let Ok(offset) = i32::try_from(constant.wrapping_add(slot.into()))
        {
            self.def(value);
            self.finish(Inst::FrameAddress(offset));
            return true;
        }
        let takes_two_steps = constant.unsigned_abs() < REACH_OF_TWO
            && arithmetic_imm(AddSub::Add, constant).is_none()
            && !self.is_in_loop()
            && ConstantMove::new(width, constant as u64).instructions() > 1;
        if takes_two_steps {
            self.def(value);
            self.use_register(lhs);
            self.finish(Inst::AddConstant(width, constant as i32));
        }
        takes_two_steps
    }

    /// The factors, if it takes a multiplication.
    fn product(&self, value: Value) -> Option<[Value; 2]> {
        match self.op(value) {
            Op::Binary(Binary::Mul, factors) if self.has_one_use_nearby(value) => {
                let is_shift = self
                    .constant_bits(factors[1])
                    .is_some_and(u64::is_power_of_two);
                (!is_shift).then_some(factors)
            }
            _ => None,
        }
    }

    /// `addend` is `NONE` for zero.
    fn select_multiply_add(
        &mut self,
        value: Value,
        op: MultiplyAdd,
        [lhs, rhs]: [Value; 2],
        addend: Value,
    ) {
        let (instruction, lhs, rhs) = match self.narrow_factors(lhs, rhs) {
            Some((sign, lhs, rhs)) => {
                let long = match (sign, op) {
                    (Sign::Signed, MultiplyAdd::Madd) => MultiplyAddLong::Smaddl,
                    (Sign::Signed, MultiplyAdd::Msub) => MultiplyAddLong::Smsubl,
                    (Sign::Unsigned, MultiplyAdd::Madd) => MultiplyAddLong::Umaddl,
                    (Sign::Unsigned, MultiplyAdd::Msub) => MultiplyAddLong::Umsubl,
                };
                (Inst::MultiplyAddLong(long), lhs, rhs)
            }
            None => (Inst::MultiplyAdd(op, self.type_of(value).width()), lhs, rhs),
        };
        self.def(value);
        self.use_or_zero(lhs, Role::Use);
        self.use_or_zero(rhs, Role::Use);
        match addend.expand() {
            Some(addend) => self.use_or_zero(addend, Role::Use),
            None => self.given(ZERO),
        }
        self.finish(instruction);
    }

    fn select_add(&mut self, value: Value, lhs: Value, rhs: Value) {
        let (lhs, rhs) = if self.belongs_right(lhs, rhs) {
            (rhs, lhs)
        } else {
            (lhs, rhs)
        };
        if let Some(constant) = self.int_constant(rhs)
            && self.select_sum_with_constant(value, lhs, constant)
        {
            return;
        }
        let matched = self.match_add_sub(AddSub::Add, lhs, rhs);
        if !matches!(matched.form, Addend::Imm(_)) {
            for (other, term) in [(lhs, rhs), (rhs, lhs)] {
                if let Some(factors) = self.product(term) {
                    return self.select_multiply_add(value, MultiplyAdd::Madd, factors, other);
                }
                if let Some((condition, cc)) = self.match_boolean(term) {
                    self.def(value);
                    self.use_or_zero(other, Role::Use);
                    self.use_or_zero(other, Role::Use);
                    let width = self.type_of(value).width();
                    self.finish(Inst::Select(Select::Csinc, width, cc.inverted()));
                    return self.finish_condition(&condition);
                }
            }
            if self.select_join_of_fields(value, lhs, rhs) {
                return;
            }
        }
        self.finish_add_sub(value, matched);
    }

    fn select_sub(&mut self, value: Value, lhs: Value, rhs: Value) {
        if self.is_zero(lhs) {
            return self.select_neg(value, rhs);
        }
        if let Some(constant) = self.int_constant(rhs)
            && self.select_sum_with_constant(value, lhs, constant.wrapping_neg())
        {
            return;
        }
        if let Some(factors) = self.product(rhs) {
            return self.select_multiply_add(value, MultiplyAdd::Msub, factors, lhs);
        }
        let matched = self.match_add_sub(AddSub::Sub, lhs, rhs);
        self.finish_add_sub(value, matched);
    }

    pub(super) fn select_neg(&mut self, value: Value, operand: Value) {
        let width = self.type_of(value).width();
        if let Some(factors) = self.product(operand) {
            return self.select_multiply_add(value, MultiplyAdd::Msub, factors, Value::NONE);
        }
        if let Some((condition, cc)) = self.match_boolean(operand) {
            self.def(value);
            self.given(ZERO);
            self.given(ZERO);
            self.finish(Inst::Select(Select::Csinv, width, cc.inverted()));
            return self.finish_condition(&condition);
        }
        let (form, operand) = match self.folded_addend(operand) {
            Some(shifted @ (Addend::Shifted(..), _)) => shifted,
            _ => (Addend::PLAIN, operand),
        };
        self.def(value);
        self.given(ZERO);
        self.use_or_zero(operand, Role::Use);
        self.finish(Inst::AddSub(AddSub::Sub, width, form));
    }

    fn select_mul_by_constant(&mut self, value: Value, lhs: Value, factor: i64) -> bool {
        let width = self.type_of(value).width();
        let log2 = |number: i64| {
            let bits = number as u64 & u64::MAX >> (64 - width.bits());
            bits.is_power_of_two().then(|| bits.ilog2() as u8)
        };
        let (op, keeps_one, amount) = if let Some(amount) = log2(factor.wrapping_neg()) {
            (AddSub::Sub, false, amount)
        } else if let Some(amount) = log2(factor.wrapping_sub(1)) {
            (AddSub::Add, true, amount)
        } else if let Some(amount) = log2(1i64.wrapping_sub(factor)) {
            (AddSub::Sub, true, amount)
        } else {
            return false;
        };
        self.def(value);
        if keeps_one {
            self.use_or_zero(lhs, Role::Use);
        } else {
            self.given(ZERO);
        }
        self.use_or_zero(lhs, Role::Use);
        let form = Addend::Shifted(ShiftOp::Lsl, amount);
        self.finish(Inst::AddSub(op, width, form));
        true
    }

    fn select_mul(&mut self, value: Value, lhs: Value, rhs: Value) {
        let (lhs, rhs) = if self.op(lhs).is_constant() {
            (rhs, lhs)
        } else {
            (lhs, rhs)
        };
        if let Some(factor) = self.int_constant(rhs)
            && (self.select_field(value) || self.select_mul_by_constant(value, lhs, factor))
        {
            return;
        }
        for (other, factor) in [(lhs, rhs), (rhs, lhs)] {
            if let Some(negated) = self.negated(factor) {
                let factors = [other, negated];
                return self.select_multiply_add(value, MultiplyAdd::Msub, factors, Value::NONE);
            }
        }
        self.select_multiply_add(value, MultiplyAdd::Madd, [lhs, rhs], Value::NONE);
    }

    fn select_logical(&mut self, value: Value, op: Logical, lhs: Value, rhs: Value) {
        let matched = self.match_logical(op, lhs, rhs);
        self.def(value);
        self.use_logical(matched);
        self.finish(Inst::Logical(matched.op, matched.form));
    }

    fn select_and(&mut self, value: Value, lhs: Value, rhs: Value) {
        let ty = self.type_of(value);
        for (other, operand) in [(lhs, rhs), (rhs, lhs)] {
            match self.op(operand) {
                _ if !self.has_one_use_nearby(operand) => {}
                Op::Unary(Unary::Widen(Sign::Unsigned), narrow) => {
                    let low = match self.constant_bits(other) {
                        Some(bits) => self.intern(Type::I32, bits),
                        None => self.insert_before(value, Op::Unary(Unary::Wrap, other), Type::I32),
                    };
                    return self.select_logical(value, Logical::And, narrow, low);
                }
                Op::Binary(Binary::RotateLeft, [all_but_one, amount])
                    if self.int_constant(all_but_one) == Some(-2) =>
                {
                    let one = self.intern(ty, 1);
                    let bit = self.insert_before(value, Op::Binary(Binary::Shl, [one, amount]), ty);
                    let plain = Mask::Shifted(ty.width(), ShiftOp::Lsl, 0);
                    return self.select_plain(
                        value,
                        Inst::Logical(Logical::Bic, plain),
                        other,
                        bit,
                    );
                }
                _ => {}
            }
        }
        self.select_logical(value, Logical::And, lhs, rhs);
    }

    pub(super) fn select_swap_of_bytes(&mut self, value: Value, size: Size, operand: Value) {
        let has_two_bytes = matches!(
            self.op(operand),
            Op::Load {
                kind: Load::Narrow(_, Sign::Unsigned),
                ..
            }
        );
        if size == Size::S16 && has_two_bytes {
            self.select_one_operand(value, Inst::Unary(UnaryOp::Rev16, Width::W32), operand);
        } else {
            self.select_shared(value);
        }
    }

    fn select_not(&mut self, value: Value, operand: Value) {
        let plain = Mask::Shifted(self.type_of(value).width(), ShiftOp::Lsl, 0);
        if let Op::Binary(Binary::Xor, [lhs, rhs]) = self.op(operand)
            && self.has_one_use_nearby(operand)
            && let matched = self.match_logical(Logical::Eor, lhs, rhs)
            && let (Logical::Eor, Mask::Shifted(..)) = (matched.op, matched.form)
        {
            self.def(value);
            self.use_logical(matched);
            return self.finish(Inst::Logical(Logical::Eon, matched.form));
        }
        let (form, operand) = self.folded_mask(operand).unwrap_or((plain, operand));
        self.def(value);
        self.given(ZERO);
        self.use_or_zero(operand, Role::Use);
        self.finish(Inst::Logical(Logical::Orn, form));
    }

    fn select_xor(&mut self, value: Value, lhs: Value, rhs: Value) {
        match self.int_constant(rhs) {
            Some(-1) => self.select_not(value, lhs),
            Some(1)
                if self.type_of(value) == Type::I32
                    && self.has_one_use_nearby(lhs)
                    && matches!(self.op(lhs), Op::Compare(..) | Op::FloatCompare(..)) =>
            {
                self.select_boolean(value);
            }
            None if self.select_join_of_fields(value, lhs, rhs) => {}
            _ => self.select_logical(value, Logical::Eor, lhs, rhs),
        }
    }

    fn select_shifted_product(
        &mut self,
        value: Value,
        op: Binary,
        lhs: Value,
        amount: Value,
    ) -> bool {
        if let Op::Binary(Binary::MulHigh(sign), [a, b]) = self.op(lhs)
            && self.type_of(value) == Type::I32
            && self.has_one_use_nearby(lhs)
            && let Some(amount) = self.constant_amount(amount, Type::I32)
        {
            let shift = if op == Binary::Shr {
                ShiftOp::Lsr
            } else {
                ShiftOp::Asr
            };
            let instruction = Inst::MultiplyLongAndShift(sign, shift, 32 + amount);
            self.select_plain(value, instruction, a, b);
            return true;
        }
        false
    }

    fn select_shift(
        &mut self,
        value: Value,
        op: ShiftOp,
        mut is_negated: bool,
        lhs: Value,
        mut amount: Value,
    ) {
        let ty = self.type_of(value);
        let width = ty.width();
        if let Some(constant) = self.constant_amount(amount, ty) {
            if op == ShiftOp::Ror {
                let constant = if is_negated {
                    constant.wrapping_neg() % width.bits()
                } else {
                    constant
                };
                return self.select_plain(value, Inst::Extract(width, constant), lhs, lhs);
            }
            let is_done = self.select_field(value);
            return debug_assert!(is_done);
        }
        let counted = u64::from(width.bits() - 1);
        for _ in 0..2 {
            amount = match self.op(amount) {
                _ if self.is_materialized(amount) => break,
                Op::Binary(Binary::And, [inner, mask])
                    if self
                        .constant_bits(mask)
                        .is_some_and(|mask| mask & counted == counted) =>
                {
                    inner
                }
                Op::Binary(Binary::Sub, [whole, inner])
                    if self
                        .constant_bits(whole)
                        .is_some_and(|whole| whole & counted == 0)
                        && (is_negated || self.has_one_use_nearby(amount)) =>
                {
                    is_negated ^= true;
                    inner
                }
                Op::Unary(Unary::Neg, inner) if is_negated => {
                    is_negated = false;
                    inner
                }
                _ => break,
            };
        }
        self.select_plain(value, Inst::Shift(op, width, is_negated), lhs, amount);
    }

    pub(super) fn select_count_trailing_zeros(&mut self, value: Value, operand: Value) {
        let width = self.type_of(value).width();
        self.select_one_operand(value, Inst::CountTrailingZeros(width), operand);
    }

    pub(super) fn select_count_leading_zeros(&mut self, value: Value, operand: Value) {
        let width = self.type_of(value).width();
        self.select_one_operand(value, Inst::Unary(UnaryOp::Clz, width), operand);
    }

    /// The exit can compute `operand` back from the result and `other`.
    fn can_be_recovered(&self, operand: Value, other: Value) -> bool {
        self.representative(operand) == operand
            && self.representative(other) != operand
            && !self.op(operand).is_floating()
    }

    fn select_checked_add_sub(&mut self, value: Value, op: AddSub, lhs: Value, rhs: Value) {
        let width = self.type_of(value).width();
        if op == AddSub::Subs && self.is_zero(lhs) {
            self.def(value);
            self.use_register(rhs);
            self.exit_of(value, self.can_be_recovered(rhs, lhs).then_some(rhs));
            return self.finish(Inst::CheckedNeg(width));
        }
        let swaps = op == AddSub::Adds
            && (self.belongs_right(lhs, rhs)
                || !self.belongs_right(rhs, lhs) && self.suits_result_better(rhs, lhs, value));
        let (lhs, rhs) = if swaps { (rhs, lhs) } else { (lhs, rhs) };
        let matched = self.match_add_sub(op, lhs, rhs);
        let is_recoverable = self.can_be_recovered(lhs, matched.rhs.expand().unwrap_or(rhs));
        self.def(value);
        let role = if is_recoverable {
            Role::LateUse
        } else {
            Role::Use
        };
        self.use_add_sub(matched, role);
        self.exit_of(value, is_recoverable.then_some(lhs));
        self.finish(Inst::CheckedAddSub(matched.op, width, matched.form));
    }

    pub(super) fn select_checked(&mut self, value: Value, op: Checked, lhs: Value, rhs: Value) {
        let width = self.type_of(value).width();
        match op {
            Checked::Add => return self.select_checked_add_sub(value, AddSub::Adds, lhs, rhs),
            Checked::Sub => return self.select_checked_add_sub(value, AddSub::Subs, lhs, rhs),
            Checked::Mul => {}
        }
        let (lhs, rhs) = if self.op(lhs).is_constant() {
            (rhs, lhs)
        } else {
            (lhs, rhs)
        };
        match self.int_constant(rhs) {
            Some(2) => self.select_checked_add_sub(value, AddSub::Adds, lhs, lhs),
            Some(factor @ 1..) if factor.count_ones() == 1 => {
                self.def(value);
                if width == Width::W32 {
                    self.use_register(lhs);
                } else {
                    self.use_late(lhs);
                }
                self.exit_of(value, None);
                self.finish(Inst::CheckedShift(width, factor.ilog2() as u8));
            }
            _ => {
                self.def(value);
                self.use_or_zero(lhs, Role::Use);
                self.use_or_zero(rhs, Role::Use);
                self.exit_of(value, None);
                self.finish(Inst::CheckedMul(width));
            }
        }
    }

    pub(super) fn select_wide(&mut self, value: Value, op: Wide, operands: [Value; 4]) {
        let [lhs_low, lhs_high, rhs_low, rhs_high] = operands;
        let (low, high) = match op {
            Wide::Add => (AddSub::Adds, WithCarry::Adc),
            Wide::Sub => (AddSub::Subs, WithCarry::Sbc),
        };
        if self.is_element_used(value, 1) {
            self.select_element(value, 1, Inst::WithCarry(high), &[lhs_high, rhs_high]);
        }
        let low = Inst::AddSub(low, Width::W64, Addend::PLAIN);
        self.select_element(value, 0, low, &[lhs_low, rhs_low]);
    }

    pub(super) fn select_mul_wide(&mut self, value: Value, sign: Sign, lhs: Value, rhs: Value) {
        if self.is_element_used(value, 1) {
            self.select_element(value, 1, Inst::MultiplyHigh(sign), &[lhs, rhs]);
        }
        if self.is_element_used(value, 0) {
            let zero = self.intern(Type::I64, 0);
            let low = Inst::MultiplyAdd(MultiplyAdd::Madd, Width::W64);
            self.select_element(value, 0, low, &[lhs, rhs, zero]);
        }
    }

    fn select_element(
        &mut self,
        tuple: Value,
        position: usize,
        instruction: Inst,
        operands: &[Value],
    ) {
        self.def_element(tuple, position);
        for &operand in operands {
            self.use_or_zero(operand, Role::Use);
        }
        self.finish(instruction);
    }
}
