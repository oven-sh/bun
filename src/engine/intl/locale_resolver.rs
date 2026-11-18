use bun_engine_text::Text;
use bun_icu::{Buffer, CText};

use crate::error::IcuResult;
use crate::language_tag::Key;
use crate::{AvailableLocales, Cache, LanguageTag, Result, calendar, collation};

/// ResolveLocale, with a call for each relevant extension key.
pub(crate) struct LocaleResolver {
    matched: ResolvedLocale,
    /// Each with a hyphen in front.
    supported_keywords: Buffer<u8>,
}

impl LocaleResolver {
    pub(crate) fn new(
        cache: &Cache,
        available: &AvailableLocales,
        requested: &[LanguageTag],
    ) -> LocaleResolver {
        let found = (requested.iter()).find_map(|tag| Some((tag, available.lookup(tag)?.len())));
        let (tag, data_locale_length) = match found {
            Some((tag, length)) => (tag.clone(), length),
            None => {
                let tag = cache.default_locale();
                let length = tag.as_bytes().len();
                (tag, length)
            }
        };
        LocaleResolver {
            matched: ResolvedLocale {
                tag,
                data_locale_length,
            },
            supported_keywords: Buffer::new(),
        }
    }

    /// `None` stands for the default of the locale. The keys come in ascending order.
    pub(crate) fn keyword<T>(
        &mut self,
        key: Key,
        option: Option<&[u8]>,
        supported: impl Fn(&[u8]) -> Option<T>,
    ) -> Option<T> {
        self.keyword_by_locale(key, option, |_, value| supported(value))
    }

    /// For a key whose values depend on the locale.
    pub(crate) fn keyword_by_locale<T>(
        &mut self,
        key: Key,
        option: Option<&[u8]>,
        supported: impl Fn(&ResolvedLocale, &[u8]) -> Option<T>,
    ) -> Option<T> {
        let supported = |value| supported(&self.matched, value);
        let written = self.matched.tag.keyword(key);
        let requested = written.map(|it| if it.is_empty() { b"true" } else { it });
        if option != requested
            && let Some(value) = option.and_then(supported)
        {
            return Some(value);
        }
        let value = supported(requested?)?;
        for subtags in [key.as_bytes(), written?] {
            if !subtags.is_empty() {
                self.supported_keywords.push(b'-');
                self.supported_keywords.extend_from_slice(subtags);
            }
        }
        Some(value)
    }

    pub(crate) fn finish(self) -> Result<ResolvedLocale> {
        let matched = self.matched;
        if matched.data_locale_length == matched.tag.as_bytes().len() {
            return Ok(matched);
        }
        let singleton = match *self.supported_keywords {
            [] => "",
            _ => "-u",
        };
        let tag = LanguageTag::from_canonical_parts(&[
            Text::Latin1(matched.data_locale()),
            Text::from_ascii(singleton),
            Text::Latin1(&self.supported_keywords),
        ])?;
        Ok(ResolvedLocale { tag, ..matched })
    }
}

#[derive(Clone, PartialEq, Eq)]
pub(crate) struct ResolvedLocale {
    tag: LanguageTag,
    data_locale_length: usize,
}

impl ResolvedLocale {
    /// For a constructor that has no relevant extension keys.
    pub(crate) fn new(
        cache: &Cache,
        available: &AvailableLocales,
        requested: &[LanguageTag],
    ) -> Result<ResolvedLocale> {
        LocaleResolver::new(cache, available, requested).finish()
    }

    pub(crate) fn tag(&self) -> &LanguageTag {
        &self.tag
    }

    fn data_locale(&self) -> &[u8] {
        &self.tag.as_bytes()[..self.data_locale_length]
    }

    /// The locale whose data is used, with values of `ca`, `co`, `hc` and `nu`.
    pub(crate) fn icu_locale(&self, keywords: &[(Key, &[u8])]) -> Result<CText> {
        let mut id = Buffer::from_slice(self.data_locale());
        let mut separator = b'@';
        for &(key, value) in keywords {
            let (key, value): (&[u8], _) = match key {
                Key::CALENDAR => (b"calendar", calendar::icu_name(value)),
                Key::COLLATION => (b"collation", collation::icu_name(value)),
                Key::HOUR_CYCLE => (b"hours", value),
                Key::NUMBERING_SYSTEM => (b"numbers", value),
                _ => (key.as_bytes(), value),
            };
            for part in [&[separator], key, b"=", value] {
                id.extend_from_slice(part);
            }
            separator = b';';
        }
        CText::from_buffer(id).or_type_error("invalid locale")
    }
}
