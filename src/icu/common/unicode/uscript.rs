//! `unicode/uscript.h`

pub(crate) type UScriptCode = i32;
pub(crate) const USCRIPT_COMMON: UScriptCode = 0;
pub(crate) const USCRIPT_INHERITED: UScriptCode = 1;
pub(crate) const USCRIPT_HAN: UScriptCode = 17;
pub(crate) const USCRIPT_HANGUL: UScriptCode = 18;
pub(crate) const USCRIPT_HEBREW: UScriptCode = 19;
pub(crate) const USCRIPT_HIRAGANA: UScriptCode = 20;
pub(crate) const USCRIPT_KATAKANA: UScriptCode = 22;
pub(crate) const USCRIPT_KHMER: UScriptCode = 23;
pub(crate) const USCRIPT_LAO: UScriptCode = 24;
pub(crate) const USCRIPT_LATIN: UScriptCode = 25;
pub(crate) const USCRIPT_MYANMAR: UScriptCode = 28;
pub(crate) const USCRIPT_THAI: UScriptCode = 38;
pub(crate) const USCRIPT_UNKNOWN: UScriptCode = 103;
