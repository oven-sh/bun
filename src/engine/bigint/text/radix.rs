use crate::digits::DigitDivisor;

/// The largest power of a radix that fits in a digit.
#[derive(Clone, Copy)]
pub(super) struct Chunk {
    pub(super) characters: usize,
    pub(super) power: u64,
}

pub(super) const CHUNKS: [Chunk; 37] = {
    let mut chunks = [Chunk {
        characters: 0,
        power: 1,
    }; 37];
    let mut radix = 2;
    while radix <= 36 {
        while let Some(power) = chunks[radix].power.checked_mul(radix as u64) {
            chunks[radix].power = power;
            chunks[radix].characters += 1;
        }
        radix += 1;
    }
    chunks
};

pub(super) static CHUNK_DIVISORS: [DigitDivisor; 37] = {
    let mut divisors = [DigitDivisor::new(1); 37];
    let mut radix = 2;
    while radix <= 36 {
        divisors[radix] = DigitDivisor::new(CHUNKS[radix].power);
        radix += 1;
    }
    divisors
};

/// `1 / log2(radix)` in units of 2^-32, rounded up.
pub(super) const CHARACTERS_PER_BIT: [u64; 37] = {
    let mut ratios = [0; 37];
    let mut radix = 2;
    while radix <= 36 {
        ratios[radix] = (1u128 << 72).div_ceil(log2_rounded_down(radix as u64) as u128) as u64;
        radix += 1;
    }
    ratios
};

/// In units of 2^-40. Each squaring of the significand yields one bit.
pub(super) const fn log2_rounded_down(value: u64) -> u64 {
    let mut logarithm = value.ilog2() as u64;
    let mut significand = value << value.leading_zeros();
    let mut bit = 0;
    while bit < 40 {
        let square = significand as u128 * significand as u128;
        let top_bit = (square >> 127) as u32;
        logarithm = logarithm << 1 | top_bit as u64;
        significand = (square >> (63 + top_bit)) as u64;
        bit += 1;
    }
    logarithm
}
