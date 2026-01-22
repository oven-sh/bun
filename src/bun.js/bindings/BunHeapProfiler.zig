pub const HeapProfilerConfig = struct {
    name: []const u8,
    dir: []const u8,
    text_format: bool,
};

// C++ function declarations
extern fn Bun__generateHeapProfile(vm: *jsc.VM) bun.String;
extern fn Bun__generateHeapSnapshotV8(vm: *jsc.VM) bun.String;

pub fn generateAndWriteProfile(vm: *jsc.VM, config: HeapProfilerConfig) !void {
    const profile_string = if (config.text_format)
        Bun__generateHeapProfile(vm)
    else
        Bun__generateHeapSnapshotV8(vm);
    defer profile_string.deref();

    if (profile_string.isEmpty()) {
        // No profile data generated
        return;
    }

    const profile_slice = profile_string.toUTF8(bun.default_allocator);
    defer profile_slice.deinit();

    // Determine the output path using AutoAbsPath
    var path_buf: bun.AutoAbsPath = .initTopLevelDir();
    defer path_buf.deinit();

    try buildOutputPath(&path_buf, config);

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
            // Derive directory from the absolute output path
            const abs_path = path_buf.slice();
            const dir_path = bun.path.dirname(abs_path, .auto);
            if (dir_path.len > 0) {
                bun.FD.cwd().makePath(u8, dir_path) catch {};
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

    // Print message to stderr to let user know where the profile was written
    Output.prettyErrorln("Heap profile written to: {s}", .{path_buf.slice()});
    Output.flush();
}

fn buildOutputPath(path: *bun.AutoAbsPath, config: HeapProfilerConfig) !void {
    // Generate filename
    var filename_buf: bun.PathBuffer = undefined;
    const filename = if (config.name.len > 0)
        config.name
    else
        try generateDefaultFilename(&filename_buf, config.text_format);

    // Append directory if specified
    if (config.dir.len > 0) {
        path.append(config.dir);
    }

    // Append filename
    path.append(filename);
}

fn generateDefaultFilename(buf: *bun.PathBuffer, text_format: bool) ![]const u8 {
    // Generate filename like:
    // - Markdown format: Heap.{timestamp}.{pid}.md
    // - V8 format: Heap.{timestamp}.{pid}.heapsnapshot
    const timespec = bun.timespec.now(.force_real_time);
    const pid = if (bun.Environment.isWindows)
        std.os.windows.GetCurrentProcessId()
    else
        std.c.getpid();

    const epoch_microseconds: u64 = @intCast(timespec.sec *% 1_000_000 +% @divTrunc(timespec.nsec, 1000));

    const extension = if (text_format) "md" else "heapsnapshot";

    return try std.fmt.bufPrint(buf, "Heap.{d}.{d}.{s}", .{
        epoch_microseconds,
        pid,
        extension,
    });
}

const std = @import("std");

const bun = @import("bun");
const Output = bun.Output;
const jsc = bun.jsc;
