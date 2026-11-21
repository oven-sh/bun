//! Display names of locales and their parts, capitalized for stand-alone use. ICU4C: locdspnm.cpp

use crate::common::brkiter::BreakIterator;
use crate::common::bytes::U16s;
use crate::common::charstr::SmallChars;
use crate::common::locid::Locale;
use crate::common::locresdata::{find_replacement, uloc_get_table_string_with_fallback};
use crate::common::memory::{Appendable, try_box_result};
use crate::common::resource::ResourceValue;
use crate::common::simpleformatter::SimpleFormatter;
use crate::common::slice_ext::SliceExt;
use crate::common::ucase::CaseLocale;
use crate::common::uchar::u_islower;
use crate::common::uloc_data::KNOWN_LANGUAGES;
use crate::common::umutex::Mutex;
use crate::common::unistr::{UStr, from_invariant, from_units, ustr};
use crate::common::uresimp::*;
use crate::common::ustrcase::to_title;
use crate::common::utypes::*;
use bun_core::strings;

type Name = Result<Vec<u16>, UErrorCode>;

fn find(locale: &Locale, tree: &'static [u8], table: &[u8], item: &[u8]) -> Option<U16s<'static>> {
    uloc_get_table_string_with_fallback(Some(tree), locale.get_name(), table, item).ok()
}

/// Returns the name of `region` as the data have it, or `region` itself if they have none.
pub(crate) fn region_name_or_code(locale: &Locale, region: &[u8]) -> Vec<u16> {
    find(locale, U_ICUDATA_REGION, b"Countries", region)
        .map_or_else(|| from_invariant(region), |name| from_units(name.iter()))
}

#[derive(Clone, Copy)]
enum CapContextUsage {
    Language,
    Script,
    Territory,
    KeyValue,
}

pub(crate) struct LocaleDisplayNames {
    locale: Locale,
    uses_dialect_names: bool,
    is_short: bool,
    separator_format: SimpleFormatter,
    format: SimpleFormatter,
    /// The parentheses of `format`, each with its replacement inside a part.
    paren_replacements: [(u16, u16); 2],
    /// Whether to titlecase, indexed by `CapContextUsage`.
    capitalization: [bool; 4],
    /// `None` if no name is titlecased. The inner `Option` is `None` while a thread uses the iterator.
    capitalization_brk_iter: Option<Mutex<Option<Box<BreakIterator>>>>,
}

// ICU4C: locdspnm.cpp, CapitalizationContextSink
fn load_capitalization(locale: &Locale) -> Result<[bool; 4], UErrorCode> {
    const FOR_STANDALONE: usize = 1;
    let mut capitalization = [false; _];
    let mut sink = |value: &ResourceValue| {
        for (key, value) in value.get_table()?.iter() {
            let usage = match key {
                b"keyValue" => CapContextUsage::KeyValue,
                b"languages" => CapContextUsage::Language,
                b"script" => CapContextUsage::Script,
                b"territory" => CapContextUsage::Territory,
                _ => continue,
            };
            if value.get_int_vector()?.at(FOR_STANDALONE) != 0 {
                capitalization.set(usage as usize, true);
            }
        }
        Ok(())
    };
    let bundle = ures_open(None, locale.get_name())?;
    ures_get_all_items_with_fallback(&bundle, b"contextTransforms", &mut sink)?;
    Ok(capitalization)
}

fn new_brk_iter(locale: &Locale) -> Result<Box<BreakIterator>, UErrorCode> {
    try_box_result(&mut BreakIterator::create_sentence_instance(locale))
}

impl LocaleDisplayNames {
    #[cfg_attr(mordant, allow(defaulted_failure))] // Most locales have no `contextTransforms`.
    pub(crate) fn new(
        locale_id: &[u8],
        uses_dialect_names: bool,
        is_short: bool,
    ) -> Result<Self, UErrorCode> {
        let locale = Locale::from_name(locale_id);
        let pattern = |key: &[u8], default: &str| {
            find(&locale, U_ICUDATA_LANG, b"localeDisplayPattern", key)
                .map_or_else(|| ustr(default), |pattern| from_units(pattern.iter()))
        };
        let separator = pattern(b"separator", "{0}, {1}");
        let format = pattern(b"pattern", "{0} ({1})");
        let capitalization = load_capitalization(&locale).unwrap_or_default();
        let brk_iter = capitalization
            .contains(&true)
            .then(|| new_brk_iter(&locale).ok());
        Ok(Self {
            locale,
            uses_dialect_names,
            is_short,
            separator_format: SimpleFormatter::with_pattern_min_max_arguments(&separator, 2, 2)?,
            format: SimpleFormatter::with_pattern_min_max_arguments(&format, 2, 2)?,
            paren_replacements: if format.contains(&0xff08) {
                [(0xff08, 0xff3b), (0xff09, 0xff3d)]
            } else {
                [(0x28, 0x5b), (0x29, 0x5d)]
            },
            capitalization,
            capitalization_brk_iter: brk_iter.flatten().map(|iter| Mutex::new(Some(iter))),
        })
    }

    /// Fails with `U_ILLEGAL_ARGUMENT_ERROR` if the data have no name.
    fn name(&self, tree: &'static [u8], short_table: &[u8], table: &[u8], item: &[u8]) -> Name {
        let short = self
            .is_short
            .then(|| find(&self.locale, tree, short_table, item));
        short
            .flatten()
            .or_else(|| find(&self.locale, tree, table, item))
            .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?
            .try_to_vec()
    }

    // ICU4C: locdspnm.cpp, LocaleDisplayNamesImpl::adjustForUsageAndContext
    fn capitalized(&self, usage: CapContextUsage, mut name: Vec<u16>) -> Name {
        if let Some(slot) = &self.capitalization_brk_iter
            && self.capitalization.at(usage as usize)
            && u_islower(name.char32_at(0))
        {
            let taken = slot.lock().take();
            let mut iter = taken.map_or_else(|| new_brk_iter(&self.locale), Ok)?;
            let locale = CaseLocale::of(self.locale.get_base_name());
            let titled = iter
                .boundaries(&name)
                .map(|mut breaks| to_title(locale, &mut breaks, &name));
            // An iterator that another thread has stored meanwhile is dropped after the lock is released.
            let _replaced = slot.lock().replace(iter);
            name = titled?;
        }
        Ok(name)
    }

    fn append_with_sep(&self, buffer: &mut Vec<u16>, part: Vec<u16>) {
        *buffer = if buffer.is_empty() {
            part
        } else {
            self.separator_format.format_to_vec(&[buffer, &part])
        };
    }

    // ICU4C: locdspnm.cpp, LocaleDisplayNamesImpl::localeDisplayName
    pub(crate) fn locale_display_name(&self, locale_id: &[u8]) -> Name {
        let locale = Locale::from_name(locale_id);
        if locale.is_bogus() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        if strings::contains_any(locale.get_name(), b".@") {
            return Err(U_UNSUPPORTED_ERROR);
        }
        let language = match locale.get_language() {
            b"" => ROOT_LOCALE_NAME,
            language => language,
        };
        let (mut script, mut country) = (locale.get_script(), locale.get_country());

        let mut name = None;
        if self.uses_dialect_names {
            // An ID with both a script and a region has a dialect name only as a whole.
            let mut key = SmallChars::of(language);
            for part in [script, country].iter().filter(|part| !part.is_empty()) {
                key.add(b'_');
                key.add_all(part);
            }
            if key.len() > language.len() {
                name = self.locale_id_name(&key).ok();
            }
            if name.is_some() {
                (script, country) = (&[], &[]);
            }
        }
        let mut name = name.map_or_else(|| self.language_name(language), Ok)?;

        let mut rest = Vec::new();
        if !script.is_empty() {
            rest = self.script_name(script)?;
        }
        if !country.is_empty() {
            self.append_with_sep(&mut rest, self.region_name(country)?);
        }
        if !locale.get_variant().is_empty() {
            let variant = find(
                &self.locale,
                U_ICUDATA_LANG,
                b"Variants",
                locale.get_variant(),
            );
            let variant = variant.ok_or(U_ILLEGAL_ARGUMENT_ERROR)?.try_to_vec()?;
            self.append_with_sep(&mut rest, variant);
        }
        if !rest.is_empty() {
            for unit in &mut rest {
                let pair = self.paren_replacements.iter().find(|pair| pair.0 == *unit);
                *unit = pair.map_or(*unit, |pair| pair.1);
            }
            name = self.format.format_to_vec(&[&name, &rest]);
        }
        self.capitalized(CapContextUsage::Language, name)
    }

    fn locale_id_name(&self, id: &[u8]) -> Name {
        self.name(U_ICUDATA_LANG, b"Languages%short", b"Languages", id)
    }

    fn language_name(&self, language: &[u8]) -> Name {
        self.locale_id_name(language).or_else(|missing| {
            if KNOWN_LANGUAGES.binary_search(&language).is_ok() {
                return Err(missing);
            }
            self.locale_id_name(&find_replacement(b"language", language).ok_or(missing)?)
        })
    }

    fn script_name(&self, script: &[u8]) -> Name {
        self.name(U_ICUDATA_LANG, b"Scripts%short", b"Scripts", script)
    }

    fn region_name(&self, region: &[u8]) -> Name {
        self.name(U_ICUDATA_REGION, b"Countries%short", b"Countries", region)
    }

    pub(crate) fn script_display_name(&self, script: &[u8]) -> Name {
        self.capitalized(CapContextUsage::Script, self.script_name(script)?)
    }

    pub(crate) fn region_display_name(&self, region: &[u8]) -> Name {
        self.capitalized(CapContextUsage::Territory, self.region_name(region)?)
    }

    pub(crate) fn calendar_display_name(&self, calendar: &[u8]) -> Name {
        let name = self.name(
            U_ICUDATA_LANG,
            b"Types%short/calendar",
            b"Types/calendar",
            calendar,
        );
        self.capitalized(CapContextUsage::KeyValue, name?)
    }
}
