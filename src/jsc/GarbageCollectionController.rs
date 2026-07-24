//! Idle garbage-collection timer for Bun's JavaScript runtime.
//!
//! JavaScriptCore already paces eden and full collections against allocation
//! rate via `GCActivityCallback::didAllocate` / `Heap::collectIfNecessaryOrDefer`
//! (bridged onto Bun's timer heap through `WTFTimer`). This controller only
//! adds a low-frequency idle timer that requests a collection every
//! `gc_timer_interval` ms (default 1 s, decaying to 30 s after 30 steady ticks)
//! so a process that stops allocating still releases memory.
//!
//! Tuning knobs (process environment):
//! - `BUN_GC_TIMER_INTERVAL`  fast-mode interval in ms (default 1000)
//! - `BUN_GC_TIMER_DISABLE`   truthy value disables the timer entirely
//!
//! Thread Safety: This type must be unique per JavaScript thread and is not
//! thread-safe. Each VirtualMachine instance has its own controller.

use core::ffi::c_int;

use bun_core::{Timespec, TimespecMockMode, ZStr};
use bun_event_loop::EventLoopTimer::{EventLoopTimer, State as TimerState, Tag as TimerTag};
use bun_uws as uws;

use crate::virtual_machine::VirtualMachine;

const SLOW_REPEAT_INTERVAL_MS: i32 = 30_000;

pub struct GarbageCollectionController {
    pub gc_repeating_timer: EventLoopTimer,
    pub gc_last_heap_size: usize,
    pub heap_size_didnt_change_for_repeating_timer_ticks_count: u8,
    pub gc_timer_interval: i32,
    pub gc_repeating_timer_fast: bool,
    pub disabled: bool,
}

bun_event_loop::impl_timer_owner!(
    GarbageCollectionController;
    from_gc_repeating_timer_ptr => gc_repeating_timer,
);

impl Default for GarbageCollectionController {
    fn default() -> Self {
        Self {
            gc_repeating_timer: EventLoopTimer::init_paused(TimerTag::GcRepeating),
            gc_last_heap_size: 0,
            heap_size_didnt_change_for_repeating_timer_ticks_count: 0,
            gc_timer_interval: 0,
            gc_repeating_timer_fast: true,
            disabled: false,
        }
    }
}

impl GarbageCollectionController {
    /// Remove `t` from the heap if linked, set its deadline to `now + ms`, and
    /// insert. JS-thread only. Real time, not the mocked clock: GC pacing is
    /// Bun's, not the test's.
    fn arm(vm: *mut VirtualMachine, t: *mut EventLoopTimer, ms: i32) {
        // SAFETY: `t` is the embedded node of the per-VM controller,
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

    pub fn init(&mut self, vm: &mut VirtualMachine) {
        // SAFETY: uws::Loop::get() returns the live process-global loop.
        let actual = unsafe { &mut *uws::Loop::get() };
        actual.internal_loop_data.jsc_vm = vm.jsc_vm.cast();

        // The dotenv loader may not be populated yet when this runs (it exists
        // from `Transpiler::init` but `load_process()` has not run); fall back
        // to the process environment so the knobs below are always honoured.
        let env = vm.env_loader_opt();
        let get_env = |zkey: &'static ZStr| -> Option<&'static [u8]> {
            env.and_then(|e| e.get(zkey))
                .or_else(|| bun_core::getenv_z(zkey))
        };

        let mut gc_timer_interval: i32 = 1000;
        if let Some(timer) = get_env(ZStr::from_static(b"BUN_GC_TIMER_INTERVAL\0")) {
            if let Some(parsed) = bun_core::fmt::parse_decimal::<i32>(timer) {
                if parsed > 0 {
                    gc_timer_interval = parsed;
                }
            }
        }
        self.gc_timer_interval = gc_timer_interval;

        if let Some(val) = get_env(ZStr::from_static(
            b"BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS\0",
        )) {
            if let Some(parsed) = bun_core::fmt::parse_decimal::<c_int>(val) {
                if parsed >= 0 {
                    crate::virtual_machine::Bun__defaultRemainingRunsUntilSkipReleaseAccess
                        .store(parsed, core::sync::atomic::Ordering::Relaxed);
                }
            }
        }

        self.disabled = get_env(ZStr::from_static(b"BUN_GC_TIMER_DISABLE\0"))
            .is_some_and(bun_dotenv::Loader::is_truthy);
    }

    pub fn bun_vm(&mut self) -> &mut VirtualMachine {
        VirtualMachine::get().as_mut()
    }

    /// Idempotent. Must run before JSC teardown: `~RunLoop::Timer` frees the
    /// `WTFTimer` nodes sharing the heap, so an unlink afterwards walks freed
    /// siblings.
    pub fn deinit(&mut self) {
        self.disabled = true;
        let Some(vm) = VirtualMachine::get_or_null() else {
            return;
        };
        // SAFETY: JS-thread; node is linked iff state == ACTIVE.
        unsafe {
            let t = &raw mut self.gc_repeating_timer;
            if (*t).state == TimerState::ACTIVE {
                VirtualMachine::timer_remove(vm, t);
            }
        }
    }

    /// Arms the idle timer on first call; a branch on `state` thereafter. Kept
    /// at the existing event-loop call sites so the timer's first deadline is
    /// included in the poll that follows.
    #[inline]
    pub fn process_gc_timer(&mut self) {
        if self.disabled || self.gc_repeating_timer.state != TimerState::PENDING {
            return;
        }
        let interval = self.repeat_interval();
        Self::arm(
            VirtualMachine::get_mut_ptr(),
            &raw mut self.gc_repeating_timer,
            interval,
        );
    }

    pub fn perform_gc(&mut self) {
        if self.disabled {
            return;
        }
        let vm = VirtualMachine::get().jsc_vm();
        vm.collect_async();
        self.gc_last_heap_size = vm.block_bytes_allocated();
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
    // When the heap size has been the same or less for 30 seconds, we switch
    // to slow mode.
    ///
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
        let prev_heap_size = this.gc_last_heap_size;
        this.perform_gc();
        if prev_heap_size == this.gc_last_heap_size {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = this
                .heap_size_didnt_change_for_repeating_timer_ticks_count
                .saturating_add(1);
            if this.heap_size_didnt_change_for_repeating_timer_ticks_count >= 30 {
                this.gc_repeating_timer_fast = false;
            }
        } else {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
            this.gc_repeating_timer_fast = true;
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
