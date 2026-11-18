//! Classes with the flag `v`.

use bun_engine_text::CodeUnit;
use smallvec::SmallVec;

use super::cursor::ascii;
use super::escape::Context;
use super::quantifier::Atom;
use super::{ClassEscape, Cursor, MAX_DEPTH, Parser, SetOperator, Sink, try_push};
use crate::Error;

#[derive(Clone, Copy)]
enum ClassAtom {
    Character(u32),
    Class(ClassEscape),
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Contents {
    Empty,
    OneOperand,
    Union,
    AfterOperator(SetOperator),
    Operation(SetOperator),
}

#[derive(Clone, Copy)]
struct Class {
    negated: bool,
    contents: Contents,
    may_contain_strings: bool,
}

impl Class {
    fn new(negated: bool) -> Class {
        Class {
            negated,
            contents: Contents::Empty,
            may_contain_strings: false,
        }
    }

    fn check_room_for_operand(self) -> Result<(), Error> {
        match self.contents {
            Contents::Operation(_) => Err(Error::InvalidSetOperation),
            _ => Ok(()),
        }
    }

    fn add_operand(&mut self, may_contain_strings: bool) {
        match self.contents {
            Contents::AfterOperator(SetOperator::Subtraction) => {}
            Contents::AfterOperator(SetOperator::Intersection) => {
                self.may_contain_strings &= may_contain_strings;
            }
            _ => self.may_contain_strings |= may_contain_strings,
        }
        self.contents = match self.contents {
            Contents::Empty => Contents::OneOperand,
            Contents::AfterOperator(operator) => Contents::Operation(operator),
            _ => Contents::Union,
        };
    }

    fn add_operator(&mut self, operator: SetOperator) -> Result<(), Error> {
        if self.contents != Contents::OneOperand && self.contents != Contents::Operation(operator) {
            return Err(Error::InvalidSetOperation);
        }
        self.contents = Contents::AfterOperator(operator);
        Ok(())
    }

    fn check_negation(self) -> Result<(), Error> {
        match self.negated && self.may_contain_strings {
            true => Err(Error::NegatedStrings),
            false => Ok(()),
        }
    }
}

impl<S: Sink> Parser<'_, S> {
    /// After the left bracket.
    #[inline(never)]
    pub(super) fn class_set<C: CodeUnit>(&mut self, cursor: &mut Cursor<C>) -> Result<Atom, Error> {
        let mut class = Class::new(cursor.eat(b'^'));
        let mut outer = SmallVec::<[Class; 8]>::new();
        loop {
            let unit = cursor.next_unit().ok_or(Error::UnterminatedClass)?;
            let atom = match ascii(unit) {
                b']' => {
                    class.check_negation()?;
                    if matches!(class.contents, Contents::AfterOperator(_)) {
                        return Err(Error::InvalidSetCharacter);
                    }
                    let Some(outer) = outer.pop() else {
                        return Ok(Atom::class(class.negated));
                    };
                    self.sink.close_nested_class(class.negated)?;
                    let nested = core::mem::replace(&mut class, outer);
                    class.add_operand(nested.may_contain_strings);
                    cursor.reject_range()?;
                    continue;
                }
                b'[' => {
                    class.check_room_for_operand()?;
                    self.sink.open_nested_class()?;
                    try_push(&mut outer, class)?;
                    self.is_too_deep |= outer.len() > MAX_DEPTH;
                    class = Class::new(cursor.eat(b'^'));
                    continue;
                }
                first @ (b'-' | b'&') if cursor.is_at_end() || cursor.peek() == first => {
                    let operator = cursor.set_operator(first)?;
                    class.add_operator(operator)?;
                    self.sink.set_operator(operator)?;
                    continue;
                }
                b'\\' if cursor.is_at_class_strings() => {
                    class.check_room_for_operand()?;
                    class.add_operand(self.class_strings(cursor)?);
                    cursor.reject_range()?;
                    continue;
                }
                b'\\' => {
                    class.check_room_for_operand()?;
                    cursor.class_set_escape()?
                }
                _ => {
                    let c = cursor.class_set_character(unit)?;
                    class.check_room_for_operand()?;
                    ClassAtom::Character(c)
                }
            };
            self.operand_or_range(cursor, &mut class, atom)?;
        }
    }

    /// After `first`.
    fn operand_or_range<C: CodeUnit>(
        &mut self,
        cursor: &mut Cursor<C>,
        class: &mut Class,
        first: ClassAtom,
    ) -> Result<(), Error> {
        class.add_operand(matches!(first, ClassAtom::Class(escape) if escape.has_strings()));
        if !cursor.is_at_single_hyphen() {
            return match first {
                ClassAtom::Character(c) => self.sink.class_character(c),
                ClassAtom::Class(escape) => self.sink.class_member(escape),
            };
        }
        if let Contents::Operation(_) = class.contents {
            return Err(match first {
                ClassAtom::Character(_) => Error::InvalidSetOperation,
                ClassAtom::Class(_) => Error::InvalidSetCharacter,
            });
        }
        cursor.at += 1;
        match (first, cursor.range_end(*class)?) {
            (ClassAtom::Character(first), ClassAtom::Character(last)) => {
                class.contents = Contents::Union;
                self.class_range(first, last)
            }
            _ => Err(Error::InvalidRange),
        }
    }

    /// At the `q`. Returns MayContainStrings.
    fn class_strings<C: CodeUnit>(&mut self, cursor: &mut Cursor<C>) -> Result<bool, Error> {
        cursor.at += 2;
        let (mut may_contain_strings, mut length) = (false, 0usize);
        loop {
            let unit = cursor.next_unit().ok_or(Error::UnterminatedClassStrings)?;
            let c = match ascii(unit) {
                end @ (b'|' | b'}') => {
                    self.sink.close_class_string()?;
                    may_contain_strings |= length != 1;
                    if end == b'}' {
                        return Ok(may_contain_strings);
                    }
                    length = 0;
                    continue;
                }
                b'\\' => cursor.class_set_character_escape()?,
                _ => cursor.class_set_character(unit)?,
            };
            self.sink.class_string_character(c)?;
            length += 1;
        }
    }
}

impl<C: CodeUnit> Cursor<'_, C> {
    /// After the first of its two characters.
    fn set_operator(&mut self, character: u8) -> Result<SetOperator, Error> {
        if !self.eat(character) {
            return Err(Error::UnterminatedClass);
        }
        if self.is_at_end() || self.peek() == character {
            return Err(Error::InvalidSetCharacter);
        }
        Ok(match character {
            b'-' => SetOperator::Subtraction,
            _ => SetOperator::Intersection,
        })
    }

    fn is_at_class_strings(&self) -> bool {
        self.peek() == b'q' && self.peek_at(1) == b'{'
    }

    fn is_at_single_hyphen(&self) -> bool {
        self.peek() == b'-' && self.peek_at(1) != b'-' && self.at + 1 < self.units.len()
    }

    /// After a nested class or class strings.
    fn reject_range(&self) -> Result<(), Error> {
        match self.is_at_single_hyphen() {
            true => Err(Error::InvalidSetOperation),
            false => Ok(()),
        }
    }

    fn class_set_escape(&mut self) -> Result<ClassAtom, Error> {
        match self.class_escape()? {
            Some(escape) => Ok(ClassAtom::Class(escape)),
            None => self.class_set_character_escape().map(ClassAtom::Character),
        }
    }

    #[inline(never)]
    fn class_set_character_escape(&mut self) -> Result<u32, Error> {
        self.character_escape(Context::ClassSet)
    }

    /// One that is not escaped. `unit` is before the cursor.
    fn class_set_character(&mut self, unit: u32) -> Result<u32, Error> {
        match ascii(unit) {
            b'(' | b')' | b'[' | b']' | b'{' | b'}' | b'/' | b'-' | b'|' => {
                Err(Error::InvalidSetCharacter)
            }
            first @ (b'&' | b'!' | b'#' | b'$' | b'%' | b'*' | b'+' | b',' | b'.' | b':' | b';'
            | b'<' | b'=' | b'>' | b'?' | b'@' | b'^' | b'`' | b'~')
                if self.peek() == first =>
            {
                Err(Error::InvalidSetOperation)
            }
            _ => Ok(self.complete_pair(unit)),
        }
    }

    /// After the hyphen.
    fn range_end(&mut self, mut class: Class) -> Result<ClassAtom, Error> {
        let unit = self.next_unit().ok_or(Error::UnterminatedClass)?;
        match ascii(unit) {
            b']' => class.check_negation()?,
            b'&' if self.is_at_end() || self.peek() == b'&' => {
                class.add_operator(self.set_operator(b'&')?)?;
            }
            b'\\' if self.is_at_class_strings() => {}
            b'\\' => return self.class_set_escape(),
            _ => return self.class_set_character(unit).map(ClassAtom::Character),
        }
        Err(Error::InvalidSetCharacter)
    }
}
