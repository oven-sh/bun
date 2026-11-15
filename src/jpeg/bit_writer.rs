//! Puts codes together to entropy-coded data.

use crate::Result;

const BUFFER_LEN: usize = 4096;
/// So many bytes can be stored between two calls of [`PendingBits::make_room`].
pub(crate) const ROOM: usize = 512;
/// A store ends with the last bit, so the first ones start before the data.
const MARGIN: usize = 8;

/// Data that is yet to get its stuffing.
pub(crate) struct BitBuffer<'a> {
    out: &'a mut Vec<u8>,
    bytes: [u8; MARGIN + BUFFER_LEN],
}

/// Apart from the [`BitBuffer`], so that a loop has it in registers.
#[derive(Clone, Copy)]
pub(crate) struct PendingBits {
    /// The last 64. The very last is the lowest.
    bits: u64,
    /// How many there are for the buffer, and 7 more: an eighth of this is how many bytes have been begun.
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
        self.out.try_reserve(2 * len)?;
        while let Some(at) = bun_highway::index_of_char(rest, 0xFF) {
            let (through, after) = rest.split_at(at + 1);
            self.out.extend_from_slice(through);
            self.out.push(0);
            rest = after;
        }
        self.out.extend_from_slice(rest);
        Ok(())
    }
}

impl PendingBits {
    pub(crate) const NONE: Self = Self { bits: 0, end: 7 };

    /// At most 56 bits from one store to the next. Those above `count` are zeros.
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
