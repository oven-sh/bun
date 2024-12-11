const StringDecoder = @This();
const Encoding = JSC.Node.Encoding;

// config
encoding: Encoding,
// state
last_char: [4]u8,
missing_bytes: u8,
last_total: usize,

pub fn constructor(encoding: Encoding) !StringDecoder {
    return .{
        .last_char = .{ 0, 0, 0, 0 },
        .last_total = 0,
        .last_need = 0,
        .encoding = encoding,
    };
}

pub fn deinit(decoder: *StringDecoder, global: *JSC.JSGlobalObject) void {
    // No allocated memory
    _ = decoder;
    _ = global;
}

// From Node.js source code:
// if (typeof buf === 'string')
//     return buf;
pub fn write1(string: bun.String) bun.String {
    return string;
}

pub fn write2(decoder: *StringDecoder, global: *JSC.JSGlobalObject, buffer: JSC.ArrayBuffer) bun.String {
    const data = buffer.slice();
    const allocator = bun.default_allocator;
    _ = allocator;
    return switch (decoder.encoding) {
        .utf8,
        .usc2,
        .utf16le,
        .base64,
        .base64url,
        => {
            if (decoder.missing_bytes > 0) @panic("TODO");

            // const converted = bun.strings.toUTF16Alloc(allocator, input, false, false) catch return ZigString.init("Out of memory").toErrorInstance(global);
        },

        // Single-byte encodings
        inline .ascii, .latin1, .hex => |enc| JSC.WebCore.Encoder.toString(
            data.ptr,
            data.len,
            global,
            enc,
        ),
    };
}

pub fn getLastChar(decoder: *StringDecoder, global: *JSC.JSGlobalObject) !JSC.JSValue {
    const allocator = bun.default_allocator;
    const mem = try allocator.dupe(u8, decoder.last_char.slice());
    errdefer allocator.free(mem);
    return JSC.JSValue.createBuffer(global, mem, allocator);
}

const Utf8ByteKind = enum(i8) {
    ascii = 0,
    continuation = 1,
    invalid = 1,
    start_2_byte = 2,
    start_3_byte = 3,
    start_4_byte = 4,

    /// Checks the type of a UTF-8 byte, whether it's ASCII, a leading byte, or a
    /// continuation byte. If an invalid byte is detected, -2 is returned.
    fn classify(byte: u8) Utf8ByteKind {
        if (byte <= 0x7f) {
            return .ascii;
        } else if ((byte >> 5) == 0x06) {
            return .start_2_byte;
        } else if ((byte >> 4) == 0x0e) {
            return .start_3_byte;
        } else if ((byte >> 3) == 0x1e) {
            return .start_4_byte;
        } else if ((byte >> 6) == 0x02) {
            return .continuation;
        } else {
            return .invalid;
        }
    }
};

const IncompleteBytes = struct {
    valid: usize,
    invalid: usize,
    more_bytes: u8,
};

fn utf8SplitIncomplete(input: []const u8) ?IncompleteBytes {
    bun.assert(input.len > 0);
    var i = input.len;
    inline for (0..3) |_| {
        switch (Utf8ByteKind.classify(input[i])) {
            .continuation => {
                i -= 1;
                if (i == 0) return null;
            },
            .ascii, .invalid => return null,
            else => |start_byte| return .{
                .valid = i,
                .invalid = input.len - i,
                .more_bytes = @intCast(@intFromEnum(start_byte)),
            },
        }
    }
    return null;
}

const std = @import("std");
const bun = @import("root").bun;
const JSC = bun.JSC;
const StringOrBuffer = JSC.Node.StringOrBuffer;
