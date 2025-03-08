const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;
const Crypto = JSC.API.Bun.Crypto;
const BoringSSL = bun.BoringSSL.c;
const assert = bun.assert;
const EVP = Crypto.EVP;
const PBKDF2 = EVP.PBKDF2;
const JSValue = JSC.JSValue;
const validators = @import("./util/validators.zig");
const JSError = bun.JSError;
const JSGlobalObject = JSC.JSGlobalObject;
const String = bun.String;

fn randomInt(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(2).slice();

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

fn pbkdf2(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(6);

    const data = try PBKDF2.fromJS(globalThis, arguments.slice(), true);

    const job = PBKDF2.Job.create(JSC.VirtualMachine.get(), globalThis, &data);
    return job.promise.value();
}

fn pbkdf2Sync(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    const arguments = callframe.arguments_old(5);

    var data = try PBKDF2.fromJS(globalThis, arguments.slice(), false);
    defer data.deinit();
    var out_arraybuffer = JSC.JSValue.createBufferFromLength(globalThis, @intCast(data.length));
    if (out_arraybuffer == .zero or globalThis.hasException()) {
        data.deinit();
        return .zero;
    }

    const output = out_arraybuffer.asArrayBuffer(globalThis) orelse {
        data.deinit();
        return globalThis.throwOutOfMemory();
    };

    if (!data.run(output.slice())) {
        const err = Crypto.createCryptoError(globalThis, BoringSSL.ERR_get_error());
        BoringSSL.ERR_clear_error();
        return globalThis.throwValue(err);
    }

    return out_arraybuffer;
}

pub fn timingSafeEqual(global: *JSGlobalObject, callFrame: *JSC.CallFrame) JSError!JSValue {
    const l_value, const r_value = callFrame.argumentsAsArray(2);

    const l_buf = l_value.asArrayBuffer(global) orelse {
        return global.ERR_INVALID_ARG_TYPE("The \"buf1\" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.", .{}).throw();
    };
    const l = l_buf.byteSlice();

    const r_buf = r_value.asArrayBuffer(global) orelse {
        return global.ERR_INVALID_ARG_TYPE("The \"buf2\" argument must be an instance of ArrayBuffer, Buffer, TypedArray, or DataView.", .{}).throw();
    };
    const r = r_buf.byteSlice();

    if (l.len != r.len) {
        return global.ERR_CRYPTO_TIMING_SAFE_EQUAL_LENGTH("Input buffers must have the same byte length", .{}).throw();
    }

    return JSC.jsBoolean(BoringSSL.CRYPTO_memcmp(l.ptr, r.ptr, l.len) == 0);
}

pub fn createNodeCryptoBindingZig(global: *JSC.JSGlobalObject) JSC.JSValue {
    const crypto = JSC.JSValue.createEmptyObject(global, 4);

    crypto.put(global, String.init("pbkdf2"), JSC.JSFunction.create(global, "pbkdf2", pbkdf2, 5, .{}));
    crypto.put(global, String.init("pbkdf2Sync"), JSC.JSFunction.create(global, "pbkdf2Sync", pbkdf2Sync, 5, .{}));
    crypto.put(global, String.init("randomInt"), JSC.JSFunction.create(global, "randomInt", randomInt, 2, .{}));
    crypto.put(global, String.init("timingSafeEqual"), JSC.JSFunction.create(global, "timingSafeEqual", timingSafeEqual, 2, .{}));

    return crypto;
}
