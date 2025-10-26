const std = @import("std");
const bun = @import("bun");
const jsc = bun.jsc;
const JSValue = jsc.JSValue;
const JSGlobalObject = jsc.JSGlobalObject;

pub const CPUProfilerConfig = extern struct {
    enabled: bool,
    name_ptr: [*]const u8,
    name_len: usize,
    dir_ptr: [*]const u8,
    dir_len: usize,

    pub fn name(this: *const CPUProfilerConfig) []const u8 {
        if (this.name_len == 0) return "";
        return this.name_ptr[0..this.name_len];
    }

    pub fn dir(this: *const CPUProfilerConfig) []const u8 {
        if (this.dir_len == 0) return "";
        return this.dir_ptr[0..this.dir_len];
    }
};

// C++ function declarations
extern fn Bun__startCPUProfiler(vm: *jsc.VM) void;
extern fn Bun__stopCPUProfilerAndGetJSON(vm: *jsc.VM) bun.String;

pub fn startCPUProfiler(vm: *jsc.VM) void {
    Bun__startCPUProfiler(vm);
}

pub fn stopAndWriteProfile(vm: *jsc.VM, config: CPUProfilerConfig) !void {
    const json_string = Bun__stopCPUProfilerAndGetJSON(vm);
    defer json_string.deref();

    if (json_string.isEmpty()) {
        // No profile data or profiler wasn't started
        return;
    }

    const json_slice = json_string.toUTF8(bun.default_allocator);
    defer json_slice.deinit();

    // Determine the output path
    var path_buf: bun.PathBuffer = undefined;
    const output_path = try getOutputPath(&path_buf, config);

    // Write the profile to disk
    const file = try std.fs.cwd().createFile(output_path, .{});
    defer file.close();

    try file.writeAll(json_slice.slice());

    // Print confirmation message
    bun.Output.prettyErrorln("Wrote CPU profile to: {s}", .{output_path});
    bun.Output.flush();
}

fn getOutputPath(buf: *bun.PathBuffer, config: CPUProfilerConfig) ![]const u8 {
    const name_str = config.name();
    const dir_str = config.dir();

    // Build the filename
    const filename = if (name_str.len > 0)
        name_str
    else
        try generateDefaultFilename(buf);

    // Build the full path
    if (dir_str.len > 0) {
        // Ensure directory exists
        try std.fs.cwd().makePath(dir_str);

        // Combine dir and filename
        return try std.fmt.bufPrint(buf, "{s}/{s}", .{ dir_str, filename });
    } else {
        // Use current directory
        return filename;
    }
}

fn generateDefaultFilename(buf: *bun.PathBuffer) ![]const u8 {
    // Generate filename like: CPU.20240101.120000.1234.0.001.cpuprofile
    const timestamp = std.time.timestamp();
    const pid = std.os.linux.getpid();

    // Convert timestamp to date/time
    const epoch_seconds = @as(u64, @intCast(timestamp));
    const days_since_epoch = epoch_seconds / 86400;
    const seconds_today = epoch_seconds % 86400;

    const year = @as(u32, @intCast(1970 + (days_since_epoch / 365))); // Approximate
    const month = 1; // Simplified for now
    const day = @as(u32, @intCast((days_since_epoch % 365) + 1));

    const hours = @as(u32, @intCast(seconds_today / 3600));
    const minutes = @as(u32, @intCast((seconds_today % 3600) / 60));
    const seconds = @as(u32, @intCast(seconds_today % 60));

    return try std.fmt.bufPrint(buf, "CPU.{d:0>4}{d:0>2}{d:0>2}.{d:0>2}{d:0>2}{d:0>2}.{d}.0.001.cpuprofile", .{
        year,
        month,
        day,
        hours,
        minutes,
        seconds,
        pid,
    });
}
