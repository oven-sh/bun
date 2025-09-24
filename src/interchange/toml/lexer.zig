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

    t_date,
    t_time,

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
    date: string = "",
    time: string = "",
    prev_error_loc: logger.Loc = logger.Loc.Empty,
    string_literal_slice: string = "",
    string_literal_is_ascii: bool = true,
    line_number: u32 = 0,
    token: T = T.t_end_of_file,
    allow_double_bracket: bool = true,

    has_newline_before: bool = false,

    should_redact_logs: bool,

    pub inline fn loc(self: *const Lexer) logger.Loc {
        return logger.usize2Loc(self.start);
    }

    pub fn syntaxError(self: *Lexer) !void {
        @branchHint(.cold);

        // Only add this if there is not already an error.
        // It is possible that there is a more descriptive error already emitted.
        if (!self.log.hasErrors())
            self.addError(self.start, "Syntax Error", .{});

        return Error.SyntaxError;
    }

    pub fn invalidValueError(self: *Lexer, kind: Error, comptime format: []const u8, args: anytype) !void {
        @branchHint(.cold);

        // Only add this if there is not already an error.
        // It is possible that there is a more descriptive error already emitted.
        if (!self.log.hasErrors())
            try self.addRangeError(self.range(), format, args);

        return kind;
    }

    pub fn addError(self: *Lexer, _loc: usize, comptime format: []const u8, args: anytype) void {
        @branchHint(.cold);

        var __loc = logger.usize2Loc(_loc);
        if (__loc.eql(self.prev_error_loc)) {
            return;
        }

        self.log.addErrorFmtOpts(
            self.log.msgs.allocator,
            format,
            args,
            .{
                .source = &self.source,
                .loc = __loc,
                .redact_sensitive_information = self.should_redact_logs,
            },
        ) catch unreachable;
        self.prev_error_loc = __loc;
    }

    pub fn addDefaultError(self: *Lexer, msg: []const u8) !void {
        @branchHint(.cold);

        self.addError(self.start, "{s}", .{msg});
        return Error.SyntaxError;
    }

    pub fn addSyntaxError(self: *Lexer, _loc: usize, comptime fmt: []const u8, args: anytype) !void {
        @branchHint(.cold);
        self.addError(_loc, fmt, args);
        return Error.SyntaxError;
    }

    pub fn addRangeError(self: *Lexer, r: logger.Range, comptime format: []const u8, args: anytype) !void {
        @branchHint(.cold);

        if (self.prev_error_loc.eql(r.loc)) {
            return;
        }

        const errorMessage = std.fmt.allocPrint(self.log.msgs.allocator, format, args) catch unreachable;
        try self.log.addErrorOpts(errorMessage, .{
            .source = &self.source,
            .loc = r.loc,
            .len = r.len,
            .redact_sensitive_information = self.should_redact_logs,
        });
        self.prev_error_loc = r.loc;
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
        if (it.current >= it.source.contents.len) {
            return "";
        }
        const cp_len = strings.wtf8ByteSequenceLengthWithInvalid(it.source.contents.ptr[it.current]);
        return if (!(cp_len + it.current > it.source.contents.len)) it.source.contents[it.current .. cp_len + it.current] else "";
    }

    inline fn nextCodepoint(it: *Lexer) CodePoint {
        if (it.current >= it.source.contents.len) {
            it.end = it.source.contents.len;
            return -1;
        }
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
        InvalidDate,
        InvalidTime,
    };

    fn parseNumericLiteralOrDot(lexer: *Lexer) !void {
        // Number or dot;
        const first = lexer.code_point;
        lexer.step();

        // Dot without a digit after it;
        if (first == '.' and !isDigit(lexer.code_point)) {

            // "."
            lexer.token = T.t_dot;
            return;
        }

        var underscoreCount: usize = 0;
        var lastUnderscoreEnd: usize = 0;
        var hasDotOrExponent = first == '.';
        var base: f32 = 0.0;

        var is_legacy_octal_literal = false;

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
                if (!isDigit(lexer.code_point)) {
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
                    if (!isDigit(lexer.code_point)) {
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
                if (!isDigit(lexer.code_point)) {
                    try lexer.syntaxError();
                }
                while (true) {
                    if (!isDigit(lexer.code_point)) {
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
                    if (!lexer.has_newline_before) {
                        try lexer.addDefaultError("Unexpected semicolon");
                    }

                    lexer.discardTilEndOfLine();
                    continue;
                },
                '#' => {
                    lexer.discardTilEndOfLine();
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
                    const start_idx = lexer.current - 1;
                    const content_left = lexer.source.contents.len - start_idx;
                    const min_time_length = 8;
                    const min_date_length = 10;
                    if (content_left > min_time_length) {
                        if (content_left > min_date_length) {
                            // If the 5th code point is '-' and it's not preceeded by an E/e,
                            // it must be a date or an error.
                            if (isMaybeDate(lexer.source.contents[start_idx .. start_idx + 5])) {
                                return parseDateTime(lexer);
                            }
                        }

                        // If the 3rd code point is ':', it must be a time or an error.
                        if (lexer.source.contents[start_idx + 2] == ':') {
                            return parseTime(lexer);
                        }
                    }

                    return lexer.parseNumericLiteralOrDot();
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

    pub fn decodeEscapeSequences(lexer: *Lexer, start: usize, text: string, comptime allow_multiline: bool, comptime BufType: type, buf_: *BufType) !void {
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
                            var width3: @TypeOf(iter.width) = 0;

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

    pub fn discardTilEndOfLine(lexer: *Lexer) void {
        while (true): (lexer.step()) {
            switch (lexer.code_point) {
                '\r', '\n', 0x2028, 0x2029, -1 => {
                    return;
                },
                else => {},
            }
        }
    }

    /// After parsing the necessary 3 digits of fractional precision, call this function to ignore any remaining
    /// consecutive numeric digits.
    ///
    /// When this function exits, `lexer.code_point` will be on the first non-numeric code-point following the
    /// fraction.
    ///
    /// From the TOML v1.0.0 spec:
    /// > Millisecond precision is required. Further precision of fractional seconds is implementation-specific.
    /// > If the value contains greater precision than the implementation can support, the additional precision
    /// > must be truncated, not rounded.
    ///
    /// _NOTE: NodeJS stops at ms precision._
    pub fn drainTimeFraction(lexer: *Lexer) void {
        while (true): (lexer.step()) {
            switch (lexer.code_point) {
                '0'...'9' => {},
                else => break,
            }
        }
    }

    /// Parse a standalone time.
    ///
    /// _NOTE: While datetimes can contain time, the logic is much simpler when the two functions remain separate._
    pub fn parseTime(lexer: *Lexer) !void {
        // Expected number of digits per component.
        var hour: u8 = 2;
        var minute: u8 = 2;
        var second: u8 = 2;
        var fractional: u8 = 3;

        // Used for validation.
        var hour_found: u8 = 0;
        var minute_found: u8 = 0;
        var second_found: u8 = 0;

        // State machine variables.
        var expect_numeric: bool = true;
        var expect_colon: bool = false;
        var expect_maybe_dot: bool = false;
        var expect_fractional: bool = false;
        var maybe_complete: bool = false;
        var fractional_end: ?usize = null;

        var skip_stepping = true;
        while (true) {
            if (!skip_stepping) {
                lexer.step();
            }
            skip_stepping = false;
            switch (lexer.code_point) {
                '0'...'9' => {
                    if (!expect_numeric) {
                        try lexer.invalidValueError(Error.InvalidTime, "Got an unexpected number while parsing time.", .{});
                    }
                    if (hour > 0) {
                        hour -= 1;
                        hour_found += shiftLeftBase10(u8, lexer.code_point, hour);
                        if (hour == 0) {
                            if (hour_found > 23) {
                                try lexer.invalidValueError(Error.InvalidTime, "Expected hour to be in the range [00,23].", .{});
                            }
                            expect_numeric = false;
                            expect_colon = true;
                        }
                        continue;
                    }
                    if (minute > 0) {
                        minute -= 1;
                        minute_found += shiftLeftBase10(u8, lexer.code_point, minute);
                        if (minute == 0) {
                            if (minute_found > 59) {
                                try lexer.invalidValueError(Error.InvalidTime, "Expected minutes to be in the range [00,59].", .{});
                            }
                            expect_numeric = false;
                            expect_colon = true;
                        }
                        continue;
                    }
                    if (second > 0) {
                        second -= 1;
                        second_found += shiftLeftBase10(u8, lexer.code_point, second);
                        if (second == 0) {
                            // RFC3339 calls out leap second rules, but at this layer, we should allow flexibility for
                            // applications to decide the level of strictness they require.
                            if (second_found > 60) {
                                try lexer.invalidValueError(Error.InvalidTime, "Expected seconds to be in the range [00,60].", .{});
                            }
                            expect_numeric = false;
                            expect_maybe_dot = true;
                            maybe_complete = true;
                        }
                        continue;
                    }
                    if (expect_fractional) {
                        if (fractional > 0) {
                            fractional -= 1;
                            maybe_complete = true;
                            fractional_end = lexer.current;
                            continue;
                        }
                        // Truncate any digits beyond ms.
                        fractional_end = lexer.current - 1;
                        lexer.drainTimeFraction();
                        // drainTimeFraction() stops on the first non-digit. Don't step again this iteration.
                        skip_stepping = true;
                        expect_fractional = false;
                        continue;
                    }
                    // There's a logic error if we hit this spot.
                    unreachable;
                },
                '.' => {
                    if (!expect_maybe_dot) {
                        try lexer.invalidValueError(Error.InvalidTime, "Got an unexpected '.' while parsing time.", .{});
                    }
                    expect_fractional = true;
                    expect_numeric = true;
                    maybe_complete = false;
                },
                ':' => {
                    if (!expect_colon) {
                        try lexer.invalidValueError(Error.InvalidTime, "Got an unexpected ':' while parsing time.", .{});
                    }
                    expect_colon = false;
                    expect_numeric = true;
                },
                else => break,
            }
        }

        if (!maybe_complete) {
            try lexer.invalidValueError(Error.InvalidTime, "Expected more characters when parsing time.", .{});
        }

        if (fractional_end) |fend| {
            lexer.time = lexer.source.contents[lexer.start..fend];
        } else {
            lexer.time = lexer.source.contents[lexer.start..lexer.end];
        }
        lexer.token = T.t_time;
    }

    /// The TOML v1.0.0 spec allows three possible date configurations:
    /// * local date
    /// * local date-time
    /// * offset date-time
    pub fn parseDateTime(lexer: *Lexer) !void {
        // Expected numer of digits per component.
        var year: u8 = 4;
        var month: u8 = 2;
        var mday: u8 = 2;
        var hour: u8 = 2;
        var minute: u8 = 2;
        var second: u8 = 2;
        var offset_hour: u8 = 2;
        var offset_minute: u8 = 2;
        var fractional: u8 = 3;

        // Used for validation.
        var year_found: u16 = 0;
        var month_found: u8 = 0;
        var day_found: u8 = 0;
        var hour_found: u8 = 0;
        var minute_found: u8 = 0;
        var second_found: u8 = 0;
        var offset_hour_found: u8 = 0;
        var offset_minute_found: u8 = 0;

        // State machine variables
        var expect_maybe_numeric = true;
        var expect_colon = false;
        var expect_dash = false;
        var expect_maybe_dot = false;
        var expect_maybe_offset = false;
        var expect_maybe_space_or_t = false;
        var expect_fractional = false;
        var maybe_complete = false;

        // Accounting for variable length fractional times with trunction, we might need to drop some chars.
        var fractional_end: ?usize = null;
        var offset_start: ?usize = null;

        // Iterate over a date/datetime until complete or an invalid format is detected.
        var skip_stepping = true;
        while (true) {
            if (!skip_stepping) {
                lexer.step();
            }
            skip_stepping = false;

            switch (lexer.code_point) {
                '0'...'9' => {
                    if (!expect_maybe_numeric) {
                        try lexer.invalidValueError(Error.InvalidDate, "Got an unexpected numeric digit while parsing datetime.", .{});
                    }

                    // date
                    if (year > 0) {
                        year -= 1;
                        year_found += shiftLeftBase10(u16, lexer.code_point, year);

                        if (year == 0) {
                            expect_maybe_numeric = false;
                            expect_dash = true;
                        }
                        continue;
                    }

                    if (month > 0) {
                        month -= 1;
                        month_found += shiftLeftBase10(u8, lexer.code_point, month);

                        if (month == 0) {
                            expect_maybe_numeric = false;
                            expect_dash = true;
                        }
                        continue;
                    }

                    if (mday > 0) {
                        mday -= 1;
                        day_found += shiftLeftBase10(u8, lexer.code_point, mday);

                        if (mday == 0) {
                            if (!isValidDate(year_found, month_found, day_found)) {
                                try lexer.invalidValueError(Error.InvalidDate, "Invalid Date: {d:0>4}-{d:0>2}-{d:0>2}", .{ year_found, month_found, day_found });
                            }
                            expect_maybe_numeric = false;
                            expect_maybe_space_or_t = true;
                            maybe_complete = true;
                        }
                        continue;
                    }

                    // time
                    if (hour > 0) {
                        hour -= 1;
                        hour_found += shiftLeftBase10(u8, lexer.code_point, hour);
                        if (hour == 0) {
                            if (hour_found > 23) {
                                try lexer.invalidValueError(Error.InvalidDate, "Expected hour to be in the range [00,23].", .{});
                            }
                            expect_maybe_numeric = false;
                            expect_colon = true;
                        }
                        continue;
                    }

                    if (minute > 0) {
                        minute -= 1;
                        minute_found += shiftLeftBase10(u8, lexer.code_point, minute);
                        if (minute == 0) {
                            if (minute_found > 59) {
                                try lexer.invalidValueError(Error.InvalidDate, "Expected minutes to be in the range [00,59].", .{});
                            }
                            expect_maybe_numeric = false;
                            expect_colon = true;
                        }
                        continue;
                    }

                    if (second > 0) {
                        second -= 1;
                        second_found += shiftLeftBase10(u8, lexer.code_point, second);
                        if (second == 0) {
                            // Allow leap second 60 (RFC 3339 flexibility)
                            if (second_found > 60) {
                                try lexer.invalidValueError(Error.InvalidDate, "Expected seconds to be in the range [00,60].", .{});
                            }
                            expect_maybe_numeric = true;
                            expect_maybe_dot = true;
                            expect_maybe_offset = true;
                            maybe_complete = true;
                        }
                        continue;
                    }

                    if (expect_fractional) {
                        if (fractional > 0) {
                            fractional -= 1;
                            maybe_complete = true;
                            continue;
                        }

                        // Truncate any digits beyond ms, while still accounting for a possible offset.
                        //
                        // The current digit must be the 4th digit after the decimal if we're here,
                        // so the fractional_end is the position before this one.
                        fractional_end = lexer.current - 1;
                        lexer.drainTimeFraction();
                        skip_stepping = true;
                        expect_fractional = false;
                        expect_maybe_offset = true;
                        continue;
                    }

                    if (expect_maybe_offset) {
                        if (offset_hour == 2) {
                            // Track the offset start, in the event a time contains a fractional portion that must be
                            // truncated. The offset starts at the separator before the number, hence '- 2'.
                            offset_start = lexer.current - 2;
                        }

                        if (offset_hour > 0) {
                            offset_hour -= 1;
                            offset_hour_found += shiftLeftBase10(u8, lexer.code_point, offset_hour);
                            if (offset_hour == 0) {
                                if (offset_hour_found > 23) {
                                    try lexer.invalidValueError(Error.InvalidDate, "Expected offset hour to be in the range [00,23].", .{});
                                }
                                expect_maybe_numeric = false;
                                expect_colon = true;
                            }
                            continue;
                        }

                        if (offset_minute > 0) {
                            offset_minute -= 1;
                            offset_minute_found += shiftLeftBase10(u8, lexer.code_point, offset_minute);
                            if (offset_minute == 0) {
                                if (offset_minute_found > 59) {
                                    try lexer.invalidValueError(Error.InvalidDate, "Expected offset minutes to be in the range [00,59].", .{});
                                }
                                maybe_complete = true;
                            }
                            continue;
                        }
                    }

                    // There's a logic error if we hit this spot.
                    unreachable;
                },
                '-' => {
                    // '-' is overloaded as a date separator as well as an offset +/-
                    if (!expect_dash and !expect_maybe_offset) {
                        try lexer.invalidValueError(Error.InvalidDate, "Got an unexpected '-' while parsing datetime.", .{});
                    }
                    expect_dash = false;
                    expect_maybe_numeric = true;
                    expect_fractional = false;
                    maybe_complete = false;

                    // Offsets must be preceeded by a complete time.
                    expect_maybe_offset = second == 0;
                },
                '+' => {
                    if (!expect_maybe_offset) {
                        try lexer.invalidValueError(Error.InvalidDate, "Got an unexpected '+' while parsing datetime.", .{});
                    }
                    expect_maybe_offset = true;
                    expect_maybe_numeric = true;
                    maybe_complete = false;
                },
                '.' => {
                    if (!expect_maybe_dot) {
                        try lexer.invalidValueError(Error.InvalidDate, "Got an unexpected '.' while parsing datetime.", .{});
                    }
                    expect_fractional = true;
                    expect_maybe_numeric = true;
                    maybe_complete = false;
                },
                'z', 'Z' => {
                    if (!expect_maybe_offset and !expect_maybe_dot) {
                        try lexer.invalidValueError(Error.InvalidDate, "Got an unexpected 'Z' while parsing datetime.", .{});
                    }

                    if (offset_hour < 2) {
                        try lexer.invalidValueError(Error.InvalidDate, "Cannot specify both 'Z' (no offset) and a specific offset", .{});
                    }
                    offset_start = lexer.current - 1;
                    expect_maybe_offset = false;
                    expect_maybe_numeric = false;
                    maybe_complete = true;
                },
                ':' => {
                    if (!expect_colon) {
                        try lexer.invalidValueError(Error.InvalidDate, "Got an unexpected ':' while parsing datetime.", .{});
                    }
                    expect_colon = false;
                    expect_maybe_numeric = true;
                },
                ' ', 't', 'T' => {
                    if (!expect_maybe_space_or_t and maybe_complete) {
                        break;
                    }
                    if (!expect_maybe_space_or_t and !maybe_complete) {
                        try lexer.invalidValueError(Error.InvalidDate, "Got an unexpected ' ' or 'T' while parsing datetime.", .{});
                    }
                    expect_maybe_space_or_t = false;
                    expect_maybe_numeric = true;
                },
                else => break,
            }
        }

        if (!maybe_complete) {
            try lexer.invalidValueError(Error.InvalidDate, "Datetime doesn't have enough characters.", .{});
        }

        if (fractional_end) |fend| {
            if (offset_start) |ostart| {
                const first = fend - lexer.start;
                const needed = first + lexer.end - ostart;
                var buf = lexer.allocator.alloc(u8, needed) catch {
                    try lexer.addSyntaxError(lexer.start, "Out of Memory Wah Wah Wah", .{});
                    return;
                };
                @memcpy(buf[0..first], lexer.source.contents[lexer.start..fend]);
                @memcpy(buf[first..], lexer.source.contents[ostart..lexer.end]);
                lexer.date = buf;
            } else {
                lexer.date = lexer.source.contents[lexer.start..fend];
            }
        } else {
            lexer.date = lexer.source.contents[lexer.start..lexer.end];
        }
        lexer.token = T.t_date;
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

        try lexer.addRangeError(lexer.range(), "Unexpected {s}", .{found});
    }

    pub fn expectedString(self: *Lexer, text: string) !void {
        const found = finder: {
            if (self.source.contents.len != self.start) {
                break :finder self.raw();
            } else {
                break :finder "end of file";
            }
        };

        try self.addRangeError(self.range(), "Expected {s} but found {s}", .{ text, found });
    }

    pub fn range(self: *Lexer) logger.Range {
        return logger.Range{
            .loc = logger.usize2Loc(self.start),
            .len = std.math.lossyCast(i32, self.end - self.start),
        };
    }

    pub fn init(log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator, redact_logs: bool) !Lexer {
        var lex = Lexer{
            .log = log,
            .source = source,
            .prev_error_loc = logger.Loc.Empty,
            .allocator = allocator,
            .should_redact_logs = redact_logs,
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
            js_ast.E.String,
            .{ .data = lexer.string_literal_slice },
            loc_,
        );
    }

    pub fn raw(self: *Lexer) []const u8 {
        return self.source.contents[self.start..self.end];
    }
};

pub inline fn isDigit(code_point: CodePoint) bool {
    return code_point >= '0' and code_point <= '9';
}

// SAFETY: CodePoints passed here are assumed to be in the range ['0', '9'].
pub inline fn shiftLeftBase10(comptime P: type, code_point: CodePoint, shift_by: u8) P {
    const found = @as(u8, @intCast(code_point)) - '0';
    const multiplier = std.math.pow(P, 10, shift_by);
    return found * multiplier;
}

pub inline fn isLeapYear(year: u16) bool {
    return (year % 4 == 0 and year % 100 != 0) or (year % 400 == 0);
}

pub inline fn isMaybeDate(input: []const u8) bool {
    if (input.len < 5) return false;
    return input[4] == '-' and !(input[3] == 'e' or input[3] == 'E');
}

pub inline fn isValidDate(year: u16, month: u8, day: u8) bool {
    if (month > 12 or month < 1) {
        return false;
    }
    if (day < 1) {
        return false;
    }
    const days_per_month = [_]u8{ 0, 31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31 };
    const max_day = if (month == 2 and isLeapYear(year)) 29 else days_per_month[month];
    return day <= max_day;
}

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

const string = []const u8;

const std = @import("std");

const bun = @import("bun");
const CodePoint = bun.CodePoint;
const js_ast = bun.ast;
const logger = bun.logger;
const strings = bun.strings;
