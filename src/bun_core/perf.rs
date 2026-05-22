// ── perf ──────────────────────────────────────────────────────────────────
// Port of `bun.perf` (src/perf/perf.zig). The Linux ftrace backend is
// libc-only, so it folds in directly and `bun_core::perf::trace("X")` is real
// instrumentation on Linux. macOS: the Zig backend wraps `Bun__signpost_emit`
// (c-bindings.cpp) which keys on the codegen `PerfEvent` int — that table
// lives in `bun_perf` (T2, owns generated_perf_trace_events), so T0 reports
// disabled on macOS. **No functional divergence today**: `bun_perf`'s Darwin
// arm currently routes through the `bun_sys::darwin::os_log::signpost::Interval`
// stub whose `end()` is a no-op, so neither tier emits signposts yet. When
// `Bun__signpost_emit` is wired, callers above T0 use `bun_perf::trace`; T0
// callsites (audited r5) are bundler/parser hot paths where Linux ftrace is
// the profiling target. Windows/other platforms are no-ops in Zig too.
#[cfg(any(target_os = "linux", target_os = "android"))]
use core::sync::atomic::AtomicBool;
use core::sync::atomic::{AtomicU8, Ordering};
#[cfg(any(target_os = "linux", target_os = "android"))]
use std::sync::Once;

/// Per-span state returned by `trace()`. `end()` is idempotent; `Drop`
/// calls it so `let _t = trace("x");` works as a scope guard.
#[must_use = "bind to a local (`let _t = perf::trace(..)`) so the span has nonzero duration"]
pub struct Ctx {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    linux: Option<Linux>,
}
impl Ctx {
    pub const DISABLED: Ctx = Ctx {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        linux: None,
    };
    #[inline]
    pub fn end(&mut self) {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        if let Some(l) = self.linux.take() {
            l.end();
        }
    }
}
impl Drop for Ctx {
    #[inline]
    fn drop(&mut self) {
        self.end();
    }
}

// Tri-state so the disabled fast path is a single Relaxed load (this sits
// on every `trace()` call across the bundler/parser hot paths). The flag
// is write-once-at-init so Relaxed is sufficient; a benign init race just
// re-runs the env probe.
const UNSET: u8 = 0;
const DISABLED: u8 = 1;
const ENABLED: u8 = 2;
static IS_ENABLED: AtomicU8 = AtomicU8::new(UNSET);

#[cold]
fn is_enabled_init() -> bool {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let on = crate::env_var::feature_flag::BUN_TRACE
        .get()
        .unwrap_or(false)
        && Linux::is_supported();
    // macOS: os_signpost requires `bun_sys::darwin::OSLog` (above T0).
    // **`bun_perf` is the canonical entry point** (it drives both the
    // ftrace and signpost backends via `PerfEvent`); `bun_core::perf` is
    // the T0 subset for low-tier callers that cannot reach `bun_perf` and
    // only need Linux ftrace. T0 therefore reports disabled on macOS.
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    let on = false;
    IS_ENABLED.store(if on { ENABLED } else { DISABLED }, Ordering::Relaxed);
    on
}

#[inline]
pub fn is_enabled() -> bool {
    match IS_ENABLED.load(Ordering::Relaxed) {
        DISABLED => false,
        ENABLED => true,
        _ => is_enabled_init(),
    }
}

/// `bun.perf.trace("Event.name")`. Emits an ftrace span on Linux when
/// `BUN_TRACE=1`; no-op elsewhere (macOS signposts live in `bun_perf`).
#[inline]
pub fn trace(name: &'static str) -> Ctx {
    if !is_enabled() {
        let _ = name;
        return Ctx::DISABLED;
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        return Ctx {
            linux: Some(Linux::init(name)),
        };
    }
    #[cfg(not(any(target_os = "linux", target_os = "android")))]
    {
        let _ = name;
        Ctx::DISABLED
    }
}

// ── Linux ftrace backend (folded from src/perf/lib.rs) ────────────────
#[cfg(any(target_os = "linux", target_os = "android"))]
struct Linux {
    start_time: u64,
    name: &'static str,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Linux {
    fn is_supported() -> bool {
        static INIT_ONCE: Once = Once::new();
        static IS_INITIALIZED: AtomicBool = AtomicBool::new(false);
        INIT_ONCE.call_once(|| {
            let r = sys::Bun__linux_trace_init();
            IS_INITIALIZED.store(r != 0, Ordering::Relaxed);
        });
        IS_INITIALIZED.load(Ordering::Relaxed)
    }
    #[inline]
    fn init(name: &'static str) -> Self {
        Self {
            start_time: crate::Timespec::now(crate::TimespecMockMode::ForceRealTime).ns(),
            name,
        }
    }
    fn end(self) {
        if !Self::is_supported() {
            return;
        }
        let duration = crate::Timespec::now(crate::TimespecMockMode::ForceRealTime)
            .ns()
            .saturating_sub(self.start_time);
        // Zig passed `@tagName(event).ptr` (NUL-terminated). Build a small
        // stack CString from the &'static str literal.
        let mut buf = [0u8; 96];
        let n = self.name.len().min(buf.len() - 1);
        buf[..n].copy_from_slice(&self.name.as_bytes()[..n]);
        // SAFETY: FFI; pointer is NUL-terminated within `buf`.
        let _ = unsafe {
            sys::Bun__linux_trace_emit(
                buf.as_ptr().cast::<core::ffi::c_char>(),
                i64::try_from(duration).unwrap_or(i64::MAX),
            )
        };
    }
}

/// Single source of truth for the Linux ftrace FFI decls (defined in
/// `src/jsc/bindings/linux_perf_tracing.cpp`). Re-exported so `bun_perf`
/// (the canonical signpost/ftrace entry point) imports these instead of
/// re-declaring them — see src/perf/perf.zig:127-129 for the spec.
#[cfg(any(target_os = "linux", target_os = "android"))]
pub mod sys {
    unsafe extern "C" {
        /// No preconditions; returns 0/1 based on tracefs availability.
        pub safe fn Bun__linux_trace_init() -> core::ffi::c_int;
        /// No preconditions.
        pub safe fn Bun__linux_trace_close();
        pub fn Bun__linux_trace_emit(
            event_name: *const core::ffi::c_char,
            duration_ns: i64,
        ) -> core::ffi::c_int;
    }
}
