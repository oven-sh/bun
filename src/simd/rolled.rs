//! An empty `asm!` block that stays where it is.

#[allow(unused_macros)]
macro_rules! stay { ($text:literal, $($value:ident)?, $($nomem:ident)?) => {
    // SAFETY: there is no instruction, so the value is what it was.
    #[allow(unsafe_code)]
    unsafe {
        core::arch::asm!($text, $(inout(reg) $value,)? options($($nomem,)? nostack, preserves_flags));
    }
}; }

/// In the body of a loop, this keeps the compiler from unrolling and vectorizing it, unless it knows that there are few rounds.
///
/// It has no instruction. It is for loops that are short as a rule, where the rounds before and after an unrolled part cost more than it gains.
///
/// ```
/// # use bun_simd::prelude::*;
/// let mut sum = 0;
/// for x in [1, 2, 3] {
///     not_unrolled();
///     sum += x;
/// }
/// assert_eq!(sum, 6);
/// ```
#[inline(always)]
pub fn not_unrolled() {
    // LLVM counts it as a call.
    #[cfg(all(
        any(
            target_arch = "x86",
            target_arch = "x86_64",
            target_arch = "aarch64",
            target_arch = "arm",
            target_arch = "riscv64",
            target_arch = "loongarch64"
        ),
        not(miri)
    ))]
    stay!("", , nomem);
}

/// The same slice. Unlike `black_box`, it stays in registers.
#[inline(always)]
pub(crate) fn slice(all: &[u8]) -> &[u8] {
    cfg_select! {
        all(any(target_arch = "x86_64", target_arch = "aarch64"), target_pointer_width = "64", not(miri)) => {
            #[allow(unused_mut)]
            let (mut at, mut len) = (all.as_ptr(), all.len());
            #[cfg(not(miri))]
            stay!("/* at {0} */", at,);
            #[cfg(not(miri))]
            stay!("/* len {0} */", len,);
            // SAFETY: these are the parts of `all`.
            #[allow(unsafe_code)]
            unsafe {
                core::slice::from_raw_parts(at, len)
            }
        }
        _ => crate::hints::unseen(all),
    }
}
