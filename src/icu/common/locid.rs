//! [`Locale`], a parsed locale ID, and the default locale. ICU4C: locid.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::charstr::{CharStrings, SmallChars, Span};
use crate::common::cstring::{find_byte, split_once};
use crate::common::linked::is_language_removed;
use crate::common::loclikely::ulocimp_add_likely_subtags;
use crate::common::maps::Map;
use crate::common::memory::{
    self, Appendable, fail_on_oom, oom_checked, try_box, try_map_insert, try_to_vec,
};
use crate::common::putil::uprv_get_default_locale_id;
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::uloc::{
    EN, Language, Region, Script, US, check_not_default, ulocimp_canonicalize,
    ulocimp_get_keyword_value, ulocimp_get_name, ulocimp_get_name_to, ulocimp_set_keyword_value,
};
use crate::common::uloc_data::KNOWN_LANGUAGES;
use crate::common::uloc_tag::{ultag_is_language_subtag, ultag_is_script_subtag};
use crate::common::umutex::{AtomicRef, OnceBox, StaticMap};
use crate::common::uresimp::ures_open_direct;
use crate::common::utypes::*;
use bun_core::strings;
use std::ffi::{CStr, CString};
use std::sync::Arc;

/// A parsed locale ID, cheap to clone. Equality compares the names, so a bogus locale equals the root locale.
#[derive(Clone)]
pub(crate) struct Locale(Storage);

#[derive(Clone)]
enum Storage {
    Constant(&'static Fields),
    Shared(Arc<Fields>),
}

enum Name {
    /// The storage has a NUL after the name.
    Inline(ArrayVec<u8, { Name::INLINE_CAPACITY }>),
    Heap(CString),
}

impl Name {
    const INLINE_CAPACITY: usize = 30;

    /// Requires that `name` contains no NUL.
    fn new(name: &[u8]) -> Result<Self, UErrorCode> {
        if name.len() >= Self::INLINE_CAPACITY {
            return memory::try_cstring(name).map(Self::Heap);
        }
        let mut units = [0; _];
        units.copy_at(0, name);
        Ok(Self::Inline(ArrayVec::from_array(units, name.len() as u8)))
    }

    fn as_bytes(&self) -> &[u8] {
        match self {
            Self::Inline(name) => name,
            Self::Heap(name) => name.as_bytes(),
        }
    }

    fn with_nul(&self) -> &[u8] {
        match self {
            Self::Inline(name) => name.units.slice(..name.len() + 1),
            Self::Heap(name) => name.as_bytes_with_nul(),
        }
    }
}

struct Fields {
    language: Language,
    script: Script,
    region: Region,
    full_name: Name,
    variant_begin: Option<usize>,
    is_bogus: bool,
}

const EMPTY: Fields = Fields {
    language: Language::EMPTY,
    script: Script::EMPTY,
    region: Region::EMPTY,
    full_name: Name::Inline(ArrayVec::from_array([0; _], 0)),
    variant_begin: None,
    is_bogus: false,
};
static ROOT: Fields = EMPTY;
static BOGUS: Fields = Fields {
    is_bogus: true,
    ..EMPTY
};

fn up_to(s: &[u8], c: u8) -> &[u8] {
    split_once(s, c).0
}

/// Returns the start and the bytes of up to four fields separated by '_'. The last field ends at an '@' or a '.'.
fn split_fields(full_name: &[u8]) -> [(usize, &[u8]); 4] {
    let mut fields = [(0, &[][..]); 4];
    let (mut start, mut rest) = (0, Some(up_to(full_name, b'@')));
    for (index, slot) in fields.iter_mut().enumerate() {
        let Some(text) = rest else { break };
        let field;
        (field, rest) = if index < 3 {
            split_once(text, b'_')
        } else {
            (text, None)
        };
        *slot = (start, rest.map_or_else(|| up_to(field, b'.'), |_| field));
        start += field.len() + 1;
    }
    fields
}

impl Locale {
    /// Returns the default locale if `locale_id` is `None`.
    pub(crate) fn new(locale_id: Option<&[u8]>) -> Self {
        locale_id.map_or_else(Self::get_default, Self::from_name)
    }

    pub(crate) fn from_name(locale_id: &[u8]) -> Self {
        const STRING_LIMIT: usize = 357_913_941;
        if locale_id.len() > STRING_LIMIT {
            Self::bogus()
        } else {
            Self::create_from_name(locale_id)
        }
    }

    /// `from_name` without the limit. The ID ends at a NUL.
    pub(crate) fn create_from_name(locale_id: &[u8]) -> Self {
        Self::init(up_to(locale_id, 0)).unwrap_or_else(Self::bogus)
    }

    /// Applies the aliases of `metadata.res` to the locale that has only a language.
    #[cold]
    pub(crate) fn create_canonical(language: &[u8]) -> Self {
        let locale = Self::create_from_name(language);
        if KNOWN_LANGUAGES.binary_search(&language).is_ok() {
            return locale;
        }
        match replace_aliases(locale.get_language()) {
            Ok(Some(replaced)) => Self::create_from_name(&replaced),
            Ok(None) => locale,
            Err(_) => Self::bogus(),
        }
    }

    /// Joins the parts and parses the result. `keywords` is empty or contains a '='.
    pub(crate) fn from_parts(
        language: &[u8],
        country: &[u8],
        mut variant: &[u8],
        keywords: &[u8],
    ) -> Self {
        while let [b'_', rest @ ..] = variant {
            variant = rest;
        }
        while let [rest @ .., b'_'] = variant {
            variant = rest;
        }
        let unless_empty =
            |is_empty: bool, separator: &'static [u8]| if is_empty { b"" } else { separator };
        let id = memory::try_concat(&[
            language,
            unless_empty(country.is_empty() && variant.is_empty(), b"_"),
            country,
            unless_empty(variant.is_empty(), b"_"),
            variant,
            unless_empty(keywords.is_empty(), b"@"),
            keywords,
        ]);
        id.map_or_else(|_| Self::bogus(), |id| Self::create_from_name(&id))
    }

    const fn bogus() -> Self {
        Self(Storage::Constant(&BOGUS))
    }

    pub(crate) const fn get_root() -> Self {
        Self(Storage::Constant(&ROOT))
    }

    pub(crate) fn get_default() -> Self {
        default_locale().clone()
    }

    // ICU4C: locid.cpp, Locale::init
    fn init(locale_id: &[u8]) -> Option<Self> {
        let mut full_name = SmallChars::new();
        fail_on_oom(|| ulocimp_get_name_to(locale_id, &mut full_name)).ok()?;
        if full_name.is_empty() {
            return Some(Self::get_root());
        }
        let [(_, language), second, third, fourth] = split_fields(&full_name);
        if language.len() > Language::CAPACITY || !full_name.is_complete() {
            return None;
        }
        let is_script = second.1.len() == 4 && second.1.iter().all(u8::is_ascii_alphabetic);
        let (script, next, after) = if is_script {
            (second.1, third, fourth)
        } else {
            (&[][..], second, third)
        };
        let (region, (variant_begin, variant)) = match next.1.len() {
            0 | 2 | 3 => (next.1, after),
            _ => (&[][..], next),
        };
        let fields = Fields {
            language: Language::new(language.iter().copied()),
            script: Script::new(script.iter().copied()),
            region: Region::new(region.iter().copied()),
            full_name: Name::new(&full_name).ok()?,
            variant_begin: (!variant.is_empty()).then_some(variant_begin),
            is_bogus: false,
        };
        memory::try_shared(fields)
            .ok()
            .map(|fields| Self(Storage::Shared(fields)))
    }

    fn check_not_bogus(&self) -> Result<&Self, UErrorCode> {
        if self.is_bogus() {
            Err(U_ILLEGAL_ARGUMENT_ERROR)
        } else {
            Ok(self)
        }
    }

    pub(crate) fn add_likely_subtags(&mut self) -> Result<(), UErrorCode> {
        *self = Self::create_from_name(&ulocimp_add_likely_subtags(self.get_name())?);
        self.check_not_bogus().map(|_| ())
    }

    fn fields(&self) -> &Fields {
        match &self.0 {
            Storage::Constant(fields) => fields,
            Storage::Shared(fields) => fields,
        }
    }

    pub(crate) fn is_bogus(&self) -> bool {
        self.fields().is_bogus
    }

    pub(crate) fn get_language(&self) -> &[u8] {
        &self.fields().language
    }

    pub(crate) fn get_script(&self) -> &[u8] {
        &self.fields().script
    }

    pub(crate) fn get_country(&self) -> &[u8] {
        &self.fields().region
    }

    pub(crate) fn get_variant(&self) -> &[u8] {
        self.fields()
            .variant_begin
            .and_then(|begin| self.get_base_name().get(begin..))
            .unwrap_or_default()
    }

    #[inline(never)]
    pub(crate) fn get_name(&self) -> &[u8] {
        self.fields().full_name.as_bytes()
    }

    pub(crate) fn get_name_c_str(&self) -> &CStr {
        CStr::from_bytes_until_nul(self.fields().full_name.with_nul())
            .ok()
            .soft_unwrap()
    }

    /// Without a '=' after it, an '@' begins a POSIX variant, which is part of the base name.
    pub(crate) fn get_base_name(&self) -> &[u8] {
        let name = self.fields().full_name.as_bytes();
        match split_once(name, b'@') {
            (base_name, Some(keywords)) if find_byte(keywords, b'=').is_some() => base_name,
            // A name that is only a POSIX variant counts up to 16 bytes.
            ([], Some(_)) if name.len() > 16 => &[],
            _ => name,
        }
    }

    /// Returns an empty value for a missing keyword.
    pub(crate) fn get_keyword_value(&self, keyword_name: &[u8]) -> Result<Vec<u8>, UErrorCode> {
        ulocimp_get_keyword_value(self.get_name(), keyword_name)
    }

    /// Removes the keyword if `keyword_value` is empty.
    pub(crate) fn set_keyword_value(
        &mut self,
        keyword_name: &[u8],
        keyword_value: &[u8],
    ) -> Result<(), UErrorCode> {
        let mut name = try_to_vec(self.check_not_bogus()?.get_name())?;
        ulocimp_set_keyword_value(keyword_name, keyword_value, &mut name)?;
        let fields = Fields {
            full_name: Name::new(&name)?,
            ..*self.fields()
        };
        self.0 = Storage::Shared(memory::try_shared(fields)?);
        Ok(())
    }
}

impl PartialEq for Locale {
    fn eq(&self, other: &Self) -> bool {
        // The NUL is included, so `bcmp` never gets an empty slice.
        self.fields().full_name.with_nul() == other.fields().full_name.with_nul()
    }
}

/// The last entry of an alias counts.
type Aliases = Map<&'static [u8], Span>;

/// The table `alias` of `metadata.res`.
struct AliasData {
    /// The keys are `language` or `language_REGION`.
    language: Aliases,
    script: Aliases,
    /// Spaces separate several replacements.
    territory: Aliases,
    replacements: CharStrings,
}

impl AliasData {
    fn singleton() -> Result<&'static Self, UErrorCode> {
        static DATA: OnceBox<Result<AliasData, UErrorCode>> = OnceBox::new();
        DATA.get_or_init_caching_err(Self::load)
    }

    // ICU4C: locid.cpp, AliasDataBuilder::build
    fn load() -> Result<Self, UErrorCode> {
        let alias = ures_open_direct(None, b"metadata")?.get_by_key(b"alias")?;
        let read = |kind: &[u8], replacements: &mut CharStrings| {
            let mut table = alias.get_by_key(kind)?;
            if table.get_size() == 0 {
                return Err(U_MISSING_RESOURCE_ERROR);
            }
            let mut aliases = Aliases::default();
            while table.has_next() {
                let entry = table.get_next_resource()?;
                let to =
                    replacements.add_invariant(entry.get_data_string_by_key(b"replacement")?)?;
                if let Some(from) = entry.get_key() {
                    try_map_insert(&mut aliases, from, to)?;
                }
            }
            Ok(aliases)
        };
        let mut replacements = CharStrings::default();
        let language = read(b"language", &mut replacements)?;
        let script = read(b"script", &mut replacements)?;
        let territory = read(b"territory", &mut replacements)?;
        // No alias applies unless these are sound too.
        read(b"variant", &mut CharStrings::default())?;
        read(b"subdivision", &mut CharStrings::default())?;
        Ok(Self {
            language,
            script,
            territory,
            replacements,
        })
    }

    fn get(&self, aliases: &Aliases, alias: &[u8]) -> Option<&[u8]> {
        aliases.get(alias).map(|&to| self.replacements.get(to))
    }
}

/// The subtags of a locale during alias replacement.
#[derive(Clone, Copy, PartialEq, Eq)]
struct AliasReplacer<'a> {
    language: Option<&'a [u8]>,
    script: Option<&'a [u8]>,
    region: Option<&'a [u8]>,
}

fn join_subtags(language: Option<&[u8]>, others: [Option<&[u8]>; 2]) -> SmallChars {
    let mut joined = SmallChars::of(language.unwrap_or_default());
    for subtag in others.into_iter().flatten().filter(|it| !it.is_empty()) {
        joined.add(b'_');
        joined.add_all(subtag);
    }
    joined
}

impl<'a> AliasReplacer<'a> {
    /// Applies one alias, the most specific kind first, and returns whether there was one.
    fn replace_one(&mut self, data: &'a AliasData) -> Result<bool, UErrorCode> {
        Ok(
            (self.region.is_some() && self.replace_language(data, self.region))
                || self.replace_language(data, None)
                || self.replace_territory(data)?
                || self.replace_script(data),
        )
    }

    // ICU4C: locid.cpp, AliasReplacer::replaceLanguage, AliasReplacer::parseLanguageReplacement
    fn replace_language(&mut self, data: &'a AliasData, with_region: Option<&[u8]>) -> bool {
        let key = join_subtags(self.language, [with_region, None]);
        let Some(replacement) = data.get(&data.language, &key) else {
            return false;
        };
        let (language, rest) = split_once(replacement, b'_');
        let (second, rest) = rest.map(|rest| split_once(rest, b'_')).unzip();
        let (script, region) = match second {
            Some([_, _] | [_, _, _]) => (None, second),
            Some([first, _, _, _]) if first.is_ascii_alphabetic() => (second, None),
            _ => (None, None),
        };
        let new = Self {
            language: Some(language).filter(|&it| it != b"und").or(self.language),
            script: self.script.or(script),
            region: if with_region.is_some() && region.is_none() {
                None
            } else {
                self.region.or(region)
            },
        };
        // Other subtags are dropped, but count as a change.
        let has_more = rest.flatten().is_some() || script.or(region) != second;
        std::mem::replace(self, new) != new || has_more
    }

    // ICU4C: locid.cpp, AliasReplacer::replaceTerritory
    fn replace_territory(&mut self, data: &'a AliasData) -> Result<bool, UErrorCode> {
        let replacement = self.region.and_then(|it| data.get(&data.territory, it));
        let Some(replacement) = replacement else {
            return Ok(false);
        };
        let (mut region, others) = split_once(replacement, b' ');
        if others.is_some() {
            let language = self.language.unwrap_or(b"und");
            let script = self.script.unwrap_or_default();
            if !(language.is_empty() || ultag_is_language_subtag(language))
                || !(script.is_empty() || ultag_is_script_subtag(script))
            {
                return Err(U_ILLEGAL_ARGUMENT_ERROR);
            }
            let mut likely = Locale::from_name(&join_subtags(Some(language), [Some(script), None]));
            likely.add_likely_subtags()?;
            let likely = likely.get_country();
            if !likely.is_empty()
                && let Some(at) = strings::index_of(replacement, likely)
            {
                region = replacement.slice(at..at + likely.len());
            }
        }
        self.region = Some(region);
        Ok(true)
    }

    fn replace_script(&mut self, data: &'a AliasData) -> bool {
        let replacement = self.script.and_then(|it| data.get(&data.script, it));
        self.script = replacement.or(self.script);
        replacement.is_some()
    }
}

/// Returns `None` if no alias applies. ICU4C: locid.cpp, AliasReplacer::replace
fn replace_aliases(language: &[u8]) -> Result<Option<SmallChars>, UErrorCode> {
    const MAX_CHANGES: u32 = 0x2000;
    let data = AliasData::singleton()?;
    let mut replacer = AliasReplacer {
        language: Some(language).filter(|it| !it.is_empty()),
        script: None,
        region: None,
    };
    for changes in 0..MAX_CHANGES {
        if !replacer.replace_one(data)? {
            let others = [replacer.script, replacer.region];
            return Ok((changes != 0).then(|| join_subtags(replacer.language, others)));
        }
    }
    Err(U_INVALID_FORMAT_ERROR)
}

static DEFAULT_LOCALE: OnceBox<AtomicRef<Locale>> = OnceBox::new();

static EN_US_POSIX: Locale = Locale(Storage::Constant(&Fields {
    language: EN,
    script: Script::EMPTY,
    region: US,
    full_name: Name::Inline(ArrayVec::from_array(
        *b"en_US_POSIX\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0\0",
        11,
    )),
    variant_begin: Some(6),
    is_bogus: false,
}));

/// Returns a non-empty map key: `name`, or a NUL if `name` is empty. Comparing two empty slices calls `bcmp`.
pub(crate) fn name_as_key(name: &[u8]) -> &[u8] {
    if name.is_empty() { b"\0" } else { name }
}

/// Returns a locale that is never freed, because `uloc_getDefault` returns a pointer to its name.
fn intern_locale(name: &[u8]) -> Result<&'static Locale, UErrorCode> {
    static BY_NAME: StaticMap<&[u8], &Locale> = StaticMap::new();
    let root = const { &Locale::get_root() };
    if let Some(known) = if name.is_empty() {
        Some(root)
    } else {
        BY_NAME.get(name)
    } {
        return Ok(known);
    }
    let parsed = oom_checked(Locale::create_from_name(name))?;
    if parsed.get_name().is_empty() {
        return Ok(if parsed.is_bogus() {
            const { &Locale::bogus() }
        } else {
            root
        });
    }
    // The key is the parsed name.
    BY_NAME.get_or_insert_by(
        try_box(parsed)?,
        |by_name, parsed| by_name.get(parsed.get_name()).copied(),
        |parsed| {
            let locale = Box::leak(parsed);
            (locale.get_name(), locale)
        },
    )
}

/// Fails if either of the two parses would read the default locale (LANG=i-default_IT, LANG=i_default_IT).
fn host_locale() -> Result<&'static Locale, UErrorCode> {
    let id = uprv_get_default_locale_id()?;
    let name = check_not_default(id).and_then(|()| ulocimp_canonicalize(id))?;
    check_not_default(&name).and_then(|()| intern_locale(&name))
}

/// Sets the host's locale if `id` is `None`, unless `--trim` has removed its language. Does nothing if `id` is ill-formed.
pub(crate) fn uloc_set_default(id: Option<&[u8]>) {
    if let Ok(new) = id.map_or_else(host_locale, |id| intern_locale(&ulocimp_get_name(id)?))
        && (id.is_some() || !is_language_removed(split_once(new.get_name(), b'@').0))
        && let Ok(latest) = DEFAULT_LOCALE.get_or_try_init(|| Ok(AtomicRef::new(new)))
    {
        latest.set(new);
    }
}

#[inline]
fn default_locale() -> &'static Locale {
    DEFAULT_LOCALE
        .get()
        .map_or_else(init_default_locale, AtomicRef::get)
}

#[cold]
fn init_default_locale() -> &'static Locale {
    let found = DEFAULT_LOCALE
        .get_or_try_init(|| Ok(AtomicRef::new(host_locale().unwrap_or(&EN_US_POSIX))));
    found.map_or(&EN_US_POSIX, AtomicRef::get)
}

pub(crate) fn uloc_get_default() -> &'static CStr {
    default_locale().get_name_c_str()
}
