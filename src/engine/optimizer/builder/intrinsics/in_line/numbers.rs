use bun_engine_asm::{FloatCond, Rounding, Sign};
use bun_engine_codegen::ir::{Type, Unary, Value as Ssa};
use bun_engine_number::MAX_SAFE_INTEGER;
use bun_engine_vm::direct::Form;
use bun_engine_vm::{SpeculatedType as T, Value};

use super::Checked;
use crate::builder::Builder;
use crate::graph::ExitKind;

type Test<'a> = fn(&mut Builder<'a>, Ssa) -> Ssa;

impl<'a> Builder<'a> {
    pub(super) fn number_in_line(&mut self, call: Checked<'_>) -> Option<Ssa> {
        use Form::*;
        let &first = call.passed.first()?;
        let answer = match call.form {
            number_is_nan | is_nan_of_number => self.is_nan(first),
            number_is_finite | is_finite_of_number => self.is_finite(first),
            number_is_integer => self.is_integer(first),
            number_is_safe_integer => self.is_safe_integer(first),
            value_is_nan => self.is_nan_value(first),
            value_is_finite => self.is_int32_or(first, Self::is_finite),
            value_is_integer => self.is_int32_or(first, Self::is_integer),
            value_is_safe_integer => self.is_int32_or(first, Self::is_safe_integer),
            _ => return self.number_from(call, first),
        };
        Some(self.box_boolean(answer))
    }

    fn number_from(&mut self, call: Checked<'_>, first: Ssa) -> Option<Ssa> {
        use Form::*;
        let zero = self.graph.function.const_f64(0.0);
        Some(match call.form {
            parse_int_of_number => return self.parse_int_of_number(call),
            parse_float_of_number => {
                let result = self.ir().add(first, zero);
                self.box_result(result, T::FULL_DOUBLE, call.seen)
            }
            to_integer_or_infinity_of_number => {
                let whole = self.toward_zero(first);
                let mut ir = self.ir();
                let (whole, is_number) = (
                    ir.add(whole, zero),
                    ir.float_compare(FloatCond::Eq, first, first),
                );
                let result = ir.select(is_number, whole, zero);
                self.box_result(result, T::REAL_DOUBLE, call.seen)
            }
            to_length_of_int32 => {
                let none = self.int32(0);
                let is_negative = self.ir().less_than(first, 0);
                let result = self.ir().select(is_negative, none, first);
                self.box_int32(result)
            }
            sign_of_int32 => {
                let mut ir = self.ir();
                let (above, below) = (ir.greater_than(first, 0), ir.less_than(first, 0));
                let result = ir.sub(above, below);
                self.box_int32(result)
            }
            _ => return None,
        })
    }

    pub(super) fn toward_zero(&mut self, number: Ssa) -> Ssa {
        self.ir().unary(Unary::Round(Rounding::TowardZero), number)
    }

    /// Anything less an infinity or NaN is NaN or infinite.
    fn equals_finitely(&mut self, number: Ssa, other: Ssa) -> Ssa {
        let mut ir = self.ir();
        let (difference, zero) = (ir.sub(number, other), ir.const_f64(0.0));
        ir.float_compare(FloatCond::Eq, difference, zero)
    }

    fn is_finite(&mut self, number: Ssa) -> Ssa {
        self.equals_finitely(number, number)
    }

    fn is_integer(&mut self, number: Ssa) -> Ssa {
        let whole = self.toward_zero(number);
        self.equals_finitely(number, whole)
    }

    pub(super) fn is_within(&mut self, number: Ssa, cond: FloatCond, limit: f64) -> Ssa {
        let mut ir = self.ir();
        let (magnitude, limit) = (ir.unary(Unary::Abs, number), ir.const_f64(limit));
        ir.float_compare(cond, magnitude, limit)
    }

    fn is_safe_integer(&mut self, number: Ssa) -> Ssa {
        let whole = self.toward_zero(number);
        let is_whole = self.ir().float_compare(FloatCond::Eq, number, whole);
        let is_safe = self.is_within(number, FloatCond::Le, MAX_SAFE_INTEGER);
        self.ir().and(is_whole, is_safe)
    }

    fn is_nan(&mut self, number: Ssa) -> Ssa {
        (self.ir()).float_compare(FloatCond::NeOrUnordered, number, number)
    }

    fn is_nan_value(&mut self, value: Ssa) -> Ssa {
        let bits = self.ir().sub(value, Value::DOUBLE_OFFSET);
        let is_double = (self.ir()).below(bits, Value::NUMBER_TAG - Value::DOUBLE_OFFSET);
        let double = self.ir().bitcast(bits);
        let is_nan = self.is_nan(double);
        self.ir().and(is_double, is_nan)
    }

    /// What is no double has the bits of a NaN once it is taken for one, which fails the test.
    fn is_int32_or(&mut self, value: Ssa, test_double: Test<'a>) -> Ssa {
        let bits = self.ir().sub(value, Value::DOUBLE_OFFSET);
        let double = self.ir().bitcast(bits);
        let holds = test_double(self, double);
        let is_int32 = self.ir().above_or_equal(value, Value::NUMBER_TAG);
        self.ir().or(is_int32, holds)
    }

    fn parse_int_of_number(&mut self, call: Checked<'_>) -> Option<Ssa> {
        /// What is less is written with an exponent.
        const LEAST_PLAIN: f64 = 1e-6;
        let radix = self.graph.function.int_constant(call.passed[1]);
        if !matches!(radix, Some(0 | 10))
            || !T::INT32.contains(call.seen)
            || self.has_exited(ExitKind::Overflow)
        {
            return None;
        }
        let number = call.passed[0];
        let fits = self.is_within(number, FloatCond::Lt, -f64::from(i32::MIN));
        let is_large = self.not(fits);
        self.exit_if(is_large, ExitKind::Overflow);
        let mut ir = self.ir();
        let whole = ir.convert(Unary::FloatToInt(Sign::Signed), Type::I32, number);
        let (least, zero) = (ir.const_f64(LEAST_PLAIN), ir.const_f64(0.0));
        let (is_fraction, is_low, is_not_zero) = (
            ir.is_zero(whole),
            ir.float_compare(FloatCond::Lt, number, least),
            ir.float_compare(FloatCond::NeOrUnordered, number, zero),
        );
        let is_odd = ir.and(is_fraction, is_low);
        let is_odd = ir.and(is_odd, is_not_zero);
        self.exit_if(is_odd, ExitKind::Overflow);
        Some(self.box_int32(whole))
    }
}
