extern "C" fn Bun__BakeProductionSSRRouteList__create(globalObject: *JSGlobalObject, route_count: usize) JSValue;
extern "C" fn Bun__BakeProductionSSRRouteList__createRouteParamsStructure(globalObject: *JSGlobalObject, route_list_object: JSValue, index: usize, params: [*]const bun.String, params_count: usize) JSValue;
extern "C" fn Bun__BakeProductionSSRRouteList__getRouteParamsStructure(globalObject: *JSGlobalObject, route_list_object: JSValue, index: usize) JSValue;

pub fn create(globalObject: *JSGlobalObject, route_count: usize) JSError!JSValue {
    return jsc.fromJSHostCall(
        globalObject,
        @src(),
        Bun__BakeProductionSSRRouteList__create,
        .{ globalObject, route_count },
    );
}

pub fn createRouteParamsStructure(globalObject: *JSGlobalObject, route_list_object: JSValue, index: usize, params: []const bun.String) JSError!JSValue {
    return jsc.fromJSHostCall(
        globalObject,
        @src(),
        Bun__BakeProductionSSRRouteList__createRouteParamsStructure,
        .{ globalObject, route_list_object, index, params.ptr, params.len },
    );
}

pub fn getRouteParamsStructure(globalObject: *JSGlobalObject, route_list_object: JSValue, index: usize) JSError!?JSValue {
    const value = try jsc.fromJSHostCall(
        globalObject,
        @src(),
        Bun__BakeProductionSSRRouteList__getRouteParamsStructure,
        .{ globalObject, route_list_object, index },
    );
    if (value.isEmptyOrUndefinedOrNull()) return null;
    return value;
}

const bun = @import("bun");
const JSGlobalObject = bun.jsc.JSGlobalObject;
const JSError = bun.JSError;
const JSValue = bun.jsc.JSValue;
const jsc = bun.jsc;
