#![allow(dead_code)] // until every rule of the plugin is written
//! refa's `js/char-env`, `js/char-case-folding` and `js/flags`. The data of `js/unicode` and
//! `js/utf16-case-folding` is JavaScriptCore's: nothing else of the plugin asks for it.

use crate::regexp_char_set::{Char, CharRange, CharSet, MAX_UNICODE, MAX_UTF16, Word};
use bun_lint::regex::ast as re;
use bun_lint::regex::unicode::{case_classes, property};
use bun_lint::utils::sort;
use std::sync::LazyLock;

/// upstream's `isFlags`
pub(crate) fn is_flags(flags: re::Flags) -> bool {
    !(flags.unicode && flags.unicode_sets)
}

const fn maximum_of(unicode: bool) -> Char {
    if unicode { MAX_UNICODE } else { MAX_UTF16 }
}

/// upstream's `UTF16CaseFolding` with `UTF16CaseVarying`, or `UnicodeCaseFolding` with
/// `UnicodeCaseVarying`.
struct CaseFolding {
    /// The sets of characters that the flag `i` makes equal. Each is ascending.
    classes: Vec<Vec<Char>>,
    /// Each character of `varying` with the index of its set, ascending.
    class_of: Vec<(Char, u32)>,
    varying: CharSet,
}

static UTF16_CASE_FOLDING: LazyLock<CaseFolding> = LazyLock::new(|| CaseFolding::new(false));
static UNICODE_CASE_FOLDING: LazyLock<CaseFolding> = LazyLock::new(|| CaseFolding::new(true));

impl CaseFolding {
    fn new(unicode: bool) -> CaseFolding {
        let classes = case_classes(unicode);
        let mut class_of: Vec<(Char, u32)> = Vec::new();
        for (class, index) in classes.iter().zip(0u32..) {
            class_of.extend(class.iter().map(|c| (*c, index)));
        }
        sort::sort_unstable(&mut class_of);
        let characters: Vec<Char> = class_of.iter().map(|it| it.0).collect();
        CaseFolding {
            classes,
            class_of,
            varying: CharSet::from_characters(maximum_of(unicode), &characters),
        }
    }

    fn of(unicode: bool) -> &'static CaseFolding {
        LazyLock::force(if unicode {
            &UNICODE_CASE_FOLDING
        } else {
            &UTF16_CASE_FOLDING
        })
    }

    /// upstream's `caseFolding[c]`
    fn get(&self, c: Char) -> Option<&[Char]> {
        let at = self.class_of.binary_search_by_key(&c, |it| it.0).ok()?;
        let (_, index) = self.class_of.get(at)?;
        self.classes.get(*index as usize).map(Vec::as_slice)
    }

    /// upstream's `withCaseVaryingCharacters(cs, caseFolding, caseVarying)`
    fn with_case_varying_characters(&self, cs: &CharSet) -> CharSet {
        if cs.is_superset_of(&self.varying) {
            return cs.clone();
        }
        let actual_case_varying = cs.intersect(&self.varying);
        if actual_case_varying.is_empty() {
            return cs.clone();
        }
        let mut case_variation: Vec<Char> = Vec::new();
        for c in actual_case_varying.characters() {
            case_variation.extend_from_slice(self.get(c).unwrap_or_default());
        }
        // `from_characters` takes a character that comes twice once.
        sort::sort_unstable(&mut case_variation);
        cs.union(&CharSet::from_characters(cs.maximum(), &case_variation))
    }
}

/// upstream's `UTF16CaseFolding[c]` / `UnicodeCaseFolding[c]`: all that are equal to `c`, `c` among
/// them, ascending. `None`: only `c` is.
pub(crate) fn case_folding(unicode: bool, c: Char) -> Option<&'static [Char]> {
    CaseFolding::of(unicode).get(c)
}

/// upstream's `UTF16CaseVarying` / `UnicodeCaseVarying`: the characters that have a `case_folding`.
pub(crate) fn case_varying(unicode: bool) -> &'static CharSet {
    &CaseFolding::of(unicode).varying
}

/// One of upstream's four objects: `==` is its `===`.
#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) struct CharCaseFolding {
    unicode: bool,
    ignore_case: bool,
}

impl CharCaseFolding {
    /// Whether upstream's object has a `canonicalize`. Without one it is the identity here.
    pub(crate) fn has_canonicalize(self) -> bool {
        self.ignore_case
    }

    fn folding(self, c: Char) -> Option<&'static [Char]> {
        if self.ignore_case {
            case_folding(self.unicode, c)
        } else {
            None
        }
    }

    pub(crate) fn canonicalize(self, c: Char) -> Char {
        self.folding(c)
            .and_then(|folding| folding.first().copied())
            .unwrap_or(c)
    }

    pub(crate) fn to_char_set(self, c: Char) -> CharSet {
        let maximum = maximum_of(self.unicode);
        match self.folding(c) {
            None => CharSet::from_character(maximum, c),
            Some(folding) => CharSet::from_characters(maximum, folding),
        }
    }
}

/// upstream's `getCharCaseFolding(unicode, ignoreCase)`
pub(crate) fn get_char_case_folding(unicode: bool, ignore_case: bool) -> CharCaseFolding {
    CharCaseFolding {
        unicode,
        ignore_case,
    }
}

/// upstream's `getCharCaseFolding(flags)`
pub(crate) fn get_char_case_folding_of(flags: re::Flags) -> CharCaseFolding {
    get_char_case_folding(flags.unicode || flags.unicode_sets, flags.ignore_case)
}

pub(crate) struct CharEnv {
    pub(crate) max_character: Char,
    pub(crate) all: CharSet,
    pub(crate) empty: CharSet,
    pub(crate) line_terminator: CharSet,
    pub(crate) non_line_terminator: CharSet,
    pub(crate) space: CharSet,
    pub(crate) non_space: CharSet,
    pub(crate) digit: CharSet,
    pub(crate) non_digit: CharSet,
    pub(crate) word: CharSet,
    pub(crate) non_word: CharSet,
    pub(crate) ignore_case: bool,
    pub(crate) unicode: bool,
}

const fn range(min: Char, max: Char) -> CharRange {
    CharRange { min, max }
}

const DIGIT: [CharRange; 1] = [range(0x30, 0x39)];
const SPACE: [CharRange; 10] = [
    range(0x09, 0x0D),
    range(0x20, 0x20),
    range(0xA0, 0xA0),
    range(0x1680, 0x1680),
    range(0x2000, 0x200A),
    range(0x2028, 0x2029),
    range(0x202F, 0x202F),
    range(0x205F, 0x205F),
    range(0x3000, 0x3000),
    range(0xFEFF, 0xFEFF),
];
const WORD: [CharRange; 4] = [
    range(0x30, 0x39),
    range(0x41, 0x5A),
    range(0x5F, 0x5F),
    range(0x61, 0x7A),
];
const LINE_TERMINATOR: [CharRange; 3] =
    [range(0x0A, 0x0A), range(0x0D, 0x0D), range(0x2028, 0x2029)];

static CHAR_ENV: LazyLock<CharEnv> = LazyLock::new(|| {
    CharEnv::new(CharCaseFolding {
        unicode: false,
        ignore_case: false,
    })
});
static CHAR_ENV_I: LazyLock<CharEnv> = LazyLock::new(|| {
    CharEnv::new(CharCaseFolding {
        unicode: false,
        ignore_case: true,
    })
});
static CHAR_ENV_U: LazyLock<CharEnv> = LazyLock::new(|| {
    CharEnv::new(CharCaseFolding {
        unicode: true,
        ignore_case: false,
    })
});
static CHAR_ENV_IU: LazyLock<CharEnv> = LazyLock::new(|| {
    CharEnv::new(CharCaseFolding {
        unicode: true,
        ignore_case: true,
    })
});

impl CharEnv {
    fn new(of: CharCaseFolding) -> CharEnv {
        let CharCaseFolding {
            unicode,
            ignore_case,
        } = of;
        let max_character = maximum_of(unicode);
        let empty = CharSet::empty(max_character);
        let line_terminator = empty.union_ranges(&LINE_TERMINATOR);
        let space = empty.union_ranges(&SPACE);
        let digit = empty.union_ranges(&DIGIT);
        let mut word = empty.union_ranges(&WORD);
        // Only with `u` or `v` does `i` add to `\w`: U+017F and U+212A.
        if unicode && ignore_case {
            word = CaseFolding::of(unicode).with_case_varying_characters(&word);
        }
        CharEnv {
            max_character,
            all: CharSet::all(max_character),
            empty,
            non_line_terminator: line_terminator.negate(),
            line_terminator,
            non_space: space.negate(),
            space,
            non_digit: digit.negate(),
            digit,
            non_word: word.negate(),
            word,
            ignore_case,
            unicode,
        }
    }

    /// upstream's `caseFolding[c]`, which it has only with `ignore_case`. Here it is not looked at.
    pub(crate) fn case_folding(&self, c: Char) -> Option<&'static [Char]> {
        case_folding(self.unicode, c)
    }

    /// As `case_folding`.
    pub(crate) fn case_varying(&self) -> &'static CharSet {
        case_varying(self.unicode)
    }

    /// As `case_folding`.
    pub(crate) fn with_case_varying_characters(&self, cs: &CharSet) -> CharSet {
        CaseFolding::of(self.unicode).with_case_varying_characters(cs)
    }

    /// upstream has it only with `unicode`.
    pub(crate) fn char_case_folding(&self) -> CharCaseFolding {
        get_char_case_folding(self.unicode, self.ignore_case)
    }
}

/// upstream's `getCharEnv`
pub(crate) fn get_char_env(flags: re::Flags) -> &'static CharEnv {
    LazyLock::force(if flags.unicode || flags.unicode_sets {
        if flags.ignore_case {
            &CHAR_ENV_IU
        } else {
            &CHAR_ENV_U
        }
    } else if flags.ignore_case {
        &CHAR_ENV_I
    } else {
        &CHAR_ENV
    })
}

/// upstream's `getPropertyData`, which is without `i`: the characters, and the strings that are not
/// one character. Both are empty for a property that JavaScriptCore does not have.
pub(crate) fn get_property_data(key: &[u8], value: Option<&[u8]>) -> (CharSet, Vec<Word>) {
    let empty = CharSet::empty(MAX_UNICODE);
    let Some(data) = property(key, value) else {
        return (empty, Vec::new());
    };
    let mut ranges: Vec<CharRange> = data.ranges.iter().map(|it| range(it.0, it.1)).collect();
    let mut words: Vec<Word> = Vec::new();
    for string in data.strings {
        if let [c] = string.as_slice() {
            ranges.push(range(*c, *c));
        } else {
            words.push(string);
        }
    }
    (empty.union_ranges(&ranges), words)
}
