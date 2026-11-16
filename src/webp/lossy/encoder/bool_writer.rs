//! The arithmetic encoder of RFC 6386 section 7.

use core::hint::select_unpredictable;

use crate::array::At;
use crate::error::{Error, Result};
use crate::slice::InBounds;

/// Twice a probability, plus the bit.
#[derive(Clone, Copy)]
pub(super) struct Symbol(pub(super) u16);

impl Symbol {
    pub(super) const fn new(bit: bool, probability: u8) -> Self {
        Self((probability as u16) << 1 | bit as u16)
    }
}

/// What a `Symbol` does to the range, in a form that makes the way from one range to the next short.
struct Steps {
    /// In 65536ths of the range. The lower half: what remains, shifted. The upper half: all but what is skipped.
    factors: [u64; 512],
    /// The most that can remain if the shift is not enough.
    limits: [i32; 512],
    /// The bits that are shifted in.
    ones: [[u32; 2]; 512],
    /// What remains has to be shifted this far, or one bit further.
    shifts: [u8; 512],
}

#[expect(clippy::indexing_slicing, reason = "evaluated at compile time")]
static STEPS: Steps = {
    let mut steps = Steps {
        factors: [0; 512],
        limits: [0; 512],
        ones: [[0; 2]; 512],
        shifts: [0; 512],
    };
    let mut symbol = 0;
    while symbol < 512 {
        let probability = (symbol / 2) as u64;
        let (remains, kept) = if symbol % 2 == 0 {
            (probability << 8, 1 << 16)
        } else {
            let rest = ((256 - probability) << 8) - 1;
            (rest, rest)
        };
        let shift = ((((254 * remains) >> 16) + 1) as u8).leading_zeros();
        steps.factors[symbol] = remains << shift | kept << 32;
        steps.limits[symbol] = ((128 - (1 << shift)) << 16) - 1;
        steps.ones[symbol] = [(1 << shift) - 1, (2 << shift) - 1];
        steps.shifts[symbol] = shift as u8;
        symbol += 1;
    }
    steps
};

pub(super) struct BoolWriter {
    out: Vec<u8>,
    /// The bottom of the interval: 8 bits that `range` is added to, `pending_bits` above them, and a carry.
    value: u64,
    /// The range minus one, 127 to 254.
    range: u64,
    pending_bits: u32,
    is_out_of_memory: bool,
}

impl BoolWriter {
    /// Appends to `out`.
    pub(super) const fn new(out: Vec<u8>) -> Self {
        Self {
            out,
            value: 0,
            range: 254,
            pending_bits: 0,
            is_out_of_memory: false,
        }
    }

    /// `probability` out of 256 is that of `false`. Returns `bit`.
    #[inline(always)]
    pub(super) fn write(&mut self, bit: bool, probability: u8) -> bool {
        self.write_all([Symbol::new(bit, probability)]);
        bit
    }

    #[inline(always)]
    pub(super) fn write_all(&mut self, symbols: impl IntoIterator<Item = Symbol>) {
        let (mut value, mut range, mut pending_bits) = (self.value, self.range, self.pending_bits);
        for Symbol(symbol) in symbols {
            let products = range * STEPS.factors.at(symbol.into());
            value += range - (products >> 48);
            let remains = products as u32;
            let is_short = remains as i32 <= *STEPS.limits.at(symbol.into());
            let [ones, more_ones] = *STEPS.ones.at(symbol.into());
            range = select_unpredictable(is_short, remains >> 15 | more_ones, remains >> 16 | ones)
                .into();
            let shift = u32::from(*STEPS.shifts.at(symbol.into())) + u32::from(is_short);
            value <<= shift;
            pending_bits += shift;
            // With what stays behind, a carry into `out` is rare.
            if pending_bits > 40 {
                pending_bits -= 32;
                let kept = 8 + pending_bits;
                let [.., carry, b0, b1, b2, b3] = (value >> kept).to_be_bytes();
                value &= (1 << kept) - 1;
                if carry == 0 && self.out.capacity() - self.out.len() >= 4 {
                    self.out.extend_from_slice(&[b0, b1, b2, b3]);
                } else {
                    self.append(carry, &[b0, b1, b2, b3]);
                }
            }
        }
        (self.value, self.range, self.pending_bits) = (value, range, pending_bits);
    }

    #[cold]
    fn append(&mut self, carry: u8, bytes: &[u8]) {
        if carry != 0 {
            for byte in self.out.iter_mut().rev() {
                *byte = byte.wrapping_add(1);
                if *byte != 0 {
                    break;
                }
            }
        }
        if self.out.try_reserve(bytes.len()).is_ok() {
            self.out.extend_from_slice(bytes);
        } else {
            self.is_out_of_memory = true;
        }
    }

    pub(super) fn write_flag(&mut self, flag: bool) -> bool {
        self.write(flag, 128)
    }

    /// The highest bit comes first.
    pub(super) fn write_unsigned(&mut self, value: u8, bits: u32) {
        for bit in (0..bits).rev() {
            self.write_flag((value >> bit) & 1 != 0);
        }
    }

    /// Behind a flag that says whether it is other than zero.
    pub(super) fn write_optional_signed(&mut self, value: i8, bits: u32) {
        if self.write_flag(value != 0) {
            self.write_unsigned(value.unsigned_abs(), bits);
            self.write_flag(value < 0);
        }
    }

    // https://github.com/webmproject/libwebp/blob/4fa21912338357f89e4fd51cf2368325b59e9bd9/src/utils/bit_writer_utils.c#L175
    pub(super) fn finish(mut self) -> Result<Vec<u8>> {
        let [carry, bytes @ ..] = (self.value << (48 - self.pending_bits)).to_be_bytes();
        let len = self.pending_bits.div_ceil(8).max(1) as usize + 2;
        self.append(carry, bytes.part(..len));
        if self.is_out_of_memory {
            return Err(Error::Alloc(bun_alloc::AllocError));
        }
        Ok(self.out)
    }
}
