//! The states of the `type` attribute of `input`.

use super::microsyntax::*;
use super::steps::Steps;
use crate::api::core::{Known, atom};

macro_rules! types {
    ($($name:ident = $text:tt,)+) => {
        #[derive(Clone, Copy, Default, PartialEq, Eq)]
        pub(crate) enum InputType { #[default] Text, $($name),+ }

        impl InputType {
            pub(crate) fn from_keyword(keyword: Known) -> InputType {
                match keyword { $(atom!($text) => $name,)+ _ => Text }
            }

            pub(crate) fn name(self) -> Known {
                match self { $($name => atom!($text),)+ Text => atom!("text") }
            }
        }
    };
}
types! {
    Hidden = "hidden",
    Search = "search",
    Tel = "tel",
    Url = "url",
    Email = "email",
    Password = "password",
    Date = "date",
    Month = "month",
    Week = "week",
    Time = "time",
    DateTimeLocal = "datetime-local",
    Number = "number",
    Range = "range",
    Color = "color",
    Checkbox = "checkbox",
    Radio = "radio",
    File = "file",
    Submit = "submit",
    Image = "image",
    Reset = "reset",
    Button = "button",
}
use InputType::*;

/// https://html.spec.whatwg.org/#dom-input-value
#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ValueMode {
    Value,
    Default,
    DefaultOn,
    Filename,
}

impl InputType {
    pub(crate) fn value_mode(self) -> ValueMode {
        match self {
            Hidden | Submit | Image | Reset | Button => ValueMode::Default,
            Checkbox | Radio => ValueMode::DefaultOn,
            File => ValueMode::Filename,
            _ => ValueMode::Value,
        }
    }

    /// The user types the value.
    pub(crate) fn is_typed(self) -> bool {
        self.has_editor() || self.has_date_fields()
    }

    pub(crate) fn has_editor(self) -> bool {
        self.supports_selection() || matches!(self, Email | Number)
    }

    pub(crate) fn has_date_fields(self) -> bool {
        matches!(self, Date | Month | Week | Time | DateTimeLocal)
    }

    pub(crate) fn supports_selection(self) -> bool {
        matches!(self, Text | Search | Tel | Url | Password)
    }

    pub(crate) fn is_numeric(self) -> bool {
        self.has_date_fields() || matches!(self, Number | Range)
    }

    pub(crate) fn supports_date(self) -> bool {
        matches!(self, Date | Month | Week | Time)
    }

    pub(crate) fn is_checkable(self) -> bool {
        matches!(self, Checkbox | Radio)
    }

    pub(crate) fn is_button(self) -> bool {
        matches!(self, Submit | Image | Reset | Button)
    }

    pub(crate) fn has_directionality(self) -> bool {
        self.supports_selection() || matches!(self, Hidden | Email | Submit | Reset | Button)
    }

    pub(crate) fn default_label(self) -> &'static str {
        match self {
            Submit | Image => "Submit",
            Reset => "Reset",
            _ => "",
        }
    }

    /// The algorithm to convert a string to a number.
    pub(crate) fn parse(self, text: &[u8]) -> Option<f64> {
        match self {
            Number | Range => parse_valid_float(text),
            Date => parse_date(text),
            Month => parse_month(text),
            Week => parse_week(text),
            Time => parse_time(text),
            DateTimeLocal => parse_date_and_time(text),
            _ => None,
        }
    }

    /// The algorithm to convert a number to a string. Empty for one that is out of range.
    pub(crate) fn write(self, value: f64) -> Vec<u8> {
        let written = match self {
            Date => write_date(value),
            Month => write_month(value),
            Week => write_week(value),
            Time => Some(write_time(value, 0.0)),
            DateTimeLocal => write_date_and_time(value),
            _ => Some(write_float(value)),
        };
        written.unwrap_or_default()
    }

    /// https://html.spec.whatwg.org/#concept-input-step
    fn step(self, attribute: &[u8]) -> Option<f64> {
        if attribute.eq_ignore_ascii_case(b"any") {
            return None;
        }
        let given = parse_valid_float(attribute).filter(|it| *it > 0.0);
        let whole = |scale: f64| given.map_or(1.0, |it| it.round().max(1.0)) * scale;
        Some(match self {
            Date => whole(DAY),
            Month => whole(1.0),
            Week => whole(7.0 * DAY),
            Time | DateTimeLocal => (given.unwrap_or(60.0) * 1000.0).round().max(1.0),
            _ => given.unwrap_or(1.0),
        })
    }

    /// From the attributes, which are empty if they are missing.
    pub(crate) fn steps(self, min: &[u8], max: &[u8], step: &[u8], value: &[u8]) -> Steps {
        let (mut min, mut max) = (self.parse(min), self.parse(max));
        let base = min
            .or_else(|| self.parse(value))
            .unwrap_or(if self == Week { -3.0 * DAY } else { 0.0 });
        if self == Range {
            let least = *min.get_or_insert(0.0);
            max = Some(max.unwrap_or(100.0).max(least));
        }
        Steps {
            min,
            max,
            step: self.step(step),
            base,
            is_periodic: self == Time,
        }
    }
}

/// Whether `typed` can go between `left` and `right` in what is on its way to be a number.
pub(crate) fn fits_in_number(left: &[u8], typed: u8, right: &[u8]) -> bool {
    use bun_core::strings::index_of_any;
    let has = |text: &[u8], any: &[u8]| index_of_any(text, any).is_some();
    let is_before_sign = matches!(right, [b'+' | b'-', ..]);
    match typed {
        b'.' => {
            !has(left, b".eE")
                && !has(right, b".")
                && !has(
                    &right[..index_of_any(right, b"eE").unwrap_or(right.len())],
                    b"+-",
                )
        }
        b'e' | b'E' => !has(left, b"eE") && !has(right, b".eE"),
        b'+' | b'-' => {
            let signs = left
                .iter()
                .chain(right)
                .filter(|it| matches!(it, b'+' | b'-'))
                .count();
            signs < 2
                && !is_before_sign
                && (matches!(left, [] | [.., b'e' | b'E'])
                    || !has(left, b"eE") && !has(right, b"eE"))
        }
        b'0'..=b'9' => !left.is_empty() || !is_before_sign,
        _ => false,
    }
}
