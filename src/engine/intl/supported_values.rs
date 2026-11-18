use bun_engine_date::TimeZoneId;
use bun_engine_temporal::CalendarId;
use bun_engine_text::{StringRef, Text};
use bun_icu::currency::{self, NameStyle};

use crate::error::IcuResult;
use crate::language_tag::subtag::Subtag;
use crate::number_format::SANCTIONED_UNITS;
use crate::{NumberingSystem, OptionValue, Result, collation};

option_enum! {
    enum Key: "Unknown key for Intl.supportedValuesOf" {
        Calendar = "calendar",
        Collation = "collation",
        Currency = "currency",
        NumberingSystem = "numberingSystem",
        TimeZone = "timeZone",
        Unit = "unit",
    }
}

/// `Intl.supportedValuesOf`
pub fn supported_values_of(key: Text<'_>) -> Result<Vec<StringRef>> {
    Ok(match Key::parse(key)? {
        Key::Calendar => (CalendarId::ALL.iter())
            .map(|it| StringRef::from_literal(it.identifier()))
            .collect(),
        Key::Collation => to_strings(&collations()?),
        Key::Currency => to_strings(&currencies()?),
        Key::NumberingSystem => (NumberingSystem::all()?.iter())
            .map(|it| it.to_string_ref())
            .collect(),
        Key::TimeZone => (TimeZoneId::primaries().iter())
            .map(|it| StringRef::from_literal(it.identifier()))
            .collect(),
        Key::Unit => SANCTIONED_UNITS.map(StringRef::from_literal).into(),
    })
}

fn to_strings(names: &[Subtag]) -> Vec<StringRef> {
    (names.iter())
        .map(|name| StringRef::from_latin1(name.as_bytes()))
        .collect()
}

fn collations() -> Result<Vec<Subtag>> {
    let collations = bun_icu::collator::all_types().and_then(collation::collect);
    let collations = collations.or_type_error("failed to enumerate available collations")?;
    Ok(collations.into_vec())
}

fn currencies() -> Result<Vec<Subtag>> {
    let failure = "failed to enumerate available currencies";
    let mut codes = currency::all().or_type_error(failure)?;
    let mut currencies = Vec::new();
    while let Some(code) = codes.next().or_type_error(failure)? {
        // The list has some that `DisplayNames` does not know.
        if let Ok(letters) = code.try_into()
            && (currency::name(letters, c"en", NameStyle::Long).or_type_error(failure)?).is_some()
        {
            currencies.extend(Subtag::new(code));
        }
    }
    currencies.sort_unstable();
    Ok(currencies)
}
