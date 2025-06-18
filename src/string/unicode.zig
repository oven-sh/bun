pub fn NewCodePointIterator(comptime CodePointType_: type, comptime zeroValue: comptime_int) type {
    return struct {
        const Iterator = @This();
        bytes: []const u8,
        i: usize,
        next_width: usize = 0,
        width: u3_fast = 0,
        c: CodePointType = zeroValue,

        pub const CodePointType = CodePointType_;

        pub const ZeroValue = zeroValue;

        pub const Cursor = struct {
            i: u32 = 0,
            c: CodePointType = zeroValue,
            width: u3_fast = 0,
        };

        pub fn init(str: string) Iterator {
            return Iterator{ .bytes = str, .i = 0, .c = zeroValue };
        }

        pub fn initOffset(str: string, i: usize) Iterator {
            return Iterator{ .bytes = str, .i = i, .c = zeroValue };
        }

        const SkipResult = enum {
            eof,
            found,
            not_found,
        };

        /// Advance forward until the scalar function returns true.
        /// THe simd function is "best effort" and expected to sometimes return a result which `scalar` will return false for.
        /// This is because we don't decode UTF-8 in the SIMD code path.
        pub fn skip(it: *const Iterator, cursor: *Cursor, simd: *const fn (input: []const u8) ?usize, scalar: *const fn (CodePointType) bool) SkipResult {
            while (true) {
                // 1. Get current position. Check for EOF.
                const current_byte_index = cursor.i;
                if (current_byte_index >= it.bytes.len) {
                    return .not_found; // Reached end without finding
                }

                // 2. Decode the *next* character using the standard iterator method.
                if (!next(it, cursor)) {
                    return .not_found; // Reached end or error during decode
                }

                // 3. Check if the character just decoded matches the scalar condition.
                if (scalar(it.c)) {
                    return .found; // Found it!
                }

                // 4. Optimization: Can we skip ahead using SIMD?
                //    Scan starting from the byte *after* the character we just decoded.
                const next_scan_start_index = cursor.i;
                if (next_scan_start_index >= it.bytes.len) {
                    // Just decoded the last character and it didn't match.
                    return .not_found;
                }
                const remaining_slice = it.bytes[next_scan_start_index..];
                if (remaining_slice.len == 0) {
                    return .not_found;
                }

                // Ask SIMD for the next potential candidate.
                if (simd(remaining_slice)) |pos| {
                    // SIMD found a potential candidate `pos` bytes ahead.
                    if (pos > 0) {
                        // Jump the byte index to the start of the potential candidate.
                        cursor.i = next_scan_start_index + @as(u32, @intCast(pos));
                        // Reset width so next() decodes correctly from the jumped position.
                        cursor.width = 0;
                        // Loop will continue, starting the decode from the new cursor.i.
                        continue;
                    }
                    // If pos == 0, SIMD suggests the *immediate next* character.
                    // No jump needed, just let the loop iterate naturally.
                    // Fallthrough to the end of the loop.
                } else {
                    // SIMD found no potential candidates in the rest of the string.
                    // Since the SIMD search set is a superset of the scalar check set,
                    // we can guarantee that no character satisfying `scalar` exists further.
                    // Since the current character (decoded in step 2) also didn't match,
                    // we can conclude the target character is not found.
                    return .not_found;
                }

                // If we reach here, it means SIMD returned pos=0.
                // Loop continues to the next iteration, processing the immediate next char.
            } // End while true

            unreachable;
        }

        pub inline fn next(noalias it: *const Iterator, noalias cursor: *Cursor) bool {
            const pos: u32 = @as(u32, cursor.width) + cursor.i;
            if (pos >= it.bytes.len) {
                return false;
            }

            const cp_len = wtf8ByteSequenceLength(it.bytes[pos]);
            const error_char = comptime std.math.minInt(CodePointType);

            const codepoint = @as(
                CodePointType,
                switch (cp_len) {
                    0 => return false,
                    1 => it.bytes[pos],
                    else => decodeWTF8RuneTMultibyte(it.bytes[pos..].ptr[0..4], cp_len, CodePointType, error_char),
                },
            );

            cursor.* = Cursor{
                .i = pos,
                .c = if (error_char != codepoint)
                    codepoint
                else
                    unicode_replacement,
                .width = if (codepoint != error_char) cp_len else 1,
            };

            return true;
        }

        fn nextCodepointSlice(it: *Iterator) callconv(bun.callconv_inline) []const u8 {
            const bytes = it.bytes;
            const prev = it.i;
            const next_ = prev + it.next_width;
            if (bytes.len <= next_) return "";

            const cp_len = utf8ByteSequenceLength(bytes[next_]);
            it.next_width = cp_len;
            it.i = @min(next_, bytes.len);

            const slice = bytes[prev..][0..cp_len];
            it.width = @as(u3_fast, @intCast(slice.len));
            return slice;
        }

        pub fn needsUTF8Decoding(slice: string) bool {
            var it = Iterator{ .bytes = slice, .i = 0 };

            while (true) {
                const part = it.nextCodepointSlice();
                @setRuntimeSafety(false);
                switch (part.len) {
                    0 => return false,
                    1 => continue,
                    else => return true,
                }
            }
        }

        pub fn scanUntilQuotedValueOrEOF(iter: *Iterator, comptime quote: CodePointType) usize {
            while (iter.c > -1) {
                if (!switch (iter.nextCodepoint()) {
                    quote => false,
                    '\\' => brk: {
                        if (iter.nextCodepoint() == quote) {
                            continue;
                        }
                        break :brk true;
                    },
                    else => true,
                }) {
                    return iter.i + 1;
                }
            }

            return iter.i;
        }

        pub fn nextCodepoint(it: *Iterator) CodePointType {
            const slice = it.nextCodepointSlice();

            it.c = switch (slice.len) {
                0 => zeroValue,
                1 => @as(CodePointType, @intCast(slice[0])),
                2 => @as(CodePointType, @intCast(std.unicode.utf8Decode2(slice) catch unreachable)),
                3 => @as(CodePointType, @intCast(std.unicode.utf8Decode3(slice) catch unreachable)),
                4 => @as(CodePointType, @intCast(std.unicode.utf8Decode4(slice) catch unreachable)),
                else => unreachable,
            };

            return it.c;
        }

        /// Look ahead at the next n codepoints without advancing the iterator.
        /// If fewer than n codepoints are available, then return the remainder of the string.
        pub fn peek(it: *Iterator, n: usize) []const u8 {
            const original_i = it.i;
            defer it.i = original_i;

            var end_ix = original_i;
            for (0..n) |_| {
                const next_codepoint = it.nextCodepointSlice() orelse return it.bytes[original_i..];
                end_ix += next_codepoint.len;
            }

            return it.bytes[original_i..end_ix];
        }
    };
}

pub const CodepointIterator = NewCodePointIterator(CodePoint, -1);
pub const UnsignedCodepointIterator = NewCodePointIterator(u32, 0);

pub fn containsNonBmpCodePoint(text: string) bool {
    var iter = CodepointIterator.init(text);
    var curs = CodepointIterator.Cursor{};

    while (iter.next(&curs)) {
        if (curs.c > 0xFFFF) {
            return true;
        }
    }

    return false;
}

pub fn containsNonBmpCodePointOrIsInvalidIdentifier(text: string) bool {
    var iter = CodepointIterator.init(text);
    var curs = CodepointIterator.Cursor{};

    if (!iter.next(&curs)) return true;

    if (curs.c > 0xFFFF or !js_lexer.isIdentifierStart(curs.c))
        return true;

    while (iter.next(&curs)) {
        if (curs.c > 0xFFFF or !js_lexer.isIdentifierContinue(curs.c)) {
            return true;
        }
    }

    return false;
}

/// Convert potentially ill-formed UTF-8 or UTF-16 bytes to a Unicode Codepoint.
/// - Invalid codepoints are replaced with `zero` parameter
/// - Null bytes return 0
pub fn decodeWTF8RuneT(p: *const [4]u8, len: u3_fast, comptime T: type, comptime zero: T) T {
    if (len == 0) return zero;
    if (len == 1) return p[0];

    return decodeWTF8RuneTMultibyte(p, len, T, zero);
}

pub fn codepointSize(comptime R: type, r: R) u3_fast {
    return switch (r) {
        0b0000_0000...0b0111_1111 => 1,
        0b1100_0000...0b1101_1111 => 2,
        0b1110_0000...0b1110_1111 => 3,
        0b1111_0000...0b1111_0111 => 4,
        else => 0,
    };
}

pub fn convertUTF16ToUTF8(list_: std.ArrayList(u8), comptime Type: type, utf16: Type) OOM!std.ArrayList(u8) {
    var list = list_;
    const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(
        utf16,
        list.items.ptr[0..list.capacity],
    );
    if (result.status == .surrogate) {
        // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
        return toUTF8ListWithTypeBun(&list, Type, utf16, false);
    }

    list.items.len = result.count;
    return list;
}

pub fn convertUTF16ToUTF8WithoutInvalidSurrogatePairs(list_: std.ArrayList(u8), comptime Type: type, utf16: Type) !std.ArrayList(u8) {
    var list = list_;
    const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(
        utf16,
        list.items.ptr[0..list.capacity],
    );
    if (result.status == .surrogate) {
        return error.SurrogatePair;
    }

    list.items.len = result.count;
    return list;
}

pub fn convertUTF16ToUTF8Append(list: *std.ArrayList(u8), utf16: []const u16) !void {
    const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(
        utf16,
        list.items.ptr[list.items.len..list.capacity],
    );

    if (result.status == .surrogate) {
        // Slow path: there was invalid UTF-16, so we need to convert it without simdutf.
        _ = try toUTF8ListWithTypeBun(list, []const u16, utf16, false);
        return;
    }

    list.items.len += result.count;
}

pub fn toUTF8AllocWithTypeWithoutInvalidSurrogatePairs(allocator: std.mem.Allocator, comptime Type: type, utf16: Type) ![]u8 {
    if (bun.FeatureFlags.use_simdutf and comptime Type == []const u16) {
        const length = bun.simdutf.length.utf8.from.utf16.le(utf16);
        // add 16 bytes of padding for SIMDUTF
        var list = try std.ArrayList(u8).initCapacity(allocator, length + 16);
        list = try convertUTF16ToUTF8(list, Type, utf16);
        return list.items;
    }

    var list = try std.ArrayList(u8).initCapacity(allocator, utf16.len);
    list = try toUTF8ListWithType(list, Type, utf16);
    return list.items;
}

pub fn toUTF8AllocWithType(allocator: std.mem.Allocator, comptime Type: type, utf16: Type) OOM![]u8 {
    if (bun.FeatureFlags.use_simdutf and comptime Type == []const u16) {
        const length = bun.simdutf.length.utf8.from.utf16.le(utf16);
        // add 16 bytes of padding for SIMDUTF
        var list = try std.ArrayList(u8).initCapacity(allocator, length + 16);
        list = try convertUTF16ToUTF8(list, Type, utf16);
        return list.items;
    }

    var list = try std.ArrayList(u8).initCapacity(allocator, utf16.len);
    list = try toUTF8ListWithType(list, Type, utf16);
    return list.items;
}

pub fn toUTF8ListWithType(list_: std.ArrayList(u8), comptime Type: type, utf16: Type) OOM!std.ArrayList(u8) {
    if (bun.FeatureFlags.use_simdutf and comptime Type == []const u16) {
        var list = list_;
        const length = bun.simdutf.length.utf8.from.utf16.le(utf16);
        try list.ensureTotalCapacityPrecise(length + 16);
        const buf = try convertUTF16ToUTF8(list, Type, utf16);

        // Commenting out because `convertUTF16ToUTF8` may convert to WTF-8
        // which uses 3 bytes for invalid surrogates, causing the length to not
        // match from simdutf.
        // if (Environment.allow_assert) {
        //     bun.unsafeAssert(buf.items.len == length);
        // }

        return buf;
    }

    @compileError("not implemented");
}

pub fn toUTF8AppendToList(list: *std.ArrayList(u8), utf16: []const u16) !void {
    if (!bun.FeatureFlags.use_simdutf) {
        @compileError("not implemented");
    }
    const length = bun.simdutf.length.utf8.from.utf16.le(utf16);
    try list.ensureUnusedCapacity(length + 16);
    try convertUTF16ToUTF8Append(list, utf16);
}

pub fn toUTF8FromLatin1(allocator: std.mem.Allocator, latin1: []const u8) !?std.ArrayList(u8) {
    if (isAllASCII(latin1))
        return null;

    const list = try std.ArrayList(u8).initCapacity(allocator, latin1.len);
    return try allocateLatin1IntoUTF8WithList(list, 0, []const u8, latin1);
}

pub fn toUTF8FromLatin1Z(allocator: std.mem.Allocator, latin1: []const u8) !?std.ArrayList(u8) {
    if (isAllASCII(latin1))
        return null;

    const list = try std.ArrayList(u8).initCapacity(allocator, latin1.len + 1);
    var list1 = try allocateLatin1IntoUTF8WithList(list, 0, []const u8, latin1);
    try list1.append(0);
    return list1;
}

pub fn toUTF8ListWithTypeBun(list: *std.ArrayList(u8), comptime Type: type, utf16: Type, comptime skip_trailing_replacement: bool) OOM!(if (skip_trailing_replacement) ?u16 else std.ArrayList(u8)) {
    var utf16_remaining = utf16;

    while (firstNonASCII16(Type, utf16_remaining)) |i| {
        const to_copy = utf16_remaining[0..i];
        utf16_remaining = utf16_remaining[i..];
        const token = utf16_remaining[0];

        const replacement = utf16CodepointWithFFFDAndFirstInputChar(Type, token, utf16_remaining);
        utf16_remaining = utf16_remaining[replacement.len..];

        const count: usize = replacement.utf8Width();
        if (comptime Environment.isNative) {
            try list.ensureTotalCapacityPrecise(i + count + list.items.len + @as(usize, @intFromFloat((@as(f64, @floatFromInt(@as(u52, @truncate(utf16_remaining.len)))) * 1.2))));
        } else {
            try list.ensureTotalCapacityPrecise(i + count + list.items.len + utf16_remaining.len + 4);
        }
        list.items.len += i;

        copyU16IntoU8(list.items[list.items.len - i ..], to_copy);

        if (comptime skip_trailing_replacement) {
            if (replacement.is_lead and utf16_remaining.len == 0) {
                return token;
            }
        }

        list.items.len += count;
        _ = encodeWTF8RuneT(
            list.items.ptr[list.items.len - count .. list.items.len - count + 4][0..4],
            u32,
            @as(u32, replacement.code_point),
        );
    }

    if (utf16_remaining.len > 0) {
        try list.ensureTotalCapacityPrecise(utf16_remaining.len + list.items.len);
        const old_len = list.items.len;
        list.items.len += utf16_remaining.len;
        copyU16IntoU8(list.items[old_len..], utf16_remaining);
    }

    log("UTF16 {d} -> {d} UTF8", .{ utf16.len, list.items.len });

    if (comptime skip_trailing_replacement) {
        return null;
    }
    return list.*;
}

pub const EncodeIntoResult = struct {
    read: u32 = 0,
    written: u32 = 0,
};
pub fn allocateLatin1IntoUTF8(allocator: std.mem.Allocator, comptime Type: type, latin1_: Type) ![]u8 {
    if (comptime bun.FeatureFlags.latin1_is_now_ascii) {
        var out = try allocator.alloc(u8, latin1_.len);
        @memcpy(out[0..latin1_.len], latin1_);
        return out;
    }

    const list = try std.ArrayList(u8).initCapacity(allocator, latin1_.len);
    var foo = try allocateLatin1IntoUTF8WithList(list, 0, Type, latin1_);
    return try foo.toOwnedSlice();
}

pub fn allocateLatin1IntoUTF8WithList(list_: std.ArrayList(u8), offset_into_list: usize, comptime Type: type, latin1_: Type) OOM!std.ArrayList(u8) {
    var latin1 = latin1_;
    var i: usize = offset_into_list;
    var list = list_;
    try list.ensureUnusedCapacity(latin1.len);

    while (latin1.len > 0) {
        if (comptime Environment.allow_assert) assert(i < list.capacity);
        var buf = list.items.ptr[i..list.capacity];

        inner: {
            var count = latin1.len / ascii_vector_size;
            while (count > 0) : (count -= 1) {
                const vec: AsciiVector = latin1[0..ascii_vector_size].*;

                if (@reduce(.Max, vec) > 127) {
                    const Int = u64;
                    const size = @sizeOf(Int);

                    // zig or LLVM doesn't do @ctz nicely with SIMD
                    if (comptime ascii_vector_size >= 8) {
                        {
                            const bytes = @as(Int, @bitCast(latin1[0..size].*));
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            const mask = bytes & 0x8080808080808080;

                            if (mask > 0) {
                                const first_set_byte = @ctz(mask) / 8;
                                if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                                buf[0..size].* = @as([size]u8, @bitCast(bytes));
                                buf = buf[first_set_byte..];
                                latin1 = latin1[first_set_byte..];
                                break :inner;
                            }

                            buf[0..size].* = @as([size]u8, @bitCast(bytes));
                            latin1 = latin1[size..];
                            buf = buf[size..];
                        }

                        if (comptime ascii_vector_size >= 16) {
                            const bytes = @as(Int, @bitCast(latin1[0..size].*));
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            const mask = bytes & 0x8080808080808080;

                            if (mask > 0) {
                                const first_set_byte = @ctz(mask) / 8;
                                if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                                buf[0..size].* = @as([size]u8, @bitCast(bytes));
                                buf = buf[first_set_byte..];
                                latin1 = latin1[first_set_byte..];
                                break :inner;
                            }
                        }
                    }
                    unreachable;
                }

                buf[0..ascii_vector_size].* = @as([ascii_vector_size]u8, @bitCast(vec))[0..ascii_vector_size].*;
                latin1 = latin1[ascii_vector_size..];
                buf = buf[ascii_vector_size..];
            }

            while (latin1.len >= 8) {
                const Int = u64;
                const size = @sizeOf(Int);

                const bytes = @as(Int, @bitCast(latin1[0..size].*));
                // https://dotat.at/@/2022-06-27-tolower-swar.html
                const mask = bytes & 0x8080808080808080;

                if (mask > 0) {
                    const first_set_byte = @ctz(mask) / 8;
                    if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                    buf[0..size].* = @as([size]u8, @bitCast(bytes));
                    latin1 = latin1[first_set_byte..];
                    buf = buf[first_set_byte..];
                    break :inner;
                }

                buf[0..size].* = @as([size]u8, @bitCast(bytes));
                latin1 = latin1[size..];
                buf = buf[size..];
            }

            {
                if (comptime Environment.allow_assert) assert(latin1.len < 8);
                const end = latin1.ptr + latin1.len;
                while (latin1.ptr != end and latin1[0] < 128) {
                    buf[0] = latin1[0];
                    buf = buf[1..];
                    latin1 = latin1[1..];
                }
            }
        }

        while (latin1.len > 0 and latin1[0] > 127) {
            i = @intFromPtr(buf.ptr) - @intFromPtr(list.items.ptr);
            list.items.len = i;
            try list.ensureUnusedCapacity(2 + latin1.len);
            buf = list.items.ptr[i..list.capacity];
            buf[0..2].* = latin1ToCodepointBytesAssumeNotASCII(latin1[0]);
            latin1 = latin1[1..];
            buf = buf[2..];
        }

        i = @intFromPtr(buf.ptr) - @intFromPtr(list.items.ptr);
        list.items.len = i;
    }

    log("Latin1 {d} -> UTF8 {d}", .{ latin1_.len, i });

    return list;
}

pub const UTF16Replacement = struct {
    code_point: u32 = unicode_replacement,
    len: u3_fast = 0,

    /// Explicit fail boolean to distinguish between a Unicode Replacement Codepoint
    /// that was already in there
    /// and a genuine error.
    fail: bool = false,

    can_buffer: bool = true,
    is_lead: bool = false,

    pub inline fn utf8Width(replacement: UTF16Replacement) u3_fast {
        return switch (replacement.code_point) {
            0...0x7F => 1,
            (0x7F + 1)...0x7FF => 2,
            (0x7FF + 1)...0xFFFF => 3,
            else => 4,
        };
    }
};

pub fn convertUTF8BytesIntoUTF16WithLength(sequence: *const [4]u8, len: u3_fast, remaining_len: usize) UTF16Replacement {
    if (comptime Environment.allow_assert) assert(sequence[0] > 127);
    switch (len) {
        2 => {
            if (comptime Environment.allow_assert) {
                bun.assert(sequence[0] >= 0xC0);
                bun.assert(sequence[0] <= 0xDF);
            }
            if (sequence[1] < 0x80 or sequence[1] > 0xBF) {
                return .{ .len = 1, .fail = true, .can_buffer = remaining_len < 2 };
            }
            return .{ .len = len, .code_point = ((@as(u32, sequence[0]) << 6) + @as(u32, sequence[1])) - 0x00003080 };
        },
        3 => {
            if (comptime Environment.allow_assert) {
                bun.assert(sequence[0] >= 0xE0);
                bun.assert(sequence[0] <= 0xEF);
            }
            switch (sequence[0]) {
                0xE0 => {
                    if (sequence[1] < 0xA0 or sequence[1] > 0xBF) {
                        return .{ .len = 1, .fail = true, .can_buffer = remaining_len < 2 };
                    }
                },
                0xED => {
                    if (sequence[1] < 0x80 or sequence[1] > 0x9F) {
                        return .{ .len = 1, .fail = true, .can_buffer = remaining_len < 2 };
                    }
                },
                else => {
                    if (sequence[1] < 0x80 or sequence[1] > 0xBF) {
                        return .{ .len = 1, .fail = true, .can_buffer = remaining_len < 2 };
                    }
                },
            }
            if (sequence[2] < 0x80 or sequence[2] > 0xBF) {
                return .{ .len = 2, .fail = true, .can_buffer = remaining_len < 3 };
            }
            return .{
                .len = len,
                .code_point = ((@as(u32, sequence[0]) << 12) + (@as(u32, sequence[1]) << 6) + @as(u32, sequence[2])) - 0x000E2080,
            };
        },
        4 => {
            switch (sequence[0]) {
                0xF0 => {
                    if (sequence[1] < 0x90 or sequence[1] > 0xBF) {
                        return .{ .len = 1, .fail = true, .can_buffer = remaining_len < 2 };
                    }
                },
                0xF4 => {
                    if (sequence[1] < 0x80 or sequence[1] > 0x8F) {
                        return .{ .len = 1, .fail = true, .can_buffer = remaining_len < 2 };
                    }
                },

                // invalid code point
                // this used to be an assertion
                0...(0xF0 - 1), 0xF4 + 1...std.math.maxInt(@TypeOf(sequence[0])) => {
                    return .{ .len = 1, .fail = true, .can_buffer = false };
                },

                else => {
                    if (sequence[1] < 0x80 or sequence[1] > 0xBF) {
                        return .{ .len = 1, .fail = true, .can_buffer = remaining_len < 2 };
                    }
                },
            }

            if (sequence[2] < 0x80 or sequence[2] > 0xBF) {
                return .{ .len = 2, .fail = true, .can_buffer = remaining_len < 3 };
            }
            if (sequence[3] < 0x80 or sequence[3] > 0xBF) {
                return .{ .len = 3, .fail = true, .can_buffer = remaining_len < 4 };
            }
            return .{
                .len = len,
                .code_point = ((@as(u32, sequence[0]) << 18) +
                    (@as(u32, sequence[1]) << 12) +
                    (@as(u32, sequence[2]) << 6) + @as(u32, sequence[3])) - 0x03C82080,
            };
        },
        // invalid unicode sequence
        // 1 or 0 are both invalid here
        else => return UTF16Replacement{ .len = 1, .fail = true },
    }
}

// This variation matches WebKit behavior.
// fn convertUTF8BytesIntoUTF16(sequence: *const [4]u8, remaining_len: usize) UTF16Replacement {
pub fn convertUTF8BytesIntoUTF16(bytes: []const u8) UTF16Replacement {
    const sequence: [4]u8 = switch (bytes.len) {
        0 => unreachable,
        1 => [_]u8{ bytes[0], 0, 0, 0 },
        2 => [_]u8{ bytes[0], bytes[1], 0, 0 },
        3 => [_]u8{ bytes[0], bytes[1], bytes[2], 0 },
        else => bytes[0..4].*,
    };
    if (comptime Environment.allow_assert) assert(sequence[0] > 127);
    const sequence_length = nonASCIISequenceLength(sequence[0]);
    return convertUTF8BytesIntoUTF16WithLength(&sequence, sequence_length, bytes.len);
}

pub fn copyLatin1IntoUTF8(buf_: []u8, comptime Type: type, latin1_: Type) EncodeIntoResult {
    return copyLatin1IntoUTF8StopOnNonASCII(buf_, Type, latin1_, false);
}

pub fn copyLatin1IntoUTF8StopOnNonASCII(buf_: []u8, comptime Type: type, latin1_: Type, comptime stop: bool) EncodeIntoResult {
    if (comptime bun.FeatureFlags.latin1_is_now_ascii) {
        const to_copy = @as(u32, @truncate(@min(buf_.len, latin1_.len)));
        @memcpy(buf_[0..to_copy], latin1_[0..to_copy]);

        return .{ .written = to_copy, .read = to_copy };
    }

    var buf = buf_;
    var latin1 = latin1_;

    log("latin1 encode {d} -> {d}", .{ buf.len, latin1.len });

    while (buf.len > 0 and latin1.len > 0) {
        inner: {
            var remaining_runs = @min(buf.len, latin1.len) / ascii_vector_size;
            while (remaining_runs > 0) : (remaining_runs -= 1) {
                const vec: AsciiVector = latin1[0..ascii_vector_size].*;

                if (@reduce(.Max, vec) > 127) {
                    if (comptime stop) return .{ .written = std.math.maxInt(u32), .read = std.math.maxInt(u32) };

                    // zig or LLVM doesn't do @ctz nicely with SIMD
                    if (comptime ascii_vector_size >= 8) {
                        const Int = u64;
                        const size = @sizeOf(Int);

                        {
                            const bytes = @as(Int, @bitCast(latin1[0..size].*));
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            const mask = bytes & 0x8080808080808080;

                            buf[0..size].* = @as([size]u8, @bitCast(bytes));

                            if (mask > 0) {
                                const first_set_byte = @ctz(mask) / 8;
                                if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                                buf = buf[first_set_byte..];
                                latin1 = latin1[first_set_byte..];
                                break :inner;
                            }

                            latin1 = latin1[size..];
                            buf = buf[size..];
                        }

                        if (comptime ascii_vector_size >= 16) {
                            const bytes = @as(Int, @bitCast(latin1[0..size].*));
                            // https://dotat.at/@/2022-06-27-tolower-swar.html
                            const mask = bytes & 0x8080808080808080;

                            buf[0..size].* = @as([size]u8, @bitCast(bytes));

                            if (comptime Environment.allow_assert) assert(mask > 0);
                            const first_set_byte = @ctz(mask) / 8;
                            if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                            buf = buf[first_set_byte..];
                            latin1 = latin1[first_set_byte..];
                            break :inner;
                        }
                    }
                    unreachable;
                }

                buf[0..ascii_vector_size].* = @as([ascii_vector_size]u8, @bitCast(vec))[0..ascii_vector_size].*;
                latin1 = latin1[ascii_vector_size..];
                buf = buf[ascii_vector_size..];
            }

            {
                const Int = u64;
                const size = @sizeOf(Int);
                while (@min(buf.len, latin1.len) >= size) {
                    const bytes = @as(Int, @bitCast(latin1[0..size].*));
                    buf[0..size].* = @as([size]u8, @bitCast(bytes));

                    // https://dotat.at/@/2022-06-27-tolower-swar.html

                    const mask = bytes & 0x8080808080808080;

                    if (mask > 0) {
                        const first_set_byte = @ctz(mask) / 8;
                        if (comptime stop) return .{ .written = std.math.maxInt(u32), .read = std.math.maxInt(u32) };
                        if (comptime Environment.allow_assert) assert(latin1[first_set_byte] >= 127);

                        buf = buf[first_set_byte..];
                        latin1 = latin1[first_set_byte..];

                        break :inner;
                    }

                    latin1 = latin1[size..];
                    buf = buf[size..];
                }
            }

            {
                const end = latin1.ptr + @min(buf.len, latin1.len);
                if (comptime Environment.allow_assert) assert(@intFromPtr(latin1.ptr + 8) > @intFromPtr(end));
                const start_ptr = @intFromPtr(buf.ptr);
                const start_ptr_latin1 = @intFromPtr(latin1.ptr);

                while (latin1.ptr != end and latin1.ptr[0] <= 127) {
                    buf.ptr[0] = latin1.ptr[0];
                    buf.ptr += 1;
                    latin1.ptr += 1;
                }

                buf.len -= @intFromPtr(buf.ptr) - start_ptr;
                latin1.len -= @intFromPtr(latin1.ptr) - start_ptr_latin1;
            }
        }

        if (latin1.len > 0) {
            if (buf.len >= 2) {
                if (comptime stop) return .{ .written = std.math.maxInt(u32), .read = std.math.maxInt(u32) };

                buf[0..2].* = latin1ToCodepointBytesAssumeNotASCII(latin1[0]);
                latin1 = latin1[1..];
                buf = buf[2..];
            } else {
                break;
            }
        }
    }

    return .{
        .written = @as(u32, @truncate(buf_.len - buf.len)),
        .read = @as(u32, @truncate(latin1_.len - latin1.len)),
    };
}

pub fn replaceLatin1WithUTF8(buf_: []u8) void {
    var latin1 = buf_;
    while (strings.firstNonASCII(latin1)) |i| {
        latin1[i..][0..2].* = latin1ToCodepointBytesAssumeNotASCII(latin1[i]);

        latin1 = latin1[i + 2 ..];
    }
}

pub fn elementLengthLatin1IntoUTF8(slice: []const u8) usize {
    return bun.simdutf.length.utf8.from.latin1(slice);
}

pub fn copyLatin1IntoUTF16(comptime Buffer: type, buf_: Buffer, comptime Type: type, latin1_: Type) EncodeIntoResult {
    var buf = buf_;
    var latin1 = latin1_;
    while (buf.len > 0 and latin1.len > 0) {
        const to_write = strings.firstNonASCII(latin1) orelse @as(u32, @truncate(@min(latin1.len, buf.len)));
        if (comptime std.meta.alignment(Buffer) != @alignOf(u16)) {
            strings.copyU8IntoU16WithAlignment(std.meta.alignment(Buffer), buf, latin1[0..to_write]);
        } else {
            strings.copyU8IntoU16(buf, latin1[0..to_write]);
        }

        latin1 = latin1[to_write..];
        buf = buf[to_write..];
        if (latin1.len > 0 and buf.len >= 1) {
            buf[0] = latin1ToCodepointBytesAssumeNotASCII16(latin1[0]);
            latin1 = latin1[1..];
            buf = buf[1..];
        }
    }

    return .{
        .read = @as(u32, @truncate(buf_.len - buf.len)),
        .written = @as(u32, @truncate(latin1_.len - latin1.len)),
    };
}

pub fn elementLengthLatin1IntoUTF16(comptime Type: type, latin1_: Type) usize {
    // latin1 is always at most 1 UTF-16 code unit long
    if (comptime std.meta.Child([]const u16) == Type) {
        return latin1_.len;
    }

    return bun.simdutf.length.utf16.from.latin1(latin1_);
}

pub fn eqlUtf16(comptime self: string, other: []const u16) bool {
    if (self.len != other.len) return false;

    if (self.len == 0) return true;

    return bun.C.memcmp(bun.cast([*]const u8, self.ptr), bun.cast([*]const u8, other.ptr), self.len * @sizeOf(u16)) == 0;
}

pub fn toUTF8Alloc(allocator: std.mem.Allocator, js: []const u16) OOM![]u8 {
    return try toUTF8AllocWithType(allocator, []const u16, js);
}

pub fn toUTF8AllocZ(allocator: std.mem.Allocator, js: []const u16) OOM![:0]u8 {
    var list = std.ArrayList(u8).init(allocator);
    try toUTF8AppendToList(&list, js);
    try list.append(0);
    return list.items[0 .. list.items.len - 1 :0];
}

pub fn appendUTF8MachineWordToUTF16MachineWord(output: *[@sizeOf(usize) / 2]u16, input: *const [@sizeOf(usize) / 2]u8) callconv(bun.callconv_inline) void {
    output[0 .. @sizeOf(usize) / 2].* = @as(
        [4]u16,
        @bitCast(@as(
            @Vector(4, u16),
            @as(@Vector(4, u8), @bitCast(input[0 .. @sizeOf(usize) / 2].*)),
        )),
    );
}

pub fn copyU8IntoU16(output_: []u16, input_: []const u8) callconv(bun.callconv_inline) void {
    const output = output_;
    const input = input_;
    if (comptime Environment.allow_assert) assert(input.len <= output.len);

    // https://zig.godbolt.org/z/9rTn1orcY

    var input_ptr = input.ptr;
    var output_ptr = output.ptr;

    const last_input_ptr = input_ptr + @min(input.len, output.len);

    while (last_input_ptr != input_ptr) {
        output_ptr[0] = input_ptr[0];
        output_ptr += 1;
        input_ptr += 1;
    }
}

pub fn copyU8IntoU16WithAlignment(comptime alignment: u21, output_: []align(alignment) u16, input_: []const u8) void {
    var output = output_;
    var input = input_;
    const word = @sizeOf(usize) / 2;
    if (comptime Environment.allow_assert) assert(input.len <= output.len);

    // un-aligned data access is slow
    // so we attempt to align the data
    while (!std.mem.isAligned(@intFromPtr(output.ptr), @alignOf(u16)) and input.len >= word) {
        output[0] = input[0];
        output = output[1..];
        input = input[1..];
    }

    if (std.mem.isAligned(@intFromPtr(output.ptr), @alignOf(u16)) and input.len > 0) {
        copyU8IntoU16(@as([*]u16, @alignCast(output.ptr))[0..output.len], input);
        return;
    }

    for (input, 0..) |c, i| {
        output[i] = c;
    }
}

// pub fn copy(output_: []u8, input_: []const u8) callconv(bun.callconv_inline) void {
//     var output = output_;
//     var input = input_;
//     if (comptime Environment.allow_assert) assert(input.len <= output.len);

//     if (input.len > @sizeOf(usize) * 4) {
//         comptime var i: usize = 0;
//         inline while (i < 4) : (i += 1) {
//             appendUTF8MachineWord(output[i * @sizeOf(usize) ..][0..@sizeOf(usize)], input[i * @sizeOf(usize) ..][0..@sizeOf(usize)]);
//         }
//         output = output[4 * @sizeOf(usize) ..];
//         input = input[4 * @sizeOf(usize) ..];
//     }

//     while (input.len >= @sizeOf(usize)) {
//         appendUTF8MachineWord(output[0..@sizeOf(usize)], input[0..@sizeOf(usize)]);
//         output = output[@sizeOf(usize)..];
//         input = input[@sizeOf(usize)..];
//     }

//     for (input) |c, i| {
//         output[i] = c;
//     }
// }

pub inline fn copyU16IntoU8(output: []u8, input: []align(1) const u16) void {
    if (comptime Environment.allow_assert) assert(input.len <= output.len);
    const count = @min(input.len, output.len);

    bun.highway.copyU16ToU8(input[0..count], output[0..count]);
}

pub fn copyLatin1IntoASCII(dest: []u8, src: []const u8) void {
    var remain = src;
    var to = dest;

    const non_ascii_offset = strings.firstNonASCII(remain) orelse @as(u32, @truncate(remain.len));
    if (non_ascii_offset > 0) {
        @memcpy(to[0..non_ascii_offset], remain[0..non_ascii_offset]);
        remain = remain[non_ascii_offset..];
        to = to[non_ascii_offset..];

        // ascii fast path
        if (remain.len == 0) {
            return;
        }
    }

    if (to.len >= 16 and bun.Environment.enableSIMD) {
        const vector_size = 16;
        // https://zig.godbolt.org/z/qezsY8T3W
        const remain_in_u64 = remain[0 .. remain.len - (remain.len % vector_size)];
        const to_in_u64 = to[0 .. to.len - (to.len % vector_size)];
        var remain_as_u64 = std.mem.bytesAsSlice(u64, remain_in_u64);
        var to_as_u64 = std.mem.bytesAsSlice(u64, to_in_u64);
        const end_vector_len = @min(remain_as_u64.len, to_as_u64.len);
        remain_as_u64 = remain_as_u64[0..end_vector_len];
        to_as_u64 = to_as_u64[0..end_vector_len];
        const end_ptr = remain_as_u64.ptr + remain_as_u64.len;
        // using the pointer instead of the length is super important for the codegen
        while (end_ptr != remain_as_u64.ptr) {
            const buf = remain_as_u64[0];
            // this gets auto-vectorized
            const mask = @as(u64, 0x7f7f7f7f7f7f7f7f);
            to_as_u64[0] = buf & mask;

            remain_as_u64 = remain_as_u64[1..];
            to_as_u64 = to_as_u64[1..];
        }
        remain = remain[remain_in_u64.len..];
        to = to[to_in_u64.len..];
    }

    for (to) |*to_byte| {
        to_byte.* = @as(u8, @as(u7, @truncate(remain[0])));
        remain = remain[1..];
    }
}

/// It is common on Windows to find files that are not encoded in UTF8. Most of these include
/// a 'byte-order mark' codepoint at the start of the file. The layout of this codepoint can
/// determine the encoding.
///
/// https://en.wikipedia.org/wiki/Byte_order_mark
pub const BOM = enum {
    utf8,
    utf16_le,
    utf16_be,
    utf32_le,
    utf32_be,

    pub const utf8_bytes = [_]u8{ 0xef, 0xbb, 0xbf };
    pub const utf16_le_bytes = [_]u8{ 0xff, 0xfe };
    pub const utf16_be_bytes = [_]u8{ 0xfe, 0xff };
    pub const utf32_le_bytes = [_]u8{ 0xff, 0xfe, 0x00, 0x00 };
    pub const utf32_be_bytes = [_]u8{ 0x00, 0x00, 0xfe, 0xff };

    pub fn detect(bytes: []const u8) ?BOM {
        if (bytes.len < 3) return null;
        if (eqlComptimeIgnoreLen(bytes, utf8_bytes)) return .utf8;
        if (eqlComptimeIgnoreLen(bytes, utf16_le_bytes)) {
            // if (bytes.len > 4 and eqlComptimeIgnoreLen(bytes[2..], utf32_le_bytes[2..]))
            //   return .utf32_le;
            return .utf16_le;
        }
        // if (eqlComptimeIgnoreLen(bytes, utf16_be_bytes)) return .utf16_be;
        // if (bytes.len > 4 and eqlComptimeIgnoreLen(bytes, utf32_le_bytes)) return .utf32_le;
        return null;
    }

    pub fn detectAndSplit(bytes: []const u8) struct { ?BOM, []const u8 } {
        const bom = detect(bytes);
        if (bom == null) return .{ null, bytes };
        return .{ bom, bytes[bom.?.length()..] };
    }

    pub fn getHeader(bom: BOM) []const u8 {
        return switch (bom) {
            inline else => |t| comptime &@field(BOM, @tagName(t) ++ "_bytes"),
        };
    }

    pub fn length(bom: BOM) usize {
        return switch (bom) {
            inline else => |t| comptime (&@field(BOM, @tagName(t) ++ "_bytes")).len,
        };
    }

    /// If an allocation is needed, free the input and the caller will
    /// replace it with the new return
    pub fn removeAndConvertToUTF8AndFree(bom: BOM, allocator: std.mem.Allocator, bytes: []u8) OOM![]u8 {
        switch (bom) {
            .utf8 => {
                _ = bun.c.memmove(bytes.ptr, bytes.ptr + utf8_bytes.len, bytes.len - utf8_bytes.len);
                return bytes[0 .. bytes.len - utf8_bytes.len];
            },
            .utf16_le => {
                const trimmed_bytes = bytes[utf16_le_bytes.len..];
                const trimmed_bytes_u16: []const u16 = @alignCast(std.mem.bytesAsSlice(u16, trimmed_bytes));
                const out = try toUTF8Alloc(allocator, trimmed_bytes_u16);
                allocator.free(bytes);
                return out;
            },
            else => {
                // TODO: this needs to re-encode, for now we just remove the BOM
                const bom_bytes = bom.getHeader();
                _ = bun.c.memmove(bytes.ptr, bytes.ptr + bom_bytes.len, bytes.len - bom_bytes.len);
                return bytes[0 .. bytes.len - bom_bytes.len];
            },
        }
    }

    /// This is required for fs.zig's `use_shared_buffer` flag. we cannot free that pointer.
    /// The returned slice will always point to the base of the input.
    ///
    /// Requires an arraylist in case it must be grown.
    pub fn removeAndConvertToUTF8WithoutDealloc(bom: BOM, allocator: std.mem.Allocator, list: *std.ArrayListUnmanaged(u8)) ![]u8 {
        const bytes = list.items;
        switch (bom) {
            .utf8 => {
                bun.C.memmove(bytes.ptr, bytes.ptr + utf8_bytes.len, bytes.len - utf8_bytes.len);
                return bytes[0 .. bytes.len - utf8_bytes.len];
            },
            .utf16_le => {
                const trimmed_bytes = bytes[utf16_le_bytes.len..];
                const trimmed_bytes_u16: []const u16 = @alignCast(std.mem.bytesAsSlice(u16, trimmed_bytes));
                const out = try toUTF8Alloc(allocator, trimmed_bytes_u16);
                if (list.capacity < out.len) {
                    try list.ensureTotalCapacity(allocator, out.len);
                }
                list.items.len = out.len;
                @memcpy(list.items, out);
                return out;
            },
            else => {
                // TODO: this needs to re-encode, for now we just remove the BOM
                const bom_bytes = bom.getHeader();
                bun.C.memmove(bytes.ptr, bytes.ptr + bom_bytes.len, bytes.len - bom_bytes.len);
                return bytes[0 .. bytes.len - bom_bytes.len];
            },
        }
    }
};

/// @deprecated. If you are using this, you likely will need to remove other BOMs and handle encoding.
/// Use the BOM struct's `detect` and conversion functions instead.
pub fn withoutUTF8BOM(bytes: []const u8) []const u8 {
    if (strings.hasPrefixComptime(bytes, BOM.utf8_bytes)) {
        return bytes[BOM.utf8_bytes.len..];
    } else {
        return bytes;
    }
}

// https://github.com/WebKit/WebKit/blob/443e796d1538654c34f2690e39600c70c8052b63/Source/WebCore/PAL/pal/text/TextCodecUTF8.cpp#L69
pub fn nonASCIISequenceLength(first_byte: u8) u3_fast {
    return switch (first_byte) {
        0...193 => 0,
        194...223 => 2,
        224...239 => 3,
        240...244 => 4,
        245...255 => 0,
    };
}

/// Convert a UTF-8 string to a UTF-16 string IF there are any non-ascii characters
/// If there are no non-ascii characters, this returns null
/// This is intended to be used for strings that go to JavaScript
pub fn toUTF16Alloc(allocator: std.mem.Allocator, bytes: []const u8, comptime fail_if_invalid: bool, comptime sentinel: bool) !if (sentinel) ?[:0]u16 else ?[]u16 {
    if (strings.firstNonASCII(bytes)) |i| {
        const output_: ?std.ArrayList(u16) = if (comptime bun.FeatureFlags.use_simdutf) simd: {
            const out_length = bun.simdutf.length.utf16.from.utf8(bytes);
            if (out_length == 0)
                break :simd null;

            var out = try allocator.alloc(u16, out_length + if (sentinel) 1 else 0);
            log("toUTF16 {d} UTF8 -> {d} UTF16", .{ bytes.len, out_length });

            const res = bun.simdutf.convert.utf8.to.utf16.with_errors.le(bytes, if (comptime sentinel) out[0..out_length] else out);
            if (res.status == .success) {
                if (comptime sentinel) {
                    out[out_length] = 0;
                    return out[0 .. out_length + 1 :0];
                }
                return out;
            }

            if (comptime fail_if_invalid) {
                allocator.free(out);
                return error.InvalidByteSequence;
            }

            break :simd .{
                .items = out[0..i],
                .capacity = out.len,
                .allocator = allocator,
            };
        } else null;
        var output = output_ orelse fallback: {
            var list = try std.ArrayList(u16).initCapacity(allocator, i + 2);
            list.items.len = i;
            strings.copyU8IntoU16(list.items, bytes[0..i]);
            break :fallback list;
        };
        errdefer output.deinit();

        var remaining = bytes[i..];

        {
            const replacement = strings.convertUTF8BytesIntoUTF16(remaining);
            if (comptime fail_if_invalid) {
                if (replacement.fail) {
                    if (comptime Environment.allow_assert) assert(replacement.code_point == unicode_replacement);
                    return error.InvalidByteSequence;
                }
            }
            remaining = remaining[@max(replacement.len, 1)..];

            //#define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
            switch (replacement.code_point) {
                0...0xffff => |c| {
                    try output.append(@as(u16, @intCast(c)));
                },
                else => |c| {
                    try output.appendSlice(&[_]u16{ strings.u16Lead(c), strings.u16Trail(c) });
                },
            }
        }

        while (strings.firstNonASCII(remaining)) |j| {
            const end = output.items.len;
            try output.ensureUnusedCapacity(j);
            output.items.len += j;
            strings.copyU8IntoU16(output.items[end..][0..j], remaining[0..j]);
            remaining = remaining[j..];

            const replacement = strings.convertUTF8BytesIntoUTF16(remaining);
            if (comptime fail_if_invalid) {
                if (replacement.fail) {
                    if (comptime Environment.allow_assert) assert(replacement.code_point == unicode_replacement);
                    return error.InvalidByteSequence;
                }
            }
            remaining = remaining[@max(replacement.len, 1)..];

            //#define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
            switch (replacement.code_point) {
                0...0xffff => |c| {
                    try output.append(@as(u16, @intCast(c)));
                },
                else => |c| {
                    try output.appendSlice(&[_]u16{ strings.u16Lead(c), strings.u16Trail(c) });
                },
            }
        }

        if (remaining.len > 0) {
            try output.ensureTotalCapacityPrecise(output.items.len + remaining.len + comptime if (sentinel) 1 else 0);

            output.items.len += remaining.len;
            strings.copyU8IntoU16(output.items[output.items.len - remaining.len ..], remaining);
        }

        if (comptime sentinel) {
            output.items[output.items.len] = 0;
            return output.items[0 .. output.items.len + 1 :0];
        }

        return output.items;
    }

    return null;
}

// this one does the thing it's named after
pub fn toUTF16AllocForReal(allocator: std.mem.Allocator, bytes: []const u8, comptime fail_if_invalid: bool, comptime sentinel: bool) !if (sentinel) [:0]u16 else []u16 {
    return (try toUTF16Alloc(allocator, bytes, fail_if_invalid, sentinel)) orelse {
        const output = try allocator.alloc(u16, bytes.len + if (sentinel) 1 else 0);
        bun.strings.copyU8IntoU16(if (sentinel) output[0..bytes.len] else output, bytes);

        if (comptime sentinel) {
            output[bytes.len] = 0;
            return output[0..bytes.len :0];
        }

        return output;
    };
}

pub fn toUTF16AllocMaybeBuffered(
    allocator: std.mem.Allocator,
    bytes: []const u8,
    comptime fail_if_invalid: bool,
    comptime flush: bool,
) error{ OutOfMemory, InvalidByteSequence }!?struct { []u16, [3]u8, u2 } {
    const first_non_ascii = strings.firstNonASCII(bytes) orelse return null;

    var output: std.ArrayListUnmanaged(u16) = if (comptime bun.FeatureFlags.use_simdutf) output: {
        const out_length = bun.simdutf.length.utf16.from.utf8(bytes);

        if (out_length == 0) {
            break :output .{};
        }

        var out = try allocator.alloc(u16, out_length);

        const res = bun.simdutf.convert.utf8.to.utf16.with_errors.le(bytes, out);
        if (res.status == .success) {
            log("toUTF16 {d} UTF8 -> {d} UTF16", .{ bytes.len, out_length });
            return .{ out, .{0} ** 3, 0 };
        }

        var list = std.ArrayListUnmanaged(u16).fromOwnedSlice(out[0..first_non_ascii]);
        list.capacity = out.len;

        break :output list;
    } else .{};
    errdefer output.deinit(allocator);

    const start = if (output.items.len > 0) first_non_ascii else 0;
    var remaining = bytes[start..];

    var non_ascii: ?u32 = 0;
    while (non_ascii) |i| : (non_ascii = strings.firstNonASCII(remaining)) {
        {
            const end = output.items.len;
            try output.ensureUnusedCapacity(allocator, i + 2); // +2 for UTF16 codepoint
            output.items.len += i;
            strings.copyU8IntoU16(output.items[end..][0..i], remaining[0..i]);
            remaining = remaining[i..];
        }

        const sequence: [4]u8 = switch (remaining.len) {
            0 => unreachable,
            1 => .{ remaining[0], 0, 0, 0 },
            2 => .{ remaining[0], remaining[1], 0, 0 },
            3 => .{ remaining[0], remaining[1], remaining[2], 0 },
            else => remaining[0..4].*,
        };

        const converted_length = strings.nonASCIISequenceLength(sequence[0]);

        const converted = strings.convertUTF8BytesIntoUTF16WithLength(&sequence, converted_length, remaining.len);

        if (comptime !flush) {
            if (converted.fail and converted.can_buffer and converted_length > remaining.len) {
                const buffered: [3]u8 = switch (remaining.len) {
                    else => unreachable,
                    1 => .{ remaining[0], 0, 0 },
                    2 => .{ remaining[0], remaining[1], 0 },
                    3 => .{ remaining[0], remaining[1], remaining[2] },
                };
                return .{ output.items, buffered, @intCast(remaining.len) };
            }
        }

        if (comptime fail_if_invalid) {
            if (converted.fail) {
                if (comptime Environment.allow_assert) {
                    bun.assert(converted.code_point == unicode_replacement);
                }
                return error.InvalidByteSequence;
            }
        }

        remaining = remaining[@max(converted.len, 1)..];

        // #define U16_LENGTH(c) ((uint32_t)(c)<=0xffff ? 1 : 2)
        switch (converted.code_point) {
            0...0xffff => |c| output.appendAssumeCapacity(@intCast(c)),
            else => |c| output.appendSliceAssumeCapacity(&.{ strings.u16Lead(c), strings.u16Trail(c) }),
        }
    }

    if (remaining.len > 0) {
        try output.ensureTotalCapacityPrecise(allocator, output.items.len + remaining.len);
        output.items.len += remaining.len;
        strings.copyU8IntoU16(output.items[output.items.len - remaining.len ..], remaining);
    }

    log("toUTF16 {d} UTF8 -> {d} UTF16", .{ bytes.len, output.items.len });
    return .{ output.items, .{0} ** 3, 0 };
}

pub fn utf16CodepointWithFFFD(comptime Type: type, input: Type) UTF16Replacement {
    return utf16CodepointWithFFFDAndFirstInputChar(Type, input[0], input);
}

fn utf16CodepointWithFFFDAndFirstInputChar(comptime Type: type, char: std.meta.Elem(Type), input: Type) UTF16Replacement {
    const c0 = @as(u21, char);

    if (c0 & ~@as(u21, 0x03ff) == 0xd800) {
        // surrogate pair
        if (input.len == 1)
            return .{
                .len = 1,
                .is_lead = true,
            };
        //error.DanglingSurrogateHalf;
        const c1 = @as(u21, input[1]);
        if (c1 & ~@as(u21, 0x03ff) != 0xdc00)
            if (input.len == 1) {
                return .{
                    .len = 1,
                };
            } else {
                return .{
                    .fail = true,
                    .len = 1,
                    .code_point = strings.unicode_replacement,
                    .is_lead = true,
                };
            };
        // return error.ExpectedSecondSurrogateHalf;

        return .{ .len = 2, .code_point = 0x10000 + (((c0 & 0x03ff) << 10) | (c1 & 0x03ff)) };
    } else if (c0 & ~@as(u21, 0x03ff) == 0xdc00) {
        // return error.UnexpectedSecondSurrogateHalf;
        return .{ .fail = true, .len = 1, .code_point = unicode_replacement };
    } else {
        return .{ .code_point = c0, .len = 1 };
    }
}

pub fn utf16Codepoint(comptime Type: type, input: Type) UTF16Replacement {
    const c0 = @as(u21, input[0]);

    if (c0 & ~@as(u21, 0x03ff) == 0xd800) {
        // surrogate pair
        if (input.len == 1)
            return .{
                .len = 1,
            };
        //error.DanglingSurrogateHalf;
        const c1 = @as(u21, input[1]);
        if (c1 & ~@as(u21, 0x03ff) != 0xdc00)
            if (input.len == 1)
                return .{
                    .len = 1,
                };
        // return error.ExpectedSecondSurrogateHalf;

        return .{ .len = 2, .code_point = 0x10000 + (((c0 & 0x03ff) << 10) | (c1 & 0x03ff)) };
    } else if (c0 & ~@as(u21, 0x03ff) == 0xdc00) {
        // return error.UnexpectedSecondSurrogateHalf;
        return .{ .len = 1 };
    } else {
        return .{ .code_point = c0, .len = 1 };
    }
}

// TODO: remove this
pub const w = toUTF16Literal;

pub fn toUTF16Literal(comptime str: []const u8) [:0]const u16 {
    return literal(u16, str);
}

pub fn literal(comptime T: type, comptime str: []const u8) *const [literalLength(T, str):0]T {
    const Holder = struct {
        pub const value = switch (T) {
            u8 => (str[0..str.len].* ++ .{0})[0..str.len :0],
            u16 => std.unicode.utf8ToUtf16LeStringLiteral(str),
            else => @compileError("unsupported type " ++ @typeName(T) ++ " in strings.literal() call."),
        };
    };

    return Holder.value;
}

fn literalLength(comptime T: type, comptime str: string) usize {
    return comptime switch (T) {
        u8 => str.len,
        u16 => std.unicode.calcUtf16LeLen(str) catch unreachable,
        else => 0, // let other errors report first
    };
}

// Copyright (c) 2008-2009 Bjoern Hoehrmann <bjoern@hoehrmann.de>
// See http://bjoern.hoehrmann.de/utf-8/decoder/dfa/ for details.
pub fn isValidUTF8WithoutSIMD(slice: []const u8) bool {
    var state: u8 = 0;

    for (slice) |byte| {
        state = decodeCheck(state, byte);
    }
    return state == UTF8_ACCEPT;
}

pub fn isValidUTF8(slice: []const u8) bool {
    if (bun.FeatureFlags.use_simdutf)
        return bun.simdutf.validate.utf8(slice);

    return isValidUTF8WithoutSIMD(slice);
}

pub fn isAllASCII(slice: []const u8) bool {
    if (@inComptime()) {
        for (slice) |char| {
            if (char > 127) {
                return false;
            }
        }
        return true;
    }

    return bun.simdutf.validate.ascii(slice);
}

const UTF8_ACCEPT: u8 = 0;
const UTF8_REJECT: u8 = 12;

const utf8d: [364]u8 = .{
    // The first part of the table maps bytes to character classes that
    // to reduce the size of the transition table and create bitmasks.
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,  0,
    1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  1,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,  9,
    7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,  7,
    8,  8,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,  2,
    10, 3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  3,  4,  3,  3,  11, 6,  6,  6,  5,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,  8,

    // The second part is a transition table that maps a combination
    // of a state of the automaton and a character class to a state.
    0,  12, 24, 36, 60, 96, 84, 12, 12, 12, 48, 72, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12, 0,  12, 12, 12, 12, 12, 0,
    12, 0,  12, 12, 12, 24, 12, 12, 12, 12, 12, 24, 12, 24, 12, 12, 12, 12, 12, 12, 12, 12, 12, 24, 12, 12, 12, 12, 12, 24, 12, 12,
    12, 12, 12, 12, 12, 24, 12, 12, 12, 12, 12, 12, 12, 12, 12, 36, 12, 36, 12, 12, 12, 36, 12, 12, 12, 12, 12, 36, 12, 36, 12, 12,
    12, 36, 12, 12, 12, 12, 12, 12, 12, 12, 12, 12,
};

pub fn decodeCheck(state: u8, byte: u8) u8 {
    const char_type: u32 = utf8d[byte];
    // we dont care about the codep
    // codep = if (*state != UTF8_ACCEPT) (byte & 0x3f) | (*codep << 6) else (0xff >> char_type) & (byte);

    const value = @as(u32, 256) + state + char_type;
    if (value >= utf8d.len) return UTF8_REJECT;
    return utf8d[value];
}

// #define U16_LEAD(supplementary) (UChar)(((supplementary)>>10)+0xd7c0)
pub fn u16Lead(supplementary: anytype) callconv(bun.callconv_inline) u16 {
    return @intCast((supplementary >> 10) + 0xd7c0);
}

// #define U16_TRAIL(supplementary) (UChar)(((supplementary)&0x3ff)|0xdc00)
pub fn u16Trail(supplementary: anytype) callconv(bun.callconv_inline) u16 {
    return @intCast((supplementary & 0x3ff) | 0xdc00);
}

// #define U16_IS_TRAIL(c) (((c)&0xfffffc00)==0xdc00)
pub fn u16IsTrail(supplementary: u16) callconv(bun.callconv_inline) bool {
    return (@as(u32, @intCast(supplementary)) & 0xfffffc00) == 0xdc00;
}

// #define U16_IS_LEAD(c) (((c)&0xfffffc00)==0xd800)
pub fn u16IsLead(supplementary: u16) callconv(bun.callconv_inline) bool {
    return (@as(u32, @intCast(supplementary)) & 0xfffffc00) == 0xd800;
}

// #define U16_GET_SUPPLEMENTARY(lead, trail) \
//     (((UChar32)(lead)<<10UL)+(UChar32)(trail)-U16_SURROGATE_OFFSET)
pub fn u16GetSupplementary(lead: u32, trail: u32) callconv(bun.callconv_inline) u32 {
    const shifted = lead << 10;
    return (shifted + trail) - u16_surrogate_offset;
}

// #define U16_SURROGATE_OFFSET ((0xd800<<10UL)+0xdc00-0x10000)
pub const u16_surrogate_offset = 56613888;

pub inline fn utf8ByteSequenceLength(first_byte: u8) u3_fast {
    return switch (first_byte) {
        0b0000_0000...0b0111_1111 => 1,
        0b1100_0000...0b1101_1111 => 2,
        0b1110_0000...0b1110_1111 => 3,
        0b1111_0000...0b1111_0111 => 4,
        else => 0,
    };
}

/// Same as `utf8ByteSequenceLength`, but assumes the byte is valid UTF-8.
///
/// You should only use this function if you know the string you are getting the byte from is valid UTF-8.
pub inline fn utf8ByteSequenceLengthUnsafe(first_byte: u8) u3_fast {
    return switch (first_byte) {
        0b0000_0000...0b0111_1111 => 1,
        0b1100_0000...0b1101_1111 => 2,
        0b1110_0000...0b1110_1111 => 3,
        0b1111_0000...0b1111_0111 => 4,
        else => unreachable,
    };
}

/// This will simply ignore invalid UTF-8 and just do it
pub fn convertUTF8toUTF16InBuffer(
    buf: []u16,
    input: []const u8,
) []u16 {
    // TODO(@paperclover): implement error handling here.
    // for now this will cause invalid utf-8 to be ignored and become empty.
    // this is lame because of https://github.com/oven-sh/bun/issues/8197
    // it will cause process.env.whatever to be len=0 instead of the data
    // but it's better than failing the run entirely
    //
    // the reason i didn't implement the fallback is purely because our
    // code in this file is too chaotic. it is left as a TODO
    if (input.len == 0) return buf[0..0];
    const result = bun.simdutf.convert.utf8.to.utf16.le(input, buf);
    return buf[0..result];
}

pub fn convertUTF8toUTF16InBufferZ(
    buf: []u16,
    input: []const u8,
) [:0]u16 {
    // TODO: see convertUTF8toUTF16InBuffer
    if (input.len == 0) {
        buf[0] = 0;
        return buf[0..0 :0];
    }
    const result = bun.simdutf.convert.utf8.to.utf16.le(input, buf);
    buf[result] = 0;
    return buf[0..result :0];
}

pub fn convertUTF16toUTF8InBuffer(
    buf: []u8,
    input: []const u16,
) ![]const u8 {
    // See above
    if (input.len == 0) return &[_]u8{};
    const result = bun.simdutf.convert.utf16.to.utf8.le(input, buf);
    // switch (result.status) {
    //     .success => return buf[0..result.count],
    //     // TODO(@paperclover): handle surrogate
    //     .surrogate => @panic("TODO: handle surrogate in convertUTF8toUTF16"),
    //     else => @panic("TODO: handle error in convertUTF16toUTF8InBuffer"),
    // }
    return buf[0..result];
}

pub fn latin1ToCodepointAssumeNotASCII(char: u8, comptime CodePointType: type) CodePointType {
    return @as(
        CodePointType,
        @intCast(latin1ToCodepointBytesAssumeNotASCII16(char)),
    );
}

const latin1_to_utf16_conversion_table = [256]u16{
    0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0006, 0x0007, // 00-07
    0x0008, 0x0009, 0x000A, 0x000B, 0x000C, 0x000D, 0x000E, 0x000F, // 08-0F
    0x0010, 0x0011, 0x0012, 0x0013, 0x0014, 0x0015, 0x0016, 0x0017, // 10-17
    0x0018, 0x0019, 0x001A, 0x001B, 0x001C, 0x001D, 0x001E, 0x001F, // 18-1F
    0x0020, 0x0021, 0x0022, 0x0023, 0x0024, 0x0025, 0x0026, 0x0027, // 20-27
    0x0028, 0x0029, 0x002A, 0x002B, 0x002C, 0x002D, 0x002E, 0x002F, // 28-2F
    0x0030, 0x0031, 0x0032, 0x0033, 0x0034, 0x0035, 0x0036, 0x0037, // 30-37
    0x0038, 0x0039, 0x003A, 0x003B, 0x003C, 0x003D, 0x003E, 0x003F, // 38-3F
    0x0040, 0x0041, 0x0042, 0x0043, 0x0044, 0x0045, 0x0046, 0x0047, // 40-47
    0x0048, 0x0049, 0x004A, 0x004B, 0x004C, 0x004D, 0x004E, 0x004F, // 48-4F
    0x0050, 0x0051, 0x0052, 0x0053, 0x0054, 0x0055, 0x0056, 0x0057, // 50-57
    0x0058, 0x0059, 0x005A, 0x005B, 0x005C, 0x005D, 0x005E, 0x005F, // 58-5F
    0x0060, 0x0061, 0x0062, 0x0063, 0x0064, 0x0065, 0x0066, 0x0067, // 60-67
    0x0068, 0x0069, 0x006A, 0x006B, 0x006C, 0x006D, 0x006E, 0x006F, // 68-6F
    0x0070, 0x0071, 0x0072, 0x0073, 0x0074, 0x0075, 0x0076, 0x0077, // 70-77
    0x0078, 0x0079, 0x007A, 0x007B, 0x007C, 0x007D, 0x007E, 0x007F, // 78-7F
    0x20AC, 0x0081, 0x201A, 0x0192, 0x201E, 0x2026, 0x2020, 0x2021, // 80-87
    0x02C6, 0x2030, 0x0160, 0x2039, 0x0152, 0x008D, 0x017D, 0x008F, // 88-8F
    0x0090, 0x2018, 0x2019, 0x201C, 0x201D, 0x2022, 0x2013, 0x2014, // 90-97
    0x02DC, 0x2122, 0x0161, 0x203A, 0x0153, 0x009D, 0x017E, 0x0178, // 98-9F
    0x00A0, 0x00A1, 0x00A2, 0x00A3, 0x00A4, 0x00A5, 0x00A6, 0x00A7, // A0-A7
    0x00A8, 0x00A9, 0x00AA, 0x00AB, 0x00AC, 0x00AD, 0x00AE, 0x00AF, // A8-AF
    0x00B0, 0x00B1, 0x00B2, 0x00B3, 0x00B4, 0x00B5, 0x00B6, 0x00B7, // B0-B7
    0x00B8, 0x00B9, 0x00BA, 0x00BB, 0x00BC, 0x00BD, 0x00BE, 0x00BF, // B8-BF
    0x00C0, 0x00C1, 0x00C2, 0x00C3, 0x00C4, 0x00C5, 0x00C6, 0x00C7, // C0-C7
    0x00C8, 0x00C9, 0x00CA, 0x00CB, 0x00CC, 0x00CD, 0x00CE, 0x00CF, // C8-CF
    0x00D0, 0x00D1, 0x00D2, 0x00D3, 0x00D4, 0x00D5, 0x00D6, 0x00D7, // D0-D7
    0x00D8, 0x00D9, 0x00DA, 0x00DB, 0x00DC, 0x00DD, 0x00DE, 0x00DF, // D8-DF
    0x00E0, 0x00E1, 0x00E2, 0x00E3, 0x00E4, 0x00E5, 0x00E6, 0x00E7, // E0-E7
    0x00E8, 0x00E9, 0x00EA, 0x00EB, 0x00EC, 0x00ED, 0x00EE, 0x00EF, // E8-EF
    0x00F0, 0x00F1, 0x00F2, 0x00F3, 0x00F4, 0x00F5, 0x00F6, 0x00F7, // F0-F7
    0x00F8, 0x00F9, 0x00FA, 0x00FB, 0x00FC, 0x00FD, 0x00FE, 0x00FF, // F8-FF
};

pub fn latin1ToCodepointBytesAssumeNotASCII(char: u32) [2]u8 {
    var bytes = [4]u8{ 0, 0, 0, 0 };
    _ = encodeWTF8Rune(&bytes, @as(i32, @intCast(char)));
    return bytes[0..2].*;
}

pub fn latin1ToCodepointBytesAssumeNotASCII16(char: u32) u16 {
    return latin1_to_utf16_conversion_table[@as(u8, @truncate(char))];
}

pub fn copyUTF16IntoUTF8(buf: []u8, comptime Type: type, utf16: Type, comptime allow_partial_write: bool) EncodeIntoResult {
    if (comptime Type == []const u16) {
        if (bun.FeatureFlags.use_simdutf) {
            if (utf16.len == 0)
                return .{ .read = 0, .written = 0 };
            const trimmed = bun.simdutf.trim.utf16(utf16);
            if (trimmed.len == 0)
                return .{ .read = 0, .written = 0 };

            const out_len = if (buf.len <= (trimmed.len * 3 + 2))
                bun.simdutf.length.utf8.from.utf16.le(trimmed)
            else
                buf.len;

            return copyUTF16IntoUTF8WithBuffer(buf, Type, utf16, trimmed, out_len, allow_partial_write);
        }
    }

    return copyUTF16IntoUTF8WithBuffer(buf, Type, utf16, utf16, utf16.len, allow_partial_write);
}

pub fn copyUTF16IntoUTF8WithBuffer(buf: []u8, comptime Type: type, utf16: Type, trimmed: Type, out_len: usize, comptime allow_partial_write: bool) EncodeIntoResult {
    var remaining = buf;
    var utf16_remaining = utf16;
    var ended_on_non_ascii = false;

    brk: {
        if (comptime Type == []const u16) {
            if (bun.FeatureFlags.use_simdutf) {
                log("UTF16 {d} -> UTF8 {d}", .{ utf16.len, out_len });
                if (remaining.len >= out_len) {
                    const result = bun.simdutf.convert.utf16.to.utf8.with_errors.le(trimmed, remaining);
                    if (result.status == .surrogate) break :brk;

                    return EncodeIntoResult{
                        .read = @as(u32, @truncate(trimmed.len)),
                        .written = @as(u32, @truncate(result.count)),
                    };
                }
            }
        }
    }

    while (firstNonASCII16(Type, utf16_remaining)) |i| {
        const end = @min(i, remaining.len);
        if (end > 0) copyU16IntoU8(remaining, utf16_remaining[0..end]);
        remaining = remaining[end..];
        utf16_remaining = utf16_remaining[end..];

        if (@min(utf16_remaining.len, remaining.len) == 0)
            break;

        const replacement = utf16CodepointWithFFFD(Type, utf16_remaining);

        const width: usize = replacement.utf8Width();
        if (width > remaining.len) {
            ended_on_non_ascii = width > 1;
            if (comptime allow_partial_write) switch (width) {
                2 => {
                    if (remaining.len > 0) {
                        //only first will be written
                        remaining[0] = @as(u8, @truncate(0xC0 | (replacement.code_point >> 6)));
                        remaining = remaining[remaining.len..];
                    }
                },
                3 => {
                    //only first to second written
                    switch (remaining.len) {
                        1 => {
                            remaining[0] = @as(u8, @truncate(0xE0 | (replacement.code_point >> 12)));
                            remaining = remaining[remaining.len..];
                        },
                        2 => {
                            remaining[0] = @as(u8, @truncate(0xE0 | (replacement.code_point >> 12)));
                            remaining[1] = @as(u8, @truncate(0x80 | (replacement.code_point >> 6) & 0x3F));
                            remaining = remaining[remaining.len..];
                        },
                        else => {},
                    }
                },
                4 => {
                    //only 1 to 3 written
                    switch (remaining.len) {
                        1 => {
                            remaining[0] = @as(u8, @truncate(0xF0 | (replacement.code_point >> 18)));
                            remaining = remaining[remaining.len..];
                        },
                        2 => {
                            remaining[0] = @as(u8, @truncate(0xF0 | (replacement.code_point >> 18)));
                            remaining[1] = @as(u8, @truncate(0x80 | (replacement.code_point >> 12) & 0x3F));
                            remaining = remaining[remaining.len..];
                        },
                        3 => {
                            remaining[0] = @as(u8, @truncate(0xF0 | (replacement.code_point >> 18)));
                            remaining[1] = @as(u8, @truncate(0x80 | (replacement.code_point >> 12) & 0x3F));
                            remaining[2] = @as(u8, @truncate(0x80 | (replacement.code_point >> 6) & 0x3F));
                            remaining = remaining[remaining.len..];
                        },
                        else => {},
                    }
                },

                else => {},
            };
            break;
        }

        utf16_remaining = utf16_remaining[replacement.len..];
        _ = encodeWTF8RuneT(remaining.ptr[0..4], u32, @as(u32, replacement.code_point));
        remaining = remaining[width..];
    }

    if (remaining.len > 0 and !ended_on_non_ascii and utf16_remaining.len > 0) {
        const len = @min(remaining.len, utf16_remaining.len);
        copyU16IntoU8(remaining[0..len], utf16_remaining[0..len]);
        utf16_remaining = utf16_remaining[len..];
        remaining = remaining[len..];
    }

    return .{
        .read = @as(u32, @truncate(utf16.len - utf16_remaining.len)),
        .written = @as(u32, @truncate(buf.len - remaining.len)),
    };
}

pub fn elementLengthUTF16IntoUTF8(comptime Type: type, utf16: Type) usize {
    if (bun.FeatureFlags.use_simdutf) {
        return bun.simdutf.length.utf8.from.utf16.le(utf16);
    }

    var utf16_remaining = utf16;
    var count: usize = 0;

    while (firstNonASCII16(Type, utf16_remaining)) |i| {
        count += i;

        utf16_remaining = utf16_remaining[i..];

        const replacement = utf16Codepoint(Type, utf16_remaining);

        count += replacement.utf8Width();
        utf16_remaining = utf16_remaining[replacement.len..];
    }

    return count + utf16_remaining.len;
}

pub fn elementLengthUTF8IntoUTF16(comptime Type: type, utf8: Type) usize {
    var utf8_remaining = utf8;
    var count: usize = 0;

    if (bun.FeatureFlags.use_simdutf) {
        return bun.simdutf.length.utf16.from.utf8(utf8);
    }

    while (firstNonASCII(utf8_remaining)) |i| {
        count += i;

        utf8_remaining = utf8_remaining[i..];

        const replacement = utf16Codepoint(Type, utf8_remaining);

        count += replacement.len;
        utf8_remaining = utf8_remaining[@min(replacement.utf8Width(), utf8_remaining.len)..];
    }

    return count + utf8_remaining.len;
}

// Check utf16 string equals utf8 string without allocating extra memory
pub fn utf16EqlString(text: []const u16, str: string) bool {
    if (text.len > str.len) {
        // Strings can't be equal if UTF-16 encoding is longer than UTF-8 encoding
        return false;
    }

    var temp = [4]u8{ 0, 0, 0, 0 };
    const n = text.len;
    var j: usize = 0;
    var i: usize = 0;
    // TODO: is it safe to just make this u32 or u21?
    var r1: i32 = undefined;
    while (i < n) : (i += 1) {
        r1 = text[i];
        if (r1 >= 0xD800 and r1 <= 0xDBFF and i + 1 < n) {
            const r2: i32 = text[i + 1];
            if (r2 >= 0xDC00 and r2 <= 0xDFFF) {
                r1 = (r1 - 0xD800) << 10 | (r2 - 0xDC00) + 0x10000;
                i += 1;
            }
        }

        const width = encodeWTF8Rune(&temp, r1);
        if (j + width > str.len) {
            return false;
        }
        for (0..width) |k| {
            if (temp[k] != str[j]) {
                return false;
            }
            j += 1;
        }
    }

    return j == str.len;
}

pub fn encodeUTF8Comptime(comptime cp: u32) []const u8 {
    const HEADER_CONT_BYTE: u8 = 0b10000000;
    const HEADER_2BYTE: u8 = 0b11000000;
    const HEADER_3BYTE: u8 = 0b11100000;
    const HEADER_4BYTE: u8 = 0b11100000;

    return switch (cp) {
        0x0...0x7F => return &[_]u8{@intCast(cp)},
        0x80...0x7FF => {
            return &[_]u8{
                HEADER_2BYTE | @as(u8, cp >> 6),
                HEADER_CONT_BYTE | @as(u8, cp & 0b00111111),
            };
        },
        0x800...0xFFFF => {
            return &[_]u8{
                HEADER_3BYTE | @as(u8, cp >> 12),
                HEADER_CONT_BYTE | @as(u8, (cp >> 6) & 0b00111111),
                HEADER_CONT_BYTE | @as(u8, cp & 0b00111111),
            };
        },
        0x10000...0x10FFFF => {
            return &[_]u8{
                HEADER_4BYTE | @as(u8, cp >> 18),
                HEADER_CONT_BYTE | @as(u8, (cp >> 12) & 0b00111111),
                HEADER_CONT_BYTE | @as(u8, (cp >> 6) & 0b00111111),
                HEADER_CONT_BYTE | @as(u8, cp & 0b00111111),
            };
        },
        else => @compileError("Invalid UTF-8 codepoint!"),
    };
}

// This is a clone of golang's "utf8.EncodeRune" that has been modified to encode using
// WTF-8 instead. See https://simonsapin.github.io/wtf-8/ for more info.
pub fn encodeWTF8Rune(p: *[4]u8, r: i32) u3_fast {
    return @call(
        .always_inline,
        encodeWTF8RuneT,
        .{
            p,
            u32,
            @as(u32, @intCast(r)),
        },
    );
}

pub fn encodeWTF8RuneT(p: *[4]u8, comptime R: type, r: R) u3_fast {
    switch (r) {
        0...0x7F => {
            p[0] = @as(u8, @intCast(r));
            return 1;
        },
        (0x7F + 1)...0x7FF => {
            p[0] = @as(u8, @truncate(0xC0 | ((r >> 6))));
            p[1] = @as(u8, @truncate(0x80 | (r & 0x3F)));
            return 2;
        },
        (0x7FF + 1)...0xFFFF => {
            p[0] = @as(u8, @truncate(0xE0 | ((r >> 12))));
            p[1] = @as(u8, @truncate(0x80 | ((r >> 6) & 0x3F)));
            p[2] = @as(u8, @truncate(0x80 | (r & 0x3F)));
            return 3;
        },
        else => {
            p[0] = @as(u8, @truncate(0xF0 | ((r >> 18))));
            p[1] = @as(u8, @truncate(0x80 | ((r >> 12) & 0x3F)));
            p[2] = @as(u8, @truncate(0x80 | ((r >> 6) & 0x3F)));
            p[3] = @as(u8, @truncate(0x80 | (r & 0x3F)));
            return 4;
        },
    }
}

pub fn wtf8Sequence(code_point: u32) [4]u8 {
    return switch (code_point) {
        0...0x7f => .{
            @intCast(code_point),
            0,
            0,
            0,
        },
        (0x7f + 1)...0x7ff => .{
            @truncate(0xc0 | (code_point >> 6)),
            @truncate(0x80 | (code_point & 0x3f)),
            0,
            0,
        },
        (0x7ff + 1)...0xffff => .{
            @truncate(0xe0 | (code_point >> 12)),
            @truncate(0x80 | ((code_point >> 6) & 0x3f)),
            @truncate(0x80 | (code_point & 0x3f)),
            0,
        },
        else => .{
            @truncate(0xf0 | (code_point >> 18)),
            @truncate(0x80 | ((code_point >> 12) & 0x3f)),
            @truncate(0x80 | ((code_point >> 6) & 0x3f)),
            @truncate(0x80 | (code_point & 0x3f)),
        },
    };
}

pub inline fn wtf8ByteSequenceLength(first_byte: u8) u8 {
    return switch (first_byte) {
        0...0x80 - 1 => 1,
        else => if ((first_byte & 0xE0) == 0xC0)
            2
        else if ((first_byte & 0xF0) == 0xE0)
            3
        else if ((first_byte & 0xF8) == 0xF0)
            4
        else
            1,
    };
}

/// 0 == invalid
pub inline fn wtf8ByteSequenceLengthWithInvalid(first_byte: u8) u8 {
    return switch (first_byte) {
        0...0x80 - 1 => 1,
        else => if ((first_byte & 0xE0) == 0xC0)
            2
        else if ((first_byte & 0xF0) == 0xE0)
            3
        else if ((first_byte & 0xF8) == 0xF0)
            4
        else
            1,
    };
}

/// Convert potentially ill-formed UTF-8 or UTF-16 bytes to a Unicode Codepoint.
/// Invalid codepoints are replaced with `zero` parameter
/// This is a clone of esbuild's decodeWTF8Rune
/// which was a clone of golang's "utf8.DecodeRune" that was modified to decode using WTF-8 instead.
/// Asserts a multi-byte codepoint
pub inline fn decodeWTF8RuneTMultibyte(p: *const [4]u8, len: u3_fast, comptime T: type, comptime zero: T) T {
    if (comptime Environment.allow_assert) assert(len > 1);

    const s1 = p[1];
    if ((s1 & 0xC0) != 0x80) return zero;

    if (len == 2) {
        const cp = @as(T, p[0] & 0x1F) << 6 | @as(T, s1 & 0x3F);
        if (cp < 0x80) return zero;
        return cp;
    }

    const s2 = p[2];

    if ((s2 & 0xC0) != 0x80) return zero;

    if (len == 3) {
        const cp = (@as(T, p[0] & 0x0F) << 12) | (@as(T, s1 & 0x3F) << 6) | (@as(T, s2 & 0x3F));
        if (cp < 0x800) return zero;
        return cp;
    }

    const s3 = p[3];

    if ((s3 & 0xC0) != 0x80) return zero;

    {
        const cp = (@as(T, p[0] & 0x07) << 18) | (@as(T, s1 & 0x3F) << 12) | (@as(T, s2 & 0x3F) << 6) | (@as(T, s3 & 0x3F));
        if (cp < 0x10000 or cp > 0x10FFFF) return zero;
        return cp;
    }

    unreachable;
}

const eqlComptimeIgnoreLen = strings.eqlComptimeIgnoreLen;
const bun = @import("bun");
const std = @import("std");
const string = []const u8;
const strings = bun.strings;
const u3_fast = strings.u3_fast;
const CodePoint = bun.CodePoint;
const js_lexer = bun.js_lexer;
const OOM = bun.OOM;
const unicode_replacement = strings.unicode_replacement;
const Environment = bun.Environment;
const log = strings.log;
const firstNonASCII16 = strings.firstNonASCII16;
const firstNonASCII = strings.firstNonASCII;

const assert = bun.assert;
const ascii_vector_size = strings.ascii_vector_size;
const AsciiVector = strings.AsciiVector;
