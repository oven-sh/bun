//! Idle GC timer: JSC's own `GCActivityCallback` (via `WTFTimer`) paces eden/full against allocation rate; this adds a 1 s / 30 s idle `collect_async()` so a process that stops allocating still releases memory, and once the program has been quiet (`was_busy`) for `BUN_IDLE_GC_SECONDS` (default "10,65,65": first after 10 s of quiet, then one per CodeBlock-aging lease; 0 = off; main thread only) full collections so JSC can age out code that no longer runs, plus a page-out of a standalone executable's embedded module graph. Knobs: `BUN_GC_TIMER_INTERVAL` (ms), `BUN_GC_TIMER_DISABLE`. One per JS thread, not thread-safe.

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
    /// Everything the program had allocated when the timer last fired, and how far it is ahead of what a quiet program allocates (`was_busy`).
    bytes_allocated_at_last_tick: Cell<u64>,
    allocation_backlog: Cell<u64>,
    silent_ticks: Cell<u8>,
    pub(crate) gc_timer_interval: Cell<i32>,
    /// When the timer was last armed, and with what.
    armed_at: Cell<Timespec>,
    armed_interval_ms: Cell<i32>,
    pub(crate) gc_repeating_timer_fast: Cell<bool>,
    pub(crate) disabled: Cell<bool>,
    /// Idle full collections: cumulative quiet thresholds (ms; empty = off) parsed from `BUN_IDLE_GC_SECONDS`, and the
    /// time since the program was last busy.
    idle_gc_at_ms: Cell<[u32; 3]>,
    idle_quiet_ms: Cell<u32>,
    #[cfg(target_os = "linux")]
    idle_image_page_out: IdleImagePageOut,
}

/// The executable's own code and constants are only paged out for a process that is at rest, which a quiet heap does
/// not prove: also under `MAX_CPU_PERCENT` of the CPU (all threads) both since the program was last busy and
/// over the last tick, on a tick without an idle collection (which runs that code), retried each tick until then, and
/// not again for `MIN_INTERVAL`.
#[cfg(target_os = "linux")]
#[derive(Default)]
struct IdleImagePageOut {
    quiet_since: Cell<Option<CpuSample>>,
    /// Set with the last idle collection: the sample at the previous tick.
    pending: Cell<Option<CpuSample>>,
    last: Cell<Option<std::time::Instant>>,
}

#[cfg(target_os = "linux")]
#[derive(Clone, Copy)]
struct CpuSample {
    at: std::time::Instant,
    cpu_ms: u64,
}

#[cfg(target_os = "linux")]
impl CpuSample {
    fn now() -> Self {
        Self {
            at: std::time::Instant::now(),
            cpu_ms: bun_core::time::process_cpu_time_ms(),
        }
    }

    fn at_rest_until(self, now: Self) -> bool {
        u128::from(now.cpu_ms.saturating_sub(self.cpu_ms)) * 100
            <= now.at.duration_since(self.at).as_millis() * IdleImagePageOut::MAX_CPU_PERCENT
    }
}

#[cfg(target_os = "linux")]
impl IdleImagePageOut {
    const MAX_CPU_PERCENT: u128 = 3;
    const MIN_INTERVAL: std::time::Duration = std::time::Duration::from_secs(10 * 60);

    /// The program was busy: the next quiet stretch starts over.
    fn restart(&self) {
        self.quiet_since.set(None);
        self.pending.set(None);
    }

    /// A quiet tick that runs no idle collection. `true`: page the image out now.
    fn quiet_tick(&self) -> bool {
        let Some(previous) = self.pending.get() else {
            return false;
        };
        let now = CpuSample::now();
        if self
            .last
            .get()
            .is_some_and(|last| now.at.duration_since(last) < Self::MIN_INTERVAL)
        {
            self.pending.set(Some(now));
            return false;
        }
        let at_rest = previous.at_rest_until(now)
            && self
                .quiet_since
                .get()
                .is_some_and(|since| since.at_rest_until(now));
        self.pending.set(if at_rest { None } else { Some(now) });
        if at_rest {
            self.last.set(Some(now.at));
        }
        at_rest
    }
}

#[cfg(target_os = "linux")]
fn spawn_idle_page_out(f: impl FnOnce() + Send + 'static) {
    let _ = std::thread::Builder::new()
        .name("idle page-out".into())
        .stack_size(64 * 1024)
        .spawn(f);
}

bun_event_loop::impl_timer_owner!(
    GarbageCollectionController;
    from_gc_repeating_timer_ptr => gc_repeating_timer,
);

impl Default for GarbageCollectionController {
    fn default() -> Self {
        Self {
            gc_repeating_timer: JsCell::new(EventLoopTimer::init_paused(TimerTag::GcRepeating)),
            bytes_allocated_at_last_tick: Cell::new(0),
            allocation_backlog: Cell::new(0),
            silent_ticks: Cell::new(0),
            gc_timer_interval: Cell::new(0),
            armed_at: Cell::new(Timespec::EPOCH),
            armed_interval_ms: Cell::new(0),
            gc_repeating_timer_fast: Cell::new(true),
            disabled: Cell::new(false),
            idle_gc_at_ms: Cell::new([0; 3]),
            idle_quiet_ms: Cell::new(0),
            #[cfg(target_os = "linux")]
            idle_image_page_out: IdleImagePageOut::default(),
        }
    }
}

impl GarbageCollectionController {
    // A parked interactive program allocates a few KB per second, a server between requests little more.
    const QUIET_BYTES_PER_SECOND: u64 = 2 * 1024 * 1024;
    // A background job allocates a few MB in one go; a program at work, tens of MB every second.
    const QUIET_BURST_BYTES: u64 = 8 * 1024 * 1024;
    // Thirty seconds of this are still far from a burst.
    const SILENT_BYTES_PER_SECOND: u64 = Self::QUIET_BURST_BYTES / 32;
    // What a burst may take: a longer tick drains no more, so a burst inside a 30 s tick shows like one on 1 s ticks.
    const LONGEST_DRAIN_MS: u32 = 4_000;

    /// Remove the timer from the heap if linked, set its deadline to `now + ms`, and insert. JS-thread only. Real
    /// time, not the mocked clock: GC pacing is Bun's, not the test's.
    fn arm(&self, vm: *mut VirtualMachine, now: Timespec, ms: i32) {
        self.armed_at.set(now);
        self.armed_interval_ms.set(ms);
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
    /// thread only) of ticks in which the program was not busy, the tick's collection is made Full (it collects what the
    /// last burst left and lets JSC snapshot which code is still running), and again after each further entry of quiet
    /// (the second also pages out an embedded module graph; the last is followed, a tick later, by the executable's code
    /// and constants): JSC
    /// drops code that has not run since the previous one, and each round makes a little more releasable (code whose
    /// last owner died in that collection, pages it emptied). Returns (full, ms until the next such tick is due).
    fn idle_tick(&self, vm: &VirtualMachine, busy: bool, elapsed_ms: u32) -> (bool, Option<u32>) {
        let dues = self.idle_gc_at_ms.get();
        if dues[0] == 0 || vm.is_inspector_enabled() {
            return (false, None);
        }
        if busy {
            self.idle_quiet_ms.set(0);
            #[cfg(target_os = "linux")]
            self.idle_image_page_out.restart();
            return (false, None);
        }
        let before = self.idle_quiet_ms.get();
        let quiet = before.saturating_add(elapsed_ms);
        self.idle_quiet_ms.set(quiet);
        let dues = dues.into_iter().filter(|&due| due != 0);
        let crossed = |due: u32| before < due && quiet >= due;
        let full = dues.clone().any(crossed);
        // The module graph's page-out goes with the second collection (or the only one): after a pause of a few seconds
        // the user is likely to come straight back, and those file-backed pages would just be read in again.
        #[cfg(target_os = "linux")]
        {
            let image = &self.idle_image_page_out;
            if image.quiet_since.get().is_none() {
                image.quiet_since.set(Some(CpuSample::now()));
            }
            let at = self.idle_gc_at_ms.get();
            if crossed(if at[1] != 0 { at[1] } else { at[0] }) {
                if let Some(graph) = vm.standalone_module_graph {
                    // SAFETY: VM-free — `graph` is the process-lifetime, immutable embedded module graph; the thread
                    // only madvise()s file-backed pages of the executable and touches no VM or JS state.
                    spawn_idle_page_out(move || graph.page_out());
                }
            }
            // The image goes after the last idle collection: an earlier page-out would be read back by the next one.
            if dues.clone().next_back().is_some_and(crossed) {
                image.pending.set(Some(CpuSample::now()));
            } else if !full && image.quiet_tick() {
                spawn_idle_page_out(bun_sys::elf::page_out_program_image);
            }
        }
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
        self.arm(
            VirtualMachine::get_mut_ptr(),
            Timespec::now(TimespecMockMode::ForceRealTime),
            self.repeat_interval(),
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
    }

    /// Whether the program is doing real work rather than sitting parked with its timers, pollers and background jobs
    /// ticking over, from the `allocated` bytes of the last `elapsed_ms`: a leaky bucket that every allocated byte fills,
    /// drained at what a quiet program may allocate.
    fn was_busy(&self, allocated: u64, elapsed_ms: u32) -> bool {
        let backlog = self
            .allocation_backlog
            .get()
            .saturating_add(allocated)
            .saturating_sub(
                Self::QUIET_BYTES_PER_SECOND * u64::from(elapsed_ms.min(Self::LONGEST_DRAIN_MS))
                    / 1000,
            )
            .min(Self::QUIET_BURST_BYTES + Self::QUIET_BYTES_PER_SECOND);
        self.allocation_backlog.set(backlog);
        backlog > Self::QUIET_BURST_BYTES
    }

    /// `Tag::GcRepeating` fire body: `BUN_GC_TIMER_INTERVAL` (default 1 s) in fast mode, 30 s in slow mode; drops to slow after 30 fires in a row in which the program allocated next to nothing, back to fast when it is busy.
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
        let vm_ref = unsafe { &*vm };
        let now = Timespec::now(TimespecMockMode::ForceRealTime);
        // A process that was suspended did not spend that time being quiet.
        let armed_ms = this.armed_interval_ms.get().max(0) as u32;
        let elapsed_ms = now
            .duration(&this.armed_at.get())
            .ms_unsigned()
            .min(2 * u64::from(armed_ms)) as u32;
        let total = vm_ref.jsc_vm().total_bytes_allocated();
        let allocated = total.saturating_sub(this.bytes_allocated_at_last_tick.replace(total));
        let busy = this.was_busy(allocated, elapsed_ms);
        let (full, idle_gc_due_in) = this.idle_tick(vm_ref, busy, elapsed_ms);
        this.perform_gc(full);
        if busy {
            this.gc_repeating_timer_fast.set(true);
        }
        let silent = !busy
            && allocated.saturating_mul(1000)
                <= Self::SILENT_BYTES_PER_SECOND * u64::from(elapsed_ms.max(1));
        let ticks = if silent {
            this.silent_ticks.get().saturating_add(1)
        } else {
            0
        };
        this.silent_ticks.set(ticks);
        if ticks >= 30 {
            this.gc_repeating_timer_fast.set(false);
        }
        let interval = match idle_gc_due_in {
            Some(ms) => this.repeat_interval().min(ms.max(1000) as i32),
            None => this.repeat_interval(),
        };
        this.arm(vm, now, interval);
    }
}

impl Drop for GarbageCollectionController {
    fn drop(&mut self) {
        self.deinit();
    }
}
