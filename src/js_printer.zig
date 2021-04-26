const std = @import("std");
const logger = @import("logger.zig");
const js_lexer = @import("js_lexer.zig");
const importRecord = @import("import_record.zig");
const js_ast = @import("js_ast.zig");
const options = @import("options.zig");
const alloc = @import("alloc.zig");
const rename = @import("renamer.zig");

const fs = @import("fs.zig");
usingnamespace @import("strings.zig");
usingnamespace @import("ast/base.zig");
usingnamespace js_ast.G;

const expect = std.testing.expect;
const ImportKind = importRecord.ImportKind;
const BindingNodeIndex = js_ast.BindingNodeIndex;

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
const Ast = js_ast.Ast;

fn notimpl() void {
    std.debug.panic("Not implemented yet!", .{});
}

pub const SourceMapChunk = struct {
    buffer: MutableString,
    end_state: State = State{},
    final_generated_column: usize = 0,
    should_ignore: bool = false,

    // Coordinates in source maps are stored using relative offsets for size
    // reasons. When joining together chunks of a source map that were emitted
    // in parallel for different parts of a file, we need to fix up the first
    // segment of each chunk to be relative to the end of the previous chunk.
    pub const State = struct {
        // This isn't stored in the source map. It's only used by the bundler to join
        // source map chunks together correctly.
        generated_line: i32 = 0,

        // These are stored in the source map in VLQ format.
        generated_column: i32 = 0,
        source_index: i32 = 0,
        original_line: i32 = 0,
        original_column: i32 = 0,
    };
};

pub const Options = struct {
    to_module_ref: js_ast.Ref,
    indent: usize = 0,
    // If we're writing out a source map, this table of line start indices lets
    // us do binary search on to figure out what line a given AST node came from
    // line_offset_tables: []LineOffsetTable
};

pub const PrintResult = struct { js: string, source_map: ?SourceMapChunk = null };

const ExprFlag = enum {
    forbid_call,
    forbid_in,
    has_non_optional_chain_parent,
    expr_result_is_unused,
};

pub fn NewPrinter(comptime ascii_only: bool) type {
    // comptime const comptime_buf_len = 64;
    // comptime var comptime_buf = [comptime_buf_len]u8{};
    // comptime var comptime_buf_i: usize = 0;

    return struct {
        symbols: Symbol.Map,
        import_records: []importRecord.ImportRecord,

        js: MutableString,

        needs_semicolon: bool = false,
        stmt_start: i32 = -1,
        options: Options,
        export_default_start: i32 = -1,
        arrow_expr_start: i32 = -1,
        for_of_init_start: i32 = -1,
        prev_op: Op.Code = Op.Code.bin_add,
        prev_op_end: i32 = -1,
        prev_num_end: i32 = -1,
        prev_reg_exp_end: i32 = -1,
        call_target: ?Expr.Data = null,
        int_to_bytes_buffer: [64]u8 = [_]u8{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 },
        allocator: *std.mem.Allocator,

        const Printer = @This();
        pub fn comptime_flush(p: *Printer) void {}
        // pub fn comptime_flush(p: *Printer) callconv(.Inline) void {
        //     const result = comptime {
        //         if (comptime_buf_i > 0) {
        //             return comptime_buf[0..comptime_buf_i];
        //         } else {
        //             return "";
        //         }
        //     };

        //     if (result.len) {
        //         p.print(result);
        //         comptime {
        //             if (comptime_buf_i > 0) {
        //                 comptime_buf_i = 0;
        //                 while (comptime_buf_i < comptime_buf_i) {
        //                     comptime_buf[comptime_buf_i] = 0;
        //                     comptime_buf_i += 1;
        //                 }
        //                 comptime_buf_i = 0;
        //             }
        //         }
        //     }
        // }
        // pub fn comptime_print(p: *Printer, str: comptime []const u8) callconv(.Inline) void {
        //     comptime const needsFlush = (str.len + comptime_buf_i >= comptime_buf_len - 1);
        //     if (needsFlush) {
        //         p.comptime_flush();
        //     }

        //     comptime {
        //         if (str.len > 63) {
        //             @compileError("comptime_print buffer overflow");
        //             return;
        //         }
        //     }

        //     comptime {
        //         comptime str_i = 0;
        //         while (str_i < str.len) {
        //             comptime_buf[comptime_buf_i] = str[str_i];
        //             comptime_buf_i += 1;
        //             str_i += 1;
        //         }
        //     }
        // }

        pub fn print(p: *Printer, str: string) void {
            p.js.append(str) catch unreachable;
        }

        pub fn unsafePrint(p: *Printer, str: string) void {
            p.js.appendAssumeCapacity(str);
        }

        pub fn printIndent(p: *Printer) void {
            comptime_flush(p);

            if (p.options.indent == 0) {
                return;
            }

            p.js.growBy(p.options.indent * "  ".len) catch unreachable;
            while (p.options.indent > 0) {
                p.unsafePrint("  ");
                p.options.indent -= 1;
            }
        }

        pub fn printSpace(p: *Printer) void {
            p.print(" ");
        }
        pub fn printNewline(p: *Printer) void {
            notimpl();
        }
        pub fn printSemicolonAfterStatement(p: *Printer) void {
            p.print(";\n");
        }
        pub fn printSemicolonIfNeeded(p: *Printer) void {
            notimpl();
        }
        pub fn printSpaceBeforeIdentifier(p: *Printer) void {
            const n = p.js.len();
            if (n > 0 and (js_lexer.isIdentifierContinue(p.js.list.items[n - 1]) or n == p.prev_reg_exp_end)) {
                p.print(" ");
            }
        }
        pub fn printDotThenPrefix(p: *Printer) Level {
            return .lowest;
        }

        pub fn printUndefined(level: Level) void {
            notimpl();
        }

        pub fn printBody(stmt: Stmt) void {
            notimpl();
        }
        pub fn printBlock(loc: logger.Loc, stmts: []Stmt) void {
            notimpl();
        }
        pub fn printDecls(keyword: string, decls: []G.Decl, flags: ExprFlag) void {
            notimpl();
        }

        // noop for now
        pub fn addSourceMapping(p: *Printer, loc: logger.Loc) void {}

        pub fn printSymbol(p: *Printer, ref: Ref) void {
            notimpl();
        }
        pub fn printClauseAlias(p: *Printer, alias: string) void {
            notimpl();
        }
        pub fn printFunc(p: *Printer, func: G.Fn) void {
            notimpl();
        }
        pub fn printClass(p: *Printer, class: G.Class) void {
            notimpl();
        }
        pub fn printExpr(p: *Printer, expr: Expr, level: Level, flags: ExprFlag) void {
            p.addSourceMapping(expr.loc);

            switch (expr.data) {
                .e_missing => |e| {
                    notimpl();
                },
                .e_undefined => |e| {
                    notimpl();
                },
                .e_super => |e| {
                    notimpl();
                },
                .e_null => |e| {
                    notimpl();
                },
                .e_this => |e| {
                    notimpl();
                },
                .e_spread => |e| {
                    notimpl();
                },
                .e_new_target => |e| {
                    notimpl();
                },
                .e_import_meta => |e| {
                    notimpl();
                },
                .e_new => |e| {
                    notimpl();
                },
                .e_call => |e| {
                    notimpl();
                },
                .e_require => |e| {
                    notimpl();
                },
                .e_require_or_require_resolve => |e| {
                    notimpl();
                },
                .e_import => |e| {
                    notimpl();
                },
                .e_dot => |e| {
                    notimpl();
                },
                .e_index => |e| {
                    notimpl();
                },
                .e_if => |e| {
                    notimpl();
                },
                .e_arrow => |e| {
                    notimpl();
                },
                .e_function => |e| {
                    notimpl();
                },
                .e_class => |e| {
                    notimpl();
                },
                .e_array => |e| {
                    notimpl();
                },
                .e_object => |e| {
                    notimpl();
                },
                .e_boolean => |e| {
                    p.printSpaceBeforeIdentifier();
                    p.print(if (e.value) "true" else "false");
                },
                .e_string => |e| {
                    notimpl();
                },
                .e_template => |e| {
                    notimpl();
                },
                .e_reg_exp => |e| {
                    notimpl();
                },
                .e_big_int => |e| {
                    notimpl();
                },
                .e_number => |e| {
                    notimpl();
                },
                .e_identifier => |e| {
                    notimpl();
                },
                .e_import_identifier => |e| {
                    notimpl();
                },
                .e_await => |e| {
                    notimpl();
                },
                .e_yield => |e| {
                    notimpl();
                },
                .e_unary => |e| {
                    notimpl();
                },
                .e_binary => |e| {
                    notimpl();
                },
                else => {
                    std.debug.panic("Unexpected expression of type {s}", .{expr.data});
                },
            }
        }

        pub fn printProperty(p: *Printer, prop: G.Property) void {
            notimpl();
        }
        pub fn printBinding(p: *Printer, binding: Binding) void {
            notimpl();
        }
        pub fn printStmt(p: *Printer, stmt: Stmt) !void {
            p.comptime_flush();

            p.addSourceMapping(stmt.loc);

            switch (stmt.data) {
                .s_comment => |s| {
                    p.printIndentedComment(s.text);
                },
                .s_function => |s| {},
                .s_class => |s| {},
                .s_empty => |s| {},
                .s_export_default => |s| {},
                .s_export_star => |s| {},
                .s_export_clause => |s| {},
                .s_export_from => |s| {},
                .s_local => |s| {},
                .s_if => |s| {},
                .s_do_while => |s| {},
                .s_for_in => |s| {},
                .s_for_of => |s| {},
                .s_while => |s| {},
                .s_with => |s| {},
                .s_label => |s| {},
                .s_try => |s| {},
                .s_for => |s| {},
                .s_switch => |s| {},
                .s_import => |s| {},
                .s_block => |s| {},
                .s_debugger => |s| {},
                .s_directive => |s| {},
                .s_break => |s| {},
                .s_continue => |s| {},
                .s_return => |s| {},
                .s_throw => |s| {},
                .s_expr => |s| {
                    p.printIndent();
                    p.stmt_start = p.js.lenI();
                    p.printExpr(s.value, .lowest, .expr_result_is_unused);
                    p.printSemicolonAfterStatement();
                },
                else => {
                    std.debug.panic("Unexpected statement of type {s}", .{@TypeOf(stmt)});
                },
            }
        }

        pub fn printIndentedComment(p: *Printer, _text: string) void {
            var text = _text;
            if (strings.startsWith(text, "/*")) {
                // Re-indent multi-line comments
                while (strings.indexOfChar(text, '\n')) |newline_index| {
                    p.printIndent();
                    p.print(text[0 .. newline_index + 1]);
                    text = text[newline_index + 1 ..];
                }
                p.printIndent();
                p.print(text);
                p.printNewline();
            } else {
                // Print a mandatory newline after single-line comments
                p.printIndent();
                p.print(text);
                p.print("\n");
            }
        }

        pub fn init(allocator: *std.mem.Allocator, tree: Ast, symbols: Symbol.Map, opts: Options) !Printer {
            return Printer{
                .allocator = allocator,
                .import_records = tree.import_records,
                .options = opts,
                .symbols = symbols,
                .js = try MutableString.init(allocator, 1024),
            };
        }
    };
}

const UnicodePrinter = NewPrinter(false);
const AsciiPrinter = NewPrinter(true);

pub fn printAst(allocator: *std.mem.Allocator, tree: Ast, symbols: js_ast.Symbol.Map, ascii_only: bool, opts: Options) !PrintResult {
    if (ascii_only) {
        var printer = try AsciiPrinter.init(allocator, tree, symbols, opts);
        for (tree.parts) |part| {
            for (part.stmts) |stmt| {
                try printer.printStmt(stmt);
            }
        }

        return PrintResult{
            .js = printer.js.toOwnedSlice(),
        };
    } else {
        var printer = try UnicodePrinter.init(allocator, tree, symbols, opts);
        for (tree.parts) |part| {
            for (part.stmts) |stmt| {
                try printer.printStmt(stmt);
            }
        }

        return PrintResult{
            .js = printer.js.toOwnedSlice(),
        };
    }
}
