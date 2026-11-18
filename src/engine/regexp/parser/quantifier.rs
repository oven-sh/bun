use bun_engine_text::{CodeUnit, MAX_LENGTH};

use super::{Cursor, Parser, Quantifier, Sink, Token, token};
use crate::Error;
use crate::tree::UNBOUNDED;

/// What a quantifier can follow.
#[derive(Clone, Copy)]
#[repr(u32)]
pub(super) enum Atom {
    Complete,
    /// The sink has yet to be told of its end, as for the following.
    Class,
    NegatedClass,
    Group,
}

impl Atom {
    #[inline(always)]
    pub(super) fn class(negated: bool) -> Atom {
        match negated {
            true => Atom::NegatedClass,
            false => Atom::Class,
        }
    }
}

impl<S: Sink> Parser<'_, S> {
    #[inline(always)]
    pub(super) fn quantify<C: CodeUnit>(
        &mut self,
        cursor: &mut Cursor<C>,
        atom: Atom,
    ) -> Result<(), Error> {
        let quantifier = cursor.quantifier()?;
        if let Some(quantifier) = quantifier {
            self.sum_of_counts += u64::from(quantifier.min);
        }
        match atom {
            Atom::Complete => quantifier.map_or(Ok(()), |it| self.sink.quantify(it)),
            Atom::Class | Atom::NegatedClass => self
                .sink
                .close_class(matches!(atom, Atom::NegatedClass), quantifier),
            Atom::Group => self.close_group(quantifier),
        }
    }
}

impl<C: CodeUnit> Cursor<'_, C> {
    #[inline(always)]
    fn quantifier(&mut self) -> Result<Option<Quantifier>, Error> {
        let first = self.peek();
        if token(first) != Token::Quantifier {
            return Ok(None);
        }
        self.at += 1;
        let (min, max) = match first {
            b'{' => match self.counts() {
                Some((min, max)) => limits(min, max)?,
                None if self.is_unicode => return Err(Error::IncompleteQuantifier),
                None => {
                    self.at -= 1;
                    return Ok(None);
                }
            },
            b'?' => (0, 1),
            _ => (u32::from(first == b'+'), UNBOUNDED),
        };
        let greedy = !self.eat(b'?') || min == max;
        Ok(Some(Quantifier { min, max, greedy }))
    }

    /// From after the left brace to after the right one, or nowhere.
    #[inline(always)]
    fn counts(&mut self) -> Option<(u64, u64)> {
        let mut ahead = *self;
        let min = ahead.decimal()?;
        let max = match ahead.eat(b',') {
            true => ahead.decimal().unwrap_or(u64::MAX),
            false => min,
        };
        ahead.eat(b'}').then(|| {
            self.at = ahead.at;
            (min, max)
        })
    }

    #[inline(always)]
    pub(super) fn is_after_literal_brace(&self) -> bool {
        self.units[self.at - 1].is(b'{')
            && !self.is_unicode
            && (!self.peek().is_ascii_digit() || !self.is_at_counts())
    }

    #[inline(never)]
    fn is_at_counts(mut self) -> bool {
        self.counts().is_some()
    }

    /// After its first unit.
    #[cold]
    pub(super) fn misplaced_quantifier(&mut self) -> Error {
        self.at -= 1;
        self.quantifier().err().unwrap_or(Error::NothingToRepeat)
    }
}

#[inline(always)]
fn limits(min: u64, max: u64) -> Result<(u32, u32), Error> {
    if min == u64::MAX {
        return Err(Error::QuantifierTooLarge);
    }
    if min > max {
        return Err(Error::QuantifierOutOfOrder);
    }
    // An iteration beyond the minimum consumes a character.
    let is_unbounded = max - min >= MAX_LENGTH as u64;
    let clamp = |count| u32::try_from(count).unwrap_or(UNBOUNDED);
    let max = if is_unbounded { UNBOUNDED } else { clamp(max) };
    Ok((clamp(min), max))
}
