const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const logger = bun.logger;
const Log = logger.Log;

pub const css = @import("./css_parser.zig");
pub const css_values = @import("./values/values.zig");
const DashedIdent = css_values.ident.DashedIdent;
const Ident = css_values.ident.Ident;
pub const Error = css.Error;
const Location = css.Location;
const PrintErr = css.PrintErr;

const ArrayList = std.ArrayListUnmanaged;

const sourcemap = @import("./sourcemap.zig");

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
    targets: Targets = .{},
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

/// Target browsers and features to compile.
pub const Targets = struct {
    /// Browser targets to compile the CSS for.
    browsers: ?Browsers = null,
    /// Features that should always be compiled, even when supported by targets.
    include: Features = 0,
    /// Features that should never be compiled, even when unsupported by targets.
    exclude: Features = 0,

    pub fn shouldCompile(this: *const Targets, feature: css.compat.Feature, flag: Features) bool {
        _ = this; // autofix
        _ = feature; // autofix
        _ = flag; // autofix
        @compileError(css.todo_stuff.depth);
    }

    pub fn isCompatible(this: *const Targets, feature: css.compat.Feature) bool {
        _ = this; // autofix
        _ = feature; // autofix
        @compileError(css.todo_stuff.depth);
    }
};

pub const Features = packed struct(u32) {
    pub usingnamespace css.Bitflags(@This());
    comptime {
        @compileError(css.todo_stuff.depth);
    }
};

/// Browser versions to compile CSS for.
///
/// Versions are represented as a single 24-bit integer, with one byte
/// per `major.minor.patch` component.
///
/// # Example
///
/// This example represents a target of Safari 13.2.0.
///
/// ```
/// const Browsers = struct {
///   safari: ?u32 = (13 << 16) | (2 << 8),
///   ..Browsers{}
/// };
/// ```
const Browsers = struct {
    android: ?u32 = null,
    chrome: ?u32 = null,
    edge: ?u32 = null,
    firefox: ?u32 = null,
    ie: ?u32 = null,
    ios_saf: ?u32 = null,
    opera: ?u32 = null,
    safari: ?u32 = null,
    samsung: ?u32 = null,
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
pub fn Printer(comptime Writer: type) type {
    return struct {
        // #[cfg(feature = "sourcemap")]
        sources: ?*ArrayList([]const u8),
        dest: Writer,
        loc: Location,
        indent_amt: u8,
        line: u32 = 0,
        col: u32 = 0,
        minify: bool,
        targets: Targets,
        vendor_prefix: css.VendorPrefix,
        css_module: ?css.CssModule,
        dependencies: ?ArrayList(css.Dependency),
        remove_imports: bool,
        pseudo_classes: ?PseudoClasses,
        indentation_buf: std.ArrayList(u8),
        ctx: ?*const css.StyleContext,
        // TODO: finish the fields

        const This = @This();

        /// Returns the current source filename that is being printed.
        pub fn filename(this: *const This) []const u8 {
            if (this.sources) |sources| {
                if (this.loc.source_index < sources.items.len) return sources.items[this.loc.source_index];
            }
            return "unknown.css";
        }

        /// Returns whether the indent level is greater than one.
        pub fn isNested(this: *const This) bool {
            return this.ident > 2;
        }

        /// Returns an error of the given kind at the provided location in the current source file.
        pub fn newError(
            this: *const This,
            kind: css.PrinterErrorKind,
            loc: css.dependencies.Location,
        ) css.Err(css.PrinterErrorKind) {
            _ = this; // autofix
            _ = kind; // autofix
            _ = loc; // autofix
            @compileError(css.todo_stuff.errors);
        }

        pub fn deinit(this: *This) void {
            _ = this; // autofix
            @compileError(css.todo_stuff.depth);
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

        fn writeIndent(this: *This) !void {
            bun.debugAssert(!this.minify);
            if (this.ident > 0) {
                // try this.writeStr(this.getIndent(this.ident));
                try this.dest.writeByteNTimes(' ', this.ident);
            }
        }

        pub fn new(allocator: Allocator, dest: Writer, options: PrinterOptions) This {
            return .{
                .sources = null,
                .dest = dest,
                .minify = options.minify,
                .targets = options.targets,
                .dependencies = if (options.analyze_dependencies != null) ArrayList(css.Dependency){} else null,
                .remove_imports = options.analyze_dependencies != null and options.analyze_dependencies.?.remove_imports,
                .pseudo_classes = options.pseudo_classes,
                .indentation_buf = std.ArrayList(u8).init(allocator),
            };
        }

        pub fn context(this: *const Printer) ?*const css.StyleContext {
            return this.ctx;
        }

        /// Writes a raw string to the underlying destination.
        ///
        /// NOTE: Is is assumed that the string does not contain any newline characters.
        /// If such a string is written, it will break source maps.
        pub fn writeStr(this: *This, s: []const u8) void {
            this.col += s.len;
            this.dest.writeAll(s) catch bun.outOfMemory();
        }

        pub fn writeFmt(this: *This, comptime fmt: []const u8, args: anytype) void {
            _ = this; // autofix
            _ = fmt; // autofix
            _ = args; // autofix
            @compileError(css.todo_stuff.depth);
        }

        /// Writes a CSS identifier to the underlying destination, escaping it
        /// as appropriate. If the `css_modules` option was enabled, then a hash
        /// is added, and the mapping is added to the CSS module.
        pub fn writeIdent(this: *This, ident: []const u8, handle_css_module: bool) !void {
            _ = this; // autofix
            _ = ident; // autofix
            _ = handle_css_module; // autofix
            @compileError(css.todo_stuff.depth);
        }

        pub fn writeDashedIdent(this: *This, ident: []const u8, is_declaration: bool) !void {
            try this.writeStr("--");

            if (this.css_module) |*css_module| {
                if (css_module.config.dashed_idents) {
                    const Fn = struct {
                        pub fn writeFn(self: *This, s: []const u8) PrintErr!void {
                            self.col += s.len;
                            return css.serializer.serializeName(s, Writer, self);
                        }
                    };
                    try css_module.config.pattern.write(
                        css_module.hashes.items[this.loc.source_index],
                        css_module.sources.items[this.loc.source_index],
                        ident[2..],
                        this,
                        Fn.writeFn,
                    );

                    if (is_declaration) {
                        css_module.addDashed(ident, this.loc.source_index);
                    }
                }
            }

            return try css.serializer.serializeName(ident[2..], Writer, this);
        }

        /// Write a single character to the underlying destination.
        pub fn writeChar(this: *This, char: u8) void {
            if (char == '\n') {
                this.line += 1;
                this.col = 0;
            } else {
                this.col += 1;
            }
            try this.dest.writeByte(char);
            // var p: [4]u8 = undefined;
            // const len = bun.strings.encodeWTF8RuneT(&p, u32, char);
            // try this.dest.writeAll(p[0..len]) catch bun.outOfMemory();
        }

        /// Writes a newline character followed by indentation.
        /// If the `minify` option is enabled, then nothing is printed.
        pub fn newline(this: *This) !void {
            if (this.minify) {
                return;
            }

            try this.writeChar('\n');
            try this.writeIndent();
        }

        /// Writes a delimiter character, followed by whitespace (depending on the `minify` option).
        /// If `ws_before` is true, then whitespace is also written before the delimiter.
        pub fn delim(this: *This, delim_: u8, ws_before: bool) !void {
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
        pub fn whitespace(this: *This) !void {
            if (this.minify) return;
            return try this.writeChar(' ');
        }

        pub fn withContext(
            this: *This,
            selectors: *css.SelectorList,
            comptime func: anytype,
            args: anytype,
        ) bun.meta.ReturnOfType(@TypeOf(func)) {
            _ = this; // autofix
            _ = selectors; // autofix
            _ = args; // autofix
            @compileError(css.todo_stuff.depth);
        }

        pub fn withClearedContext(
            this: *This,
            comptime func: anytype,
            args: anytype,
        ) bun.meta.ReturnOfType(@TypeOf(func)) {
            _ = this; // autofix
            _ = args; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };
}
