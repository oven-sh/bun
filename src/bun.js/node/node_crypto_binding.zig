const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const Crypto = JSC.API.Bun.Crypto;
const BoringSSL = bun.BoringSSL;
const assert = bun.assert;
const EVP = Crypto.EVP;
const PBKDF2 = EVP.PBKDF2;
const JSValue = JSC.JSValue;
const validators = @import("./util/validators.zig");

fn randomBytes(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) JSC.JSValue {
    const arguments = callFrame.arguments(1).slice();

    if (!arguments[0].isNumber())
        return globalThis.throwInvalidArgumentTypeValue("size", "non-negative number", arguments[0]);

    const size = arguments[0].to(i64);
    if (size < 0 or size > std.math.maxInt(i32))
        return globalThis.throwInvalidArgumentRangeValue("size", "must be within range [0, 2147483647]", size);

    const jsBuffer = JSC.JSValue.createUninitializedUint8Array(globalThis, @intCast(size));
    if (globalThis.hasException())
        return .zero;

    if (size > 0) {
        if (jsBuffer.asArrayBuffer(globalThis)) |jsArrayBuffer| {
            bun.randomData(globalThis, jsArrayBuffer.slice());
        }
    }

    return jsBuffer;
}

fn randomInt(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    const arguments = callframe.arguments(2).slice();

    //min, max
    if (!arguments[0].isNumber()) return globalThis.throwInvalidArgumentTypeValue("min", "safe integer", arguments[0]);
    if (!arguments[1].isNumber()) return globalThis.throwInvalidArgumentTypeValue("max", "safe integer", arguments[1]);
    const min = arguments[0].to(i64);
    const max = arguments[1].to(i64);

    if (min > JSC.MAX_SAFE_INTEGER or min < JSC.MIN_SAFE_INTEGER) {
        return globalThis.throwInvalidArgumentRangeValue("min", "It must be a safe integer type number", min);
    }
    if (max > JSC.MAX_SAFE_INTEGER) {
        return globalThis.throwInvalidArgumentRangeValue("max", "It must be a safe integer type number", max);
    }
    if (min >= max) {
        return globalThis.throwInvalidArgumentRangeValue("max", "should be greater than min", max);
    }
    const diff = max - min;
    if (diff > 281474976710655) {
        return globalThis.throwInvalidArgumentRangeValue("max - min", "It must be <= 281474976710655", diff);
    }

    return JSC.JSValue.jsNumberFromInt64(std.crypto.random.intRangeLessThan(i64, min, max));
}

fn randomFill(globalThis: *JSC.JSGlobalObject, callFrame: *JSC.CallFrame) JSC.JSValue {
    const arguments = callFrame.arguments(3).slice();

    const jsBuffer = arguments[0];
    const buffer = jsBuffer.asArrayBuffer(globalThis) orelse {
        return globalThis.throwInvalidArgumentTypeValue(
            "buffer",
            "Buffer or array-like object",
            arguments[0],
        );
    };
    const slice = buffer.slice();

    if (!arguments[1].isUndefined() and !arguments[1].isNumber())
        return globalThis.throwInvalidArgumentTypeValue("offset", "non-negative number", arguments[1]);
    if (!arguments[2].isUndefined() and !arguments[2].isNumber())
        return globalThis.throwInvalidArgumentTypeValue("size", "non-negative number", arguments[2]);

    var offset: u32 = 0;
    if (arguments[1].isNumber()) {
        const offset_i64 = arguments[1].to(i64);
        if (offset_i64 < 0 or offset_i64 > std.math.maxInt(i32)) {
            return globalThis.throwInvalidArgumentRangeValue(
                "offset",
                "It must be within range [0, 2147483647]",
                offset_i64,
            );
        }
        if (offset_i64 > slice.len) {
            globalThis.throw("offset ({}) overflows the buffer's length", .{offset_i64});
            return .zero;
        }
        offset = @intCast(offset_i64);
    }

    var size: u32 = @as(u32, @intCast(slice.len)) - offset;
    if (arguments[2].isNumber()) {
        const size_i64 = arguments[2].to(i64);
        if (size_i64 < 0 or size_i64 > std.math.maxInt(i32)) {
            return globalThis.throwInvalidArgumentRangeValue(
                "size",
                "It must be within range [0, 2147483647]",
                size_i64,
            );
        }
        if (size_i64 + offset > slice.len) {
            globalThis.throw("size ({}) with offset ({}) overflows the buffer's length", .{
                size_i64,
                offset
            });
            return .zero;
        }
        size = @intCast(size_i64);
    }

    if (size > 0)
        bun.randomData(globalThis, slice[offset..offset+size]);

    return jsBuffer;
}

fn pbkdf2(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(5);

    const data = PBKDF2.fromJS(globalThis, arguments.slice(), true) orelse {
        assert(globalThis.hasException());
        return .zero;
    };

    const job = PBKDF2.Job.create(JSC.VirtualMachine.get(), globalThis, &data);
    return job.promise.value();
}

fn pbkdf2Sync(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(5);

    var data = PBKDF2.fromJS(globalThis, arguments.slice(), false) orelse {
        assert(globalThis.hasException());
        return .zero;
    };
    defer data.deinit();
    var out_arraybuffer = JSC.JSValue.createBufferFromLength(globalThis, @intCast(data.length));
    if (out_arraybuffer == .zero or globalThis.hasException()) {
        data.deinit();
        return .zero;
    }

    const output = out_arraybuffer.asArrayBuffer(globalThis) orelse {
        data.deinit();
        globalThis.throwOutOfMemory();
        return .zero;
    };

    if (!data.run(output.slice())) {
        const err = Crypto.createCryptoError(globalThis, BoringSSL.ERR_get_error());
        BoringSSL.ERR_clear_error();
        globalThis.throwValue(err);
        return .zero;
    }

    return out_arraybuffer;
}

const jsPbkdf2 = JSC.toJSHostFunction(pbkdf2);
const jsPbkdf2Sync = JSC.toJSHostFunction(pbkdf2Sync);
const jsRandomBytes = JSC.toJSHostFunction(randomBytes);
const jsRandomInt = JSC.toJSHostFunction(randomInt);
const jsRandomFill = JSC.toJSHostFunction(randomFill);

pub fn createNodeCryptoBindingZig(global: *JSC.JSGlobalObject) JSC.JSValue {
    const crypto = JSC.JSValue.createEmptyObject(global, 5);

    crypto.put(global, bun.String.init("pbkdf2"), JSC.JSFunction.create(global, "pbkdf2", jsPbkdf2, 5, .{}));
    crypto.put(global, bun.String.init("pbkdf2Sync"), JSC.JSFunction.create(global, "pbkdf2Sync", jsPbkdf2Sync, 5, .{}));
    crypto.put(global, bun.String.init("randomBytes"), JSC.JSFunction.create(global, "randomBytes", jsRandomBytes, 1, .{}));
    crypto.put(global, bun.String.init("randomInt"), JSC.JSFunction.create(global, "randomInt", jsRandomInt, 2, .{}));
    crypto.put(global, bun.String.init("randomFill"), JSC.JSFunction.create(global, "randomFill", jsRandomFill, 3, .{}));

    return crypto;
}
