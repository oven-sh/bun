use crate::values::number::CSSNumberFns;
use crate::values::percentage::NumberOrPercentage;
use crate::{Parser, PrintErr, Printer, Result};

/// A CSS [`<alpha-value>`](https://www.w3.org/TR/css-color-4/#typedef-alpha-value),
/// used to represent opacity.
///
/// Parses either a `<number>` or `<percentage>`, but is always stored and serialized as a number.
#[derive(Clone, Copy, Debug, PartialEq)]
pub struct AlphaValue {
    pub v: f32,
}

impl AlphaValue {
    pub(crate) fn parse(input: &mut Parser) -> Result<AlphaValue> {
        // For some reason NumberOrPercentage.parse makes zls crash, using this instead.
        // PORT NOTE: the Zig used `@call(.auto, @field(...))` as a zls workaround; direct call in Rust.
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

    // TODO(port): css.implementHash (comptime field reflection) — wires once
    // generics::CssHash blanket impl covers f32-payload structs.
}

// ported from: src/css/values/alpha.zig
