use crate::css_parser::{CssResult as Result, Parser, PrintErr, Printer};
use crate::values::number::{CSSNumber, CSSNumberFns};

/// A CSS [`<ratio>`](https://www.w3.org/TR/css-values-4/#ratios) value,
/// representing the ratio of two numeric values.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ratio {
    pub(crate) numerator: CSSNumber,
    pub(crate) denominator: CSSNumber,
}

impl Ratio {
    pub(crate) fn parse(input: &mut Parser) -> Result<Ratio> {
        let first = CSSNumberFns::parse(input)?;
        let second = if input.try_parse(|i| i.expect_delim(b'/')).is_ok() {
            CSSNumberFns::parse(input)?
        } else {
            1.0
        };

        Ok(Ratio {
            numerator: first,
            denominator: second,
        })
    }

    /// Parses a ratio where both operands are required.
    pub(crate) fn parse_required(input: &mut Parser) -> Result<Ratio> {
        let first = CSSNumberFns::parse(input)?;
        input.expect_delim(b'/')?;
        let second = CSSNumberFns::parse(input)?;
        Ok(Ratio {
            numerator: first,
            denominator: second,
        })
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        if self.denominator != 1.0 {
            return self.to_css_both_terms(dest);
        }
        CSSNumberFns::to_css(self.numerator, dest)
    }

    /// Writes `numerator / denominator`, also when the denominator is 1.
    pub(crate) fn to_css_both_terms(
        self,
        dest: &mut Printer,
    ) -> core::result::Result<(), PrintErr> {
        CSSNumberFns::to_css(self.numerator, dest)?;
        dest.delim(b'/', true)?;
        CSSNumberFns::to_css(self.denominator, dest)
    }

    /// Steps past the ratio for a strict bound. Integer terms stay integers: `16 / 9` steps up to `16001 / 9000`.
    pub(crate) fn step(self, sign: f32) -> Ratio {
        let Ratio {
            numerator,
            denominator,
        } = self;
        let integers = numerator >= 1.0
            && denominator >= 1.0
            && numerator.fract() == 0.0
            && denominator.fract() == 0.0;
        if !integers {
            return Ratio {
                numerator: numerator + sign * 0.001,
                denominator,
            };
        }
        // At most 5 digits: Safari before 16.4 multiplies a term by the viewport size as a 32-bit float.
        let mut scale = 1.0;
        while numerator.max(denominator) * scale * 10.0 < 100_000.0 {
            scale *= 10.0;
        }
        Ratio {
            numerator: numerator * scale + sign,
            denominator: denominator * scale,
        }
    }
}
