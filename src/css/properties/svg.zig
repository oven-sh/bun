const std = @import("std");
const ArrayList = std.ArrayListUnmanaged;

pub const css = @import("../css_parser.zig");

const LengthPercentage = css.css_values.length.LengthPercentage;
const CssColor = css.css_values.color.CssColor;
const Url = css.css_values.url.Url;

/// An SVG [`<paint>`](https://www.w3.org/TR/SVG2/painting.html#SpecifyingPaint) value
/// used in the `fill` and `stroke` properties.
const SVGPaint = union(enum) {
    /// A URL reference to a paint server element, e.g. `linearGradient`, `radialGradient`, and `pattern`.
    Url: struct {
        /// The url of the paint server.
        url: Url,
        /// A fallback to be used in case the paint server cannot be resolved.
        fallback: ?SVGPaintFallback,
    },
    /// A solid color paint.
    Color: CssColor,
    /// Use the paint value of fill from a context element.
    ContextFill,
    /// Use the paint value of stroke from a context element.
    ContextStroke,
    /// No paint.
    None,
};

/// A fallback for an SVG paint in case a paint server `url()` cannot be resolved.
///
/// See [SVGPaint](SVGPaint).
const SVGPaintFallback = union(enum) {
    /// No fallback.
    None,
    /// A solid color.
    Color: CssColor,
};

/// A value for the [stroke-linecap](https://www.w3.org/TR/SVG2/painting.html#LineCaps) property.
pub const StrokeLinecap = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [stroke-linejoin](https://www.w3.org/TR/SVG2/painting.html#LineJoin) property.
pub const StrokeLinejoin = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [stroke-dasharray](https://www.w3.org/TR/SVG2/painting.html#StrokeDashing) property.
const StrokeDasharray = union(enum) {
    /// No dashing is used.
    None,
    /// Specifies a dashing pattern to use.
    Values: ArrayList(LengthPercentage),
};

/// A value for the [marker](https://www.w3.org/TR/SVG2/painting.html#VertexMarkerProperties) properties.
const Marker = union(enum) {
    /// No marker.
    None,
    /// A url reference to a `<marker>` element.
    Url: Url,
};

/// A value for the [color-interpolation](https://www.w3.org/TR/SVG2/painting.html#ColorInterpolation) property.
pub const ColorInterpolation = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [color-rendering](https://www.w3.org/TR/SVG2/painting.html#ColorRendering) property.
pub const ColorRendering = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [shape-rendering](https://www.w3.org/TR/SVG2/painting.html#ShapeRendering) property.
pub const ShapeRendering = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [text-rendering](https://www.w3.org/TR/SVG2/painting.html#TextRendering) property.
pub const TextRendering = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));

/// A value for the [image-rendering](https://www.w3.org/TR/SVG2/painting.html#ImageRendering) property.
pub const ImageRendering = css.DefineEnumProperty(@compileError(css.todo_stuff.depth));
