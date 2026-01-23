pub const css = @import("./css_parser.zig");
pub const css_values = @import("./values/values.zig");
const DashedIdent = css_values.ident.DashedIdent;
pub const Error = css.Error;
const Location = css.Location;
const PrintErr = css.PrintErr;

/// Options that control how CSS is serialized to a string.
pub const PrinterOptions = struct {
    /// Whether to minify the CSS, i.e. remove white space.
    minify: bool = false,
    /// An optional reference to a source map to write mappings into.
    /// (Available when the `sourcemap` feature is enabled.)
    source_map: ?*sourcemap.SourceMap = null,
    /// An optional project root path, used to generate relative paths for sources used in CSS module hashes.
    project_root: ?[]const u8 = null,
    /// Targets to output the CSS for.
    targets: Targets,
    /// Whether to analyze dependencies (i.e. `@import` and `url()`).
    /// If true, the dependencies are returned as part of the
    /// [ToCssResult](super::stylesheet::ToCssResult).
    ///
    /// When enabled, `@import` and `url()` dependencies
    /// are replaced with hashed placeholders that can be replaced with the final
    /// urls later (after bundling).
    analyze_dependencies: ?css.dependencies.DependencyOptions = null,
    /// A mapping of pseudo classes to replace with class names that can be applied
    /// from JavaScript. Useful for polyfills, for example.
    pseudo_classes: ?PseudoClasses = null,
    public_path: []const u8 = "",

    pub fn default() PrinterOptions {
        return .{
            .targets = Targets{
                .browsers = null,
            },
        };
    }

    pub fn defaultWithMinify(minify: bool) PrinterOptions {
        return .{
            .targets = Targets{
                .browsers = null,
            },
            .minify = minify,
        };
    }
};

/// A mapping of user action pseudo classes to replace with class names.
///
/// See [PrinterOptions](PrinterOptions).
const PseudoClasses = struct {
    /// The class name to replace `:hover` with.
    hover: ?[]const u8 = null,
    /// The class name to replace `:active` with.
    active: ?[]const u8 = null,
    /// The class name to replace `:focus` with.
    focus: ?[]const u8 = null,
    /// The class name to replace `:focus-visible` with.
    focus_visible: ?[]const u8 = null,
    /// The class name to replace `:focus-within` with.
    focus_within: ?[]const u8 = null,
};

pub const Targets = css.targets.Targets;

pub const Features = css.targets.Features;

pub const ImportInfo = struct {
    import_records: *const bun.BabyList(bun.ImportRecord),
    /// bundle_v2.graph.ast.items(.url_for_css)
    ast_urls_for_css: []const []const u8,
    /// bundle_v2.graph.input_files.items(.unique_key_for_additional_file)
    ast_unique_key_for_additional_file: []const []const u8,

    /// Only safe to use when outside the bundler. As in, the import records
    /// were not resolved to source indices. This will out-of-bounds otherwise.
    pub fn initOutsideOfBundler(records: *bun.BabyList(bun.ImportRecord)) ImportInfo {
        return .{
            .import_records = records,
            .ast_urls_for_css = &.{},
            .ast_unique_key_for_additional_file = &.{},
        };
    }
};

/// A `Printer` represents a destination to output serialized CSS, as used in
/// the [ToCss](super::traits::ToCss) trait. It can wrap any destination that
/// implements [std::fmt::Write](std::fmt::Write), such as a [String](String).
///
/// A `Printer` keeps track of the current line and column position, and uses
/// this to generate a source map if provided in the options.
///
/// `Printer` also includes helper functions that assist with writing output
/// that respects options such as `minify`, and `css_modules`.
pub const Printer = struct {
    // #[cfg(feature = "sourcemap")]
    sources: ?*const ArrayList([]const u8),
    dest: *std.Io.Writer,
    loc: Location = Location{
        .source_index = 0,
        .line = 0,
        .column = 1,
    },
    indent_amt: u8 = 0,
    line: u32 = 0,
    col: u32 = 0,
    minify: bool,
    targets: Targets,
    vendor_prefix: css.VendorPrefix = .{},
    in_calc: bool = false,
    css_module: ?css.CssModule = null,
    dependencies: ?ArrayList(css.Dependency) = null,
    remove_imports: bool,
    /// A mapping of pseudo classes to replace with class names that can be applied
    /// from JavaScript. Useful for polyfills, for example.
    pseudo_classes: ?PseudoClasses = null,
    indentation_buf: std.array_list.Managed(u8),
    ctx: ?*const css.StyleContext = null,
    scratchbuf: std.array_list.Managed(u8),
    error_kind: ?css.PrinterError = null,
    import_info: ?ImportInfo = null,
    public_path: []const u8,
    symbols: *const bun.ast.Symbol.Map,
    local_names: ?*const css.LocalsResultsMap = null,
    /// NOTE This should be the same mimalloc heap arena allocator
    allocator: Allocator,
    // TODO: finish the fields

    pub threadlocal var in_debug_fmt: if (bun.Environment.isDebug) bool else u0 = if (bun.Environment.isDebug) false else 0;

    const This = @This();

    pub fn lookupSymbol(this: *This, ref: bun.bundle_v2.Ref) []const u8 {
        const symbols = this.symbols;

        const final_ref = symbols.follow(ref);
        if (this.local_names) |local_names| {
            if (local_names.get(final_ref)) |local_name| return local_name;
        }

        const original_name = symbols.get(final_ref).?.original_name;
        return original_name;
    }

    pub fn lookupIdentOrRef(this: *This, ident: css.css_values.ident.IdentOrRef) []const u8 {
        if (comptime bun.Environment.isDebug) {
            if (in_debug_fmt) {
                return ident.debugIdent();
            }
        }
        if (ident.isIdent()) {
            return ident.asIdent().?.v;
        }
        return this.lookupSymbol(ident.asRef().?);
    }

    inline fn getWrittenAmt(writer: *std.Io.Writer) usize {
        if (writer.vtable == std.Io.Writer.Allocating.init(undefined).writer.vtable) {
            return @as(*std.Io.Writer.Allocating, @fieldParentPtr("writer", writer)).written().len;
        } else {
            @panic("css: got bad writer type");
        }
    }

    /// Returns the current source filename that is being printed.
    pub fn filename(this: *const This) []const u8 {
        if (this.sources) |sources| {
            if (this.loc.source_index < sources.items.len) return sources.items[this.loc.source_index];
        }
        return "unknown.css";
    }

    /// Returns whether the indent level is greater than one.
    pub fn isNested(this: *const This) bool {
        return this.indent_amt > 2;
    }

    /// Add an error related to std lib fmt errors
    pub fn addFmtError(this: *This) PrintErr {
        this.error_kind = css.PrinterError{
            .kind = .fmt_error,
            .loc = null,
        };
        return PrintErr.CSSPrintError;
    }

    pub fn addNoImportRecordError(this: *This) PrintErr {
        this.error_kind = css.PrinterError{
            .kind = .no_import_records,
            .loc = null,
        };
        return PrintErr.CSSPrintError;
    }

    pub fn addInvalidCssModulesPatternInGridError(this: *This) PrintErr {
        this.error_kind = css.PrinterError{
            .kind = .invalid_css_modules_pattern_in_grid,
            .loc = css.ErrorLocation{
                .filename = this.filename(),
                .line = this.loc.line,
                .column = this.loc.column,
            },
        };
        return PrintErr.CSSPrintError;
    }

    /// Returns an error of the given kind at the provided location in the current source file.
    pub fn newError(
        this: *This,
        kind: css.PrinterErrorKind,
        maybe_loc: ?css.dependencies.Location,
    ) PrintErr!void {
        bun.debugAssert(this.error_kind == null);
        this.error_kind = css.PrinterError{
            .kind = kind,
            .loc = if (maybe_loc) |loc| css.ErrorLocation{
                .filename = this.filename(),
                .line = loc.line - 1,
                .column = loc.column,
            } else null,
        };
        return PrintErr.CSSPrintError;
    }

    pub fn deinit(this: *This) void {
        this.scratchbuf.deinit();
        this.indentation_buf.deinit();
        if (this.dependencies) |*dependencies| {
            dependencies.deinit(this.allocator);
        }
    }

    /// If `import_records` is null, then the printer will error when it encounters code that relies on import records (urls())
    pub fn new(
        allocator: Allocator,
        scratchbuf: std.array_list.Managed(u8),
        dest: *std.Io.Writer,
        options: PrinterOptions,
        import_info: ?ImportInfo,
        local_names: ?*const css.LocalsResultsMap,
        symbols: *const bun.ast.Symbol.Map,
    ) This {
        return .{
            .sources = null,
            .dest = dest,
            .minify = options.minify,
            .targets = options.targets,
            .dependencies = if (options.analyze_dependencies != null) .empty else null,
            .remove_imports = options.analyze_dependencies != null and options.analyze_dependencies.?.remove_imports,
            .pseudo_classes = options.pseudo_classes,
            .indentation_buf = .init(allocator),
            .import_info = import_info,
            .scratchbuf = scratchbuf,
            .allocator = allocator,
            .public_path = options.public_path,
            .local_names = local_names,
            .loc = .{
                .source_index = 0,
                .line = 0,
                .column = 1,
            },
            .symbols = symbols,
        };
    }

    pub inline fn getImportRecords(this: *This) PrintErr!*const bun.BabyList(bun.ImportRecord) {
        if (this.import_info) |info| return info.import_records;
        return this.addNoImportRecordError();
    }

    pub fn printImportRecord(this: *This, import_record_idx: u32) PrintErr!void {
        if (this.import_info) |info| {
            const import_record = info.import_records.at(import_record_idx);
            const a, const b = bun.bundle_v2.cheapPrefixNormalizer(this.public_path, import_record.path.text);
            try this.writeStr(a);
            try this.writeStr(b);
            return;
        }
        return this.addNoImportRecordError();
    }

    pub inline fn importRecord(this: *Printer, import_record_idx: u32) PrintErr!*const bun.ImportRecord {
        if (this.import_info) |info| return info.import_records.at(import_record_idx);
        return this.addNoImportRecordError();
    }

    pub inline fn getImportRecordUrl(this: *This, import_record_idx: u32) PrintErr![]const u8 {
        const import_info = this.import_info orelse return this.addNoImportRecordError();
        const record = import_info.import_records.at(import_record_idx);
        if (record.source_index.isValid()) {
            // It has an inlined url for CSS
            const urls_for_css = import_info.ast_urls_for_css[record.source_index.get()];
            if (urls_for_css.len > 0) {
                return urls_for_css;
            }
            // It is a chunk URL
            const unique_key_for_additional_file = import_info.ast_unique_key_for_additional_file[record.source_index.get()];
            if (unique_key_for_additional_file.len > 0) {
                return unique_key_for_additional_file;
            }
        }
        // External URL stays as-is
        return record.path.text;
    }

    pub fn context(this: *const Printer) ?*const css.StyleContext {
        return this.ctx;
    }

    /// To satisfy io.Writer interface
    ///
    /// NOTE: Same constraints as `writeStr`, the `str` param is assumted to not
    /// contain any newline characters
    pub fn writeAll(this: *This, str: []const u8) !void {
        return this.writeStr(str) catch std.mem.Allocator.Error.OutOfMemory;
    }

    pub fn writeComment(this: *This, comment: []const u8) PrintErr!void {
        _ = this.dest.writeAll(comment) catch {
            return this.addFmtError();
        };
        const new_lines = std.mem.count(u8, comment, "\n");
        this.line += @intCast(new_lines);
        this.col = 0;
        const last_line_start = comment.len - (std.mem.lastIndexOfScalar(u8, comment, '\n') orelse comment.len);
        this.col += @intCast(last_line_start);
        return;
    }

    /// Writes a raw string to the underlying destination.
    ///
    /// NOTE: Is is assumed that the string does not contain any newline characters.
    /// If such a string is written, it will break source maps.
    pub fn writeStr(this: *This, s: []const u8) PrintErr!void {
        if (comptime bun.Environment.isDebug) {
            bun.assert(std.mem.indexOfScalar(u8, s, '\n') == null);
        }
        this.col += @intCast(s.len);
        _ = this.dest.writeAll(s) catch {
            return this.addFmtError();
        };
        return;
    }

    /// Writes a formatted string to the underlying destination.
    ///
    /// NOTE: Is is assumed that the formatted string does not contain any newline characters.
    /// If such a string is written, it will break source maps.
    pub fn writeFmt(this: *This, comptime fmt: []const u8, args: anytype) PrintErr!void {
        // assuming the writer comes from an ArrayList
        const start: usize = getWrittenAmt(this.dest);
        this.dest.print(fmt, args) catch return this.addFmtError();
        const written = getWrittenAmt(this.dest) - start;
        this.col += @intCast(written);
    }

    fn replaceDots(allocator: Allocator, s: []const u8) []const u8 {
        var str = bun.handleOom(allocator.dupe(u8, s));
        std.mem.replaceScalar(u8, str[0..], '.', '-');
        return str;
    }

    pub fn writeIdentOrRef(this: *This, ident: css.css_values.ident.IdentOrRef, handle_css_module: bool) PrintErr!void {
        if (!handle_css_module) {
            if (ident.asIdent()) |identifier| {
                return css.serializer.serializeIdentifier(identifier.v, this) catch return this.addFmtError();
            } else {
                const ref = ident.asRef().?;
                const symbol = this.symbols.get(ref) orelse return this.addFmtError();
                return css.serializer.serializeIdentifier(symbol.original_name, this) catch return this.addFmtError();
            }
        }

        const str = this.lookupIdentOrRef(ident);
        return css.serializer.serializeIdentifier(str, this) catch return this.addFmtError();
    }

    /// Writes a CSS identifier to the underlying destination, escaping it
    /// as appropriate. If the `css_modules` option was enabled, then a hash
    /// is added, and the mapping is added to the CSS module.
    pub fn writeIdent(this: *This, ident: []const u8, handle_css_module: bool) PrintErr!void {
        if (handle_css_module) {
            if (this.css_module) |*css_module| {
                const Closure = struct { first: bool, printer: *This };
                var closure = Closure{ .first = true, .printer = this };
                css_module.config.pattern.write(
                    css_module.hashes.items[this.loc.source_index],
                    css_module.sources.items[this.loc.source_index],
                    ident,
                    &closure,
                    struct {
                        pub fn writeFn(self: *Closure, s1: []const u8, replace_dots: bool) void {
                            // PERF: stack fallback?
                            const s = if (!replace_dots) s1 else replaceDots(self.printer.allocator, s1);
                            defer if (replace_dots) self.printer.allocator.free(s);
                            self.printer.col += @intCast(s.len);
                            if (self.first) {
                                self.first = false;
                                return css.serializer.serializeIdentifier(s, self.printer) catch |e| css.OOM(e);
                            } else {
                                return css.serializer.serializeName(s, self.printer) catch |e| css.OOM(e);
                            }
                        }
                    }.writeFn,
                );

                css_module.addLocal(this.allocator, ident, ident, this.loc.source_index);
                return;
            }
        }

        return css.serializer.serializeIdentifier(ident, this) catch return this.addFmtError();
    }

    pub fn writeDashedIdent(this: *This, ident: *const DashedIdent, is_declaration: bool) !void {
        try this.writeStr("--");

        if (this.css_module) |*css_module| {
            if (css_module.config.dashed_idents) {
                const Fn = struct {
                    pub fn writeFn(self: *This, s1: []const u8, replace_dots: bool) void {
                        const s = if (!replace_dots) s1 else replaceDots(self.allocator, s1);
                        defer if (replace_dots) self.allocator.free(s);
                        self.col += @intCast(s.len);
                        return css.serializer.serializeName(s, self) catch |e| css.OOM(e);
                    }
                };
                css_module.config.pattern.write(
                    css_module.hashes.items[this.loc.source_index],
                    css_module.sources.items[this.loc.source_index],
                    ident.v[2..],
                    this,
                    Fn.writeFn,
                );

                if (is_declaration) {
                    css_module.addDashed(this.allocator, ident.v, this.loc.source_index);
                }
            }
        }

        return css.serializer.serializeName(ident.v[2..], this) catch return this.addFmtError();
    }

    pub fn writeByte(this: *This, char: u8) !void {
        return this.writeChar(char) catch return Allocator.Error.OutOfMemory;
    }

    /// Write a single character to the underlying destination.
    pub fn writeChar(this: *This, char: u8) PrintErr!void {
        if (char == '\n') {
            this.line += 1;
            this.col = 0;
        } else {
            this.col += 1;
        }
        _ = this.dest.writeByte(char) catch {
            return this.addFmtError();
        };
    }

    /// Writes a newline character followed by indentation.
    /// If the `minify` option is enabled, then nothing is printed.
    pub fn newline(this: *This) PrintErr!void {
        if (this.minify) {
            return;
        }

        try this.writeChar('\n');
        return this.writeIndent();
    }

    /// Writes a delimiter character, followed by whitespace (depending on the `minify` option).
    /// If `ws_before` is true, then whitespace is also written before the delimiter.
    pub fn delim(this: *This, delim_: u8, ws_before: bool) PrintErr!void {
        if (ws_before) {
            try this.whitespace();
        }
        try this.writeChar(delim_);
        return this.whitespace();
    }

    /// Writes a single whitespace character, unless the `minify` option is enabled.
    ///
    /// Use `write_char` instead if you wish to force a space character to be written,
    /// regardless of the `minify` option.
    pub fn whitespace(this: *This) PrintErr!void {
        if (this.minify) return;
        return this.writeChar(' ');
    }

    pub fn withContext(
        this: *This,
        selectors: *const css.SelectorList,
        closure: anytype,
        comptime func: anytype,
    ) PrintErr!void {
        const parent = if (this.ctx) |ctx| parent: {
            this.ctx = null;
            break :parent ctx;
        } else null;

        const ctx = css.StyleContext{ .selectors = selectors, .parent = parent };

        this.ctx = &ctx;
        const res = func(closure, this);
        this.ctx = parent;

        return res;
    }

    pub fn withClearedContext(
        this: *This,
        closure: anytype,
        comptime func: anytype,
    ) PrintErr!void {
        const parent = if (this.ctx) |ctx| parent: {
            this.ctx = null;
            break :parent ctx;
        } else null;
        const res = func(closure, this);
        this.ctx = parent;
        return res;
    }

    /// Increases the current indent level.
    pub fn indent(this: *This) void {
        this.indent_amt += 2;
    }

    /// Decreases the current indent level.
    pub fn dedent(this: *This) void {
        this.indent_amt -= 2;
    }

    const INDENTS: []const []const u8 = indents: {
        const levels = 32;
        var indents: [levels][]const u8 = undefined;
        for (0..levels) |i| {
            const n = i * 2;
            var str: [n]u8 = undefined;
            for (0..n) |j| {
                str[j] = ' ';
            }
            indents[i] = str;
        }
        break :indents indents;
    };

    fn getIndent(this: *This, idnt: u8) []const u8 {
        // divide by 2 to get index into table
        const i = idnt >> 1;
        // PERF: may be faster to just do `i < (IDENTS.len - 1) * 2` (e.g. 62 if IDENTS.len == 32) here
        if (i < INDENTS.len) {
            return INDENTS[i];
        }
        if (this.indentation_buf.items.len < idnt) {
            this.indentation_buf.appendNTimes(' ', this.indentation_buf.items.len - idnt) catch unreachable;
        } else {
            this.indentation_buf.items = this.indentation_buf.items[0..idnt];
        }
        return this.indentation_buf.items;
    }

    fn writeIndent(this: *This) PrintErr!void {
        bun.debugAssert(!this.minify);
        if (this.indent_amt > 0) {
            // try this.writeStr(this.getIndent(this.ident));
            this.dest.splatByteAll(' ', this.indent_amt) catch return this.addFmtError();
        }
    }
};

const bun = @import("bun");
const sourcemap = @import("./sourcemap.zig");

const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;
const Allocator = std.mem.Allocator;
