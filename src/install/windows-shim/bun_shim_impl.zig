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
//! launcher exe. We read that (see BunXShim.zig for the creation of this file) and do some
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

const is_bun = @hasDecl(@import("root"), "bun");
const bunDebugMessage = @import("root").bun.Output.scoped(.bun_shim_impl, false);

const dbg = builtin.mode == .Debug;

const Flags = @import("./BinLinkingShim.zig").Flags;

const assert = std.debug.assert;
const fmt16 = std.unicode.fmtUtf16le;

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
    ) callconv(w.WINAPI) Status;

    pub extern "ntdll" fn NtClose(Handle: w.HANDLE) callconv(w.WINAPI) Status;
};

/// A copy of all kernel32 declarations this program uses
const k32 = struct {
    pub extern "kernel32" fn CreateProcessW(
        lpApplicationName: ?w.LPWSTR, // [in, optional]
        lpCommandLine: w.LPWSTR, // [in, out, optional]
        lpProcessAttributes: ?*w.SECURITY_ATTRIBUTES, // [in, optional]
        lpThreadAttributes: ?*w.SECURITY_ATTRIBUTES, // [in, optional]
        bInheritHandles: w.BOOL, // [in]
        dwCreationFlags: w.DWORD, // [in]
        lpEnvironment: ?*anyopaque, // [in, optional]
        lpCurrentDirectory: ?w.LPWSTR, // [in, optional]
        lpStartupInfo: *w.STARTUPINFOW, // [in]
        lpProcessInformation: *w.PROCESS_INFORMATION, // [out]
    ) callconv(w.WINAPI) w.BOOL;

    // https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror
    pub extern "kernel32" fn GetLastError() callconv(w.WINAPI) w.Win32Error;

    pub extern "kernel32" fn SetConsoleMode(
        hConsoleHandle: w.HANDLE, // [in]
        dwMode: w.DWORD, // [in]
    ) callconv(w.WINAPI) w.BOOL;

    pub extern "kernel32" fn GetConsoleMode(
        hConsoleHandle: w.HANDLE, // [in]
        lpMode: *w.DWORD, // [out]
    ) callconv(w.WINAPI) w.BOOL;
};

fn debug(comptime fmt: []const u8, args: anytype) void {
    // comptime assert(builtin.mode == .Debug);
    if (is_bun) {
        bunDebugMessage(fmt, args);
    } else {
        printError(fmt, args);
    }
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
    CreateProcessFailed,
    InvalidShimValidation,
    InvalidShimBounds,
    CouldNotDirectLaunch,

    pub fn render(reason: FailReason) []const u8 {
        return switch (reason) {
            .NoBasename => "could not find basename in executable path",
            .NoDirname => "could not find dirname in executable path",

            .ShimNotFound => "could not find bin metadata file",
            .CouldNotOpenShim => "could not open bin metadata file",
            .CouldNotReadShim => "could not read bin metadata",
            .InvalidShimDataSize => "bin metadata is corrupt (size)",
            .InvalidShimValidation => "bin metadata is corrupt (validate)",
            .InvalidShimBounds => "bin metadata is corrupt (bounds)",
            .CreateProcessFailed => "could not create process",

            .CouldNotDirectLaunch => if (is_bun)
                "bin metadata is corrupt (invalid utf16)"
            else
                unreachable,
        };
    }
};

inline fn memcpyNonZero(noalias dest: ?[*]u8, noalias src: ?[*]const u8, len: usize) void {
    if (dbg) std.debug.assert(len != 0);

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

    {
        const console_handle = w.teb().ProcessEnvironmentBlock.ProcessParameters.hStdError;
        var mode: w.DWORD = 0;
        if (k32.GetConsoleMode(console_handle, &mode) != 0) {
            mode |= w.ENABLE_VIRTUAL_TERMINAL_PROCESSING;
            _ = k32.SetConsoleMode(console_handle, mode);
        }
    }

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

pub inline fn launcher(comptime is_standalone: bool, bun_ctx: anytype) noreturn {
    // peb! w.teb is a couple instructions of inline asm
    const teb: *w.TEB = @call(.always_inline, w.teb, .{});
    const peb = teb.ProcessEnvironmentBlock;
    const ProcessParameters = peb.ProcessParameters;
    const CommandLine = ProcessParameters.CommandLine;
    const ImagePathName = ProcessParameters.ImagePathName;

    // these are all different views of the same data
    const image_path_b_len = if (is_standalone) ImagePathName.Length else bun_ctx.base_path.len * 2;
    const image_path_b_u16 = if (is_standalone) ImagePathName.Buffer else bun_ctx.base_path.ptr;
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
    ]u16 = undefined;

    // This is used for CreateProcessW's lpCommandLine
    // "The maximum length of this string is 32,767 characters, including the Unicode terminating null character."
    var buf2: [32767 + 1]u16 = undefined;

    const buf1_u8 = @as([*]u8, @ptrCast(&buf1[0]));
    const buf1_u16 = @as([*]u16, @ptrCast(&buf1[0]));

    const buf2_u8 = @as([*]u8, @ptrCast(&buf2[0]));
    const buf2_u16 = @as([*:0]u16, @ptrCast(&buf2[0]));

    if (is_standalone) {
        @as(*align(1) u64, @ptrCast(&buf1_u8[0])).* = @as(u64, @bitCast([4]u16{ '\\', '?', '?', '\\' }));
    }

    memcpyNonZero(
        buf1_u8 + 2 * 4,
        @ptrCast(image_path_b_u16),
        if (is_standalone) cmd_line_b_len - 6 else bun_ctx.base_path.len * 2,
    );

    // backtrack on the image name to find
    // - the first character of the basename
    // - the first character of the dirname
    // we use this for manual path manipulation
    const basename_slash_ptr = (memrchr(u16, buf1_u16, '\\', image_path_b_len / 2) orelse fail(.NoBasename));
    std.debug.assert(basename_slash_ptr[0] == '\\');

    @as(*align(1) u64, @ptrCast(&buf1_u8[image_path_b_len + 2 * 1])).* = @as(u64, @bitCast([4]u16{ 'b', 'u', 'n', 'x' }));

    // open the metadata file
    var metadata_handle: w.HANDLE = undefined;
    var io: w.IO_STATUS_BLOCK = undefined;
    if (is_standalone) {
        const path_len_bytes: c_ushort = image_path_b_len + 2 + 2 * 4;
        var nt_name = w.UNICODE_STRING{
            .Length = path_len_bytes,
            .MaximumLength = path_len_bytes,
            .Buffer = buf1_u16,
        };
        if (dbg) debug("NtCreateFile({s})\n", .{fmt16(unicodeStringToU16(nt_name))});
        if (dbg) debug("NtCreateFile({any})\n", .{(unicodeStringToU16(nt_name))});
        var attr = w.OBJECT_ATTRIBUTES{
            .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
            .RootDirectory = null,
            .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            .ObjectName = &nt_name,
            .SecurityDescriptor = null,
            .SecurityQualityOfService = null,
        };
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
    } else {
        metadata_handle = bun_ctx.handle;
    }

    // get a slice to where the CLI arguments are
    var args_len_b: usize = 0;
    var args_start_u8 = cmd_line_u8 + 2;
    if (is_standalone) {
        switch (cmd_line_u16[0] == '"') {
            inline else => |is_quote| {
                const search_str = if (is_quote) '"' else ' ';
                var num_left: usize = cmd_line_b_len;
                while (memchr(args_start_u8, search_str, num_left)) |find| {
                    if (@intFromPtr(find) % 2 == 0 and find[1] == 0) {
                        if (@intFromPtr(find) - @intFromPtr(cmd_line_u8) == cmd_line_b_len - 2) {
                            break;
                        }
                        args_start_u8 = if (is_quote) find + 4 else find + 2;
                        if (is_quote) {
                            assert(find[2] == ' ' and find[3] == 0);
                        }
                        while (args_start_u8[0] == ' ' and args_start_u8[1] == 0) args_start_u8 += 2;
                        args_start_u8 -= 2;
                        args_len_b = cmd_line_b_len - (@intFromPtr(args_start_u8) - @intFromPtr(cmd_line_u8));
                        break;
                    }

                    num_left -= @intFromPtr(find) - @intFromPtr(args_start_u8);
                    args_start_u8 = find + 1;
                }
            },
        }
    } else {
        args_start_u8 = @ptrCast(bun_ctx.arguments.ptr);
        args_len_b = std.mem.sliceAsBytes(bun_ctx.arguments).len;
    }

    if (dbg) debug("UserArgs: '{s}' ({d} bytes)\n", .{ args_start_u8[0..args_len_b], args_len_b });
    if (dbg) debug("UserArgs: '{any}'\n", .{args_start_u8[0..args_len_b]});

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

    var read_ptr = @as([*]u8, @ptrCast(dirname_slash_ptr)) + 2;
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

    _ = w.ntdll.NtClose(metadata_handle);

    if (dbg) debug("BufferAfterRead: '{}'\n", .{fmt16(buf1_u16[0 .. ((@intFromPtr(read_ptr) - @intFromPtr(buf1_u8)) + read_len) / 2])});

    // uncomment if you need to debug the hexdump. this would be only useful if you have
    // incorrect bounds in the read above. however, i already fixed that bug so you probably
    // wont ever need this. but it is here ... in case you do
    // if (dbg) debug("BufferAfterReadHex:\n'{}'\n", .{std.fmt.fmtSliceHexLower(std.mem.sliceAsBytes((buf1_u16[0 .. ((@intFromPtr(read_ptr) - @intFromPtr(buf1_u8)) + read_len) / 2])))});

    read_ptr = @ptrFromInt(@intFromPtr(read_ptr) + read_len - 2);
    const flags: Flags = @as(*align(1) Flags, @ptrCast(read_ptr)).*;

    if (dbg) {
        const flags_u16: u16 = @as(*align(1) u16, @ptrCast(read_ptr)).*;
        debug("FlagsInt: {d}\n", .{flags_u16});

        debug("Flags:\n", .{});
        inline for (comptime std.meta.fieldNames(Flags)) |name| {
            debug("    {s}: {}\n", .{ name, @field(flags, name) });
        }
    }

    if (!flags.isValid())
        fail(.InvalidShimValidation);

    const environment_forces_bun = if (is_standalone)
        false
    else
        bun_ctx.force_use_bun;

    const spawn_command_line: [*:0]u16 = switch (flags.has_shebang) {
        false => spawn_command_line: {
            // no shebang, which means the command line is simply going to be the joined file exe
            // followed by the existing command line.

            // change the \ from '\??\' to '""
            // the ending quote is assumed to already exist as per the format
            buf1_u16[3] = '"';

            const yy: [*]u8 = @ptrFromInt(@intFromPtr(dirname_slash_ptr) + read_len - 2);

            if (args_len_b > 0) {
                memcpyNonZero(
                    yy,
                    args_start_u8,
                    args_len_b,
                );
            }

            @as(*align(1) u16, @ptrCast(yy + args_len_b)).* = 0;

            break :spawn_command_line @alignCast(@ptrCast(buf1_u8 + 6));
        },
        true => spawn_command_line: {
            // with shebang we are going to setup buf2 as our command line:
            // [args, which always includes a trailing space][entrypoint from buf1]
            const ShebangMetadataPacked = packed struct {
                bin_path_len_bytes: u32,
                args_len_bytes: u32,
            };

            read_ptr -= @sizeOf(ShebangMetadataPacked);
            const shebang_metadata: ShebangMetadataPacked = @as(*align(1) ShebangMetadataPacked, @ptrCast(read_ptr)).*;

            const shebang_arg_len = shebang_metadata.args_len_bytes;
            const shebang_bin_path_len_bytes = shebang_metadata.bin_path_len_bytes;

            if (dbg) {
                debug("bin_path_len_bytes: {}\n", .{shebang_metadata.bin_path_len_bytes});
                debug("args_len_bytes: {}\n", .{shebang_metadata.args_len_bytes});
            }

            // magic number related to how BinLinkingShim.zig writes the metadata
            const validation_length_offset = 14;

            // very careful here to not overflow u32, so that we properly error if you hijack the file
            if (shebang_arg_len == 0 or
                (@as(u64, shebang_arg_len) +| @as(u64, shebang_bin_path_len_bytes)) + validation_length_offset != read_len)
            {
                if (dbg)
                    debug("read_len: {}\n", .{read_len});

                fail(.InvalidShimBounds);
            }

            if (flags.is_node_or_bun and environment_forces_bun) {
                // forget the shebang, run it!
                if (is_standalone) {
                    // TODO:
                } else {
                    // Fast path since we are already in the bun executable... just run it back yall
                    debug("direct_launch_with_bun_js\n", .{});
                    bun_ctx.direct_launch_with_bun_js(
                        buf1_u16[4 .. (@intFromPtr(dirname_slash_ptr) - @intFromPtr(buf1_u8) + shebang_bin_path_len_bytes + 4) / 2],
                        bun_ctx.cli_context,
                    );
                    fail(.CouldNotDirectLaunch);
                }
            }

            read_ptr -= shebang_arg_len;

            // Copy the shebang bin path
            memcpyNonZero(buf2_u8, @ptrCast(read_ptr), shebang_arg_len);

            @as(*align(1) u16, @ptrCast(buf2_u8 + shebang_arg_len)).* = '"';

            const yy = @intFromPtr(dirname_slash_ptr) - @intFromPtr(buf1_u8) + shebang_bin_path_len_bytes + 2 * 4;

            // Copy the filename in
            memcpyNonZero(buf2_u8 + shebang_arg_len + 2, buf1_u8 + 2 * 4, yy);

            // Copy the arguments in
            if (args_len_b > 0) {
                memcpyNonZero(buf2_u8 + yy, args_start_u8, args_len_b);
            }

            @as(*align(1) u16, @ptrFromInt(@intFromPtr(buf2_u8) + yy + args_len_b)).* = 0;

            if (dbg) {
                debug("BufferAfterShebang: '{}'\n", .{
                    fmt16(buf1_u16[0 .. ((@intFromPtr(read_ptr) - @intFromPtr(buf1_u8)) + read_len) / 2]),
                });
            }

            break :spawn_command_line buf2_u16;
        },
    };

    if (dbg)
        debug("lpCommandLine: {}\n", .{fmt16(std.mem.span(spawn_command_line))});

    // I attempted to use lower level methods for this, but it really seems
    // too difficult and not worth the stability risks.
    //
    // The initial (crazy) idea was something like cloning 'ProcessParameters' and then just changing
    // the CommandLine and ImagePathName to point to the new data. would that even work??? probably not
    // I never tested it.
    //
    // Resources related to the potential lower level stuff:
    // - https://stackoverflow.com/questions/69599435/running-programs-using-rtlcreateuserprocess-only-works-occasionally
    // - https://systemroot.gitee.io/pages/apiexplorer/d0/d2/rtlexec_8c.html
    //
    // Documentation for the function I am using:
    // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-createprocessw
    var process: w.PROCESS_INFORMATION = undefined;
    var startup_info = w.STARTUPINFOW{
        .cb = @sizeOf(w.STARTUPINFOW),
        .lpReserved = null,
        .lpDesktop = null,
        .lpTitle = null,
        .dwX = 0,
        .dwY = 0,
        .dwXSize = 0,
        .dwYSize = 0,
        .dwXCountChars = 0,
        .dwYCountChars = 0,
        .dwFillAttribute = 0,
        .dwFlags = w.STARTF_USESTDHANDLES,
        .wShowWindow = 0,
        .cbReserved2 = 0,
        .lpReserved2 = null,
        .hStdInput = ProcessParameters.hStdInput,
        .hStdOutput = ProcessParameters.hStdOutput,
        .hStdError = ProcessParameters.hStdError,
    };
    const did_process_spawn = k32.CreateProcessW(
        null,
        spawn_command_line,
        null,
        null,
        1, // true
        0,
        null,
        null,
        &startup_info,
        &process,
    );
    if (did_process_spawn == 0) {
        if (dbg) {
            const spawn_err = k32.GetLastError();
            printError("CreateProcessW failed: {s}\n", .{@tagName(spawn_err)});
        }
        fail(.CreateProcessFailed);
    }

    _ = w.kernel32.WaitForSingleObject(process.hProcess, w.INFINITE);

    var exit_code: w.DWORD = 255;
    _ = w.kernel32.GetExitCodeProcess(process.hProcess, &exit_code);

    _ = nt.NtClose(process.hProcess);
    _ = nt.NtClose(process.hThread);

    nt.RtlExitUserProcess(exit_code);
}

pub const FromBunRunContext = struct {
    base_path: []u16,
    arguments: []u16,
    handle: w.HANDLE,
    force_use_bun: bool,
    direct_launch_with_bun_js: *const fn (wpath: []u16, args: *anyopaque) void,
    cli_context: *anyopaque,
};

pub fn startupFromBunJS(context: FromBunRunContext) noreturn {
    launcher(false, context);
}

fn mainCRTStartup() callconv(std.os.windows.WINAPI) noreturn {
    @setAlignStack(16);
    launcher(true, .{});
    std.os.windows.ntdll.RtlExitUserProcess(0);
}

/// TODO: stop clang from inserting this. I think this empty declaration
/// is good enough to get it to optimize this check away. Could be wrong.
fn __chkstk() callconv(.C) void {}

/// there is at least one place zig or the optimizer inserts a memcpy
/// so we have to export an implementation of memcpy
fn memcpy(noalias dest: ?[*]u8, noalias src: ?[*]const u8, len: usize) callconv(.C) void {
    if (len == 0) return;

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

comptime {
    if (builtin.output_mode == .Obj and !is_bun) {
        @export(mainCRTStartup, .{ .name = "mainCRTStartup" });
        @export(memcpy, .{ .name = "memcpy" });
        @export(__chkstk, .{ .name = "__chkstk" });
    }
}
