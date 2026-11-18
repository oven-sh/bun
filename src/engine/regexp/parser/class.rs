//! Classes without the flag `v`.

use bun_engine_text::CodeUnit;

use super::escape::Context;
use super::quantifier::Atom;
use super::{Cursor, Parser, Sink};
use crate::Error;

const HYPHEN: u32 = b'-' as u32;

/// What is before the hyphen before the cursor.
#[derive(Clone, Copy)]
enum RangeStart {
    Character(u32),
    Class,
}

impl<C: CodeUnit> Cursor<'_, C> {
    #[inline(always)]
    fn eat_range_hyphen(&mut self) -> bool {
        let is_range = self.peek() == b'-' && self.peek_at(1) != b']';
        self.at += usize::from(is_range);
        is_range
    }
}

impl<S: Sink> Parser<'_, S> {
    /// After the left bracket.
    #[inline(always)]
    pub(super) fn class<C: CodeUnit>(&mut self, cursor: &mut Cursor<C>) -> Result<Atom, Error> {
        let negated = cursor.eat(b'^');
        let mut range_start = None;
        loop {
            let unit = cursor.next_unit().ok_or(Error::UnterminatedClass)?;
            let c = if unit == u32::from(b']') {
                return Ok(Atom::class(negated));
            } else if unit != u32::from(b'\\') {
                cursor.complete_character(unit)
            } else if let Some(c) = cursor.plain_escape() {
                c
            } else if let Some(escape) = cursor.class_escape()? {
                self.sink.class_member(escape)?;
                match range_start.take() {
                    None if cursor.eat_range_hyphen() => range_start = Some(RangeStart::Class),
                    None => {}
                    Some(start) => self.no_range(start, cursor.is_unicode)?,
                }
                continue;
            } else {
                cursor.other_escape(Context::Class)?
            };
            match range_start.take() {
                None if cursor.eat_range_hyphen() => range_start = Some(RangeStart::Character(c)),
                None => self.sink.class_character(c)?,
                Some(RangeStart::Character(first)) => self.class_range(first, c)?,
                Some(start) => {
                    self.no_range(start, cursor.is_unicode)?;
                    self.sink.class_character(c)?;
                }
            }
        }
    }

    /// CharacterRangeOrUnion of B.1.2 where an end is a class.
    #[cold]
    fn no_range(&mut self, start: RangeStart, is_unicode: bool) -> Result<(), Error> {
        if is_unicode {
            return Err(Error::InvalidRange);
        }
        if let RangeStart::Character(c) = start {
            self.sink.class_character(c)?;
        }
        self.sink.class_character(HYPHEN)
    }

    #[inline(always)]
    pub(super) fn class_range(&mut self, first: u32, last: u32) -> Result<(), Error> {
        match first <= last {
            true => self.sink.class_range(first, last),
            false => Err(Error::RangeOutOfOrder),
        }
    }
}
