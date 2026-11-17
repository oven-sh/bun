//! Temporary: switches between the kernels and other ways to get the same results.
#![allow(clippy::all, clippy::pedantic, dead_code)]

use core::array::from_fn;
use core::sync::atomic::{AtomicU32, Ordering};

use super::log2::fast_log2;
use super::symbol_set::SymbolSet;

pub(super) const SL_RUST: u32 = 1 << 0;
pub(super) const LITTLE_ALWAYS: u32 = 1 << 3;
pub(super) const EC_RUST_IF_SMALL: u32 = 1 << 4;
pub(super) const EC_RUST_SINGLE: u32 = 1 << 5;
pub(super) const SL_SHELL_ONLY: u32 = 1 << 7;
pub(super) const SL_MAX_32: u32 = 1 << 8;
const MARK: u32 = 1 << 16;

static SWITCHES: AtomicU32 = AtomicU32::new(0);

/// Returns what is left of the parameter.
pub(super) fn take_from(block_bits: u32) -> u32 {
    if block_bits & MARK == 0 || block_bits >> 17 != 0 {
        return block_bits;
    }
    SWITCHES.store(block_bits & !MARK, Ordering::Relaxed);
    0
}

#[inline(always)]
pub(super) fn is_on(bits: u32) -> bool {
    SWITCHES.load(Ordering::Relaxed) & bits != 0
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
