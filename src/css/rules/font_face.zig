pub const css = @import("../css_parser.zig");
const Printer = css.Printer;
const Maybe = css.Maybe;
const PrintErr = css.PrintErr;
const Url = css.css_values.url.Url;
const Size2D = css.css_values.size.Size2D;
const fontprops = css.css_properties.font;
const Location = css.css_rules.Location;
const Angle = css.css_values.angle.Angle;
const FontStyleProperty = css.css_properties.font.FontStyle;
const FontFamily = css.css_properties.font.FontFamily;
const FontWeight = css.css_properties.font.FontWeight;
const FontStretch = css.css_properties.font.FontStretch;
const CustomProperty = css.css_properties.custom.CustomProperty;
const CustomPropertyName = css.css_properties.custom.CustomPropertyName;
const Result = css.Result;

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

    const This = @This();

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        const Helpers = struct {
            pub fn writeProperty(
                d: *Printer,
                comptime prop: []const u8,
                value: anytype,
                comptime multi: bool,
            ) PrintErr!void {
                try d.writeStr(prop);
                try d.delim(':', false);
                if (comptime multi) {
                    const len = value.items.len;
                    for (value.items, 0..) |*val, idx| {
                        try val.toCss(d);
                        if (idx < len - 1) {
                            try d.delim(',', false);
                        }
                    }
                } else {
                    try value.toCss(d);
                }
            }
        };
        return switch (this.*) {
            .source => |value| Helpers.writeProperty(dest, "src", value, true),
            .font_family => |value| Helpers.writeProperty(dest, "font-family", value, false),
            .font_style => |value| Helpers.writeProperty(dest, "font-style", value, false),
            .font_weight => |value| Helpers.writeProperty(dest, "font-weight", value, false),
            .font_stretch => |value| Helpers.writeProperty(dest, "font-stretch", value, false),
            .unicode_range => |value| Helpers.writeProperty(dest, "unicode-range", value, true),
            .custom => |custom| {
                try dest.writeStr(this.custom.name.asStr());
                try dest.delim(':', false);
                return custom.value.toCss(dest, true);
            },
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
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

    pub fn toCss(this: *const UnicodeRange, dest: *Printer) PrintErr!void {
        // Attempt to optimize the range to use question mark syntax.
        if (this.start != this.end) {
            // Find the first hex digit that differs between the start and end values.
            var shift: u5 = 24;
            var mask: u32 = @as(u32, 0xf) << shift;
            while (shift > 0) {
                const c1 = this.start & mask;
                const c2 = this.end & mask;
                if (c1 != c2) {
                    break;
                }

                mask = mask >> 4;
                shift -= 4;
            }

            // Get the remainder of the value. This must be 0x0 to 0xf for the rest
            // of the value to use the question mark syntax.
            shift += 4;
            const remainder_mask: u32 = (@as(u32, 1) << shift) - @as(u32, 1);
            const start_remainder = this.start & remainder_mask;
            const end_remainder = this.end & remainder_mask;

            if (start_remainder == 0 and end_remainder == remainder_mask) {
                const start = (this.start & ~remainder_mask) >> shift;
                if (start != 0) {
                    try dest.writeFmt("U+{x}", .{start});
                } else {
                    try dest.writeStr("U+");
                }

                while (shift > 0) {
                    try dest.writeChar('?');
                    shift -= 4;
                }

                return;
            }
        }

        try dest.writeFmt("U+{x}", .{this.start});
        if (this.end != this.start) {
            try dest.writeFmt("-{x}", .{this.end});
        }
    }

    /// https://drafts.csswg.org/css-syntax/#urange-syntax
    pub fn parse(input: *css.Parser) Result(UnicodeRange) {
        // <urange> =
        //   u '+' <ident-token> '?'* |
        //   u <dimension-token> '?'* |
        //   u <number-token> '?'* |
        //   u <number-token> <dimension-token> |
        //   u <number-token> <number-token> |
        //   u '+' '?'+

        if (input.expectIdentMatching("u").asErr()) |e| return .{ .err = e };
        const after_u = input.position();
        if (parseTokens(input).asErr()) |e| return .{ .err = e };

        // This deviates from the spec in case there are CSS comments
        // between tokens in the middle of one <unicode-range>,
        // but oh well…
        const concatenated_tokens = input.sliceFrom(after_u);

        const range = if (parseConcatenated(concatenated_tokens).asValue()) |range|
            range
        else
            return .{ .err = input.newBasicUnexpectedTokenError(.{ .ident = concatenated_tokens }) };

        if (range.end > 0x10FFFF or range.start > range.end) {
            return .{ .err = input.newBasicUnexpectedTokenError(.{ .ident = concatenated_tokens }) };
        }

        return .{ .result = range };
    }

    fn parseTokens(input: *css.Parser) Result(void) {
        const tok = switch (input.nextIncludingWhitespace()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        switch (tok.*) {
            .dimension => return parseQuestionMarks(input),
            .number => {
                const after_number = input.state();
                const token = switch (input.nextIncludingWhitespace()) {
                    .result => |vv| vv,
                    .err => {
                        input.reset(&after_number);
                        return .success;
                    },
                };

                if (token.* == .delim and token.delim == '?') return parseQuestionMarks(input);
                if (token.* == .delim or token.* == .number) return .success;
                return .success;
            },
            .delim => |c| {
                if (c == '+') {
                    const next = switch (input.nextIncludingWhitespace()) {
                        .result => |vv| vv,
                        .err => |e| return .{ .err = e },
                    };
                    if (!(next.* == .ident or (next.* == .delim and next.delim == '?'))) {
                        return .{ .err = input.newBasicUnexpectedTokenError(next.*) };
                    }
                    return parseQuestionMarks(input);
                }
            },
            else => {},
        }
        return .{ .err = input.newBasicUnexpectedTokenError(tok.*) };
    }

    /// Consume as many '?' as possible
    fn parseQuestionMarks(input: *css.Parser) Result(void) {
        while (true) {
            const start = input.state();
            if (input.nextIncludingWhitespace().asValue()) |tok| if (tok.* == .delim and tok.delim == '?') continue;
            input.reset(&start);
            return .success;
        }
    }

    fn parseConcatenated(_text: []const u8) css.Maybe(UnicodeRange, void) {
        var text = if (_text.len > 0 and _text[0] == '+') _text[1..] else {
            return .{ .err = {} };
        };
        const first_hex_value, const hex_digit_count = consumeHex(&text);
        const question_marks = consumeQuestionMarks(&text);
        const consumed = hex_digit_count + question_marks;

        if (consumed == 0 or consumed > 6) {
            return .{ .err = {} };
        }

        if (question_marks > 0) {
            if (text.len == 0) return .{ .result = UnicodeRange{
                .start = first_hex_value << @intCast(question_marks * 4),
                .end = ((first_hex_value + 1) << @intCast(question_marks * 4)) - 1,
            } };
        } else if (text.len == 0) {
            return .{ .result = UnicodeRange{
                .start = first_hex_value,
                .end = first_hex_value,
            } };
        } else {
            if (text.len > 0 and text[0] == '-') {
                text = text[1..];
                const second_hex_value, const hex_digit_count2 = consumeHex(&text);
                if (hex_digit_count2 > 0 and hex_digit_count2 <= 6 and text.len == 0) {
                    return .{ .result = UnicodeRange{
                        .start = first_hex_value,
                        .end = second_hex_value,
                    } };
                }
            }
        }
        return .{ .err = {} };
    }

    fn consumeQuestionMarks(text: *[]const u8) usize {
        var question_marks: usize = 0;
        while (bun.strings.splitFirstWithExpected(text.*, '?')) |rest| {
            question_marks += 1;
            text.* = rest;
        }
        return question_marks;
    }

    fn consumeHex(text: *[]const u8) struct { u32, usize } {
        var value: u32 = 0;
        var digits: usize = 0;
        while (bun.strings.splitFirst(text.*)) |result| {
            if (toHexDigit(result.first)) |digit_value| {
                value = value * 0x10 + digit_value;
                digits += 1;
                text.* = result.rest;
            } else {
                break;
            }
        }
        return .{ value, digits };
    }

    fn toHexDigit(b: u8) ?u32 {
        var digit = @as(u32, b) -% @as(u32, '0');
        if (digit < 10) return digit;
        // Force the 6th bit to be set to ensure ascii is lower case.
        // digit = (@as(u32, b) | 0b10_0000).wrapping_sub('a' as u32).saturating_add(10);
        digit = (@as(u32, b) | 0b10_0000) -% (@as(u32, 'a') +% 10);
        return if (digit < 16) digit else null;
    }
};

pub const FontStyle = union(enum) {
    /// Normal font style.
    normal,

    /// Italic font style.
    italic,

    /// Oblique font style, with a custom angle.
    oblique: Size2D(css.css_values.angle.Angle),

    pub fn parse(input: *css.Parser) Result(FontStyle) {
        const property = switch (FontStyleProperty.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{
            .result = switch (property) {
                .normal => .normal,
                .italic => .italic,
                .oblique => |angle| {
                    const second_angle = if (input.tryParse(css.css_values.angle.Angle.parse, .{}).asValue()) |a| a else angle;
                    return .{ .result = .{
                        .oblique = .{ .a = angle, .b = second_angle },
                    } };
                },
            },
        };
    }

    pub fn toCss(this: *const FontStyle, dest: *Printer) PrintErr!void {
        switch (this.*) {
            .normal => try dest.writeStr("normal"),
            .italic => try dest.writeStr("italic"),
            .oblique => |angle| {
                try dest.writeStr("oblique");
                if (!angle.eql(&FontStyle.defaultObliqueAngle())) {
                    try dest.writeChar(' ');
                    try angle.toCss(dest);
                }
            },
        }
    }

    fn defaultObliqueAngle() Size2D(Angle) {
        return Size2D(Angle){
            .a = FontStyleProperty.defaultObliqueAngle(),
            .b = FontStyleProperty.defaultObliqueAngle(),
        };
    }
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

    pub fn parse(input: *css.Parser) Result(FontFormat) {
        const s = switch (input.expectIdentOrString()) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };

        if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("woff", s)) {
            return .{ .result = .woff };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("woff2", s)) {
            return .{ .result = .woff2 };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("truetype", s)) {
            return .{ .result = .truetype };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("opentype", s)) {
            return .{ .result = .opentype };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("embedded-opentype", s)) {
            return .{ .result = .embedded_opentype };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("collection", s)) {
            return .{ .result = .collection };
        } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength("svg", s)) {
            return .{ .result = .svg };
        } else {
            return .{ .result = .{ .string = s } };
        }
    }

    pub fn toCss(this: *const FontFormat, dest: *Printer) PrintErr!void {
        // Browser support for keywords rather than strings is very limited.
        // https://developer.mozilla.org/en-US/docs/Web/CSS/@font-face/src
        switch (this.*) {
            .woff => try dest.writeStr("woff"),
            .woff2 => try dest.writeStr("woff2"),
            .truetype => try dest.writeStr("truetype"),
            .opentype => try dest.writeStr("opentype"),
            .embedded_opentype => try dest.writeStr("embedded-opentype"),
            .collection => try dest.writeStr("collection"),
            .svg => try dest.writeStr("svg"),
            .string => try dest.writeStr(this.string),
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [src](https://drafts.csswg.org/css-fonts/#src-desc)
/// property in an `@font-face` rule.
pub const Source = union(enum) {
    /// A `url()` with optional format metadata.
    url: UrlSource,

    /// The `local()` function.
    local: fontprops.FontFamily,

    pub fn parse(input: *css.Parser) Result(Source) {
        switch (input.tryParse(UrlSource.parse, .{})) {
            .result => |url| .{ .result = return .{ .result = .{ .url = url } } },
            .err => |e| {
                if (e.kind == .basic and e.kind.basic == .at_rule_body_invalid) {
                    return .{ .err = e };
                }
            },
        }

        if (input.expectFunctionMatching("local").asErr()) |e| return .{ .err = e };

        const Fn = struct {
            pub fn parseNestedBlock(_: void, i: *css.Parser) Result(fontprops.FontFamily) {
                return fontprops.FontFamily.parse(i);
            }
        };
        const local = switch (input.parseNestedBlock(fontprops.FontFamily, {}, Fn.parseNestedBlock)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = .{ .local = local } };
    }

    pub fn toCss(this: *const Source, dest: *Printer) PrintErr!void {
        switch (this.*) {
            .url => try this.url.toCss(dest),
            .local => {
                try dest.writeStr("local(");
                try this.local.toCss(dest);
                try dest.writeChar(')');
            },
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
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

    pub fn asStr(this: *const @This()) []const u8 {
        return css.enum_property_util.asStr(@This(), this);
    }

    pub fn parse(input: *css.Parser) Result(@This()) {
        return css.enum_property_util.parse(@This(), input);
    }

    pub fn toCss(this: *const @This(), dest: *Printer) PrintErr!void {
        return css.enum_property_util.toCss(@This(), this, dest);
    }
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

    pub fn parse(input: *css.Parser) Result(UrlSource) {
        const url = switch (Url.parse(input)) {
            .result => |vv| vv,
            .err => |e| return .{ .err = e },
        };

        const format = if (input.tryParse(css.Parser.expectFunctionMatching, .{"format"}).isOk()) format: {
            switch (input.parseNestedBlock(FontFormat, {}, css.voidWrap(FontFormat, FontFormat.parse))) {
                .result => |vv| break :format vv,
                .err => |e| return .{ .err = e },
            }
        } else null;

        const tech = if (input.tryParse(css.Parser.expectFunctionMatching, .{"tech"}).isOk()) tech: {
            const Fn = struct {
                pub fn parseNestedBlockFn(_: void, i: *css.Parser) Result(ArrayList(FontTechnology)) {
                    return i.parseList(FontTechnology, FontTechnology.parse);
                }
            };
            break :tech switch (input.parseNestedBlock(ArrayList(FontTechnology), {}, Fn.parseNestedBlockFn)) {
                .result => |vv| vv,
                .err => |e| return .{ .err = e },
            };
        } else ArrayList(FontTechnology){};

        return .{
            .result = UrlSource{ .url = url, .format = format, .tech = tech },
        };
    }

    pub fn toCss(this: *const UrlSource, dest: *Printer) PrintErr!void {
        try this.url.toCss(dest);
        if (this.format) |*format| {
            try dest.whitespace();
            try dest.writeStr("format(");
            try format.toCss(dest);
            try dest.writeChar(')');
        }

        if (this.tech.items.len != 0) {
            try dest.whitespace();
            try dest.writeStr("tech(");
            try css.to_css.fromList(FontTechnology, this.tech.items, dest);
            try dest.writeChar(')');
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A [@font-face](https://drafts.csswg.org/css-fonts/#font-face-rule) rule.
pub const FontFaceRule = struct {
    /// Declarations in the `@font-face` rule.
    properties: ArrayList(FontFaceProperty),
    /// The location of the rule in the source file.
    loc: Location,

    const This = @This();

    pub fn toCss(this: *const This, dest: *Printer) PrintErr!void {
        // #[cfg(feature = "sourcemap")]
        // dest.add_mapping(self.loc);

        try dest.writeStr("@font-face");
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

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) This {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

pub const FontFaceDeclarationParser = struct {
    const This = @This();

    pub const AtRuleParser = struct {
        pub const Prelude = void;
        pub const AtRule = FontFaceProperty;

        pub fn parsePrelude(_: *This, name: []const u8, input: *css.Parser) Result(Prelude) {
            return .{
                .err = input.newError(css.BasicParseErrorKind{ .at_rule_invalid = name }),
            };
        }

        pub fn parseBlock(_: *This, _: Prelude, _: *const css.ParserState, input: *css.Parser) Result(AtRule) {
            return .{ .err = input.newError(css.BasicParseErrorKind{ .at_rule_body_invalid = {} }) };
        }

        pub fn ruleWithoutBlock(_: *This, _: Prelude, _: *const css.ParserState) css.Maybe(AtRule, void) {
            return .{ .err = {} };
        }
    };

    pub const QualifiedRuleParser = struct {
        pub const Prelude = void;
        pub const QualifiedRule = FontFaceProperty;

        pub fn parsePrelude(_: *This, input: *css.Parser) Result(Prelude) {
            return .{ .err = input.newError(css.BasicParseErrorKind{ .qualified_rule_invalid = {} }) };
        }

        pub fn parseBlock(_: *This, _: Prelude, _: *const css.ParserState, input: *css.Parser) Result(QualifiedRule) {
            return .{ .err = input.newError(css.BasicParseErrorKind.qualified_rule_invalid) };
        }
    };

    pub const DeclarationParser = struct {
        pub const Declaration = FontFaceProperty;

        pub fn parseValue(this: *This, name: []const u8, input: *css.Parser) Result(Declaration) {
            _ = this; // autofix
            const state = input.state();
            // todo_stuff.match_ignore_ascii_case
            if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "src")) {
                if (input.parseCommaSeparated(Source, Source.parse).asValue()) |sources| {
                    return .{ .result = .{ .source = sources } };
                }
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "font-family")) {
                if (FontFamily.parse(input).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .font_family = c } };
                    }
                }
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "font-weight")) {
                if (Size2D(FontWeight).parse(input).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .font_weight = c } };
                    }
                }
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "font-style")) {
                if (FontStyle.parse(input).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .font_style = c } };
                    }
                }
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "font-stretch")) {
                if (Size2D(FontStretch).parse(input).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .font_stretch = c } };
                    }
                }
            } else if (bun.strings.eqlCaseInsensitiveASCIIICheckLength(name, "unicode-renage")) {
                if (input.parseList(UnicodeRange, UnicodeRange.parse).asValue()) |c| {
                    if (input.expectExhausted().isOk()) {
                        return .{ .result = .{ .unicode_range = c } };
                    }
                }
            } else {
                //
            }

            input.reset(&state);
            const opts = css.ParserOptions.default(input.allocator(), null);
            return .{
                .result = .{
                    .custom = switch (CustomProperty.parse(CustomPropertyName.fromStr(name), input, &opts)) {
                        .result => |v| v,
                        .err => |e| return .{ .err = e },
                    },
                },
            };
        }
    };

    pub const RuleBodyItemParser = struct {
        pub fn parseQualified(this: *This) bool {
            _ = this; // autofix
            return false;
        }

        pub fn parseDeclarations(this: *This) bool {
            _ = this; // autofix
            return true;
        }
    };
};

const bun = @import("bun");

const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;
