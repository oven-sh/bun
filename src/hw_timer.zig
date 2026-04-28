//! Unbarriered hardware timestamp counter.
//!
//! Reads the CPU's timestamp counter directly with no instruction barrier, so
//! the read may be reordered relative to surrounding instructions by an OoO
//! core. This trades a tiny amount of fidelity for speed: on Apple Silicon this
//! is ~0.4 ns/call vs ~1.4 ns for `mach_approximate_time` and ~8.7 ns for
//! `mach_absolute_time`, with ~24 ns resolution instead of ~12 µs. On Windows
//! it replaces `GetTickCount64`'s ~15.6 ms granularity.
//!
//! `nowNs()` is calibrated once against the OS monotonic clock so its values
//! share an epoch with `bun.getRoughTickCount()`. For pure A→B deltas where the
//! epoch doesn't matter, `readCounter()` is the cheapest possible read.
//!
//! Calibration is **never** a busy-spin: it's one register read (arm64), one
//! sysctl (x64 Darwin/FreeBSD), or a couple of CPUID leaves (x64 Linux/Win).
//! If frequency can't be resolved that cheaply, `nowNs()` falls back to the
//! OS high-res clock per call (vDSO/QPC, ~20 ns) — still sub-µs resolution.
//!
//! See WebKit r312153 (UnbarrieredMonotonicTime) for the original design and
//! drift/monotonicity measurements on Darwin/arm64.

/// True on every target Bun ships. Kept for callers that want to gate on it.
pub const is_supported = Environment.isAarch64 or Environment.isX64;

/// Raw counter read. No barriers.
/// - aarch64: `CNTVCT_EL0` (fixed-frequency virtual counter)
/// - x86_64:  `rdtsc`
pub inline fn readCounter() u64 {
    if (comptime Environment.isAarch64) {
        return asm volatile ("mrs %[ret], CNTVCT_EL0"
            : [ret] "=r" (-> u64),
            :
            : .{ .memory = true });
    }
    if (comptime Environment.isX64) {
        var hi: u32 = undefined;
        var lo: u32 = undefined;
        asm volatile ("rdtsc"
            : [lo] "={eax}" (lo),
              [hi] "={edx}" (hi),
        );
        return (@as(u64, hi) << 32) | lo;
    }
    @compileError("hw_timer.readCounter: unsupported architecture");
}

/// Monotonic nanoseconds, calibrated to the same epoch as `bun.getRoughTickCount()`.
/// Falls back to the OS high-res clock if the HW counter frequency couldn't be
/// resolved without measuring it. Never recurses into `getRoughTickCount`.
pub inline fn nowNs() u64 {
    if (comptime is_supported) {
        calibrate_once.call();
        if (calibration.mult != 0) {
            const ticks = readCounter() -% calibration.start_counter;
            // u64×u64→u128 widening mul + shift: 2 insns on x64 (`mul`+`shrd`),
            // 3 on arm64 (`mul`+`umulh`+`extr`). `mulWide` guarantees LLVM sees
            // a widening mul, not a generic 128×128 `__multi3`.
            const ns: u64 = @truncate(std.math.mulWide(u64, ticks, calibration.mult) >> shift);
            return calibration.start_ns +% ns;
        }
    }
    return osMonotonicNs();
}

const shift = 32;
const Calibration = struct {
    start_counter: u64 = 0,
    start_ns: u64 = 0,
    /// elapsed_ns = (ticks * mult) >> 32. Zero ⇒ HW path disabled.
    mult: u64 = 0,
};
var calibration: Calibration = .{};
var calibrate_once = std.once(calibrate);

fn calibrate() void {
    const freq = readFrequency();
    if (freq == 0) return;
    const start_ns = osMonotonicNs();
    calibration = .{
        .start_counter = readCounter(),
        .start_ns = start_ns,
        .mult = @intCast(((@as(u128, std.time.ns_per_s) << shift) + (freq / 2)) / freq),
    };
}

/// Counter frequency in Hz, or 0 if it can't be learned without spinning.
/// All paths that return non-zero already imply invariant/constant-rate TSC.
fn readFrequency() u64 {
    if (comptime Environment.isAarch64) {
        // Architectural register; always populated.
        return asm volatile ("mrs %[ret], CNTFRQ_EL0"
            : [ret] "=r" (-> u64),
            :
            : .{ .memory = true });
    }

    if (comptime Environment.isX64) {
        if (comptime Environment.isMac or Environment.isFreeBSD) {
            // Kernel's own boot-time TSC calibration. Only present (and only
            // meaningful) when the kernel has decided TSC is usable.
            const name = if (comptime Environment.isMac) "machdep.tsc.frequency" else "machdep.tsc_freq";
            var hz: u64 = 0;
            var hz_len: usize = @sizeOf(u64);
            _ = std.c.sysctlbyname(name, &hz, &hz_len, null, 0);
            return hz;
        }

        // Linux/Windows: CPUID 0x15 gives an exact answer on Intel Skylake+
        // when fully populated (implies invariant TSC). AMD and older Intel
        // leave fields zero — we just fall back to vDSO/QPC per call.
        if (cpuid(0, 0).eax >= 0x15) {
            const r = cpuid(0x15, 0);
            if (r.eax != 0 and r.ebx != 0 and r.ecx != 0)
                return @as(u64, r.ecx) * r.ebx / r.eax;
        }
        return 0;
    }

    @compileError("hw_timer.readFrequency: unsupported target");
}

inline fn cpuid(leaf: u32, subleaf: u32) struct { eax: u32, ebx: u32, ecx: u32, edx: u32 } {
    if (comptime !Environment.isX64) @compileError("cpuid is x86-only");
    var eax: u32 = undefined;
    var ebx: u32 = undefined;
    var ecx: u32 = undefined;
    var edx: u32 = undefined;
    asm volatile ("cpuid"
        : [eax] "={eax}" (eax),
          [ebx] "={ebx}" (ebx),
          [ecx] "={ecx}" (ecx),
          [edx] "={edx}" (edx),
        : [leaf] "{eax}" (leaf),
          [subleaf] "{ecx}" (subleaf),
    );
    return .{ .eax = eax, .ebx = ebx, .ecx = ecx, .edx = edx };
}

/// OS high-res monotonic clock. Used once as the calibration anchor, and as the
/// per-call path when `mult == 0`.
fn osMonotonicNs() u64 {
    if (comptime Environment.isWindows) {
        // QPF is a constant read from KUSER_SHARED_DATA; no need to cache.
        const counter = std.os.windows.QueryPerformanceCounter();
        const freq = std.os.windows.QueryPerformanceFrequency();
        return @intCast(std.math.mulWide(u64, counter, std.time.ns_per_s) / freq);
    }
    var spec = bun.timespec{ .sec = 0, .nsec = 0 };
    if (comptime Environment.isLinux) {
        // CLOCK_MONOTONIC, not _RAW: guaranteed vDSO (no syscall). _RAW only
        // joined the vDSO in 5.3.
        _ = std.os.linux.clock_gettime(.MONOTONIC, @ptrCast(&spec));
    } else if (comptime Environment.isMac) {
        _ = std.c.clock_gettime(.MONOTONIC_RAW, @ptrCast(&spec));
    } else {
        _ = std.c.clock_gettime(.MONOTONIC, @ptrCast(&spec));
    }
    return spec.ns();
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
