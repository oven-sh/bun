//! Partial loads and stores of AVX2, 4 bytes at a time, and the table of their masks.

use crate::simd::{u8x16, u8x32};
#[cfg(target_arch = "x86")]
use core::arch::x86::*;
#[cfg(target_arch = "x86_64")]
use core::arch::x86_64::*;

/// Starts with `n` bytes of ones, up to 32, and then zeros. At the places below are indices for shuffles, which so share its address.
#[inline(always)]
pub fn edge(n: usize) -> &'static [u8] {
    const ALL: &[u8; 448] = &crate::Aligned({
        let (mut all, mut i) = ([0x80; 448], 0);
        while i < 64 {
            all[i] = if i < 32 { 255 } else { 0 };
            (all[FOUR + 28 + i % 4], all[TWO + 30 + i % 2], all[WORDS + i]) = (i as u8 % 4, i as u8 % 2, i as u8 / 4);
            (all[TURNS + (i & 47)], all[BYTES + 32 + i % 16], all[AROUND + 16 + i / 2]) =
                (i as u8 % 16, i as u8 % 16, i as u8 / 2 % 16);
            i += 1;
        }
        all
    })
    .0;
    &ALL[32 - n.min(32)..]
}
/// The first four or two bytes go to end at `n`, and the others are zero.
pub const FOUR: usize = 64;
pub const TWO: usize = 128;
/// Words of 4 bytes go up by `n` bytes, and around.
pub const WORDS: usize = 192;
/// The same for bytes: 16 indices for those from the same half of 32, and then 16 for those from the other.
pub const TURNS: usize = 256;
/// The same, not around: 16 each for those from the same half, from the one below, and from the one below that.
pub const BYTES: usize = 320;
/// Around in 16 bytes, for `n <= 16`.
pub const AROUND: usize = 384;

/// An empty slice can be where nothing is mapped, and AMD doesn't promise that an empty mask can't fault. So it moves next to
/// its mask. In a page that is never read, each call takes 100 ns.
#[inline(always)]
fn somewhere(from: &[u8]) -> &[u8] {
    core::hint::select_unpredictable(from.is_empty(), &edge(32)[..0], from)
}

macro_rules! load { ($($load:ident $store:ident $bytes:ident $maskload:ident $maskstore:ident $regs:ident;)*) => {$(
    /// The rest is zero.
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn $load<S: crate::simd::Cpu>(from: &[u8]) -> $bytes where crate::simd::Here: crate::simd::In<S> {
        let from = somewhere(from);
        let it = load!(@ $maskload from as_ptr [] $bytes).into();

        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
        let it = crate::regs::$regs(it);
        it
    }
    #[inline]
    #[target_feature(enable = "avx2")]
    pub fn $store<S: crate::simd::Cpu>(v: $bytes, to: &mut [u8]) where crate::simd::Here: crate::simd::In<S> {
        let v = v.into();
        load!(@ $maskstore to as_mut_ptr [v] $bytes)
    }
)*};
    (@ $access:ident $slice:ident $pointer:ident [$($v:ident)?] $bytes:ident) => {{
        let within = *edge(<[u8]>::len($slice)).first_chunk().unwrap();
        let (at, enable) = (<[u8]>::$pointer($slice).cast(), $bytes::from_array(within).into());
        // SAFETY: it accesses the lanes that are negative, whose last byte is in the slice by `edge`. The callers keep the whole vector in a
        // page that can be accessed: `words_near_absent_page`, `without_words`, `in_one_page`.
        #[allow(unsafe_code)]
        unsafe { $access(at, enable $(, $v)?) }
    }};
}
#[cfg(target_feature = "sse2")]
load! {
    load_16 store_16 u8x16 _mm_maskload_epi32 _mm_maskstore_epi32 xmm;
    load_32 store_32 u8x32 _mm256_maskload_epi32 _mm256_maskstore_epi32 ymm;
}
