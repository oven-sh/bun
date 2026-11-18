//! Where a line may break: Blink's rules between ASCII characters, and UAX #14 otherwise.

use std::cell::Cell;

use crate::abi;
use crate::bun::abi as host;
use crate::unicode::{find_breaks, line_break};

fn is_breakable_space(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\n')
}

pub fn is_ideograph(character: char) -> bool {
    matches!(character, '\u{4E00}'..='\u{9FFF}' | '\u{AC00}'..='\u{D7A3}')
}

/// Those that lines break around like around ideographs, whatever the rules.
pub fn is_large_kana(character: char) -> bool {
    matches!(character, '\u{304A}'..='\u{3062}' | '\u{3064}'..='\u{3082}' | '\u{3088}'..='\u{308D}' | '\u{308F}'..='\u{3094}'
        | '\u{30AA}'..='\u{30C2}' | '\u{30C4}'..='\u{30E2}' | '\u{30E8}'..='\u{30ED}' | '\u{30EF}'..='\u{30F4}')
}

pub fn is_isolate(character: char) -> bool {
    matches!(character, '\u{2066}'..='\u{2069}')
}

/// The common ones of those that words are made of.
pub fn is_letter(character: char) -> bool {
    matches!(character, 'a'..='z' | 'A'..='Z' | '\u{C0}'..='\u{D6}' | '\u{D8}'..='\u{F6}' | '\u{F8}'..='\u{24F}' | '\u{38E}'..='\u{3A1}' | '\u{3A3}'..='\u{481}'
        | '\u{5D0}'..='\u{5EA}' | '\u{620}'..='\u{64A}' | '\u{671}'..='\u{6D3}' | '\u{1E00}'..='\u{1EFF}')
}

/// The common ones of those that go with the character before them, and do not hold on to the next one.
pub fn is_mark(character: char) -> bool {
    matches!(character, '\u{300}'..='\u{34E}' | '\u{350}'..='\u{35B}' | '\u{363}'..='\u{36F}')
}

/// `LineBreakData::FillAscii` and `ShouldBreakFast` in Blink.
fn breaks_between_ascii(before_last: Option<char>, last: u8, next: u8) -> bool {
    if last == b'-' && next.is_ascii_digit() {
        return before_last.is_some_and(|character| character.is_ascii_alphanumeric());
    }
    if last.is_ascii_alphanumeric()
        || b"$'(/<@[^_`{\x7F".contains(&last)
        || b"!),./:;?]}".contains(&next)
    {
        return false;
    }
    match last {
        b'-' => next != b'$',
        b'?' => !matches!(next, b'"' | b'\''),
        _ => b"(<[{".contains(&next),
    }
}

/// Those of a cluster. There is no break next to what is not ASCII.
pub fn flags_in_ascii(text: &[u8], offset: usize) -> u8 {
    let breaks =
        text[offset.saturating_sub(1)..=offset].is_ascii() && breaks_in_ascii(text, offset);
    (u8::from(breaks) * abi::CLUSTER_BREAK_BEFORE)
        | (u8::from(matches!(text[offset], b' ' | b'\t')) * abi::CLUSTER_SPACE)
}

/// `Breaks::allows` without `break-all`.
fn breaks_in_ascii(text: &[u8], offset: usize) -> bool {
    let (Some(&last), next) = (text[..offset].last(), text[offset]) else {
        return false;
    };
    match (last, next) {
        _ if last.is_ascii_alphanumeric() => false,
        (_, b' ' | b'\t' | b'\n') => last == b'\n',
        (b' ' | b'\t' | b'\n', _) => true,
        _ => {
            let before_last = offset.checked_sub(2).map(|index| text[index].into());
            last > b' ' && next > b' ' && breaks_between_ascii(before_last, last, next)
        }
    }
}

/// What `kBreakAllLineBreakClassTable` in Blink allows.
fn breaks_anywhere(last: char, next: char, is_loose: bool) -> bool {
    use line_break::*;
    let class = |character: char, class: i32| match class {
        _ if character == '+' => ALPHABETIC,
        AMBIGUOUS | HEBREW_LETTER | NUMERIC | UNKNOWN => ALPHABETIC,
        UNAMBIGUOUS_HYPHEN => BREAK_AFTER,
        class => class,
    };
    let of_next = of(next);
    let next_class = class(next, of_next);
    let starts_word = matches!(next_class, ALPHABETIC | BREAK_AFTER | HYPHEN);
    match class(last, of(last)) {
        _ if next == '\u{AD}' || !is_loose && matches!(next, '\u{2010}' | '\u{2013}') => false,
        ALPHABETIC | COMPLEX_CONTEXT | BREAK_SYMBOLS => {
            starts_word
                || matches!(
                    next_class,
                    OPEN_PUNCTUATION | PREFIX_NUMERIC | COMPLEX_CONTEXT
                )
        }
        BREAK_AFTER | CLOSE_PUNCTUATION | CLOSE_PARENTHESIS => {
            starts_word || matches!(next_class, PREFIX_NUMERIC | COMPLEX_CONTEXT)
        }
        EXCLAMATION | POSTFIX_NUMERIC => {
            starts_word || matches!(next_class, PREFIX_NUMERIC | POSTFIX_NUMERIC)
        }
        INFIX_NUMERIC => starts_word,
        HYPHEN => of_next == NUMERIC,
        PREFIX_NUMERIC => next_class == POSTFIX_NUMERIC,
        _ => false,
    }
}

fn keeps_together(last: char, next: char) -> bool {
    let is_letter =
        |it: char| it.is_alphanumeric() && line_break::of(it) != line_break::COMPLEX_CONTEXT;
    is_letter(last) && is_letter(next)
}

/// Whether no rule of UAX #14 looks further than at the two.
fn is_decided_by(last: char, next: char) -> bool {
    use line_break::*;
    let is_word = |class| {
        matches!(
            class,
            ALPHABETIC
                | AMBIGUOUS
                | UNKNOWN
                | HEBREW_LETTER
                | NUMERIC
                | IDEOGRAPHIC
                | H2
                | H3
                | SMALL_KANA
                | EMOJI_BASE
                | EMOJI_MODIFIER
        )
    };
    let is_plain = |class| {
        is_word(class)
            || matches!(
                class,
                OPEN_PUNCTUATION
                    | CLOSE_PUNCTUATION
                    | CLOSE_PARENTHESIS
                    | EXCLAMATION
                    | NONSTARTER
                    | INFIX_NUMERIC
            )
            || matches!(
                class,
                BREAK_BOTH | INSEPARABLE | GLUE | WORD_JOINER | CONTINGENT_BREAK
            )
    };
    let (before, after) = (of(last), of(next));
    let follows = match after {
        PREFIX_NUMERIC | POSTFIX_NUMERIC => is_word(before),
        COMBINING_MARK | BREAK_AFTER | HYPHEN | UNAMBIGUOUS_HYPHEN | BREAK_SYMBOLS => true,
        class => is_plain(class),
    };
    is_plain(before) && follows && ![last, next].contains(&'\u{25CC}')
}

fn kind_of(rules: u8) -> u8 {
    let kind = match rules & !abi::BREAK_CJ {
        abi::BREAK_LOOSE => host::BREAK_LINES_LOOSE,
        abi::BREAK_STRICT => host::BREAK_LINES_STRICT,
        _ => host::BREAK_LINES,
    };
    if rules & abi::BREAK_CJ != 0 {
        kind + host::BREAK_CJ
    } else {
        kind
    }
}

/// `None` if it takes more to tell.
fn breaks_between(last: char, next: char, rules: u8) -> Option<bool> {
    const SLOTS: usize = 1024;
    thread_local! {
        static KNOWN: [Cell<u64>; SLOTS] = const { [const { Cell::new(0) }; SLOTS] };
    }
    let like = |it: char| match it {
        '\u{5D0}'..='\u{5EA}' => '\u{5D0}',
        '0'..='9' => '0',
        '\u{AC00}'..='\u{D7A3}' => '\u{AC00}',
        _ if is_letter(it) => 'a',
        _ if is_ideograph(it) || is_large_kana(it) => '\u{4E00}',
        _ => it,
    };
    let (last, next) = (like(last), like(next));
    let key = u64::from(last) << 29 | u64::from(next) << 8 | u64::from(rules);
    let answer = KNOWN.with(|known| {
        let slot = &known[(key.wrapping_mul(0x9e37_79b9_7f4a_7c15) >> 54) as usize % SLOTS];
        if slot.get() >> 2 != key {
            let mut offsets = Vec::new();
            let is_decided = is_decided_by(last, next);
            if is_decided {
                find_breaks(
                    kind_of(rules),
                    &String::from_iter([last, next]),
                    &mut offsets,
                );
            }
            slot.set(key << 2 | u64::from(is_decided) << 1 | u64::from(offsets.len() > 1));
        }
        slot.get() & 3
    });
    (answer > 1).then_some(answer == 3)
}

#[derive(Default)]
pub struct Breaks {
    /// Ascending offsets in the last word that is not ASCII.
    unicode: Vec<u32>,
    word_start: usize,
    next: usize,
    word_end: usize,
    rules: u8,
}

impl Breaks {
    fn segment_word_at(&mut self, text: &str, offset: usize, rules: u8) {
        let is_limit = |it: &(usize, char)| is_breakable_space(it.1) || is_ideograph(it.1);
        self.word_start = text[..offset]
            .char_indices()
            .rfind(is_limit)
            .map_or(0, |(at, it)| at + usize::from(it.is_ascii()));
        let (end, last) = text[offset..]
            .char_indices()
            .find(is_limit)
            .map_or((text.len(), 0), |(at, it)| (offset + at, it.len_utf8()));
        self.word_end = end + usize::from(last > 1);
        self.rules = rules;
        find_breaks(
            kind_of(rules),
            &text[self.word_start..end + last],
            &mut self.unicode,
        );
        self.next = 0;
    }

    /// `offset` ascends from call to call.
    pub fn allows(&mut self, text: &str, offset: usize, word_break: u8) -> bool {
        let (word_break, rules) = (
            word_break & 3,
            word_break & (abi::BREAK_LOOSE | abi::BREAK_STRICT | abi::BREAK_CJ),
        );
        let mut before = text[..offset].chars().rev();
        let (Some(last), Some(next)) = (before.next(), text[offset..].chars().next()) else {
            return false;
        };
        if is_breakable_space(next) {
            return last == '\n';
        }
        if is_breakable_space(last) {
            return true;
        }
        if word_break == abi::BREAK_ALL
            && breaks_anywhere(last, next, rules & abi::BREAK_LOOSE != 0)
        {
            return true;
        }
        if word_break == abi::BREAK_KEEP_ALL && keeps_together(last, next) {
            return false;
        }
        if last.is_ascii() && next.is_ascii() {
            return last > ' '
                && next > ' '
                && breaks_between_ascii(before.next(), last as u8, next as u8);
        }
        let goes_along =
            |it: char| is_mark(it) || is_isolate(it) || matches!(it, '\u{FE0E}' | '\u{FE0F}');
        let base = goes_along(last)
            .then(|| before.chain([' ']).take(8).find(|it| !goes_along(*it)))
            .flatten();
        let base = base.map(|it| if is_breakable_space(it) { 'a' } else { it });
        if let Some(breaks) = breaks_between(base.unwrap_or(last), next, rules)
            .filter(|_| ![last, next].contains(&'\u{FFFC}'))
        {
            return breaks;
        }
        let last = base
            .filter(|it| is_mark(last) && (is_letter(*it) || is_ideograph(*it)))
            .unwrap_or(last);
        let is_word = |it: char| it == '\u{FFFC}' || it.is_ascii_digit() || is_letter(it);
        if is_ideograph(last) && is_ideograph(next)
            || [last, next].contains(&'\u{FFFC}') && is_word(last) && is_word(next)
        {
            return true;
        }
        let is_quote = |it: char| {
            matches!(it, '\u{2018}' | '\u{2019}')
                || matches!(it, '\u{201C}' | '\u{201D}') && rules & abi::BREAK_CJ == 0
        };
        let is_narrow = |it: char| it.is_ascii_graphic() || is_letter(it);
        if is_letter(last) && (is_letter(next) || matches!(next, '\u{A0}' | '\u{2026}'))
            || (is_quote(last) || last == '\u{A0}') && is_narrow(next)
            || is_narrow(last) && is_quote(next)
        {
            return false;
        }
        if offset >= self.word_end || rules != self.rules {
            self.segment_word_at(text, offset, rules);
        }
        let offset = (offset - self.word_start) as u32;
        while self
            .unicode
            .get(self.next)
            .is_some_and(|known| *known < offset)
        {
            self.next += 1;
        }
        self.unicode.get(self.next) == Some(&offset)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pairs_are_decided_like_whole_texts() {
        crate::system_icu::install();
        let all = "aZ5é(){}[].,;:!?-/$%+\"'#Яאع日한각あぁカッーゝ々、。，（）「」〜゠・：！？…‥—–‐‑“”‘’«»\u{a0}\u{202f}\u{2060}\u{200b}\u{200d}\u{ad}\u{301}\u{2066}\u{2069}\u{fe0f}→✓─│•·°€£¥‰℃×◌😀👍🏽🇯ก\u{fffc}";
        let (all, mut expected) = (all.chars().collect::<Vec<_>>(), Vec::new());
        for rules in [
            0,
            abi::BREAK_LOOSE,
            abi::BREAK_STRICT,
            abi::BREAK_CJ,
            abi::BREAK_CJ | abi::BREAK_LOOSE,
            abi::BREAK_CJ | abi::BREAK_STRICT,
        ] {
            for (&last, &next) in all.iter().flat_map(|a| all.iter().map(move |b| (a, b))) {
                let Some(breaks) = breaks_between(last, next, rules) else {
                    continue;
                };
                for (around, mark) in all
                    .iter()
                    .zip(all.iter().cycle().skip(7))
                    .flat_map(|it| [(it, ""), (it, "\u{2069}")])
                {
                    let before = format!("{}{last}{mark}", around.0);
                    find_breaks(
                        kind_of(rules),
                        &format!("{before}{next}{}", around.1),
                        &mut expected,
                    );
                    // What follows a joiner is part of a longer cluster.
                    assert!(
                        expected.contains(&(before.len() as u32)) == breaks
                            || next == '🏽' && !mark.is_empty(),
                        "{before:?} {next:?} {:?} {rules}",
                        around.1
                    );
                }
            }
        }
    }
}
