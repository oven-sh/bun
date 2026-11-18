use bun_engine_asm::Sign;
use bun_engine_codegen::ir::{Type, Unary, Value as Ssa};
use bun_engine_number::Random;
use bun_engine_vm::{GlobalObject, Intrinsic, JsFunction, SpeculatedType as T};

use crate::builder::Builder;
use crate::builder::calls::CallSite;
use crate::graph::{ArithmeticData, ExitKind, Kind, heaps};
use crate::runtime::operations::math_function_for;

impl Builder<'_> {
    pub(super) fn math_intrinsic(&mut self, which: Intrinsic, site: &CallSite<'_>) -> Option<Ssa> {
        let arguments = &site.arguments[1..];
        if which == Intrinsic::Random {
            return self.random(site.callee);
        }
        if !self.all_expected(arguments, T::BOXED_NUMBER) || self.has_exited(ExitKind::NotANumber) {
            return None;
        }
        let exits = self.graph.site(self.origin).exits;
        let seen = ArithmeticData::of_result(self.prediction_at(site.metadata), exits);
        let kind = match (which, arguments) {
            (Intrinsic::Abs, [_, ..]) => Kind::NumberAbs,
            (Intrinsic::Floor, [_, ..]) => Kind::NumberFloor,
            (Intrinsic::Ceil, [_, ..]) => Kind::NumberCeil,
            (Intrinsic::Trunc, [_, ..]) => Kind::NumberTrunc,
            (Intrinsic::Round, [_, ..]) => Kind::NumberRound,
            (Intrinsic::Min, [_, _, ..]) => Kind::NumberMin,
            (Intrinsic::Max, [_, _, ..]) => Kind::NumberMax,
            (Intrinsic::Pow, [_, _, ..]) => {
                return Some(self.number_node(Kind::NumberPower, &arguments[..2], seen));
            }
            (Intrinsic::IMul | Intrinsic::Clz32, _) => return self.on_bits(which, arguments),
            _ => return self.on_doubles(which, arguments),
        };
        let (&first, rest) = arguments.split_first()?;
        Some(if matches!(kind, Kind::NumberMin | Kind::NumberMax) {
            let pick = |so_far, &next| self.number_node(kind, &[so_far, next], seen);
            rest.iter().fold(first, pick)
        } else {
            self.number_node(kind, &[first], seen)
        })
    }

    fn on_bits(&mut self, which: Intrinsic, arguments: &[Ssa]) -> Option<Ssa> {
        let result = match (which, arguments) {
            (Intrinsic::IMul, &[lhs, rhs, ..]) => {
                let [lhs, rhs] = [lhs, rhs].map(|it| self.truncate(it));
                self.ir().mul(lhs, rhs)
            }
            (Intrinsic::Clz32, &[operand, ..]) => {
                let bits = self.truncate(operand);
                self.ir().unary(Unary::CountLeadingZeros, bits)
            }
            _ => return None,
        };
        Some(self.box_int32(result))
    }

    fn on_doubles(&mut self, which: Intrinsic, arguments: &[Ssa]) -> Option<Ssa> {
        let result = match (which, arguments) {
            (Intrinsic::Sqrt, &[operand, ..]) => {
                let number = self.as_number(operand);
                self.ir().unary(Unary::Sqrt, number)
            }
            (Intrinsic::FRound, &[operand, ..]) => {
                let number = self.as_number(operand);
                let narrow = self.ir().convert(Unary::Demote, Type::F32, number);
                self.ir().convert(Unary::Promote, Type::F64, narrow)
            }
            (_, &[operand, ..]) => {
                let function = math_function_for(which)?;
                let number = self.as_number(operand);
                self.node(Kind::MathFunction, &[number], function)
            }
            _ => return None,
        };
        Some(self.node(Kind::BoxDouble, &[result], 0))
    }

    fn random(&mut self, callee: Ssa) -> Option<Ssa> {
        let global = self.constant_cell::<JsFunction>(callee)?.scope();
        let (global, heap) = (self.cell(global), heaps::RANDOM_STATE);
        let [low, high] = [Random::OFFSET_OF_LOW, Random::OFFSET_OF_HIGH]
            .map(|offset| (GlobalObject::OFFSET_OF_RANDOM + offset) as i32);
        let (x, y) = (
            self.load(Type::I64, global, low, heap),
            self.load(Type::I64, global, high, heap),
        );
        let mut ir = self.ir();
        let shifted = ir.shl(x, 23);
        let x = ir.xor(x, shifted);
        let shifted = ir.shr(x, 17);
        let x = ir.xor(x, shifted);
        let shifted = ir.shr(y, 26);
        let mixed = ir.xor(y, shifted);
        let x = ir.xor(x, mixed);
        let sum = ir.add(x, y);
        let bits = ir.and(sum, (1i64 << 53) - 1);
        let whole = ir.convert(Unary::IntToFloat(Sign::Signed), Type::F64, bits);
        let scale = ir.function.const_f64(1.0 / (1u64 << 53) as f64);
        let result = ir.mul(whole, scale);
        self.store(global, low, heap, y);
        self.store(global, high, heap, x);
        Some(self.profiled_node(Kind::BoxDouble, &[result], 0, T::REAL_DOUBLE))
    }
}
