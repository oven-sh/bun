//! Timer subsystem: setTimeout/setInterval/setImmediate scheduling and the
//! event-loop timer heap.

use bun_collections::ArrayHashMap;
use bun_core::{Timespec, TimespecMockMode};
use bun_io::heap::HeapNode as _;
use bun_jsc::JsCell;
use bun_jsc::virtual_machine::{CancelHotRunTimers, VirtualMachine};
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;
#[cfg(windows)]
use bun_sys::windows::libuv as uv;
use bun_threading::Guarded;
use core::cell::{Cell, UnsafeCell};
use std::rc::Rc;

pub(crate) use bun_event_loop::EventLoopTimer::{
    Clock, EventLoopTimer, OwnedTimer, State as EventLoopTimerState, Tag as EventLoopTimerTag,
};

use crate::jsc_hooks::timer_all;
use crate::node::histogram::Interval;

#[path = "Timer.rs"]
pub(crate) mod timer;

#[path = "TimeoutObject.rs"]
mod timeout_object;
pub(crate) use timeout_object::TimeoutObject;

#[path = "ImmediateObject.rs"]
mod immediate_object;
pub(crate) use immediate_object::ImmediateObject;

mod js_timer;
pub(crate) use js_timer::call_catching;

#[path = "DateHeaderTimer.rs"]
mod date_header_timer_draft;

#[derive(Default)]
pub(crate) struct TimerHeap(bun_io::heap::Intrusive<EventLoopTimer>);

impl TimerHeap {
    #[inline]
    pub(crate) fn peek(&self) -> Option<*mut EventLoopTimer> {
        let r = self.0.peek();
        if r.is_null() { None } else { Some(r) }
    }

    /// # Safety
    /// `v` is a valid node not currently in any heap
    /// (its `IntrusiveField` links are null).
    #[inline]
    unsafe fn insert(&self, v: *const EventLoopTimer) {
        // SAFETY: forwarded — see fn contract.
        unsafe { self.0.insert(v.cast_mut()) };
    }

    /// # Safety
    /// `v` is a node currently in *this* heap.
    #[inline]
    unsafe fn remove(&self, v: *const EventLoopTimer) {
        // SAFETY: forwarded — see fn contract.
        unsafe { self.0.remove(v.cast_mut()) };
    }

    #[inline]
    pub(crate) fn delete_min(&self) -> Option<*mut EventLoopTimer> {
        // SAFETY: all reachable nodes were inserted via `insert()` and remain
        // live until popped (intrusive invariant maintained by `All`).
        unsafe {
            let min = self.0.delete_min();
            min.as_ref()?.state.set(EventLoopTimerState::FIRED);
            Some(min)
        }
    }

    /// For callers that unlink what they find, or go on to its owner.
    fn nodes(&self) -> Vec<*mut EventLoopTimer> {
        // SAFETY: a node is live while it is linked, and `collect` links none.
        unsafe { self.0.iter() }.collect()
    }

    fn iter(&self) -> impl Iterator<Item = &EventLoopTimer> {
        // SAFETY: a node is live while it is linked. Private: the methods below only read.
        unsafe { self.0.iter().map(|node| &*node) }
    }

    pub(crate) fn first_deadline(&self) -> Option<Timespec> {
        // SAFETY: `peek` returns a live heap node.
        self.peek().map(|first| unsafe { (*first).next.get() })
    }

    pub(crate) fn last_deadline(&self) -> Option<Timespec> {
        let last = self
            .iter()
            .reduce(|last, node| if last.less(node) { node } else { last });
        last.map(|last| last.next.get())
    }

    pub(crate) fn has_immediate(&self) -> bool {
        self.iter()
            .any(|node| node.tag == EventLoopTimerTag::ImmediateObject)
    }

    pub(crate) fn delete_first_immediate(&self) -> Option<*mut EventLoopTimer> {
        let first = self.first_immediate()?;
        // SAFETY: just found in this heap.
        unsafe {
            self.remove(first);
            (*first).state.set(EventLoopTimerState::FIRED);
        }
        Some(first)
    }

    /// Only a faked `setImmediate` puts an `ImmediateObject` in a heap.
    fn first_immediate(&self) -> Option<*mut EventLoopTimer> {
        // SAFETY: a node is live while it is linked, and this links none.
        unsafe {
            let is_immediate =
                |&node: &*mut EventLoopTimer| (*node).tag == EventLoopTimerTag::ImmediateObject;
            self.peek().filter(is_immediate).or_else(|| {
                let immediates = self.0.iter().filter(is_immediate);
                immediates.reduce(|first, node| if (*node).less(&*first) { node } else { first })
            })
        }
    }

    pub(crate) fn has_program_timer(&self) -> bool {
        self.iter().any(|node| !node.tag.is_housekeeping())
    }

    pub(crate) fn count(&self) -> usize {
        self.iter().count()
    }
}

pub(crate) use crate::test_runner::timers::fake_timers::FakeTimers;

pub(crate) struct DateHeaderTimer {
    pub(crate) event_loop_timer: EventLoopTimer,
}
impl Default for DateHeaderTimer {
    fn default() -> Self {
        Self {
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::DateHeaderTimer),
        }
    }
}
impl DateHeaderTimer {
    /// Refresh the cached `Date:` header and
    /// reschedule for 1s later iff there are active connections.
    pub(crate) fn run(&self, vm: &VirtualMachine) {
        let loop_ = vm.uws_loop();
        let now = Timespec::now(TimespecMockMode::ForceRealTime);

        // Record when we last ran it.
        self.event_loop_timer.next.set(now);

        // updateDate() is an expensive function.
        loop_.update_date();

        if loop_.should_enable_date_header_timer() {
            // Reschedule it automatically for 1 second later.
            self.event_loop_timer.next.set(now.add_ms(1000));
            timer_all().insert(&raw const self.event_loop_timer);
        }
    }
}

/// Samples the event loop for every enabled `monitorEventLoopDelay()` histogram of this thread, with one timer.
pub(crate) struct EventLoopDelayMonitor {
    enabled: UnsafeCell<Vec<EnabledInterval>>,
    pub(crate) event_loop_timer: EventLoopTimer,
}

struct EnabledInterval {
    /// Weak, so a histogram that is collected while enabled stops being sampled. It holds no JS value.
    interval: std::rc::Weak<Interval>,
    next: Timespec,
}

impl Default for EventLoopDelayMonitor {
    fn default() -> Self {
        Self {
            enabled: UnsafeCell::default(),
            event_loop_timer: EventLoopTimer::init_paused(EventLoopTimerTag::EventLoopDelayMonitor),
        }
    }
}

impl EventLoopDelayMonitor {
    pub(crate) fn enable(&self, interval: &Rc<Interval>) {
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        // SAFETY: JS thread; the borrow ends at this statement, which runs no JS.
        unsafe { &mut *self.enabled.get() }.push(EnabledInterval {
            interval: Rc::downgrade(interval),
            next: now.add_ms(i64::from(interval.resolution_ms)),
        });
        self.schedule();
    }

    pub(crate) fn disable(&self, interval: &Rc<Interval>) {
        // SAFETY: as `enable`.
        unsafe { &mut *self.enabled.get() }
            .retain(|enabled| !core::ptr::eq(enabled.interval.as_ptr(), Rc::as_ptr(interval)));
        self.schedule();
    }

    pub(crate) fn disable_all(&self) {
        // SAFETY: as `enable`.
        unsafe { &mut *self.enabled.get() }.clear();
        self.schedule();
    }

    pub(crate) fn on_fire(&self, now: &Timespec, vm: &VirtualMachine) {
        let mut allocated = 0;
        // SAFETY: as `enable`.
        unsafe { &mut *self.enabled.get() }.retain_mut(|enabled| {
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
        self.schedule();
        if allocated > 0 {
            // This can collect, so it comes last.
            vm.jsc_vm()
                .report_extra_memory_allocated(bun_jsc::JSValue::UNDEFINED, allocated);
        }
    }

    /// Arms the timer for the interval that is due first.
    fn schedule(&self) {
        // SAFETY: JS thread; `min_by` is the last use.
        let enabled = unsafe { &*self.enabled.get() };
        let next = enabled.iter().map(|enabled| enabled.next);
        if let Some(next) = next.min_by(Timespec::order) {
            timer_all().update(&raw const self.event_loop_timer, &next);
        } else {
            self.event_loop_timer.disarm();
        }
    }
}

pub(crate) use crate::jsc::abort_signal::Timeout as AbortSignalTimeout;

/// Ends a timer that script set, without running it. Runs no JS, and frees nothing but its owner.
///
/// SAFETY: `node` is the node of a live `ScriptTimer`.
pub(crate) unsafe fn discard_js_timer(node: *const EventLoopTimer) {
    // SAFETY: fn contract; the tag names the owner.
    unsafe {
        match (*node).tag {
            EventLoopTimerTag::TimeoutObject => (*TimeoutObject::from_timer_ptr(node)).cancel(),
            EventLoopTimerTag::ImmediateObject => (*ImmediateObject::from_timer_ptr(node)).cancel(),
            EventLoopTimerTag::AbortSignalTimeout => {
                AbortSignalTimeout::discard(AbortSignalTimeout::from_timer_ptr(node))
            }
            tag => debug_assert!(false, "{} has no release path", <&'static str>::from(tag)),
        }
    }
}

/// A timer created by WTF code and invoked by Bun's event loop.
#[path = "WTFTimer.rs"]
pub(crate) mod wtf_timer;
pub(crate) use wtf_timer::WTFTimer;

/// Timers fire JavaScript that schedules and clears timers, so this is only ever shared.
pub(crate) struct All {
    /// Id of the next timer. Allocate ids with [`All::next_id`].
    pub(crate) last_id: Cell<u64>,
    /// `last_id` at the latest `--hot` reload.
    first_id_of_hot_run: Cell<u64>,
    pub(crate) thread_id: std::thread::ThreadId,
    pub(crate) timers: TimerHeap,
    pub(crate) active_timer_count: Cell<i32>,
    #[cfg(windows)]
    uv_timer: UnsafeCell<uv::Timer>,
    /// Whether we have emitted a warning for passing a negative timeout duration
    pub(crate) warned_negative_number: Cell<bool>,
    /// Whether we have emitted a warning for passing NaN for the timeout duration
    pub(crate) warned_not_number: Cell<bool>,
    /// `bun test`: see `EventLoopTimer::is_due_when_idle`. Testing Library and user-event await a `setTimeout()`
    /// without a delay after every step.
    pub(crate) zero_delay_is_due_when_idle: Cell<bool>,
    /// The latest `EventLoopTimer::epoch`.
    epoch: Cell<u32>,
    pub(crate) immediate_ref_count: Cell<i32>,
    #[cfg(windows)]
    uv_idle: UnsafeCell<uv::uv_idle_t>,
    pub(crate) event_loop_delay: EventLoopDelayMonitor,
    pub(crate) fake_timers: FakeTimers,
    /// The timers whose id script has read.
    ids: JsCell<ArrayHashMap<u64, *const TimeoutObject>>,
    pub(crate) date_header_timer: DateHeaderTimer,
    pub(crate) wtf_timers: Guarded<TimerHeap>,
}

impl All {
    pub(crate) fn init() -> Self {
        Self {
            last_id: Cell::new(1),
            first_id_of_hot_run: Cell::new(0),
            thread_id: std::thread::current().id(),
            timers: TimerHeap::default(),
            active_timer_count: Cell::new(0),
            #[cfg(windows)]
            uv_timer: UnsafeCell::new(bun_core::ffi::zeroed()),
            warned_negative_number: Cell::new(false),
            warned_not_number: Cell::new(false),
            zero_delay_is_due_when_idle: Cell::new(false),
            epoch: Cell::new(0),
            immediate_ref_count: Cell::new(0),
            #[cfg(windows)]
            uv_idle: UnsafeCell::new(bun_core::ffi::zeroed()),
            event_loop_delay: EventLoopDelayMonitor::default(),
            fake_timers: FakeTimers::default(),
            ids: JsCell::default(),
            date_header_timer: DateHeaderTimer::default(),
            wtf_timers: Guarded::init(TimerHeap::default()),
        }
    }

    /// Returns a new timer id. Ids are positive and never repeat, because a 64-bit counter won't wrap.
    #[inline]
    pub(crate) fn next_id(&self) -> u64 {
        let id = self.last_id.get();
        self.last_id.set(id.wrapping_add(1));
        id
    }

    #[inline]
    fn assert_js_thread(&self) {
        debug_assert!(
            self.thread_id == std::thread::current().id(),
            "timer::All: non-WTF timers may only be touched on the owning JS thread",
        );
    }

    pub(crate) fn insert(&self, timer: *const EventLoopTimer) {
        self.assert_js_thread();
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        let node = unsafe { &*timer };
        debug_assert!(node.tag != EventLoopTimerTag::WTFTimer, "use wtf_arm");

        self.epoch.update(|epoch| epoch.wrapping_add(1));
        node.epoch.set(self.epoch.get());

        // Every other timer stays on the clock it was made for.
        if node.tag == EventLoopTimerTag::CronJob {
            node.clock.set(self.fake_timers.set_timeout_clock());
        }
        if node.clock.get() == Clock::Fake {
            // SAFETY: see fn contract
            unsafe { self.fake_timers.timers.insert(timer) };
            node.state.set(EventLoopTimerState::ACTIVE);
            self.fake_timers.post_auto_step();
        } else {
            // SAFETY: see fn contract
            unsafe { self.timers.insert(timer) };
            node.state.set(EventLoopTimerState::ACTIVE);
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
        // SAFETY: JS thread only, and neither `stop` nor `close` runs a callback.
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
    fn ensure_uv_timer(&self) {
        // `vm` here means the OWNING VM (the one this timer is embedded in),
        // not the calling thread's. Guard the TLS fallback so a cross-thread
        // caller fails loudly instead of silently arming a fresh `uv_loop_t`
        // on the wrong thread.
        debug_assert!(
            self.thread_id == std::thread::current().id(),
            "ensure_uv_timer: called off the owning JS thread; TLS loop/VM would diverge from vm.event_loop_handle",
        );
        // SAFETY: JS thread only, and nothing below runs a callback.
        let uv_timer = unsafe { &mut *self.uv_timer.get() };
        if uv_timer.data.is_null() {
            uv_timer.init(uv::Loop::get());
            uv_timer.data = VirtualMachine::get_mut_ptr().cast::<core::ffi::c_void>();
            uv_timer.unref();
        }
        debug_assert!(
            !uv_timer.is_closing(),
            "timer scheduled after teardown closed the heap's uv timer"
        );

        let reg_next = self.timers.first_deadline();
        let wtf_next = self.wtf_timers.lock().first_deadline();
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
        let wait_ms = if self.is_due_when_idle() {
            0
        } else {
            core::cmp::max(1, wait.ms_unsigned())
        };

        // SAFETY: `uv_timer_init` ran above; the handle is live.
        let due_in = unsafe { uv::uv_timer_get_due_in(uv_timer) };
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
    /// timers then re-arm for the next deadline. Only ever invoked by libuv
    /// (coerces to the `uv_timer_cb` fn-pointer type at the `Timer::start`
    /// call site); body wraps its derefs explicitly.
    #[cfg(windows)]
    extern "C" fn on_uv_timer(uv_timer_t: *mut uv::Timer) {
        // SAFETY: `uv_timer_t` is the address of `All.uv_timer` (libuv passes
        // back exactly the handle pointer we registered in `ensure_uv_timer`);
        // recover the containing `All` via container_of. It is live for the VM lifetime.
        let all = unsafe { &*bun_core::from_field_ptr!(All, uv_timer, uv_timer_t) };
        // SAFETY: `data` was set to the VM ptr in `ensure_uv_timer` (non-null).
        let vm = unsafe { &*(*uv_timer_t).data.cast::<VirtualMachine>() };
        all.drain_timers(vm);
        all.ensure_uv_timer();
    }

    pub(crate) fn remove(&self, timer: &EventLoopTimer) {
        self.assert_js_thread();
        if timer.state.get() != EventLoopTimerState::ACTIVE {
            return;
        }
        match timer.clock.get() {
            // SAFETY: linked, in the heap of its clock.
            Clock::Real => unsafe { self.timers.remove(timer) },
            // SAFETY: as above.
            Clock::Fake => unsafe { self.fake_timers.timers.remove(timer) },
        }
        timer.state.set(EventLoopTimerState::CANCELLED);
    }

    /// Remove the EventLoopTimer if necessary, then re-insert at `time`.
    ///
    /// SAFETY: `timer` is live, with the provenance of the owner that its tag names.
    pub(crate) fn update(&self, timer: *const EventLoopTimer, time: &Timespec) {
        self.assert_js_thread();
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        let node = unsafe { &*timer };
        self.remove(node);
        node.next.set(*time);
        self.insert(timer);
    }

    fn wtf_arm(&self, timer: *const EventLoopTimer, time: &Timespec) {
        // SAFETY: caller guarantees `timer` is a valid live EventLoopTimer.
        let node = unsafe { &*timer };
        debug_assert!(node.tag == EventLoopTimerTag::WTFTimer);
        {
            let wtf = self.wtf_timers.lock();
            // SAFETY: `timer` is live; its state and heap links only change under this guard.
            unsafe {
                if node.state.get() == EventLoopTimerState::ACTIVE {
                    wtf.remove(timer);
                }
                node.next.set(*time);
                wtf.insert(timer);
            }
            node.state.set(EventLoopTimerState::ACTIVE);
        }
        #[cfg(windows)]
        if self.thread_id == std::thread::current().id() {
            self.ensure_uv_timer();
        }
    }

    fn wtf_disarm(&self, timer: &EventLoopTimer) {
        debug_assert!(timer.tag == EventLoopTimerTag::WTFTimer);
        let wtf = self.wtf_timers.lock();
        if timer.state.get() == EventLoopTimerState::ACTIVE {
            // SAFETY: its state and heap links only change under this guard.
            unsafe { wtf.remove(timer) };
            timer.state.set(EventLoopTimerState::CANCELLED);
        }
    }

    fn drain_due_wtf_timers(
        &self,
        maybe_now: &mut Option<Timespec>,
        vm: &VirtualMachine,
    ) -> Option<Timespec> {
        loop {
            let (min, now) = {
                let wtf = self.wtf_timers.lock();
                let min = wtf.peek()?;
                // SAFETY: `peek` returned a live heap node.
                let min_next = unsafe { (*min).next.get() };
                let now = *maybe_now
                    .get_or_insert_with(|| Timespec::now(TimespecMockMode::ForceRealTime));
                if min_next.greater(&now) {
                    return Some(min_next);
                }
                (wtf.delete_min()?, now)
            };
            // SAFETY: `min` is live; the guard is not held here.
            let fired = unsafe { crate::dispatch::fire_timer(min, &now, vm) };
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

        let reg_next = self.timers.first_deadline();

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
        if next.greater(&now) && !self.is_due_when_idle() {
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

    /// Whether the first timer does not wait for its deadline. See `EventLoopTimer::is_due_when_idle`.
    fn is_due_when_idle(&self) -> bool {
        self.timers.peek().is_some_and(|first| {
            // SAFETY: `peek` returns a live heap node.
            unsafe { (*first).is_due_when_idle.get() }
        })
    }

    /// Pop the next due timer. `now` is filled lazily on first call so we
    /// don't pay for `clock_gettime` when the heap is empty.
    fn next(&self, has_set_now: &mut bool, now: &mut Timespec) -> Option<*mut EventLoopTimer> {
        // SAFETY: peek returns a live heap node
        let first = unsafe { &*self.timers.peek()? };
        if !*has_set_now {
            // Real clock: this heap is the opt-out-of-fake-timers set.
            *now = Timespec::now(TimespecMockMode::ForceRealTime);
            *has_set_now = true;
            // What this drain's callbacks set is due later than this, so it waits for the next turn of the event loop.
            if first.is_due_when_idle.get() && first.next.get().greater(now) {
                *now = first.next.get();
            }
        }
        if first.next.get().greater(now) {
            return None;
        }
        self.timers.delete_min()
    }

    pub(crate) fn drain_timers(&self, vm: &VirtualMachine) {
        let mut wtf_now: Option<Timespec> = None;
        let _ = self.drain_due_wtf_timers(&mut wtf_now, vm);

        let mut now = Timespec { sec: 0, nsec: 0 };
        let mut has_set_now = false;
        while let Some(t) = self.next(&mut has_set_now, &mut now) {
            // SAFETY: `t` was just popped from the intrusive heap and is live.
            let fired = unsafe { crate::dispatch::fire_timer(t, &now, vm) };
            if fold_timer(vm, fired).is_err() {
                break;
            }
        }
    }

    /// `uws_loop` is the calling VM's uws loop.
    fn increment_immediate_ref(&self, delta: i32, uws_loop: &bun_uws_sys::Loop) {
        let old = self.immediate_ref_count.get();
        let new = old + delta;
        self.immediate_ref_count.set(new);
        // SAFETY: JS thread only, and nothing below runs a callback.
        #[cfg(windows)]
        let uv_idle = unsafe { &mut *self.uv_idle.get() };
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            uws_loop.ref_();
            #[cfg(windows)]
            {
                // Lazy-init the idle handle and start
                // it with a no-op callback so `uv_run` does not block in poll
                // while immediates are pending (matches Node.js).
                if uv_idle.data.is_null() {
                    uv_idle.init(uv::Loop::get());
                    // Note: `data` is only used as a
                    // non-null "initialized" sentinel — never dereferenced.
                    uv_idle.data = VirtualMachine::get_mut_ptr().cast::<core::ffi::c_void>();
                }
                uv_idle.start(Some(Self::on_uv_idle_noop));
            }
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            uws_loop.unref();
            #[cfg(windows)]
            if !uv_idle.data.is_null() {
                uv_idle.stop();
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

    /// `uws_loop` is the calling VM's uws loop.
    pub(crate) fn increment_timer_ref(&self, delta: i32, uws_loop: &bun_uws_sys::Loop) {
        let old = self.active_timer_count.get();
        let new = old + delta;
        debug_assert!(new >= 0);
        self.active_timer_count.set(new);
        // SAFETY: JS thread only, and nothing below runs a callback.
        #[cfg(windows)]
        let uv_timer = unsafe { &mut *self.uv_timer.get() };
        if old <= 0 && new > 0 {
            #[cfg(not(windows))]
            uws_loop.ref_();
            // `uv_timer.ref()` is intentionally unconditional (no `data !=
            // null` guard). Invariant: every path that reaches a positive
            // `active_timer_count` first inserts a timer, and `insert`
            // → `ensure_uv_timer` lazily `uv_timer_init`s the handle. Guarding
            // here would silently drop the ref and let the loop exit early.
            #[cfg(windows)]
            uv_timer.ref_();
        } else if old > 0 && new <= 0 {
            #[cfg(not(windows))]
            uws_loop.unref();
            #[cfg(windows)]
            uv_timer.unref();
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
    /// JS thread; never on a VM that keeps running.
    pub(crate) unsafe fn disarm_all_for_vm_teardown(&self) {
        for node in self.linked_nodes() {
            // SAFETY: linked when collected, and `remove` frees nothing.
            self.remove(unsafe { &*node });
        }
    }

    fn linked_nodes(&self) -> impl Iterator<Item = *mut EventLoopTimer> {
        let (real, fake) = (self.timers.nodes(), self.fake_timers.timers.nodes());
        real.into_iter().chain(fake)
    }

    /// Every timer that script set, at VM teardown and at the `--isolate` file swap. Releases `Strong`s, so it runs while the JSC heap is alive.
    pub(crate) fn cancel_all_timeout_objects(&self) {
        for node in self.linked_nodes() {
            // SAFETY: linked when collected, and a discard frees no node but its own.
            unsafe {
                if (*node).tag.is_js_timer() {
                    discard_js_timer(node);
                }
            }
        }
    }

    /// See `RuntimeHooks::end_hot_run_timers`.
    pub(crate) fn end_hot_run(&self, vm: &VirtualMachine, cancel: CancelHotRunTimers) {
        let first_id = self.first_id_of_hot_run.replace(self.last_id.get());
        if cancel == CancelHotRunTimers::None {
            return;
        }
        let all = cancel == CancelHotRunTimers::All;
        for node in self.linked_nodes() {
            // SAFETY: as in `cancel_all_timeout_objects`; the tag names the owner.
            unsafe {
                let is_cancelled = match (*node).tag {
                    EventLoopTimerTag::TimeoutObject => {
                        let timeout = &*TimeoutObject::from_timer_ptr(node);
                        timeout.id >= first_id && (all || timeout.repeats())
                    }
                    EventLoopTimerTag::ImmediateObject => {
                        all && (*ImmediateObject::from_timer_ptr(node)).id >= first_id
                    }
                    EventLoopTimerTag::AbortSignalTimeout => {
                        let timeout = &*AbortSignalTimeout::from_timer_ptr(node);
                        all && timeout.hot_reload_counter == vm.hot_reload_counter.get()
                    }
                    _ => false,
                };
                if is_cancelled {
                    discard_js_timer(node);
                }
            }
        }
    }
}

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

const US_PER_S: i64 = bun_core::time::US_PER_S as i64;
const NS_PER_US: i64 = bun_core::time::NS_PER_US as i64;

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
