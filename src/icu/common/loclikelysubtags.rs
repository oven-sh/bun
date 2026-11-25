//! CLDR's likely subtags, from `langInfo.res`: "zh" is most likely "zh_Hans_CN". ICU4C: loclikelysubtags.cpp, lsr.cpp

use crate::common::bytes::I32s;
use crate::common::bytestrie::BytesTrie;
use crate::common::charstr::{CharStrings, Span};
use crate::common::locid::Locale;
use crate::common::maps::Map;
use crate::common::memory::{insert_within_capacity, try_map_reserve};
use crate::common::propname::uscript_get_short_name;
use crate::common::resource::{ResourceArray, ResourceTable, ResourceValue};
use crate::common::slice_ext::to_index;
use crate::common::udata::searches_files;
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::{Language, Region, Script, Subtag};
use crate::common::umutex::OnceBox;
use crate::common::uresimp::{UResourceBundle, ures_open_direct};
use crate::common::ustringtrie::UStringTrieResult;
use crate::common::utypes::*;

/// The bit that marks the last byte of a subtag in the trie.
const END_OF_SUBTAG: u8 = 0x80;
/// The trie value of a language that is followed directly by the region.
const SKIP_SCRIPT: i32 = 1;

/// The subtags of a locale ID.
#[derive(Default, PartialEq, Eq)]
pub(crate) struct Lsr {
    pub(crate) language: Language,
    pub(crate) script: Script,
    pub(crate) region: Region,
}

/// An entry of the likely subtags, in which the subtags of the input have replaced their counterparts.
#[derive(Default, PartialEq, Eq)]
struct MaximizedLsr<'a> {
    /// The subtags, or as much of them as fits.
    short: Lsr,
    has_long_language: bool,
    long_script: Option<&'a [u8]>,
    long_region: Option<&'a [u8]>,
}

impl<'a> MaximizedLsr<'a> {
    fn new(language: &[u8], script: &'a [u8], region: &'a [u8]) -> Self {
        let mut lsr = Self::default();
        lsr.set_language(language);
        lsr.set_script(script);
        lsr.set_region(region);
        lsr
    }

    fn set_language(&mut self, language: &[u8]) {
        self.short.language = Subtag::new(language.iter().copied());
        self.has_long_language = language.len() > Language::CAPACITY;
    }

    fn set_script(&mut self, script: &'a [u8]) {
        self.short.script = Subtag::new(script.iter().copied());
        self.long_script = (script.len() > Script::CAPACITY).then_some(script);
    }

    fn set_region(&mut self, region: &'a [u8]) {
        self.short.region = Subtag::new(region.iter().copied());
        self.long_region = (region.len() > Region::CAPACITY).then_some(region);
    }

    fn is_empty(&self) -> bool {
        let short = &self.short;
        short.language.is_empty() && short.script.is_empty() && short.region.is_empty()
    }

    /// Fails if a subtag is too long. ICU4C: loclikely.cpp, createTagStringWithAlternates
    fn into_lsr(self) -> Result<Lsr, UErrorCode> {
        if self.has_long_language || self.long_script.or(self.long_region).is_some() {
            Err(U_ILLEGAL_ARGUMENT_ERROR)
        } else {
            Ok(self.short)
        }
    }
}

enum Code<const N: usize> {
    Short(Subtag<N>),
    /// In `LikelySubtags::strings`.
    Long(Span),
}

type Aliases<const N: usize> = Map<Subtag<N>, Code<N>>;

/// The codes of `m49` that `check_lsr_numbers` has met.
type M49 = [Span; 27];

pub(crate) struct LikelySubtags {
    strings: CharStrings,
    language_aliases: Aliases<{ Language::CAPACITY }>,
    region_aliases: Aliases<{ Region::CAPACITY }>,
    /// Maps a language, a script and a region to an index into `lsrnum`. "*" is a missing or unknown subtag.
    trie: BytesTrie<'static>,
    trie_und_zzzz: BytesTrie<'static>,
    lsrnum: I32s<'static>,
    /// The numeric regions that `lsrnum` refers to.
    m49_array: ResourceArray,
    m49: M49,
}

/// For the linked data, in which each code is short and invariant.
fn read_subtag<const N: usize>(value: &ResourceValue) -> Result<Subtag<N>, UErrorCode> {
    Ok(Subtag::new(invariant_prefix(value.get_string()?.iter())))
}

#[cold]
fn read_code<const N: usize>(
    value: &ResourceValue,
    strings: &mut CharStrings,
) -> Result<Code<N>, UErrorCode> {
    let span = strings.add_invariant(value.get_data_string()?)?;
    let code = strings.get(span);
    Ok(if code.len() > N {
        Code::Long(span)
    } else {
        Code::Short(Subtag::new(code.iter().copied()))
    })
}

fn required(table: &ResourceTable, key: &[u8]) -> Result<ResourceValue, UErrorCode> {
    table.get(key).ok_or(U_MISSING_RESOURCE_ERROR)
}

/// Reads an array in which each alias is followed by its canonical form. No locale has a long alias.
fn read_aliases<const N: usize>(
    likely: &ResourceTable,
    key: &[u8],
    searches_files: bool,
    strings: &mut CharStrings,
) -> Result<Aliases<N>, UErrorCode> {
    let mut aliases = Aliases::default();
    let Some(pairs) = likely.get(key) else {
        return Ok(aliases);
    };
    let pairs = pairs.get_array()?;
    if !pairs.get_size().is_multiple_of(2) {
        return Err(U_INVALID_FORMAT_ERROR);
    }
    try_map_reserve(&mut aliases, pairs.get_size() / 2)?;
    let mut items = pairs.iter();
    while let Some((alias, canonical)) = items.next().zip(items.next()) {
        if !searches_files {
            let canonical = Code::Short(read_subtag(&canonical)?);
            insert_within_capacity(&mut aliases, read_subtag(&alias)?, canonical);
        } else if let (Code::Short(alias), canonical) =
            (read_code(&alias, strings)?, read_code(&canonical, strings)?)
        {
            insert_within_capacity(&mut aliases, alias, canonical);
        }
    }
    Ok(aliases)
}

/// An entry has the script code in the high byte, then two digits for the region and three for the language.
fn language_digits(encoded: i32) -> usize {
    (encoded & 0x00ff_ffff) as usize % (27 * 27 * 27)
}

fn region_digits(encoded: i32) -> usize {
    (encoded & 0x00ff_ffff) as usize / (27 * 27 * 27) % (27 * 27)
}

// ICU4C: loclikelysubtags.cpp, LikelySubtagsData::readLSREncodedStrings
fn check_lsr_numbers(
    numbers: I32s,
    m49_array: &ResourceArray,
    m49: &mut M49,
    strings: &mut CharStrings,
) -> Result<(), UErrorCode> {
    let mut has_met = [false; 27];
    for encoded in numbers.iter().filter(|encoded| !matches!(encoded, 0 | 1)) {
        let (language, region) = (language_digits(encoded), region_digits(encoded));
        if language.is_multiple_of(27) || (language / 27).is_multiple_of(27) {
            return Err(U_INVARIANT_CONVERSION_ERROR);
        }
        if let Some((code, has_met)) = m49.get_mut(region).zip(has_met.get_mut(region)) {
            if !std::mem::replace(has_met, true) {
                let text = m49_array.get(region).ok_or(U_MISSING_RESOURCE_ERROR)?;
                *code = strings.add_invariant(text.get_data_string()?)?;
            }
        } else if region.is_multiple_of(27) {
            return Err(U_INVARIANT_CONVERSION_ERROR);
        }
    }
    Ok(())
}

/// Nothing reads the table `match`, but there are no likely subtags if it is malformed.
fn check_match(lang_info: &UResourceBundle, m49_array: &ResourceArray) -> Result<(), UErrorCode> {
    const REGION_INDEX_LIMIT: usize = 1001 + 26 * 26;
    let table = match lang_info.get_by_key_with_fallback(b"match") {
        Err(U_MISSING_RESOURCE_ERROR) => return Ok(()),
        found => found?.get_value().get_table()?,
    };
    let mut strings = CharStrings::default();
    if let Some(trie) = table.get(b"trie") {
        trie.get_binary()?;
    }
    if let Some(partitions) = table.get(b"regionToPartitions")
        && partitions.get_binary()?.len() < REGION_INDEX_LIMIT
    {
        return Err(U_INVALID_FORMAT_ERROR);
    }
    if let Some(partitions) = table.get(b"partitions") {
        for partition in partitions.get_array()?.iter() {
            strings.add_invariant(partition.get_data_string()?)?;
        }
    }
    if let Some(paradigms) = table.get(b"paradigmnum") {
        let numbers = paradigms.get_int_vector()?;
        check_lsr_numbers(numbers, m49_array, &mut M49::default(), &mut strings)?;
    }
    match table.get(b"distances") {
        Some(distances) if distances.get_int_vector()?.len() < 4 => Err(U_INVALID_FORMAT_ERROR),
        _ => Ok(()),
    }
}

/// Each letter is a base-27 digit from 1 to 26. The first letter is the least significant.
fn decode_letters<const N: usize>(mut digits: usize, before_first: u8) -> Subtag<N> {
    Subtag::new(std::iter::from_fn(|| {
        let digit = (digits % 27) as u8;
        digits /= 27;
        (digit != 0).then_some(before_first + digit)
    }))
}

/// Returns -1 for no match, 0 if the next subtag decides, else `SKIP_SCRIPT` or an index into `lsrnum`.
fn trie_next(iter: &mut BytesTrie, subtag: &[u8]) -> i32 {
    match match subtag {
        [] => iter.next(b'*'.into()),
        [start @ .., last] if start.iter().all(|&c| iter.next(c.into()).has_next()) => {
            iter.next((last | END_OF_SUBTAG).into())
        }
        _ => UStringTrieResult::NoMatch,
    } {
        UStringTrieResult::NoMatch => -1,
        UStringTrieResult::NoValue => 0,
        UStringTrieResult::IntermediateValue => SKIP_SCRIPT,
        UStringTrieResult::FinalValue => iter.get_value(),
    }
}

fn value_after(mut iter: BytesTrie, subtag: &[u8]) -> i32 {
    trie_next(&mut iter, subtag)
}

fn empty_if<'a>(unknown: &[u8], subtag: &'a [u8]) -> &'a [u8] {
    if subtag == unknown { b"" } else { subtag }
}

#[rustfmt::skip]
fn is_macroregion(region: &[u8]) -> bool {
    matches!(region,
        b"001" | b"002" | b"003" | b"005" | b"009" | b"011" | b"013" | b"014" | b"015" | b"017" | b"018" | b"019" | b"021" |
        b"029" | b"030" | b"034" | b"035" | b"039" | b"053" | b"054" | b"057" | b"061" | b"142" | b"143" | b"145" | b"150" |
        b"151" | b"154" | b"155" | b"202" | b"419" | b"EU" | b"EZ" | b"QO" | b"UN")
}

impl LikelySubtags {
    pub(crate) fn get() -> Result<&'static Self, UErrorCode> {
        static SINGLETON: OnceBox<Result<LikelySubtags, UErrorCode>> = OnceBox::new();
        SINGLETON.get_or_init_caching_err(Self::load)
    }

    // ICU4C: loclikelysubtags.cpp, LikelySubtagsData::load
    fn load() -> Result<Self, UErrorCode> {
        let lang_info = ures_open_direct(None, b"langInfo")?;
        let likely = lang_info.get_by_key_with_fallback(b"likely")?;
        let likely = likely.get_value().get_table()?;
        let m49_array = required(&likely, b"m49")?.get_array()?;
        let (mut m49, mut strings) = (M49::default(), CharStrings::default());
        let files = searches_files()?;
        let language_aliases = read_aliases(&likely, b"languageAliases", files, &mut strings)?;
        let region_aliases = read_aliases(&likely, b"regionAliases", files, &mut strings)?;
        let lsrnum = required(&likely, b"lsrnum")?.get_int_vector()?;
        let trie_bytes = required(&likely, b"trie")?.get_binary()?;
        if files {
            check_lsr_numbers(lsrnum, &m49_array, &mut m49, &mut strings)?;
            if lsrnum.is_empty() {
                return Err(U_MISSING_RESOURCE_ERROR);
            }
            check_match(&lang_info, &m49_array)?;
            if trie_bytes.is_empty() {
                return Err(U_INVALID_FORMAT_ERROR);
            }
        }
        let trie = BytesTrie::new(trie_bytes);
        let mut trie_und_zzzz = trie;
        trie_und_zzzz.next(b'*'.into());
        trie_und_zzzz.next(b'*'.into());
        if files && { trie_und_zzzz }.next(b'*'.into()) == UStringTrieResult::NoMatch {
            return Err(U_INVALID_FORMAT_ERROR);
        }
        Ok(Self {
            language_aliases,
            region_aliases,
            strings,
            trie,
            trie_und_zzzz,
            lsrnum,
            m49_array,
            m49,
        })
    }

    fn get_canonical<'a, const N: usize>(
        &'a self,
        aliases: &'a Aliases<N>,
        alias: &'a [u8],
    ) -> &'a [u8] {
        match aliases.get(alias) {
            Some(Code::Short(canonical)) => canonical,
            Some(&Code::Long(canonical)) => self.strings.get(canonical),
            None => alias,
        }
    }

    /// The result is empty if there is no such entry.
    #[inline(always)]
    fn lsr(&self, index: i32) -> MaximizedLsr<'_> {
        let encoded = match self.lsrnum.get(to_index(index)) {
            None | Some(0) => return MaximizedLsr::default(),
            Some(1) => return MaximizedLsr::new(b"skip", b"script", b""),
            Some(encoded) => encoded,
        };
        let (language, region) = (language_digits(encoded), region_digits(encoded));
        let script = uscript_get_short_name((encoded >> 24) & 0xff);
        let short = Lsr {
            language: decode_letters(language, b'a' - 1),
            script: Subtag::new(script.iter().copied()),
            region: decode_letters(region, b'A' - 1),
        };
        let mut lsr = MaximizedLsr {
            short,
            ..MaximizedLsr::default()
        };
        if let Some(&met) = self.m49.get(region) {
            match self.m49_array.get(region).map(|code| code.get_string()) {
                Some(Ok(code)) if code.len() <= Region::CAPACITY => {
                    lsr.short.region = Subtag::new(invariant_prefix(code.iter()));
                }
                _ => lsr.set_region(self.strings.get(met)),
            }
        }
        lsr
    }

    /// Returns the subtags of `locale` if its language is unknown.
    pub(crate) fn make_maximized_lsr_from(&self, locale: &Locale) -> Result<Lsr, UErrorCode> {
        if locale.is_bogus() {
            return Err(U_ILLEGAL_ARGUMENT_ERROR);
        }
        let (language, script, region) = (
            locale.get_language(),
            locale.get_script(),
            locale.get_country(),
        );
        let max = self.maximize(
            self.get_canonical(&self.language_aliases, language),
            script,
            self.get_canonical(&self.region_aliases, region),
        );
        if max.is_empty() {
            MaximizedLsr::new(language, script, region).into_lsr()
        } else {
            max.into_lsr()
        }
    }

    /// The result is empty if a subtag is missing and the trie lacks the language.
    fn maximize<'a>(
        &'a self,
        language: &[u8],
        script: &'a [u8],
        region: &'a [u8],
    ) -> MaximizedLsr<'a> {
        let (language, script, mut region) = (
            empty_if(b"und", language),
            empty_if(b"Zzzz", script),
            empty_if(b"ZZ", region),
        );
        if !language.is_empty() && !script.is_empty() && !region.is_empty() {
            return MaximizedLsr::new(language, script, region);
        }
        let Some(index) = self.find_index(language, script, &mut region) else {
            return MaximizedLsr::default();
        };
        let mut max = self.lsr(index);
        if !language.is_empty() {
            max.set_language(language);
        }
        if !script.is_empty() {
            max.set_script(script);
        }
        if !region.is_empty() {
            max.set_region(region);
        }
        max
    }

    /// Returns the index into `lsrnum`, or `None` if the trie lacks the language. Clears a macroregion that has an entry.
    #[inline(always)]
    fn find_index(&self, language: &[u8], script: &[u8], region: &mut &[u8]) -> Option<i32> {
        let mut iter = self.trie;
        let mut value = trie_next(&mut iter, language);
        match value {
            ..0 => return None,
            0 => {
                let after_language = iter;
                value = trie_next(&mut iter, script);
                if value < 0 {
                    iter = after_language;
                    value = trie_next(&mut iter, b"");
                }
            }
            SKIP_SCRIPT => value = 0,
            _ => {}
        }
        if value <= 0 {
            value = value_after(iter, region);
            if value < 0 {
                let fallbacks = [
                    (iter, &b""[..]),
                    (self.trie_und_zzzz, region),
                    (self.trie_und_zzzz, b""),
                ];
                let mut values = fallbacks
                    .into_iter()
                    .map(|(iter, region)| value_after(iter, region));
                value = values.find(|&value| value >= 0).unwrap_or(value);
            } else if is_macroregion(region) {
                *region = b"";
            }
        }
        Some(value)
    }

    /// Returns the first of the language, the language and region, the language and script that has the same maximum.
    pub(crate) fn minimize_subtags(&self, lsr: Lsr) -> Result<Lsr, UErrorCode> {
        let max = self.maximize(&lsr.language, &lsr.script, &lsr.region);
        if max.is_empty() {
            return Ok(lsr);
        }
        let (language, none): (&[u8], &[u8]) = (&max.short.language, b"");
        let script = max.long_script.unwrap_or(&max.short.script);
        let region = max.long_region.unwrap_or(&max.short.region);
        let (script, region) = [(none, none), (none, region), (script, none)]
            .into_iter()
            .find(|(script, region)| self.maximize(language, script, region) == max)
            .unwrap_or((script, region));
        MaximizedLsr::new(language, script, region).into_lsr()
    }
}
