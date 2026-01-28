//! Error type that preserves useful information from the operating system
const Error = @This();

const retry_errno = if (Environment.isLinux)
    @as(Int, @intCast(@intFromEnum(E.AGAIN)))
else if (Environment.isMac)
    @as(Int, @intCast(@intFromEnum(E.AGAIN)))
else
    @as(Int, @intCast(@intFromEnum(E.INTR)));

const todo_errno = std.math.maxInt(Int) - 1;

pub const Int = u16;

/// TODO: convert to function
pub const oom = fromCode(E.NOMEM, .read);

errno: Int = todo_errno,
fd: bun.FileDescriptor = bun.invalid_fd,
from_libuv: if (Environment.isWindows) bool else void = if (Environment.isWindows) false else undefined,
path: []const u8 = "",
syscall: sys.Tag = sys.Tag.TODO,
dest: []const u8 = "",

pub fn clone(this: *const Error, allocator: std.mem.Allocator) Error {
    var copy = this.*;
    copy.path = bun.handleOom(allocator.dupe(u8, copy.path));
    copy.dest = bun.handleOom(allocator.dupe(u8, copy.dest));
    return copy;
}

pub fn fromCode(errno: E, syscall_tag: sys.Tag) Error {
    return .{
        .errno = @as(Int, @intCast(@intFromEnum(errno))),
        .syscall = syscall_tag,
    };
}

pub fn fromCodeInt(errno: anytype, syscall_tag: sys.Tag) Error {
    return .{
        .errno = @as(Int, @intCast(if (Environment.isWindows) @abs(errno) else errno)),
        .syscall = syscall_tag,
    };
}

pub fn format(self: Error, writer: *std.Io.Writer) std.Io.Writer.Error!void {
    // We want to reuse the code from SystemError for formatting.
    // But, we do not want to call String.createUTF8 on the path/dest strings
    // because we're intending to pass them to writer.print()
    // which will convert them back into UTF*.
    var that = self.withoutPath().toShellSystemError();
    bun.debugAssert(that.path.tag != .WTFStringImpl);
    bun.debugAssert(that.dest.tag != .WTFStringImpl);
    that.path = bun.String.borrowUTF8(self.path);
    that.dest = bun.String.borrowUTF8(self.dest);
    bun.debugAssert(that.path.tag != .WTFStringImpl);
    bun.debugAssert(that.dest.tag != .WTFStringImpl);

    return that.format(writer);
}

pub inline fn getErrno(this: Error) E {
    return @as(E, @enumFromInt(this.errno));
}

pub inline fn isRetry(this: *const Error) bool {
    return this.getErrno() == .AGAIN;
}

pub const retry = Error{
    .errno = retry_errno,
    .syscall = .read,
};

pub inline fn withFd(this: Error, fd: anytype) Error {
    if (Environment.allow_assert) bun.assert(fd != bun.invalid_fd);
    return Error{
        .errno = this.errno,
        .syscall = this.syscall,
        .fd = fd,
    };
}

pub inline fn withPath(this: Error, path: anytype) Error {
    if (std.meta.Child(@TypeOf(path)) == u16) {
        @compileError("Do not pass WString path to withPath, it needs the path encoded as utf8");
    }
    return Error{
        .errno = this.errno,
        .syscall = this.syscall,
        .path = bun.span(path),
    };
}

pub inline fn withPathAndSyscall(this: Error, path: anytype, syscall_: sys.Tag) Error {
    if (std.meta.Child(@TypeOf(path)) == u16) {
        @compileError("Do not pass WString path to withPath, it needs the path encoded as utf8");
    }
    return Error{
        .errno = this.errno,
        .syscall = syscall_,
        .path = bun.span(path),
    };
}

pub fn deinit(this: *Error) void {
    this.deinitWithAllocator(bun.default_allocator);
}

/// Only call this after it's been .clone()'d
pub fn deinitWithAllocator(this: *Error, allocator: std.mem.Allocator) void {
    if (this.path.len > 0) {
        allocator.free(this.path);
        this.path = "";
    }
    if (this.dest.len > 0) {
        allocator.free(this.dest);
        this.dest = "";
    }
}

pub inline fn withPathDest(this: Error, path: anytype, dest: anytype) Error {
    if (std.meta.Child(@TypeOf(path)) == u16) {
        @compileError("Do not pass WString path to withPathDest, it needs the path encoded as utf8 (path)");
    }
    if (std.meta.Child(@TypeOf(dest)) == u16) {
        @compileError("Do not pass WString path to withPathDest, it needs the path encoded as utf8 (dest)");
    }
    return Error{
        .errno = this.errno,
        .syscall = this.syscall,
        .path = bun.span(path),
        .dest = bun.span(dest),
    };
}

pub inline fn withPathLike(this: Error, pathlike: anytype) Error {
    return switch (pathlike) {
        .fd => |fd| this.withFd(fd),
        .path => |path| this.withPath(path.slice()),
    };
}

/// When the memory of the path/dest buffer is unsafe to use, call this function to clone the error without the path/dest.
pub fn withoutPath(this: *const Error) Error {
    var copy = this.*;
    copy.path = "";
    copy.dest = "";
    return copy;
}

pub fn name(this: *const Error) []const u8 {
    if (comptime Environment.isWindows) {
        const system_errno = brk: {
            // setRuntimeSafety(false) because we use tagName function, which will be null on invalid enum value.
            @setRuntimeSafety(false);
            if (this.from_libuv) {
                break :brk @as(SystemErrno, @enumFromInt(@intFromEnum(bun.windows.libuv.translateUVErrorToE(this.errno))));
            }

            break :brk @as(SystemErrno, @enumFromInt(this.errno));
        };
        if (bun.tagName(SystemErrno, system_errno)) |errname| {
            return errname;
        }
    } else if (this.errno > 0 and this.errno < SystemErrno.max) {
        const system_errno = @as(SystemErrno, @enumFromInt(this.errno));
        if (bun.tagName(SystemErrno, system_errno)) |errname| {
            return errname;
        }
    }

    return "UNKNOWN";
}

pub fn toZigErr(this: Error) anyerror {
    return bun.errnoToZigErr(this.errno);
}

/// 1. Convert libuv errno values into libc ones.
/// 2. Get the tag name as a string for printing.
pub fn getErrorCodeTagName(err: *const Error) ?struct { [:0]const u8, SystemErrno } {
    if (!Environment.isWindows) {
        if (err.errno > 0 and err.errno < SystemErrno.max) {
            const system_errno = @as(SystemErrno, @enumFromInt(err.errno));
            return .{ @tagName(system_errno), system_errno };
        }
    } else {
        const system_errno: SystemErrno = brk: {
            // setRuntimeSafety(false) because we use tagName function, which will be null on invalid enum value.
            @setRuntimeSafety(false);
            if (err.from_libuv) {
                break :brk @enumFromInt(@intFromEnum(bun.windows.libuv.translateUVErrorToE(@as(c_int, err.errno) * -1)));
            }

            break :brk @enumFromInt(err.errno);
        };
        if (bun.tagName(SystemErrno, system_errno)) |errname| {
            return .{ errname, system_errno };
        }
    }
    return null;
}

pub fn msg(this: Error) ?[]const u8 {
    if (this.getErrorCodeTagName()) |resolved_errno| {
        const code, const system_errno = resolved_errno;
        if (coreutils_error_map.get(system_errno)) |label| {
            return label;
        }
        return code;
    }
    return null;
}

/// Simpler formatting which does not allocate a message
pub fn toShellSystemError(this: Error) SystemError {
    @setEvalBranchQuota(1_000_000);
    var err = SystemError{
        .errno = @as(c_int, this.errno) * -1,
        .syscall = bun.String.static(@tagName(this.syscall)),
        .message = .empty,
    };

    // errno label
    if (this.getErrorCodeTagName()) |resolved_errno| {
        const code, const system_errno = resolved_errno;
        err.code = bun.String.static(code);
        if (coreutils_error_map.get(system_errno)) |label| {
            err.message = bun.String.static(label);
        }
    }

    if (this.path.len > 0) {
        err.path = bun.String.cloneUTF8(this.path);
    }

    if (this.dest.len > 0) {
        err.dest = bun.String.cloneUTF8(this.dest);
    }

    if (this.fd.unwrapValid()) |valid| {
        // When the FD is a windows handle, there is no sane way to report this.
        if (!Environment.isWindows or valid.kind == .uv) {
            err.fd = valid.uv();
        }
    }

    return err;
}

/// More complex formatting to precisely match the printing that Node.js emits.
/// Use this whenever the error will be sent to JavaScript instead of the shell variant above.
pub fn toSystemError(this: Error) SystemError {
    var err = SystemError{
        .errno = -%@as(c_int, this.errno),
        .syscall = bun.String.static(@tagName(this.syscall)),
        .message = .empty,
    };

    // errno label
    var maybe_code: ?[:0]const u8 = null;
    var label: ?[]const u8 = null;
    if (this.getErrorCodeTagName()) |resolved_errno| {
        maybe_code, const system_errno = resolved_errno;
        err.code = bun.String.static(maybe_code.?);
        label = libuv_error_map.get(system_errno);
    }

    // format taken from Node.js 'exceptions.cc'
    // search keyword: `Local<Value> UVException(Isolate* isolate,`
    var message_buf: [4096]u8 = @splat(0);
    const message = message: {
        var stream = std.io.fixedBufferStream(&message_buf);
        const writer = stream.writer();
        brk: {
            if (maybe_code) |code| {
                writer.writeAll(code) catch break :brk;
                writer.writeAll(": ") catch break :brk;
            }
            writer.writeAll(label orelse "Unknown Error") catch break :brk;
            writer.writeAll(", ") catch break :brk;
            writer.writeAll(@tagName(this.syscall)) catch break :brk;
            if (this.path.len > 0) {
                writer.writeAll(" '") catch break :brk;
                writer.writeAll(this.path) catch break :brk;
                writer.writeAll("'") catch break :brk;

                if (this.dest.len > 0) {
                    writer.writeAll(" -> '") catch break :brk;
                    writer.writeAll(this.dest) catch break :brk;
                    writer.writeAll("'") catch break :brk;
                }
            }
        }
        break :message stream.getWritten();
    };
    err.message = bun.String.cloneUTF8(message);

    if (this.path.len > 0) {
        err.path = bun.String.cloneUTF8(this.path);
    }

    if (this.dest.len > 0) {
        err.dest = bun.String.cloneUTF8(this.dest);
    }

    if (this.fd.unwrapValid()) |valid| {
        // When the FD is a windows handle, there is no sane way to report this.
        if (!Environment.isWindows or valid.kind == .uv) {
            err.fd = valid.uv();
        }
    }

    return err;
}

pub inline fn todo() Error {
    if (Environment.isDebug) {
        @panic("Error.todo() was called");
    }
    return Error{ .errno = todo_errno, .syscall = .TODO };
}

pub fn toJS(this: Error, ptr: *jsc.JSGlobalObject) bun.JSError!jsc.JSValue {
    return this.toSystemError().toErrorInstance(ptr);
}

const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;

const jsc = bun.jsc;
const SystemError = jsc.SystemError;

const sys = bun.sys;
const E = sys.E;
const SystemErrno = sys.SystemErrno;
const coreutils_error_map = sys.coreutils_error_map;
const libuv_error_map = sys.libuv_error_map;
