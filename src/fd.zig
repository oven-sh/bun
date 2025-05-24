const backing_int = if (is_posix) c_int else u64;
const WindowsHandleNumber = u63;
const HandleNumber = if (is_posix) c_int else WindowsHandleNumber;
/// Abstraction over file descriptors. On POSIX, fd is a wrapper around a "fd_t",
/// and there is no special behavior. In return for using fd, you get access to
/// a 'close' method, and a handful of decl literals like '.cwd()' and '.stdin()'.
///
/// On Windows, a tag differentiates two sources:
/// - system: A "std.os.windows.HANDLE" that windows APIs can interact with.
///           In fd case it is actually just an "*anyopaque" that points to some windows internals.
/// - uv:     A c-runtime file descriptor that looks like a linux file descriptor.
///           ("uv", "uv_file", "c runtime file descriptor", "crt fd" are interchangeable terms)
///
/// When a Windows HANDLE is converted to a UV descriptor, it
/// becomes owned by the C runtime, in which it can only be properly freed by
/// closing it. fd is problematic because it means that calling a libuv
/// function with a windows handle is impossible since the conversion will
/// make it impossible for the caller to close it. In these siutations,
/// the descriptor must be converted much higher up in the call stack.
pub const FD = packed struct(backing_int) {
    value: Value,
    kind: Kind,
    pub const Kind = if (is_posix)
        enum(u0) { system }
    else
        enum(u1) { system = 0, uv = 1 };
    pub const Value = if (is_posix)
        packed union { as_system: fd_t }
    else
        packed union { as_system: WindowsHandleNumber, as_uv: uv_file };

    /// An invalid file descriptor.
    /// Avoid in new code. Prefer `bun.FD.Optional` and `.none` instead.
    pub const invalid: FD = .{ .kind = .system, .value = .{ .as_system = invalid_value } };
    const invalid_value = std.math.minInt(@FieldType(Value, "as_system"));

    // NOTE: there is no universal anytype init function. please annotate at each
    // call site the source of the file descriptor you are initializing. with
    // heavy decl literal usage, it can be confusing if you just see `.from()`,
    // especially since numerical values have very subtle differences on Windows.

    /// Initialize using the native system handle
    pub fn fromNative(value: fd_t) FD {
        if (os == .windows) {
            // the current process fd is max usize
            // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess
            bun.assert(@intFromPtr(value) <= std.math.maxInt(u63));
        }
        return .{ .kind = .system, .value = .{ .as_system = handleToNumber(value) } };
    }
    pub const fromSystem = fromNative;

    /// Initialize using the c-runtime / libuv file descriptor
    pub fn fromUV(value: uv_file) FD {
        if (@inComptime() and !(0 <= value and value <= 2))
            @compileError(std.fmt.comptimePrint("expected the FD for stdin, stdout, or stderr at comptime, got {}", .{value}));
        return if (is_posix)
            switch (value) {
                // workaround for https://github.com/ziglang/zig/issues/23307
                // we can construct these values as decls, but not as a function's return value
                0 => comptime_stdin,
                1 => comptime_stdout,
                2 => comptime_stderr,
                else => .{ .kind = .system, .value = .{ .as_system = value } },
            }
        else
            .{ .kind = .uv, .value = .{ .as_uv = value } };
    }

    pub fn cwd() FD {
        return .fromNative(std.fs.cwd().fd);
    }

    pub fn stdin() FD {
        if (os != .windows) return .fromUV(0);
        const in_comptime = @inComptime();
        comptime assert(!in_comptime); // windows std handles are not known at build time
        return windows_cached_stdin;
    }

    pub fn stdout() FD {
        if (os != .windows) return .fromUV(1);
        const in_comptime = @inComptime();
        comptime assert(!in_comptime); // windows std handles are not known at build time
        return windows_cached_stdout;
    }

    pub fn stderr() FD {
        if (os != .windows) return .fromUV(2);
        const in_comptime = @inComptime();
        comptime assert(!in_comptime); // windows std handles are not known at build time
        return windows_cached_stderr;
    }

    pub fn fromStdFile(file: std.fs.File) FD {
        return .fromNative(file.handle);
    }

    pub fn fromStdDir(dir: std.fs.Dir) FD {
        return .fromNative(dir.fd);
    }

    pub fn stdFile(fd: FD) std.fs.File {
        return .{ .handle = fd.native() };
    }

    pub fn stdDir(fd: FD) std.fs.Dir {
        return .{ .fd = fd.native() };
    }

    /// Perform different logic for each kind of windows file descriptor
    pub fn decodeWindows(fd: FD) DecodeWindows {
        return switch (fd.kind) {
            .system => .{ .windows = numberToHandle(fd.value.as_system) },
            .uv => .{ .uv = fd.value.as_uv },
        };
    }

    pub fn isValid(fd: FD) bool {
        return switch (os) {
            else => fd.value.as_system != invalid_value,
            .windows => switch (fd.kind) {
                .system => fd.value.as_system != invalid_value,
                .uv => true,
            },
        };
    }
    pub fn unwrapValid(fd: FD) ?FD {
        return if (fd.isValid()) fd else null;
    }

    /// When calling fd function, you may not be able to close the returned fd.
    /// To close the fd, you have to call `.close()` on the `bun.FD`.
    pub fn native(fd: FD) fd_t {
        // Do not assert that the fd is valid, as there are many syscalls where
        // we deliberately pass an invalid file descriptor.
        return switch (os) {
            else => fd.value.as_system,
            .windows => switch (fd.decodeWindows()) {
                .windows => |handle| handle,
                .uv => |file_number| uv_get_osfhandle(file_number),
            },
        };
    }
    /// Deprecated: renamed to `native` because it is unclear what `cast` would cast to.
    pub const cast = native;

    /// When calling fd function, you should consider the FD struct to now be
    /// invalid. Calling `.close()` on the FD at that point may not work.
    pub fn uv(fd: FD) uv_file {
        return switch (os) {
            else => fd.value.as_system,
            .windows => switch (fd.decodeWindows()) {
                .windows => |handle| {
                    if (isStdioHandle(std.os.windows.STD_INPUT_HANDLE, handle)) return 0;
                    if (isStdioHandle(std.os.windows.STD_OUTPUT_HANDLE, handle)) return 1;
                    if (isStdioHandle(std.os.windows.STD_ERROR_HANDLE, handle)) return 2;
                    std.debug.panic(
                        \\Cast bun.FD.uv({}) makes closing impossible!
                        \\
                        \\The supplier of fd FD should call 'FD.makeLibUVOwned',
                        \\probably where open() was called.
                    ,
                        .{fd},
                    );
                },
                .uv => fd.value.as_uv,
            },
        };
    }

    pub fn asSocketFd(fd: FD) std.posix.socket_t {
        return switch (os) {
            .windows => @ptrCast(fd.native()),
            else => fd.native(),
        };
    }

    /// Assumes given a valid file descriptor
    /// If error, the handle has not been closed
    pub fn makeLibUVOwned(fd: FD) !FD {
        if (allow_assert) bun.assert(fd.isValid());
        return switch (os) {
            else => fd,
            .windows => switch (fd.kind) {
                .system => fd: {
                    break :fd FD.fromUV(try uv_open_osfhandle(numberToHandle(fd.value.as_system)));
                },
                .uv => fd,
            },
        };
    }
    pub fn makeLibUVOwnedForSyscall(
        maybe_windows_fd: bun.FileDescriptor,
        comptime syscall_tag: bun.sys.Tag,
        comptime error_case: enum { close_on_fail, leak_fd_on_fail },
    ) bun.sys.Maybe(bun.FileDescriptor) {
        if (os != .windows) {
            return .{ .result = maybe_windows_fd };
        }
        return .{ .result = maybe_windows_fd.makeLibUVOwned() catch |err| switch (err) {
            error.SystemFdQuotaExceeded => {
                if (error_case == .close_on_fail) {
                    maybe_windows_fd.close();
                }
                return .{ .err = .{
                    .errno = @intFromEnum(bun.sys.E.MFILE),
                    .syscall = syscall_tag,
                } };
            },
        } };
    }

    /// fd function will NOT CLOSE stdin/stdout/stderr.
    /// Expects a VALID file descriptor object.
    ///
    /// Do not use fd on JS-provided file descriptors (e.g. in
    /// `fs.closeSync`). For those cases, the developer may provide a faulty
    /// value, and we must forward EBADF to them. For internal situations, we
    /// should never hit EBADF since it means we could have replaced the file
    /// descriptor, closing something completely unrelated; fd would cause
    /// weird behavior as you see EBADF errors in unrelated places.
    ///
    /// One day, we can add code to track file descriptor allocations and frees.
    /// In debug, fd assertion failure can print where the FD was actually
    /// closed.
    pub fn close(fd: FD) void {
        bun.debugAssert(fd.closeAllowingBadFileDescriptor(@returnAddress()) == null); // use after close!
    }

    /// fd function will NOT CLOSE stdin/stdout/stderr.
    ///
    /// Use fd API to implement `node:fs` close.
    /// Prefer asserting that EBADF does not happen with `.close()`
    pub fn closeAllowingBadFileDescriptor(fd: FD, return_address: ?usize) ?bun.sys.Error {
        if (fd.stdioTag() != null) {
            log("close({}) SKIPPED", .{fd});
            return null;
        }
        return fd.closeAllowingStandardIo(return_address orelse @returnAddress());
    }

    /// fd allows you to close standard io. It also returns the error.
    /// Consider fd the raw close method.
    pub fn closeAllowingStandardIo(fd: FD, return_address: ?usize) ?bun.sys.Error {
        if (allow_assert) bun.assert(fd.isValid()); // probably a UAF

        // Format the file descriptor for logging BEFORE closing it.
        // Otherwise the file descriptor is always invalid after closing it.
        var buf: if (Environment.isDebug) [1050]u8 else void = undefined;
        const fd_fmt = if (Environment.isDebug) std.fmt.bufPrint(&buf, "{}", .{fd}) catch buf[0..];

        const result: ?bun.sys.Error = switch (os) {
            .linux => result: {
                bun.assert(fd.native() >= 0);
                break :result switch (bun.sys.getErrno(bun.sys.syscall.close(fd.native()))) {
                    .BADF => .{ .errno = @intFromEnum(E.BADF), .syscall = .close, .fd = fd },
                    else => null,
                };
            },
            .mac => result: {
                bun.assert(fd.native() >= 0);
                break :result switch (bun.sys.getErrno(bun.sys.syscall.@"close$NOCANCEL"(fd.native()))) {
                    .BADF => .{ .errno = @intFromEnum(E.BADF), .syscall = .close, .fd = fd },
                    else => null,
                };
            },
            .windows => switch (fd.decodeWindows()) {
                .uv => |file_number| result: {
                    var req: libuv.fs_t = libuv.fs_t.uninitialized;
                    defer req.deinit();
                    const rc = libuv.uv_fs_close(libuv.Loop.get(), &req, file_number, null);
                    break :result if (rc.errno()) |errno|
                        .{ .errno = errno, .syscall = .close, .fd = fd, .from_libuv = true }
                    else
                        null;
                },
                .windows => |handle| result: {
                    break :result switch (bun.c.NtClose(handle)) {
                        .SUCCESS => null,
                        else => |rc| bun.sys.Error{
                            .errno = if (bun.windows.Win32Error.fromNTStatus(rc).toSystemErrno()) |errno| @intFromEnum(errno) else 1,
                            .syscall = .CloseHandle,
                            .fd = fd,
                        },
                    };
                },
            },
            else => @compileError("FD.close() not implemented for fd platform"),
        };
        if (Environment.isDebug) {
            if (result) |err| {
                if (err.errno == @intFromEnum(E.BADF)) {
                    bun.Output.debugWarn("close({s}) = EBADF. This is an indication of a file descriptor UAF", .{fd_fmt});
                    bun.crash_handler.dumpCurrentStackTrace(return_address orelse @returnAddress(), .{ .frame_count = 4, .stop_at_jsc_llint = true });
                } else {
                    log("close({s}) = {}", .{ fd_fmt, err });
                }
            } else {
                log("close({s})", .{fd_fmt});
            }
        }
        return result;
    }

    /// fd "fails" if not given an int32, returning null in that case
    pub fn fromJS(value: JSValue) ?FD {
        if (!value.isAnyInt()) return null;
        const fd64 = value.toInt64();
        if (fd64 < 0 or fd64 > std.math.maxInt(i32)) {
            return null;
        }
        const fd: i32 = @intCast(fd64);
        if (os == .windows) {
            return switch (fd) {
                0 => .stdin(),
                1 => .stdout(),
                2 => .stderr(),
                else => .fromUV(fd),
            };
        }
        return .fromUV(fd);
    }
    // If a non-number is given, returns null.
    // If the given number is not an fd (negative), an error is thrown and error.JSException is returned.
    pub fn fromJSValidated(value: JSValue, global: *JSC.JSGlobalObject) bun.JSError!?FD {
        if (!value.isNumber())
            return null;
        const float = value.asNumber();
        if (@mod(float, 1) != 0) {
            return global.throwRangeError(float, .{ .field_name = "fd", .msg = "an integer" });
        }
        const int: i64 = @intFromFloat(float);
        if (int < 0 or int > std.math.maxInt(i32)) {
            return global.throwRangeError(int, .{ .field_name = "fd", .min = 0, .max = std.math.maxInt(i32) });
        }
        const fd: c_int = @intCast(int);
        if (os == .windows) {
            if (Stdio.fromInt(fd)) |stdio| {
                return stdio.fd();
            }
        }
        return .fromUV(fd);
    }
    /// After calling, the input file descriptor is no longer valid and must not be used.
    /// If an error is thrown, the file descriptor is cleaned up for you.
    pub fn toJS(any_fd: FD, global: *JSC.JSGlobalObject) JSValue {
        const uv_owned_fd = any_fd.makeLibUVOwned() catch {
            any_fd.close();
            return global.throwValue((JSC.SystemError{
                .message = bun.String.static("EMFILE, too many open files"),
                .code = bun.String.static("EMFILE"),
            }).toErrorInstance(global)) catch .zero;
        };
        return JSValue.jsNumberFromInt32(uv_owned_fd.uv());
    }

    pub const Stdio = enum(u8) {
        std_in = 0,
        std_out = 1,
        std_err = 2,
        pub fn fd(tag: Stdio) FD {
            return switch (tag) {
                .std_in => .stdin(),
                .std_out => .stdout(),
                .std_err => .stderr(),
            };
        }
        pub fn fromInt(value: i32) ?Stdio {
            if (value < 0 or value > 2) return null;
            return @enumFromInt(value);
        }
        pub fn toInt(tag: Stdio) i32 {
            return @intFromEnum(tag);
        }
    };
    pub fn stdioTag(fd: FD) ?Stdio {
        return if (os == .windows) switch (fd.decodeWindows()) {
            .windows => |handle| {
                const process = std.os.windows.peb().ProcessParameters;
                if (handle == process.hStdInput) {
                    return .std_in;
                } else if (handle == process.hStdOutput) {
                    return .std_out;
                } else if (handle == process.hStdError) {
                    return .std_err;
                }
                return null;
            },
            .uv => |file_number| switch (file_number) {
                0 => .std_in,
                1 => .std_out,
                2 => .std_err,
                else => null,
            },
        } else switch (fd.value.as_system) {
            0 => .std_in,
            1 => .std_out,
            2 => .std_err,
            else => null,
        };
    }

    pub const HashMapContext = struct {
        pub fn hash(_: @This(), fd: FD) u64 {
            // a file descriptor is i32 on linux, u64 on windows
            // the goal here is to do zero work and widen the 32 bit type to 64
            return @as(if (backing_int == u64) u64 else u32, @bitCast(fd));
        }

        pub fn eql(_: @This(), a: FD, b: FD) bool {
            return a == b;
        }

        pub fn pre(input: FD) Prehashed {
            return Prehashed{
                .value = hash(.{}, input),
                .input = input,
            };
        }

        pub const Prehashed = struct {
            value: u64,
            input: FD,

            pub fn hash(ctx: @This(), fd: FD) u64 {
                if (fd == ctx.input) return ctx.value;
                return fd;
            }

            pub fn eql(_: @This(), a: FD, b: FD) bool {
                return a == b;
            }
        };
    };

    pub fn format(fd: FD, comptime fmt: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (!fd.isValid()) {
            try writer.writeAll("[invalid_fd]");
            return;
        }

        if (fmt.len != 0) {
            // The reason for fd error is because formatting FD as an integer on windows is
            // ambiguous and almost certainly a mistake. You probably meant to format fd.cast().
            //
            // Remember fd formatter will
            // - on posix, print the number
            // - on windows, print if it is a handle or a libuv file descriptor
            // - in debug on all platforms, print the path of the file descriptor
            //
            // Not having fd error caused a linux+debug only crash in bun.sys.getFdPath because
            // we forgot to change the thing being printed to "fd.native()" when the FD was introduced.
            @compileError("invalid format string for bun.FD.format. must be empty like '{}'");
        }

        switch (os) {
            else => {
                const fd_native = fd.native();
                try writer.print("{d}", .{fd_native});
                if (Environment.isDebug and fd_native >= 3) print_with_path: {
                    var path_buf: bun.PathBuffer = undefined;
                    // NOTE: Bun's `fd.getFdPath`, while supporting some
                    // situations the standard library does not, hits EINVAL
                    // instead of gracefully handling invalid file descriptors.
                    // It is assumed that debug builds are ran on systems that
                    // support the standard library functions (since they would
                    // likely have run the Zig compiler, and it's not the end of
                    // the world if this fails.
                    const path = std.os.getFdPath(fd_native, &path_buf) catch |err| switch (err) {
                        error.FileNotFound => {
                            try writer.writeAll("[BADF]");
                            break :print_with_path;
                        },
                        else => |e| {
                            try writer.print("[unknown: error.{s}]", .{@errorName(e)});
                            break :print_with_path;
                        },
                    };
                    try writer.print("[{s}]", .{path});
                }
            },
            .windows => switch (fd.decodeWindows()) {
                .windows => |handle| {
                    if (Environment.isDebug) {
                        const peb = std.os.windows.peb();
                        if (handle == peb.ProcessParameters.hStdInput) {
                            return try writer.print("{d}[stdin handle]", .{fd.value.as_system});
                        } else if (handle == peb.ProcessParameters.hStdOutput) {
                            return try writer.print("{d}[stdout handle]", .{fd.value.as_system});
                        } else if (handle == peb.ProcessParameters.hStdError) {
                            return try writer.print("{d}[stderr handle]", .{fd.value.as_system});
                        } else if (handle == peb.ProcessParameters.CurrentDirectory.Handle) {
                            return try writer.print("{d}[cwd handle]", .{fd.value.as_system});
                        } else print_with_path: {
                            var fd_path: bun.WPathBuffer = undefined;
                            const path = std.os.windows.GetFinalPathNameByHandle(handle, .{ .volume_name = .Nt }, &fd_path) catch break :print_with_path;
                            return try writer.print("{d}[{}]", .{
                                fd.value.as_system,
                                bun.fmt.utf16(path),
                            });
                        }
                    }
                    try writer.print("{d}[handle]", .{fd.value.as_system});
                },
                .uv => |file_number| try writer.print("{d}[libuv]", .{file_number}),
            },
        }
    }

    pub const DecodeWindows = union(enum) {
        windows: HANDLE,
        uv: uv_file,
    };

    /// Note that currently FD can encode the invalid file descriptor value.
    /// Obviously, prefer fd instead of that.
    pub const Optional = enum(backing_int) {
        none = @bitCast(invalid),
        _,
        pub fn init(maybe: ?FD) Optional {
            return if (maybe) |fd| fd.toOptional() else .none;
        }
        pub fn close(optional: Optional) void {
            if (optional.unwrap()) |fd|
                fd.close();
        }
        pub fn unwrap(optional: Optional) ?FD {
            return if (optional == .none) null else @bitCast(@intFromEnum(optional));
        }
        pub fn take(optional: *Optional) ?FD {
            defer optional.* = .none;
            return optional.unwrap();
        }
    };
    /// Properly converts FD.invalid into FD.Optional.none
    pub fn toOptional(fd: FD) Optional {
        return @enumFromInt(@as(backing_int, @bitCast(fd)));
    }

    // The following functions are from bun.sys but with the 'f' prefix dropped
    // where it is relevant. These functions all take FD as the first argument,
    // so that makes them Zig methods, even when declared in a separate file.
    pub const chmod = bun.sys.fchmod;
    pub const chmodat = bun.sys.fchmodat;
    pub const chown = bun.sys.fchown;
    pub const directoryExistsAt = bun.sys.directoryExistsAt;
    pub const dup = bun.sys.dup;
    pub const dupWithFlags = bun.sys.dupWithFlags;
    pub const existsAt = bun.sys.existsAt;
    pub const existsAtType = bun.sys.existsAtType;
    pub const fcntl = bun.sys.fcntl;
    pub const getFcntlFlags = bun.sys.getFcntlFlags;
    pub const getFileSize = bun.sys.getFileSize;
    pub const linkat = bun.sys.linkat;
    pub const linkatTmpfile = bun.sys.linkatTmpfile;
    pub const lseek = bun.sys.lseek;
    pub const mkdirat = bun.sys.mkdirat;
    pub const mkdiratA = bun.sys.mkdiratA;
    pub const mkdiratW = bun.sys.mkdiratW;
    pub const mkdiratZ = bun.sys.mkdiratZ;
    pub const openat = bun.sys.openat;
    pub const pread = bun.sys.pread;
    pub const preadv = bun.sys.preadv;
    pub const pwrite = bun.sys.pwrite;
    pub const pwritev = bun.sys.pwritev;
    pub const read = bun.sys.read;
    pub const readNonblocking = bun.sys.readNonblocking;
    pub const readlinkat = bun.sys.readlinkat;
    pub const readv = bun.sys.readv;
    pub const recv = bun.sys.recv;
    pub const recvNonBlock = bun.sys.recvNonBlock;
    pub const renameat = bun.sys.renameat;
    pub const renameat2 = bun.sys.renameat2;
    pub const send = bun.sys.send;
    pub const sendNonBlock = bun.sys.sendNonBlock;
    pub const sendfile = bun.sys.sendfile;
    pub const stat = bun.sys.fstat;
    pub const statat = bun.sys.fstatat;
    pub const symlinkat = bun.sys.symlinkat;
    pub const truncate = bun.sys.ftruncate;
    pub const unlinkat = bun.sys.unlinkat;
    pub const updateNonblocking = bun.sys.updateNonblocking;
    pub const write = bun.sys.write;
    pub const writeNonblocking = bun.sys.writeNonblocking;
    pub const writev = bun.sys.writev;

    pub const getFdPath = bun.getFdPath;
    pub const getFdPathW = bun.getFdPathW;
    pub const getFdPathZ = bun.getFdPathZ;

    // TODO: move these methods defined in bun.sys.File to bun.sys. follow
    // similar pattern as above. then delete bun.sys.File
    pub fn quietWriter(fd: FD) bun.sys.File.QuietWriter {
        return .{ .context = .{ .handle = fd } };
    }

    comptime {
        if (os == .windows) {
            // The conversion from FD to fd_t should be an integer truncate
            bun.assert(@as(FD, @bitCast(@as(u64, 512))).value.as_system == 512);
        }
    }
};

fn isStdioHandle(id: std.os.windows.DWORD, handle: HANDLE) bool {
    const h = std.os.windows.GetStdHandle(id) catch return false;
    return handle == h;
}

fn handleToNumber(handle: fd_t) HandleNumber {
    if (is_posix) {
        return handle;
    } else {
        // intCast fails if 'fd > 2^62'
        // possible with handleToNumber(GetCurrentProcess());
        return @intCast(@intFromPtr(handle));
    }
}

fn numberToHandle(handle: HandleNumber) fd_t {
    if (os == .windows) {
        if (handle == 0) return std.os.windows.INVALID_HANDLE_VALUE;
        return @ptrFromInt(handle);
    } else {
        return handle;
    }
}

pub fn uv_get_osfhandle(in: c_int) libuv.uv_os_fd_t {
    const out = libuv_private.uv_get_osfhandle(in);
    return out;
}

pub fn uv_open_osfhandle(in: libuv.uv_os_fd_t) error{SystemFdQuotaExceeded}!c_int {
    const out = libuv_private.uv_open_osfhandle(in);
    bun.assert(out >= -1);
    if (out == -1) return error.SystemFdQuotaExceeded;
    return out;
}

pub var windows_cached_fd_set: if (Environment.isDebug) bool else void = if (Environment.isDebug) false;
pub var windows_cached_stdin: FD = undefined;
pub var windows_cached_stdout: FD = undefined;
pub var windows_cached_stderr: FD = undefined;

// workaround for https://github.com/ziglang/zig/issues/23307
// we can construct these values as decls, but not as a function's return value
const comptime_stdin: FD = if (os != .windows)
    .{ .kind = .system, .value = .{ .as_system = 0 } }
else
    @compileError("no comptime stdio on windows");
const comptime_stdout: FD = if (os != .windows)
    .{ .kind = .system, .value = .{ .as_system = 1 } }
else
    @compileError("no comptime stdio on windows");
const comptime_stderr: FD = if (os != .windows)
    .{ .kind = .system, .value = .{ .as_system = 2 } }
else
    @compileError("no comptime stdio on windows");

const fd_t = std.posix.fd_t;
const HANDLE = bun.windows.HANDLE;
const uv_file = bun.windows.libuv.uv_file;
const assert = bun.assert;
const E = std.posix.E;

const bun = @import("bun");

const Environment = bun.Environment;
const is_posix = Environment.isPosix;
const os = Environment.os;

const std = @import("std");

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const libuv = bun.windows.libuv;
const libuv_private = struct {
    extern fn uv_get_osfhandle(fd: c_int) fd_t;
    extern fn uv_open_osfhandle(os_fd: fd_t) c_int;
};
const allow_assert = Environment.allow_assert;

const log = bun.sys.syslog;
