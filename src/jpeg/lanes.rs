//! How the DCTs get to be vector code without a vector in sight.
//!
//! A transform of one dimension is written for one column of a matrix, with the widths, wrapping and saturation of one
//! lane of libjpeg-turbo's assembly. `from_columns` runs it on every column, and the compiler turns that loop into vector
//! code with a lane for each column. It only does so if that is all there is to the function. With a transposition in the
//! same function it goes about it the wrong way and ends up with scalar code several times as slow. So every pass and
//! every transposition is a function of its own, and `#[inline(never)]`.

use crate::tables::NATURAL_ORDER;

/// psrad by `shift` of a sum that has the rounding in it already, and packssdw.
#[inline(always)]
pub(crate) fn descale(sum: i32, shift: u32) -> i16 {
    (sum >> shift).clamp(-32768, 32767) as i16
}

/// A matrix whose column `lane` is `column(lane)`.
#[inline(always)]
pub(crate) fn from_columns<T: Copy + Default, const R: usize, const C: usize>(
    column: impl Fn(usize) -> [T; R],
) -> [[T; C]; R] {
    let mut out = [[T::default(); C]; R];
    for lane in 0..C {
        for (row, v) in out.iter_mut().zip(column(lane)) {
            if let Some(out) = row.get_mut(lane) {
                *out = v;
            }
        }
    }
    out
}

/// `array::map`, which is not always inlined.
#[inline(always)]
pub(crate) fn map<A: Copy, B: Copy + Default, const N: usize>(
    array: [A; N],
    f: impl Fn(A) -> B,
) -> [B; N] {
    let mut out = [B::default(); N];
    for (out, v) in out.iter_mut().zip(array) {
        *out = f(v);
    }
    out
}

/// The first `N` numbers of column `lane`.
#[inline(always)]
pub(crate) fn column<T: Copy + Default, const N: usize, const R: usize, const C: usize>(
    m: &[[T; C]; R],
    lane: usize,
) -> [T; N] {
    let mut out = [T::default(); N];
    for (out, row) in out.iter_mut().zip(m) {
        *out = row.get(lane).copied().unwrap_or_default();
    }
    out
}

/// What does not fit in the result is left out, and what is not there is 0. A number of columns that is a multiple of 4
/// makes for better vector code in what follows.
#[inline(never)]
pub(crate) fn transpose<
    T: Copy + Default,
    const R: usize,
    const C: usize,
    const R2: usize,
    const C2: usize,
>(
    m: &[[T; C]; R],
) -> [[T; C2]; R2] {
    let mut out = [[T::default(); C2]; R2];
    for (r, row) in m.iter().enumerate() {
        for (out, &v) in out.iter_mut().zip(row) {
            if let Some(out) = out.get_mut(r) {
                *out = v;
            }
        }
    }
    out
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
