//! Temporary: switches between the kernels and other ways to get the same results.
#![allow(clippy::all, clippy::pedantic, dead_code)]

use core::array::from_fn;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_highway::{BrotliPlace, BrotliStart, BrotliWays};

use super::log2::fast_log2;
use super::matching::{bytes_at, load64};
use super::symbol_set::SymbolSet;

pub(super) const FS_RUST: u32 = 1 << 0;
pub(super) const FS_128: u32 = 1 << 1;
pub(super) const EC_RUST: u32 = 1 << 2;
pub(super) const EC_128: u32 = 1 << 3;
pub(super) const EC_RUST_IF_SMALL: u32 = 1 << 4;
pub(super) const EC_128_IF_SMALL: u32 = 1 << 5;
pub(super) const NO_LITTLE: u32 = 1 << 6;
pub(super) const EC_INTEGER_RUNS: u32 = 1 << 7;
pub(super) const RP_RUST: u32 = 1 << 8;
pub(super) const RP_128: u32 = 1 << 9;
pub(super) const RP_BY_FOUR: u32 = 1 << 10;
pub(super) const RP_COLUMNS: u32 = 1 << 11;
pub(super) const SL_RUST: u32 = 1 << 12;
pub(super) const SL_128: u32 = 1 << 13;
pub(super) const SL_MAX_0: u32 = 1 << 14;
pub(super) const SL_MAX_64: u32 = 1 << 15;
const MARK: u32 = 1 << 16;
pub(super) const SC_RUST: u32 = 1 << 17;
pub(super) const SC_GENERAL: u32 = 1 << 18;
pub(super) const SC_PLAIN_FOUR: u32 = 1 << 19;
pub(super) const S5_RUST: u32 = 1 << 20;
pub(super) const S5_MERGED: u32 = 1 << 21;
pub(super) const TM_RUST: u32 = 1 << 22;
pub(super) const TM_NONE: u32 = 1 << 23;
pub(super) const PB_KERNEL: u32 = 1 << 24;
pub(super) const TL_KERNEL: u32 = 1 << 25;
pub(super) const FS_128_IF_SMALL: u32 = 1 << 26;
pub(super) const SL_MIN_8: u32 = 1 << 27;
pub(super) const LITTLE_ALWAYS: u32 = 1 << 28;

static SWITCHES: AtomicU32 = AtomicU32::new(0);

/// Returns what is left of the parameter.
pub(super) fn take_from(block_bits: u32) -> u32 {
    if block_bits & MARK == 0 || block_bits >> 29 != 0 {
        return block_bits;
    }
    SWITCHES.store(block_bits & !MARK, Ordering::Relaxed);
    bun_highway::brotli_set_switches(block_bits);
    0
}

#[inline(always)]
pub(super) fn all() -> u32 {
    SWITCHES.load(Ordering::Relaxed)
}

#[inline(always)]
pub(super) fn is_on(bits: u32) -> bool {
    all() & bits != 0
}

/// Returns whether to estimate costs in Rust.
pub(super) fn begin_meta_block(symbols: usize) -> bool {
    let (mut switches, is_small) = (all(), symbols <= 1024);
    if switches & (EC_128_IF_SMALL | FS_128_IF_SMALL) != 0 {
        if is_small && switches & EC_128_IF_SMALL != 0 {
            switches |= EC_128;
        }
        if symbols <= 8192 && switches & FS_128_IF_SMALL != 0 {
            switches |= FS_128;
        }
        bun_highway::brotli_set_switches(switches);
    }
    switches & EC_RUST != 0 || (is_small && switches & EC_RUST_IF_SMALL != 0)
}

#[inline(always)]
fn lanes_where(test: impl Fn(usize) -> bool) -> u8 {
    (0..8).fold(0, |bits, lane| bits | (u8::from(test(lane)) << lane))
}

#[inline(always)]
fn smaller(a: f64, b: f64) -> f64 {
    if a < b { a } else { b }
}

#[inline(always)]
pub(super) fn find_switches(
    data: &[u16],
    symbol_costs: &[[f64; 8]],
    switch_cost: f64,
    all_costs: &mut [[f64; 8]],
    switches: &mut [u8],
    ids: &mut [u8],
) {
    const PROLOGUE: usize = 2000;
    const TOO_MUCH: f64 = 1e99;
    let groups = all_costs.len();
    let (mut min_cost, mut max_cost) = (0.0, TOO_MUCH);
    let rows = switches.chunks_exact_mut(groups);
    for (position, ((&symbol, id), switches)) in data.iter().zip(&mut *ids).zip(rows).enumerate() {
        let added = &symbol_costs[usize::from(symbol) * groups..][..groups];
        let mut min_costs = [TOO_MUCH; 8];
        for ((costs, added), switches) in all_costs.iter_mut().zip(added).zip(switches) {
            let relative = costs.map(|cost| cost - min_cost);
            *switches = lanes_where(|lane| relative[lane] >= max_cost);
            let next = from_fn(|lane| smaller(relative[lane], max_cost) + added[lane]);
            min_costs = from_fn(|lane| smaller(next[lane], min_costs[lane]));
            *costs = next;
        }
        let [a, b, c, d] = from_fn(|lane| smaller(min_costs[lane], min_costs[lane + 4]));
        min_cost = smaller(smaller(a, c), smaller(b, d));
        for (group, costs) in all_costs.iter().enumerate() {
            let cheapest = lanes_where(|lane| costs[lane] == min_cost);
            if cheapest != 0 {
                *id = (group * 8) as u8 + cheapest.trailing_zeros() as u8;
                break;
            }
        }
        max_cost = switch_cost;
        if position < PROLOGUE {
            max_cost *= 0.77 + (0.07 / PROLOGUE as f64) * position as f64;
        }
    }
}

#[inline(always)]
fn whole_part(value: f64) -> usize {
    (value.floor() + (1u64 << (f64::MANTISSA_DIGITS - 1)) as f64).to_bits() as usize % 64
}

/// `known` is `[log2(n), n]`.
#[inline(never)]
pub(super) fn cost(
    used: &SymbolSet,
    total: usize,
    counts: &[u32],
    more: &[u32],
    known: &[[f64; 2]],
) -> f64 {
    let more = &more[..counts.len()];
    let mut bits = 0.0;
    let mut lengths = [0u32; 18];
    let log2_total = fast_log2(total);
    let cost_of = |count: u32| {
        let log = match known.get(count as usize) {
            Some(entry) => entry[0],
            None => {
                core::hint::cold_path();
                f64::from(count).log2()
            }
        };
        let log2_p = log2_total - log;
        let length = whole_part(log2_p + 0.5).min(15);
        (f64::from(count) * log2_p, length)
    };
    let rare: [_; 8] = from_fn(|count| {
        let log2_p = log2_total - fast_log2(count);
        (count as f64 * log2_p, whole_part(log2_p + 0.5).min(15))
    });
    let (mut lone_zeros, mut next_symbol) = (0, 0);
    for symbol in used {
        let count = counts[symbol] + more[symbol];
        let zeros = symbol - next_symbol;
        next_symbol = symbol + 1;
        if zeros < 3 {
            lone_zeros += zeros as u32;
        } else {
            let mut left = zeros - 2;
            while left > 0 {
                lengths[17] += 1;
                bits += 3.0;
                left >>= 3;
            }
        }
        let (cost, length) = match rare.get(count as usize) {
            Some(&known) => known,
            None => cost_of(count),
        };
        bits += cost;
        lengths[length % 16] += 1;
    }
    lengths[0] += lone_zeros;
    let longer = lengths[2..=15].iter().rposition(|&count| count != 0);
    let max_length = longer.map_or(1, |index| index + 2);
    let sum = lengths.iter().sum::<u32>() as usize;
    let mut entropy = 0.0;
    for symbol in &SymbolSet::matching(&lengths, |count| count > 1) {
        entropy -= f64::from(lengths[symbol]) * fast_log2(lengths[symbol] as usize);
    }
    entropy += sum as f64 * fast_log2(sum);
    bits + (18 + 2 * max_length) as f64 + entropy.max(sum as f64)
}

#[inline(always)]
fn by_distance(by_position: u8) -> u32 {
    static REORDERED: [u8; 128] = {
        let mut reordered = [0; 128];
        let mut by_position = 0;
        while by_position < 128 {
            let mut i = 0;
            while i < 7 {
                let bit = (by_position as u8 >> [3, 4, 2, 5, 1, 6, 0][i]) & 1;
                reordered[by_position] |= bit << i;
                i += 1;
            }
            by_position += 1;
        }
        reordered
    };
    u32::from(REORDERED[usize::from(by_position) % 128])
}

#[inline(always)]
fn zero_bytes(bytes: u64) -> u8 {
    const LOW: u64 = 0x7F7F_7F7F_7F7F_7F7F;
    let high_bits = !(((bytes & LOW) + LOW) | bytes | LOW);
    (high_bits.wrapping_mul(0x0002_0408_1020_4081) >> 56) as u8
}

#[inline(always)]
fn may_be_at(place: BrotliPlace<'_>, distance: i32) -> u32 {
    let index = (place.position.wrapping_sub(distance as u32) & place.ring_mask) as usize;
    u32::from(bytes_at(place.ring, index.min(place.ring.len() - 2)) == place.pair)
}

#[inline(always)]
fn may_be_around(place: BrotliPlace<'_>, distance: i32) -> u32 {
    let nearest = place.position.wrapping_sub(distance as u32).wrapping_add(3) & place.ring_mask;
    let start = (nearest as usize).wrapping_sub(6);
    let Some(bytes) = place.ring.get(start..).and_then(|rest| rest.get(..9)) else {
        return 0x7F;
    };
    let splat = |byte: u8| u64::from(byte) * 0x0101_0101_0101_0101;
    let [first, second] = [0, 1].map(|i| load64(bytes, i) ^ splat(place.pair[i]));
    by_distance(zero_bytes(first | second))
}

#[inline(always)]
pub(super) fn first_short_codes(place: BrotliPlace<'_>, last: &[i32; 4], count: usize) -> u32 {
    let mut promising = 0;
    for (i, &distance) in last.iter().enumerate() {
        promising |= may_be_at(place, distance) << i;
    }
    if count > 4 {
        promising |= (may_be_around(place, last[0]) >> 1) << 4;
        if count > 10 {
            promising |= (may_be_around(place, last[1]) >> 1) << 10;
        }
    }
    promising
}

#[inline(always)]
pub(super) fn short_codes(place: BrotliPlace<'_>, &[a, b, c, d]: &[i32; 4]) -> u32 {
    if place.ring.len() < 9 {
        return 0xFFFF;
    }
    let [near_a, near_b] = [a, b].map(|distance| may_be_around(place, distance));
    (near_a & 1)
        | ((near_b & 1) << 1)
        | (may_be_at(place, c) << 2)
        | (may_be_at(place, d) << 3)
        | ((near_a >> 1) << 4)
        | ((near_b >> 1) << 10)
}

#[inline(always)]
pub(super) fn short_codes_of_five(
    place: BrotliPlace<'_>,
    last_distances: &[[i32; 4]; 8],
    ranked: &[u64; 5],
    hopeless: f32,
) -> (u32, u64) {
    let of = |rank: usize| {
        &last_distances[(ranked[rank] >> bun_highway::BROTLI_SLOT_SHIFT) as usize % 8]
    };
    let first = short_codes(place, of(0));
    let mut others = 0;
    for rank in 1..5 {
        let cost = f32::from_bits((ranked[rank] >> 32) as u32);
        if cost > 0.0 {
            break;
        }
        let codes = if of(rank) != of(0) {
            short_codes(place, of(rank))
        } else if cost >= hopeless {
            0
        } else {
            first
        };
        others |= u64::from(codes) << (16 * rank - 16);
    }
    (first, others)
}

#[inline(always)]
fn less(a: [f32; 4], b: &[f32; 4]) -> u32 {
    (0..4).fold(0, |bits, i| bits | (u32::from(a[i] < b[i]) << i))
}

#[inline(always)]
fn lanes(values: &[f32], at: usize) -> &[f32; 4] {
    values[at..].first_chunk().unwrap_or(&[1.7e38; 4])
}

#[inline(always)]
pub(super) fn try_matches<const N: usize>(
    ways: BrotliWays<'_>,
    lengths: core::ops::Range<usize>,
    extra_bits: &[f32; N],
    [first, second]: [BrotliStart<'_, N>; 2],
    matches: &[u64; 4],
    count: usize,
    distance_costs: &[f32; 64],
) {
    let (stride, offset) = (ways.costs.len(), ways.offset as usize);
    let mut length = lengths.start;
    for &found in &matches[..count.min(4)] {
        let end = (found >> bun_highway::BROTLI_LENGTH_SHIFT) as usize + 1;
        if end <= length {
            continue;
        }
        let distance = found as u32;
        let shifted = distance + 3;
        let bits = shifted.ilog2() - 1;
        let symbol = 2 * (bits - 1) + ((shifted >> bits) & 1);
        let [base, base2] = [first.cost, second.cost]
            .map(|cost| cost + bits as f32 + distance_costs[symbol as usize % 64]);
        while length < end {
            let extra = lanes(extra_bits, length);
            let (a, b) = (
                lanes(first.symbol_costs, length),
                lanes(second.symbol_costs, length),
            );
            let one: [f32; 4] = from_fn(|i| base + extra[i] + a[i]);
            let two: [f32; 4] = from_fn(|i| base2 + extra[i] + b[i]);
            let costs: [f32; 4] = from_fn(|i| if two[i] < one[i] { two[i] } else { one[i] });
            let mut better = less(costs, lanes(ways.costs, offset + length));
            better &= (1 << 4.min(end - length)) - 1;
            while better != 0 {
                let lane = better.trailing_zeros() as usize % 4;
                better &= better - 1;
                let at = offset + length + lane;
                ways.costs[at] = costs[lane];
                ways.nodes[at] = (length + lane) as u32;
                ways.nodes[stride + at] = distance;
                ways.nodes[2 * stride + at] = if two[lane] < one[lane] {
                    second.insert
                } else {
                    first.insert
                };
            }
            length += 4;
        }
        length = end;
    }
}
