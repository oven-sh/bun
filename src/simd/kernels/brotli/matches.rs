//! For the match finders of Brotli. These have to be inlined into their loops.

use bun_simd::Shuffle;
use bun_simd::baseline::{F32, I8, I32, Mask, U8, U16, U32, U64, Vector};
use core::array::from_fn;
use core::ops::Range;

pub const SLOT_SHIFT: u32 = 4;
pub const LENGTH_SHIFT: u32 = 37;

const LANES: usize = 4;
const SHORT_COPY_END: usize = 70;

pub type CostByCopyLength = [f32; SHORT_COPY_END + LANES];

/// Where a search for matches at the last distances is.
#[derive(Clone, Copy)]
pub struct Place<'a> {
    /// From the offset into the match that `pair` is at.
    pub ring: &'a [u8],
    pub ring_mask: u32,
    pub position: u32,
    pub pair: [u8; 2],
}

/// The cheapest known ways to each offset, seen from `offset`.
pub struct Ways<'a> {
    pub costs: &'a mut [f32],
    /// Three rows, each as long as `costs`: the copy length, the distance, and [`Start::insert`].
    pub nodes: &'a mut [u32],
    pub offset: u32,
}

/// What comes before a copy.
#[derive(Clone, Copy)]
pub struct Start<'a> {
    pub cost: f32,
    pub symbol_costs: &'a CostByCopyLength,
    pub insert: u32,
}

/// From 8 bytes near each of the last two distances, the pairs for 8 codes.
struct CodesFrom<const FIRST: usize>;

impl Shuffle<16> for CodesFrom<0> {
    const FROM: [usize; 16] = [3, 4, 11, 12, 0, 0, 0, 0, 4, 5, 2, 3, 5, 6, 1, 2];
}

impl Shuffle<16> for CodesFrom<8> {
    const FROM: [usize; 16] = [6, 7, 0, 1, 12, 13, 10, 11, 13, 14, 9, 10, 14, 15, 8, 9];
}

/// For each code, the highest byte of the lane of its distance.
struct SignsByCode;

impl Shuffle<16> for SignsByCode {
    const FROM: [usize; 16] = [3, 7, 11, 15, 3, 3, 3, 3, 3, 3, 7, 7, 7, 7, 7, 7];
}

#[bun_simd::foreach_target(sse4, neon, portable)]
mod simd {
    #[export(baseline)]
    #[inline]
    pub fn lookup(table: [u8; 16], indices: [u8; 16]) -> [u8; 16] {
        let indices = isa::x128::U8::from_array(indices);
        isa::x128::U8::from_array(table).lookup(indices).to_array()
    }
}

#[inline(always)]
fn lookup(table: U8, indices: U8) -> U8 {
    U8::from_array(simd::lookup(table.to_array(), indices.to_array()))
}

/// The sign bit of a lane is set if its code may lead to the pair.
#[inline(always)]
fn codes(place: Place<'_>, distances: I32) -> Option<I8> {
    // From the farthest to the nearest position that each distance stands for.
    let span = I32::from_array([6, 6, 0, 0]);
    let nearest = (span >> 1) + place.position as i32 - distances;
    let starts = (nearest & place.ring_mask as i32) - span;
    // No match starts after the end, so it does not matter what is there in its place.
    let [a, b, c, d] = starts.bitcast::<U32>().windows::<_, 8>(place.ring)?;
    let nearby: U8 = U64::from_array([u64::from_le_bytes(*a), u64::from_le_bytes(*b)]).bitcast();
    let first: U16 = nearby.shuffle::<CodesFrom<0>>(nearby).bitcast();
    let mut first = first.to_array();
    first[2] = u16::from_le_bytes([c[0], c[1]]);
    first[3] = u16::from_le_bytes([d[0], d[1]]);
    let second: U16 = nearby.shuffle::<CodesFrom<8>>(nearby).bitcast();
    let is_pair = |v: U16| v.simd_eq(u16::from_le_bytes(place.pair)).to_vector();
    let found = U8::narrow(is_pair(U16::from_array(first)), is_pair(second));
    let starts: U8 = starts.bitcast();
    Some((found | starts.shuffle::<SignsByCode>(starts)).bitcast())
}

/// A bit for each of the 16 short distance codes that may lead to the pair.
#[inline(always)]
pub fn short_codes(place: Place<'_>, last_distances: &[i32; 4]) -> u32 {
    let codes = codes(place, I32::from_array(*last_distances));
    codes.map_or(0xFFFF, |codes| codes.simd_lt(0).to_bitmask() as u32)
}

#[inline(always)]
fn codes_of_four(place: Place<'_>, [a, b, c, d]: [I32; 4]) -> Option<u64> {
    let low = Vector::<_, 32>::from_halves([codes(place, a)?, codes(place, b)?]);
    let high = Vector::<_, 32>::from_halves([codes(place, c)?, codes(place, d)?]);
    let all = Vector::<_, 64>::from_halves([low, high]);
    Some(all.simd_lt(0).to_bitmask())
}

/// `short_codes` for the first, and for the other four from the low bits on.
#[inline(always)]
pub fn short_codes_of_five(
    place: Place<'_>,
    last_distances: &[[i32; 4]; 8],
    // Three bits from `SLOT_SHIFT` on choose the distances. The high half is a cost as an `f32`, and there are no codes if it is positive.
    ranked: &[u64; 5],
    // From this cost on, there are no codes for the same distances as those of the first.
    hopeless: f32,
) -> (u32, u64) {
    let distances = |rank: usize| &last_distances[(ranked[rank] >> SLOT_SHIFT) as usize % 8];
    let [first, a, b, c, d] = from_fn(|rank| I32::from_array(*distances(rank)));
    let best = short_codes(place, distances(0));
    let others = codes_of_four(place, [a, b, c, d]).unwrap_or(u64::MAX);
    let equal = |[a, b]: [I32; 2]| {
        Vector::<_, 8>::from_halves([a, b].map(|it| it.simd_eq(first).to_vector()))
    };
    let bytes = Vector::<_, 16>::from_halves([equal([a, b]), equal([c, d])]).cast::<i8>();
    let is_like_best = bytes.bitcast::<I32>().simd_eq(-1);
    let halves = |rank: usize| U64::from_slice(&ranked[rank..]).bitcast::<F32>();
    let costs = halves(1).deinterleave(halves(3)).1;
    let is_dropped = is_like_best.cast() & costs.simd_ge(hopeless) | costs.simd_gt(0.0);
    let dropped: Vector<u64, 1> = is_dropped.cast::<i16>().to_vector().bitcast();
    (best, others & !dropped[0])
}

/// Of [`Ways`], from the offset on.
struct Rows<'a> {
    costs: &'a mut [f32],
    nodes: [&'a mut [u32]; 3],
    end: I32,
}

impl<'a> Rows<'a> {
    /// For the lengths below `end`, and what fills the last vector.
    #[inline(always)]
    fn new(
        Ways {
            costs,
            nodes,
            offset,
        }: Ways<'a>,
        end: usize,
    ) -> Self {
        let part = offset as usize..offset as usize + end + LANES - 1;
        let (copies, rest) = nodes.split_at_mut(costs.len());
        let (distances, inserts) = rest.split_at_mut(costs.len());
        Self {
            costs: &mut costs[part.clone()],
            nodes: [
                &mut copies[part.clone()],
                &mut distances[part.clone()],
                &mut inserts[part],
            ],
            end: I32::splat(end as i32),
        }
    }

    /// With the length of `costs`, one check of `at` does for both.
    #[inline(always)]
    fn look_up(&self, table: &CostByCopyLength, at: usize) -> F32 {
        F32::from_slice(&table[..self.costs.len()][at..])
    }

    /// Returns which lengths it took.
    #[inline(always)]
    fn improve(
        &mut self,
        (at, lengths): (usize, I32),
        cost: F32,
        node: impl FnOnce() -> [U32; 2],
    ) -> Mask<i32, LANES> {
        let old = F32::from_slice(&self.costs[at..]);
        let is_better = cost.simd_lt(old).cast() & lengths.simd_lt(self.end);
        if is_better.any() {
            let cheaper = is_better.cast().select(cost, old);
            cheaper.copy_to_slice(&mut self.costs[at..]);
            let ([copies, distances, inserts], [distance, insert]) = (&mut self.nodes, node());
            let put = |row: &mut [u32], value: U32| {
                let value = is_better.cast().select(value, U32::from_slice(&row[at..]));
                value.copy_to_slice(&mut row[at..]);
            };
            put(copies, lengths.bitcast());
            put(distances, distance);
            put(inserts, insert);
        }
        is_better
    }
}

/// Every fourth one, and the four from there on. After `step_by`, LLVM would check each index.
#[inline(always)]
fn in_fours(lengths: Range<usize>) -> impl Iterator<Item = (usize, I32)> {
    let (mut at, mut four) = (lengths.start, I32::iota() + lengths.start as i32);
    core::iter::from_fn(move || {
        let this = (at < lengths.end).then_some((at, four))?;
        (at, four) = (at + LANES, four + LANES as i32);
        Some(this)
    })
}

/// Takes the copies of `lengths` that are cheaper than what is known. The cost of the distance is in that of `start`.
#[inline(always)]
pub fn try_lengths(
    ways: Ways<'_>,
    lengths: Range<usize>,
    extra_bits: &CostByCopyLength,
    start: Start<'_>,
    distance: u32,
) {
    assert!(lengths.end <= SHORT_COPY_END);
    let mut rows = Rows::new(ways, lengths.end);
    for (at, four) in in_fours(lengths) {
        let base = rows.look_up(extra_bits, at) + start.cost;
        let cost = base + rows.look_up(start.symbol_costs, at);
        let node = || [U32::splat(distance), U32::splat(start.insert)];
        rows.improve((at, four), cost, node);
    }
}

/// `try_lengths` where all cost the same. Returns the longest that it took, or zero.
#[inline(always)]
pub fn try_lengths_at_cost(
    ways: Ways<'_>,
    lengths: Range<usize>,
    cost: f32,
    distance: u32,
    insert: u32,
) -> usize {
    assert!(lengths.end <= i32::MAX as usize - LANES);
    let (mut rows, mut longest) = (Rows::new(ways, lengths.end), I32::zero());
    for (at, four) in in_fours(lengths) {
        let node = || [U32::splat(distance), U32::splat(insert)];
        let took = rows.improve((at, four), F32::splat(cost), node);
        longest = took.select(four, longest);
    }
    let longest = longest.simd_max(longest.reverse());
    longest.simd_max(longest.swap_pairs())[0] as usize
}

/// `try_lengths` with the first match that is long enough, and the cheaper start, or else the first.
#[inline(always)]
pub fn try_matches(
    ways: Ways<'_>,
    lengths: Range<usize>,
    extra_bits: &CostByCopyLength,
    starts: [Start<'_>; 2],
    // The distance in the low half, and the length from `LENGTH_SHIFT` on.
    matches: &[u64; LANES],
    count: usize,
    // From symbol 16 on, without postfix bits and direct codes.
    distance_costs: &[f32; 64],
) {
    static ENDLESS: [i32; 7] = [0, 0, 0, i32::MAX, i32::MAX, i32::MAX, i32::MAX];
    assert!(lengths.end <= SHORT_COPY_END);
    let mut rows = Rows::new(ways, lengths.end);
    let halves = |at: usize| U64::from_slice(&matches[at..]).bitcast::<U32>();
    let (distances, high) = halves(0).deinterleave(halves(2));
    let from_last = I32::from_slice(&ENDLESS[3 - count.wrapping_sub(1) % LANES..]);
    let longest = (high >> (LENGTH_SHIFT - 32)).bitcast::<I32>() | from_last;

    // The exponent is the number of extra bits, and the next bit tells the two symbols for it apart. The zero after that stops a carry.
    let half = (distances + 3) >> 1;
    let as_float = (half & !(half >> 2)).bitcast::<I32>().cast::<f32>();
    let top = as_float.bitcast::<U32>() >> 22;
    let [low, high] = (top & 63).bitcast::<U64>().to_array();
    let cost_of = |symbol: u64| distance_costs[symbol as usize % 64];
    let distance_cost = F32::from_array([
        cost_of(low),
        cost_of(low >> 32),
        cost_of(high),
        cost_of(high >> 32),
    ]);
    let distance_bits = ((top >> 1).bitcast::<I32>() - 127).cast::<f32>();
    let [first, second] = starts;
    let bases = distance_bits + first.cost + distance_cost;
    let other_bases = distance_bits + second.cost + distance_cost;

    for (at, four) in in_fours(lengths) {
        let exceeds = |i: usize| four.simd_gt(longest[i]).to_vector().bitcast::<U8>();
        let minus_index = exceeds(0) + exceeds(1) + exceeds(2);
        let twice = minus_index + minus_index;
        let bytes = U32::splat(0x0302_0100).bitcast::<U8>() - (twice + twice);
        let cost_from = |bases: F32, start: Start<'_>| {
            let base: F32 = lookup(bases.bitcast(), bytes).bitcast();
            base + rows.look_up(extra_bits, at) + rows.look_up(start.symbol_costs, at)
        };
        let (cost, other_cost) = (cost_from(bases, first), cost_from(other_bases, second));
        let cheaper = cost.simd_lt(other_cost).select(cost, other_cost);
        rows.improve((at, four), cheaper, || {
            let is_other = other_cost.simd_lt(cost).cast();
            let distance = lookup(distances.bitcast(), bytes).bitcast();
            [distance, is_other.select(second.insert, first.insert)]
        });
    }
}
