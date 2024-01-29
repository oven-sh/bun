const std = @import("std");
const os = std.os;
const linux = os.linux;

const bun = @import("root").bun;
const env = bun.Environment;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const libuv = bun.windows.libuv;

const allow_assert = env.allow_assert;

const log = bun.Output.scoped(.fs, false);
fn handleToNumber(handle: FDImpl.System) FDImpl.SystemAsInt {
    if (env.os == .windows) {
        // intCast fails if 'fd > 2^62'
        // possible with handleToNumber(GetCurrentProcess());
        return @intCast(@intFromPtr(handle));
    } else {
        return handle;
    }
}

fn numberToHandle(handle: FDImpl.SystemAsInt) FDImpl.System {
    if (env.os == .windows) {
        if (!@inComptime()) {
            std.debug.assert(handle != FDImpl.invalid_value);
        }
        return @ptrFromInt(handle);
    } else {
        return handle;
    }
}

pub fn uv_get_osfhandle(in: c_int) libuv.uv_os_fd_t {
    const out = libuv.uv_get_osfhandle(in);
    log("uv_get_osfhandle({d}) = {d}", .{ in, @intFromPtr(out) });
    return out;
}

pub fn uv_open_osfhandle(in: libuv.uv_os_fd_t) c_int {
    const out = libuv.uv_open_osfhandle(in);
    log("uv_open_osfhandle({d}) = {d}", .{ @intFromPtr(in), out });
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

    pub const System = std.os.fd_t;

    pub const SystemAsInt = switch (env.os) {
        .windows => u63,
        else => System,
    };

    pub const UV = switch (env.os) {
        .windows => bun.windows.libuv.uv_file,
        else => System,
    };

    pub const Value = if (env.os == .windows)
        packed union { as_system: SystemAsInt, as_uv: UV }
    else
        packed union { as_system: SystemAsInt };

    pub const Kind = if (env.os == .windows)
        enum(u1) { system = 0, uv = 1 }
    else
        enum(u0) { system };

    comptime {
        std.debug.assert(@sizeOf(FDImpl) == @sizeOf(System));

        if (env.os == .windows) {
            // we want the conversion from FD to fd_t to be a integer truncate
            std.debug.assert(@as(FDImpl, @bitCast(@as(u64, 512))).value.as_system == 512);
        }
    }

    pub fn fromSystem(system_fd: System) FDImpl {
        if (env.os == .windows) {
            // the current process fd is max usize
            // https://learn.microsoft.com/en-us/windows/win32/api/processthreadsapi/nf-processthreadsapi-getcurrentprocess
            std.debug.assert(@intFromPtr(system_fd) <= std.math.maxInt(SystemAsInt));
        }

        return FDImpl{
            .kind = .system,
            .value = .{ .as_system = handleToNumber(system_fd) },
        };
    }

    pub fn fromUV(uv_fd: UV) FDImpl {
        return switch (env.os) {
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
        return switch (env.os) {
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
        return switch (env.os == .windows) {
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
        return @bitCast(fd.int());
    }

    /// When calling this function, you should consider the FD struct to now be invalid.
    /// Calling `.close()` on the FD at that point may not work.
    pub fn uv(this: FDImpl) UV {
        return switch (env.os) {
            else => numberToHandle(this.value.as_system),
            .windows => switch (this.kind) {
                .system => std.debug.panic(
                    \\Cast {} -> FDImpl.UV makes closing impossible!
                    \\
                    \\The supplier of this FileDescriptor should call 'bun.toLibUVOwnedFD'
                    \\or 'FDImpl.makeLibUVOwned', probably where open() was called.
                ,
                    .{this},
                ),
                .uv => this.value.as_uv,
            },
        };
    }

    /// This function will prevent stdout and stderr from being closed.
    pub fn close(this: FDImpl) ?bun.sys.Error {
        if (env.os != .windows or this.kind == .uv) {
            // This branch executes always on linux (uv() is no-op),
            // or on Windows when given a UV file descriptor.
            const fd = bun.toFD(this.uv());
            if (fd == bun.STDOUT_FD or fd == bun.STDERR_FD) {
                log("close({}) SKIPPED", .{this});
                return null;
            }
        }
        return this.closeAllowingStdoutAndStderr();
    }

    pub fn makeLibUVOwned(this: FDImpl) FDImpl {
        return switch (env.os) {
            else => this,
            .windows => switch (this.kind) {
                .system => fd: {
                    break :fd FDImpl.fromUV(uv_open_osfhandle(numberToHandle(this.value.as_system)));
                },
                .uv => this,
            },
        };
    }

    pub fn closeAllowingStdoutAndStderr(this: FDImpl) ?bun.sys.Error {
        if (allow_assert) {
            std.debug.assert(this.value.as_system != invalid_value); // probably a UAF
        }

        const result: ?bun.sys.Error = switch (env.os) {
            .linux => result: {
                const fd = this.encode();
                std.debug.assert(fd != bun.invalid_fd);
                std.debug.assert(fd.cast() > -1);
                break :result switch (linux.getErrno(linux.close(fd.cast()))) {
                    .BADF => bun.sys.Error{ .errno = @intFromEnum(os.E.BADF), .syscall = .close, .fd = fd },
                    else => null,
                };
            },
            .mac => result: {
                const fd = this.encode();
                std.debug.assert(fd != bun.invalid_fd);
                std.debug.assert(fd.cast() > -1);
                break :result switch (bun.sys.system.getErrno(bun.sys.system.@"close$NOCANCEL"(fd.cast()))) {
                    .BADF => bun.sys.Error{ .errno = @intFromEnum(os.E.BADF), .syscall = .close, .fd = fd },
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
                            .{ .errno = errno, .syscall = .close, .fd = this.encode() }
                        else
                            null;
                    },
                    .system => {
                        std.debug.assert(this.value.as_system != 0);
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

        if (env.isDebug) {
            if (result) |err| {
                if (err.errno == @intFromEnum(os.E.BADF)) {
                    // TODO(@paperdave): Zig Compiler Bug, if you remove `this` from the log. An error is correctly printed, but with the wrong reference trace
                    bun.Output.debugWarn("close({}) = EBADF. This is an indication of a file descriptor UAF", .{this});
                } else {
                    log("close({}) = {}", .{ this, err });
                }
            } else {
                log("close({})", .{this});
            }
        }

        return result;
    }

    /// This "fails" if not given an int32, returning null in that case
    pub fn fromJS(value: JSValue) ?FDImpl {
        if (!value.isInt32()) return null;
        const fd = value.asInt32();
        return FDImpl.fromUV(fd);
    }

    // If a non-number is given, returns null.
    // If the given number is not an fd (negative), an error is thrown and error.JSException is returned.
    pub fn fromJSValidated(value: JSValue, global: *JSC.JSGlobalObject, exception_ref: JSC.C.ExceptionRef) !?FDImpl {
        if (!value.isInt32()) return null;
        const fd = value.asInt32();
        if (!JSC.Node.Valid.fileDescriptor(fd, global, exception_ref)) {
            return error.JSException;
        }
        return FDImpl.fromUV(fd);
    }

    /// After calling, the input file descriptor is no longer valid and must not be used
    pub fn toJS(value: FDImpl, _: *JSC.JSGlobalObject) JSValue {
        return JSValue.jsNumberFromInt32(value.makeLibUVOwned().uv());
    }

    pub fn format(this: FDImpl, comptime _: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (!this.isValid()) {
            try writer.writeAll("[invalid_fd]");
            return;
        }
        switch (env.os) {
            else => {
                try writer.print("{d}", .{this.system()});
            },
            .windows => {
                switch (this.kind) {
                    .system => {
                        if (env.isDebug) {
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
                                const path = std.os.windows.GetFinalPathNameByHandle(handle, .{ .volume_name = .Dos }, &fd_path) catch break :print_with_path;
                                return try writer.print("{d}[{}]", .{
                                    this.value.as_system,
                                    std.unicode.fmtUtf16le(path),
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
        std.debug.assert(this.isValid());
    }
};
