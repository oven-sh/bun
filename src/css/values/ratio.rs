use crate::css_parser::{CssResult as Result, Parser, PrintErr, Printer};
use crate::generics::Parse as _;
use crate::values::number::{CSSNumber, CSSNumberFns, NonNegative};

/// A CSS [`<ratio>`](https://www.w3.org/TR/css-values-4/#ratios) value,
/// representing the ratio of two numeric values.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ratio {
    pub(crate) numerator: NonNegative<CSSNumber>,
    pub(crate) denominator: NonNegative<CSSNumber>,
}

impl Ratio {
    pub(crate) fn parse(input: &mut Parser) -> Result<Ratio> {
        let first = NonNegative::<CSSNumber>::parse(input)?;
        let second = if input.try_parse(|i| i.expect_delim(b'/')).is_ok() {
            NonNegative::<CSSNumber>::parse(input)?
        } else {
            NonNegative(1.0)
        };

        Ok(Ratio {
            numerator: first,
            denominator: second,
        })
    }

    /// Parses a ratio where both operands are required.
    pub(crate) fn parse_required(input: &mut Parser) -> Result<Ratio> {
        let first = NonNegative::<CSSNumber>::parse(input)?;
        input.expect_delim(b'/')?;
        let second = NonNegative::<CSSNumber>::parse(input)?;
        Ok(Ratio {
            numerator: first,
            denominator: second,
        })
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        CSSNumberFns::to_css(self.numerator.0, dest)?;
        if self.denominator.0 != 1.0 {
            dest.delim(b'/', true)?;
            CSSNumberFns::to_css(self.denominator.0, dest)?;
        }
        Ok(())
    }

    pub(crate) fn add_f32(self, other: f32) -> Ratio {
        Ratio {
            numerator: NonNegative(self.numerator.0 + other),
            denominator: self.denominator,
        }
    }
}
