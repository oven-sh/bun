//! Idle GC timer: JSC's own `GCActivityCallback` (via `WTFTimer`) paces eden/full against allocation rate; this adds a 1 s / 30 s idle `collect_async()` so a process that stops allocating still releases memory, and once the heap has been quiet for `BUN_IDLE_RELEASE_SECONDS` (default 30, 0 = off; main thread only) two full collections so JSC can age out code that no longer runs, plus a page-out of a standalone executable's embedded module graph. Knobs: `BUN_GC_TIMER_INTERVAL` (ms), `BUN_GC_TIMER_DISABLE`. One per JS thread, not thread-safe.

use core::cell::Cell;
use core::ffi::c_int;

use bun_core::{Timespec, TimespecMockMode, env_var};
use bun_event_loop::EventLoopTimer::{EventLoopTimer, State as TimerState, Tag as TimerTag};
use bun_uws as uws;

use crate::JsCell;
use crate::virtual_machine::VirtualMachine;

const SLOW_REPEAT_INTERVAL_MS: i32 = 30_000;

pub struct GarbageCollectionController {
    pub gc_repeating_timer: JsCell<EventLoopTimer>,
    /// Written by every `perform_gc()` caller, so the fast/slow comparison sees the last such call, not strictly the last fire; external callers are one-shot so worst case is one extra 30 s slow interval.
    pub(crate) gc_last_heap_size: Cell<usize>,
    pub(crate) heap_size_didnt_change_for_repeating_timer_ticks_count: Cell<u8>,
    pub(crate) gc_timer_interval: Cell<i32>,
    pub(crate) gc_repeating_timer_fast: Cell<bool>,
    pub(crate) disabled: Cell<bool>,
    /// Idle release: how long the heap must stay unchanged before the first idle full collection (0 = off), nominal
    /// quiet time accumulated from tick intervals, full collections requested this quiet streak, and whether the
    /// last tick requested one (its own effect on the heap is not activity).
    idle_release_after_ms: Cell<u32>,
    idle_quiet_ms: Cell<u32>,
    idle_full_gcs: Cell<u8>,
    idle_requested_gc: Cell<bool>,
}

bun_event_loop::impl_timer_owner!(
    GarbageCollectionController;
    from_gc_repeating_timer_ptr => gc_repeating_timer,
);

impl Default for GarbageCollectionController {
    fn default() -> Self {
        Self {
            gc_repeating_timer: JsCell::new(EventLoopTimer::init_paused(TimerTag::GcRepeating)),
            gc_last_heap_size: Cell::new(0),
            heap_size_didnt_change_for_repeating_timer_ticks_count: Cell::new(0),
            gc_timer_interval: Cell::new(0),
            gc_repeating_timer_fast: Cell::new(true),
            disabled: Cell::new(false),
            idle_release_after_ms: Cell::new(0),
            idle_quiet_ms: Cell::new(0),
            idle_full_gcs: Cell::new(0),
            idle_requested_gc: Cell::new(false),
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
        if self.gc_repeating_timer_fast.get() {
            self.gc_timer_interval.get()
        } else {
            SLOW_REPEAT_INTERVAL_MS
        }
    }

    pub(crate) fn init(&self, vm: &mut VirtualMachine) {
        // SAFETY: uws::Loop::get() returns the live process-global loop.
        let actual = unsafe { &mut *uws::Loop::get() };
        actual.internal_loop_data.jsc_vm = vm.jsc_vm.cast();

        self.gc_timer_interval.set(
            env_var::BUN_GC_TIMER_INTERVAL::get()
                .filter(|&v| v > 0)
                .unwrap_or(1000)
                .min(i32::MAX as u64) as i32,
        );

        if let Some(runs) = env_var::BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS::get() {
            crate::virtual_machine::Bun__defaultRemainingRunsUntilSkipReleaseAccess.store(
                runs.min(c_int::MAX as u64) as c_int,
                core::sync::atomic::Ordering::Relaxed,
            );
        }

        self.disabled
            .set(env_var::BUN_GC_TIMER_DISABLE::get().unwrap_or(false));

        if vm.is_main_thread() {
            self.idle_release_after_ms.set(
                (env_var::BUN_IDLE_RELEASE_SECONDS::get()
                    .unwrap_or(30)
                    .min(3600)
                    * 1000) as u32,
            );
        }
    }

    /// Called from the repeating timer with whether this tick saw the heap grow and the tick's nominal interval.
    /// After `BUN_IDLE_RELEASE_SECONDS` of ticks without growth, request a full collection (collects what the last
    /// burst left, lets JSC snapshot which code is still running, pages out a standalone executable's embedded module
    /// graph), and `SECOND_GC_AFTER_MS` of further quiet later a second one, which is when JSC can drop code that has
    /// not run since. Returns how long until the next one is due so the caller can tick by then.
    fn note_tick_for_idle_release(
        &self,
        vm: &VirtualMachine,
        grew: bool,
        interval_ms: i32,
    ) -> Option<u32> {
        const SECOND_GC_AFTER_MS: u32 = 65_000;
        let after = self.idle_release_after_ms.get();
        if after == 0 {
            return None;
        }
        if grew && !self.idle_requested_gc.get() {
            self.idle_quiet_ms.set(0);
            self.idle_full_gcs.set(0);
            return None;
        }
        self.idle_requested_gc.set(false);
        let quiet = self
            .idle_quiet_ms
            .get()
            .saturating_add(interval_ms.max(0) as u32);
        self.idle_quiet_ms.set(quiet);
        let due_at = match self.idle_full_gcs.get() {
            0 => after,
            1 => after.saturating_add(SECOND_GC_AFTER_MS),
            _ => return None,
        };
        if quiet < due_at || vm.is_inspector_enabled() {
            return Some(due_at.saturating_sub(quiet));
        }
        if self.idle_full_gcs.get() == 0 {
            if let Some(graph) = vm.standalone_module_graph {
                let _ = std::thread::Builder::new()
                    .name("idle page-out".into())
                    .spawn(move || graph.page_out());
            }
        }
        self.idle_full_gcs.set(self.idle_full_gcs.get() + 1);
        self.idle_requested_gc.set(true);
        vm.jsc_vm().collect_async_full();
        None
    }

    /// Idempotent. Must run before JSC teardown: `~RunLoop::Timer` frees the
    /// `WTFTimer` nodes sharing the heap, so an unlink afterwards walks freed
    /// siblings.
    pub(crate) fn deinit(&self) {
        self.disabled.set(true);
        let Some(vm) = VirtualMachine::get_or_null() else {
            return;
        };
        let t = self.gc_repeating_timer.as_ptr();
        // SAFETY: JS-thread; node is linked iff state == ACTIVE.
        unsafe {
            if (*t).state == TimerState::ACTIVE {
                VirtualMachine::timer_remove(vm, t);
            }
        }
    }

    /// Arms the idle timer on first call; kept at the event-loop call sites so the first deadline is in the poll that follows.
    #[inline]
    pub(crate) fn process_gc_timer(&self) {
        if self.disabled.get() || self.gc_repeating_timer.get().state != TimerState::PENDING {
            return;
        }
        let interval = self.repeat_interval();
        Self::arm(
            VirtualMachine::get_mut_ptr(),
            // whole-struct provenance: from_field_ptr recovers the container on fire
            core::ptr::addr_of!(self.gc_repeating_timer)
                .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>()
                .cast_mut(),
            interval,
        );
    }

    pub(crate) fn perform_gc(&self) {
        if self.disabled.get() {
            return;
        }
        let vm = VirtualMachine::get().jsc_vm();
        vm.collect_async();
        self.gc_last_heap_size.set(vm.block_bytes_allocated());
    }

    /// `Tag::GcRepeating` fire body: 1 s in fast mode, 30 s in slow mode; drops to slow after 30 fires with no heap growth.
    ///
    /// # Safety
    /// `this` is the live per-VM controller; `vm` is the per-thread VM.
    pub unsafe fn on_gc_repeating_timer(this: *mut Self, vm: *mut VirtualMachine) {
        // SAFETY: per fn contract.
        let this = unsafe { &*this };
        this.gc_repeating_timer
            .with_mut(|t| t.state = TimerState::FIRED);
        if this.disabled.get() {
            return;
        }
        let interval = this.repeat_interval();
        let prev_heap_size = this.gc_last_heap_size.get();
        this.perform_gc();
        // Timer chatter in a parked app churns a few blocks per tick; real work grows the heap by far more.
        const IDLE_GROWTH_SLACK: usize = 2 * 1024 * 1024;
        let grew = this.gc_last_heap_size.get() > prev_heap_size + IDLE_GROWTH_SLACK;
        // SAFETY: per fn contract.
        let idle_gc_due_in = this.note_tick_for_idle_release(unsafe { &*vm }, grew, interval);
        if prev_heap_size == this.gc_last_heap_size.get() {
            let ticks = this
                .heap_size_didnt_change_for_repeating_timer_ticks_count
                .get()
                .saturating_add(1);
            this.heap_size_didnt_change_for_repeating_timer_ticks_count
                .set(ticks);
            if ticks >= 30 {
                this.gc_repeating_timer_fast.set(false);
            }
        } else {
            this.heap_size_didnt_change_for_repeating_timer_ticks_count
                .set(0);
            this.gc_repeating_timer_fast.set(true);
        }
        let interval = match idle_gc_due_in {
            Some(ms) => this.repeat_interval().min(ms.max(1000) as i32),
            None => this.repeat_interval(),
        };
        Self::arm(
            vm,
            // whole-struct provenance: from_field_ptr recovers the container on fire
            core::ptr::addr_of!(this.gc_repeating_timer)
                .cast::<bun_event_loop::EventLoopTimer::EventLoopTimer>()
                .cast_mut(),
            interval,
        );
    }
}

impl Drop for GarbageCollectionController {
    fn drop(&mut self) {
        self.deinit();
    }
}
