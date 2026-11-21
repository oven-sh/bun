//! [`Locale`], a parsed locale ID, and the default locale. ICU4C: locid.cpp

use crate::common::arrayvec::ArrayVec;
use crate::common::charstr::SmallChars;
use crate::common::cstring::{find_byte, split_once};
use crate::common::loclikely::ulocimp_add_likely_subtags;
use crate::common::memory::{self, fail_on_oom, oom_checked, try_box, try_to_vec};
use crate::common::putil::uprv_get_default_locale_id;
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::uloc::{
    EN, Language, Region, Script, US, check_not_default, ulocimp_canonicalize,
    ulocimp_get_keyword_value, ulocimp_get_name, ulocimp_get_name_to, ulocimp_set_keyword_value,
};
use crate::common::umutex::{AtomicRef, OnceBox, StaticMap};
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, UErrorCode};
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

/// Sets the host's locale if `id` is `None`. Does nothing if `id` is ill-formed.
pub(crate) fn uloc_set_default(id: Option<&[u8]>) {
    if let Ok(new) = id.map_or_else(host_locale, |id| intern_locale(&ulocimp_get_name(id)?))
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
