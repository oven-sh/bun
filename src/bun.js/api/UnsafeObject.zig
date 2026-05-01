pub fn create(globalThis: *jsc.JSGlobalObject) jsc.JSValue {
    const object = JSValue.createEmptyObject(globalThis, 5);
    const fields = comptime .{
        .gcAggressionLevel = gcAggressionLevel,
        .arrayBufferToString = arrayBufferToString,
        .mimallocDump = dump_mimalloc,
        .napiLinkSlots = napiLinkSlots,
        .linkNapiModule = linkNapiModule,
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

/// Return the NAPI link-slot table as an array of
/// `{ index, used, path, offset, length, hash }` so tests (and curious
/// users) can see which stub loaders are populated in the current
/// executable. This inspects the running binary's own table, not a file.
pub fn napiLinkSlots(globalThis: *jsc.JSGlobalObject, _: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const slots = bun.napi_link.slots();
    const arr = try jsc.JSValue.createEmptyArray(globalThis, slots.len);
    for (slots, 0..) |*slot, i| {
        const obj = JSValue.createEmptyObject(globalThis, 6);
        obj.put(globalThis, ZigString.static("index"), JSValue.jsNumber(@as(i32, @intCast(slot.index()))));
        obj.put(globalThis, ZigString.static("used"), JSValue.jsBoolean(slot.isUsed()));
        obj.put(globalThis, ZigString.static("path"), try bun.String.createUTF8ForJS(globalThis, slot.pathSlice()));
        obj.put(globalThis, ZigString.static("offset"), JSValue.jsNumber(@as(f64, @floatFromInt(slot.offset))));
        obj.put(globalThis, ZigString.static("length"), JSValue.jsNumber(@as(f64, @floatFromInt(slot.length))));
        obj.put(globalThis, ZigString.static("hash"), try bun.String.createUTF8ForJS(globalThis, &std.fmt.bytesToHex(std.mem.asBytes(&slot.hash), .lower)));
        try arr.putIndex(globalThis, @intCast(i), obj);
    }
    return arr;
}

/// `Bun.unsafe.linkNapiModule(exePath, addonPath, virtualPath, outPath)`
/// Post-process a `bun build --compile` executable: append the Mach-O
/// `.node` image at `addonPath` into the `__BUN,__bun` section and stamp
/// the first free stub slot so that `process.dlopen(virtualPath)` inside the
/// resulting binary resolves to it. Writes the result to `outPath` (which
/// may equal `exePath`). Mach-O only for now.
pub fn linkNapiModule(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!jsc.JSValue {
    const args = callframe.arguments_old(4).slice();
    if (args.len < 4) {
        return globalThis.throwInvalidArguments("linkNapiModule(exePath, addonPath, virtualPath, outPath) requires 4 arguments", .{});
    }

    const allocator = bun.default_allocator;

    var exe_path = try args[0].toSliceOrNull(globalThis);
    defer exe_path.deinit();
    var addon_path = try args[1].toSliceOrNull(globalThis);
    defer addon_path.deinit();
    var virtual_path = try args[2].toSliceOrNull(globalThis);
    defer virtual_path.deinit();
    var out_path = try args[3].toSliceOrNull(globalThis);
    defer out_path.deinit();

    const exe_bytes = switch (bun.sys.File.readFrom(bun.FD.cwd(), exe_path.slice(), allocator)) {
        .result => |b| b,
        .err => |e| return globalThis.throwValue(try e.withPath(exe_path.slice()).toJS(globalThis)),
    };
    defer allocator.free(exe_bytes);

    const addon_bytes = switch (bun.sys.File.readFrom(bun.FD.cwd(), addon_path.slice(), allocator)) {
        .result => |b| b,
        .err => |e| return globalThis.throwValue(try e.withPath(addon_path.slice()).toJS(globalThis)),
    };
    defer allocator.free(addon_bytes);

    const out_bytes = bun.napi_link.linkIntoMachO(allocator, exe_bytes, addon_bytes, virtual_path.slice()) catch |err| switch (err) {
        error.UnsupportedExecutableFormat => return globalThis.throw("linkNapiModule: executable is not a Mach-O file (only macOS targets are supported for now)", .{}),
        error.NotStandaloneExecutable => return globalThis.throw("linkNapiModule: executable was not produced by `bun build --compile`", .{}),
        error.NoFreeSlot => return globalThis.throw("linkNapiModule: all {d} NAPI link slots are in use", .{bun.napi_link.Slot.count}),
        error.PathTooLong => return globalThis.throw("linkNapiModule: virtual path must be < 224 bytes", .{}),
        error.SlotTableMissing => return globalThis.throw("linkNapiModule: executable has no NAPI link slot table (was it built with an older bun?)", .{}),
        error.OutOfMemory => return globalThis.throwOutOfMemory(),
    };
    defer allocator.free(out_bytes);

    var out_buf: bun.PathBuffer = undefined;
    const out_z = bun.path.z(out_path.slice(), &out_buf);
    const out_file = bun.sys.File.openat(bun.FD.cwd(), out_z, bun.O.WRONLY | bun.O.CREAT | bun.O.TRUNC, 0o755).unwrap() catch |err| {
        return globalThis.throw("linkNapiModule: failed to open output file: {s}", .{@errorName(err)});
    };
    defer out_file.close();
    switch (out_file.writeAll(out_bytes)) {
        .result => {},
        .err => |e| return globalThis.throwValue(try e.withPath(out_path.slice()).toJS(globalThis)),
    }

    return .js_undefined;
}

const bun = @import("bun");
const std = @import("std");

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
