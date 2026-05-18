pub const Ctx = union(enum) {
    disabled: Disabled,
    enabled: switch (bun.Environment.os) {
        .mac => Darwin,
        .linux => Linux,
        else => Disabled,
    },

    pub const Disabled = struct {
        pub inline fn end(_: *const @This()) void {}
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
    if (bun.env_var.DYLD_ROOT_PATH.get() != null or bun.feature_flag.BUN_INSTRUMENTS.get()) {
        is_enabled.store(true, .seq_cst);
    }
}

fn isEnabledOnLinuxOnce() void {
    if (bun.feature_flag.BUN_TRACE.get()) {
        is_enabled.store(true, .seq_cst);
    }
}

fn isEnabledOnce() void {
    if (comptime bun.Environment.isMac) {
        isEnabledOnMacOSOnce();
        if (Darwin.get() == null) {
            is_enabled.store(false, .seq_cst);
        }
    } else if (comptime bun.Environment.isLinux) {
        isEnabledOnLinuxOnce();
        if (!Linux.isSupported()) {
            is_enabled.store(false, .seq_cst);
        }
    }
}

pub fn isEnabled() bool {
    is_enabled_once.call();
    return is_enabled.load(.seq_cst);
}

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
        @branchHint(.likely);
        return .{ .disabled = .{} };
    }

    if (comptime bun.Environment.isMac) {
        return .{ .enabled = Darwin.init(@intFromEnum(@field(PerfEvent, name))) };
    } else if (comptime bun.Environment.isLinux) {
        return .{ .enabled = Linux.init(@field(PerfEvent, name)) };
    }

    return .{ .disabled = .{} };
}

pub const Darwin = struct {
    const OSLog = bun.darwin.OSLog;
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

pub const Linux = struct {
    start_time: u64,
    event: PerfEvent,

    var is_initialized = std.atomic.Value(bool).init(false);
    var init_once = std.once(initOnce);

    extern "c" fn Bun__linux_trace_init() c_int;
    extern "c" fn Bun__linux_trace_close() void;
    extern "c" fn Bun__linux_trace_emit(event_name: [*:0]const u8, duration_ns: i64) c_int;

    fn initOnce() void {
        const result = Bun__linux_trace_init();
        is_initialized.store(result != 0, .monotonic);
    }

    pub fn isSupported() bool {
        init_once.call();
        return is_initialized.load(.monotonic);
    }

    pub fn init(event: PerfEvent) @This() {
        return .{
            .start_time = bun.timespec.now(.force_real_time).ns(),
            .event = event,
        };
    }

    pub fn end(this: *const @This()) void {
        if (!isSupported()) return;

        const duration = bun.timespec.now(.force_real_time).ns() -| this.start_time;

        _ = Bun__linux_trace_emit(@tagName(this.event).ptr, @intCast(duration));
    }
};

const bun = @import("bun");
const std = @import("std");
const PerfEvent = @import("./generated_perf_trace_events.zig").PerfEvent;
