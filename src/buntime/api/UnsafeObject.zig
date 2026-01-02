pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
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
            jsc.JSFunction.create(globalThis, name, @field(fields, name), 1, .{}),
        );
    }
    return object;
}

pub fn gcAggressionLevel(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const ret = JSValue.jsNumber(@as(i32, @intFromEnum(globalThis.bunVM().aggressive_garbage_collection)));
    const value = callframe.arguments_old(1).ptr[0];

    if (!value.isEmptyOrUndefinedOrNull()) {
        switch (try value.coerce(i32, globalThis)) {
            1 => globalThis.bunVM().aggressive_garbage_collection = .mild,
            2 => globalThis.bunVM().aggressive_garbage_collection = .aggressive,
            0 => globalThis.bunVM().aggressive_garbage_collection = .none,
            else => {},
        }
    }
    return ret;
}

pub fn arrayBufferToString(
    globalThis: *jsc.JSGlobalObject,
    callframe: *jsc.CallFrame,
) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(2).slice();
    if (args.len < 1 or !args[0].isCell() or !args[0].jsType().isTypedArrayOrArrayBuffer()) {
        return globalThis.throwInvalidArguments("Expected an ArrayBuffer", .{});
    }

    const array_buffer = jsc.ArrayBuffer.fromTypedArray(globalThis, args[0]);
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

fn dump_mimalloc(globalObject: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    globalObject.bunVM().arena.dumpStats();
    if (bun.heap_breakdown.enabled) {
        dump_zone_malloc_stats();
    }
    return .js_undefined;
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
