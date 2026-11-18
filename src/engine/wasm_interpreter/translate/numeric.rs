//! Instructions on numbers.

use bun_engine_asm::{Cond, FloatCond, FloatWidth, Rounding, Shift, Sign, Size, Width};
use bun_engine_wasm_format::{
    FloatBinaryOp, FloatUnaryOp, IntBinaryOp, IntUnaryOp, ValKind, ValType, VisitNumeric,
};

use super::condition::{Relation, immediate};
use super::emit::Register;
use super::operands::{Input, Operand, Place, near, usual};
use super::{Done, Translator};
use crate::machine::Handler;
use crate::run::form::Form;
use crate::run::integer::{self, Binary, Unary};
use crate::run::{conversion, float};

fn int(width: Width) -> ValKind {
    ValType::int(width).kind()
}

fn float(width: FloatWidth) -> ValKind {
    ValType::float(width).kind()
}

/// What there are handlers for, beyond slots, the last result, and a second operand that fits in the record.
#[derive(Clone, Copy)]
struct Forms {
    is_commutative: bool,
    constant_first: bool,
    wide: bool,
}

impl Translator<'_> {
    /// Operands and result have the same kind.
    fn binary(&mut self, forms: Forms, handler: impl FnOnce(Form) -> Handler) -> Done {
        let (mut rhs, mut lhs) = (self.pop(), self.pop());
        let (kind, register) = (lhs.kind, Register::of(lhs.kind));
        if forms.is_commutative && lhs.constant().is_some() {
            core::mem::swap(&mut lhs, &mut rhs);
        }
        let short = |it: Operand| it.constant().and_then(|bits| immediate(kind, bits));
        if let (Some(imm), None, true) = (short(lhs), rhs.constant(), forms.constant_first) {
            let rhs = self.in_slot(rhs, 1)?;
            let form = match self.is_last(register, rhs) {
                true => Form::ImmLast,
                false => Form::ImmSlot,
            };
            return self.produce(kind, handler(form), rhs, imm);
        }
        let lhs = self.in_slot(lhs, 0)?;
        let input = match short(rhs).is_some() || forms.wide {
            true => self.input(rhs, 1)?,
            false => Input::Slot(self.in_slot(rhs, 1)?),
        };
        let (form, b, imm) = match (input, short(rhs), self.is_last(register, lhs)) {
            (_, Some(imm), false) => (Form::SlotImm, lhs, imm),
            (_, Some(imm), true) => (Form::LastImm, 0, imm),
            (Input::Constant(bits), None, is_last) => {
                let form = if is_last {
                    Form::LastWide
                } else {
                    Form::SlotWide
                };
                return self.produce_with(usual(kind), handler(form), lhs, 0, &[bits]);
            }
            (Input::Slot(rhs), None, true) => (Form::LastSlot, rhs, 0),
            (Input::Slot(rhs), None, false) if !self.is_last(register, rhs) => {
                (Form::SlotSlot, lhs, rhs.into())
            }
            (Input::Slot(_), None, false) if forms.is_commutative => (Form::LastSlot, lhs, 0),
            (Input::Slot(_), None, false) => (Form::SlotLast, lhs, 0),
        };
        self.produce(kind, handler(form), b, imm)
    }

    fn integer(&mut self, width: Width, op: Binary) -> Done {
        let forms = Forms {
            is_commutative: op.is_commutative(),
            constant_first: op.takes_constant_first(),
            wide: op.is_commutative(),
        };
        self.binary(forms, |form| integer::for_binary(width, op, form))
    }

    /// `handler` is told whether the operand is the last result of its kind.
    fn unary(&mut self, result: ValKind, handler: impl FnOnce(bool) -> Handler) -> Done {
        let (slot, is_last) = self.pop_in_slot()?;
        self.produce(result, handler(is_last), slot, 0)
    }

    pub(super) fn retype_top(&mut self, kind: ValKind) -> Done {
        self.top().kind = kind;
        Ok(())
    }

    fn is_square_of_last(&self, register: Register) -> bool {
        let [.., lhs, rhs] = self.operands[..] else {
            return false;
        };
        let is_last = |slot| near(slot, lhs.kind).is_some_and(|slot| self.is_last(register, slot));
        matches!(lhs.place, Place::Local(slot) if rhs.place == lhs.place && is_last(slot))
    }

    /// With two results, in the places of the first operands.
    fn wide_arithmetic(&mut self, handler: Handler, operands: usize) -> Done {
        let first = self.pop_settled(operands)?;
        self.emit(handler, 0, 0, first)?;
        self.forget_last_results();
        self.push_all(&[ValType::I64; 2]);
        Ok(())
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitNumeric for Translator<'_> {
    fn i32_const(&mut self, value: i32) -> Done {
        self.push_constant(ValKind::I32, (value as u32).into())
    }

    fn i64_const(&mut self, value: i64) -> Done {
        self.push_constant(ValKind::I64, value as u64)
    }

    fn f32_const(&mut self, bits: u32) -> Done {
        self.push_constant(ValKind::F32, bits.into())
    }

    fn f64_const(&mut self, bits: u64) -> Done {
        self.push_constant(ValKind::F64, bits)
    }

    fn int_eqz(&mut self, width: Width) -> Done {
        if let Some(condition) = self.pop_comparison() {
            return self.compare_again(condition.inverted());
        }
        let value = self.pop();
        let place = Place::Constant(0);
        self.compare(
            Relation::Int(width, Cond::Eq),
            value,
            Operand { place, ..value },
        )
    }

    fn int_compare(&mut self, width: Width, cond: Cond) -> Done {
        let (rhs, lhs) = (self.pop(), self.pop());
        self.compare(Relation::Int(width, cond), lhs, rhs)
    }

    fn int_unary(&mut self, width: Width, op: IntUnaryOp) -> Done {
        self.unary(int(width), |is_last| {
            integer::for_unary(width, op.into(), is_last)
        })
    }

    fn int_binary(&mut self, width: Width, op: IntBinaryOp) -> Done {
        let op = match op {
            IntBinaryOp::Add => Binary::Add,
            IntBinaryOp::Sub => Binary::Sub,
            IntBinaryOp::Mul => Binary::Mul,
            IntBinaryOp::And => Binary::And,
            IntBinaryOp::Or => Binary::Or,
            IntBinaryOp::Xor => Binary::Xor,
        };
        self.integer(width, op)
    }

    fn int_div(&mut self, width: Width, sign: Sign) -> Done {
        match sign {
            Sign::Signed => self.integer(width, Binary::DivS),
            Sign::Unsigned => self.integer(width, Binary::DivU),
        }
    }

    fn int_rem(&mut self, width: Width, sign: Sign) -> Done {
        match sign {
            Sign::Signed => self.integer(width, Binary::RemS),
            Sign::Unsigned => self.integer(width, Binary::RemU),
        }
    }

    fn int_shift(&mut self, width: Width, shift: Shift) -> Done {
        let op = match shift {
            Shift::Left => Binary::Shl,
            Shift::RightLogical => Binary::ShrU,
            Shift::RightArithmetic => Binary::ShrS,
            Shift::RotateLeft => Binary::Rotl,
            Shift::RotateRight => Binary::Rotr,
        };
        self.integer(width, op)
    }

    fn int_sign_extend(&mut self, width: Width, from: Size) -> Done {
        let op = Unary::sign_extending(from);
        self.unary(int(width), |is_last| integer::for_unary(width, op, is_last))
    }

    fn float_compare(&mut self, width: FloatWidth, cond: FloatCond) -> Done {
        let (rhs, lhs) = (self.pop(), self.pop());
        self.compare(Relation::Float(width, cond), lhs, rhs)
    }

    fn float_unary(&mut self, width: FloatWidth, op: FloatUnaryOp) -> Done {
        self.unary(float(width), |is_last| float::for_unary(width, op, is_last))
    }

    fn float_round(&mut self, width: FloatWidth, rounding: Rounding) -> Done {
        self.unary(float(width), |is_last| {
            float::for_round(width, rounding, is_last)
        })
    }

    fn float_binary(&mut self, width: FloatWidth, op: FloatBinaryOp) -> Done {
        use FloatBinaryOp::{Add, Copysign, Div, Max, Min, Mul, Sub};
        if let Min | Max | Copysign = op {
            let [lhs, rhs] = self.pop_in_slots()?;
            return self.produce(
                float(width),
                float::for_selection(width, op),
                lhs,
                rhs.into(),
            );
        }
        if op == Mul && self.is_square_of_last(Register::of(float(width))) {
            self.truncate(self.operands.len() - 2);
            return self.produce(float(width), float::for_square(width), 0, 0);
        }
        let forms = Forms {
            is_commutative: matches!(op, Add | Mul),
            constant_first: matches!(op, Sub | Div),
            wide: true,
        };
        self.binary(forms, |form| float::for_arithmetic(width, op, form))
    }

    fn i32_wrap_i64(&mut self) -> Done {
        if let Place::Constant(bits) = &mut self.top().place {
            *bits &= u64::from(u32::MAX);
            return self.retype_top(ValKind::I32);
        }
        self.unary(ValKind::I32, integer::for_wrap)
    }

    fn i64_extend_i32(&mut self, sign: Sign) -> Done {
        match sign {
            Sign::Signed => self.int_sign_extend(Width::W64, Size::S32),
            Sign::Unsigned => self.retype_top(ValKind::I64),
        }
    }

    fn truncate_float(&mut self, from: FloatWidth, sign: Sign, to: Width) -> Done {
        self.unary(int(to), |is_last| {
            conversion::for_truncate(from, sign, to, is_last)
        })
    }

    fn truncate_float_saturating(&mut self, from: FloatWidth, sign: Sign, to: Width) -> Done {
        self.unary(int(to), |is_last| {
            conversion::for_saturate(from, sign, to, is_last)
        })
    }

    fn convert_int_to_float(&mut self, sign: Sign, from: Width, to: FloatWidth) -> Done {
        self.unary(float(to), |is_last| {
            conversion::for_convert(sign, from, to, is_last)
        })
    }

    fn f32_demote_f64(&mut self) -> Done {
        self.unary(ValKind::F32, conversion::for_demote)
    }

    fn f64_promote_f32(&mut self) -> Done {
        self.unary(ValKind::F64, conversion::for_promote)
    }

    fn reinterpret_float_as_int(&mut self, width: FloatWidth) -> Done {
        self.retype_top(int(width.width()))
    }

    fn reinterpret_int_as_float(&mut self, width: FloatWidth) -> Done {
        self.retype_top(float(width))
    }

    fn i64_add128(&mut self) -> Done {
        self.wide_arithmetic(integer::add_or_sub128::<true>, 4)
    }

    fn i64_sub128(&mut self) -> Done {
        self.wide_arithmetic(integer::add_or_sub128::<false>, 4)
    }

    fn i64_mul_wide(&mut self, sign: Sign) -> Done {
        self.wide_arithmetic(integer::for_mul_wide(sign), 2)
    }
}
