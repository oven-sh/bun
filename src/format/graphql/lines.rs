//! Definitions that are written the way they're printed, told from their lines, without tokens.
//!
//! A text that has been formatted before is lines of a few kinds: a name, `name: Type`, `}`. Whether such a line is
//! what's printed takes its indentation, the ends of its names and the bytes between them, all of which come from the
//! bitmaps. So this reads definitions from the start of the text on for as long as each is printed as it's written.
//! `direct.rs` goes on behind the last one.
//!
//! It never writes, and what it says about a definition is either "as it's written" or nothing. Whatever isn't in the
//! one spelling that's printed, and whatever it doesn't know, ends it.
//!
//! **It's a third place that has the grammar and the rules of the printer**, after `parser.rs` with `printer.rs` and
//! `direct.rs`. Whoever changes a rule there changes it here, or has this refuse.
//!
//! Where the width counts: the groups of an item are a list in brackets and all its directives. A group is on one line
//! if it fits there together with what follows it up to the next place where a line can break, which is behind the
//! opening bracket of the next list, or behind the blank in front of the directives. So
//!
//! - a line with a group on it has to fit,
//! - with a blank more if directives follow on lines of their own,
//! - and a group that's written on several lines has to be too wide for one, or have a line break forced on it.
//!
//! All that's measured is printable ASCII, so a width is a number of bytes.

use super::parser::is_directive_location;
use super::tokens::{end_of_block_string, end_of_number};
use crate::FormatOptions;
use bun_core::strings;
use bun_highway::ScannerStops;
use std::cell::Cell;

/// The items of a list in brackets.
#[derive(Copy, Clone)]
enum Item {
    /// `a: 1`
    NamedValue { is_const: bool },
    /// `1`
    Value { is_const: bool },
    /// `$a: A = 1 @b`
    Variable,
    /// `"a" b: C = 1 @d`
    InputValue,
}

#[derive(Copy, Clone)]
enum Block {
    Selections,
    Fields,
    InputFields,
    EnumValues,
    OperationTypes,
}

/// Something that may be on several lines.
struct OnLines {
    end: usize,
    /// How wide it is on one line.
    flat_width: usize,
    /// It's on several lines whatever the width.
    is_forced: bool,
}

/// No line is indented further than this: how many blanks there are is only known for fewer than 57. It bounds how deep
/// blocks and lists on lines are in each other too.
const MAX_INDENTATION: usize = 48;

/// Lists and objects in each other on one line.
const MAX_NESTING: u32 = 8;

pub(super) struct Lines<'t, 'o> {
    text: &'t [u8],
    stops: ScannerStops<'o>,
    options: &'o FormatOptions,
    width: usize,
    tab_width: usize,
    /// There's a group on the line that's being read.
    has_group: Cell<bool>,
}

impl<'t, 'o> Lines<'t, 'o> {
    /// `text` has no tab and no `\r`, `stops` are its stops, and `options` ask for indentation with blanks.
    pub(super) fn new(text: &'t [u8], stops: ScannerStops<'o>, options: &'o FormatOptions) -> Self {
        Lines {
            text,
            stops,
            options,
            width: options.line_width.value() as usize,
            tab_width: options.indent_width.value() as usize,
            has_group: Cell::new(false),
        }
    }

    /// Returns where the last definition ends up to which everything is printed as it's written: the length of the
    /// text if all of it is, 0 if nothing is.
    pub(super) fn end_of_definitions_as_printed(&self) -> usize {
        // Without indentation, a line doesn't tell what it's in.
        if self.tab_width == 0 {
            return 0;
        }
        let (mut at, mut end_of_last) = (0, 0);
        loop {
            let is_comment = self.at(at) == b'#';
            let end = match is_comment {
                true => self.comment(at),
                false => self.definition(at),
            };
            let Some(end) = end.filter(|end| self.at(*end) == b'\n') else {
                return end_of_last;
            };
            if !is_comment {
                if self.at(end - 1) != b'}' && !self.is_followed_by_definition(end) {
                    return end_of_last;
                }
                end_of_last = end;
            }
            at = end + 1;
            if at == self.text.len() {
                return if end_of_last > 0 { at } else { 0 };
            }
            // One empty line is kept.
            at += usize::from(self.at(at) == b'\n');
        }
    }

    /// True if what follows a definition without a block that seems to end at `end` is no part of it.
    fn is_followed_by_definition(&self, end: usize) -> bool {
        let mut rest = self.text.get(end..).unwrap_or_default();
        loop {
            let ignored = rest
                .iter()
                .take_while(|byte| matches!(byte, b'\n' | b' ' | b','));
            rest = rest.get(ignored.count()..).unwrap_or_default();
            match rest {
                [] | [b'"', ..] => return true,
                [b'a'..=b'z', ..] => return !rest.starts_with(b"implements"),
                [b'#', ..] => {
                    let len = strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
                    rest = &rest[len..];
                }
                _ => return false,
            }
        }
    }

    // ───────────────────────────── bytes ─────────────────────────────

    /// 0 behind the end.
    #[inline(always)]
    fn at(&self, at: usize) -> u8 {
        self.text.get(at).copied().unwrap_or(0)
    }

    #[inline(always)]
    fn starts_with(&self, at: usize, bytes: &[u8]) -> bool {
        self.text.get(at..).is_some_and(|it| it.starts_with(bytes))
    }

    /// How many blanks there are at `at`, or something above `MAX_INDENTATION`.
    #[inline(always)]
    fn blanks(&self, at: usize) -> usize {
        self.stops.after_blanks.run(at) as usize
    }

    /// Returns the end of the name at `at`.
    #[inline(always)]
    fn name(&self, at: usize) -> Option<usize> {
        // To `after_name` a `$` is part of a name. `in_string` stops at it, and at nothing else in a name.
        let not_name = self.stops.after_name.window(at) | self.stops.in_string.window(at);
        let len = not_name.trailing_zeros() as usize;
        (len > 0 && len < 57 && !self.at(at).is_ascii_digit()).then_some(at + len)
    }

    /// Returns the end of the name behind the blank at `at`.
    #[inline(always)]
    fn name_behind_blank(&self, at: usize) -> Option<usize> {
        match self.at(at) {
            b' ' => self.name(at + 1),
            _ => None,
        }
    }

    /// True if the line that starts at `line` and ends at `end` fits, or nobody asks.
    #[inline(always)]
    fn fits(&self, line: usize, end: usize) -> bool {
        !self.has_group.get() || end - line <= self.width
    }

    /// ` {` at the end of a line.
    #[inline(always)]
    fn is_at_block(&self, at: usize) -> bool {
        self.at(at) == b' ' && self.at(at + 1) == b'{' && self.at(at + 2) == b'\n'
    }

    /// Returns the end of the line with the comment whose `#` is at `at`.
    fn comment(&self, at: usize) -> Option<usize> {
        let rest = self.text.get(at + 1..)?;
        let content = rest.get(..strings::index_of_char_usize(rest, b'\n')?)?;
        let is_as_printed = !content.last().is_some_and(u8::is_ascii_whitespace)
            && !(self.options.flavor).is_ignore_comment(strings::trim_js_whitespace(content));
        is_as_printed.then_some(at + 1 + content.len())
    }

    // ───────────────────────────── on one line ─────────────────────────────

    /// `[A!]!`
    #[inline(always)]
    fn type_reference(&self, mut at: usize) -> Option<usize> {
        let mut lists = 0;
        while self.at(at) == b'[' {
            (at, lists) = (at + 1, lists + 1);
        }
        if lists > MAX_NESTING {
            return None;
        }
        at = self.name(at)?;
        loop {
            at += usize::from(self.at(at) == b'!');
            if lists == 0 {
                return Some(at);
            }
            if self.at(at) != b']' {
                return None;
            }
            (at, lists) = (at + 1, lists - 1);
        }
    }

    /// `: A`
    #[inline(always)]
    fn type_behind_colon(&self, at: usize) -> Option<usize> {
        match (self.at(at), self.at(at + 1)) {
            (b':', b' ') => self.type_reference(at + 2),
            _ => None,
        }
    }

    /// A string of printable ASCII without a backslash.
    fn string(&self, start: usize) -> Option<usize> {
        let mut at = start + 1;
        loop {
            at = self.stops.in_string.next(at);
            match self.at(at) {
                b'"' => break,
                b'\'' | b'`' | b'$' => at += 1,
                _ => return None,
            }
        }
        // `"""` starts a block string.
        (at > start + 1 || self.at(at + 1) != b'"').then_some(at + 1)
    }

    fn value(&self, at: usize, is_const: bool, nesting: u32) -> Option<usize> {
        match self.at(at) {
            b'$' if !is_const => self.name(at + 1),
            b'"' => self.string(at),
            b'-' | b'0'..=b'9' => end_of_number(self.text, at),
            open @ (b'[' | b'{') => {
                self.has_group.set(true);
                let close = open + 2;
                if self.at(at + 1) == close {
                    return Some(at + 2);
                }
                if nesting >= MAX_NESTING {
                    return None;
                }
                let has_blanks = open == b'{' && self.options.bracket_spacing.value();
                let mut at = at + 1;
                if has_blanks {
                    at = (self.at(at) == b' ').then_some(at + 1)?;
                }
                loop {
                    at = match open {
                        b'{' => self.value(self.name_and_colon(at)?, is_const, nesting + 1)?,
                        _ => self.value(at, is_const, nesting + 1)?,
                    };
                    match (self.at(at), self.at(at + 1)) {
                        (b',', b' ') => at += 2,
                        (b' ', byte) if has_blanks && byte == close => return Some(at + 2),
                        (byte, _) if !has_blanks && byte == close => return Some(at + 1),
                        _ => return None,
                    }
                }
            }
            _ => self.name(at),
        }
    }

    /// `a: `
    #[inline(always)]
    fn name_and_colon(&self, at: usize) -> Option<usize> {
        let colon = self.name(at)?;
        (self.at(colon) == b':' && self.at(colon + 1) == b' ').then_some(colon + 2)
    }

    /// The list whose `(` is at `at`.
    fn list(&self, at: usize, item: Item) -> Option<usize> {
        self.has_group.set(true);
        let mut at = at + 1;
        loop {
            at = match item {
                Item::NamedValue { is_const } => {
                    self.value(self.name_and_colon(at)?, is_const, 0)?
                }
                Item::Value { is_const } => self.value(at, is_const, 0)?,
                Item::Variable | Item::InputValue => {
                    match (item, self.at(at)) {
                        (Item::Variable, b'$') => at += 1,
                        (Item::Variable, _) => return None,
                        // In a group, a description that's no block string is on the line of what it describes.
                        (_, b'"') => {
                            at = (self.string(at)).filter(|end| self.at(*end) == b' ')? + 1
                        }
                        _ => {}
                    }
                    let mut end = self.type_behind_colon(self.name(at)?)?;
                    if self.starts_with(end, b" = ") {
                        end = self.value(end + 3, true, 0)?;
                    }
                    self.directives(end, true)?
                }
            };
            match (self.at(at), self.at(at + 1)) {
                (b')', _) => return Some(at + 1),
                (b',', b' ') => at += 2,
                _ => return None,
            }
        }
    }

    /// ` @a(b: 1) @c`, or nothing.
    #[inline(always)]
    fn directives(&self, mut at: usize, is_const: bool) -> Option<usize> {
        while self.at(at) == b' ' && self.at(at + 1) == b'@' {
            self.has_group.set(true);
            at = self.name(at + 2)?;
            if self.at(at) == b'(' {
                at = self.list(at, Item::NamedValue { is_const })?;
            }
        }
        Some(at)
    }

    // ───────────────────────────── on several lines ─────────────────────────────

    /// If a description starts at `at`, at `level`, returns where the line behind it starts, behind its indentation.
    /// Else `at`.
    #[inline(always)]
    fn description(&self, at: usize, level: usize) -> Option<usize> {
        match self.at(at) {
            b'"' => self.end_of_description(at, level),
            _ => Some(at),
        }
    }

    fn end_of_description(&self, at: usize, level: usize) -> Option<usize> {
        let indentation = level * self.tab_width;
        let end = match self.starts_with(at, b"\"\"\"") {
            true => {
                let (end, on_lines) = end_of_block_string(self.text, self.stops, at)?;
                (on_lines == Some(indentation)).then_some(end)?
            }
            false => self.string(at)?,
        };
        (self.at(end) == b'\n' && self.blanks(end + 1) == indentation)
            .then_some(end + 1 + indentation)
    }

    /// The list whose opening bracket is at `open`, at the end of a line at `level`.
    fn list_on_lines(&self, open: usize, level: usize, item: Item) -> Option<OnLines> {
        let (outer, indentation) = (level * self.tab_width, (level + 1) * self.tab_width);
        if indentation > MAX_INDENTATION {
            return None;
        }
        let (close, keeps_empty_lines) = match self.at(open) {
            b'(' => (b')', !matches!(item, Item::Variable)),
            bracket => (bracket + 2, false),
        };
        let has_blanks = close == b'}' && self.options.bracket_spacing.value();
        let (mut flat_width, mut is_forced) = (if has_blanks { 2 } else { 0 }, false);
        let mut line = open + 2;
        loop {
            if self.blanks(line) != indentation {
                return None;
            }
            let read = self.item_on_lines(line + indentation, level + 1, item)?;
            if self.at(read.end) != b'\n' {
                return None;
            }
            // The item, and `, ` or the brackets.
            flat_width += read.flat_width + 2;
            is_forced |= read.is_forced;
            line = read.end + 1;
            if self.blanks(line) == outer && self.at(line + outer) == close {
                return Some(OnLines {
                    end: line + outer + 1,
                    flat_width,
                    is_forced,
                });
            }
            if self.at(line) == b'\n' {
                if !keeps_empty_lines {
                    return None;
                }
                (line, is_forced) = (line + 1, true);
            }
        }
    }

    /// An item that starts its line, at `level`, and ends one.
    fn item_on_lines(&self, start: usize, level: usize, item: Item) -> Option<OnLines> {
        let indentation = level * self.tab_width;
        let (mut at, mut flat_width, mut is_forced) = (start, 0, false);
        if matches!(item, Item::InputValue) && self.at(at) == b'"' {
            is_forced = self.starts_with(at, b"\"\"\"");
            at = self.end_of_description(at, level)?;
            // The description and a blank.
            flat_width = at - indentation - start;
        }
        let mut line = at - indentation;
        // From here on, what's been read is as wide as it has bytes, and isn't counted yet.
        let mut counted_to = at;
        self.has_group.set(false);
        let (value, is_const, can_have_directives) = match item {
            Item::NamedValue { is_const } => (Some(self.name_and_colon(at)?), is_const, false),
            Item::Value { is_const } => (Some(at), is_const, false),
            Item::Variable | Item::InputValue => {
                if matches!(item, Item::Variable) {
                    at = (self.at(at) == b'$').then_some(at + 1)?;
                }
                at = self.type_behind_colon(self.name(at)?)?;
                (self.starts_with(at, b" = ").then_some(at + 3), true, true)
            }
        };
        if let Some(value) = value {
            let bracket = self.at(value);
            if matches!(bracket, b'[' | b'{') && self.at(value + 1) == b'\n' {
                let item = match bracket {
                    b'{' => Item::NamedValue { is_const },
                    _ => Item::Value { is_const },
                };
                let list = self.list_on_lines(value, level, item)?;
                let has_directives = can_have_directives
                    && (self.starts_with(list.end, b" @")
                        || self.is_followed_by_directives(list.end, level));
                let rest = usize::from(has_directives);
                if !list.is_forced && value - line + list.flat_width + rest <= self.width {
                    return None;
                }
                flat_width += value - counted_to + list.flat_width;
                is_forced |= list.is_forced;
                self.has_group.set(false);
                (at, counted_to, line) = (list.end, list.end, list.end - 1 - indentation);
            } else {
                at = self.value(value, is_const, 0)?;
            }
        }
        if can_have_directives {
            if self.is_followed_by_directives(at, level) {
                let directives = self.directives_on_lines(line, at, level, true)?;
                return Some(OnLines {
                    end: directives.end,
                    flat_width: flat_width + at - counted_to + directives.flat_width,
                    is_forced: is_forced || directives.is_forced,
                });
            }
            at = self.directives(at, true)?;
        }
        self.fits(line, at).then_some(OnLines {
            end: at,
            flat_width: flat_width + at - counted_to,
            is_forced,
        })
    }

    /// True if directives are on the lines behind the line at `level` that ends at `end`.
    #[inline(always)]
    fn is_followed_by_directives(&self, end: usize, level: usize) -> bool {
        let indentation = (level + 1) * self.tab_width;
        self.at(end) == b'\n'
            && self.blanks(end + 1) == indentation
            && self.at(end + 1 + indentation) == b'@'
    }

    /// The directives on the lines behind the line at `level` that starts at `line` and ends at `end`. No group is on
    /// the line that the last one ends on as far as the caller is concerned: whether ` {` fits there has been seen to.
    fn directives_on_lines(
        &self,
        line: usize,
        end: usize,
        level: usize,
        is_const: bool,
    ) -> Option<OnLines> {
        let indentation = (level + 1) * self.tab_width;
        // The blank in front of them has to fit for the groups on that line to stay there.
        if indentation > MAX_INDENTATION || !self.fits(line, end + 1) {
            return None;
        }
        let (mut flat_width, mut is_forced) = (0, false);
        let first_line_width = end - line;
        let mut end = end;
        while self.is_followed_by_directives(end, level) {
            let start = end + 1 + indentation;
            let name_end = self.name(start + 1)?;
            end = name_end;
            let mut width = name_end - start;
            if self.at(name_end) == b'(' {
                let item = Item::NamedValue { is_const };
                if self.at(name_end + 1) == b'\n' {
                    let list = self.list_on_lines(name_end, level + 1, item)?;
                    let rest = if self.is_at_block(list.end) { 2 } else { 0 };
                    if !list.is_forced && indentation + width + list.flat_width + rest <= self.width
                    {
                        return None;
                    }
                    is_forced |= list.is_forced;
                    (end, width) = (list.end, width + list.flat_width);
                } else {
                    end = self.list(name_end, item)?;
                    width = end - start;
                    let rest = if self.is_at_block(end) { 2 } else { 0 };
                    if indentation + width + rest > self.width {
                        return None;
                    }
                }
            }
            flat_width += 1 + width;
        }
        self.has_group.set(false);
        let rest = if self.is_at_block(end) { 2 } else { 0 };
        (is_forced || first_line_width + flat_width + rest > self.width).then_some(OnLines {
            end,
            flat_width,
            is_forced,
        })
    }

    // ───────────────────────────── blocks ─────────────────────────────

    /// The items of a block, which are at `level`, from the line behind the `{` on, which starts at `line`. Returns
    /// where the `}` ends.
    fn block(&self, block: Block, level: usize, mut line: usize) -> Option<usize> {
        let indentation = level * self.tab_width;
        if indentation > MAX_INDENTATION {
            return None;
        }
        let (mut has_item, mut follows_empty_line) = (false, false);
        loop {
            let blanks = self.blanks(line);
            let start = line + blanks;
            if blanks != indentation {
                let is_end = blanks + self.tab_width == indentation
                    && self.at(start) == b'}'
                    && has_item
                    && !follows_empty_line;
                return is_end.then_some(start + 1);
            }
            let mut end = match self.at(start) {
                b'#' => self.comment(start)?,
                _ => {
                    has_item = true;
                    let end = match block {
                        Block::Selections => self.selection(start, level)?,
                        Block::Fields => {
                            self.field(self.description(start, level)?, level, true)?
                        }
                        Block::InputFields => {
                            self.field(self.description(start, level)?, level, false)?
                        }
                        Block::EnumValues => {
                            self.enum_value(self.description(start, level)?, level)?
                        }
                        Block::OperationTypes => self.operation_type(start)?,
                    };
                    match self.at(end) {
                        // No empty line is kept behind a comment on the line of an item.
                        b' ' if self.at(end + 1) == b'#' => {
                            (self.comment(end + 1)).filter(|end| self.at(*end + 1) != b'\n')?
                        }
                        _ => end,
                    }
                }
            };
            if self.at(end) != b'\n' {
                return None;
            }
            end += 1;
            follows_empty_line = self.at(end) == b'\n';
            line = end + usize::from(follows_empty_line);
        }
    }

    /// `a: A`, `a(b: B): A` with `has_arguments`, `a: A = 1` without, and directives.
    #[inline(always)]
    fn field(&self, start: usize, level: usize, has_arguments: bool) -> Option<usize> {
        let name_end = self.name(start)?;
        if let Some(end) = self.type_behind_colon(name_end)
            && self.at(end) == b'\n'
            && !self.is_followed_by_directives(end, level)
        {
            return Some(end);
        }
        match has_arguments {
            true => self.field_with_more(start, name_end, level),
            false => Some(self.item_on_lines(start, level, Item::InputValue)?.end),
        }
    }

    #[inline(never)]
    fn field_with_more(&self, start: usize, name_end: usize, level: usize) -> Option<usize> {
        let indentation = level * self.tab_width;
        let mut line = start - indentation;
        self.has_group.set(false);
        let mut at = name_end;
        if self.at(at) == b'(' && self.at(at + 1) == b'\n' {
            let list = self.list_on_lines(at, level, Item::InputValue)?;
            let end = self.type_behind_colon(list.end)?;
            let has_directives =
                self.starts_with(end, b" @") || self.is_followed_by_directives(end, level);
            let rest = end - list.end + usize::from(has_directives);
            if !list.is_forced && at - line + list.flat_width + rest <= self.width {
                return None;
            }
            self.has_group.set(false);
            (line, at) = (list.end - 1 - indentation, end);
        } else {
            if self.at(at) == b'(' {
                at = self.list(at, Item::InputValue)?;
            }
            at = self.type_behind_colon(at)?;
        }
        if self.is_followed_by_directives(at, level) {
            return Some(self.directives_on_lines(line, at, level, true)?.end);
        }
        let end = self.directives(at, true)?;
        self.fits(line, end).then_some(end)
    }

    fn enum_value(&self, start: usize, level: usize) -> Option<usize> {
        let name_end = self.name(start)?;
        if matches!(
            self.text.get(start..name_end),
            Some(b"true" | b"false" | b"null")
        ) {
            return None;
        }
        let line = start - level * self.tab_width;
        self.has_group.set(false);
        if self.is_followed_by_directives(name_end, level) {
            return Some(self.directives_on_lines(line, name_end, level, true)?.end);
        }
        let end = self.directives(name_end, true)?;
        self.fits(line, end).then_some(end)
    }

    /// `query: A`
    fn operation_type(&self, start: usize) -> Option<usize> {
        let name_end = self.name(start)?;
        let is_operation = matches!(
            self.text.get(start..name_end),
            Some(b"query" | b"mutation" | b"subscription")
        );
        match (is_operation, self.at(name_end), self.at(name_end + 1)) {
            (true, b':', b' ') => self.name(name_end + 2),
            _ => None,
        }
    }

    #[inline(always)]
    fn selection(&self, start: usize, level: usize) -> Option<usize> {
        if let Some(end) = self.name(start) {
            if self.at(end) == b'\n' && !self.is_followed_by_directives(end, level) {
                return Some(end);
            }
            if self.is_at_block(end) {
                return self.block(Block::Selections, level + 1, end + 3);
            }
        }
        self.selection_with_more(start, level)
    }

    #[inline(never)]
    fn selection_with_more(&self, start: usize, level: usize) -> Option<usize> {
        let indentation = level * self.tab_width;
        let mut line = start - indentation;
        self.has_group.set(false);
        // A fragment has no block, an inline fragment has one, a field can have one.
        let (mut at, can_have_arguments, has_block) = if self.starts_with(start, b"...") {
            match self.at(start + 3) {
                b' ' if self.starts_with(start + 4, b"on ") => {
                    (self.name(start + 7)?, false, Some(true))
                }
                b' ' => (start + 3, false, Some(true)),
                _ => {
                    let end = self.name(start + 3)?;
                    if self.text.get(start + 3..end) == Some(b"on") {
                        return None;
                    }
                    (end, true, Some(false))
                }
            }
        } else {
            let mut end = self.name(start)?;
            if self.at(end) == b':' {
                end = self.name_behind_blank(end + 1)?;
            }
            (end, true, None)
        };
        if can_have_arguments && self.at(at) == b'(' {
            let item = Item::NamedValue { is_const: false };
            if self.at(at + 1) == b'\n' {
                let list = self.list_on_lines(at, level, item)?;
                let rest = match (self.at(list.end), self.at(list.end + 1)) {
                    (b' ', b'{') => 2,
                    (b' ', b'@') => 1,
                    _ => usize::from(self.is_followed_by_directives(list.end, level)),
                };
                if !list.is_forced && at - line + list.flat_width + rest <= self.width {
                    return None;
                }
                self.has_group.set(false);
                (line, at) = (list.end - 1 - indentation, list.end);
            } else {
                at = self.list(at, item)?;
            }
        }
        at = match self.is_followed_by_directives(at, level) {
            true => self.directives_on_lines(line, at, level, false)?.end,
            false => self.directives(at, false)?,
        };
        let is_block = self.is_at_block(at);
        if has_block.is_some_and(|it| it != is_block) {
            return None;
        }
        match is_block {
            true if self.fits(line, at + 2) => self.block(Block::Selections, level + 1, at + 3),
            false if self.fits(line, at) => Some(at),
            _ => None,
        }
    }

    // ───────────────────────────── definitions ─────────────────────────────

    /// The definition that starts at `at`, which starts a line.
    fn definition(&self, at: usize) -> Option<usize> {
        if self.at(at) == b'{' {
            return match self.at(at + 1) {
                b'\n' => self.block(Block::Selections, 1, at + 2),
                _ => None,
            };
        }
        let mut line = self.description(at, 0)?;
        let has_description = line > at;
        let mut start = line;
        let mut at = self.name(start)?;
        let is_extension = self.text.get(start..at) == Some(b"extend");
        if is_extension {
            if has_description {
                return None;
            }
            start = at + 1;
            at = self.name_behind_blank(at)?;
        }
        self.has_group.set(false);
        let keyword = self.text.get(start..at)?;
        let (block, is_block_needed) = match keyword {
            b"query" | b"mutation" | b"subscription" if !is_extension => {
                // Without a name there's a blank in front of the variables.
                match (self.at(at), self.at(at + 1)) {
                    (b' ', b'{' | b'@') => {}
                    (b' ', b'(') => at += 1,
                    (b' ', _) => at = self.name(at + 1)?,
                    _ => return None,
                }
                if self.at(at) == b'(' {
                    if self.at(at + 1) == b'\n' {
                        let list = self.list_on_lines(at, 0, Item::Variable)?;
                        // The line can break in front of directives.
                        let rest = if self.is_at_block(list.end) { 2 } else { 0 };
                        if !list.is_forced && at - line + list.flat_width + rest <= self.width {
                            return None;
                        }
                        self.has_group.set(false);
                        (line, at) = (list.end - 1, list.end);
                    } else {
                        at = self.list(at, Item::Variable)?;
                    }
                }
                at = self.directives(at, false)?;
                (Block::Selections, true)
            }
            b"fragment" if !is_extension => {
                let name_end = self.name_behind_blank(at)?;
                if self.text.get(at + 1..name_end) == Some(b"on")
                    || !self.starts_with(name_end, b" on ")
                {
                    return None;
                }
                at = self.directives(self.name(name_end + 4)?, false)?;
                (Block::Selections, true)
            }
            b"schema" => {
                let end = self.directives(at, true)?;
                let has_directives = end > at;
                at = end;
                (Block::OperationTypes, !(is_extension && has_directives))
            }
            b"scalar" => {
                let name_end = self.name_behind_blank(at)?;
                let end = self.directives(name_end, true)?;
                let is_whole = end > name_end || !is_extension;
                return (is_whole && self.fits(line, end)).then_some(end);
            }
            b"type" | b"interface" => {
                let name_end = self.name_behind_blank(at)?;
                at = name_end;
                if self.starts_with(at, b" implements ") {
                    at = self.name(at + 12)?;
                    if self.starts_with(at, b" &\n") {
                        return self.interfaces_on_lines(line, at);
                    }
                    self.has_group.set(true);
                    while self.starts_with(at, b" & ") {
                        at = self.name(at + 3)?;
                    }
                }
                at = self.directives(at, true)?;
                (Block::Fields, is_extension && at == name_end)
            }
            b"union" => return self.union(line, self.name_behind_blank(at)?, is_extension),
            b"enum" | b"input" => {
                let name_end = self.name_behind_blank(at)?;
                at = self.directives(name_end, true)?;
                let block = match keyword {
                    b"enum" => Block::EnumValues,
                    _ => Block::InputFields,
                };
                (block, is_extension && at == name_end)
            }
            b"directive" if !is_extension && self.starts_with(at, b" @") => {
                at = self.name(at + 2)?;
                if self.at(at) == b'(' {
                    at = self.list(at, Item::InputValue)?;
                }
                at = self.directives(at, true)?;
                if self.starts_with(at, b" repeatable") {
                    at += 11;
                }
                if !self.starts_with(at, b" on ") {
                    return None;
                }
                at += 4;
                loop {
                    let end = self.name(at)?;
                    if !is_directive_location(self.text.get(at..end)?) {
                        return None;
                    }
                    if !self.starts_with(end, b" | ") {
                        return self.fits(line, end).then_some(end);
                    }
                    at = end + 3;
                }
            }
            _ => return None,
        };
        if self.is_at_block(at) {
            return match self.fits(line, at + 2) {
                true => self.block(block, 1, at + 3),
                false => None,
            };
        }
        (!is_block_needed && self.fits(line, at)).then_some(at)
    }

    /// The rest of `type A implements B &`, which starts at `line`. The name of the first interface ends at `at`.
    fn interfaces_on_lines(&self, line: usize, mut at: usize) -> Option<usize> {
        let mut flat_width = at - line;
        while self.starts_with(at, b" &\n") {
            let start = at + 3 + self.tab_width;
            if self.blanks(at + 3) != self.tab_width {
                return None;
            }
            at = self.name(start)?;
            flat_width += 3 + at - start;
        }
        let has_block = self.is_at_block(at);
        if flat_width + if has_block { 2 } else { 0 } <= self.width {
            return None;
        }
        match has_block {
            true => self.block(Block::Fields, 1, at + 3),
            false => Some(at),
        }
    }

    /// The rest of `union A`, which starts at `line` and ends at `name_end`.
    fn union(&self, line: usize, name_end: usize, is_extension: bool) -> Option<usize> {
        self.has_group.set(true);
        let mut at = self.directives(name_end, true)?;
        if self.starts_with(at, b" =\n") {
            // Which group gives way is the printer's to say.
            if at > name_end {
                return None;
            }
            let mut flat_width = at + 2 - line;
            at += 2;
            while self.at(at) == b'\n'
                && self.blanks(at + 1) == self.tab_width
                && self.starts_with(at + 1 + self.tab_width, b"| ")
            {
                let start = at + 1 + self.tab_width + 2;
                at = self.name(start)?;
                // ` | `, or a blank in front of the first one.
                flat_width += 3 + at - start;
            }
            return (at > name_end + 2 && flat_width - 2 > self.width).then_some(at);
        }
        if self.starts_with(at, b" = ") {
            at = self.name(at + 3)?;
            while self.starts_with(at, b" | ") {
                at = self.name(at + 3)?;
            }
        }
        ((at > name_end || !is_extension) && self.fits(line, at)).then_some(at)
    }
}
