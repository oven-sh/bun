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

pub const Lexer = struct {
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
    code_point: CodePoint = 0,
    string_literal: []u16,
    identifier: []u8 = "",
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

    pub fn addError(self: *Lexer, loc: logger.Loc, text: []u8) void {
        if (loc == self.prevErrorLoc) {
            return;
        }

        self.prev_error_loc = loc;
    }

    pub fn codePointEql(self: *Lexer, a: u8) bool {
        return @intCast(CodePoint, a) == self.code_point;
    }

    fn nextCodepoint(it: *Lexer) callconv(.Inline) CodePoint {
        const slice = it.nextCodepointSlice() orelse return @as(CodePoint, 0);

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

    pub fn next(self: *Lexer) void {}

    pub fn init(log: logger.Log, source: logger.Source) Lexer {
        var string_literal = [1]u16{0};

        var lex = Lexer{
            .log = log,
            .source = source,
            .string_literal = &string_literal,
            .prev_error_loc = -1,
        };
        lex.step();
        lex.next();

        return lex;
    }
};

test "Lexer.step()" {
    const msgs = std.ArrayList(logger.Msg).init(std.testing.allocator);
    const log = logger.Log{
        .msgs = msgs,
    };

    var sourcefile = "for (let i = 0; i < 100; i++) { console.log('hi'); }".*;
    var identifier_name = "loop".*;
    defer std.testing.allocator.free(msgs.items);
    const source = logger.Source{ .index = 0, .contents = &sourcefile, .identifier_name = &identifier_name };

    var lex = Lexer.init(log, source);
    std.testing.expect('f' == lex.code_point);
    lex.step();
    std.testing.expect('o' == lex.code_point);
    lex.step();
    std.testing.expect('r' == lex.code_point);
}
