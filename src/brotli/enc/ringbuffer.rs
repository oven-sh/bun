//! The input that backward references can reach.

use super::Fallible;
use super::params::EncoderParams;
use crate::util::{OutOfMemory, SliceExt};

/// So that 8 bytes can be hashed at every position.
const SLACK_FOR_EIGHT_BYTE_HASHING_EVERYWHERE: usize = 7;

/// `size` bytes in which byte `n` of the input is at `n % size`, followed by a copy of the first `tail_size` bytes.
#[derive(Default)]
pub(crate) struct RingBuffer {
    pub(crate) size: u32,
    pub(crate) mask: u32,
    tail_size: u32,
    total_size: u32,

    cur_size: u32,
    /// How much was written, modulo 2^31. The highest bit is set once that has wrapped around.
    pub(crate) pos: u32,
    /// `cur_size` bytes and the slack.
    buffer: Vec<u8>,
}

impl RingBuffer {
    pub(crate) fn setup(&mut self, params: &EncoderParams) {
        let window_bits = params.compute_rb_bits();
        let tail_bits = params.lgblock;
        self.size = 1 << window_bits;
        self.mask = (1 << window_bits) - 1;
        self.tail_size = 1 << tail_bits;
        self.total_size = self.size + self.tail_size;
    }

    #[inline(always)]
    pub(crate) fn buffer(&self) -> &[u8] {
        &self.buffer
    }

    /// Makes room for `buflen` bytes and keeps what is there.
    fn init_buffer(&mut self, buflen: u32) -> Result<(), OutOfMemory> {
        let new_len = buflen as usize + SLACK_FOR_EIGHT_BYTE_HASHING_EVERYWHERE;
        self.buffer.truncate(self.cur_size as usize);
        self.buffer.try_reserve_exact(new_len - self.buffer.len()).map_err(|_| OutOfMemory)?;
        self.buffer.resize(new_len, 0);
        self.cur_size = buflen;
        Ok(())
    }

    fn write_tail(&mut self, bytes: &[u8]) -> Fallible {
        let masked_pos = (self.pos & self.mask) as usize;
        if masked_pos < self.tail_size as usize {
            let p = self.size as usize + masked_pos;
            let n = bytes.len().min(self.tail_size as usize - masked_pos);
            self.buffer.write_at(p, bytes.sub(..n)?)?;
        }
        Ok(())
    }

    /// Appends `bytes`, which is no longer than `tail_size`.
    pub(crate) fn write(&mut self, bytes: &[u8]) -> Fallible {
        let n = bytes.len();
        if self.pos == 0 && n < self.tail_size as usize {
            // A first write that is shorter than a block is likely to be the only one, and then neither the whole ring
            // buffer nor the tail is needed.
            self.pos = n as u32;
            self.init_buffer(self.pos)?;
            self.buffer.write_at(0, bytes)?;
            return Ok(());
        }
        if self.cur_size < self.total_size {
            self.init_buffer(self.total_size)?;
            // A match that is extended by one byte can look at this one when the ring buffer is full.
            self.buffer.put(self.size as usize, 241)?;
        }
        let masked_pos = (self.pos & self.mask) as usize;
        let size = self.size as usize;
        self.write_tail(bytes)?;
        if masked_pos + n <= size {
            self.buffer.write_at(masked_pos, bytes)?;
        } else {
            // Up to the end of the buffer, tail included, and the rest at the start.
            let first = n.min(self.total_size as usize - masked_pos);
            self.buffer.write_at(masked_pos, bytes.sub(..first)?)?;
            self.buffer.write_at(0, bytes.sub(size - masked_pos..)?)?;
        }
        let not_first_lap = self.pos & (1 << 31) != 0;
        let rb_pos_mask = (1u32 << 31) - 1;
        self.pos = (self.pos & rb_pos_mask).wrapping_add(n as u32 & rb_pos_mask);
        if not_first_lap {
            self.pos |= 1 << 31;
        }
        Ok(())
    }
}
