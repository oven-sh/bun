pub const JSCell = opaque {
    /// Statically cast a cell to a JSObject. Returns null for non-objects.
    /// Use `toObject` to mutate non-objects into objects.
    pub fn getObject(this: *JSCell) ?*jsc.JSObject {
        jsc.markMemberBinding(JSCell, @src());
        return JSC__JSCell__getObject(this);
    }

    /// Convert a cell to a JSObject.
    ///
    /// Statically casts cells that are already objects, otherwise mutates them
    /// into objects.
    ///
    /// ## References
    /// - [ECMA-262 §7.1.18 ToObject](https://tc39.es/ecma262/#sec-toobject)
    pub fn toObject(this: *JSCell, global: *jsc.JSGlobalObject) *jsc.JSObject {
        jsc.markMemberBinding(JSCell, @src());
        return JSC__JSCell__toObject(this, global);
    }

    pub fn getType(this: *const JSCell) u8 {
        jsc.markMemberBinding(JSCell, @src());
        return @enumFromInt(JSC__JSCell__getType(this));
    }

    pub fn toJS(this: *JSCell) jsc.JSValue {
        return jsc.JSValue.fromCell(this);
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

    pub fn ensureStillAlive(this: *JSCell) void {
        std.mem.doNotOptimizeAway(this);
    }

    extern fn JSC__JSCell__getObject(this: *JSCell) *jsc.JSObject;
    extern fn JSC__JSCell__toObject(this: *JSCell, *JSGlobalObject) *jsc.JSObject;
    // NOTE: this function always returns a JSType, but by using `u8` then
    // casting it via `@enumFromInt` we can ensure our `JSType` enum matches
    // WebKit's. This protects us from possible future breaking changes made
    // when upgrading WebKit.
    extern fn JSC__JSCell__getType(this: *JSCell) u8;
};

const bun = @import("bun");
const std = @import("std");
const CustomGetterSetter = @import("./CustomGetterSetter.zig").CustomGetterSetter;
const GetterSetter = @import("./GetterSetter.zig").GetterSetter;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
