const std = @import("std");
const logger = bun.logger;
const tables = @import("js_lexer_tables.zig");
const build_options = @import("build_options");
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
const C = bun.C;
const FeatureFlags = @import("feature_flags.zig");
const JavascriptString = []const u16;
const Indentation = bun.js_printer.Options.Indentation;

const Source = logger.Source;
pub const T = tables.T;
pub const Keywords = tables.Keywords;
pub const tokenToString = tables.tokenToString;
pub const StrictModeReservedWords = tables.StrictModeReservedWords;
pub const PropertyModifierKeyword = tables.PropertyModifierKeyword;
pub const TypescriptStmtKeyword = tables.TypescriptStmtKeyword;
pub const TypeScriptAccessibilityModifier = tables.TypeScriptAccessibilityModifier;

const first_high_surrogate = 0xD800;
const last_high_surrogate = 0xDBFF;
const first_low_surrogate = 0xDC00;
const last_low_surrogate = 0xDFFF;

fn notimpl() noreturn {
    Output.panic("not implemented yet!", .{});
}

pub var emptyJavaScriptString = ([_]u16{0});

pub const JSXPragma = struct {
    _jsx: js_ast.Span = .{},
    _jsxFrag: js_ast.Span = .{},
    _jsxRuntime: js_ast.Span = .{},
    _jsxImportSource: js_ast.Span = .{},

    pub fn jsx(this: *const JSXPragma) ?js_ast.Span {
        return if (this._jsx.text.len > 0) this._jsx else null;
    }
    pub fn jsxFrag(this: *const JSXPragma) ?js_ast.Span {
        return if (this._jsxFrag.text.len > 0) this._jsxFrag else null;
    }
    pub fn jsxRuntime(this: *const JSXPragma) ?js_ast.Span {
        return if (this._jsxRuntime.text.len > 0) this._jsxRuntime else null;
    }
    pub fn jsxImportSource(this: *const JSXPragma) ?js_ast.Span {
        return if (this._jsxImportSource.text.len > 0) this._jsxImportSource else null;
    }
};

pub const JSONOptions = struct {
    /// Enable JSON-specific warnings/errors
    is_json: bool = false,

    /// tsconfig.json supports comments & trailing comments
    allow_comments: bool = false,
    allow_trailing_commas: bool = false,

    /// Loading JSON-in-JSON may start like \\""\\"
    /// This is technically invalid, since we parse from the first value of the string
    ignore_leading_escape_sequences: bool = false,
    ignore_trailing_escape_sequences: bool = false,

    json_warn_duplicate_keys: bool = true,

    /// mark as originally for a macro to enable inlining
    was_originally_macro: bool = false,

    guess_indentation: bool = false,
};

pub fn NewLexer(
    comptime json_options: JSONOptions,
) type {
    return NewLexer_(
        json_options.is_json,
        json_options.allow_comments,
        json_options.allow_trailing_commas,
        json_options.ignore_leading_escape_sequences,
        json_options.ignore_trailing_escape_sequences,
        json_options.json_warn_duplicate_keys,
        json_options.was_originally_macro,
        json_options.guess_indentation,
    );
}

fn NewLexer_(
    comptime json_options_is_json: bool,
    comptime json_options_allow_comments: bool,
    comptime json_options_allow_trailing_commas: bool,
    comptime json_options_ignore_leading_escape_sequences: bool,
    comptime json_options_ignore_trailing_escape_sequences: bool,
    comptime json_options_json_warn_duplicate_keys: bool,
    comptime json_options_was_originally_macro: bool,
    comptime json_options_guess_indentation: bool,
) type {
    const json_options = JSONOptions{
        .is_json = json_options_is_json,
        .allow_comments = json_options_allow_comments,
        .allow_trailing_commas = json_options_allow_trailing_commas,
        .ignore_leading_escape_sequences = json_options_ignore_leading_escape_sequences,
        .ignore_trailing_escape_sequences = json_options_ignore_trailing_escape_sequences,
        .json_warn_duplicate_keys = json_options_json_warn_duplicate_keys,
        .was_originally_macro = json_options_was_originally_macro,
        .guess_indentation = json_options_guess_indentation,
    };
    return struct {
        const LexerType = @This();
        const is_json = json_options.is_json;
        const json = json_options;
        const JSONBool = if (is_json) bool else void;
        const JSONBoolDefault: JSONBool = if (is_json) true;

        pub const Error = error{
            UTF8Fail,
            OutOfMemory,
            SyntaxError,
            UnexpectedSyntax,
            JSONStringsMustUseDoubleQuotes,
            ParserError,
        };

        // pub const Error = error{
        //     UnexpectedToken,
        //     EndOfFile,
        // };

        // err: ?LexerType.Error,
        log: *logger.Log,
        source: logger.Source,
        current: usize = 0,
        start: usize = 0,
        end: usize = 0,
        did_panic: bool = false,
        approximate_newline_count: usize = 0,
        previous_backslash_quote_in_jsx: logger.Range = logger.Range.None,
        token: T = T.t_end_of_file,
        has_newline_before: bool = false,
        has_pure_comment_before: bool = false,
        has_no_side_effect_comment_before: bool = false,
        preserve_all_comments_before: bool = false,
        is_legacy_octal_literal: bool = false,
        is_log_disabled: bool = false,
        comments_to_preserve_before: std.ArrayList(js_ast.G.Comment),
        code_point: CodePoint = -1,
        identifier: []const u8 = "",
        jsx_pragma: JSXPragma = .{},
        source_mapping_url: ?js_ast.Span = null,
        number: f64 = 0.0,
        rescan_close_brace_as_template_token: bool = false,
        prev_error_loc: logger.Loc = logger.Loc.Empty,
        prev_token_was_await_keyword: bool = false,
        await_keyword_loc: logger.Loc = logger.Loc.Empty,
        fn_or_arrow_start_loc: logger.Loc = logger.Loc.Empty,
        regex_flags_start: ?u16 = null,
        allocator: std.mem.Allocator,
        string_literal_raw: StringLiteralRaw = .none,
        temp_buffer_u8: std.ArrayList(u8),

        /// Only used for JSON stringification when bundling
        /// This is a zero-bit type unless we're parsing JSON.
        is_ascii_only: JSONBool = JSONBoolDefault,
        track_comments: bool = false,
        all_comments: std.ArrayList(logger.Range),

        indent_info: if (json_options.guess_indentation)
            struct {
                guess: Indentation = .{},
                first_newline: bool = true,
            }
        else
            void = if (json_options.guess_indentation)
            .{},

        const StringLiteralRaw = union(enum) {
            none,
            failure: StringLiteralError,
            success: []const u8,
        };
        const StringLiteralError = struct {
            start: usize,
            msg: []const u8,
            fn show(f: StringLiteralError, lexer: *LexerType) Error {
                lexer.addError(f.start, "{s}", .{f.msg}, true);
                return Error.SyntaxError;
            }
        };

        pub inline fn loc(self: *const LexerType) logger.Loc {
            return logger.usize2Loc(self.start);
        }

        pub fn syntaxError(self: *LexerType) !void {
            @branchHint(.cold);

            // Only add this if there is not already an error.
            // It is possible that there is a more descriptive error already emitted.
            if (!self.log.hasErrors())
                self.addError(self.start, "Syntax Error", .{}, true);

            return Error.SyntaxError;
        }

        pub fn addDefaultError(self: *LexerType, msg: []const u8) Error {
            @branchHint(.cold);

            self.addError(self.start, "{s}", .{msg}, true);
            return Error.SyntaxError;
        }

        pub fn addSyntaxError(self: *LexerType, _loc: usize, comptime fmt: []const u8, args: anytype) !void {
            @branchHint(.cold);
            self.addError(_loc, fmt, args, false);
            return Error.SyntaxError;
        }

        pub fn addError(self: *LexerType, _loc: usize, comptime format: []const u8, args: anytype, _: bool) void {
            @branchHint(.cold);

            if (self.is_log_disabled) return;
            var __loc = logger.usize2Loc(_loc);
            if (__loc.eql(self.prev_error_loc)) {
                return;
            }

            self.log.addErrorFmt(&self.source, __loc, self.allocator, format, args) catch unreachable;
            self.prev_error_loc = __loc;
        }

        pub fn addRangeError(self: *LexerType, r: logger.Range, comptime format: []const u8, args: anytype, _: bool) !void {
            @branchHint(.cold);

            if (self.is_log_disabled) return;
            if (self.prev_error_loc.eql(r.loc)) {
                return;
            }

            const errorMessage = std.fmt.allocPrint(self.allocator, format, args) catch unreachable;
            try self.log.addRangeError(&self.source, r, errorMessage);
            self.prev_error_loc = r.loc;

            // if (panic) {
            //     return Error.ParserError;
            // }
        }

        pub fn addRangeErrorWithNotes(self: *LexerType, r: logger.Range, comptime format: []const u8, args: anytype, notes: []const logger.Data) !void {
            @branchHint(.cold);

            if (self.is_log_disabled) return;
            if (self.prev_error_loc.eql(r.loc)) {
                return;
            }

            const errorMessage = std.fmt.allocPrint(self.allocator, format, args) catch unreachable;
            try self.log.addRangeErrorWithNotes(
                &self.source,
                r,
                errorMessage,
                try self.log.msgs.allocator.dupe(
                    logger.Data,
                    notes,
                ),
            );
            self.prev_error_loc = r.loc;

            // if (panic) {
            //     return Error.ParserError;
            // }
        }

        pub fn restore(this: *LexerType, original: *const LexerType) void {
            const all_comments = this.all_comments;
            const comments_to_preserve_before = this.comments_to_preserve_before;
            const temp_buffer_u8 = this.temp_buffer_u8;
            this.* = original.*;

            // make sure pointers are valid
            this.all_comments = all_comments;
            this.comments_to_preserve_before = comments_to_preserve_before;
            this.temp_buffer_u8 = temp_buffer_u8;

            bun.debugAssert(all_comments.items.len >= original.all_comments.items.len);
            bun.debugAssert(comments_to_preserve_before.items.len >= original.comments_to_preserve_before.items.len);
            bun.debugAssert(temp_buffer_u8.items.len == 0 and original.temp_buffer_u8.items.len == 0);

            this.all_comments.items.len = original.all_comments.items.len;
            this.comments_to_preserve_before.items.len = original.comments_to_preserve_before.items.len;
        }

        pub inline fn isIdentifierOrKeyword(lexer: LexerType) bool {
            return @intFromEnum(lexer.token) >= @intFromEnum(T.t_identifier);
        }

        pub fn deinit(this: *LexerType) void {
            this.temp_buffer_u8.clearAndFree();
            this.all_comments.clearAndFree();
            this.comments_to_preserve_before.clearAndFree();
        }

        pub const InnerStringLiteral = packed struct { suffix_len: u3, needs_decode: bool };

        fn getRemainder(lexer: *LexerType) []const u8 {
            if (lexer.code_point == -1) return "";
            return lexer.source.contents[lexer.end..];
        }
        fn consumeRemainderBytes(lexer: *LexerType, bytes: usize) void {
            if (bytes == 0) return; // nothing to do
            bun.assert(bytes >= lexer.current - lexer.end);
            lexer.current += bytes - (lexer.current - lexer.end);
            // lexer.end does not need to be set because step() will set end
            lexer.step();
        }

        fn parseStringCharacters(lexer: *LexerType, comptime quote: u8) !StringLiteralRaw {
            // https://tc39.es/ecma262/#prod-StringLiteral
            // https://tc39.es/ecma262/#prod-TemplateLiteral
            // for tagged template literals, ie a`\u`, escape sequence parsing can't cause an immediate error.
            // it would be nice js_parser told js_lexer before parseStringCharacters if it is for a raw template literal.
            // if it is, this function could skip creating a buffer at all and ignore most escape sequences.

            bun.assert(lexer.temp_buffer_u8.items.len == 0);
            defer lexer.temp_buffer_u8.clearRetainingCapacity();

            var uncommitted_segment: ?[]const u8 = null;
            var utf8_is_interesting = true;
            var did_fail: ?StringLiteralError = null;

            while (true) {
                bun.assert(uncommitted_segment == null);

                const remainder = lexer.getRemainder();
                // LS and PS are allowed
                const interesting_character_idx = switch (utf8_is_interesting) {
                    inline else => |v| indexOfInterestingCharacterInString(remainder, quote, v),
                } orelse blk: {
                    // no interesting character between now and end of file; that means the ending quote is missing
                    if (quote == 0) break :blk remainder.len;
                    return lexer.addDefaultError("Unterminated string literal");
                };
                uncommitted_segment = remainder[0..interesting_character_idx];
                if (!utf8_is_interesting and !strings.isValidUTF8(uncommitted_segment.?)) {
                    // invalid utf8 in remainder; slowly loop over every codepoint and replace any invalid bytes
                    const target = lexer.end + interesting_character_idx;
                    while (lexer.end < target) {
                        try lexer.temp_buffer_u8.ensureUnusedCapacity(4);
                        lexer.temp_buffer_u8.items.len += strings.encodeWTF8Rune(lexer.temp_buffer_u8.unusedCapacitySlice()[0..4], lexer.code_point);

                        lexer.step();
                    }
                    uncommitted_segment = null;
                    continue;
                }
                lexer.consumeRemainderBytes(interesting_character_idx);

                switch (quote) {
                    0 => {
                        if (lexer.code_point == -1 or lexer.code_point == '\r' or lexer.code_point == '\n') {
                            break;
                        }
                    },
                    else => {
                        if (lexer.code_point == quote) {
                            lexer.step();
                            break;
                        }
                    },
                }
                // commit segment
                try lexer.temp_buffer_u8.appendSlice(uncommitted_segment.?);
                uncommitted_segment = null;
                // handle char
                const codepoint_to_handle = lexer.code_point;
                lexer.step();
                switch (codepoint_to_handle) {
                    quote => unreachable, // handled above
                    '\\' => {
                        // handle escape sequence
                        if (try lexer.handleEscapeSequence(quote != '`')) |failure| {
                            if (quote != '`') {
                                // allowed to fail immediately
                                return failure.show(lexer);
                            }
                            lexer.temp_buffer_u8.clearRetainingCapacity(); // doesn't matter anymore
                            if (did_fail == null) {
                                did_fail = failure;
                            }
                        }
                    },
                    '\r', '\n' => |c| {
                        if (quote == 0) unreachable; // handled above
                        if (quote != '`' and quote != 0) return lexer.addDefaultError("Unterminated string literal");
                        // handle newline
                        if (c == '\r' and lexer.code_point == '\n') lexer.step();
                        try lexer.temp_buffer_u8.append('\n');
                    },
                    '$' => {
                        if (quote != '`') unreachable; // not interesting character
                        // handle dollars
                        if (lexer.code_point == '{') {
                            lexer.step();
                            lexer.token = switch (lexer.rescan_close_brace_as_template_token) {
                                true => .t_template_middle,
                                false => .t_template_head,
                            };
                            break;
                        } else {
                            try lexer.temp_buffer_u8.append('$');
                        }
                    },
                    else => |c| {
                        if (is_json and c < 0x20) {
                            return lexer.addDefaultError("Unescaped control characters are not allowed in JSON");
                        } else if (c >= 0x80) {
                            if (comptime is_json) lexer.is_ascii_only = false;
                            utf8_is_interesting = false;
                            // print codepoint to wtf-8 (interesting character searches for \xE2 and many codepoints start with that. it could even be an invalid
                            // codepoint and we could be printing a replacement character.)
                            try lexer.temp_buffer_u8.ensureUnusedCapacity(4);
                            lexer.temp_buffer_u8.items.len += strings.encodeWTF8Rune(lexer.temp_buffer_u8.unusedCapacitySlice()[0..4], codepoint_to_handle);
                        } else {
                            try lexer.temp_buffer_u8.append(@intCast(c));
                        }
                    },
                }
            }

            if (did_fail) |f| return .{ .failure = f };
            if (lexer.temp_buffer_u8.items.len == 0) {
                return .{ .success = uncommitted_segment orelse "" };
            } else {
                // commit segment
                if (uncommitted_segment != null) {
                    try lexer.temp_buffer_u8.appendSlice(uncommitted_segment.?);
                    uncommitted_segment = null;
                }
                return .{ .success = try lexer.allocator.dupe(u8, lexer.temp_buffer_u8.items) };
            }
        }

        /// maximum 0xFFFFFF, else returns null
        fn decodeHex(hex: []const u8) ?i32 {
            var result: i32 = 0;
            if (hex.len > 6) return null; // too big
            for (hex) |byte| switch (byte) {
                '0'...'9' => {
                    result = result * 16 | (byte - '0');
                },
                'a'...'f' => {
                    result = result * 16 | (byte + 10 - 'a');
                },
                'A'...'F' => {
                    result = result * 16 | (byte + 10 - 'A');
                },
                else => return null,
            };
            return result;
        }

        /// parses an escape sequence excluding '\\' and appends it to lexer.temp_buffer_u8. merges an unpaired surrogate if necessary.
        fn handleEscapeSequence(lexer: *LexerType, allow_octal_literal: bool) !?StringLiteralError {
            // - '\' EscapeSequence
            // - '\' LineTerminatorSequence

            const first_char_of_escape = lexer.code_point;
            if (first_char_of_escape == -1) return lexer.addDefaultError("Unterminated string literal");
            lexer.step(); // consume first char
            const codepoint_to_append: i32 = switch (first_char_of_escape) {
                // LineTerminatorSequence
                '\n', 0x2028, 0x2029 => {
                    if (comptime is_json) {
                        // line continuations are not allowed in json
                        return lexer.addDefaultError("line continuation not allowed in json");
                    }
                    // nothing to append
                    return null;
                },
                '\r' => {
                    if (comptime is_json) {
                        // line continuations are not allowed in json
                        return lexer.addDefaultError("line continuation not allowed in json");
                    }

                    // consume a subsequent '\n' if there is one
                    if (lexer.code_point == '\n') lexer.step();
                    // nothing to append
                    return null;
                },

                // https://tc39.es/ecma262/#prod-EscapeSequence
                // - LegacyOctalEscapeSequence
                '0'...'7' => |byte| blk: {
                    if (comptime is_json) {
                        // octal escapes not allowed in json
                        return lexer.addDefaultError("octal escape not allowed in json");
                    }

                    const allow_three_long = byte < '4';
                    var has_multi = false;
                    var result: i32 = 0;
                    result += byte - '0';
                    if (lexer.code_point >= '0' and lexer.code_point <= '9') {
                        has_multi = true;
                        result *= 8;
                        result += lexer.code_point - '0';
                        lexer.step();
                    }
                    if (allow_three_long and lexer.code_point >= '0' and lexer.code_point <= '9') {
                        result *= 8;
                        result += lexer.code_point - '0';
                        lexer.step();
                    }

                    if (!allow_octal_literal and (result != 0 or has_multi)) return .{ .start = lexer.start, .msg = "octal escape not allowed in untagged template literals" };

                    // append codepoint
                    break :blk result;
                },
                '8'...'9' => |byte| blk: {
                    if (!allow_octal_literal) return .{ .start = lexer.start, .msg = "numeric escape not allowed in untagged template literals" };
                    break :blk byte;
                },
                // - HexEscapeSequence
                'x' => blk: {
                    const remainder = lexer.getRemainder();
                    if (remainder.len < 2) return .{ .start = lexer.start, .msg = "malformed hexidecimal character escape sequence" };
                    const slice = remainder[0..2];
                    const result = decodeHex(slice) orelse return .{ .start = lexer.start, .msg = "malformed hexidecimal character escape sequence" };
                    bun.assert(result >= 0 and result <= 0xFF);

                    // success, consume bytes
                    lexer.consumeRemainderBytes(2);

                    // append codepoint
                    break :blk result;
                },
                // - UnicodeEscapeSequence
                'u' => blk: {
                    var result: i32 = switch (lexer.readUnicodeEscape(.allow_surrogate_half)) {
                        .success => |s| s,
                        .failure => |f| return f,
                    };

                    // surrogate pairing
                    if (result >= first_low_surrogate and result <= last_low_surrogate) blk2: {
                        const low_half = result;
                        if (lexer.temp_buffer_u8.items.len < 3) break :blk2;
                        const last3 = lexer.temp_buffer_u8.items[lexer.temp_buffer_u8.items.len - 3 ..][0..3];
                        const dec_res = strings.unicode.decodeFirst(.wtf8_replace_invalid, last3).?;
                        if (dec_res.advance != 3) break :blk2;
                        if (dec_res.codepoint < first_high_surrogate or dec_res.codepoint > last_high_surrogate) break :blk2;
                        // merge surrogate pair
                        lexer.temp_buffer_u8.items.len -= 3;
                        result = strings.unicode.combineLowAndHighSurrogateToCodepoint(@intCast(low_half), dec_res.codepoint);
                    }

                    // append codepoint
                    break :blk result;
                },
                // - CharacterEscapeSequence
                //   - SingleEscapeCharacter
                '\'' => blk: {
                    if (comptime is_json) {
                        // \' is not allowed in json
                        return lexer.addDefaultError("unicode single quote escape not allowed in json");
                    }
                    break :blk '\'';
                },
                '\"', '\\' => |byte| byte,
                'b' => 0x08,
                'f' => 0x0C,
                'n' => 0x0A,
                'r' => 0x0D,
                't' => 0x09,
                'v' => blk: {
                    if (comptime is_json) {
                        // \v is not allowed in json
                        return lexer.addDefaultError("v escape not allowed in json");
                    }
                    break :blk 0x0B;
                },
                '/' => '/', // allowed in json
                //   - NonEscapeCharacter, NonOctalDecimalEscapeSequence
                else => |char| blk: {
                    if (comptime is_json) {
                        // bad escape characters are not allowed in json
                        return lexer.addDefaultError("invalid escape not allowed in json");
                    }
                    break :blk char;
                },
            };

            // print codepoint to wtf-8
            if ((comptime is_json) and codepoint_to_append >= 0x80) lexer.is_ascii_only = false;
            try lexer.temp_buffer_u8.ensureUnusedCapacity(4);
            lexer.temp_buffer_u8.items.len += strings.encodeWTF8Rune(lexer.temp_buffer_u8.unusedCapacitySlice()[0..4], codepoint_to_append);
            return null;
        }

        pub fn parseStringLiteral(lexer: *LexerType, comptime quote: CodePoint) !void {
            if (comptime quote != '`') {
                lexer.token = T.t_string_literal;
            } else if (lexer.rescan_close_brace_as_template_token) {
                lexer.token = T.t_template_tail;
            } else {
                lexer.token = T.t_no_substitution_template_literal;
            }
            // quote is 0 when parsing JSON from .env
            // .env values may not always be quoted.
            lexer.step();

            const res = try lexer.parseStringCharacters(quote);
            lexer.string_literal_raw = res;
        }

        inline fn _advanceByBytes(self: *LexerType, bytes: usize) void {
            self.end = self.current;
            self.current += bytes;
        }

        /// -1 for eof, 0xFFFD for invalid utf-8
        inline fn nextCodepoint(self: *LexerType) CodePoint {
            const rem = self.source.contents[self.current..];
            if (rem.len == 0) {
                self._advanceByBytes(0);
                return -1;
            }
            const res = strings.unicode.decodeFirst(.utf8_replace_invalid, rem).?;
            self._advanceByBytes(res.advance);
            return res.codepoint;
        }

        pub fn step(lexer: *LexerType) void {
            lexer.code_point = lexer.nextCodepoint();

            // Track the approximate number of newlines in the file so we can preallocate
            // the line offset table in the printer for source maps. The line offset table
            // is the #1 highest allocation in the heap profile, so this is worth doing.
            // This count is approximate because it handles "\n" and "\r\n" (the common
            // cases) but not "\r" or "\u2028" or "\u2029". Getting this wrong is harmless
            // because it's only a preallocation. The array will just grow if it's too small.
            lexer.approximate_newline_count += @intFromBool(lexer.code_point == '\n');
        }

        pub inline fn expect(self: *LexerType, comptime token: T) !void {
            if (self.token != token) {
                try self.expected(token);
            }

            try self.next();
        }

        pub inline fn expectOrInsertSemicolon(lexer: *LexerType) !void {
            if (lexer.token == T.t_semicolon or (!lexer.has_newline_before and
                lexer.token != T.t_close_brace and lexer.token != T.t_end_of_file))
            {
                try lexer.expect(T.t_semicolon);
            }
        }

        pub fn addUnsupportedSyntaxError(self: *LexerType, msg: []const u8) !void {
            self.addError(self.end, "Unsupported syntax: {s}", .{msg}, true);
            return Error.SyntaxError;
        }

        pub const IdentifierKind = enum { normal, private };
        pub const ScanResult = struct { token: T, contents: string };
        const FakeArrayList16 = struct {
            items: []u16,
            i: usize = 0,

            pub fn append(fake: *FakeArrayList16, value: u16) !void {
                bun.assert(fake.items.len > fake.i);
                fake.items[fake.i] = value;
                fake.i += 1;
            }

            pub fn appendAssumeCapacity(fake: *FakeArrayList16, value: u16) void {
                bun.assert(fake.items.len > fake.i);
                fake.items[fake.i] = value;
                fake.i += 1;
            }
            pub fn ensureUnusedCapacity(fake: *FakeArrayList16, int: anytype) !void {
                bun.assert(fake.items.len > fake.i + int);
            }
        };

        fn readUnicodeEscape(lexer: *LexerType, mode: enum { allow_surrogate_half, deny_surrogate_half }) union(enum) {
            success: i32,
            failure: StringLiteralError,
        } {
            var was_curly: bool = false;
            const slice: []const u8 = switch (lexer.code_point) {
                '{' => blk2: {
                    if (comptime is_json) {
                        // \u{ is not allowed in json, use two surrogate half escapes instead
                        return .{ .failure = .{ .start = lexer.start, .msg = "unicode curly bracket escape not allowed in json" } };
                    }
                    lexer.step();
                    var is_valid = false;
                    // consume leading zeroes, 000000000000064 is allowed even though it's > 6 chars
                    if (lexer.code_point == '0') {
                        is_valid = true;
                        while (lexer.code_point == '0') lexer.step();
                    }
                    const remainder = lexer.getRemainder();
                    const close_bracket = std.mem.indexOfScalar(u8, remainder[0..@min(remainder.len, 8)], '}') orelse {
                        return .{ .failure = .{ .start = lexer.start, .msg = "malformed Unicode character escape sequence" } };
                    };
                    if (!is_valid and close_bracket == 0) return .{ .failure = .{ .start = lexer.start, .msg = "malformed Unicode character escape sequence" } };
                    was_curly = true;
                    break :blk2 remainder[0..close_bracket];
                },
                else => blk2: {
                    const remainder = lexer.getRemainder();
                    if (remainder.len < 4) {
                        return .{ .failure = .{ .start = lexer.start, .msg = "malformed Unicode character escape sequence" } };
                    }
                    break :blk2 remainder[0..4];
                },
            };

            // decode slice
            const result: i32 = decodeHex(slice) orelse return .{ .failure = .{ .start = lexer.start, .msg = "malformed Unicode character escape sequence" } };
            if (result > 0x10FFFF) return .{ .failure = .{ .start = lexer.start, .msg = "Unicode codepoint must not be greater than 0x10FFFF in escape sequence" } };

            if (mode == .deny_surrogate_half) {
                if (result >= first_low_surrogate and result <= last_low_surrogate or result >= first_high_surrogate and result <= last_high_surrogate) {
                    return .{ .failure = .{ .start = lexer.start, .msg = "Unicode codepoint must not be a surrogate half in identifier" } };
                }
            }

            // consume
            lexer.consumeRemainderBytes(slice.len);
            if (was_curly) {
                bun.assert(lexer.code_point == '}');
                lexer.step();
            }

            return .{ .success = result };
        }

        // This is an edge case that doesn't really exist in the wild, so it doesn't
        // need to be as fast as possible.
        pub fn scanIdentifierWithEscapes(lexer: *LexerType, kind: IdentifierKind, prepend: []const u8) anyerror!ScanResult {
            var result = ScanResult{ .token = .t_end_of_file, .contents = "" };

            bun.assert(lexer.temp_buffer_u8.items.len == 0);
            defer lexer.temp_buffer_u8.clearRetainingCapacity();

            try lexer.temp_buffer_u8.appendSlice(prepend);

            // Parse the identifier
            while (true) {
                // Scan a unicode escape sequence. There is at least one because that's
                // what caused us to get on this slow path in the first place.
                const result_codepoint: i32 = switch (lexer.code_point) {
                    '\\' => blk: {
                        lexer.step();
                        if (lexer.code_point != 'u') return lexer.addDefaultError("Escape sequence in identifier must be unicode");
                        lexer.step();
                        switch (lexer.readUnicodeEscape(.deny_surrogate_half)) {
                            .success => |s| break :blk s,
                            .failure => |f| return f.show(lexer),
                        }
                    },
                    else => |c| blk: {
                        if (!isIdentifierContinue(lexer.code_point)) {
                            break;
                        }
                        lexer.step();
                        break :blk c;
                    },
                };

                // append codepoint
                try lexer.temp_buffer_u8.ensureUnusedCapacity(4);
                lexer.temp_buffer_u8.items.len += strings.encodeWTF8Rune(lexer.temp_buffer_u8.unusedCapacitySlice()[0..4], result_codepoint);
            }

            result.contents = try lexer.allocator.dupe(u8, lexer.temp_buffer_u8.items);

            const identifier = if (kind != .private)
                result.contents
            else
                result.contents[1..];

            if (!isIdentifier(identifier)) {
                try lexer.addRangeError(
                    .{ .loc = logger.usize2Loc(lexer.start), .len = @as(i32, @intCast(lexer.end - lexer.start)) },
                    "Invalid identifier: \"{s}\"",
                    .{result.contents},
                    true,
                );
            }

            result.contents = result.contents;

            // Escaped keywords are not allowed to work as actual keywords, but they are
            // allowed wherever we allow identifiers or keywords. For example:
            //
            //   // This is an error (equivalent to "var var;")
            //   var \u0076\u0061\u0072;
            //
            //   // This is an error (equivalent to "var foo;" except for this rule)
            //   \u0076\u0061\u0072 foo;
            //
            //   // This is an fine (equivalent to "foo.var;")
            //   foo.\u0076\u0061\u0072;
            //
            result.token = if (Keywords.has(result.contents)) .t_escaped_keyword else .t_identifier;

            return result;
        }

        pub fn expectContextualKeyword(self: *LexerType, comptime keyword: string) !void {
            if (!self.isContextualKeyword(keyword)) {
                if (@import("builtin").mode == std.builtin.Mode.Debug) {
                    self.addError(self.start, "Expected \"{s}\" but found \"{s}\" (token: {s})", .{
                        keyword,
                        self.raw(),
                        @tagName(self.token),
                    }, true);
                } else {
                    self.addError(self.start, "Expected \"{s}\" but found \"{s}\"", .{ keyword, self.raw() }, true);
                }
                return Error.UnexpectedSyntax;
            }
            try self.next();
        }

        pub fn maybeExpandEquals(lexer: *LexerType) !void {
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

        pub fn expectLessThan(lexer: *LexerType, comptime is_inside_jsx_element: bool) !void {
            switch (lexer.token) {
                .t_less_than => {
                    if (is_inside_jsx_element) {
                        try lexer.nextInsideJSXElement();
                    } else {
                        try lexer.next();
                    }
                },
                .t_less_than_equals => {
                    lexer.token = .t_equals;
                    lexer.start += 1;
                    try lexer.maybeExpandEquals();
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
                    try lexer.expected(.t_less_than);
                },
            }
        }

        pub fn expectGreaterThan(lexer: *LexerType, comptime is_inside_jsx_element: bool) !void {
            switch (lexer.token) {
                .t_greater_than => {
                    if (is_inside_jsx_element) {
                        try lexer.nextInsideJSXElement();
                    } else {
                        try lexer.next();
                    }
                },

                .t_greater_than_equals => {
                    lexer.token = .t_equals;
                    lexer.start += 1;
                    try lexer.maybeExpandEquals();
                },

                .t_greater_than_greater_than_equals => {
                    lexer.token = .t_greater_than_equals;
                    lexer.start += 1;
                },

                .t_greater_than_greater_than_greater_than_equals => {
                    lexer.token = .t_greater_than_greater_than_equals;
                    lexer.start += 1;
                },

                .t_greater_than_greater_than => {
                    lexer.token = .t_greater_than;
                    lexer.start += 1;
                },

                .t_greater_than_greater_than_greater_than => {
                    lexer.token = .t_greater_than_greater_than;
                    lexer.start += 1;
                },

                else => {
                    try lexer.expected(.t_greater_than);
                },
            }
        }

        pub fn next(lexer: *LexerType) !void {
            lexer.has_newline_before = lexer.end == 0;
            lexer.has_pure_comment_before = false;
            lexer.has_no_side_effect_comment_before = false;
            lexer.prev_token_was_await_keyword = false;

            while (true) {
                lexer.start = lexer.end;
                lexer.token = T.t_end_of_file;

                switch (lexer.code_point) {
                    -1 => {
                        lexer.token = T.t_end_of_file;
                    },

                    '#' => {
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Private identifiers are not allowed in JSON");
                        }
                        if (lexer.start == 0 and lexer.source.contents[1] == '!') {
                            // "#!/usr/bin/env node"
                            lexer.token = .t_hashbang;
                            hashbang: while (true) {
                                lexer.step();
                                switch (lexer.code_point) {
                                    '\r', '\n', 0x2028, 0x2029 => {
                                        break :hashbang;
                                    },
                                    -1 => {
                                        break :hashbang;
                                    },
                                    else => {},
                                }
                            }
                            lexer.identifier = lexer.raw();
                        } else {
                            // "#foo"
                            lexer.step();
                            if (lexer.code_point == '\\') {
                                lexer.identifier = (try lexer.scanIdentifierWithEscapes(.private, "#")).contents;
                            } else {
                                if (!isIdentifierStart(lexer.code_point)) {
                                    try lexer.syntaxError();
                                }

                                lexer.step();
                                while (isIdentifierContinue(lexer.code_point)) {
                                    lexer.step();
                                }
                                if (lexer.code_point == '\\') {
                                    lexer.identifier = (try lexer.scanIdentifierWithEscapes(.private, lexer.raw())).contents;
                                } else {
                                    lexer.identifier = lexer.raw();
                                }
                            }
                            lexer.token = T.t_private_identifier;
                            break;
                        }
                    },
                    '\r', '\n', 0x2028, 0x2029 => {
                        lexer.has_newline_before = true;

                        if (comptime json_options.guess_indentation) {
                            if (lexer.indent_info.first_newline and lexer.code_point == '\n') {
                                while (lexer.code_point == '\n' or lexer.code_point == '\r') {
                                    lexer.step();
                                }

                                if (lexer.code_point != ' ' and lexer.code_point != '\t') {
                                    // try to get the next one. this handles cases where the file starts
                                    // with a newline
                                    continue;
                                }

                                lexer.indent_info.first_newline = false;

                                const indent_character = lexer.code_point;
                                var count: usize = 0;
                                while (lexer.code_point == indent_character) {
                                    lexer.step();
                                    count += 1;
                                }

                                lexer.indent_info.guess.character = if (indent_character == ' ') .space else .tab;
                                lexer.indent_info.guess.scalar = count;
                                continue;
                            }
                        }

                        lexer.step();
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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Semicolons are not allowed in JSON");
                        }

                        lexer.step();
                        lexer.token = T.t_semicolon;
                    },
                    '@' => {
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Decorators are not allowed in JSON");
                        }

                        lexer.step();
                        lexer.token = T.t_at;
                    },
                    '~' => {
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("~ is not allowed in JSON");
                        }

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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                        }

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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                        }

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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                        }

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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                        }

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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                        }

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
                                if (comptime is_json) {
                                    return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                                }
                                lexer.step();
                                lexer.token = T.t_minus_equals;
                            },

                            '-' => {
                                if (comptime is_json) {
                                    return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                                }
                                lexer.step();

                                if (lexer.code_point == '>' and lexer.has_newline_before) {
                                    lexer.step();
                                    lexer.log.addRangeWarning(&lexer.source, lexer.range(), "Treating \"-->\" as the start of a legacy HTML single-line comment") catch unreachable;

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

                        switch (lexer.code_point) {
                            '=' => {
                                lexer.step();
                                lexer.token = .t_slash_equals;
                            },
                            '/' => {
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

                                if (comptime is_json) {
                                    if (!json.allow_comments) {
                                        try lexer.addRangeError(lexer.range(), "JSON does not support comments", .{}, true);
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
                                            try lexer.addSyntaxError(
                                                lexer.start,
                                                "Expected \"*/\" to terminate multi-line comment",
                                                .{},
                                            );
                                        },
                                        else => {
                                            // if (comptime Environment.enableSIMD) {
                                            // TODO: this seems to work, but we shouldn't enable this until after improving test coverage
                                            // if (lexer.code_point < 128) {
                                            //     const remainder = lexer.source.contents[lexer.current..];
                                            //     if (remainder.len >= 4096) {
                                            //         lexer.current += skipToInterestingCharacterInMultilineComment(remainder) orelse {
                                            //             lexer.step();
                                            //             continue;
                                            //         };
                                            //         lexer.end = lexer.current -| 1;
                                            //         lexer.step();
                                            //         continue;
                                            //     }
                                            // }
                                            // }

                                            lexer.step();
                                        },
                                    }
                                }
                                if (comptime is_json) {
                                    if (!json.allow_comments) {
                                        try lexer.addRangeError(lexer.range(), "JSON does not support comments", .{}, true);
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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                        }

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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                        }

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
                                const rem = lexer.getRemainder();
                                if (rem.len >= 3 and strings.eqlComptime(rem[1..3], "--")) {
                                    try lexer.addUnsupportedSyntaxError("Legacy HTML comments not implemented yet!");
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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                        }

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
                        if (comptime is_json) {
                            return lexer.addUnsupportedSyntaxError("Operators are not allowed in JSON");
                        }

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

                    '\'' => {
                        try lexer.parseStringLiteral('\'');
                    },
                    '"' => {
                        try lexer.parseStringLiteral('"');
                    },
                    '`' => {
                        try lexer.parseStringLiteral('`');
                    },

                    '_', '$', 'a'...'z', 'A'...'Z' => {
                        const advance = latin1IdentifierContinueLength(lexer.source.contents[lexer.current..]);

                        lexer.end = lexer.current + advance;
                        lexer.current = lexer.end;

                        lexer.step();

                        if (lexer.code_point >= 0x80) {
                            @branchHint(.unlikely);
                            while (isIdentifierContinue(lexer.code_point)) {
                                lexer.step();
                            }
                        }

                        if (lexer.code_point != '\\') {
                            @branchHint(.likely);
                            // this code is so hot that if you save lexer.raw() into a temporary variable
                            // it shows up in profiling
                            lexer.identifier = lexer.raw();
                            lexer.token = Keywords.get(lexer.identifier) orelse T.t_identifier;
                        } else {
                            @branchHint(.unlikely);
                            const scan_result = try lexer.scanIdentifierWithEscapes(.normal, lexer.raw());
                            lexer.identifier = scan_result.contents;
                            lexer.token = scan_result.token;
                        }
                    },

                    '\\' => {
                        if (comptime is_json and json_options.ignore_leading_escape_sequences) {
                            if (lexer.start == 0 or lexer.current == lexer.source.contents.len - 1) {
                                lexer.step();
                                continue;
                            }
                        }

                        const scan_result = try lexer.scanIdentifierWithEscapes(.normal, "");
                        lexer.identifier = scan_result.contents;
                        lexer.token = scan_result.token;
                    },

                    '.', '0'...'9' => {
                        try lexer.parseNumericLiteralOrDot();
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
                                const scan_result = try lexer.scanIdentifierWithEscapes(.normal, lexer.raw());
                                lexer.identifier = scan_result.contents;
                                lexer.token = scan_result.token;
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

        pub fn expected(self: *LexerType, token: T) !void {
            if (self.is_log_disabled) {
                return error.Backtrack;
            } else if (tokenToString.get(token).len > 0) {
                try self.expectedString(tokenToString.get(token));
            } else {
                try self.unexpected();
            }
        }

        pub fn unexpected(lexer: *LexerType) !void {
            const found = finder: {
                lexer.start = @min(lexer.start, lexer.end);

                if (lexer.start == lexer.source.contents.len) {
                    break :finder "end of file";
                } else {
                    break :finder lexer.raw();
                }
            };

            lexer.did_panic = true;
            try lexer.addRangeError(lexer.range(), "Unexpected {s}", .{found}, true);
        }

        pub fn raw(self: *LexerType) []const u8 {
            return self.source.contents[self.start..self.end];
        }

        pub fn isContextualKeyword(self: *LexerType, comptime keyword: string) bool {
            return self.token == .t_identifier and strings.eqlComptime(self.raw(), keyword);
        }

        pub fn expectedString(self: *LexerType, text: string) !void {
            if (self.prev_token_was_await_keyword) {
                var notes: [1]logger.Data = undefined;
                if (!self.fn_or_arrow_start_loc.isEmpty()) {
                    notes[0] = logger.rangeData(
                        &self.source,
                        rangeOfIdentifier(
                            &self.source,
                            self.fn_or_arrow_start_loc,
                        ),
                        "Consider adding the \"async\" keyword here",
                    );
                }

                const notes_ptr: []const logger.Data = notes[0..@as(
                    usize,
                    @intFromBool(!self.fn_or_arrow_start_loc.isEmpty()),
                )];

                try self.addRangeErrorWithNotes(
                    self.range(),
                    "\"await\" can only be used inside an \"async\" function",
                    .{},
                    notes_ptr,
                );
                return;
            }
            if (self.source.contents.len != self.start) {
                try self.addRangeError(
                    self.range(),
                    "Expected {s} but found \"{s}\"",
                    .{ text, self.raw() },
                    true,
                );
            } else {
                try self.addRangeError(
                    self.range(),
                    "Expected {s} but found end of file",
                    .{text},
                    true,
                );
            }
        }

        fn scanCommentText(lexer: *LexerType) void {
            const text = lexer.source.contents[lexer.start..lexer.end];
            const has_legal_annotation = text.len > 2 and text[2] == '!';
            const is_multiline_comment = text.len > 1 and text[1] == '*';

            if (lexer.track_comments)
                // Save the original comment text so we can subtract comments from the
                // character frequency analysis used by symbol minification
                lexer.all_comments.append(lexer.range()) catch unreachable;

            // Omit the trailing "*/" from the checks below
            const end_comment_text =
                if (is_multiline_comment)
                text.len - 2
            else
                text.len;

            if (has_legal_annotation or lexer.preserve_all_comments_before) {
                if (is_multiline_comment) {
                    // text = lexer.removeMultilineCommentIndent(lexer.source.contents[0..lexer.start], text);
                }

                lexer.comments_to_preserve_before.append(js_ast.G.Comment{
                    .text = text,
                    .loc = lexer.loc(),
                }) catch unreachable;
            }

            // tsconfig.json doesn't care about annotations
            if (comptime is_json)
                return;

            var rest = text[0..end_comment_text];
            const end = rest.ptr + rest.len;

            if (comptime Environment.enableSIMD) {
                const wrapped_len = rest.len - (rest.len % strings.ascii_vector_size);
                const comment_end = rest.ptr + wrapped_len;
                while (rest.ptr != comment_end) {
                    const vec: strings.AsciiVector = rest.ptr[0..strings.ascii_vector_size].*;

                    // lookahead for any # or @ characters
                    const hashtag = @as(strings.AsciiVectorU1, @bitCast(vec == @as(strings.AsciiVector, @splat(@as(u8, '#')))));
                    const at = @as(strings.AsciiVectorU1, @bitCast(vec == @as(strings.AsciiVector, @splat(@as(u8, '@')))));

                    if (@reduce(.Max, hashtag + at) == 1) {
                        rest.len = @intFromPtr(end) - @intFromPtr(rest.ptr);
                        if (comptime Environment.allow_assert) {
                            bun.assert(
                                strings.containsChar(&@as([strings.ascii_vector_size]u8, vec), '#') or
                                    strings.containsChar(&@as([strings.ascii_vector_size]u8, vec), '@'),
                            );
                        }

                        for (@as([strings.ascii_vector_size]u8, vec), 0..) |c, i| {
                            switch (c) {
                                '@', '#' => {
                                    const chunk = rest[i + 1 ..];
                                    if (!lexer.has_pure_comment_before) {
                                        if (strings.hasPrefixWithWordBoundary(chunk, "__PURE__")) {
                                            lexer.has_pure_comment_before = true;
                                            continue;
                                        }
                                        // TODO: implement NO_SIDE_EFFECTS
                                        // else if (strings.hasPrefixWithWordBoundary(chunk, "__NO_SIDE_EFFECTS__")) {
                                        //     lexer.has_no_side_effect_comment_before = true;
                                        //     continue;
                                        // }
                                    }

                                    if (strings.hasPrefixWithWordBoundary(chunk, "jsx")) {
                                        if (PragmaArg.scan(.skip_space_first, lexer.start + i + 1, "jsx", chunk)) |span| {
                                            lexer.jsx_pragma._jsx = span;
                                        }
                                    } else if (strings.hasPrefixWithWordBoundary(chunk, "jsxFrag")) {
                                        if (PragmaArg.scan(.skip_space_first, lexer.start + i + 1, "jsxFrag", chunk)) |span| {
                                            lexer.jsx_pragma._jsxFrag = span;
                                        }
                                    } else if (strings.hasPrefixWithWordBoundary(chunk, "jsxRuntime")) {
                                        if (PragmaArg.scan(.skip_space_first, lexer.start + i + 1, "jsxRuntime", chunk)) |span| {
                                            lexer.jsx_pragma._jsxRuntime = span;
                                        }
                                    } else if (strings.hasPrefixWithWordBoundary(chunk, "jsxImportSource")) {
                                        if (PragmaArg.scan(.skip_space_first, lexer.start + i + 1, "jsxImportSource", chunk)) |span| {
                                            lexer.jsx_pragma._jsxImportSource = span;
                                        }
                                    } else if (i == 2 and strings.hasPrefixComptime(chunk, " sourceMappingURL=")) {
                                        if (PragmaArg.scan(.no_space_first, lexer.start + i + 1, " sourceMappingURL=", chunk)) |span| {
                                            lexer.source_mapping_url = span;
                                        }
                                    }
                                },
                                else => {},
                            }
                        }
                    }

                    rest.ptr += strings.ascii_vector_size;
                }
                rest.len = @intFromPtr(end) - @intFromPtr(rest.ptr);
            }

            if (comptime Environment.allow_assert)
                bun.assert(rest.len == 0 or bun.isSliceInBuffer(rest, text));

            while (rest.len > 0) {
                const c = rest[0];
                rest = rest[1..];
                switch (c) {
                    '@', '#' => {
                        const chunk = rest;
                        const i = @intFromPtr(chunk.ptr) - @intFromPtr(text.ptr);
                        if (!lexer.has_pure_comment_before) {
                            if (strings.hasPrefixWithWordBoundary(chunk, "__PURE__")) {
                                lexer.has_pure_comment_before = true;
                                continue;
                            }
                        }

                        if (strings.hasPrefixWithWordBoundary(chunk, "jsx")) {
                            if (PragmaArg.scan(.skip_space_first, lexer.start + i + 1, "jsx", chunk)) |span| {
                                lexer.jsx_pragma._jsx = span;
                            }
                        } else if (strings.hasPrefixWithWordBoundary(chunk, "jsxFrag")) {
                            if (PragmaArg.scan(.skip_space_first, lexer.start + i + 1, "jsxFrag", chunk)) |span| {
                                lexer.jsx_pragma._jsxFrag = span;
                            }
                        } else if (strings.hasPrefixWithWordBoundary(chunk, "jsxRuntime")) {
                            if (PragmaArg.scan(.skip_space_first, lexer.start + i + 1, "jsxRuntime", chunk)) |span| {
                                lexer.jsx_pragma._jsxRuntime = span;
                            }
                        } else if (strings.hasPrefixWithWordBoundary(chunk, "jsxImportSource")) {
                            if (PragmaArg.scan(.skip_space_first, lexer.start + i + 1, "jsxImportSource", chunk)) |span| {
                                lexer.jsx_pragma._jsxImportSource = span;
                            }
                        } else if (i == 2 and strings.hasPrefixComptime(chunk, " sourceMappingURL=")) {
                            if (PragmaArg.scan(.no_space_first, lexer.start + i + 1, " sourceMappingURL=", chunk)) |span| {
                                lexer.source_mapping_url = span;
                            }
                        }
                    },
                    else => {},
                }
            }
        }

        // TODO: implement this
        pub fn removeMultilineCommentIndent(_: *LexerType, _: string, text: string) string {
            return text;
        }

        pub fn range(self: *LexerType) logger.Range {
            return logger.Range{
                .loc = logger.usize2Loc(self.start),
                .len = std.math.lossyCast(i32, self.end - self.start),
            };
        }

        pub fn initTSConfig(log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator) !LexerType {
            var lex = LexerType{
                .log = log,
                .source = source,
                .temp_buffer_u8 = std.ArrayList(u8).init(allocator),
                .prev_error_loc = logger.Loc.Empty,
                .allocator = allocator,
                .comments_to_preserve_before = std.ArrayList(js_ast.G.Comment).init(allocator),
                .all_comments = std.ArrayList(logger.Range).init(allocator),
            };
            lex.step();
            try lex.next();

            return lex;
        }

        pub fn initToParseSingleUnquotedString(log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator) !LexerType {
            return LexerType{
                .log = log,
                .source = source,
                .temp_buffer_u8 = std.ArrayList(u8).init(allocator),
                .prev_error_loc = logger.Loc.Empty,
                .allocator = allocator,
                .comments_to_preserve_before = std.ArrayList(js_ast.G.Comment).init(allocator),
                .all_comments = std.ArrayList(logger.Range).init(allocator),
            };
        }

        pub fn initWithoutReading(log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator) LexerType {
            return LexerType{
                .log = log,
                .source = source,
                .temp_buffer_u8 = std.ArrayList(u8).init(allocator),
                .prev_error_loc = logger.Loc.Empty,
                .allocator = allocator,
                .comments_to_preserve_before = std.ArrayList(js_ast.G.Comment).init(allocator),
                .all_comments = std.ArrayList(logger.Range).init(allocator),
            };
        }

        pub fn init(log: *logger.Log, source: logger.Source, allocator: std.mem.Allocator) !LexerType {
            var lex = initWithoutReading(log, source, allocator);
            lex.step();
            try lex.next();

            return lex;
        }

        pub fn toEString(lexer: *LexerType) !js_ast.E.String {
            if (lexer.token != .t_no_substitution_template_literal and lexer.token != .t_template_head and lexer.token != .t_template_middle and lexer.token != .t_template_tail and lexer.token != .t_string_literal) {
                return lexer.addDefaultError("Expected string");
            }
            switch (lexer.string_literal_raw) {
                .none => unreachable,
                .failure => |f| return f.show(lexer),
                .success => |v| return js_ast.E.String.init(v),
            }
        }

        pub fn toWTF8(lexer: *LexerType) ![]const u8 {
            return (try lexer.toEString()).asWtf8AssertNotRope();
        }

        inline fn assertNotJSON(_: *const LexerType) void {
            if (comptime is_json) @compileError("JSON should not reach this point");
            if (comptime is_json) unreachable;
        }

        pub fn scanRegExp(lexer: *LexerType) !void {
            lexer.assertNotJSON();
            lexer.regex_flags_start = null;
            while (true) {
                switch (lexer.code_point) {
                    '/' => {
                        lexer.step();

                        var has_set_flags_start = false;
                        const flag_characters = "dgimsuvy";
                        const min_flag = comptime std.mem.min(u8, flag_characters);
                        const max_flag = comptime std.mem.max(u8, flag_characters);
                        const RegexpFlags = bun.bit_set.IntegerBitSet((max_flag - min_flag) + 1);
                        var flags = RegexpFlags.initEmpty();
                        while (isIdentifierContinue(lexer.code_point)) {
                            switch (lexer.code_point) {
                                'd', 'g', 'i', 'm', 's', 'u', 'y', 'v' => {
                                    if (!has_set_flags_start) {
                                        lexer.regex_flags_start = @as(u16, @truncate(lexer.end - lexer.start));
                                        has_set_flags_start = true;
                                    }
                                    const flag = max_flag - @as(u8, @intCast(lexer.code_point));
                                    if (flags.isSet(flag)) {
                                        lexer.addError(
                                            lexer.current,
                                            "Duplicate flag \"{u}\" in regular expression",
                                            .{@as(u21, @intCast(lexer.code_point))},
                                            false,
                                        );
                                    }
                                    flags.set(flag);

                                    lexer.step();
                                },
                                else => {
                                    lexer.addError(
                                        lexer.current,
                                        "Invalid flag \"{u}\" in regular expression",
                                        .{@as(u21, @intCast(lexer.code_point))},
                                        false,
                                    );

                                    lexer.step();
                                },
                            }
                        }
                        return;
                    },
                    '[' => {
                        lexer.step();
                        while (lexer.code_point != ']') {
                            try lexer.scanRegExpValidateAndStep();
                        }
                        lexer.step();
                    },
                    else => {
                        try lexer.scanRegExpValidateAndStep();
                    },
                }
            }
        }

        pub fn utf16ToString(lexer: *LexerType, js: JavascriptString) !string {
            return try strings.toUTF8AllocWithType(lexer.allocator, []const u16, js);
        }
        pub fn nextInsideJSXElement(lexer: *LexerType) !void {
            lexer.assertNotJSON();

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
                                }
                                continue;
                            },
                            '*' => {
                                lexer.step();
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
                                                try lexer.addSyntaxError(lexer.start, "Expected \"*/\" to terminate multi-line comment", .{});
                                            },
                                            else => {
                                                lexer.step();
                                            },
                                        }
                                    }
                                }
                                continue;
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
                                    try lexer.addSyntaxError(lexer.range().endI(), "Expected identifier after \"{s}\" in namespaced JSX name", .{lexer.raw()});
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
            lexer.assertNotJSON();

            var backslash = logger.Range.None;
            var needs_decode = false;

            string_literal: while (true) {
                switch (lexer.code_point) {
                    -1 => {
                        try lexer.syntaxError();
                    },
                    '&' => {
                        needs_decode = true;
                        lexer.step();
                    },

                    '\\' => {
                        backslash = logger.Range{ .loc = logger.Loc{
                            .start = @as(i32, @intCast(lexer.end)),
                        }, .len = 1 };
                        lexer.step();

                        // JSX string literals do not support escaping
                        // They're "pre" escaped
                        switch (lexer.code_point) {
                            'u', 0x0C, 0, '\t', std.ascii.control_code.vt, 0x08 => {
                                needs_decode = true;
                            },
                            else => {},
                        }

                        continue;
                    },
                    quote => {
                        if (backslash.len > 0) {
                            backslash.len += 1;
                            lexer.previous_backslash_quote_in_jsx = backslash;
                        }
                        lexer.step();
                        break :string_literal;
                    },

                    else => {
                        // Non-ASCII strings need the slow path
                        if (lexer.code_point >= 0x80) {
                            needs_decode = true;
                        } else if ((comptime is_json) and lexer.code_point < 0x20) {
                            try lexer.syntaxError();
                        }
                        lexer.step();
                    },
                }
                backslash = logger.Range.None;
            }

            lexer.token = .t_string_literal;

            const raw_content_slice = lexer.source.contents[lexer.start + 1 .. lexer.end - 1];
            if (needs_decode) {
                bun.assert(lexer.temp_buffer_u8.items.len == 0);
                defer lexer.temp_buffer_u8.clearRetainingCapacity();
                try lexer.temp_buffer_u8.ensureUnusedCapacity(raw_content_slice.len);
                try lexer.fixWhitespaceAndDecodeJSXEntities(raw_content_slice, &lexer.temp_buffer_u8);

                lexer.string_literal_raw = .{ .success = try lexer.allocator.dupe(u8, lexer.temp_buffer_u8.items) };
            } else {
                lexer.string_literal_raw = .{ .success = raw_content_slice };
            }
        }

        pub fn expectJSXElementChild(lexer: *LexerType, token: T) !void {
            lexer.assertNotJSON();

            if (lexer.token != token) {
                try lexer.expected(token);
            }

            try lexer.nextJSXElementChild();
        }

        pub fn nextJSXElementChild(lexer: *LexerType) !void {
            lexer.assertNotJSON();

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
                                    try lexer.syntaxError();
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
                                    needs_fixing = needs_fixing or lexer.code_point >= 0x80;
                                    lexer.step();
                                },
                            }
                        }

                        lexer.token = .t_string_literal;
                        const raw_content_slice = lexer.source.contents[original_start..lexer.end];

                        if (needs_fixing) {
                            bun.assert(lexer.temp_buffer_u8.items.len == 0);
                            defer lexer.temp_buffer_u8.clearRetainingCapacity();
                            try lexer.temp_buffer_u8.ensureUnusedCapacity(raw_content_slice.len);
                            try lexer.fixWhitespaceAndDecodeJSXEntities(raw_content_slice, &lexer.temp_buffer_u8);
                            lexer.string_literal_raw = .{ .success = try lexer.allocator.dupe(u8, lexer.temp_buffer_u8.items) };

                            if (lexer.temp_buffer_u8.items.len == 0) {
                                lexer.has_newline_before = true;
                                continue;
                            }
                        } else {
                            lexer.string_literal_raw = .{ .success = raw_content_slice };
                        }
                    },
                }

                break;
            }
        }

        pub fn fixWhitespaceAndDecodeJSXEntities(lexer: *LexerType, text: string, decoded: *std.ArrayList(u8)) !void {
            lexer.assertNotJSON();

            var after_last_non_whitespace: ?u32 = null;

            // Trim whitespace off the end of the first line
            var first_non_whitespace: ?u32 = 0;

            const iterator = strings.CodepointIterator.init(text);
            var cursor = strings.CodepointIterator.Cursor{};

            while (iterator.next(&cursor)) {
                switch (cursor.c) {
                    '\r', '\n', 0x2028, 0x2029 => {
                        if (first_non_whitespace != null and after_last_non_whitespace != null) {
                            // Newline
                            if (decoded.items.len > 0) {
                                try decoded.append(' ');
                            }

                            // Trim whitespace off the start and end of lines in the middle
                            try lexer.decodeJSXEntities(text[first_non_whitespace.?..after_last_non_whitespace.?], decoded);
                        }

                        // Reset for the next line
                        first_non_whitespace = null;
                    },
                    '\t', ' ' => {},
                    else => {
                        // Check for unusual whitespace characters
                        if (!isWhitespace(cursor.c)) {
                            after_last_non_whitespace = cursor.i + @as(u32, cursor.width);
                            if (first_non_whitespace == null) {
                                first_non_whitespace = cursor.i;
                            }
                        }
                    },
                }
            }

            if (first_non_whitespace) |start| {
                if (decoded.items.len > 0) {
                    try decoded.append(' ');
                }

                try decodeJSXEntities(lexer, text[start..text.len], decoded);
            }
        }

        fn maybeDecodeJSXEntity(lexer: *LexerType, text: string, cursor: *strings.CodepointIterator.Cursor) void {
            lexer.assertNotJSON();

            if (strings.indexOfChar(text[cursor.width + cursor.i ..], ';')) |length| {
                const end = cursor.width + cursor.i;
                const entity = text[end .. end + length];
                if (entity[0] == '#') {
                    var number = entity[1..entity.len];
                    var base: u8 = 10;
                    if (number.len > 1 and number[0] == 'x') {
                        number = number[1..number.len];
                        base = 16;
                    }

                    cursor.c = std.fmt.parseInt(i32, number, base) catch |err| brk: {
                        switch (err) {
                            error.InvalidCharacter => {
                                lexer.addError(lexer.start, "Invalid JSX entity escape: {s}", .{entity}, false);
                            },
                            error.Overflow => {
                                lexer.addError(lexer.start, "JSX entity escape is too big: {s}", .{entity}, false);
                            },
                        }

                        break :brk strings.unicode_replacement;
                    };

                    cursor.i += @as(u32, @intCast(length)) + 1;
                    cursor.width = 1;
                } else if (tables.jsxEntity.get(entity)) |ent| {
                    cursor.c = ent;
                    cursor.i += @as(u32, @intCast(length)) + 1;
                }
            }
        }

        pub fn decodeJSXEntities(lexer: *LexerType, text: string, out: *std.ArrayList(u8)) !void {
            lexer.assertNotJSON();

            const iterator = strings.CodepointIterator.init(text);
            var cursor = strings.CodepointIterator.Cursor{};

            while (iterator.next(&cursor)) {
                if (cursor.c == '&') lexer.maybeDecodeJSXEntity(text, &cursor);

                var codepoint_buf: [4]u8 = undefined;
                const len = strings.encodeWTF8Rune(&codepoint_buf, cursor.c);
                try out.appendSlice(codepoint_buf[0..len]);
            }
        }
        pub fn expectInsideJSXElement(lexer: *LexerType, token: T) !void {
            lexer.assertNotJSON();

            if (lexer.token != token) {
                try lexer.expected(token);
                return Error.SyntaxError;
            }

            try lexer.nextInsideJSXElement();
        }

        pub fn expectInsideJSXElementWithName(lexer: *LexerType, token: T, name: string) !void {
            lexer.assertNotJSON();

            if (lexer.token != token) {
                try lexer.expectedString(name);
                return Error.SyntaxError;
            }

            try lexer.nextInsideJSXElement();
        }

        fn scanRegExpValidateAndStep(lexer: *LexerType) !void {
            lexer.assertNotJSON();

            if (lexer.code_point == '\\') {
                lexer.step();
            }

            switch (lexer.code_point) {
                '\r', '\n', 0x2028, 0x2029 => {
                    // Newlines aren't allowed in regular expressions
                    try lexer.syntaxError();
                },
                -1 => { // EOF
                    try lexer.syntaxError();
                },
                else => {
                    lexer.step();
                },
            }
        }

        pub fn rescanCloseBraceAsTemplateToken(lexer: *LexerType) !void {
            lexer.assertNotJSON();

            if (lexer.token != .t_close_brace) {
                try lexer.expected(.t_close_brace);
            }

            lexer.rescan_close_brace_as_template_token = true;
            lexer.code_point = '`';
            lexer.current = lexer.end;
            lexer.end -= 1;
            try lexer.next();
            lexer.rescan_close_brace_as_template_token = false;
        }

        pub fn rawTemplateContents(lexer: *LexerType) string {
            lexer.assertNotJSON();

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
            var bytes = MutableString.initCopy(lexer.allocator, text) catch bun.outOfMemory();
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

            return bytes.toOwnedSliceLength(end);
        }

        fn parseNumericLiteralOrDot(lexer: *LexerType) !void {
            // Number or dot;
            const first = lexer.code_point;
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
                                try lexer.syntaxError();
                            }

                            // The first digit must exist;
                            if (isFirst or lexer.is_legacy_octal_literal) {
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
                            if (lexer.is_legacy_octal_literal) {
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
                    if (isBigIntegerLiteral and lexer.is_legacy_octal_literal) {
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

                if (lexer.code_point == 'n' and !hasDotOrExponent) {
                    // The only bigint literal that can start with 0 is "0n"
                    if (text.len > 1 and first == '0') {
                        try lexer.syntaxError();
                    }

                    // Store bigints as text to avoid precision loss;
                    lexer.identifier = text;
                } else if (!hasDotOrExponent and lexer.end - lexer.start < 10) {
                    // Parse a 32-bit integer (very fast path);
                    var number: u32 = 0;
                    for (text) |c| {
                        number = number * 10 + @as(u32, @intCast(c - '0'));
                    }
                    lexer.number = @as(f64, @floatFromInt(number));
                } else {
                    // Parse a double-precision floating-point number
                    if (bun.parseDouble(text)) |num| {
                        lexer.number = num;
                    } else |_| {
                        try lexer.addSyntaxError(lexer.start, "Invalid number", .{});
                    }
                }
            }

            // An underscore must not come last;
            if (lastUnderscoreEnd > 0 and lexer.end == lastUnderscoreEnd + 1) {
                lexer.end -= 1;
                try lexer.syntaxError();
            }

            // Handle bigint literals after the underscore-at-end check above;
            if (lexer.code_point == 'n' and !hasDotOrExponent) {
                lexer.token = T.t_big_integer_literal;
                lexer.step();
            }

            // Identifiers can't occur immediately after numbers;
            if (isIdentifierStart(lexer.code_point)) {
                try lexer.syntaxError();
            }
        }
    };
}

pub const Lexer = NewLexer(.{});

const JSIdentifier = @import("./js_lexer/identifier.zig");
pub inline fn isIdentifierStart(codepoint: i32) bool {
    return JSIdentifier.isIdentifierStart(codepoint);
}
pub inline fn isIdentifierContinue(codepoint: i32) bool {
    return JSIdentifier.isIdentifierPart(codepoint);
}

pub fn isWhitespace(codepoint: CodePoint) bool {
    return switch (codepoint) {
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
        => true,
        else => false,
    };
}

pub fn isIdentifier(text: string) bool {
    if (text.len == 0) {
        return false;
    }

    const iter = strings.CodepointIterator{ .bytes = text, .i = 0 };
    var cursor = strings.CodepointIterator.Cursor{};
    if (!iter.next(&cursor)) return false;

    if (!isIdentifierStart(cursor.c)) {
        return false;
    }

    while (iter.next(&cursor)) {
        if (!isIdentifierContinue(cursor.c)) {
            return false;
        }
    }

    return true;
}

pub fn isIdentifierUTF16(text: []const u16) bool {
    const n = text.len;
    if (n == 0) {
        return false;
    }

    var i: usize = 0;
    while (i < n) {
        const is_start = i == 0;
        var codepoint = @as(CodePoint, text[i]);
        i += 1;

        if (codepoint >= 0xD800 and codepoint <= 0xDBFF and i < n) {
            const surrogate = @as(CodePoint, text[i]);
            if (surrogate >= 0xDC00 and surrogate <= 0xDFFF) {
                codepoint = (codepoint << 10) + surrogate + (0x10000 - (0xD800 << 10) - 0xDC00);
                i += 1;
            }
        }
        if (is_start) {
            if (!isIdentifierStart(@as(CodePoint, codepoint))) {
                return false;
            }
        } else {
            if (!isIdentifierContinue(@as(CodePoint, codepoint))) {
                return false;
            }
        }
    }

    return true;
}

// TODO: implement this to actually work right
// this fn is a stub!
pub fn rangeOfIdentifier(source: *const Source, loc: logger.Loc) logger.Range {
    const contents = source.contents;
    if (loc.start == -1 or @as(usize, @intCast(loc.start)) >= contents.len) return logger.Range.None;

    const iter = strings.CodepointIterator.init(contents[loc.toUsize()..]);
    var cursor = strings.CodepointIterator.Cursor{};

    var r = logger.Range{ .loc = loc, .len = 0 };
    if (iter.bytes.len == 0) {
        return r;
    }
    const text = iter.bytes;
    const end = @as(u32, @intCast(text.len));

    if (!iter.next(&cursor)) return r;

    // Handle private names
    if (cursor.c == '#') {
        if (!iter.next(&cursor)) {
            r.len = 1;
            return r;
        }
    }

    if (isIdentifierStart(cursor.c) or cursor.c == '\\') {
        while (iter.next(&cursor)) {
            if (cursor.c == '\\') {

                // Search for the end of the identifier

                // Skip over bracketed unicode escapes such as "\u{10000}"
                if (cursor.i + 2 < end and text[cursor.i + 1] == 'u' and text[cursor.i + 2] == '{') {
                    cursor.i += 2;
                    while (cursor.i < end) {
                        if (text[cursor.i] == '}') {
                            cursor.i += 1;
                            break;
                        }
                        cursor.i += 1;
                    }
                }
            } else if (!isIdentifierContinue(cursor.c)) {
                r.len = @as(i32, @intCast(cursor.i));
                return r;
            }
        }

        r.len = @as(i32, @intCast(cursor.i));
    }

    // const offset = @intCast(usize, loc.start);
    // var i: usize = 0;
    // for (text) |c| {
    //     if (isIdentifierStart(@as(CodePoint, c))) {
    //         for (source.contents[offset + i ..]) |c_| {
    //             if (!isIdentifierContinue(c_)) {
    //                 r.len = std.math.lossyCast(i32, i);
    //                 return r;
    //             }
    //             i += 1;
    //         }
    //     }

    //     i += 1;
    // }

    return r;
}

inline fn float64(num: anytype) f64 {
    return @as(f64, @floatFromInt(num));
}

pub fn isLatin1Identifier(comptime Buffer: type, name: Buffer) bool {
    if (name.len == 0) return false;

    switch (name[0]) {
        'a'...'z',
        'A'...'Z',
        '$',
        '_',
        => {},
        else => return false,
    }

    if (name.len > 1) {
        for (name[1..]) |c| {
            switch (c) {
                '0'...'9',
                'a'...'z',
                'A'...'Z',
                '$',
                '_',
                => {},
                else => return false,
            }
        }
    }

    return true;
}

fn latin1IdentifierContinueLength(name: []const u8) usize {
    // We don't use SIMD for this because the input will be very short.
    return latin1IdentifierContinueLengthScalar(name);
}

pub fn latin1IdentifierContinueLengthScalar(name: []const u8) usize {
    for (name, 0..) |c, i| {
        switch (c) {
            '0'...'9', 'a'...'z', 'A'...'Z', '$', '_' => {},
            else => return i,
        }
    }

    return name.len;
}

pub const PragmaArg = enum {
    no_space_first,
    skip_space_first,

    pub fn scan(kind: PragmaArg, offset_: usize, pragma: string, text_: string) ?js_ast.Span {
        var text = text_[pragma.len..];
        var iter = strings.CodepointIterator.init(text);

        var cursor = strings.CodepointIterator.Cursor{};
        if (!iter.next(&cursor)) {
            return null;
        }

        var start: u32 = 0;

        // One or more whitespace characters
        if (kind == .skip_space_first) {
            if (!isWhitespace(cursor.c)) {
                return null;
            }

            while (isWhitespace(cursor.c)) {
                if (!iter.next(&cursor)) {
                    break;
                }
            }
            start = cursor.i;
            text = text[cursor.i..];
            cursor = .{};
            iter = strings.CodepointIterator.init(text);
            _ = iter.next(&cursor);
        }

        var i: usize = 0;
        while (!isWhitespace(cursor.c)) {
            i += cursor.width;
            if (i >= text.len) {
                break;
            }

            if (!iter.next(&cursor)) {
                break;
            }
        }

        return js_ast.Span{
            .range = logger.Range{
                .len = @as(i32, @intCast(i)),
                .loc = logger.Loc{
                    .start = @as(i32, @intCast(start + @as(u32, @intCast(offset_)) + @as(u32, @intCast(pragma.len)))),
                },
            },
            .text = text[0..i],
        };
    }
};

fn skipToInterestingCharacterInMultilineComment(text_: []const u8) ?u32 {
    var text = text_;
    const star: @Vector(strings.ascii_vector_size, u8) = @splat(@as(u8, '*'));
    const carriage: @Vector(strings.ascii_vector_size, u8) = @splat(@as(u8, '\r'));
    const newline: @Vector(strings.ascii_vector_size, u8) = @splat(@as(u8, '\n'));
    const V1x16 = strings.AsciiVectorU1;

    const text_end_len = text.len & ~(@as(usize, strings.ascii_vector_size) - 1);
    bun.assert(text_end_len % strings.ascii_vector_size == 0);
    bun.assert(text_end_len <= text.len);

    const text_end_ptr = text.ptr + text_end_len;

    while (text_end_ptr != text.ptr) {
        const vec: strings.AsciiVector = text.ptr[0..strings.ascii_vector_size].*;

        const any_significant =
            @as(V1x16, @bitCast(vec > strings.max_16_ascii)) |
            @as(V1x16, @bitCast(star == vec)) |
            @as(V1x16, @bitCast(carriage == vec)) |
            @as(V1x16, @bitCast(newline == vec));

        if (@reduce(.Max, any_significant) > 0) {
            const bitmask = @as(u16, @bitCast(any_significant));
            const first = @ctz(bitmask);
            bun.assert(first < strings.ascii_vector_size);
            bun.assert(text.ptr[first] == '*' or text.ptr[first] == '\r' or text.ptr[first] == '\n' or text.ptr[first] > 127);
            return @as(u32, @truncate(first + (@intFromPtr(text.ptr) - @intFromPtr(text_.ptr))));
        }
        text.ptr += strings.ascii_vector_size;
    }

    return @as(u32, @truncate(@intFromPtr(text.ptr) - @intFromPtr(text_.ptr)));
}

/// for '`', finds the first
fn nonVectorIndexOfInterestingCharacterInString(text: []const u8, comptime quote: u8, comptime utf8_is_interesting: bool) ?usize {
    for (text, 0..) |char, i| {
        switch (quote) {
            0 => switch (char) {
                '\\' => return i,
                0...0x1F => return i,
                0x80...0xFF => if (utf8_is_interesting) return i,
                else => {},
            },
            '\'', '"' => switch (char) {
                quote => return i,
                '\\' => return i,
                0...0x1F => return i,
                0x80...0xFF => if (utf8_is_interesting) return i,
                else => {},
            },
            '`' => switch (char) {
                quote => return i,
                '\\' => return i,
                '$' => return i,
                0...0x1F => return i,
                0x80...0xFF => if (utf8_is_interesting) return i,
                else => {},
            },
            else => @compileError("bad quote"),
        }
    }
    return null;
}
pub fn indexOfInterestingCharacterInString(text_: []const u8, comptime quote: u8, comptime utf8_is_interesting: bool) ?usize {
    var text = text_;
    if (Environment.isNative) {
        const vec_quote: strings.AsciiVector = @splat(quote);
        const vec_backslash: strings.AsciiVector = @splat('\\');
        const vec_dollars: strings.AsciiVector = @splat('$');
        const V1x16 = strings.AsciiVectorU1;

        while (text.len >= strings.ascii_vector_size) {
            const vec: strings.AsciiVector = text[0..strings.ascii_vector_size].*;

            // vec < strings.min_16_ascii will save a vector comparison
            const any_significant = switch (quote) {
                // '\\', < 0x20 incl \r \n
                0 => switch (utf8_is_interesting) {
                    true => (@as(V1x16, @bitCast(vec_backslash == vec)) |
                        @as(V1x16, @bitCast(vec < strings.min_16_ascii)) |
                        @as(V1x16, @bitCast(vec > strings.max_16_ascii))),
                    false => @as(V1x16, @bitCast(vec_backslash == vec)) |
                        @as(V1x16, @bitCast(vec < strings.min_16_ascii)),
                },
                // '\''/'"' '\\', < 0x20 incl \r \n
                '\'', '"' => switch (utf8_is_interesting) {
                    true => @as(V1x16, @bitCast(vec_quote == vec)) |
                        @as(V1x16, @bitCast(vec_backslash == vec)) |
                        @as(V1x16, @bitCast(vec < strings.min_16_ascii)) |
                        @as(V1x16, @bitCast(vec > strings.max_16_ascii)),
                    false => @as(V1x16, @bitCast(vec_quote == vec)) |
                        @as(V1x16, @bitCast(vec_backslash == vec)) |
                        @as(V1x16, @bitCast(vec < strings.min_16_ascii)),
                },
                // '`' '\\', '$', '\xE2', < 0x20 incl \r \n,
                '`' => switch (utf8_is_interesting) {
                    true => @as(V1x16, @bitCast(vec_quote == vec)) |
                        @as(V1x16, @bitCast(vec_backslash == vec)) |
                        @as(V1x16, @bitCast(vec_dollars == vec)) |
                        @as(V1x16, @bitCast(vec < strings.min_16_ascii)) |
                        @as(V1x16, @bitCast(vec > strings.max_16_ascii)),
                    false => @as(V1x16, @bitCast(vec_quote == vec)) |
                        @as(V1x16, @bitCast(vec_backslash == vec)) |
                        @as(V1x16, @bitCast(vec_dollars == vec)) |
                        @as(V1x16, @bitCast(vec < strings.min_16_ascii)),
                },
                else => @compileError("not supported"),
            };

            if (@reduce(.Max, any_significant) > 0) {
                const bitmask = @as(u16, @bitCast(any_significant));
                const first = @ctz(bitmask);
                bun.assert(first < strings.ascii_vector_size);
                return first + (@intFromPtr(text.ptr) - @intFromPtr(text_.ptr));
            }
            text = text[strings.ascii_vector_size..];
        }
    }

    if (nonVectorIndexOfInterestingCharacterInString(text, quote, utf8_is_interesting)) |res| return res + (@intFromPtr(text.ptr) - @intFromPtr(text_.ptr));
    return null;
}
