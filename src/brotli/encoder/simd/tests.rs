//! Each kernel against plain code, on each target that the CPU has.

use bun_simd::prelude::kernel;
use bun_simd::target::Target;
use core::array::from_fn;

use super::*;

const ROUNDS: usize = if cfg!(miri) { 2 } else { 900 };

struct Numbers(u64);

impl Numbers {
    fn below(&mut self, end: usize) -> usize {
        self.0 = (self.0.wrapping_mul(6364136223846793005)).wrapping_add(1442695040888963407);
        (self.0 >> 33) as usize % end
    }

    fn one_of<T: Copy>(&mut self, choices: &[T]) -> T {
        choices[self.below(choices.len())]
    }
}

fn on_each_target(mut round: impl FnMut(Target, &mut Numbers)) {
    for target in remove_pairs::targets() {
        let mut numbers = Numbers(1);
        (0..ROUNDS).for_each(|_| round(target, &mut numbers));
    }
}

#[test]
fn finds_switches() {
    const SYMBOLS: usize = 40;
    const ALPHABET: usize = 5;
    on_each_target(|target, numbers| {
        let (groups, count) = (1 + numbers.below(16), numbers.below(SYMBOLS));
        let symbols: [u16; SYMBOLS] = from_fn(|_| numbers.below(ALPHABET) as u16);
        let symbol_costs: [[f64; 8]; 16 * ALPHABET] =
            from_fn(|_| from_fn(|_| numbers.below(40) as f64 / 3.0));
        let symbol_costs = &symbol_costs[..groups * ALPHABET];
        let (mut costs, mut switches, mut cheapest) = ([[0.0; 8]; 16], [0; _], [0; _]);
        let costs = &mut costs[..groups];
        let (data, rows) = (&symbols[..count], &mut switches[..]);
        if find_switches::to(target, data, symbol_costs, 13.5, costs, rows, &mut cheapest).is_none()
        {
            return;
        }

        let mut sums = [0.0; 16 * 8];
        let (mut expected_switches, mut expected_cheapest) = ([0; 16 * SYMBOLS], [0; SYMBOLS]);
        for (position, &symbol) in data.iter().enumerate() {
            let added = symbol_costs[usize::from(symbol) * groups..][..groups].as_flattened();
            let mut min = 1e99;
            for (kind, (sum, added)) in sums.iter_mut().zip(added).enumerate() {
                *sum += added;
                if *sum < min {
                    (min, expected_cheapest[position]) = (*sum, kind as u8);
                }
            }
            let max = 13.5 * (0.77 + (0.07 / 2000.0) * position as f64);
            for (kind, sum) in sums[..added.len()].iter_mut().enumerate() {
                *sum -= min;
                if *sum >= max && position + 1 < count {
                    expected_switches[(position + 1) * groups + kind / 8] |= 1 << (kind % 8);
                }
                *sum = sum.min(max);
            }
        }
        assert_eq!((switches, cheapest), (expected_switches, expected_cheapest));
    });
}

/// `BrotliPopulationCost`, for five symbols or more.
fn population_cost(counts: impl Iterator<Item = u32>, total: u32) -> f64 {
    let log2 = |number: u32| f64::from(number.max(1)).log2();
    let (mut bits, mut lengths, mut longest, mut zeros) = (0.0, [0; 18], 1, 0);
    for count in counts {
        if count == 0 {
            zeros += 1;
            continue;
        }
        if zeros < 3 {
            lengths[0] += zeros;
        } else {
            zeros -= 2;
            while zeros > 0 {
                lengths[17] += 1;
                bits += 3.0;
                zeros >>= 3;
            }
        }
        zeros = 0;
        let cost = log2(total) - log2(count);
        bits += f64::from(count) * cost;
        let length = ((cost + 0.5) as usize).min(15);
        longest = longest.max(length);
        lengths[length] += 1;
    }
    let sum = lengths.iter().sum();
    let entropy = (lengths.iter()).fold(0.0, |bits, &it| bits - f64::from(it) * log2(it));
    bits + (18 + 2 * longest) as f64 + (entropy + f64::from(sum) * log2(sum)).max(f64::from(sum))
}

#[test]
fn estimates_costs() {
    let mut table = [0; _];
    on_each_target(|target, numbers| {
        let size = numbers.one_of(&[8, 63, 64, 72, 256, 544, 704]);
        let (one_in, max) = (
            numbers.one_of(&[1, 2, 9, 150]),
            numbers.one_of(&[3, 99, 1 << 17]),
        );
        let mut counts: [[u32; MAX_SYMBOLS]; 5] = from_fn(|_| {
            from_fn(|_| (numbers.below(max) * usize::from(numbers.below(one_in) == 0)) as u32)
        });
        (0..5).for_each(|_| counts[0][numbers.below(size - 4)..][..5].fill(1));
        if size > 530 && numbers.below(2) == 0 {
            let zeros = numbers.one_of(&[64, 512]) + numbers.below(4);
            counts.iter_mut().for_each(|it| it[5..][..zeros].fill(0));
            counts[0][..5].fill(1);
        }
        // All alike, or with many zeros on their own.
        if size > 530 && numbers.below(4) == 0 {
            let (step, end) = numbers.one_of(&[(1, size), (3, 450)]);
            counts = [from_fn(|i| u32::from(i % step == 0 && i < end)); 5];
        }
        let [common, others @ ..] = counts.each_ref().map(|counts| &counts[..size]);
        let sums = |lane: usize| common.iter().zip(others[lane]).map(|(a, b)| a + b);

        let (mut used, mut gaps) = ([0; _], [[0; 4]; 2]);
        for lane in 0..4 {
            let mut zeros = 0;
            for (symbol, sum) in sums(lane).enumerate() {
                if sum != 0 {
                    used[symbol / 64] |= 1 << (symbol % 64);
                    gaps[0][lane] += if zeros < 3 { zeros } else { 0 };
                    gaps[1][lane] += u32::from(zeros >= 3);
                }
                zeros = if sum == 0 { zeros + 1 } else { 0 };
            }
        }
        let known = numbers.one_of(&[1, 256, if cfg!(miri) { 300 } else { MAX_LOGARITHMS }]);
        set_logarithm(&mut table, 0, 0, 1e6);
        for number in 1..known {
            set_logarithm(&mut table, number, number as u32, (number as f64).log2());
        }
        let (totals, known) = (from_fn(|lane| sums(lane).sum()), known as u32);
        let Some(costs) = estimate_costs::to(
            target, common, &others, &used, &totals, &gaps, &mut table, known,
        ) else {
            return;
        };
        for lane in 0..4 {
            let expected = population_cost(sums(lane), totals[lane]);
            // Miri makes logarithms inexact.
            let tolerance = if cfg!(miri) { expected * 1e-9 } else { 0.0 };
            assert!((costs[lane] - expected).abs() <= tolerance, "{target:?}");
        }
    });
}

#[test]
fn removes_pairs() {
    on_each_target(|target, numbers| {
        let (count, ids) = (
            PAIR_GROUP * (1 + numbers.below(16)),
            numbers.one_of(&[2, 5, 30]),
        );
        let mut costs: [f64; 64] = from_fn(|_| -(numbers.below(4) as f64));
        let mut pairs: [[u32; 2]; 64] = from_fn(|_| {
            let first = numbers.below(ids);
            [first, first + numbers.below(ids)].map(|id| id as u32)
        });
        let gone = [numbers.below(ids) as u32, numbers.below(ids) as u32];
        // The costs of pairs that go do not count.
        for (cost, pair) in costs.iter_mut().zip(&pairs) {
            if gone.iter().any(|id| pair.contains(id)) {
                let nan = f64::INFINITY.to_bits() + 1;
                *cost = f64::from_bits(numbers.one_of(&[cost.to_bits(), nan, !0, 1]));
            }
        }

        let rank = |(cost, [first, second]): (f64, [u32; 2])| (cost, second - first);
        let (mut expected, mut kept) = ([(1e99, [u32::MAX; 2]); 64], 0);
        let mut best = expected[0];
        for mut pair in costs.into_iter().zip(pairs).take(count) {
            if !gone.iter().any(|id| pair.1.contains(id)) {
                if rank(pair) < rank(best) {
                    core::mem::swap(&mut pair, &mut best);
                }
                expected[kept] = pair;
                kept += 1;
            }
        }
        expected[0] = best;

        if let Some(left) = remove_pairs::to(target, &mut costs[..count], &mut pairs[..count], gone)
        {
            assert_eq!(left, kept);
            assert!((0..kept).all(|i| (costs[i], pairs[i]) == expected[i]));
        }
    });
}

#[test]
fn sorts_leaves() {
    const ROOM: usize = MAX_SYMBOLS + LEAF_SLACK;
    on_each_target(|target, numbers| {
        let most = numbers.one_of(&[20, 140, if cfg!(miri) { 60 } else { MAX_SYMBOLS + 1 }]);
        let (count, max) = (numbers.below(most), numbers.one_of(&[2, 50, 32767, 33000]));
        let mut leaves: [u64; ROOM] = from_fn(|i| ((numbers.below(max) as u64) << 32) | i as u64);
        let (at, large) = (
            numbers.below(64),
            numbers.one_of(&[0, 0, 0, 1 << 48, 1 << 63]),
        );
        leaves[at] |= large;
        leaves[at + numbers.one_of(&[0, 16])] |= large;
        // In order at the sums of these gaps, and at no other distance from `at`.
        let gaps: &[usize] = numbers.one_of(&[&[][..], &[], &[4, 10, 23], &[10, 23, 57, 132]]);
        for i in (0..ROOM).filter(|_| !gaps.is_empty()) {
            let is_high = |gap: &usize| i >= at + gap && leaves[i - gap] >> 32 != 0;
            let is_high = i == at || gaps.iter().any(is_high);
            leaves[i] = (u64::from(is_high) * 32766) << 32 | i as u64;
        }
        let fits = leaves[..count].iter().all(|leaf| leaf >> 32 < 32767);
        let (from, mut sorted) = (&leaves[..count + LEAF_SLACK], [0; ROOM]);
        for gaps in [&[1][..], &[132, 57, 23, 10, 4, 1]] {
            let to = &mut sorted[..from.len()];
            let Some(is_sorted) = (match gaps {
                [_] => leaves::sort_stably::to(target, from, count, to),
                _ => leaves::sort_with_gaps::to(target, from, count, to),
            }) else {
                return;
            };
            let mut expected = leaves;
            for &gap in gaps {
                for mut i in gap..count {
                    while i >= gap && expected[i] >> 32 < expected[i - gap] >> 32 {
                        expected.swap(i, i - gap);
                        i -= gap;
                    }
                }
            }
            assert_eq!(is_sorted, fits);
            assert!(!fits || sorted[..count] == expected[..count]);
        }
    });
}

#[test]
fn refuses_to_sort_without_room() {
    let fits = |leaves, count, sorted| {
        sort_leaves(&[0; 721][..leaves], count, true, &mut [0; 721][..sorted])
    };
    assert!(cfg!(miri) || fits(720, 704, 720));
    assert!(!fits(719, 704, 720));
    assert!(!fits(720, 704, 719));
    assert!(!fits(721, 705, 721));
    assert!(!fits(720, usize::MAX, 720));
}

#[kernel(Upto<B32>)]
fn codes(place: Place<'_>, distances: &[[i32; 4]; 8], ranked: &[u64; 5]) -> (u32, (u32, u64)) {
    let of_five = short_codes_of_five(place, distances, ranked, -4.0);
    (short_codes(place, &distances[0]), of_five)
}

#[test]
fn finds_short_codes() {
    const BASES: [usize; 16] = [0, 1, 2, 3, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
    const DELTAS: [i32; 16] = [0, 0, 0, 0, -1, 1, -2, 2, -3, 3, -1, 1, -2, 2, -3, 3];
    on_each_target(|target, numbers| {
        let ring: [u8; 64 + 8] = from_fn(|_| numbers.below(2) as u8);
        let few: [[i32; 4]; 2] = from_fn(|_| from_fn(|_| 4 + numbers.below(70) as i32));
        let distances = from_fn(|_| numbers.one_of(&few));
        let costs: [f32; 5] = from_fn(|_| numbers.below(12) as f32 - 9.0);
        let slots: [usize; 5] = from_fn(|_| numbers.below(8));
        let ranked = from_fn(|rank| {
            (u64::from(costs[rank].to_bits()) << 32) | (slots[rank] << SLOT_SHIFT) as u64
        });
        let place = Place {
            ring: &ring[..numbers.one_of(&[0, 7, 72, 72, 72])],
            ring_mask: 63,
            position: numbers.below(300) as u32,
            pair: from_fn(|_| numbers.below(2) as u8),
        };
        let Some((one, (first, others))) = codes::to(target, place, &distances, &ranked) else {
            return;
        };

        if place.ring.len() < 8 {
            return assert_eq!((one, first, others), (0xFFFF, 0xFFFF, u64::MAX));
        }
        let exact = |slot: usize| {
            (0..16).fold(0, |bits, code| {
                let distance = distances[slot][BASES[code]] + DELTAS[code];
                let at = (place.position.wrapping_sub(distance as u32) & 63) as usize;
                bits | (u32::from(ring[at..at + 2] == place.pair) << code)
            })
        };
        let is_right = |found: u32, slot: usize| found == exact(slot) || found == 0xFFFF;
        assert!(is_right(one, 0) && is_right(first, slots[0]));
        for rank in 1..5 {
            let found = u32::from((others >> (16 * rank - 16)) as u16);
            let is_like_first = distances[slots[rank]] == distances[slots[0]];
            if costs[rank] > 0.0 || (is_like_first && costs[rank] >= -4.0) {
                assert_eq!(found, 0);
            } else {
                assert!(is_right(found, slots[rank]));
            }
        }
    });
}

const LENGTHS: usize = 30;

#[derive(Clone, Copy)]
struct Copies<'a> {
    lengths: [usize; 2],
    extra_bits: &'a [f32; LENGTHS],
    starts: [Start<'a, LENGTHS>; 2],
    matches: [u64; 4],
    count: usize,
    distance_costs: &'a [f32; 64],
}

#[kernel(Upto<B32>)]
fn try_copies(how: usize, ways: Ways<'_>, copies: &Copies<'_>) -> usize {
    let ([first, end], [start, _]) = (copies.lengths, copies.starts);
    let (bits, matches, count) = (copies.extra_bits, &copies.matches, copies.count);
    match how {
        0 => try_lengths(ways, first..end, bits, start, 77),
        1 => return try_lengths_at_cost(ways, first..end, start.cost, 77, start.insert),
        _ => {
            let costs = copies.distance_costs;
            try_matches(ways, first..end, bits, copies.starts, matches, count, costs);
        }
    }
    0
}

#[test]
fn tries_copies() {
    const ROW: usize = LENGTHS + 9;
    on_each_target(|target, numbers| {
        let mut quarters = || numbers.below(40) as f32 / 4.0;
        let tables: [[f32; LENGTHS]; 3] = from_fn(|_| from_fn(|_| quarters()));
        let distance_costs = from_fn(|_| quarters());
        let starts = from_fn(|i| Start {
            cost: quarters(),
            symbol_costs: &tables[i],
            insert: 1000 + i as u32,
        });
        let mut costs: [f32; ROW] = from_fn(|_| 5.0 * quarters());
        let (how, offset, count) = (numbers.below(3), numbers.below(10), 1 + numbers.below(4));
        let mut lengths: [usize; 4] = from_fn(|_| 2 + numbers.below(LENGTHS - 5));
        lengths[..count].sort_unstable();
        let end = lengths[count - 1] + 1;
        let distances: [u32; 4] =
            from_fn(|_| 1 + (numbers.below(1 << 30) >> numbers.below(30)) as u32);
        let copies = Copies {
            lengths: [2 + numbers.below(end - 2), end],
            extra_bits: &tables[2],
            starts,
            matches: from_fn(|i| ((lengths[i] as u64) << LENGTH_SHIFT) | u64::from(distances[i])),
            count,
            distance_costs: &distance_costs,
        };

        let mut nodes = [0; 3 * ROW];
        let (mut expected_costs, mut expected_nodes, mut longest) = (costs, nodes, 0);
        for length in copies.lengths[0]..end {
            let with_length = |base: f32, i: usize| base + tables[2][length] + tables[i][length];
            let (cost, distance, insert) = match how {
                0 => (with_length(starts[0].cost, 0), 77, 1000),
                1 => (starts[0].cost, 77, 1000),
                _ => {
                    let distance = distances[lengths[..count].partition_point(|&it| it < length)];
                    let extra_bits = (distance + 3).ilog2() - 1;
                    let symbol = 2 * (extra_bits - 1) + (((distance + 3) >> extra_bits) & 1);
                    let [a, b] = from_fn(|i| {
                        let base = starts[i].cost + extra_bits as f32;
                        with_length(base + distance_costs[symbol as usize], i)
                    });
                    (a.min(b), distance, 1000 + u32::from(b < a))
                }
            };
            if cost < costs[offset + length] {
                expected_costs[offset + length] = cost;
                for (row, value) in [length as u32, distance, insert].into_iter().enumerate() {
                    expected_nodes[row * ROW + offset + length] = value;
                }
                longest = if how == 1 { length } else { 0 };
            }
        }

        let ways = Ways {
            costs: &mut costs,
            nodes: &mut nodes,
            offset: offset as u32,
        };
        if let Some(taken) = try_copies::to(target, how, ways, &copies) {
            assert_eq!(
                (taken, costs, nodes),
                (longest, expected_costs, expected_nodes)
            );
        }
    });
}
