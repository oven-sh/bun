const std = @import("std");
const logger = bun.logger;
const js_lexer = bun.js_lexer;
const js_ast = bun.JSAst;
const BabyList = @import("./baby_list.zig").BabyList;
const bun = @import("bun");
const string = bun.string;
const Output = bun.Output;
const Environment = bun.Environment;
const strings = bun.strings;
const MutableString = bun.MutableString;
const default_allocator = bun.default_allocator;

const expect = std.testing.expect;

const ExprNodeList = js_ast.ExprNodeList;
const assert = bun.assert;

const G = js_ast.G;
const T = js_lexer.T;
const E = js_ast.E;
const Stmt = js_ast.Stmt;
pub const Expr = js_ast.Expr;
const Indentation = js_printer.Options.Indentation;

const LEXER_DEBUGGER_WORKAROUND = false;

const HashMapPool = struct {
    const HashMap = std.HashMap(u64, void, IdentityContext, 80);
    const LinkedList = std.SinglyLinkedList(HashMap);
    threadlocal var list: LinkedList = undefined;
    threadlocal var loaded: bool = false;

    const IdentityContext = struct {
        pub fn eql(_: @This(), a: u64, b: u64) bool {
            return a == b;
        }

        pub fn hash(_: @This(), a: u64) u64 {
            return a;
        }
    };

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

fn newExpr(t: anytype, loc: logger.Loc) Expr {
    const Type = @TypeOf(t);
    if (comptime @typeInfo(Type) == .pointer) {
        @compileError("Unexpected pointer");
    }

    if (comptime Environment.allow_assert) {
        if (comptime Type == E.Object) {
            for (t.properties.slice()) |prop| {
                // json should never have an initializer set
                bun.assert(prop.initializer == null);
                bun.assert(prop.key != null);
                bun.assert(prop.value != null);
            }
        }
    }

    return Expr.init(Type, t, loc);
}

// This hack fixes using LLDB
fn JSONLikeParser(comptime opts: js_lexer.JSONOptions) type {
    return JSONLikeParser_(
        opts.is_json,
        opts.allow_comments,
        opts.allow_trailing_commas,
        opts.ignore_leading_escape_sequences,
        opts.ignore_trailing_escape_sequences,
        opts.json_warn_duplicate_keys,
        opts.was_originally_macro,
        opts.guess_indentation,
    );
}

fn JSONLikeParser_(
    comptime opts_is_json: bool,
    comptime opts_allow_comments: bool,
    comptime opts_allow_trailing_commas: bool,
    comptime opts_ignore_leading_escape_sequences: bool,
    comptime opts_ignore_trailing_escape_sequences: bool,
    comptime opts_json_warn_duplicate_keys: bool,
    comptime opts_was_originally_macro: bool,
    comptime opts_guess_indentation: bool,
) type {
    const opts = js_lexer.JSONOptions{
        .is_json = opts_is_json,
        .allow_comments = opts_allow_comments,
        .allow_trailing_commas = opts_allow_trailing_commas,
        .ignore_leading_escape_sequences = opts_ignore_leading_escape_sequences,
        .ignore_trailing_escape_sequences = opts_ignore_trailing_escape_sequences,
        .json_warn_duplicate_keys = opts_json_warn_duplicate_keys,
        .was_originally_macro = opts_was_originally_macro,
        .guess_indentation = opts_guess_indentation,
    };
    return struct {
        const Lexer = js_lexer.NewLexer(if (LEXER_DEBUGGER_WORKAROUND) js_lexer.JSONOptions{} else opts);

        lexer: Lexer,
        log: *logger.Log,
        allocator: std.mem.Allocator,
        list_allocator: std.mem.Allocator,

        pub fn init(allocator: std.mem.Allocator, source_: *const logger.Source, log: *logger.Log) !Parser {
            return initWithListAllocator(allocator, allocator, source_, log);
        }

        pub fn initWithListAllocator(allocator: std.mem.Allocator, list_allocator: std.mem.Allocator, source_: *const logger.Source, log: *logger.Log) !Parser {
            Expr.Data.Store.assert();
            Stmt.Data.Store.assert();

            return Parser{
                .lexer = try Lexer.init(log, source_, allocator),
                .allocator = allocator,
                .log = log,
                .list_allocator = list_allocator,
            };
        }

        pub inline fn source(p: *const Parser) *const logger.Source {
            return &p.lexer.source;
        }

        const Parser = @This();

        pub fn parseExpr(p: *Parser, comptime maybe_auto_quote: bool, comptime force_utf8: bool) anyerror!Expr {
            const loc = p.lexer.loc();

            switch (p.lexer.token) {
                .t_false => {
                    try p.lexer.next();
                    return newExpr(E.Boolean{
                        .value = false,
                    }, loc);
                },
                .t_true => {
                    try p.lexer.next();
                    return newExpr(E.Boolean{
                        .value = true,
                    }, loc);
                },
                .t_null => {
                    try p.lexer.next();
                    return newExpr(E.Null{}, loc);
                },
                .t_string_literal => {
                    var str: E.String = try p.lexer.toEString();
                    if (comptime force_utf8) {
                        str.toUTF8(p.allocator) catch unreachable;
                    }

                    try p.lexer.next();
                    return newExpr(str, loc);
                },
                .t_numeric_literal => {
                    const value = p.lexer.number;
                    try p.lexer.next();
                    return newExpr(E.Number{ .value = value }, loc);
                },
                .t_minus => {
                    try p.lexer.next();
                    const value = p.lexer.number;
                    try p.lexer.expect(.t_numeric_literal);
                    return newExpr(E.Number{ .value = -value }, loc);
                },
                .t_open_bracket => {
                    try p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var exprs = std.ArrayList(Expr).init(p.list_allocator);

                    while (p.lexer.token != .t_close_bracket) {
                        if (exprs.items.len > 0) {
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

                        exprs.append(try p.parseExpr(false, force_utf8)) catch unreachable;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.expect(.t_close_bracket);
                    return newExpr(E.Array{
                        .items = ExprNodeList.fromList(exprs),
                        .is_single_line = is_single_line,
                        .was_originally_macro = comptime opts.was_originally_macro,
                    }, loc);
                },
                .t_open_brace => {
                    try p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var properties = std.ArrayList(G.Property).init(p.list_allocator);

                    const DuplicateNodeType = comptime if (opts.json_warn_duplicate_keys) *HashMapPool.LinkedList.Node else void;
                    const HashMapType = comptime if (opts.json_warn_duplicate_keys) HashMapPool.HashMap else void;

                    var duplicates_node: DuplicateNodeType = if (comptime opts.json_warn_duplicate_keys) HashMapPool.get(p.allocator);

                    var duplicates: HashMapType = if (comptime opts.json_warn_duplicate_keys) duplicates_node.data;

                    defer {
                        if (comptime opts.json_warn_duplicate_keys) {
                            duplicates_node.data = duplicates;
                            HashMapPool.release(duplicates_node);
                        }
                    }

                    while (p.lexer.token != .t_close_brace) {
                        if (properties.items.len > 0) {
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

                        const str = if (comptime force_utf8)
                            try p.lexer.toUTF8EString()
                        else
                            try p.lexer.toEString();

                        const key_range = p.lexer.range();
                        const key = newExpr(str, key_range.loc);
                        try p.lexer.expect(.t_string_literal);

                        if (comptime opts.json_warn_duplicate_keys) {
                            const hash_key = str.hash();
                            const duplicate_get_or_put = duplicates.getOrPut(hash_key) catch unreachable;
                            duplicate_get_or_put.key_ptr.* = hash_key;

                            // Warn about duplicate keys
                            if (duplicate_get_or_put.found_existing) {
                                p.log.addRangeWarningFmt(p.source(), key_range, p.allocator, "Duplicate key \"{s}\" in object literal", .{try str.string(p.allocator)}) catch unreachable;
                            }
                        }

                        try p.lexer.expect(.t_colon);
                        const value = try p.parseExpr(false, force_utf8);
                        properties.append(G.Property{
                            .key = key,
                            .value = value,
                            .kind = js_ast.G.Property.Kind.normal,
                            .initializer = null,
                        }) catch unreachable;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.expect(.t_close_brace);
                    return newExpr(E.Object{
                        .properties = G.Property.List.fromList(properties),
                        .is_single_line = is_single_line,
                        .was_originally_macro = comptime opts.was_originally_macro,
                    }, loc);
                },
                else => {
                    if (comptime maybe_auto_quote) {
                        p.lexer = try Lexer.initJSON(p.log, p.source(), p.allocator);
                        try p.lexer.parseStringLiteral(0);
                        return p.parseExpr(false, force_utf8);
                    }

                    try p.lexer.unexpected();
                    return error.ParserError;
                },
            }
        }

        pub fn parseMaybeTrailingComma(p: *Parser, closer: T) !bool {
            const comma_range = p.lexer.range();
            try p.lexer.expect(.t_comma);

            if (p.lexer.token == closer) {
                if (comptime !opts.allow_trailing_commas) {
                    p.log.addRangeError(p.source(), comma_range, "JSON does not support trailing commas") catch unreachable;
                }
                return false;
            }

            return true;
        }
    };
}

// This is a special JSON parser that stops as soon as it finds
// {
//    "name": "NAME_IN_HERE",
//    "version": "VERSION_IN_HERE",
// }
// and then returns the name and version.
// More precisely, it stops as soon as it finds a top-level "name" and "version" property which are strings
// In most cases, it should perform zero heap allocations because it does not create arrays or objects (It just skips them)
pub const PackageJSONVersionChecker = struct {
    const Lexer = js_lexer.NewLexer(opts);

    lexer: Lexer,
    source: *const logger.Source,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    depth: usize = 0,

    found_version_buf: [1024]u8 = undefined,
    found_name_buf: [1024]u8 = undefined,

    found_name: []const u8 = "",
    found_version: []const u8 = "",

    has_found_name: bool = false,
    has_found_version: bool = false,

    name_loc: logger.Loc = logger.Loc.Empty,

    const opts = if (LEXER_DEBUGGER_WORKAROUND) js_lexer.JSONOptions{} else js_lexer.JSONOptions{
        .is_json = true,
        .json_warn_duplicate_keys = false,
        .allow_trailing_commas = true,
        .allow_comments = true,
    };

    pub fn init(allocator: std.mem.Allocator, source: *const logger.Source, log: *logger.Log) !Parser {
        return Parser{
            .lexer = try Lexer.init(log, source, allocator),
            .allocator = allocator,
            .log = log,
            .source = source,
        };
    }

    const Parser = @This();

    pub fn parseExpr(p: *Parser) anyerror!Expr {
        const loc = p.lexer.loc();

        if (p.has_found_name and p.has_found_version) return newExpr(E.Missing{}, loc);

        switch (p.lexer.token) {
            .t_false => {
                try p.lexer.next();
                return newExpr(E.Boolean{
                    .value = false,
                }, loc);
            },
            .t_true => {
                try p.lexer.next();
                return newExpr(E.Boolean{
                    .value = true,
                }, loc);
            },
            .t_null => {
                try p.lexer.next();
                return newExpr(E.Null{}, loc);
            },
            .t_string_literal => {
                const str: E.String = try p.lexer.toEString();

                try p.lexer.next();
                return newExpr(str, loc);
            },
            .t_numeric_literal => {
                const value = p.lexer.number;
                try p.lexer.next();
                return newExpr(E.Number{ .value = value }, loc);
            },
            .t_minus => {
                try p.lexer.next();
                const value = p.lexer.number;
                try p.lexer.expect(.t_numeric_literal);
                return newExpr(E.Number{ .value = -value }, loc);
            },
            .t_open_bracket => {
                try p.lexer.next();
                var has_exprs = false;

                while (p.lexer.token != .t_close_bracket) {
                    if (has_exprs) {
                        if (!try p.parseMaybeTrailingComma(.t_close_bracket)) {
                            break;
                        }
                    }

                    _ = try p.parseExpr();
                    has_exprs = true;
                }

                try p.lexer.expect(.t_close_bracket);
                return newExpr(E.Missing{}, loc);
            },
            .t_open_brace => {
                try p.lexer.next();
                p.depth += 1;
                defer p.depth -= 1;

                var has_properties = false;
                while (p.lexer.token != .t_close_brace) {
                    if (has_properties) {
                        if (!try p.parseMaybeTrailingComma(.t_close_brace)) {
                            break;
                        }
                    }

                    const str = try p.lexer.toEString();
                    const key_range = p.lexer.range();

                    const key = newExpr(str, key_range.loc);
                    try p.lexer.expect(.t_string_literal);

                    try p.lexer.expect(.t_colon);

                    const value = try p.parseExpr();

                    if (p.depth == 1) {
                        // if you have multiple "name" fields in the package.json....
                        // first one wins
                        if (key.data == .e_string and value.data == .e_string) {
                            if (!p.has_found_name and strings.eqlComptime(key.data.e_string.data, "name")) {
                                const len = @min(
                                    value.data.e_string.data.len,
                                    p.found_name_buf.len,
                                );

                                bun.copy(u8, &p.found_name_buf, value.data.e_string.data[0..len]);
                                p.found_name = p.found_name_buf[0..len];
                                p.has_found_name = true;
                                p.name_loc = value.loc;
                            } else if (!p.has_found_version and strings.eqlComptime(key.data.e_string.data, "version")) {
                                const len = @min(
                                    value.data.e_string.data.len,
                                    p.found_version_buf.len,
                                );
                                bun.copy(u8, &p.found_version_buf, value.data.e_string.data[0..len]);
                                p.found_version = p.found_version_buf[0..len];
                                p.has_found_version = true;
                            }
                        }
                    }

                    if (p.has_found_name and p.has_found_version) return newExpr(E.Missing{}, loc);

                    has_properties = true;
                }

                try p.lexer.expect(.t_close_brace);
                return newExpr(E.Missing{}, loc);
            },
            else => {
                try p.lexer.unexpected();
                return error.ParserError;
            },
        }
    }

    pub fn parseMaybeTrailingComma(p: *Parser, closer: T) !bool {
        const comma_range = p.lexer.range();
        try p.lexer.expect(.t_comma);

        if (p.lexer.token == closer) {
            if (comptime !opts.allow_trailing_commas) {
                p.log.addRangeError(p.source(), comma_range, "JSON does not support trailing commas") catch unreachable;
            }
            return false;
        }

        return true;
    }
};

pub fn toAST(
    allocator: std.mem.Allocator,
    comptime Type: type,
    value: Type,
) anyerror!js_ast.Expr {
    const type_info: std.builtin.Type = @typeInfo(Type);

    switch (type_info) {
        .bool => {
            return Expr{
                .data = .{ .e_boolean = .{
                    .value = value,
                } },
                .loc = logger.Loc{},
            };
        },
        .int => {
            return Expr{
                .data = .{
                    .e_number = .{
                        .value = @as(f64, @floatFromInt(value)),
                    },
                },
                .loc = logger.Loc{},
            };
        },
        .float => {
            return Expr{
                .data = .{
                    .e_number = .{
                        .value = @as(f64, @floatCast(value)),
                    },
                },
                .loc = logger.Loc{},
            };
        },
        .pointer => |ptr_info| switch (ptr_info.size) {
            .one => switch (@typeInfo(ptr_info.child)) {
                .array => {
                    const Slice = []const std.meta.Elem(ptr_info.child);
                    return try toAST(allocator, Slice, value.*);
                },
                else => {
                    return try toAST(allocator, @TypeOf(value.*), value.*);
                },
            },
            .slice => {
                if (ptr_info.child == u8) {
                    return Expr.init(js_ast.E.String, js_ast.E.String.init(value), logger.Loc.Empty);
                }

                const exprs = try allocator.alloc(Expr, value.len);
                for (exprs, 0..) |*ex, i| ex.* = try toAST(allocator, @TypeOf(value[i]), value[i]);

                return Expr.init(js_ast.E.Array, js_ast.E.Array{ .items = exprs }, logger.Loc.Empty);
            },
            else => @compileError("Unable to stringify type '" ++ @typeName(T) ++ "'"),
        },
        .array => |Array| {
            if (Array.child == u8) {
                return Expr.init(js_ast.E.String, js_ast.E.String.init(value), logger.Loc.Empty);
            }

            const exprs = try allocator.alloc(Expr, value.len);
            for (exprs, 0..) |*ex, i| ex.* = try toAST(allocator, @TypeOf(value[i]), value[i]);

            return Expr.init(js_ast.E.Array, js_ast.E.Array{ .items = exprs }, logger.Loc.Empty);
        },
        .@"struct" => |Struct| {
            const fields: []const std.builtin.Type.StructField = Struct.fields;
            var properties = try allocator.alloc(js_ast.G.Property, fields.len);
            var property_i: usize = 0;
            inline for (fields) |field| {
                properties[property_i] = G.Property{
                    .key = Expr.init(E.String, E.String{ .data = field.name }, logger.Loc.Empty),
                    .value = try toAST(allocator, field.type, @field(value, field.name)),
                };
                property_i += 1;
            }

            return Expr.init(
                js_ast.E.Object,
                js_ast.E.Object{
                    .properties = BabyList(G.Property).init(properties[0..property_i]),
                    .is_single_line = property_i <= 1,
                },
                logger.Loc.Empty,
            );
        },
        .null => {
            return Expr{ .data = .{ .e_null = .{} }, .loc = logger.Loc{} };
        },
        .optional => {
            if (value) |_value| {
                return try toAST(allocator, @TypeOf(_value), _value);
            } else {
                return Expr{ .data = .{ .e_null = .{} }, .loc = logger.Loc{} };
            }
        },
        .@"enum" => {
            _ = std.meta.intToEnum(Type, @intFromEnum(value)) catch {
                return Expr{ .data = .{ .e_null = .{} }, .loc = logger.Loc{} };
            };

            return toAST(allocator, string, @as(string, @tagName(value)));
        },
        .error_set => return try toAST(allocator, []const u8, bun.asByteSlice(@errorName(value))),
        .@"union" => |Union| {
            const info = Union;
            if (info.tag_type) |UnionTagType| {
                inline for (info.fields) |u_field| {
                    if (value == @field(UnionTagType, u_field.name)) {
                        const StructType = @Type(
                            .{
                                .Struct = .{
                                    .layout = .Auto,
                                    .decls = &.{},
                                    .is_tuple = false,
                                    .fields = &.{
                                        .{
                                            .name = u_field.name,
                                            .type = @TypeOf(
                                                @field(value, u_field.name),
                                            ),
                                            .is_comptime = false,
                                            .default_value_ptr = undefined,
                                            .alignment = @alignOf(
                                                @TypeOf(
                                                    @field(value, u_field.name),
                                                ),
                                            ),
                                        },
                                    },
                                },
                            },
                        );
                        var struct_value: StructType = undefined;
                        @field(struct_value, u_field.name) = value;
                        return try toAST(allocator, StructType, struct_value);
                    }
                }
            } else {
                @compileError("Unable to stringify untagged union '" ++ @typeName(T) ++ "'");
            }
        },
        else => @compileError(std.fmt.comptimePrint("Unsupported type: {s} - {s}", .{ @tagName(type_info), @typeName(Type) })),
    }
}

const JSONParser = if (bun.fast_debug_build_mode) TSConfigParser else JSONLikeParser(js_lexer.JSONOptions{ .is_json = true });
const RemoteJSONParser = if (bun.fast_debug_build_mode) TSConfigParser else JSONLikeParser(js_lexer.JSONOptions{ .is_json = true, .json_warn_duplicate_keys = false });
const DotEnvJSONParser = JSONLikeParser(js_lexer.JSONOptions{
    .ignore_leading_escape_sequences = true,
    .ignore_trailing_escape_sequences = true,
    .allow_trailing_commas = true,
    .is_json = true,
});

const TSConfigParser = JSONLikeParser(js_lexer.JSONOptions{ .allow_comments = true, .is_json = true, .allow_trailing_commas = true });
const JSONParserForMacro = JSONLikeParser(
    js_lexer.JSONOptions{
        .allow_comments = true,
        .is_json = true,
        .json_warn_duplicate_keys = false,
        .allow_trailing_commas = true,
        .was_originally_macro = true,
    },
);

var empty_object = E.Object{};
var empty_array = E.Array{};
var empty_string = E.String{};
var empty_string_data = Expr.Data{ .e_string = &empty_string };
var empty_object_data = Expr.Data{ .e_object = &empty_object };
var empty_array_data = Expr.Data{ .e_array = &empty_array };

/// Parse JSON
/// This leaves UTF-16 strings as UTF-16 strings
/// The JavaScript Printer will handle escaping strings if necessary
pub fn parse(
    source: *const logger.Source,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    comptime force_utf8: bool,
) !Expr {
    var parser = try JSONParser.init(allocator, source, log);
    switch (source.contents.len) {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
        },
        // This is a fast pass I guess
        2 => {
            if (strings.eqlComptime(source.contents[0..1], "\"\"") or strings.eqlComptime(source.contents[0..1], "''")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_string_data };
            } else if (strings.eqlComptime(source.contents[0..1], "{}")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
            } else if (strings.eqlComptime(source.contents[0..1], "[]")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_array_data };
            }
        },
        else => {},
    }

    return try parser.parseExpr(false, force_utf8);
}

/// Parse Package JSON
/// Allow trailing commas & comments.
/// This eagerly transcodes UTF-16 strings into UTF-8 strings
/// Use this when the text may need to be reprinted to disk as JSON (and not as JavaScript)
/// Eagerly converting UTF-8 to UTF-16 can cause a performance issue
pub fn parsePackageJSONUTF8(
    source: *const logger.Source,
    log: *logger.Log,
    allocator: std.mem.Allocator,
) !Expr {
    const len = source.contents.len;

    switch (len) {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
        },
        // This is a fast pass I guess
        2 => {
            if (strings.eqlComptime(source.contents[0..1], "\"\"") or strings.eqlComptime(source.contents[0..1], "''")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_string_data };
            } else if (strings.eqlComptime(source.contents[0..1], "{}")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
            } else if (strings.eqlComptime(source.contents[0..1], "[]")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_array_data };
            }
        },
        else => {},
    }

    var parser = try JSONLikeParser(.{
        .is_json = true,
        .allow_comments = true,
        .allow_trailing_commas = true,
    }).init(allocator, source, log);
    bun.assert(parser.source().contents.len > 0);

    return try parser.parseExpr(false, true);
}

const JsonResult = struct {
    root: Expr,
    indentation: Indentation = .{},
};

pub fn parsePackageJSONUTF8WithOpts(
    source: *const logger.Source,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    comptime opts: js_lexer.JSONOptions,
) !JsonResult {
    const len = source.contents.len;

    switch (len) {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return .{
                .root = Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data },
            };
        },
        // This is a fast pass I guess
        2 => {
            if (strings.eqlComptime(source.contents[0..1], "\"\"") or strings.eqlComptime(source.contents[0..1], "''")) {
                return .{ .root = Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_string_data } };
            } else if (strings.eqlComptime(source.contents[0..1], "{}")) {
                return .{ .root = Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data } };
            } else if (strings.eqlComptime(source.contents[0..1], "[]")) {
                return .{ .root = Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_array_data } };
            }
        },
        else => {},
    }

    var parser = try JSONLikeParser(opts).init(allocator, source, log);
    bun.assert(parser.source().contents.len > 0);

    const root = try parser.parseExpr(false, true);

    return .{
        .root = root,
        .indentation = if (comptime opts.guess_indentation) parser.lexer.indent_info.guess else .{},
    };
}

/// Parse Package JSON
/// Allow trailing commas & comments.
/// This eagerly transcodes UTF-16 strings into UTF-8 strings
/// Use this when the text may need to be reprinted to disk as JSON (and not as JavaScript)
/// Eagerly converting UTF-8 to UTF-16 can cause a performance issue
pub fn parseUTF8(
    source: *const logger.Source,
    log: *logger.Log,
    allocator: std.mem.Allocator,
) !Expr {
    return try parseUTF8Impl(source, log, allocator, false);
}

pub fn parseUTF8Impl(
    source: *const logger.Source,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    comptime check_len: bool,
) !Expr {
    const len = source.contents.len;

    switch (len) {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
        },
        // This is a fast pass I guess
        2 => {
            if (strings.eqlComptime(source.contents[0..1], "\"\"") or strings.eqlComptime(source.contents[0..1], "''")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_string_data };
            } else if (strings.eqlComptime(source.contents[0..1], "{}")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
            } else if (strings.eqlComptime(source.contents[0..1], "[]")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_array_data };
            }
        },
        else => {},
    }

    var parser = try JSONParser.init(allocator, source, log);
    bun.assert(parser.source().contents.len > 0);

    const result = try parser.parseExpr(false, true);
    if (comptime check_len) {
        if (parser.lexer.end >= source.contents.len) return result;
        try parser.lexer.unexpected();
        return error.ParserError;
    }
    return result;
}
pub fn parseForMacro(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) !Expr {
    switch (source.contents.len) {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
        },
        // This is a fast pass I guess
        2 => {
            if (strings.eqlComptime(source.contents[0..1], "\"\"") or strings.eqlComptime(source.contents[0..1], "''")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_string_data };
            } else if (strings.eqlComptime(source.contents[0..1], "{}")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
            } else if (strings.eqlComptime(source.contents[0..1], "[]")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_array_data };
            }
        },
        else => {},
    }

    var parser = try JSONParserForMacro.init(allocator, source, log);

    return try parser.parseExpr(false, false);
}

pub const JSONParseResult = struct {
    expr: Expr,
    tag: Tag,

    pub const Tag = enum {
        expr,
        ascii,
        empty,
    };
};

pub fn parseForBundling(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) !JSONParseResult {
    switch (source.contents.len) {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return JSONParseResult{ .expr = Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data }, .tag = .empty };
        },
        // This is a fast pass I guess
        2 => {
            if (strings.eqlComptime(source.contents[0..1], "\"\"") or strings.eqlComptime(source.contents[0..1], "''")) {
                return JSONParseResult{ .expr = Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_string_data }, .tag = .expr };
            } else if (strings.eqlComptime(source.contents[0..1], "{}")) {
                return JSONParseResult{ .expr = Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data }, .tag = .expr };
            } else if (strings.eqlComptime(source.contents[0..1], "[]")) {
                return JSONParseResult{ .expr = Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_array_data }, .tag = .expr };
            }
        },
        else => {},
    }

    var parser = try JSONParser.init(allocator, source.*, log);
    const result = try parser.parseExpr(false, true);
    return JSONParseResult{
        .tag = if (!LEXER_DEBUGGER_WORKAROUND and parser.lexer.is_ascii_only) JSONParseResult.Tag.ascii else JSONParseResult.Tag.expr,
        .expr = result,
    };
}

// threadlocal var env_json_auto_quote_buffer: MutableString = undefined;
// threadlocal var env_json_auto_quote_buffer_loaded: bool = false;
pub fn parseEnvJSON(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator) !Expr {
    switch (source.contents.len) {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
        },
        // This is a fast pass I guess
        2 => {
            if (strings.eqlComptime(source.contents[0..1], "\"\"") or strings.eqlComptime(source.contents[0..1], "''")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_string_data };
            } else if (strings.eqlComptime(source.contents[0..1], "{}")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
            } else if (strings.eqlComptime(source.contents[0..1], "[]")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_array_data };
            }
        },
        else => {},
    }

    var parser = try DotEnvJSONParser.init(allocator, source, log);

    switch (source.contents[0]) {
        '{', '[', '0'...'9', '"', '\'' => {
            return try parser.parseExpr(false, false);
        },
        else => {
            switch (parser.lexer.token) {
                .t_true => {
                    return Expr{ .loc = logger.Loc{ .start = 0 }, .data = .{ .e_boolean = E.Boolean{ .value = true } } };
                },
                .t_false => {
                    return Expr{ .loc = logger.Loc{ .start = 0 }, .data = .{ .e_boolean = E.Boolean{ .value = false } } };
                },
                .t_null => {
                    return Expr{ .loc = logger.Loc{ .start = 0 }, .data = .{ .e_null = E.Null{} } };
                },
                .t_identifier => {
                    if (strings.eqlComptime(parser.lexer.identifier, "undefined")) {
                        return Expr{ .loc = logger.Loc{ .start = 0 }, .data = .{ .e_undefined = E.Undefined{} } };
                    }

                    return try parser.parseExpr(true, false);
                },
                else => {
                    return try parser.parseExpr(true, false);
                },
            }
        },
    }
}

pub fn parseTSConfig(source: *const logger.Source, log: *logger.Log, allocator: std.mem.Allocator, comptime force_utf8: bool) !Expr {
    switch (source.contents.len) {
        // This is to be consisntent with how disabled JS files are handled
        0 => {
            return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
        },
        // This is a fast pass I guess
        2 => {
            if (strings.eqlComptime(source.contents[0..1], "\"\"") or strings.eqlComptime(source.contents[0..1], "''")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_string_data };
            } else if (strings.eqlComptime(source.contents[0..1], "{}")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_object_data };
            } else if (strings.eqlComptime(source.contents[0..1], "[]")) {
                return Expr{ .loc = logger.Loc{ .start = 0 }, .data = empty_array_data };
            }
        },
        else => {},
    }

    var parser = try TSConfigParser.init(allocator, source, log);

    return parser.parseExpr(false, force_utf8);
}

const duplicateKeyJson = "{ \"name\": \"valid\", \"name\": \"invalid\" }";

const js_printer = bun.js_printer;

fn expectPrintedJSON(_contents: string, expected: string) !void {
    Expr.Data.Store.create(default_allocator);
    Stmt.Data.Store.create(default_allocator);
    defer {
        Expr.Data.Store.reset();
        Stmt.Data.Store.reset();
    }
    var contents = default_allocator.alloc(u8, _contents.len + 1) catch unreachable;
    bun.copy(u8, contents, _contents);
    contents[contents.len - 1] = ';';
    var log = logger.Log.init(default_allocator);
    defer log.msgs.deinit();

    const source = &logger.Source.initPathString(
        "source.json",
        contents,
    );
    const expr = try parse(source, &log, default_allocator);

    if (log.msgs.items.len > 0) {
        Output.panic("--FAIL--\nExpr {s}\nLog: {s}\n--FAIL--", .{ expr, log.msgs.items[0].data.text });
    }

    const buffer_writer = js_printer.BufferWriter.init(default_allocator);
    var writer = js_printer.BufferPrinter.init(buffer_writer);
    const written = try js_printer.printJSON(@TypeOf(&writer), &writer, expr, source, .{
        .mangled_props = null,
    });
    var js = writer.ctx.buffer.list.items.ptr[0 .. written + 1];

    if (js.len > 1) {
        while (js[js.len - 1] == '\n') {
            js = js[0 .. js.len - 1];
        }

        if (js[js.len - 1] == ';') {
            js = js[0 .. js.len - 1];
        }
    }

    try std.testing.expectEqualStrings(expected, js);
}
