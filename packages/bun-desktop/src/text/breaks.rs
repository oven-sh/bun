//! Where a line may break: Blink's rules between ASCII characters, and UAX #14 otherwise.

use crate::abi;
use crate::bun::abi as host;
use crate::unicode::{find_breaks, line_break};

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
        self.word_start = text[..offset]
            .rfind(is_breakable_space)
            .map_or(0, |space| space + 1);
        self.word_end = text[offset..]
            .find(is_breakable_space)
            .map_or(text.len(), |space| offset + space);
        let kind = match rules & !abi::BREAK_CJ {
            abi::BREAK_LOOSE => host::BREAK_LINES_LOOSE,
            abi::BREAK_STRICT => host::BREAK_LINES_STRICT,
            _ => host::BREAK_LINES,
        };
        let kind = if rules & abi::BREAK_CJ != 0 {
            kind + host::BREAK_CJ
        } else {
            kind
        };
        self.rules = rules;
        find_breaks(
            kind,
            &text[self.word_start..text.len().min(self.word_end + 1)],
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
