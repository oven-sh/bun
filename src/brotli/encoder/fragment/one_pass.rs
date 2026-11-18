//! Writes commands as it finds them, with codes from the statistics of the previous meta-block (quality 0).

use core::ops::{ControlFlow, Range};

use super::{
    FIRST_COPY_AT_LAST_DISTANCE, FIRST_DISTANCE, Item, ItemCodes, ROOM, SYMBOLS, Sink, Table,
    build_and_write_codes, find_matches, insert_last, symbol_with_rank, table_bits, write_items,
    write_literals,
};
use crate::encoder::bit_stream::{MetaBlockKind, write_plain_header, write_uncompressed};
use crate::encoder::bit_writer::{BitWriter, Code};
use crate::encoder::histogram::{count_bytes, count_every_nth_byte};
use crate::encoder::huffman::{TreeBuilder, assign_codes};
use crate::encoder::log2::fast_log2;
use crate::format::{Alphabet, INSERT_LENGTH_CODES, LITERAL_SYMBOLS};
use crate::memory::Result;

const FIRST_BLOCK_SIZE: usize = 3 << 15;
const MERGED_BLOCK_SIZE: usize = 1 << 16;
/// Up to here, the length in the header has as many bits as that of the first block.
const MAX_MERGED_SIZE: usize = 1 << 20;
const MANY_LITERALS: usize = INSERT_LENGTH_CODES[22].base as usize;

// https://github.com/google/brotli/blob/db24a98aed38a16de78cc05ca15cdd8dc2a0d92d/c/enc/encode.c#L202
const FIRST_LENGTHS: [u8; SYMBOLS] = [
    0, 4, 4, 5, 5, 5, 6, 6, 7, 8, 8, 9, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 10, 0, 4, 4, 5,
    6, 6, 7, 7, 7, 7, 7, 8, 8, 8, 8, 8, 0, 0, 0, 4, 4, 4, 4, 4, 5, 5, 6, 6, 6, 6, 7, 7, 7, 7, 10,
    10, 10, 10, 10, 10, 5, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 6, 6, 6, 6, 6, 6, 5, 5, 5,
    5, 5, 5, 4, 4, 4, 4, 4, 4, 4, 5, 5, 5, 5, 5, 5, 6, 6, 7, 7, 7, 8, 10, 12, 12, 12, 12, 12, 12,
    12, 12, 12, 12, 12, 12, 0, 0, 0, 0,
];

static FIRST_CODES: [Code; SYMBOLS] = {
    let mut lengths = FIRST_LENGTHS;
    let mut rank = 0;
    while rank < FIRST_DISTANCE {
        lengths[rank] = FIRST_LENGTHS[symbol_with_rank(rank)];
        rank += 1;
    }
    let (commands, distances) = lengths.split_at(FIRST_DISTANCE);
    let (mut ranked, mut codes) = ([Code::EMPTY; FIRST_DISTANCE], ROOM);
    assign_codes(commands, &mut ranked);
    assign_codes(distances, codes.split_at_mut(FIRST_DISTANCE).1);
    while rank > 0 {
        rank -= 1;
        codes[symbol_with_rank(rank)].prepend(ranked[rank]);
    }
    codes
};

/// How the stream describes [`FIRST_LENGTHS`], 56 bits at a time.
const FIRST_LENGTHS_STORED: [u64; 8] = [
    0xEA_DEE7_BFD5_77FF,
    0x57_70C6_DE5D_519E,
    0x58_D8D8_5858_58BC,
    0x87_C3E0_EA8C_CBD5,
    0xB2_671C_60C1_831F,
    0x18_3060_C183_06AA,
    0x46_9454_88CE_A1CC,
    0x04_F7B2_4ED0_B0E1,
];

/// One for each symbol that may come up.
const INITIAL_HISTOGRAM: [u32; SYMBOLS] = {
    let mut histogram = [0; SYMBOLS];
    let mut i = 0;
    while i < SYMBOLS {
        histogram[i] = (FIRST_LENGTHS[i] != 0) as u32;
        i += 1;
    }
    histogram
};

#[derive(Default)]
pub(in crate::encoder) struct OnePass {
    table: Table,
    /// Of the previous block.
    histogram: Option<[u32; SYMBOLS]>,
}

struct MetaBlock {
    start: usize,
    codes: ItemCodes,
    histogram: [u32; Item::INDICES],
    /// The codes save less than 2%.
    literals_are_random: bool,
}

struct Emitter<'a> {
    block: &'a mut MetaBlock,
    writer: &'a mut BitWriter,
}

impl MetaBlock {
    /// From all of the bytes, whether they end up as literals or not.
    fn build_and_write_literal_codes(
        &mut self,
        input: &[u8],
        trees: &mut TreeBuilder,
        writer: &mut BitWriter,
    ) {
        let is_sample = input.len() >= 1 << 15;
        let mut histogram = if is_sample {
            count_every_nth_byte::<29>(input)
        } else {
            count_bytes(input)
        };
        for count in &mut histogram {
            *count += 2 * (*count).min(11) + u32::from(is_sample);
        }
        trees.build_and_write_fast(
            &histogram,
            Alphabet::LITERALS,
            self.codes.literals(),
            writer,
        );
        let total: u32 = histogram.iter().sum();
        let bits = histogram.iter().zip(&self.codes.0);
        let bits: u32 = bits.map(|(count, code)| count * code.length()).sum();
        self.literals_are_random = bits * 125 / total > 980;
    }

    #[inline(never)]
    fn emit_matches<const TABLE_SIZE: usize>(
        &mut self,
        table: &mut [u32; TABLE_SIZE],
        input: &[u8],
        Range { start, end }: Range<usize>,
        next_literal: usize,
        writer: &mut BitWriter,
    ) -> ControlFlow<usize, usize> {
        let mut emitter = Emitter {
            block: self,
            writer,
        };
        find_matches::<_, 5>(input, start, end, next_literal, table, &mut emitter)
    }
}

enum SizedTable<'a> {
    Bits9(&'a mut [u32; 1 << 9]),
    Bits11(&'a mut [u32; 1 << 11]),
    Bits13(&'a mut [u32; 1 << 13]),
    Bits15(&'a mut [u32; 1 << 15]),
}

impl SizedTable<'_> {
    fn emit_matches(
        &mut self,
        block: &mut MetaBlock,
        input: &[u8],
        range: Range<usize>,
        next_literal: usize,
        writer: &mut BitWriter,
    ) -> ControlFlow<usize, usize> {
        match self {
            Self::Bits9(table) => block.emit_matches(table, input, range, next_literal, writer),
            Self::Bits11(table) => block.emit_matches(table, input, range, next_literal, writer),
            Self::Bits13(table) => block.emit_matches(table, input, range, next_literal, writer),
            Self::Bits15(table) => block.emit_matches(table, input, range, next_literal, writer),
        }
    }
}

impl Sink for Emitter<'_> {
    #[inline(always)]
    fn refuses(&self, start: usize, end: usize) -> bool {
        end - start >= MANY_LITERALS
            && self.block.literals_are_random
            && (start - self.block.start) * 50 <= end - start
    }

    #[inline(always)]
    fn found(&mut self, item: Item) {
        self.block.histogram[item.index()] += 1;
    }

    #[inline(always)]
    fn items(&mut self, items: &[Item]) {
        write_items(items, &self.block.codes, self.writer);
    }

    #[inline(always)]
    fn literals(&mut self, input: &[u8], range: Range<usize>) {
        write_literals(&input[range], &self.block.codes, self.writer);
    }
}

impl OnePass {
    #[inline(never)]
    pub(super) fn compress(
        &mut self,
        input: &[u8],
        trees: &mut TreeBuilder,
        writer: &mut BitWriter,
    ) -> Result<()> {
        let mut table = match table_bits(input.len(), 15) | 1 {
            9 => SizedTable::Bits9(self.table.cleared()?),
            11 => SizedTable::Bits11(self.table.cleared()?),
            13 => SizedTable::Bits13(self.table.cleared()?),
            _ => SizedTable::Bits15(self.table.cleared()?),
        };
        let mut start = 0;
        while start < input.len() {
            let mut block = MetaBlock {
                start,
                codes: ItemCodes([Code::EMPTY; _]),
                histogram: [0; _],
                literals_are_random: false,
            };
            let header = writer.position();
            let mut end = input.len().min(start + FIRST_BLOCK_SIZE);
            write_plain_header(writer, MetaBlockKind::Compressed, end - start);
            block.build_and_write_literal_codes(&input[start..end], trees, writer);
            match self.histogram {
                None => {
                    block.codes.symbols().copy_from_slice(&FIRST_CODES);
                    for bits in FIRST_LENGTHS_STORED {
                        writer.write(56, bits);
                    }
                }
                Some(histogram) => {
                    let first = FIRST_COPY_AT_LAST_DISTANCE;
                    build_and_write_codes(histogram, first, block.codes.symbols(), trees, writer);
                }
            }

            let (mut from, mut next_literal) = (start, start);
            let refused_end = loop {
                block.histogram[LITERAL_SYMBOLS..][..SYMBOLS].copy_from_slice(&INITIAL_HISTOGRAM);
                match table.emit_matches(&mut block, input, from..end, next_literal, writer) {
                    ControlFlow::Continue(at) => next_literal = at,
                    ControlFlow::Break(at) => break Some(at),
                }
                let next_end = input.len().min(end + MERGED_BLOCK_SIZE);
                if next_end > end
                    && next_end - start <= MAX_MERGED_SIZE
                    && codes_suit(block.codes.literals(), &input[end..next_end])
                {
                    let length = (next_end - start - 1) as u32;
                    writer.overwrite(header + 3, 20, length);
                    (from, end) = (end, next_end);
                    continue;
                }
                if next_literal < end {
                    let mut emitter = Emitter {
                        block: &mut block,
                        writer,
                    };
                    if emitter.refuses(next_literal, end) {
                        break Some(end);
                    }
                    insert_last(input, next_literal..end, &mut emitter);
                }
                break None;
            };
            self.histogram = block.histogram[LITERAL_SYMBOLS..].first_chunk().copied();
            if let Some(refused_end) = refused_end {
                end = refused_end;
                writer.rewind(header);
                write_uncompressed(writer, [&input[start..end], &[]]);
            }
            start = end;
        }
        Ok(())
    }
}

fn codes_suit(codes: &[Code], input: &[u8]) -> bool {
    const SAMPLE_RATE: usize = 43;
    let histogram = count_every_nth_byte::<SAMPLE_RATE>(input);
    let total = input.len().div_ceil(SAMPLE_RATE);
    let mut margin = (fast_log2(total) + 0.5) * total as f64 + 200.0;
    for (&count, code) in histogram.iter().zip(codes) {
        margin -= f64::from(count) * (f64::from(code.length()) + fast_log2(count as usize));
    }
    margin >= 0.0
}
