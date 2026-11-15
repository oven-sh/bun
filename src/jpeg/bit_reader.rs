//! The bits of entropy-coded data. After the data come zeros.

use crate::input::Input;
use crate::marker::{RST0, SOF0, SOI};

const WINDOW_LEN: usize = 4096;
/// A block is at most 64 codes of 32 bits, and [`Bits::refill`] loads 8 bytes.
const MARGIN: usize = 64 * 4 + 8;
pub(crate) const BITS_IN_REFILL: u32 = 57;

/// Data without its stuffing. Positions are in bits.
pub(crate) struct Window<'i, 'a> {
    input: &'i mut Input<'a>,
    bytes: [u8; WINDOW_LEN + 8],
    /// Where the data in `bytes` ends.
    end: usize,
    /// A block has to start before this to fit.
    limit: usize,
    /// 64 bits before `end`.
    low_mark: usize,
    /// About how many bytes have been read past the end of the data.
    zeros: usize,
}

/// Apart from the [`Window`], so that a loop has it in registers.
#[derive(Clone, Copy)]
pub(crate) struct Bits {
    /// The next bit is the highest. Decoders leave enough of them to look up the next code without waiting for a refill.
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
            zeros: 0,
        }
    }

    /// Returns where the bit that was at `position` is now.
    #[cold]
    #[inline(never)]
    fn slide(&mut self, position: usize) -> usize {
        if self.limit > self.end {
            self.zeros += (position - self.end) / 8 - 1;
            return self.end + 8;
        }
        let (start, end) = (position.min(self.end) / 8, self.end / 8);
        self.bytes.copy_within(start..end, 0);
        let room = self.bytes.get_mut(end - start..WINDOW_LEN - MARGIN);
        let end = end - start + self.input.read_data(room.unwrap_or_default());
        self.end = 8 * end;
        self.low_mark = self.end.saturating_sub(64);
        if self.input.pending_marker().is_some() {
            let zeros = self.bytes.get_mut(end..end + MARGIN + 8);
            zeros.unwrap_or_default().fill(0);
            self.limit = self.end + 16;
        } else {
            self.limit = self.end - 8 * MARGIN;
        }
        position % 8
    }

    #[inline(always)]
    fn load(&self, position: usize) -> u64 {
        let next = self.bytes.get(position / 8 % WINDOW_LEN..);
        let next = next.and_then(<[u8]>::first_chunk).copied();
        u64::from_be_bytes(next.unwrap_or_default())
    }

    /// The 4 bytes at `position`, which moves past them.
    #[inline(always)]
    pub(crate) fn word(&mut self, position: &mut usize) -> u32 {
        if *position >= self.limit {
            *position = self.slide(*position);
        }
        let word = self.load(*position) >> 32;
        *position += 32;
        word as u32
    }

    /// How many of the zeros read since the last restart come after the first `free`. Each counts once.
    #[inline(always)]
    pub(crate) fn take_zeros_beyond(&mut self, free: usize) -> usize {
        let beyond = self.zeros.saturating_sub(free);
        self.zeros -= beyond;
        beyond
    }

    /// Whether `bits` has given out nothing but data so far.
    #[inline(always)]
    pub(crate) fn has_data(&self, bits: Bits) -> bool {
        bits.position <= self.end
    }

    #[inline(always)]
    pub(crate) fn is_running_low(&self, bits: Bits) -> bool {
        bits.position >= self.low_mark
    }

    /// The data after it starts at 0. Returns whether there is any: not if the marker is missing.
    pub(crate) fn skip_restart_marker(&mut self, number: u8) -> bool {
        self.input.restart(number);
        (self.end, self.limit, self.low_mark, self.zeros) = (0, 0, 0, 0);
        self.input.pending_marker().is_none()
    }

    /// Goes on after the restart marker `number`.
    pub(crate) fn restart(&mut self, bits: Bits, number: u8) -> Bits {
        let had_data = self.has_data(bits);
        let has_data = self.skip_restart_marker(number) || had_data;
        self.bits_from(usize::from(!has_data))
    }

    pub(crate) fn bits_from(&mut self, position: usize) -> Bits {
        let buffer = 0;
        let mut bits = Bits { buffer, position };
        bits.start_block(self);
        bits.refill(self);
        bits
    }

    /// Whether it is known that no restart brings more data.
    pub(crate) fn is_last(&self) -> bool {
        matches!(self.input.pending_marker(), Some(SOF0..RST0 | SOI..))
    }

    pub(crate) fn is_over(&self, bits: Bits) -> bool {
        !self.has_data(bits) && self.is_last()
    }
}

impl Bits {
    /// To be called before each block.
    #[inline(always)]
    pub(crate) fn start_block(&mut self, window: &mut Window<'_, '_>) {
        if self.position >= window.limit {
            self.position = window.slide(self.position);
        }
    }

    /// There are at least [`BITS_IN_REFILL`] bits after this.
    #[inline(always)]
    pub(crate) fn refill(&mut self, window: &Window<'_, '_>) {
        self.buffer = window.load(self.position) << (self.position % 8);
    }

    #[inline(always)]
    pub(crate) fn peek(self) -> u64 {
        self.buffer
    }

    /// At most 32 bits. They are the lowest of the result, and what is above them means nothing.
    #[inline(always)]
    pub(crate) fn take(&mut self, count: u32) -> u32 {
        self.buffer = self.buffer.rotate_left(count);
        self.position += count as usize;
        self.buffer as u32
    }

    /// As many as the low byte of `word` says. The rotation does not have to wait for it to be cut out.
    #[inline(always)]
    pub(crate) fn take_low_byte(&mut self, word: u32) -> u32 {
        self.buffer = self.buffer.rotate_left(word);
        self.position += usize::from(word as u8);
        self.buffer as u32
    }
}
