const std = @import("std");
const builtin = @import("builtin");
const bun = @import("../../global.zig");
const strings = bun.strings;
const string = bun.string;
const AsyncIO = @import("io");
const JSC = @import("../../jsc.zig");
const PathString = JSC.PathString;
const Environment = bun.Environment;
const C = bun.C;
const Syscall = @import("./syscall.zig");
const os = std.os;
const Buffer = JSC.MarkedArrayBuffer;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const logger = @import("../../logger.zig");
const Fs = @import("../../fs.zig");
const URL = @import("../../url.zig").URL;
const Shimmer = @import("../bindings/shimmer.zig").Shimmer;
const is_bindgen: bool = std.meta.globalOption("bindgen", bool) orelse false;
const meta = bun.meta;
/// Time in seconds. Not nanos!
pub const TimeLike = c_int;
pub const Mode = if (Environment.isLinux) u32 else std.os.mode_t;
const heap_allocator = bun.default_allocator;
pub fn DeclEnum(comptime T: type) type {
    const fieldInfos = std.meta.declarations(T);
    var enumFields: [fieldInfos.len]std.builtin.TypeInfo.EnumField = undefined;
    var decls = [_]std.builtin.TypeInfo.Declaration{};
    inline for (fieldInfos) |field, i| {
        enumFields[i] = .{
            .name = field.name,
            .value = i,
        };
    }
    return @Type(.{
        .Enum = .{
            .layout = .Auto,
            .tag_type = std.math.IntFittingRange(0, fieldInfos.len - 1),
            .fields = &enumFields,
            .decls = &decls,
            .is_exhaustive = true,
        },
    });
}

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
pub fn Maybe(comptime ResultType: type) type {
    return union(Tag) {
        pub const ReturnType = ResultType;

        err: Syscall.Error,
        result: ReturnType,

        pub const retry: @This() = .{
            .err = Syscall.Error.retry,
        };

        pub const Tag = enum { err, result };

        pub const success: @This() = @This(){
            .result = std.mem.zeroes(ReturnType),
        };

        pub const todo: @This() = @This(){ .err = Syscall.Error.todo };

        pub fn toJS(this: @This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
            switch (this) {
                .err => |e| {
                    return e.toJSC(globalThis);
                },
                .result => |r| {
                    if (comptime ReturnType == void) {
                        return JSC.JSValue.jsUndefined();
                    }

                    if (comptime ReturnType == JSC.ArrayBuffer) {
                        return r.toJS(globalThis, null);
                    }

                    if (comptime std.meta.trait.isNumber(ResultType) or std.meta.trait.isFloat(ResultType)) {
                        return JSC.JSValue.jsNumber(r);
                    }

                    if (comptime std.meta.trait.isZigString(ResultType)) {
                        if (ResultType == []u8) {
                            return JSC.ArrayBuffer.fromBytes(r, .ArrayBuffer).toJS(globalThis, null);
                        }
                        return JSC.ZigString.init(std.mem.span(r)).withEncoding().toValueAuto(globalThis);
                    }

                    if (comptime @typeInfo(ReturnType) == .Bool) {
                        return JSC.JSValue.jsBoolean(r);
                    }

                    if (comptime std.meta.trait.isContainer(ReturnType)) {
                        return r.toJS(globalThis);
                    }

                    @compileError("toJS Not implemented for type " ++ @typeName(ReturnType));
                },
            }
        }

        pub fn toArrayBuffer(this: @This(), globalThis: *JSC.JSGlobalObject) JSC.JSValue {
            switch (this) {
                .err => |e| {
                    return e.toJSC(globalThis);
                },
                .result => |r| {
                    return JSC.ArrayBuffer.fromBytes(r, .ArrayBuffer).toJS(globalThis, null);
                },
            }
        }

        pub inline fn getErrno(this: @This()) os.E {
            return switch (this) {
                .result => os.E.SUCCESS,
                .err => |err| @intToEnum(os.E, err.errno),
            };
        }

        pub inline fn errno(rc: anytype) ?@This() {
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .err = .{ .errno = @truncate(Syscall.Error.Int, @enumToInt(err)) },
                },
            };
        }

        pub inline fn errnoSys(rc: anytype, syscall: Syscall.Tag) ?@This() {
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .err = .{ .errno = @truncate(Syscall.Error.Int, @enumToInt(err)), .syscall = syscall },
                },
            };
        }

        pub inline fn errnoSysFd(rc: anytype, syscall: Syscall.Tag, fd: anytype) ?@This() {
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .err = .{
                        .errno = @truncate(Syscall.Error.Int, @enumToInt(err)),
                        .syscall = syscall,
                        .fd = @intCast(i32, fd),
                    },
                },
            };
        }

        pub inline fn errnoSysP(rc: anytype, syscall: Syscall.Tag, path: anytype) ?@This() {
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .err = .{ .errno = @truncate(Syscall.Error.Int, @enumToInt(err)), .syscall = syscall, .path = std.mem.span(path) },
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

    pub export fn external_string_finalizer(_: ?*anyopaque, _: JSC.C.JSStringRef, buffer: *anyopaque, byteLength: usize) void {
        bun.default_allocator.free(@ptrCast([*]const u8, buffer)[0..byteLength]);
    }

    pub fn toJS(this: StringOrBuffer, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return switch (this) {
            .string => {
                if (this.string.len == 0)
                    return JSC.ZigString.Empty.toValue(ctx).asObjectRef();

                const input = this.string;
                if (strings.toUTF16Alloc(bun.default_allocator, input, false) catch null) |utf16| {
                    bun.default_allocator.free(bun.constStrToU8(input));
                    return JSC.ZigString.toExternalU16(utf16.ptr, utf16.len, ctx.ptr()).asObjectRef();
                }

                return JSC.ZigString.init(input).toExternalValue(ctx.ptr()).asObjectRef();
            },
            .buffer => this.buffer.toJSObjectRef(ctx, exception),
        };
    }

    pub fn fromJS(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?StringOrBuffer {
        return switch (value.jsType()) {
            JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject, JSC.JSValue.JSType.Object => {
                var zig_str = value.toSlice(global, allocator);
                return StringOrBuffer{ .string = zig_str.slice() };
            },

            .ArrayBuffer,
            .Int8Array,
            .Uint8Array,
            .Uint8ClampedArray,
            .Int16Array,
            .Uint16Array,
            .Int32Array,
            .Uint32Array,
            .Float32Array,
            .Float64Array,
            .BigInt64Array,
            .BigUint64Array,
            .DataView,
            => StringOrBuffer{
                .buffer = Buffer.fromArrayBuffer(global, value, exception),
            },
            else => null,
        };
    }
};

/// Like StringOrBuffer but actually returns a Node.js Buffer
pub const StringOrNodeBuffer = union(Tag) {
    string: string,
    buffer: Buffer,

    pub const Tag = enum { string, buffer };

    pub fn slice(this: StringOrNodeBuffer) []const u8 {
        return switch (this) {
            .string => this.string,
            .buffer => this.buffer.slice(),
        };
    }

    pub fn toJS(this: StringOrNodeBuffer, ctx: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return switch (this) {
            .string => {
                const input = this.string;
                if (this.string.len == 0)
                    return JSC.ZigString.Empty.toValue(ctx).asObjectRef();

                if (strings.toUTF16Alloc(bun.default_allocator, input, false) catch null) |utf16| {
                    bun.default_allocator.free(bun.constStrToU8(input));
                    return JSC.ZigString.toExternalU16(utf16.ptr, utf16.len, ctx.ptr()).asObjectRef();
                }

                return JSC.ZigString.init(input).toExternalValue(ctx.ptr()).asObjectRef();
            },
            .buffer => this.buffer.toNodeBuffer(ctx),
        };
    }

    pub fn fromJS(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?StringOrBuffer {
        return switch (value.jsType()) {
            JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject, JSC.JSValue.JSType.Object => {
                var zig_str = value.toSlice(global, allocator);
                return StringOrNodeBuffer{ .string = zig_str.slice() };
            },

            .ArrayBuffer,
            .Int8Array,
            .Uint8Array,
            .Uint8ClampedArray,
            .Int16Array,
            .Uint16Array,
            .Int32Array,
            .Uint32Array,
            .Float32Array,
            .Float64Array,
            .BigInt64Array,
            .BigUint64Array,
            .DataView,
            => StringOrBuffer{
                .buffer = Buffer.fromArrayBuffer(global, value, exception),
            },
            else => null,
        };
    }
};

pub const SliceOrBuffer = union(Tag) {
    string: JSC.ZigString.Slice,
    buffer: Buffer,

    pub fn deinit(this: SliceOrBuffer) void {
        switch (this) {
            .string => {
                this.string.deinit();
            },
            .buffer => {},
        }
    }

    pub const Tag = enum { string, buffer };

    pub fn slice(this: SliceOrBuffer) []const u8 {
        return switch (this) {
            .string => this.string.slice(),
            .buffer => this.buffer.slice(),
        };
    }

    pub fn toJS(this: SliceOrBuffer, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return switch (this) {
            string => {
                const input = this.string.slice;
                if (strings.toUTF16Alloc(bun.default_allocator, input, false) catch null) |utf16| {
                    bun.default_allocator.free(bun.constStrToU8(input));
                    return JSC.ZigString.toExternalU16(utf16.p.tr, utf16.len, ctx.ptr()).asObjectRef();
                }

                return JSC.ZigString.init(input).toExternalValue(ctx.ptr()).asObjectRef();
            },
            .buffer => this.buffer.toJSObjectRef(ctx, exception),
        };
    }

    pub fn fromJS(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue) ?SliceOrBuffer {
        return switch (value.jsType()) {
            JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject, JSC.JSValue.JSType.Object => {
                var zig_str = value.toSlice(global, allocator);
                return SliceOrBuffer{ .string = zig_str };
            },
            .ArrayBuffer,
            .Int8Array,
            .Uint8Array,
            .Uint8ClampedArray,
            .Int16Array,
            .Uint16Array,
            .Int32Array,
            .Uint32Array,
            .Float32Array,
            .Float64Array,
            .BigInt64Array,
            .BigUint64Array,
            .DataView,
            => SliceOrBuffer{
                .buffer = JSC.MarkedArrayBuffer{
                    .buffer = value.asArrayBuffer(global) orelse return null,
                    .allocator = null,
                },
            },
            else => null,
        };
    }
};
pub const ErrorCode = @import("./nodejs_error_code.zig").Code;

// We can't really use Zig's error handling for syscalls because Node.js expects the "real" errno to be returned
// and various issues with std.os that make it too unstable for arbitrary user input (e.g. how .BADF is marked as unreachable)

/// https://github.com/nodejs/node/blob/master/lib/buffer.js#L587
pub const Encoding = enum(u8) {
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

    pub fn isBinaryToText(this: Encoding) bool {
        return switch (this) {
            .hex, .base64, .base64url => true,
            else => false,
        };
    }

    const Eight = strings.ExactSizeMatcher(8);
    /// Caller must verify the value is a string
    pub fn fromStringValue(value: JSC.JSValue, global: *JSC.JSGlobalObject) ?Encoding {
        var sliced = value.toSlice(global, bun.default_allocator);
        defer sliced.deinit();
        return from(sliced.slice());
    }

    /// Caller must verify the value is a string
    pub fn from(slice: []const u8) ?Encoding {
        return switch (slice.len) {
            0...2 => null,
            else => switch (Eight.matchLower(slice)) {
                Eight.case("utf-8"), Eight.case("utf8") => Encoding.utf8,
                Eight.case("ucs-2"), Eight.case("ucs2") => Encoding.ucs2,
                Eight.case("utf16-le"), Eight.case("utf16le") => Encoding.utf16le,
                Eight.case("latin1") => Encoding.latin1,
                Eight.case("ascii") => Encoding.ascii,
                Eight.case("base64") => Encoding.base64,
                Eight.case("hex") => Encoding.hex,
                Eight.case("buffer") => Encoding.buffer,
                else => null,
            },
            "base64url".len => brk: {
                if (strings.eqlCaseInsensitiveASCII(slice, "base64url", false)) {
                    break :brk Encoding.base64url;
                }
                break :brk null;
            },
        };
    }

    pub fn encodeWithSize(encoding: Encoding, globalThis: *JSC.JSGlobalObject, comptime size: usize, input: *const [size]u8) JSC.JSValue {
        switch (encoding) {
            .base64 => {
                var base64: [std.base64.standard.Encoder.calcSize(size)]u8 = undefined;
                const result = JSC.ZigString.init(std.base64.standard.Encoder.encode(&base64, input)).toValueGC(globalThis);
                return result;
            },
            .base64url => {
                var buf: [std.base64.url_safe.Encoder.calcSize(size) + "data:;base64,".len]u8 = undefined;
                var encoded = std.base64.url_safe.Encoder.encode(buf["data:;base64,".len..], input);
                buf[0.."data:;base64,".len].* = "data:;base64,".*;

                const result = JSC.ZigString.init(buf[0 .. "data:;base64,".len + encoded.len]).toValueGC(globalThis);
                return result;
            },
            .hex => {
                var buf: [size * 4]u8 = undefined;
                var out = std.fmt.bufPrint(&buf, "{}", .{std.fmt.fmtSliceHexLower(input)}) catch unreachable;
                const result = JSC.ZigString.init(out).toValueGC(globalThis);
                return result;
            },
            else => {
                globalThis.throwInvalidArguments("Unexpected encoding", .{});
                return JSC.JSValue.zero;
            },
        }
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

pub fn CallbackTask(comptime Result: type) type {
    return struct {
        callback: JSC.C.JSObjectRef,
        option: Option,
        success: bool = false,

        pub const Option = union {
            err: JSC.SystemError,
            result: Result,
        };
    };
}

pub const PathLike = union(Tag) {
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

    pub fn sliceZWithForceCopy(this: PathLike, buf: *[bun.MAX_PATH_BYTES]u8, comptime force: bool) [:0]const u8 {
        var sliced = this.slice();

        if (sliced.len == 0) return "";

        if (comptime !force) {
            if (sliced[sliced.len - 1] == 0) {
                var sliced_ptr = sliced.ptr;
                return sliced_ptr[0 .. sliced.len - 1 :0];
            }
        }

        @memcpy(buf, sliced.ptr, sliced.len);
        buf[sliced.len] = 0;
        return buf[0..sliced.len :0];
    }

    pub inline fn sliceZ(this: PathLike, buf: *[bun.MAX_PATH_BYTES]u8) [:0]const u8 {
        return sliceZWithForceCopy(this, buf, false);
    }

    pub inline fn sliceZAssume(
        this: PathLike,
    ) [:0]const u8 {
        return std.meta.assumeSentinel(this.slice(), 0);
    }

    pub fn toJS(this: PathLike, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return switch (this) {
            .string => this.string.toJS(ctx, exception),
            .buffer => this.buffer.toJSObjectRef(ctx, exception),
            else => unreachable,
        };
    }

    pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?PathLike {
        return fromJSWithAllocator(ctx, arguments, arguments.arena.allocator(), exception);
    }
    pub fn fromJSWithAllocator(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, allocator: std.mem.Allocator, exception: JSC.C.ExceptionRef) ?PathLike {
        const arg = arguments.next() orelse return null;
        switch (arg.jsType()) {
            JSC.JSValue.JSType.Uint8Array,
            JSC.JSValue.JSType.DataView,
            => {
                const buffer = Buffer.fromTypedArray(ctx, arg, exception);
                if (exception.* != null) return null;
                if (!Valid.pathBuffer(buffer, ctx, exception)) return null;

                arguments.protectEat();
                return PathLike{ .buffer = buffer };
            },

            JSC.JSValue.JSType.ArrayBuffer => {
                const buffer = Buffer.fromArrayBuffer(ctx, arg, exception);
                if (exception.* != null) return null;
                if (!Valid.pathBuffer(buffer, ctx, exception)) return null;

                arguments.protectEat();

                return PathLike{ .buffer = buffer };
            },

            JSC.JSValue.JSType.String,
            JSC.JSValue.JSType.StringObject,
            JSC.JSValue.JSType.DerivedStringObject,
            => {
                var zig_str = arg.toSlice(ctx, allocator);

                if (!Valid.pathSlice(zig_str, ctx, exception)) {
                    zig_str.deinit();
                    return null;
                }

                arguments.eat();
                arg.ensureStillAlive();

                return PathLike{ .string = PathString.init(zig_str.slice()) };
            },
            else => {
                if (arg.as(JSC.DOMURL)) |domurl| {
                    var zig_str = domurl.pathname();
                    if (!Valid.pathString(zig_str, ctx, exception)) return null;

                    arguments.protectEat();

                    if (zig_str.is16Bit()) {
                        var printed = std.mem.span(std.fmt.allocPrintZ(arguments.arena.allocator(), "{}", .{zig_str}) catch unreachable);
                        return PathLike{ .string = PathString.init(printed.ptr[0 .. printed.len + 1]) };
                    }

                    return PathLike{ .string = PathString.init(zig_str.slice()) };
                }

                return null;
            },
        }
    }
};

pub const Valid = struct {
    pub fn fileDescriptor(fd: bun.FileDescriptor, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) bool {
        if (fd < 0) {
            JSC.throwInvalidArguments("Invalid file descriptor, must not be negative number", .{}, ctx, exception);
            return false;
        }

        return true;
    }

    pub fn pathSlice(zig_str: JSC.ZigString.Slice, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) bool {
        switch (zig_str.len) {
            0 => {
                JSC.throwInvalidArguments("Invalid path string: can't be empty", .{}, ctx, exception);
                return false;
            },
            1...bun.MAX_PATH_BYTES => return true,
            else => {
                // TODO: should this be an EINVAL?
                JSC.throwInvalidArguments(
                    comptime std.fmt.comptimePrint("Invalid path string: path is too long (max: {d})", .{bun.MAX_PATH_BYTES}),
                    .{},
                    ctx,
                    exception,
                );
                return false;
            },
        }

        unreachable;
    }

    pub fn pathString(zig_str: JSC.ZigString, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) bool {
        switch (zig_str.len) {
            0 => {
                JSC.throwInvalidArguments("Invalid path string: can't be empty", .{}, ctx, exception);
                return false;
            },
            1...bun.MAX_PATH_BYTES => return true,
            else => {
                // TODO: should this be an EINVAL?
                JSC.throwInvalidArguments(
                    comptime std.fmt.comptimePrint("Invalid path string: path is too long (max: {d})", .{bun.MAX_PATH_BYTES}),
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
                JSC.throwInvalidArguments("Invalid path buffer: can't be empty", .{}, ctx, exception);
                return false;
            },

            else => {

                // TODO: should this be an EINVAL?
                JSC.throwInvalidArguments(
                    comptime std.fmt.comptimePrint("Invalid path buffer: path is too long (max: {d})", .{bun.MAX_PATH_BYTES}),
                    .{},
                    ctx,
                    exception,
                );
                return false;
            },
            1...bun.MAX_PATH_BYTES => return true,
        }

        unreachable;
    }
};

pub const ArgumentsSlice = struct {
    remaining: []const JSC.JSValue,
    vm: *JSC.VirtualMachine,
    arena: std.heap.ArenaAllocator = std.heap.ArenaAllocator.init(bun.default_allocator),
    all: []const JSC.JSValue,
    threw: bool = false,
    protected: std.bit_set.IntegerBitSet(32) = std.bit_set.IntegerBitSet(32).initEmpty(),

    pub fn unprotect(this: *ArgumentsSlice) void {
        var iter = this.protected.iterator(.{});
        var ctx = this.vm.global;
        while (iter.next()) |i| {
            JSC.C.JSValueUnprotect(ctx, this.all[i].asObjectRef());
        }
        this.protected = std.bit_set.IntegerBitSet(32).initEmpty();
    }

    pub fn deinit(this: *ArgumentsSlice) void {
        this.unprotect();
        this.arena.deinit();
    }

    pub fn protectEat(this: *ArgumentsSlice) void {
        if (this.remaining.len == 0) return;
        const index = this.all.len - this.remaining.len;
        this.protected.set(index);
        JSC.C.JSValueProtect(this.vm.global, this.all[index].asObjectRef());
        this.eat();
    }

    pub fn protectEatNext(this: *ArgumentsSlice) ?JSC.JSValue {
        if (this.remaining.len == 0) return null;
        return this.nextEat();
    }

    pub fn from(vm: *JSC.VirtualMachine, arguments: []const JSC.JSValueRef) ArgumentsSlice {
        return init(vm, @ptrCast([*]const JSC.JSValue, arguments.ptr)[0..arguments.len]);
    }
    pub fn init(vm: *JSC.VirtualMachine, arguments: []const JSC.JSValue) ArgumentsSlice {
        return ArgumentsSlice{
            .remaining = arguments,
            .vm = vm,
            .all = arguments,
            .arena = std.heap.ArenaAllocator.init(vm.allocator),
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

    pub fn nextEat(this: *ArgumentsSlice) ?JSC.JSValue {
        if (this.remaining.len == 0) {
            return null;
        }
        defer this.eat();
        return this.remaining[0];
    }
};

pub fn fileDescriptorFromJS(ctx: JSC.C.JSContextRef, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?bun.FileDescriptor {
    if (!value.isNumber() or value.isBigInt()) return null;
    const fd = value.toInt32();
    if (!Valid.fileDescriptor(fd, ctx, exception)) {
        return null;
    }

    return @truncate(bun.FileDescriptor, fd);
}

var _get_time_prop_string: ?JSC.C.JSStringRef = null;
pub fn timeLikeFromJS(ctx: JSC.C.JSContextRef, value_: JSC.JSValue, exception: JSC.C.ExceptionRef) ?TimeLike {
    var value = value_;
    if (JSC.C.JSValueIsDate(ctx, value.asObjectRef())) {
        // TODO: make this faster
        var get_time_prop = _get_time_prop_string orelse brk: {
            var str = JSC.C.JSStringCreateStatic("getTime", "getTime".len);
            _get_time_prop_string = str;
            break :brk str;
        };

        var getTimeFunction = JSC.C.JSObjectGetProperty(ctx, value.asObjectRef(), get_time_prop, exception);
        if (exception.* != null) return null;
        value = JSC.JSValue.fromRef(JSC.C.JSObjectCallAsFunction(ctx, getTimeFunction, value.asObjectRef(), 0, null, exception) orelse return null);
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
        @truncate(Mode, value.to(Mode))
    else brk: {
        if (value.isUndefinedOrNull()) return null;

        //        An easier method of constructing the mode is to use a sequence of
        //        three octal digits (e.g. 765). The left-most digit (7 in the example),
        //        specifies the permissions for the file owner. The middle digit (6 in
        //        the example), specifies permissions for the group. The right-most
        //        digit (5 in the example), specifies the permissions for others.

        var zig_str = JSC.ZigString.init("");
        value.toZigString(&zig_str, ctx.ptr());
        var slice = zig_str.slice();
        if (strings.hasPrefix(slice, "0o")) {
            slice = slice[2..];
        }

        break :brk std.fmt.parseInt(Mode, slice, 8) catch {
            JSC.throwInvalidArguments("Invalid mode string: must be an octal number", .{}, ctx, exception);
            return null;
        };
    };

    if (mode_int < 0 or mode_int > 0o777) {
        JSC.throwInvalidArguments("Invalid mode: must be an octal number", .{}, ctx, exception);
        return null;
    }

    return mode_int;
}

pub const PathOrFileDescriptor = union(Tag) {
    path: PathLike,
    fd: bun.FileDescriptor,

    pub const Tag = enum { fd, path };

    pub fn hash(this: JSC.Node.PathOrFileDescriptor) u64 {
        return switch (this) {
            .path => std.hash.Wyhash.hash(0, this.path.slice()),
            .fd => std.hash.Wyhash.hash(0, std.mem.asBytes(&this.fd)),
        };
    }

    pub fn format(this: JSC.Node.PathOrFileDescriptor, comptime fmt: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (fmt.len != 0 and fmt != "s") {
            @compileError("Unsupported format argument: '" ++ fmt ++ "'.");
        }
        switch (this) {
            .path => |p| try writer.writeAll(p.slice()),
            .fd => |fd| try writer.print("{d}", .{fd}),
        }
    }

    pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, allocator: std.mem.Allocator, exception: JSC.C.ExceptionRef) ?JSC.Node.PathOrFileDescriptor {
        const first = arguments.next() orelse return null;

        if (fileDescriptorFromJS(ctx, first, exception)) |fd| {
            arguments.eat();
            return JSC.Node.PathOrFileDescriptor{ .fd = fd };
        }

        if (exception.* != null) return null;

        return JSC.Node.PathOrFileDescriptor{ .path = PathLike.fromJSWithAllocator(ctx, arguments, allocator, exception) orelse return null };
    }

    pub fn toJS(this: JSC.Node.PathOrFileDescriptor, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return switch (this) {
            .path => this.path.toJS(ctx, exception),
            .fd => JSC.JSValue.jsNumberFromInt32(@intCast(i32, this.fd)).asRef(),
        };
    }
};

pub const FileSystemFlags = enum(Mode) {
    /// Open file for appending. The file is created if it does not exist.
    @"a" = std.os.O.APPEND | std.os.O.WRONLY | std.os.O.CREAT,
    /// Like 'a' but fails if the path exists.
    // @"ax" = std.os.O.APPEND | std.os.O.EXCL,
    /// Open file for reading and appending. The file is created if it does not exist.
    // @"a+" = std.os.O.APPEND | std.os.O.RDWR,
    /// Like 'a+' but fails if the path exists.
    // @"ax+" = std.os.O.APPEND | std.os.O.RDWR | std.os.O.EXCL,
    /// Open file for appending in synchronous mode. The file is created if it does not exist.
    // @"as" = std.os.O.APPEND,
    /// Open file for reading and appending in synchronous mode. The file is created if it does not exist.
    // @"as+" = std.os.O.APPEND | std.os.O.RDWR,
    /// Open file for reading. An exception occurs if the file does not exist.
    @"r" = std.os.O.RDONLY,
    /// Open file for reading and writing. An exception occurs if the file does not exist.
    // @"r+" = std.os.O.RDWR,
    /// Open file for reading and writing in synchronous mode. Instructs the operating system to bypass the local file system cache.
    /// This is primarily useful for opening files on NFS mounts as it allows skipping the potentially stale local cache. It has a very real impact on I/O performance so using this flag is not recommended unless it is needed.
    /// This doesn't turn fs.open() or fsPromises.open() into a synchronous blocking call. If synchronous operation is desired, something like fs.openSync() should be used.
    // @"rs+" = std.os.O.RDWR,
    /// Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
    @"w" = std.os.O.WRONLY | std.os.O.CREAT,
    /// Like 'w' but fails if the path exists.
    // @"wx" = std.os.O.WRONLY | std.os.O.TRUNC,
    // ///  Open file for reading and writing. The file is created (if it does not exist) or truncated (if it exists).
    // @"w+" = std.os.O.RDWR | std.os.O.CREAT,
    // ///  Like 'w+' but fails if the path exists.
    // @"wx+" = std.os.O.RDWR | std.os.O.EXCL,

    _,

    const O_RDONLY: Mode = std.os.O.RDONLY;
    const O_RDWR: Mode = std.os.O.RDWR;
    const O_APPEND: Mode = std.os.O.APPEND;
    const O_CREAT: Mode = std.os.O.CREAT;
    const O_WRONLY: Mode = std.os.O.WRONLY;
    const O_EXCL: Mode = std.os.O.EXCL;
    const O_SYNC: Mode = 0;
    const O_TRUNC: Mode = std.os.O.TRUNC;

    pub fn fromJS(ctx: JSC.C.JSContextRef, val: JSC.JSValue, exception: JSC.C.ExceptionRef) ?FileSystemFlags {
        if (val.isUndefinedOrNull()) {
            return @intToEnum(FileSystemFlags, O_RDONLY);
        }

        if (val.isNumber()) {
            const number = val.toInt32();
            if (!(number > 0o000 and number < 0o777)) {
                JSC.throwInvalidArguments(
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
            val.toZigString(&zig_str, ctx.ptr());

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
                    JSC.throwInvalidArguments(
                        "Invalid flag: string can't be empty",
                        .{},
                        ctx,
                        exception,
                    );
                    return null;
                },
                else => {
                    JSC.throwInvalidArguments(
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

/// Milliseconds precision
pub const Date = enum(u64) {
    _,

    pub fn toJS(this: Date, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        const seconds = @floatCast(f64, @intToFloat(f128, @enumToInt(this)) * 1000.0);
        const unix_timestamp = JSC.C.JSValueMakeNumber(ctx, seconds);
        const array: [1]JSC.C.JSValueRef = .{unix_timestamp};
        const obj = JSC.C.JSObjectMakeDate(ctx, 1, &array, exception);
        return obj;
    }
};

fn StatsLike(comptime name: [:0]const u8, comptime T: type) type {
    return struct {
        const This = @This();

        pub const Class = JSC.NewClass(
            This,
            .{ .name = name },
            .{
                .isBlockDevice = .{
                    .rfn = JSC.wrap(This, "isBlockDevice", false),
                },
                .isCharacterDevice = .{
                    .rfn = JSC.wrap(This, "isCharacterDevice", false),
                },
                .isDirectory = .{
                    .rfn = JSC.wrap(This, "isDirectory", false),
                },
                .isFIFO = .{
                    .rfn = JSC.wrap(This, "isFIFO", false),
                },
                .isFile = .{
                    .rfn = JSC.wrap(This, "isFile", false),
                },
                .isSocket = .{
                    .rfn = JSC.wrap(This, "isSocket", false),
                },
                .isSymbolicLink = .{
                    .rfn = JSC.wrap(This, "isSymbolicLink", false),
                },
                .finalize = finalize,
            },
            .{
                .dev = .{
                    .get = JSC.To.JS.Getter(This, .dev),
                    .name = "dev",
                },
                .ino = .{
                    .get = JSC.To.JS.Getter(This, .ino),
                    .name = "ino",
                },
                .mode = .{
                    .get = JSC.To.JS.Getter(This, .mode),
                    .name = "mode",
                },
                .nlink = .{
                    .get = JSC.To.JS.Getter(This, .nlink),
                    .name = "nlink",
                },
                .uid = .{
                    .get = JSC.To.JS.Getter(This, .uid),
                    .name = "uid",
                },
                .gid = .{
                    .get = JSC.To.JS.Getter(This, .gid),
                    .name = "gid",
                },
                .rdev = .{
                    .get = JSC.To.JS.Getter(This, .rdev),
                    .name = "rdev",
                },
                .size = .{
                    .get = JSC.To.JS.Getter(This, .size),
                    .name = "size",
                },
                .blksize = .{
                    .get = JSC.To.JS.Getter(This, .blksize),
                    .name = "blksize",
                },
                .blocks = .{
                    .get = JSC.To.JS.Getter(This, .blocks),
                    .name = "blocks",
                },
                .atime = .{
                    .get = JSC.To.JS.Getter(This, .atime),
                    .name = "atime",
                },
                .mtime = .{
                    .get = JSC.To.JS.Getter(This, .mtime),
                    .name = "mtime",
                },
                .ctime = .{
                    .get = JSC.To.JS.Getter(This, .ctime),
                    .name = "ctime",
                },
                .birthtime = .{
                    .get = JSC.To.JS.Getter(This, .birthtime),
                    .name = "birthtime",
                },
                .atime_ms = .{
                    .get = JSC.To.JS.Getter(This, .atime_ms),
                    .name = "atimeMs",
                },
                .mtime_ms = .{
                    .get = JSC.To.JS.Getter(This, .mtime_ms),
                    .name = "mtimeMs",
                },
                .ctime_ms = .{
                    .get = JSC.To.JS.Getter(This, .ctime_ms),
                    .name = "ctimeMs",
                },
                .birthtime_ms = .{
                    .get = JSC.To.JS.Getter(This, .birthtime_ms),
                    .name = "birthtimeMs",
                },
            },
        );

        dev: T,
        ino: T,
        mode: T,
        nlink: T,
        uid: T,
        gid: T,
        rdev: T,
        size: T,
        blksize: T,
        blocks: T,
        atime_ms: T,
        mtime_ms: T,
        ctime_ms: T,
        birthtime_ms: T,
        atime: Date,
        mtime: Date,
        ctime: Date,
        birthtime: Date,

        pub fn init(stat_: os.Stat) @This() {
            const atime = stat_.atime();
            const mtime = stat_.mtime();
            const ctime = stat_.ctime();
            return @This(){
                .dev = @truncate(T, @intCast(i64, stat_.dev)),
                .ino = @truncate(T, @intCast(i64, stat_.ino)),
                .mode = @truncate(T, @intCast(i64, stat_.mode)),
                .nlink = @truncate(T, @intCast(i64, stat_.nlink)),
                .uid = @truncate(T, @intCast(i64, stat_.uid)),
                .gid = @truncate(T, @intCast(i64, stat_.gid)),
                .rdev = @truncate(T, @intCast(i64, stat_.rdev)),
                .size = @truncate(T, @intCast(i64, stat_.size)),
                .blksize = @truncate(T, @intCast(i64, stat_.blksize)),
                .blocks = @truncate(T, @intCast(i64, stat_.blocks)),
                .atime_ms = @truncate(T, @intCast(i64, if (atime.tv_nsec > 0) (@intCast(usize, atime.tv_nsec) / std.time.ns_per_ms) else 0)),
                .mtime_ms = @truncate(T, @intCast(i64, if (mtime.tv_nsec > 0) (@intCast(usize, mtime.tv_nsec) / std.time.ns_per_ms) else 0)),
                .ctime_ms = @truncate(T, @intCast(i64, if (ctime.tv_nsec > 0) (@intCast(usize, ctime.tv_nsec) / std.time.ns_per_ms) else 0)),
                .atime = @intToEnum(Date, @intCast(u64, @maximum(atime.tv_sec, 0))),
                .mtime = @intToEnum(Date, @intCast(u64, @maximum(mtime.tv_sec, 0))),
                .ctime = @intToEnum(Date, @intCast(u64, @maximum(ctime.tv_sec, 0))),

                // Linux doesn't include this info in stat
                // maybe it does in statx, but do you really need birthtime? If you do please file an issue.
                .birthtime_ms = if (Environment.isLinux)
                    0
                else
                    @truncate(T, @intCast(i64, if (stat_.birthtime().tv_nsec > 0) (@intCast(usize, stat_.birthtime().tv_nsec) / std.time.ns_per_ms) else 0)),

                .birthtime = if (Environment.isLinux)
                    @intToEnum(Date, 0)
                else
                    @intToEnum(Date, @intCast(u64, @maximum(stat_.birthtime().tv_sec, 0))),
            };
        }

        pub fn isBlockDevice(this: *Stats) JSC.JSValue {
            return JSC.JSValue.jsBoolean(os.S.ISBLK(@intCast(Mode, this.mode)));
        }

        pub fn isCharacterDevice(this: *Stats) JSC.JSValue {
            return JSC.JSValue.jsBoolean(os.S.ISCHR(@intCast(Mode, this.mode)));
        }

        pub fn isDirectory(this: *Stats) JSC.JSValue {
            return JSC.JSValue.jsBoolean(os.S.ISDIR(@intCast(Mode, this.mode)));
        }

        pub fn isFIFO(this: *Stats) JSC.JSValue {
            return JSC.JSValue.jsBoolean(os.S.ISFIFO(@intCast(Mode, this.mode)));
        }

        pub fn isFile(this: *Stats) JSC.JSValue {
            return JSC.JSValue.jsBoolean(os.S.ISREG(@intCast(Mode, this.mode)));
        }

        pub fn isSocket(this: *Stats) JSC.JSValue {
            return JSC.JSValue.jsBoolean(os.S.ISSOCK(@intCast(Mode, this.mode)));
        }

        // Node.js says this method is only valid on the result of lstat()
        // so it's fine if we just include it on stat() because it would
        // still just return false.
        //
        // See https://nodejs.org/api/fs.html#statsissymboliclink
        pub fn isSymbolicLink(this: *Stats) JSC.JSValue {
            return JSC.JSValue.jsBoolean(os.S.ISLNK(@intCast(Mode, this.mode)));
        }

        pub fn toJS(this: Stats, ctx: JSC.C.JSContextRef, _: JSC.C.ExceptionRef) JSC.C.JSValueRef {
            var _this = bun.default_allocator.create(Stats) catch unreachable;
            _this.* = this;
            return Class.make(ctx, _this);
        }

        pub fn finalize(this: *Stats) void {
            bun.default_allocator.destroy(this);
        }
    };
}

pub const Stats = StatsLike("Stats", i32);
pub const BigIntStats = StatsLike("BigIntStats", i64);

/// A class representing a directory stream.
///
/// Created by {@link opendir}, {@link opendirSync}, or `fsPromises.opendir()`.
///
/// ```js
/// import { opendir } from 'fs/promises';
///
/// try {
///   const dir = await opendir('./');
///   for await (const dirent of dir)
///     console.log(dirent.name);
/// } catch (err) {
///   console.error(err);
/// }
/// ```
///
/// When using the async iterator, the `fs.Dir` object will be automatically
/// closed after the iterator exits.
/// @since v12.12.0
pub const DirEnt = struct {
    name: PathString,
    // not publicly exposed
    kind: Kind,

    pub const Kind = std.fs.File.Kind;

    pub fn isBlockDevice(
        this: *DirEnt,
        ctx: JSC.C.JSContextRef,
        _: JSC.C.JSObjectRef,
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        return JSC.C.JSValueMakeBoolean(ctx, this.kind == std.fs.File.Kind.BlockDevice);
    }
    pub fn isCharacterDevice(
        this: *DirEnt,
        ctx: JSC.C.JSContextRef,
        _: JSC.C.JSObjectRef,
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        return JSC.C.JSValueMakeBoolean(ctx, this.kind == std.fs.File.Kind.CharacterDevice);
    }
    pub fn isDirectory(
        this: *DirEnt,
        ctx: JSC.C.JSContextRef,
        _: JSC.C.JSObjectRef,
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        return JSC.C.JSValueMakeBoolean(ctx, this.kind == std.fs.File.Kind.Directory);
    }
    pub fn isFIFO(
        this: *DirEnt,
        ctx: JSC.C.JSContextRef,
        _: JSC.C.JSObjectRef,
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        return JSC.C.JSValueMakeBoolean(ctx, this.kind == std.fs.File.Kind.NamedPipe or this.kind == std.fs.File.Kind.EventPort);
    }
    pub fn isFile(
        this: *DirEnt,
        ctx: JSC.C.JSContextRef,
        _: JSC.C.JSObjectRef,
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        return JSC.C.JSValueMakeBoolean(ctx, this.kind == std.fs.File.Kind.File);
    }
    pub fn isSocket(
        this: *DirEnt,
        ctx: JSC.C.JSContextRef,
        _: JSC.C.JSObjectRef,
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        return JSC.C.JSValueMakeBoolean(ctx, this.kind == std.fs.File.Kind.UnixDomainSocket);
    }
    pub fn isSymbolicLink(
        this: *DirEnt,
        ctx: JSC.C.JSContextRef,
        _: JSC.C.JSObjectRef,
        _: JSC.C.JSObjectRef,
        _: []const JSC.C.JSValueRef,
        _: JSC.C.ExceptionRef,
    ) JSC.C.JSValueRef {
        return JSC.C.JSValueMakeBoolean(ctx, this.kind == std.fs.File.Kind.SymLink);
    }

    pub const Class = JSC.NewClass(DirEnt, .{ .name = "DirEnt" }, .{
        .isBlockDevice = .{
            .name = "isBlockDevice",
            .rfn = isBlockDevice,
        },
        .isCharacterDevice = .{
            .name = "isCharacterDevice",
            .rfn = isCharacterDevice,
        },
        .isDirectory = .{
            .name = "isDirectory",
            .rfn = isDirectory,
        },
        .isFIFO = .{
            .name = "isFIFO",
            .rfn = isFIFO,
        },
        .isFile = .{
            .name = "isFile",
            .rfn = isFile,
        },
        .isSocket = .{
            .name = "isSocket",
            .rfn = isSocket,
        },
        .isSymbolicLink = .{
            .name = "isSymbolicLink",
            .rfn = isSymbolicLink,
        },
    }, .{
        .name = .{
            .get = JSC.To.JS.Getter(DirEnt, .name),
            .name = "name",
        },
    });

    pub fn finalize(this: *DirEnt) void {
        bun.default_allocator.free(this.name.slice());
        bun.default_allocator.destroy(this);
    }
};

pub const Emitter = struct {
    pub const Listener = struct {
        once: bool = false,
        callback: JSC.JSValue,

        pub const List = struct {
            pub const ArrayList = std.MultiArrayList(Listener);
            list: ArrayList = ArrayList{},
            once_count: u32 = 0,

            pub fn append(this: *List, allocator: std.mem.Allocator, ctx: JSC.C.JSContextRef, listener: Listener) !void {
                JSC.C.JSValueProtect(ctx, listener.callback.asObjectRef());
                try this.list.append(allocator, listener);
                this.once_count +|= @as(u32, @boolToInt(listener.once));
            }

            pub fn prepend(this: *List, allocator: std.mem.Allocator, ctx: JSC.C.JSContextRef, listener: Listener) !void {
                JSC.C.JSValueProtect(ctx, listener.callback.asObjectRef());
                try this.list.ensureUnusedCapacity(allocator, 1);
                this.list.insertAssumeCapacity(0, listener);
                this.once_count +|= @as(u32, @boolToInt(listener.once));
            }

            // removeListener() will remove, at most, one instance of a listener from the
            // listener array. If any single listener has been added multiple times to the
            // listener array for the specified eventName, then removeListener() must be
            // called multiple times to remove each instance.
            pub fn remove(this: *List, ctx: JSC.C.JSContextRef, callback: JSC.JSValue) bool {
                const callbacks = this.list.items(.callback);

                for (callbacks) |item, i| {
                    if (callback.eqlValue(item)) {
                        JSC.C.JSValueUnprotect(ctx, callback.asObjectRef());
                        this.once_count -|= @as(u32, @boolToInt(this.list.items(.once)[i]));
                        this.list.orderedRemove(i);
                        return true;
                    }
                }

                return false;
            }

            pub fn emit(this: *List, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) void {
                var i: usize = 0;
                outer: while (true) {
                    var slice = this.list.slice();
                    var callbacks = slice.items(.callback);
                    var once = slice.items(.once);
                    while (i < callbacks.len) : (i += 1) {
                        const callback = callbacks[i];

                        globalThis.enqueueMicrotask1(
                            callback,
                            value,
                        );

                        if (once[i]) {
                            this.once_count -= 1;
                            JSC.C.JSValueUnprotect(globalThis, callback.asObjectRef());
                            this.list.orderedRemove(i);
                            slice = this.list.slice();
                            callbacks = slice.items(.callback);
                            once = slice.items(.once);
                            continue :outer;
                        }
                    }

                    return;
                }
            }
        };
    };

    pub fn New(comptime EventType: type) type {
        return struct {
            const EventEmitter = @This();
            pub const Map = std.enums.EnumArray(EventType, Listener.List);
            listeners: Map = Map.initFill(Listener.List{}),

            pub fn addListener(this: *EventEmitter, ctx: JSC.C.JSContextRef, event: EventType, listener: Emitter.Listener) !void {
                try this.listeners.getPtr(event).append(bun.default_allocator, ctx, listener);
            }

            pub fn prependListener(this: *EventEmitter, ctx: JSC.C.JSContextRef, event: EventType, listener: Emitter.Listener) !void {
                try this.listeners.getPtr(event).prepend(bun.default_allocator, ctx, listener);
            }

            pub fn emit(this: *EventEmitter, event: EventType, globalThis: *JSC.JSGlobalObject, value: JSC.JSValue) void {
                this.listeners.getPtr(event).emit(globalThis, value);
            }

            pub fn removeListener(this: *EventEmitter, ctx: JSC.C.JSContextRef, event: EventType, callback: JSC.JSValue) bool {
                return this.listeners.getPtr(event).remove(ctx, callback);
            }
        };
    }
};

pub const Path = struct {
    pub const shim = Shimmer("Bun", "Path", @This());
    pub const name = "Bun__Path";
    pub const include = "Path.h";
    pub const namespace = shim.namespace;
    const PathHandler = @import("../../resolver/resolve_path.zig");
    const StringBuilder = @import("../../string_builder.zig");
    pub const code = @embedFile("../path.exports.js");

    pub fn create(globalObject: *JSC.JSGlobalObject, isWindows: bool) callconv(.C) JSC.JSValue {
        return shim.cppFn("create", .{ globalObject, isWindows });
    }

    pub fn basename(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0) {
            return JSC.toInvalidArguments("path is required", .{}, globalThis);
        }
        var stack_fallback = std.heap.stackFallback(4096, JSC.getAllocator(globalThis));
        var allocator = stack_fallback.get();

        var arguments: []JSC.JSValue = args_ptr[0..args_len];
        var path = arguments[0].toSlice(globalThis, allocator);

        defer path.deinit();
        var extname_ = if (args_len > 1) arguments[1].toSlice(globalThis, allocator) else JSC.ZigString.Slice.empty;
        defer extname_.deinit();

        var base_slice = path.slice();
        var out: []const u8 = base_slice;

        if (!isWindows) {
            out = std.fs.path.basenamePosix(base_slice);
        } else {
            out = std.fs.path.basenameWindows(base_slice);
        }
        const ext = extname_.slice();

        if ((ext.len != out.len or out.len == base_slice.len) and strings.endsWith(out, ext)) {
            out = out[0 .. out.len - ext.len];
        }

        return JSC.ZigString.init(out).withEncoding().toValueGC(globalThis);
    }
    pub fn dirname(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0) {
            return JSC.toInvalidArguments("path is required", .{}, globalThis);
        }
        var stack_fallback = std.heap.stackFallback(4096, JSC.getAllocator(globalThis));
        var allocator = stack_fallback.get();

        var arguments: []JSC.JSValue = args_ptr[0..args_len];
        var path = arguments[0].toSlice(globalThis, allocator);
        defer path.deinit();

        const base_slice = path.slice();

        const out = if (!isWindows)
            std.fs.path.dirnameWindows(base_slice) orelse "C:\\"
        else
            std.fs.path.dirnamePosix(base_slice) orelse "/";

        return JSC.ZigString.init(out).toValueGC(globalThis);
    }
    pub fn extname(globalThis: *JSC.JSGlobalObject, _: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0) {
            return JSC.toInvalidArguments("path is required", .{}, globalThis);
        }
        var stack_fallback = std.heap.stackFallback(4096, JSC.getAllocator(globalThis));
        var allocator = stack_fallback.get();
        var arguments: []JSC.JSValue = args_ptr[0..args_len];

        var path = arguments[0].toSlice(globalThis, allocator);
        defer path.deinit();

        const base_slice = path.slice();

        return JSC.ZigString.init(std.fs.path.extension(base_slice)).toValueGC(globalThis);
    }
    pub fn format(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0) {
            return JSC.toInvalidArguments("pathObject is required", .{}, globalThis);
        }
        var path_object: JSC.JSValue = args_ptr[0];
        const js_type = path_object.jsType();
        if (!js_type.isObject()) {
            return JSC.toInvalidArguments("pathObject is required", .{}, globalThis);
        }

        var stack_fallback = std.heap.stackFallback(4096, JSC.getAllocator(globalThis));
        var allocator = stack_fallback.get();
        var dir = JSC.ZigString.Empty;
        var name_ = JSC.ZigString.Empty;
        var ext = JSC.ZigString.Empty;
        var name_with_ext = JSC.ZigString.Empty;

        var insert_separator = true;
        if (path_object.get(globalThis, "dir")) |prop| {
            prop.toZigString(&dir, globalThis);
            insert_separator = !dir.isEmpty();
        } else if (path_object.get(globalThis, "root")) |prop| {
            prop.toZigString(&dir, globalThis);
        }

        if (path_object.get(globalThis, "base")) |prop| {
            prop.toZigString(&name_with_ext, globalThis);
        } else {
            var had_ext = false;
            if (path_object.get(globalThis, "ext")) |prop| {
                prop.toZigString(&ext, globalThis);
                had_ext = !ext.isEmpty();
            }

            if (path_object.get(globalThis, "name")) |prop| {
                if (had_ext) {
                    prop.toZigString(&name_, globalThis);
                } else {
                    prop.toZigString(&name_with_ext, globalThis);
                }
            }
        }

        if (dir.isEmpty()) {
            if (!name_with_ext.isEmpty()) {
                return name_with_ext.toValueAuto(globalThis);
            }

            if (name_.isEmpty()) {
                return JSC.ZigString.Empty.toValue(globalThis);
            }

            const out = std.fmt.allocPrint(allocator, "{s}{s}", .{ name_, ext }) catch unreachable;
            defer allocator.free(out);

            return JSC.ZigString.init(out).withEncoding().toValueGC(globalThis);
        }

        if (insert_separator) {
            const separator = if (!isWindows) "/" else "\\";
            if (name_with_ext.isEmpty()) {
                const out = std.fmt.allocPrint(allocator, "{}{s}{}{}", .{ dir, separator, name_, ext }) catch unreachable;
                defer allocator.free(out);
                return JSC.ZigString.init(out).withEncoding().toValueGC(globalThis);
            }

            {
                const out = std.fmt.allocPrint(allocator, "{}{s}{}", .{
                    dir,
                    separator,
                    name_with_ext,
                }) catch unreachable;
                defer allocator.free(out);
                return JSC.ZigString.init(out).withEncoding().toValueGC(globalThis);
            }
        }

        if (name_with_ext.isEmpty()) {
            const out = std.fmt.allocPrint(allocator, "{}{}{}", .{ dir, name_, ext }) catch unreachable;
            defer allocator.free(out);
            return JSC.ZigString.init(out).withEncoding().toValueGC(globalThis);
        }

        {
            const out = std.fmt.allocPrint(allocator, "{}{}", .{
                dir,
                name_with_ext,
            }) catch unreachable;
            defer allocator.free(out);
            return JSC.ZigString.init(out).withEncoding().toValueGC(globalThis);
        }
    }
    fn isAbsoluteString(path: JSC.ZigString, windows: bool) bool {
        if (!windows) return path.len > 0 and path.slice()[0] == '/';

        return isZigStringAbsoluteWindows(path);
    }
    pub fn isAbsolute(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0) return JSC.JSValue.jsBoolean(false);
        var zig_str: JSC.ZigString = args_ptr[0].getZigString(globalThis);
        if (zig_str.isEmpty()) return JSC.JSValue.jsBoolean(false);
        return JSC.JSValue.jsBoolean(isAbsoluteString(zig_str, isWindows));
    }
    fn isZigStringAbsoluteWindows(zig_str: JSC.ZigString) bool {
        if (zig_str.is16Bit()) {
            var buf = [4]u16{ 0, 0, 0, 0 };
            var u16_slice = zig_str.utf16Slice();

            buf[0] = u16_slice[0];
            if (u16_slice.len > 1)
                buf[1] = u16_slice[1];

            if (u16_slice.len > 2)
                buf[2] = u16_slice[2];

            if (u16_slice.len > 3)
                buf[3] = u16_slice[3];

            return std.fs.path.isAbsoluteWindowsWTF16(buf[0..@minimum(u16_slice.len, buf.len)]);
        }

        return std.fs.path.isAbsoluteWindows(zig_str.slice());
    }
    pub fn join(
        globalThis: *JSC.JSGlobalObject,
        isWindows: bool,
        args_ptr: [*]JSC.JSValue,
        args_len: u16,
    ) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0) return JSC.ZigString.init("").toValue(globalThis);

        var stack_fallback_allocator = std.heap.stackFallback(
            (32 * @sizeOf(string)),
            heap_allocator,
        );
        var allocator = stack_fallback_allocator.get();
        var arena = std.heap.ArenaAllocator.init(heap_allocator);
        var arena_allocator = arena.allocator();
        defer arena.deinit();
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var to_join = allocator.alloc(string, args_len) catch unreachable;
        var possibly_utf16 = false;
        for (args_ptr[0..args_len]) |arg, i| {
            const zig_str: JSC.ZigString = arg.getZigString(globalThis);
            if (zig_str.is16Bit()) {
                // TODO: remove this string conversion
                to_join[i] = zig_str.toSlice(arena_allocator).slice();
                possibly_utf16 = true;
            } else {
                to_join[i] = zig_str.slice();
            }
        }

        const out = if (!isWindows)
            PathHandler.joinStringBuf(&buf, to_join, .posix)
        else
            PathHandler.joinStringBuf(&buf, to_join, .windows);

        var out_str = JSC.ZigString.init(out);
        if (possibly_utf16) {
            out_str.setOutputEncoding();
        }

        return out_str.toValueGC(globalThis);
    }
    pub fn normalize(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0) return JSC.ZigString.init("").toValue(globalThis);

        var zig_str: JSC.ZigString = args_ptr[0].getZigString(globalThis);
        if (zig_str.len == 0) return JSC.ZigString.init("").toValue(globalThis);

        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var str_slice = zig_str.toSlice(heap_allocator);
        defer str_slice.deinit();
        var str = str_slice.slice();

        const out = if (!isWindows)
            PathHandler.normalizeStringNode(str, &buf, .posix)
        else
            PathHandler.normalizeStringNode(str, &buf, .windows);

        var out_str = JSC.ZigString.init(out);
        if (str_slice.isAllocated()) out_str.setOutputEncoding();
        return out_str.toValueGC(globalThis);
    }
    pub fn parse(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0 or !args_ptr[0].jsType().isStringLike()) {
            return JSC.toInvalidArguments("path string is required", .{}, globalThis);
        }
        var path_slice: JSC.ZigString.Slice = args_ptr[0].toSlice(globalThis, heap_allocator);
        defer path_slice.deinit();
        var path = path_slice.slice();
        var path_name = Fs.PathName.init(path);
        var root = JSC.ZigString.init(path_name.dir);
        const is_absolute = (isWindows and isZigStringAbsoluteWindows(root)) or (!isWindows and path_name.dir.len > 0 and path_name.dir[0] == '/');

        var dir = JSC.ZigString.init(path_name.dir);
        if (is_absolute) {
            root = JSC.ZigString.Empty;
            if (path_name.dir.len == 0)
                dir = JSC.ZigString.init(if (isWindows) std.fs.path.sep_str_windows else std.fs.path.sep_str_posix);
        }

        var base = JSC.ZigString.init(path_name.base);
        var name_ = JSC.ZigString.init(path_name.filename);
        var ext = JSC.ZigString.init(path_name.ext);
        dir.setOutputEncoding();
        root.setOutputEncoding();
        base.setOutputEncoding();
        name_.setOutputEncoding();
        ext.setOutputEncoding();
        var entries = [10]JSC.ZigString{
            JSC.ZigString.init("dir"),
            JSC.ZigString.init("root"),
            JSC.ZigString.init("base"),
            JSC.ZigString.init("name"),
            JSC.ZigString.init("ext"),
            dir,
            root,
            base,
            name_,
            ext,
        };

        var keys: []JSC.ZigString = entries[0..5];
        var values: []JSC.ZigString = entries[5..10];
        return JSC.JSValue.fromEntries(globalThis, keys.ptr, values.ptr, 5, true);
    }
    pub fn relative(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        var arguments = args_ptr[0..args_len];

        if (args_len > 1 and JSC.JSValue.eqlValue(args_ptr[0], args_ptr[1]))
            return JSC.ZigString.init("").toValue(globalThis);

        var from_slice: JSC.ZigString.Slice = if (args_len > 0) arguments[0].toSlice(globalThis, heap_allocator) else JSC.ZigString.Slice.empty;
        defer from_slice.deinit();
        var to_slice: JSC.ZigString.Slice = if (args_len > 1) arguments[1].toSlice(globalThis, heap_allocator) else JSC.ZigString.Slice.empty;
        defer to_slice.deinit();

        var from = from_slice.slice();
        var to = to_slice.slice();

        var out = if (!isWindows)
            PathHandler.relativePlatform(from, to, .posix, true)
        else
            PathHandler.relativePlatform(from, to, .windows, true);

        var out_str = JSC.ZigString.init(out);
        if (from_slice.isAllocated() or to_slice.isAllocated()) out_str.setOutputEncoding();
        return out_str.toValueGC(globalThis);
    }

    pub fn resolve(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var stack_fallback_allocator = std.heap.stackFallback(
            (32 * @sizeOf(string)),
            heap_allocator,
        );
        var allocator = stack_fallback_allocator.get();
        var out_buf: [bun.MAX_PATH_BYTES * 2]u8 = undefined;

        var parts = allocator.alloc(string, args_len) catch unreachable;
        defer allocator.free(parts);

        var arena = std.heap.ArenaAllocator.init(heap_allocator);
        var arena_allocator = arena.allocator();
        defer arena.deinit();

        var i: u16 = 0;
        while (i < args_len) : (i += 1) {
            parts[i] = args_ptr[i].toSlice(globalThis, arena_allocator).slice();
        }

        var out: JSC.ZigString = if (!isWindows)
            JSC.ZigString.init(PathHandler.joinAbsStringBuf(Fs.FileSystem.instance.top_level_dir, &out_buf, parts, .posix))
        else
            JSC.ZigString.init(PathHandler.joinAbsStringBuf(Fs.FileSystem.instance.top_level_dir, &out_buf, parts, .windows));

        out.len = strings.withoutTrailingSlash(out.slice()).len;

        if (arena.state.buffer_list.first != null)
            out.setOutputEncoding();

        return out.toValueGC(globalThis);
    }

    pub const Export = shim.exportFunctions(.{
        .@"basename" = basename,
        .@"dirname" = dirname,
        .@"extname" = extname,
        .@"format" = format,
        .@"isAbsolute" = isAbsolute,
        .@"join" = join,
        .@"normalize" = normalize,
        .@"parse" = parse,
        .@"relative" = relative,
        .@"resolve" = resolve,
    });

    pub const Extern = [_][]const u8{"create"};

    comptime {
        if (!is_bindgen) {
            @export(Path.basename, .{
                .name = Export[0].symbol_name,
            });
            @export(Path.dirname, .{
                .name = Export[1].symbol_name,
            });
            @export(Path.extname, .{
                .name = Export[2].symbol_name,
            });
            @export(Path.format, .{
                .name = Export[3].symbol_name,
            });
            @export(Path.isAbsolute, .{
                .name = Export[4].symbol_name,
            });
            @export(Path.join, .{
                .name = Export[5].symbol_name,
            });
            @export(Path.normalize, .{
                .name = Export[6].symbol_name,
            });
            @export(Path.parse, .{
                .name = Export[7].symbol_name,
            });
            @export(Path.relative, .{
                .name = Export[8].symbol_name,
            });
            @export(Path.resolve, .{
                .name = Export[9].symbol_name,
            });
        }
    }
};

pub const Process = struct {
    pub fn getArgv(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        var vm = globalObject.bunVM();

        // Allocate up to 32 strings in stack
        var stack_fallback_allocator = std.heap.stackFallback(
            32 * @sizeOf(JSC.ZigString) + (bun.MAX_PATH_BYTES + 1) + 32,
            heap_allocator,
        );
        var allocator = stack_fallback_allocator.get();

        var args = allocator.alloc(
            JSC.ZigString,
            // argv omits "bun" because it could be "bun run" or "bun" and it's kind of ambiguous
            // argv also omits the script name
            vm.argv.len + 2,
        ) catch unreachable;
        var args_list = std.ArrayListUnmanaged(JSC.ZigString){ .items = args, .capacity = args.len };
        args_list.items.len = 0;

        // get the bun executable
        // without paying the cost of a syscall to resolve the full path
        args_list.appendAssumeCapacity(
            JSC.ZigString.init(
                std.fs.selfExePathAlloc(allocator) catch "bun",
            ).withEncoding(),
        );

        if (vm.main.len > 0)
            args_list.appendAssumeCapacity(JSC.ZigString.init(vm.main).withEncoding());

        defer allocator.free(args);
        {
            for (vm.argv) |arg0| {
                const argv0 = JSC.ZigString.init(arg0).withEncoding();
                // https://github.com/yargs/yargs/blob/adb0d11e02c613af3d9427b3028cc192703a3869/lib/utils/process-argv.ts#L1
                args_list.appendAssumeCapacity(argv0);
            }
        }

        return JSC.JSValue.createStringArray(globalObject, args_list.items.ptr, args_list.items.len, true);
    }

    pub fn getCwd(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        var buffer: [bun.MAX_PATH_BYTES]u8 = undefined;
        switch (Syscall.getcwd(&buffer)) {
            .err => |err| {
                return err.toJSC(globalObject);
            },
            .result => |result| {
                var zig_str = JSC.ZigString.init(result);
                zig_str.setOutputEncoding();

                const value = zig_str.toValueGC(globalObject);

                return value;
            },
        }
    }
    pub fn setCwd(globalObject: *JSC.JSGlobalObject, to: *JSC.ZigString) callconv(.C) JSC.JSValue {
        if (to.len == 0) {
            return JSC.toInvalidArguments("path is required", .{}, globalObject.ref());
        }

        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        const slice = to.sliceZBuf(&buf) catch {
            return JSC.toInvalidArguments("Invalid path", .{}, globalObject.ref());
        };

        const result = Syscall.chdir(slice);

        switch (result) {
            .err => |err| {
                return err.toJSC(globalObject);
            },
            .result => {
                // When we update the cwd from JS, we have to update the bundler's version as well
                // However, this might be called many times in a row, so we use a pre-allocated buffer
                // that way we don't have to worry about garbage collector
                JSC.VirtualMachine.vm.bundler.fs.top_level_dir = std.os.getcwd(&JSC.VirtualMachine.vm.bundler.fs.top_level_dir_buf) catch {
                    _ = Syscall.chdir(std.meta.assumeSentinel(JSC.VirtualMachine.vm.bundler.fs.top_level_dir, 0));
                    return JSC.toInvalidArguments("Invalid path", .{}, globalObject.ref());
                };

                JSC.VirtualMachine.vm.bundler.fs.top_level_dir_buf[JSC.VirtualMachine.vm.bundler.fs.top_level_dir.len] = std.fs.path.sep;
                JSC.VirtualMachine.vm.bundler.fs.top_level_dir_buf[JSC.VirtualMachine.vm.bundler.fs.top_level_dir.len + 1] = 0;
                JSC.VirtualMachine.vm.bundler.fs.top_level_dir = JSC.VirtualMachine.vm.bundler.fs.top_level_dir_buf[0 .. JSC.VirtualMachine.vm.bundler.fs.top_level_dir.len + 1];

                return JSC.JSValue.jsUndefined();
            },
        }
    }

    pub fn exit(_: *JSC.JSGlobalObject, code: i32) callconv(.C) void {
        std.os.exit(@truncate(u8, @intCast(u32, @maximum(code, 0))));
    }

    pub export const Bun__version: [:0]const u8 = "v" ++ bun.Global.package_json_version;
    pub export const Bun__versions_mimalloc: [:0]const u8 = bun.Global.versions.mimalloc;
    pub export const Bun__versions_webkit: [:0]const u8 = bun.Global.versions.webkit;
    pub export const Bun__versions_libarchive: [:0]const u8 = bun.Global.versions.libarchive;
    pub export const Bun__versions_picohttpparser: [:0]const u8 = bun.Global.versions.picohttpparser;
    pub export const Bun__versions_boringssl: [:0]const u8 = bun.Global.versions.boringssl;
    pub export const Bun__versions_zlib: [:0]const u8 = bun.Global.versions.zlib;
    pub export const Bun__versions_zig: [:0]const u8 = bun.Global.versions.zig;
    pub export const Bun__version_sha: [:0]const u8 = bun.Environment.git_sha;
};

comptime {
    std.testing.refAllDecls(Process);
    std.testing.refAllDecls(Path);
}
