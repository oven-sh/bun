const Crypto = @This();

pub const js = JSC.Codegen.JSCrypto;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

garbage: i32 = 0,

comptime {
    _ = CryptoObject__create;
}

const BoringSSL = bun.BoringSSL.c;

fn throwInvalidParameter(globalThis: *JSC.JSGlobalObject) bun.JSError {
    return globalThis.ERR(.CRYPTO_SCRYPT_INVALID_PARAMETER, "Invalid scrypt parameters", .{}).throw();
}

fn throwInvalidParams(globalThis: *JSC.JSGlobalObject, comptime error_type: @Type(.enum_literal), comptime message: [:0]const u8, fmt: anytype) bun.JSError {
    if (error_type != .RangeError) @compileError("Error type not added!");
    BoringSSL.ERR_clear_error();
    return globalThis.ERR(.CRYPTO_INVALID_SCRYPT_PARAMS, message, fmt).throw();
}

pub fn timingSafeEqual(_: *@This(), global: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    return JSC.Node.crypto.timingSafeEqual(global, callframe);
}

pub fn timingSafeEqualWithoutTypeChecks(
    _: *@This(),
    globalThis: *JSC.JSGlobalObject,
    array_a: *JSC.JSUint8Array,
    array_b: *JSC.JSUint8Array,
) JSC.JSValue {
    const a = array_a.slice();
    const b = array_b.slice();

    const len = a.len;
    if (b.len != len) {
        return globalThis.ERR(.CRYPTO_TIMING_SAFE_EQUAL_LENGTH, "Input buffers must have the same byte length", .{}).throw();
    }

    return JSC.jsBoolean(bun.BoringSSL.c.CRYPTO_memcmp(a.ptr, b.ptr, len) == 0);
}

pub fn getRandomValues(
    _: *@This(),
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments();
    if (arguments.len == 0) {
        return globalThis.throwDOMException(.TypeMismatchError, "The data argument must be an integer-type TypedArray", .{});
    }

    var array_buffer = arguments[0].asArrayBuffer(globalThis) orelse {
        return globalThis.throwDOMException(.TypeMismatchError, "The data argument must be an integer-type TypedArray", .{});
    };

    const slice = array_buffer.byteSlice();

    randomData(globalThis, slice.ptr, slice.len);

    return arguments[0];
}

pub fn getRandomValuesWithoutTypeChecks(
    _: *@This(),
    globalThis: *JSC.JSGlobalObject,
    array: *JSC.JSUint8Array,
) JSC.JSValue {
    const slice = array.slice();
    randomData(globalThis, slice.ptr, slice.len);
    return @as(JSC.JSValue, @enumFromInt(@as(i64, @bitCast(@intFromPtr(array)))));
}

fn randomData(
    globalThis: *JSC.JSGlobalObject,
    ptr: [*]u8,
    len: usize,
) void {
    const slice = ptr[0..len];

    switch (slice.len) {
        0 => {},
        // 512 bytes or less we reuse from the same cache as UUID generation.
        1...JSC.RareData.EntropyCache.size / 8 => {
            bun.copy(u8, slice, globalThis.bunVM().rareData().entropySlice(slice.len));
        },
        else => {
            bun.csprng(slice);
        },
    }
}

pub fn randomUUID(
    _: *@This(),
    globalThis: *JSC.JSGlobalObject,
    _: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    var str, var bytes = bun.String.createUninitialized(.latin1, 36);

    const uuid = globalThis.bunVM().rareData().nextUUID();

    uuid.print(bytes[0..36]);
    return str.transferToJS(globalThis);
}

comptime {
    const Bun__randomUUIDv7 = JSC.toJSHostFn(Bun__randomUUIDv7_);
    @export(&Bun__randomUUIDv7, .{ .name = "Bun__randomUUIDv7" });
}
pub fn Bun__randomUUIDv7_(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.argumentsUndef(2).slice();

    var encoding_value: JSC.JSValue = .js_undefined;

    const encoding: JSC.Node.Encoding = brk: {
        if (arguments.len > 0) {
            if (!arguments[0].isUndefined()) {
                if (arguments[0].isString()) {
                    encoding_value = arguments[0];
                    break :brk try JSC.Node.Encoding.fromJS(encoding_value, globalThis) orelse {
                        return globalThis.ERR(.UNKNOWN_ENCODING, "Encoding must be one of base64, base64url, hex, or buffer", .{}).throw();
                    };
                }
            }
        }

        break :brk JSC.Node.Encoding.hex;
    };

    const timestamp: u64 = brk: {
        const timestamp_value: JSC.JSValue = if (!encoding_value.isUndefined() and arguments.len > 1)
            arguments[1]
        else if (arguments.len == 1 and encoding_value.isUndefined())
            arguments[0]
        else
            .js_undefined;

        if (!timestamp_value.isUndefined()) {
            if (timestamp_value.isDate()) {
                const date = timestamp_value.getUnixTimestamp();
                break :brk @intFromFloat(@max(0, date));
            }
            break :brk @intCast(try globalThis.validateIntegerRange(timestamp_value, i64, 0, .{ .min = 0, .field_name = "timestamp" }));
        }

        break :brk @intCast(@max(0, std.time.milliTimestamp()));
    };

    const entropy = globalThis.bunVM().rareData().entropySlice(8);

    const uuid = UUID7.init(timestamp, &entropy[0..8].*);

    if (encoding == .hex) {
        var str, var bytes = bun.String.createUninitialized(.latin1, 36);
        uuid.print(bytes[0..36]);
        return str.transferToJS(globalThis);
    }

    return encoding.encodeWithMaxSize(globalThis, 32, &uuid.bytes);
}

pub fn randomUUIDWithoutTypeChecks(
    _: *Crypto,
    globalThis: *JSC.JSGlobalObject,
) JSC.JSValue {
    const str, var bytes = bun.String.createUninitialized(.latin1, 36);
    defer str.deref();

    // randomUUID must have been called already many times before this kicks
    // in so we can skip the rare_data pointer check.
    const uuid = globalThis.bunVM().rare_data.?.nextUUID();

    uuid.print(bytes[0..36]);
    return str.toJS(globalThis);
}

pub fn constructor(globalThis: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!*Crypto {
    return JSC.Error.ILLEGAL_CONSTRUCTOR.throw(globalThis, "Crypto is not constructable", .{});
}

pub export fn CryptoObject__create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
    JSC.markBinding(@src());

    var ptr = bun.default_allocator.create(Crypto) catch {
        return globalThis.throwOutOfMemoryValue();
    };

    return ptr.toJS(globalThis);
}

const UUID7 = @import("../uuid.zig").UUID7;

const std = @import("std");
const bun = @import("bun");
const JSC = bun.jsc;
