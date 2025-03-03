const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const JSObject = @import("JSObject.zig").JSObject;
const ZigString = @import("ZigString.zig").ZigString;
const JSError = bun.JSError;

pub const JSString = extern struct {
    pub const shim = JSC.Shimmer("JSC", "JSString", @This());
    bytes: shim.Bytes,
    const cppFn = shim.cppFn;
    pub const include = "JavaScriptCore/JSString.h";
    pub const name = "JSC::JSString";
    pub const namespace = "JSC";

    pub fn toJS(str: *JSString) JSValue {
        return JSValue.fromCell(str);
    }

    pub fn toObject(this: *JSString, global: *JSGlobalObject) ?*JSObject {
        return shim.cppFn("toObject", .{ this, global });
    }

    pub fn toZigString(this: *JSString, global: *JSGlobalObject, zig_str: *JSC.ZigString) void {
        return shim.cppFn("toZigString", .{ this, global, zig_str });
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
        return shim.cppFn("eql", .{ this, global, other });
    }

    pub fn iterator(this: *JSString, globalObject: *JSGlobalObject, iter: *anyopaque) void {
        return shim.cppFn("iterator", .{ this, globalObject, iter });
    }

    pub fn length(this: *const JSString) usize {
        return shim.cppFn("length", .{
            this,
        });
    }

    pub fn is8Bit(this: *const JSString) bool {
        return shim.cppFn("is8Bit", .{
            this,
        });
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

    pub const Extern = [_][]const u8{ "toZigString", "iterator", "toObject", "eql", "value", "length", "is8Bit", "createFromOwnedString", "createFromString" };
};
