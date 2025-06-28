const std = @import("std");
const bun = @import("bun");
const Allocator = std.mem.Allocator;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

const CssColor = css.css_values.color.CssColor;
const Length = css.css_values.length.Length;

const PropertyCategory = css.PropertyCategory;
const BorderImageHandler = @import("./border_image.zig").BorderImageHandler;
const BorderRadiusHandler = @import("./border_radius.zig").BorderRadiusHandler;
const UnparsedProperty = css.css_properties.custom.UnparsedProperty;

/// A value for the [border-top](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-top) shorthand property.
pub const BorderTop = GenericBorder(LineStyle, 0);
/// A value for the [border-right](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-right) shorthand property.
pub const BorderRight = GenericBorder(LineStyle, 1);
/// A value for the [border-bottom](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-bottom) shorthand property.
pub const BorderBottom = GenericBorder(LineStyle, 2);
/// A value for the [border-left](https://www.w3.org/TR/css-backgrounds-3/#propdef-border-left) shorthand property.
pub const BorderLeft = GenericBorder(LineStyle, 3);
/// A value for the [border-block-start](https://drafts.csswg.org/css-logical/#propdef-border-block-start) shorthand property.
pub const BorderBlockStart = GenericBorder(LineStyle, 4);
/// A value for the [border-block-end](https://drafts.csswg.org/css-logical/#propdef-border-block-end) shorthand property.
pub const BorderBlockEnd = GenericBorder(LineStyle, 5);
/// A value for the [border-inline-start](https://drafts.csswg.org/css-logical/#propdef-border-inline-start) shorthand property.
pub const BorderInlineStart = GenericBorder(LineStyle, 6);
/// A value for the [border-inline-end](https://drafts.csswg.org/css-logical/#propdef-border-inline-end) shorthand property.
pub const BorderInlineEnd = GenericBorder(LineStyle, 7);
/// A value for the [border-block](https://drafts.csswg.org/css-logical/#propdef-border-block) shorthand property.
pub const BorderBlock = GenericBorder(LineStyle, 8);
/// A value for the [border-inline](https://drafts.csswg.org/css-logical/#propdef-border-inline) shorthand property.
pub const BorderInline = GenericBorder(LineStyle, 9);
/// A value for the [border](https://www.w3.org/TR/css-backgrounds-3/#propdef-border) shorthand property.
pub const Border = GenericBorder(LineStyle, 10);

/// A generic type that represents the `border` and `outline` shorthand properties.
pub fn GenericBorder(comptime S: type, comptime P: u8) type {
    _ = P; // autofix
    return struct {
        /// The width of the border.
        width: BorderSideWidth,
        /// The border style.
        style: S,
        /// The border color.
        color: CssColor,

        const This = @This();

        pub fn parse(input: *css.Parser) css.Result(@This()) {
            // Order doesn't matter
            var color: ?CssColor = null;
            var style: ?S = null;
            var width: ?BorderSideWidth = null;
            var any = false;

            while (true) {
                if (width == null) {
                    if (input.tryParse(BorderSideWidth.parse, .{}).asValue()) |value| {
                        width = value;
                        any = true;
                    }
                }

                if (style == null) {
                    if (input.tryParse(S.parse, .{}).asValue()) |value| {
                        style = value;
                        any = true;
                        continue;
                    }
                }

                if (color == null) {
                    if (input.tryParse(CssColor.parse, .{}).asValue()) |value| {
                        color = value;
                        any = true;
                        continue;
                    }
                }
                break;
            }

            if (any) {
                return .{
                    .result = This{
                        .width = width orelse BorderSideWidth.medium,
                        .style = style orelse S.default(),
                        .color = color orelse CssColor.current_color,
                    },
                };
            }

            return .{ .err = input.newCustomError(css.ParserError.invalid_declaration) };
        }

        pub fn toCss(this: *const This, W: anytype, dest: *Printer(W)) PrintErr!void {
            if (this.eql(&This.default())) {
                try this.style.toCss(W, dest);
                return;
            }

            var needs_space = false;
            if (!this.width.eql(&BorderSideWidth.default())) {
                try this.width.toCss(W, dest);
                needs_space = true;
            }
            if (!this.style.eql(&S.default())) {
                if (needs_space) {
                    try dest.writeStr(" ");
                }
                try this.style.toCss(W, dest);
                needs_space = true;
            }
            if (!this.color.eql(&CssColor{ .current_color = {} })) {
                if (needs_space) {
                    try dest.writeStr(" ");
                }
                try this.color.toCss(W, dest);
                needs_space = true;
            }
            return;
        }

        fn getFallbacks(this: *@This(), allocator: Allocator, targets: css.targets.Targets) css.SmallList(@This(), 2) {
            var fallbacks = this.color.getFallbacks(allocator, targets);
            defer fallbacks.deinit(allocator);
            var out = css.SmallList(@This(), 2).initCapacity(allocator, fallbacks.len());
            out.setLen(fallbacks.len());

            for (fallbacks.slice(), out.slice_mut()) |color, *o| {
                o.* = .{
                    .color = color,
                    .width = this.width.deepClone(allocator),
                    .style = this.style.deepClone(allocator),
                };
            }

            return out;
        }

        pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
            return css.implementDeepClone(@This(), this, allocator);
        }

        pub fn eql(this: *const This, other: *const This) bool {
            return css.implementEql(@This(), this, other);
        }

        pub inline fn default() This {
            return This{
                .width = .medium,
                .style = S.default(),
                .color = CssColor.current_color,
            };
        }
    };
}
/// A [`<line-style>`](https://drafts.csswg.org/css-backgrounds/#typedef-line-style) value, used in the `border-style` property.
/// A [`<line-style>`](https://drafts.csswg.org/css-backgrounds/#typedef-line-style) value, used in the `border-style` property.
pub const LineStyle = enum {
    /// No border.
    none,
    /// Similar to `none` but with different rules for tables.
    hidden,
    /// Looks as if the content on the inside of the border is sunken into the canvas.
    inset,
    /// Looks as if it were carved in the canvas.
    groove,
    /// Looks as if the content on the inside of the border is coming out of the canvas.
    outset,
    /// Looks as if it were coming out of the canvas.
    ridge,
    /// A series of round dots.
    dotted,
    /// A series of square-ended dashes.
    dashed,
    /// A single line segment.
    solid,
    /// Two parallel solid lines with some space between them.
    double,

    const css_impl = css.DefineEnumProperty(@This());
    pub const eql = css_impl.eql;
    pub const hash = css_impl.hash;
    pub const parse = css_impl.parse;
    pub const toCss = css_impl.toCss;
    pub const deepClone = css_impl.deepClone;

    pub fn isCompatible(_: *const @This(), _: bun.css.targets.Browsers) bool {
        return true;
    }

    pub fn default() LineStyle {
        return .none;
    }
};

/// A value for the [border-width](https://www.w3.org/TR/css-backgrounds-3/#border-width) property.
pub const BorderSideWidth = union(enum) {
    /// A UA defined `thin` value.
    thin,
    /// A UA defined `medium` value.
    medium,
    /// A UA defined `thick` value.
    thick,
    /// An explicit width.
    length: Length,

    pub const parse = css.DeriveParse(@This()).parse;
    pub const toCss = css.DeriveToCss(@This()).toCss;

    pub fn isCompatible(this: *const @This(), browsers: bun.css.targets.Browsers) bool {
        return switch (this.*) {
            .length => |len| len.isCompatible(browsers),
            else => true,
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn default() BorderSideWidth {
        return .medium;
    }

    pub fn deinit(_: *@This(), _: std.mem.Allocator) void {}

    pub fn eql(this: *const @This(), other: *const @This()) bool {
        return css.implementEql(@This(), this, other);
    }
};

// TODO: fallbacks
/// A value for the [border-color](https://drafts.csswg.org/css-backgrounds/#propdef-border-color) shorthand property.
pub const BorderColor = struct {
    top: CssColor,
    right: CssColor,
    bottom: CssColor,
    left: CssColor,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-color");
    const css_impl = css.DefineRectShorthand(@This(), CssColor);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;
    pub const getFallbacks = ImplFallbacks(@This()).getFallbacks;

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"border-top-color",
        .right = css.PropertyIdTag.@"border-right-color",
        .bottom = css.PropertyIdTag.@"border-bottom-color",
        .left = css.PropertyIdTag.@"border-left-color",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [border-style](https://drafts.csswg.org/css-backgrounds/#propdef-border-style) shorthand property.
pub const BorderStyle = struct {
    top: LineStyle,
    right: LineStyle,
    bottom: LineStyle,
    left: LineStyle,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-style");
    const css_impl = css.DefineRectShorthand(@This(), LineStyle);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"border-top-style",
        .right = css.PropertyIdTag.@"border-right-style",
        .bottom = css.PropertyIdTag.@"border-bottom-style",
        .left = css.PropertyIdTag.@"border-left-style",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [border-width](https://drafts.csswg.org/css-backgrounds/#propdef-border-width) shorthand property.
pub const BorderWidth = struct {
    top: BorderSideWidth,
    right: BorderSideWidth,
    bottom: BorderSideWidth,
    left: BorderSideWidth,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-width");
    const css_impl = css.DefineRectShorthand(@This(), BorderSideWidth);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

    pub const PropertyFieldMap = .{
        .top = css.PropertyIdTag.@"border-top-width",
        .right = css.PropertyIdTag.@"border-right-width",
        .bottom = css.PropertyIdTag.@"border-bottom-width",
        .left = css.PropertyIdTag.@"border-left-width",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

// TODO: fallbacks
/// A value for the [border-block-color](https://drafts.csswg.org/css-logical/#propdef-border-block-color) shorthand property.
pub const BorderBlockColor = struct {
    /// The block start value.
    start: CssColor,
    /// The block end value.
    end: CssColor,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-block-color");
    const css_impl = css.DefineSizeShorthand(@This(), CssColor);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;
    pub const getFallbacks = ImplFallbacks(@This()).getFallbacks;

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-block-start-color",
        .end = css.PropertyIdTag.@"border-block-end-color",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [border-block-style](https://drafts.csswg.org/css-logical/#propdef-border-block-style) shorthand property.
pub const BorderBlockStyle = struct {
    /// The block start value.
    start: LineStyle,
    /// The block end value.
    end: LineStyle,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-block-style");
    const css_impl = css.DefineSizeShorthand(@This(), LineStyle);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-block-start-style",
        .end = css.PropertyIdTag.@"border-block-end-style",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [border-block-width](https://drafts.csswg.org/css-logical/#propdef-border-block-width) shorthand property.
pub const BorderBlockWidth = struct {
    /// The block start value.
    start: BorderSideWidth,
    /// The block end value.
    end: BorderSideWidth,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-block-width");
    const css_impl = css.DefineSizeShorthand(@This(), BorderSideWidth);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-block-start-width",
        .end = css.PropertyIdTag.@"border-block-end-width",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

// TODO: fallbacks
/// A value for the [border-inline-color](https://drafts.csswg.org/css-logical/#propdef-border-inline-color) shorthand property.
pub const BorderInlineColor = struct {
    /// The inline start value.
    start: CssColor,
    /// The inline end value.
    end: CssColor,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-inline-color");
    const css_impl = css.DefineSizeShorthand(@This(), CssColor);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;
    pub const getFallbacks = ImplFallbacks(@This()).getFallbacks;

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-inline-start-color",
        .end = css.PropertyIdTag.@"border-inline-end-color",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [border-inline-style](https://drafts.csswg.org/css-logical/#propdef-border-inline-style) shorthand property.
pub const BorderInlineStyle = struct {
    /// The inline start value.
    start: LineStyle,
    /// The inline end value.
    end: LineStyle,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-inline-style");
    const css_impl = css.DefineSizeShorthand(@This(), LineStyle);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-inline-start-style",
        .end = css.PropertyIdTag.@"border-inline-end-style",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

/// A value for the [border-inline-width](https://drafts.csswg.org/css-logical/#propdef-border-inline-width) shorthand property.
pub const BorderInlineWidth = struct {
    /// The inline start value.
    start: BorderSideWidth,
    /// The inline end value.
    end: BorderSideWidth,

    // TODO: bring this back
    // (old using name space) css.DefineShorthand(@This(), css.PropertyIdTag.@"border-inline-width");
    const css_impl = css.DefineSizeShorthand(@This(), BorderSideWidth);
    pub const toCss = css_impl.toCss;
    pub const parse = css_impl.parse;

    pub const PropertyFieldMap = .{
        .start = css.PropertyIdTag.@"border-inline-start-width",
        .end = css.PropertyIdTag.@"border-inline-end-width",
    };

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }
};

pub fn ImplFallbacks(comptime T: type) type {
    return struct {
        const fields = std.meta.fields(T);

        pub fn getFallbacks(this: *T, allocator: std.mem.Allocator, targets: css.Targets) css.SmallList(T, 2) {
            const ColorFallbackKind = css.css_values.color.ColorFallbackKind;
            var fallbacks = ColorFallbackKind{};
            inline for (fields) |field| {
                bun.bits.insert(ColorFallbackKind, &fallbacks, @field(this, field.name).getNecessaryFallbacks(targets));
            }

            var res = css.SmallList(T, 2){};
            if (fallbacks.rgb) {
                var out: T = undefined;
                inline for (fields) |field| {
                    @field(out, field.name) = @field(this, field.name).getFallback(allocator, ColorFallbackKind{ .rgb = true });
                }
                res.append(allocator, out);
            }

            if (fallbacks.p3) {
                var out: T = undefined;
                inline for (fields) |field| {
                    @field(out, field.name) = @field(this, field.name).getFallback(allocator, ColorFallbackKind{ .p3 = true });
                }
                res.append(allocator, out);
            }

            if (fallbacks.lab) {
                inline for (fields) |field| {
                    @field(this, field.name) = @field(this, field.name).getFallback(allocator, ColorFallbackKind{ .lab = true });
                }
            }

            return res;
        }
    };
}

const BorderShorthand = struct {
    width: ?BorderSideWidth = null,
    style: ?LineStyle = null,
    color: ?CssColor = null,

    pub fn eql(lhs: *const @This(), rhs: *const @This()) bool {
        return css.implementEql(@This(), lhs, rhs);
    }

    pub fn setBorder(this: *@This(), allocator: std.mem.Allocator, border: anytype) void {
        this.width = border.width.deepClone(allocator);
        this.style = border.style.deepClone(allocator);
        this.color = border.color.deepClone(allocator);
    }

    fn reset(this: *@This(), allocator: std.mem.Allocator) void {
        bun.clear(&this.width, allocator);
        bun.clear(&this.style, allocator);
        bun.clear(&this.color, allocator);
    }

    fn isValid(this: *const @This()) bool {
        return this.width != null and this.style != null and this.color != null;
    }

    fn toBorder(this: *const @This(), allocator: std.mem.Allocator) Border {
        return .{
            .width = css.generic.deepClone(@TypeOf(this.width), &this.width, allocator).?,
            .style = css.generic.deepClone(@TypeOf(this.style), &this.style, allocator).?,
            .color = css.generic.deepClone(@TypeOf(this.color), &this.color, allocator).?,
        };
    }
};

const BorderProperty = packed struct(u32) {
    @"top-color": bool = false,
    @"bottom-color": bool = false,
    @"left-color": bool = false,
    @"right-color": bool = false,
    @"block-start-color": bool = false,
    @"block-end-color": bool = false,
    @"inline-start-color": bool = false,
    @"inline-end-color": bool = false,
    @"top-width": bool = false,
    @"bottom-width": bool = false,
    @"left-width": bool = false,
    @"right-width": bool = false,
    @"block-start-width": bool = false,
    @"block-end-width": bool = false,
    @"inline-start-width": bool = false,
    @"inline-end-width": bool = false,
    @"top-style": bool = false,
    @"bottom-style": bool = false,
    @"left-style": bool = false,
    @"right-style": bool = false,
    @"block-start-style": bool = false,
    @"block-end-style": bool = false,
    @"inline-start-style": bool = false,
    @"inline-end-style": bool = false,
    __unused: u8 = 0,

    const @"border-top-color" = BorderProperty{ .@"top-color" = true };
    const @"border-bottom-color" = BorderProperty{ .@"bottom-color" = true };
    const @"border-left-color" = BorderProperty{ .@"left-color" = true };
    const @"border-right-color" = BorderProperty{ .@"right-color" = true };
    const @"border-block-start-color" = BorderProperty{ .@"block-start-color" = true };
    const @"border-block-end-color" = BorderProperty{ .@"block-end-color" = true };
    const @"border-inline-start-color" = BorderProperty{ .@"inline-start-color" = true };
    const @"border-inline-end-color" = BorderProperty{ .@"inline-end-color" = true };
    const @"border-top-width" = BorderProperty{ .@"top-width" = true };
    const @"border-bottom-width" = BorderProperty{ .@"bottom-width" = true };
    const @"border-left-width" = BorderProperty{ .@"left-width" = true };
    const @"border-right-width" = BorderProperty{ .@"right-width" = true };
    const @"border-block-start-width" = BorderProperty{ .@"block-start-width" = true };
    const @"border-block-end-width" = BorderProperty{ .@"block-end-width" = true };
    const @"border-inline-start-width" = BorderProperty{ .@"inline-start-width" = true };
    const @"border-inline-end-width" = BorderProperty{ .@"inline-end-width" = true };
    const @"border-top-style" = BorderProperty{ .@"top-style" = true };
    const @"border-bottom-style" = BorderProperty{ .@"bottom-style" = true };
    const @"border-left-style" = BorderProperty{ .@"left-style" = true };
    const @"border-right-style" = BorderProperty{ .@"right-style" = true };
    const @"border-block-start-style" = BorderProperty{ .@"block-start-style" = true };
    const @"border-block-end-style" = BorderProperty{ .@"block-end-style" = true };
    const @"border-inline-start-style" = BorderProperty{ .@"inline-start-style" = true };
    const @"border-inline-end-style" = BorderProperty{ .@"inline-end-style" = true };

    const @"border-block-color" = BorderProperty{ .@"block-start-color" = true, .@"block-end-color" = true };
    const @"border-inline-color" = BorderProperty{ .@"inline-start-color" = true, .@"inline-end-color" = true };
    const @"border-block-width" = BorderProperty{ .@"block-start-width" = true, .@"block-end-width" = true };
    const @"border-inline-width" = BorderProperty{ .@"inline-start-width" = true, .@"inline-end-width" = true };
    const @"border-block-style" = BorderProperty{ .@"block-start-style" = true, .@"block-end-style" = true };
    const @"border-inline-style" = BorderProperty{ .@"inline-start-style" = true, .@"inline-end-style" = true };
    const @"border-top" = BorderProperty{ .@"top-color" = true, .@"top-width" = true, .@"top-style" = true };
    const @"border-bottom" = BorderProperty{ .@"bottom-color" = true, .@"bottom-width" = true, .@"bottom-style" = true };
    const @"border-left" = BorderProperty{ .@"left-color" = true, .@"left-width" = true, .@"left-style" = true };
    const @"border-right" = BorderProperty{ .@"right-color" = true, .@"right-width" = true, .@"right-style" = true };
    const @"border-block-start" = BorderProperty{ .@"block-start-color" = true, .@"block-start-width" = true, .@"block-start-style" = true };
    const @"border-block-end" = BorderProperty{ .@"block-end-color" = true, .@"block-end-width" = true, .@"block-end-style" = true };
    const @"border-inline-start" = BorderProperty{ .@"inline-start-color" = true, .@"inline-start-width" = true, .@"inline-start-style" = true };
    const @"border-inline-end" = BorderProperty{ .@"inline-end-color" = true, .@"inline-end-width" = true, .@"inline-end-style" = true };
    const @"border-block" = BorderProperty{ .@"block-start-color" = true, .@"block-end-color" = true, .@"block-start-width" = true, .@"block-end-width" = true, .@"block-start-style" = true, .@"block-end-style" = true };
    const @"border-inline" = BorderProperty{ .@"inline-start-color" = true, .@"inline-end-color" = true, .@"inline-start-width" = true, .@"inline-end-width" = true, .@"inline-start-style" = true, .@"inline-end-style" = true };
    const @"border-width" = BorderProperty{ .@"left-width" = true, .@"right-width" = true, .@"top-width" = true, .@"bottom-width" = true };
    const @"border-style" = BorderProperty{ .@"left-style" = true, .@"right-style" = true, .@"top-style" = true, .@"bottom-style" = true };
    const @"border-color" = BorderProperty{ .@"left-color" = true, .@"right-color" = true, .@"top-color" = true, .@"bottom-color" = true };
    const border = BorderProperty{ .@"left-width" = true, .@"right-width" = true, .@"top-width" = true, .@"bottom-width" = true, .@"left-style" = true, .@"right-style" = true, .@"top-style" = true, .@"bottom-style" = true, .@"left-color" = true, .@"right-color" = true, .@"top-color" = true, .@"bottom-color" = true };

    pub fn tryFromPropertyId(property_id: css.PropertyIdTag) ?@This() {
        @setEvalBranchQuota(10000);
        const fields = bun.meta.EnumFields(css.PropertyIdTag);
        inline for (fields) |field| {
            if (field.value == @intFromEnum(property_id)) {
                if (comptime std.mem.startsWith(u8, field.name, "border") and @hasDecl(@This(), field.name)) {
                    return @field(@This(), field.name);
                }
            }
        }

        return null;
    }
};

pub const BorderHandler = struct {
    border_top: BorderShorthand = .{},
    border_bottom: BorderShorthand = .{},
    border_left: BorderShorthand = .{},
    border_right: BorderShorthand = .{},
    border_block_start: BorderShorthand = .{},
    border_block_end: BorderShorthand = .{},
    border_inline_start: BorderShorthand = .{},
    border_inline_end: BorderShorthand = .{},
    category: PropertyCategory = PropertyCategory.default(),
    border_image_handler: BorderImageHandler = .{},
    border_radius_handler: BorderRadiusHandler = .{},
    flushed_properties: BorderProperty = .{},
    has_any: bool = false,

    pub fn handleProperty(
        this: *@This(),
        property: *const css.Property,
        dest: *css.DeclarationList,
        context: *css.PropertyHandlerContext,
    ) bool {
        const allocator = context.allocator;

        const flushHelper = struct {
            inline fn flushHelper(self: *BorderHandler, d: *css.DeclarationList, c: *css.PropertyHandlerContext, comptime key: []const u8, comptime prop: []const u8, val: anytype, category: PropertyCategory) void {
                if (category != self.category) {
                    self.flush(d, c);
                }

                if (@field(@field(self, key), prop) != null and !@field(@field(self, key), prop).?.eql(val) and c.targets.browsers != null and !css.generic.isCompatible(@TypeOf(val.*), val, c.targets.browsers.?)) {
                    self.flush(d, c);
                }
            }
        }.flushHelper;

        const propertyHelper = struct {
            inline fn propertyHelper(self: *BorderHandler, d: *css.DeclarationList, c: *css.PropertyHandlerContext, comptime key: []const u8, comptime prop: []const u8, val: anytype, category: PropertyCategory) void {
                flushHelper(self, d, c, key, prop, val, category);
                @field(@field(self, key), prop) = val.deepClone(c.allocator);
                self.category = category;
                self.has_any = true;
            }
        }.propertyHelper;

        const setBorderHelper = struct {
            inline fn setBorderHelper(self: *BorderHandler, d: *css.DeclarationList, c: *css.PropertyHandlerContext, comptime key: []const u8, val: anytype, category: PropertyCategory) void {
                if (category != self.category) {
                    self.flush(d, c);
                }

                @field(self, key).setBorder(c.allocator, val);
                self.category = category;
                self.has_any = true;
            }
        }.setBorderHelper;

        switch (property.*) {
            .@"border-top-color" => |*val| propertyHelper(this, dest, context, "border_top", "color", val, .physical),
            .@"border-bottom-color" => |*val| propertyHelper(this, dest, context, "border_bottom", "color", val, .physical),
            .@"border-left-color" => |*val| propertyHelper(this, dest, context, "border_left", "color", val, .physical),
            .@"border-right-color" => |*val| propertyHelper(this, dest, context, "border_right", "color", val, .physical),
            .@"border-block-start-color" => |*val| propertyHelper(this, dest, context, "border_block_start", "color", val, .logical),
            .@"border-block-end-color" => |*val| propertyHelper(this, dest, context, "border_block_end", "color", val, .logical),
            .@"border-block-color" => |val| {
                propertyHelper(this, dest, context, "border_block_start", "color", &val.start, .logical);
                propertyHelper(this, dest, context, "border_block_end", "color", &val.end, .logical);
            },
            .@"border-inline-start-color" => |*val| propertyHelper(this, dest, context, "border_inline_start", "color", val, .logical),
            .@"border-inline-end-color" => |*val| propertyHelper(this, dest, context, "border_inline_end", "color", val, .logical),
            .@"border-inline-color" => |val| {
                propertyHelper(this, dest, context, "border_inline_start", "color", &val.start, .logical);
                propertyHelper(this, dest, context, "border_inline_end", "color", &val.end, .logical);
            },
            .@"border-top-width" => |*val| propertyHelper(this, dest, context, "border_top", "width", val, .physical),
            .@"border-bottom-width" => |*val| propertyHelper(this, dest, context, "border_bottom", "width", val, .physical),
            .@"border-left-width" => |*val| propertyHelper(this, dest, context, "border_left", "width", val, .physical),
            .@"border-right-width" => |*val| propertyHelper(this, dest, context, "border_right", "width", val, .physical),
            .@"border-block-start-width" => |*val| propertyHelper(this, dest, context, "border_block_start", "width", val, .logical),
            .@"border-block-end-width" => |*val| propertyHelper(this, dest, context, "border_block_end", "width", val, .logical),
            .@"border-block-width" => |val| {
                propertyHelper(this, dest, context, "border_block_start", "width", &val.start, .logical);
                propertyHelper(this, dest, context, "border_block_end", "width", &val.end, .logical);
            },
            .@"border-inline-start-width" => |*val| propertyHelper(this, dest, context, "border_inline_start", "width", val, .logical),
            .@"border-inline-end-width" => |*val| propertyHelper(this, dest, context, "border_inline_end", "width", val, .logical),
            .@"border-inline-width" => |val| {
                propertyHelper(this, dest, context, "border_inline_start", "width", &val.start, .logical);
                propertyHelper(this, dest, context, "border_inline_end", "width", &val.end, .logical);
            },
            .@"border-top-style" => |*val| propertyHelper(this, dest, context, "border_top", "style", val, .physical),
            .@"border-bottom-style" => |*val| propertyHelper(this, dest, context, "border_bottom", "style", val, .physical),
            .@"border-left-style" => |*val| propertyHelper(this, dest, context, "border_left", "style", val, .physical),
            .@"border-right-style" => |*val| propertyHelper(this, dest, context, "border_right", "style", val, .physical),
            .@"border-block-start-style" => |*val| propertyHelper(this, dest, context, "border_block_start", "style", val, .logical),
            .@"border-block-end-style" => |*val| propertyHelper(this, dest, context, "border_block_end", "style", val, .logical),
            .@"border-block-style" => |val| {
                propertyHelper(this, dest, context, "border_block_start", "style", &val.start, .logical);
                propertyHelper(this, dest, context, "border_block_end", "style", &val.end, .logical);
            },
            .@"border-inline-start-style" => |*val| propertyHelper(this, dest, context, "border_inline_start", "style", val, .logical),
            .@"border-inline-end-style" => |*val| propertyHelper(this, dest, context, "border_inline_end", "style", val, .logical),
            .@"border-inline-style" => |val| {
                propertyHelper(this, dest, context, "border_inline_start", "style", &val.start, .logical);
                propertyHelper(this, dest, context, "border_inline_end", "style", &val.end, .logical);
            },
            .@"border-top" => |*val| setBorderHelper(this, dest, context, "border_top", val, .physical),
            .@"border-bottom" => |*val| setBorderHelper(this, dest, context, "border_bottom", val, .physical),
            .@"border-left" => |*val| setBorderHelper(this, dest, context, "border_left", val, .physical),
            .@"border-right" => |*val| setBorderHelper(this, dest, context, "border_right", val, .physical),
            .@"border-block-start" => |*val| setBorderHelper(this, dest, context, "border_block_start", val, .logical),
            .@"border-block-end" => |*val| setBorderHelper(this, dest, context, "border_block_end", val, .logical),
            .@"border-inline-start" => |*val| setBorderHelper(this, dest, context, "border_inline_start", val, .logical),
            .@"border-inline-end" => |*val| setBorderHelper(this, dest, context, "border_inline_end", val, .logical),
            .@"border-block" => |*val| {
                setBorderHelper(this, dest, context, "border_block_start", val, .logical);
                setBorderHelper(this, dest, context, "border_block_end", val, .logical);
            },
            .@"border-inline" => |*val| {
                setBorderHelper(this, dest, context, "border_inline_start", val, .logical);
                setBorderHelper(this, dest, context, "border_inline_end", val, .logical);
            },
            .@"border-width" => |*val| {
                propertyHelper(this, dest, context, "border_top", "width", &val.top, .physical);
                propertyHelper(this, dest, context, "border_right", "width", &val.right, .physical);
                propertyHelper(this, dest, context, "border_bottom", "width", &val.bottom, .physical);
                propertyHelper(this, dest, context, "border_left", "width", &val.left, .physical);

                bun.clear(&this.border_block_start.width, context.allocator);
                bun.clear(&this.border_block_end.width, context.allocator);
                bun.clear(&this.border_inline_start.width, context.allocator);
                bun.clear(&this.border_inline_end.width, context.allocator);
                this.has_any = true;
            },
            .@"border-style" => |*val| {
                propertyHelper(this, dest, context, "border_top", "style", &val.top, .physical);
                propertyHelper(this, dest, context, "border_right", "style", &val.right, .physical);
                propertyHelper(this, dest, context, "border_bottom", "style", &val.bottom, .physical);
                propertyHelper(this, dest, context, "border_left", "style", &val.left, .physical);

                bun.clear(&this.border_block_start.style, context.allocator);
                bun.clear(&this.border_block_end.style, context.allocator);
                bun.clear(&this.border_inline_start.style, context.allocator);
                bun.clear(&this.border_inline_end.style, context.allocator);
                this.has_any = true;
            },
            .@"border-color" => |*val| {
                propertyHelper(this, dest, context, "border_top", "color", &val.top, .physical);
                propertyHelper(this, dest, context, "border_right", "color", &val.right, .physical);
                propertyHelper(this, dest, context, "border_bottom", "color", &val.bottom, .physical);
                propertyHelper(this, dest, context, "border_left", "color", &val.left, .physical);

                bun.clear(&this.border_block_start.color, context.allocator);
                bun.clear(&this.border_block_end.color, context.allocator);
                bun.clear(&this.border_inline_start.color, context.allocator);
                bun.clear(&this.border_inline_end.color, context.allocator);
                this.has_any = true;
            },
            .border => |*val| {
                this.border_top.setBorder(context.allocator, val);
                this.border_bottom.setBorder(context.allocator, val);
                this.border_left.setBorder(context.allocator, val);
                this.border_right.setBorder(context.allocator, val);

                this.border_block_start.reset(allocator);
                this.border_block_end.reset(allocator);
                this.border_inline_start.reset(allocator);
                this.border_inline_end.reset(allocator);

                // Setting the `border` property resets `border-image`
                this.border_image_handler.reset(allocator);
                this.has_any = true;
            },
            .unparsed => |*val| {
                if (isBorderProperty(val.property_id)) {
                    this.flush(dest, context);
                    this.flushUnparsed(val, dest, context);
                } else {
                    if (this.border_image_handler.willFlush(property)) {
                        this.flush(dest, context);
                    }
                    return this.border_image_handler.handleProperty(property, dest, context) or this.border_radius_handler.handleProperty(property, dest, context);
                }
            },
            else => {
                if (this.border_image_handler.willFlush(property)) {
                    this.flush(dest, context);
                }
                return this.border_image_handler.handleProperty(property, dest, context) or this.border_radius_handler.handleProperty(property, dest, context);
            },
        }

        return true;
    }

    pub fn finalize(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        this.flush(dest, context);
        this.flushed_properties = .{};
        this.border_image_handler.finalize(dest, context);
        this.border_radius_handler.finalize(dest, context);
    }

    const FlushContext = struct {
        self: *BorderHandler,
        dest: *css.DeclarationList,
        ctx: *css.PropertyHandlerContext,
        logical_supported: bool,
        logical_shorthand_supported: bool,

        inline fn logicalProp(f: *FlushContext, comptime ltr: []const u8, comptime ltr_key: []const u8, comptime rtl: []const u8, comptime rtl_key: []const u8, val: anytype) void {
            _ = ltr_key; // autofix
            _ = rtl_key; // autofix
            f.ctx.addLogicalRule(f.ctx.allocator, @unionInit(css.Property, ltr, val.deepClone(f.ctx.allocator)), @unionInit(css.Property, rtl, val.deepClone(f.ctx.allocator)));
        }

        inline fn push(f: *FlushContext, comptime p: []const u8, val: anytype) void {
            bun.bits.insert(BorderProperty, &f.self.flushed_properties, @field(BorderProperty, p));
            f.dest.append(f.ctx.allocator, @unionInit(css.Property, p, val.deepClone(f.ctx.allocator))) catch bun.outOfMemory();
        }

        inline fn fallbacks(f: *FlushContext, comptime p: []const u8, _val: anytype) void {
            var val = _val;
            if (!bun.bits.contains(BorderProperty, f.self.flushed_properties, @field(BorderProperty, p))) {
                const fbs = val.getFallbacks(f.ctx.allocator, f.ctx.targets);
                for (css.generic.slice(@TypeOf(fbs), &fbs)) |fallback| {
                    f.dest.append(f.ctx.allocator, @unionInit(css.Property, p, fallback)) catch bun.outOfMemory();
                }
            }
            push(f, p, val);
        }

        inline fn prop(f: *FlushContext, comptime prop_name: []const u8, val: anytype) void {
            @setEvalBranchQuota(10000);
            if (comptime std.mem.eql(u8, prop_name, "border-inline-start")) {
                if (f.logical_supported) {
                    fallbacks(f, "border-inline-start", val);
                } else {
                    logicalProp(f, "border-left", "border_left", "border-right", "border_right", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-inline-start-width")) {
                if (f.logical_supported) {
                    push(f, "border-inline-start-width", val);
                } else {
                    logicalProp(f, "border-left-width", "border_left_width", "border-right-width", "border_right_width", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-inline-start-color")) {
                if (f.logical_supported) {
                    fallbacks(f, "border-inline-start-color", val);
                } else {
                    logicalProp(f, "border-left-color", "border_left_color", "border-right-color", "border_right_color", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-inline-start-style")) {
                if (f.logical_supported) {
                    push(f, "border-inline-start-style", val);
                } else {
                    logicalProp(f, "border-left-style", "border_left_style", "border-right-style", "border_right_style", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-inline-end")) {
                if (f.logical_supported) {
                    fallbacks(f, "border-inline-end", val);
                } else {
                    logicalProp(f, "border-right", "border_right", "border-left", "border_left", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-inline-end-width")) {
                if (f.logical_supported) {
                    push(f, "border-inline-end-width", val);
                } else {
                    logicalProp(f, "border-right-width", "border_right_width", "border-left-width", "border_left_width", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-inline-end-color")) {
                if (f.logical_supported) {
                    fallbacks(f, "border-inline-end-color", val);
                } else {
                    logicalProp(f, "border-right-color", "border_right_color", "border-left-color", "border_left_color", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-inline-end-style")) {
                if (f.logical_supported) {
                    push(f, "border-inline-end-style", val);
                } else {
                    logicalProp(f, "border-right-style", "border_right_style", "border-left-style", "border_left_style", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-block-start")) {
                if (f.logical_supported) {
                    fallbacks(f, "border-block-start", val);
                } else {
                    fallbacks(f, "border-top", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-block-start-width")) {
                if (f.logical_supported) {
                    push(f, "border-block-start-width", val);
                } else {
                    push(f, "border-top-width", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-block-start-color")) {
                if (f.logical_supported) {
                    fallbacks(f, "border-block-start-color", val);
                } else {
                    fallbacks(f, "border-top-color", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-block-start-style")) {
                if (f.logical_supported) {
                    push(f, "border-block-start-style", val);
                } else {
                    push(f, "border-top-style", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-block-end")) {
                if (f.logical_supported) {
                    fallbacks(f, "border-block-end", val);
                } else {
                    fallbacks(f, "border-bottom", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-block-end-width")) {
                if (f.logical_supported) {
                    push(f, "border-block-end-width", val);
                } else {
                    push(f, "border-bottom-width", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-block-end-color")) {
                if (f.logical_supported) {
                    fallbacks(f, "border-block-end-color", val);
                } else {
                    fallbacks(f, "border-bottom-color", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-block-end-style")) {
                if (f.logical_supported) {
                    push(f, "border-block-end-style", val);
                } else {
                    push(f, "border-bottom-style", val);
                }
            } else if (comptime std.mem.eql(u8, prop_name, "border-left-color") or
                std.mem.eql(u8, prop_name, "border-right-color") or
                std.mem.eql(u8, prop_name, "border-top-color") or
                std.mem.eql(u8, prop_name, "border-bottom-color") or
                std.mem.eql(u8, prop_name, "border-color") or
                std.mem.eql(u8, prop_name, "border-block-color") or
                std.mem.eql(u8, prop_name, "border-inline-color") or
                std.mem.eql(u8, prop_name, "border-left") or
                std.mem.eql(u8, prop_name, "border-right") or
                std.mem.eql(u8, prop_name, "border-top") or
                std.mem.eql(u8, prop_name, "border-bottom") or
                std.mem.eql(u8, prop_name, "border-block-start") or
                std.mem.eql(u8, prop_name, "border-block-end") or
                std.mem.eql(u8, prop_name, "border-inline-start") or
                std.mem.eql(u8, prop_name, "border-inline-end") or
                std.mem.eql(u8, prop_name, "border-inline") or
                std.mem.eql(u8, prop_name, "border-block") or
                std.mem.eql(u8, prop_name, "border"))
            {
                fallbacks(f, prop_name, val);
            } else {
                push(f, prop_name, val);
            }
        }

        fn flushCategory(
            f: *FlushContext,
            comptime block_start_prop: []const u8,
            comptime block_start_width: []const u8,
            comptime block_start_style: []const u8,
            comptime block_start_color: []const u8,
            block_start: *BorderShorthand,
            comptime block_end_prop: []const u8,
            comptime block_end_width: []const u8,
            comptime block_end_style: []const u8,
            comptime block_end_color: []const u8,
            block_end: *BorderShorthand,
            comptime inline_start_prop: []const u8,
            comptime inline_start_width: []const u8,
            comptime inline_start_style: []const u8,
            comptime inline_start_color: []const u8,
            inline_start: *BorderShorthand,
            comptime inline_end_prop: []const u8,
            comptime inline_end_width: []const u8,
            comptime inline_end_style: []const u8,
            comptime inline_end_color: []const u8,
            inline_end: *BorderShorthand,
            comptime is_logical: bool,
        ) void {
            const State = struct {
                f: *FlushContext,
                block_start: *BorderShorthand,
                block_end: *BorderShorthand,
                inline_start: *BorderShorthand,
                inline_end: *BorderShorthand,

                inline fn shorthand(s: *@This(), comptime p: type, comptime prop_name: []const u8, comptime key: []const u8) void {
                    const has_prop = @field(s.block_start, key) != null and @field(s.block_end, key) != null and @field(s.inline_start, key) != null and @field(s.inline_end, key) != null;
                    if (has_prop) {
                        if (!is_logical or css.generic.eql(@TypeOf(@field(s.block_start, key)), &@field(s.block_start, key), &@field(s.block_end, key)) and
                            css.generic.eql(@TypeOf(@field(s.block_end, key)), &@field(s.block_end, key), &@field(s.inline_start, key)) and
                            css.generic.eql(@TypeOf(@field(s.inline_start, key)), &@field(s.inline_start, key), &@field(s.inline_end, key)))
                        {
                            const rect = p{
                                .top = bun.take(&@field(s.block_start, key)).?,
                                .right = bun.take(&@field(s.inline_end, key)).?,
                                .bottom = bun.take(&@field(s.block_end, key)).?,
                                .left = bun.take(&@field(s.inline_start, key)).?,
                            };
                            prop(s.f, prop_name, rect);
                        }
                    }
                }

                inline fn logicalShorthand(
                    s: *@This(),
                    comptime P: type,
                    comptime prop_name: []const u8,
                    comptime key: []const u8,
                    start: anytype,
                    end: anytype,
                ) void {
                    const has_prop = @field(start, key) != null and @field(end, key) != null;
                    if (has_prop) {
                        prop(s.f, prop_name, P{
                            .start = bun.take(&@field(start, key)).?,
                            .end = bun.take(&@field(end, key)).?,
                        });
                        bun.clear(&@field(end, key), s.f.ctx.allocator);
                    }
                }

                inline fn is_eq(s: *@This(), comptime key: []const u8) bool {
                    return css.generic.eql(@TypeOf(@field(s.block_start, key)), &@field(s.block_start, key), &@field(s.block_end, key)) and
                        css.generic.eql(@TypeOf(@field(s.inline_start, key)), &@field(s.inline_start, key), &@field(s.inline_end, key)) and
                        css.generic.eql(@TypeOf(@field(s.inline_start, key)), &@field(s.inline_start, key), &@field(s.block_start, key));
                }

                inline fn prop_diff(s: *@This(), border: anytype, fallback: anytype, border_fallback: anytype) void {
                    if (!is_logical and
                        s.is_eq("color") and
                        s.is_eq("style"))
                    {
                        prop(s.f, "border", border.toBorder(s.f.ctx.allocator));
                        shorthand(s, BorderWidth, "border-width", "width");
                    } else if (!is_logical and
                        s.is_eq("width") and
                        s.is_eq("style"))
                    {
                        prop(s.f, "border", border.toBorder(s.f.ctx.allocator));
                        shorthand(s, BorderColor, "border-color", "color");
                    } else if (!is_logical and
                        s.is_eq("width") and
                        s.is_eq("color"))
                    {
                        prop(s.f, "border", border.toBorder(s.f.ctx.allocator));
                        shorthand(s, BorderStyle, "border-style", "style");
                    } else {
                        if (border_fallback) {
                            prop(s.f, "border", border.toBorder(s.f.ctx.allocator));
                        }
                        fallback(s);
                    }
                }

                inline fn side_diff(s: *@This(), border: anytype, other: anytype, comptime prop_name: []const u8, width: anytype, style: anytype, comptime color: []const u8) void {
                    const eq_width = css.generic.eql(@TypeOf(border.width), &border.width, &other.width);
                    const eq_style = css.generic.eql(@TypeOf(border.style), &border.style, &other.style);
                    const eq_color = css.generic.eql(@TypeOf(border.color), &border.color, &other.color);

                    // If only one of the sub-properties is different, only emit that.
                    // Otherwise, emit the full border value.
                    if (eq_width and eq_style) {
                        s.f.prop(color, css.generic.deepClone(@TypeOf(other.color), &other.color, s.f.ctx.allocator).?);
                    } else if (eq_width and eq_color) {
                        s.f.prop(style, css.generic.deepClone(@TypeOf(other.style), &other.style, s.f.ctx.allocator).?);
                    } else if (eq_style and eq_color) {
                        s.f.prop(width, css.generic.deepClone(@TypeOf(other.width), &other.width, s.f.ctx.allocator).?);
                    } else {
                        s.f.prop(prop_name, other.toBorder(s.f.ctx.allocator));
                    }
                }

                inline fn side(s: *@This(), val: anytype, comptime short: []const u8, comptime width: []const u8, comptime style: []const u8, comptime color: []const u8) void {
                    if (val.isValid()) {
                        s.f.prop(short, val.toBorder(s.f.ctx.allocator));
                    } else {
                        if (val.style) |*sty| {
                            s.f.prop(style, sty.deepClone(s.f.ctx.allocator));
                        }

                        if (val.width) |*w| {
                            s.f.prop(width, w.deepClone(s.f.ctx.allocator));
                        }

                        if (val.color) |*c| {
                            s.f.prop(color, c.deepClone(s.f.ctx.allocator));
                        }
                    }
                }

                // If both values of an inline logical property are equal, then we can just convert them to physical properties.
                inline fn inlineProp(s: *@This(), comptime key: []const u8, comptime left: []const u8, comptime right: []const u8) void {
                    if (@field(s.inline_start, key) != null and css.generic.eql(@TypeOf(@field(s.inline_start, key)), &@field(s.inline_start, key), &@field(s.inline_end, key))) {
                        s.f.prop(left, bun.take(&@field(s.inline_start, key)).?);
                        s.f.prop(right, bun.take(&@field(s.inline_end, key)).?);
                    }
                }
            };

            var state = State{
                .f = f,
                .block_start = block_start,
                .block_end = block_end,
                .inline_start = inline_start,
                .inline_end = inline_end,
            };

            if (block_start.isValid() and block_end.isValid() and inline_start.isValid() and inline_end.isValid()) {
                const top_eq_bottom = block_start.eql(block_end);
                const left_eq_right = inline_start.eql(inline_end);
                const top_eq_left = block_start.eql(inline_start);
                const top_eq_right = block_start.eql(inline_end);
                const bottom_eq_left = block_end.eql(inline_start);
                const bottom_eq_right = block_end.eql(inline_end);

                if (top_eq_bottom and top_eq_left and top_eq_right) {
                    state.f.prop("border", block_start.toBorder(f.ctx.allocator));
                } else if (top_eq_bottom and top_eq_left) {
                    state.f.prop("border", block_start.toBorder(f.ctx.allocator));
                    state.side_diff(block_start, inline_end, inline_end_prop, inline_end_width, inline_end_style, inline_end_color);
                } else if (top_eq_bottom and top_eq_right) {
                    state.f.prop("border", block_start.toBorder(f.ctx.allocator));
                    state.side_diff(block_start, inline_start, inline_start_prop, inline_start_width, inline_start_style, inline_start_color);
                } else if (left_eq_right and bottom_eq_left) {
                    state.f.prop("border", inline_start.toBorder(f.ctx.allocator));
                    state.side_diff(inline_start, block_start, block_start_prop, block_start_width, block_start_style, block_start_color);
                } else if (left_eq_right and top_eq_left) {
                    state.f.prop("border", inline_start.toBorder(f.ctx.allocator));
                    state.side_diff(inline_start, block_end, block_end_prop, block_end_width, block_end_style, block_end_color);
                } else if (top_eq_bottom) {
                    state.prop_diff(block_start, struct {
                        fn fallback(s: *State) void {
                            // Try to use border-inline shorthands for the opposite direction if possible
                            var handled = false;
                            if (is_logical) {
                                var diff: u32 = 0;
                                if (!css.generic.eql(@TypeOf(s.inline_start.width), &s.inline_start.width, &s.block_start.width) or
                                    !css.generic.eql(@TypeOf(s.inline_end.width), &s.inline_end.width, &s.block_start.width))
                                {
                                    diff += 1;
                                }
                                if (!css.generic.eql(@TypeOf(s.inline_start.style), &s.inline_start.style, &s.block_start.style) or
                                    !css.generic.eql(@TypeOf(s.inline_end.style), &s.inline_end.style, &s.block_start.style))
                                {
                                    diff += 1;
                                }
                                if (!css.generic.eql(@TypeOf(s.inline_start.color), &s.inline_start.color, &s.block_start.color) or
                                    !css.generic.eql(@TypeOf(s.inline_end.color), &s.inline_end.color, &s.block_start.color))
                                {
                                    diff += 1;
                                }

                                if (diff == 1) {
                                    if (!css.generic.eql(@TypeOf(s.inline_start.width), &s.inline_start.width, &s.block_start.width)) {
                                        s.f.prop("border-inline-width", BorderInlineWidth{
                                            .start = s.inline_start.width.?.deepClone(s.f.ctx.allocator),
                                            .end = s.inline_end.width.?.deepClone(s.f.ctx.allocator),
                                        });
                                        handled = true;
                                    } else if (!css.generic.eql(@TypeOf(s.inline_start.style), &s.inline_start.style, &s.block_start.style)) {
                                        s.f.prop("border-inline-style", BorderInlineStyle{
                                            .start = s.inline_start.style.?.deepClone(s.f.ctx.allocator),
                                            .end = s.inline_end.style.?.deepClone(s.f.ctx.allocator),
                                        });
                                        handled = true;
                                    } else if (!css.generic.eql(@TypeOf(s.inline_start.color), &s.inline_start.color, &s.block_start.color)) {
                                        s.f.prop("border-inline-color", BorderInlineColor{
                                            .start = s.inline_start.color.?.deepClone(s.f.ctx.allocator),
                                            .end = s.inline_end.color.?.deepClone(s.f.ctx.allocator),
                                        });
                                        handled = true;
                                    }
                                } else if (diff > 1 and
                                    css.generic.eql(@TypeOf(s.inline_start.width), &s.inline_start.width, &s.inline_end.width) and
                                    css.generic.eql(@TypeOf(s.inline_start.style), &s.inline_start.style, &s.inline_end.style) and
                                    css.generic.eql(@TypeOf(s.inline_start.color), &s.inline_start.color, &s.inline_end.color))
                                {
                                    s.f.prop("border-inline", s.inline_start.toBorder(s.f.ctx.allocator));
                                    handled = true;
                                }
                            }

                            if (!handled) {
                                s.side_diff(s.block_start, s.inline_start, inline_start_prop, inline_start_width, inline_start_style, inline_start_color);
                                s.side_diff(s.block_start, s.inline_end, inline_end_prop, inline_end_width, inline_end_style, inline_end_color);
                            }
                        }
                    }.fallback, true);
                } else if (left_eq_right) {
                    state.prop_diff(inline_start, struct {
                        fn fallback(s: *State) void {
                            // We know already that top != bottom, so no need to try to use border-block.
                            s.side_diff(s.inline_start, s.block_start, block_start_prop, block_start_width, block_start_style, block_start_color);
                            s.side_diff(s.inline_start, s.block_end, block_end_prop, block_end_width, block_end_style, block_end_color);
                        }
                    }.fallback, true);
                } else if (bottom_eq_right) {
                    state.prop_diff(block_end, struct {
                        fn fallback(s: *State) void {
                            s.side_diff(s.block_end, s.block_start, block_start_prop, block_start_width, block_start_style, block_start_color);
                            s.side_diff(s.block_end, s.inline_start, inline_start_prop, inline_start_width, inline_start_style, inline_start_color);
                        }
                    }.fallback, true);
                } else {
                    state.prop_diff(block_start, struct {
                        fn fallback(s: *State) void {
                            s.f.prop(block_start_prop, s.block_start.toBorder(s.f.ctx.allocator));
                            s.f.prop(block_end_prop, s.block_end.toBorder(s.f.ctx.allocator));
                            s.f.prop(inline_start_prop, s.inline_start.toBorder(s.f.ctx.allocator));
                            s.f.prop(inline_end_prop, s.inline_end.toBorder(s.f.ctx.allocator));
                        }
                    }.fallback, false);
                }
            } else {
                state.shorthand(BorderStyle, "border-style", "style");
                state.shorthand(BorderWidth, "border-width", "width");
                state.shorthand(BorderColor, "border-color", "color");

                if (is_logical and block_start.eql(block_end) and block_start.isValid()) {
                    if (f.logical_supported) {
                        if (f.logical_shorthand_supported) {
                            state.f.prop("border-block", block_start.toBorder(f.ctx.allocator));
                        } else {
                            state.f.prop("border-block-start", block_start.toBorder(f.ctx.allocator));
                            state.f.prop("border-block-end", block_start.toBorder(f.ctx.allocator));
                        }
                    } else {
                        state.f.prop("border-top", block_start.toBorder(f.ctx.allocator));
                        state.f.prop("border-bottom", block_start.toBorder(f.ctx.allocator));
                    }
                } else {
                    if (is_logical and f.logical_shorthand_supported and !block_start.isValid() and !block_end.isValid()) {
                        state.logicalShorthand(BorderBlockStyle, "border-block-style", "style", block_start, block_end);
                        state.logicalShorthand(BorderBlockWidth, "border-block-width", "width", block_start, block_end);
                        state.logicalShorthand(BorderBlockColor, "border-block-color", "color", block_start, block_end);
                    }

                    state.side(block_start, block_start_prop, block_start_width, block_start_style, block_start_color);
                    state.side(block_end, block_end_prop, block_end_width, block_end_style, block_end_color);
                }

                if (is_logical and inline_start.eql(inline_end) and inline_start.isValid()) {
                    if (f.logical_supported) {
                        if (f.logical_shorthand_supported) {
                            state.f.prop("border-inline", inline_start.toBorder(f.ctx.allocator));
                        } else {
                            state.f.prop("border-inline-start", inline_start.toBorder(f.ctx.allocator));
                            state.f.prop("border-inline-end", inline_start.toBorder(f.ctx.allocator));
                        }
                    } else {
                        state.f.prop("border-left", inline_start.toBorder(f.ctx.allocator));
                        state.f.prop("border-right", inline_start.toBorder(f.ctx.allocator));
                    }
                } else {
                    if (is_logical and !inline_start.isValid() and !inline_end.isValid()) {
                        if (f.logical_shorthand_supported) {
                            state.logicalShorthand(BorderInlineStyle, "border-inline-style", "style", inline_start, inline_end);
                            state.logicalShorthand(BorderInlineWidth, "border-inline-width", "width", inline_start, inline_end);
                            state.logicalShorthand(BorderInlineColor, "border-inline-color", "color", inline_start, inline_end);
                        } else {
                            // If both values of an inline logical property are equal, then we can just convert them to physical properties.
                            state.inlineProp("style", "border-left-style", "border-right-style");
                            state.inlineProp("width", "border-left-width", "border-right-width");
                            state.inlineProp("color", "border-left-color", "border-right-color");
                        }
                    }

                    state.side(inline_start, inline_start_prop, inline_start_width, inline_start_style, inline_start_color);
                    state.side(inline_end, inline_end_prop, inline_end_width, inline_end_style, inline_end_color);
                }
            }
        }
    };

    fn flush(this: *@This(), dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        if (!this.has_any) return;

        this.has_any = false;

        const logical_supported = !context.shouldCompileLogical(css.Feature.logical_borders);
        const logical_shorthand_supported = !context.shouldCompileLogical(css.Feature.logical_border_shorthand);

        var flctx = FlushContext{
            .self = this,
            .dest = dest,
            .ctx = context,
            .logical_supported = logical_supported,
            .logical_shorthand_supported = logical_shorthand_supported,
        };

        flctx.flushCategory(
            "border-top",
            "border-top-width",
            "border-top-style",
            "border-top-color",
            &this.border_top,

            "border-bottom",
            "border-bottom-width",
            "border-bottom-style",
            "border-bottom-color",
            &this.border_bottom,

            "border-left",
            "border-left-width",
            "border-left-style",
            "border-left-color",
            &this.border_left,

            "border-right",
            "border-right-width",
            "border-right-style",
            "border-right-color",
            &this.border_right,

            false,
        );

        flctx.flushCategory(
            "border-block-start",
            "border-block-start-width",
            "border-block-start-style",
            "border-block-start-color",
            &this.border_block_start,

            "border-block-end",
            "border-block-end-width",
            "border-block-end-style",
            "border-block-end-color",
            &this.border_block_end,

            "border-inline-start",
            "border-inline-start-width",
            "border-inline-start-style",
            "border-inline-start-color",
            &this.border_inline_start,

            "border-inline-end",
            "border-inline-end-width",
            "border-inline-end-style",
            "border-inline-end-color",
            &this.border_inline_end,

            true,
        );

        this.border_top.reset(context.allocator);
        this.border_bottom.reset(context.allocator);
        this.border_left.reset(context.allocator);
        this.border_right.reset(context.allocator);
        this.border_block_start.reset(context.allocator);
        this.border_block_end.reset(context.allocator);
        this.border_inline_start.reset(context.allocator);
        this.border_inline_end.reset(context.allocator);
    }

    fn flushUnparsed(this: *@This(), unparsed: *const UnparsedProperty, dest: *css.DeclarationList, context: *css.PropertyHandlerContext) void {
        const logical_supported = !context.shouldCompileLogical(css.Feature.logical_borders);
        if (logical_supported) {
            var up = unparsed.deepClone(context.allocator);
            context.addUnparsedFallbacks(&up);
            bun.bits.insert(BorderProperty, &this.flushed_properties, BorderProperty.tryFromPropertyId(up.property_id).?);
            dest.append(context.allocator, .{ .unparsed = up }) catch bun.outOfMemory();
            return;
        }

        const prop = struct {
            inline fn prop(self: *BorderHandler, d: *css.DeclarationList, c: *css.PropertyHandlerContext, up: *const UnparsedProperty, comptime id: []const u8) void {
                _ = d; // autofix
                var upppppppppp = up.withPropertyId(c.allocator, @unionInit(css.PropertyId, id, {}));
                c.addUnparsedFallbacks(&upppppppppp);
                bun.bits.insert(BorderProperty, &self.flushed_properties, @field(BorderProperty, id));
            }
        }.prop;

        const logical_prop = struct {
            inline fn logical_prop(
                c: *css.PropertyHandlerContext,
                up: *const UnparsedProperty,
                comptime ltr: []const u8,
                comptime rtl: []const u8,
            ) void {
                c.addLogicalRule(
                    c.allocator,
                    css.Property{
                        .unparsed = up.withPropertyId(
                            c.allocator,
                            @unionInit(css.PropertyId, ltr, {}),
                        ),
                    },
                    css.Property{
                        .unparsed = up.withPropertyId(
                            c.allocator,
                            @unionInit(css.PropertyId, rtl, {}),
                        ),
                    },
                );
            }
        }.logical_prop;

        switch (unparsed.property_id) {
            .@"border-inline-start" => logical_prop(context, unparsed, "border-left", "border-right"),
            .@"border-inline-start-width" => logical_prop(context, unparsed, "border-left-width", "border-right-width"),
            .@"border-inline-start-color" => logical_prop(context, unparsed, "border-left-color", "border-right-color"),
            .@"border-inline-start-style" => logical_prop(context, unparsed, "border-left-style", "border-right-style"),
            .@"border-inline-end" => logical_prop(context, unparsed, "border-right", "border-left"),
            .@"border-inline-end-width" => logical_prop(context, unparsed, "border-right-width", "border-left-width"),
            .@"border-inline-end-color" => logical_prop(context, unparsed, "border-right-color", "border-left-color"),
            .@"border-inline-end-style" => logical_prop(context, unparsed, "border-right-style", "border-left-style"),
            .@"border-block-start" => prop(this, dest, context, unparsed, "border-top"),
            .@"border-block-start-width" => prop(this, dest, context, unparsed, "border-top-width"),
            .@"border-block-start-color" => prop(this, dest, context, unparsed, "border-top-color"),
            .@"border-block-start-style" => prop(this, dest, context, unparsed, "border-top-style"),
            .@"border-block-end" => prop(this, dest, context, unparsed, "border-bottom"),
            .@"border-block-end-width" => prop(this, dest, context, unparsed, "border-bottom-width"),
            .@"border-block-end-color" => prop(this, dest, context, unparsed, "border-bottom-color"),
            .@"border-block-end-style" => prop(this, dest, context, unparsed, "border-bottom-style"),
            else => {
                var up = unparsed.deepClone(context.allocator);
                context.addUnparsedFallbacks(&up);
                bun.bits.insert(BorderProperty, &this.flushed_properties, BorderProperty.tryFromPropertyId(up.property_id).?);
                dest.append(context.allocator, .{ .unparsed = up }) catch bun.outOfMemory();
            },
        }
    }
};

fn isBorderProperty(property_id: css.PropertyIdTag) bool {
    return switch (property_id) {
        .@"border-top-color", .@"border-bottom-color", .@"border-left-color", .@"border-right-color", .@"border-block-start-color", .@"border-block-end-color", .@"border-block-color", .@"border-inline-start-color", .@"border-inline-end-color", .@"border-inline-color", .@"border-top-width", .@"border-bottom-width", .@"border-left-width", .@"border-right-width", .@"border-block-start-width", .@"border-block-end-width", .@"border-block-width", .@"border-inline-start-width", .@"border-inline-end-width", .@"border-inline-width", .@"border-top-style", .@"border-bottom-style", .@"border-left-style", .@"border-right-style", .@"border-block-start-style", .@"border-block-end-style", .@"border-block-style", .@"border-inline-start-style", .@"border-inline-end-style", .@"border-inline-style", .@"border-top", .@"border-bottom", .@"border-left", .@"border-right", .@"border-block-start", .@"border-block-end", .@"border-inline-start", .@"border-inline-end", .@"border-block", .@"border-inline", .@"border-width", .@"border-style", .@"border-color", .border => true,
        else => false,
    };
}
