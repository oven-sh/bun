//! Parses plural styles such as "one{# day}other{# days}" into a flat list of parts. ICU4C: messagepattern.cpp

use crate::common::memory::{Appendable, fail_on_oom, try_push, try_to_vec};
use crate::common::patternprops;
use crate::common::slice_ext::SliceExt;
use crate::common::unistr::{UStr, strip_prefix_str};
use crate::common::utf16::from_latin1;
use crate::common::utypes::*;

#[derive(Clone, Copy, PartialEq)]
enum StyleType {
    Choice,
    /// Also "selectordinal"
    Plural,
    Select,
}

/// `nested` is the number of following parts that the part contains.
#[derive(Clone, Copy, Default)]
enum PartType {
    MsgStart {
        nested: u32,
    },
    #[default]
    MsgLimit,
    SkipSyntax,
    InsertChar,
    ReplaceNumber,
    /// Spans the whole argument, including the braces.
    Arg {
        nested: u32,
    },
    ArgSelector,
    Number(f64),
}

/// The range `index..limit` of the pattern, which has fewer than 2^31 units.
#[derive(Clone, Copy, Default)]
struct Part {
    part_type: PartType,
    index: u32,
    limit: u32,
}

impl Part {
    fn substring(self, text: &[u16]) -> &[u16] {
        text.slice(self.index as usize..self.limit as usize)
    }

    fn number(self) -> Option<f64> {
        match self.part_type {
            PartType::Number(number) => Some(number),
            _ => None,
        }
    }
}

fn split_nested(parts: &[Part], nested: u32) -> (&[Part], &[Part]) {
    (
        parts.slice(..nested as usize),
        parts.slice(nested as usize..),
    )
}

/// The syntax element that follows a run of literal text.
pub(crate) enum Piece<'a> {
    /// A quoting apostrophe, or the second apostrophe of a pair.
    SkipSyntax,
    ReplaceNumber,
    /// The text of an argument, including the braces.
    Arg(&'a [u16]),
    InsertCharOrLimit,
}

/// Yields each run of literal text with the element that follows it.
#[derive(Default)]
pub(crate) struct Message<'a> {
    text: &'a [u16],
    index: u32,
    parts: &'a [Part],
}

impl<'a> Iterator for Message<'a> {
    type Item = (&'a [u16], Piece<'a>);

    fn next(&mut self) -> Option<Self::Item> {
        let (part, rest) = self.parts.split_first()?;
        let literal = self.text.slice(self.index as usize..part.index as usize);
        (self.index, self.parts) = (part.limit, rest);
        let piece = match part.part_type {
            PartType::SkipSyntax => Piece::SkipSyntax,
            PartType::ReplaceNumber => Piece::ReplaceNumber,
            PartType::Arg { nested } => {
                self.parts = rest.slice(nested as usize..);
                Piece::Arg(part.substring(self.text))
            }
            _ => Piece::InsertCharOrLimit,
        };
        Some((literal, piece))
    }
}

pub(crate) struct Case<'a> {
    /// A keyword or "=2".
    pub(crate) selector: &'a [u16],
    /// The number of "=2".
    pub(crate) value: Option<f64>,
    pub(crate) message: Message<'a>,
}

/// One of the cases is "other".
pub(crate) struct Cases<'a> {
    text: &'a [u16],
    parts: &'a [Part],
}

impl Cases<'_> {
    /// Removes and returns the value of "offset:", or returns 0. Call before iterating.
    pub(crate) fn take_offset(&mut self) -> f64 {
        let offset = self.parts.at(0).number();
        self.parts = self.parts.slice(usize::from(offset.is_some())..);
        offset.unwrap_or(0.0)
    }
}

impl<'a> Iterator for Cases<'a> {
    type Item = Case<'a>;

    fn next(&mut self) -> Option<Case<'a>> {
        let (mut selector, mut value) = (<&[u16]>::default(), None);
        loop {
            let (part, rest) = self.parts.split_first()?;
            self.parts = rest;
            match part.part_type {
                PartType::ArgSelector => selector = part.substring(self.text),
                PartType::MsgStart { nested } => {
                    let parts;
                    (parts, self.parts) = split_nested(rest, nested);
                    let message = Message {
                        text: self.text,
                        index: part.limit,
                        parts,
                    };
                    return Some(Case {
                        selector,
                        value,
                        message,
                    });
                }
                _ => value = part.number(),
            }
        }
    }
}

pub(crate) struct MessagePattern {
    text: Vec<u16>,
    parts: Vec<Part>,
}

impl MessagePattern {
    pub(crate) fn from_plural_style(pattern: &[u16]) -> Result<Self, UErrorCode> {
        let mut parser = Parser {
            text: pattern,
            parts: Vec::new(),
            double_count: 0,
        };
        fail_on_oom(|| parser.parse())?;
        Ok(Self {
            text: try_to_vec(pattern)?,
            parts: parser.parts,
        })
    }

    pub(crate) fn cases(&self) -> Cases<'_> {
        Cases {
            text: &self.text,
            parts: &self.parts,
        }
    }
}

pub(crate) const OTHER: &[u16] = &from_latin1(b"other");

const MAX_LENGTH: usize = 0xffff;
const MAX_VALUE: i32 = 0x7fff;
const MAX_NESTED_LEVELS: usize = 0x03ff;

const fn c(c: char) -> u16 {
    c as u16
}

const APOS: u16 = c('\'');
const LEFT_CURLY_BRACE: u16 = c('{');
const RIGHT_CURLY_BRACE: u16 = c('}');
const PIPE: u16 = c('|');
const POUND: u16 = c('#');
const COMMA: u16 = c(',');
const ZERO: u16 = c('0');
const INFINITY: u16 = 0x221e;

fn is_digit(unit: u16) -> bool {
    (ZERO..=c('9')).contains(&unit)
}

fn check(is_valid: bool) -> Result<(), UErrorCode> {
    is_valid.then_some(()).ok_or(U_PATTERN_SYNTAX_ERROR)
}

/// A choice, plural or select style that is being parsed.
struct Style {
    style_type: StyleType,
    /// Index of the `Arg` part, or `None` if the style is the whole pattern.
    arg: Option<usize>,
    /// Index of the `MsgStart` part of the current message.
    msg_start: usize,
    is_empty: bool,
    has_other: bool,
}

impl Style {
    fn new(style_type: StyleType, arg: Option<usize>) -> Self {
        Self {
            style_type,
            arg,
            msg_start: 0,
            is_empty: true,
            has_other: false,
        }
    }
}

/// The element at which the parser of a style has stopped.
enum StyleStep {
    /// A message, with the start of its text.
    Message(usize),
    /// The closing brace of the argument, or the end of the pattern.
    End(usize),
}

struct Parser<'a> {
    text: &'a [u16],
    parts: Vec<Part>,
    /// The number of values that are not integers of 16 bits, which is limited.
    double_count: i32,
}

impl Parser<'_> {
    /// The unfinished styles are in a `Vec`, so that nesting takes no stack.
    fn parse(&mut self) -> Result<(), UErrorCode> {
        let (mut styles, mut index) = (Vec::new(), 0);
        try_push(&mut styles, Style::new(StyleType::Plural, None))?;
        loop {
            let nesting_level = styles.len();
            let style = styles.last_mut().ok_or(U_INTERNAL_PROGRAM_ERROR)?;
            let next = match style.style_type {
                StyleType::Choice => self.parse_choice(style, index)?,
                _ => self.parse_plural_or_select(style, index)?,
            };
            match next {
                StyleStep::Message(start) => {
                    check(nesting_level <= MAX_NESTED_LEVELS)?;
                    (style.msg_start, style.is_empty) = (self.parts.len(), false);
                    self.add_part(PartType::MsgStart { nested: 0 }, start, start);
                    index = start;
                }
                StyleStep::End(end) => {
                    let Some(arg) = style.arg else { return Ok(()) };
                    index = end + 1;
                    self.finish_arg(arg, index);
                    styles.pop();
                }
            }
            index = self.parse_message(index, &mut styles)?;
        }
    }

    /// Continues the message of the innermost style until it ends or a style begins.
    fn parse_message(
        &mut self,
        mut index: usize,
        styles: &mut Vec<Style>,
    ) -> Result<usize, UErrorCode> {
        let parent = styles.last().ok_or(U_INTERNAL_PROGRAM_ERROR)?;
        let msg_start = parent.msg_start;
        let in_choice = parent.style_type == StyleType::Choice;
        let in_plural = parent.style_type == StyleType::Plural;
        while let Some(&unit) = self.text.get(index) {
            index += 1;
            if unit == APOS {
                let next = self.text.char_at(index);
                if next == APOS {
                    self.add_part(PartType::SkipSyntax, index, index + 1);
                    index += 1;
                } else if matches!(next, LEFT_CURLY_BRACE | RIGHT_CURLY_BRACE)
                    || (in_choice && next == PIPE)
                    || (in_plural && next == POUND)
                {
                    index = self.parse_quotation(index);
                } else {
                    self.add_part(PartType::InsertChar, index, index);
                }
            } else if in_plural && unit == POUND {
                self.add_part(PartType::ReplaceNumber, index - 1, index);
            } else if unit == LEFT_CURLY_BRACE {
                let style;
                (index, style) = self.parse_arg(index - 1)?;
                if let Some(style) = style {
                    try_push(styles, style)?;
                    return Ok(index);
                }
            } else if unit == RIGHT_CURLY_BRACE || (in_choice && unit == PIPE) {
                self.add_part(PartType::MsgLimit, index - 1, index);
                let count = self.parts.len();
                if let Some(part) = self.parts.soft_get_mut(msg_start) {
                    part.part_type = PartType::MsgStart {
                        nested: (count - msg_start - 1) as u32,
                    };
                }
                // `parse_choice` reads the terminator again.
                return Ok(index - usize::from(in_choice));
            }
        }
        Err(U_PATTERN_SYNTAX_ERROR)
    }

    /// Parses quoted text. `index` follows the opening apostrophe. The closing apostrophe may be missing.
    fn parse_quotation(&mut self, mut index: usize) -> usize {
        self.add_part(PartType::SkipSyntax, index - 1, index);
        while let Some(found) = self.text.index_of_unit(APOS, index + 1) {
            index = found + 1;
            if self.text.char_at(index) != APOS {
                self.add_part(PartType::SkipSyntax, found, index);
                return index;
            }
            self.add_part(PartType::SkipSyntax, index, index + 1);
        }
        self.text.len()
    }

    /// Parses the argument whose '{' is at `index`. Stops at the start of a choice, plural or select style.
    fn parse_arg(&mut self, index: usize) -> Result<(usize, Option<Style>), UErrorCode> {
        let arg = self.parts.len();
        self.add_part(PartType::Arg { nested: 0 }, index, index);
        let name_index = self.skip_white_space(index + 1);
        let mut index = self.skip_identifier(name_index);
        check(is_name_or_number(self.text.slice(name_index..index)))?;
        index = self.skip_white_space(index);
        if self.text.char_at(index) == COMMA {
            let type_index = self.skip_white_space(index + 1);
            let is_letter = |&unit: &u16| (c('a')..=c('z')).contains(&(unit | 0x20));
            let (name, _) = self.text.slice(type_index..).split_while(is_letter);
            check((1..=MAX_LENGTH).contains(&name.len()))?;
            index = self.skip_white_space(type_index + name.len());
            let has_style = self.text.char_at(index) == COMMA;
            if let Some(style_type) = style_type_of(name) {
                check(has_style)?;
                return Ok((index + 1, Some(Style::new(style_type, Some(arg)))));
            }
            if has_style {
                index = self.skip_simple_style(index + 1)?;
            }
        }
        check(self.text.char_at(index) == RIGHT_CURLY_BRACE)?;
        self.finish_arg(arg, index + 1);
        Ok((index + 1, None))
    }

    fn finish_arg(&mut self, arg: usize, limit: usize) {
        if let [part, nested @ ..] = self.parts.slice_mut(arg..) {
            let nested = nested.len() as u32;
            (part.part_type, part.limit) = (PartType::Arg { nested }, limit as u32);
        }
    }

    fn skip_simple_style(&self, start: usize) -> Result<usize, UErrorCode> {
        let (mut index, mut nested_braces) = (start, 0usize);
        while let Some(&unit) = self.text.get(index) {
            match unit {
                APOS => {
                    let closing = self.text.index_of_unit(APOS, index + 1);
                    index = closing.ok_or(U_PATTERN_SYNTAX_ERROR)?;
                }
                LEFT_CURLY_BRACE => nested_braces += 1,
                RIGHT_CURLY_BRACE if nested_braces > 0 => nested_braces -= 1,
                RIGHT_CURLY_BRACE => return check(index - start <= MAX_LENGTH).map(|()| index),
                _ => {}
            }
            index += 1;
        }
        Err(U_PATTERN_SYNTAX_ERROR)
    }

    /// Parses up to the next message. `index` is the start of the style, or the '|' or '}' after a message.
    fn parse_choice(&mut self, style: &Style, index: usize) -> Result<StyleStep, UErrorCode> {
        if !style.is_empty && self.text.char_at(index) == RIGHT_CURLY_BRACE {
            return Ok(StyleStep::End(index));
        }
        let number_index = self.skip_white_space(index + usize::from(!style.is_empty));
        let index = self.skip_double(number_index);
        check(index - number_index <= MAX_LENGTH)?;
        self.parse_double(number_index, index, true)?;
        let index = self.skip_white_space(index);
        check([POUND, c('<'), c('\u{2264}')].contains(&self.text.char_at(index)))?;
        Ok(StyleStep::Message(index + 1))
    }

    /// Parses up to the next message. `index` is the start of the style, or follows the '}' of a message.
    fn parse_plural_or_select(
        &mut self,
        style: &mut Style,
        mut index: usize,
    ) -> Result<StyleStep, UErrorCode> {
        let is_plural = style.style_type == StyleType::Plural;
        loop {
            let selector_index = self.skip_white_space(index);
            let rest = self.text.slice(selector_index..);
            if let [] | [RIGHT_CURLY_BRACE, ..] = rest {
                check(rest.is_empty() == style.arg.is_none() && style.has_other)?;
                return Ok(StyleStep::End(selector_index));
            }
            if is_plural && strip_prefix_str(rest, "offset:").is_some() {
                let value_index = self.skip_white_space(selector_index + 7);
                index = self.skip_double(value_index);
                check(style.is_empty && index - value_index <= MAX_LENGTH)?;
                self.parse_double(value_index, index, false)?;
                style.is_empty = false;
                continue;
            }
            let is_explicit = is_plural && rest.at(0) == c('=');
            let start = selector_index + usize::from(is_explicit);
            index = if is_explicit {
                self.skip_double(start)
            } else {
                self.skip_identifier(start)
            };
            check(index != start && index - selector_index <= MAX_LENGTH)?;
            self.add_part(PartType::ArgSelector, selector_index, index);
            if is_explicit {
                self.parse_double(start, index, false)?;
            }
            style.has_other |= self.text.slice(selector_index..index) == OTHER;
            index = self.skip_white_space(index);
            check(self.text.char_at(index) == LEFT_CURLY_BRACE)?;
            return Ok(StyleStep::Message(index + 1));
        }
    }

    fn parse_double(
        &mut self,
        start: usize,
        limit: usize,
        allow_infinity: bool,
    ) -> Result<(), UErrorCode> {
        let text = self.text.slice(start..limit);
        let (is_negative, digits) = match text {
            [0x2d, digits @ ..] => (true, digits),
            [0x2b, digits @ ..] | digits => (false, digits),
        };
        let small = digits.iter().try_fold(0, |value, &unit| {
            let value = value * 10 + i32::from(is_digit(unit).then(|| unit - ZERO)?);
            (value <= MAX_VALUE + i32::from(is_negative)).then_some(value)
        });
        let value = if let Some(value) = small.filter(|_| !digits.is_empty()) {
            f64::from(if is_negative { -value } else { value })
        } else {
            check(self.double_count <= MAX_VALUE)?;
            self.double_count += 1;
            // Only a choice can have it, whose values nothing reads.
            if allow_infinity && digits == [INFINITY] {
                return Ok(());
            }
            strtod(text).ok_or(U_PATTERN_SYNTAX_ERROR)?
        };
        self.add_part(PartType::Number(value), start, limit);
        Ok(())
    }

    fn skip_white_space(&self, index: usize) -> usize {
        patternprops::skip_white_space(self.text, index)
    }

    fn skip_identifier(&self, index: usize) -> usize {
        index + patternprops::skip_identifier(self.text.slice(index..))
    }

    fn skip_double(&self, index: usize) -> usize {
        let is_part = |&&unit: &&u16| {
            is_digit(unit) || [c('+'), c('-'), c('.'), c('e'), c('E'), INFINITY].contains(&unit)
        };
        index + self.text.slice(index..).iter().take_while(is_part).count()
    }

    fn add_part(&mut self, part_type: PartType, start: usize, limit: usize) {
        self.parts.add(Part {
            part_type,
            index: start as u32,
            limit: limit as u32,
        });
    }
}

fn is_name_or_number(name: &[u16]) -> bool {
    if !name.iter().all(|&unit| is_digit(unit)) {
        return name.len() <= MAX_LENGTH;
    }
    let number = name.iter().try_fold(0, |number, &unit| {
        Some(number * 10 + i32::from(unit - ZERO)).filter(|&number| number <= MAX_VALUE)
    });
    number.is_some() && !matches!(name, [] | [ZERO, _, ..])
}

/// Ignores the case of `name`, which has only ASCII letters. Returns `None` for a simple argument.
fn style_type_of(name: &[u16]) -> Option<StyleType> {
    const TYPES: [(&[u8], StyleType); 4] = [
        (b"choice", StyleType::Choice),
        (b"plural", StyleType::Plural),
        (b"select", StyleType::Select),
        (b"selectordinal", StyleType::Plural),
    ];
    let is_name = |letters: &[u8]| {
        (name.iter().map(|unit| unit | 0x20)).eq(letters.iter().map(|&letter| u16::from(letter)))
    };
    let found = TYPES.iter().find(|(letters, _)| is_name(letters));
    found.map(|&(_, style_type)| style_type)
}

/// Parses all of `text`, which consists of units that `skip_double` skips.
fn strtod(text: &[u16]) -> Option<f64> {
    let mut bytes = [0; 127];
    let bytes = bytes.get_mut(..text.len())?;
    // U+221E is truncated to a control character, which is rejected.
    bytes
        .iter_mut()
        .zip(text)
        .for_each(|(byte, &unit)| *byte = unit as u8);
    str::from_utf8(bytes)
        .ok()
        .and_then(|text| text.parse().ok())
}

/// Appends `text`, replacing each pair of apostrophes by one and dropping single apostrophes.
pub(crate) fn append_reduced_apostrophes(text: &[u16], to: &mut Vec<u16>) {
    let mut skipped_previous = false;
    for &unit in text {
        if unit != APOS || skipped_previous {
            to.add(unit);
        }
        skipped_previous = unit == APOS && !skipped_previous;
    }
}
