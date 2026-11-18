//! Operations that move lanes around.

use bun_engine_asm::lanes::{self, ZERO};
use bun_engine_asm::{Sign, Size};

use super::Simplifier;
use super::facts::low_bits;
use super::rewrite::Step;
use super::vectors::EXTENSIONS;
use crate::ir::{Binary, Lanes, Load, Op, Type, Unary, Value, VectorConstant};

type Pattern = [u8; 16];

fn size_of_lane(lanes: Lanes) -> Size {
    match lanes {
        Lanes::Int(size) => size,
        Lanes::Float(width) => width.width().size(),
    }
}

/// Whether aligned runs of `bytes` stay together.
fn moves_units_of(bytes: u8, pattern: &Pattern) -> bool {
    pattern.chunks(bytes.into()).all(|unit| {
        unit[0] < 32
            && unit[0] % bytes == 0
            && (0..)
                .zip(unit)
                .all(|(offset, &index)| index == unit[0] + offset)
    })
}

/// The units of `bytes` come in turn from `first` and from `second` on. The latter may be `ZERO`.
fn interleaves(bytes: u8, first: u8, second: u8, pattern: &Pattern) -> bool {
    (0..).zip(pattern).all(|(position, &index): (u8, _)| {
        let offset = position / (2 * bytes) * bytes + position % bytes;
        match position / bytes % 2 {
            0 => index == first + offset,
            _ if second == ZERO => index == ZERO,
            _ => index == second + offset,
        }
    })
}

/// Of two vectors, and done in one instruction on both architectures.
fn is_cheap(pattern: &Pattern) -> bool {
    let is_window = (0..)
        .zip(pattern)
        .all(|(offset, &index)| index == pattern[0].wrapping_add(offset) % 32);
    let zips = |bytes| interleaves(bytes, 0, 16, pattern) || interleaves(bytes, 8, 24, pattern);
    let takes_every_other =
        |first: u8| (0..4u8).all(|lane| pattern[4 * usize::from(lane)] == first + 8 * lane);
    is_window
        || moves_units_of(8, pattern)
        || [1, 2, 4].into_iter().any(zips)
        || moves_units_of(4, pattern) && [0, 4].into_iter().any(takes_every_other)
}

impl Simplifier<'_> {
    pub(super) fn intern_pattern(&mut self, pattern: Pattern) -> VectorConstant {
        let constant = self.vector_constant(u128::from_le_bytes(pattern));
        let Op::ConstV128(interned) = self.op(constant) else {
            unreachable!()
        };
        interned
    }

    fn pattern(&self, pattern: VectorConstant) -> Pattern {
        self.function.vector_constant(pattern).to_le_bytes()
    }

    /// One that reads a single vector has it as both operands, and one that reads two starts with the first.
    fn normal_form(&self, [a, b]: [Value; 2], pattern: Pattern) -> ([Value; 2], Pattern) {
        let is_zero = [a, b].map(|operand| self.vector(operand) == Some(0));
        let pattern = pattern.map(|index| match index {
            32.. => ZERO,
            _ if is_zero[usize::from(index / 16)] => ZERO,
            _ if a == b => index % 16,
            _ => index,
        });
        let starts_with_second = pattern
            .iter()
            .find(|&&index| index != ZERO)
            .is_some_and(|&index| index >= 16);
        let (first, second, pattern) = if starts_with_second {
            (
                b,
                a,
                pattern.map(|index| if index == ZERO { index } else { index ^ 16 }),
            )
        } else {
            (a, b, pattern)
        };
        let reads_second = pattern.iter().any(|index| (16..32).contains(index));
        ([first, if reads_second { second } else { first }], pattern)
    }

    pub(super) fn shuffle(&mut self, a: Value, b: Value, interned: VectorConstant) -> Step {
        let given = self.pattern(interned);
        if let (Some(x), Some(y)) = (self.vector(a), self.vector(b)) {
            return self.is_vector(lanes::shuffle(x, y, given));
        }
        let (operands, pattern) = self.normal_form([a, b], given);
        if (operands, pattern) != ([a, b], given) {
            let pattern = self.intern_pattern(pattern);
            return self.to(Op::Shuffle(operands, pattern));
        }
        if pattern == [ZERO; 16] {
            return self.is_vector(0);
        }
        if a == b {
            if (0..)
                .zip(pattern)
                .all(|(position, index)| index == position)
            {
                return self.is(a);
            }
            if let Op::Splat(lanes, _) = self.op(a)
                && moves_units_of(size_of_lane(lanes).bytes(), &pattern)
            {
                return self.is(a);
            }
            for (bytes, [_, low, _, high]) in [1, 2, 4].into_iter().zip(EXTENSIONS) {
                for (first, (extend, _)) in [(0, low), (8, high)] {
                    if interleaves(bytes, first, ZERO, &pattern) {
                        return self.to(Op::VectorUnary(extend, a));
                    }
                }
            }
        }
        for inner in [a, b] {
            if let Some((operands, composed)) = self.compose([a, b], &pattern, inner)
                && (operands[0] == operands[1]
                    || is_cheap(&composed)
                    || a != b && !is_cheap(&pattern) && self.once(inner))
            {
                let composed = self.intern_pattern(composed);
                return self.to(Op::Shuffle(operands, composed));
            }
        }
        Step::Keep
    }

    /// Looks through the operand `inner`, if it is a shuffle and two vectors are all that is read then.
    fn compose(
        &self,
        outer: [Value; 2],
        pattern: &Pattern,
        inner: Value,
    ) -> Option<([Value; 2], Pattern)> {
        let Op::Shuffle(sources, inner_pattern) = self.op(inner) else {
            return None;
        };
        let inner_pattern = self.pattern(inner_pattern);
        let (mut operands, mut composed) = ([Value::NONE; 2], [ZERO; 16]);
        for (result, &index) in composed.iter_mut().zip(pattern) {
            let look_up = |operands: [Value; 2], index: u8| {
                Some((*operands.get(usize::from(index / 16))?, index % 16))
            };
            let found = look_up(outer, index).and_then(|(source, byte)| {
                if source == inner {
                    look_up(sources, inner_pattern[usize::from(byte)])
                } else {
                    Some((source, byte))
                }
            });
            if let Some((source, byte)) = found {
                let side = operands
                    .iter()
                    .position(|&known| known == source || known.is_none())?;
                operands[side] = source;
                *result = side as u8 * 16 + byte;
            }
        }
        let first = operands[0].expand().unwrap_or(sources[0]);
        Some(([first, operands[1].expand().unwrap_or(first)], composed))
    }

    /// For lanes narrower than the scalar, and for floats that have just been integers or the other way round.
    fn plainer_scalar(&mut self, lanes: Lanes, scalar: Value) -> Option<(Lanes, Value)> {
        let size = size_of_lane(lanes);
        if size < Size::S32 {
            return Some((lanes, self.strip_above(scalar, size.bits())?));
        }
        let original = self.as_unary(Unary::Bitcast, scalar)?;
        self.hit();
        let ty = self.type_of(original);
        Some((
            if ty.is_int() {
                Lanes::Int(size)
            } else {
                Lanes::Float(ty.float_width())
            },
            original,
        ))
    }

    pub(super) fn splat(&mut self, lanes: Lanes, scalar: Value) -> Step {
        let size = size_of_lane(lanes);
        if let Some(bits) = self.bits(scalar) {
            return self.is_vector(lanes::splat(size, bits));
        }
        if let Some((lanes, scalar)) = self.plainer_scalar(lanes, scalar) {
            return self.to(Op::Splat(lanes, scalar));
        }
        match self.op(scalar) {
            Op::ExtractLane {
                lanes: from,
                lane,
                vector,
                ..
            } if size_of_lane(from) == size => {
                let bytes = size.bytes();
                let pattern = core::array::from_fn(|index| lane * bytes + index as u8 % bytes);
                let pattern = self.intern_pattern(pattern);
                self.to(Op::Shuffle([vector, vector], pattern))
            }
            Op::Load { .. } => {
                match self.load_part_as(scalar, 0, size, Load::VectorSplat(size), Type::V128) {
                    Some(loaded) => self.is(loaded),
                    None => Step::Keep,
                }
            }
            _ => Step::Keep,
        }
    }

    /// What comes out of a lane into which `scalar` went.
    fn read_back(&mut self, lanes: Lanes, sign: Sign, scalar: Value) -> Op {
        match (size_of_lane(lanes), sign) {
            (Size::S32 | Size::S64, _) => Op::Unary(Unary::Bitcast, scalar),
            (size, Sign::Signed) => Op::Unary(Unary::SignExtend(size), scalar),
            (size, Sign::Unsigned) => {
                let mask = self.constant(Type::I32, low_bits(size.bits().into()));
                Op::Binary(Binary::And, [scalar, mask])
            }
        }
    }

    pub(super) fn extract_lane(
        &mut self,
        lanes: Lanes,
        sign: Sign,
        lane: u8,
        vector: Value,
    ) -> Step {
        let size = size_of_lane(lanes);
        let (bytes, first) = (size.bytes(), lane * size.bytes());
        if size >= Size::S32 && sign == Sign::Signed {
            return self.to(Op::ExtractLane {
                lanes,
                sign: Sign::Unsigned,
                lane,
                vector,
            });
        }
        let (put, scalar) = match self.op(vector) {
            Op::ConstV128(constant) => {
                let bits =
                    lanes::extract(size, sign, self.function.vector_constant(constant), lane);
                return self.is_bits(lanes.scalar(), bits);
            }
            Op::Splat(put, scalar) => (put, scalar),
            Op::ReplaceLane {
                lanes: put,
                lane: replaced,
                args: [rest, scalar],
            } => {
                let put_bytes = size_of_lane(put).bytes();
                let start = replaced * put_bytes;
                if start + put_bytes <= first || first + bytes <= start {
                    return self.to(Op::ExtractLane {
                        lanes,
                        sign,
                        lane,
                        vector: rest,
                    });
                }
                (put, scalar)
            }
            Op::Shuffle(operands, pattern) => {
                let pattern = self.pattern(pattern);
                let wanted = &pattern[usize::from(first)..][..usize::from(bytes)];
                if wanted.iter().all(|&index| index >= 32) {
                    return self.is_bits(lanes.scalar(), 0);
                }
                let (start, mut pairs) = (wanted[0], (0..).zip(wanted));
                if start < 32
                    && start % bytes == 0
                    && pairs.all(|(offset, &index)| index == start + offset)
                {
                    let (vector, lane) = (operands[usize::from(start / 16)], start % 16 / bytes);
                    return self.to(Op::ExtractLane {
                        lanes,
                        sign,
                        lane,
                        vector,
                    });
                }
                return Step::Keep;
            }
            Op::Load {
                kind: Load::Full, ..
            } => {
                let kind = if size < Size::S32 {
                    Load::Narrow(size, sign)
                } else {
                    Load::Full
                };
                return match self.load_part_as(vector, first.into(), size, kind, lanes.scalar()) {
                    Some(loaded) => self.is(loaded),
                    None => Step::Keep,
                };
            }
            _ => return Step::Keep,
        };
        if size_of_lane(put) != size {
            Step::Keep
        } else if put == lanes && size >= Size::S32 {
            self.is(scalar)
        } else {
            let read = self.read_back(lanes, sign, scalar);
            self.to(read)
        }
    }

    pub(super) fn replace_lane(
        &mut self,
        lanes: Lanes,
        lane: u8,
        vector: Value,
        scalar: Value,
    ) -> Step {
        let size = size_of_lane(lanes);
        if let (Some(rest), Some(bits)) = (self.vector(vector), self.bits(scalar)) {
            return self.is_vector(lanes::replace(size, rest, lane, bits));
        }
        if let Some((lanes, scalar)) = self.plainer_scalar(lanes, scalar) {
            return self.to(Op::ReplaceLane {
                lanes,
                lane,
                args: [vector, scalar],
            });
        }
        match (self.op(vector), self.op(scalar)) {
            (
                Op::ReplaceLane {
                    lanes: put,
                    lane: same,
                    args: [rest, _],
                },
                _,
            ) if size_of_lane(put) == size && same == lane => self.to(Op::ReplaceLane {
                lanes,
                lane,
                args: [rest, scalar],
            }),
            (Op::Splat(put, same), _) if (put, same) == (lanes, scalar) => self.is(vector),
            (
                _,
                Op::ExtractLane {
                    lanes: from,
                    lane: taken,
                    vector: source,
                    ..
                },
            ) if size_of_lane(from) == size => {
                let is_put_back = (source, taken) == (vector, lane);
                if !is_put_back && size < Size::S32 && self.target.is_x64() {
                    return Step::Keep;
                }
                let bytes = size.bytes();
                let pattern = core::array::from_fn(|index| {
                    let index = index as u8;
                    if index / bytes == lane {
                        16 + taken * bytes + index % bytes
                    } else {
                        index
                    }
                });
                let pattern = self.intern_pattern(pattern);
                self.to(Op::Shuffle([vector, source], pattern))
            }
            (_, Op::Load { .. })
                if lane == 0 && size >= Size::S32 && self.vector(vector) == Some(0) =>
            {
                match self.load_part_as(scalar, 0, size, Load::VectorZero(size), Type::V128) {
                    Some(loaded) => self.is(loaded),
                    None => Step::Keep,
                }
            }
            _ => Step::Keep,
        }
    }
}
