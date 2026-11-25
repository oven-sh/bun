//! Descriptions of Huffman trees.

use bun_highway::unzstd::HuffmanTable;
use bun_highway::with_avx2;

use crate::array::At;
use crate::bits::{bits_below_mark, load_from};
use crate::bounded::Bounded;
use crate::error::{Error, Result};
use crate::format::HUFFMAN_TABLE_LOG_MAX;
use crate::fse::{FILL, Spread, read_few_counts};

const TABLE_LOG_MAX: u32 = 6;
const STATES_MAX: usize = 1 << TABLE_LOG_MAX;
/// A second bucket for symbols that have no weight. Many follow each other, and would wait for each other.
const MORE_ZEROS: u8 = 128;

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
}

struct Buckets {
    weights: [u8; 256],
    /// By weight. Those without are only counted.
    symbols: [u8; 2048],
    /// Any byte is an index.
    ends: [u16; 256],
}

/// With room for as many as a valid description can have. Of more than that, only the number is right.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static BUCKET_STARTS: [u16; 16] = {
    let (mut starts, mut weight) = ([0; _], 0);
    while weight < HUFFMAN_TABLE_LOG_MAX as usize {
        let most = 2 << HUFFMAN_TABLE_LOG_MAX >> weight;
        starts[weight + 1] = starts[weight] + if most < 256 { most } else { 256 };
        weight += 1;
    }
    assert!(starts[weight] + 256 <= 2048);
    starts
};

/// Reads the description at the start of `src`.
pub fn read_huffman_weights(src: &[u8]) -> Result<HuffmanWeights> {
    let mut buckets = Buckets::EMPTY;
    let (rank_counts, table_log, len) = buckets.read(src)?;
    Ok(HuffmanWeights {
        weights: buckets.weights,
        rank_counts,
        symbol_count: rank_counts.iter().sum::<u32>() as usize,
        table_log,
        len,
    })
}

/// The same for decoding. Returns the length of the description.
pub(crate) fn read_table(table: &mut HuffmanTable, src: &[u8]) -> Result<usize> {
    with_avx2(
        #[inline(always)]
        || {
            let mut buckets = Buckets::EMPTY;
            let (counts, log, len) = buckets.read(src)?;
            let by_weight = (&buckets.symbols, &BUCKET_STARTS, &counts);
            let is_valid = table.fill(log, by_weight, &buckets.weights);
            is_valid.then_some(len).ok_or(Error::Internal)
        },
    )
}

impl Buckets {
    const EMPTY: Self = Self {
        weights: [0; _],
        symbols: [0; _],
        ends: [0; _],
    };

    #[inline(always)]
    fn add(&mut self, symbol: usize, weight: u8, bucket: u8) {
        *self.weights.at_mut(symbol) = weight;
        let end = self.ends.at_mut(bucket.into());
        *self.symbols.at_mut((*end).into()) = symbol as u8;
        *end = end.plus(1);
    }

    /// Returns how many symbols have each weight, the length of the longest code and that of the description.
    #[inline(always)]
    fn read(&mut self, src: &[u8]) -> Result<([u32; 16], u32, usize)> {
        self.ends[..16].copy_from_slice(&BUCKET_STARTS);
        let (&header, rest) = src.split_first().ok_or(Error::CorruptionDetected)?;
        let (listed, len) = match header.checked_sub(127) {
            Some(listed @ 1..) => {
                let len = usize::from(listed).div_ceil(2);
                let pairs = rest.get(..len).ok_or(Error::CorruptionDetected)?;
                let weights = pairs.iter().flat_map(|pair| [pair >> 4, pair & 15]);
                for (symbol, weight) in weights.enumerate().take(listed.into()) {
                    self.add(symbol, weight, weight);
                }
                (listed.into(), len)
            }
            _ => {
                let len = header.into();
                let compressed = rest.get(..len).ok_or(Error::CorruptionDetected)?;
                (self.decompress(compressed)?, len)
            }
        };

        self.ends[0] += *self.ends.at(MORE_ZEROS.into());
        let (mut counts, mut counted, mut twice_total) = ([0u32; 16], 0, 0);
        for (weight, count) in counts.iter_mut().enumerate() {
            *count = (self.ends.at(weight).minus(*BUCKET_STARTS.at(weight))).into();
            (counted, twice_total) = (counted.plus(*count), twice_total.plus(*count << weight));
        }
        let total = twice_total.minus(counts[0]) / 2;
        let table_log = total.bit_width();
        if total == 0 || table_log > HUFFMAN_TABLE_LOG_MAX || counted as usize != listed {
            return Err(Error::CorruptionDetected);
        }
        let missing = (1 << table_log) - total;
        if !missing.is_power_of_two() {
            return Err(Error::CorruptionDetected);
        }
        let last_weight = missing.bit_width() as usize;
        *counts.at_mut(last_weight) += 1;
        self.add(listed, last_weight as u8, last_weight as u8);
        // Their number is even, as the total is.
        if counts[1] == 0 {
            return Err(Error::CorruptionDetected);
        }
        Ok((counts, table_log, len + 1))
    }

    /// Returns how many weights there are: at most 255. Sorting takes no time while each one waits for the one before.
    #[inline(always)]
    fn decompress(&mut self, src: &[u8]) -> Result<usize> {
        const BATCH: usize = 6;
        const LOADED: usize = 57;
        const { assert!((BATCH + 2) * TABLE_LOG_MAX as usize <= LOADED) };

        // Limits of the reference decoder.
        let (mut ranks, mut spread) = ([0; 128], Spread::<{ STATES_MAX + FILL }>::EMPTY);
        let description = read_few_counts(src, TABLE_LOG_MAX, &mut ranks[..92])?;
        let log = description.table_log;
        if log == TABLE_LOG_MAX && description.max_symbol > 11 {
            return Err(Error::CorruptionDetected);
        }
        spread.fill(
            ranks
                .get(..=description.max_symbol)
                .ok_or(Error::Internal)?,
            log,
        );
        ranks.iter_mut().for_each(|it| *it = it.wrapping_abs());
        let (mut table, rows_by_rank) = ([Row::EMPTY; STATES_MAX], ROWS.at(log as usize % 2));
        for (index, row) in table.iter_mut().enumerate().take(1 << log) {
            let weight = *(spread.symbols).at(index.wrapping_mul(spread.stride) & ((1 << log) - 1));
            let rank = ranks.at_mut(weight.into());
            *row = *rows_by_rank.at(*rank as usize);
            row.weight = weight;
            row.other_bucket = if weight == 0 { MORE_ZEROS } else { weight };
            *rank = rank.wrapping_add(1);
        }

        let mut padded = [0; 8 + 128];
        (padded.get_mut(8..8 + src.len()).ok_or(Error::Internal)?).copy_from_slice(src);
        // At the top, with a mark that tells how many were shifted out.
        let bits_below = |position: usize| {
            let lowest = position + (64 - LOADED);
            load_from(&padded, lowest / 8 % 128) << (!lowest % 8) | 1
        };
        let after = |row: &Row, bits: &mut u64| {
            let taken = (*bits >> 1).wrapping_shr(row.inverted_width.into());
            *bits = bits.wrapping_shl(row.width.into());
            table.at(usize::from(row.baseline).plus(taken as usize))
        };
        let (start, mut position) = (8 * description.len, bits_below_mark(src, description.len)?);
        if position < start + 2 * log as usize {
            return Err(Error::CorruptionDetected);
        }
        let mut bits = bits_below(position);
        let mut current = after(rows_by_rank.at(1), &mut bits);
        let mut other = after(rows_by_rank.at(1), &mut bits);

        let mut count = 0;
        loop {
            position = position.minus(bits.trailing_zeros() as usize);
            let loaded = bits_below(position);
            if count + BATCH > 254 || position < start + BATCH * TABLE_LOG_MAX as usize {
                bits = loaded;
                break;
            }
            for pair in 0..BATCH / 2 {
                self.add(count, current.weight, current.weight);
                self.add(count + 1, other.weight, other.other_bucket);
                count += 2;
                let width = current.width.plus(other.width);
                current = after(current, &mut bits);
                other = after(other, &mut bits);
                // They did not have to wait for it.
                if pair == 0 {
                    bits = loaded.wrapping_shl(width.into());
                }
            }
        }
        // Either the bits or the weights that are left are too few to need another load.
        let mut left = position.minus(start) as isize;
        while count < 254 {
            self.add(count, current.weight, current.weight);
            left = left.minus(current.width.into());
            (current, other) = (other, after(current, &mut bits));
            count += 1;
            if left < 0 {
                self.add(count, current.weight, current.weight);
                return Ok(count + 1);
            }
        }
        Err(Error::CorruptionDetected)
    }
}

#[derive(Clone, Copy)]
#[repr(C, align(8))]
struct Row {
    weight: u8,
    other_bucket: u8,
    /// Of what is added to the baseline.
    width: u8,
    inverted_width: u8,
    baseline: u8,
}

impl Row {
    const EMPTY: Self = Self {
        weight: 0,
        other_bucket: 0,
        width: 0,
        inverted_width: 0,
        baseline: 0,
    };
}

/// For either size of table, by the count of the weight plus how many of its rows are in front.
#[expect(clippy::indexing_slicing, reason = "evaluated by the compiler")]
static ROWS: [[Row; 2 * STATES_MAX]; 2] = {
    let (mut rows, mut log) = ([[Row::EMPTY; _]; _], TABLE_LOG_MAX - 1);
    while log <= TABLE_LOG_MAX {
        let mut rank = 1u32;
        while rank < 2 << log {
            let (row, bits) = (
                &mut rows[log as usize % 2][rank as usize],
                log - rank.ilog2(),
            );
            row.width = bits as u8;
            (row.inverted_width, row.baseline) = (!bits as u8, ((rank << bits) - (1 << log)) as u8);
            rank += 1;
        }
        log += 1;
    }
    rows
};
