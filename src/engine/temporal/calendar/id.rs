use bun_engine_text::{PropertyName, Text, names};

use crate::{Error, InputError, Result, TextError, parse};

macro_rules! calendars {
    ($($name:ident = $identifier:literal / $atom:ident,)*) => {
        /// An available calendar, by its canonical identifier.
        #[derive(Clone, Copy, PartialEq, Eq, Hash, Debug)]
        #[repr(u8)]
        pub enum CalendarId {
            $($name,)*
        }

        impl CalendarId {
            /// AvailableCalendars, in the order of their identifiers.
            pub const ALL: &[CalendarId] = &[$(CalendarId::$name,)*];

            pub const fn identifier(self) -> &'static str {
                match self {
                    $(CalendarId::$name => $identifier,)*
                }
            }

            /// The identifier, as an atom.
            pub(crate) const fn name(self) -> PropertyName<'static> {
                match self {
                    $(CalendarId::$name => names::$atom,)*
                }
            }
        }
    };
}

calendars! {
    Buddhist = "buddhist" / buddhist,
    Chinese = "chinese" / chinese,
    Coptic = "coptic" / coptic,
    Dangi = "dangi" / dangi,
    Ethioaa = "ethioaa" / ethioaa,
    Ethiopic = "ethiopic" / ethiopic,
    Gregory = "gregory" / gregory,
    Hebrew = "hebrew" / hebrew,
    Indian = "indian" / indian,
    IslamicCivil = "islamic-civil" / islamicCivil,
    IslamicTbla = "islamic-tbla" / islamicTbla,
    IslamicUmalqura = "islamic-umalqura" / islamicUmalqura,
    Iso8601 = "iso8601" / iso8601,
    Japanese = "japanese" / japanese,
    Persian = "persian" / persian,
    Roc = "roc" / roc,
}

const ALIASES: [(&str, CalendarId); 2] = [
    ("ethiopic-amete-alem", CalendarId::Ethioaa),
    ("islamicc", CalendarId::IslamicCivil),
];

impl CalendarId {
    /// By its identifier or an alias, ignoring ASCII case.
    pub fn find(name: Text<'_>) -> Option<CalendarId> {
        (CalendarId::ALL.iter())
            .map(|&calendar| (calendar.identifier(), calendar))
            .chain(ALIASES)
            .find(|(identifier, _)| name.eq_ignore_ascii_case(Text::from_ascii(identifier)))
            .map(|(_, calendar)| calendar)
    }

    /// CanonicalizeCalendar
    pub fn canonicalize(name: Text<'_>) -> Result<CalendarId, InputError<'_>> {
        CalendarId::find(name).ok_or(InputError::Text(TextError::Calendar, name))
    }

    /// CanonicalizeCalendar, in the constructors of the plain types.
    pub fn argument(name: Text<'_>) -> Result<CalendarId> {
        CalendarId::find(name).ok_or(Error::InvalidCalendarArgument)
    }

    /// ToTemporalCalendarIdentifier of a string.
    pub fn parse(text: Text<'_>) -> Result<CalendarId, InputError<'_>> {
        if let Some(calendar) = CalendarId::find(text) {
            return Ok(calendar);
        }
        match parse::any_date_or_time(text) {
            Some(parsed) if parsed.annotations.can_name_calendar() => {
                CalendarId::from_annotation(parsed.annotations.calendar)
            }
            _ => Err(InputError::Text(TextError::Calendar, text)),
        }
    }

    #[inline]
    pub(crate) fn from_annotation(name: Option<Text<'_>>) -> Result<CalendarId, InputError<'_>> {
        name.map_or(Ok(CalendarId::Iso8601), CalendarId::canonicalize)
    }

    pub(super) fn is_chinese_or_dangi(self) -> bool {
        matches!(self, CalendarId::Chinese | CalendarId::Dangi)
    }
}
