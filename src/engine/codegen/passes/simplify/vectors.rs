//! Operations on the lanes of vectors.

use bun_engine_asm::{
    Shift, Sign, Size, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary, lanes,
};

use super::Simplifier;
use super::rewrite::{Step, shared_operand};
use crate::ir::{Load, Op, Type, Value};

const ONES: u128 = u128::MAX;

/// What an operation makes of equal operands and of zero.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Family {
    Sum,
    Difference,
    Product(Size),
    Idempotent,
    Reflexive,
    Irreflexive,
    Other,
}

#[rustfmt::skip]
fn family(op: VectorBinary) -> Family {
    use VectorBinary::*;
    match op {
        I8x16Add | I8x16AddSatS | I8x16AddSatU | I16x8Add | I16x8AddSatS | I16x8AddSatU
        | I32x4Add | I64x2Add => Family::Sum,
        I8x16Sub | I8x16SubSatS | I8x16SubSatU | I16x8Sub | I16x8SubSatS | I16x8SubSatU
        | I32x4Sub | I64x2Sub => Family::Difference,
        I16x8Mul => Family::Product(Size::S16),
        I32x4Mul => Family::Product(Size::S32),
        I64x2Mul => Family::Product(Size::S64),
        I8x16MinS | I8x16MinU | I8x16MaxS | I8x16MaxU | I8x16AvgrU
        | I16x8MinS | I16x8MinU | I16x8MaxS | I16x8MaxU | I16x8AvgrU
        | I32x4MinS | I32x4MinU | I32x4MaxS | I32x4MaxU
        | F32x4Pmin | F32x4Pmax | F64x2Pmin | F64x2Pmax => Family::Idempotent,
        I8x16Eq | I8x16LeS | I8x16LeU | I8x16GeS | I8x16GeU
        | I16x8Eq | I16x8LeS | I16x8LeU | I16x8GeS | I16x8GeU
        | I32x4Eq | I32x4LeS | I32x4LeU | I32x4GeS | I32x4GeU
        | I64x2Eq | I64x2LeS | I64x2GeS => Family::Reflexive,
        I8x16Ne | I8x16LtS | I8x16LtU | I8x16GtS | I8x16GtU
        | I16x8Ne | I16x8LtS | I16x8LtU | I16x8GtS | I16x8GtU
        | I32x4Ne | I32x4LtS | I32x4LtU | I32x4GtS | I32x4GtU
        | I64x2Ne | I64x2LtS | I64x2GtS
        | F32x4Lt | F32x4Gt | F64x2Lt | F64x2Gt => Family::Irreflexive,
        _ => Family::Other,
    }
}

fn counterpart<T: Copy + PartialEq>(pairs: &[[T; 2]], op: T) -> Option<T> {
    pairs.iter().find_map(|&[a, b]| {
        if op == a {
            Some(b)
        } else {
            (op == b).then_some(a)
        }
    })
}

fn inverted(op: VectorBinary) -> Option<VectorBinary> {
    use VectorBinary::*;
    #[rustfmt::skip]
    const PAIRS: [[VectorBinary; 2]; 20] = [
        [I8x16Eq, I8x16Ne], [I8x16LtS, I8x16GeS], [I8x16LtU, I8x16GeU], [I8x16GtS, I8x16LeS], [I8x16GtU, I8x16LeU],
        [I16x8Eq, I16x8Ne], [I16x8LtS, I16x8GeS], [I16x8LtU, I16x8GeU], [I16x8GtS, I16x8LeS], [I16x8GtU, I16x8LeU],
        [I32x4Eq, I32x4Ne], [I32x4LtS, I32x4GeS], [I32x4LtU, I32x4GeU], [I32x4GtS, I32x4LeS], [I32x4GtU, I32x4LeU],
        [I64x2Eq, I64x2Ne], [I64x2LtS, I64x2GeS], [I64x2GtS, I64x2LeS],
        [F32x4Eq, F32x4Ne], [F64x2Eq, F64x2Ne],
    ];
    counterpart(&PAIRS, op)
}

/// For each size of lanes that can be doubled: of the low and the high half, with and without sign.
#[rustfmt::skip]
pub(super) const EXTENSIONS: [[(VectorUnary, VectorBinary); 4]; 3] = {
    use {VectorBinary::*, VectorUnary::*};
    [
        [
            (I16x8ExtendLowI8x16S, I16x8ExtMulLowI8x16S), (I16x8ExtendLowI8x16U, I16x8ExtMulLowI8x16U),
            (I16x8ExtendHighI8x16S, I16x8ExtMulHighI8x16S), (I16x8ExtendHighI8x16U, I16x8ExtMulHighI8x16U),
        ],
        [
            (I32x4ExtendLowI16x8S, I32x4ExtMulLowI16x8S), (I32x4ExtendLowI16x8U, I32x4ExtMulLowI16x8U),
            (I32x4ExtendHighI16x8S, I32x4ExtMulHighI16x8S), (I32x4ExtendHighI16x8U, I32x4ExtMulHighI16x8U),
        ],
        [
            (I64x2ExtendLowI32x4S, I64x2ExtMulLowI32x4S), (I64x2ExtendLowI32x4U, I64x2ExtMulLowI32x4U),
            (I64x2ExtendHighI32x4S, I64x2ExtMulHighI32x4S), (I64x2ExtendHighI32x4U, I64x2ExtMulHighI32x4U),
        ],
    ]
};

fn by_size<T: Copy>(size: Size, ops: [T; 4]) -> T {
    ops[size as usize]
}

impl Simplifier<'_> {
    #[inline]
    pub(super) fn vector(&self, value: Value) -> Option<u128> {
        match self.op(value) {
            Op::ConstV128(constant) => Some(self.function.vector_constant(constant)),
            _ => None,
        }
    }

    fn as_vector_not(&self, value: Value) -> Option<Value> {
        match self.op(value) {
            Op::VectorUnary(VectorUnary::Not, x) => Some(x),
            _ => None,
        }
    }

    fn make_vector_binary(&mut self, op: VectorBinary, a: Value, b: Value) -> Value {
        self.make(Op::VectorBinary(op, [a, b]), Type::V128)
    }

    pub(super) fn vector_unary(&mut self, op: VectorUnary, a: Value) -> Step {
        use VectorUnary::*;
        const NEG_AND_ABS: [[VectorUnary; 2]; 6] = [
            [I8x16Neg, I8x16Abs],
            [I16x8Neg, I16x8Abs],
            [I32x4Neg, I32x4Abs],
            [I64x2Neg, I64x2Abs],
            [F32x4Neg, F32x4Abs],
            [F64x2Neg, F64x2Abs],
        ];
        match self.op(a) {
            Op::ConstV128(constant) if !op.is_relaxed() => {
                self.is_vector(op.evaluate(self.function.vector_constant(constant)))
            }
            Op::VectorUnary(Not, x) if op == Not => self.is(x),
            Op::VectorUnary(inner, x) => match NEG_AND_ABS.iter().find(|pair| pair.contains(&op)) {
                Some(&[neg, _]) if op == neg && inner == neg => self.is(x),
                Some(&[_, abs]) if op == abs && inner == abs => self.is(a),
                Some(&[neg, abs]) if op == abs && inner == neg => self.to(Op::VectorUnary(abs, x)),
                _ => Step::Keep,
            },
            Op::VectorBinary(inner, args)
                if op == Not
                    && self.once(a)
                    && let Some(inverse) = inverted(inner) =>
            {
                self.to(Op::VectorBinary(inverse, args))
            }
            Op::Load {
                kind: Load::VectorZero(Size::S64),
                address,
                offset,
                access,
            } if self.once(a) => {
                let sizes = [Size::S8, Size::S16, Size::S32].into_iter().zip(EXTENSIONS);
                let kind = sizes
                    .into_iter()
                    .find_map(|(size, [signed, unsigned, ..])| {
                        let sign = if op == signed.0 {
                            Sign::Signed
                        } else {
                            Sign::Unsigned
                        };
                        (op == signed.0 || op == unsigned.0)
                            .then_some(Load::VectorExtend(size, sign))
                    });
                let Some(kind) = kind else {
                    return Step::Keep;
                };
                let loaded = self.load_instead(
                    a,
                    Op::Load {
                        kind,
                        address,
                        offset,
                        access,
                    },
                    Type::V128,
                );
                self.is(loaded)
            }
            _ => Step::Keep,
        }
    }

    pub(super) fn vector_binary(&mut self, op: VectorBinary, a: Value, b: Value) -> Step {
        use VectorBinary::*;
        let constant = self.vector(b);
        if let (Some(x), Some(y), false) = (self.vector(a), constant, op.is_relaxed()) {
            return self.is_vector(op.evaluate(x, y));
        }
        match (op, constant) {
            (And | AndNot | Or | Xor, _) => return self.vector_bitwise(op, a, b),
            (I8x16Swizzle | I8x16RelaxedSwizzle, Some(indices)) => {
                let indices = indices.to_le_bytes();
                if op.is_relaxed() && indices.iter().any(|index| (16..128).contains(index)) {
                    return Step::Keep;
                }
                let pattern = indices.map(|index| if index < 16 { index } else { lanes::ZERO });
                let pattern = self.intern_pattern(pattern);
                return self.to(Op::Shuffle([a, a], pattern));
            }
            (I32x4DotI16x8S, Some(factors)) if factors == lanes::splat(Size::S16, 1) => {
                return self.to(Op::VectorUnary(VectorUnary::I32x4ExtAddPairwiseI16x8S, a));
            }
            (I8x16MinU | I16x8MinU | I32x4MinU, Some(0))
            | (I8x16MaxU | I16x8MaxU | I32x4MaxU, Some(ONES)) => {
                return self.is(b);
            }
            (I8x16MaxU | I16x8MaxU | I32x4MaxU, Some(0))
            | (I8x16MinU | I16x8MinU | I32x4MinU, Some(ONES)) => {
                return self.is(a);
            }
            _ => {}
        }
        match (family(op), constant) {
            (Family::Sum | Family::Difference, Some(0)) => self.is(a),
            (Family::Difference | Family::Irreflexive, _) if a == b => self.is_vector(0),
            (Family::Reflexive, _) if a == b => self.is_vector(ONES),
            (Family::Idempotent, _) if a == b => self.is(a),
            (Family::Difference, _) if self.vector(a) == Some(0) => {
                let neg = match op {
                    I8x16Sub => VectorUnary::I8x16Neg,
                    I16x8Sub => VectorUnary::I16x8Neg,
                    I32x4Sub => VectorUnary::I32x4Neg,
                    I64x2Sub => VectorUnary::I64x2Neg,
                    _ => return Step::Keep,
                };
                self.to(Op::VectorUnary(neg, b))
            }
            (Family::Product(size), _) => self.vector_product(size, a, b),
            _ => Step::Keep,
        }
    }

    fn vector_product(&mut self, size: Size, a: Value, b: Value) -> Step {
        use VectorShift::*;
        if let Some(factors) = self.vector(b) {
            let factor = lanes::extract(size, Sign::Unsigned, factors, 0);
            if factors == 0 {
                return self.is(b);
            }
            if factors == lanes::splat(size, factor) && factor.is_power_of_two() {
                let amount = self.constant(Type::I32, factor.trailing_zeros().into());
                let shift = by_size(size, [I8x16Shl, I16x8Shl, I32x4Shl, I64x2Shl]);
                return self.to(Op::VectorShift(shift, [a, amount]));
            }
        }
        match (self.op(a), self.op(b)) {
            (Op::VectorUnary(extend, x), Op::VectorUnary(same, y)) if extend == same => {
                match EXTENSIONS[size as usize - 1]
                    .iter()
                    .find(|&&(known, _)| known == extend)
                {
                    Some(&(_, product)) => self.to(Op::VectorBinary(product, [x, y])),
                    None => Step::Keep,
                }
            }
            _ => Step::Keep,
        }
    }

    fn vector_bitwise(&mut self, op: VectorBinary, a: Value, b: Value) -> Step {
        use VectorBinary::{And, AndNot, Or, Xor};
        if let Some(mask) = self.vector(b) {
            return self.vector_bitwise_constant(op, a, b, mask);
        }
        if a == b {
            return if matches!(op, And | Or) {
                self.is(a)
            } else {
                self.is_vector(0)
            };
        }
        let (not_a, not_b) = (self.as_vector_not(a), self.as_vector_not(b));
        if not_a == Some(b) || not_b == Some(a) {
            return match op {
                And => self.is_vector(0),
                AndNot => self.is(a),
                _ => self.is_vector(ONES),
            };
        }
        match (op, not_a, not_b) {
            (Xor, Some(x), Some(y)) => self.to(Op::VectorBinary(Xor, [x, y])),
            (Or, Some(x), Some(y)) if self.once(a) && self.once(b) => {
                let both = self.make_vector_binary(And, x, y);
                self.to(Op::VectorUnary(VectorUnary::Not, both))
            }
            (AndNot, Some(x), None) if self.once(a) => {
                let either = self.make_vector_binary(Or, x, b);
                self.to(Op::VectorUnary(VectorUnary::Not, either))
            }
            (And, _, Some(y)) => self.to(Op::VectorBinary(AndNot, [a, y])),
            (And, Some(x), _) => self.to(Op::VectorBinary(AndNot, [b, x])),
            (AndNot, _, Some(y)) => self.to(Op::VectorBinary(And, [a, y])),
            (AndNot, ..) => match self.vector(a) {
                Some(0) => self.is(a),
                Some(ONES) => self.to(Op::VectorUnary(VectorUnary::Not, b)),
                _ => Step::Keep,
            },
            (Or | Xor, ..) if self.once(a) && self.once(b) => self.join_vectors(op, a, b),
            _ => Step::Keep,
        }
    }

    fn vector_bitwise_constant(
        &mut self,
        op: VectorBinary,
        a: Value,
        b: Value,
        mask: u128,
    ) -> Step {
        use VectorBinary::{And, AndNot, Or, Xor};
        match (op, mask, self.op(a)) {
            (AndNot, ..) => {
                let kept = self.vector_constant(!mask);
                self.to(Op::VectorBinary(And, [a, kept]))
            }
            (And, 0, _) | (Or, ONES, _) => self.is(b),
            (And, ONES, _) | (Or | Xor, 0, _) => self.is(a),
            (Xor, ONES, _) => self.to(Op::VectorUnary(VectorUnary::Not, a)),
            (Xor, _, Op::VectorUnary(VectorUnary::Not, x)) => {
                let flipped = self.vector_constant(!mask);
                self.to(Op::VectorBinary(Xor, [x, flipped]))
            }
            (_, _, Op::VectorBinary(inner, [x, other])) if let Some(other) = self.vector(other) => {
                if inner == op {
                    let both = self.vector_constant(op.evaluate(other, mask));
                    self.to(Op::VectorBinary(op, [x, both]))
                } else if op == And && matches!(inner, Or | Xor) && other & mask == 0 {
                    self.to(Op::VectorBinary(And, [x, b]))
                } else {
                    Step::Keep
                }
            }
            _ => Step::Keep,
        }
    }

    /// `op` is `Or` or `Xor`, and nothing else uses the operands.
    fn join_vectors(&mut self, op: VectorBinary, a: Value, b: Value) -> Step {
        use VectorBinary::{And, AndNot};
        for (x, y) in [(a, b), (b, a)] {
            match (self.op(x), self.op(y)) {
                (Op::VectorBinary(And, first), Op::VectorBinary(And, second))
                    if let Some([shared, p, q]) = shared_operand(first, second) =>
                {
                    let joined = self.make_vector_binary(op, p, q);
                    return self.to(Op::VectorBinary(And, [shared, joined]));
                }
                (Op::VectorBinary(And, [p, q]), Op::VectorBinary(AndNot, [or, mask]))
                    if p == mask || q == mask =>
                {
                    let then = if p == mask { q } else { p };
                    return self.to(Op::VectorTernary(
                        VectorTernary::Bitselect,
                        [then, or, mask],
                    ));
                }
                (Op::VectorShift(left, [value, up]), Op::VectorShift(right, [same, down]))
                    if value == same
                        && left.lanes() == right.lanes()
                        && (left.kind(), right.kind()) == (Shift::Left, Shift::RightLogical) =>
                {
                    let (Some(up), Some(down)) = (self.int(up), self.int(down)) else {
                        continue;
                    };
                    let bytes = left.lanes().bytes();
                    if up > 0 && down > 0 && up % 8 == 0 && up + down == left.lanes().bits().into()
                    {
                        let pattern = core::array::from_fn(|index| {
                            let (lane, byte) = (index as u8 / bytes, index as u8 % bytes);
                            lane * bytes + (byte + down as u8 / 8) % bytes
                        });
                        let pattern = self.intern_pattern(pattern);
                        return self.to(Op::Shuffle([value, value], pattern));
                    }
                }
                _ => {}
            }
        }
        Step::Keep
    }

    pub(super) fn vector_ternary(
        &mut self,
        op: VectorTernary,
        [then, or, mask]: [Value; 3],
    ) -> Step {
        use VectorBinary::{And, AndNot, Or};
        if op != VectorTernary::Bitselect {
            return Step::Keep;
        }
        if then == or {
            return self.is(then);
        }
        if let Some(inverse) = self.as_vector_not(mask) {
            return self.to(Op::VectorTernary(op, [or, then, inverse]));
        }
        match (self.vector(then), self.vector(or), self.vector(mask)) {
            (Some(x), Some(y), Some(mask)) => self.is_vector(op.evaluate(x, y, mask)),
            (_, Some(0), _) => self.to(Op::VectorBinary(And, [then, mask])),
            (Some(0), ..) => self.to(Op::VectorBinary(AndNot, [or, mask])),
            (Some(ONES), ..) => self.to(Op::VectorBinary(Or, [or, mask])),
            (.., Some(mask))
                if mask
                    .to_le_bytes()
                    .iter()
                    .all(|byte| matches!(byte, 0 | 0xff)) =>
            {
                let mask = mask.to_le_bytes();
                let pattern = core::array::from_fn(|index| index as u8 + (!mask[index] & 16));
                let pattern = self.intern_pattern(pattern);
                self.to(Op::Shuffle([then, or], pattern))
            }
            _ if then == mask => self.to(Op::VectorBinary(Or, [or, mask])),
            _ if or == mask => self.to(Op::VectorBinary(And, [then, mask])),
            _ => Step::Keep,
        }
    }

    pub(super) fn vector_shift(&mut self, op: VectorShift, a: Value, amount: Value) -> Step {
        use VectorBinary::{I8x16Add, I16x8Add, I32x4Add, I64x2Add};
        let (size, bits) = (op.lanes(), i64::from(op.lanes().bits()));
        let Some(c) = self.int(amount) else {
            if self.vector(a) == Some(0) {
                return self.is(a);
            }
            return match self.strip(amount, bits as u64 - 1) {
                Some(stripped) => self.to(Op::VectorShift(op, [a, stripped])),
                None => Step::Keep,
            };
        };
        if let Some(x) = self.vector(a) {
            return self.is_vector(op.evaluate(x, c as u32));
        }
        if !(0..bits).contains(&c) {
            let amount = self.constant(Type::I32, (c & (bits - 1)) as u64);
            return self.to(Op::VectorShift(op, [a, amount]));
        }
        match (c, op.kind(), self.op(a)) {
            (0, ..) => self.is(a),
            (1, Shift::Left, _) => {
                let add = by_size(size, [I8x16Add, I16x8Add, I32x4Add, I64x2Add]);
                self.to(Op::VectorBinary(add, [a, a]))
            }
            (_, Shift::RightArithmetic | Shift::RightLogical, Op::Shuffle([x, _], pattern))
                if c * 2 == bits && size != Size::S8 =>
            {
                let (pattern, half) = (
                    self.function.vector_constant(pattern).to_le_bytes(),
                    size.bytes() / 2,
                );
                let upper_halves_come_from = |first: u8| {
                    let source = |index: u8| first + index / (2 * half) * half + index % half;
                    (0..16).all(|index| {
                        index / half % 2 == 0 || pattern[usize::from(index)] == source(index)
                    })
                };
                let without_sign = usize::from(op.kind() == Shift::RightLogical);
                match [0, 8].into_iter().position(upper_halves_come_from) {
                    Some(high) => {
                        let extend = EXTENSIONS[size as usize - 1][2 * high + without_sign].0;
                        self.to(Op::VectorUnary(extend, x))
                    }
                    None => Step::Keep,
                }
            }
            _ => Step::Keep,
        }
    }

    pub(super) fn vector_reduce(&mut self, op: VectorReduce, a: Value) -> Step {
        match self.vector(a) {
            Some(bits) => self.is_bits(Type::I32, op.evaluate(bits).into()),
            None => Step::Keep,
        }
    }
}
