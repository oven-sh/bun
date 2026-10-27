//! How often each symbol of an alphabet occurs.

use super::block_splitter::BlockSplit;
use super::command::Command;
use crate::common::constants::{
    DISTANCE_CONTEXT_BITS, LITERAL_CONTEXT_BITS, NUM_COMMAND_SYMBOLS, NUM_LITERAL_SYMBOLS,
};
use crate::common::context::ContextLut;
use crate::util::{Bug, Checked, SliceExt};

/// The distance symbols that a 32-bit distance can need, large window included.
pub(crate) const NUM_HISTOGRAM_DISTANCE_SYMBOLS: usize = 544;

#[derive(Clone)]
pub(crate) struct Histogram<const N: usize> {
    pub(crate) data: [u32; N],
    pub(crate) total_count: usize,
    pub(crate) bit_cost: f64,
}

pub(crate) type HistogramLiteral = Histogram<NUM_LITERAL_SYMBOLS>;
pub(crate) type HistogramCommand = Histogram<NUM_COMMAND_SYMBOLS>;
pub(crate) type HistogramDistance = Histogram<NUM_HISTOGRAM_DISTANCE_SYMBOLS>;

impl<const N: usize> Histogram<N> {
    pub(crate) const fn new() -> Self {
        Self {
            data: [0; N],
            total_count: 0,
            bit_cost: f64::INFINITY,
        }
    }

    pub(crate) fn clear(&mut self) {
        self.data.fill(0);
        self.total_count = 0;
        self.bit_cost = f64::INFINITY;
    }

    #[inline(always)]
    pub(crate) fn add(&mut self, val: usize) -> Checked {
        *self.data.at_mut(val)? += 1;
        self.total_count += 1;
        Ok(())
    }

    #[inline(always)]
    pub(crate) fn add_vector<T: Copy + Into<usize>>(&mut self, p: &[T]) -> Checked {
        self.total_count += p.len();
        for &val in p {
            *self.data.at_mut(val.into())? += 1;
        }
        Ok(())
    }

    #[inline(always)]
    pub(crate) fn add_histogram(&mut self, v: &Self) {
        self.total_count += v.total_count;
        for (a, b) in self.data.iter_mut().zip(&v.data) {
            *a += *b;
        }
    }

    /// `*self = *src`, without a copy on the stack.
    #[inline(always)]
    pub(crate) fn copy_from(&mut self, src: &Self) {
        self.data = src.data;
        self.total_count = src.total_count;
        self.bit_cost = src.bit_cost;
    }
}

/// Follows the symbols of one category through the blocks of `split`.
struct BlockSplitCursor<'a> {
    split: &'a BlockSplit,
    block: usize,
    block_type: usize,
    /// How many symbols of the block are left.
    length: usize,
}

impl<'a> BlockSplitCursor<'a> {
    fn new(split: &'a BlockSplit) -> Self {
        Self {
            split,
            block: 0,
            block_type: 0,
            length: split.lengths.first().map_or(0, |&length| length as usize),
        }
    }

    /// Goes on to the next symbol and returns the type of its block.
    #[inline(always)]
    fn advance(&mut self) -> Checked<usize> {
        if self.length == 0 {
            self.block += 1;
            self.block_type = usize::from(self.split.types.at(self.block)?);
            self.length = self.split.lengths.at(self.block)? as usize;
            if self.length == 0 {
                return Err(Bug);
            }
        }
        self.length -= 1;
        Ok(self.block_type)
    }
}

/// Counts the symbols of `cmds`, for each block type and context on its own. Without `literal_context_lut` the literals
/// are counted for each block type only.
pub(crate) fn build_histograms_with_context(
    cmds: &[Command],
    literal_split: &BlockSplit,
    command_split: &BlockSplit,
    distance_split: &BlockSplit,
    ring_buffer: &[u8],
    start_pos: usize,
    mask: usize,
    mut prev_byte: u8,
    mut prev_byte2: u8,
    literal_context_lut: Option<&ContextLut>,
    literal_histograms: &mut [HistogramLiteral],
    command_histograms: &mut [HistogramCommand],
    distance_histograms: &mut [HistogramDistance],
) -> Checked {
    let mut pos = start_pos;
    let mut literal_blocks = BlockSplitCursor::new(literal_split);
    let mut command_blocks = BlockSplitCursor::new(command_split);
    let mut distance_blocks = BlockSplitCursor::new(distance_split);
    for cmd in cmds {
        command_histograms
            .at_mut(command_blocks.advance()?)?
            .add(usize::from(cmd.cmd_prefix))?;
        for _ in 0..cmd.insert_len {
            let mut context = literal_blocks.advance()?;
            if let Some(lut) = literal_context_lut {
                context = (context << LITERAL_CONTEXT_BITS)
                    + usize::from(lut.context(prev_byte, prev_byte2));
            }
            let literal = ring_buffer.at(pos & mask)?;
            literal_histograms
                .at_mut(context)?
                .add(usize::from(literal))?;
            prev_byte2 = prev_byte;
            prev_byte = literal;
            pos += 1;
        }
        pos += cmd.copy_len() as usize;
        if cmd.copy_len() != 0 {
            prev_byte2 = ring_buffer.at(pos.wrapping_sub(2) & mask)?;
            prev_byte = ring_buffer.at(pos.wrapping_sub(1) & mask)?;
            if cmd.has_distance_symbol() {
                let context = (distance_blocks.advance()? << DISTANCE_CONTEXT_BITS)
                    + cmd.distance_context() as usize;
                distance_histograms
                    .at_mut(context)?
                    .add(cmd.dist_prefix.symbol())?;
            }
        }
    }
    Ok(())
}
