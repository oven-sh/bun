//! `bun.perf` — system-profiler tracing (Instruments os_signpost on macOS,
//! ftrace on Linux). **This crate is the canonical entry point** for
//! `PerfEvent`-keyed spans. A T0 subset lives at `bun_core::perf` for low-tier
//! callers that cannot reach this crate; that subset is Linux-only (ftrace
//! needs no high-tier deps) and reports disabled on macOS, so callers above T0
//! should use `bun_perf::trace` to keep os_signpost coverage.
use core::sync::atomic::{AtomicBool, Ordering};
use std::sync::Once;

pub mod generated_perf_trace_events;
pub mod system_timer;
pub mod tracy;

pub use crate::generated_perf_trace_events::PerfEvent;

#[cfg(target_os = "macos")]
pub(crate) type EnabledImpl = Darwin;
#[cfg(any(target_os = "linux", target_os = "android"))]
pub(crate) type EnabledImpl = Linux;
#[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
pub(crate) type EnabledImpl = Disabled;

pub enum Ctx {
    Disabled(Disabled),
    Enabled(EnabledImpl),
}

#[derive(Default)]
pub struct Disabled;

impl Disabled {
    #[inline]
    pub(crate) fn end(&self) {}
}

impl Ctx {
    pub fn end(&self) {
        match self {
            Ctx::Disabled(ctx) => ctx.end(),
            Ctx::Enabled(ctx) => ctx.end(),
        }
    }
}

// `Ctx` ends itself on drop so callers
// write `let _tracer = bun_perf::trace(...)` and forget about it.
impl Drop for Ctx {
    #[inline]
    fn drop(&mut self) {
        self.end();
    }
}

static IS_ENABLED_ONCE: Once = Once::new();
static IS_ENABLED: AtomicBool = AtomicBool::new(false);

#[cfg(target_os = "macos")]
fn is_enabled_on_mac_os_once() {
    if bun_core::env_var::DYLD_ROOT_PATH.platform_get().is_some()
        || bun_core::env_var::feature_flag::BUN_INSTRUMENTS
            .get()
            .unwrap_or(false)
    {
        IS_ENABLED.store(true, Ordering::SeqCst);
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
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
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        is_enabled_on_linux_once();
        if !Linux::is_supported() {
            IS_ENABLED.store(false, Ordering::SeqCst);
        }
    }
}

pub(crate) fn is_enabled() -> bool {
    IS_ENABLED_ONCE.call_once(is_enabled_once);
    IS_ENABLED.load(Ordering::SeqCst)
}

/// Trace an event using the system profiler (Instruments).
///
/// When instruments is not connected, this is a no-op.
///
/// Pass a `PerfEvent` variant; the type system guarantees the event is a
/// compile-time-known member of the generated set. Event names must become
/// string literals in C, so when adding a new event you must run
/// `scripts/generate-perf-trace-events.sh` to regenerate the list.
pub fn trace(event: PerfEvent) -> Ctx {
    if !is_enabled() {
        return Ctx::Disabled(Disabled);
    }

    #[cfg(target_os = "macos")]
    {
        return Ctx::Enabled(Darwin::init(event as i32));
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        return Ctx::Enabled(Linux::init(event));
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "android")))]
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
    use bun_sys::darwin::os_log::signpost::{
        Category as SignpostCategory, Interval as SignpostInterval,
    };
    use core::sync::atomic::AtomicPtr;

    pub struct Darwin {
        interval: SignpostInterval,
    }

    impl Darwin {
        pub fn init(name: i32) -> Self {
            Self {
                // SAFETY: `is_enabled()` returned true, which implies `Darwin::get()` is Some
                // (see `is_enabled_once`).
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

#[cfg(any(target_os = "linux", target_os = "android"))]
pub struct Linux {
    start_time: u64,
    event: PerfEvent,
}

#[cfg(any(target_os = "linux", target_os = "android"))]
impl Linux {
    pub(crate) fn is_supported() -> bool {
        INIT_ONCE.call_once(Self::init_once);
        IS_INITIALIZED.load(Ordering::Relaxed)
    }

    fn init_once() {
        let result = Bun__linux_trace_init();
        IS_INITIALIZED.store(result != 0, Ordering::Relaxed);
    }

    pub(crate) fn init(event: PerfEvent) -> Self {
        Self {
            start_time: bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime).ns(),
            event,
        }
    }

    pub(crate) fn end(&self) {
        if !Self::is_supported() {
            return;
        }

        let duration = bun_core::Timespec::now(bun_core::TimespecMockMode::ForceRealTime)
            .ns()
            .saturating_sub(self.start_time);

        // `PerfEvent::as_cstr()` provides a `&'static CStr` so the C side's
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

#[cfg(any(target_os = "linux", target_os = "android"))]
static IS_INITIALIZED: AtomicBool = AtomicBool::new(false);
#[cfg(any(target_os = "linux", target_os = "android"))]
static INIT_ONCE: Once = Once::new();

#[cfg(any(target_os = "linux", target_os = "android"))]
use bun_core::perf::sys::{Bun__linux_trace_emit, Bun__linux_trace_init};
