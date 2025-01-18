const std = @import("std");
const posix = std.posix;

const bun = @import("root").bun;
const environment = bun.Environment;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const libuv = bun.windows.libuv;

const allow_assert = environment.allow_assert;

const log = bun.sys.syslog;
fn handleToNumber(handle: FDImpl.System) FDImpl.SystemAsInt {
    if (environment.os == .windows) {
        // intCast fails if 'fd > 2^62'
        // possible with handleToNumber(GetCurrentProcess());
        return @intCast(@intFromPtr(handle));
    } else {
        return handle;
    }
}

fn numberToHandle(handle: FDImpl.SystemAsInt) FDImpl.System {
    if (environment.os == .windows) {
        if (!@inComptime()) {
            bun.assert(handle != FDImpl.invalid_value);
        }
        return @ptrFromInt(handle);
    } else {
        return handle;
    }
}

pub fn uv_get_osfhandle(in: c_int) libuv.uv_os_fd_t {
    const out = libuv.uv_get_osfhandle(in);
    return out;
}

pub fn uv_open_osfhandle(in: libuv.uv_os_fd_t) error{SystemFdQuotaExceeded}!c_int {
    const out = libuv.uv_open_osfhandle(in);
    bun.assert(out >= -1);
    if (out == -1) return error.SystemFdQuotaExceeded;
    return out;
}

/// Abstraction over file descriptors. This struct does nothing on non-windows operating systems.
///
/// bun.FileDescriptor is the bitcast of this struct, which is essentially a tagged pointer.
///
/// You can acquire one with FDImpl.decode(fd), and convert back to it with FDImpl.encode(fd).
///
/// On Windows builds we have two kinds of file descriptors:
/// - system: A "std.os.windows.HANDLE" that windows APIs can interact with.
///           In this case it is actually just an "*anyopaque" that points to some windows internals.
/// - uv:     A libuv file descriptor that looks like a linux file descriptor.
///           (technically a c runtime file descriptor, libuv might do extra stuff though)
///
/// When converting UVFDs into Windows FDs, they are still said to be owned by libuv,
/// and they say to NOT close the handle.
pub const FDImpl = packed struct {
    value: Value,
    kind: Kind,

    const invalid_value = std.math.maxInt(SystemAsInt);
    pub const invalid = FDImpl{
        .kind = .system,
        .value = .{ .as_system = invalid_value },
    };

    pub const System = posix.fd_t;

    pub const SystemAsInt = switch (environment.os) {
        .windows => u63,
        else => System,
    };

    pub const UV = switch (environment.os) {
        .windows => bun.windows.libuv.uv_file,
        else => System,
    };

    pub const Value = if (environment.os == .windows)
        packed union { as_system: SystemAsInt, as_uv: UV }
    else
        packed union { as_system: SystemAsInt };

    pub const Kind = if (environment.os == .windows)
        enum(u1) { system = 0, uv = 1 }
    else
        enum(u0) { system };

    comptime {
        bun.assert(@sizeOf(FDImpl) == @sizeOf(System));

        if (environment.os == .windows) {
            // we want the conversion from FD to fd_t to be a integer truncate
            bun.assert(@as(FDImpl, @bitCast(@as(u64, 512))).value.as_system == 512);
        }
    }

    pub fn fromSystemWithoutAssertion(system_fd: System) FDImpl {
        return FDImpl{
            .kind = .system,
            .value = .{ .as_system = handleToNumber(system_fd) },
        };
    }

    pub fn fromSystem(system_fd: System) FDImpl {
        if (environment.os == .windows) {
            // the current process fd is max usize
            // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess
            bun.assert(@intFromPtr(system_fd) <= std.math.maxInt(SystemAsInt));
        }

        return fromSystemWithoutAssertion(system_fd);
    }

    pub fn fromUV(uv_fd: UV) FDImpl {
        return switch (environment.os) {
            else => FDImpl{
                .kind = .system,
                .value = .{ .as_system = uv_fd },
            },
            .windows => FDImpl{
                .kind = .uv,
                .value = .{ .as_uv = uv_fd },
            },
        };
    }

    pub fn isValid(this: FDImpl) bool {
        return switch (environment.os) {
            // the 'zero' value on posix is debatable. it can be standard in.
            // TODO(@paperdave): steamroll away every use of bun.FileDescriptor.zero
            else => this.value.as_system != invalid_value,
            .windows => switch (this.kind) {
                // zero is not allowed in addition to the invalid value (zero would be a null ptr)
                .system => this.value.as_system != invalid_value and this.value.as_system != 0,
                // the libuv tag is always fine
                .uv => true,
            },
        };
    }

    /// When calling this function, you may not be able to close the returned fd.
    /// To close the fd, you have to call `.close()` on the FD.
    pub fn system(this: FDImpl) System {
        return switch (environment.os == .windows) {
            false => numberToHandle(this.value.as_system),
            true => switch (this.kind) {
                .system => numberToHandle(this.value.as_system),
                .uv => uv_get_osfhandle(this.value.as_uv),
            },
        };
    }

    /// Convert to bun.FileDescriptor
    pub fn encode(this: FDImpl) bun.FileDescriptor {
        // https://github.com/ziglang/zig/issues/18462
        return @enumFromInt(@as(bun.FileDescriptorInt, @bitCast(this)));
    }

    pub fn decode(fd: bun.FileDescriptor) FDImpl {
        return @bitCast(@intFromEnum(fd));
    }

    /// When calling this function, you should consider the FD struct to now be invalid.
    /// Calling `.close()` on the FD at that point may not work.
    pub fn uv(this: FDImpl) UV {
        return switch (environment.os) {
            else => numberToHandle(this.value.as_system),
            .windows => switch (this.kind) {
                .system => {
                    const w = std.os.windows;

                    const S = struct {
                        fn is_stdio_handle(id: w.DWORD, handle: w.HANDLE) bool {
                            const h = w.GetStdHandle(id) catch return false;
                            return handle == h;
                        }
                    };
                    const handle = this.encode().cast();
                    if (S.is_stdio_handle(w.STD_INPUT_HANDLE, handle)) return 0;
                    if (S.is_stdio_handle(w.STD_OUTPUT_HANDLE, handle)) return 1;
                    if (S.is_stdio_handle(w.STD_ERROR_HANDLE, handle)) return 2;

                    std.debug.panic(
                        \\Cast {} -> FDImpl.UV makes closing impossible!
                        \\
                        \\The supplier of this FileDescriptor should call 'bun.toLibUVOwnedFD'
                        \\or 'FDImpl.makeLibUVOwned', probably where open() was called.
                    ,
                        .{this},
                    );
                },
                .uv => this.value.as_uv,
            },
        };
    }

    /// This function will prevent stdout and stderr from being closed.
    pub fn close(this: FDImpl) ?bun.sys.Error {
        if (environment.os != .windows or this.kind == .uv) {
            // This branch executes always on linux (uv() is no-op),
            // or on Windows when given a UV file descriptor.
            const fd = this.uv();
            if (fd == 1 or fd == 2) {
                log("close({}) SKIPPED", .{fd});
                return null;
            }
        }
        return this.closeAllowingStdoutAndStderr();
    }

    /// Assumes given a valid file descriptor
    /// If error, the handle has not been closed
    pub fn makeLibUVOwned(this: FDImpl) !FDImpl {
        this.assertValid();
        return switch (environment.os) {
            else => this,
            .windows => switch (this.kind) {
                .system => fd: {
                    break :fd FDImpl.fromUV(try uv_open_osfhandle(numberToHandle(this.value.as_system)));
                },
                .uv => this,
            },
        };
    }

    pub fn closeAllowingStdoutAndStderr(this: FDImpl) ?bun.sys.Error {
        if (allow_assert) {
            bun.assert(this.value.as_system != invalid_value); // probably a UAF
        }

        // Format the file descriptor for logging BEFORE closing it.
        // Otherwise the file descriptor is always invalid after closing it.
        var buf: if (environment.isDebug) [1050]u8 else void = undefined;
        const this_fmt = if (environment.isDebug) std.fmt.bufPrint(&buf, "{}", .{this}) catch unreachable;

        const result: ?bun.sys.Error = switch (environment.os) {
            .linux => result: {
                const fd = this.encode();
                bun.assert(fd != bun.invalid_fd);
                bun.assert(fd.cast() >= 0);
                break :result switch (bun.C.getErrno(bun.sys.syscall.close(fd.cast()))) {
                    .BADF => bun.sys.Error{ .errno = @intFromEnum(posix.E.BADF), .syscall = .close, .fd = fd },
                    else => null,
                };
            },
            .mac => result: {
                const fd = this.encode();
                bun.assert(fd != bun.invalid_fd);
                bun.assert(fd.cast() >= 0);
                break :result switch (bun.C.getErrno(bun.sys.syscall.@"close$NOCANCEL"(fd.cast()))) {
                    .BADF => bun.sys.Error{ .errno = @intFromEnum(posix.E.BADF), .syscall = .close, .fd = fd },
                    else => null,
                };
            },
            .windows => result: {
                switch (this.kind) {
                    .uv => {
                        var req: libuv.fs_t = libuv.fs_t.uninitialized;
                        defer req.deinit();
                        const rc = libuv.uv_fs_close(libuv.Loop.get(), &req, this.value.as_uv, null);
                        break :result if (rc.errno()) |errno|
                            .{ .errno = errno, .syscall = .close, .fd = this.encode(), .from_libuv = true }
                        else
                            null;
                    },
                    .system => {
                        bun.assert(this.value.as_system != 0);
                        const handle: System = @ptrFromInt(@as(u64, this.value.as_system));
                        break :result switch (bun.windows.NtClose(handle)) {
                            .SUCCESS => null,
                            else => |rc| bun.sys.Error{
                                .errno = if (bun.windows.Win32Error.fromNTStatus(rc).toSystemErrno()) |errno| @intFromEnum(errno) else 1,
                                .syscall = .CloseHandle,
                                .fd = this.encode(),
                            },
                        };
                    },
                }
            },
            else => @compileError("FD.close() not implemented for this platform"),
        };

        if (environment.isDebug) {
            if (result) |err| {
                if (err.errno == @intFromEnum(posix.E.BADF)) {
                    bun.Output.debugWarn("close({s}) = EBADF. This is an indication of a file descriptor UAF", .{this_fmt});
                } else {
                    log("close({s}) = {}", .{ this_fmt, err });
                }
            } else {
                log("close({s})", .{this_fmt});
            }
        }

        return result;
    }

    /// This "fails" if not given an int32, returning null in that case
    pub fn fromJS(value: JSValue) ?FDImpl {
        if (!value.isAnyInt()) return null;
        const fd64 = value.toInt64();
        if (fd64 < 0 or fd64 > std.math.maxInt(i32)) {
            return null;
        }
        const fd: i32 = @intCast(fd64);
        if (comptime environment.isWindows) {
            return switch (bun.FDTag.get(fd)) {
                .stdin => FDImpl.decode(bun.STDIN_FD),
                .stdout => FDImpl.decode(bun.STDOUT_FD),
                .stderr => FDImpl.decode(bun.STDERR_FD),
                else => FDImpl.fromUV(fd),
            };
        }
        return FDImpl.fromUV(fd);
    }

    // If a non-number is given, returns null.
    // If the given number is not an fd (negative), an error is thrown and error.JSException is returned.
    pub fn fromJSValidated(value: JSValue, global: *JSC.JSGlobalObject) bun.JSError!?FDImpl {
        if (!value.isNumber()) {
            return null;
        }

        const float = value.asNumber();
        if (@mod(float, 1) != 0) {
            return global.throwRangeError(float, .{ .field_name = "fd", .msg = "an integer" });
        }

        const int: i64 = @intFromFloat(float);
        if (int < 0 or int > std.math.maxInt(i32)) {
            return global.throwRangeError(int, .{ .field_name = "fd", .min = 0, .max = std.math.maxInt(i32) });
        }

        const fd: c_int = @intCast(int);

        if (comptime environment.isWindows) {
            return switch (bun.FDTag.get(fd)) {
                .stdin => FDImpl.decode(bun.STDIN_FD),
                .stdout => FDImpl.decode(bun.STDOUT_FD),
                .stderr => FDImpl.decode(bun.STDERR_FD),
                else => FDImpl.fromUV(fd),
            };
        }
        return FDImpl.fromUV(fd);
    }

    /// After calling, the input file descriptor is no longer valid and must not be used.
    /// If an error is thrown, the file descriptor is cleaned up for you.
    pub fn toJS(value: FDImpl, global: *JSC.JSGlobalObject) JSValue {
        const fd = value.makeLibUVOwned() catch {
            _ = value.close();
            return global.throwValue((JSC.SystemError{
                .message = bun.String.static("EMFILE, too many open files"),
                .code = bun.String.static("EMFILE"),
            }).toErrorInstance(global)) catch .zero;
        };
        return JSValue.jsNumberFromInt32(fd.uv());
    }

    pub fn format(this: FDImpl, comptime fmt: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (!this.isValid()) {
            try writer.writeAll("[invalid_fd]");
            return;
        }

        if (fmt.len != 0) {
            // The reason for this error is because formatting FD as an integer on windows is
            // ambiguous and almost certainly a mistake. You probably meant to format fd.cast().
            //
            // Remember this formatter will
            // - on posix, print the number
            // - on windows, print if it is a handle or a libuv file descriptor
            // - in debug on all platforms, print the path of the file descriptor
            //
            // Not having this error caused a linux+debug only crash in bun.sys.getFdPath because
            // we forgot to change the thing being printed to "fd.cast()" when FDImpl was introduced.
            @compileError("invalid format string for FDImpl.format. must be empty like '{}'");
        }

        switch (environment.os) {
            else => {
                const fd = this.system();
                try writer.print("{d}", .{fd});
                if (environment.isDebug and fd >= 3) print_with_path: {
                    var path_buf: bun.PathBuffer = undefined;
                    const path = std.os.getFdPath(fd, &path_buf) catch break :print_with_path;
                    try writer.print("[{s}]", .{path});
                }
            },
            .windows => {
                switch (this.kind) {
                    .system => {
                        if (environment.isDebug) {
                            const peb = std.os.windows.peb();
                            const handle = this.system();
                            if (handle == peb.ProcessParameters.hStdInput) {
                                return try writer.print("{d}[stdin handle]", .{this.value.as_system});
                            } else if (handle == peb.ProcessParameters.hStdOutput) {
                                return try writer.print("{d}[stdout handle]", .{this.value.as_system});
                            } else if (handle == peb.ProcessParameters.hStdError) {
                                return try writer.print("{d}[stderr handle]", .{this.value.as_system});
                            } else if (handle == peb.ProcessParameters.CurrentDirectory.Handle) {
                                return try writer.print("{d}[cwd handle]", .{this.value.as_system});
                            } else print_with_path: {
                                var fd_path: bun.WPathBuffer = undefined;
                                const path = std.os.windows.GetFinalPathNameByHandle(handle, .{ .volume_name = .Nt }, &fd_path) catch break :print_with_path;
                                return try writer.print("{d}[{}]", .{
                                    this.value.as_system,
                                    bun.fmt.utf16(path),
                                });
                            }
                        }

                        try writer.print("{d}[handle]", .{this.value.as_system});
                    },
                    .uv => try writer.print("{d}[libuv]", .{this.value.as_uv}),
                }
            },
        }
    }

    pub fn assertValid(this: FDImpl) void {
        bun.assert(this.isValid());
    }
};
