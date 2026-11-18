use bun_engine_text::Text;
use bun_icu::{Buffer, CText};

use super::alias::subdivision_replacement;
use super::subtag::{Subtags, is_value, lowercase_subtags};
use crate::{Error, Result};

/// A key of the `u` or of the `t` extension.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Debug)]
pub(crate) struct Key([u8; 2]);

impl Key {
    pub(crate) const CALENDAR: Key = Key(*b"ca");
    pub(crate) const COLLATION: Key = Key(*b"co");
    pub(crate) const FIRST_DAY: Key = Key(*b"fw");
    pub(crate) const HOUR_CYCLE: Key = Key(*b"hc");
    pub(crate) const CASE_FIRST: Key = Key(*b"kf");
    pub(crate) const NUMERIC: Key = Key(*b"kn");
    pub(crate) const NUMBERING_SYSTEM: Key = Key(*b"nu");
    pub(crate) const REGION_OVERRIDE: Key = Key(*b"rg");
    pub(crate) const SUBDIVISION: Key = Key(*b"sd");
    pub(crate) const VARIANT: Key = Key(*b"va");

    pub(crate) fn new(subtag: &[u8]) -> Option<Key> {
        subtag.try_into().ok().map(Key)
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.0
    }

    /// Calls `with` on the value that CLDR prefers to `value`, which is in lower case.
    pub(crate) fn with_preferred_value<T>(self, value: &[u8], with: impl FnOnce(&[u8]) -> T) -> T {
        /// More than any alias has.
        const MAX_ALIAS_LENGTH: usize = 32;

        match self {
            Key::REGION_OVERRIDE | Key::SUBDIVISION => match subdivision_replacement(value) {
                Some(replacement) => with(replacement.as_bytes()),
                None => with(value),
            },
            // The keys of ECMA-402 do not load the tables of all others.
            Key::CALENDAR => with(match value {
                b"ethiopic-amete-alem" => b"ethioaa",
                b"islamicc" => b"islamic-civil",
                _ => value,
            }),
            Key::NUMERIC if value == b"yes" => with(b"true"),
            Key::COLLATION
            | Key::FIRST_DAY
            | Key::HOUR_CYCLE
            | Key::CASE_FIRST
            | Key::NUMERIC
            | Key::NUMBERING_SYSTEM => with(value),
            _ if value.is_empty() || value.len() > MAX_ALIAS_LENGTH => with(value),
            _ => match (CText::new(&self.0), CText::new(value)) {
                (Ok(key), Ok(alias)) => {
                    with(bun_icu::locale::unicode_type(&key, &alias).unwrap_or(value))
                }
                _ => with(value),
            },
        }
    }
}

/// An option that overrides a keyword of the locale, in canonical form.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct KeywordValue(Buffer<u8>);

impl KeywordValue {
    pub fn calendar(text: Text<'_>) -> Result<KeywordValue> {
        let malformed = "calendar is not a well-formed calendar value";
        KeywordValue::parse(Key::CALENDAR, text)?.ok_or(Error::Range(malformed))
    }

    pub fn collation(text: Text<'_>) -> Result<KeywordValue> {
        let malformed = "collation is not a well-formed collation value";
        KeywordValue::parse(Key::COLLATION, text)?.ok_or(Error::Range(malformed))
    }

    pub fn numbering_system(text: Text<'_>) -> Result<KeywordValue> {
        let malformed = "numberingSystem is not a well-formed numbering system value";
        KeywordValue::parse(Key::NUMBERING_SYSTEM, text)?.ok_or(Error::Range(malformed))
    }

    /// CanonicalizeUValue, if `text` matches `type` of UTS #35.
    pub(crate) fn parse(key: Key, text: Text<'_>) -> Result<Option<KeywordValue>> {
        let value = lowercase_subtags(text)?.filter(|value| Subtags::new(value).all(is_value));
        Ok(value.map(|value| {
            let preferred = key.with_preferred_value(&value, |preferred| {
                (preferred != &value[..]).then(|| Buffer::from_slice(preferred))
            });
            KeywordValue(preferred.unwrap_or(value))
        }))
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        &self.0
    }
}
