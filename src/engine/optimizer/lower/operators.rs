//! Operators and conversions whose operands are of several types.

use bun_engine_asm::{FloatCond, Sign};
use bun_engine_codegen::ir::{Binary, Type, Unary, Value as Ssa};
use bun_engine_vm::{CellType, SpeculatedType as T};
use smallvec::SmallVec;

use super::truth::Left;
use super::ways::Detour;
use super::{Lowering, Odds};
use crate::graph::{Conversion, InLine, Operator, TypeCheck};
use crate::runtime::operators;

impl Lowering<'_> {
    pub(super) fn bigint_operator(&mut self, operator: u32) -> Ssa {
        let operands = self.operands();
        self.call_operation(
            operators::on_bigints(Operator::from_data(operator)),
            &operands,
        )
    }

    fn operate_on_int32(
        &mut self,
        operator: Operator,
        operands: &[Ssa],
        slow: &mut Detour,
    ) -> Option<Ssa> {
        let low: SmallVec<[Ssa; 2]> = operands.iter().map(|&it| self.ir().wrap(it)).collect();
        let bits = |this: &mut Self, op| {
            let bits = this.ir().binary(op, low[0], low[1]);
            this.box_int32(bits)
        };
        let wide = |this: &mut Self, op, rhs: Option<i64>| {
            let lhs = this.ir().sign_extend(low[0]);
            let rhs = match rhs {
                Some(constant) => this.word(constant as u64),
                None => this.ir().sign_extend(low[1]),
            };
            this.ir().binary(op, lhs, rhs)
        };
        let exact = match operator {
            Operator::BitAnd => return Some(bits(self, Binary::And)),
            Operator::BitOr => return Some(bits(self, Binary::Or)),
            Operator::BitXor => return Some(bits(self, Binary::Xor)),
            Operator::ShiftLeft => return Some(bits(self, Binary::Shl)),
            Operator::ShiftRight => return Some(bits(self, Binary::Sar)),
            Operator::ShiftRightUnsignedBits => return Some(bits(self, Binary::Shr)),
            Operator::BitNot => {
                let bits = self.ir().xor(low[0], -1);
                return Some(self.box_int32(bits));
            }
            Operator::ToNumber | Operator::ToNumeric => return Some(operands[0]),
            Operator::Divide | Operator::Remainder | Operator::Exponentiate => return None,
            Operator::ShiftRightUnsigned => {
                let bits = self.ir().shr(low[0], low[1]);
                self.ir().zero_extend(bits)
            }
            Operator::Add => wide(self, Binary::Add, None),
            Operator::Subtract => wide(self, Binary::Sub, None),
            Operator::Increment => wide(self, Binary::Add, Some(1)),
            Operator::Decrement => wide(self, Binary::Add, Some(-1)),
            Operator::Multiply | Operator::Negate => {
                let by = (operator == Operator::Negate).then_some(-1);
                let product = wide(self, Binary::Mul, by);
                let has_sign_to_find = self.ir().is_zero(product);
                self.detour_if(has_sign_to_find, Odds::Low, slow);
                product
            }
        };
        Some(self.box_int52(exact))
    }

    fn on_doubles(operator: Operator) -> Option<(Binary, Option<f64>)> {
        Some(match operator {
            Operator::Add => (Binary::Add, None),
            Operator::Subtract => (Binary::Sub, None),
            Operator::Multiply => (Binary::Mul, None),
            Operator::Divide => (Binary::Div, None),
            Operator::Increment => (Binary::Add, Some(1.0)),
            Operator::Decrement => (Binary::Add, Some(-1.0)),
            Operator::Negate => (Binary::Mul, Some(-1.0)),
            _ => return None,
        })
    }

    pub(super) fn operator(&mut self, data: u32) -> Ssa {
        let ((operator, in_line), operands) = (InLine::split(data), self.operands());
        let operator = Operator::from_data(operator);
        let (meeting, mut slow) = (self.part(Type::I64), Detour::default());
        let keeps_numbers = matches!(operator, Operator::ToNumber | Operator::ToNumeric);
        if in_line.contains(InLine::INT32) && !keeps_numbers {
            let (are_int32, mut int32) = (self.are_int32(&operands), Detour::default());
            self.detour_if(are_int32, Odds::Even, &mut int32);
            let rest = self.open;
            if self.follow(int32) {
                match self.operate_on_int32(operator, &operands, &mut slow) {
                    Some(result) => self.give(meeting, result),
                    None => self.take_detour(&mut slow),
                }
            }
            self.open = rest;
        }
        let on_doubles = Self::on_doubles(operator).filter(|_| in_line.contains(InLine::NUMBERS));
        if keeps_numbers && in_line.intersects(InLine::INT32 | InLine::NUMBERS) {
            self.detour_unless_number(operands[0], Odds::Even, &mut slow);
            self.give(meeting, operands[0]);
        } else if let Some((op, constant)) = on_doubles {
            (operands.iter()).for_each(|&it| self.detour_unless_number(it, Odds::Even, &mut slow));
            let lhs = self.number_to_double(operands[0], true);
            let rhs = match constant {
                Some(constant) => self.graph.function.const_f64(constant),
                None => self.number_to_double(operands[1], true),
            };
            let result = self.ir().binary(op, lhs, rhs);
            let result = self.box_double(result, 0);
            self.give(meeting, result);
        } else {
            self.take_detour(&mut slow);
        }
        self.meet_after(meeting, slow, |this| {
            this.call_operation(operators::on_anything(operator), &operands)
        })
    }

    pub(super) fn convert(&mut self, value: Ssa, conversion: u32) -> Ssa {
        let conversion = Conversion::from_data(conversion);
        let is_done = self.has_type(value, conversion.fixed(), T::HEAP_TOP);
        self.unless(is_done, value, |this| {
            this.call_operation(operators::conversion(conversion), &[value])
        })
    }

    pub(super) fn to_object(&mut self, value: Ssa, message: Ssa) -> Ssa {
        let is_object = self.has_type(value, T::OBJECT, T::HEAP_TOP);
        self.unless(is_object, value, |this| {
            this.call_operation(operators::TO_OBJECT, &[value, message])
        })
    }

    pub(super) fn to_this(&mut self, value: Ssa, global_this: Ssa) -> Ssa {
        let (meeting, mut slow) = (self.part(Type::I64), Detour::default());
        let is_nullish = self.has_type(value, T::NULLISH, T::HEAP_TOP);
        self.give_if(meeting, is_nullish, Odds::Even, |_| global_this);
        let is_immediate = self.has_type(value, !T::CELL, T::HEAP_TOP);
        self.detour_if(is_immediate, Odds::Low, &mut slow);
        let cell_type = self.cell_type(value);
        let is_primitive = self.ir().below(cell_type, i32::from(CellType::Object.0));
        self.detour_if(is_primitive, Odds::Low, &mut slow);
        let is_global = (self.ir()).equal(cell_type, i32::from(CellType::GlobalObject.0));
        let this = self.ir().select(is_global, global_this, value);
        self.give(meeting, this);
        self.meet_after(meeting, slow, |this| {
            this.call_operation(operators::TO_THIS, &[value])
        })
    }

    pub(super) fn exact_int32(&mut self, value: Ssa, check: TypeCheck) -> Ssa {
        const NONE: u64 = 1 << 32;
        let (meeting, mut left) = (self.part(Type::I64), Left::of(check));
        let of_int32 = |this: &mut Self, _| {
            let low = this.ir().wrap(value);
            this.ir().sign_extend(low)
        };
        let of_double = |this: &mut Self, _| {
            let number = this.untag_double(value);
            let int32 = (this.ir()).convert(Unary::FloatToInt(Sign::Signed), Type::I32, number);
            let (back, none) = (this.int_to_double(int32), this.word(NONE));
            let mut ir = this.ir();
            let is_exact = ir.float_compare(FloatCond::Eq, back, number);
            let wide = ir.sign_extend(int32);
            ir.select(is_exact, wide, none)
        };
        if !self.give_for(meeting, value, &mut left, T::INT32, of_int32)
            && !self.give_for(meeting, value, &mut left, T::BOXED_DOUBLE, of_double)
        {
            let none = self.word(NONE);
            self.give(meeting, none);
        }
        self.meet(meeting)
    }
}
