//! Loads tailorings, rules and collation types from the bundles `coll/*.res`. ICU4C: ucol_res.cpp

use crate::common::cstring::until_nul;
use crate::common::locid::Locale;
use crate::common::memory::{try_cstring, try_push, try_shared};
use crate::common::resource::{ResourceSink, ResourceValue};
use crate::common::uenum::{Item, StringEnumeration};
use crate::common::uinvchar::{append_invariant_chars, invariant_prefix};
use crate::common::uloc::Subtag;
use crate::common::umutex::OnceBox;
use crate::common::unicode::ures::{URES_STRING, URES_TABLE};
use crate::common::uresimp::U_ICUDATA_COLL;
use crate::common::uresimp::*;
use crate::common::utypes::*;
use crate::i18n::collationdatareader::{self, CollationTailoring};
use crate::i18n::locale_cache::LocaleCache;
use std::ffi::{CStr, CString};
use std::sync::Arc;

/// The resource key of the table of collation types.
const COLLATIONS: &[u8] = b"collations";
/// The locale keyword that selects a collation type.
const COLLATION: &[u8] = b"collation";
const STANDARD: &[u8] = b"standard";
const SEARCH: &[u8] = b"search";

type CollationType = Subtag<15>;
type LoadResult = Result<Arc<CollationTailoring>, UErrorCode>;

/// Returns the invariant prefix of `default`, or "standard" if it is missing or its length is out of range.
fn default_type(collations: &UResourceBundle) -> CollationType {
    match collations
        .get_by_key_with_fallback(b"default")
        .and_then(|found| found.get_string())
    {
        Ok(name) if (1..=CollationType::CAPACITY).contains(&name.len()) => {
            CollationType::new(invariant_prefix(name.iter()))
        }
        _ => CollationType::new(STANDARD.iter().copied()),
    }
}

/// Compares lengths only, because the base name is a prefix of the name.
pub(crate) fn has_keywords(locale: &Locale) -> bool {
    locale.get_name().len() != locale.get_base_name().len()
}

pub(crate) fn load_tailoring(locale: &Locale) -> LoadResult {
    static ROOT: OnceBox<LoadResult> = OnceBox::new();
    let root = ROOT.get_or_init_caching_err(|| try_shared(collationdatareader::load_root()?))?;
    if matches!(locale.get_name(), b"" | ROOT_LOCALE_NAME) {
        return Ok(Arc::clone(root));
    }
    Loader::new(root, locale)?.cached(&Loader::load_from_locale)
}

/// The state of one lookup. ICU4C: ucol_res.cpp, CollationLoader
struct Loader {
    root: &'static Arc<CollationTailoring>,
    /// The locale being looked up, used as the cache key.
    locale: Locale,
    /// Empty until the requested or default type is known.
    collation_type: CollationType,
    default_type: CollationType,
    has_tried_search: bool,
    has_tried_default: bool,
    has_tried_standard: bool,
}

impl Loader {
    fn new(root: &'static Arc<CollationTailoring>, requested: &Locale) -> Result<Self, UErrorCode> {
        let mut locale = requested.clone();
        let mut collation_type = CollationType::EMPTY;
        if has_keywords(requested) {
            locale = Locale::from_name(requested.get_base_name());
            let name = requested
                .get_keyword_value(COLLATION)
                .ok()
                .filter(|name| name.len() <= CollationType::CAPACITY && !locale.is_bogus())
                .ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
            if !name.is_empty() && !name.eq_ignore_ascii_case(b"default") {
                collation_type = CollationType::new(name.iter().map(u8::to_ascii_lowercase));
                locale.set_keyword_value(COLLATION, &collation_type)?;
            }
        }
        Ok(Self {
            root,
            locale,
            collation_type,
            default_type: CollationType::EMPTY,
            has_tried_search: false,
            has_tried_default: false,
            has_tried_standard: false,
        })
    }

    /// Returns the tailoring for `self.locale`, loaded by `next` on a cache miss.
    fn cached(&mut self, next: &dyn Fn(&mut Self) -> LoadResult) -> LoadResult {
        static CACHE: LocaleCache<CollationTailoring> = LocaleCache::new();
        let key = self.locale.clone();
        CACHE.get_or_insert_with(key.get_name(), || next(self))
    }

    /// Goes on with the locale `base_name` and the current type, through the cache if that is another locale.
    fn continue_as(
        &mut self,
        base_name: &[u8],
        next: &dyn Fn(&mut Self) -> LoadResult,
    ) -> LoadResult {
        let previous = std::mem::replace(&mut self.locale, Locale::from_name(base_name));
        if !self.collation_type.is_empty() {
            self.locale
                .set_keyword_value(COLLATION, &self.collation_type)?;
        }
        if self.locale == previous {
            next(self)
        } else {
            self.cached(next)
        }
    }

    fn load_from_locale(&mut self) -> LoadResult {
        let bundle = match ures_open_no_default(Some(U_ICUDATA_COLL), self.locale.get_base_name()) {
            Err(U_MISSING_RESOURCE_ERROR) => return Ok(Arc::clone(self.root)),
            opened => opened?,
        };
        self.continue_as(bundle.get_name().to_bytes(), &|loader| {
            loader.load_from_bundle(&bundle)
        })
    }

    fn load_from_bundle(&mut self, bundle: &UResourceBundle) -> LoadResult {
        let collations = match bundle.get_by_key(COLLATIONS) {
            Err(U_MISSING_RESOURCE_ERROR) => return Ok(Arc::clone(self.root)),
            found => found?,
        };
        self.default_type = default_type(&collations);
        if !self.collation_type.is_empty() {
            return self.load_from_collations(&collations);
        }
        if self.default_type.is_empty() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        self.try_type(self.default_type, &collations)
    }

    fn try_type(&mut self, next: CollationType, collations: &UResourceBundle) -> LoadResult {
        self.collation_type = next;
        self.locale.set_keyword_value(COLLATION, &next)?;
        self.cached(&|loader| loader.load_from_collations(collations))
    }

    fn load_from_collations(&mut self, collations: &UResourceBundle) -> LoadResult {
        self.has_tried_default |= self.collation_type == self.default_type;
        self.has_tried_search |= *self.collation_type == *SEARCH;
        self.has_tried_standard |= *self.collation_type == *STANDARD;
        let data = match collations.get_by_key_with_fallback(&self.collation_type) {
            Err(U_MISSING_RESOURCE_ERROR) => {
                let next = if !self.has_tried_search && self.collation_type.starts_with(SEARCH) {
                    CollationType::new(SEARCH.iter().copied())
                } else if !self.has_tried_default {
                    self.default_type
                } else if !self.has_tried_standard {
                    CollationType::new(STANDARD.iter().copied())
                } else {
                    return Ok(Arc::clone(self.root));
                };
                return self.try_type(next, collations);
            }
            found => found?,
        };
        let actual_name = data.get_name().to_bytes();
        if actual_name == ROOT_LOCALE_NAME && *self.collation_type == *STANDARD {
            return Ok(Arc::clone(self.root));
        }
        self.continue_as(actual_name, &|loader| loader.load_from_data(&data))
    }

    fn load_from_data(&self, data: &UResourceBundle) -> LoadResult {
        let binary = data.get_by_key(b"%%CollationBin")?;
        let mut tailoring =
            collationdatareader::read_tailoring(self.root, binary.get_value().get_binary()?)?;
        if let Ok(rules) = data.get_data_string_by_key(b"Sequence") {
            tailoring.rules = rules;
        }
        try_shared(tailoring)
    }
}

pub(crate) fn keyword_values() -> Result<impl StringEnumeration, UErrorCode> {
    ures_get_keyword_values(Some(U_ICUDATA_COLL), COLLATIONS)
}

/// The collation types of a locale, with the default type first.
#[derive(Default)]
pub(crate) struct KeywordValues {
    default: Option<CString>,
    others: Vec<&'static CStr>,
    next: usize,
}

pub(crate) fn keyword_values_for_locale(locale: &[u8]) -> Result<KeywordValues, UErrorCode> {
    let bundle = ures_open(Some(U_ICUDATA_COLL), locale)?;
    let mut values = KeywordValues::default();
    ures_get_all_items_with_fallback(&bundle, COLLATIONS, &mut values)?;
    Ok(values)
}

impl KeywordValues {
    fn iter(&self) -> impl Iterator<Item = &CStr> {
        self.default
            .as_deref()
            .into_iter()
            .chain(self.others.iter().copied())
    }
}

impl ResourceSink for KeywordValues {
    fn put(&mut self, value: &ResourceValue) -> Result<(), UErrorCode> {
        for (data_key, value) in value.get_table()?.iter_data_keys() {
            let key = data_key.as_bytes();
            match value.get_type() {
                URES_STRING if self.default.is_none() && key == b"default" => {
                    let mut default = Vec::new();
                    append_invariant_chars(&mut default, value.get_string()?.iter())?;
                    if !default.is_empty() {
                        let default = until_nul(&default);
                        self.others.retain(|other| other.to_bytes() != default);
                        self.default = Some(try_cstring(default)?);
                    }
                }
                URES_TABLE
                    if !key.starts_with(b"private-")
                        && !self.iter().any(|known| known.to_bytes() == key) =>
                {
                    try_push(&mut self.others, data_key.as_c_str())?;
                }
                _ => {}
            }
        }
        Ok(())
    }
}

impl StringEnumeration for KeywordValues {
    fn next(&mut self) -> Result<Option<Item<'_>>, UErrorCode> {
        self.next += 1;
        Ok(self.iter().nth(self.next - 1).map(Item::Chars))
    }
}
