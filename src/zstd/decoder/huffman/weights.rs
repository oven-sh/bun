//! Tree descriptions.

use crate::array::At;
use crate::bits::{BackwardBits, Width};
use crate::error::{Error, Result};
use crate::format::HUFFMAN_TABLE_LOG_MAX;
use crate::fse::{Spread, read_counts};

const TABLE_LOG_MAX: u32 = 6;
const STATES_MAX: usize = 1 << TABLE_LOG_MAX;
/// Stands for all that are too high.
const INVALID_WEIGHT: u8 = 15;

/// What a tree description says.
pub struct HuffmanWeights {
    /// By symbol. The first `symbol_count` count.
    pub weights: [u8; 256],
    /// By weight: how many symbols have it.
    pub rank_counts: [u32; 16],
    pub symbol_count: usize,
    /// The length of the longest code.
    pub table_log: u32,
    /// Of the description, in bytes.
    pub len: usize,
    /// `rank_counts` for each run of [`Self::quarter_len`] symbols.
    pub(super) counts_by_quarter: [[u8; 16]; 4],
}

/// Reads the description at the start of `src`.
pub fn read_huffman_weights(src: &[u8]) -> Result<HuffmanWeights> {
    let mut tree = HuffmanWeights::EMPTY;
    tree.read(src)?;
    Ok(tree)
}

impl HuffmanWeights {
    pub(super) const EMPTY: Self = Self {
        weights: [0; _],
        rank_counts: [0; _],
        symbol_count: 0,
        table_log: 0,
        len: 0,
        counts_by_quarter: [[0; _]; _],
    };

    /// To be called on [`Self::EMPTY`].
    #[inline(always)]
    pub(super) fn read(&mut self, src: &[u8]) -> Result<()> {
        let (&header, rest) = src.split_first().ok_or(Error::CorruptionDetected)?;
        let (listed, len) = match header.checked_sub(127) {
            Some(listed @ 1..) => {
                let len = usize::from(listed).div_ceil(2);
                let pairs = rest.get(..len).ok_or(Error::CorruptionDetected)?;
                for (to, pair) in self.weights.as_chunks_mut().0.iter_mut().zip(pairs) {
                    *to = [pair >> 4, pair & 15];
                }
                *self.weights.at_mut(listed.into()) = 0;
                (listed.into(), len)
            }
            _ => {
                let len = header.into();
                let compressed = rest.get(..len).ok_or(Error::CorruptionDetected)?;
                (decompress(compressed, &mut self.weights)?, len)
            }
        };
        (self.symbol_count, self.len) = (listed + 1, len + 1);

        let mut counts = [[0; 16]; 4];
        self.for_each_in_quarters(
            #[inline(always)]
            |quarter, _, weight| *counts.at_mut(quarter).at_mut(weight) += 1,
        );
        for quarter in &counts {
            for (sum, &count) in self.rank_counts.iter_mut().zip(quarter) {
                *sum += u32::from(count);
            }
        }
        let ranks = self.rank_counts.iter().skip(1).zip(0..);
        let total: u32 = ranks.map(|(count, shorter_by)| count << shorter_by).sum();
        self.table_log = total.bit_width();
        if total == 0 || self.table_log > HUFFMAN_TABLE_LOG_MAX {
            return Err(Error::CorruptionDetected);
        }
        let missing = (1 << self.table_log) - total;
        if !missing.is_power_of_two() {
            return Err(Error::CorruptionDetected);
        }
        let last_weight = missing.bit_width() as usize;
        *self.weights.at_mut(listed) = last_weight as u8;
        *self.rank_counts.at_mut(last_weight) += 1;
        self.rank_counts[0] -= (4 * self.quarter_len() - listed) as u32;
        let quarter = (1..4)
            .filter(|quarter| quarter * self.quarter_len() <= listed)
            .count();
        counts.at_mut(quarter)[0] -= 1;
        *counts.at_mut(quarter).at_mut(last_weight) += 1;
        self.counts_by_quarter = counts;
        // Their number is even, as the total is.
        if self.rank_counts[1] == 0 {
            return Err(Error::CorruptionDetected);
        }
        Ok(())
    }

    #[inline(always)]
    pub(super) fn quarter_len(&self) -> usize {
        self.symbol_count.div_ceil(4)
    }

    /// `visit` gets a quarter, a symbol and its weight. Neighbors, which tend to be equal, would wait for each other.
    #[inline(always)]
    pub(super) fn for_each_in_quarters(&self, mut visit: impl FnMut(usize, u8, usize)) {
        let len = self.quarter_len();
        for index in 0..len {
            for quarter in 0..4 {
                let symbol = quarter * len + index;
                visit(quarter, symbol as u8, (*self.weights.at(symbol)).into());
            }
        }
    }
}

#[derive(Clone, Copy)]
#[repr(C, align(4))]
struct Row {
    weight: u8,
    bits: Width,
    baseline: u8,
}

/// Returns how many weights there are: at most 255.
#[inline(always)]
fn decompress(src: &[u8], weights: &mut [u8; 256]) -> Result<usize> {
    const BATCH: usize = 8;
    const { assert!(BATCH as u32 * TABLE_LOG_MAX <= BackwardBits::IN_REFILL) };

    // Limits of the reference decoder.
    let mut counts = [0; 92];
    let description = read_counts(src, &mut counts)?;
    let (log, max_symbol) = (description.table_log, description.max_symbol);
    if log > TABLE_LOG_MAX || (log == TABLE_LOG_MAX && max_symbol > 11) {
        return Err(Error::CorruptionDetected);
    }
    let counts = counts.get(..=max_symbol).ok_or(Error::Internal)?;
    let mut states = Spread::<{ STATES_MAX + 8 }, 128>::EMPTY;
    states.fill(counts, log);
    let mut table = [Row {
        weight: 0,
        bits: Width::W0,
        baseline: 0,
    }; STATES_MAX];
    for row in table.iter_mut().take(1 << log) {
        let state = states.next_state();
        *row = Row {
            weight: state.symbol.min(INVALID_WEIGHT),
            bits: Width::new(state.bits),
            baseline: state.baseline as u8,
        };
    }

    let mut bits = BackwardBits::new(src, description.len)?;
    let mut current = table.at(bits.read(log) as usize);
    let mut other = table.at(bits.read(log) as usize);
    if bits.left() < 0 {
        return Err(Error::CorruptionDetected);
    }
    let after = |row: &Row, bits: &mut BackwardBits<'_>| {
        table.at(usize::from(row.baseline) + bits.read(row.bits as u32) as usize)
    };

    let mut count = 0;
    bits.refill();
    for batch in weights
        .as_chunks_mut::<BATCH>()
        .0
        .iter_mut()
        .take(255 / BATCH)
    {
        if bits.left() < (BATCH as u32 * TABLE_LOG_MAX) as isize {
            break;
        }
        for pair in batch.as_chunks_mut().0 {
            *pair = [current.weight, other.weight];
            current = after(current, &mut bits);
            other = after(other, &mut bits);
        }
        bits.refill();
        count += BATCH;
    }
    // Either the bits or the weights that are left are too few to need a refill.
    while count < 254 {
        *weights.at_mut(count) = current.weight;
        (current, other) = (other, after(current, &mut bits));
        count += 1;
        if bits.left() < 0 {
            *weights.at_mut(count) = current.weight;
            return Ok(count + 1);
        }
    }
    Err(Error::CorruptionDetected)
}
