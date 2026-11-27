//! Display names of locales and their parts, capitalized for stand-alone use. ICU4C: locdspnm.cpp

use crate::common::brkiter::BreakIterator;
use crate::common::bytes::U16s;
use crate::common::charstr::SmallChars;
use crate::common::cstring::find_byte;
use crate::common::locid::Locale;
use crate::common::locresdata::{find_replacement, uloc_get_table_string_with_fallback};
use crate::common::memory::{Appendable, try_box_result};
use crate::common::resource::ResourceValue;
use crate::common::simpleformatter::SimpleFormatter;
use crate::common::slice_ext::SliceExt;
use crate::common::ucase::CaseLocale;
use crate::common::uchar::u_islower;
use crate::common::ucurr::{CurrencyName, ucurr_get_name};
use crate::common::udata::searches_files;
use crate::common::uloc::uloc_open_keywords;
use crate::common::uloc_data::KNOWN_LANGUAGES;
use crate::common::umutex::Mutex;
use crate::common::unicode::ucurr::UCURR_LONG_NAME;
use crate::common::unistr::{UStr, from_invariant, from_units, ustr};
use crate::common::uresimp::*;
use crate::common::ustrcase::to_title;
use crate::common::utypes::*;

type Name = Result<Vec<u16>, UErrorCode>;

/// The key of a table, and of a table in it.
type Table<'a> = (&'a [u8], Option<&'a [u8]>);

fn find(locale: &Locale, tree: &'static [u8], table: Table, item: &[u8]) -> Option<U16s<'static>> {
    uloc_get_table_string_with_fallback(Some(tree), locale.get_name(), table.0, table.1, item).ok()
}

/// Returns `item` itself for a missing or empty name.
fn name_or_code(locale: &Locale, tree: &'static [u8], table: &[u8], item: &[u8]) -> Vec<u16> {
    find(locale, tree, (table, None), item)
        .filter(|name| !name.is_empty())
        .map_or_else(|| from_invariant(item), |name| from_units(name.iter()))
}

pub(crate) fn region_name_or_code(locale: &Locale, region: &[u8]) -> Vec<u16> {
    name_or_code(locale, U_ICUDATA_REGION, b"Countries", region)
}

#[derive(Clone, Copy)]
enum CapContextUsage {
    Language,
    Script,
    Territory,
    KeyValue,
    /// No such name is returned alone.
    KeyOrVariant,
}

pub(crate) struct LocaleDisplayNames {
    locale: Locale,
    uses_dialect_names: bool,
    is_short: bool,
    separator_format: SimpleFormatter,
    format: SimpleFormatter,
    /// Empty for the linked data, with which no name has keywords.
    key_type_format: SimpleFormatter,
    /// Whether the data can be other than the linked ones.
    searches_files: bool,
    /// The parentheses of `format`, each with its replacement inside a part.
    paren_replacements: [(u16, u16); 2],
    /// Whether to titlecase, indexed by `CapContextUsage`.
    capitalization: [bool; 5],
    /// `None` if no name is titlecased. The inner `Option` is `None` while a thread uses the iterator.
    capitalization_brk_iter: Option<Mutex<Option<Box<BreakIterator>>>>,
}

// ICU4C: locdspnm.cpp, CapitalizationContextSink
fn load_capitalization(locale: &Locale) -> Result<[bool; 5], UErrorCode> {
    const FOR_STANDALONE: usize = 1;
    let mut capitalization = [false; _];
    let mut sink = |value: &ResourceValue| {
        for (key, value) in value.get_table()?.iter() {
            let usage = match key {
                b"keyValue" => CapContextUsage::KeyValue,
                b"languages" => CapContextUsage::Language,
                b"script" => CapContextUsage::Script,
                b"territory" => CapContextUsage::Territory,
                b"key" | b"variant" => CapContextUsage::KeyOrVariant,
                _ => continue,
            };
            if (value.get_int_vector()?.get(FOR_STANDALONE)).is_some_and(|flag| flag != 0) {
                capitalization.set(usage as usize, true);
            }
        }
        Ok(())
    };
    let bundle = ures_open(None, locale.get_name())?;
    ures_get_all_items_with_fallback(&bundle, b"contextTransforms", &mut sink)?;
    Ok(capitalization)
}

/// Returns the patterns for two parts, for a name and its parts and, unless the data are linked, for a key and a type.
#[inline(always)]
fn load_patterns(locale: &Locale, searches_files: bool) -> [Vec<u16>; 3] {
    const PATTERNS: &[u8] = b"localeDisplayPattern";
    let pattern = |key: &[u8], default: &str| {
        find(locale, U_ICUDATA_LANG, (PATTERNS, None), key)
            .map_or_else(|| ustr(default), |pattern| from_units(pattern.iter()))
    };
    [
        pattern(b"separator", "{0}, {1}"),
        pattern(b"pattern", "{0} ({1})"),
        if searches_files {
            name_or_code(locale, U_ICUDATA_LANG, PATTERNS, b"keyTypePattern")
        } else {
            Vec::new()
        },
    ]
}

fn is_code(name: &Name, code: &[u8]) -> bool {
    let code = code.iter().map(|&c| u16::from(c));
    name.as_ref()
        .is_ok_and(|name| name.iter().copied().eq(code))
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
        let searches_files = searches_files()?;
        let [separator, pattern, key_type] = load_patterns(&locale, searches_files);
        let [mut separator_format, mut format, mut key_type_format] =
            std::array::from_fn(|_| SimpleFormatter::new());
        let mut result = separator_format
            .apply_pattern_min_max_arguments(&separator, 2, 2)
            .and_then(|()| format.apply_pattern_min_max_arguments(&pattern, 2, 2));
        if searches_files && result.is_ok() {
            result = key_type_format.apply_pattern_min_max_arguments(&key_type, 2, 2);
        }
        // Nothing is capitalized unless all patterns are valid.
        let capitalization = result.and_then(|()| load_capitalization(&locale));
        let capitalization = capitalization.unwrap_or_default();
        let brk_iter = capitalization
            .contains(&true)
            .then(|| new_brk_iter(&locale).ok());
        Ok(Self {
            locale,
            uses_dialect_names,
            is_short,
            separator_format,
            format,
            key_type_format,
            searches_files,
            paren_replacements: if pattern.contains(&0xff08) {
                [(0xff08, 0xff3b), (0xff09, 0xff3d)]
            } else {
                [(0x28, 0x5b), (0x29, 0x5d)]
            },
            capitalization,
            capitalization_brk_iter: brk_iter.flatten().map(|iter| Mutex::new(Some(iter))),
        })
    }

    /// Fails with `U_ILLEGAL_ARGUMENT_ERROR` if the data have no name.
    fn name(&self, tree: &'static [u8], short_table: Table, table: Table, item: &[u8]) -> Name {
        let short = self
            .is_short
            .then(|| find(&self.locale, tree, short_table, item));
        match short.flatten() {
            Some(short) => short.try_to_vec(),
            None => self.full_name(tree, table, item),
        }
    }

    #[inline(always)]
    fn full_name(&self, tree: &'static [u8], table: Table, item: &[u8]) -> Name {
        let name = find(&self.locale, tree, table, item);
        name.ok_or(U_ILLEGAL_ARGUMENT_ERROR)?.try_to_vec()
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
        } else if self.separator_format.get_argument_limit() == 0 {
            // An invalid pattern drops what was there.
            self.separator_format.format_to_vec(&[&[], &part])
        } else {
            self.separator_format.format_to_vec(&[buffer, &part])
        };
    }

    fn replace_parentheses(&self, name: &mut [u16]) {
        for unit in name {
            let pair = self.paren_replacements.iter().find(|pair| pair.0 == *unit);
            *unit = pair.map_or(*unit, |pair| pair.1);
        }
    }

    // ICU4C: locdspnm.cpp, LocaleDisplayNamesImpl::localeDisplayName
    pub(crate) fn locale_display_name(&self, locale_id: &[u8]) -> Name {
        let locale = Locale::from_name(locale_id);
        if locale.is_bogus() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let language = match locale.get_language() {
            b"" => ROOT_LOCALE_NAME,
            language => language,
        };
        let (mut script, mut country) = (locale.get_script(), locale.get_country());

        let mut name = None;
        if self.uses_dialect_names {
            // The three lookups append to one key. The linked data have no key as long as the second one.
            let mut key = SmallChars::new();
            for (with_script, with_country) in [(true, true), (true, false), (false, true)] {
                if (with_script && script.is_empty()) || (with_country && country.is_empty()) {
                    continue;
                } else if !key.is_empty() && !self.searches_files {
                    break;
                }
                key.add_all(language);
                for (part, is_used) in [(script, with_script), (country, with_country)] {
                    if is_used {
                        key.add(b'_');
                        key.add_all(part);
                    }
                }
                name = self.locale_id_name(&key).ok();
                if name.is_some() {
                    script = if with_script { &[] } else { script };
                    country = if with_country { &[] } else { country };
                    break;
                }
            }
        }
        let name = name.filter(|name| !name.is_empty());
        let mut name = name.map_or_else(|| self.language_name(language), Ok)?;

        let mut rest = Vec::new();
        if !script.is_empty() {
            rest = self.script_name(script)?;
        }
        if !country.is_empty() {
            self.append_with_sep(&mut rest, self.region_name(country)?);
        }
        if !locale.get_variant().is_empty() {
            let variant = locale.get_variant();
            let variant = self.full_name(U_ICUDATA_LANG, (b"Variants", None), variant)?;
            self.append_with_sep(&mut rest, variant);
        }
        self.replace_parentheses(&mut rest);
        if find_byte(locale.get_name(), b'@').is_some()
            && !self.append_keywords(&locale, &mut rest)?
        {
            return Ok(Vec::new());
        }
        if !rest.is_empty() {
            name = self.format.format_to_vec(&[&name, &rest]);
        }
        self.capitalized(CapContextUsage::Language, name)
    }

    /// The key and type maps decide whether the variant "posix" becomes a keyword. Returns false if a value is ill-formed.
    #[cold]
    fn append_keywords(&self, locale: &Locale, rest: &mut Vec<u16>) -> Result<bool, UErrorCode> {
        let keys = uloc_open_keywords(locale.get_name())?;
        Ok(keys.iter().flat_map(|keys| keys.names()).all(|key| {
            let value = locale.get_keyword_value(key);
            (value.map(|value| self.append_keyword(rest, key, &value))).is_ok()
        }))
    }

    fn append_keyword(&self, rest: &mut Vec<u16>, key: &[u8], value: &[u8]) {
        let mut names = [
            self.full_name(U_ICUDATA_LANG, (b"Keys", None), key),
            self.key_value_name(key, value),
        ];
        (names.iter_mut().flatten()).for_each(|name| self.replace_parentheses(name));
        let [key_name, value_name] = names;
        let (is_key, is_value) = (is_code(&key_name, key), is_code(&value_name, value));
        let (key_name, value_name) = (key_name.unwrap_or_default(), value_name.unwrap_or_default());
        if !is_value {
            self.append_with_sep(rest, value_name);
        } else if is_key {
            self.append_with_sep(rest, key_name);
            rest.add(b'='.into());
            rest.add_all(&value_name);
        } else {
            let both = self
                .key_type_format
                .format_to_vec(&[&key_name, &value_name]);
            self.append_with_sep(rest, both);
        }
    }

    fn key_value_name(&self, key: &[u8], value: &[u8]) -> Name {
        if key == b"currency" {
            let code = from_invariant(value);
            let name = ucurr_get_name(&code, self.locale.get_base_name(), UCURR_LONG_NAME);
            return Ok(name.and_then(CurrencyName::try_to_vec).unwrap_or(code));
        }
        let (short, full) = ((&b"Types%short"[..], Some(key)), (&b"Types"[..], Some(key)));
        self.name(U_ICUDATA_LANG, short, full, value)
    }

    fn locale_id_name(&self, id: &[u8]) -> Name {
        let (short, full) = ((&b"Languages%short"[..], None), (&b"Languages"[..], None));
        self.name(U_ICUDATA_LANG, short, full, id)
    }

    // ICU4C: locdspnm.cpp, LocaleDisplayNamesImpl::localeIdName
    fn language_name(&self, language: &[u8]) -> Name {
        self.locale_id_name(language).or_else(|missing| {
            if self.searches_files {
                self.locale_id_name(Locale::create_canonical(language).get_name())
            } else if KNOWN_LANGUAGES.binary_search(&language).is_ok() {
                Err(missing)
            } else {
                // In the linked data no replacement has an alias in turn.
                self.locale_id_name(&find_replacement(b"language", language).ok_or(missing)?)
            }
        })
    }

    fn script_name(&self, script: &[u8]) -> Name {
        let (short, full) = ((&b"Scripts%short"[..], None), (&b"Scripts"[..], None));
        self.name(U_ICUDATA_LANG, short, full, script)
    }

    fn region_name(&self, region: &[u8]) -> Name {
        let (short, full) = ((&b"Countries%short"[..], None), (&b"Countries"[..], None));
        self.name(U_ICUDATA_REGION, short, full, region)
    }

    pub(crate) fn script_display_name(&self, script: &[u8]) -> Name {
        self.capitalized(CapContextUsage::Script, self.script_name(script)?)
    }

    pub(crate) fn region_display_name(&self, region: &[u8]) -> Name {
        self.capitalized(CapContextUsage::Territory, self.region_name(region)?)
    }

    pub(crate) fn calendar_display_name(&self, calendar: &[u8]) -> Name {
        let name = if self.searches_files {
            self.key_value_name(b"calendar", calendar)
        } else {
            // In the linked data `Types` is a table wherever it is, so one lookup finds the same.
            let (short, full) = (&b"Types%short/calendar"[..], &b"Types/calendar"[..]);
            self.name(U_ICUDATA_LANG, (short, None), (full, None), calendar)
        };
        self.capitalized(CapContextUsage::KeyValue, name?)
    }
}
