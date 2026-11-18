use bun_engine_asm::{Cond, FloatCond, Sign};
use bun_engine_codegen::ir::{Type, Unary, Value as Ssa};
use bun_engine_vm::{SpeculatedType as T, Value};

use super::Specializer;
use crate::graph::{AS_INDEX, ExitKind, Format, IntegerRange, Kind, ON_EDGE};
use crate::passes::unbox_params::{converts_freely, evident_format, promised_format};
use crate::passes::usage::Use;

impl Specializer<'_> {
    pub(super) fn conversion_failure(&self, data: u32) -> ExitKind {
        match data {
            ON_EDGE => ExitKind::BadRepresentation,
            AS_INDEX => ExitKind::NotAnInteger,
            _ => ExitKind::BadType,
        }
    }

    pub(super) fn constant_number(&self, value: Ssa) -> Option<f64> {
        let bits = self.graph.constant(value)?;
        if bits >= Value::NUMBER_TAG {
            Some((bits as i32).into())
        } else {
            (bits >= Value::DOUBLE_OFFSET).then(|| f64::from_bits(bits - Value::DOUBLE_OFFSET))
        }
    }

    pub(super) fn boxed(&mut self, kind: Kind, unboxed: Ssa) -> Ssa {
        let boxed = self.node(kind, &[unboxed], 0);
        self.graph.predict(boxed, self.graph.prediction(self.at));
        boxed
    }

    fn int_to_double(&mut self, int: Ssa) -> Ssa {
        self.ir()
            .convert(Unary::IntToFloat(Sign::Signed), Type::F64, int)
    }

    pub(super) fn as_int32(&mut self, value: Ssa, failure: ExitKind) -> Ssa {
        let root = self.graph.root(value);
        if let Some(known) = self
            .knowledge
            .get(root)
            .and_then(|known| known.int32.expand())
        {
            return known;
        }
        let exact = self
            .constant_number(root)
            .filter(|&number| f64::from(number as i32).to_bits() == number.to_bits());
        if let Some(number) = exact {
            return self.graph.function.const32(number as i32);
        }
        let int32 = match self.graph.kind(root) {
            Some(Kind::BoxInt32) => return self.graph.operand(root, 0),
            Some(Kind::BoxInt52) => {
                let wide = self.graph.operand(root, 0);
                let mut ir = self.ir();
                let narrow = ir.wrap(wide);
                let back = ir.sign_extend(narrow);
                let differs = ir.not_equal(back, wide);
                self.exit_if(differs, failure);
                narrow
            }
            Some(Kind::BoxDouble) => {
                let double = self.graph.operand(root, 0);
                self.node(Kind::DoubleAsInt32, &[double], failure as u32)
            }
            _ if !T::INT32.contains(self.expected(root))
                && T::BOXED_NUMBER.contains(self.expected(root)) =>
            {
                let double = self.as_double(root, failure);
                return self.node(Kind::DoubleAsInt32, &[double], failure as u32);
            }
            _ => {
                let checked = self.check_type(root, T::INT32, failure);
                self.ir().wrap(checked)
            }
        };
        self.knowledge.entry(self.graph, root).int32 = int32;
        int32
    }

    /// −0 becomes 0.
    pub(super) fn as_index(&mut self, value: Ssa) -> Ssa {
        let (failure, expected) = (ExitKind::NotAnInteger, self.expected(value));
        let known = self.knowledge.get(self.graph.root(value));
        let is_double = match self.graph.kind(self.graph.root(value)) {
            _ if known.is_some_and(|known| !known.int32.is_none()) => false,
            Some(Kind::BoxInt32 | Kind::BoxInt52) => false,
            Some(Kind::BoxDouble) => true,
            _ => !T::INT32.contains(expected) && T::BOXED_NUMBER.contains(expected),
        };
        if !is_double {
            return self.as_int32(value, failure);
        }
        let double = self.as_double(value, failure);
        self.node(Kind::DoubleAsIndex, &[double], 0)
    }

    pub(super) fn as_int52(&mut self, value: Ssa, failure: ExitKind) -> Ssa {
        let root = self.graph.root(value);
        if let Some(number) = self
            .constant_number(root)
            .and_then(bun_engine_number::exact_int52)
        {
            return self.graph.function.const64(number);
        }
        match self.graph.kind(root) {
            Some(Kind::BoxInt52) => self.graph.operand(root, 0),
            _ if self.is(root, T::INT32) || T::INT32.contains(self.expected(root)) => {
                let int32 = self.as_int32(root, failure);
                self.ir().sign_extend(int32)
            }
            _ => {
                let double = self.as_double(root, failure);
                self.node(Kind::DoubleAsInt52, &[double], failure as u32)
            }
        }
    }

    pub(super) fn as_double(&mut self, value: Ssa, failure: ExitKind) -> Ssa {
        let root = self.graph.root(value);
        if let Some(known) = self
            .knowledge
            .get(root)
            .and_then(|known| known.double.expand())
        {
            return known;
        }
        if let Some(number) = self.constant_number(root) {
            return self.graph.function.const_f64(number);
        }
        let double = match self.graph.kind(root) {
            Some(Kind::BoxDouble) => return self.graph.operand(root, 0),
            Some(Kind::BoxInt32 | Kind::BoxInt52) => {
                self.int_to_double(self.graph.operand(root, 0))
            }
            _ if self.is(root, T::INT32) => {
                let int32 = self.as_int32(root, failure);
                self.int_to_double(int32)
            }
            _ => {
                let number = self.check_type(root, T::BOXED_NUMBER, failure);
                let is_mostly_int32 = T::INT32.contains(self.expected(root));
                self.node(Kind::NumberToDouble, &[number], is_mostly_int32.into())
            }
        };
        self.knowledge.entry(self.graph, root).double = double;
        double
    }

    pub(super) fn as_boolean(&mut self, value: Ssa, failure: ExitKind) -> Ssa {
        let root = self.graph.root(value);
        if let Some(bits) = self
            .graph
            .constant(root)
            .filter(|_| self.is(root, T::BOOLEAN))
        {
            return self.graph.function.const32(bits as i32 & 1);
        }
        self.graph
            .inside(root, Kind::BoxBoolean)
            .unwrap_or_else(|| {
                let checked = self.check_type(root, T::BOOLEAN, failure);
                let mut ir = self.ir();
                let low = ir.wrap(checked);
                ir.and(low, 1)
            })
    }

    /// ToNumber of what converts without running scripts or reading text.
    pub(super) fn to_double(&mut self, value: Ssa) -> Ssa {
        if T::FULL_NUMBER.contains(self.expected(value)) && !self.has_exited(ExitKind::NotANumber) {
            return self.as_double(value, ExitKind::NotANumber);
        }
        let primitive = self.check_type(
            value,
            T::BOXED_NUMBER | T::BOOLEAN | T::NULLISH,
            ExitKind::ExoticObject,
        );
        self.node(Kind::PrimitiveToDouble, &[primitive], 0)
    }

    /// What replaces the node, in the form that other passes have counted on.
    pub(super) fn as_promised(&mut self, result: Ssa) -> Ssa {
        let Some(promised) = promised_format(self.graph, self.at) else {
            return result;
        };
        let evident = evident_format(self.graph, self.graph.root(result));
        if evident.is_some_and(|it| converts_freely(it, promised)) {
            return result;
        }
        let (kind, unboxed) = match promised {
            Format::Int32 => (Kind::BoxInt32, self.as_int32(result, ExitKind::Overflow)),
            Format::Int52 => (
                Kind::BoxInt52,
                self.as_int52(result, ExitKind::Int52Overflow),
            ),
            _ => (
                Kind::BoxDouble,
                self.as_double(result, ExitKind::NotANumber),
            ),
        };
        self.boxed(kind, unboxed)
    }

    pub(super) fn quiet_to_number(&mut self, value: Ssa) -> Ssa {
        if self.is(value, T::BOXED_NUMBER) {
            return value;
        }
        if !T::INT32.contains(self.graph.prediction(self.at)) {
            let quiet = T::BOXED_NUMBER | T::BOOLEAN | T::NULLISH;
            let checked = self.check_type(value, quiet, ExitKind::ExoticObject);
            let double = self.node(Kind::PrimitiveToDouble, &[checked], 0);
            return self.boxed(Kind::BoxDouble, double);
        }
        let int32 = self.quiet_to_int32(value, T::NULL);
        self.boxed(Kind::BoxInt32, int32)
    }

    /// Of an int32, a boolean, or those of undefined and null that may become zero.
    fn quiet_to_int32(&mut self, value: Ssa, zeros: T) -> Ssa {
        let checked = self.check_type(value, T::INT32 | T::BOOLEAN | zeros, ExitKind::Mixed);
        let may_be_int32 = self.type_of(value).intersects(T::INT32);
        let mut ir = self.ir();
        let low = ir.wrap(checked);
        // Of the others only `true` is odd.
        let bit = ir.and(low, 1);
        if !may_be_int32 {
            return bit;
        }
        let is_int32 = ir.compare(Cond::AboveEq, checked, Value::NUMBER_TAG);
        ir.select(is_int32, low, bit)
    }

    pub(super) fn truncate(&mut self, value: Ssa) -> Ssa {
        let (root, may_speculate) = (self.graph.root(value), !self.has_exited(ExitKind::BadType));
        if let Some(number) = self.constant_number(root) {
            return self
                .graph
                .function
                .const32(bun_engine_number::to_int32(number));
        }
        if let Some(wide) = self.graph.inside(root, Kind::BoxInt52) {
            return self.ir().wrap(wide);
        }
        if self.is(root, T::INT32) || may_speculate && T::INT32.contains(self.expected(root)) {
            return self.as_int32(root, ExitKind::BadType);
        }
        if self.is(root, T::BOOLEAN) || may_speculate && T::BOOLEAN.contains(self.expected(root)) {
            return self.as_boolean(root, ExitKind::BadType);
        }
        let expected = self.expected(root);
        if (T::INT32 | T::BOOLEAN | T::NULLISH).contains(expected)
            && !T::INT32.contains(expected)
            && !self.has_exited(ExitKind::Mixed)
        {
            return self.quiet_to_int32(root, T::NULLISH);
        }
        let double = self.to_double(root);
        self.node(Kind::TruncateDouble, &[double], 0)
    }

    pub(super) fn clamp(&mut self, value: Ssa) -> Ssa {
        const INTEGER_IN_LOW_BITS: f64 = (1u64 << 52) as f64;
        let may_speculate = !self.has_exited(ExitKind::BadType);
        if self.is(value, T::INT32) || may_speculate && T::INT32.contains(self.expected(value)) {
            let int32 = self.as_int32(value, ExitKind::BadType);
            let mut ir = self.ir();
            let (sign, is_outside) = (ir.sar(int32, 31), ir.above(int32, 255));
            let limit = ir.xor(sign, -1);
            return ir.select(is_outside, limit, int32);
        }
        let number = self.to_double(value);
        let mut ir = self.ir();
        let [least, greatest, bias] = [0.0, 255.0, INTEGER_IN_LOW_BITS].map(|it| ir.const_f64(it));
        let is_above = ir.float_compare(FloatCond::Gt, number, least);
        let number = ir.select(is_above, number, least);
        let is_below = ir.float_compare(FloatCond::Lt, number, greatest);
        let number = ir.select(is_below, number, greatest);
        let rounded = ir.add(number, bias);
        let bits = ir.bitcast(rounded);
        ir.wrap(bits)
    }

    pub(super) fn truncate_in_range(&mut self, value: Ssa, range: u32) -> Ssa {
        let (range, failure) = (IntegerRange::from_data(range), ExitKind::ExoticObject);
        let (least, greatest) = (range.least(), range.greatest());
        if let Some(wide) = (self.graph).inside(self.graph.root(value), Kind::BoxInt52) {
            let mut ir = self.ir();
            let distance = ir.sub(wide, least);
            let is_outside = ir.above(distance, greatest - least);
            self.exit_if(is_outside, failure);
            return self.ir().wrap(wide);
        }
        let may_speculate = !self.has_exited(ExitKind::BadType);
        if self.is(value, T::INT32) || may_speculate && T::INT32.contains(self.expected(value)) {
            let int32 = self.as_int32(value, ExitKind::BadType);
            let mut ir = self.ir();
            let distance = ir.sub(int32, least as i32);
            let is_outside = ir.above(distance, (greatest.min(i32::MAX.into()) - least) as u32);
            if greatest - least < u32::MAX.into() || least == 0 {
                self.exit_if(is_outside, failure);
            }
            return int32;
        }
        let number = self.as_double(value, failure);
        for (cond, limit) in [(FloatCond::LtOrUnordered, least), (FloatCond::Gt, greatest)] {
            let limit = self.graph.function.const_f64(limit as f64);
            let is_outside = self.ir().float_compare(cond, number, limit);
            self.exit_if(is_outside, failure);
        }
        self.node(Kind::TruncateDouble, &[number], 0)
    }

    pub(super) fn uint32_to_number(&mut self, bits: Ssa) -> Ssa {
        if !T::INT32.contains(self.graph.prediction(self.at)) {
            let wide = self.ir().zero_extend(bits);
            return self.boxed(Kind::BoxInt52, wide);
        }
        if self.usage.of(self.at).contains(Use::AS_NUMBER) {
            let is_large = self.ir().compare(Cond::Lt, bits, 0);
            self.exit_if(is_large, ExitKind::Overflow);
        }
        self.boxed(Kind::BoxInt32, bits)
    }
}
