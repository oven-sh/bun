//! Garbage Collection Controller for Bun's JavaScript runtime
//!
//! This controller intelligently schedules garbage collection to run at optimal times,
//! such as when HTTP requests complete, during idle periods, or when memory usage
//! has grown significantly since the last collection cycle.
//!
//! The controller works in conjunction with JavaScriptCore's built-in GC timers to
//! provide additional collection opportunities, particularly in scenarios where:
//! - JavaScript code is not actively executing (e.g., waiting for I/O)
//! - The event loop is idle but memory usage has increased
//! - Long-running operations have allocated significant memory
//!
//! Key features:
//! - Adaptive timing based on heap growth patterns
//! - Configurable intervals via BUN_GC_TIMER_INTERVAL environment variable
//! - Can be disabled via BUN_GC_TIMER_DISABLE for debugging/testing
//!
//! Thread Safety: This type must be unique per JavaScript thread and is not
//! thread-safe. Each VirtualMachine instance should have its own controller.

use core::ffi::c_int;

use bun_core::env_var;
use bun_uws as uws;

use crate::VM;
use crate::virtual_machine::VirtualMachine;

pub struct GarbageCollectionController {
    // Raw FFI handle created by `uws::Timer::create_fallthrough` in `init`,
    // freed in Drop. Stored as `Option<NonNull<Timer>>` (None = uninit).
    pub gc_timer: Option<core::ptr::NonNull<uws::Timer>>,
    pub gc_last_heap_size: usize,
    pub gc_last_heap_size_on_repeating_timer: usize,
    pub heap_size_didnt_change_for_repeating_timer_ticks_count: u8,
    pub idle_full_gcs_fired: u8,
    pub gc_timer_state: GCTimerState,
    // Raw FFI handle created by `uws::Timer::create_fallthrough` in `init`,
    // freed in Drop.
    pub gc_repeating_timer: Option<core::ptr::NonNull<uws::Timer>>,
    pub gc_timer_interval: i32,
    pub gc_repeating_timer_fast: bool,
    pub disabled: bool,
}

impl Default for GarbageCollectionController {
    fn default() -> Self {
        Self {
            gc_timer: None,
            gc_last_heap_size: 0,
            gc_last_heap_size_on_repeating_timer: 0,
            heap_size_didnt_change_for_repeating_timer_ticks_count: 0,
            idle_full_gcs_fired: 0,
            gc_timer_state: GCTimerState::Pending,
            gc_repeating_timer: None,
            gc_timer_interval: 0,
            gc_repeating_timer_fast: true,
            disabled: false,
        }
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GcRepeatSetting {
    Fast,
    Slow,
}

impl GarbageCollectionController {
    /// Recover `&mut Self` from a uws timer's ext slot. Single audited deref
    /// for the two `extern "C"` callbacks below so they stay safe-bodied.
    ///
    /// `timer` is the live uws timer whose ext data was set to
    /// `*mut GarbageCollectionController` in [`Self::init`]; the controller is
    /// a BACKREF that strictly outlives the timer (`deinit()` closes the timer
    /// before `self` is dropped). `Timer` is an `opaque_ffi!` ZST handle, so
    /// [`uws::Timer::opaque_mut`] is the centralised non-null deref proof for
    /// the handle itself; only the recovered `*mut Self` needs the audited
    /// deref below.
    #[inline]
    fn from_timer_ext<'a>(timer: *mut uws::Timer) -> &'a mut Self {
        let ptr = uws::Timer::opaque_mut(timer).as_::<*mut Self>();
        // SAFETY: BACKREF — see doc comment above.
        unsafe { &mut *ptr }
    }

    /// Accessor for the init-once `gc_timer` handle. Consolidates the four
    /// open-coded `(*self.<field>.unwrap().as_ptr())` deref sites into one
    /// SAFETY block so call sites are safe.
    #[inline]
    fn gc_timer_mut(&mut self) -> &mut uws::Timer {
        // SAFETY: `gc_timer` is set in `init()` (via `Timer::create_fallthrough`)
        // before any code path reaches a deref site, and remains a live FFI
        // handle until `deinit()` closes it. The Timer lives on the uws heap,
        // not inside `self`, so the returned `&mut` cannot alias `self`.
        unsafe { &mut *self.gc_timer.expect("gc_timer set in init()").as_ptr() }
    }

    /// Accessor for the init-once `gc_repeating_timer` handle (see
    /// [`gc_timer_mut`] for the invariant).
    #[inline]
    fn gc_repeating_timer_mut(&mut self) -> &mut uws::Timer {
        // SAFETY: same invariant as `gc_timer_mut` — set in `init()`, live
        // until `deinit()`, FFI-heap-owned.
        unsafe {
            &mut *self
                .gc_repeating_timer
                .expect("gc_repeating_timer set in init()")
                .as_ptr()
        }
    }

    pub fn init(&mut self, vm: &mut VirtualMachine) {
        // SAFETY: uws::Loop::get() returns the live process-global loop.
        let actual = unsafe { &mut *uws::Loop::get() };
        self.gc_timer = Some(uws::Timer::create_fallthrough(
            actual,
            std::ptr::from_mut::<Self>(self),
        ));
        self.gc_repeating_timer = Some(uws::Timer::create_fallthrough(
            actual,
            std::ptr::from_mut::<Self>(self),
        ));
        actual.internal_loop_data.jsc_vm = vm.jsc_vm.cast();

        #[cfg(debug_assertions)]
        {
            if env_var::BUN_TRACK_LAST_FN_NAME.get().unwrap_or(false) {
                vm.event_loop_mut().debug.track_last_fn_name = true;
            }
        }

        // init() runs from ensure_waker() before Transpiler::init has copied
        // the process environment into vm.transpiler.env, so these go
        // through bun_core::env_var (process-environment backed), not
        // vm.env_loader_opt().
        self.gc_timer_interval = match env_var::BUN_GC_TIMER_INTERVAL.get() {
            Some(interval) => i32::try_from(interval).unwrap_or(1000),
            None => 1000,
        };
        if self.gc_timer_interval <= 0 {
            self.gc_timer_interval = 1000;
        }

        if let Some(runs) = env_var::BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS.get() {
            if let Ok(val) = c_int::try_from(runs) {
                crate::virtual_machine::Bun__defaultRemainingRunsUntilSkipReleaseAccess
                    .store(val, core::sync::atomic::Ordering::Relaxed);
            }
        }

        self.disabled = env_var::BUN_GC_TIMER_DISABLE.get().unwrap_or(false);

        if !self.disabled {
            let ext = std::ptr::from_mut::<Self>(self);
            let interval = self.gc_timer_interval;
            self.gc_repeating_timer_mut()
                .set(ext, Some(on_gc_repeating_timer), interval, interval);
        }
    }

    pub fn schedule_gc_timer(&mut self) {
        self.gc_timer_state = GCTimerState::Scheduled;
        let ext = std::ptr::from_mut::<Self>(self);
        self.gc_timer_mut().set(ext, Some(on_gc_timer), 16, 0);
    }

    pub fn bun_vm(&mut self) -> &mut VirtualMachine {
        // S017: dropped `container_of` recovery — provenance of `&mut self`
        // (which only covers `vm.gc_controller`) cannot soundly widen to the
        // whole `VirtualMachine` under Stacked Borrows. Route through the
        // per-thread singleton instead (same pointer, full-allocation
        // provenance via `VirtualMachine::get_mut_ptr`).
        VirtualMachine::get().as_mut()
    }

    /// Explicit teardown. Idempotent — `Drop` forwards here.
    /// Kept as an inherent method because callers (web_worker, VM exit path)
    /// need to release the uws timers before the owning VM storage is freed.
    pub fn deinit(&mut self) {
        // SAFETY: timers were created via uws::Timer::create_fallthrough; close::<true>
        // frees the fallthrough timer. `take()` ensures we close at most once.
        unsafe {
            if let Some(t) = self.gc_timer.take() {
                uws::Timer::close::<true>(t.as_ptr());
            }
            if let Some(t) = self.gc_repeating_timer.take() {
                uws::Timer::close::<true>(t.as_ptr());
            }
        }
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
    // When the heap size has been the same or less for 30 seconds, we switch to slow mode
    pub fn update_gc_repeat_timer(&mut self, setting: GcRepeatSetting) {
        if setting == GcRepeatSetting::Fast && !self.gc_repeating_timer_fast {
            self.gc_repeating_timer_fast = true;
            let ext = std::ptr::from_mut::<Self>(self);
            let interval = self.gc_timer_interval;
            self.gc_repeating_timer_mut()
                .set(ext, Some(on_gc_repeating_timer), interval, interval);
            self.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
            self.idle_full_gcs_fired = 0;
        } else if setting == GcRepeatSetting::Slow && self.gc_repeating_timer_fast {
            self.gc_repeating_timer_fast = false;
            let ext = std::ptr::from_mut::<Self>(self);
            self.gc_repeating_timer_mut()
                .set(ext, Some(on_gc_repeating_timer), 30_000, 30_000);
            self.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        }
    }

    #[inline]
    pub fn process_gc_timer(&mut self) {
        if self.disabled {
            return;
        }
        let vm = VirtualMachine::get().jsc_vm();
        self.process_gc_timer_with_heap_size(vm, vm.block_bytes_allocated());
    }

    fn process_gc_timer_with_heap_size(&mut self, vm: &VM, this_heap_size: usize) {
        let prev = self.gc_last_heap_size;

        // Growth here means allocation resumed. update_gc_repeat_timer(Fast)
        // only clears idle_full_gcs_fired on a genuine slow→fast transition;
        // while the 30-tick window is running we're still in fast mode, so
        // clear it directly. The stable-tick counter is left alone —
        // resetting it from this high-frequency path would starve the idle
        // Full GC entirely.
        if this_heap_size > prev {
            self.idle_full_gcs_fired = 0;
        }

        match self.gc_timer_state {
            GCTimerState::RunOnNextTick => {
                // Only growth signals activity. A decrease is the async GC we
                // just requested freeing memory; treating it as activity would
                // cancel reduction mode and prevent the slow-interval
                // transition from ever being reached.
                if this_heap_size > prev {
                    self.schedule_gc_timer();
                    self.update_gc_repeat_timer(GcRepeatSetting::Fast);
                } else {
                    self.gc_timer_state = GCTimerState::Pending;
                }
                vm.collect_async();
                self.gc_last_heap_size = this_heap_size;
            }
            GCTimerState::Pending => {
                if this_heap_size > prev {
                    self.update_gc_repeat_timer(GcRepeatSetting::Fast);

                    if this_heap_size > prev * 2 {
                        self.perform_gc();
                    } else {
                        self.schedule_gc_timer();
                    }
                } else if this_heap_size < prev {
                    // An async GC shrank the heap. The repeating timer no
                    // longer writes gc_last_heap_size and the growth branch
                    // above won't fire until re-growth exceeds the pre-shrink
                    // value, so lower the baseline here. Don't reschedule or
                    // touch the repeat timer — that would cancel idle
                    // reduction.
                    self.gc_last_heap_size = this_heap_size;
                }
            }
            GCTimerState::Scheduled => {
                if this_heap_size > prev * 2 {
                    self.update_gc_repeat_timer(GcRepeatSetting::Fast);
                    self.perform_gc();
                }
            }
        }
    }

    pub fn perform_gc(&mut self) {
        if self.disabled {
            return;
        }
        let vm = VirtualMachine::get().jsc_vm();
        vm.collect_async();
        self.gc_last_heap_size = vm.block_bytes_allocated();
    }
}

impl Drop for GarbageCollectionController {
    fn drop(&mut self) {
        self.deinit();
    }
}

pub(crate) extern "C" fn on_gc_timer(timer: *mut uws::Timer) {
    let this = GarbageCollectionController::from_timer_ext(timer);
    if this.disabled {
        return;
    }
    this.gc_timer_state = GCTimerState::RunOnNextTick;
}

pub(crate) extern "C" fn on_gc_repeating_timer(timer: *mut uws::Timer) {
    let this = GarbageCollectionController::from_timer_ext(timer);
    if this.disabled {
        return;
    }
    let prev_heap_size = this.gc_last_heap_size_on_repeating_timer;
    let vm = VirtualMachine::get().jsc_vm();
    let current = vm.block_bytes_allocated();
    this.gc_last_heap_size_on_repeating_timer = current;

    // Reduction mode: previous tick fired collect_async_full(); decide
    // whether to fire one more or converge. V8 MemoryReducer caps at 2
    // majors per idle.
    if this.idle_full_gcs_fired > 0 {
        if current > prev_heap_size {
            this.idle_full_gcs_fired = 0;
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
            vm.collect_async();
        } else if prev_heap_size - current > (1 << 20) && this.idle_full_gcs_fired < 2 {
            this.idle_full_gcs_fired += 1;
            vm.collect_async_full();
        } else {
            this.idle_full_gcs_fired = 0;
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
            this.update_gc_repeat_timer(GcRepeatSetting::Slow);
        }
        return;
    }

    if current <= prev_heap_size {
        this.heap_size_didnt_change_for_repeating_timer_ticks_count = this
            .heap_size_didnt_change_for_repeating_timer_ticks_count
            .saturating_add(1);
        if this.gc_repeating_timer_fast
            && this.heap_size_didnt_change_for_repeating_timer_ticks_count >= 30
        {
            // 30 stable fast ticks of Eden GCs. collect_async() never
            // escalates to Full here because Heap::updateAllocationLimits
            // ratchets m_maxHeapSize on every Eden, so the 1/3 promotion
            // ratio decays instead of crossing. Fire an explicit Full so
            // old-gen + age-based CodeBlock jettison run before we go to
            // the 30s interval.
            this.idle_full_gcs_fired = 1;
            // The counter has done its job. If the allocation path observes
            // growth between this tick and the next, it clears
            // idle_full_gcs_fired (bypassing reduction mode); leaving the
            // counter at 30 would immediately re-enter this branch and fire
            // another Full GC, skipping the < 2 cap in the reduction branch.
            this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
            vm.collect_async_full();
            return;
        }
    } else {
        this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        this.update_gc_repeat_timer(GcRepeatSetting::Fast);
    }

    vm.collect_async();
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GCTimerState {
    Pending,
    Scheduled,
    RunOnNextTick,
}
