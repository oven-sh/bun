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
        let val: NumberOrPercentage = NumberOrPercentage::parse(input)?;
        let final_ = match val {
            NumberOrPercentage::Percentage(percent) => AlphaValue { v: percent.v },
            NumberOrPercentage::Number(num) => AlphaValue { v: num },
        };
        Result::Ok(final_)
    }

    pub(crate) fn to_css(self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        CSSNumberFns::to_css(self.v, dest)
    }
}

impl crate::generics::CssHash for AlphaValue {
    /// Field-wise: hash the single `f32` payload.
    #[inline]
    fn hash(&self, hasher: &mut crate::generics::Wyhash) {
        crate::generics::CssHash::hash(&self.v, hasher);
    }
}
