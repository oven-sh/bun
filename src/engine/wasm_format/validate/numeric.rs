use bun_engine_asm::{Cond, FloatCond, FloatWidth, Rounding, Shift, Sign, Size, Width};

use super::{Checked, Validator, is};
use crate::ops::{FloatBinaryOp, FloatUnaryOp, IntBinaryOp, IntUnaryOp};
use crate::types::ValType;
use crate::visitor::VisitNumeric;

impl Validator<'_> {
    #[inline(always)]
    fn unary(&mut self, operand: ValType, result: ValType) -> Checked {
        if let Some([top]) = self.top()
            && *top == operand
        {
            if result != operand {
                *top = result;
            }
            return Ok(());
        }
        self.rare_unary(operand, result)
    }

    #[cold]
    #[inline(never)]
    fn rare_unary(&mut self, operand: ValType, result: ValType) -> Checked {
        let value = self.pop("unary")?;
        ensure!(is(value, operand), named, " value type mismatch");
        self.push(result)
    }

    #[inline(always)]
    fn binary(&mut self, operand: ValType, result: ValType) -> Checked {
        if let Some(top) = self.top()
            && ValType::pair(*top) == ValType::pair([operand; 2])
        {
            if result != operand {
                top[0] = result;
            }
            self.height -= 1;
            return Ok(());
        }
        self.rare_binary(operand, result)
    }

    #[cold]
    #[inline(never)]
    fn rare_binary(&mut self, operand: ValType, result: ValType) -> Checked {
        let right = self.pop("binary right")?;
        let left = self.pop("binary left")?;
        ensure!(is(left, operand), named, " left value type mismatch");
        ensure!(is(right, operand), named, " right value type mismatch");
        self.push(result)
    }

    fn wide<const N: usize>(&mut self, name: &'static str, roles: [&'static str; N]) -> Checked {
        for (value, role) in self.pop_array::<N>(name)?.into_iter().zip(roles) {
            ensure!(
                is(value, ValType::I64),
                validation,
                "{name} {role} to type {value} expected I64"
            );
        }
        self.push_all(&[ValType::I64; 2])
    }
}

#[deny(clippy::missing_trait_methods)]
impl VisitNumeric for Validator<'_> {
    #[inline(always)]
    fn i32_const(&mut self, _: i32) -> Checked {
        self.push(ValType::I32)
    }

    #[inline(always)]
    fn i64_const(&mut self, _: i64) -> Checked {
        self.push(ValType::I64)
    }

    #[inline(always)]
    fn f32_const(&mut self, _: u32) -> Checked {
        self.push(ValType::F32)
    }

    #[inline(always)]
    fn f64_const(&mut self, _: u64) -> Checked {
        self.push(ValType::F64)
    }

    #[inline(always)]
    fn int_eqz(&mut self, width: Width) -> Checked {
        self.unary(ValType::int(width), ValType::I32)
    }

    #[inline(always)]
    fn int_compare(&mut self, width: Width, _: Cond) -> Checked {
        self.binary(ValType::int(width), ValType::I32)
    }

    #[inline(always)]
    fn int_unary(&mut self, width: Width, _: IntUnaryOp) -> Checked {
        self.unary(ValType::int(width), ValType::int(width))
    }

    #[inline(always)]
    fn int_binary(&mut self, width: Width, _: IntBinaryOp) -> Checked {
        self.binary(ValType::int(width), ValType::int(width))
    }

    #[inline(always)]
    fn int_div(&mut self, width: Width, _: Sign) -> Checked {
        self.binary(ValType::int(width), ValType::int(width))
    }

    #[inline(always)]
    fn int_rem(&mut self, width: Width, _: Sign) -> Checked {
        self.binary(ValType::int(width), ValType::int(width))
    }

    #[inline(always)]
    fn int_shift(&mut self, width: Width, _: Shift) -> Checked {
        self.binary(ValType::int(width), ValType::int(width))
    }

    #[inline(always)]
    fn int_sign_extend(&mut self, width: Width, _: Size) -> Checked {
        self.unary(ValType::int(width), ValType::int(width))
    }

    #[inline(always)]
    fn float_compare(&mut self, width: FloatWidth, _: FloatCond) -> Checked {
        self.binary(ValType::float(width), ValType::I32)
    }

    #[inline(always)]
    fn float_unary(&mut self, width: FloatWidth, _: FloatUnaryOp) -> Checked {
        self.unary(ValType::float(width), ValType::float(width))
    }

    #[inline(always)]
    fn float_round(&mut self, width: FloatWidth, _: Rounding) -> Checked {
        self.unary(ValType::float(width), ValType::float(width))
    }

    #[inline(always)]
    fn float_binary(&mut self, width: FloatWidth, _: FloatBinaryOp) -> Checked {
        self.binary(ValType::float(width), ValType::float(width))
    }

    #[inline(always)]
    fn i32_wrap_i64(&mut self) -> Checked {
        self.unary(ValType::I64, ValType::I32)
    }

    #[inline(always)]
    fn i64_extend_i32(&mut self, _: Sign) -> Checked {
        self.unary(ValType::I32, ValType::I64)
    }

    #[inline(always)]
    fn truncate_float(&mut self, from: FloatWidth, _: Sign, to: Width) -> Checked {
        self.unary(ValType::float(from), ValType::int(to))
    }

    fn truncate_float_saturating(&mut self, from: FloatWidth, _: Sign, to: Width) -> Checked {
        let (value, from) = (self.pop("unary")?, ValType::float(from));
        ensure!(
            is(value, from),
            validation,
            "trunc-saturated value type mismatch. Expected: {from} but expression stack has {value}"
        );
        self.push(ValType::int(to))
    }

    #[inline(always)]
    fn convert_int_to_float(&mut self, _: Sign, from: Width, to: FloatWidth) -> Checked {
        self.unary(ValType::int(from), ValType::float(to))
    }

    #[inline(always)]
    fn f32_demote_f64(&mut self) -> Checked {
        self.unary(ValType::F64, ValType::F32)
    }

    #[inline(always)]
    fn f64_promote_f32(&mut self) -> Checked {
        self.unary(ValType::F32, ValType::F64)
    }

    #[inline(always)]
    fn reinterpret_float_as_int(&mut self, width: FloatWidth) -> Checked {
        self.unary(ValType::float(width), ValType::int(width.width()))
    }

    #[inline(always)]
    fn reinterpret_int_as_float(&mut self, width: FloatWidth) -> Checked {
        self.unary(ValType::int(width.width()), ValType::float(width))
    }

    fn i64_add128(&mut self) -> Checked {
        self.wide(
            "i64.add128/sub128",
            ["lhs_lo", "lhs_hi", "rhs_lo", "rhs_hi"],
        )
    }

    fn i64_sub128(&mut self) -> Checked {
        self.i64_add128()
    }

    fn i64_mul_wide(&mut self, _: Sign) -> Checked {
        self.wide("i64.mul_wide", ["lhs", "rhs"])
    }
}
