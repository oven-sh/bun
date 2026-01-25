/// JSON5 Token-Based Scanner/Parser
///
/// Parses JSON5 text into Expr AST values. JSON5 is a superset of JSON
/// based on ECMAScript 5.1 that supports comments, trailing commas,
/// unquoted keys, single-quoted strings, hex numbers, Infinity, NaN, etc.
///
/// Architecture: a scanner reads source bytes and produces typed tokens;
/// the parser only consumes tokens and never touches source/pos directly.
///
/// Reference: https://spec.json5.org/
pub const JSON5Parser = struct {
    source: []const u8,
    pos: usize,
    allocator: std.mem.Allocator,
    stack_check: bun.StackCheck,
    error_message: []const u8,
    error_pos: usize,
    token: Token,

    const Token = struct {
        loc: logger.Loc,
        data: Data,

        const Data = union(enum) {
            eof,
            // Structural (single-byte, scanner advances past them)
            left_brace,
            right_brace,
            left_bracket,
            right_bracket,
            colon,
            comma,
            plus,
            minus,
            // Values (scanner fully parses the content)
            string: []u8,
            number: f64,
            // Keywords (scanner checks word boundary)
            true_,
            false_,
            null_,
            nan,
            infinity,
            // Identifiers (for unquoted keys that aren't keywords)
            identifier: []u8,
        };
    };

    const ParseError = error{ SyntaxError, StackOverflow } || OOM;

    pub fn parse(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) ParseError!Expr {
        var parser = JSON5Parser{
            .source = source.contents,
            .pos = 0,
            .allocator = allocator,
            .stack_check = .init(),
            .error_message = "",
            .error_pos = 0,
            .token = .{ .loc = .{}, .data = .eof },
        };
        const result = parser.parseRoot() catch |err| switch (err) {
            error.SyntaxError => {
                try log.addError(source, .{ .start = @intCast(parser.error_pos) }, parser.error_message);
                return error.SyntaxError;
            },
            else => |e| return e,
        };
        return result;
    }

    fn fail(self: *JSON5Parser, msg: []const u8) error{SyntaxError} {
        self.error_message = msg;
        self.error_pos = self.pos;
        return error.SyntaxError;
    }

    fn failAtLoc(self: *JSON5Parser, loc: logger.Loc, msg: []const u8) error{SyntaxError} {
        self.error_message = msg;
        self.error_pos = @intCast(loc.start);
        return error.SyntaxError;
    }

    // ── Scanner ──

    /// Returns the byte at the current position, or 0 if at EOF.
    /// All source access in scan() goes through this to avoid bounds checks.
    fn peek(self: *const JSON5Parser) u8 {
        if (self.pos < self.source.len) return self.source[self.pos];
        return 0;
    }

    fn scan(self: *JSON5Parser) ParseError!void {
        self.token.data = next: switch (self.peek()) {
            0 => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                break :next .eof;
            },
            // Whitespace — skip without setting loc
            '\t', '\n', '\r', ' ', 0x0B, 0x0C => {
                self.pos += 1;
                continue :next self.peek();
            },
            // Structural
            '{' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                self.pos += 1;
                break :next .left_brace;
            },
            '}' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                self.pos += 1;
                break :next .right_brace;
            },
            '[' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                self.pos += 1;
                break :next .left_bracket;
            },
            ']' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                self.pos += 1;
                break :next .right_bracket;
            },
            ':' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                self.pos += 1;
                break :next .colon;
            },
            ',' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                self.pos += 1;
                break :next .comma;
            },
            '+' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                self.pos += 1;
                break :next .plus;
            },
            '-' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                self.pos += 1;
                break :next .minus;
            },
            // Strings
            '"', '\'' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                break :next .{ .string = try self.scanString() };
            },
            // Numbers
            '0'...'9', '.' => {
                self.token.loc = .{ .start = @intCast(self.pos) };
                break :next .{ .number = try self.scanNumber() };
            },
            // Comments — skip without setting loc
            '/' => {
                const n = if (self.pos + 1 < self.source.len) self.source[self.pos + 1] else 0;
                if (n == '/') {
                    self.pos += 2;
                    self.skipToEndOfLine();
                    continue :next self.peek();
                } else if (n == '*') {
                    self.pos += 2;
                    try self.skipBlockComment();
                    continue :next self.peek();
                }
                return self.fail("Unexpected character");
            },
            else => |c| {
                if (c == 't') {
                    self.token.loc = .{ .start = @intCast(self.pos) };
                    break :next if (self.scanKeyword("true")) .true_ else .{ .identifier = try self.scanIdentifier() };
                } else if (c == 'f') {
                    self.token.loc = .{ .start = @intCast(self.pos) };
                    break :next if (self.scanKeyword("false")) .false_ else .{ .identifier = try self.scanIdentifier() };
                } else if (c == 'n') {
                    self.token.loc = .{ .start = @intCast(self.pos) };
                    break :next if (self.scanKeyword("null")) .null_ else .{ .identifier = try self.scanIdentifier() };
                } else if (c == 'N') {
                    self.token.loc = .{ .start = @intCast(self.pos) };
                    break :next if (self.scanKeyword("NaN")) .nan else .{ .identifier = try self.scanIdentifier() };
                } else if (c == 'I') {
                    self.token.loc = .{ .start = @intCast(self.pos) };
                    break :next if (self.scanKeyword("Infinity")) .infinity else .{ .identifier = try self.scanIdentifier() };
                } else if ((c >= 'a' and c <= 'z') or (c >= 'A' and c <= 'Z') or c == '_' or c == '$' or c == '\\') {
                    self.token.loc = .{ .start = @intCast(self.pos) };
                    break :next .{ .identifier = try self.scanIdentifier() };
                } else if (c >= 0x80) {
                    // Multi-byte: check whitespace first, then identifier
                    const mb = self.multiByteWhitespace();
                    if (mb > 0) {
                        self.pos += mb;
                        continue :next self.peek();
                    }
                    self.token.loc = .{ .start = @intCast(self.pos) };
                    const cp = self.readCodepoint() orelse {
                        return self.fail("Unexpected character");
                    };
                    if (identifier.isIdentifierStart(cp.cp)) {
                        break :next .{ .identifier = try self.scanIdentifier() };
                    } else {
                        return self.fail("Unexpected character");
                    }
                } else {
                    return self.fail("Unexpected character");
                }
            },
        };
    }

    fn scanKeyword(self: *JSON5Parser, comptime keyword: []const u8) bool {
        if (self.pos + keyword.len > self.source.len) return false;
        if (!std.mem.eql(u8, self.source[self.pos..][0..keyword.len], keyword)) return false;
        // Check word boundary
        if (self.pos + keyword.len < self.source.len) {
            const next = self.source[self.pos + keyword.len];
            if (isIdentContinueASCII(next) or next == '\\' or next >= 0x80) return false;
        }
        self.pos += keyword.len;
        return true;
    }

    // ── Parser ──

    fn parseRoot(self: *JSON5Parser) ParseError!Expr {
        try self.scan();
        const result = try self.parseValue();
        if (self.token.data != .eof) {
            return self.failAtLoc(self.token.loc, "Unexpected token after JSON5 value");
        }
        return result;
    }

    fn parseValue(self: *JSON5Parser) ParseError!Expr {
        if (!self.stack_check.isSafeToRecurse()) {
            return error.StackOverflow;
        }

        const loc = self.token.loc;

        switch (self.token.data) {
            .left_brace => return self.parseObject(),
            .left_bracket => return self.parseArray(),
            .string => |s| {
                try self.scan();
                return Expr.init(E.String, E.String.init(s), loc);
            },
            .number => |n| {
                try self.scan();
                return Expr.init(E.Number, .{ .value = n }, loc);
            },
            .true_ => {
                try self.scan();
                return Expr.init(E.Boolean, .{ .value = true }, loc);
            },
            .false_ => {
                try self.scan();
                return Expr.init(E.Boolean, .{ .value = false }, loc);
            },
            .null_ => {
                try self.scan();
                return Expr.init(E.Null, .{}, loc);
            },
            .nan => {
                try self.scan();
                return Expr.init(E.Number, .{ .value = std.math.nan(f64) }, loc);
            },
            .infinity => {
                try self.scan();
                return Expr.init(E.Number, .{ .value = std.math.inf(f64) }, loc);
            },
            .plus => {
                try self.scan();
                return self.parseAfterSign(false, loc);
            },
            .minus => {
                try self.scan();
                return self.parseAfterSign(true, loc);
            },
            .eof => return self.failAtLoc(loc, "Unexpected end of input"),
            .identifier => return self.failAtLoc(loc, "Unexpected identifier"),
            else => return self.failAtLoc(loc, "Unexpected character"),
        }
    }

    fn parseAfterSign(self: *JSON5Parser, is_negative: bool, loc: logger.Loc) ParseError!Expr {
        switch (self.token.data) {
            .number => |n| {
                const val = if (is_negative) -n else n;
                try self.scan();
                return Expr.init(E.Number, .{ .value = val }, loc);
            },
            .infinity => {
                const val: f64 = if (is_negative) -std.math.inf(f64) else std.math.inf(f64);
                try self.scan();
                return Expr.init(E.Number, .{ .value = val }, loc);
            },
            .nan => {
                const val = if (is_negative) -std.math.nan(f64) else std.math.nan(f64);
                try self.scan();
                return Expr.init(E.Number, .{ .value = val }, loc);
            },
            .eof => return self.failAtLoc(loc, "Unexpected end of input after sign"),
            else => return self.failAtLoc(loc, "Unexpected character after sign"),
        }
    }

    fn parseObject(self: *JSON5Parser) ParseError!Expr {
        const loc = self.token.loc;
        try self.scan(); // advance past '{'

        var properties = std.array_list.Managed(G.Property).init(self.allocator);

        while (self.token.data != .right_brace) {
            const key = try self.parseObjectKey();

            if (self.token.data != .colon) {
                return self.failAtLoc(self.token.loc, "Expected ':' after object key");
            }
            try self.scan(); // advance past ':'

            const value = try self.parseValue();

            try properties.append(.{
                .key = key,
                .value = value,
            });

            switch (self.token.data) {
                .comma => try self.scan(),
                .right_brace => {},
                .eof => return self.failAtLoc(self.token.loc, "Unterminated object"),
                else => return self.failAtLoc(self.token.loc, "Expected ',' or '}' in object"),
            }
        }

        try self.scan(); // advance past '}'
        return Expr.init(E.Object, .{
            .properties = .moveFromList(&properties),
        }, loc);
    }

    fn parseObjectKey(self: *JSON5Parser) ParseError!Expr {
        const loc = self.token.loc;
        switch (self.token.data) {
            .string => |s| {
                try self.scan();
                return Expr.init(E.String, E.String.init(s), loc);
            },
            .identifier => |s| {
                try self.scan();
                return Expr.init(E.String, E.String.init(s), loc);
            },
            .true_ => {
                try self.scan();
                const str = try bun.default_allocator.dupe(u8, "true");
                return Expr.init(E.String, E.String.init(str), loc);
            },
            .false_ => {
                try self.scan();
                const str = try bun.default_allocator.dupe(u8, "false");
                return Expr.init(E.String, E.String.init(str), loc);
            },
            .null_ => {
                try self.scan();
                const str = try bun.default_allocator.dupe(u8, "null");
                return Expr.init(E.String, E.String.init(str), loc);
            },
            .nan => {
                try self.scan();
                const str = try bun.default_allocator.dupe(u8, "NaN");
                return Expr.init(E.String, E.String.init(str), loc);
            },
            .infinity => {
                try self.scan();
                const str = try bun.default_allocator.dupe(u8, "Infinity");
                return Expr.init(E.String, E.String.init(str), loc);
            },
            .eof => return self.failAtLoc(loc, "Unexpected end of input in object key"),
            else => return self.failAtLoc(loc, "Invalid identifier start character"),
        }
    }

    fn parseArray(self: *JSON5Parser) ParseError!Expr {
        const loc = self.token.loc;
        try self.scan(); // advance past '['

        var items = std.array_list.Managed(Expr).init(self.allocator);

        while (self.token.data != .right_bracket) {
            const value = try self.parseValue();
            try items.append(value);

            switch (self.token.data) {
                .comma => try self.scan(),
                .right_bracket => {},
                .eof => return self.failAtLoc(self.token.loc, "Unterminated array"),
                else => return self.failAtLoc(self.token.loc, "Expected ',' or ']' in array"),
            }
        }

        try self.scan(); // advance past ']'
        return Expr.init(E.Array, .{
            .items = .moveFromList(&items),
        }, loc);
    }

    // ── Scan Helpers ──

    fn scanString(self: *JSON5Parser) ParseError![]u8 {
        const quote = self.source[self.pos];
        self.pos += 1; // skip opening quote

        var buf = std.array_list.Managed(u8).init(bun.default_allocator);
        errdefer buf.deinit();

        while (self.pos < self.source.len) {
            const c = self.source[self.pos];

            if (c == quote) {
                self.pos += 1;
                return try buf.toOwnedSlice();
            }

            if (c == '\\') {
                self.pos += 1;
                try self.parseEscapeSequence(&buf);
                continue;
            }

            // Line terminators are not allowed unescaped in strings
            if (c == '\n' or c == '\r') {
                return self.fail("Unterminated string");
            }

            // Check for U+2028/U+2029 (allowed unescaped in JSON5 strings)
            if (c == 0xE2 and self.pos + 2 < self.source.len and
                self.source[self.pos + 1] == 0x80 and
                (self.source[self.pos + 2] == 0xA8 or self.source[self.pos + 2] == 0xA9))
            {
                try buf.appendSlice(self.source[self.pos..][0..3]);
                self.pos += 3;
                continue;
            }

            // Regular character - handle multi-byte UTF-8
            const cp_len = strings.wtf8ByteSequenceLength(c);
            if (self.pos + cp_len > self.source.len) {
                try buf.append(c);
                self.pos += 1;
            } else {
                try buf.appendSlice(self.source[self.pos..][0..cp_len]);
                self.pos += cp_len;
            }
        }

        return self.fail("Unterminated string");
    }

    fn parseEscapeSequence(self: *JSON5Parser, buf: *std.array_list.Managed(u8)) ParseError!void {
        if (self.pos >= self.source.len) {
            return self.fail("Unexpected end of input in escape sequence");
        }

        const c = self.source[self.pos];
        self.pos += 1;

        switch (c) {
            '\'' => try buf.append('\''),
            '"' => try buf.append('"'),
            '\\' => try buf.append('\\'),
            'b' => try buf.append(0x08),
            'f' => try buf.append(0x0C),
            'n' => try buf.append('\n'),
            'r' => try buf.append('\r'),
            't' => try buf.append('\t'),
            'v' => try buf.append(0x0B),
            '0' => {
                // \0 null escape - must NOT be followed by a digit
                if (self.pos < self.source.len) {
                    const next = self.source[self.pos];
                    if (next >= '0' and next <= '9') {
                        return self.fail("Octal escape sequences are not allowed in JSON5");
                    }
                }
                try buf.append(0);
            },
            'x' => {
                // \xHH hex escape
                const hi = self.readHexDigit() orelse {
                    return self.fail("Invalid hex escape");
                };
                const lo = self.readHexDigit() orelse {
                    return self.fail("Invalid hex escape");
                };
                const value: u8 = (@as(u8, hi) << 4) | lo;
                try self.appendCodepointToUtf8(buf, @intCast(value));
            },
            'u' => {
                // \uHHHH unicode escape
                const cp = try self.readHex4();
                // Check for surrogate pair
                if (cp >= 0xD800 and cp <= 0xDBFF) {
                    // High surrogate - expect \uDCxx low surrogate
                    if (self.pos + 1 < self.source.len and
                        self.source[self.pos] == '\\' and
                        self.source[self.pos + 1] == 'u')
                    {
                        self.pos += 2;
                        const low = try self.readHex4();
                        if (low >= 0xDC00 and low <= 0xDFFF) {
                            const full_cp: i32 = 0x10000 + (cp - 0xD800) * 0x400 + (low - 0xDC00);
                            try self.appendCodepointToUtf8(buf, full_cp);
                        } else {
                            // Invalid low surrogate - just encode both independently
                            try self.appendCodepointToUtf8(buf, cp);
                            try self.appendCodepointToUtf8(buf, low);
                        }
                    } else {
                        try self.appendCodepointToUtf8(buf, cp);
                    }
                } else {
                    try self.appendCodepointToUtf8(buf, cp);
                }
            },
            '\r' => {
                // Line continuation: \CR or \CRLF
                if (self.pos < self.source.len and self.source[self.pos] == '\n') {
                    self.pos += 1;
                }
            },
            '\n' => {
                // Line continuation: \LF
            },
            '1'...'9' => {
                return self.fail("Octal escape sequences are not allowed in JSON5");
            },
            0xE2 => {
                // Check for U+2028/U+2029 line continuation
                if (self.pos + 1 < self.source.len and
                    self.source[self.pos] == 0x80 and
                    (self.source[self.pos + 1] == 0xA8 or self.source[self.pos + 1] == 0xA9))
                {
                    // Line continuation with U+2028 or U+2029
                    self.pos += 2;
                } else {
                    // Identity escape for the byte 0xE2
                    try buf.append(0xE2);
                }
            },
            else => {
                // Identity escape
                try buf.append(c);
            },
        }
    }

    fn scanNumber(self: *JSON5Parser) ParseError!f64 {
        const start = self.pos;
        const c = self.source[self.pos];

        // Hexadecimal: 0x or 0X
        if (c == '0' and self.pos + 1 < self.source.len) {
            const next = self.source[self.pos + 1];
            if (next == 'x' or next == 'X') {
                return self.scanHexNumber();
            }
        }

        // Check for leading zero followed by digit (invalid)
        if (c == '0' and self.pos + 1 < self.source.len) {
            const next = self.source[self.pos + 1];
            if (next >= '0' and next <= '9') {
                return self.fail("Leading zeros are not allowed in JSON5");
            }
        }

        // Parse decimal number
        var has_digits = false;

        // Integer part
        if (c >= '0' and c <= '9') {
            has_digits = true;
            self.pos += 1;
            while (self.pos < self.source.len and self.source[self.pos] >= '0' and self.source[self.pos] <= '9') {
                self.pos += 1;
            }
        }

        // Fractional part
        if (self.pos < self.source.len and self.source[self.pos] == '.') {
            self.pos += 1;
            var has_frac_digits = false;
            while (self.pos < self.source.len and self.source[self.pos] >= '0' and self.source[self.pos] <= '9') {
                self.pos += 1;
                has_frac_digits = true;
            }
            if (!has_digits and !has_frac_digits) {
                return self.fail("Invalid number: lone decimal point");
            }
            has_digits = true;
        }

        if (!has_digits) {
            return self.fail("Invalid number");
        }

        // Exponent part
        if (self.pos < self.source.len and (self.source[self.pos] == 'e' or self.source[self.pos] == 'E')) {
            self.pos += 1;
            if (self.pos < self.source.len and (self.source[self.pos] == '+' or self.source[self.pos] == '-')) {
                self.pos += 1;
            }
            if (self.pos >= self.source.len or self.source[self.pos] < '0' or self.source[self.pos] > '9') {
                return self.fail("Invalid exponent in number");
            }
            while (self.pos < self.source.len and self.source[self.pos] >= '0' and self.source[self.pos] <= '9') {
                self.pos += 1;
            }
        }

        const num_str = self.source[start..self.pos];
        return std.fmt.parseFloat(f64, num_str) catch {
            return self.fail("Invalid number");
        };
    }

    fn scanHexNumber(self: *JSON5Parser) ParseError!f64 {
        self.pos += 2; // skip '0x' or '0X'
        const hex_start = self.pos;

        while (self.pos < self.source.len) {
            const c = self.source[self.pos];
            if ((c >= '0' and c <= '9') or (c >= 'a' and c <= 'f') or (c >= 'A' and c <= 'F')) {
                self.pos += 1;
            } else {
                break;
            }
        }

        if (self.pos == hex_start) {
            return self.fail("Expected hex digits after '0x'");
        }

        const hex_str = self.source[hex_start..self.pos];
        const value = std.fmt.parseInt(u64, hex_str, 16) catch {
            return self.fail("Hex number too large");
        };
        return @floatFromInt(value);
    }

    fn scanIdentifier(self: *JSON5Parser) ParseError![]u8 {
        var buf = std.array_list.Managed(u8).init(bun.default_allocator);
        errdefer buf.deinit();

        // First character must be IdentifierStart
        const start_cp = self.readCodepoint() orelse {
            return self.fail("Expected identifier");
        };

        if (start_cp.cp == '\\') {
            // Unicode escape in identifier
            const escaped_cp = try self.parseIdentifierUnicodeEscape();
            if (!identifier.isIdentifierStart(escaped_cp)) {
                return self.fail("Invalid identifier start character");
            }
            try self.appendCodepointToUtf8(&buf, @intCast(escaped_cp));
        } else if (identifier.isIdentifierStart(start_cp.cp)) {
            self.pos += start_cp.len;
            try self.appendCodepointToUtf8(&buf, @intCast(start_cp.cp));
        } else {
            return self.fail("Invalid identifier start character");
        }

        // Continue characters
        while (self.pos < self.source.len) {
            const cont_cp = self.readCodepoint() orelse break;

            if (cont_cp.cp == '\\') {
                const escaped_cp = try self.parseIdentifierUnicodeEscape();
                if (!identifier.isIdentifierPart(escaped_cp)) {
                    break;
                }
                try self.appendCodepointToUtf8(&buf, @intCast(escaped_cp));
            } else if (identifier.isIdentifierPart(cont_cp.cp)) {
                self.pos += cont_cp.len;
                try self.appendCodepointToUtf8(&buf, @intCast(cont_cp.cp));
            } else {
                break;
            }
        }

        return try buf.toOwnedSlice();
    }

    fn parseIdentifierUnicodeEscape(self: *JSON5Parser) ParseError!i32 {
        // We already consumed the '\', now expect 'u' + 4 hex digits
        self.pos += 1; // skip '\'
        if (self.pos >= self.source.len or self.source[self.pos] != 'u') {
            return self.fail("Expected 'u' after '\\' in identifier");
        }
        self.pos += 1;
        return self.readHex4();
    }

    // ── Comment Helpers ──

    fn skipToEndOfLine(self: *JSON5Parser) void {
        while (self.pos < self.source.len) {
            const cc = self.source[self.pos];
            if (cc == '\n' or cc == '\r') break;
            // Check for U+2028/U+2029 line terminators
            if (cc == 0xE2 and self.pos + 2 < self.source.len and
                self.source[self.pos + 1] == 0x80 and
                (self.source[self.pos + 2] == 0xA8 or self.source[self.pos + 2] == 0xA9))
            {
                break;
            }
            self.pos += 1;
        }
    }

    fn skipBlockComment(self: *JSON5Parser) ParseError!void {
        while (self.pos < self.source.len) {
            if (self.source[self.pos] == '*' and self.pos + 1 < self.source.len and self.source[self.pos + 1] == '/') {
                self.pos += 2;
                return;
            }
            self.pos += 1;
        }
        return self.fail("Unterminated multi-line comment");
    }

    /// Check if the current position has a multi-byte whitespace character.
    /// Returns the number of bytes consumed, or 0 if not whitespace.
    fn multiByteWhitespace(self: *const JSON5Parser) u3 {
        if (self.pos + 1 >= self.source.len) return 0;
        const b0 = self.source[self.pos];
        const b1 = self.source[self.pos + 1];

        // U+00A0 NBSP: C2 A0
        if (b0 == 0xC2 and b1 == 0xA0) return 2;

        if (self.pos + 2 >= self.source.len) return 0;
        const b2 = self.source[self.pos + 2];

        // U+FEFF BOM: EF BB BF
        if (b0 == 0xEF and b1 == 0xBB and b2 == 0xBF) return 3;

        // U+2028 LS: E2 80 A8
        // U+2029 PS: E2 80 A9
        if (b0 == 0xE2 and b1 == 0x80 and (b2 == 0xA8 or b2 == 0xA9)) return 3;

        // U+1680: E1 9A 80
        if (b0 == 0xE1 and b1 == 0x9A and b2 == 0x80) return 3;

        // U+2000-U+200A: E2 80 80-8A
        if (b0 == 0xE2 and b1 == 0x80 and b2 >= 0x80 and b2 <= 0x8A) return 3;

        // U+202F: E2 80 AF
        if (b0 == 0xE2 and b1 == 0x80 and b2 == 0xAF) return 3;

        // U+205F: E2 81 9F
        if (b0 == 0xE2 and b1 == 0x81 and b2 == 0x9F) return 3;

        // U+3000: E3 80 80
        if (b0 == 0xE3 and b1 == 0x80 and b2 == 0x80) return 3;

        return 0;
    }

    // ── Helper Functions ──

    fn readHexDigit(self: *JSON5Parser) ?u4 {
        if (self.pos >= self.source.len) return null;
        const c = self.source[self.pos];
        const result: u4 = switch (c) {
            '0'...'9' => @intCast(c - '0'),
            'a'...'f' => @intCast(c - 'a' + 10),
            'A'...'F' => @intCast(c - 'A' + 10),
            else => return null,
        };
        self.pos += 1;
        return result;
    }

    fn readHex4(self: *JSON5Parser) ParseError!i32 {
        var value: i32 = 0;
        comptime var i: usize = 0;
        inline while (i < 4) : (i += 1) {
            const digit = self.readHexDigit() orelse {
                return self.fail("Invalid unicode escape: expected 4 hex digits");
            };
            value = (value << 4) | @as(i32, digit);
        }
        return value;
    }

    const Codepoint = struct {
        cp: i32,
        len: u3,
    };

    fn readCodepoint(self: *const JSON5Parser) ?Codepoint {
        if (self.pos >= self.source.len) return null;
        const first = self.source[self.pos];
        if (first < 0x80) {
            return .{ .cp = @intCast(first), .len = 1 };
        }
        const seq_len = strings.wtf8ByteSequenceLength(first);
        if (self.pos + seq_len > self.source.len) {
            return .{ .cp = @intCast(first), .len = 1 };
        }
        const decoded = strings.decodeWTF8RuneT(self.source[self.pos..].ptr[0..4], seq_len, i32, -1);
        if (decoded < 0) return .{ .cp = @intCast(first), .len = 1 };
        return .{ .cp = decoded, .len = @intCast(seq_len) };
    }

    fn appendCodepointToUtf8(self: *JSON5Parser, buf: *std.array_list.Managed(u8), cp: i32) ParseError!void {
        _ = self;
        if (cp < 0 or cp > 0x10FFFF) {
            return error.SyntaxError;
        }
        var encoded: [4]u8 = undefined;
        const len = strings.encodeWTF8Rune(&encoded, cp);
        try buf.appendSlice(encoded[0..len]);
    }

    fn isIdentContinueASCII(c: u8) bool {
        return switch (c) {
            'a'...'z', 'A'...'Z', '0'...'9', '_', '$' => true,
            else => false,
        };
    }
};

const identifier = @import("../js_lexer/identifier.zig");
const std = @import("std");

const bun = @import("bun");
const OOM = bun.OOM;
const logger = bun.logger;
const strings = bun.strings;

const E = bun.ast.E;
const Expr = bun.ast.Expr;
const G = bun.ast.G;
