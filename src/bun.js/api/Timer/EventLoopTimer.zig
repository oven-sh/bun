const EventLoopTimer = @This();

/// The absolute time to fire this timer next.
next: timespec,
state: State = .PENDING,
tag: Tag,
/// Internal heap fields.
heap: bun.io.heap.IntrusiveField(EventLoopTimer) = .{},

pub fn initPaused(tag: Tag) EventLoopTimer {
    return .{
        .next = .{},
        .tag = tag,
    };
}

pub fn less(_: void, a: *const EventLoopTimer, b: *const EventLoopTimer) bool {
    const sec_order = std.math.order(a.next.sec, b.next.sec);
    if (sec_order != .eq) return sec_order == .lt;

    // collapse sub-millisecond precision for JavaScript timers
    const maybe_a_internals = a.jsTimerInternals();
    const maybe_b_internals = b.jsTimerInternals();
    var a_ns = a.next.nsec;
    var b_ns = b.next.nsec;
    if (maybe_a_internals != null) a_ns = std.time.ns_per_ms * @divTrunc(a_ns, std.time.ns_per_ms);
    if (maybe_b_internals != null) b_ns = std.time.ns_per_ms * @divTrunc(b_ns, std.time.ns_per_ms);

    const order = std.math.order(a_ns, b_ns);
    if (order == .eq) {
        if (maybe_a_internals) |a_internals| {
            if (maybe_b_internals) |b_internals| {
                // We expect that the epoch will overflow sometimes.
                // If it does, we would ideally like timers with an epoch from before the
                // overflow to be sorted *before* timers with an epoch from after the overflow
                // (even though their epoch will be numerically *larger*).
                //
                // Wrapping subtraction gives us a distance that is consistent even if one
                // epoch has overflowed and the other hasn't. If the distance from a to b is
                // small, it's likely that b is really newer than a, so we consider a less than
                // b. If the distance from a to b is large (greater than half the u25 range),
                // it's more likely that b is older than a so the true distance is from b to a.
                return b_internals.flags.epoch -% a_internals.flags.epoch < std.math.maxInt(u25) / 2;
            }
        }
    }
    return order == .lt;
}

pub const Tag = if (Environment.isWindows) enum {
    TimerCallback,
    TimeoutObject,
    ImmediateObject,
    TestRunner,
    StatWatcherScheduler,
    UpgradedDuplex,
    DNSResolver,
    WindowsNamedPipe,
    WTFTimer,
    PostgresSQLConnectionTimeout,
    PostgresSQLConnectionMaxLifetime,
    ValkeyConnectionTimeout,
    ValkeyConnectionReconnect,
    SubprocessTimeout,
    DevServerSweepSourceMaps,
    DevServerMemoryVisualizerTick,

    pub fn Type(comptime T: Tag) type {
        return switch (T) {
            .TimerCallback => TimerCallback,
            .TimeoutObject => TimeoutObject,
            .ImmediateObject => ImmediateObject,
            .TestRunner => JSC.Jest.TestRunner,
            .StatWatcherScheduler => StatWatcherScheduler,
            .UpgradedDuplex => uws.UpgradedDuplex,
            .DNSResolver => DNSResolver,
            .WindowsNamedPipe => uws.WindowsNamedPipe,
            .WTFTimer => WTFTimer,
            .PostgresSQLConnectionTimeout => JSC.Postgres.PostgresSQLConnection,
            .PostgresSQLConnectionMaxLifetime => JSC.Postgres.PostgresSQLConnection,
            .SubprocessTimeout => JSC.Subprocess,
            .ValkeyConnectionReconnect => JSC.API.Valkey,
            .ValkeyConnectionTimeout => JSC.API.Valkey,
            .DevServerSweepSourceMaps,
            .DevServerMemoryVisualizerTick,
            => bun.bake.DevServer,
        };
    }
} else enum {
    TimerCallback,
    TimeoutObject,
    ImmediateObject,
    TestRunner,
    StatWatcherScheduler,
    UpgradedDuplex,
    WTFTimer,
    DNSResolver,
    PostgresSQLConnectionTimeout,
    PostgresSQLConnectionMaxLifetime,
    ValkeyConnectionTimeout,
    ValkeyConnectionReconnect,
    SubprocessTimeout,
    DevServerSweepSourceMaps,
    DevServerMemoryVisualizerTick,

    pub fn Type(comptime T: Tag) type {
        return switch (T) {
            .TimerCallback => TimerCallback,
            .TimeoutObject => TimeoutObject,
            .ImmediateObject => ImmediateObject,
            .TestRunner => JSC.Jest.TestRunner,
            .StatWatcherScheduler => StatWatcherScheduler,
            .UpgradedDuplex => uws.UpgradedDuplex,
            .WTFTimer => WTFTimer,
            .DNSResolver => DNSResolver,
            .PostgresSQLConnectionTimeout => JSC.Postgres.PostgresSQLConnection,
            .PostgresSQLConnectionMaxLifetime => JSC.Postgres.PostgresSQLConnection,
            .ValkeyConnectionTimeout => JSC.API.Valkey,
            .ValkeyConnectionReconnect => JSC.API.Valkey,
            .SubprocessTimeout => JSC.Subprocess,
            .DevServerSweepSourceMaps,
            .DevServerMemoryVisualizerTick,
            => bun.bake.DevServer,
        };
    }
};

const TimerCallback = struct {
    callback: *const fn (*TimerCallback) Arm,
    ctx: *anyopaque,
    event_loop_timer: EventLoopTimer,
};

pub const State = enum {
    /// The timer is waiting to be enabled.
    PENDING,

    /// The timer is active and will fire at the next time.
    ACTIVE,

    /// The timer has been cancelled and will not fire.
    CANCELLED,

    /// The timer has fired and the callback has been called.
    FIRED,
};

/// If self was created by set{Immediate,Timeout,Interval}, get a pointer to the common data
/// for all those kinds of timers
pub fn jsTimerInternals(self: anytype) switch (@TypeOf(self)) {
    *EventLoopTimer => ?*TimerObjectInternals,
    *const EventLoopTimer => ?*const TimerObjectInternals,
    else => |T| @compileError("wrong type " ++ @typeName(T) ++ " passed to jsTimerInternals"),
} {
    switch (self.tag) {
        inline .TimeoutObject, .ImmediateObject => |tag| {
            const parent: switch (@TypeOf(self)) {
                *EventLoopTimer => *tag.Type(),
                *const EventLoopTimer => *const tag.Type(),
                else => unreachable,
            } = @fieldParentPtr("event_loop_timer", self);
            return &parent.internals;
        },
        else => return null,
    }
}

fn ns(self: *const EventLoopTimer) u64 {
    return self.next.ns();
}

pub const Arm = union(enum) {
    rearm: timespec,
    disarm,
};

pub fn fire(this: *EventLoopTimer, now: *const timespec, vm: *VirtualMachine) Arm {
    switch (this.tag) {
        .PostgresSQLConnectionTimeout => return @as(*api.Postgres.PostgresSQLConnection, @alignCast(@fieldParentPtr("timer", this))).onConnectionTimeout(),
        .PostgresSQLConnectionMaxLifetime => return @as(*api.Postgres.PostgresSQLConnection, @alignCast(@fieldParentPtr("max_lifetime_timer", this))).onMaxLifetimeTimeout(),
        .ValkeyConnectionTimeout => return @as(*api.Valkey, @alignCast(@fieldParentPtr("timer", this))).onConnectionTimeout(),
        .ValkeyConnectionReconnect => return @as(*api.Valkey, @alignCast(@fieldParentPtr("reconnect_timer", this))).onReconnectTimer(),
        .DevServerMemoryVisualizerTick => return bun.bake.DevServer.emitMemoryVisualizerMessageTimer(this, now),
        .DevServerSweepSourceMaps => return bun.bake.DevServer.SourceMapStore.sweepWeakRefs(this, now),
        inline else => |t| {
            if (@FieldType(t.Type(), "event_loop_timer") != EventLoopTimer) {
                @compileError(@typeName(t.Type()) ++ " has wrong type for 'event_loop_timer'");
            }
            var container: *t.Type() = @alignCast(@fieldParentPtr("event_loop_timer", this));
            if (comptime t.Type() == TimeoutObject or t.Type() == ImmediateObject) {
                return container.internals.fire(now, vm);
            }

            if (comptime t.Type() == WTFTimer) {
                return container.fire(now, vm);
            }

            if (comptime t.Type() == StatWatcherScheduler) {
                return container.timerCallback();
            }
            if (comptime t.Type() == uws.UpgradedDuplex) {
                return container.onTimeout();
            }
            if (Environment.isWindows) {
                if (comptime t.Type() == uws.WindowsNamedPipe) {
                    return container.onTimeout();
                }
            }

            if (comptime t.Type() == JSC.Jest.TestRunner) {
                container.onTestTimeout(now, vm);
                return .disarm;
            }

            if (comptime t.Type() == DNSResolver) {
                return container.checkTimeouts(now, vm);
            }

            if (comptime t.Type() == JSC.Subprocess) {
                return container.timeoutCallback();
            }

            return container.callback(container);
        },
    }
}

pub fn deinit(_: *EventLoopTimer) void {}

const timespec = bun.timespec;

/// A timer created by WTF code and invoked by Bun's event loop
const WTFTimer = @import("../../WTFTimer.zig");
const VirtualMachine = JSC.VirtualMachine;
const TimerObjectInternals = @import("../Timer.zig").TimerObjectInternals;
const TimeoutObject = @import("../Timer.zig").TimeoutObject;
const ImmediateObject = @import("../Timer.zig").ImmediateObject;
const StatWatcherScheduler = @import("../../node/node_fs_stat_watcher.zig").StatWatcherScheduler;
const DNSResolver = @import("../bun/dns_resolver.zig").DNSResolver;

const bun = @import("bun");
const std = @import("std");
const Environment = bun.Environment;
const JSC = bun.JSC;

const uws = bun.uws;
const api = JSC.API;
