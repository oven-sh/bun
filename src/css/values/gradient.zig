const std = @import("std");
const Allocator = std.mem.Allocator;
const bun = @import("root").bun;
const ArrayList = std.ArrayListUnmanaged;
pub const css = @import("../css_parser.zig");
const Error = css.Error;
const VendorPrefix = css.VendorPrefix;
const Printer = css.Printer;
const PrintErr = css.PrintErr;
const CssColor = css.css_values.color.CssColor;
const CSSNumber = css.css_values.number.CSSNumber;
const CSSNumberFns = css.css_values.number.CSSNumberFns;
const Url = css.css_values.url.Url;
const Angle = css.css_values.angle.Angle;
const AnglePercentage = css.css_values.angle.AnglePercentage;
const HorizontalPositionKeyword = css.css_values.position.HorizontalPositionKeyword;
const VerticalPositionKeyword = css.css_values.position.VerticalPositionKeyword;
const Position = css.css_values.position.Position;
const Length = css.css_values.length.Length;
const LengthPercentage = css.css_values.length.LengthPercentage;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;

/// A CSS [`<gradient>`](https://www.w3.org/TR/css-images-3/#gradients) value.
pub const Gradient = union(enum) {
    /// A `linear-gradient()`, and its vendor prefix.
    linear: LinearGradient,
    /// A `repeating-linear-gradient()`, and its vendor prefix.
    repeating_linear: LinearGradient,
    /// A `radial-gradient()`, and its vendor prefix.
    radial: RadialGradient,
    /// A `repeating-radial-gradient`, and its vendor prefix.
    repeating_radial: RadialGradient,
    /// A `conic-gradient()`.
    conic: ConicGradient,
    /// A `repeating-conic-gradient()`.
    repeating_conic: ConicGradient,
    /// A legacy `-webkit-gradient()`.
    @"webkit-gradient": WebKitGradient,
};

/// A CSS [`linear-gradient()`](https://www.w3.org/TR/css-images-3/#linear-gradients) or `repeating-linear-gradient()`.
pub const LinearGradient = struct {
    /// The vendor prefixes for the gradient.
    vendor_prefix: VendorPrefix,
    /// The direction of the gradient.
    direction: LineDirection,
    /// The color stops and transition hints for the gradient.
    items: ArrayList(GradientItem(LengthPercentage)),
};

/// A CSS [`radial-gradient()`](https://www.w3.org/TR/css-images-3/#radial-gradients) or `repeating-radial-gradient()`.
pub const RadialGradient = struct {
    /// The vendor prefixes for the gradient.
    vendor_prefix: VendorPrefix,
    /// The shape of the gradient.
    shape: EndingShape,
    /// The position of the gradient.
    position: Position,
    /// The color stops and transition hints for the gradient.
    items: ArrayList(GradientItem(LengthPercentage)),
};

/// A CSS [`conic-gradient()`](https://www.w3.org/TR/css-images-4/#conic-gradients) or `repeating-conic-gradient()`.
pub const ConicGradient = struct {
    /// The angle of the gradient.
    angle: Angle,
    /// The position of the gradient.
    position: Position,
    /// The color stops and transition hints for the gradient.
    items: ArrayList(GradientItem(AnglePercentage)),
};

/// A legacy `-webkit-gradient()`.
pub const WebKitGradient = union(enum) {
    /// A linear `-webkit-gradient()`.
    linear: struct {
        /// The starting point of the gradient.
        from: WebKitGradientPoint,
        /// The ending point of the gradient.
        to: WebKitGradientPoint,
        /// The color stops in the gradient.
        stops: ArrayList(WebKitColorStop),
    },
    /// A radial `-webkit-gradient()`.
    radial: struct {
        /// The starting point of the gradient.
        from: WebKitGradientPoint,
        /// The starting radius of the gradient.
        r0: CSSNumber,
        /// The ending point of the gradient.
        to: WebKitGradientPoint,
        /// The ending radius of the gradient.
        r1: CSSNumber,
        /// The color stops in the gradient.
        stops: ArrayList(WebKitColorStop),
    },
};

/// The direction of a CSS `linear-gradient()`.
///
/// See [LinearGradient](LinearGradient).
pub const LineDirection = union(enum) {
    /// An angle.
    angle: Angle,
    /// A horizontal position keyword, e.g. `left` or `right`.
    horizontal: HorizontalPositionKeyword,
    /// A vertical position keyword, e.g. `top` or `bottom`.
    vertical: VerticalPositionKeyword,
    /// A corner, e.g. `bottom left` or `top right`.
    corner: struct {
        /// A horizontal position keyword, e.g. `left` or `right`.
        horizontal: HorizontalPositionKeyword,
        /// A vertical position keyword, e.g. `top` or `bottom`.
        vertical: VerticalPositionKeyword,
    },
};

/// Either a color stop or interpolation hint within a gradient.
///
/// This type is generic, and items may be either a [LengthPercentage](super::length::LengthPercentage)
/// or [Angle](super::angle::Angle) depending on what type of gradient it is within.
pub fn GradientItem(comptime D: type) type {
    return union(enum) {
        /// A color stop.
        color_stop: ColorStop(D),
        /// A color interpolation hint.
        hint: D,
    };
}

/// A `radial-gradient()` [ending shape](https://www.w3.org/TR/css-images-3/#valdef-radial-gradient-ending-shape).
///
/// See [RadialGradient](RadialGradient).
pub const EndingShape = union(enum) {
    /// An ellipse.
    ellipse: Ellipse,
    /// A circle.
    circle: Circle,
};

/// An x/y position within a legacy `-webkit-gradient()`.
pub const WebKitGradientPoint = struct {
    /// The x-position.
    x: WebKitGradientPointComponent(HorizontalPositionKeyword),
    /// The y-position.
    y: WebKitGradientPointComponent(VerticalPositionKeyword),
};

/// A keyword or number within a [WebKitGradientPoint](WebKitGradientPoint).
pub fn WebKitGradientPointComponent(comptime S: type) type {
    return union(enum) {
        /// The `center` keyword.
        center,
        /// A number or percentage.
        number: NumberOrPercentage,
        /// A side keyword.
        side: S,
    };
}

/// A color stop within a legacy `-webkit-gradient()`.
pub const WebKitColorStop = struct {
    /// The color of the color stop.
    color: CssColor,
    /// The position of the color stop.
    position: CSSNumber,
};

/// A [`<color-stop>`](https://www.w3.org/TR/css-images-4/#color-stop-syntax) within a gradient.
///
/// This type is generic, and may be either a [LengthPercentage](super::length::LengthPercentage)
/// or [Angle](super::angle::Angle) depending on what type of gradient it is within.
pub fn ColorStop(comptime D: type) type {
    return struct {
        /// The color of the color stop.
        color: CssColor,
        /// The position of the color stop.
        positoin: ?D,
    };
}

/// An ellipse ending shape for a `radial-gradient()`.
///
/// See [RadialGradient](RadialGradient).
pub const Ellipse = union(enum) {
    /// An ellipse with a specified horizontal and vertical radius.
    size: struct {
        /// The x-radius of the ellipse.
        x: LengthPercentage,
        /// The y-radius of the ellipse.
        y: LengthPercentage,
    },
    /// A shape extent keyword.
    extent: ShapeExtent,
};

pub const ShapeExtent = enum {
    /// The closest side of the box to the gradient's center.
    @"closest-side",
    /// The farthest side of the box from the gradient's center.
    @"farthest-side",
    /// The closest corner of the box to the gradient's center.
    @"closest-corner",
    /// The farthest corner of the box from the gradient's center.
    @"farthest-corner",
    pub usingnamespace css.DefineEnumProperty(@This());
};

/// A circle ending shape for a `radial-gradient()`.
///
/// See [RadialGradient](RadialGradient).
pub const Circle = union(enum) {
    /// A circle with a specified radius.
    radius: Length,
    /// A shape extent keyword.
    extent: ShapeExtent,
};
