use super::border::{GenericBorder, LineStyle};
use crate::{Parser, PrintErr, Printer, Result as CssResult};

/// A value for the [outline](https://drafts.csswg.org/css-ui/#outline) shorthand property.
pub(crate) type Outline = GenericBorder<OutlineStyle, 11>;

impl super::GenericBorderImpl for Outline {
    fn parse(input: &mut Parser) -> CssResult<Self> {
        Self::parse_with_default_style(input, OutlineStyle::new())
    }

    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.to_css_with_default_style(dest, &OutlineStyle::new())
    }
}

/// A value for the [outline-style](https://drafts.csswg.org/css-ui/#outline-style) property.
#[derive(Clone, PartialEq, Eq, crate::Parse, crate::ToCss)]
pub enum OutlineStyle {
    /// The `auto` keyword.
    Auto,
    /// A value equivalent to the `border-style` property.
    LineStyle(LineStyle),
}

impl OutlineStyle {
    pub fn new() -> Self {
        OutlineStyle::LineStyle(LineStyle::None)
    }
}
