const std = @import("std");
const EnvValue = @import("../data/env_value.zig").EnvValue;
const ParserOptions = @import("../data/parser_options.zig").ParserOptions;
const buffer_utils = @import("../buffer/buffer_utils.zig");
const escape_processor = @import("escape_processor.zig");
const quote_parser = @import("quote_parser.zig");
const interpolation = @import("../interpolation/interpolation.zig");
const testing = std.testing;

fn isValidIdentifierChar(c: u8) bool {
    return std.ascii.isAlphanumeric(c) or c == '_';
}

fn isValidIdentifierStart(c: u8) bool {
    return std.ascii.isAlphabetic(c) or c == '_';
}

pub fn readNextChar(allocator: std.mem.Allocator, value: *EnvValue, char: u8, options: ParserOptions) !bool {
    // Handle pending backslash streak (if not in single quote mode and current char is not backslash)
    if (!value.quoted and !value.triple_quoted and value.back_slash_streak > 0) {
        if (char != '\\') {
            try escape_processor.walkBackSlashes(value);
            if (value.back_slash_streak == 1) {
                value.back_slash_streak = 0;
                if (try escape_processor.processPossibleControlCharacter(value, char)) {
                    return true;
                }
                try buffer_utils.addToBuffer(value, '\\');
            }
        }
    }

    // Handle braceless variable termination
    if (value.is_parsing_braceless_variable) {
        if (!isValidIdentifierChar(char)) {
            try interpolation.closeBracelessVariable(allocator, value);
        }
    }

    // Handle braceless variable start
    // We check this BEFORE processing the character because if we just finished a $,
    // and this char is a valid start, we start the variable.
    if (options.allow_braceless_variables and !value.is_parsing_variable and !value.is_parsing_braceless_variable) {
        // Variables enabled only if not in single quotes/triple single quotes
        if (!value.quoted and !value.triple_quoted) {
            // Check if we have a $ in the buffer (and it wasn't escaped)
            if (value.buffer.len > 0) {
                const items = value.value();
                if (items[items.len - 1] == '$') {
                    const dollar_idx = value.buffer.len - 1;
                    const is_escaped_dollar = if (value.escaped_dollar_index) |idx| idx == dollar_idx else false;

                    if (!is_escaped_dollar and !buffer_utils.isPreviousCharAnEscape(value)) {
                        if (isValidIdentifierStart(char)) {
                            try interpolation.openBracelessVariable(allocator, value);
                        }
                    }
                }
            }
        }
    }

    // Handle pending single quote streak (if not in double quote mode and current char is not single quote)
    if (!value.triple_double_quoted and !value.double_quoted and value.single_quote_streak > 0) {
        if (char != '\'') {
            if (try quote_parser.walkSingleQuotes(value)) {
                return false;
            }
        }
    }

    // Handle pending double quote streak (if not in single quote mode and current char is not double quote)
    if (!value.triple_quoted and !value.quoted and value.double_quote_streak > 0) {
        if (char != '"') {
            if (try quote_parser.walkDoubleQuotes(value)) {
                return false;
            }
        }
    }

    // Handle first character special cases
    if (value.buffer.len == 0) {
        if (char == '`') {
            if (value.backtick_quoted) {
                return false;
            }
            if (!value.quoted and !value.triple_quoted and !value.double_quoted and !value.triple_double_quoted) {
                value.double_quoted = true;
                value.backtick_quoted = true;
                return true;
            }
        }

        if (char == '#') {
            if (!value.quoted and !value.triple_quoted and !value.double_quoted and !value.triple_double_quoted) {
                return false;
            }
        } else if (char != '"' and char != '\'') {
            if (!value.quoted and !value.triple_quoted and !value.double_quoted and !value.triple_double_quoted) {
                value.double_quoted = true;
                value.implicit_double_quote = true;
            }
        }
        if (char == ' ' and value.implicit_double_quote) {
            return true; // trim left on implicit quotes
        }
    }

    // Process current character
    switch (char) {
        '`' => {
            if (value.backtick_quoted) {
                return false;
            }
            try buffer_utils.addToBuffer(value, char);
        },
        '#' => {
            if (value.implicit_double_quote) {
                return false;
            }
            try buffer_utils.addToBuffer(value, char);
        },
        '\n' => {
            // Check if newlines are allowed in the current quote context
            const allow_newline = value.triple_double_quoted or
                value.triple_quoted or
                (value.double_quoted and !value.implicit_double_quote) or
                (value.quoted and options.allow_single_quote_heredocs);

            if (!allow_newline) {
                if (value.buffer.len > 0) {
                    const items = value.value();
                    if (items[items.len - 1] == '\r') {
                        value.buffer.len -= 1;
                    }
                }
                return false;
            }
            try buffer_utils.addToBuffer(value, char);
            return true;
        },
        '\\' => {
            if (value.quoted or value.triple_quoted) {
                try buffer_utils.addToBuffer(value, char);
                return true;
            }
            value.back_slash_streak += 1;
            return true;
        },
        '{' => {
            try buffer_utils.addToBuffer(value, char);
            if (!value.quoted and !value.triple_quoted) {
                if (!buffer_utils.isPreviousCharAnEscape(value)) {
                    try interpolation.openVariable(allocator, value);
                }
            }
            return true;
        },
        '}' => {
            try buffer_utils.addToBuffer(value, char);
            if (value.is_parsing_variable) {
                if (!buffer_utils.isPreviousCharAnEscape(value)) {
                    try interpolation.closeVariable(allocator, value);
                }
            }
            return true;
        },
        '\'' => {
            if (!value.double_quoted and !value.triple_double_quoted) {
                value.single_quote_streak += 1;
            } else {
                try buffer_utils.addToBuffer(value, char);
            }
            return true;
        },
        '"' => {
            if (!value.quoted and !value.triple_quoted and !value.backtick_quoted and !value.implicit_double_quote) {
                value.double_quote_streak += 1;
            } else {
                try buffer_utils.addToBuffer(value, char);
            }
            return true;
        },
        '\r' => {
            return true;
        },
        else => {
            try buffer_utils.addToBuffer(value, char);
        },
    }
    return true;
}

test "readNextChar basic" {
    const default_options = ParserOptions.defaults();
    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    // 'a'
    const cont = try readNextChar(testing.allocator, &val, 'a', default_options);
    try testing.expect(cont);
    try testing.expectEqualStrings("a", val.value());
}

test "readNextChar implicit double quote" {
    const default_options = ParserOptions.defaults();
    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    // First char 'a' -> implicit double quote
    _ = try readNextChar(testing.allocator, &val, 'a', default_options);
    try testing.expect(val.implicit_double_quote);
    try testing.expect(val.double_quoted);
}

test "readNextChar backtick" {
    const default_options = ParserOptions.defaults();
    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    // `
    _ = try readNextChar(testing.allocator, &val, '`', default_options);
    try testing.expect(val.backtick_quoted);
    try testing.expect(val.double_quoted);
    // Opening backtick sets the mode but is not added to buffer
}

test "readNextChar comment" {
    const default_options = ParserOptions.defaults();
    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    // #
    const cont = try readNextChar(testing.allocator, &val, '#', default_options);
    try testing.expect(!cont);
}

test "readNextChar quotes" {
    const default_options = ParserOptions.defaults();
    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    // '
    _ = try readNextChar(testing.allocator, &val, '\'', default_options);
    // Not quoted yet, still in streak
    try testing.expect(!val.quoted);

    // val - this triggers the walk
    _ = try readNextChar(testing.allocator, &val, 'v', default_options);
    try testing.expect(val.quoted);
    try testing.expectEqualStrings("v", val.value());

    // ' -> closing quote starts streak
    const cont = try readNextChar(testing.allocator, &val, '\'', default_options);
    try testing.expect(cont);

    // any other char -> triggers the walk that returns false
    const cont2 = try readNextChar(testing.allocator, &val, ' ', default_options);
    try testing.expect(!cont2);
    try testing.expectEqualStrings("v", val.value());
}

test "readNextChar double quotes" {
    const default_options = ParserOptions.defaults();
    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    // "
    _ = try readNextChar(testing.allocator, &val, '"', default_options);
    try testing.expect(!val.double_quoted);

    // v - this triggers the walk
    _ = try readNextChar(testing.allocator, &val, 'v', default_options);
    try testing.expect(val.double_quoted);
    try testing.expectEqualStrings("v", val.value());

    // " -> closing quote starts streak
    const cont = try readNextChar(testing.allocator, &val, '"', default_options);
    try testing.expect(cont);

    // any other char -> triggers the walk that returns false
    const cont2 = try readNextChar(testing.allocator, &val, ' ', default_options);
    try testing.expect(!cont2);
    try testing.expectEqualStrings("v", val.value());
}

test "readNextChar escape" {
    const default_options = ParserOptions.defaults();
    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    // \
    _ = try readNextChar(testing.allocator, &val, '\\', default_options);
    try testing.expectEqual(@as(usize, 1), val.back_slash_streak);
    try testing.expectEqualStrings("", val.value()); // Not added yet

    // n -> \n
    const cont = try readNextChar(testing.allocator, &val, 'n', default_options);
    try testing.expect(cont);
    try testing.expectEqual(@as(usize, 0), val.back_slash_streak);
    try testing.expectEqualStrings("\n", val.value());
}

test "readNextChar interpolation" {
    const default_options = ParserOptions.defaults();
    var val = EnvValue.init(testing.allocator);
    defer val.deinit();

    // IMPLICIT quotes because start with non-quote
    // a
    _ = try readNextChar(testing.allocator, &val, 'a', default_options);
    try testing.expect(val.implicit_double_quote);

    // $
    _ = try readNextChar(testing.allocator, &val, '$', default_options);

    // {
    _ = try readNextChar(testing.allocator, &val, '{', default_options);
    try testing.expect(val.is_parsing_variable);
    try testing.expectEqualStrings("a${", val.value());

    // b
    _ = try readNextChar(testing.allocator, &val, 'b', default_options);

    // }
    _ = try readNextChar(testing.allocator, &val, '}', default_options);
    try testing.expect(!val.is_parsing_variable);
    try testing.expectEqualStrings("a${b}", val.value());

    try testing.expectEqual(@as(usize, 1), val.interpolations.items.len);
}
