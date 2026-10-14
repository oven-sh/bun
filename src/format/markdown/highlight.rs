//! Highlights Markdown and MDX.
//!
//! It listens to the events of `bun_md` directly. They say where every marker is, and the tree of `parse.rs` only keeps
//! where a node starts and ends. The parser reads any bytes as they are, `\r\n` too, so no offset moves.
//!
//! What `bun_md` doesn't know, it asks `span_at` and `leaf_end` about: task boxes, math, bare URLs, and for MDX
//! `import`, `export`, `{expression}` and tags.

use super::parse::{self, SpanMemo, Syntax};
use super::spans::{find_closing_run, find_math_end};
use crate::highlight::{Language, Spans, Token};
use crate::js::skim::{Searched, Skimmer};
use crate::text::{has_blank_line, skip_newline, skip_spaces, skip_spaces_backwards};
use bun_core::strings;
use bun_md::root::{Options, render_with_extensions};
use bun_md::types::{
    BLOCK_CLOSED, BLOCK_EXTENSION, BLOCK_FENCED_CODE, BLOCK_FOOTNOTE, BLOCK_SETEXT_HEADER,
    BlockType, Definition, ExtensionSpan, Extensions, JsResult, LeafStart, OFF, Reference,
    Renderer, RendererImpl, SpanDetail, SpanStart, SpanType, TextType, VerbatimLine,
};
use smallvec::SmallVec;
use std::cell::Cell;

/// The `<` of a tag in the copy of an MDX text that the parser gets. Like `<` it's punctuation to `bun_md`, but it starts
/// no HTML block, so what's between two tags is read as Markdown.
const TAG_OPEN: u8 = 0xFF;

/// What `span_at` has found.
mod tag {
    pub(super) const CHECK: u32 = 0;
    pub(super) const FOOTNOTE: u32 = 1;
    pub(super) const MATH: u32 = 2;
    pub(super) const URL: u32 = 3;
    pub(super) const EXPRESSION: u32 = 4;
    pub(super) const JSX: u32 = 5;
}

pub(crate) fn highlight(code: &[u8], language: Language, spans: &mut Spans) {
    let is_mdx = language == Language::Mdx;
    let front_matter_len = crate::front_matter::highlight(code, spans, 0);
    let code = code.get(front_matter_len..).unwrap_or_default();
    let mut marked = Vec::new();
    if is_mdx {
        mark_tags(code, &mut marked);
    }
    let text = if marked.is_empty() { code } else { &marked };

    let starts_item = Cell::new(false);
    let (memo, url_memo) = (Cell::default(), Cell::default());
    let span = |start: &SpanStart<'_>| span_at(start, starts_item.get(), &memo, &url_memo);
    let leaf_memo = Cell::default();
    let leaf = |start: &LeafStart<'_>| leaf_end(start, &leaf_memo);
    let extensions = Extensions {
        leaf_bytes: if is_mdx { b"ie{\xFF" } else { b"" },
        leaf: &leaf,
        span_bytes: if is_mdx { b"[$@:.{\xFF" } else { b"[$@:." },
        span: &span,
    };
    let mut options = Options::default();
    (options.footnotes, options.math_blocks) = (true, true);
    // The parser doesn't say where the box of a task is. `span_at` finds it.
    options.tasklists = false;
    let mut highlighter = Highlighter {
        code,
        base: front_matter_len as u32,
        language,
        spans,
        pieces: Vec::new(),
        open: Vec::new(),
        brackets: Vec::new(),
        closed_bracket: None,
        lines: Vec::new(),
        next_line: 0,
        marker: (0, 0),
        place: (0, 0),
        swept: 0,
        is_before_text: true,
        definitions: Vec::new(),
        next_definition: 0,
        are_definitions_sorted: true,
        quotes: Vec::new(),
        quote_depth: 0,
        container_depth: 0,
        heading_end: (0, 0),
        cell_end: 0,
        row_end: 0,
        is_at_item_start: false,
        starts_item: &starts_item,
    };
    let renderer = Renderer {
        ptr: &mut highlighter,
    };
    // It gives up when the stack runs out, and at 4 GB. What it has found by then stays.
    let _ = render_with_extensions(text, options, renderer, extensions);
    highlighter.flush();
}

/// Whether the byte at `at` has an odd number of backslashes before it.
fn is_escaped(text: &[u8], at: usize) -> bool {
    let before = text.get(..at).unwrap_or_default();
    let backslashes = before.iter().rev().take_while(|&&byte| byte == b'\\');
    backslashes.count() % 2 == 1
}

/// Where the next `<` is that can start a tag.
fn next_tag(code: &[u8], mut from: usize) -> Option<usize> {
    loop {
        let at = strings::index_of_char_pos(code, b'<', from)?;
        from = at + 1;
        if is_escaped(code, at) {
            continue;
        }
        let name = name_len(code, from);
        match code.get(from + name..)? {
            // `<https://a.b>` and `<a@b.c>` are left to the parser.
            [b'/', b'/', ..] | [b'@', ..] => {}
            [b'/' | b'>', ..] => return Some(at),
            _ if name > 0 => return Some(at),
            _ => {}
        }
    }
}

/// Fills `marked` with `code`, with `TAG_OPEN` for each `<` that can start a tag. It stays empty if there's none.
fn mark_tags(code: &[u8], marked: &mut Vec<u8>) {
    let mut from = 0;
    while let Some(at) = next_tag(code, from) {
        from = at + 1;
        if marked.is_empty() {
            marked.extend_from_slice(code);
        }
        if let Some(byte) = marked.get_mut(at) {
            *byte = TAG_OPEN;
        }
    }
}

fn line_end(text: &[u8], at: usize) -> usize {
    strings::index_of_any_pos(text, b"\r\n", at).unwrap_or(text.len())
}

/// How many bytes at the start of `text` are what `is` says.
fn run_len(text: &[u8], is: impl Fn(u8) -> bool) -> usize {
    text.iter().take_while(|&&byte| is(byte)).count()
}

fn skip_white(text: &[u8], at: usize) -> usize {
    at + run_len(text.get(at..).unwrap_or_default(), |byte| {
        byte.is_ascii_whitespace()
    })
}

// ───────────────────────────── JavaScript in MDX ─────────────────────────────

/// From behind a `{`: where the `}` is that closes it. From the start of an `import` or `export`, with `is_statement`:
/// where the last token before an empty line ends, if no brace is open there. `None`: a brace is still open at the end of
/// the text. To the skimmer `TAG_OPEN` is a name, so the `/` of `</a>` starts no regular expression.
fn js_end(text: &[u8], at: usize, is_statement: bool, searched: &mut Searched) -> Option<usize> {
    let mut skimmer = match is_statement {
        true => Skimmer::new(text, at),
        false => Skimmer::behind_brace(text, at),
    };
    skimmer.searched = *searched;
    let end = js_end_with(&mut skimmer, text, is_statement);
    *searched = skimmer.searched;
    end
}

fn js_end_with(skimmer: &mut Skimmer<'_>, text: &[u8], is_statement: bool) -> Option<usize> {
    loop {
        let (end, is_at_top_level) = (skimmer.at, is_statement && skimmer.braces == 0);
        let next = skimmer.next();
        let start = next.map_or(text.len(), |(_, start)| start);
        if is_at_top_level && (next.is_none() || has_blank_line(text.get(end..start)?)) {
            return Some(end);
        }
        next?;
        if !is_statement && skimmer.braces == 0 {
            return Some(start);
        }
    }
}

fn is_name_start(byte: u8) -> bool {
    byte.is_ascii_alphabetic() || matches!(byte, b'_' | b'$') || (0x80..TAG_OPEN).contains(&byte)
}

/// The length of the name of an element or an attribute: `a`, `a-b`, `a:b`, `a.b`
fn name_len(text: &[u8], at: usize) -> usize {
    let rest = text.get(at..).unwrap_or_default();
    if !rest.first().copied().is_some_and(is_name_start) {
        return 0;
    }
    run_len(rest, |byte| {
        is_name_start(byte) || byte.is_ascii_digit() || matches!(byte, b'-' | b'.' | b':')
    })
}

enum TagEnd {
    At(usize),
    /// The text ends in the tag.
    Unclosed,
    NotATag,
}

/// Where the tag ends whose `<` is at `open`.
fn tag_end(text: &[u8], open: usize, searched: &mut Searched) -> TagEnd {
    let is_closing = text.get(open + 1) == Some(&b'/');
    let mut at = open + 1 + usize::from(is_closing);
    at += name_len(text, at);
    loop {
        let blanks = at;
        at = skip_white(text, at);
        // Only strings and code have empty lines in them.
        if has_blank_line(text.get(blanks..at).unwrap_or_default()) {
            return TagEnd::NotATag;
        }
        let Some(&byte) = text.get(at) else {
            return TagEnd::Unclosed;
        };
        let end = match byte {
            b'>' => return TagEnd::At(at + 1),
            _ if is_closing => return TagEnd::NotATag,
            b'/' => {
                return match text.get(at + 1) {
                    Some(b'>') => TagEnd::At(at + 2),
                    Some(_) => TagEnd::NotATag,
                    None => TagEnd::Unclosed,
                };
            }
            // `{...props}`
            b'{' => js_end(text, at + 1, false, searched).map(|close| close + 1),
            _ => {
                let len = name_len(text, at);
                if len == 0 {
                    return TagEnd::NotATag;
                }
                at += len;
                let equals = skip_white(text, at);
                if text.get(equals) != Some(&b'=') {
                    continue;
                }
                at = skip_white(text, equals + 1);
                match text.get(at..).unwrap_or_default() {
                    [] => None,
                    [quote @ (b'"' | b'\''), ..] => {
                        strings::index_of_char_pos(text, *quote, at + 1).map(|close| close + 1)
                    }
                    [b'{', ..] => js_end(text, at + 1, false, searched).map(|close| close + 1),
                    // `a=b` is HTML, not JSX.
                    value => {
                        let is_in_value = |byte: u8| !byte.is_ascii_whitespace() && byte != b'>';
                        Some(at + run_len(value, is_in_value))
                    }
                }
            }
        };
        match end {
            Some(end) => at = end,
            None => return TagEnd::Unclosed,
        }
    }
}

/// Where the last line before the next empty line ends.
fn paragraph_end(text: &[u8], mut at: usize) -> usize {
    loop {
        let end = line_end(text, at);
        at = skip_newline(text, end);
        if at == end || skip_spaces(text, at) == line_end(text, at) {
            return end;
        }
    }
}

/// `import a from "a"`, `export const a = 1`
fn is_es_syntax(line: &[u8]) -> bool {
    (line.starts_with(b"import") || line.starts_with(b"export"))
        && matches!(
            line.get(6),
            Some(b' ' | b'\t' | b'\r' | b'\n' | b'{' | b'*' | b'"' | b'\'')
        )
}

#[derive(Copy, Clone, Default)]
struct LeafMemo {
    /// What starts before this place is in something that has been read, and that is no block.
    refused_until: usize,
    /// Something ran to the end of the text. From then on nothing is looked for beyond the next empty line.
    is_unclosed: bool,
    /// Where the last line before that empty line ends.
    paragraph_end: usize,
    searched: Searched,
}

/// Where the block of MDX ends that starts a line: `import`, `export`, `{expression}` or a tag with nothing behind it.
fn leaf_end(start: &LeafStart<'_>, memo: &Cell<LeafMemo>) -> Option<OFF> {
    let off = start.off as usize;
    let mut known = memo.get();
    // In a paragraph `span_at` finds the same.
    if start.interrupts_paragraph || off < known.refused_until {
        return None;
    }
    if known.is_unclosed && off >= known.paragraph_end {
        known.paragraph_end = paragraph_end(start.text, off);
        memo.set(known);
    }
    // In a container each line has something before it, so the block has to end on its first line.
    let limit = match start.is_in_container {
        true => line_end(start.text, off),
        false if known.is_unclosed => known.paragraph_end,
        false => start.text.len(),
    };
    let text = start.text.get(..limit)?;
    let searched = &mut known.searched;
    let end = match text.get(off..)? {
        [b'{', ..] => Some(js_end(text, off + 1, false, searched).map(|close| close + 1)),
        [TAG_OPEN, ..] => match tag_end(text, off, searched) {
            TagEnd::At(end) => Some(Some(end)),
            TagEnd::Unclosed => Some(None),
            TagEnd::NotATag => None,
        },
        line if is_es_syntax(line) && !start.is_in_container && start.indent == 0 => {
            Some(js_end(text, off, true, searched).map(|end| line_end(text, end)))
        }
        _ => return None,
    };
    memo.set(known);
    let end = end?;
    let Some(end) = end else {
        if start.is_in_container {
            return None;
        }
        // It's still being written, or it's a mistake: Markdown goes on after the next empty line.
        (known.is_unclosed, known.paragraph_end) = (true, paragraph_end(text, off));
        memo.set(known);
        return Some(known.paragraph_end as OFF);
    };
    if skip_spaces(text, end) != line_end(text, end) {
        known.refused_until = end;
        memo.set(known);
        return None;
    }
    Some(end as OFF)
}

// ───────────────────────────── spans that are not CommonMark's ─────────────────────────────

/// What has been looked for in a text and isn't there, so that it isn't looked for again from every marker.
#[derive(Copy, Clone, Default)]
struct Memo {
    /// `SpanStart::serial` of the text.
    serial: u32,
    /// Nothing closes `$`, `$$`.
    is_math_unclosed: [bool; 2],
    /// Nothing closes a `{` or a tag.
    is_code_unclosed: bool,
    searched: Searched,
}

/// The span that starts at a `[`, `$`, `{` or `<`, or that a `@`, `:` or `.` is in.
/// `starts_item`: the text is the first in a list item, where `[x]` is a task box.
fn span_at(
    start: &SpanStart<'_>,
    starts_item: bool,
    memo: &Cell<Memo>,
    url_memo: &Cell<SpanMemo>,
) -> Option<ExtensionSpan> {
    let (bytes, index) = (start.content, start.pos);
    let mut known = memo.get();
    if known.serial != start.serial {
        known = Memo {
            serial: start.serial,
            ..Memo::default()
        };
    }
    let (end, tag) = match bytes.get(index..)? {
        [b'[', b' ' | b'x' | b'X', b']', rest @ ..]
            if index == 0
                && starts_item
                && matches!(rest.first(), None | Some(b' ' | b'\t' | b'\n')) =>
        {
            (3, tag::CHECK)
        }
        // A footnote is often defined at the very end, so this doesn't wait for the definition.
        [b'[', b'^', label @ ..] => {
            let is_in_label = |byte| !matches!(byte, b'[' | b']' | b' ' | b'\t' | b'\n');
            let len = run_len(label, is_in_label);
            let after = label.get(len..)?;
            if len == 0 || !after.starts_with(b"]") || after.starts_with(b"](") {
                return None;
            }
            (index + len + 3, tag::FOOTNOTE)
        }
        [b'[', ..] => return None,
        [b'$', rest @ ..] => {
            let is_double = rest.starts_with(b"$");
            // The first `$` of a run can be escaped.
            let is_in_run =
                index > 0 && bytes.get(index - 1) == Some(&b'$') && !is_escaped(bytes, index - 1);
            if is_in_run
                || rest.starts_with(b"$$")
                || known.is_math_unclosed[usize::from(is_double)]
                || (!is_double && matches!(rest.first(), None | Some(b' ' | b'\t')))
            {
                return None;
            }
            let end = match is_double {
                true => find_closing_run(bytes, index + 2, b'$', 2),
                false => find_math_end(bytes, index),
            };
            if end.is_none() {
                known.is_math_unclosed[usize::from(is_double)] = true;
                memo.set(known);
            }
            (end?, tag::MATH)
        }
        [b'{' | TAG_OPEN, ..] if known.is_code_unclosed => return None,
        [byte @ (b'{' | TAG_OPEN), ..] => {
            let searched = &mut known.searched;
            let end = match byte {
                b'{' => Some(
                    js_end(bytes, index + 1, false, searched)
                        .map(|close| (close + 1, tag::EXPRESSION)),
                ),
                _ => match tag_end(bytes, index, searched) {
                    TagEnd::At(end) => Some(Some((end, tag::JSX))),
                    TagEnd::Unclosed => Some(None),
                    TagEnd::NotATag => None,
                },
            };
            known.is_code_unclosed = end == Some(None);
            memo.set(known);
            end??
        }
        _ => {
            let span = parse::span_at(start, Syntax::Markdown, false, url_memo)?;
            return Some(ExtensionSpan {
                tag: tag::URL,
                ..span
            });
        }
    };
    Some(ExtensionSpan {
        beg: index,
        end,
        tag,
    })
}

// ───────────────────────────── the events ─────────────────────────────

struct FirstAndLast {
    first: VerbatimLine,
    last: VerbatimLine,
}

#[derive(Copy, Clone)]
enum What {
    Token(Token),
    /// Code for `Spans::embed`.
    Code(Language),
    /// Code for `Spans::embed_expression`.
    Expression,
}

/// A part of the text and what it is.
#[derive(Copy, Clone)]
struct Piece {
    start: u32,
    /// 0 until it's known.
    end: u32,
    what: What,
}

/// What follows the text of a span.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Tail {
    /// A marker that is part of the span: `**`
    Marker,
    /// `](url "title")`
    Destination,
    /// `]`, `][]`, `][label]`
    Label,
}

/// A span that has started.
struct Open {
    kind: SpanType,
    /// Its index in `Highlighter::pieces`.
    piece: usize,
    tail: Tail,
}

struct Highlighter<'a> {
    /// Without the front matter.
    code: &'a [u8],
    /// Where `code` starts in the code that `spans` counts from.
    base: u32,
    language: Language,
    spans: &'a mut Spans,
    /// What has been found since the last block ended, in the order of the text. `**` only ends after what's in it, so
    /// everything waits here for the end of the block. That way `Spans` has nothing to sort.
    pieces: Vec<Piece>,
    open: Vec<Open>,
    /// For each `[` that starts no link and that no `]` has followed: the index of its piece. See `loose_brackets`.
    brackets: Vec<usize>,
    /// The same for the one that was closed last, and where its `]` is.
    closed_bracket: Option<(usize, usize)>,
    /// The lines of the leaf block that is open, and how many of them `reach` has seen.
    lines: Vec<VerbatimLine>,
    next_line: usize,
    /// What the parser said last: where the marker of a container is, where something in a line is.
    marker: (usize, usize),
    place: (usize, usize),
    /// Up to here the `>` of block quotes are marked.
    swept: usize,
    /// Only markers and blanks are between the start of the line and `swept`.
    is_before_text: bool,
    /// The parser reports all link reference definitions first. They wait here for their turn.
    definitions: Vec<Piece>,
    next_definition: usize,
    are_definitions_sorted: bool,
    /// For each `BlockType::Quote` that is open: whether it's a block quote. The others are footnotes.
    quotes: Vec<bool>,
    quote_depth: u32,
    container_depth: u32,
    /// The closing `#`s or the underline of the heading that is open.
    heading_end: (usize, usize),
    /// Where the last cell of the table row that is open ends, and the row.
    cell_end: usize,
    row_end: usize,
    /// Nothing has followed the marker of the list item yet.
    is_at_item_start: bool,
    /// See `span_at`.
    starts_item: &'a Cell<bool>,
}

impl Highlighter<'_> {
    fn byte(&self, at: usize) -> u8 {
        self.code.get(at).copied().unwrap_or(0)
    }

    fn push_what(&mut self, start: usize, end: usize, what: What) {
        if start < end {
            self.pieces.push(Piece {
                start: start as u32,
                end: end as u32,
                what,
            });
        }
    }

    fn push(&mut self, start: usize, end: usize, token: Token) {
        self.push_what(start, end, What::Token(token));
    }

    /// Hands on what has been found. The lines are still those of the block that the code in `pieces` is in.
    fn flush(&mut self) {
        let mut pieces = std::mem::take(&mut self.pieces);
        for piece in &pieces {
            match piece.what {
                What::Token(token) => {
                    self.spans
                        .add(self.base + piece.start, self.base + piece.end, token);
                }
                what => self.embed(what, piece.start as usize, piece.end as usize),
            }
        }
        pieces.clear();
        self.pieces = pieces;
        self.open.clear();
        self.forget_brackets();
    }

    fn forget_brackets(&mut self) {
        self.brackets.clear();
        self.closed_bracket = None;
    }

    /// Where `line` starts, with the indentation that is part of the block.
    fn line_start(&self, line: &VerbatimLine) -> usize {
        let before = self.code.get(..line.beg as usize).unwrap_or_default();
        let indentation = before.iter().rev().take(line.indent as usize);
        let is_blank = |byte: &&u8| matches!(byte, b' ' | b'\t');
        before.len() - indentation.take_while(is_blank).count()
    }

    /// Highlights the code from `start` to `end`. If its lines have something before them (`> `, indentation), that is
    /// blanked out in a copy, and the line break comes after the blanks: every line starts in the first column.
    fn embed(&mut self, what: What, start: usize, end: usize) {
        let whole = self.code;
        let Some(code) = whole.get(start..end) else {
            return;
        };
        let mut copy = Vec::new();
        let next = self
            .lines
            .partition_point(|line| self.line_start(line) <= start);
        let previous = next.checked_sub(1).and_then(|index| self.lines.get(index));
        let mut gap_start = previous.map_or(start, |line| (line.end as usize).max(start));
        for line in self.lines.get(next..).unwrap_or_default() {
            let gap_end = self.line_start(line);
            if gap_end >= end {
                break;
            }
            if !matches!(whole.get(gap_start..gap_end), Some(b"\n" | b"\r\n" | b"\r")) {
                if copy.is_empty() {
                    copy.extend_from_slice(code);
                }
                if let Some(gap) = copy.get_mut(gap_start - start..gap_end - start)
                    && let Some((line_break, blanks)) = gap.split_last_mut()
                {
                    blanks.fill(b' ');
                    *line_break = b'\n';
                }
            }
            gap_start = (line.end as usize).max(gap_end);
        }
        let code = if copy.is_empty() { code } else { &copy };
        let at = self.base + start as u32;
        match what {
            What::Code(language) => self.spans.embed(language, code, at),
            What::Expression => self.spans.embed_expression(code, at),
            What::Token(_) => {}
        }
    }

    // ───────────────────────────── what is before the lines ─────────────────────────────

    /// Marks each `>` before the text of a line, from `swept` to `until`.
    fn mark_quotes(&mut self, until: usize) {
        let until = until.min(self.code.len());
        while self.swept < until {
            if !self.is_before_text {
                let rest = self.code.get(self.swept..until).unwrap_or_default();
                let line_break = strings::index_of_any(rest, b"\r\n");
                self.swept += line_break.unwrap_or(rest.len());
                self.is_before_text = line_break.is_some();
                continue;
            }
            match self.byte(self.swept) {
                b'>' => self.push(self.swept, self.swept + 1, Token::PunctuationSpecial),
                b' ' | b'\t' | b'\r' | b'\n' => {}
                _ => {
                    self.is_before_text = false;
                    continue;
                }
            }
            self.swept += 1;
        }
    }

    /// The same, with the definitions that are on the way.
    fn sweep(&mut self, until: usize) {
        if !std::mem::replace(&mut self.are_definitions_sorted, true) {
            crate::sort::sort_by_key(&mut self.definitions[..], |piece| piece.start);
        }
        while let Some(&piece) = self.definitions.get(self.next_definition)
            && (piece.start as usize) < until
        {
            self.next_definition += 1;
            self.mark_quotes(piece.start as usize);
            self.pieces.push(piece);
        }
        self.mark_quotes(until);
    }

    /// Sweeps up to each line of the block that starts at `offset` or before it, and skips the line.
    fn reach(&mut self, offset: usize) {
        while let Some(&line) = self.lines.get(self.next_line)
            && line.beg as usize <= offset
        {
            self.next_line += 1;
            self.sweep(line.beg as usize);
            self.skip_to(line.end as usize, false);
        }
    }

    fn skip_to(&mut self, offset: usize, is_before_text: bool) {
        self.swept = self.swept.max(offset);
        self.is_before_text = is_before_text;
    }

    /// A block of text from `start` to `end` starts.
    fn start_text(&mut self, start: usize, end: usize) {
        self.sweep(start);
        if self.quote_depth > 0 {
            self.push(start, end, Token::MarkupQuote);
        }
    }

    /// The run of one character on the line after the one that ends at `line_end`: a closing fence, an underline.
    fn run_on_next_line(&self, line_end: usize) -> (usize, usize) {
        let line = self.code.get(skip_newline(self.code, line_end)..);
        let line = line.unwrap_or_default();
        let run = &line[run_len(line, |byte| matches!(byte, b' ' | b'\t' | b'>'))..];
        let start = self.code.len() - run.len();
        (
            start,
            start + run_len(run, |byte| run.first() == Some(&byte)),
        )
    }

    // ───────────────────────────── leaf blocks ─────────────────────────────

    fn first_and_last_line(&self) -> Option<FirstAndLast> {
        Some(FirstAndLast {
            first: *self.lines.first()?,
            last: *self.lines.last()?,
        })
    }

    /// A paragraph or a table.
    fn text_block(&mut self) {
        if let Some(FirstAndLast { first, last }) = self.first_and_last_line() {
            let end = skip_spaces_backwards(self.code, last.end as usize);
            self.start_text(first.beg as usize, end);
        }
    }

    /// Whether the underline at `start` is one `-` at the very end of the text. While a text is streaming in, that's the
    /// marker of a list item, and the paragraph above it shouldn't flash as a heading.
    fn is_item_being_written(&self, start: usize) -> bool {
        self.code.get(start..).unwrap_or_default().trim_ascii_end() == b"-"
    }

    fn heading(&mut self, level: usize, is_setext: bool) {
        let Some(FirstAndLast { first, last }) = self.first_and_last_line() else {
            return;
        };
        let (text_start, text_end) = (first.beg as usize, last.end as usize);
        if is_setext {
            let text_end = skip_spaces_backwards(self.code, text_end);
            self.heading_end = self.run_on_next_line(line_end(self.code, text_end));
            self.start_text(text_start, self.heading_end.1);
            if !self.is_item_being_written(self.heading_end.0) {
                self.push(text_start, text_end, Token::MarkupHeading);
            }
            return;
        }
        let marker_end = skip_spaces_backwards(self.code, text_start);
        let start = marker_end.saturating_sub(level);
        let closing = skip_spaces(self.code, text_end);
        let rest = self.code.get(closing..).unwrap_or_default();
        let closing_end = closing + run_len(rest, |byte| byte == b'#');
        self.heading_end = (closing, closing_end);
        let end = match closing < closing_end {
            true => closing_end,
            false => skip_spaces_backwards(self.code, text_end),
        };
        self.start_text(start, end);
        self.push(start, end, Token::MarkupHeading);
        self.push(start, marker_end, Token::PunctuationSpecial);
    }

    /// `info_start`: where what is behind the opening fence starts.
    fn fenced_code(&mut self, info_start: usize, is_closed: bool) {
        let code = self.code;
        let fence_end = skip_spaces_backwards(code, info_start);
        let before = code.get(..fence_end).unwrap_or_default();
        let is_fence = |byte: &&u8| before.last() == Some(*byte);
        let fence_start = fence_end - before.iter().rev().take_while(is_fence).count();
        let info_end = line_end(code, info_start);
        let info = code.get(info_start..info_end).unwrap_or_default();
        let name = &info[..run_len(info, |byte| !matches!(byte, b' ' | b'\t'))];
        let content_end = self.lines.last().map_or(info_end, |line| line.end as usize);
        let closing = match is_closed {
            true => self.run_on_next_line(content_end),
            false => (content_end, content_end),
        };
        self.sweep(fence_start);
        self.push(fence_start, fence_end, Token::PunctuationSpecial);
        if before.ends_with(b"$") {
            let info_end = info_start + info.trim_ascii_end().len();
            self.push(info_start, info_end, Token::MarkupRaw);
            self.code_block(None);
        } else {
            self.push(info_start, info_start + name.len(), Token::Label);
            self.code_block(Language::from_name(name));
        }
        self.sweep(closing.0);
        self.push(closing.0, closing.1, Token::PunctuationSpecial);
    }

    /// The lines of the block are code in `language`, or in one that isn't highlighted.
    fn code_block(&mut self, language: Option<Language>) {
        let Some(FirstAndLast { first, last }) = self.first_and_last_line() else {
            return;
        };
        let language = language.filter(|&it| self.spans.can_embed(it));
        if language.is_none() && self.container_depth > 0 {
            return self.raw_lines();
        }
        let (start, end) = (self.line_start(&first), last.end as usize);
        self.reach(first.beg as usize);
        match language {
            Some(language) => self.push_what(start, end, What::Code(language)),
            None => self.push_raw(start, end),
        }
        self.reach(usize::MAX);
    }

    /// The same line by line, without what is before the lines.
    fn raw_lines(&mut self) {
        while let Some(&line) = self.lines.get(self.next_line) {
            self.reach(line.beg as usize);
            self.push_raw(self.line_start(&line), line.end as usize);
        }
    }

    fn push_raw(&mut self, start: usize, end: usize) {
        let code = self.code.get(start..end).unwrap_or_default();
        self.push(start, start + code.trim_ascii_end().len(), Token::MarkupRaw);
    }

    /// `import`, `export`, `{expression}` or a tag of MDX, on lines of its own.
    fn mdx_block(&mut self) {
        let Some(&VerbatimLine { beg, end, .. }) = self.lines.first() else {
            return;
        };
        let start = beg as usize;
        let block = self.code.get(start..end as usize).unwrap_or_default();
        let end = start + block.trim_ascii_end().len();
        self.reach(start);
        match self.byte(start) {
            b'{' => self.expression(start, end),
            b'<' => self.jsx_tag(start, end),
            _ => self.push_what(start, end, What::Code(Language::Jsx)),
        }
    }

    /// The row under the header of a table.
    fn delimiter_row(&mut self) {
        let Some(&VerbatimLine { beg, end, .. }) = self.lines.get(1) else {
            return;
        };
        let (mut at, end) = (beg as usize, end as usize);
        self.reach(at);
        while at < end {
            let rest = self.code.get(at..end).unwrap_or_default();
            at += match rest.first() {
                Some(b'|') => {
                    self.push(at, at + 1, Token::PunctuationDelimiter);
                    1
                }
                Some(b' ' | b'\t') | None => 1,
                Some(_) => {
                    let len = run_len(rest, |byte| !matches!(byte, b'|' | b' ' | b'\t'));
                    self.push(at, at + len, Token::PunctuationSpecial);
                    len
                }
            };
        }
    }

    // ───────────────────────────── what is in the lines ─────────────────────────────

    /// What is behind the text of a link, from its `]` on.
    fn link_end(&mut self, start: usize, end: usize, tail: Tail) {
        let close = end.saturating_sub(1);
        if close <= start + 1 {
            return self.push(start, end, Token::PunctuationBracket);
        }
        self.push(start, start + 2, Token::PunctuationBracket);
        if tail == Tail::Label {
            self.push(start + 2, close, Token::Label);
        } else {
            let inside = self.code.get(..close).unwrap_or_default();
            let url = skip_white(inside, start + 2);
            let rest = inside.get(url..).unwrap_or_default();
            let until_blank = || run_len(rest, |byte| !byte.is_ascii_whitespace());
            let url_end = url + angle_brackets_len(rest).unwrap_or_else(until_blank);
            self.push(url, url_end, Token::MarkupLinkUrl);
            let title = skip_white(inside, url_end);
            let written = inside.get(title..).unwrap_or_default().trim_ascii_end();
            self.push(title, title + written.len(), Token::String);
        }
        self.push(close, end, Token::PunctuationBracket);
    }

    /// Text from `start` to `end` of a line. `[text][label]` is only a link to the parser if the label is defined. It's
    /// highlighted anyway: the definition is often the last thing to stream in, or isn't part of a snippet.
    fn loose_brackets(&mut self, start: usize, end: usize) {
        if end == start + 1 && self.byte(start) == b'[' {
            // They get an end once `][label]` has followed.
            self.brackets.push(self.pieces.len());
            for (start, token) in [(start, Token::PunctuationBracket), (end, Token::MarkupLink)] {
                self.pieces.push(Piece {
                    start: start as u32,
                    end: 0,
                    what: What::Token(token),
                });
            }
            return;
        }
        let text = self.code.get(..end).unwrap_or_default();
        let mut from = start;
        while let Some(close) = strings::index_of_char_pos(text, b']', from)
            && let Some(label) = self.brackets.pop()
        {
            from = close + 1;
            let is_after = |it: &(usize, usize)| {
                let label_start = self.pieces.get(label).map(|piece| piece.start as usize);
                label_start == Some(it.1 + 1)
            };
            let Some((link, link_close)) = self.closed_bracket.take_if(|it| is_after(it)) else {
                self.closed_bracket = Some((label, close));
                continue;
            };
            let has_bang =
                |piece: &Piece| text.get((piece.start as usize).wrapping_sub(1)) == Some(&b'!');
            if let Some([bracket, link_text]) = self.pieces.get_mut(link..link + 2) {
                bracket.end = bracket.start + 1;
                bracket.start -= u32::from(has_bang(bracket));
                link_text.end = link_close as u32;
            }
            if let Some([brackets, name]) = self.pieces.get_mut(label..label + 2) {
                (brackets.start, brackets.end) = (link_close as u32, brackets.start + 1);
                (name.end, name.what) = (close as u32, What::Token(Token::Label));
            }
            self.push(close, close + 1, Token::PunctuationBracket);
        }
    }

    /// `{expression}`, `{/* comment */}`
    fn expression(&mut self, start: usize, end: usize) {
        let is_closed = end > start + 1 && self.byte(end - 1) == b'}';
        let inside_end = end - usize::from(is_closed);
        let inside = self.code.get(start + 1..inside_end).unwrap_or_default();
        if let Some(comment) = inside.trim_ascii().strip_prefix(b"/*")
            && strings::index_of(comment, b"*/").is_none_or(|at| at + 2 == comment.len())
        {
            return self.push(start, end, Token::Comment);
        }
        self.push(start, start + 1, Token::PunctuationSpecial);
        // `Spans::embed_expression` reads TypeScript, where `<a>b</a>` is a type assertion.
        let what = match next_tag(inside, 0) {
            Some(_) => What::Code(Language::Jsx),
            None => What::Expression,
        };
        if !inside.trim_ascii().is_empty() {
            self.push_what(start + 1, inside_end, what);
        }
        self.push(inside_end, end, Token::PunctuationSpecial);
    }

    fn jsx_tag(&mut self, start: usize, end: usize) {
        let name = start + 1 + usize::from(self.byte(start + 1) == b'/');
        let name_end = name + name_len(self.code, name);
        let rest = self.code.get(name_end..end).unwrap_or_default();
        let close = rest.trim_ascii();
        // Only attributes need the parser of JavaScript, which could make nothing of `</a>` alone.
        if !matches!(close, b">" | b"/>" | b"") {
            return self.push_what(start, end, What::Code(Language::Jsx));
        }
        let written = self.code.get(name..name_end).unwrap_or_default();
        let is_component =
            !self.byte(name).is_ascii_lowercase() || strings::contains_char(written, b'.');
        let token = match is_component {
            true => Token::TagComponent,
            false => Token::Tag,
        };
        self.push(start, name, Token::TagDelimiter);
        self.push(name, name_end, token);
        self.push(end - close.len(), end, Token::TagDelimiter);
    }
}

/// The length of the `<destination>` that `text` starts with.
fn angle_brackets_len(text: &[u8]) -> Option<usize> {
    if !text.starts_with(b"<") {
        return None;
    }
    let mut at = 1;
    loop {
        at = strings::index_of_any_pos(text, b">\\", at)?;
        if text.get(at) == Some(&b'>') {
            return Some(at + 1);
        }
        at += 2;
    }
}

impl RendererImpl for Highlighter<'_> {
    fn wants_source(&self) -> bool {
        true
    }

    fn container_source(&mut self, beg: OFF, end: OFF, _indent: u32) {
        self.marker = (beg as usize, end as usize);
    }

    fn leaf_source(&mut self, block_type: BlockType, lines: &[VerbatimLine]) -> bool {
        self.lines.clear();
        // Reference definitions have used up the others.
        let lines = lines.iter().filter(|line| line.beg <= line.end);
        self.lines.extend(lines);
        self.next_line = 0;
        matches!(
            block_type,
            BlockType::Code | BlockType::Html | BlockType::Hr
        )
    }

    fn inline_source(&mut self, beg: OFF, end: OFF) {
        self.place = (beg as usize, end as usize);
        self.reach(beg as usize);
    }

    fn definition(&mut self, definition: &Definition<'_>) {
        // The three are parts of one text: the lines without what is before them, with `\n` between.
        let origin = definition.label.as_ptr().addr().wrapping_sub(1);
        let in_document = |mut offset: usize| {
            definition.lines.iter().find_map(|line| {
                let len = line.end.saturating_sub(line.beg) as usize;
                if offset <= len {
                    return Some(line.beg as usize + offset);
                }
                offset -= len + 1;
                None
            })
        };
        let place = |part: &[u8]| {
            let start = part.as_ptr().addr().checked_sub(origin)?;
            Some((in_document(start)?, in_document(start + part.len())?))
        };
        let Some(label) = place(definition.label) else {
            return;
        };
        let mut pieces: SmallVec<[(usize, usize, Token); 6]> = SmallVec::new();
        pieces.push((
            label.0.saturating_sub(1),
            label.0,
            Token::PunctuationBracket,
        ));
        pieces.push((label.0, label.1, Token::Label));
        pieces.push((label.1, label.1 + 1, Token::PunctuationBracket));
        pieces.push((label.1 + 1, label.1 + 2, Token::PunctuationDelimiter));
        if let Some((start, end)) = place(definition.dest) {
            let margin = usize::from(self.byte(start.wrapping_sub(1)) == b'<');
            pieces.push((start - margin, end + margin, Token::MarkupLinkUrl));
        }
        if !definition.title.is_empty()
            && let Some((start, end)) = place(definition.title)
        {
            pieces.push((start.saturating_sub(1), end + 1, Token::String));
        }
        for (start, end, token) in pieces {
            let is_after = |last: &Piece| last.start as usize <= start;
            self.are_definitions_sorted &= self.definitions.last().is_none_or(is_after);
            self.definitions.push(Piece {
                start: start as u32,
                end: end as u32,
                what: What::Token(token),
            });
        }
    }

    fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()> {
        let is_item = block_type == BlockType::Li;
        let is_at_item_start = std::mem::replace(&mut self.is_at_item_start, is_item);
        self.starts_item
            .set(is_at_item_start && block_type == BlockType::P);
        let (marker, marker_end) = self.marker;
        match block_type {
            BlockType::Doc
            | BlockType::Ul
            | BlockType::Ol
            | BlockType::Thead
            | BlockType::Tbody => {}
            BlockType::Quote => {
                let is_footnote = flags & BLOCK_FOOTNOTE != 0;
                if is_footnote {
                    let colon = marker_end.saturating_sub(1);
                    self.sweep(marker);
                    self.push(marker, colon, Token::Label);
                    self.push(colon, marker_end, Token::PunctuationDelimiter);
                    self.skip_to(marker_end, true);
                } else {
                    self.sweep(marker_end);
                }
                self.quotes.push(!is_footnote);
                self.quote_depth += u32::from(!is_footnote);
                self.container_depth += 1;
            }
            BlockType::Li => {
                self.sweep(marker);
                self.push(marker, marker_end, Token::MarkupList);
                self.skip_to(marker_end, true);
                self.container_depth += 1;
            }
            BlockType::Hr => {
                if let Some(&VerbatimLine { beg, end, .. }) = self.lines.first() {
                    self.reach(beg as usize);
                    self.push(beg as usize, end as usize, Token::PunctuationSpecial);
                }
            }
            BlockType::H => self.heading(data as usize, flags & BLOCK_SETEXT_HEADER != 0),
            BlockType::P | BlockType::Table => self.text_block(),
            BlockType::Code if flags & BLOCK_FENCED_CODE != 0 => {
                self.fenced_code(data as usize, flags & BLOCK_CLOSED != 0);
            }
            // MDX has no indented code.
            BlockType::Code if self.language == Language::Mdx => {
                for line in &mut self.lines {
                    line.indent = 0;
                }
                self.code_block(Some(Language::Mdx));
            }
            BlockType::Code => self.raw_lines(),
            BlockType::Html if flags & BLOCK_EXTENSION != 0 => self.mdx_block(),
            BlockType::Html => self.code_block(Some(Language::Html)),
            BlockType::Tr => (self.cell_end, self.row_end) = self.place,
            BlockType::Th | BlockType::Td => {
                let (cell, cell_end) = self.place;
                if cell == self.cell_end + 1 {
                    self.push(self.cell_end, cell, Token::PunctuationDelimiter);
                }
                self.cell_end = cell_end;
                if block_type == BlockType::Th {
                    let text_start = skip_spaces(self.code, cell);
                    let text_end = skip_spaces_backwards(self.code, cell_end);
                    self.push(text_start, text_end, Token::MarkupHeading);
                }
            }
        }
        Ok(())
    }

    fn leave_block(&mut self, block_type: BlockType, _data: u32) -> JsResult<()> {
        match block_type {
            BlockType::Quote => {
                let is_quote = self.quotes.pop() == Some(true);
                self.quote_depth = self.quote_depth.saturating_sub(u32::from(is_quote));
                self.container_depth = self.container_depth.saturating_sub(1);
            }
            BlockType::Li => self.container_depth = self.container_depth.saturating_sub(1),
            BlockType::Thead => self.delimiter_row(),
            BlockType::Th | BlockType::Td => self.forget_brackets(),
            BlockType::Tr => {
                if self.cell_end < self.row_end && self.byte(self.cell_end) == b'|' {
                    self.push(
                        self.cell_end,
                        self.cell_end + 1,
                        Token::PunctuationDelimiter,
                    );
                }
            }
            BlockType::H => {
                let (start, end) = std::mem::take(&mut self.heading_end);
                if start < end {
                    let token = match self.is_item_being_written(start) {
                        true => Token::MarkupList,
                        false => Token::PunctuationSpecial,
                    };
                    self.sweep(start);
                    self.push(start, end, token);
                }
                self.flush();
            }
            BlockType::Doc => {
                self.sweep(self.code.len());
                self.flush();
            }
            BlockType::P | BlockType::Table | BlockType::Code | BlockType::Html | BlockType::Hr => {
                self.flush()
            }
            _ => {}
        }
        Ok(())
    }

    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()> {
        let (marker, marker_end) = self.place;
        let (token, tail) = match span_type {
            SpanType::Em | SpanType::U => (Token::MarkupItalic, Tail::Marker),
            SpanType::Strong => (Token::MarkupBold, Tail::Marker),
            SpanType::Del => (Token::MarkupStrikethrough, Tail::Marker),
            SpanType::Code | SpanType::Latexmath | SpanType::LatexmathDisplay => {
                (Token::MarkupRaw, Tail::Marker)
            }
            _ if detail.autolink || detail.permissive_autolink => {
                (Token::MarkupLinkUrl, Tail::Marker)
            }
            _ => match detail.reference {
                Reference::Footnote => (Token::Label, Tail::Marker),
                Reference::None => (Token::MarkupLink, Tail::Destination),
                _ => (Token::MarkupLink, Tail::Label),
            },
        };
        let mut start = marker;
        if tail != Tail::Marker {
            self.push(marker, marker_end, Token::PunctuationBracket);
            start = marker_end;
        }
        self.open.push(Open {
            kind: span_type,
            piece: self.pieces.len(),
            tail,
        });
        self.pieces.push(Piece {
            start: start as u32,
            end: 0,
            what: What::Token(token),
        });
        Ok(())
    }

    fn leave_span(&mut self, span_type: SpanType) -> JsResult<()> {
        // A long run of `*` ends more spans than the parser has reported the start of.
        let Some(Open { piece, tail, .. }) = self.open.pop_if(|open| open.kind == span_type) else {
            return Ok(());
        };
        let (marker, marker_end) = self.place;
        let end = if tail == Tail::Marker {
            marker_end
        } else {
            marker
        };
        if let Some(piece) = self.pieces.get_mut(piece) {
            piece.end = end as u32;
        }
        if tail != Tail::Marker {
            self.link_end(marker, marker_end, tail);
        }
        Ok(())
    }

    fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()> {
        let (start, end) = self.place;
        match text_type {
            // `\*`
            TextType::Normal if content.len() == 1 && end == start + 2 => {
                self.push(start, end, Token::StringEscape);
            }
            TextType::Normal => self.loose_brackets(start, end),
            TextType::Entity => self.push(start, end, Token::StringEscape),
            TextType::Br if self.byte(start) == b'\\' => {
                self.push(start, start + 1, Token::StringEscape);
            }
            TextType::Html => self.push_what(start, end, What::Code(Language::Html)),
            _ => {}
        }
        Ok(())
    }

    fn extension_span(&mut self, tag: u32, _content: &[u8]) -> JsResult<()> {
        let (start, end) = self.place;
        match tag {
            tag::CHECK => self.push(start, end, Token::MarkupList),
            tag::FOOTNOTE => self.push(start, end, Token::Label),
            tag::MATH => self.push(start, end, Token::MarkupRaw),
            tag::URL => self.push(start, end, Token::MarkupLinkUrl),
            tag::EXPRESSION => self.expression(start, end),
            _ => self.jsx_tag(start, end),
        }
        Ok(())
    }
}
