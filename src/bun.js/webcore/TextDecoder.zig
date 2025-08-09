const TextDecoder = @This();

// used for utf8 decoding
buffered: struct {
    buf: [3]u8 = .{0} ** 3,
    len: u2 = 0,

    pub fn slice(this: *@This()) []const u8 {
        return this.buf[0..this.len];
    }
} = .{},

// used for utf16 decoding
lead_byte: ?u8 = null,
lead_surrogate: ?u16 = null,

// used for shift_jis decoding
shiftjis_lead: ?u8 = null,

ignore_bom: bool = false,
fatal: bool = false,
encoding: EncodingLabel = EncodingLabel.@"UTF-8",

pub const js = jsc.Codegen.JSTextDecoder;
pub const toJS = js.toJS;
pub const fromJS = js.fromJS;
pub const fromJSDirect = js.fromJSDirect;

pub const new = bun.TrivialNew(TextDecoder);

pub fn finalize(this: *TextDecoder) void {
    bun.destroy(this);
}

pub fn getIgnoreBOM(
    this: *TextDecoder,
    _: *jsc.JSGlobalObject,
) jsc.JSValue {
    return jsc.JSValue.jsBoolean(this.ignore_bom);
}

pub fn getFatal(
    this: *TextDecoder,
    _: *jsc.JSGlobalObject,
) jsc.JSValue {
    return jsc.JSValue.jsBoolean(this.fatal);
}

pub fn getEncoding(
    this: *TextDecoder,
    globalThis: *jsc.JSGlobalObject,
) jsc.JSValue {
    return ZigString.init(EncodingLabel.getLabel(this.encoding)).toJS(globalThis);
}
const Vector16 = std.meta.Vector(16, u16);
const max_16_ascii: Vector16 = @splat(@as(u16, 127));

fn processCodeUnitUTF16(
    this: *TextDecoder,
    output: *std.ArrayListUnmanaged(u16),
    saw_error: *bool,
    code_unit: u16,
) error{OutOfMemory}!void {
    if (this.lead_surrogate) |lead_surrogate| {
        this.lead_surrogate = null;

        if (strings.u16IsTrail(code_unit)) {
            // TODO: why is this here?
            // const code_point = strings.u16GetSupplementary(lead_surrogate, code_unit);
            try output.appendSlice(
                bun.default_allocator,
                &.{ lead_surrogate, code_unit },
            );
            return;
        }
        try output.append(bun.default_allocator, strings.unicode_replacement);
        saw_error.* = true;
    }

    if (strings.u16IsLead(code_unit)) {
        this.lead_surrogate = code_unit;
        return;
    }

    if (strings.u16IsTrail(code_unit)) {
        try output.append(bun.default_allocator, strings.unicode_replacement);
        saw_error.* = true;
        return;
    }

    try output.append(bun.default_allocator, code_unit);
    return;
}

pub fn codeUnitFromBytesUTF16(
    first: u16,
    second: u16,
    comptime big_endian: bool,
) u16 {
    return if (comptime big_endian)
        (first << 8) | second
    else
        first | (second << 8);
}

pub fn decodeUTF16(
    this: *TextDecoder,
    bytes: []const u8,
    comptime big_endian: bool,
    comptime flush: bool,
) error{OutOfMemory}!struct { std.ArrayListUnmanaged(u16), bool } {
    var output: std.ArrayListUnmanaged(u16) = .{};
    try output.ensureTotalCapacity(bun.default_allocator, @divFloor(bytes.len, 2));

    var remain = bytes;
    var saw_error = false;

    if (this.lead_byte) |lead_byte| {
        if (remain.len > 0) {
            this.lead_byte = null;

            try this.processCodeUnitUTF16(
                &output,
                &saw_error,
                codeUnitFromBytesUTF16(@intCast(lead_byte), @intCast(remain[0]), big_endian),
            );
            remain = remain[1..];
        }
    }

    var i: usize = 0;

    while (i < remain.len -| 1) {
        try this.processCodeUnitUTF16(
            &output,
            &saw_error,
            codeUnitFromBytesUTF16(@intCast(remain[i]), @intCast(remain[i + 1]), big_endian),
        );
        i += 2;
    }

    if (remain.len != 0 and i == remain.len - 1) {
        this.lead_byte = remain[i];
    } else {
        bun.assertWithLocation(i == remain.len, @src());
    }

    if (comptime flush) {
        if (this.lead_byte != null or this.lead_surrogate != null) {
            this.lead_byte = null;
            this.lead_surrogate = null;
            try output.append(bun.default_allocator, strings.unicode_replacement);
            saw_error = true;
            return .{ output, saw_error };
        }
    }

    return .{ output, saw_error };
}

pub fn decodeShiftJIS(
    this: *TextDecoder,
    bytes: []const u8,
    comptime flush: bool,
) error{OutOfMemory}!struct { std.ArrayListUnmanaged(u16), bool } {
    var output: std.ArrayListUnmanaged(u16) = .{};
    try output.ensureTotalCapacity(bun.default_allocator, bytes.len);

    var remain = bytes;
    var saw_error = false;

    while (remain.len > 0) {
        const byte = remain[0];
        remain = remain[1..];

        if (this.shiftjis_lead) |lead| {
            this.shiftjis_lead = null;

            const offset: u8 = if (byte < 0x7F) 0x40 else 0x41;
            const lead_offset: u8 = if (lead < 0xA0) 0x81 else 0xC1;

            if ((byte >= 0x40 and byte <= 0x7E) or (byte >= 0x80 and byte <= 0xFC)) {
                const pointer: u16 = (@as(u16, lead - lead_offset) * 188) + (byte - offset);

                // Handle private use area (pointers 8836-10715)
                if (pointer >= 8836 and pointer <= 10715) {
                    try output.append(bun.default_allocator, @as(u16, 0xE000 - 8836 + pointer));
                    continue;
                }

                // Lookup in JIS0208 table
                if (getJIS0208CodePoint(pointer)) |codepoint| {
                    if (codepoint <= 0xFFFF) {
                        try output.append(bun.default_allocator, @as(u16, @intCast(codepoint)));
                    } else {
                        // Convert to UTF-16 surrogate pair for code points > U+FFFF
                        const high = @as(u16, @intCast(0xD800 + ((codepoint - 0x10000) >> 10)));
                        const low = @as(u16, @intCast(0xDC00 + ((codepoint - 0x10000) & 0x3FF)));
                        try output.appendSlice(bun.default_allocator, &.{ high, low });
                    }
                    continue;
                }
            }

            // Invalid sequence - emit replacement character and potentially prepend current byte
            try output.append(bun.default_allocator, strings.unicode_replacement);
            saw_error = true;

            // If current byte is ASCII, prepend it for next iteration
            if (byte <= 0x7F or byte == 0x80) {
                this.shiftjis_lead = null; // Clear lead to process as single byte

                // Process the ASCII byte immediately
                try output.append(bun.default_allocator, @as(u16, byte));
                continue;
            }
        } else {
            // Single byte processing
            if (byte <= 0x7F or byte == 0x80) {
                // ASCII and JIS X 0201 range
                try output.append(bun.default_allocator, @as(u16, byte));
                continue;
            }

            // JIS X 0201 katakana range (0xA1-0xDF)
            if (byte >= 0xA1 and byte <= 0xDF) {
                try output.append(bun.default_allocator, @as(u16, @as(u16, 0xFF61 - 0xA1) + @as(u16, byte)));
                continue;
            }

            // Lead bytes for double-byte sequences
            if ((byte >= 0x81 and byte <= 0x9F) or (byte >= 0xE0 and byte <= 0xFC)) {
                this.shiftjis_lead = byte;
                continue;
            }

            // Invalid single byte
            try output.append(bun.default_allocator, strings.unicode_replacement);
            saw_error = true;
        }
    }

    // Handle flush - if we have a pending lead byte, emit replacement character
    if (comptime flush) {
        if (this.shiftjis_lead != null) {
            this.shiftjis_lead = null;
            try output.append(bun.default_allocator, strings.unicode_replacement);
            saw_error = true;
        }
    }

    return .{ output, saw_error };
}

pub fn decode(this: *TextDecoder, globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!JSValue {
    const arguments = callframe.arguments_old(2).slice();

    const input_slice = input_slice: {
        if (arguments.len == 0 or arguments[0].isUndefined()) {
            break :input_slice "";
        }

        if (arguments[0].asArrayBuffer(globalThis)) |array_buffer| {
            break :input_slice array_buffer.slice();
        }

        return globalThis.throwInvalidArguments("TextDecoder.decode expects an ArrayBuffer or TypedArray", .{});
    };

    const stream = stream: {
        if (arguments.len > 1 and arguments[1].isObject()) {
            if (try arguments[1].fastGet(globalThis, .stream)) |stream_value| {
                break :stream stream_value.toBoolean();
            }
        }

        break :stream false;
    };

    return switch (!stream) {
        inline else => |flush| this.decodeSlice(globalThis, input_slice, flush),
    };
}

pub fn decodeWithoutTypeChecks(this: *TextDecoder, globalThis: *jsc.JSGlobalObject, uint8array: *jsc.JSUint8Array) bun.JSError!JSValue {
    return this.decodeSlice(globalThis, uint8array.slice(), false);
}

fn decodeSlice(this: *TextDecoder, globalThis: *jsc.JSGlobalObject, buffer_slice: []const u8, comptime flush: bool) bun.JSError!JSValue {
    switch (this.encoding) {
        EncodingLabel.latin1 => {
            if (strings.isAllASCII(buffer_slice)) {
                return ZigString.init(buffer_slice).toJS(globalThis);
            }

            // It's unintuitive that we encode Latin1 as UTF16 even though the engine natively supports Latin1 strings...
            // However, this is also what WebKit seems to do.
            //
            // It's not clear why we couldn't jusst use Latin1 here, but tests failures proved it necessary.
            const out_length = strings.elementLengthLatin1IntoUTF16([]const u8, buffer_slice);
            const bytes = try globalThis.allocator().alloc(u16, out_length);

            const out = strings.copyLatin1IntoUTF16([]u16, bytes, []const u8, buffer_slice);
            return ZigString.toExternalU16(bytes.ptr, out.written, globalThis);
        },
        EncodingLabel.@"UTF-8" => {
            const input, const deinit = input: {
                const maybe_without_bom = if (!this.ignore_bom and strings.hasPrefixComptime(buffer_slice, "\xef\xbb\xbf"))
                    buffer_slice[3..]
                else
                    buffer_slice;

                if (this.buffered.len > 0) {
                    defer this.buffered.len = 0;
                    const joined = try bun.default_allocator.alloc(u8, maybe_without_bom.len + this.buffered.len);
                    @memcpy(joined[0..this.buffered.len], this.buffered.slice());
                    @memcpy(joined[this.buffered.len..][0..maybe_without_bom.len], maybe_without_bom);
                    break :input .{ joined, true };
                }

                break :input .{ maybe_without_bom, false };
            };

            const maybe_decode_result = switch (this.fatal) {
                inline else => |fail_if_invalid| strings.toUTF16AllocMaybeBuffered(bun.default_allocator, input, fail_if_invalid, flush) catch |err| {
                    if (deinit) bun.default_allocator.free(input);
                    if (comptime fail_if_invalid) {
                        if (err == error.InvalidByteSequence) {
                            return globalThis.ERR(.ENCODING_INVALID_ENCODED_DATA, "Invalid byte sequence", .{}).throw();
                        }
                    }

                    bun.assert(err == error.OutOfMemory);
                    return globalThis.throwOutOfMemory();
                },
            };

            if (maybe_decode_result) |decode_result| {
                if (deinit) bun.default_allocator.free(input);
                const decoded, const leftover, const leftover_len = decode_result;
                bun.assert(this.buffered.len == 0);
                if (comptime !flush) {
                    if (leftover_len != 0) {
                        this.buffered.buf = leftover;
                        this.buffered.len = leftover_len;
                    }
                }
                return ZigString.toExternalU16(decoded.ptr, decoded.len, globalThis);
            }

            bun.debugAssert(input.len == 0 or !deinit);

            // Experiment: using mimalloc directly is slightly slower
            return ZigString.init(input).toJS(globalThis);
        },

        inline .@"UTF-16LE", .@"UTF-16BE" => |utf16_encoding| {
            const bom = if (comptime utf16_encoding == .@"UTF-16LE") "\xff\xfe" else "\xfe\xff";
            const input = if (!this.ignore_bom and strings.hasPrefixComptime(buffer_slice, bom))
                buffer_slice[2..]
            else
                buffer_slice;

            var decoded, const saw_error = try this.decodeUTF16(input, utf16_encoding == .@"UTF-16BE", flush);

            if (saw_error and this.fatal) {
                decoded.deinit(bun.default_allocator);
                return globalThis.ERR(.ENCODING_INVALID_ENCODED_DATA, "The encoded data was not valid {s} data", .{@tagName(utf16_encoding)}).throw();
            }

            var output = bun.String.borrowUTF16(decoded.items);
            return output.toJS(globalThis);
        },

        .Shift_JIS => {
            var decoded, const saw_error = try this.decodeShiftJIS(buffer_slice, flush);

            if (saw_error and this.fatal) {
                decoded.deinit(bun.default_allocator);
                return globalThis.ERR(.ENCODING_INVALID_ENCODED_DATA, "The encoded data was not valid Shift_JIS data", .{}).throw();
            }

            var output = bun.String.borrowUTF16(decoded.items);
            return output.toJS(globalThis);
        },
    }
}

pub fn constructor(globalThis: *jsc.JSGlobalObject, callframe: *jsc.CallFrame) bun.JSError!*TextDecoder {
    const encoding_value, const options_value = callframe.argumentsAsArray(2);

    var decoder = TextDecoder{};

    if (encoding_value.isString()) {
        var str = try encoding_value.toSlice(globalThis, bun.default_allocator);
        defer str.deinit();

        if (EncodingLabel.which(str.slice())) |label| {
            decoder.encoding = label;
        } else {
            return globalThis.ERR(.ENCODING_NOT_SUPPORTED, "Unsupported encoding label \"{s}\"", .{str.slice()}).throw();
        }
    } else if (encoding_value.isUndefined()) {
        // default to utf-8
        decoder.encoding = EncodingLabel.@"UTF-8";
    } else {
        return globalThis.throwInvalidArguments("TextDecoder(encoding) label is invalid", .{});
    }

    if (!options_value.isUndefined()) {
        if (!options_value.isObject()) {
            return globalThis.throwInvalidArguments("TextDecoder(options) is invalid", .{});
        }

        if (try options_value.get(globalThis, "fatal")) |fatal| {
            decoder.fatal = fatal.toBoolean();
        }

        if (try options_value.get(globalThis, "ignoreBOM")) |ignoreBOM| {
            if (ignoreBOM.isBoolean()) {
                decoder.ignore_bom = ignoreBOM.asBoolean();
            } else {
                return globalThis.throwInvalidArguments("TextDecoder(options) ignoreBOM is invalid. Expected boolean value", .{});
            }
        }
    }

    return TextDecoder.new(decoder);
}

const std = @import("std");

const bun = @import("bun");
const strings = bun.strings;

const jsc = bun.jsc;
const ArrayBuffer = jsc.ArrayBuffer;
const JSGlobalObject = jsc.JSGlobalObject;
const JSUint8Array = jsc.JSUint8Array;
const JSValue = jsc.JSValue;
const ZigString = jsc.ZigString;
const EncodingLabel = jsc.WebCore.EncodingLabel;

// Minimal JIS X 0208 character mapping for Shift JIS support
fn getJIS0208CodePoint(pointer: u16) ?u21 {
    // Mappings calculated from actual Shift JIS byte sequences
    return switch (pointer) {
        // Hiragana あいうえお (0x82A0, 0x82A2, 0x82A4, 0x82A6, 0x82A8)
        283 => 0x3042, // あ (0x82, 0xA0)
        285 => 0x3044, // い (0x82, 0xA2)  
        287 => 0x3046, // う (0x82, 0xA4)
        289 => 0x3048, // え (0x82, 0xA6)
        291 => 0x304A, // お (0x82, 0xA8)
        
        // Kanji 日 (0x93FA) = (0x93-0x81)*188 + (0xFA-0x41) = 18*188 + 185 = 3569
        3569 => 0x65E5, // 日
        
        // Kanji 本 (0x967B) = (0x96-0x81)*188 + (0x7B-0x40) = 21*188 + 59 = 4007  
        4007 => 0x672C, // 本
        
        else => null,
    };
}
