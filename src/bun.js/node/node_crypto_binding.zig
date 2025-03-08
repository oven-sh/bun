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
const JSGlobalObject = JSC.JSGlobalObject;
const JSError = bun.JSError;
const String = bun.String;
const UUID = bun.UUID;

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

fn randomUUID(global: *JSGlobalObject, callFrame: *JSC.CallFrame) JSError!JSValue {
    const args = callFrame.arguments();

    var disable_entropy_cache = false;
    if (args.len > 0) {
        const options = args[0];
        if (options != .undefined) {
            try validators.validateObject(global, options, "options", .{}, .{});
            if (try options.get(global, "disableEntropyCache")) |disable_entropy_cache_value| {
                disable_entropy_cache = try validators.validateBoolean(global, disable_entropy_cache_value, "options.disableEntropyCache", .{});
            }
        }
    }

    var str, var bytes = String.createUninitialized(.latin1, 36);

    const uuid = if (disable_entropy_cache)
        UUID.init()
    else
        global.bunVM().rareData().nextUUID();

    uuid.print(bytes[0..36]);
    return str.transferToJS(global);
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

pub fn createNodeCryptoBindingZig(global: *JSC.JSGlobalObject) JSC.JSValue {
    const crypto = JSC.JSValue.createEmptyObject(global, 4);

    crypto.put(global, bun.String.init("pbkdf2"), JSC.JSFunction.create(global, "pbkdf2", pbkdf2, 5, .{}));
    crypto.put(global, bun.String.init("pbkdf2Sync"), JSC.JSFunction.create(global, "pbkdf2Sync", pbkdf2Sync, 5, .{}));
    crypto.put(global, bun.String.init("randomInt"), JSC.JSFunction.create(global, "randomInt", randomInt, 2, .{}));
    crypto.put(global, String.init("randomUUID"), JSC.JSFunction.create(global, "randomUUID", randomUUID, 1, .{}));

    return crypto;
}
