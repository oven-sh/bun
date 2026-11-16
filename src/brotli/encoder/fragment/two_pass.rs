//! Collects the commands of a block, and then writes them with codes of their own (quality 1).

use core::ops::ControlFlow;

use super::{
    FIRST_COPY_AT_LAST_DISTANCE, SYMBOLS, Sink, Table, Token, build_and_write_codes, find_matches,
    table_bits,
};
use crate::encoder::bit_stream::{MetaBlockKind, write_plain_header, write_uncompressed};
use crate::encoder::bit_writer::BitWriter;
use crate::encoder::histogram::{bits_entropy, count_bytes, count_every_nth_byte};
use crate::encoder::huffman::{Code, SYMBOL_SLACK, TreeBuilder, write_symbols};
use crate::format::{Alphabet, LITERAL_SYMBOLS, WINDOW_GAP};
use crate::memory::{self, Result};

const BLOCK_SIZE: usize = 1 << 17;

#[derive(Default)]
pub(in crate::encoder) struct TwoPass {
    table: Table,
    tokens: Vec<[u32; 2]>,
    literals: Vec<u8>,
}

struct Block {
    /// The symbol in the low 8 bits, and above it the value. Nothing goes with a token that inserts.
    tokens: Vec<[u32; 2]>,
    literals: Vec<u8>,
    histogram: [u32; SYMBOLS],
    /// How much of the whole input is in the output. Blocks to store wait for one that is compressed.
    written: usize,
}

impl Sink for Block {
    #[inline(always)]
    fn refuses(&mut self, _start: usize, _end: usize) -> bool {
        false
    }

    #[inline(always)]
    fn insert(&mut self, padded: &[u8]) {
        let length = padded.len() - WINDOW_GAP;
        self.tokens(Token::insert(length), Token::NONE);
        match padded.first_chunk::<WINDOW_GAP>() {
            Some(chunk) if length <= WINDOW_GAP => {
                let end = self.literals.len() + length;
                self.literals.extend_from_slice(chunk);
                self.literals.truncate(end);
            }
            _ => self.literals.extend_from_slice(&padded[..length]),
        }
    }

    #[inline(always)]
    fn tokens(&mut self, first: Token, second: Token) {
        let packed = [first, second].map(|token| (token.symbol | (token.value << 8)) as u32);
        self.tokens.push(packed);
        self.histogram[first.symbol % SYMBOLS] += 1;
        self.histogram[second.symbol % SYMBOLS] += 1;
    }
}

impl TwoPass {
    pub(super) fn compress(
        &mut self,
        input: &[u8],
        trees: &mut TreeBuilder,
        writer: &mut BitWriter,
    ) -> Result<()> {
        match table_bits(input.len(), 17) {
            8 => self.write_meta_blocks::<{ 1 << 8 }, 4>(input, trees, writer),
            9 => self.write_meta_blocks::<{ 1 << 9 }, 4>(input, trees, writer),
            10 => self.write_meta_blocks::<{ 1 << 10 }, 4>(input, trees, writer),
            11 => self.write_meta_blocks::<{ 1 << 11 }, 4>(input, trees, writer),
            12 => self.write_meta_blocks::<{ 1 << 12 }, 4>(input, trees, writer),
            13 => self.write_meta_blocks::<{ 1 << 13 }, 4>(input, trees, writer),
            14 => self.write_meta_blocks::<{ 1 << 14 }, 4>(input, trees, writer),
            15 => self.write_meta_blocks::<{ 1 << 15 }, 4>(input, trees, writer),
            16 => self.write_meta_blocks::<{ 1 << 16 }, 6>(input, trees, writer),
            _ => self.write_meta_blocks::<{ 1 << 17 }, 6>(input, trees, writer),
        }
    }

    #[inline(never)]
    fn write_meta_blocks<const TABLE_SIZE: usize, const MIN_MATCH: usize>(
        &mut self,
        input: &[u8],
        trees: &mut TreeBuilder,
        writer: &mut BitWriter,
    ) -> Result<()> {
        let table = self.table.cleared::<TABLE_SIZE>()?;
        // Pushing to a local is faster than pushing to a field.
        let mut block = Block {
            tokens: core::mem::take(&mut self.tokens),
            literals: core::mem::take(&mut self.literals),
            histogram: [0; SYMBOLS],
            written: 0,
        };
        for start in (0..input.len()).step_by(BLOCK_SIZE) {
            let end = input.len().min(start + BLOCK_SIZE);
            block.begin(end - start)?;
            let (ControlFlow::Continue(next_literal) | ControlFlow::Break(next_literal)) =
                find_matches::<_, MIN_MATCH>(input, start, end, start, table, &mut block);
            block.end(&input[..end], start, next_literal, trees, writer)?;
        }
        block.finish(input, writer);
        self.keep_memory_of(block);
        Ok(())
    }

    fn keep_memory_of(&mut self, block: Block) {
        (self.tokens, self.literals) = (block.tokens, block.literals);
    }
}

impl Block {
    fn begin(&mut self, size: usize) -> Result<()> {
        self.tokens.clear();
        self.literals.clear();
        self.histogram.fill(0);
        memory::try_reserve(&mut self.tokens, size / 2 + 1)?;
        memory::try_reserve(&mut self.literals, size + WINDOW_GAP)
    }

    fn insert_last(&mut self, literals: &[u8]) {
        if !literals.is_empty() {
            self.tokens(Token::insert(literals.len()), Token::NONE);
            self.literals.extend_from_slice(literals);
        }
    }

    fn store_rest_of(&self, input: &[u8], writer: &mut BitWriter) {
        for block in input[self.written..].chunks(BLOCK_SIZE) {
            write_uncompressed(writer, [block, &[]]);
        }
    }

    fn finish(&self, input: &[u8], writer: &mut BitWriter) {
        if self.written == 0 {
            // What several blocks are replaced by, since their headers make them too large.
            write_uncompressed(writer, [input, &[]]);
        } else {
            self.store_rest_of(input, writer);
        }
    }

    /// `input` ends with the block.
    #[inline(never)]
    fn end(
        &mut self,
        input: &[u8],
        start: usize,
        next_literal: usize,
        trees: &mut TreeBuilder,
        writer: &mut BitWriter,
    ) -> Result<()> {
        let last_literals = &input[next_literal..];
        if !is_worth_compressing(&input[start..], self.literals.len() + last_literals.len()) {
            return Ok(());
        }
        self.store_rest_of(&input[..start], writer);
        self.written = input.len();
        self.insert_last(last_literals);
        write_plain_header(writer, MetaBlockKind::Compressed, input.len() - start);
        let mut literal_codes = [Code::EMPTY; LITERAL_SYMBOLS];
        trees.build_and_write_fast(
            &count_bytes(&self.literals),
            Alphabet::LITERALS,
            &mut literal_codes,
            writer,
        );
        // Each code needs two symbols.
        for symbol in [1, 2, 64, 84] {
            self.histogram[symbol] += 1;
        }
        let codes = build_and_write_codes(self.histogram, 0, trees, writer);

        self.literals.extend([0; SYMBOL_SLACK]);
        let max_bytes = 7 * self.tokens.len() + 2 * self.literals.len();
        writer.try_reserve(max_bytes)?;
        let mut room = writer.with_room(max_bytes);
        let mut literals = &*self.literals;
        for packed in &self.tokens {
            let [first, second] = packed.map(|packed| Token {
                symbol: packed as usize % SYMBOLS,
                value: packed as usize >> 8,
            });
            if first.symbol < FIRST_COPY_AT_LAST_DISTANCE {
                let padded = &literals[..first.value + SYMBOL_SLACK];
                write_symbols(&mut room, codes.bits(first), padded, |literal| {
                    literal_codes[usize::from(literal)]
                });
                literals = &literals[first.value..];
            } else {
                room.write_bits(codes.bits(first).then(codes.bits(second)));
            }
        }
        Ok(())
    }
}

fn is_worth_compressing(input: &[u8], literal_count: usize) -> bool {
    const MIN_RATIO: f64 = 0.98;
    const SAMPLE_RATE: usize = 43;
    let size = input.len() as f64;
    if (literal_count as f64) < MIN_RATIO * size {
        return true;
    }
    let histogram = count_every_nth_byte::<SAMPLE_RATE>(input);
    bits_entropy(&histogram) < size * 8.0 * MIN_RATIO / SAMPLE_RATE as f64
}
