//! The zigzag order of the coefficients of a block (figure A.6 of the standard, jutils.c).

/// `NATURAL_ORDER[i]` is the row-major position of the `i`th coefficient in zigzag order.
#[rustfmt::skip]
pub(crate) const NATURAL_ORDER: [u8; 64] = [
    0, 1, 8, 16, 9, 2, 3, 10,
    17, 24, 32, 25, 18, 11, 4, 5,
    12, 19, 26, 33, 40, 48, 41, 34,
    27, 20, 13, 6, 7, 14, 21, 28,
    35, 42, 49, 56, 57, 50, 43, 36,
    29, 22, 15, 23, 30, 37, 44, 51,
    58, 59, 52, 45, 38, 31, 39, 46,
    53, 60, 61, 54, 47, 55, 62, 63,
];

/// A run length in damaged data can go past the end of the block, and lands on 63.
#[inline(always)]
pub(crate) fn natural_order(k: usize) -> usize {
    usize::from(NATURAL_ORDER.get(k).copied().unwrap_or(63))
}

/// `ZIGZAG_BITS[row][bits]` has a bit for each bit of `bits`: the place in zigzag order of that column of `row`.
#[allow(clippy::indexing_slicing, reason = "evaluated at compile time")]
static ZIGZAG_BITS: [[u64; 256]; 8] = {
    let mut place = [0u8; 64];
    let mut k = 0;
    while k < 64 {
        place[NATURAL_ORDER[k] as usize] = k as u8;
        k += 1;
    }
    let mut table = [[0u64; 256]; 8];
    let mut row = 0;
    while row < 8 {
        let mut bits = 0;
        while bits < 256 {
            let mut column = 0;
            while column < 8 {
                if bits >> column & 1 != 0 {
                    table[row][bits] |= 1 << place[row * 8 + column];
                }
                column += 1;
            }
            bits += 1;
        }
        row += 1;
    }
    table
};

/// A bit for each coefficient that is not zero, at its place in zigzag order.
#[inline(never)]
pub(crate) fn nonzero(coefs: &[[i16; 8]; 8]) -> u64 {
    let mut flags = [[0u8; 8]; 8];
    for (flag, &coef) in flags
        .as_flattened_mut()
        .iter_mut()
        .zip(coefs.as_flattened())
    {
        *flag = u8::from(coef != 0);
    }
    let mut nonzero = 0;
    for (flags, table) in flags.iter().zip(&ZIGZAG_BITS) {
        // The multiplication moves the low bit of byte `i` to bit `56 + i`, and nothing else gets there.
        let bits = u64::from_le_bytes(*flags).wrapping_mul(0x0102_0408_1020_4080) >> 56;
        nonzero |= table.get(bits as usize).copied().unwrap_or(0);
    }
    nonzero
}
