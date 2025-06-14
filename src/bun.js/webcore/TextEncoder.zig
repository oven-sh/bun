pub export fn TextEncoder__encode8(
    globalThis: *JSGlobalObject,
    ptr: [*]const u8,
    len: usize,
) JSValue {
    // as much as possible, rely on JSC to own the memory
    // their code is more battle-tested than bun's code
    // so we do a stack allocation here
    // and then copy into JSC memory
    // unless it's huge
    // JSC will GC Uint8Array that occupy less than 512 bytes
    // so it's extra good for that case
    // this also means there won't be reallocations for small strings
    var buf: [2048]u8 = undefined;
    const slice = ptr[0..len];

    if (slice.len <= buf.len / 2) {
        const result = strings.copyLatin1IntoUTF8(&buf, []const u8, slice);
        const uint8array = JSC.JSValue.createUninitializedUint8Array(globalThis, result.written);
        bun.assert(result.written <= buf.len);
        bun.assert(result.read == slice.len);
        const array_buffer = uint8array.asArrayBuffer(globalThis) orelse return .zero;
        bun.assert(result.written == array_buffer.len);
        @memcpy(array_buffer.byteSlice()[0..result.written], buf[0..result.written]);
        return uint8array;
    } else {
        const bytes = strings.allocateLatin1IntoUTF8(globalThis.bunVM().allocator, []const u8, slice) catch {
            return globalThis.throwOutOfMemoryValue();
        };
        bun.assert(bytes.len >= slice.len);
        return ArrayBuffer.fromBytes(bytes, .Uint8Array).toJSUnchecked(globalThis, null);
    }
}

pub export fn TextEncoder__encode16(
    globalThis: *JSGlobalObject,
    ptr: [*]const u16,
    len: usize,
) JSValue {
    // as much as possible, rely on JSC to own the memory
    // their code is more battle-tested than bun's code
    // so we do a stack allocation here
    // and then copy into JSC memory
    // unless it's huge
    // JSC will GC Uint8Array that occupy less than 512 bytes
    // so it's extra good for that case
    // this also means there won't be reallocations for small strings
    var buf: [2048]u8 = undefined;

    const slice = ptr[0..len];

    // max utf16 -> utf8 length
    if (slice.len <= buf.len / 4) {
        const result = strings.copyUTF16IntoUTF8(&buf, @TypeOf(slice), slice, true);
        if (result.read == 0 or result.written == 0) {
            const uint8array = JSC.JSValue.createUninitializedUint8Array(globalThis, 3);
            const array_buffer = uint8array.asArrayBuffer(globalThis).?;
            const replacement_char = [_]u8{ 239, 191, 189 };
            @memcpy(array_buffer.slice()[0..replacement_char.len], &replacement_char);
            return uint8array;
        }
        const uint8array = JSC.JSValue.createUninitializedUint8Array(globalThis, result.written);
        bun.assert(result.written <= buf.len);
        bun.assert(result.read == slice.len);
        const array_buffer = uint8array.asArrayBuffer(globalThis).?;
        bun.assert(result.written == array_buffer.len);
        @memcpy(array_buffer.slice()[0..result.written], buf[0..result.written]);
        return uint8array;
    } else {
        const bytes = strings.toUTF8AllocWithType(
            bun.default_allocator,
            @TypeOf(slice),
            slice,
        ) catch {
            return globalThis.toInvalidArguments("Out of memory", .{});
        };
        return ArrayBuffer.fromBytes(bytes, .Uint8Array).toJSUnchecked(globalThis, null);
    }
}

pub export fn c(
    globalThis: *JSGlobalObject,
    ptr: [*]const u16,
    len: usize,
) JSValue {
    // as much as possible, rely on JSC to own the memory
    // their code is more battle-tested than bun's code
    // so we do a stack allocation here
    // and then copy into JSC memory
    // unless it's huge
    // JSC will GC Uint8Array that occupy less than 512 bytes
    // so it's extra good for that case
    // this also means there won't be reallocations for small strings
    var buf: [2048]u8 = undefined;

    const slice = ptr[0..len];

    // max utf16 -> utf8 length
    if (slice.len <= buf.len / 4) {
        const result = strings.copyUTF16IntoUTF8(&buf, @TypeOf(slice), slice, true);
        if (result.read == 0 or result.written == 0) {
            const uint8array = JSC.JSValue.createUninitializedUint8Array(globalThis, 3);
            const array_buffer = uint8array.asArrayBuffer(globalThis).?;
            const replacement_char = [_]u8{ 239, 191, 189 };
            @memcpy(array_buffer.slice()[0..replacement_char.len], &replacement_char);
            return uint8array;
        }
        const uint8array = JSC.JSValue.createUninitializedUint8Array(globalThis, result.written);
        bun.assert(result.written <= buf.len);
        bun.assert(result.read == slice.len);
        const array_buffer = uint8array.asArrayBuffer(globalThis).?;
        bun.assert(result.written == array_buffer.len);
        @memcpy(array_buffer.slice()[0..result.written], buf[0..result.written]);
        return uint8array;
    } else {
        const bytes = strings.toUTF8AllocWithType(
            bun.default_allocator,
            @TypeOf(slice),
            slice,
        ) catch {
            return globalThis.throwOutOfMemoryValue();
        };
        return ArrayBuffer.fromBytes(bytes, .Uint8Array).toJSUnchecked(globalThis, null);
    }
}

// This is a fast path for copying a Rope string into a Uint8Array.
// This keeps us from an extra string temporary allocation
const RopeStringEncoder = struct {
    globalThis: *JSGlobalObject,
    buf: []u8,
    tail: usize = 0,
    any_non_ascii: bool = false,

    pub fn append8(it: *JSC.JSString.Iterator, ptr: [*]const u8, len: u32) callconv(.C) void {
        var this = bun.cast(*RopeStringEncoder, it.data.?);
        const result = strings.copyLatin1IntoUTF8StopOnNonASCII(this.buf[this.tail..], []const u8, ptr[0..len], true);
        if (result.read == std.math.maxInt(u32) and result.written == std.math.maxInt(u32)) {
            it.stop = 1;
            this.any_non_ascii = true;
        } else {
            this.tail += result.written;
        }
    }
    pub fn append16(it: *JSC.JSString.Iterator, _: [*]const u16, _: u32) callconv(.C) void {
        var this = bun.cast(*RopeStringEncoder, it.data.?);
        this.any_non_ascii = true;
        it.stop = 1;
    }
    pub fn write8(it: *JSC.JSString.Iterator, ptr: [*]const u8, len: u32, offset: u32) callconv(.C) void {
        var this = bun.cast(*RopeStringEncoder, it.data.?);
        const result = strings.copyLatin1IntoUTF8StopOnNonASCII(this.buf[offset..], []const u8, ptr[0..len], true);
        if (result.read == std.math.maxInt(u32) and result.written == std.math.maxInt(u32)) {
            it.stop = 1;
            this.any_non_ascii = true;
        }
    }
    pub fn write16(it: *JSC.JSString.Iterator, _: [*]const u16, _: u32, _: u32) callconv(.C) void {
        var this = bun.cast(*RopeStringEncoder, it.data.?);
        this.any_non_ascii = true;
        it.stop = 1;
    }

    pub fn iter(this: *RopeStringEncoder) JSC.JSString.Iterator {
        return .{
            .data = this,
            .stop = 0,
            .append8 = append8,
            .append16 = append16,
            .write8 = write8,
            .write16 = write16,
        };
    }
};

// This fast path is only suitable for ASCII strings
// It's not suitable for UTF-16 strings, because getting the byteLength is unpredictable
// It also isn't usable for latin1 strings which contain non-ascii characters
pub export fn TextEncoder__encodeRopeString(
    globalThis: *JSGlobalObject,
    rope_str: *JSC.JSString,
) JSValue {
    if (comptime Environment.allow_assert) bun.assert(rope_str.is8Bit());
    var stack_buf: [2048]u8 = undefined;
    var buf_to_use: []u8 = &stack_buf;
    const length = rope_str.length();
    var array: JSValue = .zero;
    if (length > stack_buf.len / 2) {
        array = JSC.JSValue.createUninitializedUint8Array(globalThis, length);
        array.ensureStillAlive();
        buf_to_use = array.asArrayBuffer(globalThis).?.slice();
    }
    var encoder = RopeStringEncoder{
        .globalThis = globalThis,
        .buf = buf_to_use,
    };
    var iter = encoder.iter();
    array.ensureStillAlive();
    rope_str.iterator(globalThis, &iter);
    array.ensureStillAlive();

    if (encoder.any_non_ascii) {
        return .js_undefined;
    }

    if (array == .zero) {
        array = JSC.JSValue.createUninitializedUint8Array(globalThis, length);
        array.ensureStillAlive();
        @memcpy(array.asArrayBuffer(globalThis).?.ptr[0..length], buf_to_use[0..length]);
    }

    return array;
}

pub export fn TextEncoder__encodeInto16(
    input_ptr: [*]const u16,
    input_len: usize,
    buf_ptr: [*]u8,
    buf_len: usize,
) u64 {
    const output = buf_ptr[0..buf_len];
    const input = input_ptr[0..input_len];
    var result: strings.EncodeIntoResult = strings.copyUTF16IntoUTF8(output, []const u16, input, false);
    if (output.len >= 3 and (result.read == 0 or result.written == 0)) {
        const replacement_char = [_]u8{ 239, 191, 189 };
        @memcpy(buf_ptr[0..replacement_char.len], &replacement_char);
        result.read = 1;
        result.written = 3;
    }
    const sized: [2]u32 = .{ result.read, result.written };
    return @bitCast(sized);
}

pub export fn TextEncoder__encodeInto8(
    input_ptr: [*]const u8,
    input_len: usize,
    buf_ptr: [*]u8,
    buf_len: usize,
) u64 {
    const output = buf_ptr[0..buf_len];
    const input = input_ptr[0..input_len];
    const result: strings.EncodeIntoResult =
        strings.copyLatin1IntoUTF8(output, []const u8, input);
    const sized: [2]u32 = .{ result.read, result.written };
    return @bitCast(sized);
}

comptime {
    _ = &TextEncoder.TextEncoder__encode8;
    _ = &TextEncoder.TextEncoder__encode16;
    _ = &TextEncoder.TextEncoder__encodeInto8;
    _ = &TextEncoder.TextEncoder__encodeInto16;
    _ = &TextEncoder.TextEncoder__encodeRopeString;
}

const std = @import("std");
const bun = @import("bun");
const strings = bun.strings;
const JSC = bun.JSC;
const Environment = bun.Environment;
const JSGlobalObject = JSC.JSGlobalObject;
const JSValue = JSC.JSValue;
const ArrayBuffer = JSC.ArrayBuffer;
const TextEncoder = @This();
