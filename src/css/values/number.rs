use crate::css_parser as css;
use crate::css_parser::{CssResult, Parser, ParserError, PrintErr, Printer};
use crate::values::angle::Angle;
use crate::values::calc::Calc;

pub type CSSNumber = f32;

pub struct CSSNumberFns;

impl CSSNumberFns {
    pub fn parse(input: &mut Parser) -> CssResult<CSSNumber> {
        if let Ok(calc_value) = input.try_parse(Calc::<f32>::parse) {
            match calc_value {
                Calc::Value(v) => return Ok(*v),
                Calc::Number(n) => return Ok(n),
                // Numbers are always compatible, so they will always compute to a value.
                _ => return Err(input.new_custom_error(ParserError::invalid_value)),
            }
        }

        input.expect_number()
    }

    pub fn to_css(this: &CSSNumber, dest: &mut Printer) -> Result<(), PrintErr> {
        let number: f32 = *this;
        if number != 0.0 && number.abs() < 1.0 {
            let mut dtoa_buf: [u8; 129] = [0; 129];
            // PERF(port): Zig left dtoa_buf uninitialized — profile in Phase B
            let (str, _) = css::dtoa_short(&mut dtoa_buf, number, 6);
            if number < 0.0 {
                dest.write_char(b'-')?;
                dest.write_str(bun_core::strings::trim_leading_pattern2(str, b'-', b'0'))
            } else {
                dest.write_str(bun_core::trim_leading_char(str, b'0'))
            }
        } else {
            css::to_css::float32(number, dest)
        }
    }

    pub fn try_from_angle(_: Angle) -> Option<CSSNumber> {
        None
    }

    pub fn sign(this: &CSSNumber) -> f32 {
        if *this == 0.0 {
            // Spec-faithful (number.zig:45): both branches return +0.0 — do NOT
            // collapse with `signfns::sign_f32` / `calc::std_math_sign`.
            return if this.is_sign_positive() { 0.0 } else { 0.0 };
        }
        this.signum()
    }
}

/// A CSS [`<integer>`](https://www.w3.org/TR/css-values-4/#integers) value.
pub type CSSInteger = i32;

pub struct CSSIntegerFns;

impl CSSIntegerFns {
    pub fn parse(input: &mut Parser) -> CssResult<CSSInteger> {
        // TODO: calc??
        input.expect_integer()
    }

    #[inline]
    pub fn to_css(this: &CSSInteger, dest: &mut Printer) -> Result<(), PrintErr> {
        css::to_css::integer(*this, dest)
    }
}

// ported from: src/css/values/number.zig
