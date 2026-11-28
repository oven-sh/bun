//! Masked loads and stores. The vector can start before the slice, which can have cells or uninitialized memory.

use crate::ops::{Ops, Portable};
use crate::simd::{Cpu, Fits, Mask, Simd};
use core::cell::Cell;
use core::mem::MaybeUninit;

/// A bit for each of the first `n` of up to 64 `lanes`.
#[inline(always)]
pub(crate) fn first_bits(n: usize, lanes: usize) -> u64 {
    if lanes < 64 {
        !(!0 << n.min(lanes))
    } else if n < 64 {
        !(!0 << n)
    } else {
        !0
    }
}

/// The same in one instruction, where there is one. It can have bits from `lanes` on.
#[inline(always)]
pub(crate) fn first_on(s: impl Ops, n: usize) -> u64 {
    s.low_bits(n.min(255) as u32)
}

/// A bit for each lane that has a value, if there are `len` and the first is in lane `skip`, which is less than 64.
#[inline(always)]
fn within(s: Option<impl Ops>, len: usize, skip: usize, lanes: usize) -> u64 {
    let first = if let Some(s) = s { first_on(s, len) } else { first_bits(len, lanes) };
    first << skip
}

/// How many of `len` values have a lane.
#[inline(always)]
fn reached(len: usize, skip: usize, lanes: usize) -> usize {
    len.min(lanes.saturating_sub(skip))
}

const fn masks<S: Cpu>() -> bool {
    cfg_select! {
        all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2") => {
            S::LEVEL >= crate::simd::AVX512
        }
        _ => false,
    }
}

/// With AVX-512, `$one` gets each register: its number, its bits from the lowest on, and the address of its first lane.
macro_rules! masked { ($within:expr, $keep:ident, $start:expr, $one:ident, $result:expr) => {
    #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2"))]
    if const { masks::<S>() } {
        #[cfg(target_arch = "x86")]
        use core::arch::x86::*;
        #[cfg(target_arch = "x86_64")]
        use core::arch::x86_64::*;
        use crate::simd::{RegOf, part};
        const fn register<R>() -> usize { if size_of::<R>() < 64 { size_of::<R>() } else { 64 } }
        let within = $within & const { !0 >> (64 - N) };
        #[cfg(all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2", not(miri)))]
        let within = crate::regs::lanes_within(within, const { size_of::<RegOf<T, N>>() / T::SIZE });
        let bits = match $keep {
            Some(keep) => keep.and::<S>(Mask::from_bitmask::<S>(within)).to_bitmask::<S>(),
            None => within,
        };
        let (start, lanes, mut i) = ($start, const { register::<RegOf<T, N>>() / T::SIZE }, 0);
        while i < const { size_of::<RegOf<T, N>>() / register::<RegOf<T, N>>() } {
            let (bits, at) = (bits >> (i * lanes % 64), start.wrapping_add(i * lanes));
            masked! { @ $one i bits at
                16 1 _mm_mask_loadu_epi8 _mm_mask_storeu_epi8 32 1 _mm256_mask_loadu_epi8 _mm256_mask_storeu_epi8 64 1 _mm512_mask_loadu_epi8 _mm512_mask_storeu_epi8
                16 2 _mm_mask_loadu_epi16 _mm_mask_storeu_epi16 32 2 _mm256_mask_loadu_epi16 _mm256_mask_storeu_epi16 64 2 _mm512_mask_loadu_epi16 _mm512_mask_storeu_epi16
                16 4 _mm_mask_loadu_epi32 _mm_mask_storeu_epi32 32 4 _mm256_mask_loadu_epi32 _mm256_mask_storeu_epi32 64 4 _mm512_mask_loadu_epi32 _mm512_mask_storeu_epi32
                16 8 _mm_mask_loadu_epi64 _mm_mask_storeu_epi64 32 8 _mm256_mask_loadu_epi64 _mm256_mask_storeu_epi64 64 8 _mm512_mask_loadu_epi64 _mm512_mask_storeu_epi64
            }
            i += 1;
        }
        return $result;
    }
};
    (@ $one:ident $i:ident $bits:ident $at:ident $($bytes:literal $size:literal $load:ident $store:ident)*) => {$(
        if const { register::<RegOf<T, N>>() == $bytes && T::SIZE == $size } {
            $one!($load $store, $i, $bits as _, $at.cast())
        }
    )*};
}

/// Lane `skip + i` is `from[i]` if that exists, and `keep` has the lane. The others are those of `or`.
#[inline(always)]
pub(crate) fn load<S: Cpu, T: Fits<N>, const N: usize>(
    s: Option<impl Ops>,
    from: Result<&[T], &[Cell<T>]>,
    skip: usize,
    keep: Option<Mask<T::Mask, N>>,
    mut or: Simd<T, N>,
) -> Simd<T, N> {
    let (start, len): (*const T, _) = match from {
        Ok(from) => (from.as_ptr(), from.len()),
        Err(from) => (from.as_ptr().cast(), from.len()),
    };
    let skip = skip % 64;
    macro_rules! one {
        ($load:ident $store:ident, $i:ident, $bits:expr, $at:expr) => {{
            let (or_else, bits, at) = (part(&or.0, $i), $bits, $at);
            // SAFETY: lane `k` has the address of `from[k - skip]`, and `within` enables it only if that exists.
            // `masked!` gets here only if `S` has AVX-512, and picks the row by the sizes of the register and the lanes.
            #[allow(unsafe_code)]
            let it = unsafe { $load(or_else, bits, at) };
            #[cfg(all(
                any(target_arch = "x86", target_arch = "x86_64"),
                target_feature = "sse2",
                not(miri)
            ))]
            let it = crate::simd::accessed::<S, _>(it);
            crate::simd::set_part(&mut or.0, $i, it)
        }};
    }
    masked!(within(s, len, skip, N), keep, start.wrapping_sub(skip), one, or);
    let keep = if let Some(keep) = keep { keep.to_bitmask::<S>() } else { !0 };
    for i in 0..reached(len, skip, N) {
        if keep >> (skip + i) & 1 != 0 {
            or[skip + i] = match from {
                Ok(from) => from[i],
                Err(from) => from[i].get(),
            };
        }
    }
    or
}

pub(crate) enum To<'a, T> {
    Values(&'a mut [T]),
    Room(&'a mut [MaybeUninit<T>]),
    Cells(&'a [Cell<T>]),
}

/// The reverse.
#[inline(always)]
pub(crate) fn store<S: Cpu, T: Fits<N>, const N: usize>(
    s: Option<impl Ops>,
    v: Simd<T, N>,
    mut to: To<'_, T>,
    skip: usize,
    keep: Option<Mask<T::Mask, N>>,
) {
    let (start, len): (*mut T, _) = match &mut to {
        To::Values(to) => (to.as_mut_ptr(), to.len()),
        To::Room(to) => (to.as_mut_ptr().cast(), to.len()),
        To::Cells(to) => (to.as_ptr().cast_mut().cast(), to.len()),
    };
    let skip = skip % 64;
    macro_rules! one {
        ($load:ident $store:ident, $i:ident, $bits:expr, $at:expr) => {{
            let (at, bits, it) = ($at, $bits, part(&v.0, $i));
            // SAFETY: as above.
            #[allow(unsafe_code)]
            unsafe {
                $store(at, bits, it)
            }
        }};
    }
    masked!(within(s, len, skip, N), keep, start.wrapping_sub(skip), one, ());
    let keep = if let Some(keep) = keep { keep.to_bitmask::<S>() } else { !0 };
    for i in 0..reached(len, skip, N) {
        if keep >> (skip + i) & 1 != 0 {
            match &mut to {
                To::Values(to) => to[i] = v[skip + i],
                To::Room(to) => to[i] = MaybeUninit::new(v[skip + i]),
                To::Cells(to) => to[i].set(v[skip + i]),
            }
        }
    }
}

/// The same, and returns what it wrote.
#[inline(always)]
pub(crate) fn fill<S: Cpu, T: Fits<N>, const N: usize>(
    v: Simd<T, N>,
    to: &mut [MaybeUninit<T>],
    skip: usize,
) -> &mut [T] {
    const { assert!(N <= 64) };
    let skip = skip % 64;
    let n = reached(to.len(), skip, N);
    if const { !masks::<S>() } {
        return to[..n].write_copy_of_slice(&v.as_array()[skip.min(N)..][..n]);
    }
    store::<S, T, N>(None::<Portable>, v, To::Room(&mut *to), skip, None);
    // SAFETY: without `keep`, the masked store has written lane `skip + i` to `to[i]` wherever both exist, which is for `i < n`.
    #[allow(unsafe_code)]
    unsafe {
        to[..n].assume_init_mut()
    }
}
