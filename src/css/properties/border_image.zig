const std = @import("std");
const bun = @import("root").bun;
const Allocator = std.mem.Allocator;
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;
const Printer = css.Printer;
const PrintErr = css.PrintErr;

const LengthPercentage = css.css_values.length.LengthPercentage;
const CustomIdent = css.css_values.ident.CustomIdent;
const CSSString = css.css_values.string.CSSString;
const CSSNumber = css.css_values.number.CSSNumber;
const LengthPercentageOrAuto = css.css_values.length.LengthPercentageOrAuto;
const LengthOrNumber = css.css_values.length.LengthOrNumber;
const Size2D = css.css_values.size.Size2D;
const DashedIdent = css.css_values.ident.DashedIdent;
const Image = css.css_values.image.Image;
const CssColor = css.css_values.color.CssColor;
const Ratio = css.css_values.ratio.Ratio;
const Length = css.css_values.length.LengthValue;
const Rect = css.css_values.rect.Rect;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const Percentage = css.css_values.percentage.Percentage;

/// A value for the [border-image](https://www.w3.org/TR/css-backgrounds-3/#border-image) shorthand property.
pub const BorderImage = struct {
    /// The border image.
    source: Image,
    /// The offsets that define where the image is sliced.
    slice: BorderImageSlice,
    /// The width of the border image.
    width: Rect(BorderImageSideWidth),
    /// The amount that the image extends beyond the border box.
    outset: Rect(css.css_values.length.LengthOrNumber),
    /// How the border image is scaled and tiled.
    repeat: BorderImageRepeat,

    pub usingnamespace css.DefineShorthand(@This(), css.PropertyIdTag.@"border-image");

    pub const PropertyFieldMap = .{
        .source = css.PropertyIdTag.@"border-image-source",
        .slice = css.PropertyIdTag.@"border-image-slice",
        .width = css.PropertyIdTag.@"border-image-width",
        .outset = css.PropertyIdTag.@"border-image-outset",
        .repeat = css.PropertyIdTag.@"border-image-repeat",
    };

    pub const VendorPrefixMap = .{
        .source = true,
        .slice = true,
        .width = true,
        .outset = true,
        .repeat = true,
    };

    pub fn parse(input: *css.Parser) css.Result(BorderImage) {
        return parseWithCallback(input, {}, struct {
            pub fn cb(_: void, _: *css.Parser) bool {
                return false;
            }
        }.cb);
    }

    pub fn parseWithCallback(input: *css.Parser, ctx: anytype, comptime callback: anytype) css.Result(BorderImage) {
        var source: ?Image = null;
        var slice: ?BorderImageSlice = null;
        var width: ?Rect(BorderImageSideWidth) = null;
        var outset: ?Rect(LengthOrNumber) = null;
        var repeat: ?BorderImageRepeat = null;

        while (true) {
            if (slice == null) {
                if (input.tryParse(BorderImageSlice.parse, .{}).asValue()) |value| {
                    slice = value;
                    // Parse border image width and outset, if applicable.
                    const maybe_width_outset = input.tryParse(struct {
                        pub fn parse(i: *css.Parser) css.Result(struct { ?Rect(BorderImageSideWidth), ?Rect(LengthOrNumber) }) {
                            if (i.expectDelim('/').asErr()) |e| return .{ .err = e };

                            const w = i.tryParse(Rect(BorderImageSideWidth).parse, .{}).asValue();

                            const o = i.tryParse(struct {
                                pub fn parseFn(in: *css.Parser) css.Result(Rect(LengthOrNumber)) {
                                    if (in.expectDelim('/').asErr()) |e| return .{ .err = e };
                                    return Rect(LengthOrNumber).parse(in);
                                }
                            }.parseFn, .{}).asValue();

                            if (w == null and o == null) return .{ .err = i.newCustomError(css.ParserError.invalid_declaration) };
                            return .{ .result = .{ w, o } };
                        }
                    }.parse, .{});

                    if (maybe_width_outset.asValue()) |val| {
                        width = val[0];
                        outset = val[1];
                    }
                    continue;
                }
            }

            if (source == null) {
                if (input.tryParse(Image.parse, .{}).asValue()) |value| {
                    source = value;
                    continue;
                }
            }

            if (repeat == null) {
                if (input.tryParse(BorderImageRepeat.parse, .{}).asValue()) |value| {
                    repeat = value;
                    continue;
                }
            }

            if (@call(.auto, callback, .{ ctx, input })) {
                continue;
            }

            break;
        }

        if (source != null or slice != null or width != null or outset != null or repeat != null) {
            return .{
                .result = BorderImage{
                    .source = source orelse Image.default(),
                    .slice = slice orelse BorderImageSlice.default(),
                    .width = width orelse Rect(BorderImageSideWidth).all(BorderImageSideWidth.default()),
                    .outset = outset orelse Rect(LengthOrNumber).all(LengthOrNumber.default()),
                    .repeat = repeat orelse BorderImageRepeat.default(),
                },
            };
        }
        return .{ .err = input.newCustomError(css.ParserError.invalid_declaration) };
    }

    pub fn toCss(this: *const BorderImage, comptime W: type, dest: *css.Printer(W)) PrintErr!void {
        return toCssInternal(&this.source, &this.slice, &this.width, &this.outset, &this.repeat, W, dest);
    }

    pub fn toCssInternal(
        source: *const Image,
        slice: *const BorderImageSlice,
        width: *const Rect(BorderImageSideWidth),
        outset: *const Rect(LengthOrNumber),
        repeat: *const BorderImageRepeat,
        comptime W: type,
        dest: *css.Printer(W),
    ) PrintErr!void {
        if (!css.generic.eql(Image, source, &Image.default())) {
            try source.toCss(W, dest);
        }
        const has_slice = !css.generic.eql(BorderImageSlice, slice, &BorderImageSlice.default());
        const has_width = !css.generic.eql(Rect(BorderImageSideWidth), width, &Rect(BorderImageSideWidth).all(BorderImageSideWidth.default()));
        const has_outset = !css.generic.eql(Rect(LengthOrNumber), outset, &Rect(LengthOrNumber).all(LengthOrNumber{ .number = 0.0 }));
        if (has_slice or has_width or has_outset) {
            try dest.writeStr(" ");
            try slice.toCss(W, dest);
            if (has_width or has_outset) {
                try dest.delim('/', true);
            }
            if (has_width) {
                try width.toCss(W, dest);
            }

            if (has_outset) {
                try dest.delim('/', true);
                try outset.toCss(W, dest);
            }
        }

        if (!css.generic.eql(BorderImageRepeat, repeat, &BorderImageRepeat.default())) {
            try dest.writeStr(" ");
            return repeat.toCss(W, dest);
        }

        return;
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const BorderImage, other: *const BorderImage) bool {
        return this.source.eql(&other.source) and
            this.slice.eql(&other.slice) and
            this.width.eql(&other.width) and
            this.outset.eql(&other.outset) and
            this.repeat.eql(&other.repeat);
    }

    pub fn default() BorderImage {
        return BorderImage{
            .source = Image.default(),
            .slice = BorderImageSlice.default(),
            .width = Rect(BorderImageSideWidth).all(BorderImageSideWidth.default()),
            .outset = Rect(LengthOrNumber).all(LengthOrNumber.default()),
            .repeat = BorderImageRepeat.default(),
        };
    }
};

/// A value for the [border-image-repeat](https://www.w3.org/TR/css-backgrounds-3/#border-image-repeat) property.
pub const BorderImageRepeat = struct {
    /// The horizontal repeat value.
    horizontal: BorderImageRepeatKeyword,
    /// The vertical repeat value.
    vertical: BorderImageRepeatKeyword,

    pub fn parse(input: *css.Parser) css.Result(BorderImageRepeat) {
        const horizontal = switch (BorderImageRepeatKeyword.parse(input)) {
            .result => |v| v,
            .err => |e| return .{ .err = e },
        };
        const vertical = input.tryParse(BorderImageRepeatKeyword.parse, .{}).asValue();
        return .{ .result = BorderImageRepeat{
            .horizontal = horizontal,
            .vertical = vertical orelse horizontal,
        } };
    }

    pub fn toCss(this: *const BorderImageRepeat, comptime W: type, dest: *Printer(W)) PrintErr!void {
        try this.horizontal.toCss(W, dest);
        if (this.horizontal != this.vertical) {
            try dest.writeStr(" ");
            try this.vertical.toCss(W, dest);
        }
    }

    pub fn default() BorderImageRepeat {
        return BorderImageRepeat{
            .horizontal = BorderImageRepeatKeyword.stretch,
            .vertical = BorderImageRepeatKeyword.stretch,
        };
    }

    pub fn eql(this: *const BorderImageRepeat, other: *const BorderImageRepeat) bool {
        return this.horizontal.eql(&other.horizontal) and this.vertical.eql(&other.vertical);
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};

/// A value for the [border-image-width](https://www.w3.org/TR/css-backgrounds-3/#border-image-width) property.
pub const BorderImageSideWidth = union(enum) {
    /// A number representing a multiple of the border width.
    number: CSSNumber,
    /// An explicit length or percentage.
    length_percentage: LengthPercentage,
    /// The `auto` keyword, representing the natural width of the image slice.
    auto: void,

    pub usingnamespace css.DeriveParse(@This());
    pub usingnamespace css.DeriveToCss(@This());

    pub fn default() BorderImageSideWidth {
        return .{ .number = 1.0 };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }

    pub fn eql(this: *const BorderImageSideWidth, other: *const BorderImageSideWidth) bool {
        return switch (this.*) {
            .number => |*a| switch (other.*) {
                .number => |*b| a.* == b.*,
                else => false,
            },
            .length_percentage => |*a| switch (other.*) {
                .length_percentage => css.generic.eql(LengthPercentage, a, &other.length_percentage),
                else => false,
            },
            .auto => switch (other.*) {
                .auto => true,
                else => false,
            },
        };
    }
};

/// A single [border-image-repeat](https://www.w3.org/TR/css-backgrounds-3/#border-image-repeat) keyword.
pub const BorderImageRepeatKeyword = enum {
    /// The image is stretched to fill the area.
    stretch,
    /// The image is tiled (repeated) to fill the area.
    repeat,
    /// The image is scaled so that it repeats an even number of times.
    round,
    /// The image is repeated so that it fits, and then spaced apart evenly.
    space,

    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A value for the [border-image-slice](https://www.w3.org/TR/css-backgrounds-3/#border-image-slice) property.
pub const BorderImageSlice = struct {
    /// The offsets from the edges of the image.
    offsets: Rect(NumberOrPercentage),
    /// Whether the middle of the border image should be preserved.
    fill: bool,

    pub fn parse(input: *css.Parser) css.Result(BorderImageSlice) {
        var fill = switch (input.expectIdentMatching("fill")) {
            .err => false,
            .result => true,
        };
        const offsets = switch (Rect(NumberOrPercentage).parse(input)) {
            .err => |e| return .{ .err = e },
            .result => |v| v,
        };
        if (!fill) {
            fill = switch (input.expectIdentMatching("fill")) {
                .err => false,
                .result => true,
            };
        }
        return .{ .result = BorderImageSlice{ .offsets = offsets, .fill = fill } };
    }

    pub fn toCss(this: *const BorderImageSlice, comptime W: type, dest: *Printer(W)) PrintErr!void {
        try this.offsets.toCss(W, dest);
        if (this.fill) {
            try dest.writeStr(" fill");
        }
    }

    pub fn eql(this: *const BorderImageSlice, other: *const BorderImageSlice) bool {
        return this.offsets.eql(&other.offsets) and this.fill == other.fill;
    }

    pub fn default() BorderImageSlice {
        return BorderImageSlice{
            .offsets = Rect(NumberOrPercentage).all(NumberOrPercentage{ .percentage = Percentage{ .v = 1.0 } }),
            .fill = false,
        };
    }

    pub fn deepClone(this: *const @This(), allocator: std.mem.Allocator) @This() {
        return css.implementDeepClone(@This(), this, allocator);
    }
};
