//! Huffman coding: tree descriptions, decoding tables and the streams of literals.

mod pairs;
mod ranks;
mod rows;
mod singles;
mod streams;
mod weights;

use bun_highway::with_bmi2;

use crate::array::{get_or_allocate, grow};
use crate::bits::bits_below_mark;
use crate::bounded::Bounded;
use crate::error::{Error, Result};
use pairs::PairTable;
use ranks::Ranks;
use rows::{FILL, fill_rows, repeat_each, repeat_few_times};
use singles::SingleTable;
use streams::{Lane, Stream, Windows};

pub(crate) use pairs::AMPLE_ROOM;
pub use weights::{HuffmanWeights, read_huffman_weights};

/// Longer codes are rare.
const QUICK_LOG: u32 = 11;
const QUICK_LEN: usize = 1 << QUICK_LOG;

#[derive(Default)]
pub(crate) struct HuffmanTable {
    log: u32,
    /// By the next `log` bits: the length of the code in the first half, and its symbol in the second. Unless `has_pairs`.
    singles: Vec<u8>,
    pairs: Option<Box<PairTable>>,
    has_pairs: bool,
}

impl HuffmanTable {
    fn half_len(&self) -> usize {
        QUICK_LEN.max(1 << self.log)
    }

    /// From the tree description at the start of `src`, whose length it returns, for about `literals` of them.
    pub(crate) fn read(&mut self, src: &[u8], literals: usize) -> Result<usize> {
        with_bmi2(
            #[inline(always)]
            || {
                let mut tree = HuffmanWeights::EMPTY;
                tree.read(src)?;
                self.fill(&tree, literals)?;
                Ok(tree.len)
            },
        )
    }

    #[inline(always)]
    fn fill(&mut self, tree: &HuffmanWeights, literals: usize) -> Result<()> {
        self.log = tree.table_log;
        let ranks = Ranks::new(tree);
        self.has_pairs = self.log <= QUICK_LOG && ranks.are_pairs_quicker(literals);
        if self.has_pairs {
            return get_or_allocate(&mut self.pairs, || PairTable::EMPTY)?.fill(tree, &ranks);
        }

        let half_len = self.half_len();
        grow(&mut self.singles, 0, 2 * half_len + FILL)?;
        let mut row = 0usize;
        for (length, symbols) in ranks.up_to(self.log) {
            let rows = symbols.len().wrapping_shl(self.log.minus(length));
            fill_rows::<_, FILL>(&mut self.singles, row, rows, length as u8)?;
            row = row.plus(rows);
        }
        row = half_len;
        for (length, symbols) in ranks.up_to(self.log) {
            let rows = 1usize.wrapping_shl(self.log.minus(length));
            let count = symbols.len();
            let (singles, padded) = (&mut self.singles, tree.padded_symbols_of(length));
            match rows {
                1 => repeat_few_times::<16>(singles, row, padded, count),
                2 => repeat_few_times::<8>(singles, row, padded, count),
                4 => repeat_few_times::<4>(singles, row, padded, count),
                8 => repeat_few_times::<2>(singles, row, padded, count),
                _ => repeat_each::<_, FILL>(singles, row, symbols, rows, |symbol| symbol),
            }?;
            row = row.plus(count.times(rows));
        }
        Ok(())
    }

    #[inline(always)]
    fn quick_singles(&self) -> Option<SingleTable<'_>> {
        let rows = self.singles.as_chunks().0.first_chunk()?;
        (self.log <= QUICK_LOG).then_some(SingleTable {
            rows,
            log: self.log,
        })
    }

    pub(crate) fn has_pairs(&self) -> bool {
        self.has_pairs
    }

    #[inline(always)]
    fn pairs(&self) -> Option<&PairTable> {
        self.pairs.as_deref().filter(|_| self.has_pairs)
    }

    /// Fills `out` from the stream in `src[start..]`.
    pub(crate) fn decode_stream(&self, src: &[u8], start: usize, out: &mut [u8]) -> Result<()> {
        self.finish(src, start, bits_below_mark(src, start)?, out)
    }

    /// Fills `out[..len]` from the jump table and the streams in `src[start..]`, quickest if `out` has [`AMPLE_ROOM`].
    pub(crate) fn decode_4_streams(
        &self,
        src: &[u8],
        start: usize,
        out: &mut [u8],
        len: usize,
        prefetch_lead: usize,
    ) -> Result<()> {
        let jumps = src.get(start..).and_then(<[u8]>::first_chunk::<6>);
        let &[a0, a1, b0, b1, c0, c1] = jumps.ok_or(Error::CorruptionDetected)?;
        let start_a = start + 6;
        let start_b = start_a + usize::from(u16::from_le_bytes([a0, a1]));
        let start_c = start_b + usize::from(u16::from_le_bytes([b0, b1]));
        let start_d = start_c + usize::from(u16::from_le_bytes([c0, c1]));
        let windows = Windows::new(src);
        let lane = |start, end| {
            let position =
                bits_below_mark(src.get(..end).ok_or(Error::CorruptionDetected)?, start)?;
            Lane::new(&windows, position).ok_or(Error::Internal)
        };
        let mut lanes = [
            lane(start_a, start_b)?,
            lane(start_b, start_c)?,
            lane(start_c, start_d)?,
            lane(start_d, src.len())?,
        ];
        let segment = len.div_ceil(4);
        let mut done = [0, segment, 2 * segment, 3 * segment];
        let ends = [segment, 2 * segment, 3 * segment, len];
        if let (Some(pairs), Some(out)) = (self.pairs(), out.first_chunk_mut()) {
            pairs.decode_4_in_place(&windows, &mut lanes, out, &mut done, &ends, prefetch_lead)?;
        }
        let ([a, b, c, d], [end_a, end_b, end_c, end_d]) = (done, ends);
        let outs = out.get_disjoint_mut([a..end_a, b..end_b, c..end_c, d..end_d]);
        let mut outs = outs.map_err(|_| Error::Internal)?;

        if let Some(pairs) = self.pairs() {
            pairs.decode_4(&windows, &mut lanes, &mut outs)?;
        } else if let Some(singles) = self.quick_singles() {
            singles.decode_4(&windows, &mut lanes, &mut outs, prefetch_lead)?;
        }
        let starts = [start_a, start_b, start_c, start_d];
        for ((&start, lane), out) in starts.iter().zip(&lanes).zip(&mut outs) {
            let position = lane.position().ok_or(Error::CorruptionDetected)?;
            self.finish(src, start, position, out)?;
        }
        Ok(())
    }

    /// Fills `out` from the bits below `position` of the stream whose first byte is at `start`.
    fn finish(&self, src: &[u8], start: usize, position: usize, mut out: &mut [u8]) -> Result<()> {
        with_bmi2(
            #[inline(always)]
            move || {
                let mut stream = Stream::new(src, position);
                if let Some(pairs) = self.pairs() {
                    out = pairs.decode(src, &mut stream, out);
                    stream.decode_carefully(src, out, |bits| Some(pairs.first(bits)))?;
                } else {
                    if let Some(singles) = self.quick_singles() {
                        out = singles.decode(src, &mut stream, out);
                    }
                    let halves = self.singles.split_at_checked(self.half_len());
                    let (lengths, symbols) = halves.ok_or(Error::Internal)?;
                    stream.decode_carefully(src, out, |bits| {
                        let row = bits.wrapping_shr(64 - self.log) as usize;
                        Some((*symbols.get(row)?, *lengths.get(row)?))
                    })?;
                }
                if stream.position != 8 * start {
                    return Err(Error::CorruptionDetected);
                }
                Ok(())
            },
        )
    }
}

#[test]
fn pairs_are_for_many_literals_with_short_codes() -> Result<()> {
    let has_pairs = |weights: &[u8], literals| {
        let mut table = HuffmanTable::default();
        table.read(weights, literals).map(|_| table.has_pairs)
    };
    // Codes of 1 to 4 bits, and 128 of 7 bits.
    let (short, long) = ([0x83, 0x43, 0x21], [&[0xFE][..], &[0x11; 64]].concat());
    assert!(has_pairs(&short, 4000)? && !has_pairs(&short, 1200)?);
    assert!(!has_pairs(&long, 100_000)?);
    Ok(())
}
