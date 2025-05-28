const bun = @import("bun");
const std = @import("std");
const ArrayList = std.ArrayList;
const Allocator = std.mem.Allocator;
const SmolStr = @import("../string.zig").SmolStr;

const assert = bun.assert;
const log = bun.Output.scoped(.BRACES, false);

/// Using u16 because anymore tokens than that results in an unreasonably high
/// amount of brace expansion (like around 32k variants to expand)
const ExpansionVariant = packed struct(u32) {
    start: u16 = 0,
    end: u16 = 0, // must be >= start
};

const Token = union(enum) {
    open: ExpansionVariants,
    comma,
    text: SmolStr,
    close,
    eof,
    const Tag = @typeInfo(Token).@"union".tag_type.?;

    const ExpansionVariants = struct {
        idx: u16 = 0,
        end: u16 = 0,
    };

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

pub const AST = struct {
    pub const Atom = union(enum) {
        text: SmolStr,
        expansion: Expansion,
    };

    const Group = struct {
        bubble_up: ?*Group = null,
        bubble_up_next: ?u16 = null,
        atoms: union(enum) { single: Atom, many: []Atom },
    };

    const Expansion = struct {
        variants: []AST.Group,
    };
};

const MAX_NESTED_BRACES = 10;

const StackError = error{
    StackFull,
};

/// A stack on the stack
fn StackStack(comptime T: type, comptime SizeType: type, comptime N: SizeType) type {
    return struct {
        items: [N]T = undefined,
        len: SizeType = 0,

        fn top(this: *@This()) ?T {
            if (this.len == 0) return null;
            return this.items[this.len - 1];
        }

        fn topPtr(this: *@This()) ?*T {
            if (this.len == 0) return null;
            return &this.items[this.len - 1];
        }

        fn push(this: *@This(), value: T) StackError!void {
            if (this.len == N) return StackError.StackFull;
            this.items[this.len] = value;
            this.len += 1;
        }

        fn pop(this: *@This()) ?T {
            if (this.top()) |v| {
                this.len -= 1;
                return v;
            }
            return null;
        }
    };
}

const ExpandError = StackError || ParserError;

/// `out` is preallocated by using the result from `calculateExpandedAmount`
pub fn expand(
    allocator: Allocator,
    tokens: []Token,
    out: []std.ArrayList(u8),
    contains_nested: bool,
) ExpandError!void {
    var out_key_counter: u16 = 1;
    if (!contains_nested) {
        var expansions_table = try buildExpansionTableAlloc(allocator, tokens);

        return try expandFlat(tokens, expansions_table.items[0..], out, 0, &out_key_counter, 0, 0, tokens.len);
    }

    var parser = Parser.init(tokens, allocator);
    var root_node = try parser.parse();
    try expandNested(&root_node, out, 0, &out_key_counter, 0);
}

fn expandNested(
    root: *AST.Group,
    out: []std.ArrayList(u8),
    out_key: u16,
    out_key_counter: *u16,
    start: u32,
) ExpandError!void {
    if (root.atoms == .single) {
        if (start > 0) {
            if (root.bubble_up) |bubble_up| {
                return expandNested(bubble_up, out, out_key, out_key_counter, root.bubble_up_next.?);
            }
            return;
        }

        return switch (root.atoms.single) {
            .text => |txt| try {
                try out[out_key].appendSlice(txt.slice());
                if (root.bubble_up) |bubble_up| {
                    return expandNested(bubble_up, out, out_key, out_key_counter, root.bubble_up_next.?);
                }
                return;
            },
            .expansion => |expansion| {
                const length = out[out_key].items.len;
                for (expansion.variants, 0..) |*group, j| {
                    group.bubble_up = root;
                    group.bubble_up_next = 1;
                    const new_key = if (j == 0) out_key else brk: {
                        const new_key = out_key_counter.*;
                        try out[new_key].appendSlice(out[out_key].items[0..length]);
                        out_key_counter.* += 1;
                        break :brk new_key;
                    };

                    try expandNested(group, out, new_key, out_key_counter, 0);
                }
                return;
            },
        };
    }

    if (start >= root.atoms.many.len) {
        if (root.bubble_up) |bubble_up| {
            return expandNested(bubble_up, out, out_key, out_key_counter, root.bubble_up_next.?);
        }
        return;
    }

    for (root.atoms.many[start..], start..) |atom, i_| {
        const i: u16 = @intCast(i_);
        switch (atom) {
            .text => |txt| {
                try out[out_key].appendSlice(txt.slice());
            },
            .expansion => |expansion| {
                const length = out[out_key].items.len;
                for (expansion.variants, 0..) |*group, j| {
                    group.bubble_up = root;
                    group.bubble_up_next = i + 1;
                    const new_key = if (j == 0) out_key else brk: {
                        const new_key = out_key_counter.*;
                        try out[new_key].appendSlice(out[out_key].items[0..length]);
                        out_key_counter.* += 1;
                        break :brk new_key;
                    };

                    try expandNested(group, out, new_key, out_key_counter, 0);
                }
                return;
            },
        }
    }

    // After execution we need to go up a level
    if (root.bubble_up) |bubble_up| {
        return try expandNested(bubble_up, out, out_key, out_key_counter, root.bubble_up_next.?);
    }
}

/// This function is fast but does not work for nested brace expansions
/// TODO optimization: allocate into one buffer of chars
fn expandFlat(
    tokens: []const Token,
    expansion_table: []const ExpansionVariant,
    out: []std.ArrayList(u8),
    out_key: u16,
    out_key_counter: *u16,
    depth_: u8,
    start: usize,
    end: usize,
) !void {
    log("expandFlat [{d}, {d}]", .{ start, end });
    if (start >= tokens.len or end > tokens.len) return;

    var depth = depth_;
    for (tokens[start..end], start..) |atom, j| {
        _ = j;
        switch (atom) {
            .text => |txt| {
                try out[out_key].appendSlice(txt.slice());
            },
            .close => {
                depth -= 1;
            },
            .open => |expansion_variants| {
                depth += 1;
                if (bun.Environment.allow_assert) {
                    assert(expansion_variants.end - expansion_variants.idx >= 1);
                }

                var variants = expansion_table[expansion_variants.idx..expansion_variants.end];
                const skip_over_idx = variants[variants.len - 1].end;

                const starting_len = out[out_key].items.len;
                for (variants[0..], 0..) |*variant, i| {
                    const new_key = if (i == 0) out_key else brk: {
                        const new_key = out_key_counter.*;
                        try out[new_key].appendSlice(out[out_key].items[0..starting_len]);
                        out_key_counter.* += 1;
                        break :brk new_key;
                    };
                    try expandFlat(tokens, expansion_table, out, new_key, out_key_counter, depth, variant.start, variant.end);
                    try expandFlat(tokens, expansion_table, out, new_key, out_key_counter, depth, skip_over_idx, end);
                }
                return;
            },
            else => {},
        }
    }
}

fn calculateVariantsAmount(tokens: []const Token) u32 {
    var brace_count: u32 = 0;
    var count: u32 = 0;
    for (tokens) |tok| {
        switch (tok) {
            .comma => count += 1,
            .open => brace_count += 1,
            .close => {
                if (brace_count == 1) {
                    count += 1;
                }
                brace_count -= 1;
            },
            else => {},
        }
    }
    return count;
}

const ParserError = bun.OOM || error{
    UnexpectedToken,
};

pub const Parser = struct {
    current: usize = 0,
    tokens: []const Token,
    alloc: Allocator,
    errors: std.ArrayList(Error),

    // FIXME error location
    const Error = struct { msg: []const u8 };

    pub fn init(tokens: []const Token, alloc: Allocator) Parser {
        return .{
            .tokens = tokens,
            .alloc = alloc,
            .errors = std.ArrayList(Error).init(alloc),
        };
    }

    pub fn parse(self: *Parser) !AST.Group {
        var group_alloc_ = std.heap.stackFallback(@sizeOf(AST.Atom), self.alloc);
        const group_alloc = group_alloc_.get();
        var nodes = std.ArrayList(AST.Atom).init(group_alloc);
        while (!self.match(.eof)) {
            try nodes.append(try self.parseAtom() orelse break);
        }

        if (nodes.items.len == 1) {
            return .{ .atoms = .{ .single = nodes.items[0] } };
        } else {
            return .{ .atoms = .{ .many = nodes.items[0..] } };
        }
    }

    fn parseAtom(self: *Parser) ParserError!?AST.Atom {
        switch (self.advance()) {
            .open => {
                const expansion_ptr = try self.parseExpansion();
                return .{ .expansion = expansion_ptr };
            },
            .text => |txt| return .{ .text = txt },
            .eof => return null,
            .close, .comma => return ParserError.UnexpectedToken,
        }
    }

    fn parseExpansion(self: *Parser) !AST.Expansion {
        var variants = std.ArrayList(AST.Group).init(self.alloc);
        while (!self.match_any(&.{ .close, .eof })) {
            if (self.match(.eof)) break;
            var group_alloc_ = std.heap.stackFallback(@sizeOf(AST.Atom), self.alloc);
            const group_alloc = group_alloc_.get();
            var group = std.ArrayList(AST.Atom).init(group_alloc);
            var close = false;
            while (!self.match(.eof)) {
                if (self.match(.close)) {
                    close = true;
                    break;
                }
                if (self.match(.comma)) break;
                const group_atom = try self.parseAtom() orelse break;
                try group.append(group_atom);
            }
            if (group.items.len == 1) {
                try variants.append(.{ .atoms = .{ .single = group.items[0] } });
            } else {
                try variants.append(.{ .atoms = .{ .many = group.items[0..] } });
            }
            if (close) break;
        }

        return .{ .variants = variants.items[0..] };
    }

    fn has_eq_sign(self: *Parser, str: []const u8) ?u32 {
        _ = self;
        return @import("./shell.zig").hasEqSign(str);
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

    fn expect(self: *Parser, toktag: Token.Tag) Token {
        assert(toktag == @as(Token.Tag, self.peek()));
        if (self.check(toktag)) {
            return self.advance();
        }
        unreachable;
    }

    /// Consumes token if it matches
    fn match(self: *Parser, toktag: Token.Tag) bool {
        if (@as(Token.Tag, self.peek()) == toktag) {
            _ = self.advance();
            return true;
        }
        return false;
    }

    fn match_any2(self: *Parser, comptime toktags: []const Token.Tag) ?Token {
        const peeked = self.peek();
        inline for (toktags) |tag| {
            if (peeked == tag) {
                _ = self.advance();
                return peeked;
            }
        }
        return null;
    }

    fn match_any(self: *Parser, comptime toktags: []const Token.Tag) bool {
        const peeked = @as(Token.Tag, self.peek());
        inline for (toktags) |tag| {
            if (peeked == tag) {
                _ = self.advance();
                return true;
            }
        }
        return false;
    }

    fn check(self: *Parser, toktag: Token.Tag) bool {
        return @as(Token.Tag, self.peek()) == @as(Token.Tag, toktag);
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

pub fn calculateExpandedAmount(tokens: []const Token) StackError!u32 {
    var nested_brace_stack = StackStack(u8, u8, MAX_NESTED_BRACES){};
    var variant_count: u32 = 0;
    var prev_comma: bool = false;

    for (tokens) |tok| {
        prev_comma = false;
        switch (tok) {
            .open => try nested_brace_stack.push(0),
            .comma => {
                const val = nested_brace_stack.topPtr().?;
                val.* += 1;
                prev_comma = true;
            },
            .close => {
                var variants = nested_brace_stack.pop().?;
                if (!prev_comma) {
                    variants += 1;
                }
                if (nested_brace_stack.len > 0) {
                    const top = nested_brace_stack.topPtr().?;
                    top.* += variants - 1;
                } else if (variant_count == 0) {
                    variant_count = variants;
                } else {
                    variant_count *= variants;
                }
            },
            else => {},
        }
    }

    return variant_count;
}

fn buildExpansionTableAlloc(alloc: Allocator, tokens: []Token) !std.ArrayList(ExpansionVariant) {
    var table = std.ArrayList(ExpansionVariant).init(alloc);
    try buildExpansionTable(tokens, &table);
    return table;
}

fn buildExpansionTable(tokens: []Token, table: *std.ArrayList(ExpansionVariant)) !void {
    const BraceState = struct {
        tok_idx: u16,
        variants: u16,
        prev_tok_end: u16,
    };
    var brace_stack = StackStack(BraceState, u4, MAX_NESTED_BRACES){};

    var i: u16 = 0;
    var prev_close = false;
    while (i < tokens.len) : (i += 1) {
        switch (tokens[i]) {
            .open => {
                const table_idx: u16 = @intCast(table.items.len);
                tokens[i].open.idx = table_idx;
                try brace_stack.push(.{
                    .tok_idx = i,
                    .variants = 0,
                    .prev_tok_end = i,
                });
            },
            .close => {
                var top = brace_stack.pop().?;

                try table.append(.{
                    .end = i,
                    .start = top.prev_tok_end + 1,
                });

                top.prev_tok_end = i;
                top.variants += 1;

                tokens[top.tok_idx].open.end = @intCast(table.items.len);
                prev_close = true;
            },
            .comma => {
                var top = brace_stack.topPtr().?;

                try table.append(.{
                    .end = i,
                    .start = top.prev_tok_end + 1,
                });

                prev_close = false;

                top.prev_tok_end = i;
                top.variants += 1;
            },
            else => {
                prev_close = false;
            },
        }
    }

    if (bun.Environment.allow_assert) {
        for (table.items[0..], 0..) |variant, kdjsd| {
            _ = kdjsd;
            assert(variant.start != 0 and variant.end != 0);
        }
    }
}

const Encoding = @import("./shell.zig").StringEncoding;
const NewChars = @import("./shell.zig").ShellCharIter;

pub const Lexer = NewLexer(.ascii);

fn NewLexer(comptime encoding: Encoding) type {
    const Chars = NewChars(encoding);
    return struct {
        chars: Chars,
        alloc: Allocator,
        tokens: ArrayList(Token),
        contains_nested: bool = false,

        pub const Output = struct {
            tokens: ArrayList(Token),
            contains_nested: bool,
        };

        pub fn tokenize(alloc: Allocator, src: []const u8) !Output {
            var this = @This(){
                .chars = Chars.init(src),
                .tokens = ArrayList(Token).init(alloc),
                .alloc = alloc,
            };

            const contains_nested = try this.tokenize_impl();

            return .{
                .tokens = this.tokens,
                .contains_nested = contains_nested,
            };
        }

        // FIXME: implement rollback on invalid brace
        fn tokenize_impl(self: *@This()) !bool {
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
            // var char_stack = StackStack(u8, u8, 16){};
            // _ = char_stack;

            while (true) {
                const input = self.eat() orelse break;
                const char = input.char;
                const escaped = input.escaped;

                if (!escaped) {
                    switch (char) {
                        '{' => {
                            try brace_stack.push(@intCast(self.tokens.items.len));
                            try self.tokens.append(.{ .open = .{} });
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

                // if (char_stack.push(char) == char_stack.Error.StackFull) {
                //     try self.app
                // }
                try self.appendChar(char);
            }

            // Unclosed braces
            while (brace_stack.len > 0) {
                const top_idx = brace_stack.pop().?;
                try self.rollbackBraces(top_idx);
            }

            try self.flattenTokens();
            try self.tokens.append(.eof);

            return self.contains_nested;
        }

        fn flattenTokens(self: *@This()) !void {
            var brace_count: u32 = if (self.tokens.items[0] == .open) 1 else 0;
            var i: u32 = 0;
            var j: u32 = 1;
            while (i < self.tokens.items.len and j < self.tokens.items.len) {
                var itok = &self.tokens.items[i];
                var jtok = &self.tokens.items[j];

                if (itok.* == .text and jtok.* == .text) {
                    try itok.text.appendSlice(self.alloc, jtok.toText().slice());
                    _ = self.tokens.orderedRemove(j);
                } else {
                    if (jtok.* == .close) {
                        brace_count -= 1;
                    } else if (jtok.* == .open) {
                        brace_count += 1;
                        if (brace_count > 1) {
                            self.contains_nested = true;
                        }
                    }
                    i += 1;
                    j += 1;
                }
            }
        }

        fn rollbackBraces(self: *@This(), starting_idx: u32) !void {
            if (bun.Environment.allow_assert) {
                const first = &self.tokens.items[starting_idx];
                assert(first.* == .open);
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

        fn replaceTokenWithString(self: *@This(), token_idx: u32) !void {
            var tok = &self.tokens.items[token_idx];
            const tok_text = tok.toText();
            tok.* = .{ .text = tok_text };
        }

        fn appendChar(self: *@This(), char: Chars.CodepointType) !void {
            if (self.tokens.items.len > 0) {
                var last = &self.tokens.items[self.tokens.items.len - 1];
                if (last.* == .text) {
                    if (comptime encoding == .ascii) {
                        try last.text.appendChar(self.alloc, char);
                        return;
                    }
                    var buf = [4]u8{ 0, 0, 0, 0 };
                    const slice = try Chars.encodeCodepointStack(char, &buf);
                    try last.text.appendSlice(self.alloc, slice);
                    return;
                }
            }

            if (comptime encoding == .ascii) {
                try self.tokens.append(.{
                    .text = try SmolStr.fromSlice(self.alloc, &[_]u8{char}),
                });
            } else {
                var buf = [4]u8{ 0, 0, 0, 0 };
                const slice = try Chars.encodeCodepointStack(char, &buf);
                try self.tokens.append(.{
                    .text = try SmolStr.fromSlice(self.alloc, slice),
                });
            }
        }

        fn eat(self: *@This()) ?Chars.InputChar {
            return self.chars.eat();
        }

        fn read_char(self: *@This()) ?Chars.InputChar {
            return self.chars.read_char();
        }
    };
}

const t = std.testing;
test Lexer {
    var arena = std.heap.ArenaAllocator.init(t.allocator);
    defer arena.deinit();

    const TestCase = struct { []const u8, []const Token };
    const test_cases: []const TestCase = &[_]TestCase{
        .{
            "{}",
            &[_]Token{ .{ .open = .{} }, .close, .eof },
        },
        .{
            "{foo}",
            &[_]Token{ .{ .open = .{} }, .{ .text = try SmolStr.fromSlice(arena.allocator(), "foo") }, .close, .eof },
        },
    };

    for (test_cases) |test_case| {
        const src, const expected = test_case;
        // NOTE: don't use arena here so that we can test for memory leaks
        var result = try Lexer.tokenize(t.allocator, src);
        defer result.tokens.deinit();
        try t.expectEqualSlices(
            Token,
            expected,
            result.tokens.items,
        );
    }
}
