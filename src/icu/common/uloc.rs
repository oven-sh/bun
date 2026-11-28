//! Locale IDs: `language_Script_REGION_VARIANT@keyword=value;...`, POSIX IDs and language tags. ICU4C: uloc.cpp

use crate::common::charstr::{ByteSink, SmallChars, via_byte_sink};
use crate::common::cstring::{find_byte, find_last_byte, split_once};
pub(crate) use crate::common::locid::uloc_get_default;
use crate::common::memory::{
    Appendable, oom_checked, try_concat, try_extend_from_slice, try_to_vec,
};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::uenum::{Item, StringEnumeration};
use crate::common::uloc_data::*;
use crate::common::uloc_tag::ulocimp_for_language_tag;
use crate::common::utypes::{
    U_ILLEGAL_ARGUMENT_ERROR, U_INTERNAL_PROGRAM_ERROR, U_INVALID_FORMAT_ERROR, UErrorCode,
};
use bun_core::strings;
use std::borrow::{Borrow, Cow};
use std::ffi::CStr;
use std::hash::{Hash, Hasher};

/// Looks `key` up in a sorted table of rows "key=value", in which spaces pad the key to `K` bytes and follow the value.
#[inline(always)]
pub(crate) fn find_row<const K: usize, const N: usize>(
    table: &'static [[u8; N]],
    key: &[u8],
) -> Option<&'static [u8]> {
    if key.len() > K || key.ends_with(b" ") {
        return None;
    }
    let mut padded = [b' '; K];
    padded.copy_at(0, key);
    let index = table.binary_search_by(|row| row.slice(..K).cmp(&padded));
    Some(table.get(index.ok()?)?.slice(K + 1..).trim_ascii_end())
}

/// A subtag, keyword or other short string of at most `N` bytes, stored inline and padded with NULs.
#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
pub(crate) struct Subtag<const N: usize> {
    bytes: [u8; N],
    len: u8,
}

impl<const N: usize> Subtag<N> {
    pub(crate) const EMPTY: Self = {
        assert!(N <= u8::MAX as usize);
        Self {
            bytes: [0; N],
            len: 0,
        }
    };
    pub(crate) const CAPACITY: usize = N;

    /// Takes the first `N` items of `bytes`.
    pub(crate) fn new(bytes: impl IntoIterator<Item = u8>) -> Self {
        let mut subtag = Self::EMPTY;
        for (slot, byte) in subtag.bytes.iter_mut().zip(bytes) {
            *slot = byte;
            subtag.len += 1;
        }
        subtag
    }

    pub(crate) fn as_bytes(&self) -> &[u8] {
        self.bytes.slice(..self.len.into())
    }
}

impl<const N: usize> Default for Subtag<N> {
    fn default() -> Self {
        Self::EMPTY
    }
}

impl<const N: usize> std::ops::Deref for Subtag<N> {
    type Target = [u8];

    fn deref(&self) -> &[u8] {
        self.as_bytes()
    }
}

impl<const N: usize> Hash for Subtag<N> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        self.as_bytes().hash(state);
    }
}

impl<const N: usize> Borrow<[u8]> for Subtag<N> {
    fn borrow(&self) -> &[u8] {
        self.as_bytes()
    }
}

pub(crate) type Language = Subtag<11>;
pub(crate) type Script = Subtag<4>;
pub(crate) type Region = Subtag<3>;

pub(crate) const EN: Language = Subtag {
    bytes: *b"en\0\0\0\0\0\0\0\0\0",
    len: 2,
};
pub(crate) const US: Region = Subtag {
    bytes: *b"US\0",
    len: 2,
};

fn is_id_separator(c: u8) -> bool {
    c == b'_' || c == b'-'
}

/// Matches the '.' before a POSIX code page and the '@' before a POSIX variant or the keywords.
fn is_terminator(c: u8) -> bool {
    c == b'.' || c == b'@'
}

fn is_bcp47_extension(s: &[u8]) -> bool {
    matches!(s, [b'-', b't' | b'T' | b'u' | b'U' | b'x' | b'X', b'-', ..])
}

/// Returns the length of the first subtag of `s`, at most `max + 1`.
fn subtag_len(s: &[u8], max: usize) -> usize {
    s.iter()
        .take(max + 1)
        .take_while(|&&c| !is_terminator(c) && !is_id_separator(c))
        .count()
}

/// Returns the raw language and the rest. The language is empty for `und` and `root`.
fn split_language(locale_id: &[u8]) -> Result<(&[u8], &[u8]), UErrorCode> {
    let len = match locale_id {
        [b'r' | b'R', b'o' | b'O', b'o' | b'O', b't' | b'T'] => return Ok((&[], &[])),
        [b'u' | b'U', b'n' | b'N', b'd' | b'D']
        | [
            b'u' | b'U',
            b'n' | b'N',
            b'd' | b'D',
            b'-' | b'_' | b'@',
            ..,
        ] => {
            return Ok((&[], locale_id.slice(3..)));
        }
        // A prefix, as in `i-klingon`.
        [b'i' | b'I' | b'x' | b'X', b'_' | b'-', rest @ ..] => {
            2 + subtag_len(rest, Language::CAPACITY)
        }
        _ => subtag_len(locale_id, Language::CAPACITY),
    };
    if len > Language::CAPACITY {
        Err(U_ILLEGAL_ARGUMENT_ERROR)
    } else {
        Ok(locale_id.split_soft(len))
    }
}

/// Returns the raw script (four letters, or empty) and the rest, which may lack a separator (`zh_Hant;q=0.9`).
fn split_script(s: &[u8]) -> (&[u8], &[u8]) {
    if let [b'_' | b'-', after @ ..] = s
        && let Some((script, rest)) = after.split_first_chunk::<4>()
        && script.iter().all(u8::is_ascii_alphabetic)
        && !rest.first().is_some_and(u8::is_ascii_alphanumeric)
    {
        return (script, rest);
    }
    (&[], s)
}

/// Returns the raw region (two or three arbitrary bytes, or empty) and the rest.
fn split_region(s: &[u8]) -> (&[u8], &[u8]) {
    if let [b'_' | b'-', after @ ..] = s
        && let len @ 2..=Region::CAPACITY = subtag_len(after, Region::CAPACITY)
    {
        return after.split_soft(len);
    }
    (&[], s)
}

/// Replaces a three-letter code by the two-letter code that `table` has for it.
fn shorten_code<const N: usize>(code: Subtag<N>, table: &'static [[u8; 7]]) -> Subtag<N> {
    if code.len() == 3
        && let Some(short) = find_row::<3, _>(table, &code)
    {
        return Subtag::new(short.iter().copied());
    }
    code
}

fn normalize_language(raw: &[u8]) -> Language {
    let lower = raw.iter().map(|&c| {
        if c == b'_' {
            b'-'
        } else {
            c.to_ascii_lowercase()
        }
    });
    shorten_code(Language::new(lower), LANGUAGES)
}

/// The raw subtags at the start of a locale ID. A missing subtag is empty. ICU4C: uloc.cpp, ulocimp_getSubtags
#[derive(Default)]
pub(crate) struct Subtags<'a> {
    language: &'a [u8],
    script: &'a [u8],
    region: &'a [u8],
    rest: &'a [u8],
}

impl<'a> Subtags<'a> {
    pub(crate) fn parse(locale_id: &'a [u8]) -> Result<Self, UErrorCode> {
        let (language, rest) = split_language(locale_id)?;
        let (script, rest) = split_script(rest);
        let (region, rest) = split_region(rest);
        Ok(Self {
            language,
            script,
            region,
            rest,
        })
    }

    /// Like `parse`, but also returns the variant and the rest. Fails if the variant is too long.
    pub(crate) fn parse_with_variant(
        locale_id: &'a [u8],
    ) -> Result<(Self, Variant<'a>, &'a [u8]), UErrorCode> {
        let subtags = Self::parse(locale_id)?;
        let (variant, rest) = subtags.variant()?;
        Ok((subtags, variant, rest))
    }

    /// Whether `canonicalize` does to the ID only what `language`, `script` and `region` do.
    pub(crate) fn is_plain(&self) -> bool {
        let is_plain_region = match *self.region {
            [] => true,
            [a, b] => a.is_ascii_alphabetic() && b.is_ascii_alphabetic(),
            _ => self.region.iter().all(u8::is_ascii_digit),
        };
        self.rest.is_empty()
            && (2..=3).contains(&self.language.len())
            && self.language.iter().all(u8::is_ascii_alphabetic)
            && is_plain_region
    }

    pub(crate) fn language(&self) -> Language {
        normalize_language(self.language)
    }

    pub(crate) fn script(&self) -> Script {
        // All four bytes are ASCII letters, so bit 0x20 selects the case.
        let &[first, a, b, c] = self.script else {
            return Script::EMPTY;
        };
        Script {
            bytes: [first & !0x20, a | 0x20, b | 0x20, c | 0x20],
            len: 4,
        }
    }

    pub(crate) fn region(&self) -> Region {
        shorten_code(
            Region::new(self.region.iter().map(u8::to_ascii_uppercase)),
            COUNTRIES,
        )
    }

    /// Returns the variant, unless too long, and the rest: a code page, keywords, or other text that is not a subtag.
    pub(crate) fn variant(&self) -> Result<(Variant<'a>, &'a [u8]), UErrorCode> {
        let mut variant = Variant {
            raw: &[],
            suffix: &[],
            suffix_count: 0,
        };
        let mut rest = self.rest;
        if let [b'_' | b'-', after @ ..] = rest
            && !is_bcp47_extension(rest)
        {
            let after = match after {
                [b'_' | b'-', more @ ..] if self.region.is_empty() => more,
                _ => after,
            };
            let len = variant_len(after).ok_or(U_ILLEGAL_ARGUMENT_ERROR)?;
            variant.raw = after.slice(..len);
            if len > 0 {
                rest = after.slice(len..);
            }
            // A '-' at the end of the ID is not converted to '_'.
            if let ([raw @ .., b'-'], []) = (variant.raw, rest) {
                variant = Variant {
                    raw,
                    suffix: b"-",
                    suffix_count: 1,
                };
            }
        }
        // The search for `va-posix` reads the subtags after the singleton in pairs.
        if is_bcp47_extension(rest) {
            variant.suffix = if variant.is_empty() {
                b"POSIX"
            } else {
                b"_POSIX"
            };
            let mut pairs = rest.slice(2..);
            while let [_, pair @ ..] = pairs
                && let (first, Some(after)) = split_once(pair, b'-')
            {
                let (second, _) = split_once(after, b'-');
                pairs = after.slice(second.len()..);
                if first.eq_ignore_ascii_case(b"va") && second.eq_ignore_ascii_case(b"posix") {
                    variant.suffix_count += 1;
                    rest = pairs;
                }
            }
        }
        Ok((variant, rest))
    }
}

/// 20 subtags of 8 bytes and 19 separators.
const MAX_VARIANTS_LENGTH: usize = 179;

/// Returns the length of the variant at the start of `s`, with a separator or terminator that ends `s`, or `None` if too long.
fn variant_len(mut s: &[u8]) -> Option<usize> {
    for at in 0..=MAX_VARIANTS_LENGTH {
        match s {
            [] | [b'.' | b'@', _, ..] => return Some(at),
            [b'-', ..] if is_bcp47_extension(s) => return Some(at),
            [_, rest @ ..] => s = rest,
        }
    }
    None
}

/// Appends `raw` in upper case, with '_' for '-' and `separator`. `raw` has at most `MAX_VARIANTS_LENGTH` bytes.
fn append_variant(raw: &[u8], separator: u8, sink: &mut ByteSink) {
    let mut upper = [0; MAX_VARIANTS_LENGTH];
    for (to, &c) in upper.iter_mut().zip(raw) {
        *to = if c == b'-' || c == separator {
            b'_'
        } else {
            c.to_ascii_uppercase()
        };
    }
    sink.add_all(upper.slice(..raw.len()));
}

/// A variant: `raw`, normalized on output, followed by `suffix_count` copies of `suffix`.
pub(crate) struct Variant<'a> {
    raw: &'a [u8],
    suffix: &'static [u8],
    suffix_count: usize,
}

impl Variant<'_> {
    pub(crate) fn is_empty(&self) -> bool {
        self.raw.is_empty() && self.suffix_count == 0
    }

    fn len(&self) -> usize {
        self.raw.len() + self.suffix.len() * self.suffix_count
    }

    pub(crate) fn has_subtag_longer_than(&self, max: usize) -> bool {
        self.raw.len() > max && strings::split_any(self.raw, b"_-").any(|subtag| subtag.len() > max)
    }

    pub(crate) fn append_to(&self, sink: &mut ByteSink) {
        if !self.raw.is_empty() {
            append_variant(self.raw, b'_', sink);
        }
        (0..self.suffix_count).for_each(|_| sink.add_all(self.suffix));
    }
}

/// Appends `language_Script_REGION_VARIANT`. Without a region the variant follows "__".
pub(crate) fn append_subtags(
    language: &[u8],
    script: &[u8],
    region: &[u8],
    variant: &Variant,
    sink: &mut ByteSink,
) {
    sink.add_all(language);
    for subtag in [script, region] {
        if !subtag.is_empty() {
            sink.add(b'_');
            sink.add_all(subtag);
        }
    }
    if !variant.is_empty() {
        sink.add_all(if region.is_empty() { b"__" } else { b"_" });
        variant.append_to(sink);
    }
}

pub(crate) fn uloc_get_language(locale_id: &[u8]) -> Result<Language, UErrorCode> {
    Ok(normalize_language(split_language(locale_id)?.0))
}

pub(crate) fn uloc_get_script(locale_id: &[u8]) -> Result<Script, UErrorCode> {
    Ok(Subtags::parse(locale_id)?.script())
}

pub(crate) fn uloc_get_country(locale_id: &[u8]) -> Result<Region, UErrorCode> {
    Ok(Subtags::parse(locale_id)?.region())
}

/// Returns whether `id` has no '@' and a one-byte subtag other than the last.
fn has_bcp47_extension(id: &[u8]) -> bool {
    if find_byte(id, b'@').is_some() {
        return false;
    }
    let mut len = 0_usize;
    for &c in id {
        if !is_id_separator(c) {
            len += 1;
        } else if len == 1 {
            return true;
        } else {
            len = 0;
        }
    }
    false
}

/// Returns `tag` unchanged if it converts to an empty ID.
fn tag_to_locale_id(tag: Cow<'_, [u8]>) -> Result<Cow<'_, [u8]>, UErrorCode> {
    let (locale_id, _) = ulocimp_for_language_tag(&tag)?;
    Ok(if locale_id.is_empty() {
        tag
    } else {
        Cow::Owned(locale_id)
    })
}

fn to_locale_id(id: &[u8]) -> Result<Cow<'_, [u8]>, UErrorCode> {
    if has_bcp47_extension(id) {
        tag_to_locale_id(Cow::Borrowed(id))
    } else {
        Ok(Cow::Borrowed(id))
    }
}

/// Returns the index of the '@'.
pub(crate) fn locale_get_keywords_start(locale_id: &[u8]) -> Option<usize> {
    find_byte(locale_id, b'@')
}

fn after_at_sign(locale_id: &[u8]) -> Option<&[u8]> {
    split_once(locale_id, b'@').1
}

fn trim_start_spaces(mut s: &[u8]) -> &[u8] {
    while let [b' ', rest @ ..] = s {
        s = rest;
    }
    s
}

fn trim_spaces(mut s: &[u8]) -> &[u8] {
    while let [rest @ .., b' '] = s {
        s = rest;
    }
    trim_start_spaces(s)
}

const ULOC_KEYWORD_BUFFER_LEN: usize = 25;
const ULOC_MAX_NO_KEYWORDS: usize = 25;
type Keyword = Subtag<{ ULOC_KEYWORD_BUFFER_LEN - 1 }>;

/// Keywords without duplicates. The names are in lower case, have no spaces, and may contain any other bytes.
struct SortedKeywords<'a> {
    /// The first `count` entries have a value.
    sorted: [(Keyword, Option<&'a [u8]>); ULOC_MAX_NO_KEYWORDS],
    count: usize,
}

impl<'a> SortedKeywords<'a> {
    /// All bytes are zero, so initialization is a single `memset`.
    const EMPTY: Self = Self {
        sorted: [(Keyword::EMPTY, None); _],
        count: 0,
    };

    /// Parses `text`, the part after the '@'. Fills `self` in place, because returning the array would copy it.
    fn parse(&mut self, text: &'a [u8]) -> Result<(), UErrorCode> {
        let mut rest = trim_start_spaces(text);
        while !rest.is_empty() {
            if self.count == ULOC_MAX_NO_KEYWORDS {
                return Err(U_INTERNAL_PROGRAM_ERROR);
            }
            let (keyword, after) = split_once(rest, b';');
            let (name @ [_, ..], Some(value)) = split_once(keyword, b'=') else {
                return Err(U_INVALID_FORMAT_ERROR);
            };
            if name.len() > Keyword::CAPACITY {
                return Err(U_INTERNAL_PROGRAM_ERROR);
            }
            let value = trim_spaces(value);
            if value.is_empty() {
                return Err(U_INVALID_FORMAT_ERROR);
            }
            self.insert(
                Keyword::new(
                    name.iter()
                        .filter(|&&c| c != b' ')
                        .map(u8::to_ascii_lowercase),
                ),
                value,
            );
            rest = trim_start_spaces(after.unwrap_or_default());
        }
        Ok(())
    }

    /// Inserts a keyword unless its name is present. The array must not be full.
    fn insert(&mut self, name: Keyword, value: &'a [u8]) {
        let present = self.sorted.slice(..self.count);
        let position = present.binary_search_by(|(other, _)| other.cmp(&name));
        if let Err(at) = position {
            self.sorted.move_within(at..self.count, at + 1);
            self.sorted.set(at, (name, Some(value)));
            self.count += 1;
        }
    }

    fn iter(&self) -> impl Iterator<Item = (&[u8], &'a [u8])> {
        self.sorted
            .slice(..self.count)
            .iter()
            .map(|(name, value)| (name.as_bytes(), value.soft_unwrap()))
    }

    /// Appends `a=b;c=d`.
    fn append_to(&self, sink: &mut ByteSink) {
        for (index, (keyword, value)) in self.iter().enumerate() {
            if index > 0 {
                sink.add(b';');
            }
            sink.add_all(keyword);
            sink.add(b'=');
            sink.add_all(value);
        }
    }
}

/// Iterates over the raw names, which must be alphanumeric, and values, which may be empty. Both are trimmed of spaces.
fn split_keywords(
    mut rest: Option<&[u8]>,
) -> impl Iterator<Item = Result<(&[u8], &[u8]), UErrorCode>> {
    std::iter::from_fn(move || {
        let (name, Some(after)) = split_once(rest.take()?, b'=') else {
            return Some(Err(U_ILLEGAL_ARGUMENT_ERROR));
        };
        let name = trim_spaces(name);
        if !is_keyword_name(name) {
            return Some(Err(U_ILLEGAL_ARGUMENT_ERROR));
        }
        let value;
        (value, rest) = split_once(after, b';');
        Some(Ok((name, trim_spaces(value))))
    })
}

fn is_keyword_name(name: &[u8]) -> bool {
    !name.is_empty() && name.iter().all(u8::is_ascii_alphanumeric)
}

fn is_keyword_value_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'_' | b'-' | b'+' | b'/')
}

/// Returns an empty value if the keyword is missing.
pub(crate) fn ulocimp_get_keyword_value(
    locale_id: &[u8],
    keyword_name: &[u8],
) -> Result<Vec<u8>, UErrorCode> {
    via_byte_sink(|sink| ulocimp_get_keyword_value_to(locale_id, keyword_name, sink))
}

/// Appends the well-formed prefix of an ill-formed value before it fails.
pub(crate) fn ulocimp_get_keyword_value_to(
    locale_id: &[u8],
    keyword_name: &[u8],
    sink: &mut ByteSink,
) -> Result<(), UErrorCode> {
    if !is_keyword_name(keyword_name) {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    let locale_id = to_locale_id(locale_id)?;
    for keyword in split_keywords(after_at_sign(&locale_id)) {
        let (name, value) = keyword?;
        if name.eq_ignore_ascii_case(keyword_name) {
            let (well_formed, rest) = value.split_while(|&c| is_keyword_value_byte(c));
            sink.add_all(well_formed);
            return if value.is_empty() || !rest.is_empty() {
                Err(U_ILLEGAL_ARGUMENT_ERROR)
            } else {
                Ok(())
            };
        }
    }
    Ok(())
}

/// Sets, replaces or (with an empty value) removes a keyword.
pub(crate) fn ulocimp_set_keyword_value(
    keyword_name: &[u8],
    keyword_value: &[u8],
    locale_id: &mut Vec<u8>,
) -> Result<(), UErrorCode> {
    let start = locale_get_keywords_start(locale_id).unwrap_or(locale_id.len());
    let updated = ulocimp_set_keyword_value_of_keywords(
        locale_id.slice(start..),
        keyword_name,
        keyword_value,
    )?;
    locale_id.truncate(start);
    try_extend_from_slice(locale_id, &updated)
}

/// Returns the new text for `keywords`, which starts at the '@'. A new keyword precedes the first that sorts after it.
pub(crate) fn ulocimp_set_keyword_value_of_keywords(
    keywords: &[u8],
    keyword_name: &[u8],
    keyword_value: &[u8],
) -> Result<Vec<u8>, UErrorCode> {
    fn append(keywords: &mut Vec<u8>, name: &[u8], value: &[u8]) {
        keywords.add(if keywords.is_empty() { b'@' } else { b';' });
        keywords.add_each(name.iter().map(u8::to_ascii_lowercase));
        keywords.add(b'=');
        keywords.add_all(value);
    }

    if !is_keyword_name(keyword_name) || !keyword_value.iter().all(|&c| is_keyword_value_byte(c)) {
        return Err(U_ILLEGAL_ARGUMENT_ERROR);
    }
    if keywords.len() <= 1 {
        if keyword_value.is_empty() {
            return Ok(Vec::new());
        }
        let mut only_keyword = try_concat(&[b"@", keyword_name, b"=", keyword_value])?;
        only_keyword
            .slice_mut(..1 + keyword_name.len())
            .make_ascii_lowercase();
        return Ok(only_keyword);
    }
    let mut updated = Vec::new();
    // Whether the keyword has been written or removed.
    let mut is_handled = false;
    for keyword in split_keywords(Some(keywords.slice(1..))) {
        let (name, value @ [_, ..]) = keyword? else {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        };
        let order = keyword_name
            .iter()
            .map(u8::to_ascii_lowercase)
            .cmp(name.iter().map(u8::to_ascii_lowercase));
        if order.is_eq() || (order.is_lt() && !keyword_value.is_empty() && !is_handled) {
            if !keyword_value.is_empty() {
                append(&mut updated, keyword_name, keyword_value);
            }
            is_handled = true;
        }
        if order.is_ne() {
            append(&mut updated, name, value);
        }
    }
    if !is_handled {
        if keyword_value.is_empty() {
            // Nothing to remove: the text is unchanged, including spaces.
            return try_to_vec(keywords);
        }
        append(&mut updated, keyword_name, keyword_value);
    }
    oom_checked(updated)
}

/// An enumeration of NUL-terminated keywords, up to the first empty one.
pub(crate) struct UKeywordsContext {
    keywords: Vec<u8>,
    current: usize,
}

impl UKeywordsContext {
    pub(crate) fn new(keywords: Vec<u8>) -> Self {
        Self {
            keywords,
            current: 0,
        }
    }

    pub(crate) fn names(&self) -> impl Iterator<Item = &[u8]> {
        strings::split(&self.keywords, b"\0").take_while(|name| !name.is_empty())
    }
}

impl StringEnumeration for UKeywordsContext {
    fn count(&self) -> Result<usize, UErrorCode> {
        Ok(self.names().count())
    }

    fn next(&mut self) -> Result<Option<Item<'_>>, UErrorCode> {
        let keyword =
            CStr::from_bytes_until_nul(self.keywords.slice(self.current..)).unwrap_or_default();
        if keyword.is_empty() {
            return Ok(None);
        }
        self.current += keyword.count_bytes() + 1;
        Ok(Some(Item::Chars(keyword)))
    }
}

/// Returns `None` for an ID without '@'.
pub(crate) fn uloc_open_keywords(locale_id: &[u8]) -> Result<Option<UKeywordsContext>, UErrorCode> {
    let locale_id = to_locale_id(locale_id)?;
    let Some(keywords) = after_at_sign(Subtags::parse_with_variant(&locale_id)?.2) else {
        return Ok(None);
    };
    let mut sorted = SortedKeywords::EMPTY;
    sorted.parse(keywords)?;
    let names = via_byte_sink(|sink| {
        for (keyword, _) in sorted.iter() {
            sink.add_all(keyword);
            sink.add(0);
        }
        Ok(())
    });
    Ok(Some(UKeywordsContext::new(names?)))
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Form {
    /// Normalizes case, separators and keyword order. Keeps a POSIX code page and variant.
    Name,
    /// `Name` without the keywords.
    BaseName,
    /// `Name` without the code page, with the POSIX variant converted and `CANONICALIZE_MAP` applied.
    Canonical,
}

const MAX_CHARSET_LENGTH: usize = 64;

/// Replaces '_' by '-', unless the second byte is a separator (`x_foo`).
fn with_hyphens(tag: &[u8]) -> Result<Cow<'_, [u8]>, UErrorCode> {
    if find_byte(tag, b'_').is_none() || is_id_separator(tag.at(1)) {
        return Ok(Cow::Borrowed(tag));
    }
    let mut copy = try_to_vec(tag)?;
    copy.iter_mut()
        .filter(|c| **c == b'_')
        .for_each(|c| *c = b'-');
    Ok(Cow::Owned(copy))
}

/// `to_locale_id` for a tag that may have '_' as separator.
#[inline]
fn to_locale_id_leniently(id: &[u8]) -> Result<Cow<'_, [u8]>, UErrorCode> {
    if has_bcp47_extension(id) {
        tag_to_locale_id(with_hyphens(id)?)
    } else {
        Ok(Cow::Borrowed(id))
    }
}

const I_DEFAULT: &[u8] = b"i-default";

/// Fails if `canonicalize` replaces the subtags of `locale_id` by the default locale.
pub(crate) fn check_not_default(locale_id: &[u8]) -> Result<(), UErrorCode> {
    let is_default = split_language(&to_locale_id_leniently(locale_id)?)?.0 == I_DEFAULT;
    if is_default {
        Err(U_ILLEGAL_ARGUMENT_ERROR)
    } else {
        Ok(())
    }
}

// ICU4C: uloc.cpp, _canonicalize
fn canonicalize(locale_id: &[u8], form: Form, sink: &mut ByteSink) -> Result<(), UErrorCode> {
    let locale_id = to_locale_id_leniently(locale_id)?;
    let (subtags, variant, rest) = Subtags::parse_with_variant(&locale_id)?;
    let (before_at, after_at) = split_once(rest, b'@');
    let is_default = subtags.language == I_DEFAULT;
    let mut name = SmallChars::new();
    if is_default {
        name.add_all(uloc_get_default().to_bytes());
    } else {
        append_subtags(
            &subtags.language(),
            &subtags.script(),
            &subtags.region(),
            &variant,
            &mut name,
        );
    }

    // Of the unparsed text before the '@', only a code page is kept.
    if form != Form::Canonical
        && let [b'.', charset @ ..] = before_at
    {
        if charset.len() > MAX_CHARSET_LENGTH {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        name.add_all(before_at);
    }

    let equal_sign = after_at.and_then(|after_at| find_byte(after_at, b'='));
    if let (Some(posix), None) = (after_at, equal_sign) {
        // The variant and a separator count too.
        let variant_len = variant.len() + usize::from(!variant.is_empty());
        if form != Form::Canonical {
            if variant_len + posix.len() > MAX_VARIANTS_LENGTH {
                return Err(U_ILLEGAL_ARGUMENT_ERROR);
            }
            sink.add_all(&name);
            sink.add(b'@');
            sink.add_all(posix);
            return Ok(());
        }
        let len = posix
            .iter()
            .take(MAX_VARIANTS_LENGTH + 1)
            .take_while(|&&c| !is_terminator(c))
            .count();
        let is_present = [
            !subtags.script.is_empty(),
            !subtags.region.is_empty(),
            !variant.is_empty(),
        ];
        let separators: &[u8] = match is_present {
            _ if is_default => b"__",
            [false, false, false] => b"__",
            [true, true, true] | [false, true, true] => b"",
            _ => b"_",
        };
        if variant_len + len > MAX_VARIANTS_LENGTH {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        name.add_all(separators);
        if len > 0 && !variant.is_empty() {
            name.add(b'_');
        }
        append_variant(posix.slice(..len), b',', &mut name);
    }

    let map = if form == Form::Canonical {
        CANONICALIZE_MAP
    } else {
        &[]
    };
    let name = &*name;
    sink.add_all(
        map.iter()
            .find(|(id, _)| *id == name)
            .map_or(name, |(_, canonical)| canonical),
    );

    // The keywords are dropped if a ';' precedes the first '='.
    let keywords = after_at.zip(equal_sign).filter(|&(keywords, equal_sign)| {
        form != Form::BaseName && find_byte(keywords.slice(..equal_sign), b';').is_none()
    });
    if let Some((keywords, _)) = keywords {
        sink.add(b'@');
        let mut sorted = SortedKeywords::EMPTY;
        sorted.parse(keywords)?;
        sorted.append_to(sink);
    }
    Ok(())
}

pub(crate) fn ulocimp_get_name(locale_id: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    via_byte_sink(|sink| ulocimp_get_name_to(locale_id, sink))
}

pub(crate) fn ulocimp_get_name_to(locale_id: &[u8], sink: &mut ByteSink) -> Result<(), UErrorCode> {
    canonicalize(locale_id, Form::Name, sink)
}

pub(crate) fn ulocimp_get_base_name_to(
    locale_id: &[u8],
    sink: &mut ByteSink,
) -> Result<(), UErrorCode> {
    canonicalize(locale_id, Form::BaseName, sink)
}

pub(crate) fn ulocimp_canonicalize(locale_id: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    via_byte_sink(|sink| ulocimp_canonicalize_to(locale_id, sink))
}

pub(crate) fn ulocimp_canonicalize_to(
    locale_id: &[u8],
    sink: &mut ByteSink,
) -> Result<(), UErrorCode> {
    canonicalize(locale_id, Form::Canonical, sink)
}

/// Returns the text before the last '_', without a leading `und`. The ID is not parsed.
pub(crate) fn uloc_get_parent(locale_id: &[u8]) -> &[u8] {
    let parent = locale_id.slice(..find_last_byte(locale_id, b'_').unwrap_or(0));
    match locale_id {
        [b'u' | b'U', b'n' | b'N', b'd' | b'D', b'_', ..] => parent.slice(3..),
        _ => parent,
    }
}
