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
use bun_event_loop::EventLoopTimer::{EventLoopTimer, State as TimerState, Tag as TimerTag};
use bun_uws as uws;

use crate::VM;
use crate::virtual_machine::VirtualMachine;

const SLOW_REPEAT_INTERVAL_MS: i32 = 30_000;

pub struct GarbageCollectionController {
    pub gc_timer: EventLoopTimer,
    pub gc_repeating_timer: EventLoopTimer,
    pub(crate) gc_last_heap_size: usize,
    pub(crate) gc_last_heap_size_on_repeating_timer: usize,
    pub(crate) heap_size_didnt_change_for_repeating_timer_ticks_count: u8,
    pub(crate) gc_timer_state: GCTimerState,
    pub(crate) gc_timer_interval: i32,
    pub(crate) gc_repeating_timer_fast: bool,
    pub(crate) disabled: bool,
    /// A finished HTTP transaction wants the heap looked at; see `request_hint`.
    hint_pending: bool,
}

bun_event_loop::impl_timer_owner!(
    GarbageCollectionController;
    from_gc_timer_ptr => gc_timer,
    from_gc_repeating_timer_ptr => gc_repeating_timer,
);

impl Default for GarbageCollectionController {
    fn default() -> Self {
        Self {
            gc_timer: EventLoopTimer::init_paused(TimerTag::GcOneShot),
            gc_repeating_timer: EventLoopTimer::init_paused(TimerTag::GcRepeating),
            gc_last_heap_size: 0,
            gc_last_heap_size_on_repeating_timer: 0,
            heap_size_didnt_change_for_repeating_timer_ticks_count: 0,
            gc_timer_state: GCTimerState::Pending,
            gc_timer_interval: 0,
            gc_repeating_timer_fast: true,
            disabled: false,
            hint_pending: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GcRepeatSetting {
    Fast,
    Slow,
}

impl GarbageCollectionController {
    /// Remove `t` from the heap if linked, set its deadline to `now + ms`, and
    /// insert. JS-thread only. Real time, not the mocked clock: GC pacing is
    /// Bun's, not the test's.
    fn arm(vm: *mut VirtualMachine, t: *mut EventLoopTimer, ms: i32) {
        // SAFETY: `t` is one of the two embedded nodes of the per-VM controller,
        // address-stable for the VM lifetime; JS-thread only.
        unsafe {
            if (*t).state == TimerState::ACTIVE {
                VirtualMachine::timer_remove(vm, t);
            }
            (*t).next = Timespec::now(TimespecMockMode::ForceRealTime).add_ms(i64::from(ms));
            VirtualMachine::timer_insert(vm, t);
        }
    }

    #[inline]
    fn repeat_interval(&self) -> i32 {
        if self.gc_repeating_timer_fast {
            self.gc_timer_interval
        } else {
            SLOW_REPEAT_INTERVAL_MS
        }
    }

    pub(crate) fn init(&mut self, vm: &mut VirtualMachine) {
        // SAFETY: uws::Loop::get() returns the live process-global loop.
        let actual = unsafe { &mut *uws::Loop::get() };
        actual.internal_loop_data.jsc_vm = vm.jsc_vm.cast();

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
    }

    /// A completed HTTP transaction asked us to look at the heap. We do not act here: the
    /// response's JS handling and its microtasks have not run yet, so the garbage does not
    /// exist to be measured. Acted on at the next event-loop park, by which point it does.
    pub(crate) fn request_hint(&mut self) {
        self.hint_pending = true;
    }

    /// Called just before the event loop blocks. Microtasks have drained by now.
    pub(crate) fn drain_pending_hint(&mut self) {
        if !self.hint_pending {
            return;
        }
        self.hint_pending = false;
        self.process_gc_timer();
    }

    pub(crate) fn schedule_gc_timer(&mut self) {
        self.gc_timer_state = GCTimerState::Scheduled;
        Self::arm(VirtualMachine::get_mut_ptr(), &raw mut self.gc_timer, 16);
    }

    pub fn bun_vm(&mut self) -> &mut VirtualMachine {
        VirtualMachine::get().as_mut()
    }

    /// Idempotent. Must run before JSC teardown: `~RunLoop::Timer` frees the
    /// `WTFTimer` nodes sharing the heap, so an unlink afterwards walks freed
    /// siblings.
    pub(crate) fn deinit(&mut self) {
        self.disabled = true;
        let Some(vm) = VirtualMachine::get_or_null() else {
            return;
        };
        for t in [&raw mut self.gc_timer, &raw mut self.gc_repeating_timer] {
            // SAFETY: JS-thread; nodes are linked iff state == ACTIVE.
            unsafe {
                if (*t).state == TimerState::ACTIVE {
                    VirtualMachine::timer_remove(vm, t);
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
    pub(crate) fn update_gc_repeat_timer(&mut self, setting: GcRepeatSetting) {
        let want_fast = match setting {
            GcRepeatSetting::Fast if !self.gc_repeating_timer_fast => true,
            GcRepeatSetting::Slow if self.gc_repeating_timer_fast => false,
            _ => return,
        };
        self.gc_repeating_timer_fast = want_fast;
        self.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        if self.gc_repeating_timer.state == TimerState::ACTIVE {
            let interval = self.repeat_interval();
            Self::arm(
                VirtualMachine::get_mut_ptr(),
                &raw mut self.gc_repeating_timer,
                interval,
            );
        }
    }

    #[inline]
    pub(crate) fn process_gc_timer(&mut self) {
        if self.disabled {
            return;
        }
        if self.gc_repeating_timer.state == TimerState::PENDING {
            let interval = self.repeat_interval();
            Self::arm(
                VirtualMachine::get_mut_ptr(),
                &raw mut self.gc_repeating_timer,
                interval,
            );
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

    pub(crate) fn perform_gc(&mut self) {
        if self.disabled {
            return;
        }
        let vm = VirtualMachine::get().jsc_vm();
        vm.collect_async();
        self.gc_last_heap_size = vm.block_bytes_allocated();
    }

    /// `Tag::GcOneShot` fire body.
    ///
    /// # Safety
    /// `this` is the live per-VM controller; JS-thread only.
    pub unsafe fn on_gc_timer(this: *mut Self) {
        // SAFETY: per fn contract.
        let this = unsafe { &mut *this };
        this.gc_timer.state = TimerState::FIRED;
        if this.disabled {
            return;
        }
        this.gc_timer_state = GCTimerState::RunOnNextTick;
    }

    /// `Tag::GcRepeating` fire body.
    ///
    /// # Safety
    /// `this` is the live per-VM controller; `vm` is the per-thread VM.
    pub unsafe fn on_gc_repeating_timer(this: *mut Self, vm: *mut VirtualMachine) {
        // SAFETY: per fn contract.
        let this = unsafe { &mut *this };
        this.gc_repeating_timer.state = TimerState::FIRED;
        if this.disabled {
            return;
        }
        let prev_heap_size = this.gc_last_heap_size_on_repeating_timer;
        this.perform_gc();
        this.gc_last_heap_size_on_repeating_timer = this.gc_last_heap_size;
        if prev_heap_size == this.gc_last_heap_size_on_repeating_timer {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = this
                .heap_size_didnt_change_for_repeating_timer_ticks_count
                .saturating_add(1);
            if this.heap_size_didnt_change_for_repeating_timer_ticks_count >= 30 {
                this.update_gc_repeat_timer(GcRepeatSetting::Slow);
            }
        } else {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
            this.update_gc_repeat_timer(GcRepeatSetting::Fast);
        }
        let interval = this.repeat_interval();
        Self::arm(vm, &raw mut this.gc_repeating_timer, interval);
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
