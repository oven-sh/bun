const std = @import("std");
const logger = @import("logger.zig");
const tables = @import("js_lexer_tables.zig");
const unicode = std.unicode;

const Source = logger.Source;
pub const T = tables.T;
pub const CodePoint = tables.CodePoint;
pub const Keywords = tables.Keywords;
pub const tokenToString = tables.tokenToString;
pub const jsxEntity = tables.jsxEntity;

// TODO: JSON
const IS_JSON_FILE = false;

const string = []const u8;

pub const Lexer = struct {
    // pub const Error = error{
    //     UnexpectedToken,
    //     EndOfFile,
    // };

    // err: ?Lexer.Error,
    log: logger.Log,
    source: logger.Source,
    current: usize = 0,
    start: usize = 0,
    end: usize = 0,
    approximate_newline_count: i32 = 0,
    legacy_octal_loc: logger.Loc = 0,
    previous_backslash_quote_in_jsx: logger.Range = logger.Range{},
    token: T = T.t_end_of_file,
    has_newline_before: bool = false,
    has_pure_comment_before: bool = false,
    preserve_all_comments_before: bool = false,
    is_legacy_octal_literal: bool = false,
    // comments_to_preserve_before: []js_ast.Comment,
    // all_original_comments: []js_ast.Comment,
    code_point: CodePoint = -1,
    string_literal: std.ArrayList([]u16),
    identifier: []const u8 = "",
    // jsx_factory_pragma_comment: js_ast.Span,
    // jsx_fragment_pragma_comment: js_ast.Span,
    // source_mapping_url: js_ast.Span,
    number: f64 = 0.0,
    rescan_close_brace_as_template_token: bool = false,
    for_global_name: bool = false,
    prev_error_loc: i32 = -1,
    fn nextCodepointSlice(it: *Lexer) callconv(.Inline) ?[]const u8 {
        if (it.current >= it.source.contents.len) {
            return null;
        }

        const cp_len = unicode.utf8ByteSequenceLength(it.source.contents[it.current]) catch unreachable;
        it.end = it.current;
        it.current += cp_len;

        return it.source.contents[it.current - cp_len .. it.current];
    }

    pub fn syntax_error(self: *Lexer) void {
        self.addError(self.start, "Syntax Error!!", .{}, true);
    }

    pub fn addError(self: *Lexer, _loc: usize, comptime format: []const u8, args: anytype, panic: bool) void {
        const loc = logger.usize2Loc(_loc);
        if (loc == self.prev_error_loc) {
            return;
        }

        const errorMessage = std.fmt.allocPrint(self.string_literal.allocator, format, args) catch unreachable;
        self.log.addError(self.source, loc, errorMessage) catch unreachable;
        self.prev_error_loc = loc;

        if (panic) {
            self.doPanic(errorMessage);
        }
    }

    pub fn addRangeError(self: *Lexer, range: logger.Range, comptime format: []const u8, args: anytype, panic: bool) void {
        if (loc == self.prev_error_loc) {
            return;
        }

        const errorMessage = std.fmt.allocPrint(self.string_literal.allocator, format, args) catch unreachable;
        var msg = self.log.addRangeError(self.source, range, errorMessage);
        self.prev_error_loc = loc;

        if (panic) {
            self.doPanic(errorMessage);
        }
    }

    fn doPanic(self: *Lexer, content: []const u8) void {
        std.debug.panic("{s}", .{content});
    }

    pub fn codePointEql(self: *Lexer, a: u8) bool {
        return @intCast(CodePoint, a) == self.code_point;
    }

    fn nextCodepoint(it: *Lexer) callconv(.Inline) CodePoint {
        const slice = it.nextCodepointSlice() orelse return @as(CodePoint, -1);

        switch (slice.len) {
            1 => return @as(CodePoint, slice[0]),
            2 => return @as(CodePoint, unicode.utf8Decode2(slice) catch unreachable),
            3 => return @as(CodePoint, unicode.utf8Decode3(slice) catch unreachable),
            4 => return @as(CodePoint, unicode.utf8Decode4(slice) catch unreachable),
            else => unreachable,
        }
    }

    /// Look ahead at the next n codepoints without advancing the iterator.
    /// If fewer than n codepoints are available, then return the remainder of the string.
    fn peek(it: *Lexer, n: usize) []const u8 {
        const original_i = it.current;
        defer it.current = original_i;

        var end_ix = original_i;
        var found: usize = 0;
        while (found < n) : (found += 1) {
            const next_codepoint = it.nextCodepointSlice() orelse return it.source.contents[original_i..];
            end_ix += next_codepoint.len;
        }

        return it.source.contents[original_i..end_ix];
    }

    fn step(lexer: *Lexer) void {
        lexer.code_point = lexer.nextCodepoint();

        // Track the approximate number of newlines in the file so we can preallocate
        // the line offset table in the printer for source maps. The line offset table
        // is the #1 highest allocation in the heap profile, so this is worth doing.
        // This count is approximate because it handles "\n" and "\r\n" (the common
        // cases) but not "\r" or "\u2028" or "\u2029". Getting this wrong is harmless
        // because it's only a preallocation. The array will just grow if it's too small.
        if (lexer.code_point == '\n') {
            lexer.approximate_newline_count += 1;
        }
    }

    pub fn expect(self: *Lexer, token: T) void {
        if (self.token != token) {
            lexer.expected(token);
        }

        lexer.next();
    }

    pub fn expectOrInsertSemicolon(lexer: *Lexer) void {
        if (lexer.token == T.semicolon || (!lexer.has_newline_before and
            lexer.token != T.close_brace and lexer.token != T.t_end_of_file))
        {
            lexer.expect(T.semicolon);
        }
    }

    pub fn addUnsupportedSyntaxError(self: *Lexer, msg: []const u8) void {
        self.addError(self.end, "Unsupported syntax: {s}", .{msg}, true);
    }

    pub fn scanIdentifierWithEscapes(self: *Lexer) void {
        self.addUnsupportedSyntaxError("escape sequence");
        return;
    }

    pub fn next(lexer: *Lexer) void {
        lexer.has_newline_before = lexer.end == 0;

        while (true) {
            lexer.start = lexer.end;
            lexer.token = T.t_end_of_file;

            switch (lexer.code_point) {
                -1 => {
                    lexer.token = T.t_end_of_file;
                },

                '#' => {
                    if (lexer.start == 0 and lexer.source.contents[1] == '!') {
                        lexer.addUnsupportedSyntaxError("#!hashbang is not supported yet.");
                        return;
                    }

                    lexer.step();
                    if (!isIdentifierStart(lexer.code_point)) {
                        lexer.syntax_error();
                    }
                    lexer.step();

                    if (isIdentifierStart(lexer.code_point)) {
                        lexer.step();
                        while (isIdentifierContinue(lexer.code_point)) {
                            lexer.step();
                        }
                        if (lexer.code_point == '\\') {
                            lexer.scanIdentifierWithEscapes();
                            lexer.token = T.t_private_identifier;
                            // lexer.Identifier, lexer.Token = lexer.scanIdentifierWithEscapes(normalIdentifier);
                        } else {
                            lexer.token = T.t_private_identifier;
                            lexer.identifier = lexer.raw();
                        }
                        break;
                    }
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

                '(' => {
                    lexer.step();
                    lexer.token = T.t_open_paren;
                },
                ')' => {
                    lexer.step();
                    lexer.token = T.t_close_paren;
                },
                '[' => {
                    lexer.step();
                    lexer.token = T.t_open_bracket;
                },
                ']' => {
                    lexer.step();
                    lexer.token = T.t_close_bracket;
                },
                '{' => {
                    lexer.step();
                    lexer.token = T.t_open_brace;
                },
                '}' => {
                    lexer.step();
                    lexer.token = T.t_close_brace;
                },
                ',' => {
                    lexer.step();
                    lexer.token = T.t_comma;
                },
                ':' => {
                    lexer.step();
                    lexer.token = T.t_colon;
                },
                ';' => {
                    lexer.step();
                    lexer.token = T.t_semicolon;
                },
                '@' => {
                    lexer.step();
                    lexer.token = T.t_at;
                },
                '~' => {
                    lexer.step();
                    lexer.token = T.t_tilde;
                },

                '?' => {
                    // '?' or '?.' or '??' or '??='
                    lexer.step();
                    switch (lexer.code_point) {
                        '?' => {
                            lexer.step();
                            switch (lexer.code_point) {
                                '=' => {
                                    lexer.step();
                                    lexer.token = T.t_question_question_equals;
                                },
                                else => {
                                    lexer.token = T.t_question_question;
                                },
                            }
                        },

                        '.' => {
                            lexer.token = T.t_question;
                            const current = lexer.current;
                            const contents = lexer.source.contents;

                            // Lookahead to disambiguate with 'a?.1:b'
                            if (current < contents.len) {
                                const c = contents[current];
                                if (c < '0' or c > '9') {
                                    lexer.step();
                                    lexer.token = T.t_question_dot;
                                }
                            }
                        },
                        else => {
                            lexer.token = T.t_question;
                        },
                    }
                },

                '%' => {
                    // '%' or '%='
                    lexer.step();
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = T.t_percent_equals;
                        },

                        else => {
                            lexer.token = T.t_percent;
                        },
                    }
                },

                '&' => {
                    // '&' or '&=' or '&&' or '&&='
                    lexer.step();
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = T.t_ampersand_equals;
                        },

                        '&' => {
                            lexer.step();
                            switch (lexer.code_point) {
                                '=' => {
                                    lexer.step();
                                    lexer.token = T.t_ampersand_ampersand_equals;
                                },

                                else => {
                                    lexer.token = T.t_ampersand_ampersand;
                                },
                            }
                        },
                        else => {
                            lexer.token = T.t_ampersand;
                        },
                    }
                },

                '|' => {

                    // '|' or '|=' or '||' or '||='
                    lexer.step();
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = T.t_bar_equals;
                        },
                        '|' => {
                            lexer.step();
                            switch (lexer.code_point) {
                                '=' => {
                                    lexer.step();
                                    lexer.token = T.t_bar_bar_equals;
                                },

                                else => {
                                    lexer.token = T.t_bar_bar;
                                },
                            }
                        },
                        else => {
                            lexer.token = T.t_bar;
                        },
                    }
                },

                '^' => {
                    // '^' or '^='
                    lexer.step();
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = T.t_caret_equals;
                        },

                        else => {
                            lexer.token = T.t_caret;
                        },
                    }
                },

                '+' => {
                    // '+' or '+=' or '++'
                    lexer.step();
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = T.t_plus_equals;
                        },

                        '+' => {
                            lexer.step();
                            lexer.token = T.t_plus_plus;
                        },

                        else => {
                            lexer.token = T.t_plus;
                        },
                    }
                },

                '=' => {
                    // '=' or '=>' or '==' or '==='
                    lexer.step();
                    switch (lexer.code_point) {
                        '>' => {
                            lexer.step();
                            lexer.token = T.t_equals_greater_than;
                        },

                        '=' => {
                            lexer.step();
                            switch (lexer.code_point) {
                                '=' => {
                                    lexer.step();
                                    lexer.token = T.t_equals_equals_equals;
                                },

                                else => {
                                    lexer.token = T.t_equals_equals;
                                },
                            }
                        },

                        else => {
                            lexer.token = T.t_equals;
                        },
                    }
                },

                '<' => {
                    // '<' or '<<' or '<=' or '<<=' or '<!--'
                    lexer.step();
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = T.t_less_than_equals;
                        },

                        '<' => {
                            lexer.step();
                            switch (lexer.code_point) {
                                '=' => {
                                    lexer.step();
                                    lexer.token = T.t_less_than_less_than_equals;
                                },

                                else => {
                                    lexer.token = T.t_less_than_less_than;
                                },
                            }
                        },
                        // Handle legacy HTML-style comments
                        '!' => {
                            if (std.mem.eql(u8, lexer.peek("--".len), "--")) {
                                lexer.addUnsupportedSyntaxError("Legacy HTML comments not implemented yet!");
                                return;
                            }

                            lexer.token = T.t_less_than;
                        },

                        else => {
                            lexer.token = T.t_less_than;
                        },
                    }
                },

                '>' => {
                    // '>' or '>>' or '>>>' or '>=' or '>>=' or '>>>='
                    lexer.step();

                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = T.t_greater_than_equals;
                        },
                        '>' => {
                            lexer.step();
                            switch (lexer.code_point) {
                                '=' => {
                                    lexer.step();
                                    lexer.token = T.t_greater_than_greater_than_equals;
                                },
                                '>' => {
                                    lexer.step();
                                    switch (lexer.code_point) {
                                        '=' => {
                                            lexer.step();
                                            lexer.token = T.t_greater_than_greater_than_greater_than_equals;
                                        },
                                        else => {
                                            lexer.token = T.t_greater_than_greater_than_greater_than;
                                        },
                                    }
                                },
                                else => {
                                    lexer.token = T.t_greater_than_greater_than;
                                },
                            }
                        },
                        else => {
                            lexer.token = T.t_greater_than;
                        },
                    }
                },

                '!' => {
                    // '!' or '!=' or '!=='
                    lexer.step();
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            switch (lexer.code_point) {
                                '=' => {
                                    lexer.step();
                                    lexer.token = T.t_exclamation_equals_equals;
                                },

                                else => {
                                    lexer.token = T.t_exclamation_equals;
                                },
                            }
                        },
                        else => {
                            lexer.token = T.t_exclamation;
                        },
                    }
                },

                '\'', '"', '`' => {
                    const quote = lexer.code_point;
                    var needsSlowPath = false;
                    var suffixLen = 1;

                    if (quote != '`') {
                        lexer.token = T.t_string_literal;
                    } else if (lexer.rescan_close_brace_as_template_token) {
                        lexer.token = T.t_template_tail;
                    } else {
                        lexer.token = T.t_no_substitution_template_literal;
                    }
                    lexer.step();

                    stringLiteral: while (true) {
                        switch (lexer.codePoint) {
                            '\\' => {
                                needs_slow_path = true;
                                lexer.step();

                                // Handle Windows CRLF
                                if (lexer.code_point == '\r' and IS_JSON_FILE) {
                                    lexer.step();
                                    if (lexer.code_point == '\n') {
                                        lexer.step();
                                    }
                                    continue;
                                }
                            },
                            // This indicates the end of the file

                            -1 => {
                                lexer.addError("Unterminated string literal");
                            },

                            '\r' => {
                                if (quote != '`') {
                                    lexer.addError("Unterminated string literal");
                                }

                                // Template literals require newline normalization
                                needsSlowPath = true;
                            },

                            '\n' => {
                                if (quote != '`') {
                                    lexer.addError("Unterminated string literal");
                                }
                            },

                            '$' => {
                                if (quote == '`') {
                                    lexer.step();
                                    if (lexer.codePoint == '{') {
                                        suffixLen = 2;
                                        lexer.step();
                                        if (lexer.rescan_close_brace_as_template_token) {
                                            lexer.token = T.t_template_middle;
                                        } else {
                                            lexer.token = T.t_template_head;
                                        }
                                        break stringLiteral;
                                    }
                                    continue;
                                }
                            },

                            quote => {
                                lexer.step();
                                break stringLiteral;
                            },

                            else => {
                                // Non-ASCII strings need the slow path
                                if (lexer.codePoint >= 0x80) {
                                    needsSlowPath = true;
                                } else if (IS_JSON_FILE and lexer.codePoint < 0x20) {
                                    lexer.syntax_error();
                                }
                            },
                        }
                        lexer.step();
                    }

                    const text = lexer.source.Contents[lexer.start + 1 .. lexer.end - suffixLen];

                    if (needsSlowPath) {
                        // Slow path
                        lexer.string_literal = lexer.decodeEscapeSequences(lexer.start + 1, text);
                    } else {
                        // Fast path

                    }
                },

                '_', '$', 'a'...'z', 'A'...'Z' => {
                    lexer.step();
                    while (isIdentifierContinue(lexer.code_point)) {
                        lexer.step();
                    }

                    if (lexer.codePoint == '\\') {
                        lexer.scanIdentifierWithEscapes();
                    } else {
                        const contents = lexer.raw();
                        lexer.identifier = contents;
                        if (Keywords.get(contents)) |keyword| {
                            lexer.token = keyword;
                        } else {
                            lexer.token = T.t_identifier;
                        }
                    }
                },

                '\\' => {
                    // TODO: normal
                    lexer.scanIdentifierWithEscapes();
                },

                '.', '0'...'9' => {
                    lexer.parseNumericLiteralOrDot();
                },

                else => {
                    // Check for unusual whitespace characters
                    if (isWhitespace(lexer.code_point)) {
                        lexer.step();
                        continue;
                    }

                    if (isIdentifierStart(lexer.code_point)) {
                        lexer.step();
                        while (isIdentifierContinue(lexer.code_point)) {
                            lexer.step();
                        }
                        if (lexer.code_point == '\\') {

                            // lexer.Identifier, lexer.Token = lexer.scanIdentifierWithEscapes(normalIdentifier);
                        } else {
                            lexer.token = T.t_identifier;
                            lexer.identifier = lexer.raw();
                        }
                        break;
                    }

                    lexer.end = lexer.current;
                    lexer.token = T.t_syntax_error;
                },
            }
        }
    }

    pub fn expected(self: *Lexer, token: T) void {
        if (tokenToString.has(text)) {
            self.expectedString(text);
        } else {
            self.unexpected();
        }
    }

    pub fn raw(self: *Lexer) []const u8 {
        return self.source.contents[self.start..self.end];
    }

    pub fn expectedString(self: *Lexer, text: string) void {
        var found = text;
        if (self.source.contents.len == self.start) {
            found = "end of file";
        }
        self.addRangeError(self.range(), "Expected %s but found %s", .{ text, found }, true);
    }

    pub fn range(self: *Lexer) logger.Range {
        return logger.Range{
            .start = self.start,
            .len = self.end - self.start,
        };
    }

    pub fn init(log: logger.Log, source: logger.Source, allocator: *std.mem.Allocator) !Lexer {
        var lex = Lexer{
            .log = log,
            .source = source,
            .string_literal = try std.ArrayList([]u16).initCapacity(allocator, 16),
            .prev_error_loc = -1,
        };
        lex.step();
        // lex.next();

        return lex;
    }
};

fn isIdentifierStart(codepoint: CodePoint) bool {
    switch (codepoint) {
        'a'...'z', 'A'...'Z', '_', '$' => {
            return true;
        },
        else => {
            return false;
        },
    }
}
fn isIdentifierContinue(codepoint: CodePoint) bool {
    switch (codepoint) {
        '_', '$', '0'...'9', 'a'...'z', 'A'...'Z' => {
            return true;
        },
        else => {},
    }

    // All ASCII identifier start code points are listed above
    if (codepoint < 0x7F) {
        return false;
    }

    // ZWNJ and ZWJ are allowed in identifiers
    if (codepoint == 0x200C or codepoint == 0x200D) {
        return true;
    }

    return false;
}

fn isWhitespace(codepoint: CodePoint) bool {
    switch (codepoint) {
        0x000B, // line tabulation
        0x0009, // character tabulation
        0x000C, // form feed
        0x0020, // space
        0x00A0, // no-break space
        // Unicode "Space_Separator" code points
        0x1680, // ogham space mark
        0x2000, // en quad
        0x2001, // em quad
        0x2002, // en space
        0x2003, // em space
        0x2004, // three-per-em space
        0x2005, // four-per-em space
        0x2006, // six-per-em space
        0x2007, // figure space
        0x2008, // punctuation space
        0x2009, // thin space
        0x200A, // hair space
        0x202F, // narrow no-break space
        0x205F, // medium mathematical space
        0x3000, // ideographic space
        0xFEFF,
        => {
            return true;
        }, // zero width non-breaking space
        else => {
            return false;
        },
    }
}

test "Lexer.next()" {
    const msgs = std.ArrayList(logger.Msg).init(std.testing.allocator);
    const log = logger.Log{
        .msgs = msgs,
    };

    defer std.testing.allocator.free(msgs.items);
    const source = logger.Source.initPathString("index.js", "for (let i = 0; i < 100; i++) { console.log('hi'); }", std.heap.page_allocator);

    var lex = try Lexer.init(log, source, std.testing.allocator);
    defer lex.string_literal.shrinkAndFree(0);
    lex.next();
}

test "Lexer.step()" {
    const msgs = std.ArrayList(logger.Msg).init(std.testing.allocator);
    const log = logger.Log{
        .msgs = msgs,
    };

    defer std.testing.allocator.free(msgs.items);
    const source = logger.Source.initPathString("index.js", "for (let i = 0; i < 100; i++) { console.log('hi'); }", std.heap.page_allocator);

    var lex = try Lexer.init(log, source, std.testing.allocator);
    defer lex.string_literal.shrinkAndFree(0);
    std.testing.expect('f' == lex.code_point);
    lex.step();
    std.testing.expect('o' == lex.code_point);
    lex.step();
    std.testing.expect('r' == lex.code_point);
    while (lex.current < source.contents.len) {
        std.testing.expect(lex.code_point == source.contents[lex.current - 1]);
        lex.step();
    }
}
