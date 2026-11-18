use bun_engine_codegen::ir::{Binary, Checked, Unary, Value as Ssa};

use super::Specializer;
use crate::graph::{ExitKind, Format, Kind};
use crate::passes::unbox_params::format_for;
use crate::passes::usage::Use;

const INT52_SHIFT: i32 = 12;

impl Specializer<'_> {
    fn format(&self) -> Format {
        format_for(self.graph.prediction(self.at))
    }

    fn uses(&self, what: Use) -> bool {
        self.usage.of(self.at).contains(what)
    }

    fn doubles(&mut self, lhs: Ssa, rhs: Ssa) -> [Ssa; 2] {
        [lhs, rhs].map(|operand| self.as_double(operand, ExitKind::NotANumber))
    }

    #[cfg_attr(debug_assertions, track_caller)]
    fn checked(&mut self, op: Checked, lhs: Ssa, rhs: Ssa, failure: ExitKind) -> Ssa {
        let exit = self.exit(failure);
        self.ir().checked(op, lhs, rhs, exit)
    }

    fn check_fits_int52(&mut self, value: Ssa) {
        let mut ir = self.ir();
        let biased = ir.add(value, 1i64 << 51);
        let excess = ir.shr(biased, 52);
        self.exit_if(excess, ExitKind::Int52Overflow);
    }

    /// The result is zero, and `sign` is negative.
    fn check_not_negative_zero(&mut self, result: Ssa, sign: Ssa) {
        let mut ir = self.ir();
        let (is_zero, is_negative) = (ir.is_zero(result), ir.less_than(sign, 0));
        let both = ir.and(is_zero, is_negative);
        self.exit_if(both, ExitKind::NegativeZero);
    }

    fn check_sign_of_product(&mut self, product: Ssa, lhs: Ssa, rhs: Ssa) {
        let is_positive = |factor| {
            self.graph
                .function
                .int_constant(factor)
                .is_some_and(|constant| constant > 0)
        };
        if self.uses(Use::SIGN_OF_ZERO) && lhs != rhs && !is_positive(lhs) && !is_positive(rhs) {
            let either = self.ir().or(lhs, rhs);
            self.check_not_negative_zero(product, either);
        }
    }

    pub(super) fn add_or_multiply(&mut self, kind: Kind, lhs: Ssa, rhs: Ssa) -> Ssa {
        let (plain, checked) = match kind {
            Kind::NumberAdd => (Binary::Add, Checked::Add),
            Kind::NumberSubtract => (Binary::Sub, Checked::Sub),
            _ => (Binary::Mul, Checked::Mul),
        };
        match self.format() {
            Format::Int32 => {
                let [lhs, rhs] =
                    [lhs, rhs].map(|operand| self.as_int32(operand, ExitKind::BadType));
                let result = if self.uses(Use::AS_NUMBER) || checked == Checked::Mul {
                    self.checked(checked, lhs, rhs, ExitKind::Overflow)
                } else {
                    self.ir().binary(plain, lhs, rhs)
                };
                if checked == Checked::Mul {
                    self.check_sign_of_product(result, lhs, rhs);
                }
                self.boxed(Kind::BoxInt32, result)
            }
            Format::Int52 => {
                let [lhs, rhs] =
                    [lhs, rhs].map(|operand| self.as_int52(operand, ExitKind::Int52Overflow));
                let result = if checked == Checked::Mul {
                    let shifted = self.ir().shl(lhs, INT52_SHIFT);
                    let product = self.checked(checked, shifted, rhs, ExitKind::Int52Overflow);
                    let product = self.ir().sar(product, INT52_SHIFT);
                    self.check_sign_of_product(product, lhs, rhs);
                    product
                } else {
                    let result = self.ir().binary(plain, lhs, rhs);
                    self.check_fits_int52(result);
                    result
                };
                self.boxed(Kind::BoxInt52, result)
            }
            _ => {
                let [lhs, rhs] = self.doubles(lhs, rhs);
                let result = self.ir().binary(plain, lhs, rhs);
                self.boxed(Kind::BoxDouble, result)
            }
        }
    }

    /// Exits where the instruction for division would fault.
    fn check_division(&mut self, lhs: Ssa, rhs: Ssa) {
        if self
            .graph
            .function
            .int_constant(rhs)
            .is_some_and(|constant| constant != 0 && constant != -1)
        {
            return;
        }
        let is_zero = self.ir().is_zero(rhs);
        self.exit_if(is_zero, ExitKind::Overflow);
        let mut ir = self.ir();
        let (is_least, is_minus_one) = (ir.equal(lhs, i32::MIN), ir.equal(rhs, -1));
        let both = ir.and(is_least, is_minus_one);
        self.exit_if(both, ExitKind::Overflow);
    }

    pub(super) fn divide(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        if self.format() != Format::Int32 {
            let [lhs, rhs] = self.doubles(lhs, rhs);
            let result = self.ir().binary(Binary::Div, lhs, rhs);
            return self.boxed(Kind::BoxDouble, result);
        }
        let [lhs, rhs] = [lhs, rhs].map(|operand| self.as_int32(operand, ExitKind::BadType));
        if !self.uses(Use::AS_NUMBER) && !self.uses(Use::NON_INTEGER) {
            let quotient = self.ir().binary(Binary::TotalDiv, lhs, rhs);
            return self.boxed(Kind::BoxInt32, quotient);
        }
        self.check_division(lhs, rhs);
        if self.uses(Use::SIGN_OF_ZERO) {
            self.check_not_negative_zero(lhs, rhs);
        }
        let mut ir = self.ir();
        let quotient = ir.binary(Binary::Div, lhs, rhs);
        let back = ir.mul(quotient, rhs);
        let is_inexact = ir.not_equal(back, lhs);
        self.exit_if(is_inexact, ExitKind::NotAnInteger);
        self.boxed(Kind::BoxInt32, quotient)
    }

    pub(super) fn remainder(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        if self.format() != Format::Int32 {
            let operands = self.doubles(lhs, rhs);
            let result = self.node(Kind::DoubleRemainder, &operands, 0);
            return self.boxed(Kind::BoxDouble, result);
        }
        let [lhs, rhs] = [lhs, rhs].map(|operand| self.as_int32(operand, ExitKind::BadType));
        if !self.uses(Use::AS_NUMBER) && !self.uses(Use::NON_INTEGER) {
            let result = self.ir().binary(Binary::TotalRem, lhs, rhs);
            return self.boxed(Kind::BoxInt32, result);
        }
        self.check_division(lhs, rhs);
        let result = self.ir().binary(Binary::Rem, lhs, rhs);
        if self.uses(Use::SIGN_OF_ZERO) {
            self.check_not_negative_zero(result, lhs);
        }
        self.boxed(Kind::BoxInt32, result)
    }

    pub(super) fn negate(&mut self, operand: Ssa) -> Ssa {
        let (int, kind) = match self.format() {
            Format::Int32 => (self.as_int32(operand, ExitKind::BadType), Kind::BoxInt32),
            Format::Int52 => (
                self.as_int52(operand, ExitKind::Int52Overflow),
                Kind::BoxInt52,
            ),
            _ => {
                let double = self.as_double(operand, ExitKind::NotANumber);
                let result = self.ir().unary(Unary::Neg, double);
                return self.boxed(Kind::BoxDouble, result);
            }
        };
        if self.uses(Use::SIGN_OF_ZERO) {
            let is_zero = self.ir().is_zero(int);
            self.exit_if(is_zero, ExitKind::NegativeZero);
        }
        let result = if kind == Kind::BoxInt32 && self.uses(Use::AS_NUMBER) {
            let zero = self.graph.function.const32(0);
            self.checked(Checked::Sub, zero, int, ExitKind::Overflow)
        } else {
            self.ir().unary(Unary::Neg, int)
        };
        if kind == Kind::BoxInt52 {
            self.check_fits_int52(result);
        }
        self.boxed(kind, result)
    }
}
