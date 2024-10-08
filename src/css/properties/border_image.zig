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

    pub fn parse(input: *css.Parser) css.Result(BorderImageRepeat) {
        _ = input; // autofix
        @panic(css.todo_stuff.depth);
    }

    pub fn parseWithCallback(input: *css.Parser, comptime callback: anytype) css.Result(BorderImageRepeat) {
        _ = callback; // autofix
        var source: ?Image = null;
        var slice: ?BorderImageSlice = null;
        var width: ?Rect(BorderImageSideWidth) = null;
        var outset: ?Rect(LengthOrNumber) = null;
        var repeat: ?BorderImageRepeat = null;

        while (true) {
            if (slice == null) {
                if (input.tryParse(BorderImageSlice.parse, .{})) |value| {
                    slice = value;
                    // Parse border image width and outset, if applicable.
                    const maybe_width_outset = input.tryParse(struct {
                        pub fn parse(i: *css.Parser) css.Result(struct { ?Rect(BorderImageSideWidth), ?Rect(LengthOrNumber) }) {
                            if (input.expectDelim('/').asErr()) |e| return .{ .err = e };

                            const w = i.tryParse(Rect(BorderImageSideWidth).parse, .{}).asValue();

                            const o = i.tryParse(struct {
                                pub fn parseFn(in: *css.Parser) css.Result(Rect(LengthOrNumber)) {
                                    if (in.expectDelim('/').asErr()) |e| return .{ .err = e };
                                    return Rect(LengthOrNumber).parse(in);
                                }
                            }.parseFn).asValue();

                            if (w == null and o == null) return .{ .err = input.newCustomError(css.ParserError.invalid_declaration) };
                            return .{ .result = .{ w, 0 } };
                        }
                    }.parseFn, .{});

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
        }
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
};
