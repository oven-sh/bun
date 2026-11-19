//! The same value, of which LLVM knows nothing. Unlike with `black_box`, it stays in its register.
cfg_select! {
    all(any(target_arch = "x86_64", target_arch = "aarch64"), not(miri)) => {
        use core::arch::asm;
        use core::simd::u8x16;

        #[inline(always)]
        pub fn opaque(mut word: u64) -> u64 {
            // SAFETY: there is no instruction.
            unsafe {
                asm!("/* {0} */", inout(reg) word, options(pure, nomem, nostack, preserves_flags))
            };
            word
        }

        #[inline(always)]
        pub fn opaque16(mut v: u8x16) -> u8x16 {
            // SAFETY: there is no instruction.
            unsafe {
                #[cfg(target_arch = "x86_64")]
                asm!("/* {0} */", inout(xmm_reg) v, options(pure, nomem, nostack, preserves_flags));
                #[cfg(target_arch = "aarch64")]
                asm!("/* {0:q} */", inout(vreg) v, options(pure, nomem, nostack, preserves_flags));
            }
            v
        }

        #[cfg(target_arch = "x86_64")]
        #[inline]
        #[target_feature(enable = "avx")]
        pub fn opaque32(mut v: core::simd::u8x32) -> core::simd::u8x32 {
            // SAFETY: there is no instruction.
            unsafe {
                asm!("/* {0} */", inout(ymm_reg) v, options(pure, nomem, nostack, preserves_flags))
            };
            v
        }

        #[cfg(target_arch = "x86_64")]
        #[inline]
        #[target_feature(enable = "avx512f")]
        pub fn opaque64(mut v: core::simd::u8x64) -> core::simd::u8x64 {
            // SAFETY: there is no instruction.
            unsafe {
                asm!("/* {0} */", inout(zmm_reg) v, options(pure, nomem, nostack, preserves_flags))
            };
            v
        }

        /// Counts as a use of all lanes.
        #[inline(always)]
        pub fn keep16(v: u8x16) {
            // SAFETY: there is no instruction.
            unsafe {
                #[cfg(target_arch = "x86_64")]
                asm!("/* {0} */", in(xmm_reg) v, options(nomem, nostack, preserves_flags));
                #[cfg(target_arch = "aarch64")]
                asm!("/* {0:q} */", in(vreg) v, options(nomem, nostack, preserves_flags));
            }
        }
    }
    _ => {
        pub use core::convert::identity as opaque16;
        #[cfg(target_arch = "x86_64")]
        pub use core::convert::{identity as opaque32, identity as opaque64};

        #[inline(always)]
        pub fn opaque(word: u64) -> u64 {
            word
        }

        #[inline(always)]
        pub fn keep16(_: core::simd::u8x16) {}
    }
}
