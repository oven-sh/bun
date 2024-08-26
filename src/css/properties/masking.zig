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

const Position = css.css_properties.position.Position;
const BorderRadius = css.css_properties.border_radius.BorderRadius;
const FillRule = css.css_properties.shape.FillRule;

/// A value for the [clip-path](https://www.w3.org/TR/css-masking-1/#the-clip-path) property.
const ClipPath = union(enum) {
    /// No clip path.
    None,
    /// A url reference to an SVG path element.
    Url: Url,
    /// A basic shape, positioned according to the reference box.
    Shape: struct {
        /// A basic shape.
        // todo_stuff.think_about_mem_mgmt
        shape: *BasicShape,
        /// A reference box that the shape is positioned according to.
        reference_box: GeometryBox,
    },
    /// A reference box.
    Box: GeometryBox,
};

/// A [`<geometry-box>`](https://www.w3.org/TR/css-masking-1/#typedef-geometry-box) value
/// as used in the `mask-clip` and `clip-path` properties.
const GeometryBox = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A CSS [`<basic-shape>`](https://www.w3.org/TR/css-shapes-1/#basic-shape-functions) value.
const BasicShape = union(enum) {
    /// An inset rectangle.
    Inset: InsetRect,
    /// A circle.
    Circle: Circle,
    /// An ellipse.
    Ellipse: Ellipse,
    /// A polygon.
    Polygon: Polygon,
};

/// An [`inset()`](https://www.w3.org/TR/css-shapes-1/#funcdef-inset) rectangle shape.
const InsetRect = struct {
    /// The rectangle.
    rect: Rect(LengthPercentage),
    /// A corner radius for the rectangle.
    radius: BorderRadius,
};

/// A [`circle()`](https://www.w3.org/TR/css-shapes-1/#funcdef-circle) shape.
pub const Circle = struct {
    /// The radius of the circle.
    radius: ShapeRadius,
    /// The position of the center of the circle.
    position: Position,
};

/// An [`ellipse()`](https://www.w3.org/TR/css-shapes-1/#funcdef-ellipse) shape.
pub const Ellipse = struct {
    /// The x-radius of the ellipse.
    radius_x: ShapeRadius,
    /// The y-radius of the ellipse.
    radius_y: ShapeRadius,
    /// The position of the center of the ellipse.
    position: Position,
};

/// A [`polygon()`](https://www.w3.org/TR/css-shapes-1/#funcdef-polygon) shape.
pub const Polygon = struct {
    /// The fill rule used to determine the interior of the polygon.
    fill_rule: FillRule,
    /// The points of each vertex of the polygon.
    points: ArrayList(Point),
};

/// A [`<shape-radius>`](https://www.w3.org/TR/css-shapes-1/#typedef-shape-radius) value
/// that defines the radius of a `circle()` or `ellipse()` shape.
pub const ShapeRadius = union(enum) {
    /// An explicit length or percentage.
    LengthPercentage: LengthPercentage,
    /// The length from the center to the closest side of the box.
    ClosestSide,
    /// The length from the center to the farthest side of the box.
    FarthestSide,
};

/// A point within a `polygon()` shape.
///
/// See [Polygon](Polygon).
pub const Point = struct {
    /// The x position of the point.
    x: LengthPercentage,
    /// The y position of the point.
    y: LengthPercentage,
};

/// A value for the [mask-mode](https://www.w3.org/TR/css-masking-1/#the-mask-mode) property.
const MaskMode = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [mask-clip](https://www.w3.org/TR/css-masking-1/#the-mask-clip) property.
const MaskClip = union(enum) {
    /// A geometry box.
    GeometryBox: GeometryBox,
    /// The painted content is not clipped.
    NoClip,
};

/// A value for the [mask-composite](https://www.w3.org/TR/css-masking-1/#the-mask-composite) property.
pub const MaskComposite = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [mask-type](https://www.w3.org/TR/css-masking-1/#the-mask-type) property.
pub const MaskType = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [mask](https://www.w3.org/TR/css-masking-1/#the-mask) shorthand property.
pub const Mask = @compileError(css.todo_stuff.depth);

/// A value for the [mask-border-mode](https://www.w3.org/TR/css-masking-1/#the-mask-border-mode) property.
pub const MaskBorderMode = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [mask-border](https://www.w3.org/TR/css-masking-1/#the-mask-border) shorthand property.
pub const MaskBorder = @compileError(css.todo_stuff.depth);

/// A value for the [-webkit-mask-composite](https://developer.mozilla.org/en-US/docs/Web/CSS/-webkit-mask-composite)
/// property.
///
/// See also [MaskComposite](MaskComposite).
pub const WebKitMaskComposite = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [-webkit-mask-source-type](https://github.com/WebKit/WebKit/blob/6eece09a1c31e47489811edd003d1e36910e9fd3/Source/WebCore/css/CSSProperties.json#L6578-L6587)
/// property.
///
/// See also [MaskMode](MaskMode).
pub const WebKitMaskSourceType = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
