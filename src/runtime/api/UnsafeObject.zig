pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 4);
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
    object.put(globalThis, ZigString.static("mimallocProf"), createMimallocProf(globalThis));
    return object;
}

fn createMimallocProf(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const obj = JSValue.createEmptyObject(globalThis, 4);
    const fns = comptime .{
        .start = mimallocProfStart,
        .stop = mimallocProfStop,
        .reset = mimallocProfReset,
        .snapshot = mimallocSnapshot,
    };
    inline for (comptime std.meta.fieldNames(@TypeOf(fns))) |name| {
        obj.put(
            globalThis,
            comptime ZigString.static(name),
            jsc.JSFunction.create(globalThis, name, @field(fns, name), 1, .{}),
        );
    }
    return obj;
}

/// Bun.unsafe.mimallocProf.start(sampleRateBytes = 512 * 1024)
/// Begins sampling native (mimalloc) allocations. Resets any prior samples.
fn mimallocProfStart(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(1);
    var rate: usize = 512 * 1024;
    if (args.len >= 1 and !args.ptr[0].isEmptyOrUndefinedOrNull()) {
        const v = try args.ptr[0].coerce(i64, globalThis);
        if (v <= 0) return globalThis.throwInvalidArguments("sampleRateBytes must be > 0", .{});
        rate = @intCast(v);
    }
    bun.mimalloc.mi_prof_reset();
    bun.mimalloc.mi_prof_enable(rate);
    return .js_undefined;
}

/// Bun.unsafe.mimallocProf.stop() -> Buffer
/// Stops sampling and returns the profile.proto bytes (load with `go tool pprof`).
fn mimallocProfStop(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    bun.mimalloc.mi_prof_enable(0);
    const need = bun.mimalloc.mi_prof_dump_buf(null, 0);
    if (need == 0) return jsc.ArrayBuffer.createBuffer(globalThis, "");
    const tmp = try bun.default_allocator.alloc(u8, need);
    defer bun.default_allocator.free(tmp);
    const got = bun.mimalloc.mi_prof_dump_buf(tmp.ptr, need);
    return jsc.ArrayBuffer.createBuffer(globalThis, tmp[0..@min(got, need)]);
}

/// Bun.unsafe.mimallocProf.reset()
/// Discards collected samples without stopping profiling.
fn mimallocProfReset(_: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    bun.mimalloc.mi_prof_reset();
    return .js_undefined;
}

/// Bun.unsafe.mimallocProf.snapshot(path) -> boolean
/// Writes a structural heap snapshot (arenas/pages/blocks) for `mi-heapview`.
fn mimallocSnapshot(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(1);
    if (args.len < 1) return globalThis.throwInvalidArguments("snapshot(path) requires a path", .{});
    const str = try args.ptr[0].toBunString(globalThis);
    defer str.deref();
    var sfb = std.heap.stackFallback(1024, bun.default_allocator);
    const alloc = sfb.get();
    const path = try str.toOwnedSliceZ(alloc);
    defer alloc.free(path);
    const rc = bun.mimalloc.mi_heap_snapshot_to_file(path.ptr, 1);
    return JSValue.jsBoolean(rc == 0);
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
