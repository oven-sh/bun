const std = @import("std");
const logger = @import("../logger.zig");
const mdx_lexer = @import("./mdx_lexer.zig");
const Lexer = mdx_lexer.Lexer;
const importRecord = @import("../import_record.zig");
const js_ast = @import("../js_ast.zig");
const JSParser = @import("../js_parser/js_parser.zig").MDXParser;
const ParseStatementOptions = @import("../js_parser/js_parser.zig").ParseStatementOptions;

const options = @import("../options.zig");

const fs = @import("../fs.zig");
const _global = @import("../global.zig");
const string = _global.string;
const Output = _global.Output;
const Global = _global.Global;
const Environment = _global.Environment;
const strings = _global.strings;
const MutableString = _global.MutableString;
const stringZ = _global.stringZ;
const default_allocator = _global.default_allocator;
const C = _global.C;
const expect = std.testing.expect;
const ImportKind = importRecord.ImportKind;
const BindingNodeIndex = js_ast.BindingNodeIndex;
const Define = @import("../defines.zig").Define;
const js_lexer = @import("../js_lexer.zig");
const StmtNodeIndex = js_ast.StmtNodeIndex;
const ExprNodeIndex = js_ast.ExprNodeIndex;
const ExprNodeList = js_ast.ExprNodeList;
const StmtNodeList = js_ast.StmtNodeList;
const BindingNodeList = js_ast.BindingNodeList;
const ParserOptions = @import("../js_parser/js_parser.zig").Parser.Options;
const runVisitPassAndFinish = @import("../js_parser/js_parser.zig").Parser.runVisitPassAndFinish;
const assert = std.debug.assert;

const LocRef = js_ast.LocRef;
const S = js_ast.S;
const B = js_ast.B;
const G = js_ast.G;
const T = mdx_lexer.T;
const E = js_ast.E;
const Stmt = js_ast.Stmt;
const Expr = js_ast.Expr;
const Binding = js_ast.Binding;
const Symbol = js_ast.Symbol;
const Level = js_ast.Op.Level;
const Op = js_ast.Op;
const Scope = js_ast.Scope;

pub const MDX = struct {
    lexer: Lexer,
    parser: JSParser,
    log: *logger.Log,
    allocator: std.mem.Allocator,
    stmts: std.ArrayListUnmanaged(js_ast.Stmt) = .{},
    before_stmts: std.ArrayListUnmanaged(js_ast.Stmt) = .{},

    pub inline fn source(p: *const MDX) *const logger.Source {
        return &p.lexer.source;
    }

    pub fn e(_: *MDX, t: anytype, loc: logger.Loc) Expr {
        const Type = @TypeOf(t);
        if (@typeInfo(Type) == .Pointer) {
            return Expr.init(std.meta.Child(Type), t.*, loc);
        } else {
            return Expr.init(Type, t, loc);
        }
    }

    pub fn s(_: *MDX, t: anytype, loc: logger.Loc) Expr {
        const Type = @TypeOf(t);
        if (@typeInfo(Type) == .Pointer) {
            return Stmt.init(std.meta.Child(Type), t.*, loc);
        } else {
            return Stmt.init(Type, t, loc);
        }
    }

    pub fn setup(
        this: *MDX,
        _options: ParserOptions,
        log: *logger.Log,
        source_: *const logger.Source,
        define: *Define,
        allocator: std.mem.Allocator,
    ) !MDX {
        try JSParser.init(
            allocator,
            log,
            source_,
            define,
            js_lexer.Lexer.initNoAutoStep(log, source_.*, allocator),
            _options,
            &this.parser,
        );
        this.lexer = Lexer.init(&this.parser.lexer);
        this.allocator = allocator;
        this.log = log;
    }

    pub fn parse(this: *MDX) !js_ast.Result {
        try this._parse();
        return try runVisitPassAndFinish(JSParser, &this.parser, this.stmts.toOwnedSlice(this.allocator));
    }

    // We do this in usually one pass
    // Essentially:
    // Instead of doing a tokenization pass over the entire file
    // We tokenize forward, assuming inlines are as expected
    // but then, if we unexpectedly get a newline, so it doesn't have a "closing" element
    // we treat treat the original element as plain text instead
    // and we append the children to the parent element
    // this means that
    // **foo \n
    // **bar
    // becomes <p>foo</p><p>bar</p>
    // instead of <strong>foo \n<strong>bar</strong></strong>
    pub fn parseExpr(this: *MDX, exprs: *std.ArrayListUnmanaged(Expr)) anyerror!void {
        switch (this.lexer.token) {
            T.t_js_block_open => {
                const expr = try this.parser.parseExpr(.lowest);
                try this.lexer.js.expect(.t_close_brace);
                this.lexer.js.token = .t_js_block_close;
                try exprs.append(this.allocator, expr);
                try this.lexer.next();
                return;
            },
            T.t_text => {
                try exprs.append(this.e(this.lexer.toEString(), this.lexer.loc()));
                try this.lexer.next();
                return;
            },
            T.t_underscore,
            T.t_star,
            => |start_token| {
                const loc = this.lexer.loc();
                const tag_string = E.JSXElement.Tag.map.get(.em);
                // const indent = this.lexer.indent;
                try this.lexer.next();
                var children = std.ArrayListUnmanaged(Expr){};

                while (true) {
                    if (this.lexer.token == start_token) {
                        try exprs.append(
                            this.allocator,
                            this.e(E.JSXElement{
                                .tag = this.e(tag_string, loc),
                                .children = ExprNodeList.fromList(children),
                            }, loc),
                        );
                        return;
                    }

                    if (this.lexer.js.has_newline_before or this.lexer.token == T.t_end_of_file or this.lexer.token == T.t_empty_line) {
                        try exprs.append(
                            this.e(
                                E.String{
                                    .utf8 = "*",
                                },
                                loc,
                            ),
                        );
                        try exprs.appendSlice(this.allocator, children.toOwnedSlice(this.allocator));
                        return;
                    }

                    try this.parseExpr(&children);
                }
            },

            T.t_underscore_2, T.t_star_2 => |start_token| {
                const loc = this.lexer.loc();
                const tag_string = E.JSXElement.Tag.map.get(.strong);
                // const indent = this.lexer.indent;
                try this.lexer.next();
                var children = std.ArrayListUnmanaged(Expr){};

                while (true) {
                    if (this.lexer.token == start_token) {
                        try exprs.append(
                            this.allocator,
                            this.e(E.JSXElement{
                                .tag = this.e(tag_string, loc),
                                .children = ExprNodeList.fromList(children),
                            }, loc),
                        );
                        return;
                    }

                    if (this.lexer.js.has_newline_before or this.lexer.token == T.t_end_of_file or this.lexer.token == T.t_empty_line) {
                        try exprs.append(
                            this.e(
                                E.String{
                                    .utf8 = "**",
                                },
                                loc,
                            ),
                        );
                        try exprs.appendSlice(this.allocator, children.toOwnedSlice(this.allocator));
                        return;
                    }

                    try this.parseExpr(&children);
                }
            },
            else => return,
        }
    }

    fn parseBlock(this: *MDX, exprs: *std.ArrayListUnmanaged(Expr)) anyerror!void {
        switch (this.lexer.token) {
            // ## foo
            //  ^
            T.t_hash, T.t_hash_2, T.t_hash_3, T.t_hash_4, T.t_hash_5, T.t_hash_6 => |hash| {
                const loc = this.lexer.loc();
                try this.lexer.next();
                const tag_type: E.JSXElement.Tag = switch (hash) {
                    T.t_hash => E.JSXElement.Tag.h1,
                    T.t_hash_2 => E.JSXElement.Tag.h2,
                    T.t_hash_3 => E.JSXElement.Tag.h3,
                    T.t_hash_4 => E.JSXElement.Tag.h4,
                    T.t_hash_5 => E.JSXElement.Tag.h5,
                    T.t_hash_6 => E.JSXElement.Tag.h6,
                };
                var children = std.ArrayListUnmanaged(Expr){};

                while (!(this.lexer.js.has_newline_before or switch (this.lexer.token) {
                    T.t_hash, T.t_hash_2, T.t_hash_3, T.t_hash_4, T.t_hash_5, T.t_hash_6, T.t_end_of_file, T.t_empty_line => true,
                    else => false,
                })) {
                    try this.parseExpr(&children);
                }

                // ## foo ##
                //        ^
                if (!this.lexer.js.has_newline_before and switch (this.lexer.token) {
                    T.t_hash, T.t_hash_2, T.t_hash_3, T.t_hash_4, T.t_hash_5, T.t_hash_6 => true,
                    else => false,
                }) {
                    try this.lexer.next();
                }

                const tag = this.e(E.JSXElement.Tag.map.get(tag_type), loc);
                try exprs.append(this.e(E.JSXElement{
                    .tag = tag,
                    .children = ExprNodeList.fromList(children),
                }, loc));
            },
            T.t_less_than => @panic("Not implemented yet"),
            T.t_js_block_open => {
                var opts = ParseStatementOptions{};
                this.stmts.appendSlice(try this.parser.parseStmtsUpTo(.t_close_brace, &opts));
                this.lexer.token = T.t_js_block_close;
                try this.lexer.next();
            },
            T.t_export, T.t_import => {
                var opts = ParseStatementOptions{ .is_module_scope = true };
                this.stmts.append(this.allocator, try this.parser.parseStmt(&opts));
            },
            T.t_end_of_file => {},
            else => try this.parseExpr(exprs),
        }
    }

    fn _parse(this: *MDX) !void {
        var root_children = std.ArrayListUnmanaged(Expr){};
        var first_loc = logger.Loc.Empty;
        while (true) {
            switch (this.lexer.token) {
                T.t_js_block_open => {
                    const stmts = try this.parser.parseStmtsUpTo(.t_close_brace, null);
                    this.stmts.appendSlice(this.allocator, stmts);
                    this.lexer.token = T.t_js_block_close;
                    try this.lexer.next();
                    continue;
                },
                T.t_export, T.t_import => this.parseBlock(undefined),
                T.t_end_of_file => break,
                else => {
                    try this.parseBlock(&root_children);
                    if (root_children.items.len > 0 and first_loc.start != -1) {
                        first_loc = root_children.items[0].loc;
                    }
                },
            }
        }

        const root = this.e(E.JSXElement{
            .tag = this.e(E.JSXElement.Tag.map.get(E.JSXElement.Tag.main), this.lexer.loc()),
            .children = ExprNodeList.fromList(root_children),
        }, first_loc);

        try this.stmts.append(
            this.allocator,
            this.s(S.ExportDefault{
                .default_name = try this.parser.createDefaultName(first_loc),
                .value = .{ .expr = root },
            }),
        );
    }
};
