const std = @import("std");
const builtin = @import("builtin");
const bun = @import("root").bun;
const meta = bun.meta;
const windows = bun.windows;
const heap_allocator = bun.default_allocator;
const is_bindgen: bool = meta.globalOption("bindgen", bool) orelse false;
const kernel32 = windows.kernel32;
const logger = bun.logger;
const os = std.os;
const path_handler = bun.path;
const strings = bun.strings;
const string = bun.string;
const validators = @import("./util/validators.zig");
const validateObject = validators.validateObject;
const validateString = validators.validateString;

const C = bun.C;
const L = strings.literal;
const Environment = bun.Environment;
const Fs = @import("../../fs.zig");
const IdentityContext = @import("../../identity_context.zig").IdentityContext;
const JSC = bun.JSC;
const Mode = bun.Mode;
const Shimmer = @import("../bindings/shimmer.zig").Shimmer;
const Syscall = bun.sys;
const URL = @import("../../url.zig").URL;
const Value = std.json.Value;

const PATH_MIN_WIDE = 4096; // 4 KB

const stack_fallback_size_small = switch (Environment.os) {
    // Up to 4 KB, instead of MAX_PATH_BYTES which is 96 KB on Windows, ouch!
    .windows => PATH_MIN_WIDE,
    else => bun.MAX_PATH_BYTES,
};

const stack_fallback_size_large = 32 * @sizeOf(string); // up to 32 strings on the stack

/// Taken from Zig 0.11.0 zig/src/resinator/rc.zig
/// https://github.com/ziglang/zig/blob/776cd673f206099012d789fd5d05d49dd72b9faa/src/resinator/rc.zig#L266
///
/// Compares ASCII values case-insensitively, non-ASCII values are compared directly
fn eqlIgnoreCaseT(comptime T: type, a: []const T, b: []const T) bool {
    if (T != u16) {
        return std.ascii.eqlIgnoreCase(a, b);
    }
    if (a.len != b.len) return false;
    for (a, b) |a_c, b_c| {
        if (a_c < 128) {
            if (std.ascii.toLower(@intCast(a_c)) != std.ascii.toLower(@intCast(b_c))) return false;
        } else {
            if (a_c != b_c) return false;
        }
    }
    return true;
}

/// Taken from Zig 0.11.0 zig/src/resinator/rc.zig
/// https://github.com/ziglang/zig/blob/776cd673f206099012d789fd5d05d49dd72b9faa/src/resinator/rc.zig#L266
///
/// Lowers ASCII values, non-ASCII values are returned directly
inline fn toLowerT(comptime T: type, a_c: T) T {
    if (T != u16) {
        return std.ascii.toLower(a_c);
    }
    return if (a_c < 128) @intCast(std.ascii.toLower(@intCast(a_c))) else a_c;
}

inline fn toJSString(globalObject: *JSC.JSGlobalObject, slice: []const u8) JSC.JSValue {
    return if (slice.len > 0)
        JSC.ZigString.init(slice).withEncoding().toValueGC(globalObject)
    else
        JSC.JSValue.jsEmptyString(globalObject);
}

inline fn toUTF8JSString(globalObject: *JSC.JSGlobalObject, slice: []const u8) JSC.JSValue {
    return JSC.ZigString.initUTF8(slice).toValueGC(globalObject);
}

fn typeBaseNameT(comptime T: type) []const u8 {
    return meta.typeBaseName(@typeName(T));
}

fn validatePathT(comptime T: type, comptime methodName: []const u8) void {
    comptime switch (T) {
        inline u8, u16 => return,
        else => @compileError("Unsupported type for " ++ methodName ++ ": " ++ typeBaseNameT(T)),
    };
}

pub const Buffer = JSC.MarkedArrayBuffer;

/// On windows, this is what libuv expects
/// On unix it is what the utimens api expects
pub const TimeLike = if (Environment.isWindows) f64 else std.os.timespec;

pub const Flavor = enum {
    sync,
    promise,
    callback,

    pub fn Wrap(comptime this: Flavor, comptime T: type) type {
        return comptime brk: {
            switch (this) {
                .sync => break :brk T,
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
pub fn Maybe(comptime ReturnTypeT: type, comptime ErrorTypeT: type) type {
    const hasRetry = @hasDecl(ErrorTypeT, "retry");
    const hasTodo = @hasDecl(ErrorTypeT, "todo");

    return union(Tag) {
        pub const ErrorType = ErrorTypeT;
        pub const ReturnType = ReturnTypeT;

        err: ErrorType,
        result: ReturnType,

        pub const Tag = enum { err, result };

        pub const retry: @This() = if (hasRetry) .{ .err = ErrorType.retry } else .{ .err = ErrorType{} };

        pub const success: @This() = @This(){
            .result = std.mem.zeroes(ReturnType),
        };

        pub fn assert(this: @This()) ReturnType {
            switch (this) {
                .err => |err| {
                    bun.Output.panic("Unexpected error\n{}", .{err});
                },
                .result => |result| return result,
            }
        }

        pub inline fn todo() @This() {
            if (Environment.allow_assert) {
                if (comptime ReturnType == void) {
                    @panic("TODO called!");
                }
                @panic(comptime "TODO: Maybe(" ++ typeBaseNameT(ReturnType) ++ ")");
            }
            if (hasTodo) {
                return .{ .err = ErrorType.todo() };
            }
            return .{ .err = ErrorType{} };
        }

        pub fn unwrap(this: @This()) !ReturnType {
            return switch (this) {
                .result => |r| r,
                .err => |e| bun.errnoToZigErr(e.errno),
            };
        }

        pub inline fn initErr(e: ErrorType) Maybe(ReturnType, ErrorType) {
            return .{ .err = e };
        }

        pub inline fn asErr(this: *const @This()) ?ErrorType {
            if (this.* == .err) return this.err;
            return null;
        }

        pub inline fn initResult(result: ReturnType) Maybe(ReturnType, ErrorType) {
            return .{ .result = result };
        }

        pub fn toJS(this: @This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            return switch (this) {
                .result => |r| switch (ReturnType) {
                    JSC.JSValue => r,

                    void => .undefined,
                    bool => JSC.JSValue.jsBoolean(r),

                    JSC.ArrayBuffer => r.toJS(globalObject, null),
                    []u8 => JSC.ArrayBuffer.fromBytes(r, .ArrayBuffer).toJS(globalObject, null),

                    else => switch (@typeInfo(ReturnType)) {
                        .Int, .Float, .ComptimeInt, .ComptimeFloat => JSC.JSValue.jsNumber(r),
                        .Struct, .Enum, .Opaque, .Union => r.toJS(globalObject),
                        .Pointer => {
                            if (bun.trait.isZigString(ReturnType))
                                JSC.ZigString.init(bun.asByteSlice(r)).withEncoding().toValueAuto(globalObject);

                            return r.toJS(globalObject);
                        },
                    },
                },
                .err => |e| e.toJSC(globalObject),
            };
        }

        pub fn toArrayBuffer(this: @This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            return switch (this) {
                .result => |r| JSC.ArrayBuffer.fromBytes(r, .ArrayBuffer).toJS(globalObject, null),
                .err => |e| e.toJSC(globalObject),
            };
        }

        pub inline fn getErrno(this: @This()) os.E {
            return switch (this) {
                .result => os.E.SUCCESS,
                .err => |e| @enumFromInt(e.errno),
            };
        }

        pub inline fn errnoSys(rc: anytype, syscall: Syscall.Tag) ?@This() {
            if (comptime Environment.isWindows) {
                if (rc != 0) return null;
            }
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |e| @This(){
                    // always truncate
                    .err = .{
                        .errno = translateToErrInt(e),
                        .syscall = syscall,
                    },
                },
            };
        }

        pub inline fn errno(err: anytype, syscall: Syscall.Tag) @This() {
            return @This(){
                // always truncate
                .err = .{
                    .errno = translateToErrInt(err),
                    .syscall = syscall,
                },
            };
        }

        pub inline fn errnoSysFd(rc: anytype, syscall: Syscall.Tag, fd: bun.FileDescriptor) ?@This() {
            if (comptime Environment.isWindows) {
                if (rc != 0) return null;
            }
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |e| @This(){
                    // Always truncate
                    .err = .{
                        .errno = translateToErrInt(e),
                        .syscall = syscall,
                        .fd = fd,
                    },
                },
            };
        }

        pub inline fn errnoSysP(rc: anytype, syscall: Syscall.Tag, path: anytype) ?@This() {
            if (meta.Child(@TypeOf(path)) == u16) {
                @compileError("Do not pass WString path to errnoSysP, it needs the path encoded as utf8");
            }
            if (comptime Environment.isWindows) {
                if (rc != 0) return null;
            }
            return switch (Syscall.getErrno(rc)) {
                .SUCCESS => null,
                else => |e| @This(){
                    // Always truncate
                    .err = .{
                        .errno = translateToErrInt(e),
                        .syscall = syscall,
                        .path = bun.asByteSlice(path),
                    },
                },
            };
        }
    };
}

inline fn MaybeBuf(comptime T: type) type {
    return Maybe([]T, Syscall.Error);
}

inline fn MaybeSlice(comptime T: type) type {
    return Maybe([]const T, Syscall.Error);
}

fn translateToErrInt(err: anytype) bun.sys.Error.Int {
    return switch (@TypeOf(err)) {
        bun.windows.NTSTATUS => @intFromEnum(bun.windows.translateNTStatusToErrno(err)),
        else => @truncate(@intFromEnum(err)),
    };
}

pub const BlobOrStringOrBuffer = union(enum) {
    blob: JSC.WebCore.Blob,
    string_or_buffer: StringOrBuffer,

    pub fn deinit(this: *const BlobOrStringOrBuffer) void {
        switch (this.*) {
            .blob => |blob| {
                if (blob.store) |store| {
                    store.deref();
                }
            },
            .string_or_buffer => |*str| {
                str.deinit();
            },
        }
    }

    pub fn slice(this: *const BlobOrStringOrBuffer) []const u8 {
        return switch (this.*) {
            .blob => |*blob| blob.sharedView(),
            .string_or_buffer => |*str| str.slice(),
        };
    }

    pub fn fromJS(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue) ?BlobOrStringOrBuffer {
        if (value.as(JSC.WebCore.Blob)) |blob| {
            if (blob.store) |store| {
                store.ref();
            }

            return .{ .blob = blob.* };
        }

        return .{ .string_or_buffer = StringOrBuffer.fromJS(global, allocator, value) orelse return null };
    }

    pub fn fromJSWithEncodingValue(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, encoding_value: JSC.JSValue) ?BlobOrStringOrBuffer {
        if (value.as(JSC.WebCore.Blob)) |blob| {
            if (blob.store) |store| {
                store.ref();
            }

            return .{ .blob = blob.* };
        }

        return .{ .string_or_buffer = StringOrBuffer.fromJSWithEncodingValue(global, allocator, value, encoding_value) orelse return null };
    }
};

pub const StringOrBuffer = union(enum) {
    string: bun.SliceWithUnderlyingString,
    threadsafe_string: bun.SliceWithUnderlyingString,
    encoded_slice: JSC.ZigString.Slice,
    buffer: Buffer,

    pub fn toThreadSafe(this: *@This()) void {
        switch (this.*) {
            .string => {
                this.string.toThreadSafe();
                this.* = .{
                    .threadsafe_string = this.string,
                };
            },
            .threadsafe_string => {},
            .encoded_slice => {},
            .buffer => {},
        }
    }

    pub fn fromJSToOwnedSlice(globalObject: *JSC.JSGlobalObject, value: JSC.JSValue, allocator: std.mem.Allocator) ![]u8 {
        if (value.asArrayBuffer(globalObject)) |array_buffer| {
            defer globalObject.vm().reportExtraMemory(array_buffer.len);

            return try allocator.dupe(u8, array_buffer.byteSlice());
        }

        const str = bun.String.tryFromJS(value, globalObject) orelse return error.JSError;
        defer str.deref();

        const result = try str.toOwnedSlice(allocator);
        defer globalObject.vm().reportExtraMemory(result.len);
        return result;
    }

    pub fn toJS(this: *StringOrBuffer, ctx: JSC.C.JSContextRef) JSC.JSValue {
        return switch (this.*) {
            inline .threadsafe_string, .string => |*str| {
                defer {
                    str.deinit();
                    str.* = .{};
                }

                return str.toJS(ctx);
            },
            .encoded_slice => {
                defer {
                    this.encoded_slice.deinit();
                    this.encoded_slice = .{};
                }

                const str = bun.String.createUTF8(this.encoded_slice.slice());
                defer str.deref();
                return str.toJS(ctx);
            },
            .buffer => {
                if (this.buffer.buffer.value != .zero) {
                    return this.buffer.buffer.value;
                }

                return this.buffer.toNodeBuffer(ctx);
            },
        };
    }

    pub fn slice(this: *const StringOrBuffer) []const u8 {
        return switch (this.*) {
            inline else => |*str| str.slice(),
        };
    }

    pub fn deinit(this: *const StringOrBuffer) void {
        switch (this.*) {
            inline .threadsafe_string, .string => |*str| {
                str.deinit();
            },
            .encoded_slice => |*encoded| {
                encoded.deinit();
            },
            else => {},
        }
    }

    pub fn deinitAndUnprotect(this: *const StringOrBuffer) void {
        switch (this.*) {
            inline .threadsafe_string, .string => |*str| {
                str.deinit();
            },
            .buffer => |buffer| {
                buffer.buffer.value.unprotect();
            },
            .encoded_slice => |*encoded| {
                encoded.deinit();
            },
        }
    }

    pub fn fromJSMaybeAsync(
        global: *JSC.JSGlobalObject,
        allocator: std.mem.Allocator,
        value: JSC.JSValue,
        is_async: bool,
    ) ?StringOrBuffer {
        return switch (value.jsType()) {
            JSC.JSValue.JSType.String, JSC.JSValue.JSType.StringObject, JSC.JSValue.JSType.DerivedStringObject, JSC.JSValue.JSType.Object => {
                const str = bun.String.tryFromJS(value, global) orelse return null;

                if (is_async) {
                    defer str.deref();
                    var possible_clone = str;
                    var sliced = possible_clone.toThreadSafeSlice(allocator);
                    sliced.reportExtraMemory(global.vm());

                    if (sliced.underlying.isEmpty()) {
                        return StringOrBuffer{ .encoded_slice = sliced.utf8 };
                    }

                    return StringOrBuffer{ .threadsafe_string = sliced };
                } else {
                    return StringOrBuffer{ .string = str.toSlice(allocator) };
                }
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
                .buffer = Buffer.fromArrayBuffer(global, value),
            },
            else => null,
        };
    }
    pub fn fromJS(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue) ?StringOrBuffer {
        return fromJSMaybeAsync(global, allocator, value, false);
    }
    pub fn fromJSWithEncoding(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, encoding: Encoding) ?StringOrBuffer {
        return fromJSWithEncodingMaybeAsync(global, allocator, value, encoding, false);
    }

    pub fn fromJSWithEncodingMaybeAsync(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, encoding: Encoding, is_async: bool) ?StringOrBuffer {
        if (value.isCell() and value.jsType().isTypedArray()) {
            return StringOrBuffer{
                .buffer = Buffer.fromTypedArray(global, value),
            };
        }

        if (encoding == .utf8) {
            return fromJSMaybeAsync(global, allocator, value, is_async);
        }

        var str = bun.String.tryFromJS(value, global) orelse return null;
        defer str.deref();
        if (str.isEmpty()) {
            return fromJSMaybeAsync(global, allocator, value, is_async);
        }

        const out = str.encode(encoding);
        defer global.vm().reportExtraMemory(out.len);

        return .{
            .encoded_slice = JSC.ZigString.Slice.init(bun.default_allocator, out),
        };
    }

    pub fn fromJSWithEncodingValue(global: *JSC.JSGlobalObject, allocator: std.mem.Allocator, value: JSC.JSValue, encoding_value: JSC.JSValue) ?StringOrBuffer {
        const encoding: Encoding = brk: {
            if (!encoding_value.isCell())
                break :brk .utf8;
            break :brk Encoding.fromJS(encoding_value, global) orelse .utf8;
        };

        return fromJSWithEncoding(global, allocator, value, encoding);
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
        return map.fromJSCaseInsensitive(global, value);
    }

    /// Caller must verify the value is a string
    pub fn from(slice: []const u8) ?Encoding {
        return strings.inMapCaseInsensitive(slice, map);
    }

    pub fn encodeWithSize(encoding: Encoding, globalObject: *JSC.JSGlobalObject, comptime size: usize, input: *const [size]u8) JSC.JSValue {
        switch (encoding) {
            .base64 => {
                var buf: [std.base64.standard.Encoder.calcSize(size)]u8 = undefined;
                const len = bun.base64.encode(&buf, input);
                return JSC.ZigString.init(buf[0..len]).toValueGC(globalObject);
            },
            .base64url => {
                var buf: [std.base64.url_safe_no_pad.Encoder.calcSize(size)]u8 = undefined;
                const encoded = std.base64.url_safe_no_pad.Encoder.encode(&buf, input);

                return JSC.ZigString.init(buf[0..encoded.len]).toValueGC(globalObject);
            },
            .hex => {
                var buf: [size * 4]u8 = undefined;
                const out = std.fmt.bufPrint(&buf, "{}", .{std.fmt.fmtSliceHexLower(input)}) catch bun.outOfMemory();
                const result = JSC.ZigString.init(out).toValueGC(globalObject);
                return result;
            },
            .buffer => {
                return JSC.ArrayBuffer.createBuffer(globalObject, input);
            },
            inline else => |enc| {
                const res = JSC.WebCore.Encoder.toString(input.ptr, size, globalObject, enc);
                if (res.isError()) {
                    globalObject.throwValue(res);
                    return .zero;
                }

                return res;
            },
        }
    }

    pub fn encodeWithMaxSize(encoding: Encoding, globalObject: *JSC.JSGlobalObject, comptime max_size: usize, input: []const u8) JSC.JSValue {
        switch (encoding) {
            .base64 => {
                var base64_buf: [std.base64.standard.Encoder.calcSize(max_size * 4)]u8 = undefined;
                const encoded_len = bun.base64.encode(&base64_buf, input);
                const encoded, const bytes = bun.String.createUninitialized(.latin1, encoded_len);
                defer encoded.deref();
                @memcpy(@constCast(bytes), base64_buf[0..encoded_len]);
                return encoded.toJS(globalObject);
            },
            .base64url => {
                var buf: [std.base64.url_safe_no_pad.Encoder.calcSize(max_size * 4)]u8 = undefined;
                const encoded = std.base64.url_safe_no_pad.Encoder.encode(&buf, input);

                return JSC.ZigString.init(buf[0..encoded.len]).toValueGC(globalObject);
            },
            .hex => {
                var buf: [max_size * 4]u8 = undefined;
                const out = std.fmt.bufPrint(&buf, "{}", .{std.fmt.fmtSliceHexLower(input)}) catch bun.outOfMemory();
                const result = JSC.ZigString.init(out).toValueGC(globalObject);
                return result;
            },
            .buffer => {
                return JSC.ArrayBuffer.createBuffer(globalObject, input);
            },
            inline else => |enc| {
                const res = JSC.WebCore.Encoder.toString(input.ptr, input.len, globalObject, enc);
                if (res.isError()) {
                    globalObject.throwValue(res);
                    return .zero;
                }

                return res;
            },
        }
    }
};

const PathOrBuffer = union(Tag) {
    path: bun.PathString,
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

pub const PathLike = union(enum) {
    string: bun.PathString,
    buffer: Buffer,
    slice_with_underlying_string: bun.SliceWithUnderlyingString,
    threadsafe_string: bun.SliceWithUnderlyingString,
    encoded_slice: JSC.ZigString.Slice,

    pub fn estimatedSize(this: *const PathLike) usize {
        return switch (this.*) {
            .string => this.string.estimatedSize(),
            .buffer => this.buffer.slice().len,
            .threadsafe_string, .slice_with_underlying_string => 0,
            .encoded_slice => this.encoded_slice.slice().len,
        };
    }

    pub fn deinit(this: *const PathLike) void {
        switch (this.*) {
            .string, .buffer => {},
            inline else => |*str| {
                str.deinit();
            },
        }
    }

    pub fn toThreadSafe(this: *PathLike) void {
        switch (this.*) {
            .slice_with_underlying_string => {
                this.slice_with_underlying_string.toThreadSafe();
                this.* = .{
                    .threadsafe_string = this.slice_with_underlying_string,
                };
            },
            .buffer => {
                this.buffer.buffer.value.protect();
            },
            else => {},
        }
    }

    pub fn deinitAndUnprotect(this: *const PathLike) void {
        switch (this.*) {
            inline .encoded_slice, .threadsafe_string, .slice_with_underlying_string => |*val| {
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
            inline else => |*str| str.slice(),
        };
    }

    pub fn sliceZWithForceCopy(this: PathLike, buf: *bun.PathBuffer, comptime force: bool) if (force) [:0]u8 else [:0]const u8 {
        const sliced = this.slice();

        if (Environment.isWindows) {
            if (std.fs.path.isAbsolute(sliced)) {
                return path_handler.PosixToWinNormalizer.resolveCWDWithExternalBufZ(buf, sliced) catch @panic("Error while resolving path.");
            }
        }

        if (sliced.len == 0) {
            if (comptime !force) return "";

            buf[0] = 0;
            return buf[0..0 :0];
        }

        if (comptime !force) {
            if (sliced[sliced.len - 1] == 0) {
                return sliced[0 .. sliced.len - 1 :0];
            }
        }

        @memcpy(buf[0..sliced.len], sliced);
        buf[sliced.len] = 0;
        return buf[0..sliced.len :0];
    }

    pub inline fn sliceZ(this: PathLike, buf: *bun.PathBuffer) [:0]const u8 {
        return sliceZWithForceCopy(this, buf, false);
    }

    pub inline fn sliceW(this: PathLike, buf: *bun.PathBuffer) [:0]const u16 {
        return strings.toWPath(@alignCast(std.mem.bytesAsSlice(u16, buf)), this.slice());
    }

    pub inline fn osPath(this: PathLike, buf: *bun.PathBuffer) bun.OSPathSliceZ {
        if (comptime Environment.isWindows) {
            return sliceW(this, buf);
        }

        return sliceZWithForceCopy(this, buf, false);
    }

    pub fn toJS(this: *const PathLike, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this.*) {
            .string => this.string.toJS(globalObject, null),
            .buffer => this.buffer.toJS(globalObject),
            inline .threadsafe_string, .slice_with_underlying_string => |*str| str.toJS(globalObject),
            .encoded_slice => |encoded| {
                if (this.encoded_slice.allocator.get()) |allocator| {
                    // Is this a globally-allocated slice?
                    if (allocator.vtable == bun.default_allocator.vtable) {}
                }

                const str = bun.String.createUTF8(encoded.slice());
                defer str.deref();
                return str.toJS(globalObject);
            },
            else => unreachable,
        };
    }

    pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, exception: JSC.C.ExceptionRef) ?PathLike {
        return fromJSWithAllocator(ctx, arguments, bun.default_allocator, exception);
    }
    pub fn fromJSWithAllocator(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, allocator: std.mem.Allocator, exception: JSC.C.ExceptionRef) ?PathLike {
        const arg = arguments.next() orelse return null;
        switch (arg.jsType()) {
            JSC.JSValue.JSType.Uint8Array,
            JSC.JSValue.JSType.DataView,
            => {
                const buffer = Buffer.fromTypedArray(ctx, arg);
                if (exception.* != null) return null;
                if (!Valid.pathBuffer(buffer, ctx, exception)) return null;

                arguments.protectEat();
                return PathLike{ .buffer = buffer };
            },

            JSC.JSValue.JSType.ArrayBuffer => {
                const buffer = Buffer.fromArrayBuffer(ctx, arg);
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
                defer str.deref();

                arguments.eat();

                if (!Valid.pathStringLength(str.length(), ctx, exception)) {
                    return null;
                }

                if (arguments.will_be_async) {
                    var sliced = str.toThreadSafeSlice(allocator);
                    sliced.reportExtraMemory(ctx.vm());

                    if (sliced.underlying.isEmpty()) {
                        return PathLike{ .encoded_slice = sliced.utf8 };
                    }

                    return PathLike{ .threadsafe_string = sliced };
                } else {
                    var sliced = str.toSlice(allocator);

                    // Costs nothing to keep both around.
                    if (sliced.isWTFAllocated()) {
                        str.ref();
                        return PathLike{ .slice_with_underlying_string = sliced };
                    }

                    sliced.reportExtraMemory(ctx.vm());

                    // It is expensive to keep both around.
                    return PathLike{ .encoded_slice = sliced.utf8 };
                }
            },
            else => {
                if (arg.as(JSC.DOMURL)) |domurl| {
                    var str: bun.String = domurl.fileSystemPath();
                    defer str.deref();
                    if (str.isEmpty()) {
                        JSC.throwInvalidArguments("URL must be a non-empty \"file:\" path", .{}, ctx, exception);
                        return null;
                    }
                    arguments.eat();

                    if (!Valid.pathStringLength(str.length(), ctx, exception)) {
                        return null;
                    }

                    if (arguments.will_be_async) {
                        var sliced = str.toThreadSafeSlice(allocator);
                        sliced.reportExtraMemory(ctx.vm());

                        if (sliced.underlying.isEmpty()) {
                            return PathLike{ .encoded_slice = sliced.utf8 };
                        }

                        return PathLike{ .threadsafe_string = sliced };
                    } else {
                        var sliced = str.toSlice(allocator);

                        // Costs nothing to keep both around.
                        if (sliced.isWTFAllocated()) {
                            str.ref();
                            return PathLike{ .slice_with_underlying_string = sliced };
                        }

                        sliced.reportExtraMemory(ctx.vm());

                        // It is expensive to keep both around.
                        return PathLike{ .encoded_slice = sliced.utf8 };
                    }
                }

                return null;
            },
        }
    }
};

pub const Valid = struct {
    pub fn fileDescriptor(fd: i64, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) bool {
        if (fd < 0) {
            JSC.throwInvalidArguments("Invalid file descriptor, must not be negative number", .{}, ctx, exception);
            return false;
        }

        return true;
    }

    pub fn pathSlice(zig_str: JSC.ZigString.Slice, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) bool {
        switch (zig_str.len) {
            0...bun.MAX_PATH_BYTES => return true,
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
            0...bun.MAX_PATH_BYTES => return true,
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
    buffers: std.ArrayList(bun.PlatformIOVec),

    pub fn toJS(this: VectorArrayBuffer, _: *JSC.JSGlobalObject) JSC.JSValue {
        return this.value;
    }

    pub fn fromJS(globalObject: *JSC.JSGlobalObject, val: JSC.JSValue, exception: JSC.C.ExceptionRef, allocator: std.mem.Allocator) ?VectorArrayBuffer {
        if (!val.jsType().isArrayLike()) {
            JSC.throwInvalidArguments("Expected ArrayBufferView[]", .{}, globalObject, exception);
            return null;
        }

        var bufferlist = std.ArrayList(bun.PlatformIOVec).init(allocator);
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

            const buf = array_buffer.byteSlice();
            bufferlist.append(bun.platformIOVecCreate(buf)) catch @panic("Failed to allocate memory for ArrayBuffer[]");
            i += 1;
        }

        return VectorArrayBuffer{ .value = val, .buffers = bufferlist };
    }
};

pub const ArgumentsSlice = struct {
    remaining: []const JSC.JSValue,
    vm: *JSC.VirtualMachine,
    arena: bun.ArenaAllocator = bun.ArenaAllocator.init(bun.default_allocator),
    all: []const JSC.JSValue,
    threw: bool = false,
    protected: std.bit_set.IntegerBitSet(32) = std.bit_set.IntegerBitSet(32).initEmpty(),
    will_be_async: bool = false,

    pub fn unprotect(this: *ArgumentsSlice) void {
        var iter = this.protected.iterator(.{});
        const ctx = this.vm.global;
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
            .arena = bun.ArenaAllocator.init(vm.allocator),
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
    return if (bun.FDImpl.fromJSValidated(value, ctx, exception) catch null) |fd|
        fd.encode()
    else
        null;
}

// Node.js docs:
// > Values can be either numbers representing Unix epoch time in seconds, Dates, or a numeric string like '123456789.0'.
// > If the value can not be converted to a number, or is NaN, Infinity, or -Infinity, an Error will be thrown.
pub fn timeLikeFromJS(globalObject: *JSC.JSGlobalObject, value: JSC.JSValue, _: JSC.C.ExceptionRef) ?TimeLike {
    if (value.jsType() == .JSDate) {
        const milliseconds = value.getUnixTimestamp();
        if (!std.math.isFinite(milliseconds)) {
            return null;
        }

        if (comptime Environment.isWindows) {
            return milliseconds / 1000.0;
        }

        return TimeLike{
            .tv_sec = @intFromFloat(@divFloor(milliseconds, std.time.ms_per_s)),
            .tv_nsec = @intFromFloat(@mod(milliseconds, std.time.ms_per_s) * std.time.ns_per_ms),
        };
    }

    if (!value.isNumber() and !value.isString()) {
        return null;
    }

    const seconds = value.coerce(f64, globalObject);
    if (!std.math.isFinite(seconds)) {
        return null;
    }

    if (comptime Environment.isWindows) {
        return seconds;
    }

    return TimeLike{
        .tv_sec = @intFromFloat(seconds),
        .tv_nsec = @intFromFloat(@mod(seconds, 1.0) * std.time.ns_per_s),
    };
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

        var zig_str = JSC.ZigString.Empty;
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
    fd: bun.FileDescriptor,
    path: PathLike,

    pub const Tag = enum { fd, path };
    pub const SerializeTag = enum(u8) { fd, path };

    /// This will unref() the path string if it is a PathLike.
    /// Does nothing for file descriptors, **does not** close file descriptors.
    pub fn deinit(this: PathOrFileDescriptor) void {
        if (this == .path) {
            this.path.deinit();
        }
    }

    pub fn estimatedSize(this: *const PathOrFileDescriptor) usize {
        return switch (this.*) {
            .path => this.path.estimatedSize(),
            .fd => 0,
        };
    }

    pub fn toThreadSafe(this: *PathOrFileDescriptor) void {
        if (this.* == .path) {
            this.path.toThreadSafe();
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
            .fd => |fd| try writer.print("{}", .{fd}),
        }
    }

    pub fn fromJS(ctx: JSC.C.JSContextRef, arguments: *ArgumentsSlice, allocator: std.mem.Allocator, exception: JSC.C.ExceptionRef) ?JSC.Node.PathOrFileDescriptor {
        const first = arguments.next() orelse return null;

        if (bun.FDImpl.fromJSValidated(first, ctx, exception) catch return null) |fd| {
            arguments.eat();
            return JSC.Node.PathOrFileDescriptor{ .fd = fd.encode() };
        }

        return JSC.Node.PathOrFileDescriptor{
            .path = PathLike.fromJSWithAllocator(ctx, arguments, allocator, exception) orelse return null,
        };
    }

    pub fn toJS(this: JSC.Node.PathOrFileDescriptor, ctx: JSC.C.JSContextRef, exception: JSC.C.ExceptionRef) JSC.C.JSValueRef {
        return switch (this) {
            .path => |path| path.toJS(ctx, exception),
            .fd => |fd| bun.FDImpl.decode(fd).toJS(),
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

/// Stats and BigIntStats classes from node:fs
pub fn StatType(comptime Big: bool) type {
    const Int = if (Big) i64 else i32;
    const Float = if (Big) i64 else f64;
    const Timestamp = if (Big) u64 else u0;

    const Date = packed struct {
        value: Float,
        pub inline fn toJS(this: @This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
            const milliseconds = JSC.JSValue.jsNumber(this.value);
            const array: [1]JSC.C.JSValueRef = .{milliseconds.asObjectRef()};
            return JSC.JSValue.c(JSC.C.JSObjectMakeDate(globalObject, 1, &array, null));
        }
    };

    return extern struct {
        pub usingnamespace if (Big) JSC.Codegen.JSBigIntStats else JSC.Codegen.JSStats;

        // Stats stores these as i32, but BigIntStats stores all of these as i64
        // On windows, these two need to be u64 as the numbers are often very large.
        dev: if (Environment.isWindows) u64 else Int,
        ino: if (Environment.isWindows) u64 else Int,
        mode: Int,
        nlink: Int,
        uid: Int,
        gid: Int,
        rdev: Int,
        blksize: Int,
        blocks: Int,

        // Always store size as a 64-bit integer
        size: i64,

        // _ms is either a float if Small, or a 64-bit integer if Big
        atime_ms: Float,
        mtime_ms: Float,
        ctime_ms: Float,
        birthtime_ms: Float,

        // _ns is a u64 storing nanosecond precision. it is a u0 when not BigIntStats
        atime_ns: Timestamp = 0,
        mtime_ns: Timestamp = 0,
        ctime_ns: Timestamp = 0,
        birthtime_ns: Timestamp = 0,

        const This = @This();

        const StatTimespec = if (Environment.isWindows) bun.windows.libuv.uv_timespec_t else std.os.timespec;

        inline fn toNanoseconds(ts: StatTimespec) Timestamp {
            const tv_sec: i64 = @intCast(ts.tv_sec);
            const tv_nsec: i64 = @intCast(ts.tv_nsec);
            return @as(Timestamp, @intCast(tv_sec * 1_000_000_000)) + @as(Timestamp, @intCast(tv_nsec));
        }

        fn toTimeMS(ts: StatTimespec) Float {
            if (Big) {
                const tv_sec: i64 = @intCast(ts.tv_sec);
                const tv_nsec: i64 = @intCast(ts.tv_nsec);
                return @as(i64, @intCast(tv_sec * std.time.ms_per_s)) + @as(i64, @intCast(@divTrunc(tv_nsec, std.time.ns_per_ms)));
            } else {
                return (@as(f64, @floatFromInt(@max(ts.tv_sec, 0))) * std.time.ms_per_s) + (@as(f64, @floatFromInt(@as(usize, @intCast(@max(ts.tv_nsec, 0))))) / std.time.ns_per_ms);
            }
        }

        const PropertyGetter = fn (this: *This, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue;

        fn getter(comptime field: meta.FieldEnum(This)) PropertyGetter {
            return struct {
                pub fn callback(this: *This, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
                    const value = @field(this, @tagName(field));
                    if (comptime (Big and @typeInfo(@TypeOf(value)) == .Int)) {
                        return JSC.JSValue.fromInt64NoTruncate(globalObject, @intCast(value));
                    }
                    return globalObject.toJS(value, .temporary);
                }
            }.callback;
        }

        fn dateGetter(comptime field: meta.FieldEnum(This)) PropertyGetter {
            return struct {
                pub fn callback(this: *This, globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
                    const value = @field(this, @tagName(field));
                    // Doing `Date{ ... }` here shouldn't actually change the memory layout of `value`
                    // but it will tell comptime code how to convert the i64/f64 to a JS Date.
                    return globalObject.toJS(Date{ .value = value }, .temporary);
                }
            }.callback;
        }

        pub const isBlockDevice_ = JSC.wrapInstanceMethod(This, "isBlockDevice", false);
        pub const isCharacterDevice_ = JSC.wrapInstanceMethod(This, "isCharacterDevice", false);
        pub const isDirectory_ = JSC.wrapInstanceMethod(This, "isDirectory", false);
        pub const isFIFO_ = JSC.wrapInstanceMethod(This, "isFIFO", false);
        pub const isFile_ = JSC.wrapInstanceMethod(This, "isFile", false);
        pub const isSocket_ = JSC.wrapInstanceMethod(This, "isSocket", false);
        pub const isSymbolicLink_ = JSC.wrapInstanceMethod(This, "isSymbolicLink", false);

        pub const isBlockDevice_WithoutTypeChecks = domCall(.isBlockDevice);
        pub const isCharacterDevice_WithoutTypeChecks = domCall(.isCharacterDevice);
        pub const isDirectory_WithoutTypeChecks = domCall(.isDirectory);
        pub const isFIFO_WithoutTypeChecks = domCall(.isFIFO);
        pub const isFile_WithoutTypeChecks = domCall(.isFile);
        pub const isSocket_WithoutTypeChecks = domCall(.isSocket);
        pub const isSymbolicLink_WithoutTypeChecks = domCall(.isSymbolicLink);

        const DOMCallFn = fn (
            *This,
            *JSC.JSGlobalObject,
        ) callconv(.C) JSC.JSValue;
        fn domCall(comptime decl: meta.DeclEnum(This)) DOMCallFn {
            return struct {
                pub fn run(
                    this: *This,
                    _: *JSC.JSGlobalObject,
                ) callconv(.C) JSC.JSValue {
                    return @field(This, @tagName(decl))(this);
                }
            }.run;
        }

        pub const dev = getter(.dev);
        pub const ino = getter(.ino);
        pub const mode = getter(.mode);
        pub const nlink = getter(.nlink);
        pub const uid = getter(.uid);
        pub const gid = getter(.gid);
        pub const rdev = getter(.rdev);
        pub const size = getter(.size);
        pub const blksize = getter(.blksize);
        pub const blocks = getter(.blocks);
        pub const atime = dateGetter(.atime_ms);
        pub const mtime = dateGetter(.mtime_ms);
        pub const ctime = dateGetter(.ctime_ms);
        pub const birthtime = dateGetter(.birthtime_ms);
        pub const atimeMs = getter(.atime_ms);
        pub const mtimeMs = getter(.mtime_ms);
        pub const ctimeMs = getter(.ctime_ms);
        pub const birthtimeMs = getter(.birthtime_ms);
        pub const atimeNs = getter(.atime_ns);
        pub const mtimeNs = getter(.mtime_ns);
        pub const ctimeNs = getter(.ctime_ns);
        pub const birthtimeNs = getter(.birthtime_ns);

        inline fn modeInternal(this: *This) i32 {
            return @truncate(this.mode);
        }

        const S = if (Environment.isWindows) bun.C.S else os.system.S;

        pub fn isBlockDevice(this: *This) JSC.JSValue {
            return JSC.JSValue.jsBoolean(S.ISBLK(@intCast(this.modeInternal())));
        }

        pub fn isCharacterDevice(this: *This) JSC.JSValue {
            return JSC.JSValue.jsBoolean(S.ISCHR(@intCast(this.modeInternal())));
        }

        pub fn isDirectory(this: *This) JSC.JSValue {
            return JSC.JSValue.jsBoolean(S.ISDIR(@intCast(this.modeInternal())));
        }

        pub fn isFIFO(this: *This) JSC.JSValue {
            return JSC.JSValue.jsBoolean(S.ISFIFO(@intCast(this.modeInternal())));
        }

        pub fn isFile(this: *This) JSC.JSValue {
            return JSC.JSValue.jsBoolean(bun.isRegularFile(this.modeInternal()));
        }

        pub fn isSocket(this: *This) JSC.JSValue {
            return JSC.JSValue.jsBoolean(S.ISSOCK(@intCast(this.modeInternal())));
        }

        /// Node.js says this method is only valid on the result of lstat()
        /// so it's fine if we just include it on stat() because it would
        /// still just return false.
        ///
        /// See https://nodejs.org/api/fs.html#statsissymboliclink
        pub fn isSymbolicLink(this: *This) JSC.JSValue {
            return JSC.JSValue.jsBoolean(S.ISLNK(@intCast(this.modeInternal())));
        }

        // TODO: BigIntStats includes a `_checkModeProperty` but I dont think anyone actually uses it.

        pub fn finalize(this: *This) callconv(.C) void {
            bun.destroy(this);
        }

        pub fn init(stat_: bun.Stat) This {
            const aTime = stat_.atime();
            const mTime = stat_.mtime();
            const cTime = stat_.ctime();

            return .{
                .dev = if (Environment.isWindows) stat_.dev else @truncate(@as(i64, @intCast(stat_.dev))),
                .ino = if (Environment.isWindows) stat_.ino else @truncate(@as(i64, @intCast(stat_.ino))),
                .mode = @truncate(@as(i64, @intCast(stat_.mode))),
                .nlink = @truncate(@as(i64, @intCast(stat_.nlink))),
                .uid = @truncate(@as(i64, @intCast(stat_.uid))),
                .gid = @truncate(@as(i64, @intCast(stat_.gid))),
                .rdev = @truncate(@as(i64, @intCast(stat_.rdev))),
                .size = @truncate(@as(i64, @intCast(stat_.size))),
                .blksize = @truncate(@as(i64, @intCast(stat_.blksize))),
                .blocks = @truncate(@as(i64, @intCast(stat_.blocks))),
                .atime_ms = toTimeMS(aTime),
                .mtime_ms = toTimeMS(mTime),
                .ctime_ms = toTimeMS(cTime),
                .atime_ns = if (Big) toNanoseconds(aTime) else 0,
                .mtime_ns = if (Big) toNanoseconds(mTime) else 0,
                .ctime_ns = if (Big) toNanoseconds(cTime) else 0,

                // Linux doesn't include this info in stat
                // maybe it does in statx, but do you really need birthtime? If you do please file an issue.
                .birthtime_ms = if (Environment.isLinux) 0 else toTimeMS(stat_.birthtime()),
                .birthtime_ns = if (Big and !Environment.isLinux) toNanoseconds(stat_.birthtime()) else 0,
            };
        }

        pub fn initWithAllocator(allocator: std.mem.Allocator, stat: bun.Stat) *This {
            const this = allocator.create(This) catch bun.outOfMemory();
            this.* = init(stat);
            return this;
        }

        pub fn constructor(globalObject: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) callconv(.C) ?*This {
            if (Big) {
                globalObject.throwInvalidArguments("BigIntStats is not a constructor", .{});
                return null;
            }

            // dev, mode, nlink, uid, gid, rdev, blksize, ino, size, blocks, atimeMs, mtimeMs, ctimeMs, birthtimeMs
            var args = callFrame.argumentsPtr()[0..@min(callFrame.argumentsCount(), 14)];

            const atime_ms: f64 = if (args.len > 10 and args[10].isNumber()) args[10].asNumber() else 0;
            const mtime_ms: f64 = if (args.len > 11 and args[11].isNumber()) args[11].asNumber() else 0;
            const ctime_ms: f64 = if (args.len > 12 and args[12].isNumber()) args[12].asNumber() else 0;
            const birthtime_ms: f64 = if (args.len > 13 and args[13].isNumber()) args[13].asNumber() else 0;

            const this = bun.new(This, .{
                .dev = if (args.len > 0 and args[0].isNumber()) @intCast(args[0].toInt32()) else 0,
                .mode = if (args.len > 1 and args[1].isNumber()) args[1].toInt32() else 0,
                .nlink = if (args.len > 2 and args[2].isNumber()) args[2].toInt32() else 0,
                .uid = if (args.len > 3 and args[3].isNumber()) args[3].toInt32() else 0,
                .gid = if (args.len > 4 and args[4].isNumber()) args[4].toInt32() else 0,
                .rdev = if (args.len > 5 and args[5].isNumber()) args[5].toInt32() else 0,
                .blksize = if (args.len > 6 and args[6].isNumber()) args[6].toInt32() else 0,
                .ino = if (args.len > 7 and args[7].isNumber()) @intCast(args[7].toInt32()) else 0,
                .size = if (args.len > 8 and args[8].isNumber()) args[8].toInt32() else 0,
                .blocks = if (args.len > 9 and args[9].isNumber()) args[9].toInt32() else 0,
                .atime_ms = atime_ms,
                .mtime_ms = mtime_ms,
                .ctime_ms = ctime_ms,
                .birthtime_ms = birthtime_ms,
            });

            return this;
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
}

pub const StatsSmall = StatType(false);
pub const StatsBig = StatType(true);

/// Union between `Stats` and `BigIntStats` where the type can be decided at runtime
pub const Stats = union(enum) {
    big: StatsBig,
    small: StatsSmall,

    pub inline fn init(stat_: bun.Stat, big: bool) Stats {
        if (big) {
            return .{ .big = StatsBig.init(stat_) };
        } else {
            return .{ .small = StatsSmall.init(stat_) };
        }
    }

    pub fn toJSNewlyCreated(this: *const Stats, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        return switch (this.*) {
            .big => bun.new(StatsBig, this.big).toJS(globalObject),
            .small => bun.new(StatsSmall, this.small).toJS(globalObject),
        };
    }

    pub inline fn toJS(this: *Stats, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        _ = this;
        _ = globalObject;

        @compileError("Only use Stats.toJSNewlyCreated() or Stats.toJS() directly on a StatsBig or StatsSmall");
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

    pub fn toJSNewlyCreated(this: *const Dirent, globalObject: *JSC.JSGlobalObject) JSC.JSValue {
        var out = bun.new(Dirent, this.*);
        return out.toJS(globalObject);
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
        bun.destroy(this);
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

            pub fn emit(this: *List, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
                var i: usize = 0;
                outer: while (true) {
                    var slice = this.list.slice();
                    var callbacks = slice.items(.callback);
                    var once = slice.items(.once);
                    while (i < callbacks.len) : (i += 1) {
                        const callback = callbacks[i];

                        globalObject.enqueueMicrotask1(
                            callback,
                            value,
                        );

                        if (once[i]) {
                            this.once_count -= 1;
                            JSC.C.JSValueUnprotect(globalObject, callback.asObjectRef());
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

            pub fn emit(this: *EventEmitter, event: EventType, globalObject: *JSC.JSGlobalObject, value: JSC.JSValue) void {
                this.listeners.getPtr(event).emit(globalObject, value);
            }

            pub fn removeListener(this: *EventEmitter, ctx: JSC.C.JSContextRef, event: EventType, callback: JSC.JSValue) bool {
                return this.listeners.getPtr(event).remove(ctx, callback);
            }
        };
    }
};

pub const Path = struct {
    const CHAR_BACKWARD_SLASH = '\\';
    const CHAR_COLON = ':';
    const CHAR_DOT = '.';
    const CHAR_FORWARD_SLASH = '/';
    const CHAR_QUESTION_MARK = '?';

    const CHAR_STR_BACKWARD_SLASH = "\\";
    const CHAR_STR_FORWARD_SLASH = "/";
    const CHAR_STR_DOT = ".";

    const StringBuilder = @import("../../string_builder.zig");

    /// Based on Node v21.6.1 path.parse:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L919
    /// The structs returned by parse methods.
    fn PathParsed(comptime T: type) type {
        return struct {
            root: []const T = "",
            dir: []const T = "",
            base: []const T = "",
            ext: []const T = "",
            name: []const T = "",
            pub fn toJSObject(this: @This(), globalObject: *JSC.JSGlobalObject) JSC.JSValue {
                var jsObject = JSC.JSValue.createEmptyObject(globalObject, 5);
                jsObject.put(globalObject, JSC.ZigString.static("root"), toJSString(globalObject, this.root));
                jsObject.put(globalObject, JSC.ZigString.static("dir"), toJSString(globalObject, this.dir));
                jsObject.put(globalObject, JSC.ZigString.static("base"), toJSString(globalObject, this.base));
                jsObject.put(globalObject, JSC.ZigString.static("ext"), toJSString(globalObject, this.ext));
                jsObject.put(globalObject, JSC.ZigString.static("name"), toJSString(globalObject, this.name));
                return jsObject;
            }
        };
    }

    pub fn MAX_PATH_SIZE(comptime T: type) usize {
        return if (T == u16) windows.PATH_MAX_WIDE else bun.MAX_PATH_BYTES;
    }

    pub fn PATH_SIZE(comptime T: type) usize {
        return if (T == u16) PATH_MIN_WIDE else bun.MAX_PATH_BYTES;
    }

    pub const shim = Shimmer("Bun", "Path", @This());
    pub const name = "Bun__Path";
    pub const include = "Path.h";
    pub const namespace = shim.namespace;
    pub const sep_posix = CHAR_FORWARD_SLASH;
    pub const sep_windows = CHAR_BACKWARD_SLASH;
    pub const sep_str_posix = CHAR_STR_FORWARD_SLASH;
    pub const sep_str_windows = CHAR_STR_BACKWARD_SLASH;

    /// Based on Node v21.6.1 private helper formatExt:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L130C10-L130C19
    inline fn formatExtT(comptime T: type, ext: []const T, buf: []T) []const T {
        const len = ext.len;
        if (len == 0) {
            return comptime L(T, "");
        }
        if (ext[0] == CHAR_DOT) {
            return ext;
        }
        const bufSize = len + 1;
        buf[0] = CHAR_DOT;
        @memcpy(buf[1..bufSize], ext);
        return buf[0..bufSize];
    }

    /// Based on Node v21.6.1 private helper posixCwd:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1074
    inline fn posixCwdT(comptime T: type, buf: []T) MaybeBuf(T) {
        const cwd = switch (getCwdT(T, buf)) {
            .result => |r| r,
            .err => |e| return MaybeBuf(T){ .err = e },
        };
        const len = cwd.len;
        if (len == 0) {
            return MaybeBuf(T){ .result = cwd };
        }
        if (comptime Environment.isWindows) {
            // Converts Windows' backslash path separators to POSIX forward slashes
            // and truncates any drive indicator

            // Translated from the following JS code:
            //   const cwd = StringPrototypeReplace(process.cwd(), regexp, '/');
            for (0..len) |i| {
                if (cwd[i] == CHAR_BACKWARD_SLASH) {
                    buf[i] = CHAR_FORWARD_SLASH;
                } else {
                    buf[i] = cwd[i];
                }
            }
            var normalizedCwd = buf[0..len];

            // Translated from the following JS code:
            //   return StringPrototypeSlice(cwd, StringPrototypeIndexOf(cwd, '/'));
            const index = std.mem.indexOfScalar(T, normalizedCwd, CHAR_FORWARD_SLASH);
            // Account for the -1 case of String#slice in JS land
            if (index) |_index| {
                return MaybeBuf(T){ .result = normalizedCwd[_index..len] };
            }
            return MaybeBuf(T){ .result = normalizedCwd[len - 1 .. len] };
        }

        // We're already on POSIX, no need for any transformations
        return MaybeBuf(T){ .result = cwd };
    }

    pub fn getCwdWindowsU8(buf: []u8) MaybeBuf(u8) {
        const u16Buf: bun.WPathBuffer = undefined;
        switch (getCwdWindowsU16(&u16Buf)) {
            .result => |r| {
                // Handles conversion from UTF-16 to UTF-8 including surrogates ;)
                const result = strings.convertUTF16ToUTF8InBuffer(&buf, r) catch {
                    return MaybeBuf(u8).errnoSys(0, Syscall.Tag.getcwd).?;
                };
                return MaybeBuf(u8){ .result = result };
            },
            .err => |e| return MaybeBuf(u8){ .err = e },
        }
    }

    pub fn getCwdWindowsU16(buf: []u16) MaybeBuf(u16) {
        const len: u32 = kernel32.GetCurrentDirectoryW(buf.len, &buf);
        if (len == 0) {
            // Indirectly calls std.os.windows.kernel32.GetLastError().
            return MaybeBuf(u16).errnoSys(0, Syscall.Tag.getcwd).?;
        }
        return MaybeBuf(u16){ .result = buf[0..len] };
    }

    pub fn getCwdWindowsT(comptime T: type, buf: []T) MaybeBuf(T) {
        comptime validatePathT(T, "getCwdWindowsT");
        return if (T == u16)
            getCwdWindowsU16(buf)
        else
            getCwdWindowsU8(buf);
    }

    pub fn getCwdU8(buf: []u8) MaybeBuf(u8) {
        const result = bun.getcwd(buf) catch {
            return MaybeBuf(u8).errnoSys(0, Syscall.Tag.getcwd).?;
        };
        return MaybeBuf(u8){ .result = result };
    }

    pub fn getCwdU16(buf: []u16) MaybeBuf(u16) {
        if (comptime Environment.isWindows) {
            return getCwdWindowsU16(&buf);
        }
        const u8Buf: bun.PathBuffer = undefined;
        const result = strings.convertUTF8toUTF16InBuffer(&buf, bun.getcwd(strings.convertUTF16ToUTF8InBuffer(&u8Buf, buf))) catch {
            return MaybeBuf(u16).errnoSys(0, Syscall.Tag.getcwd).?;
        };
        return MaybeBuf(u16){ .result = result };
    }

    pub fn getCwdT(comptime T: type, buf: []T) MaybeBuf(T) {
        comptime validatePathT(T, "getCwdT");
        return if (T == u16)
            getCwdU16(buf)
        else
            getCwdU8(buf);
    }

    // Alias for naming consistency.
    pub const getCwd = getCwdU8;

    /// Based on Node v21.6.1 path.posix.basename:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1309
    pub fn basenamePosixT(comptime T: type, path: []const T, suffix: ?[]const T) []const T {
        comptime validatePathT(T, "basenamePosixT");

        // validateString of `path` is performed in pub fn basename.
        const len = path.len;
        // Exit early for easier number type use.
        if (len == 0) {
            return comptime L(T, "");
        }
        var start: usize = 0;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var end: ?usize = null;
        var matchedSlash: bool = true;

        const _suffix = if (suffix) |_s| _s else comptime L(T, "");
        const _suffixLen = _suffix.len;
        if (suffix != null and _suffixLen > 0 and _suffixLen <= len) {
            if (std.mem.eql(T, _suffix, path)) {
                return comptime L(T, "");
            }
            // We use an optional value instead of -1, as in Node code, for easier number type use.
            var extIdx: ?usize = _suffixLen - 1;
            // We use an optional value instead of -1, as in Node code, for easier number type use.
            var firstNonSlashEnd: ?usize = null;
            var i_i64 = @as(i64, @intCast(len - 1));
            while (i_i64 >= start) : (i_i64 -= 1) {
                const i = @as(usize, @intCast(i_i64));
                const byte = path[i];
                if (byte == CHAR_FORWARD_SLASH) {
                    // If we reached a path separator that was not part of a set of path
                    // separators at the end of the string, stop now
                    if (!matchedSlash) {
                        start = i + 1;
                        break;
                    }
                } else {
                    if (firstNonSlashEnd == null) {
                        // We saw the first non-path separator, remember this index in case
                        // we need it if the extension ends up not matching
                        matchedSlash = false;
                        firstNonSlashEnd = i + 1;
                    }
                    if (extIdx) |_extIx| {
                        // Try to match the explicit extension
                        if (byte == _suffix[_extIx]) {
                            if (_extIx == 0) {
                                // We matched the extension, so mark this as the end of our path
                                // component
                                end = i;
                                extIdx = null;
                            } else {
                                extIdx = _extIx - 1;
                            }
                        } else {
                            // Extension does not match, so our result is the entire path
                            // component
                            extIdx = null;
                            end = firstNonSlashEnd;
                        }
                    }
                }
            }

            if (end) |_end| {
                if (start == _end) {
                    return path[start..firstNonSlashEnd.?];
                } else {
                    return path[start.._end];
                }
            }
            return path[start..len];
        }

        var i_i64 = @as(i64, @intCast(len - 1));
        while (i_i64 > -1) : (i_i64 -= 1) {
            const i = @as(usize, @intCast(i_i64));
            const byte = path[i];
            if (byte == CHAR_FORWARD_SLASH) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else if (end == null) {
                // We saw the first non-path separator, mark this as the end of our
                // path component
                matchedSlash = false;
                end = i + 1;
            }
        }

        return if (end) |_end|
            path[start.._end]
        else
            comptime L(T, "");
    }

    /// Based on Node v21.6.1 path.win32.basename:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L753
    pub fn basenameWindowsT(comptime T: type, path: []const T, suffix: ?[]const T) []const T {
        comptime validatePathT(T, "basenameWindowsT");

        // validateString of `path` is performed in pub fn basename.
        const len = path.len;
        // Exit early for easier number type use.
        if (len == 0) {
            return comptime L(T, "");
        }

        const isSepT = isSepWindowsT;

        var start: usize = 0;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var end: ?usize = null;
        var matchedSlash: bool = true;

        // Check for a drive letter prefix so as not to mistake the following
        // path separator as an extra separator at the end of the path that can be
        // disregarded
        if (len >= 2 and isWindowsDeviceRootT(T, path[0]) and path[1] == CHAR_COLON) {
            start = 2;
        }

        const _suffix = if (suffix) |_s| _s else comptime L(T, "");
        const _suffixLen = _suffix.len;
        if (suffix != null and _suffixLen > 0 and _suffixLen <= len) {
            if (std.mem.eql(T, _suffix, path)) {
                return comptime L(T, "");
            }
            // We use an optional value instead of -1, as in Node code, for easier number type use.
            var extIdx: ?usize = _suffixLen - 1;
            // We use an optional value instead of -1, as in Node code, for easier number type use.
            var firstNonSlashEnd: ?usize = null;
            var i_i64 = @as(i64, @intCast(len - 1));
            while (i_i64 >= start) : (i_i64 -= 1) {
                const i = @as(usize, @intCast(i_i64));
                const byte = path[i];
                if (isSepT(T, byte)) {
                    // If we reached a path separator that was not part of a set of path
                    // separators at the end of the string, stop now
                    if (!matchedSlash) {
                        start = i + 1;
                        break;
                    }
                } else {
                    if (firstNonSlashEnd == null) {
                        // We saw the first non-path separator, remember this index in case
                        // we need it if the extension ends up not matching
                        matchedSlash = false;
                        firstNonSlashEnd = i + 1;
                    }
                    if (extIdx) |_extIx| {
                        // Try to match the explicit extension
                        if (byte == _suffix[_extIx]) {
                            if (_extIx == 0) {
                                // We matched the extension, so mark this as the end of our path
                                // component
                                end = i;
                                extIdx = null;
                            } else {
                                extIdx = _extIx - 1;
                            }
                        } else {
                            // Extension does not match, so our result is the entire path
                            // component
                            extIdx = null;
                            end = firstNonSlashEnd;
                        }
                    }
                }
            }

            if (end) |_end| {
                if (start == _end) {
                    return path[start..firstNonSlashEnd.?];
                } else {
                    return path[start.._end];
                }
            }
            return path[start..len];
        }

        var i_i64 = @as(i64, @intCast(len - 1));
        while (i_i64 >= start) : (i_i64 -= 1) {
            const i = @as(usize, @intCast(i_i64));
            const byte = path[i];
            if (isSepT(T, byte)) {
                if (!matchedSlash) {
                    start = i + 1;
                    break;
                }
            } else if (end == null) {
                matchedSlash = false;
                end = i + 1;
            }
        }

        return if (end) |_end|
            path[start.._end]
        else
            comptime L(T, "");
    }

    pub inline fn basenamePosixJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T, suffix: ?[]const T) JSC.JSValue {
        return toJSString(globalObject, basenamePosixT(T, path, suffix));
    }

    pub inline fn basenameWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T, suffix: ?[]const T) JSC.JSValue {
        return toJSString(globalObject, basenameWindowsT(T, path, suffix));
    }

    pub inline fn basenameJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, isWindows: bool, path: []const T, suffix: ?[]const T) JSC.JSValue {
        return if (isWindows)
            basenameWindowsJS_T(T, globalObject, path, suffix)
        else
            basenamePosixJS_T(T, globalObject, path, suffix);
    }

    pub fn basename(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        const suffix_ptr: ?JSC.JSValue = if (args_len > 1) args_ptr[1] else null;

        if (suffix_ptr) |_suffix_ptr| {
            // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
            validateString(globalObject, _suffix_ptr, "ext", .{}) catch {
                // Returning .zero translates to a nullprt JSC.JSValue.
                return .zero;
            };
        }

        const path_ptr = if (args_len > 0) args_ptr[0] else JSC.JSValue.jsUndefined();
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validateString(globalObject, path_ptr, "path", .{}) catch {
            return .zero;
        };

        const pathZStr = path_ptr.getZigString(globalObject);
        if (pathZStr.len == 0) return path_ptr;

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, JSC.getAllocator(globalObject));
        const allocator = stack_fallback.get();

        const pathZSlice = pathZStr.toSlice(allocator);
        defer pathZSlice.deinit();

        var suffixZSlice: ?JSC.ZigString.Slice = null;
        if (suffix_ptr) |_suffix_ptr| {
            const suffixZStr = _suffix_ptr.getZigString(globalObject);
            if (suffixZStr.len > 0 and suffixZStr.len <= pathZStr.len) {
                suffixZSlice = suffixZStr.toSlice(allocator);
            }
        }
        defer if (suffixZSlice) |_s| _s.deinit();
        return basenameJS_T(u8, globalObject, isWindows, pathZSlice.slice(), if (suffixZSlice) |_s| _s.slice() else null);
    }

    pub fn create(globalObject: *JSC.JSGlobalObject, isWindows: bool) callconv(.C) JSC.JSValue {
        return shim.cppFn("create", .{ globalObject, isWindows });
    }

    /// Based on Node v21.6.1 path.posix.dirname:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1278
    pub fn dirnamePosixT(comptime T: type, path: []const T) []const T {
        comptime validatePathT(T, "dirnamePosixT");

        // validateString of `path` is performed in pub fn dirname.
        const len = path.len;
        if (len == 0) {
            return comptime L(T, CHAR_STR_DOT);
        }

        const hasRoot = path[0] == CHAR_FORWARD_SLASH;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var end: ?usize = null;
        var matchedSlash: bool = true;
        var i: usize = len - 1;
        while (i >= 1) : (i -= 1) {
            if (path[i] == CHAR_FORWARD_SLASH) {
                if (!matchedSlash) {
                    end = i;
                    break;
                }
            } else {
                // We saw the first non-path separator
                matchedSlash = false;
            }
        }

        if (end) |_end| {
            return if (hasRoot and _end == 1)
                comptime L(T, "//")
            else
                path[0.._end];
        }
        return if (hasRoot)
            comptime L(T, CHAR_STR_FORWARD_SLASH)
        else
            comptime L(T, CHAR_STR_DOT);
    }

    /// Based on Node v21.6.1 path.win32.dirname:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L657
    pub fn dirnameWindowsT(comptime T: type, path: []const T) []const T {
        comptime validatePathT(T, "dirnameWindowsT");

        // validateString of `path` is performed in pub fn dirname.
        const len = path.len;
        if (len == 0) {
            return comptime L(T, CHAR_STR_DOT);
        }

        const isSepT = isSepWindowsT;

        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var rootEnd: ?usize = null;
        var offset: usize = 0;
        const byte0 = path[0];

        if (len == 1) {
            // `path` contains just a path separator, exit early to avoid
            // unnecessary work or a dot.
            return if (isSepT(T, byte0)) path else comptime L(T, CHAR_STR_DOT);
        }

        // Try to match a root
        if (isSepT(T, byte0)) {
            // Possible UNC root

            rootEnd = 1;
            offset = 1;

            if (isSepT(T, path[1])) {
                // Matched double path separator at the beginning
                var j: usize = 2;
                var last: usize = j;

                // Match 1 or more non-path separators
                while (j < len and !isSepT(T, path[j])) {
                    j += 1;
                }

                if (j < len and j != last) {
                    // Matched!
                    last = j;

                    // Match 1 or more path separators
                    while (j < len and isSepT(T, path[j])) {
                        j += 1;
                    }

                    if (j < len and j != last) {
                        // Matched!
                        last = j;

                        // Match 1 or more non-path separators
                        while (j < len and !isSepT(T, path[j])) {
                            j += 1;
                        }

                        if (j == len) {
                            // We matched a UNC root only
                            return path;
                        }

                        if (j != last) {
                            // We matched a UNC root with leftovers

                            // Offset by 1 to include the separator after the UNC root to
                            // treat it as a "normal root" on top of a (UNC) root
                            offset = j + 1;
                            rootEnd = offset;
                        }
                    }
                }
            }
            // Possible device root
        } else if (isWindowsDeviceRootT(T, byte0) and path[1] == CHAR_COLON) {
            offset = if (len > 2 and isSepT(T, path[2])) 3 else 2;
            rootEnd = offset;
        }

        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var end: ?usize = null;
        var matchedSlash: bool = true;

        var i_i64 = @as(i64, @intCast(len - 1));
        while (i_i64 >= offset) : (i_i64 -= 1) {
            const i = @as(usize, @intCast(i_i64));
            if (isSepT(T, path[i])) {
                if (!matchedSlash) {
                    end = i;
                    break;
                }
            } else {
                // We saw the first non-path separator
                matchedSlash = false;
            }
        }

        if (end) |_end| {
            return path[0.._end];
        }

        return if (rootEnd) |_rootEnd|
            path[0.._rootEnd]
        else
            comptime L(T, CHAR_STR_DOT);
    }

    pub inline fn dirnamePosixJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T) JSC.JSValue {
        return toJSString(globalObject, dirnamePosixT(T, path));
    }

    pub inline fn dirnameWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T) JSC.JSValue {
        return toJSString(globalObject, dirnameWindowsT(T, path));
    }

    pub inline fn dirnameJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, isWindows: bool, path: []const T) JSC.JSValue {
        return if (isWindows)
            dirnameWindowsJS_T(T, globalObject, path)
        else
            dirnamePosixJS_T(T, globalObject, path);
    }

    pub fn dirname(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        const path_ptr = if (args_len > 0) args_ptr[0] else JSC.JSValue.jsUndefined();
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validateString(globalObject, path_ptr, "path", .{}) catch {
            // Returning .zero translates to a nullprt JSC.JSValue.
            return .zero;
        };

        const pathZStr = path_ptr.getZigString(globalObject);
        if (pathZStr.len == 0) return toUTF8JSString(globalObject, CHAR_STR_DOT);

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, JSC.getAllocator(globalObject));
        const allocator = stack_fallback.get();

        const pathZSlice = pathZStr.toSlice(allocator);
        defer pathZSlice.deinit();
        return dirnameJS_T(u8, globalObject, isWindows, pathZSlice.slice());
    }

    /// Based on Node v21.6.1 path.posix.extname:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1278
    pub fn extnamePosixT(comptime T: type, path: []const T) []const T {
        comptime validatePathT(T, "extnamePosixT");

        // validateString of `path` is performed in pub fn extname.
        const len = path.len;
        // Exit early for easier number type use.
        if (len == 0) {
            return comptime L(T, "");
        }
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var startDot: ?usize = null;
        var startPart: usize = 0;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var end: ?usize = null;
        var matchedSlash: bool = true;
        // Track the state of characters (if any) we see before our first dot and
        // after any path separator we find

        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var preDotState: ?usize = 0;

        var i_i64 = @as(i64, @intCast(len - 1));
        while (i_i64 > -1) : (i_i64 -= 1) {
            const i = @as(usize, @intCast(i_i64));
            const byte = path[i];
            if (byte == CHAR_FORWARD_SLASH) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }

            if (end == null) {
                // We saw the first non-path separator, mark this as the end of our
                // extension
                matchedSlash = false;
                end = i + 1;
            }

            if (byte == CHAR_DOT) {
                // If this is our first dot, mark it as the start of our extension
                if (startDot == null) {
                    startDot = i;
                } else if (preDotState != null and preDotState.? != 1) {
                    preDotState = 1;
                }
            } else if (startDot != null) {
                // We saw a non-dot and non-path separator before our dot, so we should
                // have a good chance at having a non-empty extension
                preDotState = null;
            }
        }

        const _end = if (end) |_e| _e else 0;
        const _preDotState = if (preDotState) |_p| _p else 0;
        const _startDot = if (startDot) |_s| _s else 0;
        if (startDot == null or
            end == null or
            // We saw a non-dot character immediately before the dot
            (preDotState != null and _preDotState == 0) or
            // The (right-most) trimmed path component is exactly '..'
            (_preDotState == 1 and
            _startDot == _end - 1 and
            _startDot == startPart + 1))
        {
            return comptime L(T, "");
        }

        return path[_startDot.._end];
    }

    /// Based on Node v21.6.1 path.win32.extname:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L840
    pub fn extnameWindowsT(comptime T: type, path: []const T) []const T {
        comptime validatePathT(T, "extnameWindowsT");

        // validateString of `path` is performed in pub fn extname.
        const len = path.len;
        // Exit early for easier number type use.
        if (len == 0) {
            return comptime L(T, "");
        }
        var start: usize = 0;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var startDot: ?usize = null;
        var startPart: usize = 0;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var end: ?usize = null;
        var matchedSlash: bool = true;
        // Track the state of characters (if any) we see before our first dot and
        // after any path separator we find

        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var preDotState: ?usize = 0;

        // Check for a drive letter prefix so as not to mistake the following
        // path separator as an extra separator at the end of the path that can be
        // disregarded

        if (len >= 2 and
            path[1] == CHAR_COLON and
            isWindowsDeviceRootT(T, path[0]))
        {
            start = 2;
            startPart = start;
        }

        var i_i64 = @as(i64, @intCast(len - 1));
        while (i_i64 >= start) : (i_i64 -= 1) {
            const i = @as(usize, @intCast(i_i64));
            const byte = path[i];
            if (isSepWindowsT(T, byte)) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end == null) {
                // We saw the first non-path separator, mark this as the end of our
                // extension
                matchedSlash = false;
                end = i + 1;
            }
            if (byte == CHAR_DOT) {
                // If this is our first dot, mark it as the start of our extension
                if (startDot == null) {
                    startDot = i;
                } else if (preDotState) |_preDotState| {
                    if (_preDotState != 1) {
                        preDotState = 1;
                    }
                }
            } else if (startDot != null) {
                // We saw a non-dot and non-path separator before our dot, so we should
                // have a good chance at having a non-empty extension
                preDotState = null;
            }
        }

        const _end = if (end) |_e| _e else 0;
        const _preDotState = if (preDotState) |_p| _p else 0;
        const _startDot = if (startDot) |_s| _s else 0;
        if (startDot == null or
            end == null or
            // We saw a non-dot character immediately before the dot
            (preDotState != null and _preDotState == 0) or
            // The (right-most) trimmed path component is exactly '..'
            (_preDotState == 1 and
            _startDot == _end - 1 and
            _startDot == startPart + 1))
        {
            return comptime L(T, "");
        }

        return path[_startDot.._end];
    }

    pub inline fn extnamePosixJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T) JSC.JSValue {
        return toJSString(globalObject, extnamePosixT(T, path));
    }

    pub inline fn extnameWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T) JSC.JSValue {
        return toJSString(globalObject, extnameWindowsT(T, path));
    }

    pub inline fn extnameJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, isWindows: bool, path: []const T) JSC.JSValue {
        return if (isWindows)
            extnameWindowsJS_T(T, globalObject, path)
        else
            extnamePosixJS_T(T, globalObject, path);
    }

    pub fn extname(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        const path_ptr = if (args_len > 0) args_ptr[0] else JSC.JSValue.jsUndefined();
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validateString(globalObject, path_ptr, "path", .{}) catch {
            // Returning .zero translates to a nullprt JSC.JSValue.
            return .zero;
        };

        const pathZStr = path_ptr.getZigString(globalObject);
        if (pathZStr.len == 0) return path_ptr;

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, JSC.getAllocator(globalObject));
        const allocator = stack_fallback.get();

        const pathZSlice = pathZStr.toSlice(allocator);
        defer pathZSlice.deinit();
        return extnameJS_T(u8, globalObject, isWindows, pathZSlice.slice());
    }

    /// Based on Node v21.6.1 private helper _format:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L145
    fn _formatT(comptime T: type, pathObject: PathParsed(T), sep: T, buf: []T) []const T {
        comptime validatePathT(T, "_formatT");

        // validateObject of `pathObject` is performed in pub fn format.
        const root = pathObject.root;
        const dir = pathObject.dir;
        const base = pathObject.base;
        const ext = pathObject.ext;
        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        const _name = pathObject.name;

        // Translated from the following JS code:
        //   const dir = pathObject.dir || pathObject.root;
        const dirIsRoot = dir.len == 0 or std.mem.eql(u8, dir, root);
        const dirOrRoot = if (dirIsRoot) root else dir;
        const dirLen = dirOrRoot.len;

        var bufOffset: usize = 0;
        var bufSize: usize = 0;

        // Translated from the following JS code:
        //   const base = pathObject.base ||
        //     `${pathObject.name || ''}${formatExt(pathObject.ext)}`;
        var baseLen = base.len;
        var baseOrNameExt = base;
        if (baseLen > 0) {
            @memcpy(buf[0..baseLen], base);
        } else {
            const formattedExt = formatExtT(T, ext, buf);
            const nameLen = _name.len;
            const extLen = formattedExt.len;
            bufOffset = nameLen;
            bufSize = bufOffset + extLen;
            if (extLen > 0) {
                // Move all bytes to the right by _name.len.
                // Use bun.copy because formattedExt and buf overlap.
                bun.copy(T, buf[bufOffset..bufSize], formattedExt);
            }
            if (nameLen > 0) {
                @memcpy(buf[0..nameLen], _name);
            }
            if (bufSize > 0) {
                baseOrNameExt = buf[0..bufSize];
            }
        }

        // Translated from the following JS code:
        //   if (!dir) {
        //     return base;
        //   }
        if (dirLen == 0) {
            return baseOrNameExt;
        }

        // Translated from the following JS code:
        //   return dir === pathObject.root ? `${dir}${base}` : `${dir}${sep}${base}`;
        baseLen = baseOrNameExt.len;
        if (baseLen > 0) {
            bufOffset = if (dirIsRoot) dirLen else dirLen + 1;
            bufSize = bufOffset + baseLen;
            // Move all bytes to the right by dirLen + (maybe 1 for the separator).
            // Use bun.copy because baseOrNameExt and buf overlap.
            bun.copy(T, buf[bufOffset..bufSize], baseOrNameExt);
        }
        @memcpy(buf[0..dirLen], dirOrRoot);
        bufSize = dirLen + baseLen;
        if (!dirIsRoot) {
            bufSize += 1;
            buf[dirLen] = sep;
        }
        return buf[0..bufSize];
    }

    pub inline fn formatPosixJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, pathObject: PathParsed(T), buf: []T) JSC.JSValue {
        return toJSString(globalObject, _formatT(T, pathObject, CHAR_FORWARD_SLASH, buf));
    }

    pub inline fn formatWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, pathObject: PathParsed(T), buf: []T) JSC.JSValue {
        return toJSString(globalObject, _formatT(T, pathObject, CHAR_BACKWARD_SLASH, buf));
    }

    pub fn formatJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, pathObject: PathParsed(T)) JSC.JSValue {
        const baseLen = pathObject.base.len;
        const dirLen = pathObject.dir.len;
        // Add one for the possible separator.
        const bufLen: usize = @max(1 +
            (if (dirLen > 0) dirLen else pathObject.root.len) +
            (if (baseLen > 0) baseLen else pathObject.name.len + pathObject.ext.len), PATH_SIZE(T));
        const buf = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf);
        return if (isWindows) formatWindowsJS_T(T, globalObject, pathObject, buf) else formatPosixJS_T(T, globalObject, pathObject, buf);
    }

    pub fn format(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        const pathObject_ptr = if (args_len > 0) args_ptr[0] else JSC.JSValue.jsUndefined();
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validateObject(globalObject, pathObject_ptr, "pathObject", .{}, .{}) catch {
            // Returning .zero translates to a nullprt JSC.JSValue.
            return .zero;
        };

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, JSC.getAllocator(globalObject));
        const allocator = stack_fallback.get();

        var root: []const u8 = "";
        if (pathObject_ptr.getTruthy(globalObject, "root")) |jsValue| {
            root = jsValue.toSlice(globalObject, allocator).slice();
        }
        var dir: []const u8 = "";
        if (pathObject_ptr.getTruthy(globalObject, "dir")) |jsValue| {
            dir = jsValue.toSlice(globalObject, allocator).slice();
        }
        var base: []const u8 = "";
        if (pathObject_ptr.getTruthy(globalObject, "base")) |jsValue| {
            base = jsValue.toSlice(globalObject, allocator).slice();
        }
        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        var _name: []const u8 = "";
        if (pathObject_ptr.getTruthy(globalObject, "name")) |jsValue| {
            _name = jsValue.toSlice(globalObject, allocator).slice();
        }
        var ext: []const u8 = "";
        if (pathObject_ptr.getTruthy(globalObject, "ext")) |jsValue| {
            ext = jsValue.toSlice(globalObject, allocator).slice();
        }
        return formatJS_T(u8, globalObject, allocator, isWindows, .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name });
    }

    /// Based on Node v21.6.1 path.posix.isAbsolute:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1159
    pub inline fn isAbsolutePosixT(comptime T: type, path: []const T) bool {
        // validateString of `path` is performed in pub fn isAbsolute.
        return path.len > 0 and path[0] == CHAR_FORWARD_SLASH;
    }

    /// Based on Node v21.6.1 path.win32.isAbsolute:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L406
    pub fn isAbsoluteWindowsT(comptime T: type, path: []const T) bool {
        // validateString of `path` is performed in pub fn isAbsolute.
        const len = path.len;
        if (len == 0)
            return false;

        const byte0 = path[0];
        return isSepWindowsT(T, byte0) or
            // Possible device root
            (len > 2 and
            isWindowsDeviceRootT(T, byte0) and
            path[1] == CHAR_COLON and
            isSepWindowsT(T, path[2]));
    }

    pub fn isAbsolutePosixZigString(pathZStr: JSC.ZigString) bool {
        const pathZStrTrunc = pathZStr.trunc(1);
        return if (pathZStrTrunc.len > 0 and pathZStrTrunc.is16Bit())
            isAbsolutePosixT(u16, pathZStrTrunc.utf16SliceAligned())
        else
            isAbsolutePosixT(u8, pathZStrTrunc.slice());
    }

    pub fn isAbsoluteWindowsZigString(pathZStr: JSC.ZigString) bool {
        return if (pathZStr.len > 0 and pathZStr.is16Bit())
            isAbsoluteWindowsT(u16, @alignCast(pathZStr.utf16Slice()))
        else
            isAbsoluteWindowsT(u8, pathZStr.slice());
    }

    pub fn isAbsolute(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        const path_ptr = if (args_len > 0) args_ptr[0] else JSC.JSValue.jsUndefined();
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validateString(globalObject, path_ptr, "path", .{}) catch {
            // Returning .zero translates to a nullprt JSC.JSValue.
            return .zero;
        };

        const pathZStr = path_ptr.getZigString(globalObject);
        if (pathZStr.len == 0) return JSC.JSValue.jsBoolean(false);
        if (isWindows) return JSC.JSValue.jsBoolean(isAbsoluteWindowsZigString(pathZStr));
        return JSC.JSValue.jsBoolean(isAbsolutePosixZigString(pathZStr));
    }

    pub inline fn isSepPosixT(comptime T: type, byte: T) bool {
        return byte == CHAR_FORWARD_SLASH;
    }

    pub inline fn isSepWindowsT(comptime T: type, byte: T) bool {
        return byte == CHAR_FORWARD_SLASH or byte == CHAR_BACKWARD_SLASH;
    }

    /// Based on Node v21.6.1 private helper isWindowsDeviceRoot:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L60C10-L60C29
    pub inline fn isWindowsDeviceRootT(comptime T: type, byte: T) bool {
        return (byte >= 'A' and byte <= 'Z') or (byte >= 'a' and byte <= 'z');
    }

    /// Based on Node v21.6.1 path.posix.join:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1169
    pub inline fn joinPosixT(comptime T: type, paths: []const []const T, buf: []T, buf2: []T) []const T {
        comptime validatePathT(T, "joinPosixT");

        if (paths.len == 0) {
            return comptime L(T, CHAR_STR_DOT);
        }

        var bufSize: usize = 0;
        var bufOffset: usize = 0;

        // Back joined by expandable buf2 in case it is long.
        var joined: []const T = comptime L(T, "");

        for (paths) |path| {
            // validateString of `path is performed in pub fn join.
            // Back our virtual "joined" string by expandable buf2 in
            // case it is long.
            const len = path.len;
            if (len > 0) {
                // Translated from the following JS code:
                //   if (joined === undefined)
                //     joined = arg;
                //   else
                //     joined += `/${arg}`;
                if (bufSize != 0) {
                    bufOffset = bufSize;
                    bufSize += 1;
                    buf2[bufOffset] = CHAR_FORWARD_SLASH;
                }
                bufOffset = bufSize;
                bufSize += len;
                @memcpy(buf2[bufOffset..bufSize], path);

                joined = buf2[0..bufSize];
            }
        }
        if (bufSize == 0) {
            return comptime L(T, CHAR_STR_DOT);
        }
        return normalizePosixT(T, joined, buf);
    }

    /// Based on Node v21.6.1 path.win32.join:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L425
    pub fn joinWindowsT(comptime T: type, paths: []const []const T, buf: []T, buf2: []T) []const T {
        comptime validatePathT(T, "joinWindowsT");

        if (paths.len == 0) {
            return comptime L(T, CHAR_STR_DOT);
        }

        const isSepT = isSepWindowsT;

        var bufSize: usize = 0;
        var bufOffset: usize = 0;

        // Backed by expandable buf2 in case it is long.
        var joined: []const T = comptime L(T, "");
        var firstPart: []const T = comptime L(T, "");

        for (paths) |path| {
            // validateString of `path` is performed in pub fn join.
            const len = path.len;
            if (len > 0) {
                // Translated from the following JS code:
                //   if (joined === undefined)
                //     joined = firstPart = arg;
                //   else
                //     joined += `\\${arg}`;
                bufOffset = bufSize;
                if (bufSize == 0) {
                    bufSize = len;
                    @memcpy(buf2[0..bufSize], path);

                    joined = buf2[0..bufSize];
                    firstPart = joined;
                } else {
                    bufOffset = bufSize;
                    bufSize += 1;
                    buf2[bufOffset] = CHAR_BACKWARD_SLASH;
                    bufOffset = bufSize;
                    bufSize += len;
                    @memcpy(buf2[bufOffset..bufSize], path);

                    joined = buf2[0..bufSize];
                }
            }
        }
        if (bufSize == 0) {
            return comptime L(T, CHAR_STR_DOT);
        }

        // Make sure that the joined path doesn't start with two slashes, because
        // normalize() will mistake it for a UNC path then.
        //
        // This step is skipped when it is very clear that the user actually
        // intended to point at a UNC path. This is assumed when the first
        // non-empty string arguments starts with exactly two slashes followed by
        // at least one more non-slash character.
        //
        // Note that for normalize() to treat a path as a UNC path it needs to
        // have at least 2 components, so we don't filter for that here.
        // This means that the user can use join to construct UNC paths from
        // a server name and a share name; for example:
        //   path.join('//server', 'share') -> '\\\\server\\share\\')
        var needsReplace: bool = true;
        var slashCount: usize = 0;
        if (isSepT(T, firstPart[0])) {
            slashCount += 1;
            const firstLen = firstPart.len;
            if (firstLen > 1 and
                isSepT(T, firstPart[1]))
            {
                slashCount += 1;
                if (firstLen > 2) {
                    if (isSepT(T, firstPart[2])) {
                        slashCount += 1;
                    } else {
                        // We matched a UNC path in the first part
                        needsReplace = false;
                    }
                }
            }
        }
        if (needsReplace) {
            // Find any more consecutive slashes we need to replace
            while (slashCount < bufSize and
                isSepT(T, joined[slashCount]))
            {
                slashCount += 1;
            }
            // Replace the slashes if needed
            if (slashCount >= 2) {
                // Translated from the following JS code:
                //   joined = `\\${StringPrototypeSlice(joined, slashCount)}`;
                bufOffset = 1;
                bufSize = bufOffset + (bufSize - slashCount);
                // Move all bytes to the right by slashCount - 1.
                // Use bun.copy because joined and buf2 overlap.
                bun.copy(u8, buf2[bufOffset..bufSize], joined[slashCount..]);
                // Prepend the separator.
                buf2[0] = CHAR_BACKWARD_SLASH;

                joined = buf2[0..bufSize];
            }
        }
        return normalizeWindowsT(T, joined, buf);
    }

    pub inline fn joinPosixJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, paths: []const []const T, buf: []T, buf2: []T) JSC.JSValue {
        return toJSString(globalObject, joinPosixT(T, paths, buf, buf2));
    }

    pub inline fn joinWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, paths: []const []const T, buf: []T, buf2: []T) JSC.JSValue {
        return toJSString(globalObject, joinWindowsT(T, paths, buf, buf2));
    }

    pub fn joinJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, paths: []const []const T) JSC.JSValue {
        // Adding 8 bytes when Windows for the possible UNC root.
        var bufLen: usize = if (isWindows) 8 else 0;
        for (paths) |path| bufLen += if (bufLen > 0 and path.len > 0) path.len + 1 else path.len;
        bufLen = @max(bufLen, PATH_SIZE(T));
        const buf = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf);
        const buf2 = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf2);
        return if (isWindows) joinWindowsJS_T(T, globalObject, paths, buf, buf2) else joinPosixJS_T(T, globalObject, paths, buf, buf2);
    }

    pub fn join(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0) return toUTF8JSString(globalObject, CHAR_STR_DOT);

        var arena = bun.ArenaAllocator.init(heap_allocator);
        defer arena.deinit();

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_large, arena.allocator());
        const allocator = stack_fallback.get();

        var paths = allocator.alloc(string, args_len) catch bun.outOfMemory();
        defer allocator.free(paths);

        for (0..args_len, args_ptr) |i, path_ptr| {
            // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
            validateString(globalObject, path_ptr, "paths[{d}]", .{i}) catch {
                // Returning .zero translates to a nullprt JSC.JSValue.
                return .zero;
            };
            const pathZStr = path_ptr.getZigString(globalObject);
            paths[i] = if (pathZStr.len > 0) pathZStr.toSlice(allocator).slice() else "";
        }
        return joinJS_T(u8, globalObject, allocator, isWindows, paths);
    }

    /// Based on Node v21.6.1 private helper normalizeString:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L65C1-L66C77
    ///
    /// Resolves . and .. elements in a path with directory names
    fn normalizeStringT(comptime T: type, path: []const T, allowAboveRoot: bool, separator: T, comptime platform: path_handler.Platform, buf: []T) []const T {
        const len = path.len;
        const isSepT =
            if (platform == .posix)
            isSepPosixT
        else
            isSepWindowsT;

        var bufOffset: usize = 0;
        var bufSize: usize = 0;

        var res: []const T = comptime L(T, "");
        var lastSegmentLength: usize = 0;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var lastSlash: ?usize = null;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var dots: ?usize = 0;
        var byte: T = 0;

        var i: usize = 0;
        while (i <= len) : (i += 1) {
            if (i < len) {
                byte = path[i];
            } else if (isSepT(T, byte)) {
                break;
            } else {
                byte = CHAR_FORWARD_SLASH;
            }

            if (isSepT(T, byte)) {
                // Translated from the following JS code:
                //   if (lastSlash === i - 1 || dots === 1) {
                if ((lastSlash == null and i == 0) or
                    (lastSlash != null and i > 0 and lastSlash.? == i - 1) or
                    (dots != null and dots.? == 1))
                {
                    // NOOP
                } else if (dots != null and dots.? == 2) {
                    if (bufSize < 2 or
                        lastSegmentLength != 2 or
                        buf[bufSize - 1] != CHAR_DOT or
                        buf[bufSize - 2] != CHAR_DOT)
                    {
                        if (bufSize > 2) {
                            const lastSlashIndex = std.mem.lastIndexOfScalar(T, buf[0..bufSize], separator);
                            if (lastSlashIndex == null) {
                                res = comptime L(T, "");
                                bufSize = 0;
                                lastSegmentLength = 0;
                            } else {
                                bufSize = lastSlashIndex.?;
                                res = buf[0..bufSize];
                                // Translated from the following JS code:
                                //   lastSegmentLength =
                                //     res.length - 1 - StringPrototypeLastIndexOf(res, separator);
                                const lastIndexOfSep = std.mem.lastIndexOfScalar(T, buf[0..bufSize], separator);
                                if (lastIndexOfSep == null) {
                                    // Yes (>ლ), Node relies on the -1 result of
                                    // StringPrototypeLastIndexOf(res, separator).
                                    // A - -1 is a positive 1.
                                    // So the code becomes
                                    //   lastSegmentLength = res.length - 1 + 1;
                                    // or
                                    //   lastSegmentLength = res.length;
                                    lastSegmentLength = bufSize;
                                } else {
                                    lastSegmentLength = bufSize - 1 - lastIndexOfSep.?;
                                }
                            }
                            lastSlash = i;
                            dots = 0;
                            continue;
                        } else if (bufSize != 0) {
                            res = comptime L(T, "");
                            bufSize = 0;
                            lastSegmentLength = 0;
                            lastSlash = i;
                            dots = 0;
                            continue;
                        }
                    }
                    if (allowAboveRoot) {
                        // Translated from the following JS code:
                        //   res += res.length > 0 ? `${separator}..` : '..';
                        if (bufSize > 0) {
                            bufOffset = bufSize;
                            bufSize += 1;
                            buf[bufOffset] = separator;
                            bufOffset = bufSize;
                            bufSize += 2;
                            buf[bufOffset] = CHAR_DOT;
                            buf[bufOffset + 1] = CHAR_DOT;
                        } else {
                            bufSize = 2;
                            buf[0] = CHAR_DOT;
                            buf[1] = CHAR_DOT;
                        }

                        res = buf[0..bufSize];
                        lastSegmentLength = 2;
                    }
                } else {
                    // Translated from the following JS code:
                    //   if (res.length > 0)
                    //     res += `${separator}${StringPrototypeSlice(path, lastSlash + 1, i)}`;
                    //   else
                    //     res = StringPrototypeSlice(path, lastSlash + 1, i);
                    if (bufSize > 0) {
                        bufOffset = bufSize;
                        bufSize += 1;
                        buf[bufOffset] = separator;
                    }
                    const sliceStart = if (lastSlash != null) lastSlash.? + 1 else 0;
                    const slice = path[sliceStart..i];

                    bufOffset = bufSize;
                    bufSize += slice.len;
                    @memcpy(buf[bufOffset..bufSize], slice);

                    res = buf[0..bufSize];

                    // Translated from the following JS code:
                    //   lastSegmentLength = i - lastSlash - 1;
                    const subtract = if (lastSlash != null) lastSlash.? + 1 else 2;
                    lastSegmentLength = if (i >= subtract) i - subtract else 0;
                }
                lastSlash = i;
                dots = 0;
                continue;
            } else if (byte == CHAR_DOT and dots != null) {
                dots = if (dots != null) dots.? + 1 else 0;
                continue;
            } else {
                dots = null;
            }
        }

        return res;
    }

    /// Based on Node v21.6.1 path.posix.normalize
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1130
    pub fn normalizePosixT(comptime T: type, path: []const T, buf: []T) []const T {
        comptime validatePathT(T, "normalizePosixT");

        // validateString of `path` is performed in pub fn normalize.
        const len = path.len;
        if (len == 0) {
            return comptime L(T, CHAR_STR_DOT);
        }

        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        const _isAbsolute = path[0] == CHAR_FORWARD_SLASH;
        const trailingSeparator = path[len - 1] == CHAR_FORWARD_SLASH;

        // Normalize the path
        var normalizedPath = normalizeStringT(T, path, !_isAbsolute, CHAR_FORWARD_SLASH, .posix, buf);

        var bufSize: usize = normalizedPath.len;
        if (bufSize == 0) {
            if (_isAbsolute) {
                return comptime L(T, CHAR_STR_FORWARD_SLASH);
            }
            return if (trailingSeparator)
                comptime L(T, "./")
            else
                comptime L(T, CHAR_STR_DOT);
        }

        var bufOffset: usize = 0;

        // Translated from the following JS code:
        //   if (trailingSeparator)
        //     path += '/';
        if (trailingSeparator) {
            bufOffset = bufSize;
            bufSize += 1;
            buf[bufOffset] = CHAR_FORWARD_SLASH;
            normalizedPath = buf[0..bufSize];
        }

        // Translated from the following JS code:
        //   return isAbsolute ? `/${path}` : path;
        if (_isAbsolute) {
            bufOffset = 1;
            bufSize += 1;
            // Move all bytes to the right by 1 for the separator.
            // Use bun.copy because normalizedPath and buf overlap.
            bun.copy(T, buf[bufOffset..bufSize], normalizedPath);
            // Prepend the separator.
            buf[0] = CHAR_FORWARD_SLASH;
            normalizedPath = buf[0..bufSize];
        }
        return normalizedPath[0..bufSize];
    }

    /// Based on Node v21.6.1 path.win32.normalize
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L308
    pub fn normalizeWindowsT(comptime T: type, path: []const T, buf: []T) []const T {
        comptime validatePathT(T, "normalizeWindowsT");

        // validateString of `path` is performed in pub fn normalize.
        const len = path.len;
        if (len == 0) {
            return comptime L(T, CHAR_STR_DOT);
        }

        const isSepT = isSepWindowsT;

        // Moved `rootEnd`, `device`, and `_isAbsolute` initialization after
        // the `if (len == 1)` check.
        const byte0: T = path[0];

        // Try to match a root
        if (len == 1) {
            // `path` contains just a single char, exit early to avoid
            // unnecessary work
            return if (isSepT(T, byte0)) comptime L(T, CHAR_STR_BACKWARD_SLASH) else path;
        }

        var rootEnd: usize = 0;
        // Backed by buf.
        var device: ?[]const T = null;
        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        var _isAbsolute: bool = false;

        var bufOffset: usize = 0;
        var bufSize: usize = 0;

        if (isSepT(T, byte0)) {
            // Possible UNC root

            // If we started with a separator, we know we at least have an absolute
            // path of some kind (UNC or otherwise)
            _isAbsolute = true;

            if (isSepT(T, path[1])) {
                // Matched double path separator at beginning
                var j: usize = 2;
                var last: usize = j;
                // Match 1 or more non-path separators
                while (j < len and
                    !isSepT(T, path[j]))
                {
                    j += 1;
                }
                if (j < len and j != last) {
                    const firstPart: []const u8 = path[last..j];
                    // Matched!
                    last = j;
                    // Match 1 or more path separators
                    while (j < len and
                        isSepT(T, path[j]))
                    {
                        j += 1;
                    }
                    if (j < len and j != last) {
                        // Matched!
                        last = j;
                        // Match 1 or more non-path separators
                        while (j < len and
                            !isSepT(T, path[j]))
                        {
                            j += 1;
                        }
                        if (j == len) {
                            // We matched a UNC root only
                            // Return the normalized version of the UNC root since there
                            // is nothing left to process

                            // Translated from the following JS code:
                            //   return `\\\\${firstPart}\\${StringPrototypeSlice(path, last)}\\`;
                            bufSize = 2;
                            buf[0] = CHAR_BACKWARD_SLASH;
                            buf[1] = CHAR_BACKWARD_SLASH;
                            bufOffset = bufSize;
                            bufSize += firstPart.len;
                            @memcpy(buf[bufOffset..bufSize], firstPart);
                            bufOffset = bufSize;
                            bufSize += 1;
                            buf[bufOffset] = CHAR_BACKWARD_SLASH;
                            bufOffset = bufSize;
                            bufSize += len - last;
                            @memcpy(buf[bufOffset..bufSize], path[last..len]);
                            bufOffset = bufSize;
                            bufSize += 1;
                            buf[bufOffset] = CHAR_BACKWARD_SLASH;
                            return buf[0..bufSize];
                        }
                        if (j != last) {
                            // We matched a UNC root with leftovers

                            // Translated from the following JS code:
                            //   device =
                            //     `\\\\${firstPart}\\${StringPrototypeSlice(path, last, j)}`;
                            //   rootEnd = j;
                            bufSize = 2;
                            buf[0] = CHAR_BACKWARD_SLASH;
                            buf[1] = CHAR_BACKWARD_SLASH;
                            bufOffset = bufSize;
                            bufSize += firstPart.len;
                            @memcpy(buf[bufOffset..bufSize], firstPart);
                            bufOffset = bufSize;
                            bufSize += 1;
                            buf[bufOffset] = CHAR_BACKWARD_SLASH;
                            bufOffset = bufSize;
                            bufSize += j - last;
                            @memcpy(buf[bufOffset..bufSize], path[last..j]);

                            device = buf[0..bufSize];
                            rootEnd = j;
                        }
                    }
                }
            } else {
                rootEnd = 1;
            }
        } else if (isWindowsDeviceRootT(T, byte0) and
            path[1] == CHAR_COLON)
        {
            // Possible device root
            buf[0] = byte0;
            buf[1] = CHAR_COLON;
            device = buf[0..2];
            rootEnd = 2;
            if (len > 2 and isSepT(T, path[2])) {
                // Treat separator following drive name as an absolute path
                // indicator
                _isAbsolute = true;
                rootEnd = 3;
            }
        }

        bufOffset = (if (device) |_d| _d.len else 0) + @intFromBool(_isAbsolute);
        // Backed by buf at an offset of  device.len + 1 if _isAbsolute is true.
        var tailLen = if (rootEnd < len) normalizeStringT(T, path[rootEnd..len], !_isAbsolute, CHAR_BACKWARD_SLASH, .windows, buf[bufOffset..]).len else 0;
        if (tailLen == 0 and !_isAbsolute) {
            buf[bufOffset] = CHAR_DOT;
            tailLen = 1;
        }

        if (tailLen > 0 and
            isSepT(T, path[len - 1]))
        {
            // Translated from the following JS code:
            //   tail += '\\';
            buf[bufOffset + tailLen] = CHAR_BACKWARD_SLASH;
            tailLen += 1;
        }

        bufSize = bufOffset + tailLen;
        // Translated from the following JS code:
        //   if (device === undefined) {
        //     return isAbsolute ? `\\${tail}` : tail;
        //   }
        //   return isAbsolute ? `${device}\\${tail}` : `${device}${tail}`;
        if (_isAbsolute) {
            bufOffset -= 1;
            // Prepend the separator.
            buf[bufOffset] = CHAR_BACKWARD_SLASH;
        }
        return buf[0..bufSize];
    }

    pub inline fn normalizePosixJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T, buf: []T) JSC.JSValue {
        return toJSString(globalObject, normalizePosixT(T, path, buf));
    }

    pub inline fn normalizeWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T, buf: []T) JSC.JSValue {
        return toJSString(globalObject, normalizeWindowsT(T, path, buf));
    }

    pub fn normalizeJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, path: []const T) JSC.JSValue {
        const bufLen = @max(path.len, PATH_SIZE(T));
        const buf = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf);
        return if (isWindows) normalizeWindowsJS_T(T, globalObject, path, buf) else normalizePosixJS_T(T, globalObject, path, buf);
    }

    pub fn normalize(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        const path_ptr = if (args_len > 0) args_ptr[0] else JSC.JSValue.jsUndefined();
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validateString(globalObject, path_ptr, "path", .{}) catch {
            // Returning .zero translates to a nullprt JSC.JSValue.
            return .zero;
        };
        const pathZStr = path_ptr.getZigString(globalObject);
        const len = pathZStr.len;
        if (len == 0) return toUTF8JSString(globalObject, CHAR_STR_DOT);

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, JSC.getAllocator(globalObject));
        const allocator = stack_fallback.get();

        const pathZSlice = pathZStr.toSlice(allocator);
        defer pathZSlice.deinit();
        return normalizeJS_T(u8, globalObject, allocator, isWindows, pathZSlice.slice());
    }

    // Based on Node v21.6.1 path.posix.parse
    // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1452
    pub fn parsePosixT(comptime T: type, path: []const T) PathParsed(T) {
        comptime validatePathT(T, "parsePosixT");

        // validateString of `path` is performed in pub fn parse.
        const len = path.len;
        if (len == 0) {
            return .{};
        }

        var root: []const T = comptime L(T, "");
        var dir: []const T = comptime L(T, "");
        var base: []const T = comptime L(T, "");
        var ext: []const T = comptime L(T, "");
        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        var _name: []const T = comptime L(T, "");
        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        const _isAbsolute = path[0] == CHAR_FORWARD_SLASH;
        var start: usize = 0;
        if (_isAbsolute) {
            root = comptime L(T, CHAR_STR_FORWARD_SLASH);
            start = 1;
        }

        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var startDot: ?usize = null;
        var startPart: usize = 0;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var end: ?usize = null;
        var matchedSlash = true;
        var i_i64 = @as(i64, @intCast(len - 1));

        // Track the state of characters (if any) we see before our first dot and
        // after any path separator we find

        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var preDotState: ?usize = 0;

        // Get non-dir info
        while (i_i64 >= start) : (i_i64 -= 1) {
            const i = @as(usize, @intCast(i_i64));
            const byte = path[i];
            if (byte == CHAR_FORWARD_SLASH) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end == null) {
                // We saw the first non-path separator, mark this as the end of our
                // extension
                matchedSlash = false;
                end = i + 1;
            }
            if (byte == CHAR_DOT) {
                // If this is our first dot, mark it as the start of our extension
                if (startDot == null) {
                    startDot = i;
                } else if (preDotState) |_preDotState| {
                    if (_preDotState != 1) {
                        preDotState = 1;
                    }
                }
            } else if (startDot != null) {
                // We saw a non-dot and non-path separator before our dot, so we should
                // have a good chance at having a non-empty extension
                preDotState = null;
            }
        }

        if (end) |_end| {
            const _preDotState = if (preDotState) |_p| _p else 0;
            const _startDot = if (startDot) |_s| _s else 0;
            start = if (startPart == 0 and _isAbsolute) 1 else startPart;
            if (startDot == null or
                // We saw a non-dot character immediately before the dot
                (preDotState != null and _preDotState == 0) or
                // The (right-most) trimmed path component is exactly '..'
                (_preDotState == 1 and
                _startDot == _end - 1 and
                _startDot == startPart + 1))
            {
                _name = path[start.._end];
                base = _name;
            } else {
                _name = path[start.._startDot];
                base = path[start.._end];
                ext = path[_startDot.._end];
            }
        }

        if (startPart > 0) {
            dir = path[0..(startPart - 1)];
        } else if (_isAbsolute) {
            dir = comptime L(T, CHAR_STR_FORWARD_SLASH);
        }

        return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
    }

    // Based on Node v21.6.1 path.win32.parse
    // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L916
    pub fn parseWindowsT(comptime T: type, path: []const T) PathParsed(T) {
        comptime validatePathT(T, "parseWindowsT");

        // validateString of `path` is performed in pub fn parse.
        var root: []const T = comptime L(T, "");
        var dir: []const T = comptime L(T, "");
        var base: []const T = comptime L(T, "");
        var ext: []const T = comptime L(T, "");
        // Prefix with _ to avoid shadowing the identifier in the outer scope.
        var _name: []const T = comptime L(T, "");

        const len = path.len;
        if (len == 0) {
            return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
        }

        const isSepT = isSepWindowsT;

        var rootEnd: usize = 0;
        var byte = path[0];

        if (len == 1) {
            if (isSepT(T, byte)) {
                // `path` contains just a path separator, exit early to avoid
                // unnecessary work
                root = path;
                dir = path;
            } else {
                base = path;
                _name = path;
            }
            return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
        }

        // Try to match a root
        if (isSepT(T, byte)) {
            // Possible UNC root

            rootEnd = 1;
            if (isSepT(T, path[1])) {
                // Matched double path separator at the beginning
                var j: usize = 2;
                var last: usize = j;
                // Match 1 or more non-path separators
                while (j < len and
                    !isSepT(T, path[j]))
                {
                    j += 1;
                }
                if (j < len and j != last) {
                    // Matched!
                    last = j;
                    // Match 1 or more path separators
                    while (j < len and
                        isSepT(T, path[j]))
                    {
                        j += 1;
                    }
                    if (j < len and j != last) {
                        // Matched!
                        last = j;
                        // Match 1 or more non-path separators
                        while (j < len and
                            !isSepT(T, path[j]))
                        {
                            j += 1;
                        }
                        if (j == len) {
                            // We matched a UNC root only
                            rootEnd = j;
                        } else if (j != last) {
                            // We matched a UNC root with leftovers
                            rootEnd = j + 1;
                        }
                    }
                }
            }
        } else if (isWindowsDeviceRootT(T, byte) and
            path[1] == CHAR_COLON)
        {
            // Possible device root
            if (len <= 2) {
                // `path` contains just a drive root, exit early to avoid
                // unnecessary work
                root = path;
                dir = path;
                return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
            }
            rootEnd = 2;
            if (isSepT(T, path[2])) {
                if (len == 3) {
                    // `path` contains just a drive root, exit early to avoid
                    // unnecessary work
                    root = path;
                    dir = path;
                    return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
                }
                rootEnd = 3;
            }
        }
        if (rootEnd > 0) {
            root = path[0..rootEnd];
        }

        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var startDot: ?usize = null;
        var startPart = rootEnd;
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var end: ?usize = null;
        var matchedSlash = true;
        var i_i64 = @as(i64, @intCast(len - 1));

        // Track the state of characters (if any) we see before our first dot and
        // after any path separator we find

        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var preDotState: ?usize = 0;

        // Get non-dir info
        while (i_i64 >= rootEnd) : (i_i64 -= 1) {
            const i = @as(usize, @intCast(i_i64));
            byte = path[i];
            if (isSepT(T, byte)) {
                // If we reached a path separator that was not part of a set of path
                // separators at the end of the string, stop now
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end == null) {
                // We saw the first non-path separator, mark this as the end of our
                // extension
                matchedSlash = false;
                end = i + 1;
            }
            if (byte == CHAR_DOT) {
                // If this is our first dot, mark it as the start of our extension
                if (startDot == null) {
                    startDot = i;
                } else if (preDotState) |_preDotState| {
                    if (_preDotState != 1) {
                        preDotState = 1;
                    }
                }
            } else if (startDot != null) {
                // We saw a non-dot and non-path separator before our dot, so we should
                // have a good chance at having a non-empty extension
                preDotState = null;
            }
        }

        if (end) |_end| {
            const _preDotState = if (preDotState) |_p| _p else 0;
            const _startDot = if (startDot) |_s| _s else 0;
            if (startDot == null or
                // We saw a non-dot character immediately before the dot
                (preDotState != null and _preDotState == 0) or
                // The (right-most) trimmed path component is exactly '..'
                (_preDotState == 1 and
                _startDot == _end - 1 and
                _startDot == startPart + 1))
            {
                // Prefix with _ to avoid shadowing the identifier in the outer scope.
                _name = path[startPart.._end];
                base = _name;
            } else {
                _name = path[startPart.._startDot];
                base = path[startPart.._end];
                ext = path[_startDot.._end];
            }
        }

        // If the directory is the root, use the entire root as the `dir` including
        // the trailing slash if any (`C:\abc` -> `C:\`). Otherwise, strip out the
        // trailing slash (`C:\abc\def` -> `C:\abc`).
        if (startPart > 0 and startPart != rootEnd) {
            dir = path[0..(startPart - 1)];
        } else {
            dir = root;
        }

        return .{ .root = root, .dir = dir, .base = base, .ext = ext, .name = _name };
    }

    pub inline fn parsePosixJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T) JSC.JSValue {
        return parsePosixT(T, path).toJSObject(globalObject);
    }

    pub inline fn parseWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T) JSC.JSValue {
        return parseWindowsT(T, path).toJSObject(globalObject);
    }

    pub inline fn parseJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, isWindows: bool, path: []const T) JSC.JSValue {
        return if (isWindows) parseWindowsJS_T(T, globalObject, path) else parsePosixJS_T(T, globalObject, path);
    }

    pub fn parse(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        const path_ptr = if (args_len > 0) args_ptr[0] else JSC.JSValue.jsUndefined();
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validateString(globalObject, path_ptr, "path", .{}) catch {
            // Returning .zero translates to a nullprt JSC.JSValue.
            return .zero;
        };

        const pathZStr = path_ptr.getZigString(globalObject);
        if (pathZStr.len == 0) return (PathParsed(u8){}).toJSObject(globalObject);

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, JSC.getAllocator(globalObject));
        const allocator = stack_fallback.get();

        const pathZSlice = pathZStr.toSlice(allocator);
        defer pathZSlice.deinit();
        return parseJS_T(u8, globalObject, isWindows, pathZSlice.slice());
    }

    /// Based on Node v21.6.1 path.posix.relative:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1193
    pub fn relativePosixT(comptime T: type, from: []const T, to: []const T, buf: []T, buf2: []T, buf3: []T) MaybeSlice(T) {
        comptime validatePathT(T, "relativePosixT");

        // validateString of `from` and `to` are performed in pub fn relative.
        if (std.mem.eql(T, from, to)) {
            return MaybeSlice(T){ .result = comptime L(T, "") };
        }

        // Trim leading forward slashes.
        // Backed by expandable buf2 because fromOrig may be long.
        const fromOrig = switch (resolvePosixT(T, &.{from}, buf2, buf3)) {
            .result => |r| r,
            .err => |e| return MaybeSlice(T){ .err = e },
        };
        const fromOrigLen = fromOrig.len;
        // Backed by buf.
        const toOrig = switch (resolvePosixT(T, &.{to}, buf, buf3)) {
            .result => |r| r,
            .err => |e| return MaybeSlice(T){ .err = e },
        };

        if (std.mem.eql(T, fromOrig, toOrig)) {
            return MaybeSlice(T){ .result = comptime L(T, "") };
        }

        const fromStart = 1;
        const fromEnd = fromOrigLen;
        const fromLen = fromEnd - fromStart;
        const toOrigLen = toOrig.len;
        var toStart: usize = 1;
        const toLen = toOrigLen - toStart;

        // Compare paths to find the longest common path from root
        const smallestLength = @min(fromLen, toLen);
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var lastCommonSep: ?usize = null;

        var matchesAllOfSmallest = false;
        // Add a block to isolate `i`.
        {
            var i: usize = 0;
            while (i < smallestLength) : (i += 1) {
                const fromByte = fromOrig[fromStart + i];
                if (fromByte != toOrig[toStart + i]) {
                    break;
                } else if (fromByte == CHAR_FORWARD_SLASH) {
                    lastCommonSep = i;
                }
            }
            matchesAllOfSmallest = i == smallestLength;
        }
        if (matchesAllOfSmallest) {
            if (toLen > smallestLength) {
                if (toOrig[toStart + smallestLength] == CHAR_FORWARD_SLASH) {
                    // We get here if `from` is the exact base path for `to`.
                    // For example: from='/foo/bar'; to='/foo/bar/baz'
                    return MaybeSlice(T){ .result = toOrig[toStart + smallestLength + 1 .. toOrigLen] };
                }
                if (smallestLength == 0) {
                    // We get here if `from` is the root
                    // For example: from='/'; to='/foo'
                    return MaybeSlice(T){ .result = toOrig[toStart + smallestLength .. toOrigLen] };
                }
            } else if (fromLen > smallestLength) {
                if (fromOrig[fromStart + smallestLength] == CHAR_FORWARD_SLASH) {
                    // We get here if `to` is the exact base path for `from`.
                    // For example: from='/foo/bar/baz'; to='/foo/bar'
                    lastCommonSep = smallestLength;
                } else if (smallestLength == 0) {
                    // We get here if `to` is the root.
                    // For example: from='/foo/bar'; to='/'
                    lastCommonSep = 0;
                }
            }
        }

        var bufOffset: usize = 0;
        var bufSize: usize = 0;

        // Backed by buf3.
        var out: []const T = comptime L(T, "");
        // Add a block to isolate `i`.
        {
            // Generate the relative path based on the path difference between `to`
            // and `from`.

            // Translated from the following JS code:
            //  for (i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i) {
            var i: usize = fromStart + (if (lastCommonSep != null) lastCommonSep.? + 1 else 0);
            while (i <= fromEnd) : (i += 1) {
                if (i == fromEnd or fromOrig[i] == CHAR_FORWARD_SLASH) {
                    // Translated from the following JS code:
                    //   out += out.length === 0 ? '..' : '/..';
                    if (out.len > 0) {
                        bufOffset = bufSize;
                        bufSize += 3;
                        buf3[bufOffset] = CHAR_FORWARD_SLASH;
                        buf3[bufOffset + 1] = CHAR_DOT;
                        buf3[bufOffset + 2] = CHAR_DOT;
                    } else {
                        bufSize = 2;
                        buf3[0] = CHAR_DOT;
                        buf3[1] = CHAR_DOT;
                    }
                    out = buf3[0..bufSize];
                }
            }
        }

        // Lastly, append the rest of the destination (`to`) path that comes after
        // the common path parts.

        // Translated from the following JS code:
        //   return `${out}${StringPrototypeSlice(to, toStart + lastCommonSep)}`;
        toStart = if (lastCommonSep != null) toStart + lastCommonSep.? else 0;
        const sliceSize = toOrigLen - toStart;
        const outLen = out.len;
        bufSize = outLen;
        if (sliceSize > 0) {
            bufOffset = bufSize;
            bufSize += sliceSize;
            // Use bun.copy because toOrig and buf overlap.
            bun.copy(T, buf[bufOffset..bufSize], toOrig[toStart..toOrigLen]);
        }
        if (outLen > 0) {
            @memcpy(buf[0..outLen], out);
        }
        return MaybeSlice(T){ .result = buf[0..bufSize] };
    }

    /// Based on Node v21.6.1 path.win32.relative:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L500
    pub fn relativeWindowsT(comptime T: type, from: []const T, to: []const T, buf: []T, buf2: []T, buf3: []T) MaybeSlice(T) {
        comptime validatePathT(T, "relativeWindowsT");

        // validateString of `from` and `to` are performed in pub fn relative.
        if (std.mem.eql(T, from, to)) {
            return MaybeSlice(T){ .result = comptime L(T, "") };
        }

        // Backed by expandable buf2 because fromOrig may be long.
        const fromOrig = switch (resolveWindowsT(T, &.{from}, buf2, buf3)) {
            .result => |r| r,
            .err => |e| return MaybeSlice(T){ .err = e },
        };
        const fromOrigLen = fromOrig.len;
        // Backed by buf.
        const toOrig = switch (resolveWindowsT(T, &.{to}, buf, buf3)) {
            .result => |r| r,
            .err => |e| return MaybeSlice(T){ .err = e },
        };

        if (std.mem.eql(T, fromOrig, toOrig) or
            eqlIgnoreCaseT(T, fromOrig, toOrig))
        {
            return MaybeSlice(T){ .result = comptime L(T, "") };
        }

        const toOrigLen = toOrig.len;

        // Trim leading backslashes
        var fromStart: usize = 0;
        while (fromStart < fromOrigLen and
            fromOrig[fromStart] == CHAR_BACKWARD_SLASH)
        {
            fromStart += 1;
        }

        // Trim trailing backslashes (applicable to UNC paths only)
        var fromEnd = fromOrigLen;
        while (fromEnd - 1 > fromStart and
            fromOrig[fromEnd - 1] == CHAR_BACKWARD_SLASH)
        {
            fromEnd -= 1;
        }

        const fromLen = fromEnd - fromStart;

        // Trim leading backslashes
        var toStart: usize = 0;
        while (toStart < toOrigLen and
            toOrig[toStart] == CHAR_BACKWARD_SLASH)
        {
            toStart = toStart + 1;
        }

        // Trim trailing backslashes (applicable to UNC paths only)
        var toEnd = toOrigLen;
        while (toEnd - 1 > toStart and
            toOrig[toEnd - 1] == CHAR_BACKWARD_SLASH)
        {
            toEnd -= 1;
        }

        const toLen = toEnd - toStart;

        // Compare paths to find the longest common path from root
        const smallestLength = @min(fromLen, toLen);
        // We use an optional value instead of -1, as in Node code, for easier number type use.
        var lastCommonSep: ?usize = null;

        var matchesAllOfSmallest = false;
        // Add a block to isolate `i`.
        {
            var i: usize = 0;
            while (i < smallestLength) : (i += 1) {
                const fromByte = fromOrig[fromStart + i];
                if (toLowerT(T, fromByte) != toLowerT(T, toOrig[toStart + i])) {
                    break;
                } else if (fromByte == CHAR_BACKWARD_SLASH) {
                    lastCommonSep = i;
                }
            }
            matchesAllOfSmallest = i == smallestLength;
        }

        // We found a mismatch before the first common path separator was seen, so
        // return the original `to`.
        if (!matchesAllOfSmallest) {
            if (lastCommonSep == null) {
                return MaybeSlice(T){ .result = toOrig };
            }
        } else {
            if (toLen > smallestLength) {
                if (toOrig[toStart + smallestLength] == CHAR_BACKWARD_SLASH) {
                    // We get here if `from` is the exact base path for `to`.
                    // For example: from='C:\foo\bar'; to='C:\foo\bar\baz'
                    return MaybeSlice(T){ .result = toOrig[toStart + smallestLength + 1 .. toOrigLen] };
                }
                if (smallestLength == 2) {
                    // We get here if `from` is the device root.
                    // For example: from='C:\'; to='C:\foo'
                    return MaybeSlice(T){ .result = toOrig[toStart + smallestLength .. toOrigLen] };
                }
            }
            if (fromLen > smallestLength) {
                if (fromOrig[fromStart + smallestLength] == CHAR_BACKWARD_SLASH) {
                    // We get here if `to` is the exact base path for `from`.
                    // For example: from='C:\foo\bar'; to='C:\foo'
                    lastCommonSep = smallestLength;
                } else if (smallestLength == 2) {
                    // We get here if `to` is the device root.
                    // For example: from='C:\foo\bar'; to='C:\'
                    lastCommonSep = 3;
                }
            }
            if (lastCommonSep == null) {
                lastCommonSep = 0;
            }
        }

        var bufOffset: usize = 0;
        var bufSize: usize = 0;

        // Backed by buf3.
        var out: []const T = comptime L(T, "");
        // Add a block to isolate `i`.
        {
            // Generate the relative path based on the path difference between `to`
            // and `from`.
            var i: usize = fromStart + (if (lastCommonSep != null) lastCommonSep.? + 1 else 0);
            while (i <= fromEnd) : (i += 1) {
                if (i == fromEnd or fromOrig[i] == CHAR_BACKWARD_SLASH) {
                    // Translated from the following JS code:
                    //   out += out.length === 0 ? '..' : '\\..';
                    if (out.len > 0) {
                        bufOffset = bufSize;
                        bufSize += 3;
                        buf3[bufOffset] = CHAR_BACKWARD_SLASH;
                        buf3[bufOffset + 1] = CHAR_DOT;
                        buf3[bufOffset + 2] = CHAR_DOT;
                    } else {
                        bufSize = 2;
                        buf3[0] = CHAR_DOT;
                        buf3[1] = CHAR_DOT;
                    }
                    out = buf3[0..bufSize];
                }
            }
        }

        // Translated from the following JS code:
        //   toStart += lastCommonSep;
        if (lastCommonSep == null) {
            // If toStart would go negative make it toOrigLen - 1 to
            // mimic String#slice with a negative start.
            toStart = if (toStart > 0) toStart - 1 else toOrigLen - 1;
        } else {
            toStart += lastCommonSep.?;
        }

        // Lastly, append the rest of the destination (`to`) path that comes after
        // the common path parts
        const outLen = out.len;
        if (outLen > 0) {
            const sliceSize = toEnd - toStart;
            bufSize = outLen;
            if (sliceSize > 0) {
                bufOffset = bufSize;
                bufSize += sliceSize;
                // Use bun.copy because toOrig and buf overlap.
                bun.copy(T, buf[bufOffset..bufSize], toOrig[toStart..toEnd]);
            }
            @memcpy(buf[0..outLen], out);
            return MaybeSlice(T){ .result = buf[0..bufSize] };
        }

        if (toOrig[toStart] == CHAR_BACKWARD_SLASH) {
            toStart += 1;
        }
        return MaybeSlice(T){ .result = toOrig[toStart..toEnd] };
    }

    pub inline fn relativePosixJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, from: []const T, to: []const T, buf: []T, buf2: []T, buf3: []T) JSC.JSValue {
        return switch (relativePosixT(T, from, to, buf, buf2, buf3)) {
            .result => |r| toJSString(globalObject, r),
            .err => |e| e.toJSC(globalObject),
        };
    }

    pub inline fn relativeWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, from: []const T, to: []const T, buf: []T, buf2: []T, buf3: []T) JSC.JSValue {
        return switch (relativeWindowsT(T, from, to, buf, buf2, buf3)) {
            .result => |r| toJSString(globalObject, r),
            .err => |e| e.toJSC(globalObject),
        };
    }

    pub fn relativeJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, from: []const T, to: []const T) JSC.JSValue {
        const bufLen = @max(from.len + to.len, PATH_SIZE(T));
        const buf = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf);
        const buf2 = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf2);
        const buf3 = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf3);
        return if (isWindows) relativeWindowsJS_T(T, globalObject, from, to, buf, buf2, buf3) else relativePosixJS_T(T, globalObject, from, to, buf, buf2, buf3);
    }

    pub fn relative(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        const from_ptr = if (args_len > 0) args_ptr[0] else JSC.JSValue.jsUndefined();
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validateString(globalObject, from_ptr, "from", .{}) catch {
            // Returning .zero translates to a nullprt JSC.JSValue.
            return .zero;
        };
        const to_ptr = if (args_len > 1) args_ptr[1] else JSC.JSValue.jsUndefined();
        // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
        validateString(globalObject, to_ptr, "to", .{}) catch {
            return .zero;
        };

        const fromZigStr = from_ptr.getZigString(globalObject);
        const toZigStr = to_ptr.getZigString(globalObject);
        if ((fromZigStr.len + toZigStr.len) == 0) return from_ptr;

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, JSC.getAllocator(globalObject));
        const allocator = stack_fallback.get();

        var fromZigSlice = fromZigStr.toSlice(allocator);
        defer fromZigSlice.deinit();
        var toZigSlice = toZigStr.toSlice(allocator);
        defer toZigSlice.deinit();
        return relativeJS_T(u8, globalObject, allocator, isWindows, fromZigSlice.slice(), toZigSlice.slice());
    }

    /// Based on Node v21.6.1 path.posix.resolve:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1095
    pub fn resolvePosixT(comptime T: type, paths: []const []const T, buf: []T, buf2: []T) MaybeSlice(T) {
        comptime validatePathT(T, "resolvePosixT");

        // Backed by expandable buf2 because resolvedPath may be long.
        // We use buf2 here because resolvePosixT is called by other methods and using
        // buf2 here avoids stepping on others' toes.
        var resolvedPath: []const T = comptime L(T, "");
        var resolvedPathLen: usize = 0;
        var resolvedAbsolute: bool = false;

        var bufOffset: usize = 0;
        var bufSize: usize = 0;

        var i_i64: i64 = if (paths.len == 0) -1 else @as(i64, @intCast(paths.len - 1));
        while (i_i64 > -2 and !resolvedAbsolute) : (i_i64 -= 1) {
            var path: []const T = comptime L(T, "");
            if (i_i64 >= 0) {
                path = paths[@as(usize, @intCast(i_i64))];
            } else {
                // cwd is limited to MAX_PATH_BYTES.
                var tmpBuf: [MAX_PATH_SIZE(T)]T = undefined;
                path = switch (posixCwdT(T, &tmpBuf)) {
                    .result => |r| r,
                    .err => |e| return MaybeSlice(T){ .err = e },
                };
            }
            // validateString of `path` is performed in pub fn resolve.
            const len = path.len;

            // Skip empty paths.
            if (len == 0) {
                continue;
            }

            // Translated from the following JS code:
            //   resolvedPath = `${path}/${resolvedPath}`;
            if (resolvedPathLen > 0) {
                bufOffset = len + 1;
                bufSize = bufOffset + resolvedPathLen;
                // Move all bytes to the right by path.len + 1 for the separator.
                // Use bun.copy because resolvedPath and buf2 overlap.
                bun.copy(u8, buf2[bufOffset..bufSize], resolvedPath);
            }
            bufSize = len;
            @memcpy(buf2[0..bufSize], path);
            bufSize += 1;
            buf2[len] = CHAR_FORWARD_SLASH;
            bufSize += resolvedPathLen;

            resolvedPath = buf2[0..bufSize];
            resolvedPathLen = bufSize;
            resolvedAbsolute = path[0] == CHAR_FORWARD_SLASH;
        }

        // Exit early for empty path.
        if (resolvedPathLen == 0) {
            return MaybeSlice(T){ .result = comptime L(T, CHAR_STR_DOT) };
        }

        // At this point the path should be resolved to a full absolute path, but
        // handle relative paths to be safe (might happen when process.cwd() fails)

        // Normalize the path
        resolvedPath = normalizeStringT(T, resolvedPath, !resolvedAbsolute, CHAR_FORWARD_SLASH, .posix, buf);
        // resolvedPath is now backed by buf.
        resolvedPathLen = resolvedPath.len;

        // Translated from the following JS code:
        //   if (resolvedAbsolute) {
        //     return `/${resolvedPath}`;
        //   }
        if (resolvedAbsolute) {
            bufSize = resolvedPathLen + 1;
            // Use bun.copy because resolvedPath and buf overlap.
            bun.copy(T, buf[1..bufSize], resolvedPath);
            buf[0] = CHAR_FORWARD_SLASH;
            return MaybeSlice(T){ .result = buf[0..bufSize] };
        }
        // Translated from the following JS code:
        //   return resolvedPath.length > 0 ? resolvedPath : '.';
        return MaybeSlice(T){ .result = if (resolvedPathLen > 0) resolvedPath else comptime L(T, CHAR_STR_DOT) };
    }

    /// Based on Node v21.6.1 path.win32.resolve:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L162
    pub fn resolveWindowsT(comptime T: type, paths: []const []const T, buf: []T, buf2: []T) MaybeSlice(T) {
        comptime validatePathT(T, "resolveWindowsT");

        const isSepT = isSepWindowsT;
        var tmpBuf: [MAX_PATH_SIZE(T)]T = undefined;

        // Backed by tmpBuf.
        var resolvedDevice: []const T = comptime L(T, "");
        var resolvedDeviceLen: usize = 0;
        // Backed by expandable buf2 because resolvedTail may be long.
        // We use buf2 here because resolvePosixT is called by other methods and using
        // buf2 here avoids stepping on others' toes.
        var resolvedTail: []const T = comptime L(T, "");
        var resolvedTailLen: usize = 0;
        var resolvedAbsolute: bool = false;

        var bufOffset: usize = 0;
        var bufSize: usize = 0;
        var envPath: ?[]const T = null;

        var i_i64: i64 = if (paths.len == 0) -1 else @as(i64, @intCast(paths.len - 1));
        while (i_i64 > -2) : (i_i64 -= 1) {
            // Backed by expandable buf2, to not conflict with buf2 backed resolvedTail,
            // because path may be long.
            var path: []const T = comptime L(T, "");
            if (i_i64 >= 0) {
                path = paths[@as(usize, @intCast(i_i64))];
                // validateString of `path` is performed in pub fn resolve.

                // Skip empty paths.
                if (path.len == 0) {
                    continue;
                }
            } else if (resolvedDeviceLen == 0) {
                // cwd is limited to MAX_PATH_BYTES.
                path = switch (getCwdT(T, &tmpBuf)) {
                    .result => |r| r,
                    .err => |e| return MaybeSlice(T){ .err = e },
                };
            } else {
                // Translated from the following JS code:
                //   path = process.env[`=${resolvedDevice}`] || process.cwd();
                if (comptime Environment.isWindows) {
                    // Windows has the concept of drive-specific current working
                    // directories. If we've resolved a drive letter but not yet an
                    // absolute path, get cwd for that drive, or the process cwd if
                    // the drive cwd is not available. We're sure the device is not
                    // a UNC path at this points, because UNC paths are always absolute.

                    // Translated from the following JS code:
                    //   process.env[`=${resolvedDevice}`]
                    const key_w: [*:0]const u16 = brk: {
                        if (resolvedDeviceLen == 2 and resolvedDevice[1] == CHAR_COLON) {
                            // Fast path for device roots
                            break :brk &[3:0]u16{ '=', resolvedDevice[0], CHAR_COLON };
                        }
                        bufSize = 1;
                        // Reuse buf2 for the env key because it's used to get the path.
                        buf2[0] = '=';
                        bufOffset = bufSize;
                        bufSize += resolvedDeviceLen;
                        @memcpy(buf2[bufOffset..bufSize], resolvedDevice);
                        if (T == u16) {
                            break :brk buf2[0..bufSize];
                        } else {
                            var u16Buf: bun.WPathBuffer = undefined;
                            bufSize = std.unicode.utf8ToUtf16Le(&u16Buf, buf2[0..bufSize]) catch {
                                return MaybeSlice(T).errnoSys(0, Syscall.Tag.getenv).?;
                            };
                            break :brk u16Buf[0..bufSize :0];
                        }
                    };
                    // Zig's std.os.getenvW has logic to support keys like `=${resolvedDevice}`:
                    // https://github.com/ziglang/zig/blob/7bd8b35a3dfe61e59ffea39d464e84fbcdead29a/lib/std/os.zig#L2126-L2130
                    //
                    // TODO: Enable test once spawnResult.stdout works on Windows.
                    // test/js/node/path/resolve.test.js
                    if (std.os.getenvW(key_w)) |r| {
                        if (T == u16) {
                            bufSize = r.len;
                            @memcpy(buf2[0..bufSize], r);
                        } else {
                            // Reuse buf2 because it's used for path.
                            bufSize = std.unicode.utf16leToUtf8(buf2, r) catch {
                                return MaybeSlice(T).errnoSys(0, Syscall.Tag.getcwd).?;
                            };
                        }
                        envPath = buf2[0..bufSize];
                    }
                }
                if (envPath) |_envPath| {
                    path = _envPath;
                } else {
                    // cwd is limited to MAX_PATH_BYTES.
                    path = switch (getCwdT(T, &tmpBuf)) {
                        .result => |r| r,
                        .err => |e| return MaybeSlice(T){ .err = e },
                    };
                    // We must set envPath here so that it doesn't hit the null check just below.
                    envPath = path;
                }

                // Verify that a cwd was found and that it actually points
                // to our drive. If not, default to the drive's root.

                // Translated from the following JS code:
                //   if (path === undefined ||
                //     (StringPrototypeToLowerCase(StringPrototypeSlice(path, 0, 2)) !==
                //     StringPrototypeToLowerCase(resolvedDevice) &&
                //     StringPrototypeCharCodeAt(path, 2) === CHAR_BACKWARD_SLASH)) {
                if (envPath == null or
                    (path[2] == CHAR_BACKWARD_SLASH and
                    !eqlIgnoreCaseT(T, path[0..2], resolvedDevice)))
                {
                    // Translated from the following JS code:
                    //   path = `${resolvedDevice}\\`;
                    bufSize = resolvedDeviceLen;
                    @memcpy(buf2[0..bufSize], resolvedDevice);
                    bufOffset = bufSize;
                    bufSize += 1;
                    buf2[bufOffset] = CHAR_BACKWARD_SLASH;
                    path = buf2[0..bufSize];
                }
            }

            const len = path.len;
            var rootEnd: usize = 0;
            // Backed by tmpBuf or an anonymous buffer.
            var device: []const T = comptime L(T, "");
            // Prefix with _ to avoid shadowing the identifier in the outer scope.
            var _isAbsolute: bool = false;
            const byte0 = if (len > 0) path[0] else 0;

            // Try to match a root
            if (len == 1) {
                if (isSepT(T, byte0)) {
                    // `path` contains just a path separator
                    rootEnd = 1;
                    _isAbsolute = true;
                }
            } else if (isSepT(T, byte0)) {
                // Possible UNC root

                // If we started with a separator, we know we at least have an
                // absolute path of some kind (UNC or otherwise)
                _isAbsolute = true;

                if (isSepT(T, path[1])) {
                    // Matched double path separator at the beginning
                    var j: usize = 2;
                    var last: usize = j;
                    // Match 1 or more non-path separators
                    while (j < len and
                        !isSepT(T, path[j]))
                    {
                        j += 1;
                    }
                    if (j < len and j != last) {
                        const firstPart = path[last..j];
                        // Matched!
                        last = j;
                        // Match 1 or more path separators
                        while (j < len and
                            isSepT(T, path[j]))
                        {
                            j += 1;
                        }
                        if (j < len and j != last) {
                            // Matched!
                            last = j;
                            // Match 1 or more non-path separators
                            while (j < len and
                                !isSepT(T, path[j]))
                            {
                                j += 1;
                            }
                            if (j == len or j != last) {
                                // We matched a UNC root

                                // Translated from the following JS code:
                                //   device =
                                //     `\\\\${firstPart}\\${StringPrototypeSlice(path, last, j)}`;
                                //   rootEnd = j;
                                bufSize = 2;
                                tmpBuf[0] = CHAR_BACKWARD_SLASH;
                                tmpBuf[1] = CHAR_BACKWARD_SLASH;
                                bufOffset = bufSize;
                                bufSize += firstPart.len;
                                @memcpy(tmpBuf[bufOffset..bufSize], firstPart);
                                bufOffset = bufSize;
                                bufSize += 1;
                                tmpBuf[bufOffset] = CHAR_BACKWARD_SLASH;
                                const slice = path[last..j];
                                bufOffset = bufSize;
                                bufSize += slice.len;
                                @memcpy(tmpBuf[bufOffset..bufSize], slice);

                                device = tmpBuf[0..bufSize];
                                rootEnd = j;
                            }
                        }
                    }
                } else {
                    rootEnd = 1;
                }
            } else if (isWindowsDeviceRootT(T, byte0) and
                path[1] == CHAR_COLON)
            {
                // Possible device root
                device = &[2]T{ byte0, CHAR_COLON };
                rootEnd = 2;
                if (len > 2 and isSepT(T, path[2])) {
                    // Treat separator following the drive name as an absolute path
                    // indicator
                    _isAbsolute = true;
                    rootEnd = 3;
                }
            }

            const deviceLen = device.len;
            if (deviceLen > 0) {
                if (resolvedDeviceLen > 0) {
                    // Translated from the following JS code:
                    //   if (StringPrototypeToLowerCase(device) !==
                    //     StringPrototypeToLowerCase(resolvedDevice))
                    if (!eqlIgnoreCaseT(T, device, resolvedDevice)) {
                        // This path points to another device, so it is not applicable
                        continue;
                    }
                } else {
                    // Translated from the following JS code:
                    //   resolvedDevice = device;
                    bufSize = device.len;
                    // Copy device over if it's backed by an anonymous buffer.
                    if (device.ptr != tmpBuf[0..].ptr) {
                        @memcpy(tmpBuf[0..bufSize], device);
                    }
                    resolvedDevice = tmpBuf[0..bufSize];
                    resolvedDeviceLen = bufSize;
                }
            }

            if (resolvedAbsolute) {
                if (resolvedDeviceLen > 0) {
                    break;
                }
            } else {
                // Translated from the following JS code:
                //   resolvedTail = `${StringPrototypeSlice(path, rootEnd)}\\${resolvedTail}`;
                const sliceLen = len - rootEnd;
                if (resolvedTailLen > 0) {
                    bufOffset = sliceLen + 1;
                    bufSize = bufOffset + resolvedTailLen;
                    // Move all bytes to the right by path slice.len + 1 for the separator
                    // Use bun.copy because resolvedTail and buf2 overlap.
                    bun.copy(u8, buf2[bufOffset..bufSize], resolvedTail);
                }
                bufSize = sliceLen;
                if (sliceLen > 0) {
                    @memcpy(buf2[0..bufSize], path[rootEnd..len]);
                }
                bufOffset = bufSize;
                bufSize += 1;
                buf2[bufOffset] = CHAR_BACKWARD_SLASH;
                bufSize += resolvedTailLen;

                resolvedTail = buf2[0..bufSize];
                resolvedTailLen = bufSize;
                resolvedAbsolute = _isAbsolute;

                if (_isAbsolute and resolvedDeviceLen > 0) {
                    break;
                }
            }
        }

        // Exit early for empty path.
        if (resolvedTailLen == 0) {
            return MaybeSlice(T){ .result = comptime L(T, CHAR_STR_DOT) };
        }

        // At this point, the path should be resolved to a full absolute path,
        // but handle relative paths to be safe (might happen when std.process.cwdAlloc()
        // fails)

        // Normalize the tail path
        resolvedTail = normalizeStringT(T, resolvedTail, !resolvedAbsolute, CHAR_BACKWARD_SLASH, .windows, buf);
        // resolvedTail is now backed by buf.
        resolvedTailLen = resolvedTail.len;

        // Translated from the following JS code:
        //   resolvedAbsolute ? `${resolvedDevice}\\${resolvedTail}`
        if (resolvedAbsolute) {
            bufOffset = resolvedDeviceLen + 1;
            bufSize = bufOffset + resolvedTailLen;
            // Use bun.copy because resolvedTail and buf overlap.
            bun.copy(T, buf[bufOffset..bufSize], resolvedTail);
            buf[resolvedDeviceLen] = CHAR_BACKWARD_SLASH;
            @memcpy(buf[0..resolvedDeviceLen], resolvedDevice);
            return MaybeSlice(T){ .result = buf[0..bufSize] };
        }
        // Translated from the following JS code:
        //   : `${resolvedDevice}${resolvedTail}` || '.'
        if ((resolvedDeviceLen + resolvedTailLen) > 0) {
            bufOffset = resolvedDeviceLen;
            bufSize = bufOffset + resolvedTailLen;
            // Use bun.copy because resolvedTail and buf overlap.
            bun.copy(T, buf[bufOffset..bufSize], resolvedTail);
            @memcpy(buf[0..resolvedDeviceLen], resolvedDevice);
            return MaybeSlice(T){ .result = buf[0..bufSize] };
        }
        return MaybeSlice(T){ .result = comptime L(T, CHAR_STR_DOT) };
    }

    pub inline fn resolvePosixJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, paths: []const []const T, buf: []T, buf2: []T) JSC.JSValue {
        return switch (resolvePosixT(T, paths, buf, buf2)) {
            .result => |r| toJSString(globalObject, r),
            .err => |e| e.toJSC(globalObject),
        };
    }

    pub inline fn resolveWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, paths: []const []const T, buf: []T, buf2: []T) JSC.JSValue {
        return switch (resolveWindowsT(T, paths, buf, buf2)) {
            .result => |r| toJSString(globalObject, r),
            .err => |e| e.toJSC(globalObject),
        };
    }

    pub fn resolveJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, paths: []const []const T) JSC.JSValue {
        // Adding 8 bytes when Windows for the possible UNC root.
        var bufLen: usize = if (isWindows) 8 else 0;
        for (paths) |path| bufLen += if (bufLen > 0 and path.len > 0) path.len + 1 else path.len;
        bufLen = @max(bufLen, PATH_SIZE(T));
        const buf = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf);
        const buf2 = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf2);
        return if (isWindows) resolveWindowsJS_T(T, globalObject, paths, buf, buf2) else resolvePosixJS_T(T, globalObject, paths, buf, buf2);
    }

    pub fn resolve(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();

        var arena = bun.ArenaAllocator.init(heap_allocator);
        defer arena.deinit();

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_large, arena.allocator());
        const allocator = stack_fallback.get();

        var paths = allocator.alloc(string, args_len) catch bun.outOfMemory();
        defer allocator.free(paths);

        for (0..args_len, args_ptr) |i, path_ptr| {
            // Supress exeption in zig. It does globalThis.vm().throwError() in JS land.
            validateString(globalObject, path_ptr, "paths[{d}]", .{i}) catch {
                // Returning .zero translates to a nullprt JSC.JSValue.
                return .zero;
            };
            const pathZStr = path_ptr.getZigString(globalObject);
            paths[i] = if (pathZStr.len > 0) pathZStr.toSlice(allocator).slice() else "";
        }
        return resolveJS_T(u8, globalObject, allocator, isWindows, paths);
    }

    /// Based on Node v21.6.1 path.win32.toNamespacedPath:
    /// https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L622
    pub fn toNamespacedPathWindowsT(comptime T: type, path: []const T, buf: []T, buf2: []T) MaybeSlice(T) {
        comptime validatePathT(T, "toNamespacedPathWindowsT");

        // validateString of `path` is performed in pub fn toNamespacedPath.
        // Backed by buf.
        const resolvedPath = switch (resolveWindowsT(T, &.{path}, buf, buf2)) {
            .result => |r| r,
            .err => |e| return MaybeSlice(T){ .err = e },
        };

        const len = resolvedPath.len;
        if (len <= 2) {
            return MaybeSlice(T){ .result = path };
        }

        var bufOffset: usize = 0;
        var bufSize: usize = 0;

        const byte0 = resolvedPath[0];
        if (byte0 == CHAR_BACKWARD_SLASH) {
            // Possible UNC root
            if (resolvedPath[1] == CHAR_BACKWARD_SLASH) {
                const byte2 = resolvedPath[2];
                if (byte2 != CHAR_QUESTION_MARK and byte2 != CHAR_DOT) {
                    // Matched non-long UNC root, convert the path to a long UNC path

                    // Translated from the following JS code:
                    //   return `\\\\?\\UNC\\${StringPrototypeSlice(resolvedPath, 2)}`;
                    bufOffset = 6;
                    bufSize = len + 6;
                    // Move all bytes to the right by 6 so that the first two bytes are
                    // overwritten by "\\\\?\\UNC\\" which is 8 bytes long.
                    // Use bun.copy because resolvedPath and buf overlap.
                    bun.copy(T, buf[bufOffset..bufSize], resolvedPath);
                    // Equiv to std.os.windows.NamespacePrefix.verbatim
                    // https://github.com/ziglang/zig/blob/dcaf43674e35372e1d28ab12c4c4ff9af9f3d646/lib/std/os/windows.zig#L2358-L2374
                    buf[0] = CHAR_BACKWARD_SLASH;
                    buf[1] = CHAR_BACKWARD_SLASH;
                    buf[2] = CHAR_QUESTION_MARK;
                    buf[3] = CHAR_BACKWARD_SLASH;
                    buf[4] = 'U';
                    buf[5] = 'N';
                    buf[6] = 'C';
                    buf[7] = CHAR_BACKWARD_SLASH;
                    return MaybeSlice(T){ .result = buf[0..bufSize] };
                }
            }
        } else if (isWindowsDeviceRootT(T, byte0) and
            resolvedPath[1] == CHAR_COLON and
            resolvedPath[2] == CHAR_BACKWARD_SLASH)
        {
            // Matched device root, convert the path to a long UNC path

            // Translated from the following JS code:
            //   return `\\\\?\\${resolvedPath}`
            bufOffset = 4;
            bufSize = len + 4;
            // Move all bytes to the right by 4
            // Use bun.copy because resolvedPath and buf overlap.
            bun.copy(T, buf[bufOffset..bufSize], resolvedPath);
            // Equiv to std.os.windows.NamespacePrefix.verbatim
            // https://github.com/ziglang/zig/blob/dcaf43674e35372e1d28ab12c4c4ff9af9f3d646/lib/std/os/windows.zig#L2358-L2374
            buf[0] = CHAR_BACKWARD_SLASH;
            buf[1] = CHAR_BACKWARD_SLASH;
            buf[2] = CHAR_QUESTION_MARK;
            buf[3] = CHAR_BACKWARD_SLASH;
            return MaybeSlice(T){ .result = buf[0..bufSize] };
        }
        return MaybeSlice(T){ .result = path };
    }

    pub inline fn toNamespacedPathWindowsJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, path: []const T, buf: []T, buf2: []T) JSC.JSValue {
        return switch (toNamespacedPathWindowsT(T, path, buf, buf2)) {
            .result => |r| toJSString(globalObject, r),
            .err => |e| e.toJSC(globalObject),
        };
    }

    pub fn toNamespacedPathJS_T(comptime T: type, globalObject: *JSC.JSGlobalObject, allocator: std.mem.Allocator, isWindows: bool, path: []const T) JSC.JSValue {
        if (!isWindows or path.len == 0) return toJSString(globalObject, path);
        const bufLen = @max(path.len, PATH_SIZE(T));
        const buf = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf);
        const buf2 = allocator.alloc(T, bufLen) catch bun.outOfMemory();
        defer allocator.free(buf2);
        return toNamespacedPathWindowsJS_T(T, globalObject, path, buf, buf2);
    }

    pub fn toNamespacedPath(globalObject: *JSC.JSGlobalObject, isWindows: bool, args_ptr: [*]JSC.JSValue, args_len: u16) callconv(.C) JSC.JSValue {
        if (comptime is_bindgen) return JSC.JSValue.jsUndefined();
        if (args_len == 0) return JSC.JSValue.jsUndefined();
        var path_ptr = args_ptr[0];

        // Based on Node v21.6.1 path.win32.toNamespacedPath and path.posix.toNamespacedPath:
        // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L624
        // https://github.com/nodejs/node/blob/6ae20aa63de78294b18d5015481485b7cd8fbb60/lib/path.js#L1269
        //
        // Act as an identity function for non-string values and non-Windows platforms.
        if (!isWindows or !path_ptr.isString()) return path_ptr;
        const pathZStr = path_ptr.getZigString(globalObject);
        const len = pathZStr.len;
        if (len == 0) return path_ptr;

        var stack_fallback = std.heap.stackFallback(stack_fallback_size_small, JSC.getAllocator(globalObject));
        const allocator = stack_fallback.get();

        const pathZSlice = pathZStr.toSlice(allocator);
        defer pathZSlice.deinit();
        return toNamespacedPathJS_T(u8, globalObject, allocator, isWindows, pathZSlice.slice());
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
        .toNamespacedPath = toNamespacedPath,
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
            @export(Path.toNamespacedPath, .{
                .name = Export[10].symbol_name,
            });
        }
    }
};

pub const Process = struct {
    pub fn getArgv0(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        return JSC.ZigString.fromUTF8(bun.argv()[0]).toValueGC(globalObject);
    }

    pub fn getExecPath(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        var buf: bun.PathBuffer = undefined;
        const out = std.fs.selfExePath(&buf) catch {
            // if for any reason we are unable to get the executable path, we just return argv[0]
            return getArgv0(globalObject);
        };

        return JSC.ZigString.fromUTF8(out).toValueGC(globalObject);
    }

    pub fn getExecArgv(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        const allocator = globalObject.allocator();
        const vm = globalObject.bunVM();

        if (vm.worker) |worker| {
            // was explicitly overridden for the worker?
            if (worker.execArgv) |execArgv| {
                const array = JSC.JSValue.createEmptyArray(globalObject, execArgv.len);
                for (0..execArgv.len) |i| {
                    array.putIndex(globalObject, @intCast(i), bun.String.init(execArgv[i]).toJS(globalObject));
                }
                return array;
            }
        }

        var args = allocator.alloc(
            JSC.ZigString,
            // argv omits "bun" because it could be "bun run" or "bun" and it's kind of ambiguous
            // argv also omits the script name
            bun.argv().len -| 1,
        ) catch bun.outOfMemory();
        defer allocator.free(args);
        var used: usize = 0;
        const offset = 1;

        for (bun.argv()[@min(bun.argv().len, offset)..]) |arg| {
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
        const vm = globalObject.bunVM();

        // Allocate up to 32 strings in stack
        var stack_fallback_allocator = std.heap.stackFallback(
            32 * @sizeOf(JSC.ZigString) + (bun.MAX_PATH_BYTES + 1) + 32,
            heap_allocator,
        );
        const allocator = stack_fallback_allocator.get();

        var args_count: usize = vm.argv.len;
        if (vm.worker) |worker| {
            args_count = if (worker.argv) |argv| argv.len else 0;
        }

        const args = allocator.alloc(
            bun.String,
            // argv omits "bun" because it could be "bun run" or "bun" and it's kind of ambiguous
            // argv also omits the script name
            args_count + 2,
        ) catch bun.outOfMemory();
        var args_list = std.ArrayListUnmanaged(bun.String){ .items = args, .capacity = args.len };
        args_list.items.len = 0;

        if (vm.standalone_module_graph != null) {
            // Don't break user's code because they did process.argv.slice(2)
            // Even if they didn't type "bun", we still want to add it as argv[0]
            args_list.appendAssumeCapacity(
                bun.String.static("bun"),
            );
        } else {
            const exe_path = std.fs.selfExePathAlloc(allocator) catch null;
            args_list.appendAssumeCapacity(
                if (exe_path) |str| bun.String.fromUTF8(str) else bun.String.static("bun"),
            );
        }

        if (vm.main.len > 0)
            args_list.appendAssumeCapacity(bun.String.fromUTF8(vm.main));

        defer allocator.free(args);

        if (vm.worker) |worker| {
            if (worker.argv) |argv| {
                for (argv) |arg| {
                    args_list.appendAssumeCapacity(bun.String.init(arg));
                }
            }
        } else {
            for (vm.argv) |arg| {
                const str = bun.String.fromUTF8(arg);
                // https://github.com/yargs/yargs/blob/adb0d11e02c613af3d9427b3028cc192703a3869/lib/utils/process-argv.ts#L1
                args_list.appendAssumeCapacity(str);
            }
        }

        return bun.String.toJSArray(globalObject, args_list.items);
    }

    pub fn getCwd(globalObject: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
        var buf: bun.PathBuffer = undefined;
        return switch (Path.getCwd(&buf)) {
            .result => |r| toJSString(globalObject, r),
            .err => |e| e.toJSC(globalObject),
        };
    }

    pub fn setCwd(globalObject: *JSC.JSGlobalObject, to: *JSC.ZigString) callconv(.C) JSC.JSValue {
        if (to.len == 0) {
            return JSC.toInvalidArguments("path is required", .{}, globalObject.ref());
        }

        var buf: bun.PathBuffer = undefined;
        const slice = to.sliceZBuf(&buf) catch {
            return JSC.toInvalidArguments("Invalid path", .{}, globalObject.ref());
        };

        switch (Syscall.chdir(slice)) {
            .result => {
                // When we update the cwd from JS, we have to update the bundler's version as well
                // However, this might be called many times in a row, so we use a pre-allocated buffer
                // that way we don't have to worry about garbage collector
                const fs = JSC.VirtualMachine.get().bundler.fs;
                fs.top_level_dir = switch (Path.getCwd(&fs.top_level_dir_buf)) {
                    .result => |r| r,
                    .err => {
                        _ = Syscall.chdir(@as([:0]const u8, @ptrCast(fs.top_level_dir)));
                        return JSC.toInvalidArguments("Invalid path", .{}, globalObject.ref());
                    },
                };

                const len = fs.top_level_dir.len;
                fs.top_level_dir_buf[len] = std.fs.path.sep;
                fs.top_level_dir_buf[len + 1] = 0;
                fs.top_level_dir = fs.top_level_dir_buf[0 .. len + 1];

                return JSC.JSValue.jsUndefined();
            },
            .err => |e| return e.toJSC(globalObject),
        }
    }

    pub fn exit(globalObject: *JSC.JSGlobalObject, code: u8) callconv(.C) void {
        var vm = globalObject.bunVM();
        if (vm.worker) |worker| {
            vm.exit_handler.exit_code = code;
            worker.requestTerminate();
            return;
        }

        vm.onExit();
        bun.Global.exit(code);
    }

    pub export const Bun__version: [*:0]const u8 = "v" ++ bun.Global.package_json_version;
    pub export const Bun__versions_boringssl: [*:0]const u8 = bun.Global.versions.boringssl;
    pub export const Bun__versions_libarchive: [*:0]const u8 = bun.Global.versions.libarchive;
    pub export const Bun__versions_mimalloc: [*:0]const u8 = bun.Global.versions.mimalloc;
    pub export const Bun__versions_picohttpparser: [*:0]const u8 = bun.Global.versions.picohttpparser;
    pub export const Bun__versions_uws: [*:0]const u8 = bun.Environment.git_sha;
    pub export const Bun__versions_webkit: [*:0]const u8 = bun.Global.versions.webkit;
    pub export const Bun__versions_zig: [*:0]const u8 = bun.Global.versions.zig;
    pub export const Bun__versions_zlib: [*:0]const u8 = bun.Global.versions.zlib;
    pub export const Bun__versions_tinycc: [*:0]const u8 = bun.Global.versions.tinycc;
    pub export const Bun__versions_lolhtml: [*:0]const u8 = bun.Global.versions.lolhtml;
    pub export const Bun__versions_c_ares: [*:0]const u8 = bun.Global.versions.c_ares;
    pub export const Bun__versions_usockets: [*:0]const u8 = bun.Environment.git_sha;
    pub export const Bun__version_sha: [*:0]const u8 = bun.Environment.git_sha;
};

comptime {
    std.testing.refAllDecls(Process);
    std.testing.refAllDecls(Path);
}
