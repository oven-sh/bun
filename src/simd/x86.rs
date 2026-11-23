//! The targets of x86-64.
#![allow(unused_macros, unused_imports)]

use crate::ops::{proof, set_bits, set_pairs};
use crate::simd::ToBytes;
use crate::simd::prelude::*;
use crate::width::{B16, B32, B64};
#[cfg(target_arch = "x86")]
use core::arch::x86::*;
#[cfg(target_arch = "x86_64")]
use core::arch::x86_64::*;
#[cfg(not(any(miri, target_arch = "x86")))]
use {
    crate::shared::{Shared, x86 as shared},
    core::sync::atomic::AtomicU8,
};

pub(crate) const TABLE_BIAS: u8 = 0x70;
pub(crate) const LOOKS_UP_IN_REGISTERS: bool = true;

/// The same bits, as the intrinsics take them, and back.
trait To<U> {
    fn to(self) -> U;
}
macro_rules! to {
    ($($bytes:ident: $int:ident $(, $arch:ident as $v:ident)+ $(=> $from:ident)*;)*) => {$(
        impl To<$int> for $bytes { #[inline(always)] fn to(self) -> $int { bits_or!((self), self.into()) } }
        impl To<$bytes> for $int { #[inline(always)] fn to(self) -> $bytes { bits_or!((self), self.into()) } }
        $(impl To<$arch> for $bytes { #[inline(always)] fn to(self) -> $arch { bits_or!((self), $v::from_ne_bytes(self).into()) } }
        impl To<$bytes> for $arch { #[inline(always)] fn to(self) -> $bytes { bits_or!((self), $v::from(self).to_ne_bytes()) } })+
        $(impl To<$int> for $from { #[inline(always)] fn to(self) -> $int { bits_or!((self), self.into()) } })*
    )*};
}
to! {
    u8x16: __m128i, __m128 as f32x4, __m128d as f64x2 => u64x2;
    u8x32: __m256i, __m256 as f32x8, __m256d as f64x4 => u32x8 => u64x4;
    u8x64: __m512i, __m512 as f32x16, __m512d as f64x8 => i16x32;
}

/// Operations that are one intrinsic on integer vectors, and others that are spelled out.
macro_rules! group {
    ($name:ident $features:literal { $($v:ident { $($op:ident($($p:ident),+) = $f:ident($($a:ident),+);)* })* } $($other:tt)*) => {
        proof! { x86 $name $features $($($op($($p: $v),+) -> $v = $f($($a.to()),+).to();)*)* $($other)* }
    };
}

#[inline]
#[target_feature(enable = "sse4.2")]
fn crc32c_u64(crc: u32, data: u64) -> u32 {
    cfg_select! {
        target_arch = "x86" => _mm_crc32_u32(_mm_crc32_u32(crc, data as u32), (data >> 32) as u32),
        _ => _mm_crc32_u64(crc as u64, data) as u32,
    }
}

/// An immediate operand from one of eight numbers, which is known after inlining.
macro_rules! offsets { ($f:ident, $times:literal, $a:ident, $b:ident, $k:ident) => { offsets!($f, $times, $a, $b, $k, 0 1 2 3 4 5 6) };
    ($f:ident, $times:literal, $a:ident, $b:ident, $k:ident, $($i:literal)*) => {
        match $k { $($i => $f::<{ $i * $times }>($a.to(), $b.to()).to(),)* _ => $f::<{ 7 * $times }>($a.to(), $b.to()).to() }
    };
}

/// In a register, and unknown to LLVM.
macro_rules! kept {
    ($class:ident $v:ident) => {
        cfg_select! {
            not(miri) => crate::regs::$class($v),
            _ => $v,
        }
    };
}
macro_rules! steps { ($f:ident, $from:ident, $at:ident, $step:ident, $($i:literal)*, $last:literal) => {
    match $step { $($i => crate::unaligned::$f::<$i, _>($from, $at),)* _ => crate::unaligned::$f::<$last, _>($from, $at) }
}; }

#[inline]
#[target_feature(enable = "sse2")]
fn truncate_f64_i64(v: __m128d) -> __m128i {
    #[cfg(target_arch = "x86_64")]
    return _mm_set_epi64x(_mm_cvttsd_si64(_mm_unpackhi_pd(v, v)), _mm_cvttsd_si64(v));
    #[cfg(target_arch = "x86")]
    return f64x2::from(v).cast::<i64, crate::Portable>().to_ne_bytes().to();
}

/// To LLVM, `pmuldq` is two extensions and a multiplication of 64 bits. If it moves an extension out of a loop, it multiplies
/// all 64 bits, in parts, which is slow. It only sees that this is zero after it has found the instruction.
#[rules]
macro_rules! tied {
    (@ $p:ident $v:expr) => {{
        let low = ${concat($p, _srli_epi16)}::<9>($v);
        ${concat($p, _srli_epi16)}::<15>(${concat($p, _packus_epi16)}(low, low))
    }};
    ($p:ident $f:ident($a:ident, $b:ident)) => { cfg_select! {
        any(bun_simd_unoptimized, miri) => $f($a.to(), $b.to()).to(),
        _ => {{
            let (a, b) = ($a.to(), $b.to());
            let zero = tied!(@ $p ${concat($p, _add_epi16)}(a, b));
            let it = $f(${concat($p, _add_epi8)}(a, zero), ${concat($p, _add_epi8)}(b, zero));
            ${concat($p, _add_epi8)}(it, tied!(@ $p it)).to()
        }}
    } };
}

/// Zero for a count that is too large.
macro_rules! shift {
    ($v:ident, $counts:expr, $bits:expr, $left:expr, $($size:pat => $l:ident $r:ident),+) => {{
        let (v, counts) = ($v.to(), $counts);
        match $bits { $($size => if $left { $l(v, counts) } else { $r(v, counts) },)+ }.to()
    }};
}

group! { sse2 "sse2" {
    u8x16 {
        mul_add_i16_16(a, b) = _mm_madd_epi16(a, b);
        sums_of_8_abs_diff_16(a, b) = _mm_sad_epu8(a, b);
        pack_i16_i8_16(a, b) = _mm_packs_epi16(a, b);
        pack_i16_u8_16(a, b) = _mm_packus_epi16(a, b);
        pack_i32_i16_16(a, b) = _mm_packs_epi32(a, b);
        shift_left_u64_16(v, count) = _mm_sll_epi64(v, count);
        shift_right_u64_16(v, count) = _mm_srl_epi64(v, count);
    } }
    hidden_16(v: u8x16) -> u8x16 = crate::regs::xmm(v);
    sums_of_2_i16_16(v: u8x16) -> u8x16 = _mm_madd_epi16(v.to(), _mm_set1_epi16(1)).to();
    mul_even_u32_16(a: u8x16, b: u8x16) -> u8x16 = tied!(_mm _mm_mul_epu32(a, b));
    mul_high_i16_16(a: u8x16, b: u8x16) -> u8x16 = _mm_mulhi_epi16(a.to(), b.to()).to();
    mul_high_u16_16(a: u8x16, b: u8x16) -> u8x16 = _mm_mulhi_epu16(a.to(), b.to()).to();
    average_u8_16(a: u8x16, b: u8x16) -> u8x16 = _mm_avg_epu8(a.to(), b.to()).to();
    average_u16_16(a: u8x16, b: u8x16) -> u8x16 = _mm_avg_epu16(a.to(), b.to()).to();
    min_f32_16(a: u8x16, b: u8x16) -> u8x16 = _mm_min_ps(a.to(), b.to()).to();
    max_f32_16(a: u8x16, b: u8x16) -> u8x16 = _mm_max_ps(a.to(), b.to()).to();
    min_f64_16(a: u8x16, b: u8x16) -> u8x16 = _mm_min_pd(a.to(), b.to()).to();
    max_f64_16(a: u8x16, b: u8x16) -> u8x16 = _mm_max_pd(a.to(), b.to()).to();
    sqrt_f32_16(v: u8x16) -> u8x16 = _mm_sqrt_ps(v.to()).to();
    sqrt_f64_16(v: u8x16) -> u8x16 = _mm_sqrt_pd(v.to()).to();
    truncate_f32_i32_16(v: u8x16) -> u8x16 = _mm_cvttps_epi32(v.to()).to();
    approximate_reciprocal_16(v: u8x16) -> u8x16 = _mm_rcp_ps(v.to()).to();
    approximate_reciprocal_sqrt_16(v: u8x16) -> u8x16 = _mm_rsqrt_ps(v.to()).to();
    nearest_f32_i32_16(v: u8x16) -> u8x16 = _mm_cvtps_epi32(v.to()).to();
    truncate_f64_i64_16(v: u8x16) -> u8x16 = truncate_f64_i64(v.to()).to();
    nearest_f64_i32_16(v: u8x16) -> u8x16 = _mm_cvtpd_epi32(v.to()).to();
    truncate_f64_i32_16(v: u8x16) -> u8x16 = _mm_cvttpd_epi32(v.to()).to();
    sign_bits32_16(v: u8x16) -> u64 = _mm_movemask_ps(v.to()) as u32 as u64;
    sign_bits64_16(v: u8x16) -> u64 = _mm_movemask_pd(v.to()) as u32 as u64;
    shift_all_16(v: u8x16, how: (u32, bool, u32)) -> u8x16 = shift!(v, _mm_cvtsi32_si128(how.2 as i32), how.0, how.1,
        16 => _mm_sll_epi16 _mm_srl_epi16, 32 => _mm_sll_epi32 _mm_srl_epi32, _ => _mm_sll_epi64 _mm_srl_epi64);
}

/// What the whole program is compiled for, `Portable` has too.
macro_rules! lend {
    (sse2) => { crate::x86::lend! { sse2
        (a, b) -> u8x16: mul_add_i16_16 mul_high_i16_16 mul_high_u16_16 sums_of_8_abs_diff_16 average_u8_16 average_u16_16 pack_i16_i8_16 pack_i16_u8_16
            pack_i32_i16_16 shift_left_u64_16 shift_right_u64_16 mul_even_u32_16 min_f32_16 max_f32_16 min_f64_16 max_f64_16;
        (v) -> u8x16: sums_of_2_i16_16 truncate_f32_i32_16 approximate_reciprocal_16 approximate_reciprocal_sqrt_16 nearest_f32_i32_16 truncate_f64_i64_16
            nearest_f64_i32_16 truncate_f64_i32_16 hidden_16 sqrt_f32_16 sqrt_f64_16;
        (v) -> u64: sign_bits32_16 sign_bits64_16;
    }
        #[inline(always)]
        fn shift_all_16(self, v: u8x16, how: (u32, bool, u32)) -> u8x16 { crate::kernel::compiled_for::<crate::gate::tokens::sse2>().shift_all_16(v, how) }
        #[inline(always)]
        fn load_shared_16(self, from: &Shared<16>) -> u8x16 { crate::kernel::compiled_for::<crate::gate::tokens::sse2>().load_shared_16(from) }
        #[inline(always)]
        fn store_shared_16(self, to: &Shared<16>, v: u8x16) { crate::kernel::compiled_for::<crate::gate::tokens::sse2>().store_shared_16(to, v) }
    };
    (sse4) => { crate::x86::lend! { sse4
        (a, b) -> u8x16: table_16 mul_add_u8_i8_16 mul_fixed_point_15_16 sign_i8_16 sign_i16_16 sign_i32_16 pack_i32_u16_16 mul_even_i32_16
            match_u8_16 match_u16_16 match_nonzero_u8_16 match_nonzero_u16_16;
        (v) -> u8x16: sums_of_2_u8_16 sums_of_2_i8_16;
    } };
    ($from:ident $($args:tt -> $result:ty: $($op:ident)*;)*) => { $($(crate::x86::lend! { $from $op $args $result })*)* };
    ($from:ident $op:ident ($($a:ident),+) $result:ty) => {
        #[inline(always)]
        fn $op(self, $($a: u8x16),+) -> $result { crate::kernel::compiled_for::<crate::gate::tokens::$from>().$op($($a),+) }
    };
}
pub(crate) use lend;

group! { sse4 "sse4.2" {
    u8x16 {
        table_16(table, indices) = _mm_shuffle_epi8(table, indices);
        mul_add_u8_i8_16(a, b) = _mm_maddubs_epi16(a, b);
        mul_fixed_point_15_16(a, b) = _mm_mulhrs_epi16(a, b);
        sign_i8_16(v, of) = _mm_sign_epi8(v, of);
        sign_i16_16(v, of) = _mm_sign_epi16(v, of);
        sign_i32_16(v, of) = _mm_sign_epi32(v, of);
        pack_i32_u16_16(a, b) = _mm_packus_epi32(a, b);
    } }
    adjacent_quads_16(a: u8x16, b: u8x16, offsets: u64) -> u8x16 = offsets!(_mm_mpsadbw_epu8, 1, a, b, offsets);
    sums_of_2_u8_16(v: u8x16) -> u8x16 = _mm_maddubs_epi16(v.to(), _mm_set1_epi8(1)).to();
    sums_of_2_i8_16(v: u8x16) -> u8x16 = _mm_maddubs_epi16(_mm_set1_epi8(1), v.to()).to();
    mul_even_i32_16(a: u8x16, b: u8x16) -> u8x16 = tied!(_mm _mm_mul_epi32(a, b));
    floor_f32_16(v: u8x16) -> u8x16 = _mm_round_ps::<9>(v.to()).to();
    ceil_f32_16(v: u8x16) -> u8x16 = _mm_round_ps::<10>(v.to()).to();
    trunc_f32_16(v: u8x16) -> u8x16 = _mm_round_ps::<11>(v.to()).to();
    even_f32_16(v: u8x16) -> u8x16 = _mm_round_ps::<8>(v.to()).to();
    floor_f64_16(v: u8x16) -> u8x16 = _mm_round_pd::<9>(v.to()).to();
    ceil_f64_16(v: u8x16) -> u8x16 = _mm_round_pd::<10>(v.to()).to();
    trunc_f64_16(v: u8x16) -> u8x16 = _mm_round_pd::<11>(v.to()).to();
    even_f64_16(v: u8x16) -> u8x16 = _mm_round_pd::<8>(v.to()).to();
    match_u8_16(v: u8x16, set: u8x16) -> u8x16 = _mm_cmpestrm::<0x40>(set.to(), 16, v.to(), 16).to();
    match_u16_16(v: u8x16, set: u8x16) -> u8x16 = _mm_cmpestrm::<0x41>(set.to(), 8, v.to(), 8).to();
    match_nonzero_u8_16(v: u8x16, set: u8x16) -> u8x16 = _mm_cmpistrm::<0x40>(set.to(), v.to()).to();
    match_nonzero_u16_16(v: u8x16, set: u8x16) -> u8x16 = _mm_cmpistrm::<0x41>(set.to(), v.to()).to();
    crc32c_u8(crc: u32, data: u8) -> u32 = _mm_crc32_u8(crc, data);
    crc32c_u16(crc: u32, data: u16) -> u32 = _mm_crc32_u16(crc, data);
    crc32c_u32(crc: u32, data: u32) -> u32 = _mm_crc32_u32(crc, data);
    crc32c_u64(crc: u32, data: u64) -> u32 = crc32c_u64(crc, data);
}

group! { clmul_16 "pclmulqdq,aes" {}
    aes_round_16(state: u8x16, key: u8x16) -> u8x16 = _mm_aesenc_si128(state.to(), key.to()).to();
    aes_last_round_16(state: u8x16, key: u8x16) -> u8x16 = _mm_aesenclast_si128(state.to(), key.to()).to();
    aes_round_inv_16(state: u8x16, key: u8x16) -> u8x16 = _mm_aesdec_si128(state.to(), key.to()).to();
    aes_last_round_inv_16(state: u8x16, key: u8x16) -> u8x16 = _mm_aesdeclast_si128(state.to(), key.to()).to();
    aes_inv_mix_columns_16(state: u8x16) -> u8x16 = _mm_aesimc_si128(state.to()).to();
    clmul_lower_16(a: u8x16, b: u8x16) -> u8x16 = _mm_clmulepi64_si128::<0x00>(a.to(), b.to()).to();
    clmul_upper_16(a: u8x16, b: u8x16) -> u8x16 = _mm_clmulepi64_si128::<0x11>(a.to(), b.to()).to();
}
group! { sha "sha,ssse3" { u8x16 { sha1_next_e(abcd, w) = _mm_sha1nexte_epu32(abcd, w); } }
    sha1_first(abcd: u8x16, _e: u8x16, w: u8x16) -> u8x16 = _mm_sha1rnds4_epu32::<0>(abcd.to(), w.to()).to();
    sha1_second(abcd: u8x16, _e: u8x16, w: u8x16) -> u8x16 = _mm_sha1rnds4_epu32::<1>(abcd.to(), w.to()).to();
    sha1_third(abcd: u8x16, _e: u8x16, w: u8x16) -> u8x16 = _mm_sha1rnds4_epu32::<2>(abcd.to(), w.to()).to();
    sha1_fourth(abcd: u8x16, _e: u8x16, w: u8x16) -> u8x16 = _mm_sha1rnds4_epu32::<3>(abcd.to(), w.to()).to();
    sha1_schedule(a: u8x16, b: u8x16, c: u8x16, d: u8x16) -> u8x16 =
        _mm_sha1msg2_epu32(_mm_xor_si128(_mm_sha1msg1_epu32(a.to(), b.to()), c.to()), d.to()).to();
    sha256_rounds(abef: u8x16, cdgh: u8x16, wk: u8x16) -> (u8x16, u8x16) = {
        let cdgh = _mm_sha256rnds2_epu32(cdgh.to(), abef.to(), wk.to());
        (_mm_sha256rnds2_epu32(abef.to(), cdgh, _mm_shuffle_epi32::<0x0e>(wk.to())).to(), cdgh.to())
    };
    sha256_schedule(a: u8x16, b: u8x16, c: u8x16, d: u8x16) -> u8x16 = {
        let sum = _mm_add_epi32(_mm_sha256msg1_epu32(a.to(), b.to()), _mm_alignr_epi8::<4>(d.to(), c.to()));
        _mm_sha256msg2_epu32(sum, d.to()).to()
    };
}
group! { clmul_32 "avx2,vpclmulqdq,vaes" {}
    aes_round_32(state: u8x32, key: u8x32) -> u8x32 = _mm256_aesenc_epi128(state.to(), key.to()).to();
    aes_last_round_32(state: u8x32, key: u8x32) -> u8x32 = _mm256_aesenclast_epi128(state.to(), key.to()).to();
    aes_round_inv_32(state: u8x32, key: u8x32) -> u8x32 = _mm256_aesdec_epi128(state.to(), key.to()).to();
    aes_last_round_inv_32(state: u8x32, key: u8x32) -> u8x32 = _mm256_aesdeclast_epi128(state.to(), key.to()).to();
    // The last round of the encryption is what a round of the decryption undoes first.
    aes_inv_mix_columns_32(state: u8x32) -> u8x32 =
        _mm256_aesdec_epi128(_mm256_aesenclast_epi128(state.to(), _mm256_setzero_si256()), _mm256_setzero_si256()).to();
    clmul_lower_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_clmulepi64_epi128::<0x00>(a.to(), b.to()).to();
    clmul_upper_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_clmulepi64_epi128::<0x11>(a.to(), b.to()).to();
}
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))]
group! { clmul_64 "avx512f,vpclmulqdq,vaes" {}
    aes_round_64(state: u8x64, key: u8x64) -> u8x64 = _mm512_aesenc_epi128(state.to(), key.to()).to();
    aes_last_round_64(state: u8x64, key: u8x64) -> u8x64 = _mm512_aesenclast_epi128(state.to(), key.to()).to();
    aes_round_inv_64(state: u8x64, key: u8x64) -> u8x64 = _mm512_aesdec_epi128(state.to(), key.to()).to();
    aes_last_round_inv_64(state: u8x64, key: u8x64) -> u8x64 = _mm512_aesdeclast_epi128(state.to(), key.to()).to();
    aes_inv_mix_columns_64(state: u8x64) -> u8x64 =
        _mm512_aesdec_epi128(_mm512_aesenclast_epi128(state.to(), _mm512_setzero_si512()), _mm512_setzero_si512()).to();
    clmul_lower_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_clmulepi64_epi128::<0x00>(a.to(), b.to()).to();
    clmul_upper_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_clmulepi64_epi128::<0x11>(a.to(), b.to()).to();
}

#[inline]
#[target_feature(enable = "bmi2")]
fn low_bits(n: u32) -> u64 {
    cfg_select! {
        target_arch = "x86" => crate::partial::first_bits(n as usize, 64),
        _ => _bzhi_u64(!0, n),
    }
}

#[inline]
#[target_feature(enable = "bmi2")]
fn move_bits(bits: u64, at: u64, apart: bool) -> u64 {
    cfg_select! {
        target_arch = "x86" => {{
            let (low, high) = (at as u32, (at >> 32) as u32);
            if apart {
                _pdep_u32(bits as u32, low) as u64 | (_pdep_u32((bits >> low.count_ones()) as u32, high) as u64) << 32
            } else {
                _pext_u32(bits as u32, low) as u64 | (_pext_u32((bits >> 32) as u32, high) as u64) << low.count_ones()
            }
        }}
        _ => {
            if apart {
                _pdep_u64(bits, at)
            } else {
                _pext_u64(bits, at)
            }
        }
    }
}
group! { bmi "bmi2" {}
    deposit(bits: u64, at: u64) -> u64 = move_bits(bits, at, true);
    extract(bits: u64, at: u64) -> u64 = move_bits(bits, at, false);
}
group! { avx2 "avx2,bmi2" {
    u8x32 {
        table_32(table, indices) = _mm256_shuffle_epi8(table, indices);
        mul_add_i16_32(a, b) = _mm256_madd_epi16(a, b);
        mul_add_u8_i8_32(a, b) = _mm256_maddubs_epi16(a, b);
        mul_fixed_point_15_32(a, b) = _mm256_mulhrs_epi16(a, b);
        sums_of_8_abs_diff_32(a, b) = _mm256_sad_epu8(a, b);
        sign_i8_32(v, of) = _mm256_sign_epi8(v, of);
        sign_i16_32(v, of) = _mm256_sign_epi16(v, of);
        sign_i32_32(v, of) = _mm256_sign_epi32(v, of);
        pack_i16_i8_32(a, b) = _mm256_packs_epi16(a, b);
        pack_i16_u8_32(a, b) = _mm256_packus_epi16(a, b);
        pack_i32_i16_32(a, b) = _mm256_packs_epi32(a, b);
        pack_i32_u16_32(a, b) = _mm256_packus_epi32(a, b);
        lookup32_32(table, indices) = _mm256_permutevar8x32_epi32(table, indices);
    } }
    adjacent_quads_32(a: u8x32, b: u8x32, offsets: u64) -> u8x32 = offsets!(_mm256_mpsadbw_epu8, 9, a, b, offsets);
    hidden_32(v: u8x32) -> u8x32 = crate::regs::ymm(v);
    gather_four_32(from: &[u8], at: u8x32, step: usize) -> u8x32 = steps!(four_32, from, at, step, 1, 4);
    load_words_16(from: &[u8]) -> u8x16 = crate::maskmov::load_16(from);
    load_words_32(from: &[u8]) -> u8x32 = crate::maskmov::load_32(from);
    store_words_16(v: u8x16, to: &mut [u8]) -> () = crate::maskmov::store_16(v, to);
    store_words_32(v: u8x32, to: &mut [u8]) -> () = crate::maskmov::store_32(v, to);
    sums_of_2_u8_32(v: u8x32) -> u8x32 = _mm256_maddubs_epi16(v.to(), _mm256_set1_epi8(1)).to();
    sums_of_2_i8_32(v: u8x32) -> u8x32 = _mm256_maddubs_epi16(_mm256_set1_epi8(1), v.to()).to();
    sums_of_2_i16_32(v: u8x32) -> u8x32 = _mm256_madd_epi16(v.to(), _mm256_set1_epi16(1)).to();
    mul_even_u32_32(a: u8x32, b: u8x32) -> u8x32 = tied!(_mm256 _mm256_mul_epu32(a, b));
    mul_high_i16_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_mulhi_epi16(a.to(), b.to()).to();
    mul_high_u16_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_mulhi_epu16(a.to(), b.to()).to();
    average_u8_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_avg_epu8(a.to(), b.to()).to();
    average_u16_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_avg_epu16(a.to(), b.to()).to();
    mul_even_i32_32(a: u8x32, b: u8x32) -> u8x32 = tied!(_mm256 _mm256_mul_epi32(a, b));
    min_f32_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_min_ps(a.to(), b.to()).to();
    max_f32_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_max_ps(a.to(), b.to()).to();
    min_f64_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_min_pd(a.to(), b.to()).to();
    max_f64_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_max_pd(a.to(), b.to()).to();
    truncate_f32_i32_32(v: u8x32) -> u8x32 = _mm256_cvttps_epi32(v.to()).to();
    approximate_reciprocal_32(v: u8x32) -> u8x32 = _mm256_rcp_ps(v.to()).to();
    approximate_reciprocal_sqrt_32(v: u8x32) -> u8x32 = _mm256_rsqrt_ps(v.to()).to();
    nearest_f32_i32_32(v: u8x32) -> u8x32 = _mm256_cvtps_epi32(v.to()).to();
    nearest_f64_i32_32(v: u8x32) -> u8x32 = _mm256_zextsi128_si256(_mm256_cvtpd_epi32(v.to())).to();
    truncate_f64_i32_32(v: u8x32) -> u8x32 =
        _mm256_zextsi128_si256(_mm256_cvttpd_epi32(v.to())).to();
    sqrt_f32_32(v: u8x32) -> u8x32 = _mm256_sqrt_ps(v.to()).to();
    sqrt_f64_32(v: u8x32) -> u8x32 = _mm256_sqrt_pd(v.to()).to();
    floor_f32_32(v: u8x32) -> u8x32 = _mm256_round_ps::<9>(v.to()).to();
    ceil_f32_32(v: u8x32) -> u8x32 = _mm256_round_ps::<10>(v.to()).to();
    trunc_f32_32(v: u8x32) -> u8x32 = _mm256_round_ps::<11>(v.to()).to();
    even_f32_32(v: u8x32) -> u8x32 = _mm256_round_ps::<8>(v.to()).to();
    floor_f64_32(v: u8x32) -> u8x32 = _mm256_round_pd::<9>(v.to()).to();
    ceil_f64_32(v: u8x32) -> u8x32 = _mm256_round_pd::<10>(v.to()).to();
    trunc_f64_32(v: u8x32) -> u8x32 = _mm256_round_pd::<11>(v.to()).to();
    even_f64_32(v: u8x32) -> u8x32 = _mm256_round_pd::<8>(v.to()).to();
    sign_bits64_32(v: u8x32) -> u64 = _mm256_movemask_pd(v.to()) as u32 as u64;
    low_bits(n: u32) -> u64 = low_bits(n);
    lookup64_16(table: u8x16, indices: u8x16) -> u8x16 =
        _mm_permutevar_pd(table.to(), _mm_slli_epi64::<1>(indices.to())).to();
    lookup32_16(table: u8x16, indices: u8x16) -> u8x16 =
        _mm_permutevar_ps(table.to(), indices.to()).to();
    shift_all_32(v: u8x32, how: (u32, bool, u32)) -> u8x32 = shift!(v, _mm_cvtsi32_si128(how.2 as i32), how.0, how.1,
        16 => _mm256_sll_epi16 _mm256_srl_epi16, 32 => _mm256_sll_epi32 _mm256_srl_epi32, _ => _mm256_sll_epi64 _mm256_srl_epi64);
    shift_each_16(v: u8x16, counts: u8x16, how: (u32, bool)) -> u8x16 = shift!(v, counts.to(), how.0, how.1, 32 => _mm_sllv_epi32 _mm_srlv_epi32, _ => _mm_sllv_epi64 _mm_srlv_epi64);
    shift_each_32(v: u8x32, counts: u8x32, how: (u32, bool)) -> u8x32 = shift!(v, counts.to(), how.0, how.1, 32 => _mm256_sllv_epi32 _mm256_srlv_epi32, _ => _mm256_sllv_epi64 _mm256_srlv_epi64);
}

group! { sse4_only "sse4.2" {}
    // See `avx2_only`.
    truncate_f64_u64_16(v: u8x16) -> u8x16 = {
        let v = u64x2::from_ne_bytes(v);
        let (top, count): (__m128i, __m128i) = (v.shl_by(11).or(Simd::splat(1 << 63)).to(), Simd::splat(1086).sub(v.shr_by(52)).to());
        _mm_blend_epi16::<0xf0>(_mm_srl_epi64(top, count), _mm_srl_epi64(top, _mm_unpackhi_epi64(count, count))).to()
    };
}

group! { avx2_only "avx2" {}
    // The significand at the top, shifted right. A count of 64 or more gives zero: for all that is out of range, too.
    truncate_f64_u64_16(v: u8x16) -> u8x16 = {
        let v = u64x2::from_ne_bytes(v);
        _mm_srlv_epi64(v.shl_by(11).or(Simd::splat(1 << 63)).to(), Simd::splat(1086).sub(v.shr_by(52)).to()).to()
    };
    truncate_f64_u64_32(v: u8x32) -> u8x32 = {
        let v = u64x4::from_ne_bytes(v);
        _mm256_srlv_epi64(v.shl_by(11).or(Simd::splat(1 << 63)).to(), Simd::splat(1086).sub(v.shr_by(52)).to()).to()
    };
    lookup64_32(table: u8x32, indices: u8x32) -> u8x32 = {
        let twice = u32x8::from_ne_bytes(indices).shl_by(1);
        let pairs = simd_swizzle!(twice, [0, 0, 2, 2, 4, 4, 6, 6]).or(crate::raw::copy::from_array::<u32, 8>([0, 1, 0, 1, 0, 1, 0, 1]));
        _mm256_permutevar8x32_epi32(table.to(), pairs.to()).to()
    };
    lookup32_in_two_32(a: u8x32, b: u8x32, indices: u8x32) -> u8x32 = {
        let from = |table: u8x32| _mm256_castsi256_ps(_mm256_permutevar8x32_epi32(table.to(), indices.to()));
        let in_b = _mm256_castsi256_ps(_mm256_slli_epi32::<28>(indices.to()));
        _mm256_blendv_ps(from(a), from(b), in_b).to()
    };
    lookup64_in_two_32(a: u8x32, b: u8x32, indices: u8x32) -> u8x32 = {
        let twice = u32x8::from_ne_bytes(indices).shl_by(1);
        let pairs = simd_swizzle!(twice, [0, 0, 2, 2, 4, 4, 6, 6]).or(crate::raw::copy::from_array::<u32, 8>([0, 1, 0, 1, 0, 1, 0, 1]));
        let from = |table: u8x32| _mm256_castsi256_pd(_mm256_permutevar8x32_epi32(table.to(), pairs.to()));
        let in_b = _mm256_castsi256_pd(_mm256_slli_epi64::<61>(indices.to()));
        _mm256_blendv_pd(from(a), from(b), in_b).to()
    };
    compress32_32(v: u8x32, bits: u64) -> u8x32 =
        _mm256_permutevar8x32_epi32(v.to(), set_bits(bits).cast::<u32, _>().to()).to();
    compress64_32(v: u8x32, bits: u64) -> u8x32 =
        _mm256_permutevar8x32_epi32(v.to(), set_pairs(bits).cast::<u32, _>().to()).to();
}

/// Zero, which LLVM doesn't know.
macro_rules! hidden_zero {
    (16) => {
        __m128i::from(crate::regs::xmm(Simd::splat(0)))
    };
    (32) => {
        __m256i::from(crate::regs::ymm(Simd::splat(0)))
    };
    (64) => {
        __m512i::from(crate::regs::zmm(Simd::splat(0)))
    };
}

/// All lanes of zero are `0.0`, which LLVM doesn't know. Unlike `asm!`, this leaves all loops.
macro_rules! all {
    ($class:ident, $bytes:tt) => {
        $class::<2>(Simd::<u8, $bytes>::splat(0).to())
    };
}

/// On Sapphire Rapids, `vpmullq` waits for the old value of its destination. With a mask, that is a copy of a constant.
macro_rules! mul64 {
    ($t:ident, $class:ident, $bytes:tt, $a:ident, $b:ident) => {{
        let (a, b) = ($t::from_ne_bytes($a), $t::from_ne_bytes($b));
        let all = if cfg!(miri) { !0 } else { all!($class, $bytes) };
        Mask::<i64, { $bytes / 8 }>::from_bitmask(all as u64)
            .select(a.mul(b), $t::from(hidden_zero!($bytes)))
            .to_ne_bytes()
    }};
}

macro_rules! funnel {
    ($high:ident, $low:ident, $counts:ident, $how:ident, $l16:ident $r16:ident $l32:ident $r32:ident $l64:ident $r64:ident) => {{
        let (high, low, counts) = ($high.to(), $low.to(), $counts.to());
        match $how {
            (16, true) => $l16(high, low, counts),
            (32, true) => $l32(high, low, counts),
            (_, true) => $l64(high, low, counts),
            (16, false) => $r16(low, high, counts),
            (32, false) => $r32(low, high, counts),
            (_, false) => $r64(low, high, counts),
        }
        .to()
    }};
}

/// The same for `vrange`, which goes to the place of `a`.
macro_rules! range {
    ($range:ident, $class:ident, $bytes:tt, $a:ident, $b:ident, $max:ident) => {{
        let all = all!($class, $bytes);
        if $max { $range::<5>($a, all, $a, $b) } else { $range::<4>($a, all, $a, $b) }
    }};
}

macro_rules! toward {
    ($mode:expr, $f:ident($($a:ident),+)) => { toward!($mode, $f($($a),+) 8) };
    ($mode:expr, $f:ident($($a:ident),+) $quiet:literal) => { toward!(@ $mode, $f($($a.to()),+) $quiet).to() };
    (@ $mode:expr, $f:ident($($a:expr),+) $quiet:literal) => {
        match $mode {
            crate::Round::TiesEven => $f::<$quiet>($($a),+),
            crate::Round::Down => $f::<{ $quiet + 1 }>($($a),+),
            crate::Round::Up => $f::<{ $quiet + 2 }>($($a),+),
            crate::Round::TowardZero => $f::<{ $quiet + 3 }>($($a),+),
        }
    };
}
#[allow(unused_imports)]
use crate::rounding::{ADD, DIV, MUL, SQRT};

/// NaN becomes zero. What is too small gives the smallest integer by itself.
#[rules]
macro_rules! saturated {
    ($p:ident $bytes:tt, $v:ident, $how:ident) => {
        if $how.0 {
            let (v, max) = ($v.to(), Simd::<i64, { $bytes / 8 }>::splat(i64::MAX).into());
            let (fits, v) = (${concat($p, _cmp_pd_mask)}::<_CMP_NGE_UQ>(v, ${concat($p, _set1_pd)}(9223372036854775808.0)), ${concat($p, _fixupimm_pd)}::<0>(v, v, Simd::<u32, { $bytes / 4 }>::splat(0x88).into()));
            if $how.1 { ${concat($p, _mask_cvtpd_epi64)}(max, fits, v) } else { ${concat($p, _mask_cvttpd_epi64)}(max, fits, v) }.to()
        } else {
            let (v, max) = ($v.to(), Simd::<i32, { $bytes / 4 }>::splat(i32::MAX).into());
            let (fits, v) = (${concat($p, _cmp_ps_mask)}::<_CMP_NGE_UQ>(v, ${concat($p, _set1_ps)}(2147483648.0)), ${concat($p, _fixupimm_ps)}::<0>(v, v, Simd::<u32, { $bytes / 4 }>::splat(0x88).into()));
            if $how.1 { ${concat($p, _mask_cvtps_epi32)}(max, fits, v) } else { ${concat($p, _mask_cvttps_epi32)}(max, fits, v) }.to()
        }
    };
}

/// If one is NaN, `a`.
#[rules]
macro_rules! magnitude {
    ($p:ident, $a:ident, $b:ident, $how:ident) => {
        if $how.0 {
            let (a, b) = ($a.to(), $b.to());
            let numbers = ${concat($p, _cmp_pd_mask)}::<_CMP_ORD_Q>(a, b);
            if $how.1 { ${concat($p, _mask_range_pd)}::<7>(a, numbers, a, b) } else { ${concat($p, _mask_range_pd)}::<6>(a, numbers, a, b) }.to()
        } else {
            let (a, b) = ($a.to(), $b.to());
            let numbers = ${concat($p, _cmp_ps_mask)}::<_CMP_ORD_Q>(a, b);
            if $how.1 { ${concat($p, _mask_range_ps)}::<7>(a, numbers, a, b) } else { ${concat($p, _mask_range_ps)}::<6>(a, numbers, a, b) }.to()
        }
    };
}

#[rules]
macro_rules! scale_from {
    ($p:ident, $v:ident, $by:ident, $least:ident, $double:ident) => {
        if $double {
            ${concat($p, _maskz_scalef_pd)}(${concat($p, _cmp_pd_mask)}::<_CMP_NLT_UQ>($by.to(), $least.to()), $v.to(), $by.to()).to()
        } else {
            ${concat($p, _maskz_scalef_ps)}(${concat($p, _cmp_ps_mask)}::<_CMP_NLT_UQ>($by.to(), $least.to()), $v.to(), $by.to()).to()
        }
    };
}

macro_rules! class {
    ($expand:ident, $class:ident, $v:expr, $kind:ident) => {
        $expand(match $kind {
            core::num::FpCategory::Infinite => $class::<0x18>($v),
            core::num::FpCategory::Subnormal => $class::<0x20>($v),
            core::num::FpCategory::Normal => $class::<0xbf>($v),
            _ => $class::<0x99>($v),
        })
        .to()
    };
}

#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))]
group! { avx512 "bmi2,avx512bw,avx512vl,avx512dq" {
    u8x64 {
        table_64(table, indices) = _mm512_shuffle_epi8(table, indices);
        mul_add_i16_64(a, b) = _mm512_madd_epi16(a, b);
        mul_add_u8_i8_64(a, b) = _mm512_maddubs_epi16(a, b);
        mul_fixed_point_15_64(a, b) = _mm512_mulhrs_epi16(a, b);
        sums_of_8_abs_diff_64(a, b) = _mm512_sad_epu8(a, b);
        pack_i16_i8_64(a, b) = _mm512_packs_epi16(a, b);
        pack_i16_u8_64(a, b) = _mm512_packus_epi16(a, b);
        pack_i32_i16_64(a, b) = _mm512_packs_epi32(a, b);
        pack_i32_u16_64(a, b) = _mm512_packus_epi32(a, b);
        lookup16_in_two_64(a, b, indices) = _mm512_permutex2var_epi16(a, indices, b);
        lookup32_in_two_64(a, b, indices) = _mm512_permutex2var_epi32(a, indices, b);
        lookup64_in_two_64(a, b, indices) = _mm512_permutex2var_epi64(a, indices, b);
        lookup16_64(table, indices) = _mm512_permutexvar_epi16(indices, table);
        lookup32_64(table, indices) = _mm512_permutexvar_epi32(indices, table);
        lookup64_64(table, indices) = _mm512_permutexvar_epi64(indices, table);
        rotate32_64(v, right) = _mm512_rorv_epi32(v, right);
        rotate64_64(v, right) = _mm512_rorv_epi64(v, right);
    }
    u8x32 {
        lookup16_in_two_32(a, b, indices) = _mm256_permutex2var_epi16(a, indices, b);
        lookup32_in_two_32(a, b, indices) = _mm256_permutex2var_epi32(a, indices, b);
        lookup64_in_two_32(a, b, indices) = _mm256_permutex2var_epi64(a, indices, b);
        lookup16_32(table, indices) = _mm256_permutexvar_epi16(indices, table);
        lookup64_32(table, indices) = _mm256_permutexvar_epi64(indices, table);
        rotate32_32(v, right) = _mm256_rorv_epi32(v, right);
        rotate64_32(v, right) = _mm256_rorv_epi64(v, right);
    }
    u8x16 {
        lookup16_in_two_16(a, b, indices) = _mm_permutex2var_epi16(a, indices, b);
        lookup32_in_two_16(a, b, indices) = _mm_permutex2var_epi32(a, indices, b);
        lookup64_in_two_16(a, b, indices) = _mm_permutex2var_epi64(a, indices, b);
        lookup16_16(table, indices) = _mm_permutexvar_epi16(indices, table);
        rotate32_16(v, right) = _mm_rorv_epi32(v, right);
        rotate64_16(v, right) = _mm_rorv_epi64(v, right);
    } }
    rounded(a: u8x64, b: u8x64, c: u8x64, how: (u8, bool, crate::Round)) -> u8x64 = match (how.0, how.1) {
        (ADD, false) => toward!(how.2, _mm512_add_round_ps(a, b)),
        (MUL, false) => toward!(how.2, _mm512_mul_round_ps(a, b)),
        (DIV, false) => toward!(how.2, _mm512_div_round_ps(a, b)),
        (SQRT, false) => toward!(how.2, _mm512_sqrt_round_ps(a)),
        (_, false) => toward!(how.2, _mm512_fmadd_round_ps(a, b, c)),
        (ADD, true) => toward!(how.2, _mm512_add_round_pd(a, b)),
        (MUL, true) => toward!(how.2, _mm512_mul_round_pd(a, b)),
        (DIV, true) => toward!(how.2, _mm512_div_round_pd(a, b)),
        (SQRT, true) => toward!(how.2, _mm512_sqrt_round_pd(a)),
        (_, true) => toward!(how.2, _mm512_fmadd_round_pd(a, b, c)),
    };
    converted(v: u8x64, how: (u8, bool, bool, crate::Round)) -> u8x64 = match (how.0, how.1, how.2) {
        (0, true, _) => { let it: u8x32 = toward!(how.3, _mm512_cvt_roundpd_ps(v)); it.resize() }
        (0, false, _) => { let it: u8x32 = toward!(how.3, _mm512_cvt_roundps_ph(v)); it.resize() }
        (3, false, _) => toward!(how.3, _mm512_cvt_roundps_epi32(v)),
        (3, true, _) => toward!(how.3, _mm512_cvt_roundpd_epi64(v)),
        (1, false, _) => toward!(how.3, _mm512_cvt_roundepu32_ps(v)),
        (_, false, _) => toward!(how.3, _mm512_cvt_roundepi32_ps(v)),
        (1, true, true) => toward!(how.3, _mm512_cvt_roundepu64_pd(v)),
        (_, true, true) => toward!(how.3, _mm512_cvt_roundepi64_pd(v)),
        (1, true, false) => { let it: u8x32 = toward!(how.3, _mm512_cvt_roundepu64_ps(v)); it.resize() }
        (_, true, false) => { let it: u8x32 = toward!(how.3, _mm512_cvt_roundepi64_ps(v)); it.resize() }
    };
    f16_toward(v: u8x32, mode: crate::Round) -> u8x16 = toward!(mode, _mm256_cvtps_ph(v) 0);
    f16_to_f32_16(v: u8x16) -> u8x16 = _mm_cvtph_ps(v.to()).to();
    f16_to_f32_32(v: u8x32) -> u8x32 = _mm256_cvtph_ps(_mm256_castsi256_si128(v.to())).to();
    f16_to_f32_64(v: u8x64) -> u8x64 = _mm512_cvt_roundph_ps::<_MM_FROUND_CUR_DIRECTION>(_mm512_castsi512_si256(v.to())).to();
    f32_to_f16_16(v: u8x16) -> u8x16 = _mm_cvtps_ph::<0>(v.to()).to();
    f32_to_f16_32(v: u8x32) -> u8x32 = _mm256_zextsi128_si256(_mm256_cvtps_ph::<0>(v.to())).to();
    f32_to_f16_64(v: u8x64) -> u8x64 = _mm512_zextsi256_si512(_mm512_cvtps_ph::<0>(v.to())).to();
    range_f32_16(a: u8x16, b: u8x16, max: bool) -> u8x16 = {
        let (a, b) = (a.to(), b.to());
        range!(_mm_mask_range_ps, _mm_fpclass_ps_mask, 16, a, b, max).to()
    };
    range_f64_16(a: u8x16, b: u8x16, max: bool) -> u8x16 = {
        let (a, b) = (a.to(), b.to());
        range!(_mm_mask_range_pd, _mm_fpclass_pd_mask, 16, a, b, max).to()
    };
    scale_f32_16(v: u8x16, by: u8x16) -> u8x16 = _mm_scalef_ps(v.to(), by.to()).to();
    majority_16(a: u8x16, b: u8x16, c: u8x16) -> u8x16 = _mm_ternarylogic_epi64::<0xe8>(a.to(), b.to(), c.to()).to();
    fraction_f32_16(v: u8x16) -> u8x16 = _mm_reduce_ps::<8>(v.to()).to();
    fraction_f64_16(v: u8x16) -> u8x16 = _mm_reduce_pd::<8>(v.to()).to();
    exponent_f32_16(v: u8x16) -> u8x16 = _mm_getexp_ps(v.to()).to();
    scale_f64_16(v: u8x16, by: u8x16) -> u8x16 = _mm_scalef_pd(v.to(), by.to()).to();
    exponent_f64_16(v: u8x16) -> u8x16 = _mm_getexp_pd(v.to()).to();
    approximate_reciprocal_f64_16(v: u8x16) -> u8x16 = _mm_rcp14_pd(v.to()).to();
    approximate_reciprocal_sqrt_f64_16(v: u8x16) -> u8x16 = _mm_rsqrt14_pd(v.to()).to();
    double_block_quads_16(a: u8x16, b: u8x16) -> u8x16 = _mm_dbsad_epu8::<0b11_10_01_00>(b.to(), a.to()).to();
    range_f32_32(a: u8x32, b: u8x32, max: bool) -> u8x32 = {
        let (a, b) = (a.to(), b.to());
        range!(_mm256_mask_range_ps, _mm256_fpclass_ps_mask, 32, a, b, max).to()
    };
    range_f64_32(a: u8x32, b: u8x32, max: bool) -> u8x32 = {
        let (a, b) = (a.to(), b.to());
        range!(_mm256_mask_range_pd, _mm256_fpclass_pd_mask, 32, a, b, max).to()
    };
    scale_f32_32(v: u8x32, by: u8x32) -> u8x32 = _mm256_scalef_ps(v.to(), by.to()).to();
    majority_32(a: u8x32, b: u8x32, c: u8x32) -> u8x32 = _mm256_ternarylogic_epi64::<0xe8>(a.to(), b.to(), c.to()).to();
    fraction_f32_32(v: u8x32) -> u8x32 = _mm256_reduce_ps::<8>(v.to()).to();
    fraction_f64_32(v: u8x32) -> u8x32 = _mm256_reduce_pd::<8>(v.to()).to();
    exponent_f32_32(v: u8x32) -> u8x32 = _mm256_getexp_ps(v.to()).to();
    scale_f64_32(v: u8x32, by: u8x32) -> u8x32 = _mm256_scalef_pd(v.to(), by.to()).to();
    exponent_f64_32(v: u8x32) -> u8x32 = _mm256_getexp_pd(v.to()).to();
    approximate_reciprocal_f64_32(v: u8x32) -> u8x32 = _mm256_rcp14_pd(v.to()).to();
    approximate_reciprocal_sqrt_f64_32(v: u8x32) -> u8x32 = _mm256_rsqrt14_pd(v.to()).to();
    double_block_quads_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_dbsad_epu8::<0b11_10_01_00>(b.to(), a.to()).to();
    range_f32_64(a: u8x64, b: u8x64, max: bool) -> u8x64 = {
        let (a, b) = (a.to(), b.to());
        range!(_mm512_mask_range_ps, _mm512_fpclass_ps_mask, 64, a, b, max).to()
    };
    range_f64_64(a: u8x64, b: u8x64, max: bool) -> u8x64 = {
        let (a, b) = (a.to(), b.to());
        range!(_mm512_mask_range_pd, _mm512_fpclass_pd_mask, 64, a, b, max).to()
    };
    scale_f32_64(v: u8x64, by: u8x64) -> u8x64 = _mm512_scalef_ps(v.to(), by.to()).to();
    majority_64(a: u8x64, b: u8x64, c: u8x64) -> u8x64 = _mm512_ternarylogic_epi64::<0xe8>(a.to(), b.to(), c.to()).to();
    fraction_f32_64(v: u8x64) -> u8x64 = _mm512_reduce_ps::<8>(v.to()).to();
    fraction_f64_64(v: u8x64) -> u8x64 = _mm512_reduce_pd::<8>(v.to()).to();
    exponent_f32_64(v: u8x64) -> u8x64 = _mm512_getexp_ps(v.to()).to();
    scale_f64_64(v: u8x64, by: u8x64) -> u8x64 = _mm512_scalef_pd(v.to(), by.to()).to();
    exponent_f64_64(v: u8x64) -> u8x64 = _mm512_getexp_pd(v.to()).to();
    approximate_reciprocal_f64_64(v: u8x64) -> u8x64 = _mm512_rcp14_pd(v.to()).to();
    approximate_reciprocal_sqrt_f64_64(v: u8x64) -> u8x64 = _mm512_rsqrt14_pd(v.to()).to();
    double_block_quads_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_dbsad_epu8::<0b11_10_01_00>(b.to(), a.to()).to();
    sums_of_2_u8_64(v: u8x64) -> u8x64 = _mm512_maddubs_epi16(v.to(), _mm512_set1_epi8(1)).to();
    sums_of_2_i8_64(v: u8x64) -> u8x64 = _mm512_maddubs_epi16(_mm512_set1_epi8(1), v.to()).to();
    sums_of_2_i16_64(v: u8x64) -> u8x64 = _mm512_madd_epi16(v.to(), _mm512_set1_epi16(1)).to();
    mul_even_u32_64(a: u8x64, b: u8x64) -> u8x64 = tied!(_mm512 _mm512_mul_epu32(a, b));
    mul_high_i16_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_mulhi_epi16(a.to(), b.to()).to();
    mul_high_u16_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_mulhi_epu16(a.to(), b.to()).to();
    average_u8_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_avg_epu8(a.to(), b.to()).to();
    average_u16_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_avg_epu16(a.to(), b.to()).to();
    mul_even_i32_64(a: u8x64, b: u8x64) -> u8x64 = tied!(_mm512 _mm512_mul_epi32(a, b));
    min_f32_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_min_ps(a.to(), b.to()).to();
    max_f32_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_max_ps(a.to(), b.to()).to();
    min_f64_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_min_pd(a.to(), b.to()).to();
    max_f64_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_max_pd(a.to(), b.to()).to();
    truncate_f32_i32_64(v: u8x64) -> u8x64 = _mm512_cvttps_epi32(v.to()).to();
    approximate_reciprocal_64(v: u8x64) -> u8x64 = _mm512_rcp14_ps(v.to()).to();
    approximate_reciprocal_sqrt_64(v: u8x64) -> u8x64 = _mm512_rsqrt14_ps(v.to()).to();
    nearest_f32_i32_64(v: u8x64) -> u8x64 = _mm512_cvtps_epi32(v.to()).to();
    truncate_f64_i64_32(v: u8x32) -> u8x32 = _mm256_cvttpd_epi64(v.to()).to();
    truncate_f64_i64_64(v: u8x64) -> u8x64 = _mm512_cvttpd_epi64(v.to()).to();
    class_f32_16(v: u8x16, kind: core::num::FpCategory) -> u8x16 = class!(_mm_movm_epi32, _mm_fpclass_ps_mask, v.to(), kind);
    class_f64_16(v: u8x16, kind: core::num::FpCategory) -> u8x16 = class!(_mm_movm_epi64, _mm_fpclass_pd_mask, v.to(), kind);
    class_f32_32(v: u8x32, kind: core::num::FpCategory) -> u8x32 = class!(_mm256_movm_epi32, _mm256_fpclass_ps_mask, v.to(), kind);
    class_f64_32(v: u8x32, kind: core::num::FpCategory) -> u8x32 = class!(_mm256_movm_epi64, _mm256_fpclass_pd_mask, v.to(), kind);
    class_f32_64(v: u8x64, kind: core::num::FpCategory) -> u8x64 = class!(_mm512_movm_epi32, _mm512_fpclass_ps_mask, v.to(), kind);
    class_f64_64(v: u8x64, kind: core::num::FpCategory) -> u8x64 = class!(_mm512_movm_epi64, _mm512_fpclass_pd_mask, v.to(), kind);
    truncate_f64_u32_16(v: u8x16) -> u8x16 = _mm_cvttpd_epu32(v.to()).to();
    truncate_f64_u32_32(v: u8x32) -> u8x32 = _mm256_zextsi128_si256(_mm256_cvttpd_epu32(v.to())).to();
    truncate_f64_u32_64(v: u8x64) -> u8x64 = _mm512_zextsi256_si512(_mm512_cvttpd_epu32(v.to())).to();
    truncate_f64_u64_16(v: u8x16) -> u8x16 = _mm_cvttpd_epu64(v.to()).to();
    truncate_f64_u64_32(v: u8x32) -> u8x32 = _mm256_cvttpd_epu64(v.to()).to();
    truncate_f64_u64_64(v: u8x64) -> u8x64 = _mm512_cvttpd_epu64(v.to()).to();
    truncate_f32_u32_16(v: u8x16) -> u8x16 = _mm_cvttps_epu32(v.to()).to();
    truncate_f32_u32_32(v: u8x32) -> u8x32 = _mm256_cvttps_epu32(v.to()).to();
    truncate_f32_u32_64(v: u8x64) -> u8x64 = _mm512_cvttps_epu32(v.to()).to();
    saturated_int_16(v: u8x16, how: (bool, bool)) -> u8x16 = saturated!(_mm 16, v, how);
    saturated_int_32(v: u8x32, how: (bool, bool)) -> u8x32 = saturated!(_mm256 32, v, how);
    saturated_int_64(v: u8x64, how: (bool, bool)) -> u8x64 = saturated!(_mm512 64, v, how);
    magnitude_16(a: u8x16, b: u8x16, how: (bool, bool)) -> u8x16 = magnitude!(_mm, a, b, how);
    magnitude_32(a: u8x32, b: u8x32, how: (bool, bool)) -> u8x32 = magnitude!(_mm256, a, b, how);
    magnitude_64(a: u8x64, b: u8x64, how: (bool, bool)) -> u8x64 = magnitude!(_mm512, a, b, how);
    or_quiet_nan_16(v: u8x16, of: u8x16) -> u8x16 = _mm_fixupimm_ps::<0>(v.to(), of.to(), _mm_set1_epi32(0x22)).to();
    or_quiet_nan_32(v: u8x32, of: u8x32) -> u8x32 = _mm256_fixupimm_ps::<0>(v.to(), of.to(), _mm256_set1_epi32(0x22)).to();
    or_quiet_nan_64(v: u8x64, of: u8x64) -> u8x64 = _mm512_fixupimm_ps::<0>(v.to(), of.to(), _mm512_set1_epi32(0x22)).to();
    scale_from_16(v: u8x16, by: u8x16, least: u8x16, double: bool) -> u8x16 = scale_from!(_mm, v, by, least, double);
    scale_from_32(v: u8x32, by: u8x32, least: u8x32, double: bool) -> u8x32 = scale_from!(_mm256, v, by, least, double);
    scale_from_64(v: u8x64, by: u8x64, least: u8x64, double: bool) -> u8x64 = scale_from!(_mm512, v, by, least, double);
    nearest_f32_u32_16(v: u8x16) -> u8x16 = _mm_cvtps_epu32(v.to()).to();
    nearest_f32_u32_32(v: u8x32) -> u8x32 = _mm256_cvtps_epu32(v.to()).to();
    nearest_f32_u32_64(v: u8x64) -> u8x64 = _mm512_cvtps_epu32(v.to()).to();
    nearest_f64_u64_16(v: u8x16) -> u8x16 = _mm_cvtpd_epu64(v.to()).to();
    nearest_f64_u64_32(v: u8x32) -> u8x32 = _mm256_cvtpd_epu64(v.to()).to();
    nearest_f64_u64_64(v: u8x64) -> u8x64 = _mm512_cvtpd_epu64(v.to()).to();
    nearest_f64_i64_16(v: u8x16) -> u8x16 = _mm_cvtpd_epi64(v.to()).to();
    nearest_f64_i64_32(v: u8x32) -> u8x32 = _mm256_cvtpd_epi64(v.to()).to();
    nearest_f64_i64_64(v: u8x64) -> u8x64 = _mm512_cvtpd_epi64(v.to()).to();
    // From the lower half.
    truncate_f32_64_32(v: u8x32, signed: bool) -> u8x32 = {
        let v = _mm_castsi128_ps(v.extract::<0, 16>().to());
        if signed { _mm256_cvttps_epi64(v) } else { _mm256_cvttps_epu64(v) }.to()
    };
    truncate_f32_64_64(v: u8x64, signed: bool) -> u8x64 = {
        let v = _mm256_castsi256_ps(v.extract::<0, 32>().to());
        if signed { _mm512_cvttps_epi64(v) } else { _mm512_cvttps_epu64(v) }.to()
    };
    nearest_f32_64_16(v: u8x16, signed: bool) -> u8x16 = if signed { _mm_cvtps_epi64(v.to()) } else { _mm_cvtps_epu64(v.to()) }.to();
    nearest_f32_64_32(v: u8x32, signed: bool) -> u8x32 = {
        let v = _mm_castsi128_ps(v.extract::<0, 16>().to());
        if signed { _mm256_cvtps_epi64(v) } else { _mm256_cvtps_epu64(v) }.to()
    };
    nearest_f32_64_64(v: u8x64, signed: bool) -> u8x64 = {
        let v = _mm256_castsi256_ps(v.extract::<0, 32>().to());
        if signed { _mm512_cvtps_epi64(v) } else { _mm512_cvtps_epu64(v) }.to()
    };
    nearest_f64_u32_16(v: u8x16) -> u8x16 = _mm_cvtpd_epu32(v.to()).to();
    nearest_f64_u32_32(v: u8x32) -> u8x32 = _mm256_zextsi128_si256(_mm256_cvtpd_epu32(v.to())).to();
    nearest_f64_u32_64(v: u8x64) -> u8x64 = _mm512_zextsi256_si512(_mm512_cvtpd_epu32(v.to())).to();
    nearest_f64_i32_64(v: u8x64) -> u8x64 = _mm512_zextsi256_si512(_mm512_cvtpd_epi32(v.to())).to();
    truncate_f64_i32_64(v: u8x64) -> u8x64 =
        _mm512_zextsi256_si512(_mm512_cvttpd_epi32(v.to())).to();
    hidden_64(v: u8x64) -> u8x64 = crate::regs::zmm(v);
    mul64_16(a: u8x16, b: u8x16) -> u8x16 = mul64!(u64x2, _mm_fpclass_pd_mask, 16, a, b);
    mul64_32(a: u8x32, b: u8x32) -> u8x32 = mul64!(u64x4, _mm256_fpclass_pd_mask, 32, a, b);
    mul64_64(a: u8x64, b: u8x64) -> u8x64 = mul64!(u64x8, _mm512_fpclass_pd_mask, 64, a, b);
    // Zen 4 and 5 wait for the old value of the destination if these are told to fill with zeros.
    expand32_16(v: u8x16, or: u8x16, bits: u64) -> u8x16 = _mm_mask_expand_epi32(crate::regs::xmm(or).to(), bits as _, v.to()).to();
    expand32_32(v: u8x32, or: u8x32, bits: u64) -> u8x32 = _mm256_mask_expand_epi32(crate::regs::ymm(or).to(), bits as _, v.to()).to();
    expand32_64(v: u8x64, or: u8x64, bits: u64) -> u8x64 = _mm512_mask_expand_epi32(crate::regs::zmm(or).to(), bits as _, v.to()).to();
    expand64_16(v: u8x16, or: u8x16, bits: u64) -> u8x16 = _mm_mask_expand_epi64(crate::regs::xmm(or).to(), bits as _, v.to()).to();
    expand64_32(v: u8x32, or: u8x32, bits: u64) -> u8x32 = _mm256_mask_expand_epi64(crate::regs::ymm(or).to(), bits as _, v.to()).to();
    expand64_64(v: u8x64, or: u8x64, bits: u64) -> u8x64 = _mm512_mask_expand_epi64(crate::regs::zmm(or).to(), bits as _, v.to()).to();
    compress32_16(v: u8x16, bits: u64) -> u8x16 = _mm_mask_compress_epi32(v.to(), bits as _, v.to()).to();
    compress_zero32_16(v: u8x16, bits: u64) -> u8x16 = _mm_mask_compress_epi32(hidden_zero!(16), bits as _, v.to()).to();
    compress32_32(v: u8x32, bits: u64) -> u8x32 = _mm256_mask_compress_epi32(v.to(), bits as _, v.to()).to();
    compress_zero32_32(v: u8x32, bits: u64) -> u8x32 = _mm256_mask_compress_epi32(hidden_zero!(32), bits as _, v.to()).to();
    compress32_64(v: u8x64, bits: u64) -> u8x64 = _mm512_mask_compress_epi32(v.to(), bits as _, v.to()).to();
    compress_zero32_64(v: u8x64, bits: u64) -> u8x64 = _mm512_mask_compress_epi32(hidden_zero!(64), bits as _, v.to()).to();
    compress64_16(v: u8x16, bits: u64) -> u8x16 = _mm_mask_compress_epi64(v.to(), bits as _, v.to()).to();
    compress_zero64_16(v: u8x16, bits: u64) -> u8x16 = _mm_mask_compress_epi64(hidden_zero!(16), bits as _, v.to()).to();
    compress64_32(v: u8x32, bits: u64) -> u8x32 = _mm256_mask_compress_epi64(v.to(), bits as _, v.to()).to();
    compress_zero64_32(v: u8x32, bits: u64) -> u8x32 = _mm256_mask_compress_epi64(hidden_zero!(32), bits as _, v.to()).to();
    compress64_64(v: u8x64, bits: u64) -> u8x64 = _mm512_mask_compress_epi64(v.to(), bits as _, v.to()).to();
    compress_zero64_64(v: u8x64, bits: u64) -> u8x64 = _mm512_mask_compress_epi64(hidden_zero!(64), bits as _, v.to()).to();
    shift_all_64(v: u8x64, how: (u32, bool, u32)) -> u8x64 = shift!(v, _mm_cvtsi32_si128(how.2 as i32), how.0, how.1,
        16 => _mm512_sll_epi16 _mm512_srl_epi16, 32 => _mm512_sll_epi32 _mm512_srl_epi32, _ => _mm512_sll_epi64 _mm512_srl_epi64);
    shift_each_64(v: u8x64, counts: u8x64, how: (u32, bool)) -> u8x64 = shift!(v, counts.to(), how.0, how.1, 32 => _mm512_sllv_epi32 _mm512_srlv_epi32, _ => _mm512_sllv_epi64 _mm512_srlv_epi64);
    shift_each16_16(v: u8x16, counts: u8x16, how: (u32, bool)) -> u8x16 = shift!(v, counts.to(), how.0, how.1, _ => _mm_sllv_epi16 _mm_srlv_epi16);
    shift_each16_32(v: u8x32, counts: u8x32, how: (u32, bool)) -> u8x32 = shift!(v, counts.to(), how.0, how.1, _ => _mm256_sllv_epi16 _mm256_srlv_epi16);
    shift_each16_64(v: u8x64, counts: u8x64, how: (u32, bool)) -> u8x64 = shift!(v, counts.to(), how.0, how.1, _ => _mm512_sllv_epi16 _mm512_srlv_epi16);
}

// Small lanes are widened, for want of VBMI2.
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))]
group! { avx512_only "bmi2,avx512bw,avx512vl,avx512dq" {}
    compress8_16(v: u8x16, bits: u64) -> u8x16 =
        _mm512_cvtepi32_epi8(_mm512_mask_compress_epi32(hidden_zero!(64), bits as _, _mm512_cvtepu8_epi32(v.to()))).to();
    compress16_32(v: u8x32, bits: u64) -> u8x32 =
        _mm512_cvtepi32_epi16(_mm512_mask_compress_epi32(hidden_zero!(64), bits as _, _mm512_cvtepu16_epi32(v.to()))).to();
    compress16_64(v: u8x64, bits: u64) -> u8x64 = {
        let half = |v: __m256i, bits: u64| { let v = _mm512_cvtepu16_epi32(v); _mm512_cvtepi32_epi16(_mm512_mask_compress_epi32(v, bits as _, v)) };
        let (lower, upper) = (half(v.extract::<0, 32>().to(), bits), half(v.extract::<32, 32>().to(), bits >> 16));
        let (lanes, count) = (<i16x32 as crate::raw::Raw>::iota(), i16x32::splat((bits as u16).count_ones() as i16));
        let from = lanes.simd_lt(count).select(lanes, lanes.sub(count).add(i16x32::splat(32)));
        _mm512_permutex2var_epi16(_mm512_castsi256_si512(lower), from.to(), _mm512_castsi256_si512(upper)).to()
    };
}

#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))]
group! { ice_lake "bmi2,avx512cd,avx512vl,avx512dq,avx512vbmi,avx512vbmi2,avx512bitalg" {
    u8x64 {
        lookup8_in_two_64(a, b, indices) = _mm512_permutex2var_epi8(a, indices, b);
        lookup8_64(table, indices) = _mm512_permutexvar_epi8(indices, table);
        rotate16_64(v, right) = _mm512_shrdv_epi16(v, v, right);
    }
    u8x32 {
        lookup8_in_two_32(a, b, indices) = _mm256_permutex2var_epi8(a, indices, b);
        lookup8_32(table, indices) = _mm256_permutexvar_epi8(indices, table);
        rotate16_32(v, right) = _mm256_shrdv_epi16(v, v, right);
    }
    u8x16 { lookup8_in_two_16(a, b, indices) = _mm_permutex2var_epi8(a, indices, b); } }
    members_64(v: u8x64, set: u8x64, by: crate::asked::Intersect) -> u8x64 = _mm512_movm_epi32(by.members(v, set)).to();
    conflicts_64(v: u8x64) -> u8x64 = _mm512_conflict_epi32(v.to()).to();
    multi_shift_16(v: u8x16, counts: u8x16) -> u8x16 = _mm_multishift_epi64_epi8(counts.to(), v.to()).to();
    multi_shift_32(v: u8x32, counts: u8x32) -> u8x32 = _mm256_multishift_epi64_epi8(counts.to(), v.to()).to();
    multi_shift_64(v: u8x64, counts: u8x64) -> u8x64 = _mm512_multishift_epi64_epi8(counts.to(), v.to()).to();
    bit_shuffle_16(v: u8x16, indices: u8x16) -> u8x16 =
        crate::raw::copy::from_array::<u8, 2>(_mm_bitshuffle_epi64_mask(v.to(), indices.to()).to_le_bytes()).cast::<u64, _>().to_ne_bytes();
    bit_shuffle_32(v: u8x32, indices: u8x32) -> u8x32 =
        crate::raw::copy::from_array::<u8, 4>(_mm256_bitshuffle_epi64_mask(v.to(), indices.to()).to_le_bytes()).cast::<u64, _>().to_ne_bytes();
    bit_shuffle_64(v: u8x64, indices: u8x64) -> u8x64 =
        _mm512_cvtepu8_epi64(_mm_set_epi64x(0, _mm512_bitshuffle_epi64_mask(v.to(), indices.to()) as i64)).to();
    funnel_16(high: u8x16, low: u8x16, counts: u8x16, how: (u32, bool)) -> u8x16 = funnel!(high, low, counts, how, _mm_shldv_epi16 _mm_shrdv_epi16 _mm_shldv_epi32 _mm_shrdv_epi32 _mm_shldv_epi64 _mm_shrdv_epi64);
    funnel_32(high: u8x32, low: u8x32, counts: u8x32, how: (u32, bool)) -> u8x32 = funnel!(high, low, counts, how, _mm256_shldv_epi16 _mm256_shrdv_epi16 _mm256_shldv_epi32 _mm256_shrdv_epi32 _mm256_shldv_epi64 _mm256_shrdv_epi64);
    funnel_64(high: u8x64, low: u8x64, counts: u8x64, how: (u32, bool)) -> u8x64 = funnel!(high, low, counts, how, _mm512_shldv_epi16 _mm512_shrdv_epi16 _mm512_shldv_epi32 _mm512_shrdv_epi32 _mm512_shldv_epi64 _mm512_shrdv_epi64);
    rotate16_16(v: u8x16, right: u8x16) -> u8x16 = _mm_shrdv_epi16(v.to(), v.to(), right.to()).to();
    // If all bits are set, all lanes are from the last operand, which is `v` then.
    partition8_64(v: u8x64, bits: u64) -> u8x64 = {
        let compress = |bits| _mm512_mask_compress_epi8(v.to(), bits, v.to());
        _mm512_mask_expand_epi8(compress(bits), (!0u64).wrapping_shl(bits.count_ones()), compress(!bits)).to()
    };
    compress8_8(v: u8x16, bits: u64) -> u8x16 = _mm_mask_compress_epi8(v.to(), bits as _, v.to()).to();
    compress8_16(v: u8x16, bits: u64) -> u8x16 = _mm_mask_compress_epi8(v.to(), bits as _, v.to()).to();
    compress_zero8_16(v: u8x16, bits: u64) -> u8x16 = _mm_mask_compress_epi8(hidden_zero!(16), bits as _, v.to()).to();
    compress8_32(v: u8x32, bits: u64) -> u8x32 = _mm256_mask_compress_epi8(v.to(), bits as _, v.to()).to();
    compress_zero8_32(v: u8x32, bits: u64) -> u8x32 = _mm256_mask_compress_epi8(hidden_zero!(32), bits as _, v.to()).to();
    compress8_64(v: u8x64, bits: u64) -> u8x64 = _mm512_mask_compress_epi8(v.to(), bits, v.to()).to();
    compress_zero8_64(v: u8x64, bits: u64) -> u8x64 = _mm512_mask_compress_epi8(hidden_zero!(64), bits, v.to()).to();
    expand8_16(v: u8x16, or: u8x16, bits: u64) -> u8x16 = _mm_mask_expand_epi8(crate::regs::xmm(or).to(), bits as _, v.to()).to();
    expand8_32(v: u8x32, or: u8x32, bits: u64) -> u8x32 = _mm256_mask_expand_epi8(crate::regs::ymm(or).to(), bits as _, v.to()).to();
    expand8_64(v: u8x64, or: u8x64, bits: u64) -> u8x64 = _mm512_mask_expand_epi8(crate::regs::zmm(or).to(), bits as _, v.to()).to();
    expand16_16(v: u8x16, or: u8x16, bits: u64) -> u8x16 = _mm_mask_expand_epi16(crate::regs::xmm(or).to(), bits as _, v.to()).to();
    expand16_32(v: u8x32, or: u8x32, bits: u64) -> u8x32 = _mm256_mask_expand_epi16(crate::regs::ymm(or).to(), bits as _, v.to()).to();
    expand16_64(v: u8x64, or: u8x64, bits: u64) -> u8x64 = _mm512_mask_expand_epi16(crate::regs::zmm(or).to(), bits as _, v.to()).to();
    compress16_16(v: u8x16, bits: u64) -> u8x16 = _mm_mask_compress_epi16(v.to(), bits as _, v.to()).to();
    compress_zero16_16(v: u8x16, bits: u64) -> u8x16 = _mm_mask_compress_epi16(hidden_zero!(16), bits as _, v.to()).to();
    compress16_32(v: u8x32, bits: u64) -> u8x32 = _mm256_mask_compress_epi16(v.to(), bits as _, v.to()).to();
    compress_zero16_32(v: u8x32, bits: u64) -> u8x32 = _mm256_mask_compress_epi16(hidden_zero!(32), bits as _, v.to()).to();
    compress16_64(v: u8x64, bits: u64) -> u8x64 = _mm512_mask_compress_epi16(v.to(), bits as _, v.to()).to();
    compress_zero16_64(v: u8x64, bits: u64) -> u8x64 = _mm512_mask_compress_epi16(hidden_zero!(64), bits as _, v.to()).to();
}

group! { gfni_16 "gfni" {}
    galois_mul_16(a: u8x16, b: u8x16) -> u8x16 = _mm_gf2p8mul_epi8(a.to(), b.to()).to();
    galois_affine_16(v: u8x16, matrix: u8x16) -> u8x16 = _mm_gf2p8affine_epi64_epi8::<0>(v.to(), kept!(xmm matrix).to()).to();
    galois_affine_inverse_16(v: u8x16, matrix: u8x16) -> u8x16 = _mm_gf2p8affineinv_epi64_epi8::<0>(v.to(), kept!(xmm matrix).to()).to();
}
group! { gfni_32 "gfni,avx" {}
    galois_mul_32(a: u8x32, b: u8x32) -> u8x32 = _mm256_gf2p8mul_epi8(a.to(), b.to()).to();
    galois_affine_32(v: u8x32, matrix: u8x32) -> u8x32 = _mm256_gf2p8affine_epi64_epi8::<0>(v.to(), matrix.to()).to();
    galois_affine_inverse_32(v: u8x32, matrix: u8x32) -> u8x32 = _mm256_gf2p8affineinv_epi64_epi8::<0>(v.to(), matrix.to()).to();
}
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))]
group! { gfni_64 "gfni,avx512f" {}
    galois_mul_64(a: u8x64, b: u8x64) -> u8x64 = _mm512_gf2p8mul_epi8(a.to(), b.to()).to();
    galois_affine_64(v: u8x64, matrix: u8x64) -> u8x64 = _mm512_gf2p8affine_epi64_epi8::<0>(v.to(), matrix.to()).to();
    galois_affine_inverse_64(v: u8x64, matrix: u8x64) -> u8x64 = _mm512_gf2p8affineinv_epi64_epi8::<0>(v.to(), matrix.to()).to();
}
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))]
group! { avx512_vnni "avx512vl,avx512vnni" {}
    saturated_dot_i16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = _mm_dpwssds_epi32(sum.to(), a.to(), b.to()).to();
    saturated_dot_i16_32(a: u8x32, b: u8x32, sum: u8x32) -> u8x32 = _mm256_dpwssds_epi32(sum.to(), a.to(), b.to()).to();
    saturated_dot_i16_64(a: u8x64, b: u8x64, sum: u8x64) -> u8x64 = _mm512_dpwssds_epi32(sum.to(), a.to(), b.to()).to();
    dot_u8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = _mm_dpbusd_epi32(sum.to(), a.to(), b.to()).to();
    dot_u8_i8_32(a: u8x32, b: u8x32, sum: u8x32) -> u8x32 = _mm256_dpbusd_epi32(sum.to(), a.to(), b.to()).to();
    dot_u8_i8_64(a: u8x64, b: u8x64, sum: u8x64) -> u8x64 = _mm512_dpbusd_epi32(sum.to(), a.to(), b.to()).to();
}
group! { avx_ifma "avxifma" {
    u8x16 {
        mul_add52_lower_16(a, b, sum) = _mm_madd52lo_avx_epu64(sum, a, b);
        mul_add52_upper_16(a, b, sum) = _mm_madd52hi_avx_epu64(sum, a, b);
    }
    u8x32 {
        mul_add52_lower_32(a, b, sum) = _mm256_madd52lo_avx_epu64(sum, a, b);
        mul_add52_upper_32(a, b, sum) = _mm256_madd52hi_avx_epu64(sum, a, b);
    } }
}

#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))]
group! { ifma "avx512vl,avx512ifma" {
    u8x16 {
        mul_add52_lower_16(a, b, sum) = _mm_madd52lo_epu64(sum, a, b);
        mul_add52_upper_16(a, b, sum) = _mm_madd52hi_epu64(sum, a, b);
    }
    u8x32 {
        mul_add52_lower_32(a, b, sum) = _mm256_madd52lo_epu64(sum, a, b);
        mul_add52_upper_32(a, b, sum) = _mm256_madd52hi_epu64(sum, a, b);
    }
    u8x64 {
        mul_add52_lower_64(a, b, sum) = _mm512_madd52lo_epu64(sum, a, b);
        mul_add52_upper_64(a, b, sum) = _mm512_madd52hi_epu64(sum, a, b);
    } }
}

group! { fma "fma" {}
    fma_f32_16(a: u8x16, b: u8x16, c: u8x16) -> u8x16 = _mm_fmadd_ps(a.to(), b.to(), c.to()).to();
    fma_f64_16(a: u8x16, b: u8x16, c: u8x16) -> u8x16 = _mm_fmadd_pd(a.to(), b.to(), c.to()).to();
    fma_f32_32(a: u8x32, b: u8x32, c: u8x32) -> u8x32 = _mm256_fmadd_ps(a.to(), b.to(), c.to()).to();
    fma_f64_32(a: u8x32, b: u8x32, c: u8x32) -> u8x32 = _mm256_fmadd_pd(a.to(), b.to(), c.to()).to();
}
#[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(target_vendor = "apple")))]
group! { fma_64 "avx512f" {}
    gather_four(from: &[u8], at: u8x64, step: usize) -> u8x64 = steps!(four, from, at, step, 1, 4);
    gather_eight(from: &[u8], at: u8x32, step: usize) -> u8x64 = steps!(eight, from, at, step, 1 4, 8);
    sqrt_f32_64(v: u8x64) -> u8x64 = _mm512_sqrt_ps(v.to()).to();
    sqrt_f64_64(v: u8x64) -> u8x64 = _mm512_sqrt_pd(v.to()).to();
    floor_f32_64(v: u8x64) -> u8x64 = _mm512_roundscale_ps::<9>(v.to()).to();
    ceil_f32_64(v: u8x64) -> u8x64 = _mm512_roundscale_ps::<10>(v.to()).to();
    trunc_f32_64(v: u8x64) -> u8x64 = _mm512_roundscale_ps::<11>(v.to()).to();
    even_f32_64(v: u8x64) -> u8x64 = _mm512_roundscale_ps::<8>(v.to()).to();
    floor_f64_64(v: u8x64) -> u8x64 = _mm512_roundscale_pd::<9>(v.to()).to();
    ceil_f64_64(v: u8x64) -> u8x64 = _mm512_roundscale_pd::<10>(v.to()).to();
    trunc_f64_64(v: u8x64) -> u8x64 = _mm512_roundscale_pd::<11>(v.to()).to();
    even_f64_64(v: u8x64) -> u8x64 = _mm512_roundscale_pd::<8>(v.to()).to();
    fma_f32_64(a: u8x64, b: u8x64, c: u8x64) -> u8x64 = _mm512_fmadd_ps(a.to(), b.to(), c.to()).to();
    fma_f64_64(a: u8x64, b: u8x64, c: u8x64) -> u8x64 = _mm512_fmadd_pd(a.to(), b.to(), c.to()).to();
}

group! { avx_vnni "avxvnni" {}
    saturated_dot_i16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = _mm_dpwssds_avx_epi32(sum.to(), a.to(), b.to()).to();
    saturated_dot_i16_32(a: u8x32, b: u8x32, sum: u8x32) -> u8x32 = _mm256_dpwssds_avx_epi32(sum.to(), a.to(), b.to()).to();
    dot_u8_i8_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = _mm_dpbusd_avx_epi32(sum.to(), a.to(), b.to()).to();
    dot_u8_i8_32(a: u8x32, b: u8x32, sum: u8x32) -> u8x32 = _mm256_dpbusd_avx_epi32(sum.to(), a.to(), b.to()).to();
}

group! { vnni_int8 "avxvnniint8" {
    u8x16 {
        dot_u8_u8_16(a, b, sum) = _mm_dpbuud_epi32(sum, a, b);
        dot_i8_i8_16(a, b, sum) = _mm_dpbssd_epi32(sum, a, b);
    }
    u8x32 {
        dot_u8_u8_32(a, b, sum) = _mm256_dpbuud_epi32(sum, a, b);
        dot_i8_i8_32(a, b, sum) = _mm256_dpbssd_epi32(sum, a, b);
    } }
}

group! { vnni_int16 "avxvnniint16" {
    u8x16 { dot_u16_16(a, b, sum) = _mm_dpwuud_epi32(sum, a, b); }
    u8x32 { dot_u16_32(a, b, sum) = _mm256_dpwuud_epi32(sum, a, b); } }
}

group! { sha512 "avx2,sha512" {}
    sha512_rounds4(abef: u8x32, cdgh: u8x32, wk: u8x32) -> (u8x32, u8x32) = {
        let cdgh = _mm256_sha512rnds2_epi64(cdgh.to(), abef.to(), _mm256_castsi256_si128(wk.to()));
        (_mm256_sha512rnds2_epi64(abef.to(), cdgh, _mm256_extracti128_si256::<1>(wk.to())).to(), cdgh.to())
    };
    sha512_schedule4(a: u8x32, b: u8x32, seven: u8x32, d: u8x32) -> u8x32 = {
        let sum = _mm256_add_epi64(_mm256_sha512msg1_epi64(a.to(), _mm256_castsi256_si128(b.to())), seven.to());
        _mm256_sha512msg2_epi64(sum, d.to()).to()
    };
}

group! { sm4 "avx2,sm3,sm4" {
    u8x16 {
        sm4_rounds_16(v, keys) = _mm_sm4rnds4_epi32(v, keys);
        sm4_keys_16(v, constants) = _mm_sm4key4_epi32(v, constants);
    }
    u8x32 {
        sm4_rounds_32(v, keys) = _mm256_sm4rnds4_epi32(v, keys);
        sm4_keys_32(v, constants) = _mm256_sm4key4_epi32(v, constants);
    } }
    sm3_schedule(w0: u8x16, w7: u8x16, w12: u8x16, w10: u8x16, w3: u8x16) -> u8x16 =
        _mm_sm3msg2_epi32(_mm_sm3msg1_epi32(w7.to(), _mm_srli_si128::<4>(w12.to()), w0.to()), w3.to(), w10.to()).to();
    sm3_rounds4(abef: u8x16, cdgh: u8x16, words: u8x16, next: u8x16, i: usize) -> (u8x16, u8x16) = {
        let (early, late) = (_mm_unpacklo_epi64(words.to(), next.to()), _mm_unpackhi_epi64(words.to(), next.to()));
        macro_rules! at { ($($i:literal)*) => { match i % 16 { $($i => {
            let cdgh = _mm_sm3rnds2_epi32::<{ 4 * $i }>(cdgh.to(), abef.to(), early);
            (_mm_sm3rnds2_epi32::<{ 4 * $i + 2 }>(abef.to(), cdgh, late).to(), cdgh.to())
        })* _ => unreachable!() } }; }
        at!(0 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15)
    };
}

#[cfg(any(miri, target_arch = "x86"))]
group! { shared_sse "sse2" {}}
#[cfg(not(any(miri, target_arch = "x86")))]
group! { shared_sse "sse2" {}
    load_shared_16(from: &Shared<16>) -> u8x16 = shared::load_16_sse(from).to();
    store_shared_16(to: &Shared<16>, v: u8x16) -> () = shared::store_16_sse(to, v.to());
    stream_16(to: crate::stream::Part<'_>, v: u8x16) -> () = crate::stream::store_16_sse(to, v.to());
}

#[cfg(any(miri, target_arch = "x86"))]
group! { shared_avx "avx" {}}
#[cfg(not(any(miri, target_arch = "x86")))]
group! { shared_avx "avx" {}
    load_shared_16(from: &Shared<16>) -> u8x16 = shared::load_16(from).to();
    store_shared_16(to: &Shared<16>, v: u8x16) -> () = shared::store_16(to, v.to());
    stream_16(to: crate::stream::Part<'_>, v: u8x16) -> () = crate::stream::store_16(to, v.to());
    load_shared_32(from: &Shared<32>) -> u8x32 = shared::load_32(from).to();
    load_shared_32x2(from: &Shared<64>) -> u8x64 = crate::ops::join::<32, 64>(shared::load_32(from.first_chunk().unwrap()).to(), shared::load_32_of_64(from).to());
    load_shared_32x4(from: &Shared<128>) -> [u8x32; 4] = [
        shared::load_32(from.first_chunk().unwrap()).to(),
        shared::load_32_of_64(from.first_chunk().unwrap()).to(),
        shared::load_32_of_96(from.first_chunk().unwrap()).to(),
        shared::load_32_of_128(from).to(),
    ];
    store_shared_32(to: &Shared<32>, v: u8x32) -> () = shared::store_32(to, v.to());
    stream_32(to: crate::stream::Part<'_>, v: u8x32) -> () = crate::stream::store_32(to, v.to());
}

#[cfg(any(miri, target_arch = "x86"))]
group! { shared_avx512 "bmi2,avx512bw,avx512vl" {}}
#[cfg(not(any(miri, target_arch = "x86")))]
group! { shared_avx512 "bmi2,avx512bw,avx512vl" {}
    load_shared_64(from: &Shared<64>) -> u8x64 = shared::load_64(from).to();
    load_shared_64x2(from: &Shared<128>) -> [u8x64; 2] = [shared::load_64(from.first_chunk().unwrap()).to(), shared::load_64_of_128(from).to()];
    store_shared_64(to: &Shared<64>, v: u8x64) -> () = shared::store_64(to, v.to());
    stream_64(to: crate::stream::Part<'_>, v: u8x64) -> () = crate::stream::store_64(to, v.to());
    load_shared_n_16(from: &[AtomicU8], skip: usize) -> u8x16 = shared::load_n_16(from, skip).to();
    store_shared_n_16(to: &[AtomicU8], v: u8x16) -> () = shared::store_n_16(to, v.to());
    load_shared_n_32(from: &[AtomicU8], skip: usize) -> u8x32 = shared::load_n_32(from, skip).to();
    store_shared_n_32(to: &[AtomicU8], v: u8x32) -> () = shared::store_n_32(to, v.to());
    load_shared_n_64(from: &[AtomicU8], skip: usize) -> u8x64 = shared::load_n_64(from, skip).to();
    store_shared_n_64(to: &[AtomicU8], v: u8x64) -> () = shared::store_n_64(to, v.to());
}

// LLVM would move a rounding before it to lanes of `f16`, and do that lane by lane.
group! { f16c "f16c,avx2" {}
    f16_to_f32_16(v: u8x16) -> u8x16 = _mm_cvtph_ps(v.to()).to();
    f16_to_f32_32(v: u8x32) -> u8x32 = _mm256_cvtph_ps(_mm256_castsi256_si128(v.to())).to();
    f32_to_f16_16(v: u8x16) -> u8x16 = _mm_cvtps_ph::<0>(v.to()).to();
    f32_to_f16_32(v: u8x32) -> u8x32 = u8x16::from(_mm256_cvtps_ph::<0>(v.to())).resize();
    f16_toward(v: u8x32, mode: crate::Round) -> u8x16 = toward!(mode, _mm256_cvtps_ph(v) 0);
    f16_widened(v: u8x16) -> u8x32 = _mm256_cvtph_ps(v.to()).to();
}

macro_rules! halves { ($n:ident $to:ident $from:ident, $f:ident($($a:ident),+)) => { $from($f($($to($a.to())),+)).to() }; }
#[rules]
macro_rules! on_f16 { ($p:ident $n:tt, $a:ident, $b:ident, $op:ident) => {{
    use crate::half::Op::*;
    let (a, b) = (${concat($p, _castsi, $n, _ph)}($a.to()), ${concat($p, _castsi, $n, _ph)}($b.to()));
    let mask = |it| ${concat($p, _movm_epi16)}(it);
    ${concat($p, _castph_si, $n)}(match $op {
        Add => ${concat($p, _add_ph)}(a, b),
        Sub => ${concat($p, _sub_ph)}(a, b),
        Mul => ${concat($p, _mul_ph)}(a, b),
        Div => ${concat($p, _div_ph)}(a, b),
        Sqrt => ${concat($p, _sqrt_ph)}(a),
        Floor => ${concat($p, _roundscale_ph)}::<9>(a),
        Ceil => ${concat($p, _roundscale_ph)}::<10>(a),
        Trunc => ${concat($p, _roundscale_ph)}::<11>(a),
        Even => ${concat($p, _roundscale_ph)}::<8>(a),
        // See `neg` in simd/x86_prim.rs.
        Neg => {
            #[inline]
            #[target_feature(enable = "avx512fp16,avx512vl")]
            fn neg(a: ${concat(__m, $n, h)}, never: bool) -> ${concat(__m, $n, h)} {
                let bits = ${concat($p, _add_epi16)}(${concat($p, _castph_si, $n)}(a), ${concat($p, _set1_epi16)}(i16::MIN));
                core::hint::select_unpredictable(never, a, ${concat($p, _castsi, $n, _ph)}(bits))
            }
            neg(a, matches!(crate::simd::only_combined([0; 2], [0; 2]), Some([it, _]) if it != 0))
        }
        OfSigned => ${concat($p, _cvtepi16_ph)}(${concat($p, _castph_si, $n)}(a)),
        OfUnsigned => ${concat($p, _cvtepu16_ph)}(${concat($p, _castph_si, $n)}(a)),
        Eq => return mask(${concat($p, _cmp_ph_mask)}::<_CMP_EQ_OQ>(a, b)).to(),
        Ne => return mask(${concat($p, _cmp_ph_mask)}::<_CMP_NEQ_UQ>(a, b)).to(),
        Lt => return mask(${concat($p, _cmp_ph_mask)}::<_CMP_LT_OS>(a, b)).to(),
        Le => return mask(${concat($p, _cmp_ph_mask)}::<_CMP_LE_OS>(a, b)).to(),
    }).to()
}}; }
#[rules]
macro_rules! f16_to_32 { ($p:ident, $v:expr, $how:ident) => { match $how {
    (true, true) => ${concat($p, _cvtph_epi32)}($v),
    (true, false) => ${concat($p, _cvttph_epi32)}($v),
    (false, true) => ${concat($p, _cvtph_epu32)}($v),
    (false, false) => ${concat($p, _cvttph_epu32)}($v),
}.to() }; }
group! { fp16 "avx512fp16,avx512vl" {}
    on_f16_16(a: u8x16, b: u8x16, op: crate::half::Op) -> u8x16 = on_f16!(_mm 128, a, b, op);
    on_f16_32(a: u8x32, b: u8x32, op: crate::half::Op) -> u8x32 = on_f16!(_mm256 256, a, b, op);
    on_f16_64(a: u8x64, b: u8x64, op: crate::half::Op) -> u8x64 = on_f16!(_mm512 512, a, b, op);
    min_f16_16(a: u8x16, b: u8x16) -> u8x16 = halves!(_16 _mm_castsi128_ph _mm_castph_si128, _mm_min_ph(a, b));
    min_f16_32(a: u8x32, b: u8x32) -> u8x32 = halves!(_32 _mm256_castsi256_ph _mm256_castph_si256, _mm256_min_ph(a, b));
    min_f16_64(a: u8x64, b: u8x64) -> u8x64 = halves!(_64 _mm512_castsi512_ph _mm512_castph_si512, _mm512_min_ph(a, b));
    max_f16_16(a: u8x16, b: u8x16) -> u8x16 = halves!(_16 _mm_castsi128_ph _mm_castph_si128, _mm_max_ph(a, b));
    max_f16_32(a: u8x32, b: u8x32) -> u8x32 = halves!(_32 _mm256_castsi256_ph _mm256_castph_si256, _mm256_max_ph(a, b));
    max_f16_64(a: u8x64, b: u8x64) -> u8x64 = halves!(_64 _mm512_castsi512_ph _mm512_castph_si512, _mm512_max_ph(a, b));
    rounded_f16(a: u8x64, b: u8x64, c: u8x64, how: (u8, crate::Round)) -> u8x64 = {
        let (a, b, c) = (_mm512_castsi512_ph(a.to()), _mm512_castsi512_ph(b.to()), _mm512_castsi512_ph(c.to()));
        _mm512_castph_si512(match how.0 {
            ADD => toward!(@ how.1, _mm512_add_round_ph(a, b) 8),
            MUL => toward!(@ how.1, _mm512_mul_round_ph(a, b) 8),
            DIV => toward!(@ how.1, _mm512_div_round_ph(a, b) 8),
            SQRT => toward!(@ how.1, _mm512_sqrt_round_ph(a) 8),
            _ => toward!(@ how.1, _mm512_fmadd_round_ph(a, b, c) 8),
        }).to()
    };
    truncate_f16_16(v: u8x16, signed: bool) -> u8x16 = { let v = _mm_castsi128_ph(v.to()); if signed { _mm_cvttph_epi16(v) } else { _mm_cvttph_epu16(v) }.to() };
    truncate_f16_32(v: u8x32, signed: bool) -> u8x32 = { let v = _mm256_castsi256_ph(v.to()); if signed { _mm256_cvttph_epi16(v) } else { _mm256_cvttph_epu16(v) }.to() };
    truncate_f16_64(v: u8x64, signed: bool) -> u8x64 = { let v = _mm512_castsi512_ph(v.to()); if signed { _mm512_cvttph_epi16(v) } else { _mm512_cvttph_epu16(v) }.to() };
    nearest_f16_16(v: u8x16, signed: bool) -> u8x16 = { let v = _mm_castsi128_ph(v.to()); if signed { _mm_cvtph_epi16(v) } else { _mm_cvtph_epu16(v) }.to() };
    nearest_f16_32(v: u8x32, signed: bool) -> u8x32 = { let v = _mm256_castsi256_ph(v.to()); if signed { _mm256_cvtph_epi16(v) } else { _mm256_cvtph_epu16(v) }.to() };
    nearest_f16_64(v: u8x64, signed: bool) -> u8x64 = { let v = _mm512_castsi512_ph(v.to()); if signed { _mm512_cvtph_epi16(v) } else { _mm512_cvtph_epu16(v) }.to() };
    class_f16_16(v: u8x16, kind: core::num::FpCategory) -> u8x16 = class!(_mm_movm_epi16, _mm_fpclass_ph_mask, _mm_castsi128_ph(v.to()), kind);
    class_f16_32(v: u8x32, kind: core::num::FpCategory) -> u8x32 = class!(_mm256_movm_epi16, _mm256_fpclass_ph_mask, _mm256_castsi256_ph(v.to()), kind);
    class_f16_64(v: u8x64, kind: core::num::FpCategory) -> u8x64 = class!(_mm512_movm_epi16, _mm512_fpclass_ph_mask, _mm512_castsi512_ph(v.to()), kind);
    f16_to_32_16(v: u8x16, how: (bool, bool)) -> u8x16 = f16_to_32!(_mm, _mm_castsi128_ph(v.to()), how);
    f16_to_32_32(v: u8x32, how: (bool, bool)) -> u8x32 = f16_to_32!(_mm256, _mm_castsi128_ph(v.extract::<0, 16>().to()), how);
    f16_to_32_64(v: u8x64, how: (bool, bool)) -> u8x64 = f16_to_32!(_mm512, _mm256_castsi256_ph(v.extract::<0, 32>().to()), how);
    fma_f16_16(a: u8x16, b: u8x16, c: u8x16) -> u8x16 = halves!(_16 _mm_castsi128_ph _mm_castph_si128, _mm_fmadd_ph(a, b, c));
    fma_f16_32(a: u8x32, b: u8x32, c: u8x32) -> u8x32 = halves!(_32 _mm256_castsi256_ph _mm256_castph_si256, _mm256_fmadd_ph(a, b, c));
    fma_f16_64(a: u8x64, b: u8x64, c: u8x64) -> u8x64 = halves!(_64 _mm512_castsi512_ph _mm512_castph_si512, _mm512_fmadd_ph(a, b, c));
    approximate_reciprocal_f16_16(v: u8x16) -> u8x16 = halves!(_16 _mm_castsi128_ph _mm_castph_si128, _mm_rcp_ph(v));
    approximate_reciprocal_sqrt_f16_16(v: u8x16) -> u8x16 = halves!(_16 _mm_castsi128_ph _mm_castph_si128, _mm_rsqrt_ph(v));
    exponent_f16_16(v: u8x16) -> u8x16 = halves!(_16 _mm_castsi128_ph _mm_castph_si128, _mm_getexp_ph(v));
    scale_f16_16(v: u8x16, by: u8x16) -> u8x16 = halves!(_16 _mm_castsi128_ph _mm_castph_si128, _mm_scalef_ph(v, by));
    complex_mul_add_f16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = halves!(_16 _mm_castsi128_ph _mm_castph_si128, _mm_fmadd_pch(a, b, sum));
    conjugate_mul_add_f16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = halves!(_16 _mm_castsi128_ph _mm_castph_si128, _mm_fcmadd_pch(b, a, sum));
    approximate_reciprocal_f16_32(v: u8x32) -> u8x32 = halves!(_32 _mm256_castsi256_ph _mm256_castph_si256, _mm256_rcp_ph(v));
    approximate_reciprocal_sqrt_f16_32(v: u8x32) -> u8x32 = halves!(_32 _mm256_castsi256_ph _mm256_castph_si256, _mm256_rsqrt_ph(v));
    exponent_f16_32(v: u8x32) -> u8x32 = halves!(_32 _mm256_castsi256_ph _mm256_castph_si256, _mm256_getexp_ph(v));
    scale_f16_32(v: u8x32, by: u8x32) -> u8x32 = halves!(_32 _mm256_castsi256_ph _mm256_castph_si256, _mm256_scalef_ph(v, by));
    complex_mul_add_f16_32(a: u8x32, b: u8x32, sum: u8x32) -> u8x32 = halves!(_32 _mm256_castsi256_ph _mm256_castph_si256, _mm256_fmadd_pch(a, b, sum));
    conjugate_mul_add_f16_32(a: u8x32, b: u8x32, sum: u8x32) -> u8x32 = halves!(_32 _mm256_castsi256_ph _mm256_castph_si256, _mm256_fcmadd_pch(b, a, sum));
    approximate_reciprocal_f16_64(v: u8x64) -> u8x64 = halves!(_64 _mm512_castsi512_ph _mm512_castph_si512, _mm512_rcp_ph(v));
    approximate_reciprocal_sqrt_f16_64(v: u8x64) -> u8x64 = halves!(_64 _mm512_castsi512_ph _mm512_castph_si512, _mm512_rsqrt_ph(v));
    exponent_f16_64(v: u8x64) -> u8x64 = halves!(_64 _mm512_castsi512_ph _mm512_castph_si512, _mm512_getexp_ph(v));
    scale_f16_64(v: u8x64, by: u8x64) -> u8x64 = halves!(_64 _mm512_castsi512_ph _mm512_castph_si512, _mm512_scalef_ph(v, by));
    complex_mul_add_f16_64(a: u8x64, b: u8x64, sum: u8x64) -> u8x64 = halves!(_64 _mm512_castsi512_ph _mm512_castph_si512, _mm512_fmadd_pch(a, b, sum));
    conjugate_mul_add_f16_64(a: u8x64, b: u8x64, sum: u8x64) -> u8x64 = halves!(_64 _mm512_castsi512_ph _mm512_castph_si512, _mm512_fcmadd_pch(b, a, sum));
}

macro_rules! brain {
    ($v:ident) => {
        crate::simd::cast($v)
    };
}
group! { bf16 "avx512bf16,avx512vl,avx512dq" {}
    narrow_bf16_16(a: u8x16, b: u8x16) -> u8x16 = { let v = _mm_cvtne2ps_pbh(b.to(), a.to()); brain!(v) };
    narrow_bf16_32(a: u8x32, b: u8x32) -> u8x32 = { let v = _mm256_cvtne2ps_pbh(b.to(), a.to()); brain!(v) };
    narrow_bf16_64(a: u8x64, b: u8x64) -> u8x64 = { let v = _mm512_cvtne2ps_pbh(b.to(), a.to()); brain!(v) };
    any_subnormal_f32_16(a: u8x16, b: u8x16) -> bool =
        _mm_fpclass_ps_mask::<0x20>(a.to()) | _mm_fpclass_ps_mask::<0x20>(b.to()) != 0;
    any_subnormal_f32_32(a: u8x32, b: u8x32) -> bool =
        _mm256_fpclass_ps_mask::<0x20>(a.to()) | _mm256_fpclass_ps_mask::<0x20>(b.to()) != 0;
    any_subnormal_f32_64(a: u8x64, b: u8x64) -> bool =
        _mm512_fpclass_ps_mask::<0x20>(a.to()) | _mm512_fpclass_ps_mask::<0x20>(b.to()) != 0;
    dot_bf16_16(a: u8x16, b: u8x16, sum: u8x16) -> u8x16 = _mm_dpbf16_ps(sum.to(), brain!(a), brain!(b)).to();
    dot_bf16_32(a: u8x32, b: u8x32, sum: u8x32) -> u8x32 =
        _mm256_dpbf16_ps(sum.to(), brain!(a), brain!(b)).to();
    dot_bf16_64(a: u8x64, b: u8x64, sum: u8x64) -> u8x64 =
        _mm512_dpbf16_ps(sum.to(), brain!(a), brain!(b)).to();
}
