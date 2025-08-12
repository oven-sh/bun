const MySQLContext = @This();
tcp: ?*uws.SocketContext = null,

onQueryResolveFn: JSC.Strong.Optional = .empty,
onQueryRejectFn: JSC.Strong.Optional = .empty,

pub fn init(globalObject: *JSC.JSGlobalObject, callframe: *JSC.CallFrame) bun.JSError!JSValue {
    var ctx = &globalObject.bunVM().rareData().mysql_context;
    ctx.onQueryResolveFn.set(globalObject, callframe.argument(0));
    ctx.onQueryRejectFn.set(globalObject, callframe.argument(1));

    return .js_undefined;
}

comptime {
    @export(&JSC.toJSHostFn(init), .{ .name = "MySQLContext__init" });
}

const bun = @import("bun");
const JSC = bun.jsc;
const JSValue = JSC.JSValue;
const uws = bun.uws;
