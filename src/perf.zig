const bun = @import("root").bun;
const std = @import("std");

pub const Ctx = union(enum) {
    disabled: Disabled,
    enabled: if (bun.Environment.isMac) Darwin else Disabled,

    pub const Disabled = struct {
        pub inline fn end(this: *const @This()) void {
            _ = this; // autofix
        }
    };

    pub fn end(this: *const @This()) void {
        switch (this.*) {
            inline else => |*ctx| ctx.end(),
        }
    }
};
var is_enabled_once = std.once(isEnabledOnce);
var is_enabled = std.atomic.Value(bool).init(false);
fn isEnabledOnMacOSOnce() void {
    if (bun.getenvZ("DYLD_ROOT_PATH") != null or bun.getRuntimeFeatureFlag("BUN_INSTRUMENTS")) {
        is_enabled.store(true, .seq_cst);
    }
}

fn isEnabledOnce() void {
    if (comptime bun.Environment.isMac) {
        isEnabledOnMacOSOnce();
        if (Darwin.get() == null) {
            is_enabled.store(false, .seq_cst);
        }
    }
}

pub fn isEnabled() bool {
    is_enabled_once.call();
    return is_enabled.load(.seq_cst);
}

const PerfEvent = @import("./generated_perf_trace_events.zig").PerfEvent;
/// Trace an event using the system profiler (Instruments).
///
/// When instruments is not connected, this is a no-op.
///
/// When adding a new event, you must run `scripts/generate-perf-trace-events.sh` to update the list of trace events.
///
/// Tip: Make sure you write bun.perf.trace() with a string literal exactly instead of passing a variable.
///
/// It has to be compile-time known this way because they need to become string literals in C.
pub fn trace(comptime name: [:0]const u8) Ctx {
    comptime {
        if (!@hasField(PerfEvent, name)) {
            @compileError(std.fmt.comptimePrint(
                \\"{s}" is missing from generated_perf_trace_events.zig
                \\
                \\Please run this command in your terminal and commit the result:
                \\
                \\  bash scripts/generate-perf-trace-events.sh
                \\
                \\Tip: Make sure you write bun.perf.trace as a string literal exactly instead of passing a variable.
            ,
                .{
                    name,
                },
            ));
        }
    }

    if (!isEnabled()) {
        return .{ .disabled = .{} };
    }

    if (comptime bun.Environment.isMac) {
        return .{ .enabled = Darwin.init(@intFromEnum(@field(PerfEvent, name))) };
    }

    return .{ .disabled = .{} };
}

pub const Darwin = struct {
    const OSLog = bun.C.OSLog;
    interval: OSLog.Signpost.Interval,

    pub fn init(comptime name: i32) @This() {
        return .{
            .interval = os_log.?.signpost(name).interval(.PointsOfInterest),
        };
    }

    pub fn end(this: *const @This()) void {
        this.interval.end();
    }

    var os_log: ?*OSLog = null;
    var os_log_once = std.once(getOnce);
    fn getOnce() void {
        os_log = OSLog.init();
    }

    pub fn get() ?*OSLog {
        os_log_once.call();
        return os_log;
    }
};
