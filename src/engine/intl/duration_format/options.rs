use bun_engine_temporal::Unit;
use bun_engine_text::{PropertyName, Text, names};

use crate::{Error, KeywordValue, Named, Result, integer_option};

option_enum! {
    #[derive(Default)]
    pub enum Style: "style must be either \"long\", \"short\", \"narrow\", or \"digital\"" {
        Long = "long",
        #[default]
        Short = "short",
        Narrow = "narrow",
        Digital = "digital",
    }
}

named_enum! {
    pub enum UnitStyle {
        Long = "long",
        Short = "short",
        Narrow = "narrow",
        /// Stands for `fractional` below the second.
        Numeric = "numeric",
        TwoDigit = "2-digit",
    }
}

option_enum! {
    pub enum Display: "display name must be either \"auto\" or \"always\"" {
        Auto = "auto",
        Always = "always",
    }
}

impl UnitStyle {
    pub fn parse(unit: Unit, text: Text<'_>) -> Result<UnitStyle> {
        let (count, invalid) = if unit > Unit::Hour {
            (3, r#"style must be either "long", "short", or "narrow""#)
        } else if unit < Unit::Second {
            let invalid = r#"style must be either "long", "short", "narrow", or "numeric""#;
            (4, invalid)
        } else {
            let invalid =
                r#"style must be either "long", "short", "narrow" or "numeric", or "2-digit""#;
            (5, invalid)
        };
        UnitStyle::from_name(text)
            .filter(|style| UnitStyle::ALL[..count].contains(style))
            .ok_or(Error::Range(invalid))
    }

    pub(super) fn is_numeric(self) -> bool {
        matches!(self, UnitStyle::Numeric | UnitStyle::TwoDigit)
    }
}

/// The names of the options for the style and the display of a unit.
pub fn properties(unit: Unit) -> [PropertyName<'static>; 2] {
    match unit {
        Unit::Year => [names::years, names::yearsDisplay],
        Unit::Month => [names::months, names::monthsDisplay],
        Unit::Week => [names::weeks, names::weeksDisplay],
        Unit::Day => [names::days, names::daysDisplay],
        Unit::Hour => [names::hours, names::hoursDisplay],
        Unit::Minute => [names::minutes, names::minutesDisplay],
        Unit::Second => [names::seconds, names::secondsDisplay],
        Unit::Millisecond => [names::milliseconds, names::millisecondsDisplay],
        Unit::Microsecond => [names::microseconds, names::microsecondsDisplay],
        Unit::Nanosecond => [names::nanoseconds, names::nanosecondsDisplay],
    }
}

/// A Duration Unit Options Record.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct UnitOptions {
    pub style: UnitStyle,
    pub display: Display,
}

/// The style of the format, and the options of each unit.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Units {
    style: Style,
    options: [UnitOptions; Unit::ALL.len()],
}

impl Units {
    pub fn new(style: Style) -> Units {
        let options = [UnitOptions {
            style: UnitStyle::Short,
            display: Display::Auto,
        }; Unit::ALL.len()];
        let mut units = Units { style, options };
        for unit in Unit::ALL {
            units.options[unit as usize] = units.complete(unit, None, None);
        }
        units
    }

    /// GetDurationUnitOptions, for each of `Unit::ALL` in turn.
    pub fn set(
        &mut self,
        unit: Unit,
        style: Option<UnitStyle>,
        display: Option<Display>,
    ) -> Result<()> {
        let options = self.complete(unit, style, display);
        let is_fractional = unit < Unit::Second && options.style.is_numeric();
        if (is_fractional && options.display == Display::Always)
            || (self.follows_numeric(unit) && !options.style.is_numeric())
        {
            return Err(Error::Range("style option is inconsistent"));
        }
        self.options[unit as usize] = options;
        Ok(())
    }

    fn follows_numeric(&self, unit: Unit) -> bool {
        unit < Unit::Hour && self.options[unit as usize - 1].style.is_numeric()
    }

    fn complete(
        &self,
        unit: Unit,
        requested: Option<UnitStyle>,
        display: Option<Display>,
    ) -> UnitOptions {
        let follows_numeric = self.follows_numeric(unit);
        let mut style = requested.unwrap_or(match self.style {
            Style::Digital if unit > Unit::Hour => UnitStyle::Short,
            Style::Digital => UnitStyle::Numeric,
            _ if follows_numeric => UnitStyle::Numeric,
            Style::Long => UnitStyle::Long,
            Style::Short => UnitStyle::Short,
            Style::Narrow => UnitStyle::Narrow,
        });
        let is_always_displayed = if style.is_numeric() {
            unit >= Unit::Second
        } else {
            requested.is_some()
        };
        if follows_numeric && style.is_numeric() && unit >= Unit::Second {
            style = UnitStyle::TwoDigit;
        }
        UnitOptions {
            style,
            display: display.unwrap_or(if is_always_displayed {
                Display::Always
            } else {
                Display::Auto
            }),
        }
    }

    pub fn style(&self) -> Style {
        self.style
    }

    pub fn get(&self, unit: Unit) -> UnitOptions {
        self.options[unit as usize]
    }

    /// NextUnitFractional
    pub(super) fn has_fraction(&self, unit: Unit) -> bool {
        unit <= Unit::Second
            && (self.options.get(unit as usize + 1)).is_some_and(|next| next.style.is_numeric())
    }
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct FractionalDigits(u8);

impl FractionalDigits {
    /// The validation of GetNumberOption.
    pub fn new(number: f64) -> Result<FractionalDigits> {
        integer_option(number, 0..=9, "fractionalDigits is out of range")
            .map(|digits| FractionalDigits(digits as u8))
    }

    pub fn get(self) -> u8 {
        self.0
    }
}

#[derive(Clone, PartialEq, Eq, Debug)]
pub struct Options {
    pub numbering_system: Option<KeywordValue>,
    pub units: Units,
    pub fractional_digits: Option<FractionalDigits>,
}
