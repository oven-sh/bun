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
const CustomProperty = css.css_properties.custom.CustomProperty;
const CustomPropertyName = css.css_properties.custom.CustomPropertyName;
const DashedIdent = css.css_values.ident.DashedIdent;
const FontFamily = css.css_properties.font.FontFamily;

/// A [@font-palette-values](https://drafts.csswg.org/css-fonts-4/#font-palette-values) rule.
pub const FontPaletteValuesRule = struct {
    /// The name of the font palette.
    name: css.css_values.ident.DashedIdent,
    /// Declarations in the `@font-palette-values` rule.
    properties: ArrayList(FontPaletteValuesProperty),
    /// The location of the rule in the source file.
    loc: Location,

    const This = @This();

    pub fn parse(name: DashedIdent, input: *css.Parser, loc: Location) Result(FontPaletteValuesRule) {
        var decl_parser = FontPaletteValuesDeclarationParser{};
        var parser = css.RuleBodyParser(FontPaletteValuesDeclarationParser).new(input, &decl_parser);
        var properties = ArrayList(FontPaletteValuesProperty){};
        while (parser.next()) |result| {
            if (result.asValue()) |decl| {
                properties.append(
                    input.allocator(),
                    decl,
                ) catch unreachable;
            }
        }

        return .{ .result = FontPaletteValuesRule{
            .name = name,
            .properties = properties,
            .loc = loc,
        } };
    }

    pub fn toCss(this: *const This, comptime W: type, dest: *Printer(W)) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        try dest.writeStr("@font-palette-values ");
        try css.css_values.ident.DashedIdentFns.toCss(&this.name, W, dest);
        try dest.whitespace();
        try dest.writeChar('{');
        dest.indent();
        const len = this.properties.items.len;
        for (this.properties.items, 0..) |*prop, i| {
            try dest.newline();
            try prop.toCss(W, dest);
            if (i != len - 1 or !dest.minify) {
                try dest.writeChar(';');
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

pub const FontPaletteValuesProperty = union(enum) {
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
        switch (this.*) {
            .font_family => |*f| {
                try dest.writeStr("font-family");
                try dest.delim(':', false);
                try f.toCss(W, dest);
            },
            .base_palette => |*b| {
                try dest.writeStr("base-palette");
                try dest.delim(':', false);
                try b.toCss(W, dest);
            },
            .override_colors => |*o| {
                try dest.writeStr("override-colors");
                try dest.delim(':', false);
                try css.to_css.fromList(OverrideColors, o.items, W, dest);
            },
            .custom => |*custom| {
                try dest.writeStr(custom.name.asStr());
                try dest.delim(':', false);
                try custom.value.toCss(W, dest, true);
            },
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [override-colors](https://drafts.csswg.org/css-fonts-4/#override-color)
/// property in an `@font-palette-values` rule.
pub const OverrideColors = struct {
    /// The index of the color within the palette to override.
    index: u16,

    /// The replacement color.
    color: css.css_values.color.CssColor,

    pub fn parse(input: *css.Parser) Result(OverrideColors) {
        const index = switch (css.CSSIntegerFns.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        if (index < 0) return .{ .err = input.newCustomError(css.ParserError.invalid_value) };

        const color = switch (css.CssColor.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        if (color == .current_color) return .{ .err = input.newCustomError(css.ParserError.invalid_value) };

        return .{
            .result = OverrideColors{
                .index = @intCast(index),
                .color = color,
            },
        };
    }

    pub fn toCss(this: *const OverrideColors, comptime W: type, dest: *Printer(W)) PrintErr!void {
        try css.CSSIntegerFns.toCss(&@as(i32, @intCast(this.index)), W, dest);
        try dest.writeChar(' ');
        try this.color.toCss(W, dest);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
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

    pub fn parse(input: *css.Parser) Result(BasePalette) {
        if (input.tryParse(css.CSSIntegerFns.parse, .{}).asValue()) |i| {
            if (i < 0) return .{ .err = input.newCustomError(css.ParserError.invalid_value) };
            return .{ .result = .{ .integer = @intCast(i) } };
        }

        const location = input.currentSourceLocation();
        const ident = switch (input.expectIdent()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("light", ident)) {
            return .{ .result = .light };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("dark", ident)) {
            return .{ .result = .dark };
        } else return .{ .err = location.newUnexpectedTokenError(.{ .ident = ident }) };
    }

    pub fn toCss(this: *const BasePalette, comptime W: type, dest: *Printer(W)) PrintErr!void {
        switch (this.*) {
            .light => try dest.writeStr("light"),
            .dark => try dest.writeStr("dark"),
            .integer => try css.CSSIntegerFns.toCss(&@as(i32, @intCast(this.integer)), W, dest),
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const FontPaletteValuesDeclarationParser = struct {
    const This = @This();

    pub const DeclarationParser = struct {
        pub const Declaration = FontPaletteValuesProperty;

        pub fn parseValue(this: *This, name: []const u8, input: *css.Parser) Result(Declaration) {
            _ = this; // autofix
            const state = input.state();
            // todo_stuff.match_ignore_ascii_case
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("font-family", name)) {
                // https://drafts.csswg.org/css-fonts-4/#font-family-2-desc
                if (FontFamily.parse(input).asValue()) |font_family| {
                    if (font_family == .generic) {
                        return .{ .err = input.newCustomError(css.ParserError.invalid_declaration) };
                    }
                    return .{ .result = .{ .font_family = font_family } };
                }
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("base-palette", name)) {
                // https://drafts.csswg.org/css-fonts-4/#base-palette-desc
                if (BasePalette.parse(input).asValue()) |base_palette| {
                    return .{ .result = .{ .base_palette = base_palette } };
                }
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("override-colors", name)) {
                // https://drafts.csswg.org/css-fonts-4/#override-color
                if (input.parseCommaSeparated(OverrideColors, OverrideColors.parse).asValue()) |override_colors| {
                    return .{ .result = .{ .override_colors = override_colors } };
                }
            } else {
                return .{ .err = input.newCustomError(css.ParserError.invalid_declaration) };
            }

            input.reset(&state);
            const opts = css.ParserOptions.default(input.allocator(), null);
            return .{ .result = .{
                .custom = switch (CustomProperty.parse(
                    CustomPropertyName.fromStr(name),
                    input,
                    &opts,
                )) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                },
            } };
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
        pub const Prelude = void;
        pub const AtRule = FontPaletteValuesProperty;

        pub fn parsePrelude(_: *This, name: []const u8, input: *css.Parser) Result(Prelude) {
            return .{ .err = input.newError(css.BasicParseErrorKind{ .at_rule_invalid = name }) };
        }

        pub fn parseBlock(_: *This, _: AtRuleParser.Prelude, _: *const css.ParserState, input: *css.Parser) Result(AtRuleParser.AtRule) {
            return .{ .err = input.newError(css.BasicParseErrorKind.at_rule_body_invalid) };
        }

        pub fn ruleWithoutBlock(_: *This, _: AtRuleParser.Prelude, _: *const css.ParserState) css.Maybe(AtRuleParser.AtRule, void) {
            return .{ .err = {} };
        }
    };

    pub const QualifiedRuleParser = struct {
        pub const Prelude = void;
        pub const QualifiedRule = FontPaletteValuesProperty;

        pub fn parsePrelude(_: *This, input: *css.Parser) Result(Prelude) {
            return .{ .err = input.newError(css.BasicParseErrorKind.qualified_rule_invalid) };
        }

        pub fn parseBlock(_: *This, _: Prelude, _: *const css.ParserState, input: *css.Parser) Result(QualifiedRule) {
            return .{ .err = input.newError(css.BasicParseErrorKind.qualified_rule_invalid) };
        }
    };
};
