const c = @import("std").c;
const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;

pub export fn Bun__RsaKeyPairGenJob(
    ctx: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    _ = callframe;
    JSC.markBinding(@src());

    const globalThis = ctx.ptr();

    globalThis.throwInvalidArguments("canonicalizeIP() expects a string but received no arguments.", .{});
    return .zero;
}
comptime {
    _ = Bun__RsaKeyPairGenJob;
}
