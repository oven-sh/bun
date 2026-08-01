//! Idle GC timer: JSC's own `GCActivityCallback` (via `WTFTimer`) paces eden/full against allocation rate; this adds a 1 s / 30 s idle `collect_async()` plus a one-shot full `collectNow` + allocator scavenge after the heap has been stable for `STABLE_TICKS_BEFORE_REDUCTION` fast ticks, so a process that stops allocating still sweeps old-generation garbage and returns pages to the OS. Knobs: `BUN_GC_TIMER_INTERVAL` (ms), `BUN_GC_TIMER_DISABLE`, `BUN_IDLE_MEMORY_REDUCER_DISABLE`. One per JS thread, not thread-safe.

use core::ffi::c_int;

use bun_core::{Timespec, TimespecMockMode, env_var};
use bun_event_loop::EventLoopTimer::{EventLoopTimer, State as TimerState, Tag as TimerTag};
use bun_uws as uws;

use crate::virtual_machine::VirtualMachine;

const SLOW_REPEAT_INTERVAL_MS: i32 = 30_000;
/// Stable fast ticks before the one-shot full GC + scavenge and the drop to slow mode; 30 s at the default 1 s interval so a brief lull on a busy server doesn't eat a full-GC pause.
const STABLE_TICKS_BEFORE_REDUCTION: u8 = 30;
/// Skip the idle full GC for small heaps; the pause isn't worth the bytes.
const MIN_HEAP_FOR_IDLE_REDUCTION: usize = 16 * 1024 * 1024;

pub struct GarbageCollectionController {
    pub gc_repeating_timer: EventLoopTimer,
    /// Written by every `perform_gc()` caller, so the fast/slow comparison sees the last such call, not strictly the last fire; external callers are one-shot so worst case is one extra 30 s slow interval.
    pub(crate) gc_last_heap_size: usize,
    /// Post-reduction heap size; another reduction only fires once the heap has grown past this by the stability tolerance, so a truly idle process doesn't re-run full GC every `STABLE_TICKS_BEFORE_REDUCTION` ticks.
    pub(crate) gc_last_reduction_heap_size: usize,
    pub(crate) heap_size_didnt_change_for_repeating_timer_ticks_count: u8,
    pub(crate) gc_timer_interval: i32,
    pub(crate) gc_repeating_timer_fast: bool,
    pub(crate) disabled: bool,
    pub(crate) idle_memory_reducer_disabled: bool,
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
            gc_last_reduction_heap_size: 0,
            heap_size_didnt_change_for_repeating_timer_ticks_count: 0,
            gc_timer_interval: 0,
            gc_repeating_timer_fast: true,
            disabled: false,
            idle_memory_reducer_disabled: false,
        }
    }
}

/// `block_bytes_allocated()` includes `extraMemorySize()` which jitters a few KB between eden sweeps on an idle heap, so treat samples within `max(prev/32, 64 KiB)` as unchanged.
#[inline]
fn heap_size_is_stable(prev: usize, new: usize) -> bool {
    let tolerance = (prev >> 5).max(64 * 1024);
    new.abs_diff(prev) <= tolerance
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

    pub(crate) fn init(&mut self, vm: &mut VirtualMachine) {
        // SAFETY: uws::Loop::get() returns the live process-global loop.
        let actual = unsafe { &mut *uws::Loop::get() };
        actual.internal_loop_data.jsc_vm = vm.jsc_vm.cast();

        self.gc_timer_interval = env_var::BUN_GC_TIMER_INTERVAL::get()
            .filter(|&v| v > 0)
            .unwrap_or(1000)
            .min(i32::MAX as u64) as i32;

        if let Some(runs) = env_var::BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS::get() {
            crate::virtual_machine::Bun__defaultRemainingRunsUntilSkipReleaseAccess.store(
                runs.min(c_int::MAX as u64) as c_int,
                core::sync::atomic::Ordering::Relaxed,
            );
        }

        self.disabled = env_var::BUN_GC_TIMER_DISABLE::get().unwrap_or(false);
        self.idle_memory_reducer_disabled =
            env_var::BUN_IDLE_MEMORY_REDUCER_DISABLE::get().unwrap_or(false);
    }

    /// Idempotent. Must run before JSC teardown: `~RunLoop::Timer` frees the
    /// `WTFTimer` nodes sharing the heap, so an unlink afterwards walks freed
    /// siblings.
    pub(crate) fn deinit(&mut self) {
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

    /// Arms the idle timer on first call; kept at the event-loop call sites so the first deadline is in the poll that follows.
    #[inline]
    pub(crate) fn process_gc_timer(&mut self) {
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

    pub(crate) fn perform_gc(&mut self) {
        if self.disabled {
            return;
        }
        let vm = VirtualMachine::get().jsc_vm();
        vm.collect_async();
        self.gc_last_heap_size = vm.block_bytes_allocated();
    }

    fn perform_idle_memory_reduction(&mut self) {
        let vm = VirtualMachine::get().jsc_vm();
        vm.reduce_memory_footprint_on_idle();
        bun_core::Global::mimalloc_cleanup(true);
        self.gc_last_heap_size = vm.block_bytes_allocated();
        self.gc_last_reduction_heap_size = self.gc_last_heap_size;
    }

    /// `Tag::GcRepeating` fire body: 1 s fast / 30 s slow; after `STABLE_TICKS_BEFORE_REDUCTION` stable fast ticks runs one full GC + scavenge and drops to slow, heap growth past the tolerance resets to fast.
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
        if heap_size_is_stable(prev_heap_size, this.gc_last_heap_size) {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = this
                .heap_size_didnt_change_for_repeating_timer_ticks_count
                .saturating_add(1);
            if this.gc_repeating_timer_fast
                && this.heap_size_didnt_change_for_repeating_timer_ticks_count
                    >= STABLE_TICKS_BEFORE_REDUCTION
            {
                if !this.idle_memory_reducer_disabled
                    && this.gc_last_heap_size >= MIN_HEAP_FOR_IDLE_REDUCTION
                    && !heap_size_is_stable(
                        this.gc_last_reduction_heap_size,
                        this.gc_last_heap_size,
                    )
                {
                    this.perform_idle_memory_reduction();
                }
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
