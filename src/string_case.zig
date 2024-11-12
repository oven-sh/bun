const std = @import("std");
const bun = @import("root").bun;
const strings = bun.strings;

const BunString = bun.String;
const JSC = bun.JSC;

pub fn StringCaseConverter(comptime OutputType: type) type {
    return struct {
        fn isSeperator(c: u8) bool {
            return switch (c) {
                ' ', '-', '_', '.', '\t', '\n', '\r' => true,
                else => false,
            };
        }

        fn splitWords(input: []const u8, allocator: std.mem.Allocator) ![][]const u8 {
            var words = std.ArrayList([]const u8).init(allocator);
            defer words.deinit();

            var start: usize = 0;
            var i: usize = 0;

            while (i < input.len) {
                const curr = input[i];

                // Check if seperator
                const is_seperator = isSeperator(curr);

                // Check for camelCase boundary
                const is_case_boundary = if (i > 0 and i + 1 < input.len)
                    std.ascii.isLower(input[i - 1]) and std.ascii.isUpper(curr)
                else
                    false;

                if (is_seperator or is_case_boundary) {
                    if (start < i) {
                        try words.append(input[start..i]);
                    }

                    // Skip consecutive seperators
                    while (i + 1 < input.len and isSeperator(input[i + 1])) : (i += 1) {}
                    start = brk: {
                        if (is_case_boundary) break :brk i;
                        break :brk i + 1;
                    };
                }

                i += 1;
            }

            if (start < input.len) {
                try words.append(input[start..input.len]);
            }

            return try words.toOwnedSlice();
        }

        pub fn toCamelCase(input: []const u8, allocator: std.mem.Allocator) !OutputType {
            return convert(
                input,
                allocator,
                "",
                false,
                true,
                false,
            );
        }

        pub fn convert(
            input: []const u8,
            allocator: std.mem.Allocator,
            comptime seperator: []const u8,
            comptime capitalize_first: bool,
            comptime capitalize_word: bool,
            comptime uppercase_word: bool,
        ) !OutputType {
            if (strings.isAllASCII(input)) {
                const words = try splitWords(input, allocator);
                defer allocator.free(words);

                var total_len: usize = 0;
                for (words) |word| {
                    total_len += word.len;
                }
                total_len += seperator.len * (words.len -| 1);

                var result = try allocator.alloc(u8, total_len);
                errdefer allocator.free(result);

                var pos: usize = 0;
                for (words, 0..) |word, i| {
                    if (word.len == 0) continue;

                    const should_capitalize = (i == 0 and capitalize_first) or
                        (i > 0 and capitalize_word);

                    if (uppercase_word) {
                        for (word, 0..) |c, j| {
                            result[pos + j] = std.ascii.toUpper(c);
                        }
                    } else if (should_capitalize) {
                        result[pos] = std.ascii.toUpper(word[0]);
                        @memcpy(result[pos + 1 ..][0 .. word.len - 1], word[1..]);
                    } else {
                        if (i == 0) {
                            result[pos] = std.ascii.toLower(word[0]);
                            @memcpy(result[pos + 1 ..][0 .. word.len - 1], word[1..]);
                        } else {
                            @memcpy(result[pos..][0..word.len], word);
                        }
                    }

                    pos += word.len;

                    if (i < words.len - 1 and seperator.len > 0) {
                        @memcpy(result[pos..][0..seperator.len], seperator);
                        pos += seperator.len;
                    }
                }

                return switch (OutputType) {
                    []const u8 => result,
                    BunString => BunString.createUTF8(result),
                    else => @compileError("Unsupported output type"),
                };
            } else {
                var iter = strings.CodepointIterator.init(input);
                var cursor = strings.CodepointIterator.Cursor{};

                // First pass calculating length
                var total_len: usize = 0;
                var word_count: usize = 0;
                var prev_was_seperator = true;

                while (iter.next(&cursor)) {
                    const is_seperator = cursor.c <= 127 and isSeperator(@intCast(cursor.c));

                    if (!is_seperator) {
                        total_len += cursor.width;
                        if (prev_was_seperator) word_count += 1;
                    }

                    prev_was_seperator = is_seperator;
                }

                total_len += seperator.len * (word_count -| 1);
                var result = try allocator.alloc(u8, total_len);
                errdefer allocator.free(result);

                // Second pass build str
                iter = strings.CodepointIterator.init(input);
                cursor = strings.CodepointIterator.Cursor{};

                var pos: usize = 0;
                var word_index: usize = 0;
                prev_was_seperator = true;

                while (iter.next(&cursor)) {
                    const is_seperator = cursor.c <= 127 and isSeperator(@intCast(cursor.c));
                    if (is_seperator) {
                        prev_was_seperator = true;
                        continue;
                    }

                    if (!prev_was_seperator and word_index > 0 and seperator.len > 0) {
                        @memcpy(result[pos..][0..seperator.len], seperator);
                        pos += seperator.len;
                    }

                    if (cursor.c <= 127) {
                        const c: u8 = @intCast(cursor.c);
                        const should_capitalize = uppercase_word or
                            (word_index > 0 and capitalize_word and prev_was_seperator) or
                            (word_index == 0 and capitalize_first);

                        result[pos] = brk: {
                            if (should_capitalize)
                                break :brk std.ascii.toUpper(c)
                            else if (word_index == 0)
                                break :brk std.ascii.toLower(c)
                            else
                                break :brk c;
                        };
                        pos += 1;
                    } else {
                        @memcpy(result[pos..][0..cursor.width], input[cursor.i..][0..cursor.width]);
                        pos += cursor.width;
                    }

                    if (prev_was_seperator) word_index += 1;
                    prev_was_seperator = false;
                }

                return switch (OutputType) {
                    []const u8 => result,
                    BunString => BunString.createUTF8(result),
                    else => @compileError("Unsupported output type"),
                };
            }
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

    // TODO: better input handling
    const utf8 = input.toUTF8(bun.default_allocator);
    defer utf8.deinit();

    const result: BunString = JSCaseConverter.toCamelCase(utf8.byteSlice(), bun.default_allocator) catch |err| {
        globalThis.throw("toCamelCase() internal error: {s}", .{@errorName(err)});
        return .undefined;
    };
    defer result.deref();

    return result.toJS(globalThis);
}

pub const JSCaseConverter = StringCaseConverter(BunString);
pub const NativeCaseConverter = StringCaseConverter([]const u8);
