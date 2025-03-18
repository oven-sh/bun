const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const GetterSetter = @import("GetterSetter.zig").GetterSetter;
const CustomGetterSetter = @import("CustomGetterSetter.zig").CustomGetterSetter;

pub const JSCell = opaque {
    pub const name = "JSC::JSCell";
    pub const namespace = "JSC";
    pub const include = "JavaScriptCore/JSCell.h";

    pub fn getObject(this: *JSCell) *JSC.JSObject {
        return JSC__JSCell__getObject(this);
    }

    pub fn getType(this: *JSCell) u8 {
        return JSC__JSCell__getType(this);
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
    extern fn JSC__JSCell__getType(this: *JSCell) u8;
};
