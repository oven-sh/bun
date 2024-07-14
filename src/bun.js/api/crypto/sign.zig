const bun = @import("root").bun;
const JSC = bun.JSC;
const VirutalMachine = JSC.VirtualMachine;
const JSValue = JSC.JSValue;
const Async = bun.Async;
const JSGlobalObject = JSC.JSGlobalObject;
const std = @import("std");
const ZigString = bun.JSC.ZigString;
const Crypto = @import("../crypto.zig");
const BoringSSL = bun.BoringSSL;
const EVP = Crypto.EVP;

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

    pub fn signOneShot(globalObject: *JSGlobalObject, callFrame: *JSC.CallFrame) JSC.JSValue  { 
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
        _ = this; // autofix
        _ = globalThis; // autofix

        return callframe.this();

    }

    pub fn finalSign(this: *Sign, globalThis: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) JSC.JSValue {
        _ = this; // autofix

        _ = globalThis; // autofix

        return callframe.this();
    }

    pub fn finalize(this: *Sign) void {
        this.deref();
    }
};
