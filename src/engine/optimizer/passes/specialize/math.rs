use bun_engine_asm::{Cond, FloatCond, Rounding};
use bun_engine_codegen::ir::{Binary, Unary, Value as Ssa};
use bun_engine_number::exact_int32;
use bun_engine_number::math::MAX_EXPONENT_BY_SQUARING;
use bun_engine_vm::SpeculatedType as T;

use super::Specializer;
use crate::graph::{ExitKind, Kind};
use crate::passes::usage::Use;

impl Specializer<'_> {
    fn gives_int32(&self) -> bool {
        let prediction = self.graph.prediction(self.at);
        !prediction.is_empty() && T::INT32.contains(prediction)
    }

    pub(super) fn abs(&mut self, operand: Ssa) -> Ssa {
        if !self.gives_int32() {
            let number = self.as_double(operand, ExitKind::NotANumber);
            let result = self.ir().unary(Unary::Abs, number);
            return self.boxed(Kind::BoxDouble, result);
        }
        let int32 = self.as_int32(operand, ExitKind::BadType);
        let mut ir = self.ir();
        let sign = ir.sar(int32, 31);
        let flipped = ir.xor(int32, sign);
        let result = ir.sub(flipped, sign);
        if self.usage.of(self.at).contains(Use::AS_NUMBER) {
            let is_too_large = self.ir().less_than(result, 0);
            self.exit_if(is_too_large, ExitKind::Overflow);
        }
        self.boxed(Kind::BoxInt32, result)
    }

    pub(super) fn min_or_max(&mut self, kind: Kind, lhs: Ssa, rhs: Ssa) -> Ssa {
        let (cond, op) = match kind {
            Kind::NumberMin => (Cond::Lt, Binary::Min),
            _ => (Cond::Gt, Binary::Max),
        };
        if self.gives_int32() {
            let [lhs, rhs] = [lhs, rhs].map(|it| self.as_int32(it, ExitKind::BadType));
            let takes_first = self.ir().compare(cond, lhs, rhs);
            let result = self.ir().select(takes_first, lhs, rhs);
            return self.boxed(Kind::BoxInt32, result);
        }
        let [lhs, rhs] = [lhs, rhs].map(|it| self.as_double(it, ExitKind::NotANumber));
        let result = self.ir().binary(op, lhs, rhs);
        self.boxed(Kind::BoxDouble, result)
    }

    /// The multiplications are those of `math::pow`, but for the ones by 1.
    fn power_by_squaring(&mut self, mut base: Ssa, mut exponent: i32) -> Ssa {
        let mut result = None;
        while exponent != 0 {
            if exponent & 1 != 0 {
                result = Some(result.map_or(base, |so_far| self.ir().mul(so_far, base)));
            }
            exponent >>= 1;
            if exponent != 0 {
                base = self.ir().mul(base, base);
            }
        }
        result.unwrap_or_else(|| self.graph.function.const_f64(1.0))
    }

    pub(super) fn power(&mut self, base: Ssa, exponent: Ssa) -> Ssa {
        let constant = self.constant_number(self.graph.root(exponent));
        let operands = [base, exponent].map(|it| self.as_double(it, ExitKind::NotANumber));
        let result = match constant.and_then(exact_int32) {
            Some(small @ 0..=MAX_EXPONENT_BY_SQUARING) => {
                self.power_by_squaring(operands[0], small)
            }
            _ => self.node(Kind::DoublePower, &operands, 0),
        };
        if !self.gives_int32() {
            return self.boxed(Kind::BoxDouble, result);
        }
        let int32 = self.node(Kind::DoubleAsInt32, &[result], ExitKind::Overflow as u32);
        self.boxed(Kind::BoxInt32, int32)
    }

    /// To the nearest integer, and up from the middle.
    fn round_half_up(&mut self, number: Ssa) -> Ssa {
        let [half, one] = [0.5, 1.0].map(|it| self.graph.function.const_f64(it));
        let mut ir = self.ir();
        let above = ir.unary(Unary::Round(Rounding::Up), number);
        let (middle, below) = (ir.sub(above, half), ir.sub(above, one));
        let goes_down = ir.float_compare(FloatCond::Gt, middle, number);
        ir.select(goes_down, below, above)
    }

    pub(super) fn round(&mut self, kind: Kind, operand: Ssa) -> Ssa {
        let may_speculate = !self.has_exited(ExitKind::BadType);
        if self.is(operand, T::INT32) || may_speculate && T::INT32.contains(self.expected(operand))
        {
            let int32 = self.as_int32(operand, ExitKind::BadType);
            return self.boxed(Kind::BoxInt32, int32);
        }
        let number = self.as_double(operand, ExitKind::NotANumber);
        let mut rounded = match kind {
            Kind::NumberFloor => self.ir().unary(Unary::Round(Rounding::Down), number),
            Kind::NumberCeil => self.ir().unary(Unary::Round(Rounding::Up), number),
            Kind::NumberTrunc => self.ir().unary(Unary::Round(Rounding::TowardZero), number),
            _ => self.round_half_up(number),
        };
        if !self.gives_int32() {
            return self.boxed(Kind::BoxDouble, rounded);
        }
        if !self.usage.of(self.at).contains(Use::SIGN_OF_ZERO) {
            let zero = self.graph.function.const_f64(0.0);
            rounded = self.ir().add(rounded, zero);
        }
        let int32 = self.node(Kind::DoubleAsInt32, &[rounded], ExitKind::Overflow as u32);
        self.boxed(Kind::BoxInt32, int32)
    }
}
