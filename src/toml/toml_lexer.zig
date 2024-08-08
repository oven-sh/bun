const std = @import("std");
const logger = bun.logger;
const js_ast = bun.JSAst;

const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const CodePoint = bun.CodePoint;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;

pub const T = enum {
    t_end_of_file,

    t_open_paren,
    t_close_paren,
    t_open_bracket,
    t_open_bracket_double,

    t_close_bracket,
    t_close_bracket_double,

    t_open_brace,
    t_close_brace,

    t_numeric_literal,

    t_comma,

    t_string_literal,
    t_dot,

    t_equal,

    t_true,
    t_false,

    t_colon,

    t_identifier,

    t_plus,
    t_minus,

    t_empty_array,
};

pub const Lexer = struct {
    source: logger.Source,
    log: *logger.Log,
    start: usize = 0,
    end: usize = 0,
    current: usize = 0,

    allocator: std.mem.Allocator,

    code_point: CodePoint = -1,
    identifier: []const u8 = "",
    number: f64 = 0.0,
    prev_error_loc: logger.Loc = logger.Loc.Empty,
    string_literal_slice: string = "",
    string_literal_is_ascii: bool = true,
    line_number: u32 = 0,
    token: T = T.t_end_of_file,
    allow_double_bracket: bool = true,

    has_newline_before: bool = false,

    pub inline fn loc(self: *const Lexer) logger.Loc {
        return logger.usize2Loc(self.start);
    }

    pub fn syntaxError(self: *Lexer) !void {
        @setCold(true);

        self.addError(self.start, "Syntax Error!!", .{}, true);
        return Error.SyntaxError;
    }

    pub fn addError(self: *Lexer, _loc: usize, comptime format: []const u8, args: anytype, _: bool) void {
        @setCold(true);

        var __loc = logger.usize2Loc(_loc);
        if (__loc.eql(self.prev_error_loc)) {
            return;
        }

        self.log.addErrorFmt(&self.source, __loc, self.log.msgs.allocator, format, args) catch unreachable;
        self.prev_error_loc = __loc;
    }

    pub fn addDefaultError(self: *Lexer, msg: []const u8) !void {
        @setCold(true);

        self.addError(self.start, "{s}", .{msg}, true);
        return Error.SyntaxError;
    }

    pub fn addSyntaxError(self: *Lexer, _loc: usize, comptime fmt: []const u8, args: anytype) !void {
        @setCold(true);
        self.addError(_loc, fmt, args, false);
        return Error.SyntaxError;
    }

    pub fn addRangeError(self: *Lexer, r: logger.Range, comptime format: []const u8, args: anytype, _: bool) !void {
        @setCold(true);

        if (self.prev_error_loc.eql(r.loc)) {
            return;
        }

        const errorMessage = std.fmt.allocPrint(self.log.msgs.allocator, format, args) catch unreachable;
        try self.log.addRangeError(&self.source, r, errorMessage);
        self.prev_error_loc = r.loc;

        // if (panic) {
        //     return Error.ParserError;
        // }
    }

    /// Look ahead at the next n codepoints without advancing the iterator.
    /// If fewer than n codepoints are available, then return the remainder of the string.
    fn peek(it: *Lexer, n: usize) string {
        const original_i = it.current;
        defer it.current = original_i;

        var end_ix = original_i;
        var found: usize = 0;
        while (found < n) : (found += 1) {
            const next_codepoint = it.nextCodepointSlice();
            if (next_codepoint.len == 0) break;
            end_ix += next_codepoint.len;
        }

        return it.source.contents[original_i..end_ix];
    }

    inline fn nextCodepointSlice(it: *Lexer) []const u8 {
        const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(it.source.contents.ptr[it.current]);
        return if (!(cp_len + it.current > it.source.contents.len)) it.source.contents[it.current .. cp_len + it.current] else "";
    }

    inline fn nextCodepoint(it: *Lexer) CodePoint {
        const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(it.source.contents.ptr[it.current]);
        const slice = if (!(cp_len + it.current > it.source.contents.len)) it.source.contents[it.current .. cp_len + it.current] else "";

        const code_point = switch (slice.len) {
            0 => -1,
            1 => @as(CodePoint, slice[0]),
            else => strings.decodeWTF8RuneTMultibyte(slice.ptr[0..4], @as(u3, @intCast(slice.len)), CodePoint, strings.unicode_replacement),
        };

        it.end = it.current;

        it.current += if (code_point != strings.unicode_replacement)
            cp_len
        else
            1;

        return code_point;
    }

    inline fn step(lexer: *Lexer) void {
        lexer.code_point = lexer.nextCodepoint();

        lexer.line_number += @as(u32, @intFromBool(lexer.code_point == '\n'));
    }

    pub const Error = error{
        UTF8Fail,
        OutOfMemory,
        SyntaxError,
        UnexpectedSyntax,
        JSONStringsMustUseDoubleQuotes,
        ParserError,
    };

    fn parseNumericLiteralOrDot(lexer: *Lexer) !void {
        // Number or dot;
        const first = lexer.code_point;
        lexer.step();

        // Dot without a digit after it;
        if (first == '.' and (lexer.code_point < '0' or lexer.code_point > '9')) {

            // "."
            lexer.token = T.t_dot;
            return;
        }

        var underscoreCount: usize = 0;
        var lastUnderscoreEnd: usize = 0;
        var hasDotOrExponent = first == '.';
        var base: f32 = 0.0;

        var is_legacy_octal_literal = false;

        // Assume this is a number, but potentially change to a date/time later;
        lexer.token = T.t_numeric_literal;

        // Check for binary, octal, or hexadecimal literal;
        if (first == '0') {
            switch (lexer.code_point) {
                'b', 'B' => {
                    base = 2;
                },

                'o', 'O' => {
                    base = 8;
                },

                'x', 'X' => {
                    base = 16;
                },

                '0'...'7', '_' => {
                    base = 8;
                    is_legacy_octal_literal = true;
                },
                else => {},
            }
        }

        if (base != 0) {
            // Integer literal;
            var isFirst = true;
            var isInvalidLegacyOctalLiteral = false;
            lexer.number = 0;
            if (!is_legacy_octal_literal) {
                lexer.step();
            }

            integerLiteral: while (true) {
                switch (lexer.code_point) {
                    '_' => {
                        // Cannot have multiple underscores in a row;
                        if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                            try lexer.syntaxError();
                        }

                        // The first digit must exist;
                        if (isFirst or is_legacy_octal_literal) {
                            try lexer.syntaxError();
                        }

                        lastUnderscoreEnd = lexer.end;
                        underscoreCount += 1;
                    },

                    '0', '1' => {
                        lexer.number = lexer.number * base + float64(lexer.code_point - '0');
                    },

                    '2', '3', '4', '5', '6', '7' => {
                        if (base == 2) {
                            try lexer.syntaxError();
                        }
                        lexer.number = lexer.number * base + float64(lexer.code_point - '0');
                    },
                    '8', '9' => {
                        if (is_legacy_octal_literal) {
                            isInvalidLegacyOctalLiteral = true;
                        } else if (base < 10) {
                            try lexer.syntaxError();
                        }
                        lexer.number = lexer.number * base + float64(lexer.code_point - '0');
                    },
                    'A', 'B', 'C', 'D', 'E', 'F' => {
                        if (base != 16) {
                            try lexer.syntaxError();
                        }
                        lexer.number = lexer.number * base + float64(lexer.code_point + 10 - 'A');
                    },

                    'a', 'b', 'c', 'd', 'e', 'f' => {
                        if (base != 16) {
                            try lexer.syntaxError();
                        }
                        lexer.number = lexer.number * base + float64(lexer.code_point + 10 - 'a');
                    },
                    else => {
                        // The first digit must exist;
                        if (isFirst) {
                            try lexer.syntaxError();
                        }

                        break :integerLiteral;
                    },
                }

                lexer.step();
                isFirst = false;
            }

            const isBigIntegerLiteral = lexer.code_point == 'n' and !hasDotOrExponent;

            // Slow path: do we need to re-scan the input as text?
            if (isBigIntegerLiteral or isInvalidLegacyOctalLiteral) {
                const text = lexer.raw();

                // Can't use a leading zero for bigint literals;
                if (isBigIntegerLiteral and is_legacy_octal_literal) {
                    try lexer.syntaxError();
                }

                // Filter out underscores;
                if (underscoreCount > 0) {
                    var bytes = lexer.allocator.alloc(u8, text.len - underscoreCount) catch unreachable;
                    var i: usize = 0;
                    for (text) |char| {
                        if (char != '_') {
                            bytes[i] = char;
                            i += 1;
                        }
                    }
                }

                // Store bigints as text to avoid precision loss;
                if (isBigIntegerLiteral) {
                    lexer.identifier = text;
                } else if (isInvalidLegacyOctalLiteral) {
                    if (std.fmt.parseFloat(f64, text)) |num| {
                        lexer.number = num;
                    } else |_| {
                        try lexer.addSyntaxError(lexer.start, "Invalid number {s}", .{text});
                    }
                }
            }
        } else {
            // Floating-point literal;
            const isInvalidLegacyOctalLiteral = first == '0' and (lexer.code_point == '8' or lexer.code_point == '9');

            // Initial digits;
            while (true) {
                if (lexer.code_point < '0' or lexer.code_point > '9') {
                    switch (lexer.code_point) {
                        // '-' => {
                        //     if (lexer.raw().len == 5) {
                        //         // Is this possibly a datetime literal that begins with a 4 digit year?
                        //         lexer.step();
                        //         while (!lexer.has_newline_before) {
                        //             switch (lexer.code_point) {
                        //                 ',' => {
                        //                     lexer.string_literal_slice = lexer.raw();
                        //                     lexer.token = T.t_string_literal;
                        //                     break;
                        //                 },
                        //             }
                        //         }
                        //     }
                        // },
                        '_' => {},
                        else => break,
                    }
                    if (lexer.code_point != '_') {
                        break;
                    }

                    // Cannot have multiple underscores in a row;
                    if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                        try lexer.syntaxError();
                    }

                    // The specification forbids underscores in this case;
                    if (isInvalidLegacyOctalLiteral) {
                        try lexer.syntaxError();
                    }

                    lastUnderscoreEnd = lexer.end;
                    underscoreCount += 1;
                }
                lexer.step();
            }

            // Fractional digits;
            if (first != '.' and lexer.code_point == '.') {
                // An underscore must not come last;
                if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                    lexer.end -= 1;
                    try lexer.syntaxError();
                }

                hasDotOrExponent = true;
                lexer.step();
                if (lexer.code_point == '_') {
                    try lexer.syntaxError();
                }
                while (true) {
                    if (lexer.code_point < '0' or lexer.code_point > '9') {
                        if (lexer.code_point != '_') {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                            try lexer.syntaxError();
                        }

                        lastUnderscoreEnd = lexer.end;
                        underscoreCount += 1;
                    }
                    lexer.step();
                }
            }

            // Exponent;
            if (lexer.code_point == 'e' or lexer.code_point == 'E') {
                // An underscore must not come last;
                if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                    lexer.end -= 1;
                    try lexer.syntaxError();
                }

                hasDotOrExponent = true;
                lexer.step();
                if (lexer.code_point == '+' or lexer.code_point == '-') {
                    lexer.step();
                }
                if (lexer.code_point < '0' or lexer.code_point > '9') {
                    try lexer.syntaxError();
                }
                while (true) {
                    if (lexer.code_point < '0' or lexer.code_point > '9') {
                        if (lexer.code_point != '_') {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                            try lexer.syntaxError();
                        }

                        lastUnderscoreEnd = lexer.end;
                        underscoreCount += 1;
                    }
                    lexer.step();
                }
            }

            // Take a slice of the text to parse;
            var text = lexer.raw();

            // Filter out underscores;
            if (underscoreCount > 0) {
                var i: usize = 0;
                if (lexer.allocator.alloc(u8, text.len - underscoreCount)) |bytes| {
                    for (text) |char| {
                        if (char != '_') {
                            bytes[i] = char;
                            i += 1;
                        }
                    }
                    text = bytes;
                } else |_| {
                    try lexer.addSyntaxError(lexer.start, "Out of Memory Wah Wah Wah", .{});
                    return;
                }
            }

            if (!hasDotOrExponent and lexer.end - lexer.start < 10) {
                // Parse a 32-bit integer (very fast path);
                var number: u32 = 0;
                for (text) |c| {
                    number = number * 10 + @as(u32, @intCast(c - '0'));
                }
                lexer.number = @as(f64, @floatFromInt(number));
            } else {
                // Parse a double-precision floating-point number;
                if (std.fmt.parseFloat(f64, text)) |num| {
                    lexer.number = num;
                } else |_| {
                    try lexer.addSyntaxError(lexer.start, "Invalid number", .{});
                }
            }
        }

        // if it's a space, it might be a date timestamp
        if (isIdentifierPart(lexer.code_point) or lexer.code_point == ' ') {}
    }

    pub inline fn expect(self: *Lexer, comptime token: T) !void {
        if (self.token != token) {
            try self.expected(token);
        }

        try self.next();
    }

    pub inline fn expectAssignment(self: *Lexer) !void {
        switch (self.token) {
            .t_equal, .t_colon => {},
            else => {
                try self.expected(T.t_equal);
            },
        }

        try self.next();
    }

    pub fn next(lexer: *Lexer) !void {
        lexer.has_newline_before = lexer.end == 0;

        while (true) {
            lexer.start = lexer.end;
            lexer.token = T.t_end_of_file;

            switch (lexer.code_point) {
                -1 => {
                    lexer.token = T.t_end_of_file;
                },

                '\r', '\n', 0x2028, 0x2029 => {
                    lexer.step();
                    lexer.has_newline_before = true;
                    continue;
                },

                '\t', ' ' => {
                    lexer.step();
                    continue;
                },

                '[' => {
                    lexer.step();
                    lexer.token = T.t_open_bracket;
                    if (lexer.code_point == '[' and lexer.allow_double_bracket) {
                        lexer.step();
                        lexer.token = T.t_open_bracket_double;
                        return;
                    }

                    if (lexer.code_point == ']') {
                        lexer.step();
                        lexer.token = T.t_empty_array;
                    }
                },
                ']' => {
                    lexer.step();
                    lexer.token = T.t_close_bracket;

                    if (lexer.code_point == ']' and lexer.allow_double_bracket) {
                        lexer.step();
                        lexer.token = T.t_close_bracket_double;
                    }
                },
                '+' => {
                    lexer.step();
                    lexer.token = T.t_plus;
                },
                '-' => {
                    lexer.step();
                    lexer.token = T.t_minus;
                },

                '{' => {
                    lexer.step();
                    lexer.token = T.t_open_brace;
                },
                '}' => {
                    lexer.step();
                    lexer.token = T.t_close_brace;
                },

                '=' => {
                    lexer.step();
                    lexer.token = T.t_equal;
                },
                ':' => {
                    lexer.step();
                    lexer.token = T.t_colon;
                },
                ',' => {
                    lexer.step();
                    lexer.token = T.t_comma;
                },
                ';' => {
                    if (lexer.has_newline_before) {
                        lexer.step();

                        singleLineComment: while (true) {
                            lexer.step();
                            switch (lexer.code_point) {
                                '\r', '\n', 0x2028, 0x2029 => {
                                    break :singleLineComment;
                                },
                                -1 => {
                                    break :singleLineComment;
                                },
                                else => {},
                            }
                        }
                        continue;
                    }

                    try lexer.addDefaultError("Unexpected semicolon");
                },
                '#' => {
                    lexer.step();

                    singleLineComment: while (true) {
                        lexer.step();
                        switch (lexer.code_point) {
                            '\r', '\n', 0x2028, 0x2029 => {
                                break :singleLineComment;
                            },
                            -1 => {
                                break :singleLineComment;
                            },
                            else => {},
                        }
                    }
                    continue;
                },

                // unescaped string
                '\'' => {
                    lexer.step();
                    lexer.string_literal_is_ascii = true;
                    const start = lexer.end;
                    var is_multiline_string_literal = false;

                    if (lexer.code_point == '\'') {
                        lexer.step();
                        // it's a multiline string literal
                        if (lexer.code_point == '\'') {
                            lexer.step();
                            is_multiline_string_literal = true;
                        } else {
                            // it's an empty string
                            lexer.token = T.t_string_literal;
                            lexer.string_literal_slice = lexer.source.contents[start..start];
                            return;
                        }
                    }

                    if (is_multiline_string_literal) {
                        while (true) {
                            switch (lexer.code_point) {
                                -1 => {
                                    try lexer.addDefaultError("Unterminated string literal");
                                },
                                '\'' => {
                                    const end = lexer.end;
                                    lexer.step();
                                    if (lexer.code_point != '\'') continue;
                                    lexer.step();
                                    if (lexer.code_point != '\'') continue;
                                    lexer.step();
                                    lexer.token = T.t_string_literal;
                                    lexer.string_literal_slice = lexer.source.contents[start + 2 .. end];
                                    return;
                                },
                                else => {},
                            }
                            lexer.step();
                        }
                    } else {
                        while (true) {
                            switch (lexer.code_point) {
                                '\r', '\n', 0x2028, 0x2029 => {
                                    try lexer.addDefaultError("Unterminated string literal (single-line)");
                                },
                                -1 => {
                                    try lexer.addDefaultError("Unterminated string literal");
                                },
                                '\'' => {
                                    lexer.step();
                                    lexer.token = T.t_string_literal;
                                    lexer.string_literal_slice = lexer.source.contents[start .. lexer.end - 1];
                                    return;
                                },
                                else => {},
                            }
                            lexer.step();
                        }
                    }
                },
                '"' => {
                    lexer.step();
                    var needs_slow_pass = false;
                    const start = lexer.end;
                    var is_multiline_string_literal = false;
                    lexer.string_literal_is_ascii = true;

                    if (lexer.code_point == '"') {
                        lexer.step();
                        // it's a multiline basic string
                        if (lexer.code_point == '"') {
                            lexer.step();
                            is_multiline_string_literal = true;
                        } else {
                            // it's an empty string
                            lexer.token = T.t_string_literal;
                            lexer.string_literal_slice = lexer.source.contents[start..start];
                            return;
                        }
                    }

                    if (is_multiline_string_literal) {
                        while (true) {
                            switch (lexer.code_point) {
                                -1 => {
                                    try lexer.addDefaultError("Unterminated basic string");
                                },
                                '\\' => {
                                    lexer.step();
                                    needs_slow_pass = true;
                                    if (lexer.code_point == '"') {
                                        lexer.step();
                                        continue;
                                    }
                                },
                                '"' => {
                                    const end = lexer.end;
                                    lexer.step();
                                    if (lexer.code_point != '"') continue;
                                    lexer.step();
                                    if (lexer.code_point != '"') continue;
                                    lexer.step();

                                    lexer.token = T.t_string_literal;
                                    lexer.string_literal_slice = lexer.source.contents[start + 2 .. end];
                                    if (needs_slow_pass) break;
                                    return;
                                },
                                else => {},
                            }
                            lexer.step();
                        }
                    } else {
                        while (true) {
                            switch (lexer.code_point) {
                                '\r', '\n', 0x2028, 0x2029 => {
                                    try lexer.addDefaultError("Unterminated basic string (single-line)");
                                },
                                -1 => {
                                    try lexer.addDefaultError("Unterminated basic string");
                                },
                                '\\' => {
                                    lexer.step();
                                    needs_slow_pass = true;
                                    if (lexer.code_point == '"') {
                                        lexer.step();
                                        continue;
                                    }
                                },
                                '"' => {
                                    lexer.step();

                                    lexer.token = T.t_string_literal;
                                    lexer.string_literal_slice = lexer.source.contents[start .. lexer.end - 1];
                                    if (needs_slow_pass) break;
                                    return;
                                },
                                else => {},
                            }
                            lexer.step();
                        }
                    }

                    lexer.start = start;
                    if (needs_slow_pass) {
                        const text = lexer.string_literal_slice;
                        var array_list = try std.ArrayList(u8).initCapacity(lexer.allocator, text.len);
                        if (is_multiline_string_literal) {
                            try lexer.decodeEscapeSequences(start, text, true, @TypeOf(array_list), &array_list);
                        } else {
                            try lexer.decodeEscapeSequences(start, text, false, @TypeOf(array_list), &array_list);
                        }
                        lexer.string_literal_slice = try array_list.toOwnedSlice();
                        lexer.string_literal_is_ascii = false;
                    }

                    lexer.token = T.t_string_literal;
                },

                '.', '0'...'9' => {
                    try lexer.parseNumericLiteralOrDot();
                },

                '@', 'a'...'z', 'A'...'Z', '$', '_' => {
                    lexer.step();
                    while (isIdentifierPart(lexer.code_point)) {
                        lexer.step();
                    }
                    lexer.identifier = lexer.raw();
                    lexer.token = switch (lexer.identifier.len) {
                        4 => if (strings.eqlComptimeIgnoreLen(lexer.identifier, "true")) T.t_true else T.t_identifier,
                        5 => if (strings.eqlComptimeIgnoreLen(lexer.identifier, "false")) T.t_false else T.t_identifier,
                        else => T.t_identifier,
                    };
                },

                else => try lexer.unexpected(),
            }
            return;
        }
    }

    fn decodeEscapeSequences(lexer: *Lexer, start: usize, text: string, comptime allow_multiline: bool, comptime BufType: type, buf_: *BufType) !void {
        var buf = buf_.*;
        defer buf_.* = buf;

        const iterator = strings.CodepointIterator{ .bytes = text, .i = 0 };
        var iter = strings.CodepointIterator.Cursor{};
        while (iterator.next(&iter)) {
            const width = iter.width;
            switch (iter.c) {
                '\r' => {

                    // Convert '\r\n' into '\n'
                    if (iter.i < text.len and text[iter.i] == '\n') {
                        iter.i += 1;
                    }

                    // Convert '\r' into '\n'
                    buf.append('\n') catch unreachable;
                    continue;
                },

                '\\' => {
                    _ = iterator.next(&iter) or return;

                    const c2 = iter.c;

                    const width2 = iter.width;
                    switch (c2) {
                        // https://mathiasbynens.be/notes/javascript-escapes#single
                        'b' => {
                            buf.append(8) catch unreachable;
                            continue;
                        },
                        'f' => {
                            buf.append(9) catch unreachable;
                            continue;
                        },
                        'n' => {
                            buf.append(10) catch unreachable;
                            continue;
                        },
                        'v' => {
                            // Vertical tab is invalid JSON
                            // We're going to allow it.
                            // if (comptime is_json) {
                            //     lexer.end = start + iter.i - width2;
                            //     try lexer.syntaxError();
                            // }
                            buf.append(11) catch unreachable;
                            continue;
                        },
                        't' => {
                            buf.append(12) catch unreachable;
                            continue;
                        },
                        'r' => {
                            buf.append(13) catch unreachable;
                            continue;
                        },

                        // legacy octal literals
                        '0'...'7' => {
                            const octal_start = (iter.i + width2) - 2;

                            // 1-3 digit octal
                            var is_bad = false;
                            var value: i64 = c2 - '0';
                            var restore = iter;

                            _ = iterator.next(&iter) or {
                                if (value == 0) {
                                    try buf.append(0);
                                    return;
                                }

                                try lexer.syntaxError();
                                return;
                            };

                            const c3: CodePoint = iter.c;

                            switch (c3) {
                                '0'...'7' => {
                                    value = value * 8 + c3 - '0';
                                    restore = iter;
                                    _ = iterator.next(&iter) or return lexer.syntaxError();

                                    const c4 = iter.c;
                                    switch (c4) {
                                        '0'...'7' => {
                                            const temp = value * 8 + c4 - '0';
                                            if (temp < 256) {
                                                value = temp;
                                            } else {
                                                iter = restore;
                                            }
                                        },
                                        '8', '9' => {
                                            is_bad = true;
                                        },
                                        else => {
                                            iter = restore;
                                        },
                                    }
                                },
                                '8', '9' => {
                                    is_bad = true;
                                },
                                else => {
                                    iter = restore;
                                },
                            }

                            iter.c = @as(i32, @intCast(value));
                            if (is_bad) {
                                lexer.addRangeError(
                                    logger.Range{ .loc = .{ .start = @as(i32, @intCast(octal_start)) }, .len = @as(i32, @intCast(iter.i - octal_start)) },
                                    "Invalid legacy octal literal",
                                    .{},
                                    false,
                                ) catch unreachable;
                            }
                        },
                        '8', '9' => {
                            iter.c = c2;
                        },
                        // 2-digit hexadecimal
                        'x' => {
                            if (comptime allow_multiline) {
                                lexer.end = start + iter.i - width2;
                                try lexer.syntaxError();
                            }

                            var value: CodePoint = 0;
                            var c3: CodePoint = 0;
                            var width3: u3 = 0;

                            _ = iterator.next(&iter) or return lexer.syntaxError();
                            c3 = iter.c;
                            width3 = iter.width;
                            switch (c3) {
                                '0'...'9' => {
                                    value = value * 16 | (c3 - '0');
                                },
                                'a'...'f' => {
                                    value = value * 16 | (c3 + 10 - 'a');
                                },
                                'A'...'F' => {
                                    value = value * 16 | (c3 + 10 - 'A');
                                },
                                else => {
                                    lexer.end = start + iter.i - width3;
                                    return lexer.syntaxError();
                                },
                            }

                            _ = iterator.next(&iter) or return lexer.syntaxError();
                            c3 = iter.c;
                            width3 = iter.width;
                            switch (c3) {
                                '0'...'9' => {
                                    value = value * 16 | (c3 - '0');
                                },
                                'a'...'f' => {
                                    value = value * 16 | (c3 + 10 - 'a');
                                },
                                'A'...'F' => {
                                    value = value * 16 | (c3 + 10 - 'A');
                                },
                                else => {
                                    lexer.end = start + iter.i - width3;
                                    return lexer.syntaxError();
                                },
                            }

                            iter.c = value;
                        },
                        'u' => {
                            // We're going to make this an i64 so we don't risk integer overflows
                            // when people do weird things
                            var value: i64 = 0;

                            _ = iterator.next(&iter) or return lexer.syntaxError();
                            var c3 = iter.c;
                            var width3 = iter.width;

                            // variable-length
                            if (c3 == '{') {
                                const hex_start = iter.i - width - width2 - width3;
                                var is_first = true;
                                var is_out_of_range = false;
                                variableLength: while (true) {
                                    _ = iterator.next(&iter) or break :variableLength;
                                    c3 = iter.c;

                                    switch (c3) {
                                        '0'...'9' => {
                                            value = value * 16 | (c3 - '0');
                                        },
                                        'a'...'f' => {
                                            value = value * 16 | (c3 + 10 - 'a');
                                        },
                                        'A'...'F' => {
                                            value = value * 16 | (c3 + 10 - 'A');
                                        },
                                        '}' => {
                                            if (is_first) {
                                                lexer.end = start + iter.i - width3;
                                                return lexer.syntaxError();
                                            }
                                            break :variableLength;
                                        },
                                        else => {
                                            lexer.end = start + iter.i - width3;
                                            return lexer.syntaxError();
                                        },
                                    }

                                    // '\U0010FFFF
                                    // copied from golang utf8.MaxRune
                                    if (value > 1114111) {
                                        is_out_of_range = true;
                                    }
                                    is_first = false;
                                }

                                if (is_out_of_range) {
                                    try lexer.addRangeError(
                                        .{ .loc = .{ .start = @as(i32, @intCast(start + hex_start)) }, .len = @as(i32, @intCast((iter.i - hex_start))) },
                                        "Unicode escape sequence is out of range",
                                        .{},
                                        true,
                                    );
                                    return;
                                }

                                // fixed-length
                            } else {
                                // Fixed-length
                                // comptime var j: usize = 0;
                                var j: usize = 0;
                                while (j < 4) : (j += 1) {
                                    switch (c3) {
                                        '0'...'9' => {
                                            value = value * 16 | (c3 - '0');
                                        },
                                        'a'...'f' => {
                                            value = value * 16 | (c3 + 10 - 'a');
                                        },
                                        'A'...'F' => {
                                            value = value * 16 | (c3 + 10 - 'A');
                                        },
                                        else => {
                                            lexer.end = start + iter.i - width3;
                                            return lexer.syntaxError();
                                        },
                                    }

                                    if (j < 3) {
                                        _ = iterator.next(&iter) or return lexer.syntaxError();
                                        c3 = iter.c;

                                        width3 = iter.width;
                                    }
                                }
                            }

                            iter.c = @as(CodePoint, @truncate(value));
                        },
                        '\r' => {
                            if (comptime !allow_multiline) {
                                lexer.end = start + iter.i - width2;
                                try lexer.addDefaultError("Unexpected end of line");
                            }

                            // Ignore line continuations. A line continuation is not an escaped newline.
                            if (iter.i < text.len and text[iter.i + 1] == '\n') {
                                // Make sure Windows CRLF counts as a single newline
                                iter.i += 1;
                            }
                            continue;
                        },
                        '\n', 0x2028, 0x2029 => {
                            // Ignore line continuations. A line continuation is not an escaped newline.
                            if (comptime !allow_multiline) {
                                lexer.end = start + iter.i - width2;
                                try lexer.addDefaultError("Unexpected end of line");
                            }
                            continue;
                        },
                        else => {
                            iter.c = c2;
                        },
                    }
                },
                else => {},
            }

            switch (iter.c) {
                -1 => return try lexer.addDefaultError("Unexpected end of file"),
                0...127 => {
                    buf.append(@as(u8, @intCast(iter.c))) catch unreachable;
                },
                else => {
                    var part: [4]u8 = undefined;
                    const len = strings.encodeWTF8Rune(&part, iter.c);
                    try buf.appendSlice(part[0..len]);
                },
            }
        }
    }

    pub fn expected(self: *Lexer, token: T) !void {
        try self.expectedString(@as(string, @tagName(token)));
    }

    pub fn unexpected(lexer: *Lexer) !void {
        const found = finder: {
            lexer.start = @min(lexer.start, lexer.end);

            if (lexer.start == lexer.source.contents.len) {
                break :finder "end of file";
            } else {
                break :finder lexer.raw();
            }
        };

        try lexer.addRangeError(lexer.range(), "Unexpected {s}", .{found}, true);
    }

    pub fn expectedString(self: *Lexer, text: string) !void {
        const found = finder: {
            if (self.source.contents.len != self.start) {
                break :finder self.raw();
            } else {
                break :finder "end of file";
            }
        };

        try self.addRangeError(self.range(), "Expected {s} but found {s}", .{ text, found }, true);
    }

    pub fn range(self: *Lexer) logger.Range {
        return logger.Range{
            .loc = logger.usize2Loc(self.start),
            .len = std.math.lossyCast(i32, self.end - self.start),
        };
    }

    pub fn init(log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator) !Lexer {
        var lex = Lexer{
            .log = log,
            .source = source,
            .prev_error_loc = logger.Loc.Empty,
            .allocator = allocator,
        };
        lex.step();
        try lex.next();

        return lex;
    }

    pub inline fn toString(lexer: *Lexer, loc_: logger.Loc) js_ast.Expr {
        if (lexer.string_literal_is_ascii) {
            return js_ast.Expr.init(js_ast.E.String, js_ast.E.String{ .data = lexer.string_literal_slice }, loc_);
        }

        return js_ast.Expr.init(
            js_ast.E.UTF8String,
            .{ .data = lexer.string_literal_slice },
            loc_,
        );
    }

    pub fn raw(self: *Lexer) []const u8 {
        return self.source.contents[self.start..self.end];
    }
};

pub fn isIdentifierPart(code_point: CodePoint) bool {
    return switch (code_point) {
        '0'...'9',
        'a'...'z',
        'A'...'Z',
        '$',
        '_',
        '-',
        ':',
        => true,
        else => false,
    };
}

pub fn isLatin1Identifier(comptime Buffer: type, name: Buffer) bool {
    if (name.len == 0) return false;

    switch (name[0]) {
        'a'...'z',
        'A'...'Z',
        '$',
        '1'...'9',
        '_',
        '-',
        => {},
        else => return false,
    }

    if (name.len > 0) {
        for (name[1..]) |c| {
            switch (c) {
                '0'...'9',
                'a'...'z',
                'A'...'Z',
                '$',
                '_',
                '-',
                => {},
                else => return false,
            }
        }
    }

    return true;
}

inline fn float64(num: anytype) f64 {
    return @as(f64, @floatFromInt(num));
}
