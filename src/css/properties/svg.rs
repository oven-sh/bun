use crate::css_values::color::CssColor;
use crate::css_values::length::LengthPercentage;
use crate::css_values::url::Url;

/// An SVG [`<paint>`](https://www.w3.org/TR/SVG2/painting.html#SpecifyingPaint) value
/// used in the `fill` and `stroke` properties.
#[allow(dead_code)]
enum SVGPaint {
    /// A URL reference to a paint server element, e.g. `linearGradient`, `radialGradient`, and `pattern`.
    Url {
        /// The url of the paint server.
        url: Url,
        /// A fallback to be used in case the paint server cannot be resolved.
        fallback: Option<SVGPaintFallback>,
    },
    /// A solid color paint.
    Color(CssColor),
    /// Use the paint value of fill from a context element.
    ContextFill,
    /// Use the paint value of stroke from a context element.
    ContextStroke,
    /// No paint.
    None,
}

/// A fallback for an SVG paint in case a paint server `url()` cannot be resolved.
///
/// See [SVGPaint](SVGPaint).
#[allow(dead_code)]
enum SVGPaintFallback {
    /// No fallback.
    None,
    /// A solid color.
    Color(CssColor),
}

/// A value for the [stroke-linecap](https://www.w3.org/TR/SVG2/painting.html#LineCaps) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))` —
// a lazy compile error placeholder (never instantiated). Define the real enum in Phase B.
pub enum StrokeLinecap {}

/// A value for the [stroke-linejoin](https://www.w3.org/TR/SVG2/painting.html#LineJoin) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))`.
pub enum StrokeLinejoin {}

/// A value for the [stroke-dasharray](https://www.w3.org/TR/SVG2/painting.html#StrokeDashing) property.
#[allow(dead_code)]
enum StrokeDasharray {
    /// No dashing is used.
    None,
    /// Specifies a dashing pattern to use.
    // PERF(port): css is an arena crate; Zig used ArrayListUnmanaged. Revisit
    // bumpalo::collections::Vec<'bump, LengthPercentage> in Phase B.
    Values(Vec<LengthPercentage>),
}

/// A value for the [marker](https://www.w3.org/TR/SVG2/painting.html#VertexMarkerProperties) properties.
#[allow(dead_code)]
enum Marker {
    /// No marker.
    None,
    /// A url reference to a `<marker>` element.
    Url(Url),
}

/// A value for the [color-interpolation](https://www.w3.org/TR/SVG2/painting.html#ColorInterpolation) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))`.
pub enum ColorInterpolation {}

/// A value for the [color-rendering](https://www.w3.org/TR/SVG2/painting.html#ColorRendering) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))`.
pub enum ColorRendering {}

/// A value for the [shape-rendering](https://www.w3.org/TR/SVG2/painting.html#ShapeRendering) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))`.
pub enum ShapeRendering {}

/// A value for the [text-rendering](https://www.w3.org/TR/SVG2/painting.html#TextRendering) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))`.
pub enum TextRendering {}

/// A value for the [image-rendering](https://www.w3.org/TR/SVG2/painting.html#ImageRendering) property.
// TODO(port): Zig source is `css.DefineEnumProperty(@compileError(css.todo_stuff.depth))`.
pub enum ImageRendering {}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/svg.zig (75 lines)
//   confidence: high
//   todos:      7
//   notes:      7 enum-property types are @compileError placeholders in Zig; ported as empty enums. StrokeDasharray uses Vec<T> pending arena decision.
// ──────────────────────────────────────────────────────────────────────────
