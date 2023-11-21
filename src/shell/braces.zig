const bun = @import("root").bun;
const ArrayList = std.ArrayList;
const std = @import("std");
const builtin = @import("builtin");
const Arena = std.heap.ArenaAllocator;
const Allocator = std.mem.Allocator;
const SmolStr = @import("../string_types.zig").SmolStr;

pub const AST = struct {
    pub const Node = struct {
        text: []SmolStr,
        expansion: *Expansion,
    };

    const Expansion = struct {
        variants: []AST.Node,
    };
};

const TokenTag = enum { open, comma, text, close, eof };

const Token = union(TokenTag) {
    open,
    comma,
    text: SmolStr,
    close,
    eof,

    pub fn toText(self: *Token) SmolStr {
        return switch (self.*) {
            .open => SmolStr.fromChar('{'),
            .comma => SmolStr.fromChar(','),
            .text => |txt| txt,
            .close => SmolStr.fromChar('}'),
            .eof => SmolStr.empty(),
        };
    }
};

pub const DebugToken = union(TokenTag) {
    open,
    comma,
    text: []const u8,
    close,
    eof,

    pub fn fromNormal(allocator: Allocator, token: *const Token) !DebugToken {
        return switch (token.*) {
            .open => .open,
            .comma => .comma,
            .text => |txt| {
                const slice = txt.slice();
                return .{ .text = try allocator.dupe(u8, slice) };
            },
            .close => .close,
            .eof => .eof,
        };
    }
};

const InputChar = struct {
    char: u8,
    escaped: bool = false,
};

const State = enum {
    Normal,
    Single,
    Double,
};

const MAX_NESTED_BRACES = 10;

/// A stack on the stack
pub fn StackStack(comptime T: type, comptime SizeType: type, comptime N: SizeType) type {
    return struct {
        items: [N]T = undefined,
        len: SizeType = 0,

        pub const Error = error{
            StackEmpty,
            StackFull,
        };

        pub fn top(this: *@This()) ?T {
            if (this.len == 0) return null;
            return this.items[this.len - 1];
        }

        pub fn topPtr(this: *@This()) ?*T {
            if (this.len == 0) return null;
            return &this.items[this.len - 1];
        }

        pub fn push(this: *@This(), value: T) Error!void {
            if (this.len == N) return Error.StackFull;
            this.items[this.len] = value;
            this.len += 1;
        }

        pub fn pop(this: *@This()) ?T {
            if (this.top()) |v| {
                this.len -= 1;
                return v;
            }
            return null;
        }
    };
}

pub const Parser = struct {
    current: usize = 0,
    tokens: []Token,
    alloc: Allocator,
    errors: std.ArrayList(Error),

    // FIXME error location
    const Error = struct { msg: []const u8 };

    pub fn init(tokens: std.ArrayList(Token), alloc: Allocator) Parser {
        return .{
            .tokens = tokens,
            .alloc = alloc,
        };
    }

    pub fn parse(self: *Parser) !std.ArrayList(AST.Node) {
        var nodes = std.ArrayList(AST.Node).init(self.alloc);
        _ = nodes;
        while (!self.match(.eof)) {}
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
        return self.peek() == .eof;
    }

    fn expect(self: *Parser, toktag: TokenTag) Token {
        std.debug.assert(toktag == @as(TokenTag, self.peek()));
        if (self.check(toktag)) {
            return self.advance();
        }
        unreachable;
    }

    /// Consumes token if it matches
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

    fn add_error(self: *Parser, comptime fmt: []const u8, args: anytype) !void {
        const error_msg = try std.fmt.allocPrint(self.alloc, fmt, args);
        try self.errors.append(.{ .msg = error_msg });
    }
};

pub const Lexer = struct {
    src: []const u8,
    alloc: Allocator,
    tokens: ArrayList(Token),
    i: usize = 0,
    state: State = .Normal,

    pub fn tokenize(alloc: Allocator, src: []const u8) !Lexer {
        var this = Lexer{
            .src = src,
            .tokens = ArrayList(Token).init(alloc),
            .alloc = alloc,
        };

        try this.tokenize_impl();
        return this;
    }

    fn tokenize_impl(self: *Lexer) !void {
        // Unclosed brace expansion algorithm
        // {hi,hey
        // *xx*xxx

        // {hi, hey
        // *xxx$

        // {hi,{a,b} sdkjfs}
        // *xx**x*x*$

        // 00000100000000000010000000000000
        // echo {foo,bar,baz,{hi,hey},oh,no
        // xxxxx*xxx*xxx*xxx**xx*xxx**xx*xx
        //
        // {hi,h{ey }
        // *xx*x*xx$
        //
        // - Replace chars with special tokens
        // - If unclosed or encounter bad token:
        //   - Start at beginning of brace, replacing special tokens back with
        //     chars, skipping over actual closed braces
        var brace_stack = StackStack(u32, u8, MAX_NESTED_BRACES){};

        while (true) {
            const input = self.eat() orelse break;
            const char = input.char;
            const escaped = input.escaped;

            if (!escaped) {
                switch (char) {
                    '{' => {
                        try brace_stack.push(@intCast(self.tokens.items.len));
                        try self.tokens.append(.open);
                        continue;
                    },
                    '}' => {
                        if (brace_stack.len > 0) {
                            _ = brace_stack.pop();
                            try self.tokens.append(.close);
                            continue;
                        }
                    },
                    ',' => {
                        if (brace_stack.len > 0) {
                            try self.tokens.append(.comma);
                            continue;
                        }
                    },
                    else => {},
                }
            }

            try self.appendChar(char);
        }

        // Unclosed braces
        while (brace_stack.len > 0) {
            const top_idx = brace_stack.pop().?;
            try self.rollbackBraces(top_idx);
        }

        try self.flattenTokens();
        try self.tokens.append(.eof);
    }

    fn flattenTokens(self: *Lexer) !void {
        var i: u32 = 0;
        var j: u32 = 1;
        while (i < self.tokens.items.len and j < self.tokens.items.len) {
            var itok = &self.tokens.items[i];
            var jtok = &self.tokens.items[j];

            if (itok.* == .text and jtok.* == .text) {
                try itok.text.appendSlice(self.alloc, jtok.toText().slice());
                _ = self.tokens.orderedRemove(j);
            } else {
                i += 1;
                j += 1;
            }
        }
    }

    fn rollbackBraces(self: *Lexer, starting_idx: u32) !void {
        if (bun.Environment.allow_assert) {
            var first = &self.tokens.items[starting_idx];
            std.debug.assert(first.* == .open);
        }

        var braces: u8 = 0;

        try self.replaceTokenWithString(starting_idx);
        var i: u32 = starting_idx + 1;
        while (i < self.tokens.items.len) : (i += 1) {
            if (braces > 0) {
                switch (self.tokens.items[i]) {
                    .open => {
                        braces += 1;
                    },
                    .close => {
                        braces -= 1;
                    },
                    else => {},
                }
                continue;
            }

            switch (self.tokens.items[i]) {
                .open => {
                    braces += 1;
                    continue;
                },
                .close, .comma, .text => {
                    try self.replaceTokenWithString(i);
                },
                .eof => {},
            }
        }
    }

    fn replaceTokenWithString(self: *Lexer, token_idx: u32) !void {
        var tok = &self.tokens.items[token_idx];
        var tok_text = tok.toText();
        tok.* = .{ .text = tok_text };
    }

    fn appendChar(self: *Lexer, char: u8) !void {
        if (self.tokens.items.len > 0) {
            var last = &self.tokens.items[self.tokens.items.len - 1];
            if (last.* == .text) {
                try last.text.appendChar(self.alloc, char);
                return;
            }
        }

        try self.tokens.append(.{
            .text = try SmolStr.fromSlice(self.alloc, &[_]u8{char}),
        });
    }

    fn eat(self: *Lexer) ?InputChar {
        if (self.read_char()) |result| {
            self.i += 1 + @as(u32, @intFromBool(result.escaped));
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
};
