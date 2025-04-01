const std = @import("std");
const logger = bun.logger;
const js_lexer = bun.js_lexer;
const importRecord = @import("import_record.zig");
const js_ast = bun.JSAst;
const options = @import("options.zig");
const rename = @import("renamer.zig");
const runtime = @import("runtime.zig");
const Lock = bun.Mutex;
const Api = @import("./api/schema.zig").Api;
const fs = @import("fs.zig");
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
const Ref = @import("ast/base.zig").Ref;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const FeatureFlags = bun.FeatureFlags;
const FileDescriptorType = bun.FileDescriptor;

const expect = std.testing.expect;
const ImportKind = importRecord.ImportKind;
const BindingNodeIndex = js_ast.BindingNodeIndex;

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
const first_high_surrogate = 0xD800;
const last_high_surrogate = 0xDBFF;
const first_low_surrogate = 0xDC00;
const last_low_surrogate = 0xDFFF;
const CodepointIterator = @import("./string_immutable.zig").UnsignedCodepointIterator;
const assert = bun.assert;

const ImportRecord = bun.ImportRecord;
const SourceMap = @import("./sourcemap/sourcemap.zig");

/// For support JavaScriptCore
const ascii_only_always_on_unless_minifying = true;

fn formatUnsignedIntegerBetween(comptime len: u16, buf: *[len]u8, val: u64) void {
    comptime var i: u16 = len;
    var remainder = val;

    // Write out the number from the end to the front
    inline while (i > 0) {
        comptime i -= 1;
        buf[comptime i] = @as(u8, @intCast((remainder % 10))) + '0';
        remainder /= 10;
    }
}

pub fn writeModuleId(comptime Writer: type, writer: Writer, module_id: u32) void {
    bun.assert(module_id != 0); // either module_id is forgotten or it should be disabled
    _ = writer.writeAll("$") catch unreachable;
    std.fmt.formatInt(module_id, 16, .lower, .{}, writer) catch unreachable;
}

pub fn canPrintWithoutEscape(comptime CodePointType: type, c: CodePointType, comptime ascii_only: bool) bool {
    if (c <= last_ascii) {
        return c >= first_ascii and c != '\\' and c != '"' and c != '\'' and c != '`' and c != '$';
    } else {
        return !ascii_only and c != 0xFEFF and c != 0x2028 and c != 0x2029 and (c < first_high_surrogate or c > last_low_surrogate);
    }
}

const indentation_space_buf = [_]u8{' '} ** 128;
const indentation_tab_buf = [_]u8{'\t'} ** 128;

pub fn bestQuoteCharForString(comptime Type: type, str: []const Type, allow_backtick: bool) u8 {
    var single_cost: usize = 0;
    var double_cost: usize = 0;
    var backtick_cost: usize = 0;
    var i: usize = 0;
    while (i < @min(str.len, 1024)) {
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
            '\n' => {
                single_cost += 1;
                double_cost += 1;
            },
            '\\' => {
                i += 1;
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

    if (allow_backtick and backtick_cost < @min(single_cost, double_cost)) {
        return '`';
    }
    if (single_cost < double_cost) {
        return '\'';
    }
    return '"';
}

const Whitespacer = struct {
    normal: []const u8,
    minify: []const u8,

    pub fn append(this: Whitespacer, comptime str: []const u8) Whitespacer {
        return .{ .normal = this.normal ++ str, .minify = this.minify ++ str };
    }
};

fn ws(comptime str: []const u8) Whitespacer {
    const Static = struct {
        pub const with = str;

        pub const without = brk: {
            var buf = std.mem.zeroes([str.len]u8);
            var buf_i: usize = 0;
            for (str) |c| {
                if (c != ' ') {
                    buf[buf_i] = c;
                    buf_i += 1;
                }
            }
            const final = buf[0..buf_i].*;
            break :brk &final;
        };
    };

    return .{ .normal = Static.with, .minify = Static.without };
}

pub fn estimateLengthForUTF8(input: []const u8, comptime ascii_only: bool, comptime quote_char: u8) usize {
    var remaining = input;
    var len: usize = 2; // for quotes

    while (strings.indexOfNeedsEscape(remaining, quote_char)) |i| {
        len += i;
        remaining = remaining[i..];
        const char_len = strings.wtf8ByteSequenceLengthWithInvalid(remaining[0]);
        const c = strings.decodeWTF8RuneT(
            &switch (char_len) {
                // 0 is not returned by `wtf8ByteSequenceLengthWithInvalid`
                1 => .{ remaining[0], 0, 0, 0 },
                2 => remaining[0..2].* ++ .{ 0, 0 },
                3 => remaining[0..3].* ++ .{0},
                4 => remaining[0..4].*,
                else => unreachable,
            },
            char_len,
            i32,
            0,
        );
        if (canPrintWithoutEscape(i32, c, ascii_only)) {
            len += @as(usize, char_len);
        } else if (c <= 0xFFFF) {
            len += 6;
        } else {
            len += 12;
        }
        remaining = remaining[char_len..];
    } else {
        return remaining.len + 2;
    }

    return len;
}

pub fn quoteForJSON(text: []const u8, output_: MutableString, comptime ascii_only: bool) !MutableString {
    var bytes = output_;
    try quoteForJSONBuffer(text, &bytes, ascii_only);
    return bytes;
}

pub fn writePreQuotedString(text_in: []const u8, comptime Writer: type, writer: Writer, comptime quote_char: u8, comptime ascii_only: bool, comptime json: bool, comptime encoding: strings.Encoding) !void {
    const text = if (comptime encoding == .utf16) @as([]const u16, @alignCast(std.mem.bytesAsSlice(u16, text_in))) else text_in;
    if (comptime json and quote_char != '"') @compileError("for json, quote_char must be '\"'");
    var i: usize = 0;
    const n: usize = text.len;
    while (i < n) {
        const width = switch (comptime encoding) {
            .latin1, .ascii => 1,
            .utf8 => strings.wtf8ByteSequenceLengthWithInvalid(text[i]),
            .utf16 => 1,
        };
        const clamped_width = @min(@as(usize, width), n -| i);
        const c = switch (encoding) {
            .utf8 => strings.decodeWTF8RuneT(
                &switch (clamped_width) {
                    // 0 is not returned by `wtf8ByteSequenceLengthWithInvalid`
                    1 => .{ text[i], 0, 0, 0 },
                    2 => text[i..][0..2].* ++ .{ 0, 0 },
                    3 => text[i..][0..3].* ++ .{0},
                    4 => text[i..][0..4].*,
                    else => unreachable,
                },
                width,
                i32,
                0,
            ),
            .ascii => brk: {
                std.debug.assert(text[i] <= 0x7F);
                break :brk text[i];
            },
            .latin1 => brk: {
                if (text[i] <= 0x7F) break :brk text[i];
                break :brk strings.latin1ToCodepointAssumeNotASCII(text[i], i32);
            },
            .utf16 => brk: {
                // TODO: if this is a part of a surrogate pair, we could parse the whole codepoint in order
                // to emit it as a single \u{result} rather than two paired \uLOW\uHIGH.
                // eg: "\u{10334}" will convert to "\uD800\uDF34" without this.
                break :brk @as(i32, text[i]);
            },
        };
        if (canPrintWithoutEscape(i32, c, ascii_only)) {
            const remain = text[i + clamped_width ..];

            switch (encoding) {
                .ascii, .utf8 => {
                    if (strings.indexOfNeedsEscape(remain, quote_char)) |j| {
                        const text_chunk = text[i .. i + clamped_width];
                        try writer.writeAll(text_chunk);
                        i += clamped_width;
                        try writer.writeAll(remain[0..j]);
                        i += j;
                    } else {
                        try writer.writeAll(text[i..]);
                        i = n;
                        break;
                    }
                },
                .latin1, .utf16 => {
                    var codepoint_bytes: [4]u8 = undefined;
                    const codepoint_len = strings.encodeWTF8Rune(codepoint_bytes[0..4], c);
                    try writer.writeAll(codepoint_bytes[0..codepoint_len]);
                    i += clamped_width;
                },
            }
            continue;
        }
        switch (c) {
            0x07 => {
                try writer.writeAll("\\x07");
                i += 1;
            },
            0x08 => {
                try writer.writeAll("\\b");
                i += 1;
            },
            0x0C => {
                try writer.writeAll("\\f");
                i += 1;
            },
            '\n' => {
                if (quote_char == '`') {
                    try writer.writeAll("\n");
                } else {
                    try writer.writeAll("\\n");
                }
                i += 1;
            },
            std.ascii.control_code.cr => {
                try writer.writeAll("\\r");
                i += 1;
            },
            // \v
            std.ascii.control_code.vt => {
                try writer.writeAll("\\v");
                i += 1;
            },
            // "\\"
            '\\' => {
                try writer.writeAll("\\\\");
                i += 1;
            },
            '"' => {
                if (quote_char == '"') {
                    try writer.writeAll("\\\"");
                } else {
                    try writer.writeAll("\"");
                }
                i += 1;
            },
            '\'' => {
                if (quote_char == '\'') {
                    try writer.writeAll("\\'");
                } else {
                    try writer.writeAll("'");
                }
                i += 1;
            },
            '`' => {
                if (quote_char == '`') {
                    try writer.writeAll("\\`");
                } else {
                    try writer.writeAll("`");
                }
                i += 1;
            },
            '$' => {
                if (quote_char == '`') {
                    const remain = text[i + clamped_width ..];
                    if (remain.len > 0 and remain[0] == '{') {
                        try writer.writeAll("\\$");
                    } else {
                        try writer.writeAll("$");
                    }
                } else {
                    try writer.writeAll("$");
                }
                i += 1;
            },

            '\t' => {
                if (quote_char == '`') {
                    try writer.writeAll("\t");
                } else {
                    try writer.writeAll("\\t");
                }
                i += 1;
            },

            else => {
                i += @as(usize, width);

                if (c <= 0xFF and !json) {
                    const k = @as(usize, @intCast(c));

                    try writer.writeAll(&[_]u8{
                        '\\',
                        'x',
                        hex_chars[(k >> 4) & 0xF],
                        hex_chars[k & 0xF],
                    });
                } else if (c <= 0xFFFF) {
                    const k = @as(usize, @intCast(c));

                    try writer.writeAll(&[_]u8{
                        '\\',
                        'u',
                        hex_chars[(k >> 12) & 0xF],
                        hex_chars[(k >> 8) & 0xF],
                        hex_chars[(k >> 4) & 0xF],
                        hex_chars[k & 0xF],
                    });
                } else {
                    const k = c - 0x10000;
                    const lo = @as(usize, @intCast(first_high_surrogate + ((k >> 10) & 0x3FF)));
                    const hi = @as(usize, @intCast(first_low_surrogate + (k & 0x3FF)));

                    try writer.writeAll(&[_]u8{
                        '\\',
                        'u',
                        hex_chars[lo >> 12],
                        hex_chars[(lo >> 8) & 15],
                        hex_chars[(lo >> 4) & 15],
                        hex_chars[lo & 15],
                        '\\',
                        'u',
                        hex_chars[hi >> 12],
                        hex_chars[(hi >> 8) & 15],
                        hex_chars[(hi >> 4) & 15],
                        hex_chars[hi & 15],
                    });
                }
            },
        }
    }
}
pub fn quoteForJSONBuffer(text: []const u8, bytes: *MutableString, comptime ascii_only: bool) !void {
    const writer = bytes.writer();

    try bytes.growIfNeeded(estimateLengthForUTF8(text, ascii_only, '"'));
    try bytes.appendChar('"');
    try writePreQuotedString(text, @TypeOf(writer), writer, '"', ascii_only, true, .utf8);
    bytes.appendChar('"') catch unreachable;
}

pub fn writeJSONString(input: []const u8, comptime Writer: type, writer: Writer, comptime encoding: strings.Encoding) !void {
    try writer.writeAll("\"");
    try writePreQuotedString(input, Writer, writer, '"', false, true, encoding);
    try writer.writeAll("\"");
}

pub const SourceMapHandler = struct {
    ctx: *anyopaque,
    callback: Callback,

    const Callback = *const fn (*anyopaque, chunk: SourceMap.Chunk, source: logger.Source) anyerror!void;
    pub fn onSourceMapChunk(self: *const @This(), chunk: SourceMap.Chunk, source: logger.Source) anyerror!void {
        try self.callback(self.ctx, chunk, source);
    }

    pub fn For(comptime Type: type, comptime handler: (fn (t: *Type, chunk: SourceMap.Chunk, source: logger.Source) anyerror!void)) type {
        return struct {
            pub fn onChunk(self: *anyopaque, chunk: SourceMap.Chunk, source: logger.Source) anyerror!void {
                try handler(@as(*Type, @ptrCast(@alignCast(self))), chunk, source);
            }

            pub fn init(self: *Type) SourceMapHandler {
                return SourceMapHandler{ .ctx = self, .callback = onChunk };
            }
        };
    }
};

pub const Options = struct {
    bundling: bool = false,
    transform_imports: bool = true,
    to_commonjs_ref: Ref = Ref.None,
    to_esm_ref: Ref = Ref.None,
    require_ref: ?Ref = null,
    import_meta_ref: Ref = Ref.None,
    hmr_ref: Ref = Ref.None,
    indent: Indentation = .{},
    runtime_imports: runtime.Runtime.Imports = runtime.Runtime.Imports{},
    module_hash: u32 = 0,
    source_path: ?fs.Path = null,
    allocator: std.mem.Allocator = default_allocator,
    source_map_allocator: ?std.mem.Allocator = null,
    source_map_handler: ?SourceMapHandler = null,
    source_map_builder: ?*bun.sourcemap.Chunk.Builder = null,
    css_import_behavior: Api.CssInJsBehavior = Api.CssInJsBehavior.facade,
    target: options.Target = .browser,

    runtime_transpiler_cache: ?*bun.JSC.RuntimeTranspilerCache = null,
    input_files_for_dev_server: ?[]logger.Source = null,

    commonjs_named_exports: js_ast.Ast.CommonJSNamedExports = .{},
    commonjs_named_exports_deoptimized: bool = false,
    commonjs_module_exports_assigned_deoptimized: bool = false,
    commonjs_named_exports_ref: Ref = Ref.None,
    commonjs_module_ref: Ref = Ref.None,

    minify_whitespace: bool = false,
    minify_identifiers: bool = false,
    minify_syntax: bool = false,
    print_dce_annotations: bool = true,

    transform_only: bool = false,
    inline_require_and_import_errors: bool = true,
    has_run_symbol_renamer: bool = false,

    require_or_import_meta_for_source_callback: RequireOrImportMeta.Callback = .{},

    module_type: options.Format = .esm,

    // /// Used for cross-module inlining of import items when bundling
    // const_values: Ast.ConstValuesMap = .{},
    ts_enums: Ast.TsEnumsMap = .{},

    // If we're writing out a source map, this table of line start indices lets
    // us do binary search on to figure out what line a given AST node came from
    line_offset_tables: ?SourceMap.LineOffsetTable.List = null,

    mangled_props: ?*const bun.bundle_v2.MangledProps,

    // Default indentation is 2 spaces
    pub const Indentation = struct {
        scalar: usize = 2,
        count: usize = 0,
        character: Character = .space,

        pub const Character = enum { tab, space };
    };

    pub fn requireOrImportMetaForSource(
        self: *const Options,
        id: u32,
        was_unwrapped_require: bool,
    ) RequireOrImportMeta {
        if (self.require_or_import_meta_for_source_callback.ctx == null)
            return .{};

        return self.require_or_import_meta_for_source_callback.call(id, was_unwrapped_require);
    }
};

pub const RequireOrImportMeta = struct {
    // CommonJS files will return the "require_*" wrapper function and an invalid
    // exports object reference. Lazily-initialized ESM files will return the
    // "init_*" wrapper function and the exports object for that file.
    wrapper_ref: Ref = Ref.None,
    exports_ref: Ref = Ref.None,
    is_wrapper_async: bool = false,
    was_unwrapped_require: bool = false,

    pub const Callback = struct {
        const Fn = fn (*anyopaque, u32, bool) RequireOrImportMeta;

        ctx: ?*anyopaque = null,
        callback: *const Fn = undefined,

        pub fn call(self: Callback, id: u32, was_unwrapped_require: bool) RequireOrImportMeta {
            return self.callback(self.ctx.?, id, was_unwrapped_require);
        }

        pub fn init(
            comptime Type: type,
            comptime callback: (fn (t: *Type, id: u32, was_unwrapped_require: bool) RequireOrImportMeta),
            ctx: *Type,
        ) Callback {
            return Callback{
                .ctx = bun.cast(*anyopaque, ctx),
                .callback = @as(*const Fn, @ptrCast(&callback)),
            };
        }
    };
};

pub const PrintResult = union(enum) {
    result: struct {
        code: []u8,
        source_map: ?SourceMap.Chunk = null,
    },
    err: anyerror,

    pub fn clone(
        this: PrintResult,
        allocator: std.mem.Allocator,
    ) !PrintResult {
        return switch (this) {
            .result => PrintResult{
                .result = .{
                    .code = try allocator.dupe(u8, this.result.code),
                    .source_map = this.result.source_map,
                },
            },
            .err => PrintResult{
                .err = this.err,
            },
        };
    }
};

// do not make this a packed struct
// stage1 compiler bug:
// > /optional-chain-with-function.js: Evaluation failed: TypeError: (intermediate value) is not a function
// this test failure was caused by the packed struct implementation
const ExprFlag = enum {
    forbid_call,
    forbid_in,
    has_non_optional_chain_parent,
    expr_result_is_unused,
    pub const Set = std.enums.EnumSet(ExprFlag);

    pub fn None() ExprFlag.Set {
        return Set{};
    }

    pub fn ForbidCall() ExprFlag.Set {
        return Set.init(.{ .forbid_call = true });
    }

    pub fn ForbidAnd() ExprFlag.Set {
        return Set.init(.{ .forbid_and = true });
    }

    pub fn HasNonOptionalChainParent() ExprFlag.Set {
        return Set.init(.{ .has_non_optional_chain_parent = true });
    }

    pub fn ExprResultIsUnused() ExprFlag.Set {
        return Set.init(.{ .expr_result_is_unused = true });
    }
};

const ImportVariant = enum {
    path_only,
    import_star,
    import_default,
    import_star_and_import_default,
    import_items,
    import_items_and_default,
    import_items_and_star,
    import_items_and_default_and_star,

    pub inline fn hasItems(import_variant: @This()) @This() {
        return switch (import_variant) {
            .import_default => .import_items_and_default,
            .import_star => .import_items_and_star,
            .import_star_and_import_default => .import_items_and_default_and_star,
            else => .import_items,
        };
    }

    // We always check star first so don't need to be exhaustive here
    pub inline fn hasStar(import_variant: @This()) @This() {
        return switch (import_variant) {
            .path_only => .import_star,
            else => import_variant,
        };
    }

    // We check default after star
    pub inline fn hasDefault(import_variant: @This()) @This() {
        return switch (import_variant) {
            .path_only => .import_default,
            .import_star => .import_star_and_import_default,
            else => import_variant,
        };
    }

    pub fn determine(record: *const ImportRecord, s_import: *const S.Import) ImportVariant {
        var variant = ImportVariant.path_only;

        if (record.contains_import_star) {
            variant = variant.hasStar();
        }

        if (!record.was_originally_bare_import) {
            if (!record.contains_default_alias) {
                if (s_import.default_name) |default_name| {
                    if (default_name.ref != null) {
                        variant = variant.hasDefault();
                    }
                }
            } else {
                variant = variant.hasDefault();
            }
        }

        if (s_import.items.len > 0) {
            variant = variant.hasItems();
        }

        return variant;
    }
};

fn NewPrinter(
    comptime ascii_only: bool,
    comptime Writer: type,
    comptime rewrite_esm_to_cjs: bool,
    comptime is_bun_platform: bool,
    comptime is_json: bool,
    comptime generate_source_map: bool,
) type {
    return struct {
        import_records: []const ImportRecord,

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
        writer: Writer,

        has_printed_bundled_import_statement: bool = false,

        renamer: rename.Renamer,
        prev_stmt_tag: Stmt.Tag = .s_empty,
        source_map_builder: SourceMap.Chunk.Builder = undefined,

        symbol_counter: u32 = 0,

        temporary_bindings: std.ArrayListUnmanaged(B.Property) = .{},

        binary_expression_stack: std.ArrayList(BinaryExpressionVisitor) = undefined,

        was_lazy_export: bool = false,

        const Printer = @This();

        /// When Printer is used as a io.Writer, this represents it's error type, aka nothing.
        pub const Error = error{};

        /// The handling of binary expressions is convoluted because we're using
        /// iteration on the heap instead of recursion on the call stack to avoid
        /// stack overflow for deeply-nested ASTs. See the comments for the similar
        /// code in the JavaScript parser for details.
        pub const BinaryExpressionVisitor = struct {
            // Inputs
            e: *E.Binary,
            level: Level = .lowest,
            flags: ExprFlag.Set = ExprFlag.None(),

            // Input for visiting the left child
            left_level: Level = .lowest,
            left_flags: ExprFlag.Set = ExprFlag.None(),

            // "Local variables" passed from "checkAndPrepare" to "visitRightAndFinish"
            entry: *const Op = undefined,
            wrap: bool = false,
            right_level: Level = .lowest,

            pub fn checkAndPrepare(v: *BinaryExpressionVisitor, p: *Printer) bool {
                var e = v.e;

                const entry: *const Op = Op.Table.getPtrConst(e.op);
                const e_level = entry.level;
                v.entry = entry;
                v.wrap = v.level.gte(e_level) or (e.op == Op.Code.bin_in and v.flags.contains(.forbid_in));

                // Destructuring assignments must be parenthesized
                const n = p.writer.written;
                if (n == p.stmt_start or n == p.arrow_expr_start) {
                    switch (e.left.data) {
                        .e_object => {
                            v.wrap = true;
                        },
                        else => {},
                    }
                }

                if (v.wrap) {
                    p.print("(");
                    v.flags.insert(.forbid_in);
                }

                v.left_level = e_level.sub(1);
                v.right_level = e_level.sub(1);
                const left_level = &v.left_level;
                const right_level = &v.right_level;

                if (e.op.isRightAssociative()) {
                    left_level.* = e_level;
                }

                if (e.op.isLeftAssociative()) {
                    right_level.* = e_level;
                }

                switch (e.op) {
                    // "??" can't directly contain "||" or "&&" without being wrapped in parentheses
                    .bin_nullish_coalescing => {
                        switch (e.left.data) {
                            .e_binary => {
                                const left = e.left.data.e_binary;
                                switch (left.op) {
                                    .bin_logical_and, .bin_logical_or => {
                                        left_level.* = .prefix;
                                    },
                                    else => {},
                                }
                            },
                            else => {},
                        }

                        switch (e.right.data) {
                            .e_binary => {
                                const right = e.right.data.e_binary;
                                switch (right.op) {
                                    .bin_logical_and, .bin_logical_or => {
                                        right_level.* = .prefix;
                                    },
                                    else => {},
                                }
                            },
                            else => {},
                        }
                    },
                    // "**" can't contain certain unary expressions
                    .bin_pow => {
                        switch (e.left.data) {
                            .e_unary => {
                                const left = e.left.data.e_unary;
                                if (left.op.unaryAssignTarget() == .none) {
                                    left_level.* = .call;
                                }
                            },
                            .e_await, .e_undefined, .e_number => {
                                left_level.* = .call;
                            },
                            .e_boolean => {
                                // When minifying, booleans are printed as "!0 and "!1"
                                if (p.options.minify_syntax) {
                                    left_level.* = .call;
                                }
                            },
                            else => {},
                        }
                    },
                    else => {},
                }

                // Special-case "#foo in bar"
                if (e.left.data == .e_private_identifier and e.op == .bin_in) {
                    const private = e.left.data.e_private_identifier;
                    const name = p.renamer.nameForSymbol(private.ref);
                    p.addSourceMappingForName(e.left.loc, name, private.ref);
                    p.printIdentifier(name);
                    v.visitRightAndFinish(p);
                    return false;
                }

                v.left_flags = ExprFlag.Set{};

                if (v.flags.contains(.forbid_in)) {
                    v.left_flags.insert(.forbid_in);
                }

                if (e.op == .bin_comma)
                    v.left_flags.insert(.expr_result_is_unused);

                return true;
            }
            pub fn visitRightAndFinish(v: *BinaryExpressionVisitor, p: *Printer) void {
                const e = v.e;
                const entry = v.entry;
                var flags = ExprFlag.Set{};

                if (e.op != .bin_comma) {
                    p.printSpace();
                }

                if (entry.is_keyword) {
                    p.printSpaceBeforeIdentifier();
                    p.print(entry.text);
                } else {
                    p.printSpaceBeforeOperator(e.op);
                    p.print(entry.text);
                    p.prev_op = e.op;
                    p.prev_op_end = p.writer.written;
                }

                p.printSpace();

                // The result of the right operand of the comma operator is unused if the caller doesn't use it
                if (e.op == .bin_comma and v.flags.contains(.expr_result_is_unused)) {
                    flags.insert(.expr_result_is_unused);
                }

                if (v.flags.contains(.forbid_in)) {
                    flags.insert(.forbid_in);
                }

                p.printExpr(e.right, v.right_level, flags);

                if (v.wrap) {
                    p.print(")");
                }
            }
        };

        pub fn writeAll(p: *Printer, bytes: anytype) anyerror!void {
            p.print(bytes);
        }

        pub fn writeByteNTimes(self: *Printer, byte: u8, n: usize) !void {
            var bytes: [256]u8 = undefined;
            @memset(bytes[0..], byte);

            var remaining: usize = n;
            while (remaining > 0) {
                const to_write = @min(remaining, bytes.len);
                try self.writeAll(bytes[0..to_write]);
                remaining -= to_write;
            }
        }

        pub fn writeBytesNTimes(self: *Printer, bytes: []const u8, n: usize) anyerror!void {
            var i: usize = 0;
            while (i < n) : (i += 1) {
                try self.writeAll(bytes);
            }
        }

        fn fmt(p: *Printer, comptime str: string, args: anytype) !void {
            const len = @call(
                .always_inline,
                std.fmt.count,
                .{ str, args },
            );
            var ptr = try p.writer.reserve(len);

            const written = @call(
                .always_inline,
                std.fmt.bufPrint,
                .{ ptr[0..len], str, args },
            ) catch unreachable;

            p.writer.advance(written.len);
        }

        pub fn printBuffer(p: *Printer, str: []const u8) void {
            p.writer.print([]const u8, str);
        }

        pub fn print(p: *Printer, str: anytype) void {
            const StringType = @TypeOf(str);
            switch (comptime StringType) {
                comptime_int, u16, u8 => {
                    p.writer.print(StringType, str);
                },
                [6]u8 => {
                    const span = str[0..6];
                    p.writer.print(@TypeOf(span), span);
                },
                else => {
                    p.writer.print(StringType, str);
                },
            }
        }

        pub inline fn unindent(p: *Printer) void {
            p.options.indent.count -|= 1;
        }

        pub inline fn indent(p: *Printer) void {
            p.options.indent.count += 1;
        }

        pub fn printIndent(p: *Printer) void {
            if (p.options.indent.count == 0 or p.options.minify_whitespace) {
                return;
            }

            const indentation_buf = switch (p.options.indent.character) {
                .space => indentation_space_buf,
                .tab => indentation_tab_buf,
            };

            var i: usize = p.options.indent.count * p.options.indent.scalar;

            while (i > 0) {
                const amt = @min(i, indentation_buf.len);
                p.print(indentation_buf[0..amt]);
                i -= amt;
            }
        }

        pub fn mangledPropName(p: *Printer, _ref: Ref) string {
            const ref = p.symbols().follow(_ref);
            // TODO: we don't support that
            if (p.options.mangled_props != null) {
                if (p.options.mangled_props.?.get(ref)) |name| return name;
            }
            return p.renamer.nameForSymbol(ref);
        }

        pub inline fn printSpace(p: *Printer) void {
            if (!p.options.minify_whitespace)
                p.print(" ");
        }
        pub inline fn printNewline(p: *Printer) void {
            if (!p.options.minify_whitespace)
                p.print("\n");
        }
        pub inline fn printSemicolonAfterStatement(p: *Printer) void {
            if (!p.options.minify_whitespace) {
                p.print(";\n");
            } else {
                p.needs_semicolon = true;
            }
        }
        pub fn printSemicolonIfNeeded(p: *Printer) void {
            if (p.needs_semicolon) {
                p.print(";");
                p.needs_semicolon = false;
            }
        }

        fn @"print = "(p: *Printer) void {
            if (p.options.minify_whitespace) {
                p.print("=");
            } else {
                p.print(" = ");
            }
        }

        fn printBunJestImportStatement(p: *Printer, import: S.Import) void {
            comptime bun.assert(is_bun_platform);

            switch (p.options.module_type) {
                .cjs => {
                    printInternalBunImport(p, import, @TypeOf("globalThis.Bun.jest(__filename)"), "globalThis.Bun.jest(__filename)");
                },
                else => {
                    printInternalBunImport(p, import, @TypeOf("globalThis.Bun.jest(import.meta.path)"), "globalThis.Bun.jest(import.meta.path)");
                },
            }
        }

        fn printGlobalBunImportStatement(p: *Printer, import: S.Import) void {
            if (comptime !is_bun_platform) unreachable;
            printInternalBunImport(p, import, @TypeOf("globalThis.Bun"), "globalThis.Bun");
        }

        fn printInternalBunImport(p: *Printer, import: S.Import, comptime Statement: type, statement: Statement) void {
            if (comptime !is_bun_platform) unreachable;

            if (import.star_name_loc != null) {
                p.print("var ");
                p.printSymbol(import.namespace_ref);
                p.printSpace();
                p.print("=");
                p.printSpaceBeforeIdentifier();
                if (comptime Statement == void) {
                    p.printRequireOrImportExpr(
                        import.import_record_index,
                        false,
                        &.{},
                        Expr.empty,
                        Level.lowest,
                        ExprFlag.None(),
                    );
                } else {
                    p.print(statement);
                }

                p.printSemicolonAfterStatement();
                p.printIndent();
            }

            if (import.default_name) |default| {
                p.print("var ");
                p.printSymbol(default.ref.?);
                if (comptime Statement == void) {
                    p.@"print = "();
                    p.printRequireOrImportExpr(
                        import.import_record_index,
                        false,
                        &.{},
                        Expr.empty,
                        Level.lowest,
                        ExprFlag.None(),
                    );
                } else {
                    p.@"print = "();
                    p.print(statement);
                }
                p.printSemicolonAfterStatement();
            }

            if (import.items.len > 0) {
                p.printWhitespacer(ws("var {"));

                if (!import.is_single_line) {
                    p.printNewline();
                    p.indent();
                    p.printIndent();
                }

                for (import.items, 0..) |item, i| {
                    if (i > 0) {
                        p.print(",");
                        p.printSpace();

                        if (!import.is_single_line) {
                            p.printNewline();
                            p.printIndent();
                        }
                    }

                    p.printClauseItemAs(item, .@"var");
                }

                if (!import.is_single_line) {
                    p.printNewline();
                    p.unindent();
                } else {
                    p.printSpace();
                }

                p.printWhitespacer(ws("} = "));

                if (import.star_name_loc == null and import.default_name == null) {
                    if (comptime Statement == void) {
                        p.printRequireOrImportExpr(import.import_record_index, false, &.{}, Expr.empty, Level.lowest, ExprFlag.None());
                    } else {
                        p.print(statement);
                    }
                } else if (import.default_name) |name| {
                    p.printSymbol(name.ref.?);
                } else {
                    p.printSymbol(import.namespace_ref);
                }

                p.printSemicolonAfterStatement();
            }
        }

        pub inline fn printSpaceBeforeIdentifier(
            p: *Printer,
        ) void {
            if (p.writer.written > 0 and (js_lexer.isIdentifierContinue(@as(i32, p.writer.prevChar())) or p.writer.written == p.prev_reg_exp_end)) {
                p.print(" ");
            }
        }

        pub inline fn maybePrintSpace(
            p: *Printer,
        ) void {
            switch (p.writer.prevChar()) {
                0, ' ', '\n' => {},
                else => {
                    p.print(" ");
                },
            }
        }
        pub fn printDotThenPrefix(p: *Printer) Level {
            p.print(".then(() => ");
            return .comma;
        }

        pub inline fn printUndefined(p: *Printer, loc: logger.Loc, level: Level) void {
            if (p.options.minify_syntax) {
                if (level.gte(Level.prefix)) {
                    p.addSourceMapping(loc);
                    p.print("(void 0)");
                } else {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(loc);
                    p.print("void 0");
                }
            } else {
                p.printSpaceBeforeIdentifier();
                p.addSourceMapping(loc);
                p.print("undefined");
            }
        }

        pub fn printBody(p: *Printer, stmt: Stmt) void {
            switch (stmt.data) {
                .s_block => |block| {
                    p.printSpace();
                    p.printBlock(stmt.loc, block.stmts, block.close_brace_loc);
                    p.printNewline();
                },
                else => {
                    p.printNewline();
                    p.indent();
                    p.printStmt(stmt) catch unreachable;
                    p.unindent();
                },
            }
        }

        pub fn printBlockBody(p: *Printer, stmts: []const Stmt) void {
            for (stmts) |stmt| {
                p.printSemicolonIfNeeded();
                p.printStmt(stmt) catch unreachable;
            }
        }

        pub fn printBlock(p: *Printer, loc: logger.Loc, stmts: []const Stmt, close_brace_loc: ?logger.Loc) void {
            p.addSourceMapping(loc);
            p.print("{");
            if (stmts.len > 0) {
                @branchHint(.likely);
                p.printNewline();

                p.indent();
                p.printBlockBody(stmts);
                p.unindent();

                p.printIndent();
            }
            if (close_brace_loc != null and close_brace_loc.?.start > loc.start) {
                p.addSourceMapping(close_brace_loc.?);
            }
            p.print("}");

            p.needs_semicolon = false;
        }

        pub fn printTwoBlocksInOne(p: *Printer, loc: logger.Loc, stmts: []const Stmt, prepend: []const Stmt) void {
            p.addSourceMapping(loc);
            p.print("{");
            p.printNewline();

            p.indent();
            p.printBlockBody(prepend);
            p.printBlockBody(stmts);
            p.unindent();
            p.needs_semicolon = false;

            p.printIndent();
            p.print("}");
        }

        pub fn printDecls(p: *Printer, comptime keyword: string, decls_: []G.Decl, flags: ExprFlag.Set) void {
            p.print(keyword);
            p.printSpace();
            var decls = decls_;

            if (decls.len == 0) {
                // "var ;" is invalid syntax
                // assert we never reach it
                unreachable;
            }

            if (comptime FeatureFlags.same_target_becomes_destructuring) {
                // Minify
                //
                //    var a = obj.foo, b = obj.bar, c = obj.baz;
                //
                // to
                //
                //    var {a, b, c} = obj;
                //
                // Caveats:
                //   - Same consecutive target
                //   - No optional chaining
                //   - No computed property access
                //   - Identifier bindings only
                if (decls.len > 1) brk: {
                    const first_decl = &decls[0];
                    const second_decl = &decls[1];

                    if (first_decl.binding.data != .b_identifier) break :brk;
                    if (second_decl.value == null or
                        second_decl.value.?.data != .e_dot or
                        second_decl.binding.data != .b_identifier)
                    {
                        break :brk;
                    }

                    const target_value = first_decl.value orelse break :brk;
                    const target_e_dot: *E.Dot = if (target_value.data == .e_dot)
                        target_value.data.e_dot
                    else
                        break :brk;
                    const target_ref = if (target_e_dot.target.data == .e_identifier and target_e_dot.optional_chain == null)
                        target_e_dot.target.data.e_identifier.ref
                    else
                        break :brk;

                    const second_e_dot = second_decl.value.?.data.e_dot;
                    if (second_e_dot.target.data != .e_identifier or second_e_dot.optional_chain != null) {
                        break :brk;
                    }

                    const second_ref = second_e_dot.target.data.e_identifier.ref;
                    if (!second_ref.eql(target_ref)) {
                        break :brk;
                    }

                    {
                        // Reset the temporary bindings array early on
                        var temp_bindings = p.temporary_bindings;
                        p.temporary_bindings = .{};
                        defer {
                            if (p.temporary_bindings.capacity > 0) {
                                temp_bindings.deinit(bun.default_allocator);
                            } else {
                                temp_bindings.clearRetainingCapacity();
                                p.temporary_bindings = temp_bindings;
                            }
                        }
                        temp_bindings.ensureUnusedCapacity(bun.default_allocator, 2) catch unreachable;
                        temp_bindings.appendAssumeCapacity(.{
                            .key = Expr.init(E.String, E.String.init(target_e_dot.name), target_e_dot.name_loc),
                            .value = decls[0].binding,
                        });
                        temp_bindings.appendAssumeCapacity(.{
                            .key = Expr.init(E.String, E.String.init(second_e_dot.name), second_e_dot.name_loc),
                            .value = decls[1].binding,
                        });

                        decls = decls[2..];
                        while (decls.len > 0) {
                            const decl = &decls[0];

                            if (decl.value == null or decl.value.?.data != .e_dot or decl.binding.data != .b_identifier) {
                                break;
                            }

                            const e_dot = decl.value.?.data.e_dot;
                            if (e_dot.target.data != .e_identifier or e_dot.optional_chain != null) {
                                break;
                            }

                            const ref = e_dot.target.data.e_identifier.ref;
                            if (!ref.eql(target_ref)) {
                                break;
                            }

                            temp_bindings.append(bun.default_allocator, .{
                                .key = Expr.init(E.String, E.String.init(e_dot.name), e_dot.name_loc),
                                .value = decl.binding,
                            }) catch unreachable;
                            decls = decls[1..];
                        }
                        var b_object = B.Object{
                            .properties = temp_bindings.items,
                            .is_single_line = true,
                        };
                        const binding = Binding.init(&b_object, target_e_dot.target.loc);
                        p.printBinding(binding);
                    }

                    p.printWhitespacer(ws(" = "));
                    p.printExpr(second_e_dot.target, .comma, flags);

                    if (decls.len == 0) {
                        return;
                    }

                    p.print(",");
                    p.printSpace();
                }
            }

            {
                p.printBinding(decls[0].binding);

                if (decls[0].value) |value| {
                    p.printWhitespacer(ws(" = "));
                    p.printExpr(value, .comma, flags);
                }
            }

            for (decls[1..]) |*decl| {
                p.print(",");
                p.printSpace();

                p.printBinding(decl.binding);

                if (decl.value) |value| {
                    p.printWhitespacer(ws(" = "));
                    p.printExpr(value, .comma, flags);
                }
            }
        }

        pub inline fn addSourceMapping(printer: *Printer, location: logger.Loc) void {
            if (comptime !generate_source_map) {
                return;
            }
            printer.source_map_builder.addSourceMapping(location, printer.writer.slice());
        }

        pub inline fn addSourceMappingForName(printer: *Printer, location: logger.Loc, _: string, _: Ref) void {
            if (comptime !generate_source_map) {
                return;
            }
            // TODO: esbuild does this to make the source map more accurate with E.NameOfSymbol
            // if (printer.symbols().get(printer.symbols().follow(ref))) |original_symbol| {
            //     if (!bun.strings.eql( original_symbol.original_name, name)) {
            //         printer.source_map_builder.addSourceMapping(location, originalName);
            //         return;
            //     }
            // }
            printer.addSourceMapping(location);
        }

        pub fn printSymbol(p: *Printer, ref: Ref) void {
            bun.assert(!ref.isNull());
            const name = p.renamer.nameForSymbol(ref);

            p.printIdentifier(name);
        }
        pub fn printClauseAlias(p: *Printer, alias: string) void {
            bun.assert(alias.len > 0);

            if (!strings.containsNonBmpCodePointOrIsInvalidIdentifier(alias)) {
                p.printSpaceBeforeIdentifier();
                p.printIdentifier(alias);
            } else {
                p.printStringLiteralUTF8(alias, false);
            }
        }

        pub fn printFnArgs(
            p: *Printer,
            open_paren_loc: ?logger.Loc,
            args: []G.Arg,
            has_rest_arg: bool,
            // is_arrow can be used for minifying later
            _: bool,
        ) void {
            const wrap = true;

            if (wrap) {
                if (open_paren_loc) |loc| {
                    p.addSourceMapping(loc);
                }
                p.print("(");
            }

            for (args, 0..) |arg, i| {
                if (i != 0) {
                    p.print(",");
                    p.printSpace();
                }

                if (has_rest_arg and i + 1 == args.len) {
                    p.print("...");
                }

                p.printBinding(arg.binding);

                if (arg.default) |default| {
                    p.printWhitespacer(ws(" = "));
                    p.printExpr(default, .comma, ExprFlag.None());
                }
            }

            if (wrap) {
                p.print(")");
            }
        }

        pub fn printFunc(p: *Printer, func: G.Fn) void {
            p.printFnArgs(func.open_parens_loc, func.args, func.flags.contains(.has_rest_arg), false);
            p.printSpace();
            p.printBlock(func.body.loc, func.body.stmts, null);
        }

        pub fn printClass(p: *Printer, class: G.Class) void {
            if (class.extends) |extends| {
                p.print(" extends");
                p.printSpace();
                p.printExpr(extends, Level.new.sub(1), ExprFlag.None());
            }

            p.printSpace();

            p.addSourceMapping(class.body_loc);
            p.print("{");
            p.printNewline();
            p.indent();

            for (class.properties) |item| {
                p.printSemicolonIfNeeded();
                p.printIndent();

                if (item.kind == .class_static_block) {
                    p.print("static");
                    p.printSpace();
                    p.printBlock(item.class_static_block.?.loc, item.class_static_block.?.stmts.slice(), null);
                    p.printNewline();
                    continue;
                }

                p.printProperty(item);

                if (item.value == null) {
                    p.printSemicolonAfterStatement();
                } else {
                    p.printNewline();
                }
            }

            p.needs_semicolon = false;
            p.unindent();
            p.printIndent();
            if (class.close_brace_loc.start > class.body_loc.start)
                p.addSourceMapping(class.close_brace_loc);
            p.print("}");
        }

        pub fn bestQuoteCharForEString(str: *const E.String, allow_backtick: bool) u8 {
            if (comptime is_json)
                return '"';

            if (str.isUTF8()) {
                return bestQuoteCharForString(u8, str.data, allow_backtick);
            } else {
                return bestQuoteCharForString(u16, str.slice16(), allow_backtick);
            }
        }

        pub fn printWhitespacer(this: *Printer, spacer: Whitespacer) void {
            if (this.options.minify_whitespace) {
                this.print(spacer.minify);
            } else {
                this.print(spacer.normal);
            }
        }

        pub fn printNonNegativeFloat(p: *Printer, float: f64) void {
            // Is this actually an integer?
            @setRuntimeSafety(false);
            const floored: f64 = @floor(float);
            const remainder: f64 = (float - floored);
            const is_integer = remainder == 0;
            if (float < std.math.maxInt(u52) and is_integer) {
                @setFloatMode(.optimized);
                // In JavaScript, numbers are represented as 64 bit floats
                // However, they could also be signed or unsigned int 32 (when doing bit shifts)
                // In this case, it's always going to unsigned since that conversion has already happened.
                const val = @as(u64, @intFromFloat(float));
                switch (val) {
                    0 => {
                        p.print("0");
                    },
                    1...9 => {
                        var bytes = [1]u8{'0' + @as(u8, @intCast(val))};
                        p.print(&bytes);
                    },
                    10 => {
                        p.print("10");
                    },
                    11...99 => {
                        const buf: *[2]u8 = (p.writer.reserve(2) catch unreachable)[0..2];
                        formatUnsignedIntegerBetween(2, buf, val);
                        p.writer.advance(2);
                    },
                    100 => {
                        p.print("100");
                    },
                    101...999 => {
                        const buf: *[3]u8 = (p.writer.reserve(3) catch unreachable)[0..3];
                        formatUnsignedIntegerBetween(3, buf, val);
                        p.writer.advance(3);
                    },

                    1000 => {
                        p.print("1000");
                    },
                    1001...9999 => {
                        const buf: *[4]u8 = (p.writer.reserve(4) catch unreachable)[0..4];
                        formatUnsignedIntegerBetween(4, buf, val);
                        p.writer.advance(4);
                    },
                    10000 => {
                        p.print("1e4");
                    },
                    100000 => {
                        p.print("1e5");
                    },
                    1000000 => {
                        p.print("1e6");
                    },
                    10000000 => {
                        p.print("1e7");
                    },
                    100000000 => {
                        p.print("1e8");
                    },
                    1000000000 => {
                        p.print("1e9");
                    },

                    10001...99999 => {
                        const buf: *[5]u8 = (p.writer.reserve(5) catch unreachable)[0..5];
                        formatUnsignedIntegerBetween(5, buf, val);
                        p.writer.advance(5);
                    },
                    100001...999999 => {
                        const buf: *[6]u8 = (p.writer.reserve(6) catch unreachable)[0..6];
                        formatUnsignedIntegerBetween(6, buf, val);
                        p.writer.advance(6);
                    },
                    1_000_001...9_999_999 => {
                        const buf: *[7]u8 = (p.writer.reserve(7) catch unreachable)[0..7];
                        formatUnsignedIntegerBetween(7, buf, val);
                        p.writer.advance(7);
                    },
                    10_000_001...99_999_999 => {
                        const buf: *[8]u8 = (p.writer.reserve(8) catch unreachable)[0..8];
                        formatUnsignedIntegerBetween(8, buf, val);
                        p.writer.advance(8);
                    },
                    100_000_001...999_999_999 => {
                        const buf: *[9]u8 = (p.writer.reserve(9) catch unreachable)[0..9];
                        formatUnsignedIntegerBetween(9, buf, val);
                        p.writer.advance(9);
                    },
                    1_000_000_001...9_999_999_999 => {
                        const buf: *[10]u8 = (p.writer.reserve(10) catch unreachable)[0..10];
                        formatUnsignedIntegerBetween(10, buf, val);
                        p.writer.advance(10);
                    },
                    else => std.fmt.formatInt(val, 10, .lower, .{}, p) catch unreachable,
                }

                return;
            }

            p.fmt("{d}", .{float}) catch {};
        }

        pub fn printStringCharactersUTF8(e: *Printer, text: []const u8, quote: u8) void {
            const writer = e.writer.stdWriter();
            (switch (quote) {
                '\'' => writePreQuotedString(text, @TypeOf(writer), writer, '\'', ascii_only, false, .utf8),
                '"' => writePreQuotedString(text, @TypeOf(writer), writer, '"', ascii_only, false, .utf8),
                '`' => writePreQuotedString(text, @TypeOf(writer), writer, '`', ascii_only, false, .utf8),
                else => unreachable,
            }) catch |err| switch (err) {};
        }
        pub fn printStringCharactersUTF16(e: *Printer, text: []const u16, quote: u8) void {
            const slice = std.mem.sliceAsBytes(text);

            const writer = e.writer.stdWriter();
            (switch (quote) {
                '\'' => writePreQuotedString(slice, @TypeOf(writer), writer, '\'', ascii_only, false, .utf16),
                '"' => writePreQuotedString(slice, @TypeOf(writer), writer, '"', ascii_only, false, .utf16),
                '`' => writePreQuotedString(slice, @TypeOf(writer), writer, '`', ascii_only, false, .utf16),
                else => unreachable,
            }) catch |err| switch (err) {};
        }

        pub fn isUnboundEvalIdentifier(p: *Printer, value: Expr) bool {
            switch (value.data) {
                .e_identifier => |ident| {
                    if (ident.ref.isSourceContentsSlice()) return false;

                    const symbol = p.symbols().get(p.symbols().follow(ident.ref)) orelse return false;
                    return symbol.kind == .unbound and strings.eqlComptime(symbol.original_name, "eval");
                },
                else => {
                    return false;
                },
            }
        }

        inline fn symbols(p: *Printer) js_ast.Symbol.Map {
            return p.renamer.symbols();
        }

        pub fn printRequireError(p: *Printer, text: string) void {
            p.print("(()=>{throw new Error(\"Cannot require module \"+");
            p.printStringLiteralUTF8(text, false);
            p.print(");})()");
        }

        pub inline fn importRecord(
            p: *const Printer,
            import_record_index: usize,
        ) *const ImportRecord {
            return &p.import_records[import_record_index];
        }

        pub fn printRequireOrImportExpr(
            p: *Printer,
            import_record_index: u32,
            was_unwrapped_require: bool,
            leading_interior_comments: []G.Comment,
            import_options: Expr,
            level_: Level,
            flags: ExprFlag.Set,
        ) void {
            _ = leading_interior_comments; // TODO:

            var level = level_;
            const wrap = level.gte(.new) or flags.contains(.forbid_call);
            if (wrap) p.print("(");
            defer if (wrap) p.print(")");

            assert(p.import_records.len > import_record_index);
            const record = p.importRecord(import_record_index);
            const module_type = p.options.module_type;

            if (comptime is_bun_platform) {
                // "bun" is not a real module. It's just globalThis.Bun.
                //
                //  transform from:
                //      const foo = await import("bun")
                //      const bar = require("bun")
                //
                //  transform to:
                //      const foo = await Promise.resolve(globalThis.Bun)
                //      const bar = globalThis.Bun
                //
                switch (record.tag) {
                    .bun => {
                        if (record.kind == .dynamic) {
                            p.print("Promise.resolve(globalThis.Bun)");
                        } else if (record.kind == .require) {
                            p.print("globalThis.Bun");
                        }
                        return;
                    },
                    .bun_test => {
                        if (record.kind == .dynamic) {
                            if (module_type == .cjs) {
                                p.print("Promise.resolve(globalThis.Bun.jest(__filename))");
                            } else {
                                p.print("Promise.resolve(globalThis.Bun.jest(import.meta.path))");
                            }
                        } else if (record.kind == .require) {
                            if (module_type == .cjs) {
                                p.print("globalThis.Bun.jest(__filename)");
                            } else {
                                p.print("globalThis.Bun.jest(import.meta.path)");
                            }
                        }
                        return;
                    },
                    else => {},
                }
            }

            if (record.source_index.isValid()) {
                var meta = p.options.requireOrImportMetaForSource(record.source_index.get(), was_unwrapped_require);

                // Don't need the namespace object if the result is unused anyway
                if (flags.contains(.expr_result_is_unused)) {
                    meta.exports_ref = Ref.None;
                }

                // Internal "import()" of async ESM
                if (record.kind == .dynamic and meta.is_wrapper_async) {
                    p.printSpaceBeforeIdentifier();
                    p.printSymbol(meta.wrapper_ref);
                    p.print("()");
                    if (meta.exports_ref.isValid()) {
                        _ = p.printDotThenPrefix();
                        p.printSpaceBeforeIdentifier();
                        p.printSymbol(meta.exports_ref);
                        p.printDotThenSuffix();
                    }
                    return;
                }

                // Internal "require()" or "import()"
                if (record.kind == .dynamic) {
                    p.printSpaceBeforeIdentifier();
                    p.print("Promise.resolve()");

                    level = p.printDotThenPrefix();
                }
                defer if (record.kind == .dynamic) p.printDotThenSuffix();

                // Make sure the comma operator is properly wrapped
                const wrap_comma_operator = meta.exports_ref.isValid() and
                    meta.wrapper_ref.isValid() and
                    level.gte(.comma);
                if (wrap_comma_operator) p.print("(");
                defer if (wrap_comma_operator) p.print(")");

                // Wrap this with a call to "__toESM()" if this is a CommonJS file
                const wrap_with_to_esm = record.wrap_with_to_esm;
                if (wrap_with_to_esm) {
                    p.printSpaceBeforeIdentifier();
                    p.printSymbol(p.options.to_esm_ref);
                    p.print("(");
                }

                if (p.options.input_files_for_dev_server) |input_files| {
                    bun.assert(module_type == .internal_bake_dev);
                    p.printSpaceBeforeIdentifier();
                    p.printSymbol(p.options.hmr_ref);
                    p.print(".require(");
                    const path = input_files[record.source_index.get()].path;
                    p.printStringLiteralUTF8(path.pretty, false);
                    p.print(")");
                } else if (!meta.was_unwrapped_require) {
                    // Call the wrapper
                    if (meta.wrapper_ref.isValid()) {
                        p.printSpaceBeforeIdentifier();
                        p.printSymbol(meta.wrapper_ref);
                        p.print("()");

                        if (meta.exports_ref.isValid()) {
                            p.print(",");
                            p.printSpace();
                        }
                    }

                    // Return the namespace object if this is an ESM file
                    if (meta.exports_ref.isValid()) {
                        // Wrap this with a call to "__toCommonJS()" if this is an ESM file
                        const wrap_with_to_cjs = record.wrap_with_to_commonjs;
                        if (wrap_with_to_cjs) {
                            p.printSymbol(p.options.to_commonjs_ref);
                            p.print("(");
                        }
                        p.printSymbol(meta.exports_ref);
                        if (wrap_with_to_cjs) {
                            p.print(")");
                        }
                    }
                } else {
                    if (!meta.exports_ref.isNull())
                        p.printSymbol(meta.exports_ref);
                }

                if (wrap_with_to_esm) {
                    if (module_type.isESM()) {
                        p.print(",");
                        p.printSpace();
                        p.print("1");
                    }
                    p.print(")");
                }

                return;
            }

            // External "require()"
            if (record.kind != .dynamic) {
                p.printSpaceBeforeIdentifier();

                if (p.options.inline_require_and_import_errors) {
                    if (record.path.is_disabled and record.handles_import_errors) {
                        p.printRequireError(record.path.text);
                        return;
                    }

                    if (record.path.is_disabled) {
                        p.printDisabledImport();
                        return;
                    }
                }

                const wrap_with_to_esm = record.wrap_with_to_esm;

                if (module_type == .internal_bake_dev) {
                    p.printSpaceBeforeIdentifier();
                    p.printSymbol(p.options.hmr_ref);
                    if (record.tag == .builtin)
                        p.print(".builtin(")
                    else
                        p.print(".require(");
                    const path = record.path;
                    p.printStringLiteralUTF8(path.pretty, false);
                    p.print(")");
                    return;
                } else if (wrap_with_to_esm) {
                    p.printSpaceBeforeIdentifier();
                    p.printSymbol(p.options.to_esm_ref);
                    p.print("(");
                }

                if (p.options.require_ref) |ref| {
                    p.printSymbol(ref);
                } else {
                    p.print("require");
                }

                p.print("(");
                p.printImportRecordPath(record);
                p.print(")");

                if (wrap_with_to_esm) {
                    p.print(")");
                }
                return;
            }

            // External import()
            // if (leading_interior_comments.len > 0) {
            //     p.printNewline();
            //     p.indent();
            //     for (leading_interior_comments) |comment| {
            //         p.printIndentedComment(comment.text);
            //     }
            //     p.printIndent();
            // }
            p.addSourceMapping(record.range.loc);

            p.printSpaceBeforeIdentifier();

            // Allow it to fail at runtime, if it should
            if (module_type != .internal_bake_dev) {
                p.print("import(");
                p.printImportRecordPath(record);
            } else {
                p.printSymbol(p.options.hmr_ref);
                p.print(".dynamicImport(");
                const path = record.path;
                p.printStringLiteralUTF8(path.pretty, false);
            }

            if (!import_options.isMissing()) {
                p.printWhitespacer(ws(", "));
                p.printExpr(import_options, .comma, .{});
            }

            p.print(")");

            // if (leading_interior_comments.len > 0) {
            //     p.printNewline();
            //     p.unindent();
            //     p.printIndent();
            // }

            return;
        }

        pub inline fn printPure(p: *Printer) void {
            if (Environment.allow_assert) assert(p.options.print_dce_annotations);
            p.printWhitespacer(ws("/* @__PURE__ */ "));
        }

        pub fn printStringLiteralEString(p: *Printer, str: *E.String, allow_backtick: bool) void {
            const quote = bestQuoteCharForEString(str, allow_backtick);
            p.print(quote);
            p.printStringCharactersEString(str, quote);
            p.print(quote);
        }
        pub fn printStringLiteralUTF8(p: *Printer, str: string, allow_backtick: bool) void {
            if (Environment.allow_assert) std.debug.assert(std.unicode.wtf8ValidateSlice(str));

            const quote = if (comptime !is_json)
                bestQuoteCharForString(u8, str, allow_backtick)
            else
                '"';

            p.print(quote);
            p.printStringCharactersUTF8(str, quote);
            p.print(quote);
        }

        fn printClauseItem(p: *Printer, item: js_ast.ClauseItem) void {
            return printClauseItemAs(p, item, .import);
        }

        fn printExportClauseItem(p: *Printer, item: js_ast.ClauseItem) void {
            return printClauseItemAs(p, item, .@"export");
        }

        fn printClauseItemAs(p: *Printer, item: js_ast.ClauseItem, comptime as: @Type(.enum_literal)) void {
            const name = p.renamer.nameForSymbol(item.name.ref.?);

            if (comptime as == .import) {
                if (strings.eql(name, item.alias)) {
                    p.printIdentifier(name);
                } else {
                    p.printClauseAlias(item.alias);
                    p.print(" as ");
                    p.addSourceMapping(item.alias_loc);
                    p.printIdentifier(name);
                }
            } else if (comptime as == .@"var") {
                p.printClauseAlias(item.alias);

                if (!strings.eql(name, item.alias)) {
                    p.print(":");
                    p.printSpace();

                    p.printIdentifier(name);
                }
            } else if (comptime as == .@"export") {
                p.printIdentifier(name);

                if (!strings.eql(name, item.alias)) {
                    p.print(" as ");
                    p.addSourceMapping(item.alias_loc);
                    p.printClauseAlias(item.alias);
                }
            } else {
                @compileError("Unknown as");
            }
        }

        pub inline fn canPrintIdentifierUTF16(_: *Printer, name: []const u16) bool {
            if (comptime ascii_only or ascii_only_always_on_unless_minifying) {
                return js_lexer.isLatin1Identifier([]const u16, name);
            } else {
                return js_lexer.isIdentifierUTF16(name);
            }
        }

        fn printRawTemplateLiteral(p: *Printer, bytes: []const u8) void {
            if (comptime is_json or !ascii_only) {
                p.print(bytes);
                return;
            }

            // Translate any non-ASCII to unicode escape sequences
            // Note that this does not correctly handle malformed template literal strings
            // template literal strings can contain invalid unicode code points
            // and pretty much anything else
            //
            // we use WTF-8 here, but that's still not good enough.
            //
            var ascii_start: usize = 0;
            var is_ascii = false;
            var iter = CodepointIterator.init(bytes);
            var cursor = CodepointIterator.Cursor{};

            while (iter.next(&cursor)) {
                switch (cursor.c) {
                    // unlike other versions, we only want to mutate > 0x7F
                    0...last_ascii => {
                        if (!is_ascii) {
                            ascii_start = cursor.i;
                            is_ascii = true;
                        }
                    },
                    else => {
                        if (is_ascii) {
                            p.print(bytes[ascii_start..cursor.i]);
                            is_ascii = false;
                        }

                        switch (cursor.c) {
                            0...0xFFFF => {
                                p.print([_]u8{
                                    '\\',
                                    'u',
                                    hex_chars[cursor.c >> 12],
                                    hex_chars[(cursor.c >> 8) & 15],
                                    hex_chars[(cursor.c >> 4) & 15],
                                    hex_chars[cursor.c & 15],
                                });
                            },
                            else => {
                                p.print("\\u{");
                                std.fmt.formatInt(cursor.c, 16, .lower, .{}, p) catch unreachable;
                                p.print("}");
                            },
                        }
                    },
                }
            }

            if (is_ascii) {
                p.print(bytes[ascii_start..]);
            }
        }

        pub fn printExpr(p: *Printer, expr: Expr, level: Level, in_flags: ExprFlag.Set) void {
            var flags = in_flags;

            switch (expr.data) {
                .e_missing => {},
                .e_undefined => {
                    p.addSourceMapping(expr.loc);
                    p.printUndefined(expr.loc, level);
                },
                .e_super => {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.print("super");
                },
                .e_null => {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.print("null");
                },
                .e_this => {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.print("this");
                },
                .e_spread => |e| {
                    p.addSourceMapping(expr.loc);
                    p.print("...");
                    p.printExpr(e.value, .comma, ExprFlag.None());
                },
                .e_new_target => {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.print("new.target");
                },
                .e_import_meta => {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    if (p.options.module_type == .internal_bake_dev) {
                        bun.assert(p.options.hmr_ref.isValid());
                        p.printSymbol(p.options.hmr_ref);
                        p.print(".importMeta");
                    } else if (!p.options.import_meta_ref.isValid()) {
                        // Most of the time, leave it in there
                        p.print("import.meta");
                    } else {
                        // Note: The bundler will not hit this code path. The bundler will replace
                        // the ImportMeta AST node with a regular Identifier AST node.
                        //
                        // This is currently only used in Bun's runtime for CommonJS modules
                        // referencing import.meta
                        //
                        // TODO: This assertion trips when using `import.meta` with `--format=cjs`
                        bun.debugAssert(p.options.module_type == .cjs);

                        p.printSymbol(p.options.import_meta_ref);
                    }
                },
                .e_import_meta_main => |data| {
                    if (p.options.module_type == .esm and p.options.target != .node) {
                        // Node.js doesn't support import.meta.main
                        // Most of the time, leave it in there
                        if (data.inverted) {
                            p.addSourceMapping(expr.loc);
                            p.print("!");
                        } else {
                            p.printSpaceBeforeIdentifier();
                            p.addSourceMapping(expr.loc);
                        }
                        p.print("import.meta.main");
                    } else {
                        bun.debugAssert(p.options.module_type != .internal_bake_dev);

                        p.printSpaceBeforeIdentifier();
                        p.addSourceMapping(expr.loc);

                        if (p.options.require_ref) |require|
                            p.printSymbol(require)
                        else
                            p.print("require");

                        if (data.inverted)
                            p.printWhitespacer(ws(".main != "))
                        else
                            p.printWhitespacer(ws(".main == "));

                        if (p.options.target == .node) {
                            // "__require.module"
                            if (p.options.require_ref) |require|
                                p.printSymbol(require)
                            else
                                p.print("require");

                            p.print(".module");
                        } else if (p.options.commonjs_module_ref.isValid()) {
                            p.printSymbol(p.options.commonjs_module_ref);
                        } else {
                            p.print("module");
                        }
                    }
                },
                .e_special => |special| switch (special) {
                    .module_exports => {
                        p.printSpaceBeforeIdentifier();
                        p.addSourceMapping(expr.loc);

                        if (p.options.commonjs_module_exports_assigned_deoptimized) {
                            if (p.options.commonjs_module_ref.isValid()) {
                                p.printSymbol(p.options.commonjs_module_ref);
                            } else {
                                p.print("module");
                            }
                            p.print(".exports");
                        } else {
                            p.printSymbol(p.options.commonjs_named_exports_ref);
                        }
                    },
                    .hot_enabled => {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        p.printSymbol(p.options.hmr_ref);
                        p.print(".indirectHot");
                    },
                    .hot_data => {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        p.printSymbol(p.options.hmr_ref);
                        p.print(".data");
                    },
                    .hot_accept => {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        p.printSymbol(p.options.hmr_ref);
                        p.print(".accept");
                    },
                    .hot_accept_visited => {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        p.printSymbol(p.options.hmr_ref);
                        p.print(".acceptSpecifiers");
                    },
                    .hot_disabled => {
                        bun.debugAssert(p.options.module_type != .internal_bake_dev);
                        p.printExpr(.{ .data = .e_undefined, .loc = expr.loc }, level, in_flags);
                    },
                    .resolved_specifier_string => |index| {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        p.printStringLiteralUTF8(p.importRecord(index.get()).path.pretty, true);
                    },
                },

                .e_commonjs_export_identifier => |id| {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);

                    for (p.options.commonjs_named_exports.keys(), p.options.commonjs_named_exports.values()) |key, value| {
                        if (value.loc_ref.ref.?.eql(id.ref)) {
                            if (p.options.commonjs_named_exports_deoptimized or value.needs_decl) {
                                if (p.options.commonjs_module_exports_assigned_deoptimized and
                                    id.base == .module_dot_exports and
                                    p.options.commonjs_module_ref.isValid())
                                {
                                    p.printSymbol(p.options.commonjs_module_ref);
                                    p.print(".exports");
                                } else {
                                    p.printSymbol(p.options.commonjs_named_exports_ref);
                                }

                                if (js_lexer.isIdentifier(key)) {
                                    p.print(".");
                                    p.print(key);
                                } else {
                                    p.print("[");
                                    p.printStringLiteralUTF8(key, false);
                                    p.print("]");
                                }
                            } else {
                                p.printSymbol(value.loc_ref.ref.?);
                            }
                            break;
                        }
                    }
                },
                .e_new => |e| {
                    const has_pure_comment = e.can_be_unwrapped_if_unused and p.options.print_dce_annotations;
                    const wrap = level.gte(.call) or (has_pure_comment and level.gte(.postfix));

                    if (wrap) {
                        p.print("(");
                    }

                    if (has_pure_comment) {
                        p.printPure();
                    }

                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.print("new");
                    p.printSpace();
                    p.printExpr(e.target, .new, ExprFlag.ForbidCall());
                    const args = e.args.slice();
                    if (args.len > 0 or level.gte(.postfix)) {
                        p.print("(");

                        if (args.len > 0) {
                            p.printExpr(args[0], .comma, ExprFlag.None());

                            for (args[1..]) |arg| {
                                p.print(",");
                                p.printSpace();
                                p.printExpr(arg, .comma, ExprFlag.None());
                            }
                        }

                        if (e.close_parens_loc.start > expr.loc.start) {
                            p.addSourceMapping(e.close_parens_loc);
                        }

                        p.print(")");
                    }

                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_call => |e| {
                    var wrap = level.gte(.new) or flags.contains(.forbid_call);
                    var target_flags = ExprFlag.None();
                    if (e.optional_chain == null) {
                        target_flags = ExprFlag.HasNonOptionalChainParent();
                    } else if (flags.contains(.has_non_optional_chain_parent)) {
                        wrap = true;
                    }

                    const has_pure_comment = e.can_be_unwrapped_if_unused and p.options.print_dce_annotations;
                    if (has_pure_comment and level.gte(.postfix)) {
                        wrap = true;
                    }

                    if (wrap) {
                        p.print("(");
                    }

                    if (has_pure_comment) {
                        const was_stmt_start = p.stmt_start == p.writer.written;
                        p.printPure();
                        if (was_stmt_start) {
                            p.stmt_start = p.writer.written;
                        }
                    }
                    // We only want to generate an unbound eval() in CommonJS
                    p.call_target = e.target.data;

                    const is_unbound_eval = (!e.is_direct_eval and
                        p.isUnboundEvalIdentifier(e.target) and
                        e.optional_chain == null);

                    if (is_unbound_eval) {
                        p.print("(0,");
                        p.printSpace();
                        p.printExpr(e.target, .postfix, ExprFlag.None());
                        p.print(")");
                    } else {
                        p.printExpr(e.target, .postfix, target_flags);
                    }

                    if (e.optional_chain != null and (e.optional_chain orelse unreachable) == .start) {
                        p.print("?.");
                    }
                    p.print("(");
                    const args = e.args.slice();

                    if (args.len > 0) {
                        p.printExpr(args[0], .comma, ExprFlag.None());
                        for (args[1..]) |arg| {
                            p.print(",");
                            p.printSpace();
                            p.printExpr(arg, .comma, ExprFlag.None());
                        }
                    }
                    if (e.close_paren_loc.start > expr.loc.start) {
                        p.addSourceMapping(e.close_paren_loc);
                    }
                    p.print(")");
                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_require_main => {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);

                    if (p.options.require_ref) |require_ref| {
                        p.printSymbol(require_ref);
                        p.print(".main");
                    } else if (p.options.module_type == .internal_bake_dev) {
                        p.print("false"); // there is no true main entry point
                    } else {
                        p.print("require.main");
                    }
                },
                .e_require_call_target => {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);

                    if (p.options.require_ref) |require_ref| {
                        p.printSymbol(require_ref);
                    } else if (p.options.module_type == .internal_bake_dev) {
                        p.printSymbol(p.options.hmr_ref);
                        p.print(".require");
                    } else {
                        p.print("require");
                    }
                },
                .e_require_resolve_call_target => {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);

                    if (p.options.require_ref) |require_ref| {
                        p.printSymbol(require_ref);
                        p.print(".resolve");
                    } else if (p.options.module_type == .internal_bake_dev) {
                        p.printSymbol(p.options.hmr_ref);
                        p.print(".requireResolve");
                    } else {
                        p.print("require.resolve");
                    }
                },
                .e_require_string => |e| {
                    if (!rewrite_esm_to_cjs) {
                        p.printRequireOrImportExpr(
                            e.import_record_index,
                            e.unwrapped_id != std.math.maxInt(u32),
                            &([_]G.Comment{}),
                            Expr.empty,
                            level,
                            flags,
                        );
                    }
                },
                .e_require_resolve_string => |e| {
                    const wrap = level.gte(.new) or flags.contains(.forbid_call);
                    if (wrap) {
                        p.print("(");
                    }

                    p.printSpaceBeforeIdentifier();

                    if (p.options.require_ref) |require_ref| {
                        p.printSymbol(require_ref);
                        p.print(".resolve");
                    } else {
                        p.print("require.resolve");
                    }

                    p.print("(");
                    p.printStringLiteralUTF8(p.importRecord(e.import_record_index).path.text, true);
                    p.print(")");

                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_import => |e| {
                    // Handle non-string expressions
                    if (e.isImportRecordNull()) {
                        const wrap = level.gte(.new) or flags.contains(.forbid_call);
                        if (wrap) {
                            p.print("(");
                        }

                        p.printSpaceBeforeIdentifier();
                        p.addSourceMapping(expr.loc);
                        if (p.options.module_type == .internal_bake_dev) {
                            p.printSymbol(p.options.hmr_ref);
                            p.print(".dynamicImport(");
                        } else {
                            p.print("import(");
                        }
                        // TODO:
                        // if (e.leading_interior_comments.len > 0) {
                        //     p.printNewline();
                        //     p.indent();
                        //     for (e.leading_interior_comments) |comment| {
                        //         p.printIndentedComment(comment.text);
                        //     }
                        //     p.printIndent();
                        // }
                        p.printExpr(e.expr, .comma, ExprFlag.None());

                        if (!e.options.isMissing()) {
                            p.printWhitespacer(ws(", "));
                            p.printExpr(e.options, .comma, .{});
                        }

                        // TODO:
                        // if (e.leading_interior_comments.len > 0) {
                        //     p.printNewline();
                        //     p.unindent();
                        //     p.printIndent();
                        // }
                        p.print(")");
                        if (wrap) {
                            p.print(")");
                        }
                    } else {
                        p.printRequireOrImportExpr(
                            e.import_record_index,
                            false,
                            &.{}, // e.leading_interior_comments,
                            e.options,
                            level,
                            flags,
                        );
                    }
                },
                .e_dot => |e| {
                    const isOptionalChain = e.optional_chain == .start;

                    var wrap = false;
                    if (e.optional_chain == null) {
                        flags.insert(.has_non_optional_chain_parent);

                        // Inline cross-module TypeScript enum references here
                        if (p.tryToGetImportedEnumValue(e.target, e.name)) |inlined| {
                            p.printInlinedEnum(inlined, e.name, level);
                            return;
                        }
                    } else {
                        if (flags.contains(.has_non_optional_chain_parent)) {
                            wrap = true;
                            p.print("(");
                        }

                        flags.remove(.has_non_optional_chain_parent);
                    }
                    flags.setIntersection(ExprFlag.Set.init(.{ .has_non_optional_chain_parent = true, .forbid_call = true }));

                    p.printExpr(
                        e.target,
                        .postfix,
                        flags,
                    );

                    if (js_lexer.isIdentifier(e.name)) {
                        if (isOptionalChain) {
                            p.print("?.");
                        } else {
                            if (p.prev_num_end == p.writer.written) {
                                // "1.toString" is a syntax error, so print "1 .toString" instead
                                p.print(" ");
                            }

                            p.print(".");
                        }

                        p.addSourceMapping(e.name_loc);
                        p.printIdentifier(e.name);
                    } else {
                        if (isOptionalChain) {
                            p.print("?.[");
                        } else {
                            p.print("[");
                        }

                        p.printStringLiteralUTF8(e.name, false);

                        p.print("]");
                    }

                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_index => |e| {
                    var wrap = false;
                    if (e.optional_chain == null) {
                        flags.insert(.has_non_optional_chain_parent);

                        if (e.index.data.as(.e_string)) |str| {
                            str.resolveRopeIfNeeded(p.options.allocator);

                            if (str.isUTF8()) if (p.tryToGetImportedEnumValue(e.target, str.data)) |value| {
                                p.printInlinedEnum(value, str.data, level);
                                return;
                            };
                        }
                    } else {
                        if (flags.contains(.has_non_optional_chain_parent)) {
                            wrap = true;
                            p.print("(");
                        }
                        flags.remove(.has_non_optional_chain_parent);
                    }

                    p.printExpr(e.target, .postfix, flags);

                    const is_optional_chain_start = e.optional_chain == .start;
                    if (is_optional_chain_start) {
                        p.print("?.");
                    }

                    switch (e.index.data) {
                        .e_private_identifier => {
                            const priv = e.index.data.e_private_identifier;
                            if (!is_optional_chain_start) {
                                p.print(".");
                            }
                            p.addSourceMapping(e.index.loc);
                            p.printSymbol(priv.ref);
                        },
                        else => {
                            p.print("[");
                            p.addSourceMapping(e.index.loc);
                            p.printExpr(e.index, .lowest, ExprFlag.None());
                            p.print("]");
                        },
                    }

                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_if => |e| {
                    const wrap = level.gte(.conditional);
                    if (wrap) {
                        p.print("(");
                        flags.remove(.forbid_in);
                    }
                    p.printExpr(e.test_, .conditional, flags);
                    p.printSpace();
                    p.print("?");
                    p.printSpace();
                    p.printExpr(e.yes, .yield, ExprFlag.None());
                    p.printSpace();
                    p.print(":");
                    p.printSpace();
                    flags.insert(.forbid_in);
                    p.printExpr(e.no, .yield, flags);
                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_arrow => |e| {
                    const wrap = level.gte(.assign);

                    if (wrap) {
                        p.print("(");
                    }

                    if (e.is_async) {
                        p.addSourceMapping(expr.loc);
                        p.printSpaceBeforeIdentifier();
                        p.print("async");
                        p.printSpace();
                    }

                    p.printFnArgs(if (e.is_async) null else expr.loc, e.args, e.has_rest_arg, true);
                    p.printWhitespacer(ws(" => "));

                    var wasPrinted = false;
                    if (e.body.stmts.len == 1 and e.prefer_expr) {
                        switch (e.body.stmts[0].data) {
                            .s_return => {
                                if (e.body.stmts[0].data.s_return.value) |val| {
                                    p.arrow_expr_start = p.writer.written;
                                    p.printExpr(val, .comma, ExprFlag.Set.init(.{ .forbid_in = true }));
                                    wasPrinted = true;
                                }
                            },
                            else => {},
                        }
                    }

                    if (!wasPrinted) {
                        p.printBlock(e.body.loc, e.body.stmts, null);
                    }

                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_function => |e| {
                    const n = p.writer.written;
                    const wrap = p.stmt_start == n or p.export_default_start == n;

                    if (wrap) {
                        p.print("(");
                    }

                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    if (e.func.flags.contains(.is_async)) {
                        p.print("async ");
                    }
                    p.print("function");
                    if (e.func.flags.contains(.is_generator)) {
                        p.print("*");
                        p.printSpace();
                    }

                    if (e.func.name) |sym| {
                        p.printSpaceBeforeIdentifier();
                        p.addSourceMapping(sym.loc);
                        p.printSymbol(sym.ref orelse Output.panic("internal error: expected E.Function's name symbol to have a ref\n{any}", .{e.func}));
                    }

                    p.printFunc(e.func);
                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_class => |e| {
                    const n = p.writer.written;
                    const wrap = p.stmt_start == n or p.export_default_start == n;
                    if (wrap) {
                        p.print("(");
                    }

                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.print("class");
                    if (e.class_name) |name| {
                        p.print(" ");
                        p.addSourceMapping(name.loc);
                        p.printSymbol(name.ref orelse Output.panic("internal error: expected E.Class's name symbol to have a ref\n{any}", .{e}));
                    }
                    p.printClass(e.*);
                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_array => |e| {
                    p.addSourceMapping(expr.loc);
                    p.print("[");
                    const items = e.items.slice();
                    if (items.len > 0) {
                        if (!e.is_single_line) {
                            p.indent();
                        }

                        for (items, 0..) |item, i| {
                            if (i != 0) {
                                p.print(",");
                                if (e.is_single_line) {
                                    p.printSpace();
                                }
                            }
                            if (!e.is_single_line) {
                                p.printNewline();
                                p.printIndent();
                            }
                            p.printExpr(item, .comma, ExprFlag.None());

                            if (i == items.len - 1 and item.data == .e_missing) {
                                // Make sure there's a comma after trailing missing items
                                p.print(",");
                            }
                        }

                        if (!e.is_single_line) {
                            p.unindent();
                            p.printNewline();
                            p.printIndent();
                        }
                    }

                    if (e.close_bracket_loc.start > expr.loc.start) {
                        p.addSourceMapping(e.close_bracket_loc);
                    }

                    p.print("]");
                },
                .e_object => |e| {
                    const n = p.writer.written;
                    const wrap = if (comptime is_json)
                        false
                    else
                        p.stmt_start == n or p.arrow_expr_start == n;

                    if (wrap) {
                        p.print("(");
                    }
                    p.addSourceMapping(expr.loc);
                    p.print("{");
                    const props = expr.data.e_object.properties.slice();
                    if (props.len > 0) {
                        if (!e.is_single_line) {
                            p.indent();
                        }

                        if (e.is_single_line and !is_json) {
                            p.printSpace();
                        } else {
                            p.printNewline();
                            p.printIndent();
                        }
                        p.printProperty(props[0]);

                        if (props.len > 1) {
                            for (props[1..]) |property| {
                                p.print(",");

                                if (e.is_single_line and !is_json) {
                                    p.printSpace();
                                } else {
                                    p.printNewline();
                                    p.printIndent();
                                }
                                p.printProperty(property);
                            }
                        }

                        if (e.is_single_line and !is_json) {
                            p.printSpace();
                        } else {
                            p.unindent();
                            p.printNewline();
                            p.printIndent();
                        }
                    }
                    if (e.close_brace_loc.start > expr.loc.start) {
                        p.addSourceMapping(e.close_brace_loc);
                    }
                    p.print("}");
                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_boolean => |e| {
                    p.addSourceMapping(expr.loc);
                    if (p.options.minify_syntax) {
                        if (level.gte(Level.prefix)) {
                            p.print(if (e.value) "(!0)" else "(!1)");
                        } else {
                            p.print(if (e.value) "!0" else "!1");
                        }
                    } else {
                        p.printSpaceBeforeIdentifier();
                        p.print(if (e.value) "true" else "false");
                    }
                },
                .e_string => |e| {
                    e.resolveRopeIfNeeded(p.options.allocator);
                    p.addSourceMapping(expr.loc);

                    // If this was originally a template literal, print it as one as long as we're not minifying
                    if (e.prefer_template and !p.options.minify_syntax) {
                        p.print("`");
                        p.printStringCharactersEString(e, '`');
                        p.print("`");
                        return;
                    }

                    p.printStringLiteralEString(e, true);
                },
                .e_template => |e| {
                    if (e.tag == null and (p.options.minify_syntax or p.was_lazy_export)) {
                        var replaced = std.ArrayList(E.TemplatePart).init(p.options.allocator);
                        for (e.parts, 0..) |_part, i| {
                            var part = _part;
                            const inlined_value: ?js_ast.Expr = switch (part.value.data) {
                                .e_name_of_symbol => |e2| Expr.init(
                                    E.String,
                                    E.String.init(p.mangledPropName(e2.ref)),
                                    part.value.loc,
                                ),
                                .e_dot => brk: {
                                    // TODO: handle inlining of dot properties
                                    break :brk null;
                                },
                                else => null,
                            };

                            if (inlined_value) |value| {
                                if (replaced.items.len == 0) {
                                    replaced.appendSlice(e.parts[0..i]) catch bun.outOfMemory();
                                }
                                part.value = value;
                                replaced.append(part) catch bun.outOfMemory();
                            } else if (replaced.items.len > 0) {
                                replaced.append(part) catch bun.outOfMemory();
                            }
                        }

                        if (replaced.items.len > 0) {
                            var copy = e.*;
                            copy.parts = replaced.items;
                            const e2 = copy.fold(p.options.allocator, expr.loc);
                            switch (e2.data) {
                                .e_string => {
                                    p.print('"');
                                    p.printStringCharactersUTF8(e2.data.e_string.data, '"');
                                    p.print('"');
                                    return;
                                },
                                .e_template => {
                                    e.* = e2.data.e_template.*;
                                },
                                else => {},
                            }
                        }

                        // Convert no-substitution template literals into strings if it's smaller
                        if (e.parts.len == 0) {
                            p.addSourceMapping(expr.loc);
                            p.printStringCharactersEString(&e.head.cooked, '`');
                            return;
                        }
                    }

                    if (e.tag) |tag| {
                        p.addSourceMapping(expr.loc);
                        // Optional chains are forbidden in template tags
                        if (expr.isOptionalChain()) {
                            p.print("(");
                            p.printExpr(tag, .lowest, ExprFlag.None());
                            p.print(")");
                        } else {
                            p.printExpr(tag, .postfix, ExprFlag.None());
                        }
                    } else {
                        p.addSourceMapping(expr.loc);
                    }

                    p.print("`");
                    switch (e.head) {
                        .raw => |raw| p.printRawTemplateLiteral(raw),
                        .cooked => |*cooked| {
                            if (cooked.isPresent()) {
                                cooked.resolveRopeIfNeeded(p.options.allocator);
                                p.printStringCharactersEString(cooked, '`');
                            }
                        },
                    }

                    for (e.parts) |*part| {
                        p.print("${");
                        p.printExpr(part.value, .lowest, ExprFlag.None());
                        p.print("}");
                        switch (part.tail) {
                            .raw => |raw| p.printRawTemplateLiteral(raw),
                            .cooked => |*cooked| {
                                if (cooked.isPresent()) {
                                    cooked.resolveRopeIfNeeded(p.options.allocator);
                                    p.printStringCharactersEString(cooked, '`');
                                }
                            },
                        }
                    }
                    p.print("`");
                },
                .e_reg_exp => |e| {
                    p.addSourceMapping(expr.loc);
                    p.printRegExpLiteral(e);
                },
                .e_big_int => |e| {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.print(e.value);
                    p.print('n');
                },
                .e_number => |e| {
                    p.addSourceMapping(expr.loc);
                    p.printNumber(e.value, level);
                },
                .e_identifier => |e| {
                    const name = p.renamer.nameForSymbol(e.ref);
                    const wrap = p.writer.written == p.for_of_init_start and strings.eqlComptime(name, "let");

                    if (wrap) {
                        p.print("(");
                    }

                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.printIdentifier(name);

                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_import_identifier => |e| {
                    // Potentially use a property access instead of an identifier
                    var didPrint = false;

                    const ref = if (p.options.module_type != .internal_bake_dev)
                        p.symbols().follow(e.ref)
                    else
                        e.ref;
                    const symbol = p.symbols().get(ref).?;

                    // if (bun.strings.eql(symbol.original_name, "registerClientReference")) {
                    //     @breakpoint();
                    // }

                    if (symbol.import_item_status == .missing) {
                        p.printUndefined(expr.loc, level);
                        didPrint = true;
                    } else if (symbol.namespace_alias) |namespace| {
                        if (namespace.import_record_index < p.import_records.len) {
                            const import_record = p.importRecord(namespace.import_record_index);
                            if (namespace.was_originally_property_access) {
                                var wrap = false;
                                didPrint = true;

                                if (p.call_target) |target| {
                                    wrap = e.was_originally_identifier and (target == .e_identifier and
                                        target.e_identifier.ref.eql(expr.data.e_import_identifier.ref));
                                }

                                if (wrap) {
                                    p.printWhitespacer(ws("(0, "));
                                }
                                p.printSpaceBeforeIdentifier();
                                p.addSourceMapping(expr.loc);
                                p.printNamespaceAlias(import_record.*, namespace);

                                if (wrap) {
                                    p.print(")");
                                }
                            } else if (import_record.was_originally_require and import_record.path.is_disabled) {
                                p.addSourceMapping(expr.loc);

                                if (import_record.handles_import_errors) {
                                    p.printRequireError(import_record.path.text);
                                } else {
                                    p.printDisabledImport();
                                }
                                didPrint = true;
                            }
                        }

                        if (!didPrint) {
                            didPrint = true;

                            const wrap = if (p.call_target) |target|
                                e.was_originally_identifier and (target == .e_identifier and
                                    target.e_identifier.ref.eql(expr.data.e_import_identifier.ref))
                            else
                                false;

                            if (wrap) {
                                p.printWhitespacer(ws("(0, "));
                            }

                            p.printSpaceBeforeIdentifier();
                            p.addSourceMapping(expr.loc);
                            p.printSymbol(namespace.namespace_ref);
                            const alias = namespace.alias;
                            if (js_lexer.isIdentifier(alias)) {
                                p.print(".");
                                // TODO: addSourceMappingForName
                                p.printIdentifier(alias);
                            } else {
                                p.print("[");
                                // TODO: addSourceMappingForName
                                // p.addSourceMappingForName(alias);
                                p.printStringLiteralUTF8(alias, false);
                                p.print("]");
                            }

                            if (wrap) {
                                p.print(")");
                            }
                        }
                    }
                    // else if (p.options.const_values.get(ref)) |const_value| {
                    //     p.printSpaceBeforeIdentifier();
                    //     // TODO: addSourceMappingForName
                    //     // p.addSourceMappingForName(renamer.nameForSymbol(e.ref));
                    //     p.addSourceMapping(expr.loc);
                    //     p.printExpr(const_value, level, flags);
                    //     didPrint = true;
                    // }

                    if (!didPrint) {
                        p.printSpaceBeforeIdentifier();
                        p.addSourceMapping(expr.loc);
                        p.printSymbol(e.ref);
                    }
                },
                .e_await => |e| {
                    const wrap = level.gte(.prefix);

                    if (wrap) {
                        p.print("(");
                    }

                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.print("await");
                    p.printSpace();
                    p.printExpr(e.value, Level.sub(.prefix, 1), ExprFlag.None());

                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_yield => |e| {
                    const wrap = level.gte(.assign);
                    if (wrap) {
                        p.print("(");
                    }

                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(expr.loc);
                    p.print("yield");

                    if (e.value) |val| {
                        if (e.is_star) {
                            p.print("*");
                        }
                        p.printSpace();
                        p.printExpr(val, .yield, ExprFlag.None());
                    }

                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_unary => |e| {
                    // 4.00 ms  eums.EnumIndexer(src.js_ast.Op.Code).indexOf
                    const entry: *const Op = Op.Table.getPtrConst(e.op);
                    const wrap = level.gte(entry.level);

                    if (wrap) {
                        p.print("(");
                    }

                    if (!e.op.isPrefix()) {
                        p.printExpr(e.value, Op.Level.sub(.postfix, 1), ExprFlag.None());
                    }

                    if (entry.is_keyword) {
                        p.printSpaceBeforeIdentifier();
                        p.addSourceMapping(expr.loc);
                        p.print(entry.text);
                        p.printSpace();
                    } else {
                        p.printSpaceBeforeOperator(e.op);
                        p.print(entry.text);
                        p.prev_op = e.op;
                        p.prev_op_end = p.writer.written;
                    }

                    if (e.op.isPrefix()) {
                        p.printExpr(e.value, Op.Level.sub(.prefix, 1), ExprFlag.None());
                    }

                    if (wrap) {
                        p.print(")");
                    }
                },
                .e_binary => |e| {
                    // The handling of binary expressions is convoluted because we're using
                    // iteration on the heap instead of recursion on the call stack to avoid
                    // stack overflow for deeply-nested ASTs. See the comments for the similar
                    // code in the JavaScript parser for details.
                    var v = BinaryExpressionVisitor{
                        .e = e,
                        .level = level,
                        .flags = flags,
                        .entry = Op.Table.getPtrConst(e.op),
                    };

                    // Use a single stack to reduce allocation overhead
                    const stack_bottom = p.binary_expression_stack.items.len;

                    while (true) {
                        if (!v.checkAndPrepare(p)) {
                            break;
                        }

                        const left = v.e.left;
                        const left_binary: ?*E.Binary = if (left.data == .e_binary) left.data.e_binary else null;

                        // Stop iterating if iteration doesn't apply to the left node
                        if (left_binary == null) {
                            p.printExpr(left, v.left_level, v.left_flags);
                            v.visitRightAndFinish(p);
                            break;
                        }

                        // Only allocate heap memory on the stack for nested binary expressions
                        p.binary_expression_stack.append(v) catch bun.outOfMemory();
                        v = BinaryExpressionVisitor{
                            .e = left_binary.?,
                            .level = v.left_level,
                            .flags = v.left_flags,
                        };
                    }

                    // Process all binary operations from the deepest-visited node back toward
                    // our original top-level binary operation
                    while (p.binary_expression_stack.items.len > stack_bottom) {
                        var last = p.binary_expression_stack.pop().?;
                        last.visitRightAndFinish(p);
                    }
                },
                .e_inlined_enum => |e| {
                    p.printExpr(e.value, level, flags);
                    if (!p.options.minify_whitespace and !p.options.minify_identifiers) {
                        p.print(" /* ");
                        p.print(e.comment);
                        p.print(" */");
                    }
                },
                .e_name_of_symbol => |e| {
                    const name = p.mangledPropName(e.ref);
                    p.addSourceMappingForName(expr.loc, name, e.ref);

                    if (!p.options.minify_whitespace and e.has_property_key_comment) {
                        p.print(" /* @__KEY__ */");
                    }

                    p.print('"');
                    p.printStringCharactersUTF8(name, '"');
                    p.print('"');
                },

                .e_jsx_element,
                .e_private_identifier,
                => {
                    if (Environment.isDebug)
                        Output.panic("Unexpected expression of type .{s}", .{@tagName(expr.data)});
                },
            }
        }

        pub fn printSpaceBeforeOperator(p: *Printer, next: Op.Code) void {
            if (p.prev_op_end == p.writer.written) {
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
                    (prev == Op.Code.un_not and next == Op.Code.un_pre_dec and p.writer.written > 1 and p.writer.prevPrevChar() == '<'))
                {
                    p.print(" ");
                }
            }
        }

        pub inline fn printDotThenSuffix(p: *Printer) void {
            p.print(")");
        }

        // This assumes the string has already been quoted.
        pub fn printStringCharactersEString(p: *Printer, str: *const E.String, c: u8) void {
            if (!str.isUTF8()) {
                p.printStringCharactersUTF16(str.slice16(), c);
            } else {
                p.printStringCharactersUTF8(str.data, c);
            }
        }

        pub fn printNamespaceAlias(p: *Printer, _: ImportRecord, namespace: G.NamespaceAlias) void {
            p.printSymbol(namespace.namespace_ref);

            // In the case of code like this:
            // module.exports = require("foo")
            // if "foo" is bundled
            // then we access it as the namespace symbol itself
            // that means the namespace alias is empty
            if (namespace.alias.len == 0) return;

            if (js_lexer.isIdentifier(namespace.alias)) {
                p.print(".");
                p.printIdentifier(namespace.alias);
            } else {
                p.print("[");
                p.printStringLiteralUTF8(namespace.alias, false);
                p.print("]");
            }
        }

        pub fn printRegExpLiteral(p: *Printer, e: *const E.RegExp) void {
            const n = p.writer.written;

            // Avoid forming a single-line comment
            if (n > 0 and p.writer.prevChar() == '/') {
                p.print(" ");
            }

            if (comptime is_bun_platform) {
                // Translate any non-ASCII to unicode escape sequences
                var ascii_start: usize = 0;
                var is_ascii = false;
                var iter = CodepointIterator.init(e.value);
                var cursor = CodepointIterator.Cursor{};
                while (iter.next(&cursor)) {
                    switch (cursor.c) {
                        first_ascii...last_ascii => {
                            if (!is_ascii) {
                                ascii_start = cursor.i;
                                is_ascii = true;
                            }
                        },
                        else => {
                            if (is_ascii) {
                                p.print(e.value[ascii_start..cursor.i]);
                                is_ascii = false;
                            }

                            switch (cursor.c) {
                                0...0xFFFF => {
                                    p.print([_]u8{
                                        '\\',
                                        'u',
                                        hex_chars[cursor.c >> 12],
                                        hex_chars[(cursor.c >> 8) & 15],
                                        hex_chars[(cursor.c >> 4) & 15],
                                        hex_chars[cursor.c & 15],
                                    });
                                },

                                else => |c| {
                                    const k = c - 0x10000;
                                    const lo = @as(usize, @intCast(first_high_surrogate + ((k >> 10) & 0x3FF)));
                                    const hi = @as(usize, @intCast(first_low_surrogate + (k & 0x3FF)));

                                    p.print(&[_]u8{
                                        '\\',
                                        'u',
                                        hex_chars[lo >> 12],
                                        hex_chars[(lo >> 8) & 15],
                                        hex_chars[(lo >> 4) & 15],
                                        hex_chars[lo & 15],
                                        '\\',
                                        'u',
                                        hex_chars[hi >> 12],
                                        hex_chars[(hi >> 8) & 15],
                                        hex_chars[(hi >> 4) & 15],
                                        hex_chars[hi & 15],
                                    });
                                },
                            }
                        },
                    }
                }

                if (is_ascii) {
                    p.print(e.value[ascii_start..]);
                }
            } else {
                // UTF8 sequence is fine
                p.print(e.value);
            }

            // Need a space before the next identifier to avoid it turning into flags
            p.prev_reg_exp_end = p.writer.written;
        }

        pub fn printProperty(p: *Printer, item_in: G.Property) void {
            var item = item_in;
            if (comptime !is_json) {
                if (item.kind == .spread) {
                    if (comptime is_json and Environment.allow_assert)
                        unreachable;
                    p.print("...");
                    p.printExpr(item.value.?, .comma, ExprFlag.None());
                    return;
                }

                // Handle key syntax compression for cross-module constant inlining of enums
                if (p.options.minify_syntax and item.flags.contains(.is_computed)) {
                    if (item.key.?.data.as(.e_dot)) |dot| {
                        if (p.tryToGetImportedEnumValue(dot.target, dot.name)) |value| {
                            switch (value) {
                                .string => |str| {
                                    item.key.?.data = .{ .e_string = str };

                                    // Problematic key names must stay computed for correctness
                                    if (!str.eqlComptime("__proto__") and !str.eqlComptime("constructor") and !str.eqlComptime("prototype")) {
                                        item.flags.setPresent(.is_computed, false);
                                    }
                                },
                                .number => |num| {
                                    item.key.?.data = .{ .e_number = .{ .value = num } };
                                    item.flags.setPresent(.is_computed, false);
                                },
                            }
                        }
                    }
                }

                if (item.flags.contains(.is_static)) {
                    if (comptime is_json and Environment.allow_assert)
                        unreachable;
                    p.print("static");
                    p.printSpace();
                }

                switch (item.kind) {
                    .get => {
                        if (comptime is_json and Environment.allow_assert)
                            unreachable;
                        p.printSpaceBeforeIdentifier();
                        p.print("get");
                        p.printSpace();
                    },
                    .set => {
                        if (comptime is_json and Environment.allow_assert)
                            unreachable;
                        p.printSpaceBeforeIdentifier();
                        p.print("set");
                        p.printSpace();
                    },
                    else => {},
                }

                if (item.value) |val| {
                    switch (val.data) {
                        .e_function => |func| {
                            if (item.flags.contains(.is_method)) {
                                if (func.func.flags.contains(.is_async)) {
                                    p.printSpaceBeforeIdentifier();
                                    p.print("async");
                                }

                                if (func.func.flags.contains(.is_generator)) {
                                    p.print("*");
                                }

                                if (func.func.flags.contains(.is_generator) and func.func.flags.contains(.is_async)) {
                                    p.printSpace();
                                }
                            }
                        },
                        else => {},
                    }

                    // If var is declared in a parent scope and var is then written via destructuring pattern, key is null
                    // example:
                    //  var foo = 1;
                    //  if (true) {
                    //      var { foo } = { foo: 2 };
                    //  }
                    if (item.key == null) {
                        p.printExpr(val, .comma, ExprFlag.None());
                        return;
                    }
                }
            }

            const _key = item.key.?;

            if (!is_json and item.flags.contains(.is_computed)) {
                p.print("[");
                p.printExpr(_key, .comma, ExprFlag.None());
                p.print("]");

                if (item.value) |val| {
                    switch (val.data) {
                        .e_function => |func| {
                            if (item.flags.contains(.is_method)) {
                                p.printFunc(func.func);
                                return;
                            }
                        },
                        else => {},
                    }

                    p.print(":");
                    p.printSpace();
                    p.printExpr(val, .comma, ExprFlag.None());
                }

                if (item.initializer) |initial| {
                    p.printInitializer(initial);
                }
                return;
            }

            switch (_key.data) {
                .e_private_identifier => |priv| {
                    if (comptime is_json) {
                        unreachable;
                    }

                    p.addSourceMapping(_key.loc);
                    p.printSymbol(priv.ref);
                },
                .e_string => |key| {
                    p.addSourceMapping(_key.loc);
                    if (key.isUTF8()) {
                        key.resolveRopeIfNeeded(p.options.allocator);
                        p.printSpaceBeforeIdentifier();
                        var allow_shorthand: bool = true;
                        // In react/cjs/react.development.js, there's part of a function like this:
                        // var escaperLookup = {
                        //     "=": "=0",
                        //     ":": "=2"
                        //   };
                        // While each of those property keys are ASCII, a subset of ASCII is valid as the start of an identifier
                        // "=" and ":" are not valid
                        // So we need to check
                        if (!is_json and js_lexer.isIdentifier(key.data)) {
                            p.printIdentifier(key.data);
                        } else {
                            allow_shorthand = false;
                            p.printStringLiteralEString(key, false);
                        }

                        // Use a shorthand property if the names are the same
                        if (item.value) |val| {
                            switch (val.data) {
                                .e_identifier => |e| {
                                    if (key.eql(string, p.renamer.nameForSymbol(e.ref))) {
                                        if (item.initializer) |initial| {
                                            p.printInitializer(initial);
                                        }
                                        if (allow_shorthand) {
                                            return;
                                        }
                                    }
                                },
                                .e_import_identifier => |e| inner: {
                                    const ref = p.symbols().follow(e.ref);
                                    if (p.options.input_files_for_dev_server != null)
                                        break :inner;
                                    // if (p.options.const_values.count() > 0 and p.options.const_values.contains(ref))
                                    //     break :inner;

                                    if (p.symbols().get(ref)) |symbol| {
                                        if (symbol.namespace_alias == null and strings.eql(key.data, p.renamer.nameForSymbol(e.ref))) {
                                            if (item.initializer) |initial| {
                                                p.printInitializer(initial);
                                            }
                                            if (allow_shorthand) {
                                                return;
                                            }
                                        }
                                    }
                                },
                                else => {},
                            }
                        }
                    } else if (!is_json and p.canPrintIdentifierUTF16(key.slice16())) {
                        p.printSpaceBeforeIdentifier();
                        p.printIdentifierUTF16(key.slice16()) catch unreachable;

                        // Use a shorthand property if the names are the same
                        if (item.value) |val| {
                            switch (val.data) {
                                .e_identifier => |e| {

                                    // TODO: is needing to check item.flags.contains(.was_shorthand) a bug?
                                    // esbuild doesn't have to do that...
                                    // maybe it's a symptom of some other underlying issue
                                    // or maybe, it's because i'm not lowering the same way that esbuild does.
                                    if (item.flags.contains(.was_shorthand) or strings.utf16EqlString(key.slice16(), p.renamer.nameForSymbol(e.ref))) {
                                        if (item.initializer) |initial| {
                                            p.printInitializer(initial);
                                        }
                                        return;
                                    }
                                    // if (strings) {}
                                },
                                // .e_import_identifier => |e| inner: {
                                .e_import_identifier => |e| {
                                    const ref = p.symbols().follow(e.ref);

                                    // if (p.options.const_values.count() > 0 and p.options.const_values.contains(ref))
                                    //     break :inner;

                                    if (p.symbols().get(ref)) |symbol| {
                                        if (symbol.namespace_alias == null and strings.utf16EqlString(key.slice16(), p.renamer.nameForSymbol(e.ref))) {
                                            if (item.initializer) |initial| {
                                                p.printInitializer(initial);
                                            }
                                            return;
                                        }
                                    }
                                },
                                else => {},
                            }
                        }
                    } else {
                        const c = bestQuoteCharForString(u16, key.slice16(), false);
                        p.print(c);
                        p.printStringCharactersUTF16(key.slice16(), c);
                        p.print(c);
                    }
                },
                else => {
                    if (comptime is_json) {
                        unreachable;
                    }

                    p.printExpr(_key, .lowest, ExprFlag.Set{});
                },
            }

            if (item.kind != .normal) {
                if (comptime is_json) {
                    bun.unreachablePanic("item.kind must be normal in json, received: {any}", .{item.kind});
                }

                switch (item.value.?.data) {
                    .e_function => |func| {
                        p.printFunc(func.func);
                        return;
                    },
                    else => {},
                }
            }

            if (item.value) |val| {
                switch (val.data) {
                    .e_function => |f| {
                        if (item.flags.contains(.is_method)) {
                            p.printFunc(f.func);

                            return;
                        }
                    },
                    else => {},
                }

                p.print(":");
                p.printSpace();
                p.printExpr(val, .comma, ExprFlag.Set{});
            }

            if (comptime is_json) {
                bun.assert(item.initializer == null);
            }

            if (item.initializer) |initial| {
                p.printInitializer(initial);
            }
        }

        pub fn printInitializer(p: *Printer, initial: Expr) void {
            p.printSpace();
            p.print("=");
            p.printSpace();
            p.printExpr(initial, .comma, ExprFlag.None());
        }

        pub fn printBinding(p: *Printer, binding: Binding) void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |b| {
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(binding.loc);
                    p.printSymbol(b.ref);
                },
                .b_array => |b| {
                    p.print("[");
                    if (b.items.len > 0) {
                        if (!b.is_single_line) {
                            p.indent();
                        }

                        for (b.items, 0..) |*item, i| {
                            if (i != 0) {
                                p.print(",");
                                if (b.is_single_line) {
                                    p.printSpace();
                                }
                            }

                            if (!b.is_single_line) {
                                p.printNewline();
                                p.printIndent();
                            }

                            const is_last = i + 1 == b.items.len;
                            if (b.has_spread and is_last) {
                                p.print("...");
                            }

                            p.printBinding(item.binding);

                            p.maybePrintDefaultBindingValue(item);

                            // Make sure there's a comma after trailing missing items
                            if (is_last and item.binding.data == .b_missing) {
                                p.print(",");
                            }
                        }

                        if (!b.is_single_line) {
                            p.unindent();
                            p.printNewline();
                            p.printIndent();
                        }
                    }

                    p.print("]");
                },
                .b_object => |b| {
                    p.print("{");
                    if (b.properties.len > 0) {
                        if (!b.is_single_line) {
                            p.indent();
                        }

                        for (b.properties, 0..) |*property, i| {
                            if (i != 0) {
                                p.print(",");
                            }

                            if (b.is_single_line) {
                                p.printSpace();
                            } else {
                                p.printNewline();
                                p.printIndent();
                            }

                            if (property.flags.contains(.is_spread)) {
                                p.print("...");
                            } else {
                                if (property.flags.contains(.is_computed)) {
                                    p.print("[");
                                    p.printExpr(property.key, .comma, ExprFlag.None());
                                    p.print("]:");
                                    p.printSpace();

                                    p.printBinding(property.value);
                                    p.maybePrintDefaultBindingValue(property);
                                    continue;
                                }

                                switch (property.key.data) {
                                    .e_string => |str| {
                                        str.resolveRopeIfNeeded(p.options.allocator);
                                        p.addSourceMapping(property.key.loc);

                                        if (str.isUTF8()) {
                                            p.printSpaceBeforeIdentifier();
                                            // Example case:
                                            //      const Menu = React.memo(function Menu({
                                            //          aria-label: ariaLabel,
                                            //              ^
                                            // That needs to be:
                                            //          "aria-label": ariaLabel,
                                            if (js_lexer.isIdentifier(str.data)) {
                                                p.printIdentifier(str.data);

                                                // Use a shorthand property if the names are the same
                                                switch (property.value.data) {
                                                    .b_identifier => |id| {
                                                        if (str.eql(string, p.renamer.nameForSymbol(id.ref))) {
                                                            p.maybePrintDefaultBindingValue(property);
                                                            continue;
                                                        }
                                                    },
                                                    else => {},
                                                }
                                            } else {
                                                p.printStringLiteralUTF8(str.data, false);
                                            }
                                        } else if (p.canPrintIdentifierUTF16(str.slice16())) {
                                            p.printSpaceBeforeIdentifier();
                                            p.printIdentifierUTF16(str.slice16()) catch unreachable;

                                            // Use a shorthand property if the names are the same
                                            switch (property.value.data) {
                                                .b_identifier => |id| {
                                                    if (strings.utf16EqlString(str.slice16(), p.renamer.nameForSymbol(id.ref))) {
                                                        p.maybePrintDefaultBindingValue(property);
                                                        continue;
                                                    }
                                                },
                                                else => {},
                                            }
                                        } else {
                                            p.printExpr(property.key, .lowest, ExprFlag.None());
                                        }
                                    },
                                    else => {
                                        p.printExpr(property.key, .lowest, ExprFlag.None());
                                    },
                                }

                                p.print(":");
                                p.printSpace();
                            }

                            p.printBinding(property.value);
                            p.maybePrintDefaultBindingValue(property);
                        }

                        if (!b.is_single_line) {
                            p.unindent();
                            p.printNewline();
                            p.printIndent();
                        } else {
                            p.printSpace();
                        }
                    }
                    p.print("}");
                },
            }
        }

        pub fn maybePrintDefaultBindingValue(p: *Printer, property: anytype) void {
            if (property.default_value) |default| {
                p.printSpace();
                p.print("=");
                p.printSpace();
                p.printExpr(default, .comma, ExprFlag.None());
            }
        }

        pub fn printStmt(p: *Printer, stmt: Stmt) !void {
            const prev_stmt_tag = p.prev_stmt_tag;

            defer {
                p.prev_stmt_tag = std.meta.activeTag(stmt.data);
            }

            switch (stmt.data) {
                .s_comment => |s| {
                    p.printIndentedComment(s.text);
                },
                .s_function => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    const name = s.func.name orelse Output.panic("Internal error: expected func to have a name ref\n{any}", .{s});
                    const nameRef = name.ref orelse Output.panic("Internal error: expected func to have a name\n{any}", .{s});

                    if (s.func.flags.contains(.is_export)) {
                        if (!rewrite_esm_to_cjs) {
                            p.print("export ");
                        }
                    }
                    if (s.func.flags.contains(.is_async)) {
                        p.print("async ");
                    }
                    p.print("function");
                    if (s.func.flags.contains(.is_generator)) {
                        p.print("*");
                        p.printSpace();
                    } else {
                        p.printSpaceBeforeIdentifier();
                    }

                    p.addSourceMapping(name.loc);
                    p.printSymbol(nameRef);
                    p.printFunc(s.func);

                    // if (rewrite_esm_to_cjs and s.func.flags.contains(.is_export)) {
                    //     p.printSemicolonAfterStatement();
                    //     p.print("var ");
                    //     p.printSymbol(nameRef);
                    //     p.@"print = "();
                    //     p.printSymbol(nameRef);
                    //     p.printSemicolonAfterStatement();
                    // } else {
                    p.printNewline();
                    // }

                    if (rewrite_esm_to_cjs and s.func.flags.contains(.is_export)) {
                        p.printIndent();
                        p.printBundledExport(p.renamer.nameForSymbol(nameRef), p.renamer.nameForSymbol(nameRef));
                        p.printSemicolonAfterStatement();
                    }
                },
                .s_class => |s| {
                    // Give an extra newline for readaiblity
                    if (prev_stmt_tag != .s_empty) {
                        p.printNewline();
                    }

                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    const nameRef = s.class.class_name.?.ref.?;
                    if (s.is_export) {
                        if (!rewrite_esm_to_cjs) {
                            p.print("export ");
                        }
                    }

                    p.print("class ");
                    p.addSourceMapping(s.class.class_name.?.loc);
                    p.printSymbol(nameRef);
                    p.printClass(s.class);

                    if (rewrite_esm_to_cjs and s.is_export) {
                        p.printSemicolonAfterStatement();
                    } else {
                        p.printNewline();
                    }

                    if (rewrite_esm_to_cjs) {
                        if (s.is_export) {
                            p.printIndent();
                            p.printBundledExport(p.renamer.nameForSymbol(nameRef), p.renamer.nameForSymbol(nameRef));
                            p.printSemicolonAfterStatement();
                        }
                    }
                },
                .s_empty => {
                    if (p.prev_stmt_tag == .s_empty and p.options.indent.count == 0) return;

                    p.printIndent();
                    p.addSourceMapping(stmt.loc);
                    p.print(";");
                    p.printNewline();
                },
                .s_export_default => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("export default ");

                    switch (s.value) {
                        .expr => |expr| {

                            // Functions and classes must be wrapped to avoid confusion with their statement forms
                            p.export_default_start = p.writer.written;
                            p.printExpr(expr, .comma, ExprFlag.None());
                            p.printSemicolonAfterStatement();
                            return;
                        },

                        .stmt => |s2| {
                            switch (s2.data) {
                                .s_function => |func| {
                                    p.printSpaceBeforeIdentifier();

                                    if (func.func.flags.contains(.is_async)) {
                                        p.print("async ");
                                    }
                                    p.print("function");

                                    if (func.func.flags.contains(.is_generator)) {
                                        p.print("*");
                                        p.printSpace();
                                    } else {
                                        p.maybePrintSpace();
                                    }

                                    if (func.func.name) |name| {
                                        p.printSymbol(name.ref.?);
                                    }

                                    p.printFunc(func.func);

                                    p.printNewline();
                                },
                                .s_class => |class| {
                                    p.printSpaceBeforeIdentifier();

                                    if (class.class.class_name) |name| {
                                        p.print("class ");
                                        p.printSymbol(name.ref orelse Output.panic("Internal error: Expected class to have a name ref\n{any}", .{class}));
                                    } else {
                                        p.print("class");
                                    }

                                    p.printClass(class.class);

                                    p.printNewline();
                                },
                                else => {
                                    Output.panic("Internal error: unexpected export default stmt data {any}", .{s});
                                },
                            }
                        },
                    }
                },
                .s_export_star => |s| {

                    // Give an extra newline for readaiblity
                    if (!prev_stmt_tag.isExportLike()) {
                        p.printNewline();
                    }
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);

                    if (s.alias != null)
                        p.printWhitespacer(comptime ws("export *").append(" as "))
                    else
                        p.printWhitespacer(comptime ws("export * from "));

                    if (s.alias) |alias| {
                        p.printClauseAlias(alias.original_name);
                        p.print(" ");
                        p.printWhitespacer(ws("from "));
                    }

                    p.printImportRecordPath(p.importRecord(s.import_record_index));
                    p.printSemicolonAfterStatement();
                },
                .s_export_clause => |s| {
                    if (rewrite_esm_to_cjs) {
                        p.printIndent();
                        p.printSpaceBeforeIdentifier();
                        p.addSourceMapping(stmt.loc);

                        switch (s.items.len) {
                            0 => {},
                            // It unfortunately cannot be so simple as exports.foo = foo;
                            // If we have a lazy re-export and it's read-only...
                            // we have to overwrite it via Object.defineProperty

                            // Object.assign(__export, {prop1, prop2, prop3});
                            else => {
                                p.print("Object.assign");

                                p.print("(");
                                p.printModuleExportSymbol();
                                p.print(",");
                                p.printSpace();
                                p.print("{");
                                p.printSpace();
                                const last = s.items.len - 1;
                                for (s.items, 0..) |item, i| {
                                    const symbol = p.symbols().getWithLink(item.name.ref.?).?;
                                    const name = symbol.original_name;
                                    var did_print = false;

                                    if (symbol.namespace_alias) |namespace| {
                                        const import_record = p.importRecord(namespace.import_record_index);
                                        if (namespace.was_originally_property_access) {
                                            p.printIdentifier(name);
                                            p.print(": () => ");
                                            p.printNamespaceAlias(import_record.*, namespace);
                                            did_print = true;
                                        }
                                    }

                                    if (!did_print) {
                                        p.printClauseAlias(item.alias);
                                        if (!strings.eql(name, item.alias)) {
                                            p.print(":");
                                            p.printSpaceBeforeIdentifier();
                                            p.printIdentifier(name);
                                        }
                                    }

                                    if (i < last) {
                                        p.print(",");
                                    }
                                }
                                p.print("})");
                                p.printSemicolonAfterStatement();
                            },
                        }
                        return;
                    }

                    // Give an extra newline for export default for readability
                    if (!prev_stmt_tag.isExportLike()) {
                        p.printNewline();
                    }

                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("export");
                    p.printSpace();

                    if (s.items.len == 0) {
                        p.print("{}");
                        p.printSemicolonAfterStatement();
                        return;
                    }

                    // This transforms code like this:
                    // import {Foo, Bar} from 'bundled-module';
                    // export {Foo, Bar};
                    // into
                    // export var Foo = $$bundledModule.Foo; (where $$bundledModule is created at import time)
                    // This is necessary unfortunately because export statements do not allow dot expressions
                    // The correct approach here is to invert the logic
                    // instead, make the entire module behave like a CommonJS module
                    // and export that one instead
                    // This particular code segment does the transform inline by adding an extra pass over export clauses
                    // and then swapRemove'ing them as we go
                    var array = std.ArrayListUnmanaged(js_ast.ClauseItem){ .items = s.items, .capacity = s.items.len };
                    {
                        var i: usize = 0;
                        while (i < array.items.len) {
                            const item: js_ast.ClauseItem = array.items[i];

                            if (item.original_name.len > 0) {
                                if (p.symbols().get(item.name.ref.?)) |symbol| {
                                    if (symbol.namespace_alias) |namespace| {
                                        const import_record = p.importRecord(namespace.import_record_index);
                                        if (namespace.was_originally_property_access) {
                                            p.print("var ");
                                            p.printSymbol(item.name.ref.?);
                                            p.@"print = "();
                                            p.printNamespaceAlias(import_record.*, namespace);
                                            p.printSemicolonAfterStatement();
                                            _ = array.swapRemove(i);

                                            if (i < array.items.len) {
                                                p.printIndent();
                                                p.printSpaceBeforeIdentifier();
                                                p.print("export");
                                                p.printSpace();
                                            }

                                            continue;
                                        }
                                    }
                                }
                            }

                            i += 1;
                        }

                        if (array.items.len == 0) {
                            return;
                        }

                        s.items = array.items;
                    }

                    p.print("{");

                    if (!s.is_single_line) {
                        p.indent();
                    } else {
                        p.printSpace();
                    }

                    for (s.items, 0..) |item, i| {
                        if (i != 0) {
                            p.print(",");
                            if (s.is_single_line) {
                                p.printSpace();
                            }
                        }

                        if (!s.is_single_line) {
                            p.printNewline();
                            p.printIndent();
                        }

                        p.printExportClauseItem(item);
                    }

                    if (!s.is_single_line) {
                        p.unindent();
                        p.printNewline();
                        p.printIndent();
                    } else {
                        p.printSpace();
                    }

                    p.print("}");
                    p.printSemicolonAfterStatement();
                },
                .s_export_from => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);

                    const import_record = p.importRecord(s.import_record_index);

                    p.printWhitespacer(ws("export {"));

                    if (!s.is_single_line) {
                        p.indent();
                    } else {
                        p.printSpace();
                    }

                    for (s.items, 0..) |item, i| {
                        if (i != 0) {
                            p.print(",");
                            if (s.is_single_line) {
                                p.printSpace();
                            }
                        }

                        if (!s.is_single_line) {
                            p.printNewline();
                            p.printIndent();
                        }
                        p.printExportClauseItem(item);
                    }

                    if (!s.is_single_line) {
                        p.unindent();
                        p.printNewline();
                        p.printIndent();
                    } else {
                        p.printSpace();
                    }

                    p.printWhitespacer(ws("} from "));
                    p.printImportRecordPath(import_record);
                    p.printSemicolonAfterStatement();
                },
                .s_local => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    switch (s.kind) {
                        .k_const => {
                            p.printDeclStmt(s.is_export, "const", s.decls.slice());
                        },
                        .k_let => {
                            p.printDeclStmt(s.is_export, "let", s.decls.slice());
                        },
                        .k_var => {
                            p.printDeclStmt(s.is_export, "var", s.decls.slice());
                        },
                        .k_using => {
                            p.printDeclStmt(s.is_export, "using", s.decls.slice());
                        },
                        .k_await_using => {
                            p.printDeclStmt(s.is_export, "await using", s.decls.slice());
                        },
                    }
                },
                .s_if => |s| {
                    p.printIndent();
                    p.printIf(s, stmt.loc);
                },
                .s_do_while => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("do");
                    switch (s.body.data) {
                        .s_block => {
                            p.printSpace();
                            p.printBlock(s.body.loc, s.body.data.s_block.stmts, s.body.data.s_block.close_brace_loc);
                            p.printSpace();
                        },
                        else => {
                            p.printNewline();
                            p.indent();
                            p.printStmt(s.body) catch unreachable;
                            p.printSemicolonIfNeeded();
                            p.unindent();
                            p.printIndent();
                        },
                    }

                    p.print("while");
                    p.printSpace();
                    p.print("(");
                    p.printExpr(s.test_, .lowest, ExprFlag.None());
                    p.print(")");
                    p.printSemicolonAfterStatement();
                },
                .s_for_in => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("for");
                    p.printSpace();
                    p.print("(");
                    p.printForLoopInit(s.init);
                    p.printSpace();
                    p.printSpaceBeforeIdentifier();
                    p.print("in");
                    p.printSpace();
                    p.printExpr(s.value, .lowest, ExprFlag.None());
                    p.print(")");
                    p.printBody(s.body);
                },
                .s_for_of => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("for");
                    if (s.is_await) {
                        p.print(" await");
                    }
                    p.printSpace();
                    p.print("(");
                    p.for_of_init_start = p.writer.written;
                    p.printForLoopInit(s.init);
                    p.printSpace();
                    p.printSpaceBeforeIdentifier();
                    p.print("of");
                    p.printSpace();
                    p.printExpr(s.value, .comma, ExprFlag.None());
                    p.print(")");
                    p.printBody(s.body);
                },
                .s_while => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("while");
                    p.printSpace();
                    p.print("(");
                    p.printExpr(s.test_, .lowest, ExprFlag.None());
                    p.print(")");
                    p.printBody(s.body);
                },
                .s_with => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("with");
                    p.printSpace();
                    p.print("(");
                    p.printExpr(s.value, .lowest, ExprFlag.None());
                    p.print(")");
                    p.printBody(s.body);
                },
                .s_label => |s| {
                    if (!p.options.minify_whitespace and p.options.indent.count > 0) {
                        p.printIndent();
                    }
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.printSymbol(s.name.ref orelse Output.panic("Internal error: expected label to have a name {any}", .{s}));
                    p.print(":");
                    p.printBody(s.stmt);
                },
                .s_try => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("try");
                    p.printSpace();
                    p.printBlock(s.body_loc, s.body, null);

                    if (s.catch_) |catch_| {
                        p.printSpace();
                        p.addSourceMapping(catch_.loc);
                        p.print("catch");
                        if (catch_.binding) |binding| {
                            p.printSpace();
                            p.print("(");
                            p.printBinding(binding);
                            p.print(")");
                        }
                        p.printSpace();
                        p.printBlock(catch_.body_loc, catch_.body, null);
                    }

                    if (s.finally) |finally| {
                        p.printSpace();
                        p.print("finally");
                        p.printSpace();
                        p.printBlock(finally.loc, finally.stmts, null);
                    }

                    p.printNewline();
                },
                .s_for => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("for");
                    p.printSpace();
                    p.print("(");

                    if (s.init) |init_| {
                        p.printForLoopInit(init_);
                    }

                    p.print(";");

                    if (s.test_) |test_| {
                        p.printExpr(test_, .lowest, ExprFlag.None());
                    }

                    p.print(";");
                    p.printSpace();

                    if (s.update) |update| {
                        p.printExpr(update, .lowest, ExprFlag.None());
                    }

                    p.print(")");
                    p.printBody(s.body);
                },
                .s_switch => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("switch");
                    p.printSpace();
                    p.print("(");

                    p.printExpr(s.test_, .lowest, ExprFlag.None());

                    p.print(")");
                    p.printSpace();
                    p.print("{");
                    p.printNewline();
                    p.indent();

                    for (s.cases) |c| {
                        p.printSemicolonIfNeeded();
                        p.printIndent();

                        if (c.value) |val| {
                            p.print("case");
                            p.printSpace();
                            p.printExpr(val, .logical_and, ExprFlag.None());
                        } else {
                            p.print("default");
                        }

                        p.print(":");

                        if (c.body.len == 1) {
                            switch (c.body[0].data) {
                                .s_block => {
                                    p.printSpace();
                                    p.printBlock(c.body[0].loc, c.body[0].data.s_block.stmts, c.body[0].data.s_block.close_brace_loc);
                                    p.printNewline();
                                    continue;
                                },
                                else => {},
                            }
                        }

                        p.printNewline();
                        p.indent();
                        for (c.body) |st| {
                            p.printSemicolonIfNeeded();
                            p.printStmt(st) catch unreachable;
                        }
                        p.unindent();
                    }

                    p.unindent();
                    p.printIndent();
                    p.print("}");
                    p.printNewline();
                    p.needs_semicolon = false;
                },
                .s_import => |s| {
                    bun.assert(s.import_record_index < p.import_records.len);
                    bun.debugAssert(p.options.module_type != .internal_bake_dev);

                    const record: *const ImportRecord = p.importRecord(s.import_record_index);
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);

                    if (comptime is_bun_platform) {
                        switch (record.tag) {
                            .bun_test => {
                                p.printBunJestImportStatement(s.*);
                                return;
                            },
                            .bun => {
                                p.printGlobalBunImportStatement(s.*);
                                return;
                            },
                            else => {},
                        }
                    }

                    if (record.path.is_disabled) {
                        if (record.contains_import_star) {
                            p.print("var ");
                            p.printSymbol(s.namespace_ref);
                            p.@"print = "();
                            p.printDisabledImport();
                            p.printSemicolonAfterStatement();
                        }

                        if (s.items.len > 0 or s.default_name != null) {
                            p.printIndent();
                            p.printSpaceBeforeIdentifier();
                            p.printWhitespacer(ws("var {"));

                            if (s.default_name) |default_name| {
                                p.printSpace();
                                p.print("default:");
                                p.printSpace();
                                p.printSymbol(default_name.ref.?);

                                if (s.items.len > 0) {
                                    p.printSpace();
                                    p.print(",");
                                    p.printSpace();
                                    for (s.items, 0..) |item, i| {
                                        p.printClauseItemAs(item, .@"var");

                                        if (i < s.items.len - 1) {
                                            p.print(",");
                                            p.printSpace();
                                        }
                                    }
                                }
                            } else {
                                for (s.items, 0..) |item, i| {
                                    p.printClauseItemAs(item, .@"var");

                                    if (i < s.items.len - 1) {
                                        p.print(",");
                                        p.printSpace();
                                    }
                                }
                            }

                            p.print("}");
                            p.@"print = "();

                            if (record.contains_import_star) {
                                p.printSymbol(s.namespace_ref);
                                p.printSemicolonAfterStatement();
                            } else {
                                p.printDisabledImport();
                                p.printSemicolonAfterStatement();
                            }
                        }

                        return;
                    }

                    if (record.handles_import_errors and record.path.is_disabled and record.kind.isCommonJS()) {
                        return;
                    }

                    p.print("import");

                    var item_count: usize = 0;

                    if (s.default_name) |name| {
                        p.print(" ");
                        p.printSymbol(name.ref.?);
                        item_count += 1;
                    }

                    if (s.items.len > 0) {
                        if (item_count > 0) {
                            p.print(",");
                        }
                        p.printSpace();

                        p.print("{");
                        if (!s.is_single_line) {
                            p.indent();
                        } else {
                            p.printSpace();
                        }

                        for (s.items, 0..) |item, i| {
                            if (i != 0) {
                                p.print(",");
                                if (s.is_single_line) {
                                    p.printSpace();
                                }
                            }

                            if (!s.is_single_line) {
                                p.printNewline();
                                p.printIndent();
                            }

                            p.printClauseItem(item);
                        }

                        if (!s.is_single_line) {
                            p.unindent();
                            p.printNewline();
                            p.printIndent();
                        } else {
                            p.printSpace();
                        }
                        p.print("}");
                        item_count += 1;
                    }

                    if (record.contains_import_star) {
                        if (item_count > 0) {
                            p.print(",");
                        }
                        p.printSpace();

                        p.printWhitespacer(ws("* as"));
                        p.print(" ");
                        p.printSymbol(s.namespace_ref);
                        item_count += 1;
                    }

                    if (item_count > 0) {
                        if (!p.options.minify_whitespace or
                            record.contains_import_star or
                            s.items.len == 0)
                            p.print(" ");

                        p.printWhitespacer(ws("from "));
                    }

                    p.printImportRecordPath(record);

                    // backwards compatibility: previously, we always stripped type
                    if (comptime is_bun_platform) if (record.loader) |loader| switch (loader) {
                        .jsx => p.printWhitespacer(ws(" with { type: \"jsx\" }")),
                        .js => p.printWhitespacer(ws(" with { type: \"js\" }")),
                        .ts => p.printWhitespacer(ws(" with { type: \"ts\" }")),
                        .tsx => p.printWhitespacer(ws(" with { type: \"tsx\" }")),
                        .css => p.printWhitespacer(ws(" with { type: \"css\" }")),
                        .file => p.printWhitespacer(ws(" with { type: \"file\" }")),
                        .json => p.printWhitespacer(ws(" with { type: \"json\" }")),
                        .jsonc => p.printWhitespacer(ws(" with { type: \"jsonc\" }")),
                        .toml => p.printWhitespacer(ws(" with { type: \"toml\" }")),
                        .wasm => p.printWhitespacer(ws(" with { type: \"wasm\" }")),
                        .napi => p.printWhitespacer(ws(" with { type: \"napi\" }")),
                        .base64 => p.printWhitespacer(ws(" with { type: \"base64\" }")),
                        .dataurl => p.printWhitespacer(ws(" with { type: \"dataurl\" }")),
                        .text => p.printWhitespacer(ws(" with { type: \"text\" }")),
                        .bunsh => p.printWhitespacer(ws(" with { type: \"sh\" }")),
                        // sqlite_embedded only relevant when bundling
                        .sqlite, .sqlite_embedded => p.printWhitespacer(ws(" with { type: \"sqlite\" }")),
                        .html => p.printWhitespacer(ws(" with { type: \"html\" }")),
                    };
                    p.printSemicolonAfterStatement();
                },
                .s_block => |s| {
                    p.printIndent();
                    p.printBlock(stmt.loc, s.stmts, s.close_brace_loc);
                    p.printNewline();
                },
                .s_debugger => {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("debugger");
                    p.printSemicolonAfterStatement();
                },
                .s_directive => |s| {
                    if (comptime is_json)
                        unreachable;

                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.printStringLiteralUTF8(s.value, false);
                    p.printSemicolonAfterStatement();
                },
                .s_break => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("break");
                    if (s.label) |label| {
                        p.print(" ");
                        p.printSymbol(label.ref.?);
                    }

                    p.printSemicolonAfterStatement();
                },
                .s_continue => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("continue");

                    if (s.label) |label| {
                        p.print(" ");
                        p.printSymbol(label.ref.?);
                    }
                    p.printSemicolonAfterStatement();
                },
                .s_return => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("return");

                    if (s.value) |value| {
                        p.printSpace();
                        p.printExpr(value, .lowest, ExprFlag.None());
                    }
                    p.printSemicolonAfterStatement();
                },
                .s_throw => |s| {
                    p.printIndent();
                    p.printSpaceBeforeIdentifier();
                    p.addSourceMapping(stmt.loc);
                    p.print("throw");
                    p.printSpace();
                    p.printExpr(s.value, .lowest, ExprFlag.None());
                    p.printSemicolonAfterStatement();
                },
                .s_expr => |s| {
                    if (!p.options.minify_whitespace and p.options.indent.count > 0) {
                        p.printIndent();
                    }

                    p.stmt_start = p.writer.written;
                    p.printExpr(s.value, .lowest, ExprFlag.ExprResultIsUnused());
                    p.printSemicolonAfterStatement();
                },
                else => |tag| {
                    Output.panic("Unexpected tag in printStmt: .{s}", .{@tagName(tag)});
                },
            }
        }

        pub inline fn printModuleExportSymbol(p: *Printer) void {
            p.print("module.exports");
        }

        pub fn printImportRecordPath(p: *Printer, import_record: *const ImportRecord) void {
            if (comptime is_json)
                unreachable;

            const quote = bestQuoteCharForString(u8, import_record.path.text, false);
            if (import_record.print_namespace_in_path and !import_record.path.isFile()) {
                p.print(quote);
                p.printStringCharactersUTF8(import_record.path.namespace, quote);
                p.print(":");
                p.printStringCharactersUTF8(import_record.path.text, quote);
                p.print(quote);
            } else {
                p.print(quote);
                p.printStringCharactersUTF8(import_record.path.text, quote);
                p.print(quote);
            }
        }

        pub fn printBundledImport(p: *Printer, record: ImportRecord, s: *S.Import) void {
            if (record.is_internal) {
                return;
            }

            const import_record = p.importRecord(s.import_record_index);
            const is_disabled = import_record.path.is_disabled;
            const module_id = import_record.module_id;

            // If the bundled import was disabled and only imported for side effects
            // we can skip it

            if (record.path.is_disabled) {
                if (p.symbols().get(s.namespace_ref) == null)
                    return;
            }

            switch (ImportVariant.determine(&record, s)) {
                .path_only => {
                    if (!is_disabled) {
                        p.printCallModuleID(module_id);
                        p.printSemicolonAfterStatement();
                    }
                },
                .import_items_and_default, .import_default => {
                    if (!is_disabled) {
                        p.print("var $");
                        p.printModuleId(module_id);
                        p.@"print = "();
                        p.printLoadFromBundle(s.import_record_index);

                        if (s.default_name) |default_name| {
                            p.print(", ");
                            p.printSymbol(default_name.ref.?);
                            p.print(" = (($");
                            p.printModuleId(module_id);

                            p.print(" && \"default\" in $");
                            p.printModuleId(module_id);
                            p.print(") ? $");
                            p.printModuleId(module_id);
                            p.print(".default : $");
                            p.printModuleId(module_id);
                            p.print(")");
                        }
                    } else {
                        if (s.default_name) |default_name| {
                            p.print("var ");
                            p.printSymbol(default_name.ref.?);
                            p.@"print = "();
                            p.printDisabledImport();
                        }
                    }

                    p.printSemicolonAfterStatement();
                },
                .import_star_and_import_default => {
                    p.print("var ");
                    p.printSymbol(s.namespace_ref);
                    p.@"print = "();
                    p.printLoadFromBundle(s.import_record_index);

                    if (s.default_name) |default_name| {
                        p.print(",");
                        p.printSpace();
                        p.printSymbol(default_name.ref.?);
                        p.@"print = "();

                        if (!is_bun_platform) {
                            p.print("(");
                            p.printSymbol(s.namespace_ref);
                            p.printWhitespacer(ws(" && \"default\" in "));
                            p.printSymbol(s.namespace_ref);
                            p.printWhitespacer(ws(" ? "));
                            p.printSymbol(s.namespace_ref);
                            p.printWhitespacer(ws(".default : "));
                            p.printSymbol(s.namespace_ref);
                            p.print(")");
                        } else {
                            p.printSymbol(s.namespace_ref);
                        }
                    }
                    p.printSemicolonAfterStatement();
                },
                .import_star => {
                    p.print("var ");
                    p.printSymbol(s.namespace_ref);
                    p.@"print = "();
                    p.printLoadFromBundle(s.import_record_index);
                    p.printSemicolonAfterStatement();
                },

                else => {
                    p.print("var $");
                    p.printModuleIdAssumeEnabled(module_id);
                    p.@"print = "();
                    p.printLoadFromBundle(s.import_record_index);
                    p.printSemicolonAfterStatement();
                },
            }
        }
        pub fn printLoadFromBundle(p: *Printer, import_record_index: u32) void {
            p.printLoadFromBundleWithoutCall(import_record_index);
            p.print("()");
        }

        inline fn printDisabledImport(p: *Printer) void {
            p.printWhitespacer(ws("(() => ({}))"));
        }

        pub fn printLoadFromBundleWithoutCall(p: *Printer, import_record_index: u32) void {
            const record = p.importRecord(import_record_index);
            if (record.path.is_disabled) {
                p.printDisabledImport();
                return;
            }

            @call(bun.callmod_inline, printModuleId, .{ p, p.importRecord(import_record_index).module_id });
        }

        pub fn printCallModuleID(p: *Printer, module_id: u32) void {
            printModuleId(p, module_id);
            p.print("()");
        }

        inline fn printModuleId(p: *Printer, module_id: u32) void {
            bun.assert(module_id != 0); // either module_id is forgotten or it should be disabled
            p.printModuleIdAssumeEnabled(module_id);
        }

        inline fn printModuleIdAssumeEnabled(p: *Printer, module_id: u32) void {
            p.print("$");
            std.fmt.formatInt(module_id, 16, .lower, .{}, p) catch unreachable;
        }

        pub fn printBundledRexport(p: *Printer, name: string, import_record_index: u32) void {
            p.print("Object.defineProperty(");
            p.printModuleExportSymbol();
            p.print(",");
            p.printStringLiteralUTF8(name, true);

            p.printWhitespacer(ws(",{get: () => ("));
            p.printLoadFromBundle(import_record_index);
            p.printWhitespacer(ws("), enumerable: true, configurable: true})"));
        }

        // We must use Object.defineProperty() to handle re-exports from ESM -> CJS
        // Here is an example where a runtime error occurs when assigning directly to module.exports
        // > 24077 |   module.exports.init = init;
        // >       ^
        // >  TypeError: Attempted to assign to readonly property.
        pub fn printBundledExport(p: *Printer, name: string, identifier: string) void {
            // In the event that
            p.print("Object.defineProperty(");
            p.printModuleExportSymbol();
            p.print(",");
            p.printStringLiteralUTF8(name, true);
            p.print(",{get: () => ");
            p.printIdentifier(identifier);
            p.print(", enumerable: true, configurable: true})");
        }

        pub fn printForLoopInit(p: *Printer, initSt: Stmt) void {
            switch (initSt.data) {
                .s_expr => |s| {
                    p.printExpr(
                        s.value,
                        .lowest,
                        ExprFlag.Set.init(.{ .forbid_in = true, .expr_result_is_unused = true }),
                    );
                },
                .s_local => |s| {
                    switch (s.kind) {
                        .k_var => {
                            p.printDecls("var", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
                        },
                        .k_let => {
                            p.printDecls("let", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
                        },
                        .k_const => {
                            p.printDecls("const", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
                        },
                        .k_using => {
                            p.printDecls("using", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
                        },
                        .k_await_using => {
                            p.printDecls("await using", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
                        },
                    }
                },
                // for(;)
                .s_empty => {},
                else => {
                    Output.panic("Internal error: Unexpected stmt in for loop {any}", .{initSt});
                },
            }
        }
        pub fn printIf(p: *Printer, s: *const S.If, loc: logger.Loc) void {
            p.printSpaceBeforeIdentifier();
            p.addSourceMapping(loc);
            p.print("if");
            p.printSpace();
            p.print("(");
            p.printExpr(s.test_, .lowest, ExprFlag.None());
            p.print(")");

            switch (s.yes.data) {
                .s_block => |block| {
                    p.printSpace();
                    p.printBlock(s.yes.loc, block.stmts, block.close_brace_loc);

                    if (s.no != null) {
                        p.printSpace();
                    } else {
                        p.printNewline();
                    }
                },
                else => {
                    if (wrapToAvoidAmbiguousElse(&s.yes.data)) {
                        p.printSpace();
                        p.print("{");
                        p.printNewline();

                        p.indent();
                        p.printStmt(s.yes) catch unreachable;
                        p.unindent();
                        p.needs_semicolon = false;

                        p.printIndent();
                        p.print("}");

                        if (s.no != null) {
                            p.printSpace();
                        } else {
                            p.printNewline();
                        }
                    } else {
                        p.printNewline();
                        p.indent();
                        p.printStmt(s.yes) catch unreachable;
                        p.unindent();

                        if (s.no != null) {
                            p.printIndent();
                        }
                    }
                },
            }

            if (s.no) |no_block| {
                p.printSemicolonIfNeeded();
                p.printSpaceBeforeIdentifier();
                p.addSourceMapping(no_block.loc);
                p.print("else");

                switch (no_block.data) {
                    .s_block => {
                        p.printSpace();
                        p.printBlock(no_block.loc, no_block.data.s_block.stmts, null);
                        p.printNewline();
                    },
                    .s_if => {
                        p.printIf(no_block.data.s_if, no_block.loc);
                    },
                    else => {
                        p.printNewline();
                        p.indent();
                        p.printStmt(no_block) catch unreachable;
                        p.unindent();
                    },
                }
            }
        }

        pub fn wrapToAvoidAmbiguousElse(s_: *const Stmt.Data) bool {
            var s = s_;
            while (true) {
                switch (s.*) {
                    .s_if => |index| {
                        if (index.no) |*no| {
                            s = &no.data;
                        } else {
                            return true;
                        }
                    },
                    .s_for => |current| {
                        s = &current.body.data;
                    },
                    .s_for_in => |current| {
                        s = &current.body.data;
                    },
                    .s_for_of => |current| {
                        s = &current.body.data;
                    },
                    .s_while => |current| {
                        s = &current.body.data;
                    },
                    .s_with => |current| {
                        s = &current.body.data;
                    },
                    else => {
                        return false;
                    },
                }
            }
        }

        pub fn tryToGetImportedEnumValue(p: *Printer, target: Expr, name: []const u8) ?js_ast.InlinedEnumValue.Decoded {
            if (target.data.as(.e_import_identifier)) |id| {
                const ref = p.symbols().follow(id.ref);
                if (p.symbols().get(ref)) |symbol| {
                    if (symbol.kind == .ts_enum) {
                        if (p.options.ts_enums.get(ref)) |enum_value| {
                            if (enum_value.get(name)) |value|
                                return value.decode();
                        }
                    }
                }
            }
            return null;
        }

        pub fn printInlinedEnum(
            p: *Printer,
            inlined: js_ast.InlinedEnumValue.Decoded,
            comment: []const u8,
            level: Level,
        ) void {
            switch (inlined) {
                .number => |num| p.printNumber(num, level),

                // TODO: extract printString
                .string => |str| p.printExpr(.{
                    .data = .{ .e_string = str },
                    .loc = logger.Loc.Empty,
                }, level, .{}),
            }

            if (!p.options.minify_whitespace and !p.options.minify_identifiers) {
                // TODO: rewrite this to handle </script>
                if (!bun.strings.containsComptime(comment, "*/")) {
                    p.print(" /* ");
                    p.print(comment);
                    p.print(" */");
                }
            }
        }

        pub fn printDeclStmt(p: *Printer, is_export: bool, comptime keyword: string, decls: []G.Decl) void {
            if (!rewrite_esm_to_cjs and is_export) {
                p.print("export ");
            }
            p.printDecls(keyword, decls, ExprFlag.None());
            p.printSemicolonAfterStatement();
            if (rewrite_esm_to_cjs and is_export and decls.len > 0) {
                for (decls) |decl| {
                    p.printIndent();
                    p.printSymbol(p.options.runtime_imports.__export.?.ref);
                    p.print("(");
                    p.printSpaceBeforeIdentifier();
                    p.printModuleExportSymbol();
                    p.print(",");
                    p.printSpace();

                    switch (decl.binding.data) {
                        .b_identifier => |ident| {
                            p.print("{");
                            p.printSpace();
                            p.printSymbol(ident.ref);
                            if (p.options.minify_whitespace)
                                p.print(":()=>(")
                            else
                                p.print(": () => (");
                            p.printSymbol(ident.ref);
                            p.print(") }");
                        },
                        .b_object => |obj| {
                            p.print("{");
                            p.printSpace();
                            for (obj.properties) |prop| {
                                switch (prop.value.data) {
                                    .b_identifier => |ident| {
                                        p.printSymbol(ident.ref);
                                        if (p.options.minify_whitespace)
                                            p.print(":()=>(")
                                        else
                                            p.print(": () => (");
                                        p.printSymbol(ident.ref);
                                        p.print("),");
                                        p.printNewline();
                                    },
                                    else => {},
                                }
                            }
                            p.print("}");
                        },
                        else => {
                            p.printBinding(decl.binding);
                        },
                    }
                    p.print(")");
                    p.printSemicolonAfterStatement();
                }
            }
        }

        pub fn printIdentifier(p: *Printer, identifier: string) void {
            if (comptime ascii_only) {
                p.printIdentifierAsciiOnly(identifier);
            } else {
                p.print(identifier);
            }
        }

        fn printIdentifierAsciiOnly(p: *Printer, identifier: string) void {
            var ascii_start: usize = 0;
            var is_ascii = false;
            var iter = CodepointIterator.init(identifier);
            var cursor = CodepointIterator.Cursor{};
            while (iter.next(&cursor)) {
                switch (cursor.c) {
                    first_ascii...last_ascii => {
                        if (!is_ascii) {
                            ascii_start = cursor.i;
                            is_ascii = true;
                        }
                    },
                    else => {
                        if (is_ascii) {
                            p.print(identifier[ascii_start..cursor.i]);
                            is_ascii = false;
                        }

                        p.print("\\u{");
                        std.fmt.formatInt(cursor.c, 16, .lower, .{}, p) catch unreachable;
                        p.print("}");
                    },
                }
            }

            if (is_ascii) {
                p.print(identifier[ascii_start..]);
            }
        }

        pub fn printIdentifierUTF16(p: *Printer, name: []const u16) !void {
            const n = name.len;
            var i: usize = 0;

            const CodeUnitType = u32;
            while (i < n) {
                var c: CodeUnitType = name[i];
                i += 1;

                if (c & ~@as(CodeUnitType, 0x03ff) == 0xd800 and i < n) {
                    c = 0x10000 + (((c & 0x03ff) << 10) | (name[i] & 0x03ff));
                    i += 1;
                }

                if ((comptime ascii_only) and c > last_ascii) {
                    switch (c) {
                        0...0xFFFF => {
                            p.print(
                                [_]u8{
                                    '\\',
                                    'u',
                                    hex_chars[c >> 12],
                                    hex_chars[(c >> 8) & 15],
                                    hex_chars[(c >> 4) & 15],
                                    hex_chars[c & 15],
                                },
                            );
                        },
                        else => {
                            p.print("\\u");
                            var buf_ptr = p.writer.reserve(4) catch unreachable;
                            p.writer.advance(strings.encodeWTF8RuneT(buf_ptr[0..4], CodeUnitType, c));
                        },
                    }
                    continue;
                }

                {
                    var buf_ptr = p.writer.reserve(4) catch unreachable;
                    p.writer.advance(strings.encodeWTF8RuneT(buf_ptr[0..4], CodeUnitType, c));
                }
            }
        }

        pub fn printNumber(p: *Printer, value: f64, level: Level) void {
            const absValue = @abs(value);
            if (std.math.isNan(value)) {
                p.printSpaceBeforeIdentifier();
                p.print("NaN");
            } else if (std.math.isPositiveInf(value) or std.math.isNegativeInf(value)) {
                const wrap = ((!p.options.has_run_symbol_renamer or p.options.minify_syntax) and level.gte(.multiply)) or
                    (std.math.isNegativeInf(value) and level.gte(.prefix));

                if (wrap) {
                    p.print("(");
                }

                if (std.math.isNegativeInf(value)) {
                    p.printSpaceBeforeOperator(.un_neg);
                    p.print("-");
                } else {
                    p.printSpaceBeforeIdentifier();
                }

                // If we are not running the symbol renamer, we must not print "Infinity".
                // Some code may assign `Infinity` to another idenitifier.
                //
                // We do not want:
                //
                //   const Infinity = 1 / 0
                //
                // to be transformed into:
                //
                //   const Infinity = Infinity
                //
                if (is_json or (!p.options.minify_syntax and p.options.has_run_symbol_renamer)) {
                    p.print("Infinity");
                } else if (p.options.minify_whitespace) {
                    p.print("1/0");
                } else {
                    p.print("1 / 0");
                }

                if (wrap) {
                    p.print(")");
                }
            } else if (!std.math.signbit(value)) {
                p.printSpaceBeforeIdentifier();

                p.printNonNegativeFloat(absValue);

                // Remember the end of the latest number
                p.prev_num_end = p.writer.written;
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
                p.prev_num_end = p.writer.written;
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

        pub fn init(
            writer: Writer,
            import_records: []const ImportRecord,
            opts: Options,
            renamer: bun.renamer.Renamer,
            source_map_builder: SourceMap.Chunk.Builder,
        ) Printer {
            var printer = Printer{
                .import_records = import_records,
                .options = opts,
                .writer = writer,
                .renamer = renamer,
                .source_map_builder = source_map_builder,
            };
            if (comptime generate_source_map) {
                // This seems silly to cache but the .items() function apparently costs 1ms according to Instruments.
                printer.source_map_builder.line_offset_table_byte_offset_list =
                    printer
                        .source_map_builder
                        .line_offset_tables
                        .items(.byte_offset_to_start_of_line);
            }

            return printer;
        }

        fn printDevServerModule(
            p: *Printer,
            source: *const logger.Source,
            ast: *const Ast,
            part: *const js_ast.Part,
        ) void {
            p.indent();
            p.printIndent();

            p.printStringLiteralUTF8(source.path.pretty, false);

            const func = part.stmts[0].data.s_expr.value.data.e_function.func;

            // Special-case lazy-export AST
            if (ast.has_lazy_export) {
                @branchHint(.unlikely);
                p.printFnArgs(func.open_parens_loc, func.args, func.flags.contains(.has_rest_arg), false);
                p.printSpace();
                p.print("{\n");
                if (func.body.stmts[0].data.s_lazy_export.* != .e_undefined) {
                    p.indent();
                    p.printIndent();
                    p.printSymbol(p.options.hmr_ref);
                    p.print(".cjs.exports = ");
                    p.printExpr(.{
                        .data = func.body.stmts[0].data.s_lazy_export.*,
                        .loc = func.body.stmts[0].loc,
                    }, .comma, .{});
                    p.print("; // bun .s_lazy_export\n");
                    p.unindent();
                }
                p.printIndent();
                p.print("},\n");
                return;
            }

            // ESM is represented by an array tuple [ dependencies, exports, starImports, load, async ];
            else if (ast.exports_kind == .esm) {
                p.print(": [ [");
                // Print the dependencies.
                if (part.stmts.len > 1) {
                    p.indent();
                    p.print("\n");
                    for (part.stmts[1..]) |stmt| {
                        p.printIndent();
                        const import = stmt.data.s_import;
                        const record = p.importRecord(import.import_record_index);
                        p.printStringLiteralUTF8(record.path.pretty, false);

                        const item_count = @as(u32, @intFromBool(import.default_name != null)) +
                            @as(u32, @intCast(import.items.len));
                        p.fmt(", {d},", .{item_count}) catch {};
                        if (item_count == 0) {
                            // Add a comment explaining why the number could be zero
                            p.print(if (import.star_name_loc != null) " // namespace import" else " // bare import");
                        } else {
                            if (import.default_name != null) {
                                p.print(" \"default\",");
                            }
                            for (import.items) |item| {
                                p.print(" ");
                                p.printStringLiteralUTF8(item.alias, false);
                                p.print(",");
                            }
                        }
                        p.print("\n");
                    }
                    p.unindent();
                    p.printIndent();
                }
                p.print("], [");

                // Print the exports
                if (ast.named_exports.count() > 0) {
                    p.indent();
                    var len: usize = std.math.maxInt(usize);
                    for (ast.named_exports.keys()) |key| {
                        if (len > 120) {
                            p.printNewline();
                            p.printIndent();
                            len = 0;
                        } else {
                            p.print(" ");
                        }
                        len += key.len;
                        p.printStringLiteralUTF8(key, false);
                        p.print(",");
                    }
                    p.unindent();
                    p.printNewline();
                    p.printIndent();
                }
                p.print("], [");

                // Print export stars
                p.indent();
                var had_any_stars = false;
                for (ast.export_star_import_records) |star| {
                    const record = p.importRecord(star);
                    if (record.path.is_disabled) continue;
                    had_any_stars = true;
                    p.printNewline();
                    p.printIndent();
                    p.printStringLiteralUTF8(record.path.pretty, false);
                    p.print(",");
                }
                p.unindent();
                if (had_any_stars) {
                    p.printNewline();
                    p.printIndent();
                }
                p.print("], ");

                // Print the code
                if (!ast.top_level_await_keyword.isEmpty()) p.print("async");
                p.printFnArgs(func.open_parens_loc, func.args, func.flags.contains(.has_rest_arg), false);
                p.print(" => {\n");
                p.indent();
                p.printBlockBody(func.body.stmts);
                p.unindent();
                p.printIndent();
                p.print("}, ");

                // Print isAsync
                p.print(if (!ast.top_level_await_keyword.isEmpty()) "true" else "false");
                p.print("],\n");
            } else {
                bun.assert(ast.exports_kind == .cjs);
                p.printFunc(func);
                p.print(",\n");
            }

            p.unindent();
        }
    };
}

pub const WriteResult = struct {
    off: u32,
    len: usize,
    end_off: u32,
};

pub fn NewWriter(
    comptime ContextType: type,
    comptime writeByte: fn (ctx: *ContextType, char: u8) anyerror!usize,
    comptime writeAllFn: fn (ctx: *ContextType, buf: anytype) anyerror!usize,
    comptime getLastByte: fn (ctx: *const ContextType) u8,
    comptime getLastLastByte: fn (ctx: *const ContextType) u8,
    comptime reserveNext: fn (ctx: *ContextType, count: u64) anyerror![*]u8,
    comptime advanceBy: fn (ctx: *ContextType, count: u64) void,
) type {
    return struct {
        const Self = @This();
        ctx: ContextType,
        written: i32 = -1,
        // Used by the printer
        prev_char: u8 = 0,
        prev_prev_char: u8 = 0,
        err: ?anyerror = null,
        orig_err: ?anyerror = null,

        pub fn init(ctx: ContextType) Self {
            return .{
                .ctx = ctx,
            };
        }

        pub fn stdWriter(self: *Self) std.io.Writer(*Self, error{}, stdWriterWrite) {
            return .{ .context = self };
        }
        pub fn stdWriterWrite(self: *Self, bytes: []const u8) error{}!usize {
            self.print([]const u8, bytes);
            return bytes.len;
        }

        pub fn isCopyFileRangeSupported() bool {
            return comptime std.meta.hasFn(ContextType, "copyFileRange");
        }

        pub fn copyFileRange(ctx: ContextType, in_file: StoredFileDescriptorType, start: usize, end: usize) !void {
            ctx.sendfile(
                in_file,
                start,
                end,
            );
        }

        pub fn getMutableBuffer(this: *Self) *MutableString {
            return this.ctx.getMutableBuffer();
        }

        pub fn slice(this: *Self) string {
            return this.ctx.slice();
        }

        pub fn getError(writer: *const Self) anyerror!void {
            if (writer.orig_err) |orig_err| {
                return orig_err;
            }

            if (writer.err) |err| {
                return err;
            }
        }

        pub inline fn prevChar(writer: *const Self) u8 {
            return @call(bun.callmod_inline, getLastByte, .{&writer.ctx});
        }

        pub inline fn prevPrevChar(writer: *const Self) u8 {
            return @call(bun.callmod_inline, getLastLastByte, .{&writer.ctx});
        }

        pub fn reserve(writer: *Self, count: u64) anyerror![*]u8 {
            return try reserveNext(&writer.ctx, count);
        }

        pub fn advance(writer: *Self, count: u64) void {
            advanceBy(&writer.ctx, count);
            writer.written += @as(i32, @intCast(count));
        }

        pub const Error = error{FormatError};

        pub fn writeAll(writer: *Self, bytes: anytype) Error!usize {
            const written = @max(writer.written, 0);
            writer.print(@TypeOf(bytes), bytes);
            return @as(usize, @intCast(writer.written)) - @as(usize, @intCast(written));
        }

        pub inline fn print(writer: *Self, comptime ValueType: type, str: ValueType) void {
            switch (ValueType) {
                comptime_int, u16, u8 => {
                    const written = writeByte(&writer.ctx, @as(u8, @intCast(str))) catch |err| brk: {
                        writer.orig_err = err;
                        break :brk 0;
                    };

                    writer.written += @as(i32, @intCast(written));
                    writer.err = if (written == 0) error.WriteFailed else writer.err;
                },
                else => {
                    const written = writeAllFn(&writer.ctx, str) catch |err| brk: {
                        writer.orig_err = err;
                        break :brk 0;
                    };

                    writer.written += @as(i32, @intCast(written));
                    if (written < str.len) {
                        writer.err = if (written == 0) error.WriteFailed else error.PartialWrite;
                    }
                },
            }
        }

        pub fn flush(writer: *Self) !void {
            if (std.meta.hasFn(ContextType, "flush")) {
                try writer.ctx.flush();
            }
        }
        pub fn done(writer: *Self) !void {
            if (std.meta.hasFn(ContextType, "done")) {
                try writer.ctx.done();
            }
        }
    };
}

pub const DirectWriter = struct {
    handle: FileDescriptorType,

    pub fn write(writer: *DirectWriter, buf: []const u8) !usize {
        return try std.posix.write(writer.handle, buf);
    }

    pub fn writeAll(writer: *DirectWriter, buf: []const u8) !void {
        _ = try std.posix.write(writer.handle, buf);
    }

    pub const Error = std.posix.WriteError;
};

pub const BufferWriter = struct {
    buffer: MutableString = undefined,
    written: []u8 = &[_]u8{},
    sentinel: [:0]const u8 = "",
    append_null_byte: bool = false,
    append_newline: bool = false,
    approximate_newline_count: usize = 0,
    last_bytes: [2]u8 = [_]u8{ 0, 0 },

    pub fn getMutableBuffer(this: *BufferWriter) *MutableString {
        return &this.buffer;
    }

    pub fn getWritten(this: *BufferWriter) []u8 {
        return this.buffer.list.items;
    }

    pub fn init(allocator: std.mem.Allocator) !BufferWriter {
        return BufferWriter{
            .buffer = MutableString.init(
                allocator,
                0,
            ) catch unreachable,
        };
    }

    pub fn print(ctx: *BufferWriter, comptime fmt: string, args: anytype) anyerror!void {
        try ctx.buffer.list.writer(ctx.buffer.allocator).print(fmt, args);
    }

    pub fn writeByteNTimes(ctx: *BufferWriter, byte: u8, n: usize) anyerror!void {
        try ctx.buffer.appendCharNTimes(byte, n);
    }

    pub fn writeByte(ctx: *BufferWriter, byte: u8) anyerror!usize {
        try ctx.buffer.appendChar(byte);
        ctx.approximate_newline_count += @intFromBool(byte == '\n');
        ctx.last_bytes = .{ ctx.last_bytes[1], byte };
        return 1;
    }
    pub fn writeAll(ctx: *BufferWriter, bytes: anytype) anyerror!usize {
        try ctx.buffer.append(bytes);
        ctx.approximate_newline_count += @intFromBool(bytes.len > 0 and bytes[bytes.len - 1] == '\n');

        if (bytes.len >= 2) {
            ctx.last_bytes = bytes[bytes.len - 2 ..][0..2].*;
        } else if (bytes.len >= 1) {
            ctx.last_bytes = .{ ctx.last_bytes[1], bytes[bytes.len - 1] };
        }

        return bytes.len;
    }

    pub fn slice(self: *@This()) string {
        return self.buffer.list.items;
    }

    pub fn getLastByte(ctx: *const BufferWriter) u8 {
        return ctx.last_bytes[1];
    }

    pub fn getLastLastByte(ctx: *const BufferWriter) u8 {
        return ctx.last_bytes[0];
    }

    pub fn reserveNext(ctx: *BufferWriter, count: u64) anyerror![*]u8 {
        try ctx.buffer.growIfNeeded(count);
        return @as([*]u8, @ptrCast(&ctx.buffer.list.items.ptr[ctx.buffer.list.items.len]));
    }

    pub fn advanceBy(ctx: *BufferWriter, count: u64) void {
        if (comptime Environment.isDebug) bun.assert(ctx.buffer.list.items.len + count <= ctx.buffer.list.capacity);

        ctx.buffer.list.items = ctx.buffer.list.items.ptr[0 .. ctx.buffer.list.items.len + count];

        if (count >= 2) {
            ctx.last_bytes = ctx.buffer.list.items[ctx.buffer.list.items.len - 2 ..][0..2].*;
        } else if (count >= 1) {
            ctx.last_bytes = .{ ctx.last_bytes[1], ctx.buffer.list.items[ctx.buffer.list.items.len - 1] };
        }
    }

    pub fn reset(ctx: *BufferWriter) void {
        ctx.buffer.reset();
        ctx.approximate_newline_count = 0;
        ctx.written = &.{};
    }

    pub fn writtenWithoutTrailingZero(ctx: *const BufferWriter) []u8 {
        var written = ctx.written;
        while (written.len > 0 and written[written.len - 1] == 0) {
            written = written[0 .. written.len - 1];
        }

        return written;
    }

    pub fn done(
        ctx: *BufferWriter,
    ) anyerror!void {
        if (ctx.append_newline) {
            ctx.append_newline = false;
            try ctx.buffer.appendChar('\n');
        }

        if (ctx.append_null_byte) {
            ctx.sentinel = ctx.buffer.sliceWithSentinel();
            ctx.written = ctx.buffer.slice();
        } else {
            ctx.written = ctx.buffer.slice();
        }
    }

    pub fn flush(
        _: *BufferWriter,
    ) anyerror!void {}
};
pub const BufferPrinter = NewWriter(
    BufferWriter,
    BufferWriter.writeByte,
    BufferWriter.writeAll,
    BufferWriter.getLastByte,
    BufferWriter.getLastLastByte,
    BufferWriter.reserveNext,
    BufferWriter.advanceBy,
);

pub const Format = enum {
    esm,
    cjs,

    // bun.js must escape non-latin1 identifiers in the output This is because
    // we load JavaScript as a UTF-8 buffer instead of a UTF-16 buffer
    // JavaScriptCore does not support UTF-8 identifiers when the source code
    // string is loaded as const char* We don't want to double the size of code
    // in memory...
    esm_ascii,
    cjs_ascii,
};

const GenerateSourceMap = enum {
    disable,
    lazy,
    eager,
};
pub fn getSourceMapBuilder(
    comptime generate_source_map: GenerateSourceMap,
    comptime is_bun_platform: bool,
    opts: Options,
    source: *const logger.Source,
    tree: *const Ast,
) SourceMap.Chunk.Builder {
    if (comptime generate_source_map == .disable)
        return undefined;

    return .{
        .source_map = .init(
            opts.source_map_allocator orelse opts.allocator,
            is_bun_platform and generate_source_map == .lazy,
        ),
        .cover_lines_without_mappings = true,
        .approximate_input_line_count = tree.approximate_newline_count,
        .prepend_count = is_bun_platform and generate_source_map == .lazy,
        .line_offset_tables = opts.line_offset_tables orelse brk: {
            if (generate_source_map == .lazy) break :brk SourceMap.LineOffsetTable.generate(
                opts.source_map_allocator orelse opts.allocator,
                source.contents,
                @as(
                    i32,
                    @intCast(tree.approximate_newline_count),
                ),
            );
            break :brk .empty;
        },
    };
}

pub fn printAst(
    comptime Writer: type,
    _writer: Writer,
    tree: Ast,
    symbols: js_ast.Symbol.Map,
    source: *const logger.Source,
    comptime ascii_only: bool,
    opts: Options,
    comptime generate_source_map: bool,
) !usize {
    var renamer: rename.Renamer = undefined;
    var no_op_renamer: rename.NoOpRenamer = undefined;
    var module_scope = tree.module_scope;
    if (opts.minify_identifiers) {
        const allocator = opts.allocator;
        var reserved_names = try rename.computeInitialReservedNames(allocator, opts.module_type);
        for (module_scope.children.slice()) |child| {
            child.parent = &module_scope;
        }

        rename.computeReservedNamesForScope(&module_scope, &symbols, &reserved_names, allocator);
        var minify_renamer = try rename.MinifyRenamer.init(allocator, symbols, tree.nested_scope_slot_counts, reserved_names);

        var top_level_symbols = rename.StableSymbolCount.Array.init(allocator);
        defer top_level_symbols.deinit();

        const uses_exports_ref = tree.uses_exports_ref;
        const uses_module_ref = tree.uses_module_ref;
        const exports_ref = tree.exports_ref;
        const module_ref = tree.module_ref;
        const parts = tree.parts;

        const dont_break_the_code = .{
            tree.module_ref,
            tree.exports_ref,
            tree.require_ref,
        };

        inline for (dont_break_the_code) |ref| {
            if (symbols.get(ref)) |symbol| {
                symbol.must_not_be_renamed = true;
            }
        }

        for (tree.named_exports.values()) |named_export| {
            if (symbols.get(named_export.ref)) |symbol| {
                symbol.must_not_be_renamed = true;
            }
        }

        if (uses_exports_ref) {
            try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, exports_ref, 1, &.{source.index.value});
        }

        if (uses_module_ref) {
            try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, module_ref, 1, &.{source.index.value});
        }

        for (parts.slice()) |part| {
            try minify_renamer.accumulateSymbolUseCounts(&top_level_symbols, part.symbol_uses, &.{source.index.value});

            for (part.declared_symbols.refs()) |declared_ref| {
                try minify_renamer.accumulateSymbolUseCount(&top_level_symbols, declared_ref, 1, &.{source.index.value});
            }
        }

        std.sort.pdq(rename.StableSymbolCount, top_level_symbols.items, {}, rename.StableSymbolCount.lessThan);

        try minify_renamer.allocateTopLevelSymbolSlots(top_level_symbols);
        var minifier = tree.char_freq.?.compile(allocator);
        try minify_renamer.assignNamesByFrequency(&minifier);

        renamer = minify_renamer.toRenamer();
    } else {
        no_op_renamer = rename.NoOpRenamer.init(symbols, source);
        renamer = no_op_renamer.toRenamer();
    }

    defer {
        if (opts.minify_identifiers) {
            renamer.deinit(opts.allocator);
        }
    }

    const PrinterType = NewPrinter(
        ascii_only,
        Writer,
        false,
        // if it's ascii_only, it is also bun
        ascii_only,
        false,
        generate_source_map,
    );
    const writer = _writer;

    var printer = PrinterType.init(
        writer,
        tree.import_records.slice(),
        opts,
        renamer,
        getSourceMapBuilder(if (generate_source_map) .lazy else .disable, ascii_only, opts, source, &tree),
    );
    defer {
        if (comptime generate_source_map) {
            printer.source_map_builder.line_offset_tables.deinit(opts.allocator);
        }
    }
    printer.was_lazy_export = tree.has_lazy_export;
    var bin_stack_heap = std.heap.stackFallback(1024, bun.default_allocator);
    printer.binary_expression_stack = std.ArrayList(PrinterType.BinaryExpressionVisitor).init(bin_stack_heap.get());
    defer printer.binary_expression_stack.clearAndFree();

    if (!opts.bundling and
        tree.uses_require_ref and
        tree.exports_kind == .esm and
        opts.target == .bun)
    {
        // Hoist the `var {require}=import.meta;` declaration. Previously,
        // `import.meta.require` was inlined into transpiled files, which
        // meant calling `func.toString()` on a function with `require`
        // would observe `import.meta.require` inside of the source code.
        // Normally, Bun doesn't guarantee `Function.prototype.toString`
        // will match the untranspiled source code, but in this case the new
        // code is not valid outside of an ES module (eg, in `new Function`)
        // https://github.com/oven-sh/bun/issues/15738#issuecomment-2574283514
        //
        // This is never a symbol collision because `uses_require_ref` means
        // `require` must be an unbound variable.
        printer.print("var {require}=import.meta;");
    }

    for (tree.parts.slice()) |part| {
        for (part.stmts) |stmt| {
            try printer.printStmt(stmt);
            if (printer.writer.getError()) {} else |err| {
                return err;
            }
            printer.printSemicolonIfNeeded();
        }
    }

    if (comptime FeatureFlags.runtime_transpiler_cache and generate_source_map) {
        if (opts.source_map_handler) |handler| {
            const source_maps_chunk = printer.source_map_builder.generateChunk(printer.writer.ctx.getWritten());
            if (opts.runtime_transpiler_cache) |cache| {
                cache.put(printer.writer.ctx.getWritten(), source_maps_chunk.buffer.list.items);
            }

            try handler.onSourceMapChunk(source_maps_chunk, source.*);
        } else {
            if (opts.runtime_transpiler_cache) |cache| {
                cache.put(printer.writer.ctx.getWritten(), "");
            }
        }
    } else if (comptime generate_source_map) {
        if (opts.source_map_handler) |handler| {
            try handler.onSourceMapChunk(printer.source_map_builder.generateChunk(printer.writer.ctx.getWritten()), source.*);
        }
    }

    try printer.writer.done();

    return @as(usize, @intCast(@max(printer.writer.written, 0)));
}

pub fn printJSON(
    comptime Writer: type,
    _writer: Writer,
    expr: Expr,
    source: *const logger.Source,
    opts: Options,
) !usize {
    const PrinterType = NewPrinter(false, Writer, false, false, true, false);
    const writer = _writer;
    var s_expr = S.SExpr{ .value = expr };
    const stmt = Stmt{ .loc = logger.Loc.Empty, .data = .{
        .s_expr = &s_expr,
    } };
    var stmts = [_]js_ast.Stmt{stmt};
    var parts = [_]js_ast.Part{.{ .stmts = &stmts }};
    const ast = Ast.initTest(&parts);
    const list = js_ast.Symbol.List.init(ast.symbols.slice());
    const nested_list = js_ast.Symbol.NestedList.init(&[_]js_ast.Symbol.List{list});
    var renamer = rename.NoOpRenamer.init(js_ast.Symbol.Map.initList(nested_list), source);

    var printer = PrinterType.init(
        writer,
        ast.import_records.slice(),
        opts,
        renamer.toRenamer(),
        undefined,
    );
    var bin_stack_heap = std.heap.stackFallback(1024, bun.default_allocator);
    printer.binary_expression_stack = std.ArrayList(PrinterType.BinaryExpressionVisitor).init(bin_stack_heap.get());
    defer printer.binary_expression_stack.clearAndFree();

    printer.printExpr(expr, Level.lowest, ExprFlag.Set{});
    if (printer.writer.getError()) {} else |err| {
        return err;
    }
    try printer.writer.done();

    return @as(usize, @intCast(@max(printer.writer.written, 0)));
}

pub fn print(
    allocator: std.mem.Allocator,
    target: options.Target,
    ast: Ast,
    source: *const logger.Source,
    opts: Options,
    import_records: []const ImportRecord,
    parts: []const js_ast.Part,
    renamer: bun.renamer.Renamer,
    comptime generate_source_maps: bool,
) PrintResult {
    const trace = bun.perf.trace("JSPrinter.print");
    defer trace.end();

    const buffer_writer = BufferWriter.init(allocator) catch |err| return .{ .err = err };
    var buffer_printer = BufferPrinter.init(buffer_writer);

    return printWithWriter(
        *BufferPrinter,
        &buffer_printer,
        target,
        ast,
        source,
        opts,
        import_records,
        parts,
        renamer,
        comptime generate_source_maps,
    );
}

pub fn printWithWriter(
    comptime Writer: type,
    writer: Writer,
    target: options.Target,
    ast: Ast,
    source: *const logger.Source,
    opts: Options,
    import_records: []const ImportRecord,
    parts: []const js_ast.Part,
    renamer: bun.renamer.Renamer,
    comptime generate_source_maps: bool,
) PrintResult {
    return switch (target.isBun()) {
        inline else => |is_bun| printWithWriterAndPlatform(
            Writer,
            writer,
            is_bun,
            ast,
            source,
            opts,
            import_records,
            parts,
            renamer,
            generate_source_maps,
        ),
    };
}

/// The real one
pub fn printWithWriterAndPlatform(
    comptime Writer: type,
    writer: Writer,
    comptime is_bun_platform: bool,
    ast: Ast,
    source: *const logger.Source,
    opts: Options,
    import_records: []const ImportRecord,
    parts: []const js_ast.Part,
    renamer: bun.renamer.Renamer,
    comptime generate_source_maps: bool,
) PrintResult {
    const prev_action = bun.crash_handler.current_action;
    defer bun.crash_handler.current_action = prev_action;
    bun.crash_handler.current_action = .{ .print = source.path.text };

    const PrinterType = NewPrinter(
        // if it's bun, it is also ascii_only
        is_bun_platform,
        Writer,
        false,
        is_bun_platform,
        false,
        generate_source_maps,
    );
    var printer = PrinterType.init(
        writer,
        import_records,
        opts,
        renamer,
        getSourceMapBuilder(if (generate_source_maps) .eager else .disable, is_bun_platform, opts, source, &ast),
    );
    printer.was_lazy_export = ast.has_lazy_export;
    var bin_stack_heap = std.heap.stackFallback(1024, bun.default_allocator);
    printer.binary_expression_stack = std.ArrayList(PrinterType.BinaryExpressionVisitor).init(bin_stack_heap.get());
    defer printer.binary_expression_stack.clearAndFree();

    defer printer.temporary_bindings.deinit(bun.default_allocator);
    defer writer.* = printer.writer.*;

    if (opts.module_type == .internal_bake_dev and !source.index.isRuntime()) {
        printer.printDevServerModule(source, &ast, &parts[0]);
    } else {
        // The IIFE wrapper is done in `postProcessJSChunk`, so we just manually
        // trigger an indent.
        if (opts.module_type == .iife) {
            printer.indent();
        }

        for (parts) |part| {
            for (part.stmts) |stmt| {
                printer.printStmt(stmt) catch |err| {
                    return .{ .err = err };
                };
                if (printer.writer.getError()) {} else |err| {
                    return .{ .err = err };
                }
                printer.printSemicolonIfNeeded();
            }
        }
    }

    printer.writer.done() catch |err| {
        // In bundle_v2, this is backed by an arena, but incremental uses
        // `dev.allocator` for this buffer, so it must be freed.
        printer.source_map_builder.source_map.ctx.data.deinit();

        return .{ .err = err };
    };

    const written = printer.writer.ctx.getWritten();
    const source_map: ?SourceMap.Chunk = if (generate_source_maps) brk: {
        if (written.len == 0 or printer.source_map_builder.source_map.shouldIgnore()) {
            printer.source_map_builder.source_map.ctx.data.deinit();
            break :brk null;
        }
        const chunk = printer.source_map_builder.generateChunk(written);
        assert(!chunk.should_ignore);
        break :brk chunk;
    } else null;

    return .{
        .result = .{
            .code = written,
            .source_map = source_map,
        },
    };
}

pub fn printCommonJS(
    comptime Writer: type,
    _writer: Writer,
    tree: Ast,
    symbols: js_ast.Symbol.Map,
    source: *const logger.Source,
    comptime ascii_only: bool,
    opts: Options,
    comptime generate_source_map: bool,
) !usize {
    const prev_action = bun.crash_handler.current_action;
    defer bun.crash_handler.current_action = prev_action;
    bun.crash_handler.current_action = .{ .print = source.path.text };

    const PrinterType = NewPrinter(ascii_only, Writer, true, false, false, generate_source_map);
    const writer = _writer;
    var renamer = rename.NoOpRenamer.init(symbols, source);
    var printer = PrinterType.init(
        writer,
        tree.import_records.slice(),
        opts,
        renamer.toRenamer(),
        getSourceMapBuilder(if (generate_source_map) .lazy else .disable, false, opts, source, &tree),
    );
    var bin_stack_heap = std.heap.stackFallback(1024, bun.default_allocator);
    printer.binary_expression_stack = std.ArrayList(PrinterType.BinaryExpressionVisitor).init(bin_stack_heap.get());
    defer printer.binary_expression_stack.clearAndFree();

    for (tree.parts.slice()) |part| {
        for (part.stmts) |stmt| {
            try printer.printStmt(stmt);
            if (printer.writer.getError()) {} else |err| {
                return err;
            }
            printer.printSemicolonIfNeeded();
        }
    }

    // Add a couple extra newlines at the end
    printer.writer.print(@TypeOf("\n\n"), "\n\n");

    if (comptime generate_source_map) {
        if (opts.source_map_handler) |handler| {
            try handler.onSourceMapChunk(printer.source_map_builder.generateChunk(printer.writer.ctx.getWritten()), source.*);
        }
    }

    try printer.writer.done();

    return @as(usize, @intCast(@max(printer.writer.written, 0)));
}
