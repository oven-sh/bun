//! Writes a block in the form that is the shortest.

use crate::bit_writer::{BitWriter, SLACK};
use crate::encoder::{Block, Scratch};
use crate::format::STORED;
use crate::output::Sink;
use crate::{Error, Result};
use std::io::BorrowedCursor;

const MAX_STORED_LEN: usize = u16::MAX as usize;

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
            self.writer.add(
                (u32::from(is_final && rest.is_empty()) | (STORED << 1)).into(),
                3,
            );
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

    fn stored_cost(&self, data: &[u8]) -> usize {
        (self.writer.pending_bits() as usize + 3).wrapping_neg() % 8
            + 32
            + 40 * (data.len().div_ceil(MAX_STORED_LEN) - 1)
            + 8 * data.len()
    }

    /// `block` stands for `data`.
    pub(crate) fn write_tokens(
        &mut self,
        data: &[u8],
        block: &mut Block,
        scratch: &mut Scratch,
        is_final: bool,
    ) -> Result<()> {
        let plan = block.plan(false, scratch);
        if 3 + self.stored_cost(data) <= plan.bits as usize {
            self.write_stored(data, is_final)?;
        } else {
            let output = self
                .sink
                .bytes_up_to(self.writer.end_after(plan.bits) + SLACK)?;
            let write = |room: BorrowedCursor<'_, u8>, bits: &mut _| {
                block.write(plan, is_final, room, bits)
            };
            if !self.writer.lend(output, write) {
                return Err(Error::InsufficientSpace);
            }
        }
        block.start_next();
        Ok(())
    }
}
