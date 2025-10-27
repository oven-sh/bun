pub const CPUProfilerConfig = struct {
    name: []const u8,
    dir: []const u8,
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

    // Convert to OS-specific path (UTF-16 on Windows, UTF-8 elsewhere)
    var path_buf_os: bun.OSPathBuffer = undefined;
    const output_path_os: bun.OSPathSliceZ = if (bun.Environment.isWindows)
        bun.strings.convertUTF8toUTF16InBufferZ(&path_buf_os, output_path)
    else
        output_path;

    // Write the profile to disk using bun.sys.File.writeFile
    const result = bun.sys.File.writeFile(bun.FD.cwd(), output_path_os, json_slice.slice());
    if (result.asErr()) |err| {
        // If we got ENOENT, PERM, or ACCES, try creating the directory and retry
        const errno = err.getErrno();
        if (errno == .NOENT or errno == .PERM or errno == .ACCES) {
            if (config.dir.len > 0) {
                const cwd_dir = std.fs.Dir{ .fd = bun.FD.cwd().cast() };
                bun.makePath(cwd_dir, config.dir) catch {};
                // Retry write
                const retry_result = bun.sys.File.writeFile(bun.FD.cwd(), output_path_os, json_slice.slice());
                if (retry_result.asErr()) |_| {
                    return error.WriteFailed;
                }
            } else {
                return error.WriteFailed;
            }
        } else {
            return error.WriteFailed;
        }
    }
}

fn getOutputPath(buf: *bun.PathBuffer, config: CPUProfilerConfig) ![:0]const u8 {
    // Generate filename
    var filename_buf: bun.PathBuffer = undefined;
    const filename = if (config.name.len > 0)
        config.name
    else
        try generateDefaultFilename(&filename_buf);

    // Get the current working directory
    const cwd = bun.fs.FileSystem.instance.top_level_dir;

    // Join directory and filename if directory is specified
    if (config.dir.len > 0) {
        // Use bun.path.joinAbsStringBufZ to join cwd, dir, and filename
        return bun.path.joinAbsStringBufZ(cwd, buf, &.{ config.dir, filename }, .auto);
    } else {
        // Just join cwd and filename
        return bun.path.joinAbsStringBufZ(cwd, buf, &.{filename}, .auto);
    }
}

// Cross-platform way to get process ID
extern "c" fn getpid() c_int;

fn generateDefaultFilename(buf: *bun.PathBuffer) ![]const u8 {
    // Generate filename like: CPU.{timestamp}.{pid}.cpuprofile
    // Use microsecond timestamp for uniqueness
    const timespec = bun.timespec.now();
    const pid = getpid();

    const epoch_microseconds: u64 = @intCast(timespec.sec *% 1_000_000 +% @divTrunc(timespec.nsec, 1000));

    return try std.fmt.bufPrint(buf, "CPU.{d}.{d}.cpuprofile", .{
        epoch_microseconds,
        pid,
    });
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
