pub const css = @import("../css_parser.zig");

const SmallList = css.SmallList;

const CssColor = css.css_values.color.CssColor;
const Length = css.css_values.length.LengthValue;
const NumberOrPercentage = css.css_values.percentage.NumberOrPercentage;
const Angle = css.css_values.angle.Angle;
const Url = css.css_values.url.Url;

/// A value for the [filter](https://drafts.fxtf.org/filter-effects-1/#FilterProperty) and
/// [backdrop-filter](https://drafts.fxtf.org/filter-effects-2/#BackdropFilterProperty) properties.
pub const FilterList = union(enum) {
    /// The `none` keyword.
    none,
    /// A list of filter functions.
    filters: SmallList(Filter, 1),
};

/// A [filter](https://drafts.fxtf.org/filter-effects-1/#filter-functions) function.
pub const Filter = union(enum) {
    /// A `blur()` filter.
    blur: Length,
    /// A `brightness()` filter.
    brightness: NumberOrPercentage,
    /// A `contrast()` filter.
    contrast: NumberOrPercentage,
    /// A `grayscale()` filter.
    grayscale: NumberOrPercentage,
    /// A `hue-rotate()` filter.
    hue_rotate: Angle,
    /// An `invert()` filter.
    invert: NumberOrPercentage,
    /// An `opacity()` filter.
    opacity: NumberOrPercentage,
    /// A `saturate()` filter.
    saturate: NumberOrPercentage,
    /// A `sepia()` filter.
    sepia: NumberOrPercentage,
    /// A `drop-shadow()` filter.
    drop_shadow: DropShadow,
    /// A `url()` reference to an SVG filter.
    url: Url,
};

/// A [`drop-shadow()`](https://drafts.fxtf.org/filter-effects-1/#funcdef-filter-drop-shadow) filter function.
pub const DropShadow = struct {
    /// The color of the drop shadow.
    color: CssColor,
    /// The x offset of the drop shadow.
    x_offset: Length,
    /// The y offset of the drop shadow.
    y_offset: Length,
    /// The blur radius of the drop shadow.
    blur: Length,
};
