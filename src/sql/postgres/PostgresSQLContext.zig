tcp: ?*uws.SocketContext = null,

onQueryResolveFn: JSC.Strong.Optional = .empty,
onQueryRejectFn: JSC.Strong.Optional = .empty,

pub fn init(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    var ctx = &globalObject.bunVM().rareData().postgresql_context;
    ctx.onQueryResolveFn.set(globalObject, callframe.argument(0));
    ctx.onQueryRejectFn.set(globalObject, callframe.argument(1));

    return .js_undefined;
}

comptime {
    const js_init = JSC.toJSHostFn(init);
    @export(&js_init, .{ .name = "PostgresSQLContext__init" });
}

const bun = @import("bun");
const JSC = bun.JSC;
const uws = bun.uws;
