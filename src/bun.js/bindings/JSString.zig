const std = @import("std");
const bun = @import("bun");
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = @import("JSObject.zig").JSObject;
const ZigString = @import("ZigString.zig").ZigString;
const JSError = bun.JSError;

pub const JSString = opaque {
    extern fn JSC__JSString__toObject(this: *JSString, global: *JSGlobalObject) ?*JSObject;
    extern fn JSC__JSString__toZigString(this: *JSString, global: *JSGlobalObject, zig_str: *JSC.ZigString) void;
    extern fn JSC__JSString__eql(this: *const JSString, global: *JSGlobalObject, other: *JSString) bool;
    extern fn JSC__JSString__iterator(this: *JSString, globalObject: *JSGlobalObject, iter: *anyopaque) void;
    extern fn JSC__JSString__length(this: *const JSString) usize;
    extern fn JSC__JSString__is8Bit(this: *const JSString) bool;

    pub fn toJS(str: *JSString) JSValue {
        return JSValue.fromCell(str);
    }

    pub fn toObject(this: *JSString, global: *JSGlobalObject) ?*JSObject {
        return JSC__JSString__toObject(this, global);
    }

    pub fn toZigString(this: *JSString, global: *JSGlobalObject, zig_str: *JSC.ZigString) void {
        return JSC__JSString__toZigString(this, global, zig_str);
    }

    pub fn ensureStillAlive(this: *JSString) void {
        std.mem.doNotOptimizeAway(this);
    }

    pub fn getZigString(this: *JSString, global: *JSGlobalObject) JSC.ZigString {
        var out = JSC.ZigString.init("");
        this.toZigString(global, &out);
        return out;
    }

    pub const view = getZigString;

    /// doesn't always allocate
    pub fn toSlice(
        this: *JSString,
        global: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) ZigString.Slice {
        var str = ZigString.init("");
        this.toZigString(global, &str);
        return str.toSlice(allocator);
    }

    pub fn toSliceClone(
        this: *JSString,
        global: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) JSError!ZigString.Slice {
        var str = ZigString.init("");
        this.toZigString(global, &str);
        return str.toSliceClone(allocator);
    }

    pub fn toSliceZ(
        this: *JSString,
        global: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) ZigString.Slice {
        var str = ZigString.init("");
        this.toZigString(global, &str);
        return str.toSliceZ(allocator);
    }

    pub fn eql(this: *const JSString, global: *JSGlobalObject, other: *JSString) bool {
        return JSC__JSString__eql(this, global, other);
    }

    pub fn iterator(this: *JSString, globalObject: *JSGlobalObject, iter: *anyopaque) void {
        return JSC__JSString__iterator(this, globalObject, iter);
    }

    pub fn length(this: *const JSString) usize {
        return JSC__JSString__length(this);
    }

    pub fn is8Bit(this: *const JSString) bool {
        return JSC__JSString__is8Bit(this);
    }

    pub const JStringIteratorAppend8Callback = *const fn (*Iterator, [*]const u8, u32) callconv(.C) void;
    pub const JStringIteratorAppend16Callback = *const fn (*Iterator, [*]const u16, u32) callconv(.C) void;
    pub const JStringIteratorWrite8Callback = *const fn (*Iterator, [*]const u8, u32, u32) callconv(.C) void;
    pub const JStringIteratorWrite16Callback = *const fn (*Iterator, [*]const u16, u32, u32) callconv(.C) void;
    pub const Iterator = extern struct {
        data: ?*anyopaque,
        stop: u8,
        append8: ?JStringIteratorAppend8Callback,
        append16: ?JStringIteratorAppend16Callback,
        write8: ?JStringIteratorWrite8Callback,
        write16: ?JStringIteratorWrite16Callback,
    };
};
