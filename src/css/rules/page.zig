const std = @import("std");
pub const css = @import("../css_parser.zig");
const bun = @import("root").bun;
const Result = css.Result;
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
const Angle = css.css_values.angle.Angle;
const FontStyleProperty = css.css_properties.font.FontStyle;
const FontFamily = css.css_properties.font.FontFamily;
const FontWeight = css.css_properties.font.FontWeight;
const FontStretch = css.css_properties.font.FontStretch;
const CustomProperty = css.css_properties.custom.CustomProperty;
const CustomPropertyName = css.css_properties.custom.CustomPropertyName;
const DashedIdent = css.css_values.ident.DashedIdent;

/// A [page selector](https://www.w3.org/TR/css-page-3/#typedef-page-selector)
/// within a `@page` rule.
///
/// Either a name or at least one pseudo class is required.
pub const PageSelector = struct {
    /// An optional named page type.
    name: ?[]const u8,
    /// A list of page pseudo classes.
    pseudo_classes: ArrayList(PagePseudoClass),

    pub fn parse(input: *css.Parser) Result(PageSelector) {
        const name = if (input.tryParse(css.Parser.expectIdent, .{}).asValue()) |name| name else null;
        var pseudo_classes = ArrayList(PagePseudoClass){};

        while (true) {
            // Whitespace is not allowed between pseudo classes
            const state = input.state();
            if (switch (input.nextIncludingWhitespace()) {
                .result => |tok| tok.* == .colon,
                .err => |e| return .{ .err = e },
            }) {
                pseudo_classes.append(
                    input.allocator(),
                    switch (PagePseudoClass.parse(input)) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    },
                ) catch bun.outOfMemory();
            } else {
                input.reset(&state);
                break;
            }
        }

        if (name == null and pseudo_classes.items.len == 0) {
            return .{ .err = input.newCustomError(css.ParserError.invalid_page_selector) };
        }

        return .{
            .result = PageSelector{
                .name = name,
                .pseudo_classes = pseudo_classes,
            },
        };
    }

    const This = @This();

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        if (this.name) |name| {
            try dest.writeStr(name);
        }

        for (this.pseudo_classes.items) |*pseudo| {
            try dest.writeChar(':');
            try pseudo.toCss(W, dest);
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
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
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        try dest.writeChar('@');
        try this.margin_box.toCss(W, dest);
        try this.declarations.toCssBlock(W, dest);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
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

    pub fn parse(selectors: ArrayList(PageSelector), input: *css.Parser, loc: Location, options: *const css.ParserOptions) Result(PageRule) {
        var declarations = css.DeclarationBlock{};
        var rules = ArrayList(PageMarginRule){};
        var rule_parser = PageRuleParser{
            .declarations = &declarations,
            .rules = &rules,
            .options = options,
        };
        var parser = css.RuleBodyParser(PageRuleParser).new(input, &rule_parser);

        while (parser.next()) |decl| {
            if (decl.asErr()) |e| {
                if (parser.parser.options.error_recovery) {
                    parser.parser.options.warn(e);
                    continue;
                }

                return .{ .err = e };
            }
        }

        return .{ .result = PageRule{
            .selectors = selectors,
            .declarations = declarations,
            .rules = rules,
            .loc = loc,
        } };
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

        var i: usize = 0;
        const len = this.declarations.len() + this.rules.items.len;

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
            if (!dest.minify and this.declarations.len() > 0) {
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
        try dest.writeChar('}');
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A page pseudo class within an `@page` selector.
///
/// See [PageSelector](PageSelector).
pub const PagePseudoClass = enum {
    /// The `:left` pseudo class.
    left,
    /// The `:right` pseudo class.
    right,
    /// The `:first` pseudo class.
    first,
    /// The `:last` pseudo class.
    last,
    /// The `:blank` pseudo class.
    blank,

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A [page margin box](https://www.w3.org/TR/css-page-3/#margin-boxes).
pub const PageMarginBox = enum {
    /// A fixed-size box defined by the intersection of the top and left margins of the page box.
    @"top-left-corner",
    /// A variable-width box filling the top page margin between the top-left-corner and top-center page-margin boxes.
    @"top-left",
    /// A variable-width box centered horizontally between the page’s left and right border edges and filling the
    /// page top margin between the top-left and top-right page-margin boxes.
    @"top-center",
    /// A variable-width box filling the top page margin between the top-center and top-right-corner page-margin boxes.
    @"top-right",
    /// A fixed-size box defined by the intersection of the top and right margins of the page box.
    @"top-right-corner",
    /// A variable-height box filling the left page margin between the top-left-corner and left-middle page-margin boxes.
    @"left-top",
    /// A variable-height box centered vertically between the page’s top and bottom border edges and filling the
    /// left page margin between the left-top and left-bottom page-margin boxes.
    @"left-middle",
    /// A variable-height box filling the left page margin between the left-middle and bottom-left-corner page-margin boxes.
    @"left-bottom",
    /// A variable-height box filling the right page margin between the top-right-corner and right-middle page-margin boxes.
    @"right-top",
    /// A variable-height box centered vertically between the page’s top and bottom border edges and filling the right
    /// page margin between the right-top and right-bottom page-margin boxes.
    @"right-middle",
    /// A variable-height box filling the right page margin between the right-middle and bottom-right-corner page-margin boxes.
    @"right-bottom",
    /// A fixed-size box defined by the intersection of the bottom and left margins of the page box.
    @"bottom-left-corner",
    /// A variable-width box filling the bottom page margin between the bottom-left-corner and bottom-center page-margin boxes.
    @"bottom-left",
    /// A variable-width box centered horizontally between the page’s left and right border edges and filling the bottom
    /// page margin between the bottom-left and bottom-right page-margin boxes.
    @"bottom-center",
    /// A variable-width box filling the bottom page margin between the bottom-center and bottom-right-corner page-margin boxes.
    @"bottom-right",
    /// A fixed-size box defined by the intersection of the bottom and right margins of the page box.
    @"bottom-right-corner",

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), comptime W: type, dest: *Printer(W)) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, W, dest);
    }
};

pub const PageRuleParser = struct {
    declarations: *css.DeclarationBlock,
    rules: *ArrayList(PageMarginRule),
    options: *const css.ParserOptions,

    const This = @This();

    pub const DeclarationParser = struct {
        pub const Declaration = void;

        pub fn parseValue(this: *This, name: []const u8, input: *css.Parser) Result(Declaration) {
            return css.declaration.parse_declaration(
                name,
                input,
                &this.declarations.declarations,
                &this.declarations.important_declarations,
                this.options,
            );
        }
    };

    pub const RuleBodyItemParser = struct {
        pub fn parseQualified(_: *This) bool {
            return false;
        }

        pub fn parseDeclarations(_: *This) bool {
            return true;
        }
    };

    pub const AtRuleParser = struct {
        pub const Prelude = PageMarginBox;
        pub const AtRule = void;

        pub fn parsePrelude(_: *This, name: []const u8, input: *css.Parser) Result(Prelude) {
            const loc = input.currentSourceLocation();
            return switch (css.parse_utility.parseString(
                input.allocator(),
                PageMarginBox,
                name,
                PageMarginBox.parse,
            )) {
                .result => |v| return .{ .result = v },
                .err => {
                    return .{ .err = loc.newCustomError(css.ParserError{ .at_rule_invalid = name }) };
                },
            };
        }

        pub fn parseBlock(this: *This, prelude: AtRuleParser.Prelude, start: *const css.ParserState, input: *css.Parser) Result(AtRuleParser.AtRule) {
            const loc = start.sourceLocation();
            const declarations = switch (css.DeclarationBlock.parse(input, this.options)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
            this.rules.append(input.allocator(), PageMarginRule{
                .margin_box = prelude,
                .declarations = declarations,
                .loc = Location{
                    .source_index = this.options.source_index,
                    .line = loc.line,
                    .column = loc.column,
                },
            }) catch bun.outOfMemory();
            return Result(AtRuleParser.AtRule).success;
        }

        pub fn ruleWithoutBlock(_: *This, _: AtRuleParser.Prelude, _: *const css.ParserState) css.Maybe(AtRuleParser.AtRule, void) {
            return .{ .err = {} };
        }
    };

    pub const QualifiedRuleParser = struct {
        pub const Prelude = void;
        pub const QualifiedRule = void;

        pub fn parsePrelude(_: *This, input: *css.Parser) Result(Prelude) {
            return .{ .err = input.newError(css.BasicParseErrorKind.qualified_rule_invalid) };
        }

        pub fn parseBlock(_: *This, _: Prelude, _: *const css.ParserState, input: *css.Parser) Result(QualifiedRule) {
            return .{ .err = input.newError(css.BasicParseErrorKind.qualified_rule_invalid) };
        }
    };
};
