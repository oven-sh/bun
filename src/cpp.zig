
const bun = @import("bun");
const JSC = bun.JSC;
const HTTPServerAgent = bun.jsc.Debugger.HTTPServerAgent;

const raw = struct {
    /// Source: bun.js/bindings/BunString.cpp:401:32
    extern fn BunString__toJSON(globalObject: *JSC.JSGlobalObject, bunString: *bun.String) JSC.JSValue;

    /// Source: bun.js/bindings/bindings.cpp:5177:17
    extern fn JSC__JSValue__toZigException(jsException: JSC.JSValue, global: *JSC.JSGlobalObject, exception: *bun.JSC.ZigException) void;
};

pub const bindings = struct {
    pub inline fn BunString__toJSON(globalObject: *JSC.JSGlobalObject, bunString: *bun.String) bun.JSError!JSC.JSValue {
        return bun.JSC.fromJSHostCall(raw.BunString__toJSON, @src(), .{ globalObject, bunString});
    }

    /// Source: bun.js/bindings/InspectorHTTPServerAgent.cpp:191:6
    pub extern fn Bun__HTTPServerAgent__notifyServerStarted(agent: *HTTPServerAgent.InspectorHTTPServerAgent, serverId: HTTPServerAgent.ServerId, hotReloadId: HTTPServerAgent.HotReloadId, address: *const bun.String, startTime: f64, serverInstance: *anyopaque) void;

    /// Source: bun.js/bindings/InspectorHTTPServerAgent.cpp:198:6
    pub extern fn Bun__HTTPServerAgent__notifyServerStopped(agent: *HTTPServerAgent.InspectorHTTPServerAgent, serverId: HTTPServerAgent.ServerId, timestamp: f64) void;

    /// Source: bun.js/bindings/InspectorHTTPServerAgent.cpp:225:6
    pub extern fn Bun__HTTPServerAgent__notifyServerRoutesUpdated(agent: *HTTPServerAgent.InspectorHTTPServerAgent, serverId: HTTPServerAgent.ServerId, hotReloadId: HTTPServerAgent.HotReloadId, routes_ptr: *HTTPServerAgent.Route, routes_len: usize) void;

    pub inline fn JSC__JSValue__toZigException(jsException: JSC.JSValue, global: *JSC.JSGlobalObject, exception: *bun.JSC.ZigException) bun.JSError!void {
        return bun.JSC.fromJSHostCallGeneric(raw.JSC__JSValue__toZigException, @src(), .{ jsException, global, exception});
    }
};
