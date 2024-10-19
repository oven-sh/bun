const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const Error = css.Error;

const ContainerName = css.css_rules.container.ContainerName;

const LengthPercentage = css.css_values.length.LengthPercentage;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const CSSNumber = css.css_values.number.CSSNumber;
const LengthPercentageOrAuto = css.css_values.length.LengthPercentageOrAuto;
const Size2D = css.css_values.size.Size2D;
const DashedIdent = css.css_values.ident.DashedIdent;
const Image = css.css_values.image.Image;
const CssColor = css.css_values.color.CssColor;
const Ratio = css.css_values.ratio.Ratio;
const Length = css.css_values.length.LengthValue;
const Rect = css.css_values.rect.Rect;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const CustomIdentList = css.css_values.ident.CustomIdentList;
const Angle = css.css_values.angle.Angle;
const Url = css.css_values.url.Url;

const GenericBorder = css.css_properties.border.GenericBorder;
const LineStyle = css.css_properties.border.LineStyle;

pub const BoxSizing = enum {
    /// Exclude the margin/border/padding from the width and height.
    @"content-box",
    /// Include the padding and border (but not the margin) in the width and height.
    @"border-box",
    pub usingnamespace css.DefineEnumProperty(@This());
};

pub const Size = union(enum) {
    /// The `auto` keyworda
    auto,
    /// An explicit length or percentage.
    length_percentage: LengthPercentage,
    /// The `min-content` keyword.
    min_content: css.VendorPrefix,
    /// The `max-content` keyword.
    max_content: css.VendorPrefix,
    /// The `fit-content` keyword.
    fit_content: css.VendorPrefix,
    /// The `fit-content()` function.
    fit_content_function: LengthPercentage,
    /// The `stretch` keyword, or the `-webkit-fill-available` or `-moz-available` prefixed keywords.
    stretch: css.VendorPrefix,
    /// The `contain` keyword.
    contain,

    pub fn parse(input: *css.Parser) css.Result(Size) {
        const Enum = enum {
            auto,
            min_content,
            @"-webkit-min-content",
            @"-moz-min-content",
            max_content,
            @"-webkit-max-content",
            @"-moz-max-content",
            stretch,
            @"-webkit-fill-available",
            @"-moz-available",
            fit_content,
            @"-webkit-fit-content",
            @"-moz-fit-content",
            contain,
        };
        const Map = comptime bun.ComptimeEnumMap(Enum);
        const res = input.tryParse(struct {
            pub fn parseFn(i: *css.Parser) css.Result(Size) {
                const ident = switch (i.expectIdent()) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                };

                if (Map.get(ident)) |res| {
                    return .{ .result = switch (res) {
                        .auto => .auto,
                        .min_content => .{ .min_content = css.VendorPrefix{ .none = true } },
                        .@"-webkit-min-content" => .{ .min_content = css.VendorPrefix{ .webkit = true } },
                        .@"-moz-min-content" => .{ .min_content = css.VendorPrefix{ .moz = true } },
                        .max_content => .{ .max_content = css.VendorPrefix{ .none = true } },
                        .@"-webkit-max-content" => .{ .max_content = css.VendorPrefix{ .webkit = true } },
                        .@"-moz-max-content" => .{ .max_content = css.VendorPrefix{ .moz = true } },
                        .stretch => .{ .stretch = css.VendorPrefix{ .none = true } },
                        .@"-webkit-fill-available" => .{ .stretch = css.VendorPrefix{ .webkit = true } },
                        .@"-moz-available" => .{ .stretch = css.VendorPrefix{ .moz = true } },
                        .fit_content => .{ .fit_content = css.VendorPrefix{ .none = true } },
                        .@"-webkit-fit-content" => .{ .fit_content = css.VendorPrefix{ .webkit = true } },
                        .@"-moz-fit-content" => .{ .fit_content = css.VendorPrefix{ .moz = true } },
                        .contain => .contain,
                    } };
                } else return .{ .err = i.newCustomError(css.ParserError.invalid_value) };
            }
        }.parseFn, .{});

        if (res == .result) return res;

        if (input.tryParse(parseFitContent, .{}).asValue()) |v| {
            return .{ .result = Size{ .fit_content_function = v } };
        }

        const lp = switch (input.tryParse(LengthPercentage.parse, .{})) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        return .{ .result = Size{ .length_percentage = lp } };
    }

    pub fn toCss(this: *const Size, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        return switch (this.*) {
            .auto => dest.writeStr("auto"),
            .contain => dest.writeStr("contain"),
            .min_content => |vp| {
                try vp.toCss(W, dest);
                try dest.writeStr("min-content");
            },
            .max_content => |vp| {
                try vp.toCss(W, dest);
                try dest.writeStr("max-content");
            },
            .fit_content => |vp| {
                try vp.toCss(W, dest);
                try dest.writeStr("fit-content");
            },
            .stretch => |vp| {
                if (vp.eql(css.VendorPrefix{ .none = true })) {
                    try dest.writeStr("stretch");
                } else if (vp.eql(css.VendorPrefix{ .webkit = true })) {
                    try dest.writeStr("-webkit-fill-available");
                } else if (vp.eql(css.VendorPrefix{ .moz = true })) {
                    try dest.writeStr("-moz-available");
                } else {
                    bun.unreachablePanic("Unexpected vendor prefixes", .{});
                }
            },
            .fit_content_function => |l| {
                try dest.writeStr("fit-content(");
                try l.toCss(W, dest);
                try dest.writeChar(')');
            },
            .length_percentage => |l| return l.toCss(W, dest),
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [minimum](https://drafts.csswg.org/css-sizing-3/#min-size-properties)
/// and [maximum](https://drafts.csswg.org/css-sizing-3/#max-size-properties) size properties,
/// e.g. `min-width` and `max-height`.
pub const MaxSize = union(enum) {
    /// The `none` keyword.
    none,
    /// An explicit length or percentage.
    length_percentage: LengthPercentage,
    /// The `min-content` keyword.
    min_content: css.VendorPrefix,
    /// The `max-content` keyword.
    max_content: css.VendorPrefix,
    /// The `fit-content` keyword.
    fit_content: css.VendorPrefix,
    /// The `fit-content()` function.
    fit_content_function: LengthPercentage,
    /// The `stretch` keyword, or the `-webkit-fill-available` or `-moz-available` prefixed keywords.
    stretch: css.VendorPrefix,
    /// The `contain` keyword.
    contain,

    pub fn parse(input: *css.Parser) css.Result(MaxSize) {
        const Ident = enum {
            none,
            min_content,
            webkit_min_content,
            moz_min_content,
            max_content,
            webkit_max_content,
            moz_max_content,
            stretch,
            webkit_fill_available,
            moz_available,
            fit_content,
            webkit_fit_content,
            moz_fit_content,
            contain,
        };

        const IdentMap = bun.ComptimeStringMap(Ident, .{
            .{ "none", .none },
            .{ "min-content", .min_content },
            .{ "-webkit-min-content", .webkit_min_content },
            .{ "-moz-min-content", .moz_min_content },
            .{ "max-content", .max_content },
            .{ "-webkit-max-content", .webkit_max_content },
            .{ "-moz-max-content", .moz_max_content },
            .{ "stretch", .stretch },
            .{ "-webkit-fill-available", .webkit_fill_available },
            .{ "-moz-available", .moz_available },
            .{ "fit-content", .fit_content },
            .{ "-webkit-fit-content", .webkit_fit_content },
            .{ "-moz-fit-content", .moz_fit_content },
            .{ "contain", .contain },
        });

        const res = input.tryParse(struct {
            fn parse(i: *css.Parser) css.Result(MaxSize) {
                const ident = switch (i.expectIdent()) {
                    .result => |v| v,
                    .err => |e| return .{ .err = e },
                };
                const mapped = IdentMap.get(ident) orelse return .{ .err = i.newCustomError(css.ParserError.invalid_value) };
                return .{ .result = switch (mapped) {
                    .none => .none,
                    .min_content => .{ .min_content = .{ .none = true } },
                    .webkit_min_content => .{ .min_content = .{ .webkit = true } },
                    .moz_min_content => .{ .min_content = .{ .moz = true } },
                    .max_content => .{ .max_content = .{ .none = true } },
                    .webkit_max_content => .{ .max_content = .{ .webkit = true } },
                    .moz_max_content => .{ .max_content = .{ .moz = true } },
                    .stretch => .{ .stretch = .{ .none = true } },
                    .webkit_fill_available => .{ .stretch = .{ .webkit = true } },
                    .moz_available => .{ .stretch = .{ .moz = true } },
                    .fit_content => .{ .fit_content = .{ .none = true } },
                    .webkit_fit_content => .{ .fit_content = .{ .webkit = true } },
                    .moz_fit_content => .{ .fit_content = .{ .moz = true } },
                    .contain => .contain,
                } };
            }
        }.parse, .{});

        if (res.isOk()) {
            return res;
        }

        if (parseFitContent(input).asValue()) |v| {
            return .{ .result = .{ .fit_content_function = v } };
        }

        return switch (LengthPercentage.parse(input)) {
            .result => |v| .{ .result = .{ .length_percentage = v } },
            .err => |e| .{ .err = e },
        };
    }

    pub fn toCss(this: *const MaxSize, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        switch (this.*) {
            .none => try dest.writeStr("none"),
            .contain => try dest.writeStr("contain"),
            .min_content => |vp| {
                try vp.toCss(W, dest);
                try dest.writeStr("min-content");
            },
            .max_content => |vp| {
                try vp.toCss(W, dest);
                try dest.writeStr("max-content");
            },
            .fit_content => |vp| {
                try vp.toCss(W, dest);
                try dest.writeStr("fit-content");
            },
            .stretch => |vp| {
                if (css.VendorPrefix.eql(vp, css.VendorPrefix{ .none = true })) {
                    try dest.writeStr("stretch");
                } else if (css.VendorPrefix.eql(vp, css.VendorPrefix{ .webkit = true })) {
                    try dest.writeStr("-webkit-fill-available");
                } else if (css.VendorPrefix.eql(vp, css.VendorPrefix{ .moz = true })) {
                    try dest.writeStr("-moz-available");
                } else {
                    bun.unreachablePanic("Unexpected vendor prefixes", .{});
                }
            },
            .fit_content_function => |l| {
                try dest.writeStr("fit-content(");
                try l.toCss(W, dest);
                try dest.writeChar(')');
            },
            .length_percentage => |l| try l.toCss(W, dest),
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [aspect-ratio](https://drafts.csswg.org/css-sizing-4/#aspect-ratio) property.
pub const AspectRatio = struct {
    /// The `auto` keyword.
    auto: bool,
    /// A preferred aspect ratio for the box, specified as width / height.
    ratio: ?Ratio,

    pub fn parse(input: *css.Parser) css.Result(AspectRatio) {
        const location = input.currentSourceLocation();
        var auto = input.tryParse(css.Parser.expectIdentMatching, .{"auto"});

        const ratio = input.tryParse(Ratio.parse, .{});
        if (auto.isErr()) {
            auto = input.tryParse(css.Parser.expectIdentMatching, .{"auto"});
        }
        if (auto.isErr() and ratio.isErr()) {
            return .{ .err = location.newCustomError(css.ParserError{ .invalid_value = {} }) };
        }

        return .{
            .result = AspectRatio{
                .auto = auto.isOk(),
                .ratio = ratio.asValue(),
            },
        };
    }

    pub fn toCss(this: *const AspectRatio, comptime W: type, dest: *css.Printer(W)) css.PrintErr!void {
        if (this.auto) {
            try dest.writeStr("auto");
        }

        if (this.ratio) |*ratio| {
            if (this.auto) try dest.writeChar(' ');
            try ratio.toCss(W, dest);
        }
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

fn parseFitContent(input: *css.Parser) css.Result(LengthPercentage) {
    if (input.expectFunctionMatching("fit-content").asErr()) |e| return .{ .err = e };
    return input.parseNestedBlock(LengthPercentage, {}, css.voidWrap(LengthPercentage, LengthPercentage.parse));
}
