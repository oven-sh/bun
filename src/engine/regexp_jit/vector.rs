//! Tests of many units at once.

use bun_engine_asm::prelude::*;
use bun_engine_asm::{VectorBinary, VectorShift, lanes::splat};
use bun_engine_regexp::program::{ClassId, RowProbe, Step};
use bun_engine_regexp::set::{CharRange, Latin1Set, Set};
use smallvec::{SmallVec, smallvec};

use crate::frame::{CONSTANT, POSITION};
use crate::generator::{Generator, units};
use crate::lanes;

/// What a test that cannot be exact may get wrong.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Slack {
    TakesOthers,
    MissesMembers,
}

#[derive(Clone)]
pub(crate) struct VectorTest {
    shape: Shape,
    is_inverted: bool,
    pub(crate) is_exact: bool,
}

#[derive(Clone)]
enum Shape {
    /// `unit | mask == value` for one of them.
    Equal(SmallVec<[(u16, u16); 3]>),
    Range {
        first: u16,
        last: u16,
    },
    /// `low[byte & 15] & high[byte >> 4] != 0`
    Halves {
        low: [u8; 16],
        high: [u8; 16],
    },
}

/// How the units are in a register.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Lanes {
    Bytes,
    Words,
    /// Sixteen units of two bytes, each limited to 255.
    Narrowed,
}

impl Lanes {
    pub(crate) fn units(self) -> i32 {
        match self {
            Lanes::Bytes | Lanes::Narrowed => 16,
            Lanes::Words => 8,
        }
    }

    fn size(self) -> Size {
        match self {
            Lanes::Bytes | Lanes::Narrowed => Size::S8,
            Lanes::Words => Size::S16,
        }
    }

    /// In a mask that has been moved to a general register.
    fn log2_bits_per_unit(self) -> u8 {
        lanes::LOG2_BITS_PER_BYTE + self.size().log2_bytes()
    }

    fn pick(self, for_bytes: VectorBinary, for_words: VectorBinary) -> VectorBinary {
        match self {
            Lanes::Bytes | Lanes::Narrowed => for_bytes,
            Lanes::Words => for_words,
        }
    }
}

const MEMBERS_COMPARED: usize = 4;

/// The ranges up to `max`, or the gaps between them.
fn ranges_or_gaps(set: &Set, max: u32, gaps: bool) -> Option<SmallVec<[CharRange; 5]>> {
    let (mut found, mut next) = (SmallVec::new(), 0);
    for range in set.ranges().take_while(|range| range.first <= max) {
        if !gaps {
            found.push(CharRange::new(range.first, range.last.min(max)));
        } else if range.first > next {
            found.push(CharRange::new(next, range.first - 1));
        }
        if found.len() > MEMBERS_COMPARED {
            return None;
        }
        next = range.last + 1;
    }
    if gaps && next <= max {
        found.push(CharRange::new(next, max));
    }
    Some(found)
}

fn comparisons(ranges: &[CharRange]) -> Option<Shape> {
    let count: u32 = ranges.iter().map(|it| it.last - it.first + 1).sum();
    if let ([only], 2..) = (ranges, count) {
        let (first, last) = (only.first as u16, only.last as u16);
        return Some(Shape::Range { first, last });
    }
    if count as usize > MEMBERS_COMPARED || count == 0 {
        return None;
    }
    let mut values: SmallVec<[(u16, u16); 3]> = SmallVec::new();
    for c in ranges
        .iter()
        .flat_map(|it| it.first as u16..=it.last as u16)
    {
        let differs_in_one_bit = |it: &&mut (u16, u16)| it.1 == 0 && (it.0 ^ c).is_power_of_two();
        match values.iter_mut().find(differs_in_one_bit) {
            Some(value) => *value = (value.0 | c, value.0 ^ c),
            None => values.push((c, 0)),
        }
    }
    (values.len() < MEMBERS_COMPARED).then_some(Shape::Equal(values))
}

/// Gives a bit to each group of members with the same high half. Groups with the same low halves share one.
fn halves(set: &Latin1Set) -> Option<Shape> {
    let (mut low, mut high) = ([0; 16], [0; 16]);
    let mut groups: SmallVec<[u16; 8]> = SmallVec::new();
    for (index, bit_of_group) in high.iter_mut().enumerate() {
        let group = (set.words()[index / 4] >> (index % 4 * 16)) as u16;
        if group == 0 {
            continue;
        }
        let known = groups.iter().position(|&it| it == group);
        let bit = known.unwrap_or(groups.len());
        if known.is_none() {
            (bit < 8).then(|| groups.push(group))?;
            for (index, bits) in low.iter_mut().enumerate() {
                *bits |= ((group >> index & 1) as u8) << bit;
            }
        }
        *bit_of_group = 1 << bit;
    }
    Some(Shape::Halves { low, high })
}

impl VectorTest {
    /// One that compares whole units.
    fn comparing(set: &Set, max: u32) -> Option<VectorTest> {
        [false, true].into_iter().find_map(|is_inverted| {
            Some(VectorTest {
                shape: comparisons(&ranges_or_gaps(set, max, is_inverted)?)?,
                is_inverted,
                is_exact: true,
            })
        })
    }

    fn of_bytes(bytes: Latin1Set) -> Option<VectorTest> {
        VectorTest::comparing(&Set::from_latin1(bytes), 0xff).or_else(|| {
            let prefers_others = bytes.contains(0x80);
            [prefers_others, !prefers_others]
                .into_iter()
                .find_map(|is_inverted| {
                    Some(VectorTest {
                        shape: halves(&if is_inverted { !bytes } else { bytes })?,
                        is_inverted,
                        is_exact: true,
                    })
                })
        })
    }

    pub(crate) fn new(set: &Set, lanes: Lanes, slack: Slack) -> Option<VectorTest> {
        match lanes {
            Lanes::Bytes => VectorTest::of_bytes(*set.latin1()),
            Lanes::Words => VectorTest::comparing(set, 0xffff),
            Lanes::Narrowed => {
                let limited = CharRange::new(0xff, 0xffff);
                let (has_some, has_all) =
                    (set.intersects_range(limited), set.contains_range(limited));
                let mut bytes = *set.latin1() - Latin1Set::of(&[0xff]);
                if has_all || has_some && slack == Slack::TakesOthers {
                    bytes.insert(0xff);
                }
                let mut test = VectorTest::of_bytes(bytes)?;
                test.is_exact = has_some == has_all;
                Some(test)
            }
        }
    }

    /// Not for lanes that are narrowed, unless the value fits.
    fn of_unit(value: u16, mask: u16) -> VectorTest {
        VectorTest {
            shape: Shape::Equal(smallvec![(value, mask)]),
            is_inverted: false,
            is_exact: true,
        }
    }

    pub(crate) fn of_rows(probe: &RowProbe) -> VectorTest {
        VectorTest {
            shape: Shape::Halves {
                low: probe.low,
                high: probe.high,
            },
            is_inverted: false,
            is_exact: false,
        }
    }

    pub(crate) fn only_compares(&self) -> bool {
        !matches!(self.shape, Shape::Halves { .. })
    }
}

/// Lanes that are all ones or all zeros.
#[derive(Clone, Copy)]
pub(crate) struct Mask {
    register: Fpr,
    /// Ones are where the test fails.
    is_negative: bool,
}

/// The registers of one loop.
pub(crate) struct Vectors {
    pub(crate) lanes: Lanes,
    constants: SmallVec<[(u128, Fpr); 10]>,
}

const TEMPORARIES: usize = 4;

fn register(index: usize) -> Fpr {
    Fpr::new(lanes::VECTOR_REGISTERS[index])
}

const LOW_HALVES: u128 = splat(Size::S8, 0x0f);
const LIMIT: u128 = splat(Size::S16, 0xff);
const ASCII_ONLY: [u8; 16] = (u64::MAX as u128).to_le_bytes();

impl Vectors {
    pub(crate) fn new(lanes: Lanes) -> Vectors {
        Vectors {
            lanes,
            constants: SmallVec::new(),
        }
    }

    fn constants_of(&self, test: &VectorTest) -> SmallVec<[u128; 6]> {
        let size = self.lanes.size();
        let mut needed = SmallVec::new();
        if self.lanes == Lanes::Narrowed && lanes::NARROWING_NEEDS_LIMIT {
            needed.push(LIMIT);
        }
        match &test.shape {
            Shape::Equal(values) => {
                for &(value, mask) in values {
                    needed.push(splat(size, value.into()));
                    needed.extend((mask != 0).then(|| splat(size, mask.into())));
                }
            }
            &Shape::Range { first, last } => needed.extend(self.bias_and_bound(first, last)),
            Shape::Halves { low, high } => {
                needed.extend([0, u128::from_le_bytes(*low)]);
                needed.extend(masks_index(high).then_some(LOW_HALVES));
                needed.extend(reads_high_half(high).then(|| u128::from_le_bytes(*high)));
            }
        }
        needed
    }

    /// With the first added, the members are the least signed numbers up to the second.
    fn bias_and_bound(&self, first: u16, last: u16) -> [u128; 2] {
        let size = self.lanes.size();
        let least = 1u64 << (size.bits() - 1);
        [
            splat(size, least.wrapping_sub(first.into())),
            splat(size, least + u64::from(last - first)),
        ]
    }

    /// Whether there are registers for what the test needs.
    pub(crate) fn reserve(&mut self, test: &VectorTest) -> bool {
        let before = self.constants.len();
        for bits in self.constants_of(test) {
            if self.constants.iter().all(|it| it.0 != bits) {
                let index = TEMPORARIES + self.constants.len();
                if index == lanes::VECTOR_REGISTERS.len() {
                    self.constants.truncate(before);
                    return false;
                }
                self.constants.push((bits, register(index)));
            }
        }
        true
    }

    fn constant(&self, bits: u128) -> Fpr {
        let found = self.constants.iter().find(|it| it.0 == bits);
        found.expect("the constant has been reserved").1
    }
}

fn reads_high_half(high: &[u8; 16]) -> bool {
    *high != ASCII_ONLY && *high != [u8::MAX; 16]
}

fn masks_index(high: &[u8; 16]) -> bool {
    !lanes::LOOKUP_WRAPS || high[8..] != [0; 8]
}

impl Generator<'_> {
    /// The lanes in which the class can be tested best, and how.
    pub(crate) fn plan_vector(&self, class: ClassId, slack: Slack) -> Option<(Lanes, VectorTest)> {
        let set = self.program.class(class).set();
        let candidates: &[Lanes] = match self.unit_size() {
            Size::S8 => &[Lanes::Bytes],
            _ => &[Lanes::Words, Lanes::Narrowed],
        };
        let mut candidates = candidates.iter();
        candidates.find_map(|&lanes| Some((lanes, VectorTest::new(set, lanes, slack)?)))
    }

    pub(crate) fn lanes_for(&self, step: Step) -> Option<Lanes> {
        match (self.unit_size(), step) {
            (Size::S8, _) => Some(Lanes::Bytes),
            (_, Step::Unit { .. }) => Some(Lanes::Words),
            (_, Step::Class(class)) => Some(self.plan_vector(class, Slack::TakesOthers)?.0),
        }
    }

    /// One that can take others.
    pub(crate) fn plan_probe(&self, step: Step, lanes: Lanes) -> Option<VectorTest> {
        match step {
            Step::Unit { value, .. } if lanes == Lanes::Narrowed && value >= 0xff => None,
            Step::Unit { value, mask } => Some(VectorTest::of_unit(value, mask)),
            Step::Class(class) => {
                VectorTest::new(self.program.class(class).set(), lanes, Slack::TakesOthers)
            }
        }
    }

    pub(crate) fn load_constants(&mut self, vectors: &Vectors) {
        let constants = vectors.constants.iter();
        let address = self.tables.add_vectors(constants.map(|it| it.0));
        self.masm.move64(CONSTANT, address);
        for (index, &(bits, register)) in vectors.constants.iter().enumerate() {
            match bits {
                0 => self.masm.move_vector_constant(register, 0),
                _ => (self.masm).load_vector(register, Address::new(CONSTANT, index as i32 * 16)),
            }
        }
    }

    fn load_units(&mut self, vectors: &Vectors, dst: Fpr, spare: Fpr, offset: i32) {
        let address = self.unit_address(POSITION, offset);
        if vectors.lanes != Lanes::Narrowed {
            return self.masm.load_vector(dst, address);
        }
        self.masm.load_pair_vector(dst, spare, address);
        let limit = match lanes::NARROWING_NEEDS_LIMIT {
            true => vectors.constant(LIMIT),
            false => spare,
        };
        lanes::narrow(self.masm, dst, spare, limit);
    }

    /// Leaves in `dst` the bits that both halves of each byte in `units` have. Overwrites `units`.
    fn look_up_halves(
        &mut self,
        vectors: &Vectors,
        dst: Fpr,
        units: Fpr,
        low: &[u8; 16],
        high: &[u8; 16],
    ) {
        let (masm, lookup) = (&mut *self.masm, VectorBinary::I8x16RelaxedSwizzle);
        let spare = register(TEMPORARIES - 1);
        let mut index = units;
        if masks_index(high) {
            index = if reads_high_half(high) { spare } else { units };
            masm.vector_binary(
                VectorBinary::And,
                index,
                units,
                vectors.constant(LOW_HALVES),
            );
        }
        masm.vector_binary(
            lookup,
            dst,
            vectors.constant(u128::from_le_bytes(*low)),
            index,
        );
        if reads_high_half(high) {
            masm.vector_shift(VectorShift::I8x16ShrU, units, units, 4);
            masm.vector_binary(
                lookup,
                spare,
                vectors.constant(u128::from_le_bytes(*high)),
                units,
            );
            masm.vector_binary(VectorBinary::And, dst, dst, spare);
        }
    }

    fn test_units(&mut self, vectors: &Vectors, test: &VectorTest, offset: i32, dst: Fpr) -> Mask {
        let (lanes, size) = (vectors.lanes, vectors.lanes.size());
        let (units, spare) = (register(TEMPORARIES - 2), register(TEMPORARIES - 1));
        let equal = lanes.pick(VectorBinary::I8x16Eq, VectorBinary::I16x8Eq);
        let is_negative = match &test.shape {
            Shape::Equal(values) => {
                let units = if values.len() == 1 { dst } else { units };
                self.load_units(vectors, units, spare, offset);
                for (index, &(value, mask)) in values.iter().enumerate() {
                    let result = if index == 0 { dst } else { spare };
                    let mut compared = units;
                    if mask != 0 {
                        let mask = vectors.constant(splat(size, mask.into()));
                        self.masm
                            .vector_binary(VectorBinary::Or, result, units, mask);
                        compared = result;
                    }
                    let value = vectors.constant(splat(size, value.into()));
                    self.masm.vector_binary(equal, result, compared, value);
                    if index != 0 {
                        self.masm.vector_binary(VectorBinary::Or, dst, dst, spare);
                    }
                }
                false
            }
            &Shape::Range { first, last } => {
                let [bias, bound] = vectors
                    .bias_and_bound(first, last)
                    .map(|it| vectors.constant(it));
                self.load_units(vectors, dst, spare, offset);
                let add = lanes.pick(VectorBinary::I8x16Add, VectorBinary::I16x8Add);
                self.masm.vector_binary(add, dst, dst, bias);
                let greater = lanes.pick(VectorBinary::I8x16GtS, VectorBinary::I16x8GtS);
                self.masm.vector_binary(greater, dst, dst, bound);
                true
            }
            Shape::Halves { low, high } => {
                self.load_units(vectors, units, spare, offset);
                self.look_up_halves(vectors, dst, units, low, high);
                self.masm
                    .vector_binary(equal, dst, dst, vectors.constant(0));
                true
            }
        };
        Mask {
            register: dst,
            is_negative: is_negative != test.is_inverted,
        }
    }

    /// The lanes where all tests pass, each at its offset from the position.
    pub(crate) fn test_all(&mut self, vectors: &Vectors, tests: &[(i32, VectorTest)]) -> Mask {
        let (offset, first) = &tests[0];
        let mut all = self.test_units(vectors, first, *offset, register(0));
        for (offset, test) in &tests[1..] {
            let free = register(usize::from(all.register == register(0)));
            let next = self.test_units(vectors, test, *offset, free);
            let (op, dst, lhs, rhs) = match (all.is_negative, next.is_negative) {
                (false, false) => (VectorBinary::And, all, all, next),
                (true, true) => (VectorBinary::Or, all, all, next),
                (false, true) => (VectorBinary::AndNot, next, all, next),
                (true, false) => (VectorBinary::AndNot, all, next, all),
            };
            (self.masm).vector_binary(op, dst.register, lhs.register, rhs.register);
            all = Mask {
                register: dst.register,
                is_negative: all.is_negative && next.is_negative,
            };
        }
        all
    }

    /// The lanes where a row passes all its tests.
    pub(crate) fn test_rows(&mut self, vectors: &Vectors, tests: &[(i32, VectorTest)]) -> Mask {
        let (all, next, units, spare) = (register(0), register(1), register(2), register(3));
        for (index, (offset, test)) in tests.iter().enumerate() {
            let Shape::Halves { low, high } = &test.shape else {
                unreachable!("the test is that of a row")
            };
            self.load_units(vectors, units, spare, *offset);
            let dst = if index == 0 { all } else { next };
            self.look_up_halves(vectors, dst, units, low, high);
            if index != 0 {
                self.masm.vector_binary(VectorBinary::And, all, all, next);
            }
        }
        (self.masm).vector_binary(VectorBinary::I8x16Eq, all, all, vectors.constant(0));
        Mask {
            register: all,
            is_negative: true,
        }
    }

    /// Leaves bits for [`Self::first_lane`] in the first temporary register.
    pub(crate) fn branch_if_any_fails(&mut self, mask: Mask, target: Label) {
        let bits = self.frame.temporary(0);
        lanes::move_mask(self.masm, bits, mask.register);
        match mask.is_negative {
            true => self.masm.branch_if_not_zero64(bits, target),
            false => lanes::branch_if_any_is_clear(self.masm, bits, target),
        }
    }

    /// Leaves the bits of the lanes that pass in the first temporary register.
    pub(crate) fn branch_if_any_passes(&mut self, mask: Mask, target: Label) {
        let bits = self.frame.temporary(0);
        lanes::move_mask(self.masm, bits, mask.register);
        match mask.is_negative {
            true => lanes::invert_and_branch_if_any_is_set(self.masm, bits, target),
            false => self.masm.branch_if_not_zero64(bits, target),
        }
    }

    pub(crate) fn first_lane(&mut self, lanes: Lanes) -> Gpr {
        lanes::lowest_set_bit(self.masm, self.frame.temporary(0));
        self.lane_of_bit(lanes)
    }

    pub(crate) fn last_lane(&mut self, lanes: Lanes) -> Gpr {
        lanes::highest_set_bit(self.masm, self.frame.temporary(0));
        self.lane_of_bit(lanes)
    }

    fn lane_of_bit(&mut self, lanes: Lanes) -> Gpr {
        let bit = self.frame.temporary(0);
        if lanes.log2_bits_per_unit() != 0 {
            self.masm.shr32(bit, bit, lanes.log2_bits_per_unit());
        }
        bit
    }

    /// Clears the bits in the first temporary register of as many lanes as `count` says, and overwrites that.
    pub(crate) fn drop_first_lanes(&mut self, lanes: Lanes, count: Gpr) {
        let bits = self.frame.temporary(0);
        if lanes.log2_bits_per_unit() != 0 {
            self.masm.shl32(count, count, lanes.log2_bits_per_unit());
        }
        self.masm.shr64(bits, bits, count);
        self.masm.shl64(bits, bits, count);
    }

    /// Moves forward until `branch_out` branches, and goes to `done` with the position at `end` if it does not.
    /// The position is at least a vector before `end`.
    pub(crate) fn vector_loop(
        &mut self,
        lanes: Lanes,
        end: i64,
        done: Label,
        branch_out: impl FnOnce(&mut Self),
    ) {
        let last = end - i64::from(lanes.units());
        let again = self.masm.here();
        branch_out(self);
        self.masm.add64(POSITION, POSITION, lanes.units());
        self.masm.branch64(Cond::Le, POSITION, units(last), again);
        self.masm.branch64(Cond::Eq, POSITION, units(end), done);
        // What this has in common with the vector before has been looked at without a result.
        self.masm.move64(POSITION, units(last));
        self.masm.jump(again);
    }
}
