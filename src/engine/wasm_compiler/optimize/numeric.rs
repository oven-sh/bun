//! Arithmetic, comparisons and conversions.

use bun_engine_asm::{Cond, FloatCond, FloatWidth, Rounding, Shift, Sign, Size, Width};
use bun_engine_codegen::ir::{
    Action, Binary, EffectFlags, Effects, Input, Output, PatchpointData, Type, Unary, Value, Wide,
    evaluate,
};
use bun_engine_wasm_format::{
    FloatBinaryOp, FloatUnaryOp, IntBinaryOp, IntUnaryOp, ValType, VisitNumeric,
};

use super::emit::Site;
use super::translator::{Translator, Visited, ir_type};
use crate::abi::Trap;

impl Translator<'_> {
    #[inline]
    fn convert(&mut self, op: Unary, to: ValType) -> Visited {
        let operand = self.pop_value();
        let result = self.b.convert(op, ir_type(to), operand);
        self.push(result, to);
        Ok(())
    }

    #[inline]
    fn binary(&mut self, op: Binary, ty: ValType) -> Visited {
        let [lhs, rhs] = self.pop_values();
        let result = self.b.binary(op, lhs, rhs);
        self.push(result, ty);
        Ok(())
    }

    /// `result` is new, or a constant.
    #[inline]
    pub(super) fn push_comparison(&mut self, result: Value) {
        if !self.b.op(result).is_constant() {
            self.unused_comparison = result;
        }
        self.push(result, ValType::I32);
    }

    fn wide(&mut self, op: Wide) -> Visited {
        let [lhs_low, lhs_high, rhs_low, rhs_high] = self.pop_values();
        let halves = self.b.wide(op, [lhs_low, lhs_high], [rhs_low, rhs_high]);
        self.push_halves(halves)
    }

    fn push_halves(&mut self, [low, high]: [Value; 2]) -> Visited {
        self.push(low, ValType::I64);
        self.push(high, ValType::I64);
        Ok(())
    }

    fn check_divisor(&mut self, divisor: Value) {
        let is_zero = self.b.is_zero(divisor);
        self.trap_if(is_zero, Trap::DivisionByZero);
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitNumeric for Translator<'_> {
    #[inline]
    fn i32_const(&mut self, value: i32) -> Visited {
        let value = self.b.const32(value);
        self.push(value, ValType::I32);
        Ok(())
    }

    fn i64_const(&mut self, value: i64) -> Visited {
        let value = self.b.const64(value);
        self.push(value, ValType::I64);
        Ok(())
    }

    fn f32_const(&mut self, bits: u32) -> Visited {
        let value = self.b.constant(Type::F32, bits.into());
        self.push(value, ValType::F32);
        Ok(())
    }

    fn f64_const(&mut self, bits: u64) -> Visited {
        let value = self.b.constant(Type::F64, bits);
        self.push(value, ValType::F64);
        Ok(())
    }

    fn int_eqz(&mut self, _: Width) -> Visited {
        let operand = self.pop_value();
        let result = self.b.is_zero(operand);
        self.note_negation(operand, result);
        self.push_comparison(result);
        Ok(())
    }

    fn int_compare(&mut self, _: Width, cond: Cond) -> Visited {
        let [lhs, rhs] = self.pop_values();
        let result = self.b.compare(cond, lhs, rhs);
        self.push_comparison(result);
        Ok(())
    }

    fn int_unary(&mut self, width: Width, op: IntUnaryOp) -> Visited {
        let op = match op {
            IntUnaryOp::Clz => Unary::CountLeadingZeros,
            IntUnaryOp::Ctz => Unary::CountTrailingZeros,
            IntUnaryOp::Popcnt => Unary::CountOnes,
        };
        self.convert(op, ValType::int(width))
    }

    #[inline]
    fn int_binary(&mut self, width: Width, op: IntBinaryOp) -> Visited {
        let op = match op {
            IntBinaryOp::Add => Binary::Add,
            IntBinaryOp::Sub => Binary::Sub,
            IntBinaryOp::Mul => Binary::Mul,
            IntBinaryOp::And => Binary::And,
            IntBinaryOp::Or => Binary::Or,
            IntBinaryOp::Xor => Binary::Xor,
        };
        self.binary(op, ValType::int(width))
    }

    fn int_div(&mut self, width: Width, sign: Sign) -> Visited {
        let [lhs, rhs] = self.pop_values();
        self.check_divisor(rhs);
        let op = match sign {
            Sign::Unsigned => Binary::UnsignedDiv,
            Sign::Signed => {
                let negates = self.b.equal(rhs, -1);
                if !self.b.is_int_constant(negates, 0) {
                    let is_least = self.b.equal(lhs, 1u64 << (width.bits() - 1));
                    let overflows = self.b.and(is_least, negates);
                    self.trap_if(overflows, Trap::IntegerOverflow);
                }
                Binary::Div
            }
        };
        let result = self.b.binary(op, lhs, rhs);
        self.push(result, ValType::int(width));
        Ok(())
    }

    fn int_rem(&mut self, width: Width, sign: Sign) -> Visited {
        let [lhs, rhs] = self.pop_values();
        self.check_divisor(rhs);
        let result = match sign {
            Sign::Unsigned => self.b.binary(Binary::UnsignedRem, lhs, rhs),
            Sign::Signed => {
                // The quotient by -1 may not fit.
                let (negates, one) = (self.b.equal(rhs, -1), self.b.constant(width.into(), 1));
                let divisor = self.b.select(negates, one, rhs);
                self.b.binary(Binary::Rem, lhs, divisor)
            }
        };
        self.push(result, ValType::int(width));
        Ok(())
    }

    fn int_shift(&mut self, width: Width, shift: Shift) -> Visited {
        let [value, mut amount] = self.pop_values();
        if width == Width::W64 {
            amount = self.b.wrap(amount);
        }
        let op = match shift {
            Shift::Left => Binary::Shl,
            Shift::RightLogical => Binary::Shr,
            Shift::RightArithmetic => Binary::Sar,
            Shift::RotateLeft => Binary::RotateLeft,
            Shift::RotateRight => Binary::RotateRight,
        };
        let result = self.b.binary(op, value, amount);
        self.push(result, ValType::int(width));
        Ok(())
    }

    fn int_sign_extend(&mut self, width: Width, from: Size) -> Visited {
        if from == Size::S32 {
            self.i32_wrap_i64()?;
            return self.i64_extend_i32(Sign::Signed);
        }
        self.convert(Unary::SignExtend(from), ValType::int(width))
    }

    fn float_compare(&mut self, _: FloatWidth, cond: FloatCond) -> Visited {
        let [lhs, rhs] = self.pop_values();
        let result = self.b.float_compare(cond, lhs, rhs);
        self.push_comparison(result);
        Ok(())
    }

    fn float_unary(&mut self, width: FloatWidth, op: FloatUnaryOp) -> Visited {
        let op = match op {
            FloatUnaryOp::Abs => Unary::Abs,
            FloatUnaryOp::Neg => Unary::Neg,
            FloatUnaryOp::Sqrt => Unary::Sqrt,
        };
        self.convert(op, ValType::float(width))
    }

    fn float_round(&mut self, width: FloatWidth, rounding: Rounding) -> Visited {
        self.convert(Unary::Round(rounding), ValType::float(width))
    }

    fn float_binary(&mut self, width: FloatWidth, op: FloatBinaryOp) -> Visited {
        let op = match op {
            FloatBinaryOp::Add => Binary::Add,
            FloatBinaryOp::Sub => Binary::Sub,
            FloatBinaryOp::Mul => Binary::Mul,
            FloatBinaryOp::Div => Binary::Div,
            FloatBinaryOp::Min => Binary::Min,
            FloatBinaryOp::Max => Binary::Max,
            FloatBinaryOp::Copysign => Binary::CopySign,
        };
        self.binary(op, ValType::float(width))
    }

    fn i32_wrap_i64(&mut self) -> Visited {
        let operand = self.pop_value();
        let result = self.b.wrap(operand);
        self.push(result, ValType::I32);
        Ok(())
    }

    fn i64_extend_i32(&mut self, sign: Sign) -> Visited {
        self.convert(Unary::Widen(sign), ValType::I64)
    }

    fn truncate_float(&mut self, from: FloatWidth, sign: Sign, to: Width) -> Visited {
        let operand = self.pop_value();
        let result = if let Some(bits) = self.b.constant_bits(operand) {
            let result = evaluate::unary(Unary::FloatToInt(sign), from.into(), to.into(), bits);
            if result.is_none() {
                self.trap(Trap::TruncationOutOfRange);
            }
            self.b.constant(to.into(), result.unwrap_or(0))
        } else {
            let token = self.sites.add(Site::Truncate { from, sign, to });
            let effects = Effects::with_flags(EffectFlags::EXITS);
            let mut data = PatchpointData::new(Action::Custom, token, effects);
            data.scratch_gprs = (cfg!(target_arch = "x86_64") && to == Width::W32).into();
            let results = [(to.into(), Output::Register)];
            (self.b).patchpoint(&data, &[(operand, Input::Register)], &results)
        };
        self.push(result, ValType::int(to));
        Ok(())
    }

    fn truncate_float_saturating(&mut self, _: FloatWidth, sign: Sign, to: Width) -> Visited {
        self.convert(Unary::FloatToIntSaturating(sign), ValType::int(to))
    }

    fn convert_int_to_float(&mut self, sign: Sign, _: Width, to: FloatWidth) -> Visited {
        self.convert(Unary::IntToFloat(sign), ValType::float(to))
    }

    fn f32_demote_f64(&mut self) -> Visited {
        self.convert(Unary::Demote, ValType::F32)
    }

    fn f64_promote_f32(&mut self) -> Visited {
        self.convert(Unary::Promote, ValType::F64)
    }

    fn reinterpret_float_as_int(&mut self, width: FloatWidth) -> Visited {
        self.convert(Unary::Bitcast, ValType::int(width.width()))
    }

    fn reinterpret_int_as_float(&mut self, width: FloatWidth) -> Visited {
        self.convert(Unary::Bitcast, ValType::float(width))
    }

    fn i64_add128(&mut self) -> Visited {
        self.wide(Wide::Add)
    }

    fn i64_sub128(&mut self) -> Visited {
        self.wide(Wide::Sub)
    }

    fn i64_mul_wide(&mut self, sign: Sign) -> Visited {
        let [lhs, rhs] = self.pop_values();
        let halves = self.b.mul_wide(sign, lhs, rhs);
        self.push_halves(halves)
    }
}
