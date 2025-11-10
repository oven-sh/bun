/// DateHeaderTimer manages the periodic updating of the "Date" header in Bun.serve().
///
/// This timer ensures that HTTP responses include an up-to-date Date header by
/// updating the date every second when there are active connections.
///
/// Behavior:
/// - When sweep_timer_count > 0 (active connections), the timer should be running
/// - When sweep_timer_count = 0 (no connections), the timer doesn't get rescheduled.
/// - If the timer was already running, no changes are made.
/// - If the timer was not running and needs to start:
///   - If the last update was > 1 second ago, update the date immediately and schedule next update
///   - If the last update was < 1 second ago, just schedule the next update
///
/// Note that we only check for potential updates ot this timer once per event loop tick.
const DateHeaderTimer = @This();

event_loop_timer: jsc.API.Timer.EventLoopTimer = .{
    .tag = .DateHeaderTimer,
    .next = .epoch,
},

/// Schedule the "Date"" header timer.
///
/// The logic handles two scenarios:
/// 1. If the timer was recently updated (< 1 second ago), just reschedule it
/// 2. If the timer is stale (> 1 second since last update), update the date immediately and reschedule
pub fn enable(this: *DateHeaderTimer, vm: *VirtualMachine, now: *const bun.timespec) void {
    bun.debugAssert(this.event_loop_timer.state != .ACTIVE);

    const last_update = this.event_loop_timer.next;
    const elapsed = now.duration(&last_update).ms();

    // If the last update was more than 1 second ago, the date is stale
    if (elapsed >= std.time.ms_per_s) {
        // Update the date immediately since it's stale
        log("updating stale timer & rescheduling for 1 second later", .{});

        // updateDate() is an expensive function.
        vm.uwsLoop().updateDate();

        vm.timer.update(&this.event_loop_timer, &now.addMs(std.time.ms_per_s));
    } else {
        // The date was updated recently, just reschedule for the next second
        log("rescheduling timer", .{});
        vm.timer.insert(&this.event_loop_timer);
    }
}

pub fn run(this: *DateHeaderTimer, vm: *VirtualMachine) void {
    this.event_loop_timer.state = .FIRED;
    const loop = vm.uwsLoop();
    const now = bun.timespec.now(.allow_mocked_time);

    // Record when we last ran it.
    this.event_loop_timer.next = now;
    log("run", .{});

    // updateDate() is an expensive function.
    loop.updateDate();

    if (loop.internal_loop_data.sweep_timer_count > 0) {
        // Reschedule it automatically for 1 second later.
        this.event_loop_timer.next = now.addMs(std.time.ms_per_s);
        vm.timer.insert(&this.event_loop_timer);
    }
}

pub export fn Bun__internal_ensureDateHeaderTimerIsEnabled(loop: *uws.Loop) callconv(.c) void {
    if (jsc.VirtualMachine.getOrNull()) |vm| {
        vm.timer.updateDateHeaderTimerIfNecessary(loop, vm);
    }
}

const log = bun.Output.scoped(.DateHeaderTimer, .visible);

const std = @import("std");

const bun = @import("bun");
const uws = bun.uws;

const jsc = bun.jsc;
const VirtualMachine = jsc.VirtualMachine;
