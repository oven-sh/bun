//! The prefixes and suffixes of number patterns, whose quotes are balanced. ICU4C: number_affixutils.cpp

use crate::common::utf16::{CodePoints, code_points};
use crate::i18n::dcfmtsym::Symbol;
use crate::i18n::unicode::unum::*;

const QUOTE: u32 = 0x27;
const CURRENCY: u32 = 0xa4;

pub(crate) enum AffixToken {
    CodePoint(u32),
    Symbol(Symbol, UNumberFormatFields),
    /// A run of so many currency signs.
    Currency(usize),
}

pub(crate) struct AffixTokens<'a> {
    rest: CodePoints<'a>,
    is_quoted: bool,
}

impl Iterator for AffixTokens<'_> {
    type Item = AffixToken;

    #[inline]
    fn next(&mut self) -> Option<AffixToken> {
        let mut c = self.rest.next()?;
        if c == QUOTE {
            c = self.rest.next()?;
            self.is_quoted ^= c != QUOTE;
        }
        let (symbol, field) = match char::from_u32(c).filter(|_| !self.is_quoted) {
            Some('-') => (Symbol::MinusSign, UNUM_SIGN_FIELD),
            Some('+') => (Symbol::PlusSign, UNUM_SIGN_FIELD),
            Some('~') => (Symbol::ApproximatelySign, UNUM_APPROXIMATELY_SIGN_FIELD),
            Some('%') => (Symbol::PercentSign, UNUM_PERCENT_FIELD),
            Some('‰') => (Symbol::PerMilleSign, UNUM_PERMILL_FIELD),
            Some('¤') => {
                let mut count = 1;
                while self.rest.clone().next() == Some(CURRENCY) {
                    self.rest.next();
                    count += 1;
                }
                return Some(AffixToken::Currency(count));
            }
            _ => return Some(AffixToken::CodePoint(c)),
        };
        Some(AffixToken::Symbol(symbol, field))
    }
}

pub(crate) fn tokens(affix_pattern: &[u16]) -> AffixTokens<'_> {
    AffixTokens {
        rest: code_points(affix_pattern),
        is_quoted: false,
    }
}

/// Returns what the affix adds to the width of a padded pattern. Opening quotes count after the first quoted part.
pub(crate) fn estimate_length(affix_pattern: &[u16]) -> usize {
    enum State {
        Base,
        FirstQuote,
        InsideQuote,
        AfterQuote,
    }
    use State::*;
    let (mut state, mut length) = (Base, 0);
    for c in code_points(affix_pattern) {
        state = match (state, c == QUOTE) {
            (Base, true) => FirstQuote,
            (FirstQuote, true) => Base,
            (InsideQuote, true) => AfterQuote,
            (FirstQuote, false) | (AfterQuote, true) => InsideQuote,
            (state, false) => state,
        };
        length += usize::from(c != QUOTE || matches!(state, Base | InsideQuote));
    }
    length
}

/// Looks for "¤¤¤".
pub(crate) fn has_currency_plural_name(affix_pattern: &[u16]) -> bool {
    tokens(affix_pattern).any(|token| matches!(token, AffixToken::Currency(3)))
}
