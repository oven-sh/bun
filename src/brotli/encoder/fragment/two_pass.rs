//! Collects the commands of a block, and then writes them with codes of their own (quality 1).

use core::ops::{ControlFlow, Range};

use super::{
    Item, ItemCodes, MAX_LITERAL_ITEMS, Sink, Table, build_and_write_codes, find_matches,
    insert_last, table_bits, write_items, write_literals,
};
use crate::encoder::bit_stream::{MetaBlockKind, write_plain_header, write_uncompressed};
use crate::encoder::bit_writer::{BitWriter, Code};
use crate::encoder::histogram::{bits_entropy, count_every_nth_byte};
use crate::encoder::huffman::TreeBuilder;
use crate::format::{Alphabet, LITERAL_SYMBOLS};
use crate::memory::{self, Result};

const BLOCK_SIZE: usize = 1 << 17;

#[derive(Default)]
pub(in crate::encoder) struct TwoPass {
    table: Table,
    items: Vec<Item>,
    runs: Vec<LongRun>,
    run_literals: Vec<u8>,
}

/// Literals that are not among the items.
struct LongRun {
    items_before: usize,
    start: usize,
    end: usize,
}

/// An increment has to wait for the previous one of the same counter.
struct Histograms([[u32; Item::INDICES]; 2]);

impl Histograms {
    #[inline(always)]
    fn add<T: Copy>(&mut self, all: &[T], index: impl Fn(T) -> usize) {
        let (pairs, rest) = all.as_chunks();
        for &[a, b] in pairs {
            self.0[0][index(a)] += 1;
            self.0[1][index(b)] += 1;
        }
        if let &[last] = rest {
            self.0[0][index(last)] += 1;
        }
    }

    fn counts_from<const N: usize>(&self, first: usize) -> [u32; N] {
        let [even, odd] = self.0.each_ref().map(|counts| &counts[first..first + N]);
        core::array::from_fn(|i| even[i] + odd[i])
    }
}

struct Block {
    items: Vec<Item>,
    runs: Vec<LongRun>,
    /// Those of all runs, so that what is written is what was counted.
    run_literals: Vec<u8>,
    histograms: Histograms,
    /// How much of the whole input is in the output. Blocks to store wait for one that is compressed.
    written: usize,
}

impl Sink for Block {
    #[inline(always)]
    fn refuses(&self, _start: usize, _end: usize) -> bool {
        false
    }

    #[inline(always)]
    fn found(&mut self, _item: Item) {}

    #[inline(never)]
    fn items(&mut self, items: &[Item]) {
        self.items.extend_from_slice(items);
        self.histograms.add(items, Item::index);
    }

    #[inline(never)]
    fn literals(&mut self, _input: &[u8], Range { start, end }: Range<usize>) {
        self.runs.push(LongRun {
            items_before: self.items.len(),
            start,
            end,
        });
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
        let mut block = Block {
            items: core::mem::take(&mut self.items),
            runs: core::mem::take(&mut self.runs),
            run_literals: core::mem::take(&mut self.run_literals),
            histograms: Histograms([[0; _]; 2]),
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
        (self.items, self.runs) = (block.items, block.runs);
        self.run_literals = block.run_literals;
    }
}

impl Block {
    fn begin(&mut self, size: usize) -> Result<()> {
        self.items.clear();
        self.runs.clear();
        self.run_literals.clear();
        self.histograms = Histograms([[0; _]; 2]);
        memory::try_reserve(&mut self.items, size)?;
        memory::try_reserve(&mut self.runs, size / MAX_LITERAL_ITEMS + 1)
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
        if next_literal < input.len() {
            insert_last(input, next_literal..input.len(), self);
        }
        let counts: [_; LITERAL_SYMBOLS] = self.histograms.counts_from(0);
        let in_items: u32 = counts.iter().sum();
        let in_runs: usize = self.runs.iter().map(|run| run.end - run.start).sum();
        if !is_worth_compressing(&input[start..], in_items as usize + in_runs) {
            return Ok(());
        }
        memory::try_reserve(&mut self.run_literals, in_runs)?;
        self.store_rest_of(&input[..start], writer);
        self.written = input.len();
        write_plain_header(writer, MetaBlockKind::Compressed, input.len() - start);
        for run in &self.runs {
            (self.run_literals).extend_from_slice(&input[run.start..run.end]);
        }
        self.histograms.add(&self.run_literals, usize::from);
        let literal_counts: [u32; LITERAL_SYMBOLS] = self.histograms.counts_from(0);
        let mut codes = ItemCodes([Code::EMPTY; _]);
        trees.build_and_write_fast(
            &literal_counts,
            Alphabet::LITERALS,
            codes.literals(),
            writer,
        );
        let mut histogram = self.histograms.counts_from(LITERAL_SYMBOLS);
        // Each code needs two symbols.
        for symbol in [1, 2, 64, 84] {
            histogram[symbol] += 1;
        }
        build_and_write_codes(histogram, 0, codes.symbols(), trees, writer);

        let (mut written, mut unwritten) = (0, self.run_literals.as_slice());
        for run in &self.runs {
            let (literals, rest) = unwritten.split_at(run.end - run.start);
            write_items(&self.items[written..run.items_before], &codes, writer);
            write_literals(literals, &codes, writer);
            (written, unwritten) = (run.items_before, rest);
        }
        write_items(&self.items[written..], &codes, writer);
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
