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

#[cfg(debug_assertions)]
use bun_core::env_var;
use bun_event_loop::EventLoopTimer::{EventLoopTimer, State as TimerState, Tag as TimerTag};
use bun_uws as uws;

use crate::VM;
use crate::virtual_machine::VirtualMachine;

pub struct GarbageCollectionController {
    /// 16ms one-shot: when it fires, the next `process_gc_timer()` will
    /// `collect_async()`. Embedded intrusive node — re-armed via the in-process
    /// timer heap (no `timerfd_settime`/`epoll_ctl` per re-arm).
    pub gc_timer: EventLoopTimer,
    /// 1s/30s repeating: drives `perform_gc()` and the fast↔slow backoff.
    pub gc_repeating_timer: EventLoopTimer,
    pub gc_last_heap_size: usize,
    pub gc_last_heap_size_on_repeating_timer: usize,
    pub heap_size_didnt_change_for_repeating_timer_ticks_count: u8,
    pub gc_timer_state: GCTimerState,
    pub gc_timer_interval: i32,
    pub gc_repeating_timer_fast: bool,
    pub disabled: bool,
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
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GcRepeatSetting {
    Fast,
    Slow,
}

impl GarbageCollectionController {
    pub fn init(&mut self, vm: &mut VirtualMachine) {
        // SAFETY: uws::Loop::get() returns the live process-global loop.
        let actual = unsafe { &mut *uws::Loop::get() };
        actual.internal_loop_data.jsc_vm = vm.jsc_vm.cast();

        #[cfg(debug_assertions)]
        {
            if env_var::BUN_TRACK_LAST_FN_NAME.get().unwrap_or(false) {
                vm.event_loop_mut().debug.track_last_fn_name = true;
            }
        }

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
    }

    /// Remove `t` from the heap if linked, set its deadline to `now + ms`, and
    /// insert. JS-thread only.
    fn arm(vm: *mut VirtualMachine, t: *mut EventLoopTimer, ms: i64) {
        // SAFETY: `t` is one of the two embedded nodes of the per-VM controller,
        // address-stable for the VM lifetime; JS-thread only.
        unsafe {
            if (*t).state == TimerState::ACTIVE {
                VirtualMachine::timer_remove(vm, t);
            }
            (*t).next = bun_core::Timespec::now_allow_mocked_time().add_ms(ms);
            VirtualMachine::timer_insert(vm, t);
        }
    }

    pub fn schedule_gc_timer(&mut self) {
        self.gc_timer_state = GCTimerState::Scheduled;
        Self::arm(VirtualMachine::get_mut_ptr(), &raw mut self.gc_timer, 16);
    }

    pub fn bun_vm(&mut self) -> &mut VirtualMachine {
        // S017: dropped `container_of` recovery — provenance of `&mut self`
        // (which only covers `vm.gc_controller`) cannot soundly widen to the
        // whole `VirtualMachine` under Stacked Borrows. Route through the
        // per-thread singleton instead (same pointer, full-allocation
        // provenance via `VirtualMachine::get_mut_ptr`).
        VirtualMachine::get().as_mut()
    }

    /// Explicit teardown. Idempotent — `Drop` forwards here.
    /// Kept as an inherent method because callers (web_worker, VM exit path)
    /// must unlink the timers from the per-VM heap before that heap is dropped
    /// in `deinit_runtime_state`.
    pub fn deinit(&mut self) {
        for t in [&raw mut self.gc_timer, &raw mut self.gc_repeating_timer] {
            // SAFETY: JS-thread; nodes are linked iff state == ACTIVE.
            unsafe {
                if (*t).state == TimerState::ACTIVE {
                    VirtualMachine::timer_remove(VirtualMachine::get_mut_ptr(), t);
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
        let (interval, want_fast) = match setting {
            GcRepeatSetting::Fast if !self.gc_repeating_timer_fast => {
                (i64::from(self.gc_timer_interval), true)
            }
            GcRepeatSetting::Slow if self.gc_repeating_timer_fast => (30_000, false),
            _ => return,
        };
        self.gc_repeating_timer_fast = want_fast;
        self.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        // When called from inside `on_gc_repeating_timer` the node has just
        // been popped (state set to FIRED at the top of the callback) — skip
        // the re-arm; the callback's tail re-inserts at the new interval.
        if self.gc_repeating_timer.state == TimerState::ACTIVE {
            Self::arm(
                VirtualMachine::get_mut_ptr(),
                &raw mut self.gc_repeating_timer,
                interval,
            );
        }
    }

    #[inline]
    pub fn process_gc_timer(&mut self) {
        if self.disabled {
            return;
        }
        // Lazy-arm the repeating timer on the first event-loop tick instead of
        // in `init()`, so the timer heap is never touched before the event loop
        // is fully wired (matters for Windows' `ensure_uv_timer`).
        if self.gc_repeating_timer.state == TimerState::PENDING {
            Self::arm(
                VirtualMachine::get_mut_ptr(),
                &raw mut self.gc_repeating_timer,
                i64::from(self.gc_timer_interval),
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

    pub fn perform_gc(&mut self) {
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

        let prev_heap_size = this.gc_last_heap_size_on_repeating_timer;
        this.perform_gc();
        this.gc_last_heap_size_on_repeating_timer = this.gc_last_heap_size;
        if prev_heap_size == this.gc_last_heap_size_on_repeating_timer {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = this
                .heap_size_didnt_change_for_repeating_timer_ticks_count
                .saturating_add(1);
            if this.heap_size_didnt_change_for_repeating_timer_ticks_count >= 30 {
                // make the timer interval longer
                this.update_gc_repeat_timer(GcRepeatSetting::Slow);
            }
        } else {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
            this.update_gc_repeat_timer(GcRepeatSetting::Fast);
        }

        let interval = if this.gc_repeating_timer_fast {
            i64::from(this.gc_timer_interval)
        } else {
            30_000
        };
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
