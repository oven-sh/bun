const std = @import("std");
const builtin = @import("builtin");
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayList;

extern "C" fn setenv(name: [*:0]const u8, value: [*:0]const u8, overwrite: i32) i32;

fn setEnv(name: [*:0]const u8, value: [*:0]const u8) void {
    // TODO: windows
    _ = setenv(name, value, 1);
}

pub const Interpreter = struct {
    allocator: Allocator,
    env: std.StringArrayHashMap([]const u8),

    pub fn new(allocator: Allocator) Interpreter {
        return .{
            .allocator = allocator,
            .env = std.StringArrayHashMap([]const u8).init(allocator),
        };
    }

    pub fn interpret(self: *Interpreter, script: AST.Script) !void {
        for (script.stmts) |*stmt| {
            for (stmt.exprs) |*expr| {
                try self.interpret_expr(expr);
            }
        }
    }

    fn interpret_expr(self: *Interpreter, expr: *const AST.Expr) !void {
        _ = self;
        switch (@as(AST.Expr.Tag, expr.*)) {
            .assign => {},
            .cond => {},
            .pipeline => {},
            .cmd => {},
        }
    }
};

pub const AST = struct {
    pub const Script = struct {
        stmts: []Stmt,

        pub fn format(self: *const Script, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            _ = options;
            try std.fmt.format(writer, "{s} Stmt({any})", .{ fmt, self.stmts });
        }
    };

    pub const Stmt = struct {
        exprs: []Expr,
    };

    pub const Expr = union(Expr.Tag) {
        assign: []Assign,
        cond: *Conditional,
        pipeline: *Pipeline,
        cmd: *Cmd,

        const Tag = enum { assign, cond, pipeline, cmd };

        pub fn format(self: *const Expr, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            _ = options;
            switch (@as(Expr.Tag, self.*)) {
                .cmd => try std.fmt.format(writer, "{s} Expr.Cmd({any})", .{ fmt, self.cmd }),
                .cond => try std.fmt.format(writer, "{s} Expr.Cond({any})", .{ fmt, self.cond }),
                .pipeline => try std.fmt.format(writer, "{s} Expr.Pipeline({any})", .{ fmt, self.pipeline }),
                .assign => try std.fmt.format(writer, "{s} Expr.Assign({any})", .{ fmt, self.assign }),
            }
        }
    };

    pub const Conditional = struct {
        op: Op,
        left: Expr,
        right: Expr,

        const Op = enum { And, Or };
    };

    pub const Pipeline = struct {
        items: []CmdOrAssigns,
    };

    pub const CmdOrAssigns = union(CmdOrAssigns.Tag) {
        cmd: Cmd,
        assigns: []Assign,

        const Tag = enum { cmd, assigns };

        pub fn format(self: *const CmdOrAssigns, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            _ = options;
            switch (@as(CmdOrAssigns.Tag, self.*)) {
                .cmd => try std.fmt.format(writer, "{s} CmdOrAssigns.Cmd({any})", .{ fmt, self.cmd }),
                .assigns => try std.fmt.format(writer, "{s} CmdOrAssigns.Assigns({any})", .{ fmt, self.assigns }),
            }
        }

        pub fn to_expr(this: CmdOrAssigns, alloc: Allocator) !Expr {
            switch (this) {
                .cmd => |cmd| {
                    var cmd_ptr = try alloc.create(Cmd);
                    cmd_ptr.* = cmd;
                    return .{ .cmd = cmd_ptr };
                },
                .assigns => |assigns| {
                    return .{ .assign = assigns };
                },
            }
        }
    };

    pub const Assign = struct {
        label: []const u8,
        value: Atom,

        pub fn new(label: []const u8, value: Atom) Assign {
            return .{
                .label = label,
                .value = value,
            };
        }

        pub fn format(self: *const Assign, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            _ = options;
            try std.fmt.format(writer, "{s} Assign( .label = {s}, .value = {any})", .{ fmt, self.label, self.value });
        }
    };

    pub const Cmd = struct {
        assigns: []Assign,
        name_and_args: []Atom,
        redirect: Redirect = .None,
        redirect_file: ?Atom = null,

        /// Bit flags for redirects:
        /// -  `>`  = Redirect.Stdout
        /// -  `1>` = Redirect.Stdout
        /// -  `2>` = Redirect.Stderr
        /// -  `&>` = Redirect.Stdout | Redirect.Stderr
        /// -  `>>` = Redirect.Append | Redirect.Stdout
        /// - `1>>` = Redirect.Append | Redirect.Stdout
        /// - `2>>` = Redirect.Append | Redirect.Stderr
        /// - `&>>` = Redirect.Append | Redirect.Stdout | Redirect.Stderr
        ///
        /// Multiple redirects and redirecting stdin is not supported yet.
        pub const Redirect = enum(u8) {
            None = 0,
            Stdout = 1,
            Stderr = 2,
            Append = 4,
        };
    };

    pub const Atom = union(enum) {
        simple: SimpleAtom,
        compound: CompoundAtom,

        pub fn new_simple(atom: SimpleAtom) Atom {
            return .{ .simple = atom };
        }

        pub fn new_compound(atom: CompoundAtom) Atom {
            return .{ .compound = atom };
        }

        pub fn is_compound(self: *const Atom) bool {
            switch (self.*) {
                .compound => return true,
                else => return false,
            }
        }
    };

    pub const SimpleAtom = union(enum) {
        Var: []const u8,
        Text: []const u8,

        pub fn format(self: *const SimpleAtom, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            _ = options;
            switch (self.*) {
                .Var => |x| try std.fmt.format(writer, "{s} Var({s})", .{ fmt, x }),
                .Text => |x| try std.fmt.format(writer, "{s} Text({s})", .{ fmt, x }),
            }
        }
    };

    pub const CompoundAtom = struct {
        atoms: []SimpleAtom,

        pub fn format(self: *const CompoundAtom, comptime fmt: []const u8, options: std.fmt.FormatOptions, writer: anytype) !void {
            _ = options;
            try std.fmt.format(writer, "{s} {any}", .{ fmt, self.atoms });
        }
    };
};

pub const Parser = struct {
    strpool: []const u8,
    tokens: []const Token,
    alloc: Allocator,

    current: u32 = 0,

    pub fn new(allocator: Allocator, lexer: *const Lexer) !Parser {
        return .{
            .strpool = lexer.buf.items[0..lexer.buf.items.len],
            .tokens = lexer.tokens.items[0..lexer.tokens.items.len],
            .alloc = allocator,
        };
    }

    pub fn parse(self: *Parser) !AST.Script {
        var stmts = ArrayList(AST.Stmt).init(self.alloc);
        while (!self.match(.Eof)) {
            try stmts.append(try self.parse_stmt());
        }
        _ = self.expect(.Eof);
        return .{ .stmts = stmts.items[0..stmts.items.len] };
    }

    pub fn parse_stmt(self: *Parser) !AST.Stmt {
        var exprs = std.ArrayList(AST.Expr).init(self.alloc);

        // {
        //     var assigns = std.ArrayList(AST.Assign).init(self.alloc);
        //     // Parse leading var decls
        //     while (!self.match_any(&.{ .Semicolon, .Eof })) {
        //         if (try self.parse_assign()) |assign| {
        //             try assigns.append(assign);
        //         } else {
        //             break;
        //         }
        //     }

        //     if (assigns.items.len > 0) {
        //         try exprs.append(.{ .assign = assigns.items[0..] });
        //     }
        // }

        // if (self.match_any(&.{ .Semicolon, .Eof })) return .{ .exprs = exprs.items[0..] };

        while (!self.match_any(&.{ .Semicolon, .Eof })) {
            const expr = try self.parse_expr();
            try exprs.append(expr);
        }

        return .{
            .exprs = exprs.items[0..],
        };
    }

    fn parse_expr(self: *Parser) !AST.Expr {
        return self.parse_cond();
    }

    fn parse_cond(self: *Parser) !AST.Expr {
        var left = try self.parse_pipeline();
        while (self.match_any(&.{ .DoubleAmpersand, .DoublePipe })) {
            const op: AST.Conditional.Op = op: {
                const previous = @as(TokenTag, self.prev());
                switch (previous) {
                    .DoubleAmpersand => break :op .And,
                    .DoublePipe => break :op .Or,
                    else => unreachable,
                }
            };

            const right = try self.parse_pipeline();
            const conditional = try self.allocate(AST.Conditional, .{ .op = op, .left = left, .right = right });
            left = .{ .cond = conditional };
        }

        return left;
    }

    fn parse_pipeline(self: *Parser) !AST.Expr {
        var cmd = try self.parse_cmd_or_assigns();

        if (self.peek() == .Pipe) {
            var cmds = std.ArrayList(AST.CmdOrAssigns).init(self.alloc);
            try cmds.append(cmd);
            while (self.match(.Pipe)) {
                try cmds.append(try self.parse_cmd_or_assigns());
            }
            const pipeline = try self.allocate(AST.Pipeline, .{ .items = cmds.items[0..] });
            return .{ .pipeline = pipeline };
        }

        return try cmd.to_expr(self.alloc);
    }

    fn parse_cmd_or_assigns(self: *Parser) !AST.CmdOrAssigns {
        var assigns = std.ArrayList(AST.Assign).init(self.alloc);
        while (!self.match_any(&.{ .Semicolon, .Eof })) {
            if (try self.parse_assign()) |assign| {
                try assigns.append(assign);
            } else {
                break;
            }
        }

        if (self.match_any(&.{ .Semicolon, .Eof })) return .{ .assigns = assigns.items[0..] };

        const name = try self.parse_atom() orelse return .{ .assigns = assigns.items[0..] };
        var name_and_args = std.ArrayList(AST.Atom).init(self.alloc);
        try name_and_args.append(name);
        while (try self.parse_atom()) |arg| {
            try name_and_args.append(arg);
        }

        // TODO Parse redirects (need to update lexer to have tokens for different parts e.g. &>>)
        const redirect = self.parse_redirect();
        const redirect_file = redirect_file: {
            if (redirect != AST.Cmd.Redirect.None) {
                const redirect_file = try self.parse_atom() orelse @panic("Redirection with no file");
                break :redirect_file redirect_file;
            }
            break :redirect_file null;
        };
        // TODO check for multiple redirects and error

        return .{ .cmd = .{
            .assigns = assigns.items[0..],
            .name_and_args = name_and_args.items[0..],
            .redirect = redirect,
            .redirect_file = redirect_file,
        } };
    }

    // TODO Other redirects (e.g. &>>), probably should have tokens for each kind
    fn parse_redirect(self: *Parser) AST.Cmd.Redirect {
        if (self.match(.RightArrow)) {
            return AST.Cmd.Redirect.Stdout;
        }

        return AST.Cmd.Redirect.None;
    }

    /// Try to parse an assignment. If no assignment could be parsed then return
    /// null and backtrack the parser state
    /// TODO `export FOO=bar`
    fn parse_assign(self: *Parser) !?AST.Assign {
        switch (self.peek()) {
            .Text => |txtrng| {
                const start_idx = self.current;
                _ = self.expect(.Text);
                const txt = self.text(txtrng);
                const var_decl: ?AST.Assign = var_decl: {
                    if (self.has_eq_sign(txt)) |eq_idx| {
                        // If it starts with = then it's not valid assignment (e.g. `=FOO`)
                        if (eq_idx == 0) break :var_decl null;
                        const label = txt[0..eq_idx];

                        if (eq_idx == txt.len - 1) {
                            const atom = try self.parse_atom() orelse @panic("OOPS");
                            break :var_decl .{ .label = label, .value = atom };
                        }

                        const txt_value = txt[eq_idx + 1 .. txt.len];
                        _ = self.expect_delimit();
                        break :var_decl .{ .label = label, .value = .{ .simple = .{ .Text = txt_value } } };
                    }
                    break :var_decl null;
                };

                if (var_decl) |vd| {
                    return vd;
                }

                self.current = start_idx;
                return null;
            },
            else => return null,
        }
    }

    fn parse_atom(self: *Parser) !?AST.Atom {
        var array_alloc = std.heap.stackFallback(@sizeOf(AST.SimpleAtom), self.alloc);
        var exprs = try std.ArrayList(AST.SimpleAtom).initCapacity(array_alloc.get(), 1);
        {
            while (!self.match(.Delimit)) {
                const next = self.peek_n(1);
                const next_delimits = next == .Delimit or next == .Eof;
                const peeked = self.peek();
                switch (peeked) {
                    .Text => |txtrng| {
                        _ = self.expect(.Text);
                        const txt = self.text(txtrng);
                        try exprs.append(.{ .Text = txt });
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            break;
                        }
                    },
                    .Var => |txtrng| {
                        _ = self.expect(.Var);
                        const txt = self.text(txtrng);
                        try exprs.append(.{ .Var = txt });
                        if (next_delimits) {
                            _ = self.expect_delimit();
                            break;
                        }
                    },
                    else => return null,
                }
            }
        }

        return switch (exprs.items.len) {
            0 => null,
            1 => {
                std.debug.assert(exprs.capacity == 1);
                return AST.Atom.new_simple(exprs.items[0]);
            },
            else => .{ .compound = .{ .atoms = exprs.items[0..exprs.items.len] } },
        };
    }

    fn allocate(self: *const Parser, comptime T: type, val: T) !*T {
        var heap = try self.alloc.create(T);
        heap.* = val;
        return heap;
    }

    fn text(self: *const Parser, range: Token.TextRange) []const u8 {
        return self.strpool[range.start..range.end];
    }

    fn has_eq_sign(self: *Parser, str: []const u8) ?u32 {
        _ = self;
        // TODO: simd
        for (str, 0..) |c, i| if (c == '=') return @intCast(i);
        return null;
    }

    fn advance(self: *Parser) Token {
        if (!self.is_at_end()) {
            self.current += 1;
        }
        return self.prev();
    }

    fn is_at_end(self: *Parser) bool {
        return self.peek() == .Eof;
    }

    fn expect(self: *Parser, toktag: TokenTag) Token {
        std.debug.assert(toktag == @as(TokenTag, self.peek()));
        if (self.check(toktag)) {
            return self.advance();
        }
        unreachable;
    }

    fn expect_delimit(self: *Parser) Token {
        std.debug.assert(.Delimit == @as(TokenTag, self.peek()) or .Eof == @as(TokenTag, self.peek()));
        if (self.check(.Delimit) or self.check(.Eof)) {
            return self.advance();
        }
        unreachable;
    }

    fn match(self: *Parser, toktag: TokenTag) bool {
        if (@as(TokenTag, self.peek()) == toktag) {
            _ = self.advance();
            return true;
        }
        return false;
    }

    fn match_any(self: *Parser, comptime toktags: []const TokenTag) bool {
        const peeked = @as(TokenTag, self.peek());
        inline for (toktags) |tag| {
            if (peeked == tag) {
                _ = self.advance();
                return true;
            }
        }
        return false;
    }

    fn check(self: *Parser, toktag: TokenTag) bool {
        return @as(TokenTag, self.peek()) == @as(TokenTag, toktag);
    }

    fn peek(self: *Parser) Token {
        return self.tokens[self.current];
    }

    fn peek_n(self: *Parser, n: u32) Token {
        if (self.current + n >= self.tokens.len) {
            return self.tokens[self.tokens.len - 1];
        }

        return self.tokens[self.current + n];
    }

    fn prev(self: *Parser) Token {
        return self.tokens[self.current - 1];
    }
};

pub const TokenTag = enum {
    Pipe,
    DoublePipe,
    Ampersand,
    DoubleAmpersand,
    RightArrow,
    Dollar,
    Asterisk,
    Eq,
    Semicolon,
    BraceBegin,
    BraceEnd,
    Var,
    Text,
    Delimit,
    Eof,
};

pub const Token = union(TokenTag) {
    // |
    Pipe,
    // ||
    DoublePipe,
    // &
    Ampersand,
    // &&
    DoubleAmpersand,
    // >
    RightArrow,
    // $
    Dollar,
    // *
    Asterisk,
    // =
    Eq,
    // ;
    Semicolon,

    BraceBegin,
    BraceEnd,

    Var: TextRange,
    Text: TextRange,

    Delimit,
    Eof,

    pub const TextRange = struct {
        start: u32,
        end: u32,
    };

    pub fn debug(self: Token, buf: []const u8) void {
        switch (self) {
            .Var => |txt| {
                std.debug.print("(var) {s}\n", .{buf[txt.start..txt.end]});
            },
            .Text => |txt| {
                std.debug.print("(txt) {s}\n", .{buf[txt.start..txt.end]});
            },
            else => {
                std.debug.print("{s}\n", .{@tagName(self)});
            },
        }
    }
};

pub const Lexer = struct {
    src: []const u8,
    i: u32 = 0,
    j: u32 = 0,

    buf: ArrayList(u8),
    tokens: ArrayList(Token),
    state: State = .Normal,
    word_start: u32 = 0,
    delimit_quote: bool = false,

    const State = enum {
        Normal,
        Single,
        Double,
    };

    const InputChar = struct {
        char: u8,
        escaped: bool = false,
    };

    pub fn new(alloc: Allocator, src: []const u8) Lexer {
        return .{
            .src = src,
            .tokens = ArrayList(Token).init(alloc),
            .buf = ArrayList(u8).init(alloc),
        };
    }

    pub fn lex(self: *Lexer) !void {
        while (true) {
            const input = self.eat() orelse {
                try self.break_word(true);
                break;
            };
            const char = input.char;
            const escaped = input.escaped;

            // Handle non-escaped chars that may:
            // 1. produce operators
            // 2. switch lexing state
            // 3. break words
            if (!escaped) escaped: {
                switch (char) {
                    ';' => {
                        if (self.state == .Single or self.state == .Double) break :escaped;
                        try self.break_word(true);
                        try self.tokens.append(.Semicolon);
                        continue;
                    },
                    '$' => {
                        if (self.state == .Single) break :escaped;

                        // Handle variable
                        try self.break_word(false);
                        const var_tok = try self.eat_var();
                        try self.tokens.append(.{ .Var = var_tok });
                        self.word_start = self.j;
                        continue;
                    },
                    // Operators
                    '|' => {
                        if (self.state == .Single or self.state == .Double) break :escaped;
                        try self.break_word(true);

                        const next = self.peek() orelse @panic("Unexpected EOF");
                        if (next.escaped or next.char != '|') {
                            try self.tokens.append(.Pipe);
                        } else if (next.char == '|') {
                            _ = self.eat() orelse unreachable;
                            try self.tokens.append(.DoublePipe);
                        }
                        continue;
                    },
                    '>' => {
                        if (self.state == .Single or self.state == .Double) break :escaped;
                        try self.break_word(true);
                        try self.tokens.append(.RightArrow);
                        continue;
                    },
                    '&' => {
                        if (self.state == .Single or self.state == .Double) break :escaped;
                        try self.break_word(true);

                        const next = self.peek() orelse @panic("Unexpected EOF");
                        if (next.escaped or next.char != '&') {
                            try self.tokens.append(.Ampersand);
                        } else if (next.char == '&') {
                            _ = self.eat() orelse unreachable;
                            try self.tokens.append(.DoubleAmpersand);
                        }
                        continue;
                    },

                    // 2. State switchers
                    '\'' => {
                        if (self.state == .Single) {
                            self.state = .Normal;
                            continue;
                        }
                        if (self.state == .Normal) {
                            self.state = .Single;
                            continue;
                        }
                        continue;
                    },
                    '"' => {
                        if (self.state == .Single) break :escaped;
                        if (self.state == .Normal) {
                            try self.break_word(false);
                            self.state = .Double;
                        } else if (self.state == .Double) {
                            try self.break_word(false);
                            self.delimit_quote = true;
                            self.state = .Normal;
                        }
                        continue;
                    },

                    // 3. Word breakers
                    ' ' => {
                        if (self.state == .Normal) {
                            try self.break_word(true);
                            continue;
                        }
                        break :escaped;
                    },

                    else => break :escaped,
                }
                continue;
            }

            try self.buf.append(char);
            self.j += 1;
        }

        try self.tokens.append(.Eof);
    }

    fn break_word(self: *Lexer, add_delimiter: bool) !void {
        const start: u32 = self.word_start;
        const end: u32 = self.j;
        if (start != end) {
            try self.tokens.append(.{ .Text = .{ .start = start, .end = end } });
            if (add_delimiter) {
                try self.tokens.append(.Delimit);
            }
        } else if (self.delimit_quote) {
            try self.tokens.append(.Delimit);
            self.delimit_quote = false;
        }
        // else if (
        //     // Need to close DoubleQuote groups because they don't trigger the above condition
        //     add_delimiter and self.tokens.items.len > 0 and
        //     self.tokens.items[self.tokens.items.len - 1] == .DoubleQuoteGroupEnd
        // ) {
        //     try self.tokens.append(.Delimit);
        // }
        self.word_start = self.j;
    }

    fn eat_var(self: *Lexer) !Token.TextRange {
        const start = self.j;
        // Eat until special character
        while (self.peek()) |result| {
            const char = result.char;
            const escaped = result.escaped;
            _ = escaped;

            switch (char) {
                '{', '}', ';', '\'', '\"', ' ', '|', '&', '>', ',' => {
                    return .{ .start = start, .end = self.j };
                },
                else => {
                    _ = self.eat() orelse unreachable;
                    try self.buf.append(char);
                    self.j += 1;
                },
            }
        }
        return .{ .start = start, .end = self.j };
    }

    fn eat(self: *Lexer) ?InputChar {
        if (self.read_char()) |result| {
            self.i += 1 + @as(u32, @intFromBool(result.escaped));
            return result;
        }
        return null;
    }

    fn peek(self: *Lexer) ?InputChar {
        if (self.read_char()) |result| {
            return result;
        }

        return null;
    }

    fn read_char(self: *Lexer) ?InputChar {
        if (self.i >= self.src.len) return null;
        var char = self.src[self.i];
        if (char != '\\' or self.state == .Single) return .{ .char = char };

        // Handle backslash
        switch (self.state) {
            .Normal => {
                if (self.i + 1 >= self.src.len) return null;
                char = self.src[self.i + 1];
            },
            .Double => {
                if (self.i + 1 >= self.src.len) return null;
                const next_char = self.src[self.i + 1];
                switch (next_char) {
                    // Backslash only applies to these characters
                    '$', '`', '"', '\\', '\n' => {
                        char = next_char;
                    },
                    else => return .{ .char = char, .escaped = false },
                }
            },
            else => unreachable,
        }

        return .{ .char = char, .escaped = true };
    }

    fn debug_tokens(self: *const Lexer) void {
        std.debug.print("Tokens: \n", .{});
        for (self.tokens.items, 0..) |tok, i| {
            std.debug.print("{d}: ", .{i});
            tok.debug(self.buf.items[0..self.buf.items.len]);
        }
    }
};

fn test_lex(src: []const u8, expected: []const Test.TestToken) !Lexer {
    std.debug.print("Lexing: {s}\n", .{src});
    var lexer = Lexer.new(std.heap.c_allocator, src);
    try lexer.lex();
    lexer.debug_tokens();
    try std.testing.expectEqual(expected.len, lexer.tokens.items.len);
    for (lexer.tokens.items, expected) |tok, expected_tok| {
        const test_tok = Test.TestToken.from_real(tok, lexer.buf.items[0..lexer.buf.items.len]);
        switch (expected_tok) {
            .Var => |txt| {
                try std.testing.expectEqualStrings(txt, test_tok.Var);
                continue;
            },
            .Text => |txt| {
                try std.testing.expectEqualStrings(txt, test_tok.Text);
                continue;
            },
            else => {},
        }
        try std.testing.expectEqual(expected_tok, test_tok);
    }
    return lexer;
}

pub const Test = struct {
    pub const TestToken = union(TokenTag) {
        // |
        Pipe,
        // ||
        DoublePipe,
        // &
        Ampersand,
        // &&
        DoubleAmpersand,
        // >
        RightArrow,
        // $
        Dollar,
        // *
        Asterisk,
        // =
        Eq,
        Semicolon,

        BraceBegin,
        BraceEnd,

        Var: []const u8,
        Text: []const u8,

        Delimit,
        Eof,

        pub fn from_real(the_token: Token, buf: []const u8) TestToken {
            switch (the_token) {
                .Var => |txt| return .{ .Var = buf[txt.start..txt.end] },
                .Text => |txt| return .{ .Text = buf[txt.start..txt.end] },
                .Pipe => return .Pipe,
                .DoublePipe => return .DoublePipe,
                .Ampersand => return .Ampersand,
                .DoubleAmpersand => return .DoubleAmpersand,
                .RightArrow => return .RightArrow,
                .Dollar => return .Dollar,
                .Asterisk => return .Asterisk,
                .Eq => return .Eq,
                .Semicolon => return .Semicolon,
                .BraceBegin => return .BraceBegin,
                .BraceEnd => return .BraceEnd,
                .Delimit => return .Delimit,
                .Eof => return .Eof,
            }
        }
    };
};

test "basic" {
    const bash_src =
        \\next dev
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "next" }, .Delimit, .{ .Text = "dev" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "vars" {
    const bash_src =
        \\next dev $PORT
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "next" }, .Delimit, .{ .Text = "dev" }, .Delimit, .{ .Var = "PORT" }, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "quoted_var" {
    const bash_src =
        \\next dev "$PORT"
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "next" }, .Delimit, .{ .Text = "dev" }, .Delimit, .{ .Var = "PORT" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "quoted_edge_case" {
    const bash_src =
        \\next dev foo"$PORT"
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "next" }, .Delimit, .{ .Text = "dev" }, .Delimit, .{ .Text = "foo" }, .{ .Var = "PORT" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "quote_multi" {
    const bash_src =
        \\echo foo"$NICE"good"NICE"
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "echo" }, .Delimit, .{ .Text = "foo" }, .{ .Var = "NICE" }, .{ .Text = "good" }, .{ .Text = "NICE" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "semicolon" {
    const bash_src =
        \\echo foo; bar baz; echo "NICE;";
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "echo" }, .Delimit, .{ .Text = "foo" }, .Delimit, .Semicolon, .{ .Text = "bar" }, .Delimit, .{ .Text = "baz" }, .Delimit, .Semicolon, .{ .Text = "echo" }, .Delimit, .{ .Text = "NICE;" }, .Delimit, .Semicolon, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "single_quote" {
    const bash_src =
        \\next dev 'hello how is it going'
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "next" }, .Delimit, .{ .Text = "dev" }, .Delimit, .{ .Text = "hello how is it going" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "env_vars" {
    const bash_src =
        \\NAME=zack FULLNAME="$NAME radisic" LOL= ; echo $FULLNAME
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "NAME=zack" }, .Delimit, .{ .Text = "FULLNAME=" }, .{ .Var = "NAME" }, .{ .Text = " radisic" }, .Delimit, .{ .Text = "LOL=" }, .Delimit, .Semicolon, .{ .Text = "echo" }, .Delimit, .{ .Var = "FULLNAME" }, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}
test "env_vars2" {
    const bash_src =
        \\NAME=zack foo=$bar echo $NAME
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "NAME=zack" }, .Delimit, .{ .Text = "echo" }, .Delimit, .{ .Var = "NAME" }, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "brace_expansion" {
    const bash_src =
        // \\echo {ts,tsx,js,$foo}
        // \\echo {*.ts,*.tsx,*.js,*.jsx}
        \\echo {ts,tsx,js,jsx}
        // \\echo {ts",foo"}
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "echo" }, .Delimit, .{ .Text = "{ts,tsx,js,jsx}" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "op_and" {
    const bash_src =
        \\echo foo && echo bar
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "echo" }, .Delimit, .{ .Text = "foo" }, .Delimit, .DoubleAmpersand, .{ .Text = "echo" }, .Delimit, .{ .Text = "bar" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "op_or" {
    const bash_src =
        \\echo foo || echo bar
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "echo" }, .Delimit, .{ .Text = "foo" }, .Delimit, .DoublePipe, .{ .Text = "echo" }, .Delimit, .{ .Text = "bar" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "op_pipe" {
    const bash_src =
        \\echo foo | echo bar
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "echo" }, .Delimit, .{ .Text = "foo" }, .Delimit, .Pipe, .{ .Text = "echo" }, .Delimit, .{ .Text = "bar" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "op_bg" {
    const bash_src =
        \\echo foo & echo bar
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "echo" }, .Delimit, .{ .Text = "foo" }, .Delimit, .Ampersand, .{ .Text = "echo" }, .Delimit, .{ .Text = "bar" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}

test "op_redirect" {
    const bash_src =
        \\echo foo > cat secrets.txt
    ;
    const expected: []const Test.TestToken = &[_]Test.TestToken{ .{ .Text = "echo" }, .Delimit, .{ .Text = "foo" }, .Delimit, .RightArrow, .{ .Text = "cat" }, .Delimit, .{ .Text = "secrets.txt" }, .Delimit, .Eof };
    const lexer = try test_lex(bash_src, expected);
    _ = lexer;
}
