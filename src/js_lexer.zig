const std = @import("std");
const logger = @import("logger.zig");
const tables = @import("js_lexer_tables.zig");
const alloc = @import("alloc.zig");
const build_options = @import("build_options");
const js_ast = @import("js_ast.zig");

usingnamespace @import("ast/base.zig");
usingnamespace @import("strings.zig");

const unicode = std.unicode;

const Source = logger.Source;
pub const T = tables.T;
pub const CodePoint = tables.CodePoint;
pub const Keywords = tables.Keywords;
pub const tokenToString = tables.tokenToString;
pub const StrictModeReservedWords = tables.StrictModeReservedWords;
pub const PropertyModifierKeyword = tables.PropertyModifierKeyword;
pub const TypescriptStmtKeyword = tables.TypescriptStmtKeyword;
pub const TypeScriptAccessibilityModifier = tables.TypeScriptAccessibilityModifier;

fn notimpl() noreturn {
    std.debug.panic("not implemented yet!", .{});
}

pub var emptyJavaScriptString = ([_]u16{0});

pub const JSONOptions = struct {
    allow_comments: bool = false,
    allow_trailing_commas: bool = false,
};

pub const Lexer = struct {
    const LexerType = @This();

    // pub const Error = error{
    //     UnexpectedToken,
    //     EndOfFile,
    // };

    // err: ?LexerType.Error,
    log: *logger.Log,
    json_options: ?JSONOptions = null,
    for_global_name: bool = false,
    source: logger.Source,
    current: usize = 0,
    start: usize = 0,
    end: usize = 0,
    did_panic: bool = false,
    approximate_newline_count: i32 = 0,
    legacy_octal_loc: logger.Loc = logger.Loc.Empty,
    previous_backslash_quote_in_jsx: logger.Range = logger.Range.None,
    token: T = T.t_end_of_file,
    has_newline_before: bool = false,
    has_pure_comment_before: bool = false,
    preserve_all_comments_before: bool = false,
    is_legacy_octal_literal: bool = false,
    comments_to_preserve_before: std.ArrayList(js_ast.G.Comment),
    all_original_comments: ?[]js_ast.G.Comment = null,
    code_point: CodePoint = -1,
    string_literal: JavascriptString,
    identifier: []const u8 = "",
    jsx_factory_pragma_comment: ?js_ast.Span = null,
    jsx_fragment_pragma_comment: ?js_ast.Span = null,
    source_mapping_url: ?js_ast.Span = null,
    number: f64 = 0.0,
    rescan_close_brace_as_template_token: bool = false,
    prev_error_loc: logger.Loc = logger.Loc.Empty,
    allocator: *std.mem.Allocator,

    pub fn loc(self: *LexerType) logger.Loc {
        return logger.usize2Loc(self.start);
    }

    fn nextCodepointSlice(it: *LexerType) callconv(.Inline) ?[]const u8 {
        if (it.current >= it.source.contents.len) {
            // without this line, strings cut off one before the last characte
            it.end = it.current;
            return null;
        }

        const cp_len = unicode.utf8ByteSequenceLength(it.source.contents[it.current]) catch unreachable;
        it.end = it.current;
        it.current += cp_len;

        return it.source.contents[it.current - cp_len .. it.current];
    }

    pub fn syntaxError(self: *LexerType) void {
        self.addError(self.start, "Syntax Error!!", .{}, true);
    }

    pub fn addDefaultError(self: *LexerType, msg: []const u8) void {
        self.addError(self.start, "{s}", .{msg}, true);
    }

    pub fn addError(self: *LexerType, _loc: usize, comptime format: []const u8, args: anytype, panic: bool) void {
        var __loc = logger.usize2Loc(_loc);
        if (__loc.eql(self.prev_error_loc)) {
            return;
        }

        self.log.addErrorFmt(self.source, __loc, self.allocator, format, args) catch unreachable;
        self.prev_error_loc = __loc;
        var msg = self.log.msgs.items[self.log.msgs.items.len - 1];
        msg.formatNoWriter(std.debug.panic);
    }

    pub fn addRangeError(self: *LexerType, r: logger.Range, comptime format: []const u8, args: anytype, panic: bool) void {
        if (self.prev_error_loc.eql(r.loc)) {
            return;
        }

        const errorMessage = std.fmt.allocPrint(self.allocator, format, args) catch unreachable;
        var msg = self.log.addRangeError(self.source, r, errorMessage);
        self.prev_error_loc = r.loc;

        if (panic) {
            var fixedBuffer = [_]u8{0} ** 8096;
            var stream = std.io.fixedBufferStream(&fixedBuffer);
            const writer = stream.writer();
            self.log.print(writer) catch unreachable;

            std.debug.panic("{s}", .{fixedBuffer[0..stream.pos]});
        }
    }

    fn doPanic(self: *LexerType, content: []const u8) void {
        if (@import("builtin").is_test) {
            self.did_panic = true;
        } else {
            std.debug.panic("{s}", .{content});
        }
    }

    pub fn codePointEql(self: *LexerType, a: u8) bool {
        return @intCast(CodePoint, a) == self.code_point;
    }

    fn nextCodepoint(it: *LexerType) callconv(.Inline) CodePoint {
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
    fn peek(it: *LexerType, n: usize) []const u8 {
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

    pub fn isIdentifierOrKeyword(lexer: LexerType) bool {
        return @enumToInt(lexer.token) >= @enumToInt(T.t_identifier);
    }

    fn parseStringLiteral(lexer: *LexerType) void {
        var quote: CodePoint = lexer.code_point;
        var needs_slow_path = false;
        var suffixLen: usize = 1;

        if (quote != '`') {
            lexer.token = T.t_string_literal;
        } else if (lexer.rescan_close_brace_as_template_token) {
            lexer.token = T.t_template_tail;
        } else {
            lexer.token = T.t_no_substitution_template_literal;
        }
        lexer.step();

        stringLiteral: while (true) {
            switch (lexer.code_point) {
                '\\' => {
                    needs_slow_path = true;
                    lexer.step();

                    // Handle Windows CRLF
                    if (lexer.code_point == '\r' and lexer.json_options != null) {
                        lexer.step();
                        if (lexer.code_point == '\n') {
                            lexer.step();
                        }
                        continue :stringLiteral;
                    }
                },
                // This indicates the end of the file

                -1 => {
                    lexer.addDefaultError("Unterminated string literal");
                },

                '\r' => {
                    if (quote != '`') {
                        lexer.addDefaultError("Unterminated string literal");
                    }

                    // Template literals require newline normalization
                    needs_slow_path = true;
                },

                '\n' => {
                    if (quote != '`') {
                        lexer.addDefaultError("Unterminated string literal");
                    }
                },

                '$' => {
                    if (quote == '`') {
                        lexer.step();
                        if (lexer.code_point == '{') {
                            suffixLen = 2;
                            lexer.step();
                            if (lexer.rescan_close_brace_as_template_token) {
                                lexer.token = T.t_template_middle;
                            } else {
                                lexer.token = T.t_template_head;
                            }
                            break :stringLiteral;
                        }
                        continue :stringLiteral;
                    }
                },

                else => {
                    if (quote == lexer.code_point) {
                        lexer.step();
                        break :stringLiteral;
                    }
                    // Non-ASCII strings need the slow path
                    if (lexer.code_point >= 0x80) {
                        needs_slow_path = true;
                    } else if (lexer.json_options != null and lexer.code_point < 0x20) {
                        lexer.syntaxError();
                    }
                },
            }
            lexer.step();
        }

        const text = lexer.source.contents[lexer.start + 1 .. lexer.end - suffixLen];
        if (needs_slow_path) {
            lexer.string_literal = lexer.stringToUTF16(text);
        } else {
            lexer.string_literal = lexer.allocator.alloc(u16, text.len) catch unreachable;
            var i: usize = 0;
            for (text) |byte| {
                lexer.string_literal[i] = byte;
                i += 1;
            }
        }

        if (quote == '\'' and lexer.json_options != null) {
            lexer.addRangeError(lexer.range(), "JSON strings must use double quotes", .{}, true);
        }
        // for (text)
        // // if (needs_slow_path) {
        // //     // Slow path

        // //     // lexer.string_literal = lexer.(lexer.start + 1, text);
        // // } else {
        // //     // Fast path

        // // }
    }

    fn step(lexer: *LexerType) void {
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

    pub fn expect(self: *LexerType, comptime token: T) void {
        if (self.token != token) {
            self.expected(token);
        }

        self.next();
    }

    pub fn expectOrInsertSemicolon(lexer: *LexerType) void {
        if (lexer.token == T.t_semicolon or (!lexer.has_newline_before and
            lexer.token != T.t_close_brace and lexer.token != T.t_end_of_file))
        {
            lexer.expect(T.t_semicolon);
        }
    }

    pub fn addUnsupportedSyntaxError(self: *LexerType, msg: []const u8) void {
        self.addError(self.end, "Unsupported syntax: {s}", .{msg}, true);
    }

    pub fn scanIdentifierWithEscapes(self: *LexerType) void {
        self.addUnsupportedSyntaxError("escape sequence");
        return;
    }

    pub fn debugInfo(self: *LexerType) void {
        if (self.log.errors > 0) {
            const stderr = std.io.getStdErr().writer();
            self.log.print(stderr) catch unreachable;
        } else {
            if (self.token == T.t_identifier or self.token == T.t_string_literal) {
                std.debug.print(" {s} ", .{self.raw()});
            } else {
                std.debug.print(" <{s}> ", .{tokenToString.get(self.token)});
            }
        }
    }

    pub fn expectContextualKeyword(self: *LexerType, comptime keyword: string) void {
        if (!self.isContextualKeyword(keyword)) {
            self.addError(self.start, "\"{s}\"", .{keyword}, true);
        }
        self.next();
    }

    pub fn maybeExpandEquals(lexer: *LexerType) void {
        switch (lexer.code_point) {
            '>' => {
                // "=" + ">" = "=>"
                lexer.token = .t_equals_greater_than;
                lexer.step();
            },
            '=' => {
                // "=" + "=" = "=="
                lexer.token = .t_equals_equals;
                lexer.step();

                if (lexer.code_point == '=') {
                    // "=" + "==" = "==="
                    lexer.token = .t_equals_equals_equals;
                    lexer.step();
                }
            },
            else => {},
        }
    }

    pub fn expectLessThan(lexer: *LexerType, is_inside_jsx_element: bool) void {
        switch (lexer.token) {
            .t_less_than => {
                if (is_inside_jsx_element) {
                    lexer.nextInsideJSXElement();
                } else {
                    lexer.next();
                }
            },
            .t_less_than_equals => {
                lexer.token = .t_equals;
                lexer.start += 1;
                lexer.maybeExpandEquals();
            },
            .t_less_than_less_than => {
                lexer.token = .t_less_than;
                lexer.start += 1;
            },
            .t_less_than_less_than_equals => {
                lexer.token = .t_less_than_equals;
                lexer.start += 1;
            },
            else => {
                lexer.expected(.t_less_than);
            },
        }
    }

    pub fn expectGreaterThan(lexer: *LexerType, is_inside_jsx_element: bool) !void {
        switch (lexer.token) {
            .t_greater_than => {
                if (is_inside_jsx_element) {
                    try lexer.nextInsideJSXElement();
                } else {
                    lexer.next();
                }
            },
            .t_greater_than_equals => {
                lexer.token = .t_equals;
                lexer.start += 1;
                lexer.maybeExpandEquals();
            },
            .t_greater_than_greater_than => {
                lexer.token = .t_greater_than;
                lexer.start += 1;
            },
            .t_greater_than_greater_than_equals => {
                lexer.token = .t_greater_than_greater_than;
                lexer.start += 1;
            },
            .t_greater_than_greater_than_greater_than => {
                lexer.token = .t_greater_than_greater_than_equals;
                lexer.start += 1;
            },
            else => {
                lexer.expected(.t_greater_than);
            },
        }
    }

    pub fn next(lexer: *LexerType) void {
        lexer.has_newline_before = lexer.end == 0;

        lex: while (true) {
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
                        lexer.syntaxError();
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

                '-' => {
                    // '+' or '+=' or '++'
                    lexer.step();
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = T.t_minus_equals;
                        },

                        '-' => {
                            lexer.step();

                            if (lexer.code_point == '>' and lexer.has_newline_before) {
                                lexer.step();
                                lexer.log.addRangeWarning(lexer.source, lexer.range(), "Treating \"-->\" as the start of a legacy HTML single-line comment") catch unreachable;

                                singleLineHTMLCloseComment: while (true) {
                                    switch (lexer.code_point) {
                                        '\r', '\n', 0x2028, 0x2029 => {
                                            break :singleLineHTMLCloseComment;
                                        },
                                        -1 => {
                                            break :singleLineHTMLCloseComment;
                                        },
                                        else => {},
                                    }
                                    lexer.step();
                                }
                                continue;
                            }

                            lexer.token = T.t_minus_minus;
                        },

                        else => {
                            lexer.token = T.t_minus;
                        },
                    }
                },

                '*' => {
                    // '*' or '*=' or '**' or '**='

                    lexer.step();
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = .t_asterisk_equals;
                        },
                        '*' => {
                            lexer.step();
                            switch (lexer.code_point) {
                                '=' => {
                                    lexer.step();
                                    lexer.token = .t_asterisk_asterisk_equals;
                                },
                                else => {
                                    lexer.token = .t_asterisk_asterisk;
                                },
                            }
                        },
                        else => {
                            lexer.token = .t_asterisk;
                        },
                    }
                },
                '/' => {
                    // '/' or '/=' or '//' or '/* ... */'
                    lexer.step();

                    if (lexer.for_global_name) {
                        lexer.token = .t_slash;
                        break;
                    }
                    switch (lexer.code_point) {
                        '=' => {
                            lexer.step();
                            lexer.token = .t_slash_equals;
                        },
                        '/' => {
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

                            if (lexer.json_options) |json| {
                                if (!json.allow_comments) {
                                    lexer.addRangeError(lexer.range(), "JSON does not support comments", .{}, true);
                                    return;
                                }
                            }
                            lexer.scanCommentText();
                            continue;
                        },
                        '*' => {
                            lexer.step();

                            multiLineComment: while (true) {
                                switch (lexer.code_point) {
                                    '*' => {
                                        lexer.step();
                                        if (lexer.code_point == '/') {
                                            lexer.step();
                                            break :multiLineComment;
                                        }
                                    },
                                    '\r', '\n', 0x2028, 0x2029 => {
                                        lexer.step();
                                        lexer.has_newline_before = true;
                                    },
                                    -1 => {
                                        lexer.start = lexer.end;
                                        lexer.addError(lexer.start, "Expected \"*/\" to terminate multi-line comment", .{}, true);
                                    },
                                    else => {
                                        lexer.step();
                                    },
                                }
                            }
                            if (lexer.json_options) |json| {
                                if (!json.allow_comments) {
                                    lexer.addRangeError(lexer.range(), "JSON does not support comments", .{}, true);
                                    return;
                                }
                            }
                            lexer.scanCommentText();
                            continue;
                        },
                        else => {
                            lexer.token = .t_slash;
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
                    lexer.parseStringLiteral();
                },

                '_', '$', 'a'...'z', 'A'...'Z' => {
                    lexer.step();
                    while (isIdentifierContinue(lexer.code_point)) {
                        lexer.step();
                    }

                    if (lexer.code_point == '\\') {
                        lexer.scanIdentifierWithEscapes();
                    } else {
                        const contents = lexer.raw();
                        lexer.identifier = contents;
                        lexer.token = Keywords.get(contents) orelse T.t_identifier;
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

            return;
        }
    }

    pub fn expected(self: *LexerType, token: T) void {
        if (tokenToString.get(token).len > 0) {
            self.expectedString(tokenToString.get(token));
        } else {
            self.unexpected();
        }
    }

    pub fn unexpected(lexer: *LexerType) void {
        const found = finder: {
            if (lexer.start == lexer.source.contents.len) {
                break :finder "end of file";
            } else {
                break :finder lexer.raw();
            }
        };

        lexer.addRangeError(lexer.range(), "Unexpected {s}", .{found}, true);
    }

    pub fn raw(self: *LexerType) []const u8 {
        return self.source.contents[self.start..self.end];
    }

    pub fn isContextualKeyword(self: *LexerType, comptime keyword: string) bool {
        return self.token == .t_identifier and strings.eql(self.raw(), keyword);
    }

    pub fn expectedString(self: *LexerType, text: string) void {
        const found = finder: {
            if (self.source.contents.len != self.start) {
                break :finder self.raw();
            } else {
                break :finder "end of file";
            }
        };

        self.addRangeError(self.range(), "Expected {s} but found {s}", .{ text, found }, true);
    }

    pub fn scanCommentText(lexer: *LexerType) void {
        var text = lexer.source.contents[lexer.start..lexer.end];
        const has_preserve_annotation = text.len > 2 and text[2] == '!';
        const is_multiline_comment = text[1] == '*';

        // Omit the trailing "*/" from the checks below
        var endCommentText = text.len;
        if (is_multiline_comment) {
            endCommentText -= 2;
        }

        if (has_preserve_annotation or lexer.preserve_all_comments_before) {
            if (is_multiline_comment) {
                // text = lexer.removeMultilineCommentIndent(lexer.source.contents[0..lexer.start], text);
            }

            lexer.comments_to_preserve_before.append(js_ast.G.Comment{
                .text = text,
                .loc = lexer.loc(),
            }) catch unreachable;
        }
    }

    // TODO: implement this
    // it's too complicated to handle all the edgecases right now given the state of Zig's standard library
    pub fn removeMultilineCommentIndent(lexer: *LexerType, _prefix: string, text: string) string {
        return text;
    }

    pub fn range(self: *LexerType) logger.Range {
        return logger.Range{
            .loc = logger.usize2Loc(self.start),
            .len = std.math.lossyCast(i32, self.end - self.start),
        };
    }

    pub fn initGlobalName(log: *logger.Log, source: *logger.Source, allocator: *std.mem.Allocator) !LexerType {
        var empty_string_literal: JavascriptString = emptyJavaScriptString;
        var lex = LexerType{
            .log = log,
            .source = source.*,
            .string_literal = empty_string_literal,
            .prev_error_loc = logger.Loc.Empty,
            .allocator = allocator,
            .comments_to_preserve_before = std.ArrayList(js_ast.G.Comment).init(allocator),
            .for_global_name = true,
        };
        lex.step();
        lex.next();

        return lex;
    }

    pub fn initTSConfig(log: *logger.Log, source: *logger.Source, allocator: *std.mem.Allocator) !LexerType {
        var empty_string_literal: JavascriptString = emptyJavaScriptString;
        var lex = LexerType{
            .log = log,
            .source = source.*,
            .string_literal = empty_string_literal,
            .prev_error_loc = logger.Loc.Empty,
            .allocator = allocator,
            .comments_to_preserve_before = std.ArrayList(js_ast.G.Comment).init(allocator),
            .json_options = JSONOptions{
                .allow_comments = true,
                .allow_trailing_commas = true,
            },
        };
        lex.step();
        lex.next();

        return lex;
    }

    pub fn initJSON(log: *logger.Log, source: *logger.Source, allocator: *std.mem.Allocator) !LexerType {
        var empty_string_literal: JavascriptString = &emptyJavaScriptString;
        var lex = LexerType{
            .log = log,
            .source = source.*,
            .string_literal = empty_string_literal,
            .prev_error_loc = logger.Loc.Empty,
            .allocator = allocator,
            .comments_to_preserve_before = std.ArrayList(js_ast.G.Comment).init(allocator),
            .json_options = JSONOptions{
                .allow_comments = false,
                .allow_trailing_commas = false,
            },
        };
        lex.step();
        lex.next();

        return lex;
    }

    pub fn init(log: *logger.Log, source: *logger.Source, allocator: *std.mem.Allocator) !LexerType {
        try tables.initJSXEntityMap();
        var empty_string_literal: JavascriptString = &emptyJavaScriptString;
        var lex = LexerType{
            .log = log,
            .source = source.*,
            .string_literal = empty_string_literal,
            .prev_error_loc = logger.Loc.Empty,
            .allocator = allocator,
            .comments_to_preserve_before = std.ArrayList(js_ast.G.Comment).init(allocator),
        };
        lex.step();
        lex.next();

        return lex;
    }

    pub fn scanRegExp(lexer: *LexerType) void {
        while (true) {
            switch (lexer.code_point) {
                '/' => {
                    lexer.step();
                    while (isIdentifierContinue(lexer.code_point)) {
                        switch (lexer.code_point) {
                            'g', 'i', 'm', 's', 'u', 'y' => {
                                lexer.step();
                            },
                            else => {
                                lexer.syntaxError();
                            },
                        }
                    }
                },
                '[' => {
                    lexer.step();
                    while (lexer.code_point != ']') {
                        lexer.scanRegExpValidateAndStep();
                    }
                    lexer.step();
                },
                else => {
                    lexer.scanRegExpValidateAndStep();
                },
            }
        }
    }

    // TODO: use wtf-8 encoding.
    pub fn stringToUTF16(lexer: *LexerType, str: string) JavascriptString {
        var buf: JavascriptString = lexer.allocator.alloc(u16, std.mem.len(str)) catch unreachable;
        // theres prob a faster/better way
        for (str) |char, i| {
            buf[i] = char;
        }

        return buf;
    }

    // TODO: use wtf-8 encoding.
    pub fn utf16ToStringWithValidation(lexer: *LexerType, js: JavascriptString) !string {
        return std.unicode.utf16leToUtf8Alloc(lexer.allocator, js);
    }

    // TODO: use wtf-8 encoding.
    pub fn utf16ToString(lexer: *LexerType, js: JavascriptString) string {
        return std.unicode.utf16leToUtf8Alloc(lexer.allocator, js) catch unreachable;
    }

    pub fn nextInsideJSXElement(lexer: *LexerType) !void {
        lexer.has_newline_before = false;

        while (true) {
            lexer.start = lexer.end;
            lexer.token = .t_end_of_file;

            switch (lexer.code_point) {
                -1 => {
                    lexer.token = .t_end_of_file;
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
                '.' => {
                    lexer.step();
                    lexer.token = .t_dot;
                },
                '=' => {
                    lexer.step();
                    lexer.token = .t_equals;
                },
                '{' => {
                    lexer.step();
                    lexer.token = .t_open_brace;
                },
                '}' => {
                    lexer.step();
                    lexer.token = .t_close_brace;
                },
                '<' => {
                    lexer.step();
                    lexer.token = .t_less_than;
                },
                '>' => {
                    lexer.step();
                    lexer.token = .t_greater_than;
                },
                '/' => {
                    // '/' or '//' or '/* ... */'

                    lexer.step();
                    switch (lexer.code_point) {
                        '/' => {
                            single_line_comment: {
                                while (true) {
                                    lexer.step();
                                    switch (lexer.code_point) {
                                        '\r', '\n', 0x2028, 0x2029 => {
                                            break :single_line_comment;
                                        },
                                        -1 => {
                                            break :single_line_comment;
                                        },
                                        else => {},
                                    }
                                }
                                continue;
                            }
                        },
                        '*' => {
                            lexer.step();
                            const start_range = lexer.range();
                            multi_line_comment: {
                                while (true) {
                                    switch (lexer.code_point) {
                                        '*' => {
                                            lexer.step();
                                            if (lexer.code_point == '/') {
                                                lexer.step();
                                                break :multi_line_comment;
                                            }
                                        },
                                        '\r', '\n', 0x2028, 0x2029 => {
                                            lexer.step();
                                            lexer.has_newline_before = true;
                                        },
                                        -1 => {
                                            lexer.start = lexer.end;
                                            lexer.addError(lexer.start, "Expected \"*/\" to terminate multi-line comment", .{}, true);
                                        },
                                        else => {
                                            lexer.step();
                                        },
                                    }
                                }
                                continue;
                            }
                        },
                        else => {
                            lexer.token = .t_slash;
                        },
                    }
                },
                '\'' => {
                    lexer.step();
                    try lexer.parseJSXStringLiteral('\'');
                },
                '"' => {
                    lexer.step();
                    try lexer.parseJSXStringLiteral('"');
                },
                else => {
                    if (isWhitespace(lexer.code_point)) {
                        lexer.step();
                        continue;
                    }

                    if (isIdentifierStart(lexer.code_point)) {
                        lexer.step();
                        while (isIdentifierContinue(lexer.code_point) or lexer.code_point == '-') {
                            lexer.step();
                        }

                        // Parse JSX namespaces. These are not supported by React or TypeScript
                        // but someone using JSX syntax in more obscure ways may find a use for
                        // them. A namespaced name is just always turned into a string so you
                        // can't use this feature to reference JavaScript identifiers.
                        if (lexer.code_point == ':') {
                            lexer.step();

                            if (isIdentifierStart(lexer.code_point)) {
                                while (isIdentifierStart(lexer.code_point) or lexer.code_point == '-') {
                                    lexer.step();
                                }
                            } else {
                                lexer.addError(lexer.range().endI(), "Expected identifier after \"{s}\" in namespaced JSX name", .{lexer.raw()}, true);
                            }
                        }

                        lexer.identifier = lexer.raw();
                        lexer.token = .t_identifier;
                        break;
                    }

                    lexer.end = lexer.current;
                    lexer.token = .t_syntax_error;
                },
            }

            return;
        }
    }
    pub fn parseJSXStringLiteral(lexer: *LexerType, comptime quote: u8) !void {
        var backslash = logger.Range.None;
        var needs_decode = false;

        string_literal: while (true) {
            switch (lexer.code_point) {
                -1 => {
                    lexer.syntaxError();
                },
                '&' => {
                    needs_decode = true;
                    lexer.step();
                },
                '\\' => {
                    backslash = logger.Range{ .loc = logger.Loc{
                        .start = @intCast(i32, lexer.end),
                    }, .len = 1 };
                    lexer.step();
                    continue;
                },
                quote => {
                    if (backslash.len > 0) {
                        backslash.len += 1;
                        lexer.previous_backslash_quote_in_jsx = backslash;
                    }
                    lexer.step();
                    // not sure about this!
                    break :string_literal;
                },
                else => {
                    // Non-ASCII strings need the slow path
                    if (lexer.code_point >= 0x80) {
                        needs_decode = true;
                    }
                    lexer.step();
                },
            }
            backslash = logger.Range.None;
        }

        lexer.token = .t_string_literal;
        const text = lexer.source.contents[lexer.start + 1 .. lexer.end - 1];

        if (needs_decode) {
            var out = std.ArrayList(u16).init(lexer.allocator);
            // slow path
            try lexer.decodeJSXEntities(text, &out);
            lexer.string_literal = out.toOwnedSlice();
        } else {
            // fast path
            lexer.string_literal = lexer.stringToUTF16(text);
        }
    }

    pub fn expectJSXElementChild(lexer: *LexerType, token: T) !void {
        if (lexer.token != token) {
            lexer.expected(token);
        }

        try lexer.nextJSXElementChild();
    }

    pub fn nextJSXElementChild(lexer: *LexerType) !void {
        lexer.has_newline_before = false;
        const original_start = lexer.end;

        while (true) {
            lexer.start = lexer.end;
            lexer.token = T.t_end_of_file;

            switch (lexer.code_point) {
                -1 => {
                    lexer.token = .t_end_of_file;
                },
                '{' => {
                    lexer.step();
                    lexer.token = .t_open_brace;
                },
                '<' => {
                    lexer.step();
                    lexer.token = .t_less_than;
                },
                else => {
                    var needs_fixing = false;

                    string_literal: while (true) {
                        switch (lexer.code_point) {
                            -1 => {
                                lexer.syntaxError();
                            },
                            '&', '\r', '\n', 0x2028, 0x2029 => {
                                needs_fixing = true;
                                lexer.step();
                            },
                            '{', '<' => {
                                break :string_literal;
                            },
                            else => {
                                // Non-ASCII strings need the slow path
                                if (lexer.code_point >= 0x80) {
                                    needs_fixing = true;
                                }
                                lexer.step();
                            },
                        }
                    }

                    lexer.token = .t_string_literal;
                    const text = lexer.source.contents[original_start..lexer.end];

                    if (needs_fixing) {
                        // slow path
                        lexer.string_literal = try fixWhitespaceAndDecodeJSXEntities(lexer, text);

                        if (lexer.string_literal.len == 0) {
                            lexer.has_newline_before = true;
                            continue;
                        }
                    } else {
                        lexer.string_literal = lexer.stringToUTF16(text);
                    }
                },
            }

            break;
        }
    }

    pub fn fixWhitespaceAndDecodeJSXEntities(lexer: *LexerType, text: string) !JavascriptString {
        var decoded = std.ArrayList(u16).init(lexer.allocator);
        var decoded_ptr = &decoded;
        var i: usize = 0;
        var after_last_non_whitespace: ?usize = null;

        // Trim whitespace off the end of the first line
        var first_non_whitespace: ?usize = null;

        while (i < text.len) {
            const width = try std.unicode.utf8ByteSequenceLength(text[i]);
            const i_0 = i;
            var buf = [4]u8{ 0, 0, 0, 0 };
            std.mem.copy(u8, &buf, text[i_0 .. i_0 + width]);
            var c = std.mem.readIntNative(i32, &buf);

            switch (c) {
                '\r', '\n', 0x2028, 0x2029 => {
                    if (first_non_whitespace != null and after_last_non_whitespace != null) {
                        // Newline
                        if (decoded.items.len > 0) {
                            try decoded.append(' ');
                        }

                        // Trim whitespace off the start and end of lines in the middle
                        try lexer.decodeJSXEntities(text[first_non_whitespace.?..after_last_non_whitespace.?], &decoded);
                    }

                    // Reset for the next line
                    first_non_whitespace = null;
                },
                '\t', ' ' => {},
                else => {
                    // Check for unusual whitespace characters
                    if (!isWhitespace(@intCast(CodePoint, c))) {
                        after_last_non_whitespace = i + width;
                        if (first_non_whitespace == null) {
                            first_non_whitespace = i;
                        }
                    }
                },
            }
            i += width;
        }

        if (first_non_whitespace) |start| {
            if (decoded.items.len > 0) {
                try decoded.append(' ');
            }

            try decodeJSXEntities(lexer, text[start..text.len], decoded_ptr);
        }

        return decoded.toOwnedSlice();
    }

    pub fn decodeJSXEntities(lexer: *LexerType, text: string, out: *std.ArrayList(u16)) !void {
        var i: usize = 0;
        var buf = [4]u8{ 0, 0, 0, 0 };
        var c: i32 = 0;
        var i_0: usize = 0;
        var width: u3 = 0;
        var buf_ptr = &buf;

        while (i < text.len) {
            // We skip decoding because we've already decoded it here.
            width = try std.unicode.utf8ByteSequenceLength(text[i]);
            i_0 = i;
            i += width;
            std.mem.copy(u8, buf_ptr, text[i_0..i]);
            c = std.mem.readIntNative(i32, buf_ptr);

            if (c == '&') {
                if (strings.indexOfChar(text[i..text.len], ';')) |length| {
                    const entity = text[i .. i + length];
                    if (entity[0] == '#') {
                        var number = entity[1..entity.len];
                        var base: u8 = 10;
                        if (number.len > 1 and number[0] == 'x') {
                            number = number[1..number.len];
                            base = 16;
                        }
                        c = try std.fmt.parseInt(i32, number, base);
                        i += length + 1;
                    } else if (tables.jsxEntity.get(entity)) |ent| {
                        c = ent;
                        i += length + 1;
                    }
                }
            }

            if (c <= 0xFFFF) {
                try out.append(@intCast(u16, c));
            } else {
                c -= 0x1000;
                try out.ensureUnusedCapacity(2);
                out.appendAssumeCapacity(@intCast(u16, 0xD800 + ((c >> 10) & 0x3FF)));
                out.appendAssumeCapacity(@intCast(u16, 0xDC00 + (c & 0x3FF)));
            }
        }
    }
    pub fn expectInsideJSXElement(lexer: *LexerType, token: T) !void {
        if (lexer.token != token) {
            lexer.expected(token);
        }

        try lexer.nextInsideJSXElement();
    }

    fn scanRegExpValidateAndStep(lexer: *LexerType) void {
        if (lexer.code_point == '\\') {
            lexer.step();
        }

        switch (lexer.code_point) {
            '\r', '\n', 0x2028, 0x2029 => {
                // Newlines aren't allowed in regular expressions
                lexer.syntaxError();
            },
            -1 => { // EOF
                lexer.syntaxError();
            },
            else => {
                lexer.step();
            },
        }
    }

    pub fn rescanCloseBraceAsTemplateToken(lexer: *LexerType) void {
        if (lexer.token != .t_close_brace) {
            lexer.expected(.t_close_brace);
        }

        lexer.rescan_close_brace_as_template_token = true;
        lexer.code_point = '`';
        lexer.current = lexer.end;
        lexer.end -= 1;
        lexer.next();
        lexer.rescan_close_brace_as_template_token = false;
    }

    pub fn rawTemplateContents(lexer: *LexerType) string {
        var text: string = undefined;

        switch (lexer.token) {
            .t_no_substitution_template_literal, .t_template_tail => {
                text = lexer.source.contents[lexer.start + 1 .. lexer.end - 1];
            },
            .t_template_middle, .t_template_head => {
                text = lexer.source.contents[lexer.start + 1 .. lexer.end - 2];
            },
            else => {},
        }

        if (strings.indexOfChar(text, '\r') == null) {
            return text;
        }

        // From the specification:
        //
        // 11.8.6.1 Static Semantics: TV and TRV
        //
        // TV excludes the code units of LineContinuation while TRV includes
        // them. <CR><LF> and <CR> LineTerminatorSequences are normalized to
        // <LF> for both TV and TRV. An explicit EscapeSequence is needed to
        // include a <CR> or <CR><LF> sequence.
        var bytes = MutableString.initCopy(lexer.allocator, text) catch unreachable;
        var end: usize = 0;
        var i: usize = 0;
        var c: u8 = '0';
        while (i < bytes.list.items.len) {
            c = bytes.list.items[i];
            i += 1;

            if (c == '\r') {
                // Convert '\r\n' into '\n'
                if (i < bytes.list.items.len and bytes.list.items[i] == '\n') {
                    i += 1;
                }

                // Convert '\r' into '\n'
                c = '\n';
            }

            bytes.list.items[end] = c;
            end += 1;
        }

        return bytes.toOwnedSliceLength(end + 1);
    }

    fn parseNumericLiteralOrDot(lexer: *LexerType) void {
        // Number or dot;
        var first = lexer.code_point;
        lexer.step();

        // Dot without a digit after it;
        if (first == '.' and (lexer.code_point < '0' or lexer.code_point > '9')) {
            // "..."
            if ((lexer.code_point == '.' and
                lexer.current < lexer.source.contents.len) and
                lexer.source.contents[lexer.current] == '.')
            {
                lexer.step();
                lexer.step();
                lexer.token = T.t_dot_dot_dot;
                return;
            }

            // "."
            lexer.token = T.t_dot;
            return;
        }

        var underscoreCount: usize = 0;
        var lastUnderscoreEnd: usize = 0;
        var hasDotOrExponent = first == '.';
        var base: f32 = 0.0;
        lexer.is_legacy_octal_literal = false;

        // Assume this is a number, but potentially change to a bigint later;
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
                    lexer.is_legacy_octal_literal = true;
                },
                else => {},
            }
        }

        if (base != 0) {
            // Integer literal;
            var isFirst = true;
            var isInvalidLegacyOctalLiteral = false;
            lexer.number = 0;
            if (!lexer.is_legacy_octal_literal) {
                lexer.step();
            }

            integerLiteral: while (true) {
                switch (lexer.code_point) {
                    '_' => {
                        // Cannot have multiple underscores in a row;
                        if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                            lexer.syntaxError();
                        }

                        // The first digit must exist;
                        if (isFirst or lexer.is_legacy_octal_literal) {
                            lexer.syntaxError();
                        }

                        lastUnderscoreEnd = lexer.end;
                        underscoreCount += 1;
                    },

                    '0', '1' => {
                        lexer.number = lexer.number * base + float64(lexer.code_point - '0');
                    },

                    '2', '3', '4', '5', '6', '7' => {
                        if (base == 2) {
                            lexer.syntaxError();
                        }
                        lexer.number = lexer.number * base + float64(lexer.code_point - '0');
                    },
                    '8', '9' => {
                        if (lexer.is_legacy_octal_literal) {
                            isInvalidLegacyOctalLiteral = true;
                        } else if (base < 10) {
                            lexer.syntaxError();
                        }
                        lexer.number = lexer.number * base + float64(lexer.code_point - '0');
                    },
                    'A', 'B', 'C', 'D', 'E', 'F' => {
                        if (base != 16) {
                            lexer.syntaxError();
                        }
                        lexer.number = lexer.number * base + float64(lexer.code_point + 10 - 'A');
                    },

                    'a', 'b', 'c', 'd', 'e', 'f' => {
                        if (base != 16) {
                            lexer.syntaxError();
                        }
                        lexer.number = lexer.number * base + float64(lexer.code_point + 10 - 'a');
                    },
                    else => {
                        // The first digit must exist;
                        if (isFirst) {
                            lexer.syntaxError();
                        }

                        break :integerLiteral;
                    },
                }

                lexer.step();
                isFirst = false;
            }

            var isBigIntegerLiteral = lexer.code_point == 'n' and !hasDotOrExponent;

            // Slow path: do we need to re-scan the input as text?
            if (isBigIntegerLiteral or isInvalidLegacyOctalLiteral) {
                var text = lexer.raw();

                // Can't use a leading zero for bigint literals;
                if (isBigIntegerLiteral and lexer.is_legacy_octal_literal) {
                    lexer.syntaxError();
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
                    } else |err| {
                        lexer.addError(lexer.start, "Invalid number {s}", .{text}, true);
                    }
                }
            }
        } else {
            // Floating-point literal;
            var isInvalidLegacyOctalLiteral = first == '0' and (lexer.code_point == '8' or lexer.code_point == '9');

            // Initial digits;
            while (true) {
                if (lexer.code_point < '0' or lexer.code_point > '9') {
                    if (lexer.code_point != '_') {
                        break;
                    }

                    // Cannot have multiple underscores in a row;
                    if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                        lexer.syntaxError();
                    }

                    // The specification forbids underscores in this case;
                    if (isInvalidLegacyOctalLiteral) {
                        lexer.syntaxError();
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
                    lexer.syntaxError();
                }

                hasDotOrExponent = true;
                lexer.step();
                if (lexer.code_point == '_') {
                    lexer.syntaxError();
                }
                while (true) {
                    if (lexer.code_point < '0' or lexer.code_point > '9') {
                        if (lexer.code_point != '_') {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                            lexer.syntaxError();
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
                    lexer.syntaxError();
                }

                hasDotOrExponent = true;
                lexer.step();
                if (lexer.code_point == '+' or lexer.code_point == '-') {
                    lexer.step();
                }
                if (lexer.code_point < '0' or lexer.code_point > '9') {
                    lexer.syntaxError();
                }
                while (true) {
                    if (lexer.code_point < '0' or lexer.code_point > '9') {
                        if (lexer.code_point != '_') {
                            break;
                        }

                        // Cannot have multiple underscores in a row;
                        if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                            lexer.syntaxError();
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
                } else |err| {
                    lexer.addError(lexer.start, "Out of Memory Wah Wah Wah", .{}, true);
                    return;
                }
            }

            if (lexer.code_point == 'n' and !hasDotOrExponent) {
                // The only bigint literal that can start with 0 is "0n"
                if (text.len > 1 and first == '0') {
                    lexer.syntaxError();
                }

                // Store bigints as text to avoid precision loss;
                lexer.identifier = text;
            } else if (!hasDotOrExponent and lexer.end - lexer.start < 10) {
                // Parse a 32-bit integer (very fast path);
                var number: u32 = 0;
                for (text) |c| {
                    number = number * 10 + @intCast(u32, c - '0');
                }
                lexer.number = @intToFloat(f64, number);
            } else {
                // Parse a double-precision floating-point number;
                if (std.fmt.parseFloat(f64, text)) |num| {
                    lexer.number = num;
                } else |err| {
                    lexer.addError(lexer.start, "Invalid number", .{}, true);
                }
            }
        }

        // An underscore must not come last;
        if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
            lexer.end -= 1;
            lexer.syntaxError();
        }

        // Handle bigint literals after the underscore-at-end check above;
        if (lexer.code_point == 'n' and !hasDotOrExponent) {
            lexer.token = T.t_big_integer_literal;
            lexer.step();
        }

        // Identifiers can't occur immediately after numbers;
        if (isIdentifierStart(lexer.code_point)) {
            lexer.syntaxError();
        }
    }
};

pub fn isIdentifierStart(codepoint: CodePoint) bool {
    switch (codepoint) {
        'a'...'z', 'A'...'Z', '_', '$' => {
            return true;
        },
        else => {
            return false;
        },
    }
}
pub fn isIdentifierContinue(codepoint: CodePoint) bool {
    switch (codepoint) {
        '_', '$', '0'...'9', 'a'...'z', 'A'...'Z' => {
            return true;
        },
        -1 => {
            return false;
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

pub fn isWhitespace(codepoint: CodePoint) bool {
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
        0xFEFF, // zero width non-breaking space
        => {
            return true;
        },
        else => {
            return false;
        },
    }
}

pub fn isIdentifier(text: string) bool {
    if (text.len == 0) {
        return false;
    }

    var iter = std.unicode.Utf8Iterator{ .bytes = text, .i = 0 };
    if (!isIdentifierStart(iter.nextCodepoint() orelse unreachable)) {
        return false;
    }

    while (iter.nextCodepoint()) |codepoint| {
        if (!isIdentifierContinue(@intCast(CodePoint, codepoint))) {
            return false;
        }
    }

    return true;
}

pub fn isIdentifierUTF16(text: JavascriptString) bool {
    const n = text.len;
    if (n == 0) {
        return false;
    }

    var i: usize = 0;
    while (i < n) : (i += 1) {
        var r1 = @intCast(i32, text[i]);
        if (r1 >= 0xD800 and r1 <= 0xDBFF and i + 1 < n) {
            const r2 = @intCast(i32, text[i + 1]);
            if (r2 >= 0xDC00 and r2 <= 0xDFFF) {
                r1 = (r1 << 10) + r2 + (0x10000 - (0xD800 << 10) - 0xDC00);
                i += 1;
            }
        }
        if (i == 0) {
            if (!isIdentifierStart(@intCast(u21, r1))) {
                return false;
            }
        } else {
            if (!isIdentifierContinue(@intCast(u21, r1))) {
                return false;
            }
        }
    }

    return true;
}

// TODO: implement this to actually work right
// this fn is a stub!
pub fn rangeOfIdentifier(source: *Source, loc: logger.Loc) logger.Range {
    var r = logger.Range{ .loc = loc, .len = 0 };
    const offset = @intCast(usize, loc.start);
    var i: usize = 0;
    for (source.contents[offset..]) |c| {
        if (isIdentifierStart(@as(CodePoint, c))) {
            for (source.contents[offset + i ..]) |c_| {
                if (!isIdentifierContinue(c_)) {
                    r.len = std.math.lossyCast(i32, i);
                    return r;
                }
                i += 1;
            }
        }

        i += 1;
    }

    return r;
}

fn float64(num: anytype) callconv(.Inline) f64 {
    return @intToFloat(f64, num);
}

fn test_lexer(contents: []const u8) Lexer {
    alloc.setup(std.heap.page_allocator) catch unreachable;
    var log = alloc.dynamic.create(logger.Log) catch unreachable;
    log.* = logger.Log.init(alloc.dynamic);
    var source = logger.Source.initPathString(
        "index.js",
        contents,
    );
    return Lexer.init(log, &source, alloc.dynamic) catch unreachable;
}

// test "LexerType.next()" {
//     try alloc.setup(std.heap.page_allocator);
//     const msgs = std.ArrayList(logger.Msg).init(alloc.dynamic);
//     const log = logger.Log{
//         .msgs = msgs,
//     };

//     const source = logger.Source.initPathString("index.js", "for (let i = 0; i < 100; i++) { console.log('hi'); }", std.heap.page_allocator);
//     var lex = try LexerType.init(log, source, alloc.dynamic);
//     lex.next();
// }

fn expectStr(lexer: *Lexer, expected: string, actual: string) void {
    if (lexer.log.errors > 0 or lexer.log.warnings > 0) {
        std.debug.panic("{s}", .{lexer.log.msgs.items});
        // const msg: logger.Msg = lexer.log.msgs.items[0];
        // msg.formatNoWriter(std.debug.panic);
    }
    std.testing.expectEqual(lexer.log.errors, 0);
    std.testing.expectEqual(lexer.log.warnings, 0);
    std.testing.expectEqual(false, lexer.did_panic);
    std.testing.expectEqual(@as(usize, 0), lexer.log.errors);
    std.testing.expectEqual(@as(usize, 0), lexer.log.warnings);
    std.testing.expectEqualStrings(expected, actual);
}

test "Lexer.next() simple" {
    var lex = test_lexer("for (let i = 0; i < 100; i++) { }");
    expectStr(&lex, "\"for\"", tokenToString.get(lex.token));
    lex.next();
    expectStr(&lex, "\"(\"", tokenToString.get(lex.token));
    lex.next();
    expectStr(&lex, "let", lex.raw());
    lex.next();
    expectStr(&lex, "i", lex.raw());
    lex.next();
    expectStr(&lex, "=", lex.raw());
    lex.next();
    expectStr(&lex, "0", lex.raw());
    lex.next();
    expectStr(&lex, ";", lex.raw());
    lex.next();
    expectStr(&lex, "i", lex.raw());
    lex.next();
    std.testing.expect(lex.number == 0.0);
    expectStr(&lex, "<", lex.raw());
    lex.next();
    std.testing.expect(lex.number == 100.0);
    expectStr(&lex, "100", lex.raw());
    lex.next();
}

pub fn test_stringLiteralEquals(expected: string, source_text: string) void {
    var msgs = std.ArrayList(logger.Msg).init(std.testing.allocator);
    var log = logger.Log{
        .msgs = msgs,
    };

    defer std.testing.allocator.free(msgs.items);

    var source = logger.Source.initPathString(
        "index.js",
        source_text,
    );

    var lex = try Lexer.init(&log, &source, std.heap.page_allocator);
    while (!lex.token.isString() and lex.token != .t_end_of_file) {
        lex.next();
    }

    var lit = std.unicode.utf16leToUtf8Alloc(std.heap.page_allocator, lex.string_literal) catch unreachable;
    std.testing.expectEqualStrings(expected, lit);
}

pub fn test_skipTo(lexer: *LexerType, n: string) void {
    var i: usize = 0;
    while (i < n.len) {
        lexer.next();
        i += 1;
    }
}

test "LexerType.rawTemplateContents" {
    test_stringLiteralEquals("hello!", "const a = 'hello!';");
    test_stringLiteralEquals("hello!hi", "const b = 'hello!hi';");
    test_stringLiteralEquals("hello!\n\nhi", "const b = `hello!\n\nhi`;");
    // TODO: \r\n
    // test_stringLiteralEquals("hello!\nhi", "const b = `hello!\r\nhi`;");
    test_stringLiteralEquals("hello!", "const b = `hello!${\"hi\"}`");
}
