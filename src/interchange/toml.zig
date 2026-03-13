const HashMapPool = struct {
    const HashMap = std.HashMap(u64, void, IdentityContext, 80);
    const LinkedList = bun.deprecated.SinglyLinkedList(HashMap);
    threadlocal var list: LinkedList = undefined;
    threadlocal var loaded: bool = false;

    pub fn get(_: std.mem.Allocator) *LinkedList.Node {
        if (loaded) {
            if (list.popFirst()) |node| {
                node.data.clearRetainingCapacity();
                return node;
            }
        }

        const new_node = default_allocator.create(LinkedList.Node) catch unreachable;
        new_node.* = LinkedList.Node{ .data = HashMap.initContext(default_allocator, IdentityContext{}) };
        return new_node;
    }

    pub fn release(node: *LinkedList.Node) void {
        if (loaded) {
            list.prepend(node);
            return;
        }

        list = LinkedList{ .first = node };
        loaded = true;
    }
};

pub const TOML = struct {
    lexer: Lexer,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    stack_check: bun.StackCheck,

    pub fn init(allocator: std.mem.Allocator, source_: logger.Source, log: *logger.Log, redact_logs: bool) !TOML {
        return TOML{
            .lexer = try Lexer.init(log, source_, allocator, redact_logs),
            .allocator = allocator,
            .log = log,
            .stack_check = bun.StackCheck.init(),
        };
    }

    pub inline fn source(p: *const TOML) *const logger.Source {
        return &p.lexer.source;
    }

    pub fn e(_: *TOML, t: anytype, loc: logger.Loc) Expr {
        const Type = @TypeOf(t);
        if (@typeInfo(Type) == .pointer) {
            return Expr.init(std.meta.Child(Type), t.*, loc);
        } else {
            return Expr.init(Type, t, loc);
        }
    }

    const Rope = js_ast.E.Object.Rope;

    pub fn parseKeySegment(p: *TOML) anyerror!?Expr {
        const loc = p.lexer.loc();

        switch (p.lexer.token) {
            .t_string_literal => {
                const str = p.lexer.toString(loc);
                try p.lexer.next();
                return str;
            },
            .t_identifier => {
                const str = E.String{ .data = p.lexer.identifier };
                try p.lexer.next();
                return p.e(str, loc);
            },
            .t_false => {
                try p.lexer.next();
                return p.e(
                    E.String{
                        .data = "false",
                    },
                    loc,
                );
            },
            .t_true => {
                try p.lexer.next();
                return p.e(
                    E.String{
                        .data = "true",
                    },
                    loc,
                );
            },
            // what we see as a number here could actually be a string
            .t_numeric_literal => {
                const literal = p.lexer.raw();
                try p.lexer.next();
                return p.e(E.String{ .data = literal }, loc);
            },

            else => return null,
        }
    }

    pub fn parseKey(p: *TOML, allocator: std.mem.Allocator) anyerror!*Rope {
        var rope = try allocator.create(Rope);
        const head = rope;
        rope.* = .{
            .head = (try p.parseKeySegment()) orelse {
                try p.lexer.expectedString("key");
                return error.SyntaxError;
            },
            .next = null,
        };
        while (p.lexer.token == .t_dot) {
            try p.lexer.next();

            rope = try rope.append((try p.parseKeySegment()) orelse break, allocator);
        }

        return head;
    }

    pub fn parse(source_: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator, redact_logs: bool) !Expr {
        switch (source_.contents.len) {
            // This is to be consisntent with how disabled JS files are handled
            0 => {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = Expr.init(E.Object, E.Object{}, logger.Loc.Empty).data };
            },
            else => {},
        }

        var parser = try TOML.init(allocator, source_.*, log, redact_logs);

        return try parser.runParser();
    }

    fn runParser(p: *TOML) anyerror!Expr {
        var root = p.e(E.Object{}, p.lexer.loc());
        var head = root.data.e_object;

        var stack = std.heap.stackFallback(@sizeOf(Rope) * 6, p.allocator);
        const key_allocator = stack.get();

        while (true) {
            const loc = p.lexer.loc();
            switch (p.lexer.token) {
                .t_end_of_file => {
                    return root;
                },
                // child table
                .t_open_bracket => {
                    try p.lexer.next();
                    const key = try p.parseKey(key_allocator);

                    try p.lexer.expect(.t_close_bracket);
                    if (!p.lexer.has_newline_before) {
                        try p.lexer.expectedString("line break");
                    }

                    const parent_object = root.data.e_object.getOrPutObject(key, p.allocator) catch |err| {
                        switch (err) {
                            error.Clobber => {
                                try p.lexer.addDefaultError("Table already defined");
                                return error.SyntaxError;
                            },
                            else => return err,
                        }
                    };
                    head = parent_object.data.e_object;
                    stack.fixed_buffer_allocator.reset();
                },
                // child table array
                .t_open_bracket_double => {
                    try p.lexer.next();

                    const key = try p.parseKey(key_allocator);

                    try p.lexer.expect(.t_close_bracket_double);
                    if (!p.lexer.has_newline_before) {
                        try p.lexer.expectedString("line break");
                    }

                    var array = root.data.e_object.getOrPutArray(key, p.allocator) catch |err| {
                        switch (err) {
                            error.Clobber => {
                                try p.lexer.addDefaultError("Cannot overwrite table array");
                                return error.SyntaxError;
                            },
                            else => return err,
                        }
                    };
                    const new_head = p.e(E.Object{}, loc);
                    try array.data.e_array.push(p.allocator, new_head);
                    head = new_head.data.e_object;
                    stack.fixed_buffer_allocator.reset();
                },
                else => {
                    try p.parseAssignment(head, key_allocator);
                    stack.fixed_buffer_allocator.reset();
                },
            }
        }
    }

    pub fn parseAssignment(p: *TOML, obj: *E.Object, allocator: std.mem.Allocator) anyerror!void {
        p.lexer.allow_double_bracket = false;
        const rope = try p.parseKey(allocator);
        const rope_end = p.lexer.start;

        const is_array = p.lexer.token == .t_empty_array;
        if (is_array) {
            try p.lexer.next();
        }

        try p.lexer.expectAssignment();
        if (!is_array) {
            obj.setRope(rope, p.allocator, try p.parseValue()) catch |err| {
                switch (err) {
                    error.Clobber => {
                        const loc = rope.head.loc;
                        assert(loc.start > 0);
                        const start: u32 = @intCast(loc.start);
                        const key_name = std.mem.trimRight(u8, p.source().contents[start..rope_end], &std.ascii.whitespace);
                        p.lexer.addError(start, "Cannot redefine key '{s}'", .{key_name});
                        return error.SyntaxError;
                    },
                    else => return err,
                }
            };
        }
        p.lexer.allow_double_bracket = true;
    }

    pub fn parseValue(p: *TOML) anyerror!Expr {
        if (!p.stack_check.isSafeToRecurse()) {
            try bun.throwStackOverflow();
        }

        const loc = p.lexer.loc();

        p.lexer.allow_double_bracket = true;

        switch (p.lexer.token) {
            .t_false => {
                try p.lexer.next();

                return p.e(E.Boolean{
                    .value = false,
                }, loc);
            },
            .t_true => {
                try p.lexer.next();
                return p.e(E.Boolean{
                    .value = true,
                }, loc);
            },
            .t_string_literal => {
                const result = p.lexer.toString(loc);
                try p.lexer.next();
                return result;
            },
            .t_identifier => {
                const str: E.String = E.String{ .data = p.lexer.identifier };

                try p.lexer.next();
                return p.e(str, loc);
            },
            .t_numeric_literal => {
                const value = p.lexer.number;
                try p.lexer.next();
                return p.e(E.Number{ .value = value }, loc);
            },
            .t_minus => {
                try p.lexer.next();
                const value = p.lexer.number;

                try p.lexer.expect(.t_numeric_literal);
                return p.e(E.Number{ .value = -value }, loc);
            },
            .t_plus => {
                try p.lexer.next();
                const value = p.lexer.number;

                try p.lexer.expect(.t_numeric_literal);
                return p.e(E.Number{ .value = value }, loc);
            },
            .t_open_brace => {
                try p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                var stack = std.heap.stackFallback(@sizeOf(Rope) * 6, p.allocator);
                const key_allocator = stack.get();
                const expr = p.e(E.Object{}, loc);
                const obj = expr.data.e_object;

                while (p.lexer.token != .t_close_brace) {
                    if (obj.properties.len > 0) {
                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }
                        if (!try p.parseMaybeTrailingComma(.t_close_brace)) {
                            break;
                        }
                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }
                    }
                    try p.parseAssignment(obj, key_allocator);
                    p.lexer.allow_double_bracket = false;
                    stack.fixed_buffer_allocator.reset();
                }

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
                p.lexer.allow_double_bracket = true;
                try p.lexer.expect(.t_close_brace);
                return expr;
            },
            .t_empty_array => {
                try p.lexer.next();
                p.lexer.allow_double_bracket = true;
                return p.e(E.Array{}, loc);
            },
            .t_open_bracket => {
                try p.lexer.next();
                var is_single_line = !p.lexer.has_newline_before;
                const array_ = p.e(E.Array{}, loc);
                var array = array_.data.e_array;
                const allocator = p.allocator;
                p.lexer.allow_double_bracket = false;

                while (p.lexer.token != .t_close_bracket) {
                    if (array.items.len > 0) {
                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }

                        if (!try p.parseMaybeTrailingComma(.t_close_bracket)) {
                            break;
                        }

                        if (p.lexer.has_newline_before) {
                            is_single_line = false;
                        }
                    }

                    array.push(allocator, try p.parseValue()) catch unreachable;
                }

                if (p.lexer.has_newline_before) {
                    is_single_line = false;
                }
                p.lexer.allow_double_bracket = true;
                try p.lexer.expect(.t_close_bracket);
                return array_;
            },
            else => {
                try p.lexer.unexpected();
                return error.SyntaxError;
            },
        }
    }

    pub fn parseMaybeTrailingComma(p: *TOML, closer: T) !bool {
        try p.lexer.expect(.t_comma);

        if (p.lexer.token == closer) {
            return false;
        }

        return true;
    }
};

pub const lexer = @import("./toml/lexer.zig");
pub const Lexer = lexer.Lexer;
const T = lexer.T;

const string = []const u8;

const std = @import("std");
const IdentityContext = @import("../identity_context.zig").IdentityContext;
const expect = std.testing.expect;

const bun = @import("bun");
const assert = bun.assert;
const default_allocator = bun.default_allocator;
const logger = bun.logger;

const js_ast = bun.ast;
const E = js_ast.E;
const Expr = js_ast.Expr;
