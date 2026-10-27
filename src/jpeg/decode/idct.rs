//! Dequantization and the inverse DCT, at every output size from 1x1 to 14x14 that scaling needs (jddctmgr.c,
//! jidctint.c, jidctred.c).
//!
//! All sizes give what libjpeg-turbo gave on x86-64, bit for bit, whatever the coefficients. For coefficients that an
//! encoder can produce there is only one answer. For others it depends on where the arithmetic wraps or saturates:
//! - 8x8, 4x4 and 2x2 ran as SSE2 or AVX2 assembly, which works on 16-bit lanes. `idct8x8`, `idct4x4` and `idct2x2` do
//!   what those instructions do, lane by lane, in a form that compilers turn back into vector code.
//! - The other sizes ran as C with 64-bit `long`.

use super::Block;
use crate::lanes::{column, descale, from_columns, map, transpose};
use crate::tables::dct::*;
use core::ops::{Add, Mul, Shl, Sub};

const fn fix(x: f64) -> i32 {
    (x * (1 << CONST_BITS) as f64 + 0.5) as i32
}

/// The multipliers of a component, in row-major order. libjpeg keeps them in a `short`.
pub(crate) type DctTable = [i16; 64];

pub(crate) fn dct_table(quant: &[u16; 64]) -> DctTable {
    quant.map(|q| q as i16)
}

fn rows<T>(block: &[T; 64]) -> &[[T; 8]] {
    block.as_chunks::<8>().0
}

// ---- The sizes that ran as assembly. See `lanes`.

/// packsswb and paddb with 128.
#[inline(always)]
fn to_sample(a: i16) -> u8 {
    (a.clamp(-128, 127) + 128) as u8
}

/// pmullw of column `lane` of the coefficients and their multipliers.
#[inline(always)]
fn dequantize(coefs: &Block, table: &DctTable, lane: usize) -> [i16; 8] {
    let at = |block: &[i16; 64], row: usize| block.get(row * 8 + lane).copied().unwrap_or(0);
    core::array::from_fn(|row| at(coefs, row).wrapping_mul(at(table, row)))
}

/// Whether the coefficients in the rows and columns picked by `mask`, a bit for each in row-major order, are all zero.
#[inline(always)]
fn all_zero(coefs: &Block, mask: u64) -> bool {
    // Four at a time: masks are made of whole groups.
    let (quads, _) = coefs.as_chunks::<4>();
    let mut any = 0u64;
    for (i, quad) in quads.iter().enumerate() {
        let [a, b, c, d] = quad.map(|coef| u64::from(coef as u16));
        if (mask >> (i * 4)) & 15 != 0 {
            any |= a | b << 16 | c << 32 | d << 48;
        }
    }
    any == 0
}

const fn rows_mask(rows: u64) -> u64 {
    let mut mask = 0;
    let mut row = 0;
    while row < 8 {
        if rows >> row & 1 != 0 {
            mask |= 0xff << (row * 8);
        }
        row += 1;
    }
    mask
}

#[inline(always)]
fn idct8([in0, in1, in2, in3, in4, in5, in6, in7]: [i16; 8], shift: u32) -> [i16; 8] {
    let wide = i32::from;
    // pmaddwd. With these constants the sum of the two products cannot overflow.
    let madd = |a: i16, ca: i32, b: i16, cb: i32| wide(a) * ca + wide(b) * cb;
    let round = 1 << (shift - 1);

    let tmp3 = madd(in2, F_0_541 + F_0_765, in6, F_0_541);
    let tmp2 = madd(in2, F_0_541, in6, F_0_541 - F_1_847);
    let tmp0 = (wide(in0.wrapping_add(in4)) << CONST_BITS) + round;
    let tmp1 = (wide(in0.wrapping_sub(in4)) << CONST_BITS) + round;
    let tmp10 = tmp0.wrapping_add(tmp3);
    let tmp13 = tmp0.wrapping_sub(tmp3);
    let tmp11 = tmp1.wrapping_add(tmp2);
    let tmp12 = tmp1.wrapping_sub(tmp2);

    let z3 = in3.wrapping_add(in7);
    let z4 = in1.wrapping_add(in5);
    let (z3, z4) = (
        madd(z3, F_1_175 - F_1_961, z4, F_1_175),
        madd(z3, F_1_175, z4, F_1_175 - F_0_390),
    );
    let tmp0 = madd(in7, F_0_298 - F_0_899, in1, -F_0_899).wrapping_add(z3);
    let tmp3 = madd(in7, -F_0_899, in1, F_1_501 - F_0_899).wrapping_add(z4);
    let tmp1 = madd(in5, F_2_053 - F_2_562, in3, -F_2_562).wrapping_add(z4);
    let tmp2 = madd(in5, -F_2_562, in3, F_3_072 - F_2_562).wrapping_add(z3);

    map(
        [
            tmp10.wrapping_add(tmp3),
            tmp11.wrapping_add(tmp2),
            tmp12.wrapping_add(tmp1),
            tmp13.wrapping_add(tmp0),
            tmp13.wrapping_sub(tmp0),
            tmp12.wrapping_sub(tmp1),
            tmp11.wrapping_sub(tmp2),
            tmp10.wrapping_sub(tmp3),
        ],
        |sum| descale(sum, shift),
    )
}

/// `idct8` of four numbers and four zeros.
#[inline(always)]
fn idct8_of_4([in0, in1, in2, in3]: [i16; 4], shift: u32) -> [i16; 8] {
    idct8([in0, in1, in2, in3, 0, 0, 0, 0], shift)
}

const PASS1_SHIFT: u32 = CONST_BITS - PASS1_BITS;
const PASS2_SHIFT: u32 = CONST_BITS + PASS1_BITS + 3;

#[inline(never)]
fn idct8x8_pass1(coefs: &Block, table: &DctTable) -> [[i16; 8]; 8] {
    from_columns(|lane| idct8(dequantize(coefs, table, lane), PASS1_SHIFT))
}

/// Each column of `rows` is a row of the block, and so it is with the result.
#[inline(never)]
fn idct8x8_pass2(rows: &[[i16; 8]; 8]) -> [[u8; 8]; 8] {
    from_columns(|lane| map(idct8(column(rows, lane), PASS2_SHIFT), to_sample))
}

/// Of the upper left quarter of the block.
#[inline(never)]
fn idct8x8_pass1_of_4x4(coefs: &Block, table: &DctTable) -> [[i16; 4]; 8] {
    from_columns(|lane| {
        let [in0, in1, in2, in3, ..] = dequantize(coefs, table, lane);
        idct8_of_4([in0, in1, in2, in3], PASS1_SHIFT)
    })
}

#[inline(never)]
fn idct8x8_pass2_of_4(rows: &[[i16; 8]; 4]) -> [[u8; 8]; 8] {
    from_columns(|lane| map(idct8_of_4(column(rows, lane), PASS2_SHIFT), to_sample))
}

pub(crate) fn idct8x8(coefs: &Block, table: &DctTable) -> [[u8; 8]; 8] {
    const RIGHT_HALF: u64 = 0xf0f0_f0f0_f0f0_f0f0;

    if all_zero(coefs, rows_mask(0b1111_1110)) {
        // The assembly has this shortcut, which wraps where the full computation saturates. All the rows are the same.
        let row = core::array::from_fn(|lane| {
            let [dc, ..] = dequantize(coefs, table, lane);
            dc.wrapping_shl(PASS1_BITS)
        });
        return [idct8(row, PASS2_SHIFT).map(to_sample); 8];
    }

    // Most blocks of most images have nothing but low frequencies. What is left out here is sums of zeros.
    let transposed = if all_zero(coefs, rows_mask(0b1111_0000) | RIGHT_HALF) {
        idct8x8_pass2_of_4(&transpose(&idct8x8_pass1_of_4x4(coefs, table)))
    } else {
        idct8x8_pass2(&transpose(&idct8x8_pass1(coefs, table)))
    };
    transpose(&transposed)
}

/// Row or column 4 has no part in a 4-point result.
#[inline(always)]
fn idct4([in0, in1, in2, in3, in5, in6, in7]: [i16; 7], shift: u32) -> [i16; 4] {
    const F_0_211: i32 = 1730;
    const F_0_509: i32 = 4176;
    const F_0_601: i32 = 4926;
    const F_1_061: i32 = 8697;
    const F_1_451: i32 = 11893;
    const F_2_172: i32 = 17799;

    let wide = i32::from;
    let madd = |a: i16, ca: i32, b: i16, cb: i32| wide(a) * ca + wide(b) * cb;

    let tmp2 = madd(in5, -F_0_601, in7, -F_0_509).wrapping_add(madd(in1, F_2_562, in3, F_0_899));
    let tmp0 = madd(in5, F_1_451, in7, -F_0_211).wrapping_add(madd(in1, F_1_061, in3, -F_2_172));
    let even0 = (wide(in0) << (CONST_BITS + 1)) + (1 << (shift - 1));
    let even2 = madd(in2, F_1_847, in6, -F_0_765);
    let tmp10 = even0.wrapping_add(even2);
    let tmp12 = even0.wrapping_sub(even2);
    map(
        [
            tmp10.wrapping_add(tmp2),
            tmp12.wrapping_add(tmp0),
            tmp12.wrapping_sub(tmp0),
            tmp10.wrapping_sub(tmp2),
        ],
        |sum| descale(sum, shift),
    )
}

#[inline(never)]
fn idct4x4_pass1(coefs: &Block, table: &DctTable) -> [[i16; 8]; 4] {
    from_columns(|lane| {
        let [in0, in1, in2, in3, _, in5, in6, in7] = dequantize(coefs, table, lane);
        idct4([in0, in1, in2, in3, in5, in6, in7], PASS1_SHIFT + 1)
    })
}

#[inline(never)]
fn idct4x4_pass2(rows: &[[i16; 4]; 8]) -> [[u8; 4]; 4] {
    from_columns(|lane| {
        let [in0, in1, in2, in3, _, in5, in6, in7] = column(rows, lane);
        map(
            idct4([in0, in1, in2, in3, in5, in6, in7], PASS2_SHIFT + 1),
            to_sample,
        )
    })
}

pub(crate) fn idct4x4(coefs: &Block, table: &DctTable) -> [[u8; 4]; 4] {
    if all_zero(coefs, rows_mask(0b1110_1110)) {
        let row = [0, 1, 2, 3, 5, 6, 7].map(|lane| {
            let [dc, ..] = dequantize(coefs, table, lane);
            dc.wrapping_shl(PASS1_BITS)
        });
        return [idct4(row, PASS2_SHIFT + 1).map(to_sample); 4];
    }
    transpose(&idct4x4_pass2(&transpose(&idct4x4_pass1(coefs, table))))
}

pub(crate) fn idct2x2(coefs: &Block, table: &DctTable) -> [[u8; 2]; 2] {
    const F_0_720: i32 = 5906;
    const F_0_850: i32 = 6967;
    const F_1_272: i32 = 10426;
    const F_3_624: i32 = 29692;
    const DESCALE_P1: u32 = PASS1_SHIFT + 2;
    const DESCALE_P2: u32 = PASS2_SHIFT + 2;

    let round_shift = |v: i32, n: u32| v.wrapping_add(1 << (n - 1)) >> n;

    let mut workspace = [[0i32; 8]; 2];
    let [upper, lower] = &mut workspace;
    for (lane, (upper, lower)) in upper.iter_mut().zip(lower).enumerate() {
        let [in0, in1, _, in3, _, in5, _, in7] = dequantize(coefs, table, lane).map(i32::from);
        let tmp0 = (in1 * F_3_624 - in3 * F_1_272).wrapping_add(in5 * F_0_850 - in7 * F_0_720);
        let tmp10 = in0 << (CONST_BITS + 2);
        *upper = round_shift(tmp10.wrapping_add(tmp0), DESCALE_P1);
        *lower = round_shift(tmp10.wrapping_sub(tmp0), DESCALE_P1);
    }

    workspace.map(|[c0, c1, _, c3, _, c5, _, c7]| {
        // Column 0 stays 32 bits wide, the others are packed with saturation.
        let [c1, c3, c5, c7] = [c1, c3, c5, c7].map(|v| v.clamp(-32768, 32767));
        let tmp0 = (c1 * F_3_624 - c3 * F_1_272).wrapping_add(c5 * F_0_850 - c7 * F_0_720);
        let tmp10 = c0.wrapping_shl(CONST_BITS + 2);
        [tmp10.wrapping_add(tmp0), tmp10.wrapping_sub(tmp0)]
            .map(|v| to_sample(round_shift(v, DESCALE_P2) as i16))
    })
}

// ---- The sizes that ran as C.

/// `sample_range_limit[CENTERJSAMPLE + (x & RANGE_MASK)]`: `x + 128` clamped to a byte, for the `x` from -512 to 511 that
/// has the same low 10 bits.
#[inline(always)]
fn range_limit(x: i32) -> u8 {
    let x = ((x & 1023) ^ 512) - 512;
    (x + 128).clamp(0, 255) as u8
}

pub(crate) fn idct1x1(coefs: &Block, table: &DctTable) -> [[u8; 1]; 1] {
    let ([dc, ..], [q, ..]) = (coefs, table);
    let dc = i32::from(*dc) * i32::from(*q);
    // The sum is computed in a `long`.
    [[range_limit(((i64::from(dc) + 4) >> 3) as i32)]]
}

/// An integer that wraps around.
trait Int:
    Copy
    + Default
    + Add<Output = Self>
    + Sub<Output = Self>
    + Mul<i32, Output = Self>
    + Shl<u32, Output = Self>
{
    fn from_i32(v: i32) -> Self;
    /// The low 32 bits of `self >> n`.
    fn shr(self, n: u32) -> i32;
}

macro_rules! int {
    ($name:ident, $inner:ty) => {
        #[derive(Clone, Copy, Default)]
        struct $name($inner);
        impl Add for $name {
            type Output = Self;
            #[inline(always)]
            fn add(self, other: Self) -> Self {
                Self(self.0.wrapping_add(other.0))
            }
        }
        impl Sub for $name {
            type Output = Self;
            #[inline(always)]
            fn sub(self, other: Self) -> Self {
                Self(self.0.wrapping_sub(other.0))
            }
        }
        impl Mul<i32> for $name {
            type Output = Self;
            #[inline(always)]
            fn mul(self, other: i32) -> Self {
                Self(self.0.wrapping_mul(<$inner>::from(other)))
            }
        }
        impl Shl<u32> for $name {
            type Output = Self;
            #[inline(always)]
            fn shl(self, n: u32) -> Self {
                Self(self.0.wrapping_shl(n))
            }
        }
        impl Int for $name {
            #[inline(always)]
            fn from_i32(v: i32) -> Self {
                Self(<$inner>::from(v))
            }
            #[inline(always)]
            fn shr(self, n: u32) -> i32 {
                (self.0 >> n) as i32
            }
        }
    };
}
int!(W32, i32);
int!(W64, i64);

/// One pass over one row or column: `f` is the transform before its final shift. The first input comes with the scale
/// and the rounding of the result already in it.
#[inline(always)]
fn pass<T: Int, const K: usize, const N: usize>(
    input: &[i32; K],
    shift: u32,
    f: impl Fn([T; K]) -> [T; N],
) -> [i32; N] {
    let mut x = map(*input, T::from_i32);
    if let Some(dc) = x.first_mut() {
        *dc = (*dc << CONST_BITS) + T::from_i32(1 << (shift - 1));
    }
    map(f(x), |v| v.shr(shift))
}

/// The sums of the first pass fit in 32 bits if its inputs are smaller than this. A sum is linear in the inputs, and the
/// magnitudes of its factors add up to less than `10 << CONST_BITS` in every transform below (9.7 in `idct14`). What
/// wraps on the way to a sum that fits does no harm.
const MAX_INPUT_FOR_32_BITS: i32 = 1 << 14;

#[inline(never)]
fn scaled_pass1<T: Int, const K: usize, const N: usize>(
    input: &[[i32; 8]; K],
    f: impl Fn([T; K]) -> [T; N],
) -> [[i32; 8]; N] {
    from_columns(|lane| pass(&column(input, lane), PASS1_SHIFT, &f))
}

/// Each column of `rows` is a row of the block, and so it is with the result.
#[inline(never)]
fn scaled_pass2<const K: usize, const N: usize, const LANES: usize>(
    rows: &[[i32; LANES]; K],
    f: impl Fn([W32; K]) -> [W32; N],
) -> [[u8; LANES]; N] {
    from_columns(|lane| map(pass(&column(rows, lane), PASS2_SHIFT, &f), range_limit))
}

/// `K` is how many rows and columns of the block have a part in the result, and `LANES` is `N` rounded up.
#[inline(always)]
fn scaled<const K: usize, const N: usize, const LANES: usize>(
    coefs: &Block,
    table: &DctTable,
    narrow: impl Fn([W32; K]) -> [W32; N],
    wide: impl Fn([W64; K]) -> [W64; N],
) -> [[u8; N]; N] {
    // With the columns that have no part in the result, for the sake of the vector code.
    let mut input = [[0i32; 8]; K];
    let mut largest = 0;
    for ((input, coefs), table) in input.iter_mut().zip(rows(coefs)).zip(rows(table)) {
        for ((input, &coef), &q) in input.iter_mut().zip(coefs).zip(table) {
            *input = i32::from(coef) * i32::from(q);
            largest |= input.unsigned_abs();
        }
    }

    // The second pass keeps bits 18 to 27 of its sums, which 32-bit arithmetic gets right whatever is above them. They
    // depend on more bits of the first pass's sums than 32-bit arithmetic has, unless those sums fit.
    let workspace = if largest < MAX_INPUT_FOR_32_BITS as u32 {
        scaled_pass1(&input, &narrow)
    } else {
        scaled_pass1(&input, &wide)
    };
    let rows: [[i32; LANES]; K] = transpose(&workspace);
    transpose(&scaled_pass2(&rows, &narrow))
}

macro_rules! scaled_idct {
    ($name:ident, $f:ident, $n:literal, $lanes:literal) => {
        pub(crate) fn $name(coefs: &Block, table: &DctTable) -> [[u8; $n]; $n] {
            scaled::<_, $n, $lanes>(coefs, table, $f, $f)
        }
    };
}
scaled_idct!(idct3x3, idct3, 3, 4);
scaled_idct!(idct5x5, idct5, 5, 8);
scaled_idct!(idct6x6, idct6, 6, 8);
scaled_idct!(idct7x7, idct7, 7, 8);
scaled_idct!(idct10x10, idct10, 10, 12);
scaled_idct!(idct12x12, idct12, 12, 12);
scaled_idct!(idct14x14, idct14, 14, 16);

// The transforms below are jidctint.c's, statement by statement.

#[inline(always)]
fn idct3<T: Int>([dc, x1, x2]: [T; 3]) -> [T; 3] {
    let tmp0 = dc;
    let tmp2 = x2;
    let tmp12 = tmp2 * fix(0.707106781);
    let tmp10 = tmp0 + tmp12;
    let tmp2 = tmp0 - tmp12 - tmp12;
    let tmp12 = x1;
    let tmp0 = tmp12 * fix(1.224744871);
    [tmp10 + tmp0, tmp2, tmp10 - tmp0]
}

#[inline(always)]
fn idct5<T: Int>([dc, x1, x2, x3, x4]: [T; 5]) -> [T; 5] {
    let tmp12 = dc;
    let tmp0 = x2;
    let tmp1 = x4;
    let z1 = (tmp0 + tmp1) * fix(0.790569415);
    let z2 = (tmp0 - tmp1) * fix(0.353553391);
    let z3 = tmp12 + z2;
    let tmp10 = z3 + z1;
    let tmp11 = z3 - z1;
    let tmp12 = tmp12 - (z2 << 2);
    let z2 = x1;
    let z3 = x3;
    let z1 = (z2 + z3) * fix(0.831253876);
    let tmp0 = z1 + z2 * fix(0.513743148);
    let tmp1 = z1 - z3 * fix(2.176250899);
    [
        tmp10 + tmp0,
        tmp11 + tmp1,
        tmp12,
        tmp11 - tmp1,
        tmp10 - tmp0,
    ]
}

#[inline(always)]
fn idct6<T: Int>([dc, x1, x2, x3, x4, x5]: [T; 6]) -> [T; 6] {
    let tmp0 = dc;
    let tmp2 = x4;
    let tmp10 = tmp2 * fix(0.707106781);
    let tmp1 = tmp0 + tmp10;
    let tmp11 = tmp0 - tmp10 - tmp10;
    let tmp10 = x2;
    let tmp0 = tmp10 * fix(1.224744871);
    let tmp10 = tmp1 + tmp0;
    let tmp12 = tmp1 - tmp0;
    let z1 = x1;
    let z2 = x3;
    let z3 = x5;
    let tmp1 = (z1 + z3) * fix(0.366025404);
    let tmp0 = tmp1 + ((z1 + z2) << CONST_BITS);
    let tmp2 = tmp1 + ((z3 - z2) << CONST_BITS);
    let tmp1 = (z1 - z2 - z3) << CONST_BITS;
    [
        tmp10 + tmp0,
        tmp11 + tmp1,
        tmp12 + tmp2,
        tmp12 - tmp2,
        tmp11 - tmp1,
        tmp10 - tmp0,
    ]
}

#[inline(always)]
fn idct7<T: Int>([dc, x1, x2, x3, x4, x5, x6]: [T; 7]) -> [T; 7] {
    let tmp13 = dc;
    let z1 = x2;
    let z2 = x4;
    let z3 = x6;
    let tmp10 = (z2 - z3) * fix(0.881747734);
    let tmp12 = (z1 - z2) * fix(0.314692123);
    let tmp11 = tmp10 + tmp12 + tmp13 - z2 * fix(1.841218003);
    let tmp0 = z1 + z3;
    let z2 = z2 - tmp0;
    let tmp0 = tmp0 * fix(1.274162392) + tmp13;
    let tmp10 = tmp10 + (tmp0 - z3 * fix(0.077722536));
    let tmp12 = tmp12 + (tmp0 - z1 * fix(2.470602249));
    let tmp13 = tmp13 + (z2 * fix(1.414213562));
    let z1 = x1;
    let z2 = x3;
    let z3 = x5;
    let tmp1 = (z1 + z2) * fix(0.935414347);
    let tmp2 = (z1 - z2) * fix(0.170262339);
    let tmp0 = tmp1 - tmp2;
    let tmp1 = tmp1 + tmp2;
    let tmp2 = (z2 + z3) * -fix(1.378756276);
    let tmp1 = tmp1 + tmp2;
    let z2 = (z1 + z3) * fix(0.613604268);
    let tmp0 = tmp0 + z2;
    let tmp2 = tmp2 + (z2 + z3 * fix(1.870828693));
    [
        tmp10 + tmp0,
        tmp11 + tmp1,
        tmp12 + tmp2,
        tmp13,
        tmp12 - tmp2,
        tmp11 - tmp1,
        tmp10 - tmp0,
    ]
}

#[inline(always)]
fn idct10<T: Int>([dc, x1, x2, x3, x4, x5, x6, x7]: [T; 8]) -> [T; 10] {
    let z3 = dc;
    let z4 = x4;
    let z1 = z4 * fix(1.144122806);
    let z2 = z4 * fix(0.437016024);
    let tmp10 = z3 + z1;
    let tmp11 = z3 - z2;
    let tmp22 = z3 - ((z1 - z2) << 1);
    let z2 = x2;
    let z3 = x6;
    let z1 = (z2 + z3) * fix(0.831253876);
    let tmp12 = z1 + z2 * fix(0.513743148);
    let tmp13 = z1 - z3 * fix(2.176250899);
    let tmp20 = tmp10 + tmp12;
    let tmp24 = tmp10 - tmp12;
    let tmp21 = tmp11 + tmp13;
    let tmp23 = tmp11 - tmp13;
    let z1 = x1;
    let z2 = x3;
    let z3 = x5;
    let z3 = z3 << CONST_BITS;
    let z4 = x7;
    let tmp11 = z2 + z4;
    let tmp13 = z2 - z4;
    let tmp12 = tmp13 * fix(0.309016994);
    let z2 = tmp11 * fix(0.951056516);
    let z4 = z3 + tmp12;
    let tmp10 = z1 * fix(1.396802247) + z2 + z4;
    let tmp14 = z1 * fix(0.221231742) - z2 + z4;
    let z2 = tmp11 * fix(0.587785252);
    let z4 = z3 - tmp12 - (tmp13 << (CONST_BITS - 1));
    let tmp12 = ((z1 - tmp13) << CONST_BITS) - z3;
    let tmp11 = z1 * fix(1.260073511) - z2 - z4;
    let tmp13 = z1 * fix(0.642039522) - z2 + z4;
    [
        tmp20 + tmp10,
        tmp21 + tmp11,
        tmp22 + tmp12,
        tmp23 + tmp13,
        tmp24 + tmp14,
        tmp24 - tmp14,
        tmp23 - tmp13,
        tmp22 - tmp12,
        tmp21 - tmp11,
        tmp20 - tmp10,
    ]
}

#[inline(always)]
fn idct12<T: Int>([dc, x1, x2, x3, x4, x5, x6, x7]: [T; 8]) -> [T; 12] {
    let z3 = dc;
    let z4 = x4;
    let z4 = z4 * fix(1.224744871);
    let tmp10 = z3 + z4;
    let tmp11 = z3 - z4;
    let z1 = x2;
    let z4 = z1 * fix(1.366025404);
    let z1 = z1 << CONST_BITS;
    let z2 = x6;
    let z2 = z2 << CONST_BITS;
    let tmp12 = z1 - z2;
    let tmp21 = z3 + tmp12;
    let tmp24 = z3 - tmp12;
    let tmp12 = z4 + z2;
    let tmp20 = tmp10 + tmp12;
    let tmp25 = tmp10 - tmp12;
    let tmp12 = z4 - z1 - z2;
    let tmp22 = tmp11 + tmp12;
    let tmp23 = tmp11 - tmp12;
    let z1 = x1;
    let z2 = x3;
    let z3 = x5;
    let z4 = x7;
    let tmp11 = z2 * fix(1.306562965);
    let tmp14 = z2 * -F_0_541;
    let tmp10 = z1 + z3;
    let tmp15 = (tmp10 + z4) * fix(0.860918669);
    let tmp12 = tmp15 + tmp10 * fix(0.261052384);
    let tmp10 = tmp12 + tmp11 + z1 * fix(0.280143716);
    let tmp13 = (z3 + z4) * -fix(1.045510580);
    let tmp12 = tmp12 + (tmp13 + tmp14 - z3 * fix(1.478575242));
    let tmp13 = tmp13 + (tmp15 - tmp11 + z4 * fix(1.586706681));
    let tmp15 = tmp15 + (tmp14 - z1 * fix(0.676326758) - z4 * fix(1.982889723));
    let z1 = z1 - z4;
    let z2 = z2 - z3;
    let z3 = (z1 + z2) * F_0_541;
    let tmp11 = z3 + z1 * F_0_765;
    let tmp14 = z3 - z2 * F_1_847;
    [
        tmp20 + tmp10,
        tmp21 + tmp11,
        tmp22 + tmp12,
        tmp23 + tmp13,
        tmp24 + tmp14,
        tmp25 + tmp15,
        tmp25 - tmp15,
        tmp24 - tmp14,
        tmp23 - tmp13,
        tmp22 - tmp12,
        tmp21 - tmp11,
        tmp20 - tmp10,
    ]
}

#[inline(always)]
fn idct14<T: Int>([dc, x1, x2, x3, x4, x5, x6, x7]: [T; 8]) -> [T; 14] {
    let z1 = dc;
    let z4 = x4;
    let z2 = z4 * fix(1.274162392);
    let z3 = z4 * fix(0.314692123);
    let z4 = z4 * fix(0.881747734);
    let tmp10 = z1 + z2;
    let tmp11 = z1 + z3;
    let tmp12 = z1 - z4;
    let tmp23 = z1 - ((z2 + z3 - z4) << 1);
    let z1 = x2;
    let z2 = x6;
    let z3 = (z1 + z2) * fix(1.105676686);
    let tmp13 = z3 + z1 * fix(0.273079590);
    let tmp14 = z3 - z2 * fix(1.719280954);
    let tmp15 = z1 * fix(0.613604268) - z2 * fix(1.378756276);
    let tmp20 = tmp10 + tmp13;
    let tmp26 = tmp10 - tmp13;
    let tmp21 = tmp11 + tmp14;
    let tmp25 = tmp11 - tmp14;
    let tmp22 = tmp12 + tmp15;
    let tmp24 = tmp12 - tmp15;
    let z1 = x1;
    let z2 = x3;
    let z3 = x5;
    let z4 = x7;
    let z4 = z4 << CONST_BITS;
    let tmp14 = z1 + z3;
    let tmp11 = (z1 + z2) * fix(1.334852607);
    let tmp12 = tmp14 * fix(1.197448846);
    let tmp10 = tmp11 + tmp12 + z4 - z1 * fix(1.126980169);
    let tmp14 = tmp14 * fix(0.752406978);
    let tmp16 = tmp14 - z1 * fix(1.061150426);
    let z1 = z1 - z2;
    let tmp15 = z1 * fix(0.467085129) - z4;
    let tmp16 = tmp16 + tmp15;
    let tmp13 = (z2 + z3) * -fix(0.158341681) - z4;
    let tmp11 = tmp11 + (tmp13 - z2 * fix(0.424103948));
    let tmp12 = tmp12 + (tmp13 - z3 * fix(2.373959773));
    let tmp13 = (z3 - z2) * fix(1.405321284);
    let tmp14 = tmp14 + (tmp13 + z4 - z3 * fix(1.6906431334));
    let tmp15 = tmp15 + (tmp13 + z2 * fix(0.674957567));
    let tmp13 = ((z1 - z3) << CONST_BITS) + z4;
    [
        tmp20 + tmp10,
        tmp21 + tmp11,
        tmp22 + tmp12,
        tmp23 + tmp13,
        tmp24 + tmp14,
        tmp25 + tmp15,
        tmp26 + tmp16,
        tmp26 - tmp16,
        tmp25 - tmp15,
        tmp24 - tmp14,
        tmp23 - tmp13,
        tmp22 - tmp12,
        tmp21 - tmp11,
        tmp20 - tmp10,
    ]
}
