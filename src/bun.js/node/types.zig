const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
const strings = bun.strings;
const string = bun.string;
const AsyncIO = @import("root").bun.AsyncIO;
const JSC = @import("root").bun.JSC;
const PathString = JSC.PathString;
const Environment = bun.Environment;
const C = bun.C;
const Syscall = @import("./syscall.zig");
const os = std.os;
pub const Buffer = JSC.MarkedArrayBuffer;
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const logger = @import("root").bun.logger;
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
    var enumFields: [fieldInfos.len]std.builtin.Type.EnumField = undefined;
    var decls = [_]std.builtin.Type.Declaration{};
    inline for (fieldInfos, 0..) |field, i| {
        enumFields[i] = .{
            .name = field.name,
            .value = i,
        };
    }
    return @Type(.{
        .Enum = .{
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

                    if (comptime ReturnType == JSC.JSValue) {
                        return r;
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
                        return JSC.ZigString.init(bun.asByteSlice(r)).withEncoding().toValueAuto(globalThis);
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
                .err => |err| @as(os.E, @enumFromInt(err.errno)),
            };
        }

        pub inline fn errno(rc: anytype) ?@This() {
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .err = .{ .errno = @as(Syscall.Error.Int, @truncate(@intFromEnum(err))) },
                },
            };
        }

        pub inline fn errnoSys(rc: anytype, syscall: Syscall.Tag) ?@This() {
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .err = .{ .errno = @as(Syscall.Error.Int, @truncate(@intFromEnum(err))), .syscall = syscall },
                },
            };
        }

        pub inline fn errnoSysFd(rc: anytype, syscall: Syscall.Tag, fd: anytype) ?@This() {
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .err = .{
                        .errno = @as(Syscall.Error.Int, @truncate(@intFromEnum(err))),
                        .syscall = syscall,
                        .fd = @as(i32, @intCast(fd)),
                    },
                },
            };
        }

        pub inline fn errnoSysP(rc: anytype, syscall: Syscall.Tag, path: anytype) ?@This() {
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |err| @This(){
                    // always truncate
                    .err = .{ .errno = @as(Syscall.Error.Int, @truncate(@intFromEnum(err))), .syscall = syscall, .path = bun.asByteSlice(path) },
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
        bun.default_allocator.free(@as([*]const u8, @ptrCast(buffer))[0..byteLength]);
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

pub const StringOrBunStringOrBuffer = union(enum) {
    BunString: bun.String,
    string: string,
    buffer: Buffer,

    pub fn toJS(this: StringOrBunStringOrBuffer, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
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
            .BunString => {
                defer this.BunString.deref();
                return this.BunString.toJSConst(ctx).asObjectRef();
            },
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

    pub fn ensureCloned(this: *SliceOrBuffer, allocator: std.mem.Allocator) !void {
        if (this.* == .string) {
            this.string = try this.string.cloneIfNeeded(allocator);
            return;
        }

        const bytes = this.buffer.buffer.byteSlice();
        this.* = .{
            .string = JSC.ZigString.Slice.from(try allocator.dupe(u8, bytes), allocator),
        };
    }

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
        if (!value.isEmpty() and value.isCell() and value.jsType().isTypedArray()) {
            return SliceOrBuffer{
                .buffer = JSC.MarkedArrayBuffer{
                    .buffer = value.asArrayBuffer(global) orelse return null,
                    .allocator = null,
                },
            };
        }

        if (value.isEmpty()) {
            return null;
        }

        var str = value.toStringOrNull(global) orelse return null;
        return SliceOrBuffer{ .string = str.toSlice(global, allocator) };
    }

    pub fn fromJSWithEncoding(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, encoding_value: JSC.JSValue) ?SliceOrBuffer {
        if (value.isCell() and value.jsType().isTypedArray()) {
            return SliceOrBuffer{
                .buffer = JSC.MarkedArrayBuffer{
                    .buffer = value.asArrayBuffer(global) orelse return null,
                    .allocator = null,
                },
            };
        }

        const encoding: Encoding = brk: {
            if (encoding_value.isEmptyOrUndefinedOrNull())
                break :brk .utf8;
            break :brk Encoding.fromJS(encoding_value, global) orelse .utf8;
        };

        if (encoding == .utf8) {
            return fromJS(global, allocator, value);
        }

        var zig_str = value.getZigString(global);
        if (zig_str.len == 0) {
            return fromJS(global, allocator, value);
        }

        const out = zig_str.encode(encoding);

        return .{ .string = JSC.ZigString.Slice.from(out, allocator) };
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

    pub const map = bun.ComptimeStringMap(Encoding, .{
        .{ "utf-8", Encoding.utf8 },
        .{ "utf8", Encoding.utf8 },
        .{ "ucs-2", Encoding.utf16le },
        .{ "ucs2", Encoding.utf16le },
        .{ "utf16-le", Encoding.utf16le },
        .{ "utf16le", Encoding.utf16le },
        .{ "binary", Encoding.latin1 },
        .{ "latin1", Encoding.latin1 },
        .{ "ascii", Encoding.ascii },
        .{ "base64", Encoding.base64 },
        .{ "hex", Encoding.hex },
        .{ "buffer", Encoding.buffer },
        .{ "base64url", Encoding.base64url },
    });

    pub fn isBinaryToText(this: Encoding) bool {
        return switch (this) {
            .hex, .base64, .base64url => true,
            else => false,
        };
    }

    /// Caller must verify the value is a string
    pub fn fromJS(value: JSC.JSValue, global: *JSC.JSGlobalObject) ?Encoding {
        if (bun.String.tryFromJS(value, global)) |str| {
            return str.inMapCaseInsensitive(map);
        }

        return null;
    }

    /// Caller must verify the value is a string
    pub fn from(slice: []const u8) ?Encoding {
        return strings.inMapCaseInsensitive(slice, map);
    }

    pub fn encodeWithSize(encoding: Encoding, globalThis: *JSC.JSGlobalObject, comptime size: usize, input: *const [size]u8) JSC.JSValue {
        switch (encoding) {
            .base64 => {
                var base64: [std.base64.standard.Encoder.calcSize(size)]u8 = undefined;
                const len = bun.base64.encode(&base64, input);
                return JSC.ZigString.init(base64[0..len]).toValueGC(globalThis);
            },
            .base64url => {
                var buf: [std.base64.url_safe_no_pad.Encoder.calcSize(size)]u8 = undefined;
                var encoded = std.base64.url_safe_no_pad.Encoder.encode(&buf, input);

                return JSC.ZigString.init(buf[0..encoded.len]).toValueGC(globalThis);
            },
            .hex => {
                var buf: [size * 4]u8 = undefined;
                var out = std.fmt.bufPrint(&buf, "{}", .{std.fmt.fmtSliceHexLower(input)}) catch unreachable;
                const result = JSC.ZigString.init(out).toValueGC(globalThis);
                return result;
            },
            .buffer => {
                return JSC.ArrayBuffer.createBuffer(globalThis, input);
            },

            inline else => |enc| {
                const res = JSC.WebCore.Encoder.toString(input.ptr, size, globalThis, enc);
                if (res.isError()) {
                    globalThis.throwValue(res);
                    return .zero;
                }

                return res;
            },
        }
    }

    pub fn encodeWithMaxSize(encoding: Encoding, globalThis: *JSC.JSGlobalObject, size: usize, comptime max_size: usize, input: []const u8) JSC.JSValue {
        switch (encoding) {
            .base64 => {
                var base64_buf: [std.base64.standard.Encoder.calcSize(max_size)]u8 = undefined;
                var base64 = base64_buf[0..std.base64.standard.Encoder.calcSize(size)];
                const result = JSC.ZigString.init(std.base64.standard.Encoder.encode(base64, input)).toValueGC(globalThis);
                return result;
            },
            .base64url => {
                var buf: [std.base64.url_safe_no_pad.Encoder.calcSize(max_size)]u8 = undefined;
                var encoded = std.base64.url_safe_no_pad.Encoder.encode(&buf, input);

                return JSC.ZigString.init(buf[0..encoded.len]).toValueGC(globalThis);
            },
            .hex => {
                var buf: [max_size * 4]u8 = undefined;
                var out = std.fmt.bufPrint(&buf, "{}", .{std.fmt.fmtSliceHexLower(input)}) catch unreachable;
                const result = JSC.ZigString.init(out).toValueGC(globalThis);
                return result;
            },
            .buffer => {
                return JSC.ArrayBuffer.createBuffer(globalThis, input);
            },
            inline else => |enc| {
                const res = JSC.WebCore.Encoder.toString(input.ptr, input.len, globalThis, enc);

                if (res.isError()) {
                    globalThis.throwValue(res);
                    return .zero;
                }

                return res;
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
    string: bun.PathString,
    buffer: Buffer,
    slice_with_underlying_string: bun.SliceWithUnderlyingString,

    pub const Tag = enum { string, buffer, slice_with_underlying_string };

    pub fn deinit(this: *const PathLike) void {
        if (this.* == .slice_with_underlying_string) {
            this.slice_with_underlying_string.deinit();
        }
    }

    pub fn deinitAndUnprotect(this: *const PathLike) void {
        switch (this.*) {
            .slice_with_underlying_string => |val| {
                val.deinit();
            },
            .buffer => |val| {
                val.buffer.value.unprotect();
            },
            else => {},
        }
    }

    pub inline fn slice(this: PathLike) string {
        return switch (this) {
            .string => this.string.slice(),
            .buffer => this.buffer.slice(),
            .slice_with_underlying_string => this.slice_with_underlying_string.slice(),
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

        @memcpy(buf[0..sliced.len], sliced);
        buf[sliced.len] = 0;
        return buf[0..sliced.len :0];
    }

    pub inline fn sliceZ(this: PathLike, buf: *[bun.MAX_PATH_BYTES]u8) [:0]const u8 {
        return sliceZWithForceCopy(this, buf, false);
    }

    pub inline fn sliceZAssume(
        this: PathLike,
    ) [:0]const u8 {
        var sliced = this.slice();
        return sliced.ptr[0..sliced.len :0];
    }

    pub fn toJS(this: PathLike, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return switch (this) {
            .string => this.string.toJS(ctx, exception),
            .buffer => this.buffer.toJSObjectRef(ctx, exception),
            .slice_with_underlying_string => this.slice_with_underlying_string.toJS(ctx).asObjectRef(),
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
                var str = arg.toBunString(ctx);

                arguments.eat();

                if (!Valid.pathStringLength(str.length(), ctx, exception)) {
                    return null;
                }

                str.ref();

                return PathLike{ .slice_with_underlying_string = str.toSlice(allocator) };
            },
            else => {
                if (arg.as(JSC.DOMURL)) |domurl| {
                    const path_str: bun.String = domurl.fileSystemPath();
                    if (path_str.isEmpty()) {
                        JSC.throwInvalidArguments("URL must be a non-empty \"file:\" path", .{}, ctx, exception);
                        return null;
                    }
                    arguments.eat();

                    if (!Valid.pathStringLength(path_str.length(), ctx, exception)) {
                        defer path_str.deref();
                        return null;
                    }

                    return PathLike{
                        .slice_with_underlying_string = path_str.toSlice(allocator),
                    };
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

    pub fn pathStringLength(len: usize, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) bool {
        switch (len) {
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
        return pathStringLength(zig_str.len, ctx, exception);
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

pub const VectorArrayBuffer = struct {
    value: JSC.JSValue,
    buffers: std.ArrayList(std.os.iovec),

    pub fn toJS(this: VectorArrayBuffer, _: *JSC.JSGlobalObject) JSC.JSValue {
        return this.value;
    }

    pub fn fromJS(globalObject: *JSC.JSGlobalObject, val: JSC.JSValue, exception: JSC.C.ExceptionRef, allocator: std.mem.Allocator) ?VectorArrayBuffer {
        if (!val.jsType().isArrayLike()) {
            JSC.throwInvalidArguments("Expected ArrayBufferView[]", .{}, globalObject, exception);
            return null;
        }

        var bufferlist = std.ArrayList(std.os.iovec).init(allocator);
        var i: usize = 0;
        const len = val.getLength(globalObject);
        bufferlist.ensureTotalCapacityPrecise(len) catch @panic("Failed to allocate memory for ArrayBuffer[]");

        while (i < len) {
            const element = val.getIndex(globalObject, @as(u32, @truncate(i)));

            if (!element.isCell()) {
                JSC.throwInvalidArguments("Expected ArrayBufferView[]", .{}, globalObject, exception);
                return null;
            }

            const array_buffer = element.asArrayBuffer(globalObject) orelse {
                JSC.throwInvalidArguments("Expected ArrayBufferView[]", .{}, globalObject, exception);
                return null;
            };

            var buf = array_buffer.byteSlice();
            bufferlist.append(std.os.iovec{
                .iov_base = buf.ptr,
                .iov_len = buf.len,
            }) catch @panic("Failed to allocate memory for ArrayBuffer[]");
            i += 1;
        }

        return VectorArrayBuffer{ .value = val, .buffers = bufferlist };
    }
};

pub const ArgumentsSlice = struct {
    remaining: []const JSC.JSValue,
    vm: *JSC.VirtualMachine,
    arena: @import("root").bun.ArenaAllocator = @import("root").bun.ArenaAllocator.init(bun.default_allocator),
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
        return init(vm, @as([*]const JSC.JSValue, @ptrCast(arguments.ptr))[0..arguments.len]);
    }
    pub fn init(vm: *JSC.VirtualMachine, arguments: []const JSC.JSValue) ArgumentsSlice {
        return ArgumentsSlice{
            .remaining = arguments,
            .vm = vm,
            .all = arguments,
            .arena = @import("root").bun.ArenaAllocator.init(vm.allocator),
        };
    }

    pub fn initAsync(vm: *JSC.VirtualMachine, arguments: []const JSC.JSValue) ArgumentsSlice {
        return ArgumentsSlice{
            .remaining = bun.default_allocator.dupe(JSC.JSValue, arguments),
            .vm = vm,
            .all = arguments,
            .arena = bun.ArenaAllocator.init(bun.default_allocator),
        };
    }

    pub inline fn len(this: *const ArgumentsSlice) u16 {
        return @as(u16, @truncate(this.remaining.len));
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

    return @as(bun.FileDescriptor, @truncate(fd));
}

// Node.js docs:
// > Values can be either numbers representing Unix epoch time in seconds, Dates, or a numeric string like '123456789.0'.
// > If the value can not be converted to a number, or is NaN, Infinity, or -Infinity, an Error will be thrown.
pub fn timeLikeFromJS(globalThis: *JSC.JSGlobalObject, value: JSC.JSValue, _: JSC.C.ExceptionRef) ?TimeLike {
    if (value.jsType() == .JSDate) {
        const milliseconds = value.getUnixTimestamp();
        if (!std.math.isFinite(milliseconds)) {
            return null;
        }

        return @as(TimeLike, @truncate(@as(i64, @intFromFloat(milliseconds / @as(f64, std.time.ms_per_s)))));
    }

    if (!value.isNumber() and !value.isString()) {
        return null;
    }

    const seconds = value.coerce(f64, globalThis);
    if (!std.math.isFinite(seconds)) {
        return null;
    }

    return @as(TimeLike, @truncate(@as(i64, @intFromFloat(seconds))));
}

pub fn modeFromJS(ctx: JSC.C.JSContextRef, value: JSC.JSValue, exception: JSC.C.ExceptionRef) ?Mode {
    const mode_int = if (value.isNumber())
        @as(Mode, @truncate(value.to(Mode)))
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

    if (mode_int < 0) {
        JSC.throwInvalidArguments("Invalid mode: must be greater than or equal to 0.", .{}, ctx, exception);
        return null;
    }

    return mode_int & 0o777;
}

pub const PathOrFileDescriptor = union(Tag) {
    path: PathLike,
    fd: bun.FileDescriptor,

    pub const Tag = enum { fd, path };

    pub const SerializeTag = enum(u8) { fd, path };

    /// This will unref() the path string if it is a PathLike.
    /// Does nothing for file descriptors, **does not** close file descriptors.
    pub fn deinit(this: PathOrFileDescriptor) void {
        if (this == .path) {
            this.path.deinit();
        }
    }

    pub fn deinitAndUnprotect(this: PathOrFileDescriptor) void {
        if (this == .path) {
            this.path.deinitAndUnprotect();
        }
    }

    pub fn hash(this: JSC.Node.PathOrFileDescriptor) u64 {
        return switch (this) {
            .path => bun.hash(this.path.slice()),
            .fd => bun.hash(std.mem.asBytes(&this.fd)),
        };
    }

    pub fn format(this: JSC.Node.PathOrFileDescriptor, comptime fmt: []const u8, _: std.fmt.FormatOptions, writer: anytype) !void {
        if (fmt.len != 0 and fmt[0] != 's') {
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
            .fd => JSC.JSValue.jsNumberFromInt32(@as(i32, @intCast(this.fd))).asRef(),
        };
    }
};

pub const FileSystemFlags = enum(Mode) {
    /// Open file for appending. The file is created if it does not exist.
    a = std.os.O.APPEND | std.os.O.WRONLY | std.os.O.CREAT,
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
    r = std.os.O.RDONLY,
    /// Open file for reading and writing. An exception occurs if the file does not exist.
    // @"r+" = std.os.O.RDWR,
    /// Open file for reading and writing in synchronous mode. Instructs the operating system to bypass the local file system cache.
    /// This is primarily useful for opening files on NFS mounts as it allows skipping the potentially stale local cache. It has a very real impact on I/O performance so using this flag is not recommended unless it is needed.
    /// This doesn't turn fs.open() or fsPromises.open() into a synchronous blocking call. If synchronous operation is desired, something like fs.openSync() should be used.
    // @"rs+" = std.os.O.RDWR,
    /// Open file for writing. The file is created (if it does not exist) or truncated (if it exists).
    w = std.os.O.WRONLY | std.os.O.CREAT,
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

    const map = bun.ComptimeStringMap(Mode, .{
        .{ "r", O_RDONLY },
        .{ "rs", O_RDONLY | O_SYNC },
        .{ "sr", O_RDONLY | O_SYNC },
        .{ "r+", O_RDWR },
        .{ "rs+", O_RDWR | O_SYNC },
        .{ "sr+", O_RDWR | O_SYNC },

        .{ "R", O_RDONLY },
        .{ "RS", O_RDONLY | O_SYNC },
        .{ "SR", O_RDONLY | O_SYNC },
        .{ "R+", O_RDWR },
        .{ "RS+", O_RDWR | O_SYNC },
        .{ "SR+", O_RDWR | O_SYNC },

        .{ "w", O_TRUNC | O_CREAT | O_WRONLY },
        .{ "wx", O_TRUNC | O_CREAT | O_WRONLY | O_EXCL },
        .{ "xw", O_TRUNC | O_CREAT | O_WRONLY | O_EXCL },

        .{ "W", O_TRUNC | O_CREAT | O_WRONLY },
        .{ "WX", O_TRUNC | O_CREAT | O_WRONLY | O_EXCL },
        .{ "XW", O_TRUNC | O_CREAT | O_WRONLY | O_EXCL },

        .{ "w+", O_TRUNC | O_CREAT | O_RDWR },
        .{ "wx+", O_TRUNC | O_CREAT | O_RDWR | O_EXCL },
        .{ "xw+", O_TRUNC | O_CREAT | O_RDWR | O_EXCL },

        .{ "W+", O_TRUNC | O_CREAT | O_RDWR },
        .{ "WX+", O_TRUNC | O_CREAT | O_RDWR | O_EXCL },
        .{ "XW+", O_TRUNC | O_CREAT | O_RDWR | O_EXCL },

        .{ "a", O_APPEND | O_CREAT | O_WRONLY },
        .{ "ax", O_APPEND | O_CREAT | O_WRONLY | O_EXCL },
        .{ "xa", O_APPEND | O_CREAT | O_WRONLY | O_EXCL },
        .{ "as", O_APPEND | O_CREAT | O_WRONLY | O_SYNC },
        .{ "sa", O_APPEND | O_CREAT | O_WRONLY | O_SYNC },

        .{ "A", O_APPEND | O_CREAT | O_WRONLY },
        .{ "AX", O_APPEND | O_CREAT | O_WRONLY | O_EXCL },
        .{ "XA", O_APPEND | O_CREAT | O_WRONLY | O_EXCL },
        .{ "AS", O_APPEND | O_CREAT | O_WRONLY | O_SYNC },
        .{ "SA", O_APPEND | O_CREAT | O_WRONLY | O_SYNC },

        .{ "a+", O_APPEND | O_CREAT | O_RDWR },
        .{ "ax+", O_APPEND | O_CREAT | O_RDWR | O_EXCL },
        .{ "xa+", O_APPEND | O_CREAT | O_RDWR | O_EXCL },
        .{ "as+", O_APPEND | O_CREAT | O_RDWR | O_SYNC },
        .{ "sa+", O_APPEND | O_CREAT | O_RDWR | O_SYNC },

        .{ "A+", O_APPEND | O_CREAT | O_RDWR },
        .{ "AX+", O_APPEND | O_CREAT | O_RDWR | O_EXCL },
        .{ "XA+", O_APPEND | O_CREAT | O_RDWR | O_EXCL },
        .{ "AS+", O_APPEND | O_CREAT | O_RDWR | O_SYNC },
        .{ "SA+", O_APPEND | O_CREAT | O_RDWR | O_SYNC },
    });

    pub fn fromJS(ctx: JSC.C.JSContextRef, val: JSC.JSValue, exception: JSC.C.ExceptionRef) ?FileSystemFlags {
        if (val.isNumber()) {
            const number = val.coerce(i32, ctx);
            return @as(FileSystemFlags, @enumFromInt(@as(Mode, @intCast(@max(number, 0)))));
        }

        const jsType = val.jsType();
        if (jsType.isStringLike()) {
            const str = val.getZigString(ctx);
            if (str.isEmpty()) {
                JSC.throwInvalidArguments(
                    "Expected flags to be a non-empty string. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags",
                    .{},
                    ctx,
                    exception,
                );
                return null;
            }
            // it's definitely wrong when the string is super long
            else if (str.len > 12) {
                JSC.throwInvalidArguments(
                    "Invalid flag '{any}'. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags",
                    .{str},
                    ctx,
                    exception,
                );
                return null;
            }

            const flags = brk: {
                switch (str.is16Bit()) {
                    inline else => |is_16bit| {
                        const chars = if (is_16bit) str.utf16SliceAligned() else str.slice();

                        if (std.ascii.isDigit(@as(u8, @truncate(chars[0])))) {
                            // node allows "0o644" as a string :(
                            if (is_16bit) {
                                const slice = str.toSlice(bun.default_allocator);
                                defer slice.deinit();

                                break :brk std.fmt.parseInt(Mode, slice.slice(), 10) catch null;
                            } else {
                                break :brk std.fmt.parseInt(Mode, chars, 10) catch null;
                            }
                        }
                    },
                }

                break :brk map.getWithEql(str, JSC.ZigString.eqlComptime);
            } orelse {
                JSC.throwInvalidArguments(
                    "Invalid flag '{any}'. Learn more at https://nodejs.org/api/fs.html#fs_file_system_flags",
                    .{str},
                    ctx,
                    exception,
                );
                return null;
            };

            return @as(FileSystemFlags, @enumFromInt(@as(Mode, @intCast(flags))));
        }

        return null;
    }
};

/// Milliseconds precision
pub const Date = enum(u64) {
    _,

    pub fn toJS(this: Date, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        const seconds = @as(f64, @floatCast(@as(f64, @floatFromInt(@intFromEnum(this))) * 1000.0));
        const unix_timestamp = JSC.JSValue.jsNumber(seconds);
        const array: [1]JSC.C.JSValueRef = .{unix_timestamp.asObjectRef()};
        const obj = JSC.C.JSObjectMakeDate(ctx, 1, &array, exception);
        return obj;
    }
};

fn StatsDataType(comptime T: type) type {
    return struct {
        dev: T,
        ino: T,
        mode: T,
        nlink: T,
        uid: T,
        gid: T,
        rdev: T,
        // Always store size as a 64-bit integer
        size: i64,
        blksize: T,
        blocks: T,
        atime_ms: f64,
        mtime_ms: f64,
        ctime_ms: f64,
        birthtime_ms: T,

        // TODO: don't store these 4 fields
        atime: Date,
        mtime: Date,
        ctime: Date,
        birthtime: Date,

        pub fn init(stat_: os.Stat) @This() {
            const atime = stat_.atime();
            const mtime = stat_.mtime();
            const ctime = stat_.ctime();

            return @This(){
                .dev = @as(T, @truncate(@as(i64, @intCast(stat_.dev)))),
                .ino = @as(T, @truncate(@as(i64, @intCast(stat_.ino)))),
                .mode = @as(T, @truncate(@as(i64, @intCast(stat_.mode)))),
                .nlink = @as(T, @truncate(@as(i64, @intCast(stat_.nlink)))),
                .uid = @as(T, @truncate(@as(i64, @intCast(stat_.uid)))),
                .gid = @as(T, @truncate(@as(i64, @intCast(stat_.gid)))),
                .rdev = @as(T, @truncate(@as(i64, @intCast(stat_.rdev)))),
                .size = @truncate(@as(i64, @intCast(stat_.size))),
                .blksize = @as(T, @truncate(@as(i64, @intCast(stat_.blksize)))),
                .blocks = @as(T, @truncate(@as(i64, @intCast(stat_.blocks)))),
                .atime_ms = (@as(f64, @floatFromInt(@max(atime.tv_sec, 0))) * std.time.ms_per_s) + (@as(f64, @floatFromInt(@as(usize, @intCast(@max(atime.tv_nsec, 0))))) / std.time.ns_per_ms),
                .mtime_ms = (@as(f64, @floatFromInt(@max(mtime.tv_sec, 0))) * std.time.ms_per_s) + (@as(f64, @floatFromInt(@as(usize, @intCast(@max(mtime.tv_nsec, 0))))) / std.time.ns_per_ms),
                .ctime_ms = (@as(f64, @floatFromInt(@max(ctime.tv_sec, 0))) * std.time.ms_per_s) + (@as(f64, @floatFromInt(@as(usize, @intCast(@max(ctime.tv_nsec, 0))))) / std.time.ns_per_ms),
                .atime = @as(Date, @enumFromInt(@as(u64, @intCast(@max(atime.tv_sec, 0))))),
                .mtime = @as(Date, @enumFromInt(@as(u64, @intCast(@max(mtime.tv_sec, 0))))),
                .ctime = @as(Date, @enumFromInt(@as(u64, @intCast(@max(ctime.tv_sec, 0))))),

                // Linux doesn't include this info in stat
                // maybe it does in statx, but do you really need birthtime? If you do please file an issue.
                .birthtime_ms = if (Environment.isLinux)
                    0
                else
                    @as(T, @truncate(@as(i64, @intCast(if (stat_.birthtime().tv_nsec > 0) (@as(usize, @intCast(stat_.birthtime().tv_nsec)) / std.time.ns_per_ms) else 0)))),

                .birthtime = if (Environment.isLinux)
                    @as(Date, @enumFromInt(0))
                else
                    @as(Date, @enumFromInt(@as(u64, @intCast(@max(stat_.birthtime().tv_sec, 0))))),
            };
        }
    };
}

pub const Stats = union(enum) {
    big: StatsDataType(i64),
    small: StatsDataType(i32),

    const This = Stats;
    pub usingnamespace JSC.Codegen.JSStats;

    fn unionGetter(comptime field: std.meta.FieldEnum(StatsDataType(i64))) JSC.To.Cpp.PropertyGetter(This) {
        return struct {
            pub fn callback(this: *This, globalThis: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
                return switch (this.*) {
                    .big => JSC.toJS(globalThis, @field(this.big, @tagName(field)), null),
                    .small => JSC.toJS(globalThis, @field(this.small, @tagName(field)), null),
                };
            }
        }.callback;
    }

    pub const isBlockDevice_ = JSC.wrapInstanceMethod(Stats, "isBlockDevice", false);
    pub const isCharacterDevice_ = JSC.wrapInstanceMethod(Stats, "isCharacterDevice", false);
    pub const isDirectory_ = JSC.wrapInstanceMethod(Stats, "isDirectory", false);
    pub const isFIFO_ = JSC.wrapInstanceMethod(Stats, "isFIFO", false);
    pub const isFile_ = JSC.wrapInstanceMethod(Stats, "isFile", false);
    pub const isSocket_ = JSC.wrapInstanceMethod(Stats, "isSocket", false);
    pub const isSymbolicLink_ = JSC.wrapInstanceMethod(Stats, "isSymbolicLink", false);

    pub const isBlockDevice_WithoutTypeChecks = domCall(.isBlockDevice);
    pub const isCharacterDevice_WithoutTypeChecks = domCall(.isCharacterDevice);
    pub const isDirectory_WithoutTypeChecks = domCall(.isDirectory);
    pub const isFIFO_WithoutTypeChecks = domCall(.isFIFO);
    pub const isFile_WithoutTypeChecks = domCall(.isFile);
    pub const isSocket_WithoutTypeChecks = domCall(.isSocket);
    pub const isSymbolicLink_WithoutTypeChecks = domCall(.isSymbolicLink);

    const DOMCallFn = fn (
        *Stats,
        *JSC.JSGlobalObject,
    ) callconv(.C) JSC.JSValue;
    fn domCall(comptime decl: std.meta.DeclEnum(Stats)) DOMCallFn {
        return struct {
            pub fn run(
                this: *Stats,
                _: *JSC.JSGlobalObject,
            ) callconv(.C) JSC.JSValue {
                return @call(.auto, @field(Stats, @tagName(decl)), .{this});
            }
        }.run;
    }

    pub const dev = unionGetter(.dev);
    pub const ino = unionGetter(.ino);
    pub const mode = unionGetter(.mode);
    pub const nlink = unionGetter(.nlink);
    pub const uid = unionGetter(.uid);
    pub const gid = unionGetter(.gid);
    pub const rdev = unionGetter(.rdev);
    pub const size = unionGetter(.size);
    pub const blksize = unionGetter(.blksize);
    pub const blocks = unionGetter(.blocks);
    pub const atime = unionGetter(.atime);
    pub const mtime = unionGetter(.mtime);
    pub const ctime = unionGetter(.ctime);
    pub const birthtime = unionGetter(.birthtime);
    pub const atimeMs = unionGetter(.atime_ms);
    pub const mtimeMs = unionGetter(.mtime_ms);
    pub const ctimeMs = unionGetter(.ctime_ms);
    pub const birthtimeMs = unionGetter(.birthtime_ms);

    fn modeInternal(this: *This) i32 {
        return switch (this.*) {
            .big => @as(i32, @truncate(this.big.mode)),
            .small => this.small.mode,
        };
    }

    pub fn isBlockDevice(this: *This) JSC.JSValue {
        return JSC.JSValue.jsBoolean(os.S.ISBLK(@as(Mode, @intCast(this.modeInternal()))));
    }

    pub fn isCharacterDevice(this: *This) JSC.JSValue {
        return JSC.JSValue.jsBoolean(os.S.ISCHR(@as(Mode, @intCast(this.modeInternal()))));
    }

    pub fn isDirectory(this: *This) JSC.JSValue {
        return JSC.JSValue.jsBoolean(os.S.ISDIR(@as(Mode, @intCast(this.modeInternal()))));
    }

    pub fn isFIFO(this: *This) JSC.JSValue {
        return JSC.JSValue.jsBoolean(os.S.ISFIFO(@as(Mode, @intCast(this.modeInternal()))));
    }

    pub fn isFile(this: *This) JSC.JSValue {
        return JSC.JSValue.jsBoolean(os.S.ISREG(@as(Mode, @intCast(this.modeInternal()))));
    }

    pub fn isSocket(this: *This) JSC.JSValue {
        return JSC.JSValue.jsBoolean(os.S.ISSOCK(@as(Mode, @intCast(this.modeInternal()))));
    }

    // Node.js says this method is only valid on the result of lstat()
    // so it's fine if we just include it on stat() because it would
    // still just return false.
    //
    // See https://nodejs.org/api/fs.html#statsissymboliclink
    pub fn isSymbolicLink(this: *This) JSC.JSValue {
        return JSC.JSValue.jsBoolean(os.S.ISLNK(@as(Mode, @intCast(this.modeInternal()))));
    }

    pub fn finalize(this: *This) callconv(.C) void {
        bun.default_allocator.destroy(this);
    }

    pub fn init(stat: std.os.Stat, big: bool) This {
        if (big) {
            return .{ .big = StatsDataType(i64).init(stat) };
        } else {
            return .{ .small = StatsDataType(i32).init(stat) };
        }
    }

    pub fn initWithAllocator(allocator: std.mem.Allocator, stat: std.os.Stat, big: bool) *This {
        var this = allocator.create(Stats) catch unreachable;
        this.* = init(stat, big);
        return this;
    }

    pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*Stats {
        globalThis.throw("Stats is not constructable. use fs.stat()", .{});

        return null;
    }

    comptime {
        _ = isBlockDevice_WithoutTypeChecks;
        _ = isCharacterDevice_WithoutTypeChecks;
        _ = isDirectory_WithoutTypeChecks;
        _ = isFIFO_WithoutTypeChecks;
        _ = isFile_WithoutTypeChecks;
        _ = isSocket_WithoutTypeChecks;
        _ = isSymbolicLink_WithoutTypeChecks;
    }
};

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
pub const Dirent = struct {
    name: bun.String,
    // not publicly exposed
    kind: Kind,

    pub const Kind = std.fs.File.Kind;
    pub usingnamespace JSC.Codegen.JSDirent;

    pub fn constructor(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) callconv(.C) ?*Dirent {
        globalObject.throw("Dirent is not a constructor", .{});
        return null;
    }

    pub fn getName(this: *Dirent, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return this.name.toJS(globalObject);
    }

    pub fn isBlockDevice(
        this: *Dirent,
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.kind == std.fs.File.Kind.block_device);
    }
    pub fn isCharacterDevice(
        this: *Dirent,
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.kind == std.fs.File.Kind.character_device);
    }
    pub fn isDirectory(
        this: *Dirent,
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.kind == std.fs.File.Kind.directory);
    }
    pub fn isFIFO(
        this: *Dirent,
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.kind == std.fs.File.Kind.named_pipe or this.kind == std.fs.File.Kind.event_port);
    }
    pub fn isFile(
        this: *Dirent,
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.kind == std.fs.File.Kind.file);
    }
    pub fn isSocket(
        this: *Dirent,
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.kind == std.fs.File.Kind.unix_domain_socket);
    }
    pub fn isSymbolicLink(
        this: *Dirent,
        _: *JSC.JSGlobalObject,
        _: *JSC.CallFrame,
    ) callconv(.C) JSC.JSValue {
        return JSC.JSValue.jsBoolean(this.kind == std.fs.File.Kind.sym_link);
    }

    pub fn finalize(this: *Dirent) callconv(.C) void {
        this.name.deref();
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
                this.once_count +|= @as(u32, @intFromBool(listener.once));
            }

            pub fn prepend(this: *List, allocator: std.mem.Allocator, ctx: JSC.C.JSContextRef, listener: Listener) !void {
                JSC.C.JSValueProtect(ctx, listener.callback.asObjectRef());
                try this.list.ensureUnusedCapacity(allocator, 1);
                this.list.insertAssumeCapacity(0, listener);
                this.once_count +|= @as(u32, @intFromBool(listener.once));
            }

            // removeListener() will remove, at most, one instance of a listener from the
            // listener array. If any single listener has been added multiple times to the
            // listener array for the specified eventName, then removeListener() must be
            // called multiple times to remove each instance.
            pub fn remove(this: *List, ctx: JSC.C.JSContextRef, callback: JSC.JSValue) bool {
                const callbacks = this.list.items(.callback);

                for (callbacks, 0..) |item, i| {
                    if (callback.eqlValue(item)) {
                        JSC.C.JSValueUnprotect(ctx, callback.asObjectRef());
                        this.once_count -|= @as(u32, @intFromBool(this.list.items(.once)[i]));
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

    fn dirnameWindows(path: []const u8) []const u8 {
        if (path.len == 0)
            return ".";

        const root_slice = std.fs.path.diskDesignatorWindows(path);
        if (path.len == root_slice.len)
            return root_slice;

        const have_root_slash = path.len > root_slice.len and (path[root_slice.len] == '/' or path[root_slice.len] == '\\');

        var end_index: usize = path.len - 1;

        while (path[end_index] == '/' or path[end_index] == '\\') {
            // e.g. '\\' => "\\"
            if (end_index == 0) {
                return path[0..1];
            }
            end_index -= 1;
        }

        while (path[end_index] != '/' and path[end_index] != '\\') {
            if (end_index == 0) {
                if (root_slice.len == 0) {
                    return ".";
                }
                if (have_root_slash) {
                    // e.g. "c:\\" => "c:\\"
                    return path[0 .. root_slice.len + 1];
                } else {
                    // e.g. "c:foo" => "c:"
                    return root_slice;
                }
            }
            end_index -= 1;
        }

        if (have_root_slash and end_index == root_slice.len) {
            end_index += 1;
        }

        return path[0..end_index];
    }

    fn dirnamePosix(path: []const u8) []const u8 {
        if (path.len == 0)
            return ".";

        var end_index: usize = path.len - 1;

        while (path[end_index] == '/') {
            // e.g. "////" => "/"
            if (end_index == 0) {
                return "/";
            }
            end_index -= 1;
        }

        while (path[end_index] != '/') {
            if (end_index == 0) {
                // e.g. "a/", "a"
                return ".";
            }
            end_index -= 1;
        }

        // e.g. "/a/" => "/"
        if (end_index == 0 and path[0] == '/') {
            return "/";
        }

        // "a/b" => "a" or "//b" => "//"
        if (end_index <= 1) {
            if (path[0] == '/' and path[1] == '/') {
                end_index += 1;
            }
        }

        return path[0..end_index];
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

        const out = if (isWindows)
            @This().dirnameWindows(base_slice)
        else
            @This().dirnamePosix(base_slice);

        return JSC.ZigString.init(out).withEncoding().toValueGC(globalThis);
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
        if (path_object.getTruthy(globalThis, "dir")) |prop| {
            prop.toZigString(&dir, globalThis);
            insert_separator = !dir.isEmpty();
        } else if (path_object.getTruthy(globalThis, "root")) |prop| {
            prop.toZigString(&dir, globalThis);
        }

        if (path_object.getTruthy(globalThis, "base")) |prop| {
            prop.toZigString(&name_with_ext, globalThis);
        } else {
            var had_ext = false;
            if (path_object.getTruthy(globalThis, "ext")) |prop| {
                prop.toZigString(&ext, globalThis);
                had_ext = !ext.isEmpty();
            }

            if (path_object.getTruthy(globalThis, "name")) |prop| {
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
        if (!windows) return path.hasPrefixChar('/');

        return isZigStringAbsoluteWindows(path);
    }
    pub fn isAbsolute(globalThis: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        const arg = if (args_len > 0) args_ptr[0] else JSC.JSValue.undefined;
        if (!arg.isString()) {
            globalThis.throwInvalidArgumentType("isAbsolute", "path", "string");
            return JSC.JSValue.undefined;
        }
        const zig_str = arg.getZigString(globalThis);
        return JSC.JSValue.jsBoolean(zig_str.len > 0 and isAbsoluteString(zig_str, isWindows));
    }
    fn isZigStringAbsoluteWindows(zig_str: JSC.ZigString) bool {
        std.debug.assert(zig_str.len > 0); // caller must check
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

            return std.fs.path.isAbsoluteWindowsWTF16(buf[0..@min(u16_slice.len, buf.len)]);
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
        var arena = @import("root").bun.ArenaAllocator.init(heap_allocator);
        var arena_allocator = arena.allocator();
        var stack_fallback_allocator = std.heap.stackFallback(
            ((32 * @sizeOf(string)) + 1024),
            arena_allocator,
        );
        var allocator = stack_fallback_allocator.get();

        defer arena.deinit();
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var to_join = allocator.alloc(string, args_len) catch unreachable;
        for (args_ptr[0..args_len], 0..) |arg, i| {
            const zig_str: JSC.ZigString = arg.getZigString(globalThis);
            to_join[i] = zig_str.toSlice(allocator).slice();
        }

        const out = if (!isWindows)
            PathHandler.joinStringBuf(&buf, to_join, .posix)
        else
            PathHandler.joinStringBuf(&buf, to_join, .windows);

        var str = bun.String.create(out);
        defer str.deref();
        return str.toJS(globalThis);
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
    pub fn parse(globalThis: *JSC.JSGlobalObject, win32: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0 or !args_ptr[0].jsType().isStringLike()) {
            return JSC.toInvalidArguments("path string is required", .{}, globalThis);
        }
        var path_slice: JSC.ZigString.Slice = args_ptr[0].toSlice(globalThis, heap_allocator);
        defer path_slice.deinit();
        var path = path_slice.slice();
        const path_name = Fs.NodeJSPathName.init(
            path,
            if (win32) std.fs.path.sep_windows else std.fs.path.sep_posix,
        );
        var dir = JSC.ZigString.init(path_name.dir);
        const is_absolute = (win32 and dir.len > 0 and isZigStringAbsoluteWindows(dir)) or (!win32 and path.len > 0 and path[0] == '/');

        // if its not absolute root must be empty
        var root = JSC.ZigString.Empty;
        if (is_absolute) {
            root = JSC.ZigString.init(if (win32) std.fs.path.sep_str_windows else std.fs.path.sep_str_posix);
            // if is absolute and dir is empty, then dir = root
            if (path_name.dir.len == 0) {
                dir = root;
            }
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

        var arena = @import("root").bun.ArenaAllocator.init(heap_allocator);
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
        .basename = basename,
        .dirname = dirname,
        .extname = extname,
        .format = format,
        .isAbsolute = isAbsolute,
        .join = join,
        .normalize = normalize,
        .parse = parse,
        .relative = relative,
        .resolve = resolve,
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
    pub fn getArgv0(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return JSC.ZigString.fromUTF8(bun.span(std.os.argv[0])).toValueGC(globalObject);
    }

    pub fn getExecPath(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        var buf: [bun.MAX_PATH_BYTES]u8 = undefined;
        var out = std.fs.selfExePath(&buf) catch {
            // if for any reason we are unable to get the executable path, we just return argv[0]
            return getArgv0(globalObject);
        };

        return JSC.ZigString.fromUTF8(out).toValueGC(globalObject);
    }

    pub fn getExecArgv(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        const allocator = globalObject.allocator();
        var vm = globalObject.bunVM();
        var args = allocator.alloc(
            JSC.ZigString,
            // argv omits "bun" because it could be "bun run" or "bun" and it's kind of ambiguous
            // argv also omits the script name
            std.os.argv.len -| 1,
        ) catch unreachable;
        defer allocator.free(args);
        var used: usize = 0;
        const offset: usize = 1;

        for (std.os.argv[@min(std.os.argv.len, offset)..]) |arg_| {
            const arg = bun.span(arg_);
            if (arg.len == 0)
                continue;

            if (arg[0] != '-')
                continue;

            if (vm.argv.len > 0 and strings.eqlLong(vm.argv[0], arg, true))
                break;

            args[used] = JSC.ZigString.fromUTF8(arg);

            used += 1;
        }

        return JSC.JSValue.createStringArray(globalObject, args.ptr, used, true);
    }

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

        if (vm.standalone_module_graph != null) {
            // Don't break user's code because they did process.argv.slice(2)
            // Even if they didn't type "bun", we still want to add it
            args_list.appendAssumeCapacity(
                JSC.ZigString.init("bun"),
            );
        } else {
            args_list.appendAssumeCapacity(
                JSC.ZigString.init(
                    std.fs.selfExePathAlloc(allocator) catch "bun",
                ).withEncoding(),
            );
        }

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
                JSC.VirtualMachine.get().bundler.fs.top_level_dir = std.os.getcwd(&JSC.VirtualMachine.get().bundler.fs.top_level_dir_buf) catch {
                    _ = Syscall.chdir(@as([:0]const u8, @ptrCast(JSC.VirtualMachine.get().bundler.fs.top_level_dir)));
                    return JSC.toInvalidArguments("Invalid path", .{}, globalObject.ref());
                };

                JSC.VirtualMachine.get().bundler.fs.top_level_dir_buf[JSC.VirtualMachine.get().bundler.fs.top_level_dir.len] = std.fs.path.sep;
                JSC.VirtualMachine.get().bundler.fs.top_level_dir_buf[JSC.VirtualMachine.get().bundler.fs.top_level_dir.len + 1] = 0;
                JSC.VirtualMachine.get().bundler.fs.top_level_dir = JSC.VirtualMachine.get().bundler.fs.top_level_dir_buf[0 .. JSC.VirtualMachine.get().bundler.fs.top_level_dir.len + 1];

                return JSC.JSValue.jsUndefined();
            },
        }
    }

    pub fn exit(globalObject: *JSC.JSGlobalObject, code: u8) callconv(.C) void {
        var vm = globalObject.bunVM();
        if (vm.worker) |worker| {
            vm.exit_handler.exit_code = code;
            worker.terminate();
            return;
        }

        vm.onExit();
        std.os.exit(code);
    }

    pub export const Bun__version: [*:0]const u8 = "v" ++ bun.Global.package_json_version;
    pub export const Bun__versions_boringssl: [*:0]const u8 = bun.Global.versions.boringssl;
    pub export const Bun__versions_libarchive: [*:0]const u8 = bun.Global.versions.libarchive;
    pub export const Bun__versions_mimalloc: [*:0]const u8 = bun.Global.versions.mimalloc;
    pub export const Bun__versions_picohttpparser: [*:0]const u8 = bun.Global.versions.picohttpparser;
    pub export const Bun__versions_uws: [*:0]const u8 = bun.Global.versions.uws;
    pub export const Bun__versions_webkit: [*:0]const u8 = bun.Global.versions.webkit;
    pub export const Bun__versions_zig: [*:0]const u8 = bun.Global.versions.zig;
    pub export const Bun__versions_zlib: [*:0]const u8 = bun.Global.versions.zlib;
    pub export const Bun__versions_tinycc: [*:0]const u8 = bun.Global.versions.tinycc;
    pub export const Bun__versions_lolhtml: [*:0]const u8 = bun.Global.versions.lolhtml;
    pub export const Bun__versions_c_ares: [*:0]const u8 = bun.Global.versions.c_ares;
    pub export const Bun__versions_usockets: [*:0]const u8 = bun.Global.versions.usockets;
    pub export const Bun__version_sha: [*:0]const u8 = bun.Environment.git_sha;
};

comptime {
    std.testing.refAllDecls(Process);
    std.testing.refAllDecls(Path);
}
