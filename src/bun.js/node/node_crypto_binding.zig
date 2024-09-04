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

pub const NodeCrypto = struct {
    /// src/js/node/crypto.ts calls this function through the zig operator `$zig()`
    /// We create the 'crypto' object that users import with 100% (ideally) native code
    pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
        const ncrypto = JSC.JSValue.createEmptyObject(globalThis, 4);

        ncrypto.put(globalThis, JSC.ZigString.static("pbkdf2"), JSC.NewFunction(globalThis, JSC.ZigString.static("pbkdf2"), 5, pbkdf2, true));
        ncrypto.put(globalThis, JSC.ZigString.static("pbkdf2Sync"), JSC.NewFunction(globalThis, JSC.ZigString.static("pbkdf2Sync"), 5, pbkdf2Sync, true));
        ncrypto.put(globalThis, JSC.ZigString.static("randomInt"), JSC.NewFunction(globalThis, JSC.ZigString.static("randomInt"), 2, randomInt, true));
        ncrypto.put(globalThis, JSC.ZigString.static("hkdfSync"), JSC.NewFunction(globalThis, JSC.ZigString.static("hkdfSync"), 2, hkdfSync, true));

        return ncrypto;
    }

    fn randomInt(globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const arguments = callframe.arguments(2).slice();

        //min, max
        if (!arguments[0].isNumber()) return globalThis.throwInvalidArgumentTypeValue("min", "safe integer", arguments[0]);
        if (!arguments[1].isNumber()) return globalThis.throwInvalidArgumentTypeValue("max", "safe integer", arguments[1]);
        const min = arguments[0].to(i64);
        const max = arguments[1].to(i64);

        if (min > validators.NUMBER__MAX_SAFE_INTEGER or min < validators.NUMBER__MIN_SAFE_INTEGER) {
            return globalThis.throwInvalidArgumentRangeValue("min", "It must be a safe integer type number", min);
        }
        if (max > validators.NUMBER__MAX_SAFE_INTEGER) {
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

    fn hkdfSync(
        globalThis: *JSC.JSGlobalObject,
        callframe: *JSC.CallFrame,
    ) JSC.JSValue {
        const arguments = callframe.arguments(5).slice();
        if (arguments.len < 5) {
            globalThis.throwNotEnoughArguments("hkdfSync", 5, arguments.len);
            return JSC.JSValue.null;
        }

        if (!arguments[0].isString()) {
            // todo: FIX field
            globalThis.throwInvalidArgumentType("hkdfSync", "digest", "<string>");
            return JSC.JSValue.null;
        }

        // From BunObject PBKDF2 `fromJS`
        const algorithm = brk: {
            if (!arguments[0].isString()) {
                _ = globalThis.throwInvalidArgumentTypeValue("algorithm", "string", arguments[0]);
                return JSC.JSValue.null;
            }

            const algorithm = EVP.Algorithm.map.fromJSCaseInsensitive(globalThis, arguments[0]) orelse {
                if (!globalThis.hasException()) {
                    const slice = arguments[0].toSlice(globalThis, bun.default_allocator);
                    defer slice.deinit();
                    const name = slice.slice();
                    globalThis.ERR_CRYPTO_INVALID_DIGEST("Unsupported algorithm \"{s}\"", .{name}).throw();
                }
                return JSC.JSValue.null;
            };

            break :brk EVP.Algorithm.md(algorithm) orelse {
                if (!globalThis.hasException()) {
                    const slice = arguments[0].toSlice(globalThis, bun.default_allocator);
                    defer slice.deinit();
                    const name = slice.slice();
                    globalThis.ERR_CRYPTO_INVALID_DIGEST("Unsupported algorithm \"{s}\"", .{name}).throw();
                }
                return JSC.JSValue.null;
            };
        };
        _ = algorithm;

        // This can also be a KeyObject
        // Be sure to test with all listed here: <string> | <ArrayBuffer> | <Buffer> | <TypedArray> | <DataView> | <KeyObject>
        // Be sure this works with a keylen of 0
        const ikm = JSC.Node.StringOrBuffer.fromJS(globalThis, globalThis.bunVM().allocator, arguments[1]) orelse {
            globalThis.throwInvalidArgumentType("hkdfSync", "ikm", "<string> | <ArrayBuffer> | <Buffer>");
            return JSC.JSValue.null;
        };
        const salt = JSC.Node.StringOrBuffer.fromJS(globalThis, globalThis.bunVM().allocator, arguments[2]) orelse {
            globalThis.throwInvalidArgumentType("hkdfSync", "salt", "<string> | <ArrayBuffer> | <Buffer>");
            return JSC.JSValue.null;
        };
        const info = JSC.Node.StringOrBuffer.fromJS(globalThis, globalThis.bunVM().allocator, arguments[3]) orelse {
            globalThis.throwInvalidArgumentType("hkdfSync", "info", "<string> | <ArrayBuffer> | <Buffer>");
            return JSC.JSValue.null;
        };
        _ = ikm;
        _ = salt;
        _ = info;

        if (!arguments[4].isAnyInt()) { // seems to filter negative values automatically
            _ = globalThis.throwInvalidArgumentTypeValue("keylen", "integer", arguments[4]);
            return JSC.JSValue.null;
        }

        // ensure this coersion is safe
        const keylen = arguments[4].coerce(i64, globalThis);

        if (keylen <= 0) {
            _ = globalThis.throwInvalidArgumentRangeValue("keylen", "integer", keylen);
            return JSC.JSValue.null;
        }

        // check constriant about hash size

        const out_key = JSC.JSValue.createBufferFromLength(globalThis, @intCast(keylen + 1));
        const out_key_ptr = @as([*c]u8, @ptrCast(out_key.asArrayBuffer(globalThis).?.ptr)); // what happens if Null is returned from `asArrayBuffer`?
        _ = out_key_ptr;

        BoringSSL.load();
        // https://github.com/nodejs/node/blob/main/src/crypto/crypto_hkdf.cc
        // Node Code to Copy
        //   if (HMAC(
        //           params.digest,
        //           salt.data(),
        //           salt.size(),
        //           reinterpret_cast<const unsigned char*>(params.key->GetSymmetricKey()),
        //           params.key->GetSymmetricKeySize(),
        //           pseudorandom_key,
        //           &prk_len) == nullptr) {
        //     return false;
        //   }
        //   if (!EVP_PKEY_CTX_hkdf_mode(ctx.get(), EVP_PKEY_HKDEF_MODE_EXPAND_ONLY) ||
        //       !EVP_PKEY_CTX_set1_hkdf_key(ctx.get(), pseudorandom_key, prk_len)) {
        //     return false;
        //   }
        //
        //   size_t length = params.length;
        //   ByteSource::Builder buf(length);
        //   if (EVP_PKEY_derive(ctx.get(), buf.data<unsigned char>(), &length) <= 0)
        //     return false;
        //

        return out_key;
    }
};
