const std = @import("std");

const bun = @import("bun");

const jsc = bun.jsc;
const VirtualMachine = jsc.VirtualMachine;

const EventLoopDelayMonitor = @This();

js_histogram: ?*anyopaque = null,
event_loop_timer: jsc.API.Timer.EventLoopTimer = .{
    .next = .epoch,
    .tag = .EventLoopDelayMonitor,
},
resolution_ms: i32 = 10,
last_fire_ns: u64 = 0,
enabled: bool = false,

pub fn enable(this: *EventLoopDelayMonitor, vm: *VirtualMachine, histogram: *anyopaque, resolution_ms: i32) void {
    this.js_histogram = histogram;
    this.resolution_ms = resolution_ms;
    this.last_fire_ns = bun.timespec.now().ns();
    this.enabled = true;
    
    // Schedule timer
    const now = bun.timespec.now();
    this.event_loop_timer.next = now.addMs(@intCast(resolution_ms));
    vm.timer.insert(&this.event_loop_timer);
}

pub fn disable(this: *EventLoopDelayMonitor, vm: *VirtualMachine) void {
    if (!this.enabled) return;
    
    this.enabled = false;
    this.js_histogram = null;
    vm.timer.remove(&this.event_loop_timer);
}

pub fn isEnabled(this: *const EventLoopDelayMonitor) bool {
    return this.enabled and this.js_histogram != null;
}

pub fn onFire(this: *EventLoopDelayMonitor, vm: *VirtualMachine) void {
    if (!this.enabled or this.js_histogram == null) return;
    
    const now_ns = bun.timespec.now().ns();
    if (this.last_fire_ns > 0) {
        const expected_ns = @as(u64, @intCast(this.resolution_ms)) * 1_000_000;
        const actual_ns = now_ns - this.last_fire_ns;
        
        if (actual_ns > expected_ns) {
            const delay_ns = @as(i64, @intCast(actual_ns - expected_ns));
            JSNodePerformanceHooksHistogram_recordDelay(this.js_histogram.?, delay_ns);
        }
    }
    
    this.last_fire_ns = now_ns;
    
    // Reschedule
    const now = bun.timespec.now();
    this.event_loop_timer.next = now.addMs(@intCast(this.resolution_ms));
    vm.timer.insert(&this.event_loop_timer);
}

// Record delay to histogram
extern fn JSNodePerformanceHooksHistogram_recordDelay(histogram: *anyopaque, delay_ns: i64) void;

// Export functions for C++
export fn Timer_enableEventLoopDelayMonitoring(vm: *VirtualMachine, histogram: *anyopaque, resolution_ms: i32) void {
    vm.timer.event_loop_delay.enable(vm, histogram, resolution_ms);
}

export fn Timer_disableEventLoopDelayMonitoring(vm: *VirtualMachine, histogram: *anyopaque) void {
    _ = histogram;
    vm.timer.event_loop_delay.disable(vm);
}