//! These do too little for a call through a table. Callers pass `Baseline`, and get them inlined into their loops.

use bun_simd::*;
use core::ops::Range;

pub(crate) const SLOT_SHIFT: u32 = 4;
pub(crate) const LENGTH_SHIFT: u32 = 37;

type V<S, T> = Simd<T, B16, S>;

/// Where a search for matches at the last distances is.
#[derive(Clone, Copy)]
pub(crate) struct Place<'a> {
    /// From the offset into the match that `pair` is at. With fewer than 8 bytes, no code is ruled out.
    pub(crate) ring: &'a [u8],
    pub(crate) ring_mask: u32,
    pub(crate) position: u32,
    pub(crate) pair: [u8; 2],
}

/// From the farthest to the nearest position that each of the last distances stands for.
const SPAN: [u32; 4] = [6, 6, 0, 0];

#[simd]
impl Place<'_> {
    /// Also returns where it looked, which is negative if that is before the ring.
    fn codes_for<S: Isa>(&self, distances: V<S, i32>) -> Option<(u64, V<S, i32>)> {
        let from = (Simd::from(SPAN) >> 1) + self.position;
        let starts = ((from - distances.cast_unsigned()) & self.ring_mask) - SPAN;
        let [a, b, c, d] = starts.gather_windows::<_, 8, 4>(self.ring)?;
        let nearby = Simd::from([u64::from_le_bytes(*a), u64::from_le_bytes(*b)]);
        let nearby = nearby.bitcast::<u16>().in_blocks();
        let from_0 = nearby.lookup_bytes([3, 4, 11, 12, 0, 0, 0, 0, 4, 5, 2, 3, 5, 6, 1, 2]);
        let from_8 = nearby.lookup_bytes([6, 7, 0, 1, 12, 13, 10, 11, 13, 14, 9, 10, 14, 15, 8, 9]);
        let from_0 = from_0
            .with_lane::<2>(u16::from_le_bytes([c[0], c[1]]))
            .with_lane::<3>(u16::from_le_bytes([d[0], d[1]]));
        let pair = u16::from_le_bytes(self.pair);
        let codes = from_0.simd_eq(pair).narrow(from_8.simd_eq(pair));
        Some((codes.to_bitmask(), starts.cast_signed()))
    }
}

/// A bit for each of the 16 short distance codes that may lead to the pair.
#[simd]
pub(crate) fn short_codes(place: Place<'_>, last_distances: &[i32; 4]) -> u32 {
    match place.codes_for(Simd::from(last_distances)) {
        Some((codes, starts)) if starts.is_negative().none() => codes as u32,
        _ => 0xFFFF,
    }
}

/// [`short_codes`] for the first of `ranked`, and for the other four in 16 bits each, from the lowest.
#[simd]
pub(crate) fn short_codes_of_five(
    place: Place<'_>,
    last_distances: &[[i32; 4]; 8],
    // Three bits from `SLOT_SHIFT` on are an index into `last_distances`. The high half is a cost as an `f32`. If it is
    // positive, one of the other four gets no codes.
    ranked: &[u64; 5],
    // One of the other four gets no codes if it costs this or more and has the same distances as the first.
    hopeless: f32,
) -> (u32, u64) {
    let of = |rank: usize| Simd::from(last_distances[(ranked[rank] >> SLOT_SHIFT) as usize % 8]);
    let Some((mut first, mut all_starts)) = place.codes_for(of(0)) else {
        return (0xFFFF, u64::MAX);
    };
    let mut others = 0;
    unroll!(for nth in 0..4 {
        if let Some((codes, starts)) = place.codes_for(of(nth + 1)) {
            others |= codes << (16 * nth);
            all_starts |= starts;
        }
    });
    if all_starts.is_negative().any() {
        core::hint::cold_path();
        (first, others) = (0xFFFF, u64::MAX);
    }
    let like_first = |rank: usize| of(rank).simd_eq(of(0));
    let equal_bytes =
        (like_first(1).narrow(like_first(2))).narrow(like_first(3).narrow(like_first(4)));
    let is_like_first = equal_bytes.to_simd::<u8>().bitcast::<i32>().simd_eq(-1);
    let halves = |rank: usize| Simd::<u64, B16, S>::load(&ranked[rank..]).bitcast::<f32>();
    let costs = halves(1).deinterleave(halves(3))[1];
    let dropped = (is_like_first & costs.simd_ge(hopeless)) | costs.simd_gt(0.0);
    let dropped = dropped.cast::<i16>().to_simd::<u16>().bitcast::<u64>()[0];
    (first as u32, others & !dropped)
}

/// The cheapest known ways to each offset, seen from `offset`.
pub(crate) struct Ways<'a> {
    pub(crate) costs: &'a mut [f32],
    /// Three rows, each as long as `costs`: the copy length, the distance, and [`Start::insert`].
    pub(crate) nodes: &'a mut [u32],
    pub(crate) offset: u32,
}

struct Rows<'a> {
    costs: &'a mut [f32],
    nodes: [&'a mut [u32]; 3],
}

impl<'a> Ways<'a> {
    /// `reach` numbers of each row from `offset` on.
    #[inline(always)]
    fn reaching(self, reach: usize) -> Rows<'a> {
        // With 32 bits, nothing overflows, and this check is the only one.
        let (stride, offset) = (self.costs.len() as u32 as usize, self.offset as usize);
        assert!(offset + reach <= stride && 3 * stride <= self.nodes.len());
        let (lengths, rest) = self.nodes.split_at_mut(stride);
        let (distances, inserts) = rest.split_at_mut(stride);
        let nodes = [lengths, distances, inserts].map(|row| &mut row[offset..][..reach]);
        Rows {
            costs: &mut self.costs[..stride][offset..][..reach],
            nodes,
        }
    }
}

#[simd]
impl Rows<'_> {
    fn improve<S: Isa>(
        &mut self,
        at: usize,
        lengths: V<S, i32>,
        end: usize,
        cost: V<S, f32>,
        distance_and_insert: impl FnOnce() -> [V<S, u32>; 2],
    ) -> MaskOf<f32, B16, S> {
        let old = Simd::load(&self.costs[at..]);
        // With `&`, x86 tests the signs of the first mask once more.
        let mut better = cost.simd_lt(old);
        better &= lengths.simd_lt(end as i32);
        if better.any() {
            better.select(cost, old).store(&mut self.costs[at..]);
            let [distance, insert] = distance_and_insert();
            for (row, value) in
                self.nodes
                    .iter_mut()
                    .zip([lengths.cast_unsigned(), distance, insert])
            {
                better
                    .select(value, Simd::load(&row[at..]))
                    .store(&mut row[at..]);
            }
        }
        better
    }
}

/// What comes before a copy.
#[derive(Clone, Copy)]
pub(crate) struct Start<'a, const N: usize> {
    pub(crate) cost: f32,
    /// By copy length.
    pub(crate) symbol_costs: &'a [f32; N],
    pub(crate) insert: u32,
}

/// Takes the copies of `lengths` that are cheaper than what is known. The cost of the distance is in that of `start`.
#[simd]
pub(crate) fn try_lengths<const N: usize>(
    ways: Ways<'_>,
    Range {
        start: mut length,
        end,
    }: Range<usize>,
    extra_bits: &[f32; N],
    start: Start<'_, N>,
    distance: u32,
) {
    assert!(end <= N - 3);
    let mut rows = ways.reaching(N);
    let mut lengths = Simd::iota(length as i32);
    while length < end {
        let cost = Simd::splat(start.cost)
            + Simd::load(&extra_bits[length..])
            + Simd::load(&start.symbol_costs[length..]);
        rows.improve(length, lengths, end, cost, || {
            [Simd::splat(distance), Simd::splat(start.insert)]
        });
        lengths += 4;
        length += 4;
    }
}

/// [`try_lengths`] where all cost the same. Returns the longest that it took, or zero.
#[simd]
pub(crate) fn try_lengths_at_cost(
    ways: Ways<'_>,
    Range {
        start: mut length,
        end,
    }: Range<usize>,
    cost: f32,
    distance: u32,
    insert: u32,
) -> usize {
    assert!(end <= i32::MAX as usize - 3);
    let mut rows = ways.reaching(end + 3);
    let (mut lengths, mut longest) = (Simd::iota(length as i32), Simd::zero());
    while length < end {
        let better = rows.improve(length, lengths, end, Simd::splat(cost), || {
            [Simd::splat(distance), Simd::splat(insert)]
        });
        longest = better.select(lengths, longest);
        lengths += 4;
        length += 4;
    }
    longest.reduce_max() as usize
}

/// [`try_lengths`] with the first match that is long enough, and the cheaper start, or else the first.
#[simd]
pub(crate) fn try_matches<const N: usize>(
    ways: Ways<'_>,
    Range {
        start: mut length,
        end,
    }: Range<usize>,
    extra_bits: &[f32; N],
    [first, second]: [Start<'_, N>; 2],
    // The distance in the low half, and the length from `LENGTH_SHIFT` on.
    matches: &[u64; 4],
    count: usize,
    // From symbol 16 on, without postfix bits and direct codes.
    distance_costs: &[f32; 64],
) {
    const NONE: u32 = i32::MAX as u32;
    static MISSING: super::Aligned<[u32; 8]> = super::Aligned([0, 0, 0, 0, NONE, NONE, NONE, NONE]);
    assert!(end <= N - 3);
    let mut rows = ways.reaching(N);
    let [distances, lengths] = Simd::<u64, B16, S>::load(matches)
        .bitcast::<u32>()
        .deinterleave(Simd::<u64, B16, S>::load_last(matches).bitcast());
    let missing = Simd::load(&MISSING.0[4 - count.wrapping_sub(1) % 4..]);
    let longest = (lengths >> (LENGTH_SHIFT - 32) | missing).cast_signed();

    // The exponent is the number of extra bits, and the next bit tells the two symbols for it apart. The zero after
    // that stops a carry.
    let half = (distances + 3) >> 1;
    let top = (!(half >> 2) & half).cast_signed().cast::<f32>().to_bits() >> 22;
    let [low, high] = top.bitcast::<u64>().to_array();
    let distance_cost = Simd::from(
        [low, low >> 32, high, high >> 32].map(|symbol| distance_costs[symbol as usize % 64]),
    );
    let distance_bits = ((top >> 1).cast_signed() - 127).cast::<f32>();
    let (bases, bases2) = (
        first.cost + distance_bits + distance_cost,
        second.cost + distance_bits + distance_cost,
    );

    let mut lengths = Simd::iota(length as i32);
    while length < end {
        let exceeds = |limit: V<S, i32>| lengths.simd_gt(limit).to_simd::<i32>().bitcast::<u8>();
        let minus_index = exceeds(longest.splat_lane::<0>())
            + exceeds(longest.splat_lane::<1>())
            + exceeds(longest.splat_lane::<2>());
        let twice = minus_index + minus_index;
        let bytes = Simd::<u32, B16, S>::splat(0x0302_0100).bitcast() - (twice + twice);
        let extra = Simd::load(&extra_bits[length..]);
        let cost = bases.in_blocks().lookup_bytes_relaxed(bytes)
            + extra
            + Simd::load(&first.symbol_costs[length..]);
        let cost2 = bases2.in_blocks().lookup_bytes_relaxed(bytes)
            + extra
            + Simd::load(&second.symbol_costs[length..]);
        rows.improve(length, lengths, end, cost.simd_min_relaxed(cost2), || {
            let insert = cost2.simd_lt(cost).select(second.insert, first.insert);
            [distances.in_blocks().lookup_bytes_relaxed(bytes), insert]
        });
        lengths += 4;
        length += 4;
    }
}
