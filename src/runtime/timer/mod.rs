//! Timer subsystem: setTimeout/setInterval/setImmediate scheduling and the
//! event-loop timer heap.

use core::cell::{Cell, UnsafeCell};
use std::rc::Rc;

use bun_alloc::AllocError;
use bun_collections::{ArrayHashMap, VecCell};
use bun_core::{Timespec, TimespecMockMode};
use bun_jsc::virtual_machine::VirtualMachine;
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_threading::Guarded;

// Low-tier timer node + tag (per §Dispatch hot-path list, the `match tag`
// dispatch lives in this crate; `bun_event_loop` only stores `(tag, ptr)`).
pub(crate) use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, InHeap, IntrusiveField, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};
// bun_event_loop carries a local `Timespec` stub instead of
// `bun_core::Timespec`. Same `{sec: i64, nsec: i64}` shape; alias it here so
// `fire()`/`next` accesses type-check without a transmute.
// TODO: remove this alias once the lower tier switches to `bun_core::Timespec`.
pub(crate) use bun_event_loop::EventLoopTimer::Timespec as ElTimespec;

use crate::node::histogram::Interval;

// ─── JS-facing surface (`impl All { set_timeout / clear_* / … }`) ────────────
#[path = "Timer.rs"]
pub(crate) mod timer;

// ─── impl_timer_object! ──────────────────────────────────────────────────────
// Shared scaffold for `TimeoutObject` / `ImmediateObject`: both are a
// `Timer.bind.ts` class over a `TimerObjectInternals`, whose
// JS-facing host-fns are pure forwarders to it. The macro
// emits the parts shared by both types so each `*.rs` file holds only its
// type-specific surface (`init`, `refresh`, the `_idleStart` accessors,
// `run_immediate_task`).
//
// Type-specific items (`init`, `refresh`, `close`, `_idleStart` get/set,
// `run_immediate_task`) go in a *second* `impl $T` block in the caller's file.
//
// Paths in the body are written `super::…` / `::crate_name::…` because the
// macro is invoked *from the child module* (`super::impl_timer_object!(…)`),
// so `super` at the expansion site resolves back here to `timer/mod.rs`.
macro_rules! impl_timer_object {
    ($T:ident) => {
        #[repr(transparent)]
        pub(crate) struct $T {
            pub internals: super::TimerObjectInternals,
        }

        ::bun_event_loop::impl_timer_owner!($T; from_timer_ptr => internals.event_loop_timer);

        // The count is that of `internals`, which frees the allocation: `Self` is transparent.
        impl ::bun_ptr::AnyRefCounted for $T {
            unsafe fn rc_ref(this: *mut Self) {
                // SAFETY: caller contract.
                unsafe { super::TimerObjectInternals::rc_ref(this.cast()) }
            }
            unsafe fn rc_deref(this: *mut Self) {
                // SAFETY: caller contract.
                unsafe { super::TimerObjectInternals::rc_deref(this.cast()) }
            }
            unsafe fn rc_has_one_ref(this: *const Self) -> bool {
                // SAFETY: caller contract.
                unsafe { super::TimerObjectInternals::rc_has_one_ref(this.cast()) }
            }
            unsafe fn rc_assert_valid(this: *const Self) {
                // SAFETY: caller contract.
                unsafe { super::TimerObjectInternals::rc_assert_valid(this.cast()) }
            }
        }

        impl $T {
            /// Shared body of `TimeoutObject::init` / `ImmediateObject::init`:
            /// heap-allocate → `to_js_ptr` → `internals.init` →
            /// inspector `did_schedule_async_call`. The per-type `init` fn
            /// picks `kind`/`interval` and forwards here.
            fn init_with(
                cx: &bun_jsc::JsThread<'_>,
                id: u64,
                kind: super::Kind,
                interval: u32,
                callback: ::bun_jsc::JSValue,
                arguments: ::bun_jsc::JSValue,
            ) -> ::bun_jsc::JSValue {
                // `*mut Self` is the pointer the JS wrapper holds.
                let payload: *mut Self = super::TimerObjectInternals::alloc(
                    super::EventLoopTimerTag::$T,
                    cx,
                    id,
                    kind,
                    interval,
                )
                .cast();
                // SAFETY: `payload` is a fresh heap allocation whose one ref
                // transfers to the GC wrapper.
                let js_value = unsafe { Self::to_js_ptr(payload, cx.global()) };
                let _keep = ::bun_jsc::EnsureStillAlive(js_value);
                // SAFETY: the wrapper, kept alive above, holds a ref.
                unsafe { (*payload).internals.init(js_value, cx, callback, arguments) };
                if cx.vm().is_inspector_enabled() {
                    ::bun_jsc::Debugger::did_schedule_async_call(
                        cx.global(),
                        ::bun_jsc::Debugger::AsyncCallType::DOMTimer,
                        super::ID { id, kind: kind.big() }.async_id(),
                        kind != super::Kind::SetInterval,
                    );
                }
                js_value
            }

            pub(crate) fn to_primitive(this: &Self) -> ::bun_jsc::JsResult<u64> {
                this.internals.to_primitive()
            }

            pub(crate) fn do_ref(
                this: &Self,
                this_value: ::bun_jsc::bindgen::JsWrapper<'_, Self>,
            ) -> ::bun_jsc::JSValue {
                this.internals.do_ref(this_value.to_js())
            }

            pub(crate) fn do_unref(
                this: &Self,
                this_value: ::bun_jsc::bindgen::JsWrapper<'_, Self>,
            ) -> ::bun_jsc::JSValue {
                this.internals.do_unref(this_value.to_js())
            }

            pub(crate) fn has_ref(this: &Self) -> bool {
                this.internals.has_ref()
            }

            pub(crate) fn finalize(&self) {
                self.internals.finalize()
            }

            pub(crate) fn get_destroyed(this: &Self) -> bool {
                this.internals.get_destroyed()
            }

            pub(crate) fn dispose(this: &Self, cx: &mut ::bun_jsc::bindgen::JsScope<'_>) {
                this.internals.cancel(cx.global().bun_vm());
            }
        }
    };
}
pub(crate) use impl_timer_object;

#[path = "TimeoutObject.rs"]
pub(crate) mod timeout_object;

#[path = "ImmediateObject.rs"]
pub(crate) mod immediate_object;

#[path = "DateHeaderTimer.rs"]
mod date_header_timer_draft;

#[path = "EventLoopDelayMonitor.rs"]
pub(crate) mod event_loop_delay_monitor;

// ─── TimerHeap ───────────────────────────────────────────────────────────────

/// Stateless context for the heap comparator.
#[derive(Default)]
pub(crate) struct TimerHeapCtx;

impl bun_io::heap::HeapContext<EventLoopTimer> for TimerHeapCtx {
    #[inline]
    unsafe fn less(&self, a: *mut EventLoopTimer, b: *mut EventLoopTimer) -> bool {
        // SAFETY: `Intrusive` only ever calls `less` with non-null nodes that
        // are live members of the heap (caller invariant on insert/meld).
        EventLoopTimer::less((), unsafe { &*a }, unsafe { &*b })
    }
}

/// The intrusive pairing heap of `bun_io::heap`, changed through `&self`, because a timer's
/// callback arms and disarms timers while the drain that fired it is on the stack. Every borrow of
/// the heap is inside one of the methods below. Each does one heap operation, which rewrites the
/// links of the nodes and compares them with [`TimerHeapCtx::less`]; that only reads the two
/// timers, so nothing comes back here.
#[derive(Default)]
pub(crate) struct TimerHeap(UnsafeCell<bun_io::heap::Intrusive<EventLoopTimer, TimerHeapCtx>>);

impl TimerHeap {
    #[inline]
    pub(crate) fn peek(&self) -> Option<*mut EventLoopTimer> {
        let r = self.root();
        if r.is_null() { None } else { Some(r) }
    }

    /// Null when empty. The other nodes are reached through its `heap.child` and their `heap.next`.
    #[inline]
    fn root(&self) -> *mut EventLoopTimer {
        // SAFETY: see the type.
        unsafe { (*self.0.get()).root }
    }

    /// # Safety
    /// `v` is a valid node that is in no heap (its `IntrusiveField` links are null), and stays
    /// valid until it is removed.
    #[inline]
    unsafe fn insert(&self, v: *mut EventLoopTimer) {
        // SAFETY: see the type for the borrow; the rest is the fn contract.
        unsafe { (*self.0.get()).insert(v) };
    }

    /// # Safety
    /// `v` is a node currently in *this* heap.
    #[inline]
    unsafe fn remove(&self, v: *mut EventLoopTimer) {
        // SAFETY: see the type for the borrow; the rest is the fn contract.
        unsafe { (*self.0.get()).remove(v) };
    }

    #[inline]
    pub(crate) fn delete_min(&self) -> Option<*mut EventLoopTimer> {
        // SAFETY: see the type for the borrow. Every node came in through `insert()`, whose
        // caller keeps it valid while it is linked.
        let r = unsafe { (*self.0.get()).delete_min() };
        if r.is_null() { None } else { Some(r) }
    }

    #[inline]
    pub(crate) fn find_max(&self) -> Option<*mut EventLoopTimer> {
        // SAFETY: as `delete_min`.
        let r = unsafe { (*self.0.get()).find_max() };
        if r.is_null() { None } else { Some(r) }
    }

    #[inline]
    pub(crate) fn count(&self) -> usize {
        // SAFETY: as `delete_min`.
        unsafe { (*self.0.get()).count() }
    }
}

/// Keyed by the id that `+timer` returns in JavaScript. Changed through `&self`: every borrow of
/// the map is inside one of the methods below, which copy an id or a pointer in or out and call
/// nothing but the map. Hashing and comparing a `u64`, and the allocator, cannot come back here.
#[derive(Default)]
pub(crate) struct TimeoutMap(UnsafeCell<ArrayHashMap<u64, *mut EventLoopTimer>>);

impl TimeoutMap {
    fn find(&self, id: u64) -> Option<(usize, *mut EventLoopTimer)> {
        // SAFETY: see the type.
        let map = unsafe { &*self.0.get() };
        let index = map.get_index(&id)?;
        Some((index, map.values()[index]))
    }

    fn put_no_clobber(&self, id: u64, timer: *mut EventLoopTimer) -> Result<(), AllocError> {
        // SAFETY: see the type.
        unsafe { &mut *self.0.get() }.put_no_clobber(id, timer)
    }

    fn swap_remove_at(&self, index: usize) {
        // SAFETY: see the type.
        unsafe { &mut *self.0.get() }.swap_remove_at(index);
    }

    fn swap_remove(&self, id: u64) -> bool {
        // SAFETY: see the type.
        unsafe { &mut *self.0.get() }.swap_remove(&id)
    }

    /// Gives memory back once the slack exceeds 256 KiB.
    fn shrink_if_sparse(&self) {
        const ENTRY_SIZE: usize =
            core::mem::size_of::<u64>() + core::mem::size_of::<*mut EventLoopTimer>();
        // SAFETY: see the type.
        let map = unsafe { &mut *self.0.get() };
        let allocated_bytes = map.capacity() * ENTRY_SIZE;
        let used_bytes = map.count() * ENTRY_SIZE;
        if allocated_bytes - used_bytes > 256 * 1024 {
            map.shrink_and_free(map.count() + 8);
        }
    }
}

#[derive(Default)]
pub(crate) struct Maps {
    pub(crate) set_timeout: TimeoutMap,
    pub(crate) set_interval: TimeoutMap,
    pub(crate) set_immediate: TimeoutMap,
}

impl Maps {
    #[inline]
    fn get(&self, kind: Kind) -> &TimeoutMap {
        match kind {
            Kind::SetTimeout => &self.set_timeout,
            Kind::SetInterval => &self.set_interval,
            Kind::SetImmediate => &self.set_immediate,
        }
    }
}

// ─── FakeTimers ──────────────────────────────────────────────────────────────
pub(crate) use crate::test_runner::timers::fake_timers::FakeTimers;

// ─── DateHeaderTimer / EventLoopDelayMonitor ─────────────────────────────────

/// An [`EventLoopTimer`] that is a field of [`All`], which is only ever borrowed shared. The heap
/// links the node by address and writes to it, so it is in a cell. Every access, here and in the
/// heap, copies a field in or out and calls nothing that comes back to the node.
///
/// What arms it takes the `All` as `&'static`: the node then stays where it is for as long as the
/// heaps it can be linked in, which are fields of the same `All`.
struct EmbeddedTimer(UnsafeCell<EventLoopTimer>);

impl EmbeddedTimer {
    fn init_paused(tag: EventLoopTimerTag) -> Self {
        Self(UnsafeCell::new(EventLoopTimer::init_paused(tag)))
    }

    #[inline]
    fn as_ptr(&self) -> *mut EventLoopTimer {
        self.0.get()
    }

    #[inline]
    fn state(&self) -> EventLoopTimerState {
        // SAFETY: see the type.
        unsafe { (*self.0.get()).state }
    }

    #[inline]
    fn set_state(&self, state: EventLoopTimerState) {
        // SAFETY: see the type.
        unsafe { (*self.0.get()).state = state };
    }

    #[inline]
    fn next(&self) -> Timespec {
        // SAFETY: see the type.
        unsafe { (*self.0.get()).next }
    }

    #[inline]
    fn set_next(&self, next: Timespec) {
        // SAFETY: see the type.
        unsafe { (*self.0.get()).next = next };
    }
}

pub(crate) struct DateHeaderTimer {
    event_loop_timer: EmbeddedTimer,
}
impl Default for DateHeaderTimer {
    fn default() -> Self {
        Self {
            event_loop_timer: EmbeddedTimer::init_paused(EventLoopTimerTag::DateHeaderTimer),
        }
    }
}
impl DateHeaderTimer {
    /// Refresh the cached `Date:` header and
    /// reschedule for 1s later iff there are active connections.
    pub(crate) fn run(all: &'static All, vm: &VirtualMachine) {
        let timer = &all.date_header_timer.event_loop_timer;
        timer.set_state(EventLoopTimerState::FIRED);
        let loop_ = vm.uws_loop();
        let now = Timespec::now(TimespecMockMode::ForceRealTime);

        // Record when we last ran it.
        timer.set_next(now);

        // updateDate() is an expensive function.
        loop_.update_date();

        if loop_.internal_loop_data.sweep_timer_count.get() > 0 {
            // Reschedule it automatically for 1 second later.
            timer.set_next(now.add_ms(1000));
            // SAFETY: see `EmbeddedTimer`. The drain popped the node to get here, and nothing
            // above arms a timer.
            unsafe { all.insert(timer.as_ptr()) };
        }
    }
}

/// Samples the event loop for every enabled `monitorEventLoopDelay()` histogram of this thread, with one timer.
pub(crate) struct EventLoopDelayMonitor {
    /// Taken out for as long as it is walked. Nothing that runs meanwhile enables or disables a histogram.
    enabled: VecCell<EnabledInterval>,
    event_loop_timer: EmbeddedTimer,
}

struct EnabledInterval {
    /// Weak, so a histogram that is collected while enabled stops being sampled. It holds no JS value.
    interval: std::rc::Weak<Interval>,
    next: Timespec,
}

impl Default for EventLoopDelayMonitor {
    fn default() -> Self {
        Self {
            enabled: VecCell::new(),
            event_loop_timer: EmbeddedTimer::init_paused(EventLoopTimerTag::EventLoopDelayMonitor),
        }
    }
}

impl EventLoopDelayMonitor {
    fn enable(all: &'static All, interval: &Rc<Interval>) {
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let mut enabled = all.event_loop_delay.enabled.take();
        enabled.push(EnabledInterval {
            interval: Rc::downgrade(interval),
            next: now.add_ms(i64::from(interval.resolution_ms)),
        });
        Self::schedule(all, enabled);
    }

    fn disable(all: &'static All, interval: &Rc<Interval>) {
        let mut enabled = all.event_loop_delay.enabled.take();
        enabled.retain(|enabled| !core::ptr::eq(enabled.interval.as_ptr(), Rc::as_ptr(interval)));
        Self::schedule(all, enabled);
    }

    pub(crate) fn disable_all(all: &'static All) {
        let mut enabled = all.event_loop_delay.enabled.take();
        enabled.clear();
        Self::schedule(all, enabled);
    }

    pub(crate) fn on_fire(all: &'static All, now: &ElTimespec, vm: &VirtualMachine) {
        let this = &all.event_loop_delay;
        this.event_loop_timer.set_state(EventLoopTimerState::FIRED);
        let mut allocated = 0;
        let mut enabled = this.enabled.take();
        enabled.retain_mut(|enabled| {
            let Some(interval) = enabled.interval.upgrade() else {
                return false;
            };
            if enabled.next.order(now).is_le() {
                // From the time of the sample, which is later than `now` if a timer before this one was slow: the
                // next sample is then no sooner than the resolution. `All::drain_timers` pops every node due at
                // or before `now`.
                let (sampled_at, grown) = interval.sample();
                enabled.next = sampled_at.add_ms(i64::from(interval.resolution_ms));
                allocated += grown;
            }
            true
        });
        Self::schedule(all, enabled);
        if allocated > 0 {
            // This can collect, so it comes last.
            vm.jsc_vm()
                .report_extra_memory_allocated(bun_jsc::JSValue::UNDEFINED, allocated);
        }
    }

    /// Puts `enabled` back and arms the timer for the interval that is due first.
    fn schedule(all: &'static All, enabled: Vec<EnabledInterval>) {
        let this = &all.event_loop_delay;
        let next = enabled
            .iter()
            .map(|enabled| enabled.next)
            .min_by(Timespec::order);
        let added_meanwhile = this.enabled.replace(enabled);
        debug_assert!(added_meanwhile.is_empty());
        // SAFETY: see `EmbeddedTimer`. Only `all` links the node, and `on_fire` marks it `FIRED`
        // first thing, so `ACTIVE` means linked in `all`.
        unsafe {
            if let Some(next) = next {
                all.update(this.event_loop_timer.as_ptr(), &next);
            } else if this.event_loop_timer.state() == EventLoopTimerState::ACTIVE {
                all.remove(this.event_loop_timer.as_ptr());
            }
        }
    }
}

// ─── TimerObjectInternals / TimeoutObject / ImmediateObject ─────────────────

pub(crate) mod timer_object_internals;
pub(crate) use timer_object_internals::{Flags as TimerFlags, TimerObjectInternals};

/// `jsc.WebCore.AbortSignal.Timeout` — real struct lives in `bun_jsc` (which
/// this crate depends on). Re-exported here so `All::update`'s
/// field-parent-pointer epoch-bump and `dispatch::fire_timer` resolve the same
/// `event_loop_timer`/`flags` offsets the low tier wrote.
pub(crate) use crate::jsc::abort_signal::Timeout as AbortSignalTimeout;

pub(crate) use self::immediate_object::ImmediateObject;
pub(crate) use self::timeout_object::TimeoutObject;

/// Recover the
/// [`TimerFlags`] slot for the three JS-timer container tags
/// (`TimeoutObject` / `ImmediateObject` / `AbortSignalTimeout`), else `None`.
///
/// Returns a raw `NonNull` so the caller decides read vs. write:
/// [`EventLoopTimer::less`] reads `.epoch()` on the heap-compare hot path;
/// [`All::update`] writes `.set_epoch()` on the JS thread. The two
/// `internals.flags` arms store `Cell<TimerFlags>`; `Cell<T>` is
/// `#[repr(transparent)]` so the `addr_of!` → `.cast()` is layout-sound.
///
/// # Safety
/// `t` points at a live [`EventLoopTimer`] whose `tag` was set at
/// construction and never re-tagged (the JS-timer-tag invariant). When the
/// tag matches, `t` is the `event_loop_timer` field of the named container
/// with whole-container provenance.
#[inline]
pub(crate) unsafe fn js_timer_flags_ptr(
    t: *const EventLoopTimer,
) -> Option<core::ptr::NonNull<TimerFlags>> {
    use core::ptr::{NonNull, addr_of};
    // SAFETY: caller contract — `t` is live; tag invariant per fn docs.
    unsafe {
        let p: *const TimerFlags = match (*t).tag {
            EventLoopTimerTag::TimeoutObject => {
                let parent = TimeoutObject::from_timer_ptr(t);
                addr_of!((*parent).internals.flags).cast()
            }
            EventLoopTimerTag::ImmediateObject => {
                let parent = ImmediateObject::from_timer_ptr(t);
                addr_of!((*parent).internals.flags).cast()
            }
            // `AbortSignal.Timeout` stores
            // `flags` directly (not under `.internals`, not `Cell`-wrapped).
            EventLoopTimerTag::AbortSignalTimeout => {
                let parent = AbortSignalTimeout::from_timer_ptr(t);
                addr_of!((*parent).flags)
            }
            _ => return None,
        };
        Some(NonNull::new_unchecked(p.cast_mut()))
    }
}

/// A timer created by WTF code and invoked by Bun's event loop.
#[path = "WTFTimer.rs"]
pub(crate) mod wtf_timer;
pub(crate) use wtf_timer::WTFTimer;

// ─── All ─────────────────────────────────────────────────────────────────────

/// Limits [`All::cancel_timeout_objects`] to the timers created since the latest `--hot` reload.
pub(crate) struct HotRun {
    /// The current `hot_reload_counter`.
    pub(crate) counter: u32,
    pub(crate) only_intervals: bool,
}

/// The timers of WTF code (JSC's garbage collector and run loop), which arms and cancels them from
/// whichever thread it is on. This is the one part of [`All`] another thread may borrow.
pub(crate) struct WtfTimers {
    heap: Guarded<TimerHeap>,
    /// The JS thread, which drains the heap.
    #[cfg(windows)]
    thread_id: std::thread::ThreadId,
}

// SAFETY: `heap` is only reached through its lock, and so are the `state`, `next` and links of a
// `WTFTimer`'s node, linked or not: `arm`, `disarm` and `pop_due` are all that write them.
unsafe impl Sync for WtfTimers {}

impl WtfTimers {
    fn init() -> Self {
        Self {
            heap: Guarded::init(TimerHeap::default()),
            #[cfg(windows)]
            thread_id: std::thread::current().id(),
        }
    }

    #[cfg(windows)]
    #[inline]
    pub(crate) fn is_on_js_thread(&self) -> bool {
        self.thread_id == std::thread::current().id()
    }

    /// On Windows the caller follows this with [`All::ensure_uv_timer`] if it is on the JS thread.
    ///
    /// # Safety
    /// `timer` is the node of a live `WTFTimer` that arms in no other heap, and stays valid until
    /// it is disarmed or popped.
    pub(crate) unsafe fn arm(&self, timer: *mut EventLoopTimer, time: &Timespec) {
        // SAFETY: fn contract.
        debug_assert!(unsafe { (*timer).tag } == EventLoopTimerTag::WTFTimer);
        let heap = self.heap.lock();
        // SAFETY: fn contract; `ACTIVE` means linked here.
        unsafe {
            if (*timer).state == EventLoopTimerState::ACTIVE {
                heap.remove(timer);
            }
            (*timer).next = *time;
            heap.insert(timer);
            (*timer).state = EventLoopTimerState::ACTIVE;
        }
    }

    /// # Safety
    /// As [`Self::arm`].
    pub(crate) unsafe fn disarm(&self, timer: *mut EventLoopTimer) {
        // SAFETY: fn contract.
        debug_assert!(unsafe { (*timer).tag } == EventLoopTimerTag::WTFTimer);
        let heap = self.heap.lock();
        // SAFETY: fn contract; `ACTIVE` means linked here.
        unsafe {
            if (*timer).state == EventLoopTimerState::ACTIVE {
                heap.remove(timer);
                (*timer).state = EventLoopTimerState::CANCELLED;
            }
        }
    }

    /// When the first timer is due.
    #[cfg(windows)]
    fn next_deadline(&self) -> Option<Timespec> {
        let heap = self.heap.lock();
        // SAFETY: a linked node is valid, and its `next` only changes under this lock.
        heap.peek().map(|min| unsafe { (*min).next })
    }

    /// Unlinks the first timer if it is due. `now` is read when there is a timer to compare it with.
    fn pop_due(&self, now: &mut Option<Timespec>) -> PopDue {
        let heap = self.heap.lock();
        let Some(min) = heap.peek() else {
            return PopDue::Empty;
        };
        // SAFETY: a linked node is valid, and its `next` only changes under this lock.
        let min_next = unsafe { (*min).next };
        let now = *now.get_or_insert_with(|| Timespec::now(TimespecMockMode::ForceRealTime));
        if min_next.greater(&now) {
            return PopDue::NotYet(min_next);
        }
        let min = heap.delete_min().expect("peek succeeded");
        // SAFETY: as above.
        unsafe { (*min).state = EventLoopTimerState::FIRED };
        PopDue::Due(min, now)
    }
}

enum PopDue {
    Empty,
    NotYet(Timespec),
    Due(*mut EventLoopTimer, Timespec),
}

pub(crate) struct All {
    /// Id of the next timer. Allocate ids with [`All::next_id`].
    pub(crate) last_id: Cell<u64>,
    /// `last_id` at the latest `--hot` reload.
    pub(crate) first_id_of_hot_run: Cell<u64>,
    pub(crate) timers: TimerHeap,
    pub(crate) active_timer_count: Cell<i32>,
    /// libuv links the handle by address and writes to it.
    #[cfg(windows)]
    uv_timer: UnsafeCell<uv::Timer>,
    /// Whether we have emitted a warning for passing a negative timeout duration
    pub(crate) warned_negative_number: Cell<bool>,
    /// Whether we have emitted a warning for passing NaN for the timeout duration
    pub(crate) warned_not_number: Cell<bool>,
    /// Incremented when timers are scheduled or rescheduled. See
    /// TimerObjectInternals.epoch. Masked to 25 bits on increment.
    pub(crate) epoch: Cell<u32>,
    pub(crate) immediate_ref_count: Cell<i32>,
    /// As `uv_timer`.
    #[cfg(windows)]
    uv_idle: UnsafeCell<uv::uv_idle_t>,
    pub(crate) event_loop_delay: EventLoopDelayMonitor,
    pub(crate) fake_timers: FakeTimers,
    pub(crate) maps: Maps,
    pub(crate) date_header_timer: DateHeaderTimer,
    pub(crate) wtf_timers: WtfTimers,
}

impl All {
    pub(crate) fn init() -> Self {
        Self {
            last_id: Cell::new(1),
            first_id_of_hot_run: Cell::new(0),
            timers: TimerHeap::default(),
            active_timer_count: Cell::new(0),
            #[cfg(windows)]
            uv_timer: UnsafeCell::new(bun_core::ffi::zeroed()),
            warned_negative_number: Cell::new(false),
            warned_not_number: Cell::new(false),
            epoch: Cell::new(0),
            immediate_ref_count: Cell::new(0),
            #[cfg(windows)]
            uv_idle: UnsafeCell::new(bun_core::ffi::zeroed()),
            event_loop_delay: EventLoopDelayMonitor::default(),
            fake_timers: FakeTimers::default(),
            maps: Maps::default(),
            date_header_timer: DateHeaderTimer::default(),
            wtf_timers: WtfTimers::init(),
        }
    }

    /// Returns a new timer id. Ids are positive and never repeat, because a 64-bit counter won't wrap.
    #[inline]
    pub(crate) fn next_id(&self) -> u64 {
        let id = self.last_id.get();
        self.last_id.set(id.wrapping_add(1));
        id
    }

    /// Links `timer`, which fires at its `next`, and marks it `ACTIVE`.
    ///
    /// # Safety
    /// - `timer` is the node that `__bun_fire_timer` expects for its `tag` (not `WTFTimer`): a
    ///   field of a live owner, with provenance for reads and writes over the whole owner, which
    ///   the handler and [`js_timer_flags_ptr`] recover from it.
    /// - It is linked in no heap.
    /// - Until it is unlinked, by [`Self::remove`], [`Self::update`], `FakeTimers`,
    ///   [`Self::disarm_all_for_vm_teardown`] or the drain that pops it to fire it, the owner is
    ///   neither freed nor moved, and every call that arms, disarms or drains a timer of this
    ///   thread may read and write the node through `timer`, to compare and relink it. So the
    ///   node is in a cell of an owner that is only borrowed shared, or nothing borrows the owner
    ///   across such a call.
    /// - The owner's handler takes `state` off `ACTIVE` before anything passes the popped node to
    ///   `remove` or `update`. The drain leaves it `ACTIVE`.
    pub(crate) unsafe fn insert(&self, timer: *mut EventLoopTimer) {
        // SAFETY: fn contract.
        let tag = unsafe { (*timer).tag };
        debug_assert!(tag != EventLoopTimerTag::WTFTimer, "use WtfTimers::arm");

        // Bump the global epoch into the per-timer flags so equal-deadline JS
        // timers (setTimeout/setInterval/AbortSignal.timeout) fire in insertion
        // order. Before heap insert: `EventLoopTimer::less` reads epoch as tiebreak.
        // SAFETY: fn contract.
        if let Some(flags) = unsafe { js_timer_flags_ptr(timer) } {
            let epoch = self.epoch.get().wrapping_add(1) & ((1u32 << 25) - 1);
            self.epoch.set(epoch);
            // SAFETY: `flags` points into the live container recovered above.
            unsafe { (*flags.as_ptr()).set_epoch(epoch) };
        }

        if self.fake_timers.is_active() && tag.allow_fake_timers() {
            // SAFETY: see fn contract
            unsafe {
                self.fake_timers.timers.insert(timer);
                (*timer).state = EventLoopTimerState::ACTIVE;
                (*timer).in_heap = InHeap::Fake;
            }
        } else {
            // SAFETY: see fn contract
            unsafe {
                self.timers.insert(timer);
                (*timer).state = EventLoopTimerState::ACTIVE;
                (*timer).in_heap = InHeap::Regular;
            }
            #[cfg(windows)]
            self.ensure_uv_timer();
        }
    }

    /// The owning thread's JSC VM is gone (nothing schedules a WTFTimer any
    /// more) and the timeout objects are drained: hand the embedded
    /// `uv_timer_t`/`uv_idle_t` to `uv_close` so their nodes leave the loop's
    /// handle queue when the teardown closes the loop — before this struct's
    /// storage is freed.
    #[cfg(windows)]
    pub(crate) fn close_loop_handles_for_vm_teardown(&self) {
        unsafe extern "C" fn timer_closed(_: *mut uv::Timer) {}
        unsafe extern "C" fn idle_closed(_: *mut uv::uv_idle_t) {}
        // SAFETY: the only borrows of the handles: `uv_*_stop` and `uv_close` run no callback.
        let (uv_timer, uv_idle) = unsafe { (&mut *self.uv_timer.get(), &mut *self.uv_idle.get()) };
        if !uv_timer.data.is_null() {
            uv_timer.stop();
            uv_timer.close(timer_closed);
        }
        if !uv_idle.data.is_null() {
            uv_idle.stop();
            uv_idle.close(idle_closed);
        }
    }

    /// Lazily `uv_timer_init` the
    /// per-`All` libuv timer, then (re)start it for the soonest deadline
    /// across both heaps. On Windows there is no epoll/kqueue fallback; this
    /// `uv_timer_t` is the ONLY thing that wakes `uv_run` for JS timers.
    #[cfg(windows)]
    pub(crate) fn ensure_uv_timer(&self) {
        // SAFETY: the only borrow of the handle: nothing below runs a libuv callback or comes
        // back to `All`.
        let uv_timer = unsafe { &mut *self.uv_timer.get() };
        if uv_timer.data.is_null() {
            uv_timer.init(uv::Loop::get().as_ptr());
            // Only a non-null "initialized" sentinel.
            uv_timer.data = core::ptr::from_ref(self)
                .cast_mut()
                .cast::<core::ffi::c_void>();
            uv_timer.unref();
        }
        debug_assert!(
            !uv_timer.is_closing(),
            "timer scheduled after teardown closed the heap's uv timer"
        );

        // SAFETY: `peek` returns a live heap node.
        let reg_next = self.timers.peek().map(|timer| unsafe { (*timer).next });
        let wtf_next = self.wtf_timers.next_deadline();
        let Some(next_ts) = Self::soonest(reg_next, wtf_next) else {
            return;
        };

        // SAFETY: `uv_timer.data` is non-null past the lazy-init block, so
        // `uv_timer_init` has run and the handle's `loop` field points at
        // the owning VM's live `uv_loop_t` (== `vm.uvLoop()` per spec).
        unsafe { uv::uv_update_time(uv_timer.get_loop()) };
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        let wait = if next_ts.greater(&now) {
            next_ts.duration(&now)
        } else {
            Timespec { sec: 0, nsec: 0 }
        };

        // minimum 1ms
        // https://github.com/nodejs/node/blob/f552c86fecd6c2ba9e832ea129b731dd63abdbe2/src/env.cc#L1512
        let wait_ms = core::cmp::max(1, wait.ms_unsigned());

        // SAFETY: `uv_timer_init` ran above; the handle is live.
        let due_in = unsafe { uv::uv_timer_get_due_in(&*uv_timer) };
        // Restarting an overdue handle shifts the wakeup out by 1ms. Done
        // on every insert, the already-due callback never runs.
        if !(uv_timer.is_active() && due_in <= wait_ms) {
            uv_timer.start(wait_ms, 0, Some(Self::on_uv_timer));
        }

        if self.active_timer_count.get() > 0 {
            uv_timer.ref_();
        } else {
            uv_timer.unref();
        }
    }

    /// libuv timer callback; drain due
    /// timers then re-arm for the next deadline. libuv calls it on the loop's thread, which is
    /// the JS thread.
    #[cfg(windows)]
    extern "C" fn on_uv_timer(_: *mut uv::Timer) {
        let all = crate::jsc_hooks::timer_all();
        all.drain_timers(VirtualMachine::get());
        all.ensure_uv_timer();
    }

    /// Unlinks `timer` and marks it `CANCELLED`.
    ///
    /// # Safety
    /// `timer` is a node that [`Self::insert`] or [`Self::update`] of this `All` linked and that
    /// nothing has unlinked since. For an owner that keeps the contract of `insert` that is what
    /// `state == ACTIVE` says.
    pub(crate) unsafe fn remove(&self, timer: *mut EventLoopTimer) {
        // SAFETY: a linked node is live.
        match unsafe { (*timer).in_heap } {
            InHeap::None => {
                // can't remove a timer that was not inserted
                debug_assert!(false);
            }
            // SAFETY: linked (fn contract), in `self.timers` per `in_heap`.
            InHeap::Regular => unsafe { self.timers.remove(timer) },
            // SAFETY: linked (fn contract), in `self.fake_timers.timers` per `in_heap`.
            InHeap::Fake => unsafe { self.fake_timers.timers.remove(timer) },
        }
        // SAFETY: as above.
        unsafe {
            (*timer).in_heap = InHeap::None;
            (*timer).state = EventLoopTimerState::CANCELLED;
        }
    }

    /// Remove the EventLoopTimer if necessary, then re-insert at `time`.
    ///
    /// # Safety
    /// As [`Self::insert`], except that `timer` may be linked: if its `state` is `ACTIVE` it meets
    /// the contract of [`Self::remove`], otherwise it is linked in no heap.
    pub(crate) unsafe fn update(&self, timer: *mut EventLoopTimer, time: &Timespec) {
        // Copied before `timer` is written to: it may be a borrow of `timer.next`.
        let time = *time;
        // SAFETY: fn contract.
        unsafe {
            if (*timer).state == EventLoopTimerState::ACTIVE {
                self.remove(timer);
            }

            (*timer).next = time;

            // `insert` bumps the global epoch and writes it into the per-timer
            // flags so equal-deadline JS timers fire in refresh order.
            self.insert(timer);
        }
    }

    /// Fires every WTF timer that is due. Returns when the first of the others is.
    fn drain_due_wtf_timers(
        &self,
        maybe_now: &mut Option<Timespec>,
        vm: &VirtualMachine,
    ) -> Option<Timespec> {
        loop {
            let (min, now) = match self.wtf_timers.pop_due(maybe_now) {
                PopDue::Empty => return None,
                PopDue::NotYet(next) => return Some(next),
                PopDue::Due(min, now) => (min, now),
            };
            // SAFETY: `min` was linked, so it is live; the lock is released.
            let fired = unsafe { EventLoopTimer::fire(min, &now, erase_vm(vm)) };
            // WTF timers run JSC-internal work, not user JS; a stop found here
            // is the loop's to act on at its next gate, and the heap's next
            // deadline is still reported to the poll.
            let _ = fold_timer(vm, fired);
        }
    }

    #[inline]
    fn soonest(a: Option<Timespec>, b: Option<Timespec>) -> Option<Timespec> {
        match (a, b) {
            (Some(a), Some(b)) => Some(if a.greater(&b) { b } else { a }),
            (a, b) => a.or(b),
        }
    }

    /// Called from `EventLoop::auto_tick` to compute the epoll/kqueue timeout.
    /// Returns `true` if `spec` was written. `now_out` receives the monotonic reading this
    /// took, if any, for the caller to share with the tick (see `NOW_NS_UNKNOWN`).
    pub(crate) fn get_timeout(
        &self,
        spec: &mut Timespec,
        has_pending_immediate: bool,
        quic_next_tick_us: Option<i64>,
        vm: &VirtualMachine,
        now_out: &mut Option<Timespec>,
    ) -> bool {
        #[cfg(unix)]
        if has_pending_immediate {
            *spec = Timespec { sec: 0, nsec: 0 };
            return true;
        }
        #[cfg(not(unix))]
        let _ = has_pending_immediate;

        let maybe_now: &mut Option<Timespec> = now_out;

        let wtf_next = self.drain_due_wtf_timers(maybe_now, vm);

        // SAFETY: `peek` returns a live heap node.
        let reg_next = self.timers.peek().map(|min| unsafe { (*min).next });

        let Some(next) = Self::soonest(wtf_next, reg_next) else {
            if let Some(us) = quic_next_tick_us {
                if us >= 0 {
                    *spec = Timespec {
                        sec: us / US_PER_S,
                        nsec: (us % US_PER_S) * NS_PER_US,
                    };
                    return true;
                }
            }
            return false;
        };

        // Real clock: both heaps hold opt-out-of-fake-timers nodes armed in
        // real-time units; the mocked clock made internal pacing spin on re-arm.
        let now = *maybe_now.get_or_insert_with(|| Timespec::now(TimespecMockMode::ForceRealTime));
        if next.greater(&now) {
            *spec = next.duration(&now);
            if let Some(us) = quic_next_tick_us {
                if us >= 0 {
                    Self::clamp_to_quic(spec, us);
                }
            }
        } else {
            *spec = Timespec { sec: 0, nsec: 0 };
        }
        true
    }

    fn clamp_to_quic(spec: &mut Timespec, us: i64) {
        let cur_us = spec.sec * US_PER_S + spec.nsec / NS_PER_US;
        if us < cur_us {
            *spec = Timespec {
                sec: us / US_PER_S,
                nsec: (us % US_PER_S) * NS_PER_US,
            };
        }
    }

    /// Pop the next due timer. `now` is filled lazily on first call so we
    /// don't pay for `clock_gettime` when the heap is empty.
    fn next(&self, has_set_now: &mut bool, now: &mut Timespec) -> Option<*mut EventLoopTimer> {
        let timer = self.timers.peek()?;
        if !*has_set_now {
            // Real clock: this heap is the opt-out-of-fake-timers set.
            *now = Timespec::now(TimespecMockMode::ForceRealTime);
            *has_set_now = true;
        }
        // SAFETY: peek returns a live heap node
        if unsafe { (*timer).next }.greater(now) {
            return None;
        }
        let deleted = self.timers.delete_min().expect("peek succeeded");
        debug_assert!(core::ptr::eq(deleted, timer));
        Some(timer)
    }

    pub(crate) fn drain_timers(&self, vm: &VirtualMachine) {
        let mut wtf_now: Option<Timespec> = None;
        let _ = self.drain_due_wtf_timers(&mut wtf_now, vm);

        let mut now = Timespec { sec: 0, nsec: 0 };
        let mut has_set_now = false;
        while let Some(t) = self.next(&mut has_set_now, &mut now) {
            // SAFETY: `t` was just popped from the intrusive heap and is live.
            let fired = unsafe { EventLoopTimer::fire(t, &now, erase_vm(vm)) };
            if fold_timer(vm, fired).is_err() {
                break;
            }
        }
    }

    pub(crate) fn increment_immediate_ref(&self, delta: i32, uws_loop: &bun_uws_sys::Loop) {
        let old = self.immediate_ref_count.get();
        let new = old + delta;
        self.immediate_ref_count.set(new);
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            uws_loop.ref_();
            #[cfg(windows)]
            {
                // SAFETY: the only borrow of the handle: `uv_idle_init`/`uv_idle_start` run no callback.
                let uv_idle = unsafe { &mut *self.uv_idle.get() };
                // Lazy-init the idle handle and start
                // it with a no-op callback so `uv_run` does not block in poll
                // while immediates are pending (matches Node.js).
                if uv_idle.data.is_null() {
                    uv_idle.init(uv::Loop::get().as_ptr());
                    // Only a non-null "initialized" sentinel.
                    uv_idle.data = core::ptr::from_ref(self)
                        .cast_mut()
                        .cast::<core::ffi::c_void>();
                }
                uv_idle.start(Some(Self::on_uv_idle_noop));
            }
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            uws_loop.unref();
            #[cfg(windows)]
            {
                // SAFETY: the only borrow of the handle: `uv_idle_stop` runs no callback.
                let uv_idle = unsafe { &mut *self.uv_idle.get() };
                if !uv_idle.data.is_null() {
                    uv_idle.stop();
                }
            }
        }
        #[cfg(windows)]
        let _ = uws_loop;
    }

    /// Empty `uv_idle` callback. Its presence alone
    /// keeps `uv_run` from blocking in the poll phase; the body is a no-op.
    /// No preconditions (the handle pointer is unused), so the fn is safe; the
    /// safe fn item coerces into the `uv_idle_cb` fn-pointer slot.
    #[cfg(windows)]
    extern "C" fn on_uv_idle_noop(_: *mut uv::uv_idle_t) {
        // prevent libuv from polling forever
    }

    pub(crate) fn increment_timer_ref(&self, delta: i32, uws_loop: &bun_uws_sys::Loop) {
        let old = self.active_timer_count.get();
        let new = old + delta;
        debug_assert!(new >= 0);
        self.active_timer_count.set(new);
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            uws_loop.ref_();
            // `uv_timer.ref()` is intentionally unconditional (no `data !=
            // null` guard). Invariant: every path that reaches a positive
            // `active_timer_count` first inserts a timer, and `insert`
            // → `ensure_uv_timer` lazily `uv_timer_init`s the handle. Guarding
            // here would silently drop the ref and let the loop exit early.
            // SAFETY: the only borrow of the handle: `uv_ref` runs no callback.
            #[cfg(windows)]
            unsafe { &mut *self.uv_timer.get() }.ref_();
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            uws_loop.unref();
            // SAFETY: the only borrow of the handle: `uv_unref` runs no callback.
            #[cfg(windows)]
            unsafe { &mut *self.uv_timer.get() }.unref();
        }
        #[cfg(windows)]
        let _ = uws_loop;
    }

    /// VM teardown, after `cancel_all_timeout_objects`: unlink every timer still
    /// in either heap, whatever its kind. Owners keep their nodes (now
    /// `CANCELLED`, which their own `state == ACTIVE` checks respect); nothing
    /// can fire afterwards even if the loop turns again.
    ///
    /// # Safety
    /// Never on a VM that keeps running.
    pub(crate) unsafe fn disarm_all_for_vm_teardown(&self) {
        let mut nodes: Vec<*mut EventLoopTimer> = Vec::new();
        let mut stack: Vec<*mut EventLoopTimer> = Vec::new();
        for root in [self.timers.root(), self.fake_timers.timers.root()] {
            if !root.is_null() {
                stack.push(root);
            }
        }
        while let Some(node) = stack.pop() {
            // SAFETY: intrusive-heap invariant — reachable nodes are live while linked.
            let (child, next) = unsafe { ((*node).heap.child, (*node).heap.next) };
            if !child.is_null() {
                stack.push(child);
            }
            if !next.is_null() {
                stack.push(next);
            }
            nodes.push(node);
        }
        for node in nodes {
            // SAFETY: `node` was reached from a root, and only this loop has unlinked anything
            // since. `remove` relinks the others, which stay linked, so valid.
            unsafe { self.remove(node) };
        }
    }

    /// VM-teardown / `--isolate` file-swap pass: `cancel()` every
    /// `TimeoutObject` / `ImmediateObject` still linked in `timers` /
    /// `fake_timers.timers` so the in-heap `+1` ref and the JS pin
    /// (`this_value` Strong) are released before the GC sweep, and discard
    /// every `AbortSignal.timeout()` timer through its signal so the signal
    /// stops reporting an active timer.
    pub(crate) fn cancel_all_timeout_objects(&self, vm: &VirtualMachine) {
        self.cancel_timeout_objects(vm, None);
    }

    /// [`Self::cancel_all_timeout_objects`], limited to `hot_run` if given.
    pub(crate) fn cancel_timeout_objects(&self, vm: &VirtualMachine, hot_run: Option<&HotRun>) {
        let first_id = self.first_id_of_hot_run.get();
        let mut to_cancel: Vec<*mut TimerObjectInternals> = Vec::new();
        let mut signal_timeouts: Vec<*mut AbortSignalTimeout> = Vec::new();
        let mut stack: Vec<*mut EventLoopTimer> = Vec::new();

        for root in [self.timers.root(), self.fake_timers.timers.root()] {
            if !root.is_null() {
                stack.push(root);
            }
        }
        while let Some(node) = stack.pop() {
            // SAFETY: intrusive-heap invariant — every node reachable from a
            // root is a live `EventLoopTimer` while linked. Read-only walk.
            let (tag, child, next) =
                unsafe { ((*node).tag, (*node).heap.child, (*node).heap.next) };
            if !child.is_null() {
                stack.push(child);
            }
            if !next.is_null() {
                stack.push(next);
            }
            match tag {
                EventLoopTimerTag::TimeoutObject => {
                    // SAFETY: tag invariant — `node` IS the `event_loop_timer`
                    // field of a live `TimeoutObject`.
                    let parent = unsafe { TimeoutObject::from_timer_ptr(node) };
                    // SAFETY: `parent` points at the live `TimeoutObject` recovered
                    // above; `addr_of!` projects the in-bounds `internals` field.
                    to_cancel.push(unsafe { core::ptr::addr_of_mut!((*parent).internals) });
                }
                EventLoopTimerTag::ImmediateObject => {
                    // SAFETY: tag invariant — see above.
                    let parent = unsafe { ImmediateObject::from_timer_ptr(node) };
                    // SAFETY: `parent` points at the live `ImmediateObject` recovered
                    // above; `addr_of!` projects the in-bounds `internals` field.
                    to_cancel.push(unsafe { core::ptr::addr_of_mut!((*parent).internals) });
                }
                EventLoopTimerTag::AbortSignalTimeout => {
                    // SAFETY: tag invariant — `node` IS the `event_loop_timer`
                    // field of a live boxed `abort_signal::Timeout`.
                    signal_timeouts.push(unsafe { AbortSignalTimeout::from_timer_ptr(node) });
                }
                _ => {}
            }
        }

        for internals in to_cancel {
            // SAFETY: each pointer was collected from the live heap; the
            // parent box is still alive (the +1 ref `cancel()` releases is
            // exactly the one keeping it pinned). `cancel()` may free the
            // parent on the final deref — never touched again.
            unsafe {
                if hot_run.is_none_or(|run| {
                    (*internals).id >= first_id
                        && (!run.only_intervals
                            || (*internals).flags.get().kind() == Kind::SetInterval)
                }) {
                    TimerObjectInternals::cancel_unpinned(internals, vm);
                }
            }
        }

        // `AbortSignal.timeout()` boxes are owned by the C++ `AbortSignal`, so
        // each one is handed back to its signal, which unlinks and frees it and
        // clears `m_timeout`. Only unlinking the node here would leave every
        // observed signal's wrapper (under `--isolate`: the retired global its
        // listeners close over) pinned by `isReachableFromOpaqueRoots` for the
        // rest of the process; see `Timeout::discard`.
        for t in signal_timeouts {
            // SAFETY: each `t` was collected from the live heap above, so its
            // box (and therefore its owning signal) is still alive; JS thread.
            // `t` is freed by the call.
            unsafe {
                if hot_run
                    .is_none_or(|run| (*t).hot_reload_counter == run.counter && !run.only_intervals)
                {
                    AbortSignalTimeout::discard(t);
                }
            }
        }
    }
}

// ─── enums / value types ─────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq, strum::IntoStaticStr)]
pub(crate) enum TimeoutWarning {
    TimeoutOverflowWarning,
    TimeoutNegativeWarning,
    TimeoutNaNWarning,
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum CountdownOverflowBehavior {
    /// `setTimeout` and friends.
    OneMs,
    /// `Bun.sleep`.
    Clamp,
}

// LAYERING: `Kind`/`KindBig` moved DOWN to `bun_event_loop` so `TimerFlags`
// (also moved down) can name them without a `bun_runtime` dep — needed by
// `bun_jsc::abort_signal::Timeout.flags`. `Kind::big()` lives next to the
// type so `TimeoutObject`/`TimerObjectInternals` can call it as a method.
pub(crate) use bun_event_loop::EventLoopTimer::{Kind, KindBig};

#[derive(Copy, Clone)]
pub(crate) struct ID {
    pub id: u64,
    pub kind: KindBig,
}
impl ID {
    /// Returns the inspector's key for this timer, with the kind in the low two bits and the id above them.
    #[inline]
    fn async_id(self) -> u64 {
        (self.id << 2) | self.kind as u64
    }
}

const US_PER_S: i64 = bun_core::time::US_PER_S as i64;
const NS_PER_US: i64 = bun_core::time::NS_PER_US as i64;

/// `EventLoopTimer::fire` is declared below `bun_jsc`, so it takes the VM erased.
#[inline]
pub(crate) fn erase_vm(vm: &VirtualMachine) -> *mut () {
    core::ptr::from_ref(vm).cast_mut().cast()
}

/// The timer drain's fold: report what a fired timer's handler left pending
/// as uncaught, or — if it is the VM's termination — tell the drain to stop.
#[inline]
fn fold_timer(
    vm: &VirtualMachine,
    fired: bun_event_loop::JsResult<()>,
) -> Result<(), bun_jsc::Stopped> {
    #[cold]
    #[inline(never)]
    fn report(vm: &VirtualMachine, err: bun_jsc::JsError) -> Result<(), bun_jsc::Stopped> {
        bun_jsc::task::report_error_or_terminate(vm.global(), err)
    }
    match fired {
        Ok(()) => Ok(()),
        Err(err) => report(vm, err),
    }
}
