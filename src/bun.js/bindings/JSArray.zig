const bun = @import("bun");
const JSC = bun.JSC;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const JSArrayIterator = @import("./JSArrayIterator.zig").JSArrayIterator;

pub const JSArray = opaque {
    // TODO(@paperclover): this can throw
    extern fn JSArray__constructArray(*JSGlobalObject, [*]const JSValue, usize) JSValue;

    pub fn create(global: *JSGlobalObject, items: []const JSValue) bun.JSError!JSValue {
        return bun.jsc.fromJSHostCall(global, @src(), JSArray__constructArray, .{ global, items.ptr, items.len });
    }

    extern fn JSArray__constructEmptyArray(*JSGlobalObject, usize) JSValue;

    pub fn createEmpty(global: *JSGlobalObject, len: usize) bun.JSError!JSValue {
        return bun.jsc.fromJSHostCall(global, @src(), JSArray__constructEmptyArray, .{ global, len });
    }

    pub fn iterator(array: *JSArray, global: *JSGlobalObject) bun.JSError!JSArrayIterator {
        return JSValue.fromCell(array).arrayIterator(global);
    }
};
