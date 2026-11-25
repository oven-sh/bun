//! Reads entropy-coded data bit by bit. Zeros follow the end of the data.

use crate::input::Input;
use crate::marker::{RST0, SOF0, SOI};

const WINDOW_LEN: usize = 4096;
/// The most that a block can take: 64 codes of 32 bits, and the 8 bytes that [`Bits::refill`] loads.
const MARGIN: usize = 64 * 4 + 8;
pub(crate) const BITS_IN_REFILL: u32 = 57;

/// A stretch of unstuffed data. Positions are in bits.
pub(crate) struct Window<'i, 'a> {
    input: &'i mut Input<'a>,
    bytes: [u8; WINDOW_LEN + 8],
    /// Where the data in `bytes` ends. Only zeros follow.
    end: usize,
    /// A block that starts before this fits in `bytes`.
    limit: usize,
    /// 64 bits before `end`.
    low_mark: usize,
}

/// The read state, separate from [`Window`] so that loops keep it in registers.
#[derive(Clone, Copy)]
pub(crate) struct Bits {
    /// The next bit is the highest. Decoders leave enough bits to look up the next code while a refill is under way.
    buffer: u64,
    position: usize,
}

impl<'i, 'a> Window<'i, 'a> {
    pub(crate) fn new(input: &'i mut Input<'a>) -> Self {
        Self {
            input,
            bytes: [0; WINDOW_LEN + 8],
            end: 0,
            limit: 0,
            low_mark: 0,
        }
    }

    /// Drops what is before `position` and reads more. Returns where the bit at `position` is now.
    #[cold]
    #[inline(never)]
    fn slide(&mut self, position: usize) -> usize {
        // The data has ended. All positions after it read zeros, so any will do.
        if self.limit > self.end {
            return self.end + 8;
        }
        let (start, old_end) = (position.min(self.end) / 8, self.end / 8);
        if start < old_end {
            self.bytes.copy_within(start..old_end, 0);
        }
        let room = self.bytes.get_mut(old_end - start..WINDOW_LEN - MARGIN);
        let end = old_end - start + self.input.read_data(room.unwrap_or_default());
        if let Some(stale @ [_, ..]) = self.bytes.get_mut(end..old_end) {
            stale.fill(0);
        }
        self.end = 8 * end;
        self.low_mark = self.end.saturating_sub(64);
        self.limit = match self.input.pending_marker() {
            // Above `end + 8`, which is where later slides move positions back to.
            Some(_) => self.end + 16,
            None => self.end - 8 * MARGIN,
        };
        position % 8
    }

    #[inline(always)]
    fn load(&self, position: usize) -> u64 {
        let next = self.bytes.get(position / 8 % WINDOW_LEN..);
        let next = next.and_then(<[u8]>::first_chunk).copied();
        u64::from_be_bytes(next.unwrap_or_default())
    }

    /// The 4 bytes at `position`, which it advances.
    #[inline(always)]
    pub(crate) fn take_u32(&mut self, position: &mut usize) -> u32 {
        if *position >= self.limit {
            *position = self.slide(*position);
        }
        let word = self.load(*position) >> 32;
        *position += 32;
        word as u32
    }

    /// Whether `bits` has not gone past the end of the data.
    #[inline(always)]
    pub(crate) fn has_data(&self, bits: Bits) -> bool {
        bits.position <= self.end
    }

    #[inline(always)]
    pub(crate) fn is_running_low(&self, bits: Bits) -> bool {
        bits.position >= self.low_mark
    }

    /// Empties the window. Returns false if the marker is missing, so that no data follows.
    pub(crate) fn skip_restart_marker(&mut self, number: u8) -> bool {
        self.input.restart(number);
        let stale = self.bytes.get_mut(..self.end / 8);
        stale.unwrap_or_default().fill(0);
        (self.end, self.limit, self.low_mark) = (0, 0, 0);
        self.input.pending_marker().is_none()
    }

    /// Continues after restart marker `number`.
    pub(crate) fn restart(&mut self, bits: Bits, number: u8) -> Bits {
        let had_data = self.has_data(bits);
        let has_data = self.skip_restart_marker(number) || had_data;
        // Position 1 of an empty window is past the data.
        self.bits_from(usize::from(!has_data))
    }

    pub(crate) fn bits_from(&mut self, position: usize) -> Bits {
        let buffer = 0;
        let mut bits = Bits { buffer, position };
        bits.ensure_margin(self);
        bits.refill(self);
        bits
    }

    /// Whether the data is used up, and ends with a marker that no restart gets past.
    pub(crate) fn is_over(&self, bits: Bits) -> bool {
        !self.has_data(bits) && matches!(self.input.pending_marker(), Some(SOF0..RST0 | SOI..))
    }
}

impl Bits {
    /// Leaves [`MARGIN`] bytes in the window, which is enough for a block.
    #[inline(always)]
    pub(crate) fn ensure_margin(&mut self, window: &mut Window<'_, '_>) {
        if self.position >= window.limit {
            self.position = window.slide(self.position);
        }
    }

    /// Leaves at least [`BITS_IN_REFILL`] bits in the buffer.
    #[inline(always)]
    pub(crate) fn refill(&mut self, window: &Window<'_, '_>) {
        self.buffer = window.load(self.position) << (self.position % 8);
    }

    #[inline(always)]
    pub(crate) fn peek(self) -> u64 {
        self.buffer
    }

    /// Takes up to 32 bits. They are the low bits of the result, and the others are garbage.
    #[inline(always)]
    pub(crate) fn take(&mut self, count: u32) -> u32 {
        self.buffer = self.buffer.rotate_left(count);
        self.position += count as usize;
        self.buffer as u32
    }

    /// [`Self::take`] of `word & 0xFF` bits. The rotation does not wait for the mask.
    #[inline(always)]
    pub(crate) fn take_low_byte(&mut self, word: u32) -> u32 {
        self.buffer = self.buffer.rotate_left(word);
        self.position += usize::from(word as u8);
        self.buffer as u32
    }
}
