pub fn escapeHTMLForLatin1Input(allocator: std.mem.Allocator, latin1: []const u8) !Escaped(u8) {
    const Scalar = struct {
        pub const lengths: [std.math.maxInt(u8) + 1]u4 = brk: {
            var values: [std.math.maxInt(u8) + 1]u4 = undefined;
            for (values, 0..) |_, i| {
                switch (i) {
                    '"' => {
                        values[i] = "&quot;".len;
                    },
                    '&' => {
                        values[i] = "&amp;".len;
                    },
                    '\'' => {
                        values[i] = "&#x27;".len;
                    },
                    '<' => {
                        values[i] = "&lt;".len;
                    },
                    '>' => {
                        values[i] = "&gt;".len;
                    },
                    else => {
                        values[i] = 1;
                    },
                }
            }

            break :brk values;
        };

        fn appendString(buf: [*]u8, comptime str: []const u8) callconv(bun.callconv_inline) usize {
            buf[0..str.len].* = str[0..str.len].*;
            return str.len;
        }

        pub fn append(buf: [*]u8, char: u8) callconv(bun.callconv_inline) usize {
            if (lengths[char] == 1) {
                buf[0] = char;
                return 1;
            }

            return switch (char) {
                '"' => appendString(buf, "&quot;"),
                '&' => appendString(buf, "&amp;"),
                '\'' => appendString(buf, "&#x27;"),
                '<' => appendString(buf, "&lt;"),
                '>' => appendString(buf, "&gt;"),
                else => unreachable,
            };
        }

        pub fn push(comptime len: anytype, chars_: *const [len]u8, allo: std.mem.Allocator) callconv(bun.callconv_inline) Escaped(u8) {
            const chars = chars_.*;
            var total: usize = 0;

            comptime var remain_to_comp = len;
            comptime var comp_i = 0;

            inline while (remain_to_comp > 0) : (remain_to_comp -= 1) {
                total += lengths[chars[comp_i]];
                comp_i += 1;
            }

            if (total == len) {
                return .{ .original = {} };
            }

            const output = allo.alloc(u8, total) catch unreachable;
            var head = output.ptr;
            inline for (comptime bun.range(0, len)) |i| {
                head += @This().append(head, chars[i]);
            }

            return Escaped(u8){ .allocated = output };
        }
    };
    @setEvalBranchQuota(5000);
    switch (latin1.len) {
        0 => return Escaped(u8){ .static = "" },
        1 => return switch (latin1[0]) {
            '"' => Escaped(u8){ .static = "&quot;" },
            '&' => Escaped(u8){ .static = "&amp;" },
            '\'' => Escaped(u8){ .static = "&#x27;" },
            '<' => Escaped(u8){ .static = "&lt;" },
            '>' => Escaped(u8){ .static = "&gt;" },
            else => Escaped(u8){ .original = {} },
        },
        2 => {
            const first: []const u8 = switch (latin1[0]) {
                '"' => "&quot;",
                '&' => "&amp;",
                '\'' => "&#x27;",
                '<' => "&lt;",
                '>' => "&gt;",
                else => latin1[0..1],
            };
            const second: []const u8 = switch (latin1[1]) {
                '"' => "&quot;",
                '&' => "&amp;",
                '\'' => "&#x27;",
                '<' => "&lt;",
                '>' => "&gt;",
                else => latin1[1..2],
            };
            if (first.len == 1 and second.len == 1) {
                return Escaped(u8){ .original = {} };
            }

            return Escaped(u8){ .allocated = strings.append(allocator, first, second) catch unreachable };
        },

        // The simd implementation is slower for inputs less than 32 bytes.
        3 => return Scalar.push(3, latin1[0..3], allocator),
        4 => return Scalar.push(4, latin1[0..4], allocator),
        5 => return Scalar.push(5, latin1[0..5], allocator),
        6 => return Scalar.push(6, latin1[0..6], allocator),
        7 => return Scalar.push(7, latin1[0..7], allocator),
        8 => return Scalar.push(8, latin1[0..8], allocator),
        9 => return Scalar.push(9, latin1[0..9], allocator),
        10 => return Scalar.push(10, latin1[0..10], allocator),
        11 => return Scalar.push(11, latin1[0..11], allocator),
        12 => return Scalar.push(12, latin1[0..12], allocator),
        13 => return Scalar.push(13, latin1[0..13], allocator),
        14 => return Scalar.push(14, latin1[0..14], allocator),
        15 => return Scalar.push(15, latin1[0..15], allocator),
        16 => return Scalar.push(16, latin1[0..16], allocator),
        17 => return Scalar.push(17, latin1[0..17], allocator),
        18 => return Scalar.push(18, latin1[0..18], allocator),
        19 => return Scalar.push(19, latin1[0..19], allocator),
        20 => return Scalar.push(20, latin1[0..20], allocator),
        21 => return Scalar.push(21, latin1[0..21], allocator),
        22 => return Scalar.push(22, latin1[0..22], allocator),
        23 => return Scalar.push(23, latin1[0..23], allocator),
        24 => return Scalar.push(24, latin1[0..24], allocator),
        25 => return Scalar.push(25, latin1[0..25], allocator),
        26 => return Scalar.push(26, latin1[0..26], allocator),
        27 => return Scalar.push(27, latin1[0..27], allocator),
        28 => return Scalar.push(28, latin1[0..28], allocator),
        29 => return Scalar.push(29, latin1[0..29], allocator),
        30 => return Scalar.push(30, latin1[0..30], allocator),
        31 => return Scalar.push(31, latin1[0..31], allocator),
        32 => return Scalar.push(32, latin1[0..32], allocator),

        else => {
            var remaining = latin1;

            const vec_chars = "\"&'<>";
            const vecs: [vec_chars.len]AsciiVector = comptime brk: {
                var _vecs: [vec_chars.len]AsciiVector = undefined;
                for (vec_chars, 0..) |c, i| {
                    _vecs[i] = @splat(c);
                }
                break :brk _vecs;
            };

            var any_needs_escape = false;
            var buf: std.ArrayList(u8) = std.ArrayList(u8){
                .items = &.{},
                .capacity = 0,
                .allocator = allocator,
            };

            if (comptime Environment.enableSIMD) {
                // pass #1: scan for any characters that need escaping
                // assume most strings won't need any escaping, so don't actually allocate the buffer
                scan_and_allocate_lazily: while (remaining.len >= ascii_vector_size) {
                    if (comptime Environment.allow_assert) assert(!any_needs_escape);
                    const vec: AsciiVector = remaining[0..ascii_vector_size].*;
                    if (@reduce(.Max, @as(AsciiVectorU1, @bitCast((vec == vecs[0]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[1]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[2]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[3]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[4])))) == 1)
                    {
                        if (comptime Environment.allow_assert) assert(buf.capacity == 0);

                        buf = try std.ArrayList(u8).initCapacity(allocator, latin1.len + 6);
                        const copy_len = @intFromPtr(remaining.ptr) - @intFromPtr(latin1.ptr);
                        buf.appendSliceAssumeCapacity(latin1[0..copy_len]);
                        any_needs_escape = true;
                        inline for (0..ascii_vector_size) |i| {
                            switch (vec[i]) {
                                '"' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&quot;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&quot;".len][0.."&quot;".len].* = "&quot;".*;
                                    buf.items.len += "&quot;".len;
                                },
                                '&' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&amp;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&amp;".len][0.."&amp;".len].* = "&amp;".*;
                                    buf.items.len += "&amp;".len;
                                },
                                '\'' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&#x27;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&#x27;".len][0.."&#x27;".len].* = "&#x27;".*;
                                    buf.items.len += "&#x27;".len;
                                },
                                '<' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&lt;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&lt;".len][0.."&lt;".len].* = "&lt;".*;
                                    buf.items.len += "&lt;".len;
                                },
                                '>' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&gt;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&gt;".len][0.."&gt;".len].* = "&gt;".*;
                                    buf.items.len += "&gt;".len;
                                },
                                else => |c| {
                                    buf.appendAssumeCapacity(c);
                                },
                            }
                        }

                        remaining = remaining[ascii_vector_size..];
                        break :scan_and_allocate_lazily;
                    }

                    remaining = remaining[ascii_vector_size..];
                }
            }

            if (any_needs_escape) {
                // pass #2: we found something that needed an escape
                // so we'll go ahead and copy the buffer into a new buffer
                while (remaining.len >= ascii_vector_size) {
                    const vec: AsciiVector = remaining[0..ascii_vector_size].*;
                    if (@reduce(.Max, @as(AsciiVectorU1, @bitCast((vec == vecs[0]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[1]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[2]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[3]))) |
                        @as(AsciiVectorU1, @bitCast((vec == vecs[4])))) == 1)
                    {
                        buf.ensureUnusedCapacity(ascii_vector_size + 6) catch unreachable;
                        inline for (0..ascii_vector_size) |i| {
                            switch (vec[i]) {
                                '"' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&quot;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&quot;".len][0.."&quot;".len].* = "&quot;".*;
                                    buf.items.len += "&quot;".len;
                                },
                                '&' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&amp;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&amp;".len][0.."&amp;".len].* = "&amp;".*;
                                    buf.items.len += "&amp;".len;
                                },
                                '\'' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&#x27;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&#x27;".len][0.."&#x27;".len].* = "&#x27;".*;
                                    buf.items.len += "&#x27;".len;
                                },
                                '<' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&lt;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&lt;".len][0.."&lt;".len].* = "&lt;".*;
                                    buf.items.len += "&lt;".len;
                                },
                                '>' => {
                                    buf.ensureUnusedCapacity((ascii_vector_size - i) + "&gt;".len) catch unreachable;
                                    buf.items.ptr[buf.items.len .. buf.items.len + "&gt;".len][0.."&gt;".len].* = "&gt;".*;
                                    buf.items.len += "&gt;".len;
                                },
                                else => |c| {
                                    buf.appendAssumeCapacity(c);
                                },
                            }
                        }

                        remaining = remaining[ascii_vector_size..];
                        continue;
                    }

                    try buf.ensureUnusedCapacity(ascii_vector_size);
                    buf.items.ptr[buf.items.len .. buf.items.len + ascii_vector_size][0..ascii_vector_size].* = remaining[0..ascii_vector_size].*;
                    buf.items.len += ascii_vector_size;
                    remaining = remaining[ascii_vector_size..];
                }
            }

            var ptr = remaining.ptr;
            const end = remaining.ptr + remaining.len;

            if (!any_needs_escape) {
                scan_and_allocate_lazily: while (ptr != end) : (ptr += 1) {
                    switch (ptr[0]) {
                        '"', '&', '\'', '<', '>' => |c| {
                            if (comptime Environment.allow_assert) assert(buf.capacity == 0);

                            buf = try std.ArrayList(u8).initCapacity(allocator, latin1.len + @as(usize, Scalar.lengths[c]));
                            const copy_len = @intFromPtr(ptr) - @intFromPtr(latin1.ptr);
                            if (comptime Environment.allow_assert) assert(copy_len <= buf.capacity);
                            buf.items.len = copy_len;
                            @memcpy(buf.items[0..copy_len], latin1[0..copy_len]);
                            any_needs_escape = true;
                            break :scan_and_allocate_lazily;
                        },
                        else => {},
                    }
                }
            }

            while (ptr != end) : (ptr += 1) {
                switch (ptr[0]) {
                    '"' => {
                        buf.appendSlice("&quot;") catch unreachable;
                    },
                    '&' => {
                        buf.appendSlice("&amp;") catch unreachable;
                    },
                    '\'' => {
                        buf.appendSlice("&#x27;") catch unreachable; // modified from escape-html; used to be '&#39'
                    },
                    '<' => {
                        buf.appendSlice("&lt;") catch unreachable;
                    },
                    '>' => {
                        buf.appendSlice("&gt;") catch unreachable;
                    },
                    else => |c| {
                        buf.append(c) catch unreachable;
                    },
                }
            }

            if (!any_needs_escape) {
                if (comptime Environment.allow_assert) assert(buf.capacity == 0);
                return Escaped(u8){ .original = {} };
            }

            return Escaped(u8){ .allocated = try buf.toOwnedSlice() };
        },
    }
}

fn Escaped(comptime T: type) type {
    return union(enum) {
        static: []const u8,
        original: void,
        allocated: []T,
    };
}

pub fn escapeHTMLForUTF16Input(allocator: std.mem.Allocator, utf16: []const u16) !Escaped(u16) {
    const Scalar = struct {
        pub const lengths: [std.math.maxInt(u8) + 1]u4 = brk: {
            var values: [std.math.maxInt(u8) + 1]u4 = undefined;
            for (values, 0..) |_, i| {
                values[i] = switch (i) {
                    '"' => "&quot;".len,
                    '&' => "&amp;".len,
                    '\'' => "&#x27;".len,
                    '<' => "&lt;".len,
                    '>' => "&gt;".len,
                    else => 1,
                };
            }

            break :brk values;
        };
    };
    switch (utf16.len) {
        0 => return Escaped(u16){ .static = &[_]u8{} },
        1 => {
            switch (utf16[0]) {
                '"' => return Escaped(u16){ .static = "&quot;" },
                '&' => return Escaped(u16){ .static = "&amp;" },
                '\'' => return Escaped(u16){ .static = "&#x27;" },
                '<' => return Escaped(u16){ .static = "&lt;" },
                '>' => return Escaped(u16){ .static = "&gt;" },
                else => return Escaped(u16){ .original = {} },
            }
        },
        2 => {
            const first_16 = switch (utf16[0]) {
                '"' => toUTF16Literal("&quot;"),
                '&' => toUTF16Literal("&amp;"),
                '\'' => toUTF16Literal("&#x27;"),
                '<' => toUTF16Literal("&lt;"),
                '>' => toUTF16Literal("&gt;"),
                else => @as([]const u16, utf16[0..1]),
            };

            const second_16 = switch (utf16[1]) {
                '"' => toUTF16Literal("&quot;"),
                '&' => toUTF16Literal("&amp;"),
                '\'' => toUTF16Literal("&#x27;"),
                '<' => toUTF16Literal("&lt;"),
                '>' => toUTF16Literal("&gt;"),
                else => @as([]const u16, utf16[1..2]),
            };

            if (first_16.ptr == utf16.ptr and second_16.ptr == utf16.ptr + 1) {
                return Escaped(u16){ .original = {} };
            }

            var buf = allocator.alloc(u16, first_16.len + second_16.len) catch unreachable;
            bun.copy(u16, buf, first_16);
            bun.copy(u16, buf[first_16.len..], second_16);
            return Escaped(u16){ .allocated = buf };
        },

        else => {
            var remaining = utf16;

            var any_needs_escape = false;
            var buf: std.ArrayList(u16) = undefined;

            if (comptime Environment.enableSIMD) {
                const vec_chars = "\"&'<>";
                const vecs: [vec_chars.len]AsciiU16Vector = brk: {
                    var _vecs: [vec_chars.len]AsciiU16Vector = undefined;
                    for (vec_chars, 0..) |c, i| {
                        _vecs[i] = @splat(@as(u16, c));
                    }
                    break :brk _vecs;
                };
                // pass #1: scan for any characters that need escaping
                // assume most strings won't need any escaping, so don't actually allocate the buffer
                scan_and_allocate_lazily: while (remaining.len >= ascii_u16_vector_size) {
                    if (comptime Environment.allow_assert) assert(!any_needs_escape);
                    const vec: AsciiU16Vector = remaining[0..ascii_u16_vector_size].*;
                    if (@reduce(.Max, @as(AsciiVectorU16U1, @bitCast(vec > @as(AsciiU16Vector, @splat(@as(u16, 127))))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[0]))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[1]))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[2]))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[3]))) |
                        @as(AsciiVectorU16U1, @bitCast((vec == vecs[4])))) == 1)
                    {
                        var i: u16 = 0;
                        lazy: {
                            while (i < ascii_u16_vector_size) {
                                switch (remaining[i]) {
                                    '"', '&', '\'', '<', '>' => {
                                        any_needs_escape = true;
                                        break :lazy;
                                    },
                                    128...std.math.maxInt(u16) => {
                                        const cp = utf16Codepoint([]const u16, remaining[i..]);
                                        i += @as(u16, cp.len);
                                    },
                                    else => {
                                        i += 1;
                                    },
                                }
                            }
                        }

                        if (!any_needs_escape) {
                            remaining = remaining[i..];
                            continue :scan_and_allocate_lazily;
                        }

                        if (comptime Environment.allow_assert) assert(@intFromPtr(remaining.ptr + i) >= @intFromPtr(utf16.ptr));
                        const to_copy = std.mem.sliceAsBytes(utf16)[0 .. @intFromPtr(remaining.ptr + i) - @intFromPtr(utf16.ptr)];
                        const to_copy_16 = std.mem.bytesAsSlice(u16, to_copy);
                        buf = try std.ArrayList(u16).initCapacity(allocator, utf16.len + 6);
                        try buf.appendSlice(to_copy_16);

                        while (i < ascii_u16_vector_size) {
                            switch (remaining[i]) {
                                '"', '&', '\'', '<', '>' => |c| {
                                    const result = switch (c) {
                                        '"' => toUTF16Literal("&quot;"),
                                        '&' => toUTF16Literal("&amp;"),
                                        '\'' => toUTF16Literal("&#x27;"),
                                        '<' => toUTF16Literal("&lt;"),
                                        '>' => toUTF16Literal("&gt;"),
                                        else => unreachable,
                                    };

                                    buf.appendSlice(result) catch unreachable;
                                    i += 1;
                                },
                                128...std.math.maxInt(u16) => {
                                    const cp = utf16Codepoint([]const u16, remaining[i..]);

                                    buf.appendSlice(remaining[i..][0..@as(usize, cp.len)]) catch unreachable;
                                    i += @as(u16, cp.len);
                                },
                                else => |c| {
                                    i += 1;
                                    buf.append(c) catch unreachable;
                                },
                            }
                        }

                        // edgecase: code point width could exceed asdcii_u16_vector_size
                        remaining = remaining[i..];
                        break :scan_and_allocate_lazily;
                    }

                    remaining = remaining[ascii_u16_vector_size..];
                }

                if (any_needs_escape) {
                    // pass #2: we found something that needed an escape
                    // but there's still some more text to
                    // so we'll go ahead and copy the buffer into a new buffer
                    while (remaining.len >= ascii_u16_vector_size) {
                        const vec: AsciiU16Vector = remaining[0..ascii_u16_vector_size].*;
                        if (@reduce(.Max, @as(AsciiVectorU16U1, @bitCast(vec > @as(AsciiU16Vector, @splat(@as(u16, 127))))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[0]))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[1]))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[2]))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[3]))) |
                            @as(AsciiVectorU16U1, @bitCast((vec == vecs[4])))) == 1)
                        {
                            buf.ensureUnusedCapacity(ascii_u16_vector_size) catch unreachable;
                            var i: u16 = 0;
                            while (i < ascii_u16_vector_size) {
                                switch (remaining[i]) {
                                    '"' => {
                                        buf.appendSlice(toUTF16Literal("&quot;")) catch unreachable;
                                        i += 1;
                                    },
                                    '&' => {
                                        buf.appendSlice(toUTF16Literal("&amp;")) catch unreachable;
                                        i += 1;
                                    },
                                    '\'' => {
                                        buf.appendSlice(toUTF16Literal("&#x27;")) catch unreachable; // modified from escape-html; used to be '&#39'
                                        i += 1;
                                    },
                                    '<' => {
                                        buf.appendSlice(toUTF16Literal("&lt;")) catch unreachable;
                                        i += 1;
                                    },
                                    '>' => {
                                        buf.appendSlice(toUTF16Literal("&gt;")) catch unreachable;
                                        i += 1;
                                    },
                                    128...std.math.maxInt(u16) => {
                                        const cp = utf16Codepoint([]const u16, remaining[i..]);

                                        buf.appendSlice(remaining[i..][0..@as(usize, cp.len)]) catch unreachable;
                                        i += @as(u16, cp.len);
                                    },
                                    else => |c| {
                                        buf.append(c) catch unreachable;
                                        i += 1;
                                    },
                                }
                            }

                            remaining = remaining[i..];
                            continue;
                        }

                        try buf.ensureUnusedCapacity(ascii_u16_vector_size);
                        buf.items.ptr[buf.items.len .. buf.items.len + ascii_u16_vector_size][0..ascii_u16_vector_size].* = remaining[0..ascii_u16_vector_size].*;
                        buf.items.len += ascii_u16_vector_size;
                        remaining = remaining[ascii_u16_vector_size..];
                    }
                }
            }

            var ptr = remaining.ptr;
            const end = remaining.ptr + remaining.len;

            if (!any_needs_escape) {
                scan_and_allocate_lazily: while (ptr != end) {
                    switch (ptr[0]) {
                        '"', '&', '\'', '<', '>' => |c| {
                            buf = try std.ArrayList(u16).initCapacity(allocator, utf16.len + @as(usize, Scalar.lengths[c]));
                            if (comptime Environment.allow_assert) assert(@intFromPtr(ptr) >= @intFromPtr(utf16.ptr));

                            const to_copy = std.mem.sliceAsBytes(utf16)[0 .. @intFromPtr(ptr) - @intFromPtr(utf16.ptr)];
                            const to_copy_16 = std.mem.bytesAsSlice(u16, to_copy);
                            try buf.appendSlice(to_copy_16);
                            any_needs_escape = true;
                            break :scan_and_allocate_lazily;
                        },
                        128...std.math.maxInt(u16) => {
                            const cp = utf16Codepoint([]const u16, ptr[0..if (ptr + 1 == end) 1 else 2]);

                            ptr += @as(u16, cp.len);
                        },
                        else => {
                            ptr += 1;
                        },
                    }
                }
            }

            while (ptr != end) {
                switch (ptr[0]) {
                    '"' => {
                        buf.appendSlice(toUTF16Literal("&quot;")) catch unreachable;
                        ptr += 1;
                    },
                    '&' => {
                        buf.appendSlice(toUTF16Literal("&amp;")) catch unreachable;
                        ptr += 1;
                    },
                    '\'' => {
                        buf.appendSlice(toUTF16Literal("&#x27;")) catch unreachable; // modified from escape-html; used to be '&#39'
                        ptr += 1;
                    },
                    '<' => {
                        buf.appendSlice(toUTF16Literal("&lt;")) catch unreachable;
                        ptr += 1;
                    },
                    '>' => {
                        buf.appendSlice(toUTF16Literal("&gt;")) catch unreachable;
                        ptr += 1;
                    },
                    128...std.math.maxInt(u16) => {
                        const cp = utf16Codepoint([]const u16, ptr[0..if (ptr + 1 == end) 1 else 2]);

                        buf.appendSlice(ptr[0..@as(usize, cp.len)]) catch unreachable;
                        ptr += @as(u16, cp.len);
                    },

                    else => |c| {
                        buf.append(c) catch unreachable;
                        ptr += 1;
                    },
                }
            }

            if (!any_needs_escape) {
                return Escaped(u16){ .original = {} };
            }

            return Escaped(u16){ .allocated = try buf.toOwnedSlice() };
        },
    }
}

const std = @import("std");
const bun = @import("bun");
const Environment = bun.Environment;
const assert = bun.assert;
const ascii_u16_vector_size = strings.ascii_u16_vector_size;
const AsciiU16Vector = strings.AsciiU16Vector;
const utf16Codepoint = strings.utf16Codepoint;
const toUTF16Literal = strings.toUTF16Literal;
const strings = bun.strings;
const AsciiVectorU16U1 = strings.AsciiVectorU16U1;
const AsciiVector = strings.AsciiVector;
const ascii_vector_size = strings.ascii_vector_size;
const AsciiVectorU1 = strings.AsciiVectorU1;
