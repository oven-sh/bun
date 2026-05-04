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
use core::mem::offset_of;

use bun_core::env_var;
use bun_jsc::{VirtualMachine, VM};
use bun_uws as uws;

pub struct GarbageCollectionController {
    // TODO(port): lifetime — FFI handle created by uws::Timer::create_fallthrough, freed in Drop
    pub gc_timer: *mut uws::Timer,
    pub gc_last_heap_size: usize,
    pub gc_last_heap_size_on_repeating_timer: usize,
    pub heap_size_didnt_change_for_repeating_timer_ticks_count: u8,
    pub gc_timer_state: GCTimerState,
    // TODO(port): lifetime — FFI handle created by uws::Timer::create_fallthrough, freed in Drop
    pub gc_repeating_timer: *mut uws::Timer,
    pub gc_timer_interval: i32,
    pub gc_repeating_timer_fast: bool,
    pub disabled: bool,
}

impl Default for GarbageCollectionController {
    fn default() -> Self {
        Self {
            gc_timer: core::ptr::null_mut(),
            gc_last_heap_size: 0,
            gc_last_heap_size_on_repeating_timer: 0,
            heap_size_didnt_change_for_repeating_timer_ticks_count: 0,
            gc_timer_state: GCTimerState::Pending,
            gc_repeating_timer: core::ptr::null_mut(),
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
    pub fn init(&mut self, vm: &mut VirtualMachine) {
        let actual = uws::Loop::get();
        self.gc_timer = uws::Timer::create_fallthrough(actual, self as *mut Self as *mut core::ffi::c_void);
        self.gc_repeating_timer = uws::Timer::create_fallthrough(actual, self as *mut Self as *mut core::ffi::c_void);
        actual.internal_loop_data.jsc_vm = vm.jsc_vm;

        #[cfg(debug_assertions)]
        {
            // TODO(port): env_var accessor return type (bool vs Option) — verify in Phase B
            if env_var::BUN_TRACK_LAST_FN_NAME.get() {
                vm.event_loop().debug.track_last_fn_name = true;
            }
        }

        let mut gc_timer_interval: i32 = 1000;
        if let Some(timer) = vm.transpiler.env.get(b"BUN_GC_TIMER_INTERVAL") {
            if let Some(parsed) = parse_int_i32(timer) {
                if parsed > 0 {
                    gc_timer_interval = parsed;
                }
            }
        }
        self.gc_timer_interval = gc_timer_interval;

        if let Some(val) = vm.transpiler.env.get(b"BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS") {
            if let Some(parsed) = parse_int_c_int(val) {
                if parsed >= 0 {
                    // SAFETY: single-threaded init; mirrors Zig assignment to extern var
                    unsafe {
                        VirtualMachine::Bun__defaultRemainingRunsUntilSkipReleaseAccess = parsed;
                    }
                }
            }
        }

        self.disabled = vm.transpiler.env.has(b"BUN_GC_TIMER_DISABLE");

        if !self.disabled {
            // SAFETY: gc_repeating_timer was just created above and is non-null
            unsafe {
                (*self.gc_repeating_timer).set(
                    self as *mut Self as *mut core::ffi::c_void,
                    on_gc_repeating_timer,
                    gc_timer_interval,
                    gc_timer_interval,
                );
            }
        }
    }

    pub fn schedule_gc_timer(&mut self) {
        self.gc_timer_state = GCTimerState::Scheduled;
        // SAFETY: gc_timer is non-null after init()
        unsafe {
            (*self.gc_timer).set(
                self as *mut Self as *mut core::ffi::c_void,
                on_gc_timer,
                16,
                0,
            );
        }
    }

    pub fn bun_vm(&mut self) -> &mut VirtualMachine {
        // SAFETY: self is the `gc_controller` field embedded in a VirtualMachine
        unsafe {
            &mut *(self as *mut Self as *mut u8)
                .sub(offset_of!(VirtualMachine, gc_controller))
                .cast::<VirtualMachine>()
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
    // PERF(port): was comptime enum-literal monomorphization — profile in Phase B
    pub fn update_gc_repeat_timer(&mut self, setting: GcRepeatSetting) {
        if setting == GcRepeatSetting::Fast && !self.gc_repeating_timer_fast {
            self.gc_repeating_timer_fast = true;
            // SAFETY: gc_repeating_timer is non-null after init()
            unsafe {
                (*self.gc_repeating_timer).set(
                    self as *mut Self as *mut core::ffi::c_void,
                    on_gc_repeating_timer,
                    self.gc_timer_interval,
                    self.gc_timer_interval,
                );
            }
            self.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        } else if setting == GcRepeatSetting::Slow && self.gc_repeating_timer_fast {
            self.gc_repeating_timer_fast = false;
            // SAFETY: gc_repeating_timer is non-null after init()
            unsafe {
                (*self.gc_repeating_timer).set(
                    self as *mut Self as *mut core::ffi::c_void,
                    on_gc_repeating_timer,
                    30_000,
                    30_000,
                );
            }
            self.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        }
    }

    pub fn process_gc_timer(&mut self) {
        if self.disabled {
            return;
        }
        let vm = self.bun_vm().jsc_vm;
        self.process_gc_timer_with_heap_size(vm, vm.block_bytes_allocated());
    }

    fn process_gc_timer_with_heap_size(&mut self, vm: &VM, this_heap_size: usize) {
        let prev = self.gc_last_heap_size;

        match self.gc_timer_state {
            GCTimerState::RunOnNextTick => {
                // When memory usage is not stable, run the GC more.
                if this_heap_size != prev {
                    self.schedule_gc_timer();
                    self.update_gc_repeat_timer(GcRepeatSetting::Fast);
                } else {
                    self.gc_timer_state = GCTimerState::Pending;
                }
                vm.collect_async();
                self.gc_last_heap_size = this_heap_size;
            }
            GCTimerState::Pending => {
                if this_heap_size != prev {
                    self.update_gc_repeat_timer(GcRepeatSetting::Fast);

                    if this_heap_size > prev * 2 {
                        self.perform_gc();
                    } else {
                        self.schedule_gc_timer();
                    }
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
        let vm = self.bun_vm().jsc_vm;
        vm.collect_async();
        self.gc_last_heap_size = vm.block_bytes_allocated();
    }
}

impl Drop for GarbageCollectionController {
    fn drop(&mut self) {
        // SAFETY: timers are non-null after init(); deinit(true) frees the uws timer
        unsafe {
            (*self.gc_timer).deinit(true);
            (*self.gc_repeating_timer).deinit(true);
        }
    }
}

pub extern "C" fn on_gc_timer(timer: *mut uws::Timer) {
    // SAFETY: timer ext data was set to *mut GarbageCollectionController in init()
    let this = unsafe { &mut *uws::Timer::r#as::<GarbageCollectionController>(timer) };
    if this.disabled {
        return;
    }
    this.gc_timer_state = GCTimerState::RunOnNextTick;
}

pub extern "C" fn on_gc_repeating_timer(timer: *mut uws::Timer) {
    // SAFETY: timer ext data was set to *mut GarbageCollectionController in init()
    let this = unsafe { &mut *uws::Timer::r#as::<GarbageCollectionController>(timer) };
    let prev_heap_size = this.gc_last_heap_size_on_repeating_timer;
    this.perform_gc();
    this.gc_last_heap_size_on_repeating_timer = this.gc_last_heap_size;
    if prev_heap_size == this.gc_last_heap_size_on_repeating_timer {
        this.heap_size_didnt_change_for_repeating_timer_ticks_count =
            this.heap_size_didnt_change_for_repeating_timer_ticks_count.saturating_add(1);
        if this.heap_size_didnt_change_for_repeating_timer_ticks_count >= 30 {
            // make the timer interval longer
            this.update_gc_repeat_timer(GcRepeatSetting::Slow);
        }
    } else {
        this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        this.update_gc_repeat_timer(GcRepeatSetting::Fast);
    }
}

#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum GCTimerState {
    Pending,
    Scheduled,
    RunOnNextTick,
}

// TODO(port): std.fmt.parseInt equivalent — env vars are ASCII so from_utf8 is fine here
#[inline]
fn parse_int_i32(s: &[u8]) -> Option<i32> {
    core::str::from_utf8(s).ok()?.parse::<i32>().ok()
}

#[inline]
fn parse_int_c_int(s: &[u8]) -> Option<c_int> {
    core::str::from_utf8(s).ok()?.parse::<c_int>().ok()
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/GarbageCollectionController.zig (190 lines)
//   confidence: medium
//   todos:      4
//   notes:      LIFETIMES.tsv had no rows; *uws.Timer fields kept raw (FFI). update_gc_repeat_timer demoted comptime enum-literal to runtime enum. Timer.set/as API surface guessed from Zig usage.
// ──────────────────────────────────────────────────────────────────────────
