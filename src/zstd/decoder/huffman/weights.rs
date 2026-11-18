//! Tree descriptions.

use crate::array::At;
use crate::bits::{BackwardBits, Width};
use crate::bounded::Bounded;
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
    by_weight: Buckets,
}

struct Buckets {
    symbols: [u8; 2048],
    ends: [u16; 16],
}

impl Buckets {
    /// With room for as many as a valid description can have. Of more than that, only the number is right.
    #[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
    const STARTS: [u16; 16] = {
        let (mut starts, mut weight) = ([0; _], 0);
        while weight < HUFFMAN_TABLE_LOG_MAX as usize {
            let most = 2 << HUFFMAN_TABLE_LOG_MAX >> weight;
            starts[weight + 1] = starts[weight] + if most < 256 { most } else { 256 };
            weight += 1;
        }
        assert!(starts[weight] + 256 <= 2048);
        starts
    };

    #[inline(always)]
    fn add(&mut self, symbol: usize, weight: u8) {
        let end = self.ends.at_mut(weight.into());
        *self.symbols.at_mut((*end).into()) = symbol as u8;
        *end = end.plus(1);
    }
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
        by_weight: Buckets {
            symbols: [0; _],
            ends: Buckets::STARTS,
        },
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
                for (symbol, &weight) in self.weights.iter().enumerate().take(listed.into()) {
                    self.by_weight.add(symbol, weight);
                }
                (listed.into(), len)
            }
            _ => {
                let len = header.into();
                let compressed = rest.get(..len).ok_or(Error::CorruptionDetected)?;
                let listed = decompress(compressed, &mut self.weights, &mut self.by_weight)?;
                (listed, len)
            }
        };
        (self.symbol_count, self.len) = (listed + 1, len + 1);

        let buckets = Buckets::STARTS.iter().zip(&self.by_weight.ends);
        for (count, (start, end)) in self.rank_counts.iter_mut().zip(buckets) {
            *count = end.minus(*start).into();
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
        self.by_weight.add(listed, last_weight as u8);
        // Their number is even, as the total is.
        if self.rank_counts[1] == 0 {
            return Err(Error::CorruptionDetected);
        }
        Ok(())
    }

    #[inline(always)]
    fn weight_of(&self, length: u32) -> usize {
        self.table_log.plus(1).minus(length) as usize
    }

    #[inline(always)]
    pub(super) fn count_of(&self, length: u32) -> u32 {
        *self.rank_counts.at(self.weight_of(length))
    }

    /// The symbols with codes of `length` bits, and other bytes behind them.
    #[inline(always)]
    pub(super) fn padded_symbols_of(&self, length: u32) -> &[u8] {
        let start = *Buckets::STARTS.at(self.weight_of(length));
        (self.by_weight.symbols.get(start.into()..)).unwrap_or_default()
    }
}

#[derive(Clone, Copy)]
#[repr(C, align(4))]
struct Row {
    weight: u8,
    bits: Width,
    baseline: u8,
}

/// Returns how many weights there are: at most 255. Sorting takes no time while each one waits for the one before.
#[inline(always)]
fn decompress(src: &[u8], weights: &mut [u8; 256], by_weight: &mut Buckets) -> Result<usize> {
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
        table.at(usize::from(row.baseline).plus(bits.read(row.bits as u32) as usize))
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
            by_weight.add(count, current.weight);
            by_weight.add(count + 1, other.weight);
            count += 2;
            current = after(current, &mut bits);
            other = after(other, &mut bits);
        }
        bits.refill();
    }
    // Either the bits or the weights that are left are too few to need a refill.
    while count < 254 {
        *weights.at_mut(count) = current.weight;
        by_weight.add(count, current.weight);
        (current, other) = (other, after(current, &mut bits));
        count += 1;
        if bits.left() < 0 {
            *weights.at_mut(count) = current.weight;
            by_weight.add(count, current.weight);
            return Ok(count + 1);
        }
    }
    Err(Error::CorruptionDetected)
}
