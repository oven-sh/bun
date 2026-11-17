//! Writes a block in the form that is the shortest.

use crate::bit_writer::{BITS_BETWEEN_FLUSHES, BitWriter, SLACK};
use crate::format::{
    Codeword, DYNAMIC, END_OF_BLOCK, FIRST_LENGTH_SYMBOL, LITLEN_SYMBOLS, MAX_CODEWORD_LEN,
    MAX_PRECODE_LEN, MIN_MATCH_LEN, OFFSET_SYMBOLS, PRECODE_ORDER, PRECODE_SYMBOLS, STATIC, STORED,
    length_slot, length_slot_of, offset_slot, offset_slot_of, repeat_slot, static_litlen_codeword,
    static_offset_codeword,
};
use crate::huffman::{codeword_lens, codewords};
use crate::output::Sink;
use crate::{Error, Result, copy_prefix, wrapped, wrapped_mut};
use bun_highway::with_bmi2;
use core::array::from_fn;
use core::hint::{cold_path, select_unpredictable};

/// One less than the format allows, so that four literals fit between flushes.
const MAX_LITLEN_LEN: usize = 14;
const MAX_STORED_LEN: usize = u16::MAX as usize;

static EXTRA_LENGTH_VALUES: [u8; 256] = table!(|index| {
    let len = index + MIN_MATCH_LEN;
    (len as u32 - length_slot(length_slot_of(len)).base) as u8
});
static OFFSET_BASES: [u16; OFFSET_SYMBOLS] = table!(|symbol| offset_slot(symbol).base as u16);
static EXTRA_PRECODE_BITS: [u8; 32] = table!(|symbol| repeat_slot(symbol).extra_bits as u8);

#[derive(Clone, Copy)]
pub(crate) struct PerSymbol<T> {
    pub(crate) litlen: [T; LITLEN_SYMBOLS],
    pub(crate) offset: [T; OFFSET_SYMBOLS],
}

pub(crate) type Frequencies = PerSymbol<u32>;
pub(crate) type Lens = PerSymbol<u8>;
type Codewords = PerSymbol<Codeword>;

static STATIC_CODEWORDS: Codewords = Codewords {
    litlen: table!(|symbol| static_litlen_codeword(symbol)),
    offset: table!(|symbol| static_offset_codeword(symbol)),
};

pub(crate) static STATIC_LENS: Lens = Lens {
    litlen: table!(|symbol| static_litlen_codeword(symbol).len as u8),
    offset: table!(|symbol| static_offset_codeword(symbol).len as u8),
};

static EXTRA_BITS: Lens = Lens {
    litlen: table!(|symbol| match symbol {
        ..FIRST_LENGTH_SYMBOL => 0,
        _ => length_slot(symbol - FIRST_LENGTH_SYMBOL).extra_bits as u8,
    }),
    offset: table!(|symbol| offset_slot(symbol).extra_bits as u8),
};

/// Less than [`LITLEN_SYMBOLS`], which the compiler knows.
#[inline(always)]
fn length_symbol(len: usize) -> usize {
    END_OF_BLOCK + (1 + length_slot_of(len)) % (LITLEN_SYMBOLS - END_OF_BLOCK)
}

#[expect(clippy::indexing_slicing, reason = "there are more symbols")]
impl<T: Copy> PerSymbol<T> {
    #[inline(always)]
    pub(crate) fn of_literal(&self, literal: u8) -> T {
        self.litlen[usize::from(literal)]
    }

    #[inline(always)]
    pub(crate) fn of_length(&self, len: usize) -> T {
        self.litlen[length_symbol(len)]
    }
}

#[expect(clippy::indexing_slicing, reason = "there are more symbols")]
impl Frequencies {
    #[inline(always)]
    pub(crate) fn add_literal(&mut self, literal: u8) {
        self.litlen[usize::from(literal)] += 1;
    }

    #[inline(always)]
    fn add_length(&mut self, len: usize) {
        self.litlen[length_symbol(len)] += 1;
    }
}

impl Frequencies {
    /// Counts the end of the block.
    pub(crate) const EMPTY: Self = {
        let mut litlen = [0; _];
        litlen[END_OF_BLOCK] = 1;
        Self {
            litlen,
            offset: [0; _],
        }
    };

    pub(crate) fn literals(&self) -> &[u32] {
        self.litlen.split_at(END_OF_BLOCK).0
    }

    pub(crate) fn lens(&self) -> Lens {
        Lens {
            litlen: codeword_lens(&self.litlen, MAX_LITLEN_LEN),
            offset: codeword_lens(&self.offset, MAX_CODEWORD_LEN as usize),
        }
    }

    /// In bits, of all that follows the header.
    fn cost(&self, lens: &Lens) -> u32 {
        cost_in_bits(&self.litlen, &lens.litlen, &EXTRA_BITS.litlen)
            + cost_in_bits(&self.offset, &lens.offset, &EXTRA_BITS.offset)
    }

    /// In bits, without the three that all kinds of blocks start with.
    pub(crate) fn dynamic_cost(&self, lens: &Lens) -> u32 {
        Header::new(lens).cost + self.cost(lens)
    }
}

fn cost_in_bits(frequencies: &[u32], lens: &[u8], extra_bits: &[u8]) -> u32 {
    let symbols = frequencies.iter().zip(lens).zip(extra_bits);
    symbols
        .map(|((&frequency, &len), &extra)| frequency * u32::from(len + extra))
        .sum()
}

/// Literals, then a match.
#[derive(Clone, Copy, Default)]
pub(crate) struct Sequence {
    literals: u32,
    offset: u16,
    offset_slot: u8,
    /// Less [`MIN_MATCH_LEN`].
    len: u8,
}

impl Sequence {
    /// Counts the match in `frequencies`, but not the literals.
    #[inline(always)]
    pub(crate) fn new(
        literals: usize,
        len: usize,
        offset: usize,
        frequencies: &mut Frequencies,
    ) -> Self {
        let offset_slot = offset_slot_of(offset);
        frequencies.add_length(len);
        *wrapped_mut(&mut frequencies.offset, offset_slot) += 1;
        Self {
            literals: literals as u32,
            offset: offset as u16,
            offset_slot: offset_slot as u8,
            len: (len - MIN_MATCH_LEN) as u8,
        }
    }
}

/// How a dynamic block describes its codes.
struct Header {
    litlen_symbols: usize,
    offset_symbols: usize,
    precode_symbols: usize,
    precode_lens: [u8; 32],
    /// Symbols of the precode, with their extra bits from bit 5.
    items: [u16; 512],
    item_count: usize,
    /// In bits.
    cost: u32,
}

impl Header {
    fn new(lens: &Lens) -> Self {
        let used = |lens: &[u8]| {
            lens.iter()
                .rposition(|&len| len != 0)
                .map_or(0, |at| at + 1)
        };
        let litlen_symbols = used(&lens.litlen).max(FIRST_LENGTH_SYMBOL);
        let offset_symbols = used(&lens.offset).max(1);
        let mut all = [0; LITLEN_SYMBOLS + OFFSET_SYMBOLS];
        copy_prefix(&mut all, &lens.litlen);
        let after_litlen = all.get_mut(litlen_symbols..).unwrap_or_default();
        copy_prefix(after_litlen, &lens.offset);

        let (mut items, mut item_count) = ([0; _], 0);
        let mut frequencies = [0; 32];
        let mut emit = |symbol: u8, extra: usize| {
            *wrapped_mut(&mut frequencies, symbol.into()) += 1;
            *wrapped_mut(&mut items, item_count) = u16::from(symbol) | ((extra as u16) << 5);
            item_count += 1;
        };
        let all = all
            .get(..litlen_symbols + offset_symbols)
            .unwrap_or_default();
        for run in all.chunk_by(|a, b| a == b) {
            let (len, mut left) = (run.first().copied().unwrap_or_default(), run.len());
            let mut repeat = |symbol: u8, left: &mut usize| {
                let slot = repeat_slot(symbol.into());
                let (least, most_extra) = (slot.base as usize, (1 << slot.extra_bits) - 1);
                while *left >= least {
                    let extra = (*left - least).min(most_extra);
                    emit(symbol, extra);
                    *left -= least + extra;
                }
            };
            if len == 0 {
                repeat(18, &mut left);
                repeat(17, &mut left);
            } else if left >= 4 {
                left -= 1;
                repeat(len, &mut 1);
                repeat(16, &mut left);
            }
            repeat(len, &mut left);
        }

        let precode_lens = codeword_lens(&frequencies, MAX_PRECODE_LEN as usize);
        let precode_symbols = used(&in_header_order(&precode_lens)).max(4);
        Self {
            litlen_symbols,
            offset_symbols,
            precode_symbols,
            precode_lens,
            items,
            item_count,
            cost: (5 + 5 + 4 + 3 * precode_symbols as u32)
                + cost_in_bits(&frequencies, &precode_lens, &EXTRA_PRECODE_BITS),
        }
    }

    fn write(&self, writer: &mut BitWriter, output: &mut [u8]) {
        writer.add((self.litlen_symbols - FIRST_LENGTH_SYMBOL) as u64, 5);
        writer.add(self.offset_symbols as u64 - 1, 5);
        writer.add(self.precode_symbols as u64 - 4, 4);
        let lens = in_header_order(&self.precode_lens);
        for lens in lens
            .get(..self.precode_symbols)
            .unwrap_or_default()
            .chunks(10)
        {
            lens.iter().for_each(|&len| writer.add(len.into(), 3));
            writer.flush(output);
        }

        let precode = codewords(&self.precode_lens);
        for &item in self.items.iter().take(self.item_count) {
            writer.add_codeword(*wrapped(&precode, item.into()));
            let extra_bits = *wrapped(&EXTRA_PRECODE_BITS, item.into());
            writer.add((item >> 5).into(), extra_bits.into());
            writer.flush(output);
        }
    }
}

fn in_header_order(lens: &[u8; 32]) -> [u8; PRECODE_SYMBOLS] {
    PRECODE_ORDER.map(|symbol| *wrapped(lens, symbol.into()))
}

fn block_start(is_final: bool, kind: u32) -> u64 {
    u64::from(is_final) | (u64::from(kind) << 1)
}

/// The stream that blocks are added to.
pub(crate) struct Stream<'s, 'o> {
    sink: &'s mut Sink<'o>,
    writer: BitWriter,
}

impl<'s, 'o> Stream<'s, 'o> {
    pub(crate) fn new(sink: &'s mut Sink<'o>, position: usize) -> Self {
        Self {
            sink,
            writer: BitWriter::at(position),
        }
    }

    pub(crate) fn end(&self) -> usize {
        self.writer.end_after(0)
    }

    pub(crate) fn write_stored(&mut self, mut data: &[u8], is_final: bool) -> Result<()> {
        loop {
            let (block, rest) = data.split_at(data.len().min(MAX_STORED_LEN));
            let len = block.len() as u32;
            let output = self
                .sink
                .bytes_up_to(self.writer.end_after(3 + 32) + SLACK)?;
            self.writer
                .add(block_start(is_final && rest.is_empty(), STORED), 3);
            self.writer
                .add(0, self.writer.pending_bits().wrapping_neg() % 8);
            self.writer.add((len | (!len << 16)).into(), 32);
            self.writer.flush(output);
            let start = self.end();
            self.sink.write(start, block)?;
            self.writer = BitWriter::at(start + block.len());
            data = rest;
            if data.is_empty() {
                return Ok(());
            }
        }
    }

    /// What `sequences` leave of `data` is literals. `frequencies` counts it all, and `lens` is made from it.
    pub(crate) fn write_block(
        &mut self,
        data: &[u8],
        sequences: &[Sequence],
        frequencies: &Frequencies,
        lens: &Lens,
        is_final: bool,
    ) -> Result<()> {
        let header = Header::new(lens);
        let dynamic_cost = header.cost + frequencies.cost(lens);
        let static_cost = frequencies.cost(&STATIC_LENS);
        let stored_cost = (self.writer.pending_bits() + 3).wrapping_neg() % 8
            + 32
            + 40 * (data.len().div_ceil(MAX_STORED_LEN) as u32 - 1)
            + 8 * data.len() as u32;
        let cost = dynamic_cost.min(static_cost);
        if stored_cost <= cost {
            return self.write_stored(data, is_final);
        }

        let mut writer = self.writer;
        let output = self.sink.bytes_up_to(writer.end_after(3 + cost) + SLACK)?;
        let dynamic_codewords;
        let codewords = if static_cost == cost {
            writer.add(block_start(is_final, STATIC), 3);
            &STATIC_CODEWORDS
        } else {
            writer.add(block_start(is_final, DYNAMIC), 3);
            header.write(&mut writer, output);
            dynamic_codewords = Codewords {
                litlen: codewords(&lens.litlen),
                offset: codewords(&lens.offset),
            };
            &dynamic_codewords
        };
        writer.flush(output);
        let writer = write_body(writer, output, data, sequences, codewords);
        if writer.end_after(0) + SLACK > output.len() {
            return Err(Error::InsufficientSpace);
        }
        self.writer = writer;
        Ok(())
    }
}

/// Turns an offset into its codeword and extra bits: `(offset << codeword_len) + addend`.
#[derive(Clone, Copy)]
struct OffsetCode {
    addend: u32,
    codeword_len: u16,
    len: u16,
}

with_bmi2! {
    fn write_body(
        writer: BitWriter,
        output: &mut [u8],
        data: &[u8],
        sequences: &[Sequence],
        codewords: &Codewords,
    ) -> BitWriter {
        write_symbols(writer, output, data, sequences, codewords)
    }
}

#[inline(always)]
fn write_symbols(
    mut writer: BitWriter,
    output: &mut [u8],
    mut data: &[u8],
    sequences: &[Sequence],
    codewords: &Codewords,
) -> BitWriter {
    /// Returns the last `literals.len() % 4`, which it does not write.
    #[inline(always)]
    fn write_fours<'a>(
        writer: &mut BitWriter,
        output: &mut [u8],
        literals: &'a [u8],
        codewords: &Codewords,
    ) -> &'a [u8] {
        let (fours, rest) = literals.as_chunks::<4>();
        for four in fours {
            for &literal in four {
                writer.add_codeword(codewords.of_literal(literal));
            }
            writer.flush(output);
        }
        rest
    }

    let lengths: [Codeword; 256] = from_fn(|index| {
        let len = index + MIN_MATCH_LEN;
        let extra_bits = EXTRA_BITS.of_length(len);
        let extra = u32::from(*wrapped(&EXTRA_LENGTH_VALUES, index));
        let Codeword { bits, len } = codewords.of_length(len);
        Codeword {
            bits: bits | extra.wrapping_shl(len),
            len: len + u32::from(extra_bits),
        }
    });
    let offsets: [OffsetCode; OFFSET_SYMBOLS] = from_fn(|slot| {
        let Codeword { bits, len } = *wrapped(&codewords.offset, slot);
        let base = u32::from(*wrapped(&OFFSET_BASES, slot));
        OffsetCode {
            addend: bits.wrapping_sub(base.wrapping_shl(len)),
            codeword_len: len as u16,
            len: len as u16 + u16::from(*wrapped(&EXTRA_BITS.offset, slot)),
        }
    });

    // Never true, but it spares an overflow check in each flush.
    if output.len() < SLACK {
        return writer;
    }
    for sequence in sequences {
        let mut literals = sequence.literals as usize;
        if literals > 2 {
            let (run, _) = data.split_at(literals.min(data.len()));
            let mut left = write_fours(&mut writer, output, run, codewords);
            if let [first, others @ ..] = left
                && others.len() == 2
            {
                writer.add_codeword(codewords.of_literal(*first));
                writer.flush(output);
                left = others;
            }
            data = data.get(run.len() - left.len()..).unwrap_or_default();
            literals = left.len();
        }
        let len = literals + usize::from(sequence.len) + MIN_MATCH_LEN;
        let Some((&[a, b, ..], rest)) = data.split_at_checked(len) else {
            break;
        };
        data = rest;
        // Without branches: whether there are 0, 1 or 2 literals is too hard to predict.
        let or_none = |is_there, literal| {
            select_unpredictable(is_there, codewords.of_literal(literal), Codeword::default())
        };
        let (a, b) = (or_none(literals > 0, a), or_none(literals > 1, b));
        let literal_bits = u64::from(a.bits | b.bits.wrapping_shl(a.len));
        let literals_len = a.len + b.len;

        let length = wrapped(&lengths, sequence.len.into());
        let offset = wrapped(&offsets, sequence.offset_slot.into());
        let offset_bits = u32::from(sequence.offset).wrapping_shl(offset.codeword_len.into());
        let offset_bits = u64::from(offset_bits.wrapping_add(offset.addend));
        let match_bits = u64::from(length.bits) | offset_bits.wrapping_shl(length.len);
        let match_len = length.len + u32::from(offset.len);

        if literals_len + match_len > BITS_BETWEEN_FLUSHES {
            cold_path();
            writer.add(literal_bits, literals_len);
            writer.flush(output);
            writer.add(match_bits, match_len);
        } else {
            let bits = literal_bits | match_bits.wrapping_shl(literals_len);
            writer.add(bits, literals_len + match_len);
        }
        writer.flush(output);
    }
    for &literal in write_fours(&mut writer, output, data, codewords) {
        writer.add_codeword(codewords.of_literal(literal));
    }
    writer.add_codeword(codewords.litlen[END_OF_BLOCK]);
    writer.flush(output);
    writer
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Output;

    fn write(data: &[u8], sequences: &[Sequence], frequencies: &Frequencies) -> Result<()> {
        let mut room = [0; 100];
        let mut sink = Sink::new(Output::Slice(&mut room), 0);
        let lens = frequencies.lens();
        Stream::new(&mut sink, 0).write_block(data, sequences, frequencies, &lens, true)
    }

    #[test]
    fn more_than_was_counted() {
        let result = write(&[0; 20], &[], &Frequencies::EMPTY);
        assert_eq!(result, Err(Error::InsufficientSpace));
    }

    #[test]
    fn less_than_was_counted() {
        let mut frequencies = Frequencies::EMPTY;
        let sequence = Sequence::new(0, 9, 1, &mut frequencies);
        assert_eq!(write(&[0], &[sequence], &frequencies), Ok(()));
    }
}
