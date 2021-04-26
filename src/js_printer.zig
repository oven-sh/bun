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

const hex_chars = "0123456789ABCDEF";
const first_ascii = 0x20;
const last_ascii = 0x7E;
const first_high_surrogate: u21 = 0xD800;
const last_high_surrogate: u21 = 0xDBFF;
const first_low_surrogate: u21 = 0xDC00;
const last_low_surrogate: u21 = 0xDFFF;

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
        writer: MutableString.Writer,
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

        pub fn print(p: *Printer, str: anytype) void {
            switch (@TypeOf(str)) {
                comptime_int => {
                    p.js.appendChar(str) catch unreachable;
                },
                string => {
                    p.js.append(str) catch unreachable;
                },
                u8 => {
                    p.js.appendChar(str) catch unreachable;
                },
                u16 => {
                    p.js.appendChar(@intCast(u8, str)) catch unreachable;
                },
                u21 => {
                    p.js.appendChar(@intCast(u8, str)) catch unreachable;
                },
                else => {
                    p.js.append(@as(string, str)) catch unreachable;
                },
            }
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
        pub fn printSpaceBeforeIdentifier(
            p: *Printer,
        ) void {
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

        pub fn bestQuoteCharForString(p: *Printer, str: JavascriptString, allow_backtick: bool) u8 {
            var single_cost: usize = 0;
            var double_cost: usize = 0;
            var backtick_cost: usize = 0;
            var char: u8 = 0;
            var i: usize = 0;
            while (i < str.len) {
                switch (str[i]) {
                    '\'' => {
                        single_cost += 1;
                    },
                    '"' => {
                        double_cost += 1;
                    },
                    '`' => {
                        backtick_cost += 1;
                    },
                    '$' => {
                        if (i + 1 < str.len and str[i + 1] == '{') {
                            backtick_cost += 1;
                        }
                    },
                    else => {},
                }
                i += 1;
            }

            char = '"';
            if (double_cost > single_cost) {
                char = '\'';

                if (single_cost > backtick_cost and allow_backtick) {
                    char = '`';
                }
            } else if (double_cost > backtick_cost and allow_backtick) {
                char = '`';
            }

            return char;
        }

        pub fn printNonNegativeFloat(p: *Printer, float: f64) void {
            // cool thing about languages like this
            // i know this is going to be in the stack and not the heap
            var parts = [_]u8{ 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 };

            // normally, you pay the cost of parsing a string formatter at runtime
            // not in zig! CI pays for it instead
            // its probably still doing some unnecessary integer conversion somewhere though
            var slice = std.fmt.bufPrint(&parts, "{d}", .{float}) catch unreachable;
            p.js.list.appendSlice(p.allocator, slice) catch unreachable;
        }

        pub fn printQuotedUTF16(e: *Printer, text: JavascriptString, quote: u8) void {
            // utf-8 is a max of 4 bytes
            // we leave two extra chars for "\" and "u"
            var temp = [6]u8{ 0, 0, 0, 0, 0, 0 };
            var i: usize = 0;
            const n: usize = text.len;
            var r: u21 = 0;
            var c: u21 = 0;
            var width: u3 = 0;

            e.js.growIfNeeded(text.len) catch unreachable;

            while (i < n) {
                c = text[i];
                i += 1;

                // TODO: here
                switch (c) {
                    // Special-case the null character since it may mess with code written in C
                    // that treats null characters as the end of the string.
                    0x00 => {
                        // We don't want "\x001" to be written as "\01"
                        if (i < n and text[i] >= '0' and text[i] <= '9') {
                            e.print("\\x00");
                        } else {
                            e.print("\\0");
                        }
                    },

                    // Special-case the bell character since it may cause dumping this file to
                    // the terminal to make a sound, which is undesirable. Note that we can't
                    // use an octal literal to print this shorter since octal literals are not
                    // allowed in strict mode (or in template strings).
                    0x07 => {
                        e.print("\\x07");
                    },
                    0x08 => {
                        e.print("\\b");
                    },
                    0x0C => {
                        e.print("\\f");
                    },
                    '\n' => {
                        if (quote == '`') {
                            e.print("\n");
                        } else {
                            e.print("\\n");
                        }
                    },
                    std.ascii.control_code.CR => {
                        e.print("\\r");
                    },
                    // \v
                    std.ascii.control_code.VT => {
                        e.print("\\v");
                    },
                    // "\\"
                    92 => {
                        e.print("\\");
                    },
                    '\'' => {
                        if (quote == '\'') {
                            e.print("\\");
                        }
                        e.print("'");
                    },
                    '"' => {
                        if (quote == '"') {
                            e.print("\\");
                        }

                        e.print("\"");
                    },
                    '`' => {
                        if (quote == '`') {
                            e.print("\\");
                        }

                        e.print('`');
                    },
                    '$' => {
                        if (quote == '`' and i < n and text[i] == '{') {
                            e.print("\\");
                        }

                        e.print('$');
                    },
                    0x2028 => {
                        e.print("\\u2028");
                    },
                    0x2029 => {
                        e.print("\\u2029");
                    },
                    0xFEFF => {
                        e.print("\\uFEFF");
                    },
                    else => {
                        switch (c) {
                            // Common case: just append a single byte
                            // we know it's not 0 since we already checked
                            1...last_ascii => {
                                e.print(@intCast(u8, c));
                            },
                            first_high_surrogate...last_high_surrogate => {

                                // Is there a next character?

                                if (i < n) {
                                    const c2 = text[i];

                                    if (c2 >= first_high_surrogate and c2 <= last_low_surrogate) {
                                        // this is some magic to me
                                        r = (c << 10) + c2 + (0x10000 - (first_high_surrogate << 10) - first_low_surrogate);
                                        i += 1;
                                        // Escape this character if UTF-8 isn't allowed
                                        if (ascii_only) {
                                            // this is more magic!!
                                            const bytes = [_]u8{
                                                '\\', 'u', hex_chars[c >> 12],  hex_chars[(c >> 8) & 15],  hex_chars[(c >> 4) & 15],  hex_chars[c & 15],
                                                '\\', 'u', hex_chars[c2 >> 12], hex_chars[(c2 >> 8) & 15], hex_chars[(c2 >> 4) & 15], hex_chars[c2 & 15],
                                            };
                                            e.print(&bytes);

                                            continue;
                                            // Otherwise, encode to UTF-8
                                        } else {
                                            width = std.unicode.utf8Encode(r, &temp) catch unreachable;
                                            e.print(temp[0..width]);
                                            continue;
                                        }
                                    }
                                }

                                // Write an unpaired high surrogate
                                temp = [_]u8{ '\\', 'u', hex_chars[c >> 12], hex_chars[(c >> 8) & 15], hex_chars[(c >> 4) & 15], hex_chars[c & 15] };
                                e.print(&temp);
                            },
                            // Is this an unpaired low surrogate or four-digit hex escape?
                            first_low_surrogate...last_low_surrogate => {
                                // Write an unpaired high surrogate
                                temp = [_]u8{ '\\', 'u', hex_chars[c >> 12], hex_chars[(c >> 8) & 15], hex_chars[(c >> 4) & 15], hex_chars[c & 15] };
                                e.print(&temp);
                            },
                            else => {
                                // this extra branch should get compiled
                                if (ascii_only) {
                                    if (c > 0xFF) {
                                        // Write an unpaired high surrogate
                                        temp = [_]u8{ '\\', 'u', hex_chars[c >> 12], hex_chars[(c >> 8) & 15], hex_chars[(c >> 4) & 15], hex_chars[c & 15] };
                                        e.print(&temp);
                                    } else {
                                        // Can this be a two-digit hex escape?
                                        const quad = [_]u8{ '\\', 'x', hex_chars[c >> 4], hex_chars[c & 15] };
                                        e.print(&quad);
                                    }
                                } else {
                                    width = std.unicode.utf8Encode(c, &temp) catch unreachable;
                                    e.print(temp[0..width]);
                                }
                            },
                        }
                    },
                }
            }
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
                    // If this was originally a template literal, print it as one as long as we're not minifying
                    if (e.prefer_template) {
                        p.print("`");
                        p.printQuotedUTF16(e.value, '`');
                        p.print("`");
                        return;
                    }

                    const c = p.bestQuoteCharForString(e.value, true);
                    p.print(c);
                    p.printQuotedUTF16(e.value, c);
                    p.print(c);
                },
                .e_template => |e| {
                    notimpl();
                },
                .e_reg_exp => |e| {
                    notimpl();
                },
                .e_big_int => |e| {
                    p.printSpaceBeforeIdentifier();
                    p.print(e.value);
                    p.print('n');
                },
                .e_number => |e| {
                    const value = e.value;
                    const absValue = std.math.fabs(value);

                    if (std.math.isNan(value)) {
                        p.printSpaceBeforeIdentifier();
                        p.print("NaN");
                    } else if (std.math.isPositiveInf(value)) {
                        p.printSpaceBeforeIdentifier();
                        p.print("Infinity");
                    } else if (std.math.isNegativeInf(value)) {
                        if (level.gte(.prefix)) {
                            p.print("(-Infinity)");
                        } else {
                            p.printSpaceBeforeIdentifier();
                            p.print("(-Infinity)");
                        }
                    } else if (!std.math.signbit(value)) {
                        p.printSpaceBeforeIdentifier();
                        p.printNonNegativeFloat(absValue);

                        // Remember the end of the latest number
                        p.prev_num_end = p.js.lenI();
                    } else if (level.gte(.prefix)) {
                        // Expressions such as "(-1).toString" need to wrap negative numbers.
                        // Instead of testing for "value < 0" we test for "signbit(value)" and
                        // "!isNaN(value)" because we need this to be true for "-0" and "-0 < 0"
                        // is false.
                        p.print("(-");
                        p.printNonNegativeFloat(absValue);
                        p.print(")");
                    } else {
                        p.printSpaceBeforeOperator(Op.Code.un_neg);
                        p.print("-");
                        p.printNonNegativeFloat(absValue);

                        // Remember the end of the latest number
                        p.prev_num_end = p.js.lenI();
                    }
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

        pub fn printSpaceBeforeOperator(p: *Printer, next: Op.Code) void {
            if (p.prev_op_end == p.js.lenI()) {
                const prev = p.prev_op;
                // "+ + y" => "+ +y"
                // "+ ++ y" => "+ ++y"
                // "x + + y" => "x+ +y"
                // "x ++ + y" => "x+++y"
                // "x + ++ y" => "x+ ++y"
                // "-- >" => "-- >"
                // "< ! --" => "<! --"
                if (((prev == Op.Code.bin_add or prev == Op.Code.un_pos) and (next == Op.Code.bin_add or next == Op.Code.un_pos or next == Op.Code.un_pre_inc)) or
                    ((prev == Op.Code.bin_sub or prev == Op.Code.un_neg) and (next == Op.Code.bin_sub or next == Op.Code.un_neg or next == Op.Code.un_pre_dec)) or
                    (prev == Op.Code.un_post_dec and next == Op.Code.bin_gt) or
                    (prev == Op.Code.un_not and next == Op.Code.un_pre_dec and p.js.len() > 1 and p.js.list.items[p.js.list.items.len - 2] == '<'))
                {
                    p.print(" ");
                }
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
            var js = try MutableString.init(allocator, 1024);
            return Printer{
                .allocator = allocator,
                .import_records = tree.import_records,
                .options = opts,
                .symbols = symbols,
                .js = js,
                .writer = js.writer(),
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
