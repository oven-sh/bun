//! Idle GC timer: JSC's own `GCActivityCallback` (via `WTFTimer`) paces eden/full against allocation rate; this only adds a 1 s / 30 s idle `collect_async()` so a process that stops allocating still releases memory. Knobs: `BUN_GC_TIMER_INTERVAL` (ms), `BUN_GC_TIMER_DISABLE`. One per JS thread, not thread-safe.

use core::ffi::c_int;

use bun_core::{Timespec, TimespecMockMode, env_var};
use bun_event_loop::EventLoopTimer::{EventLoopTimer, State as TimerState, Tag as TimerTag};
use bun_uws as uws;

use crate::virtual_machine::VirtualMachine;

const SLOW_REPEAT_INTERVAL_MS: i32 = 30_000;

pub struct GarbageCollectionController {
    pub gc_repeating_timer: EventLoopTimer,
    /// Written by every `perform_gc()` caller, so the fast/slow comparison sees the last such call, not strictly the last fire; external callers are one-shot so worst case is one extra 30 s slow interval.
    pub(crate) gc_last_heap_size: usize,
    pub(crate) heap_size_didnt_change_for_repeating_timer_ticks_count: u8,
    pub(crate) gc_timer_interval: i32,
    pub(crate) gc_repeating_timer_fast: bool,
    pub(crate) disabled: bool,
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

    /// `Tag::GcRepeating` fire body: 1 s in fast mode, 30 s in slow mode; drops to slow after 30 fires with no heap growth.
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
