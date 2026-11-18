//! Instructions that do several operations on vectors at once.

use bun_engine_asm::Sign::{Signed, Unsigned};
use bun_engine_asm::arm64::Arrangement::{B8, B16, D2, H4, H8, S2, S4};
use bun_engine_asm::arm64::{
    Arrangement, NeonAddPairs, NeonBinary, NeonBitwise, NeonBitwiseThree, NeonFloatUnary, NeonLong,
    NeonShiftRight, NeonUnary,
};
use bun_engine_asm::{Arm64Features, Shift, Sign, Size, VectorBinary, VectorUnary};
use smallvec::SmallVec;

use super::instruction::{Accumulation, Inst};
use crate::ir::{Lanes, Op, Type, Value};
use crate::machine::Lowering;

const MOST_DOT_PRODUCTS: usize = 6;
const MOST_ADDENDS: usize = 9;

fn by_sign<T>(sign: Sign, signed: T, unsigned: T) -> T {
    match sign {
        Signed => signed,
        Unsigned => unsigned,
    }
}

/// The half that is read, in the terms of the assembler.
fn widening_product(op: VectorBinary) -> Option<(Sign, Arrangement)> {
    use VectorBinary::*;
    Some(match op {
        I16x8ExtMulLowI8x16S => (Signed, B8),
        I16x8ExtMulHighI8x16S => (Signed, B16),
        I16x8ExtMulLowI8x16U => (Unsigned, B8),
        I16x8ExtMulHighI8x16U => (Unsigned, B16),
        I32x4ExtMulLowI16x8S => (Signed, H4),
        I32x4ExtMulHighI16x8S => (Signed, H8),
        I32x4ExtMulLowI16x8U => (Unsigned, H4),
        I32x4ExtMulHighI16x8U => (Unsigned, H8),
        I64x2ExtMulLowI32x4S => (Signed, S2),
        I64x2ExtMulHighI32x4S => (Signed, S4),
        I64x2ExtMulLowI32x4U => (Unsigned, S2),
        I64x2ExtMulHighI32x4U => (Unsigned, S4),
        _ => return None,
    })
}

fn extension(op: VectorUnary) -> Option<(Sign, Arrangement)> {
    use VectorUnary::*;
    Some(match op {
        I16x8ExtendLowI8x16S => (Signed, B8),
        I16x8ExtendHighI8x16S => (Signed, B16),
        I16x8ExtendLowI8x16U => (Unsigned, B8),
        I16x8ExtendHighI8x16U => (Unsigned, B16),
        I32x4ExtendLowI16x8S => (Signed, H4),
        I32x4ExtendHighI16x8S => (Signed, H8),
        I32x4ExtendLowI16x8U => (Unsigned, H4),
        I32x4ExtendHighI16x8U => (Unsigned, H8),
        I64x2ExtendLowI32x4S => (Signed, S2),
        I64x2ExtendHighI32x4S => (Signed, S4),
        I64x2ExtendLowI32x4U => (Unsigned, S2),
        I64x2ExtendHighI32x4U => (Unsigned, S4),
        _ => return None,
    })
}

fn sum_of_pairs(op: VectorUnary) -> Option<(NeonAddPairs, Arrangement)> {
    use VectorUnary::*;
    Some(match op {
        I16x8ExtAddPairwiseI8x16S => (NeonAddPairs::Sadalp, B16),
        I16x8ExtAddPairwiseI8x16U => (NeonAddPairs::Uadalp, B16),
        I32x4ExtAddPairwiseI16x8S => (NeonAddPairs::Sadalp, H8),
        I32x4ExtAddPairwiseI16x8U => (NeonAddPairs::Uadalp, H8),
        _ => return None,
    })
}

/// For the greater of two, the lesser, and the instruction for their difference.
fn distance(max: VectorBinary) -> Option<(VectorBinary, NeonBinary, Arrangement)> {
    use VectorBinary::*;
    Some(match max {
        I8x16MaxS => (I8x16MinS, NeonBinary::Sabd, B16),
        I8x16MaxU => (I8x16MinU, NeonBinary::Uabd, B16),
        I16x8MaxS => (I16x8MinS, NeonBinary::Sabd, H8),
        I16x8MaxU => (I16x8MinU, NeonBinary::Uabd, H8),
        I32x4MaxS => (I32x4MinS, NeonBinary::Sabd, S4),
        I32x4MaxU => (I32x4MinU, NeonBinary::Uabd, S4),
        _ => return None,
    })
}

/// With zero on the right, and on the left.
fn comparisons_with_zero(op: VectorBinary) -> Option<[Inst; 2]> {
    use VectorBinary::*;
    let shape = Arrangement::full(op.mask_lanes()?);
    let int = |ops: [NeonUnary; 2]| ops.map(|op| Inst::LanesWithZero(op, shape));
    let float = |ops: [NeonFloatUnary; 2]| ops.map(|op| Inst::FloatLanesWithZero(op, shape));
    Some(match op {
        I8x16Eq | I16x8Eq | I32x4Eq | I64x2Eq => int([NeonUnary::Cmeq; 2]),
        I8x16LtS | I16x8LtS | I32x4LtS | I64x2LtS => int([NeonUnary::Cmlt, NeonUnary::Cmgt]),
        I8x16GtS | I16x8GtS | I32x4GtS | I64x2GtS => int([NeonUnary::Cmgt, NeonUnary::Cmlt]),
        I8x16LeS | I16x8LeS | I32x4LeS | I64x2LeS => int([NeonUnary::Cmle, NeonUnary::Cmge]),
        I8x16GeS | I16x8GeS | I32x4GeS | I64x2GeS => int([NeonUnary::Cmge, NeonUnary::Cmle]),
        F32x4Eq | F64x2Eq => float([NeonFloatUnary::Fcmeq; 2]),
        F32x4Lt | F64x2Lt => float([NeonFloatUnary::Fcmlt, NeonFloatUnary::Fcmgt]),
        F32x4Gt | F64x2Gt => float([NeonFloatUnary::Fcmgt, NeonFloatUnary::Fcmlt]),
        F32x4Le | F64x2Le => float([NeonFloatUnary::Fcmle, NeonFloatUnary::Fcmge]),
        F32x4Ge | F64x2Ge => float([NeonFloatUnary::Fcmge, NeonFloatUnary::Fcmle]),
        _ => return None,
    })
}

fn is_half_of(narrow: Arrangement, lanes: Size) -> bool {
    narrow.lanes().bytes() * 2 == lanes.bytes()
}

impl Lowering<'_, Inst> {
    /// Returns false if there is nothing to gain.
    pub(super) fn select_fused_vector(
        &mut self,
        value: Value,
        op: VectorBinary,
        [lhs, rhs]: [Value; 2],
    ) -> bool {
        use VectorBinary::*;
        match op {
            I8x16Add => self.select_lane_sum(value, Size::S8, lhs, rhs),
            I16x8Add => self.select_lane_sum(value, Size::S16, lhs, rhs),
            I32x4Add => {
                self.select_sum_of_dot_products(value, lhs, rhs)
                    || self.select_lane_sum(value, Size::S32, lhs, rhs)
            }
            I64x2Add => self.select_lane_sum(value, Size::S64, lhs, rhs),
            I8x16Sub => self.select_lane_difference(value, Size::S8, lhs, rhs),
            I16x8Sub => self.select_lane_difference(value, Size::S16, lhs, rhs),
            I32x4Sub => self.select_lane_difference(value, Size::S32, lhs, rhs),
            I64x2Sub => self.select_lane_difference(value, Size::S64, lhs, rhs),
            F32x4Mul => self.select_product_with_lane(value, S4, lhs, rhs),
            F64x2Mul => self.select_product_with_lane(value, D2, lhs, rhs),
            Or => self.select_vector_or(value, lhs, rhs),
            Xor => self.select_vector_xor(value, lhs, rhs),
            _ => self.select_comparison_with_zero(value, op, lhs, rhs),
        }
    }

    fn finish_vector(&mut self, value: Value, instruction: Inst, operands: &[Value]) -> bool {
        self.def(value);
        for &operand in operands {
            self.use_register(operand);
        }
        self.finish(instruction);
        true
    }

    fn finish_accumulation(
        &mut self,
        value: Value,
        into: Value,
        (how, operands): (Accumulation, [Value; 2]),
    ) -> bool {
        self.def_tied(value, 1, None);
        self.use_register(into);
        for operand in operands.into_iter().filter(|operand| !operand.is_none()) {
            self.use_late(operand);
        }
        self.finish(Inst::Accumulate(how));
        true
    }

    /// The operation, if only the current instruction needs its result.
    fn own_op(&self, value: Value) -> Op {
        if self.has_one_use_nearby(value) {
            self.op(value)
        } else {
            Op::Removed
        }
    }

    /// The kind, the lanes, what is shifted and by how much, which is not zero.
    fn shifted_lanes(&self, value: Value) -> Option<(Shift, Size, Value, u8)> {
        let (op, source, amount) = match self.own_op(value) {
            Op::VectorShift(op, [source, amount]) => (op, source, amount),
            Op::VectorBinary(VectorBinary::I32x4Add, [a, b]) if a == b => {
                return Some((Shift::Left, Size::S32, a, 1));
            }
            Op::VectorBinary(VectorBinary::I64x2Add, [a, b]) if a == b => {
                return Some((Shift::Left, Size::S64, a, 1));
            }
            _ => return None,
        };
        let amount = self.int_constant(amount)? as u8 % op.lanes().bits();
        (amount != 0).then_some((op.kind(), op.lanes(), source, amount))
    }

    /// The forms are for plain, signed widening and unsigned widening products.
    fn product_of_lanes(
        &self,
        value: Value,
        lanes: Size,
        (plain, signed, unsigned): (NeonBinary, NeonLong, NeonLong),
    ) -> Option<(Accumulation, [Value; 2])> {
        let Op::VectorBinary(op, factors) = self.own_op(value) else {
            return None;
        };
        let how = match (op, lanes) {
            (VectorBinary::I16x8Mul, Size::S16) => Accumulation::Lanes(plain, H8),
            (VectorBinary::I32x4Mul, Size::S32) => Accumulation::Lanes(plain, S4),
            _ => {
                let (sign, shape) = widening_product(op).filter(|it| is_half_of(it.1, lanes))?;
                Accumulation::Long(by_sign(sign, signed, unsigned), shape)
            }
        };
        Some((how, factors))
    }

    fn accumulable(&self, value: Value, lanes: Size) -> Option<(Accumulation, [Value; 2])> {
        let forms = (NeonBinary::Mla, NeonLong::Smlal, NeonLong::Umlal);
        if let Some(product) = self.product_of_lanes(value, lanes, forms) {
            return Some(product);
        }
        if let Op::VectorUnary(op, source) = self.own_op(value) {
            let (op, shape) = sum_of_pairs(op).filter(|it| is_half_of(it.1, lanes))?;
            return Some((Accumulation::Pairs(op, shape), [source, Value::NONE]));
        }
        let (kind, _, source, amount) = self.shifted_lanes(value).filter(|it| it.1 == lanes)?;
        let op = match kind {
            Shift::RightArithmetic => NeonShiftRight::Ssra,
            Shift::RightLogical => NeonShiftRight::Usra,
            _ => return None,
        };
        let how = Accumulation::ShiftedRight(op, Arrangement::full(lanes), amount);
        Some((how, [source, Value::NONE]))
    }

    fn extended_lanes(&self, value: Value, lanes: Size) -> Option<(Sign, Arrangement, Value)> {
        let Op::VectorUnary(op, source) = self.own_op(value) else {
            return None;
        };
        let (sign, shape) = extension(op).filter(|it| is_half_of(it.1, lanes))?;
        Some((sign, shape, source))
    }

    /// The forms are signed and unsigned, for two narrow operands and for one.
    fn select_widening(
        &mut self,
        value: Value,
        lanes: Size,
        [lhs, rhs]: [Value; 2],
        [both, one]: [[NeonLong; 2]; 2],
    ) -> bool {
        let Some((sign, shape, narrow)) = self.extended_lanes(rhs, lanes) else {
            return false;
        };
        let (forms, lhs) = match self.extended_lanes(lhs, lanes) {
            Some(other) if (other.0, other.1) == (sign, shape) => (both, other.2),
            _ => (one, lhs),
        };
        let instruction = Inst::WideningLanes(by_sign(sign, forms[0], forms[1]), shape);
        self.finish_vector(value, instruction, &[lhs, narrow])
    }

    fn select_lane_sum(&mut self, value: Value, lanes: Size, lhs: Value, rhs: Value) -> bool {
        use NeonLong::{Saddl, Saddw, Uaddl, Uaddw};
        let Op::VectorBinary(add, _) = self.op(value) else {
            unreachable!()
        };
        for (into, term) in [(lhs, rhs), (rhs, lhs)] {
            if let Some(accumulation) = self.accumulable(term, lanes) {
                return self.finish_accumulation(value, into, accumulation);
            }
        }
        for (into, term) in [(lhs, rhs), (rhs, lhs)] {
            if let Op::VectorBinary(inner, [first, second]) = self.own_op(term)
                && inner == add
                && self.accumulable(first, lanes).is_some()
                && let Some(accumulation) = self.accumulable(second, lanes)
            {
                let partial = Op::VectorBinary(add, [into, first]);
                let partial = self.insert_replacement(value, partial, Type::V128);
                return self.finish_accumulation(value, partial, accumulation);
            }
            if self.select_widening(value, lanes, [into, term], [[Saddl, Uaddl], [Saddw, Uaddw]]) {
                return true;
            }
        }
        false
    }

    fn select_lane_difference(
        &mut self,
        value: Value,
        lanes: Size,
        lhs: Value,
        rhs: Value,
    ) -> bool {
        use NeonLong::{Ssubl, Ssubw, Usubl, Usubw};
        let forms = (NeonBinary::Mls, NeonLong::Smlsl, NeonLong::Umlsl);
        if let Some(product) = self.product_of_lanes(rhs, lanes, forms) {
            return self.finish_accumulation(value, lhs, product);
        }
        if let (Op::VectorBinary(max, [a, b]), Op::VectorBinary(min, pair)) =
            (self.own_op(lhs), self.own_op(rhs))
            && let Some((expected, op, shape)) = distance(max)
            && (min, lanes) == (expected, shape.lanes())
            && (pair == [a, b] || pair == [b, a])
        {
            return self.finish_vector(value, Inst::Lanes(op, shape), &[a, b]);
        }
        self.select_widening(value, lanes, [lhs, rhs], [[Ssubl, Usubl], [Ssubw, Usubw]])
    }

    fn insert_sum(&mut self, next: Value, terms: &[Value]) -> Option<Value> {
        terms.iter().copied().reduce(|sum, term| {
            let op = Op::VectorBinary(VectorBinary::I32x4Add, [sum, term]);
            self.insert_replacement(next, op, Type::V128)
        })
    }

    /// The products are added up first, and neighbouring lanes only once.
    fn select_sum_of_dot_products(&mut self, value: Value, lhs: Value, rhs: Value) -> bool {
        use VectorBinary::{I32x4Add, I32x4DotI16x8S, I32x4ExtMulHighI16x8S, I32x4ExtMulLowI16x8S};
        let mut pending: SmallVec<[Value; MOST_ADDENDS]> = SmallVec::from_slice(&[lhs, rhs]);
        let mut dots: SmallVec<[[Value; 2]; MOST_DOT_PRODUCTS]> = SmallVec::new();
        let mut others: SmallVec<[Value; MOST_ADDENDS]> = SmallVec::new();
        while let Some(term) = pending.pop() {
            let has_room = pending.len() + dots.len() + others.len() + 2 <= MOST_ADDENDS;
            match self.own_op(term) {
                Op::VectorBinary(I32x4DotI16x8S, pair) if dots.len() < MOST_DOT_PRODUCTS => {
                    dots.push(pair);
                }
                Op::VectorBinary(I32x4Add, pair) if has_room => pending.extend(pair),
                _ => others.push(term),
            }
        }
        if dots.len() < 2 {
            return false;
        }
        let [low, high] = [I32x4ExtMulLowI16x8S, I32x4ExtMulHighI16x8S].map(|product| {
            let products: SmallVec<[Value; MOST_DOT_PRODUCTS]> = dots
                .iter()
                .map(|&pair| self.insert_before(value, Op::VectorBinary(product, pair), Type::V128))
                .collect();
            self.insert_sum(value, &products).unwrap()
        });
        match self.insert_sum(value, &others) {
            Some(rest) => self.finish_vector(value, Inst::AddPairsTo, &[low, high, rest]),
            None => self.finish_vector(value, Inst::Lanes(NeonBinary::Addp, S4), &[low, high]),
        }
    }

    /// A vector and the lane of it that is in all lanes of `value`.
    fn repeated_lane(&self, value: Value, lanes: Size) -> Option<(Value, u8)> {
        if self.is_materialized(value) {
            return None;
        }
        match self.op(value) {
            Op::Splat(Lanes::Float(width), scalar) if width.width().size() == lanes => {
                Some(match self.op(scalar) {
                    Op::ExtractLane { lane, vector, .. } if self.dissolves(scalar) => {
                        (vector, lane)
                    }
                    _ => (scalar, 0),
                })
            }
            Op::Shuffle(sources, pattern) => {
                let (pattern, size) = (self.function.vector_constant(pattern), lanes.bytes());
                let first = pattern as u8;
                let bytes = pattern.to_le_bytes().into_iter();
                let repeats = first < 32
                    && first.is_multiple_of(size)
                    && bytes
                        .zip(0..)
                        .all(|(byte, index)| byte == first + index % size);
                repeats.then(|| (sources[usize::from(first / 16)], first % 16 / size))
            }
            _ => None,
        }
    }

    fn select_product_with_lane(
        &mut self,
        value: Value,
        shape: Arrangement,
        lhs: Value,
        rhs: Value,
    ) -> bool {
        for (other, repeated) in [(lhs, rhs), (rhs, lhs)] {
            if let Some((source, lane)) = self.repeated_lane(repeated, shape.lanes()) {
                let instruction = Inst::MulByLane(shape, lane);
                return self.finish_vector(value, instruction, &[other, source]);
            }
        }
        false
    }

    fn select_vector_or(&mut self, value: Value, lhs: Value, rhs: Value) -> bool {
        for (a, b) in [(lhs, rhs), (rhs, lhs)] {
            if let Op::VectorUnary(VectorUnary::Not, inverted) = self.own_op(b) {
                let instruction = Inst::FloatBits(NeonBitwise::Orn);
                return self.finish_vector(value, instruction, &[a, inverted]);
            }
            if let Some((Shift::Left, lanes, high, left)) = self.shifted_lanes(a)
                && let Some((Shift::RightLogical, same, low, right)) = self.shifted_lanes(b)
                && (same, left + right) == (lanes, lanes.bits())
            {
                let uses = 1 + self
                    .function
                    .operands(a)
                    .iter()
                    .filter(|&&it| it == low)
                    .count();
                if let Op::VectorBinary(VectorBinary::Xor, pair) = self.op(low)
                    && (high, lanes) == (low, Size::S64)
                    && self.features.contains(Arm64Features::SHA3)
                    && self.use_count(low) == uses as u32
                    && self.can_repeat(low)
                {
                    return self.finish_vector(value, Inst::XorAndRotate(right), &pair);
                }
                let shape = Arrangement::full(lanes);
                let how = Accumulation::ShiftedRight(NeonShiftRight::Sri, shape, right);
                return self.finish_accumulation(value, a, (how, [low, Value::NONE]));
            }
        }
        false
    }

    fn select_vector_xor(&mut self, value: Value, lhs: Value, rhs: Value) -> bool {
        if !self.features.contains(Arm64Features::SHA3) {
            return false;
        }
        for (other, inner) in [(lhs, rhs), (rhs, lhs)] {
            let (op, [b, c]) = match self.own_op(inner) {
                Op::VectorBinary(VectorBinary::Xor, pair) => (NeonBitwiseThree::Eor3, pair),
                Op::VectorBinary(VectorBinary::AndNot, pair) => (NeonBitwiseThree::Bcax, pair),
                _ => continue,
            };
            return self.finish_vector(value, Inst::ThreeVectors(op), &[other, b, c]);
        }
        false
    }

    fn select_comparison_with_zero(
        &mut self,
        value: Value,
        op: VectorBinary,
        lhs: Value,
        rhs: Value,
    ) -> bool {
        let is_zero = |value| matches!(self.op(value), Op::ConstV128(bits) if self.function.vector_constant(bits) == 0);
        let (side, other) = match (is_zero(lhs), is_zero(rhs)) {
            (_, true) => (0, lhs),
            (true, false) => (1, rhs),
            (false, false) => return false,
        };
        comparisons_with_zero(op)
            .is_some_and(|instructions| self.finish_vector(value, instructions[side], &[other]))
    }
}
