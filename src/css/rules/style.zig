const std = @import("std");
pub const css = @import("../css_parser.zig");
const bun = @import("root").bun;
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
const LayerName = css.css_rules.layer.LayerName;
const SupportsCondition = css.css_rules.supports.SupportsCondition;
const Location = css.css_rules.Location;

pub fn StyleRule(comptime R: type) type {
    return struct {
        /// The selectors for the style rule.
        selectors: css.selector.parser.SelectorList,
        /// A vendor prefix override, used during selector printing.
        vendor_prefix: css.VendorPrefix,
        /// The declarations within the style rule.
        declarations: css.DeclarationBlock,
        /// Nested rules within the style rule.
        rules: css.CssRuleList(R),
        /// The location of the rule in the source file.
        loc: css.Location,

        const This = @This();

        /// Returns whether the rule is empty.
        pub fn isEmpty(this: *const This) bool {
            return this.selectors.v.isEmpty() or (this.declarations.isEmpty() and this.rules.v.items.len == 0);
        }

        /// Returns a hash of this rule for use when deduplicating.
        /// Includes the selectors and properties.
        pub fn hashKey(this: *const This) u64 {
            var hasher = std.hash.Wyhash.init(0);
            this.selectors.hash(&hasher);
            this.declarations.hashPropertyIds(&hasher);
            return hasher.final();
        }

        pub fn deepClone(this: *const This, allocator: std.mem.Allocator) This {
            return This{
                .selectors = this.selectors.deepClone(allocator),
                .vendor_prefix = this.vendor_prefix,
                .declarations = this.declarations.deepClone(allocator),
                .rules = this.rules.deepClone(allocator),
                .loc = this.loc,
            };
        }

        pub fn updatePrefix(this: *This, context: *css.MinifyContext) void {
            this.vendor_prefix = css.selector.getPrefix(&this.selectors);
            if (this.vendor_prefix.contains(css.VendorPrefix{ .none = true }) and
                context.targets.shouldCompileSelectors())
            {
                this.vendor_prefix = css.selector.downlevelSelectors(context.allocator, this.selectors.v.slice_mut(), context.targets.*);
            }
        }

        pub fn isCompatible(this: *const This, targets: css.targets.Targets) bool {
            return css.selector.isCompatible(this.selectors.v.slice(), targets);
        }

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            if (this.vendor_prefix.isEmpty()) {
                try this.toCssBase(W, dest);
            } else {
                var first_rule = true;
                inline for (css.VendorPrefix.FIELDS) |field| {
                    if (@field(this.vendor_prefix, field)) {
                        if (first_rule) {
                            first_rule = false;
                        } else {
                            if (!dest.minify) {
                                try dest.writeChar('\n'); // no indent
                            }
                            try dest.newline();
                        }

                        const prefix = css.VendorPrefix.fromName(field);
                        dest.vendor_prefix = prefix;
                        try this.toCssBase(W, dest);
                    }
                }

                dest.vendor_prefix = css.VendorPrefix.empty();
            }
        }

        fn toCssBase(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // If supported, or there are no targets, preserve nesting. Otherwise, write nested rules after parent.
            const supports_nesting = this.rules.v.items.len == 0 or
                !css.Targets.shouldCompileSame(
                    &dest.targets,
                    .nesting,
                );

            const len = this.declarations.declarations.items.len + this.declarations.important_declarations.items.len;
            const has_declarations = supports_nesting or len > 0 or this.rules.v.items.len == 0;

            if (has_declarations) {
                //   #[cfg(feature = "sourcemap")]
                //   dest.add_mapping(self.loc);

                try css.selector.serialize.serializeSelectorList(this.selectors.v.slice(), W, dest, dest.context(), false);
                try dest.whitespace();
                try dest.writeChar('{');
                dest.indent();

                var i: usize = 0;
                const DECLS = .{ "declarations", "important_declarations" };
                inline for (DECLS) |decl_field_name| {
                    const important = comptime std.mem.eql(u8, decl_field_name, "important_declarations");
                    const decls: *const ArrayList(css.Property) = &@field(this.declarations, decl_field_name);

                    for (decls.items) |*decl| {
                        // The CSS modules `composes` property is handled specially, and omitted during printing.
                        // We need to add the classes it references to the list for the selectors in this rule.
                        if (decl.* == .composes) {
                            const composes = &decl.composes;
                            if (dest.isNested() and dest.css_module != null) {
                                return dest.newError(css.PrinterErrorKind.invalid_composes_nesting, composes.cssparser_loc);
                            }

                            if (dest.css_module) |*css_module| {
                                if (css_module.handleComposes(
                                    W,
                                    dest,
                                    &this.selectors,
                                    composes,
                                    this.loc.source_index,
                                ).asErr()) |error_kind| {
                                    return dest.newError(error_kind, composes.cssparser_loc);
                                }
                                continue;
                            }
                        }

                        try dest.newline();
                        try decl.toCss(W, dest, important);
                        if (i != len - 1 or !dest.minify or (supports_nesting and this.rules.v.items.len > 0)) {
                            try dest.writeChar(';');
                        }

                        i += 1;
                    }
                }
            }

            const Helpers = struct {
                pub fn newline(
                    self: *const This,
                    comptime W2: type,
                    d: *Printer(W2),
                    supports_nesting2: bool,
                    len1: usize,
                ) PrintErr!void {
                    if (!d.minify and (supports_nesting2 or len1 > 0) and self.rules.v.items.len > 0) {
                        if (len1 > 0) {
                            try d.writeChar('\n');
                        }
                        try d.newline();
                    }
                }

                pub fn end(comptime W2: type, d: *Printer(W2), has_decls: bool) PrintErr!void {
                    if (has_decls) {
                        d.dedent();
                        try d.newline();
                        try d.writeChar('}');
                    }
                }
            };

            // Write nested rules after the parent.
            if (supports_nesting) {
                try Helpers.newline(this, W, dest, supports_nesting, len);
                try this.rules.toCss(W, dest);
                try Helpers.end(W, dest, has_declarations);
            } else {
                try Helpers.end(W, dest, has_declarations);
                try Helpers.newline(this, W, dest, supports_nesting, len);
                try dest.withContext(&this.selectors, this, struct {
                    pub fn toCss(self: *const This, WW: type, d: *Printer(WW)) PrintErr!void {
                        return self.rules.toCss(WW, d);
                    }
                }.toCss);
            }
        }

        pub fn minify(this: *This, context: *css.MinifyContext, parent_is_unused: bool) css.MinifyErr!bool {
            var unused = false;
            if (context.unused_symbols.count() > 0) {
                if (css.selector.isUnused(this.selectors.v.slice(), context.unused_symbols, &context.extra.symbols, parent_is_unused)) {
                    if (this.rules.v.items.len == 0) {
                        return true;
                    }

                    this.declarations.declarations.clearRetainingCapacity();
                    this.declarations.important_declarations.clearRetainingCapacity();
                    unused = true;
                }
            }

            // TODO: this
            // let pure_css_modules = context.pure_css_modules;
            // if context.pure_css_modules {
            //   if !self.selectors.0.iter().all(is_pure_css_modules_selector) {
            //     return Err(MinifyError {
            //       kind: crate::error::MinifyErrorKind::ImpureCSSModuleSelector,
            //       loc: self.loc,
            //     });
            //   }

            //   // Parent rule contained id or class, so child rules don't need to.
            //   context.pure_css_modules = false;
            // }

            context.handler_context.context = .style_rule;
            this.declarations.minify(context.handler, context.important_handler, &context.handler_context);
            context.handler_context.context = .none;

            if (this.rules.v.items.len > 0) {
                var handler_context = context.handler_context.child(.style_rule);
                std.mem.swap(css.PropertyHandlerContext, &context.handler_context, &handler_context);
                try this.rules.minify(context, unused);
                if (unused and this.rules.v.items.len == 0) {
                    return true;
                }
            }

            return false;
        }

        /// Returns whether this rule is a duplicate of another rule.
        /// This means it has the same selectors and properties.
        pub inline fn isDuplicate(this: *const This, other: *const This) bool {
            return this.declarations.len() == other.declarations.len() and
                this.selectors.eql(&other.selectors) and
                brk: {
                    var len = @min(this.declarations.declarations.items.len, other.declarations.declarations.items.len);
                    for (this.declarations.declarations.items[0..len], other.declarations.declarations.items[0..len]) |*a, *b| {
                        if (!a.propertyId().eql(&b.propertyId())) break :brk false;
                    }
                    len = @min(this.declarations.important_declarations.items.len, other.declarations.important_declarations.items.len);
                    for (this.declarations.important_declarations.items[0..len], other.declarations.important_declarations.items[0..len]) |*a, *b| {
                        if (!a.propertyId().eql(&b.propertyId())) break :brk false;
                    }
                    break :brk true;
                };
        }
    };
}
