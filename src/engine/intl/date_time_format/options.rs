use bun_engine_date::TimeZone;
use bun_engine_text::Text;

use super::components::Components;
use crate::{Error, HourCycle, KeywordValue, Named, Result};

option_enum! {
    /// Only validated: the pattern is always the best fit.
    pub enum FormatMatcher: "formatMatcher must be either \"basic\" or \"best fit\"" {
        Basic = "basic",
        BestFit = "best fit",
    }
}

named_enum! {
    pub enum Style {
        Full = "full",
        Long = "long",
        Medium = "medium",
        Short = "short",
    }
}

impl Style {
    pub fn parse_date_style(text: Text<'_>) -> Result<Style> {
        let invalid = r#"dateStyle must be "full", "long", "medium", or "short""#;
        Style::from_name(text).ok_or(Error::Range(invalid))
    }

    pub fn parse_time_style(text: Text<'_>) -> Result<Style> {
        let invalid = r#"timeStyle must be "full", "long", "medium", or "short""#;
        Style::from_name(text).ok_or(Error::Range(invalid))
    }
}

/// The value of the `timeZone` option.
pub fn parse_time_zone(text: Text<'_>) -> Result<TimeZone> {
    bun_engine_temporal::find_time_zone(text).ok_or_else(|| {
        match Error::range_quoting("invalid time zone: ", text) {
            Error::OutOfMemory => Error::Range("invalid time zone"),
            quoting => quoting,
        }
    })
}

/// In the order in which CreateDateTimeFormat reads them, less the time zone and those that are only validated.
#[derive(Clone, PartialEq, Eq, Default, Debug)]
pub struct Options {
    pub calendar: Option<KeywordValue>,
    pub numbering_system: Option<KeywordValue>,
    pub hour12: Option<bool>,
    pub hour_cycle: Option<HourCycle>,
    pub components: Components,
    pub date_style: Option<Style>,
    pub time_style: Option<Style>,
}

/// The arguments `required` and `defaults` of CreateDateTimeFormat.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Purpose {
    /// `any` and `date`
    Constructor,
    /// `any` and `all`
    DateAndTime,
    /// `date` and `date`
    Date,
    /// `time` and `time`
    Time,
    /// `any` and `all`, with `toLocaleStringTimeZone`
    ZonedDateTime,
}
