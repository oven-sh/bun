//! Idle GC timer: JSC's own `GCActivityCallback` (via `WTFTimer`) paces eden/full against allocation rate; this adds a 1 s / 30 s idle `collect_async()` so a process that stops allocating still releases memory, and an idle ladder (main thread only): once the program has not been busy for a `BUN_IDLE_GC_SECONDS` entry (default "30,90,480": 30 s, 2 min and 10 min; ""/0 = off) a full collection so JSC can age out code that no longer runs. The second one (or the only one) also pages out a standalone executable's embedded module graph. Knobs: `BUN_GC_TIMER_INTERVAL` (ms), `BUN_GC_TIMER_DISABLE`. One per JS thread, not thread-safe.

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
    /// The idle ladder: how long (ms, cumulative; 0 = unused) after the program was last busy each rung runs, from
    /// `BUN_IDLE_GC_SECONDS`; when a tick last saw it busy; how many rungs have run since.
    idle_rungs_ms: Cell<[u32; 3]>,
    last_busy_at: Cell<Timespec>,
    idle_rungs_done: Cell<u8>,
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
            idle_rungs_ms: Cell::new([0; 3]),
            last_busy_at: Cell::new(Timespec::EPOCH),
            idle_rungs_done: Cell::new(0),
        }
    }
}

impl GarbageCollectionController {
    /// Remove the timer from the heap if linked, set its deadline to `now + ms`, and insert. JS-thread only. `now` is
    /// real time, not the mocked clock: GC pacing is Bun's, not the test's.
    fn arm(&self, vm: *mut VirtualMachine, now: &Timespec, ms: i32) {
        // whole-struct provenance: from_field_ptr recovers the container on fire
        let t = core::ptr::addr_of!(self.gc_repeating_timer)
            .cast::<EventLoopTimer>()
            .cast_mut();
        // SAFETY: `t` is the embedded node of the per-VM controller,
        // address-stable for the VM lifetime; JS-thread only.
        unsafe {
            if (*t).state == TimerState::ACTIVE {
                VirtualMachine::timer_remove(vm, t);
            }
            (*t).next = now.add_ms(i64::from(ms));
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

        // The field, not `is_main_thread()`: a Worker's VM is initialised before it is given its `worker`.
        if vm.is_main_thread {
            // "a,b,c": seconds without being busy before the first rung, then between consecutive ones (at least a
            // CodeBlock-aging lease, so that each collection can expire what has not run since the previous one), an hour
            // each at most. An entry that is not a positive decimal number ("", "0", "1.5", "1,,1") turns the ladder off.
            let spec = env_var::BUN_IDLE_GC_SECONDS::get().unwrap_or(b"30,90,480");
            let mut at = [0u32; 3];
            let mut sum = 0u32;
            for (slot, part) in at.iter_mut().zip(bun_core::strings::split(spec, b",")) {
                let part = bun_core::strings::trim(part, b" ");
                let secs = if !part.is_empty() && part.iter().all(u8::is_ascii_digit) {
                    bun_core::fmt::parse_int::<u32>(part, 10)
                        .unwrap_or(3600)
                        .min(3600)
                } else {
                    0
                };
                if secs == 0 {
                    at = [0; 3];
                    break;
                }
                sum += secs * 1000;
                *slot = sum;
            }
            self.idle_rungs_ms.set(at);
        }
    }

    /// One tick on the idle ladder, at most one rung per tick. Returns whether a rung ran (it has then done this tick's
    /// collection: an idle full one, which collects what the last burst left and in which JSC drops code that has not run
    /// since the previous one) and the ms until the next rung is due.
    fn idle_tick(&self, vm: &VirtualMachine, now: &Timespec, busy: bool) -> (bool, Option<u64>) {
        if busy {
            self.last_busy_at.set(*now);
            self.idle_rungs_done.set(0);
        }
        let rungs = self.idle_rungs_ms.get();
        if rungs[0] == 0 || vm.is_inspector_enabled() {
            return (false, None);
        }
        let done = usize::from(self.idle_rungs_done.get());
        let Some(&at) = rungs.get(done).filter(|&&at| at != 0) else {
            return (false, None);
        };
        let idle_ms = now.duration(&self.last_busy_at.get()).ms_unsigned();
        if idle_ms < u64::from(at) {
            return (false, Some(u64::from(at) - idle_ms));
        }
        let next = rungs.get(done + 1).copied().filter(|&at| at != 0);
        self.idle_rungs_done.set(done as u8 + 1);
        vm.jsc_vm().collect_async_idle();
        // The module graph goes with the second rung (or the only one): after a pause of a few seconds the user is likely
        // to come straight back, and those file-backed pages would just fault in again. Not while a Worker is alive: the
        // page-out is for the whole process and the ladder only watches this thread.
        #[cfg(target_os = "linux")]
        if let Some(graph) = vm
            .standalone_module_graph
            .filter(|_| (done == 1 || (done == 0 && next.is_none())) && vm.child_workers.is_empty())
        {
            // SAFETY: VM-free — `graph` is the process-lifetime, immutable embedded module graph; the thread only
            // madvise()s its pages and touches no VM or JS state.
            let _ = std::thread::Builder::new()
                .name("idle page-out".into())
                .spawn(move || graph.page_out());
        }
        (true, next.map(|at| u64::from(at).saturating_sub(idle_ms)))
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
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        self.last_busy_at.set(now);
        self.arm(VirtualMachine::get_mut_ptr(), &now, self.repeat_interval());
    }

    pub(crate) fn perform_gc(&self) {
        if self.disabled.get() {
            return;
        }
        let vm = VirtualMachine::get().jsc_vm();
        vm.collect_async(false);
        self.gc_last_heap_size.set(vm.block_bytes_allocated());
    }

    /// `Tag::GcRepeating` fire body: `BUN_GC_TIMER_INTERVAL` (default 1 s) in fast mode, 30 s in slow mode; drops to slow after 30 fires with no heap growth, back to fast when it grows.
    ///
    /// # Safety
    /// `this` is the live per-VM controller; `vm` is the per-thread VM; `now` is the dispatcher's real-time reading.
    pub unsafe fn on_gc_repeating_timer(this: *mut Self, now: &Timespec, vm: *mut VirtualMachine) {
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
        // A tick that comes this long after it was due found the thread in a synchronous call, or the process stopped
        // or asleep: that time was not spent idle.
        const LATE_TICK_MS: u64 = 2000;
        let late = now
            .duration(&this.gc_repeating_timer.get().next)
            .ms_unsigned()
            > LATE_TICK_MS;
        let (ran_rung, next_rung_in_ms) = this.idle_tick(vm_ref, now, grew || late);
        if ran_rung {
            this.gc_last_heap_size
                .set(vm_ref.jsc_vm().block_bytes_allocated());
        } else {
            this.perform_gc();
        }
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
        let interval = this.repeat_interval();
        // Sooner for a rung that is due before the next tick, but not within a second: never more than `interval`, so
        // it fits.
        let interval = next_rung_in_ms.map_or(interval, |ms| {
            ms.max(1000).min(interval.max(0) as u64) as i32
        });
        this.arm(vm, now, interval);
    }
}

impl Drop for GarbageCollectionController {
    fn drop(&mut self) {
        self.deinit();
    }
}
