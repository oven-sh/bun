pub use crate::css_parser as css;

/// A [`<fill-rule>`](https://www.w3.org/TR/css-shapes-1/#typedef-fill-rule) used to
/// determine the interior of a `polygon()` shape.
///
/// See [Polygon](Polygon).
// TODO(port): intentionally unimplemented upstream (compile-error placeholder).
// Left as an uninhabited stub until the CSS shapes module is actually implemented.
pub enum FillRule {}

/// A CSS [`<alpha-value>`](https://www.w3.org/TR/css-color-4/#typedef-alpha-value),
/// used to represent opacity.
///
/// Parses either a `<number>` or `<percentage>`, but is always stored and serialized as a number.
pub struct AlphaValue {
    pub v: f32,
}
