const std = @import("std");
const logger = @import("../logger.zig");
const js_ast = @import("../js_ast.zig");

const _global = @import("../global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const CodePoint = _global.CodePoint;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const js_lexer = @import("../js_lexer.zig");
const JSLexerTable = @import("../js_lexer_tables.zig");

pub const T = enum {
    t_export,
    t_import,

    t_end_of_file,
    t_empty_line,
    t_star,
    t_star_2,
    t_star_3,
    t_dash,
    t_dash_2,
    t_dash_3,
    t_dash_4,
    t_dash_5,
    t_dash_6,
    t_underscore,
    t_underscore_2,
    t_underscore_3,

    t_hash,
    t_hash_2,
    t_hash_3,
    t_hash_4,
    t_hash_5,
    t_hash_6,

    t_equals,

    t_text,

    t_paren_open,
    t_paren_close,

    t_tilde,
    t_backtick,

    t_bang_bracket_open,
    t_bracket_open,
    t_bracket_close,

    t_js_block_open,
    t_js_block_close,
    t_less_than,
    t_greater_than,
    t_greater_than_greater_than,

    t_ampersand,
    t_string,
};

const tokenToString: std.enums.EnumArray(T, string) = brk: {
    var map = std.enums.EnumArray(T, string).initFill("");
    map.set("import", .t_export);
    map.set("export", .t_import);
    map.set("end of file", .t_end_of_file);
    map.set("empty line", .t_empty_line);
    map.set("*", .t_star);
    map.set("*", .t_star_2);
    map.set("*", .t_star_3);
    map.set("-", .t_dash);
    map.set("-", .t_dash_2);
    map.set("-", .t_dash_3);
    map.set("-", .t_dash_4);
    map.set("-", .t_dash_5);
    map.set("-", .t_dash_6);
    map.set("_", .t_underscore);
    map.set("_", .t_underscore_2);
    map.set("_", .t_underscore_3);
    map.set("#", .t_hash);
    map.set("#", .t_hash_2);
    map.set("#", .t_hash_3);
    map.set("#", .t_hash_4);
    map.set("#", .t_hash_5);
    map.set("#", .t_hash_6);
    map.set("=", .t_equals);
    map.set("text", .t_text);
    map.set("(", .t_paren_open);
    map.set(")", .t_paren_close);
    map.set("~", .t_tilde);
    map.set("`", .t_backtick);
    map.set("![", .t_bang_bracket_open);
    map.set("[", .t_bracket_open);
    map.set("]", .t_bracket_close);
    map.set("{", .t_js_block_open);
    map.set("}", .t_js_block_close);
    map.set("<", .t_less_than);
    map.set(">", .t_greater_than);
    map.set(">>", .t_greater_than_greater_than);
    map.set("&", .t_ampersand);
    map.set("''", .t_string);
    break :brk map;
};

pub const Lexer = struct {
    const JSLexer = js_lexer.Lexer;
    js: *JSLexer,
    token: T = T.t_end_of_file,
    // we only care about indentation up to 3 spaces
    // if it exceeds 3 spaces, it is not relevant for parsing
    indent: u3 = 0,

    link: Link = Link{},
    info: string = "",

    pub fn init(js: *JSLexer) !Lexer {
        var lex = Lexer{
            .js = js,
        };
        lex.step();
        try lex.next();
        return lex;
    }

    const Link = struct {
        title: string = "",
        href: string = "",
    };

    pub fn expected(self: *Lexer, token: T) !void {
        if (tokenToString.get(token).len > 0) {
            try self.expectedString(tokenToString.get(token));
        } else {
            try self.unexpected();
        }
    }

    pub inline fn expect(self: *Lexer, comptime token: T) !void {
        if (self.token != token) {
            try self.expected(token);
        }

        try self.next();
    }

    pub inline fn codePoint(this: *const Lexer) CodePoint {
        return this.js.code_point;
    }

    pub inline fn log(this: *Lexer) *logger.Log {
        return this.js.log;
    }

    pub inline fn loc(self: *const Lexer) logger.Loc {
        return self.js.loc();
    }
    pub fn syntaxError(self: *Lexer) !void {
        return try self.js.syntaxError();
    }
    pub fn addError(self: *Lexer, _loc: usize, comptime format: []const u8, args: anytype, _: bool) void {
        return self.js.addError(_loc, format, args, false);
    }
    pub fn addDefaultError(self: *Lexer, msg: []const u8) !void {
        return try self.js.addDefaultError(msg);
    }

    pub fn addRangeError(self: *Lexer, r: logger.Range, comptime format: []const u8, args: anytype, _: bool) !void {
        return try self.js.addRangeError(r, format, args, false);
    }

    inline fn step(lexer: *Lexer) void {
        lexer.js.step();
    }

    pub inline fn raw(self: *Lexer) []const u8 {
        return self.js.raw();
    }

    pub inline fn identifier(self: *Lexer) []const u8 {
        return self.js.identifier;
    }

    fn peek(self: *Lexer, n: usize) []const u8 {
        return self.js.peek(n);
    }

    fn consumeIndent(self: *Lexer) void {
        self.indent = 0;

        while (true) {
            switch (self.codePoint()) {
                ' ', '\t', 0x000C => {
                    self.indent +|= 1;
                    if (self.indent > 3) {
                        self.step();
                        return;
                    }
                },
                else => return,
            }
            self.step();
        }
    }

    pub inline fn toEString(
        lexer: *Lexer,
    ) js_ast.E.String {
        return lexer.js.toEString();
    }

    pub fn nextInsideLink(lexer: *Lexer, comptime allow_space: bool) !bool {
        var js = &lexer.js;
        js.has_newline_before = js.end == 0;
        while (true) {
            switch (js.code_point) {
                ']' => {
                    lexer.step();
                    lexer.token = T.t_bracket_close;
                    js.string_literal_slice = js.raw();
                    js.string_literal_is_ascii = true;
                    return true;
                },
                '(' => {
                    lexer.step();
                    lexer.token = T.t_paren_open;
                    return true;
                },
                ')' => {
                    lexer.step();
                    lexer.token = T.t_paren_close;
                    return true;
                },
                '\\' => {
                    lexer.step();
                    lexer.step();
                    lexer.token = T.t_text;
                },
                ' ', '\t', 0x000C => {
                    lexer.step();
                    lexer.token = T.t_text;

                    if (allow_space) {
                        continue;
                    }

                    return false;
                },
                -1, '\r', '\n', 0x2028, 0x2029 => {
                    lexer.step();
                    lexer.token = T.t_text;
                    return false;
                },
                else => {},
            }
            lexer.step();
        }
        unreachable;
    }

    pub fn next(lexer: *Lexer) !void {
        var js = &lexer.js;
        js.has_newline_before = js.end == 0;
        lexer.indent = 0;

        while (true) {
            js.start = js.end;
            js.token = .t_end_of_file;

            switch (js.code_point) {
                -1 => {
                    lexer.token = T.t_end_of_file;
                    lexer.indent = 0;
                },

                ' ', '\t', 0x000C => {
                    lexer.indent +|= 1;
                    lexer.step();

                    continue;
                },

                '\r', '\n', 0x2028, 0x2029 => {
                    const was_empty_line = js.has_newline_before;
                    lexer.step();
                    js.has_newline_before = true;
                    if (was_empty_line) {
                        lexer.token = T.t_empty_line;
                        return;
                    }
                    continue;
                },

                '{' => {
                    lexer.token = T.t_js_block_open;
                    lexer.step();

                    return;
                },
                '<' => {
                    lexer.token = T.t_less_than;
                    lexer.js.token = .t_less_than;
                    lexer.step();
                    return;
                },
                '>' => {
                    lexer.token = T.t_greater_than;
                    lexer.js.token = .t_greater_than;
                    lexer.step();
                    if (lexer.codePoint() == '>') {
                        lexer.step();
                        lexer.token = T.t_greater_than_greater_than;
                        js.token = T.t_greater_than_greater_than;
                    }
                    return;
                },

                '*' => {
                    lexer.step();
                    lexer.token = T.t_star;
                    lexer.consumeIndent();

                    if (lexer.codePoint() == '*') {
                        lexer.token = T.t_star_2;
                        lexer.step();
                        lexer.consumeIndent();

                        if (lexer.codePoint() == '*') {
                            lexer.token = T.t_star_3;
                            lexer.step();
                            lexer.consumeIndent();

                            if (!js.has_newline_before and lexer.codePoint() == "*") {
                                if (lexer.peek(1)[0] == '*') {
                                    lexer.token = T.t_star_2;
                                    lexer.step();
                                    lexer.step();
                                    js.string_literal_slice = "";
                                    return;
                                }
                            }
                        }
                    }

                    return;
                },
                '_' => {
                    lexer.step();
                    lexer.token = T.t_star;
                    lexer.consumeIndent();

                    if (lexer.codePoint() == '_') {
                        lexer.token = T.t_star_2;
                        lexer.step();
                        lexer.consumeIndent();

                        if (lexer.codePoint() == '_') {
                            lexer.token = T.t_star_3;
                            lexer.step();
                            lexer.consumeIndent();

                            if (!js.has_newline_before and lexer.codePoint() == "_") {
                                if (lexer.peek(1)[0] == '_') {
                                    lexer.token = T.t_star_2;
                                    lexer.step();
                                    lexer.step();
                                    js.string_literal_slice = "";
                                    return;
                                }
                            }
                        }
                    }

                    return;
                },

                '#' => {
                    if (!js.has_newline_before or lexer.indent > 3) {
                        lexer.step();
                        continue;
                    }

                    lexer.token = T.t_hash;
                    lexer.step();
                    lexer.consumeIndent();
                    if (lexer.codePoint() == '#') {
                        lexer.token = T.t_hash_2;
                        lexer.step();
                        lexer.consumeIndent();
                        if (lexer.codePoint() == '#') {
                            lexer.token = T.t_hash_3;
                            lexer.step();
                            lexer.consumeIndent();
                            if (lexer.codePoint() == '#') {
                                lexer.token = T.t_hash_4;
                                lexer.step();
                                lexer.consumeIndent();
                                if (lexer.codePoint() == '#') {
                                    lexer.token = T.t_hash_5;
                                    lexer.step();
                                    lexer.consumeIndent();
                                    if (lexer.codePoint() == '#') {
                                        lexer.token = T.t_hash_6;
                                        lexer.step();
                                        lexer.consumeIndent();
                                    }
                                }
                            }
                        }
                    }

                    return;
                },
                '=' => {
                    lexer.token = T.t_text;
                    lexer.step();

                    if (lexer.js.has_newline_before) {
                        lexer.token = T.t_equals;
                        js.token = T.t_equals;
                        return;
                    }
                },
                '!' => {
                    lexer.token = T.t_text;
                    lexer.step();

                    if (lexer.codePoint() == '[') {
                        lexer.token = T.t_bang_bracket_open;
                        lexer.step();
                        return;
                    }
                },
                '[' => {
                    lexer.token = T.t_bracket_open;
                    lexer.step();
                    return;
                },
                '`' => {
                    lexer.token = T.t_backtick;
                    lexer.step();
                    return;
                },
                '~' => {
                    lexer.token = T.t_tilde;

                    lexer.step();
                },
                '\\' => {
                    lexer.token = T.t_text;
                    lexer.step();
                    lexer.step();
                    continue;
                },
                '&' => {
                    const start = lexer.js.start;
                    lexer.step();
                    lexer.js.start = lexer.js.current;

                    inner: while (true) {
                        switch (lexer.codePoint()) {
                            ';' => {
                                const label = lexer.raw();
                                lexer.step();
                                js.string_literal = try js.fixWhitespaceAndDecodeJSXEntities(lexer, label);
                                js.string_literal_is_ascii = false;
                                lexer.token = T.t_string;
                                return;
                            },
                            -1, '\r', '\n', 0x2028, 0x2029, ' ', '\t' => {
                                lexer.js.start = start;
                                lexer.step();
                                lexer.token = T.t_text;
                                break :inner;
                            },
                            else => {},
                        }
                        lexer.step();
                    }

                    continue;
                },
                '|' => {
                    lexer.token = T.t_bar;
                    lexer.step();
                    return;
                },
                'i' => {
                    lexer.step();
                    lexer.token = T.t_text;
                    if (js.has_newline_before) {
                        if (strings.eqlComptime(lexer.peek("mport ".len), "mport ")) {
                            lexer.step();
                            lexer.step();
                            lexer.step();
                            lexer.step();
                            lexer.step();
                            lexer.token = T.t_import;
                            lexer.consumeIndent();
                            return;
                        }
                    }
                },

                'e' => {
                    lexer.step();
                    lexer.token = T.t_text;
                    if (js.has_newline_before) {
                        if (strings.eqlComptime(lexer.peek("xport ".len), "xport ")) {
                            lexer.step();
                            lexer.step();
                            lexer.step();
                            lexer.step();
                            lexer.step();
                            lexer.token = T.t_export;
                            lexer.consumeIndent();
                            return;
                        }
                    }
                },
                else => {
                    lexer.step();
                    lexer.token = .t_text;
                    while (true) {
                        switch (lexer.codePoint()) {
                            '\\' => {
                                lexer.step();
                                lexer.step();
                                continue;
                            },
                            -1, '\r', '\n', 0x2028, 0x2029, '&', '~', '{', '<', '*', '_', '!', '[', '`' => {
                                js.string_literal_slice = lexer.raw();
                                return;
                            },
                            else => {},
                        }

                        lexer.step();
                    }
                },
            }
        }
    }
};

inline fn float64(num: anytype) f64 {
    return @intToFloat(f64, num);
}
