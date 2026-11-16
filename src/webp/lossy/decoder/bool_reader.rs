//! The arithmetic decoder of RFC 6386 section 7.

use core::hint::{cold_path, select_unpredictable};

use crate::error::{Error, Result};

#[derive(Clone, Copy, Default)]
pub(super) struct BoolReader<'a> {
    unread: &'a [u8],
    /// From the top: the 8 bits that are compared with the range, and `spare_bits` more. Those below are zero or the
    /// bits that come next.
    value: u64,
    /// The range minus one, 127 to 254.
    range: u32,
    /// Negative: so many are missing.
    spare_bits: i32,
    /// Zeros were put behind the end of the data.
    is_past_end: bool,
}

impl<'a> BoolReader<'a> {
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        let mut reader = Self {
            unread: bytes,
            value: 0,
            range: 254,
            spare_bits: -8,
            is_past_end: false,
        };
        match bytes.first() {
            // The value is below the range at all times, which starts at 255. There is nothing to read from such data.
            Some(255) => reader.unread = &[],
            _ => reader.refill(),
        }
        reader
    }

    pub(super) fn check_not_past_end(&self) -> Result<()> {
        if self.is_past_end {
            return Err(Error::UnexpectedEof);
        }
        Ok(())
    }

    #[inline(always)]
    fn refill(&mut self) {
        match self.unread.first_chunk() {
            Some(&bytes) => {
                self.value |= u64::from_be_bytes(bytes) >> ((self.spare_bits + 8) as u32 % 64);
                self.spare_bits += 56;
                self.unread = self.unread.get(7..).unwrap_or_default();
            }
            None => *self = self.refilled_near_end(),
        }
    }

    // By value, so that the callers' loops can keep the reader in registers.
    #[cold]
    #[inline(never)]
    fn refilled_near_end(mut self) -> Self {
        match self.unread.split_off_first() {
            Some(&byte) => self.value |= u64::from(byte) << (48 - self.spare_bits),
            None => self.is_past_end = true,
        }
        self.spare_bits += 8;
        self
    }

    /// `probability` out of 256 is that of `false`.
    #[inline(always)]
    pub(super) fn read(&mut self, probability: u8) -> bool {
        let (bit, [size_false, size_true]) = self.split(probability);
        if bit {
            self.value -= u64::from(size_false >> 8) << 56;
            self.normalize(size_true);
        } else {
            self.normalize(size_false);
        }
        bit
    }

    /// The same as 0 or 1, for a bit that nothing branches on.
    #[inline(always)]
    pub(super) fn read_bit(&mut self, probability: u8) -> i32 {
        let (bit, [size_false, size_true]) = self.split(probability);
        self.value -= select_unpredictable(bit, u64::from(size_false >> 8) << 56, 0);
        self.normalize(select_unpredictable(bit, size_true, size_false));
        i32::from(bit)
    }

    /// The same for a `probability` close to 256, which mostly leaves a range that is large enough.
    #[inline(always)]
    pub(super) fn read_unlikely(&mut self, probability: u8) -> bool {
        let last_false = (self.range * u32::from(probability)) >> 8;
        if self.spare_bits >= 0 && last_false >= 127.max((self.value >> 56) as u32) {
            self.range = last_false;
            return false;
        }
        self.read(probability)
    }

    /// The bit, and the sizes of both parts of the range in the bits above the lowest 8. Those stay on, for the fewest
    /// steps from one range to the next.
    #[inline(always)]
    fn split(&mut self, probability: u8) -> (bool, [u32; 2]) {
        if self.spare_bits < 0 {
            cold_path();
            self.refill();
        }
        let product = self.range * u32::from(probability);
        let bit = product < (self.value >> 48) as u32 & !255;
        (bit, [product + 256, (self.range << 8 | 255) - product])
    }

    #[inline(always)]
    fn normalize(&mut self, size: u32) {
        let highest_bit = size.leading_zeros() ^ 31;
        self.range = ((size | 255) - 256) << 7 >> (highest_bit % 32);
        self.value <<= (highest_bit ^ 15) % 64;
        self.spare_bits -= (highest_bit ^ 15) as i32;
    }

    /// Gives `magnitude` a sign, both being equally likely. Not for the first bit, whose range is too large.
    #[inline(always)]
    pub(super) fn read_sign(&mut self, magnitude: i32) -> i32 {
        debug_assert!(self.range < 254);
        if self.spare_bits < 0 {
            cold_path();
            self.refill();
        }
        let last_plus = self.range >> 1;
        // All ones for minus.
        let mask = last_plus.wrapping_sub((self.value >> 56) as u32) as i32 >> 31;
        self.range = self.range.wrapping_add_signed(mask) | 1;
        self.value -= u64::from((last_plus + 1) & mask as u32) << 56;
        self.value <<= 1;
        self.spare_bits -= 1;
        (magnitude ^ mask) - mask
    }

    /// `read_unsigned(8)` for a loop, and not for the first bit either.
    #[inline(always)]
    pub(super) fn read_byte(&mut self) -> u8 {
        (0..8).fold(0, |value, _| value << 1 | u8::from(self.read_sign(1) < 0))
    }

    // These three are out of line: the header has many fields, each of which is read once.
    #[inline(never)]
    pub(super) fn read_flag(&mut self) -> bool {
        self.read(128)
    }

    /// The highest bit comes first.
    #[inline(never)]
    pub(super) fn read_unsigned(&mut self, bits: u32) -> u8 {
        (0..bits).fold(0, |value, _| value << 1 | self.read_bit(128) as u8)
    }

    /// `None` if the flag in front of it is not set.
    #[inline(never)]
    pub(super) fn read_optional_signed(&mut self, bits: u32) -> Option<i32> {
        self.read_flag().then(|| {
            let magnitude = i32::from(self.read_unsigned(bits));
            if self.read_flag() {
                -magnitude
            } else {
                magnitude
            }
        })
    }
}
