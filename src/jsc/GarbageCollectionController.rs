//! Idle GC timer: JSC's own `GCActivityCallback` (via `WTFTimer`) paces eden/full against allocation rate; this only adds a 1 s / 30 s idle `collect_async()` so a process that stops allocating still releases memory, and — once per idle period, after `BUN_IDLE_RELEASE_SECONDS` (default 30, 0 = off) of the process using under 2% CPU — requests a few full collections (so JSC can age out code that is no longer running) and pages out a standalone executable's embedded module graph (main thread only). Knobs: `BUN_GC_TIMER_INTERVAL` (ms), `BUN_GC_TIMER_DISABLE`. One per JS thread, not thread-safe.

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
    /// Idle release: process CPU time (µs) at the last fire, how long the process has stayed under the idle CPU
    /// threshold, when (in quiet ms) and how many idle full GCs were requested this idle period, and the configured
    /// delay (0 = off).
    idle_last_cpu_us: Cell<u64>,
    idle_quiet_ms: Cell<u32>,
    idle_last_gc_at_quiet_ms: Cell<u32>,
    idle_full_gcs: Cell<u8>,
    idle_requested_gc: Cell<bool>,
    idle_release_after_ms: Cell<u32>,
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
            idle_last_cpu_us: Cell::new(0),
            idle_quiet_ms: Cell::new(0),
            idle_last_gc_at_quiet_ms: Cell::new(0),
            idle_full_gcs: Cell::new(0),
            idle_requested_gc: Cell::new(false),
            idle_release_after_ms: Cell::new(0),
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

    /// Called on every repeating-timer fire with the interval that just elapsed. "Idle" is judged by process CPU
    /// time rather than by whether any JS ran: an interactive app sitting at a prompt still fires the odd timer.
    /// While idle, ask for a full collection now and then (at most `IDLE_FULL_GCS` per idle period, at least
    /// `IDLE_FULL_GC_SPACING_MS` apart): that is what lets JSC age out code that is no longer running and return the
    /// memory. The first one also pages out a standalone executable's embedded module graph.
    fn note_tick_for_idle_release(&self, vm: &VirtualMachine, elapsed_ms: i32) {
        const IDLE_CPU_PERCENT: u64 = 2;
        const IDLE_FULL_GCS: u8 = 6;
        const IDLE_FULL_GC_SPACING_MS: u32 = 30_000;
        let after = self.idle_release_after_ms.get();
        if after == 0 {
            return;
        }
        let Some(cpu_us) = process_cpu_time_us() else {
            return;
        };
        let elapsed_ms = elapsed_ms.max(1) as u64;
        // Our own collections burn CPU; don't let the one we requested last tick count as activity.
        let busy = !self.idle_requested_gc.replace(false)
            && cpu_us.saturating_sub(self.idle_last_cpu_us.get()) * 100
                >= elapsed_ms * 1000 * IDLE_CPU_PERCENT;
        self.idle_last_cpu_us.set(cpu_us);
        if busy {
            self.idle_quiet_ms.set(0);
            self.idle_full_gcs.set(0);
            return;
        }
        let quiet = self.idle_quiet_ms.get().saturating_add(elapsed_ms as u32);
        self.idle_quiet_ms.set(quiet);
        if quiet < after || vm.is_inspector_enabled() {
            return;
        }
        let done = self.idle_full_gcs.get();
        let since_last = quiet - self.idle_last_gc_at_quiet_ms.get().min(quiet);
        if done >= IDLE_FULL_GCS || (done > 0 && since_last < IDLE_FULL_GC_SPACING_MS) {
            return;
        }
        if done == 0 {
            if let Some(graph) = vm.standalone_module_graph {
                let _ = std::thread::Builder::new()
                    .name("idle page-out".into())
                    .spawn(move || graph.page_out());
            }
        }
        self.idle_full_gcs.set(done + 1);
        self.idle_last_gc_at_quiet_ms.set(quiet);
        self.idle_requested_gc.set(true);
        vm.jsc_vm().collect_async_full();
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
        // SAFETY: per fn contract.
        this.note_tick_for_idle_release(unsafe { &*vm }, this.repeat_interval());
        let prev_heap_size = this.gc_last_heap_size.get();
        this.perform_gc();
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
        let interval = this.repeat_interval();
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

/// User + system CPU time of the whole process (all threads), in microseconds.
fn process_cpu_time_us() -> Option<u64> {
    #[cfg(unix)]
    {
        let mut ru = core::mem::MaybeUninit::<libc::rusage>::zeroed();
        // SAFETY: getrusage writes a complete rusage into `ru`.
        if unsafe { libc::getrusage(libc::RUSAGE_SELF, ru.as_mut_ptr()) } != 0 {
            return None;
        }
        // SAFETY: initialised by the successful call above.
        let ru = unsafe { ru.assume_init() };
        let us = |t: libc::timeval| t.tv_sec as u64 * 1_000_000 + t.tv_usec as u64;
        Some(us(ru.ru_utime) + us(ru.ru_stime))
    }
    #[cfg(not(unix))]
    {
        None
    }
}

impl Drop for GarbageCollectionController {
    fn drop(&mut self) {
        self.deinit();
    }
}
