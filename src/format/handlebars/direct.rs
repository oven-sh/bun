//! The short cut: a template is printed while it's read, without tokens, tree or document.
//!
//! Most of a template is written in a small part of the language: elements with plain attributes, words, mustaches and
//! blocks with paths, strings and numbers, comments. For that part, one scan has the grammar, the rules of
//! `printer.rs` and what `css/doc.rs` makes of its document, in closed form. **It's a second implementation of all
//! three: whoever changes a rule there changes it here, or makes this refuse.**
//!
//! - **A group is written on one line first** ([`Mode::Flat`]). If that doesn't fit together with what follows it up to
//!   the next possible line break ([`Rest`]), what has been written is taken back and the group is written again with
//!   its line breaks ([`Mode::Free`]), in which the groups in it decide for themselves. If the source has a line break
//!   where the group has its first one, it's the other way round: see [`Direct::group`].
//! - **The children of an element, a block or the template** are a group too. Only white space between two nodes depends
//!   on it, so nothing is decided before the first such white space: [`Direct::free_list`].
//! - **What isn't certain is refused**, and goes the long way by itself. Nodes with white space in front of them and
//!   behind them, among children that are on several lines, are printed between two line breaks. So what is printed for
//!   them depends on their text, the indentation and the options alone: [`Direct::delegate`] parses them as a template
//!   of their own. If that isn't possible either, so is what is around them, up to the whole template.
//! - **What is written is compared with the source**, and is copied only where the two differ: [`Direct::copy`],
//!   [`Direct::put`]. A template that is formatted is copied once, at the end.

use super::ast::Kind;
use super::lexer::{TokenKind, delimited_len};
use super::printer::{Printer, is_plain_value};
use super::tokenizer::is_void_tag;
use super::{Scratch, parse};
use crate::FormatOptions;
use crate::css::doc;
use crate::ir::width::{is_all_printable, string_width};
use crate::options::{HtmlWhitespaceSensitivity, IndentStyle, LineEnding, QuoteStyle};
use crate::stack::Stack;
use crate::syntax_error::Rejection;
use bun_core::strings;
use bun_highway::ScannerStops;

/// Elements, blocks and sub-expressions that are nested deeper go the long way, which says what is nested too deeply.
const MAX_DEPTH: usize = 128;

/// ` `, `\n`, `\t`
const SPACE: u8 = 1;
/// A byte of a word in a text, but for `{`.
const WORD: u8 = 1 << 1;
/// A byte of a name in a path.
const NAME: u8 = 1 << 2;
/// A byte of the name of a tag or an attribute.
const TAG: u8 = 1 << 3;
/// A byte of a string or of the value of an attribute that's printed as it is and is one column wide.
const PLAIN: u8 = 1 << 4;

const CLASSES: [u8; 256] = {
    let mut classes = [0; 256];
    let mut byte = 0x21;
    while byte < 0x7F {
        classes[byte] = WORD | PLAIN;
        if (byte as u8).is_ascii_alphanumeric() {
            classes[byte] |= NAME | TAG;
        }
        byte += 1;
    }
    while byte < 0x100 {
        if byte >= 0x80 {
            classes[byte] = WORD;
        }
        byte += 1;
    }
    classes[b' ' as usize] = SPACE | PLAIN;
    classes[b'\n' as usize] = SPACE;
    classes[b'\t' as usize] = SPACE;
    classes[b'<' as usize] &= !WORD;
    classes[b'{' as usize] &= !(WORD | PLAIN);
    classes[b'\\' as usize] &= !(WORD | PLAIN);
    classes[b'"' as usize] &= !PLAIN;
    classes[b'\'' as usize] &= !PLAIN;
    classes[b'_' as usize] |= NAME | TAG;
    classes[b'-' as usize] |= NAME | TAG;
    classes[b'$' as usize] |= NAME | TAG;
    classes[b'?' as usize] |= NAME;
    classes[b':' as usize] |= NAME | TAG;
    classes[b'.' as usize] |= TAG;
    classes[b'@' as usize] |= TAG;
    classes
};

#[inline(always)]
fn is(byte: u8, class: u8) -> bool {
    CLASSES[byte as usize] & class != 0
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Stop {
    /// What is being written on one line doesn't fit on it, or has a forced line break in it.
    Breaks,
    /// It isn't certain what is printed here.
    Refused,
    /// The whole template goes the long way.
    GivenUp,
}

type Written = Result<(), Stop>;

#[derive(Copy, Clone, PartialEq, Eq)]
enum Mode {
    /// In a group that's printed on one line.
    Flat,
    /// In groups that are broken. A group that starts here is measured.
    Free,
}

/// What follows a group up to the next possible line break.
#[derive(Copy, Clone)]
enum Rest {
    /// This many columns.
    Columns(usize),
    /// The nodes that come next in the source.
    Nodes,
}

#[derive(Copy, Clone, PartialEq, Eq)]
enum Parent {
    Template,
    Element,
    Block,
}

/// What is at a place between two nodes.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Next {
    Space,
    /// What ends the children of such a parent.
    End(Parent),
    Comment,
    Element,
    MustacheComment,
    Block,
    Mustache,
    Text,
}

/// What starts with `{{`.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Braces {
    /// `{{/a}}`, `{{else}}`, `{{else a}}`, `{{^}}`
    End,
    Comment,
    Block,
    Mustache,
}

/// Where the reader and the writer are, to come back to.
#[derive(Copy, Clone)]
struct Mark {
    at: usize,
    len: usize,
    run: (usize, usize),
    column: usize,
    flat: usize,
    lines: usize,
}

struct Direct<'a, 'o> {
    source: &'a [u8],
    /// Where runs of bytes end in `source`, so that no loop reads them one by one.
    stops: ScannerStops<'a>,
    options: &'a FormatOptions,
    scratch: &'a mut Scratch,
    /// Prints what goes the long way. Everything is written to its `out`.
    printer: doc::Printer<'o>,
    /// The printer's indentation for each level.
    indents: Vec<u32>,
    /// A line feed and as much indentation as was needed so far.
    line_start: Vec<u8>,
    /// The text that `delegate_head` parses.
    head: Vec<u8>,
    at: usize,
    /// The part of the source that's written but not copied yet.
    run: (usize, usize),
    column: usize,
    /// The columns of all that has been written, if it were on one line.
    flat: usize,
    /// The number of line breaks that have been written.
    lines: usize,
    width: usize,
    tab_width: usize,
    /// The bytes of one level of indentation.
    unit: usize,
    use_tabs: bool,
    /// The quote of a string in a mustache and of the value of an attribute.
    quote: u8,
    /// The quote of a string in a mustache in the quoted value of an attribute.
    other_quote: u8,
    depth: usize,
    stack: Stack,
    /// Set by `start_tag`.
    is_void: bool,
    /// What `end_of_nodes` found the last time it returned `None`: whole nodes from `.0` to `.1`, where the list
    /// that they are in ends, or nothing.
    known: (usize, Option<usize>),
    is_too_long: bool,
}

/// Appends the formatted `text`, which has no `\r`, no byte order mark and no front matter, to `out`. Returns false, and
/// leaves `out` as it is, if it has to go the long way.
pub(super) fn format(
    text: &[u8],
    original: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    out: &mut Vec<u8>,
) -> bool {
    if matches!(
        options.html_whitespace_sensitivity,
        HtmlWhitespaceSensitivity::Ignore
    ) || options.is_in_markdown
        || options.tailwind.is_some()
        || !matches!(options.line_ending.resolve(original), LineEnding::Lf)
        || text.len() > i32::MAX as usize
    {
        return false;
    }
    let len = out.len();
    let is_single = matches!(options.quote_style, QuoteStyle::Single);
    let use_tabs = matches!(options.indent_style, IndentStyle::Tab);
    let tab_width = options.indent_width.value() as usize;
    // The long way makes the indentation of each line that could start in a group, and fails if that's too long for a
    // string, whether or not a line starts there. What's open adds a few levels each.
    if !use_tabs && crate::is_too_long(tab_width.saturating_mul(8 * MAX_DEPTH)) {
        return false;
    }
    let line_start = std::mem::take(&mut scratch.line_start);
    // White space at the end of a template isn't printed, and neither is white space at its start in front of a node.
    let source = text.trim_ascii_end();
    let first = source.len() - source.trim_ascii_start().len();
    let starts_with_node = source[first..].starts_with(b"<") || source[first..].starts_with(b"{{");
    let at = if starts_with_node { first } else { 0 };
    // An escaped mustache is a text of its own.
    if first > 0 && source[first..].starts_with(b"\\") {
        return false;
    }
    let mut stops = std::mem::take(&mut scratch.stops);
    let mut direct = Direct {
        source,
        stops: stops.find(source),
        options,
        scratch,
        printer: doc::Printer::new(options, original, out),
        indents: vec![0],
        line_start,
        head: Vec::new(),
        at,
        run: (at, at),
        column: 0,
        flat: 0,
        lines: 0,
        width: options.line_width.value() as usize,
        tab_width,
        unit: if use_tabs { 1 } else { tab_width },
        use_tabs,
        quote: if is_single { b'\'' } else { b'"' },
        other_quote: if is_single { b'"' } else { b'\'' },
        depth: 0,
        stack: Stack::new(),
        is_void: false,
        known: (usize::MAX, None),
        is_too_long: false,
    };
    if direct.line_start.first() != Some(&b'\n')
        || direct.line_start.get(1) != Some(if use_tabs { &b'\t' } else { &b' ' })
    {
        direct.line_start.clear();
        direct.line_start.push(b'\n');
        direct
            .line_start
            .resize(65, if use_tabs { b'\t' } else { b' ' });
    }
    let result = direct.free_list(0, Parent::Template);
    direct.flush();
    let is_done = result.is_ok()
        && !direct.is_too_long
        && !crate::is_too_long(direct.printer.out.len())
        && direct.printer.result().is_ok();
    direct.scratch.line_start = std::mem::take(&mut direct.line_start);
    scratch.stops = stops;
    if !is_done {
        out.truncate(len);
    }
    is_done
}

impl<'a> Direct<'a, '_> {
    // ───────────────────────────── reading ─────────────────────────────

    /// The byte at `at`, or 0 behind the end, which is in no class.
    #[inline(always)]
    fn byte(&self, at: usize) -> u8 {
        match self.source.get(at) {
            Some(byte) => *byte,
            None => 0,
        }
    }

    #[inline]
    fn starts_with(&self, at: usize, text: &[u8]) -> bool {
        self.source
            .get(at..)
            .is_some_and(|rest| rest.starts_with(text))
    }

    fn slice(&self, start: usize, end: usize) -> &'a [u8] {
        self.source.get(start..end).unwrap_or_default()
    }

    /// Returns the end of the white space at `at`, and the number of line feeds in it.
    #[inline]
    fn white_space(&self, mut at: usize) -> (usize, usize) {
        let mut line_feeds = 0;
        loop {
            while self.byte(at) == b'\n' {
                line_feeds += 1;
                at += 1;
            }
            let end = self.stops.after_blanks.next(at);
            if self.byte(end) != b'\n' {
                return (end, line_feeds);
            }
            at = end;
        }
    }

    #[inline]
    fn skip_space(&self, at: usize) -> usize {
        if !is(self.byte(at), SPACE) {
            return at;
        }
        if !is(self.byte(at + 1), SPACE) {
            return at + 1;
        }
        self.white_space(at).0
    }

    /// Returns the end of the bytes of `class` at `at`. `class` is `NAME`, `TAG` or both: letters, digits, `_` and `$`
    /// are in it.
    #[inline]
    fn end_of(&self, mut at: usize, class: u8) -> usize {
        loop {
            at = self.stops.after_name.next(at);
            if !is(self.byte(at), class) {
                return at;
            }
            at += 1;
        }
    }

    /// Returns the end of the bytes of the class `PLAIN` at `start`.
    #[inline]
    fn end_of_plain(&self, start: usize) -> usize {
        let mut at = start;
        loop {
            at = self.stops.in_string.next(at);
            if !matches!(self.byte(at), b'$' | b'`') {
                break;
            }
            at += 1;
        }
        if has_brace(self.slice(start, at)) {
            at = start;
            while is(self.byte(at), PLAIN) {
                at += 1;
            }
        }
        at
    }

    /// True if `source[start..end]`, which is of the class `PLAIN` and not empty, is a list of classes as it's printed:
    /// one blank between two of them, and nowhere else.
    #[inline]
    fn is_list_of_classes(&self, start: usize, end: usize) -> bool {
        if end - start > 56 {
            return is_plain_value(self.slice(start, end), true);
        }
        let blanks = !self.stops.after_blanks.window(start) & ((1 << (end - start)) - 1);
        blanks & (blanks >> 1 | 1 | 1 << (end - start - 1)) == 0
    }

    #[inline]
    fn is_at_braces(&self, at: usize) -> bool {
        self.byte(at) == b'{' && self.byte(at + 1) == b'{'
    }

    /// True if the lexer reads `else` at `at`, behind `{{`, as the keyword.
    fn is_else(&self, at: usize) -> bool {
        self.starts_with(at, b"else") && {
            let next = self.byte(at + 4);
            !(next.is_ascii_alphanumeric() || next == b'_')
        }
    }

    /// `at` is at `{{`.
    fn braces(&self, at: usize) -> Braces {
        let next = if self.byte(at + 2) == b'~' {
            at + 3
        } else {
            at + 2
        };
        match self.byte(next) {
            b'!' => Braces::Comment,
            b'#' => Braces::Block,
            b'/' | b'^' => Braces::End,
            b'e' | b' ' | b'\n' | b'\t' if self.is_else(self.skip_space(next)) => Braces::End,
            _ => Braces::Mustache,
        }
    }

    /// Returns the end of the path at `at` if it's printed as it's written: names with dots between them, after `@` or
    /// `this.` or not, none of which can be taken for something else. See `is_as_written` in `parser.rs`.
    fn path(&self, mut at: usize) -> Result<usize, Stop> {
        let is_data = self.byte(at) == b'@';
        if is_data {
            at += 1;
        }
        let mut is_first = true;
        loop {
            let start = at;
            let first = self.byte(at);
            if !(first.is_ascii_alphabetic() || first == b'_') {
                return Err(Stop::Refused);
            }
            at = self.end_of(at + 1, NAME);
            if matches!(first, b't' | b'f' | b'n' | b'u' | b'e') {
                match self.slice(start, at) {
                    b"true" | b"false" | b"null" | b"undefined" | b"else" => {
                        return Err(Stop::Refused);
                    }
                    b"this" if !is_first || is_data => return Err(Stop::Refused),
                    _ => {}
                }
            }
            if self.byte(at) != b'.' {
                return Ok(at);
            }
            at += 1;
            is_first = false;
        }
    }

    /// True if `expr* hash?` ends at `at`, which isn't at white space.
    fn ends_params(&self, at: usize) -> bool {
        match self.byte(at) {
            b'}' | b')' | b'~' => true,
            b'a' if self.byte(at + 1) == b's' => {
                let bar = self.skip_space(at + 2);
                bar > at + 2 && self.byte(bar) == b'|'
            }
            _ => false,
        }
    }

    /// True if a string, a number, a path or a sub-expression can end in front of `byte`.
    fn ends_param(byte: u8) -> bool {
        matches!(byte, b' ' | b'\n' | b'\t' | b')' | b'}' | b'~')
    }

    #[inline]
    fn starts_word(&self, at: usize) -> bool {
        let byte = self.byte(at);
        is(byte, WORD) || (byte == b'{' && self.byte(at + 1) != b'{')
    }

    /// True if a text ends at `at`.
    #[inline]
    fn ends_text(&self, at: usize) -> bool {
        at >= self.source.len() || self.byte(at) == b'<' || self.is_at_braces(at)
    }

    /// Returns the end and the width of the word at `at`.
    #[inline]
    fn word(&self, start: usize) -> Result<(usize, usize), Stop> {
        let mut at = start;
        let mut all = 0;
        loop {
            at = self.stops.after_name.next(at);
            let byte = self.byte(at);
            if !is(byte, WORD) && !(byte == b'{' && self.starts_word(at)) {
                break;
            }
            all |= byte;
            at += 1;
        }
        if at == start {
            return Err(Stop::Refused);
        }
        let width = match all < 0x80 {
            true => at - start,
            false => string_width(self.slice(start, at)) as usize,
        };
        Ok((at, width))
    }

    /// The width of a text that's printed as it is, line feeds and all.
    fn width_of(&self, start: usize, end: usize) -> Result<usize, Stop> {
        let text = self.slice(start, end);
        if is_all_printable(text) {
            return Ok(text.len());
        }
        match strings::contains_char(text, 0) {
            true => Err(Stop::Refused),
            false => Ok(string_width(text) as usize),
        }
    }

    // ───────────────────────────── writing ─────────────────────────────

    fn mark(&self) -> Mark {
        Mark {
            at: self.at,
            len: self.printer.out.len(),
            run: self.run,
            column: self.column,
            flat: self.flat,
            lines: self.lines,
        }
    }

    fn reset(&mut self, mark: Mark) {
        self.printer.out.truncate(mark.len);
        self.at = mark.at;
        self.run = mark.run;
        self.column = mark.column;
        self.flat = mark.flat;
        self.lines = mark.lines;
    }

    #[inline(never)]
    fn flush(&mut self) {
        let (start, end) = self.run;
        self.printer
            .out
            .extend_from_slice(self.source.get(start..end).unwrap_or_default());
        self.run.0 = end;
    }

    /// Writes `source[start..end]`, which is `width` columns wide.
    #[inline]
    fn copy_wide(&mut self, start: usize, end: usize, width: usize) {
        if self.run.1 != start {
            self.flush();
            self.run.0 = start;
        }
        self.run.1 = end;
        self.column += width;
        self.flat += width;
    }

    /// Writes `source[start..end]`, which is printable ASCII.
    #[inline]
    fn copy(&mut self, start: usize, end: usize) {
        self.copy_wide(start, end, end - start);
    }

    /// Writes `text`, which is printable ASCII.
    #[inline]
    fn put(&mut self, text: &[u8]) {
        let (start, end) = self.run;
        if start < end && self.starts_with(end, text) {
            self.run.1 = end + text.len();
        } else {
            self.flush();
            self.printer.out.extend_from_slice(text);
        }
        self.column += text.len();
        self.flat += text.len();
    }

    #[inline]
    fn put_byte(&mut self, byte: u8) {
        let (start, end) = self.run;
        if start < end && self.byte(end) == byte {
            self.run.1 = end + 1;
        } else {
            self.flush();
            self.printer.out.push(byte);
        }
        self.column += 1;
        self.flat += 1;
    }

    /// Writes a line break. On one line it would be `flat` columns.
    #[inline]
    fn new_line(&mut self, level: usize, flat: usize) {
        let len = level * self.unit;
        let (start, end) = self.run;
        if start < end && self.byte(end) == b'\n' && self.is_indentation(end + 1, len) {
            self.run.1 = end + 1 + len;
        } else {
            self.write_new_line(len);
        }
        self.column = level * self.tab_width;
        self.flat += flat;
        self.lines += 1;
    }

    /// True if the source has `len` bytes of indentation at `at`.
    #[inline]
    fn is_indentation(&self, at: usize, len: usize) -> bool {
        match self.use_tabs {
            // Blanks, none of which is a control character.
            false => {
                self.stops.after_blanks.next(at) >= at + len
                    && self.stops.in_string.next(at) >= at + len
            }
            true => {
                self.slice(at, at + len).iter().all(|byte| *byte == b'\t')
                    && at + len <= self.source.len()
            }
        }
    }

    #[inline(never)]
    fn write_new_line(&mut self, len: usize) {
        self.flush();
        if len >= self.line_start.len() {
            self.grow_line_start(len + 1);
        }
        if crate::is_too_long(self.printer.out.len()) {
            self.is_too_long = true;
        }
        if !self.is_too_long {
            let line_start = self.line_start.get(..len + 1).unwrap_or_default();
            self.printer.out.extend_from_slice(line_start);
        }
    }

    #[cold]
    fn grow_line_start(&mut self, len: usize) {
        let byte = self.line_start.get(1).copied().unwrap_or(b' ');
        if crate::is_too_long(len) {
            self.is_too_long = true;
        } else {
            self.line_start.resize(len, byte);
        }
    }

    /// `line`
    #[inline]
    fn line(&mut self, mode: Mode, level: usize) {
        match mode {
            Mode::Flat => self.put_byte(b' '),
            Mode::Free => self.new_line(level, 1),
        }
    }

    /// `softline`
    #[inline]
    fn soft_line(&mut self, mode: Mode, level: usize) {
        if mode == Mode::Free {
            self.new_line(level, 0);
        }
    }

    /// The white space `source[start..end]`, with that many line feeds, between two nodes of a list that's broken.
    #[inline]
    fn breaks(&mut self, (start, end): (usize, usize), line_feeds: usize, level: usize) {
        let len = level * self.unit;
        // As it's printed: the line feeds, one or two, and then blanks, none of which is a control character.
        if self.run.1 == start
            && self.run.0 < start
            && end - start == line_feeds + len
            && matches!(line_feeds, 1 | 2)
            && self.byte(start + line_feeds - 1) == b'\n'
            && self.byte(start) == b'\n'
            && !self.use_tabs
            && (len == 0 || self.stops.in_string.next(start + line_feeds) >= end)
        {
            self.run.1 = end;
            self.column = level * self.tab_width;
            self.flat += 1;
            self.lines += line_feeds;
            return;
        }
        if line_feeds > 1 {
            self.new_line(0, 0);
        }
        self.new_line(level, 1);
    }

    /// In `Mode::Flat`: what has been written has to fit.
    #[inline]
    fn check(&self, mode: Mode) -> Written {
        match mode == Mode::Flat && self.column > self.width {
            true => Err(Stop::Breaks),
            false => Ok(()),
        }
    }

    fn enter(&mut self) -> Written {
        if self.depth >= MAX_DEPTH || !self.stack.has_room() {
            return Err(Stop::Refused);
        }
        self.depth += 1;
        Ok(())
    }

    // ───────────────────────────── groups ─────────────────────────────

    /// True if what follows a group that ends at `column` fits on its line.
    fn fits(&self, column: usize, rest: Rest) -> Result<bool, Stop> {
        match rest {
            Rest::Columns(columns) => Ok(column + columns <= self.width),
            Rest::Nodes => self.nodes_fit(column),
        }
    }

    /// What `fits` in `css/doc.rs` does with the rest of the document, which is in broken groups: the first `line`
    /// of any kind ends it. There's one in all white space, behind the name of a start tag and of a block, and behind the
    /// path of a mustache with parameters.
    fn nodes_fit(&self, column: usize) -> Result<bool, Stop> {
        let Some(mut room) = self.width.checked_sub(column) else {
            return Ok(false);
        };
        let mut at = self.at;
        loop {
            let byte = self.byte(at);
            let mut is_last = false;
            let (end, width) = if is(byte, SPACE) || at >= self.source.len() {
                return Ok(true);
            } else if byte == b'<' {
                match self.byte(at + 1) {
                    b'/' => {
                        let end = self.end_of(at + 2, TAG);
                        if self.byte(end) != b'>' {
                            return Err(Stop::Refused);
                        }
                        (end + 1, end + 1 - at)
                    }
                    b'!' => self.comment_at(at)?,
                    _ => {
                        is_last = true;
                        let end = self.end_of(at + 1, TAG);
                        (end, end - at)
                    }
                }
            } else if self.is_at_braces(at) {
                let kind = self.braces(at);
                if kind == Braces::Comment {
                    let comment = self.mustache_comment_at(at)?;
                    (comment.end, comment.width)
                } else {
                    let mut open = at + 2;
                    open += usize::from(self.byte(open) == b'~');
                    let mut width = open - at;
                    if kind == Braces::End && self.byte(open) != b'/' {
                        // `{{else}}` or `{{else a b}}`
                        let word = self.skip_space(open);
                        if !self.is_else(word) {
                            return Err(Stop::Refused);
                        }
                        width += 4;
                        let next = self.skip_space(word + 4);
                        if matches!(self.byte(next), b'}' | b'~') {
                            let len = self.close_len(next, false)?;
                            (next + len, width + len)
                        } else {
                            is_last = true;
                            let end = self.path(next)?;
                            (end, width + 1 + (end - next))
                        }
                    } else {
                        let is_triple = kind == Braces::Mustache && self.byte(open) == b'{';
                        if kind != Braces::Mustache || is_triple {
                            open += 1;
                            width += 1;
                        }
                        let head = self.skip_space(open);
                        let end = self.path(head)?;
                        width += end - head;
                        let next = self.skip_space(end);
                        if kind == Braces::Block || !self.ends_params(next) {
                            is_last = true;
                            (end, width)
                        } else {
                            let len = self.close_len(next, is_triple)?;
                            (next + len, width + len)
                        }
                    }
                }
            } else {
                self.word(at)?
            };
            if width > room {
                return Ok(false);
            }
            if is_last {
                return Ok(true);
            }
            room -= width;
            at = end;
        }
    }

    /// Writes a group. `write` writes it on one line (`Mode::Flat`) or with its line breaks (`Mode::Free`).
    ///
    /// If it `is_broken_in_source`, it's likely to be printed that way, so that's written first. `flat` then tells how
    /// wide it would have been on one line.
    #[inline]
    fn group(
        &mut self,
        is_broken_in_source: bool,
        rest: Rest,
        write: impl Fn(&mut Self, Mode) -> Written,
    ) -> Written {
        let mark = self.mark();
        if is_broken_in_source {
            write(self, Mode::Free)?;
            let end = mark.column + (self.flat - mark.flat);
            if end > self.width || !self.fits(end, rest)? {
                return Ok(());
            }
            self.reset(mark);
        }
        match write(self, Mode::Flat) {
            Ok(()) => {
                if self.fits(self.column, rest)? {
                    return Ok(());
                }
            }
            Err(Stop::Breaks) => {}
            Err(stop) => return Err(stop),
        }
        self.reset(mark);
        write(self, Mode::Free)
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// Returns the length of the end of a mustache at `at`.
    fn close_len(&self, at: usize, is_triple: bool) -> Result<usize, Stop> {
        let len = match (is_triple, self.byte(at)) {
            (false, b'}') if self.byte(at + 1) == b'}' => 2,
            (false, b'~') if self.starts_with(at, b"~}}") => 3,
            (true, b'}') if self.starts_with(at, b"}}}") => 3,
            (true, b'}') if self.starts_with(at, b"}~}}") => 4,
            _ => return Err(Stop::Refused),
        };
        match self.byte(at + len) {
            b'}' => Err(Stop::Refused),
            _ => Ok(len),
        }
    }

    /// Writes the end of a mustache, after white space.
    fn close(&mut self, is_triple: bool) -> Written {
        let at = self.skip_space(self.at);
        let len = self.close_len(at, is_triple)?;
        self.copy(at, at + len);
        self.at = at + len;
        Ok(())
    }

    /// Returns the end of the number without a sign at `start` if `String(Number(..))` gives it back: no more digits
    /// than a double has, and no zeros that say nothing.
    fn number(&self, start: usize) -> Result<usize, Stop> {
        let digits = |mut at: usize| {
            while self.byte(at).is_ascii_digit() {
                at += 1;
            }
            at
        };
        let mut end = digits(start);
        let mut count = end - start;
        if count == 0 || (count > 1 && self.byte(start) == b'0') {
            return Err(Stop::Refused);
        }
        if self.byte(end) == b'.' {
            let fraction = end + 1;
            end = digits(fraction);
            count += end - fraction;
            if end == fraction || self.byte(end - 1) == b'0' {
                return Err(Stop::Refused);
            }
        }
        match count > 15 {
            true => Err(Stop::Refused),
            false => Ok(end),
        }
    }

    /// A string, a number, a path, a keyword or a sub-expression. `quote` is the quote of a string.
    fn param(&mut self, mode: Mode, level: usize, quote: u8) -> Written {
        let at = self.at;
        let end = match self.byte(at) {
            b'(' => return self.sub_expression(mode, level, quote),
            delimiter @ (b'"' | b'\'') => {
                let mut end = at + 1;
                let mut has_other_quote = false;
                let mut is_ascii = true;
                loop {
                    end = self.end_of_plain(end);
                    match self.byte(end) {
                        byte if byte == delimiter => break,
                        b'"' | b'\'' => has_other_quote = true,
                        0x80.. => is_ascii = false,
                        _ => return Err(Stop::Refused),
                    }
                    end += 1;
                }
                let width = match is_ascii {
                    true => end - (at + 1),
                    false => string_width(self.slice(at + 1, end)) as usize,
                };
                // With the other quote in it, the string keeps its own.
                if delimiter == quote || has_other_quote {
                    self.copy_wide(at, end + 1, width + 2);
                } else {
                    self.put_byte(quote);
                    self.copy_wide(at + 1, end, width);
                    self.put_byte(quote);
                }
                end + 1
            }
            first @ (b'0'..=b'9' | b'-') => {
                let end = self.number(at + usize::from(first == b'-'))?;
                // `-0` is printed as `0`.
                if self.slice(at, end) == b"-0" {
                    return Err(Stop::Refused);
                }
                self.copy(at, end);
                end
            }
            _ => {
                let end = match self.path(at) {
                    Ok(end) => end,
                    Err(stop) => {
                        let end = self.end_of(at, NAME);
                        match self.slice(at, end) {
                            b"true" | b"false" | b"null" | b"undefined" => end,
                            _ => return Err(stop),
                        }
                    }
                };
                self.copy(at, end);
                end
            }
        };
        if !Self::ends_param(self.byte(end)) {
            return Err(Stop::Refused);
        }
        self.at = end;
        Ok(())
    }

    /// `printParams`, with a `line` in that mode between two of them. There's at least one.
    fn params(&mut self, mode: Mode, level: usize, quote: u8) -> Written {
        let mut has_pair = false;
        let mut at = self.skip_space(self.at);
        loop {
            self.at = at;
            let first = self.byte(at);
            let key_end = match first.is_ascii_alphabetic() || first == b'_' {
                true => self.end_of(at + 1, NAME),
                false => at,
            };
            if key_end > at && self.byte(key_end) == b'=' {
                has_pair = true;
                self.copy(at, key_end + 1);
                self.at = key_end + 1;
                self.param(mode, level, self.quote)?;
            } else if has_pair {
                return Err(Stop::Refused);
            } else {
                self.param(mode, level, quote)?;
            }
            self.check(mode)?;
            at = self.skip_space(self.at);
            if self.ends_params(at) {
                self.at = at;
                return Ok(());
            }
            self.line(mode, level);
        }
    }

    fn sub_expression(&mut self, mode: Mode, level: usize, quote: u8) -> Written {
        self.enter()?;
        let result = match mode {
            Mode::Flat => self.sub_expression_in(Mode::Flat, level, quote),
            Mode::Free => {
                let head = self.skip_space(self.at + 1);
                let is_broken = self.byte(self.end_of(head, NAME | TAG)) == b'\n';
                self.group(is_broken, Rest::Columns(0), |this, mode| {
                    this.sub_expression_in(mode, level, quote)
                })
            }
        };
        self.depth -= 1;
        result
    }

    fn sub_expression_in(&mut self, mode: Mode, level: usize, quote: u8) -> Written {
        let open = self.at;
        let head = self.skip_space(open + 1);
        let end = self.path(head)?;
        self.copy(open, open + 1);
        self.copy(head, end);
        // Before what is in it is read: it can be as deep as it's long.
        self.check(mode)?;
        self.at = self.skip_space(end);
        if !self.ends_params(self.at) {
            if self.at == end {
                return Err(Stop::Refused);
            }
            self.line(mode, level + 1);
            self.params_group(mode, level + 1, quote)?;
        }
        if self.byte(self.at) != b')' || !Self::ends_param(self.byte(self.at + 1)) {
            return Err(Stop::Refused);
        }
        self.soft_line(mode, level);
        self.copy(self.at, self.at + 1);
        self.at += 1;
        self.check(mode)
    }

    /// `group(printParams(..))`, with a line break behind it if it's in a group that's broken.
    fn params_group(&mut self, mode: Mode, level: usize, quote: u8) -> Written {
        match mode {
            Mode::Flat => self.params(Mode::Flat, level, quote),
            Mode::Free => self.group(false, Rest::Columns(0), |this, mode| {
                this.params(mode, level, quote)
            }),
        }
    }

    /// `as |a b|`, in a block. `self.at` is at the `as`.
    fn block_params(&mut self, is_in_tag: bool) -> Written {
        let mut at = self.skip_space(self.at + 2) + 1;
        self.put(b"as |");
        let mut is_first = true;
        loop {
            at = self.skip_space(at);
            if self.byte(at) == b'|' && !is_first {
                break;
            }
            let first = self.byte(at);
            let end = self.end_of(at, NAME);
            if !(first.is_ascii_alphabetic() || first == b'_')
                || matches!(
                    self.slice(at, end),
                    b"this" | b"true" | b"false" | b"null" | b"undefined" | b"else" | b"as"
                )
            {
                return Err(Stop::Refused);
            }
            if !is_first {
                self.put_byte(b' ');
            }
            is_first = false;
            self.copy(at, end);
            at = end;
        }
        self.copy(at, at + 1);
        self.at = self.skip_space(at + 1);
        let is_at_end = match self.byte(self.at) {
            b'>' | b'/' => is_in_tag,
            b'}' | b'~' => !is_in_tag,
            _ => false,
        };
        match is_at_end {
            true => Ok(()),
            false => Err(Stop::Refused),
        }
    }

    /// A mustache that's a node, a modifier or (a part of) the value of an attribute. Returns true if it's more than a
    /// text, that is, if it has parameters.
    fn mustache(&mut self, mode: Mode, level: usize, quote: u8, rest: Rest) -> Result<bool, Stop> {
        let at = self.at;
        let mut open = at + 2;
        open += usize::from(self.byte(open) == b'~');
        let is_triple = self.byte(open) == b'{';
        open += usize::from(is_triple);
        let head = self.skip_space(open);
        let Ok(end) = self.path(head) else {
            // `{{true}}`, `{{1}}`, `{{"a"}}`. What follows such a thing isn't in the tree.
            if self.byte(head) == b'(' || self.slice(head + 1, head + 14) == b"...attributes" {
                return Err(Stop::Refused);
            }
            self.copy(at, open);
            self.at = head;
            self.param(Mode::Flat, level, quote)?;
            self.close(is_triple)?;
            return Ok(false);
        };
        let next = self.skip_space(end);
        if self.ends_params(next) {
            let len = self.close_len(next, is_triple)?;
            if head == open && next == end {
                self.copy(at, next + len);
            } else {
                self.copy(at, open);
                self.copy(head, end);
                self.copy(next, next + len);
            }
            self.at = next + len;
            return Ok(false);
        }
        if next == end {
            return Err(Stop::Refused);
        }
        let write = |this: &mut Self, mode: Mode| {
            this.copy(at, open);
            this.copy(head, end);
            this.at = next;
            this.line(mode, level + 1);
            this.params(mode, level + 1, quote)?;
            this.soft_line(mode, level);
            this.close(is_triple)?;
            this.check(mode)
        };
        match mode {
            Mode::Flat => write(self, Mode::Flat)?,
            Mode::Free => self.group(self.byte(end) == b'\n', rest, write)?,
        }
        Ok(true)
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// Returns the end and the width of the `<!-- -->` at `at`.
    fn comment_at(&self, at: usize) -> Result<(usize, usize), Stop> {
        let value = at + 4;
        if !self.starts_with(at, b"<!--") || matches!(self.byte(value), b'-' | b'>') {
            return Err(Stop::Refused);
        }
        let rest = self.source.get(value..).unwrap_or_default();
        let len = strings::index_of(rest, b"--").ok_or(Stop::Refused)?;
        // The tokenizer goes on with the comment after `--` and anything else, a third dash too.
        if rest.get(len + 2) != Some(&b'>') || strings::contains(&rest[..len], b"{{") {
            return Err(Stop::Refused);
        }
        Ok((value + len + 3, 7 + self.width_of(value, value + len)?))
    }

    fn comment(&mut self) -> Written {
        let (end, width) = self.comment_at(self.at)?;
        self.copy_wide(self.at, end, width);
        self.at = end;
        Ok(())
    }

    fn mustache_comment_at(&self, at: usize) -> Result<MustacheComment, Stop> {
        let strips_left = self.byte(at + 2) == b'~';
        let mark = at + 2 + usize::from(strips_left);
        let rest = self.source.get(mark + 1..).unwrap_or_default();
        let (value, value_end, end);
        if rest.starts_with(b"--") {
            // The lexer takes the first `--}}` or `--~}}`.
            value = mark + 3;
            let mut from = 0;
            loop {
                let dashes = from + strings::index_of(&rest[from..], b"--").ok_or(Stop::Refused)?;
                let after = &rest[dashes + 2..];
                let tilde = usize::from(after.starts_with(b"~"));
                if after[tilde..].starts_with(b"}}") {
                    value_end = mark + 1 + dashes;
                    end = value_end + 2 + tilde + 2;
                    break;
                }
                from = dashes + 1;
            }
        } else {
            value = mark + 1;
            let len = strings::index_of(rest, b"}}").ok_or(Stop::Refused)?;
            end = value + len + 2;
            value_end = value + len - usize::from(len > 0 && rest[len - 1] == b'~');
        }
        if value_end < value {
            return Err(Stop::Refused);
        }
        let strips_right = self.byte(end - 3) == b'~';
        let text = self.slice(value, value_end);
        // What `stripComment` takes away besides, and what the printer adds dashes for.
        if text.starts_with(b"-")
            || text.ends_with(b"-")
            || text.ends_with(b"~")
            || strings::trim_js_whitespace(text) == b"prettier-ignore"
        {
            return Err(Stop::Refused);
        }
        let needs_dashes = strings::contains(text, b"}}");
        let width = 5
            + usize::from(strips_left)
            + usize::from(strips_right)
            + if needs_dashes { 4 } else { 0 }
            + self.width_of(value, value_end)?;
        Ok(MustacheComment {
            value,
            value_end,
            end,
            width,
            is_as_printed: needs_dashes == (value == mark + 3),
        })
    }

    fn mustache_comment(&mut self) -> Written {
        let at = self.at;
        let comment = self.mustache_comment_at(at)?;
        if comment.is_as_printed {
            self.copy_wide(at, comment.end, comment.width);
        } else {
            // `{{!-- a --}}` is printed as `{{! a }}`.
            let mark = comment.value - 2;
            let close = comment.value_end + 2;
            self.copy(at, mark);
            let width = comment.width - (mark - at) - (comment.end - close);
            self.copy_wide(comment.value, comment.value_end, width);
            self.copy(close, comment.end);
        }
        self.at = comment.end;
        Ok(())
    }

    // ───────────────────────────── elements ─────────────────────────────

    /// The value of an attribute in quotes that's more than plain text. `self.at` is at the quote.
    fn quoted_value(&mut self, mode: Mode, level: usize, is_class: bool) -> Written {
        let delimiter = self.byte(self.at);
        // With the other quote in it, the value keeps its own.
        let quote = self.quote;
        self.put_byte(quote);
        self.at += 1;
        match (is_class, mode) {
            (true, Mode::Free) => {
                let rest = self.slice(self.at, self.source.len());
                let is_broken = strings::index_of_any(rest, &[b'\n', delimiter])
                    .is_some_and(|at| rest.get(at) == Some(&b'\n'));
                self.group(is_broken, Rest::Columns(1), |this, mode| {
                    this.classes(mode, level, delimiter)
                })?;
            }
            (true, Mode::Flat) => self.classes(Mode::Flat, level, delimiter)?,
            (false, _) => self.parts_of_value(mode, delimiter)?,
        }
        self.put_byte(quote);
        self.at += 1;
        Ok(())
    }

    /// Returns the end of the text at `at` in a value between `delimiter`s, without white space if `is_class`.
    fn end_of_text_in_value(&self, mut at: usize, delimiter: u8, is_class: bool) -> usize {
        loop {
            let byte = self.byte(at);
            let is_text = match byte {
                b' ' => !is_class,
                // The quote that's printed can't be in the value.
                b'"' | b'\'' => byte != delimiter && byte != self.quote,
                _ => is(byte, PLAIN),
            };
            if !is_text {
                return at;
            }
            at += 1;
        }
    }

    /// Texts and mustaches up to `delimiter`, on one line.
    fn parts_of_value(&mut self, mode: Mode, delimiter: u8) -> Written {
        // A mustache with parameters is a group. If all of the value fits on the line, so does each of them.
        let mut has_group = false;
        loop {
            let at = self.at;
            let end = self.end_of_text_in_value(at, delimiter, false);
            self.copy(at, end);
            self.at = end;
            self.check(mode)?;
            if self.byte(end) == delimiter {
                return match mode == Mode::Free && has_group && self.column + 1 > self.width {
                    true => Err(Stop::Refused),
                    false => Ok(()),
                };
            }
            has_group |= self.mustache_in_value(mode)?;
        }
    }

    /// A mustache in quotes, on one line. In `Mode::Free`, one that doesn't fit is refused.
    fn mustache_in_value(&mut self, mode: Mode) -> Result<bool, Stop> {
        if !self.is_at_braces(self.at) || self.braces(self.at) != Braces::Mustache {
            return Err(Stop::Refused);
        }
        match self.mustache(Mode::Flat, 0, self.other_quote, Rest::Columns(0)) {
            Err(Stop::Breaks) if mode == Mode::Free => Err(Stop::Refused),
            result => result,
        }
    }

    /// The value of `class` up to `delimiter`: `group(indent(..))`, in which white space next to a mustache is a `line`.
    /// `level` is that of the attribute.
    fn classes(&mut self, mode: Mode, level: usize, delimiter: u8) -> Written {
        #[derive(PartialEq)]
        enum Last {
            Nothing,
            Class,
            Mustache,
        }
        let mut last = Last::Nothing;
        // A mustache with parameters is a group. If all of its line fits, so does each of them.
        let mut has_group = false;
        let check = |this: &Self, has_group: bool, more: usize| match mode {
            Mode::Flat => this.check(mode),
            Mode::Free if has_group && this.column + more > this.width => Err(Stop::Refused),
            Mode::Free => Ok(()),
        };
        loop {
            let at = self.skip_space(self.at);
            let has_space = at > self.at;
            self.at = at;
            if self.byte(at) == delimiter {
                if has_space && last == Last::Mustache {
                    check(self, has_group, 0)?;
                    self.line(mode, level + 1);
                    has_group = false;
                }
                return check(self, has_group, 1);
            }
            let is_mustache = self.is_at_braces(at);
            if has_space && last != Last::Nothing {
                if is_mustache || last == Last::Mustache {
                    check(self, has_group, 0)?;
                    self.line(mode, level + 1);
                    has_group = false;
                } else {
                    self.put_byte(b' ');
                }
            }
            if is_mustache {
                has_group |= self.mustache_in_value(mode)?;
                last = Last::Mustache;
            } else {
                let end = self.end_of_text_in_value(at, delimiter, true);
                if end == at {
                    return Err(Stop::Refused);
                }
                self.copy(at, end);
                self.at = end;
                last = Last::Class;
            }
            self.check(mode)?;
        }
    }

    /// An attribute, a modifier or a comment in a start tag. `level` is that of its line if the tag is broken.
    fn attribute(&mut self, mode: Mode, level: usize) -> Written {
        let at = self.at;
        if self.byte(at) == b'{' {
            if !self.is_at_braces(at) {
                return Err(Stop::Refused);
            }
            return match self.braces(at) {
                Braces::Comment => self.mustache_comment(),
                // The tree has neither the third brace nor the tilde of a modifier, and it starts with a path.
                Braces::Mustache if !matches!(self.byte(at + 2), b'~' | b'{') => {
                    self.path(self.skip_space(at + 2))?;
                    self.mustache(mode, level, self.quote, Rest::Columns(0))?;
                    match self.byte(self.at - 3) {
                        b'~' => Err(Stop::Refused),
                        _ => Ok(()),
                    }
                }
                _ => Err(Stop::Refused),
            };
        }
        let end = self.end_of(at, TAG);
        let name = self.slice(at, end);
        if name.is_empty() || name == b"as" {
            return Err(Stop::Refused);
        }
        if self.byte(end) != b'=' {
            self.copy(at, end);
            self.at = end;
            return Ok(());
        }
        let is_class = name.eq_ignore_ascii_case(b"class");
        if is_class && name != b"class" {
            return Err(Stop::Refused);
        }
        let value = end + 1;
        match self.byte(value) {
            delimiter @ (b'"' | b'\'') => {
                let mut text_end = self.end_of_plain(value + 1);
                let mut width = text_end - (value + 1);
                if self.byte(text_end) >= 0x80 {
                    while self.byte(text_end) >= 0x80 {
                        text_end = self.end_of_plain(text_end + 1);
                    }
                    width = string_width(self.slice(value + 1, text_end)) as usize;
                }
                if self.byte(text_end) == delimiter
                    && (!is_class
                        || text_end == value + 1
                        || self.is_list_of_classes(value + 1, text_end))
                {
                    if delimiter == self.quote {
                        self.copy_wide(at, text_end + 1, value - at + width + 2);
                    } else {
                        self.copy(at, value);
                        self.put_byte(self.quote);
                        self.copy_wide(value + 1, text_end, width);
                        self.put_byte(self.quote);
                    }
                    self.at = text_end + 1;
                    return Ok(());
                }
                self.copy(at, value);
                self.at = value;
                self.quoted_value(mode, level, is_class)
            }
            b'{' if self.is_at_braces(value) && self.braces(value) == Braces::Mustache => {
                self.copy(at, value);
                self.at = value;
                self.mustache(mode, level, self.quote, Rest::Columns(0))?;
                Ok(())
            }
            // Without quotes.
            _ => {
                let text_end = self.end_of(value, TAG);
                if text_end == value {
                    return Err(Stop::Refused);
                }
                self.copy(at, value);
                self.put_byte(self.quote);
                self.copy(value, text_end);
                self.put_byte(self.quote);
                self.at = text_end;
                Ok(())
            }
        }
    }

    /// `printStartingTag`. `self.at` is at the `<`, and the name ends at `name_end`. Sets `is_void`, and if it's true,
    /// takes the end tag too.
    fn start_tag(&mut self, mode: Mode, level: usize, name_end: usize) -> Written {
        let name_start = self.at + 1;
        self.copy(self.at, name_end);
        let mut at = name_end;
        let is_self_closing = loop {
            let next = self.skip_space(at);
            match self.byte(next) {
                b'>' => {
                    at = next + 1;
                    break false;
                }
                b'/' if self.byte(next + 1) == b'>' => {
                    at = next + 2;
                    break true;
                }
                _ if next == at => return Err(Stop::Refused),
                _ => {}
            }
            self.at = next;
            self.line(mode, level + 1);
            if self.byte(next) == b'a' && self.ends_params(next) {
                self.block_params(true)?;
            } else {
                self.attribute(mode, level + 1)?;
            }
            self.check(mode)?;
            at = self.at;
        };
        let name = self.slice(name_start, name_end);
        let first = self.byte(name_start);
        self.is_void = is_self_closing || is_void_tag(name);
        if !self.is_void
            && first != b':'
            && (!first.is_ascii_lowercase() || strings::contains_char(name, b'.'))
        {
            // A component without content. The white space in it isn't printed, so it has to be known here.
            let end_tag = self.skip_space(at);
            if self.starts_with(end_tag, b"</") {
                let end = end_tag + 2 + name.len();
                if self.slice(end_tag + 2, end) != name || self.byte(end) != b'>' {
                    return Err(Stop::Refused);
                }
                self.is_void = true;
                at = end + 1;
            }
        }
        self.at = at;
        match (self.is_void, mode) {
            (true, Mode::Flat) => self.put(b" />"),
            (true, Mode::Free) => {
                self.new_line(level, 1);
                self.put(b"/>");
            }
            (false, _) => {
                self.soft_line(mode, level);
                self.put_byte(b'>');
            }
        }
        self.check(mode)
    }

    fn element(&mut self, mode: Mode, level: usize) -> Written {
        self.enter()?;
        let result = self.element_in(mode, level);
        self.depth -= 1;
        result
    }

    fn element_in(&mut self, mode: Mode, level: usize) -> Written {
        let name_start = self.at + 1;
        let name_end = self.end_of(name_start, TAG);
        let name = self.slice(name_start, name_end);
        let is_known = match name {
            [b'@' | b':', _, ..] => true,
            [b'a'..=b'z', ..] => !name.iter().any(u8::is_ascii_uppercase),
            [b'A'..=b'Z', ..] => true,
            _ => false,
        };
        // White space counts in these, or the tokenizer reads them in another way.
        let is_special = matches!(name, [b'p' | b's' | b't' | b'P' | b'S' | b'T', ..])
            && [&b"pre"[..], b"style", b"script", b"textarea", b"title"]
                .iter()
                .any(|special| name.eq_ignore_ascii_case(special));
        if !is_known || (is_special && matches!(name, b"title" | b"style" | b"script")) {
            return Err(Stop::Refused);
        }
        match mode {
            Mode::Flat => self.start_tag(Mode::Flat, level, name_end)?,
            Mode::Free => {
                let mark = self.mark();
                let written =
                    self.group(self.byte(name_end) == b'\n', Rest::Nodes, |this, mode| {
                        this.start_tag(mode, level, name_end)
                    });
                match written {
                    Err(Stop::Refused) if !is_special => {
                        self.reset(mark);
                        let (end, is_self_closing) =
                            self.end_of_tag(name_end).ok_or(Stop::Refused)?;
                        if is_self_closing || is_void_tag(name) {
                            return Err(Stop::Refused);
                        }
                        self.delegate_head(level, end, [b"</", name, b">"])?;
                        self.is_void = false;
                    }
                    written => written?,
                }
            }
        }
        if self.is_void {
            return Ok(());
        }
        if is_special {
            return Err(Stop::Refused);
        }
        self.list(mode, level + 1, Parent::Element)?;
        let at = self.at;
        let end = at + 2 + (name_end - name_start);
        if self.slice(at + 2, end) != self.slice(name_start, name_end) || self.byte(end) != b'>' {
            return Err(Stop::Refused);
        }
        self.copy(at, end + 1);
        self.at = end + 1;
        self.check(mode)
    }

    // ───────────────────────────── blocks ─────────────────────────────

    /// `printOpenBlock`, or `printElseIfBlock` if `is_chained`. The path is at `head..end`. Takes the white space behind
    /// it too if there's nothing else in the block.
    fn open_block(
        &mut self,
        mode: Mode,
        level: usize,
        (head, end): (usize, usize),
        is_chained: bool,
    ) -> Written {
        let at = self.at;
        let mark = at + 2 + usize::from(self.byte(at + 2) == b'~');
        if is_chained {
            self.copy(at, mark);
            self.put(b"else ");
        } else {
            self.copy(at, mark + 1);
        }
        self.copy(head, end);
        self.at = self.skip_space(end);
        if !matches!(self.byte(self.at), b'}' | b'~') {
            if self.at == end {
                return Err(Stop::Refused);
            }
            self.line(mode, level + 1);
            let has_params = !self.ends_params(self.at);
            if has_params {
                self.params_group(mode, level + 1, self.quote)?;
            } else if is_chained {
                return Err(Stop::Refused);
            }
            if self.byte(self.at) == b'a' {
                if has_params {
                    self.line(mode, level + 1);
                }
                self.block_params(false)?;
            }
        } else if is_chained {
            return Err(Stop::Refused);
        }
        self.soft_line(mode, level);
        self.close(false)?;
        let next = self.skip_space(self.at);
        if self.is_at_braces(next) && self.braces(next) == Braces::End {
            self.at = next;
        }
        self.check(mode)
    }

    fn block(&mut self, mode: Mode, level: usize) -> Written {
        self.enter()?;
        let result = self.block_in(mode, level);
        self.depth -= 1;
        result
    }

    fn block_in(&mut self, mode: Mode, level: usize) -> Written {
        let mark = self.at + 2 + usize::from(self.byte(self.at + 2) == b'~');
        let head = self.skip_space(mark + 1);
        let name = (head, self.path(head)?);
        // The block that an `{{else a}}` belongs to.
        let mut outer = name;
        let mut path = name;
        let mut is_chained = false;
        loop {
            match mode {
                Mode::Flat => self.open_block(Mode::Flat, level, path, is_chained)?,
                Mode::Free => {
                    let mark = self.mark();
                    let written =
                        self.group(self.byte(path.1) == b'\n', Rest::Nodes, |this, mode| {
                            this.open_block(mode, level, path, is_chained)
                        });
                    match written {
                        Err(Stop::Refused) if !is_chained => {
                            self.reset(mark);
                            let end = self.end_of_mustache(self.at).ok_or(Stop::Refused)?;
                            let name = self.slice(name.0, name.1);
                            self.delegate_head(level, end, [b"{{/", name, b"}}"])?;
                        }
                        written => written?,
                    }
                }
            }
            self.list(mode, level + 1, Parent::Block)?;
            let mut has_else = false;
            loop {
                let at = self.at;
                let mark = at + 2 + usize::from(self.byte(at + 2) == b'~');
                if self.byte(mark) == b'/' {
                    let close = self.skip_space(mark + 1);
                    let end = close + (name.1 - name.0);
                    if self.slice(close, end) != self.slice(name.0, name.1) {
                        return Err(Stop::Refused);
                    }
                    self.copy(at, mark + 1);
                    self.copy(close, end);
                    self.at = end;
                    self.close(false)?;
                    return self.check(mode);
                }
                let word = self.skip_space(mark);
                if has_else || !self.is_else(word) {
                    return Err(Stop::Refused);
                }
                let next = self.skip_space(word + 4);
                if !matches!(self.byte(next), b'}' | b'~') {
                    // `{{else a b}}` is printed like that if `a` is `if` or the name of the block.
                    path = (next, self.path(next)?);
                    let chained = self.slice(path.0, path.1);
                    if next == word + 4
                        || strings::index_of_any(chained, b".@").is_some()
                        || chained == b"this"
                        || (chained != b"if" && chained != self.slice(outer.0, outer.1))
                    {
                        return Err(Stop::Refused);
                    }
                    (outer, is_chained) = (path, true);
                    break;
                }
                has_else = true;
                self.copy(at, mark);
                self.copy(word, word + 4);
                self.at = next;
                self.close(false)?;
                // A block that's all there is after `{{else}}` can be printed as `{{else a}}`.
                if self.is_at_braces(self.at) && self.braces(self.at) == Braces::Block {
                    return Err(Stop::Refused);
                }
                self.list(mode, level + 1, Parent::Block)?;
            }
        }
    }

    // ───────────────────────────── children ─────────────────────────────

    /// `fill(getTextValueParts(text))`: the words from `self.at` up to the end of the text or the white space there.
    fn fill(&mut self, mode: Mode, level: usize) -> Written {
        let mut start = self.at;
        let (mut end, mut width) = self.word(start)?;
        loop {
            self.copy_wide(start, end, width);
            self.check(mode)?;
            let next = self.skip_space(end);
            let Ok(word) = self.word(next) else {
                self.at = end;
                return match self.ends_text(next) {
                    true => Ok(()),
                    false => Err(Stop::Refused),
                };
            };
            if mode == Mode::Flat || self.column + 1 + word.1 <= self.width {
                self.put_byte(b' ');
            } else {
                self.new_line(level, 1);
            }
            (start, (end, width)) = (next, word);
        }
    }

    /// What is at `at`, between two nodes.
    #[inline]
    fn next(&self, at: usize) -> Next {
        let byte = self.byte(at);
        if is(byte, SPACE) {
            Next::Space
        } else if byte == b'<' {
            match self.byte(at + 1) {
                b'/' => Next::End(Parent::Element),
                b'!' => Next::Comment,
                _ => Next::Element,
            }
        } else if byte == b'{' && self.byte(at + 1) == b'{' {
            match self.braces(at) {
                Braces::End => Next::End(Parent::Block),
                Braces::Comment => Next::MustacheComment,
                Braces::Block => Next::Block,
                Braces::Mustache => Next::Mustache,
            }
        } else if at >= self.source.len() {
            Next::End(Parent::Template)
        } else {
            Next::Text
        }
    }

    /// Nodes without white space between them, the first of which is `next`. Returns true at the end of the list, false
    /// at white space.
    fn nodes(
        &mut self,
        mode: Mode,
        level: usize,
        parent: Parent,
        mut next: Next,
    ) -> Result<bool, Stop> {
        loop {
            match next {
                Next::Space => return Ok(false),
                Next::End(of) if of == parent => return Ok(true),
                Next::End(_) => return Err(Stop::Refused),
                Next::Comment => self.comment()?,
                Next::Element => self.element(mode, level)?,
                Next::MustacheComment => self.mustache_comment()?,
                Next::Block => self.block(mode, level)?,
                Next::Mustache => {
                    self.mustache(mode, level, self.quote, Rest::Nodes)?;
                }
                Next::Text => self.fill(mode, level)?,
            }
            self.check(mode)?;
            next = self.next(self.at);
        }
    }

    /// The children of an element, a block or the template, up to what ends them. `level` is theirs.
    fn list(&mut self, mode: Mode, level: usize, parent: Parent) -> Written {
        match mode {
            Mode::Flat => self.flat_list(parent),
            Mode::Free => self.free_list(level, parent),
        }
    }

    fn flat_list(&mut self, parent: Parent) -> Written {
        while !self.nodes(Mode::Flat, 0, parent, self.next(self.at))? {
            let (end, line_feeds) = self.white_space(self.at);
            if line_feeds > 0 {
                return Err(Stop::Breaks);
            }
            self.put_byte(b' ');
            self.at = end;
        }
        Ok(())
    }

    /// `group(children)`. Whether it's broken only matters to the white space between two nodes, which is a `line`
    /// or, with a line feed in it, a `hardline`. What is in a group that fits decides to be on one line by itself.
    fn free_list(&mut self, level: usize, parent: Parent) -> Written {
        let first_line = self.lines;
        let mut is_broken = false;
        let mut is_first = true;
        // The end of what was read of the nodes that didn't fit on one line.
        let mut read_to = 0;
        loop {
            if self.is_too_long {
                return Err(Stop::GivenUp);
            }
            let start = self.at;
            let (end, line_feeds) = self.white_space(start);
            let has_space = end > start;
            // More white space, of a kind that isn't read here.
            if matches!(self.byte(end), b'\r' | 0x0C) {
                return Err(Stop::Refused);
            }
            if has_space && !is_broken {
                // What has a line break in it already didn't fit on one line.
                if line_feeds == 0 && self.lines == first_line {
                    let mark = self.mark();
                    match self.flat_list(parent) {
                        Ok(()) => {
                            if self.nodes_fit(self.column)? {
                                return Ok(());
                            }
                        }
                        Err(Stop::Breaks) => read_to = self.at + 1,
                        Err(stop) => return Err(stop),
                    }
                    self.reset(mark);
                }
                is_broken = true;
            }
            self.at = end;
            let next = self.next(end);
            if let Next::End(of) = next {
                if of != parent {
                    return Err(Stop::Refused);
                }
                if has_space {
                    self.breaks((start, end), line_feeds, level.saturating_sub(1));
                }
                return Ok(());
            }
            if has_space {
                self.breaks((start, end), line_feeds, level);
            }
            let mark = self.mark();
            match self.nodes(Mode::Free, level, parent, next) {
                Ok(true) => return Ok(()),
                Ok(false) => {}
                Err(Stop::GivenUp) => return Err(Stop::GivenUp),
                Err(_) => {
                    // A node that's refused may be printed in another way than it was read up to there, as it's written
                    // for example. So it isn't certain that it didn't fit, and the white space has been printed.
                    if (!has_space && !(is_first && parent == Parent::Template))
                        || mark.at < read_to
                    {
                        return Err(Stop::Refused);
                    }
                    self.reset(mark);
                    self.delegate(level, is_broken)?;
                }
            }
            is_first = false;
        }
    }

    // ───────────────────────────── the long way ─────────────────────────────

    /// Returns the end of the mustache at `at`, roughly.
    fn end_of_mustache(&self, at: usize) -> Option<usize> {
        let mut next = at + 2 + usize::from(self.byte(at + 2) == b'~');
        if self.byte(next) == b'!' {
            let rest = self.source.get(next..)?;
            if !rest.starts_with(b"!--") {
                return Some(next + strings::index_of(rest, b"}}")? + 2);
            }
            let mut from = 1;
            loop {
                from += strings::index_of(&rest[from..], b"--")?;
                let after = &rest[from + 2..];
                let tilde = usize::from(after.starts_with(b"~"));
                if after[tilde..].starts_with(b"}}") {
                    return Some(next + from + 2 + tilde + 2);
                }
                from += 1;
            }
        }
        if self.starts_with(at, b"{{{{") {
            return None;
        }
        let is_triple = self.byte(next) == b'{';
        loop {
            match self.byte(next) {
                0 if next >= self.source.len() => return None,
                quote @ (b'"' | b'\'') => next += delimited_len(&self.source[next..], quote)?,
                b'[' => next += delimited_len(&self.source[next..], b']')?,
                b'}' if self.byte(next + 1) == b'}' => {
                    let end = next + 2;
                    return Some(end + usize::from(is_triple && self.byte(end) == b'}'));
                }
                _ => next += 1,
            }
        }
    }

    /// True if `{{` is at `at` and isn't escaped: one backslash escapes a mustache, two don't.
    fn is_at_mustache(&self, at: usize) -> bool {
        self.is_at_braces(at)
            && (self.byte(at.wrapping_sub(1)) != b'\\' || self.byte(at.wrapping_sub(2)) == b'\\')
    }

    /// Returns the end of the start tag whose name ends at `at`, roughly, and whether it ends in `/>`.
    fn end_of_tag(&self, mut at: usize) -> Option<(usize, bool)> {
        loop {
            match self.byte(at) {
                0 if at >= self.source.len() => return None,
                b'>' => return Some((at + 1, self.byte(at - 1) == b'/')),
                b'{' if self.is_at_mustache(at) => at = self.end_of_mustache(at)?,
                quote @ (b'"' | b'\'') => {
                    at += 1;
                    loop {
                        match self.byte(at) {
                            0 if at >= self.source.len() => return None,
                            b'{' if self.is_at_mustache(at) => at = self.end_of_mustache(at)?,
                            byte => {
                                at += 1;
                                if byte == quote {
                                    break;
                                }
                            }
                        }
                    }
                }
                _ => at += 1,
            }
        }
    }

    /// Returns where the nodes from `start` on end that have no white space between them, if there's white space or the
    /// end of the template behind them. It need not be right: a text that parses is a list of whole nodes.
    fn end_of_nodes(&mut self, start: usize) -> Option<usize> {
        match self.find_end_of_nodes(start) {
            Some(Found::End(end)) => Some(end),
            // What is around these nodes is asked about next.
            Some(Found::EndOfList(end)) => {
                self.known = (start, Some(end));
                None
            }
            None => {
                self.known = (start, None);
                None
            }
        }
    }

    fn find_end_of_nodes(&self, start: usize) -> Option<Found> {
        let mut at = start;
        let mut depth = 0usize;
        // How many more nodes have to be taken because of `{{! prettier-ignore }}`, which is about the next but one.
        let mut owed = 0u8;
        let mut is_after_text = false;
        // After an escaped mustache, the lexer makes a text of their own of the backslashes in front of the next
        // mustache. So nothing ends between the two.
        let mut is_after_escape = false;
        let mut next_braces = 0;
        loop {
            let byte = self.byte(at);
            if at >= self.source.len() {
                return (depth == 0).then_some(Found::End(at));
            }
            if at == self.known.0 && at > start {
                (at, is_after_escape) = (self.known.1?, true);
                continue;
            }
            if depth > 0 && byte != b'<' && byte != b'{' && byte != b'\\' {
                at += 1;
                continue;
            }
            if is(byte, SPACE) {
                let end = self.skip_space(at);
                if is_after_escape && next_braces < at {
                    let rest = self.slice(at, self.source.len());
                    next_braces = at + strings::index_of(rest, b"{{").unwrap_or(rest.len());
                }
                // White space between two words isn't between two nodes.
                if owed == 0
                    && !(is_after_text && !self.ends_text(end))
                    && !(is_after_escape && self.byte(next_braces.wrapping_sub(1)) == b'\\')
                {
                    return Some(Found::End(at));
                }
                (at, is_after_text) = (end, true);
                continue;
            }
            let is_node = byte == b'<' || self.is_at_braces(at);
            // White space of a kind that isn't read here.
            if matches!(byte, b'\r' | 0x0C) {
                return None;
            }
            if !is_node {
                // One backslash escapes a mustache, two don't.
                let is_escape =
                    byte == b'\\' && self.is_at_braces(at + 1) && !self.is_at_mustache(at + 1);
                is_after_escape |= is_escape;
                at += if is_escape { 3 } else { 1 };
                is_after_text = true;
                continue;
            }
            if depth == 0 && std::mem::take(&mut is_after_text) {
                owed = owed.saturating_sub(1);
            }
            let mut is_ignore = false;
            let rest = self.slice(at, self.source.len());
            if byte == b'<' {
                match self.byte(at + 1) {
                    b'/' if depth == 0 => return Some(Found::EndOfList(at)),
                    b'/' => {
                        depth -= 1;
                        at += strings::index_of_char_usize(rest, b'>')? + 1;
                    }
                    b'!' if rest.starts_with(b"<!-->") => at += 5,
                    b'!' if rest.starts_with(b"<!--->") => at += 6,
                    b'!' if rest.starts_with(b"<!--") => {
                        at += 4 + strings::index_of(rest.get(4..)?, b"-->")? + 3;
                    }
                    b'!' => at += strings::index_of_char_usize(rest, b'>')? + 1,
                    first if first.is_ascii_alphabetic() || matches!(first, b'@' | b':') => {
                        let mut name_end = at + 1;
                        while !matches!(self.byte(name_end), b' ' | b'\n' | b'\t' | b'/' | b'>' | 0)
                        {
                            name_end += 1;
                        }
                        let name = self.slice(at + 1, name_end);
                        let (end, is_self_closing) = self.end_of_tag(name_end)?;
                        if let Some(last) = strings::last_index_of(self.slice(at, end), b"{{") {
                            is_after_escape = !self.is_at_mustache(at + last);
                        }
                        at = end;
                        if matches!(name, b"title" | b"style" | b"script") && !is_self_closing {
                            // Only its end tag is a tag from here on.
                            loop {
                                at += strings::index_of(self.slice(at, self.source.len()), b"</")?;
                                if self.slice(at + 2, at + 2 + name.len()) == name
                                    && self.byte(at + 2 + name.len()) == b'>'
                                {
                                    break;
                                }
                                at += 2;
                            }
                            at += 3 + name.len();
                        } else if !is_self_closing && !is_void_tag(name) {
                            depth += 1;
                        }
                    }
                    _ => return None,
                }
            } else {
                let end = self.end_of_mustache(at)?;
                let mark = at + 2 + usize::from(self.byte(at + 2) == b'~');
                match self.byte(mark) {
                    b'#' => depth += 1,
                    b'^' if !matches!(self.byte(self.skip_space(mark + 1)), b'}' | b'~') => {
                        depth += 1;
                    }
                    b'!' => is_ignore = strings::contains(self.slice(at, end), b"prettier-ignore"),
                    _ if self.braces(at) == Braces::End && depth == 0 => {
                        return Some(Found::EndOfList(at));
                    }
                    b'/' => depth -= 1,
                    _ => {}
                }
                (at, is_after_escape) = (end, false);
            }
            if depth == 0 {
                owed = if is_ignore { 2 } else { owed.saturating_sub(1) };
            }
        }
    }

    /// Prints the start tag or the `{{#a}}` at `self.at`, which ends at `end`, from a tree and a document of its own, so
    /// that what is in the element or the block need not go the long way with it. `close` is what ends it.
    #[cold]
    #[inline(never)]
    fn delegate_head(&mut self, level: usize, end: usize, close: [&[u8]; 3]) -> Written {
        let head = self.slice(self.at, end);
        // A line break follows, so the head is measured by itself and all that's around it is on several lines. What has
        // nothing but white space in it can be printed in another way.
        let (next, line_feeds) = self.white_space(end);
        if line_feeds == 0
            || matches!(self.next(next), Next::End(_))
            || matches!(self.byte(next), b'\r' | 0x0C)
            || strings::contains_char(head, b'\\')
        {
            return Err(Stop::Refused);
        }
        self.flush();
        let mut text = std::mem::take(&mut self.head);
        text.clear();
        text.extend_from_slice(head);
        close.iter().for_each(|part| text.extend_from_slice(part));
        let template = parse(&text, 0, self.scratch, &Rejection::default());
        let Scratch { tree, elements, .. } = &mut *self.scratch;
        elements.clear();
        let mut printer = Printer {
            tree,
            source: &text,
            front_matter: b"",
            options: self.options,
            is_white_space_sensitive: true,
            single_quote: self.quote == b'\'',
            out: elements,
            pre_depth: 0,
            stack: Stack::for_tree(),
        };
        let is_printed = template
            .is_ok_and(|template| !tree.has_lost_text && printer.head(template))
            && !printer.stack.ran_out();
        self.head = text;
        if !is_printed {
            return Err(Stop::Refused);
        }
        let indent = self.indent(level);
        self.column = self
            .printer
            .print(&self.scratch.elements, indent, self.column);
        if self.printer.result().is_err() {
            return Err(Stop::GivenUp);
        }
        self.at = end;
        self.run = (end, end);
        self.lines += 1;
        Ok(())
    }

    /// The printer's indentation for `level`.
    fn indent(&mut self, level: usize) -> u32 {
        while self.indents.len() <= level {
            let last = self.indents.last().copied().unwrap_or(0);
            self.indents.push(self.printer.indented(last));
        }
        self.indents.get(level).copied().unwrap_or(0)
    }

    /// Prints the nodes at `self.at`, which start a line among nodes that are on several lines, from a tree and a
    /// document of their own.
    #[cold]
    #[inline(never)]
    fn delegate(&mut self, level: usize, is_among_lines: bool) -> Written {
        let start = self.at;
        let end = self.end_of_nodes(start).ok_or(Stop::Refused)?;
        // At the start of the template it isn't known yet that its nodes are on several lines.
        if !is_among_lines && self.white_space(end).1 == 0 {
            return Err(Stop::GivenUp);
        }
        let part = self.source.get(start..end).unwrap_or_default();
        let is_before_text = !self.ends_text(self.skip_space(end));
        self.flush();
        let template =
            parse(part, 0, self.scratch, &Rejection::default()).map_err(|_| Stop::GivenUp)?;
        let Scratch {
            tokens,
            tree,
            elements,
            ..
        } = &mut *self.scratch;
        let tree = &*tree;
        if tree.has_lost_text || tree.ends_in_raw_text {
            return Err(Stop::GivenUp);
        }
        // After an escaped mustache, the lexer makes a text of their own of the backslashes in front of the next one.
        if let [.., last, _] = tokens[..]
            && last.kind == TokenKind::Content
            && part[last.start as usize..].starts_with(b"{{")
            && let Some(rest) = self.source.get(end..)
            && let Some(next) = strings::index_of(rest, b"{{")
            && rest[..next].ends_with(b"\\")
        {
            return Err(Stop::GivenUp);
        }
        // A string or a name in brackets only ends at a quote or a bracket with a backslash in front of it if no other
        // one follows, however far away.
        if strings::contains_char(part, b'\\')
            && tokens.iter().any(|token| {
                matches!(token.kind, TokenKind::String | TokenKind::Id)
                    && matches!(
                        part.get(..token.end as usize),
                        Some([.., b'\\', b'"' | b'\'' | b']'])
                    )
            })
        {
            return Err(Stop::GivenUp);
        }
        elements.clear();
        let mut printer = Printer {
            tree,
            source: part,
            front_matter: b"",
            options: self.options,
            is_white_space_sensitive: true,
            single_quote: self.quote == b'\'',
            out: elements,
            pre_depth: 0,
            stack: Stack::for_tree(),
        };
        // `{{! prettier-ignore }}` is about the next node but one, which has to be here, all of it. A text is printed
        // together with the white space at its end.
        if let Kind::Template { body } = tree.kind(template) {
            let nodes = tree.list(body);
            // The white space behind it has to be between two nodes, not between two words.
            if matches!(
                nodes.last().map(|last| tree.kind(*last)),
                Some(Kind::Text { .. })
            ) && is_before_text
            {
                return Err(Stop::GivenUp);
            }
            for (index, node) in nodes.iter().enumerate() {
                if printer.is_prettier_ignore(*node) {
                    let is_certain = match nodes.get(index + 2) {
                        Some(next) => {
                            index + 3 < nodes.len()
                                || !matches!(tree.kind(*next), Kind::Text { .. })
                        }
                        None => index + 1 == nodes.len() && end == self.source.len(),
                    };
                    if !is_certain {
                        return Err(Stop::GivenUp);
                    }
                }
            }
        }
        printer.part(template);
        if printer.stack.ran_out() {
            return Err(Stop::GivenUp);
        }
        let indent = self.indent(level);
        self.column = self
            .printer
            .print(&self.scratch.elements, indent, self.column);
        if self.printer.result().is_err() {
            return Err(Stop::GivenUp);
        }
        self.at = end;
        self.run = (end, end);
        self.lines += 1;
        Ok(())
    }
}

/// True if `{` or the control character 0x7F is in `text`.
#[inline]
fn has_brace(text: &[u8]) -> bool {
    const fn all(byte: u8) -> u64 {
        u64::from_ne_bytes([byte; 8])
    }
    // The two, and nothing else, are 0x7F with this bit.
    let (chunks, rest) = text.as_chunks::<8>();
    chunks.iter().any(|chunk| {
        let others = (u64::from_ne_bytes(*chunk) | all(4)) ^ all(0x7F);
        others.wrapping_sub(all(1)) & !others & all(0x80) != 0
    }) || rest.iter().any(|byte| byte | 4 == 0x7F)
}

/// What `find_end_of_nodes` finds.
enum Found {
    /// White space between two nodes, or the end of the template.
    End(usize),
    /// What ends the list that the nodes are in.
    EndOfList(usize),
}

/// `{{! a }}` or `{{!-- a --}}`
struct MustacheComment {
    value: usize,
    value_end: usize,
    end: usize,
    /// As it's printed.
    width: usize,
    is_as_printed: bool,
}
