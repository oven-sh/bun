use super::Notation;
use crate::{Error, Result, integer_option};

option_enum! {
    #[derive(Default)]
    pub enum RoundingMode: "roundingMode must be either \"ceil\", \"floor\", \"expand\", \"trunc\", \"halfCeil\", \"halfFloor\", \"halfExpand\", \"halfTrunc\", or \"halfEven\"" {
        Ceil = "ceil",
        Floor = "floor",
        Expand = "expand",
        Trunc = "trunc",
        HalfCeil = "halfCeil",
        HalfFloor = "halfFloor",
        #[default]
        HalfExpand = "halfExpand",
        HalfTrunc = "halfTrunc",
        HalfEven = "halfEven",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum RoundingPriority: "roundingPriority must be either \"auto\", \"morePrecision\", or \"lessPrecision\"" {
        #[default]
        Auto = "auto",
        MorePrecision = "morePrecision",
        LessPrecision = "lessPrecision",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum TrailingZeroDisplay: "trailingZeroDisplay must be either \"auto\" or \"stripIfInteger\"" {
        #[default]
        Auto = "auto",
        StripIfInteger = "stripIfInteger",
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct MinimumIntegerDigits(u8);

impl MinimumIntegerDigits {
    pub fn new(value: f64) -> Result<MinimumIntegerDigits> {
        let digits = integer_option(value, 1..=21, "minimumIntegerDigits is out of range")?;
        Ok(MinimumIntegerDigits(digits as u8))
    }

    pub fn get(self) -> u8 {
        self.0
    }
}

impl Default for MinimumIntegerDigits {
    fn default() -> MinimumIntegerDigits {
        MinimumIntegerDigits(1)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct RoundingIncrement(u16);

impl RoundingIncrement {
    pub fn new(value: f64) -> Result<RoundingIncrement> {
        match integer_option(value, 1..=5000, "roundingIncrement is out of range")? {
            increment @ (1 | 2 | 5 | 10 | 20 | 25 | 50 | 100 | 200 | 250 | 500 | 1000 | 2000
            | 2500 | 5000) => Ok(RoundingIncrement(increment)),
            _ => Err(Error::Range(
                "roundingIncrement must be one of 1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 2500, 5000",
            )),
        }
    }

    pub fn get(self) -> u16 {
        self.0
    }
}

impl Default for RoundingIncrement {
    fn default() -> RoundingIncrement {
        RoundingIncrement(1)
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct DigitRange {
    pub minimum: u8,
    pub maximum: u8,
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum RoundingType {
    FractionDigits(DigitRange),
    SignificantDigits(DigitRange),
    MorePrecision {
        fraction: DigitRange,
        significant: DigitRange,
    },
    LessPrecision {
        fraction: DigitRange,
        significant: DigitRange,
    },
}

impl RoundingType {
    pub fn fraction_digits(self) -> Option<DigitRange> {
        match self {
            RoundingType::SignificantDigits(_) => None,
            RoundingType::FractionDigits(fraction)
            | RoundingType::MorePrecision { fraction, .. }
            | RoundingType::LessPrecision { fraction, .. } => Some(fraction),
        }
    }

    pub fn significant_digits(self) -> Option<DigitRange> {
        match self {
            RoundingType::FractionDigits(_) => None,
            RoundingType::SignificantDigits(significant)
            | RoundingType::MorePrecision { significant, .. }
            | RoundingType::LessPrecision { significant, .. } => Some(significant),
        }
    }

    /// [[ComputedRoundingPriority]]
    pub fn priority(self) -> RoundingPriority {
        match self {
            RoundingType::FractionDigits(_) | RoundingType::SignificantDigits(_) => {
                RoundingPriority::Auto
            }
            RoundingType::MorePrecision { .. } => RoundingPriority::MorePrecision,
            RoundingType::LessPrecision { .. } => RoundingPriority::LessPrecision,
        }
    }
}

/// The result of SetNumberFormatDigitOptions.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
#[non_exhaustive]
pub struct DigitOptions {
    pub minimum_integer_digits: MinimumIntegerDigits,
    pub rounding_type: RoundingType,
    pub rounding_increment: RoundingIncrement,
    pub rounding_mode: RoundingMode,
    pub trailing_zero_display: TrailingZeroDisplay,
}

impl Default for DigitOptions {
    fn default() -> DigitOptions {
        DigitOptions {
            minimum_integer_digits: MinimumIntegerDigits::default(),
            rounding_type: RoundingType::FractionDigits(DigitRange {
                minimum: 0,
                maximum: 3,
            }),
            rounding_increment: RoundingIncrement::default(),
            rounding_mode: RoundingMode::default(),
            trailing_zero_display: TrailingZeroDisplay::default(),
        }
    }
}

/// What SetNumberFormatDigitOptions reads, in this order. A `V` has not been converted to a number yet.
pub struct RequestedDigits<V> {
    pub minimum_integer_digits: MinimumIntegerDigits,
    pub minimum_fraction_digits: Option<V>,
    pub maximum_fraction_digits: Option<V>,
    pub minimum_significant_digits: Option<V>,
    pub maximum_significant_digits: Option<V>,
    pub rounding_increment: RoundingIncrement,
    pub rounding_mode: RoundingMode,
    pub rounding_priority: RoundingPriority,
    pub trailing_zero_display: TrailingZeroDisplay,
}

impl<V> Default for RequestedDigits<V> {
    fn default() -> RequestedDigits<V> {
        RequestedDigits {
            minimum_integer_digits: MinimumIntegerDigits::default(),
            minimum_fraction_digits: None,
            maximum_fraction_digits: None,
            minimum_significant_digits: None,
            maximum_significant_digits: None,
            rounding_increment: RoundingIncrement::default(),
            rounding_mode: RoundingMode::default(),
            rounding_priority: RoundingPriority::default(),
            trailing_zero_display: TrailingZeroDisplay::default(),
        }
    }
}

impl<V> RequestedDigits<V> {
    /// The steps after the last read of a property.
    pub(crate) fn resolve<E: From<Error>>(
        self,
        mut default_fraction: DigitRange,
        notation: Notation,
        mut to_number: impl FnMut(V) -> core::result::Result<f64, E>,
    ) -> core::result::Result<DigitOptions, E> {
        let has_increment = self.rounding_increment != RoundingIncrement::default();
        if has_increment {
            default_fraction.maximum = default_fraction.minimum;
        }
        let has_significant =
            self.minimum_significant_digits.is_some() || self.maximum_significant_digits.is_some();
        let has_fraction =
            self.minimum_fraction_digits.is_some() || self.maximum_fraction_digits.is_some();

        let mut digits = |value: Option<V>, minimum: u8, maximum: u8, out_of_range| match value {
            Some(value) => {
                let range = minimum.into()..=maximum.into();
                let digits = integer_option(to_number(value)?, range, out_of_range)?;
                Ok::<_, E>(Some(digits as u8))
            }
            None => Ok(None),
        };

        let is_auto = self.rounding_priority == RoundingPriority::Auto;
        let significant = if has_significant || !is_auto {
            let message = "minimumSignificantDigits is out of range";
            let minimum = digits(self.minimum_significant_digits, 1, 21, message)?.unwrap_or(1);
            let message = "maximumSignificantDigits is out of range";
            let maximum = digits(self.maximum_significant_digits, minimum, 21, message)?;
            Some(DigitRange {
                minimum,
                maximum: maximum.unwrap_or(21),
            })
        } else {
            None
        };
        let fraction =
            if !is_auto || (!has_significant && (has_fraction || notation != Notation::Compact)) {
                let message = "minimumFractionDigits is out of range";
                let minimum = digits(self.minimum_fraction_digits, 0, 100, message)?;
                let message = "maximumFractionDigits is out of range";
                let maximum = digits(self.maximum_fraction_digits, 0, 100, message)?;
                Some(fraction_range(minimum, maximum, default_fraction)?)
            } else {
                None
            };

        let rounding_type = match (fraction, significant) {
            (Some(fraction), None) => RoundingType::FractionDigits(fraction),
            (None, Some(significant)) => RoundingType::SignificantDigits(significant),
            (Some(fraction), Some(significant)) => match self.rounding_priority {
                RoundingPriority::LessPrecision => RoundingType::LessPrecision {
                    fraction,
                    significant,
                },
                _ => RoundingType::MorePrecision {
                    fraction,
                    significant,
                },
            },
            (None, None) => RoundingType::MorePrecision {
                fraction: DigitRange {
                    minimum: 0,
                    maximum: 0,
                },
                significant: DigitRange {
                    minimum: 1,
                    maximum: 2,
                },
            },
        };
        if has_increment {
            check_increment_applies(rounding_type)?;
        }
        Ok(DigitOptions {
            minimum_integer_digits: self.minimum_integer_digits,
            rounding_type,
            rounding_increment: self.rounding_increment,
            rounding_mode: self.rounding_mode,
            trailing_zero_display: self.trailing_zero_display,
        })
    }
}

fn fraction_range(
    minimum: Option<u8>,
    maximum: Option<u8>,
    default: DigitRange,
) -> Result<DigitRange> {
    let (minimum, maximum) = match (minimum, maximum) {
        (None, None) => return Ok(default),
        (None, Some(maximum)) => (default.minimum.min(maximum), maximum),
        (Some(minimum), None) => (minimum, default.maximum.max(minimum)),
        (Some(minimum), Some(maximum)) => (minimum, maximum),
    };
    if minimum > maximum {
        return Err(Error::Range(
            "Computed minimumFractionDigits is larger than maximumFractionDigits",
        ));
    }
    Ok(DigitRange { minimum, maximum })
}

fn check_increment_applies(rounding_type: RoundingType) -> Result<()> {
    match rounding_type {
        RoundingType::FractionDigits(fraction) if fraction.minimum == fraction.maximum => Ok(()),
        RoundingType::FractionDigits(_) => Err(Error::Range(
            "maximumFractionDigits and minimumFractionDigits are different while roundingIncrement is specified",
        )),
        _ => Err(Error::Type(
            "rounding type is not fraction-digits while roundingIncrement is specified",
        )),
    }
}
