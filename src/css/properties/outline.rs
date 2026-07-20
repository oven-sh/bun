use super::border::{GenericBorder, LineStyle};

/// A value for the [outline](https://drafts.csswg.org/css-ui/#outline) shorthand property.
pub(crate) type Outline = GenericBorder<OutlineStyle, 11>;

/// A value for the [outline-style](https://drafts.csswg.org/css-ui/#outline-style) property.
#[derive(Clone, PartialEq, Eq, crate::Parse, crate::ToCss)]
pub enum OutlineStyle {
    /// The `auto` keyword.
    Auto,
    /// A value equivalent to the `border-style` property.
    LineStyle(LineStyle),
}

impl Default for OutlineStyle {
    fn default() -> Self {
        OutlineStyle::LineStyle(LineStyle::None)
    }
}
