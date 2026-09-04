//! Idle GC timer: JSC's own `GCActivityCallback` (via `WTFTimer`) paces eden/full against allocation rate; this adds a 1 s / 30 s idle `collect_async()` so a process that stops allocating still releases memory, and once the heap has been quiet for `BUN_IDLE_GC_SECONDS` (default "10,65,65": first after 10 s of quiet, then one per CodeBlock-aging lease; 0 = off; main thread only) full collections so JSC can age out code that no longer runs, plus a page-out of a standalone executable's embedded module graph. Knobs: `BUN_GC_TIMER_INTERVAL` (ms), `BUN_GC_TIMER_DISABLE`. One per JS thread, not thread-safe.

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
    /// Written by every `perform_gc` caller, so the fast/slow comparison sees the last such call, not strictly the last fire; external callers are one-shot so worst case is one extra 30 s slow interval.
    pub(crate) gc_last_heap_size: Cell<usize>,
    pub(crate) heap_size_didnt_change_for_repeating_timer_ticks_count: Cell<u8>,
    pub(crate) gc_timer_interval: Cell<i32>,
    pub(crate) gc_repeating_timer_fast: Cell<bool>,
    pub(crate) disabled: Cell<bool>,
    /// Idle full collections: cumulative quiet thresholds (ms; empty = off) parsed from `BUN_IDLE_GC_SECONDS`, and the
    /// nominal time (from tick intervals) since the JS heap last grew.
    idle_gc_at_ms: Cell<[u32; 3]>,
    idle_quiet_ms: Cell<u32>,
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
            idle_gc_at_ms: Cell::new([0; 3]),
            idle_quiet_ms: Cell::new(0),
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
            // "a,b,c,...": seconds of quiet before the first idle full collection, then between consecutive ones (spaced a
            // CodeBlock-aging lease apart so each can expire what has not run since the previous); "0"/"" = off.
            let spec = env_var::BUN_IDLE_GC_SECONDS::get().unwrap_or(b"10,65,65");
            let mut at = [0u32; 3];
            let mut sum = 0u32;
            for (slot, part) in at.iter_mut().zip(bun_core::strings::split(spec, b",")) {
                let secs = bun_core::fmt::parse_int::<u32>(bun_core::strings::trim(part, b" "), 10)
                    .unwrap_or(0);
                if secs == 0 {
                    break;
                }
                sum = sum.saturating_add(secs.min(3600) * 1000);
                *slot = sum;
            }
            self.idle_gc_at_ms.set(at);
        }
    }

    /// Decides whether this tick's collection should be a full one. After the first `BUN_IDLE_GC_SECONDS` entry (main
    /// thread only) of ticks in which the heap did not grow, the tick's collection is made Full (it collects what the
    /// last burst left and lets JSC snapshot which code is still running), and again after each further entry of quiet
    /// (the second also pages out a standalone executable's embedded module graph): JSC drops code that has not run since the
    /// previous one, and each round makes a little more releasable (code whose last owner died in that collection,
    /// pages it emptied). Returns (full, ms until the next such tick is due).
    fn idle_tick(&self, vm: &VirtualMachine, grew: bool, interval_ms: i32) -> (bool, Option<u32>) {
        let dues = self.idle_gc_at_ms.get();
        if dues[0] == 0 || vm.is_inspector_enabled() {
            return (false, None);
        }
        if grew {
            self.idle_quiet_ms.set(0);
            return (false, None);
        }
        let before = self.idle_quiet_ms.get();
        let quiet = before.saturating_add(interval_ms.max(0) as u32);
        self.idle_quiet_ms.set(quiet);
        let dues = dues.into_iter().filter(|&due| due != 0);
        let crossed = |due: u32| before < due && quiet >= due;
        // The module-graph page-out goes with the second collection (or the only one): after a pause of a few seconds
        // the user is likely to come straight back, and those file-backed pages would just fault in again.
        #[cfg(target_os = "linux")]
        {
            let at = self.idle_gc_at_ms.get();
            if let Some(graph) = vm
                .standalone_module_graph
                .filter(|_| crossed(if at[1] != 0 { at[1] } else { at[0] }))
            {
                // SAFETY: VM-free — `graph` is the process-lifetime, immutable embedded module graph; the thread only
                // madvise()s its pages and touches no VM or JS state.
                let _ = std::thread::Builder::new()
                    .name("idle page-out".into())
                    .spawn(move || graph.page_out());
            }
        }
        let full = dues.clone().any(crossed);
        (
            full,
            dues.clone().find(|&due| quiet < due).map(|due| due - quiet),
        )
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

    pub(crate) fn perform_gc(&self, idle_full: bool) {
        if self.disabled.get() {
            return;
        }
        let vm = VirtualMachine::get().jsc_vm();
        if idle_full {
            vm.collect_async_idle();
        } else {
            vm.collect_async(false);
        }
        self.gc_last_heap_size.set(vm.block_bytes_allocated());
    }

    /// `Tag::GcRepeating` fire body: `BUN_GC_TIMER_INTERVAL` (default 1 s) in fast mode, 30 s in slow mode; drops to slow after 30 fires with no heap growth, back to fast when it grows.
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
        // Timer chatter in a parked app churns a few blocks per tick; real work grows the heap by far more.
        const IDLE_GROWTH_SLACK: usize = 2 * 1024 * 1024;
        let prev_heap_size = this.gc_last_heap_size.get();
        // SAFETY: per fn contract.
        let vm_ref = unsafe { &*vm };
        let grew = vm_ref.jsc_vm().block_bytes_allocated() > prev_heap_size + IDLE_GROWTH_SLACK;
        let (full, idle_gc_due_in) = this.idle_tick(vm_ref, grew, this.repeat_interval());
        this.perform_gc(full);
        // Only growth is activity; a shrinking heap is a collection (possibly the one requested above) doing its job.
        if this.gc_last_heap_size.get() <= prev_heap_size {
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
