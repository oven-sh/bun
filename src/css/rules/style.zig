const std = @import("std");
pub const css = @import("../css_parser.zig");
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
        selectors: css.selector.api.SelectorList,
        /// A vendor prefix override, used during selector printing.
        vendor_prefix: css.VendorPrefix,
        /// The declarations within the style rule.
        declarations: css.DeclarationBlock,
        /// Nested rules within the style rule.
        rules: css.CssRuleList(R),
        /// The location of the rule in the source file.
        loc: css.Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            if (this.vendor_prefix.isEmpty()) {
                try this.toCssBase(W, dest);
            } else {
                var first_rule = true;
                inline for (std.meta.fields(css.VendorPrefix)) |field| {
                    if (field.type == bool and @field(this.vendor_prefix, field.name)) {
                        if (first_rule) {
                            first_rule = false;
                        } else {
                            if (!dest.minify) {
                                try dest.writeChar('\n'); // no indent
                            }
                            try dest.newline();
                        }

                        const prefix = css.VendorPrefix.fromName(field.name);
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
                css.Targets.shouldCompileSame(
                &dest.targets,
                .nesting,
            );

            const len = this.declarations.declarations.items.len + this.declarations.important_declarations.items.len;
            const has_declarations = supports_nesting or len > 0 or this.rules.v.items.len == 0;

            if (has_declarations) {
                //   #[cfg(feature = "sourcemap")]
                //   dest.add_mapping(self.loc);

                try css.selector.serialize.serializeSelectorList(this.selectors.v.items, W, dest, dest.context(), false);
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
                                return dest.newError(css.PrinterErrorKind.invalid_composes_nesting, composes.loc);
                            }

                            if (dest.css_module) |*css_module| {
                                if (css_module.handleComposes(
                                    dest.allocator,
                                    &this.selectors,
                                    composes,
                                    this.loc.source_index,
                                ).asErr()) |error_kind| {
                                    return dest.newError(error_kind, composes.loc);
                                }
                                continue;
                            }
                        }

                        try dest.newline();
                        try decl.toCss(dest, important);
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
                Helpers.end(W, dest, has_declarations);
            } else {
                Helpers.end(W, dest, has_declarations);
                try Helpers.newline(this, W, dest, supports_nesting, len);
                try dest.withContext(&this.selectors, this, This.toCss);
            }
        }
    };
}
