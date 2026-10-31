//! Reads the input bit by bit, least significant bit first.
//!
//! The reader does not hold the input. Every method that can need more of it takes `input`, which has to be the slice
//! whose length [`BitReader::set_input`] was given.

use crate::common::constants::LARGE_MAX_WBITS;
use crate::util::{Bug, Checked, SliceExt, load_u32_le, load_u64_le};

/// With this many bytes of input left, everything read between two checks of [`BitReader::has_fast_input`] is
/// there: 162 bits + 7 bytes.
const FAST_INPUT_SLACK: usize = 28;

#[inline(always)]
pub(crate) const fn bit_mask(n: u32) -> u64 {
    !(!0u64 << n)
}

#[derive(Clone, Copy, Default)]
pub(crate) struct BitReader {
    /// Bits taken from the input and not read yet. Those above `bit_pos` are either 0 or what the next load puts there.
    val: u64,
    /// How many bits of `val` count.
    bit_pos: u32,
    /// Index of the next byte to load.
    next_in: usize,
    /// From here on, reads have to check for the end of the input.
    guard_in: usize,
    /// Where the input ends.
    last_in: usize,
}

impl BitReader {
    #[inline(always)]
    pub(crate) fn avail_in(&self) -> usize {
        self.last_in.saturating_sub(self.next_in)
    }

    #[inline(always)]
    pub(crate) fn next_in(&self) -> usize {
        self.next_in
    }

    /// Continues at `next_in` of an input of `len` bytes.
    pub(crate) fn set_input(&mut self, len: usize, next_in: usize) {
        debug_assert!(next_in <= len);
        self.next_in = next_in;
        self.last_in = len;
        self.guard_in = (len + 1).saturating_sub(FAST_INPUT_SLACK).max(next_in);
    }

    #[inline(always)]
    pub(crate) fn available_bits(&self) -> u32 {
        self.bit_pos
    }

    /// The whole bytes not read yet, in the input and in the accumulator. Capped at the largest ring buffer.
    pub(crate) fn remaining_bytes(&self) -> usize {
        const CAP: usize = 1 << LARGE_MAX_WBITS;
        let avail_in = self.avail_in();
        if avail_in > CAP {
            return CAP;
        }
        avail_in + (self.bit_pos >> 3) as usize
    }

    /// Whether the reads that do not check for the end of the input can be used.
    #[inline(always)]
    pub(crate) fn has_fast_input(&self) -> bool {
        self.next_in < self.guard_in
    }

    /// How many bytes can be loaded before [`Self::has_fast_input`] turns false.
    #[inline(always)]
    pub(crate) fn bytes_before_guard(&self) -> usize {
        self.guard_in.saturating_sub(self.next_in)
    }

    /// Makes sure there are more than `N` bits, which is a multiple of 8.
    #[inline(always)]
    fn fill_bit_window<const N: u32>(&mut self, input: &[u8]) -> Checked {
        if self.bit_pos <= N {
            self.val |= load_u64_le(input, self.next_in)? << self.bit_pos;
            self.bit_pos += 64 - N;
            self.next_in += (64 - N as usize) / 8;
        }
        Ok(())
    }

    /// Makes sure there are more than 32 bits. Loads no more than 4 bytes.
    #[inline(always)]
    pub(crate) fn fill_bit_window_32(&mut self, input: &[u8]) -> Checked {
        if self.bit_pos <= 32 {
            self.val |= u64::from(load_u32_le(input, self.next_in)?) << self.bit_pos;
            self.bit_pos += 32;
            self.next_in += 4;
        }
        Ok(())
    }

    /// Loads one byte, unless the input has ended.
    #[inline(always)]
    pub(crate) fn pull_byte(&mut self, input: &[u8]) -> bool {
        if self.next_in == self.last_in {
            return false;
        }
        let Some(&byte) = input.get(self.next_in) else {
            return false;
        };
        self.val |= u64::from(byte) << self.bit_pos;
        self.bit_pos += 8;
        self.next_in += 1;
        true
    }

    /// The accumulator. [`Self::available_bits`] of it count.
    #[inline(always)]
    pub(crate) fn bits_unmasked(&self) -> u64 {
        self.val
    }

    /// At least 16 bits, without advancing.
    #[inline(always)]
    pub(crate) fn get_16_bits_unmasked(&mut self, input: &[u8]) -> Checked<u64> {
        self.fill_bit_window::<16>(input)?;
        Ok(self.val)
    }

    /// 8 bits, without advancing.
    #[inline(always)]
    pub(crate) fn get_8_bits(&mut self, input: &[u8]) -> Checked<u64> {
        self.fill_bit_window::<8>(input)?;
        Ok(self.val & 0xFF)
    }

    /// `n_bits` bits without advancing, unless the input ends before.
    #[inline(always)]
    pub(crate) fn safe_get_bits(&mut self, input: &[u8], n_bits: u32) -> Option<u64> {
        while self.bit_pos < n_bits {
            if !self.pull_byte(input) {
                return None;
            }
        }
        Some(self.val & bit_mask(n_bits))
    }

    #[inline(always)]
    pub(crate) fn drop_bits(&mut self, n_bits: u32) {
        debug_assert!(n_bits <= self.bit_pos);
        self.bit_pos = self.bit_pos.wrapping_sub(n_bits);
        self.val >>= n_bits;
    }

    /// Clears the bits that do not count, which matters when the bytes they came from are then skipped.
    #[inline(always)]
    fn normalize(&mut self) {
        if self.bit_pos < 64 {
            self.val &= (1u64 << self.bit_pos) - 1;
        }
    }

    /// Gives the whole bytes in the accumulator back to the input.
    pub(crate) fn unload(&mut self) -> Checked {
        let unused_bytes = self.bit_pos >> 3;
        self.next_in = self.next_in.checked_sub(unused_bytes as usize).ok_or(Bug)?;
        self.bit_pos -= unused_bytes << 3;
        self.normalize();
        Ok(())
    }

    /// The accumulator has to hold `n_bits`.
    #[inline(always)]
    pub(crate) fn take_bits(&mut self, n_bits: u32) -> u64 {
        let val = self.val & bit_mask(n_bits);
        self.drop_bits(n_bits);
        val
    }

    /// Up to 32 bits.
    #[inline(always)]
    pub(crate) fn read_bits(&mut self, input: &[u8], n_bits: u32) -> Checked<u64> {
        debug_assert!(n_bits <= 32);
        self.fill_bit_window_32(input)?;
        Ok(self.take_bits(n_bits))
    }

    /// Up to 32 bits, unless the input ends before. What was loaded stays loaded then.
    #[inline(always)]
    pub(crate) fn safe_read_bits(&mut self, input: &[u8], n_bits: u32) -> Option<u64> {
        debug_assert!(n_bits <= 32);
        let bits = self.safe_get_bits(input, n_bits)?;
        self.drop_bits(n_bits);
        Some(bits)
    }

    /// Makes sure the accumulator is not empty, unless the input has ended.
    pub(crate) fn warmup(&mut self, input: &[u8]) -> bool {
        if self.bit_pos == 0 {
            self.val = 0;
            if !self.pull_byte(input) {
                return false;
            }
        }
        true
    }

    /// Skips to the next byte of the input. Whether the bits skipped were all 0.
    pub(crate) fn jump_to_byte_boundary(&mut self) -> bool {
        let pad_bits_count = self.bit_pos & 7;
        let pad_bits = if pad_bits_count != 0 {
            self.take_bits(pad_bits_count)
        } else {
            0
        };
        self.normalize();
        pad_bits == 0
    }

    /// The accumulator has to be empty.
    fn drop_bytes(&mut self, num: usize) {
        debug_assert!(self.bit_pos == 0 && self.val == 0);
        self.next_in += num;
    }

    /// Skips `num` bytes, which is no more than [`Self::remaining_bytes`]. The position has to be at a byte boundary.
    pub(crate) fn skip_bytes(&mut self, mut num: usize) {
        while self.bit_pos >= 8 && num > 0 {
            self.drop_bits(8);
            num -= 1;
        }
        self.normalize();
        if num > 0 {
            self.drop_bytes(num);
        }
    }

    /// Fills `dest`, which is no longer than [`Self::remaining_bytes`]. The position has to be at a byte boundary.
    pub(crate) fn copy_bytes(&mut self, input: &[u8], dest: &mut [u8]) -> Checked {
        let mut filled = 0;
        while self.bit_pos >= 8 && filled < dest.len() {
            dest.put(filled, self.val as u8)?;
            self.drop_bits(8);
            filled += 1;
        }
        self.normalize();
        let rest = dest.sub_mut(filled..)?;
        if !rest.is_empty() {
            rest.copy_from_slice(input.sub(self.next_in..self.next_in + rest.len())?);
            self.drop_bytes(dest.len() - filled);
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The decoder computes with this in 32 bits, signed (CVE-2020-8927).
    #[test]
    fn remaining_bytes_fits_an_i32_however_long_the_input_is() {
        for len in [
            1 << 30,
            (1 << 30) + 1,
            (1 << 31) - 1,
            1 << 31,
            (1 << 32) + 5,
            usize::MAX - 1,
        ] {
            let mut br = BitReader {
                bit_pos: 64,
                ..Default::default()
            };
            br.set_input(len, 0);
            assert!(br.remaining_bytes() <= (1 << 30) + 8, "{len}");
        }
    }
}
