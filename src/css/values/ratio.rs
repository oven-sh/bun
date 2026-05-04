use crate::css_parser as css;
use crate::css_parser::{Parser, Printer, PrintErr, Result};
use crate::css_parser::css_values::number::{CSSNumber, CSSNumberFns};

/// A CSS [`<ratio>`](https://www.w3.org/TR/css-values-4/#ratios) value,
/// representing the ratio of two numeric values.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Ratio {
    pub numerator: CSSNumber,
    pub denominator: CSSNumber,
}

impl Ratio {
    pub fn parse(input: &mut Parser) -> Result<Ratio> {
        let first = CSSNumberFns::parse(input)?;
        let second = if input.try_parse(|i| i.expect_delim('/')).is_ok() {
            CSSNumberFns::parse(input)?
        } else {
            1.0
        };

        Ok(Ratio { numerator: first, denominator: second })
    }

    /// Parses a ratio where both operands are required.
    pub fn parse_required(input: &mut Parser) -> Result<Ratio> {
        let first = CSSNumberFns::parse(input)?;
        input.expect_delim('/')?;
        let second = CSSNumberFns::parse(input)?;
        Ok(Ratio { numerator: first, denominator: second })
    }

    pub fn to_css(&self, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        CSSNumberFns::to_css(&self.numerator, dest)?;
        if self.denominator != 1.0 {
            dest.delim('/', true)?;
            CSSNumberFns::to_css(&self.denominator, dest)?;
        }
        Ok(())
    }

    // PORT NOTE: dropped unused `std.mem.Allocator` param (was `_` in Zig).
    pub fn add_f32(self, other: f32) -> Ratio {
        Ratio { numerator: self.numerator + other, denominator: self.denominator }
    }

    pub fn eql(&self, rhs: &Self) -> bool {
        // Zig: css.implementEql(@This(), lhs, rhs) — field-wise equality via reflection.
        // Rust: covered by #[derive(PartialEq)].
        self == rhs
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/ratio.zig (58 lines)
//   confidence: high
//   todos:      0
//   notes:      Result/Printer/CSSNumberFns import paths may need adjusting; try_parse closure shape assumed.
// ──────────────────────────────────────────────────────────────────────────
