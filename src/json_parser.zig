const std = @import("std");
const logger = @import("logger.zig");
const js_lexer = @import("js_lexer.zig");
const importRecord = @import("import_record.zig");
const js_ast = @import("js_ast.zig");
const options = @import("options.zig");
const alloc = @import("alloc.zig");

const fs = @import("fs.zig");
usingnamespace @import("global.zig");
usingnamespace @import("ast/base.zig");
usingnamespace js_ast.G;

const expect = std.testing.expect;
const ImportKind = importRecord.ImportKind;
const BindingNodeIndex = js_ast.BindingNodeIndex;

const StmtNodeIndex = js_ast.StmtNodeIndex;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const StmtNodeList = js_ast.StmtNodeList;
const BindingNodeList = js_ast.BindingNodeList;
const assert = std.debug.assert;

const LocRef = js_ast.LocRef;
const S = js_ast.S;
const B = js_ast.B;
const G = js_ast.G;
const T = js_lexer.T;
const E = js_ast.E;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const Binding = js_ast.Binding;
const Symbol = js_ast.Symbol;
const Level = js_ast.Op.Level;
const Op = js_ast.Op;
const Scope = js_ast.Scope;
const locModuleScope = logger.Loc.Empty;
const Lexer = js_lexer.Lexer;

fn JSONLikeParser(opts: js_lexer.JSONOptions) type {
    return struct {
        lexer: Lexer,
        source: *const logger.Source,
        log: *logger.Log,
        allocator: *std.mem.Allocator,

        pub fn init(allocator: *std.mem.Allocator, source: *const logger.Source, log: *logger.Log) !Parser {
            if (opts.allow_comments) {
                return Parser{
                    .lexer = try Lexer.initTSConfig(log, source, allocator),
                    .allocator = allocator,
                    .log = log,
                    .source = source,
                };
            } else {
                return Parser{
                    .lexer = try Lexer.initJSON(log, source, allocator),
                    .allocator = allocator,
                    .log = log,
                    .source = source,
                };
            }
        }

        const Parser = @This();

        pub fn e(p: *Parser, t: anytype, loc: logger.Loc) Expr {
            if (@typeInfo(@TypeOf(t)) == .Pointer) {
                return Expr.init(t, loc);
            } else {
                return Expr.alloc(p.allocator, t, loc);
            }
        }
        pub fn parseExpr(p: *Parser) anyerror!Expr {
            const loc = p.lexer.loc();

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
                .t_null => {
                    try p.lexer.next();
                    return p.e(E.Null{}, loc);
                },
                .t_string_literal => {
                    var str: E.String = p.lexer.toEString();

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
                .t_open_bracket => {
                    try p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var exprs = std.ArrayList(Expr).init(p.allocator);

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

                        exprs.append(try p.parseExpr()) catch unreachable;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.expect(.t_close_bracket);
                    return p.e(E.Array{ .items = exprs.toOwnedSlice() }, loc);
                },
                .t_open_brace => {
                    try p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var properties = std.ArrayList(G.Property).init(p.allocator);
                    var duplicates = std.AutoHashMap(u64, void).init(p.allocator);
                    defer duplicates.deinit();

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

                        var str = p.lexer.toEString();
                        const hash_key = str.hash();
                        const duplicate_get_or_put = duplicates.getOrPut(hash_key) catch unreachable;
                        duplicate_get_or_put.key_ptr.* = hash_key;

                        var key_range = p.lexer.range();
                        // Warn about duplicate keys
                        if (duplicate_get_or_put.found_existing) {
                            p.log.addRangeWarningFmt(p.source, key_range, p.allocator, "Duplicate key \"{s}\" in object literal", .{p.lexer.string_literal_slice}) catch unreachable;
                        }

                        var key = p.e(str, key_range.loc);
                        try p.lexer.expect(.t_string_literal);

                        try p.lexer.expect(.t_colon);
                        var value = try p.parseExpr();
                        properties.append(G.Property{ .key = key, .value = value }) catch unreachable;
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    try p.lexer.expect(.t_close_brace);
                    return p.e(E.Object{
                        .properties = properties.toOwnedSlice(),
                        .is_single_line = is_single_line,
                    }, loc);
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
                if (!opts.allow_trailing_commas) {
                    p.log.addRangeError(p.source, comma_range, "JSON does not support trailing commas") catch unreachable;
                }
                return false;
            }

            return true;
        }
    };
}

const JSONParser = JSONLikeParser(js_lexer.JSONOptions{});
const TSConfigParser = JSONLikeParser(js_lexer.JSONOptions{ .allow_comments = true, .allow_trailing_commas = true });
var empty_string = E.String{ .utf8 = "" };
var empty_object = E.Object{};
var empty_array = E.Array{ .items = &[_]ExprNodeIndex{} };
var empty_string_data = Expr.Data{ .e_string = &empty_string };
var empty_object_data = Expr.Data{ .e_object = &empty_object };
var empty_array_data = Expr.Data{ .e_array = &empty_array };

pub fn ParseJSON(source: *const logger.Source, log: *logger.Log, allocator: *std.mem.Allocator) !Expr {
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

    return parser.parseExpr();
}

pub fn ParseTSConfig(source: *const logger.Source, log: *logger.Log, allocator: *std.mem.Allocator) !Expr {
    var parser = try TSConfigParser.init(allocator, source, log);

    return parser.parseExpr();
}

const duplicateKeyJson = "{ \"name\": \"valid\", \"name\": \"invalid\" }";

const js_printer = @import("js_printer.zig");
const renamer = @import("renamer.zig");
const SymbolList = [][]Symbol;

fn expectPrintedJSON(_contents: string, expected: string) !void {
    var contents = alloc.dynamic.alloc(u8, _contents.len + 1) catch unreachable;
    std.mem.copy(u8, contents, _contents);
    contents[contents.len - 1] = ';';
    var log = logger.Log.init(alloc.dynamic);
    defer log.msgs.deinit();

    var source = logger.Source.initPathString(
        "source.json",
        contents,
    );
    const expr = try ParseJSON(&source, &log, alloc.dynamic);
    var stmt = Stmt.alloc(alloc.dynamic, S.SExpr{ .value = expr }, logger.Loc{ .start = 0 });

    var part = js_ast.Part{
        .stmts = &([_]Stmt{stmt}),
    };
    const tree = js_ast.Ast.initTest(&([_]js_ast.Part{part}));
    var symbols: SymbolList = &([_][]Symbol{tree.symbols});
    var symbol_map = js_ast.Symbol.Map.initList(symbols);
    if (log.msgs.items.len > 0) {
        Global.panic("--FAIL--\nExpr {s}\nLog: {s}\n--FAIL--", .{ expr, log.msgs.items[0].data.text });
    }
    var linker = @import("linker.zig").Linker{};

    const result = js_printer.printAst(alloc.dynamic, tree, symbol_map, &source, true, js_printer.Options{ .to_module_ref = Ref{ .inner_index = 0 } }, &linker) catch unreachable;

    var js = result.js;

    if (js.len > 1) {
        while (js[js.len - 1] == '\n') {
            js = js[0 .. js.len - 1];
        }

        if (js[js.len - 1] == ';') {
            js = js[0 .. js.len - 1];
        }
    }

    std.testing.expectEqualStrings(expected, js);
}

test "ParseJSON" {
    try alloc.setup(default_allocator);
    try expectPrintedJSON("true", "true");
    try expectPrintedJSON("false", "false");
    try expectPrintedJSON("1", "1");
    try expectPrintedJSON("10", "10");
    try expectPrintedJSON("100", "100");
    try expectPrintedJSON("100.1", "100.1");
    try expectPrintedJSON("19.1", "19.1");
    try expectPrintedJSON("19.12", "19.12");
    try expectPrintedJSON("3.4159820837456", "3.4159820837456");
    try expectPrintedJSON("-10000.25", "-10000.25");
    try expectPrintedJSON("\"hi\"", "\"hi\"");
    try expectPrintedJSON("{\"hi\": 1, \"hey\": \"200\", \"boom\": {\"yo\": true}}", "({\"hi\": 1, \"hey\": \"200\", \"boom\": {\"yo\": true}})");
    try expectPrintedJSON("{\"hi\": \"hey\"}", "({hi: \"hey\"})");
    try expectPrintedJSON("{\"hi\": [\"hey\", \"yo\"]}", "({hi:[\"hey\",\"yo\"]})");
    // TODO: emoji?
}

test "ParseJSON DuplicateKey warning" {
    alloc.setup(std.heap.page_allocator) catch unreachable;
    var log = logger.Log.init(alloc.dynamic);

    var source = logger.Source.initPathString(
        "package.json",
        duplicateKeyJson,
    );
    const expr = try ParseJSON(&source, &log, alloc.dynamic);

    const tag = @as(Expr.Tag, expr.data);
    expect(tag == .e_object);
    const object = expr.data.e_object;
    std.testing.expectEqual(@as(usize, 2), object.properties.len);
    const name1 = object.properties[0];
    expect(name1.key != null);
    expect(name1.value != null);
    expect(Expr.Tag.e_string == @as(Expr.Tag, name1.value.?.data));
    expect(Expr.Tag.e_string == @as(Expr.Tag, name1.key.?.data));
    expect(strings.eqlUtf16("name", name1.key.?.data.e_string.value));
    expect(strings.eqlUtf16("valid", name1.value.?.data.e_string.value));

    const name2 = object.properties[1];
    expect(name2.key != null);
    expect(name2.value != null);
    expect(Expr.Tag.e_string == @as(Expr.Tag, name2.value.?.data));
    expect(Expr.Tag.e_string == @as(Expr.Tag, name2.key.?.data));
    expect(strings.eqlUtf16("name", name2.key.?.data.e_string.value));
    std.testing.expectEqualStrings("invalid", try name2.value.?.data.e_string.string(alloc.dynamic));

    std.testing.expectEqual(@as(usize, 1), log.msgs.items.len);
}
