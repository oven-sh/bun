const std = @import("std");
const bun = @import("root").bun;
const Environment = bun.Environment;
const JSC = bun.JSC;
const string = bun.string;
const Output = bun.Output;
const ZigString = JSC.ZigString;

pub fn randomInt(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
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
    };
    return JSC.JSFunction.create(global, "randomInt", &S.cb, 2, .{});
}

const Crypto = JSC.API.Bun.Crypto;
const BoringSSL = bun.BoringSSL;
const assert = bun.assert;
const EVP = Crypto.EVP;
const PBKDF2 = EVP.PBKDF2;
const JSValue = JSC.JSValue;

pub fn pbkdf2(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(5).slice();

    const data = PBKDF2.fromJS(globalThis, arguments, true) orelse {
        assert(globalThis.hasException());
        return .zero;
    };

    const job = PBKDF2.Job.create(JSC.VirtualMachine.get(), globalThis, &data);
    return job.promise.value();
}

pub fn pbkdf2Sync(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(5).slice();

    var data = PBKDF2.fromJS(globalThis, arguments, false) orelse {
        assert(globalThis.hasException());
        return .zero;
    };
    defer data.deinit();
    var output: EVP.Digest = undefined;

    if (!data.run(&output)) {
        const err = Crypto.createCryptoError(globalThis, BoringSSL.ERR_get_error());
        BoringSSL.ERR_clear_error();
        globalThis.throwValue(err);
        return .zero;
    }

    return JSValue.createBuffer(globalThis, output[0..@as(usize, @intCast(data.length))], null);
}

pub fn createNodeCryptoBindingZig(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const crypto = JSC.JSValue.createEmptyObject(global);

    crypto.put(global, "pbkdf2", JSC.JSFunction.create(global, "pbkdf2", &pbkdf2, 5, .{}));
    crypto.put(global, "pbkdf2Sync", JSC.JSFunction.create(global, "pbkdf2Sync", &pbkdf2Sync, 5, .{}));
    crypto.put(global, "randomInt", randomInt(global));

    return crypto;
}
