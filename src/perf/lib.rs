#[allow(unused_imports)]
use core::ffi::{c_char, c_int};
#[allow(unused_imports)]
use core::sync::atomic::{AtomicBool, AtomicPtr, Ordering};
use std::sync::Once;

pub mod generated_perf_trace_events;
// TODO(b1): un-gate once these compile
#[cfg(any())]
pub mod hw_timer;
#[cfg(any())]
pub mod system_timer;
#[cfg(any())]
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

static IS_ENABLED_ONCE: Once = Once::new();
static IS_ENABLED: AtomicBool = AtomicBool::new(false);

#[allow(dead_code)]
fn is_enabled_on_mac_os_once() {
    // TODO(port): verify crate path for bun.env_var / bun.feature_flag (assumed bun_core)
    #[cfg(any())]
    {
        // TODO(b1): bun_core::env_var gated out; bun_core::feature_flag::BUN_INSTRUMENTS missing
        if bun_core::env_var::DYLD_ROOT_PATH.get().is_some()
            || bun_core::feature_flag::BUN_INSTRUMENTS.get()
        {
            IS_ENABLED.store(true, Ordering::SeqCst);
        }
    }
    #[cfg(not(any()))]
    {
        todo!("b1: bun_core::env_var / feature_flag stubs")
    }
}

#[allow(dead_code)]
fn is_enabled_on_linux_once() {
    #[cfg(any())]
    {
        // TODO(b1): bun_core::feature_flag::BUN_TRACE missing
        if bun_core::feature_flag::BUN_TRACE.get() {
            IS_ENABLED.store(true, Ordering::SeqCst);
        }
    }
    #[cfg(not(any()))]
    {
        todo!("b1: bun_core::feature_flag::BUN_TRACE")
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
    use bun_sys::darwin::os_log::signpost::{Category as SignpostCategory, Interval as SignpostInterval};

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
        // SAFETY: FFI call; Bun__linux_trace_init has no preconditions
        let result = unsafe { Bun__linux_trace_init() };
        IS_INITIALIZED.store(result != 0, Ordering::Relaxed);
    }

    pub fn init(event: PerfEvent) -> Self {
        #[cfg(any())]
        {
            // TODO(b1): bun_timespec crate missing
            return Self {
                // TODO(port): verify crate path for `bun.timespec` (.now(.force_real_time).ns())
                start_time: bun_timespec::Timespec::now(bun_timespec::Clock::ForceRealTime).ns(),
                event,
            };
        }
        #[cfg(not(any()))]
        {
            let _ = event;
            todo!("b1: bun_timespec")
        }
    }

    pub fn end(&self) {
        if !Self::is_supported() {
            return;
        }

        #[cfg(any())]
        {
        // TODO(b1): bun_timespec crate missing
        let duration = bun_timespec::Timespec::now(bun_timespec::Clock::ForceRealTime)
            .ns()
            .saturating_sub(self.start_time);

        // TODO(port): @tagName in Zig yields a NUL-terminated string; strum::IntoStaticStr does not.
        // PerfEvent needs an `as_cstr() -> &'static CStr` (or the generator must emit NUL-terminated names).
        let name: &'static str = self.event.into();
        // SAFETY: FFI call; name pointer is 'static. See TODO above re: NUL terminator.
        let _ = unsafe {
            Bun__linux_trace_emit(
                name.as_ptr() as *const c_char,
                i64::try_from(duration).unwrap(),
            )
        };
        }
        #[cfg(not(any()))]
        {
            let _ = (&self.start_time, &self.event);
            todo!("b1: bun_timespec")
        }
    }
}

#[cfg(target_os = "linux")]
static IS_INITIALIZED: AtomicBool = AtomicBool::new(false);
#[cfg(target_os = "linux")]
static INIT_ONCE: Once = Once::new();

// TODO(port): move to perf_sys
#[cfg(target_os = "linux")]
unsafe extern "C" {
    fn Bun__linux_trace_init() -> c_int;
    #[allow(dead_code)]
    fn Bun__linux_trace_close();
    fn Bun__linux_trace_emit(event_name: *const c_char, duration_ns: i64) -> c_int;
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/perf/perf.zig (159 lines)
//   confidence: medium
//   todos:      6
//   notes:      trace() now takes PerfEvent (not comptime str); verify bun.timespec/OSLog paths; @tagName NUL-termination needs PerfEvent.as_cstr()
// ──────────────────────────────────────────────────────────────────────────
