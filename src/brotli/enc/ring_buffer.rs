//! The input that backward references can reach.

use super::Fallible;
use super::params::EncoderParams;
use crate::util::{Checked, SliceExt};
use bun_core::AllocError;

/// So that 8 bytes can be hashed at every position.
const SLACK_FOR_EIGHT_BYTE_HASHING_EVERYWHERE: usize = 7;

/// `size` bytes in which byte `n` of the input is at `n % size`, followed by a copy of the first `tail_size` bytes.
#[derive(Default)]
pub(crate) struct RingBuffer {
    pub(crate) size: u32,
    pub(crate) mask: u32,
    tail_size: u32,
    total_size: u32,

    /// How much room was asked for.
    cur_size: u32,
    /// How much was written, modulo 2^31. The highest bit is set once that has wrapped around.
    pub(crate) pos: u32,
    /// `total_size` bytes and the slack once the input gets near `size`. Until then only the input and the slack, with
    /// the capacity for the rest, so that memory which a short input does not need is never touched.
    buffer: Vec<u8>,
    /// How many bytes were written before there was room for the tail. There is no copy of these in it.
    not_in_tail: u32,
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

    /// Whether anything was written yet.
    #[inline(always)]
    pub(crate) fn is_allocated(&self) -> bool {
        !self.buffer.is_empty()
    }

    /// Until the buffer has been filled once, clears the 7 bytes after the last one written, which hashing at the last
    /// positions reads. Later on these hold older input.
    pub(crate) fn clear_after_end(&mut self) -> Checked {
        if self.pos <= self.mask {
            *self.buffer.array_at_mut(self.pos as usize)? =
                [0; SLACK_FOR_EIGHT_BYTE_HASHING_EVERYWHERE];
        }
        Ok(())
    }

    /// Makes room for `buflen` bytes and keeps the `pos` bytes that are there.
    fn init_buffer(&mut self, buflen: u32) -> Result<(), AllocError> {
        self.buffer.truncate(self.pos as usize);
        let capacity = buflen as usize + SLACK_FOR_EIGHT_BYTE_HASHING_EVERYWHERE;
        self.buffer
            .try_reserve_exact(capacity - self.buffer.len())
            .map_err(|_| AllocError)?;
        self.cur_size = buflen;
        Ok(())
    }

    fn is_complete(&self) -> bool {
        self.buffer.len() > self.total_size as usize
    }

    /// Fills in what was left out so far: zeros up to `size`, and the tail.
    fn complete(&mut self) -> Checked {
        let size = self.size as usize;
        self.buffer.truncate(self.pos as usize);
        self.buffer.resize(size, 0);
        self.buffer.extend_from_within(..self.tail_size as usize);
        self.buffer
            .sub_mut(size..size + self.not_in_tail as usize)?
            .fill(0);
        // A match that is extended by one byte can look at this one when the ring buffer is full. The reference encoder
        // sets it before anything is written to the tail.
        if self.not_in_tail != 0 {
            self.buffer.put(size, 241)?;
        }
        self.buffer
            .extend_from_slice(&[0; SLACK_FOR_EIGHT_BYTE_HASHING_EVERYWHERE]);
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
        const SLACK: [u8; SLACK_FOR_EIGHT_BYTE_HASHING_EVERYWHERE] =
            [0; SLACK_FOR_EIGHT_BYTE_HASHING_EVERYWHERE];
        let n = bytes.len();
        if self.pos == 0 && n < self.tail_size as usize {
            // A first write that is shorter than a block is likely to be the only one, and then neither the whole ring
            // buffer nor the tail is needed.
            self.init_buffer(n as u32)?;
            self.buffer.extend_from_slice(bytes);
            self.buffer.extend_from_slice(&SLACK);
            self.pos = n as u32;
            self.not_in_tail = n as u32;
            return Ok(());
        }
        if self.cur_size < self.total_size {
            self.init_buffer(self.total_size)?;
        }
        if !self.is_complete() {
            if self.pos as usize + n + SLACK.len() <= self.size as usize {
                self.buffer.truncate(self.pos as usize);
                self.buffer.extend_from_slice(bytes);
                self.buffer.extend_from_slice(&SLACK);
                self.pos += n as u32;
                return Ok(());
            }
            self.complete()?;
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
