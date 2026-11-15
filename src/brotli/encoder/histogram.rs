//! Counts symbols, and estimates what they cost.

use super::log2::fast_log2;
use super::symbol_set::SymbolSet;
use crate::format::{
    CODE_LENGTH_CODES, COMMAND_SYMBOLS, DistanceParams, LITERAL_SYMBOLS, MAX_CODE_LENGTH,
    MAX_DIRECT_CODES, MAX_POSTFIX_BITS, REPEAT_ZERO_CODE_LENGTH,
};

/// The largest distance alphabet.
pub(super) const DISTANCE_SYMBOLS: usize =
    DistanceParams::new(MAX_POSTFIX_BITS, MAX_DIRECT_CODES, true)
        .alphabet
        .size as usize;

pub(super) type LiteralHistogram = Histogram<LITERAL_SYMBOLS>;
pub(super) type CommandHistogram = Histogram<COMMAND_SYMBOLS>;
pub(super) type DistanceHistogram = Histogram<DISTANCE_SYMBOLS>;

#[derive(Clone, Copy)]
pub(super) struct Histogram<const N: usize> {
    pub(super) counts: [u32; N],
    pub(super) total: usize,
}

impl<const N: usize> Histogram<N> {
    pub(super) const EMPTY: Self = Self {
        counts: [0; N],
        total: 0,
    };

    pub(super) fn clear(&mut self) {
        self.counts.fill(0);
        self.total = 0;
    }

    #[inline(always)]
    pub(super) fn add(&mut self, symbol: usize) {
        self.counts[symbol] += 1;
        self.total += 1;
    }

    #[inline(always)]
    pub(super) fn add_all(&mut self, symbols: &[u16]) {
        for &symbol in symbols {
            self.counts[usize::from(symbol)] += 1;
        }
        self.total += symbols.len();
    }

    pub(super) fn merge(&mut self, other: &Self) {
        for (count, other) in self.counts.iter_mut().zip(&other.counts) {
            *count += other;
        }
        self.total += other.total;
    }

    pub(super) fn used(&self) -> SymbolSet {
        SymbolSet::matching(&self.counts, |count| count != 0)
    }

    /// An estimate of the bits for the prefix code and for the symbols.
    pub(super) fn cost(&self) -> f64 {
        cost(&self.used(), self.total, |symbol| self.counts[symbol])
    }

    /// `used` has the symbols of both.
    pub(super) fn cost_with(&self, other: &Self, used: &SymbolSet) -> f64 {
        let count_of = |symbol: usize| self.counts[symbol] + other.counts[symbol];
        cost(used, self.total + other.total, count_of)
    }
}

pub(super) fn count_bytes(bytes: &[u8]) -> [u32; LITERAL_SYMBOLS] {
    // An increment has to wait for the previous one of the same counter.
    let mut counts = [[0; LITERAL_SYMBOLS]; 2];
    let (pairs, rest) = bytes.as_chunks::<2>();
    for &[a, b] in pairs {
        counts[0][usize::from(a)] += 1;
        counts[1][usize::from(b)] += 1;
    }
    if let &[last] = rest {
        counts[0][usize::from(last)] += 1;
    }
    core::array::from_fn(|i| counts[0][i] + counts[1][i])
}

pub(super) fn count_every_nth_byte<const N: usize>(bytes: &[u8]) -> [u32; LITERAL_SYMBOLS] {
    let mut counts = [0; LITERAL_SYMBOLS];
    for &byte in bytes.iter().step_by(N) {
        counts[usize::from(byte)] += 1;
    }
    counts
}

/// `value` is in `0.0..64.0`. A cast would spend time on what is not.
#[inline(always)]
fn whole_part(value: f64) -> usize {
    (value.floor() + (1u64 << (f64::MANTISSA_DIGITS - 1)) as f64).to_bits() as usize % 64
}

// https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/bit_cost_inc.h#L13
#[inline(always)]
fn cost(used: &SymbolSet, total: usize, count_of: impl Fn(usize) -> u32) -> f64 {
    let mut bits = 0.0;
    let mut lengths = [0; CODE_LENGTH_CODES];
    let log2_total = fast_log2(total);
    let mut first = [0; 4];
    let (mut used_count, mut next_symbol) = (0, 0);
    for symbol in used {
        let count = count_of(symbol);
        first[used_count % 4] = count;
        used_count += 1;
        let zeros = symbol - next_symbol;
        next_symbol = symbol + 1;
        if zeros < 3 {
            lengths[0] += zeros as u32;
        } else {
            let mut left = zeros - 2;
            while left > 0 {
                lengths[usize::from(REPEAT_ZERO_CODE_LENGTH)] += 1;
                bits += 3.0;
                left >>= 3;
            }
        }
        let log2_p = log2_total - fast_log2(count as usize);
        bits += f64::from(count) * log2_p;
        lengths[whole_part(log2_p + 0.5).min(MAX_CODE_LENGTH)] += 1;
    }
    if used_count > 4 {
        let longer = lengths[2..=MAX_CODE_LENGTH]
            .iter()
            .rposition(|&count| count != 0);
        let max_length = longer.map_or(1, |index| index + 2);
        return bits + (18 + 2 * max_length) as f64 + bits_entropy(&lengths);
    }
    first.sort_unstable();
    let [d, c, b, a] = first;
    match used_count {
        0 | 1 => 12.0,
        2 => 20.0 + total as f64,
        3 => 28.0 + f64::from(2 * (a + b + c)) - f64::from(a),
        _ => 37.0 + f64::from(3 * (c + d)) + f64::from(2 * (a + b)) - f64::from(a.max(c + d)),
    }
}

/// The entropy, but at least one bit for each symbol.
#[inline(always)]
pub(super) fn bits_entropy(counts: &[u32]) -> f64 {
    let sum = counts.iter().sum::<u32>() as usize;
    let mut bits = 0.0;
    for symbol in &SymbolSet::matching(counts, |count| count > 1) {
        bits -= f64::from(counts[symbol]) * fast_log2(counts[symbol] as usize);
    }
    bits += sum as f64 * fast_log2(sum);
    bits.max(sum as f64)
}
