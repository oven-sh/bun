//! `bit_reader_utils.c`, `bit_reader_inl_utils.h`: the boolean decoder.

/// How many bits are loaded at a time. With the 8 bits in use they fill `value`.
const BITS: i32 = 56;

/// `[kVP8Log2Range, kVP8NewRange]` by range minus 1. One load is a shorter wait than counting zeros and shifting.
const NORMALIZED: [[u8; 2]; 256] = {
    let mut table = [[0; 2]; 256];
    let mut rest: &mut [[u8; 2]] = &mut table;
    let mut range = 1u32;
    while let [entry, tail @ ..] = rest {
        let shift = if range < 128 {
            (range as u8).leading_zeros()
        } else {
            0
        };
        *entry = [shift as u8, ((range << shift) - 1) as u8];
        range += 1;
        rest = tail;
    }
    table
};

#[derive(Clone, Copy)]
pub(super) struct BitReader<'a> {
    value: u64,
    /// The range minus 1: 127 to 254, or 255 after `get_signed`.
    range: u32,
    /// How many bits of `value` are below the 8 in use. Negative, down to -8, when some of those are missing.
    bits: i32,
    /// What is not in `value` yet.
    buf: &'a [u8],
    /// Whether more was asked for than the 8 bits that may be read past the end.
    eof: bool,
}

impl<'a> BitReader<'a> {
    pub(super) fn new(buf: &'a [u8]) -> Self {
        let mut br = Self {
            value: 0,
            range: 255 - 1,
            bits: -8,
            buf,
            eof: false,
        };
        br.load_new_bytes();
        br
    }

    pub(super) fn eof(&self) -> bool {
        self.eof
    }

    #[inline(always)]
    fn load_new_bytes(&mut self) {
        // Only when 8 bytes are left, although 7 are taken: when `eof` is set depends on it.
        if let (Some(&bytes), Some(rest)) = (self.buf.first_chunk::<8>(), self.buf.get(7..)) {
            self.buf = rest;
            self.value = (u64::from_be_bytes(bytes) >> 8) | (self.value << BITS);
            self.bits += BITS;
        } else {
            *self = self.load_final_bytes();
        }
    }

    // By value, so that this call does not keep the caller's reader out of registers.
    #[cold]
    #[inline(never)]
    fn load_final_bytes(mut self) -> Self {
        if let Some((&byte, rest)) = self.buf.split_first() {
            self.buf = rest;
            self.bits += 8;
            self.value = u64::from(byte) | (self.value << 8);
        } else if !self.eof {
            self.value <<= 8;
            self.bits += 8;
            self.eof = true;
        } else {
            self.bits = 0;
        }
        self
    }

    /// A bit that is 0 with the probability `prob / 256`.
    #[inline(always)]
    pub(super) fn get_bit(&mut self, prob: u8) -> bool {
        let mut range = self.range;
        if self.bits < 0 {
            self.load_new_bytes();
        }
        let pos = self.bits;
        let split = (range * u32::from(prob)) >> 8;
        let value = (self.value >> pos) as u32;
        let bit = value > split;
        if bit {
            range -= split + 1;
            self.value -= u64::from(split + 1) << pos;
        } else {
            range = split;
        }
        if let Some(&[shift, new_range]) = NORMALIZED.get(usize::from(range as u8)) {
            self.range = u32::from(new_range);
            self.bits -= i32::from(shift);
        }
        bit
    }

    /// `v` or `-v`, each as likely as the other.
    #[inline(always)]
    pub(super) fn get_signed(&mut self, v: i32) -> i32 {
        if self.bits < 0 {
            self.load_new_bytes();
        }
        let pos = self.bits;
        let split = self.range >> 1;
        let value = (self.value >> pos) as u32;
        let mask = (split.wrapping_sub(value) as i32) >> 31;
        self.bits -= 1;
        // Not what `get_bit(0x80)` does when `range` is 254 and the bit is 0: that leaves 127 and does not shift.
        self.range = self.range.wrapping_add(mask as u32) | 1;
        self.value -= u64::from((split + 1) & mask as u32) << pos;
        (v ^ mask) - mask
    }

    /// `VP8GetValue`: an unsigned number of `bits` bits.
    pub(super) fn get_value(&mut self, bits: u32) -> u32 {
        (0..bits).fold(0, |v, _| (v << 1) | u32::from(self.get_bit(0x80)))
    }

    /// `VP8Get`
    pub(super) fn get(&mut self) -> bool {
        self.get_bit(0x80)
    }

    /// `VP8GetSignedValue`: a number of `bits` bits, then its sign.
    pub(super) fn get_signed_value(&mut self, bits: u32) -> i32 {
        let value = self.get_value(bits) as i32;
        if self.get() { -value } else { value }
    }
}
