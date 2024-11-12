const std = @import("std");
const bun = @import("root").bun;

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
                    start = i + 1;
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
            const words = try splitWords(input, allocator);
            defer allocator.free(words);

            var total_len: usize = 0;
            for (words) |word| {
                total_len += word.len;
            }
            total_len += seperator.len * @max(0, words.len -| 1);

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
                    @memcpy(result[pos..][0..word.len], word);
                }

                pos += word.len;

                if (i < word.len - 1 and seperator.len > 0) {
                    @memcpy(result[pos..][0..seperator.len], seperator);
                    pos += seperator.len;
                }
            }

            return switch (OutputType) {
                []const u8 => result,
                BunString => BunString.createUTF8(result),
                else => @compileError("Unsupported output type"),
            };
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

    const result: BunString = JSCaseConverter.toCamelCase(input.byteSlice(), bun.default_allocator) catch |err| {
        globalThis.throw("toCamelCase() internal error: {s}", .{@errorName(err)});
        return .undefined;
    };
    defer result.deref();

    return result.toJS(globalThis);
}

pub const JSCaseConverter = StringCaseConverter(BunString);
pub const NativeCaseConverter = StringCaseConverter([]const u8);
