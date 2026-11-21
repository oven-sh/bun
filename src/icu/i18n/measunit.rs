//! The units that ECMA-402 sanctions, quotients of two of them, and currencies. ICU4C: measunit.cpp

use crate::common::packed_strs;
use crate::common::uresimp::ures_open_direct;
use bun_core::strings;

packed_strs! {
    /// The keys of the units in the tables of the `unit` bundles. Five quotients have names of their own.
    static KEYS = [
        "angle/degree", "area/acre", "area/hectare", "concentr/percent", "consumption/liter-per-kilometer",
        "consumption/mile-per-gallon", "digital/bit", "digital/byte", "digital/gigabit", "digital/gigabyte",
        "digital/kilobit", "digital/kilobyte", "digital/megabit", "digital/megabyte", "digital/petabyte",
        "digital/terabit", "digital/terabyte", "duration/day", "duration/hour", "duration/microsecond",
        "duration/millisecond", "duration/minute", "duration/month", "duration/nanosecond", "duration/second",
        "duration/week", "duration/year", "length/centimeter", "length/foot", "length/inch", "length/kilometer",
        "length/meter", "length/mile", "length/mile-scandinavian", "length/millimeter", "length/yard", "mass/gram",
        "mass/kilogram", "mass/ounce", "mass/pound", "mass/stone", "speed/kilometer-per-hour",
        "speed/meter-per-second", "speed/mile-per-hour", "temperature/celsius", "temperature/fahrenheit",
        "volume/fluid-ounce", "volume/gallon", "volume/liter", "volume/milliliter",
    ];
}

/// One of `KEYS`.
pub(crate) type UnitKey = &'static [u8];

/// Three upper-case ASCII letters, which ISO 4217 need not know.
pub(crate) type CurrencyCode = [u16; 3];

#[derive(Clone, Copy, PartialEq)]
pub(crate) enum MeasureUnit {
    None,
    Currency(CurrencyCode),
    Named(UnitKey),
    Per(UnitKey, UnitKey),
}

fn find_key(identifier: &[u8]) -> Option<UnitKey> {
    KEYS.iter().find(|key| {
        let parts = key.split_at_checked(key.len().wrapping_sub(identifier.len()));
        matches!(parts, Some(([.., b'/'], subtype)) if subtype == identifier)
    })
}

impl MeasureUnit {
    pub(crate) const PERCENT: Self = Self::Named(b"concentr/percent");

    /// Takes "meter", "meter-per-second" or "byte-per-day". Fails if the data of the units have been trimmed.
    pub(crate) fn for_identifier(identifier: &[u8]) -> Option<Self> {
        ures_open_direct(None, b"units").ok()?;
        find_key(identifier).map(Self::Named).or_else(|| {
            let mut parts = strings::split(identifier, b"-per-");
            let unit = Self::Per(find_key(parts.next()?)?, find_key(parts.next()?)?);
            parts.next().is_none().then_some(unit)
        })
    }

    /// Takes "hour".
    pub(crate) fn duration(name: &[u8]) -> Option<Self> {
        find_key(name)
            .filter(|key| key.starts_with(b"duration/"))
            .map(Self::Named)
    }
}
