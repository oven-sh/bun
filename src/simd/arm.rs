//! The targets of AArch64.

use crate::brain_arm::{
    self as asm, vcaddq_rot90_f16, vcaddq_rot90_f32, vcaddq_rot90_f64, vcaddq_rot270_f16, vcaddq_rot270_f32,
    vcaddq_rot270_f64, vcmlaq_f16, vcmlaq_f32, vcmlaq_f64, vcmlaq_rot90_f16, vcmlaq_rot90_f32, vcmlaq_rot90_f64,
    vcmlaq_rot270_f16, vcmlaq_rot270_f32, vcmlaq_rot270_f64, vmmlaq_s32, vmmlaq_u32, vsm3partw1q_u32, vsm3partw2q_u32,
    vsm3ss1q_u32, vsm4ekeyq_u32, vusdotq_s32, vusmmlaq_s32,
};
use crate::ops::{high, join, low, proof};
#[cfg(not(miri))]
use crate::shared::{Shared, neon as shared};
use crate::simd::ToBytes;
use crate::simd::prelude::*;
use crate::sve;
use core::arch::aarch64::*;

pub(crate) const TABLE_BIAS: u8 = 0;
pub(crate) const LOOKS_UP_IN_REGISTERS: bool = true;

macro_rules! group { ($($ops:tt)*) => { proof! { arm $($ops)* } }; }
/// A group of `neon`. The whole program is compiled for that, so `Portable` has it too.
#[rules]
macro_rules! lent { ($name:ident $features:literal $($op:ident($($arg:ident: $t:ty),*) -> $result:ty = $body:expr;)*) => {
    group! { $name $features $($op($($arg: $t),*) -> $result = $body;)* }
    #[allow(unused_macros, unused_imports)]
    pub(crate) mod ${concat($name, _lent)} {
        macro_rules! lend { () => {$(
            #[inline(always)]
            fn $op(self, $($arg: $t),*) -> $result { crate::kernel::compiled_for::<crate::gate::tokens::neon>().$op($($arg),*) }
        )*}; }
        pub(crate) use lend;
    }
}; }

/// From bytes to a type of `core::arch`.
macro_rules! to {
    ($t:ident, $v:expr) => {
        $t::from_ne_bytes($v).into()
    };
}
/// And back.
macro_rules! from {
    ($t:ident, $v:expr) => {
        $t::from($v).to_ne_bytes()
    };
}

macro_rules! rotate_right32 { ($v:ident, $count:ident, $($n:literal)*) => { match $count {
    8 => vqtbl1q_u8($v.into(), crate::raw::copy::from_array::<u8, 16>([1, 2, 3, 0, 5, 6, 7, 4, 9, 10, 11, 8, 13, 14, 15, 12]).into()).into(),
    24 => vqtbl1q_u8($v.into(), crate::raw::copy::from_array::<u8, 16>([3, 0, 1, 2, 7, 4, 5, 6, 11, 8, 9, 10, 15, 12, 13, 14]).into()).into(),
    $($n => from!(u32x4, vsliq_n_u32::<{ 32 - $n }>(vshrq_n_u32::<$n>(to!(u32x4, $v)), to!(u32x4, $v))),)*
    _ => $v,
} }; }

macro_rules! products {
    ($a:ident $b:ident $t:ident $reg:ident $wide:ident, $mul:ident $low:ident $high:ident) => {{
        let (a, b): ($reg, $reg) = (to!($t, $a), to!($t, $b));
        [from!($wide, $mul($low(a), $low(b))), from!($wide, $high(a, b))]
    }};
}
macro_rules! rotate_right { ($v:ident, $count:ident, $t:ident $bits:literal $sli:ident $shr:ident, $($n:literal)*) => { match $count {
    $($n => from!($t, $sli::<{ $bits - $n }>($shr::<$n>(to!($t, $v)), to!($t, $v))),)*
    _ => $v,
} }; }

#[inline]
#[target_feature(enable = "neon")]
fn from_f16(v: uint8x16_t) -> [u8x16; 2] {
    let v = vreinterpretq_f16_u8(v);
    [
        from!(f32x4, vcvt_f32_f16(vreinterpret_f16_u8(vget_low_u8(vreinterpretq_u8_f16(v))))),
        from!(f32x4, vcvt_high_f32_f16(v)),
    ]
}
/// In a register, and unknown to LLVM.
macro_rules! kept {
    ($v:expr) => {{
        let v: u8x16 = $v;
        cfg_select! {
            not(miri) => crate::regs::vector16(v),
            _ => v,
        }
    }};
}
#[inline]
#[target_feature(enable = "neon")]
fn to_f16(v: u8x32) -> u8x16 {
    vreinterpretq_u8_f16(vcvt_high_f16_f32(vcvt_f16_f32(to!(f32x4, kept!(low(v)))), to!(f32x4, kept!(high(v))))).into()
}

/// Of the 8 bytes from `from` on. The product of the bytes `i` and `j` belongs to lane `(i + j) / 2`, and a byte up if that sum is odd.
/// Lanes in the middle get more than those at the ends, which lend their room.
#[inline]
#[target_feature(enable = "neon")]
fn clmul_by_bytes(a: uint8x16_t, b: uint8x16_t, from: u8) -> uint8x16_t {
    let bytes = |at: [u8; 16]| -> uint8x16_t { crate::raw::copy::from_array::<u8, 16>(at).into() };
    let pick =
        |v, at| vreinterpretq_p8_u8(vrshlq_u8(vqtbl1q_u8(v, vaddq_u8(bytes(at), vdupq_n_u8(from))), vdupq_n_s8(0)));
    let both = |a, at| {
        let b = pick(b, at);
        (vreinterpretq_u8_p16(vmull_p8(vget_low_p8(a), vget_low_p8(b))), vreinterpretq_u8_p16(vmull_high_p8(a, b)))
    };
    // Adds what was lent to its lane, and again where it is.
    let back = |all, last, at| veorq_u8(all, vqtbl2q_u8(uint8x16x2_t(all, last), bytes(at)));
    let first = pick(a, [0, 0, 0, 0, 2, 4, 6, 7, 1, 1, 1, 2, 4, 5, 7, 1]);
    let second = pick(a, [3, 2, 2, 4, 6, 6, 5, 3, 5, 3, 4, 6, 7, 7, 3, 5]);
    let (p, q) = both(first, [0, 2, 4, 6, 6, 6, 6, 7, 5, 1, 3, 4, 4, 5, 5, 7]);
    let (r, s) = both(second, [3, 0, 2, 2, 2, 4, 7, 5, 1, 1, 0, 0, 1, 3, 7, 3]);
    let even = back(veorq_u8(veorq_u8(q, r), s), s, [0, 1, 18, 19, 18, 19, 0, 1, 14, 15, 28, 29, 28, 29, 14, 15]);
    let even = veorq_u8(p, even);
    let (p, q) = both(first, [1, 3, 5, 7, 7, 7, 7, 0, 0, 2, 4, 5, 5, 6, 6, 6]);
    let (r, s) = both(second, [2, 1, 3, 3, 3, 5, 4, 4, 0, 0, 1, 1, 2, 4, 6, 2]);
    let s = veorq_u8(r, s);
    let odd = back(veorq_u8(veorq_u8(p, q), s), s, [16, 17, 32, 32, 16, 17, 14, 15, 28, 29, 32, 32, 28, 29, 14, 15]);
    veorq_u8(even, vextq_u8::<15>(odd, odd))
}

lent! { neon "neon"
    f16_to_f32_16(v: u8x16) -> u8x16 = from_f16(v.into())[0];
    f16_to_f32_32(v: u8x32) -> u8x32 = { let [a, b] = from_f16(low::<32, 16>(v).into()); join(a, b) };
    f16_to_f32_64(v: u8x64) -> u8x64 = {
        let v: u8x32 = low(v);
        let ([a, b], [c, d]) = (from_f16(low::<32, 16>(v).into()), from_f16(high::<32, 16>(v).into()));
        join::<32, 64>(join(a, b), join(c, d))
    };
    f32_to_f16_16(v: u8x16) -> u8x16 = vcombine_u8(vreinterpret_u8_f16(vcvt_f16_f32(to!(f32x4, kept!(v)))), vdup_n_u8(0)).into();
    f32_to_f16_32(v: u8x32) -> u8x32 = join(to_f16(v), vdupq_n_u8(0).into());
    f32_to_f16_64(v: u8x64) -> u8x64 = { let it: u8x32 = join(to_f16(low(v)), to_f16(high(v))); join(it, it) };
    opaque_keeping_16(v: u8x16, kept: u8x16) -> u8x16 = vorrq_u8(v.into(), vabdq_u8(kept.into(), kept.into())).into();
    opaque_16(v: u8x16) -> u8x16 = vrshlq_u8(v.into(), vdupq_n_s8(0)).into();
    opaque_lanes_8(v: u8x8, size: usize) -> u8x8 = if size == 2 {
        vreinterpret_u8_u16(vrshl_u16(vreinterpret_u16_u8(v.into()), vdup_n_s16(0))).into()
    } else {
        vreinterpret_u8_u32(vrshl_u32(vreinterpret_u32_u8(v.into()), vdup_n_s32(0))).into()
    };
    opaque16_16(v: u8x16) -> u8x16 = from!(u16x8, vrshlq_u16(to!(u16x8, v), vdupq_n_s16(0)));
    opaque32_16(v: u8x16) -> u8x16 = from!(u32x4, vrshlq_u32(to!(u32x4, v), vdupq_n_s32(0)));
    opaque64_16(v: u8x16) -> u8x16 = from!(u64x2, vrshlq_u64(to!(u64x2, v), vdupq_n_s64(0)));
    opaque_8(v: u8x8) -> u8x8 = vrshl_u8(v.into(), vdup_n_s8(0)).into();
    table_16(table: u8x16, indices: u8x16) -> u8x16 = vqtbl1q_u8(table.into(), indices.into()).into();
    mul_add_i16_16(a: u8x16, b: u8x16) -> u8x16 = {
        let [lower, upper] = products!(a b i16x8 int16x8_t i32x4, vmull_s16 vget_low_s16 vmull_high_s16);
        // See `opaque`. LLVM would reorder this addition and those after it.
        from!(i32x4, vrshlq_s32(vpaddq_s32(to!(i32x4, lower), to!(i32x4, upper)), vdupq_n_s32(0)))
    };
    products(a: u8x16, b: u8x16, size: usize, signed: bool) -> [u8x16; 2] = match (size, signed) {
        (1, false) => products!(a b u8x16 uint8x16_t u16x8, vmull_u8 vget_low_u8 vmull_high_u8),
        (1, true) => products!(a b i8x16 int8x16_t i16x8, vmull_s8 vget_low_s8 vmull_high_s8),
        (2, false) => products!(a b u16x8 uint16x8_t u32x4, vmull_u16 vget_low_u16 vmull_high_u16),
        (2, true) => products!(a b i16x8 int16x8_t i32x4, vmull_s16 vget_low_s16 vmull_high_s16),
        (_, false) => products!(a b u32x4 uint32x4_t u64x2, vmull_u32 vget_low_u32 vmull_high_u32),
        (_, true) => products!(a b i32x4 int32x4_t i64x2, vmull_s32 vget_low_s32 vmull_high_s32),
    };
    mul_fixed_point_15_16(a: u8x16, b: u8x16) -> u8x16 = from!(i16x8, vqrdmulhq_s16(to!(i16x8, a), to!(i16x8, b)));
    mul_even_u32_16(a: u8x16, b: u8x16) -> u8x16 = {
        // See `opaque`. For speed: else LLVM can multiply 64 bits,
        // one lane at a time.
        let even = |v: u8x16| vget_low_u32(vrshlq_u32(vuzp1q_u32(to!(u32x4, v), to!(u32x4, v)), vdupq_n_s32(0)));
        from!(u64x2, vrshlq_u64(vmull_u32(even(a), even(b)), vdupq_n_s64(0)))
    };
    mul_even_odd_u32_16(a: u8x16, b: u8x16) -> u8x16 = {
        let (a, b) = (to!(u32x4, a), to!(u32x4, b));
        let kept = |v| vget_low_u32(vrshlq_u32(v, vdupq_n_s32(0)));
        from!(u64x2, vmull_u32(kept(vuzp1q_u32(a, a)), kept(vuzp2q_u32(b, b))))
    };
    mul_even_odd_u32_32(a: u8x32, b: u8x32) -> u8x32 = {
        let even = vuzp1q_u32(to!(u32x4, a.extract::<0, 16>()), to!(u32x4, a.extract::<16, 16>()));
        let odd = vuzp2q_u32(to!(u32x4, b.extract::<0, 16>()), to!(u32x4, b.extract::<16, 16>()));
        let (a, b) = (vrshlq_u32(even, vdupq_n_s32(0)), vrshlq_u32(odd, vdupq_n_s32(0)));
        let kept = |product| from!(u64x2, vrshlq_u64(product, vdupq_n_s64(0)));
        join(kept(vmull_u32(vget_low_u32(a), vget_low_u32(b))), kept(vmull_high_u32(a, b)))
    };
    // LLVM would choose `usra`, which takes twice as long as `sli`.
    rotate_right32_16(v: u8x16, count: u32) -> u8x16 =
        rotate_right32!(v, count, 1 2 3 4 5 6 7 9 10 11 12 13 14 15 16 17 18 19 20 21 22 23 25 26 27 28 29 30 31);
    rotate_right16_16(v: u8x16, count: u32) -> u8x16 = rotate_right!(v, count, u16x8 16 vsliq_n_u16 vshrq_n_u16, 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15);
    rotate_right64_16(v: u8x16, count: u32) -> u8x16 = if count % 8 == 0 {
        let first = 0x0706_0504_0302_0100u64.rotate_right(count);
        vqtbl1q_u8(v.into(), vrshlq_u8(vcombine_u8(vcreate_u8(first), vcreate_u8(first | 0x0808_0808_0808_0808)), vdupq_n_s8(0))).into()
    } else {
        rotate_right!(v, count, u64x2 64 vsliq_n_u64 vshrq_n_u64, 1 2 3 4 5 6 7 9 10 11 12 13 14 15 17 18 19 20 21 22 23 25 26 27 28 29 30 31
            33 34 35 36 37 38 39 41 42 43 44 45 46 47 49 50 51 52 53 54 55 57 58 59 60 61 62 63)
    };
    // The square of a polynomial has its bits at twice their places.
    spread_bits_16(v: u8x16) -> u8x16 = { let v = vreinterpret_p8_u8(vget_low_u8(v.into())); vreinterpretq_u8_p16(vmull_p8(v, v)).into() };
    // The halves of four lanes fill registers. LLVM drops those that are zero.
    mul64_pair(a: u8x32, b: u8x32) -> u8x32 = {
        let halves = |v: u8x32| {
            let (first, second): (uint64x2_t, uint64x2_t) = (to!(u64x2, low::<32, 16>(v)), to!(u64x2, high::<32, 16>(v)));
            let lower: uint32x4_t = to!(u32x4, crate::regs::vector16(from!(u32x4, vcombine_u32(vmovn_u64(first), vmovn_u64(second)))));
            (lower, vcombine_u32(vshrn_n_u64::<32>(first), vshrn_n_u64::<32>(second)))
        };
        let ((a, a1), (b, b1)) = (halves(a), halves(b));
        // See `as_factors`.
        let zero = vreinterpretq_s32_u32(veorq_u32(vrshlq_u32(veorq_u32(a, b), vdupq_n_s32(0)), veorq_u32(a, b)));
        let (a, b) = (vshlq_u32(a, zero), vshlq_u32(b, zero));
        let cross = vaddq_u32(vmulq_u32(a, b1), vmulq_u32(a1, b));
        let first = vmlal_u32(vshlq_n_u64::<32>(vmovl_u32(vget_low_u32(cross))), vget_low_u32(a), vget_low_u32(b));
        join(from!(u64x2, first), from!(u64x2, vmlal_high_u32(vshlq_n_u64::<32>(vmovl_high_u32(cross)), a, b)))
    };
    move_bits_16(v: u8x16, mask: u8x16, how: (crate::asked::BitPerm, u32, bool)) -> u8x16 = how.0.lanes(uint8x16_t::from(v), mask.into(), how.1, how.2).into();
    abs_le_16(a: u8x16, b: u8x16, bits: u32) -> u8x16 =
        if bits == 32 { from!(u32x4, vcaleq_f32(to!(f32x4, a), to!(f32x4, b))) } else { from!(u64x2, vcaleq_f64(to!(f64x2, a), to!(f64x2, b))) };
    mul_even_i32_16(a: u8x16, b: u8x16) -> u8x16 = {
        let even = |v: u8x16| vget_low_s32(vrshlq_s32(vuzp1q_s32(to!(i32x4, v), to!(i32x4, v)), vdupq_n_s32(0)));
        from!(i64x2, vrshlq_s64(vmull_s32(even(a), even(b)), vdupq_n_s64(0)))
    };
    sums_of_8_abs_diff_16(a: u8x16, b: u8x16) -> u8x16 =
        from!(u64x2, vpaddlq_u32(vpaddlq_u16(vpaddlq_u8(vabdq_u8(a.into(), b.into())))));
    truncate_f64_i32_16(v: u8x16) -> u8x16 =
        from!(i32x4, vcombine_s32(vmovn_s64(vcvtq_s64_f64(to!(f64x2, v))), vdup_n_s32(0)));
    truncate_f64_i32_32(v: u8x32) -> u8x32 = {
        let (low, high) = (to!(f64x2, v.extract::<0, 16>()), to!(f64x2, v.extract::<16, 16>()));
        from!(i32x4, vmovn_high_s64(vmovn_s64(vcvtq_s64_f64(low)), vcvtq_s64_f64(high))).resize()
    };
    odd_f64_f32_16(v: u8x16) -> u8x16 = from!(f32x4, vcombine_f32(vcvtx_f32_f64(to!(f64x2, v)), vdup_n_f32(0.0)));
    odd_f64_f32_32(v: u8x32) -> u8x32 =
        from!(f32x4, vcvtx_high_f32_f64(vcvtx_f32_f64(to!(f64x2, v.extract::<0, 16>())), to!(f64x2, v.extract::<16, 16>()))).resize();
    fma_f32_16(a: u8x16, b: u8x16, c: u8x16) -> u8x16 = from!(f32x4, vfmaq_f32(to!(f32x4, c), to!(f32x4, a), to!(f32x4, b)));
    fma_f64_16(a: u8x16, b: u8x16, c: u8x16) -> u8x16 = from!(f64x2, vfmaq_f64(to!(f64x2, c), to!(f64x2, a), to!(f64x2, b)));
    sqrt_f32_16(v: u8x16) -> u8x16 = from!(f32x4, vsqrtq_f32(to!(f32x4, v)));
    sqrt_f64_16(v: u8x16) -> u8x16 = from!(f64x2, vsqrtq_f64(to!(f64x2, v)));
    floor_f32_16(v: u8x16) -> u8x16 = from!(f32x4, vrndmq_f32(to!(f32x4, v)));
    floor_f64_16(v: u8x16) -> u8x16 = from!(f64x2, vrndmq_f64(to!(f64x2, v)));
    ceil_f32_16(v: u8x16) -> u8x16 = from!(f32x4, vrndpq_f32(to!(f32x4, v)));
    ceil_f64_16(v: u8x16) -> u8x16 = from!(f64x2, vrndpq_f64(to!(f64x2, v)));
    trunc_f32_16(v: u8x16) -> u8x16 = from!(f32x4, vrndq_f32(to!(f32x4, v)));
    trunc_f64_16(v: u8x16) -> u8x16 = from!(f64x2, vrndq_f64(to!(f64x2, v)));
    even_f32_16(v: u8x16) -> u8x16 = from!(f32x4, vrndnq_f32(to!(f32x4, v)));
    even_f64_16(v: u8x16) -> u8x16 = from!(f64x2, vrndnq_f64(to!(f64x2, v)));
    min_f32_16(a: u8x16, b: u8x16) -> u8x16 = from!(f32x4, vminnmq_f32(to!(f32x4, a), to!(f32x4, b)));
    max_f32_16(a: u8x16, b: u8x16) -> u8x16 = from!(f32x4, vmaxnmq_f32(to!(f32x4, a), to!(f32x4, b)));
    min_f64_16(a: u8x16, b: u8x16) -> u8x16 = from!(f64x2, vminnmq_f64(to!(f64x2, a), to!(f64x2, b)));
    max_f64_16(a: u8x16, b: u8x16) -> u8x16 = from!(f64x2, vmaxnmq_f64(to!(f64x2, a), to!(f64x2, b)));
    min_or_nan_f32_16(a: u8x16, b: u8x16) -> u8x16 = from!(f32x4, vminq_f32(to!(f32x4, a), to!(f32x4, b)));
    max_or_nan_f32_16(a: u8x16, b: u8x16) -> u8x16 = from!(f32x4, vmaxq_f32(to!(f32x4, a), to!(f32x4, b)));
    min_or_nan_f64_16(a: u8x16, b: u8x16) -> u8x16 = from!(f64x2, vminq_f64(to!(f64x2, a), to!(f64x2, b)));
    max_or_nan_f64_16(a: u8x16, b: u8x16) -> u8x16 = from!(f64x2, vmaxq_f64(to!(f64x2, a), to!(f64x2, b)));
    abs_greater_16(a: u8x16, b: u8x16, bits: u32) -> u8x16 =
        if bits == 32 { from!(u32x4, vcagtq_f32(to!(f32x4, a), to!(f32x4, b))) } else { from!(u64x2, vcagtq_f64(to!(f64x2, a), to!(f64x2, b))) };
    saturated_abs8_16(v: u8x16) -> u8x16 = from!(i8x16, vqabsq_s8(to!(i8x16, v)));
    saturated_abs16_16(v: u8x16) -> u8x16 = from!(i16x8, vqabsq_s16(to!(i16x8, v)));
    saturated_abs32_16(v: u8x16) -> u8x16 = from!(i32x4, vqabsq_s32(to!(i32x4, v)));
    saturated_abs64_16(v: u8x16) -> u8x16 = from!(i64x2, vqabsq_s64(to!(i64x2, v)));
    min_across_f32_16(v: u8x16) -> u8x16 = from!(f32x4, vdupq_n_f32(vminnmvq_f32(to!(f32x4, v))));
    max_across_f32_16(v: u8x16) -> u8x16 = from!(f32x4, vdupq_n_f32(vmaxnmvq_f32(to!(f32x4, v))));
    shift8_16(v: u8x16, left: u8x16) -> u8x16 = vshlq_u8(v.into(), to!(i8x16, left)).into();
    shift16_16(v: u8x16, left: u8x16) -> u8x16 = from!(u16x8, vshlq_u16(to!(u16x8, v), to!(i16x8, left)));
    shift32_16(v: u8x16, left: u8x16) -> u8x16 = from!(u32x4, vshlq_u32(to!(u32x4, v), to!(i32x4, left)));
    shift64_16(v: u8x16, left: u8x16) -> u8x16 = from!(u64x2, vshlq_u64(to!(u64x2, v), to!(i64x2, left)));
    average_i8_16(a: u8x16, b: u8x16) -> u8x16 = from!(i8x16, vrhaddq_s8(to!(i8x16, a), to!(i8x16, b)));
    average_i16_16(a: u8x16, b: u8x16) -> u8x16 = from!(i16x8, vrhaddq_s16(to!(i16x8, a), to!(i16x8, b)));
    average_i32_16(a: u8x16, b: u8x16) -> u8x16 = from!(i32x4, vrhaddq_s32(to!(i32x4, a), to!(i32x4, b)));
    mul_high_doubled_16(a: u8x16, b: u8x16) -> u8x16 = from!(i16x8, vqdmulhq_s16(to!(i16x8, a), to!(i16x8, b)));
    mul_high_doubled32_16(a: u8x16, b: u8x16) -> u8x16 = from!(i32x4, vqdmulhq_s32(to!(i32x4, a), to!(i32x4, b)));
    mul_fixed_point_31_16(a: u8x16, b: u8x16) -> u8x16 = from!(i32x4, vqrdmulhq_s32(to!(i32x4, a), to!(i32x4, b)));
    saturated_mul_add_lower_i16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 =
        from!(i32x4, vqdmlal_s16(to!(i32x4, sum), vget_low_s16(to!(i16x8, a)), vget_low_s16(to!(i16x8, b))));
    approximate_reciprocal_f64_16(v: u8x16) -> u8x16 = from!(f64x2, vrecpeq_f64(to!(f64x2, v)));
    approximate_reciprocal_sqrt_f64_16(v: u8x16) -> u8x16 = from!(f64x2, vrsqrteq_f64(to!(f64x2, v)));
    galois_mul_16(a: u8x16, b: u8x16) -> u8x16 = {
        // The lower and the upper bytes of the carry-less products.
        let both = |a: poly8x16_t, b: poly8x16_t| {
            let (first, second) = (vmull_p8(vget_low_p8(a), vget_low_p8(b)), vmull_high_p8(a, b));
            (u8x16::from(vmulq_p8(a, b)), vuzp2q_p8(vreinterpretq_p8_p16(first), vreinterpretq_p8_p16(second)))
        };
        let (low, high) = both(a.into(), b.into());
        // The quotient by the polynomial.
        let high = vreinterpretq_u8_p8(high);
        let times = veorq_u8(high, vqtbl1q_u8(vcombine_u8(vcreate_u8(0x0405_0706_0203_0100), vdup_n_u8(0)), vshrq_n_u8::<4>(high)));
        low.xor(u8x16::from(vmulq_p8(vreinterpretq_p8_u8(times), vdupq_n_p8(0x1b))))
    };
    average_u8_16(a: u8x16, b: u8x16) -> u8x16 = vrhaddq_u8(a.into(), b.into()).into();
    average_u16_16(a: u8x16, b: u8x16) -> u8x16 = from!(u16x8, vrhaddq_u16(to!(u16x8, a), to!(u16x8, b)));
    sums_of_2_u8_16(v: u8x16) -> u8x16 = from!(u16x8, vpaddlq_u8(v.into()));
    sums_of_2_i8_16(v: u8x16) -> u8x16 = from!(i16x8, vpaddlq_s8(to!(i8x16, v)));
    sums_of_2_u16_16(v: u8x16) -> u8x16 = from!(u32x4, vpaddlq_u16(to!(u16x8, v)));
    sums_of_2_i16_16(v: u8x16) -> u8x16 = from!(i32x4, vpaddlq_s16(to!(i16x8, v)));
    sums_of_2_u32_16(v: u8x16) -> u8x16 = from!(u64x2, vpaddlq_u32(to!(u32x4, v)));
    sums_of_2_i32_16(v: u8x16) -> u8x16 = from!(i64x2, vpaddlq_s32(to!(i32x4, v)));
    pack_u16_u8_16(a: u8x16, b: u8x16) -> u8x16 = vqmovn_high_u16(vqmovn_u16(to!(u16x8, a)), to!(u16x8, b)).into();
    pack_u32_u16_16(a: u8x16, b: u8x16) -> u8x16 = from!(u16x8, vqmovn_high_u32(vqmovn_u32(to!(u32x4, a)), to!(u32x4, b)));
    pack_u64_u32_16(a: u8x16, b: u8x16) -> u8x16 = from!(u32x4, vqmovn_high_u64(vqmovn_u64(to!(u64x2, a)), to!(u64x2, b)));
    pack_i64_i32_16(a: u8x16, b: u8x16) -> u8x16 = from!(i32x4, vqmovn_high_s64(vqmovn_s64(to!(i64x2, a)), to!(i64x2, b)));
    pack_i64_u32_16(a: u8x16, b: u8x16) -> u8x16 = from!(u32x4, vqmovun_high_s64(vqmovun_s64(to!(i64x2, a)), to!(i64x2, b)));
    nearest_f64_i64_16(v: u8x16) -> u8x16 = from!(i64x2, vcvtnq_s64_f64(to!(f64x2, v)));
    pack_i16_i8_16(a: u8x16, b: u8x16) -> u8x16 = from!(i8x16, vqmovn_high_s16(vqmovn_s16(to!(i16x8, a)), to!(i16x8, b)));
    pack_i16_u8_16(a: u8x16, b: u8x16) -> u8x16 = vqmovun_high_s16(vqmovun_s16(to!(i16x8, a)), to!(i16x8, b)).into();
    pack_i32_i16_16(a: u8x16, b: u8x16) -> u8x16 = from!(i16x8, vqmovn_high_s32(vqmovn_s32(to!(i32x4, a)), to!(i32x4, b)));
    pack_i32_u16_16(a: u8x16, b: u8x16) -> u8x16 =
        from!(u16x8, vqmovun_high_s32(vqmovun_s32(to!(i32x4, a)), to!(i32x4, b)));
    rounding_shift_u8_16(v: u8x16, left: u8x16) -> u8x16 = from!(u8x16, vrshlq_u8(to!(u8x16, v), to!(i8x16, left)));
    rounding_shift_i8_16(v: u8x16, left: u8x16) -> u8x16 = from!(i8x16, vrshlq_s8(to!(i8x16, v), to!(i8x16, left)));
    rounding_shift_u16_16(v: u8x16, left: u8x16) -> u8x16 = from!(u16x8, vrshlq_u16(to!(u16x8, v), to!(i16x8, left)));
    rounding_shift_i16_16(v: u8x16, left: u8x16) -> u8x16 = from!(i16x8, vrshlq_s16(to!(i16x8, v), to!(i16x8, left)));
    rounding_shift_u32_16(v: u8x16, left: u8x16) -> u8x16 = from!(u32x4, vrshlq_u32(to!(u32x4, v), to!(i32x4, left)));
    rounding_shift_i32_16(v: u8x16, left: u8x16) -> u8x16 = from!(i32x4, vrshlq_s32(to!(i32x4, v), to!(i32x4, left)));
    rounding_shift_u64_16(v: u8x16, left: u8x16) -> u8x16 = from!(u64x2, vrshlq_u64(to!(u64x2, v), to!(i64x2, left)));
    rounding_shift_i64_16(v: u8x16, left: u8x16) -> u8x16 = from!(i64x2, vrshlq_s64(to!(i64x2, v), to!(i64x2, left)));
    add_other_sign_16(a: u8x16, b: u8x16, how: (u32, bool)) -> u8x16 = match how {
        (8, false) => from!(u8x16, vsqaddq_u8(to!(u8x16, a), to!(i8x16, b))),
        (16, false) => from!(u16x8, vsqaddq_u16(to!(u16x8, a), to!(i16x8, b))),
        (32, false) => from!(u32x4, vsqaddq_u32(to!(u32x4, a), to!(i32x4, b))),
        (_, false) => from!(u64x2, vsqaddq_u64(to!(u64x2, a), to!(i64x2, b))),
        (8, true) => from!(i8x16, vuqaddq_s8(to!(i8x16, a), to!(u8x16, b))),
        (16, true) => from!(i16x8, vuqaddq_s16(to!(i16x8, a), to!(u16x8, b))),
        (32, true) => from!(i32x4, vuqaddq_s32(to!(i32x4, a), to!(u32x4, b))),
        (_, true) => from!(i64x2, vuqaddq_s64(to!(i64x2, a), to!(u64x2, b))),
    };
    saturated_shift_16(v: u8x16, left: u8x16, how: (u32, bool)) -> u8x16 = match how {
        (8, false) => from!(u8x16, vqshlq_u8(to!(u8x16, v), to!(i8x16, left))),
        (16, false) => from!(u16x8, vqshlq_u16(to!(u16x8, v), to!(i16x8, left))),
        (32, false) => from!(u32x4, vqshlq_u32(to!(u32x4, v), to!(i32x4, left))),
        (_, false) => from!(u64x2, vqshlq_u64(to!(u64x2, v), to!(i64x2, left))),
        (8, true) => from!(i8x16, vqshlq_s8(to!(i8x16, v), to!(i8x16, left))),
        (16, true) => from!(i16x8, vqshlq_s16(to!(i16x8, v), to!(i16x8, left))),
        (32, true) => from!(i32x4, vqshlq_s32(to!(i32x4, v), to!(i32x4, left))),
        (_, true) => from!(i64x2, vqshlq_s64(to!(i64x2, v), to!(i64x2, left))),
    };
    approximate_reciprocal_16(v: u8x16) -> u8x16 = from!(f32x4, vrecpeq_f32(to!(f32x4, v)));
    approximate_reciprocal_sqrt_16(v: u8x16) -> u8x16 = from!(f32x4, vrsqrteq_f32(to!(f32x4, v)));
    nearest_f32_i32_16(v: u8x16) -> u8x16 = from!(i32x4, vcvtnq_s32_f32(to!(f32x4, v)));
    nearest_f32_u32_16(v: u8x16) -> u8x16 = from!(u32x4, vcvtnq_u32_f32(to!(f32x4, v)));
    nearest_f64_u64_16(v: u8x16) -> u8x16 = from!(u64x2, vcvtnq_u64_f64(to!(f64x2, v)));
    table_in_three_16(a: u8x16, b: u8x16, c: u8x16, indices: u8x16) -> u8x16 =
        vqtbl3q_u8(uint8x16x3_t(a.into(), b.into(), c.into()), indices.into()).into();
    long_products(a: u8x16, b: u8x16, signed: bool) -> u8x16 = if signed {
        from!(i64x2, vmull_s32(vget_low_s32(to!(i32x4, a)), vget_low_s32(to!(i32x4, b))))
    } else {
        from!(u64x2, vmull_u32(vget_low_u32(to!(u32x4, a)), vget_low_u32(to!(u32x4, b))))
    };
    clmul_by_bytes(a: u8x16, b: u8x16, from: u8) -> u8x16 = clmul_by_bytes(a.into(), b.into(), from).into();
    table_or(or: u8x16, table: u8x64, indices: u8x16, blocks: usize) -> u8x16 = {
        let (or, t, at): (uint8x16_t, uint8x16x4_t, uint8x16_t) = (or.into(), table.into(), indices.into());
        match blocks {
            1 => vqtbx1q_u8(or, t.0, at),
            2 => vqtbx2q_u8(or, uint8x16x2_t(t.0, t.1), at),
            3 => vqtbx3q_u8(or, uint8x16x3_t(t.0, t.1, t.2), at),
            _ => vqtbx4q_u8(or, t, at),
        }
        .into()
    };
    table_in_two_16(a: u8x16, b: u8x16, indices: u8x16) -> u8x16 = {
        let found = vqtbl2q_u8(uint8x16x2_t(a.into(), b.into()), indices.into());
        vrhaddq_u8(found, found).into()
    };
    shuffle_two(a: u8x16, b: u8x16, indices: u8x16) -> u8x16 = vqtbl2q_u8(uint8x16x2_t(a.into(), b.into()), indices.into()).into();
    lookup8_in_two_32(a: u8x32, b: u8x32, indices: u8x32) -> u8x32 = {
        let (table, indices): (uint8x16x4_t, uint8x16x2_t) = (join::<32, 64>(a, b).into(), indices.into());
        uint8x16x2_t(vqtbl4q_u8(table, indices.0), vqtbl4q_u8(table, indices.1)).into()
    };
    lookup8_64(table: u8x64, indices: u8x64) -> u8x64 = {
        let (t, i): (uint8x16x4_t, uint8x16x4_t) = (table.into(), indices.into());
        uint8x16x4_t(vqtbl4q_u8(t, i.0), vqtbl4q_u8(t, i.1), vqtbl4q_u8(t, i.2), vqtbl4q_u8(t, i.3)).into()
    };
}

group! { crc "crc"
    crc32_u8(crc: u32, data: u8) -> u32 = __crc32b(crc, data);
    crc32_u16(crc: u32, data: u16) -> u32 = __crc32h(crc, data);
    crc32_u32(crc: u32, data: u32) -> u32 = __crc32w(crc, data);
    crc32_u64(crc: u32, data: u64) -> u32 = __crc32d(crc, data);
    crc32c_u8(crc: u32, data: u8) -> u32 = __crc32cb(crc, data);
    crc32c_u16(crc: u32, data: u16) -> u32 = __crc32ch(crc, data);
    crc32c_u32(crc: u32, data: u32) -> u32 = __crc32cw(crc, data);
    crc32c_u64(crc: u32, data: u64) -> u32 = __crc32cd(crc, data);
}

group! { pmull "neon,aes"
    aes_round_16(state: u8x16, key: u8x16) -> u8x16 = u8x16::from(vaesmcq_u8(vaeseq_u8(state.into(), vdupq_n_u8(0)))).xor(key);
    aes_last_round_16(state: u8x16, key: u8x16) -> u8x16 = u8x16::from(vaeseq_u8(state.into(), vdupq_n_u8(0))).xor(key);
    aes_round_inv_16(state: u8x16, key: u8x16) -> u8x16 =
        u8x16::from(vaesimcq_u8(vaesdq_u8(state.into(), vdupq_n_u8(0)))).xor(key);
    aes_last_round_inv_16(state: u8x16, key: u8x16) -> u8x16 = u8x16::from(vaesdq_u8(state.into(), vdupq_n_u8(0))).xor(key);
    aes_inv_mix_columns_16(state: u8x16) -> u8x16 = vaesimcq_u8(state.into()).into();
    // See `opaque`. LLVM would load each half of an operand on its own.
    clmul_lower_16(a: u8x16, b: u8x16) -> u8x16 = {
        let whole = |v: u8x16| vgetq_lane_u64::<0>(vrshlq_u64(to!(u64x2, v), vdupq_n_s64(0)));
        vreinterpretq_u8_p128(vmull_p64(whole(a), whole(b))).into()
    };
    clmul_upper_16(a: u8x16, b: u8x16) -> u8x16 = {
        let whole = |v: u8x16| vreinterpretq_p64_u64(vrshlq_u64(to!(u64x2, v), vdupq_n_s64(0)));
        vreinterpretq_u8_p128(vmull_high_p64(whole(a), whole(b))).into()
    };
}

group! { sha2 "neon,sha2"
    sha1_first(abcd: u8x16, e: u8x16, w: u8x16) -> u8x16 =
        from!(u32x4, vsha1cq_u32(to!(u32x4, abcd), u32x4::from_ne_bytes(e)[0], to!(u32x4, w)));
    sha1_second(abcd: u8x16, e: u8x16, w: u8x16) -> u8x16 =
        from!(u32x4, vsha1pq_u32(to!(u32x4, abcd), u32x4::from_ne_bytes(e)[0], to!(u32x4, w)));
    sha1_third(abcd: u8x16, e: u8x16, w: u8x16) -> u8x16 =
        from!(u32x4, vsha1mq_u32(to!(u32x4, abcd), u32x4::from_ne_bytes(e)[0], to!(u32x4, w)));
    sha1_fourth(abcd: u8x16, e: u8x16, w: u8x16) -> u8x16 =
        from!(u32x4, vsha1pq_u32(to!(u32x4, abcd), u32x4::from_ne_bytes(e)[0], to!(u32x4, w)));
    sha1_next_e(abcd: u8x16, _w: u8x16) -> u8x16 =
        crate::raw::copy::from_array::<u32, 4>([vsha1h_u32(u32x4::from_ne_bytes(abcd)[0]), 0, 0, 0]).to_ne_bytes();
    sha1_schedule(a: u8x16, b: u8x16, c: u8x16, d: u8x16) -> u8x16 =
        from!(u32x4, vsha1su1q_u32(vsha1su0q_u32(to!(u32x4, a), to!(u32x4, b), to!(u32x4, c)), to!(u32x4, d)));
    sha256_rounds(abcd: u8x16, efgh: u8x16, wk: u8x16) -> (u8x16, u8x16) = {
        let (abcd, efgh, wk) = (to!(u32x4, abcd), to!(u32x4, efgh), to!(u32x4, wk));
        // One of the two needs a copy. That of LLVM delays the longer chain, and it can't see that this is one. That saves 22%
        // on Neoverse N1, V1 and V2, and costs 19% on N3, where `mov` is free, as it is on Apple's.
        let zero = if cfg!(target_vendor = "apple") { vdupq_n_u32(0) } else { vqrshlq_u32(vdupq_n_u32(0), vdupq_n_s32(0)) };
        let copy = vorrq_u32(abcd, zero);
        (from!(u32x4, vsha256hq_u32(abcd, efgh, wk)), from!(u32x4, vsha256h2q_u32(efgh, copy, wk)))
    };
    sha256_schedule(a: u8x16, b: u8x16, c: u8x16, d: u8x16) -> u8x16 =
        from!(u32x4, vsha256su1q_u32(vsha256su0q_u32(to!(u32x4, a), to!(u32x4, b)), to!(u32x4, c), to!(u32x4, d)));
}

group! { sha512 "neon,sha3"
    xor3_16(a: u8x16, b: u8x16, c: u8x16) -> u8x16 = veor3q_u8(a.into(), b.into(), c.into()).into();
    // Two rounds, the first in the upper lane: the next `ab` and `ef`. SHA512H(w, [f, g], [d, e]) adds the rest of both T1 to
    // `w`, with its upper result plus `d` as the second `e`. With `cd` in `w` and 0 for `d`, the result is the next `ef`
    // already, so that no addition is between one SHA512H and the next. SHA512H2(T1, [c, _], [a, b]) adds both T2.
    sha512_rounds(ab: u8x16, cd: u8x16, ef: u8x16, gh: u8x16, wk: u8x16) -> (u8x16, u8x16) = {
        let (ab, cd, ef, gh, wk) = (to!(u64x2, ab), to!(u64x2, cd), to!(u64x2, ef), to!(u64x2, gh), to!(u64x2, wk));
        let w = vaddq_u64(vaddq_u64(vextq_u64::<1>(wk, wk), gh), cd);
        let ef = vsha512hq_u64(w, vextq_u64::<1>(ef, gh), vextq_u64::<1>(vdupq_n_u64(0), ef));
        (from!(u64x2, vsha512h2q_u64(vsubq_u64(ef, cd), cd, ab)), from!(u64x2, ef))
    };
    // The words t and t + 1, from the pairs at t - 16, t - 14, t - 2 and t - 7.
    sha512_schedule(first: u8x16, next: u8x16, last: u8x16, seven: u8x16) -> u8x16 =
        from!(u64x2, vsha512su1q_u64(vsha512su0q_u64(to!(u64x2, first), to!(u64x2, next)), to!(u64x2, last), to!(u64x2, seven)));
}

/// `sm3ss1` reads last lanes only: `a`, `e`, and the constant, whose way there folds. The other two pick their word by index.
macro_rules! sm3_rounds { ($dcba:ident $hgfe:ident $w:ident $mixed:ident $t:ident, $($j:literal $tt1:ident $tt2:ident)*) => {{
    let (mut dcba, mut hgfe, w, mixed, t) = (to!(u32x4, $dcba), to!(u32x4, $hgfe), to!(u32x4, $w), to!(u32x4, $mixed), to!(u32x4, $t));
    $(
        let ss1 = vsm3ss1q_u32(dcba, hgfe, vextq_u32::<{ ($j + 1) % 4 }>(t, t));
        (dcba, hgfe) = (asm::$tt1(dcba, ss1, mixed), asm::$tt2(hgfe, ss1, w));
    )*
    (from!(u32x4, dcba), from!(u32x4, hgfe))
}}; }

group! { sm4 "neon,sm4"
    sm3_early(dcba: u8x16, hgfe: u8x16, w: u8x16, mixed: u8x16, t: u8x16) -> (u8x16, u8x16) =
        sm3_rounds!(dcba hgfe w mixed t, 0 tt1a_0 tt2a_0 1 tt1a_1 tt2a_1 2 tt1a_2 tt2a_2 3 tt1a_3 tt2a_3);
    sm3_late(dcba: u8x16, hgfe: u8x16, w: u8x16, mixed: u8x16, t: u8x16) -> (u8x16, u8x16) =
        sm3_rounds!(dcba hgfe w mixed t, 0 tt1b_0 tt2b_0 1 tt1b_1 tt2b_1 2 tt1b_2 tt2b_2 3 tt1b_3 tt2b_3);
    // `sm3partw1` reads words 13 to 15 from lanes 1 to 3, and gives lane 3 the part of word 16 that is in its lane 0.
    // `sm3partw2` gives it the other part. The first overwrites `w0`, which has had its rounds; `w7` is needed again.
    sm3_schedule(w0: u8x16, w7: u8x16, w12: u8x16, w10: u8x16, w3: u8x16) -> u8x16 =
        from!(u32x4, vsm3partw2q_u32(vsm3partw1q_u32(to!(u32x4, w0), to!(u32x4, w7), to!(u32x4, w12)), to!(u32x4, w10), to!(u32x4, w3)));
    sm4_rounds_16(v: u8x16, keys: u8x16) -> u8x16 = from!(u32x4, asm::sm4e(to!(u32x4, v), to!(u32x4, keys), to!(u32x4, keys)));
    sm4_keys_16(v: u8x16, constants: u8x16) -> u8x16 = from!(u32x4, vsm4ekeyq_u32(to!(u32x4, v), to!(u32x4, constants)));
}

group! { dot "neon,dotprod"
    dot_u8_u8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = from!(u32x4, vdotq_u32(to!(u32x4, sum), a.into(), b.into()));
    dot_i8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 =
        from!(i32x4, vdotq_s32(to!(i32x4, sum), to!(i8x16, a), to!(i8x16, b)));
}

// What the whole program is compiled for, as on macOS.
#[cfg(all(target_feature = "crc", target_feature = "rdm", target_feature = "dotprod"))]
lent! { no_dot "neon"
    dot_u8_u8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = crate::ops::Ops::dot_u8_u8_16(crate::kernel::compiled_for::<crate::gate::tokens::neon82>(), a, b, sum);
    dot_i8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = crate::ops::Ops::dot_i8_i8_16(crate::kernel::compiled_for::<crate::gate::tokens::neon82>(), a, b, sum);
    dot_u8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = crate::ops::Ops::dot_u8_i8_16(crate::kernel::compiled_for::<crate::gate::tokens::neon82>(), a, b, sum);
}
#[cfg(not(all(target_feature = "crc", target_feature = "rdm", target_feature = "dotprod")))]
lent! { no_dot "neon"
    // See `mul_add_i16`.
    dot_u8_u8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = {
        let (a, b): (uint8x16_t, uint8x16_t) = (a.into(), b.into());
        let (low, high) = (vmull_u8(vget_low_u8(a), vget_low_u8(b)), vmull_high_u8(a, b));
        from!(u32x4, vaddq_u32(to!(u32x4, sum), vrshlq_u32(vpaddq_u32(vpaddlq_u16(low), vpaddlq_u16(high)), vdupq_n_s32(0))))
    };
    dot_i8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = {
        let (a, b): (int8x16_t, int8x16_t) = (to!(i8x16, a), to!(i8x16, b));
        let (low, high) = (vmull_s8(vget_low_s8(a), vget_low_s8(b)), vmull_high_s8(a, b));
        from!(i32x4, vaddq_s32(to!(i32x4, sum), vrshlq_s32(vpaddq_s32(vpaddlq_s16(low), vpaddlq_s16(high)), vdupq_n_s32(0))))
    };
    // Each product fits in 16 bits.
    dot_u8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = {
        let (a, b, zero): (uint8x16_t, int16x8_t, _) = (a.into(), to!(i16x8, b), vrshlq_u8(vdupq_n_u8(0), vdupq_n_s8(0)));
        let even = vmulq_s16(vreinterpretq_s16_u8(vtrn1q_u8(a, zero)), vshrq_n_s16::<8>(vshlq_n_s16::<8>(b)));
        let odd = vmulq_s16(vreinterpretq_s16_u8(vtrn2q_u8(a, zero)), vshrq_n_s16::<8>(b));
        from!(i32x4, vpadalq_s16(vpadalq_s16(to!(i32x4, sum), even), odd))
    };
}

group! { no_i8mm "neon,dotprod"
    // a * b = (a - 128) * b - -128 * b
    dot_u8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = {
        let biased = vdotq_s32(to!(i32x4, sum), to!(i8x16, a.xor(u8x16::splat(0x80))), to!(i8x16, b));
        from!(i32x4, vsubq_s32(biased, vdotq_s32(vdupq_n_s32(0), vdupq_n_s8(-128), to!(i8x16, b))))
    };
}

group! { rdm "neon,rdm"
    mul_fixed_point_15_add_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 =
        from!(i16x8, vqrdmlahq_s16(to!(i16x8, sum), to!(i16x8, a), to!(i16x8, b)));
    mul_fixed_point_31_add_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 =
        from!(i32x4, vqrdmlahq_s32(to!(i32x4, sum), to!(i32x4, a), to!(i32x4, b)));
}

group! { fcma "neon,fcma"
    complex_mul_add_f32_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = {
        let (a, b) = (to!(f32x4, a), to!(f32x4, b));
        from!(f32x4, vcmlaq_f32(vcmlaq_rot90_f32(to!(f32x4, sum), a, b), a, b))
    };
    conjugate_mul_add_f32_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = {
        let (a, b) = (to!(f32x4, a), to!(f32x4, b));
        from!(f32x4, vcmlaq_f32(vcmlaq_rot270_f32(to!(f32x4, sum), a, b), a, b))
    };
    add_times_i_f32_16(a: u8x16, b: u8x16) -> u8x16 = from!(f32x4, vcaddq_rot90_f32(to!(f32x4, a), to!(f32x4, b)));
    sub_times_i_f32_16(a: u8x16, b: u8x16) -> u8x16 = from!(f32x4, vcaddq_rot270_f32(to!(f32x4, a), to!(f32x4, b)));
    complex_mul_add_f64_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = {
        let (a, b) = (to!(f64x2, a), to!(f64x2, b));
        from!(f64x2, vcmlaq_f64(vcmlaq_rot90_f64(to!(f64x2, sum), a, b), a, b))
    };
    conjugate_mul_add_f64_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = {
        let (a, b) = (to!(f64x2, a), to!(f64x2, b));
        from!(f64x2, vcmlaq_f64(vcmlaq_rot270_f64(to!(f64x2, sum), a, b), a, b))
    };
    add_times_i_f64_16(a: u8x16, b: u8x16) -> u8x16 = from!(f64x2, vcaddq_rot90_f64(to!(f64x2, a), to!(f64x2, b)));
    sub_times_i_f64_16(a: u8x16, b: u8x16) -> u8x16 = from!(f64x2, vcaddq_rot270_f64(to!(f64x2, a), to!(f64x2, b)));
}

group! { i8mm "neon,i8mm"
    mat_mul_i8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = from!(i32x4, vmmlaq_s32(to!(i32x4, sum), to!(i8x16, a), to!(i8x16, b)));
    mat_mul_u8_u8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = from!(u32x4, vmmlaq_u32(to!(u32x4, sum), a.into(), b.into()));
    mat_mul_u8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = from!(i32x4, vusmmlaq_s32(to!(i32x4, sum), a.into(), to!(i8x16, b)));
    dot_u8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 =
        from!(i32x4, vusdotq_s32(to!(i32x4, sum), a.into(), to!(i8x16, b)));
}

#[cfg(miri)]
group! { shared "neon" }
#[cfg(not(miri))]
lent! { shared "neon"
    load_shared_16(from: &Shared<16>) -> u8x16 = shared::load_16(from).into();
    store_shared_16(to: &Shared<16>, v: u8x16) -> () = shared::store_16(to, v.into());
    load_shared_32(from: &Shared<32>) -> u8x32 = uint8x16x2_t(shared::load_16(from.first_chunk().unwrap()), shared::load_16_of_32(from)).into();
    load_shared_64(from: &Shared<64>) -> u8x64 = uint8x16x4_t(
        shared::load_16(from.first_chunk().unwrap()),
        shared::load_16_of_32(from.first_chunk::<32>().unwrap()),
        shared::load_16_of_48(from.first_chunk::<48>().unwrap()),
        shared::load_16_of_64(from),
    ).into();
}

group! { sve2 "neon,sve2"
    match_u8_16(v: u8x16, set: u8x16) -> u8x16 = sve::match_u8(v, set);
    match_u16_16(v: u8x16, set: u8x16) -> u8x16 = sve::match_u16(v, set);
    count_u8_16(v: u8x16, set: u8x16) -> u8x16 = sve::count_u8(v, set);
    quotient_or_zero_16(a: u8x16, b: u8x16, how: (usize, bool)) -> u8x16 = if how.1 { sve::divide_signed(a, b, how.0) } else { sve::divide(a, b, how.0) };
    lanes_at_16(v: u8x16, at: u8x16, how: (usize, bool)) -> u8x16 = sve::look_up(v, at, how);
    unbounded_shift64_16(v: u8x16, by: u8x16, left: bool) -> u8x16 = sve::shift_64(v, by, left);
    power_of_64ths_16(v: u8x16, bits: u32) -> u8x16 = sve::power_of_64ths(v, bits);
    // The first product overflows for zero, infinity and NaN. `fmulx` is NaN for NaN only.
    exponent_f32_16(v: u8x16) -> u8x16 = from!(f32x4, vfmaq_n_f32(vmulxq_f32(to!(f32x4, v), vdupq_n_f32(0.0)),
        vmulq_n_f32(vcvtq_f32_s32(to!(i32x4, sve::exponent(v, 32))), f32::from_bits(227 << 23)), f32::from_bits(27 << 23)));
    exponent_f64_16(v: u8x16) -> u8x16 = from!(f64x2, vfmaq_n_f64(vmulxq_f64(to!(f64x2, v), vdupq_n_f64(0.0)),
        vmulq_n_f64(vcvtq_f64_s64(to!(i64x2, sve::exponent(v, 64))), f64::from_bits(2023 << 52)), f64::from_bits(23 << 52)));
    scale_f32_16(v: u8x16, by: u8x16) -> u8x16 = sve::scale_f32(v, by);
    scale_f64_16(v: u8x16, by: u8x16) -> u8x16 = sve::scale_f64(v, by);
    mul_high_16(a: u8x16, b: u8x16, kind: (usize, bool)) -> u8x16 = sve::mul_high(a, b, kind);
    mul_wide_16(a: u8x16, b: u8x16, kind: (usize, bool, bool)) -> u8x16 = sve::mul_wide(a, b, kind);
    add_pairs_16(a: u8x16, b: u8x16, sum: u8x16, kind: (usize, bool, bool)) -> u8x16 = sve::add_products(a, b, sum, kind);
    add_quads_16(a: u8x16, b: u8x16, sum: u8x16, signed: bool) -> u8x16 = sve::dot(a, b, sum, signed);
    up_to_first(mask: u8x16, size: usize, with: bool) -> u8x16 = sve::up_to_first(mask, size, with);
    first_match(v: u8x16, set: u8x16) -> Option<usize> = sve::first_match(v, set);
    first_lanes(n: usize, size: usize) -> u8x16 = sve::first_lanes(n, size);
    mask_none_16(v: u8x16) -> bool = sve::mask_none(v);
    mask_all_16(v: u8x16) -> bool = sve::mask_all(v);
    count_lanes(mask: u8x16, size: usize) -> usize = sve::mask_count(mask, size);
    leading_lanes(mask: u8x16, size: usize) -> usize = sve::mask_leading(mask, size);
    by_mask(v: u8x16, mask: u8x16, bits: u32) -> u8x16 = sve::compact_only(v, mask, bits as usize / 8);
    compact(v: u8x16, mask: u8x16, size: usize) -> (u8x16, usize) = sve::compact(v, mask, size, false);
    load_lanes(from: crate::sve::Lanes<'_, false>) -> u8x16 = from.load();
    load_lanes_or(from: crate::sve::Lanes<'_, false>, or: u8x16) -> u8x16 = from.load_or(or);
    load_lanes_masked(from: crate::sve::Lanes<'_, false>, mask: u8x16) -> u8x16 = from.load_masked(mask);
    store_lanes(to: crate::sve::Lanes<'_, true>, v: u8x16, mask: Option<u8x16>) -> () = to.store(v, mask);
}

macro_rules! halves { ($f:ident($($a:ident),+)) => { vreinterpretq_u8_f16($f($(vreinterpretq_f16_u8($a.into())),+)).into() }; }
group! { fp16 "neon,fp16"
    min_f16_16(a: u8x16, b: u8x16) -> u8x16 = halves!(vminnmq_f16(a, b));
    max_f16_16(a: u8x16, b: u8x16) -> u8x16 = halves!(vmaxnmq_f16(a, b));
    truncate_f16_16(v: u8x16, signed: bool) -> u8x16 = if signed { asm::truncate_s16(v.into()) } else { asm::truncate_u16(v.into()) }.into();
    nearest_f16_16(v: u8x16, signed: bool) -> u8x16 = {
        let v = vreinterpretq_f16_u8(v.into());
        if signed { from!(i16x8, vcvtnq_s16_f16(v)) } else { from!(u16x8, vcvtnq_u16_f16(v)) }
    };
    neg_f16_16(v: u8x16) -> u8x16 = halves!(vnegq_f16(v));
    abs_f16_16(v: u8x16) -> u8x16 = halves!(vabsq_f16(v));
    abs_le_f16_16(a: u8x16, b: u8x16) -> u8x16 = from!(u16x8, vcaleq_f16(vreinterpretq_f16_u8(a.into()), vreinterpretq_f16_u8(b.into())));
    or_nan_f16_16(a: u8x16, b: u8x16, max: bool) -> u8x16 = if max { halves!(vmaxq_f16(a, b)) } else { halves!(vminq_f16(a, b)) };
    add_pairs_f16_16(a: u8x16, b: u8x16) -> u8x16 = halves!(vpaddq_f16(a, b));
    extreme_of_pairs_f16_16(v: u8x16, max: bool) -> u8x16 = if max { halves!(vpmaxnmq_f16(v, v)) } else { halves!(vpminnmq_f16(v, v)) };
    f16_of_16(v: u8x16, signed: bool) -> u8x16 = vreinterpretq_u8_f16(if signed { vcvtq_f16_s16(to!(i16x8, v)) } else { vcvtq_f16_u16(to!(u16x8, v)) }).into();
    fma_f16_16(a: u8x16, b: u8x16, c: u8x16) -> u8x16 = halves!(vfmaq_f16(c, a, b));
    approximate_reciprocal_f16_16(v: u8x16) -> u8x16 = halves!(vrecpeq_f16(v));
    approximate_reciprocal_sqrt_f16_16(v: u8x16) -> u8x16 = halves!(vrsqrteq_f16(v));
}

group! { fcma16 "neon,fp16,fcma"
    complex_mul_add_f16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = { let sum: u8x16 = halves!(vcmlaq_rot90_f16(sum, a, b)); halves!(vcmlaq_f16(sum, a, b)) };
    conjugate_mul_add_f16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = { let sum: u8x16 = halves!(vcmlaq_rot270_f16(sum, a, b)); halves!(vcmlaq_f16(sum, a, b)) };
    add_times_i_f16_16(a: u8x16, b: u8x16) -> u8x16 = halves!(vcaddq_rot90_f16(a, b));
    sub_times_i_f16_16(a: u8x16, b: u8x16) -> u8x16 = halves!(vcaddq_rot270_f16(a, b));
}

group! { fhm "neon,fp16,fhm"
    wide_mul_add_f16_16(a: u8x16, b: u8x16, sum: u8x16, upper: bool) -> u8x16 = {
        let (a, b, sum) = (vreinterpretq_f16_u8(a.into()), vreinterpretq_f16_u8(b.into()), to!(f32x4, sum));
        from!(f32x4, if upper { vfmlalq_high_f16(sum, a, b) } else { vfmlalq_low_f16(sum, a, b) })
    };
}

group! { bf16 "neon,bf16"
    dot_bf16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = crate::brain_arm::dot(sum.into(), a.into(), b.into()).into();
    fused_dot_bf16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = asm::fused_dot(sum.into(), a.into(), b.into()).into();
    mat_mul_bf16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = crate::brain_arm::mat_mul(sum.into(), a.into(), b.into()).into();
    narrow_bf16_16(a: u8x16, b: u8x16) -> u8x16 = crate::brain_arm::narrow(a.into(), b.into(), b.into()).into();
}
