//! Counts symbols, and estimates what they cost.

use bun_highway::brotli::{SPARE_LOGARITHMS, estimate_costs};

use super::log2::{FRACTION_BITS, fast_log2, fixed_point_log2};
use super::symbol_set::SymbolSet;
use crate::format::{
    CODE_LENGTH_CODES, COMMAND_SYMBOLS, DistanceParams, LITERAL_SYMBOLS, MAX_DIRECT_CODES,
    MAX_POSTFIX_BITS, REPEAT_ZERO_CODE_LENGTH, repeat_extra_bits,
};
use crate::memory::{self, Result};

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
        count_symbols(symbols, &mut self.counts);
        self.total += symbols.len();
    }

    #[inline(never)]
    pub(super) fn merge(&mut self, other: &Self) {
        for (count, other) in self.counts.iter_mut().zip(&other.counts) {
            *count += other;
        }
        self.total += other.total;
    }
}

#[inline(always)]
pub(super) fn count_symbols(symbols: &[u16], counts: &mut [u32]) {
    for &symbol in symbols {
        counts[usize::from(symbol)] += 1;
    }
}

/// A histogram for any alphabet, with the symbols that it has.
#[derive(Clone, Copy)]
pub(super) struct Indexed<'a> {
    counts: &'a [u32],
    pub(super) total: usize,
    used: SymbolSet,
}

impl<'a> Indexed<'a> {
    pub(super) fn new(counts: &'a [u32], total: usize) -> Self {
        let searched = if total == 0 { &[] } else { counts };
        Self {
            counts,
            total,
            used: SymbolSet::matching(searched, |count| count != 0),
        }
    }

    pub(super) fn empty(alphabet_size: usize) -> Self {
        Self::new(&[0; COMMAND_SYMBOLS][..alphabet_size], 0)
    }
}

/// For the same alphabet.
pub(super) struct IndexedList {
    pub(super) alphabet_size: usize,
    counts: Vec<u32>,
    indexes: Vec<(usize, SymbolSet)>,
}

impl IndexedList {
    pub(super) fn new(alphabet_size: usize) -> Self {
        Self {
            alphabet_size,
            counts: Vec::new(),
            indexes: Vec::new(),
        }
    }

    pub(super) fn clear(&mut self) {
        self.counts.clear();
        self.indexes.clear();
    }

    pub(super) fn try_reserve(&mut self, additional: usize) -> Result<()> {
        memory::try_reserve(&mut self.counts, additional * self.alphabet_size)?;
        memory::try_reserve(&mut self.indexes, additional)
    }

    pub(super) fn push(&mut self, histogram: &Indexed<'_>) {
        self.counts.extend_from_slice(histogram.counts);
        self.indexes.push((histogram.total, histogram.used));
    }

    #[inline(always)]
    pub(super) fn get(&self, id: u32) -> Indexed<'_> {
        let (total, used) = self.indexes[id as usize];
        Indexed {
            counts: &self.counts[id as usize * self.alphabet_size..][..self.alphabet_size],
            total,
            used,
        }
    }

    /// Adds `second` to `first`, which comes before it.
    pub(super) fn merge(&mut self, [first, second]: [u32; 2]) {
        let (total, used) = self.indexes[second as usize];
        let index = &mut self.indexes[first as usize];
        *index = (index.0 + total, index.1.union(&used));
        let size = self.alphabet_size;
        let (before, added) = self.counts.split_at_mut(second as usize * size);
        for (count, added) in before[first as usize * size..]
            .iter_mut()
            .zip(&added[..size])
        {
            *count += added;
        }
    }
}

/// Estimates the bits for a prefix code and for its symbols.
pub(super) struct Estimator {
    logarithms: Vec<[f64; 2]>,
}

impl Estimator {
    /// For histograms of about `symbols` symbols altogether.
    pub(super) fn new(symbols: usize) -> Result<Self> {
        let known = (symbols / 32).next_power_of_two().max(256);
        let mut logarithms = memory::empty(known + SPARE_LOGARITHMS)?;
        logarithms.push([1e6, 0.0]);
        logarithms.extend((1..known).map(|count| [fast_log2(count), count as f64]));
        memory::resize(&mut logarithms, known + SPARE_LOGARITHMS, [0.0; 2]);
        Ok(Self { logarithms })
    }

    pub(super) fn cost(&mut self, histogram: &Indexed<'_>) -> f64 {
        let &Indexed {
            counts,
            total,
            used,
        } = histogram;
        let nothing = Indexed::empty(counts.len()).counts;
        if used.len() <= 4 {
            return cost_of_few(&used, total, counts, nothing);
        }
        if let Ok(total) = total.try_into() {
            return cost_of_little(&used, total, counts, nothing);
        }
        let (totals, gaps) = ([total as u32; 4], used.gaps().map(|gaps| [gaps; 4]));
        let logarithms = &mut self.logarithms;
        estimate_costs(
            counts,
            [nothing; 4],
            used.words(),
            &totals,
            &gaps,
            logarithms,
        )[0]
    }

    /// Of `common` together with those of `all` that have one of `ids`.
    #[inline(never)]
    pub(super) fn set_costs(
        &mut self,
        common: &Indexed<'_>,
        all: &IndexedList,
        ids: &[u32],
        costs: &mut [f64],
    ) {
        // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/bit_cost_inc.h#L13
        let (mut waiting, mut counts) = ([0; 4], [common.counts; 4]);
        let (mut totals, mut gaps) = ([0; 4], [[0; 4]; 2]);
        let (mut all_used, mut count) = (common.used, 0);
        for (left, &id) in (0..ids.len()).rev().zip(ids) {
            let other = all.get(id);
            let (total, used) = (common.total + other.total, common.used.union(&other.used));
            if used.len() <= 4 {
                costs[id as usize] = cost_of_few(&used, total, common.counts, other.counts);
            } else if let Ok(total) = total.try_into() {
                costs[id as usize] = cost_of_little(&used, total, common.counts, other.counts);
            } else {
                all_used = all_used.union(&used);
                (waiting[count], counts[count], totals[count]) = (id, other.counts, total as u32);
                [gaps[0][count], gaps[1][count]] = used.gaps();
                count += 1;
            }
            if count == 4 || (count != 0 && left == 0) {
                let estimates = estimate_costs(
                    common.counts,
                    counts,
                    all_used.words(),
                    &totals,
                    &gaps,
                    &mut self.logarithms,
                );
                for (&id, cost) in waiting[..count].iter().zip(estimates) {
                    costs[id as usize] = cost;
                }
                (all_used, count) = (common.used, 0);
            }
        }
    }
}

/// `used` has the symbols of both, at most four.
#[inline(never)]
fn cost_of_few(used: &SymbolSet, total: usize, counts: &[u32], more: &[u32]) -> f64 {
    let mut sums = [0; 4];
    for (sum, symbol) in sums.iter_mut().zip(used) {
        *sum = counts[symbol] + more[symbol];
    }
    sums.sort_unstable();
    let [d, c, b, a] = sums;
    match used.len() {
        0 | 1 => 12.0,
        2 => 20.0 + total as f64,
        3 => 28.0 + f64::from(2 * (a + b + c)) - f64::from(a),
        _ => 37.0 + f64::from(3 * (c + d)) + f64::from(2 * (a + b)) - f64::from(a.max(c + d)),
    }
}

/// `used` has the symbols of both. Nothing is rounded before the code lengths are counted.
#[inline(never)]
fn cost_of_little(used: &SymbolSet, total: u8, counts: &[u32], more: &[u32]) -> f64 {
    // https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/bit_cost_inc.h#L70
    const RUN: u32 = (2 * u8::MAX as u32 + 1).next_power_of_two();
    /// For so many zeros in a row: the number of codes for a run, times `RUN`, or of zeros that make no run.
    static GAPS: [u16; COMMAND_SYMBOLS.next_power_of_two()] = {
        let (mut gaps, mut zeros) = ([0; _], 0usize);
        while zeros < gaps.len() {
            gaps[zeros] = match zeros {
                ..3 => zeros as u16,
                _ => ((zeros - 2).ilog2() / 3 + 1) as u16 * RUN as u16,
            };
            zeros += 1;
        }
        gaps
    };
    let more = &more[..counts.len()];
    let log2_total = fixed_point_log2(total);
    let (mut saved, mut gaps, mut next_symbol) = (0, 0, 0);
    // Up to 8 bits, and then the code for runs of zeros.
    let mut lengths = [0u32; 16];
    for symbol in used {
        let count = (counts[symbol] + more[symbol]) as u8;
        gaps += u32::from(GAPS[(symbol - next_symbol) % GAPS.len()]);
        next_symbol = symbol + 1;
        let log2_count = fixed_point_log2(count);
        saved += u64::from(count) * u64::from(log2_count);
        let rounded = log2_total - log2_count + (1 << (FRACTION_BITS - 1));
        lengths[(rounded >> FRACTION_BITS) as usize % 16] += 1;
    }
    let bits = (u64::from(total) * u64::from(log2_total) - saved) as i64 as f64;
    let max_length = lengths[2..9].iter().rposition(|&count| count != 0);
    let max_length = max_length.map_or(1, |index| index as u32 + 2);
    lengths[0] += gaps % RUN;
    lengths[9] = gaps / RUN;
    let extra_bits = repeat_extra_bits(REPEAT_ZERO_CODE_LENGTH.into()) * lengths[9];
    bits / f64::from(1 << FRACTION_BITS)
        + f64::from(extra_bits + CODE_LENGTH_CODES as u32 + 2 * max_length)
        + entropy_of(lengths[..10].iter().copied(), lengths.iter().sum())
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
