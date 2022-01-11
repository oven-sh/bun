const std = @import("std");
const _global = @import("../../../global.zig");
const strings = _global.strings;
const string = _global.string;
const AsyncIO = @import("io");
const JSC = @import("../../../jsc.zig");
const PathString = JSC.PathString;
const Environment = _global.Environment;
const C = _global.C;
const Syscall = @import("./syscall.zig");
const os = std.os;
const Buffer = JSC.MarkedArrayBuffer;
pub const FileDescriptor = os.fd_t;
pub const Flavor = enum {
    sync,
    promise,
    callback,

    pub fn Wrap(comptime this: Flavor, comptime Type: type) type {
        return comptime brk: {
            switch (this) {
                .sync => break :brk Type,
                // .callback => {
                //     const Callback = CallbackTask(Type);
                // },
                else => @compileError("Not implemented yet"),
            }
        };
    }
};

/// Node.js expects the error to include contextual information
/// - "syscall"
/// - "path"
/// - "errno"
pub fn Maybe(comptime ReturnType: type) type {
    return union(Tag) {
        err: Syscall.Error,
        result: ReturnType,

        pub const Tag = enum { err, result };

        pub const success: @This() = @This(){
            .result = std.mem.zeroes(ReturnType),
        };

        pub const todo = .{ .err = Syscall.Error.todo };

        pub inline fn getErrno(this: @This()) os.E {
            return switch (this) {
                .result => os.E.SUCCESS,
                .err => |err| @intToEnum(os.E, err.errno),
            };
        }

        pub inline fn errno(rc: anytype) ?@This() {
            return switch (std.os.errno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .errno = @truncate(Syscall.Error.Int, err),
                },
            };
        }
    };
}

// We can't really use Zig's error handling for syscalls because Node.js expects the "real" errno to be returned
// and various issues with std.os that make it too unstable for arbitrary user input (e.g. how .BADF is marked as unreachable)

/// https://github.com/nodejs/node/blob/master/lib/buffer.js#L587
pub const Encoding = enum {
    utf8,
    ucs2,
    utf16le,
    latin1,
    ascii,
    base64,
    base64url,
    hex,

    /// Refer to the buffer's encoding
    buffer,
};

const PathOrBuffer = union(Tag) {
    path: PathString,
    buffer: Buffer,

    pub const Tag = enum { path, buffer };

    pub inline fn slice(this: PathOrBuffer) []const u8 {
        return this.path.slice();
    }
};

pub const SystemError = struct {
    errno: c_int = 0,
    path: PathString = PathString.empty,
    syscall: Syscall.Tag = Syscall.Tag.TODO,
    code: Code = Code.ERR_METHOD_NOT_IMPLEMENTED,
    allocator: ?std.mem.Allocator = null,

    pub const Code = @import("./nodejs_error_code.zig").Code;
    pub const Class = JSC.NewClass(
        SystemError,
        .{ .name = "SystemError", .read_only = true },
        .{
            .hasInstance = SystemError.hasInstance,
        },
        .{
            .errno = .{
                .read_only = true,
                .getter = SystemError.getErrno,
            },
            .path = .{
                .read_only = true,
                .getter = SystemError.getPath,
            },
            .syscall = .{
                .read_only = true,
                .getter = SystemError.getSyscall,
            },
            .code = .{
                .read_only = true,
                .getter = SystemError.getCode,
            },
        },
    );

    pub var todo = SystemError{ .errno = -1, .syscall = Syscall.Tag.TODO, .code = Code.ERR_METHOD_NOT_IMPLEMENTED };

    pub fn finalize(
        this: *SystemError,
    ) void {
        if (this.allocator) |allocator| {
            allocator.destroy(this);
        }
    }

    pub fn hasInstance(ctx: JSC.C.JSContextRef, _: JSC.C.JSObjectRef, value: JSC.C.JSValueRef, _: JSC.C.ExceptionRef) callconv(.C) bool {
        return Class.customHasInstance(ctx, undefined, value, undefined) or JSC.JSValue.fromRef(value).isError();
    }

    pub fn getErrno(this: *SystemError, _: JSC.C.JSContextRef, _: JSC.C.JSStringRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return JSC.JSValue.jsNumberFromInt32(this.errno).asRef();
    }
    pub fn getPath(this: *SystemError, ctx: JSC.C.JSContextRef, _: JSC.C.JSStringRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        if (this.path.isEmpty()) {
            return JSC.JSValue.jsUndefined().asRef();
        }

        return JSC.ZigString.init(this.path.slice()).toValueAuto(ctx.asJSGlobalObject()).asObjectRef();
    }
    pub fn getSyscall(this: *SystemError, ctx: JSC.C.JSContextRef, _: JSC.C.JSStringRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        if (this.syscall == .TODO) {
            return JSC.JSValue.jsUndefined();
        }

        return JSC.ZigString.init(std.mem.span(@tagName(this.syscall))).toValueAuto(ctx.current()).asObjectRef();
    }
    pub fn getCode(this: *SystemError, ctx: JSC.C.JSContextRef, _: JSC.C.JSStringRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return JSC.ZigString.init(std.mem.span(@tagName(this.code))).toValue(ctx.current()).asObjectRef();
    }
};

pub fn CallbackTask(comptime Result: type) type {
    return struct {
        callback: JSC.C.JSObjectRef,
        option: Option,
        success: bool = false,
        completion: AsyncIO.Completion,

        pub const Option = union {
            err: SystemError,
            result: Result,
        };
    };
}

const PathLike = union(Tag) {
    string: PathString,
    buffer: Buffer,
    url: void,

    pub const Tag = enum { string, buffer, url };

    pub inline fn slice(this: PathLike) string {
        return switch (this) {
            .string => this.string.slice(),
            .buffer => this.buffer.slice(),
            else => unreachable, // TODO:
        };
    }

    pub fn sliceZWithForceCopy(this: PathLike, buf: [:0]u8, comptime force: bool) [:0]const u8 {
        var sliced = this.slice();

        if (sliced.len == 0) return "";

        if (comptime !force) {
            if (sliced[sliced.len - 1] == 0) {
                var sliced_ptr = sliced.ptr;
                return sliced_ptr[0 .. sliced.len - 1 :0];
            }
        }

        @memcpy(&buf, sliced.ptr, sliced.len);
        buf[sliced.len] = 0;
        return buf[0..sliced.len :0];
    }

    pub inline fn sliceZ(this: PathLike, buf: [:0]u8) [:0]const u8 {
        return sliceZWithForceCopy(this, buf, false);
    }

    pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?PathLike {
        const arg = arguments.next() orelse return null;
        switch (arg.jsType()) {
            JSC.JSValue.JSType.Uint8Array,
            JSC.JSValue.JSType.DataView,
            => {
                const buffer = Buffer.fromTypedArray(ctx, arg, exception);
                if (exception.* != null) return null;
                if (!Valid.pathBuffer(buffer, ctx, exception)) return null;

                JSC.C.JSValueProtect(ctx, arg);
                arguments.eat();
                return PathLike{ .buffer = buffer };
            },

            JSC.JSValue.JSType.ArrayBuffer => {
                const buffer = Buffer.fromArrayBuffer(ctx, arg, exception);
                if (exception.* != null) return null;
                if (!Valid.pathBuffer(buffer, ctx, exception)) return null;

                JSC.C.JSValueProtect(ctx, arg);
                arguments.eat();

                return PathLike{ .buffer = buffer };
            },

            JSC.JSValue.JSType.String,
            JSC.JSValue.JSType.StringObject,
            JSC.JSValue.JSType.DerivedStringObject,
            => {
                var zig_str = JSC.ZigString.init("");
                arg.toZigString(&zig_str, ctx.asJSGlobalObject());
                JSC.C.JSValueProtect(ctx, arg);

                if (!Valid.pathString(zig_str, ctx, exception)) return null;

                arguments.eat();

                if (zig_str.is16Bit()) {
                    var printed = std.mem.span(std.fmt.allocPrintZ(arguments.arena.allocator(), "{}", .{zig_str}) catch unreachable);
                    return PathLike{ .string = PathString.init(printed.ptr[0 .. printed.len + 1]) catch unreachable };
                }

                return PathLike{ .string = PathString.init(zig_str.slice()) catch unreachable };
            },
            else => return null,
        }
    }
};

pub const Valid = struct {
    pub fn fileDescriptor(fd: FileDescriptor, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) bool {
        if (fd < 0) {
            JSC.throwTypeError(_global.default_allocator, "Invalid file descriptor, must not be negative number", .{}, ctx, exception);
            return false;
        }

        return true;
    }

    pub fn pathString(zig_str: JSC.ZigString, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) bool {
        switch (zig_str.len) {
            0 => {
                JSC.throwTypeError(_global.default_allocator, "Invalid path string: can't be empty", .{}, ctx, exception);
                return false;
            },
            1...std.fs.MAX_PATH_BYTES => return true,
            else => {
                // TODO: should this be an EINVAL?
                JSC.throwTypeError(
                    _global.default_allocator,
                    comptime std.fmt.comptimePrint("Invalid path string: path is too long (max: {d})", .{std.fs.MAX_PATH_BYTES}),
                    .{},
                    ctx,
                    exception,
                );
                return false;
            },
        }

        unreachable;
    }

    pub fn pathBuffer(buffer: Buffer, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) bool {
        const slice = buffer.slice();
        switch (slice.len) {
            0 => {
                JSC.throwTypeError(_global.default_allocator, "Invalid path buffer: can't be empty", .{}, ctx, exception);
                return false;
            },

            else => {

                // TODO: should this be an EINVAL?
                JSC.throwTypeError(
                    _global.default_allocator,
                    comptime std.fmt.comptimePrint("Invalid path buffer: path is too long (max: {d})", .{std.fs.MAX_PATH_BYTES}),
                    .{},
                    ctx,
                    exception,
                );
                return false;
            },
            1...std.fs.MAX_PATH_BYTES => return true,
        }

        unreachable;
    }
};

pub const ArgumentsSlice = struct {
    remaining: []const JSC.JSValue,
    arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(_global.default_allocator),
    all: []const JSC.JSValue,

    pub fn init(arguments: []const JSC.JSValue) ArgumentsSlice {
        return ArgumentsSlice{
            .remaining = arguments,
            .all = arguments,
        };
    }

    pub inline fn len(this: *const ArgumentsSlice) u16 {
        return @truncate(u16, this.remaining.len);
    }
    pub fn eat(this: *ArgumentsSlice) void {
        if (this.remaining.len == 0) {
            return;
        }

        this.remaining = this.remaining[1..];
    }

    pub fn next(this: *ArgumentsSlice) ?JSC.JSValue {
        if (this.remaining.len == 0) {
            return null;
        }

        return this.remaining[0];
    }
};

const PathOrFileDescriptor = union(Tag) {
    path: PathLike,
    fd: FileDescriptor,

    pub const Tag = enum { fd, path };

    pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?PathOrFileDescriptor {
        const first = arguments.next().?;

        if (first.isNumber() or first.isBigInt()) {
            const fd = first.toInt32();
            if (!Valid.fileDescriptor(fd, ctx, exception)) {
                return null;
            }

            arguments.eat();
            return PathOrFileDescriptor{ .fd = @truncate(FileDescriptor, fd) };
        }

        return .{ .path = PathLike.fromJS(ctx, arguments, exception) orelse return null };
    }
};
