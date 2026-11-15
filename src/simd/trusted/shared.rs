//! Memory that other threads may write to meanwhile.
//!
//! SAFETY: each function stands for a relaxed access to each of its bytes, which is what Miri gets
//! to see. The language has no wider access that is allowed to race. To the CPUs it is an ordinary
//! one, which tears no byte.
use core::sync::atomic::AtomicU8;
#[allow(unused_imports)] // `either!` takes one side
use core::{arch::asm, simd::ToBytes, sync::atomic::Ordering::Relaxed};

macro_rules! either {
    ($bytes:block $instruction:block) => {
        cfg_select! {
            all(
                any(target_arch = "x86_64", target_arch = "aarch64"),
                target_pointer_width = "64",
                target_endian = "little",
                not(miri),
            ) => $instruction,
            _ => $bytes,
        }
    };
}

macro_rules! access {
    ($(
        $(#[$attr:meta])* $T:ty, $class:ident:
        $load:ident $load_asm:literal, $store:ident $store_asm:literal;
    )*) => {$(
        /// `from[I]`, with the offset in the instruction.
        $(#[$attr])*
        #[inline]
        pub fn $load<const K: usize, const I: usize>(
            from: &[[AtomicU8; size_of::<$T>()]; K],
        ) -> $T {
            const { assert!(I < K) };
            either!({
                <$T>::from_ne_bytes(from[I].each_ref().map(|byte| byte.load(Relaxed)).into())
            } {
                let v;
                // SAFETY: reads the bytes of `from[I]`, with an instruction of the features that
                // the function has.
                unsafe {
                    asm!(
                        $load_asm,
                        v = out($class) v,
                        p = in(reg) from,
                        at = const I * size_of::<$T>(),
                        options(readonly, nostack, preserves_flags),
                    )
                };
                v
            })
        }

        $(#[$attr])*
        #[inline]
        pub fn $store<const K: usize, const I: usize>(
            v: $T,
            to: &[[AtomicU8; size_of::<$T>()]; K],
        ) {
            const { assert!(I < K) };
            either!({
                let bytes = <[u8; size_of::<$T>()]>::from(v.to_ne_bytes());
                to[I].iter().zip(bytes).for_each(|(to, byte)| to.store(byte, Relaxed))
            } {
                // SAFETY: writes the bytes of `to[I]`, with an instruction of the features that
                // the function has.
                unsafe {
                    asm!(
                        $store_asm,
                        v = in($class) v,
                        p = in(reg) to,
                        at = const I * size_of::<$T>(),
                        options(nostack, preserves_flags),
                    )
                }
            })
        }
    )*};
}

cfg_select! {
    target_arch = "x86_64" => {
        use core::simd::{u8x16, u8x32, u8x64};

        access! {
            u32, reg: load4 "mov {v:e}, [{p} + {at}]", store4 "mov [{p} + {at}], {v:e}";
            u64, reg: load8 "mov {v}, [{p} + {at}]", store8 "mov [{p} + {at}], {v}";
            #[target_feature(enable = "sse2")]
            u8x16, xmm_reg:
                load16 "movdqu {v}, [{p} + {at}]", store16 "movdqu [{p} + {at}], {v}";
            #[target_feature(enable = "avx")]
            u8x16, xmm_reg:
                load16_vex "vmovdqu {v}, [{p} + {at}]", store16_vex "vmovdqu [{p} + {at}], {v}";
            #[target_feature(enable = "avx")]
            u8x32, ymm_reg:
                load32 "vmovdqu {v}, [{p} + {at}]", store32 "vmovdqu [{p} + {at}], {v}";
            #[target_feature(enable = "avx512f")]
            u8x64, zmm_reg:
                load64 "vmovdqu64 {v}, [{p} + {at}]", store64 "vmovdqu64 [{p} + {at}], {v}";
        }

        #[cfg(not(miri))]
        #[inline(always)]
        fn first_bits(len: usize) -> u64 {
            if len < 64 { (1 << len) - 1 } else { u64::MAX }
        }

        /// The first bytes, and zeros if there are too few.
        #[target_feature(enable = "avx512bw")]
        #[inline]
        pub fn load_fitting(from: &[AtomicU8]) -> u8x64 {
            either!({
                let mut v = [0; 64];
                from.iter().zip(&mut v).for_each(|(from, to)| *to = from.load(Relaxed));
                v.into()
            } {
                let v;
                // SAFETY: reads the bytes of `from` that the mask has a bit for, and touches no
                // others.
                unsafe {
                    asm!(
                        "vmovdqu8 {v} {{{k}}} {{z}}, [{p}]",
                        v = out(zmm_reg) v,
                        k = in(kreg) first_bits(from.len()),
                        p = in(reg) from.as_ptr(),
                        options(readonly, nostack, preserves_flags),
                    )
                };
                v
            })
        }

        /// As many bytes as there is room for.
        #[target_feature(enable = "avx512bw")]
        #[inline]
        pub fn store_fitting(v: u8x64, to: &[AtomicU8]) {
            either!({
                to.iter().zip(v.to_array()).for_each(|(to, byte)| to.store(byte, Relaxed))
            } {
                // SAFETY: writes the bytes of `to` that the mask has a bit for, and touches no
                // others.
                unsafe {
                    asm!(
                        "vmovdqu8 [{p}] {{{k}}}, {v}",
                        v = in(zmm_reg) v,
                        k = in(kreg) first_bits(to.len()),
                        p = in(reg) to.as_ptr(),
                        options(nostack, preserves_flags),
                    )
                }
            })
        }
    }
    target_arch = "aarch64" => {
        use core::simd::u8x16;

        access! {
            u32, reg: load4 "ldr {v:w}, [{p}, #{at}]", store4 "str {v:w}, [{p}, #{at}]";
            u64, reg: load8 "ldr {v:x}, [{p}, #{at}]", store8 "str {v:x}, [{p}, #{at}]";
            #[target_feature(enable = "neon")]
            u8x16, vreg: load16 "ldr {v:q}, [{p}, #{at}]", store16 "str {v:q}, [{p}, #{at}]";
        }
    }
    _ => {
        access! {
            u32, reg: load4 "", store4 "";
            u64, reg: load8 "", store8 "";
        }
    }
}
