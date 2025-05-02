const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const VirtualMachine = jsc.VirtualMachine;
const EventLoopTimer = bun.api.Timer.EventLoopTimer;

/// This is WTF::RunLoop::TimerBase from WebKit
const RunLoopTimer = opaque {
    pub fn fire(this: *RunLoopTimer) void {
        WTFTimer__fire(this);
    }
};

/// A timer created by WTF code and invoked by Bun's event loop
const WTFTimer = @This();

vm: *VirtualMachine,
run_loop_timer: *RunLoopTimer,
event_loop_timer: EventLoopTimer,
imminent: *std.atomic.Value(?*WTFTimer),
repeat: bool,
lock: bun.Mutex = .{},

const new = bun.TrivialNew(WTFTimer);

pub export fn WTFTimer__runIfImminent(vm: *VirtualMachine) void {
    vm.eventLoop().runImminentGCTimer();
}

pub fn run(this: *WTFTimer, vm: *VirtualMachine) void {
    if (this.event_loop_timer.state == .ACTIVE) {
        vm.timer.remove(&this.event_loop_timer);
    }
    this.runWithoutRemoving();
}

inline fn runWithoutRemoving(this: *const WTFTimer) void {
    this.run_loop_timer.fire();
}

pub fn update(this: *WTFTimer, seconds: f64, repeat: bool) void {
    // There's only one of these per VM, and each VM has its own imminent_gc_timer
    this.imminent.store(if (seconds == 0) this else null, .seq_cst);

    if (seconds == 0.0) {
        return;
    }

    const modf = std.math.modf(seconds);
    var interval = bun.timespec.now();
    interval.sec += @intFromFloat(modf.ipart);
    interval.nsec += @intFromFloat(modf.fpart * std.time.ns_per_s);
    if (interval.nsec >= std.time.ns_per_s) {
        interval.sec += 1;
        interval.nsec -= std.time.ns_per_s;
    }

    this.vm.timer.update(&this.event_loop_timer, &interval);
    this.repeat = repeat;
}

pub fn cancel(this: *WTFTimer) void {
    this.lock.lock();
    defer this.lock.unlock();
    this.imminent.store(null, .seq_cst);
    if (this.event_loop_timer.state == .ACTIVE) {
        this.vm.timer.remove(&this.event_loop_timer);
    }
}

pub fn fire(this: *WTFTimer, _: *const bun.timespec, _: *VirtualMachine) EventLoopTimer.Arm {
    this.event_loop_timer.state = .FIRED;
    this.imminent.store(null, .seq_cst);
    this.runWithoutRemoving();
    return if (this.repeat)
        .{ .rearm = this.event_loop_timer.next }
    else
        .disarm;
}

pub fn deinit(this: *WTFTimer) void {
    this.cancel();
    bun.destroy(this);
}

export fn WTFTimer__create(run_loop_timer: *RunLoopTimer) ?*anyopaque {
    if (VirtualMachine.is_bundler_thread_for_bytecode_cache) {
        return null;
    }

    const vm = VirtualMachine.get();

    const this = WTFTimer.new(.{
        .vm = vm,
        .imminent = &vm.eventLoop().imminent_gc_timer,
        .event_loop_timer = .{
            .next = .{
                .sec = std.math.maxInt(i64),
                .nsec = 0,
            },
            .tag = .WTFTimer,
            .state = .CANCELLED,
        },
        .run_loop_timer = run_loop_timer,
        .repeat = false,
    });

    return this;
}

export fn WTFTimer__update(this: *WTFTimer, seconds: f64, repeat: bool) void {
    this.update(seconds, repeat);
}

export fn WTFTimer__deinit(this: *WTFTimer) void {
    this.deinit();
}

export fn WTFTimer__isActive(this: *const WTFTimer) bool {
    return this.event_loop_timer.state == .ACTIVE or (this.imminent.load(.seq_cst) orelse return false) == this;
}

export fn WTFTimer__cancel(this: *WTFTimer) void {
    this.cancel();
}

export fn WTFTimer__secondsUntilTimer(this: *WTFTimer) f64 {
    this.lock.lock();
    defer this.lock.unlock();
    if (this.event_loop_timer.state == .ACTIVE) {
        const until = this.event_loop_timer.next.duration(&bun.timespec.now());
        const sec: f64, const nsec: f64 = .{ @floatFromInt(until.sec), @floatFromInt(until.nsec) };
        return sec + nsec / std.time.ns_per_s;
    }
    return std.math.inf(f64);
}

extern fn WTFTimer__fire(this: *RunLoopTimer) void;
