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

fn randomInt(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
    const arguments = callframe.arguments(2).slice();

    var at_least: u52 = 0;
    var at_most: u52 = std.math.maxInt(u52);

    //min, max
    if (!arguments[0].isNumber()) return globalThis.throwInvalidArgumentTypeValue("min", "safe integer", arguments[0]);
    if (!arguments[1].isNumber()) return globalThis.throwInvalidArgumentTypeValue("max", "safe integer", arguments[1]);
    at_least = arguments[0].to(u52);
    at_most = arguments[1].to(u52);

    return JSC.JSValue.jsNumberFromUint64(std.crypto.random.intRangeLessThan(u52, at_least, at_most));
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
const jsRandomInt = JSC.toJSHostFunction(randomInt);

pub fn createNodeCryptoBindingZig(global: *JSC.JSGlobalObject) JSC.JSValue {
    const crypto = JSC.JSValue.createEmptyObject(global, 3);

    crypto.put(global, bun.String.init("pbkdf2"), JSC.JSFunction.create(global, "pbkdf2", jsPbkdf2, 5, .{}));
    crypto.put(global, bun.String.init("pbkdf2Sync"), JSC.JSFunction.create(global, "pbkdf2Sync", jsPbkdf2Sync, 5, .{}));
    crypto.put(global, bun.String.init("randomInt"), JSC.JSFunction.create(global, "randomInt", jsRandomInt, 2, .{}));

    return crypto;
}
