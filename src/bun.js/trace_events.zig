const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const VirtualMachine = JSC.VirtualMachine;
const Output = bun.Output;

pub const TraceEvent = struct {
    name: []const u8,
    cat: []const u8 = "",
    ph: u8, // phase: 'B' = begin, 'E' = end, 'X' = complete
    pid: u32,
    tid: u32,
    ts: u64, // timestamp in microseconds
    dur: u64 = 0, // duration in microseconds (for 'X' events)
    args: struct {} = .{},
};

pub const TraceEventWriter = struct {
    file: std.fs.File,
    allocator: std.mem.Allocator,
    process_id: u32,
    start_time: i128,
    first_event: bool = true,

    pub fn init(allocator: std.mem.Allocator, cwd: []const u8) !*TraceEventWriter {
        // Create node_trace.1.log in the current working directory
        const filename = "node_trace.1.log";
        const file_path = try std.fs.path.join(allocator, &.{ cwd, filename });
        defer allocator.free(file_path);

        const file = try std.fs.createFileAbsolute(file_path, .{});

        const writer = try allocator.create(TraceEventWriter);
        writer.* = .{
            .file = file,
            .allocator = allocator,
            .process_id = @intCast(std.os.linux.getpid()),
            .start_time = std.time.nanoTimestamp(),
            .first_event = true,
        };

        // Write the opening of the JSON object with traceEvents array
        try writer.file.writeAll("{\"traceEvents\":[");

        return writer;
    }

    pub fn deinit(this: *TraceEventWriter) void {
        this.allocator.destroy(this);
    }

    pub fn writeMetadataEvent(this: *TraceEventWriter) !void {
        // Write metadata event required by Chrome tracing format
        const metadata = std.json.stringifyAlloc(
            this.allocator,
            .{
                .name = "process_name",
                .ph = "M",
                .pid = this.process_id,
                .tid = 0,
                .ts = 0,
                .args = .{
                    .name = "bun",
                },
            },
            .{},
        ) catch |err| {
            Output.errGeneric("Failed to stringify metadata event: {s}", .{@errorName(err)});
            return err;
        };
        defer this.allocator.free(metadata);

        if (!this.first_event) {
            try this.file.writeAll(",\n");
        }
        this.first_event = false;

        try this.file.writeAll(metadata);
    }

    pub fn writeEvent(this: *TraceEventWriter, event: TraceEvent) !void {
        const json = std.json.stringifyAlloc(
            this.allocator,
            event,
            .{},
        ) catch |err| {
            Output.errGeneric("Failed to stringify trace event: {s}", .{@errorName(err)});
            return err;
        };
        defer this.allocator.free(json);

        if (!this.first_event) {
            try this.file.writeAll(",\n");
        }
        this.first_event = false;

        try this.file.writeAll(json);
    }

    pub fn finalize(this: *TraceEventWriter) !void {
        // Write the closing of the JSON array and object
        try this.file.writeAll("\n]}\n");
        this.file.close();
    }
};

pub fn init(vm: *bun.JSC.VirtualMachine) void {
    std.debug.print("TRACE: init function called\n", .{});

    // For now, check if trace event categories were passed through environment
    // This is a temporary solution until we have a better way to access runtime options
    const trace_categories = std.process.getEnvVarOwned(vm.allocator, "BUN_TRACE_EVENT_CATEGORIES") catch {
        std.debug.print("TRACE: No BUN_TRACE_EVENT_CATEGORIES env var\n", .{});
        return;
    };
    defer vm.allocator.free(trace_categories);

    std.debug.print("TRACE: Found trace categories: {s}\n", .{trace_categories});

    // Only initialize if node.environment category is specified
    if (!bun.strings.contains(trace_categories, "node.environment")) {
        std.debug.print("TRACE: Categories don't contain node.environment\n", .{});
        return;
    }

    // Store the categories in the VM for later use (need to duplicate since we're freeing trace_categories)
    vm.trace_event_categories = vm.allocator.dupe(u8, trace_categories) catch return;

    // Get current working directory
    const cwd = vm.transpiler.fs.top_level_dir;

    std.debug.print("TRACE: Initializing trace writer in: {s}\n", .{cwd});

    // Initialize the trace event writer
    vm.trace_event_writer = TraceEventWriter.init(vm.allocator, cwd) catch |err| {
        std.debug.print("TRACE: Failed to create trace event file: {s}\n", .{@errorName(err)});
        return;
    };

    std.debug.print("TRACE: Trace writer initialized successfully\n", .{});

    // Write initial environment event
    writeEnvironmentEvents(vm);
}

pub fn writeEnvironmentEvents(vm: *VirtualMachine) void {
    const writer = vm.trace_event_writer orelse return;

    const pid = std.os.linux.getpid();
    const now = std.time.microTimestamp();

    // Write Environment event
    writer.writeEvent(.{
        .name = "Environment",
        .cat = "node.environment",
        .ph = 'X', // Complete event
        .pid = @intCast(pid),
        .tid = 0,
        .ts = @intCast(now),
        .dur = 0,
    }) catch {};

    // Write RunAndClearNativeImmediates event
    writer.writeEvent(.{
        .name = "RunAndClearNativeImmediates",
        .cat = "node.environment",
        .ph = 'X',
        .pid = @intCast(pid),
        .tid = 0,
        .ts = @intCast(now + 1),
        .dur = 0,
    }) catch {};
}

pub fn finalize(vm: *VirtualMachine) void {
    std.debug.print("TRACE: finalize called, writer = {}\n", .{vm.trace_event_writer != null});
    if (vm.trace_event_writer) |writer| {
        std.debug.print("TRACE: Finalizing trace writer\n", .{});
        writer.finalize() catch |err| {
            std.debug.print("TRACE: Failed to finalize: {s}\n", .{@errorName(err)});
        };
        vm.allocator.destroy(writer);
        vm.trace_event_writer = null;
        std.debug.print("TRACE: Trace writer finalized\n", .{});
    }
}

// Node.js trace event names that we want to emit
const NodeEnvironmentEvents = [_][]const u8{
    "Environment",
    "RunAndClearNativeImmediates",
    "CheckImmediate",
    "RunTimers",
    "BeforeExit",
    "RunCleanup",
    "AtExit",
};
