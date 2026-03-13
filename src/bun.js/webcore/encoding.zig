//! Contains helpers for C++ to do TextEncoder/Decoder like operations.
//! Also contains the code used by `bun.String.encode` and `bun.String.encodeInto`

export fn Bun__encoding__writeLatin1(input: [*]const u8, len: usize, to: [*]u8, to_len: usize, encoding: u8) usize {
    return switch (@as(Encoding, @enumFromInt(encoding))) {
        .utf8 => writeU8(input, len, to, to_len, .utf8),
        .latin1 => writeU8(input, len, to, to_len, .latin1),
        .ascii => writeU8(input, len, to, to_len, .ascii),
        .ucs2 => writeU8(input, len, to, to_len, .utf16le),
        .utf16le => writeU8(input, len, to, to_len, .utf16le),
        .base64 => writeU8(input, len, to, to_len, .base64),
        .base64url => writeU8(input, len, to, to_len, .base64url),
        .hex => writeU8(input, len, to, to_len, .hex),
        else => unreachable,
    } catch 0;
}

export fn Bun__encoding__writeUTF16(input: [*]const u16, len: usize, to: [*]u8, to_len: usize, encoding: u8) usize {
    return switch (@as(Encoding, @enumFromInt(encoding))) {
        .utf8 => writeU16(input, len, to, to_len, .utf8, false),
        .latin1 => writeU16(input, len, to, to_len, .ascii, false),
        .ascii => writeU16(input, len, to, to_len, .ascii, false),
        .ucs2 => writeU16(input, len, to, to_len, .utf16le, false),
        .utf16le => writeU16(input, len, to, to_len, .utf16le, false),
        .base64 => writeU16(input, len, to, to_len, .base64, false),
        .base64url => writeU16(input, len, to, to_len, .base64url, false),
        .hex => writeU16(input, len, to, to_len, .hex, false),
        else => unreachable,
    } catch 0;
}

// TODO(@190n) handle unpaired surrogates
export fn Bun__encoding__byteLengthLatin1AsUTF8(input: [*]const u8, len: usize) usize {
    return byteLengthU8(input, len, .utf8);
}

// TODO(@190n) handle unpaired surrogates
export fn Bun__encoding__byteLengthUTF16AsUTF8(input: [*]const u16, len: usize) usize {
    return strings.elementLengthUTF16IntoUTF8(input[0..len]);
}

export fn Bun__encoding__constructFromLatin1(globalObject: *JSGlobalObject, input: [*]const u8, len: usize, encoding: u8) JSValue {
    const slice = switch (@as(Encoding, @enumFromInt(encoding))) {
        .hex => constructFromU8(input, len, bun.default_allocator, .hex),
        .ascii => constructFromU8(input, len, bun.default_allocator, .ascii),
        .base64url => constructFromU8(input, len, bun.default_allocator, .base64url),
        .utf16le => constructFromU8(input, len, bun.default_allocator, .utf16le),
        .ucs2 => constructFromU8(input, len, bun.default_allocator, .utf16le),
        .utf8 => constructFromU8(input, len, bun.default_allocator, .utf8),
        .base64 => constructFromU8(input, len, bun.default_allocator, .base64),
        else => unreachable,
    };
    return jsc.JSValue.createBuffer(globalObject, slice);
}

export fn Bun__encoding__constructFromUTF16(globalObject: *JSGlobalObject, input: [*]const u16, len: usize, encoding: u8) JSValue {
    const slice = switch (@as(Encoding, @enumFromInt(encoding))) {
        .base64 => constructFromU16(input, len, bun.default_allocator, .base64),
        .hex => constructFromU16(input, len, bun.default_allocator, .hex),
        .base64url => constructFromU16(input, len, bun.default_allocator, .base64url),
        .utf16le => constructFromU16(input, len, bun.default_allocator, .utf16le),
        .ucs2 => constructFromU16(input, len, bun.default_allocator, .utf16le),
        .utf8 => constructFromU16(input, len, bun.default_allocator, .utf8),
        .ascii => constructFromU16(input, len, bun.default_allocator, .ascii),
        .latin1 => constructFromU16(input, len, bun.default_allocator, .latin1),
        else => unreachable,
    };
    return jsc.JSValue.createBuffer(globalObject, slice);
}

// for SQL statement
export fn Bun__encoding__toStringUTF8(input: [*]const u8, len: usize, globalObject: *jsc.JSGlobalObject) JSValue {
    return toStringComptime(input[0..len], globalObject, .utf8) catch return .zero;
}

export fn Bun__encoding__toString(input: [*]const u8, len: usize, globalObject: *jsc.JSGlobalObject, encoding: u8) JSValue {
    return toString(input[0..len], globalObject, @enumFromInt(encoding)) catch return .zero;
}

// pub fn writeUTF16AsUTF8(utf16: [*]const u16, len: usize, to: [*]u8, to_len: usize) callconv(.c) i32 {
//     return @intCast(i32, strings.copyUTF16IntoUTF8(to[0..to_len], []const u16, utf16[0..len]).written);
// }
pub fn toString(input: []const u8, globalObject: *JSGlobalObject, encoding: Encoding) bun.JSError!JSValue {
    return switch (encoding) {
        // treat buffer as utf8
        // callers are expected to check that before constructing `Buffer` objects
        .buffer, .utf8 => try toStringComptime(input, globalObject, .utf8),

        inline else => |enc| try toStringComptime(input, globalObject, enc),
    };
}

pub fn toBunStringFromOwnedSlice(input: []u8, encoding: Encoding) bun.String {
    if (input.len == 0)
        return bun.String.empty;

    switch (encoding) {
        .ascii => {
            if (strings.isAllASCII(input)) {
                return bun.String.createExternalGloballyAllocated(.latin1, input);
            }

            const str, const chars = bun.String.createUninitialized(.latin1, input.len);
            defer bun.default_allocator.free(input);
            if (str.tag == .Dead) {
                return str;
            }
            strings.copyLatin1IntoASCII(chars, input);
            return str;
        },
        .latin1 => {
            return bun.String.createExternalGloballyAllocated(.latin1, input);
        },
        .buffer, .utf8 => {
            const converted = strings.toUTF16Alloc(bun.default_allocator, input, false, false) catch {
                bun.default_allocator.free(input);
                return bun.String.dead;
            };

            if (converted) |utf16| {
                defer bun.default_allocator.free(input);
                return bun.String.createExternalGloballyAllocated(.utf16, utf16);
            }

            // If we get here, it means we can safely assume the string is 100% ASCII characters
            return bun.String.createExternalGloballyAllocated(.latin1, input);
        },
        .ucs2, .utf16le => {
            // Avoid incomplete characters - if input length is 0 or odd, handle gracefully
            const usable_len = if (input.len % 2 != 0) input.len - 1 else input.len;

            if (usable_len == 0) {
                bun.default_allocator.free(input);
                return bun.String.empty;
            }

            const as_u16 = std.mem.bytesAsSlice(u16, input[0..usable_len]);
            return bun.String.createExternalGloballyAllocated(.utf16, @alignCast(as_u16));
        },

        .hex => {
            defer bun.default_allocator.free(input);
            const str, const chars = bun.String.createUninitialized(.latin1, input.len * 2);

            if (str.tag == .Dead) {
                return str;
            }

            const wrote = strings.encodeBytesToHex(chars, input);

            // Return an empty string in this case, just like node.
            if (wrote < chars.len) {
                str.deref();
                return bun.String.empty;
            }

            return str;
        },

        // TODO: this is not right. There is an issue here. But it needs to
        // be addressed separately because constructFromU8's base64url also
        // appears inconsistent with Node.js.
        .base64url => {
            defer bun.default_allocator.free(input);
            const out, const chars = bun.String.createUninitialized(.latin1, bun.base64.urlSafeEncodeLen(input));
            if (out.tag != .Dead) {
                _ = bun.base64.encodeURLSafe(chars, input);
            }
            return out;
        },

        .base64 => {
            defer bun.default_allocator.free(input);
            const to_len = bun.base64.encodeLen(input);
            const to = bun.default_allocator.alloc(u8, to_len) catch return bun.String.dead;
            const wrote = bun.base64.encode(to, input);
            return bun.String.createExternalGloballyAllocated(.latin1, to[0..wrote]);
        },
    }
}

pub fn toStringComptime(input: []const u8, global: *JSGlobalObject, comptime encoding: Encoding) bun.JSError!JSValue {
    var bun_string = toBunStringComptime(input, encoding);
    return try bun_string.transferToJS(global);
}

pub fn toBunString(input: []const u8, encoding: Encoding) bun.String {
    return switch (encoding) {
        inline else => |enc| toBunStringComptime(input, enc),
    };
}

pub fn toBunStringComptime(input: []const u8, comptime encoding: Encoding) bun.String {
    if (input.len == 0)
        return bun.String.empty;

    switch (comptime encoding) {
        .ascii => {
            const str, const chars = bun.String.createUninitialized(.latin1, input.len);
            if (str.tag == .Dead) {
                return str;
            }
            strings.copyLatin1IntoASCII(chars, input);
            return str;
        },
        .latin1 => {
            const str, const chars = bun.String.createUninitialized(.latin1, input.len);
            if (str.tag == .Dead) {
                return str;
            }
            @memcpy(chars, input);
            return str;
        },
        .buffer, .utf8 => {
            const converted = strings.toUTF16Alloc(bun.default_allocator, input, false, false) catch return bun.String.dead;
            if (converted) |utf16| {
                return bun.String.createExternalGloballyAllocated(.utf16, utf16);
            }

            // If we get here, it means we can safely assume the string is 100% ASCII characters
            // For this, we rely on WebKit to manage the memory.
            return bun.String.cloneLatin1(input);
        },
        .ucs2, .utf16le => {
            // Avoid incomplete characters
            if (input.len / 2 == 0) return bun.String.empty;

            const str, const chars = bun.String.createUninitialized(.utf16, input.len / 2);
            if (str.tag == .Dead) {
                return str;
            }
            var output_bytes = std.mem.sliceAsBytes(chars);
            output_bytes[output_bytes.len - 1] = 0;

            @memcpy(output_bytes, input[0..output_bytes.len]);
            return str;
        },

        .hex => {
            const str, const chars = bun.String.createUninitialized(.latin1, input.len * 2);
            if (str.tag == .Dead) {
                return str;
            }

            const wrote = strings.encodeBytesToHex(chars, input);
            bun.assert(wrote == chars.len);
            return str;
        },

        .base64url => {
            const to_len = bun.base64.urlSafeEncodeLen(input);
            const to = bun.default_allocator.alloc(u8, to_len) catch return bun.String.dead;
            const wrote = bun.base64.encodeURLSafe(to, input);
            return bun.String.createExternalGloballyAllocated(.latin1, to[0..wrote]);
        },

        .base64 => {
            const to_len = bun.base64.encodeLen(input);
            const to = bun.default_allocator.alloc(u8, to_len) catch return bun.String.dead;
            const wrote = bun.base64.encode(to, input);
            return bun.String.createExternalGloballyAllocated(.latin1, to[0..wrote]);
        },
    }
}

pub fn writeU8(input: [*]const u8, len: usize, to_ptr: [*]u8, to_len: usize, comptime encoding: Encoding) !usize {
    if (len == 0 or to_len == 0)
        return 0;

    // TODO: increase temporary buffer size for larger amounts of data
    // defer {
    //     if (comptime encoding.isBinaryToText()) {}
    // }

    // if (comptime encoding.isBinaryToText()) {}

    switch (comptime encoding) {
        .buffer, .latin1 => {
            const written = @min(len, to_len);
            @memcpy(to_ptr[0..written], input[0..written]);

            return written;
        },
        .ascii => {
            const written = @min(len, to_len);

            const to = to_ptr[0..written];
            var remain = input[0..written];

            if (bun.simdutf.validate.ascii(remain)) {
                @memcpy(to_ptr[0..written], remain[0..written]);
            } else {
                strings.copyLatin1IntoASCII(to, remain);
            }

            return written;
        },
        .utf8 => {
            // need to encode
            return strings.copyLatin1IntoUTF8(to_ptr[0..to_len], input[0..len]).written;
        },
        // encode latin1 into UTF16
        .ucs2, .utf16le => {
            if (to_len < 2)
                return 0;

            if (std.mem.isAligned(@intFromPtr(to_ptr), @alignOf([*]u16))) {
                const buf = input[0..len];

                const output = @as([*]u16, @ptrCast(@alignCast(to_ptr)))[0 .. to_len / 2];
                const written = strings.copyLatin1IntoUTF16([]u16, output, buf).written;
                return written * 2;
            } else {
                const buf = input[0..len];
                const output = @as([*]align(1) u16, @ptrCast(to_ptr))[0 .. to_len / 2];

                const written = strings.copyLatin1IntoUTF16([]align(1) u16, output, buf).written;
                return written * 2;
            }
        },

        .hex => {
            return strings.decodeHexToBytesTruncate(to_ptr[0..to_len], u8, input[0..len]);
        },

        .base64, .base64url => {
            return bun.base64.decode(to_ptr[0..to_len], input[0..len]).count;
        },
    }
}

pub fn byteLengthU8(input: [*]const u8, len: usize, comptime encoding: Encoding) usize {
    if (len == 0)
        return 0;

    switch (comptime encoding) {
        .utf8 => {
            return strings.elementLengthLatin1IntoUTF8(input[0..len]);
        },

        .latin1, .ascii, .buffer => {
            return len;
        },

        .ucs2, .utf16le => {
            return strings.elementLengthUTF8IntoUTF16(input[0..len]) * 2;
        },

        .hex => {
            return len / 2;
        },

        .base64, .base64url => {
            return bun.base64.decodeLen(input[0..len]);
        },
        // else => return &[_]u8{};
    }
}

pub fn encodeIntoFrom16(input: []const u16, to: []u8, comptime encoding: Encoding, comptime allow_partial_write: bool) !usize {
    return writeU16(input.ptr, input.len, to.ptr, to.len, encoding, allow_partial_write);
}

pub fn encodeIntoFrom8(input: []const u8, to: []u8, comptime encoding: Encoding) !usize {
    return writeU8(input.ptr, input.len, to.ptr, to.len, encoding);
}

pub fn writeU16(input: [*]const u16, len: usize, to: [*]u8, to_len: usize, comptime encoding: Encoding, comptime allow_partial_write: bool) !usize {
    if (len == 0)
        return 0;

    switch (comptime encoding) {
        .utf8 => {
            return strings.copyUTF16IntoUTF8Impl(
                to[0..to_len],
                input[0..len],
                allow_partial_write,
            ).written;
        },
        .latin1, .ascii, .buffer => {
            const out = @min(len, to_len);
            strings.copyU16IntoU8(to[0..to_len], input[0..out]);
            return out;
        },
        // string is already encoded, just need to copy the data
        .ucs2, .utf16le => {
            if (allow_partial_write) {
                const bytes_input_len = len * 2;
                const written = @min(bytes_input_len, to_len);
                const input_u8 = @as([*]const u8, @ptrCast(input));
                bun.memmove(to[0..written], input_u8[0..written]);
                return written;
            } else {
                const bytes_input_len = len * 2;
                const written = @min(bytes_input_len, to_len);
                if (written < 2) return 0;

                const fixed_len = (written / 2) * 2;
                const input_u8 = @as([*]const u8, @ptrCast(input));
                bun.memmove(to[0..written], input_u8[0..fixed_len]);
                return fixed_len;
            }
        },

        .hex => {
            return strings.decodeHexToBytesTruncate(to[0..to_len], u16, input[0..len]);
        },

        .base64, .base64url => {
            if (to_len < 2 or len == 0)
                return 0;

            // very very slow case!
            // shouldn't really happen though
            const transcoded = strings.toUTF8Alloc(bun.default_allocator, input[0..len]) catch return 0;
            defer bun.default_allocator.free(transcoded);
            return writeU8(transcoded.ptr, transcoded.len, to, to_len, encoding);
        },
        // else => return &[_]u8{};
    }
}

pub fn constructFrom(comptime T: type, input: []const T, allocator: std.mem.Allocator, comptime encoding: Encoding) []u8 {
    return switch (comptime T) {
        u16 => constructFromU16(input.ptr, input.len, allocator, encoding),
        u8 => constructFromU8(input.ptr, input.len, allocator, encoding),
        else => @compileError("Unsupported type for constructFrom: " ++ @typeName(T)),
    };
}

pub fn constructFromU8(input: [*]const u8, len: usize, allocator: std.mem.Allocator, comptime encoding: Encoding) []u8 {
    if (len == 0) return &[_]u8{};

    switch (comptime encoding) {
        .buffer => {
            var to = allocator.alloc(u8, len) catch return &[_]u8{};
            @memcpy(to[0..len], input[0..len]);
            return to;
        },
        .latin1, .ascii => {
            var to = allocator.alloc(u8, len) catch return &[_]u8{};
            @memcpy(to[0..len], input[0..len]);
            return to;
        },
        .utf8 => {
            // need to encode
            return strings.allocateLatin1IntoUTF8(allocator, input[0..len]) catch return &[_]u8{};
        },
        // encode latin1 into UTF16
        // return as bytes
        .ucs2, .utf16le => {
            var to = allocator.alloc(u16, len) catch return &[_]u8{};
            _ = strings.copyLatin1IntoUTF16([]u16, to, input[0..len]);
            return std.mem.sliceAsBytes(to[0..len]);
        },

        .hex => {
            if (len < 2)
                return &[_]u8{};

            var to = allocator.alloc(u8, len / 2) catch return &[_]u8{};
            return to[0..strings.decodeHexToBytesTruncate(to, u8, input[0..len])];
        },

        .base64, .base64url => {
            const slice = strings.trim(input[0..len], "\r\n\t " ++ [_]u8{std.ascii.control_code.vt});
            if (slice.len == 0) return &[_]u8{};

            const outlen = bun.base64.decodeLen(slice);
            const to = allocator.alloc(u8, outlen) catch return &[_]u8{};

            const wrote = bun.base64.decode(to[0..outlen], slice).count;
            return to[0..wrote];
        },
    }
}

pub fn constructFromU16(input: [*]const u16, len: usize, allocator: std.mem.Allocator, comptime encoding: Encoding) []u8 {
    if (len == 0) return &[_]u8{};

    switch (comptime encoding) {
        .utf8 => {
            return strings.toUTF8AllocWithType(allocator, input[0..len]) catch return &[_]u8{};
        },
        .latin1, .buffer, .ascii => {
            var to = allocator.alloc(u8, len) catch return &[_]u8{};
            strings.copyU16IntoU8(to[0..len], input[0..len]);
            return to;
        },
        // string is already encoded, just need to copy the data
        .ucs2, .utf16le => {
            var to = std.mem.sliceAsBytes(allocator.alloc(u16, len) catch return &[_]u8{});
            const bytes = std.mem.sliceAsBytes(input[0..len]);
            @memcpy(to[0..bytes.len], bytes);
            return to;
        },

        .hex => {
            var to = allocator.alloc(u8, len * 2) catch return &[_]u8{};
            return to[0..strings.decodeHexToBytesTruncate(to, u16, input[0..len])];
        },

        .base64, .base64url => {
            // very very slow case!
            // shouldn't really happen though
            const transcoded = strings.toUTF8Alloc(allocator, input[0..len]) catch return &[_]u8{};
            defer allocator.free(transcoded);
            return constructFromU8(transcoded.ptr, transcoded.len, allocator, encoding);
        },
    }
}

comptime {
    _ = &Bun__encoding__writeLatin1;
    _ = &Bun__encoding__writeUTF16;
    _ = &Bun__encoding__byteLengthLatin1AsUTF8;
    _ = &Bun__encoding__byteLengthUTF16AsUTF8;
    _ = &Bun__encoding__toString;
    _ = &Bun__encoding__toStringUTF8;
    _ = &Bun__encoding__constructFromLatin1;
    _ = &Bun__encoding__constructFromUTF16;
}

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;

const jsc = bun.jsc;
const JSGlobalObject = jsc.JSGlobalObject;
const JSValue = jsc.JSValue;
const Encoding = jsc.Node.Encoding;
