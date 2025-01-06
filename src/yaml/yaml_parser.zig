const std = @import("std");
const logger = bun.logger;
const js_lexer = bun.js_lexer;
const js_ast = bun.JSAst;
const bun = @import("root").bun;
const string = bun.string;
const Output = bun.Output;
const Global = bun.Global;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const stringZ = bun.stringZ;
const default_allocator = bun.default_allocator;
const C = bun.C;
const expect = std.testing.expect;

const BindingNodeIndex = js_ast.BindingNodeIndex;

const StmtNodeIndex = js_ast.StmtNodeIndex;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const StmtNodeList = js_ast.StmtNodeList;
const BindingNodeList = js_ast.BindingNodeList;
const assert = bun.assert;

const LocRef = js_ast.LocRef;
const S = js_ast.S;
const B = js_ast.B;
const G = js_ast.G;
const T = js_lexer.T;
const E = js_ast.E;
const Stmt = js_ast.Stmt;
pub const Expr = js_ast.Expr;
const Binding = js_ast.Binding;
const Symbol = js_ast.Symbol;
const Level = js_ast.Op.Level;
const Op = js_ast.Op;
const Scope = js_ast.Scope;
const locModuleScope = logger.Loc.Empty;

const Lexer = @import("./yaml_lexer.zig").Lexer;
pub const YAML = struct {
    lexer: Lexer,
    log: *logger.Log,
    allocator: std.mem.Allocator,

    pub fn init(allocator: std.mem.Allocator, source_: logger.Source, log: *logger.Log, redact_logs: bool) !YAML {
        return YAML{
            .lexer = try Lexer.init(log, source_, allocator, redact_logs),
            .allocator = allocator,
            .log = log,
        };
    }

    pub inline fn source(p: *const YAML) *const logger.Source {
        return &p.lexer.source;
    }

    pub fn e(_: *YAML, t: anytype, loc: logger.Loc) Expr {
        const Type = @TypeOf(t);
        if (@typeInfo(Type) == .Pointer) {
            return Expr.init(std.meta.Child(Type), t.*, loc);
        } else {
            return Expr.init(Type, t, loc);
        }
    }

    const Rope = js_ast.E.Object.Rope;

    pub fn parseKeySegment(p: *YAML) anyerror!?Expr {
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
            .t_numeric_literal => {
                const literal = p.lexer.raw();
                try p.lexer.next();
                return p.e(E.String{ .data = literal }, loc);
            },
            else => return null,
        }
    }

    pub fn parseKey(p: *YAML, allocator: std.mem.Allocator) anyerror!*Rope {
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
            // This is to be consistent with how disabled JS files are handled
            0 => {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = Expr.init(E.Object, E.Object{}, logger.Loc.Empty).data };
            },
            else => {},
        }

        var parser = try YAML.init(allocator, source_.*, log, redact_logs);
        return try parser.runParser();
    }

    fn runParser(p: *YAML) anyerror!Expr {
        var current_sequence: ?*E.Array = null;
        var is_top_level_sequence = true;
        var root_expr: ?Expr = null;

        var stack = std.heap.stackFallback(@sizeOf(Rope) * 6, p.allocator);
        const key_allocator = stack.get();

        while (true) {
            switch (p.lexer.token) {
                .t_end_of_file => {
                    return root_expr orelse p.e(E.Object{}, p.lexer.loc());
                },
                .t_document_start => {
                    try p.lexer.next();
                    continue;
                },
                .t_document_end => {
                    try p.lexer.next();
                    continue;
                },
                .t_dash => {
                    // Start of sequence item
                    try p.lexer.next();

                    // Create a new sequence if we're not already in one
                    if (current_sequence == null) {
                        const array_expr = p.e(E.Array{}, p.lexer.loc());
                        current_sequence = array_expr.data.e_array;

                        if (is_top_level_sequence) {
                            // This is a top-level sequence, make it the root
                            root_expr = array_expr;
                            is_top_level_sequence = false;
                        } else {
                            // If we're in a mapping context, we need a key for this sequence
                            if (root_expr == null) {
                                root_expr = p.e(E.Object{}, p.lexer.loc());
                            }
                            const head = root_expr.?.data.e_object;

                            const key = try p.parseKey(key_allocator);
                            try p.lexer.expect(.t_colon);
                            head.setRope(key, p.allocator, array_expr) catch |err| {
                                switch (err) {
                                    error.Clobber => {
                                        try p.lexer.addDefaultError("Cannot redefine key");
                                        return error.SyntaxError;
                                    },
                                    else => return err,
                                }
                            };
                        }
                    }

                    // Parse the sequence item
                    const item = try p.parseValue();
                    try current_sequence.?.push(p.allocator, item);

                    // Handle indentation and newlines
                    while (p.lexer.token == .t_newline) {
                        try p.lexer.next();
                        if (p.lexer.token != .t_dash) {
                            current_sequence = null; // End of sequence
                            break;
                        }
                        try p.lexer.next();
                    }
                },
                .t_indent => {
                    try p.lexer.next();
                    continue;
                },
                .t_dedent => {
                    try p.lexer.next();
                    current_sequence = null; // End of sequence on dedent
                    continue;
                },
                .t_identifier, .t_string_literal => {
                    // As soon as we see a key-value pair, we're no longer in a top-level sequence context
                    is_top_level_sequence = false;

                    // Create root object if needed
                    if (root_expr == null) {
                        root_expr = p.e(E.Object{}, p.lexer.loc());
                    }
                    const head = root_expr.?.data.e_object;

                    // Key-value pair
                    const key = try p.parseKey(key_allocator);
                    try p.lexer.expect(.t_colon);
                    const value = try p.parseValue();
                    head.setRope(key, p.allocator, value) catch |err| {
                        switch (err) {
                            error.Clobber => {
                                try p.lexer.addDefaultError("Cannot redefine key");
                                return error.SyntaxError;
                            },
                            else => return err,
                        }
                    };
                },
                else => {
                    try p.lexer.unexpected();
                    return error.SyntaxError;
                },
            }
        }
    }

    pub fn parseValue(p: *YAML) anyerror!Expr {
        const loc = p.lexer.loc();

        // Handle tags - type annotations like !!str, !!int, etc.
        // Example: !!int "123" -> converts to number 123
        if (p.lexer.token == .t_tag) {
            try p.lexer.next();
            p.lexer.current_tag = p.lexer.raw();
            try p.lexer.next();
        }

        // Handle anchors - define reusable nodes
        // Example: &anchor_name value
        if (p.lexer.token == .t_anchor) {
            try p.lexer.next();
            p.lexer.current_anchor = p.lexer.raw();
            try p.lexer.next();
        }

        var value = switch (p.lexer.token) {
            // Handle aliases - reference previously anchored nodes
            // Example: *anchor_name
            .t_alias => brk: {
                try p.lexer.next();
                const alias_name = p.lexer.raw();
                try p.lexer.next();
                break :brk p.lexer.anchors.get(alias_name) orelse {
                    try p.lexer.addDefaultError("Undefined alias");
                    return error.SyntaxError;
                };
            },

            // Handle scalar values
            .t_false => brk: {
                try p.lexer.next();
                break :brk p.e(E.Boolean{ .value = false }, loc);
            },
            .t_true => brk: {
                try p.lexer.next();
                break :brk p.e(E.Boolean{ .value = true }, loc);
            },
            .t_null => brk: {
                try p.lexer.next();
                break :brk p.e(E.Null{}, loc);
            },
            // Handle quoted strings: "quoted" or 'quoted'
            .t_string_literal => brk: {
                const result = p.lexer.toString(loc);
                try p.lexer.next();
                break :brk result;
            },
            // Handle unquoted scalars: plain_text
            .t_identifier => brk: {
                const str = E.String{ .data = p.lexer.identifier };
                try p.lexer.next();
                break :brk p.e(str, loc);
            },
            // Handle numbers: 123, 3.14, -17
            .t_numeric_literal => brk: {
                const value = p.lexer.number;
                try p.lexer.next();
                break :brk p.e(E.Number{ .value = value }, loc);
            },

            // Handle block sequences (indentation-based)
            // Example:
            // - item1
            // - item2
            .t_dash => brk: {
                try p.lexer.next();
                var items = std.ArrayList(Expr).init(p.allocator);
                errdefer items.deinit();
                while (true) {
                    if (p.lexer.token != .t_dash) break;
                    try p.lexer.next();
                    try items.append(try p.parseValue());
                    if (p.lexer.token != .t_newline) break;
                    try p.lexer.next();
                }

                break :brk p.e(E.Array{
                    .items = ExprNodeList.fromList(items),
                    .is_single_line = false,
                }, loc);
            },

            // Handle flow sequences (bracket-based)
            // Example: [item1, item2, item3]
            .t_open_bracket => brk: {
                try p.lexer.next();
                var items = std.ArrayList(Expr).init(p.allocator);
                errdefer items.deinit();

                while (p.lexer.token != .t_close_bracket) {
                    if (items.items.len > 0) {
                        if (p.lexer.token != .t_comma) break;
                        try p.lexer.next();
                    }
                    try items.append(try p.parseValue());
                }

                try p.lexer.expect(.t_close_bracket);
                break :brk p.e(E.Array{
                    .items = ExprNodeList.fromList(items),
                    .is_single_line = true,
                }, loc);
            },

            // Handle flow mappings (brace-based)
            // Example: {key1: value1, key2: value2}
            .t_open_brace => brk: {
                try p.lexer.next();

                const expr = p.e(E.Object{}, loc);
                const obj = expr.data.e_object;
                while (p.lexer.token != .t_close_brace) {
                    if (obj.properties.len > 0) {
                        if (p.lexer.token != .t_comma) break;
                        try p.lexer.next();
                    }

                    const key = try p.parseKey(p.allocator);
                    const key_loc = p.lexer.loc();
                    try p.lexer.expect(.t_colon);
                    const value = try p.parseValue();

                    obj.setRope(key, p.allocator, value) catch |err| {
                        switch (err) {
                            error.Clobber => {
                                // TODO: add key name.
                                p.lexer.addError(key_loc.toUsize(), "Cannot redefine key", .{});
                                return error.SyntaxError;
                            },
                            else => return err,
                        }
                    };
                }

                try p.lexer.expect(.t_close_brace);
                break :brk expr;
            },
            else => {
                try p.lexer.unexpected();
                return error.SyntaxError;
            },
        };

        // Process anchors - store the value for later reference
        // Example: &anchor value  -> stores value under name "anchor"
        if (p.lexer.current_anchor) |anchor_name| {
            p.lexer.current_anchor = null;
            try p.lexer.anchors.put(anchor_name, value);
        }

        // Process tags - convert values based on type tags
        // Examples:
        // !!str "123" -> string "123"
        // !!int "123" -> number 123
        // !!bool "true" -> boolean true
        // !!null "" -> null
        if (p.lexer.current_tag) |tag| {
            if (strings.eqlComptime(tag, "!!str")) {
                // Already a string, no conversion needed
            } else if (strings.eqlComptime(tag, "!!int")) {
                if (value.data == .e_string) {
                    const int_val = std.fmt.parseInt(i64, value.data.e_string.data, 10) catch {
                        try p.lexer.addDefaultError("Invalid integer value");
                        return error.SyntaxError;
                    };
                    value = p.e(E.Number{ .value = @as(f64, @floatFromInt(int_val)) }, loc);
                }
            } else if (strings.eqlComptime(tag, "!!float")) {
                if (value.data == .e_string) {
                    const float_val = std.fmt.parseFloat(f64, value.data.e_string.data) catch {
                        try p.lexer.addDefaultError("Invalid float value");
                        return error.SyntaxError;
                    };
                    value = p.e(E.Number{ .value = float_val }, loc);
                }
            } else if (strings.eqlComptime(tag, "!!bool")) {
                if (value.data == .e_string) {
                    const bool_val = if (strings.eqlComptime(value.data.e_string.data, "true"))
                        true
                    else if (strings.eqlComptime(value.data.e_string.data, "false"))
                        false
                    else {
                        try p.lexer.addDefaultError("Invalid boolean value");
                        return error.SyntaxError;
                    };
                    value = p.e(E.Boolean{ .value = bool_val }, loc);
                }
            } else if (strings.eqlComptime(tag, "!!null")) {
                value = p.e(E.Null{}, loc);
            }

            p.lexer.current_tag = null;
        }

        return value;
    }
};
