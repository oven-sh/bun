//! CLDR's likely subtags, from `langInfo.res`: "zh" is most likely "zh_Hans_CN". ICU4C: loclikelysubtags.cpp, lsr.cpp

use crate::common::bytes::I32s;
use crate::common::bytestrie::BytesTrie;
use crate::common::locid::Locale;
use crate::common::maps::Map;
use crate::common::memory::{insert_within_capacity, try_map_reserve};
use crate::common::propname::uscript_get_short_name;
use crate::common::resource::{ResourceArray, ResourceTable, ResourceValue};
use crate::common::slice_ext::to_index;
use crate::common::uinvchar::invariant_prefix;
use crate::common::uloc::{Language, Region, Script, Subtag};
use crate::common::umutex::OnceBox;
use crate::common::uresimp::ures_open_direct;
use crate::common::ustringtrie::UStringTrieResult;
use crate::common::utypes::*;

/// The bit that marks the last byte of a subtag in the trie.
const END_OF_SUBTAG: u8 = 0x80;
/// The trie value of a language that is followed directly by the region.
const SKIP_SCRIPT: i32 = 1;

#[derive(PartialEq, Eq)]
pub(crate) struct Lsr {
    pub(crate) language: Language,
    pub(crate) script: Script,
    pub(crate) region: Region,
}

impl Lsr {
    fn new(language: &[u8], script: &[u8], region: &[u8]) -> Self {
        Self {
            language: Subtag::new(language.iter().copied()),
            script: Subtag::new(script.iter().copied()),
            region: Subtag::new(region.iter().copied()),
        }
    }
}

type Aliases<const N: usize> = Map<Subtag<N>, Subtag<N>>;

pub(crate) struct LikelySubtags {
    language_aliases: Aliases<{ Language::CAPACITY }>,
    region_aliases: Aliases<{ Region::CAPACITY }>,
    /// Maps a language, a script and a region to an index into `lsrnum`. "*" is a missing or unknown subtag.
    trie: BytesTrie<'static>,
    trie_und_zzzz: BytesTrie<'static>,
    lsrnum: I32s<'static>,
    /// The numeric regions that `lsrnum` refers to.
    m49: ResourceArray,
}

fn read_subtag<const N: usize>(value: &ResourceValue) -> Result<Subtag<N>, UErrorCode> {
    Ok(Subtag::new(invariant_prefix(value.get_string()?.iter())))
}

fn required(table: &ResourceTable, key: &[u8]) -> Result<ResourceValue, UErrorCode> {
    table.get(key).ok_or(U_MISSING_RESOURCE_ERROR)
}

/// Reads an array in which each alias is followed by its canonical form.
fn read_aliases<const N: usize>(pairs: &ResourceArray) -> Result<Aliases<N>, UErrorCode> {
    let mut aliases = Aliases::default();
    try_map_reserve(&mut aliases, pairs.get_size() / 2)?;
    let mut items = pairs.iter();
    while let Some((alias, canonical)) = items.next().zip(items.next()) {
        insert_within_capacity(&mut aliases, read_subtag(&alias)?, read_subtag(&canonical)?);
    }
    Ok(aliases)
}

fn get_canonical<'a, const N: usize>(aliases: &'a Aliases<N>, alias: &'a [u8]) -> &'a [u8] {
    aliases.get(alias).map_or(alias, Subtag::as_bytes)
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

    fn load() -> Result<Self, UErrorCode> {
        let lang_info = ures_open_direct(None, b"langInfo")?;
        let likely = lang_info.find_by_key(b"likely")?.get_table()?;
        let trie = BytesTrie::new(required(&likely, b"trie")?.get_binary()?);
        let mut trie_und_zzzz = trie;
        trie_und_zzzz.next(b'*'.into());
        trie_und_zzzz.next(b'*'.into());
        Ok(Self {
            language_aliases: read_aliases(&required(&likely, b"languageAliases")?.get_array()?)?,
            region_aliases: read_aliases(&required(&likely, b"regionAliases")?.get_array()?)?,
            trie,
            trie_und_zzzz,
            lsrnum: required(&likely, b"lsrnum")?.get_int_vector()?,
            m49: required(&likely, b"m49")?.get_array()?,
        })
    }

    /// An entry has the script code in the high byte, then two digits for the region and three for the language.
    fn lsr(&self, index: i32) -> Option<Lsr> {
        let encoded = self.lsrnum.get(to_index(index))?;
        let digits = (encoded & 0x00ff_ffff) as usize;
        let (language, region) = (digits % (27 * 27 * 27), digits / (27 * 27 * 27) % (27 * 27));
        let script = uscript_get_short_name((encoded >> 24) & 0xff);
        Some(Lsr {
            language: decode_letters(language, b'a' - 1),
            script: Script::new(script.iter().copied()),
            region: if region < 27 {
                read_subtag(&self.m49.get(region)?).ok()?
            } else {
                decode_letters(region, b'A' - 1)
            },
        })
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
            get_canonical(&self.language_aliases, language),
            script,
            get_canonical(&self.region_aliases, region),
        );
        Ok(max.unwrap_or_else(|| Lsr::new(language, script, region)))
    }

    /// Returns `None` if a subtag is missing and the trie lacks the language.
    fn maximize(&self, language: &[u8], script: &[u8], region: &[u8]) -> Option<Lsr> {
        let (language, script, mut region) = (
            empty_if(b"und", language),
            empty_if(b"Zzzz", script),
            empty_if(b"ZZ", region),
        );
        let input = Lsr::new(language, script, region);
        if !language.is_empty() && !script.is_empty() && !region.is_empty() {
            return Some(input);
        }
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
                value = values.find(|&value| value >= 0)?;
            } else if is_macroregion(region) {
                region = b"";
            }
        }
        let mut max = self.lsr(value)?;
        if !language.is_empty() {
            max.language = input.language;
        }
        if !script.is_empty() {
            max.script = input.script;
        }
        if !region.is_empty() {
            max.region = input.region;
        }
        Some(max)
    }

    /// Returns the first of the language, the language and region, the language and script that has the same maximum.
    pub(crate) fn minimize_subtags(&self, lsr: Lsr) -> Lsr {
        let Some(max) = self.maximize(&lsr.language, &lsr.script, &lsr.region) else {
            return lsr;
        };
        let (none, script, region): (&[u8], &[u8], &[u8]) = (b"", &max.script, &max.region);
        let (script, region) = [(none, none), (none, region), (script, none)]
            .into_iter()
            .find(|(script, region)| {
                self.maximize(&max.language, script, region).as_ref() == Some(&max)
            })
            .unwrap_or((script, region));
        Lsr::new(&max.language, script, region)
    }
}
