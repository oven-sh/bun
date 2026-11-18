//! What instructions do to an operand on the way.

use bun_engine_asm::arm64::{AddSub, ArithmeticImm, BitmaskImm, Extend, Logical, ShiftOp};
use bun_engine_asm::{Sign, Width};

use super::bitfield::Field;
use super::instruction::{Addend, Inst, Mask, ZERO};
use crate::ir::{Binary, Op, Type, Value};
use crate::machine::{Lowering, Place, Role};

/// Most processors shift an operand to the left by up to this much without delay.
const SHORT_SHIFT: u8 = 4;

/// `op` with the constant, or the opposite with its negative.
pub(super) fn arithmetic_imm(op: AddSub, constant: i64) -> Option<(AddSub, ArithmeticImm)> {
    let op = if constant < 0 { op.opposite() } else { op };
    Some((op, ArithmeticImm::new(constant.unsigned_abs())?))
}

fn inverting(op: Logical) -> Logical {
    match op {
        Logical::And => Logical::Bic,
        Logical::Orr => Logical::Orn,
        Logical::Eor => Logical::Eon,
        Logical::Ands => Logical::Bics,
        _ => unreachable!("inverts already"),
    }
}

/// An operation with its operands, which have not been given to the instruction yet.
#[derive(Clone, Copy)]
pub(super) struct Matched<Op, Form> {
    pub(super) op: Op,
    pub(super) form: Form,
    pub(super) lhs: Value,
    /// `NONE` if it is a part of the form.
    pub(super) rhs: Value,
}

impl Lowering<'_, Inst> {
    pub(super) fn is_zero(&self, value: Value) -> bool {
        self.constant_bits(value) == Some(0)
    }

    pub(super) fn use_or_zero(&mut self, value: Value, role: Role) {
        if self.is_zero(value) {
            self.given(ZERO);
        } else {
            self.use_value(value, role, Place::Register);
        }
    }

    pub(super) fn complemented(&self, value: Value) -> Option<Value> {
        match self.op(value) {
            Op::Binary(Binary::Xor, [inner, ones]) if self.int_constant(ones) == Some(-1) => {
                self.dissolves(value).then_some(inner)
            }
            _ => None,
        }
    }

    pub(super) fn negated(&self, value: Value) -> Option<Value> {
        match self.op(value) {
            Op::Unary(crate::ir::Unary::Neg, inner) => Some(inner),
            Op::Binary(Binary::Sub, [zero, inner]) if self.int_constant(zero) == Some(0) => {
                Some(inner)
            }
            _ => None,
        }
        .filter(|_| self.dissolves(value))
    }

    fn shift_for(&self, field: Field, width: Width) -> Option<(ShiftOp, u8)> {
        if self.is_bare(field, width) {
            Some((ShiftOp::Lsl, field.to))
        } else if field.to == 0 && field.source_end() == width.bits() {
            let op = if field.is_signed {
                ShiftOp::Asr
            } else {
                ShiftOp::Lsr
            };
            Some((op, field.first))
        } else {
            None
        }
    }

    fn extension_for(field: Field) -> Option<(Extend, u8)> {
        let extend = match (field.count, field.is_signed) {
            (8, false) => Extend::Uxtb,
            (16, false) => Extend::Uxth,
            (32, false) => Extend::Uxtw,
            (8, true) => Extend::Sxtb,
            (16, true) => Extend::Sxth,
            (32, true) => Extend::Sxtw,
            _ => return None,
        };
        (field.first == 0 && field.to <= 4).then_some((extend, field.to))
    }

    /// A load does the extension for nothing.
    fn is_worth_folding(&self, value: Value, field: Field) -> bool {
        let moves_bits = field.first != 0 || field.to != 0;
        if moves_bits {
            self.use_count(value) == 1 || field.first == 0 && field.to <= SHORT_SHIFT
        } else {
            !matches!(self.op(field.source), Op::Load { .. }) || self.use_count(field.source) != 1
        }
    }

    pub(super) fn folded_addend(&self, value: Value) -> Option<(Addend, Value)> {
        let width = self.type_of(value).width();
        if !self.dissolves(value) {
            return None;
        }
        self.match_field(value, |field| {
            let shifted = self.shift_for(field, width);
            let form = shifted
                .map(|(op, amount)| Addend::Shifted(op, amount))
                .or_else(|| {
                    let (extend, amount) = Self::extension_for(field)?;
                    Some(Addend::Extended(extend, amount))
                })?;
            let does_something = !matches!(shifted, Some((_, 0)));
            (does_something && self.is_worth_folding(value, field)).then_some((form, field.source))
        })
    }

    pub(super) fn folded_mask(&self, value: Value) -> Option<(Mask, Value)> {
        let ty = self.type_of(value);
        let width = ty.width();
        if !self.has_one_use_nearby(value) {
            return None;
        }
        match self.op(value) {
            Op::Binary(Binary::RotateRight, [source, amount]) => {
                let amount = self.constant_amount(amount, ty)?;
                Some((Mask::Shifted(width, ShiftOp::Ror, amount), source))
            }
            Op::Binary(Binary::RotateLeft, [source, amount]) => {
                let amount = self.constant_amount(amount, ty)?.wrapping_neg() % width.bits();
                Some((Mask::Shifted(width, ShiftOp::Ror, amount), source))
            }
            _ => self.match_field(value, |field| {
                let (op, amount) = self.shift_for(field, width)?;
                (amount != 0).then_some((Mask::Shifted(width, op, amount), field.source))
            }),
        }
    }

    /// With the operands in this order.
    pub(super) fn match_add_sub(
        &self,
        op: AddSub,
        lhs: Value,
        rhs: Value,
    ) -> Matched<AddSub, Addend> {
        if let Some((op, imm)) = self
            .int_constant(rhs)
            .and_then(|constant| arithmetic_imm(op, constant))
        {
            return Matched {
                op,
                form: Addend::Imm(imm),
                lhs,
                rhs: Value::NONE,
            };
        }
        let (form, rhs) = self.folded_addend(rhs).unwrap_or((Addend::PLAIN, rhs));
        Matched { op, form, lhs, rhs }
    }

    /// Whether more is gained with `lhs` on the right.
    pub(super) fn belongs_right(&self, lhs: Value, rhs: Value) -> bool {
        match self.int_constant(rhs) {
            Some(constant) => {
                arithmetic_imm(AddSub::Add, constant).is_none() && self.folded_addend(lhs).is_some()
            }
            None if self.folded_addend(rhs).is_some() => self
                .int_constant(lhs)
                .is_some_and(|constant| arithmetic_imm(AddSub::Add, constant).is_some()),
            None => self.op(lhs).is_constant() || self.folded_addend(lhs).is_some(),
        }
    }

    pub(super) fn use_add_sub(&mut self, matched: Matched<AddSub, Addend>, rhs_role: Role) {
        match matched.form {
            Addend::Shifted(..) => self.use_or_zero(matched.lhs, Role::Use),
            // These forms have the stack pointer where others have the zero register.
            Addend::Extended(..) | Addend::Imm(_) => self.use_register(matched.lhs),
        }
        if let Some(rhs) = matched.rhs.expand() {
            self.use_or_zero(rhs, rhs_role);
        }
    }

    /// `op` does not invert. The operands are in any order.
    pub(super) fn match_logical(
        &self,
        op: Logical,
        lhs: Value,
        rhs: Value,
    ) -> Matched<Logical, Mask> {
        let width = self.type_of(lhs).width();
        let (lhs, rhs) = if self.op(lhs).is_constant() {
            (rhs, lhs)
        } else {
            (lhs, rhs)
        };
        if let Some(bits) = self.constant_bits(rhs) {
            let clears_upper_half = matches!(op, Logical::And) && bits >> 32 == 0;
            let imm = BitmaskImm::new(width, bits)
                .or_else(|| BitmaskImm::new(Width::W32, bits).filter(|_| clears_upper_half));
            if let Some(imm) = imm {
                return Matched {
                    op,
                    form: Mask::Imm(imm),
                    lhs,
                    rhs: Value::NONE,
                };
            }
        }
        let plain = Mask::Shifted(width, ShiftOp::Lsl, 0);
        for (lhs, rhs) in [(lhs, rhs), (rhs, lhs)] {
            if let Some(inner) = self.complemented(rhs) {
                let folded = self.folded_mask(inner).filter(|_| self.use_count(rhs) == 1);
                let (form, rhs) = folded.unwrap_or((plain, inner));
                let op = inverting(op);
                return Matched { op, form, lhs, rhs };
            }
        }
        for (lhs, rhs) in [(lhs, rhs), (rhs, lhs)] {
            if let Some((form, rhs)) = self.folded_mask(rhs) {
                return Matched { op, form, lhs, rhs };
            }
        }
        let form = plain;
        Matched { op, form, lhs, rhs }
    }

    pub(super) fn use_logical(&mut self, matched: Matched<Logical, Mask>) {
        self.use_or_zero(matched.lhs, Role::Use);
        if let Some(rhs) = matched.rhs.expand() {
            self.use_or_zero(rhs, Role::Use);
        }
    }

    /// For an I64, a value whose low half gives it when extended.
    fn low_half(&mut self, value: Value, sign: Sign) -> Option<Value> {
        if let Some(constant) = self.int_constant(value) {
            let fits = match sign {
                Sign::Signed => i32::try_from(constant).is_ok(),
                Sign::Unsigned => u32::try_from(constant).is_ok(),
            };
            return fits.then(|| self.intern(Type::I32, constant as u64));
        }
        let is_extension = |field: Field| {
            (field.first, field.to, field.count) == (0, 0, 32)
                && field.is_signed == (sign == Sign::Signed)
        };
        match self.match_field(value, |field| is_extension(field).then_some(field.source)) {
            Some(source) if self.dissolves(value) => Some(source),
            Some(_) => Some(value),
            None => (sign == Sign::Unsigned && self.fits_in_lower_half(value)).then_some(value),
        }
    }

    /// Factors of 32 bits that have the same product.
    pub(super) fn narrow_factors(
        &mut self,
        lhs: Value,
        rhs: Value,
    ) -> Option<(Sign, Value, Value)> {
        if self.type_of(lhs) != Type::I64 || self.op(lhs).is_constant() {
            return None;
        }
        [Sign::Signed, Sign::Unsigned].into_iter().find_map(|sign| {
            let lhs = self.low_half(lhs, sign)?;
            Some((sign, lhs, self.low_half(rhs, sign)?))
        })
    }
}
