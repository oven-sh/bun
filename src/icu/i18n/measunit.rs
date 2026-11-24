//! The units that ECMA-402 sanctions, quotients of two of them, what data make of these, and currencies. ICU4C: measunit.cpp

use crate::common::memory::try_box;
use crate::common::packed_strs;
use crate::common::udata::searches_files;
use crate::common::uresimp::ures_open_direct;
use crate::common::utypes::*;
use crate::i18n::measunit_data::BUILT_IN_KEYS;
use crate::i18n::measunit_extra::{Complexity, MeasureUnitImpl};
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

/// One of `BUILT_IN_KEYS`, of which `KEYS` are a part.
pub(crate) type UnitKey = &'static [u8];

/// ISO 4217 need not know the code.
pub(crate) type CurrencyCode = [u16; 3];

pub(crate) const NO_CURRENCY: CurrencyCode = [b'X' as u16; 3];

pub(crate) enum MeasureUnit {
    None,
    Currency(CurrencyCode),
    Named(UnitKey),
    Per(UnitKey, UnitKey),
    Parsed(Box<MeasureUnitImpl>),
}

#[inline(always)]
fn has_subtype(key: &[u8], identifier: &[u8]) -> bool {
    let parts = key.split_at_checked(key.len().wrapping_sub(identifier.len()));
    matches!(parts, Some(([.., b'/'], subtype)) if subtype == identifier)
}

fn find_key(identifier: &[u8]) -> Option<UnitKey> {
    KEYS.iter().find(|key| has_subtype(key, identifier))
}

pub(crate) fn find_by_sub_type(identifier: &[u8]) -> Option<UnitKey> {
    (BUILT_IN_KEYS.iter()).find(|key| has_subtype(key, identifier))
}

impl MeasureUnit {
    pub(crate) const PERCENT: Self = Self::Named(b"concentr/percent");

    /// Takes "meter", "meter-per-second" or "byte-per-day". Fails if the data of the units have been trimmed.
    pub(crate) fn for_identifier(identifier: &[u8]) -> Result<Self, UErrorCode> {
        if searches_files()? {
            return Self::parse(identifier);
        }
        ures_open_direct(None, b"units")?;
        let unit = find_key(identifier).map(Self::Named).or_else(|| {
            let mut parts = strings::split(identifier, b"-per-");
            let unit = Self::Per(find_key(parts.next()?)?, find_key(parts.next()?)?);
            parts.next().is_none().then_some(unit)
        });
        unit.ok_or(U_ILLEGAL_ARGUMENT_ERROR)
    }

    #[cold]
    fn parse(identifier: &[u8]) -> Result<Self, UErrorCode> {
        let mut parsed = MeasureUnitImpl::for_identifier(identifier)?;
        parsed.serialize()?;
        match find_by_sub_type(&parsed.identifier) {
            Some(key) => Ok(Self::Named(key)),
            None => try_box(parsed).map(Self::Parsed),
        }
    }

    pub(crate) fn currency(&self) -> Option<CurrencyCode> {
        match *self {
            Self::Currency(currency) => Some(currency),
            _ => None,
        }
    }

    pub(crate) fn is_percent(&self) -> bool {
        matches!(*self, Self::Named(b"concentr/percent"))
    }

    pub(crate) fn is_permille(&self) -> bool {
        matches!(*self, Self::Named(b"concentr/permille"))
    }

    pub(crate) fn as_mixed(&self) -> Option<&MeasureUnitImpl> {
        match self {
            Self::Parsed(parsed) if parsed.complexity == Complexity::Mixed => Some(parsed),
            _ => None,
        }
    }

    /// Takes "hour".
    pub(crate) fn duration(name: &[u8]) -> Option<Self> {
        find_key(name)
            .filter(|key| key.starts_with(b"duration/"))
            .map(Self::Named)
    }
}
