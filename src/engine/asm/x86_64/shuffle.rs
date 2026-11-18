//! Finds short sequences for shuffles.

use super::integer::MacroAssembler;
use super::opcode::{AvxUnary, Blendv, Sse, SseImm, SseMerge, SseShiftImm, SseUnary, SseUnaryImm};
use super::vector::has_avx2;
use crate::assembly::{FloatAssembly, Reuse, VectorAssembly};
use crate::features::X64Features;
use crate::operand::Size;
use crate::register::Fpr;
use crate::vector::pattern::{
    ANY, Pattern, Side, ZERO, highest, lanes_with, lowest, mask_of, whole_lanes,
};

const INSTRUCTION: u8 = 4;
const WITH_CONSTANT: u8 = 6;
/// Fewer ports run it than run `pand`.
const LOOKUP: u8 = 7;

/// An instruction that reads one vector.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Single {
    Zero,
    Move,
    Unary(SseUnary),
    Permute(SseUnaryImm, u8),
    Broadcast(AvxUnary),
    WithItself(Pair),
    Shift(SseShiftImm, u8),
    /// Clears the bytes that are not in the set.
    Keep(u16),
    Lookup(Pattern),
}

/// An instruction that reads two.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Pair {
    Plain(Sse),
    Imm(SseImm, u8),
    HighToLow,
    /// The bytes in the set, which are whole lanes, are from the second vector.
    Blend(Size, u16),
}

#[derive(Clone, Copy)]
pub(super) enum Plan {
    Single(Side, Single),
    /// Brings what is read into one vector.
    Gather {
        first: Side,
        pair: Pair,
        /// Does the same with the operands exchanged.
        reversed: Option<Pair>,
        then: Single,
    },
    /// Arranges each vector by itself. If one stays as it is, that is the first.
    Join {
        first: Side,
        prepare: [Single; 2],
        join: Pair,
    },
}

const fn unpack(op: Sse, size: Size, high: bool) -> (Pair, Pattern) {
    (Pair::Plain(op), Pattern::zip(size, high))
}

const LOW_UNPACKS: [(Pair, Pattern); 4] = [
    unpack(Sse::Punpcklqdq, Size::S64, false),
    unpack(Sse::Punpckldq, Size::S32, false),
    unpack(Sse::Punpcklwd, Size::S16, false),
    unpack(Sse::Punpcklbw, Size::S8, false),
];

const HIGH_UNPACKS: [(Pair, Pattern); 4] = [
    unpack(Sse::Punpckhqdq, Size::S64, true),
    unpack(Sse::Punpckhdq, Size::S32, true),
    unpack(Sse::Punpckhwd, Size::S16, true),
    unpack(Sse::Punpckhbw, Size::S8, true),
];

fn unpacks() -> impl Iterator<Item = (Pair, Pattern)> {
    LOW_UNPACKS.into_iter().chain(HIGH_UNPACKS)
}

/// Two bits for each of four lanes. One that is not read stays where it is.
fn order(lanes: [u8; 4]) -> u8 {
    (0..).zip(lanes).fold(0, |order, (place, lane)| {
        order | (if lane == ANY { place } else { lane % 4 }) << (2 * place)
    })
}

fn shufps([a, b, c, d]: [u8; 4]) -> (Pair, Pattern) {
    let result = Pattern::of_lanes([a % 4, b % 4, 4 + c % 4, 4 + d % 4]);
    (Pair::Imm(SseImm::Shufps, order([a, b, c, d])), result)
}

/// The bytes of the second vector from `first` on, and then those of the first.
fn palignr(first: u8) -> (Pair, Pattern) {
    let result = Pattern::window(first).swapped();
    (Pair::Imm(SseImm::Palignr, first), result)
}

/// `zeros` is a set of bytes.
fn insertps(from: u8, to: u8, zeros: u16) -> (Pair, Pattern) {
    let mut lanes = [0, 1, 2, 3];
    lanes[usize::from(to)] = 4 + from;
    let imm = from << 6 | to << 4 | lanes_with(Size::S32, zeros) as u8;
    let result = Pattern::of_lanes(lanes).with(zeros, ZERO);
    (Pair::Imm(SseImm::Insertps, imm), result)
}

/// The largest lanes of which none has bytes of both sets, and all bytes of those that have any of `second`.
fn separate(first: u16, second: u16) -> Option<(Size, u16)> {
    [Size::S32, Size::S16, Size::S8]
        .into_iter()
        .map(|size| (size, whole_lanes(size, second)))
        .find(|&(_, lanes)| lanes & first == 0)
}

impl Single {
    /// All indices are below 16.
    fn new(features: X64Features, pattern: Pattern) -> Self {
        let Some((place, index)) = pattern.first_read() else {
            return Self::Zero;
        };
        if pattern.accepts(Pattern::IDENTITY) {
            return Self::Move;
        }
        let down = index as i8 - place as i8;
        let found = if pattern.has_zero() {
            Self::extension(pattern).or_else(|| Self::shift(pattern, down))
        } else {
            Self::permutation(features, pattern)
                .or_else(|| Self::shift(pattern, down))
                .or_else(|| Self::with_itself(pattern, down))
        };
        if let Some(found) = found {
            found
        } else if pattern.keeps_places(16) {
            Self::Keep(pattern.taken_from(Side::First))
        } else {
            Self::insertion(pattern).unwrap_or(Self::Lookup(pattern))
        }
    }

    /// Not all bytes keep their places.
    fn insertion(pattern: Pattern) -> Option<Self> {
        let lanes: [u8; 4] = pattern.widen()?;
        let taken = whole_lanes(Size::S32, pattern.taken_from(Side::First));
        let to = lowest(pattern.missed_by(Pattern::IDENTITY) & taken) / 4;
        let (pair, result) = insertps(lanes[usize::from(to)], to, !taken);
        pattern
            .accepts(result.folded())
            .then_some(Self::WithItself(pair))
    }

    fn permutation(features: X64Features, pattern: Pattern) -> Option<Self> {
        if let Some(lanes) = pattern.widen() {
            return Some(Self::Permute(SseUnaryImm::Pshufd, order(lanes)));
        }
        if let Some([a, b, c, d, e, f, g, h]) = pattern.widen() {
            let keeps = |half: u16| {
                pattern.with(!half, ANY).accepts(Pattern::IDENTITY)
                    && pattern.with(half, ANY).read()[0] & half == 0
            };
            if keeps(0xff00) {
                return Some(Self::Permute(SseUnaryImm::Pshuflw, order([a, b, c, d])));
            }
            if keeps(0x00ff) {
                return Some(Self::Permute(SseUnaryImm::Pshufhw, order([e, f, g, h])));
            }
        }
        [
            (Size::S8, AvxUnary::Vpbroadcastb),
            (Size::S16, AvxUnary::Vpbroadcastw),
        ]
        .into_iter()
        .find(|&(size, _)| has_avx2(features) && pattern.accepts(Pattern::duplicate(size, 0)))
        .map(|(_, op)| Self::Broadcast(op))
    }

    fn with_itself(pattern: Pattern, down: i8) -> Option<Self> {
        unpacks()
            .chain([palignr(down as u8 % 16)])
            .find(|(_, result)| pattern.accepts(result.folded()))
            .map(|(pair, _)| Self::WithItself(pair))
    }

    fn extension(pattern: Pattern) -> Option<Self> {
        [
            (SseUnary::Pmovzxbw, Size::S8),
            (SseUnary::Pmovzxwd, Size::S16),
            (SseUnary::Pmovzxdq, Size::S32),
            (SseUnary::Movq, Size::S64),
        ]
        .into_iter()
        .find(|&(_, size)| pattern.accepts(Pattern::zero_extend(size, false)))
        .map(|(op, _)| Self::Unary(op))
    }

    fn shift(pattern: Pattern, down: i8) -> Option<Self> {
        use SseShiftImm::*;
        let (_, up_op, down_op, unit) = [
            (2, Psllw, Psrlw, 8),
            (4, Pslld, Psrld, 8),
            (8, Psllq, Psrlq, 8),
            (16, Pslldq, Psrldq, 1),
        ]
        .into_iter()
        .find(|&(group, ..)| pattern.accepts(Pattern::shift(group, down)))?;
        let op = if down < 0 { up_op } else { down_op };
        Some(Self::Shift(op, down.unsigned_abs() * unit))
    }

    fn cost(self) -> u8 {
        match self {
            Self::Move => 0,
            Self::Keep(_) => WITH_CONSTANT,
            Self::Lookup(_) => LOOKUP,
            _ => INSTRUCTION,
        }
    }

    /// Without AVX.
    fn works_in_place(self) -> bool {
        matches!(
            self,
            Self::WithItself(_) | Self::Shift(..) | Self::Keep(_) | Self::Lookup(_)
        )
    }
}

impl Pair {
    /// Both vectors are read.
    fn new(pattern: Pattern) -> Option<Self> {
        let [first, second] = Side::BOTH.map(|side| pattern.taken_from(side));
        if pattern.accepts(Pattern::blend(second)) {
            let blend = separate(first, second).filter(|&(size, _)| size != Size::S8);
            return blend.map(|(size, bytes)| Self::Blend(size, bytes));
        }
        let of_doublewords = pattern.widen().into_iter().flat_map(|lanes: [u8; 4]| {
            let to = lowest(second) / 4;
            [
                shufps(lanes),
                insertps(lanes[usize::from(to)] % 4, to, !(first | second)),
                (Self::HighToLow, Pattern::of_lanes([3, 1])),
            ]
        });
        let window = pattern
            .first_read()
            .map(|(place, index)| palignr(index.wrapping_sub(place) % 16));
        unpacks()
            .chain(of_doublewords)
            .chain(window)
            .find(|(_, result)| pattern.accepts(*result))
            .map(|(pair, _)| pair)
    }

    /// Those that leave these bytes of the operands in one vector.
    fn gathering(first: u16, second: u16) -> impl Iterator<Item = (Self, Pattern)> {
        let [a, b] = [first, second].map(|bytes| lanes_with(Size::S32, bytes));
        let ends = [lowest(a), highest(a), lowest(b), highest(b)];
        let unpacks = match (first | second).to_le_bytes() {
            [_, 0] => &LOW_UNPACKS[..],
            [0, _] => &HIGH_UNPACKS[..],
            _ => &[],
        };
        let others = [
            (a.count_ones() <= 2 && b.count_ones() <= 2).then(|| shufps(ends)),
            (a != 0xf && b.is_power_of_two()).then(|| insertps(lowest(b), lowest(!a), 0)),
            (highest(first) < lowest(second)).then(|| palignr(lowest(second))),
        ];
        unpacks.iter().copied().chain(others.into_iter().flatten())
    }

    fn cost(self) -> u8 {
        match self {
            Self::Blend(Size::S8, _) => INSTRUCTION + WITH_CONSTANT,
            _ => INSTRUCTION,
        }
    }

    fn commutes(self) -> bool {
        matches!(self, Self::Blend(..) | Self::Plain(Sse::Por))
    }
}

impl Plan {
    pub(super) fn new(features: X64Features, pattern: Pattern) -> Self {
        if let Some(side) = pattern.only_side() {
            return Self::Single(side, Single::new(features, pattern.folded()));
        }
        let gather = |first, pair, reversed, then| Self::Gather {
            first,
            pair,
            reversed,
            then,
        };
        let swapped = pattern.swapped();
        match (Pair::new(pattern), Pair::new(swapped)) {
            (Some(pair), reversed) => return gather(Side::First, pair, reversed, Single::Move),
            (None, Some(pair)) => return gather(Side::Second, pair, None, Single::Move),
            (None, None) => {}
        }

        let mut best = Self::join_by_or(features, pattern);
        let mut consider = |plan: Self| {
            if plan.cost() < best.cost() {
                best = plan;
            }
        };
        let gathered = |first: Side, (pair, result)| {
            let rest = first.pick(pattern, swapped).after(result);
            gather(first, pair, None, Single::new(features, rest))
        };
        let [lhs, rhs] = pattern.read();
        if let Some((size, bytes)) = separate(lhs, rhs)
            && (size != Size::S8 || features.contains(X64Features::AVX))
        {
            let blend = (Pair::Blend(size, bytes), Pattern::blend(bytes));
            consider(gathered(Side::First, blend));
        }
        for first in Side::BOTH {
            Self::join_by_blend(features, first, first.pick(pattern, swapped))
                .into_iter()
                .for_each(&mut consider);
        }
        for first in Side::BOTH {
            Pair::gathering(first.pick(lhs, rhs), first.pick(rhs, lhs))
                .map(|step| gathered(first, step))
                .chain(Self::joins_by_pack(
                    features,
                    first,
                    first.pick(pattern, swapped),
                ))
                .for_each(&mut consider);
        }
        best
    }

    fn join_by_or(features: X64Features, pattern: Pattern) -> Self {
        let part = |side: Side| pattern.replace(side.other(), ZERO).folded();
        Self::Join {
            first: Side::First,
            prepare: Side::BOTH.map(|side| Single::new(features, part(side))),
            join: Pair::Plain(Sse::Por),
        }
    }

    /// Lanes that are all zeros come with the second vector.
    fn join_by_blend(features: X64Features, first: Side, pattern: Pattern) -> Option<Self> {
        let [of_first, of_second] = Side::BOTH.map(|side| pattern.taken_from(side));
        let (size, bytes) = separate(of_second, of_first).filter(|&(size, _)| size != Size::S8)?;
        let part = |others| Single::new(features, pattern.with(others, ANY).folded());
        let prepare = [part(!bytes), part(bytes)];
        (prepare[1] != Single::Move).then_some(Self::Join {
            first,
            prepare,
            join: Pair::Blend(size, !bytes),
        })
    }

    /// Nothing saturates if the upper halves of the lanes are zero.
    fn joins_by_pack(
        features: X64Features,
        first: Side,
        pattern: Pattern,
    ) -> impl Iterator<Item = Self> {
        let has_halves = pattern.taken_from(Side::First) & 0xff00 == 0
            && pattern.taken_from(Side::Second) & 0x00ff == 0;
        [(Size::S8, Sse::Packuswb), (Size::S16, Sse::Packusdw)]
            .into_iter()
            .filter(move |_| has_halves)
            .map(move |(size, pack)| Self::Join {
                first,
                prepare: [false, true].map(|high| {
                    let spread = Pattern::zero_extend(size, high).of(pattern.folded());
                    Single::new(features, spread)
                }),
                join: Pair::Plain(pack),
            })
    }

    fn cost(self) -> u8 {
        match self {
            Self::Single(_, single) => single.cost(),
            Self::Gather { pair, then, .. } => pair.cost() + then.cost(),
            Self::Join { prepare, join, .. } => prepare[0].cost() + prepare[1].cost() + join.cost(),
        }
    }

    pub(super) fn scratch_fprs(self, has_avx: bool) -> u8 {
        match self {
            Self::Single(..) => 0,
            Self::Gather {
                pair: Pair::Blend(size, _),
                ..
            } => u8::from(size == Size::S8),
            Self::Gather { reversed, .. } => u8::from(!has_avx && reversed.is_none()),
            Self::Join { .. } => 1,
        }
    }

    pub(super) fn reuse(self, has_avx: bool) -> Reuse {
        let of = |side: Side, wanted| {
            if wanted {
                side.pick(Reuse::FIRST, Reuse::SECOND)
            } else {
                Reuse::empty()
            }
        };
        match self {
            Self::Single(side, Single::Move) => of(side, true),
            _ if has_avx => Reuse::empty(),
            Self::Single(side, single) => of(side, single.works_in_place()),
            Self::Gather {
                first,
                pair,
                reversed,
                ..
            } => of(first, true) | of(first.other(), pair.commutes() || reversed.is_some()),
            Self::Join {
                first,
                prepare: [Single::Move, second],
                ..
            } => of(first.other(), second.works_in_place()),
            Self::Join {
                first,
                prepare,
                join,
            } => {
                of(first, prepare[0].works_in_place())
                    | of(
                        first.other(),
                        prepare[1].works_in_place() && join.commutes(),
                    )
            }
        }
    }
}

impl MacroAssembler {
    /// The lanes of 16 or 32 bits in the set `from_rhs` are from `rhs`.
    pub(super) fn blend(&mut self, lanes: Size, dst: Fpr, lhs: Fpr, rhs: Fpr, from_rhs: u8) {
        let (op, all) = match lanes {
            Size::S32 => (SseImm::Blendps, 0x0f),
            _ => (SseImm::Pblendw, 0xff),
        };
        if self.has_avx() {
            return self.asm.sse_imm(op, dst, lhs, rhs, from_rhs);
        }
        let (lhs, rhs, from_rhs) = if dst == rhs {
            (rhs, lhs, from_rhs ^ all)
        } else {
            (lhs, rhs, from_rhs)
        };
        self.move_vector(dst, lhs);
        match (lanes, from_rhs) {
            (Size::S32, 0b01) => self.asm.sse_merge(SseMerge::Movss, dst, dst, rhs),
            (Size::S32, 0b11) => self.asm.sse_merge(SseMerge::Movsd, dst, dst, rhs),
            _ => self.asm.sse_imm(op, dst, dst, rhs, from_rhs),
        }
    }

    /// Without AVX `dst` is `rhs` only if it is `lhs` too or the instruction commutes.
    fn pair(&mut self, pair: Pair, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        match pair {
            Pair::Plain(op) => self.sse_binary(op, dst, lhs, rhs),
            Pair::Imm(op, imm) => {
                let lhs = self.first_source(dst, lhs);
                self.asm.sse_imm(op, dst, lhs, rhs, imm);
            }
            Pair::HighToLow => {
                let lhs = self.first_source(dst, lhs);
                self.asm.sse_merge(SseMerge::Movhlps, dst, lhs, rhs);
            }
            Pair::Blend(Size::S8, from_rhs) => {
                let mask = self.scratch_fpr(0);
                self.move_vector_constant(mask, mask_of(from_rhs));
                self.asm.blendv(Blendv::Vpblendvb, dst, lhs, rhs, mask);
            }
            Pair::Blend(lanes, from_rhs) => {
                self.blend(lanes, dst, lhs, rhs, lanes_with(lanes, from_rhs) as u8);
            }
        }
    }

    fn single(&mut self, single: Single, dst: Fpr, src: Fpr) {
        match single {
            Single::Zero => self.zero_vector(dst),
            Single::Move => self.move_vector(dst, src),
            Single::Unary(op) => self.asm.sse_unary(op, dst, src),
            Single::Permute(op, order) => self.asm.sse_unary_imm(op, dst, src, order),
            Single::Broadcast(op) => self.asm.avx_unary(op, dst, src),
            Single::WithItself(pair) => self.pair(pair, dst, src, src),
            Single::Shift(op, amount) => self.sse_shift(op, dst, src, amount),
            Single::Keep(bytes) => self.sse_with_constant(Sse::Pand, dst, src, mask_of(bytes)),
            Single::Lookup(pattern) => {
                self.sse_with_constant(Sse::Pshufb, dst, src, pattern.bits());
            }
        }
    }

    /// The operands differ unless the plan reads only one.
    pub(super) fn shuffle(&mut self, plan: Plan, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        match plan {
            Plan::Single(side, single) => self.single(single, dst, side.pick(lhs, rhs)),
            Plan::Gather {
                first,
                pair,
                reversed,
                then,
            } => {
                let (a, b) = first.pick((lhs, rhs), (rhs, lhs));
                if self.has_avx() || dst != b || pair.commutes() {
                    self.pair(pair, dst, a, b);
                    self.single(then, dst, dst);
                } else if let Some(reversed) = reversed {
                    self.pair(reversed, dst, b, a);
                } else {
                    let gathered = self.scratch_fpr(0);
                    self.pair(pair, gathered, a, b);
                    self.single(then, dst, gathered);
                }
            }
            Plan::Join {
                first,
                prepare,
                join,
            } => {
                let (a, b) = first.pick((lhs, rhs), (rhs, lhs));
                if prepare[0] == Single::Move {
                    let prepared = self.dst_unless(dst, a);
                    self.single(prepare[1], prepared, b);
                    return self.pair(join, dst, a, prepared);
                }
                let scratch = self.scratch_fpr(0);
                if dst == b && join.commutes() {
                    self.single(prepare[0], scratch, a);
                    self.single(prepare[1], dst, b);
                    self.pair(join, dst, scratch, dst);
                } else {
                    self.single(prepare[1], scratch, b);
                    self.single(prepare[0], dst, a);
                    self.pair(join, dst, dst, scratch);
                }
            }
        }
    }
}
