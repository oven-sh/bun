//! The grammar of patterns: ECMA-262, 22.2.1 and B.1.2.

mod class;
mod class_set;
mod cursor;
mod escape;
mod group;
mod names;
mod quantifier;
mod reference;
mod scan;
mod sink;

use bun_engine_text::{CodeUnit, Text, with_text};
use smallvec::SmallVec;

use crate::tree::Group;
use crate::{Error, Flags};
use cursor::Cursor;
use escape::Context;
use group::Level;
use names::Names;
use quantifier::Atom;
use scan::GroupTotals;
pub(crate) use sink::{
    Assertion, ClassEscape, Discard, GroupKind, NameId, Quantifier, SetOperator, Sink,
};

/// What the syntax of a pattern tells.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct Summary {
    pub group_count: u16,
    pub has_named_groups: bool,
    pub(crate) is_too_deep: bool,
    pub(crate) has_large_counts: bool,
}

impl Summary {
    /// Whether to build the pattern at once, for the error that this can end in.
    pub fn is_near_limits(self) -> bool {
        self.is_too_deep || self.has_large_counts
    }
}

/// False only if [`Summary::is_near_limits`] is.
pub fn may_be_near_limits(pattern: Text<'_>) -> bool {
    pattern.len() > MAX_DEPTH || pattern.contains_unit(b'{'.into())
}

/// The early errors of a literal.
pub fn check_syntax(pattern: Text<'_>, flags: Text<'_>) -> Result<(), Error> {
    let flags = Flags::parse(flags).ok_or(Error::InvalidFlags)?;
    summarize(pattern, flags).map(drop)
}

pub fn summarize(pattern: Text<'_>, flags: Flags) -> Result<Summary, Error> {
    parse(pattern, flags, &mut Discard)
}

pub(crate) fn parse<'a>(
    pattern: Text<'a>,
    flags: Flags,
    sink: &'a mut impl Sink,
) -> Result<Summary, Error> {
    let parser = Parser::new(sink);
    with_text!(pattern, |units| parser.pattern(Cursor::new(units, flags)))
}

const MAX_DEPTH: usize = 50_000;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Token {
    Literal,
    Bar,
    OpenGroup,
    CloseGroup,
    Start,
    End,
    Dot,
    OpenClass,
    CloseBracket,
    Backslash,
    Quantifier,
}

static TOKENS: [Token; 256] = {
    let mut tokens = [Token::Literal; 256];
    tokens[b']' as usize] = Token::CloseBracket;
    tokens[b'}' as usize] = Token::CloseBracket;
    tokens[b'*' as usize] = Token::Quantifier;
    tokens[b'+' as usize] = Token::Quantifier;
    tokens[b'?' as usize] = Token::Quantifier;
    tokens[b'{' as usize] = Token::Quantifier;
    tokens[b'|' as usize] = Token::Bar;
    tokens[b'(' as usize] = Token::OpenGroup;
    tokens[b')' as usize] = Token::CloseGroup;
    tokens[b'^' as usize] = Token::Start;
    tokens[b'$' as usize] = Token::End;
    tokens[b'.' as usize] = Token::Dot;
    tokens[b'[' as usize] = Token::OpenClass;
    tokens[b'\\' as usize] = Token::Backslash;
    tokens
};

#[inline(always)]
fn token<C: CodeUnit>(unit: C) -> Token {
    let known = TOKENS.get(usize::from(unit.to_u16()));
    known.copied().unwrap_or(Token::Literal)
}

struct Parser<'a, S: Sink> {
    sink: &'a mut S,
    level: Level,
    outer_levels: SmallVec<[(Level, S::Outer); 16]>,
    open_lookbehinds: usize,
    is_too_deep: bool,
    group_count: Group,
    totals: Option<GroupTotals>,
    names: Option<Names<'a>>,
    has_named_groups: bool,
    highest_reference: u32,
    sum_of_counts: u64,
}

impl<'a, S: Sink> Parser<'a, S> {
    #[inline(always)]
    fn new(sink: &'a mut S) -> Self {
        Parser {
            sink,
            level: Level::PATTERN,
            outer_levels: SmallVec::new(),
            open_lookbehinds: 0,
            is_too_deep: false,
            group_count: 0,
            totals: None,
            names: None,
            has_named_groups: false,
            highest_reference: 0,
            sum_of_counts: 0,
        }
    }

    #[inline(always)]
    fn pattern<C: CodeUnit>(mut self, mut cursor: Cursor<'a, C>) -> Result<Summary, Error> {
        if scan::is_too_large(cursor.units, cursor.has_class_sets) {
            return Err(Error::PatternTooLarge);
        }
        self.terms(&mut cursor)?;
        if !self.outer_levels.is_empty() {
            return Err(Error::UnterminatedGroup);
        }
        if self.highest_reference > u32::from(self.group_count) {
            return Err(Error::InvalidBackReference);
        }
        if let Some(names) = self.names
            && (cursor.has_passed_escaped_k || !names.all_have_groups())
        {
            return Err(Error::InvalidNamedReference);
        }
        let most_units = self.sum_of_counts * 2 + cursor.units.len() as u64;
        Ok(Summary {
            group_count: self.group_count,
            has_named_groups: self.has_named_groups,
            is_too_deep: self.is_too_deep,
            has_large_counts: most_units > u64::from(u32::MAX),
        })
    }

    #[inline(always)]
    fn terms<C: CodeUnit>(&mut self, cursor: &mut Cursor<'a, C>) -> Result<(), Error> {
        while let Some(&first) = cursor.units.get(cursor.at) {
            cursor.at += 1;
            let atom = match token(first) {
                Token::Bar => {
                    self.next_alternative()?;
                    continue;
                }
                Token::OpenGroup => {
                    self.open_group(cursor)?;
                    continue;
                }
                Token::Start => {
                    self.sink.assertion(Assertion::Start)?;
                    continue;
                }
                Token::End => {
                    self.sink.assertion(Assertion::End)?;
                    continue;
                }
                Token::Backslash if cursor.peek() | 0x20 == b'b' => {
                    let negated = cursor.peek() == b'B';
                    cursor.at += 1;
                    self.sink.assertion(Assertion::WordBoundary { negated })?;
                    continue;
                }
                Token::Backslash => self.atom_escape(cursor)?,
                Token::CloseGroup if self.outer_levels.is_empty() => {
                    return Err(Error::UnmatchedParenthesis);
                }
                Token::CloseGroup => Atom::Group,
                Token::OpenClass if cursor.has_class_sets => {
                    cursor.apart(|it| self.class_set(it))?
                }
                Token::OpenClass => self.class(cursor)?,
                Token::Dot => {
                    self.sink.dot()?;
                    Atom::Complete
                }
                Token::CloseBracket if cursor.is_unicode => return Err(Error::LoneBracket),
                Token::Quantifier if !cursor.is_after_literal_brace() => {
                    return Err(cursor.apart(Cursor::misplaced_quantifier));
                }
                Token::Literal | Token::CloseBracket | Token::Quantifier => {
                    let start = cursor.at - 1;
                    while let Some(&unit) = cursor.units.get(cursor.at)
                        && token(unit) == Token::Literal
                    {
                        cursor.at += 1;
                    }
                    self.sink.text(cursor.units_since(start))?;
                    Atom::Complete
                }
            };
            self.quantify(cursor, atom)?;
        }
        Ok(())
    }

    /// After the backslash.
    #[inline(always)]
    fn atom_escape<C: CodeUnit>(&mut self, cursor: &mut Cursor<'a, C>) -> Result<Atom, Error> {
        if let Some(c) = cursor.plain_escape() {
            self.sink.character(c)?;
        } else if let Some(escape) = cursor.class_escape()? {
            if escape.has_strings() {
                self.sink.class_member(escape)?;
                return Ok(Atom::Class);
            }
            self.sink.class_escape(escape)?;
        } else {
            match cursor.peek() {
                b'1'..=b'9' if cursor.apart(|it| self.back_reference(it))? => {}
                b'k' if cursor.apart(|it| self.named_reference(it))? => {}
                _ => self.sink.character(cursor.other_escape(Context::Atom)?)?,
            }
        }
        Ok(Atom::Complete)
    }
}

#[inline(always)]
pub(crate) fn try_push<A: smallvec::Array>(
    stack: &mut SmallVec<A>,
    item: A::Item,
) -> Result<(), Error> {
    if stack.len() == stack.capacity() {
        stack.try_reserve(1).map_err(|_| Error::OutOfMemory)?;
    }
    stack.push(item);
    Ok(())
}
