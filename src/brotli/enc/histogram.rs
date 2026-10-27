//! How often each symbol of an alphabet occurs.

use super::block_splitter::BlockSplit;
use super::command::Command;
use crate::common::constants::{
    DISTANCE_CONTEXT_BITS, LITERAL_CONTEXT_BITS, NUM_COMMAND_SYMBOLS, NUM_LITERAL_SYMBOLS,
};
use crate::common::context::{ContextType, context_lut};
use crate::util::{Checked, SliceExt};

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

    #[inline(always)]
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
            *a = a.wrapping_add(*b);
        }
    }
}

struct BlockSplitIterator<'a> {
    split: &'a BlockSplit,
    idx: usize,
    type_: usize,
    length: usize,
}

impl<'a> BlockSplitIterator<'a> {
    fn new(split: &'a BlockSplit) -> Self {
        Self {
            split,
            idx: 0,
            type_: 0,
            length: split.lengths.first().map_or(0, |&length| length as usize),
        }
    }

    #[inline(always)]
    fn next(&mut self) -> Checked {
        if self.length == 0 {
            self.idx += 1;
            self.type_ = usize::from(self.split.types.at(self.idx)?);
            self.length = self.split.lengths.at(self.idx)? as usize;
        }
        self.length = self.length.wrapping_sub(1);
        Ok(())
    }
}

/// Counts the symbols of `cmds`, for each block type and context on its own. Without `context_modes` the literals are
/// counted for each block type only.
pub(crate) fn build_histograms_with_context(
    cmds: &[Command],
    literal_split: &BlockSplit,
    insert_and_copy_split: &BlockSplit,
    dist_split: &BlockSplit,
    ringbuffer: &[u8],
    start_pos: usize,
    mask: usize,
    mut prev_byte: u8,
    mut prev_byte2: u8,
    context_modes: Option<&[ContextType]>,
    literal_histograms: &mut [HistogramLiteral],
    insert_and_copy_histograms: &mut [HistogramCommand],
    copy_dist_histograms: &mut [HistogramDistance],
) -> Checked {
    let mut pos = start_pos;
    let mut literal_it = BlockSplitIterator::new(literal_split);
    let mut insert_and_copy_it = BlockSplitIterator::new(insert_and_copy_split);
    let mut dist_it = BlockSplitIterator::new(dist_split);
    for cmd in cmds {
        insert_and_copy_it.next()?;
        insert_and_copy_histograms
            .at_mut(insert_and_copy_it.type_)?
            .add(usize::from(cmd.cmd_prefix))?;
        for _ in 0..cmd.insert_len {
            literal_it.next()?;
            let mut context = literal_it.type_;
            if let Some(context_modes) = context_modes {
                let lut = context_lut(context_modes.at(context)?);
                context = (context << LITERAL_CONTEXT_BITS)
                    + usize::from(lut.context(prev_byte, prev_byte2));
            }
            let literal = ringbuffer.at(pos & mask)?;
            literal_histograms
                .at_mut(context)?
                .add(usize::from(literal))?;
            prev_byte2 = prev_byte;
            prev_byte = literal;
            pos += 1;
        }
        pos += cmd.copy_len() as usize;
        if cmd.copy_len() != 0 {
            prev_byte2 = ringbuffer.at(pos.wrapping_sub(2) & mask)?;
            prev_byte = ringbuffer.at(pos.wrapping_sub(1) & mask)?;
            if cmd.cmd_prefix >= 128 {
                dist_it.next()?;
                let context =
                    (dist_it.type_ << DISTANCE_CONTEXT_BITS) + cmd.distance_context() as usize;
                copy_dist_histograms
                    .at_mut(context)?
                    .add(usize::from(cmd.dist_prefix & 0x3FF))?;
            }
        }
    }
    Ok(())
}
