//! The kernels of `bun_brotli`, from src/jsc/bindings/highway_brotli.cpp.

unsafe extern "C" {
    fn highway_brotli_find_switches(
        symbols: *const u16,
        length: usize,
        symbol_costs: *const [f64; 8],
        alphabet_size: usize,
        groups: usize,
        switch_cost: f64,
        costs: *mut [f64; 8],
        switches: *mut u8,
        cheapest: *mut u8,
    );

    fn highway_brotli_estimate_costs(
        common: *const u32,
        others: &[*const u32; 4],
        size: usize,
        used: &[u64; MAX_SYMBOLS / 64],
        totals: &[u32; 4],
        gaps: &[[u32; 4]; 2],
        table: *mut [f64; 2],
        limit: u32,
        costs: &mut [f64; 4],
    );

    fn highway_brotli_remove_pairs(
        costs: *mut f64,
        pairs: *mut [u32; 2],
        count: usize,
        a: u32,
        b: u32,
    ) -> usize;

    fn highway_brotli_sort_leaves(
        leaves: *const u64,
        count: usize,
        like_shell_sort: bool,
        sorted: *mut u64,
    ) -> bool;

    fn highway_brotli_short_codes(
        bytes: *const u8,
        last_start: u32,
        ring_mask: u32,
        position: u32,
        pair: u16,
        distances: &[i32; 4],
    ) -> u32;

    fn highway_brotli_short_codes_of_five(
        bytes: *const u8,
        last_start: u32,
        ring_mask: u32,
        position: u32,
        pair: u16,
        distances: &[[i32; 4]; 8],
        ranked: &[u64; 5],
        hopeless: f32,
        others: &mut u64,
    ) -> u32;

    fn highway_brotli_try_lengths(
        costs: *mut f32,
        nodes: *mut u32,
        stride: usize,
        length: usize,
        end: usize,
        extra_bits: *const f32,
        symbol_costs: *const f32,
        base: f32,
        distance: u32,
        insert: u32,
    );

    fn highway_brotli_try_lengths_at_cost(
        costs: *mut f32,
        nodes: *mut u32,
        stride: usize,
        length: usize,
        end: usize,
        cost: f32,
        distance: u32,
        insert: u32,
    ) -> usize;

    fn highway_brotli_try_matches(
        costs: *mut f32,
        nodes: *mut u32,
        stride: usize,
        length: usize,
        end: usize,
        extra_bits: *const f32,
        matches: &[u64; 4],
        count: usize,
        distance_costs: &[f32; 64],
        first_symbol_costs: *const f32,
        first_base: f32,
        first_insert: u32,
        second_symbol_costs: *const f32,
        second_base: f32,
        second_insert: u32,
    );
}

/// Adds up what `symbols` cost in each histogram, where one can take over the sum of the cheapest for `switch_cost`.
#[inline(always)]
pub fn find_switches(
    symbols: &[u16],
    // For each symbol of the alphabet, as many as there are `costs`.
    symbol_costs: &[[f64; 8]],
    switch_cost: f64,
    // The sums, for groups of histograms.
    costs: &mut [[f64; 8]],
    // For each symbol and group, a bit for each histogram that takes over before the symbol.
    switches: &mut [u8],
    // For each symbol, the first of the cheapest histograms after it.
    cheapest: &mut [u8],
) {
    let groups = costs.len();
    assert!((1..=16).contains(&groups) && groups <= symbol_costs.len());
    assert!(symbols.len() <= cheapest.len().min(switches.len() / groups));
    // SAFETY: the kernel limits the symbols to the alphabet, and writes `groups` and one byte for each (asserted above).
    unsafe {
        highway_brotli_find_switches(
            symbols.as_ptr(),
            symbols.len(),
            symbol_costs.as_ptr(),
            symbol_costs.len() / groups,
            groups,
            switch_cost,
            costs.as_mut_ptr(),
            switches.as_mut_ptr(),
            cheapest.as_mut_ptr(),
        );
    }
}

/// `kMaxSymbols` in highway_brotli.cpp.
const MAX_SYMBOLS: usize = 704;

/// How many entries [`estimate_costs`] needs for numbers that have none: `kSpareEntries` in highway_brotli.cpp.
pub const SPARE_LOGARITHMS: usize = 256;

/// The bits for a prefix code and its symbols, for the sums of `common` and each of `others`. They have five symbols or more.
#[inline(always)]
pub fn estimate_costs(
    common: &[u32],
    others: [&[u32]; 4],
    // A bit for each symbol that any of them has.
    used: &[u64; MAX_SYMBOLS / 64],
    totals: &[u32; 4],
    // Up to the last symbol: the zeros in runs of one or two, and the number of longer runs.
    gaps: &[[u32; 4]; 2],
    // `[log2(n), n]` up to a power of two, with a million for the logarithm of zero, and then the spare entries.
    logarithms: &mut [[f64; 2]],
) -> [f64; 4] {
    let size = common.len();
    assert!(size <= MAX_SYMBOLS && size.is_multiple_of(8));
    assert!(others.iter().all(|other| other.len() == size));
    let known = logarithms.len().wrapping_sub(SPARE_LOGARITHMS);
    assert!(known.is_power_of_two() && known <= 1 << 24);
    let mut costs = [0.0; 4];
    // SAFETY: the kernel reads `size` counts of each, and replaces what is not `known` by a spare entry before it looks it up.
    unsafe {
        highway_brotli_estimate_costs(
            common.as_ptr(),
            &others.map(<[u32]>::as_ptr),
            size,
            used,
            totals,
            gaps,
            logarithms.as_mut_ptr(),
            2 * known as u32,
            &mut costs,
        );
    }
    costs
}

/// [`remove_pairs`] takes whole groups of this many.
pub const PAIR_GROUP: usize = 4;

/// Returns how many have neither `a` nor `b`. One that costs less than the first, or as much with a smaller difference, trades places with it.
#[inline(always)]
pub fn remove_pairs(costs: &mut [f64], pairs: &mut [[u32; 2]], [a, b]: [u32; 2]) -> usize {
    let count = costs.len();
    assert!(count != 0 && count == pairs.len() && count.is_multiple_of(PAIR_GROUP));
    // SAFETY: the kernel reads `count` of both, and writes no further than it has read.
    unsafe { highway_brotli_remove_pairs(costs.as_mut_ptr(), pairs.as_mut_ptr(), count, a, b) }
}

/// How many elements after the leaves the kernel may copy to the same index: `kLeafGroup` in highway_brotli.cpp.
pub const LEAF_SLACK: usize = 16;

/// Sorts the first `count` of `leaves` by their high halves, unless one is above 32766 or a slice is too short.
#[inline(always)]
pub fn sort_leaves(
    leaves: &[u64],
    count: usize,
    // With the gaps 132, 57, 23, 10, 4 and 1. Otherwise, ties keep their order.
    like_shell_sort: bool,
    sorted: &mut [u64],
) -> bool {
    count <= MAX_SYMBOLS
        && count + LEAF_SLACK <= leaves.len().min(sorted.len())
        // SAFETY: the kernel has room for `count` leaves, and limits its indices to `count + LEAF_SLACK - 1`.
        && unsafe {
            highway_brotli_sort_leaves(leaves.as_ptr(), count, like_shell_sort, sorted.as_mut_ptr())
        }
}

/// Where a search for matches at the last distances is.
#[derive(Clone, Copy)]
pub struct Place<'a> {
    /// From the offset into the match that `pair` is at. With fewer than 8 bytes, no code is ruled out.
    pub ring: &'a [u8],
    pub ring_mask: u32,
    pub position: u32,
    pub pair: [u8; 2],
}

impl Place<'_> {
    #[inline(always)]
    fn last_start(&self) -> Option<u32> {
        Some(self.ring.len().checked_sub(8)? as u32)
    }
}

/// A bit for each of the 16 short distance codes that may lead to the pair.
#[inline(always)]
pub fn short_codes(place: Place<'_>, last_distances: &[i32; 4]) -> u32 {
    let Some(last_start) = place.last_start() else {
        return 0xFFFF;
    };
    // SAFETY: the kernel reads 8 bytes from `last_start` at most.
    unsafe {
        highway_brotli_short_codes(
            place.ring.as_ptr(),
            last_start,
            place.ring_mask,
            place.position,
            u16::from_le_bytes(place.pair),
            last_distances,
        )
    }
}

/// `kSlotShift` in highway_brotli.cpp.
pub const SLOT_SHIFT: u32 = 4;

/// [`short_codes`] for the first, and for the other four from the low bits on.
#[inline(always)]
pub fn short_codes_of_five(
    place: Place<'_>,
    last_distances: &[[i32; 4]; 8],
    // Three bits from `SLOT_SHIFT` on choose the distances. The high half is a cost as an `f32`, and there are no codes if it is positive.
    ranked: &[u64; 5],
    // From this cost on, there are no codes for the same distances as those of the first.
    hopeless: f32,
) -> (u32, u64) {
    let Some(last_start) = place.last_start() else {
        return (0xFFFF, u64::MAX);
    };
    let mut others = 0;
    // SAFETY: the kernel reads 8 bytes from `last_start` at most.
    let first = unsafe {
        highway_brotli_short_codes_of_five(
            place.ring.as_ptr(),
            last_start,
            place.ring_mask,
            place.position,
            u16::from_le_bytes(place.pair),
            last_distances,
            ranked,
            hopeless,
            &mut others,
        )
    };
    (first, others)
}

/// The cheapest known ways to each offset, seen from `offset`.
pub struct Ways<'a> {
    pub costs: &'a mut [f32],
    /// Three rows, each as long as `costs`: the copy length, the distance, and [`Start::insert`].
    pub nodes: &'a mut [u32],
    pub offset: u32,
}

impl Ways<'_> {
    /// The two at `offset`, from where there are `reach` numbers in each row, and the length of a row.
    #[inline(always)]
    fn reaching(self, reach: usize) -> (*mut f32, *mut u32, usize) {
        let (stride, offset) = (self.costs.len(), self.offset as usize);
        assert!(offset + reach <= stride && 3 * stride <= self.nodes.len());
        let (costs, nodes) = (self.costs.as_mut_ptr(), self.nodes.as_mut_ptr());
        (
            costs.wrapping_add(offset),
            nodes.wrapping_add(offset),
            stride,
        )
    }

    /// For lengths below `end`, which there are tables of `N` numbers for.
    #[inline(always)]
    fn reaching_as_far_as_tables<const N: usize>(self, end: usize) -> (*mut f32, *mut u32, usize) {
        const { assert!(N >= 3) };
        assert!(end <= N - 3);
        self.reaching(N)
    }
}

/// What comes before a copy.
#[derive(Clone, Copy)]
pub struct Start<'a, const N: usize> {
    pub cost: f32,
    /// By copy length.
    pub symbol_costs: &'a [f32; N],
    pub insert: u32,
}

/// Takes the copies of `lengths` that are cheaper than what is known. The cost of the distance is in that of `start`.
#[inline(always)]
pub fn try_lengths<const N: usize>(
    ways: Ways<'_>,
    lengths: core::ops::Range<usize>,
    extra_bits: &[f32; N],
    start: Start<'_, N>,
    distance: u32,
) {
    let (costs, nodes, stride) = ways.reaching_as_far_as_tables::<N>(lengths.end);
    // SAFETY: the kernel touches up to `N` numbers of the tables, and of each row from the offset on (asserted above).
    unsafe {
        highway_brotli_try_lengths(
            costs,
            nodes,
            stride,
            lengths.start,
            lengths.end,
            extra_bits.as_ptr(),
            start.symbol_costs.as_ptr(),
            start.cost,
            distance,
            start.insert,
        );
    }
}

/// [`try_lengths`] where all cost the same. Returns the longest that it took, or zero.
#[inline(always)]
pub fn try_lengths_at_cost(
    ways: Ways<'_>,
    lengths: core::ops::Range<usize>,
    cost: f32,
    distance: u32,
    insert: u32,
) -> usize {
    let (length, end) = (lengths.start, lengths.end);
    assert!(end <= i32::MAX as usize - 3);
    let (costs, nodes, stride) = ways.reaching(end + 3);
    // SAFETY: the kernel touches up to `end + 3` numbers of each row from the offset on (asserted above).
    unsafe {
        highway_brotli_try_lengths_at_cost(
            costs, nodes, stride, length, end, cost, distance, insert,
        )
    }
}

/// `kLengthShift` in highway_brotli.cpp.
pub const LENGTH_SHIFT: u32 = 37;

/// [`try_lengths`] with the first match that is long enough, and the cheaper start, or else the first.
#[inline(always)]
pub fn try_matches<const N: usize>(
    ways: Ways<'_>,
    lengths: core::ops::Range<usize>,
    extra_bits: &[f32; N],
    [first, second]: [Start<'_, N>; 2],
    // The distance in the low half, and the length from `LENGTH_SHIFT` on.
    matches: &[u64; 4],
    count: usize,
    // From symbol 16 on, without postfix bits and direct codes.
    distance_costs: &[f32; 64],
) {
    assert!(lengths.start < lengths.end);
    let (costs, nodes, stride) = ways.reaching_as_far_as_tables::<N>(lengths.end);
    // SAFETY: as in `try_lengths`.
    unsafe {
        highway_brotli_try_matches(
            costs,
            nodes,
            stride,
            lengths.start,
            lengths.end,
            extra_bits.as_ptr(),
            matches,
            count,
            distance_costs,
            first.symbol_costs.as_ptr(),
            first.cost,
            first.insert,
            second.symbol_costs.as_ptr(),
            second.cost,
            second.insert,
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    /// The kernels are only linked into the full binary.
    macro_rules! stubs {
        ($($kernel:ident($($parameter:ty),*) -> $result:ty;)*) => {$(
            #[unsafe(no_mangle)]
            extern "C" fn $kernel($(_: $parameter),*) -> $result {
                Default::default()
            }
        )*};
    }
    type In = *const u8;
    type Out = *mut u8;
    stubs! {
        highway_brotli_remove_pairs(Out, Out, usize, u32, u32) -> usize;
        highway_brotli_try_lengths(Out, Out, usize, usize, usize, In, In, f32, u32, u32) -> ();
        highway_brotli_try_lengths_at_cost(Out, Out, usize, usize, usize, f32, u32, u32) -> usize;
        highway_brotli_try_matches(Out, Out, usize, usize, usize, In, In, usize, In, In, f32, u32, In, f32, u32) -> ();
    }

    thread_local! {
        static SIZES: Cell<[usize; 3]> = const { Cell::new([0; 3]) };
    }

    #[unsafe(no_mangle)]
    extern "C" fn highway_brotli_find_switches(
        _: In,
        length: usize,
        _: In,
        alphabet_size: usize,
        groups: usize,
        _: f64,
        _: Out,
        _: Out,
        _: Out,
    ) {
        SIZES.set([length, alphabet_size, groups]);
    }

    #[unsafe(no_mangle)]
    extern "C" fn highway_brotli_estimate_costs(
        _: In,
        _: In,
        size: usize,
        _: In,
        _: In,
        _: In,
        _: Out,
        limit: u32,
        _: Out,
    ) {
        SIZES.set([size, limit as usize, 0]);
    }

    #[unsafe(no_mangle)]
    extern "C" fn highway_brotli_sort_leaves(
        _: *const u64,
        _: usize,
        _: bool,
        _: *mut u64,
    ) -> bool {
        true
    }

    #[unsafe(no_mangle)]
    extern "C" fn highway_brotli_short_codes(
        _: In,
        last_start: u32,
        _: u32,
        _: u32,
        _: u16,
        _: In,
    ) -> u32 {
        last_start
    }

    #[unsafe(no_mangle)]
    extern "C" fn highway_brotli_short_codes_of_five(
        _: In,
        last_start: u32,
        _: u32,
        _: u32,
        _: u16,
        _: In,
        _: In,
        _: f32,
        _: Out,
    ) -> u32 {
        last_start
    }

    fn returns<T>(call: impl FnOnce() -> T) -> bool {
        std::panic::catch_unwind(std::panic::AssertUnwindSafe(call)).is_ok()
    }

    #[test]
    fn find_switches() {
        let fits = |symbol_costs, groups, switches, cheapest| {
            let (symbol_costs, mut costs) = (vec![[0.0; 8]; symbol_costs], vec![[0.0; 8]; groups]);
            let [mut switches, mut cheapest] = [vec![0; switches], vec![0; cheapest]];
            returns(|| {
                super::find_switches(
                    &[0; 5],
                    &symbol_costs,
                    0.0,
                    &mut costs,
                    &mut switches,
                    &mut cheapest,
                );
            })
        };
        assert!(fits(3, 3, 15, 5));
        assert!(fits(8, 3, 18, 6));
        assert_eq!(SIZES.get(), [5, 2, 3]);
        assert!(!fits(2, 3, 15, 5));
        assert!(!fits(3, 3, 14, 5));
        assert!(!fits(3, 3, 15, 4));
        assert!(!fits(3, 0, 15, 5));
        assert!(fits(16, 16, 80, 5));
        assert!(!fits(17, 17, 85, 5));
    }

    #[test]
    fn estimate_costs() {
        let fits = |size, [a, b, c, d]: [usize; 4], logarithms| {
            let (counts, mut logarithms) = (&[0; 712], vec![[0.0; 2]; logarithms]);
            let others = [&counts[..a], &counts[..b], &counts[..c], &counts[..d]];
            returns(|| {
                super::estimate_costs(
                    &counts[..size],
                    others,
                    &[0; 11],
                    &[0; 4],
                    &[[0; 4]; 2],
                    &mut logarithms,
                )
            })
        };
        let enough = 256 + 4;
        assert!(fits(704, [704; 4], enough));
        assert_eq!(SIZES.get(), [704, 2 * 4, 0]);
        assert!(!fits(712, [712; 4], enough));
        assert!(!fits(12, [12; 4], enough));
        for nth in 0..4 {
            let mut sizes = [16; 4];
            sizes[nth] = 8;
            assert!(!fits(16, sizes, enough));
        }
        for logarithms in [0, 4, enough - 5, enough - 4, enough - 1, enough + 1] {
            assert!(!fits(16, [16; 4], logarithms));
        }
    }

    #[test]
    fn remove_pairs() {
        let fits = |costs, pairs| {
            let (mut costs, mut pairs) = (vec![0.0; costs], vec![[0; 2]; pairs]);
            returns(|| super::remove_pairs(&mut costs, &mut pairs, [0, 1]))
        };
        assert!(fits(8, 8));
        for (costs, pairs) in [(0, 0), (6, 6), (8, 4), (4, 8)] {
            assert!(!fits(costs, pairs));
        }
    }

    #[test]
    fn sort_leaves() {
        let fits = |leaves, count, sorted| {
            super::sort_leaves(&vec![0; leaves], count, true, &mut vec![0; sorted])
        };
        assert!(fits(720, 704, 720));
        assert!(!fits(719, 704, 720));
        assert!(!fits(720, 704, 719));
        assert!(!fits(721, 705, 721));
        assert!(!fits(720, usize::MAX, 720));
    }

    #[test]
    fn short_codes() {
        let results = |len| {
            let place = Place {
                ring: &[0; 20][..len],
                ring_mask: u32::MAX,
                position: 0,
                pair: [0; 2],
            };
            (
                super::short_codes(place, &[0; 4]),
                super::short_codes_of_five(place, &[[0; 4]; 8], &[0; 5], 0.0),
            )
        };
        assert_eq!(results(20), (12, (12, 0)));
        assert_eq!(results(8), (0, (0, 0)));
        assert_eq!(results(7), (0xFFFF, (0xFFFF, u64::MAX)));
    }

    #[test]
    fn try_copies() {
        let fit = |costs, nodes, offset, [first, end]: [usize; 2]| {
            let (mut costs, mut nodes) = (vec![0.0; costs], vec![0; nodes]);
            let start = Start {
                cost: 0.0,
                symbol_costs: &[0.0; 12],
                insert: 0,
            };
            [false, true].map(|has_matches| {
                let ways = Ways {
                    costs: &mut costs,
                    nodes: &mut nodes,
                    offset,
                };
                let (lengths, bits) = (first..end, start.symbol_costs);
                returns(|| match has_matches {
                    false => super::try_lengths(ways, lengths, bits, start, 0),
                    true => {
                        super::try_matches(ways, lengths, bits, [start; 2], &[0; 4], 1, &[0.0; 64])
                    }
                })
            })
        };
        assert_eq!(fit(17, 51, 5, [2, 9]), [true; 2]);
        assert_eq!(fit(17, 51, 5, [2, 10]), [false; 2]);
        assert_eq!(fit(17, 51, 6, [2, 9]), [false; 2]);
        assert_eq!(fit(17, 50, 5, [2, 9]), [false; 2]);
        assert_eq!(fit(17, 51, u32::MAX, [2, 9]), [false; 2]);
        assert_eq!(fit(17, 51, 5, [9, 9]), [true, false]);
        assert_eq!(fit(17, 51, 5, [usize::MAX, 9]), [true, false]);
    }

    #[test]
    fn try_lengths_at_cost() {
        let fits = |costs, nodes, offset, end| {
            let ways = Ways {
                costs: &mut vec![0.0; costs],
                nodes: &mut vec![0; nodes],
                offset,
            };
            returns(|| super::try_lengths_at_cost(ways, 2..end, 0.0, 0, 0))
        };
        assert!(fits(17, 51, 5, 9));
        assert!(!fits(17, 51, 5, 10));
        assert!(!fits(17, 51, 6, 9));
        assert!(!fits(17, 50, 5, 9));
        assert!(!fits(17, 51, u32::MAX, 9));
        assert!(!fits(17, 51, 5, usize::MAX));
    }
}
