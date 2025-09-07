const hex_chars = "0123456789ABCDEF";
const first_ascii = 0x20;
const last_ascii = 0x7E;
const first_high_surrogate = 0xD800;
const first_low_surrogate = 0xDC00;
const last_low_surrogate = 0xDFFF;

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

    while (strings.indexOfNeedsEscapeForJavaScriptString(remaining, quote_char)) |i| {
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

pub fn writePreQuotedString(text_in: []const u8, comptime Writer: type, writer: Writer, comptime quote_char: u8, comptime ascii_only: bool, comptime json: bool, comptime encoding: strings.Encoding) Writer.Error!void {
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
            .latin1 => text[i],
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
                    if (strings.indexOfNeedsEscapeForJavaScriptString(remain, quote_char)) |j| {
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
pub fn quoteForJSON(text: []const u8, bytes: *MutableString, comptime ascii_only: bool) OOM!void {
    const writer = bytes.writer();

    try bytes.growIfNeeded(estimateLengthForUTF8(text, ascii_only, '"'));
    try bytes.appendChar('"');
    try writePreQuotedString(text, @TypeOf(writer), writer, '"', ascii_only, true, .utf8);
    try bytes.appendChar('"');
}

pub fn writeJSONString(input: []const u8, comptime Writer: type, writer: Writer, comptime encoding: strings.Encoding) !void {
    try writer.writeAll("\"");
    try writePreQuotedString(input, Writer, writer, '"', false, true, encoding);
    try writer.writeAll("\"");
}

pub const SourceMapHandler = struct {
    ctx: *anyopaque,
    callback: Callback,

    const Callback = *const fn (*anyopaque, chunk: SourceMap.Chunk, source: *const logger.Source) OOM!void;
    pub fn onSourceMapChunk(self: *const @This(), chunk: SourceMap.Chunk, source: *const logger.Source) OOM!void {
        try self.callback(self.ctx, chunk, source);
    }

    pub fn For(comptime Type: type, comptime handler: (fn (t: *Type, chunk: SourceMap.Chunk, source: *const logger.Source) OOM!void)) type {
        return struct {
            pub fn onChunk(self: *anyopaque, chunk: SourceMap.Chunk, source: *const logger.Source) OOM!void {
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
    allocator: std.mem.Allocator = bun.default_allocator,
    source_map_allocator: ?std.mem.Allocator = null,
    source_map_handler: ?SourceMapHandler = null,
    source_map_builder: ?*bun.sourcemap.Chunk.Builder = null,
    css_import_behavior: api.CssInJsBehavior = api.CssInJsBehavior.facade,
    target: options.Target = .browser,

    runtime_transpiler_cache: ?*bun.jsc.RuntimeTranspilerCache = null,
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
    result: Result,
    err: Error,

    const Result = struct {
        code: []u8,
        source_map: ?SourceMap.Chunk = null,
    };

    pub const Error = OOM || StackOverflow;

    pub fn fail(e: Error) PrintResult {
        return .{ .err = e };
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
        options: Options,
        stmt_start: i64 = -1,
        export_default_start: i64 = -1,
        arrow_expr_start: i64 = -1,
        for_of_init_start: i64 = -1,
        prev_op: Op.Code = Op.Code.bin_add,
        prev_op_end: i64 = -1,
        prev_num_end: i64 = -1,
        prev_reg_exp_end: i64 = -1,
        call_target: ?Expr.Data = null,
        writer: Writer,
        stack_check: bun.StackCheck,

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

            pub fn checkAndPrepare(v: *BinaryExpressionVisitor, p: *Printer) PrintResult.Error!bool {
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
                    try p.print("(");
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
                    try p.addSourceMappingForName(e.left.loc, name, private.ref);
                    try p.printIdentifier(name);
                    try v.visitRightAndFinish(p);
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
            pub fn visitRightAndFinish(v: *BinaryExpressionVisitor, p: *Printer) PrintResult.Error!void {
                const e = v.e;
                const entry = v.entry;
                var flags = ExprFlag.Set{};

                if (e.op != .bin_comma) {
                    try p.printSpace();
                }

                if (entry.is_keyword) {
                    try p.printSpaceBeforeIdentifier();
                    try p.print(entry.text);
                } else {
                    try p.printSpaceBeforeOperator(e.op);
                    try p.print(entry.text);
                    p.prev_op = e.op;
                    p.prev_op_end = p.writer.written;
                }

                try p.printSpace();

                // The result of the right operand of the comma operator is unused if the caller doesn't use it
                if (e.op == .bin_comma and v.flags.contains(.expr_result_is_unused)) {
                    flags.insert(.expr_result_is_unused);
                }

                if (v.flags.contains(.forbid_in)) {
                    flags.insert(.forbid_in);
                }

                try p.printExpr(e.right, v.right_level, flags);

                if (v.wrap) {
                    try p.print(")");
                }
            }
        };

        pub fn writeAll(p: *Printer, bytes: anytype) OOM!void {
            try p.print(bytes);
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

        pub fn writeBytesNTimes(self: *Printer, bytes: []const u8, n: usize) OOM!void {
            var i: usize = 0;
            while (i < n) : (i += 1) {
                try self.writeAll(bytes);
            }
        }

        fn fmt(p: *Printer, comptime str: string, args: anytype) OOM!void {
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

        pub fn printBuffer(p: *Printer, str: []const u8) OOM!void {
            try p.writer.print([]const u8, str);
        }

        pub fn print(p: *Printer, str: anytype) OOM!void {
            const StringType = @TypeOf(str);
            switch (comptime StringType) {
                comptime_int, u16, u8 => {
                    try p.writer.print(StringType, str);
                },
                [6]u8 => {
                    const span = str[0..6];
                    try p.writer.print(@TypeOf(span), span);
                },
                else => {
                    try p.writer.print(StringType, str);
                },
            }
        }

        pub inline fn unindent(p: *Printer) void {
            p.options.indent.count -|= 1;
        }

        pub inline fn indent(p: *Printer) void {
            p.options.indent.count += 1;
        }

        pub fn printIndent(p: *Printer) OOM!void {
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
                try p.print(indentation_buf[0..amt]);
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

        pub inline fn printSpace(p: *Printer) OOM!void {
            if (!p.options.minify_whitespace)
                try p.print(" ");
        }
        pub inline fn printNewline(p: *Printer) OOM!void {
            if (!p.options.minify_whitespace)
                try p.print("\n");
        }
        pub inline fn printSemicolonAfterStatement(p: *Printer) OOM!void {
            if (!p.options.minify_whitespace) {
                try p.print(";\n");
            } else {
                p.needs_semicolon = true;
            }
        }
        pub fn printSemicolonIfNeeded(p: *Printer) OOM!void {
            if (p.needs_semicolon) {
                try p.print(";");
                p.needs_semicolon = false;
            }
        }

        fn @"print = "(p: *Printer) OOM!void {
            if (p.options.minify_whitespace) {
                try p.print("=");
            } else {
                try p.print(" = ");
            }
        }

        fn printBunJestImportStatement(p: *Printer, import: S.Import) PrintResult.Error!void {
            comptime bun.assert(is_bun_platform);

            switch (p.options.module_type) {
                .cjs => {
                    try printInternalBunImport(p, import, @TypeOf("globalThis.Bun.jest(__filename)"), "globalThis.Bun.jest(__filename)");
                },
                else => {
                    try printInternalBunImport(p, import, @TypeOf("globalThis.Bun.jest(import.meta.path)"), "globalThis.Bun.jest(import.meta.path)");
                },
            }
        }

        fn printGlobalBunImportStatement(p: *Printer, import: S.Import) PrintResult.Error!void {
            if (comptime !is_bun_platform) unreachable;
            try printInternalBunImport(p, import, @TypeOf("globalThis.Bun"), "globalThis.Bun");
        }

        fn printInternalBunImport(p: *Printer, import: S.Import, comptime Statement: type, statement: Statement) PrintResult.Error!void {
            if (comptime !is_bun_platform) unreachable;

            if (import.star_name_loc != null) {
                try p.print("var ");
                try p.printSymbol(import.namespace_ref);
                try p.printSpace();
                try p.print("=");
                try p.printSpaceBeforeIdentifier();
                if (comptime Statement == void) {
                    try p.printRequireOrImportExpr(
                        import.import_record_index,
                        false,
                        &.{},
                        Expr.empty,
                        Level.lowest,
                        ExprFlag.None(),
                    );
                } else {
                    try p.print(statement);
                }

                try p.printSemicolonAfterStatement();
                try p.printIndent();
            }

            if (import.default_name) |default| {
                try p.print("var ");
                try p.printSymbol(default.ref.?);
                if (comptime Statement == void) {
                    try p.@"print = "();
                    try p.printRequireOrImportExpr(
                        import.import_record_index,
                        false,
                        &.{},
                        Expr.empty,
                        Level.lowest,
                        ExprFlag.None(),
                    );
                } else {
                    try p.@"print = "();
                    try p.print(statement);
                }
                try p.printSemicolonAfterStatement();
            }

            if (import.items.len > 0) {
                try p.printWhitespacer(ws("var {"));

                if (!import.is_single_line) {
                    try p.printNewline();
                    p.indent();
                    try p.printIndent();
                }

                for (import.items, 0..) |item, i| {
                    if (i > 0) {
                        try p.print(",");
                        try p.printSpace();

                        if (!import.is_single_line) {
                            try p.printNewline();
                            try p.printIndent();
                        }
                    }

                    try p.printClauseItemAs(item, .@"var");
                }

                if (!import.is_single_line) {
                    try p.printNewline();
                    p.unindent();
                } else {
                    try p.printSpace();
                }

                try p.printWhitespacer(ws("} = "));

                if (import.star_name_loc == null and import.default_name == null) {
                    if (comptime Statement == void) {
                        try p.printRequireOrImportExpr(import.import_record_index, false, &.{}, Expr.empty, Level.lowest, ExprFlag.None());
                    } else {
                        try p.print(statement);
                    }
                } else if (import.default_name) |name| {
                    try p.printSymbol(name.ref.?);
                } else {
                    try p.printSymbol(import.namespace_ref);
                }

                try p.printSemicolonAfterStatement();
            }
        }

        pub inline fn printSpaceBeforeIdentifier(p: *Printer) OOM!void {
            if (p.writer.written > 0 and (js_lexer.isIdentifierContinue(@as(i32, p.writer.prevChar())) or p.writer.written == p.prev_reg_exp_end)) {
                try p.print(" ");
            }
        }

        pub inline fn maybePrintSpace(p: *Printer) OOM!void {
            switch (p.writer.prevChar()) {
                0, ' ', '\n' => {},
                else => {
                    try p.print(" ");
                },
            }
        }
        pub fn printDotThenPrefix(p: *Printer) OOM!Level {
            try p.print(".then(() => ");
            return .comma;
        }

        pub inline fn printUndefined(p: *Printer, loc: logger.Loc, level: Level) OOM!void {
            if (p.options.minify_syntax) {
                if (level.gte(Level.prefix)) {
                    try p.addSourceMapping(loc);
                    try p.print("(void 0)");
                } else {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(loc);
                    try p.print("void 0");
                }
            } else {
                try p.printSpaceBeforeIdentifier();
                try p.addSourceMapping(loc);
                try p.print("undefined");
            }
        }

        pub fn printBody(p: *Printer, stmt: Stmt) PrintResult.Error!void {
            switch (stmt.data) {
                .s_block => |block| {
                    try p.printSpace();
                    try p.printBlock(stmt.loc, block.stmts, block.close_brace_loc);
                    try p.printNewline();
                },
                else => {
                    try p.printNewline();
                    p.indent();
                    try p.printStmt(stmt);
                    p.unindent();
                },
            }
        }

        pub fn printBlockBody(p: *Printer, stmts: []const Stmt) PrintResult.Error!void {
            for (stmts) |stmt| {
                try p.printSemicolonIfNeeded();
                try p.printStmt(stmt);
            }
        }

        pub fn printBlock(p: *Printer, loc: logger.Loc, stmts: []const Stmt, close_brace_loc: ?logger.Loc) PrintResult.Error!void {
            try p.addSourceMapping(loc);
            try p.print("{");
            if (stmts.len > 0) {
                @branchHint(.likely);
                try p.printNewline();

                p.indent();
                try p.printBlockBody(stmts);
                p.unindent();

                try p.printIndent();
            }
            if (close_brace_loc != null and close_brace_loc.?.start > loc.start) {
                try p.addSourceMapping(close_brace_loc.?);
            }
            try p.print("}");

            p.needs_semicolon = false;
        }

        pub fn printTwoBlocksInOne(p: *Printer, loc: logger.Loc, stmts: []const Stmt, prepend: []const Stmt) OOM!void {
            try p.addSourceMapping(loc);
            try p.print("{");
            try p.printNewline();

            p.indent();
            try p.printBlockBody(prepend);
            try p.printBlockBody(stmts);
            p.unindent();
            p.needs_semicolon = false;

            try p.printIndent();
            try p.print("}");
        }

        pub fn printDecls(p: *Printer, comptime keyword: string, decls_: []G.Decl, flags: ExprFlag.Set) PrintResult.Error!void {
            try p.print(keyword);
            try p.printSpace();
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
                        try temp_bindings.ensureUnusedCapacity(bun.default_allocator, 2);
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

                            try temp_bindings.append(bun.default_allocator, .{
                                .key = Expr.init(E.String, E.String.init(e_dot.name), e_dot.name_loc),
                                .value = decl.binding,
                            });
                            decls = decls[1..];
                        }
                        var b_object = B.Object{
                            .properties = temp_bindings.items,
                            .is_single_line = true,
                        };
                        const binding = Binding.init(&b_object, target_e_dot.target.loc);
                        try p.printBinding(binding);
                    }

                    try p.printWhitespacer(ws(" = "));
                    try p.printExpr(second_e_dot.target, .comma, flags);

                    if (decls.len == 0) {
                        return;
                    }

                    try p.print(",");
                    try p.printSpace();
                }
            }

            {
                try p.printBinding(decls[0].binding);

                if (decls[0].value) |value| {
                    try p.printWhitespacer(ws(" = "));
                    try p.printExpr(value, .comma, flags);
                }
            }

            for (decls[1..]) |*decl| {
                try p.print(",");
                try p.printSpace();

                try p.printBinding(decl.binding);

                if (decl.value) |value| {
                    try p.printWhitespacer(ws(" = "));
                    try p.printExpr(value, .comma, flags);
                }
            }
        }

        pub inline fn addSourceMapping(printer: *Printer, location: logger.Loc) OOM!void {
            if (comptime !generate_source_map) {
                return;
            }
            try printer.source_map_builder.addSourceMapping(location, printer.writer.slice());
        }

        pub inline fn addSourceMappingForName(printer: *Printer, location: logger.Loc, _: string, _: Ref) OOM!void {
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
            try printer.addSourceMapping(location);
        }

        pub fn printSymbol(p: *Printer, ref: Ref) OOM!void {
            bun.assert(!ref.isNull()); // Invalid Symbol
            const name = p.renamer.nameForSymbol(ref);

            try p.printIdentifier(name);
        }
        pub fn printClauseAlias(p: *Printer, alias: string) OOM!void {
            bun.assert(alias.len > 0);

            if (!strings.containsNonBmpCodePointOrIsInvalidIdentifier(alias)) {
                try p.printSpaceBeforeIdentifier();
                try p.printIdentifier(alias);
            } else {
                try p.printStringLiteralUTF8(alias, false);
            }
        }

        pub fn printFnArgs(
            p: *Printer,
            open_paren_loc: ?logger.Loc,
            args: []G.Arg,
            has_rest_arg: bool,
            // is_arrow can be used for minifying later
            _: bool,
        ) PrintResult.Error!void {
            const wrap = true;

            if (wrap) {
                if (open_paren_loc) |loc| {
                    try p.addSourceMapping(loc);
                }
                try p.print("(");
            }

            for (args, 0..) |arg, i| {
                if (i != 0) {
                    try p.print(",");
                    try p.printSpace();
                }

                if (has_rest_arg and i + 1 == args.len) {
                    try p.print("...");
                }

                try p.printBinding(arg.binding);

                if (arg.default) |default| {
                    try p.printWhitespacer(ws(" = "));
                    try p.printExpr(default, .comma, ExprFlag.None());
                }
            }

            if (wrap) {
                try p.print(")");
            }
        }

        pub fn printFunc(p: *Printer, func: G.Fn) PrintResult.Error!void {
            try p.printFnArgs(func.open_parens_loc, func.args, func.flags.contains(.has_rest_arg), false);
            try p.printSpace();
            try p.printBlock(func.body.loc, func.body.stmts, null);
        }

        pub fn printClass(p: *Printer, class: G.Class) PrintResult.Error!void {
            if (class.extends) |extends| {
                try p.print(" extends");
                try p.printSpace();
                try p.printExpr(extends, Level.new.sub(1), ExprFlag.None());
            }

            try p.printSpace();

            try p.addSourceMapping(class.body_loc);
            try p.print("{");
            try p.printNewline();
            p.indent();

            for (class.properties) |item| {
                try p.printSemicolonIfNeeded();
                try p.printIndent();

                if (item.kind == .class_static_block) {
                    try p.print("static");
                    try p.printSpace();
                    try p.printBlock(item.class_static_block.?.loc, item.class_static_block.?.stmts.slice(), null);
                    try p.printNewline();
                    continue;
                }

                try p.printProperty(item);

                if (item.value == null) {
                    try p.printSemicolonAfterStatement();
                } else {
                    try p.printNewline();
                }
            }

            p.needs_semicolon = false;
            p.unindent();
            try p.printIndent();
            if (class.close_brace_loc.start > class.body_loc.start)
                try p.addSourceMapping(class.close_brace_loc);
            try p.print("}");
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

        pub fn printWhitespacer(this: *Printer, spacer: Whitespacer) OOM!void {
            if (this.options.minify_whitespace) {
                try this.print(spacer.minify);
            } else {
                try this.print(spacer.normal);
            }
        }

        pub fn printNonNegativeFloat(p: *Printer, float: f64) OOM!void {
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
                        try p.print("0");
                    },
                    1...9 => {
                        var bytes = [1]u8{'0' + @as(u8, @intCast(val))};
                        try p.print(&bytes);
                    },
                    10 => {
                        try p.print("10");
                    },
                    11...99 => {
                        const buf: *[2]u8 = (try p.writer.reserve(2))[0..2];
                        formatUnsignedIntegerBetween(2, buf, val);
                        p.writer.advance(2);
                    },
                    100 => {
                        try p.print("100");
                    },
                    101...999 => {
                        const buf: *[3]u8 = (try p.writer.reserve(3))[0..3];
                        formatUnsignedIntegerBetween(3, buf, val);
                        p.writer.advance(3);
                    },

                    1000 => {
                        try p.print("1000");
                    },
                    1001...9999 => {
                        const buf: *[4]u8 = (try p.writer.reserve(4))[0..4];
                        formatUnsignedIntegerBetween(4, buf, val);
                        p.writer.advance(4);
                    },
                    10000 => {
                        try p.print("1e4");
                    },
                    100000 => {
                        try p.print("1e5");
                    },
                    1000000 => {
                        try p.print("1e6");
                    },
                    10000000 => {
                        try p.print("1e7");
                    },
                    100000000 => {
                        try p.print("1e8");
                    },
                    1000000000 => {
                        try p.print("1e9");
                    },

                    10001...99999 => {
                        const buf: *[5]u8 = (try p.writer.reserve(5))[0..5];
                        formatUnsignedIntegerBetween(5, buf, val);
                        p.writer.advance(5);
                    },
                    100001...999999 => {
                        const buf: *[6]u8 = (try p.writer.reserve(6))[0..6];
                        formatUnsignedIntegerBetween(6, buf, val);
                        p.writer.advance(6);
                    },
                    1_000_001...9_999_999 => {
                        const buf: *[7]u8 = (try p.writer.reserve(7))[0..7];
                        formatUnsignedIntegerBetween(7, buf, val);
                        p.writer.advance(7);
                    },
                    10_000_001...99_999_999 => {
                        const buf: *[8]u8 = (try p.writer.reserve(8))[0..8];
                        formatUnsignedIntegerBetween(8, buf, val);
                        p.writer.advance(8);
                    },
                    100_000_001...999_999_999 => {
                        const buf: *[9]u8 = (try p.writer.reserve(9))[0..9];
                        formatUnsignedIntegerBetween(9, buf, val);
                        p.writer.advance(9);
                    },
                    1_000_000_001...9_999_999_999 => {
                        const buf: *[10]u8 = (try p.writer.reserve(10))[0..10];
                        formatUnsignedIntegerBetween(10, buf, val);
                        p.writer.advance(10);
                    },
                    else => try std.fmt.formatInt(val, 10, .lower, .{}, p),
                }

                return;
            }

            try p.fmt("{d}", .{float});
        }

        pub fn printStringCharactersUTF8(e: *Printer, text: []const u8, quote: u8) OOM!void {
            const writer = e.writer.stdWriter();
            switch (quote) {
                '\'' => try writePreQuotedString(text, @TypeOf(writer), writer, '\'', ascii_only, false, .utf8),
                '"' => try writePreQuotedString(text, @TypeOf(writer), writer, '"', ascii_only, false, .utf8),
                '`' => try writePreQuotedString(text, @TypeOf(writer), writer, '`', ascii_only, false, .utf8),
                else => unreachable,
            }
        }
        pub fn printStringCharactersUTF16(e: *Printer, text: []const u16, quote: u8) OOM!void {
            const slice = std.mem.sliceAsBytes(text);

            const writer = e.writer.stdWriter();
            switch (quote) {
                '\'' => try writePreQuotedString(slice, @TypeOf(writer), writer, '\'', ascii_only, false, .utf16),
                '"' => try writePreQuotedString(slice, @TypeOf(writer), writer, '"', ascii_only, false, .utf16),
                '`' => try writePreQuotedString(slice, @TypeOf(writer), writer, '`', ascii_only, false, .utf16),
                else => unreachable,
            }
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

        pub fn printRequireError(p: *Printer, text: string) OOM!void {
            try p.print("(()=>{throw new Error(\"Cannot require module \"+");
            try p.printStringLiteralUTF8(text, false);
            try p.print(");})()");
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
        ) PrintResult.Error!void {
            _ = leading_interior_comments; // TODO:

            var level = level_;
            const wrap = level.gte(.new) or flags.contains(.forbid_call);
            try if (wrap) p.print("(");
            defer if (wrap) p.print(")") catch unreachable;

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
                            try p.print("Promise.resolve(globalThis.Bun)");
                            return;
                        } else if (record.kind == .require or record.kind == .stmt) {
                            try p.print("globalThis.Bun");
                            return;
                        }
                    },
                    .bun_test => {
                        if (record.kind == .dynamic) {
                            if (module_type == .cjs) {
                                try p.print("Promise.resolve(globalThis.Bun.jest(__filename))");
                            } else {
                                try p.print("Promise.resolve(globalThis.Bun.jest(import.meta.path))");
                            }
                        } else if (record.kind == .require) {
                            if (module_type == .cjs) {
                                try p.print("globalThis.Bun.jest(__filename)");
                            } else {
                                try p.print("globalThis.Bun.jest(import.meta.path)");
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
                    try p.printSpaceBeforeIdentifier();
                    try p.printSymbol(meta.wrapper_ref);
                    try p.print("()");
                    if (meta.exports_ref.isValid()) {
                        _ = try p.printDotThenPrefix();
                        try p.printSpaceBeforeIdentifier();
                        try p.printSymbol(meta.exports_ref);
                        try p.printDotThenSuffix();
                    }
                    return;
                }

                // Internal "require()" or "import()"
                if (record.kind == .dynamic) {
                    try p.printSpaceBeforeIdentifier();
                    try p.print("Promise.resolve()");

                    level = try p.printDotThenPrefix();
                }
                defer if (record.kind == .dynamic) p.printDotThenSuffix() catch unreachable;

                // Make sure the comma operator is properly wrapped
                const wrap_comma_operator = meta.exports_ref.isValid() and
                    meta.wrapper_ref.isValid() and
                    level.gte(.comma);
                try if (wrap_comma_operator) p.print("(");
                defer if (wrap_comma_operator) p.print(")") catch unreachable;

                // Wrap this with a call to "__toESM()" if this is a CommonJS file
                const wrap_with_to_esm = record.wrap_with_to_esm;
                if (wrap_with_to_esm) {
                    try p.printSpaceBeforeIdentifier();
                    try p.printSymbol(p.options.to_esm_ref);
                    try p.print("(");
                }

                if (p.options.input_files_for_dev_server) |input_files| {
                    bun.assert(module_type == .internal_bake_dev);
                    try p.printSpaceBeforeIdentifier();
                    try p.printSymbol(p.options.hmr_ref);
                    try p.print(".require(");
                    const path = input_files[record.source_index.get()].path;
                    try p.printStringLiteralUTF8(path.pretty, false);
                    try p.print(")");
                } else if (!meta.was_unwrapped_require) {
                    // Call the wrapper
                    if (meta.wrapper_ref.isValid()) {
                        try p.printSpaceBeforeIdentifier();
                        try p.printSymbol(meta.wrapper_ref);
                        try p.print("()");

                        if (meta.exports_ref.isValid()) {
                            try p.print(",");
                            try p.printSpace();
                        }
                    }

                    // Return the namespace object if this is an ESM file
                    if (meta.exports_ref.isValid()) {
                        // Wrap this with a call to "__toCommonJS()" if this is an ESM file
                        const wrap_with_to_cjs = record.wrap_with_to_commonjs;
                        if (wrap_with_to_cjs) {
                            try p.printSymbol(p.options.to_commonjs_ref);
                            try p.print("(");
                        }
                        try p.printSymbol(meta.exports_ref);
                        if (wrap_with_to_cjs) {
                            try p.print(")");
                        }
                    }
                } else {
                    if (!meta.exports_ref.isNull())
                        try p.printSymbol(meta.exports_ref);
                }

                if (wrap_with_to_esm) {
                    if (module_type.isESM()) {
                        try p.print(",");
                        try p.printSpace();
                        try p.print("1");
                    }
                    try p.print(")");
                }

                return;
            }

            // External "require()"
            if (record.kind != .dynamic) {
                try p.printSpaceBeforeIdentifier();

                if (p.options.inline_require_and_import_errors) {
                    if (record.path.is_disabled and record.handles_import_errors) {
                        try p.printRequireError(record.path.text);
                        return;
                    }

                    if (record.path.is_disabled) {
                        try p.printDisabledImport();
                        return;
                    }
                }

                const wrap_with_to_esm = record.wrap_with_to_esm;

                if (module_type == .internal_bake_dev) {
                    try p.printSpaceBeforeIdentifier();
                    try p.printSymbol(p.options.hmr_ref);
                    if (record.tag == .builtin)
                        try p.print(".builtin(")
                    else
                        try p.print(".require(");
                    const path = record.path;
                    try p.printStringLiteralUTF8(path.pretty, false);
                    try p.print(")");
                    return;
                } else if (wrap_with_to_esm) {
                    try p.printSpaceBeforeIdentifier();
                    try p.printSymbol(p.options.to_esm_ref);
                    try p.print("(");
                }

                if (p.options.require_ref) |ref| {
                    try p.printSymbol(ref);
                } else {
                    try p.print("require");
                }

                try p.print("(");
                try p.printImportRecordPath(record);
                try p.print(")");

                if (wrap_with_to_esm) {
                    try p.print(")");
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
            try p.addSourceMapping(record.range.loc);

            try p.printSpaceBeforeIdentifier();

            // Allow it to fail at runtime, if it should
            if (module_type != .internal_bake_dev) {
                try p.print("import(");
                try p.printImportRecordPath(record);
            } else {
                try p.printSymbol(p.options.hmr_ref);
                try p.print(".dynamicImport(");
                const path = record.path;
                try p.printStringLiteralUTF8(path.pretty, false);
            }

            if (!import_options.isMissing()) {
                try p.printWhitespacer(ws(", "));
                try p.printExpr(import_options, .comma, .{});
            }

            try p.print(")");

            // if (leading_interior_comments.len > 0) {
            //     p.printNewline();
            //     p.unindent();
            //     p.printIndent();
            // }

            return;
        }

        pub inline fn printPure(p: *Printer) OOM!void {
            if (p.options.print_dce_annotations) {
                try p.printWhitespacer(ws("/* @__PURE__ */ "));
            }
        }

        pub fn printStringLiteralEString(p: *Printer, str: *E.String, allow_backtick: bool) OOM!void {
            const quote = bestQuoteCharForEString(str, allow_backtick);
            try p.print(quote);
            try p.printStringCharactersEString(str, quote);
            try p.print(quote);
        }
        pub fn printStringLiteralUTF8(p: *Printer, str: string, allow_backtick: bool) OOM!void {
            if (Environment.allow_assert) std.debug.assert(std.unicode.wtf8ValidateSlice(str));

            const quote = if (comptime !is_json)
                bestQuoteCharForString(u8, str, allow_backtick)
            else
                '"';

            try p.print(quote);
            try p.printStringCharactersUTF8(str, quote);
            try p.print(quote);
        }

        fn printClauseItem(p: *Printer, item: js_ast.ClauseItem) OOM!void {
            return printClauseItemAs(p, item, .import);
        }

        fn printExportClauseItem(p: *Printer, item: js_ast.ClauseItem) OOM!void {
            return printClauseItemAs(p, item, .@"export");
        }

        fn printClauseItemAs(p: *Printer, item: js_ast.ClauseItem, comptime as: @Type(.enum_literal)) OOM!void {
            const name = p.renamer.nameForSymbol(item.name.ref.?);

            if (comptime as == .import) {
                if (strings.eql(name, item.alias)) {
                    try p.printIdentifier(name);
                } else {
                    try p.printClauseAlias(item.alias);
                    try p.print(" as ");
                    try p.addSourceMapping(item.alias_loc);
                    try p.printIdentifier(name);
                }
            } else if (comptime as == .@"var") {
                try p.printClauseAlias(item.alias);

                if (!strings.eql(name, item.alias)) {
                    try p.print(":");
                    try p.printSpace();

                    try p.printIdentifier(name);
                }
            } else if (comptime as == .@"export") {
                try p.printIdentifier(name);

                if (!strings.eql(name, item.alias)) {
                    try p.print(" as ");
                    try p.addSourceMapping(item.alias_loc);
                    try p.printClauseAlias(item.alias);
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

        fn printRawTemplateLiteral(p: *Printer, bytes: []const u8) OOM!void {
            if (comptime is_json or !ascii_only) {
                try p.print(bytes);
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
                            try p.print(bytes[ascii_start..cursor.i]);
                            is_ascii = false;
                        }

                        switch (cursor.c) {
                            0...0xFFFF => {
                                try p.print([_]u8{
                                    '\\',
                                    'u',
                                    hex_chars[cursor.c >> 12],
                                    hex_chars[(cursor.c >> 8) & 15],
                                    hex_chars[(cursor.c >> 4) & 15],
                                    hex_chars[cursor.c & 15],
                                });
                            },
                            else => {
                                try p.print("\\u{");
                                try std.fmt.formatInt(cursor.c, 16, .lower, .{}, p);
                                try p.print("}");
                            },
                        }
                    },
                }
            }

            if (is_ascii) {
                try p.print(bytes[ascii_start..]);
            }
        }

        pub fn printExpr(p: *Printer, expr: Expr, level: Level, in_flags: ExprFlag.Set) PrintResult.Error!void {
            var flags = in_flags;

            if (!p.stack_check.isSafeToRecurse()) {
                return error.StackOverflow;
            }

            switch (expr.data) {
                .e_missing => {},
                .e_undefined => {
                    try p.addSourceMapping(expr.loc);
                    try p.printUndefined(expr.loc, level);
                },
                .e_super => {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.print("super");
                },
                .e_null => {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.print("null");
                },
                .e_this => {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.print("this");
                },
                .e_spread => |e| {
                    try p.addSourceMapping(expr.loc);
                    try p.print("...");
                    try p.printExpr(e.value, .comma, ExprFlag.None());
                },
                .e_new_target => {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.print("new.target");
                },
                .e_import_meta => {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    if (p.options.module_type == .internal_bake_dev) {
                        bun.assert(p.options.hmr_ref.isValid());
                        try p.printSymbol(p.options.hmr_ref);
                        try p.print(".importMeta");
                    } else if (!p.options.import_meta_ref.isValid()) {
                        // Most of the time, leave it in there
                        try p.print("import.meta");
                    } else {
                        // Note: The bundler will not hit this code path. The bundler will replace
                        // the ImportMeta AST node with a regular Identifier AST node.
                        //
                        // This is currently only used in Bun's runtime for CommonJS modules
                        // referencing import.meta
                        //
                        // TODO: This assertion trips when using `import.meta` with `--format=cjs`
                        bun.debugAssert(p.options.module_type == .cjs);

                        try p.printSymbol(p.options.import_meta_ref);
                    }
                },
                .e_import_meta_main => |data| {
                    if (p.options.module_type == .esm and p.options.target != .node) {
                        // Node.js doesn't support import.meta.main
                        // Most of the time, leave it in there
                        if (data.inverted) {
                            try p.addSourceMapping(expr.loc);
                            try p.print("!");
                        } else {
                            try p.printSpaceBeforeIdentifier();
                            try p.addSourceMapping(expr.loc);
                        }
                        try p.print("import.meta.main");
                    } else {
                        bun.debugAssert(p.options.module_type != .internal_bake_dev);

                        try p.printSpaceBeforeIdentifier();
                        try p.addSourceMapping(expr.loc);

                        if (p.options.require_ref) |require|
                            try p.printSymbol(require)
                        else
                            try p.print("require");

                        if (data.inverted)
                            try p.printWhitespacer(ws(".main != "))
                        else
                            try p.printWhitespacer(ws(".main == "));

                        if (p.options.target == .node) {
                            // "__require.module"
                            if (p.options.require_ref) |require| {
                                try p.printSymbol(require);
                                try p.print(".module");
                            } else {
                                try p.print("module");
                            }
                        } else if (p.options.commonjs_module_ref.isValid()) {
                            try p.printSymbol(p.options.commonjs_module_ref);
                        } else {
                            try p.print("module");
                        }
                    }
                },
                .e_special => |special| switch (special) {
                    .module_exports => {
                        try p.printSpaceBeforeIdentifier();
                        try p.addSourceMapping(expr.loc);

                        if (p.options.commonjs_module_exports_assigned_deoptimized) {
                            if (p.options.commonjs_module_ref.isValid()) {
                                try p.printSymbol(p.options.commonjs_module_ref);
                            } else {
                                try p.print("module");
                            }
                            try p.print(".exports");
                        } else {
                            try p.printSymbol(p.options.commonjs_named_exports_ref);
                        }
                    },
                    .hot_enabled => {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        try p.printSymbol(p.options.hmr_ref);
                        try p.print(".indirectHot");
                    },
                    .hot_data => {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        try p.printSymbol(p.options.hmr_ref);
                        try p.print(".data");
                    },
                    .hot_accept => {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        try p.printSymbol(p.options.hmr_ref);
                        try p.print(".accept");
                    },
                    .hot_accept_visited => {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        try p.printSymbol(p.options.hmr_ref);
                        try p.print(".acceptSpecifiers");
                    },
                    .hot_disabled => {
                        bun.debugAssert(p.options.module_type != .internal_bake_dev);
                        try p.printExpr(.{ .data = .e_undefined, .loc = expr.loc }, level, in_flags);
                    },
                    .resolved_specifier_string => |index| {
                        bun.debugAssert(p.options.module_type == .internal_bake_dev);
                        try p.printStringLiteralUTF8(p.importRecord(index.get()).path.pretty, true);
                    },
                },

                .e_commonjs_export_identifier => |id| {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);

                    for (p.options.commonjs_named_exports.keys(), p.options.commonjs_named_exports.values()) |key, value| {
                        if (value.loc_ref.ref.?.eql(id.ref)) {
                            if (p.options.commonjs_named_exports_deoptimized or value.needs_decl) {
                                if (p.options.commonjs_module_exports_assigned_deoptimized and
                                    id.base == .module_dot_exports and
                                    p.options.commonjs_module_ref.isValid())
                                {
                                    try p.printSymbol(p.options.commonjs_module_ref);
                                    try p.print(".exports");
                                } else {
                                    try p.printSymbol(p.options.commonjs_named_exports_ref);
                                }

                                if (js_lexer.isIdentifier(key)) {
                                    try p.print(".");
                                    try p.print(key);
                                } else {
                                    try p.print("[");
                                    try p.printStringLiteralUTF8(key, false);
                                    try p.print("]");
                                }
                            } else {
                                try p.printSymbol(value.loc_ref.ref.?);
                            }
                            break;
                        }
                    }
                },
                .e_new => |e| {
                    const has_pure_comment = e.can_be_unwrapped_if_unused == .if_unused and p.options.print_dce_annotations;
                    const wrap = level.gte(.call) or (has_pure_comment and level.gte(.postfix));

                    if (wrap) {
                        try p.print("(");
                    }

                    if (has_pure_comment) {
                        try p.printPure();
                    }

                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.print("new");
                    try p.printSpace();
                    try p.printExpr(e.target, .new, ExprFlag.ForbidCall());
                    const args = e.args.slice();
                    if (args.len > 0 or level.gte(.postfix)) {
                        try p.print("(");

                        if (args.len > 0) {
                            try p.printExpr(args[0], .comma, ExprFlag.None());

                            for (args[1..]) |arg| {
                                try p.print(",");
                                try p.printSpace();
                                try p.printExpr(arg, .comma, ExprFlag.None());
                            }
                        }

                        if (e.close_parens_loc.start > expr.loc.start) {
                            try p.addSourceMapping(e.close_parens_loc);
                        }

                        try p.print(")");
                    }

                    if (wrap) {
                        try p.print(")");
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

                    const has_pure_comment = e.can_be_unwrapped_if_unused == .if_unused and p.options.print_dce_annotations;
                    if (has_pure_comment and level.gte(.postfix)) {
                        wrap = true;
                    }

                    if (wrap) {
                        try p.print("(");
                    }

                    if (has_pure_comment) {
                        const was_stmt_start = p.stmt_start == p.writer.written;
                        try p.printPure();
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
                        try p.print("(0,");
                        try p.printSpace();
                        try p.printExpr(e.target, .postfix, ExprFlag.None());
                        try p.print(")");
                    } else {
                        try p.printExpr(e.target, .postfix, target_flags);
                    }

                    if (e.optional_chain != null and (e.optional_chain orelse unreachable) == .start) {
                        try p.print("?.");
                    }
                    try p.print("(");
                    const args = e.args.slice();

                    if (args.len > 0) {
                        try p.printExpr(args[0], .comma, ExprFlag.None());
                        for (args[1..]) |arg| {
                            try p.print(",");
                            try p.printSpace();
                            try p.printExpr(arg, .comma, ExprFlag.None());
                        }
                    }
                    if (e.close_paren_loc.start > expr.loc.start) {
                        try p.addSourceMapping(e.close_paren_loc);
                    }
                    try p.print(")");
                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_require_main => {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);

                    if (p.options.require_ref) |require_ref| {
                        try p.printSymbol(require_ref);
                        try p.print(".main");
                    } else if (p.options.module_type == .internal_bake_dev) {
                        try p.print("false"); // there is no true main entry point
                    } else {
                        try p.print("require.main");
                    }
                },
                .e_require_call_target => {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);

                    if (p.options.require_ref) |require_ref| {
                        try p.printSymbol(require_ref);
                    } else if (p.options.module_type == .internal_bake_dev) {
                        try p.printSymbol(p.options.hmr_ref);
                        try p.print(".require");
                    } else {
                        try p.print("require");
                    }
                },
                .e_require_resolve_call_target => {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);

                    if (p.options.require_ref) |require_ref| {
                        try p.printSymbol(require_ref);
                        try p.print(".resolve");
                    } else if (p.options.module_type == .internal_bake_dev) {
                        try p.printSymbol(p.options.hmr_ref);
                        try p.print(".requireResolve");
                    } else {
                        try p.print("require.resolve");
                    }
                },
                .e_require_string => |e| {
                    if (!rewrite_esm_to_cjs) {
                        try p.printRequireOrImportExpr(
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
                        try p.print("(");
                    }

                    try p.printSpaceBeforeIdentifier();

                    if (p.options.require_ref) |require_ref| {
                        try p.printSymbol(require_ref);
                        try p.print(".resolve");
                    } else {
                        try p.print("require.resolve");
                    }

                    try p.print("(");
                    try p.printStringLiteralUTF8(p.importRecord(e.import_record_index).path.text, true);
                    try p.print(")");

                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_import => |e| {
                    // Handle non-string expressions
                    if (e.isImportRecordNull()) {
                        const wrap = level.gte(.new) or flags.contains(.forbid_call);
                        if (wrap) {
                            try p.print("(");
                        }

                        try p.printSpaceBeforeIdentifier();
                        try p.addSourceMapping(expr.loc);
                        if (p.options.module_type == .internal_bake_dev) {
                            try p.printSymbol(p.options.hmr_ref);
                            try p.print(".dynamicImport(");
                        } else {
                            try p.print("import(");
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
                        try p.printExpr(e.expr, .comma, ExprFlag.None());

                        if (!e.options.isMissing()) {
                            try p.printWhitespacer(ws(", "));
                            try p.printExpr(e.options, .comma, .{});
                        }

                        // TODO:
                        // if (e.leading_interior_comments.len > 0) {
                        //     p.printNewline();
                        //     p.unindent();
                        //     p.printIndent();
                        // }
                        try p.print(")");
                        if (wrap) {
                            try p.print(")");
                        }
                    } else {
                        try p.printRequireOrImportExpr(
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
                            try p.printInlinedEnum(inlined, e.name, level);
                            return;
                        }
                    } else {
                        if (flags.contains(.has_non_optional_chain_parent)) {
                            wrap = true;
                            try p.print("(");
                        }

                        flags.remove(.has_non_optional_chain_parent);
                    }
                    flags.setIntersection(ExprFlag.Set.init(.{ .has_non_optional_chain_parent = true, .forbid_call = true }));

                    try p.printExpr(
                        e.target,
                        .postfix,
                        flags,
                    );

                    if (js_lexer.isIdentifier(e.name)) {
                        if (isOptionalChain) {
                            try p.print("?.");
                        } else {
                            if (p.prev_num_end == p.writer.written) {
                                // "1.toString" is a syntax error, so print "1 .toString" instead
                                try p.print(" ");
                            }

                            try p.print(".");
                        }

                        try p.addSourceMapping(e.name_loc);
                        try p.printIdentifier(e.name);
                    } else {
                        if (isOptionalChain) {
                            try p.print("?.[");
                        } else {
                            try p.print("[");
                        }

                        try p.printStringLiteralUTF8(e.name, false);

                        try p.print("]");
                    }

                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_index => |e| {
                    var wrap = false;
                    if (e.optional_chain == null) {
                        flags.insert(.has_non_optional_chain_parent);

                        if (e.index.data.as(.e_string)) |str| {
                            str.resolveRopeIfNeeded(p.options.allocator);

                            if (str.isUTF8()) if (p.tryToGetImportedEnumValue(e.target, str.data)) |value| {
                                try p.printInlinedEnum(value, str.data, level);
                                return;
                            };
                        }
                    } else {
                        if (flags.contains(.has_non_optional_chain_parent)) {
                            wrap = true;
                            try p.print("(");
                        }
                        flags.remove(.has_non_optional_chain_parent);
                    }

                    try p.printExpr(e.target, .postfix, flags);

                    const is_optional_chain_start = e.optional_chain == .start;
                    if (is_optional_chain_start) {
                        try p.print("?.");
                    }

                    switch (e.index.data) {
                        .e_private_identifier => {
                            const priv = e.index.data.e_private_identifier;
                            if (!is_optional_chain_start) {
                                try p.print(".");
                            }
                            try p.addSourceMapping(e.index.loc);
                            try p.printSymbol(priv.ref);
                        },
                        else => {
                            try p.print("[");
                            try p.addSourceMapping(e.index.loc);
                            try p.printExpr(e.index, .lowest, ExprFlag.None());
                            try p.print("]");
                        },
                    }

                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_if => |e| {
                    const wrap = level.gte(.conditional);
                    if (wrap) {
                        try p.print("(");
                        flags.remove(.forbid_in);
                    }
                    try p.printExpr(e.test_, .conditional, flags);
                    try p.printSpace();
                    try p.print("?");
                    try p.printSpace();
                    try p.printExpr(e.yes, .yield, ExprFlag.None());
                    try p.printSpace();
                    try p.print(":");
                    try p.printSpace();
                    flags.insert(.forbid_in);
                    try p.printExpr(e.no, .yield, flags);
                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_arrow => |e| {
                    const wrap = level.gte(.assign);

                    if (wrap) {
                        try p.print("(");
                    }

                    if (e.is_async) {
                        try p.addSourceMapping(expr.loc);
                        try p.printSpaceBeforeIdentifier();
                        try p.print("async");
                        try p.printSpace();
                    }

                    try p.printFnArgs(if (e.is_async) null else expr.loc, e.args, e.has_rest_arg, true);
                    try p.printWhitespacer(ws(" => "));

                    var wasPrinted = false;
                    if (e.body.stmts.len == 1 and e.prefer_expr) {
                        switch (e.body.stmts[0].data) {
                            .s_return => {
                                if (e.body.stmts[0].data.s_return.value) |val| {
                                    p.arrow_expr_start = p.writer.written;
                                    try p.printExpr(val, .comma, ExprFlag.Set.init(.{ .forbid_in = true }));
                                    wasPrinted = true;
                                }
                            },
                            else => {},
                        }
                    }

                    if (!wasPrinted) {
                        try p.printBlock(e.body.loc, e.body.stmts, null);
                    }

                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_function => |e| {
                    const n = p.writer.written;
                    const wrap = p.stmt_start == n or p.export_default_start == n;

                    if (wrap) {
                        try p.print("(");
                    }

                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    if (e.func.flags.contains(.is_async)) {
                        try p.print("async ");
                    }
                    try p.print("function");
                    if (e.func.flags.contains(.is_generator)) {
                        try p.print("*");
                        try p.printSpace();
                    }

                    if (e.func.name) |sym| {
                        try p.printSpaceBeforeIdentifier();
                        try p.addSourceMapping(sym.loc);
                        try p.printSymbol(sym.ref orelse Output.panic("internal error: expected E.Function's name symbol to have a ref\n{any}", .{e.func}));
                    }

                    try p.printFunc(e.func);
                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_class => |e| {
                    const n = p.writer.written;
                    const wrap = p.stmt_start == n or p.export_default_start == n;
                    if (wrap) {
                        try p.print("(");
                    }

                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.print("class");
                    if (e.class_name) |name| {
                        try p.print(" ");
                        try p.addSourceMapping(name.loc);
                        try p.printSymbol(name.ref orelse Output.panic("internal error: expected E.Class's name symbol to have a ref\n{any}", .{e}));
                    }
                    try p.printClass(e.*);
                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_array => |e| {
                    try p.addSourceMapping(expr.loc);
                    try p.print("[");
                    const items = e.items.slice();
                    if (items.len > 0) {
                        if (!e.is_single_line) {
                            p.indent();
                        }

                        for (items, 0..) |item, i| {
                            if (i != 0) {
                                try p.print(",");
                                if (e.is_single_line) {
                                    try p.printSpace();
                                }
                            }
                            if (!e.is_single_line) {
                                try p.printNewline();
                                try p.printIndent();
                            }
                            try p.printExpr(item, .comma, ExprFlag.None());

                            if (i == items.len - 1 and item.data == .e_missing) {
                                // Make sure there's a comma after trailing missing items
                                try p.print(",");
                            }
                        }

                        if (!e.is_single_line) {
                            p.unindent();
                            try p.printNewline();
                            try p.printIndent();
                        }
                    }

                    if (e.close_bracket_loc.start > expr.loc.start) {
                        try p.addSourceMapping(e.close_bracket_loc);
                    }

                    try p.print("]");
                },
                .e_object => |e| {
                    const n = p.writer.written;
                    const wrap = if (comptime is_json)
                        false
                    else
                        p.stmt_start == n or p.arrow_expr_start == n;

                    if (wrap) {
                        try p.print("(");
                    }
                    try p.addSourceMapping(expr.loc);
                    try p.print("{");
                    const props = expr.data.e_object.properties.slice();
                    if (props.len > 0) {
                        if (!e.is_single_line) {
                            p.indent();
                        }

                        if (e.is_single_line and !is_json) {
                            try p.printSpace();
                        } else {
                            try p.printNewline();
                            try p.printIndent();
                        }
                        try p.printProperty(props[0]);

                        if (props.len > 1) {
                            for (props[1..]) |property| {
                                try p.print(",");

                                if (e.is_single_line and !is_json) {
                                    try p.printSpace();
                                } else {
                                    try p.printNewline();
                                    try p.printIndent();
                                }
                                try p.printProperty(property);
                            }
                        }

                        if (e.is_single_line and !is_json) {
                            try p.printSpace();
                        } else {
                            p.unindent();
                            try p.printNewline();
                            try p.printIndent();
                        }
                    }
                    if (e.close_brace_loc.start > expr.loc.start) {
                        try p.addSourceMapping(e.close_brace_loc);
                    }
                    try p.print("}");
                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_boolean => |e| {
                    try p.addSourceMapping(expr.loc);
                    if (p.options.minify_syntax) {
                        if (level.gte(Level.prefix)) {
                            try p.print(if (e.value) "(!0)" else "(!1)");
                        } else {
                            try p.print(if (e.value) "!0" else "!1");
                        }
                    } else {
                        try p.printSpaceBeforeIdentifier();
                        try p.print(if (e.value) "true" else "false");
                    }
                },
                .e_string => |e| {
                    e.resolveRopeIfNeeded(p.options.allocator);
                    try p.addSourceMapping(expr.loc);

                    // If this was originally a template literal, print it as one as long as we're not minifying
                    if (e.prefer_template and !p.options.minify_syntax) {
                        try p.print("`");
                        try p.printStringCharactersEString(e, '`');
                        try p.print("`");
                        return;
                    }

                    try p.printStringLiteralEString(e, true);
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
                                    try replaced.appendSlice(e.parts[0..i]);
                                }
                                part.value = value;
                                try replaced.append(part);
                            } else if (replaced.items.len > 0) {
                                try replaced.append(part);
                            }
                        }

                        if (replaced.items.len > 0) {
                            var copy = e.*;
                            copy.parts = replaced.items;
                            const e2 = copy.fold(p.options.allocator, expr.loc);
                            switch (e2.data) {
                                .e_string => {
                                    try p.print('"');
                                    try p.printStringCharactersUTF8(e2.data.e_string.data, '"');
                                    try p.print('"');
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
                            try p.addSourceMapping(expr.loc);
                            try p.printStringCharactersEString(&e.head.cooked, '`');
                            return;
                        }
                    }

                    if (e.tag) |tag| {
                        try p.addSourceMapping(expr.loc);
                        // Optional chains are forbidden in template tags
                        if (expr.isOptionalChain()) {
                            try p.print("(");
                            try p.printExpr(tag, .lowest, ExprFlag.None());
                            try p.print(")");
                        } else {
                            try p.printExpr(tag, .postfix, ExprFlag.None());
                        }
                    } else {
                        try p.addSourceMapping(expr.loc);
                    }

                    try p.print("`");
                    switch (e.head) {
                        .raw => |raw| try p.printRawTemplateLiteral(raw),
                        .cooked => |*cooked| {
                            if (cooked.isPresent()) {
                                cooked.resolveRopeIfNeeded(p.options.allocator);
                                try p.printStringCharactersEString(cooked, '`');
                            }
                        },
                    }

                    for (e.parts) |*part| {
                        try p.print("${");
                        try p.printExpr(part.value, .lowest, ExprFlag.None());
                        try p.print("}");
                        switch (part.tail) {
                            .raw => |raw| try p.printRawTemplateLiteral(raw),
                            .cooked => |*cooked| {
                                if (cooked.isPresent()) {
                                    cooked.resolveRopeIfNeeded(p.options.allocator);
                                    try p.printStringCharactersEString(cooked, '`');
                                }
                            },
                        }
                    }
                    try p.print("`");
                },
                .e_reg_exp => |e| {
                    try p.addSourceMapping(expr.loc);
                    try p.printRegExpLiteral(e);
                },
                .e_big_int => |e| {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.print(e.value);
                    try p.print('n');
                },
                .e_number => |e| {
                    try p.addSourceMapping(expr.loc);
                    try p.printNumber(e.value, level);
                },
                .e_identifier => |e| {
                    const name = p.renamer.nameForSymbol(e.ref);
                    const wrap = p.writer.written == p.for_of_init_start and strings.eqlComptime(name, "let");

                    if (wrap) {
                        try p.print("(");
                    }

                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.printIdentifier(name);

                    if (wrap) {
                        try p.print(")");
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
                        try p.printUndefined(expr.loc, level);
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
                                    try p.printWhitespacer(ws("(0, "));
                                }
                                try p.printSpaceBeforeIdentifier();
                                try p.addSourceMapping(expr.loc);
                                try p.printNamespaceAlias(import_record.*, namespace);

                                if (wrap) {
                                    try p.print(")");
                                }
                            } else if (import_record.was_originally_require and import_record.path.is_disabled) {
                                try p.addSourceMapping(expr.loc);

                                if (import_record.handles_import_errors) {
                                    try p.printRequireError(import_record.path.text);
                                } else {
                                    try p.printDisabledImport();
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
                                try p.printWhitespacer(ws("(0, "));
                            }

                            try p.printSpaceBeforeIdentifier();
                            try p.addSourceMapping(expr.loc);
                            try p.printSymbol(namespace.namespace_ref);
                            const alias = namespace.alias;
                            if (js_lexer.isIdentifier(alias)) {
                                try p.print(".");
                                // TODO: addSourceMappingForName
                                try p.printIdentifier(alias);
                            } else {
                                try p.print("[");
                                // TODO: addSourceMappingForName
                                // p.addSourceMappingForName(alias);
                                try p.printStringLiteralUTF8(alias, false);
                                try p.print("]");
                            }

                            if (wrap) {
                                try p.print(")");
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
                        try p.printSpaceBeforeIdentifier();
                        try p.addSourceMapping(expr.loc);
                        try p.printSymbol(e.ref);
                    }
                },
                .e_await => |e| {
                    const wrap = level.gte(.prefix);

                    if (wrap) {
                        try p.print("(");
                    }

                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.print("await");
                    try p.printSpace();
                    try p.printExpr(e.value, Level.sub(.prefix, 1), ExprFlag.None());

                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_yield => |e| {
                    const wrap = level.gte(.assign);
                    if (wrap) {
                        try p.print("(");
                    }

                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(expr.loc);
                    try p.print("yield");

                    if (e.value) |val| {
                        if (e.is_star) {
                            try p.print("*");
                        }
                        try p.printSpace();
                        try p.printExpr(val, .yield, ExprFlag.None());
                    }

                    if (wrap) {
                        try p.print(")");
                    }
                },
                .e_unary => |e| {
                    // 4.00 ms  eums.EnumIndexer(src.js_ast.Op.Code).indexOf
                    const entry: *const Op = Op.Table.getPtrConst(e.op);
                    const wrap = level.gte(entry.level);

                    if (wrap) {
                        try p.print("(");
                    }

                    if (!e.op.isPrefix()) {
                        try p.printExpr(e.value, Op.Level.sub(.postfix, 1), ExprFlag.None());
                    }

                    if (entry.is_keyword) {
                        try p.printSpaceBeforeIdentifier();
                        try p.addSourceMapping(expr.loc);
                        try p.print(entry.text);
                        try p.printSpace();
                    } else {
                        try p.printSpaceBeforeOperator(e.op);
                        try p.print(entry.text);
                        p.prev_op = e.op;
                        p.prev_op_end = p.writer.written;
                    }

                    if (e.op.isPrefix()) {
                        try p.printExpr(e.value, Op.Level.sub(.prefix, 1), ExprFlag.None());
                    }

                    if (wrap) {
                        try p.print(")");
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
                        if (!try v.checkAndPrepare(p)) {
                            break;
                        }

                        const left = v.e.left;
                        const left_binary: ?*E.Binary = if (left.data == .e_binary) left.data.e_binary else null;

                        // Stop iterating if iteration doesn't apply to the left node
                        if (left_binary == null) {
                            try p.printExpr(left, v.left_level, v.left_flags);
                            try v.visitRightAndFinish(p);
                            break;
                        }

                        // Only allocate heap memory on the stack for nested binary expressions
                        try p.binary_expression_stack.append(v);
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
                        try last.visitRightAndFinish(p);
                    }
                },
                .e_inlined_enum => |e| {
                    try p.printExpr(e.value, level, flags);
                    if (!p.options.minify_whitespace and !p.options.minify_identifiers) {
                        try p.print(" /* ");
                        try p.print(e.comment);
                        try p.print(" */");
                    }
                },
                .e_name_of_symbol => |e| {
                    const name = p.mangledPropName(e.ref);
                    try p.addSourceMappingForName(expr.loc, name, e.ref);

                    if (!p.options.minify_whitespace and e.has_property_key_comment) {
                        try p.print(" /* @__KEY__ */");
                    }

                    try p.print('"');
                    try p.printStringCharactersUTF8(name, '"');
                    try p.print('"');
                },

                .e_jsx_element,
                .e_private_identifier,
                => {
                    if (Environment.isDebug)
                        Output.panic("Unexpected expression of type .{s}", .{@tagName(expr.data)});
                },
            }
        }

        pub fn printSpaceBeforeOperator(p: *Printer, next: Op.Code) OOM!void {
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
                    try p.print(" ");
                }
            }
        }

        pub inline fn printDotThenSuffix(p: *Printer) OOM!void {
            try p.print(")");
        }

        // This assumes the string has already been quoted.
        pub fn printStringCharactersEString(p: *Printer, str: *const E.String, c: u8) OOM!void {
            if (!str.isUTF8()) {
                try p.printStringCharactersUTF16(str.slice16(), c);
            } else {
                try p.printStringCharactersUTF8(str.data, c);
            }
        }

        pub fn printNamespaceAlias(p: *Printer, _: ImportRecord, namespace: G.NamespaceAlias) OOM!void {
            try p.printSymbol(namespace.namespace_ref);

            // In the case of code like this:
            // module.exports = require("foo")
            // if "foo" is bundled
            // then we access it as the namespace symbol itself
            // that means the namespace alias is empty
            if (namespace.alias.len == 0) return;

            if (js_lexer.isIdentifier(namespace.alias)) {
                try p.print(".");
                try p.printIdentifier(namespace.alias);
            } else {
                try p.print("[");
                try p.printStringLiteralUTF8(namespace.alias, false);
                try p.print("]");
            }
        }

        pub fn printRegExpLiteral(p: *Printer, e: *const E.RegExp) OOM!void {
            const n = p.writer.written;

            // Avoid forming a single-line comment
            if (n > 0 and p.writer.prevChar() == '/') {
                try p.print(" ");
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
                                try p.print(e.value[ascii_start..cursor.i]);
                                is_ascii = false;
                            }

                            switch (cursor.c) {
                                0...0xFFFF => {
                                    try p.print([_]u8{
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

                                    try p.print(&[_]u8{
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
                    try p.print(e.value[ascii_start..]);
                }
            } else {
                // UTF8 sequence is fine
                try p.print(e.value);
            }

            // Need a space before the next identifier to avoid it turning into flags
            p.prev_reg_exp_end = p.writer.written;
        }

        pub fn printProperty(p: *Printer, item_in: G.Property) PrintResult.Error!void {
            var item = item_in;
            if (comptime !is_json) {
                if (item.kind == .spread) {
                    if (comptime is_json and Environment.allow_assert)
                        unreachable;
                    try p.print("...");
                    try p.printExpr(item.value.?, .comma, ExprFlag.None());
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
                    try p.print("static");
                    try p.printSpace();
                }

                switch (item.kind) {
                    .get => {
                        if (comptime is_json and Environment.allow_assert)
                            unreachable;
                        try p.printSpaceBeforeIdentifier();
                        try p.print("get");
                        try p.printSpace();
                    },
                    .set => {
                        if (comptime is_json and Environment.allow_assert)
                            unreachable;
                        try p.printSpaceBeforeIdentifier();
                        try p.print("set");
                        try p.printSpace();
                    },
                    else => {},
                }

                if (item.value) |val| {
                    switch (val.data) {
                        .e_function => |func| {
                            if (item.flags.contains(.is_method)) {
                                if (func.func.flags.contains(.is_async)) {
                                    try p.printSpaceBeforeIdentifier();
                                    try p.print("async");
                                }

                                if (func.func.flags.contains(.is_generator)) {
                                    try p.print("*");
                                }

                                if (func.func.flags.contains(.is_generator) and func.func.flags.contains(.is_async)) {
                                    try p.printSpace();
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
                        try p.printExpr(val, .comma, ExprFlag.None());
                        return;
                    }
                }
            }

            const _key = item.key.?;

            if (!is_json and item.flags.contains(.is_computed)) {
                try p.print("[");
                try p.printExpr(_key, .comma, ExprFlag.None());
                try p.print("]");

                if (item.value) |val| {
                    switch (val.data) {
                        .e_function => |func| {
                            if (item.flags.contains(.is_method)) {
                                try p.printFunc(func.func);
                                return;
                            }
                        },
                        else => {},
                    }

                    try p.print(":");
                    try p.printSpace();
                    try p.printExpr(val, .comma, ExprFlag.None());
                }

                if (item.initializer) |initial| {
                    try p.printInitializer(initial);
                }
                return;
            }

            switch (_key.data) {
                .e_private_identifier => |priv| {
                    if (comptime is_json) {
                        unreachable;
                    }

                    try p.addSourceMapping(_key.loc);
                    try p.printSymbol(priv.ref);
                },
                .e_string => |key| {
                    try p.addSourceMapping(_key.loc);
                    if (key.isUTF8()) {
                        key.resolveRopeIfNeeded(p.options.allocator);
                        try p.printSpaceBeforeIdentifier();
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
                            try p.printIdentifier(key.data);
                        } else {
                            allow_shorthand = false;
                            try p.printStringLiteralEString(key, false);
                        }

                        // Use a shorthand property if the names are the same
                        if (item.value) |val| {
                            switch (val.data) {
                                .e_identifier => |e| {
                                    if (key.eql(string, p.renamer.nameForSymbol(e.ref))) {
                                        if (item.initializer) |initial| {
                                            try p.printInitializer(initial);
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
                                                try p.printInitializer(initial);
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
                        try p.printSpaceBeforeIdentifier();
                        try p.printIdentifierUTF16(key.slice16());

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
                                            try p.printInitializer(initial);
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
                                                try p.printInitializer(initial);
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
                        try p.print(c);
                        try p.printStringCharactersUTF16(key.slice16(), c);
                        try p.print(c);
                    }
                },
                else => {
                    if (comptime is_json) {
                        unreachable;
                    }

                    try p.printExpr(_key, .lowest, ExprFlag.Set{});
                },
            }

            if (item.kind != .normal) {
                if (comptime is_json) {
                    bun.unreachablePanic("item.kind must be normal in json, received: {any}", .{item.kind});
                }

                switch (item.value.?.data) {
                    .e_function => |func| {
                        try p.printFunc(func.func);
                        return;
                    },
                    else => {},
                }
            }

            if (item.value) |val| {
                switch (val.data) {
                    .e_function => |f| {
                        if (item.flags.contains(.is_method)) {
                            try p.printFunc(f.func);

                            return;
                        }
                    },
                    else => {},
                }

                try p.print(":");
                try p.printSpace();
                try p.printExpr(val, .comma, ExprFlag.Set{});
            }

            if (comptime is_json) {
                bun.assert(item.initializer == null);
            }

            if (item.initializer) |initial| {
                try p.printInitializer(initial);
            }
        }

        pub fn printInitializer(p: *Printer, initial: Expr) PrintResult.Error!void {
            try p.printSpace();
            try p.print("=");
            try p.printSpace();
            try p.printExpr(initial, .comma, ExprFlag.None());
        }

        pub fn printBinding(p: *Printer, binding: Binding) PrintResult.Error!void {
            switch (binding.data) {
                .b_missing => {},
                .b_identifier => |b| {
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(binding.loc);
                    try p.printSymbol(b.ref);
                },
                .b_array => |b| {
                    try p.print("[");
                    if (b.items.len > 0) {
                        if (!b.is_single_line) {
                            p.indent();
                        }

                        for (b.items, 0..) |*item, i| {
                            if (i != 0) {
                                try p.print(",");
                                if (b.is_single_line) {
                                    try p.printSpace();
                                }
                            }

                            if (!b.is_single_line) {
                                try p.printNewline();
                                try p.printIndent();
                            }

                            const is_last = i + 1 == b.items.len;
                            if (b.has_spread and is_last) {
                                try p.print("...");
                            }

                            try p.printBinding(item.binding);

                            try p.maybePrintDefaultBindingValue(item);

                            // Make sure there's a comma after trailing missing items
                            if (is_last and item.binding.data == .b_missing) {
                                try p.print(",");
                            }
                        }

                        if (!b.is_single_line) {
                            p.unindent();
                            try p.printNewline();
                            try p.printIndent();
                        }
                    }

                    try p.print("]");
                },
                .b_object => |b| {
                    try p.print("{");
                    if (b.properties.len > 0) {
                        if (!b.is_single_line) {
                            p.indent();
                        }

                        for (b.properties, 0..) |*property, i| {
                            if (i != 0) {
                                try p.print(",");
                            }

                            if (b.is_single_line) {
                                try p.printSpace();
                            } else {
                                try p.printNewline();
                                try p.printIndent();
                            }

                            if (property.flags.contains(.is_spread)) {
                                try p.print("...");
                            } else {
                                if (property.flags.contains(.is_computed)) {
                                    try p.print("[");
                                    try p.printExpr(property.key, .comma, ExprFlag.None());
                                    try p.print("]:");
                                    try p.printSpace();

                                    try p.printBinding(property.value);
                                    try p.maybePrintDefaultBindingValue(property);
                                    continue;
                                }

                                switch (property.key.data) {
                                    .e_string => |str| {
                                        str.resolveRopeIfNeeded(p.options.allocator);
                                        try p.addSourceMapping(property.key.loc);

                                        if (str.isUTF8()) {
                                            try p.printSpaceBeforeIdentifier();
                                            // Example case:
                                            //      const Menu = React.memo(function Menu({
                                            //          aria-label: ariaLabel,
                                            //              ^
                                            // That needs to be:
                                            //          "aria-label": ariaLabel,
                                            if (js_lexer.isIdentifier(str.data)) {
                                                try p.printIdentifier(str.data);

                                                // Use a shorthand property if the names are the same
                                                switch (property.value.data) {
                                                    .b_identifier => |id| {
                                                        if (str.eql(string, p.renamer.nameForSymbol(id.ref))) {
                                                            try p.maybePrintDefaultBindingValue(property);
                                                            continue;
                                                        }
                                                    },
                                                    else => {},
                                                }
                                            } else {
                                                try p.printStringLiteralUTF8(str.data, false);
                                            }
                                        } else if (p.canPrintIdentifierUTF16(str.slice16())) {
                                            try p.printSpaceBeforeIdentifier();
                                            try p.printIdentifierUTF16(str.slice16());

                                            // Use a shorthand property if the names are the same
                                            switch (property.value.data) {
                                                .b_identifier => |id| {
                                                    if (strings.utf16EqlString(str.slice16(), p.renamer.nameForSymbol(id.ref))) {
                                                        try p.maybePrintDefaultBindingValue(property);
                                                        continue;
                                                    }
                                                },
                                                else => {},
                                            }
                                        } else {
                                            try p.printExpr(property.key, .lowest, ExprFlag.None());
                                        }
                                    },
                                    else => {
                                        try p.printExpr(property.key, .lowest, ExprFlag.None());
                                    },
                                }

                                try p.print(":");
                                try p.printSpace();
                            }

                            try p.printBinding(property.value);
                            try p.maybePrintDefaultBindingValue(property);
                        }

                        if (!b.is_single_line) {
                            p.unindent();
                            try p.printNewline();
                            try p.printIndent();
                        } else {
                            try p.printSpace();
                        }
                    }
                    try p.print("}");
                },
            }
        }

        pub fn maybePrintDefaultBindingValue(p: *Printer, property: anytype) PrintResult.Error!void {
            if (property.default_value) |default| {
                try p.printSpace();
                try p.print("=");
                try p.printSpace();
                try p.printExpr(default, .comma, ExprFlag.None());
            }
        }

        pub fn printStmt(p: *Printer, stmt: Stmt) PrintResult.Error!void {
            if (!p.stack_check.isSafeToRecurse()) {
                return error.StackOverflow;
            }

            const prev_stmt_tag = p.prev_stmt_tag;

            defer {
                p.prev_stmt_tag = std.meta.activeTag(stmt.data);
            }

            switch (stmt.data) {
                .s_comment => |s| {
                    try p.printIndentedComment(s.text);
                },
                .s_function => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    const name = s.func.name orelse Output.panic("Internal error: expected func to have a name ref\n{any}", .{s});
                    const nameRef = name.ref orelse Output.panic("Internal error: expected func to have a name\n{any}", .{s});

                    if (s.func.flags.contains(.is_export)) {
                        if (!rewrite_esm_to_cjs) {
                            try p.print("export ");
                        }
                    }
                    if (s.func.flags.contains(.is_async)) {
                        try p.print("async ");
                    }
                    try p.print("function");
                    if (s.func.flags.contains(.is_generator)) {
                        try p.print("*");
                        try p.printSpace();
                    } else {
                        try p.printSpaceBeforeIdentifier();
                    }

                    try p.addSourceMapping(name.loc);
                    try p.printSymbol(nameRef);
                    try p.printFunc(s.func);

                    // if (rewrite_esm_to_cjs and s.func.flags.contains(.is_export)) {
                    //     p.printSemicolonAfterStatement();
                    //     p.print("var ");
                    //     p.printSymbol(nameRef);
                    //     p.@"print = "();
                    //     p.printSymbol(nameRef);
                    //     p.printSemicolonAfterStatement();
                    // } else {
                    try p.printNewline();
                    // }

                    if (rewrite_esm_to_cjs and s.func.flags.contains(.is_export)) {
                        try p.printIndent();
                        try p.printBundledExport(p.renamer.nameForSymbol(nameRef), p.renamer.nameForSymbol(nameRef));
                        try p.printSemicolonAfterStatement();
                    }
                },
                .s_class => |s| {
                    // Give an extra newline for readaiblity
                    if (prev_stmt_tag != .s_empty) {
                        try p.printNewline();
                    }

                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    const nameRef = s.class.class_name.?.ref.?;
                    if (s.is_export) {
                        if (!rewrite_esm_to_cjs) {
                            try p.print("export ");
                        }
                    }

                    try p.print("class ");
                    try p.addSourceMapping(s.class.class_name.?.loc);
                    try p.printSymbol(nameRef);
                    try p.printClass(s.class);

                    if (rewrite_esm_to_cjs and s.is_export) {
                        try p.printSemicolonAfterStatement();
                    } else {
                        try p.printNewline();
                    }

                    if (rewrite_esm_to_cjs) {
                        if (s.is_export) {
                            try p.printIndent();
                            try p.printBundledExport(p.renamer.nameForSymbol(nameRef), p.renamer.nameForSymbol(nameRef));
                            try p.printSemicolonAfterStatement();
                        }
                    }
                },
                .s_empty => {
                    if (p.prev_stmt_tag == .s_empty and p.options.indent.count == 0) return;

                    try p.printIndent();
                    try p.addSourceMapping(stmt.loc);
                    try p.print(";");
                    try p.printNewline();
                },
                .s_export_default => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("export default ");

                    switch (s.value) {
                        .expr => |expr| {

                            // Functions and classes must be wrapped to avoid confusion with their statement forms
                            p.export_default_start = p.writer.written;
                            try p.printExpr(expr, .comma, ExprFlag.None());
                            try p.printSemicolonAfterStatement();
                            return;
                        },

                        .stmt => |s2| {
                            switch (s2.data) {
                                .s_function => |func| {
                                    try p.printSpaceBeforeIdentifier();

                                    if (func.func.flags.contains(.is_async)) {
                                        try p.print("async ");
                                    }
                                    try p.print("function");

                                    if (func.func.flags.contains(.is_generator)) {
                                        try p.print("*");
                                        try p.printSpace();
                                    } else {
                                        try p.maybePrintSpace();
                                    }

                                    if (func.func.name) |name| {
                                        try p.printSymbol(name.ref.?);
                                    }

                                    try p.printFunc(func.func);

                                    try p.printNewline();
                                },
                                .s_class => |class| {
                                    try p.printSpaceBeforeIdentifier();

                                    if (class.class.class_name) |name| {
                                        try p.print("class ");
                                        try p.printSymbol(name.ref orelse Output.panic("Internal error: Expected class to have a name ref\n{any}", .{class}));
                                    } else {
                                        try p.print("class");
                                    }

                                    try p.printClass(class.class);

                                    try p.printNewline();
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
                        try p.printNewline();
                    }
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);

                    if (s.alias != null)
                        try p.printWhitespacer(comptime ws("export *").append(" as "))
                    else
                        try p.printWhitespacer(comptime ws("export * from "));

                    if (s.alias) |alias| {
                        try p.printClauseAlias(alias.original_name);
                        try p.print(" ");
                        try p.printWhitespacer(ws("from "));
                    }

                    try p.printImportRecordPath(p.importRecord(s.import_record_index));
                    try p.printSemicolonAfterStatement();
                },
                .s_export_clause => |s| {
                    if (rewrite_esm_to_cjs) {
                        try p.printIndent();
                        try p.printSpaceBeforeIdentifier();
                        try p.addSourceMapping(stmt.loc);

                        switch (s.items.len) {
                            0 => {},
                            // It unfortunately cannot be so simple as exports.foo = foo;
                            // If we have a lazy re-export and it's read-only...
                            // we have to overwrite it via Object.defineProperty

                            // Object.assign(__export, {prop1, prop2, prop3});
                            else => {
                                try p.print("Object.assign");

                                try p.print("(");
                                try p.printModuleExportSymbol();
                                try p.print(",");
                                try p.printSpace();
                                try p.print("{");
                                try p.printSpace();
                                const last = s.items.len - 1;
                                for (s.items, 0..) |item, i| {
                                    const symbol = p.symbols().getWithLink(item.name.ref.?).?;
                                    const name = symbol.original_name;
                                    var did_print = false;

                                    if (symbol.namespace_alias) |namespace| {
                                        const import_record = p.importRecord(namespace.import_record_index);
                                        if (namespace.was_originally_property_access) {
                                            try p.printIdentifier(name);
                                            try p.print(": () => ");
                                            try p.printNamespaceAlias(import_record.*, namespace);
                                            did_print = true;
                                        }
                                    }

                                    if (!did_print) {
                                        try p.printClauseAlias(item.alias);
                                        if (!strings.eql(name, item.alias)) {
                                            try p.print(":");
                                            try p.printSpaceBeforeIdentifier();
                                            try p.printIdentifier(name);
                                        }
                                    }

                                    if (i < last) {
                                        try p.print(",");
                                    }
                                }
                                try p.print("})");
                                try p.printSemicolonAfterStatement();
                            },
                        }
                        return;
                    }

                    // Give an extra newline for export default for readability
                    if (!prev_stmt_tag.isExportLike()) {
                        try p.printNewline();
                    }

                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("export");
                    try p.printSpace();

                    if (s.items.len == 0) {
                        try p.print("{}");
                        try p.printSemicolonAfterStatement();
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
                                            try p.print("var ");
                                            try p.printSymbol(item.name.ref.?);
                                            try p.@"print = "();
                                            try p.printNamespaceAlias(import_record.*, namespace);
                                            try p.printSemicolonAfterStatement();
                                            _ = array.swapRemove(i);

                                            if (i < array.items.len) {
                                                try p.printIndent();
                                                try p.printSpaceBeforeIdentifier();
                                                try p.print("export");
                                                try p.printSpace();
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

                    try p.print("{");

                    if (!s.is_single_line) {
                        p.indent();
                    } else {
                        try p.printSpace();
                    }

                    for (s.items, 0..) |item, i| {
                        if (i != 0) {
                            try p.print(",");
                            if (s.is_single_line) {
                                try p.printSpace();
                            }
                        }

                        if (!s.is_single_line) {
                            try p.printNewline();
                            try p.printIndent();
                        }

                        try p.printExportClauseItem(item);
                    }

                    if (!s.is_single_line) {
                        p.unindent();
                        try p.printNewline();
                        try p.printIndent();
                    } else {
                        try p.printSpace();
                    }

                    try p.print("}");
                    try p.printSemicolonAfterStatement();
                },
                .s_export_from => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);

                    const import_record = p.importRecord(s.import_record_index);

                    try p.printWhitespacer(ws("export {"));

                    if (!s.is_single_line) {
                        p.indent();
                    } else {
                        try p.printSpace();
                    }

                    for (s.items, 0..) |item, i| {
                        if (i != 0) {
                            try p.print(",");
                            if (s.is_single_line) {
                                try p.printSpace();
                            }
                        }

                        if (!s.is_single_line) {
                            try p.printNewline();
                            try p.printIndent();
                        }
                        try p.printExportClauseItem(item);
                    }

                    if (!s.is_single_line) {
                        p.unindent();
                        try p.printNewline();
                        try p.printIndent();
                    } else {
                        try p.printSpace();
                    }

                    try p.printWhitespacer(ws("} from "));
                    try p.printImportRecordPath(import_record);
                    try p.printSemicolonAfterStatement();
                },
                .s_local => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    switch (s.kind) {
                        .k_const => {
                            try p.printDeclStmt(s.is_export, "const", s.decls.slice());
                        },
                        .k_let => {
                            try p.printDeclStmt(s.is_export, "let", s.decls.slice());
                        },
                        .k_var => {
                            try p.printDeclStmt(s.is_export, "var", s.decls.slice());
                        },
                        .k_using => {
                            try p.printDeclStmt(s.is_export, "using", s.decls.slice());
                        },
                        .k_await_using => {
                            try p.printDeclStmt(s.is_export, "await using", s.decls.slice());
                        },
                    }
                },
                .s_if => |s| {
                    try p.printIndent();
                    try p.printIf(s, stmt.loc);
                },
                .s_do_while => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("do");
                    switch (s.body.data) {
                        .s_block => {
                            try p.printSpace();
                            try p.printBlock(s.body.loc, s.body.data.s_block.stmts, s.body.data.s_block.close_brace_loc);
                            try p.printSpace();
                        },
                        else => {
                            try p.printNewline();
                            p.indent();
                            try p.printStmt(s.body);
                            try p.printSemicolonIfNeeded();
                            p.unindent();
                            try p.printIndent();
                        },
                    }

                    try p.print("while");
                    try p.printSpace();
                    try p.print("(");
                    try p.printExpr(s.test_, .lowest, ExprFlag.None());
                    try p.print(")");
                    try p.printSemicolonAfterStatement();
                },
                .s_for_in => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("for");
                    try p.printSpace();
                    try p.print("(");
                    try p.printForLoopInit(s.init);
                    try p.printSpace();
                    try p.printSpaceBeforeIdentifier();
                    try p.print("in");
                    try p.printSpace();
                    try p.printExpr(s.value, .lowest, ExprFlag.None());
                    try p.print(")");
                    try p.printBody(s.body);
                },
                .s_for_of => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("for");
                    if (s.is_await) {
                        try p.print(" await");
                    }
                    try p.printSpace();
                    try p.print("(");
                    p.for_of_init_start = p.writer.written;
                    try p.printForLoopInit(s.init);
                    try p.printSpace();
                    try p.printSpaceBeforeIdentifier();
                    try p.print("of");
                    try p.printSpace();
                    try p.printExpr(s.value, .comma, ExprFlag.None());
                    try p.print(")");
                    try p.printBody(s.body);
                },
                .s_while => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("while");
                    try p.printSpace();
                    try p.print("(");
                    try p.printExpr(s.test_, .lowest, ExprFlag.None());
                    try p.print(")");
                    try p.printBody(s.body);
                },
                .s_with => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("with");
                    try p.printSpace();
                    try p.print("(");
                    try p.printExpr(s.value, .lowest, ExprFlag.None());
                    try p.print(")");
                    try p.printBody(s.body);
                },
                .s_label => |s| {
                    if (!p.options.minify_whitespace and p.options.indent.count > 0) {
                        try p.printIndent();
                    }
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.printSymbol(s.name.ref orelse Output.panic("Internal error: expected label to have a name {any}", .{s}));
                    try p.print(":");
                    try p.printBody(s.stmt);
                },
                .s_try => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("try");
                    try p.printSpace();
                    try p.printBlock(s.body_loc, s.body, null);

                    if (s.catch_) |catch_| {
                        try p.printSpace();
                        try p.addSourceMapping(catch_.loc);
                        try p.print("catch");
                        if (catch_.binding) |binding| {
                            try p.printSpace();
                            try p.print("(");
                            try p.printBinding(binding);
                            try p.print(")");
                        }
                        try p.printSpace();
                        try p.printBlock(catch_.body_loc, catch_.body, null);
                    }

                    if (s.finally) |finally| {
                        try p.printSpace();
                        try p.print("finally");
                        try p.printSpace();
                        try p.printBlock(finally.loc, finally.stmts, null);
                    }

                    try p.printNewline();
                },
                .s_for => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("for");
                    try p.printSpace();
                    try p.print("(");

                    if (s.init) |init_| {
                        try p.printForLoopInit(init_);
                    }

                    try p.print(";");

                    if (s.test_) |test_| {
                        try p.printExpr(test_, .lowest, ExprFlag.None());
                    }

                    try p.print(";");
                    try p.printSpace();

                    if (s.update) |update| {
                        try p.printExpr(update, .lowest, ExprFlag.None());
                    }

                    try p.print(")");
                    try p.printBody(s.body);
                },
                .s_switch => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("switch");
                    try p.printSpace();
                    try p.print("(");

                    try p.printExpr(s.test_, .lowest, ExprFlag.None());

                    try p.print(")");
                    try p.printSpace();
                    try p.print("{");
                    try p.printNewline();
                    p.indent();

                    for (s.cases) |c| {
                        try p.printSemicolonIfNeeded();
                        try p.printIndent();

                        if (c.value) |val| {
                            try p.print("case");
                            try p.printSpace();
                            try p.printExpr(val, .logical_and, ExprFlag.None());
                        } else {
                            try p.print("default");
                        }

                        try p.print(":");

                        if (c.body.len == 1) {
                            switch (c.body[0].data) {
                                .s_block => {
                                    try p.printSpace();
                                    try p.printBlock(c.body[0].loc, c.body[0].data.s_block.stmts, c.body[0].data.s_block.close_brace_loc);
                                    try p.printNewline();
                                    continue;
                                },
                                else => {},
                            }
                        }

                        try p.printNewline();
                        p.indent();
                        for (c.body) |st| {
                            try p.printSemicolonIfNeeded();
                            try p.printStmt(st);
                        }
                        p.unindent();
                    }

                    p.unindent();
                    try p.printIndent();
                    try p.print("}");
                    try p.printNewline();
                    p.needs_semicolon = false;
                },
                .s_import => |s| {
                    bun.assert(s.import_record_index < p.import_records.len);
                    bun.debugAssert(p.options.module_type != .internal_bake_dev);

                    const record: *const ImportRecord = p.importRecord(s.import_record_index);
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);

                    if (comptime is_bun_platform) {
                        switch (record.tag) {
                            .bun_test => {
                                try p.printBunJestImportStatement(s.*);
                                return;
                            },
                            .bun => {
                                try p.printGlobalBunImportStatement(s.*);
                                return;
                            },
                            else => {},
                        }
                    }

                    if (record.path.is_disabled) {
                        if (record.contains_import_star) {
                            try p.print("var ");
                            try p.printSymbol(s.namespace_ref);
                            try p.@"print = "();
                            try p.printDisabledImport();
                            try p.printSemicolonAfterStatement();
                        }

                        if (s.items.len > 0 or s.default_name != null) {
                            try p.printIndent();
                            try p.printSpaceBeforeIdentifier();
                            try p.printWhitespacer(ws("var {"));

                            if (s.default_name) |default_name| {
                                try p.printSpace();
                                try p.print("default:");
                                try p.printSpace();
                                try p.printSymbol(default_name.ref.?);

                                if (s.items.len > 0) {
                                    try p.printSpace();
                                    try p.print(",");
                                    try p.printSpace();
                                    for (s.items, 0..) |item, i| {
                                        try p.printClauseItemAs(item, .@"var");

                                        if (i < s.items.len - 1) {
                                            try p.print(",");
                                            try p.printSpace();
                                        }
                                    }
                                }
                            } else {
                                for (s.items, 0..) |item, i| {
                                    try p.printClauseItemAs(item, .@"var");

                                    if (i < s.items.len - 1) {
                                        try p.print(",");
                                        try p.printSpace();
                                    }
                                }
                            }

                            try p.print("}");
                            try p.@"print = "();

                            if (record.contains_import_star) {
                                try p.printSymbol(s.namespace_ref);
                                try p.printSemicolonAfterStatement();
                            } else {
                                try p.printDisabledImport();
                                try p.printSemicolonAfterStatement();
                            }
                        }

                        return;
                    }

                    if (record.handles_import_errors and record.path.is_disabled and record.kind.isCommonJS()) {
                        return;
                    }

                    try p.print("import");

                    var item_count: usize = 0;

                    if (s.default_name) |name| {
                        try p.print(" ");
                        try p.printSymbol(name.ref.?);
                        item_count += 1;
                    }

                    if (s.items.len > 0) {
                        if (item_count > 0) {
                            try p.print(",");
                        }
                        try p.printSpace();

                        try p.print("{");
                        if (!s.is_single_line) {
                            p.indent();
                        } else {
                            try p.printSpace();
                        }

                        for (s.items, 0..) |item, i| {
                            if (i != 0) {
                                try p.print(",");
                                if (s.is_single_line) {
                                    try p.printSpace();
                                }
                            }

                            if (!s.is_single_line) {
                                try p.printNewline();
                                try p.printIndent();
                            }

                            try p.printClauseItem(item);
                        }

                        if (!s.is_single_line) {
                            p.unindent();
                            try p.printNewline();
                            try p.printIndent();
                        } else {
                            try p.printSpace();
                        }
                        try p.print("}");
                        item_count += 1;
                    }

                    if (record.contains_import_star) {
                        if (item_count > 0) {
                            try p.print(",");
                        }
                        try p.printSpace();

                        try p.printWhitespacer(ws("* as"));
                        try p.print(" ");
                        try p.printSymbol(s.namespace_ref);
                        item_count += 1;
                    }

                    if (item_count > 0) {
                        if (!p.options.minify_whitespace or
                            record.contains_import_star or
                            s.items.len == 0)
                            try p.print(" ");

                        try p.printWhitespacer(ws("from "));
                    }

                    try p.printImportRecordPath(record);

                    // backwards compatibility: previously, we always stripped type
                    if (comptime is_bun_platform) if (record.loader) |loader| switch (loader) {
                        .jsx => try p.printWhitespacer(ws(" with { type: \"jsx\" }")),
                        .js => try p.printWhitespacer(ws(" with { type: \"js\" }")),
                        .ts => try p.printWhitespacer(ws(" with { type: \"ts\" }")),
                        .tsx => try p.printWhitespacer(ws(" with { type: \"tsx\" }")),
                        .css => try p.printWhitespacer(ws(" with { type: \"css\" }")),
                        .file => try p.printWhitespacer(ws(" with { type: \"file\" }")),
                        .json => try p.printWhitespacer(ws(" with { type: \"json\" }")),
                        .jsonc => try p.printWhitespacer(ws(" with { type: \"jsonc\" }")),
                        .toml => try p.printWhitespacer(ws(" with { type: \"toml\" }")),
                        .yaml => try p.printWhitespacer(ws(" with { type: \"yaml\" }")),
                        .wasm => try p.printWhitespacer(ws(" with { type: \"wasm\" }")),
                        .napi => try p.printWhitespacer(ws(" with { type: \"napi\" }")),
                        .base64 => try p.printWhitespacer(ws(" with { type: \"base64\" }")),
                        .dataurl => try p.printWhitespacer(ws(" with { type: \"dataurl\" }")),
                        .text => try p.printWhitespacer(ws(" with { type: \"text\" }")),
                        .bunsh => try p.printWhitespacer(ws(" with { type: \"sh\" }")),
                        // sqlite_embedded only relevant when bundling
                        .sqlite, .sqlite_embedded => try p.printWhitespacer(ws(" with { type: \"sqlite\" }")),
                        .html => try p.printWhitespacer(ws(" with { type: \"html\" }")),
                    };
                    try p.printSemicolonAfterStatement();
                },
                .s_block => |s| {
                    try p.printIndent();
                    try p.printBlock(stmt.loc, s.stmts, s.close_brace_loc);
                    try p.printNewline();
                },
                .s_debugger => {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("debugger");
                    try p.printSemicolonAfterStatement();
                },
                .s_directive => |s| {
                    if (comptime is_json)
                        unreachable;

                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.printStringLiteralUTF8(s.value, false);
                    try p.printSemicolonAfterStatement();
                },
                .s_break => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("break");
                    if (s.label) |label| {
                        try p.print(" ");
                        try p.printSymbol(label.ref.?);
                    }

                    try p.printSemicolonAfterStatement();
                },
                .s_continue => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("continue");

                    if (s.label) |label| {
                        try p.print(" ");
                        try p.printSymbol(label.ref.?);
                    }
                    try p.printSemicolonAfterStatement();
                },
                .s_return => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("return");

                    if (s.value) |value| {
                        try p.printSpace();
                        try p.printExpr(value, .lowest, ExprFlag.None());
                    }
                    try p.printSemicolonAfterStatement();
                },
                .s_throw => |s| {
                    try p.printIndent();
                    try p.printSpaceBeforeIdentifier();
                    try p.addSourceMapping(stmt.loc);
                    try p.print("throw");
                    try p.printSpace();
                    try p.printExpr(s.value, .lowest, ExprFlag.None());
                    try p.printSemicolonAfterStatement();
                },
                .s_expr => |s| {
                    if (!p.options.minify_whitespace and p.options.indent.count > 0) {
                        try p.printIndent();
                    }

                    p.stmt_start = p.writer.written;
                    try p.printExpr(s.value, .lowest, ExprFlag.ExprResultIsUnused());
                    try p.printSemicolonAfterStatement();
                },
                else => |tag| {
                    Output.panic("Unexpected tag in printStmt: .{s}", .{@tagName(tag)});
                },
            }
        }

        pub inline fn printModuleExportSymbol(p: *Printer) OOM!void {
            try p.print("module.exports");
        }

        pub fn printImportRecordPath(p: *Printer, import_record: *const ImportRecord) OOM!void {
            if (comptime is_json)
                unreachable;

            const quote = bestQuoteCharForString(u8, import_record.path.text, false);
            if (import_record.print_namespace_in_path and !import_record.path.isFile()) {
                try p.print(quote);
                try p.printStringCharactersUTF8(import_record.path.namespace, quote);
                try p.print(":");
                try p.printStringCharactersUTF8(import_record.path.text, quote);
                try p.print(quote);
            } else {
                try p.print(quote);
                try p.printStringCharactersUTF8(import_record.path.text, quote);
                try p.print(quote);
            }
        }

        pub fn printBundledImport(p: *Printer, record: ImportRecord, s: *S.Import) OOM!void {
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
                        try p.printCallModuleID(module_id);
                        try p.printSemicolonAfterStatement();
                    }
                },
                .import_items_and_default, .import_default => {
                    if (!is_disabled) {
                        try p.print("var $");
                        try p.printModuleId(module_id);
                        try p.@"print = "();
                        try p.printLoadFromBundle(s.import_record_index);

                        if (s.default_name) |default_name| {
                            try p.print(", ");
                            try p.printSymbol(default_name.ref.?);
                            try p.print(" = (($");
                            try p.printModuleId(module_id);

                            try p.print(" && \"default\" in $");
                            try p.printModuleId(module_id);
                            try p.print(") ? $");
                            try p.printModuleId(module_id);
                            try p.print(".default : $");
                            try p.printModuleId(module_id);
                            try p.print(")");
                        }
                    } else {
                        if (s.default_name) |default_name| {
                            try p.print("var ");
                            try p.printSymbol(default_name.ref.?);
                            try p.@"print = "();
                            try p.printDisabledImport();
                        }
                    }

                    try p.printSemicolonAfterStatement();
                },
                .import_star_and_import_default => {
                    try p.print("var ");
                    try p.printSymbol(s.namespace_ref);
                    try p.@"print = "();
                    try p.printLoadFromBundle(s.import_record_index);

                    if (s.default_name) |default_name| {
                        try p.print(",");
                        try p.printSpace();
                        try p.printSymbol(default_name.ref.?);
                        try p.@"print = "();

                        if (!is_bun_platform) {
                            try p.print("(");
                            try p.printSymbol(s.namespace_ref);
                            try p.printWhitespacer(ws(" && \"default\" in "));
                            try p.printSymbol(s.namespace_ref);
                            try p.printWhitespacer(ws(" ? "));
                            try p.printSymbol(s.namespace_ref);
                            try p.printWhitespacer(ws(".default : "));
                            try p.printSymbol(s.namespace_ref);
                            try p.print(")");
                        } else {
                            try p.printSymbol(s.namespace_ref);
                        }
                    }
                    try p.printSemicolonAfterStatement();
                },
                .import_star => {
                    try p.print("var ");
                    try p.printSymbol(s.namespace_ref);
                    try p.@"print = "();
                    try p.printLoadFromBundle(s.import_record_index);
                    try p.printSemicolonAfterStatement();
                },

                else => {
                    try p.print("var $");
                    try p.printModuleIdAssumeEnabled(module_id);
                    try p.@"print = "();
                    try p.printLoadFromBundle(s.import_record_index);
                    try p.printSemicolonAfterStatement();
                },
            }
        }
        pub fn printLoadFromBundle(p: *Printer, import_record_index: u32) OOM!void {
            try p.printLoadFromBundleWithoutCall(import_record_index);
            try p.print("()");
        }

        inline fn printDisabledImport(p: *Printer) OOM!void {
            try p.printWhitespacer(ws("(() => ({}))"));
        }

        pub fn printLoadFromBundleWithoutCall(p: *Printer, import_record_index: u32) OOM!void {
            const record = p.importRecord(import_record_index);
            if (record.path.is_disabled) {
                try p.printDisabledImport();
                return;
            }

            @call(bun.callmod_inline, printModuleId, .{ p, p.importRecord(import_record_index).module_id });
        }

        pub fn printCallModuleID(p: *Printer, module_id: u32) OOM!void {
            printModuleId(p, module_id);
            try p.print("()");
        }

        inline fn printModuleId(p: *Printer, module_id: u32) OOM!void {
            bun.assert(module_id != 0); // either module_id is forgotten or it should be disabled
            try p.printModuleIdAssumeEnabled(module_id);
        }

        inline fn printModuleIdAssumeEnabled(p: *Printer, module_id: u32) OOM!void {
            try p.print("$");
            try std.fmt.formatInt(module_id, 16, .lower, .{}, p);
        }

        pub fn printBundledRexport(p: *Printer, name: string, import_record_index: u32) OOM!void {
            try p.print("Object.defineProperty(");
            try p.printModuleExportSymbol();
            try p.print(",");
            try p.printStringLiteralUTF8(name, true);

            try p.printWhitespacer(ws(",{get: () => ("));
            try p.printLoadFromBundle(import_record_index);
            try p.printWhitespacer(ws("), enumerable: true, configurable: true})"));
        }

        // We must use Object.defineProperty() to handle re-exports from ESM -> CJS
        // Here is an example where a runtime error occurs when assigning directly to module.exports
        // > 24077 |   module.exports.init = init;
        // >       ^
        // >  TypeError: Attempted to assign to readonly property.
        pub fn printBundledExport(p: *Printer, name: string, identifier: string) OOM!void {
            // In the event that
            try p.print("Object.defineProperty(");
            try p.printModuleExportSymbol();
            try p.print(",");
            try p.printStringLiteralUTF8(name, true);
            try p.print(",{get: () => ");
            try p.printIdentifier(identifier);
            try p.print(", enumerable: true, configurable: true})");
        }

        pub fn printForLoopInit(p: *Printer, initSt: Stmt) PrintResult.Error!void {
            switch (initSt.data) {
                .s_expr => |s| {
                    try p.printExpr(
                        s.value,
                        .lowest,
                        ExprFlag.Set.init(.{ .forbid_in = true, .expr_result_is_unused = true }),
                    );
                },
                .s_local => |s| {
                    switch (s.kind) {
                        .k_var => {
                            try p.printDecls("var", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
                        },
                        .k_let => {
                            try p.printDecls("let", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
                        },
                        .k_const => {
                            try p.printDecls("const", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
                        },
                        .k_using => {
                            try p.printDecls("using", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
                        },
                        .k_await_using => {
                            try p.printDecls("await using", s.decls.slice(), ExprFlag.Set.init(.{ .forbid_in = true }));
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
        pub fn printIf(p: *Printer, s: *const S.If, loc: logger.Loc) PrintResult.Error!void {
            try p.printSpaceBeforeIdentifier();
            try p.addSourceMapping(loc);
            try p.print("if");
            try p.printSpace();
            try p.print("(");
            try p.printExpr(s.test_, .lowest, ExprFlag.None());
            try p.print(")");

            switch (s.yes.data) {
                .s_block => |block| {
                    try p.printSpace();
                    try p.printBlock(s.yes.loc, block.stmts, block.close_brace_loc);

                    if (s.no != null) {
                        try p.printSpace();
                    } else {
                        try p.printNewline();
                    }
                },
                else => {
                    if (wrapToAvoidAmbiguousElse(&s.yes.data)) {
                        try p.printSpace();
                        try p.print("{");
                        try p.printNewline();

                        p.indent();
                        try p.printStmt(s.yes);
                        p.unindent();
                        p.needs_semicolon = false;

                        try p.printIndent();
                        try p.print("}");

                        if (s.no != null) {
                            try p.printSpace();
                        } else {
                            try p.printNewline();
                        }
                    } else {
                        try p.printNewline();
                        p.indent();
                        try p.printStmt(s.yes);
                        p.unindent();

                        if (s.no != null) {
                            try p.printIndent();
                        }
                    }
                },
            }

            if (s.no) |no_block| {
                try p.printSemicolonIfNeeded();
                try p.printSpaceBeforeIdentifier();
                try p.addSourceMapping(no_block.loc);
                try p.print("else");

                switch (no_block.data) {
                    .s_block => {
                        try p.printSpace();
                        try p.printBlock(no_block.loc, no_block.data.s_block.stmts, null);
                        try p.printNewline();
                    },
                    .s_if => {
                        try p.printIf(no_block.data.s_if, no_block.loc);
                    },
                    else => {
                        try p.printNewline();
                        p.indent();
                        try p.printStmt(no_block);
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
        ) PrintResult.Error!void {
            switch (inlined) {
                .number => |num| try p.printNumber(num, level),

                // TODO: extract printString
                .string => |str| try p.printExpr(.{
                    .data = .{ .e_string = str },
                    .loc = logger.Loc.Empty,
                }, level, .{}),
            }

            if (!p.options.minify_whitespace and !p.options.minify_identifiers) {
                // TODO: rewrite this to handle </script>
                if (!bun.strings.containsComptime(comment, "*/")) {
                    try p.print(" /* ");
                    try p.print(comment);
                    try p.print(" */");
                }
            }
        }

        pub fn printDeclStmt(p: *Printer, is_export: bool, comptime keyword: string, decls: []G.Decl) PrintResult.Error!void {
            if (!rewrite_esm_to_cjs and is_export) {
                try p.print("export ");
            }
            try p.printDecls(keyword, decls, ExprFlag.None());
            try p.printSemicolonAfterStatement();
            if (rewrite_esm_to_cjs and is_export and decls.len > 0) {
                for (decls) |decl| {
                    try p.printIndent();
                    try p.printSymbol(p.options.runtime_imports.__export.?.ref);
                    try p.print("(");
                    try p.printSpaceBeforeIdentifier();
                    try p.printModuleExportSymbol();
                    try p.print(",");
                    try p.printSpace();

                    switch (decl.binding.data) {
                        .b_identifier => |ident| {
                            try p.print("{");
                            try p.printSpace();
                            try p.printSymbol(ident.ref);
                            if (p.options.minify_whitespace)
                                try p.print(":()=>(")
                            else
                                try p.print(": () => (");
                            try p.printSymbol(ident.ref);
                            try p.print(") }");
                        },
                        .b_object => |obj| {
                            try p.print("{");
                            try p.printSpace();
                            for (obj.properties) |prop| {
                                switch (prop.value.data) {
                                    .b_identifier => |ident| {
                                        try p.printSymbol(ident.ref);
                                        if (p.options.minify_whitespace)
                                            try p.print(":()=>(")
                                        else
                                            try p.print(": () => (");
                                        try p.printSymbol(ident.ref);
                                        try p.print("),");
                                        try p.printNewline();
                                    },
                                    else => {},
                                }
                            }
                            try p.print("}");
                        },
                        else => {
                            try p.printBinding(decl.binding);
                        },
                    }
                    try p.print(")");
                    try p.printSemicolonAfterStatement();
                }
            }
        }

        pub fn printIdentifier(p: *Printer, identifier: string) OOM!void {
            if (comptime ascii_only) {
                try p.printIdentifierAsciiOnly(identifier);
            } else {
                try p.print(identifier);
            }
        }

        fn printIdentifierAsciiOnly(p: *Printer, identifier: string) OOM!void {
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
                            try p.print(identifier[ascii_start..cursor.i]);
                            is_ascii = false;
                        }

                        try p.print("\\u{");
                        try std.fmt.formatInt(cursor.c, 16, .lower, .{}, p);
                        try p.print("}");
                    },
                }
            }

            if (is_ascii) {
                try p.print(identifier[ascii_start..]);
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
                            try p.print(
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
                            try p.print("\\u");
                            var buf_ptr = try p.writer.reserve(4);
                            p.writer.advance(strings.encodeWTF8RuneT(buf_ptr[0..4], CodeUnitType, c));
                        },
                    }
                    continue;
                }

                {
                    var buf_ptr = try p.writer.reserve(4);
                    p.writer.advance(strings.encodeWTF8RuneT(buf_ptr[0..4], CodeUnitType, c));
                }
            }
        }

        pub fn printNumber(p: *Printer, value: f64, level: Level) OOM!void {
            const absValue = @abs(value);
            if (std.math.isNan(value)) {
                try p.printSpaceBeforeIdentifier();
                try p.print("NaN");
            } else if (std.math.isPositiveInf(value) or std.math.isNegativeInf(value)) {
                const wrap = ((!p.options.has_run_symbol_renamer or p.options.minify_syntax) and level.gte(.multiply)) or
                    (std.math.isNegativeInf(value) and level.gte(.prefix));

                if (wrap) {
                    try p.print("(");
                }

                if (std.math.isNegativeInf(value)) {
                    try p.printSpaceBeforeOperator(.un_neg);
                    try p.print("-");
                } else {
                    try p.printSpaceBeforeIdentifier();
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
                    try p.print("Infinity");
                } else if (p.options.minify_whitespace) {
                    try p.print("1/0");
                } else {
                    try p.print("1 / 0");
                }

                if (wrap) {
                    try p.print(")");
                }
            } else if (!std.math.signbit(value)) {
                try p.printSpaceBeforeIdentifier();

                try p.printNonNegativeFloat(absValue);

                // Remember the end of the latest number
                p.prev_num_end = p.writer.written;
            } else if (level.gte(.prefix)) {
                // Expressions such as "(-1).toString" need to wrap negative numbers.
                // Instead of testing for "value < 0" we test for "signbit(value)" and
                // "!isNaN(value)" because we need this to be true for "-0" and "-0 < 0"
                // is false.
                try p.print("(-");
                try p.printNonNegativeFloat(absValue);
                try p.print(")");
            } else {
                try p.printSpaceBeforeOperator(Op.Code.un_neg);
                try p.print("-");
                try p.printNonNegativeFloat(absValue);

                // Remember the end of the latest number
                p.prev_num_end = p.writer.written;
            }
        }

        pub fn printIndentedComment(p: *Printer, _text: string) OOM!void {
            var text = _text;
            if (strings.startsWith(text, "/*")) {
                // Re-indent multi-line comments
                while (strings.indexOfChar(text, '\n')) |newline_index| {
                    try p.printIndent();
                    try p.print(text[0 .. newline_index + 1]);
                    text = text[newline_index + 1 ..];
                }
                try p.printIndent();
                try p.print(text);
                try p.printNewline();
            } else {
                // Print a mandatory newline after single-line comments
                try p.printIndent();
                try p.print(text);
                try p.print("\n");
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
                .stack_check = .init(),
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
        ) PrintResult.Error!void {
            p.indent();
            try p.printIndent();

            try p.printStringLiteralUTF8(source.path.pretty, false);

            const func = part.stmts[0].data.s_expr.value.data.e_function.func;

            // Special-case lazy-export AST
            if (ast.has_lazy_export) {
                @branchHint(.unlikely);
                try p.printFnArgs(func.open_parens_loc, func.args, func.flags.contains(.has_rest_arg), false);
                try p.printSpace();
                try p.print("{\n");
                if (func.body.stmts[0].data.s_lazy_export.* != .e_undefined) {
                    p.indent();
                    try p.printIndent();
                    try p.printSymbol(p.options.hmr_ref);
                    try p.print(".cjs.exports = ");
                    try p.printExpr(.{
                        .data = func.body.stmts[0].data.s_lazy_export.*,
                        .loc = func.body.stmts[0].loc,
                    }, .comma, .{});
                    try p.print("; // bun .s_lazy_export\n");
                    p.unindent();
                }
                try p.printIndent();
                try p.print("},\n");
                return;
            }

            // ESM is represented by an array tuple [ dependencies, exports, starImports, load, async ];
            else if (ast.exports_kind == .esm) {
                try p.print(": [ [");
                // Print the dependencies.
                if (part.stmts.len > 1) {
                    p.indent();
                    try p.print("\n");
                    for (part.stmts[1..]) |stmt| {
                        try p.printIndent();
                        const import = stmt.data.s_import;
                        const record = p.importRecord(import.import_record_index);
                        try p.printStringLiteralUTF8(record.path.pretty, false);

                        const item_count = @as(u32, @intFromBool(import.default_name != null)) +
                            @as(u32, @intCast(import.items.len));
                        try p.fmt(", {d},", .{item_count});
                        if (item_count == 0) {
                            // Add a comment explaining why the number could be zero
                            try p.print(if (import.star_name_loc != null) " // namespace import" else " // bare import");
                        } else {
                            if (import.default_name != null) {
                                try p.print(" \"default\",");
                            }
                            for (import.items) |item| {
                                try p.print(" ");
                                try p.printStringLiteralUTF8(item.alias, false);
                                try p.print(",");
                            }
                        }
                        try p.print("\n");
                    }
                    p.unindent();
                    try p.printIndent();
                }
                try p.print("], [");

                // Print the exports
                if (ast.named_exports.count() > 0) {
                    p.indent();
                    var len: usize = std.math.maxInt(usize);
                    for (ast.named_exports.keys()) |key| {
                        if (len > 120) {
                            try p.printNewline();
                            try p.printIndent();
                            len = 0;
                        } else {
                            try p.print(" ");
                        }
                        len += key.len;
                        try p.printStringLiteralUTF8(key, false);
                        try p.print(",");
                    }
                    p.unindent();
                    try p.printNewline();
                    try p.printIndent();
                }
                try p.print("], [");

                // Print export stars
                p.indent();
                var had_any_stars = false;
                for (ast.export_star_import_records) |star| {
                    const record = p.importRecord(star);
                    if (record.path.is_disabled) continue;
                    had_any_stars = true;
                    try p.printNewline();
                    try p.printIndent();
                    try p.printStringLiteralUTF8(record.path.pretty, false);
                    try p.print(",");
                }
                p.unindent();
                if (had_any_stars) {
                    try p.printNewline();
                    try p.printIndent();
                }
                try p.print("], ");

                // Print the code
                try if (!ast.top_level_await_keyword.isEmpty()) p.print("async");
                try p.printFnArgs(func.open_parens_loc, func.args, func.flags.contains(.has_rest_arg), false);
                try p.print(" => {\n");
                p.indent();
                try p.printBlockBody(func.body.stmts);
                p.unindent();
                try p.printIndent();
                try p.print("}, ");

                // Print isAsync
                try p.print(if (!ast.top_level_await_keyword.isEmpty()) "true" else "false");
                try p.print("],\n");
            } else {
                bun.assert(ast.exports_kind == .cjs);
                try p.printFunc(func);
                try p.print(",\n");
            }

            p.unindent();
        }
    };
}

pub fn NewWriter(
    comptime ContextType: type,
    comptime writeByte: fn (ctx: *ContextType, char: u8) OOM!usize,
    comptime writeAllFn: fn (ctx: *ContextType, buf: anytype) OOM!usize,
    comptime getLastByte: fn (ctx: *const ContextType) u8,
    comptime getLastLastByte: fn (ctx: *const ContextType) u8,
    comptime reserveNext: fn (ctx: *ContextType, count: u64) OOM![*]u8,
    comptime advanceBy: fn (ctx: *ContextType, count: u64) void,
) type {
    return struct {
        const Self = @This();
        ctx: ContextType,
        written: i64 = -1,
        // Used by the printer
        prev_char: u8 = 0,
        prev_prev_char: u8 = 0,

        pub fn init(ctx: ContextType) Self {
            return .{
                .ctx = ctx,
            };
        }

        pub fn stdWriter(self: *Self) std.io.Writer(*Self, OOM, stdWriterWrite) {
            return .{ .context = self };
        }
        pub fn stdWriterWrite(self: *Self, bytes: []const u8) OOM!usize {
            try self.print([]const u8, bytes);
            return bytes.len;
        }

        pub fn getMutableBuffer(this: *Self) *MutableString {
            return this.ctx.getMutableBuffer();
        }

        pub fn takeBuffer(this: *Self) MutableString {
            return this.ctx.takeBuffer();
        }

        pub fn slice(this: *Self) string {
            return this.ctx.slice();
        }

        pub inline fn prevChar(writer: *const Self) u8 {
            return @call(bun.callmod_inline, getLastByte, .{&writer.ctx});
        }

        pub inline fn prevPrevChar(writer: *const Self) u8 {
            return @call(bun.callmod_inline, getLastLastByte, .{&writer.ctx});
        }

        pub fn reserve(writer: *Self, count: u64) OOM![*]u8 {
            return try reserveNext(&writer.ctx, count);
        }

        pub fn advance(writer: *Self, count: u64) void {
            advanceBy(&writer.ctx, count);
            writer.written += @intCast(count);
        }

        pub inline fn print(writer: *Self, comptime ValueType: type, str: ValueType) OOM!void {
            switch (ValueType) {
                comptime_int, u16, u8 => {
                    const written = try writeByte(&writer.ctx, @as(u8, @intCast(str)));
                    writer.written += @intCast(written);
                },
                else => {
                    const written = try writeAllFn(&writer.ctx, str);
                    writer.written += @intCast(written);
                },
            }
        }

        pub fn done(writer: *Self) OOM!void {
            if (std.meta.hasFn(ContextType, "done")) {
                try writer.ctx.done();
            }
        }
    };
}

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

    pub fn takeBuffer(this: *BufferWriter) MutableString {
        defer this.buffer = .initEmpty(this.buffer.allocator);
        return this.buffer;
    }

    pub fn getWritten(this: *BufferWriter) []u8 {
        return this.buffer.list.items;
    }

    pub fn init(allocator: std.mem.Allocator) BufferWriter {
        return BufferWriter{
            .buffer = MutableString.initEmpty(allocator),
        };
    }

    pub fn print(ctx: *BufferWriter, comptime fmt: string, args: anytype) OOM!void {
        try ctx.buffer.list.writer(ctx.buffer.allocator).print(fmt, args);
    }

    pub fn writeByteNTimes(ctx: *BufferWriter, byte: u8, n: usize) OOM!void {
        try ctx.buffer.appendCharNTimes(byte, n);
    }

    pub fn writeByte(ctx: *BufferWriter, byte: u8) OOM!usize {
        try ctx.buffer.appendChar(byte);
        ctx.approximate_newline_count += @intFromBool(byte == '\n');
        ctx.last_bytes = .{ ctx.last_bytes[1], byte };
        return 1;
    }
    pub fn writeAll(ctx: *BufferWriter, bytes: anytype) OOM!usize {
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

    pub fn reserveNext(ctx: *BufferWriter, count: u64) OOM![*]u8 {
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
    ) OOM!void {
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
) OOM!SourceMap.Chunk.Builder {
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
            if (generate_source_map == .lazy) break :brk try SourceMap.LineOffsetTable.generate(
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
) PrintResult.Error!usize {
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
        try getSourceMapBuilder(if (generate_source_map) .lazy else .disable, ascii_only, opts, source, &tree),
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
        try printer.print("var {require}=import.meta;");
    }

    for (tree.parts.slice()) |part| {
        for (part.stmts) |stmt| {
            try printer.printStmt(stmt);
            try printer.printSemicolonIfNeeded();
        }
    }

    if (comptime FeatureFlags.runtime_transpiler_cache and generate_source_map) {
        if (opts.source_map_handler) |handler| {
            var source_maps_chunk = try printer.source_map_builder.generateChunk(printer.writer.ctx.getWritten());
            if (opts.runtime_transpiler_cache) |cache| {
                cache.put(printer.writer.ctx.getWritten(), source_maps_chunk.buffer.list.items);
            }

            defer source_maps_chunk.deinit();

            try handler.onSourceMapChunk(source_maps_chunk, source);
        } else {
            if (opts.runtime_transpiler_cache) |cache| {
                cache.put(printer.writer.ctx.getWritten(), "");
            }
        }
    } else if (comptime generate_source_map) {
        if (opts.source_map_handler) |handler| {
            var chunk = try printer.source_map_builder.generateChunk(printer.writer.ctx.getWritten());
            defer chunk.deinit();
            try handler.onSourceMapChunk(chunk, source);
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
) PrintResult.Error!usize {
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

    try printer.printExpr(expr, Level.lowest, ExprFlag.Set{});
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

    const buffer_writer = BufferWriter.init(allocator);
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
        ) catch |err| {
            return .fail(err);
        },
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
) PrintResult.Error!PrintResult {
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
        try getSourceMapBuilder(if (generate_source_maps) .eager else .disable, is_bun_platform, opts, source, &ast),
    );
    printer.was_lazy_export = ast.has_lazy_export;
    var bin_stack_heap = std.heap.stackFallback(1024, bun.default_allocator);
    printer.binary_expression_stack = std.ArrayList(PrinterType.BinaryExpressionVisitor).init(bin_stack_heap.get());
    defer printer.binary_expression_stack.clearAndFree();

    defer printer.temporary_bindings.deinit(bun.default_allocator);
    defer writer.* = printer.writer.*;

    // In bundle_v2, this is backed by an arena, but incremental uses
    // `dev.allocator` for this buffer, so it must be freed.
    errdefer printer.source_map_builder.source_map.ctx.data.deinit();

    if (opts.module_type == .internal_bake_dev and !source.index.isRuntime()) {
        try printer.printDevServerModule(source, &ast, &parts[0]);
    } else {
        // The IIFE wrapper is done in `postProcessJSChunk`, so we just manually
        // trigger an indent.
        if (opts.module_type == .iife) {
            printer.indent();
        }

        for (parts) |part| {
            for (part.stmts) |stmt| {
                try printer.printStmt(stmt);
                try printer.printSemicolonIfNeeded();
            }
        }
    }

    try printer.writer.done();

    const written = printer.writer.ctx.getWritten();
    const source_map: ?SourceMap.Chunk = if (generate_source_maps) brk: {
        if (written.len == 0 or printer.source_map_builder.source_map.shouldIgnore()) {
            printer.source_map_builder.source_map.ctx.data.deinit();
            break :brk null;
        }
        const chunk = try printer.source_map_builder.generateChunk(written);
        assert(!chunk.should_ignore);
        break :brk chunk;
    } else null;

    var buffer = printer.writer.takeBuffer();

    return .{
        .result = .{
            .code = try buffer.toOwnedSlice(),
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
        try getSourceMapBuilder(if (generate_source_map) .lazy else .disable, false, opts, source, &tree),
    );
    var bin_stack_heap = std.heap.stackFallback(1024, bun.default_allocator);
    printer.binary_expression_stack = std.ArrayList(PrinterType.BinaryExpressionVisitor).init(bin_stack_heap.get());
    defer printer.binary_expression_stack.clearAndFree();

    for (tree.parts.slice()) |part| {
        for (part.stmts) |stmt| {
            try printer.printStmt(stmt);
            try printer.printSemicolonIfNeeded();
        }
    }

    // Add a couple extra newlines at the end
    try printer.writer.print(@TypeOf("\n\n"), "\n\n");

    if (comptime generate_source_map) {
        if (opts.source_map_handler) |handler| {
            var chunk = try printer.source_map_builder.generateChunk(printer.writer.ctx.getWritten());
            defer chunk.deinit();
            try handler.onSourceMapChunk(chunk, source);
        }
    }

    try printer.writer.done();

    return @as(usize, @intCast(@max(printer.writer.written, 0)));
}

const string = []const u8;

const SourceMap = @import("./sourcemap/sourcemap.zig");
const fs = @import("./fs.zig");
const importRecord = @import("./import_record.zig");
const options = @import("./options.zig");
const rename = @import("./renamer.zig");
const runtime = @import("./runtime.zig");
const std = @import("std");

const bun = @import("bun");
const Environment = bun.Environment;
const FeatureFlags = bun.FeatureFlags;
const FileDescriptorType = bun.FileDescriptor;
const ImportRecord = bun.ImportRecord;
const MutableString = bun.MutableString;
const Output = bun.Output;
const StoredFileDescriptorType = bun.StoredFileDescriptorType;
const assert = bun.assert;
const js_lexer = bun.js_lexer;
const logger = bun.logger;
const api = bun.schema.api;
const OOM = bun.OOM;
const StackOverflow = bun.StackOverflow;

const js_ast = bun.ast;
const Ast = js_ast.Ast;
const B = js_ast.B;
const Binding = js_ast.Binding;
const E = js_ast.E;
const Expr = js_ast.Expr;
const G = js_ast.G;
const Ref = bun.ast.Ref;
const S = js_ast.S;
const Stmt = js_ast.Stmt;
const Symbol = js_ast.Symbol;

const Op = js_ast.Op;
const Level = js_ast.Op.Level;

const strings = bun.strings;
const CodepointIterator = bun.strings.UnsignedCodepointIterator;
