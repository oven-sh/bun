use crate::css_parser as css;
use crate::css_parser::{
    CssResult, Parser, ParserError, ParserOptions, PrintErr, Printer, SourceLocation,
};
use crate::generics::{
    CssEql, DeepClone, IsCompatible, Parse, ParseNumeric, ParseWithOptions, ToCss,
};
use crate::targets::Browsers;
use crate::values::angle::Angle;
use crate::values::calc::Calc;
use bun_alloc::Arena;

/// Describes what values are allowed when parsing a numeric value.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum NumericRange {
    /// All values are allowed.
    All,
    /// Only values >= 0 are allowed.
    NonNegative,
}

impl NumericRange {
    /// Checks whether a literal is allowed.
    pub(crate) fn check(self, value: f32, location: SourceLocation) -> CssResult<f32> {
        match self {
            NumericRange::All => Ok(value),
            NumericRange::NonNegative if value >= 0.0 => Ok(value),
            _ => Err(location.new_custom_error(ParserError::invalid_value)),
        }
    }

    /// Clamps a resolved calculation to the range. NaN is left for the printer.
    pub(crate) fn clamp(self, value: f32) -> f32 {
        match self {
            NumericRange::NonNegative if value < 0.0 => 0.0,
            _ => value,
        }
    }
}

/// A numeric value in a grammar position that only allows non-negative values.
///
/// Negative literals are rejected. Calculations are clamped when their result
/// can be resolved, or preserved for the browser to clamp after resolution.
/// This wrapper constrains parsing; its contents may still be modified directly.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct NonNegative<T>(pub T);

impl<T: ParseNumeric> Parse for NonNegative<T> {
    #[inline]
    fn parse(input: &mut Parser) -> CssResult<Self> {
        T::parse_with_range(input, NumericRange::NonNegative).map(Self)
    }
}

impl<T: ParseNumeric> ParseWithOptions for NonNegative<T> {
    #[inline]
    fn parse_with_options(input: &mut Parser, _options: &ParserOptions) -> CssResult<Self> {
        <Self as Parse>::parse(input)
    }
}

impl<T: ToCss> ToCss for NonNegative<T> {
    #[inline]
    fn to_css(&self, dest: &mut Printer) -> Result<(), PrintErr> {
        self.0.to_css(dest)
    }
}

impl<T: IsCompatible> IsCompatible for NonNegative<T> {
    #[inline]
    fn is_compatible(&self, browsers: &Browsers) -> bool {
        self.0.is_compatible(browsers)
    }
}

impl<'bump, T: Clone> DeepClone<'bump> for NonNegative<T> {
    #[inline]
    fn deep_clone(&self, _bump: &'bump Arena) -> Self {
        self.clone()
    }
}

impl<T: PartialEq> CssEql for NonNegative<T> {
    #[inline]
    fn eql(&self, other: &Self) -> bool {
        self == other
    }
}

pub type CSSNumber = f32;

pub struct CSSNumberFns;

impl CSSNumberFns {
    pub fn parse(input: &mut Parser) -> CssResult<CSSNumber> {
        Self::parse_with_range(input, NumericRange::All)
    }

    pub(crate) fn parse_with_range(
        input: &mut Parser,
        range: NumericRange,
    ) -> CssResult<CSSNumber> {
        if let Ok(calc_value) = input.try_parse(Calc::<f32>::parse) {
            match calc_value {
                Calc::Value(v) => return Ok(range.clamp(*v)),
                Calc::Number(n) => return Ok(range.clamp(n)),
                // Numbers are always compatible, so they will always compute to a value.
                _ => return Err(input.new_custom_error(ParserError::invalid_value)),
            }
        }

        let location = input.current_source_location();
        let number = input.expect_number()?;
        range.check(number, location)
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
