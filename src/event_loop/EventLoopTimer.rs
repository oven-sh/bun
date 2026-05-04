use core::ffi::c_void;
use core::mem::offset_of;
use core::ptr::NonNull;

use bun_core::Timespec as timespec; // TODO(port): confirm crate for `bun.timespec`
use bun_io::heap::IntrusiveField;
use bun_jsc::VirtualMachine;
use bun_uws as uws;

use bun_runtime::api::dns::Resolver as DNSResolver;
use bun_runtime::api::timer::{
    DateHeaderTimer, EventLoopDelayMonitor, ImmediateObject, TimeoutObject, TimerObjectInternals,
    WTFTimer,
};
use bun_runtime::node::node_fs_stat_watcher::StatWatcherScheduler;

// TODO(port): these live under src/runtime/ — confirm exact module paths in Phase B
use bun_bake::DevServer;
use bun_runtime::api::cron::CronJob;
use bun_runtime::api::mysql::MySQLConnection;
use bun_runtime::api::postgres::PostgresSQLConnection;
use bun_runtime::api::subprocess::Subprocess;
use bun_runtime::api::valkey::Valkey;
use bun_runtime::jest::bun_test::{BunTest, BunTestPtr};
use bun_runtime::webcore::abort_signal::Timeout as AbortSignalTimeout;

const NS_PER_MS: i64 = 1_000_000;

/// Recover `&Parent` from a pointer to its `field` of type `EventLoopTimer`.
/// Mirrors Zig `@fieldParentPtr("field", self)`.
macro_rules! container_of {
    ($ptr:expr, $Parent:ty, $field:ident) => {{
        // SAFETY: $ptr points to the `$field` field of a live `$Parent`; tag guarantees layout.
        unsafe {
            &mut *(($ptr as *const _ as *mut u8)
                .sub(core::mem::offset_of!($Parent, $field))
                .cast::<$Parent>())
        }
    }};
}
macro_rules! container_of_const {
    ($ptr:expr, $Parent:ty, $field:ident) => {{
        // SAFETY: $ptr points to the `$field` field of a live `$Parent`; tag guarantees layout.
        unsafe {
            &*(($ptr as *const _ as *const u8)
                .sub(core::mem::offset_of!($Parent, $field))
                .cast::<$Parent>())
        }
    }};
}

pub struct EventLoopTimer {
    /// The absolute time to fire this timer next.
    pub next: timespec,
    pub state: State,
    pub tag: Tag,
    /// Internal heap fields.
    pub heap: IntrusiveField<EventLoopTimer>,
    pub in_heap: InHeap,
}

#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub enum InHeap {
    #[default]
    None,
    Regular,
    Fake,
}

impl EventLoopTimer {
    pub fn init_paused(tag: Tag) -> Self {
        Self {
            next: timespec::EPOCH,
            state: State::PENDING,
            tag,
            heap: IntrusiveField::default(),
            in_heap: InHeap::None,
        }
    }

    pub fn less(_: (), a: &Self, b: &Self) -> bool {
        let sec_order = a.next.sec.cmp(&b.next.sec);
        if sec_order != core::cmp::Ordering::Equal {
            return sec_order == core::cmp::Ordering::Less;
        }

        // collapse sub-millisecond precision for JavaScript timers
        let maybe_a_flags = a.js_timer_internals_flags();
        let maybe_b_flags = b.js_timer_internals_flags();
        let mut a_ns = a.next.nsec;
        let mut b_ns = b.next.nsec;
        if maybe_a_flags.is_some() {
            a_ns = NS_PER_MS * (a_ns / NS_PER_MS);
        }
        if maybe_b_flags.is_some() {
            b_ns = NS_PER_MS * (b_ns / NS_PER_MS);
        }

        let order = a_ns.cmp(&b_ns);
        if order == core::cmp::Ordering::Equal {
            if let Some(a_flags) = maybe_a_flags {
                if let Some(b_flags) = maybe_b_flags {
                    // We expect that the epoch will overflow sometimes.
                    // If it does, we would ideally like timers with an epoch from before the
                    // overflow to be sorted *before* timers with an epoch from after the overflow
                    // (even though their epoch will be numerically *larger*).
                    //
                    // Wrapping subtraction gives us a distance that is consistent even if one
                    // epoch has overflowed and the other hasn't. If the distance from a to b is
                    // small, it's likely that b is really newer than a, so we consider a less than
                    // b. If the distance from a to b is large (greater than half the u25 range),
                    // it's more likely that b is older than a so the true distance is from b to a.
                    //
                    // Zig epoch is `u25` so `-%` wraps mod 2^25. Rust stores it in a wider int,
                    // so we mask the wrapping_sub result to 25 bits to preserve that semantics.
                    // TODO(port): confirm Rust `epoch` field is masked to 25 bits on write too.
                    const U25_MAX: u32 = (1 << 25) - 1;
                    return (b_flags.epoch.wrapping_sub(a_flags.epoch) & U25_MAX) < U25_MAX / 2;
                }
            }
        }
        order == core::cmp::Ordering::Less
    }

    /// If self was created by set{Immediate,Timeout,Interval}, get a pointer to the common data
    /// for all those kinds of timers
    // PORT NOTE: Zig used `anytype` to overload `*Self`/`*const Self`. Rust splits into
    // `js_timer_internals_flags` (const) and `js_timer_internals_flags_mut`.
    pub fn js_timer_internals_flags(&self) -> Option<&TimerObjectInternals::Flags> {
        match self.tag {
            Tag::TimeoutObject => {
                let parent = container_of_const!(self, TimeoutObject, event_loop_timer);
                Some(&parent.internals.flags)
            }
            Tag::ImmediateObject => {
                let parent = container_of_const!(self, ImmediateObject, event_loop_timer);
                Some(&parent.internals.flags)
            }
            Tag::AbortSignalTimeout => {
                let parent = container_of_const!(self, AbortSignalTimeout, event_loop_timer);
                Some(&parent.flags)
            }
            _ => None,
        }
    }

    pub fn js_timer_internals_flags_mut(&mut self) -> Option<&mut TimerObjectInternals::Flags> {
        match self.tag {
            Tag::TimeoutObject => {
                let parent = container_of!(self, TimeoutObject, event_loop_timer);
                Some(&mut parent.internals.flags)
            }
            Tag::ImmediateObject => {
                let parent = container_of!(self, ImmediateObject, event_loop_timer);
                Some(&mut parent.internals.flags)
            }
            Tag::AbortSignalTimeout => {
                let parent = container_of!(self, AbortSignalTimeout, event_loop_timer);
                Some(&mut parent.flags)
            }
            _ => None,
        }
    }

    fn ns(&self) -> u64 {
        self.next.ns()
    }

    pub fn fire(&mut self, now: &timespec, vm: &mut VirtualMachine) {
        match self.tag {
            Tag::PostgresSQLConnectionTimeout => {
                container_of!(self, PostgresSQLConnection, timer).on_connection_timeout()
            }
            Tag::PostgresSQLConnectionMaxLifetime => {
                container_of!(self, PostgresSQLConnection, max_lifetime_timer)
                    .on_max_lifetime_timeout()
            }
            Tag::MySQLConnectionTimeout => {
                container_of!(self, MySQLConnection, timer).on_connection_timeout()
            }
            Tag::MySQLConnectionMaxLifetime => {
                container_of!(self, MySQLConnection, max_lifetime_timer).on_max_lifetime_timeout()
            }
            Tag::ValkeyConnectionTimeout => {
                container_of!(self, Valkey, timer).on_connection_timeout()
            }
            Tag::ValkeyConnectionReconnect => {
                container_of!(self, Valkey, reconnect_timer).on_reconnect_timer()
            }
            Tag::DevServerMemoryVisualizerTick => {
                DevServer::emit_memory_visualizer_message_timer(self, now)
            }
            Tag::DevServerSweepSourceMaps => {
                bun_bake::dev_server::SourceMapStore::sweep_weak_refs(self, now)
            }
            Tag::AbortSignalTimeout => {
                let timeout = container_of!(self, AbortSignalTimeout, event_loop_timer);
                timeout.run(vm);
            }
            Tag::DateHeaderTimer => {
                let date_header_timer = container_of!(self, DateHeaderTimer, event_loop_timer);
                date_header_timer.run(vm);
            }
            Tag::BunTest => {
                // SAFETY: tag guarantees `self` is the `timer` field of a `BunTest`.
                let mut container_strong =
                    unsafe { BunTestPtr::clone_from_raw_unsafe(container_of!(self, BunTest, timer)) };
                // `defer container_strong.deinit()` → Drop on BunTestPtr handles this.
                BunTest::bun_test_timeout_callback(&mut container_strong, now, vm);
            }
            Tag::EventLoopDelayMonitor => {
                let monitor = container_of!(self, EventLoopDelayMonitor, event_loop_timer);
                monitor.on_fire(vm, now);
            }
            Tag::CronJob => {
                let job = container_of!(self, CronJob, event_loop_timer);
                job.on_timer_fire(vm);
            }
            // PORT NOTE: Zig `inline else` comptime-expanded these; Rust expands by hand.
            // The Zig `@FieldType(t.Type(), "event_loop_timer") != Self` compile-check has no
            // direct Rust equivalent — Phase B should `const _: () = assert!(...)` per parent type.
            Tag::TimeoutObject => {
                let container = container_of!(self, TimeoutObject, event_loop_timer);
                container.internals.fire(now, vm);
            }
            Tag::ImmediateObject => {
                let container = container_of!(self, ImmediateObject, event_loop_timer);
                container.internals.fire(now, vm);
            }
            Tag::WTFTimer => {
                let container = container_of!(self, WTFTimer, event_loop_timer);
                container.fire(now, vm);
            }
            Tag::StatWatcherScheduler => {
                let container = container_of!(self, StatWatcherScheduler, event_loop_timer);
                container.timer_callback();
            }
            Tag::UpgradedDuplex => {
                let container = container_of!(self, uws::UpgradedDuplex, event_loop_timer);
                container.on_timeout();
            }
            #[cfg(windows)]
            Tag::WindowsNamedPipe => {
                let container = container_of!(self, uws::WindowsNamedPipe, event_loop_timer);
                container.on_timeout();
            }
            #[cfg(not(windows))]
            Tag::WindowsNamedPipe => {
                // UnreachableTimer::callback
                #[cfg(feature = "ci_assert")]
                debug_assert!(false);
            }
            Tag::DNSResolver => {
                let container = container_of!(self, DNSResolver, event_loop_timer);
                container.check_timeouts(now, vm);
            }
            Tag::SubprocessTimeout => {
                let container = container_of!(self, Subprocess, event_loop_timer);
                container.timeout_callback();
            }
            Tag::TimerCallback => {
                let container = container_of!(self, TimerCallback, event_loop_timer);
                (container.callback)(container);
            }
        }
    }
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, strum::IntoStaticStr)]
pub enum Tag {
    TimerCallback,
    TimeoutObject,
    ImmediateObject,
    StatWatcherScheduler,
    UpgradedDuplex,
    DNSResolver,
    WindowsNamedPipe,
    WTFTimer,
    PostgresSQLConnectionTimeout,
    PostgresSQLConnectionMaxLifetime,
    MySQLConnectionTimeout,
    MySQLConnectionMaxLifetime,
    ValkeyConnectionTimeout,
    ValkeyConnectionReconnect,
    SubprocessTimeout,
    DevServerSweepSourceMaps,
    DevServerMemoryVisualizerTick,
    AbortSignalTimeout,
    DateHeaderTimer,
    BunTest,
    EventLoopDelayMonitor,
    CronJob,
}

impl Tag {
    // TODO(port): Zig `pub fn Type(comptime T: Tag) type` returns a type at comptime.
    // Rust has no value→type mapping. All call sites (`jsTimerInternalsFlags`, `fire`)
    // have been manually expanded above. If a generic mapping is needed in Phase B,
    // consider a trait `TagType<const T: Tag> { type Out; }` with per-variant impls.

    pub fn allow_fake_timers(self) -> bool {
        match self {
            Tag::WTFTimer // internal
            | Tag::BunTest // for test timeouts
            | Tag::EventLoopDelayMonitor // probably important
            | Tag::StatWatcherScheduler
            | Tag::CronJob // calendar-anchored to real wall clock
            => false,
            _ => true,
        }
    }
}

// PORT NOTE: `UnreachableTimer` in Zig only existed to give `Tag.Type()` a value for
// `WindowsNamedPipe` on non-Windows. With `fire()` expanded by hand, the non-Windows
// arm handles this inline (see above). Kept here for parity.
struct UnreachableTimer {
    event_loop_timer: EventLoopTimer,
}
impl UnreachableTimer {
    #[allow(dead_code)]
    fn callback(_: &mut UnreachableTimer, _: &mut UnreachableTimer) {
        #[cfg(feature = "ci_assert")]
        debug_assert!(false);
    }
}

pub struct TimerCallback {
    pub callback: fn(*mut TimerCallback),
    // TODO(port): lifetime — opaque user ctx, no init/deinit found in src/event_loop/
    pub ctx: Option<NonNull<c_void>>,
    pub event_loop_timer: EventLoopTimer,
}

#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Default)]
pub enum State {
    /// The timer is waiting to be enabled.
    #[default]
    PENDING,

    /// The timer is active and will fire at the next time.
    ACTIVE,

    /// The timer has been cancelled and will not fire.
    CANCELLED,

    /// The timer has fired and the callback has been called.
    FIRED,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/event_loop/EventLoopTimer.zig (245 lines)
//   confidence: medium
//   todos:      3
//   notes:      `inline else`/`Tag.Type()` comptime dispatch hand-expanded; many cross-crate runtime imports guessed; intrusive @fieldParentPtr kept as raw-ptr container_of! macro.
// ──────────────────────────────────────────────────────────────────────────
