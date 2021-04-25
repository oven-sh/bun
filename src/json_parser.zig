const std = @import("std");
const logger = @import("logger.zig");
const js_lexer = @import("js_lexer.zig");
const importRecord = @import("import_record.zig");
const js_ast = @import("js_ast.zig");
const options = @import("options.zig");
const alloc = @import("alloc.zig");

const fs = @import("fs.zig");
usingnamespace @import("strings.zig");
usingnamespace @import("ast/base.zig");
usingnamespace js_ast.G;

const ImportKind = importRecord.ImportKind;
const BindingNodeIndex = js_ast.BindingNodeIndex;

const StmtNodeIndex = js_ast.StmtNodeIndex;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const StmtNodeList = js_ast.StmtNodeList;
const BindingNodeList = js_ast.BindingNodeList;
const assert = std.debug.assert;

const Ref = js_ast.Ref;
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

fn JSONLikeParser(opts: js_lexer.JSONOptions) type {
    const Lexer = if (opts.allow_comments) js_lexer.TSConfigJSONLexer else js_lexer.JSONLexer;
    return struct {
        lexer: Lexer,
        source: logger.Source,
        log: logger.Log,
        allocator: *std.mem.Allocator,

        pub fn init(allocator: *std.mem.Allocator, source: logger.Source, log: logger.Log) Parser {
            return Parser{
                .lexer = Lexer.init(log, source, allocator),
                .allocator = allocator,
                .log = log,
                .source = source,
            };
        }

        const Parser = @This();

        pub fn e(p: *Parser, t: anytype, loc: logger.Loc) Expr {
            if (@typeInfo(@TypeOf(t)) == .Pointer) {
                return Expr.init(t, loc);
            } else {
                return Expr.alloc(p.allocator, t, loc);
            }
        }
        pub fn parseExpr(p: *Parser) ?Expr {
            const loc = p.lexer.loc();

            switch (p.lexer.token) {
                .t_false => {
                    p.lexer.next();
                    return p.e(E.Boolean{
                        .value = false,
                    }, loc);
                },
                .t_true => {
                    p.lexer.next();
                    return p.e(E.Boolean{
                        .value = true,
                    }, loc);
                },
                .t_null => {
                    p.lexer.next();
                    return p.e(E.Null{}, loc);
                },
                .t_string_literal => {
                    const value = p.lexer.string_literal;
                    p.lexer.next();
                    return p.e(E.String{
                        .value = value,
                    }, loc);
                },
                .t_numeric_literal => {
                    const value = p.lexer.number;
                    p.lexer.next();
                    return p.e(E.Number{ .value = value }, loc);
                },
                .t_minus => {
                    p.lexer.next();
                    const value = p.lexer.number;
                    p.lexer.expect(.t_numeric_literal);
                    return p.e(E.Number{ .value = -value }, loc);
                },
                .t_open_bracket => {
                    p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var exprs = List(Expr).init(p.allocator);

                    while (p.lexer.token != .t_close_bracket) {
                        if (exprs.items.len > 0) {
                            if (p.lexer.has_newline_before) {
                                is_single_line = false;
                            }

                            if (!p.parseMaybeTrailingComma(.t_close_bracket)) {
                                break;
                            }

                            if (p.lexer.has_newline_before) {
                                is_single_line = false;
                            }
                        }

                        if (p.parseExpr()) |expr| {
                            try exprs.append(expr);
                        } else {
                            break;
                        }
                    }

                    if (p.lexer.has_newline_before) {
                        is_single_line = false;
                    }
                    p.lexer.expect(.t_close_bracket);
                    return p.e(E.Array{ .items = exprs.toOwnedSlice() }, loc);
                },
                .t_open_brace => {
                    p.lexer.next();
                    var is_single_line = !p.lexer.has_newline_before;
                    var properties = List(G.Property).init(p.allocator);
                    var duplicates = std.StringHashMap(u0).init(p.allocator);

                    while (p.lexer.token != .t_close_brace) {
                        if (properties.items.len > 0) {
                            is_single_line = if (p.lexer.has_newline_before) false else is_single_line;
                            if (!p.parseMaybeTrailingComma(.t_close_brace)) {
                                break;
                            }
                            is_single_line = if (p.lexer.has_newline_before) false else is_single_line;
                        }

                        var key_string = p.lexer.string_literal;
                        var key_range = p.lexer.range();
                        var key = p.e(E.String{ .value = key_string }, key_range.loc);
                        p.lexer.expect(.t_string_literal);
                        var key_text = p.lexer.utf16ToString();
                        // Warn about duplicate keys
                        if (duplicates.contains(key_text)) {
                            p.log.addRangeWarningFmt(p.source, r, "Duplicate key \"{s}\" in object literal", .{key_text}) catch unreachable;
                        } else {
                            duplicates.put(key_text, 0) catch unreachable;
                        }

                        p.lexer.expect(.t_colon);
                        var value = p.parseExpr() orelse return null;
                        try properties.append(G.Property{ .key = key, .value = value });
                    }

                    is_single_line = if (p.lexer.has_newline_before) false else is_single_line;
                    p.lexer.expect(.t_close_brace);
                    return p.e(E.Object{
                        .properties = properties.toOwnedSlice(),
                        .is_single_line = is_single_line,
                    }, loc);
                },
                else => {
                    p.lexer.unexpected();
                    return null;
                },
            }
        }

        pub fn parseMaybeTrailingComma(p: *Parser, closer: T) bool {
            const comma_range = p.lexer.range();
            p.lexer.expect(.t_comma);

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

pub fn ParseJSON(log: logger.Log, source: logger.Source) !?Expr {
    var parser = JSONParser.init(allocator, log, source);

    return try parser.parseExpr();
}

pub fn ParseTSConfig(log: logger.Loc, source: logger.Source) !?Expr {
    var parser = TSConfigParser.init(allocator, log, source);

    return try parser.parseExpr();
}
