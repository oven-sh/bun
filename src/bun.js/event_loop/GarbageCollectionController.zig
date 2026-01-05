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

const GarbageCollectionController = @This();

gc_timer: *uws.Timer = undefined,
gc_last_heap_size: usize = 0,
gc_last_heap_size_on_repeating_timer: usize = 0,
heap_size_didnt_change_for_repeating_timer_ticks_count: u8 = 0,
gc_timer_state: GCTimerState = GCTimerState.pending,
gc_repeating_timer: *uws.Timer = undefined,
gc_timer_interval: i32 = 0,
gc_repeating_timer_fast: bool = true,
disabled: bool = false,

pub fn init(this: *GarbageCollectionController, vm: *VirtualMachine) void {
    const actual = uws.Loop.get();
    this.gc_timer = uws.Timer.createFallthrough(actual, this);
    this.gc_repeating_timer = uws.Timer.createFallthrough(actual, this);
    actual.internal_loop_data.jsc_vm = vm.jsc_vm;

    if (comptime Environment.isDebug) {
        if (bun.env_var.BUN_TRACK_LAST_FN_NAME.get()) {
            vm.eventLoop().debug.track_last_fn_name = true;
        }
    }

    var gc_timer_interval: i32 = 1000;
    if (vm.transpiler.env.get("BUN_GC_TIMER_INTERVAL")) |timer| {
        if (std.fmt.parseInt(i32, timer, 10)) |parsed| {
            if (parsed > 0) {
                gc_timer_interval = parsed;
            }
        } else |_| {}
    }
    this.gc_timer_interval = gc_timer_interval;

    this.disabled = vm.transpiler.env.has("BUN_GC_TIMER_DISABLE");

    if (!this.disabled)
        this.gc_repeating_timer.set(this, onGCRepeatingTimer, gc_timer_interval, gc_timer_interval);
}

pub fn deinit(this: *GarbageCollectionController) void {
    this.gc_timer.deinit(true);
    this.gc_repeating_timer.deinit(true);
}

pub fn scheduleGCTimer(this: *GarbageCollectionController) void {
    this.gc_timer_state = .scheduled;
    this.gc_timer.set(this, onGCTimer, 16, 0);
}

pub fn bunVM(this: *GarbageCollectionController) *VirtualMachine {
    return @alignCast(@fieldParentPtr("gc_controller", this));
}

pub fn onGCTimer(timer: *uws.Timer) callconv(.c) void {
    var this = timer.as(*GarbageCollectionController);
    if (this.disabled) return;
    this.gc_timer_state = .run_on_next_tick;
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
pub fn updateGCRepeatTimer(this: *GarbageCollectionController, comptime setting: @Type(.enum_literal)) void {
    if (setting == .fast and !this.gc_repeating_timer_fast) {
        this.gc_repeating_timer_fast = true;
        this.gc_repeating_timer.set(this, onGCRepeatingTimer, this.gc_timer_interval, this.gc_timer_interval);
        this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
    } else if (setting == .slow and this.gc_repeating_timer_fast) {
        this.gc_repeating_timer_fast = false;
        this.gc_repeating_timer.set(this, onGCRepeatingTimer, 30_000, 30_000);
        this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
    }
}

pub fn onGCRepeatingTimer(timer: *uws.Timer) callconv(.c) void {
    var this = timer.as(*GarbageCollectionController);
    const prev_heap_size = this.gc_last_heap_size_on_repeating_timer;
    this.performGC();
    this.gc_last_heap_size_on_repeating_timer = this.gc_last_heap_size;
    if (prev_heap_size == this.gc_last_heap_size_on_repeating_timer) {
        this.heap_size_didnt_change_for_repeating_timer_ticks_count +|= 1;
        if (this.heap_size_didnt_change_for_repeating_timer_ticks_count >= 30) {
            // make the timer interval longer
            this.updateGCRepeatTimer(.slow);
        }
    } else {
        this.heap_size_didnt_change_for_repeating_timer_ticks_count = 0;
        this.updateGCRepeatTimer(.fast);
    }
}

pub fn processGCTimer(this: *GarbageCollectionController) void {
    if (this.disabled) return;
    var vm = this.bunVM().jsc_vm;
    this.processGCTimerWithHeapSize(vm, vm.blockBytesAllocated());
}

fn processGCTimerWithHeapSize(this: *GarbageCollectionController, vm: *jsc.VM, this_heap_size: usize) void {
    const prev = this.gc_last_heap_size;

    switch (this.gc_timer_state) {
        .run_on_next_tick => {
            // When memory usage is not stable, run the GC more.
            if (this_heap_size != prev) {
                this.scheduleGCTimer();
                this.updateGCRepeatTimer(.fast);
            } else {
                this.gc_timer_state = .pending;
            }
            vm.collectAsync();
            this.gc_last_heap_size = this_heap_size;
        },
        .pending => {
            if (this_heap_size != prev) {
                this.updateGCRepeatTimer(.fast);

                if (this_heap_size > prev * 2) {
                    this.performGC();
                } else {
                    this.scheduleGCTimer();
                }
            }
        },
        .scheduled => {
            if (this_heap_size > prev * 2) {
                this.updateGCRepeatTimer(.fast);
                this.performGC();
            }
        },
    }
}

pub fn performGC(this: *GarbageCollectionController) void {
    if (this.disabled) return;
    var vm = this.bunVM().jsc_vm;
    vm.collectAsync();
    this.gc_last_heap_size = vm.blockBytesAllocated();
}

pub const GCTimerState = enum {
    pending,
    scheduled,
    run_on_next_tick,
};

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const uws = bun.uws;

const jsc = bun.jsc;
const VirtualMachine = jsc.VirtualMachine;
