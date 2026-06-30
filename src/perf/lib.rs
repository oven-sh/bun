//! `bun.perf` — system-profiler tracing. This crate owns the macOS signpost
//! arm (Instruments os_signpost, keyed by `PerfEvent`); on Linux/Android it
//! delegates to `bun_core::perf`, which is the single ftrace backend.
#[cfg(target_os = "macos")]
use core::sync::atomic::{AtomicBool, Ordering};
#[cfg(target_os = "macos")]
use std::sync::Once;

pub mod hw_timer;
pub mod system_timer;
pub mod tracy;

pub use bun_core::PerfEvent;

pub enum Ctx {
    Disabled(Disabled),
    #[cfg(target_os = "macos")]
    Enabled(Darwin),
    #[cfg(any(target_os = "linux", target_os = "android"))]
    Core(bun_core::perf::Ctx),
}

#[derive(Default)]
pub struct Disabled;

impl Disabled {
    #[inline]
    pub(crate) fn end(&self) {}
}

impl Ctx {
    pub fn end(&mut self) {
        match self {
            Ctx::Disabled(ctx) => ctx.end(),
            #[cfg(target_os = "macos")]
            Ctx::Enabled(ctx) => ctx.end(),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            Ctx::Core(ctx) => ctx.end(),
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

#[cfg(target_os = "macos")]
static IS_ENABLED_ONCE: Once = Once::new();
#[cfg(target_os = "macos")]
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

#[cfg(target_os = "macos")]
fn is_enabled_once() {
    is_enabled_on_mac_os_once();
    if Darwin::get().is_none() {
        IS_ENABLED.store(false, Ordering::SeqCst);
    }
}

#[cfg(target_os = "macos")]
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
///
/// Linux/Android delegate to `bun_core::perf::trace_event` (the single ftrace
/// backend); the gate is identical (`BUN_TRACE` + ftrace availability), and
/// `bun_core`'s 96-byte name truncation never fires because every
/// `PerfEvent` name is shorter than 96 bytes.
pub fn trace(event: PerfEvent) -> Ctx {
    #[cfg(target_os = "macos")]
    {
        if !is_enabled() {
            return Ctx::Disabled(Disabled);
        }
        return Ctx::Enabled(Darwin::init(event as i32));
    }
    #[cfg(any(target_os = "linux", target_os = "android"))]
    {
        return Ctx::Core(bun_core::perf::trace_event(event));
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
    use bun_sys::darwin::{Category as SignpostCategory, Interval as SignpostInterval};
    use core::sync::atomic::AtomicPtr;

    pub struct Darwin {
        interval: SignpostInterval<'static>,
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
