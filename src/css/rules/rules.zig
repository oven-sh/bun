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
        font_palette_values: font_face.FontPaletteValuesRule,
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
        unknown: unknown.UnknownAtRule(Rule),
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
                            deps.append(@compileError(css.todo_stuff.think_about_allocator), dep.?) catch unreachable;
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

pub const supports = struct {
    /// A [`<supports-condition>`](https://drafts.csswg.org/css-conditional-3/#typedef-supports-condition),
    /// as used in the `@supports` and `@import` rules.
    pub const SupportsCondition = union(enum) {
        /// A `not` expression.
        not: *SupportsCondition,

        /// An `and` expression.
        @"and": ArrayList(SupportsCondition),

        /// An `or` expression.
        @"or": ArrayList(SupportsCondition),

        /// A declaration to evaluate.
        declaration: struct {
            /// The property id for the declaration.
            property_id: css.PropertyId,
            /// The raw value of the declaration.
            value: []const u8,
        },

        /// A selector to evaluate.
        selector: []const u8,

        /// An unknown condition.
        unknown: []const u8,

        fn needsParens(this: *const SupportsCondition, parent: *const SupportsCondition) bool {
            return switch (this.*) {
                .not => true,
                .@"and" => parent.* != .@"and",
                .@"or" => parent.* != .@"or",
                _ => false,
            };
        }

        pub fn parse(input: *css.Parser) Error!SupportsCondition {
            _ = input; // autofix
            @compileError(css.todo_stuff.depth);
        }

        pub fn parseDeclaration(input: *css.Parser) Error!SupportsCondition {
            _ = input; // autofix
            @compileError(css.todo_stuff.depth);
        }

        pub fn toCss(this: *const SupportsCondition, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
            switch (this.*) {
                .not => |condition| {
                    try dest.writeStr(" not ");
                    condition.toCssWithParensIfNeeded(dest, condition.needsParens(this));
                },
                .@"and" => |conditions| {
                    var first = true;
                    for (conditions.items) |*cond| {
                        if (first) {
                            first = false;
                        } else {
                            try dest.writeStr(" and ");
                        }
                        try cond.toCssWithParensIfNeeded(dest, cond.needsParens(this));
                    }
                },
                .@"or" => |conditions| {
                    var first = true;
                    for (conditions.items) |*cond| {
                        if (first) {
                            first = false;
                        } else {
                            try dest.writeStr(" or ");
                        }
                        try cond.toCssWithParensIfNeeded(dest, cond.needsParens(this));
                    }
                },
                .declaration => |decl| {
                    const property_id = decl.property_id;
                    const value = decl.value;

                    try dest.writeChar('(');

                    const prefix: css.VendorPrefix = property_id.prefix().orNone();
                    if (!prefix.eq(css.VendorPrefix{ .none = true })) {
                        try dest.writeChar('(');
                    }

                    const name = property_id.name();
                    var first = true;
                    inline for (std.meta.fields(css.VendorPrefix)) |field_| {
                        const field: std.builtin.Type.StructField = field_;
                        if (!@field(prefix, field.name)) continue;

                        if (first) {
                            first = false;
                        } else {
                            try dest.writeStr(") or (");
                        }

                        var p = css.VendorPrefix{};
                        @field(p, field.name) = true;
                        try css.serializer.serializeName(name, dest);
                        try dest.delim(':', false);
                        try dest.writeStr(value);
                    }

                    if (!prefix.eq(css.VendorPrefix{ .none = true })) {
                        try dest.writeChar(')');
                    }
                    try dest.writeChar(')');
                },
                .selector => |sel| {
                    try dest.writeStr("selector(");
                    try dest.writeStr(sel);
                    try dest.writeChar(')');
                },
                .unknown => |unk| {
                    try dest.writeStr(unk);
                },
            }
        }

        pub fn toCssWithParensIfNeeded(
            this: *const SupportsCondition,
            comptime W: type,
            dest: *css.Printer(
                W,
            ),
            needs_parens: bool,
        ) css.PrintErr!void {
            if (needs_parens) try dest.writeStr("(");
            try this.toCss(W, dest);
            if (needs_parens) try dest.writeStr(")");
        }
    };

    /// A [@supports](https://drafts.csswg.org/css-conditional-3/#at-supports) rule.
    pub fn SupportsRule(comptime R: type) type {
        return struct {
            /// The supports condition.
            condition: SupportsCondition,
            /// The rules within the `@supports` rule.
            rules: css.CssRuleList(R),
            /// The location of the rule in the source file.
            loc: Location,

            const This = @This();

            pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
                // #[cfg(feature = "sourcemap")]
                // dest.add_mapping(self.loc);

                try dest.writeStr("@supports ");
                try this.condition.toCss(W, dest);
                try dest.whitespace();
                try dest.writeChar('{');
                dest.indent();
                try dest.newline();
                this.rules.toCss(W, dest);
                dest.dedent();
                try dest.newline();
                try dest.writeChar('}');
            }
        };
    }
};

pub const custom_media = struct {
    pub usingnamespace @import("./custom_media.zig");
};

pub const namespace = struct {
    pub usingnamespace @import("./namespace.zig");
};

pub const unknown = struct {
    pub usingnamespace @import("./unknown.zig");
};

pub const media = struct {
    pub fn MediaRule(comptime R: type) type {
        return struct {
            /// The media query list.
            query: css.MediaList,
            /// The rules within the `@media` rule.
            rules: css.CssRuleList(R),
            /// The location of the rule in the source file.
            loc: Location,

            const This = @This();

            pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
                if (dest.minify and this.query.alwaysMatches()) {
                    try this.rules.toCss(W, dest);
                    return;
                }

                // #[cfg(feature = "sourcemap")]
                // dest.addMapping(this.loc);

                try dest.writeStr("@media ");
                try this.query.toCss(W, dest);
                try dest.whitespace();
                try dest.writeChar('{');
                dest.indent();
                try dest.newline();
                try this.rules.toCss(W, dest);
                dest.dedent();
                try dest.newline();
                dest.writeChar('}');
            }
        };
    }
};

pub const page = struct {
    /// A [page selector](https://www.w3.org/TR/css-page-3/#typedef-page-selector)
    /// within a `@page` rule.
    ///
    /// Either a name or at least one pseudo class is required.
    pub const PageSelector = struct {
        /// An optional named page type.
        name: ?[]const u8,
        /// A list of page pseudo classes.
        psuedo_classes: ArrayList(PagePseudoClass),

        pub fn parse(input: *css.Parser) Error!PageSelector {
            _ = input; // autofix
            @compileError(css.todo_stuff.depth);
        }

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };

    pub const PageMarginRule = struct {
        /// The margin box identifier for this rule.
        margin_box: PageMarginBox,
        /// The declarations within the rule.
        declarations: css.DeclarationBlock,
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };

    /// A [@page](https://www.w3.org/TR/css-page-3/#at-page-rule) rule.
    pub const PageRule = struct {
        /// A list of page selectors.
        selectors: ArrayList(PageSelector),
        /// The declarations within the `@page` rule.
        declarations: css.DeclarationBlock,
        /// The nested margin rules.
        rules: ArrayList(PageMarginRule),
        /// The location of the rule in the source file.
        loc: Location,

        pub fn parse(selectors: ArrayList(PageSelector), input: *css.Parser, loc: Location, options: *css.ParserOptions) Error!PageRule {
            _ = selectors; // autofix
            _ = input; // autofix
            _ = loc; // autofix
            _ = options; // autofix
            @compileError(css.todo_stuff.depth);
        }

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);
            try dest.writeStr("@page");
            if (this.selectors.items.len >= 1) {
                const firstsel = &this.selectors.items[0];
                // Space is only required if the first selector has a name.
                if (!dest.minify and firstsel.name != null) {
                    try dest.writeChar(' ');
                }
                var first = true;
                for (this.selectors.items) |selector| {
                    if (first) {
                        first = false;
                    } else {
                        try dest.delim(',', false);
                    }
                    try selector.toCss(W, dest);
                }
            }

            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();

            var i = 0;
            const len = this.declarations.len() + this.rules.len();

            const DECLS = .{ "declarations", "important_declarations" };
            inline for (DECLS) |decl_field_name| {
                const decls: *const ArrayList(css.Property) = &@field(this.declarations, decl_field_name);
                const important = comptime std.mem.eql(u8, decl_field_name, "important_declarations");
                for (decls.items) |*decl| {
                    try dest.newline();
                    try decl.toCss(W, dest, important);
                    if (i != len - 1 or !dest.minify) {
                        try dest.writeChar(';');
                    }
                    i += 1;
                }
            }

            if (this.rules.items.len > 0) {
                if (!dest.minify and this.declarations.items.len > 0) {
                    try dest.writeChar('\n');
                }
                try dest.newline();

                var first = true;
                for (this.rules.items) |*rule| {
                    if (first) {
                        first = false;
                    } else {
                        if (!dest.minify) {
                            try dest.writeChar('\n');
                        }
                        try dest.newline();
                    }
                    try rule.toCss(W, dest);
                }
            }

            dest.dedent();
            try dest.newline();
            dest.writeChar('}');
        }
    };

    pub const PagePseudoClass = css.DefineEnumProperty(struct {
        comptime {
            @compileError(css.todo_stuff.depth);
        }
    });

    pub const PageMarginBox = css.DefineEnumProperty(struct {
        comptime {
            @compileError(css.todo_stuff.depth);
        }
    });
};

pub const container = struct {
    pub const ContainerName = struct {
        v: css.css_values.ident.CustomIdent,
        pub fn parse(input: *css.Parser) Error!ContainerName {
            _ = input; // autofix
            @compileError(css.todo_stuff.depth);
        }

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };

    pub const ContainerNameFns = ContainerName;
    pub const ContainerSizeFeature = struct {
        comptime {
            @compileError(css.todo_stuff.depth);
        }
    };

    /// Represents a style query within a container condition.
    pub const StyleQuery = union(enum) {
        /// A style feature, implicitly parenthesized.
        feature: css.Property,

        /// A negation of a condition.
        not: *StyleQuery,

        /// A set of joint operations.
        Operation: struct {
            /// The operator for the conditions.
            operator: css.media_query.Operator,
            /// The conditions for the operator.
            conditions: ArrayList(StyleQuery),
        },
    };

    pub const ContainerCondition = union(enum) {
        /// A size container feature, implicitly parenthesized.
        feature: ContainerSizeFeature,
        /// A negation of a condition.
        not: *ContainerCondition,
        /// A set of joint operations.
        operation: struct {
            /// The operator for the conditions.
            operator: css.media_query.Operator,
            /// The conditions for the operator.
            conditions: ArrayList(ContainerCondition),
        },
        /// A style query.
        style: StyleQuery,

        pub fn parse(input: *css.Parser) Error!ContainerCondition {
            _ = input; // autofix
            @compileError(css.todo_stuff.depth);
        }

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };

    /// A [@container](https://drafts.csswg.org/css-contain-3/#container-rule) rule.
    pub fn ContainerRule(comptime R: type) type {
        return struct {
            /// The name of the container.
            name: ?ContainerName,
            /// The container condition.
            condition: ContainerCondition,
            /// The rules within the `@container` rule.
            rules: css.CssRuleList(R),
            /// The location of the rule in the source file.
            loc: Location,

            const This = @This();

            pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
                // #[cfg(feature = "sourcemap")]
                // dest.add_mapping(self.loc);

                try dest.writeStr("@container ");
                if (this.name) |*name| {
                    try name.toCss(W, dest);
                    try dest.writeChar(' ');
                }

                // Don't downlevel range syntax in container queries.
                const exclude = dest.targets.exclude;
                dest.targets.exclude.insert(css.Features{ .media_queries = true });
                try this.condition.toCss(W, dest);
                dest.targets.exclude = exclude;

                try dest.whitespace();
                try dest.writeChar('{');
                dest.indent();
                try dest.newline();
                try this.rules.toCss(W, dest);
                dest.dedent();
                try dest.newline();
                try dest.writeChar('}');
            }
        };
    }
};

pub const scope = struct {
    /// A [@scope](https://drafts.csswg.org/css-cascade-6/#scope-atrule) rule.
    ///
    /// @scope (<scope-start>) [to (<scope-end>)]? {
    ///  <stylesheet>
    /// }
    pub fn ScopeRule(comptime R: type) type {
        return struct {
            /// A selector list used to identify the scoping root(s).
            scope_start: ?css.selector.api.SelectorList,
            /// A selector list used to identify any scoping limits.
            scope_end: ?css.selector.api.SelectorList,
            /// Nested rules within the `@scope` rule.
            rules: css.CssRuleList(R),
            /// The location of the rule in the source file.
            loc: Location,

            const This = @This();

            pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
                // #[cfg(feature = "sourcemap")]
                // dest.add_mapping(self.loc);

                try dest.writeStr("@scope");
                try dest.whitespace();
                if (this.scope_start) |*scope_start| {
                    try dest.writeChar('(');
                    try scope_start.toCss(W, dest);
                    try dest.writeChar(')');
                    try dest.whitespace();
                }
                if (this.scope_end) |*scope_end| {
                    if (dest.minify) {
                        try dest.writeChar(' ');
                    }
                    try dest.writeStr("to (");
                    // <scope-start> is treated as an ancestor of scope end.
                    // https://drafts.csswg.org/css-nesting/#nesting-at-scope
                    if (this.scope_start) |*scope_start| {
                        try dest.withContext(scope_start, css.SelectorList.toCss, .{scope_start});
                    } else {
                        try scope_end.toCss(W, dest);
                    }
                    try dest.writeChar(')');
                    try dest.whitespace();
                }
                try dest.writeChar('{');
                dest.indent();
                try dest.newline();
                // Nested style rules within @scope are implicitly relative to the <scope-start>
                // so clear our style context while printing them to avoid replacing & ourselves.
                // https://drafts.csswg.org/css-cascade-6/#scoped-rules
                try dest.withClearedContext(CssRuleList(R).toCss, .{&this.rules});
                dest.dedent();
                try dest.newline();
                try dest.writeChar('}');
            }
        };
    }
};

pub const font_face = struct {
    /// A [@font-palette-values](https://drafts.csswg.org/css-fonts-4/#font-palette-values) rule.
    pub const FontPaletteValuesRule = struct {
        /// The name of the font palette.
        name: css.css_values.ident.DashedIdent,
        /// Declarations in the `@font-palette-values` rule.
        properties: ArrayList(FontPaletteValuesProperty),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@font-palette-values ");
            try css.css_values.ident.DashedIdentFns.toCss(&this.name, dest);
            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            const len = this.properties.items.len;
            for (this.properties.items, 0..) |*prop, i| {
                try dest.newline();
                try prop.toCss(dest);
                if (i != len - 1 or !dest.minify) {
                    try dest.writeChar(';');
                }
            }
            dest.dedent();
            try dest.newline();
            try dest.writeChar('}');
        }
    };

    pub const FontPaletteValuesProperty = struct {
        /// The `font-family` property.
        font_family: fontprops.FontFamily,

        /// The `base-palette` property.
        base_palette: BasePalette,

        /// The `override-colors` property.
        override_colors: ArrayList(OverrideColors),

        /// An unknown or unsupported property.
        custom: css.css_properties.custom.CustomProperty,

        /// A property within an `@font-palette-values` rule.
        ///
        /// See [FontPaletteValuesRule](FontPaletteValuesRule).
        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix
            @compileError(css.todo_stuff.depth);
        }
    };

    /// A value for the [override-colors](https://drafts.csswg.org/css-fonts-4/#override-color)
    /// property in an `@font-palette-values` rule.
    pub const OverrideColors = struct {
        /// The index of the color within the palette to override.
        index: u16,

        /// The replacement color.
        color: css.css_values.color.CssColor,
    };

    /// A value for the [base-palette](https://drafts.csswg.org/css-fonts-4/#base-palette-desc)
    /// property in an `@font-palette-values` rule.
    pub const BasePalette = union(enum) {
        /// A light color palette as defined within the font.
        light,

        /// A dark color palette as defined within the font.
        dark,

        /// A palette index within the font.
        integer: u16,
    };

    /// A property within an `@font-face` rule.
    ///
    /// See [FontFaceRule](FontFaceRule).
    pub const FontFaceProperty = union(enum) {
        /// The `src` property.
        source: ArrayList(Source),

        /// The `font-family` property.
        font_family: fontprops.FontFamily,

        /// The `font-style` property.
        font_style: FontStyle,

        /// The `font-weight` property.
        font_weight: Size2D(fontprops.FontWeight),

        /// The `font-stretch` property.
        font_stretch: Size2D(fontprops.FontStretch),

        /// The `unicode-range` property.
        unicode_range: ArrayList(UnicodeRange),

        /// An unknown or unsupported property.
        custom: css.css_properties.custom.CustomProperty,

        comptime {
            @compileError(css.todo_stuff.depth);
        }

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            _ = this; // autofix
            _ = dest; // autofix

            @compileError(css.todo_stuff.depth);
        }
    };

    /// A contiguous range of Unicode code points.
    ///
    /// Cannot be empty. Can represent a single code point when start == end.
    pub const UnicodeRange = struct {
        /// Inclusive start of the range. In [0, end].
        start: u32,

        /// Inclusive end of the range. In [0, 0x10FFFF].
        end: u32,
    };

    pub const FontStyle = union(enum) {
        /// Normal font style.
        normal,

        /// Italic font style.
        italic,

        /// Oblique font style, with a custom angle.
        oblique: css.css_values.angle.Angle,
    };

    /// A font format keyword in the `format()` function of the
    /// [src](https://drafts.csswg.org/css-fonts/#src-desc)
    /// property of an `@font-face` rule.
    pub const FontFormat = union(enum) {
        /// A WOFF 1.0 font.
        woff,

        /// A WOFF 2.0 font.
        woff2,

        /// A TrueType font.
        truetype,

        /// An OpenType font.
        opentype,

        /// An Embedded OpenType (.eot) font.
        embedded_opentype,

        /// OpenType Collection.
        collection,

        /// An SVG font.
        svg,

        /// An unknown format.
        string: []const u8,
    };

    /// A value for the [src](https://drafts.csswg.org/css-fonts/#src-desc)
    /// property in an `@font-face` rule.
    pub const Source = union(enum) {
        /// A `url()` with optional format metadata.
        url: UrlSource,

        /// The `local()` function.
        local: fontprops.FontFamily,
    };

    pub const FontTechnology = enum {
        /// A font format keyword in the `format()` function of the
        /// [src](https://drafts.csswg.org/css-fonts/#src-desc)
        /// property of an `@font-face` rule.
        /// A font features tech descriptor in the `tech()`function of the
        /// [src](https://drafts.csswg.org/css-fonts/#font-features-tech-values)
        /// property of an `@font-face` rule.
        /// Supports OpenType Features.
        /// https://docs.microsoft.com/en-us/typography/opentype/spec/featurelist
        @"features-opentype",

        /// Supports Apple Advanced Typography Font Features.
        /// https://developer.apple.com/fonts/TrueType-Reference-Manual/RM09/AppendixF.html
        @"features-aat",

        /// Supports Graphite Table Format.
        /// https://scripts.sil.org/cms/scripts/render_download.php?site_id=nrsi&format=file&media_id=GraphiteBinaryFormat_3_0&filename=GraphiteBinaryFormat_3_0.pdf
        @"features-graphite",

        /// A color font tech descriptor in the `tech()`function of the
        /// [src](https://drafts.csswg.org/css-fonts/#src-desc)
        /// property of an `@font-face` rule.
        /// Supports the `COLR` v0 table.
        @"color-colrv0",

        /// Supports the `COLR` v1 table.
        @"color-colrv1",

        /// Supports the `SVG` table.
        @"color-svg",

        /// Supports the `sbix` table.
        @"color-sbix",

        /// Supports the `CBDT` table.
        @"color-cbdt",

        /// Supports Variations
        /// The variations tech refers to the support of font variations
        variations,

        /// Supports Palettes
        /// The palettes tech refers to support for font palettes
        palettes,

        /// Supports Incremental
        /// The incremental tech refers to client support for incremental font loading, using either the range-request or the patch-subset method
        incremental,

        pub usingnamespace css.DefineEnumProperty(@This());
    };

    /// A `url()` value for the [src](https://drafts.csswg.org/css-fonts/#src-desc)
    /// property in an `@font-face` rule.
    pub const UrlSource = struct {
        /// The URL.
        url: Url,

        /// Optional `format()` function.
        format: ?FontFormat,

        /// Optional `tech()` function.
        tech: ArrayList(FontTechnology),
    };

    /// A [@font-face](https://drafts.csswg.org/css-fonts/#font-face-rule) rule.
    pub const FontFaceRule = struct {
        /// Declarations in the `@font-face` rule.
        proeprties: ArrayList(FontFaceProperty),
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@font-face");
            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            const len = this.proeprties.items.len;
            for (this.proeprties.items, 0..) |*prop, i| {
                try dest.newline();
                prop.toCss(dest);
                if (i != len - 1 or !dest.minify) {
                    try dest.writeChar(';');
                }
            }
            dest.dedent();
            try dest.newline();
            dest.writeChar('}');
        }
    };

    pub const FontFaceDeclarationParser = struct {
        const This = @This();

        pub const DeclarationParser = struct {
            pub const Declaration = FontFaceProperty;

            fn parseValue(this: *This, name: []const u8, input: *css.Parser) Error!Declaration {
                _ = this; // autofix
                _ = name; // autofix
                _ = input; // autofix
                @compileError(css.todo_stuff.depth);
            }
        };
    };
};

pub const viewport = struct {
    /// A [@viewport](https://drafts.csswg.org/css-device-adapt/#atviewport-rule) rule.
    pub const ViewportRule = struct {
        /// The vendor prefix for this rule, e.g. `@-ms-viewport`.
        vendor_prefix: css.VendorPrefix,
        /// The declarations within the `@viewport` rule.
        declarations: css.DeclarationBlock,
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);
            try dest.write_char('@');
            try this.vendor_prefix.toCss(W, dest);
            try dest.write_str("viewport");
            try this.declarations.toCssBlock(W, dest);
        }
    };
};

pub const counter_style = struct {
    /// A [@counter-style](https://drafts.csswg.org/css-counter-styles/#the-counter-style-rule) rule.
    pub const CounterStyleRule = struct {
        /// The name of the counter style to declare.
        name: css.css_values.ident.CustomIdent,
        /// Declarations in the `@counter-style` rule.
        declarations: css.DeclarationBlock,
        /// The location of the rule in the source file.
        loc: Location,

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@counter-style");
            css.css_values.ident.CustomIdentFns.toCss(W, dest);
            try this.declarations.toCssBlock(W, dest);
        }
    };
};

pub const document = struct {
    /// A [@-moz-document](https://www.w3.org/TR/2012/WD-css3-conditional-20120911/#at-document) rule.
    ///
    /// Note that only the `url-prefix()` function with no arguments is supported, and only the `-moz` prefix
    /// is allowed since Firefox was the only browser that ever implemented this rule.
    pub fn MozDocumentRule(comptime R: type) type {
        return struct {
            /// Nested rules within the `@-moz-document` rule.
            rules: css.CssRuleList(R),
            /// The location of the rule in the source file.
            loc: Location,

            const This = @This();

            pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
                // #[cfg(feature = "sourcemap")]
                // dest.add_mapping(self.loc);
                try dest.writeStr("@-moz-document url-prefix()");
                try dest.whitespace();
                try dest.writeChar('{');
                dest.indent();
                try dest.newline();
                try this.rules.toCss(W, dest);
                dest.dedent();
                try dest.newline();
                try dest.writeChar('}');
            }
        };
    }
};

pub const property = struct {
    pub const PropertyRule = struct {
        name: css.css_values.ident.DashedIdent,
        syntax: css.css_values.syntax.SyntaxString,
        inherits: bool,
        initial_vlaue: ?css.css_values.syntax.ParsedComponent,
        loc: Location,

        pub fn parse(name: css.css_values.ident.DashedIdent, input: *css.Parser, loc: Location) Error!PropertyRule {
            _ = name; // autofix
            _ = input; // autofix
            _ = loc; // autofix
        }

        const This = @This();

        pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
            // #[cfg(feature = "sourcemap")]
            // dest.add_mapping(self.loc);

            try dest.writeStr("@property ");
            try css.css_values.ident.DashedIdentFns.toCss(&this.name, W, dest);
            try dest.whitespace();
            try dest.writeChar('{');
            dest.indent();
            try dest.newline();

            try dest.writeStr("syntax:");
            try dest.whitespace();
            try this.syntax.toCss(W, dest);
            try dest.writeChar(';');
            try dest.newline();

            try dest.writeStr("inherits:");
            try dest.whitespace();
            if (this.inherits) {
                try dest.writeStr("true");
            } else {
                try dest.writeStr("false");
            }

            if (this.initial_vlaue) |*initial_value| {
                try dest.writeChar(';');
                try dest.newline();

                try dest.writeStr("initial-value:");
                try dest.whitespace();
                try initial_value.toCss(W, dest);

                if (!dest.minify) {
                    try dest.writeChar(';');
                }
            }

            dest.dedent();
            try dest.newline();
            try dest.writeChar(';');
        }
    };
};

pub const starting_style = struct {
    /// A [@starting-style](https://drafts.csswg.org/css-transitions-2/#defining-before-change-style-the-starting-style-rule) rule.
    pub fn StartingStyleRule(comptime R: type) type {
        return struct {
            /// Nested rules within the `@starting-style` rule.
            rules: css.CssRuleList(R),
            /// The location of the rule in the source file.
            loc: Location,

            const This = @This();

            pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
                // #[cfg(feature = "sourcemap")]
                // dest.add_mapping(self.loc);

                try dest.writeStr("@starting-style");
                try dest.whitespace();
                try dest.writeChar('{');
                dest.indent();
                try dest.newline();
                try this.rules.toCss(W, dest);
                dest.dedent();
                try dest.newline();
                try dest.writeChar('}');
            }
        };
    }
};

pub const nesting = struct {
    /// A [@nest](https://www.w3.org/TR/css-nesting-1/#at-nest) rule.
    pub fn NestingRule(comptime R: type) type {
        return struct {
            /// The style rule that defines the selector and declarations for the `@nest` rule.
            style: style.StyleRule(R),
            /// The location of the rule in the source file.
            loc: Location,

            const This = @This();

            pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
                _ = this; // autofix
                _ = dest; // autofix
                @compileError(css.todo_stuff.depth);
            }
        };
    }
};
