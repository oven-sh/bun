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

fn isSeperator(comptime kind: Encoding, c: kind.Byte()) bool {
    return switch (c) {
        ' ', '-', '_', '.', '\t', '\n', '\r' => true,
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

pub fn convert(
    comptime kind: Encoding,
    from: []const kind.Byte(),
    to: []kind.Byte(),
    case: CaseRules,
) void {
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
    return struct {
        const Self = @This();
        bytes: []const kind.Byte(),
        i: usize,
        start: usize,

        pub fn init(bytes: []const kind.Byte()) Self {
            return .{
                .bytes = bytes,
                .i = 0,
                .start = 0,
            };
        }

        pub fn next(self: *Self) ?[]const kind.Byte() {
            while (self.i < self.bytes.len and isSeperator(kind, self.bytes[self.i])) {
                self.i += 1;
                self.start = self.i;
            }

            if (self.i >= self.bytes.len) return null;

            while (self.i < self.bytes.len) {
                const curr = self.bytes[self.i];

                const is_seperator = isSeperator(kind, curr);

                const is_case_boundary = if (self.i > 0 and self.i + 1 < self.bytes.len)
                    isLower(kind, self.bytes[self.i - 1]) and isUpper(kind, curr)
                else
                    false;

                if (is_seperator or is_case_boundary) {
                    const word = self.bytes[self.start..self.i];
                    if (is_case_boundary) {
                        self.start = self.i;
                    } else {
                        self.i += 1;
                        self.start = self.i;
                    }

                    if (word.len > 0) return word;
                }

                self.i += 1;
            }

            if (self.start < self.bytes.len) {
                const word = self.bytes[self.start..];
                self.start = self.bytes.len;
                return word;
            }

            return null;
        }

        pub fn peek(self: *const Self) ?[]const kind.Byte() {
            var i = self.i;
            var start = self.start;

            while (i < self.bytes.len and isSeperator(kind, self.bytes[i])) {
                i += 1;
                start = i;
            }

            if (i >= self.bytes.len) return null;

            while (i < self.bytes.len) {
                const curr = self.bytes[i];

                const is_separator = isSeperator(kind, curr);

                const is_case_boundary = if (i > 0 and i + 1 < self.bytes.len)
                    isLower(kind, self.bytes[i - 1]) and isUpper(kind, curr)
                else
                    false;

                if (is_separator or is_case_boundary) {
                    const word = self.bytes[start..i];
                    if (word.len > 0) return word;
                }

                i += 1;
            }

            if (start < self.bytes.len) {
                return self.bytes[start..];
            }

            return null;
        }
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
