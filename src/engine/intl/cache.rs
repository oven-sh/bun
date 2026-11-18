use core::cell::{Cell, RefCell};

use bun_engine_text::{StringImpl, StringRef, Text};

use crate::collator::Collator;
use crate::date_time_format::DateCache;
use crate::default_instances::DefaultInstances;
use crate::display_names::DisplayNames;
use crate::duration_format::DurationFormat;
use crate::list_format::ListFormat;
use crate::number_format::NumberFormat;
use crate::plural_rules::PluralRules;
use crate::recent::RecentSet;
use crate::segmenter::Segmenter;
use crate::{Error, LanguageTag, Result, relative_time_format};

const CANONICAL_TAG_SLOTS: usize = 32;
const MAX_DEFAULT_LOCALE_LENGTH: usize = 32;

/// What the constructors and the locale-sensitive functions of one VM share.
#[derive(Default)]
pub struct Cache {
    /// By the hash of the tag as it was written.
    canonical_tags: RefCell<[Option<(StringRef, LanguageTag)>; CANONICAL_TAG_SLOTS]>,
    default_locale: RefCell<Option<LanguageTag>>,
    allocated_bytes: Cell<usize>,
    pub(crate) collators: RecentSet<Collator, 4>,
    pub(crate) default_collators: DefaultInstances<Collator>,
    pub(crate) dates: DateCache,
    pub(crate) display_names: RecentSet<DisplayNames, 4>,
    pub(crate) duration_formats: RecentSet<DurationFormat, 4>,
    pub(crate) list_formats: RecentSet<ListFormat, 4>,
    pub(crate) number_formats: RecentSet<NumberFormat, 8>,
    pub(crate) default_number_formats: DefaultInstances<NumberFormat>,
    pub(crate) plural_rules: RecentSet<PluralRules, 4>,
    pub(crate) relative_time_formatters: RecentSet<relative_time_format::Formatter, 4>,
    pub(crate) segmenters: RecentSet<Segmenter, 4>,
}

impl Cache {
    /// The steps of CanonicalizeLocaleList for a string.
    pub fn canonicalize(&self, tag: &StringImpl) -> Result<LanguageTag> {
        self.canonicalize_if_valid(tag)?
            .ok_or_else(|| Error::range_quoting("invalid language tag: ", tag.text()))
    }

    pub(crate) fn canonicalize_if_valid(&self, tag: &StringImpl) -> Result<Option<LanguageTag>> {
        if !is_worth_keeping(tag) {
            return LanguageTag::canonicalize(tag.text());
        }
        let slot = &mut self.canonical_tags.borrow_mut()[tag.hash() as usize % CANONICAL_TAG_SLOTS];
        if let Some((written, canonical)) = slot
            && **written == *tag
        {
            return Ok(Some(canonical.clone()));
        }
        let canonical = LanguageTag::canonicalize(tag.text())?;
        if let Some(canonical) = &canonical {
            *slot = Some((keep(tag), canonical.clone()));
        }
        Ok(canonical)
    }

    /// DefaultLocale
    pub(crate) fn default_locale(&self) -> LanguageTag {
        (self.default_locale.borrow_mut())
            .get_or_insert_with(|| {
                first_locale(&[Text::Latin1(bun_icu::host_language().to_bytes())])
            })
            .clone()
    }

    /// An estimate of the memory that new objects have taken since the last call, for the collector to take into account.
    #[inline]
    pub fn take_allocated_bytes(&self) -> usize {
        self.allocated_bytes.take()
    }

    pub(crate) fn note_allocation(&self, bytes: usize) {
        self.allocated_bytes.update(|it| it.saturating_add(bytes));
    }

    /// In place of the language of the host.
    pub fn set_preferred_languages(&mut self, languages: &[Text<'_>]) {
        *self = Cache::default();
        if !languages.is_empty() {
            *self.default_locale.get_mut() = Some(first_locale(languages));
        }
    }
}

pub(crate) fn is_worth_keeping(tag: &StringImpl) -> bool {
    tag.len() <= 100
}

/// Without the string that `tag` may be a part of.
pub(crate) fn keep(tag: &StringImpl) -> StringRef {
    match tag.is_substring() {
        true => StringRef::from_text(tag.text()),
        false => StringRef::retain(tag),
    }
}

fn first_locale(languages: &[Text<'_>]) -> LanguageTag {
    let without_extensions = |language: Text<'_>| {
        let tag = LanguageTag::canonicalize(language).ok()??;
        let base_name = tag.base_name();
        if base_name.len() > MAX_DEFAULT_LOCALE_LENGTH {
            return None;
        }
        LanguageTag::from_canonical_parts(&[Text::Latin1(base_name)]).ok()
    };
    (languages.iter().copied())
        .find_map(without_extensions)
        .or_else(|| {
            let tag = bun_icu::locale::to_language_tag(bun_icu::locale::default()).ok()?;
            without_extensions(Text::Latin1(&tag))
        })
        .unwrap_or_else(LanguageTag::english)
}
