//! Dequantization and the inverse DCT, at every output size from 1x1 to 14x14 that scaling needs (jddctmgr.c,
//! jidctint.c, jidctred.c).
//!
//! All sizes give what libjpeg-turbo gave on x86-64, bit for bit, whatever the coefficients. For coefficients that an
//! encoder can produce there is only one answer. For others it depends on where the arithmetic wraps or saturates:
//! - 8x8, 4x4 and 2x2 ran as SSE2 or AVX2 assembly, which works on 16-bit lanes. `idct8x8`, `idct4x4` and `idct2x2` do
//!   what those instructions do, lane by lane, in a form that compilers turn back into vector code.
//! - The other sizes ran as C with 64-bit `long`.

use super::Block;
use crate::lanes::{I16x8, add16, add32, descale, madd, mul16, sub16, sub32, transpose, widen_shl};
use core::ops::{Add, Mul, Shl, Sub};

const CONST_BITS: u32 = 13;
const PASS1_BITS: u32 = 2;

const fn fix(x: f64) -> i32 {
    (x * (1 << CONST_BITS) as f64 + 0.5) as i32
}

const FIX_0_541196100: i32 = fix(0.541196100);
const FIX_0_765366865: i32 = fix(0.765366865);
const FIX_1_847759065: i32 = fix(1.847759065);

/// The multipliers of a component, in row-major order. libjpeg keeps them in a `short`.
pub(crate) type DctTable = [i16; 64];

pub(crate) fn dct_table(quant: &[u16; 64]) -> DctTable {
    quant.map(|q| q as i16)
}

fn rows<T>(block: &[T; 64]) -> &[[T; 8]] {
    block.as_chunks::<8>().0
}

/// packsswb and paddb with 128.
#[inline(always)]
fn to_sample(a: i16) -> u8 {
    (a.clamp(-128, 127) + 128) as u8
}

/// The rows of the block times their multipliers, and whether the rows picked by `ac_rows` are all zero.
#[inline(always)]
fn dequantize(coefs: &Block, table: &DctTable, ac_rows: [bool; 8]) -> ([I16x8; 8], bool) {
    let mut out = [[0i16; 8]; 8];
    let mut ac = 0i16;
    for (((out, coefs), table), is_ac) in out
        .iter_mut()
        .zip(rows(coefs))
        .zip(rows(table))
        .zip(ac_rows)
    {
        *out = mul16(*coefs, *table);
        if is_ac {
            ac |= coefs.iter().fold(0, |acc, &c| acc | c);
        }
    }
    (out, ac == 0)
}

#[inline(always)]
fn idct8_pass([in0, in1, in2, in3, in4, in5, in6, in7]: [I16x8; 8], shift: u32) -> [I16x8; 8] {
    const F_0_298: i32 = 2446;
    const F_0_390: i32 = 3196;
    const F_0_541: i32 = 4433;
    const F_0_765: i32 = 6270;
    const F_0_899: i32 = 7373;
    const F_1_175: i32 = 9633;
    const F_1_501: i32 = 12299;
    const F_1_847: i32 = 15137;
    const F_1_961: i32 = 16069;
    const F_2_053: i32 = 16819;
    const F_2_562: i32 = 20995;
    const F_3_072: i32 = 25172;

    let tmp3 = madd(in2, F_0_541 + F_0_765, in6, F_0_541);
    let tmp2 = madd(in2, F_0_541, in6, F_0_541 - F_1_847);
    let tmp0 = widen_shl(add16(in0, in4), CONST_BITS);
    let tmp1 = widen_shl(sub16(in0, in4), CONST_BITS);
    let tmp10 = add32(tmp0, tmp3);
    let tmp13 = sub32(tmp0, tmp3);
    let tmp11 = add32(tmp1, tmp2);
    let tmp12 = sub32(tmp1, tmp2);

    let z3 = add16(in3, in7);
    let z4 = add16(in1, in5);
    let (z3, z4) = (
        madd(z3, F_1_175 - F_1_961, z4, F_1_175),
        madd(z3, F_1_175, z4, F_1_175 - F_0_390),
    );
    let tmp0 = add32(madd(in7, F_0_298 - F_0_899, in1, -F_0_899), z3);
    let tmp3 = add32(madd(in7, -F_0_899, in1, F_1_501 - F_0_899), z4);
    let tmp1 = add32(madd(in5, F_2_053 - F_2_562, in3, -F_2_562), z4);
    let tmp2 = add32(madd(in5, -F_2_562, in3, F_3_072 - F_2_562), z3);

    [
        descale(add32(tmp10, tmp3), shift),
        descale(add32(tmp11, tmp2), shift),
        descale(add32(tmp12, tmp1), shift),
        descale(add32(tmp13, tmp0), shift),
        descale(sub32(tmp13, tmp0), shift),
        descale(sub32(tmp12, tmp1), shift),
        descale(sub32(tmp11, tmp2), shift),
        descale(sub32(tmp10, tmp3), shift),
    ]
}

pub(crate) fn idct8x8(coefs: &Block, table: &DctTable) -> [[u8; 8]; 8] {
    let (input, dc_only) = dequantize(
        coefs,
        table,
        [false, true, true, true, true, true, true, true],
    );
    let columns = if dc_only {
        // This shortcut wraps where the full computation saturates.
        let [in0, ..] = input;
        in0.map(|dc| [dc.wrapping_shl(PASS1_BITS); 8])
    } else {
        transpose(&idct8_pass(input, CONST_BITS - PASS1_BITS))
    };
    transpose(&idct8_pass(columns, CONST_BITS + PASS1_BITS + 3)).map(|row| row.map(to_sample))
}

/// Row or column 4 has no part in a 4-point result.
#[inline(always)]
fn idct4_pass([in0, in1, in2, in3, _, in5, in6, in7]: [I16x8; 8], shift: u32) -> [I16x8; 4] {
    const F_0_211: i32 = 1730;
    const F_0_509: i32 = 4176;
    const F_0_601: i32 = 4926;
    const F_0_765: i32 = 6270;
    const F_0_899: i32 = 7373;
    const F_1_061: i32 = 8697;
    const F_1_451: i32 = 11893;
    const F_1_847: i32 = 15137;
    const F_2_172: i32 = 17799;
    const F_2_562: i32 = 20995;

    let tmp2 = add32(
        madd(in5, -F_0_601, in7, -F_0_509),
        madd(in1, F_2_562, in3, F_0_899),
    );
    let tmp0 = add32(
        madd(in5, F_1_451, in7, -F_0_211),
        madd(in1, F_1_061, in3, -F_2_172),
    );
    let even0 = widen_shl(in0, CONST_BITS + 1);
    let even2 = madd(in2, F_1_847, in6, -F_0_765);
    let tmp10 = add32(even0, even2);
    let tmp12 = sub32(even0, even2);
    [
        descale(add32(tmp10, tmp2), shift),
        descale(add32(tmp12, tmp0), shift),
        descale(sub32(tmp12, tmp0), shift),
        descale(sub32(tmp10, tmp2), shift),
    ]
}

pub(crate) fn idct4x4(coefs: &Block, table: &DctTable) -> [[u8; 4]; 4] {
    let (input, dc_only) = dequantize(
        coefs,
        table,
        [false, true, true, true, false, true, true, true],
    );
    let columns: [[i16; 4]; 8] = if dc_only {
        let [in0, ..] = input;
        in0.map(|dc| [dc.wrapping_shl(PASS1_BITS); 4])
    } else {
        transpose(&idct4_pass(input, CONST_BITS - PASS1_BITS + 1))
    };
    // Four of the eight lanes are in use.
    let columns = columns.map(|[a, b, c, d]| [a, b, c, d, 0, 0, 0, 0]);
    let out =
        idct4_pass(columns, CONST_BITS + PASS1_BITS + 3 + 1).map(|[a, b, c, d, ..]| [a, b, c, d]);
    transpose(&out).map(|row| row.map(to_sample))
}

pub(crate) fn idct2x2(coefs: &Block, table: &DctTable) -> [[u8; 2]; 2] {
    const F_0_720: i32 = 5906;
    const F_0_850: i32 = 6967;
    const F_1_272: i32 = 10426;
    const F_3_624: i32 = 29692;
    const DESCALE_P1: u32 = CONST_BITS - PASS1_BITS + 2;
    const DESCALE_P2: u32 = CONST_BITS + PASS1_BITS + 3 + 2;

    let ([in0, in1, _, in3, _, in5, _, in7], _) = dequantize(coefs, table, [false; 8]);
    let tmp0 = add32(
        madd(in1, F_3_624, in3, -F_1_272),
        madd(in5, F_0_850, in7, -F_0_720),
    );
    let tmp10 = widen_shl(in0, CONST_BITS + 2);
    let round_shift = |v: i32, n: u32| v.wrapping_add(1 << (n - 1)) >> n;

    [add32(tmp10, tmp0), sub32(tmp10, tmp0)].map(|row| {
        // Column 0 stays 32 bits wide, the others are packed with saturation.
        let [c0, c1, _, c3, _, c5, _, c7] = row.map(|v| round_shift(v, DESCALE_P1));
        let [c1, c3, c5, c7] = [c1, c3, c5, c7].map(|v| v.clamp(-32768, 32767));
        let tmp0 = (c1 * F_3_624 - c3 * F_1_272).wrapping_add(c5 * F_0_850 - c7 * F_0_720);
        let tmp10 = c0.wrapping_shl(CONST_BITS + 2);
        [tmp10.wrapping_add(tmp0), tmp10.wrapping_sub(tmp0)]
            .map(|v| to_sample(round_shift(v, DESCALE_P2).clamp(-32768, 32767) as i16))
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
    Copy + Add<Output = Self> + Sub<Output = Self> + Mul<i32, Output = Self> + Shl<u32, Output = Self>
{
    fn from_i32(v: i32) -> Self;
    /// The low 32 bits of `self >> n`.
    fn shr(self, n: u32) -> i32;
}

macro_rules! int {
    ($name:ident, $inner:ty) => {
        #[derive(Clone, Copy)]
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
    let mut x = input.map(T::from_i32);
    if let Some(dc) = x.first_mut() {
        *dc = (*dc << CONST_BITS) + T::from_i32(1 << (shift - 1));
    }
    f(x).map(|v| v.shr(shift))
}

/// The sums of the first pass fit in 32 bits if its inputs are smaller than this. A sum is linear in the inputs, and the
/// magnitudes of its factors add up to less than `10 << CONST_BITS` in every transform below (9.7 in `idct14`). What
/// wraps on the way to a sum that fits does no harm.
const MAX_INPUT_FOR_32_BITS: i32 = 1 << 14;

/// `K` is how many rows and columns of the block have a part in the result.
#[inline(always)]
fn scaled<const K: usize, const N: usize>(
    coefs: &Block,
    table: &DctTable,
    narrow: impl Fn([W32; K]) -> [W32; N],
    wide: impl Fn([W64; K]) -> [W64; N],
) -> [[u8; N]; N] {
    let mut input = [[0i32; K]; K];
    let mut largest = 0;
    for ((input, coefs), table) in input.iter_mut().zip(rows(coefs)).zip(rows(table)) {
        for ((input, &coef), &q) in input.iter_mut().zip(coefs).zip(table) {
            *input = i32::from(coef) * i32::from(q);
            largest |= input.unsigned_abs();
        }
    }

    // The second pass keeps bits 18 to 27 of its sums, which 32-bit arithmetic gets right whatever is above them. They
    // depend on more bits of the first pass's sums than 32-bit arithmetic has, unless those sums fit.
    const SHIFT1: u32 = CONST_BITS - PASS1_BITS;
    const SHIFT2: u32 = CONST_BITS + PASS1_BITS + 3;
    let columns = transpose(&input);
    let workspace: [[i32; N]; K] = if largest < MAX_INPUT_FOR_32_BITS as u32 {
        columns.map(|column| pass(&column, SHIFT1, &narrow))
    } else {
        columns.map(|column| pass(&column, SHIFT1, &wide))
    };
    transpose(&workspace).map(|row| pass(&row, SHIFT2, &narrow).map(range_limit))
}

macro_rules! scaled_idct {
    ($name:ident, $f:ident, $n:literal) => {
        pub(crate) fn $name(coefs: &Block, table: &DctTable) -> [[u8; $n]; $n] {
            scaled(coefs, table, $f, $f)
        }
    };
}
scaled_idct!(idct3x3, idct3, 3);
scaled_idct!(idct5x5, idct5, 5);
scaled_idct!(idct6x6, idct6, 6);
scaled_idct!(idct7x7, idct7, 7);
scaled_idct!(idct10x10, idct10, 10);
scaled_idct!(idct12x12, idct12, 12);
scaled_idct!(idct14x14, idct14, 14);

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
    let tmp14 = z2 * -FIX_0_541196100;
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
    let z3 = (z1 + z2) * FIX_0_541196100;
    let tmp11 = z3 + z1 * FIX_0_765366865;
    let tmp14 = z3 - z2 * FIX_1_847759065;
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
