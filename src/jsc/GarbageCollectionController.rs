//! Garbage Collection Controller for Bun's JavaScript runtime
//!
//! This controller intelligently schedules garbage collection to run at optimal times,
//! such as when HTTP requests complete, during idle periods, or when memory usage
//! has grown significantly since the last collection cycle.
//!
//! The controller works in conjunction with JavaScriptCore's built-in GC timers to
//! provide additional collection opportunities, particularly in scenarios where:
//! - JavaScript code is not actively executing (e.g., waiting for I/O)
//! - The event loop is idle but memory usage has increased
//! - Long-running operations have allocated significant memory
//!
//! Key features:
//! - Adaptive timing based on heap growth patterns
//! - Configurable intervals via BUN_GC_TIMER_INTERVAL environment variable
//! - Can be disabled via BUN_GC_TIMER_DISABLE for debugging/testing
//!
//! Thread Safety: This type must be unique per JavaScript thread and is not
//! thread-safe. Each VirtualMachine instance should have its own controller.
//!
//! The two timers are scheduled differently per platform. On epoll/kqueue they
//! are intrusive nodes on the per-VM timer heap, because a `us_timer_t` there
//! costs a file descriptor (timerfd) or a pair of kevent64 syscalls per arm. On
//! libuv a `us_timer_t` is just a `uv_timer_t` — neither — and putting them on
//! the heap instead routes every GC arm through `All::ensure_uv_timer`, which
//! restarts the event loop's single shared `uv_timer` and starves JS timers
//! that are already due (`test-timers-immediate-queue`).

use core::ffi::c_int;

#[cfg(not(windows))]
use bun_core::{Timespec, TimespecMockMode};
#[cfg(not(windows))]
use bun_event_loop::EventLoopTimer::{EventLoopTimer, State as TimerState, Tag as TimerTag};
use bun_uws as uws;

use crate::VM;
use crate::virtual_machine::VirtualMachine;

/// Interval of the repeating timer once the heap has been stable for 30 ticks.
const SLOW_REPEAT_INTERVAL_MS: i32 = 30_000;
/// Delay of the one-shot "collect on the next tick" nudge.
const ONE_SHOT_INTERVAL_MS: i32 = 16;

pub struct GarbageCollectionController {
    /// One-shot: when it fires, the next `process_gc_timer()` will
    /// `collect_async()`.
    #[cfg(not(windows))]
    pub gc_timer: EventLoopTimer,
    /// Repeating: drives `perform_gc()` and the fast↔slow backoff.
    #[cfg(not(windows))]
    pub gc_repeating_timer: EventLoopTimer,
    // Raw FFI handles created by `uws::Timer::create_fallthrough` in `init`,
    // freed in Drop. Stored as `Option<NonNull<Timer>>` (None = uninit).
    #[cfg(windows)]
    pub gc_timer: Option<core::ptr::NonNull<uws::Timer>>,
    #[cfg(windows)]
    pub gc_repeating_timer: Option<core::ptr::NonNull<uws::Timer>>,
    pub gc_last_heap_size: usize,
    pub gc_last_heap_size_on_repeating_timer: usize,
    pub heap_size_didnt_change_for_repeating_timer_ticks_count: u8,
    pub gc_timer_state: GCTimerState,
    pub gc_timer_interval: i32,
    pub gc_repeating_timer_fast: bool,
    pub disabled: bool,
}

#[cfg(not(windows))]
bun_event_loop::impl_timer_owner!(
    GarbageCollectionController;
    from_gc_timer_ptr => gc_timer,
    from_gc_repeating_timer_ptr => gc_repeating_timer,
);

impl Default for GarbageCollectionController {
    fn default() -> Self {
        Self {
            #[cfg(not(windows))]
            gc_timer: EventLoopTimer::init_paused(TimerTag::GcOneShot),
            #[cfg(not(windows))]
            gc_repeating_timer: EventLoopTimer::init_paused(TimerTag::GcRepeating),
            #[cfg(windows)]
            gc_timer: None,
            #[cfg(windows)]
            gc_repeating_timer: None,
            gc_last_heap_size: 0,
            gc_last_heap_size_on_repeating_timer: 0,
            heap_size_didnt_change_for_repeating_timer_ticks_count: 0,
            gc_timer_state: GCTimerState::Pending,
            gc_timer_interval: 0,
            gc_repeating_timer_fast: true,
            disabled: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GcRepeatSetting {
    Fast,
    Slow,
}

// ── scheduling backend: epoll/kqueue (the per-VM timer heap) ─────────────────
#[cfg(not(windows))]
impl GarbageCollectionController {
    /// Remove `t` from the heap if linked, set its deadline to `now + ms`, and
    /// insert. JS-thread only.
    ///
    /// Real time, never the mocked clock: GC pacing is ours, not the test's.
    /// `jest.useFakeTimers()` starts its clock at zero, so a mocked deadline
    /// would let `advanceTimersByTime()` drive collection. Same as `WTFTimer`.
    fn arm(vm: *mut VirtualMachine, t: *mut EventLoopTimer, ms: i32) {
        // SAFETY: `t` is one of the two embedded nodes of the per-VM controller,
        // address-stable for the VM lifetime; JS-thread only. `timer_remove` /
        // `timer_insert` re-deref `t` per-field, so no `&mut *t` is held here.
        unsafe {
            if (*t).state == TimerState::ACTIVE {
                VirtualMachine::timer_remove(vm, t);
            }
            (*t).next = Timespec::now(TimespecMockMode::ForceRealTime).add_ms(i64::from(ms));
            VirtualMachine::timer_insert(vm, t);
        }
    }

    /// Nothing to allocate: both nodes are embedded fields.
    fn create_timers(&mut self) {}

    fn arm_one_shot(&mut self) {
        Self::arm(
            VirtualMachine::get_mut_ptr(),
            &raw mut self.gc_timer,
            ONE_SHOT_INTERVAL_MS,
        );
    }

    /// Re-arm the repeating timer at a new interval. A no-op when called from
    /// inside `on_gc_repeating_timer` — the node has just been popped (state
    /// `FIRED`) and the callback's tail re-inserts it at the new interval.
    fn rearm_repeating(&mut self, ms: i32) {
        if self.gc_repeating_timer.state == TimerState::ACTIVE {
            Self::arm(
                VirtualMachine::get_mut_ptr(),
                &raw mut self.gc_repeating_timer,
                ms,
            );
        }
    }

    /// Arm the repeating timer on the first event-loop tick rather than in
    /// `init()`, so the heap is never touched before the event loop is wired.
    fn ensure_repeating_armed(&mut self) {
        if self.gc_repeating_timer.state == TimerState::PENDING {
            let interval = self.repeat_interval();
            Self::arm(
                VirtualMachine::get_mut_ptr(),
                &raw mut self.gc_repeating_timer,
                interval,
            );
        }
    }

    /// Unlink both nodes from the per-VM heap.
    ///
    /// Must run while that heap is still intact, i.e. BEFORE JSC teardown:
    /// `~RunLoop::Timer` unlinks and frees the `WTFTimer` nodes sharing it, so
    /// an unlink afterwards walks freed siblings. Both callers (`global_exit`,
    /// `web_worker`) do it next to `cancel_all_timers`.
    fn unschedule(&mut self) {
        // A `Drop` that runs after the VM left its thread-local slot has no heap
        // left to unlink from — and the nodes die with the VM anyway.
        let Some(vm) = VirtualMachine::get_or_null() else {
            return;
        };
        for t in [&raw mut self.gc_timer, &raw mut self.gc_repeating_timer] {
            // SAFETY: JS-thread; nodes are linked iff state == ACTIVE, and
            // `timer_remove` leaves them CANCELLED so a second call is a no-op.
            unsafe {
                if (*t).state == TimerState::ACTIVE {
                    VirtualMachine::timer_remove(vm, t);
                }
            }
        }
    }

    /// `Tag::GcOneShot` fire body.
    ///
    /// # Safety
    /// `this` is the live per-VM controller; JS-thread only.
    pub unsafe fn on_gc_timer(this: *mut Self) {
        // SAFETY: per fn contract.
        let this = unsafe { &mut *this };
        this.gc_timer.state = TimerState::FIRED;
        this.on_one_shot_fired();
    }

    /// `Tag::GcRepeating` fire body.
    ///
    /// # Safety
    /// `this` is the live per-VM controller; `vm` is the per-thread VM.
    pub unsafe fn on_gc_repeating_timer(this: *mut Self, vm: *mut VirtualMachine) {
        {
            // SAFETY: per fn contract — `this` is live; this borrow ends before
            // the re-entrant `arm()` below.
            let me = unsafe { &mut *this };
            me.gc_repeating_timer.state = TimerState::FIRED;
            if me.disabled {
                return;
            }
            me.on_repeating_fired();
        }
        // `rearm_repeating` only fires across a Fast↔Slow transition and skips
        // the popped node anyway, so the steady-state tick re-arms here.
        // SAFETY: per fn contract.
        unsafe {
            let interval = (*this).repeat_interval();
            Self::arm(vm, &raw mut (*this).gc_repeating_timer, interval);
        }
    }
}

// ── scheduling backend: libuv (a us_timer_t is a uv_timer_t) ─────────────────
#[cfg(windows)]
impl GarbageCollectionController {
    /// Recover `&mut Self` from a uws timer's ext slot. Single audited deref
    /// for the two `extern "C"` callbacks below so they stay safe-bodied.
    ///
    /// `timer` is the live uws timer whose ext data was set to
    /// `*mut GarbageCollectionController` in [`Self::init`]; the controller is
    /// a BACKREF that strictly outlives the timer (`deinit()` closes the timer
    /// before `self` is dropped).
    #[inline]
    fn from_timer_ext<'a>(timer: *mut uws::Timer) -> &'a mut Self {
        let ptr = uws::Timer::opaque_mut(timer).as_::<*mut Self>();
        // SAFETY: BACKREF — see doc comment above.
        unsafe { &mut *ptr }
    }

    /// Accessor for the init-once `gc_timer` handle.
    #[inline]
    fn gc_timer_mut(&mut self) -> &mut uws::Timer {
        // SAFETY: `gc_timer` is set in `init()` (via `Timer::create_fallthrough`)
        // before any code path reaches a deref site, and remains a live FFI
        // handle until `deinit()` closes it. The Timer lives on the uws heap,
        // not inside `self`, so the returned `&mut` cannot alias `self`.
        unsafe { &mut *self.gc_timer.expect("gc_timer set in init()").as_ptr() }
    }

    /// Accessor for the init-once `gc_repeating_timer` handle.
    #[inline]
    fn gc_repeating_timer_mut(&mut self) -> &mut uws::Timer {
        // SAFETY: same invariant as `gc_timer_mut`.
        unsafe {
            &mut *self
                .gc_repeating_timer
                .expect("gc_repeating_timer set in init()")
                .as_ptr()
        }
    }

    fn create_timers(&mut self) {
        // SAFETY: uws::Loop::get() returns the live process-global loop.
        let actual = unsafe { &mut *uws::Loop::get() };
        self.gc_timer = Some(uws::Timer::create_fallthrough(
            actual,
            std::ptr::from_mut::<Self>(self),
        ));
        self.gc_repeating_timer = Some(uws::Timer::create_fallthrough(
            actual,
            std::ptr::from_mut::<Self>(self),
        ));
    }

    fn arm_one_shot(&mut self) {
        let ext = std::ptr::from_mut::<Self>(self);
        self.gc_timer_mut()
            .set(ext, Some(on_gc_timer), ONE_SHOT_INTERVAL_MS, 0);
    }

    fn rearm_repeating(&mut self, ms: i32) {
        let ext = std::ptr::from_mut::<Self>(self);
        self.gc_repeating_timer_mut()
            .set(ext, Some(on_gc_repeating_timer), ms, ms);
    }

    /// The uv_timer repeats on its own; `init()` arms it once.
    fn ensure_repeating_armed(&mut self) {}

    fn unschedule(&mut self) {
        // SAFETY: timers were created via uws::Timer::create_fallthrough; close::<true>
        // frees the fallthrough timer. `take()` ensures we close at most once.
        unsafe {
            if let Some(t) = self.gc_timer.take() {
                uws::Timer::close::<true>(t.as_ptr());
            }
            if let Some(t) = self.gc_repeating_timer.take() {
                uws::Timer::close::<true>(t.as_ptr());
            }
        }
    }
}

#[cfg(windows)]
pub(crate) extern "C" fn on_gc_timer(timer: *mut uws::Timer) {
    GarbageCollectionController::from_timer_ext(timer).on_one_shot_fired();
}

#[cfg(windows)]
pub(crate) extern "C" fn on_gc_repeating_timer(timer: *mut uws::Timer) {
    let this = GarbageCollectionController::from_timer_ext(timer);
    if this.disabled {
        return;
    }
    this.on_repeating_fired();
}

// ── platform-independent policy ─────────────────────────────────────────────
impl GarbageCollectionController {
    /// The interval the repeating timer currently runs at.
    #[inline]
    fn repeat_interval(&self) -> i32 {
        if self.gc_repeating_timer_fast {
            self.gc_timer_interval
        } else {
            SLOW_REPEAT_INTERVAL_MS
        }
    }

    pub fn init(&mut self, vm: &mut VirtualMachine) {
        // SAFETY: uws::Loop::get() returns the live process-global loop.
        let actual = unsafe { &mut *uws::Loop::get() };
        actual.internal_loop_data.jsc_vm = vm.jsc_vm.cast();

        self.create_timers();

        // `Transpiler::init` is deferred to the high-tier
        // `init_runtime_state` hook (which runs *after* `ensure_waker` →
        // this `init`), so `vm.transpiler.env` is still the zeroed null ptr
        // here on the main boot path. Fall back to defaults when null — these are debug/tuning
        // knobs (BUN_GC_TIMER_INTERVAL / BUN_GC_TIMER_DISABLE /
        // BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS) and the dot_env loader would
        // just be reading process env anyway.
        let env = vm.env_loader_opt();

        let mut gc_timer_interval: i32 = 1000;
        if let Some(timer) = env.and_then(|e| e.get(b"BUN_GC_TIMER_INTERVAL")) {
            if let Some(parsed) = bun_core::fmt::parse_decimal::<i32>(timer) {
                if parsed > 0 {
                    gc_timer_interval = parsed;
                }
            }
        }
        self.gc_timer_interval = gc_timer_interval;

        if let Some(val) = env.and_then(|e| e.get(b"BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS")) {
            if let Some(parsed) = bun_core::fmt::parse_decimal::<c_int>(val) {
                if parsed >= 0 {
                    crate::virtual_machine::Bun__defaultRemainingRunsUntilSkipReleaseAccess
                        .store(parsed, core::sync::atomic::Ordering::Relaxed);
                }
            }
        }

        self.disabled = env.is_some_and(|e| e.has(b"BUN_GC_TIMER_DISABLE"));

        // libuv arms here (the uv_timer repeats itself); the heap backend waits
        // for the first tick, see `ensure_repeating_armed`.
        #[cfg(windows)]
        if !self.disabled {
            self.rearm_repeating(gc_timer_interval);
        }
    }

    pub fn schedule_gc_timer(&mut self) {
        self.gc_timer_state = GCTimerState::Scheduled;
        self.arm_one_shot();
    }

    pub fn bun_vm(&mut self) -> &mut VirtualMachine {
        // S017: dropped `container_of` recovery — provenance of `&mut self`
        // (which only covers `vm.gc_controller`) cannot soundly widen to the
        // whole `VirtualMachine` under Stacked Borrows. Route through the
        // per-thread singleton instead (same pointer, full-allocation
        // provenance via `VirtualMachine::get_mut_ptr`).
        VirtualMachine::get().as_mut()
    }

    /// Explicit teardown. Idempotent — `Drop` forwards here. Callers
    /// (web_worker, the VM exit path) must run it before JSC teardown; see
    /// `unschedule`.
    pub fn deinit(&mut self) {
        // Terminal: nothing may re-arm the timers after they are torn down.
        self.disabled = true;
        self.unschedule();
    }

    // We want to always run GC once in awhile
    // But if you have a long-running instance of Bun, you don't want the
    // program constantly using CPU doing GC for no reason
    //
    // So we have two settings for this GC timer:
    //
    //    - Fast: GC runs every 1 second
    //    - Slow: GC runs every 30 seconds
    //
    // When the heap size is increasing, we always switch to fast mode
    // When the heap size has been the same or less for 30 seconds, we switch to slow mode
    pub fn update_gc_repeat_timer(&mut self, setting: GcRepeatSetting) {
        let want_fast = match setting {
            GcRepeatSetting::Fast if !self.gc_repeating_timer_fast => true,
            GcRepeatSetting::Slow if self.gc_repeating_timer_fast => false,
            _ => return,
        };
        self.gc_repeating_timer_fast = want_fast;
        self.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        let interval = self.repeat_interval();
        self.rearm_repeating(interval);
    }

    #[inline]
    pub fn process_gc_timer(&mut self) {
        if self.disabled {
            return;
        }
        self.ensure_repeating_armed();
        let vm = VirtualMachine::get().jsc_vm();
        self.process_gc_timer_with_heap_size(vm, vm.block_bytes_allocated());
    }

    fn process_gc_timer_with_heap_size(&mut self, vm: &VM, this_heap_size: usize) {
        let prev = self.gc_last_heap_size;

        match self.gc_timer_state {
            GCTimerState::RunOnNextTick => {
                // When memory usage is not stable, run the GC more.
                if this_heap_size != prev {
                    self.schedule_gc_timer();
                    self.update_gc_repeat_timer(GcRepeatSetting::Fast);
                } else {
                    self.gc_timer_state = GCTimerState::Pending;
                }
                vm.collect_async();
                self.gc_last_heap_size = this_heap_size;
            }
            GCTimerState::Pending => {
                if this_heap_size != prev {
                    self.update_gc_repeat_timer(GcRepeatSetting::Fast);

                    if this_heap_size > prev * 2 {
                        self.perform_gc();
                    } else {
                        self.schedule_gc_timer();
                    }
                }
            }
            GCTimerState::Scheduled => {
                if this_heap_size > prev * 2 {
                    self.update_gc_repeat_timer(GcRepeatSetting::Fast);
                    self.perform_gc();
                }
            }
        }
    }

    pub fn perform_gc(&mut self) {
        if self.disabled {
            return;
        }
        let vm = VirtualMachine::get().jsc_vm();
        vm.collect_async();
        self.gc_last_heap_size = vm.block_bytes_allocated();
    }

    /// Shared body of the one-shot timer's callback.
    fn on_one_shot_fired(&mut self) {
        if self.disabled {
            return;
        }
        self.gc_timer_state = GCTimerState::RunOnNextTick;
    }

    /// Shared body of the repeating timer's callback.
    fn on_repeating_fired(&mut self) {
        let prev_heap_size = self.gc_last_heap_size_on_repeating_timer;
        self.perform_gc();
        self.gc_last_heap_size_on_repeating_timer = self.gc_last_heap_size;
        if prev_heap_size == self.gc_last_heap_size_on_repeating_timer {
            self.heap_size_didnt_change_for_repeating_timer_ticks_count = self
                .heap_size_didnt_change_for_repeating_timer_ticks_count
                .saturating_add(1);
            if self.heap_size_didnt_change_for_repeating_timer_ticks_count >= 30 {
                // make the timer interval longer
                self.update_gc_repeat_timer(GcRepeatSetting::Slow);
            }
        } else {
            self.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
            self.update_gc_repeat_timer(GcRepeatSetting::Fast);
        }
    }
}

impl Drop for GarbageCollectionController {
    fn drop(&mut self) {
        self.deinit();
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GCTimerState {
    Pending,
    Scheduled,
    RunOnNextTick,
}
