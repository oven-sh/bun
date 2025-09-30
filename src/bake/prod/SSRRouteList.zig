extern "C" fn Bun__BakeProductionSSRRouteList__create(globalObject: *JSGlobalObject, route_count: usize) JSValue;
extern "C" fn Bun__BakeProductionSSRRouteList__getRouteInfo(globalObject: *JSGlobalObject, route_list_object: JSValue, index: usize) JSValue;

pub fn create(globalObject: *JSGlobalObject, route_count: usize) JSError!JSValue {
    return jsc.fromJSHostCall(globalObject, @src(), Bun__BakeProductionSSRRouteList__create, .{ globalObject, route_count });
}

pub fn getRouteInfo(globalObject: *JSGlobalObject, route_list_object: JSValue, index: usize) JSError!JSValue {
    return jsc.fromJSHostCall(globalObject, @src(), Bun__BakeProductionSSRRouteList__getRouteInfo, .{ globalObject, route_list_object, index });
}

const bun = @import("bun");
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSError = bun.JSError;
const JSValue = bun.jsc.JSValue;
const jsc = bun.jsc;
