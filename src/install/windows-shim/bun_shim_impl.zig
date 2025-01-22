//! This program is a shim for node_modules/.bin scripts.
//!
//! This is needed because:
//! - Symlinks are not guaranteed to work on Windows
//! - Windows does not process Shebangs
//!
//! This also solves the 'Terminate batch job (Y/N)' problem you see when using NPM/Yarn,
//! which is a HUGE dx win for developers.
//!
//! The approach implemented is a `.bunx` file which sits right next to the renamed
//! launcher exe. We read that (see BinLinkingShim.zig for the creation of this file)
//! and then we call NtCreateProcess to spawn the correct child process.
//!
//! Every attempt possible to make this file as minimal as possible has been made.
//! Which has unfortunatly made is difficult to read. To make up for this, every
//! part of this program is documented as much as possible, including links to
//! APIs and related resources.
//!
//! Notes about NTDLL and Windows Internals:
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
//! Prior Art:
//! - https://github.com/ScoopInstaller/Shim/blob/master/src/shim.cs
//!
//! The compiled binary is 13312 bytes and is `@embedFile`d into Bun itself.
//! When this file is updated, the new binary should be compiled and BinLinkingShim.VersionFlag.current should be updated.
//!
//! Questions about this file should be directed at @paperclover.
const builtin = @import("builtin");
const dbg = builtin.mode == .Debug;

const std = @import("std");
const w = std.os.windows;
const assert = std.debug.assert;
const fmt16 = std.unicode.fmtUtf16le;

const is_standalone = @import("root") == @This();
const bun = if (!is_standalone) @import("root").bun else @compileError("cannot use 'bun' in standalone build of bun_shim_impl");
const bunDebugMessage = bun.Output.scoped(.bun_shim_impl, true);
const callmod_inline = if (is_standalone) std.builtin.CallModifier.always_inline else bun.callmod_inline;

const Flags = @import("./BinLinkingShim.zig").Flags;

const wliteral = std.unicode.utf8ToUtf16LeStringLiteral;

/// A copy of all ntdll declarations this program uses
const nt = struct {
    const Status = w.NTSTATUS;

    /// undocumented
    const RtlExitUserProcess = w.ntdll.RtlExitUserProcess;

    /// https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntclose
    const NtClose = w.ntdll.NtClose;

    /// https://learn.microsoft.com/en-us/windows/win32/api/winternl/nf-winternl-ntcreatefile
    const NtCreateFile = w.ntdll.NtCreateFile;

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
};

/// A copy of all kernel32 declarations this program uses
const k32 = struct {
    const CreateProcessW = w.kernel32.CreateProcessW;
    /// https://learn.microsoft.com/en-us/windows/win32/api/errhandlingapi/nf-errhandlingapi-getlasterror
    const GetLastError = w.kernel32.GetLastError;
    /// https://learn.microsoft.com/en-us/windows/win32/api/synchapi/nf-synchapi-waitforsingleobject
    const WaitForSingleObject = w.kernel32.WaitForSingleObject;
    /// https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getexitcodeprocess
    const GetExitCodeProcess = w.kernel32.GetExitCodeProcess;
    /// https://learn.microsoft.com/en-us/windows/console/getconsolemode
    const GetConsoleMode = w.kernel32.GetConsoleMode;
    /// https://learn.microsoft.com/en-us/windows/win32/api/handleapi/nf-handleapi-sethandleinformation
    const SetHandleInformation = w.kernel32.SetHandleInformation;
    /// https://learn.microsoft.com/en-us/windows/console/setconsolemode
    extern "kernel32" fn SetConsoleMode(
        hConsoleHandle: w.HANDLE, // [in]
        dwMode: w.DWORD, // [in]
    ) callconv(w.WINAPI) w.BOOL;
};

fn debug(comptime fmt: []const u8, args: anytype) void {
    comptime assert(builtin.mode == .Debug);
    if (!is_standalone) {
        bunDebugMessage(fmt, args);
    } else {
        std.log.debug(fmt, args);
    }
}

fn unicodeStringToU16(str: w.UNICODE_STRING) []u16 {
    return str.Buffer.?[0 .. str.Length / 2];
}

const FILE_GENERIC_READ = w.STANDARD_RIGHTS_READ | w.FILE_READ_DATA | w.FILE_READ_ATTRIBUTES | w.FILE_READ_EA | w.SYNCHRONIZE;

const FailReason = enum {
    NoDirname,
    CouldNotOpenShim,
    CouldNotReadShim,
    InvalidShimDataSize,
    ShimNotFound,
    CreateProcessFailed,
    /// When encountering this outside of standalone mode, you should fallback
    /// to running the '.exe' file, not printing this error.
    InvalidShimValidation,
    InvalidShimBounds,
    CouldNotDirectLaunch,
    BinNotFound,
    InterpreterNotFound,
    InterpreterNotFoundBun,
    ElevationRequired,

    pub fn getFormatTemplate(reason: FailReason) []const u8 {
        return switch (reason) {
            .NoDirname => "could not find node_modules path",

            .ShimNotFound => "could not find bin metadata file",
            .CouldNotOpenShim => "could not open bin metadata file",
            .CouldNotReadShim => "could not read bin metadata",
            .InvalidShimDataSize => "bin metadata is corrupt (size)",
            .InvalidShimValidation => "bin metadata is corrupt (validate)",
            .InvalidShimBounds => "bin metadata is corrupt (bounds)",
            // The difference between these two is that one is with a shebang (#!/usr/bin/env node) and
            // the other is without. This is a helpful distinction because it can detect if something
            // like node or bun is not in %path%, vs the actual executable was not installed in node_modules.
            .InterpreterNotFound => "interpreter executable \"{s}\" not found in %PATH%",
            .InterpreterNotFoundBun => "bun is not installed in %PATH%",
            .BinNotFound => "bin executable does not exist on disk",
            .ElevationRequired => "process requires elevation",
            .CreateProcessFailed => "could not create process",

            .CouldNotDirectLaunch => if (!is_standalone)
                "bin metadata is corrupt (invalid utf16)"
            else
                // unreachable is ok because Direct Launch is not supported in standalone mode
                unreachable,
        };
    }

    pub fn format(reason: FailReason, comptime fmt: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (fmt.len != 0) @compileError("FailReason.format() only takes empty format string");

        if (!is_standalone and bun.Environment.allow_assert and reason == .InvalidShimValidation) {
            @panic("Internal Assertion: When encountering FailReason.InvalidShimValidation, you must not print the error, but rather fallback to running the .exe file");
        }

        try writer.writeAll("error: ");
        switch (reason) {
            inline else => |r| {
                if (is_standalone and r == .CouldNotDirectLaunch)
                    // unreachable is ok because Direct Launch is not supported in standalone mode
                    unreachable;

                const template = comptime getFormatTemplate(r) ++ "\n\n";

                if (comptime std.mem.indexOf(u8, template, "{s}") != null) {
                    try writer.print(template, .{failure_reason_argument.?});
                    if (dbg) {
                        failure_reason_argument = null;
                    }
                } else {
                    try writer.writeAll(template);
                }

                const rest = switch (r) {
                    .InterpreterNotFoundBun =>
                    \\Please run the following command, or double check %PATH% is right.
                    \\
                    \\    powershell -c "irm bun.sh/install.ps1|iex"
                    \\
                    \\
                    ,
                    else =>
                    \\Bun failed to remap this bin to its proper location within node_modules.
                    \\This is an indication of a corrupted node_modules directory.
                    \\
                    \\Please run 'bun install --force' in the project root and try
                    \\it again. If this message persists, please open an issue:
                    \\https://github.com/oven-sh/bun/issues
                    \\
                    \\
                };
                try writer.writeAll(rest);
            },
        }
    }

    pub inline fn write(reason: FailReason, writer: anytype) !void {
        return reason.format("", undefined, writer);
    }
};

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

var failure_reason_data: [512]u8 = undefined;
var failure_reason_argument: ?[]const u8 = null;

noinline fn failAndExitWithReason(reason: FailReason) noreturn {
    @setCold(true);

    const console_handle = w.teb().ProcessEnvironmentBlock.ProcessParameters.hStdError;
    var mode: w.DWORD = 0;
    if (k32.GetConsoleMode(console_handle, &mode) != 0) {
        mode |= w.ENABLE_VIRTUAL_TERMINAL_PROCESSING;
        _ = k32.SetConsoleMode(console_handle, mode);
    }

    reason.write(NtWriter{
        .context = @call(callmod_inline, w.teb, .{})
            .ProcessEnvironmentBlock
            .ProcessParameters
            .hStdError,
    }) catch |e| {
        if (builtin.mode == .Debug) {
            std.debug.panic("Failed to write to stderr: {s}", .{@errorName(e)});
        }
    };

    nt.RtlExitUserProcess(255);
}

const nt_object_prefix = [4]u16{ '\\', '?', '?', '\\' };

// This is used for CreateProcessW's lpCommandLine
// "The maximum length of this string is 32,767 characters, including the Unicode terminating null character."
const buf2_u16_len = 32767 + 1;

pub const LauncherMode = enum {
    launch,
    read_without_launch,

    /// Return type of `launcher`
    fn RetType(comptime mode: LauncherMode) type {
        return switch (mode) {
            // See `tryStartupFromBunJS` for why this is `void` outside of standalone.
            .launch => if (is_standalone) noreturn else void,
            .read_without_launch => ReadWithoutLaunchResult,
        };
    }

    fn FailRetType(comptime mode: LauncherMode) type {
        return switch (mode) {
            .launch => noreturn,
            .read_without_launch => ReadWithoutLaunchResult,
        };
    }

    noinline fn fail(comptime mode: LauncherMode, comptime reason: FailReason) mode.FailRetType() {
        @setCold(true);
        return switch (mode) {
            .launch => failAndExitWithReason(reason),
            .read_without_launch => ReadWithoutLaunchResult{ .err = reason },
        };
    }
};

fn launcher(comptime mode: LauncherMode, bun_ctx: anytype) mode.RetType() {
    // peb! w.teb is a couple instructions of inline asm
    const teb: *w.TEB = @call(callmod_inline, w.teb, .{});
    const peb = teb.ProcessEnvironmentBlock;
    const ProcessParameters = peb.ProcessParameters;
    const CommandLine = ProcessParameters.CommandLine;
    const ImagePathName = ProcessParameters.ImagePathName;

    // these are all different views of the same data
    const image_path_b_len = if (is_standalone) ImagePathName.Length else bun_ctx.base_path.len * 2;
    const image_path_u16 = (if (is_standalone) ImagePathName.Buffer.? else bun_ctx.base_path.ptr)[0 .. image_path_b_len / 2];
    const image_path_u8 = @as([*]u8, @ptrCast(if (is_standalone) ImagePathName.Buffer.? else bun_ctx.base_path.ptr))[0..image_path_b_len];

    const cmd_line_b_len = CommandLine.Length;
    const cmd_line_u16 = CommandLine.Buffer.?[0 .. cmd_line_b_len / 2];
    const cmd_line_u8 = @as([*]u8, @ptrCast(CommandLine.Buffer))[0..cmd_line_b_len];

    assert(@intFromPtr(cmd_line_u16.ptr) % 2 == 0); // alignment assumption

    if (dbg) {
        debug("CommandLine: {}", .{fmt16(cmd_line_u16[0 .. cmd_line_b_len / 2])});
        debug("ImagePathName: {}", .{fmt16(image_path_u16[0 .. image_path_b_len / 2])});
    }

    var buf1: [w.PATH_MAX_WIDE + "\"\" ".len]u16 = undefined;
    var buf2: [buf2_u16_len]u16 = undefined;

    const buf1_u8 = @as([*]u8, @ptrCast(&buf1[0]))[comptime buf1.len..];
    const buf1_u16 = @as([*]u16, @ptrCast(&buf1[0]))[comptime buf1.len / 2..];

    const buf2_u8 = @as([*]u8, @ptrCast(&buf2[0]))[comptime buf2.len..];
    const buf2_u16 = @as([*:0]u16, @ptrCast(&buf2[0]))[comptime buf2.len / 2..];

    // The NT prefix is not needed for non-standalone, as we only need this
    // for reading the metadata file which is skipped in non-standalone.
    //
    // BUF1: '\??\!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
    if (is_standalone) {
        @as(*align(1) u64, @ptrCast(&buf1_u8[0])).* = @as(u64, @bitCast(nt_object_prefix));
    }

    // BUF1: '\??\C:\Users\dave\project\node_modules\.bin\hello.!!!!!!!!!!!!!!!!!!!!!!!!!!'
    const suffix = comptime (if (is_standalone) wliteral("exe") else wliteral("bunx"));
    if (dbg) if (!std.mem.endsWith(u16, image_path_u16, suffix)) {
        std.debug.panic("assert failed: image path expected to end with {}, got {}", .{
            std.unicode.fmtUtf16le(suffix),
            std.unicode.fmtUtf16le(image_path_u16),
        });
    };
    const image_path_to_copy_b_len = image_path_b_len - 2 * suffix.len;
    @memcpy(
        buf1_u8[2 * nt_object_prefix.len ..][0..image_path_to_copy_b_len],
        image_path_u8[0..image_path_to_copy_b_len],
    );

    // Open the metadata file
    var metadata_handle: w.HANDLE = undefined;
    var io: w.IO_STATUS_BLOCK = undefined;
    if (is_standalone) {
        // BUF1: '\??\C:\Users\dave\project\node_modules\.bin\hello.bunx!!!!!!!!!!!!!!!!!!!!!!'
        @as(*align(1) u64, @ptrCast(&buf1_u8[image_path_b_len + 2 * (nt_object_prefix.len - "exe".len)])).* = @as(u64, @bitCast([4]u16{ 'b', 'u', 'n', 'x' }));

        const path_len_bytes: c_ushort = image_path_b_len + @as(c_ushort, 2 * (nt_object_prefix.len - "exe".len + "bunx".len));
        var nt_name = w.UNICODE_STRING{
            .Length = path_len_bytes,
            .MaximumLength = path_len_bytes,
            .Buffer = buf1_u16,
        };
        if (dbg) debug("NtCreateFile({s})", .{fmt16(unicodeStringToU16(nt_name))});
        if (dbg) debug("NtCreateFile({any})", .{(unicodeStringToU16(nt_name))});
        var attr = w.OBJECT_ATTRIBUTES{
            .Length = @sizeOf(w.OBJECT_ATTRIBUTES),
            .RootDirectory = null,
            .Attributes = 0, // Note we do not use OBJ_CASE_INSENSITIVE here.
            .ObjectName = &nt_name,
            .SecurityDescriptor = null,
            .SecurityQualityOfService = null,
        };
        // NtCreateFile will fail for absolute paths if we do not pass an OBJECT name
        // so we need the prefix here. This is an extra sanity check.
        if (dbg) {
            assert(std.mem.startsWith(u16, unicodeStringToU16(nt_name), &nt_object_prefix));
            assert(std.mem.endsWith(u16, unicodeStringToU16(nt_name), comptime wliteral(".bunx")));
        }
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
            if (dbg) debug("error opening: {s}", .{@tagName(rc)});
            if (rc == .OBJECT_NAME_NOT_FOUND)
                mode.fail(.ShimNotFound);
            mode.fail(.CouldNotOpenShim);
        }
    } else {
        metadata_handle = bun_ctx.handle;
    }

    // get a slice to where the CLI arguments are
    // the slice will have a leading space ' arg arg2' or be empty ''
    const user_arguments_u8: []const u8 = if (!is_standalone)
        std.mem.sliceAsBytes(bun_ctx.arguments)
    else find_args: {
        // Windows command line quotes are really silly. This post explains it better than I can:
        // https://stackoverflow.com/questions/7760545/escape-double-quotes-in-parameter
        var in_quote = false;
        var i: usize = 0;
        while (i < cmd_line_u16.len) : (i += 1) {
            if (cmd_line_u16[i] == '"') {
                in_quote = !in_quote;
                if (!in_quote) {
                    // 'quote directly follows closer - acts as plain unwrapped text: "'
                    if (i + 1 < cmd_line_u16.len and cmd_line_u16[i + 1] == '"') {
                        // skip this quote and keep the state in 'not in a quote'
                        i += 1;
                    }
                }
            } else if (cmd_line_u16[i] == ' ' and !in_quote) {
                // there are more arguments!
                // if this is the end of the string then this becomes an empty slice,
                // otherwise it is a slice of just the arguments
                while (cmd_line_u16[i] == ' ') i += 1;
                break :find_args cmd_line_u8[i * 2 - 2 * " ".len ..];
            }
        }
        // no args
        break :find_args cmd_line_u8[0..0];
    };

    if (dbg) debug("UserArgs: '{s}' ({d} bytes)", .{ user_arguments_u8, user_arguments_u8.len });

    assert(user_arguments_u8.len % 2 == 0);
    assert(user_arguments_u8.len != 2);
    assert(user_arguments_u8.len == 0 or user_arguments_u8[0] == ' ');

    // Read the metadata file into the memory right after the image path.
    //
    // i'm really proud of this technique, because it will create an absolute path, but
    // without needing to store the absolute path in the '.bunx' file
    //
    // we do this by reusing the memory in the first buffer
    // BUF1: '\??\C:\Users\dave\project\node_modules\.bin\hello.bunx!!!!!!!!!!!!!!!!!!!!!!'
    //                                              ^^        ^     ^
    //                                              S|        |     image_path_b_len + nt_object_prefix.len
    //                                               |        'ptr' initial value
    //                                              the read ptr
    var read_ptr: [*]u16 = brk: {
        var left = image_path_b_len / 2 - (if (is_standalone) ".exe".len else ".bunx".len) - 1;
        var ptr: [*]u16 = buf1_u16[nt_object_prefix.len + left ..];
        if (dbg) debug("left = {d}, at {}, after {}", .{ left, ptr[0], ptr[1] });

        // if this is false, potential out of bounds memory access
        if (dbg)
            assert(
                @intFromPtr(ptr) - left * @sizeOf(std.meta.Child(@TypeOf(ptr))) >= @intFromPtr(buf1_u16),
            );
        // we start our search right before the . as we know the extension is '.bunx'
        assert(ptr[1] == '.');

        while (true) {
            if (dbg) debug("1 - {}", .{std.unicode.fmtUtf16le(ptr[0..1])});
            if (ptr[0] == '\\') {
                left -= 1;
                // ptr is of type [*]u16, which means -= operates on number of ITEMS, not BYTES
                ptr -= 1;
                break;
            }
            left -= 1;
            if (left == 0) {
                return mode.fail(.NoDirname);
            }
            ptr -= 1;
            if (dbg)
                assert(@intFromPtr(ptr) >= @intFromPtr(buf1_u16));
        }
        // inlined loop to do this again, because the completion case is different
        // using `inline for` caused comptime issues that made the code much harder to read
        while (true) {
            if (dbg) debug("2 - {}", .{std.unicode.fmtUtf16le(ptr[0..1])});
            if (ptr[0] == '\\') {
                // ptr is at the position marked S, so move forward one *character*
                break :brk ptr + 1;
            }
            left -= 1;
            if (left == 0) {
                return mode.fail(.NoDirname);
            }
            ptr -= 1;
            if (dbg)
                assert(@intFromPtr(ptr) >= @intFromPtr(buf1_u16));
        }
        @compileError("unreachable - the loop breaks this entire block");
    };
    assert(read_ptr[0] != '\\');
    assert((read_ptr - 1)[0] == '\\');

    const read_max_len = buf1.len * 2 - (@intFromPtr(read_ptr) - @intFromPtr(buf1_u16));

    if (dbg) debug("read_ptr = buf1 + {d}", .{(@intFromPtr(read_ptr) - @intFromPtr(buf1_u16))});
    if (dbg) debug("max_read_len = {d}", .{read_max_len});

    // Do the read!
    //
    //                                               v overwritten data
    // BUF1: '\??\C:\Users\dave\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
    //                                                                 ^^    ^   ^ flags u16
    //                                                        a zero u16|    shebang meta
    //                                                                  |shebang data
    //
    // We are intentionally only reading one chunk. The metadata file is almost always going to be < 200 bytes
    // If this becomes a problem we will fix it.
    const read_status = nt.NtReadFile(metadata_handle, null, null, null, &io, read_ptr, @intCast(read_max_len), null, null);
    const read_len = switch (read_status) {
        .SUCCESS => io.Information,
        .END_OF_FILE =>
        // Supposedly .END_OF_FILE will be hit if you read exactly the amount of data left
        // "IO_STATUS_BLOCK is filled only if !NT_ERROR(status)"
        // https://stackoverflow.com/questions/62438021/can-ntreadfile-produce-a-short-read-without-reaching-eof
        // In the context of this program, I don't think that is possible, but I will handle it
        read_max_len,
        else => |rc| {
            if (dbg) debug("error reading: {s}", .{@tagName(rc)});
            return mode.fail(.CouldNotReadShim);
        },
    };

    _ = nt.NtClose(metadata_handle);

    if (dbg) debug("BufferAfterRead: '{}'", .{fmt16(buf1_u16[0 .. ((@intFromPtr(read_ptr) - @intFromPtr(buf1_u8)) + read_len) / 2])});

    read_ptr = @ptrFromInt(@intFromPtr(read_ptr) + read_len - @sizeOf(Flags));
    const flags: Flags = @as(*align(1) Flags, @ptrCast(read_ptr)).*;

    if (dbg) {
        const flags_u16: u16 = @as(*align(1) u16, @ptrCast(read_ptr)).*;
        debug("FlagsInt: {d}", .{flags_u16});

        debug("Flags:", .{});
        inline for (comptime std.meta.fieldNames(Flags)) |name| {
            debug("    {s}: {}", .{ name, @field(flags, name) });
        }
    }

    if (!flags.isValid()) {
        // We want to return control flow back into bun.exe's main code, so that it can fall
        // back to the slow path. For more explanation, see the comment on top of `tryStartupFromBunJS`.
        if (!is_standalone and mode == .launch)
            return;

        return mode.fail(.InvalidShimValidation);
    }

    var spawn_command_line: [*:0]u16 = switch (flags.has_shebang) {
        false => spawn_command_line: {
            // no shebang, which means the command line is simply going to be the joined file exe
            // followed by the existing command line.
            //
            // I don't have a good example of this in practice, but it is certainly possible.
            // (a package distributing an exe [like esbuild] usually has their own wrapper script)
            //
            // Instead of the above, the buffer would actually look like:
            // BUF1: '\??"C:\Users\dave\project\node_modules\my-cli\src\app.js"##!!!!!!!!!!'
            //                                                                 ^^ flags
            //                                                        zero char|

            // change the \ from '\??\' to '""
            // the ending quote is assumed to already exist as per the format
            // BUF1: '\??"C:\Users\dave\project\node_modules\my-cli\src\app.js"##!!!!!!!!!!'
            //           ^
            buf1_u16[3] = '"';

            // Copy user arguments in, overwriting old data. Remember that we ensured the arguments
            // this started with a space.
            // BUF1: '\??"C:\Users\dave\project\node_modules\my-cli\src\app.js"##!!!!!!!!!!'
            //                                               ^                 ^^
            //                                               read_ptr (old)    |read_ptr (right now)
            //                                                                 argument_start_ptr
            //
            // BUF1: '\??"C:\Users\dave\project\node_modules\my-cli\src\app.js" --flag!!!!!'
            const argument_start_ptr: [*]u8 = @ptrFromInt(@intFromPtr(read_ptr) - 2 * "\x00".len);
            if (user_arguments_u8.len > 0) {
                @memcpy(argument_start_ptr, user_arguments_u8);
            }

            // BUF1: '\??"C:\Users\dave\project\node_modules\my-cli\src\app.js" --flag#!!!!'
            //           ^ lpCommandLine                                              ^ null terminator
            @as(*align(1) u16, @ptrCast(argument_start_ptr + user_arguments_u8.len)).* = 0;

            break :spawn_command_line @alignCast(@ptrCast(buf1_u8 + 2 * (nt_object_prefix.len - "\"".len)));
        },
        true => spawn_command_line: {
            // When the shebang flag is set, we expect two u32s containing byte lengths of the bin and arg components
            // This is not needed for the other case because the other case does not have an args component.
            const ShebangMetadataPacked = packed struct {
                bin_path_len_bytes: u32,
                args_len_bytes: u32,
            };

            // BUF1: '\??\C:\Users\dave\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
            //                                                                       ^ new read_ptr
            read_ptr = @ptrFromInt(@intFromPtr(read_ptr) - @sizeOf(ShebangMetadataPacked));
            const shebang_metadata: ShebangMetadataPacked = @as(*align(1) ShebangMetadataPacked, @ptrCast(read_ptr)).*;

            const shebang_arg_len_u8 = shebang_metadata.args_len_bytes;
            const shebang_bin_path_len_bytes = shebang_metadata.bin_path_len_bytes;

            if (dbg) {
                debug("bin_path_len_bytes: {}", .{shebang_metadata.bin_path_len_bytes});
                debug("args_len_bytes: {}", .{shebang_metadata.args_len_bytes});
            }

            // magic number related to how BinLinkingShim.zig writes the metadata
            // i'm sorry, i don't have a good explanation for why this number is this number. it just is.
            const validation_length_offset = 14;

            // very careful here to not overflow u32, so that we properly error if you hijack the file
            if (shebang_arg_len_u8 == 0 or
                (@as(u64, shebang_arg_len_u8) +| @as(u64, shebang_bin_path_len_bytes)) + validation_length_offset != read_len)
            {
                if (dbg)
                    debug("read_len: {}", .{read_len});

                return mode.fail(.InvalidShimBounds);
            }

            if (!is_standalone and flags.is_node_or_bun and bun_ctx.force_use_bun) {
                // If we are running `bun --bun ...` and the script is already set to run
                // in node.exe or bun.exe, we can just directly launch it by calling Run.boot
                //
                // This can only be done in non-standalone as standalone doesn't have the JS runtime.
                // And if --bun was passed to any parent bun process, then %PATH% is already setup
                // to redirect a call to node.exe -> bun.exe. So we need not check.
                //
                // This optimization can save an additional ~10-20ms depending on the machine
                // as we do not have to launch a second process.
                if (dbg) debug("direct_launch_with_bun_js", .{});
                // BUF1: '\??\C:\Users\dave\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
                //            ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^  ^ read_ptr
                const len = (@intFromPtr(read_ptr) - @intFromPtr(buf1_u8) - shebang_arg_len_u8) / 2 - nt_object_prefix.len - "\"\x00".len;
                const launch_slice = buf1_u16[nt_object_prefix.len..][0..len :'"']; // assert we slice at the "
                bun_ctx.direct_launch_with_bun_js(
                    launch_slice,
                    bun_ctx.cli_context,
                );
                return mode.fail(.CouldNotDirectLaunch);
            }

            // Copy the shebang bin path
            // BUF1: '\??\C:\Users\dave\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
            //                                                                  ^~~~^
            //                                                                  ^ read_ptr
            // BUF2: 'node !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
            read_ptr = @ptrFromInt(@intFromPtr(read_ptr) - shebang_arg_len_u8);
            @memcpy(buf2_u8, @as([*]u8, @ptrCast(read_ptr))[0..shebang_arg_len_u8]);

            // BUF2: 'node "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
            @as(*align(1) u16, @ptrCast(buf2_u8 + shebang_arg_len_u8)).* = '"';

            // Copy the filename in. There is no leading " but there is a trailing "
            // BUF1: '\??\C:\Users\dave\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
            //            ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^ ^ read_ptr
            // BUF2: 'node "C:\Users\dave\project\node_modules\my-cli\src\app.js"!!!!!!!!!!!!!!!!!!!!'
            const length_of_filename_u8 = @intFromPtr(read_ptr) -
                @intFromPtr(buf1_u8) - 2 * (nt_object_prefix.len + "\x00".len);
            const filename = buf1_u8[2 * nt_object_prefix.len ..][0..length_of_filename_u8];
            if (dbg) {
                const sliced = std.mem.bytesAsSlice(u16, filename);
                debug("filename and quote: '{}'", .{fmt16(@alignCast(sliced))});
                debug("last char of above is '{}'", .{sliced[sliced.len - 1]});
                assert(sliced[sliced.len - 1] == '\"');
            }

            @memcpy(
                buf2_u8[shebang_arg_len_u8 + 2 * "\"".len ..][0..length_of_filename_u8],
                filename,
            );
            // the pointer is now going to act as a write pointer for remaining data.
            // note that it points into buf2 now, not buf1. this will write arguments and the null terminator
            // BUF2: 'node "C:\Users\dave\project\node_modules\my-cli\src\app.js"!!!!!!!!!!!!!!!!!!!!'
            //                                                                   ^ write_ptr
            if (dbg) {
                debug("advance = {} + {} + {}\n", .{ shebang_arg_len_u8, "\"".len, length_of_filename_u8 });
            }
            const advance = shebang_arg_len_u8 + 2 * "\"".len + length_of_filename_u8;
            var write_ptr: [*]u16 = @ptrFromInt(@intFromPtr(buf2_u8) + advance);
            assert((write_ptr - 1)[0] == '"');

            if (user_arguments_u8.len > 0) {
                // Copy the user arguments in:
                // BUF2: 'node "C:\Users\dave\project\node_modules\my-cli\src\app.js" --flags!!!!!!!!!!!'
                //        ^~~~~X^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^
                //        |    |filename_len                                         write_ptr
                //        |    the quote
                //        shebang_arg_len
                @memcpy(@as([*]u8, @ptrCast(write_ptr)), user_arguments_u8);
                write_ptr = @ptrFromInt(@intFromPtr(write_ptr) + user_arguments_u8.len);
            }

            // BUF2: 'node "C:\Users\dave\project\node_modules\my-cli\src\app.js" --flags#!!!!!!!!!!'
            //                                                                           ^ null terminator
            write_ptr[0] = 0;

            break :spawn_command_line @ptrCast(buf2_u16);
        },
    };

    if (!is_standalone) {
        // Prepare stdio for the child process, as after this we are going to *immediatly* exit
        // it is likely that the c-runtime's atexit will not be called as we end the process ourselves.
        bun.Output.Source.Stdio.restore();
        bun.C.windows_enable_stdio_inheritance();
    }

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
        // The standard handles outside of standalone may be tampered with.
        .hStdInput = if (is_standalone) ProcessParameters.hStdInput else bun.win32.STDIN_FD.cast(),
        .hStdOutput = if (is_standalone) ProcessParameters.hStdOutput else bun.win32.STDOUT_FD.cast(),
        .hStdError = if (is_standalone) ProcessParameters.hStdError else bun.win32.STDERR_FD.cast(),
    };

    inline for (.{ 0, 1 }) |attempt_number| iteration: {
        if (dbg)
            debug("lpCommandLine: {}\n", .{fmt16(std.mem.span(spawn_command_line))});
        const did_process_spawn = k32.CreateProcessW(
            null,
            spawn_command_line,
            null,
            null,
            1, // true
            if (is_standalone) 0 else w.CREATE_UNICODE_ENVIRONMENT,
            if (is_standalone) null else @constCast(bun_ctx.environment),
            null,
            &startup_info,
            &process,
        );
        if (did_process_spawn == 0) {
            const spawn_err = k32.GetLastError();
            if (dbg) {
                debug("CreateProcessW failed: {s}", .{@tagName(spawn_err)});
                debug("attempt number: {d}", .{attempt_number});
            }
            return switch (spawn_err) {
                .FILE_NOT_FOUND => if (flags.has_shebang) {
                    if (attempt_number == 0) {
                        if (flags.is_node) {
                            if (dbg)
                                debug("node is not found, changing to bun", .{});

                            if (!is_standalone) {
                                // TODO: this is another place that direct_launch_with_bun_js should be used
                            }

                            // There are many packages that specifically call for node.exe, and Bun will respect that
                            // but if node installed, this means the binary is unlaunchable. So before we fail,
                            // we will try to launch it with bun.exe
                            //
                            // This is not an issue when using 'bunx' or 'bun run', because node.exe is already
                            // added to the path synthetically through 'createFakeTemporaryNodeExecutable'. The path
                            // here applies for when the binary is launched directly (user shell, double click, etc...)
                            assert(flags.has_shebang);
                            if (dbg)
                                assert(std.mem.startsWith(u16, std.mem.span(spawn_command_line), comptime wliteral("node ")));

                            // To go from node -> bun, it is a matter of writing three chars, and incrementing a pointer.
                            //
                            // lpCommandLine: 'node "C:\Users\dave\project\node_modules\my-cli\src\app.js" --flags#!!!!!!!!!!'
                            //                  ^~~ replace these three bytes with 'bun'
                            @memcpy(spawn_command_line[1..][0..3], comptime wliteral("bun"));

                            // lpCommandLine: 'nbun "C:\Users\dave\project\node_modules\my-cli\src\app.js" --flags#!!!!!!!!!!'
                            //                  ^ increment pointer by one char
                            spawn_command_line += 1;

                            break :iteration; // loop back
                        }

                        if (flags.is_node_or_bun) {
                            // This script calls for 'bun', but it was not found.
                            if (dbg)
                                assert(std.mem.startsWith(u16, std.mem.span(spawn_command_line), comptime wliteral("bun ")));
                            return mode.fail(.InterpreterNotFoundBun);
                        }
                    }

                    // if attempt_number == 1, we already tried rewriting this to bun, and will now fail for real
                    if (attempt_number == 1) {
                        if (dbg)
                            assert(std.mem.startsWith(u16, std.mem.span(spawn_command_line), comptime wliteral("bun ")));
                        return mode.fail(.InterpreterNotFoundBun);
                    }

                    // This UTF16 -> UTF-8 conversion is intentionally very lossy, and assuming that ascii text is provided.
                    // This trade off is made to reduce the binary size of the shim.
                    failure_reason_argument = brk: {
                        var i: u32 = 0;
                        while (spawn_command_line[i] != ' ' and i < 512) : (i += 1) {
                            failure_reason_data[i] = @as(u7, @truncate(spawn_command_line[i]));
                        }
                        break :brk failure_reason_data[0..i];
                    };
                    return mode.fail(.InterpreterNotFound);
                } else return mode.fail(.BinNotFound),

                // TODO: ERROR_ELEVATION_REQUIRED must take a fallback path, this path is potentially slower:
                // This likely will not be an issue anyone runs into for a while, because it implies
                // the shebang depends on something that requires UAC, which .... why?
                //
                // https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works#user
                // https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew
                .ELEVATION_REQUIRED => return mode.fail(.ElevationRequired),

                else => return mode.fail(.CreateProcessFailed),
            };
        }

        _ = k32.WaitForSingleObject(process.hProcess, w.INFINITE);

        var exit_code: w.DWORD = 255;
        _ = k32.GetExitCodeProcess(process.hProcess, &exit_code);
        if (dbg) debug("exit_code: {d}", .{exit_code});

        _ = nt.NtClose(process.hProcess);
        _ = nt.NtClose(process.hThread);

        nt.RtlExitUserProcess(exit_code);
        @compileError("unreachable - RtlExitUserProcess does not return");
    }
    @compileError("unreachable - above loop should not exit");
}

pub const FromBunRunContext = struct {
    const CommandContext = bun.CLI.Command.Context;

    /// Path like 'C:\Users\dave\project\node_modules\.bin\foo.bunx'
    base_path: []u16,
    /// Command line arguments which does NOT include the bin name:
    /// like '--port 3000 --config ./config.json'
    arguments: []u16,
    /// Handle to the successfully opened metadata file
    handle: w.HANDLE,
    /// Was --bun passed?
    force_use_bun: bool,
    /// A pointer to a function that can launch `Run.boot`
    direct_launch_with_bun_js: *const fn (wpath: []u16, args: CommandContext) void,
    /// Command.Context
    cli_context: CommandContext,
    /// Passed directly to CreateProcessW's lpEnvironment with CREATE_UNICODE_ENVIRONMENT
    environment: ?[*]const u16,
};

/// This is called from run_command.zig in bun.exe which allows us to skip the CreateProcessW
/// call to create bun_shim_impl.exe. Instead we invoke the logic it has from an open file handle.
///
/// This saves ~5-12ms depending on the machine.
///
/// If the launch is successful, this function does not return. If a validation error occurs,
/// this returns void, to which the caller should still try invoking the exe directly. This
/// is to handle version mismatches where bun.exe's decoder is too new than the .bunx file.
pub fn tryStartupFromBunJS(context: FromBunRunContext) void {
    assert(!std.mem.startsWith(u16, context.base_path, &nt_object_prefix));
    comptime assert(!is_standalone);
    comptime assert(bun.FeatureFlags.windows_bunx_fast_path);
    launcher(.launch, context);
}

pub const FromBunShellContext = struct {
    /// Path like 'C:\Users\dave\project\node_modules\.bin\foo.bunx'
    base_path: []u16,
    /// Command line arguments which does NOT include the bin name:
    /// like '--port 3000 --config ./config.json'
    arguments: []u16,
    /// Handle to the successfully opened metadata file
    handle: w.HANDLE,
    /// Was --bun passed?
    force_use_bun: bool,
    /// A pointer to memory needed to store the command line
    buf: *Buf,

    pub const Buf = [buf2_u16_len]u16;
};

pub const ReadWithoutLaunchResult = union {
    err: FailReason, // enum which has a predefined custom formatter
    command_line: []const u16,
};

/// Given the path and handle to a .bunx file, do everything needed to execute it,
/// *except* for spawning it. This is used by the Bun shell to skip spawning the
/// bun_shim_impl.exe executable. The returned command line is fed into the shell's
/// method for launching a process.
///
/// The cost of spawning is about 5-12ms, and the unicode conversions are way
/// faster than that, so this is a huge win.
pub fn readWithoutLaunch(context: FromBunShellContext) ReadWithoutLaunchResult {
    assert(!std.mem.startsWith(u16, context.base_path, &nt_object_prefix));
    comptime assert(!is_standalone);
    comptime assert(bun.FeatureFlags.windows_bunx_fast_path);
    return launcher(.read_without_launch, context);
}

/// Main function for `bun_shim_impl.exe`
pub inline fn main() noreturn {
    comptime assert(is_standalone);
    comptime assert(builtin.single_threaded);
    comptime assert(!builtin.link_libc);
    comptime assert(!builtin.link_libcpp);
    launcher(.launch, {});
}
