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

const debug = bun.Output.scoped(.CSS_MINIFY, false);

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

        pub fn minify(this: *This, context: *MinifyContext, parent_is_unused: bool) css.MinifyErr!void {
            // var keyframe_rules: keyframes.KeyframesName.HashMap(usize) = .{};
            // _ = keyframe_rules; // autofix
            // const layer_rules: layer.LayerName.HashMap(usize) = .{};
            // _ = layer_rules; // autofix
            // const property_rules: css.css_values.ident.DashedIdent.HashMap(usize) = .{};
            // _ = property_rules; // autofix
            // const style_rules = void;
            // _ = style_rules; // autofix
            var rules = ArrayList(CssRule(AtRule)){};

            for (this.v.items) |*rule| {
                // NOTE Anytime you append to `rules` with this `rule`, you must set `moved_rule` to true.
                var moved_rule = false;
                defer if (moved_rule) {
                    // PERF calling deinit here might allow mimalloc to reuse the freed memory
                    rule.* = .ignored;
                };

                switch (rule.*) {
                    .keyframes => |*keyframez| {
                        _ = keyframez; // autofix
                        // if (context.unused_symbols.contains(switch (keyframez.name) {
                        //     .ident => |ident| ident.v,
                        //     .custom => |custom| custom,
                        // })) {
                        //     continue;
                        // }

                        // keyframez.minify(context);

                        // // Merge @keyframes rules with the same name.
                        // if (keyframe_rules.get(keyframez.name)) |existing_idx| {
                        //     if (existing_idx < rules.items.len and rules.items[existing_idx] == .keyframes) {
                        //         var existing = &rules.items[existing_idx].keyframes;
                        //         // If the existing rule has the same vendor prefixes, replace it with this rule.
                        //         if (existing.vendor_prefix.eq(keyframez.vendor_prefix)) {
                        //             existing.* = keyframez.clone(context.allocator);
                        //             continue;
                        //         }
                        //         // Otherwise, if the keyframes are identical, merge the prefixes.
                        //         if (existing.keyframes == keyframez.keyframes) {
                        //             existing.vendor_prefix |= keyframez.vendor_prefix;
                        //             existing.vendor_prefix = context.targets.prefixes(existing.vendor_prefix, css.prefixes.Feature.at_keyframes);
                        //             continue;
                        //         }
                        //     }
                        // }

                        // keyframez.vendor_prefix = context.targets.prefixes(keyframez.vendor_prefix, css.prefixes.Feature.at_keyframes);
                        // keyframe_rules.put(context.allocator, keyframez.name, rules.items.len) catch bun.outOfMemory();

                        // const fallbacks = keyframez.getFallbacks(AtRule, context.targets);
                        // moved_rule = true;
                        // rules.append(context.allocator, rule.*) catch bun.outOfMemory();
                        // rules.appendSlice(context.allocator, fallbacks) catch bun.outOfMemory();
                        // continue;
                        debug("TODO: KeyframesRule", .{});
                    },
                    .custom_media => {
                        if (context.custom_media != null) {
                            continue;
                        }
                    },
                    .media => |*med| {
                        moved_rule = false;
                        if (rules.items[rules.items.len - 1] == .media) {
                            var last_rule = &rules.items[rules.items.len - 1].media;
                            if (last_rule.query.eql(&med.query)) {
                                last_rule.rules.v.appendSlice(context.allocator, med.rules.v.items) catch bun.outOfMemory();
                                _ = try last_rule.minify(context, parent_is_unused);
                                continue;
                            }

                            if (try med.minify(context, parent_is_unused)) {
                                continue;
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

                        try supp.minify(context, parent_is_unused);
                        if (supp.rules.v.items.len == 0) continue;
                    },
                    .container => |*cont| {
                        _ = cont; // autofix
                        debug("TODO: ContainerRule", .{});
                    },
                    .layer_block => |*lay| {
                        _ = lay; // autofix
                        debug("TODO: LayerBlockRule", .{});
                    },
                    .layer_statement => |*lay| {
                        _ = lay; // autofix
                        debug("TODO: LayerStatementRule", .{});
                    },
                    .moz_document => |*doc| {
                        _ = doc; // autofix
                        debug("TODO: MozDocumentRule", .{});
                    },
                    .style => |*sty| {
                        const Selector = css.selector.Selector;
                        const SelectorList = css.selector.SelectorList;
                        const Component = css.selector.Component;
                        if (parent_is_unused or try sty.minify(context, parent_is_unused)) {
                            continue;
                        }

                        // If some of the selectors in this rule are not compatible with the targets,
                        // we need to either wrap in :is() or split them into multiple rules.
                        const incompatible: css.SmallList(css.selector.parser.Selector, 1) = if (sty.selectors.v.items.len > 1 and
                            context.targets.shouldCompileSelectors() and
                            !sty.isCompatible(context.targets.*))
                        incompatible: {
                            // The :is() selector accepts a forgiving selector list, so use that if possible.
                            // Note that :is() does not allow pseudo elements, so we need to check for that.
                            // In addition, :is() takes the highest specificity of its arguments, so if the selectors
                            // have different weights, we need to split them into separate rules as well.
                            if (context.targets.isCompatible(css.compat.Feature.is_selector) and !sty.selectors.anyHasPseudoElement() and sty.selectors.specifitiesAllEqual()) {
                                const component = Component{ .is = sty.selectors.v.items };
                                var list = css.SmallList(css.selector.parser.Selector, 1){};
                                list.append(context.allocator, Selector.fromComponent(context.allocator, component)) catch bun.outOfMemory();
                                sty.selectors = SelectorList{
                                    .v = list,
                                };
                                break :incompatible css.SmallList(Selector, 1){};
                            } else {
                                // Otherwise, partition the selectors and keep the compatible ones in this rule.
                                // We will generate additional rules for incompatible selectors later.
                                var incompatible = css.SmallList(Selector, 1){};
                                var i: usize = 0;
                                while (i < sty.selectors.v.items.len) {
                                    if (css.selector.isCompatible(sty.selectors.v.items[i .. i + 1], context.targets.*)) {
                                        i += 1;
                                    } else {
                                        // Move the selector to the incompatible list.
                                        incompatible.append(
                                            context.allocator,
                                            sty.selectors.v.orderedRemove(i),
                                        ) catch bun.outOfMemory();
                                    }
                                }
                                break :incompatible incompatible;
                            }
                        } else .{};
                        _ = incompatible; // autofix

                        sty.updatePrefix(context);

                        // Attempt to merge the new rule with the last rule we added.
                        // var merged = false;
                        // _ = merged; // autofix
                        // if (rules.items.len > 0 and rules.items[rules.items.len - 1] == .style) {
                        //     var last_style_rule = &rules.items[rules.items.len - 1].style;
                        //     if (mergeStyleRules(sty, last_style_rule, context)) {
                        //         // If that was successful, then the last rule has been updated to include the
                        //         // selectors/declarations of the new rule. This might mean that we can merge it
                        //         // with the previous rule, so continue trying while we have style rules available.
                        //     }
                        // }
                        @panic("TODO finish this my g");

                        // continue;
                    },
                    .counter_style => |*cntr| {
                        _ = cntr; // autofix
                        debug("TODO: CounterStyleRule", .{});
                    },
                    .scope => |*scpe| {
                        _ = scpe; // autofix
                        debug("TODO: ScopeRule", .{});
                    },
                    .nesting => |*nst| {
                        _ = nst; // autofix
                        debug("TODO: NestingRule", .{});
                    },
                    .starting_style => |*rl| {
                        _ = rl; // autofix
                        debug("TODO: StartingStyleRule", .{});
                    },
                    .font_palette_values => |*f| {
                        _ = f; // autofix
                        debug("TODO: FontPaletteValuesRule", .{});
                    },
                    .property => |*prop| {
                        _ = prop; // autofix
                        debug("TODO: PropertyRule", .{});
                    },
                    else => {},
                }

                rules.append(context.allocator, rule.*) catch bun.outOfMemory();
            }

            // MISSING SHIT HERE

            css.deepDeinit(CssRule(AtRule), context.allocator, &this.v);
            this.v = rules;
            return;
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
    /// NOTE: this should the same allocator the AST was allocated with
    allocator: std.mem.Allocator,
    targets: *const css.targets.Targets,
    handler: *css.DeclarationHandler,
    important_handler: *css.DeclarationHandler,
    handler_context: css.PropertyHandlerContext,
    unused_symbols: *const std.StringArrayHashMapUnmanaged(void),
    custom_media: ?std.StringArrayHashMapUnmanaged(custom_media.CustomMediaRule),
    css_modules: bool,
    err: ?css.MinifyError = null,
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

fn mergeStyleRules(
    comptime T: type,
    sty: *style.StyleRule(T),
    last_style_rule: *style.StyleRule(T),
    context: *MinifyContext,
) bool {
    // Merge declarations if the selectors are equivalent, and both are compatible with all targets.
    if (sty.selectors.eql(&last_style_rule.selectors) and
        sty.isCompatible(context.targets.*) and
        last_style_rule.isCompatible(context.targets.*) and
        sty.rules.v.items.len == 0 and
        (!context.css_modules or sty.loc.source_index == last_style_rule.loc.source_index))
    {
        last_style_rule.declarations.declarations.appendSlice(
            context.allocator,
            sty.declarations.declarations.items,
        ) catch bun.outOfMemory();
        sty.declarations.declarations.clearRetainingCapacity();

        last_style_rule.declarations.important_declarations.appendSlice(
            context.allocator,
            sty.declarations.important_declarations.items,
        ) catch bun.outOfMemory();
        sty.declarations.important_declarations.clearRetainingCapacity();

        last_style_rule.declarations.minify(
            context.handler,
            context.important_handler,
            &context.handler_context,
        );
        return true;
    } else if (sty.declarations.eql(&last_style_rule.declarations) and
        sty.rules.v.items.len == 0 and
        last_style_rule.rules.v.items.len == 0)
    {
        // If both selectors are potentially vendor prefixable, and they are
        // equivalent minus prefixes, add the prefix to the last rule.
        if (!sty.vendor_prefix.isEmpty() and
            !last_style_rule.vendor_prefix.isEmpty() and
            css.selector.isEquivalent(sty.selectors.v.items, &last_style_rule.selectors.v.items))
        {
            // If the new rule is unprefixed, replace the prefixes of the last rule.
            // Otherwise, add the new prefix.
        }
    }
    @panic("TODO finish this my g");
}
