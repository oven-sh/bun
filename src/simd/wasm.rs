//! The targets of WebAssembly. An engine rejects a module with instructions that it lacks, so nothing is detected: a
//! target exists if the program is compiled for it.

use crate::ops::proof;
#[allow(unused_imports)]
use crate::simd::{dot, factor, has_bits, hoisted, is_known, looked_up, opaque, table, u8x16};
use core::arch::wasm32::*;
#[allow(unused_imports)]
use core::hint::select_unpredictable as pick;

pub(crate) const TABLE_BIAS: u8 = 0;
pub(crate) const LOOKS_UP_IN_REGISTERS: bool = true;

macro_rules! group {
    ($name:ident $features:literal { $($op:ident = $f:ident($($a:ident),+);)* } $($other:tt)*) => {
        proof! { wasm $name $features $($op($($a: u8x16),+) -> u8x16 = $f($($a.into()),+).into();)* $($other)* }
    };
}
/// For all targets, since the program is compiled for these.
macro_rules! everywhere {
    ({ $($op:ident = $f:ident($($a:ident),+);)* } $($other:tt)*) => {
        everywhere! { $($op($($a: u8x16),+) -> u8x16 = $f($($a.into()),+).into();)* $($other)* }
    };
    ($($op:ident($($arg:ident: $t:ty),*) -> $result:ty = $body:expr;)*) => {
        $(#[inline(always)] #[allow(unused_variables)] pub(crate) fn $op($($arg: $t),*) -> $result { crate::hints::once(#[inline(always)] move || $body) })*
        macro_rules! lend { () => {$(
            #[inline(always)]
            fn $op(self, $($arg: $t),*) -> $result { crate::wasm::$op($($arg),*) }
        )*}; }
        pub(crate) use lend;
    };
}
/// Only if `S::RELAXED`.
macro_rules! relaxed {
    ($v:expr) => {
        cfg_select! {
            target_feature = "relaxed-simd" => $v.into(),
            _ => unreachable!(),
        }
    };
}
/// The even lanes of 32 bits, and then the odd ones. After a shuffle, LLVM would multiply all 64 bits.
#[inline(always)]
fn sorted(v: u8x16, other: u8x16) -> v128 {
    factor(looked_up(v.into(), u64x2(0x0b0a_0908_0302_0100, 0x0f0e_0d0c_0706_0504)), other.into())
}
#[inline(always)]
fn upper(a: v128, b: v128, kind: (usize, bool)) -> v128 {
    let (a, b) = (factor(a, b), factor(b, a));
    match kind {
        (1, true) => {
            i8x16_narrow_i16x8(i16x8_shr(i16x8_extmul_low_i8x16(a, b), 8), i16x8_shr(i16x8_extmul_high_i8x16(a, b), 8))
        }
        (1, _) => {
            u8x16_narrow_i16x8(u16x8_shr(i16x8_extmul_low_u8x16(a, b), 8), u16x8_shr(i16x8_extmul_high_u8x16(a, b), 8))
        }
        (2, true) => {
            i16x8_shuffle::<1, 3, 5, 7, 9, 11, 13, 15>(i32x4_extmul_low_i16x8(a, b), i32x4_extmul_high_i16x8(a, b))
        }
        (2, _) => {
            i16x8_shuffle::<1, 3, 5, 7, 9, 11, 13, 15>(i32x4_extmul_low_u16x8(a, b), i32x4_extmul_high_u16x8(a, b))
        }
        (_, true) => i32x4_shuffle::<1, 3, 5, 7>(i64x2_extmul_low_i32x4(a, b), i64x2_extmul_high_i32x4(a, b)),
        _ => i32x4_shuffle::<1, 3, 5, 7>(i64x2_extmul_low_u32x4(a, b), i64x2_extmul_high_u32x4(a, b)),
    }
}

group! { simd128 "simd128" {} }
everywhere! { {
        hoisted_16 = hoisted(v, other);
        min_or_nan_f32_16 = f32x4_min(a, b);
        max_or_nan_f32_16 = f32x4_max(a, b);
        min_or_nan_f64_16 = f64x2_min(a, b);
        max_or_nan_f64_16 = f64x2_max(a, b);
        average_u8_16 = u8x16_avgr(a, b);
        average_u16_16 = u16x8_avgr(a, b);
        sums_of_2_u8_16 = i16x8_extadd_pairwise_u8x16(v);
        sums_of_2_i8_16 = i16x8_extadd_pairwise_i8x16(v);
        sums_of_2_u16_16 = i32x4_extadd_pairwise_u16x8(v);
        sums_of_2_i16_16 = i32x4_extadd_pairwise_i16x8(v);
    }
    table_16(of: u8x16, indices: u8x16) -> u8x16 = {
        let (of, indices) = table(of.into(), indices.into(), false);
        i8x16_swizzle(of, indices).into()
    };
    pack_i16_i8_16(a: u8x16, b: u8x16) -> u8x16 = i8x16_narrow_i16x8(opaque(a.into()), opaque(b.into())).into();
    pack_i16_u8_16(a: u8x16, b: u8x16) -> u8x16 = u8x16_narrow_i16x8(opaque(a.into()), opaque(b.into())).into();
    pack_i32_i16_16(a: u8x16, b: u8x16) -> u8x16 = i16x8_narrow_i32x4(opaque(a.into()), opaque(b.into())).into();
    pack_i32_u16_16(a: u8x16, b: u8x16) -> u8x16 = u16x8_narrow_i32x4(opaque(a.into()), opaque(b.into())).into();
    mul_add_i16_16(a: u8x16, b: u8x16) -> u8x16 = dot(a.into(), b.into()).into();
    // As on x86.
    sums_of_2_i32_16(v: u8x16) -> u8x16 = {
        let biased = v128_xor(v.into(), hoisted(i32x4_splat(i32::MIN), v.into()));
        i64x2_add(v128_or(biased, hoisted(u64x2_splat(!0 << 32), v.into())), u64x2_shr(biased, 32)).into()
    };
    sums_of_2_u32_16(v: u8x16) -> u8x16 = i64x2_add(v128_and(v.into(), hoisted(u64x2_splat(!0 >> 32), v.into())), u64x2_shr(v.into(), 32)).into();
    table_from_16(of: u8x16, indices: u8x16, at: (u8, bool)) -> u8x16 = {
        let (of, indices) = table(of.into(), i8x16_sub(indices.into(), hoisted(u8x16_splat(at.0), indices.into())), at.1);
        i8x16_swizzle(of, indices).into()
    };
    // Only of 16 bytes.
    mask_none_16(v: u8x16) -> bool = !has_bits(v.into());
    table_relaxed_16(of: u8x16, indices: u8x16) -> u8x16 = {
        let (indices, (of, hidden)) = (indices.into(), table(of.into(), indices.into(), false));
        let same = is_known(indices) & !v128_any_true(i8x16_gt(indices, i8x16_splat(15)));
        relaxed!(pick(same, i8x16_swizzle(of, hidden), i8x16_relaxed_swizzle(of, indices)))
    };
    extreme_relaxed_16(a: u8x16, b: u8x16, kind: (u32, bool)) -> u8x16 = relaxed!(match (kind, hoisted(a.into(), b.into()), hoisted(b.into(), a.into())) {
        ((32, false), a, b) => f32x4_relaxed_min(a, b),
        ((32, _), a, b) => f32x4_relaxed_max(a, b),
        ((_, false), a, b) => f64x2_relaxed_min(a, b),
        (_, a, b) => f64x2_relaxed_max(a, b),
    });
    dot_u7_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = {
        relaxed!(i32x4_relaxed_dot_i8x16_i7x16_add(hoisted(b.into(), a.into()), hoisted(a.into(), b.into()), sum.into()))
    };
    fma_relaxed_16(a: u8x16, b: u8x16, c: u8x16, bits: u32) -> u8x16 = {
        let (b, c) = (hoisted(b.into(), a.into()), hoisted(c.into(), a.into()));
        relaxed!(if bits == 32 { f32x4_relaxed_madd(a.into(), b, c) } else { f64x2_relaxed_madd(a.into(), b, c) })
    };
    sums_of_8_abs_diff_16(a: u8x16, b: u8x16) -> u8x16 = {
        let (a, b) = (a.into(), b.into());
        let quads = i32x4_extadd_pairwise_i16x8(i16x8_extadd_pairwise_u8x16(v128_or(u8x16_sub_sat(a, b), u8x16_sub_sat(b, a))));
        u64x2_shr(i32x4_add(quads, i64x2_shl(quads, 32)), 32).into()
    };
    // LLVM would join the booleans of several vectors, and take them one by one.
    mask_bits_16(v: u8x16, size: usize) -> u64 = match size {
        1 => i8x16_bitmask(v.into()) as u64,
        2 => i16x8_bitmask(v.into()) as u64,
        4 => i32x4_bitmask(v.into()) as u64,
        _ => i64x2_bitmask(v.into()) as u64,
    };
    mul_even_u32_16(a: u8x16, b: u8x16) -> u8x16 = i64x2_extmul_low_u32x4(sorted(a, b), sorted(b, a)).into();
    mul_even_i32_16(a: u8x16, b: u8x16) -> u8x16 = i64x2_extmul_low_i32x4(sorted(a, b), sorted(b, a)).into();
    mul_even_odd_u32_16(a: u8x16, b: u8x16) -> u8x16 = {
        i64x2_extmul_low_u32x4(sorted(a, b), looked_up(b.into(), u64x2(0x0f0e_0d0c_0706_0504, 0x0b0a_0908_0302_0100))).into()
    };
    // Only the odd lanes of 32 bits.
    mul_wide_16(a: u8x16, b: u8x16, kind: (usize, bool, bool)) -> u8x16 = {
        if kind.1 { i64x2_extmul_high_i32x4(sorted(a, b), sorted(b, a)) } else { i64x2_extmul_high_u32x4(sorted(a, b), sorted(b, a)) }.into()
    };
    mul_high_16(a: u8x16, b: u8x16, kind: (usize, bool)) -> u8x16 = upper(a.into(), b.into(), kind).into();
}

group! { strict "simd128" {
    mul_fixed_point_15_16 = i16x8_q15mulr_sat(a, b);
} }

// These differ between engines only where the result is unspecified anyway.
#[cfg(target_feature = "relaxed-simd")]
group! { relaxed "simd128,relaxed-simd" {
        mul_fixed_point_15_16 = i16x8_relaxed_q15mulr(a, b);
        truncate_f32_i32_16 = i32x4_relaxed_trunc_f32x4(v);
        truncate_f64_i32_16 = i32x4_relaxed_trunc_f64x2_zero(v);
    }
    nearest_f32_i32_16(v: u8x16) -> u8x16 = i32x4_relaxed_trunc_f32x4(f32x4_nearest(v.into())).into();
}
