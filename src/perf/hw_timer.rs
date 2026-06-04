//! Unbarriered hardware timestamp counter.
//!
//! Reads the CPU's timestamp counter directly with no instruction barrier, so
//! the read may be reordered relative to surrounding instructions by an OoO
//! core. This trades a tiny amount of fidelity for speed: on Apple Silicon this
//! is ~0.4 ns/call vs ~1.4 ns for `mach_approximate_time` and ~8.7 ns for
//! `mach_absolute_time`, with ~24 ns resolution instead of ~12 µs. On Windows
//! it replaces `GetTickCount64`'s ~15.6 ms granularity.
//!
//! `now_ns()` is calibrated once against the OS monotonic clock so its values
//! share an epoch with `bun.getRoughTickCount()`. For pure A→B deltas where the
//! epoch doesn't matter, `read_counter()` is the cheapest possible read.
//!
//! On x64 Linux/Windows where the TSC frequency isn't exposed by CPUID 0x15,
//! `now_ns()` reads the OS high-res clock per call (vDSO/QPC, ~20 ns) instead —
//! still sub-µs resolution.
//!
//! See WebKit r312153 (UnbarrieredMonotonicTime) for the original design and
//! drift/monotonicity measurements on Darwin/arm64.

/// Raw counter read. No barriers.
/// - aarch64: `CNTVCT_EL0` (fixed-frequency virtual counter)
/// - x86_64:  `rdtsc`
#[inline(always)]
pub fn read_counter() -> u64 {
    #[cfg(target_arch = "aarch64")]
    {
        let ret: u64;
        // SAFETY: reading CNTVCT_EL0 is side-effect-free and always valid at EL0.
        unsafe {
            core::arch::asm!(
                "mrs {ret}, CNTVCT_EL0",
                ret = out(reg) ret,
                options(nomem, nostack, preserves_flags),
            );
        }
        return ret;
    }
    #[cfg(target_arch = "x86_64")]
    {
        let hi: u32;
        let lo: u32;
        // SAFETY: rdtsc is side-effect-free and always valid in userspace on x86_64.
        unsafe {
            core::arch::asm!(
                "rdtsc",
                out("eax") lo,
                out("edx") hi,
                options(nomem, nostack, preserves_flags),
            );
        }
        return ((hi as u64) << 32) | (lo as u64);
    }
    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    compile_error!("hw_timer::read_counter: unsupported architecture");
}

// ported from: src/perf/hw_timer.zig
