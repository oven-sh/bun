use bun_engine_text::{CodeUnit, Text, with_text};

use super::cursor::Cursor;
use crate::unit::NANOSECONDS_PER_MINUTE;

/// A Time Zone Identifier Parse Record. The name need not be an available one.
#[derive(Clone, Copy)]
pub(crate) enum ZoneIdentifier<'a> {
    Name(Text<'a>),
    OffsetMinutes(i16),
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Annotations<'a> {
    pub(crate) time_zone: Option<ZoneIdentifier<'a>>,
    pub(crate) calendar: Option<Text<'a>>,
}

impl Annotations<'_> {
    /// False if the calendar does not have the form of `type` in UTS #35, as every calendar identifier does.
    #[inline]
    pub(crate) fn can_name_calendar(&self) -> bool {
        self.calendar.is_none_or(|calendar| {
            with_text!(calendar, |units| units
                .split(|unit| unit.is(b'-'))
                .all(|component| (3..=8).contains(&component.len())))
        })
    }

    pub(super) fn is_iso_calendar(&self) -> bool {
        self.calendar
            .is_none_or(|calendar| calendar.eq_ignore_ascii_case(Text::from_ascii("iso8601")))
    }
}

/// ParseTimeZoneIdentifier
pub(crate) fn time_zone_identifier(text: Text<'_>) -> Option<ZoneIdentifier<'_>> {
    with_text!(text, |units| Cursor::parse_all(
        units,
        Cursor::time_zone_identifier
    ))
}

fn has_empty_component<T: CodeUnit>(units: &[T], separator: u8) -> bool {
    units.split(|unit| unit.is(separator)).any(<[T]>::is_empty)
}

impl<'a, T: CodeUnit> Cursor<'a, T> {
    fn time_zone_identifier(&mut self) -> Option<ZoneIdentifier<'a>> {
        if matches!(self.peek(), b'+' | b'-') {
            let (nanoseconds, false) = self.utc_offset()? else {
                return None;
            };
            let minutes = nanoseconds / NANOSECONDS_PER_MINUTE;
            return Some(ZoneIdentifier::OffsetMinutes(minutes as i16));
        }
        let mut previous = b'/';
        let name = self.take_while(|next| {
            let starts_component = core::mem::replace(&mut previous, next) == b'/';
            match next {
                b'a'..=b'z' | b'A'..=b'Z' | b'.' | b'_' => true,
                b'0'..=b'9' | b'-' | b'+' | b'/' => !starts_component,
                _ => false,
            }
        });
        let is_complete = name.last().is_some_and(|last| !last.is(b'/'));
        is_complete.then(|| ZoneIdentifier::Name(T::text(name)))
    }

    /// An AnnotationKey and the `=` after it. Takes nothing if that is not what follows.
    fn annotation_key(&mut self) -> Option<&'a [T]> {
        let mut rest = *self;
        if !matches!(rest.peek(), b'a'..=b'z' | b'_') {
            return None;
        }
        let key = rest.take_while(|next| matches!(next, b'a'..=b'z' | b'_' | b'0'..=b'9' | b'-'));
        rest.expect(b'=')?;
        *self = rest;
        Some(key)
    }

    fn annotation_value(&mut self) -> Option<&'a [T]> {
        let value = self.take_while(|next| next.is_ascii_alphanumeric() || next == b'-');
        (!has_empty_component(value, b'-')).then_some(value)
    }

    /// An optional TimeZoneAnnotation and optional Annotations. `annotations` is empty.
    #[inline(always)]
    pub(super) fn annotations(&mut self, annotations: &mut Annotations<'a>) -> Option<()> {
        if self.peek() != b'[' {
            return Some(());
        }
        self.bracketed_annotations(annotations)
    }

    fn bracketed_annotations(&mut self, annotations: &mut Annotations<'a>) -> Option<()> {
        let mut is_first = true;
        let mut calendar_is_critical = false;
        while self.eat(b'[') {
            let is_critical = self.eat(b'!');
            if let Some(key) = self.annotation_key() {
                let value = self.annotation_value()?;
                if !T::text(key).eq_ascii("u-ca") {
                    if is_critical {
                        return None;
                    }
                } else if annotations.calendar.is_none() {
                    annotations.calendar = Some(T::text(value));
                    calendar_is_critical = is_critical;
                } else if is_critical || calendar_is_critical {
                    return None;
                }
            } else if is_first {
                annotations.time_zone = Some(self.time_zone_identifier()?);
            } else {
                return None;
            }
            self.expect(b']')?;
            is_first = false;
        }
        Some(())
    }
}
