pub fn create(globalThis: *JSC.JSGlobalObject) JSC.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 3);
    const fields = comptime .{
        .gcAggressionLevel = gcAggressionLevel,
        .arrayBufferToString = arrayBufferToString,
        .mimallocDump = dump_mimalloc,
    };
    inline for (comptime std.meta.fieldNames(@TypeOf(fields))) |name| {
        object.put(
            globalThis,
            comptime ZigString.static(name),
            JSC.createCallback(globalThis, comptime ZigString.static(name), 1, comptime @field(fields, name)),
        );
    }
    return object;
}

pub fn gcAggressionLevel(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const ret = JSValue.jsNumber(@as(i32, @intFromEnum(globalThis.bunVM().aggressive_garbage_collection)));
    const value = callframe.arguments_old(1).ptr[0];

    if (!value.isEmptyOrUndefinedOrNull()) {
        switch (value.coerce(i32, globalThis)) {
            1 => globalThis.bunVM().aggressive_garbage_collection = .mild,
            2 => globalThis.bunVM().aggressive_garbage_collection = .aggressive,
            0 => globalThis.bunVM().aggressive_garbage_collection = .none,
            else => {},
        }
    }
    return ret;
}

pub fn arrayBufferToString(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) bun.JSError!JSC.JSValue {
    const args = callframe.arguments_old(2).slice();
    if (args.len < 1 or !args[0].isCell() or !args[0].jsType().isTypedArrayOrArrayBuffer()) {
        return globalThis.throwInvalidArguments("Expected an ArrayBuffer", .{});
    }

    const array_buffer = JSC.ArrayBuffer.fromTypedArray(globalThis, args[0]);
    switch (array_buffer.typed_array_type) {
        .Uint16Array, .Int16Array => {
            var zig_str = ZigString.init("");
            zig_str._unsafe_ptr_do_not_use = @as([*]const u8, @ptrCast(@alignCast(array_buffer.ptr)));
            zig_str.len = array_buffer.len;
            zig_str.markUTF16();
            return zig_str.toJS(globalThis);
        },
        else => {
            return ZigString.init(array_buffer.slice()).toJS(globalThis);
        },
    }
}

extern fn dump_zone_malloc_stats() void;

fn dump_mimalloc(globalObject: *JSC.JSGlobalObject, _: *JSC.CallFrame) bun.JSError!JSC.JSValue {
    globalObject.bunVM().arena.dumpStats();
    if (bun.heap_breakdown.enabled) {
        dump_zone_malloc_stats();
    }
    return .js_undefined;
}

const JSC = bun.JSC;
const JSValue = JSC.JSValue;
const JSGlobalObject = JSC.JSGlobalObject;
const std = @import("std");
const bun = @import("bun");
const ZigString = JSC.ZigString;
