//! For the prefix codes of Brotli, in the arithmetic of google/brotli (LICENSE.md). Its output depends on each rounding.

use crate::Aligned;
use bun_simd::{Isa, Out, Shuffle, Writer, opaque};
use core::array::from_fn;
use core::hint::cold_path;
use core::mem::MaybeUninit;

pub use simd::{estimate_costs, find_switches, remove_pairs, sort_leaves};

/// More than anything costs. `remove_pairs` puts it first if no pair is left.
pub const TOO_MUCH: f64 = 1e99;
const MAX_SYMBOLS: usize = 704;
const WORD: usize = 64;
/// From a number to the index of its logarithm. An address on x86-64 cannot scale by the 16 bytes of an entry.
const SHIFT: u32 = cfg!(target_arch = "x86_64") as u32;

/// How many entries `estimate_costs` needs for numbers that have none.
pub const SPARE_LOGARITHMS: usize = 4 * WORD;

/// `remove_pairs` takes whole groups of this many.
pub const PAIR_GROUP: usize = 4;

/// How many elements after the leaves `sort_leaves` may copy to the same index.
pub const LEAF_SLACK: usize = 16;

static GAPS: [usize; 5] = [4, 10, 23, 57, 132];
/// The distances that are no sum of the gaps 4, 10 and 23. After their passes, leaves at all others are in order.
const LAST_DISTANCES: [usize; 15] = [1, 2, 3, 5, 6, 7, 9, 11, 13, 15, 17, 19, 21, 25, 29];
/// The last multiple of 4 that is no sum of the gaps 10, 23, 57 and 132.
const REACH_OF_GAP_4: usize = 128;
/// The room around the counts of leaves.
const BEFORE: usize = 2 * LEAF_SLACK;
const AFTER: usize = 3 * LEAF_SLACK;

/// In each block of 16, every fourth lane from the first, from the second and so on.
struct ByHistogram;

impl<const N: usize> Shuffle<N> for ByHistogram {
    const FROM: [usize; N] = from_fn(const |i| i / 16 * 16 + i % 4 * 4 + i % 16 / 4);
}

#[bun_simd::foreach_target(avx2, sse4, neon, portable)]
mod simd {
    use isa::x256::{F64, I64, U64};
    use isa::{I8, I16, I32, Mask, U16, Vector, x128, x256};

    type Eight = Vector<f64, 8>;

    #[inline(always)]
    fn min_in_all_lanes(eight: Eight) -> Eight {
        let [a, b] = eight.halves();
        let [c, d] = a.min(b).halves();
        let four = F64::from_halves([c, d]).min(F64::from_halves([d, c]));
        Eight::from_halves([four.min(four.swap_pairs()); 2])
    }

    /// Adds up what `symbols` cost in each histogram, where one can take over the sum of the cheapest for `switch_cost`.
    #[export]
    pub fn find_switches(
        symbols: &[u16],
        // For each symbol up to the highest, as many as there are `costs`. All sums stay finite.
        symbol_costs: &[[f64; 8]],
        switch_cost: f64,
        // The sums, for up to 16 groups of histograms.
        costs: &mut [[f64; 8]],
        // For each symbol and group, a bit for each histogram that takes over before the symbol.
        switches: &mut [u8],
        // For each symbol, the first of the cheapest histograms after it.
        cheapest: &mut [u8],
    ) {
        const PROLOGUE: usize = 2000;
        let groups = costs.len();
        assert!((1..=16).contains(&groups));
        let switches = switches[..symbols.len() * groups].chunks_exact_mut(groups);
        let each = symbols.iter().zip(&mut cheapest[..symbols.len()]);
        let (mut min_cost, mut max_cost) = (Eight::zero(), Eight::splat(TOO_MUCH));
        let mut previous = &mut 0;
        for (position, ((&symbol, cheapest), switches)) in each.zip(switches).enumerate() {
            let added = &symbol_costs[usize::from(symbol) * groups..][..groups];
            let mut zeros = 0u128;
            // Finishes the previous symbol, which had to wait for `min_cost`.
            let mut step = |group: usize| {
                let relative = Eight::load(&costs[group]) - min_cost;
                switches[group] = relative.simd_ge(max_cost).to_bitmask() as u8;
                zeros = zeros << 8 | u128::from(relative.simd_eq(0.0).to_bitmask());
                let next = relative.min(max_cost) + Eight::load(&added[group]);
                next.store(&mut costs[group]);
                next
            };
            let mut smallest = step(groups - 1);
            #[rustc_unroll(never)]
            for group in (0..groups - 1).rev() {
                smallest = step(group).min(smallest);
            }
            *previous = zeros.trailing_zeros() as u8;
            previous = cheapest;
            min_cost = min_in_all_lanes(smallest);
            max_cost = Eight::splat(match position {
                ..PROLOGUE => switch_cost * (0.77 + 0.07 / PROLOGUE as f64 * position as f64),
                _ => switch_cost,
            });
        }
        let first = (costs.as_flattened().iter()).position(|&cost| cost == min_cost[0]);
        *previous = first.unwrap_or(0) as u8;
    }

    /// Makes entries from `known` on for the numbers that are not below it, and points to them.
    #[inline(never)]
    fn add_entries(table: &mut [[f64; 2]], known: u32, indices: &mut [u32]) {
        let mut next = known;
        for eight in indices.as_chunks_mut().0 {
            let high_bits = x256::U32::load(eight) & (known << SHIFT).wrapping_neg();
            let mut large = high_bits.simd_ne(0).to_bitmask();
            while large != 0 {
                let index = &mut eight[large.trailing_zeros() as usize % 8];
                let number = f64::from(*index >> SHIFT);
                table[next as usize] = [number.log2(), number];
                (*index, next) = (next << SHIFT, next + 1);
                large &= large - 1;
            }
        }
    }

    /// The logarithms and the numbers.
    #[inline(always)]
    fn look_up(table: &[[f64; 2]], indices: [u32; 4]) -> (F64, F64) {
        let last = table.as_flattened().len().checked_sub(2).unwrap();
        let entry = |lane: usize| match (SHIFT, indices[lane] as usize) {
            (0, at) => x128::F64::load(&table[at]),
            (_, at) => {
                assert!(at <= last);
                x128::F64::from_slice(&table.as_flattened()[at..])
            }
        };
        let even = F64::from_halves([entry(0), entry(2)]);
        even.interleave_in_blocks(F64::from_halves([entry(1), entry(3)]))
    }

    struct Sums {
        bits: F64,
        /// For the codes of runs of zeros.
        bits_for_runs: x128::I32,
        last_symbol: x128::I32,
    }

    /// The lengths of the codes are negative for symbols that a histogram does not have.
    #[inline(always)]
    fn add_symbols<const HAS_RUNS: bool>(
        mut word: u64,
        indices: &[u32; 4 * WORD + 1],
        (table, log_of_total): (&[[f64; 2]], F64),
        sums: &mut Sums,
        lengths: &mut Writer<'_, [i32; 4]>,
    ) {
        static SYMBOLS: [i32; WORD + 1] = from_fn(const |i| i as i32);
        let bits_by_gap = x128::U8::from_array([0, 0, 0, 0, 3, 3, 3, 3, 3, 3, 3, 6, 0, 0, 0, 0]);
        lengths.extend_with(0..word.count_ones(), |_| {
            let symbol = word.trailing_zeros() as usize;
            word &= word.wrapping_sub(1);
            let row = |lane: usize| indices[lane * WORD + symbol];
            let (log, number) = look_up(table, [row(0), row(1), row(2), row(3)]);
            let cost = log_of_total - log;
            let length = (cost + 0.5).to_i32();
            if HAS_RUNS {
                let last = (length.simd_min(0) + SYMBOLS[symbol]).simd_max(sums.last_symbol);
                let gap = last - sums.last_symbol;
                sums.last_symbol = last;
                // Like adding 3 twice: with five symbols or more, a sum that can be inexact is above 4.
                let bits: x128::I32 = bits_by_gap.lookup(gap.simd_min(11).bitcast()).bitcast();
                sums.bits += bits.cast::<f64>();
                sums.bits_for_runs += bits;
                if gap.simd_gt(66).any() {
                    cold_path();
                    for zeros in [66, 514] {
                        let bits = gap.simd_gt(zeros).select(3, 0);
                        sums.bits += bits.cast::<f64>();
                        sums.bits_for_runs += bits;
                    }
                }
            }
            sums.bits += number * cost;
            Some([length.to_array()])
        });
    }

    /// For the sum of every fourth byte.
    #[inline(always)]
    fn index_by_histogram(counts: I8) -> x128::U32 {
        let pairs = U16::sums_of_2(counts.shuffle::<ByHistogram>(counts).bitcast());
        let fours = I32::pairwise_dot(pairs.bitcast(), I16::splat(1 << SHIFT)).to_array();
        let blocks = fours.as_chunks().0.iter().map(|it| x128::I32::load(it));
        blocks.fold(x128::I32::zero(), |a, b| a + b).bitcast()
    }

    /// The bits for a prefix code and its symbols, for the sums of `common` and each of `others`. They have five or more of 64 to 704 symbols.
    #[export]
    pub fn estimate_costs(
        common: &[u32],
        others: [&[u32]; 4],
        // A bit for each symbol that any of them has.
        used: &[u64; MAX_SYMBOLS / WORD],
        totals: &[u32; 4],
        // Up to the last symbol: the zeros in runs of one or two, and zero if there is no longer run.
        gaps: &[[u32; 4]; 2],
        // `[log2(n), n]` up to a power of two, with a million for the logarithm of zero, and then the spare entries.
        logarithms: &mut [[f64; 2]],
    ) -> [f64; 4] {
        const PACKED: usize = I8::LEN / 4;
        let size = common.len();
        assert!((WORD..=MAX_SYMBOLS).contains(&size));
        assert!(others.iter().all(|other| other.len() == size));
        let known = logarithms.len().wrapping_sub(SPARE_LOGARITHMS);
        assert!(known.is_power_of_two() && known <= 1 << 24);
        let log_of_total = F64::from_array(from_fn(|lane| match totals[lane] as usize {
            total if total < known => logarithms[total][0],
            total => (total as f64).log2(),
        }));
        let (known, has_runs) = (known as u32, gaps[1] != [0; 4]);

        let mut room = Aligned([MaybeUninit::uninit(); MAX_SYMBOLS + PACKED]);
        let mut lengths = Out::from(&mut room.0[..]).into_writer();
        let mut sums = Sums {
            bits: F64::zero(),
            bits_for_runs: x128::I32::zero(),
            last_symbol: x128::I32::splat(-1),
        };
        let mut previous_first = 0;
        for (i, &word) in used[..size.div_ceil(WORD)].iter().enumerate() {
            // The last ones overlap.
            let first = (i * WORD).min(size - WORD);
            let word = word << (i * WORD - first);
            if word == 0 {
                continue;
            }
            sums.last_symbol -= (first - previous_first) as i32;
            previous_first = first;
            let counts =
                |all: &[u32], at: usize| x256::U32::from_slice(&all[first..][..WORD][at..]);
            let mut room = Aligned([MaybeUninit::uninit(); 4 * WORD + 1]);
            let mut indices = Out::from(&mut room.0[..]).into_writer();
            let mut any = x256::U32::zero();
            #[rustc_unroll(full)]
            for other in others {
                indices.extend_with((0..WORD).step_by(8), |at| {
                    let sum = counts(common, at) + counts(other, at);
                    any |= sum;
                    Some((sum << SHIFT).to_array())
                });
            }
            indices.push([0]);
            let indices = indices.finish().first_chunk_mut().unwrap();
            if (any & known.wrapping_neg()).simd_ne(0).any() {
                cold_path();
                add_entries(logarithms, known, indices);
            }
            let logarithms = (&*logarithms, log_of_total);
            match has_runs {
                true => add_symbols::<true>(word, indices, logarithms, &mut sums, &mut lengths),
                false => add_symbols::<false>(word, indices, logarithms, &mut sums, &mut lengths),
            }
        }
        lengths.push([[-1; 4]; PACKED - 1]);
        let lengths = lengths.finish().as_flattened();
        let lengths = lengths.as_chunks::<{ I32::LEN }>().0.as_chunks::<4>().0;

        // How often each length occurs, then the code for runs of zeros, and then the sum.
        let mut indices = Aligned([[0; 4]; 16 + 2]);
        let lone_zeros = x128::U32::load(&gaps[0]) << SHIFT;
        // A third of a multiple of 3.
        let runs = (sums.bits_for_runs.bitcast::<x128::U32>() * 0xAAAB) >> (17 - SHIFT);
        let (mut longest, mut sum, mut kinds) = (I8::splat(1), lone_zeros + runs, 0);
        while kinds == 0 || kinds == 8 && longest.simd_gt(7).any() {
            let mut seen = [I8::zero(); 8];
            for [a, b, c, d] in lengths {
                let first = I16::pack(I32::load(a), I32::load(b));
                let packed = I8::pack(first, I16::pack(I32::load(c), I32::load(d))).simd_min(15);
                longest = longest.simd_max(packed);
                let relative = packed - kinds as i8;
                for i in 0..8 {
                    seen[i] -= relative.simd_eq(i as i8).to_vector();
                }
            }
            for i in 0..8 {
                let all = index_by_histogram(seen[i]);
                sum += all;
                all.store(&mut indices.0[kinds + i]);
            }
            kinds += 8;
        }
        runs.store(&mut indices.0[kinds]);
        sum.store(&mut indices.0[kinds + 1]);
        (lone_zeros + x128::U32::load(&indices.0[0])).store(&mut indices.0[0]);
        if (sum & (known << SHIFT).wrapping_neg()).simd_ne(0).any() {
            cold_path();
            add_entries(logarithms, known, indices.0.as_flattened_mut());
        }

        let mut entropy = F64::zero();
        for &count in &indices.0[..=kinds] {
            let (log, number) = look_up(logarithms, count);
            entropy -= number * log;
        }
        let (log, codes) = look_up(logarithms, indices.0[kinds + 1]);
        let code_bits = entropy + codes * log;
        let code_bits = code_bits.simd_gt(codes).select(code_bits, codes);

        let longest = longest.to_array();
        let blocks = longest.as_chunks().0.iter().map(|it| x128::I8::load(it));
        let longest = blocks.fold(x128::I8::zero(), |a, b| a.simd_max(b));
        let [a, b] = longest.halves();
        let [c, d] = a.simd_max(b).halves();
        let header = (c.simd_max(d).cast::<i32>() << 1) + 18;
        (sums.bits + header.cast::<f64>() + code_bits).to_array()
    }

    /// Four pairs take fewer instructions as they are if they fit into a register.
    const PAIRS_FIT: bool = I8::LEN > 16;

    /// A bit for each that has neither.
    #[inline(always)]
    fn without(pairs: U64, [a, b]: [u32; 2]) -> u64 {
        let ids: x256::U32 = pairs.bitcast();
        if PAIRS_FIT {
            let has_one: U64 = (ids.simd_eq(a) | ids.simd_eq(b)).to_vector().bitcast();
            return has_one.simd_eq(0).to_bitmask();
        }
        let [low, high] = ids.halves();
        let (first, second) = low.deinterleave(high);
        let have = |id: u32| first.simd_eq(id) | second.simd_eq(id);
        (have(a) | have(b)).to_bitmask() ^ 15
    }

    /// For `is_nearer`.
    #[inline(always)]
    fn differences(pairs: U64) -> I64 {
        if PAIRS_FIT {
            return (pairs - (pairs << 32)).bitcast();
        }
        let [low, high] = pairs.bitcast::<x256::U32>().halves();
        let (first, second) = low.deinterleave(high);
        I64::from_halves([(second - first).bitcast(); 2])
    }

    #[inline(always)]
    fn is_nearer(differences: I64, limit: I64) -> Mask<f64, 4> {
        if PAIRS_FIT {
            return differences.simd_lt(limit).cast();
        }
        let four = |all: I64| all.halves()[0].bitcast::<x128::I32>();
        four(differences).simd_lt(four(limit)).cast()
    }

    /// In all lanes.
    struct Best {
        cost: F64,
        pair: U64,
        apart: I64,
    }

    #[inline(always)]
    fn first_of(best: &Best) -> (f64, [u32; 2]) {
        let ids: x256::U32 = best.pair.bitcast();
        (best.cost[0], [ids[0], ids[1]])
    }

    /// Puts it into `lane`, and takes what was there.
    #[inline(always)]
    fn trade(best: &mut Best, costs: &mut F64, pairs: &mut U64, lane: usize, was: (f64, [u32; 2])) {
        let (is_lane, (cost, [first, second])) = (U64::iota().simd_eq(lane as u64), was);
        *costs = is_lane.cast().select(best.cost, *costs);
        *pairs = is_lane.select(best.pair, *pairs);
        best.cost = F64::splat(cost);
        best.pair = U64::splat(u64::from(second) << 32 | u64::from(first));
        best.apart = differences(best.pair) & if PAIRS_FIT { -1 << 32 } else { -1 };
    }

    /// Returns how many have none of `merged`. One that costs less than the first, or as much with a smaller difference, trades places with it.
    #[export]
    pub fn remove_pairs(costs: &mut [f64], pairs: &mut [[u32; 2]], merged: [u32; 2]) -> usize {
        debug_assert!(costs.iter().all(|it| it.to_bits() != (-0f64).to_bits()));
        const LANES_IN: [u8; 16] = from_fn(const |bits| bits.count_ones() as u8);
        let count = costs.len();
        assert!(count >= PAIR_GROUP && count == pairs.len() && count.is_multiple_of(PAIR_GROUP));
        let mut best = Best {
            cost: F64::splat(TOO_MUCH),
            pair: !U64::zero(),
            apart: I64::zero(),
        };
        let rank = |(cost, [a, b]): (f64, [u32; 2])| (cost, b.wrapping_sub(a) as i32);
        let (mut at, mut kept, last) = (0, 0, count - PAIR_GROUP);
        while at <= last {
            let mut cost = F64::from_slice(&costs[at..]);
            let mut pair: U64 = x256::U32::from_slice(pairs[at..].as_flattened()).bitcast();
            let (staying, apart) = (without(pair, merged), differences(pair));
            let (these_costs, these) = (&costs[at..][..PAIR_GROUP], &pairs[at..][..PAIR_GROUP]);
            let was = |lane: usize| (these_costs[lane % PAIR_GROUP], these[lane % PAIR_GROUP]);
            while let better @ 1.. = {
                // A second comparison of floats could lower the clock.
                let is_tie = cost.bitcast::<U64>().simd_eq(best.cost.bitcast::<U64>());
                let wins_tie = is_tie.cast() & is_nearer(apart, best.apart);
                (cost.simd_lt(best.cost) | wins_tie).to_bitmask() & staying
            } {
                cold_path();
                if isa::Isa::HAS_SINGLE_CYCLE_OPS {
                    let lane = better.trailing_zeros() as usize;
                    trade(&mut best, &mut cost, &mut pair, lane, was(lane));
                } else {
                    // The way from a mask to a lane and back is long. Nothing waits for a branch.
                    #[rustc_unroll(full)]
                    for lane in 0..PAIR_GROUP {
                        if better >> lane & 1 != 0 && rank(was(lane)) < rank(first_of(&best)) {
                            trade(&mut best, &mut cost, &mut pair, lane, was(lane));
                        }
                    }
                    break;
                }
            }
            let staying = staying as usize % 16;
            let cost: F64 = cost.bitcast::<U64>().compress(staying).bitcast();
            let ids: x256::U32 = pair.compress(staying).bitcast();
            assert!(kept <= last);
            cost.copy_to_slice(&mut costs[kept..]);
            ids.copy_to_slice(pairs[kept..].as_flattened_mut());
            kept += usize::from(LANES_IN[staying]);
            at += PAIR_GROUP;
        }
        (costs[0], pairs[0]) = first_of(&best);
        kept
    }

    type Counts = x256::I16;

    /// The high halves of the first `count`, clamped, between what stays before and after them.
    #[inline(always)]
    fn row_of<'a>(leaves: &[u64], count: usize, room: Out<'a, i16>) -> &'a [i16] {
        let mut row = room.into_writer();
        row.push([0; BEFORE]);
        let groups = &leaves.as_chunks::<LEAF_SLACK>().0[..count.div_ceil(LEAF_SLACK)];
        row.extend_with(groups, |group| {
            let four = |at: usize| (x256::U64::from_slice(&group[at..]) >> 32).cast::<i32>();
            let eight = |at: usize| x256::I32::from_halves([four(at), four(at + 4)]);
            Some(Counts::saturating_narrow(eight(0), eight(8)).to_array())
        });
        row.truncate(BEFORE + count);
        row.push([i16::MAX - 1; AFTER]);
        row.finish()
    }

    /// For each of `ours`, minus 1 if the other one goes before it in a stable sort.
    #[inline(always)]
    fn goes_before<const IS_EARLIER: bool>(ours: Counts, others: &[i16]) -> Counts {
        let limit = ours + i16::from(IS_EARLIER);
        limit.simd_gt(Counts::from_slice(others)).to_vector()
    }

    /// The same, added up for each 16 in a row of `others`, in steps of four.
    #[inline(always)]
    fn go_before<const ARE_EARLIER: bool>(ours: Counts, mut others: &[i16]) -> Counts {
        let mut negated_rank = Counts::zero();
        #[rustc_unroll(never)]
        while let Some(near) = others.first_chunk::<{ LEAF_SLACK + 3 }>() {
            let one = |at: usize| goes_before::<ARE_EARLIER>(ours, &near[at..]);
            negated_rank += (one(0) + one(1)) + (one(2) + one(3));
            others = &others[4..];
        }
        negated_rank
    }

    /// Where a stable sort puts the 16 from `first` on.
    #[inline(always)]
    fn places_in_order(row: &[i16], first: usize) -> Counts {
        let count = row.len() - BEFORE - AFTER;
        let back = count.min(first + LEAF_SLACK - 1).next_multiple_of(4);
        let ahead = (count - 1 - first).next_multiple_of(4);
        let near = &row[BEFORE + first - back..][..back + LEAF_SLACK + ahead];
        let ours = Counts::from_slice(&near[back..]);
        let earlier = go_before::<true>(ours, &near[..back + LEAF_SLACK - 1]);
        let later = go_before::<false>(ours, &near[back + 1..]);
        Counts::iota() + (first as i16 - back as i16) - (earlier + later)
    }

    /// The same for a pass of a Shell sort. Counts that are more than `reach` apart are in order.
    #[inline(always)]
    fn places_with_gap(row: &[i16], first: usize, gap: usize, reach: usize) -> Counts {
        let back = reach.min(first + LEAF_SLACK - 1);
        let ahead = reach.min(row.len() - BEFORE - AFTER - 1 - first);
        // LLVM would give the loops more counters.
        let start = opaque((BEFORE + first - back) as u64) as usize;
        let near = &row[start..BEFORE + first + ahead + LEAF_SLACK];
        let last = near.len().checked_sub(LEAF_SLACK).unwrap();
        let (ours, mut negated_rank) = (Counts::from_slice(&near[back..]), Counts::zero());
        let mut at = opaque(back.wrapping_sub(gap) as u64) as usize;
        #[rustc_unroll(never)]
        while at <= last {
            negated_rank += goes_before::<true>(ours, &near[at..]);
            at = at.wrapping_sub(gap);
        }
        let lowest = at.wrapping_add(gap + first).wrapping_sub(back);
        at = opaque((back + gap) as u64) as usize;
        #[rustc_unroll(never)]
        while at <= last {
            negated_rank += goes_before::<false>(ours, &near[at..]);
            at += gap;
        }
        Counts::iota() + lowest as i16 - negated_rank * gap as i16
    }

    #[inline(always)]
    fn places_by_last_distances(row: &[i16], first: usize) -> Counts {
        let near: &[_; BEFORE + AFTER] = row[first..].first_chunk().unwrap();
        let (ours, mut negated_rank) = (Counts::from_slice(&near[BEFORE..]), Counts::zero());
        #[rustc_unroll(full)]
        for distance in LAST_DISTANCES {
            negated_rank += goes_before::<true>(ours, &near[BEFORE - distance..]);
            negated_rank += goes_before::<false>(ours, &near[BEFORE + distance..]);
        }
        Counts::iota() + (first as i16 - LAST_DISTANCES.len() as i16) - negated_rank
    }

    #[inline(always)]
    fn move_leaves(from: &[u64], count: usize, to: &mut [u64], places: impl Fn(usize) -> Counts) {
        let mut room = Aligned([MaybeUninit::uninit(); MAX_SYMBOLS]);
        let mut all = Out::from(&mut room.0[..]).into_writer();
        all.extend_with(
            (0..count.div_ceil(LEAF_SLACK)).map(|i| i * LEAF_SLACK),
            |first| Some(places(first).bitcast::<x256::U16>().to_array()),
        );
        let leaves = &from.as_chunks::<4>().0[..count.div_ceil(4)];
        for (leaves, places) in leaves.iter().zip(all.finish().as_chunks::<4>().0) {
            for i in 0..4 {
                to[usize::from(places[i])] = leaves[i];
            }
        }
    }

    /// Sorts the first `count` of `leaves` by their high halves, unless one is above 32766 or a slice is too short.
    #[export]
    pub fn sort_leaves(
        // If they are sorted, this has them in any order.
        leaves: &mut [u64],
        count: usize,
        // With the gaps 132, 57, 23, 10, 4 and 1. Otherwise, ties keep their order.
        like_shell_sort: bool,
        sorted: &mut [u64],
    ) -> bool {
        if count > MAX_SYMBOLS || count + LEAF_SLACK > leaves.len().min(sorted.len()) {
            return false;
        }
        let padded = count + LEAF_SLACK;
        let (mut from, mut to) = (&mut leaves[..padded], &mut sorted[..padded]);
        let mut room = Aligned([MaybeUninit::uninit(); BEFORE + MAX_SYMBOLS + AFTER]);
        let mut row = row_of(from, count, room.0[..].as_mut().into());
        let mut most = x256::U16::zero();
        #[rustc_unroll(never)]
        for counts in &row[BEFORE..].as_chunks().0[..count.div_ceil(LEAF_SLACK)] {
            most = most.simd_max(Counts::load(counts).bitcast::<x256::U16>());
        }
        if most.simd_ge(i16::MAX as u16).any() {
            return false;
        }
        if !like_shell_sort {
            move_leaves(from, count, to, |first| places_in_order(row, first));
            return true;
        }
        let gaps = &GAPS[..GAPS.iter().filter(|&&gap| gap < count).count()];
        if gaps.len() % 2 != 0 {
            to.copy_from_slice(from);
            (from, to) = (to, from);
        }
        for &gap in gaps.iter().rev() {
            let reach = if gap == 4 { REACH_OF_GAP_4 } else { count };
            move_leaves(from, count, to, |first| {
                places_with_gap(row, first, gap, reach)
            });
            (from, to) = (to, from);
            row = row_of(from, count, room.0[..].as_mut().into());
        }
        move_leaves(from, count, to, |first| {
            places_by_last_distances(row, first)
        });
        true
    }
}
