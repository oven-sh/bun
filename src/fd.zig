const std = @import("std");
const os = std.os;
const linux = os.linux;

const bun = @import("root").bun;
const env = bun.Environment;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const libuv = bun.windows.libuv;

const allow_assert = env.allow_assert;

const log = bun.Output.scoped(.FD, false);

inline fn handleToNumber(handle: FD.System) FD.FDInt {
    if (env.os == .windows) {
        // intCast fails if 'fd > 2^62'
        // possible with handleToNumber(GetCurrentProcess());
        return @intCast(@intFromPtr(handle));
    } else {
        return handle;
    }
}

inline fn numberToHandle(handle: FD.FDInt) FD.System {
    if (env.os == .windows) {
        return @ptrFromInt(handle);
    } else {
        return handle;
    }
}

pub inline fn uv_get_osfhandle(in: c_int) libuv.uv_os_fd_t {
    const out = libuv.uv_get_osfhandle(in);
    log("uv_get_osfhandle({d}) = {d}", .{ in, @intFromPtr(out) });
    return out;
}

pub inline fn uv_open_osfhandle(in: libuv.uv_os_fd_t) c_int {
    const out = libuv.uv_open_osfhandle(in);
    log("uv_get_osfhandle({d}) = {d}", .{ @intFromPtr(in), out });
    return out;
}

/// Abstraction over file descriptors. This struct does nothing on '!isWindows'
///
/// On Windows builds we have two kinds of file descriptors:
/// - system: A "std.os.windows.HANDLE" that windows APIs can interact with.
///           In this case it is actually just an "*anyopaque" that points to some windows internals.
/// - uv:     A libuv file descriptor that looks like a linux file descriptor.
///           (technically a c runtime file descriptor, libuv might do extra stuff though)
///
/// When converting UVFDs into Windows FDs, they are still said to be owned by libuv, and they
/// say to NOT close the handle. This is tracked by a flag `owned_by_libuv`.
pub const FD = packed struct {
    value: Value,
    owned_by_libuv: if (env.os == .windows) bool else void,
    kind: Kind,

    const invalid_value = std.math.minInt(FDInt);
    pub const invalid = FD{
        .owned_by_libuv = if (env.os == .windows) false else {},
        .kind = .system,
        .value = .{ .as_system = invalid_value },
    };

    pub const System = std.os.fd_t;
    pub const FDInt = switch (env.os) {
        .windows => u62,
        else => std.meta.Int(.unsigned, @bitSizeOf(System)),
    };
    pub const UV = switch (env.os) {
        .windows => bun.windows.libuv.uv_file,
        else => System,
    };

    const Value = if (env.os == .windows)
        packed union { as_system: FDInt, as_uv: UV }
    else
        packed union { as_system: FDInt };

    comptime {
        std.debug.assert(@sizeOf(FD) == @sizeOf(System));

        if (env.os == .windows) {
            // we want the conversion from FD to fd_t to be a integer truncate
            std.debug.assert(@as(FD, @bitCast(@as(u64, 512))).value.as_system == 512);
        }
    }

    const Kind = if (env.os == .windows)
        enum(u1) { system = 0, uv = 1 }
    else
        enum(u0) { system };

    pub fn fromSystem(system_fd: System) FD {
        if (env.os == .windows) {
            // the current process fd is max usize
            // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess
            std.debug.assert(@intFromPtr(system_fd) > std.math.maxInt(FDInt));
        }

        return FD{
            .owned_by_libuv = if (env.os == .windows) false else {},
            .kind = .system,
            .value = .{ .as_system = handleToNumber(system_fd) },
        };
    }

    pub fn fromSystemOwnedByLibuv(system_fd: System) FD {
        if (env.os == .windows) {
            // the current process fd is max usize
            // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess
            std.debug.assert(@intFromPtr(system_fd) > std.math.maxInt(FDInt));
        }

        return FD{
            .owned_by_libuv = if (env.os == .windows) true else {},
            .kind = .system,
            .value = .{ .as_system = handleToNumber(system_fd) },
        };
    }

    pub fn fromUV(uv_fd: UV) FD {
        return switch (env.os) {
            else => FD{
                .owned_by_libuv = {},
                .kind = .system,
                .value = .{ .as_system = uv_fd },
            },
            .windows => FD{
                .owned_by_libuv = true,
                .kind = .uv,
                .value = .{ .as_uv = uv_fd },
            },
        };
    }

    pub inline fn isValid(this: FD) bool {
        return this.value.as_system != invalid_value;
    }

    /// When calling this function, you may not be able to close the returned fd.
    /// To close the fd, you have to call `.close()` on the FD.
    pub inline fn system(this: FD) System {
        return switch (env.os) {
            else => numberToHandle(this.value.as_system),
            .windows => switch (this.kind) {
                .system => numberToHandle(this.value.as_system),
                .uv => libuv.uv_get_osfhandle(this.value.as_uv),
            },
        };
    }

    /// Convert to bun.FileDescriptor
    pub inline fn fileDescriptor(this: FD) bun.FileDescriptor {
        return @bitCast(this);
    }

    pub inline fn fromFileDescriptor(fd: bun.FileDescriptor) FD {
        return @bitCast(fd);
    }

    /// When calling this function, you should consider the FD struct to now be invalid.
    /// Calling `.close()` on the FD at that point may not work.
    pub inline fn uv(this: FD) UV {
        return switch (env.os) {
            else => numberToHandle(this.value.as_system),
            .windows => switch (this.kind) {
                .system => fd: {
                    break :fd libuv.uv_open_osfhandle(numberToHandle(this.value.as_system));
                },
                .uv => this.value.as_uv,
            },
        };
    }

    /// This function will prevent stdout and stderr from being closed.
    pub fn close(this: FD) ?bun.sys.Error {
        if (env.os != .windows or this.kind == .uv) {
            // This branch executes always on linux (uv() is no-op),
            // or on Windows when given a UV file descriptor.
            const fd = this.uv();
            if (fd == bun.STDOUT_FD or fd == bun.STDERR_FD) {
                log("close({d}) SKIPPED", .{fd});
                return null;
            }
        }
        return this.close();
    }

    pub fn closeAllowingStdoutAndStderr(this: FD) ?bun.sys.Error {
        if (allow_assert) {
            std.debug.assert(this.value.as_system != invalid_value); // probably a UAF
        }
        defer if (allow_assert) {
            this.value.as_system = invalid_value;
        };
        log("close({d})", .{this});
        switch (env.os) {
            .linux => {
                const fd = this.system();
                std.debug.assert(fd != bun.invalid_fd);
                std.debug.assert(fd > -1);
                return switch (linux.getErrno(linux.close(fd))) {
                    .BADF => bun.sys.Error{ .errno = @intFromEnum(os.E.BADF), .syscall = .close, .fd = fd },
                    else => null,
                };
            },
            .mac => {
                const fd = this.system();
                std.debug.assert(fd != bun.invalid_fd);
                std.debug.assert(fd > -1);
                return switch (bun.sys.system.getErrno(bun.sys.system.@"close$NOCANCEL"(fd))) {
                    .BADF => bun.sys.Error{ .errno = @intFromEnum(os.E.BADF), .syscall = .close, .fd = fd },
                    else => null,
                };
            },
            .windows => {
                var req: uv.fs_t = uv.fs_t.uninitialized;
                switch (this.kind) {
                    .uv => {
                        defer req.deinit();
                        const rc = libuv.uv_fs_close(libuv.Loop.get(), this.value.as_uv, null);
                        return if (rc.errno()) |errno|
                            .{ .errno = errno, .syscall = .close, .fd = this.value.as_uv }
                        else
                            null;
                    },
                    .system => if (this.owned_by_libuv) {
                        // TODO: this block may be invalid, and we may not actually be able to safely close the handle.
                        defer req.deinit();
                        const uv_fd = libuv.uv_open_osfhandle();
                        const rc = libuv.uv_fs_close(libuv.Loop.get(), uv_fd, null);
                        return if (rc.errno()) |errno|
                            .{ .errno = errno, .syscall = .close, .fd = uv_fd }
                        else
                            null;
                    } else {
                        const handle = this.value.as_system;
                        std.debug.assert(@intFromPtr(handle) != 0);
                        if (std.os.windows.kernel32.CloseHandle(handle) == 0) {
                            return bun.sys.Error{
                                .errno = @intFromEnum(std.os.windows.kernel32.GetLastError()),
                                .syscall = .CloseHandle,
                            };
                        }
                    },
                }
            },
            else => @compileError("FD.close() not implemented yet"),
        }
    }

    /// This "fails" if not given an int32, returning null in that case
    pub fn fromJS(value: JSValue) ?FD {
        if (!value.isInt32()) return null;
        const fd = value.asInt32();
        return FD.fromUV(fd);
    }

    // If a non-number is given, returns null.
    // If the given number is not an fd (negative), an error is thrown and error.JSException is returned.
    pub fn fromJSValidated(value: JSValue, global: *JSC.JSGlobalObject, exception_ref: JSC.C.ExceptionRef) !?FD {
        if (!value.isInt32()) return null;
        const fd = value.asInt32();
        if (!JSC.Node.Valid.fileDescriptor(fd, global, exception_ref)) {
            return error.JSException;
        }
        return FD.fromUV(fd);
    }

    /// This forces a conversion to a UV file descriptor
    pub fn toJS(value: FD) JSValue {
        return JSValue.jsNumberFromInt32(value.uv());
    }

    pub fn format(this: FD, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        switch (env.os) {
            else => {
                writer.print("{d}", .{this.system()});
            },
            .windows => {
                switch (this.kind) {
                    .system => try writer.print("{d}[handle]", .{this.value.as_system}),
                    .uv => try writer.print("{d}[libuv]", .{this.value.as_system}),
                }
            },
        }
    }
};
