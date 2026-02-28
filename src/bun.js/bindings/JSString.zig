pub const JSString = opaque {
    extern fn JSC__JSString__toObject(this: *JSString, global: *JSGlobalObject) ?*JSObject;
    extern fn JSC__JSString__toBunString(this: *JSString, global: *JSGlobalObject, out: *bun.String) void;
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

    pub fn ensureStillAlive(this: *JSString) void {
        std.mem.doNotOptimizeAway(this);
    }

    /// Returns a borrowed bun.String view of this JSString.
    /// The returned String has tag `.StringView` (or `.Empty`) — calling `.deref()` is a no-op.
    /// Lifetime is tied to this JSString's GC lifetime, NOT reference-counted.
    /// Call `ensureStillAlive()` on this JSString after using the view.
    pub fn toBunString(this: *JSString, global: *JSGlobalObject) bun.String {
        var out: bun.String = .empty;
        JSC__JSString__toBunString(this, global, &out);
        return out;
    }

    /// Returns a borrowed bun.String view. Same as `toBunString`.
    pub const view = toBunString;

    /// May allocate for 16-bit or non-ascii strings.
    /// Lifetime is tied to this JSString's GC lifetime if no allocation was needed.
    pub fn toSlice(
        this: *JSString,
        global: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) bun.String.Slice {
        return this.toBunString(global).toUTF8WithoutRef(allocator);
    }

    /// The returned slice is always allocated by `allocator`.
    pub fn toSliceClone(
        this: *JSString,
        global: *JSGlobalObject,
        allocator: std.mem.Allocator,
    ) OOM!bun.String.Slice {
        return this.toBunString(global).toUTF8WithoutRef(allocator).cloneIfBorrowed(allocator);
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

    pub const JStringIteratorAppend8Callback = *const fn (*Iterator, [*]const u8, u32) callconv(.c) void;
    pub const JStringIteratorAppend16Callback = *const fn (*Iterator, [*]const u16, u32) callconv(.c) void;
    pub const JStringIteratorWrite8Callback = *const fn (*Iterator, [*]const u8, u32, u32) callconv(.c) void;
    pub const JStringIteratorWrite16Callback = *const fn (*Iterator, [*]const u16, u32, u32) callconv(.c) void;
    pub const Iterator = extern struct {
        data: ?*anyopaque,
        stop: u8,
        append8: ?JStringIteratorAppend8Callback,
        append16: ?JStringIteratorAppend16Callback,
        write8: ?JStringIteratorWrite8Callback,
        write16: ?JStringIteratorWrite16Callback,
    };
};

const std = @import("std");
const JSObject = @import("./JSObject.zig").JSObject;

const bun = @import("bun");
const OOM = bun.OOM;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
