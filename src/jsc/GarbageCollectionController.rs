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

use core::ffi::c_int;

use bun_core::{Timespec, TimespecMockMode};
use bun_event_loop::EventLoopTimer::{
    EventLoopTimer, State as TimerState, Tag as TimerTag, Timespec as ElTimespec,
};
use bun_uws as uws;

use crate::VM;
use crate::virtual_machine::VirtualMachine;

/// Interval of the repeating timer once the heap has been stable for 30 ticks.
const SLOW_REPEAT_INTERVAL_MS: i32 = 30_000;

pub struct GarbageCollectionController {
    /// Intrusive node in the owning VM's timer heap (`Timer::All`). Embedded,
    /// never separately allocated; `bun_runtime::dispatch` recovers
    /// `*mut Self` from it via `container_of`. Neither timer keeps the event
    /// loop alive (both were fallthrough `us_timer_t`s before).
    pub gc_timer: EventLoopTimer,
    pub gc_last_heap_size: usize,
    pub gc_last_heap_size_on_repeating_timer: usize,
    pub heap_size_didnt_change_for_repeating_timer_ticks_count: u8,
    pub gc_timer_state: GCTimerState,
    pub gc_repeating_timer: EventLoopTimer,
    pub gc_timer_interval: i32,
    pub gc_repeating_timer_fast: bool,
    pub disabled: bool,
}

bun_event_loop::impl_timer_owner!(GarbageCollectionController;
    from_gc_timer_ptr => gc_timer,
    from_gc_repeating_timer_ptr => gc_repeating_timer,
);

impl Default for GarbageCollectionController {
    fn default() -> Self {
        Self {
            gc_timer: EventLoopTimer::init_paused(TimerTag::GCTimer),
            gc_last_heap_size: 0,
            gc_last_heap_size_on_repeating_timer: 0,
            heap_size_didnt_change_for_repeating_timer_ticks_count: 0,
            gc_timer_state: GCTimerState::Pending,
            gc_repeating_timer: EventLoopTimer::init_paused(TimerTag::GCRepeatingTimer),
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

impl GarbageCollectionController {
    /// (Re)arm `timer` for `ms` from now in `vm`'s timer heap.
    ///
    /// Deadlines follow the mocked clock because `All::next` compares against
    /// it: pinning them to real time would make every drain under a
    /// fast-forwarded `jest.useFakeTimers()` clock re-fire immediately.
    ///
    /// # Safety
    /// `vm` is the live VM owning this controller, with `runtime_state`
    /// installed; `timer` is one of the two `EventLoopTimer` slots embedded in
    /// that VM's `gc_controller` and is not otherwise borrowed here.
    unsafe fn schedule(vm: *mut VirtualMachine, timer: *mut EventLoopTimer, ms: i32) {
        let next = Timespec::now(TimespecMockMode::AllowMockedTime).add_ms(i64::from(ms));
        // SAFETY: per fn contract. `timer_remove`/`timer_insert` re-deref
        // `timer` per-field, so no `&mut *timer` may be live across them.
        unsafe {
            if (*timer).state == TimerState::ACTIVE {
                VirtualMachine::timer_remove(vm, timer);
            }
            (*timer).next = ElTimespec {
                sec: next.sec,
                nsec: next.nsec,
            };
            VirtualMachine::timer_insert(vm, timer);
        }
    }

    /// The interval the repeating timer currently re-arms itself with.
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

        // `init_runtime_state` (and with it `Timer::All`) has already run:
        // `VirtualMachine::init` calls it before `ensure_waker()`, which is
        // what gets us here. A null state means there is no high tier at all
        // (bun_jsc unit tests) and therefore no heap to schedule on.
        if !self.disabled && !vm.runtime_state.is_null() {
            let this: *mut Self = self;
            let vm: *mut VirtualMachine = vm;
            // SAFETY: the slot is an unaliased field of `*this`, which is
            // embedded in `*vm`; the heap is live (checked above).
            unsafe { Self::schedule(vm, &raw mut (*this).gc_repeating_timer, gc_timer_interval) };
        }
    }

    pub fn schedule_gc_timer(&mut self) {
        self.gc_timer_state = GCTimerState::Scheduled;
        let this: *mut Self = self;
        // SAFETY: JS-thread-only; the TLS VM is the one embedding `*this`, and
        // `gc_timer` is an unaliased field of it.
        unsafe { Self::schedule(VirtualMachine::get_mut_ptr(), &raw mut (*this).gc_timer, 16) };
    }

    pub fn bun_vm(&mut self) -> &mut VirtualMachine {
        // S017: dropped `container_of` recovery — provenance of `&mut self`
        // (which only covers `vm.gc_controller`) cannot soundly widen to the
        // whole `VirtualMachine` under Stacked Borrows. Route through the
        // per-thread singleton instead (same pointer, full-allocation
        // provenance via `VirtualMachine::get_mut_ptr`).
        VirtualMachine::get().as_mut()
    }

    /// Explicit teardown. Idempotent — `Drop` forwards here. Must run while
    /// the owning VM's `runtime_state` (and with it the timer heap) is still
    /// installed; both call sites (`web_worker`, the VM exit path) do.
    pub fn deinit(&mut self) {
        let Some(vm) = VirtualMachine::get_or_null() else {
            return;
        };
        // SAFETY: `get_or_null` returned the live per-thread VM.
        if unsafe { (*vm).runtime_state }.is_null() {
            return;
        }
        let this: *mut Self = self;
        // SAFETY: both slots are embedded fields of `*this`; `timer_remove`
        // leaves them CANCELLED, so a second call (`Drop` after an explicit
        // `deinit`) sees a non-ACTIVE state and does nothing.
        unsafe {
            for timer in [
                &raw mut (*this).gc_timer,
                &raw mut (*this).gc_repeating_timer,
            ] {
                if (*timer).state == TimerState::ACTIVE {
                    VirtualMachine::timer_remove(vm, timer);
                }
            }
        }
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
        match setting {
            GcRepeatSetting::Fast if !self.gc_repeating_timer_fast => {
                self.gc_repeating_timer_fast = true;
            }
            GcRepeatSetting::Slow if self.gc_repeating_timer_fast => {
                self.gc_repeating_timer_fast = false;
            }
            _ => return,
        }
        self.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        let interval = self.repeat_interval();
        let this: *mut Self = self;
        // SAFETY: see `schedule_gc_timer`.
        unsafe {
            Self::schedule(
                VirtualMachine::get_mut_ptr(),
                &raw mut (*this).gc_repeating_timer,
                interval,
            );
        }
    }

    #[inline]
    pub fn process_gc_timer(&mut self) {
        if self.disabled {
            return;
        }
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

    /// `EventLoopTimer::fire` dispatch arm for [`TimerTag::GCTimer`].
    ///
    /// # Safety
    /// `this` is the container of the `gc_timer` slot just popped from the
    /// timer heap: the live per-thread VM's `gc_controller`.
    pub unsafe fn on_gc_timer(this: *mut Self) {
        // SAFETY: per fn contract — `this` is live and unaliased here.
        let this = unsafe { &mut *this };
        this.gc_timer.state = TimerState::FIRED;
        if this.disabled {
            return;
        }
        this.gc_timer_state = GCTimerState::RunOnNextTick;
    }

    /// `EventLoopTimer::fire` dispatch arm for [`TimerTag::GCRepeatingTimer`].
    ///
    /// # Safety
    /// `this` is the container of the `gc_repeating_timer` slot just popped
    /// from `vm`'s timer heap: `vm`'s own `gc_controller`.
    pub unsafe fn on_gc_repeating_timer(this: *mut Self, vm: *mut VirtualMachine) {
        {
            // SAFETY: per fn contract — `this` is live; this borrow ends before
            // the re-entrant `schedule()` below.
            let me = unsafe { &mut *this };
            me.gc_repeating_timer.state = TimerState::FIRED;
            if me.disabled {
                return;
            }
            let prev_heap_size = me.gc_last_heap_size_on_repeating_timer;
            me.perform_gc();
            me.gc_last_heap_size_on_repeating_timer = me.gc_last_heap_size;
            if prev_heap_size == me.gc_last_heap_size_on_repeating_timer {
                me.heap_size_didnt_change_for_repeating_timer_ticks_count = me
                    .heap_size_didnt_change_for_repeating_timer_ticks_count
                    .saturating_add(1);
                if me.heap_size_didnt_change_for_repeating_timer_ticks_count >= 30 {
                    // make the timer interval longer
                    me.update_gc_repeat_timer(GcRepeatSetting::Slow);
                }
            } else {
                me.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
                me.update_gc_repeat_timer(GcRepeatSetting::Fast);
            }
        }
        // `update_gc_repeat_timer` only re-arms across a Fast↔Slow transition,
        // so the steady-state tick has to re-arm itself to keep repeating.
        // SAFETY: per fn contract; re-arming an already-ACTIVE node is a
        // remove+insert, which `schedule` handles.
        unsafe {
            let interval = (*this).repeat_interval();
            Self::schedule(vm, &raw mut (*this).gc_repeating_timer, interval);
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
