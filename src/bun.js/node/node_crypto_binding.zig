const BoringSSL = bun.BoringSSL;
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

pub fn pbkdf2(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    const arguments = callframe.arguments(5);

    const data = PBKDF2.fromJS(globalThis, arguments.slice(), true) orelse {
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

pub fn createNodeCryptoBindingZig(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const crypto = JSC.JSValue.createEmptyObject(global, 3);

    crypto.put(global, bun.String.init("pbkdf2"), JSC.JSFunction.create(global, "pbkdf2", &pbkdf2, 5, .{}));
    crypto.put(global, bun.String.init("pbkdf2Sync"), JSC.JSFunction.create(global, "pbkdf2Sync", &pbkdf2Sync, 5, .{}));
    crypto.put(global, bun.String.init("randomInt"), randomInt(global));

    return crypto;
}

pub fn generatePrime(global: *JSC.JSGlobalObject) callconv(.C) JSC.JSValue {
    const S = struct {
        fn cb(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) callconv(.C) JSC.JSValue {
            const arguments = callframe.arguments(2).slice();

            if (!arguments[0].isNumber()) return globalThis.throwInvalidArgumentTypeValue("bits", "unsigned integer", arguments[0]);
            const bits_i64 = arguments[0].to(i64);

            if (bits_i64 < 1 or bits_i64 > @as(i64, std.math.maxInt(i32))) {
                globalThis.throwValue(globalThis.createRangeErrorInstance("bits must be a positive integer within the range of 1 to 2147483647", .{}));
                return .zero;
            }

            const bits: c_int = @as(c_int, @intCast(bits_i64));

            var safe: bool = false;

            var add: [*c]BoringSSL.BIGNUM = null;
            var rem: [*c]BoringSSL.BIGNUM = null;

            const options_value = arguments[1];
            if (!options_value.isEmptyOrUndefinedOrNull()) {
                if (!options_value.isObject()) {
                    globalThis.throwValue(JSC.toTypeError(JSC.Node.ErrorCode.ERR_INVALID_ARG_VALUE, "options must be an object", .{}, globalThis));
                    return .zero;
                }

                if (options_value.get(globalThis, "safe")) |v| {
                    if (!v.isBoolean()) {
                        return globalThis.throwInvalidArgumentTypeValue("safe", "boolean", v);
                    }
                    safe = v.toBoolean();
                }
                if (options_value.get(globalThis, "add")) |v| {
                    if (v.asArrayBuffer(globalThis)) |v2| {
                        const ll2 = v2.byteSlice();

                        add = BoringSSL.BN_bin2bn(ll2.ptr, ll2.len, null);
                    } else {
                        return globalThis.throwInvalidArgumentTypeValue("add", "must be an ArrayBuffer", v);
                    }
                }
                if (options_value.get(globalThis, "rem")) |v| {
                    if (v.asArrayBuffer(globalThis)) |v2| {
                        const ll2 = v2.byteSlice();

                        rem = BoringSSL.BN_bin2bn(ll2.ptr, ll2.len, null);
                    } else {
                        return globalThis.throwInvalidArgumentTypeValue("rem", "must be an ArrayBuffer", v);
                    }
                }

                // prevent BoringSSL from getting into an infinite loop
                if (rem != null and
                    BoringSSL.BN_cmp(add, rem) != 1)
                {
                    globalThis.throwValue(globalThis.createInvalidArgs("add must be greater than rem", .{}));
                    return .zero;
                }
            }

            BoringSSL.load();

            const ret: *BoringSSL.BIGNUM = BoringSSL.BN_new();

            if (BoringSSL.BN_generate_prime_ex(ret, bits, @intFromBool(safe), add, rem, null) != 1) {
                // something went wrong.
                std.debug.print("Failed to generate prime number\n", .{});
                const err = BoringSSL.ERR_get_error();

                const errStr = BoringSSL.ERR_error_string(err, null);
                std.debug.print("Error: {s}\n", .{errStr});
                globalThis.throwOutOfMemory();
                return .zero;
            }

            const num_bytes = BoringSSL.BN_num_bytes(ret);

            var bytes: []u8 = undefined;
            bytes = bun.default_allocator.alloc(u8, num_bytes) catch {
                bun.outOfMemory();
                return .zero;
            };

            _ = BoringSSL.BN_bn2bin_padded(bytes.ptr, num_bytes, ret);

            return JSC.ArrayBuffer.create(globalThis, bytes, .ArrayBuffer);
        }
    };
    return JSC.JSFunction.create(global, "generatePrime", S.cb, 1, .{});
}
