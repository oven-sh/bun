//! Finds short sequences for shuffles.

use super::macro_assembler::MacroAssembler;
use super::neon::VectorImm;
use super::neon_opcode::Arrangement::{self, B8, B16, H4, H8, S2, S4};
use super::neon_opcode::*;
use super::opcode::FloatUnary;
use super::registers::ZR;
use crate::assembly::{FloatAssembly, Reuse, VectorAssembly};
use crate::operand::Size::{self, S8, S16, S32, S64};
use crate::operand::{FloatWidth, Sign};
use crate::register::Fpr;
use crate::vector::lanes::count;
use crate::vector::pattern::{Pattern, Side, ZERO, highest, lanes_with, lowest, mask_of};

const INSTRUCTION: u8 = 2;
const LITERAL: u8 = INSTRUCTION + 1;
/// The move that there is no need for if the destination is the operand.
const LIKELY_MOVE: u8 = 1;
const LOOKUP: u8 = LITERAL + INSTRUCTION;

/// An instruction that reads two vectors.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Pair {
    Permute(NeonPermute, Size),
    Extract(u8),
    /// Changes the first.
    Insert {
        size: Size,
        to: u8,
        from: u8,
    },
}

/// An instruction that reads one, and what loads the constant it takes.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Single {
    Zero,
    Move,
    Duplicate(Size, u8),
    OnlyLane(Size, u8),
    ClearLane(Size, u8),
    Reverse(NeonUnary, Arrangement),
    Extend(Arrangement),
    ExtendUp(Arrangement),
    LowHalves(Arrangement),
    HighHalves(Arrangement),
    ShiftLeft(Size, u8),
    ShiftRight(Size, u8),
    WithItself(Pair),
    /// Zero is the operand on that side.
    WithZero(Pair, Side),
    /// Clears the bytes that are not in the set.
    Keep(u16),
    Lookup(Pattern),
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
    /// Arranges each vector by itself.
    Join {
        first: Side,
        prepare: [Single; 2],
        join: Pair,
    },
    /// Reads the vector on side `again` a second time, as the operand of `outer` on side `place`.
    Twice {
        first: Side,
        inner: Pair,
        again: Side,
        place: Side,
        outer: Pair,
    },
    /// The bytes in the set are from the second vector.
    Blend(u16),
    /// The bytes from this side stay in their places.
    LookupInto(Side),
    Lookups,
}

#[derive(Clone, Copy)]
struct Step {
    pair: Pair,
    result: Pattern,
    from_second: u16,
}

impl Step {
    const fn new(pair: Pair, result: Pattern) -> Self {
        Self {
            pair,
            result,
            from_second: result.taken_from(Side::Second),
        }
    }

    const fn permute(op: NeonPermute, size: Size) -> Self {
        let result = match op {
            NeonPermute::Zip1 => Pattern::zip(size, false),
            NeonPermute::Zip2 => Pattern::zip(size, true),
            NeonPermute::Uzp1 => Pattern::unzip(size, false),
            NeonPermute::Uzp2 => Pattern::unzip(size, true),
            NeonPermute::Trn1 => Pattern::transpose(size, false),
            NeonPermute::Trn2 => Pattern::transpose(size, true),
        };
        Self::new(Pair::Permute(op, size), result)
    }

    fn extract(first: u8) -> Self {
        Self::new(Pair::Extract(first), Pattern::window(first))
    }

    fn insert(size: Size, to: u8, from: u8) -> Self {
        let inserted = Pattern::duplicate(size, count(size) + from);
        let result = Pattern::IDENTITY.merged(bytes_of_lane(size, to), inserted);
        Self::new(Pair::Insert { size, to, from }, result)
    }
}

/// From large lanes to small ones. With two lanes all that take the first or the second are the same.
const PERMUTES: [Step; 20] = {
    use NeonPermute::*;
    let mut all = [Step::permute(Zip1, S64); 20];
    all[1] = Step::permute(Zip2, S64);
    let mut index = 0;
    while index < 18 {
        let op = [Zip1, Zip2, Uzp1, Uzp2, Trn1, Trn2][index % 6];
        all[2 + index] = Step::permute(op, [S32, S16, S8][index / 6]);
        index += 1;
    }
    all
};

/// The bytes that each of [`PERMUTES`] reads, which are the same for both operands.
const READ_BY_PERMUTES: [u16; 20] = {
    let mut all = [0; 20];
    let mut index = 0;
    while index < 20 {
        all[index] = PERMUTES[index].result.read()[0];
        index += 1;
    }
    all
};

fn permutes_down_to(size: Size) -> &'static [Step] {
    &PERMUTES[..20 - 6 * usize::from(size.log2_bytes())]
}

fn permutes_of(size: Size) -> &'static [Step] {
    let down_to = permutes_down_to(size);
    &down_to[down_to.len().saturating_sub(6)..]
}

const REVERSALS: [(Single, Pattern); 6] = {
    const fn entry(op: NeonUnary, group: u8, size: Size) -> (Single, Pattern) {
        let single = Single::Reverse(op, Arrangement::full(size));
        (single, Pattern::reverse(size, group))
    }
    [
        entry(NeonUnary::Rev64, 8, S32),
        entry(NeonUnary::Rev64, 8, S16),
        entry(NeonUnary::Rev64, 8, S8),
        entry(NeonUnary::Rev32, 4, S16),
        entry(NeonUnary::Rev32, 4, S8),
        entry(NeonUnary::Rev16, 2, S8),
    ]
};

/// What changes the size of lanes.
const RESIZES: [(Single, Pattern); 18] = {
    let mut all = [(Single::Zero, Pattern::IDENTITY); 18];
    let mut index = 0;
    while index < 6 {
        let shape = [S2, S4, H4, H8, B8, B16][index];
        let (size, second) = (shape.lanes(), shape.is_full());
        let up = Pattern::zip(size, second).swapped();
        let halves = if second {
            Single::HighHalves(Arrangement::half(size))
        } else {
            Single::LowHalves(shape)
        };
        all[index] = (Single::Extend(shape), Pattern::zero_extend(size, second));
        all[6 + index] = (Single::ExtendUp(shape), up.replace(Side::Second, ZERO));
        all[12 + index] = (
            halves,
            Pattern::unzip(size, second).replace(Side::Second, ZERO),
        );
        index += 1;
    }
    all
};

fn bytes_of_lane(size: Size, lane: u8) -> u16 {
    ((1 << size.bytes()) - 1) << (lane * size.bytes())
}

/// The lane of each size that has all of the bytes.
fn lanes_around(bytes: u16) -> impl Iterator<Item = (Size, u8)> {
    [S8, S16, S32, S64]
        .into_iter()
        .map(move |size| (size, lowest(bytes) / size.bytes()))
        .filter(move |&(size, lane)| lane == highest(bytes) / size.bytes())
}

fn mask_cost(bytes: u16) -> u8 {
    match VectorImm::new(mask_of(bytes)) {
        Some(_) => INSTRUCTION,
        None => LITERAL,
    }
}

impl Pair {
    /// `view` turns what an instruction gives into what to compare with the pattern.
    fn permutation(pattern: Pattern, view: impl Fn(Pattern) -> Pattern) -> Option<Self> {
        let (place, index) = pattern.first_read()?;
        let first = index.wrapping_sub(place) % 16;
        permutes_of(pattern.lanes())
            .iter()
            .map(|step| (step.pair, step.result))
            .chain([(Self::Extract(first), Pattern::window(first))])
            .find(|&(_, result)| pattern.accepts(view(result)))
            .map(|(pair, _)| pair)
    }

    /// The pattern is not the identity.
    fn insertion(pattern: Pattern, view: impl Fn(Pattern) -> Pattern) -> Option<Self> {
        let missed = pattern.missed_by(Pattern::IDENTITY);
        let index = pattern.at(lowest(missed)) % 16;
        lanes_around(missed)
            .map(|(size, to)| Step::insert(size, to, index / size.bytes()))
            .find(|step| pattern.accepts(view(step.result)))
            .map(|step| step.pair)
    }

    /// Those that leave these bytes of the operands in one vector.
    fn gathering(lanes: Size, [first, second]: [u16; 2]) -> impl Iterator<Item = Step> {
        let window = (highest(second) < lowest(first)).then(|| Step::extract(lowest(first)));
        let insertions = lanes_around(second).filter_map(move |(size, from)| {
            let to = lowest(!lanes_with(size, first));
            (to < count(size)).then(|| Step::insert(size, to, from))
        });
        let permutes = permutes_down_to(lanes).iter().zip(READ_BY_PERMUTES);
        permutes
            .filter(move |(_, read)| (first | second) & !read == 0)
            .map(|(step, _)| *step)
            .chain(window)
            .chain(insertions)
    }

    /// Those that take these bytes of the result from the operands.
    fn joining(pattern: Pattern, [first, second]: [u16; 2]) -> impl Iterator<Item = Step> {
        let window = (highest(first) < lowest(second)).then(|| Step::extract(16 - lowest(second)));
        let index = pattern.at(lowest(second)) % 16;
        let insertions = lanes_around(second)
            .map(move |(size, to)| Step::insert(size, to, index / size.bytes()));
        let fits = move |step: &Step| first & step.from_second | second & !step.from_second == 0;
        let permutes = permutes_down_to(pattern.lanes()).iter().copied();
        permutes.chain(insertions).filter(fits).chain(window)
    }

    fn works_in_place(self) -> bool {
        matches!(self, Self::Insert { .. })
    }

    fn cost(self) -> u8 {
        INSTRUCTION + u8::from(self.works_in_place()) * LIKELY_MOVE
    }
}

impl Single {
    /// All indices are below 16.
    fn new(pattern: Pattern) -> Self {
        let Some((place, index)) = pattern.first_read() else {
            return Self::Zero;
        };
        if pattern.accepts(Pattern::IDENTITY) {
            return Self::Move;
        }
        let found = if pattern.has_zero() {
            Self::filling_in_zeros(pattern, place, index).or_else(|| Self::with_zero(pattern))
        } else {
            Self::permutation(pattern, index)
                .or_else(|| Self::filling_in_zeros(pattern, place, index))
                .or_else(|| Pair::insertion(pattern, Pattern::folded).map(Self::WithItself))
        };
        found.unwrap_or(Self::Lookup(pattern))
    }

    fn permutation(pattern: Pattern, index: u8) -> Option<Self> {
        let duplicates = [S64, S32, S16, S8].into_iter().map(|size| {
            let lane = index / size.bytes();
            (Self::Duplicate(size, lane), Pattern::duplicate(size, lane))
        });
        duplicates
            .chain(REVERSALS)
            .find(|&(_, result)| pattern.accepts(result))
            .map(|(single, _)| single)
            .or_else(|| Pair::permutation(pattern, Pattern::folded).map(Self::WithItself))
    }

    fn filling_in_zeros(pattern: Pattern, place: u8, index: u8) -> Option<Self> {
        let only_lanes = [S64, S32, S16, S8].into_iter().map(|size| {
            let lane = index / size.bytes();
            let result = Pattern::duplicate(size, lane).with(!bytes_of_lane(size, 0), ZERO);
            (Self::OnlyLane(size, lane), result)
        });
        let down = index as i8 - place as i8;
        let shifts = [S64, S32, S16].into_iter().map(|size| {
            let shift = if down < 0 {
                Self::ShiftLeft
            } else {
                Self::ShiftRight
            };
            let result = Pattern::shift(size.bytes(), down);
            (shift(size, 8 * down.unsigned_abs()), result)
        });
        only_lanes
            .chain(RESIZES)
            .chain(shifts)
            .find(|&(_, result)| pattern.accepts(result))
            .map(|(single, _)| single)
    }

    fn with_zero(pattern: Pattern) -> Option<Self> {
        if pattern.keeps_places(16) {
            let cleared = pattern.missed_by(Pattern::IDENTITY);
            let kept = pattern.taken_from(Side::First);
            let lane =
                lanes_around(cleared).find(|&(size, lane)| bytes_of_lane(size, lane) & kept == 0);
            return Some(lane.map_or(Self::Keep(kept), |(size, lane)| Self::ClearLane(size, lane)));
        }
        Side::BOTH.into_iter().find_map(|zero| {
            let pair = Pair::permutation(pattern, |result| result.replace(zero, ZERO).folded())?;
            Some(Self::WithZero(pair, zero))
        })
    }

    fn works_in_place(self) -> bool {
        matches!(
            self,
            Self::ClearLane(..) | Self::WithItself(Pair::Insert { .. })
        )
    }

    fn takes_constant(self) -> bool {
        matches!(self, Self::WithZero(..) | Self::Keep(_) | Self::Lookup(_))
    }

    /// `of_move` is that of the move to the destination.
    fn cost(self, of_move: u8) -> u8 {
        match self {
            Self::Move => 0,
            Self::WithZero(..) => 2 * INSTRUCTION,
            Self::Keep(bytes) => mask_cost(bytes) + INSTRUCTION,
            Self::Lookup(_) => LOOKUP,
            _ => INSTRUCTION + u8::from(self.works_in_place()) * of_move,
        }
    }
}

impl Plan {
    pub(super) fn new(pattern: Pattern) -> Self {
        if let Some(side) = pattern.only_side() {
            return Self::Single(side, Single::new(pattern.folded()));
        }
        let gather = |first, pair, reversed, then| Self::Gather {
            first,
            pair,
            reversed,
            then,
        };
        let swapped = pattern.swapped();
        let seen_from = |first: Side| first.pick(pattern, swapped);
        for first in Side::BOTH {
            if let Some(pair) = Pair::permutation(seen_from(first), |result| result) {
                return gather(first, pair, None, Single::Move);
            }
        }
        match [pattern, swapped].map(|pattern| Pair::insertion(pattern, |result| result)) {
            [Some(pair), reversed] => return gather(Side::First, pair, reversed, Single::Move),
            [None, Some(pair)] => return gather(Side::Second, pair, None, Single::Move),
            [None, None] => {}
        }
        let taken = Side::BOTH.map(|side| pattern.taken_from(side));
        if pattern.accepts(Pattern::blend(taken[1])) {
            return Self::Blend(taken[1]);
        }

        let read = pattern.read();
        let candidates = Side::BOTH.into_iter().flat_map(|first| {
            let pattern = seen_from(first);
            let in_order = |[lhs, rhs]: [u16; 2]| first.pick([lhs, rhs], [rhs, lhs]);
            let gathers = Pair::gathering(pattern.lanes(), in_order(read)).map(move |step| {
                let then = Single::new(pattern.after(step.result));
                gather(first, step.pair, None, then)
            });
            let joins = Pair::joining(pattern, in_order(taken)).map(move |step| Self::Join {
                first,
                prepare: Side::BOTH
                    .map(|side| Single::new(pattern.before(step.result, side).folded())),
                join: step.pair,
            });
            let stays = !pattern.has_zero() && pattern.replace(Side::Second, ZERO).keeps_places(16);
            let lookup = stays.then_some(Self::LookupInto(first));
            gathers.chain(joins).chain(lookup)
        });
        let mut best = Self::Lookups;
        for candidate in candidates {
            if candidate.cost() == 2 * INSTRUCTION {
                return candidate;
            }
            if candidate.cost() < best.cost() {
                best = candidate;
            }
        }
        if pattern.keeps_places(4) {
            let twice = |again| Self::reading_twice(again, seen_from(again));
            return Side::BOTH.into_iter().find_map(twice).unwrap_or(best);
        }
        best
    }

    /// `again` is the first vector of `pattern`.
    fn reading_twice(again: Side, pattern: Pattern) -> Option<Self> {
        let lane_at = |place| Some(pattern.at(place) / 4).filter(|&lane| lane < 4);
        let insertions = (0..4).filter_map(|to| Some(Step::insert(S32, to, lane_at(4 * to)?)));
        let window = |place, more| lane_at(place).map(|lane| Step::extract(4 * (lane + more) % 16));
        let permutes = || permutes_down_to(S32).iter().copied();
        let as_first = permutes().chain(window(0, 0));
        let as_second = permutes().chain(window(12, 1)).chain(insertions);
        as_first
            .map(|step| (Side::First, step))
            .chain(as_second.map(|step| (Side::Second, step)))
            .filter(|&(place, step)| {
                let result = place.pick(step.result, step.result.swapped());
                pattern.missed_by(result) & place.pick(!step.from_second, step.from_second) == 0
            })
            .find_map(|(place, step)| {
                let rest = pattern.before(step.result, place.other());
                let (first, inner) = [(again, rest), (again.other(), rest.swapped())]
                    .into_iter()
                    .find_map(|(first, rest)| {
                        Some((first, Pair::permutation(rest, |same| same)?))
                    })?;
                Some(Self::Twice {
                    first,
                    inner,
                    again,
                    place,
                    outer: step.pair,
                })
            })
    }

    fn cost(self) -> u8 {
        match self {
            Self::Single(_, single) => single.cost(LIKELY_MOVE),
            Self::Gather { pair, then, .. } => pair.cost() + then.cost(0),
            Self::Join {
                prepare: [Single::Move, second],
                join,
                ..
            } => second.cost(INSTRUCTION) + join.cost(),
            Self::Join {
                prepare: [first, second],
                ..
            } => first.cost(LIKELY_MOVE) + second.cost(INSTRUCTION) + INSTRUCTION,
            Self::Twice { .. } => 2 * INSTRUCTION,
            Self::Blend(bytes) => mask_cost(bytes) + INSTRUCTION,
            Self::LookupInto(_) => LOOKUP + LIKELY_MOVE,
            Self::Lookups => LOOKUP + 2 * INSTRUCTION,
        }
    }

    fn needs_scratch(self) -> bool {
        match self {
            Self::Single(_, single) => single.takes_constant(),
            Self::Gather {
                pair,
                reversed,
                then,
                ..
            } => pair.works_in_place() && reversed.is_none() || then.takes_constant(),
            _ => true,
        }
    }

    pub(super) fn scratch_fprs(pattern: Pattern) -> u8 {
        (Self::new(pattern).needs_scratch() || Self::new(pattern.folded()).needs_scratch()).into()
    }

    pub(super) fn reuse(self) -> Reuse {
        let of = |side: Side, wanted| {
            if wanted {
                side.pick(Reuse::FIRST, Reuse::SECOND)
            } else {
                Reuse::empty()
            }
        };
        match self {
            Self::Single(side, single) => {
                of(side, single == Single::Move || single.works_in_place())
            }
            Self::Gather {
                first,
                pair,
                reversed,
                ..
            } => of(first, pair.works_in_place()) | of(first.other(), reversed.is_some()),
            Self::Join {
                first,
                prepare: [of_first, of_second],
                join,
            } => {
                let keeps_first = of_first == Single::Move && join.works_in_place();
                of(first, keeps_first || of_first.works_in_place())
                    | of(
                        first.other(),
                        of_second.works_in_place() && !join.works_in_place(),
                    )
            }
            Self::LookupInto(side) => of(side, true),
            Self::Twice { .. } | Self::Blend(_) | Self::Lookups => Reuse::empty(),
        }
    }
}

fn follows(next: Fpr, reg: Fpr) -> bool {
    next.0 == (reg.0 + 1) % 32
}

impl MacroAssembler {
    /// If `dst` is `rhs`, an instruction that works in place overwrites `lhs`.
    fn pair(&mut self, pair: Pair, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        match pair {
            Pair::Permute(op, size) => {
                self.asm
                    .neon_permute(op, Arrangement::full(size), dst, lhs, rhs);
            }
            Pair::Extract(first) => self.asm.ext(dst, lhs, rhs, first),
            Pair::Insert { size, to, from } => {
                let place = if dst == rhs { lhs } else { dst };
                self.move_vector(place, lhs);
                self.asm.ins_element(size, place, to, rhs, from);
                self.move_vector(dst, place);
            }
        }
    }

    fn constant_unless(&mut self, dst: Fpr, live: &[Fpr], bits: u128) -> Fpr {
        let constant = self.dst_unless(dst, live);
        self.move_vector_constant(constant, bits);
        constant
    }

    fn single(&mut self, single: Single, dst: Fpr, src: Fpr) {
        let full = Arrangement::full;
        match single {
            Single::Zero => self.asm.movi(dst, VectorImm::ZERO),
            Single::Move => self.move_vector(dst, src),
            Single::Duplicate(size, lane) => self.asm.dup_element(full(size), dst, src, lane),
            Single::OnlyLane(S64, 0) => {
                self.asm
                    .float_unary(FloatUnary::Fmov, FloatWidth::F64, dst, src);
            }
            Single::OnlyLane(size, lane) => self.asm.dup_scalar(size, dst, src, lane),
            Single::ClearLane(size, lane) => self.replace_int_lane(size, dst, src, lane, ZR),
            Single::Reverse(op, shape) => self.asm.neon_unary(op, shape, dst, src),
            Single::Extend(shape) => self.asm.neon_shift_long(Sign::Unsigned, shape, dst, src, 0),
            Single::ExtendUp(shape) => self.asm.shll(shape, dst, src),
            Single::LowHalves(shape) => self.asm.neon_narrow(NeonNarrow::Xtn, shape, dst, src),
            Single::HighHalves(shape) => {
                let bits = shape.lanes().bits();
                self.asm
                    .neon_shift_narrow(NeonShiftNarrow::Shrn, shape, dst, src, bits);
            }
            Single::ShiftLeft(size, amount) => {
                self.asm
                    .neon_shift_left(NeonShiftLeft::Shl, full(size), dst, src, amount);
            }
            Single::ShiftRight(size, amount) => {
                self.asm
                    .neon_shift_right(NeonShiftRight::Ushr, full(size), dst, src, amount);
            }
            Single::WithItself(pair) => self.pair(pair, dst, src, src),
            Single::WithZero(pair, side) => {
                let zero = self.constant_unless(dst, &[src], 0);
                self.pair(pair, dst, side.pick(zero, src), side.pick(src, zero));
            }
            Single::Keep(bytes) => {
                let mask = self.constant_unless(dst, &[src], mask_of(bytes));
                self.asm.neon_bitwise(NeonBitwise::And, dst, src, mask);
            }
            Single::Lookup(pattern) => {
                let indices = self.constant_unless(dst, &[src], pattern.bits());
                self.asm
                    .neon_lookup(NeonLookup::Tbl, B16, dst, src, 1, indices);
            }
        }
    }

    fn join(&mut self, prepare: [Single; 2], join: Pair, dst: Fpr, a: Fpr, b: Fpr) {
        match prepare {
            [Single::Move, single] => {
                let prepared = if join.works_in_place() {
                    self.scratch_fpr(0)
                } else {
                    self.dst_unless(dst, &[a])
                };
                self.single(single, prepared, b);
                self.pair(join, dst, a, prepared);
            }
            [single, Single::Move] => {
                let prepared = self.dst_unless(dst, &[b]);
                self.single(single, prepared, a);
                self.pair(join, dst, prepared, b);
            }
            [of_a, of_b] if of_a.takes_constant() || dst == b && of_b.works_in_place() => {
                let scratch = self.scratch_fpr(0);
                self.single(of_a, scratch, a);
                self.single(of_b, dst, b);
                self.pair(join, dst, scratch, dst);
            }
            [of_a, of_b] => {
                let scratch = self.scratch_fpr(0);
                self.single(of_b, scratch, b);
                self.single(of_a, dst, a);
                self.pair(join, dst, dst, scratch);
            }
        }
    }

    fn look_up_in_two(&mut self, pattern: Pattern, dst: Fpr, table: Fpr, live: &[Fpr]) {
        let indices = self.constant_unless(dst, live, pattern.bits());
        self.asm
            .neon_lookup(NeonLookup::Tbl, B16, dst, table, 2, indices);
    }

    /// `other` is not `dst`.
    fn look_up_anything(&mut self, pattern: Pattern, dst: Fpr, own: Fpr, other: Fpr) {
        if let [Some(one), Some(two)] = self.scratch.fprs {
            for (table, next) in [(one, two), (two, one)] {
                if follows(next, table) {
                    self.move_vector(table, own);
                    self.move_vector(next, other);
                    return self.look_up_in_two(pattern, dst, table, &[]);
                }
            }
        }
        // The complement of an index for one table is past the end of the other.
        let indices = self.scratch_fpr(0);
        let of_other = mask_of(pattern.taken_from(Side::Second));
        self.move_vector_constant(indices, pattern.folded().bits() ^ of_other);
        self.asm
            .neon_lookup(NeonLookup::Tbl, B16, dst, own, 1, indices);
        self.asm.neon_unary(NeonUnary::Not, B16, indices, indices);
        self.asm
            .neon_lookup(NeonLookup::Tbx, B16, dst, other, 1, indices);
    }

    pub(super) fn shuffle(&mut self, pattern: Pattern, dst: Fpr, lhs: Fpr, rhs: Fpr) {
        let pattern = if lhs == rhs {
            pattern.folded()
        } else {
            pattern
        };
        let plan = Plan::new(pattern);
        let seen_from =
            |first: Side| first.pick((pattern, lhs, rhs), (pattern.swapped(), rhs, lhs));
        if plan.cost() > LOOKUP && plan.needs_scratch() {
            for (pattern, table, next) in Side::BOTH.map(seen_from) {
                if follows(next, table) {
                    return self.look_up_in_two(pattern, dst, table, &[lhs, rhs]);
                }
            }
        }
        match plan {
            Plan::Single(side, single) => self.single(single, dst, side.pick(lhs, rhs)),
            Plan::Gather {
                first,
                pair,
                reversed,
                then,
            } => {
                let (_, a, b) = seen_from(first);
                if dst != b || !pair.works_in_place() {
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
                let (_, a, b) = seen_from(first);
                self.join(prepare, join, dst, a, b);
            }
            Plan::Twice {
                first,
                inner,
                again,
                place,
                outer,
            } => {
                let ((_, a, b), again) = (seen_from(first), again.pick(lhs, rhs));
                let partial = self.dst_unless(dst, &[again]);
                self.pair(inner, partial, a, b);
                let (a, b) = place.pick((again, partial), (partial, again));
                self.pair(outer, dst, a, b);
            }
            Plan::Blend(bytes) => {
                let mask = self.constant_unless(dst, &[lhs, rhs], mask_of(bytes));
                self.select_bits(dst, rhs, lhs, mask);
            }
            Plan::LookupInto(side) if dst != side.pick(rhs, lhs) => {
                let (pattern, kept, table) = seen_from(side);
                let indices = self.scratch_fpr(0);
                let of_table = pattern.replace(Side::First, ZERO).folded();
                self.move_vector_constant(indices, of_table.bits());
                self.move_vector(dst, kept);
                self.asm
                    .neon_lookup(NeonLookup::Tbx, B16, dst, table, 1, indices);
            }
            Plan::LookupInto(_) | Plan::Lookups => {
                let own = if dst == rhs {
                    Side::Second
                } else {
                    Side::First
                };
                let (pattern, own, other) = seen_from(own);
                self.look_up_anything(pattern, dst, own, other);
            }
        }
    }
}
