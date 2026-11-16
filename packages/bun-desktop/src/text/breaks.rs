//! Where a line may break: Blink's rules between ASCII characters, and UAX #14 otherwise.

use icu_locale_core::langid;
use icu_segmenter::LineSegmenter;
use icu_segmenter::options::{LineBreakOptions, LineBreakStrictness};
use unicode_linebreak::{BreakClass, break_property};

use crate::abi;

fn is_breakable_space(character: char) -> bool {
    matches!(character, ' ' | '\t' | '\n')
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

/// `Breaks::allows` without `break-all`.
pub fn breaks_in_ascii(text: &[u8], offset: usize) -> bool {
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
    use BreakClass::*;
    let class = |character: char| match break_property(character as u32) {
        _ if character == '+' => Alphabetic,
        Ambiguous | HebrewLetter | Numeric | Unknown => Alphabetic,
        class => class,
    };
    let starts_word = matches!(class(next), Alphabetic | After | Hyphen);
    match class(last) {
        _ if next == '\u{AD}' || !is_loose && matches!(next, '\u{2010}' | '\u{2013}') => false,
        Alphabetic | ComplexContext | Symbol => {
            starts_word || matches!(class(next), OpenPunctuation | Prefix | ComplexContext)
        }
        After | ClosePunctuation | CloseParenthesis => {
            starts_word || matches!(class(next), Prefix | ComplexContext)
        }
        Exclamation | Postfix => starts_word || matches!(class(next), Prefix | Postfix),
        InfixSeparator => starts_word,
        Hyphen => break_property(next as u32) == Numeric,
        Prefix => class(next) == Postfix,
        _ => false,
    }
}

fn keeps_together(last: char, next: char) -> bool {
    let is_letter =
        |it: char| it.is_alphanumeric() && break_property(it as u32) != BreakClass::ComplexContext;
    is_letter(last) && is_letter(next)
}

#[derive(Default)]
pub struct Breaks {
    /// Ascending offsets in the last word that is not ASCII.
    unicode: Vec<usize>,
    next: usize,
    word_end: usize,
    rules: u8,
}

impl Breaks {
    fn segment_word_at(&mut self, text: &str, offset: usize, rules: u8) {
        let start = text[..offset]
            .rfind(is_breakable_space)
            .map_or(0, |space| space + 1);
        self.word_end = text[offset..]
            .find(is_breakable_space)
            .map_or(text.len(), |space| offset + space);
        let mut options = LineBreakOptions::default();
        options.strictness = Some(match rules & !abi::BREAK_CJ {
            abi::BREAK_LOOSE => LineBreakStrictness::Loose,
            abi::BREAK_STRICT => LineBreakStrictness::Strict,
            _ => LineBreakStrictness::Normal,
        });
        let japanese = langid!("ja");
        options.content_locale = (rules & abi::BREAK_CJ != 0).then_some(&japanese);
        self.rules = rules;
        let with_space = &text[start..text.len().min(self.word_end + 1)];
        self.unicode.clear();
        self.unicode.extend(
            LineSegmenter::new_lstm(options)
                .segment_str(with_space)
                .map(|it| start + it),
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
        if offset >= self.word_end || rules != self.rules {
            self.segment_word_at(text, offset, rules);
        }
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
