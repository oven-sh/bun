//! `bun.perf` — system-profiler tracing (Instruments os_signpost on macOS,
//! ftrace on Linux). **This crate is the canonical entry point** for
//! `PerfEvent`-keyed spans. A T0 subset lives at `bun_core::perf` for low-tier
//! callers that cannot reach this crate; that subset is Linux-only (ftrace
//! needs no high-tier deps) and reports disabled on macOS, so callers above T0
//! should use `bun_perf::trace` to keep os_signpost coverage.
#![warn(unreachable_pub)]
#[allow(unused_imports)]
use core::ffi::{c_char, c_int};
#[allow(unused_imports)]
use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::Once;

pub mod generated_perf_trace_events;
pub mod hw_timer;
pub mod system_timer;
pub mod tracy;

pub use crate::generated_perf_trace_events::PerfEvent;

#[cfg(target_os = "macos")]
pub type EnabledImpl = Darwin;
#[cfg(target_os = "linux")]
pub type EnabledImpl = Linux;
#[cfg(not(any(target_os = "macos", target_os = "linux")))]
pub type EnabledImpl = Disabled;

pub enum Ctx {
    Disabled(Disabled),
    Enabled(EnabledImpl),
}

#[derive(Default)]
pub struct Disabled;

impl Disabled {
    #[inline]
    pub fn end(&self) {}
}

impl Ctx {
    pub fn end(&self) {
        match self {
            Ctx::Disabled(ctx) => ctx.end(),
            Ctx::Enabled(ctx) => ctx.end(),
        }
    }
}

// Zig callsites pair `bun.perf.trace(...)` with `defer tracer.end()`. Per
// PORTING.md `defer <side effect>` → RAII: `Ctx` ends itself on drop so callers
// write `let _tracer = bun_perf::trace(...)` and forget about it.
impl Drop for Ctx {
    #[inline]
    fn drop(&mut self) {
        self.end();
    }
}

static IS_ENABLED_ONCE: Once = Once::new();
static IS_ENABLED: AtomicBool = AtomicBool::new(false);

#[allow(dead_code)]
fn is_enabled_on_mac_os_once() {
    if bun_core::env_var::DYLD_ROOT_PATH.platform_get().is_some()
        || bun_core::env_var::feature_flag::BUN_INSTRUMENTS
            .get()
            .unwrap_or(false)
    {
        IS_ENABLED.store(true, Ordering::SeqCst);
    }
}

#[allow(dead_code)]
fn is_enabled_on_linux_once() {
    if bun_core::env_var::feature_flag::BUN_TRACE
        .get()
        .unwrap_or(false)
    {
        IS_ENABLED.store(true, Ordering::SeqCst);
    }
}

fn is_enabled_once() {
    #[cfg(target_os = "macos")]
    {
        is_enabled_on_mac_os_once();
        if Darwin::get().is_none() {
            IS_ENABLED.store(false, Ordering::SeqCst);
        }
    }
    #[cfg(target_os = "linux")]
    {
        is_enabled_on_linux_once();
        if !Linux::is_supported() {
            IS_ENABLED.store(false, Ordering::SeqCst);
        }
    }
}

pub fn is_enabled() -> bool {
    IS_ENABLED_ONCE.call_once(is_enabled_once);
    IS_ENABLED.load(Ordering::SeqCst)
}

/// Trace an event using the system profiler (Instruments).
///
/// When instruments is not connected, this is a no-op.
///
/// When adding a new event, you must run `scripts/generate-perf-trace-events.sh` to update the list of trace events.
///
/// Tip: Make sure you write bun.perf.trace() with a string literal exactly instead of passing a variable.
///
/// It has to be compile-time known this way because they need to become string literals in C.
// PORT NOTE: Zig took `comptime name: [:0]const u8` and used `@hasField(PerfEvent, name)` +
// `@compileError` to validate membership at compile time, then `@field(PerfEvent, name)` to get
// the enum value. In Rust, taking `PerfEvent` directly gives the same compile-time guarantee via
// the type system — the @hasField/@compileError block is dropped.
pub fn trace(event: PerfEvent) -> Ctx {
    if !is_enabled() {
        // PERF(port): @branchHint(.likely) — profile in Phase B
        return Ctx::Disabled(Disabled);
    }

    #[cfg(target_os = "macos")]
    {
        // PERF(port): was comptime monomorphization (event id was comptime i32) — profile in Phase B
        return Ctx::Enabled(Darwin::init(event as i32));
    }
    #[cfg(target_os = "linux")]
    {
        return Ctx::Enabled(Linux::init(event));
    }
    #[allow(unreachable_code)]
    #[cfg(not(any(target_os = "macos", target_os = "linux")))]
    {
        let _ = event;
        return Ctx::Disabled(Disabled);
    }
}

#[cfg(target_os = "macos")]
pub use darwin_impl::Darwin;

#[cfg(target_os = "macos")]
mod darwin_impl {
    use super::*;
    use bun_sys::darwin::OSLog;
    // TODO(port): verify Rust path for `OSLog.Signpost.Interval` and `.PointsOfInterest` category
    use bun_sys::darwin::os_log::signpost::{
        Category as SignpostCategory, Interval as SignpostInterval,
    };

    pub struct Darwin {
        interval: SignpostInterval,
    }

    impl Darwin {
        // PERF(port): was `comptime name: i32` — profile in Phase B
        pub fn init(name: i32) -> Self {
            Self {
                // SAFETY: `is_enabled()` returned true, which implies `Darwin::get()` is Some
                // (see `is_enabled_once`). Zig used `os_log.?` (unchecked unwrap).
                interval: Self::get()
                    .expect("unreachable")
                    .signpost(name)
                    .interval(SignpostCategory::PointsOfInterest),
            }
        }

        pub fn end(&self) {
            self.interval.end();
        }

        fn get_once() {
            // TODO(port): verify `OSLog::init()` signature; Zig returns `?*OSLog`
            if let Some(log) = OSLog::init() {
                OS_LOG.store(log.as_ptr(), Ordering::Release);
            }
        }

        pub fn get() -> Option<&'static OSLog> {
            OS_LOG_ONCE.call_once(Self::get_once);
            let ptr = OS_LOG.load(Ordering::Acquire);
            if ptr.is_null() {
                None
            } else {
                // SAFETY: written exactly once under OS_LOG_ONCE; OSLog lives for program lifetime
                Some(unsafe { &*ptr })
            }
        }
    }

    static OS_LOG: AtomicPtr<OSLog> = AtomicPtr::new(core::ptr::null_mut());
    static OS_LOG_ONCE: Once = Once::new();
}

#[cfg(target_os = "linux")]
pub struct Linux {
    start_time: u64,
    event: PerfEvent,
}

#[cfg(target_os = "linux")]
impl Linux {
    pub fn is_supported() -> bool {
        INIT_ONCE.call_once(Self::init_once);
        IS_INITIALIZED.load(Ordering::Relaxed)
    }

    fn init_once() {
        let result = Bun__linux_trace_init();
        IS_INITIALIZED.store(result != 0, Ordering::Relaxed);
    }

    pub fn init(event: PerfEvent) -> Self {
        Self {
            start_time: bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns(),
            event,
        }
    }

    pub fn end(&self) {
        if !Self::is_supported() {
            return;
        }

        let duration = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
            .ns()
            .saturating_sub(self.start_time);

        // Zig's `@tagName(this.event).ptr` yields `[*:0]const u8` (NUL-terminated).
        // `PerfEvent::as_cstr()` provides the equivalent `&'static CStr` so the C side's
        // `snprintf("C|%d|%s|%lld", ...)` reads a properly terminated string.
        // SAFETY: FFI call; pointer is 'static and NUL-terminated.
        let _ = unsafe {
            Bun__linux_trace_emit(
                self.event.as_cstr().as_ptr(),
                i64::try_from(duration).expect("int cast"),
            )
        };
    }
}

#[cfg(target_os = "linux")]
static IS_INITIALIZED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "linux")]
static INIT_ONCE: Once = Once::new();

#[cfg(target_os = "linux")]
use bun_core::perf::sys::{Bun__linux_trace_emit, Bun__linux_trace_init};

// ported from: src/perf/perf.zig
