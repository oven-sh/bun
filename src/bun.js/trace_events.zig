const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const Environment = bun.Environment;
const Output = bun.Output;
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;

pub const TraceEventKind = enum {
    Environment,
    RunAndClearNativeImmediates,
    CheckImmediate,
    RunTimers,
    BeforeExit,
    RunCleanup,
    AtExit,
};

pub const TraceEventManager = struct {
    categories: []const u8 = "",
    start_time: i128 = 0,
    pid: u32 = 0,
    first_event_written: bool = false,
    vm: *VirtualMachine,
    trace_file: ?std.fs.File = null,

    var global_manager: ?*TraceEventManager = null;

    pub fn init(vm: *VirtualMachine, categories: []const u8) !void {
        std.debug.print("TraceEventManager.init called with categories: {s}\n", .{categories});

        if (global_manager != null) return;

        global_manager = try bun.default_allocator.create(TraceEventManager);
        const self = global_manager.?;

        self.* = TraceEventManager{
            .categories = categories,
            .start_time = @as(i128, @intCast(std.time.nanoTimestamp())),
            .pid = @as(u32, @intCast(std.c.getpid())),
            .vm = vm,
        };

        // Create the trace file
        var buf: bun.PathBuffer = undefined;
        const cwd = try bun.getcwd(&buf);
        const trace_file_path = try std.fmt.allocPrint(bun.default_allocator, "{s}/node_trace.1.log", .{cwd});
        defer bun.default_allocator.free(trace_file_path);

        self.trace_file = try std.fs.createFileAbsolute(trace_file_path, .{
            .truncate = true,
        });

        // Write opening
        try self.trace_file.?.writeAll("[\n");
    }

    pub fn deinit() void {
        if (global_manager) |self| {
            // Write closing and close file
            if (self.trace_file) |file| {
                file.writeAll("\n]") catch {};
                file.close();
            }

            bun.default_allocator.destroy(self);
            global_manager = null;
        }
    }

    pub fn emit(kind: TraceEventKind) void {
        const self = global_manager orelse return;
        if (self.trace_file == null) return;

        const name = switch (kind) {
            .Environment => "Environment",
            .RunAndClearNativeImmediates => "RunAndClearNativeImmediates",
            .CheckImmediate => "CheckImmediate",
            .RunTimers => "RunTimers",
            .BeforeExit => "BeforeExit",
            .RunCleanup => "RunCleanup",
            .AtExit => "AtExit",
        };

        const timestamp = @as(i128, @intCast(std.time.nanoTimestamp()));
        const duration_us = @divFloor(timestamp - self.start_time, 1000);

        // Write comma if not first event
        if (self.first_event_written) {
            self.trace_file.?.writeAll(",\n") catch return;
        } else {
            self.first_event_written = true;
        }

        // Write the event
        var buf: [512]u8 = undefined;
        const json = std.fmt.bufPrint(&buf,
            \\{{
            \\  "name": "{s}",
            \\  "cat": "node.environment",
            \\  "ph": "I",
            \\  "ts": {d},
            \\  "pid": {d},
            \\  "tid": 0,
            \\  "args": {{}}
            \\}}
        , .{ name, duration_us, self.pid }) catch return;

        self.trace_file.?.writeAll(json) catch return;
    }
};
