pub const CPUProfilerConfig = struct {
    name: []const u8,
    dir: []const u8,
    md_format: bool = false,
    json_format: bool = false,
};

// C++ function declarations
extern fn Bun__startCPUProfiler(vm: *jsc.VM) void;
extern fn Bun__stopCPUProfiler(vm: *jsc.VM, outJSON: ?*bun.String, outText: ?*bun.String) void;

pub fn startCPUProfiler(vm: *jsc.VM) void {
    Bun__startCPUProfiler(vm);
}

pub fn stopAndWriteProfile(vm: *jsc.VM, config: CPUProfilerConfig) !void {
    var json_string: bun.String = .empty;
    var text_string: bun.String = .empty;

    // Call the unified C++ function with pointers for requested formats
    Bun__stopCPUProfiler(
        vm,
        if (config.json_format) &json_string else null,
        if (config.md_format) &text_string else null,
    );
    defer json_string.deref();
    defer text_string.deref();

    // Write JSON format if requested and not empty
    if (config.json_format and !json_string.isEmpty()) {
        try writeProfileToFile(json_string, config, false);
    }

    // Write text format if requested and not empty
    if (config.md_format and !text_string.isEmpty()) {
        try writeProfileToFile(text_string, config, true);
    }
}

fn writeProfileToFile(profile_string: bun.String, config: CPUProfilerConfig, is_md_format: bool) !void {
    const profile_slice = profile_string.toUTF8(bun.default_allocator);
    defer profile_slice.deinit();

    // Determine the output path using AutoAbsPath
    var path_buf: bun.AutoAbsPath = .initTopLevelDir();
    defer path_buf.deinit();

    try buildOutputPath(&path_buf, config, is_md_format);

    // Convert to OS-specific path (UTF-16 on Windows, UTF-8 elsewhere)
    var path_buf_os: bun.OSPathBuffer = undefined;
    const output_path_os: bun.OSPathSliceZ = if (bun.Environment.isWindows)
        bun.strings.convertUTF8toUTF16InBufferZ(&path_buf_os, path_buf.sliceZ())
    else
        path_buf.sliceZ();

    // Write the profile to disk using bun.sys.File.writeFile
    const result = bun.sys.File.writeFile(bun.FD.cwd(), output_path_os, profile_slice.slice());
    if (result.asErr()) |err| {
        // If we got ENOENT, PERM, or ACCES, try creating the directory and retry
        const errno = err.getErrno();
        if (errno == .NOENT or errno == .PERM or errno == .ACCES) {
            if (config.dir.len > 0) {
                bun.FD.cwd().makePath(u8, config.dir) catch {};
                // Retry write
                const retry_result = bun.sys.File.writeFile(bun.FD.cwd(), output_path_os, profile_slice.slice());
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

fn buildOutputPath(path: *bun.AutoAbsPath, config: CPUProfilerConfig, is_md_format: bool) !void {
    // Generate filename
    var filename_buf: bun.PathBuffer = undefined;

    // If both formats are being written and a custom name was specified,
    // we need to add the appropriate extension to disambiguate
    const has_both_formats = config.md_format and config.json_format;
    const filename = if (config.name.len > 0) blk: {
        if (has_both_formats) {
            // Custom name with both formats - append extension based on format
            const ext = if (is_md_format) ".md" else ".cpuprofile";
            break :blk std.fmt.bufPrint(&filename_buf, "{s}{s}", .{ config.name, ext }) catch return error.FilenameTooLong;
        } else {
            break :blk config.name;
        }
    } else try generateDefaultFilename(&filename_buf, is_md_format);

    // Append directory if specified
    if (config.dir.len > 0) {
        path.join(&.{config.dir});
    }

    // Append filename
    path.append(filename);
}

fn generateDefaultFilename(buf: *bun.PathBuffer, md_format: bool) ![]const u8 {
    // Generate filename like: CPU.{timestamp}.{pid}.cpuprofile (or .md for markdown format)
    // Use microsecond timestamp for uniqueness
    const timespec = bun.timespec.now(.force_real_time);
    const pid = if (bun.Environment.isWindows)
        std.os.windows.GetCurrentProcessId()
    else
        std.c.getpid();

    const epoch_microseconds: u64 = @intCast(timespec.sec *% 1_000_000 +% @divTrunc(timespec.nsec, 1000));

    const extension = if (md_format) ".md" else ".cpuprofile";

    return std.fmt.bufPrint(buf, "CPU.{d}.{d}{s}", .{
        epoch_microseconds,
        pid,
        extension,
    }) catch return error.FilenameTooLong;
}

const std = @import("std");

const bun = @import("bun");
const jsc = bun.jsc;
