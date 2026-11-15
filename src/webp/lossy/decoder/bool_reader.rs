//! The arithmetic decoder of RFC 6386 section 7.

use crate::error::{Error, Result};

#[derive(Clone, Copy, Default)]
pub(super) struct BoolReader<'a> {
    unread: &'a [u8],
    /// The 8 bits that are compared with the range, 8 below them, and `spare_bits` more.
    value: u64,
    /// The range minus one, 127 to 254.
    range: u32,
    /// Negative: so many are missing.
    spare_bits: i32,
    /// Zeros put behind the end of the data. The first is only looked ahead at.
    made_up_bytes: u8,
}

impl<'a> BoolReader<'a> {
    pub(super) fn new(bytes: &'a [u8]) -> Self {
        let mut reader = Self {
            unread: bytes,
            value: 0,
            range: 254,
            spare_bits: -16,
            made_up_bytes: 0,
        };
        match bytes.first() {
            // The value is below the range at all times, which starts at 255. There is nothing to read from such data.
            Some(255) => reader.unread = &[],
            _ => reader.refill(),
        }
        reader
    }

    pub(super) fn check_not_past_end(&self) -> Result<()> {
        if self.made_up_bytes > 1 {
            return Err(Error::UnexpectedEof);
        }
        Ok(())
    }

    #[inline(always)]
    fn refill(&mut self) {
        match self.unread.first_chunk() {
            Some(&bytes) => {
                self.value = self.value << 48 | u64::from_be_bytes(bytes) >> 16;
                self.spare_bits += 48;
                self.unread = self.unread.get(6..).unwrap_or_default();
            }
            None => *self = self.refilled_near_end(),
        }
    }

    // By value, so that the callers' loops can keep the reader in registers.
    #[cold]
    #[inline(never)]
    fn refilled_near_end(mut self) -> Self {
        while self.spare_bits < 0 {
            self.value <<= 8;
            self.spare_bits += 8;
            match self.unread.split_off_first() {
                Some(&byte) => self.value |= u64::from(byte),
                None => self.made_up_bytes = self.made_up_bytes.saturating_add(1),
            }
        }
        self
    }

    /// `probability` out of 256 is that of `false`.
    #[inline(always)]
    pub(super) fn read(&mut self, probability: u8) -> bool {
        if self.spare_bits < 0 {
            self.refill();
        }
        let position = self.spare_bits as u32 % 64;
        // All in 256ths, for the fewest steps from one range to the next.
        let product = self.range * u32::from(probability);
        let last_false = product | 255;
        if (self.value >> position) as u32 > last_false {
            self.value -= u64::from(last_false + 1) << position;
            let old_last = self.range << 8 | 255;
            self.normalize(old_last - 1 - last_false, old_last - product);
            true
        } else {
            self.normalize(last_false, product + 256);
            false
        }
    }

    /// `last` is the last value in the new range, and `size` has the same highest bit as the size of that range.
    #[inline(always)]
    fn normalize(&mut self, last: u32, size: u32) {
        let highest_bit = size.leading_zeros() ^ 31;
        self.range = last >> (highest_bit.wrapping_sub(7) % 32);
        self.spare_bits += highest_bit as i32 - 15;
    }

    /// Gives `magnitude` a sign, both being equally likely.
    #[inline(always)]
    pub(super) fn read_sign(&mut self, magnitude: i32) -> i32 {
        if self.spare_bits < 0 {
            self.refill();
        }
        let position = self.spare_bits as u32 % 64;
        let last_plus = self.range << 7 | 255;
        let value = (self.value >> position) as u32;
        // All ones for minus.
        let mask = last_plus.wrapping_sub(value) as i32 >> 31;
        self.spare_bits -= 1;
        self.range = self.range.wrapping_add_signed(mask) | 1;
        self.value -= u64::from((last_plus + 1) & mask as u32) << position;
        (magnitude ^ mask) - mask
    }

    pub(super) fn read_flag(&mut self) -> bool {
        self.read(128)
    }

    /// The highest bit comes first.
    pub(super) fn read_unsigned(&mut self, bits: u32) -> u8 {
        (0..bits).fold(0, |value, _| value << 1 | u8::from(self.read_flag()))
    }

    /// `None` if the flag in front of it is not set.
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
