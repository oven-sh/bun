//! Loads and selects the engine that divides a run of dictionary characters. ICU4C: brkeng.cpp

use crate::common::charstr::SmallChars;
use crate::common::cstring::{find_last_byte, until_nul};
use crate::common::dictbe::{
    BURMESE, CjkBreakEngine, KHMER, LAO, THAI, WordBreakEngine, WordScript, is_common_script_kana,
    is_hangul_syllable,
};
use crate::common::dictionarydata::DictionaryMatcher;
use crate::common::lstmbe::LSTMBreakEngine;
use crate::common::memory::is_oom;
use crate::common::slice_ext::SliceExt as _;
use crate::common::uchar::uscript_get_script;
use crate::common::udata::{self, searches_files};
use crate::common::uinvchar::invariant_chars;
use crate::common::umutex::OnceBox;
use crate::common::unicode::uscript::*;
use crate::common::uresimp::{U_ICUDATA_BRKITR, ures_get_string_by_key_with_fallback, ures_open};
use crate::common::utf16::{self, code_points};
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, UErrorCode};
use std::ops::Range;

enum Engine {
    Words(WordBreakEngine),
    ChineseJapanese(CjkBreakEngine),
    Korean(CjkBreakEngine),
    Lstm(&'static WordScript, Box<LSTMBreakEngine>),
}

// ICU4C: brkeng.cpp, ICULanguageBreakFactory::loadDictionaryMatcherFor
fn load_dictionary(script_name: &[u8]) -> Result<DictionaryMatcher, UErrorCode> {
    let root = ures_open(Some(U_ICUDATA_BRKITR), b"")?;
    let table = root.get_by_key_with_fallback(b"dictionaries")?;
    let file = ures_get_string_by_key_with_fallback(&table, script_name)?;
    let file: SmallChars = invariant_chars(file.iter())?;
    let (name, type_) = file.split_soft(find_last_byte(&file, b'.').unwrap_or(file.len()));
    let type_ = until_nul(type_.get(1..).unwrap_or_default());
    let item = udata::open(U_ICUDATA_BRKITR, type_, until_nul(name))?;
    DictionaryMatcher::new(item.memory).ok_or(U_INVALID_FORMAT_ERROR)
}

// ICU4C: brkeng.cpp, ICULanguageBreakFactory::loadEngineFor
fn engine_for(script: UScriptCode) -> Option<&'static Engine> {
    static ENGINES: [OnceBox<Engine>; 6] = [const { OnceBox::new() }; _];
    let [thai, lao, burmese, khmer, chinese_japanese, korean] = &ENGINES;
    let (slot, name, word_script) = match script {
        USCRIPT_THAI => (thai, b"Thai", Some(&THAI)),
        USCRIPT_LAO => (lao, b"Laoo", Some(&LAO)),
        USCRIPT_MYANMAR => (burmese, b"Mymr", Some(&BURMESE)),
        USCRIPT_KHMER => (khmer, b"Khmr", Some(&KHMER)),
        USCRIPT_HIRAGANA => (chinese_japanese, b"Hira", None),
        USCRIPT_KATAKANA => (chinese_japanese, b"Kana", None),
        USCRIPT_HAN => (chinese_japanese, b"Hani", None),
        // The linked data have no Korean dictionary, and each new iterator would look for it.
        USCRIPT_HANGUL if searches_files() == Ok(true) => (korean, b"Hang", None),
        _ => return None,
    };
    let load = || {
        let Some(word_script) = word_script else {
            let dictionary = load_dictionary(name)?;
            return if script == USCRIPT_HANGUL {
                CjkBreakEngine::new(dictionary).map(Engine::Korean)
            } else {
                CjkBreakEngine::for_chinese_japanese(dictionary).map(Engine::ChineseJapanese)
            };
        };
        if matches!(script, USCRIPT_THAI | USCRIPT_MYANMAR)
            && let Ok(engine) = LSTMBreakEngine::new(name)
        {
            return Ok(Engine::Lstm(word_script, engine));
        }
        Ok(Engine::Words(WordBreakEngine {
            script: word_script,
            dictionary: load_dictionary(name)?,
        }))
    };
    slot.get_or_try_init(load).ok()
}

/// What an iterator knows about engines. ICU4C: rbbi.cpp, RuleBasedBreakIterator::getLanguageBreakEngine
#[derive(Default)]
pub(crate) struct LanguageBreakEngines {
    /// The script of the last character without an engine. It stays without, even if another iterator loads the engine.
    unhandled: Option<UScriptCode>,
    pub(crate) finds_clusters: bool,
}

impl LanguageBreakEngines {
    fn get(&mut self, c: u32, script: UScriptCode) -> Option<&'static Engine> {
        let engine = if is_common_script_kana(c) {
            engine_for(USCRIPT_KATAKANA)
        } else if self.unhandled == Some(script) {
            return None;
        } else {
            engine_for(script)
        };
        match engine {
            // It handles three scripts, whichever has loaded it.
            Some(Engine::ChineseJapanese(_)) => {
                let is_handled =
                    |it: &mut _| matches!(*it, USCRIPT_HAN | USCRIPT_HIRAGANA | USCRIPT_KATAKANA);
                self.unhandled.take_if(is_handled);
            }
            // After an allocation failure a later call may still load the engine.
            None if !is_oom() => self.unhandled = Some(script),
            _ => {}
        }
        engine
    }

    /// Appends the boundaries inside the run that one engine handles at the start of `range`. Returns the end of the run.
    pub(crate) fn find_breaks(
        &mut self,
        text: &[u16],
        range: Range<usize>,
        found_breaks: &mut Vec<i32>,
    ) -> Result<usize, UErrorCode> {
        let (start, mut after_first) = (range.start, range.start);
        let first = utf16::next(text, &mut after_first);
        let run_end = |handles: &dyn Fn(u32) -> bool| {
            let rest = code_points(text.slice(after_first..range.end)).take_while(|&c| handles(c));
            after_first + rest.map(utf16::length).sum::<usize>()
        };
        let script = uscript_get_script(first);
        let Some(engine) = self.get(first, script) else {
            return Ok(run_end(&|c| uscript_get_script(c) == script));
        };
        let end = match engine {
            Engine::Words(WordBreakEngine { script, .. }) | Engine::Lstm(script, _) => {
                let handles = |c| script.handles(c);
                handles(first).then(|| run_end(&handles))
            }
            Engine::ChineseJapanese(_) => Some(run_end(&CjkBreakEngine::handles)),
            Engine::Korean(_) => is_hangul_syllable(first).then(|| run_end(&is_hangul_syllable)),
        };
        // The engine of a script need not handle all of it.
        let Some(end) = end else {
            return Ok(after_first);
        };
        match engine {
            Engine::Words(engine) => engine.divide_up(text, start as i32, end as i32, found_breaks),
            Engine::ChineseJapanese(engine) | Engine::Korean(engine) => {
                engine.divide_up(text.slice(start..end), start as i32, found_breaks)?;
            }
            Engine::Lstm(_, engine) => {
                engine.divide_up(text, start..end, found_breaks, self.finds_clusters)?;
            }
        }
        Ok(end)
    }
}
