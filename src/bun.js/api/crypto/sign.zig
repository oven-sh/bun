const bun = @import("root").bun;
const JSC = bun.JSC;
const VirutalMachine = JSC.VirtualMachine;
const JSValue = JSC.JSValue;
const Async = bun.Async;
const JSGlobalObject = JSC.JSGlobalObject;
const std = @import("std");
const ZigString = bun.JSC.ZigString;
const Crypto = JSC.API.Bun.Crypto;
const BoringSSL = bun.BoringSSL;
const EVP = Crypto;

pub const Sign = struct {
    this_value: JSC.JSValue = .zero,
    ref: Async.KeepAlive = .{},
    evp: EVP,
    globalObject: *JSC.JSGlobalObject,
    ref_count: std.atomic.Value(u32) = std.atomic.Value(u32).init(1),

    pub usingnamespace JSC.Codegen.JSSign;
    pub usingnamespace bun.NewThreadSafeRefCounted(@This(), deinitFn);

    fn deinitFn(this: *Sign) void {
        this.destroy();
    }

    pub fn signOneShot(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) JSC.JSValue {
        _ = globalObject;
        _ = callFrame;
        return .zero;
    }

    pub fn constructor(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) ?*Sign {
        const arguments = callFrame.arguments(2).slice();
        if (arguments.len < 1 or !arguments[0].isString()) {
            globalObject.throwNotEnoughArguments("Sign", 1, 0);
            return null;
        }
        const evp = EVP.byName(arguments[0].getZigString(globalObject), globalObject) orelse {
            return null;
        };

        return Sign.new(.{
            .evp = evp,
            .globalObject = globalObject,
        });
    }

    pub fn update(this: *Sign, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        const this_value = callframe.this();
        this.this_value = this_value;
        const arguments = callframe.arguments(3).slice();
        if (arguments.len < 1) {
            globalThis.throwNotEnoughArguments("Sign.update", 2, 0);
            return .zero;
        }

        const data = arguments[0];
        const input_encoding_value: JSC.JSValue = if (arguments.len > 1) arguments[1] else .undefined;

        var string_or_buffer = JSC.Node.StringOrBuffer.fromJSWithEncodingValue(globalThis, bun.default_allocator, data, input_encoding_value) orelse return .zero;
        defer string_or_buffer.deinit();
        this.evp.update(string_or_buffer.slice());
        return this_value;
    }

    pub fn finalSign(this: *Sign, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        _ = this; // autofix
        _ = globalThis; // autofix
        const arguments = callframe.arguments(8).slice();

        BoringSSL.
        
    }

    pub fn finalize(this: *Sign) void {
        this.deref();
    }
};
