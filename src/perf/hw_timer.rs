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

use core::ffi::{c_char, c_int, c_void};

/// True on every target Bun ships. Kept for callers that want to gate on it.
pub const IS_SUPPORTED: bool = cfg!(target_arch = "aarch64") || cfg!(target_arch = "x86_64");

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

/// Monotonic nanoseconds, calibrated to the same epoch as `bun.getRoughTickCount()`.
/// Falls back to the OS high-res clock if the HW counter frequency couldn't be
/// resolved without measuring it. Never recurses into `getRoughTickCount`.
#[inline(always)]
pub fn now_ns() -> u64 {
    #[cfg(any(target_arch = "aarch64", target_arch = "x86_64"))]
    {
        CALIBRATE_ONCE.call_once(calibrate);
        // SAFETY: CALIBRATION is only mutated inside `CALIBRATE_ONCE.call_once(calibrate)`;
        // `Once` establishes happens-before, so this read observes the fully-initialized value.
        let cal = unsafe { *core::ptr::addr_of!(CALIBRATION) };
        if cal.mult != 0 {
            let ticks = read_counter().wrapping_sub(cal.start_counter);
            // u64×u64→u128 widening mul + shift: 2 insns on x64 (`mul`+`shrd`),
            // 3 on arm64 (`mul`+`umulh`+`extr`). The `as u128` widen guarantees LLVM
            // sees a widening mul, not a generic 128×128 `__multi3`.
            let ns: u64 = ((ticks as u128) * (cal.mult as u128) >> SHIFT) as u64;
            return cal.start_ns.wrapping_add(ns);
        }
    }
    os_monotonic_ns()
}

/// `now_ns()` in milliseconds. The constant divide lowers to a reciprocal
/// multiply, so this is `now_ns()` + 2 instructions, not a `div`.
#[inline(always)]
pub fn now_ms() -> u64 {
    now_ns() / NS_PER_MS
}

const SHIFT: u32 = 32;

#[derive(Clone, Copy)]
struct Calibration {
    start_counter: u64,
    start_ns: u64,
    /// elapsed_ns = (ticks * mult) >> 32. Zero ⇒ HW path disabled.
    mult: u64,
}

impl Default for Calibration {
    fn default() -> Self {
        Self { start_counter: 0, start_ns: 0, mult: 0 }
    }
}

static mut CALIBRATION: Calibration = Calibration { start_counter: 0, start_ns: 0, mult: 0 };
static CALIBRATE_ONCE: std::sync::Once = std::sync::Once::new();

fn calibrate() {
    let freq = read_frequency();
    if freq == 0 {
        return;
    }
    let start_ns = os_monotonic_ns();
    // SAFETY: only ever invoked via `CALIBRATE_ONCE.call_once`, which guarantees
    // exclusive access during this write and happens-before for subsequent readers.
    unsafe {
        *core::ptr::addr_of_mut!(CALIBRATION) = Calibration {
            start_counter: read_counter(),
            start_ns,
            mult: u64::try_from(
                (((NS_PER_S as u128) << SHIFT) + (freq / 2) as u128) / (freq as u128),
            )
            .unwrap(),
        };
    }
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
                    (&mut hz) as *mut u64 as *mut c_void,
                    &mut hz_len,
                    core::ptr::null(),
                    0,
                );
            }
            return hz;
        }

        #[cfg(not(any(target_os = "macos", target_os = "freebsd")))]
        {
            // Linux/Windows: require invariant TSC (CPUID 0x8000_0007 EDX[8]) so
            // rdtsc is monotonic across cores and P/C-states, then read CPUID 0x15
            // for an exact frequency (Intel Skylake+ when fully populated). AMD and
            // older Intel leave 0x15 fields zero — we fall back to vDSO/QPC per call.
            if cpuid(0x8000_0000, 0).eax >= 0x8000_0007
                && cpuid(0x8000_0007, 0).edx & (1 << 8) != 0
                && cpuid(0, 0).eax >= 0x15
            {
                let r = cpuid(0x15, 0);
                if r.eax != 0 && r.ebx != 0 && r.ecx != 0 {
                    return (r.ecx as u64) * (r.ebx as u64) / (r.eax as u64);
                }
            }
            return 0;
        }
    }

    #[cfg(not(any(target_arch = "aarch64", target_arch = "x86_64")))]
    compile_error!("hw_timer::read_frequency: unsupported target");
}

#[cfg(target_arch = "x86_64")]
struct CpuidResult {
    eax: u32,
    ebx: u32,
    ecx: u32,
    edx: u32,
}

#[cfg(target_arch = "x86_64")]
#[inline]
fn cpuid(leaf: u32, subleaf: u32) -> CpuidResult {
    // PORT NOTE: Rust inline asm reserves `rbx` (LLVM PIC base), so we use the
    // std intrinsic which handles the xchg dance internally instead of raw asm.
    // SAFETY: cpuid is always available on x86_64.
    let r = unsafe { core::arch::x86_64::__cpuid_count(leaf, subleaf) };
    CpuidResult { eax: r.eax, ebx: r.ebx, ecx: r.ecx, edx: r.edx }
}

/// OS high-res monotonic clock. Used once as the calibration anchor, and as the
/// per-call path when `mult == 0`.
fn os_monotonic_ns() -> u64 {
    #[cfg(windows)]
    {
        // QPF is a constant read from KUSER_SHARED_DATA; no need to cache.
        let counter = bun_sys::windows::QueryPerformanceCounter();
        let freq = bun_sys::windows::QueryPerformanceFrequency();
        return u64::try_from((counter as u128) * (NS_PER_S as u128) / (freq as u128)).unwrap();
    }
    #[cfg(not(windows))]
    {
        // TODO(port): verify bun_core::Timespec is #[repr(C)] layout-compatible with libc timespec
        let mut spec = bun_core::Timespec { sec: 0, nsec: 0 };
        #[cfg(target_os = "linux")]
        {
            // CLOCK_MONOTONIC, not _RAW: guaranteed vDSO (no syscall). _RAW only
            // joined the vDSO in 5.3.
            // SAFETY: spec is a valid out-pointer; layout matches struct timespec.
            unsafe {
                let _ = clock_gettime(bun_sys::CLOCK_MONOTONIC, (&mut spec) as *mut _ as *mut c_void);
            }
        }
        #[cfg(target_os = "macos")]
        {
            // SAFETY: spec is a valid out-pointer; layout matches struct timespec.
            unsafe {
                let _ = clock_gettime(bun_sys::CLOCK_MONOTONIC_RAW, (&mut spec) as *mut _ as *mut c_void);
            }
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos")))]
        {
            // SAFETY: spec is a valid out-pointer; layout matches struct timespec.
            unsafe {
                let _ = clock_gettime(bun_sys::CLOCK_MONOTONIC, (&mut spec) as *mut _ as *mut c_void);
            }
        }
        spec.ns()
    }
}

const NS_PER_MS: u64 = 1_000_000;
const NS_PER_S: u64 = 1_000_000_000;

// TODO(port): move to perf_sys / bun_sys
#[cfg(all(target_arch = "x86_64", any(target_os = "macos", target_os = "freebsd")))]
unsafe extern "C" {
    fn sysctlbyname(
        name: *const c_char,
        oldp: *mut c_void,
        oldlenp: *mut usize,
        newp: *const c_void,
        newlen: usize,
    ) -> c_int;
}

// TODO(port): move to perf_sys / bun_sys
#[cfg(unix)]
unsafe extern "C" {
    fn clock_gettime(clk_id: c_int, tp: *mut c_void) -> c_int;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/perf/hw_timer.zig (171 lines)
//   confidence: medium
//   todos:      3
//   notes:      static mut CALIBRATION guarded by Once; bun_sys::CLOCK_* / bun_core::Timespec / windows QPC wrappers assumed; cpuid uses core intrinsic (rbx reserved in Rust asm)
// ──────────────────────────────────────────────────────────────────────────
