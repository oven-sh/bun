//! Memory that other threads write to at the same time, or other processes: `&[AtomicU8]`, or
//! `&[Shared<T>]` for wider lanes. The compiler can't check this file completely.
//!
//! Rust has no atomic access to a vector, and LLVM doesn't join atomic accesses to bytes. So `access!` is one
//! instruction of inline assembly.

#![deny(asm_sub_register)]

use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

/// A `T` in shared memory, as `SIZE` bytes in the order of the CPU that are atomic one by one. It needs no alignment, and a value that is
/// written while it is read can be torn. `as_chunks` makes these from `&[AtomicU8]`, and `as_flattened` is the reverse.
///
/// ```
/// use core::sync::atomic::AtomicU8;
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let memory = [const { AtomicU8::new(1) }; 16];
/// let words: &[Shared<4>] = memory.as_chunks().0;
/// assert_eq!(u32x4::load(words), [0x0101_0101; 4]);
/// # } example()
/// ```
pub type Shared<const SIZE: usize> = [AtomicU8; SIZE];

/// The first for the tools that don't look into assembly and have to see each byte, or else the second.
macro_rules! seen { ({ $($stand_in:tt)* } { $($assembly:tt)* }) => { cfg_select! {
    any(miri, bun_simd_sanitize = "memory", bun_simd_sanitize = "thread") => {{ $($stand_in)* }}
    _ => {{ $($assembly)* }}
} }; }

/// What the assembly stands for: as many bytes as both have.
#[inline(always)]
fn load_each<const N: usize>(from: &[AtomicU8]) -> [u8; N] {
    let mut all = [0; N];
    for (to, from) in all.iter_mut().zip(from) {
        *to = from.load(Relaxed)
    }
    all
}
#[inline(always)]
fn store_each<const N: usize>(to: &[AtomicU8], all: [u8; N]) {
    for (to, v) in to.iter().zip(all) {
        to.store(v, Relaxed)
    }
}

/// Whether the functions below exist.
macro_rules! with_assembly { ($($item:item)*) => { $(
    #[cfg(all(not(miri), any(all(target_arch = "x86_64", target_feature = "sse2"), all(target_arch = "aarch64", target_feature = "neon", target_endian = "little"))))] $item
)* }; }

with_assembly! {
    /// Fills the register. Above a pointer of 32 bits it could hold anything. The block then gets the pointer too.
    #[inline(always)]
    #[cfg(target_pointer_width = "64")]
    fn address(bytes: &[AtomicU8], before: usize) -> *const AtomicU8 {
        bytes.as_ptr().wrapping_sub(before)
    }
    #[inline(always)]
    #[cfg(not(target_pointer_width = "64"))]
    fn address(bytes: &[AtomicU8], before: usize) -> u64 {
        (bytes.as_ptr().addr() as u64).wrapping_sub(before as u64)
    }

    /// Runs `$template`, which has to be one load or store of `$bytes` or a part of them, and of nothing else, from or to `{v}`. `{p}` is `$before` bytes before them.
    #[allow(unused_macros)]
    macro_rules! access {
        ($template:literal, $bytes:ident $(- $before:ident)?, [$($option:ident)?], $($operands:tt)*) => {{
            let bytes: &[AtomicU8] = $bytes;
            // What AddressSanitizer checks of a vector without alignment. Each byte would take 20 times as long.
            #[cfg(any(bun_simd_sanitize = "address", bun_simd_sanitize = "hwaddress", bun_simd_sanitize = "kernel-address", bun_simd_sanitize = "kernel-hwaddress"))]
            if let (Some(first), Some(last)) = (bytes.first(), bytes.last()) { first.load(Relaxed); last.load(Relaxed); }
            // SAFETY: this does what a relaxed `load` or `store` of each of these bytes does.
            #[allow(unsafe_code)]
            unsafe {
                core::arch::asm!($template, #[cfg(not(target_pointer_width = "64"))] "/* {q:x} */", p = in(reg) address(bytes, 0 $(+ $before)?), $($operands)*
                    #[cfg(not(target_pointer_width = "64"))] q = in(reg) bytes.as_ptr(), options($($option,)? nostack, preserves_flags))
            }
        }};
    }

    /// All `size_of::<$t>()` bytes of an array.
    macro_rules! whole {
        ($($feature:literal $t:ty, $class:ident, $load:ident $load_template:literal, $store:ident $store_template:literal;)*) => {$(
            #[inline]
            #[target_feature(enable = $feature)]
            pub fn $load(from: &[AtomicU8; size_of::<$t>()]) -> $t {
                seen!({ crate::simd::Simd::<u8, { size_of::<$t>() }>::from_array(load_each(from)).into() } { let v; access!($load_template, from, [readonly], v = lateout($class) v,); v })
            }
            #[inline]
            #[target_feature(enable = $feature)]
            pub fn $store(to: &[AtomicU8; size_of::<$t>()], v: $t) {
                seen!({ store_each(to, crate::simd::Simd::<u8, { size_of::<$t>() }>::from(v).to_array()) } { access!($store_template, to, [], v = in($class) v,) })
            }
        )*};
    }

    /// The last `size_of::<$t>()` bytes of an array, so that neighbors share an address. LLVM can't put an offset into a template.
    #[allow(unused_macros)]
    macro_rules! last {
        ($($feature:literal $t:ty, $class:ident, $load:ident $n:literal $template:literal;)*) => {$(
            #[inline]
            #[target_feature(enable = $feature)]
            pub fn $load(from: &[AtomicU8; $n]) -> $t {
                seen!({ crate::simd::Simd::<u8, { size_of::<$t>() }>::from_array(load_each(&from[$n - size_of::<$t>()..])).into() }
                    {
                        // The first byte of the vector is not that of the array.
                        #[cfg(any(bun_simd_sanitize = "address", bun_simd_sanitize = "hwaddress", bun_simd_sanitize = "kernel-address", bun_simd_sanitize = "kernel-hwaddress"))]
                        from[$n - size_of::<$t>()].load(Relaxed);
                        let v; access!($template, from, [readonly], v = lateout($class) v,); v
                    })
            }
        )*};
    }
}

/// Numbers need no target features. On AArch64 the system decides whether `ldr` and `str` have to be aligned: these let
/// them be unaligned.
macro_rules! numbers {
    ($($t:ident $load:ident $store:ident, $x86_load:literal $x86_store:literal, $arm_load:literal $arm_store:literal;)*) => {$(
        #[inline(always)]
        pub fn $load(from: &[AtomicU8; size_of::<$t>()]) -> $t {
            seen!({ $t::from_le_bytes(load_each(from)) } { cfg_select! {
                all(target_arch = "x86_64", target_feature = "sse2") => { let v; access!($x86_load, from, [readonly], v = lateout(reg) v,); v }
                all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", any(target_os = "linux", target_os = "android", target_vendor = "apple", target_os = "windows", target_os = "freebsd", target_os = "openbsd")) => { let v; access!($arm_load, from, [readonly], v = lateout(reg) v,); v }
                _ => { $t::from_le_bytes(load_each(from)) }
            } })
        }
        #[inline(always)]
        pub fn $store(to: &[AtomicU8; size_of::<$t>()], v: $t) {
            seen!({ store_each(to, v.to_le_bytes()) } { cfg_select! {
                all(target_arch = "x86_64", target_feature = "sse2") => { access!($x86_store, to, [], v = in(reg) v,) }
                all(target_arch = "aarch64", target_feature = "neon", target_endian = "little", any(target_os = "linux", target_os = "android", target_vendor = "apple", target_os = "windows", target_os = "freebsd", target_os = "openbsd")) => { access!($arm_store, to, [], v = in(reg) v,) }
                _ => { store_each(to, v.to_le_bytes()) }
            } })
        }
    )*};
}

numbers! {
    u16 load_2 store_2, "movzx {v:e}, word ptr [{p}]" "mov word ptr [{p}], {v:x}", "ldrh {v:w}, [{p}]" "strh {v:w}, [{p}]";
    u32 load_4 store_4, "mov {v:e}, dword ptr [{p}]" "mov dword ptr [{p}], {v:e}", "ldr {v:w}, [{p}]" "str {v:w}, [{p}]";
    u64 load_8 store_8, "mov {v:r}, qword ptr [{p}]" "mov qword ptr [{p}], {v:r}", "ldr {v:x}, [{p}]" "str {v:x}, [{p}]";
}

#[cfg(all(not(miri), target_arch = "aarch64", target_feature = "neon", target_endian = "little"))]
pub mod neon {
    use super::*;
    use core::arch::aarch64::uint8x16_t;
    cfg_select! {
        any(
            target_os = "linux",
            target_os = "android",
            target_vendor = "apple",
            target_os = "windows",
            target_os = "freebsd",
            target_os = "openbsd"
        ) => {
            whole! { "neon" uint8x16_t, vreg, load_16 "ldr {v:q}, [{p}]", store_16 "str {v:q}, [{p}]"; }
            last! {
                "neon" uint8x16_t, vreg, load_16_of_32 32 "ldr {v:q}, [{p}, #16]";
                "neon" uint8x16_t, vreg, load_16_of_48 48 "ldr {v:q}, [{p}, #32]";
                "neon" uint8x16_t, vreg, load_16_of_64 64 "ldr {v:q}, [{p}, #48]";
            }
        }
        // These are aligned if a lane is.
        _ => {
            whole! { "neon" uint8x16_t, vreg, load_16 "ld1 {{{v:v}.16b}}, [{p}]", store_16 "st1 {{{v:v}.16b}}, [{p}]"; }
            #[inline]
            #[target_feature(enable = "neon")]
            pub fn load_last<const N: usize>(from: &Shared<N>) -> uint8x16_t {
                load_16(from.last_chunk().unwrap())
            }
            pub use {load_last as load_16_of_32, load_last as load_16_of_48, load_last as load_16_of_64};
        }
    }
}

#[cfg(all(not(miri), target_arch = "x86_64", target_feature = "sse2"))]
pub mod x86 {
    use super::*;
    use core::arch::x86_64::{__m128i, __m256i, __m512i};

    whole! {
        "sse2" __m128i, xmm_reg, load_16_sse "movdqu {v}, [{p}]", store_16_sse "movdqu [{p}], {v}";
        "avx" __m128i, xmm_reg, load_16 "vmovdqu {v}, [{p}]", store_16 "vmovdqu [{p}], {v}";
        "avx" __m256i, ymm_reg, load_32 "vmovdqu {v}, [{p}]", store_32 "vmovdqu [{p}], {v}";
        "avx512f" __m512i, zmm_reg, load_64 "vmovdqu64 {v}, [{p}]", store_64 "vmovdqu64 [{p}], {v}";
    }

    last! {
        "avx" __m256i, ymm_reg, load_32_of_64 64 "vmovdqu {v}, [{p} + 32]";
        "avx" __m256i, ymm_reg, load_32_of_96 96 "vmovdqu {v}, [{p} + 64]";
        "avx" __m256i, ymm_reg, load_32_of_128 128 "vmovdqu {v}, [{p} + 96]";
        "avx512f" __m512i, zmm_reg, load_64_of_128 128 "vmovdqu64 {v}, [{p} + 64]";
    }

    /// One bit for each of `bytes`, or for the first 64.
    #[inline(always)]
    fn mask(bytes: &[AtomicU8]) -> u64 {
        if bytes.len() < 64 { !(!0 << bytes.len()) } else { !0 }
    }

    /// As many bytes as the slice and the vector have. A load takes those that fit from lane `skip` on.
    macro_rules! partial {
        ($($t:ty, $class:ident, $load:ident, $store:ident;)*) => {$(
            #[inline]
            #[target_feature(enable = "avx512bw,avx512vl")]
            pub fn $load(from: &[AtomicU8], skip: usize) -> $t {
                let skip = skip % size_of::<$t>();
                seen!({ let mut all = load_each(&from[..from.len().min(size_of::<$t>() - skip)]); all.rotate_right(skip); crate::simd::Simd::<u8, { size_of::<$t>() }>::from_array(all).into() }
                    { let v; access!("vmovdqu8 {v} {{{k}}} {{z}}, [{p}]", from - skip, [readonly], v = lateout($class) v, k = in(kreg) mask(from) << skip,); v })
            }
            #[inline]
            #[target_feature(enable = "avx512bw,avx512vl")]
            pub fn $store(to: &[AtomicU8], v: $t) {
                seen!({ store_each(to, crate::simd::Simd::<u8, { size_of::<$t>() }>::from(v).to_array()) }
                    { access!("vmovdqu8 [{p}] {{{k}}}, {v}", to, [], v = in($class) v, k = in(kreg) mask(to),) })
            }
        )*};
    }
    partial! {
        __m128i, xmm_reg, load_n_16, store_n_16;
        __m256i, ymm_reg, load_n_32, store_n_32;
        __m512i, zmm_reg, load_n_64, store_n_64;
    }
}
