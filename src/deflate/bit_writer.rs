//! Writes a stream from the lowest bit of its first byte.

use crate::chunk_at_mut;
use crate::format::Codeword;

/// How far past the bytes that it completes a flush writes.
pub(crate) const SLACK: usize = 8;
pub(crate) const BITS_BETWEEN_FLUSHES: u32 = 56;

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

    #[inline(always)]
    pub(crate) fn add_codeword(&mut self, Codeword { bits, len }: Codeword) {
        self.add(bits.into(), len);
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
