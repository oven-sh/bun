const std = @import("std");
const EnvStream = @import("env_stream.zig").EnvStream;
const EnvValue = @import("../data/env_value.zig").EnvValue;
const ParserOptions = @import("../data/parser_options.zig").ParserOptions;
const ReadResult = @import("../data/read_result.zig").ReadResult;
const readNextChar = @import("read_next_char.zig").readNextChar;
const escape_processor = @import("escape_processor.zig");
const quote_parser = @import("quote_parser.zig");
const interpolation = @import("../interpolation/interpolation.zig");
const testing = std.testing;

pub fn readValue(allocator: std.mem.Allocator, stream: *EnvStream, value: *EnvValue, options: ParserOptions) !ReadResult {
    if (!stream.good()) return ReadResult.end_of_stream_value;

    var key_char: u8 = 0;
    while (stream.good()) {
        const char_opt = stream.get();
        if (char_opt == null) break;
        key_char = char_opt.?;

        if (try readNextChar(allocator, value, key_char, options) and stream.good()) {
            continue;
        }
        break;
    }

    // End-of-value cleanup
    if (value.back_slash_streak > 0) {
        try escape_processor.walkBackSlashes(value);
        if (value.back_slash_streak == 1) {
            _ = try escape_processor.processPossibleControlCharacter(value, '\x00');
        }
    }

    if (value.single_quote_streak > 0) {
        if (try quote_parser.walkSingleQuotes(value)) {
            if (key_char != '\n') {
                stream.skipToNewline();
            }
        }
    }

    if ((value.triple_double_quoted or value.triple_quoted) and key_char != '\n') {
        stream.skipToNewline();
    }

    if (value.double_quote_streak > 0) {
        if (try quote_parser.walkDoubleQuotes(value)) {
            if (key_char != '\n') {
                stream.skipToNewline();
            }
        }
    }

    // Trim right side of implicit double quote
    if (value.implicit_double_quote) {
        while (value.buffer.len > 0 and value.buffer.ptr[value.buffer.len - 1] == ' ') {
            value.buffer.len -= 1;
        }
    }

    // Close any open braceless variable at EOF/End of value
    if (value.is_parsing_braceless_variable) {
        try interpolation.closeBracelessVariable(allocator, value);
    }

    return ReadResult.success;
}

test "readValue simple value" {
    const default_options = ParserOptions.defaults();
    var stream = EnvStream.init("simple");

    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    const result = try readValue(testing.allocator, &stream, &val, default_options);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqual(@as(usize, 6), val.buffer.len);
}

test "readValue quoted value" {
    const default_options = ParserOptions.defaults();
    var stream = EnvStream.init("\"quoted value\"");

    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    const result = try readValue(testing.allocator, &stream, &val, default_options);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expect(val.double_quoted);
}

test "readValue with escape" {
    const default_options = ParserOptions.defaults();
    var stream = EnvStream.init("test\\nvalue");

    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    const result = try readValue(testing.allocator, &stream, &val, default_options);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expect(val.buffer.len > 0);
}

test "readValue implicit double quote trimming" {
    const default_options = ParserOptions.defaults();
    var stream = EnvStream.init("value  ");

    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    const result = try readValue(testing.allocator, &stream, &val, default_options);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expect(val.implicit_double_quote);
    // Value should be trimmed on the right
    try testing.expectEqual(@as(usize, 5), val.buffer.len);
}

test "readValue with interpolation" {
    const default_options = ParserOptions.defaults();
    var stream = EnvStream.init("a${b}c");

    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    const result = try readValue(testing.allocator, &stream, &val, default_options);

    try testing.expectEqual(ReadResult.success, result);
    try testing.expectEqual(@as(usize, 1), val.interpolations.items.len);
}
