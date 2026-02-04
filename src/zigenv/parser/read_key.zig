const std = @import("std");
const EnvStream = @import("env_stream.zig").EnvStream;
const EnvKey = @import("../data/env_key.zig").EnvKey;
const ReadResult = @import("../data/read_result.zig").ReadResult;
const ParserOptions = @import("../data/parser_options.zig").ParserOptions;
const testing = std.testing;

pub fn readKey(stream: *EnvStream, key: *EnvKey, options: ParserOptions) !ReadResult {
    if (!stream.good()) return ReadResult.end_of_stream_key;

    while (stream.good()) {
        const char_opt = stream.get();
        if (char_opt == null) break;
        const key_char = char_opt.?;

        if (key_char == '#') {
            stream.skipToNewline();
            return ReadResult.comment_encountered;
        }

        switch (key_char) {
            ' ' => {
                if (key.buffer.len == 0) continue; // left trim

                // Handle "export" keyword (stripping "export " prefix)
                if (options.support_export_prefix and key.buffer.len == 6 and std.mem.eql(u8, key.buffer.usedSlice(), "export")) {
                    key.buffer.clearRetainingCapacity();
                    continue;
                }

                try key.buffer.append(key_char);
            },
            '=' => {
                if (stream.eof()) return ReadResult.end_of_stream_value;
                return ReadResult.success;
            },
            ':' => {
                if (options.support_colon_separator) {
                    // Bun's colon separator requires a following space
                    if (stream.peek()) |next_char| {
                        if (next_char == ' ') {
                            _ = stream.get(); // consume the space
                            if (stream.eof()) return ReadResult.end_of_stream_value;
                            return ReadResult.success;
                        }
                    }
                }
                try key.buffer.append(key_char);
            },
            '\r' => continue,
            '\n' => {
                return ReadResult.fail;
            },
            else => {
                try key.buffer.append(key_char);
            },
        }
    }

    return ReadResult.end_of_stream_key;
}

test "readKey simple key" {
    const opts = ParserOptions.defaults();
    var stream = EnvStream.init("KEY=value");

    var key = EnvKey.init(testing.allocator);
    defer key.deinit();

    const result = try readKey(&stream, &key, opts);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqualStrings("KEY", key.key());
}

test "readKey leading spaces" {
    const opts = ParserOptions.defaults();
    var stream = EnvStream.init("  SPACED_KEY=value");

    var key = EnvKey.init(testing.allocator);
    defer key.deinit();

    const result = try readKey(&stream, &key, opts);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqualStrings("SPACED_KEY", key.key());
}

test "readKey internal spaces" {
    const opts = ParserOptions.defaults();
    var stream = EnvStream.init("my key=value");

    var key = EnvKey.init(testing.allocator);
    defer key.deinit();

    const result = try readKey(&stream, &key, opts);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqualStrings("my key", key.key());
}

test "readKey comment line" {
    const opts = ParserOptions.defaults();
    var stream = EnvStream.init("#comment\nnext");

    var key = EnvKey.init(testing.allocator);
    defer key.deinit();

    const result = try readKey(&stream, &key, opts);

    try testing.expectEqual(ReadResult.comment_encountered, result);
    try testing.expectEqualStrings("", key.key());

    // skipToNewline consumes until newline, so next char should be 'n' from "next"
    const next = stream.get();
    try testing.expectEqual(@as(?u8, 'n'), next);
}

test "readKey invalid key" {
    const opts = ParserOptions.defaults();
    var stream = EnvStream.init("INVALID\n");

    var key = EnvKey.init(testing.allocator);
    defer key.deinit();

    const result = try readKey(&stream, &key, opts);

    try testing.expectEqual(ReadResult.fail, result);
}

test "readKey windows line endings" {
    const opts = ParserOptions.defaults();
    var stream = EnvStream.init("KEY\r=value");

    var key = EnvKey.init(testing.allocator);
    defer key.deinit();

    const result = try readKey(&stream, &key, opts);
    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqualStrings("KEY", key.key());
}

test "readKey EOF during key" {
    const opts = ParserOptions.defaults();
    var stream = EnvStream.init("INCOMPLETE");

    var key = EnvKey.init(testing.allocator);
    defer key.deinit();

    const result = try readKey(&stream, &key, opts);

    try testing.expectEqual(ReadResult.end_of_stream_key, result);
    try testing.expectEqualStrings("INCOMPLETE", key.key());
}

test "readKey with export prefix" {
    var opts = ParserOptions.defaults();
    opts.support_export_prefix = true;
    var stream = EnvStream.init("export KEY=value");

    var key = EnvKey.init(testing.allocator);
    defer key.deinit();

    const result = try readKey(&stream, &key, opts);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqualStrings("KEY", key.key());
}

test "readKey with colon separator" {
    var opts = ParserOptions.defaults();
    opts.support_colon_separator = true;
    var stream = EnvStream.init("KEY: value");

    var key = EnvKey.init(testing.allocator);
    defer key.deinit();

    const result = try readKey(&stream, &key, opts);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqualStrings("KEY", key.key());
}
