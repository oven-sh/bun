//! Arithmetic of floats, and conversions to and from them.

use bun_engine_asm::{Rounding, Sign};

use super::Simplifier;
use super::facts::{Facts, all_ones, sign_bit};
use super::rewrite::Step;
use crate::ir::Binary::{Add, And, CopySign, Div, Max, Min, Mul, Or, Sub, Xor};
use crate::ir::Unary::{
    Abs, Bitcast, CanonicalizeNan, Demote, FloatToInt, FloatToInt32Modular, FloatToIntSaturating,
    HalfBitsToFloat, IntToFloat, Neg, Promote, Round, Sqrt, Widen,
};
use crate::ir::{Binary, Op, Type, Unary, Value, evaluate};

const DEPTH: u32 = 4;

pub(super) fn number(ty: Type, bits: u64) -> f64 {
    if ty == Type::F32 {
        f32::from_bits(bits as u32).into()
    } else {
        f64::from_bits(bits)
    }
}

fn bits_of(ty: Type, number: f64) -> u64 {
    if ty == Type::F32 {
        (number as f32).to_bits().into()
    } else {
        number.to_bits()
    }
}

/// All integers up to it have a float of the type.
fn last_consecutive_integer(ty: Type) -> i64 {
    if ty == Type::F32 { 1 << 24 } else { 1 << 53 }
}

impl Simplifier<'_> {
    pub(super) fn float(&self, value: Value) -> Option<f64> {
        Some(number(self.type_of(value), self.bits(value)?))
    }

    /// At least the absolute value, which is then neither infinite nor NaN.
    fn magnitude(&self, value: Value, depth: u32) -> Option<f64> {
        /// Leaves room for rounding in 32 bits.
        const GREATEST: f64 = 1e36;
        let of = |operand| self.magnitude(operand, depth.checked_sub(1)?);
        let limit = match self.op(value) {
            Op::ConstF32(_) | Op::ConstF64(_) => self.float(value)?.abs(),
            Op::Unary(IntToFloat(_), x) => 2f64.powi(self.type_of(x).width().bits().into()),
            Op::Unary(Neg | Abs | Promote | Demote | CanonicalizeNan, x)
            | Op::Binary(CopySign, [x, _]) => of(x)?,
            Op::Unary(Round(_), x) => of(x)? + 1.0,
            Op::Binary(Add | Sub, [x, y]) => of(x)? + of(y)?,
            Op::Binary(Mul, [x, y]) => of(x)? * of(y)?,
            Op::Binary(Min | Max, [x, y]) | Op::Select([_, x, y]) => of(x)?.max(of(y)?),
            _ => return None,
        };
        (limit <= GREATEST).then_some(limit)
    }

    pub(super) fn is_never_nan(&self, value: Value) -> bool {
        self.float(value).map_or_else(
            || self.magnitude(value, DEPTH).is_some(),
            |number| !number.is_nan(),
        )
    }

    fn is_never_signaling(&self, value: Value, depth: u32) -> bool {
        let is = |operand| depth != 0 && self.is_never_signaling(operand, depth - 1);
        match self.op(value) {
            Op::ConstF32(bits) => !f32::from_bits(bits).is_nan() || bits >> 22 & 1 != 0,
            Op::ConstF64(bits) => !f64::from_bits(bits.get()).is_nan() || bits.get() >> 51 & 1 != 0,
            Op::Binary(Add | Sub | Mul | Div | Min | Max, _) => true,
            Op::Unary(
                Sqrt | Round(_) | Promote | Demote | IntToFloat(_) | HalfBitsToFloat
                | CanonicalizeNan,
                _,
            ) => true,
            Op::Unary(Neg | Abs, x) | Op::Binary(CopySign, [x, _]) => is(x),
            Op::Select([_, x, y]) => is(x) && is(y),
            _ => false,
        }
    }

    /// Arithmetic that gives its operand back can be left out.
    pub(super) fn needs_no_quieting(&self, value: Value) -> bool {
        !self.function.quiets_nans || self.is_never_signaling(value, DEPTH)
    }

    fn is_never_negative_zero(&self, value: Value) -> bool {
        match self.op(value) {
            Op::Unary(IntToFloat(_) | Abs, _) => true,
            Op::Binary(Add, [_, zero]) => self.bits(zero) == Some(0),
            _ => false,
        }
    }

    /// The integer that has the value of the float, and how to read it.
    pub(super) fn exact_integer(&mut self, value: Value) -> Option<(Value, Sign)> {
        let Op::Unary(IntToFloat(sign), x) = self.op(value) else {
            return None;
        };
        let (facts, limit) = (self.facts(x), last_consecutive_integer(self.type_of(value)));
        let fits = match sign {
            Sign::Signed => facts.is_within(-limit, limit),
            Sign::Unsigned => facts.unsigned_range(self.type_of(x).width()).1 <= limit as u64,
        };
        fits.then_some((x, sign))
    }

    pub(super) fn make_i64(&mut self, (value, sign): (Value, Sign)) -> Value {
        if self.type_of(value) == Type::I32 {
            self.make_widen(sign, value)
        } else {
            value
        }
    }

    pub(super) fn float_unary(&mut self, op: Unary, ty: Type, a: Value) -> Step {
        match (op, self.op(a)) {
            (Bitcast, _) => self.bitcast(ty, a),
            (Neg, Op::Unary(Neg, x)) => self.is(x),
            (Neg, Op::Binary(inner @ (Mul | Div), [x, c]))
                if self.once(a)
                    && let Some(c) = self.bits(c) =>
            {
                let negated = self.constant(ty, c ^ sign_bit(ty.width()));
                self.to_binary(inner, x, negated)
            }
            (Abs, Op::Unary(Abs | IntToFloat(Sign::Unsigned), _)) => self.is(a),
            (Abs, Op::Unary(IntToFloat(_), x)) if self.is_not_negative(x) => self.is(a),
            (Abs, Op::Unary(Neg, x) | Op::Binary(CopySign, [x, _])) => self.to_unary(Abs, x),
            (Abs, Op::Unary(Bitcast, x)) if self.once(a) => {
                let cleared = self.make_binary_int(And, x, (all_ones(ty.width()) >> 1) as i64);
                self.to_unary(Bitcast, cleared)
            }
            (Round(_), Op::Unary(Round(_) | IntToFloat(_), _)) => self.is(a),
            (Demote, Op::Unary(Promote, x)) if self.needs_no_quieting(x) => self.is(x),
            (Demote, _)
                if self.once(a)
                    && let Some(step) = self.compute_narrow(a) =>
            {
                step
            }
            (Promote | Demote, Op::Unary(convert @ IntToFloat(_), x))
                if self.exact_integer(a).is_some() =>
            {
                self.to_unary(convert, x)
            }
            (IntToFloat(sign), Op::Unary(Widen(from), x))
                if from == sign || from == Sign::Unsigned =>
            {
                self.to_unary(IntToFloat(from), x)
            }
            (IntToFloat(Sign::Unsigned), _) if self.is_not_negative(a) => {
                self.to_unary(IntToFloat(Sign::Signed), a)
            }
            (HalfBitsToFloat, _) if let Some(stripped) = self.strip_above(a, 16) => {
                self.to_unary(op, stripped)
            }
            (CanonicalizeNan, Op::Unary(CanonicalizeNan, _)) => self.is(a),
            (CanonicalizeNan, _) if self.is_never_nan(a) => self.is(a),
            (FloatToInt(_) | FloatToIntSaturating(_) | FloatToInt32Modular, _) => {
                self.float_to_int(op, ty, a)
            }
            _ => Step::Keep,
        }
    }

    /// The float of 32 bits that has the same value.
    fn narrow_form(&mut self, value: Value) -> Option<Value> {
        self.as_unary(Promote, value).or_else(|| {
            let wide = self.float(value)?;
            let narrow = Some(wide as f32).filter(|&narrow| f64::from(narrow) == wide)?;
            Some(self.constant(Type::F32, narrow.to_bits().into()))
        })
    }

    /// Of a value that is demoted. Rounding twice does no harm, see [`evaluate`].
    fn compute_narrow(&mut self, wide: Value) -> Option<Step> {
        Some(match self.op(wide) {
            Op::Binary(op @ (Add | Sub | Mul | Div | Min | Max), [x, y]) => {
                let (x, y) = (self.narrow_form(x)?, self.narrow_form(y)?);
                self.to_binary(op, x, y)
            }
            Op::Unary(op @ (Sqrt | Round(_)), x) => {
                let x = self.narrow_form(x)?;
                self.to_unary(op, x)
            }
            Op::Unary(op @ (Neg | Abs), x) => {
                let x = self.make_unary(Demote, Type::F32, x);
                self.to_unary(op, x)
            }
            Op::Select([condition, x, y]) => {
                let is_narrow = self.narrow_form(x).is_some() || self.narrow_form(y).is_some();
                let [x, y] = is_narrow
                    .then(|| [x, y].map(|wide| self.make_unary(Demote, Type::F32, wide)))?;
                self.to_select(condition, x, y)
            }
            _ => return None,
        })
    }

    fn float_to_int(&mut self, op: Unary, ty: Type, a: Value) -> Step {
        match self.op(a) {
            Op::Unary(CanonicalizeNan | Round(Rounding::TowardZero), x) => {
                return self.to_unary(op, x);
            }
            Op::Unary(Promote, x) if op != FloatToInt32Modular => return self.to_unary(op, x),
            _ => {}
        }
        let Some(integer) = self.exact_integer(a) else {
            return Step::Keep;
        };
        let wide = self.make_i64(integer);
        if let FloatToIntSaturating(sign) = op {
            let fitting = Facts::of_size(bun_engine_asm::Width::W64, ty.width().size(), sign);
            let min = if sign == Sign::Unsigned {
                0
            } else {
                fitting.min
            };
            if !self.facts(wide).is_within(min, fitting.max) {
                return Step::Keep;
            }
        }
        if ty == Type::I32 {
            self.to_unary(Unary::Wrap, wide)
        } else {
            self.is(wide)
        }
    }

    pub(super) fn float_binary(&mut self, op: Binary, ty: Type, a: Value, b: Value) -> Step {
        match op {
            And | Or | Xor => return self.float_bitwise(op, ty, a, b),
            CopySign => return self.copy_sign(ty, a, b),
            _ => {}
        }
        for operand in [a, b] {
            if let Some(bits) = self.bits(operand)
                && number(ty, bits).is_nan()
            {
                return self.is_bits(ty, evaluate::binary(Add, ty, bits, bits).unwrap());
            }
        }
        if let Some(bits) = self.bits(b) {
            return self.float_with_constant(op, ty, a, b, bits);
        }
        match (op, self.op(a), self.op(b)) {
            (Add, Op::Unary(Neg, x), _) => self.to_binary(Sub, b, x),
            (Add, _, Op::Unary(Neg, y)) => self.to_binary(Sub, a, y),
            (Sub, _, Op::Unary(Neg, y)) => self.to_binary(Add, a, y),
            (Sub, ..)
                if self.bits(a) == Some(sign_bit(ty.width())) && self.needs_no_quieting(b) =>
            {
                self.to_unary(Neg, b)
            }
            (Mul | Div, Op::Unary(Neg, x), Op::Unary(Neg, y)) => self.to_binary(op, x, y),
            (Mul, Op::Unary(Abs, x), _) if a == b => self.to_binary(Mul, x, x),
            (Min | Max, ..) if a == b && self.needs_no_quieting(a) => self.is(a),
            (Add | Sub, Op::Unary(IntToFloat(_), _), Op::Unary(IntToFloat(_), _))
                if self.once(a) && self.once(b) && a != b =>
            {
                let (Some(x), Some(y)) = (self.exact_integer(a), self.exact_integer(b)) else {
                    return Step::Keep;
                };
                let (x, y) = (self.make_i64(x), self.make_i64(y));
                let exact = self.make_binary(op, x, y);
                self.to_unary(IntToFloat(Sign::Signed), exact)
            }
            _ => Step::Keep,
        }
    }

    /// Which is not NaN.
    fn float_with_constant(&mut self, op: Binary, ty: Type, a: Value, b: Value, bits: u64) -> Step {
        let (c, sign) = (number(ty, bits), sign_bit(ty.width()));
        let is_neutral = match op {
            Add => bits == sign || bits == 0 && self.is_never_negative_zero(a),
            Mul | Div => c == 1.0,
            Min => c == f64::INFINITY,
            Max => c == f64::NEG_INFINITY,
            _ => false,
        };
        if is_neutral && self.needs_no_quieting(a) {
            return self.is(a);
        }
        match op {
            Sub => {
                let negated = self.constant(ty, bits ^ sign);
                self.to_binary(Add, a, negated)
            }
            Mul | Div if let Some(x) = self.as_unary(Neg, a) => {
                let negated = self.constant(ty, bits ^ sign);
                self.to_binary(op, x, negated)
            }
            Mul if c == 2.0 => self.to_binary(Add, a, a),
            Mul if c == -1.0 => {
                let negative_zero = self.constant(ty, sign);
                self.to_binary(Sub, negative_zero, a)
            }
            Div => {
                let reciprocal = bits_of(ty, 1.0 / c);
                let fraction = (1 << if ty == Type::F32 { 23 } else { 52 }) - 1;
                let is_normal = |bits: u64| bits & !sign > fraction && number(ty, bits).is_finite();
                if bits & fraction != 0 || !is_normal(bits) || !is_normal(reciprocal) {
                    return Step::Keep;
                }
                let reciprocal = self.constant(ty, reciprocal);
                self.to_binary(Mul, a, reciprocal)
            }
            Min | Max if c.is_infinite() && !is_neutral && self.is_never_nan(a) => self.is(b),
            _ => Step::Keep,
        }
    }

    fn float_bitwise(&mut self, op: Binary, ty: Type, a: Value, b: Value) -> Step {
        let (ones, sign) = (all_ones(ty.width()), sign_bit(ty.width()));
        match (op, self.bits(b)) {
            (And | Or, None) if a == b => self.is(a),
            (Xor, None) if a == b => self.is_bits(ty, 0),
            (Or | Xor, Some(0)) => self.is(a),
            (And, Some(0)) => self.is(b),
            (And, Some(mask)) if mask == ones => self.is(a),
            (Or, Some(mask)) if mask == ones => self.is(b),
            (And, Some(mask)) if mask == ones >> 1 => self.to_unary(Abs, a),
            (Xor, Some(mask)) if mask == sign => self.to_unary(Neg, a),
            _ => Step::Keep,
        }
    }

    fn copy_sign(&mut self, ty: Type, a: Value, b: Value) -> Step {
        if a == b {
            return self.is(a);
        }
        match (self.op(a), self.op(b)) {
            (Op::Unary(Neg | Abs, x) | Op::Binary(CopySign, [x, _]), _) => {
                self.to_binary(CopySign, x, b)
            }
            (_, Op::Binary(CopySign, [_, y])) => self.to_binary(CopySign, a, y),
            (_, Op::Unary(Abs, _)) => self.to_unary(Abs, a),
            _ => match self.bits(b).map(|bits| bits & sign_bit(ty.width())) {
                Some(0) => self.to_unary(Abs, a),
                Some(_) => {
                    let magnitude = self.make_unary(Abs, ty, a);
                    self.to_unary(Neg, magnitude)
                }
                None => Step::Keep,
            },
        }
    }
}
