tcp: ?*uws.SocketContext = null,

onQueryResolveFn: jsc.Strong.Optional = .empty,
onQueryRejectFn: jsc.Strong.Optional = .empty,

pub fn init(globalObject: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    var ctx = &globalObject.bunVM().rareData().postgresql_context;
    ctx.onQueryResolveFn.set(globalObject, callframe.argument(0));
    ctx.onQueryRejectFn.set(globalObject, callframe.argument(1));

    return .js_undefined;
}

comptime {
    const js_init = jsc.toJSHostFn(init);
    @export(&js_init, .{ .name = "PostgresSQLContext__init" });
}

const bun = @import("bun");
const jsc = bun.jsc;
const uws = bun.uws;
