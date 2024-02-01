//! This program is a shim for node_modules/.bin scripts.
//!
//! This is needed because:
//! - Symlinks are not guaranteed to work on Windows
//! - Windows does not process Shebangs
//!
//! This also solves the 'Terminate batch job (Y/N)' problem you see when using NPM/Yarn,
//! which is a HUGE dx win for developers.
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
//! The approach implemented instead is a `.bunx` file which sits right next to the renamed
//! launcher exe. We read that (see BunXShim.zig for the creation of this file) and do some
//! clever tricks and then we can NtCreateProcess with the correct arguments.
//!
//! Prior Art:
//! - https://github.com/ScoopInstaller/Shim/blob/master/src/shim.cs
//!
//! The compiled binary is 10240 bytes and is `@embedFile`d into Bun itself.
//! When this file is updated, the new binary should be compiled and BinLinkingShim.VersionFlag.current should be updated.
const std = @import("std");
const builtin = @import("builtin");

pub inline fn wliteral(comptime str: []const u8) []const u16 {
    if (!@inComptime()) @compileError("strings.w() must be called in a comptime context");
    comptime var output: [str.len]u16 = undefined;

    for (str, 0..) |c, i| {
        output[i] = c;
    }

    const Static = struct {
        pub const literal: []const u16 = output[0..output.len];
    };
    return Static.literal;
}

const is_standalone = !@hasDecl(@import("root"), "bun");
const bunDebugMessage = @import("root").bun.Output.scoped(.bun_shim_impl, true);

const dbg = builtin.mode == .Debug;

const Flags = @import("./BinLinkingShim.zig").Flags;

const assert = std.debug.assert;
const fmt16 = std.unicode.fmtUtf16le;

const w = std.os.windows;

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
        printError(fmt, args);
    }
}

fn unicodeStringToU16(str: w.UNICODE_STRING) []u16 {
    return str.Buffer[0 .. str.Length / 2];
}

const FILE_GENERIC_READ = w.STANDARD_RIGHTS_READ | w.FILE_READ_DATA | w.FILE_READ_ATTRIBUTES | w.FILE_READ_EA | w.SYNCHRONIZE;

const FailReason = enum {
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
            .NoDirname => "could not find node_modules path",

            .ShimNotFound => "could not find bin metadata file",
            .CouldNotOpenShim => "could not open bin metadata file",
            .CouldNotReadShim => "could not read bin metadata",
            .InvalidShimDataSize => "bin metadata is corrupt (size)",
            .InvalidShimValidation => "bin metadata is corrupt (validate)",
            .InvalidShimBounds => "bin metadata is corrupt (bounds)",
            .CreateProcessFailed => "could not create process",

            .CouldNotDirectLaunch => if (!is_standalone)
                "bin metadata is corrupt (invalid utf16)"
            else
                // Unreachable is ok because Direct Launch is not supported in standalone mode
                unreachable,
        };
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

    const console_handle = w.teb().ProcessEnvironmentBlock.ProcessParameters.hStdError;
    var mode: w.DWORD = 0;
    if (k32.GetConsoleMode(console_handle, &mode) != 0) {
        mode |= w.ENABLE_VIRTUAL_TERMINAL_PROCESSING;
        _ = k32.SetConsoleMode(console_handle, mode);
    }

    printError(
        \\error: {s}
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

const nt_object_prefix = [4]u16{ '\\', '?', '?', '\\' };

fn launcher(bun_ctx: anytype) noreturn {
    // peb! w.teb is a couple instructions of inline asm
    const teb: *w.TEB = @call(.always_inline, w.teb, .{});
    const peb = teb.ProcessEnvironmentBlock;
    const ProcessParameters = peb.ProcessParameters;
    const CommandLine = ProcessParameters.CommandLine;
    const ImagePathName = ProcessParameters.ImagePathName;

    // these are all different views of the same data
    const image_path_b_len = if (is_standalone) ImagePathName.Length else bun_ctx.base_path.len * 2;
    const image_path_u16 = (if (is_standalone) ImagePathName.Buffer else bun_ctx.base_path.ptr)[0 .. image_path_b_len / 2];
    const image_path_u8 = @as([*]u8, @ptrCast(if (is_standalone) ImagePathName.Buffer else bun_ctx.base_path.ptr))[0..image_path_b_len];

    const cmd_line_b_len = CommandLine.Length;
    const cmd_line_u16 = CommandLine.Buffer[0 .. cmd_line_b_len / 2];
    const cmd_line_u8 = @as([*]u8, @ptrCast(CommandLine.Buffer))[0..cmd_line_b_len];

    assert(@intFromPtr(cmd_line_u16.ptr) % 2 == 0); // alignment assumption

    if (dbg) {
        debug("CommandLine: {}\n", .{fmt16(cmd_line_u16[0 .. cmd_line_b_len / 2])});
        debug("ImagePathName: {}\n", .{fmt16(image_path_u16[0 .. image_path_b_len / 2])});
    }

    var buf1: [
        w.PATH_MAX_WIDE + "\"\" ".len
    ]u16 = undefined;

    // This is used for CreateProcessW's lpCommandLine
    // "The maximum length of this string is 32,767 characters, including the Unicode terminating null character."
    var buf2: [32767 + 1]u16 = undefined;

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
    std.debug.assert(std.mem.endsWith(u16, image_path_u16, suffix));
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
        // NtCreateFile will fail for absolute paths if we do not pass an OBJECT name
        // so we need the prefix here. This is an extra sanity check.
        if (dbg) {
            std.debug.assert(std.mem.startsWith(u16, unicodeStringToU16(nt_name), &nt_object_prefix));
            std.debug.assert(std.mem.endsWith(u16, unicodeStringToU16(nt_name), comptime wliteral(".bunx")));
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
            if (dbg) debug("error opening: {s}\n", .{@tagName(rc)});
            if (rc == .OBJECT_NAME_NOT_FOUND)
                fail(.ShimNotFound);
            fail(.CouldNotOpenShim);
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

    if (dbg) debug("UserArgs: '{s}' ({d} bytes)\n", .{ user_arguments_u8, user_arguments_u8.len });

    std.debug.assert(user_arguments_u8.len % 2 == 0);
    std.debug.assert(user_arguments_u8.len != 2);
    std.debug.assert(user_arguments_u8.len == 0 or user_arguments_u8[0] == ' ');

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
        if (dbg) debug("left = {d}, at {}, after {}\n", .{ left, ptr[0], ptr[1] });

        // if this is false, potential out of bounds memory access
        std.debug.assert(@intFromPtr(ptr) - left * @sizeOf(std.meta.Child(@TypeOf(ptr))) >= @intFromPtr(buf1_u16));
        // we start our search right before the . as we know the extension is '.bunx'
        std.debug.assert(ptr[1] == '.');

        while (true) {
            if (dbg) debug("1 - {}\n", .{std.unicode.fmtUtf16le(ptr[0..1])});
            if (ptr[0] == '\\') {
                left -= 1;
                // ptr is of type [*]u16, which means -= operates on number of ITEMS, not BYTES
                ptr -= 1;
                break;
            }
            left -= 1;
            if (left == 0) {
                fail(.NoDirname);
            }
            ptr -= 1;
            std.debug.assert(@intFromPtr(ptr) >= @intFromPtr(buf1_u16));
        }
        // inlined loop to do this again, because the completion case is different
        // using `inline for` caused comptime issues that made the code much harder to read
        while (true) {
            if (dbg) debug("2 - {}\n", .{std.unicode.fmtUtf16le(ptr[0..1])});
            if (ptr[0] == '\\') {
                // ptr is at the position marked s, so move forward one *character*
                break :brk ptr + 1;
            }
            left -= 1;
            if (left == 0) {
                fail(.NoDirname);
            }
            ptr -= 1;
            std.debug.assert(@intFromPtr(ptr) >= @intFromPtr(buf1_u16));
        }
        comptime unreachable;
    };
    std.debug.assert(read_ptr[0] != '\\');
    std.debug.assert((read_ptr - 1)[0] == '\\');

    const read_max_len = buf1.len * 2 - (@intFromPtr(read_ptr) - @intFromPtr(buf1_u16));

    if (dbg) debug("read_ptr = buf1 + {d}\n", .{(@intFromPtr(read_ptr) - @intFromPtr(buf1_u16))});
    if (dbg) debug("max_read_len = {d}\n", .{read_max_len});

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
            if (dbg) debug("error reading: {s}\n", .{@tagName(rc)});
            fail(.CouldNotReadShim);
        },
    };

    _ = nt.NtClose(metadata_handle);

    if (dbg) debug("BufferAfterRead: '{}'\n", .{fmt16(buf1_u16[0 .. ((@intFromPtr(read_ptr) - @intFromPtr(buf1_u8)) + read_len) / 2])});

    read_ptr = @ptrFromInt(@intFromPtr(read_ptr) + read_len - @sizeOf(Flags));
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

    const spawn_command_line: [*:0]u16 = switch (flags.has_shebang) {
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
                debug("bin_path_len_bytes: {}\n", .{shebang_metadata.bin_path_len_bytes});
                debug("args_len_bytes: {}\n", .{shebang_metadata.args_len_bytes});
            }

            // magic number related to how BinLinkingShim.zig writes the metadata
            // i'm sorry, i don't have a good explanation for why this number is this number. it just is.
            const validation_length_offset = 14;

            // very careful here to not overflow u32, so that we properly error if you hijack the file
            if (shebang_arg_len_u8 == 0 or
                (@as(u64, shebang_arg_len_u8) +| @as(u64, shebang_bin_path_len_bytes)) + validation_length_offset != read_len)
            {
                if (dbg)
                    debug("read_len: {}\n", .{read_len});

                fail(.InvalidShimBounds);
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
                if (dbg) debug("direct_launch_with_bun_js\n", .{});
                // BUF1: '\??\C:\Users\dave\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
                //            ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^       ^ read_ptr
                const launch_slice = buf1_u16[nt_object_prefix.len..][0 .. (@intFromPtr(read_ptr) - @intFromPtr(buf1_u8)) / 2 - shebang_arg_len_u8 - "\"".len];
                bun_ctx.direct_launch_with_bun_js(
                    launch_slice,
                    bun_ctx.cli_context,
                );
                fail(.CouldNotDirectLaunch);
            }

            // Copy the shebang bin path
            // BUF1: '\??\C:\Users\dave\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
            //                                                                  ^~~~^
            // BUF2: 'node !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
            read_ptr = @ptrFromInt(@intFromPtr(read_ptr) - shebang_arg_len_u8);
            @memcpy(buf2_u8, @as([*]u8, @ptrCast(read_ptr))[0..shebang_arg_len_u8]);

            // BUF2: 'node "!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!'
            @as(*align(1) u16, @ptrCast(buf2_u8 + shebang_arg_len_u8)).* = '"';

            // Copy the filename in. There is no leading " but there is a trailing "
            // BUF1: '\??\C:\Users\dave\project\node_modules\my-cli\src\app.js"#node #####!!!!!!!!!!'
            //            ^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^ ^ read_ptr
            // BUF2: 'node "C:\Users\dave\project\node_modules\my-cli\src\app.js"!!!!!!!!!!!!!!!!!!!!'
            const length_of_filename_u8 = (@intFromPtr(read_ptr) - (2 * "\x00".len)) - @intFromPtr(buf1_u8);
            @memcpy(
                buf2_u8[shebang_arg_len_u8 + 2 * "\"".len ..][0..length_of_filename_u8],
                buf1_u8[2 * nt_object_prefix.len ..][0..length_of_filename_u8],
            );

            // Copy the user arguments in:
            // BUF2: 'node "C:\Users\dave\project\node_modules\my-cli\src\app.js" --flags!!!!!!!!!!!'
            //        ^~~~~X^~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~~^
            //        |    |filename_len                                         where the user args go
            //        |    the quote
            //        shebang_arg_len
            read_ptr = @ptrFromInt(@intFromPtr(buf2_u8) + shebang_arg_len_u8 + length_of_filename_u8 + 2 * "\"".len);
            if (user_arguments_u8.len > 0) {
                @memcpy(@as([*]u8, @ptrCast(read_ptr)), user_arguments_u8);
                read_ptr += user_arguments_u8.len;
            }

            // BUF2: 'node "C:\Users\dave\project\node_modules\my-cli\src\app.js" --flags#!!!!!!!!!!'
            //                                                                           ^ null terminator
            @as(*align(1) u16, @ptrCast(read_ptr)).* = 0;

            break :spawn_command_line @ptrCast(buf2_u16);
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
        // TODO: ERROR_ELEVATION_REQUIRED must take a fallback path, this path is potentially slower:
        // This likely will not be an issue anyone runs into for a while, because it implies
        // the shebang depends on something that requires UAC, which .... why?
        //
        // https://learn.microsoft.com/en-us/windows/security/application-security/application-control/user-account-control/how-it-works#user
        // https://learn.microsoft.com/en-us/windows/win32/api/shellapi/nf-shellapi-shellexecutew
        fail(.CreateProcessFailed);
    }

    _ = k32.WaitForSingleObject(process.hProcess, w.INFINITE);

    var exit_code: w.DWORD = 255;
    _ = k32.GetExitCodeProcess(process.hProcess, &exit_code);

    _ = nt.NtClose(process.hProcess);
    _ = nt.NtClose(process.hThread);

    nt.RtlExitUserProcess(exit_code);
}

pub const FromBunRunContext = struct {
    const CommandContext = @import("root").bun.CLI.Command.Context;

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
    direct_launch_with_bun_js: *const fn (wpath: []u16, args: *CommandContext) void,
    /// Command.Context
    cli_context: *CommandContext,
};

/// This is called from run_command.zig in bun.exe which allows us to skip the CreateProcessW
/// call to create bun_shim_impl.exe. Instead we invoke the logic it has from an open file handle.
///
/// We pass in the context struct from above.
///
/// This saves ~5-12ms depending on the machine.
pub fn startupFromBunJS(context: FromBunRunContext) noreturn {
    std.debug.assert(!std.mem.startsWith(u16, context.base_path, &nt_object_prefix));
    comptime std.debug.assert(!is_standalone);
    launcher(context);
}

/// Main function for `bun_shim_impl.exe`
pub inline fn main() noreturn {
    comptime std.debug.assert(is_standalone);
    comptime std.debug.assert(builtin.single_threaded);
    comptime std.debug.assert(!builtin.link_libc);
    comptime std.debug.assert(!builtin.link_libcpp);
    launcher({});
}
