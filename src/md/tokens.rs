//! The tokens of [marked](https://github.com/markedjs/marked/blob/v15.0.12/src/Tokens.ts) 15, as instructions for
//! `BunMarkdownTokens.cpp`, which makes the objects. A token comes behind the tokens in it.

use bun_core::strings;

use crate::helpers::{self, HeadingIdTracker};
use crate::output::OutputBuffer;
use crate::parser::ParserError;
use crate::root::{self, Options};
use crate::types::{
    self, BlockType, Definition, JsResult, OFF, Renderer, RendererImpl, SpanDetail, SpanType,
    TextType, VerbatimLine,
};

/// `TokenKind` in `BunMarkdownTokens.cpp`, which has the properties of each.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum Kind {
    Space,
    FencedCode,
    IndentedCode,
    Heading,
    HeadingWithId,
    Hr,
    Blockquote,
    List,
    ListItem,
    HtmlBlock,
    Def,
    Table,
    TableCell,
    Paragraph,
    TextBlock,
    Em,
    Strong,
    Del,
    Text,
    LiteralText,
    Escape,
    Codespan,
    Br,
    HtmlInline,
    Link,
    Image,
    Autolink,
    Wikilink,
    /// An array of cells.
    TableRow,
    /// No token: `raw` is what `From::Base` means from here on.
    SetBase,
    /// The token in the slot `number`.
    Reuse,
}

/// `StringFrom` in `BunMarkdownTokens.cpp`.
#[repr(u32)]
#[derive(Clone, Copy, PartialEq, Eq)]
enum From {
    Empty,
    Null,
    Undefined,
    /// Bytes of the text that was parsed.
    Source,
    /// Bytes of `Tokens::pool`.
    Pool,
    Base,
    /// UTF-16 code units of the base.
    PartOfBase,
    /// The `raw` of the token.
    Raw,
}

#[repr(C)]
#[derive(Clone, Copy)]
struct Str {
    from: From,
    beg: u32,
    len: u32,
}

impl Str {
    const fn of(from: From) -> Str {
        Str {
            from,
            beg: 0,
            len: 0,
        }
    }
    const EMPTY: Str = Str::of(From::Empty);
}

const NOT_KEPT: u32 = u32::MAX;

#[repr(C)]
#[derive(Clone, Copy)]
pub struct Op {
    kind: Kind,
    flag_a: bool,
    flag_b: bool,
    flag_c: bool,
    n_children: u32,
    number: u32,
    keep_in: u32,
    raw: Str,
    text: Str,
    /// `href`, `lang`, `id`, `target`
    first: Str,
    /// `title`
    second: Str,
}

impl Op {
    const fn new(kind: Kind) -> Op {
        Op {
            kind,
            flag_a: false,
            flag_b: false,
            flag_c: false,
            n_children: 0,
            number: 0,
            keep_in: NOT_KEPT,
            raw: Str::EMPTY,
            text: Str::EMPTY,
            first: Str::EMPTY,
            second: Str::EMPTY,
        }
    }
}

pub struct Tokens {
    pub ops: Vec<Op>,
    pub pool: Vec<u8>,
}

pub fn parse(text: &[u8], options: Options) -> Result<Tokens, ParserError> {
    let mut builder = TokenBuilder::new(text, 0, options);
    root::render_with_renderer(text, options, Renderer { ptr: &mut builder })?;
    builder.finish()
}

#[derive(Clone, Copy)]
struct Place {
    off: OFF,
    /// The markers of the containers are still ahead.
    is_line_start: bool,
    /// The columns of a tab before `off` that no marker has taken.
    tab_left: u32,
}

impl Place {
    fn line_start(off: OFF) -> Place {
        Place {
            off,
            is_line_start: true,
            tab_left: 0,
        }
    }

    fn in_line(off: OFF) -> Place {
        Place {
            off,
            is_line_start: false,
            tab_left: 0,
        }
    }
}

/// The document, a block quote, a list or a list item.
struct Container {
    op: Op,
    /// In the container around it.
    start: Place,
    mark_beg: OFF,
    content: Place,
    /// The columns that a line is indented by in a list item.
    indent: u32,
    /// What is before this place belongs to the tokens in it.
    cursor: OFF,
    last_child: Option<LastChild>,
    /// Of a list item that has been left: where the line starts that does not go on with it, and its last line ends.
    left_at: Option<(OFF, OFF)>,
}

/// Its `raw` depends on the empty lines behind it.
struct LastChild {
    op: usize,
    start: Place,
    takes_empty_lines: bool,
    /// The `SetBase` of its inline content.
    base: Option<usize>,
}

struct Span {
    op: Op,
    beg: u32,
    inner_beg: u32,
}

/// The inline content of a leaf block.
#[derive(Default)]
struct Content {
    base: Option<usize>,
    beg_in_pool: u32,
    len: u32,
    encoding: Encoding,
    /// For each byte and for the end, with `Encoding::Utf8`.
    utf16_offsets: Vec<u32>,
    n_children: u32,
    spans: Vec<Span>,
    text_run: Option<(u32, u32)>,
    is_in_link_tag: bool,
    is_in_raw_tag: bool,
}

#[derive(Default, Clone, Copy)]
enum Encoding {
    #[default]
    Ascii,
    Utf8,
    Invalid,
}

struct PendingDefinition {
    op: Op,
    beg: OFF,
    end: OFF,
}

pub(crate) struct TokenBuilder<'a> {
    text: &'a [u8],
    /// `Parser::code_indent_offset`
    code_indent: u32,
    ops: Vec<Op>,
    pool: OutputBuffer,
    containers: Vec<Container>,
    definitions: Vec<PendingDefinition>,
    next_definition: usize,
    container_source: (OFF, OFF, u32),
    /// The first and the last line of the leaf block.
    leaf_lines: Option<(VerbatimLine, VerbatimLine)>,
    leaf_text: Str,
    leaf: Option<(Op, Place, OFF)>,
    n_rows: u32,
    n_cells: u32,
    cell_alignment: u32,
    content: Content,
    at: (u32, u32),
    heading_ids: HeadingIdTracker,
}

impl<'a> TokenBuilder<'a> {
    /// The tokens start at `beg`.
    pub(crate) fn new(text: &'a [u8], beg: OFF, options: Options) -> Self {
        let document = Container {
            op: Op::new(Kind::Space),
            start: Place::line_start(beg),
            mark_beg: beg,
            content: Place::in_line(beg),
            indent: 0,
            cursor: beg,
            last_child: None,
            left_at: None,
        };
        TokenBuilder {
            text,
            code_indent: options.to_flags().code_indent_offset(),
            ops: Vec::new(),
            pool: OutputBuffer {
                list: Vec::new(),
                oom: false,
            },
            containers: vec![document],
            definitions: Vec::new(),
            next_definition: 0,
            container_source: (0, 0, 0),
            leaf_lines: None,
            leaf_text: Str::EMPTY,
            leaf: None,
            n_rows: 0,
            n_cells: 0,
            cell_alignment: 0,
            content: Content::default(),
            at: (0, 0),
            heading_ids: HeadingIdTracker::init(options.heading_ids),
        }
    }

    pub(crate) fn finish(self) -> Result<Tokens, ParserError> {
        if self.pool.oom {
            return Err(ParserError::OutOfMemory);
        }
        Ok(Tokens {
            ops: self.ops,
            pool: self.pool.list,
        })
    }

    // ───────────────────────────── strings ─────────────────────────────

    /// What has been added to the pool since it had `beg` bytes.
    fn pooled_since(&mut self, beg: usize) -> Str {
        let end = self.pool.list.len();
        if end == beg {
            return Str::EMPTY;
        }
        if u32::try_from(end).is_err() {
            self.pool.oom = true;
            self.pool.list.truncate(beg);
            return Str::EMPTY;
        }
        Str {
            from: From::Pool,
            beg: beg as u32,
            len: (end - beg) as u32,
        }
    }

    fn pool(&mut self, parts: &[&[u8]]) -> Str {
        let beg = self.pool.list.len();
        for part in parts {
            self.pool.write(part);
        }
        self.pooled_since(beg)
    }

    fn pool_spaces(&mut self, count: u32) {
        for _ in 0..count {
            self.pool.write_byte(b' ');
        }
    }

    fn pool_unescaped(&mut self, bytes: &[u8], is_escaped: impl Fn(u8) -> bool) -> Str {
        let beg = self.pool.list.len();
        let mut i = 0;
        while i < bytes.len() {
            if bytes[i] == b'\\' && bytes.get(i + 1).is_some_and(|&c| is_escaped(c)) {
                i += 1;
            }
            self.pool.write_byte(bytes[i]);
            i += 1;
        }
        self.pooled_since(beg)
    }

    fn bytes(&self, string: Str) -> &[u8] {
        let range = string.beg as usize..(string.beg + string.len) as usize;
        match string.from {
            From::Source => &self.text[range],
            From::Pool => &self.pool.list[range],
            _ => b"",
        }
    }

    fn line_start(&self, off: OFF) -> OFF {
        let before = &self.text[..off as usize];
        strings::last_index_of_any(before, b"\r\n").map_or(0, |it| it as OFF + 1)
    }

    fn line_end(&self, off: OFF) -> OFF {
        let rest = &self.text[off as usize..];
        off + strings::index_of_any(rest, b"\r\n").unwrap_or(rest.len()) as OFF
    }

    fn next_line(&self, off: OFF) -> OFF {
        let end = self.line_end(off);
        match self.text[end as usize..] {
            [b'\r', b'\n', ..] => end + 2,
            [] => end,
            _ => end + 1,
        }
    }

    fn trimmed_end(&self, beg: OFF, end: OFF) -> OFF {
        beg + self.text[beg as usize..end.max(beg) as usize]
            .trim_ascii_end()
            .len() as OFF
    }

    /// Where the line goes on behind the markers of the first `depth` containers, and how many columns of a tab
    /// before that place are left.
    fn skip_markers(&self, line_start: OFF, depth: usize) -> (OFF, u32) {
        let (mut off, mut column, mut left) = (line_start, 0, 0);
        // The end of the white space at `off`, and its column.
        let mut white = helpers::line_indentation(self.text, 0, off);
        for container in &self.containers[1..depth] {
            if container.op.kind == Kind::List {
                continue;
            }
            let indent = left + white.indent - column;
            let next = self.text.get(white.off as usize).copied();
            let mut wanted = if container.op.kind == Kind::Blockquote {
                if indent >= self.code_indent || next != Some(b'>') {
                    break;
                }
                (off, column, left) = (white.off + 1, white.indent + 1, 0);
                white = helpers::line_indentation(self.text, column, off);
                white.indent += column;
                1
            } else if indent >= container.indent || next.is_none_or(helpers::is_newline) {
                container.indent
            } else {
                break;
            };
            let from_tab = wanted.min(left);
            (wanted, left) = (wanted - from_tab, left - from_tab);
            while wanted > 0 && off < white.off {
                let width = match self.text[off as usize] {
                    b'\t' => 4 - column % 4,
                    _ => 1,
                };
                (off, column) = (off + 1, column + width);
                left = width.saturating_sub(wanted);
                wanted = wanted.saturating_sub(width);
            }
        }
        (off, left)
    }

    /// The text from `start` to `end` as the `depth`th container has it.
    fn source(&mut self, start: Place, end: OFF, depth: usize) -> Str {
        if end <= start.off {
            return Str::EMPTY;
        }
        if depth <= 1
            || (!start.is_line_start && start.tab_left == 0 && self.line_end(start.off) >= end)
        {
            return Str {
                from: From::Source,
                beg: start.off,
                len: end - start.off,
            };
        }
        let beg = self.pool.list.len();
        let Place {
            mut off,
            mut is_line_start,
            tab_left,
        } = start;
        self.pool_spaces(tab_left);
        loop {
            if is_line_start {
                let left;
                (off, left) = self.skip_markers(off, depth);
                self.pool_spaces(left);
            }
            let line_end = self.line_end(off);
            if off < end {
                let line = &self.text[off as usize..line_end.min(end) as usize];
                self.pool.write(line);
            }
            if line_end >= end {
                break;
            }
            self.pool.write_byte(b'\n');
            (off, is_line_start) = (self.next_line(line_end), true);
            if off >= end {
                break;
            }
        }
        self.pooled_since(beg)
    }

    // ───────────────────────────── blocks ─────────────────────────────

    fn innermost(&mut self) -> &mut Container {
        let last = self.containers.len() - 1;
        &mut self.containers[last]
    }

    /// The innermost container has nothing but white space from its cursor to `end`.
    fn end_last_child(&mut self, end: OFF) {
        let depth = self.containers.len();
        let container = self.innermost();
        let cursor = container.cursor.min(end);
        let last_child = container.last_child.take();
        container.cursor = end;

        let mut space_beg = cursor;
        if let Some(child) = last_child {
            let is_one_line_break = cursor < end
                && self.line_end(cursor) == cursor
                && self.next_line(cursor) <= end
                && self.skip_markers(self.next_line(cursor), depth).0 >= end;
            if child.takes_empty_lines || is_one_line_break {
                space_beg = end;
            }
            let raw = self.source(child.start, space_beg, depth);
            self.set_raw(&child, raw);
        }
        let start = Place::in_line(space_beg);
        let raw = self.source(start, end, depth);
        if raw.from != From::Empty {
            self.ops.push(Op {
                raw,
                ..Op::new(Kind::Space)
            });
            self.innermost().op.n_children += 1;
        }
    }

    fn set_raw(&mut self, child: &LastChild, raw: Str) {
        let base = child.base.filter(|&base| {
            let content = self.ops[base].raw;
            strings::has_prefix(self.bytes(raw), self.bytes(content))
        });
        match base {
            Some(base) => {
                self.ops[base].raw = raw;
                self.ops[child.op].raw = Str::of(From::Base);
            }
            None => self.ops[child.op].raw = raw,
        }
    }

    /// A block starts in the innermost container, on the line that `beg` is in.
    fn start_child(&mut self, beg: OFF) -> Place {
        self.add_definitions_before(beg);
        self.start_child_behind_definitions(beg)
    }

    fn start_child_behind_definitions(&mut self, beg: OFF) -> Place {
        let container = self.innermost();
        let cursor = container.cursor;
        let (is_first, content) = (container.op.n_children == 0, container.content);
        let between = &self.text[cursor.min(beg) as usize..beg as usize];
        match strings::last_index_of_any(between, b"\r\n") {
            None if is_first => content,
            line_break => {
                let off = cursor + line_break.map_or(0, |it| it as OFF + 1);
                self.end_last_child(off);
                Place::line_start(off)
            }
        }
    }

    fn add_child(&mut self, op: Op, start: Place, end: OFF, base: Option<usize>) {
        let takes_empty_lines = matches!(
            op.kind,
            Kind::Heading
                | Kind::HeadingWithId
                | Kind::Table
                | Kind::HtmlBlock
                | Kind::IndentedCode
                | Kind::Def
        );
        let index = self.ops.len();
        self.ops.push(op);
        let container = self.innermost();
        container.op.n_children += 1;
        container.cursor = end;
        container.last_child = Some(LastChild {
            op: index,
            start,
            takes_empty_lines,
            base,
        });
    }

    fn add_definitions_before(&mut self, end: OFF) {
        while let Some(&PendingDefinition { op, beg, end }) = self
            .definitions
            .get(self.next_definition)
            .filter(|it| it.beg < end)
        {
            self.next_definition += 1;
            let start = self.start_child_behind_definitions(beg);
            self.add_child(op, start, end, None);
        }
    }

    fn enter_container(&mut self, op: Op) {
        let (mark_beg, mark_end, mark_indent) = self.container_source;
        let around = self.containers.len() - 1;
        let start = match op.kind {
            Kind::ListItem if self.containers[around].mark_beg == mark_beg => {
                self.containers[around].start
            }
            Kind::ListItem => Place::line_start(self.line_start(mark_beg)),
            _ => self.start_child(mark_beg),
        };

        let (mut content, mut indent) = (Place::in_line(mark_end), 0);
        match op.kind {
            Kind::Blockquote => content = self.behind_one_column(mark_end),
            Kind::ListItem => {
                let column = self.column(mark_end);
                let white = helpers::line_indentation(self.text, column, mark_end);
                let next = self.text.get(white.off as usize).copied();
                let padding;
                (content, padding) = if next.is_none_or(helpers::is_newline) {
                    (Place::in_line(white.off), 1)
                } else if white.indent > self.code_indent {
                    (self.behind_one_column(mark_end), 1)
                } else {
                    (Place::in_line(white.off), white.indent)
                };
                indent = mark_indent + (mark_end - mark_beg) + padding;
                if op.flag_a {
                    let mark = helpers::line_indentation(self.text, 0, content.off).off;
                    content = Place::in_line(helpers::line_indentation(self.text, 0, mark + 3).off);
                }
            }
            _ => {}
        }
        self.containers.push(Container {
            op,
            start,
            mark_beg,
            content,
            indent,
            cursor: content.off,
            last_child: None,
            left_at: None,
        });
    }

    /// Of white space at `off`, if there is any.
    fn behind_one_column(&self, off: OFF) -> Place {
        match self.text.get(off as usize) {
            Some(b' ') => Place::in_line(off + 1),
            Some(b'\t') => Place {
                tab_left: 3 - self.column(off) % 4,
                ..Place::in_line(off + 1)
            },
            _ => Place::in_line(off),
        }
    }

    fn column(&self, off: OFF) -> u32 {
        let before = &self.text[self.line_start(off) as usize..off as usize];
        before.iter().fold(0, |column, &c| match c {
            b'\t' => column + 4 - column % 4,
            _ => column + 1,
        })
    }

    /// Takes the innermost container, whose content ends at `end`.
    fn leave_container(&mut self, end: OFF) -> Option<Container> {
        let depth = self.containers.len();
        let content = self.innermost().content;
        let end = end.max(content.off);
        self.end_last_child(end);
        let text = self.source(content, end, depth);
        let mut container = self.containers.pop()?;
        container.op.text = text;
        Some(container)
    }

    fn end_left_item(&mut self, is_last: bool) {
        let item = self.innermost();
        let Some((next_line, last_line_end)) = item.left_at else {
            return;
        };
        let (mark_beg, content_beg) = (item.mark_beg, item.content.off);
        let (content_end, raw_end) = if is_last {
            let end = self.trimmed_end(mark_beg, last_line_end);
            (end, end)
        } else if item.op.n_children == 0 {
            (content_beg, next_line)
        } else {
            let before = &self.text[..next_line as usize];
            let line_break = if before.ends_with(b"\r\n") { 2 } else { 1 };
            (next_line - line_break, next_line)
        };
        let Some(mut item) = self.leave_container(content_end) else {
            return;
        };
        item.op.raw = self.source(item.start, raw_end, self.containers.len());
        self.ops.push(item.op);
        self.innermost().op.n_children += 1;
    }

    fn enter_leaf(&mut self, mut op: Op, info_beg: OFF, flags: u32) {
        let lines = self.leaf_lines.take();
        let (beg, mut end) = match lines {
            Some((first, last)) => (first.beg, self.line_end(last.end)),
            None => (info_beg, self.line_end(info_beg)),
        };
        let has_closing_line = match op.kind {
            Kind::FencedCode => flags & types::BLOCK_CLOSED != 0,
            _ => flags & types::BLOCK_SETEXT_HEADER != 0,
        };
        if has_closing_line {
            end = self.line_end(self.next_line(end));
        }
        let start = match op.kind {
            Kind::FencedCode => self.start_child(info_beg),
            _ => self.start_child(beg),
        };
        op.text = core::mem::replace(&mut self.leaf_text, Str::EMPTY);
        self.leaf = Some((op, start, end));
        self.content.base = None;
        self.content.n_children = 0;
    }

    fn leave_leaf(&mut self) {
        let Some((mut op, start, end)) = self.leaf.take() else {
            return;
        };
        let mut base = None;
        match op.kind {
            Kind::Table => op.n_children = core::mem::take(&mut self.n_rows),
            Kind::Heading | Kind::Paragraph | Kind::TextBlock => {
                base = self.content.base;
                self.end_content(&mut op);
            }
            _ => {}
        }
        if op.kind == Kind::Heading {
            if let Some(id) = self.heading_ids.leave_heading() {
                let beg = self.pool.list.len();
                self.pool.write(id);
                op.first = self.pooled_since(beg);
                op.kind = Kind::HeadingWithId;
            }
            self.heading_ids.clear_after_heading();
        }
        self.add_child(op, start, end, base);
    }

    fn code_text(&mut self, lines: &[VerbatimLine]) -> Str {
        let (Some(first), Some(last)) = (lines.first(), lines.last()) else {
            return Str::EMPTY;
        };
        let text_beg = self.line_start(first.beg);
        let mut next = text_beg;
        let is_as_written = lines.iter().all(|line| {
            let white = helpers::line_indentation(self.text, 0, next);
            next = line.end + 1;
            (white.off, white.indent) == (line.beg, line.indent)
                && self.text.get(line.end as usize) != Some(&b'\r')
        });
        if is_as_written {
            let start = Place::line_start(text_beg);
            return self.source(start, last.end, 0);
        }
        let beg = self.pool.list.len();
        for (index, line) in lines.iter().enumerate() {
            if index > 0 {
                self.pool.write_byte(b'\n');
            }
            let (spaces, line_beg) = self.indentation(line);
            self.pool_spaces(spaces);
            let written = &self.text[line_beg as usize..line.end as usize];
            self.pool.write(written);
        }
        self.pooled_since(beg)
    }

    /// Where the indentation of `line` starts, and how many columns of a tab before that place belong to it.
    fn indentation(&self, line: &VerbatimLine) -> (u32, OFF) {
        if line.indent == 0 {
            return (0, line.beg);
        }
        let first_column = self.column(line.beg).saturating_sub(line.indent);
        let (mut off, mut column) = (self.line_start(line.beg), 0);
        while column < first_column {
            column += match self.text[off as usize] {
                b'\t' => 4 - column % 4,
                _ => 1,
            };
            off += 1;
        }
        (column - first_column, off)
    }

    // ───────────────────────────── inline content ─────────────────────────────

    fn content_bytes(&self, beg: u32, end: u32) -> &[u8] {
        let from = self.content.beg_in_pool as usize;
        let end = end.min(self.content.len);
        &self.pool.list[from + beg.min(end) as usize..from + end as usize]
    }

    fn part_of_content(&self, beg: u32, end: u32) -> Str {
        let end = end.min(self.content.len);
        if end <= beg {
            return Str::EMPTY;
        }
        let (from, beg, end) = match self.content.encoding {
            Encoding::Ascii => (From::PartOfBase, beg, end),
            Encoding::Utf8 => {
                let offsets = &self.content.utf16_offsets;
                (
                    From::PartOfBase,
                    offsets[beg as usize],
                    offsets[end as usize],
                )
            }
            Encoding::Invalid => {
                let from = self.content.beg_in_pool;
                (From::Pool, from + beg, from + end)
            }
        };
        Str {
            from,
            beg,
            len: end - beg,
        }
    }

    fn add_inline(&mut self, op: Op) {
        self.ops.push(op);
        match self.content.spans.last_mut() {
            Some(span) => span.op.n_children += 1,
            None => self.content.n_children += 1,
        }
    }

    fn end_text_run(&mut self) {
        let Some((beg, end)) = self.content.text_run.take() else {
            return;
        };
        let is_literal = self.innermost_span() == Some(Kind::Autolink);
        self.add_inline(Op {
            raw: self.part_of_content(beg, end),
            text: Str::of(From::Raw),
            flag_a: self.content.is_in_raw_tag,
            ..Op::new(if is_literal {
                Kind::LiteralText
            } else {
                Kind::Text
            })
        });
    }

    fn innermost_span(&self) -> Option<Kind> {
        self.content.spans.last().map(|span| span.op.kind)
    }

    fn end_content(&mut self, op: &mut Op) {
        debug_assert!(self.content.spans.is_empty());
        // `BunMarkdownTokens.cpp` counts on `n_children`.
        self.at = (self.content.len, self.content.len);
        while !self.content.spans.is_empty() {
            self.end_span();
        }
        self.end_text_run();
        op.n_children = core::mem::take(&mut self.content.n_children);
        if self.content.base.take().is_some() {
            op.text = self.part_of_content(0, self.content.len);
        }
    }

    fn end_span(&mut self) {
        self.end_text_run();
        let Some(Span {
            mut op,
            beg,
            inner_beg,
        }) = self.content.spans.pop()
        else {
            return;
        };
        let (inner_end, end) = self.at;
        op.raw = self.part_of_content(beg, end);
        if op.kind != Kind::Codespan {
            op.text = self.part_of_content(inner_beg, inner_end);
        }
        if matches!(op.kind, Kind::Link | Kind::Image)
            && strings::contains_char(self.content_bytes(inner_beg, inner_end), b'\\')
        {
            let label = self.content_bytes(inner_beg, inner_end).to_vec();
            op.text = self.pool_unescaped(&label, |c| c == b'[' || c == b']');
        }
        self.add_inline(op);
    }

    fn add_tag(&mut self, tag: &[u8]) {
        let is_named = |from: usize, name: &[u8], is_end: fn(u8) -> bool| {
            let end = from + name.len();
            tag.get(from..end)
                .is_some_and(|it| helpers::ascii_case_eql(it, name))
                && tag.get(end).is_some_and(|&c| is_end(c))
        };
        let from = if tag.get(1) == Some(&b'/') { 2 } else { 1 };
        let is_opening = from == 1;
        if is_named(
            from,
            b"a",
            if is_opening {
                |c| c == b' '
            } else {
                |c| c == b'>'
            },
        ) {
            self.content.is_in_link_tag = is_opening;
        }
        let ends_name = |c| c == b'>' || helpers::is_whitespace(c);
        let raw_tags: [&[u8]; 4] = [b"pre", b"code", b"kbd", b"script"];
        if raw_tags.iter().any(|name| is_named(from, name, ends_name)) {
            self.content.is_in_raw_tag = is_opening;
        }
        let is_in_label = |span: &Span| matches!(span.op.kind, Kind::Link | Kind::Image);
        self.add_inline(Op {
            raw: self.part_of_content(self.at.0, self.at.1),
            text: Str::of(From::Raw),
            flag_a: self.content.is_in_link_tag || self.content.spans.iter().any(is_in_label),
            flag_b: self.content.is_in_raw_tag,
            ..Op::new(Kind::HtmlInline)
        });
    }
}

impl RendererImpl for TokenBuilder<'_> {
    fn wants_source(&self) -> bool {
        true
    }

    fn wants_inline_content(&self) -> bool {
        true
    }

    fn heading_ids(&mut self) -> Option<&mut HeadingIdTracker> {
        Some(&mut self.heading_ids)
    }

    fn can_keep(&self) -> bool {
        true
    }

    fn keep(&mut self, slot: u32) -> JsResult<()> {
        if self.leaf.is_none() {
            self.innermost().op.keep_in = slot;
        } else if let Some(row) = self.ops.last_mut() {
            row.keep_in = slot;
        }
        Ok(())
    }

    fn reuse(&mut self, slot: u32) -> JsResult<()> {
        if self.leaf.is_none() {
            self.end_left_item(false);
            self.innermost().op.n_children += 1;
        } else {
            self.n_rows += 1;
        }
        self.ops.push(Op {
            number: slot,
            ..Op::new(Kind::Reuse)
        });
        Ok(())
    }

    fn container_source(&mut self, beg: OFF, end: OFF, indent: u32) {
        self.container_source = (beg.min(self.text.len() as OFF), end, indent);
    }

    fn definition(&mut self, definition: &Definition<'_>) {
        let beg = self.pool.list.len();
        for word in strings::tokenize_any(definition.label, b" \t\n") {
            if self.pool.list.len() > beg {
                self.pool.write_byte(b' ');
            }
            match core::str::from_utf8(word) {
                Ok(word) => self.pool.write(word.to_lowercase().as_bytes()),
                Err(_) => self.pool.write(&word.to_ascii_lowercase()),
            }
        }
        let op = Op {
            text: self.pooled_since(beg),
            first: self.pool_unescaped(definition.dest, helpers::is_ascii_punctuation),
            second: match definition.title {
                [] => Str::of(From::Undefined),
                title => self.pool_unescaped(title, helpers::is_ascii_punctuation),
            },
            ..Op::new(Kind::Def)
        };
        self.definitions.push(PendingDefinition {
            op,
            beg: definition.beg,
            end: self.line_end(definition.end),
        });
    }

    fn leaf_source(&mut self, block_type: BlockType, lines: &[VerbatimLine]) -> bool {
        let used_up = lines.iter().take_while(|line| line.beg > line.end).count();
        let lines = &lines[used_up..];
        self.leaf_lines = lines.first().copied().zip(lines.last().copied());
        if block_type == BlockType::Code {
            self.leaf_text = self.code_text(lines);
        }
        matches!(block_type, BlockType::Code | BlockType::Html)
    }

    fn source_end(&mut self, end: OFF) {
        self.add_definitions_before(end);
        self.end_last_child(end);
    }

    fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()> {
        match block_type {
            BlockType::Doc | BlockType::Thead | BlockType::Tbody => {}
            BlockType::Quote => self.enter_container(Op::new(Kind::Blockquote)),
            BlockType::Ul | BlockType::Ol => self.enter_container(Op {
                flag_a: block_type == BlockType::Ol,
                flag_b: flags & types::BLOCK_LOOSE_LIST != 0,
                number: data,
                ..Op::new(Kind::List)
            }),
            BlockType::Li => {
                self.end_left_item(false);
                let task_mark = types::task_mark_from_data(data);
                let is_loose = self.innermost().op.flag_b;
                self.enter_container(Op {
                    flag_a: task_mark != 0,
                    flag_b: types::is_task_checked(task_mark),
                    flag_c: is_loose,
                    ..Op::new(Kind::ListItem)
                });
            }
            BlockType::Hr => self.enter_leaf(Op::new(Kind::Hr), 0, 0),
            BlockType::H => {
                self.heading_ids.enter_heading();
                let op = Op {
                    number: data,
                    ..Op::new(Kind::Heading)
                };
                self.enter_leaf(op, 0, flags);
            }
            BlockType::Code if flags & types::BLOCK_FENCED_CODE != 0 => {
                let info = &self.text[data as usize..self.line_end(data) as usize];
                let op = Op {
                    first: self.pool_unescaped(info.trim_ascii(), helpers::is_ascii_punctuation),
                    ..Op::new(Kind::FencedCode)
                };
                self.enter_leaf(op, data, flags);
            }
            BlockType::Code => {
                let text = self.bytes(self.leaf_text);
                let line_breaks = text.iter().rev().take_while(|&&c| c == b'\n').count();
                self.leaf_text.len -= line_breaks as u32;
                self.enter_leaf(Op::new(Kind::IndentedCode), 0, 0);
            }
            BlockType::Html => {
                let beg = self.leaf_lines.map_or(0, |(first, _)| first.beg as usize);
                let tag = self.text.get(beg + 1..).unwrap_or_default();
                let is_named = |name: &[u8]| {
                    tag.starts_with(name)
                        && tag
                            .get(name.len())
                            .is_some_and(|&c| c == b'>' || helpers::is_whitespace(c))
                };
                let op = Op {
                    flag_a: is_named(b"pre") || is_named(b"script") || is_named(b"style"),
                    ..Op::new(Kind::HtmlBlock)
                };
                self.leaf_text = Str::of(From::Raw);
                self.enter_leaf(op, 0, 0);
            }
            BlockType::P => {
                let kind = match self.innermost().op.kind {
                    Kind::ListItem => Kind::TextBlock,
                    _ => Kind::Paragraph,
                };
                self.enter_leaf(Op::new(kind), 0, 0);
            }
            BlockType::Table => self.enter_leaf(Op::new(Kind::Table), 0, 0),
            BlockType::Tr => self.n_cells = 0,
            BlockType::Th | BlockType::Td => self.cell_alignment = data,
        }
        Ok(())
    }

    fn leave_block(&mut self, block_type: BlockType, _: u32) -> JsResult<()> {
        let (next_line, last_line_end, _) = self.container_source;
        match block_type {
            BlockType::Doc | BlockType::Thead | BlockType::Tbody => {}
            BlockType::Quote => {
                self.add_definitions_before(next_line);
                let end = self.line_end(
                    last_line_end.max(self.containers[self.containers.len() - 1].mark_beg),
                );
                if let Some(quote) = self.leave_container(end) {
                    self.add_child(quote.op, quote.start, end, None);
                }
            }
            BlockType::Li => {
                self.add_definitions_before(next_line);
                self.innermost().left_at = Some((next_line, last_line_end));
            }
            BlockType::Ul | BlockType::Ol => {
                self.end_left_item(true);
                if let Some(list) = self.containers.pop() {
                    let end = self.trimmed_end(list.mark_beg, last_line_end);
                    self.add_child(list.op, list.start, end, None);
                }
            }
            BlockType::Tr => {
                self.ops.push(Op {
                    n_children: self.n_cells,
                    ..Op::new(Kind::TableRow)
                });
                self.n_rows += 1;
            }
            BlockType::Th | BlockType::Td => {
                let mut cell = Op {
                    flag_a: block_type == BlockType::Th,
                    number: self.cell_alignment,
                    ..Op::new(Kind::TableCell)
                };
                self.end_content(&mut cell);
                self.ops.push(cell);
                self.n_cells += 1;
            }
            _ => self.leave_leaf(),
        }
        match self.pool.oom {
            true => Err(ParserError::OutOfMemory),
            false => Ok(()),
        }
    }

    fn inline_content(&mut self, content: &[u8]) {
        let pooled = self.pool(&[content]);
        let state = &mut self.content;
        state.base = Some(self.ops.len());
        (state.beg_in_pool, state.len) = (pooled.beg, pooled.len);
        (state.is_in_link_tag, state.is_in_raw_tag) = (false, false);
        state.encoding = if strings::is_all_ascii(content) {
            Encoding::Ascii
        } else if strings::is_valid_utf8(content) {
            let mut units = 0;
            state.utf16_offsets.clear();
            state.utf16_offsets.extend(content.iter().map(|&c| {
                let before = units;
                units += u32::from(strings::is_utf8_char_boundary(c)) + u32::from(c >= 0xF0);
                before
            }));
            state.utf16_offsets.push(units);
            Encoding::Utf8
        } else {
            Encoding::Invalid
        };
        self.ops.push(Op {
            raw: pooled,
            ..Op::new(Kind::SetBase)
        });
    }

    fn inline_source(&mut self, beg: OFF, end: OFF) {
        self.at = (beg, end);
    }

    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()> {
        self.end_text_run();
        let mut op = Op::new(match span_type {
            SpanType::Em | SpanType::U => Kind::Em,
            SpanType::Strong => Kind::Strong,
            SpanType::Del => Kind::Del,
            SpanType::Code | SpanType::Latexmath | SpanType::LatexmathDisplay => Kind::Codespan,
            SpanType::A if detail.autolink || detail.permissive_autolink => Kind::Autolink,
            SpanType::A => Kind::Link,
            SpanType::Img => Kind::Image,
            SpanType::Wikilink => Kind::Wikilink,
        });
        let mut inner_beg = self.at.1;
        match op.kind {
            Kind::Autolink => {
                let scheme: &[u8] = match (detail.autolink_email, detail.autolink_www) {
                    (true, _) => b"mailto:",
                    (_, true) => b"http://",
                    _ => b"",
                };
                op.first = self.pool(&[scheme, detail.href]);
            }
            Kind::Link | Kind::Image => {
                op.first = self.pool_unescaped(detail.href, helpers::is_ascii_punctuation);
                op.second = match detail.title {
                    [] => Str::of(From::Null),
                    title => self.pool_unescaped(title, helpers::is_ascii_punctuation),
                };
            }
            Kind::Wikilink => {
                op.first = self.pool(&[detail.href]);
                let behind_target = inner_beg + detail.href.len() as u32;
                if self.content_bytes(behind_target, behind_target + 1) == b"|" {
                    inner_beg = behind_target + 1;
                }
            }
            _ => {}
        }
        self.content.spans.push(Span {
            op,
            beg: self.at.0,
            inner_beg,
        });
        Ok(())
    }

    fn leave_span(&mut self, _: SpanType) -> JsResult<()> {
        self.end_span();
        Ok(())
    }

    fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()> {
        self.heading_ids.track_text(text_type, content);
        let (beg, end) = self.at;
        match text_type {
            TextType::Code | TextType::Latexmath => {
                let text = if strings::contains_char(content, b'\n') {
                    let from = self.pool.list.len();
                    for &c in content {
                        self.pool.write_byte(if c == b'\n' { b' ' } else { c });
                    }
                    self.pooled_since(from)
                } else {
                    self.part_of_content(beg, end)
                };
                if let Some(span) = self.content.spans.last_mut() {
                    span.op.text = text;
                }
            }
            TextType::Br => {
                self.end_text_run();
                self.add_inline(Op {
                    raw: self.part_of_content(beg, end),
                    ..Op::new(Kind::Br)
                });
            }
            TextType::Html => {
                self.end_text_run();
                self.add_tag(content);
            }
            TextType::Normal if content.len() == 1 && end - beg == 2 => {
                self.end_text_run();
                self.add_inline(Op {
                    raw: self.part_of_content(beg, end),
                    text: self.part_of_content(beg + 1, end),
                    ..Op::new(Kind::Escape)
                });
            }
            _ => self.content.text_run.get_or_insert((beg, end)).1 = end,
        }
        Ok(())
    }
}
