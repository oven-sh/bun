const bun = @import("root").bun;
const ArrayList = std.ArrayList;
const std = @import("std");
const builtin = @import("builtin");
const Arena = std.heap.ArenaAllocator;
const Allocator = std.mem.Allocator;
const SmolStr = @import("../string_types.zig").SmolStr;

/// Using u16 because anymore tokens than that results in an unreasonably high
/// amount of brace expansion (like around 32k variants to expand)
pub const ExpansionVariant = packed struct {
    start: u16 = 0,
    end: u16 = 0,
    depth: u8 = 0,
};

const TokenTag = enum { open, comma, text, close, eof };
const Token = union(TokenTag) {
    open: ExpansionVariants,
    comma,
    text: SmolStr,
    close,
    eof,

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

// pub const DebugToken = union(TokenTag) {
//     open,
//     comma,
//     text: []const u8,
//     close,
//     eof,

//     pub fn fromNormal(allocator: Allocator, token: *const Token) !DebugToken {
//         return switch (token.*) {
//             .open => .open,
//             .comma => .comma,
//             .text => |txt| {
//                 const slice = txt.slice();
//                 return .{ .text = try allocator.dupe(u8, slice) };
//             },
//             .close => .close,
//             .eof => .eof,
//         };
//     }
// };

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

/// This may have false positives but it is fast
pub fn fastDetect(src: []const u8) bool {
    const Quote = enum { single, double };
    _ = Quote;

    var has_open = false;
    var has_close = false;
    if (src.len < 16) {
        for (src) |char| {
            switch (char) {
                '{' => {
                    has_open = true;
                },
                '}' => {
                    has_close = true;
                },
            }
            if (has_close and has_close) return true;
        }
        return false;
    }

    const needles = comptime [2]@Vector(16, u8){
        @splat('{'),
        @splat('}'),
        @splat('"'),
    };

    var i: usize = 0;
    while (i + 16 <= src.len) {
        const haystack = src[i .. i + 16].*;
        if (std.simd.firstTrue(needles[0] == haystack)) {
            has_open = true;
        }
        if (std.simd.firstTrue(needles[1] == haystack)) {
            has_close = true;
        }
        if (has_open and has_close) return true;
    }

    if (i < src.len) {
        for (src) |char| {
            switch (char) {
                '{' => {
                    has_open = true;
                },
                '}' => {
                    has_close = true;
                },
            }
            if (has_close and has_close) return true;
        }
        return false;
    }
    return false;
}

/// `out` is preallocated by using the result from `calculateExpandedAmount`
pub fn expand(
    tokens: []const Token,
    expansion_table: []const ExpansionVariant,
    out: []std.ArrayList(u8),
) !void {
    var out_key_counter: u16 = 1;
    return try expandImpl(tokens, expansion_table, out, 0, &out_key_counter, 0, 0, tokens.len);
}

/// TODO optimization: allocate into one buffer of chars
fn expandImpl(
    tokens: []const Token,
    expansion_table: []const ExpansionVariant,
    out: []std.ArrayList(u8),
    out_key: u16,
    out_key_counter: *u16,
    depth_: u8,
    start: usize,
    end: usize,
) !void {
    if (start >= tokens.len or end > tokens.len) return;

    var depth = depth_;
    for (tokens[start..end]) |atom| {
        switch (atom) {
            .text => |txt| {
                try out[out_key].appendSlice(txt.slice());
            },
            .open => |expansion_variants| {
                depth += 1;
                if (bun.Environment.allow_assert) {
                    std.debug.assert(expansion_variants.end - expansion_variants.idx >= 1);
                }

                var variants = expansion_table[expansion_variants.idx..expansion_variants.end];
                const skip_over_idx = variants[variants.len - 1].end;

                const starting_len = out[out_key].items.len;
                for (variants[0..], 0..) |*variant, i| {
                    if (variant.depth != depth) continue;
                    const new_key = if (i == 0) out_key else brk: {
                        const new_key = out_key_counter.*;
                        try out[new_key].appendSlice(out[out_key].items[0..starting_len]);
                        out_key_counter.* += 1;
                        break :brk new_key;
                    };
                    try expandImpl(tokens, expansion_table, out, new_key, out_key_counter, depth, variant.start, variant.end);
                    try expandImpl(tokens, expansion_table, out, new_key, out_key_counter, depth - 1, skip_over_idx, end);
                }
                return;
            },
            else => {},
        }
    }
}

pub fn calculateVariantsAmount(tokens: []const Token) u32 {
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

pub fn calculateExpandedAmount(tokens: []const Token) !u32 {
    var nested_brace_stack = StackStack(u8, u8, MAX_NESTED_BRACES){};
    var variant_count: u32 = 0;
    var i: usize = 0;

    var prev_comma: bool = false;
    while (i < tokens.len) : (i += 1) {
        prev_comma = false;
        switch (tokens[i]) {
            .open => {
                try nested_brace_stack.push(0);
            },
            .comma => {
                var val = nested_brace_stack.topPtr().?;
                val.* += 1;
                prev_comma = true;
            },
            .close => {
                var variants = nested_brace_stack.pop().?;
                if (!prev_comma) {
                    variants += 1;
                }
                if (nested_brace_stack.len > 0) {
                    var top = nested_brace_stack.topPtr().?;
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

pub fn buildExpansionTableAlloc(alloc: Allocator, tokens: []Token, variants_count: usize) !std.ArrayList(ExpansionVariant) {
    var table = try std.ArrayList(ExpansionVariant).initCapacity(alloc, variants_count);
    try buildExpansionTable(tokens, &table);
    return table;
}

pub fn buildExpansionTable(
    tokens: []Token,
    table: *std.ArrayList(ExpansionVariant),
) !void {
    const BraceState = struct {
        tok_idx: u16,
        variants: u16,
        prev_tok_end: u16,
        prev_nested: bool = false,
    };
    var brace_stack = StackStack(BraceState, u8, MAX_NESTED_BRACES){};

    var i: u16 = 0;
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
                const depth = brace_stack.len;
                var top = brace_stack.pop().?;

                try table.append(.{
                    .end = i,
                    .start = top.prev_tok_end + 1,
                    .depth = depth,
                });

                top.prev_tok_end = i;
                top.variants += 1;

                tokens[top.tok_idx].open.end = @intCast(table.items.len);
            },
            .comma => {
                var top = brace_stack.topPtr().?;

                try table.append(.{
                    .end = i,
                    .start = top.prev_tok_end + 1,
                    .depth = brace_stack.len,
                });

                top.prev_tok_end = i;
                top.variants += 1;
            },
            else => {},
        }
    }

    if (bun.Environment.allow_assert) {
        for (table.items[0..], 0..) |variant, kdjsd| {
            std.debug.print("I: {d} VARIANT: {any}\n", .{ kdjsd, variant });
            std.debug.assert(variant.start != 0 and variant.end != 0);
        }
    }
}

pub const Lexer = struct {
    src: []const u8,
    alloc: Allocator,
    tokens: ArrayList(Token),
    i: usize = 0,
    state: State = .Normal,

    // pub fn tokenize_from_shell(alloc: Allocator, )

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
