//! Unbarriered hardware timestamp counter.
//!
//! Reads the CPU's timestamp counter directly with no instruction barrier, so
//! the read may be reordered relative to surrounding instructions by an OoO
//! core. This trades a tiny amount of fidelity for speed: on Apple Silicon this
//! is ~0.4 ns/call vs ~1.4 ns for `mach_approximate_time` and ~8.7 ns for
//! `mach_absolute_time`, with ~24 ns resolution instead of ~12 µs. On Windows
//! it replaces `GetTickCount64`'s ~15.6 ms granularity.
//!
//! The calibrated clock is anchored once against the OS monotonic clock so its
//! values share an epoch with `bun.getRoughTickCount()`. For pure A→B deltas
//! where the epoch doesn't matter, `read_counter()` is the cheapest possible
//! read.
//!
//! On x64 Linux/Windows the TSC frequency comes from CPUID: leaf 0x15 on bare
//! metal, or the hypervisor timing leaf 0x4000_0010 inside a guest (leaf 0x15
//! describes the host part's crystal there, not the rate the guest's `rdtsc`
//! actually ticks at). When neither source is trustworthy, the calibrated
//! clock reads the OS high-res clock per call (vDSO/QPC, ~20 ns) instead —
//! still sub-µs resolution.
//!
//! See WebKit r312153 (UnbarrieredMonotonicTime) for the original design and
//! drift/monotonicity measurements on Darwin/arm64.

#[cfg(all(
    target_arch = "x86_64",
    any(target_os = "macos", target_os = "freebsd")
))]
use core::ffi::{c_char, c_int, c_void};

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

/// Counter frequency in Hz, or 0 if it can't be learned without spinning.
/// All paths that return non-zero already imply invariant/constant-rate TSC.
fn read_frequency() -> u64 {
    #[cfg(target_arch = "aarch64")]
    {
        // Architectural register; always populated.
        let ret: u64;
        // SAFETY: reading CNTFRQ_EL0 is side-effect-free and always valid at EL0.
        unsafe {
            core::arch::asm!(
                "mrs {ret}, CNTFRQ_EL0",
                ret = out(reg) ret,
                options(nomem, nostack, preserves_flags),
            );
        }
        return ret;
    }

    #[cfg(target_arch = "x86_64")]
    {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            // Kernel's own boot-time TSC calibration. Only present (and only
            // meaningful) when the kernel has decided TSC is usable.
            const NAME: &core::ffi::CStr = if cfg!(target_os = "macos") {
                c"machdep.tsc.frequency"
            } else {
                c"machdep.tsc_freq"
            };
            let mut hz: u64 = 0;
            let mut hz_len: usize = core::mem::size_of::<u64>();
            // SAFETY: NAME is NUL-terminated; oldp/oldlenp point to valid stack locals.
            unsafe {
                let _ = sysctlbyname(
                    NAME.as_ptr(),
                    core::ptr::from_mut::<u64>(&mut hz).cast::<c_void>(),
                    &raw mut hz_len,
                    core::ptr::null(),
                    0,
                );
            }
            return hz;
        }

        #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
        {
            // Linux/Windows: require invariant TSC (CPUID 0x8000_0007 EDX[8]) so
            // rdtsc is monotonic across cores and P/C-states, whichever source
            // the frequency comes from below.
            if cpuid(0x8000_0000, 0).eax < 0x8000_0007 || cpuid(0x8000_0007, 0).edx & (1 << 8) == 0
            {
                return 0;
            }

            let hypervisor = cpuid(1, 0).ecx & (1 << 31) != 0;
            let (hv_max_leaf, hv_tsc_khz) = if hypervisor {
                let max_leaf = cpuid(0x4000_0000, 0).eax;
                let khz = if max_leaf >= HYPERVISOR_TIMING_LEAF {
                    cpuid(HYPERVISOR_TIMING_LEAF, 0).eax
                } else {
                    0
                };
                (max_leaf, khz)
            } else {
                (0, 0)
            };

            let leaf_15 = if cpuid(0, 0).eax >= 0x15 {
                cpuid(0x15, 0)
            } else {
                CpuidResult {
                    eax: 0,
                    ebx: 0,
                    ecx: 0,
                    edx: 0,
                }
            };

            return resolve_x64_tsc_frequency(X64TscCpuidInfo {
                hypervisor,
                hv_max_leaf,
                hv_tsc_khz,
                leaf_15_eax: leaf_15.eax,
                leaf_15_ebx: leaf_15.ebx,
                leaf_15_ecx: leaf_15.ecx,
            });
        }
    }

    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    compile_error!("hw_timer::read_frequency: unsupported target");
}

/// Hypervisor "timing information" leaf (VMware interface, also implemented by
/// KVM when it wants guests to know the TSC rate): EAX is the guest's TSC
/// frequency in kHz, already accounting for TSC scaling.
const HYPERVISOR_TIMING_LEAF: u32 = 0x4000_0010;

/// Reject hypervisor-advertised TSC rates outside [100 MHz, 10 GHz]; real
/// parts sit well inside this range, so anything else is a broken leaf.
const MIN_PLAUSIBLE_TSC_HZ: u64 = 100_000_000;
const MAX_PLAUSIBLE_TSC_HZ: u64 = 10_000_000_000;

/// Raw CPUID values that decide the x64 TSC frequency. Gathered from the live
/// CPU by `read_frequency()`; built with synthetic values by the
/// `bun:internal-for-testing` binding so the decision logic can be exercised
/// off the exact hardware that exhibits a mis-calibration.
#[derive(Clone, Copy)]
pub struct X64TscCpuidInfo {
    /// CPUID.1:ECX[31] — running under a hypervisor.
    pub hypervisor: bool,
    /// CPUID.0x4000_0000:EAX — highest hypervisor leaf (0 when not read).
    pub hv_max_leaf: u32,
    /// CPUID.0x4000_0010:EAX — guest TSC frequency in kHz (0 when not read).
    pub hv_tsc_khz: u32,
    /// CPUID.0x15:EAX — denominator of the TSC/crystal ratio (0 when absent).
    pub leaf_15_eax: u32,
    /// CPUID.0x15:EBX — numerator of the TSC/crystal ratio (0 when absent).
    pub leaf_15_ebx: u32,
    /// CPUID.0x15:ECX — crystal clock frequency in Hz (0 when absent).
    pub leaf_15_ecx: u32,
}

/// Decide the TSC frequency (Hz) from raw CPUID values, or 0 when no
/// trustworthy source exists and the calibrated clock must stay on the OS
/// clock.
///
/// Unlike the Zig reference, leaf 0x15 is never trusted under a hypervisor.
/// Inside a guest the TSC the OS hands out may be scaled/emulated, so leaf
/// 0x15 (host crystal info leaked through the VMM) need not match the rate
/// `rdtsc` actually ticks at — on some GCP/KVM hosts it is off by ~2.8×, which
/// skews every deadline derived from a clock calibrated with it. The only
/// CPUID source trusted under a hypervisor is the timing leaf the hypervisor
/// itself publishes; otherwise we fall back to the OS clock, which the guest
/// kernel already calibrates correctly.
pub fn resolve_x64_tsc_frequency(info: X64TscCpuidInfo) -> u64 {
    if info.hypervisor {
        if info.hv_max_leaf >= HYPERVISOR_TIMING_LEAF {
            let hz = u64::from(info.hv_tsc_khz) * 1000;
            if (MIN_PLAUSIBLE_TSC_HZ..=MAX_PLAUSIBLE_TSC_HZ).contains(&hz) {
                return hz;
            }
        }
        return 0;
    }
    // Bare metal: CPUID 0x15 is the architectural crystal-clock ratio (exact on
    // Intel Skylake+ when fully populated). AMD and older Intel leave the
    // fields zero — fall back to vDSO/QPC per call.
    if info.leaf_15_eax != 0 && info.leaf_15_ebx != 0 && info.leaf_15_ecx != 0 {
        return u64::from(info.leaf_15_ecx) * u64::from(info.leaf_15_ebx)
            / u64::from(info.leaf_15_eax);
    }
    0
}

/// Point-in-time view of the values the TSC calibration works from, for
/// `bun:internal-for-testing`.
pub struct CalibrationSnapshot {
    /// What `read_frequency()` reports on this machine (0 ⇒ OS-clock fallback).
    pub frequency_hz: u64,
    /// `read_counter()` sampled immediately before `os_ns`.
    pub counter: u64,
    /// OS monotonic clock in nanoseconds.
    pub os_ns: u64,
}

/// Snapshot the counter against the OS monotonic clock plus the frequency the
/// HW path would calibrate with, so tests can verify the two agree.
pub fn calibration_snapshot() -> CalibrationSnapshot {
    let frequency_hz = read_frequency();
    let counter = read_counter();
    let os_ns = os_monotonic_ns();
    CalibrationSnapshot {
        frequency_hz,
        counter,
        os_ns,
    }
}

#[cfg(all(
    target_arch = "x86_64",
    not(any(target_os = "macos", target_os = "freebsd"))
))]
struct CpuidResult {
    eax: u32,
    ebx: u32,
    ecx: u32,
    edx: u32,
}

#[cfg(all(
    target_arch = "x86_64",
    not(any(target_os = "macos", target_os = "freebsd"))
))]
#[inline]
fn cpuid(leaf: u32, subleaf: u32) -> CpuidResult {
    // Rust inline asm reserves `rbx` (LLVM PIC base), so use the std intrinsic,
    // which handles the xchg dance internally instead of raw asm.
    // (`__cpuid_count` is a safe fn on x86_64 — cpuid is baseline.)
    let r = core::arch::x86_64::__cpuid_count(leaf, subleaf);
    CpuidResult {
        eax: r.eax,
        ebx: r.ebx,
        ecx: r.ecx,
        edx: r.edx,
    }
}

/// OS high-res monotonic clock. Used as the anchor the counter is measured
/// against in `calibration_snapshot()`.
fn os_monotonic_ns() -> u64 {
    #[cfg(windows)]
    {
        // QPF is a constant read from KUSER_SHARED_DATA; no need to cache.
        let mut counter: i64 = 0;
        let mut freq: i64 = 0;
        // QPC/QPF are declared `safe` in bun_sys (the out-param is a valid
        // `&mut` and they never fail on XP+), so no `unsafe` block is needed.
        bun_sys::windows::QueryPerformanceCounter(&mut counter);
        bun_sys::windows::QueryPerformanceFrequency(&mut freq);
        return u64::try_from((counter as u128) * (NS_PER_S as u128) / (freq as u128)).unwrap();
    }
    #[cfg(not(windows))]
    {
        let mut spec = libc::timespec {
            tv_sec: 0,
            tv_nsec: 0,
        };
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // CLOCK_MONOTONIC, not _RAW: guaranteed vDSO (no syscall). _RAW only
            // joined the vDSO in 5.3.
            // SAFETY: spec is a valid out-pointer.
            unsafe {
                let _ = libc::clock_gettime(libc::CLOCK_MONOTONIC, &raw mut spec);
            }
        }
        #[cfg(target_os = "macos")]
        {
            // SAFETY: spec is a valid out-pointer.
            unsafe {
                let _ = libc::clock_gettime(libc::CLOCK_MONOTONIC_RAW, &raw mut spec);
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos")))]
        {
            // SAFETY: spec is a valid out-pointer.
            unsafe {
                let _ = libc::clock_gettime(libc::CLOCK_MONOTONIC, &raw mut spec);
            }
        }
        (spec.tv_sec as u64)
            .wrapping_mul(NS_PER_S)
            .wrapping_add(spec.tv_nsec as u64)
    }
}

use bun_core::time::NS_PER_S;

#[cfg(all(
    target_arch = "x86_64",
    any(target_os = "macos", target_os = "freebsd")
))]
unsafe extern "C" {
    fn sysctlbyname(
        name: *const c_char,
        oldp: *mut c_void,
        oldlenp: *mut usize,
        newp: *const c_void,
        newlen: usize,
    ) -> c_int;
}
