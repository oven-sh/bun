const c = @import("std").c;
const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;

pub fn Bun__RsaKeyPairGenJob(
    ctx: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    _ = callframe;
    JSC.markBinding(@src());

    const globalThis = ctx.ptr();
    // const arguments = callframe.arguments(13);

    // var script_ctx = globalThis.bunVM();
    // var args = JSC.Node.ArgumentsSlice.init(script_ctx, arguments.ptr[0..arguments.len]);
    // var mode_arg = args.nextEat().?;

    // var mode: i64 = 0;
    // if (mode_arg.isNumber()) {
    //     mode = mode_arg.toInt64();
    // } else {
    //     globalThis.throwInvalidArguments("mode must be a constantsCrypto", .{});
    //     return .zero;
    // }

    globalThis.throwInvalidArguments("RsaKeyPairGenJob() not implemented yet", .{});
    return .zero;
}

pub fn Bun__DsaKeyPairGenJob(
    ctx: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    _ = callframe;
    JSC.markBinding(@src());

    const globalThis = ctx.ptr();

    globalThis.throwInvalidArguments("DsaKeyPairGenJob() not implemented yet", .{});
    return .zero;
}

pub fn Bun__EcKeyPairGenJob(
    ctx: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    _ = callframe;
    JSC.markBinding(@src());

    const globalThis = ctx.ptr();

    globalThis.throwInvalidArguments("EcKeyPairGenJob() not implemented yet", .{});
    return .zero;
}

pub fn Bun__NidKeyPairGenJob(
    ctx: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    _ = callframe;
    JSC.markBinding(@src());

    const globalThis = ctx.ptr();

    globalThis.throwInvalidArguments("NidKeyPairGenJob() not implemented yet", .{});
    return .zero;
}

pub fn Bun__DhKeyPairGenJob(
    ctx: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) callconv(.C) JSC.JSValue {
    _ = callframe;
    JSC.markBinding(@src());

    const globalThis = ctx.ptr();

    globalThis.throwInvalidArguments("DhKeyPairGenJob() not implemented yet", .{});
    return .zero;
}

pub export fn Bun__initKeyPairGenJob(
    global: *JSC.JSGlobalObject,
    obj: *JSC.JSValue,
) callconv(.C) void {
    JSC.markBinding(@src());
    obj.put(global, JSC.ZigString.static("RsaKeyPairGenJob"), JSC.NewFunction(global, JSC.ZigString.static("RsaKeyPairGenJob"), 0, Bun__RsaKeyPairGenJob, false));
    obj.put(global, JSC.ZigString.static("DsaKeyPairGenJob"), JSC.NewFunction(global, JSC.ZigString.static("DsaKeyPairGenJob"), 0, Bun__DsaKeyPairGenJob, false));
    obj.put(global, JSC.ZigString.static("EcKeyPairGenJob"), JSC.NewFunction(global, JSC.ZigString.static("EcKeyPairGenJob"), 0, Bun__EcKeyPairGenJob, false));
    obj.put(global, JSC.ZigString.static("NidKeyPairGenJob"), JSC.NewFunction(global, JSC.ZigString.static("NidKeyPairGenJob"), 0, Bun__NidKeyPairGenJob, false));
    obj.put(global, JSC.ZigString.static("DhKeyPairGenJob"), JSC.NewFunction(global, JSC.ZigString.static("DhKeyPairGenJob"), 0, Bun__DhKeyPairGenJob, false));
}

comptime {
    _ = Bun__initKeyPairGenJob;
}
