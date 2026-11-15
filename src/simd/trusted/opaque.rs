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
    }
    _ => {
        pub use core::convert::identity as opaque16;

        #[inline(always)]
        pub fn opaque(word: u64) -> u64 {
            word
        }
    }
}
