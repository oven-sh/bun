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

/// Time in seconds. Not nanos!
pub const TimeLike = c_int;
pub const Mode = std.os.mode_t;

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

pub const StringOrBuffer = union(Tag) {
    string: string,
    buffer: Buffer,

    pub const Tag = enum { string, buffer };

    pub fn slice(this: StringOrBuffer) []const u8 {
        return switch (this) {
            .string => this.string,
            .buffer => this.buffer.slice(),
        };
    }

    pub fn fromJS(value: JSC.JSValue, global: *JSC.JSGlobalObject, exception: JSC.C.ExceptionRef) ?StringOrBuffer {
        return switch (value.jsType()) {
            JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject, JSC.JSValue.JSType.Object => {
                var zig_str = JSC.ZigString.init("");
                value.toZigString(&zig_str, global);
                if (zig_str.len == 0) {
                    JSC.throwTypeError(undefined, "Expected string to have length > 0", .{}, global.ref(), exception);
                    return null;
                }

                return StringOrBuffer{
                    .string = value.slice(),
                };
            },
            JSC.JSValue.JSType.ArrayBuffer => Buffer.fromArrayBuffer(global.ref(), value, exception),
            JSC.JSValue.JSType.Uint8Array, JSC.JSValue.JSType.DataView => Buffer.fromArrayBuffer(global.ref(), value, exception),
            else => null,
        };
    }
};

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

    const Eight = strings.ExactSizeMatcher(8);
    /// Caller must verify the value is a string
    pub fn fromStringValue(value: JSC.JSValue, global: *JSC.JSGlobalObject) ?Encoding {
        var str = JSC.ZigString.Empty;
        value.toZigString(&str, global);
        return switch (str.len) {
            0...2 => null,
            else => switch (Eight.match(str)) {
                Eight.case("utf8") => Encoding.utf8,
                Eight.case("ucs2") => Encoding.ucs2,
                Eight.case("utf16le") => Encoding.utf16le,
                Eight.case("latin1") => Encoding.latin1,
                Eight.case("ascii") => Encoding.ascii,
                Eight.case("base64") => Encoding.base64,
                Eight.case("hex") => Encoding.hex,
                Eight.case("buffer") => Encoding.buffer,
                else => null,
            },
            "base64url".len => brk: {
                if (strings.eqlComptime(str.slice(), "base64url")) {
                    break :brk Encoding.base64url;
                }
                break :brk null;
            },
        };
    }
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

                if (!Valid.pathString(zig_str, ctx, exception)) return null;

                JSC.C.JSValueProtect(ctx, arg);
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

pub fn fileDescriptorFromJS(ctx: JSC.C.JSContextRef, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?FileDescriptor {
    if (!value.isNumber() or value.isBigInt()) return null;
    const fd = value.toInt32();
    if (!Valid.fileDescriptor(fd, ctx, exception)) {
        return null;
    }

    return @truncate(FileDescriptor, fd);
}

var _get_time_prop_string: ?JSC.C.JSStringRef = null;
pub fn timeLikeFromJS(ctx: JSC.C.JSContextRef, value_: JSC.JSValue, exception: JSC.C.ExceptionRef) ?TimeLike {
    var value = value_;
    if (JSC.C.JSValueIsDate(ctx, value)) {
        // TODO: make this faster
        var get_time_prop = _get_time_prop_string orelse brk: {
            var str = JSC.C.JSStringCreateStatic("getTime", "getTime".len);
            _get_time_prop_string = str;
            break :brk str;
        };

        var getTimeFunction = JSC.C.JSObjectGetProperty(ctx, value.asObjectRef(), get_time_prop, exception);
        if (exception.* != null) return null;
        value = JSC.C.JSObjectCallAsFunction(ctx, getTimeFunction, value, 0, null, exception);
        if (exception.* != null) return null;
    }

    const seconds = value.asNumber();
    if (!std.math.isFinite(seconds)) {
        return null;
    }

    return @floatToInt(TimeLike, @maximum(@floor(seconds), std.math.minInt(TimeLike)));
}

pub fn modeFromJS(ctx: JSC.C.JSContextRef, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?Mode {
    const mode_int = if (value.isNumber())
        @truncate(Mode, value.toInt32())
    else brk: {
        if (value.isUndefinedOrNull()) return null;

        //        An easier method of constructing the mode is to use a sequence of
        //        three octal digits (e.g. 765). The left-most digit (7 in the example),
        //        specifies the permissions for the file owner. The middle digit (6 in
        //        the example), specifies permissions for the group. The right-most
        //        digit (5 in the example), specifies the permissions for others.

        var zig_str = JSC.ZigString.init("");
        value.toZigString(&zig_str, ctx.asJSGlobalObject());
        var slice = zig_str.slice();
        if (strings.hasPrefix(slice, "0o")) {
            slice = slice[2..];
        }

        break :brk std.fmt.parseInt(Mode, slice, 8) catch {
            JSC.throwTypeError(_global.default_allocator, "Invalid mode string: must be an octal number", .{}, ctx, exception);
            return null;
        };
    };

    if (!std.math.isFinite(mode_int)) {
        JSC.throwTypeError(_global.default_allocator, "Invalid mode: must be an octal number", .{}, ctx, exception);
        return null;
    }

    return mode_int;
}

const PathOrFileDescriptor = union(Tag) {
    path: PathLike,
    fd: FileDescriptor,

    pub const Tag = enum { fd, path };

    pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?PathOrFileDescriptor {
        const first = arguments.next().? orelse return null;

        if (fileDescriptorFromJS(ctx, first, exception).?) |fd| {
            arguments.eat();
            return PathOrFileDescriptor{ .fd = fd };
        }

        if (exception.* != null) return null;

        return .{ .path = PathLike.fromJS(ctx, arguments, exception) orelse return null };
    }
};

pub const FileSystemFlags = enum(c_int) {
    /// Open file for appending. The file is created if it does not exist.
    @"a" = std.os.O.APPEND,
    /// Like 'a' but fails if the path exists.
    @"ax" = std.os.O.APPEND | std.os.O.EXCL,
    /// Open file for reading and appending. The file is created if it does not exist.
    @"a+" = std.os.O.APPEND | std.os.O.RDWR,
    /// Like 'a+' but fails if the path exists.
    @"ax+" = std.os.O.APPEND | std.os.O.RDWR | std.os.O.EXCL,
    /// Open file for appending in synchronous mode. The file is created if it does not exist.
    @"as" = std.os.O.APPEND,
    /// Open file for reading and appending in synchronous mode. The file is created if it does not exist.
    @"as+" = std.os.O.APPEND | std.os.O.RDWR,
    /// Open file for reading. An exception occurs if the file does not exist.
    @"r" = std.os.O.RDONLY,
    /// Open file for reading and writing. An exception occurs if the file does not exist.
    @"r+" = std.os.O.RDWR,
    /// Open file for reading and writing in synchronous mode. Instructs the operating system to bypass the local file system cache.
    /// This is primarily useful for opening files on NFS mounts as it allows skipping the potentially stale local cache. It has a very real impact on I/O performance so using this flag is not recommended unless it is needed.
    /// This doesn't turn fs.open() or fsPromises.open() into a synchronous blocking call. If synchronous operation is desired, something like fs.openSync() should be used.
    @"rs+" = std.os.O.RDWR,
    /// Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
    @"w" = std.os.O.WRONLY | std.os.O.CREAT,
    /// Like 'w' but fails if the path exists.
    @"wx" = std.os.O.WRONLY | std.os.O.TRUNC,
    ///  Open file for reading and writing. The file is created (if it does not exist) or truncated (if it exists).
    @"w+" = std.os.O.RDWR | std.os.O.CREAT,
    ///  Like 'w+' but fails if the path exists.
    @"wx+" = std.os.O.RDWR | std.os.O.EXCL,

    _,

    const O_RDONLY = std.os.O.RDONLY;
    const O_RDWR = std.os.O.RDWR;
    const O_APPEND = std.os.O.APPEND;
    const O_CREAT = std.os.O.CREAT;
    const O_WRONLY = std.os.O.WRONLY;
    const O_EXCL = std.os.O.EXCL;
    const O_SYNC = 0;
    const O_TRUNC = std.os.O.TRUNC;

    pub fn fromJS(ctx: JSC.C.JSContextRef, val: JSC.JSValue, exception: JSC.C.ExceptionRef) ?FileSystemFlags {
        if (val.isUndefinedOrNull()) {
            return @intToEnum(FileSystemFlags, O_RDONLY);
        }

        if (val.isNumber()) {
            const number = val.toInt32();
            if (!(number > 0o000 and number < 0o777)) {
                JSC.throwTypeError(
                    _global.default_allocator,
                    "Invalid integer mode: must be a number between 0o000 and 0o777",
                    .{},
                    ctx,
                    exception,
                );
                return null;
            }
            return @intToEnum(FileSystemFlags, number);
        }

        const jsType = val.jsType();
        if (jsType.isStringLike()) {
            var zig_str = JSC.ZigString.init("");
            val.toZigString(&zig_str, ctx);

            var buf: [4]u8 = .{ 0, 0, 0, 0 };
            @memcpy(&buf, zig_str.ptr, @minimum(buf.len, zig_str.len));
            const Matcher = strings.ExactSizeMatcher(4);

            // https://github.com/nodejs/node/blob/8c3637cd35cca352794e2c128f3bc5e6b6c41380/lib/internal/fs/utils.js#L565
            const flags = switch (Matcher.match(buf[0..4])) {
                Matcher.case("r") => O_RDONLY,
                Matcher.case("rs"), Matcher.case("sr") => O_RDONLY | O_SYNC,
                Matcher.case("r+") => O_RDWR,
                Matcher.case("rs+"), Matcher.case("sr+") => O_RDWR | O_SYNC,

                Matcher.case("w") => O_TRUNC | O_CREAT | O_WRONLY,
                Matcher.case("wx"), Matcher.case("xw") => O_TRUNC | O_CREAT | O_WRONLY | O_EXCL,

                Matcher.case("w+") => O_TRUNC | O_CREAT | O_RDWR,
                Matcher.case("wx+"), Matcher.case("xw+") => O_TRUNC | O_CREAT | O_RDWR | O_EXCL,

                Matcher.case("a") => O_APPEND | O_CREAT | O_WRONLY,
                Matcher.case("ax"), Matcher.case("xa") => O_APPEND | O_CREAT | O_WRONLY | O_EXCL,
                Matcher.case("as"), Matcher.case("sa") => O_APPEND | O_CREAT | O_WRONLY | O_SYNC,

                Matcher.case("a+") => O_APPEND | O_CREAT | O_RDWR,
                Matcher.case("ax+"), Matcher.case("xa+") => O_APPEND | O_CREAT | O_RDWR | O_EXCL,
                Matcher.case("as+"), Matcher.case("sa+") => O_APPEND | O_CREAT | O_RDWR | O_SYNC,

                Matcher.case("") => {
                    JSC.throwTypeError(
                        _global.default_allocator,
                        "Invalid flag: string can't be empty",
                        .{},
                        ctx,
                        exception,
                    );
                    return null;
                },
                else => {
                    JSC.throwTypeError(
                        _global.default_allocator,
                        "Invalid flag. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags",
                        .{},
                        ctx,
                        exception,
                    );
                    return null;
                },
            };

            return @intToEnum(FileSystemFlags, flags);
        }

        return null;
    }
};
