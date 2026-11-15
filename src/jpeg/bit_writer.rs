//! Writes entropy-coded data.

use crate::{Result, wrapped_mut};
use bun_core::strings::index_of_char_usize;

const BUFFER_LEN: usize = 4096;
/// How many bytes may be stored between two calls of [`PendingBits::make_room`].
pub(crate) const ROOM: usize = 512;
/// A store writes the 8 bytes that end with the last bit, so the first ones start before the data.
const MARGIN: usize = 8;

/// How many bytes are stuffed one by one from an 0xFF on. A search for each takes too long where they are dense.
const DENSE_LEN: usize = 8;

/// Data that has not been stuffed yet.
pub(crate) struct BitBuffer<'a> {
    out: &'a mut Vec<u8>,
    bytes: [u8; MARGIN + BUFFER_LEN],
}

/// The write state, separate from [`BitBuffer`] so that loops keep it in registers.
#[derive(Clone, Copy)]
pub(crate) struct PendingBits {
    /// The last 64 bits, the newest lowest.
    bits: u64,
    /// The number of bits in the buffer plus 7, so that `end / 8` counts a partial byte.
    end: usize,
}

impl<'a> BitBuffer<'a> {
    pub(crate) fn new(out: &'a mut Vec<u8>) -> Self {
        Self {
            out,
            bytes: [0; MARGIN + BUFFER_LEN],
        }
    }

    #[cold]
    #[inline(never)]
    fn flush(&mut self, len: usize) -> Result<()> {
        let mut rest = self.bytes.get(MARGIN..MARGIN + len).unwrap_or_default();
        self.out.try_reserve(2 * (len + DENSE_LEN))?;
        while let Some(at) = index_of_char_usize(rest, 0xFF) {
            let (plain, after) = rest.split_at(at);
            let (dense, after) = after.split_at(after.len().min(DENSE_LEN));
            let (mut stuffed, mut stuffed_len) = ([0; 2 * DENSE_LEN], 0);
            for &byte in dense {
                *wrapped_mut(&mut stuffed, stuffed_len) = byte;
                stuffed_len += 1 + usize::from(byte == 0xFF);
            }
            self.out.extend_from_slice(plain);
            let end = self.out.len() + stuffed_len;
            self.out.extend_from_slice(&stuffed);
            self.out.truncate(end);
            rest = after;
        }
        self.out.extend_from_slice(rest);
        Ok(())
    }
}

impl PendingBits {
    pub(crate) const NONE: Self = Self { bits: 0, end: 7 };

    /// At most 56 bits between stores. `bits` has nothing above `count`.
    #[inline(always)]
    pub(crate) fn add(&mut self, bits: u64, count: u32) {
        self.bits = self.bits.wrapping_shl(count) | bits;
        self.end += count as usize;
    }

    #[inline(always)]
    pub(crate) fn store(self, buffer: &mut BitBuffer<'_>) {
        let last = buffer.bytes.get_mut(self.end / 8 % BUFFER_LEN..);
        if let Some(last) = last.and_then(<[u8]>::first_chunk_mut) {
            *last = (self.bits << (!self.end % 8)).to_be_bytes();
        }
    }

    /// To be called after a store.
    #[inline(always)]
    pub(crate) fn make_room(&mut self, buffer: &mut BitBuffer<'_>) -> Result<()> {
        if self.end >= 8 * (BUFFER_LEN - ROOM) {
            let whole = (self.end - 7) / 8;
            buffer.flush(whole)?;
            self.end -= 8 * whole;
        }
        Ok(())
    }

    /// Fills the last byte with ones.
    pub(crate) fn finish(mut self, buffer: &mut BitBuffer<'_>) -> Result<()> {
        self.add(0x7F, 7);
        self.store(buffer);
        buffer.flush((self.end - 7) / 8)
    }
}
