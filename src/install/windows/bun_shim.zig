//! This program is a shim for node_modules/.bin scripts.
//!
//! This is needed because:
//! - Symlinks are not guaranteed to work on Windows
//! - Windows does not process Shebangs
//!
//! Notes about NTDLL:
//! - https://www.geoffchappell.com/studies/windows/win32/ntdll/index.htm
//! - http://undocumented.ntinternals.net/index.html
//! - https://github.com/ziglang/zig/issues/1840#issuecomment-558486115
//!
//! An earlier approach to this problem involved using extended attributes, but I found
//! this to be extremely hard to get a working implementation. It takes more system calls
//! anyways, and in the end would be very fragile and only work on NTFS.
//!     (if you're curious about extended attributes, here are some notes)
//!         - https://github.com/tuxera/ntfs-3g/wiki/Using-Extended-Attributes
//!         - https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwseteafile
//!         - https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-zwqueryeafile
//!         - https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_get_ea_information
//!         - https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/ns-ntifs-_file_get_ea_information
//!
//! The approach implemented instead is a `.bunx` file which sits right next to the renamed
//! shim exe. We read that (see BunXShim.zig for the creation of this file) and do some
//! clever tricks and then we can NtCreateProcess with the correct arguments.
//!
//! Prior Art:
//! - https://github.com/ScoopInstaller/Shim/blob/master/src/shim.cs
//!
//! This also solves the 'Terminate batch job (Y/N)' problem you see when using NPM/Yarn,
//! which is a HUGE dx win for developers.
//!
//! Misc notes about this file:
//! - It is optimized stupidly overkill for speed. There was no reason to go
//!   this far. Dave was simply extremely bored one evening.
//!
//! - Does not use libc or any other dependencies besides:
//!     - `ntdll.dll` is used for reading the file
//!     - `kernel32.dll` is used for spawning the process.
//!
//! - Must be compiled as an object file with Zig, and then linked manually. Otherwise you'll
//!   include Zig's initializer code and other builtins. This also lets us forcefully link
//!   to just ntdll and nothing else, as well as force more LLVM optimizations.
//!   (though i believe zig already does all these)
//!
//! The compiled binary is ~7kb and simply `@embedFile`d into Bun itself
const std = @import("std");
const builtin = @import("builtin");

const Encoding = @import("./BunXShimData.zig");

const dbg = builtin.mode == .Debug;

const assert = std.debug.assert;
const fmt16 = std.unicode.fmtUtf16le;

comptime {
    assert(builtin.single_threaded);
    assert(!builtin.link_libcpp);
    assert(!builtin.link_libc);
}

const w = std.os.windows;

/// A copy of all ntdll declarations this program uses
const nt = struct {
    const Status = w.NTSTATUS;

    /// not documented, i found this referenced in start.zig
    /// You must call this at the end of your program to terminate itself.
    pub extern "ntdll" fn RtlExitUserProcess(
        ExitStatus: u32, // [in]
    ) callconv(w.WINAPI) noreturn;

    /// https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile
    pub extern "ntdll" fn NtCreateFile(
        FileHandle: *w.HANDLE, // [out]
        DesiredAccess: w.ACCESS_MASK, // [in]
        ObjectAttributes: *w.OBJECT_ATTRIBUTES, // [in]
        IoStatusBlock: *w.IO_STATUS_BLOCK, // [out]
        AllocationSize: ?*w.LARGE_INTEGER, // [in, optional]
        FileAttributes: w.ULONG, // [in]
        ShareAccess: w.ULONG, // [in]
        CreateDisposition: w.ULONG, // [in]
        CreateOptions: w.ULONG, // [in]
        EaBuffer: ?*anyopaque, // [in]
        EaLength: w.ULONG, // [in]
    ) callconv(w.WINAPI) Status;

    /// https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntreadfile
    extern "ntdll" fn NtReadFile(
        FileHandle: w.HANDLE, // [in]
        Event: ?w.HANDLE, // [in, optional]
        ApcRoutine: ?*anyopaque, // [in, optional]
        ApcContext: ?w.PVOID, // [in, optional]
        IoStatusBlock: *w.IO_STATUS_BLOCK, // [out]
        Buffer: w.PVOID, // [out]
        Length: w.ULONG, // [in]
        ByteOffset: ?*w.LARGE_INTEGER, // [in, optional]
        Key: ?*w.ULONG, // [in, optional]
    ) callconv(w.WINAPI) Status;

    /// https://learn.microsoft.com/en-us/windows-hardware/drivers/ddi/ntifs/nf-ntifs-ntwritefile
    extern "ntdll" fn NtWriteFile(
        FileHandle: w.HANDLE, // [in]
        Event: ?w.HANDLE, // [in, optional]
        ApcRoutine: ?*anyopaque, // [in, optional]
        ApcContext: ?w.PVOID, // [in, optional]
        IoStatusBlock: *w.IO_STATUS_BLOCK, // [out]
        Buffer: [*]const u8, // [in]
        Length: w.ULONG, // [in]
        ByteOffset: ?*w.LARGE_INTEGER, // [in, optional]
        Key: ?*w.ULONG, // [in, optional]
    ) Status;
};

fn debug(comptime fmt: []const u8, args: anytype) void {
    comptime assert(dbg);
    printError(fmt, args);
}

fn unicodeStringToU16(str: w.UNICODE_STRING) []u16 {
    return str.Buffer[0 .. str.Length / 2];
}

const FILE_GENERIC_READ = w.STANDARD_RIGHTS_READ | w.FILE_READ_DATA | w.FILE_READ_ATTRIBUTES | w.FILE_READ_EA | w.SYNCHRONIZE;

const FailReason = enum {
    NoBasename,
    NoDirname,
    CouldNotOpenShim,
    CouldNotReadShim,
    InvalidShimDataSize,
    ShimNotFound,

    pub fn render(reason: FailReason) []const u8 {
        return switch (reason) {
            .NoBasename => "could not find basename in executable path",
            .NoDirname => "could not find dirname in executable path",

            .ShimNotFound => "could not find bin metadata file",
            .CouldNotOpenShim => "could not open bin metadata file",
            .CouldNotReadShim => "could not read bin metadata",
            .InvalidShimDataSize => "bin metadata is corrupt (size)",
        };
    }
};

/// TODO: stop clang from inserting this. I think this empty declaration
/// is good enough to get it to optimize this check away. Could be wrong.
export fn __chkstk() callconv(.C) void {}

/// DIFFERENCE FROM C MEMCPY, DOES NOT SUPPORT LEN=0
inline fn memcpy(noalias dest: ?[*]u8, noalias src: ?[*]const u8, len: usize) void {
    std.debug.assert(len != 0);

    var d = dest.?;
    var s = src.?;
    var n = len;
    while (true) {
        d[0] = s[0];
        n -= 1;
        if (n == 0) break;
        d += 1;
        s += 1;
    }
}

// TODO: get the faster one in here
inline fn memchr(in: [*]u8, to_find: u8, len: usize) ?[*]u8 {
    return if (std.mem.indexOfScalar(u8, in[0..len], to_find)) |offset| (in + offset) else null;
}

inline fn memrchr(comptime T: type, in: [*]T, to_find: T, len: usize) ?[*]T {
    std.debug.assert(len != 0);
    var n = len;
    var ptr = in + len - 1;
    while (true) {
        if (ptr[0] == to_find) return ptr;
        n -= 1;
        if (n == 0) return null;
        ptr -= 1;
    }
}

pub fn writeToHandle(handle: w.HANDLE, data: []const u8) error{}!usize {
    var io: w.IO_STATUS_BLOCK = undefined;
    const rc = nt.NtWriteFile(
        handle,
        null,
        null,
        null,
        &io,
        data.ptr,
        @intCast(data.len),
        null,
        null,
    );
    if (rc != .SUCCESS) {
        if (rc == .END_OF_FILE) {
            return data.len;
        }

        // For this binary it we dont really care about errors here
        // as this is just used for printing code, which will pretty much always pass.
        // return error.WriteError;
        return data.len;
    }

    return io.Information;
}

const NtWriter = std.io.Writer(w.HANDLE, error{}, writeToHandle);

inline fn printError(comptime fmt: []const u8, args: anytype) void {
    std.fmt.format(
        NtWriter{
            .context = @call(.always_inline, w.teb, .{})
                .ProcessEnvironmentBlock
                .ProcessParameters
                .hStdError,
        },
        fmt,
        args,
    ) catch {};
}

noinline fn fail(comptime reason: FailReason) noreturn {
    @setCold(true);
    failWithReason(reason);
}

noinline fn failWithReason(reason: FailReason) noreturn {
    @setCold(true);
    // TODO: do not use std.debug becuase we dont need the bloat it adds to the binary
    printError("\x1b[31;1merror\x1b[0;2m:\x1b[0m {s}\n" ++
        \\
        \\Bun failed to remap this bin to it's proper location within node_modules.
        \\This is an indication of a corrupted node_modules directory.
        \\
        \\Please run 'bun install --force' in the project root and try
        \\it again. If this message persists, please open an issue:
        \\https://github.com/oven-sh/bun/issues
        \\
        \\
    , .{reason.render()});
    nt.RtlExitUserProcess(255);
}

fn mainImplementation() noreturn {
    // peb! w.teb is a couple instructions of inline asm
    const teb: *w.TEB = @call(.always_inline, w.teb, .{});
    const peb = teb.ProcessEnvironmentBlock;
    const ProcessParameters = peb.ProcessParameters;
    const CommandLine = ProcessParameters.CommandLine;
    const ImagePathName = ProcessParameters.ImagePathName;

    // these are all different views of the same data
    const image_path_b_len = ImagePathName.Length;
    const image_path_b_u16 = ImagePathName.Buffer;
    const image_path_b_u8: [*]u8 = @ptrCast(image_path_b_u16);
    _ = image_path_b_u8;
    const cmd_line_b_len = CommandLine.Length;
    const cmd_line_u16 = CommandLine.Buffer;
    const cmd_line_u8: [*]u8 = @ptrCast(cmd_line_u16);

    assert(@intFromPtr(cmd_line_u16) % 2 == 0); // alignment assumption

    if (dbg) {
        debug("CommandLine: {}\n", .{fmt16(cmd_line_u16[0 .. cmd_line_b_len / 2])});
        debug("ImagePathName: {}\n", .{fmt16(image_path_b_u16[0 .. image_path_b_len / 2])});
    }

    var buf1: [
        w.PATH_MAX_WIDE + "\"\" ".len
        //+ "\\\\?\\".len
    ]u16 = undefined;

    const buf1_u8 = @as([*]u8, @ptrCast(&buf1[0]));
    const buf1_u16 = @as([*]u16, @ptrCast(&buf1[0]));

    // @as(*align(2) u64, @ptrCast(&buf_a[0])).* = @as(u64, @bitCast([4]u16{ '\\', '\\', '?', '\\' }));

    buf1[0] = '"';
    memcpy(
        buf1_u8 + 2,
        @as([*]u8, @ptrCast(ImagePathName.Buffer)),
        ImagePathName.Length - 6,
    );

    // backtrack on the image name to find
    // - the first character of the basename
    // - the first character of the dirname
    // we use this for manual path manipulation
    const basename_slash_ptr = (memrchr(u16, buf1_u16, '\\', image_path_b_len / 2) orelse fail(.NoBasename));
    std.debug.assert(basename_slash_ptr[0] == '\\');
    const basename_ptr = basename_slash_ptr + 1;

    @as(*align(1) u64, @ptrCast(&buf1_u8[image_path_b_len - 2 * 2])).* = @as(u64, @bitCast([4]u16{ 'b', 'u', 'n', 'x' }));

    // open the metadata file
    var metadata_handle: w.HANDLE = undefined;
    const path_len_bytes: c_ushort = @intCast(
        @intFromPtr(&buf1_u8[2]) + image_path_b_len - @intFromPtr(basename_ptr) + 2,
    );
    var nt_name = w.UNICODE_STRING{
        .Length = path_len_bytes,
        .MaximumLength = path_len_bytes,
        .Buffer = basename_ptr,
    };
    if (dbg) debug("NtCreateFile({s})\n", .{fmt16(unicodeStringToU16(nt_name))});
    var attr = w.OBJECT_ATTRIBUTES{
        .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
        .RootDirectory = ProcessParameters.CurrentDirectory.Handle,
        .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
        .ObjectName = &nt_name,
        .SecurityDescriptor = null,
        .SecurityQualityOfService = null,
    };
    var io: w.IO_STATUS_BLOCK = undefined;
    const rc = nt.NtCreateFile(
        &metadata_handle,
        FILE_GENERIC_READ,
        &attr,
        &io,
        null,
        w.FILE_ATTRIBUTE_NORMAL,
        w.FILE_SHARE_WRITE | w.FILE_SHARE_READ | w.FILE_SHARE_DELETE,
        w.FILE_OPEN,
        w.FILE_NON_DIRECTORY_FILE | w.FILE_SYNCHRONOUS_IO_NONALERT,
        null,
        0,
    );
    if (rc != .SUCCESS) {
        if (dbg) debug("error opening: {s}\n", .{@tagName(rc)});
        if (rc == .OBJECT_NAME_NOT_FOUND)
            fail(.ShimNotFound);
        fail(.CouldNotOpenShim);
    }

    // get a slice to where the CLI arguments are
    var args_start = cmd_line_u8 + 2;
    var args_len_b: usize = 0;
    switch (cmd_line_u16[0] == '"') {
        inline else => |is_quote| {
            const search_str = if (is_quote) '"' else ' ';
            var num_left: usize = cmd_line_b_len;
            while (true) {
                if (memchr(args_start, search_str, num_left)) |find| {
                    if (@intFromPtr(find) % 2 == 0 and find[1] == 0) {
                        if (@intFromPtr(find) - @intFromPtr(cmd_line_u8) == cmd_line_b_len - 2) {
                            args_start = find + 2;
                            args_len_b = 0;
                            break;
                        }
                        args_start = if (is_quote) find + 4 else find + 2;
                        if (is_quote) {
                            assert(find[2] == ' ' and find[3] == 0);
                        }
                        while (args_start[0] == ' ' and args_start[1] == 0) args_start += 2;
                        args_len_b = cmd_line_b_len - (@intFromPtr(args_start) - @intFromPtr(cmd_line_u8));
                        break;
                    }
                    num_left -= @intFromPtr(find) - @intFromPtr(args_start);
                    args_start = find + 1;
                } else {
                    args_start += num_left;
                    break;
                }
            }
        },
    }

    if (dbg) debug("UserArgs: '{s}'\n", .{args_start[0..args_len_b]});

    // Read the metadata file into the memory right after the image path.
    //
    // i'm really proud of this technique, because it will create an absolute path, but
    // without needing to store the absolute path in the binary. it also reuses the memory
    // from the earlier memcpy
    const len4dirname = @intFromPtr(basename_slash_ptr) - @intFromPtr(buf1_u16) - 4;
    if (dbg) debug("len_for_dirname: '{d}'\n", .{len4dirname});
    const dirname_slash_ptr = (memrchr(
        u16,
        buf1_u16 + 2,
        '\\',
        (len4dirname) / 2,
    ) orelse fail(.NoDirname));
    std.debug.assert(dirname_slash_ptr[0] == '\\');
    std.debug.assert(dirname_slash_ptr != basename_slash_ptr);

    const read_ptr = dirname_slash_ptr + 1;
    const read_max_len = buf1.len * 2 - (@intFromPtr(read_ptr) - @intFromPtr(buf1_u16));

    const read_status = nt.NtReadFile(metadata_handle, null, null, null, &io, read_ptr, @intCast(read_max_len), null, null);
    const read_len = switch (read_status) {
        .SUCCESS => io.Information,
        .END_OF_FILE =>
        // Supposedly .END_OF_FILE will be hit if you read exactly the amount of data left
        // "IO_STATUS_BLOCK is filled only if !NT_ERROR(status)"
        // https://stackoverflow.com/questions/62438021/can-ntreadfile-produce-a-short-read-without-reaching-eof
        // In the context of this program, I don't think that is possible, but I will handle it
        read_max_len,
        else => fail(.CouldNotReadShim),
    };

    if (dbg) debug("BufferAfterRead: '{}'", .{fmt16(buf1_u16[0 .. ((@intFromPtr(read_ptr) - @intFromPtr(buf1_u8)) + read_len) / 2])});

    var process_params: w.RTL_USER_PROCESS_PARAMETERS = ProcessParameters;
    _ = &process_params;

    // printError("TODO: Rearrange the arguments and Spawn the process", .{});

    // std.debug.print("{}\n", .{
    //     std.unicode.fmtUtf16le(buf[0 .. dirname_start + size / 2]),
    // });

    // I attempted to use lower level methods for this, but it really seems
    // too difficult and not worth the stability risks.
    //
    // Resources related to the potential lower level stuff:
    // - https://stackoverflow.com/questions/69599435/running-programs-using-rtlcreateuserprocess-only-works-occasionally
    // - https://systemroot.gitee.io/pages/apiexplorer/d0/d2/rtlexec_8c.html
    //
    // Documentation for the function I am using:
    // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw
    k32.CreateProcessW(
        lpApplicationName,
        lpCommandLine,
        lpProcessAttributes,
        lpThreadAttributes,
        bInheritHandles,
        dwCreationFlags,
        lpEnvironment,
        lpCurrentDirectory,
        lpStartupInfo,
        lpProcessInformation,
    );

    w.ntdll.RtlExitUserProcess(0);
}

fn mainCRTStartup() callconv(std.os.windows.WINAPI) noreturn {
    @call(.always_inline, mainImplementation, .{});
}

pub const main = mainImplementation;

comptime {
    if (builtin.output_mode == .Obj)
        @export(mainCRTStartup, .{ .name = "mainCRTStartup" });
}
