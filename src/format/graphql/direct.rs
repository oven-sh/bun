//! Formats a text while reading it, without a tree.
//!
//! The tokens of a text are printed in their order, nearly all of them as they're written, and what's between two of
//! them follows from the grammar. Items of a block and definitions are on lines of their own whatever the width. So
//! this reads a token, decides what goes before it, and writes both. There are three ways to write, and whatever one
//! of them isn't sure about goes to the next one:
//!
//! 1. Straight to the output, with every group on one line. That's what Prettier prints if the line fits. As long as
//!    the text between two tokens is what would be written between them, nothing is written at all: the tokens join a
//!    run of the source that's copied in one piece. A text that's already formatted is one run.
//! 2. If the line doesn't fit, or a line break is forced inside a group: a list in brackets is written with its items on
//!    lines of their own, since it breaks whatever follows it. Anything else is a [unit](Direct::unit) that's read again
//!    and written as a document, which `css/doc.rs` prints.
//! 3. A definition with anything else in it is parsed into a tree and printed from there, like the whole text is
//!    without this file: a comment that isn't between two items, a syntax error, a string that's printed differently
//!    from how Prettier prints it.
//!
//! The grammar is `parser.rs`'s and the rules are `printer.rs`'s. Anything accepted here must be accepted there.

use super::lines::Lines;
use super::parser::{self, Tree};
use super::printer::{Builder, write_string_with_escapes};
use super::tokens::{Kind, NOT_ON_LINES, Token, end_of_comment, scan};
use super::{Scratch, comments};
use crate::FormatOptions;
use crate::css::doc::{self, Elements, Group, IndentCommand, Line};
use crate::ir::width::{is_all_printable, string_width};
use crate::js::context::JsFormatContext;
use crate::options::LineEnding;
use crate::text::{
    has_newline_backwards, is_followed_by_empty_line, is_next_line_empty, is_previous_line_empty,
};
use bun_core::strings;

/// Why something can't be written the current way.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Refusal {
    /// The unit has to be written as a document.
    Layout,
    /// The definition has to be printed from a tree.
    Definition,
    /// The whole text has to be.
    Text,
}

type Result<T = ()> = std::result::Result<T, Refusal>;

/// What's written before the next text, when writing straight to the output.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Gap {
    Nothing,
    Space,
    /// `, `
    Comma,
    /// `Direct::gap_lines` line breaks and the indentation of `Direct::gap_level`.
    Lines,
}

/// The items of a list in brackets.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Item {
    /// `(a: 1)`, `{ a: 1 }`
    NamedValue {
        is_const: bool,
    },
    /// `[1]`
    Value {
        is_const: bool,
    },
    VariableDefinition,
    InputValueDefinition,
}

/// The items of the block that follows the head of a definition.
#[derive(Copy, Clone)]
enum Block {
    Selections,
    Fields,
    InputFields,
    EnumValues,
    OperationTypes,
}

const NO_COMMENT: u32 = u32::MAX;

/// Whatever is nested deeper than this is left to the tree, so that how deep a text can be nested doesn't depend on the
/// way it's written.
const MAX_NESTING: u32 = 64;

/// Everything that writing changes, to take back what's been written.
#[derive(Copy, Clone)]
struct Mark {
    index: usize,
    token: Token,
    last_end: u32,
    comment: u32,
    out_len: usize,
    run_start: usize,
    run_end: usize,
    gap: Gap,
    gap_lines: u32,
    gap_level: u32,
    line_start: usize,
    line_indent: usize,
    extra_width: isize,
    level: u32,
    nesting: u32,
}

struct Direct<'t, 'o> {
    text: &'t [u8],
    options: &'o FormatOptions,
    width: usize,
    tab_width: usize,
    use_tabs: bool,
    /// Indentation is made of spaces, and so is all white space in a line of `text`.
    has_only_spaces: bool,
    bracket_spacing: bool,
    /// Widths are Prettier's.
    measures_like_prettier: bool,
    /// Definitions can be printed from a tree into `printer.out`.
    can_print_definitions: bool,
    stack: bun_core::StackCheck,

    tokens: &'o [Token],
    /// The index of `token`.
    index: usize,
    /// The next token that isn't a comment.
    token: Token,
    /// The end of the token before `token`.
    last_end: u32,
    /// The start of the first comment between the two, or `NO_COMMENT`.
    comment: u32,

    printer: doc::Printer<'o>,
    /// The part of the source that's been written but not copied to the output yet.
    run_start: usize,
    run_end: usize,
    gap: Gap,
    gap_lines: u32,
    gap_level: u32,
    /// Where the text of the current line starts, as an offset in the output once the run is copied.
    line_start: usize,
    /// The width of the indentation before it.
    line_indent: usize,
    /// How much wider the text of the current line is than it has bytes.
    extra_width: isize,
    /// The current line has a group, so it matters if it fits.
    has_group: bool,
    /// The number of open groups.
    groups: u32,
    /// The number of open blocks.
    level: u32,
    /// The number of open blocks, lists and objects.
    nesting: u32,

    /// The number of [units](Direct::unit) that are being written.
    units: u32,
    /// The unit is being written to `elements`.
    is_document: bool,
    elements: &'o mut Elements,
    /// `printer`'s indentation for each level.
    indents: Vec<u32>,
    lines: &'o mut Vec<(u32, u32)>,
    buffer: &'o mut Vec<u8>,
    tree: &'o mut Tree,
    attached: &'o mut Vec<comments::Attached>,
    document: &'o mut crate::Scratch,
}

/// Appends the formatted `text` to `out` and returns true, or leaves `out` as it is. `text` has no byte order mark and
/// no `\r`, and isn't blank.
pub(super) fn format(
    text: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> bool {
    if u32::try_from(text.len()).is_err() {
        return false;
    }
    let line_ending = options.line_ending.resolve(text);
    if line_ending != LineEnding::Lf {
        let options = FormatOptions {
            line_ending: LineEnding::Lf,
            ..options.clone()
        };
        let mut with_line_feeds = std::mem::take(&mut scratch.with_line_feeds);
        with_line_feeds.clear();
        let len = out.len();
        let mut is_done = write(text, &options, false, scratch, &mut with_line_feeds);
        if is_done {
            crate::range::write_with_line_ending(&with_line_feeds, line_ending.as_bytes(), out);
            is_done = !crate::is_too_long(out.len());
        }
        if !is_done {
            out.truncate(len);
        }
        scratch.with_line_feeds = with_line_feeds;
        return is_done;
    }
    write(text, options, true, scratch, out)
}

fn write(
    text: &[u8],
    options: &FormatOptions,
    can_print_definitions: bool,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> bool {
    let len = out.len();
    out.reserve(text.len() + text.len() / 16 + 64);
    let stops = scratch.stops.find(text);
    let has_only_spaces = !options.indent_style.is_tab() && !strings::contains_char(text, b'\t');
    let as_printed_to = match has_only_spaces {
        true => Lines::new(text, stops, options).end_of_definitions_as_printed(),
        false => 0,
    };
    if as_printed_to == text.len() {
        out.extend_from_slice(text);
        return !crate::is_too_long(out.len()) || {
            out.truncate(len);
            false
        };
    }
    let count = scan(text, stops, as_printed_to, &mut scratch.tokens);
    let mut direct = Direct {
        text,
        options,
        width: options.line_width.value() as usize,
        tab_width: options.indent_width.value() as usize,
        use_tabs: options.indent_style.is_tab(),
        has_only_spaces,
        bracket_spacing: options.bracket_spacing.value(),
        measures_like_prettier: !options.flavor.is_oxfmt(),
        can_print_definitions,
        stack: bun_core::StackCheck::init(),
        tokens: scratch.tokens.get(..count).unwrap_or_default(),
        index: 0,
        token: Token::end_of(b""),
        last_end: 0,
        comment: NO_COMMENT,
        printer: doc::Printer::new(options, text, out),
        run_start: 0,
        run_end: 0,
        gap: Gap::Nothing,
        gap_lines: 0,
        gap_level: 0,
        line_start: len,
        line_indent: 0,
        extra_width: 0,
        has_group: false,
        groups: 0,
        level: 0,
        nesting: 0,
        units: 0,
        is_document: false,
        elements: &mut scratch.elements,
        indents: Vec::new(),
        lines: &mut scratch.lines,
        buffer: &mut scratch.buffer,
        tree: &mut scratch.tree,
        attached: &mut scratch.attached,
        document: &mut scratch.document,
    };
    let is_done =
        direct.document(as_printed_to).is_ok() && !crate::is_too_long(direct.printer.out.len());
    if !is_done {
        out.truncate(len);
    }
    is_done
}

impl<'t> Direct<'t, '_> {
    // ───────────────────────────── tokens ─────────────────────────────

    /// Makes the token after `token` the next one.
    #[inline]
    fn read_token(&mut self) {
        self.last_end = self.token.end;
        self.index += 1;
        self.load_token();
    }

    /// Makes the token at `index`, or the first one after it that isn't a comment, the next one.
    #[inline]
    fn load_token(&mut self) {
        match self.tokens.get(self.index) {
            Some(token) if token.kind != Kind::Comment => self.token = *token,
            _ => self.load_token_after_comments(),
        }
    }

    #[inline(never)]
    fn load_token_after_comments(&mut self) {
        while let Some(token) = self.tokens.get(self.index) {
            if token.kind != Kind::Comment {
                self.token = *token;
                return;
            }
            self.comment = self.comment.min(token.start);
            self.index += 1;
        }
        self.token = Token::end_of(self.text);
    }

    fn token_text(&self) -> &'t [u8] {
        self.text
            .get(self.token.start as usize..self.token.end as usize)
            .unwrap_or_default()
    }

    #[inline]
    fn is(&self, kind: Kind) -> bool {
        self.token.kind == kind
    }

    fn is_keyword(&self, keyword: &[u8]) -> bool {
        self.is(Kind::Name) && self.token_text() == keyword
    }

    /// Writes the next token as it's written in the source.
    #[inline(never)]
    fn take(&mut self) -> Result {
        if self.comment != NO_COMMENT {
            return Err(Refusal::Definition);
        }
        let (start, end) = (self.token.start as usize, self.token.end as usize);
        if self.starts_its_line() {
            self.gap = Gap::Nothing;
            self.line_indent = self.gap_level as usize * self.tab_width;
            self.run_end = end;
            self.line_start = self.printer.out.len() + (start - self.run_start);
        } else {
            self.put(start, end);
        }
        self.read_token();
        Ok(())
    }

    /// True if a line break is due and the next token goes on the run with it. It's what `put_on_new_line` finds out,
    /// from what's known about the token.
    #[inline]
    fn starts_its_line(&self) -> bool {
        self.gap == Gap::Lines
            && !self.is_document
            && self.has_only_spaces
            && self.run_end == self.last_end as usize
            && u32::from(self.token.ignored_before) == self.gap_lines
            && self.token.start as usize - self.run_end
                == self.gap_lines as usize + self.indentation_len(self.gap_level)
            && (self
                .text
                .get(self.run_end..self.run_end + self.gap_lines as usize))
            .is_some_and(|it| it.iter().all(|byte| *byte == b'\n'))
    }

    // ───────────────────────────── whole lines ─────────────────────────────
    //
    // Most lines are of a few kinds and written as they're printed. For those, this is what `take`, `space` and the
    // grammar below come to, found out from the tokens of the line at once.

    /// Takes the tokens from the next one, which `starts_its_line`, up to the one at `index`. They're written as they're
    /// printed, on one line, and the last of them ends at `end`.
    #[inline]
    fn take_line(&mut self, index: usize, end: u32) {
        self.gap = Gap::Nothing;
        self.line_indent = self.gap_level as usize * self.tab_width;
        self.line_start = self.printer.out.len() + (self.token.start as usize - self.run_start);
        self.run_end = end as usize;
        self.last_end = end;
        self.index = index;
        self.load_token();
    }

    /// True if one blank is between `end` and `token`, where `has_only_spaces`.
    #[inline]
    fn follows_blank(token: &Token, end: u32) -> bool {
        token.start.checked_sub(end) == Some(1) && token.ignored_before == 0
    }

    /// `name: [Type!]!` and nothing else on its line. False, with nothing taken, for anything else.
    #[inline]
    fn plain_field(&mut self) -> bool {
        let tokens = self.tokens;
        let kind_at = |index: usize| tokens.get(index).map_or(Kind::End, |it| it.kind);
        // The token at `index` is of `kind` and right behind `end`.
        let touches = |index: usize, kind: Kind, end: u32| {
            (tokens.get(index)).is_some_and(|it| it.kind == kind && it.start == end)
        };
        let mut end = self.token.end;
        let mut index = self.index + 1;
        if !self.is(Kind::Name)
            || self.comment != NO_COMMENT
            || !touches(index, Kind::Colon, end)
            || !(tokens.get(index + 1)).is_some_and(|it| Self::follows_blank(it, end + 1))
            || !self.starts_its_line()
        {
            return false;
        }
        (index, end) = (index + 1, end + 2);
        let mut lists = 0;
        while touches(index, Kind::BracketL, end) {
            (index, end, lists) = (index + 1, end + 1, lists + 1);
        }
        match tokens.get(index) {
            Some(name) if name.kind == Kind::Name && name.start == end && lists <= 8 => {
                (index, end) = (index + 1, name.end);
            }
            _ => return false,
        }
        loop {
            if touches(index, Kind::Bang, end) {
                (index, end) = (index + 1, end + 1);
            }
            if lists == 0 {
                break;
            }
            if !touches(index, Kind::BracketR, end) {
                return false;
            }
            (index, end, lists) = (index + 1, end + 1, lists - 1);
        }
        // What can go on with the item, in one place or another.
        if matches!(kind_at(index), Kind::Bang | Kind::Equals | Kind::At) {
            return false;
        }
        self.take_line(index, end);
        true
    }

    /// `name` or `name {` and nothing else on its line. Returns whether there's a `{`, or `None`, with nothing taken, for
    /// anything else.
    #[inline]
    fn plain_selection(&mut self) -> Option<bool> {
        let end = self.token.end;
        let next = self.tokens.get(self.index + 1)?;
        if !self.is(Kind::Name) || self.comment != NO_COMMENT || !self.starts_its_line() {
            return None;
        }
        match next.kind {
            Kind::Colon | Kind::ParenL | Kind::At => None,
            Kind::BraceL => Self::follows_blank(next, end).then(|| {
                self.take_line(self.index + 2, end + 2);
                true
            }),
            _ => {
                self.take_line(self.index + 1, end);
                Some(false)
            }
        }
    }

    /// Leaves the next token out.
    fn skip(&mut self) -> Result {
        if self.comment != NO_COMMENT {
            return Err(Refusal::Definition);
        }
        self.read_token();
        Ok(())
    }

    #[inline]
    fn expect(&mut self, kind: Kind) -> Result {
        match self.is(kind) {
            true => self.take(),
            false => Err(Refusal::Definition),
        }
    }

    fn expect_keyword(&mut self, keyword: &[u8]) -> Result {
        match self.is_keyword(keyword) {
            true => self.take(),
            false => Err(Refusal::Definition),
        }
    }

    // ───────────────────────────── the output ─────────────────────────────

    /// Writes the source from `start` to `end`, which is on one line and as wide as it has bytes, or measured by the
    /// caller.
    #[inline]
    fn put(&mut self, start: usize, end: usize) {
        if self.is_document {
            return self
                .elements
                .text(self.text.get(start..end).unwrap_or_default());
        }
        let continues_run = match self.gap {
            Gap::Nothing => start == self.run_end,
            Gap::Space => start == self.run_end + 1 && self.text.get(self.run_end) == Some(&b' '),
            Gap::Comma => self.text.get(self.run_end..start) == Some(b", "),
            Gap::Lines => return self.put_on_new_line(start, end),
        };
        if !continues_run {
            self.write_pending();
            self.run_start = start;
        }
        self.gap = Gap::Nothing;
        self.run_end = end;
    }

    fn indentation_len(&self, level: u32) -> usize {
        level as usize * if self.use_tabs { 1 } else { self.tab_width }
    }

    fn put_on_new_line(&mut self, start: usize, end: usize) {
        let lines = self.gap_lines as usize;
        let indentation = if self.use_tabs { b'\t' } else { b' ' };
        let continues_run = self.text.get(self.run_end..start).is_some_and(|between| {
            between.len() == lines + self.indentation_len(self.gap_level)
                && between[..lines].iter().all(|byte| *byte == b'\n')
                && between[lines..].iter().all(|byte| *byte == indentation)
        });
        if continues_run {
            self.gap = Gap::Nothing;
            self.line_indent = self.gap_level as usize * self.tab_width;
        } else {
            self.write_pending();
            self.run_start = start;
        }
        self.run_end = end;
        self.line_start = self.printer.out.len() + (start - self.run_start);
    }

    /// Copies the run to the output, and writes the gap.
    fn write_pending(&mut self) {
        let indentation_len = self.indentation_len(self.gap_level);
        let out = &mut *self.printer.out;
        out.extend_from_slice(
            self.text
                .get(self.run_start..self.run_end)
                .unwrap_or_default(),
        );
        self.run_start = self.run_end;
        match std::mem::replace(&mut self.gap, Gap::Nothing) {
            Gap::Nothing => {}
            Gap::Space => out.push(b' '),
            Gap::Comma => out.extend_from_slice(b", "),
            Gap::Lines => {
                let indentation = if self.use_tabs { b'\t' } else { b' ' };
                let len = out.len() + self.gap_lines as usize;
                out.resize(len, b'\n');
                // The caller finds out at the end.
                if !crate::is_too_long(len) {
                    out.resize(len + indentation_len, indentation);
                }
                self.line_start = out.len();
                self.line_indent = self.gap_level as usize * self.tab_width;
            }
        }
    }

    /// Writes `buffer` in the place of the next token.
    fn put_buffer(&mut self) {
        if self.is_document {
            return self.elements.text(self.buffer);
        }
        self.write_pending();
        self.printer.out.extend_from_slice(self.buffer);
        (self.run_start, self.run_end) = (self.token.end as usize, self.token.end as usize);
    }

    /// Counts `text`, which is about to be written, as wide as it is.
    fn measure(&mut self, text: &[u8]) -> Result {
        if is_all_printable(text) {
            return Ok(());
        }
        if !self.measures_like_prettier {
            return Err(Refusal::Definition);
        }
        self.extra_width += string_width(text) as isize - text.len() as isize;
        Ok(())
    }

    fn column(&self) -> usize {
        let len = self.printer.out.len() + (self.run_end - self.run_start);
        (self.line_indent + len.saturating_sub(self.line_start))
            .saturating_add_signed(self.extra_width)
    }

    fn check_column(&self) -> Result {
        match self.column() > self.width {
            true => Err(Refusal::Layout),
            false => Ok(()),
        }
    }

    /// Called where a line that's written straight to the output ends.
    fn end_line(&mut self) -> Result {
        if self.has_group {
            self.check_column()?;
            self.has_group = false;
        }
        Ok(())
    }

    /// `is_next_line_empty(text, last_end)`
    #[inline]
    fn is_next_line_empty(&self) -> bool {
        let at = self.last_end as usize;
        match (self.token.ignored_before, self.text.get(at..at + 2)) {
            _ if self.comment != NO_COMMENT => is_next_line_empty(self.text, at),
            // Nothing but spaces and tabs is before the next token, or behind the line feed.
            (0, _) | (1, Some([b'\n', _])) => false,
            (_, Some(b"\n\n")) => true,
            _ => is_next_line_empty(self.text, at),
        }
    }

    /// Ends a line that has no group, and leaves `count - 1` lines empty.
    fn break_line(&mut self, count: u32) {
        (self.gap, self.gap_lines, self.gap_level) = (Gap::Lines, count, self.level);
        self.extra_width = 0;
    }

    /// `" "`
    #[inline]
    fn space(&mut self) {
        match self.is_document {
            true => self.elements.token(" "),
            false => self.gap = Gap::Space,
        }
    }

    /// `count` times `hardline`
    fn hard_lines(&mut self, count: u32) -> Result {
        if self.is_document {
            for _ in 0..count {
                self.elements.hard_line();
            }
            return Ok(());
        }
        if self.groups > 0 {
            return Err(Refusal::Layout);
        }
        self.end_line()?;
        self.break_line(count);
        Ok(())
    }

    /// `line`
    fn line(&mut self) -> Result {
        if self.is_document {
            self.elements.line(Line::Space);
        } else if self.groups == 0 {
            return self.hard_lines(1);
        } else {
            self.gap = Gap::Space;
        }
        Ok(())
    }

    /// `softline`, in a group
    #[inline]
    fn soft_line(&mut self) {
        if self.is_document {
            self.elements.line(Line::Soft);
        }
    }

    /// `ifBreak("", text)`
    fn if_flat(&mut self, text: &'static str, gap: Gap) {
        if self.is_document {
            self.elements.start_if_break(0);
            self.elements.otherwise();
            self.elements.token(text);
            self.elements.end_if_break();
        } else {
            self.gap = gap;
        }
    }

    /// `[ifBreak("", ", "), softline]`
    fn separator(&mut self) -> Result {
        // The sooner a line that doesn't fit is given up, the less is read twice.
        if !self.is_document {
            self.check_column()?;
        }
        self.if_flat(", ", Gap::Comma);
        self.soft_line();
        Ok(())
    }

    #[inline]
    fn start_group(&mut self) {
        match self.is_document {
            true => self.elements.start_group(Group::default()),
            false => {
                self.groups += 1;
                self.has_group = true;
            }
        }
    }

    #[inline]
    fn end_group(&mut self) {
        match self.is_document {
            true => self.elements.end_group(),
            false => self.groups -= 1,
        }
    }

    /// In a group.
    #[inline]
    fn start_indent(&mut self) {
        if self.is_document {
            self.elements.start_indent(IndentCommand::Indent);
        }
    }

    #[inline]
    fn end_indent(&mut self) {
        if self.is_document {
            self.elements.end_indent();
        }
    }

    fn mark(&self) -> Mark {
        Mark {
            index: self.index,
            token: self.token,
            last_end: self.last_end,
            comment: self.comment,
            out_len: self.printer.out.len(),
            run_start: self.run_start,
            run_end: self.run_end,
            gap: self.gap,
            gap_lines: self.gap_lines,
            gap_level: self.gap_level,
            line_start: self.line_start,
            line_indent: self.line_indent,
            extra_width: self.extra_width,
            level: self.level,
            nesting: self.nesting,
        }
    }

    /// Takes back what's been read and written since `mark`, which was made outside of groups.
    fn reset(&mut self, mark: &Mark) {
        self.index = mark.index;
        self.token = mark.token;
        self.last_end = mark.last_end;
        self.comment = mark.comment;
        self.printer.out.truncate(mark.out_len);
        self.run_start = mark.run_start;
        self.run_end = mark.run_end;
        self.gap = mark.gap;
        self.gap_lines = mark.gap_lines;
        self.gap_level = mark.gap_level;
        self.line_start = mark.line_start;
        self.line_indent = mark.line_indent;
        self.extra_width = mark.extra_width;
        self.level = mark.level;
        self.nesting = mark.nesting;
        self.has_group = false;
        self.groups = 0;
    }

    fn is_in_unit(&self) -> bool {
        self.units > 0 || self.is_document
    }

    /// Goes on behind something that wasn't written straight to the output and ends at `last_end`.
    fn resume(&mut self) {
        (self.run_start, self.run_end) = (self.last_end as usize, self.last_end as usize);
        self.has_group = false;
    }

    /// Writes what `write` writes: something that isn't in a group, has no block in it, and ends its line. `write` has
    /// no effects other than reading and writing.
    fn unit<T>(&mut self, write: impl Fn(&mut Self) -> Result<T>) -> Result<T> {
        let (mark, units) = (self.mark(), self.units);
        self.units += 1;
        let result = write(self).and_then(|value| self.end_line().map(|()| value));
        self.units = units;
        if !matches!(result, Err(Refusal::Layout)) {
            return result;
        }
        self.reset(&mark);
        self.write_pending();
        let column = self.column();
        self.elements.clear();
        self.is_document = true;
        let result = write(self);
        self.is_document = false;
        let value = result?;
        while self.indents.len() <= self.level as usize {
            let indent = match self.indents.last() {
                Some(&outer) => self.printer.indented(outer),
                None => 0,
            };
            self.indents.push(indent);
        }
        let indent = self.indents[self.level as usize];
        self.printer.print(self.elements, indent, column);
        self.printer.result().map_err(|_| Refusal::Text)?;
        self.resume();
        Ok(value)
    }

    /// Prints the definition that starts at the next token from a tree.
    #[cold]
    fn print_definition(&mut self) -> Result {
        if !self.can_print_definitions {
            return Err(Refusal::Text);
        }
        self.write_pending();
        let (text, start) = (self.text, self.token.start);
        let end = parser::parse_definition(text, start, self.tree).map_err(|_| Refusal::Text)?;
        comments::attach(text, self.tree, self.attached);
        let (tree, attached) = (&*self.tree, &self.attached[..]);
        // Preparing a document takes time in proportion to its source.
        let source = text.get(start as usize..end as usize).unwrap_or_default();
        let context =
            JsFormatContext::without_file(self.options.clone(), &crate::js::comments::NO_COMMENTS);
        let root = crate::ir::run::write_with(context, source, self.document, |f| {
            let mut builder = Builder {
                text,
                tree,
                attached,
                f,
                is_in_template: false,
            };
            builder.print(tree.root());
        })
        .map_err(|_| Refusal::Text)?;
        crate::ir::run::print(root, source, self.options, self.document, self.printer.out)
            .map_err(|_| Refusal::Text)?;
        let rest = self.tokens.get(self.index..).unwrap_or_default();
        self.index += rest.iter().take_while(|token| token.start < end).count();
        (self.last_end, self.comment) = (end, NO_COMMENT);
        self.load_token();
        self.resume();
        Ok(())
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// Calls `write` with the start and the end of each comment before the next token.
    fn for_each_comment(
        &mut self,
        mut write: impl FnMut(&mut Self, usize, usize) -> Result,
    ) -> Result {
        let (mut at, limit) = (self.comment as usize, self.token.start as usize);
        self.comment = NO_COMMENT;
        while at < limit {
            let end = end_of_comment(self.text, at);
            let content = self.text.get(at + 1..end).unwrap_or_default();
            if (self.options.flavor).is_ignore_comment(strings::trim_js_whitespace(content)) {
                return Err(Refusal::Text);
            }
            write(self, at, end)?;
            let rest = self.text.get(end..limit).unwrap_or_default();
            at = end + strings::index_of_char_usize(rest, b'#').unwrap_or(rest.len());
        }
        Ok(())
    }

    /// Prettier's `printComment`
    fn put_comment(&mut self, start: usize, end: usize) {
        let comment = self.text.get(start..end).unwrap_or_default();
        self.put(start, start + comment.trim_ascii_end().len());
    }

    /// Prettier's `printLeadingComment`
    fn put_leading_comment(&mut self, start: usize, end: usize) {
        self.put_comment(start, end);
        self.break_line(1 + u32::from(is_followed_by_empty_line(self.text, end)));
    }

    /// Writes the comments before the first item of a list. `has_node_before` is true if they follow a node that's in
    /// the same node as the item.
    fn comments_before_first_item(&mut self, has_node_before: bool) -> Result {
        if self.comment == NO_COMMENT {
            return Ok(());
        }
        self.for_each_comment(|this, start, end| {
            if has_node_before && !has_newline_backwards(this.text, start) {
                return Err(Refusal::Definition);
            }
            this.put_leading_comment(start, end);
            Ok(())
        })
    }

    /// Writes what's between an item that ends at `last_end` and the next one, which is on a line of its own. After the
    /// last item, only its comments. `keeps_empty_lines` selects Prettier's `printSequence`.
    fn end_item(&mut self, is_last: bool, keeps_empty_lines: bool) -> Result {
        let lines_after_item = 1 + u32::from(keeps_empty_lines && self.is_next_line_empty());
        if self.comment == NO_COMMENT {
            if !is_last {
                self.break_line(lines_after_item);
            }
            return Ok(());
        }
        let (mut is_first, mut is_after_item) = (true, true);
        self.for_each_comment(|this, start, end| {
            let is_on_own_line = has_newline_backwards(this.text, start);
            if is_last {
                // Prettier's `printTrailingComments`
                match is_on_own_line || !is_first {
                    true => {
                        this.break_line(1 + u32::from(is_previous_line_empty(this.text, start)))
                    }
                    false => this.gap = Gap::Space,
                }
                this.put_comment(start, end);
            } else if is_on_own_line {
                if std::mem::take(&mut is_after_item) {
                    this.break_line(lines_after_item);
                }
                this.put_leading_comment(start, end);
            } else if is_first {
                this.gap = Gap::Space;
                this.put_comment(start, end);
            } else {
                return Err(Refusal::Definition);
            }
            is_first = false;
            Ok(())
        })?;
        if is_after_item && !is_last {
            self.break_line(lines_after_item);
        }
        Ok(())
    }

    // ───────────────────────────── the grammar ─────────────────────────────

    /// The tokens start behind a definition that ends at `as_printed_to`, up to which the text is printed as it's
    /// written. At the start of the text if that's 0.
    fn document(&mut self, as_printed_to: usize) -> Result {
        self.load_token();
        let mut follows_definition = as_printed_to > 0;
        match follows_definition {
            true => (self.last_end, self.run_end) = (as_printed_to as u32, as_printed_to),
            false => self.comments_before_first_item(false)?,
        }
        loop {
            if !std::mem::take(&mut follows_definition) {
                let mark = self.mark();
                match self.definition() {
                    Ok(()) => {}
                    Err(Refusal::Text) => return Err(Refusal::Text),
                    Err(_) => {
                        self.reset(&mark);
                        self.print_definition()?;
                    }
                }
            }
            let is_last = self.is(Kind::End);
            self.end_item(is_last, true)?;
            if is_last {
                break;
            }
        }
        self.break_line(1);
        self.put(self.text.len(), self.text.len());
        self.write_pending();
        Ok(())
    }

    fn definition(&mut self) -> Result {
        if self.is(Kind::BraceL) {
            self.take()?;
            return self.block(Block::Selections);
        }
        let has_description = self.description(false)?;
        match self.unit(|this| this.head(has_description))? {
            Some(block) => self.block(block),
            None => Ok(()),
        }
    }

    /// Writes a definition or an extension up to the `{` of its block.
    fn head(&mut self, has_description: bool) -> Result<Option<Block>> {
        let is_extension = self.is_keyword(b"extend");
        if is_extension {
            if has_description {
                return Err(Refusal::Definition);
            }
            self.take()?;
            self.space();
        }
        if !self.is(Kind::Name) {
            return Err(Refusal::Definition);
        }
        let keyword = self.token_text();
        let (block, is_block_needed) = match keyword {
            b"query" | b"mutation" | b"subscription" if !is_extension => {
                self.take()?;
                if self.is(Kind::Name) {
                    self.space();
                    self.take()?;
                } else if self.is(Kind::ParenL) {
                    self.space();
                }
                self.parenthesized(Item::VariableDefinition, false)?;
                self.directives(false, true)?;
                (Block::Selections, true)
            }
            b"fragment" if !is_extension => {
                self.take()?;
                self.space();
                if self.is_keyword(b"on") {
                    return Err(Refusal::Definition);
                }
                self.expect(Kind::Name)?;
                self.parenthesized(Item::VariableDefinition, false)?;
                self.space();
                self.expect_keyword(b"on")?;
                self.space();
                self.expect(Kind::Name)?;
                self.directives(false, true)?;
                (Block::Selections, true)
            }
            b"schema" => {
                self.take()?;
                let has_directives = self.directives(true, false)?;
                (Block::OperationTypes, !(is_extension && has_directives))
            }
            b"scalar" => {
                self.take()?;
                self.space();
                self.expect(Kind::Name)?;
                return match self.directives(true, false)? || !is_extension {
                    true => Ok(None),
                    false => Err(Refusal::Definition),
                };
            }
            b"type" | b"interface" => {
                self.take()?;
                self.space();
                self.expect(Kind::Name)?;
                let has_interfaces = self.interfaces()?;
                let has_directives = self.directives(true, false)?;
                let adds_something = has_interfaces || has_directives;
                (Block::Fields, is_extension && !adds_something)
            }
            b"union" => {
                self.start_group();
                self.take()?;
                self.space();
                self.expect(Kind::Name)?;
                let has_directives = self.directives(true, false)?;
                let has_members = self.union_members()?;
                self.end_group();
                return match has_directives || has_members || !is_extension {
                    true => Ok(None),
                    false => Err(Refusal::Definition),
                };
            }
            b"enum" | b"input" => {
                self.take()?;
                self.space();
                self.expect(Kind::Name)?;
                let has_directives = self.directives(true, false)?;
                let block = match keyword {
                    b"enum" => Block::EnumValues,
                    _ => Block::InputFields,
                };
                (block, is_extension && !has_directives)
            }
            b"directive" => {
                self.take()?;
                self.space();
                self.expect(Kind::At)?;
                self.expect(Kind::Name)?;
                if is_extension {
                    return match self.directives(true, false)? {
                        true => Ok(None),
                        false => Err(Refusal::Definition),
                    };
                }
                self.parenthesized(Item::InputValueDefinition, true)?;
                self.directives(true, false)?;
                if self.is_keyword(b"repeatable") {
                    self.space();
                    self.take()?;
                }
                self.space();
                self.expect_keyword(b"on")?;
                self.space();
                if self.is(Kind::Pipe) {
                    self.skip()?;
                }
                loop {
                    if !parser::is_directive_location(self.token_text()) {
                        return Err(Refusal::Definition);
                    }
                    self.expect(Kind::Name)?;
                    if !self.is(Kind::Pipe) {
                        return Ok(None);
                    }
                    self.space();
                    self.take()?;
                    self.space();
                }
            }
            _ => return Err(Refusal::Definition),
        };
        if !self.is(Kind::BraceL) {
            return match is_block_needed {
                true => Err(Refusal::Definition),
                false => Ok(None),
            };
        }
        self.space();
        self.take()?;
        Ok(Some(block))
    }

    /// Writes the items of a block and its `}`. The `{` has been written.
    fn block(&mut self, block: Block) -> Result {
        self.nesting += 1;
        if self.nesting > MAX_NESTING || !self.stack.is_safe_to_recurse() {
            return Err(Refusal::Text);
        }
        self.level += 1;
        self.break_line(1);
        // A selection set is a node, and the selections are all that's in it. Other blocks are part of the definition.
        self.comments_before_first_item(!matches!(block, Block::Selections))?;
        loop {
            match block {
                Block::Selections => self.selection()?,
                Block::Fields => {
                    self.description(false)?;
                    if !self.plain_field() {
                        self.expect(Kind::Name)?;
                        if self.is(Kind::ParenL) {
                            self.unit(|this| {
                                this.parenthesized(Item::InputValueDefinition, true)?;
                                this.type_and_default_value(false)
                            })?;
                        } else {
                            self.type_and_default_value(false)?;
                        }
                    }
                }
                Block::InputFields => {
                    self.description(true)?;
                    if !self.plain_field() {
                        self.expect(Kind::Name)?;
                        self.type_and_default_value(true)?;
                    }
                }
                Block::EnumValues => {
                    self.description(false)?;
                    if matches!(self.token_text(), b"true" | b"false" | b"null") {
                        return Err(Refusal::Definition);
                    }
                    self.expect(Kind::Name)?;
                    self.directives_to_end_of_line(true)?;
                }
                Block::OperationTypes => {
                    if !matches!(self.token_text(), b"query" | b"mutation" | b"subscription") {
                        return Err(Refusal::Definition);
                    }
                    self.expect(Kind::Name)?;
                    self.expect(Kind::Colon)?;
                    self.space();
                    self.expect(Kind::Name)?;
                }
            }
            let is_last = self.is(Kind::BraceR);
            self.end_item(is_last, true)?;
            if is_last {
                break;
            }
        }
        self.level -= 1;
        self.nesting -= 1;
        self.break_line(1);
        self.take()
    }

    fn selection(&mut self) -> Result {
        let has_block = if let Some(has_block) = self.plain_selection() {
            has_block
        } else if self.is(Kind::Spread) {
            self.take()?;
            let has_type_condition = self.is_keyword(b"on");
            let is_spread = self.is(Kind::Name) && !has_type_condition;
            if is_spread {
                self.take()?;
            } else if has_type_condition {
                self.space();
                self.take()?;
                self.space();
                self.expect(Kind::Name)?;
            }
            let has_block = self.arguments_to_end_of_line(is_spread)?;
            if has_block == is_spread {
                return Err(Refusal::Definition);
            }
            has_block
        } else {
            self.expect(Kind::Name)?;
            if self.is(Kind::Colon) {
                self.take()?;
                self.space();
                self.expect(Kind::Name)?;
            }
            self.arguments_to_end_of_line(true)?
        };
        match has_block {
            true => self.block(Block::Selections),
            false => Ok(()),
        }
    }

    /// `(a: 1) @b {`, each of which can be missing. Returns true if there's a `{`.
    fn arguments_to_end_of_line(&mut self, can_have_arguments: bool) -> Result<bool> {
        let brace = |this: &mut Self| {
            let has_brace = this.is(Kind::BraceL);
            if has_brace {
                this.space();
                this.take()?;
            }
            Ok(has_brace)
        };
        match self.token.kind {
            Kind::ParenL if can_have_arguments => {}
            Kind::At => {}
            _ => return brace(self),
        }
        self.unit(|this| {
            this.parenthesized(Item::NamedValue { is_const: false }, true)?;
            this.directives(false, false)?;
            brace(this)
        })
    }

    /// Directives that end their line.
    fn directives_to_end_of_line(&mut self, is_const: bool) -> Result {
        match self.is(Kind::At) && !self.is_in_unit() {
            true => self.unit(|this| this.directives(is_const, false).map(|_| ())),
            false => self.directives(is_const, false).map(|_| ()),
        }
    }

    /// `: A = b @c`, which ends its line or is in a group.
    fn type_and_default_value(&mut self, can_have_default_value: bool) -> Result {
        self.expect(Kind::Colon)?;
        self.space();
        self.type_reference()?;
        if !(can_have_default_value && self.is(Kind::Equals)) {
            return self.directives_to_end_of_line(true);
        }
        let rest = |this: &mut Self| {
            this.space();
            this.take()?;
            this.space();
            this.value(true)?;
            this.directives(true, false)?;
            Ok(())
        };
        match self.is_in_unit() {
            true => rest(self),
            false => self.unit(rest),
        }
    }

    fn type_reference(&mut self) -> Result {
        let mut lists = 0;
        while self.is(Kind::BracketL) {
            self.take()?;
            lists += 1;
        }
        if lists > MAX_NESTING {
            return Err(Refusal::Text);
        }
        self.expect(Kind::Name)?;
        loop {
            if self.is(Kind::Bang) {
                self.take()?;
            }
            if lists == 0 {
                return Ok(());
            }
            self.expect(Kind::BracketR)?;
            lists -= 1;
        }
    }

    /// `(a, b)`, if there is one. `keeps_empty_lines` selects Prettier's `printSequence`.
    fn parenthesized(&mut self, item: Item, keeps_empty_lines: bool) -> Result {
        match self.is(Kind::ParenL) {
            true => self.list(item, Kind::ParenR, keeps_empty_lines),
            false => Ok(()),
        }
    }

    /// A group of an opening bracket, which is the next token, items, and the bracket `close`.
    fn list(&mut self, item: Item, close: Kind, keeps_empty_lines: bool) -> Result {
        self.nesting += 1;
        if self.nesting > MAX_NESTING || !self.stack.is_safe_to_recurse() {
            return Err(Refusal::Text);
        }
        if self.is_document || self.groups > 0 {
            self.list_as_group(item, close, keeps_empty_lines)?;
        } else if self.list_is_too_wide() {
            self.list_on_lines(item, close, keeps_empty_lines)?;
        } else {
            let (mark, had_group) = (self.mark(), self.has_group);
            match self
                .list_as_group(item, close, keeps_empty_lines)
                .and_then(|()| self.check_column())
            {
                // Whatever follows the group, it doesn't fit, or has a forced line break in it.
                Err(Refusal::Layout) => {
                    self.reset(&mark);
                    self.has_group = had_group;
                    self.list_on_lines(item, close, keeps_empty_lines)?;
                }
                result => result?,
            }
        }
        self.nesting -= 1;
        Ok(())
    }

    /// True if the tokens from the bracket that's the next token to the one that closes it are wider than what's left of
    /// the line, or one of them forces a line break. Saves writing most lists that don't fit twice.
    fn list_is_too_wide(&self) -> bool {
        // Where the bracket is going to be written, at the least.
        let column = match self.gap {
            Gap::Lines => self.gap_level as usize * self.tab_width,
            _ => self.column(),
        };
        let room = self.width.saturating_sub(column);
        let (mut width, mut depth) = (0, 0u32);
        for token in self.tokens.get(self.index..).unwrap_or_default() {
            width += match token.kind {
                Kind::Comment | Kind::BlockString => return true,
                Kind::End | Kind::Invalid => return false,
                // They can be printed narrower than they're written.
                Kind::StringToMeasure | Kind::StringWithEscapes => 2,
                _ => (token.end - token.start) as usize,
            };
            match token.kind {
                Kind::ParenL | Kind::BracketL | Kind::BraceL => depth += 1,
                Kind::ParenR | Kind::BracketR | Kind::BraceR => depth = depth.saturating_sub(1),
                _ => {}
            }
            if width > room {
                return true;
            }
            if depth == 0 {
                return false;
            }
        }
        false
    }

    fn list_as_group(&mut self, item: Item, close: Kind, keeps_empty_lines: bool) -> Result {
        self.start_group();
        self.take()?;
        self.break_group_at_comment()?;
        let has_space = close == Kind::BraceR && self.bracket_spacing && !self.is(close);
        if has_space {
            self.space();
        }
        if close == Kind::ParenR || !self.is(close) {
            self.start_indent();
            self.soft_line();
            loop {
                self.item(item)?;
                self.break_group_at_comment()?;
                if self.is(close) {
                    break;
                }
                if keeps_empty_lines && self.is_next_line_empty() {
                    self.hard_lines(1)?;
                    self.soft_line();
                } else {
                    self.separator()?;
                }
            }
            self.end_indent();
        }
        self.soft_line();
        if has_space {
            self.if_flat(" ", Gap::Space);
        }
        self.take()?;
        self.end_group();
        Ok(())
    }

    /// A comment between the brackets of a list is printed with a forced line break.
    fn break_group_at_comment(&self) -> Result {
        match self.comment != NO_COMMENT && !self.is_document {
            true => Err(Refusal::Layout),
            false => Ok(()),
        }
    }

    /// The same where the group is known to break, straight to the output.
    fn list_on_lines(&mut self, item: Item, close: Kind, keeps_empty_lines: bool) -> Result {
        self.take()?;
        self.level += 1;
        self.hard_lines(1)?;
        self.comments_before_first_item(true)?;
        loop {
            self.unit(|this| this.item(item))?;
            if self.is(close) {
                break;
            }
            self.end_item(false, keeps_empty_lines)?;
        }
        self.level -= 1;
        self.break_line(1);
        self.take()
    }

    fn item(&mut self, item: Item) -> Result {
        match item {
            Item::NamedValue { is_const } => {
                self.expect(Kind::Name)?;
                self.expect(Kind::Colon)?;
                self.space();
                self.value(is_const)
            }
            Item::Value { is_const } => self.value(is_const),
            Item::VariableDefinition => {
                self.description(false)?;
                self.expect(Kind::Dollar)?;
                self.expect(Kind::Name)?;
                self.type_and_default_value(true)
            }
            Item::InputValueDefinition => {
                self.description(true)?;
                if self.plain_field() {
                    return Ok(());
                }
                self.expect(Kind::Name)?;
                self.type_and_default_value(true)
            }
        }
    }

    fn value(&mut self, is_const: bool) -> Result {
        match self.token.kind {
            Kind::Name | Kind::Number => self.take(),
            Kind::String | Kind::StringToMeasure | Kind::StringWithEscapes => self.string(),
            Kind::BlockString => self.block_string(),
            Kind::Dollar if !is_const => {
                self.take()?;
                self.expect(Kind::Name)
            }
            Kind::BracketL => self.list(Item::Value { is_const }, Kind::BracketR, false),
            Kind::BraceL => self.list(Item::NamedValue { is_const }, Kind::BraceR, false),
            _ => Err(Refusal::Definition),
        }
    }

    /// Prettier's `printDirectives`. Returns true if there are any. `is_of_executable_definition`: they're those of an
    /// operation or a fragment.
    fn directives(&mut self, is_const: bool, is_of_executable_definition: bool) -> Result<bool> {
        if !self.is(Kind::At) {
            return Ok(false);
        }
        if is_of_executable_definition {
            self.start_group();
            self.line()?;
        } else {
            self.space();
            self.start_group();
            self.start_indent();
            self.soft_line();
        }
        loop {
            self.take()?;
            self.expect(Kind::Name)?;
            self.parenthesized(Item::NamedValue { is_const }, true)?;
            if !self.is(Kind::At) {
                break;
            }
            self.line()?;
        }
        if !is_of_executable_definition {
            self.end_indent();
        }
        self.end_group();
        Ok(true)
    }

    /// ` implements A & B`. Returns true if it's there.
    fn interfaces(&mut self) -> Result<bool> {
        if !self.is_keyword(b"implements") {
            return Ok(false);
        }
        self.space();
        self.take()?;
        self.space();
        self.start_indent();
        self.start_group();
        if self.is(Kind::Amp) {
            self.skip()?;
        }
        loop {
            self.expect(Kind::Name)?;
            if !self.is(Kind::Amp) {
                break;
            }
            self.space();
            self.take()?;
            self.line()?;
        }
        self.end_group();
        self.end_indent();
        Ok(true)
    }

    /// ` = A | B`. Returns true if it's there.
    fn union_members(&mut self) -> Result<bool> {
        if !self.is(Kind::Equals) {
            return Ok(false);
        }
        self.space();
        self.take()?;
        self.if_flat(" ", Gap::Space);
        self.start_indent();
        if self.is(Kind::Pipe) {
            self.skip()?;
        }
        if self.is_document {
            self.elements.start_if_break(0);
            self.elements.line(Line::Space);
            self.elements.token("| ");
            self.elements.otherwise();
            self.elements.end_if_break();
        }
        loop {
            self.expect(Kind::Name)?;
            if !self.is(Kind::Pipe) {
                break;
            }
            self.line()?;
            self.take()?;
            self.space();
        }
        self.end_indent();
        Ok(true)
    }

    // ───────────────────────────── strings ─────────────────────────────

    /// Prettier's `printDescription`. Returns true if there is one.
    fn description(&mut self, is_of_input_value: bool) -> Result<bool> {
        match self.token.kind {
            Kind::String | Kind::StringToMeasure | Kind::StringWithEscapes => {
                self.string()?;
                match is_of_input_value {
                    true => self.line()?,
                    false => self.hard_lines(1)?,
                }
            }
            Kind::BlockString => {
                self.block_string()?;
                self.hard_lines(1)?;
            }
            _ => return Ok(false),
        }
        Ok(true)
    }

    fn string(&mut self) -> Result {
        if self.comment != NO_COMMENT {
            return Err(Refusal::Definition);
        }
        let raw = self.token_text();
        if !self.is(Kind::StringWithEscapes) {
            if self.is(Kind::StringToMeasure) {
                self.measure(raw)?;
            }
            self.put(self.token.start as usize, self.token.end as usize);
        } else {
            self.buffer.clear();
            write_string_with_escapes(raw, self.buffer);
            // An escape sequence can stand for a line break.
            if self.buffer.iter().any(u8::is_ascii_control) {
                return Err(Refusal::Definition);
            }
            let value = std::mem::take(self.buffer);
            let measured = self.measure(&value);
            *self.buffer = value;
            measured?;
            self.put_buffer();
        }
        self.read_token();
        Ok(())
    }

    /// See `Builder::block_string`. What that doesn't print the way Prettier does is left to it.
    fn block_string(&mut self) -> Result {
        if self.comment != NO_COMMENT {
            return Err(Refusal::Definition);
        }
        let (start, end) = (self.token.start as usize, self.token.end as usize);
        let text = self.text;
        let is_space_or_tab = |byte: &u8| matches!(byte, b' ' | b'\t');
        let (content_start, content_end) = (start + 3, end - 3);

        // Written the way it's printed: the quotes on lines of their own, and everything at its indentation.
        if !self.is_document
            && self.groups == 0
            && self.has_only_spaces
            && self.token.indentation != NOT_ON_LINES
            && self.token.indentation as usize == self.indentation_len(self.level)
        {
            self.put(start, end);
            self.line_start = self.printer.out.len() + (content_end - self.run_start);
            self.line_indent = self.level as usize * self.tab_width;
            self.read_token();
            return Ok(());
        }

        // graphql-js's `dedentBlockStringLines`
        self.lines.clear();
        let (mut common_indent, mut first, mut last) = (usize::MAX, usize::MAX, 0);
        let mut line_start = content_start;
        loop {
            let rest = text.get(line_start..content_end).unwrap_or_default();
            let len = strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
            let indent = rest[..len]
                .iter()
                .take_while(|byte| is_space_or_tab(byte))
                .count();
            if indent < len {
                let index = self.lines.len();
                if index > 0 {
                    common_indent = common_indent.min(indent);
                }
                (first, last) = (first.min(index), index);
            }
            (self.lines).push((line_start as u32, (line_start + len) as u32));
            line_start += len + 1;
            if len == rest.len() {
                break;
            }
        }
        let starts_with_space = text.get(content_start).is_some_and(is_space_or_tab);
        if first == 0 && last == 0 && starts_with_space {
            return Err(Refusal::Definition);
        }

        self.put(start, start + 3);
        let mut line_breaks = 1;
        for index in first..(last + 1).min(self.lines.len()) {
            let (mut line_start, line_end) = self.lines[index];
            if index > 0 {
                line_start = (line_start as usize)
                    .saturating_add(common_indent)
                    .min(line_end as usize) as u32;
            }
            if line_start == line_end {
                line_breaks += 1;
                continue;
            }
            if text.get(line_end as usize - 1).is_some_and(is_space_or_tab) {
                return Err(Refusal::Definition);
            }
            self.hard_lines(line_breaks)?;
            self.put(line_start as usize, line_end as usize);
            line_breaks = 1;
        }
        self.hard_lines(1)?;
        self.put(content_end, end);
        self.read_token();
        Ok(())
    }
}
