//! What reads a token, by its first character.

use super::Lexer;
use crate::chars::{self, Start};
use crate::token::{Detail, TokenKind};

type T = TokenKind;
type Scanner = fn(&mut Lexer<'_>, usize, Detail, u8);

/// Each is small enough to need no registers saved.
pub(super) static SCANNERS: [Scanner; 256] = {
    let mut scanners: [Scanner; 256] = [punctuator; 256];
    let mut byte = 0;
    while byte < 256 {
        scanners[byte] = match chars::classify(byte as u8) {
            Start::Name => |lexer, start, lead, _| lexer.name(start, lead),
            Start::Punctuator => punctuator,
            Start::Blank => |lexer, start, lead, byte| lexer.blank(start, lead, byte),
            Start::Newline => |lexer, start, lead, _| lexer.newline(start, lead),
            Start::Digit => |lexer, start, lead, byte| lexer.number(start, lead, byte),
            Start::Quote => |lexer, start, lead, byte| lexer.string(start, lead, byte),
            Start::Dot => dot,
            Start::Slash => slash,
            Start::Operator => match byte as u8 {
                b'=' => equals,
                b'!' => exclamation,
                b'?' => question,
                b'<' => less,
                b'>' => greater,
                b'+' => plus,
                b'-' => minus,
                b'*' => star,
                b'%' => percent,
                b'&' => ampersand,
                b'|' => bar,
                _ => caret,
            },
            Start::Other => |lexer, start, lead, _| lexer.unusual_name(start, lead),
        };
        byte += 1;
    }
    scanners
};

impl Lexer<'_> {
    /// One more character if that is `=`.
    #[inline(always)]
    fn set_operator(&mut self, [plain, longer]: [T; 2], start: usize, length: usize, lead: Detail) {
        if self.byte(start + length) == b'=' {
            self.set(longer, start, start + length + 1, lead);
        } else {
            self.set(plain, start, start + length, lead);
        }
    }
}

fn punctuator(lexer: &mut Lexer<'_>, start: usize, lead: Detail, byte: u8) {
    lexer.set(chars::punctuator(byte), start, start + 1, lead);
}

fn dot(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'0'..=b'9' => lexer.elaborate_number(start, lead),
        b'.' if lexer.byte(start + 2) == b'.' => lexer.set(T::Ellipsis, start, start + 3, lead),
        _ => lexer.set(T::Dot, start, start + 1, lead),
    }
}

fn slash(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'/' | b'*' => lexer.scan_past_trivia(start, lead),
        _ => lexer.set_operator([T::Slash, T::DivideAssign], start, 1, lead),
    }
}

fn equals(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'=' => lexer.set_operator([T::Equal, T::StrictEqual], start, 2, lead),
        b'>' => lexer.set(T::Arrow, start, start + 2, lead),
        _ => lexer.set(T::Assign, start, start + 1, lead),
    }
}

fn exclamation(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'=' => lexer.set_operator([T::NotEqual, T::StrictNotEqual], start, 2, lead),
        _ => lexer.set(T::Not, start, start + 1, lead),
    }
}

fn question(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'?' => lexer.set_operator([T::Coalesce, T::CoalesceAssign], start, 2, lead),
        b'.' if !lexer.byte(start + 2).is_ascii_digit() => {
            lexer.set(T::QuestionDot, start, start + 2, lead);
        }
        _ => lexer.set(T::Question, start, start + 1, lead),
    }
}

fn less(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'<' => lexer.set_operator([T::ShiftLeft, T::ShiftLeftAssign], start, 2, lead),
        b'!' if lexer.opens_html_comment(start) => lexer.scan_past_trivia(start, lead),
        _ => lexer.set_operator([T::Less, T::LessEqual], start, 1, lead),
    }
}

fn greater(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match (lexer.byte(start + 1), lexer.byte(start + 2)) {
        (b'>', b'>') => {
            let kinds = [T::ShiftRightUnsigned, T::ShiftRightUnsignedAssign];
            lexer.set_operator(kinds, start, 3, lead);
        }
        (b'>', _) => lexer.set_operator([T::ShiftRight, T::ShiftRightAssign], start, 2, lead),
        _ => lexer.set_operator([T::Greater, T::GreaterEqual], start, 1, lead),
    }
}

fn plus(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'+' => lexer.set(T::Increment, start, start + 2, lead),
        _ => lexer.set_operator([T::Plus, T::AddAssign], start, 1, lead),
    }
}

fn minus(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'-' if lexer.closes_html_comment(start, lead) => {
            lexer.scan_past_trivia(start, lead);
        }
        b'-' => lexer.set(T::Decrement, start, start + 2, lead),
        _ => lexer.set_operator([T::Minus, T::SubtractAssign], start, 1, lead),
    }
}

fn star(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'*' => lexer.set_operator([T::Exponentiate, T::ExponentiateAssign], start, 2, lead),
        _ => lexer.set_operator([T::Star, T::MultiplyAssign], start, 1, lead),
    }
}

fn percent(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    lexer.set_operator([T::Percent, T::RemainderAssign], start, 1, lead);
}

fn ampersand(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'&' => lexer.set_operator([T::And, T::AndAssign], start, 2, lead),
        _ => lexer.set_operator([T::BitAnd, T::BitAndAssign], start, 1, lead),
    }
}

fn bar(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    match lexer.byte(start + 1) {
        b'|' => lexer.set_operator([T::Or, T::OrAssign], start, 2, lead),
        _ => lexer.set_operator([T::BitOr, T::BitOrAssign], start, 1, lead),
    }
}

fn caret(lexer: &mut Lexer<'_>, start: usize, lead: Detail, _: u8) {
    lexer.set_operator([T::BitXor, T::BitXorAssign], start, 1, lead);
}
