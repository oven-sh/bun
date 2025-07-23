pub const JSUint8Array = opaque {
    pub fn ptr(this: *JSUint8Array) [*]u8 {
        return @as(*[*]u8, @ptrFromInt(@intFromPtr(this) + Sizes.Bun_FFI_PointerOffsetToTypedArrayVector)).*;
    }

    pub fn len(this: *JSUint8Array) usize {
        return @as(*usize, @ptrFromInt(@intFromPtr(this) + Sizes.Bun_FFI_PointerOffsetToTypedArrayLength)).*;
    }

    pub fn slice(this: *JSUint8Array) []u8 {
        return this.ptr()[0..this.len()];
    }

    extern fn JSUint8Array__fromDefaultAllocator(*jsc.JSGlobalObject, ptr: [*]u8, len: usize) jsc.JSValue;
    /// *bytes* must come from bun.default_allocator
    pub fn fromBytes(globalThis: *JSGlobalObject, bytes: []u8) jsc.JSValue {
        return JSUint8Array__fromDefaultAllocator(globalThis, bytes.ptr, bytes.len);
    }

    extern fn Bun__createUint8ArrayForCopy(*jsc.JSGlobalObject, ptr: ?*const anyopaque, len: usize, buffer: bool) JSValue;
    pub fn fromBytesCopy(globalThis: *JSGlobalObject, bytes: []const u8) JSValue {
        return Bun__createUint8ArrayForCopy(globalThis, bytes.ptr, bytes.len, false);
    }

    pub fn createEmpty(globalThis: *JSGlobalObject) JSValue {
        return Bun__createUint8ArrayForCopy(globalThis, null, 0, false);
    }
};

const Sizes = @import("./sizes.zig");
const bun = @import("bun");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
