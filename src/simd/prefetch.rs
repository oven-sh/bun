//! Hints for the caches.

#![deny(asm_sub_register)]

/// Asks for the cache line of `values[at]`, to read it soon. The index can be out of bounds.
#[doc(alias("Prefetch", "prefetcht0", "prfm"))]
#[inline(always)]
pub fn prefetch<T>(values: &[T], at: usize) {
    prefetch_with(values, at, Prefetch::L1)
}

/// What [`prefetch_with`] asks for.
#[derive(Copy, Clone, Debug, PartialEq, Eq)]
pub enum Prefetch {
    /// The nearest cache, as [`prefetch`] does.
    L1,
    /// The second cache, for what is further ahead. More lines can be on their way to it.
    L2,
    /// The last cache.
    L3,
    /// For what is read once, and should displace nothing.
    Once,
    /// For what will be written. If another core has read the line, the write takes 30 to 93% of the time that it takes after `L1`, on x86.
    /// It does nothing on Intel before Broadwell. To tell, each call on x86 has a load and a branch, unless the build has the feature `prfchw`.
    Write,
}

#[allow(unused_macros)]
macro_rules! hint { ($template:tt, $line:expr) => {{
    let line = $line.addr();
    // Above a pointer of 32 bits the register could hold anything.
    #[cfg(not(target_arch = "x86"))]
    let line = line as u64;
    // SAFETY: all of AArch64 has `prfm`, and `write` asks CPUID for `prefetchw`. They change nothing that a program can see,
    // and fault at no address.
    #[allow(unsafe_code)]
    unsafe {
        core::arch::asm!($template, in(reg) line, options(nomem, nostack, preserves_flags))
    }
}}; }
macro_rules! ask {
    ($line:expr, $x86:ident, $arm:tt) => {
        cfg_select! {
            all(any(target_arch = "x86", target_arch = "x86_64"), target_feature = "sse2") => {
                crate::simd::prefetch::$x86($line as *const i8)
            }
            all(target_arch = "aarch64", not(miri)) => {
                hint!($arm, $line)
            }
            _ => {{
                let _ = $line;
            }}
        }
    };
}

/// [`prefetch`], to another cache or for writing.
///
/// ```
/// # use bun_simd::prelude::*; #[kernel] fn example() {
/// let (mut counts, keys) = (vec![0; 1000], [7, 999, 7, 500]);
/// for (i, &key) in keys.iter().enumerate() {
///     prefetch_with(&counts, keys[(i + 2) % 4], Prefetch::Write);
///     counts[key] += 1;
/// }
/// assert_eq!(counts[7], 2);
/// # } example()
/// ```
#[doc(alias("prefetcht1", "prefetcht2", "prefetchnta", "prefetchw", "prefetch_write", "Locality"))]
#[inline(always)]
pub fn prefetch_with<T>(values: &[T], at: usize, how: Prefetch) {
    ask_for(values.as_ptr().wrapping_add(at).cast(), how)
}
#[inline(always)]
fn ask_for(line: *const u8, how: Prefetch) {
    match how {
        Prefetch::L1 => ask!(line, t0, "prfm pldl1keep, [{}]"),
        Prefetch::L2 => ask!(line, t1, "prfm pldl2keep, [{}]"),
        Prefetch::L3 => ask!(line, t2, "prfm pldl3keep, [{}]"),
        Prefetch::Once => ask!(line, nta, "prfm pldl1strm, [{}]"),
        Prefetch::Write => write(line),
    }
}

/// Without a look at the CPU.
#[inline(always)]
pub(crate) fn to_write(line: *const u8) {
    ask!(line.cast_mut(), et0, "prfm pstl1keep, [{}]")
}

cfg_select! {
    // Without the feature, LLVM asks for the line in order to read it, which can take longer than not to ask.
    all(
        any(target_arch = "x86", target_arch = "x86_64"),
        target_feature = "sse2",
        not(any(miri, target_env = "sgx", target_feature = "prfchw"))
    ) => {
        #[cfg(target_arch = "x86")]
        use core::arch::x86::__cpuid_count;
        #[cfg(target_arch = "x86_64")]
        use core::arch::x86_64::__cpuid_count;
        use core::sync::atomic::{AtomicU8, Ordering::Relaxed};

        static HAS: AtomicU8 = AtomicU8::new(UNKNOWN);
        const UNKNOWN: u8 = 2;

        #[inline(always)]
        fn write(line: *const u8) {
            let has = HAS.load(Relaxed);
            if has != 1 {
                core::hint::cold_path();
                if has == UNKNOWN {
                    let leaf = (0x8000_0001..0x8001_0000).contains(&__cpuid_count(1 << 31, 0).eax);
                    HAS.store((leaf && __cpuid_count(0x8000_0001, 0).ecx >> 8 & 1 != 0) as u8, Relaxed);
                }
                return;
            }
            hint!("prefetchw [{}]", line)
        }
    }
    _ => {
        #[inline(always)]
        fn write(line: *const u8) {
            to_write(line)
        }
    }
}
