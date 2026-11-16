//! Access to memory that other threads may write concurrently.
//!
//! SAFETY: each function behaves like a relaxed atomic access to each of its bytes. Rust has no
//! wider access that may race. To the CPU it is an ordinary access, which never tears a byte.
use crate::{SharedOutU8, SharedU8};
use core::arch::asm;
use core::simd::{ToBytes, u8x16};
#[cfg(target_arch = "x86_64")]
use core::simd::{u8x32, u8x64};

#[cfg(not(target_pointer_width = "64"))]
compile_error!("the instructions use 64-bit addresses");

// The sanitizers do not look into `asm!`.
cfg_select! {
    sanitize = "address" => {
        unsafe extern "C" {
            #[link_name = "__asan_loadN"]
            safe fn will_load(start: *const u8, len: usize);
            #[link_name = "__asan_storeN"]
            safe fn will_store(start: *const u8, len: usize);
        }
    }
    sanitize = "memory" => {
        unsafe extern "C" {
            #[link_name = "__msan_check_mem_is_initialized"]
            safe fn will_load(start: *const u8, len: usize);
            #[link_name = "__msan_unpoison"]
            safe fn will_store(start: *const u8, len: usize);
        }
    }
    _ => {
        #[inline(always)]
        fn will_load(_: *const u8, _: usize) {}
        #[inline(always)]
        fn will_store(_: *const u8, _: usize) {}
    }
}

/// For ASan, whose red zones have 8 bytes or more. With a call, a loop takes 20 times as long.
#[inline(always)]
fn probes(len: usize) -> impl Iterator<Item = usize> {
    (0..len).step_by(8).chain([len - 1])
}

#[inline(always)]
fn will_load_array<const N: usize>(from: &[SharedU8; N]) {
    match cfg!(sanitize = "address") {
        true => probes(N).for_each(|i| _ = from[i].get()),
        false => will_load(from.as_ptr().cast(), N),
    }
}

#[inline(always)]
fn will_store_array<const N: usize>(bytes: impl Fn(usize) -> u8, to: &[SharedOutU8; N]) {
    match cfg!(sanitize = "address") {
        true => probes(N).for_each(|i| to[i].set(bytes(i))),
        false => will_store(to.as_ptr().cast(), N),
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
            will_load_array(&from[AT]);
            let v;
            // SAFETY: reads the bytes of `from[AT]`, with an instruction of the enabled feature.
            unsafe {
                asm!(
                    $load_asm,
                    v = lateout($class) v,
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
            to: &[[SharedOutU8; size_of::<$T>()]; K],
        ) {
            const { assert!(AT < K) };
            will_store_array(|i| v.to_ne_bytes()[i], &to[AT]);
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

#[inline(always)]
pub fn load2(from: &[SharedU8; 2]) -> u16 {
    will_load_array(from);
    let v: u32;
    // SAFETY: reads the bytes of `from`, with an instruction that needs no feature.
    unsafe {
        asm!(
            cfg_select! {
                target_arch = "x86_64" => "movzx {v:e}, word ptr [{p}]",
                target_arch = "aarch64" => "ldrh {v:w}, [{p}]",
            },
            v = lateout(reg) v,
            p = in(reg) from,
            options(readonly, nostack, preserves_flags),
        )
    };
    v as u16
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

/// For plain memory too: LLVM takes its own masked access to start in the object that it touches.
#[cfg(target_arch = "x86_64")]
mod sealed {
    use super::*;

    /// Has only initialized bytes.
    pub trait Readable {}
    impl Readable for SharedU8 {}
    impl<T: core::simd::SimdElement> Readable for T {}
}

/// The mask and the address of lane 0. Lane `i` has a bit only if `address + i` is in `slice`.
#[cfg(target_arch = "x86_64")]
#[inline(always)]
fn lanes_for<T, const ARE_LAST: bool>(slice: &[T]) -> (u64, *const u8) {
    let (start, size) = (slice.as_ptr().cast::<u8>(), size_of_val(slice));
    if !ARE_LAST {
        return (low_bits(size), start);
    }
    let skipped = 64 - size.min(64);
    (!low_bits(skipped), start.wrapping_sub(skipped))
}

/// To the first or the last lanes if `from` is too short. The others are zero.
#[cfg(target_arch = "x86_64")]
#[inline]
#[target_feature(enable = "avx512bw")]
pub fn load64_masked<const TO_LAST: bool>(from: &[impl sealed::Readable]) -> u8x64 {
    will_load(from.as_ptr().cast(), size_of_val(from).min(64));
    let (mask, address) = lanes_for::<_, TO_LAST>(from);
    let v;
    // SAFETY: reads the bytes of `from` that the mask has a bit for, and touches no others.
    unsafe {
        asm!(
            "vmovdqu8 {v} {{{k}}} {{z}}, [{p}]",
            v = out(zmm_reg) v,
            k = in(kreg) mask,
            p = in(reg) address,
            options(readonly, nostack, preserves_flags),
        )
    };
    v
}

/// As many of the first or the last lanes as fit.
#[cfg(target_arch = "x86_64")]
#[inline]
#[target_feature(enable = "avx512bw")]
pub fn store64_masked<const FROM_LAST: bool>(v: u8x64, to: &[SharedOutU8]) {
    will_store(to.as_ptr().cast(), to.len().min(64));
    let (mask, address) = lanes_for::<_, FROM_LAST>(to);
    // SAFETY: writes the bytes of `to` that the mask has a bit for, and touches no others.
    unsafe {
        asm!(
            "vmovdqu8 [{p}] {{{k}}}, {v}",
            v = in(zmm_reg) v,
            k = in(kreg) mask,
            p = in(reg) address,
            options(nostack, preserves_flags),
        )
    }
}

/// Pads with zeros if `from` is too short.
#[cfg(target_arch = "aarch64")]
#[inline]
#[target_feature(enable = "sve")]
pub fn load16_masked(from: &[SharedU8]) -> u8x16 {
    will_load(from.as_ptr().cast(), from.len().min(16));
    let v;
    // SAFETY: reads the first `len` bytes of `from`, and touches no others.
    unsafe {
        asm!(
            "whilelo p0.b, xzr, {len}",
            "ld1b {{z0.b}}, p0/z, [{p}]",
            len = in(reg) from.len().min(16),
            p = in(reg) from.as_ptr(),
            out("v0") v,
            out("p0") _,
            options(readonly, nostack),
        )
    };
    v
}

/// Stores as many bytes as fit.
#[cfg(target_arch = "aarch64")]
#[inline]
#[target_feature(enable = "sve")]
pub fn store16_masked(v: u8x16, to: &[SharedOutU8]) {
    will_store(to.as_ptr().cast(), to.len().min(16));
    // SAFETY: writes the first `len` bytes of `to`, and touches no others.
    unsafe {
        asm!(
            "whilelo p0.b, xzr, {len}",
            "st1b {{z0.b}}, p0, [{p}]",
            len = in(reg) to.len().min(16),
            p = in(reg) to.as_ptr(),
            in("v0") v,
            out("p0") _,
            options(nostack),
        )
    }
}
