//! Patterns and skeletons of UTS #35, part 4.

use core::ops::Range;

use bun_icu::Buffer;
use bun_icu::date_pattern;

use super::components::{Component, ComponentStyle, ComponentValue, Components};
use crate::HourCycle;

const QUOTE: u16 = b'\'' as u16;

/// A run of one letter outside quotes.
pub(super) struct Field {
    pub(super) letter: u8,
    pub(super) range: Range<usize>,
}

impl Field {
    /// The first field from `start` on, which is outside quotes.
    fn find(pattern: &[u16], start: usize) -> Option<Field> {
        // Two quotes in a row stand for one, and leave the state as it was.
        let mut is_quoted = false;
        for (index, &unit) in pattern.iter().enumerate().skip(start) {
            match u8::try_from(unit) {
                Ok(letter) if letter.is_ascii_alphabetic() && !is_quoted => {
                    let count = pattern[index..].iter().take_while(|&&it| it == unit);
                    let range = index..index + count.count();
                    return Some(Field { letter, range });
                }
                _ => is_quoted ^= unit == QUOTE,
            }
        }
        None
    }

    pub(super) fn component(&self) -> Option<Component> {
        Some(match self.letter {
            b'E' | b'e' | b'c' => Component::Weekday,
            b'G' => Component::Era,
            b'y' | b'Y' | b'u' | b'U' | b'r' => Component::Year,
            b'M' | b'L' => Component::Month,
            b'd' => Component::Day,
            b'a' | b'b' | b'B' => Component::DayPeriod,
            b'h' | b'H' | b'k' | b'K' | b'j' => Component::Hour,
            b'm' => Component::Minute,
            b's' => Component::Second,
            b'S' => Component::FractionalSecondDigits,
            b'z' | b'Z' | b'O' | b'v' | b'V' | b'X' | b'x' => Component::TimeZoneName,
            _ => return None,
        })
    }

    /// What `resolvedOptions` reports.
    fn value(&self) -> Option<ComponentValue> {
        use ComponentStyle::*;
        let count = self.range.len();
        let style = match (self.letter, count) {
            (b'S', _) => return u8::try_from(count).ok().map(ComponentValue::Digits),
            (b'y', 2) => TwoDigit,
            (b'y', _) => Numeric,
            (b'M' | b'L' | b'd' | b'h' | b'H' | b'k' | b'K' | b'm' | b's', 1) => Numeric,
            (b'M' | b'L' | b'd' | b'h' | b'H' | b'k' | b'K' | b'm' | b's', 2) => TwoDigit,
            (b'M' | b'L' | b'E' | b'e' | b'c' | b'G' | b'b' | b'B', ..=3) | (b'z', 1) => Short,
            (b'M' | b'L' | b'E' | b'e' | b'c' | b'G' | b'b' | b'B' | b'z', 4) => Long,
            (b'M' | b'L' | b'E' | b'e' | b'c' | b'G' | b'b' | b'B', 5) => Narrow,
            (b'O', 1) => ShortOffset,
            (b'O', 4) => LongOffset,
            (b'v' | b'V', 1) => ShortGeneric,
            (b'v' | b'V', 4) => LongGeneric,
            _ => return None,
        };
        Some(ComponentValue::Style(style))
    }

    fn hour_cycle(&self) -> Option<HourCycle> {
        Some(match self.letter {
            b'K' => HourCycle::H11,
            b'h' => HourCycle::H12,
            b'H' => HourCycle::H23,
            b'k' => HourCycle::H24,
            _ => return None,
        })
    }
}

pub(super) fn fields(pattern: &[u16]) -> impl Iterator<Item = Field> {
    core::iter::successors(Field::find(pattern, 0), |previous| {
        Field::find(pattern, previous.range.end)
    })
}

/// The text that what is between two fields stands for.
pub(super) fn unquote(literal: &[u16]) -> impl Iterator<Item = u16> {
    let mut units = literal.iter().copied().peekable();
    core::iter::from_fn(move || {
        loop {
            let unit = units.next()?;
            if unit != QUOTE || units.next_if_eq(&QUOTE).is_some() {
                return Some(unit);
            }
        }
    })
}

/// Puts the letter that `replacement` returns in place of that of a field.
fn replace_letters(pattern: &mut [u16], replacement: impl Fn(&Field) -> Option<u8>) {
    let mut start = 0;
    while let Some(field) = Field::find(pattern, start) {
        start = field.range.end;
        if let Some(letter) = replacement(&field) {
            pattern[field.range].fill(letter.into());
        }
    }
}

pub(super) fn components(pattern: &[u16]) -> Components {
    let mut components = Components::default();
    for field in fields(pattern) {
        if let (Some(component), Some(value)) = (field.component(), field.value()) {
            components.set(component, value);
        }
    }
    components
}

pub(crate) fn hour_cycle(pattern: &[u16]) -> Option<HourCycle> {
    fields(pattern).find_map(|field| field.hour_cycle())
}

pub(super) fn set_hour_letter(pattern: &mut [u16], letter: u8) {
    replace_letters(pattern, |field| {
        (field.component() == Some(Component::Hour)).then_some(letter)
    });
}

pub(super) fn set_hour_cycle(pattern: &mut [u16], cycle: HourCycle) {
    let letter = match cycle {
        HourCycle::H11 => b'K',
        HourCycle::H12 => b'h',
        HourCycle::H23 => b'H',
        HourCycle::H24 => b'k',
    };
    set_hour_letter(pattern, letter);
}

/// No option asks for the year that weeks are counted in, but some locales have it in place of the year of the calendar.
pub(super) fn use_calendar_year(pattern: &mut [u16]) {
    replace_letters(pattern, |field| (field.letter == b'Y').then_some(b'y'));
}

pub(super) fn skeleton(pattern: &[u16]) -> bun_icu::Result<Buffer<u16>> {
    // Literal text counts towards the number of items that ICU looks at.
    let mut without_literals = Buffer::new();
    for field in fields(pattern) {
        without_literals.extend_from_slice(&pattern[field.range]);
        without_literals.push(b' '.into());
    }
    date_pattern::skeleton(&without_literals)
}
