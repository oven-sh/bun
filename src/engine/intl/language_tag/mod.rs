//! Unicode BCP 47 locale identifiers.

mod alias;
mod keyword;
mod language_id;
mod locale_id;
pub(crate) mod subtag;

use bun_engine_text::{CodeUnit, StaticString, StringRef, Text};

pub(crate) use keyword::Key;
pub use keyword::KeywordValue;
pub(crate) use language_id::{LanguageId, Variants, join};
pub(crate) use locale_id::LocaleId;
use subtag::{Subtags, is_singleton, is_value, lowercase_subtags};

use crate::Result;

static ENGLISH: [StaticString; 2] = [StaticString::new(b"en"), StaticString::new(b"en-US")];

/// Structurally valid and canonical.
#[derive(Clone, PartialEq, Eq, Debug)]
pub struct LanguageTag {
    string: StringRef,
    base_name_length: usize,
}

impl LanguageTag {
    /// `string` is canonical.
    fn new(string: StringRef) -> LanguageTag {
        let bytes = u8::units(string.text()).unwrap_or_default();
        let base_name_length = Subtags::new(bytes).run(|it| !is_singleton(it)).len();
        LanguageTag {
            string,
            base_name_length,
        }
    }

    /// `None` unless `text` is structurally valid.
    pub(crate) fn canonicalize(text: Text<'_>) -> Result<Option<LanguageTag>> {
        // The most common ones do not load the aliases.
        if let Some(tag) = ENGLISH.iter().find(|it| it.get().text() == text) {
            return Ok(Some(LanguageTag::new(StringRef::from_static(tag))));
        }
        let Some(subtags) = lowercase_subtags(text)? else {
            return Ok(None);
        };
        LocaleId::parse(&subtags)?
            .map(LocaleId::into_canonical)
            .transpose()
    }

    /// `parts` add up to a canonical tag.
    pub(crate) fn from_canonical_parts(parts: &[Text<'_>]) -> Result<LanguageTag> {
        Ok(LanguageTag::new(StringRef::try_concat(parts)?))
    }

    pub(crate) fn english() -> LanguageTag {
        LanguageTag::new(StringRef::from_static(&ENGLISH[0]))
    }

    pub fn string(&self) -> &StringRef {
        &self.string
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        u8::units(self.string.text()).unwrap_or_default()
    }

    /// `part` is a slice of `as_bytes`.
    pub(crate) fn substring(&self, part: &[u8]) -> StringRef {
        let range = self.as_bytes().subslice_range(part).unwrap_or_default();
        StringRef::substring(&self.string, range.into())
    }

    pub(crate) fn language(&self) -> &[u8] {
        Subtags::new(self.as_bytes()).next().unwrap_or_default()
    }

    /// What comes before the extensions.
    pub(crate) fn base_name(&self) -> &[u8] {
        &self.as_bytes()[..self.base_name_length]
    }

    /// The value of a key of the `u` extension, which is empty for `true`.
    pub(crate) fn keyword(&self, key: Key) -> Option<&[u8]> {
        let mut subtags = Subtags::new(self.as_bytes().get(self.base_name_length + 1..)?);
        match subtags.find(|it| matches!(*it, b"u" | b"x"))? {
            b"u" => subtags.find(|it| is_singleton(it) || *it == key.as_bytes()),
            _ => None,
        }
        .filter(|it| !is_singleton(it))?;
        Some(subtags.run(is_value))
    }
}
