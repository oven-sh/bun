use bun_engine_text::Text;

use super::{Currency, DigitOptions, DigitRange, RequestedDigits, Unit};
use crate::{Error, Named, Result};

option_enum! {
    #[derive(Default)]
    pub enum Style: "style must be either \"decimal\", \"percent\", \"currency\", or \"unit\"" {
        #[default]
        Decimal = "decimal",
        Percent = "percent",
        Currency = "currency",
        Unit = "unit",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum CurrencyDisplay: "currencyDisplay must be either \"code\", \"symbol\", or \"name\"" {
        Code = "code",
        #[default]
        Symbol = "symbol",
        NarrowSymbol = "narrowSymbol",
        Name = "name",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum CurrencySign: "currencySign must be either \"standard\" or \"accounting\"" {
        #[default]
        Standard = "standard",
        Accounting = "accounting",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum UnitDisplay: "unitDisplay must be either \"short\", \"narrow\", or \"long\"" {
        #[default]
        Short = "short",
        Narrow = "narrow",
        Long = "long",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum Notation: "notation must be either \"standard\", \"scientific\", \"engineering\", or \"compact\"" {
        #[default]
        Standard = "standard",
        Scientific = "scientific",
        Engineering = "engineering",
        Compact = "compact",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum CompactDisplay: "compactDisplay must be either \"short\" or \"long\"" {
        #[default]
        Short = "short",
        Long = "long",
    }
}

option_enum! {
    #[derive(Default)]
    pub enum SignDisplay: "signDisplay must be either \"auto\", \"never\", \"always\", \"exceptZero\", or \"negative\"" {
        #[default]
        Auto = "auto",
        Never = "never",
        Always = "always",
        ExceptZero = "exceptZero",
        Negative = "negative",
    }
}

named_enum! {
    /// The values of `useGrouping` but `false`. `true` is `Always`.
    pub enum Grouping {
        Min2 = "min2",
        Auto = "auto",
        Always = "always",
    }
}

impl Grouping {
    pub fn default_for(notation: Notation) -> Grouping {
        match notation {
            Notation::Compact => Grouping::Min2,
            _ => Grouping::Auto,
        }
    }

    /// For a value that is truthy and not `true`, as a string.
    pub fn parse(text: Text<'_>, notation: Notation) -> Result<Grouping> {
        if text.eq_ascii("true") || text.eq_ascii("false") {
            return Ok(Grouping::default_for(notation));
        }
        Grouping::from_name(text).ok_or(Error::Range(
            "useGrouping must be either true, false, \"min2\", \"auto\", or \"always\"",
        ))
    }
}

impl Style {
    /// Validates the `currency` option.
    pub fn currency(self, option: Option<Text<'_>>) -> Result<Option<Currency>> {
        match option {
            Some(text) => Currency::parse(text)
                .map(Some)
                .ok_or(Error::Range("currency is not a well-formed currency code")),
            None if self == Style::Currency => Err(MISSING_CURRENCY),
            None => Ok(None),
        }
    }

    /// Validates the `unit` option.
    pub fn unit(self, option: Option<Text<'_>>) -> Result<Option<Unit>> {
        match option {
            Some(text) => Unit::parse(text)
                .map(Some)
                .ok_or(Error::Range("unit is not a well-formed unit identifier")),
            None if self == Style::Unit => Err(MISSING_UNIT),
            None => Ok(None),
        }
    }
}

const MISSING_CURRENCY: Error = Error::Type("currency must be a string");
const MISSING_UNIT: Error = Error::Type("unit must be a string");

/// What SetNumberFormatUnitOptions reads, in this order.
#[derive(Default)]
pub struct RequestedStyle {
    pub style: Style,
    pub currency: Option<Currency>,
    pub currency_display: CurrencyDisplay,
    pub currency_sign: CurrencySign,
    pub unit: Option<Unit>,
    pub unit_display: UnitDisplay,
}

impl RequestedStyle {
    pub fn resolve(&self) -> Result<StyleOptions> {
        Ok(match self.style {
            Style::Decimal => StyleOptions::Decimal,
            Style::Percent => StyleOptions::Percent,
            Style::Currency => StyleOptions::Currency {
                currency: self.currency.ok_or(MISSING_CURRENCY)?,
                display: self.currency_display,
                sign: self.currency_sign,
            },
            Style::Unit => StyleOptions::Unit {
                unit: self.unit.ok_or(MISSING_UNIT)?,
                display: self.unit_display,
            },
        })
    }
}

/// A style with the options that apply to it.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum StyleOptions {
    Decimal,
    Percent,
    Currency {
        currency: Currency,
        display: CurrencyDisplay,
        sign: CurrencySign,
    },
    Unit {
        unit: Unit,
        display: UnitDisplay,
    },
}

impl StyleOptions {
    pub fn style(self) -> Style {
        match self {
            StyleOptions::Decimal => Style::Decimal,
            StyleOptions::Percent => Style::Percent,
            StyleOptions::Currency { .. } => Style::Currency,
            StyleOptions::Unit { .. } => Style::Unit,
        }
    }

    /// The rest of SetNumberFormatDigitOptions, which calls `to_number` in its order.
    pub fn resolve_digits<V, E: From<Error>>(
        self,
        requested: RequestedDigits<V>,
        notation: Notation,
        to_number: impl FnMut(V) -> core::result::Result<f64, E>,
    ) -> core::result::Result<DigitOptions, E> {
        let (minimum, maximum) = match self {
            StyleOptions::Currency { currency, .. } if notation == Notation::Standard => {
                (currency.digits(), currency.digits())
            }
            StyleOptions::Percent => (0, 0),
            _ => (0, 3),
        };
        requested.resolve(DigitRange { minimum, maximum }, notation, to_number)
    }
}

/// The options that do not take part in the choice of the locale, in the order that they are read.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Options {
    pub style: StyleOptions,
    pub notation: Notation,
    pub digits: DigitOptions,
    pub compact_display: CompactDisplay,
    pub grouping: Option<Grouping>,
    pub sign_display: SignDisplay,
}

impl Default for Options {
    fn default() -> Options {
        Options {
            style: StyleOptions::Decimal,
            notation: Notation::Standard,
            digits: DigitOptions::default(),
            compact_display: CompactDisplay::Short,
            grouping: Some(Grouping::Auto),
            sign_display: SignDisplay::Auto,
        }
    }
}
