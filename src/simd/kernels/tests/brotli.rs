//! The kernels of the Brotli encoder, against the loops of google/brotli.
#![forbid(unsafe_code)]
#[expect(dead_code)]
mod common;
use bun_simd_kernels::brotli::{self, CostByCopyLength, Place, Start, Ways};
use bun_simd_kernels::brotli::{LEAF_SLACK, LENGTH_SHIFT, SLOT_SHIFT, SPARE_LOGARITHMS};
use common::{check, random, sample, targets};
use core::array::from_fn;
use core::ops::Range;
use std::panic::{AssertUnwindSafe, catch_unwind};

fn returns<T>(call: impl Fn() -> T) -> bool {
    let each = targets().map(|_| catch_unwind(AssertUnwindSafe(&call)).is_ok());
    let each: Vec<bool> = each.collect();
    assert!(each.iter().all(|&it| it == each[0]));
    each[0]
}

#[test]
fn find_switches() {
    let mut below = random();
    for round in sample(0..200, 50) {
        let (groups, alphabet) = (1 + round % 16, [1 + below(20), 704][round % 25 / 24]);
        let len = [0, 1, 40, 2100][if cfg!(miri) { round % 3 } else { below(4) }];
        let symbols: Vec<u16> = (0..len).map(|_| below(alphabet) as u16).collect();
        let step = [1.0, 0.37][round / 16 % 2];
        let mut costs = |count| -> Vec<[f64; 8]> {
            (0..count)
                .map(|_| from_fn(|_| below(9) as f64 * step))
                .collect()
        };
        let (symbol_costs, given, switch_cost) = (costs(alphabet * groups), costs(groups), 13.5);

        let mut want = (given.clone(), vec![0; len * groups], vec![0; len]);
        let (mut min_cost, mut max_cost) = (0.0, 1e99);
        for (at, &symbol) in symbols.iter().enumerate() {
            let added = symbol_costs[usize::from(symbol) * groups..].as_flattened();
            let sums = want.0.as_flattened_mut();
            for (i, sum) in sums.iter_mut().enumerate() {
                want.1[at * groups + i / 8] |= u8::from(*sum - min_cost >= max_cost) << (i % 8);
                *sum = (*sum - min_cost).min(max_cost) + added[i];
            }
            min_cost = sums.iter().copied().fold(f64::MAX, f64::min);
            want.2[at] = sums.iter().position(|&sum| sum == min_cost).unwrap() as u8;
            let prologue = 0.77 + 0.07 / 2000.0 * at as f64;
            max_cost = switch_cost * if at < 2000 { prologue } else { 1.0 };
        }
        check(want, || {
            let mut got = (given.clone(), vec![0xAA; len * groups], vec![0xAA; len]);
            let (sums, switches, cheapest) = (&mut got.0, &mut got.1, &mut got.2);
            brotli::find_switches(
                &symbols,
                &symbol_costs,
                switch_cost,
                sums,
                switches,
                cheapest,
            );
            got
        });
    }
}

#[test]
fn find_switches_needs_room() {
    let fits = |symbol_costs, groups, switches, cheapest| {
        returns(|| {
            let (added, mut sums) = (vec![[0.0; 8]; symbol_costs], vec![[0.0; 8]; groups]);
            let [mut switches, mut cheapest] = [vec![0; switches], vec![0; cheapest]];
            brotli::find_switches(
                &[1; 5],
                &added,
                0.0,
                &mut sums,
                &mut switches,
                &mut cheapest,
            );
        })
    };
    assert!(fits(6, 3, 15, 5) && fits(8, 3, 18, 6) && fits(32, 16, 80, 5) && fits(6, 3, 15, 6));
    assert!(!fits(5, 3, 15, 5) && !fits(6, 3, 14, 5) && !fits(6, 3, 15, 4));
    assert!(!fits(6, 0, 15, 5) && !fits(34, 17, 85, 5));
}

/// Rounded like those of the encoder, or a little too small, which shows what was looked up.
fn logarithms(known: usize) -> Vec<[f64; 2]> {
    let log2 = |n: f64| [(n.log2() as f32).into(), n.log2() - 1e-6][known.ilog2() as usize % 2];
    let mut all: Vec<_> = (0..known).map(|n| [log2(n as f64), n as f64]).collect();
    all[0][0] = 1e6;
    all.resize(known + SPARE_LOGARITHMS, [f64::NAN; 2]);
    all
}

/// `BrotliPopulationCost`, and the gaps.
fn population_cost(counts: &[u32], known: &[[f64; 2]]) -> (f64, [u32; 2]) {
    let log2 = |n: u32| (known.get(n as usize)).map_or_else(|| f64::from(n).log2(), |it| it[0]);
    let log_of_total = log2(counts.iter().sum());
    let (mut bits, mut longest, mut lengths, mut gaps) = (0.0, 1, [0; 18], [0; 2]);
    let used = counts.iter().rposition(|&count| count != 0).unwrap() + 1;
    for same in counts[..used].chunk_by(|&a, &b| a == 0 && b == 0) {
        match (same[0], same.len() as u32) {
            (0, zeros @ ..3) => {
                lengths[0] += zeros;
                gaps[0] += zeros;
            }
            (0, zeros) => {
                gaps[1] += 1;
                for _ in 0..=(zeros - 2).ilog2() / 3 {
                    lengths[17] += 1;
                    bits += 3.0;
                }
            }
            (count, _) => {
                let cost = log_of_total - log2(count);
                let length = ((cost + 0.5) as usize).min(15);
                bits += f64::from(count) * cost;
                longest = longest.max(length);
                lengths[length] += 1;
            }
        }
    }
    let codes = lengths.iter().sum();
    let entropy = (lengths.iter()).fold(0.0, |sum, &n| sum - f64::from(n) * log2(n));
    let code_bits = (entropy + f64::from(codes) * log2(codes)).max(f64::from(codes));
    (bits + (18 + 2 * longest) as f64 + code_bits, gaps)
}

fn check_costs(common: &[u32], others: &[Vec<u32>; 4], known: usize) {
    // Miri makes the last bits of a logarithm random.
    let exact = |bits: f64| {
        if cfg!(miri) {
            (bits as f32).into()
        } else {
            bits
        }
    };
    let sums = (others.each_ref())
        .map(|other| -> Vec<u32> { common.iter().zip(other).map(|(a, b)| a + b).collect() });
    let mut used = [0; 11];
    for i in (0..common.len()).filter(|&i| sums.iter().any(|sum| sum[i] != 0)) {
        used[i / 64] |= 1 << (i % 64);
    }
    let totals = sums.each_ref().map(|sum| sum.iter().sum());
    let given = logarithms(known);
    let want = (sums.each_ref()).map(|sum| population_cost(sum, &given[..known]));
    let gaps = from_fn(|kind| want.map(|(_, gaps)| gaps[kind]));
    check(want.map(|(bits, _)| exact(bits)), || {
        let (others, mut table) = (others.each_ref().map(|it| &it[..]), given.clone());
        let got = brotli::estimate_costs(common, others, &used, &totals, &gaps, &mut table);
        assert_eq!(table[..known], given[..known]);
        got.map(exact)
    });
    // The caller leaves what it had in the lanes that it does not need.
    let (mut needed, [a, b, c, d]) = ([0; 11], others);
    for i in (0..common.len()).filter(|&i| sums[0][i] != 0) {
        needed[i / 64] |= 1 << (i % 64);
    }
    let (totals, gaps) = (
        [totals[0], 0, totals[3], 9],
        gaps.map(|it| [it[0], 0, it[3], 9]),
    );
    check(exact(want[0].0), || {
        let (others, mut table) = ([&a[..], b, c, d], given.clone());
        exact(brotli::estimate_costs(common, others, &needed, &totals, &gaps, &mut table)[0])
    });
}

#[test]
fn estimate_costs() {
    let mut below = random();
    for round in sample(0..1500, 751) {
        let size = [64, 256, 544, 704, 64 + below(641)][round % 5];
        let size = if cfg!(miri) { size.min(72) } else { size };
        let mut histogram = |at_least: usize| {
            let (mut counts, bits) = (vec![0; size], 1 + below(22));
            let symbols = [0, below(12), below(size), 9 * size][below(4)];
            let first = below(size - 4);
            (0..at_least).for_each(|i| counts[(first + i * (size / 5)) % size] = 1);
            for _ in 0..symbols {
                let bits = below(bits) + 1;
                counts[below(size)] = 1 + below(1 << bits) as u32 / 2;
            }
            counts
        };
        let (common, others): (_, [_; 4]) = (histogram(0), from_fn(|_| histogram(5)));
        let known = 1 << below(if cfg!(miri) { 7 } else { 13 });
        check_costs(&common, &others, known);
    }
}

#[test]
fn estimate_costs_with_one_run_of_zeros() {
    let limit = if cfg!(miri) { 100 } else { 700 };
    for round in sample(0..700, 700) {
        let mut others: [_; 4] = from_fn(|lane| {
            let (mut counts, before) = (vec![1, 40_000, (1 << 24) + 1, 3, 130], [0, 1, 4, 2][lane]);
            counts.splice(before..before, vec![0; (round + 175 * lane) % limit]);
            counts
        });
        let size = others.iter().map(Vec::len).max().unwrap();
        others.iter_mut().for_each(|counts| counts.resize(size, 0));
        let known = if round % 100 == 99 { 1 << 17 } else { 256 };
        check_costs(&vec![0; size], &others, known);
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn estimate_costs_next_to_steps() {
    // The first symbol costs a little less than half a bit, and then a little more.
    let halves = [[33461, 13857], [80782, 33458]];
    let [less, more] = halves.map(|it| [&it[..], &[1, 1, 0, 1], &[0; 58]].concat());
    for common in [less, more, vec![1; 64], vec![256; 64]] {
        for known in [1, 128, 256] {
            check_costs(&common, &from_fn(|_| vec![0; 64]), known);
        }
    }
}

#[test]
fn estimate_costs_needs_room() {
    let fits = |size, sizes: [usize; 4], entries| {
        let (counts, used) = (&[u32::MAX / 4; 705], &[u64::MAX; 11]);
        let (common, others) = (&counts[..size], sizes.map(|size| &counts[..size]));
        let table = || vec![[1.0; 2]; entries];
        returns(|| {
            brotli::estimate_costs(common, others, used, &[0; 4], &[[0; 4]; 2], &mut table())
        })
    };
    let enough = 4 + SPARE_LOGARITHMS;
    assert!(fits(64, [64; 4], enough) && (cfg!(miri) || fits(704, [704; 4], enough)));
    assert!(!fits(705, [705; 4], enough) && !fits(63, [63; 4], enough));
    for nth in 0..4 {
        assert!(!fits(65, from_fn(|i| 65 - usize::from(i == nth)), enough));
        assert!(!fits(65, from_fn(|i| 65 + usize::from(i == nth)), enough));
    }
    for entries in [0, 4, enough - 5, enough - 4, enough - 1, enough + 1] {
        assert!(!fits(64, [64; 4], entries));
    }
}

#[test]
fn remove_pairs() {
    let mut below = random();
    for round in sample(0..4000, 203) {
        let (count, clusters) = (4 * (1 + below([12, 200][round % 50 / 49])), 2 + below(12));
        let (kinds, shift) = ([2, 5, 1000][round % 3], below(29));
        let lowest = [0, (1 << 31) - (6 << shift)][round / 3 % 2];
        let alike = [-1.0, 1.0, 1f64.next_up(), (-1f64).next_up(), 1e99];
        let costs: Vec<f64> = (0..count)
            .map(|_| match round % 4 {
                1 => alike[below(5)],
                _ => below(kinds) as f64 * 0.3 - 1.0,
            })
            .collect();
        let mut pair = || {
            let first = below(clusters);
            [first, first + 1 + below(clusters)].map(|id| (lowest + (id << shift)) as u32)
        };
        let (pairs, merged): (Vec<_>, _) = ((0..count).map(|_| pair()).collect(), pair());

        let apart = |[first, second]: [u32; 2]| second.wrapping_sub(first) as i32;
        let (mut best, mut want) = ((1e99, [u32::MAX; 2]), vec![]);
        for mut it in costs.iter().copied().zip(pairs.iter().copied()) {
            if !it.1.iter().any(|id| merged.contains(id)) {
                if (it.0, apart(it.1)) < (best.0, apart(best.1)) {
                    core::mem::swap(&mut it, &mut best);
                }
                want.push(it);
            }
        }
        let kept = want.len();
        want.splice(..kept.min(1), [best]);
        check((kept, want), || {
            let (mut costs, mut pairs) = (costs.clone(), pairs.clone());
            let kept = brotli::remove_pairs(&mut costs, &mut pairs, merged);
            (
                kept,
                costs.into_iter().zip(pairs).take(kept.max(1)).collect(),
            )
        });
    }
}

#[test]
fn remove_pairs_needs_whole_groups() {
    let fits = |costs, pairs| {
        returns(|| brotli::remove_pairs(&mut vec![0.0; costs], &mut vec![[0; 2]; pairs], [0, 1]))
    };
    assert!(fits(8, 8) && !fits(0, 0) && !fits(6, 6) && !fits(8, 4) && !fits(4, 8));
}

#[test]
fn remove_pairs_of_padding() {
    let kept = |cost| brotli::remove_pairs(&mut [1.0, cost, 1.0, 1.0], &mut [[0; 2]; 4], [0; 2]);
    check(0, || kept(0.0));
    assert_eq!(returns(|| kept(-0.0)), !cfg!(debug_assertions));
}

#[test]
fn sort_leaves() {
    const GAPS: [usize; 6] = [132, 57, 23, 10, 4, 1];
    let mut below = random();
    let counts = (0..150).chain([255, 256, 257, 543, 544, 703, 704]);
    for (round, count) in counts
        .cycle()
        .enumerate()
        .take(if cfg!(miri) { 200 } else { 1500 })
        .filter(|(_, it)| !cfg!(miri) || *it == 12 || *it == 25)
    {
        let (kinds, kind) = ([60, 1, 5, 2, 32767][round % 5], round % 6);
        // The larger gaps find nothing to move, and leave the next one as much as they can.
        let (larger, first) = (&GAPS[..1 + below(5)], below(count.clamp(1, 40)));
        let mut is_sum = vec![false; count];
        for i in first..count {
            is_sum[i] = i == first || larger.iter().any(|&gap| i >= gap && is_sum[i - gap]);
        }
        let leaves: Vec<u64> = (0..count + LEAF_SLACK + below(2))
            .map(|i| match kind {
                _ if i >= count => below(usize::MAX) as u64,
                0 => (((count - i) * kinds / (count + 1)) << 32 | i) as u64,
                1 => ((32766 - below(kinds)) << 32 | i) as u64,
                2 | 3 => (usize::from(is_sum[i]) << 32 | i) as u64,
                _ => (below(kinds) << 32 | below(1 << 32)) as u64,
            })
            .collect();
        for gaps in [&[1][..], &GAPS] {
            let mut want = leaves[..count].to_vec();
            for (gap, i) in gaps
                .iter()
                .flat_map(|&gap| (gap..count).map(move |i| (gap, i)))
            {
                let mut at = i;
                while at >= gap && want[at] >> 32 < want[at - gap] >> 32 {
                    want.swap(at, at - gap);
                    at -= gap;
                }
            }
            check(want, || {
                let (mut given, mut got) = (leaves.clone(), vec![7; leaves.len() + 1]);
                assert!(brotli::sort_leaves(
                    &mut given,
                    count,
                    gaps.len() > 1,
                    &mut got
                ));
                let end = count + LEAF_SLACK;
                assert!((count..end).all(|i| [7, leaves[i]].contains(&got[i])));
                assert_eq!(got[end..], vec![7; got.len() - end]);
                assert_eq!(given[count..], leaves[count..]);
                got.truncate(count);
                got
            });
        }
    }
}

#[test]
fn sort_leaves_declines() {
    let sorts_with = |at: usize, leaves, count, sorted, high: u64| {
        let mut given = vec![0; leaves];
        given[at] = high << 32;
        let each = targets()
            .flat_map(|_| [false, true])
            .filter(|&like_shell_sort| {
                let (mut leaves, mut sorted) = (given.clone(), vec![7; sorted]);
                let did = brotli::sort_leaves(&mut leaves, count, like_shell_sort, &mut sorted);
                assert!(did || leaves == given && sorted.iter().all(|&it| it == 7));
                did
            });
        each.count() != 0
    };
    let sorts = |leaves, count: usize, sorted, last| {
        sorts_with(count.min(704) - 1, leaves, count, sorted, last)
    };
    assert!(sorts(17, 1, 17, 32766) && (cfg!(miri) || sorts(720, 704, 720, 32766)));
    assert!(!sorts(719, 704, 720, 0) && !sorts(720, 704, 719, 0) && !sorts(721, 705, 721, 0));
    assert!(!sorts(720, usize::MAX, 720, 0));
    for too_much in [32767, 32768, 65535, 65536, 1 << 31, u32::MAX.into()] {
        assert!(!sorts(40, 24, 40, too_much) && !sorts(17, 1, 17, too_much));
    }
    for (at, count) in [(15, 16), (16, 17), (0, 17)] {
        assert!(!sorts_with(at, 40, count, 40, 32767));
    }
    assert!(sorts(40, 16, 40, 32766));
}

const BASES: [usize; 16] = [0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
const DELTAS: [i32; 16] = [0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3];

#[test]
fn short_codes() {
    const FAR: usize = 0x1F0_F0F0;
    let (mut below, mut large) = (random(), vec![0; 1 << 25]);
    for round in sample(0..7000, 701) {
        let bit = 1 << below(8);
        let small: Vec<u8> = (0..below(80)).map(|_| [0, bit][below(2)]).collect();
        large[FAR..][..small.len()].copy_from_slice(&small);
        let (ring, back, position) = match round % 8 {
            3 | 7 => (&large, below(1 << 29), below(128) << 25 | (FAR + 90)),
            ..4 => (&small, 0, below(200)),
            _ => (&small, 0, below(1 << 32)),
        };
        let place = Place {
            ring,
            ring_mask: [31, 63, u32::MAX, (1 << 25) - 1][round % 4],
            position: (position + back) as u32,
            pair: from_fn(|_| [0, bit][below(2)]),
        };
        let mut some: [[i32; 4]; 3] = from_fn(|_| from_fn(|_| (back + below(90)) as i32));
        some[2] = some[1];
        some[2][below(4)] ^= 1 << below(31);
        let last_distances: [_; 8] = from_fn(|_| some[below(3)]);

        let codes = |distances: &[i32; 4]| brotli::short_codes(place, distances);
        for (distances, code) in some
            .iter()
            .flat_map(|it| (0..16).map(move |code| (it, code)))
        {
            let index = |delta: i32| {
                let distance = distances[BASES[code]] + delta;
                (place.position.wrapping_sub(distance as u32) & place.ring_mask) as usize
            };
            let reach = if BASES[code] < 2 { 3 } else { 0 };
            let (farthest, nearest) = (index(reach), index(-reach));
            let is_set = codes(distances) >> code & 1 != 0;
            if ring.len() < 8 || nearest < farthest {
                assert!(is_set);
            } else if farthest + 8 <= ring.len() {
                assert_eq!(is_set, ring[index(DELTAS[code])..][..2] == place.pair);
            }
        }

        let costs: [f32; 5] = from_fn(|_| [-3.0, -2.0, -1.0, -0.0, 1e-9, 1.7e38][below(6)]);
        let ranked = costs.map(|cost| u64::from(cost.to_bits()) << 32 | below(1 << 32) as u64);
        let of = |rank: usize| &last_distances[(ranked[rank] >> SLOT_SHIFT) as usize % 8];
        let stays = |&rank: &usize| costs[rank] <= 0.0 && (costs[rank] < -2.0 || of(rank) != of(0));
        let others = (1..5).filter(stays);
        let others = others.map(|rank| u64::from(codes(of(rank))) << (16 * rank - 16));
        let got = brotli::short_codes_of_five(place, &last_distances, &ranked, -2.0);
        assert_eq!(got, (codes(of(0)), others.sum()));
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn short_codes_far_into_the_ring() {
    let (mut ring, position, distances) = (vec![0; 1 << 24], 0xF0_F0F0, [10, 20, 30, 40]);
    for (code, distance) in distances.into_iter().enumerate() {
        ring[(position - distance) as usize..][..2].fill(distance as u8);
        let place = Place {
            ring: &ring,
            ring_mask: (1 << 24) - 1,
            position: position as u32,
            pair: [distance as u8; 2],
        };
        assert_eq!(brotli::short_codes(place, &distances), 1 << code);
    }
}

const STRIDE: usize = 150;

#[derive(Clone, PartialEq, Debug)]
struct Known {
    costs: Vec<f32>,
    nodes: Vec<u32>,
    offset: usize,
}

impl Known {
    fn new(below: &mut impl FnMut(usize) -> usize) -> Self {
        Self {
            costs: (0..STRIDE).map(|_| below(60) as f32 * 0.5).collect(),
            nodes: (0..3 * STRIDE).map(|_| below(1 << 32) as u32).collect(),
            offset: below(STRIDE - 73 + 1),
        }
    }

    fn after(&self, kernel: impl Fn(Ways<'_>)) -> Self {
        let mut known = self.clone();
        kernel(Ways {
            costs: &mut known.costs,
            nodes: &mut known.nodes,
            offset: self.offset as u32,
        });
        known
    }

    fn after_each(&self, lengths: Range<usize>, way: impl Fn(usize) -> (f32, u32, u32)) -> Self {
        let mut known = self.clone();
        for length in lengths {
            let (at, (cost, distance, insert)) = (self.offset + length, way(length));
            if cost < known.costs[at] {
                known.costs[at] = cost;
                for (row, value) in [length as u32, distance, insert].into_iter().enumerate() {
                    known.nodes[row * self.costs.len() + at] = value;
                }
            }
        }
        known
    }
}

#[test]
fn try_copies() {
    let mut below = random();
    for round in sample(0..5000, 1251) {
        let step = [0.5, 0.37][round % 2];
        let [extra_bits, a, b]: [CostByCopyLength; 3] =
            from_fn(|_| from_fn(|_| below(8) as f32 * step));
        let distance_costs: [f32; 64] = from_fn(|_| below(8) as f32 * step);
        let starts = [&a, &b].map(|symbol_costs| Start {
            cost: below(40) as f32 * step - 15.0,
            symbol_costs,
            insert: below(1 << 32) as u32,
        });
        let (known, first, [start, _]) = (Known::new(&mut below), below(71), starts);

        let lengths = first..below(71);
        let want = known.after_each(lengths.clone(), |length| {
            let cost = extra_bits[length] + start.cost + start.symbol_costs[length];
            (cost, 5, start.insert)
        });
        let got = known.after(|ways| {
            brotli::try_lengths(ways, lengths.clone(), &extra_bits, start, 5);
        });
        assert_eq!(got, want);

        let lengths = first..below(STRIDE - 3 - known.offset + 1);
        let want = known.after_each(lengths.clone(), |_| (9.0, 5, 6));
        let mut taken = (lengths.clone()).filter(|it| known.costs[known.offset + it] > 9.0);
        let longest = taken.next_back().unwrap_or(0);
        let got = known.after(|ways| {
            let got = brotli::try_lengths_at_cost(ways, lengths.clone(), 9.0, 5, 6);
            assert_eq!(got, longest);
        });
        assert_eq!(got, want);

        let (count, mut longest) = (1 + below(4), from_fn::<_, 4, _>(|_| below(70)));
        longest[..count].sort_unstable();
        let distances: [u32; 4] = from_fn(|_| {
            let bits = 2 + below(29);
            [(1 << bits) - 4 + below(3), below(1 << bits)][below(2)].max(1) as u32
        });
        let matches = from_fn(|i| {
            let ignored = [below(32) << 32, below(usize::MAX)][below(2) * usize::from(i >= count)];
            (longest[i] << LENGTH_SHIFT | ignored) as u64 | u64::from(distances[i])
        });
        let lengths = first..longest[count - 1] + 1;
        let want = known.after_each(lengths.clone(), |length| {
            let distance = distances[longest.iter().position(|&it| it >= length).unwrap()];
            let bits = (distance + 3).ilog2() - 1;
            let symbol = 2 * (bits - 1) + ((distance + 3) >> bits & 1);
            let [cost, other] = starts.map(|start| {
                let base = bits as f32 + start.cost + distance_costs[symbol as usize];
                base + extra_bits[length] + start.symbol_costs[length]
            });
            (
                cost.min(other),
                distance,
                starts[usize::from(other < cost)].insert,
            )
        });
        check(want, || {
            known.after(|ways| {
                let (lengths, costs) = (lengths.clone(), &distance_costs);
                brotli::try_matches(ways, lengths, &extra_bits, starts, &matches, count, costs);
            })
        });
    }
}

#[test]
#[cfg_attr(miri, ignore = "slow")]
fn try_long_copies_far_into_a_block() {
    let (offset, lengths) = (70_000, 66_001..140_000);
    let known = Known {
        costs: (0..210_003).map(|at| (at % 3) as f32).collect(),
        nodes: vec![7; 3 * 210_003],
        offset,
    };
    let got = known.after(|ways| {
        let longest = brotli::try_lengths_at_cost(ways, lengths.clone(), 1.0, 5, 6);
        assert_eq!(longest, 139_999);
    });
    assert!(got == known.after_each(lengths, |_| (1.0, 5, 6)));
}

#[test]
fn try_copies_needs_room() {
    let fit = |costs, nodes, offset, [first, end]: [usize; 2]| {
        let (bits, insert) = (&[0.0; _], 0);
        let start = Start {
            cost: 0.0,
            symbol_costs: bits,
            insert,
        };
        [0, 1, 2].map(|kind| {
            returns(|| {
                let ways = Ways {
                    costs: &mut vec![1e9; costs],
                    nodes: &mut vec![0; nodes],
                    offset,
                };
                let (lengths, starts) = (first..end, [start; 2]);
                match kind {
                    0 => brotli::try_lengths(ways, lengths, bits, start, 0),
                    1 => brotli::try_matches(ways, lengths, bits, starts, &[0; 4], 5, &[0.0; 64]),
                    _ => drop(brotli::try_lengths_at_cost(ways, lengths, 0.0, 0, 0)),
                }
            })
        })
    };
    assert_eq!(fit(17, 51, 5, [2, 9]), [true; 3]);
    assert_eq!(fit(17, 51, 5, [usize::MAX, 9]), [true; 3]);
    assert_eq!(fit(17, 51, 5, [2, 10]), [false; 3]);
    assert_eq!(fit(17, 51, 6, [2, 9]), [false; 3]);
    assert_eq!(fit(17, 50, 5, [2, 9]), [false; 3]);
    assert_eq!(fit(17, 51, u32::MAX, [2, 9]), [false; 3]);
    assert_eq!(fit(17, 51, 5, [2, usize::MAX]), [false; 3]);
    assert_eq!(fit(80, 240, 5, [2, 70]), [true; 3]);
    assert_eq!(fit(80, 240, 5, [2, 71]), [false, false, true]);
}
