//! Between tagged numbers and what arithmetic works on.

use bun_engine_asm::{Cond, FloatCond, Sign};
use bun_engine_codegen::Target;
use bun_engine_codegen::ir::{Action, Effects, Input, Op, Output, Type, Unary, Value as Ssa};
use bun_engine_vm::Value;

use super::emit::Site;
use super::{Lowering, Odds};
use crate::graph::{ExitKind, Kind, NOT_NAN};
use crate::runtime::operations;

impl Lowering<'_> {
    pub(super) fn box_int32(&mut self, int32: Ssa) -> Ssa {
        let wide = self.ir().zero_extend(int32);
        self.ir().or(wide, Value::NUMBER_TAG)
    }

    pub(super) fn box_int52(&mut self, wide: Ssa) -> Ssa {
        let mut ir = self.ir();
        let narrow = ir.wrap(wide);
        let back = ir.sign_extend(narrow);
        let fits = ir.equal(back, wide);
        self.choose(
            fits,
            Odds::Even,
            Type::I64,
            |this| this.box_int32(narrow),
            |this| {
                let number = this.int_to_double(wide);
                this.tag_double(number)
            },
        )
    }

    pub(super) fn box_double(&mut self, number: Ssa, data: u32) -> Ssa {
        let is_pure = match *self.graph.function.op(number) {
            _ if data == NOT_NAN => true,
            Op::Unary(Unary::IntToFloat(_) | Unary::CanonicalizeNan, _) => true,
            _ => self.graph.kind(number) == Some(Kind::NumberToDouble),
        };
        let number = if is_pure {
            number
        } else {
            self.ir().unary(Unary::CanonicalizeNan, number)
        };
        self.tag_double(number)
    }

    pub(super) fn tag_double(&mut self, number: Ssa) -> Ssa {
        let bits = self.ir().bitcast(number);
        self.ir().add(bits, Value::DOUBLE_OFFSET)
    }

    pub(super) fn box_boolean(&mut self, boolean: Ssa) -> Ssa {
        let wide = self.ir().zero_extend(boolean);
        self.ir().or(wide, Value::FALSE.to_bits())
    }

    pub(super) fn int_to_double(&mut self, integer: Ssa) -> Ssa {
        (self.ir()).convert(Unary::IntToFloat(Sign::Signed), Type::F64, integer)
    }

    pub(super) fn untag_double(&mut self, number: Ssa) -> Ssa {
        let bits = self.ir().sub(number, Value::DOUBLE_OFFSET);
        self.ir().bitcast(bits)
    }

    fn low_half_to_double(&mut self, value: Ssa) -> Ssa {
        let int32 = self.ir().wrap(value);
        self.int_to_double(int32)
    }

    pub(super) fn number_to_double(&mut self, number: Ssa, is_mostly_int32: bool) -> Ssa {
        let is_int32 = (self.ir()).compare(Cond::AboveEq, number, Value::NUMBER_TAG);
        let odds = if is_mostly_int32 {
            Odds::Even
        } else {
            Odds::Low
        };
        self.choose(
            is_int32,
            odds,
            Type::F64,
            |this| this.low_half_to_double(number),
            |this| this.untag_double(number),
        )
    }

    pub(super) fn primitive_to_double(&mut self, value: Ssa) -> Ssa {
        let tag = self.ir().and(value, Value::NUMBER_TAG);
        let is_number = self.ir().is_not_zero(tag);
        self.choose(
            is_number,
            Odds::Even,
            Type::F64,
            |this| this.number_to_double(value, true),
            |this| {
                // Of the others only `true` is odd.
                let bit = this.ir().and(value, 1);
                let number = this.low_half_to_double(bit);
                let nan = this.graph.function.const_f64(f64::NAN);
                let is_undefined = this.ir().equal(value, Value::UNDEFINED.to_bits());
                this.ir().select(is_undefined, nan, number)
            },
        )
    }

    pub(super) fn truncate_double(&mut self, number: Ssa) -> Ssa {
        if Target::host().has_float_to_int32_modular() {
            return (self.ir()).convert(Unary::FloatToInt32Modular, Type::I32, number);
        }
        let data = self.patchpoint(Action::Custom, Site::TruncateDouble, Effects::NONE);
        let result = (Type::I32, Output::Register);
        (self.ir()).patchpoint(&data, &[(number, Input::Register)], &[result])
    }

    /// Fractions, NaN, −0 and what does not fit come back with other bits.
    fn double_as_int(&mut self, number: Ssa, ty: Type, failure: ExitKind) -> Ssa {
        let int = (self.ir()).convert(Unary::FloatToInt(Sign::Signed), ty, number);
        let back = self.int_to_double(int);
        let mut ir = self.ir();
        let (before, after) = (ir.bitcast(number), ir.bitcast(back));
        let differs = ir.not_equal(before, after);
        self.exit_if(differs, failure);
        int
    }

    pub(super) fn double_as_int32(&mut self, number: Ssa, failure: ExitKind) -> Ssa {
        self.double_as_int(number, Type::I32, failure)
    }

    pub(super) fn double_as_index(&mut self, number: Ssa) -> Ssa {
        let int = (self.ir()).convert(Unary::FloatToInt(Sign::Signed), Type::I32, number);
        let back = self.int_to_double(int);
        let differs = (self.ir()).float_compare(FloatCond::NeOrUnordered, number, back);
        self.exit_if(differs, ExitKind::NotAnInteger);
        int
    }

    pub(super) fn double_as_int52(&mut self, number: Ssa, failure: ExitKind) -> Ssa {
        let int = self.double_as_int(number, Type::I64, failure);
        let mut ir = self.ir();
        let biased = ir.add(int, 1i64 << 51);
        let excess = ir.shr(biased, 52);
        self.exit_if(excess, failure);
        int
    }

    pub(super) fn double_remainder(&mut self, lhs: Ssa, rhs: Ssa) -> Ssa {
        self.call_leaf(operations::DOUBLE_REMAINDER, &[lhs, rhs], Type::F64)
    }
}
