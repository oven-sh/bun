//! The values of the `ca` key.

use core::ffi::CStr;

use bun_engine_temporal::CalendarId;
use bun_engine_text::Text;

use crate::error::IcuResult;
use crate::language_tag::Key;
use crate::locale_resolver::LocaleResolver;
use crate::{KeywordValue, Result};

pub(crate) fn bcp47_name(icu_name: &[u8]) -> &[u8] {
    match icu_name {
        b"ethiopic-amete-alem" => b"ethioaa",
        b"gregorian" => b"gregory",
        same => same,
    }
}

pub(crate) fn icu_name(bcp47_name: &[u8]) -> &[u8] {
    match bcp47_name {
        b"ethioaa" => b"ethiopic-amete-alem",
        b"gregory" => b"gregorian",
        same => same,
    }
}

/// The step of ResolveLocale for `ca`, and the fallback of CreateDateTimeFormat for the calendars that are supported but not
/// available. `None` stands for the default of the locale.
pub(crate) fn resolve(
    resolver: &mut LocaleResolver,
    option: Option<&KeywordValue>,
) -> Option<CalendarId> {
    let option = option.map(KeywordValue::as_bytes);
    (resolver.keyword(Key::CALENDAR, option, |name| match name {
        b"islamic" => Some(Some(CalendarId::IslamicTbla)),
        b"islamic-rgsa" => Some(None),
        _ => CalendarId::find(Text::Latin1(name)).map(Some),
    }))
    .flatten()
}

pub(crate) fn default_for(locale: &CStr) -> Result<CalendarId> {
    let failure = "invalid locale";
    let mut systems = bun_icu::calendar::common_systems(locale).or_type_error(failure)?;
    let preferred = systems.next().or_type_error(failure)?;
    Ok(preferred
        .and_then(|name| CalendarId::find(Text::Latin1(bcp47_name(name))))
        .unwrap_or(CalendarId::Gregory))
}
