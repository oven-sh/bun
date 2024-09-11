const std = @import("std");
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const ArrayList = std.ArrayListUnmanaged;
const MediaList = css.MediaList;
const CustomMedia = css.CustomMedia;
const Printer = css.Printer;
const Maybe = css.Maybe;
const PrinterError = css.PrinterError;
const PrintErr = css.PrintErr;
const Dependency = css.Dependency;
const dependencies = css.dependencies;
const Url = css.css_values.url.Url;
const Size2D = css.css_values.size.Size2D;
const fontprops = css.css_properties.font;

pub const import = @import("./import.zig");
pub const layer = @import("./layer.zig");
pub const style = @import("./style.zig");
pub const keyframes = @import("./keyframes.zig");
pub const font_face = @import("./font_face.zig");
pub const font_palette_values = @import("./font_palette_values.zig");
pub const page = @import("./page.zig");
pub const supports = @import("./supports.zig");
pub const counter_style = @import("./counter_style.zig");
pub const custom_media = @import("./custom_media.zig");
pub const namespace = @import("./namespace.zig");
pub const unknown = @import("./unknown.zig");
pub const document = @import("./document.zig");
pub const nesting = @import("./nesting.zig");
pub const viewport = @import("./viewport.zig");
pub const property = @import("./property.zig");
pub const container = @import("./container.zig");
pub const scope = @import("./scope.zig");
pub const media = @import("./media.zig");
pub const starting_style = @import("./starting_style.zig");

pub fn CssRule(comptime Rule: type) type {
    return union(enum) {
        /// A `@media` rule.
        media: media.MediaRule(Rule),
        /// An `@import` rule.
        import: import.ImportRule,
        /// A style rule.
        style: style.StyleRule(Rule),
        /// A `@keyframes` rule.
        keyframes: keyframes.KeyframesRule,
        /// A `@font-face` rule.
        font_face: font_face.FontFaceRule,
        /// A `@font-palette-values` rule.
        font_palette_values: font_palette_values.FontPaletteValuesRule,
        /// A `@page` rule.
        page: page.PageRule,
        /// A `@supports` rule.
        supports: supports.SupportsRule(Rule),
        /// A `@counter-style` rule.
        counter_style: counter_style.CounterStyleRule,
        /// A `@namespace` rule.
        namespace: namespace.NamespaceRule,
        /// A `@-moz-document` rule.
        moz_document: document.MozDocumentRule(Rule),
        /// A `@nest` rule.
        nesting: nesting.NestingRule(Rule),
        /// A `@viewport` rule.
        viewport: viewport.ViewportRule,
        /// A `@custom-media` rule.
        custom_media: CustomMedia,
        /// A `@layer` statement rule.
        layer_statement: layer.LayerStatementRule,
        /// A `@layer` block rule.
        layer_block: layer.LayerBlockRule(Rule),
        /// A `@property` rule.
        property: property.PropertyRule,
        /// A `@container` rule.
        container: container.ContainerRule(Rule),
        /// A `@scope` rule.
        scope: scope.ScopeRule(Rule),
        /// A `@starting-style` rule.
        starting_style: starting_style.StartingStyleRule(Rule),
        /// A placeholder for a rule that was removed.
        ignored,
        /// An unknown at-rule.
        unknown: unknown.UnknownAtRule,
        /// A custom at-rule.
        custom: Rule,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            return switch (this.*) {
                .media => |x| x.toCss(W, dest),
                .import => |x| x.toCss(W, dest),
                .style => |x| x.toCss(W, dest),
                .keyframes => |x| x.toCss(W, dest),
                .font_face => |x| x.toCss(W, dest),
                .font_palette_values => |x| x.toCss(W, dest),
                .page => |x| x.toCss(W, dest),
                .counter_style => |x| x.toCss(W, dest),
                .namespace => |x| x.toCss(W, dest),
                .moz_document => |x| x.toCss(W, dest),
                .nesting => |x| x.toCss(W, dest),
                .viewport => |x| x.toCss(W, dest),
                .custom_media => |x| x.toCss(W, dest),
                .layer_statement => |x| x.toCss(W, dest),
                .layer_block => |x| x.toCss(W, dest),
                .property => |x| x.toCss(W, dest),
                .starting_style => |x| x.toCss(W, dest),
                .container => |x| x.toCss(W, dest),
                .scope => |x| x.toCss(W, dest),
                .unknown => |x| x.toCss(W, dest),
                .custom => |x| x.toCss(W, dest) catch return PrinterError{
                    .kind = css.PrinterErrorKind.fmt_error,
                    .loc = null,
                },
                .ignored => {},
            };
        }
    };
}

pub fn CssRuleList(comptime AtRule: type) type {
    return struct {
        v: ArrayList(CssRule(AtRule)) = .{},

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) Maybe(void, PrinterError) {
            var first = true;
            var last_without_block = false;

            for (this.v.items) |*rule| {
                if (rule.* == .ignored) continue;

                // Skip @import rules if collecting dependencies.
                if (rule == .import) {
                    if (dest.remove_imports) {
                        const dep = if (dest.dependencies != null) Dependency{
                            .import = dependencies.ImportDependency.new(&rule.import, dest.filename()),
                        } else null;

                        if (dest.dependencies) |*deps| {
                            deps.append(dest.allocator, dep.?) catch unreachable;
                            continue;
                        }
                    }
                }

                if (first) {
                    first = false;
                } else {
                    if (!dest.minify and
                        !(last_without_block and
                        (rule.* == .import or rule.* == .namespace or rule.* == .layer_statement)))
                    {
                        try dest.writeChar('\n');
                    }
                    try dest.newline();
                }
                try rule.toCss(dest);
                last_without_block = rule.* == .import or rule.* == .namespace or rule.* == .layer_statement;
            }
        }
    };
}

pub const Location = struct {
    /// The index of the source file within the source map.
    source_index: u32,
    /// The line number, starting at 0.
    line: u32,
    /// The column number within a line, starting at 1 for first the character of the line.
    /// Column numbers are counted in UTF-16 code units.
    column: u32,
};

pub const StyleContext = struct {
    selectors: *const css.SelectorList,
    parent: ?*const StyleContext,
};
