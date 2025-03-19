const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const GetterSetter = @import("GetterSetter.zig").GetterSetter;
const CustomGetterSetter = @import("CustomGetterSetter.zig").CustomGetterSetter;

pub const JSCell = opaque {
    /// Statically cast a cell to a JSObject. Returns null for non-objects.
    /// Use `toObject` to mutate non-objects into objects.
    pub fn getObject(this: *JSCell) ?*JSC.JSObject {
        return JSC__JSCell__getObject(this);
    }

    /// Convert a cell to a JSObject.
    ///
    /// Statically casts cells that are already objects, otherwise mutates them
    /// into objects.
    pub fn toObject(this: *JSCell, global: *JSC.JSGlobalObject) *JSC.JSObject {
        return JSC__JSCell__toObject(this, global);
    }

    pub fn getType(this: *JSCell) u8 {
        return JSC__JSCell__getType(this);
    }

    pub fn toJS(this: *JSCell) JSC.JSValue {
        return JSC.JSValue.fromCell(this);
    }

    pub fn getGetterSetter(this: *JSCell) *GetterSetter {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(JSValue.fromCell(this).isGetterSetter());
        }
        return @as(*GetterSetter, @ptrCast(@alignCast(this)));
    }

    pub fn getCustomGetterSetter(this: *JSCell) *CustomGetterSetter {
        if (comptime bun.Environment.allow_assert) {
            bun.assert(JSValue.fromCell(this).isCustomGetterSetter());
        }
        return @as(*CustomGetterSetter, @ptrCast(@alignCast(this)));
    }

    extern fn JSC__JSCell__getObject(this: *JSCell) *JSC.JSObject;
    extern fn JSC__JSCell__toObject(this: *JSCell, *JSGlobalObject) *JSC.JSObject;
    extern fn JSC__JSCell__getType(this: *JSCell) u8;
};
