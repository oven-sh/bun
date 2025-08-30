const Self = @This();

/// The absolute time to fire this timer next.
next: timespec,
state: State = .PENDING,
tag: Tag,
/// Internal heap fields.
heap: bun.io.heap.IntrusiveField(Self) = .{},

pub fn initPaused(tag: Tag) Self {
    return .{
        .next = .epoch,
        .tag = tag,
    };
}

pub fn less(_: void, a: *const Self, b: *const Self) bool {
    const sec_order = std.math.order(a.next.sec, b.next.sec);
    if (sec_order != .eq) return sec_order == .lt;

    // collapse sub-millisecond precision for JavaScript timers
    const maybe_a_flags = a.jsTimerInternalsFlags();
    const maybe_b_flags = b.jsTimerInternalsFlags();
    var a_ns = a.next.nsec;
    var b_ns = b.next.nsec;
    if (maybe_a_flags != null) a_ns = std.time.ns_per_ms * @divTrunc(a_ns, std.time.ns_per_ms);
    if (maybe_b_flags != null) b_ns = std.time.ns_per_ms * @divTrunc(b_ns, std.time.ns_per_ms);

    const order = std.math.order(a_ns, b_ns);
    if (order == .eq) {
        if (maybe_a_flags) |a_flags| {
            if (maybe_b_flags) |b_flags| {
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
                return b_flags.epoch -% a_flags.epoch < std.math.maxInt(u25) / 2;
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
    MySQLConnectionTimeout,
    MySQLConnectionMaxLifetime,
    ValkeyConnectionTimeout,
    ValkeyConnectionReconnect,
    SubprocessTimeout,
    DevServerSweepSourceMaps,
    DevServerMemoryVisualizerTick,
    AbortSignalTimeout,
    DateHeaderTimer,

    pub fn Type(comptime T: Tag) type {
        return switch (T) {
            .TimerCallback => TimerCallback,
            .TimeoutObject => TimeoutObject,
            .ImmediateObject => ImmediateObject,
            .TestRunner => jsc.Jest.TestRunner,
            .StatWatcherScheduler => StatWatcherScheduler,
            .UpgradedDuplex => uws.UpgradedDuplex,
            .DNSResolver => DNSResolver,
            .WindowsNamedPipe => uws.WindowsNamedPipe,
            .WTFTimer => WTFTimer,
            .PostgresSQLConnectionTimeout => jsc.Postgres.PostgresSQLConnection,
            .PostgresSQLConnectionMaxLifetime => jsc.Postgres.PostgresSQLConnection,
            .MySQLConnectionTimeout => jsc.MySQL.MySQLConnection,
            .MySQLConnectionMaxLifetime => jsc.MySQL.MySQLConnection,
            .SubprocessTimeout => jsc.Subprocess,
            .ValkeyConnectionReconnect => jsc.API.Valkey,
            .ValkeyConnectionTimeout => jsc.API.Valkey,
            .DevServerSweepSourceMaps,
            .DevServerMemoryVisualizerTick,
            => bun.bake.DevServer,
            .AbortSignalTimeout => jsc.WebCore.AbortSignal.Timeout,
            .DateHeaderTimer => jsc.API.Timer.DateHeaderTimer,
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
    MySQLConnectionTimeout,
    MySQLConnectionMaxLifetime,
    ValkeyConnectionTimeout,
    ValkeyConnectionReconnect,
    SubprocessTimeout,
    DevServerSweepSourceMaps,
    DevServerMemoryVisualizerTick,
    AbortSignalTimeout,
    DateHeaderTimer,

    pub fn Type(comptime T: Tag) type {
        return switch (T) {
            .TimerCallback => TimerCallback,
            .TimeoutObject => TimeoutObject,
            .ImmediateObject => ImmediateObject,
            .TestRunner => jsc.Jest.TestRunner,
            .StatWatcherScheduler => StatWatcherScheduler,
            .UpgradedDuplex => uws.UpgradedDuplex,
            .WTFTimer => WTFTimer,
            .DNSResolver => DNSResolver,
            .PostgresSQLConnectionTimeout => jsc.Postgres.PostgresSQLConnection,
            .PostgresSQLConnectionMaxLifetime => jsc.Postgres.PostgresSQLConnection,
            .MySQLConnectionTimeout => jsc.MySQL.MySQLConnection,
            .MySQLConnectionMaxLifetime => jsc.MySQL.MySQLConnection,
            .ValkeyConnectionTimeout => jsc.API.Valkey,
            .ValkeyConnectionReconnect => jsc.API.Valkey,
            .SubprocessTimeout => jsc.Subprocess,
            .DevServerSweepSourceMaps,
            .DevServerMemoryVisualizerTick,
            => bun.bake.DevServer,
            .AbortSignalTimeout => jsc.WebCore.AbortSignal.Timeout,
            .DateHeaderTimer => jsc.API.Timer.DateHeaderTimer,
        };
    }
};

const TimerCallback = struct {
    callback: *const fn (*TimerCallback) Arm,
    ctx: *anyopaque,
    event_loop_timer: Self,
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
pub fn jsTimerInternalsFlags(self: anytype) switch (@TypeOf(self)) {
    *Self => ?*TimerObjectInternals.Flags,
    *const Self => ?*const TimerObjectInternals.Flags,
    else => |T| @compileError("wrong type " ++ @typeName(T) ++ " passed to jsTimerInternalsFlags"),
} {
    switch (self.tag) {
        inline .TimeoutObject, .ImmediateObject, .AbortSignalTimeout => |tag| {
            const parent: switch (@TypeOf(self)) {
                *Self => *tag.Type(),
                *const Self => *const tag.Type(),
                else => unreachable,
            } = @fieldParentPtr("event_loop_timer", self);
            return if (comptime std.meta.Child(@TypeOf(parent)) == jsc.WebCore.AbortSignal.Timeout)
                &parent.flags
            else
                &parent.internals.flags;
        },
        else => return null,
    }
}

fn ns(self: *const Self) u64 {
    return self.next.ns();
}

pub const Arm = union(enum) {
    rearm: timespec,
    disarm,
};

pub fn fire(self: *Self, now: *const timespec, vm: *VirtualMachine) Arm {
    switch (self.tag) {
        .PostgresSQLConnectionTimeout => return @as(*api.Postgres.PostgresSQLConnection, @alignCast(@fieldParentPtr("timer", self))).onConnectionTimeout(),
        .PostgresSQLConnectionMaxLifetime => return @as(*api.Postgres.PostgresSQLConnection, @alignCast(@fieldParentPtr("max_lifetime_timer", self))).onMaxLifetimeTimeout(),
        .MySQLConnectionTimeout => return @as(*api.MySQL.MySQLConnection, @alignCast(@fieldParentPtr("timer", self))).onConnectionTimeout(),
        .MySQLConnectionMaxLifetime => return @as(*api.MySQL.MySQLConnection, @alignCast(@fieldParentPtr("max_lifetime_timer", self))).onMaxLifetimeTimeout(),
        .ValkeyConnectionTimeout => return @as(*api.Valkey, @alignCast(@fieldParentPtr("timer", self))).onConnectionTimeout(),
        .ValkeyConnectionReconnect => return @as(*api.Valkey, @alignCast(@fieldParentPtr("reconnect_timer", self))).onReconnectTimer(),
        .DevServerMemoryVisualizerTick => return bun.bake.DevServer.emitMemoryVisualizerMessageTimer(self, now),
        .DevServerSweepSourceMaps => return bun.bake.DevServer.SourceMapStore.sweepWeakRefs(self, now),
        .AbortSignalTimeout => {
            const timeout = @as(*jsc.WebCore.AbortSignal.Timeout, @fieldParentPtr("event_loop_timer", self));
            timeout.run(vm);
            return .disarm;
        },
        .DateHeaderTimer => {
            const date_header_timer = @as(*jsc.API.Timer.DateHeaderTimer, @fieldParentPtr("event_loop_timer", self));
            date_header_timer.run(vm);
            return .disarm;
        },
        inline else => |t| {
            if (@FieldType(t.Type(), "event_loop_timer") != Self) {
                @compileError(@typeName(t.Type()) ++ " has wrong type for 'event_loop_timer'");
            }
            var container: *t.Type() = @alignCast(@fieldParentPtr("event_loop_timer", self));
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

            if (comptime t.Type() == jsc.Jest.TestRunner) {
                container.onTestTimeout(now, vm);
                return .disarm;
            }

            if (comptime t.Type() == DNSResolver) {
                return container.checkTimeouts(now, vm);
            }

            if (comptime t.Type() == jsc.Subprocess) {
                return container.timeoutCallback();
            }

            return container.callback(container);
        },
    }
}

pub fn deinit(_: *Self) void {}

/// A timer created by WTF code and invoked by Bun's event loop
const WTFTimer = bun.api.Timer.WTFTimer;

const std = @import("std");
const StatWatcherScheduler = @import("../../node/node_fs_stat_watcher.zig").StatWatcherScheduler;

const bun = @import("bun");
const Environment = bun.Environment;
const timespec = bun.timespec;
const uws = bun.uws;
const DNSResolver = bun.api.dns.Resolver;

const ImmediateObject = bun.api.Timer.ImmediateObject;
const TimeoutObject = bun.api.Timer.TimeoutObject;
const TimerObjectInternals = bun.api.Timer.TimerObjectInternals;

const jsc = bun.jsc;
const VirtualMachine = jsc.VirtualMachine;
const api = jsc.API;
