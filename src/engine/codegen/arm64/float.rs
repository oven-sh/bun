//! Arithmetic on floats, and conversions.

use bun_engine_asm::arm64::{Cc, FloatBinary, FloatFlags, FloatUnary, NeonBitwise};
use bun_engine_asm::{FloatWidth, Rounding, Sign, Width};

use super::comparison::{Comparison, Setter};
use super::instruction::Inst;
use crate::ir::{Binary, Op, Type, Unary, Value, evaluate};
use crate::machine::{Lowering, Place, Role};

impl Lowering<'_, Inst> {
    fn select_two_floats(&mut self, value: Value, instruction: Inst, lhs: Value, rhs: Value) {
        self.def(value);
        self.use_register(lhs);
        self.use_register(rhs);
        self.finish(instruction);
    }

    fn select_float_unary(&mut self, value: Value, op: FloatUnary, operand: Value) {
        self.def(value);
        self.use_register(operand);
        self.finish(Inst::FloatUnary(op, self.type_of(value).float_width()));
    }

    pub(super) fn select_float_binary(&mut self, value: Value, op: Binary, lhs: Value, rhs: Value) {
        let width = self.type_of(value).float_width();
        let sign = 1 << (width.width().bits() - 1);
        let op = match op {
            Binary::Add => FloatBinary::Fadd,
            Binary::Sub => FloatBinary::Fsub,
            Binary::Mul => {
                for (other, factor) in [(lhs, rhs), (rhs, lhs)] {
                    if let Some(negated) = self.negated(factor) {
                        let instruction = Inst::FloatBinary(FloatBinary::Fnmul, width);
                        return self.select_two_floats(value, instruction, other, negated);
                    }
                }
                FloatBinary::Fmul
            }
            Binary::Div => FloatBinary::Fdiv,
            Binary::Min => FloatBinary::Fmin,
            Binary::Max => FloatBinary::Fmax,
            Binary::And if self.constant_bits(rhs) == Some(sign - 1) => {
                return self.select_float_unary(value, FloatUnary::Fabs, lhs);
            }
            Binary::Xor if self.constant_bits(rhs) == Some(sign) => {
                return self.select_float_unary(value, FloatUnary::Fneg, lhs);
            }
            Binary::And | Binary::Or | Binary::Xor => {
                let op = match op {
                    Binary::And => NeonBitwise::And,
                    Binary::Or => NeonBitwise::Orr,
                    _ => NeonBitwise::Eor,
                };
                return self.select_two_floats(value, Inst::FloatBits(op), lhs, rhs);
            }
            _ => return self.select_shared(value),
        };
        self.select_two_floats(value, Inst::FloatBinary(op, width), lhs, rhs);
    }

    pub(super) fn select_float_neg(&mut self, value: Value, operand: Value) {
        if let Op::Binary(Binary::Mul, [lhs, rhs]) = self.op(operand)
            && self.has_one_use_nearby(operand)
        {
            let width = self.type_of(value).float_width();
            let instruction = Inst::FloatBinary(FloatBinary::Fnmul, width);
            return self.select_two_floats(value, instruction, lhs, rhs);
        }
        self.select_float_unary(value, FloatUnary::Fneg, operand);
    }

    pub(super) fn select_int_to_float(&mut self, value: Value, sign: Sign, operand: Value) {
        let (sign, from, operand) = match self.op(operand) {
            Op::Unary(Unary::Widen(extension), narrow)
                if !self.is_materialized(operand)
                    && (extension == Sign::Unsigned || sign == Sign::Signed) =>
            {
                (extension, Width::W32, narrow)
            }
            _ => (sign, self.type_of(operand).width(), operand),
        };
        let to = self.type_of(value).float_width();
        self.select_one_operand(value, Inst::IntToFloat(sign, from, to), operand);
    }

    pub(super) fn select_float_to_int(&mut self, value: Value, sign: Sign, operand: Value) {
        let (rounding, operand) = match self.op(operand) {
            Op::Unary(Unary::Round(rounding), inner) if self.dissolves(operand) => {
                (rounding, inner)
            }
            _ => (Rounding::TowardZero, operand),
        };
        let (from, to) = (self.type_of(operand), self.type_of(value));
        self.def(value);
        self.use_register(operand);
        self.finish(Inst::FloatToInt(
            rounding,
            from.float_width(),
            sign,
            to.width(),
        ));
    }

    pub(super) fn select_bitcast(&mut self, value: Value, operand: Value) {
        if self.select_load_as(value, operand) {
            return;
        }
        self.def(value);
        self.use_value(operand, Role::Use, Place::RegisterOrMemory);
        self.finish(Inst::Bitcast(self.type_of(value)));
    }

    pub(super) fn select_canonical_nan(&mut self, value: Value, operand: Value) {
        let nan = self.intern(Type::F64, evaluate::CANONICAL_NAN);
        let flags = FloatFlags::One(Cc::Vc);
        let instruction = Inst::SelectFloat(FloatWidth::F64, flags);
        self.select_two_floats(value, instruction, operand, nan);
        let setter = Setter::Floats(FloatWidth::F64, operand, operand);
        self.finish_comparison(Comparison { setter, flags });
    }
}
