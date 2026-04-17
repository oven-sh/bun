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

/// Container memory awareness (Issue #17723)
/// When running inside a Docker/Kubernetes container with a cgroup memory limit,
/// these fields enable RSS-based GC pressure thresholds that prevent OOM kills.
cgroup_memory_limit: ?usize = null,
cgroup_pressure_threshold: usize = 0, // 75% of limit — trigger async GC
cgroup_critical_threshold: usize = 0, // 85% of limit — trigger sync full GC
    cgroup_last_critical_gc: i64 = 0, // timestamp of last critical GC (5s cooldown)

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

    if (vm.transpiler.env.get("BUN_GC_RUNS_UNTIL_SKIP_RELEASE_ACCESS")) |val| {
        if (std.fmt.parseInt(c_int, val, 10)) |parsed| {
            if (parsed >= 0) {
                VirtualMachine.Bun__defaultRemainingRunsUntilSkipReleaseAccess = parsed;
            }
        } else |_| {}
    }

    this.disabled = vm.transpiler.env.has("BUN_GC_TIMER_DISABLE");

    // Container memory awareness (Issue #17723)
    // Detect cgroup memory limit to enable RSS-based GC pressure thresholds.
    if (bun.cgroup.getCachedMemoryLimit()) |limit| {
        this.cgroup_memory_limit = limit;
        this.cgroup_pressure_threshold = limit * 3 / 4; // 75%
        this.cgroup_critical_threshold = limit * 85 / 100; // 85%

        // In containers, force mimalloc to return freed pages to the OS immediately
        // instead of caching them for 1000ms (default). This prevents RSS from
        // staying elevated after GC, which would cause Kubernetes to OOM-kill.
        // Uses std.once to set this process-wide exactly once, even with Workers.
        if (comptime bun.use_mimalloc) {
            mimalloc_purge_once.call();
        }
    }

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
    // Never switch to slow mode inside containers — we need frequent RSS checks
    // to prevent OOM kills (Issue #17723).
    if (this.cgroup_memory_limit != null and setting == .slow) return;

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

    // Container-aware RSS pressure check (Issue #17723)
    if (this.cgroup_memory_limit != null) {
        this.checkContainerMemoryPressure();
    }

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

/// Check RSS against container memory thresholds and trigger aggressive GC
/// when approaching the cgroup limit. This is the core fix for Issue #17723.
///
/// At 75% of the limit: trigger async GC + partial mimalloc purge
/// At 85% of the limit: trigger synchronous full GC + forced mimalloc purge
///
/// Note: Each Worker has its own VirtualMachine with its own GarbageCollectionController.
/// RSS is process-wide, so multiple Workers may detect pressure simultaneously.
/// The 5-second cooldown on the critical path prevents compounding pause time.
fn checkContainerMemoryPressure(this: *GarbageCollectionController) void {
    const rss = bun.cgroup.getCurrentRSS();
    if (rss == 0) return;

    if (rss > this.cgroup_critical_threshold) {
        // CRITICAL: RSS is above 85% of the container limit.
        // Run a synchronous full GC immediately and force mimalloc to
        // return all freed pages to the OS.
        // Cooldown: skip if we already ran a critical GC within the last 5 seconds
        // to avoid compounding event-loop pause time.
        const now = std.time.milliTimestamp();
        if (now - this.cgroup_last_critical_gc < 5000) return;
        this.cgroup_last_critical_gc = now;

        var vm = this.bunVM().jsc_vm;
        _ = vm.runGC(true);
        vm.shrinkFootprint();
        if (comptime bun.use_mimalloc) {
            bun.mimalloc.mi_collect(true);
        }
        this.gc_last_heap_size = vm.blockBytesAllocated();
    } else if (rss > this.cgroup_pressure_threshold) {
        // PRESSURE: RSS is above 75% of the container limit.
        // Run an async GC and do a partial mimalloc purge.
        var vm = this.bunVM().jsc_vm;
        vm.collectAsync();
        if (comptime bun.use_mimalloc) {
            bun.mimalloc.mi_collect(false);
        }
        this.gc_last_heap_size = vm.blockBytesAllocated();
    }
}

var mimalloc_purge_once = std.once(struct {
    fn set() void {
        bun.mimalloc.mi_option_set(.purge_delay, 0);
    }
}.set);

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
