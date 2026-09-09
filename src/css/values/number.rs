use crate::css_parser as css;
use crate::css_parser::{CssResult, Parser, ParserError, ParserOptions, PrintErr, Printer, Token};
use crate::generics::{Parse, ParseWithOptions};
use crate::values::angle::Angle;
use crate::values::calc::Calc;

pub type CSSNumber = f32;

/// The next token's value if it is a number, percentage or dimension; not consumed.
pub(crate) fn peek_number_literal(input: &mut Parser) -> Option<CSSNumber> {
    let start = input.state();
    let value = match input.next() {
        Ok(Token::Number(num)) => Some(num.value),
        Ok(Token::Dimension(dim)) => Some(dim.num.value),
        Ok(Token::Percentage { unit_value, .. }) => Some(*unit_value),
        _ => None,
    };
    input.reset(&start);
    value
}

/// A value parsed with a `[0,∞]` range: a negative literal is invalid, a math
/// result clamps to 0 (https://drafts.csswg.org/css-values-4/#calc-range).
pub(crate) trait ClampNegative: Sized {
    /// Clamps a resolved negative value to zero; unresolved math is left alone.
    fn clamp_negative(self) -> Self;
}

impl ClampNegative for CSSNumber {
    fn clamp_negative(self) -> Self {
        if self < 0.0 { 0.0 } else { self }
    }
}

/// Parses a value with a `[0,∞]` range. See [ClampNegative].
pub(crate) fn parse_non_negative<T: ClampNegative>(
    input: &mut Parser,
    parse: impl FnOnce(&mut Parser) -> CssResult<T>,
) -> CssResult<T> {
    if peek_number_literal(input).is_some_and(|v| v < 0.0) {
        return Err(input.new_custom_error(ParserError::invalid_value));
    }
    parse(input).map(T::clamp_negative)
}

/// Applies [parse_non_negative] to `T` inside generic containers (`SmallList`).
pub struct NonNegative<T>(pub T);

impl<T: Parse + ClampNegative> Parse for NonNegative<T> {
    fn parse(input: &mut Parser) -> CssResult<Self> {
        parse_non_negative(input, T::parse).map(NonNegative)
    }
}
impl<T: Parse + ClampNegative> ParseWithOptions for NonNegative<T> {
    fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
        <Self as Parse>::parse(input)
    }
}

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

    pub fn to_css(this: CSSNumber, dest: &mut Printer) -> Result<(), PrintErr> {
        let number: f32 = this;
        if number != 0.0 && number.abs() < 1.0 {
            let mut dtoa_buf: [u8; 129] = [0; 129];
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

    pub(crate) fn try_from_angle(_: Angle) -> Option<CSSNumber> {
        None
    }

    pub(crate) fn sign(this: CSSNumber) -> f32 {
        if this == 0.0 {
            // Spec-faithful: ±0.0 both map to +0.0 — do NOT
            // collapse with `signfns::sign_f32` / `calc::std_math_sign`.
            return 0.0;
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
    pub fn to_css(this: CSSInteger, dest: &mut Printer) -> Result<(), PrintErr> {
        css::to_css::integer(this, dest)
    }
}
