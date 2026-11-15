//! Access to memory that other threads may write concurrently.
//!
//! SAFETY: each function behaves like a relaxed atomic access to each of its bytes. Rust has no
//! wider access that may race. To the CPU it is an ordinary access, which never tears a byte.
use crate::SharedU8;
use core::arch::asm;
use core::simd::u8x16;
#[cfg(target_arch = "x86_64")]
use core::simd::{u8x32, u8x64};
use core::sync::atomic::AtomicU8;

#[cfg(not(target_pointer_width = "64"))]
compile_error!("the instructions use 64-bit addresses");

// AddressSanitizer does not look into `asm!`.
cfg_select! {
    sanitize = "address" => {
        unsafe extern "C" {
            #[link_name = "__asan_loadN"]
            safe fn will_load(start: *const SharedU8, len: usize);
            #[link_name = "__asan_storeN"]
            safe fn will_store(start: *const AtomicU8, len: usize);
        }
    }
    _ => {
        #[inline(always)]
        fn will_load(_: *const SharedU8, _: usize) {}
        #[inline(always)]
        fn will_store(_: *const AtomicU8, _: usize) {}
    }
}

/// `asm!` needs literals.
macro_rules! load_and_store {
    ($feature:literal, $T:ty, $class:ident, $load:ident $load_asm:literal, $store:ident $store_asm:literal) => {
        /// `from[AT]`, with the offset in the instruction.
        #[inline]
        #[target_feature(enable = $feature)]
        pub fn $load<const K: usize, const AT: usize>(
            from: &[[SharedU8; size_of::<$T>()]; K],
        ) -> $T {
            const { assert!(AT < K) };
            will_load(from[AT].as_ptr(), size_of::<$T>());
            let v;
            // SAFETY: reads the bytes of `from[AT]`, with an instruction of the enabled feature.
            unsafe {
                asm!(
                    $load_asm,
                    v = out($class) v,
                    p = in(reg) from,
                    at = const AT * size_of::<$T>(),
                    options(readonly, nostack, preserves_flags),
                )
            };
            v
        }

        #[inline]
        #[target_feature(enable = $feature)]
        pub fn $store<const K: usize, const AT: usize>(
            v: $T,
            to: &[[AtomicU8; size_of::<$T>()]; K],
        ) {
            const { assert!(AT < K) };
            will_store(to[AT].as_ptr(), size_of::<$T>());
            // SAFETY: writes the bytes of `to[AT]`, with an instruction of the enabled feature.
            unsafe {
                asm!(
                    $store_asm,
                    v = in($class) v,
                    p = in(reg) to,
                    at = const AT * size_of::<$T>(),
                    options(nostack, preserves_flags),
                )
            }
        }
    };
}

cfg_select! {
    target_arch = "x86_64" => {
        load_and_store!("sse2", u32, reg,
            load4 "mov {v:e}, [{p} + {at}]", store4 "mov [{p} + {at}], {v:e}");
        load_and_store!("sse2", u64, reg,
            load8 "mov {v}, [{p} + {at}]", store8 "mov [{p} + {at}], {v}");
        load_and_store!("sse2", u8x16, xmm_reg,
            load16 "movdqu {v}, [{p} + {at}]", store16 "movdqu [{p} + {at}], {v}");
        load_and_store!("avx", u8x16, xmm_reg,
            load16_vex "vmovdqu {v}, [{p} + {at}]", store16_vex "vmovdqu [{p} + {at}], {v}");
        load_and_store!("avx", u8x32, ymm_reg,
            load32 "vmovdqu {v}, [{p} + {at}]", store32 "vmovdqu [{p} + {at}], {v}");
        load_and_store!("avx512f", u8x64, zmm_reg,
            load64 "vmovdqu64 {v}, [{p} + {at}]", store64 "vmovdqu64 [{p} + {at}], {v}");
    }
    target_arch = "aarch64" => {
        load_and_store!("neon", u32, reg,
            load4 "ldr {v:w}, [{p}, #{at}]", store4 "str {v:w}, [{p}, #{at}]");
        load_and_store!("neon", u64, reg,
            load8 "ldr {v:x}, [{p}, #{at}]", store8 "str {v:x}, [{p}, #{at}]");
        load_and_store!("neon", u8x16, vreg,
            load16 "ldr {v:q}, [{p}, #{at}]", store16 "str {v:q}, [{p}, #{at}]");
    }
}

#[cfg(target_arch = "x86_64")]
#[inline(always)]
fn low_bits(count: usize) -> u64 {
    if count < 64 {
        (1 << count) - 1
    } else {
        u64::MAX
    }
}

/// Pads with zeros if `from` is too short.
#[cfg(target_arch = "x86_64")]
#[inline]
#[target_feature(enable = "avx512bw")]
pub fn load64_masked(from: &[SharedU8]) -> u8x64 {
    will_load(from.as_ptr(), from.len().min(64));
    let v;
    // SAFETY: reads the bytes of `from` that the mask has a bit for, and touches no others.
    unsafe {
        asm!(
            "vmovdqu8 {v} {{{k}}} {{z}}, [{p}]",
            v = out(zmm_reg) v,
            k = in(kreg) low_bits(from.len()),
            p = in(reg) from.as_ptr(),
            options(readonly, nostack, preserves_flags),
        )
    };
    v
}

/// Stores as many bytes as fit.
#[cfg(target_arch = "x86_64")]
#[inline]
#[target_feature(enable = "avx512bw")]
pub fn store64_masked(v: u8x64, to: &[AtomicU8]) {
    will_store(to.as_ptr(), to.len().min(64));
    // SAFETY: writes the bytes of `to` that the mask has a bit for, and touches no others.
    unsafe {
        asm!(
            "vmovdqu8 [{p}] {{{k}}}, {v}",
            v = in(zmm_reg) v,
            k = in(kreg) low_bits(to.len()),
            p = in(reg) to.as_ptr(),
            options(nostack, preserves_flags),
        )
    }
}
