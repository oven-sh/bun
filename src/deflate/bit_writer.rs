//! Writes a stream from the lowest bit of its first byte.

use std::io::{BorrowedBuf, BorrowedCursor};

use crate::chunk_at_mut;
use crate::encoder::Bits;

/// How far past the bytes that it completes a flush writes.
pub(crate) const SLACK: usize = 8;

#[derive(Clone, Copy, Default)]
pub(crate) struct BitWriter {
    buffer: u64,
    /// At most 7 after a flush.
    count: u32,
    /// Where the lowest bits of `buffer` go.
    position: usize,
}

impl BitWriter {
    pub(crate) fn at(position: usize) -> Self {
        Self {
            position,
            ..Self::default()
        }
    }

    pub(crate) fn pending_bits(self) -> u32 {
        self.count
    }

    /// Where the bytes end once `bits` more are written.
    pub(crate) fn end_after(self, bits: u32) -> usize {
        self.position + (self.count + bits).div_ceil(8) as usize
    }

    #[inline(always)]
    pub(crate) fn add(&mut self, bits: u64, count: u32) {
        self.buffer |= bits.wrapping_shl(self.count);
        self.count += count;
    }

    /// After a flush, and does one.
    pub(crate) fn lend(
        &mut self,
        output: &mut [u8],
        write: impl FnOnce(BorrowedCursor<'_, u8>, &mut Bits) -> bool,
    ) -> bool {
        let mut room = BorrowedBuf::from(output.get_mut(self.position..).unwrap_or_default());
        let mut bits = Bits {
            value: self.buffer,
            count: self.count as usize,
        };
        let has_fitted = write(room.unfilled(), &mut bits);
        self.position += room.len();
        (self.buffer, self.count) = (bits.value, bits.count as u32);
        self.flush(output);
        has_fitted
    }

    /// Also writes the byte that is not complete yet. What there is no room for gets lost.
    #[inline(always)]
    pub(crate) fn flush(&mut self, output: &mut [u8]) {
        if let Some(to) = chunk_at_mut(output, self.position) {
            *to = self.buffer.to_le_bytes();
        }
        self.buffer = self.buffer.wrapping_shr(self.count & !7);
        self.position += self.count as usize / 8;
        self.count %= 8;
    }
}
