//! Counts symbols, and estimates what they cost.

use super::log2::fast_log2;
use super::symbol_set::SymbolSet;
use crate::format::{DistanceParams, LITERAL_SYMBOLS, MAX_DIRECT_CODES, MAX_POSTFIX_BITS};

/// The largest distance alphabet.
pub(super) const DISTANCE_SYMBOLS: usize =
    DistanceParams::new(MAX_POSTFIX_BITS, MAX_DIRECT_CODES, true)
        .alphabet
        .size as usize;

#[inline(always)]
pub(super) fn count_symbols(symbols: &[u16], counts: &mut [u32]) {
    for &symbol in symbols {
        counts[usize::from(symbol)] += 1;
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

/// The entropy, but at least one bit for each symbol.
#[inline(never)]
pub(super) fn bits_entropy(counts: &[u32]) -> f64 {
    let frequent = SymbolSet::matching(counts, |count| count > 1);
    let frequent = (&frequent).into_iter().map(|symbol| counts[symbol]);
    entropy_of(frequent, counts.iter().sum())
}

/// Counts below 2 can be missing.
#[inline(always)]
fn entropy_of(counts: impl Iterator<Item = u32>, sum: u32) -> f64 {
    let mut bits = 0.0;
    for count in counts {
        bits -= f64::from(count) * fast_log2(count as usize);
    }
    bits += f64::from(sum) * fast_log2(sum as usize);
    bits.max(f64::from(sum))
}
