//! Idle GC timer: JSC's own `GCActivityCallback` (via `WTFTimer`) paces eden/full against allocation rate; this adds a 1 s / 30 s idle `collect_async()` so a process that stops allocating still releases memory, and (main thread only) the idle ladder of `BUN_IDLE_GC_SECONDS` (default "10,110,480"; ""/0 = off): full collections and, in a standalone executable, page-outs once the program has not been loud for that long (`idle_tick`). Knobs: `BUN_GC_TIMER_INTERVAL` (ms), `BUN_GC_TIMER_DISABLE`. One per JS thread, not thread-safe.

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
    /// When the timer last fired and what the program had allocated by then.
    last_tick_at: Cell<Timespec>,
    bytes_allocated_at_last_tick: Cell<u64>,
    /// Ticks in a row that were not loud; from `SILENT_TICKS_BEFORE_SLOW` on the timer is on its 30 s tick.
    silent_ticks: Cell<u8>,
    gc_timer_interval: Cell<i32>,
    disabled: Cell<bool>,
    /// The idle ladder: how long (ms, cumulative; 0 = unused) after the program was last loud each rung runs, from
    /// `BUN_IDLE_GC_SECONDS`; when it last was; how many rungs have run since.
    idle_rungs_ms: Cell<[u32; 3]>,
    last_loud_at: Cell<Timespec>,
    idle_rungs_done: Cell<u8>,
    /// A rung that pages something out ran while a Worker was alive: the page-out (`Some(true)`: with the executable's own
    /// code) follows when none is.
    page_out_owed: Cell<Option<bool>>,
}

bun_event_loop::impl_timer_owner!(
    GarbageCollectionController;
    from_gc_repeating_timer_ptr => gc_repeating_timer,
);

impl Default for GarbageCollectionController {
    fn default() -> Self {
        Self {
            gc_repeating_timer: JsCell::new(EventLoopTimer::init_paused(TimerTag::GcRepeating)),
            last_tick_at: Cell::new(Timespec::EPOCH),
            bytes_allocated_at_last_tick: Cell::new(0),
            silent_ticks: Cell::new(0),
            gc_timer_interval: Cell::new(0),
            disabled: Cell::new(false),
            idle_rungs_ms: Cell::new([0; 3]),
            last_loud_at: Cell::new(Timespec::EPOCH),
            idle_rungs_done: Cell::new(0),
            page_out_owed: Cell::new(None),
        }
    }
}

impl GarbageCollectionController {
    // A tick is loud when the program allocated faster than this share, per second, of what the collector lets it
    // allocate before it collects by itself (its budget for the cycle, which follows the size of the heap: 128 KB a
    // second with the 8 MB of a new heap).
    const LOUD_SHARE_OF_BUDGET_PER_SECOND: u64 = 64;
    // On the 30 s tick, what the program must have allocated at least for the timer to go back on the fast one before the
    // tick comes.
    const WAKE_BYTES: u64 = 8 * 1024 * 1024;
    const SILENT_TICKS_BEFORE_SLOW: u8 = 30;
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
        if self.silent_ticks.get() < Self::SILENT_TICKS_BEFORE_SLOW {
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
            // "a,b,c": seconds without a loud tick before the first rung, then between consecutive ones (at least a
            // CodeBlock-aging lease, so that each collection can expire what has not run since the previous one), an hour
            // each at most. An entry that is not a positive decimal number ("", "0", "1.5", "1,,1") turns the ladder off.
            let spec = env_var::BUN_IDLE_GC_SECONDS::get().unwrap_or(b"10,110,480");
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

    /// The program is at work: the ladder starts over and the timer is on its fast tick.
    fn loud_at(&self, now: &Timespec) {
        self.last_loud_at.set(*now);
        self.idle_rungs_done.set(0);
        self.page_out_owed.set(None);
        self.silent_ticks.set(0);
    }

    /// One tick on the idle ladder, at most one rung per tick. Returns whether a rung ran (it has then done this tick's
    /// collection: an idle full one, in which JSC drops code that has not run since the previous one) and the ms until
    /// the next rung is due. In a standalone executable the second rung also pages out the embedded module graph (after
    /// a pause of a few seconds the user is likely to come straight back), and the last one evicts what a parked program
    /// does not use: JSC drops the bytecode it can decode again from the executable (`shrink_footprint_now`; it declines
    /// with JS on the stack, and the rung then waits for a tick that has none), the rung's collection frees it, and the
    /// module graph and the executable's own code and constants are paged out. That collection is synchronous then: the
    /// collector is the last thing that would read the executable back in.
    fn idle_tick(&self, vm: &VirtualMachine, now: &Timespec) -> (bool, Option<u64>) {
        if vm.is_inspector_enabled() {
            return (false, None);
        }
        if vm.child_workers.is_empty() {
            if let Some(image) = self.page_out_owed.take() {
                Self::page_out(vm, image);
            }
        }
        let rungs = self.idle_rungs_ms.get();
        let done = usize::from(self.idle_rungs_done.get());
        let Some(&at) = rungs.get(done).filter(|&&at| at != 0) else {
            return (false, None);
        };
        let idle_ms = now.duration(&self.last_loud_at.get()).ms_unsigned();
        if idle_ms < u64::from(at) {
            return (false, Some(u64::from(at) - idle_ms));
        }
        let next = rungs.get(done + 1).copied().filter(|&at| at != 0);
        let evict = next.is_none() && vm.standalone_module_graph.is_some();
        if evict && !vm.jsc_vm().shrink_footprint_now() {
            return (false, None);
        }
        self.idle_rungs_done.set(done as u8 + 1);
        // The page-outs are process-wide and the ladder only watches this thread: while a Worker is alive they are owed,
        // and follow on the first tick that finds none.
        let pages_out = (evict || done == 1)
            && vm.standalone_module_graph.is_some()
            && cfg!(target_os = "linux")
            && !env_var::feature_flag::BUN_FEATURE_FLAG_DISABLE_STANDALONE_MADVISE::get()
                .unwrap_or(false);
        let now_too = pages_out && vm.child_workers.is_empty();
        vm.jsc_vm().collect_idle(evict && now_too);
        if now_too {
            Self::page_out(vm, evict);
        } else if pages_out {
            self.page_out_owed.set(Some(evict));
        }
        (true, next.map(|at| u64::from(at).saturating_sub(idle_ms)))
    }

    /// Hand the pages of the embedded module graph, and with `image` those of the executable's own code and constants,
    /// back to the kernel; they are read from the file again when touched.
    fn page_out(vm: &VirtualMachine, image: bool) {
        let Some(graph) = vm.standalone_module_graph else {
            return;
        };
        // VM-free: the thread only madvise()s file-backed pages of the executable (`graph` is the process-lifetime,
        // immutable embedded module graph) and touches no VM or JS state.
        let _ = std::thread::Builder::new()
            .name("idle page-out".into())
            .stack_size(64 * 1024)
            .spawn(move || {
                graph.page_out();
                #[cfg(target_os = "linux")]
                if image {
                    bun_sys::elf::page_out_program_image();
                }
                #[cfg(not(target_os = "linux"))]
                let _ = image;
            });
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

    /// `allocated` bytes in `elapsed_ms` are more than a loud program's share of the collector's budget.
    fn is_loud(jsc: &crate::VM, allocated: u64, elapsed_ms: u64) -> bool {
        allocated.saturating_mul(1000)
            > jsc.allocation_budget_this_cycle() as u64 / Self::LOUD_SHARE_OF_BUDGET_PER_SECOND
                * elapsed_ms.max(1)
    }

    /// Arms the idle timer on first call; kept at the event-loop call sites so the first deadline is in the poll that follows.
    /// On the 30 s tick it also puts the timer back on the fast one as soon as the program has allocated `WAKE_BYTES` and
    /// the tick so far would be a loud one, which makes it one: work that starts then would otherwise run for up to half a minute without the
    /// collections requested every second.
    #[inline]
    pub(crate) fn process_gc_timer(&self) {
        if self.disabled.get() {
            return;
        }
        let now = match self.gc_repeating_timer.get().state {
            TimerState::PENDING => Timespec::now(TimespecMockMode::ForceRealTime),
            TimerState::ACTIVE if self.silent_ticks.get() >= Self::SILENT_TICKS_BEFORE_SLOW => {
                let jsc = VirtualMachine::get().jsc_vm();
                let total = jsc.total_bytes_allocated();
                let allocated = total.saturating_sub(self.bytes_allocated_at_last_tick.get());
                if allocated <= Self::WAKE_BYTES {
                    return;
                }
                let now = Timespec::now(TimespecMockMode::ForceRealTime);
                if !Self::is_loud(
                    jsc,
                    allocated,
                    now.duration(&self.last_tick_at.get()).ms_unsigned(),
                ) {
                    return;
                }
                self.bytes_allocated_at_last_tick.set(total);
                now
            }
            _ => return,
        };
        self.last_tick_at.set(now);
        self.loud_at(&now);
        self.arm(VirtualMachine::get_mut_ptr(), &now, self.repeat_interval());
    }

    pub(crate) fn perform_gc(&self) {
        if self.disabled.get() {
            return;
        }
        VirtualMachine::get().jsc_vm().collect_async(false);
    }

    /// `Tag::GcRepeating` fire body: `BUN_GC_TIMER_INTERVAL` (default 1 s) in fast mode, 30 s in slow mode: slow from the 30th fire in a row that was not loud until the next loud one (a loud fire or the wake in `process_gc_timer`).
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
        // SAFETY: per fn contract.
        let vm_ref = unsafe { &*vm };
        let jsc = vm_ref.jsc_vm();
        // A tick that comes this long after it was due found the thread in a synchronous call, or the process stopped
        // or asleep: that time was not spent idle.
        const LATE_TICK_MS: u64 = 2000;
        let late = now
            .duration(&this.gc_repeating_timer.get().next)
            .ms_unsigned()
            > LATE_TICK_MS;
        // Whether the program is at work: what it allocated since the last tick (the first one has everything since it
        // started, so a program's first second is loud) against its share of the collector's budget for that time.
        let elapsed_ms = now.duration(&this.last_tick_at.replace(*now)).ms_unsigned();
        let total = jsc.total_bytes_allocated();
        let allocated = total.saturating_sub(this.bytes_allocated_at_last_tick.replace(total));
        let loud = late || Self::is_loud(jsc, allocated, elapsed_ms);
        if loud {
            this.loud_at(now);
        } else {
            this.silent_ticks
                .set(this.silent_ticks.get().saturating_add(1));
        }
        let (ran_rung, next_rung_in_ms) = this.idle_tick(vm_ref, now);
        if ran_rung {
            // Its collection is requested: it proceeds at the mutator's safepoints, which in a program that runs no JS are
            // this timer's ticks, and what it frees goes back to the system on the ticks after it. On the 30 s tick that
            // is a minute or more of holding on to a burst's garbage: the fast tick for the next 30.
            this.silent_ticks.set(0);
        } else {
            this.perform_gc();
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
