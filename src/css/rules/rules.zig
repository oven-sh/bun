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

pub const tailwind = @import("./tailwind.zig");

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

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
            return css.implementDeepClone(@This(), this, allocator);
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
            var style_rules = StyleRuleKey(AtRule).HashMap(usize){};
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
                        if (rules.items.len > 0 and rules.items[rules.items.len - 1] == .media) {
                            var last_rule = &rules.items[rules.items.len - 1].media;
                            if (last_rule.query.eql(&med.query)) {
                                last_rule.rules.v.appendSlice(context.allocator, med.rules.v.items) catch bun.outOfMemory();
                                _ = try last_rule.minify(context, parent_is_unused);
                                continue;
                            }
                        }
                        if (try med.minify(context, parent_is_unused)) {
                            continue;
                        }
                    },
                    .supports => |*supp| {
                        if (rules.items.len > 0 and rules.items[rules.items.len - 1] == .supports) {
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
                        debug("Input style:\n  Selectors: {}\n  Decls: {}\n", .{ sty.selectors.debug(), sty.declarations.debug() });
                        if (parent_is_unused or try sty.minify(context, parent_is_unused)) {
                            continue;
                        }

                        // If some of the selectors in this rule are not compatible with the targets,
                        // we need to either wrap in :is() or split them into multiple rules.
                        var incompatible: css.SmallList(css.selector.parser.Selector, 1) = if (sty.selectors.v.len() > 1 and
                            context.targets.shouldCompileSelectors() and
                            !sty.isCompatible(context.targets.*))
                        incompatible: {
                            debug("Making incompatible!\n", .{});
                            // The :is() selector accepts a forgiving selector list, so use that if possible.
                            // Note that :is() does not allow pseudo elements, so we need to check for that.
                            // In addition, :is() takes the highest specificity of its arguments, so if the selectors
                            // have different weights, we need to split them into separate rules as well.
                            if (context.targets.isCompatible(css.compat.Feature.is_selector) and !sty.selectors.anyHasPseudoElement() and sty.selectors.specifitiesAllEqual()) {
                                const component = Component{ .is = sty.selectors.v.toOwnedSlice(context.allocator) };
                                var list = css.SmallList(css.selector.parser.Selector, 1){};
                                list.append(context.allocator, Selector.fromComponent(context.allocator, component));
                                sty.selectors = SelectorList{
                                    .v = list,
                                };
                                break :incompatible css.SmallList(Selector, 1){};
                            } else {
                                // Otherwise, partition the selectors and keep the compatible ones in this rule.
                                // We will generate additional rules for incompatible selectors later.
                                var incompatible = css.SmallList(Selector, 1){};
                                var i: u32 = 0;
                                while (i < sty.selectors.v.len()) {
                                    if (css.selector.isCompatible(sty.selectors.v.slice()[i .. i + 1], context.targets.*)) {
                                        i += 1;
                                    } else {
                                        // Move the selector to the incompatible list.
                                        incompatible.append(
                                            context.allocator,
                                            sty.selectors.v.orderedRemove(i),
                                        );
                                    }
                                }
                                break :incompatible incompatible;
                            }
                        } else .{};

                        sty.updatePrefix(context);

                        // Attempt to merge the new rule with the last rule we added.
                        var merged = false;
                        if (rules.items.len > 0 and rules.items[rules.items.len - 1] == .style) {
                            const last_style_rule = &rules.items[rules.items.len - 1].style;
                            if (mergeStyleRules(AtRule, sty, last_style_rule, context)) {
                                // If that was successful, then the last rule has been updated to include the
                                // selectors/declarations of the new rule. This might mean that we can merge it
                                // with the previous rule, so continue trying while we have style rules available.
                                while (rules.items.len >= 2) {
                                    const len = rules.items.len;
                                    var a, var b = bun.splitAtMut(CssRule(AtRule), rules.items, len - 1);
                                    if (b[0] == .style and a[len - 2] == .style) {
                                        if (mergeStyleRules(AtRule, &b[0].style, &a[len - 2].style, context)) {
                                            // If we were able to merge the last rule into the previous one, remove the last.
                                            const popped = rules.pop();
                                            _ = popped; // autofix
                                            // TODO: deinit?
                                            // popped.deinit(contet.allocator);
                                            continue;
                                        }
                                    }
                                    // If we didn't see a style rule, or were unable to merge, stop.
                                    break;
                                }
                                merged = true;
                            }
                        }

                        // Create additional rules for logical properties, @supports overrides, and incompatible selectors.
                        const supps = context.handler_context.getSupportsRules(AtRule, sty);
                        const logical = context.handler_context.getAdditionalRules(AtRule, sty);
                        debug("LOGICAL: {d}\n", .{logical.items.len});
                        const StyleRule = style.StyleRule(AtRule);

                        const IncompatibleRuleEntry = struct { rule: StyleRule, supports: ArrayList(css.CssRule(AtRule)), logical: ArrayList(css.CssRule(AtRule)) };
                        var incompatible_rules: css.SmallList(IncompatibleRuleEntry, 1) = incompatible_rules: {
                            var incompatible_rules = css.SmallList(IncompatibleRuleEntry, 1).initCapacity(
                                context.allocator,
                                incompatible.len(),
                            );

                            for (incompatible.slice_mut()) |sel| {
                                // Create a clone of the rule with only the one incompatible selector.
                                const list = SelectorList{ .v = css.SmallList(Selector, 1).withOne(sel) };
                                var clone: StyleRule = .{
                                    .selectors = list,
                                    .vendor_prefix = sty.vendor_prefix,
                                    .declarations = sty.declarations.deepClone(context.allocator),
                                    .rules = sty.rules.deepClone(context.allocator),
                                    .loc = sty.loc,
                                };
                                clone.updatePrefix(context);

                                // Also add rules for logical properties and @supports overrides.
                                const s = context.handler_context.getSupportsRules(AtRule, &clone);
                                const l = context.handler_context.getAdditionalRules(AtRule, &clone);
                                incompatible_rules.append(context.allocator, IncompatibleRuleEntry{
                                    .rule = clone,
                                    .supports = s,
                                    .logical = l,
                                });
                            }

                            break :incompatible_rules incompatible_rules;
                        };
                        debug("Incompatible rules: {d}\n", .{incompatible_rules.len()});
                        defer incompatible.deinit(context.allocator);
                        defer incompatible_rules.deinit(context.allocator);

                        context.handler_context.reset();

                        // If the rule has nested rules, and we have extra rules to insert such as for logical properties,
                        // we need to split the rule in two so we can insert the extra rules in between the declarations from
                        // the main rule and the nested rules.
                        const nested_rule: ?StyleRule = if (sty.rules.v.items.len > 0 and
                            // can happen if there are no compatible rules, above.
                            sty.selectors.v.len() > 0 and
                            (logical.items.len > 0 or supps.items.len > 0 or !incompatible_rules.isEmpty()))
                        brk: {
                            var rulesss: CssRuleList(AtRule) = .{};
                            std.mem.swap(CssRuleList(AtRule), &sty.rules, &rulesss);
                            break :brk StyleRule{
                                .selectors = sty.selectors.deepClone(context.allocator),
                                .declarations = css.DeclarationBlock{},
                                .rules = rulesss,
                                .vendor_prefix = sty.vendor_prefix,
                                .loc = sty.loc,
                            };
                        } else null;

                        if (!merged and !sty.isEmpty()) {
                            const source_index = sty.loc.source_index;
                            const has_no_rules = sty.rules.v.items.len == 0;
                            const idx = rules.items.len;

                            rules.append(context.allocator, rule.*) catch bun.outOfMemory();
                            moved_rule = true;

                            // Check if this rule is a duplicate of an earlier rule, meaning it has
                            // the same selectors and defines the same properties. If so, remove the
                            // earlier rule because this one completely overrides it.
                            if (has_no_rules) {
                                const key = StyleRuleKey(AtRule).new(&rules, idx);
                                if (idx > 0) {
                                    if (style_rules.fetchSwapRemove(key)) |i_| {
                                        const i = i_.value;
                                        if (i < rules.items.len and rules.items[i] == .style) {
                                            const other = &rules.items[i].style;
                                            // Don't remove the rule if this is a CSS module and the other rule came from a different file.
                                            if (!context.css_modules or source_index == other.loc.source_index) {
                                                // Only mark the rule as ignored so we don't need to change all of the indices.
                                                rules.items[i] = .ignored;
                                            }
                                        }
                                    }
                                }

                                style_rules.put(context.allocator, key, idx) catch bun.outOfMemory();
                            }
                        }

                        if (logical.items.len > 0) {
                            debug("Adding logical: {}\n", .{logical.items[0].style.selectors.debug()});
                            var log = CssRuleList(AtRule){ .v = logical };
                            try log.minify(context, parent_is_unused);
                            rules.appendSlice(context.allocator, log.v.items) catch bun.outOfMemory();
                        }
                        rules.appendSlice(context.allocator, supps.items) catch bun.outOfMemory();
                        for (incompatible_rules.slice_mut()) |incompatible_entry| {
                            if (!incompatible_entry.rule.isEmpty()) {
                                rules.append(context.allocator, .{ .style = incompatible_entry.rule }) catch bun.outOfMemory();
                            }
                            if (incompatible_entry.logical.items.len > 0) {
                                var log = CssRuleList(AtRule){ .v = incompatible_entry.logical };
                                try log.minify(context, parent_is_unused);
                                rules.appendSlice(context.allocator, log.v.items) catch bun.outOfMemory();
                            }
                            rules.appendSlice(context.allocator, incompatible_entry.supports.items) catch bun.outOfMemory();
                        }
                        if (nested_rule) |nested| {
                            rules.append(context.allocator, .{ .style = nested }) catch bun.outOfMemory();
                        }

                        continue;
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

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
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
        // TODO: store in the hashmap by setting `store_hash` to true
        hash: u64,

        const This = @This();

        pub fn HashMap(comptime V: type) type {
            return std.ArrayHashMapUnmanaged(
                StyleRuleKey(R),
                V,
                struct {
                    pub fn hash(_: @This(), key: This) u32 {
                        return @truncate(key.hash);
                    }

                    pub fn eql(_: @This(), a: This, b: This, _: usize) bool {
                        return a.eql(&b);
                    }
                },
                // TODO: make this true
                false,
            );
        }

        pub fn new(list: *const ArrayList(CssRule(R)), index: usize) This {
            const rule = &list.items[index].style;
            return This{
                .list = list,
                .index = index,
                .hash = rule.hashKey(),
            };
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
        last_style_rule.rules.v.items.len == 0 and
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
            css.selector.isEquivalent(sty.selectors.v.slice(), last_style_rule.selectors.v.slice()))
        {
            // If the new rule is unprefixed, replace the prefixes of the last rule.
            // Otherwise, add the new prefix.
            if (sty.vendor_prefix.contains(css.VendorPrefix{ .none = true }) and context.targets.shouldCompileSelectors()) {
                last_style_rule.vendor_prefix = sty.vendor_prefix;
            } else {
                last_style_rule.vendor_prefix.insert(sty.vendor_prefix);
            }
            return true;
        }

        // Append the selectors to the last rule if the declarations are the same, and all selectors are compatible.
        if (sty.isCompatible(context.targets.*) and last_style_rule.isCompatible(context.targets.*)) {
            last_style_rule.selectors.v.appendSlice(
                context.allocator,
                sty.selectors.v.slice(),
            );
            sty.selectors.v.clearRetainingCapacity();
            if (sty.vendor_prefix.contains(css.VendorPrefix{ .none = true }) and context.targets.shouldCompileSelectors()) {
                last_style_rule.vendor_prefix = sty.vendor_prefix;
            } else {
                last_style_rule.vendor_prefix.insert(sty.vendor_prefix);
            }
            return true;
        }
    }
    return false;
}
