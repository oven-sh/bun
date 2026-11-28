//! Conversion between locale IDs and BCP 47 language tags. Ill-formed parts are dropped. ICU4C: uloc_tag.cpp

use crate::common::charstr::{ByteSink, SmallChars, via_byte_sink};
use crate::common::maps::{Set, VecMap};
use crate::common::memory::{self, Appendable, fail_on_oom};
use crate::common::slice_ext::{SliceExt, SoftUnwrap};
use crate::common::sorting::sort_in_place;
use crate::common::uloc::{
    Subtag, Subtags, find_row, uloc_open_keywords, ulocimp_canonicalize_to,
    ulocimp_get_keyword_value,
};
use crate::common::uloc_keytype::{
    ulocimp_to_bcp_key, ulocimp_to_bcp_type, ulocimp_to_legacy_key, ulocimp_to_legacy_type,
};
use crate::common::uloc_tag_data::*;
use crate::common::utypes::{U_ILLEGAL_ARGUMENT_ERROR, U_MEMORY_ALLOCATION_ERROR, UErrorCode};
use bun_core::strings::{self, SplitIterator};
use std::borrow::Cow;
use std::cmp::Ordering;
use std::ffi::CStr;
use std::iter::Peekable;
use std::ops::RangeInclusive;

const SEP: u8 = b'-';
const PRIVATEUSE: u8 = b'x';
const LDMLEXT: u8 = b'u';

const LANG_UND: &[u8] = b"und";
const PRIVATEUSE_KEY: &[u8] = b"x";
const POSIX_KEY: &[u8] = b"va";
const POSIX_VALUE: &[u8] = b"posix";
const LOCALE_ATTRIBUTE_KEY: &[u8] = b"attribute";
const PRIVUSE_VARIANT_PREFIX: &[u8] = b"lvariant";

fn subtags(s: &[u8]) -> SplitIterator<'_> {
    strings::split(s, &[SEP])
}

fn is_alphabetic(s: &[u8]) -> bool {
    s.iter().all(u8::is_ascii_alphabetic)
}

fn is_alphanumeric(s: &[u8], length: RangeInclusive<usize>) -> bool {
    length.contains(&s.len()) && s.iter().all(u8::is_ascii_alphanumeric)
}

pub(crate) fn ultag_is_language_subtag(s: &[u8]) -> bool {
    (2..=8).contains(&s.len()) && is_alphabetic(s)
}

fn is_extlang_subtag(s: &[u8]) -> bool {
    s.len() == 3 && is_alphabetic(s)
}

pub(crate) fn ultag_is_script_subtag(s: &[u8]) -> bool {
    s.len() == 4 && is_alphabetic(s)
}

fn ultag_is_region_subtag(s: &[u8]) -> bool {
    (s.len() == 2 && is_alphabetic(s)) || (s.len() == 3 && s.iter().all(u8::is_ascii_digit))
}

fn is_variant_subtag(s: &[u8]) -> bool {
    is_alphanumeric(s, 4..=8) && (s.len() > 4 || s.at(0).is_ascii_digit())
}

fn is_extension_singleton(s: &[u8]) -> bool {
    is_alphanumeric(s, 1..=1) && !s.eq_ignore_ascii_case(PRIVATEUSE_KEY)
}

fn is_extension_subtag(s: &[u8]) -> bool {
    is_alphanumeric(s, 2..=8)
}

fn ultag_is_extension_subtags(s: &[u8]) -> bool {
    subtags(s).all(is_extension_subtag)
}

/// Tests a private use subtag, or a subtag after `x-lvariant`, the prefix for ill-formed variants.
fn is_privateuse_value_subtag(s: &[u8]) -> bool {
    is_alphanumeric(s, 1..=8)
}

fn ultag_is_privateuse_value_subtags(s: &[u8]) -> bool {
    subtags(s).all(is_privateuse_value_subtag)
}

pub(crate) fn ultag_is_unicode_locale_type(s: &[u8]) -> bool {
    subtags(s).all(|subtag| is_alphanumeric(subtag, 3..=8))
}

fn ultag_is_unicode_locale_key(s: &[u8]) -> bool {
    matches!(s, [first, second] if first.is_ascii_alphanumeric() && second.is_ascii_alphabetic())
}

/// Splits `s` before the first subtag that is a key, and drops the '-' at the split.
fn split_at_key(s: &[u8]) -> (&[u8], Option<&[u8]>) {
    let mut start = 0_usize;
    for subtag in subtags(s) {
        if ultag_is_unicode_locale_key(subtag) {
            return (s.slice(..start.saturating_sub(1)), Some(s.slice(start..)));
        }
        start += subtag.len() + 1;
    }
    (s, None)
}

fn append_subtag(sink: &mut ByteSink, separator: u8, subtag: &[u8]) {
    sink.add(separator);
    sink.add_all(subtag);
}

/// A singleton and its value, or a key of the `u` extension and its type.
type Extension<'a> = (&'a [u8], Cow<'a, [u8]>);

/// Puts `x` last. Longer keys sort as `u`, with "attribute" first, and equal the singleton `u`.
fn compare_extension_keys(left: &[u8], right: &[u8]) -> Ordering {
    let singleton = |key: &[u8]| match key {
        [PRIVATEUSE] => u8::MAX,
        [singleton] => *singleton,
        _ => LDMLEXT,
    };
    singleton(left).cmp(&singleton(right)).then_with(|| {
        if left.len() == 1 || right.len() == 1 {
            Ordering::Equal
        } else {
            (left != LOCALE_ATTRIBUTE_KEY, left).cmp(&(right != LOCALE_ATTRIBUTE_KEY, right))
        }
    })
}

/// Inserts `extension` in order, unless its key is a duplicate.
fn insert_extension<'a>(
    extensions: &mut Vec<Extension<'a>>,
    extension: Extension<'a>,
) -> Result<(), UErrorCode> {
    let orders = extensions
        .iter()
        .map(|(other, _)| compare_extension_keys(extension.0, other));
    match orders
        .enumerate()
        .find(|(_, order)| order.is_le())
        .unwrap_or((extensions.len(), Ordering::Greater))
    {
        (_, Ordering::Equal) => Ok(()),
        (index, _) => memory::try_insert(extensions, index, extension),
    }
}

/// Returns `None` if the extension would be ill-formed. `key` is alphanumeric.
fn extension_for_keyword(key: &[u8], mut value: Vec<u8>) -> Option<Extension<'_>> {
    match key {
        [PRIVATEUSE] => {
            ultag_is_privateuse_value_subtags(&value).then_some((key, Cow::Owned(value)))
        }
        [_] => ultag_is_extension_subtags(&value).then_some((key, Cow::Owned(value))),
        _ => {
            let bcp_key = ulocimp_to_bcp_key(key).map(CStr::to_bytes);
            let bcp_key = bcp_key.or_else(|| ultag_is_unicode_locale_key(key).then_some(key))?;
            if let Some(bcp_type) = ulocimp_to_bcp_type(key, &value) {
                return Some((bcp_key, Cow::Borrowed(bcp_type.to_bytes())));
            }
            value.make_ascii_lowercase();
            ultag_is_unicode_locale_type(&value).then_some((bcp_key, Cow::Owned(value)))
        }
    }
}

/// Sorts and deduplicates the attributes, valid or not, and puts a '-' before each. Ignores up to two trailing '-'.
fn join_attributes(value: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    let mut attributes = memory::try_collect(subtags(value))?;
    if attributes.pop_if(|last| last.is_empty()).is_some() {
        attributes.pop_if(|last| last.is_empty());
    }
    sort_in_place(&mut attributes);
    attributes.dedup();
    let mut joined = Vec::new();
    attributes
        .iter()
        .for_each(|attribute| append_subtag(&mut joined, SEP, attribute));
    Ok(joined)
}

// ICU4C: uloc_tag.cpp, _appendKeywordsToLanguageTag
fn append_keywords_to_language_tag(
    locale_id: &[u8],
    sink: &mut ByteSink,
    had_posix: bool,
) -> Result<(), UErrorCode> {
    let keywords = uloc_open_keywords(locale_id)?;
    // There are at most 25 keywords.
    let mut extensions = Vec::new();
    let mut attributes = Vec::new();
    for key in keywords.iter().flat_map(|keywords| keywords.names()) {
        let extension = match ulocimp_get_keyword_value(locale_id, key) {
            Err(_) => None,
            Ok(value) if key == LOCALE_ATTRIBUTE_KEY => {
                attributes = join_attributes(&value)?;
                Some((key, Cow::default()))
            }
            Ok(value) => extension_for_keyword(key, value),
        };
        if let Some(extension) = extension {
            insert_extension(&mut extensions, extension)?;
        }
    }
    if had_posix {
        insert_extension(&mut extensions, (POSIX_KEY, Cow::Borrowed(POSIX_VALUE)))?;
    }

    let mut is_in_ldml_extension = false;
    for (key, value) in &extensions {
        if !is_in_ldml_extension && key.len() > 1 {
            sink.add_all(b"-u");
            is_in_ldml_extension = true;
        }
        if *key == LOCALE_ATTRIBUTE_KEY {
            sink.add_all(&attributes);
            continue;
        }
        append_subtag(sink, SEP, key);
        if key.len() == 1 || !matches!(value.as_ref(), b"true" | b"yes") {
            append_subtag(sink, SEP, value);
        }
    }
    Ok(())
}

fn append_subtags_to_language_tag(parsed: &Subtags, sink: &mut ByteSink) {
    let (language, script, region) = (parsed.language(), parsed.script(), parsed.region());
    sink.add_all(if ultag_is_language_subtag(&language) {
        find_row::<3, _>(DEPRECATEDLANGS, &language).unwrap_or(&language)
    } else {
        LANG_UND
    });
    if !script.is_empty() {
        append_subtag(sink, SEP, &script);
    }
    if ultag_is_region_subtag(&region) {
        let current = find_row::<2, _>(DEPRECATEDREGIONS, &region);
        append_subtag(sink, SEP, current.unwrap_or(&region));
    }
}

pub(crate) fn ulocimp_to_language_tag_to(
    locale_id: &[u8],
    sink: &mut ByteSink,
) -> Result<(), UErrorCode> {
    if let Ok(parsed) = Subtags::parse(locale_id)
        && parsed.is_plain()
    {
        append_subtags_to_language_tag(&parsed, sink);
        return Ok(());
    }

    let mut canonical = SmallChars::new();
    fail_on_oom(|| ulocimp_canonicalize_to(locale_id, &mut canonical))?;
    if canonical.first() == Some(&b'@')
        && let Ok(Some(keywords)) = uloc_open_keywords(&canonical)
        && keywords.names().eq([PRIVATEUSE_KEY])
    {
        let value = ulocimp_get_keyword_value(locale_id, PRIVATEUSE_KEY)
            .map_err(|_| U_ILLEGAL_ARGUMENT_ERROR)?;
        if ultag_is_privateuse_value_subtags(&value) {
            sink.add_all(b"und-x-");
            sink.add_all(&value);
            return Ok(());
        }
    }

    // A canonical ID always parses. Only its variant can be too long, after a POSIX variant (`@euro`) was appended.
    let parsed = Subtags::parse(&canonical).ok().soft_unwrap();
    append_subtags_to_language_tag(&parsed, sink);

    let mut variant =
        via_byte_sink(|sink| parsed.variant().map(|(variant, _)| variant.append_to(sink)))?;
    variant.make_ascii_lowercase();
    let had_posix = variant == POSIX_VALUE;
    if variant.is_empty() || had_posix {
        return append_keywords_to_language_tag(&canonical, sink, had_posix);
    }
    let variant_subtags = || strings::tokenize_any(&variant, b"-_");
    let mut variants = Vec::new();
    for subtag in variant_subtags() {
        if is_variant_subtag(subtag) {
            variants.add(subtag);
        } else if is_privateuse_value_subtag(subtag) {
            break;
        }
    }
    sort_in_place(&mut variants);
    variants.dedup();
    variants
        .iter()
        .for_each(|variant| append_subtag(sink, SEP, variant));

    append_keywords_to_language_tag(&canonical, sink, false)?;

    // The variants from the first ill-formed one on.
    let mut prefix: &[u8] = b"-x-lvariant-";
    let private_use = variant_subtags().skip_while(|subtag| is_variant_subtag(subtag));
    for subtag in private_use.take_while(|subtag| is_privateuse_value_subtag(subtag)) {
        sink.add_all(prefix);
        sink.add_all(subtag);
        prefix = b"-";
    }
    Ok(())
}

/// A cursor over the subtags of a tag.
struct Scanner<'a> {
    subtags: Peekable<SplitIterator<'a>>,
    /// The start of the next subtag; the length of the tag plus one after the last one.
    next: usize,
}

impl<'a> Scanner<'a> {
    /// Consumes the next subtag if it passes `test`.
    fn next_if(&mut self, test: impl FnOnce(&[u8]) -> bool) -> Option<&'a [u8]> {
        let subtag = self.subtags.next_if(|subtag| test(subtag))?;
        self.next += subtag.len() + 1;
        Some(subtag)
    }

    /// Returns the end of the last consumed subtag. At least one must have been consumed.
    fn end(&self) -> usize {
        self.next - 1
    }
}

/// The well-formed prefix of a tag, in the letter case of a locale ID.
#[derive(Default)]
pub(crate) struct LanguageTag {
    language: Subtag<8>,
    /// The first of up to three extlang subtags.
    extlang: Subtag<3>,
    script: Subtag<4>,
    region: Subtag<3>,
    variants: Vec<Subtag<8>>,
    extensions: VecMap<u8, Vec<u8>>,
    privateuse: Vec<u8>,
    parsed_length: usize,
}

fn to_lowercase(s: &[u8]) -> Result<Vec<u8>, UErrorCode> {
    let mut lowercase = memory::try_to_vec(s)?;
    lowercase.make_ascii_lowercase();
    Ok(lowercase)
}

/// Returns the longest legacy or redundant tag that `tag` starts with, and its preferred value.
fn find_preferred(tag: &[u8]) -> Option<&'static (&'static [u8], &'static [u8])> {
    let short_enough = PREFERRED.partition_point(|(old, _)| old.len() <= tag.len());
    PREFERRED.slice(..short_enough).iter().rfind(|(old, _)| {
        let (start, rest) = tag.split_soft(old.len());
        matches!(rest, [] | [SEP, ..]) && start.eq_ignore_ascii_case(old)
    })
}

impl LanguageTag {
    // ICU4C: uloc_tag.cpp, ultag_parse
    pub(crate) fn new(langtag: &[u8]) -> Result<Self, UErrorCode> {
        // The length with the NUL has to fit an `i32`.
        if langtag.len() >= i32::MAX as usize {
            return Err(U_MEMORY_ALLOCATION_ERROR);
        }
        let mut tag = Self::default();
        if let Some((old, new)) = find_preferred(langtag) {
            tag.parse(&memory::try_concat(&[new, langtag.slice(old.len()..)])?)?;
            // No underflow: `new` is well-formed, so at least `new.len()` bytes were parsed.
            tag.parsed_length = tag.parsed_length - new.len() + old.len();
        } else {
            tag.parse(langtag)?;
        }
        sort_in_place(&mut tag.variants);
        Ok(tag)
    }

    /// Consumes variants while they pass `test`. Returns false at a duplicate.
    fn parse_variants(
        &mut self,
        scanner: &mut Scanner,
        test: fn(&[u8]) -> bool,
        seen: &mut Set<Subtag<8>>,
    ) -> Result<bool, UErrorCode> {
        while let Some(variant) = scanner.next_if(test) {
            let variant = Subtag::new(variant.iter().map(u8::to_ascii_uppercase));
            if !memory::try_set_insert(seen, variant)? {
                return Ok(false);
            }
            self.variants.add(variant);
            self.parsed_length = scanner.end();
        }
        Ok(true)
    }

    /// Consumes subtags up to the first one that the syntax does not allow.
    fn parse(&mut self, tag: &[u8]) -> Result<(), UErrorCode> {
        let mut scanner = Scanner {
            subtags: subtags(tag).peekable(),
            next: 0,
        };
        let mut seen = Set::default();
        if let Some(language) = scanner.next_if(ultag_is_language_subtag) {
            self.language = Subtag::new(language.iter().map(u8::to_ascii_lowercase));
            if language.len() <= 3
                && let Some(extlang) = scanner.next_if(is_extlang_subtag)
            {
                self.extlang = Subtag::new(extlang.iter().map(u8::to_ascii_lowercase));
                scanner.next_if(is_extlang_subtag);
                scanner.next_if(is_extlang_subtag);
            }
            if let Some([first, rest @ ..]) = scanner.next_if(ultag_is_script_subtag) {
                let rest = rest.iter().map(u8::to_ascii_lowercase);
                self.script = Subtag::new(std::iter::once(first.to_ascii_uppercase()).chain(rest));
            }
            if let Some(region) = scanner.next_if(ultag_is_region_subtag) {
                self.region = Subtag::new(region.iter().map(u8::to_ascii_uppercase));
            }
            self.parsed_length = scanner.end();
            if !self.parse_variants(&mut scanner, is_variant_subtag, &mut seen)? {
                return Ok(());
            }
            while let Some(singleton) = scanner.next_if(is_extension_singleton) {
                let (key, start) = (singleton.at(0).to_ascii_lowercase(), scanner.next);
                while scanner.next_if(is_extension_subtag).is_some() {}
                // An extension needs a value and may not be repeated.
                if scanner.next == start || self.extensions.contains_key(&key) {
                    return Ok(());
                }
                self.extensions
                    .try_insert(key, to_lowercase(tag.slice(start..scanner.end()))?)?;
                self.parsed_length = scanner.end();
            }
        }

        if scanner
            .next_if(|subtag| subtag.eq_ignore_ascii_case(PRIVATEUSE_KEY))
            .is_none()
        {
            return Ok(());
        }
        let start = scanner.next;
        let is_prefix = |subtag: &[u8]| subtag.starts_with(PRIVUSE_VARIANT_PREFIX);
        while scanner
            .next_if(|subtag| !is_prefix(subtag) && is_privateuse_value_subtag(subtag))
            .is_some()
        {
            self.parsed_length = scanner.end();
        }
        if scanner.next_if(is_prefix).is_some() {
            // The private use subtags before the prefix are dropped.
            self.parse_variants(&mut scanner, is_privateuse_value_subtag, &mut seen)?;
        } else if scanner.next > start {
            self.privateuse = to_lowercase(tag.slice(start..scanner.end()))?;
        }
        Ok(())
    }

    /// Returns the length of the well-formed prefix of the tag.
    pub(crate) fn parsed_length(&self) -> usize {
        self.parsed_length
    }

    pub(crate) fn to_locale_id(&self, sink: &mut ByteSink) -> Result<(), UErrorCode> {
        let language = if self.extlang.is_empty() {
            self.language.as_bytes()
        } else {
            self.extlang.as_bytes()
        };
        let language = if language == LANG_UND { &[] } else { language };
        sink.add_all(language);
        for subtag in [self.script.as_bytes(), self.region.as_bytes()] {
            if !subtag.is_empty() {
                append_subtag(sink, b'_', subtag);
            }
        }
        if !self.variants.is_empty() && self.region.is_empty() {
            sink.add(b'_');
        }
        self.variants
            .iter()
            .for_each(|variant| append_subtag(sink, b'_', variant));
        let is_empty = language.is_empty()
            && self.script.is_empty()
            && self.region.is_empty()
            && self.variants.is_empty();
        if is_empty && !self.extensions.is_empty() {
            sink.add_all(LANG_UND);
        }
        self.append_keywords(sink)
    }

    // ICU4C: uloc_tag.cpp, _appendKeywords
    fn append_keywords(&self, sink: &mut ByteSink) -> Result<(), UErrorCode> {
        // At most 36 singletons, 36 x 26 keys and "attribute".
        let mut keywords = Keywords::new();
        let mut posix_variant = false;
        let privateuse = (!self.privateuse.is_empty()).then_some((&PRIVATEUSE, &self.privateuse));
        for (singleton, value) in self.extensions.iter().chain(privateuse) {
            if *singleton == LDMLEXT {
                posix_variant =
                    add_ldml_extension_as_keywords(value, self.variants.is_empty(), &mut keywords)?;
            } else if keywords
                .try_insert(std::slice::from_ref(singleton), Cow::Borrowed(value))?
                .is_some()
            {
                // The data maps a key of `u` to this singleton.
                return Err(U_ILLEGAL_ARGUMENT_ERROR);
            }
        }
        if posix_variant {
            sink.add_all(b"_POSIX");
        }
        for (index, (key, value)) in keywords.iter().enumerate() {
            append_subtag(sink, if index == 0 { b'@' } else { b';' }, key);
            append_subtag(sink, b'=', value);
        }
        Ok(())
    }
}

type Keywords<'a> = VecMap<&'a [u8], Cow<'a, [u8]>>;

/// Converts `ldmlext`, the well-formed lower-case value of `u`. Returns whether `va-posix` becomes the variant.
fn add_ldml_extension_as_keywords<'a>(
    ldmlext: &'a [u8],
    posix_can_be_variant: bool,
    keywords: &mut Keywords<'a>,
) -> Result<bool, UErrorCode> {
    let (attributes, mut rest) = split_at_key(ldmlext);
    if !attributes.is_empty() {
        let mut joined = join_attributes(attributes)?;
        joined.drain(..joined.len().min(1));
        keywords.try_insert(LOCALE_ATTRIBUTE_KEY, Cow::Owned(joined))?;
    }
    let mut posix_variant = false;
    while let Some((bcp_key, after)) = rest.map(|rest| rest.split_soft(2)) {
        let bcp_type;
        (bcp_type, rest) = split_at_key(after);
        let key = ulocimp_to_legacy_key(bcp_key).map_or(bcp_key, CStr::to_bytes);
        let legacy =
            |bcp_type| ulocimp_to_legacy_type(key, bcp_type).map_or(bcp_type, CStr::to_bytes);
        let value = bcp_type.get(1..).map_or(&b"yes"[..], legacy);
        if posix_can_be_variant && key == POSIX_KEY && value == POSIX_VALUE {
            posix_variant = true;
        } else {
            keywords.try_insert_if_absent(key, Cow::Borrowed(value))?;
        }
    }
    Ok(posix_variant)
}

/// Returns the locale ID for the well-formed prefix of `langtag`, and the length of the prefix.
pub(crate) fn ulocimp_for_language_tag(langtag: &[u8]) -> Result<(Vec<u8>, usize), UErrorCode> {
    let tag = LanguageTag::new(langtag)?;
    Ok((
        via_byte_sink(|sink| tag.to_locale_id(sink))?,
        tag.parsed_length,
    ))
}
