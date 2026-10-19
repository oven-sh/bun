//! Idle GC timer: JSC's own `GCActivityCallback` (via `WTFTimer`) paces eden/full against allocation rate; this adds a 1 s / 30 s idle `collect_async()` so a process that stops allocating still releases memory, and once the heap has been quiet for `BUN_IDLE_GC_SECONDS` (default "10,110,480": 10 s, 2 min and 10 min of quiet; 0 = off) full collections so JSC can age out code that no longer runs, the last of which also drops the bytecode JSC can decode again. Knobs: `BUN_GC_TIMER_INTERVAL` (ms), `BUN_GC_TIMER_DISABLE`. One per JS thread, not thread-safe.

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

        // "a,b,c": seconds of quiet before the first idle full collection, then between consecutive ones (at least a
        // CodeBlock-aging lease apart so each can expire what has not run since the previous); "0"/"" = off. Every JS
        // thread, for its own heap: a Worker that has finished a burst gives its garbage back too.
        // The second at 2 min: what a program does next compiles again what that collection aged out.
        let spec = env_var::BUN_IDLE_GC_SECONDS::get().unwrap_or(b"10,110,480");
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

    /// Decides whether this tick's collection should be a full one. After the first `BUN_IDLE_GC_SECONDS` entry
    /// of ticks in which the heap did not grow, the tick's collection is made Full (it collects what the
    /// last burst left and lets JSC snapshot which code is still running), and again after each further entry of quiet:
    /// JSC drops code that has not run since the previous one, and each round makes a little more releasable (code whose
    /// last owner died in that collection, pages it emptied). Before the last one JSC also lets go of what it can get back
    /// cheaply (`shrink_footprint_now`); if it cannot right now, this tick's quiet is not counted and the next one tries
    /// again. Returns (full, ms until the next such tick is due).
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
        let mut full = dues.clone().any(crossed);
        let next = dues.clone().find(|&due| quiet < due);
        if full && next.is_none() && !vm.jsc_vm().shrink_footprint_now() {
            self.idle_quiet_ms.set(before);
            full = false;
        }
        (full, next.map(|due| due - quiet))
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

    /// `Tag::GcRepeating` fire body: `BUN_GC_TIMER_INTERVAL` (default 1 s) in fast mode, 30 s in slow mode; drops to slow after 30 fires without heap growth beyond the chatter slack, back to fast when it grows.
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
        // Timer chatter in a parked app churns a few blocks per tick, a few MB per 30 s tick with nothing collecting in
        // between (a TUI at its prompt: 70-200 KB/s); real work grows the heap by far more (one request: 15 MB and up).
        const IDLE_GROWTH_SLACK_MIN: usize = 2 * 1024 * 1024;
        const IDLE_GROWTH_SLACK_PER_MS: usize = 256; // 256 KB/s: 7.5 MB over the 30 s tick
        let interval = this.repeat_interval();
        let idle_growth_slack =
            IDLE_GROWTH_SLACK_MIN.max(interval.max(0) as usize * IDLE_GROWTH_SLACK_PER_MS);
        let prev_heap_size = this.gc_last_heap_size.get();
        // SAFETY: per fn contract.
        let vm_ref = unsafe { &*vm };
        let grew = vm_ref.jsc_vm().block_bytes_allocated() > prev_heap_size + idle_growth_slack;
        let (full, idle_gc_due_in) = this.idle_tick(vm_ref, grew, interval);
        this.perform_gc(full);
        // Growth is activity; a shrinking heap is a collection (possibly the one requested above) doing its job. Where the
        // event loop cannot let an idle collection finish while parked (Windows: Bun__JSC_onBeforeWait), it proceeds at
        // this timer's ticks instead, fast ones for the next 30.
        let needs_ticks_to_finish = full && cfg!(windows);
        if !grew && !needs_ticks_to_finish {
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
