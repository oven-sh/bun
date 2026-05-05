use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicPtr, Ordering};

// TODO(b1): bun_core::Timespec missing from lower tier — local stub until B-2.
#[derive(Copy, Clone, Default, Eq, PartialEq)]
pub struct Timespec {
    pub sec: i64,
    pub nsec: i64,
}
impl Timespec {
    pub const EPOCH: Self = Self { sec: 0, nsec: 0 };
    pub fn ns(&self) -> u64 {
        todo!("B-2: Timespec::ns")
    }
}
use Timespec as timespec;

// TODO(b1): bun_io::heap::IntrusiveField missing from lower tier (only
// IntrusiveHeap is exposed) — local stub until B-2.
pub struct IntrusiveField<T>(core::marker::PhantomData<T>);
impl<T> Default for IntrusiveField<T> {
    fn default() -> Self {
        Self(core::marker::PhantomData)
    }
}

const NS_PER_MS: i64 = 1_000_000;

// ─── Hot-dispatch hooks (CYCLEBREAK.md §Hot dispatch list) ──────────────────
// `EventLoopTimer` is per-tick hot. Low tier (this crate) keeps `Tag` + the
// intrusive heap node; the `match tag { … container_of … }` dispatch moves to
// `bun_runtime::dispatch::fire_timer`. Because the heap comparator (`less`)
// and `fire()` are invoked from tier-≤3 code, they call through fn-ptr hooks
// that `bun_runtime::init()` registers at startup.
//
// PERF(port): was inline switch — `JS_TIMER_EPOCH` sits on the heap-compare
// path. Phase B should denormalize `epoch` into `EventLoopTimer` to drop the
// indirect call if profiling shows it matters.

/// `unsafe fn(*mut EventLoopTimer, *const timespec, vm: *mut ())`
/// — runtime owns the tag→variant `match`; `vm` is an erased `*mut VirtualMachine`.
pub static FIRE_TIMER: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

/// `unsafe fn(tag: Tag, *const EventLoopTimer) -> Option<u32>`
/// — returns the JS-timer epoch (TimerObjectInternals.flags.epoch) for
/// TimeoutObject/ImmediateObject/AbortSignalTimeout, else `None`.
pub static JS_TIMER_EPOCH: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());
// ────────────────────────────────────────────────────────────────────────────

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
        let maybe_a_epoch = a.js_timer_epoch();
        let maybe_b_epoch = b.js_timer_epoch();
        let mut a_ns = a.next.nsec;
        let mut b_ns = b.next.nsec;
        if maybe_a_epoch.is_some() {
            a_ns = NS_PER_MS * (a_ns / NS_PER_MS);
        }
        if maybe_b_epoch.is_some() {
            b_ns = NS_PER_MS * (b_ns / NS_PER_MS);
        }

        let order = a_ns.cmp(&b_ns);
        if order == core::cmp::Ordering::Equal {
            if let Some(a_epoch) = maybe_a_epoch {
                if let Some(b_epoch) = maybe_b_epoch {
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
                    return (b_epoch.wrapping_sub(a_epoch) & U25_MAX) < U25_MAX / 2;
                }
            }
        }
        order == core::cmp::Ordering::Less
    }

    /// If self was created by set{Immediate,Timeout,Interval}, return its
    /// JS-timer epoch (used for stable ordering of equal-deadline timers).
    ///
    /// PORT NOTE (b0): Zig `jsTimerInternalsFlags` did `@fieldParentPtr` into
    /// `TimeoutObject`/`ImmediateObject`/`AbortSignalTimeout` (all tier-6
    /// runtime types). The container_of dispatch now lives in
    /// `bun_runtime::dispatch::js_timer_epoch`; this crate calls it through
    /// the `JS_TIMER_EPOCH` hook. Returns `None` if the hook is unset (no JS
    /// runtime — e.g. MiniEventLoop) or for non-JS timer tags.
    #[inline]
    pub fn js_timer_epoch(&self) -> Option<u32> {
        let hook = JS_TIMER_EPOCH.load(Ordering::Relaxed);
        if hook.is_null() {
            return None;
        }
        // SAFETY: hook was registered by `bun_runtime::init()` with the
        // documented signature; `self` is a live timer.
        let f: unsafe fn(Tag, *const EventLoopTimer) -> Option<u32> =
            unsafe { core::mem::transmute(hook) };
        unsafe { f(self.tag, self) }
    }

    fn ns(&self) -> u64 {
        self.next.ns()
    }

    /// Fire the timer's callback.
    ///
    /// PORT NOTE (b0): the `match self.tag { … container_of … }` body was
    /// hot-dispatch over ~20 tier-6 variant types (Subprocess, DevServer,
    /// PostgresSQLConnection, …). Per CYCLEBREAK §Hot-dispatch, that match
    /// moves to `bun_runtime::dispatch::fire_timer`; this crate calls it
    /// through the `FIRE_TIMER` hook. `vm` is the erased `*mut VirtualMachine`.
    pub fn fire(&mut self, now: &timespec, vm: *mut () /* SAFETY: erased *mut VirtualMachine */) {
        let hook = FIRE_TIMER.load(Ordering::Relaxed);
        debug_assert!(!hook.is_null(), "FIRE_TIMER not registered by bun_runtime::init()");
        // SAFETY: hook signature documented on `FIRE_TIMER`; runtime registers it
        // before any timer can be armed.
        let f: unsafe fn(*mut EventLoopTimer, *const timespec, *mut ()) =
            unsafe { core::mem::transmute(hook) };
        unsafe { f(self, now, vm) };
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
