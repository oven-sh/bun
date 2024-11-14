const std = @import("std");
const bun = @import("root").bun;
const strings = bun.strings;

const BunString = bun.String;
const JSC = bun.JSC;

const CaseRules = struct {
    sep: ?u8,
    capitalize_first: bool,
    capitalize_word: bool,
    uppercase_word: bool,

    const camel: CaseRules = .{
        .sep = null,
        .capitalize_first = false,
        .capitalize_word = true,
        .uppercase_word = false,
    };
    const capital: CaseRules = .{
        .sep = ' ',
        .capitalize_first = true,
        .capitalize_word = true,
        .uppercase_word = false,
    };
    const constant: CaseRules = .{
        .sep = '_',
        .capitalize_first = false,
        .capitalize_word = false,
        .uppercase_word = true,
    };
    const dot: CaseRules = .{
        .sep = '.',
        .capitalize_first = false,
        .capitalize_word = false,
        .uppercase_word = false,
    };
    const kebab: CaseRules = .{
        .sep = '-',
        .capitalize_first = false,
        .capitalize_word = false,
        .uppercase_word = false,
    };
    const pascal: CaseRules = .{
        .sep = null,
        .capitalize_first = true,
        .capitalize_word = true,
        .uppercase_word = false,
    };
    const snake: CaseRules = .{
        .sep = '_',
        .capitalize_first = false,
        .capitalize_word = false,
        .uppercase_word = false,
    };
    const train: CaseRules = .{
        .sep = '-',
        .capitalize_first = true,
        .capitalize_word = true,
        .uppercase_word = false,
    };
};

const Encoding = enum {
    ascii,
    utf8,
    latin1,
    utf16,

    pub fn Byte(comptime encoding: Encoding) type {
        return switch (encoding) {
            .ascii, .utf8, .latin1 => u8,
            .utf16 => u16,
        };
    }
};

fn isSeperator(c: u32) bool {
    return switch (c) {
        // ASCII separators
        0x0020, // space
        0x002D, // hyphen-minus
        0x005F, // underscore
        0x002E, // dot
        0x0009, // tab
        0x000A, // line feed
        0x000D, // carriage return

        // Additional Unicode separators
        0x00A0, // no-break space
        0x00B6, // pilcrow sign
        0x2000...0x200B, // various Unicode spaces and zero-width spaces
        0x2010...0x2015, // various Unicode hyphens and dashes
        0x2018...0x201F, // quotation marks
        0x2026, // ellipsis
        0x3000, // ideographic space
        0xFEFF, // zero width no-break space
        => true,
        else => false,
    };
}

fn isLower(comptime kind: Encoding, c: kind.Byte()) bool {
    return switch (kind) {
        .utf16 => if (c <= 0x7F) std.ascii.isLower(@intCast(c)) else false,
        else => std.ascii.isLower(c),
    };
}

fn isUpper(comptime kind: Encoding, c: kind.Byte()) bool {
    return switch (kind) {
        .utf16 => if (c <= 0x7F) std.ascii.isUpper(@intCast(c)) else false,
        else => std.ascii.isUpper(c),
    };
}

fn processUtf8(bytes: []const u8, idx: usize) u32 {
    const sequence_len = strings.wtf8ByteSequenceLength(bytes[idx]);
    bun.assert(sequence_len > 1);

    var buffer: [4]u8 = undefined;
    @memcpy(buffer[0..sequence_len], bytes[idx..][0..sequence_len]);

    const c = strings.decodeWTF8RuneTMultibyte(&buffer, sequence_len, u32, strings.unicode_replacement);
    std.debug.print("codepoint {d}\n", .{c});
    return c;
}

fn peekNextUtf8(bytes: []const u8, offset: usize) ?struct { usize, usize } {
    var i = offset;
    var start = offset;

    while (i < bytes.len) {
        const c = if (bytes[i] > 127)
            processUtf8(bytes, i)
        else
            bytes[i];

        if (!isSeperator(c)) break;

        i += if (bytes[i] > 127)
            strings.wtf8ByteSequenceLength(bytes[i])
        else
            1;
        start = i;
    }

    if (i >= bytes.len) return null;

    while (i < bytes.len) {
        const c = if (bytes[i] > 127)
            processUtf8(bytes, i)
        else
            bytes[i];

        const is_separator = isSeperator(c);

        const is_case_boundary = if (i > 0 and i + 1 < bytes.len and
            bytes[i] <= 127 and bytes[i - 1] <= 127)
            std.ascii.isLower(bytes[i - 1]) and std.ascii.isUpper(bytes[i])
        else
            false;

        if (is_separator or is_case_boundary) {
            if (i > start) return .{ start, i };
        }

        i += if (bytes[i] > 127)
            strings.wtf8ByteSequenceLength(bytes[i])
        else
            1;
    }

    if (start < bytes.len) {
        return .{ start, bytes.len };
    }

    return null;
}

fn peekNext(comptime kind: Encoding, bytes: []const kind.Byte(), offset: usize) ?struct { usize, usize } {
    // Utf8 should be handled differently
    bun.assert(kind != .utf8);

    var i = offset;
    var start = offset;

    while (i < bytes.len and isSeperator(bytes[i])) {
        i += 1;
        start = i;
    }

    if (i >= bytes.len) return null;

    while (i < bytes.len) {
        const curr = bytes[i];

        const is_separator = isSeperator(curr);

        const is_case_boundary = if (i > 0 and i + 1 < bytes.len)
            isLower(kind, bytes[i - 1]) and isUpper(kind, curr)
        else
            false;

        if (is_separator or is_case_boundary) {
            if (i > start) return .{ start, i };
        }

        i += 1;
    }

    if (start < bytes.len) {
        return .{ start, bytes.len };
    }

    return null;
}

// TODO: handle casing of utf8 codepoints
pub fn convertUtf8(
    from: []const u8,
    to: []u8,
    case: CaseRules,
) void {
    var pos: usize = 0;
    var is_first = true;

    var iter = NewWordIterator(.utf8).init(from);

    while (iter.next()) |word| {
        if (!is_first and case.sep != null) {
            to[pos] = case.sep.?;
            pos += 1;
        }

        const should_capitalize = (is_first and case.capitalize_first) or
            (!is_first and case.capitalize_word);

        if (case.uppercase_word) {
            for (word, 0..) |c, i| {
                to[pos + i] = if (c <= 127)
                    std.ascii.toUpper(c)
                else
                    c;
            }
        } else if (should_capitalize) {
            to[pos] = if (word[0] <= 127)
                std.ascii.toUpper(word[0])
            else
                word[0];

            for (word[1..], 1..) |c, i| {
                to[pos + i] = if (c <= 127)
                    std.ascii.toLower(c)
                else
                    c;
            }
        } else {
            for (word, 0..) |c, i| {
                to[pos + i] = if (c <= 127)
                    std.ascii.toLower(c)
                else
                    c;
            }
        }

        pos += word.len;
        is_first = false;
    }
}

pub fn convert(
    comptime kind: Encoding,
    from: []const kind.Byte(),
    to: []kind.Byte(),
    case: CaseRules,
) void {
    if (kind == .utf8) return convertUtf8(from, to, case);

    var pos: usize = 0;
    var is_first = true;

    var iter = NewWordIterator(kind).init(from);

    while (iter.next()) |word| {
        if (!is_first and case.sep != null) {
            to[pos] = case.sep.?;
            pos += 1;
        }

        const should_capitalize = (is_first and case.capitalize_first) or
            (!is_first and case.capitalize_word);

        if (case.uppercase_word) {
            for (word, 0..) |c, i| {
                to[pos + i] = switch (kind) {
                    .utf16 => if (c < 0x7F) @intCast(std.ascii.toUpper(@intCast(c))) else c,
                    else => std.ascii.toUpper(c),
                };
            }
        } else if (should_capitalize) {
            to[pos] = switch (kind) {
                .utf16 => if (word[0] <= 0x7F) @intCast(std.ascii.toUpper(@intCast(word[0]))) else word[0],
                else => std.ascii.toUpper(word[0]),
            };

            for (word[1..], 1..) |c, i| {
                to[pos + i] = switch (kind) {
                    .utf16 => if (c < 0x7F) @intCast(std.ascii.toLower(@intCast(c))) else c,
                    else => std.ascii.toLower(c),
                };
            }
        } else {
            for (word[0..], 0..) |c, i| {
                to[pos + i] = switch (kind) {
                    .utf16 => if (c < 0x7F) @intCast(std.ascii.toLower(@intCast(c))) else c,
                    else => std.ascii.toLower(c),
                };
            }
        }

        pos += word.len;
        is_first = false;
    }
}

pub fn convertAlloc(
    comptime kind: Encoding,
    input: []const kind.Byte(),
    allocator: std.mem.Allocator,
    case: CaseRules,
) ![]kind.Byte() {
    const size = convertLen(kind, input, case);

    var result = try allocator.alloc(kind.Byte(), size);
    convert(kind, input, &result, case);

    return result;
}

pub fn convertLen(
    comptime kind: Encoding,
    input: []const kind.Byte(),
    case: CaseRules,
) usize {
    var len: usize = 0;
    var is_first = true;

    var iter = NewWordIterator(kind).init(input);
    while (iter.next()) |word| {
        if (!is_first and case.sep != null) {
            len += 1;
        }

        len += word.len;
        is_first = false;
    }

    return len;
}

pub fn NewWordIterator(comptime kind: Encoding) type {
    return switch (kind) {
        .utf8 => struct {
            const Self = @This();
            bytes: []const kind.Byte(),
            i: usize,

            pub fn init(bytes: []const kind.Byte()) Self {
                return .{
                    .bytes = bytes,
                    .i = 0,
                };
            }

            pub fn next(self: *Self) ?[]const kind.Byte() {
                if (peekNextUtf8(self.bytes, self.i)) |res| {
                    const start, const end = res;
                    self.i = end;
                    return self.bytes[start..end];
                }
                return null;
            }

            pub fn peek(self: *const Self) ?[]const kind.Byte() {
                if (peekNextUtf8(self.bytes, self.start)) |res| {
                    const start, const end = res;
                    return self.bytes[start..end];
                } else return null;
            }
        },
        else => struct {
            const Self = @This();
            bytes: []const kind.Byte(),
            i: usize,

            pub fn init(bytes: []const kind.Byte()) Self {
                return .{
                    .bytes = bytes,
                    .i = 0,
                };
            }

            pub fn next(self: *Self) ?[]const kind.Byte() {
                if (peekNext(kind, self.bytes, self.i)) |res| {
                    const start, const end = res;
                    self.i = end;
                    return self.bytes[start..end];
                }
                return null;
            }

            pub fn peek(self: *const Self) ?[]const kind.Byte() {
                if (peekNext(kind, self.bytes, self.start)) |res| {
                    const start, const end = res;
                    return self.bytes[start..end];
                } else return null;
            }
        },
    };
}

pub fn camelCase(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(1);
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("camelCase", 1, 0);
    }

    const input = arguments.ptr[0].toBunString(globalThis);
    defer input.deref();

    const result = convertCase(input, CaseRules.camel);
    defer result.deref();

    return result.toJS(globalThis);
}

pub fn capitalCase(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(1);
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("capitalCase", 1, 0);
    }

    const input = arguments.ptr[0].toBunString(globalThis);
    defer input.deref();

    const result = convertCase(input, CaseRules.capital);
    defer result.deref();

    return result.toJS(globalThis);
}

pub fn constantCase(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(1);
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("constantCase", 1, 0);
    }

    const input = arguments.ptr[0].toBunString(globalThis);
    defer input.deref();

    const result = convertCase(input, CaseRules.constant);
    defer result.deref();

    return result.toJS(globalThis);
}

pub fn dotCase(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(1);
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("dotCase()", 1, 0);
    }

    const input = arguments.ptr[0].toBunString(globalThis);
    defer input.deref();

    const result = convertCase(input, CaseRules.dot);
    defer result.deref();

    return result.toJS(globalThis);
}

pub fn kebabCase(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(1);
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("kebabCase()", 1, 0);
    }

    const input = arguments.ptr[0].toBunString(globalThis);
    defer input.deref();

    const result = convertCase(input, CaseRules.kebab);
    defer result.deref();

    return result.toJS(globalThis);
}

pub fn pascalCase(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(1);
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("pascalCase()", 1, 0);
    }

    const input = arguments.ptr[0].toBunString(globalThis);
    defer input.deref();

    const result = convertCase(input, CaseRules.pascal);
    defer result.deref();

    return result.toJS(globalThis);
}

pub fn snakeCase(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(1);
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("snakeCase()", 1, 0);
    }

    const input = arguments.ptr[0].toBunString(globalThis);
    defer input.deref();

    const result = convertCase(input, CaseRules.snake);
    defer result.deref();

    return result.toJS(globalThis);
}

pub fn trainCase(
    globalThis: *JSC.JSGlobalObject,
    callframe: *JSC.CallFrame,
) JSC.JSValue {
    const arguments = callframe.arguments(1);
    if (arguments.len < 1) {
        globalThis.throwNotEnoughArguments("trainCase()", 1, 0);
    }

    const input = arguments.ptr[0].toBunString(globalThis);
    defer input.deref();

    const result = convertCase(input, CaseRules.train);
    defer result.deref();

    return result.toJS(globalThis);
}

fn convertCase(input: BunString, case: CaseRules) BunString {
    if (input.isEmpty()) {
        return BunString.empty;
    }

    if (input.isUTF8() or input.is8Bit()) {
        const len = convertLen(.latin1, input.latin1(), case);
        if (len == 0) {
            return BunString.empty;
        }

        const str, const bytes = BunString.createUninitialized(.latin1, len);
        convert(.latin1, input.latin1(), bytes, case);

        return str;
    } else {
        const len = convertLen(.utf16, input.utf16(), case);
        if (len == 0) {
            return BunString.empty;
        }

        const str, const bytes = BunString.createUninitialized(.utf16, len);
        convert(.utf16, input.utf16(), bytes, case);

        return str;
    }
}
