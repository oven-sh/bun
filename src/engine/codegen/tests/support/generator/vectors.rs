//! Expressions of vectors.

use bun_engine_asm::{
    FloatWidth, Sign, Size, VectorBinary, VectorReduce, VectorShift, VectorTernary, VectorUnary,
    lanes,
};
use bun_engine_codegen::ir::{Binary, Lanes, Op, Type, Unary, Value};

use super::integers::SIGNS;
use super::{Class, Generator, constants};
use crate::support::datum::VectorOp;

const DATA: Class = Class::Data(Type::V128);
const SIZES: [Size; 4] = [Size::S8, Size::S16, Size::S32, Size::S64];

fn class_of_result(nan_lanes: Option<FloatWidth>) -> Class {
    nan_lanes.map_or(DATA, Class::LooseLanes)
}

impl Generator<'_> {
    /// Lanes of this format that are NaN may have open bits.
    pub(super) fn vector(&mut self, loose: Option<FloatWidth>) -> (Value, Class) {
        let wanted = class_of_result(loose);
        let roll = self.random.below(100);
        if roll >= 45 || roll >= 15 && !self.may_nest() {
            if let Some(found) = self.find(|known| known.satisfies(wanted)) {
                return found;
            }
        }
        if roll < 15 || !self.may_nest() {
            let bits = constants::vector(&mut self.random);
            return (self.function.const_v128(bits), DATA);
        }
        let (value, class) = self.fresh_vector();
        self.count_as_used();
        if class.satisfies(wanted) {
            (value, class)
        } else {
            (self.settle(value, class), DATA)
        }
    }

    fn exact_vector(&mut self) -> Value {
        self.vector(None).0
    }

    pub(super) fn fresh_vector(&mut self) -> (Value, Class) {
        self.depth += 1;
        let (value, class) = self.vector_expression();
        self.depth -= 1;
        (self.keep(value, class), class)
    }

    fn lanes(&mut self) -> Lanes {
        match self.random.below(6) {
            0 => Lanes::Float(FloatWidth::F32),
            1 => Lanes::Float(FloatWidth::F64),
            _ => Lanes::Int(self.random.pick(&SIZES)),
        }
    }

    pub(super) fn lane(&mut self, lanes: Lanes) -> u8 {
        if self.random.one_in(3) {
            0
        } else {
            self.random.below(lanes.count().into()) as u8
        }
    }

    pub(super) fn shuffle_pattern(&mut self) -> [u8; 16] {
        let unit = self.random.pick(&[1u8, 2, 4, 8]);
        let (count, kind) = (16 / unit, self.random.below(12));
        let start = self.random.below(usize::from(count) * 2) as u8;
        let mut pattern = [0; 16];
        for (lane, bytes) in (0..).zip(pattern.chunks_mut(unit.into())) {
            let source = match kind {
                0 => lane,
                1 => count + lane,
                2 => start,
                3 => (start + lane) % (2 * count),
                4 => (start + lane) % count,
                5 => lane / 2 + lane % 2 * count + start % 2 * (count / 2),
                6 => 2 * lane + start % 2,
                7 => lane + self.random.pick(&[0, count]),
                8 => count - 1 - lane,
                9 => self.random.below(count.into()) as u8,
                _ => self.random.below(usize::from(count) * 2) as u8,
            };
            let is_zero = kind >= 9 && self.random.one_in(12);
            for (offset, byte) in (0..).zip(bytes) {
                *byte = if is_zero {
                    lanes::ZERO
                } else {
                    source * unit + offset
                };
            }
        }
        pattern
    }

    fn vector_expression(&mut self) -> (Value, Class) {
        use VectorBinary::{And, AndNot, Or, Xor};
        let ty = Type::V128;
        match self.random.below(100) {
            0..14 => {
                let op = self.random.pick(VectorUnary::ALL);
                let (a, class) = self.vector(op.lanes_read().1.filter(|_| !op.is_relaxed()));
                let keeps_bits = matches!(
                    op,
                    VectorUnary::F32x4Abs
                        | VectorUnary::F32x4Neg
                        | VectorUnary::F64x2Abs
                        | VectorUnary::F64x2Neg
                );
                let class = if keeps_bits {
                    class
                } else {
                    class_of_result(op.nan_lanes())
                };
                (self.emit(Op::VectorUnary(op, a), ty), class)
            }
            14..40 => {
                let op = self.random.pick(VectorBinary::ALL);
                let read = op.lanes_read().1;
                let (a, b) = (self.vector(read).0, self.vector(read).0);
                let class = class_of_result(read.filter(|_| op.mask_lanes().is_none()));
                (self.emit(Op::VectorBinary(op, [a, b]), ty), class)
            }
            40..50 => {
                let op = self.random.pick(&[And, AndNot, Or, Xor]);
                let (a, mut b) = (self.exact_vector(), self.exact_vector());
                if self.random.one_in(4) {
                    b = self.emit(Op::VectorUnary(VectorUnary::Not, b), ty);
                }
                let args = if self.random.flip() { [a, b] } else { [b, a] };
                (self.emit(Op::VectorBinary(op, args), ty), DATA)
            }
            50..56 => {
                let any = self.random.pick(VectorTernary::ALL);
                let op = self.random.pick(&[any, VectorTernary::Bitselect]);
                let args = [(); 3].map(|()| self.vector(op.nan_lanes()).0);
                (
                    self.emit(Op::VectorTernary(op, args), ty),
                    class_of_result(op.nan_lanes()),
                )
            }
            56..62 => {
                let op = self.random.pick(VectorShift::ALL);
                let (a, amount) = (self.exact_vector(), self.shift_amount(Type::I32));
                (self.emit(Op::VectorShift(op, [a, amount]), ty), DATA)
            }
            62..76 => {
                let (mut a, mut b) = (self.exact_vector(), self.exact_vector());
                for operand in [&mut a, &mut b] {
                    if self.random.one_in(4) {
                        let (other, pattern) = (self.exact_vector(), self.shuffle_pattern());
                        *operand = self.builder().shuffle(*operand, other, pattern);
                    }
                }
                let pattern = self.shuffle_pattern();
                (self.builder().shuffle(a, b, pattern), DATA)
            }
            76..82 => {
                let lanes = self.lanes();
                let scalar = self.data(lanes.scalar());
                (self.builder().splat(lanes, scalar), DATA)
            }
            82..89 => {
                let lanes = self.lanes();
                let (mut vector, lane) = (self.exact_vector(), self.lane(lanes));
                let scalar = if self.random.one_in(3) {
                    let (from, sign) = (self.random.pick(&[lane, 0]), self.random.pick(&SIGNS));
                    self.builder().extract_lane(lanes, sign, vector, from)
                } else {
                    self.data(lanes.scalar())
                };
                if self.random.one_in(3) {
                    let (other, other_lane) =
                        (self.data(lanes.scalar()), self.random.pick(&[lane, 0]));
                    vector = self
                        .builder()
                        .replace_lane(lanes, vector, other_lane, other);
                }
                (
                    self.builder().replace_lane(lanes, vector, lane, scalar),
                    DATA,
                )
            }
            89..92 if self.shape.weights.accesses != 0 => (self.load(ty), DATA),
            92..94 if self.shape.weights.accesses != 0 => {
                let vector = self.exact_vector();
                (self.load_lane(vector), DATA)
            }
            94..96 => {
                let (condition, then, or) =
                    (self.condition(), self.exact_vector(), self.exact_vector());
                (self.select(condition, then, or), DATA)
            }
            96 => {
                let a = self.exact_vector();
                (self.unary(Unary::Opaque, ty, a), DATA)
            }
            _ => (self.vector_pattern(), DATA),
        }
    }

    fn vector_pattern(&mut self) -> Value {
        use VectorShift::*;
        let (ty, a) = (Type::V128, self.exact_vector());
        match self.random.below(3) {
            0 => {
                let (left, right) = self.random.pick(&[
                    (I8x16Shl, I8x16ShrU),
                    (I16x8Shl, I16x8ShrU),
                    (I32x4Shl, I32x4ShrU),
                    (I64x2Shl, I64x2ShrU),
                ]);
                let bits = i32::from(left.lanes().bits());
                let amount = self.random.pick(&[8, 16, 24, 32, 1, 7]) % bits;
                let (up, down) = (
                    self.function.const32(amount),
                    self.function.const32(bits - amount),
                );
                let (high, low) = (
                    self.emit(Op::VectorShift(left, [a, up]), ty),
                    self.emit(Op::VectorShift(right, [a, down]), ty),
                );
                let op = self.random.pick(&[VectorBinary::Or, VectorBinary::Xor]);
                self.emit(Op::VectorBinary(op, [high, low]), ty)
            }
            1 => {
                let op = self.random.pick(VectorBinary::ALL);
                let (size, number) = (op.lanes_read().0, self.random.pick(&[0, 1, u64::MAX, 2, 8]));
                let splat = self.splat_constant(size, number);
                let args = if self.random.one_in(3) {
                    [splat, a]
                } else {
                    [a, splat]
                };
                let result = self.emit(Op::VectorBinary(op, args), ty);
                self.settle(result, class_of_result(op.nan_lanes()))
            }
            _ => {
                let pattern = u128::from_le_bytes(self.shuffle_pattern());
                let indices = self.function.const_v128(pattern);
                let op = self.random.pick(&[
                    VectorBinary::I8x16Swizzle,
                    VectorBinary::I8x16RelaxedSwizzle,
                ]);
                self.emit(Op::VectorBinary(op, [a, indices]), ty)
            }
        }
    }

    fn source_of_lane(&mut self, lanes: Lanes, vector: Value) -> Value {
        let related = if self.random.flip() {
            lanes
        } else {
            self.lanes()
        };
        match self.random.below(8) {
            0 => {
                let scalar = self.data(related.scalar());
                self.builder().splat(related, scalar)
            }
            1 => {
                let (scalar, lane) = (self.data(related.scalar()), self.lane(related));
                self.builder().replace_lane(related, vector, lane, scalar)
            }
            2 => {
                let (other, pattern) = (self.exact_vector(), self.shuffle_pattern());
                self.builder().shuffle(vector, other, pattern)
            }
            _ => vector,
        }
    }

    pub(super) fn int_from_vector(&mut self, ty: Type) -> Value {
        let vector = self.exact_vector();
        if ty == Type::I32 && self.random.flip() {
            let op = self.random.pick(VectorReduce::ALL);
            let reduced = self.emit(Op::VectorReduce(op, vector), ty);
            return if self.random.one_in(4) {
                self.binary_constant(Binary::And, reduced, 0xffff)
            } else {
                reduced
            };
        }
        let size = if ty == Type::I64 {
            Size::S64
        } else {
            self.random.pick(&SIZES[..3])
        };
        let (lanes, sign) = (Lanes::Int(size), self.random.pick(&SIGNS));
        let (vector, lane) = (self.source_of_lane(lanes, vector), self.lane(lanes));
        self.builder().extract_lane(lanes, sign, vector, lane)
    }

    pub(super) fn float_from_vector(&mut self, ty: Type) -> (Value, Class) {
        let lanes = Lanes::Float(ty.float_width());
        let (mut vector, class) = self.vector(Some(ty.float_width()));
        if class == DATA {
            vector = self.source_of_lane(lanes, vector);
        }
        let lane = self.lane(lanes);
        let class = if class == DATA {
            Class::Data(ty)
        } else {
            Class::Loose(ty)
        };
        (
            self.builder()
                .extract_lane(lanes, Sign::Unsigned, vector, lane),
            class,
        )
    }
}
