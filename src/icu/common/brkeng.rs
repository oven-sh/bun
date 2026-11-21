//! Loads and selects the engine that divides a run of dictionary characters. ICU4C: brkeng.cpp

use crate::common::charstr::SmallChars;
use crate::common::cstring::split_once;
use crate::common::dictbe::{
    BURMESE, CjkBreakEngine, KHMER, LAO, THAI, WordBreakEngine, is_common_script_kana,
};
use crate::common::dictionarydata::DictionaryMatcher;
use crate::common::slice_ext::{SliceExt as _, SoftUnwrap as _};
use crate::common::uchar::uscript_get_script;
use crate::common::udata::{self, UDataInfo};
use crate::common::uinvchar::invariant_chars;
use crate::common::umutex::OnceBox;
use crate::common::unicode::uscript::*;
use crate::common::uresimp::{
    U_ICUDATA_BRKITR, UResourceBundle, ures_get_string_by_key_with_fallback, ures_open,
};
use crate::common::utf16::{self, code_points};
use crate::common::utypes::{U_INVALID_FORMAT_ERROR, UErrorCode};
use std::ops::Range;

enum Engine {
    Words(WordBreakEngine),
    Cjk(CjkBreakEngine),
}

/// Opens the item whose file name is at `table/key` in `bundle`.
pub(crate) fn open_named_item(
    bundle: &UResourceBundle,
    table: &[u8],
    key: &[u8],
    is_acceptable: fn(&UDataInfo) -> bool,
) -> Result<&'static [u8], UErrorCode> {
    let table = bundle.get_by_key_with_fallback(table)?;
    let file = ures_get_string_by_key_with_fallback(&table, key)?;
    let file: SmallChars = invariant_chars(file.iter())?;
    let (name, type_) = split_once(&file, b'.');
    udata::open_choice(
        Some(U_ICUDATA_BRKITR),
        type_.unwrap_or_default(),
        name,
        is_acceptable,
    )
    .map(|item| item.memory)
}

fn load_dictionary(script_name: &[u8]) -> Result<DictionaryMatcher, UErrorCode> {
    let root = ures_open(Some(U_ICUDATA_BRKITR), b"")?;
    let item = open_named_item(&root, b"dictionaries", script_name, |_| true)?;
    DictionaryMatcher::new(item).ok_or(U_INVALID_FORMAT_ERROR)
}

// ICU4C: brkeng.cpp, ICULanguageBreakFactory::loadEngineFor
fn engine_for(script: UScriptCode) -> Option<&'static Engine> {
    static ENGINES: [OnceBox<Engine>; 5] = [const { OnceBox::new() }; _];
    let [thai, lao, burmese, khmer, chinese_japanese] = &ENGINES;
    let (slot, name, word_script) = match script {
        USCRIPT_THAI => (thai, b"Thai", Some(&THAI)),
        USCRIPT_LAO => (lao, b"Laoo", Some(&LAO)),
        USCRIPT_MYANMAR => (burmese, b"Mymr", Some(&BURMESE)),
        USCRIPT_KHMER => (khmer, b"Khmr", Some(&KHMER)),
        USCRIPT_HAN | USCRIPT_HIRAGANA | USCRIPT_KATAKANA => (chinese_japanese, b"Hani", None),
        _ => return None,
    };
    let load = || {
        let dictionary = load_dictionary(name)?;
        match word_script {
            Some(script) => Ok(Engine::Words(WordBreakEngine { script, dictionary })),
            None => CjkBreakEngine::new(dictionary).map(Engine::Cjk),
        }
    };
    slot.get_or_try_init(load).ok().soft_some()
}

/// Appends the boundaries inside the run that one engine handles at the start of `range`. Returns the end of the run.
pub(crate) fn find_breaks(
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
    let engine = engine_for(if is_common_script_kana(first) {
        USCRIPT_KATAKANA
    } else {
        script
    });
    Ok(match engine {
        Some(Engine::Words(engine)) => {
            let end = run_end(&|c| engine.script.handles(c));
            engine.divide_up(text, start as i32, end as i32, found_breaks);
            end
        }
        Some(Engine::Cjk(engine)) => {
            let end = run_end(&CjkBreakEngine::handles);
            engine.divide_up(text.slice(start..end), start as i32, found_breaks)?;
            end
        }
        None => run_end(&|c| uscript_get_script(c) == script),
    })
}
