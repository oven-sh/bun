use crate::css_parser as css;

use css::SmallList;

use css::css_values::color::CssColor;
use css::css_values::length::LengthValue as Length;
use css::css_values::percentage::NumberOrPercentage;
use css::css_values::angle::Angle;
use css::css_values::url::Url;

/// A value for the [filter](https://drafts.fxtf.org/filter-effects-1/#FilterProperty) and
/// [backdrop-filter](https://drafts.fxtf.org/filter-effects-2/#BackdropFilterProperty) properties.
pub enum FilterList {
    /// The `none` keyword.
    None,
    /// A list of filter functions.
    Filters(SmallList<Filter, 1>),
}

/// A [filter](https://drafts.fxtf.org/filter-effects-1/#filter-functions) function.
pub enum Filter {
    /// A `blur()` filter.
    Blur(Length),
    /// A `brightness()` filter.
    Brightness(NumberOrPercentage),
    /// A `contrast()` filter.
    Contrast(NumberOrPercentage),
    /// A `grayscale()` filter.
    Grayscale(NumberOrPercentage),
    /// A `hue-rotate()` filter.
    HueRotate(Angle),
    /// An `invert()` filter.
    Invert(NumberOrPercentage),
    /// An `opacity()` filter.
    Opacity(NumberOrPercentage),
    /// A `saturate()` filter.
    Saturate(NumberOrPercentage),
    /// A `sepia()` filter.
    Sepia(NumberOrPercentage),
    /// A `drop-shadow()` filter.
    DropShadow(DropShadow),
    /// A `url()` reference to an SVG filter.
    Url(Url),
}

/// A [`drop-shadow()`](https://drafts.fxtf.org/filter-effects-1/#funcdef-filter-drop-shadow) filter function.
pub struct DropShadow {
    /// The color of the drop shadow.
    pub color: CssColor,
    /// The x offset of the drop shadow.
    pub x_offset: Length,
    /// The y offset of the drop shadow.
    pub y_offset: Length,
    /// The blur radius of the drop shadow.
    pub blur: Length,
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/properties/effects.zig (56 lines)
//   confidence: high
//   todos:      0
//   notes:      type-only definitions; SmallList<T, N> assumed in crate::css_parser
// ──────────────────────────────────────────────────────────────────────────
