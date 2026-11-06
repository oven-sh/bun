//! The short cut: plain YAML is printed while it's read.
//!
//! With `proseWrap: "preserve"`, nothing in a block mapping or a block sequence of one-line scalars depends on the
//! width of the page. What's printed for such a file is the file, line by line, with regular indentation, one space
//! where there were several, the preferred quotes and at most one empty line in a row. So no tokens, no tree and no
//! document are made. One scan over the lines keeps a stack of the open collections (the column of their items in the
//! source and in the output) and copies stretches of the source to the output. A file that's already formatted is one
//! stretch.
//!
//! An item whose value is something else (a scalar over several lines, a flow collection that doesn't fit on its line,
//! a value with properties) goes through the parser and the printer by itself: `key: value` and the lines below it that
//! are indented further are a document of their own, which is printed at the column of the key.
//!
//! Whatever isn't known for certain to come out the same makes the scan give up, and the whole text goes the long way:
//! explicit keys, tabs, directives, odd indentation, every syntax error, and the places where a comment changes how the
//! node that owns it is printed. `FormatOptions::no_short_cuts` turns this off.

use crate::FormatOptions;
use crate::css::doc::{self, Elements};
use crate::options::{LineEnding, ProseWrap, QuoteStyle};
use bun_core::strings;
use bun_highway::{YamlMarks, YamlMarksBuffer};

/// A plain scalar at the start of a line can start with it, whatever follows.
const LINE_START: u8 = 1;
/// A plain scalar can start with it, whatever follows.
const VALUE_START: u8 = 2;
/// A plain scalar in a flow collection has to look at it.
const FLOW_STOP: u8 = 4;
/// A plain scalar outside of flow collections has to look at it.
const STOP: u8 = 8;
/// The same where spaces are judged by what follows them: a line break, `:`, `#` and what isn't expected at all.
const STOP_LATE: u8 = 16;
/// A one-character escape in double quotes.
const ESCAPE: u8 = 32;
/// A line that ends with it isn't copied: a space or a tab, or the last byte of U+2028 or U+2029, which
/// `is_previous_line_empty` counts as a line break.
const BAD_END: u8 = 64;

const fn contains(set: &[u8], byte: u8) -> bool {
    let mut i = 0;
    while i < set.len() {
        if set[i] == byte {
            return true;
        }
        i += 1;
    }
    false
}

static CLASS: [u8; 256] = {
    let mut class = [0u8; 256];
    let mut c = 0usize;
    while c < 256 {
        let byte = c as u8;
        if c >= 33 && c != 127 && !contains(b"!\"#%&'*,-:>?@[]`{|}", byte) {
            class[c] |= VALUE_START;
            // These are the lead bytes of the characters that JavaScript counts as whitespace. A line that starts with
            // one can be an empty line to the printer.
            if !contains(&[0xC2, 0xE1, 0xE2, 0xE3, 0xEF], byte) {
                class[c] |= LINE_START;
            }
        }
        if c <= 32 || c >= 127 || contains(b":,[]{}", byte) {
            class[c] |= FLOW_STOP;
        }
        if c <= 32 || byte == b':' {
            class[c] |= STOP;
        }
        if c < 32 || byte == b':' || byte == b'#' {
            class[c] |= STOP_LATE;
        }
        if contains(b"0abefnrtvN_LP \"/\\", byte) {
            class[c] |= ESCAPE;
        }
        if contains(&[b' ', b'\t', 0xA8, 0xA9], byte) {
            class[c] |= BAD_END;
        }
        c += 1;
    }
    class
};

#[inline(always)]
fn is(byte: u8, class: u8) -> bool {
    CLASS[byte as usize] & class != 0
}

/// No position.
const NONE: usize = usize::MAX;

/// How many flow collections can be in each other.
const MAX_FLOW_DEPTH: usize = 9;

/// Number of bytes that are looked at together: as many as `Stops::window` has bits for, less one, because some things
/// are known by two bytes.
const WINDOW: usize = 56;

/// For each kind of byte, one bit per byte of a window, and of the byte after it. The lowest bit is the first byte.
#[derive(Copy, Clone)]
struct Masks {
    /// Control characters, among them the line break and what's after the end of the text.
    low: u64,
    spaces: u64,
    /// `:` and `#`.
    marks: u64,
}

impl Masks {
    /// Those of the window that starts at `at`.
    #[inline(always)]
    fn at(marks: YamlMarks<'_>, at: usize) -> Masks {
        Masks {
            low: marks.control.window(at),
            spaces: marks.spaces.window(at),
            marks: marks.indicators.window(at),
        }
    }

    /// One bit for each byte up to the end of the line or of the window.
    #[inline(always)]
    fn in_line(self) -> u64 {
        match self.low {
            0 => (1 << (WINDOW + 1)) - 1,
            low => (1 << low.trailing_zeros()) - 1,
        }
    }

    /// Each `:` and `#` in the line that has a space or the end of the line next to it, so that it can be the end of a
    /// key or the start of a comment. Nothing is known about what's after the last byte.
    #[inline(always)]
    fn indicators(self) -> u64 {
        self.marks & ((self.spaces | self.low) >> 1 | self.spaces << 1) & self.in_line()
    }
}

/// What `rest_of_line` finds.
struct RestOfLine {
    /// Where the first control character is.
    end: usize,
    /// See `Masks::indicators`.
    has_indicator: bool,
    /// Where the first quote or backslash is, or `NONE`.
    first_quote: usize,
}

/// Looks at a line from `from` on.
#[inline(never)]
fn rest_of_line(marks: YamlMarks<'_>, mut from: usize) -> RestOfLine {
    let mut has_indicator = false;
    let mut first_quote = NONE;
    loop {
        let masks = Masks::at(marks, from);
        has_indicator |= masks.indicators() != 0;
        let quotes = marks.quotes.window(from) & masks.in_line();
        if first_quote == NONE && quotes != 0 {
            first_quote = from + quotes.trailing_zeros() as usize;
        }
        if masks.low != 0 {
            return RestOfLine {
                end: from + masks.low.trailing_zeros() as usize,
                has_indicator,
                first_quote,
            };
        }
        from += WINDOW;
    }
}

/// An open block collection.
#[derive(Copy, Clone, Default)]
struct Level {
    /// The column of its items in the source.
    column: usize,
    /// The column of its items in the output.
    out: usize,
    /// Where the line starts on which it starts.
    first_line: usize,
    kind: Collection,
}

#[derive(Copy, Clone, Default, PartialEq, Eq)]
enum Collection {
    #[default]
    Mapping,
    Sequence,
    /// A sequence with an empty line after a comment before its last item.
    SpacedSequence,
}

impl Collection {
    #[inline(always)]
    fn is_sequence(self) -> bool {
        self != Collection::Mapping
    }
}

/// What the last line with content has left: the value of the last item of the innermost collection.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Last {
    /// The document hasn't begun.
    Nothing,
    /// A scalar or a flow collection.
    Inline,
    /// `key:`. What follows decides.
    Missing,
    BlockScalar,
    /// Something that went the long way.
    Other,
}

/// A comment on a line of its own.
#[derive(Copy, Clone)]
struct Comment {
    line_start: usize,
    hash: usize,
    /// Without whitespace at the end of the line.
    end: usize,
    /// The line break of an empty line before it, or `NONE`.
    empty_line: usize,
}

/// What a quoted scalar has between its quotes.
const HAS_BACKSLASH: u8 = 1;
/// In double quotes: an escape that single quotes can't express.
const KEEPS: u8 = 2;
const HAS_DOUBLE: u8 = 4;
const HAS_SINGLE: u8 = 8;

/// Allocations that can be reused for the next text.
#[derive(Default)]
pub(super) struct Scratch {
    levels: Vec<Level>,
    comments: Vec<Comment>,
    marks: YamlMarksBuffer,
}

/// The output as it was before the last line with content.
#[derive(Copy, Clone)]
struct Undo {
    len: usize,
    stretch: (usize, usize),
}

struct Scan<'a> {
    text: &'a [u8],
    marks: YamlMarks<'a>,
    options: &'a FormatOptions,
    /// The text as the file has it, for `endOfLine: "auto"`.
    original: &'a [u8],
    elements: &'a mut Elements,
    out: &'a mut Vec<u8>,
    /// A range of `text` that comes after `out` and hasn't been copied yet. It's made of whole lines.
    stretch: (usize, usize),
    new_line: &'static [u8],
    /// See `doc::Printer::literal_new_line`.
    literal_new_line: &'static [u8],
    tab_width: usize,
    width: usize,
    preferred_quote: u8,
    bracket_spacing: bool,

    /// `levels[..depth]` are open.
    levels: &'a mut Vec<Level>,
    depth: usize,
    last: Last,
    /// The last line with content ends with a comment.
    is_commented: bool,
    last_line_start: usize,
    /// The comments on lines of their own since the last line with content.
    comments: &'a mut Vec<Comment>,
    /// The last comment that was printed belongs to the document.
    ends_with_document_comment: bool,
    /// Number of items in the document's outermost collection so far.
    items: usize,

    /// Set if the last line with content can be taken back.
    undo: Option<Undo>,
    /// Where that line starts after its indentation.
    line_first: usize,
    /// Where its last item starts: a key, or the `-` before a value.
    item_first: usize,

    /// Number of items that went the long way, and their length.
    sections: usize,
    section_bytes: usize,
    /// Where the line after the last section starts.
    section_next: usize,
    /// The line break of an empty line after it, or `NONE`.
    section_empty_line: usize,

    /// Results of `scan_rest`: where the comment at the end of the line starts, or `NONE`,
    rest_hash: usize,
    /// where the line ends without whitespace,
    rest_end: usize,
    /// and where it ends: at a line break or at the end of the text.
    line_end: usize,
}

/// The start of a line with content.
struct Head {
    /// After the indentation and every `- `.
    first: usize,
    dashes: usize,
    /// Where the plain key that starts at `first` ends, or `NONE`.
    key_end: usize,
}

/// Appends the formatted `text`, whose line breaks are `\n`, to `out`. If it returns false, `out` is unchanged.
pub(super) fn format(
    text: &[u8],
    original: &[u8],
    options: &FormatOptions,
    scratch: &mut Scratch,
    elements: &mut Elements,
    out: &mut Vec<u8>,
) -> bool {
    if options.no_short_cuts
        || options.prose_wrap != ProseWrap::Preserve
        || options.flavor.is_oxfmt()
        || text.len() >= u32::MAX as usize / 2
        // The end of the text reads as a NUL.
        || strings::contains_char(text, 0)
    {
        return false;
    }
    let new_line: &[u8] = match options.line_ending.resolve(original) {
        LineEnding::Crlf => b"\r\n",
        LineEnding::Cr => b"\r",
        _ => b"\n",
    };
    let start = out.len();
    out.reserve(text.len() + 1);
    if scratch.levels.len() < 16 {
        scratch.levels.resize(16, Level::default());
    }
    scratch.comments.clear();
    let mut scan = Scan {
        text,
        marks: scratch.marks.find(text),
        options,
        original,
        elements,
        out,
        stretch: (0, 0),
        new_line,
        literal_new_line: if options.is_in_markdown {
            b"\r\n"
        } else {
            new_line
        },
        tab_width: options.indent_width.value() as usize,
        width: options.line_width.value() as usize,
        preferred_quote: match options.quote_style {
            QuoteStyle::Single => b'\'',
            _ => b'"',
        },
        bracket_spacing: options.bracket_spacing.value(),
        levels: &mut scratch.levels,
        depth: 0,
        last: Last::Nothing,
        is_commented: false,
        last_line_start: 0,
        comments: &mut scratch.comments,
        ends_with_document_comment: false,
        items: 0,
        undo: None,
        line_first: 0,
        item_first: 0,
        sections: 0,
        section_bytes: 0,
        section_next: 0,
        section_empty_line: NONE,
        rest_hash: NONE,
        rest_end: 0,
        line_end: 0,
    };
    let is_done = scan.run() && {
        scan.flush();
        !crate::is_too_long(scan.out.len())
    };
    if !is_done {
        out.truncate(start);
    }
    is_done
}

impl Scan<'_> {
    /// The byte at `at`, or 0 after the end of the text.
    #[inline(always)]
    fn at(&self, at: usize) -> u8 {
        match self.text.get(at) {
            Some(&byte) => byte,
            None => 0,
        }
    }

    /// Where the line that `from` is on ends: at its line break or at the end of the text.
    #[inline]
    fn end_of_line(&self, from: usize) -> usize {
        let rest = self.text.get(from..).unwrap_or_default();
        from + strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len())
    }

    #[inline(always)]
    fn skip_spaces(&self, mut at: usize) -> usize {
        while self.at(at) == b' ' {
            at += 1;
        }
        at
    }

    /// True if the line that ends at `end` ends with U+2028 or U+2029, which `is_previous_line_empty` counts as a line
    /// break.
    #[inline(always)]
    fn ends_with_line_separator(&self, end: usize) -> bool {
        matches!(self.at(end.wrapping_sub(1)), 0xA8 | 0xA9)
            && matches!(
                end.checked_sub(3)
                    .and_then(|start| self.text.get(start..end)),
                Some([0xE2, 0x80, _])
            )
    }

    /// `end` without the spaces and tabs before it.
    #[inline(always)]
    fn trim_end(&self, mut end: usize) -> usize {
        while end > 0 && matches!(self.at(end - 1), b' ' | b'\t') {
            end -= 1;
        }
        end
    }

    // ───────────────────────────── the output ─────────────────────────────

    /// Copies the stretch to the output.
    fn flush(&mut self) {
        let (start, end) = std::mem::take(&mut self.stretch);
        let lines = self.text.get(start..end).unwrap_or_default();
        if matches!(self.new_line, b"\n") {
            return self.out.extend_from_slice(lines);
        }
        for line in lines.split_inclusive(|&byte| byte == b'\n') {
            match line.split_last() {
                Some((b'\n', line)) => {
                    self.out.extend_from_slice(line);
                    self.out.extend_from_slice(self.new_line);
                }
                _ => self.out.extend_from_slice(line),
            }
        }
    }

    /// Appends `text[start..end]`, which is whole lines.
    #[inline(always)]
    fn put(&mut self, start: usize, end: usize) {
        if start == self.stretch.1 {
            self.stretch.1 = end;
            return;
        }
        self.flush();
        self.stretch = (start, end);
    }

    /// Starts a line that's written anew, with `indent` spaces. False if the output is too long by now.
    fn start_line(&mut self, indent: usize) -> bool {
        self.flush();
        if crate::is_too_long(self.out.len().saturating_add(indent)) {
            return false;
        }
        self.out.resize(self.out.len() + indent, b' ');
        true
    }

    #[inline(always)]
    fn copy(&mut self, start: usize, end: usize) {
        self.out
            .extend_from_slice(self.text.get(start..end).unwrap_or_default());
    }

    #[inline(always)]
    fn end_line(&mut self) {
        self.out.extend_from_slice(self.new_line);
    }

    /// An empty line that isn't copied from the source.
    fn put_empty_line(&mut self) {
        self.flush();
        self.end_line();
    }

    fn mark_undo(&mut self) {
        self.undo = Some(Undo {
            len: self.out.len(),
            stretch: self.stretch,
        });
    }

    fn push(&mut self, level: Level) {
        if self.depth >= self.levels.len() {
            self.levels.resize(self.depth * 2 + 16, Level::default());
        }
        self.levels[self.depth] = level;
        self.depth += 1;
    }

    /// The innermost open collection.
    #[inline(always)]
    fn top(&self) -> Level {
        self.levels[self.depth.saturating_sub(1)]
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// True if the comment `text[hash..end]` can be `# prettier-ignore`.
    #[inline]
    fn can_be_ignore_comment(&self, hash: usize, end: usize) -> bool {
        let comment = self.text.get(hash..end).unwrap_or_default();
        match comment.last() {
            Some(b'e') => comment.ends_with(b"-ignore"),
            Some(0..b' ' | 0x80..) => {
                strings::trim_js_whitespace_end(comment).ends_with(b"-ignore")
            }
            _ => false,
        }
    }

    /// Prints the comments that wait. The next line with content leaves `keep` collections open. `is_nested`: it starts
    /// the value of the `key:` before the comments. `out`: its column in the output. `is_at_end`: there's no such line,
    /// the text ends.
    ///
    /// `attach_comment` gives a comment to the innermost sequence item or mapping value that has ended and whose item
    /// starts to the left of it, searching from the owner of the comment before it. If there's none, the comment and
    /// all that follow belong to what comes next. False: the owner is printed differently because of the comment.
    fn print_comments(
        &mut self,
        keep: usize,
        is_nested: bool,
        out: usize,
        is_at_end: bool,
    ) -> bool {
        let depth = self.depth as isize;
        let keep = keep as isize;
        let lowest = (keep - 1).max(0);
        let mut level = depth - 1;
        let mut is_leading = is_nested || self.last == Last::Nothing;
        // Nothing of the document is above, or what's there swallows empty lines.
        let mut is_first = is_leading;
        let count = self.comments.len();
        let column_of = |comment: &Comment| comment.hash - comment.line_start;
        // `take_end_comments`: from the first one on that isn't indented further than the items of the outermost
        // collection, they belong to the document, unless the last of those items has no value.
        let mut document_from = count;
        if is_at_end && self.last == Last::Other {
            return false;
        }
        if is_at_end && !(self.depth == 1 && self.last == Last::Missing) {
            let column = self.levels[0].column;
            let mut comments = self.comments.iter();
            document_from = comments
                .position(|it| column_of(it) <= column)
                .unwrap_or(count);
        }
        self.ends_with_document_comment = false;
        // The outermost collection that starts on the last line with content.
        let mut outermost = depth;
        while outermost > 0
            && self.levels[outermost as usize - 1].first_line == self.last_line_start
        {
            outermost -= 1;
        }
        for index in 0..count {
            let Comment {
                line_start,
                hash,
                end,
                empty_line,
            } = self.comments[index];
            // 0: none, 1: the one in the source, 2: one that's added.
            let mut empty_line_kind = if empty_line != NONE { 1 } else { 0 };
            let column = hash - line_start;
            let mut to = out;
            if index == document_from {
                level = -1;
            }
            // A block scalar ends at the start of the line after it. If that's a comment, the search for the next
            // comment's owner finds the scalar on that line, and not the comment.
            let searches_again = index == 1
                && self.last == Last::BlockScalar
                && self.comments[0].empty_line == NONE
                && index < document_from
                && !is_nested;
            let level_before = if is_leading { -1 } else { level };
            if searches_again {
                is_leading = false;
                level = depth - 1;
            }
            if !is_leading {
                while level >= lowest {
                    let it = self.levels[level as usize];
                    if column > it.column {
                        if level != depth - 1 || it.kind.is_sequence() || self.last == Last::Missing
                        {
                            break;
                        }
                        // The value of the last line: a comment below a scalar moves the scalar to a line of its own,
                        // and a block scalar takes none.
                        if self.last != Last::BlockScalar {
                            return false;
                        }
                    }
                    level -= 1;
                }
                if level >= lowest {
                    let it = self.levels[level as usize];
                    // It would be printed before the first one.
                    if searches_again && level > level_before {
                        return false;
                    }
                    to = it.out
                        + if it.kind.is_sequence() {
                            2
                        } else {
                            self.tab_width
                        };
                    // A node with comments at its end doesn't let the comments before it keep the empty lines after
                    // them.
                    if it.kind == Collection::SpacedSequence {
                        return false;
                    }
                    // The search starts at the node on the last line that ends furthest to the right. For a collection
                    // that starts on that line and goes on below the comment, that's where its last line ends. Then the
                    // search starts at its first item.
                    if outermost < keep && (level >= keep || outermost < keep - 1) {
                        return false;
                    }
                    // Nobody has asked for the empty line after the comment at the end of the last line, so both that
                    // comment and this one do.
                    if index == 0 && self.is_commented && empty_line_kind != 0 {
                        return false;
                    }
                } else {
                    // It's added to the comments of the document after those that are there already.
                    if is_at_end && index < document_from && document_from < count {
                        return false;
                    }
                    is_leading = true;
                    // The first of the comments at the end of the document: after a block scalar there's an empty line
                    // before it. Otherwise only a mapping keeps the one that's there.
                    if is_at_end && !(searches_again && level_before < 0) {
                        if self.last == Last::BlockScalar {
                            empty_line_kind = 2;
                        } else if self.levels[0].kind.is_sequence() {
                            empty_line_kind = 0;
                        }
                    }
                }
            }
            if is_leading && is_at_end {
                self.ends_with_document_comment = true;
            }
            if !is_first {
                match empty_line_kind {
                    0 => {}
                    1 => self.put(empty_line, empty_line + 1),
                    _ => self.put_empty_line(),
                }
            }
            is_first = false;
            if column == to && self.at(end) == b'\n' {
                self.put(line_start, end + 1);
            } else {
                if !self.start_line(to) {
                    return false;
                }
                self.copy(hash, end);
                self.end_line();
            }
        }
        self.comments.clear();
        true
    }

    /// Prints the comments that wait, which are all there is before the first `---` or in the text. `empty_line` is the
    /// line break of an empty line after them, or `NONE`.
    fn print_only_comments(&mut self, empty_line: usize) -> bool {
        // The empty line is a `softline` in a group, which the line breaks between the comments break. With one comment
        // it depends.
        if empty_line != NONE && self.comments.len() == 1 {
            return false;
        }
        if !self.print_comments(0, false, 0, false) {
            return false;
        }
        if empty_line != NONE {
            self.put(empty_line, empty_line + 1);
        }
        true
    }

    // ───────────────────────────── scalars ─────────────────────────────

    /// A quoted scalar on one line that starts at `start`: where it ends, and what's in it.
    fn scan_quoted(&self, start: usize) -> Option<(usize, u8)> {
        let quote = self.at(start);
        let mut flags = 0;
        let mut at = start + 1;
        loop {
            let byte = self.at(at);
            if byte == quote {
                if quote == b'"' || self.at(at + 1) != b'\'' {
                    break;
                }
                flags |= HAS_SINGLE;
                at += 1;
            } else if byte < 32 {
                return None;
            } else if byte == b'\\' {
                flags |= HAS_BACKSLASH;
                if quote == b'"' {
                    let escaped = self.at(at + 1);
                    if !is(escaped, ESCAPE) {
                        return None;
                    }
                    flags |= if escaped == b'"' { HAS_DOUBLE } else { KEEPS };
                    at += 1;
                }
            } else if byte == b'"' {
                flags |= HAS_DOUBLE;
            } else if byte == b'\'' {
                flags |= HAS_SINGLE;
            }
            at += 1;
        }
        Some((at + 1, flags))
    }

    /// True if the quoted scalar that starts at `start` is printed as it's written.
    fn quoted_stays(&self, start: usize, flags: u8) -> bool {
        let is_double = self.at(start) == b'"';
        if flags & HAS_BACKSLASH != 0 && (!is_double || flags & KEEPS != 0) {
            true
        } else if flags & HAS_DOUBLE != 0 {
            !is_double
        } else if flags & HAS_SINGLE != 0 {
            is_double
        } else {
            self.at(start) == self.preferred_quote
        }
    }

    /// `Printer::print_quoted` for the scalar `text[from..to]`, which is on one line.
    fn write_quoted(&mut self, from: usize, to: usize, flags: u8) {
        if self.quoted_stays(from, flags) {
            return self.copy(from, to);
        }
        let content = self.text.get(from + 1..to - 1).unwrap_or_default();
        if flags & HAS_DOUBLE != 0 {
            // `\"` becomes `"`, and `'` becomes `''`.
            self.out.push(b'\'');
            for &byte in content {
                match byte {
                    b'\\' => {}
                    b'\'' => self.out.extend_from_slice(b"''"),
                    _ => self.out.push(byte),
                }
            }
            self.out.push(b'\'');
        } else if flags & HAS_SINGLE != 0 {
            // `''` becomes `'`.
            self.out.push(b'"');
            let mut bytes = content.iter();
            while let Some(&byte) = bytes.next() {
                self.out.push(byte);
                if byte == b'\'' {
                    bytes.next();
                }
            }
            self.out.push(b'"');
        } else {
            self.out.push(self.preferred_quote);
            self.out.extend_from_slice(content);
            self.out.push(self.preferred_quote);
        }
    }

    /// What comes after a value that ends at `from`: nothing, or a comment.
    fn scan_rest(&mut self, from: usize) -> bool {
        let mut at = self.skip_spaces(from);
        let byte = self.at(at);
        self.rest_hash = NONE;
        self.rest_end = from;
        if byte == b'#' {
            if at == from {
                return false;
            }
            self.rest_hash = at;
            at = self.end_of_line(at);
            self.rest_end = self.trim_end(at);
            if self.ends_with_line_separator(self.rest_end) {
                return false;
            }
        } else if byte != b'\n' && at < self.text.len() {
            return false;
        }
        self.line_end = at;
        true
    }

    /// A plain scalar from `start` to the end of its line or to a comment: where it ends. Also sets what `scan_rest`
    /// sets.
    fn scan_plain(&mut self, start: usize) -> Option<usize> {
        let mut at = start;
        loop {
            while !is(self.at(at), STOP) {
                at += 1;
            }
            match self.at(at) {
                b':' => {
                    if self.at(at + 1) <= 32 {
                        return None;
                    }
                }
                b' ' => {
                    if matches!(self.at(at + 1), b' ' | b'#' | b'\n' | 0) {
                        // Several spaces stay if they're inside.
                        let next = self.skip_spaces(at + 1);
                        if matches!(self.at(next), b'#' | b'\n' | 0) {
                            break;
                        }
                        at = next;
                        continue;
                    }
                }
                _ => break,
            }
            at += 1;
        }
        if self.ends_with_line_separator(at) {
            return None;
        }
        self.scan_rest(at).then_some(at)
    }

    // ───────────────────────────── flow collections ─────────────────────────────

    /// Writes the scalar in a flow collection that starts at `start`. Returns where it ends.
    fn flow_scalar(&mut self, start: usize) -> Option<usize> {
        let first = self.at(start);
        if matches!(first, b'"' | b'\'') {
            let (end, flags) = self.scan_quoted(start)?;
            if !self.text.get(start..end)?.iter().all(|&byte| byte < 127) {
                return None;
            }
            self.write_quoted(start, end, flags);
            return Some(end);
        }
        if (!is(first, VALUE_START) || first >= 127)
            && !(first == b'-' && !is(self.at(start + 1), FLOW_STOP))
        {
            return None;
        }
        let mut at = start;
        loop {
            while !is(self.at(at), FLOW_STOP) {
                at += 1;
            }
            match self.at(at) {
                b' ' => {
                    let next = self.skip_spaces(at + 1);
                    let byte = self.at(next);
                    if matches!(byte, b',' | b']' | b'}') {
                        break;
                    }
                    if is(byte, FLOW_STOP) || byte == b'#' {
                        return None;
                    }
                    at = next;
                }
                b':' => {
                    let byte = self.at(at + 1);
                    if byte == b' ' {
                        break;
                    }
                    if is(byte, FLOW_STOP) {
                        return None;
                    }
                    at += 1;
                }
                b',' | b']' | b'}' => break,
                _ => return None,
            }
        }
        self.copy(start, at);
        Some(at)
    }

    /// Writes the flow collection that starts at `start` the way it's printed on one line, if it's on one line. Returns
    /// where it ends.
    fn flow(&mut self, start: usize, depth: usize) -> Option<usize> {
        let is_mapping = self.at(start) == b'{';
        let close = if is_mapping { b'}' } else { b']' };
        // What's nested deeper goes the long way, which asks the stack.
        if depth >= MAX_FLOW_DEPTH {
            return None;
        }
        self.out.push(self.at(start));
        let mut at = self.skip_spaces(start + 1);
        if self.at(at) == close {
            self.out.push(close);
            return Some(at + 1);
        }
        let has_spaces = is_mapping && self.bracket_spacing;
        if has_spaces {
            self.out.push(b' ');
        }
        loop {
            if is_mapping {
                at = self.flow_scalar(at)?;
                if self.at(at) != b':' || self.at(at + 1) != b' ' {
                    return None;
                }
                self.out.extend_from_slice(b": ");
                at = self.skip_spaces(at + 2);
            }
            at = match self.at(at) {
                b'[' | b'{' => self.flow(at, depth + 1)?,
                _ => self.flow_scalar(at)?,
            };
            at = self.skip_spaces(at);
            let byte = self.at(at);
            if byte == close {
                break;
            }
            if byte != b',' {
                return None;
            }
            at = self.skip_spaces(at + 1);
            self.out.extend_from_slice(b", ");
        }
        if has_spaces {
            self.out.push(b' ');
        }
        self.out.push(close);
        Some(at + 1)
    }

    // ───────────────────────────── lines ─────────────────────────────

    /// The start of a line with content. `at` is after its indentation.
    fn scan_head(&self, mut at: usize) -> Option<Head> {
        let mut dashes = 0;
        while self.at(at) == b'-' && self.at(at + 1) == b' ' {
            dashes += 1;
            at += 2;
            if self.at(at) == b' ' {
                return None;
            }
        }
        let mut head = Head {
            first: at,
            dashes,
            key_end: NONE,
        };
        if !is(
            self.at(at),
            if dashes == 0 { LINE_START } else { VALUE_START },
        ) {
            return Some(head);
        }
        loop {
            while !is(self.at(at), STOP_LATE) {
                at += 1;
            }
            let byte = self.at(at);
            if byte == b':' {
                let next = self.at(at + 1);
                if next <= 32 {
                    if matches!(next, b' ' | b'\n' | 0) && self.at(at - 1) != b' ' {
                        head.key_end = at;
                    }
                    return Some(head);
                }
            } else if byte != b'#' || self.at(at - 1) == b' ' {
                return Some(head);
            }
            at += 1;
        }
    }

    /// If a quoted key starts at `start`: where it ends, and what's in it.
    fn scan_quoted_key(&self, start: usize) -> Option<(usize, u8)> {
        if !matches!(self.at(start), b'"' | b'\'') {
            return None;
        }
        let (end, flags) = self.scan_quoted(start)?;
        (self.at(end) == b':' && matches!(self.at(end + 1), b' ' | b'\n' | 0))
            .then_some((end, flags))
    }

    /// The lines of a block scalar. `start`: where the line after its header starts. They're indented by at least
    /// `least` columns, and by `out` in the output. Returns where the first line starts that isn't part of it, and the
    /// line break of an empty line after the scalar, or `NONE`.
    #[inline(never)]
    fn block_lines(&mut self, start: usize, least: usize, out: usize) -> Option<(usize, usize)> {
        let limit = self.text.len();
        let mut line = start;
        let mut at = self.skip_spaces(line);
        let indent = at - line;
        if indent < least || matches!(self.at(at), b'\n' | b'\t') || at >= limit {
            return None;
        }
        // A line break in the scalar is a literal one, which isn't always what the source has.
        let is_same = indent == out && matches!(self.literal_new_line, b"\n");
        // Empty lines that wait for a line with content.
        let mut empty_lines = 0;
        let mut last_empty_line = NONE;
        let mut is_first = true;
        loop {
            let byte = self.at(at);
            if byte == b'\n' {
                // A line with more whitespace than the indentation is content. One with less is only copied if it's
                // empty in the source.
                if at - line > indent || (at != line && is_same) {
                    return None;
                }
                empty_lines += 1;
                last_empty_line = at;
                line = at + 1;
                at = self.skip_spaces(line);
                continue;
            }
            if at >= limit {
                if at != line {
                    return None;
                }
                break;
            }
            if at - line < indent {
                if byte == b'\t' {
                    return None;
                }
                break;
            }
            let end = self.end_of_line(line + indent);
            if self.ends_with_line_separator(self.trim_end(end)) {
                return None;
            }
            if is_same && self.at(end) == b'\n' {
                self.put(line - empty_lines, end + 1);
            } else {
                self.flush();
                if !is_first && !is_same {
                    self.out.extend_from_slice(self.literal_new_line);
                }
                for _ in 0..empty_lines {
                    self.end_line();
                }
                if !self.start_line(out) {
                    return None;
                }
                self.copy(line + indent, end);
                // With `is_same`, this is the last line of the text.
                if is_same {
                    self.end_line();
                }
            }
            is_first = false;
            empty_lines = 0;
            last_empty_line = NONE;
            if end >= limit {
                line = end;
                break;
            }
            line = end + 1;
            at = self.skip_spaces(line);
        }
        if !is_same {
            self.end_line();
        }
        Some((line, last_empty_line))
    }

    // ───────────────────────────── the long way for one item ─────────────────────────────

    /// True if `text[..end]` ends with what can be the header of a block scalar: `|` or `>` with its indicators, after
    /// whitespace or directly after a property.
    fn ends_with_block_scalar_header(&self, mut end: usize) -> bool {
        while matches!(self.at(end.wrapping_sub(1)), b'-' | b'+' | b'0'..=b'9') {
            end -= 1;
        }
        if !matches!(self.at(end.wrapping_sub(1)), b'|' | b'>') {
            return false;
        }
        let before = self.text.get(..end - 1).unwrap_or_default();
        let word = before
            .iter()
            .rposition(|&byte| byte <= 32)
            .map_or(0, |it| it + 1);
        matches!(before.get(word), None | Some(b'!' | b'&'))
    }

    /// True if the line `text[start..end]` can have the header of a block scalar in it: at its end, or in front of a
    /// comment. Which `#` after whitespace starts the comment depends on the quotes before it, so each of them counts.
    fn can_have_block_scalar_header(&self, start: usize, mut end: usize) -> bool {
        loop {
            if self.ends_with_block_scalar_header(self.trim_end(end)) {
                return true;
            }
            loop {
                let line = self.text.get(start..end).unwrap_or_default();
                match strings::last_index_of_char(line, b'#') {
                    Some(hash) if hash > 0 => end = start + hash,
                    _ => return false,
                }
                if self.at(end - 1) <= 32 {
                    break;
                }
            }
        }
    }

    /// The item that starts at `start`, in `column` of its line, reaches as far as the lines are indented further.
    /// Returns where its last line ends. `None`: it has a comment on a line of its own, which could belong to something
    /// outside, or a block scalar, whose printing depends on what's around it.
    fn section_end(&mut self, start: usize, column: usize) -> Option<usize> {
        let limit = self.text.len();
        let mut at = start;
        loop {
            // `at` is after the indentation of a line of the section.
            if matches!(self.at(at), b'#' | b'\t') {
                return None;
            }
            // It can be an empty line to the printer, which then looks at what's after it.
            if self.at(at) >= 0x80
                && strings::js_whitespace_len(self.text.get(at..).unwrap_or_default()) != 0
            {
                return None;
            }
            if matches!(self.at(at), b'?' | b':') && self.at(at + 1) <= 32 {
                return None;
            }
            let line_end = self.end_of_line(at);
            let end = self.trim_end(line_end);
            if self.ends_with_line_separator(end) {
                return None;
            }
            if self.can_have_block_scalar_header(at, end) {
                return None;
            }
            let mut empty_line = NONE;
            let mut next = line_end + 1;
            let is_over = loop {
                if next > limit {
                    next = limit;
                    break true;
                }
                at = self.skip_spaces(next);
                if self.at(at) != b'\n' {
                    break at >= limit || at - next <= column;
                }
                empty_line = at;
                next = at + 1;
            };
            if is_over {
                self.section_next = next;
                self.section_empty_line = empty_line;
                return Some(end);
            }
        }
    }

    /// True if the quoted scalar or flow collection that starts at `at` goes on after the end of the line. False also
    /// if that's hard to tell.
    fn stays_open(&self, mut at: usize) -> bool {
        let mut depth = 0usize;
        loop {
            let byte = self.at(at);
            match byte {
                0..32 => return byte == b'\n' && depth > 0,
                b'"' | b'\'' => {
                    at += 1;
                    loop {
                        let inner = self.at(at);
                        if inner < 32 {
                            return inner == b'\n' && depth == 0;
                        }
                        if inner == byte {
                            break;
                        }
                        if inner == b'\\' && byte == b'"' {
                            at += 1;
                        }
                        at += 1;
                    }
                    if depth == 0 {
                        return false;
                    }
                }
                b'[' | b'{' => depth += 1,
                b']' | b'}' => {
                    if depth <= 1 {
                        return false;
                    }
                    depth -= 1;
                }
                _ => {}
            }
            at += 1;
        }
    }

    /// Sends the last item of the innermost collection the long way. It starts at `start`, on a line that starts at
    /// `first` after its indentation and hasn't been printed. False: that can't be done, or the item has a syntax
    /// error.
    ///
    /// As a document of its own the item starts in column 0, while the lines below it keep their indentation. That makes
    /// no difference if no block collection starts on its first line: `is_simple`.
    fn delegate(&mut self, first: usize, start: usize, is_simple: bool) -> bool {
        let Level { column, out, .. } = self.top();
        let Some(end) = self.section_end(start, column) else {
            return false;
        };
        if !is_simple && column != 0 && strings::contains_char(&self.text[start..end], b'\n') {
            return false;
        }
        // At the start of a text it's a byte order mark.
        if self.text[start..].starts_with(crate::text::BOM) {
            return false;
        }
        // By itself an item costs more than among the others. Nothing is gained if a large part goes this way.
        self.sections += 1;
        self.section_bytes += end - start;
        if self.sections > 8 && self.section_bytes * 8 > self.section_next {
            return false;
        }
        if !self.start_line(out.saturating_sub(start - first)) {
            return false;
        }
        self.copy(first, start);
        // With the empty line after it: a node that ends on the last line can ask for that.
        let window_end = match self.section_empty_line {
            NONE => end,
            empty_line => empty_line + 1,
        };
        let window = &self.text[start..window_end];
        self.elements.clear();
        let Some(last_comment_end) =
            super::write_only_item(window, self.options, out, self.elements)
        else {
            return false;
        };
        let mut printer = doc::Printer::new(self.options, self.original, self.out);
        printer.print(self.elements, 0, out);
        if printer.result().is_err() {
            return false;
        }
        // What the line break that follows does in the printer.
        while matches!(self.out.last(), Some(b' ' | b'\t')) {
            self.out.pop();
        }
        self.end_line();
        self.undo = None;
        self.last = Last::Other;
        self.is_commented = last_comment_end >= end - start;
        // Who asks for the empty line after it depends on the owner of the comment.
        !(self.is_commented && self.section_empty_line != NONE)
    }

    /// The line at hand is indented further than the last item and doesn't start a collection, so it belongs to the
    /// value of that item.
    fn delegate_last(&mut self) -> bool {
        let Some(undo) = self.undo.filter(|_| self.comments.is_empty()) else {
            return false;
        };
        self.out.truncate(undo.len);
        self.stretch = undo.stretch;
        self.delegate(self.line_first, self.item_first, true)
    }

    // ───────────────────────────── the most common lines ─────────────────────────────

    /// Does what the loop of `run` does, for nothing but the most common lines:
    ///
    /// ```yaml
    /// key: value
    /// key:
    /// - value
    /// - key: value
    /// - key:
    /// ```
    ///
    /// with plain keys, and plain scalars or quoted ones with nothing to escape, where nothing changes but the
    /// indentation and the quotes, single empty lines between them, and comments on lines of their own that are where
    /// the next such line is and is printed. Takes such lines from `start` on and returns where the first other line
    /// starts. No comments wait, no empty line does, and the document has begun. `None`: the output is too long.
    ///
    /// It's a function of its own so that what it keeps track of stays in registers.
    #[inline(never)]
    fn plain_lines(&mut self, start: usize) -> Option<usize> {
        let text = self.text;
        let marks = self.marks;
        let at = |at: usize| -> u8 {
            match text.get(at) {
                Some(&byte) => byte,
                None => 0,
            }
        };
        let step = self.tab_width;
        let preferred = self.preferred_quote;
        let mut p = start;
        // The lines from here on stay as they are, and aren't part of the output yet.
        let mut from = start;
        let mut top = self.depth - 1;
        let Level {
            column, out, kind, ..
        } = self.levels[top];
        // Of the items of the innermost collection, in the source.
        let mut column = column;
        let mut is_sequence = kind.is_sequence();
        // How far to the right of that they're printed.
        let mut shift = out as isize - column as isize;
        let mut state = self.last;
        let mut count = self.items;
        // Where the last line that was taken starts, where it does after its indentation, and its last item.
        let (mut last_start, mut last_line, mut last_item) = (start, start, start);
        let mut is_last_rewritten = false;
        // Where the comments start that have been seen since the last line that was taken, or `NONE`.
        let mut waiting = NONE;
        let mut waiting_column = 0;
        // There's an empty line before the first of them,
        let mut is_waiting_after_empty_line = false;
        // after one of them.
        let mut is_spaced = false;
        loop {
            // What's the line like, and where does it go? Nothing is changed yet.
            let has_empty_line = at(p) == b'\n';
            let line_start = p + usize::from(has_empty_line);
            let masks = Masks::at(marks, line_start);
            let Masks { low, spaces, .. } = masks;
            let byte = |column: usize| at(line_start + column);
            let n = (!spaces).trailing_zeros() as usize;
            if n > WINDOW - 8 {
                break;
            }
            let head = line_start + n;
            let has_dash = byte(n) == b'-' && spaces >> (n + 1) & 1 != 0;
            let first = n + 2 * usize::from(has_dash);
            let q = line_start + first;
            let c = byte(first);
            // `...` ends the document.
            if c == b'.' && n == 0 && at(q + 1) == b'.' && at(q + 2) == b'.' && at(q + 3) <= 32 {
                break;
            }
            let is_quoted_item = has_dash && matches!(c, b'"' | b'\'');
            if !is(c, if has_dash { VALUE_START } else { LINE_START }) && !is_quoted_item {
                if c != b'#' || has_dash {
                    break;
                }
                // A comment. It belongs to the next line with content if it isn't indented further than that.
                if waiting == NONE {
                    waiting = p;
                    waiting_column = n;
                    is_waiting_after_empty_line = has_empty_line;
                } else {
                    if n != waiting_column {
                        break;
                    }
                    is_spaced |= has_empty_line;
                }
                let end = match low {
                    0 => self.end_of_line(q),
                    _ => line_start + low.trailing_zeros() as usize,
                };
                if at(end) != b'\n'
                    || is(at(end - 1), BAD_END)
                    || self.can_be_ignore_comment(q, end)
                {
                    break;
                }
                p = end + 1;
                continue;
            }
            if top + 3 >= self.levels.len() {
                break;
            }
            // It's an item of this collection, or
            let mut level = top;
            // it starts the value of the `key:` before.
            let mut is_nested = false;
            if n != column || has_dash != is_sequence {
                if state == Last::Missing && (n > column || (n == column && has_dash)) {
                    if has_empty_line {
                        break;
                    }
                    is_nested = true;
                } else {
                    let levels = &self.levels[..=top];
                    let found = levels.iter().rposition(|it| {
                        !(it.column > n || (it.column == n && it.kind.is_sequence() && !has_dash))
                    });
                    match found {
                        Some(found)
                            if levels[found].column == n
                                && levels[found].kind.is_sequence() == has_dash =>
                        {
                            level = found;
                        }
                        _ => break,
                    }
                }
            }
            if waiting != NONE {
                // The comments stay as they are if they're where this line is, and that's where it's printed.
                let stays = waiting_column == n
                    && match is_nested {
                        true => !is_waiting_after_empty_line && self.levels[top].out + step == n,
                        false => self.levels[level].out == n,
                    };
                if !stays {
                    break;
                }
                is_spaced |= has_empty_line;
            }

            // Where the line ends, and what's in the part of it that's after the window.
            let rest = match low {
                0 => rest_of_line(marks, line_start + WINDOW),
                _ => RestOfLine {
                    end: line_start + low.trailing_zeros() as usize,
                    has_indicator: false,
                    first_quote: NONE,
                },
            };
            let end = rest.end;
            if at(end) != b'\n' || is(at(end - 1), BAD_END) {
                break;
            }
            let indicators = masks.indicators();
            let is_pair = indicators != 0 && !is_quoted_item;
            let mut has_value = true;
            // Where the value starts.
            let mut value = first;
            if is_pair {
                // The first one ends the key: a `:` with no space before it and one after it.
                let key_end = indicators.trailing_zeros() as usize;
                if key_end > WINDOW - 8
                    || byte(key_end) != b':'
                    || (spaces | low) >> (key_end + 1) & 1 == 0
                    || spaces >> (key_end - 1) & 1 != 0
                    || (spaces & masks.in_line()) >> (key_end + 2) & 1 != 0
                {
                    break;
                }
                has_value = line_start + key_end + 1 != end;
                value = key_end + 2;
            } else if !has_dash || (rest.has_indicator && !is_quoted_item) {
                break;
            }
            // Where the value starts, if it gets other quotes.
            let mut quoted = NONE;
            if has_value {
                let first = byte(value);
                if is(first, VALUE_START) {
                    // Neither a second `: ` nor a comment.
                    if indicators & indicators.wrapping_sub(1) != 0 || rest.has_indicator {
                        break;
                    }
                } else if matches!(first, b'"' | b'\'') {
                    // It ends the line, and there's neither a quote nor a backslash in it.
                    let inside = marks.quotes.window(line_start + value + 1);
                    let close = match inside {
                        0 => rest.first_quote,
                        _ => line_start + value + 1 + inside.trailing_zeros() as usize,
                    };
                    if close != end - 1 || at(close) != first {
                        break;
                    }
                    if first != preferred {
                        quoted = line_start + value;
                    }
                } else {
                    break;
                }
            }
            let r = end;

            // It's taken.
            if is_nested {
                let to = self.levels[top].out + step;
                top += 1;
                self.levels[top] = Level {
                    column: n,
                    out: to,
                    first_line: line_start,
                    kind: Collection::Mapping,
                };
                column = n;
                is_sequence = has_dash;
                shift = to as isize - n as isize;
            } else {
                if level != top {
                    top = level;
                    column = n;
                    is_sequence = has_dash;
                    shift = self.levels[top].out as isize - n as isize;
                }
                if top == 0 {
                    count += 1;
                }
            }
            if has_dash {
                self.levels[top].kind = match is_spaced && !is_nested {
                    true => Collection::SpacedSequence,
                    false => Collection::Sequence,
                };
                if is_pair {
                    top += 1;
                    column = n + 2;
                    self.levels[top] = Level {
                        column,
                        out: (column as isize + shift) as usize,
                        first_line: line_start,
                        kind: Collection::Mapping,
                    };
                    is_sequence = false;
                }
            }
            state = if has_value {
                Last::Inline
            } else {
                Last::Missing
            };
            last_start = line_start;
            last_line = head;
            last_item = if is_pair { q } else { head };
            p = r + 1;
            waiting = NONE;
            is_spaced = false;
            is_last_rewritten = shift != 0 || quoted != NONE;
            if is_last_rewritten {
                if from < line_start {
                    self.put(from, line_start);
                }
                self.mark_undo();
                if !self.start_line((n as isize + shift) as usize) {
                    return None;
                }
                if quoted != NONE {
                    self.copy(head, quoted);
                    self.out.push(preferred);
                    self.copy(quoted + 1, p - 2);
                    self.out.push(preferred);
                } else {
                    self.copy(head, p - 1);
                }
                self.end_line();
                from = p;
            }
        }
        if waiting != NONE {
            p = waiting;
        }
        if p != start {
            self.depth = top + 1;
            self.last = state;
            self.items = count;
            self.is_commented = false;
            self.last_line_start = last_start;
            self.line_first = last_line;
            self.item_first = last_item;
            if !is_last_rewritten {
                if from < last_start {
                    self.put(from, last_start);
                }
                self.mark_undo();
                self.put(last_start, p);
            }
        }
        Some(p)
    }

    // ───────────────────────────── all lines ─────────────────────────────

    #[inline(never)]
    fn run(&mut self) -> bool {
        let limit = self.text.len();
        let mut p = 0;
        // The line break of the last empty line since the last line that wasn't empty, or `NONE`.
        let mut empty_line = NONE;
        // The document starts with `---`,
        let mut is_marked = false;
        // and the one before it ends with a block scalar.
        let mut is_after_block_scalar = false;
        loop {
            if self.last != Last::Nothing && empty_line == NONE && self.comments.is_empty() {
                match self.plain_lines(p) {
                    Some(next) => p = next,
                    None => return false,
                }
            }
            let q = self.skip_spaces(p);
            let c = self.at(q);
            if c == b'\n' {
                empty_line = q;
                p = q + 1;
                continue;
            }
            if c == b'#' {
                let line_end = self.end_of_line(q);
                let end = self.trim_end(line_end);
                if self.can_be_ignore_comment(q, end) || self.ends_with_line_separator(end) {
                    return false;
                }
                self.comments.push(Comment {
                    line_start: p,
                    hash: q,
                    end,
                    empty_line,
                });
                empty_line = NONE;
                p = line_end + 1;
                if p > limit {
                    break;
                }
                continue;
            }
            if q >= limit {
                break;
            }
            let n = q - p;
            if n == 0
                && matches!(c, b'-' | b'.')
                && self.at(q + 1) == c
                && self.at(q + 2) == c
                && self.at(q + 3) <= 32
            {
                // `---` between two documents or before the first.
                if c == b'.' || self.at(q + 3) != b'\n' || (self.last == Last::Nothing && is_marked)
                {
                    return false;
                }
                if !self.comments.is_empty() {
                    if self.last != Last::Nothing || !self.print_only_comments(empty_line) {
                        return false;
                    }
                    empty_line = NONE;
                }
                // The empty line after a document is a `softline` in the document's group. The line breaks between the
                // items of the outermost collection break that group. With one item it depends.
                if empty_line != NONE && self.last != Last::Nothing {
                    if self.items <= 1 {
                        return false;
                    }
                    self.put(empty_line, empty_line + 1);
                }
                self.items = 0;
                self.put(q, q + 4);
                is_marked = true;
                is_after_block_scalar = self.last == Last::BlockScalar;
                self.undo = None;
                self.depth = 0;
                self.last = Last::Nothing;
                empty_line = NONE;
                p = q + 4;
                continue;
            }

            // What's the line like?
            if !matches!(self.last, Last::Nothing | Last::BlockScalar) && n > self.top().column {
                // Part of the value of the last item, unless it starts a collection below `key:`.
                if c == b'\t' {
                    return false;
                }
                let starts_collection = self.last == Last::Missing
                    && self.scan_head(q).is_some_and(|head| {
                        head.dashes != 0
                            || head.key_end != NONE
                            || self.scan_quoted_key(q).is_some()
                    });
                if !starts_collection {
                    if !self.delegate_last() {
                        return false;
                    }
                    p = self.section_next;
                    empty_line = self.section_empty_line;
                    if p >= limit {
                        break;
                    }
                    continue;
                }
            }
            let Some(Head {
                first,
                dashes,
                mut key_end,
            }) = self.scan_head(q)
            else {
                return false;
            };
            // `None`: a plain key.
            let mut key_flags = None;
            if key_end == NONE {
                if let Some((end, flags)) = self.scan_quoted_key(first) {
                    key_end = end;
                    key_flags = Some(flags);
                } else if dashes == 0 {
                    return false;
                }
            }
            let has_key = key_end != NONE;
            if has_key && key_end - first > 1000 {
                return false;
            }

            // Where does it go?
            let is_sequence = dashes != 0;
            let mut keep = self.depth;
            let mut is_nested = false;
            let mut out = 0;
            if self.last == Last::Missing
                && (n > self.top().column || (n == self.top().column && is_sequence))
            {
                is_nested = true;
                out = self.top().out + self.tab_width;
            } else {
                while keep > 0 && {
                    let it = self.levels[keep - 1];
                    it.column > n || (it.column == n && it.kind.is_sequence() && !is_sequence)
                } {
                    keep -= 1;
                }
                if keep == 0 {
                    if self.last != Last::Nothing {
                        return false;
                    }
                } else {
                    let it = self.levels[keep - 1];
                    if it.column != n || it.kind.is_sequence() != is_sequence {
                        return false;
                    }
                    out = it.out;
                }
            }
            // There's an empty line after one of the comments.
            let mut is_spaced = false;
            if !self.comments.is_empty() {
                // A document that ends with a block scalar reaches as far as the line after `---`.
                if self.last == Last::Nothing && is_after_block_scalar {
                    return false;
                }
                is_spaced =
                    empty_line != NONE || self.comments[1..].iter().any(|it| it.empty_line != NONE);
                if !self.print_comments(keep, is_nested, out, false) {
                    return false;
                }
                if empty_line != NONE {
                    self.put(empty_line, empty_line + 1);
                }
            } else if empty_line != NONE && !is_nested && self.last != Last::Nothing {
                self.put(empty_line, empty_line + 1);
            } else if empty_line != NONE && is_nested && self.is_commented {
                // The comment asks for the empty line.
                return false;
            }
            if keep > 0 && !is_nested && is_sequence {
                self.levels[keep - 1].kind = match is_spaced {
                    true => Collection::SpacedSequence,
                    false => Collection::Sequence,
                };
            }
            empty_line = NONE;
            self.depth = keep;
            if keep <= 1 && !is_nested {
                self.items += 1;
            }
            self.last_line_start = p;
            let level = |offset: usize, kind: Collection| Level {
                column: n + offset,
                out: out + offset,
                first_line: p,
                kind,
            };
            if is_nested || keep == 0 {
                self.push(level(
                    0,
                    match is_sequence {
                        true => Collection::Sequence,
                        false => Collection::Mapping,
                    },
                ));
            }
            for index in 1..dashes {
                self.push(level(index * 2, Collection::Sequence));
            }
            if is_sequence && has_key {
                self.push(level(dashes * 2, Collection::Mapping));
            }
            // The column of the item whose value follows.
            let item_out = self.top().out;

            // The value.
            #[derive(PartialEq, Eq, Copy, Clone)]
            enum Value {
                Missing,
                AsWritten,
                Quoted,
                BlockScalarHeader,
                Flow,
                LongWay,
            }
            let value = match has_key {
                true => self.skip_spaces(key_end + 1),
                false => first,
            };
            let v = self.at(value);
            let mut kind = Value::AsWritten;
            let mut value_end = value;
            let mut value_flags = 0;
            let mut is_same =
                n == out && key_flags.is_none_or(|flags| self.quoted_stays(first, flags));
            if v == b'\n' || value >= limit {
                if !has_key {
                    return false;
                }
                kind = Value::Missing;
                self.rest_hash = NONE;
                self.line_end = value;
                is_same &= value == key_end + 1;
            } else {
                is_same &= !has_key || value == key_end + 2 || v == b'#';
                match v {
                    b'"' | b'\'' => {
                        kind = Value::LongWay;
                        if let Some((end, flags)) = self.scan_quoted(value) {
                            (value_end, value_flags) = (end, flags);
                            if self.scan_rest(end) {
                                kind = Value::Quoted;
                            }
                            is_same &= self.quoted_stays(value, flags);
                        }
                    }
                    b'|' | b'>' => {
                        kind = Value::BlockScalarHeader;
                        value_end = value + if self.at(value + 1) == b'-' { 2 } else { 1 };
                        if self.at(value_end) != b'\n' {
                            return false;
                        }
                        // It's after a key if that fits.
                        if has_key
                            && (key_flags.is_some()
                                || out + (key_end - q) + 2 + (value_end - value) > self.width
                                || !self.text[first..key_end].iter().all(|&byte| byte < 127))
                        {
                            return false;
                        }
                        self.rest_hash = NONE;
                        self.rest_end = value_end;
                        self.line_end = value_end;
                    }
                    b'[' | b'{' => kind = Value::Flow,
                    b'#' if has_key => {
                        kind = Value::Missing;
                        value_end = key_end + 1;
                        // If a collection follows, the comment belongs to the key, which then has to fit on the line.
                        if !self.scan_rest(value_end)
                            || key_flags.is_some()
                            || out + (key_end - q) + 1 > self.width
                            || !self.text[first..key_end].iter().all(|&byte| byte < 127)
                        {
                            return false;
                        }
                    }
                    b'*' => {
                        value_end = value + 1;
                        while !is(self.at(value_end), FLOW_STOP) {
                            value_end += 1;
                        }
                        if value_end == value + 1 || !self.scan_rest(value_end) {
                            kind = Value::LongWay;
                        }
                    }
                    _ => {
                        let end = (is(v, VALUE_START) || (v == b'-' && self.at(value + 1) > 32))
                            .then(|| self.scan_plain(value))
                            .flatten();
                        match end {
                            Some(end) => value_end = end,
                            None => kind = Value::LongWay,
                        }
                    }
                }
            }

            // The line.
            self.mark_undo();
            if kind == Value::BlockScalarHeader {
                self.undo = None;
            }
            self.line_first = q;
            self.item_first = if has_key { first } else { first - 2 };
            let write_up_to_value = |scan: &mut Self, has_value: bool| {
                match (has_key, key_flags) {
                    (false, _) => scan.copy(q, first),
                    (true, None) => scan.copy(q, key_end + 1),
                    (true, Some(flags)) => {
                        scan.copy(q, first);
                        scan.write_quoted(first, key_end, flags);
                        scan.out.push(b':');
                    }
                }
                if has_key && has_value {
                    scan.out.push(b' ');
                }
            };
            if kind == Value::Flow {
                // The long way makes the indentation of each line that could start in it, and fails if that's too long.
                let deepest = self.tab_width.saturating_mul(MAX_FLOW_DEPTH + 1);
                if crate::is_too_long((item_out + 2).saturating_add(deepest)) {
                    return false;
                }
                // It's written, to see how long it is.
                let before = Undo {
                    len: self.out.len(),
                    stretch: self.stretch,
                };
                if !self.start_line(out) {
                    return false;
                }
                let line = self.out.len() - out;
                write_up_to_value(self, true);
                let is_ascii_key =
                    !has_key || self.text[first..key_end].iter().all(|&byte| byte < 127);
                // A comment after it doesn't count.
                let fits = is_ascii_key
                    && self.flow(value, 0).is_some_and(|end| {
                        self.out.len() - line <= self.width && self.scan_rest(end)
                    });
                if fits {
                    if self.rest_hash != NONE {
                        self.out.push(b' ');
                        self.copy(self.rest_hash, self.rest_end);
                    }
                    self.end_line();
                } else {
                    self.out.truncate(before.len);
                    self.stretch = before.stretch;
                    kind = Value::LongWay;
                }
            }
            if kind == Value::LongWay {
                // A comment after nothing belongs to the item.
                if v == b'#' || (v == b'?' && self.at(value + 1) <= 32) {
                    return false;
                }
                let mut is_simple = matches!(v, b'"' | b'\'' | b'[' | b'{');
                // After `- ` that can be a key, unless it doesn't end on this line.
                if is_simple && !has_key {
                    is_simple = self.stays_open(value);
                }
                if has_key && matches!(v, b'&' | b'!') {
                    // Nothing but properties?
                    let mut end = value;
                    while self.at(end) > 32
                        || (self.at(end) == b' ' && matches!(self.at(end + 1), b'&' | b'!'))
                    {
                        end += 1;
                    }
                    is_simple = self.at(end) == b'\n';
                }
                if !self.delegate(q, self.item_first, is_simple) {
                    return false;
                }
                p = self.section_next;
                empty_line = self.section_empty_line;
                if p >= limit {
                    break;
                }
                continue;
            }
            let (rest_hash, rest_end, line_end) = (self.rest_hash, self.rest_end, self.line_end);
            if kind == Value::Flow {
            } else if is_same
                && self.at(line_end) == b'\n'
                && match rest_hash {
                    NONE => line_end == value_end || kind == Value::Missing,
                    hash => hash == value_end + 1 && rest_end == line_end,
                }
            {
                self.put(p, line_end + 1);
            } else {
                if !self.start_line(out) {
                    return false;
                }
                write_up_to_value(self, kind != Value::Missing);
                match kind {
                    Value::Quoted => self.write_quoted(value, value_end, value_flags),
                    _ => self.copy(value, value_end),
                }
                if rest_hash != NONE {
                    self.out.push(b' ');
                    self.copy(rest_hash, rest_end);
                }
                self.end_line();
            }
            p = line_end + 1;
            self.last = match kind {
                Value::Missing => Last::Missing,
                _ => Last::Inline,
            };
            self.is_commented = rest_hash != NONE;
            if kind == Value::BlockScalarHeader {
                let least = self.top().column + 1;
                match self.block_lines(p, least, item_out + self.tab_width) {
                    Some((next, after)) => (p, empty_line) = (next, after),
                    None => return false,
                }
                self.last = Last::BlockScalar;
            }
            if p > limit {
                break;
            }
        }

        // The end of the text.
        if self.last == Last::Nothing {
            return !is_marked && !self.comments.is_empty() && self.print_only_comments(empty_line);
        }
        // Nobody has asked for the empty line after the last node, so the comment at its end does.
        if self.is_commented
            && match self.comments.first() {
                Some(first) => first.empty_line != NONE,
                None => empty_line != NONE,
            }
        {
            return false;
        }
        if !self.comments.is_empty() {
            if !self.print_comments(0, false, 0, true) {
                return false;
            }
            // An empty line after the last comment of a document is kept.
            if empty_line != NONE && self.ends_with_document_comment {
                self.put(empty_line, empty_line + 1);
            }
        }
        true
    }
}
