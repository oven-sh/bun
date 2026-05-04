use crate as css;
use crate::css_values::angle::Angle;
use crate::css_values::calc::Calc;
use crate::{Parser, ParserError, PrintErr, Printer, Result};

pub type CSSNumber = f32;

pub struct CSSNumberFns;

impl CSSNumberFns {
    pub fn parse(input: &mut Parser) -> Result<CSSNumber> {
        if let Some(calc_value) = input.try_parse(Calc::<f32>::parse, ()).as_value() {
            match calc_value {
                Calc::Value(v) => return Result::result(*v),
                Calc::Number(n) => return Result::result(n),
                // Numbers are always compatible, so they will always compute to a value.
                _ => return Result::err(input.new_custom_error(ParserError::InvalidValue)),
            }
        }

        input.expect_number()
    }

    pub fn to_css(this: &CSSNumber, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        let number: f32 = *this;
        if number != 0.0 && number.abs() < 1.0 {
            let mut dtoa_buf: [u8; 129] = [0; 129];
            // PERF(port): Zig left dtoa_buf uninitialized — profile in Phase B
            let (str, _) = css::dtoa_short(&mut dtoa_buf, number, 6)?;
            if number < 0.0 {
                dest.write_char(b'-')?;
                dest.write_str(bun_str::strings::trim_leading_pattern2(str, b'-', b'0'))?;
            } else {
                dest.write_str(bun_str::strings::trim_leading_char(str, b'0'))?;
            }
            Ok(())
        } else {
            match css::to_css::float32(number, dest) {
                Ok(v) => Ok(v),
                Err(_) => dest.add_fmt_error(),
            }
        }
    }

    pub fn try_from_angle(_: Angle) -> Option<CSSNumber> {
        None
    }

    pub fn sign(this: &CSSNumber) -> f32 {
        if *this == 0.0 {
            return if css::signfns::is_sign_positive(*this) { 0.0 } else { 0.0 };
        }
        css::signfns::signum(*this)
    }
}

/// A CSS [`<integer>`](https://www.w3.org/TR/css-values-4/#integers) value.
pub type CSSInteger = i32;

pub struct CSSIntegerFns;

impl CSSIntegerFns {
    pub fn parse(input: &mut Parser) -> Result<CSSInteger> {
        // TODO: calc??
        input.expect_integer()
    }

    #[inline]
    pub fn to_css(this: &CSSInteger, dest: &mut Printer) -> core::result::Result<(), PrintErr> {
        css::to_css::integer::<i32>(*this, dest)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/css/values/number.zig (62 lines)
//   confidence: medium
//   todos:      0
//   notes:      css::Result<T> assumed to expose .result()/.err()/.as_value(); Calc variant names guessed (Value/Number); sign() preserves Zig's redundant 0.0/0.0 branch verbatim.
// ──────────────────────────────────────────────────────────────────────────
