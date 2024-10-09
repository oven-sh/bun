const std = @import("std");
pub const css = @import("../css_parser.zig");
const bun = @import("root").bun;

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
                .supports => |x| x.toCss(W, dest),
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
                .custom => |x| x.toCss(W, dest) catch return dest.addFmtError(),
                .ignored => {},
            };
        }
    };
}

pub fn CssRuleList(comptime AtRule: type) type {
    return struct {
        v: ArrayList(CssRule(AtRule)) = .{},

        const This = @This();

        pub fn minify(this: *This, context: *MinifyContext, parent_is_unused: bool) Maybe(void, css.MinifyError) {
            var keyframe_rules: keyframes.KeyframesName.HashMap(usize) = .{};
            const layer_rules: layer.LayerName.HashMap(usize) = .{};
            _ = layer_rules; // autofix
            const property_rules: css.css_values.ident.DashedIdent.HashMap(usize) = .{};
            _ = property_rules; // autofix
            // const style_rules = void;
            // _ = style_rules; // autofix
            var rules = ArrayList(CssRule(AtRule)){};

            for (this.v.items) |*rule| {
                // NOTE Anytime you append to `rules` with this `rule`, you must set `moved_rule` to true.
                var moved_rule = false;
                defer if (moved_rule) {
                    rule.* = .ignored;
                };

                switch (rule.*) {
                    .keyframes => |*keyframez| {
                        if (context.unused_symbols.contains(switch (keyframez.name) {
                            .ident => |ident| ident,
                            .custom => |custom| custom,
                        })) {
                            continue;
                        }

                        keyframez.minify(context);

                        // Merge @keyframes rules with the same name.
                        if (keyframe_rules.get(keyframez.name)) |existing_idx| {
                            if (existing_idx < rules.items.len and rules.items[existing_idx] == .keyframes) {
                                var existing = &rules.items[existing_idx].keyframes;
                                // If the existing rule has the same vendor prefixes, replace it with this rule.
                                if (existing.vendor_prefix.eq(keyframez.vendor_prefix)) {
                                    existing.* = keyframez.clone(context.allocator);
                                    continue;
                                }
                                // Otherwise, if the keyframes are identical, merge the prefixes.
                                if (existing.keyframes == keyframez.keyframes) {
                                    existing.vendor_prefix |= keyframez.vendor_prefix;
                                    existing.vendor_prefix = context.targets.prefixes(existing.vendor_prefix, css.prefixes.Feature.at_keyframes);
                                    continue;
                                }
                            }
                        }

                        keyframez.vendor_prefix = context.targets.prefixes(keyframez.vendor_prefix, css.prefixes.Feature.at_keyframes);
                        keyframe_rules.put(context.allocator, keyframez.name, rules.items.len) catch bun.outOfMemory();

                        const fallbacks = keyframez.getFallbacks(AtRule, context.targets);
                        moved_rule = true;
                        rules.append(context.allocator, rule.*) catch bun.outOfMemory();
                        rules.appendSlice(context.allocator, fallbacks) catch bun.outOfMemory();
                        continue;
                    },
                    .custom_media => {
                        if (context.custom_media != null) {
                            continue;
                        }
                    },
                    .media => |*med| {
                        if (rules.items[rules.items.len - 1] == .media) {
                            var last_rule = &rules.items[rules.items.len - 1].media;
                            if (last_rule.query.eql(&med.query)) {
                                last_rule.rules.v.appendSlice(context.allocator, med.rules.v.items) catch bun.outOfMemory();
                                if (last_rule.minify(context, parent_is_unused).asErr()) |e| {
                                    return .{ .err = e };
                                }
                                continue;
                            }

                            switch (med.minify(context, parent_is_unused)) {
                                .result => continue,
                                .err => |e| return .{ .err = e },
                            }
                        }
                    },
                    .supports => |*supp| {
                        if (rules.items[rules.items.len - 1] == .supports) {
                            var last_rule = &rules.items[rules.items.len - 1].supports;
                            if (last_rule.condition.eql(&supp.condition)) {
                                continue;
                            }
                        }

                        if (supp.minify(context, parent_is_unused).asErr()) |e| return .{ .err = e };
                        if (supp.rules.v.items.len == 0) continue;
                    },
                    .container => |*cont| {
                        _ = cont; // autofix
                    },
                    .layer_block => |*lay| {
                        _ = lay; // autofix
                    },
                    .layer_statement => |*lay| {
                        _ = lay; // autofix
                    },
                    .moz_document => |*doc| {
                        _ = doc; // autofix
                    },
                    .style => |*sty| {
                        _ = sty; // autofix
                    },
                    .counter_style => |*cntr| {
                        _ = cntr; // autofix
                    },
                    .scope => |*scpe| {
                        _ = scpe; // autofix
                    },
                    .nesting => |*nst| {
                        _ = nst; // autofix
                    },
                    .starting_style => |*rl| {
                        _ = rl; // autofix
                    },
                    .font_palette_values => |*f| {
                        _ = f; // autofix
                    },
                    .property => |*prop| {
                        _ = prop; // autofix
                    },
                    else => {},
                }

                rules.append(context.allocator, rule.*) catch bun.outOfMemory();
            }

            // MISSING SHIT HERE

            css.deepDeinit(CssRule(AtRule), context.allocator, &this.v);
            this.v = rules;
            return .{ .result = {} };
        }

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            var first = true;
            var last_without_block = false;

            for (this.v.items) |*rule| {
                if (rule.* == .ignored) continue;

                // Skip @import rules if collecting dependencies.
                if (rule.* == .import) {
                    if (dest.remove_imports) {
                        const dep = if (dest.dependencies != null) Dependency{
                            .import = dependencies.ImportDependency.new(dest.allocator, &rule.import, dest.filename()),
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
                try rule.toCss(W, dest);
                last_without_block = rule.* == .import or rule.* == .namespace or rule.* == .layer_statement;
            }
        }
    };
}

pub const MinifyContext = struct {
    allocator: std.mem.Allocator,
    targets: *const css.targets.Targets,
    handler: *css.DeclarationHandler,
    important_handler: *css.DeclarationHandler,
    handler_context: css.PropertyHandlerContext,
    unused_symbols: *const std.StringArrayHashMapUnmanaged(void),
    custom_media: ?std.StringArrayHashMapUnmanaged(custom_media.CustomMediaRule),
    css_modules: bool,
};

pub const Location = struct {
    /// The index of the source file within the source map.
    source_index: u32,
    /// The line number, starting at 0.
    line: u32,
    /// The column number within a line, starting at 1 for first the character of the line.
    /// Column numbers are counted in UTF-16 code units.
    column: u32,

    pub fn dummy() Location {
        return .{
            .source_index = std.math.maxInt(u32),
            .line = std.math.maxInt(u32),
            .column = std.math.maxInt(u32),
        };
    }
};

pub const StyleContext = struct {
    selectors: *const css.SelectorList,
    parent: ?*const StyleContext,
};

/// A key to a StyleRule meant for use in a HashMap for quickly detecting duplicates.
/// It stores a reference to a list and an index so it can access items without cloning
/// even when the list is reallocated. A hash is also pre-computed for fast lookups.
pub fn StyleRuleKey(comptime R: type) type {
    return struct {
        list: *const ArrayList(CssRule(R)),
        index: usize,
        hash: u64,

        const This = @This();

        pub fn HashMap(comptime V: type) type {
            return std.ArrayHashMapUnmanaged(StyleRuleKey(R), V, struct {
                pub fn hash(_: @This(), key: This) u32 {
                    _ = key; // autofix
                    @panic("TODO");
                }

                pub fn eql(_: @This(), a: This, b: This, _: usize) bool {
                    return a.eql(&b);
                }
            });
        }

        pub fn eql(this: *const This, other: *const This) bool {
            const rule = if (this.index < this.list.items.len and this.list.items[this.index] == .style)
                &this.list.items[this.index].style
            else
                return false;

            const other_rule = if (other.index < other.list.items.len and other.list.items[other.index] == .style)
                &other.list.items[other.index].style
            else
                return false;

            return rule.isDuplicate(other_rule);
        }
    };
}
