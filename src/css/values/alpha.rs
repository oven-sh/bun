use crate::values::number::CSSNumberFns;
use crate::values::percentage::NumberOrPercentage;
use crate::{Parser, PrintErr, Printer, Result};

/// A CSS [`<alpha-value>`](https://www.w3.org/TR/css-color-4/#typedef-alpha-value),
/// used to represent opacity.
///
/// Parses either a `<number>` or `<percentage>`, but is always stored and serialized as a number.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AlphaValue {
    pub(crate) v: f32,
}

impl AlphaValue {
    pub(crate) fn parse(input: &mut Parser) -> Result<AlphaValue> {
        let v = NumberOrPercentage::parse_unit_value(input)?;
        Result::Ok(AlphaValue { v })
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        CSSNumberFns::to_css(self.v, dest)
    }
}
