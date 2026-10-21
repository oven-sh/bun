//! Builds the syntax tree from the events of `bun_md`, Bun's Markdown parser.
//!
//! The parser reports the blocks and where their lines and markers are. This file works out where each node starts and
//! ends in mdast: micromark and mdast-util-from-markdown have their own rules for line breaks and whitespace at the
//! ends of containers.

use super::ast::{Align, Kind, NONE, Node, NodeId, ReferenceType, Str, Tree};
use super::spans::{self, push_without_nul};
use super::strings::{normalize_identifier, push_lowercase, unescape};
use bun_md::root::{Options, render_with_extensions};
use bun_md::types::{
    BLOCK_CLOSED, BLOCK_DIRECTIVE, BLOCK_EXTENSION, BLOCK_FENCED_CODE, BLOCK_FOOTNOTE,
    BLOCK_HTML_UNTIL_TEXT, BLOCK_SETEXT_HEADER, BlockType, Definition, ExtensionSpan, Extensions,
    JsResult, LeafStart, OFF, Reference, Renderer, RendererImpl, SpanDetail, SpanStart, SpanType,
    TextType, VerbatimLine,
};
use std::cell::Cell;

/// A part of a line that belongs to a leaf block.
#[derive(Copy, Clone, Debug)]
pub(crate) struct Segment {
    pub(crate) start: u32,
    pub(crate) end: u32,
    /// The virtual spaces before `start`. They become spaces in a value.
    pub(crate) virtual_spaces: u8,
}

#[derive(Copy, Clone, PartialEq, Eq, Debug)]
pub(crate) enum Syntax {
    Markdown,
    /// The same with oxfmt's `:::` containers.
    WithDirectives,
    /// The same, used to parse two lines on their own: see `leaves_paragraph`, which isn't called again for them.
    TwoLines,
    /// `Markdown`, used to parse two lines on their own.
    MarkdownTwoLines,
    /// See [`parse_content`].
    Plain,
    /// MDX as Prettier parses it, with remark-parse 8: `import` and `export`, and any tag starts HTML, which is JSX.
    Mdx,
    /// CommonMark as specified, optionally with the GFM extensions and math, and without any of Prettier's additions.
    CommonMark {
        gfm: bool,
        math: bool,
    },
}

/// Prettier parses a text with spaces in place of the front matter. That only makes a difference if something follows
/// the front matter on its last line. In that case this returns the text with the spaces.
pub(crate) fn blank_front_matter(text: &[u8]) -> Option<Vec<u8>> {
    let end = super::front_matter::parse(text)?.end;
    if matches!(text.get(end), None | Some(b'\n')) {
        return None;
    }
    let mut blanked = text.to_vec();
    for byte in blanked[..end].iter_mut().filter(|byte| **byte != b'\n') {
        *byte = b' ';
    }
    Some(blanked)
}

/// Fills `tree` with the syntax tree of `text`, in which every line break is `\n`. Returns the root. `original` is the
/// same text, or the input of [`blank_front_matter`] if `text` is its output.
pub(crate) fn parse(
    text: &[u8],
    original: &[u8],
    syntax: Syntax,
    tree: &mut Tree,
) -> Option<NodeId> {
    let Some(front_matter) = super::front_matter::parse(original) else {
        return parse_lines(text, tree, syntax, 0);
    };
    let is_blanked = !matches!(original.get(front_matter.end), None | Some(b'\n'));
    let first_line = if is_blanked {
        front_matter.end - 3
    } else {
        front_matter.end + 1
    };
    let root = parse_lines(text, tree, syntax, first_line)?;
    let node = tree.add(Kind::FrontMatter, 0, front_matter.end as u32);
    tree.prepend(root, node);
    Some(root)
}

/// `is_plain` means CommonMark with strikethrough, footnotes and task lists, and nothing else: no tables, math, Liquid,
/// wiki links or autolink literals.
pub(crate) fn parse_content(text: &[u8], tree: &mut Tree, is_plain: bool) -> Option<NodeId> {
    let syntax = if is_plain {
        Syntax::Plain
    } else {
        Syntax::Markdown
    };
    parse_lines(text, tree, syntax, 0)
}

fn is_space(byte: u8) -> bool {
    matches!(byte, b' ' | b'\t')
}

fn line_end_in(text: &[u8], offset: usize) -> usize {
    let rest = text.get(offset..).unwrap_or_default();
    offset + bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len())
}

/// Caches `liquid_end`'s searches so they aren't repeated from every `{{`.
#[derive(Copy, Clone, Default)]
struct LeafMemo {
    /// For `}}` and for `%}`: where the search started, and the first match from there. `usize::MAX` means there's
    /// none. 0 means it hasn't been searched.
    closing: [(usize, usize); 2],
    /// The start of a line that starts a container, with no such line between it and `no_container_from`.
    container: usize,
    no_container_from: usize,
}

/// The end of the `{{ .. }}` or `{% .. %}` that starts a line, if nothing follows it on its last line.
fn liquid_end(start: &LeafStart<'_>, memo: &Cell<LeafMemo>) -> Option<OFF> {
    let (text, off) = (start.text, start.off as usize);
    let (closing, kind): (&[u8], usize) = match text.get(off + 1)? {
        b'{' => (b"}}", 0),
        b'%' => (b"%}", 1),
        _ => return None,
    };
    let mut line_end = line_end_in(text, off);
    let from = off + 2;
    let mut known = memo.get();
    // It can span several lines only outside containers.
    let at = if start.is_in_container {
        from + bun_core::strings::index_of(text.get(from..line_end)?, closing)?
    } else {
        let (searched_from, found) = known.closing[kind];
        if found == 0 || from < searched_from || from > found {
            let found = bun_core::strings::index_of(text.get(from..)?, closing);
            known.closing[kind] = (from, found.map_or(usize::MAX, |at| from + at));
            memo.set(known);
        }
        known.closing[kind].1
    };
    if at == usize::MAX {
        return None;
    }
    let end = at + 2;
    if !text[end..line_end_in(text, end)]
        .iter()
        .all(|&byte| is_space(byte))
    {
        return None;
    }
    // No line inside it may start a container.
    if (known.no_container_from..known.container).contains(&line_end) {
        return (end < known.container).then_some(end as OFF);
    }
    let first_line_end = line_end;
    while line_end < end {
        if (start.starts_container)(line_end as OFF + 1) {
            (known.no_container_from, known.container) = (first_line_end, line_end + 1);
            memo.set(known);
            return None;
        }
        line_end = line_end_in(text, line_end + 1);
    }
    Some(end as OFF)
}

/// Prettier's `tokenizeEsSyntax`: `import` or `export` at the start of a line that isn't in a container, up to the next
/// empty line.
fn es_syntax_end(start: &LeafStart<'_>) -> Option<OFF> {
    if start.is_in_container || start.indent > 0 || start.interrupts_paragraph {
        return None;
    }
    let rest = &start.text[start.off as usize..];
    if !(rest.starts_with(b"import") || rest.starts_with(b"export"))
        || !rest.get(6).is_some_and(u8::is_ascii_whitespace)
    {
        return None;
    }
    let len = bun_core::strings::index_of(rest, b"\n\n").unwrap_or(rest.len());
    Some(start.off + len as OFF)
}

// ───────────────────────────── non-CommonMark spans ─────────────────────────────

/// The kinds of span that `span_at` finds.
mod tag {
    pub(super) const LIQUID: u32 = 0;
    pub(super) const ES_COMMENT: u32 = 1;
    pub(super) const MATH: u32 = 2;
    pub(super) const WIKI_LINK: u32 = 3;
    pub(super) const EMAIL: u32 = 4;
    pub(super) const URL: u32 = 5;
    pub(super) const WWW: u32 = 6;
    pub(super) const CHECK: u32 = 7;
}

/// The bytes that start math, a wiki link, Liquid or an MDX comment, and the ones that give away an email address or a
/// URL.
const SPAN_BYTES: &[u8] = b"$[{@:.";

/// Caches searches in a text so they aren't repeated from every marker. Positions are memory addresses.
#[derive(Copy, Clone, Default)]
struct SpanMemo {
    /// The text's `SpanStart::serial`.
    serial: u32,
    /// The text between the two positions could be an email address's name, but isn't one.
    no_address: (usize, usize),
    /// There's no `}}` or `%}` between the two positions.
    no_liquid_end: [(usize, usize); 2],
    /// There's no `]` and no line break between the two positions.
    no_bracket: (usize, usize),
}

/// Prettier's `tokenizeEsComment`: `{/* .. */}` on one line. Returns the range of its content, and its end.
fn es_comment(bytes: &[u8], start: usize) -> Option<((usize, usize), usize)> {
    let skip = |from: usize| {
        from + bytes[from..]
            .iter()
            .take_while(|byte| byte.is_ascii_whitespace())
            .count()
    };
    let open = skip(start + 1);
    if !bytes[open..].starts_with(b"/*") {
        return None;
    }
    let value_start = open + 2;
    let line_end = line_end_in(bytes, value_start);
    // The last `*/` on the line that's followed by `}`.
    let mut limit = line_end;
    loop {
        let close =
            value_start + bun_core::strings::last_index_of(&bytes[value_start..limit], b"*/")?;
        let brace = skip(close + 2);
        if bytes.get(brace) == Some(&b'}') {
            let value = &bytes[value_start..close];
            let leading = value.len() - bun_core::strings::trim_js_whitespace_start(value).len();
            let len = bun_core::strings::trim_js_whitespace_end(
                bun_core::strings::trim_js_whitespace_start(value),
            )
            .len();
            return Some((
                (value_start + leading, value_start + leading + len),
                brace + 1,
            ));
        }
        limit = close + 1;
    }
}

/// The email address that starts at `beg`.
fn email_at(bytes: &[u8], beg: usize) -> Option<ExtensionSpan> {
    if beg > 0 && (bytes[beg - 1] == b'/' || spans::is_gfm_atext(bytes[beg - 1])) {
        return None;
    }
    let end = spans::parse_email_literal(bytes, beg)?;
    Some(ExtensionSpan {
        beg,
        end,
        tag: tag::EMAIL,
    })
}

/// The start of the text that ends at `end` and could be an email address's name.
fn atext_start(start: &SpanStart<'_>, end: usize) -> usize {
    let before = &start.content[start.from.min(end)..end];
    end - before
        .iter()
        .rev()
        .take_while(|&&it| spans::is_gfm_atext(it))
        .count()
}

/// The span that contains a byte of `SPAN_BYTES`, in the text of a paragraph, heading or cell.
/// For `can_start_with_check`, see `Builder::can_start_with_check`.
fn span_at(
    start: &SpanStart<'_>,
    syntax: Syntax,
    can_start_with_check: bool,
    memo: &Cell<SpanMemo>,
) -> Option<ExtensionSpan> {
    let (bytes, index) = (start.content, start.pos);
    // micromark-extension-gfm-task-list-item: `[ ]` or `[x]`, followed by whitespace and something else.
    if index == 0
        && can_start_with_check
        && let [b'[', value, b']', after, ..] = *bytes
        && matches!(value, b' ' | b'\t' | b'x' | b'X')
        // remark-parse 7, which parses MDX, requires a space or tab after it.
        && ((after == b'\n' && syntax != Syntax::Mdx)
            || (is_space(after) && bytes[3..].iter().any(|&byte| !is_space(byte))))
    {
        return Some(ExtensionSpan {
            beg: 0,
            end: 3,
            tag: tag::CHECK,
        });
    }
    if syntax == Syntax::Plain {
        return None;
    }
    let is_mdx = syntax == Syntax::Mdx;
    let is_common_mark = matches!(syntax, Syntax::CommonMark { .. });
    let address = |index: usize| bytes.as_ptr().addr() + index;
    let mut known = memo.get();
    if known.serial != start.serial {
        known = SpanMemo {
            serial: start.serial,
            ..SpanMemo::default()
        };
    }
    let from_here = |end: usize, tag: u32| ExtensionSpan {
        beg: index,
        end,
        tag,
    };
    let byte = bytes[index];
    match byte {
        b'$' => {
            // Only a whole run counts. Its first `$` can be escaped.
            if index > 0 && bytes[index - 1] == b'$' {
                let backslashes = bytes[..index - 1]
                    .iter()
                    .rev()
                    .take_while(|&&it| it == b'\\')
                    .count();
                if backslashes % 2 == 0 {
                    return None;
                }
            }
            let size = bytes[index..].iter().take_while(|&&it| it == b'$').count();
            let end = if is_mdx {
                spans::find_math_end(bytes, index)
            } else if size < 2 && !is_common_mark {
                None
            } else {
                spans::find_closing_run(bytes, index + size, b'$', size)
            };
            end.map(|end| from_here(end, tag::MATH))
        }
        // `[[target]]`
        b'[' => {
            let target_start = index + 2;
            if bytes.get(index + 1) != Some(&b'[') || is_common_mark {
                return None;
            }
            // `![` starts an image, whatever follows.
            if index > 0 && bytes[index - 1] == b'!' {
                let backslashes = bytes[..index - 1]
                    .iter()
                    .rev()
                    .take_while(|&&it| it == b'\\')
                    .count();
                if backslashes % 2 == 0 {
                    return None;
                }
            }
            let (from, until) = known.no_bracket;
            let is_known = (from..=until).contains(&address(target_start));
            let mut target_end = match is_known {
                true => until.min(address(bytes.len())) - address(0),
                false => target_start.min(bytes.len()),
            };
            if bytes
                .get(target_end)
                .is_some_and(|it| !matches!(it, b']' | b'\n'))
            {
                let len = bun_core::strings::index_of_any(&bytes[target_end..], b"]\n");
                target_end = len.map_or(bytes.len(), |len| target_end + len);
            }
            if !is_known {
                known.no_bracket = (address(target_start), address(target_end));
                memo.set(known);
            } else if address(target_end) > until {
                known.no_bracket.1 = address(target_end);
                memo.set(known);
            }
            if !bytes[target_end..].starts_with(b"]]")
                || bytes[target_start..target_end]
                    .iter()
                    .all(|&byte| is_space(byte))
            {
                return None;
            }
            Some(from_here(target_end + 2, tag::WIKI_LINK))
        }
        b'{' => {
            if is_mdx && let Some((_, end)) = es_comment(bytes, index) {
                return Some(from_here(end, tag::ES_COMMENT));
            }
            let (closing, which): (&[u8], usize) = match bytes.get(index + 1)? {
                b'{' => (b"}}", 0),
                b'%' => (b"%}", 1),
                _ => return None,
            };
            let (from, until) = known.no_liquid_end[which];
            if from != 0 && from <= address(index) && address(bytes.len()) <= until {
                return None;
            }
            let Some(len) = bun_core::strings::index_of(&bytes[index + 2..], closing) else {
                known.no_liquid_end[which] = (address(index), address(bytes.len()));
                memo.set(known);
                return None;
            };
            Some(from_here(index + 2 + len + 2, tag::LIQUID))
        }
        // No autolink literals in what can still become a link's text.
        _ if start.is_after_open_bracket => None,
        b'@' => email_at(bytes, atext_start(start, index)),
        // `http://`, `https://`
        b':' => {
            if !bytes[index + 1..].starts_with(b"//") {
                return None;
            }
            let before = &bytes[start.from.min(index)..index];
            let len = [&b"https"[..], b"http"]
                .into_iter()
                .find(|it| {
                    before.len() >= it.len()
                        && before[before.len() - it.len()..].eq_ignore_ascii_case(it)
                })?
                .len();
            let beg = index - len;
            if beg > 0 && bytes[beg - 1].is_ascii_alphabetic() {
                return None;
            }
            let end = spans::parse_protocol_literal(bytes, beg)?;
            Some(ExtensionSpan {
                beg,
                end,
                tag: tag::URL,
            })
        }
        // `www.`
        b'.' => {
            let beg = index.checked_sub(3).filter(|&beg| beg >= start.from)?;
            if !bytes[beg..index].eq_ignore_ascii_case(b"www") {
                return None;
            }
            // An email address that starts with it, or has it in its name, takes precedence.
            if !(known.no_address.0..known.no_address.1).contains(&address(beg)) {
                let name_start = atext_start(start, beg);
                let name_end = index
                    + bytes[index..]
                        .iter()
                        .take_while(|&&it| spans::is_gfm_atext(it))
                        .count();
                if bytes.get(name_end) == Some(&b'@')
                    && let Some(email) = email_at(bytes, name_start)
                {
                    return Some(email);
                }
                known.no_address = (address(name_start), address(name_end));
                memo.set(known);
            }
            if beg > 0
                && !matches!(
                    bytes[beg - 1],
                    b'(' | b'*' | b'_' | b'[' | b']' | b'~' | b' ' | b'\t' | b'\n'
                )
            {
                return None;
            }
            let end = spans::parse_www_literal(bytes, beg)?;
            Some(ExtensionSpan {
                beg,
                end,
                tag: tag::WWW,
            })
        }
        _ => None,
    }
}

/// An open container.
struct Open {
    node: NodeId,
    /// The line that its last child ends on, for detecting blank lines between children. 0 means it has no child.
    last_child_line: u32,
}

/// Fenced code or HTML that hasn't been closed. Where it ends depends on what follows.
struct Unended {
    node: NodeId,
    is_html: bool,
    first_segment: usize,
}

struct Builder<'t> {
    /// The whole text.
    text: &'t [u8],
    /// Where the parser's input starts in it.
    base: u32,
    is_mdx: bool,
    is_for_oxfmt: bool,
    has_nul: bool,
    /// The replacement for a NUL in the tree: U+FFFD, as CommonMark specifies. oxfmt prints the source text.
    nul: &'static [u8],
    tree: &'t mut Tree,
    /// The open containers, root first.
    open: Vec<Open>,
    /// How many of them are block quotes.
    open_blockquotes: u32,
    /// The parser's last report about a container, and a leaf block's lines.
    source: (u32, u32, u32),
    lines: Vec<VerbatimLine>,
    /// The definitions that aren't in the tree yet, by start offset.
    definitions: Vec<(u32, NodeId)>,
    next_definition: usize,
    are_definitions_sorted: bool,
    segments: Vec<Segment>,
    unended: Option<Unended>,
    /// The containers that have ended since the last leaf block, each with the start of the line that ended it.
    ended: Vec<(NodeId, u32)>,
    /// The open nodes extend to the very end of the text: see `Builder::extends_to_the_end`.
    is_extended_to_the_end: bool,

    /// The open paragraph, heading or cell, and the open spans in it.
    spans: Vec<NodeId>,
    /// The parser's last report about a position within a line.
    inline_range: (u32, u32),
    /// Where the opening marker of each of `spans` ends.
    marker_ends: Vec<u32>,
    /// The text that isn't a node yet: its range, its decoded value, and whether that equals the source text.
    text_range: Option<(u32, u32)>,
    text_value: Vec<u8>,
    text_matches_source: bool,
    /// The text content of the open image.
    alt: Vec<u8>,
    /// Where its last part ends.
    alt_end: u32,
    /// True if the next text is where a task's `[x]` is looked for: the text of a paragraph that's the first thing in a
    /// list item, not counting definitions.
    can_start_with_check: &'t Cell<bool>,
    /// The open paragraph starts with one.
    starts_with_check: bool,
    /// The syntax `leaves_paragraph` parses two lines with. If `None`, lines that are paragraph text only because
    /// they're indented aren't handled specially.
    two_lines: Option<Syntax>,
    /// A pending line break. How it's printed depends on the node after it.
    guarded_break: Option<GuardedBreak>,
    /// For oxfmt: the current line is one that it prints verbatim.
    is_on_verbatim_line: bool,
}

/// A line break before a line that is paragraph text only because it's indented. Prettier always strips the
/// indentation, so a fence starts a code block, `***` becomes a thematic break, and `<div>` starts HTML.
#[derive(Copy, Clone)]
struct GuardedBreak {
    break_range: (u32, u32),
    kind: LineBreak,
    /// The line before it, and the line after it without its indentation.
    above: (u32, u32),
    line: (u32, u32),
}

#[derive(Copy, Clone)]
enum LineBreak {
    /// `matches_source` means nothing was removed before it.
    Soft {
        matches_source: bool,
    },
    Hard,
}

/// The kind of node that follows a [`GuardedBreak`].
#[derive(Copy, Clone, PartialEq, Eq)]
enum Follower {
    Text,
    /// HTML, Liquid, math: nodes that are printed verbatim.
    Verbatim,
    /// A code span, whose backticks are recounted.
    Code,
    Other,
}

/// The first `len` bytes of `rest`, a line that starts with a code span, with as few backticks in front as the span's
/// content allows.
fn with_printed_backticks(rest: &[u8], len: usize) -> Vec<u8> {
    let run_at = |at: usize| rest[at..].iter().take_while(|&&byte| byte == b'`').count();
    let source_run = run_at(0);
    let (mut lengths, mut at) = (0u64, source_run);
    while let Some(skipped) = bun_core::strings::index_of_char_usize(&rest[at..], b'`') {
        at += skipped;
        let run = run_at(at);
        if run == source_run {
            break;
        }
        lengths |= 1 << (run.clamp(1, 64) - 1);
        at += run;
    }
    let mut line = vec![b'`'; lengths.trailing_ones() as usize + 1];
    line.extend_from_slice(rest.get(source_run..len).unwrap_or_default());
    line
}

/// oxfmt's `is_line_shape_start`: `:::` that doesn't start a container, VitePress's `<<<`, a component's tag.
fn is_line_shape_start(line: &[u8]) -> bool {
    if line.starts_with(b":::") {
        let colons = line.iter().take_while(|&&byte| byte == b':').count();
        return !line[colons..]
            .trim_ascii_start()
            .first()
            .is_some_and(|&byte| {
                byte.is_ascii_alphanumeric() || matches!(byte, b'_' | b'{' | b'[') || byte >= 0x80
            });
    }
    let Some(tag) = line.strip_prefix(b"<") else {
        return false;
    };
    if tag.starts_with(b"<<") {
        return true;
    }
    let tag = tag.strip_prefix(b"/").unwrap_or(tag);
    let len = tag
        .iter()
        .take_while(|&&byte| byte.is_ascii_alphanumeric() || byte == b'-')
        .count();
    let name = &tag[..len];
    name.first().is_some_and(|first| {
        first.is_ascii_uppercase()
            || (first.is_ascii_alphabetic() && bun_core::strings::contains_char(name, b'-'))
    })
}

/// True if `line` may be a table's delimiter row.
fn looks_like_delimiter_row(line: &[u8]) -> bool {
    line.iter()
        .all(|byte| matches!(byte, b'|' | b':' | b'-' | b' ' | b'\t'))
}

/// True if `line` would no longer be part of the paragraph if it started in the first column. `above` is the line
/// before it, which only matters for a table's delimiter row. Without it, a matching header is assumed.
pub(crate) fn leaves_paragraph(above: Option<&[u8]>, line: &[u8], syntax: Syntax) -> bool {
    let fitting_header: Vec<u8>;
    let first: &[u8] = match above {
        _ if !looks_like_delimiter_row(line) => b"a",
        Some(above) => above,
        None => {
            let letter = |&byte: &u8| {
                if matches!(byte, b':' | b'-') {
                    b'a'
                } else {
                    byte
                }
            };
            fitting_header = line.iter().map(letter).collect();
            &fitting_header
        }
    };
    let text = [first, b"\n", line, b"\n"].concat();
    let mut tree = Tree::default();
    let Some(root) = parse_lines(&text, &mut tree, syntax, 0) else {
        return false;
    };
    let first = tree.get(root).map_or(NONE, |root| root.first_child);
    !tree
        .get(first)
        .is_some_and(|first| first.kind == Kind::Paragraph && first.next == NONE)
}

impl Builder<'_> {
    // ───────────────────────────── positions ─────────────────────────────

    /// The end of the line that `offset` is on.
    fn line_end(&self, offset: u32) -> u32 {
        let rest = self.text.get(offset as usize..).unwrap_or_default();
        offset + bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len()) as u32
    }

    /// The column of `offset`. A tab advances to the next multiple of four.
    fn column(&self, offset: u32) -> u32 {
        let start = self.tree.line_start(offset);
        let before = self
            .text
            .get(start as usize..offset as usize)
            .unwrap_or_default();
        before.iter().fold(0, |column, &byte| match byte {
            b'\t' => (column + 4) / 4 * 4,
            _ => column + 1,
        })
    }

    /// The start of the `indent` columns of whitespace before `beg`, and how many of those columns are the rest of a
    /// tab that starts before that position.
    fn indentation_start(&self, beg: u32, indent: u32) -> (u32, u8) {
        if indent == 0 {
            return (beg, 0);
        }
        if let Some(start) = beg.checked_sub(indent)
            && self
                .text
                .get(start as usize..beg as usize)
                .is_some_and(|it| it.iter().all(|&byte| byte == b' '))
        {
            return (start, 0);
        }
        let target = self.column(beg).saturating_sub(indent);
        let (mut offset, mut column) = (self.tree.line_start(beg), 0);
        while offset < beg && column < target {
            column = match self.text.get(offset as usize) {
                Some(b'\t') => (column + 4) / 4 * 4,
                _ => column + 1,
            };
            offset += 1;
        }
        (offset, (column - target.min(column)).min(3) as u8)
    }

    fn segment(&self, line: &VerbatimLine) -> Segment {
        let (start, virtual_spaces) = self.indentation_start(line.beg, line.indent);
        Segment {
            start,
            end: line.end,
            virtual_spaces,
        }
    }

    // ───────────────────────────── the tree ─────────────────────────────

    fn parent(&self) -> NodeId {
        self.open.last().map_or(NONE, |it| it.node)
    }

    fn set_end(&mut self, node: NodeId, end: u32) {
        if let Some(node) = self.tree.get_mut(node) {
            node.end = end;
        }
    }

    fn is_in_blockquote(&self) -> bool {
        self.open_blockquotes > 0
    }

    /// Adds `node`, which starts at `start`, to the open container. A blank line before it makes a list or an item
    /// `spread`.
    fn append(&mut self, node: NodeId, start: u32) {
        let Some(&Open {
            node: parent,
            last_child_line,
        }) = self.open.last()
        else {
            return;
        };
        self.tree.append(parent, node);
        if last_child_line > 0
            && self.tree.line(start) > last_child_line + 1
            && let Some(parent) = self.tree.get_mut(parent)
        {
            parent.spread = true;
        }
    }

    /// Records that the open container's last child ends at `end`.
    fn note_child_end(&mut self, end: u32) {
        if let Some(parent) = self.open.last_mut()
            && matches!(
                self.tree.kind(parent.node),
                Some(Kind::List | Kind::ListItem)
            )
        {
            parent.last_child_line = self.tree.line(end);
        }
    }

    /// Adds the definitions that start before `offset` to the open container.
    fn add_definitions_before(&mut self, offset: u32) {
        // The ones in front of a setext heading were reported first, out of order.
        if !std::mem::replace(&mut self.are_definitions_sorted, true) {
            crate::sort::sort_by_key(&mut self.definitions[..], |it| it.0);
        }
        while let Some(&(start, node)) = self.definitions.get(self.next_definition)
            && start < offset
        {
            self.next_definition += 1;
            self.end_unended(None);
            self.ended.clear();
            self.append(node, start);
            let end = self.tree.get(node).map_or(start, |node| node.end);
            self.note_child_end(end);
        }
    }

    fn add_leaf(&mut self, kind: Kind, start: u32, end: u32) -> NodeId {
        self.add_definitions_before(start);
        self.end_unended(None);
        self.ended.clear();
        let node = self.tree.add(kind, start, end);
        self.append(node, start);
        self.note_child_end(end);
        node
    }

    /// The value of a string where escapes and character references are decoded. `null` if it's empty.
    fn string_value(&mut self, start: u32, end: u32) -> Str {
        let raw = self
            .text
            .get(start as usize..end as usize)
            .unwrap_or_default();
        if raw.is_empty() {
            return Str::NO;
        }
        if bun_core::strings::index_of_any(raw, b"\\&\0").is_some() {
            return self.tree.owned(|out| unescape(raw, out));
        }
        Str::source(start, end)
    }

    /// Joins the lines `segments[first..]` with line breaks, and removes them from `segments`.
    fn joined_value(&mut self, first: usize) -> Str {
        let segments = self.segments.get(first..).unwrap_or_default();
        let (Some(first_segment), Some(last_segment)) = (segments.first(), segments.last()) else {
            return Str::EMPTY;
        };
        // Nothing was stripped from the lines, so the value is a plain range of the text.
        let is_plain = segments.iter().all(|it| it.virtual_spaces == 0)
            && segments
                .iter()
                .zip(&segments[1..])
                .all(|(line, next)| line.end + 1 == next.start)
            && first_segment.start <= last_segment.end
            && !(self.has_nul
                && bun_core::strings::contains_char(
                    self.text
                        .get(first_segment.start as usize..last_segment.end as usize)
                        .unwrap_or_default(),
                    0,
                ));
        let value = if is_plain {
            Str::source(first_segment.start, last_segment.end)
        } else {
            let (text, nul) = (self.text, self.nul);
            self.tree.owned(|out| {
                for (index, segment) in segments.iter().enumerate() {
                    if index > 0 {
                        out.push(b'\n');
                    }
                    out.extend(std::iter::repeat_n(
                        b' ',
                        usize::from(segment.virtual_spaces),
                    ));
                    let line = text
                        .get(segment.start as usize..segment.end as usize)
                        .unwrap_or_default();
                    push_without_nul(line, nul, out);
                }
            })
        };
        self.segments.truncate(first);
        value
    }

    // ───────────────────────────── unclosed code and HTML ─────────────────────────────

    /// micromark treats what follows the text's last line break as a line. Lists continue onto it, block quotes don't.
    /// So unclosed code and HTML, and the lists they're in, include that line break.
    fn extends_to_the_end(&self, last_line_end: u32) -> bool {
        last_line_end as usize + 1 == self.text.len() && !self.is_in_blockquote()
    }

    /// If `line_start` is set, the line that starts there has a container's marker, which ends the code or HTML. By
    /// then the node has already taken the line break before it.
    fn end_unended(&mut self, line_start: Option<u32>) {
        let Some(Unended {
            node,
            is_html,
            first_segment,
        }) = self.unended.take()
        else {
            return;
        };
        let end = match line_start {
            Some(line_start) => Some(line_start),
            None if self.is_extended_to_the_end => Some(self.text.len() as u32),
            None => None,
        };
        if let Some(end) = end {
            self.segments.push(Segment {
                start: end,
                end,
                virtual_spaces: 0,
            });
            self.set_end(node, end);
        }
        // Without a closing fence, the line break at the end isn't part of the value.
        if !is_html
            && self
                .segments
                .get(first_segment..)
                .and_then(|it| it.last())
                .is_some_and(|it| it.start == it.end && it.virtual_spaces == 0)
        {
            self.segments.pop();
        }
        let value = self.joined_value(first_segment);
        if let Some(node) = self.tree.get_mut(node) {
            node.value = value;
        }
    }

    // ───────────────────────────── leaf blocks ─────────────────────────────

    /// A paragraph, or a setext heading of depth `setext_depth`.
    fn paragraph(&mut self, lines: &[VerbatimLine], setext_depth: Option<u32>) {
        let mut lines = lines.iter().filter(|line| line.beg <= line.end);
        let Some(first) = lines.next() else {
            return;
        };
        let last = lines.clone().next_back().unwrap_or(first);
        let node = match setext_depth {
            None => {
                let end = self.line_end(last.end);
                self.add_leaf(Kind::Paragraph, first.beg, end)
            }
            Some(depth) => {
                self.add_definitions_before(first.beg);
                // The heading starts where the definitions right before it start.
                let mut start = first.beg;
                let mut previous = self
                    .tree
                    .get(self.parent())
                    .map_or(NONE, |parent| parent.last_child);
                while let Some(definition) = self
                    .tree
                    .get(previous)
                    .filter(|it| it.kind == Kind::Definition)
                    && self.tree.line(definition.end) + 1 == self.tree.line(start)
                {
                    (start, previous) = (definition.start, definition.previous);
                }
                let end = self.line_end(self.line_end(last.end) + 1);
                let node = self.add_leaf(Kind::Heading, first.beg, end);
                if let Some(node) = self.tree.get_mut(node) {
                    (node.start, node.number) = (start, depth);
                }
                node
            }
        };
        self.spans.push(node);
        self.can_start_with_check
            .set(setext_depth.is_none() && self.is_first_content_of_item(node));
    }

    fn is_first_content_of_item(&self, paragraph: NodeId) -> bool {
        if self.tree.kind(self.parent()) != Some(Kind::ListItem) {
            return false;
        }
        let mut previous = self.tree.get(paragraph).map_or(NONE, |node| node.previous);
        while let Some(sibling) = self.tree.get(previous) {
            if sibling.kind != Kind::Definition {
                return false;
            }
            previous = sibling.previous;
        }
        true
    }

    /// mdast-util-gfm-task-list-item: the first whitespace character after `[x]` isn't part of the paragraph.
    fn strip_space_after_check(&mut self, paragraph: NodeId) {
        let head = self
            .tree
            .get(paragraph)
            .map_or(NONE, |node| node.first_child);
        let Some(&Node {
            kind: Kind::Text,
            value,
            start,
            ..
        }) = self.tree.get(head)
        else {
            return;
        };
        let rest = self
            .tree
            .str(self.text, value)
            .get(1..)
            .unwrap_or_default()
            .to_vec();
        if rest.is_empty() {
            return self.tree.detach(head);
        }
        let rest = self.tree.owned(|out| out.extend_from_slice(&rest));
        if let Some(head) = self.tree.get_mut(head) {
            (head.value, head.start) = (rest, start + 1);
        }
        if let Some(paragraph) = self.tree.get_mut(paragraph) {
            paragraph.start = start + 1;
        }
    }

    fn atx_heading(&mut self, line: &VerbatimLine, depth: u32) {
        let mut marker_end = line.beg;
        while marker_end > 0 && is_space(self.text[marker_end as usize - 1]) {
            marker_end -= 1;
        }
        let end = self.line_end(line.end);
        let node = self.add_leaf(Kind::Heading, marker_end.saturating_sub(depth), end);
        if let Some(node) = self.tree.get_mut(node) {
            node.number = depth;
        }
        self.spans.push(node);
    }

    /// `info_start` is where the text after the opening fence starts.
    fn fenced_code(&mut self, lines: &[VerbatimLine], info_start: u32, is_closed: bool) {
        let mut fence_end = info_start;
        while fence_end > 0 && is_space(self.text[fence_end as usize - 1]) {
            fence_end -= 1;
        }
        let marker = self.text[fence_end.saturating_sub(1) as usize];
        let mut start = fence_end;
        while start > 0 && self.text[start as usize - 1] == marker {
            start -= 1;
        }
        let info_end = self.line_end(info_start);
        let last_line_end = lines.last().map_or(info_end, |line| line.end);
        let end = match is_closed {
            true => self.line_end(last_line_end + 1),
            false => last_line_end,
        };
        let kind = if marker == b'$' {
            Kind::Math
        } else {
            Kind::Code
        };
        let node = self.add_leaf(kind, start, end);
        let info = &self.text[info_start as usize..info_end as usize];
        let lang_len = match kind {
            Kind::Code => info.iter().take_while(|&&byte| !is_space(byte)).count(),
            _ => 0,
        } as u32;
        let whitespace_len = info[lang_len as usize..]
            .iter()
            .take_while(|&&byte| is_space(byte))
            .count() as u32;
        let (lang, meta) = (
            self.string_value(info_start, info_start + lang_len),
            self.string_value(info_start + lang_len + whitespace_len, info_end),
        );
        if let Some(node) = self.tree.get_mut(node) {
            (node.second, node.third) = (lang, meta);
        }
        let first_segment = self.segments.len();
        for line in lines {
            let segment = self.segment(line);
            self.segments.push(segment);
        }
        if is_closed {
            let value = self.joined_value(first_segment);
            if let Some(node) = self.tree.get_mut(node) {
                node.value = value;
            }
            return;
        }
        self.is_extended_to_the_end = self.extends_to_the_end(last_line_end);
        self.unended = Some(Unended {
            node,
            is_html: false,
            first_segment,
        });
    }

    fn indented_code(&mut self, lines: &[VerbatimLine]) {
        let Some(first) = lines.first() else {
            return;
        };
        // At the end of a line, micromark checks if that same line, not the next one, continues without its containers'
        // markers. So code that starts on the line that ends a container ends with that line.
        let line_start = self.tree.line_start(first.beg);
        if lines.len() > 1 && !self.is_for_oxfmt && self.ended.iter().any(|it| it.1 == line_start) {
            self.indented_code(&lines[..1]);
            let blank_lines = lines[1..]
                .iter()
                .take_while(|line| line.beg >= line.end)
                .count();
            return self.indented_code(&lines[1 + blank_lines..]);
        }
        let (start, _) = self.indentation_start(first.beg, first.indent + 4);
        // A blank line that is indented enough is part of the code, even at its end.
        let code_column = self.column(first.beg).saturating_sub(first.indent);
        let count = lines
            .iter()
            .rposition(|line| line.beg < line.end || self.column(line.end) >= code_column)
            .map_or(1, |last| last + 1);
        let lines = &lines[..count];
        let end = lines.last().map_or(first.end, |line| line.end);
        let node = self.add_leaf(Kind::Code, start, end);
        let first_segment = self.segments.len();
        for line in lines {
            let segment = self.segment(line);
            self.segments.push(segment);
        }
        // A line break at the end isn't part of the value.
        if count > 1
            && self
                .segments
                .last()
                .is_some_and(|it| it.start == it.end && it.virtual_spaces == 0)
        {
            self.segments.pop();
        }
        let value = self.joined_value(first_segment);
        if let Some(node) = self.tree.get_mut(node) {
            node.value = value;
            node.number = u32::from(self.is_for_oxfmt);
        }
    }

    /// A block that `liquid_end` or `es_syntax_end` found.
    fn extension(&mut self, line: &VerbatimLine) {
        let source = self
            .text
            .get(line.beg as usize..line.end as usize)
            .unwrap_or_default();
        let (kind, len) = match source.first() {
            Some(b'i') => (Kind::Import, source.len()),
            Some(b'e') => (Kind::Export, source.len()),
            _ => (
                Kind::LiquidNode,
                source.len()
                    - source
                        .iter()
                        .rev()
                        .take_while(|&&byte| is_space(byte))
                        .count(),
            ),
        };
        let end = line.beg + len as u32;
        let node = self.add_leaf(kind, line.beg, end);
        if let Some(node) = self.tree.get_mut(node) {
            node.value = Str::source(line.beg, end);
        }
    }

    fn html(&mut self, lines: &[VerbatimLine], is_unended: bool, is_ended_by_text: bool) {
        let (Some(first), Some(last)) = (lines.first(), lines.last()) else {
            return;
        };
        let (start, _) = self.indentation_start(first.beg, first.indent);
        let node = self.add_leaf(Kind::Html, start, last.end);
        if let Some(node) = self.tree.get_mut(node) {
            node.number = u32::from(is_ended_by_text && self.is_for_oxfmt);
        }
        let first_segment = self.segments.len();
        for line in lines {
            let segment = self.segment(line);
            self.segments.push(segment);
        }
        if is_unended {
            self.is_extended_to_the_end = self.extends_to_the_end(last.end);
            self.unended = Some(Unended {
                node,
                is_html: true,
                first_segment,
            });
            return;
        }
        let value = self.joined_value(first_segment);
        if let Some(node) = self.tree.get_mut(node) {
            node.value = value;
        }
    }

    fn table(&mut self, lines: &[VerbatimLine]) {
        let (Some(head), Some(last)) = (lines.first(), lines.last()) else {
            return;
        };
        let end = self.line_end(last.end);
        let node = self.add_leaf(Kind::Table, head.beg, end);
        let first_align = self.tree.aligns.len() as u32;
        if let Some(node) = self.tree.get_mut(node) {
            node.first_align = first_align;
        }
        self.spans.push(node);
    }

    fn table_row(&mut self) {
        let (start, end) = (self.inline_range.0, self.line_end(self.inline_range.1));
        let row = self.tree.add(Kind::TableRow, start, end);
        self.tree
            .append(self.spans.last().copied().unwrap_or(NONE), row);
        self.spans.push(row);
    }

    /// A cell includes the pipe before it. The first cell also includes what's before it in the row, and the last
    /// what's after it.
    fn table_cell(&mut self, align: Option<Align>) {
        let row = self.spans.last().copied().unwrap_or(NONE);
        let start = match self.tree.get(row) {
            Some(row) if row.first_child == NONE => row.start,
            _ => self.inline_range.0.saturating_sub(1),
        };
        let cell = self.tree.add(Kind::TableCell, start, self.inline_range.1);
        self.tree.append(row, cell);
        self.spans.push(cell);
        if let Some(align) = align {
            self.tree.aligns.push(align);
            let table = self.tree.get(row).map_or(NONE, |row| row.parent);
            if let Some(table) = self.tree.get_mut(table) {
                table.number += 1;
            }
        }
    }

    fn end_table_row(&mut self) {
        let row = self.spans.pop().unwrap_or(NONE);
        let Some(&super::ast::Node {
            start,
            end,
            last_child,
            ..
        }) = self.tree.get(row)
        else {
            return;
        };
        // A row that's only a pipe still has a cell.
        if last_child == NONE {
            let cell = self.tree.add(Kind::TableCell, start, end);
            return self.tree.append(row, cell);
        }
        self.set_end(last_child, end);
    }

    // ───────────────────────────── containers ─────────────────────────────

    /// The start of the content of the item whose marker ends at `marker_end`: after one to four columns of whitespace.
    /// If there are more, the rest is indented code. If nothing follows, the whitespace isn't part of it.
    fn item_content_start(&self, marker_end: u32) -> u32 {
        let line_end = self.line_end(marker_end);
        let rest = &self.text[marker_end as usize..line_end as usize];
        let whitespace_len = rest.iter().take_while(|&&byte| is_space(byte)).count();
        if whitespace_len == rest.len() {
            return marker_end;
        }
        let start = self.column(marker_end);
        let width = self.column(marker_end + whitespace_len as u32) - start;
        match width <= 4 {
            true => marker_end + whitespace_len as u32,
            false => marker_end + 1,
        }
    }

    /// Called when a container starts whose marker is at `marker`, after `indent` columns of whitespace.
    /// `is_next_item` means it's the next item of the open list.
    fn before_container(&mut self, marker: u32, indent: u32, marker_end: u32, is_next_item: bool) {
        self.add_definitions_before(marker);
        let line_start = self.tree.line_start(marker);
        let ended = std::mem::take(&mut self.ended);
        let takes_line_break = self.unended.is_some()
            && !ended.is_empty()
            && ended.iter().all(|it| it.1 == line_start);
        self.end_unended(takes_line_break.then_some(line_start));
        if is_next_item {
            // With no line break between them, mdast-util-from-markdown ends an item where the next item's marker ends.
            if takes_line_break {
                let previous_item = ended.last().map_or(NONE, |it| it.0);
                for &(node, _) in &ended {
                    self.set_end(node, line_start);
                }
                self.set_end(previous_item, self.item_content_start(marker_end));
            }
            return;
        }
        // micromark ends the containers here, and then moves their ends back over line breaks and indentation. A block
        // quote's marker blocks that.
        if takes_line_break || self.is_in_blockquote() {
            let (end, _) = self.indentation_start(marker, indent);
            for &(node, _) in ended.iter().filter(|it| it.1 == line_start) {
                if takes_line_break || self.tree.kind(node) != Some(Kind::ListItem) {
                    self.set_end(node, end);
                }
            }
        }
    }

    fn enter_container(&mut self, kind: Kind, start: u32, end: u32) -> NodeId {
        let node = self.tree.add(kind, start, end);
        self.append(node, start);
        self.open_blockquotes += u32::from(kind == Kind::Blockquote);
        self.open.push(Open {
            node,
            last_child_line: 0,
        });
        node
    }

    fn leave_container(&mut self) {
        let (ended_by, end, is_ended_by_colons) = self.source;
        self.add_definitions_before(end);
        let Some(Open { node, .. }) = self.open.pop() else {
            return;
        };
        self.open_blockquotes -= u32::from(self.tree.kind(node) == Some(Kind::Blockquote));
        if is_ended_by_colons != 0 && self.tree.kind(node) == Some(Kind::Directive) {
            let line_end = self.line_end(ended_by);
            let line = self
                .text
                .get(ended_by as usize..line_end as usize)
                .unwrap_or_default();
            let colons = bun_core::strings::index_of_char_usize(line, b':').unwrap_or(0) as u32;
            if let Some(node) = self.tree.get_mut(node) {
                node.second = Str::source(ended_by + colons, line_end);
            }
            self.note_child_end(line_end);
            self.set_end(node, line_end);
            return;
        }
        self.note_child_end(end);
        let len = self.text.len() as u32;
        let ended_by = match ended_by {
            u32::MAX if self.text.last() == Some(&b'\n') => len,
            u32::MAX => len + 1,
            _ => ended_by,
        };
        let mut node_end = end;
        // An empty line with a block quote's marker belongs to the lists in the quote, but not to their items.
        if self.tree.kind(node) != Some(Kind::ListItem)
            && self.tree.kind(node) != Some(Kind::Blockquote)
            && self.is_in_blockquote()
        {
            node_end = node_end.max(ended_by - 1);
        }
        if self.is_extended_to_the_end {
            node_end = len;
        }
        self.set_end(node, node_end);
        self.ended.push((node, ended_by));
    }

    // ───────────────────────────── inline content ─────────────────────────────

    /// The source text from `start` to `end` in the open block, without what precedes its lines in the file, except
    /// their indentation.
    fn push_content_between(&self, start: u32, end: u32, out: &mut Vec<u8>) {
        let mut from = start;
        loop {
            let rest = self
                .text
                .get(from as usize..end as usize)
                .unwrap_or_default();
            let len = bun_core::strings::index_of_char_usize(rest, b'\n').unwrap_or(rest.len());
            let line_end = from + len as u32;
            out.extend_from_slice(
                self.text
                    .get(from as usize..line_end as usize)
                    .unwrap_or_default(),
            );
            let next = self.lines.partition_point(|line| line.beg <= line_end);
            let Some(line) = self.lines.get(next).filter(|_| line_end < end) else {
                return;
            };
            out.push(b'\n');
            from = self.indentation_start(line.beg, line.indent).0;
        }
    }

    fn is_on_one_line(&self, start: u32, end: u32) -> bool {
        self.text
            .get(start as usize..end as usize)
            .is_some_and(|it| !bun_core::strings::contains_char(it, b'\n'))
    }

    /// The string from `start` to `end`, not decoded.
    fn raw(&mut self, start: u32, end: u32) -> Str {
        if self.is_on_one_line(start, end)
            && !(self.has_nul
                && bun_core::strings::contains_char(&self.text[start as usize..end as usize], 0))
        {
            return Str::source(start, end);
        }
        let mut bytes = Vec::new();
        self.push_content_between(start, end, &mut bytes);
        let nul = self.nul;
        self.tree.owned(|out| push_without_nul(&bytes, nul, out))
    }

    /// `bytes` with backslash escapes and character references decoded.
    fn decoded(&mut self, bytes: &[u8]) -> Str {
        let nul = self.nul;
        self.tree.owned(|out| {
            let mut decoded = Vec::new();
            unescape(bytes, &mut decoded);
            push_without_nul(&decoded, nul, out);
        })
    }

    fn title(&mut self, raw: &[u8]) -> Str {
        let nul = self.nul;
        self.tree.owned(|out| {
            let mut title = Vec::new();
            spans::push_title(raw, &mut title);
            push_without_nul(&title, nul, out);
        })
    }

    /// The `label` and `identifier` of a reference whose label spans `start` to `end`.
    fn label(&mut self, start: u32, end: u32) -> (Str, Str) {
        let mut bytes = Vec::new();
        self.push_content_between(start, end, &mut bytes);
        let normalized = normalize_identifier(&bytes);
        (
            self.decoded(&bytes),
            self.tree.owned(|out| push_lowercase(&normalized, out)),
        )
    }

    /// The value of code or math between its fences: one space is stripped from each end if both ends have one and
    /// there's something else between them.
    fn code_value(&mut self, start: u32, end: u32) -> Str {
        let end = end.max(start);
        let is_on_one_line = self.is_on_one_line(start, end);
        let mut joined = Vec::new();
        let bytes: &[u8] = match is_on_one_line {
            true => &self.text[start as usize..end as usize],
            false => {
                self.push_content_between(start, end, &mut joined);
                &joined
            }
        };
        let is_padding = |byte: u8| matches!(byte, b' ' | b'\n');
        let padding = usize::from(
            bytes.len() >= 2
                && is_padding(bytes[0])
                && is_padding(bytes[bytes.len() - 1])
                && bytes.iter().any(|&byte| !is_padding(byte)),
        );
        let code = &bytes[padding..bytes.len() - padding];
        // In a table, `\|` is a pipe.
        let is_in_cell = self
            .spans
            .iter()
            .any(|&it| self.tree.kind(it) == Some(Kind::TableCell));
        if !self.is_mdx && is_in_cell && bun_core::strings::contains(code, b"\\|") {
            return self.tree.owned(|out| {
                let mut rest = code;
                while let Some(at) = bun_core::strings::index_of(rest, b"\\|") {
                    out.extend_from_slice(&rest[..at]);
                    out.push(b'|');
                    rest = &rest[at + 2..];
                }
                out.extend_from_slice(rest);
            });
        }
        if is_on_one_line && !(self.has_nul && bun_core::strings::contains_char(code, 0)) {
            return Str::source(start + padding as u32, end - padding as u32);
        }
        let nul = self.nul;
        self.tree.owned(|out| push_without_nul(code, nul, out))
    }

    fn is_in_image(&self) -> bool {
        self.spans.last().is_some_and(|&it| {
            matches!(self.tree.kind(it), Some(Kind::Image | Kind::ImageReference))
        })
    }

    /// Turns the pending text into a node.
    fn end_text(&mut self) {
        let Some((start, end)) = self.text_range.take() else {
            return;
        };
        let value = match self.text_matches_source {
            true => Str::source(start, end),
            false => {
                let value = &self.text_value;
                self.tree.owned(|out| out.extend_from_slice(value))
            }
        };
        self.text_value.clear();
        let node = self.tree.add(Kind::Text, start, end);
        if let Some(node) = self.tree.get_mut(node) {
            node.value = value;
        }
        self.tree
            .append(self.spans.last().copied().unwrap_or(NONE), node);
    }

    /// From here on the pending text differs from the source, and `text_value` holds it.
    fn copy_text(&mut self) {
        if let Some((start, end)) = self.text_range
            && self.text_matches_source
        {
            let text = self.text;
            self.text_value
                .extend_from_slice(&text[start as usize..end as usize]);
        }
        self.text_matches_source = false;
    }

    /// `value` is the decoded form of the source text at `self.inline_range`.
    fn add_text(&mut self, value: &[u8], matches_source: bool) {
        let (start, end) = self.inline_range;
        match self.text_range {
            Some((from, to)) => {
                if !(self.text_matches_source && matches_source && to == start) {
                    self.copy_text();
                    self.text_value.extend_from_slice(value);
                }
                self.text_range = Some((from, end));
            }
            None => {
                self.text_range = Some((start, end));
                self.text_matches_source = matches_source;
                if !matches_source {
                    self.text_value.extend_from_slice(value);
                }
            }
        }
    }

    /// The line break at `self.inline_range`, if how it's printed depends on what follows it.
    fn guarded_break(&mut self, kind: LineBreak) -> Option<GuardedBreak> {
        self.two_lines?;
        let next = self
            .lines
            .partition_point(|line| line.beg <= self.inline_range.0);
        let (above, line) = (self.lines.get(next.checked_sub(1)?)?, self.lines.get(next)?);
        let line_text = self.text.get(line.beg as usize..line.end as usize)?;
        // oxfmt's `may_open_block`
        let may_start_block = matches!(
            line_text.first()?,
            b'>' | b'=' | b'-' | b'*' | b'_' | b'+' | b'0'
                ..=b'9' | b'#' | b'`' | b'~' | b'<' | b'$' | b'{' | b':' | b'[' | b'|'
        );
        if !may_start_block || (line.indent < 4 && !looks_like_delimiter_row(line_text)) {
            self.is_on_verbatim_line = is_line_shape_start(line_text);
            return None;
        }
        // Prettier escapes these or keeps them off the start of a line, and so does this printer.
        if !self.is_for_oxfmt {
            let word = &line_text[..line_text
                .iter()
                .take_while(|&&byte| !is_space(byte))
                .count()];
            let marks = line_text.trim_ascii_end();
            if super::printer::Printer::may_start_block(word)
                || marks.iter().all(|&byte| byte == b'=')
                || marks.iter().all(|&byte| byte == b'-')
            {
                return None;
            }
        }
        Some(GuardedBreak {
            break_range: self.inline_range,
            kind,
            above: (above.beg, above.end),
            line: (line.beg, line.end),
        })
    }

    /// `follower` comes next, which settles how the line break before it is printed.
    fn end_guarded_break(&mut self, follower: Follower) {
        let (Some(it), Some(two_lines)) = (self.guarded_break.take(), self.two_lines) else {
            return;
        };
        let text = self.text;
        let slice =
            |(start, end): (u32, u32)| text.get(start as usize..end as usize).unwrap_or_default();
        let line = slice(it.line);
        let printed;
        let line = match follower {
            Follower::Code => {
                let rest = text.get(it.line.0 as usize..).unwrap_or_default();
                printed = with_printed_backticks(rest, line.len());
                &printed[..]
            }
            _ => line,
        };
        let is_verbatim_line = is_line_shape_start(line)
            || (follower == Follower::Text
                && (line.starts_with(b"```")
                    || line.starts_with(b"~~~")
                    || line.starts_with(b"$$")));
        let is_hard = matches!(it.kind, LineBreak::Hard);
        // Only oxfmt prints some lines verbatim.
        let stays =
            is_hard || (self.is_for_oxfmt && (self.is_on_verbatim_line || is_verbatim_line));
        self.is_on_verbatim_line = is_verbatim_line;
        // After a line break that stays, the line above isn't considered.
        let ends_paragraph = leaves_paragraph((!stays).then(|| slice(it.above)), line, two_lines);
        if let LineBreak::Soft { matches_source } = it.kind {
            // A line that looks like a setext underline is escaped.
            let marks = line.trim_ascii_end();
            let is_underline =
                marks.iter().all(|&byte| byte == b'=') || marks.iter().all(|&byte| byte == b'-');
            let saved_range = std::mem::replace(&mut self.inline_range, it.break_range);
            match ends_paragraph && !stays && !is_underline {
                // Words are sliced from the source text, which has a line break here.
                true => self.add_verbatim_spaces(b" "),
                false => self.add_text(b"\n", matches_source),
            }
            self.inline_range = saved_range;
        }
        if ends_paragraph && stays && matches!(follower, Follower::Text | Follower::Verbatim) {
            let saved_range = self.inline_range;
            self.inline_range = (saved_range.0, saved_range.0);
            self.add_verbatim_spaces(b"    ");
            self.inline_range = saved_range;
        }
    }

    /// `spaces`, printed verbatim.
    fn add_verbatim_spaces(&mut self, spaces: &[u8]) {
        let node = self.add_span(Kind::Html);
        let value = self.tree.owned(|out| out.extend_from_slice(spaces));
        if let Some(node) = self.tree.get_mut(node) {
            node.value = value;
        }
    }

    fn add_span(&mut self, kind: Kind) -> NodeId {
        self.end_text();
        let node = self
            .tree
            .add(kind, self.inline_range.0, self.inline_range.1);
        self.tree
            .append(self.spans.last().copied().unwrap_or(NONE), node);
        node
    }

    /// A node that starts with the marker at `self.inline_range`.
    fn enter(&mut self, kind: Kind) -> NodeId {
        let node = self.add_span(kind);
        self.spans.push(node);
        self.marker_ends.push(self.inline_range.1);
        node
    }

    /// An autolink literal or an email address.
    fn literal_autolink(&mut self, prefix: &[u8], content: &[u8]) {
        if self.is_in_image() {
            return self.alt.extend_from_slice(content);
        }
        let (start, end) = self.inline_range;
        let node = self.add_span(Kind::Link);
        let text = self.tree.add(Kind::Text, start, end);
        self.tree.append(node, text);
        let value = self.raw(start, end);
        let nul = self.nul;
        let url = match prefix.is_empty() {
            true => value,
            false => self.tree.owned(|out| {
                out.extend_from_slice(prefix);
                push_without_nul(content, nul, out);
            }),
        };
        if let Some(text) = self.tree.get_mut(text) {
            text.value = value;
        }
        if let Some(node) = self.tree.get_mut(node) {
            node.value = url;
        }
    }
}

impl RendererImpl for Builder<'_> {
    fn wants_source(&self) -> bool {
        true
    }

    fn line_starts(&mut self, starts: &[OFF]) {
        let base = self.base;
        let starts = starts.iter().map(|start| start + base);
        self.tree.line_starts.extend(starts);
        // What follows the last line break is also a line, an empty one.
        if self.text.is_empty() || self.text.ends_with(b"\n") {
            self.tree.line_starts.push(self.text.len() as u32);
        }
    }

    fn container_source(&mut self, beg: OFF, end: OFF, indent: u32) {
        let beg = if beg == OFF::MAX {
            beg
        } else {
            beg + self.base
        };
        self.source = (beg, end + self.base, indent);
    }

    fn leaf_source(&mut self, block_type: BlockType, lines: &[VerbatimLine]) -> bool {
        self.lines.clear();
        let base = self.base;
        let lines = lines.iter().filter(|line| line.beg <= line.end);
        self.lines.extend(lines.map(|line| VerbatimLine {
            beg: line.beg + base,
            end: line.end + base,
            indent: line.indent,
        }));
        matches!(
            block_type,
            BlockType::Code | BlockType::Html | BlockType::Hr
        )
    }

    fn inline_source(&mut self, beg: OFF, end: OFF) {
        self.inline_range = (beg + self.base, end + self.base);
    }

    fn definition(&mut self, definition: &Definition<'_>) {
        let (start, end) = (definition.beg + self.base, definition.end + self.base);
        let node = self.tree.add(Kind::Definition, start, end);
        // Including the indentation of its continuation lines.
        let mut label_with_indentation = Vec::new();
        let mut raw_label = definition.label;
        if bun_core::strings::contains_char(raw_label, b'\n') {
            for (index, part) in bun_core::strings::split(raw_label, b"\n").enumerate() {
                if index > 0
                    && let Some(line) = definition.lines.get(index)
                {
                    let beg = line.beg + self.base;
                    let (indentation_start, _) = self.indentation_start(beg, line.indent);
                    label_with_indentation.push(b'\n');
                    label_with_indentation.extend_from_slice(
                        self.text
                            .get(indentation_start as usize..beg as usize)
                            .unwrap_or_default(),
                    );
                }
                label_with_indentation.extend_from_slice(part);
            }
            raw_label = &label_with_indentation;
        }
        let normalized = normalize_identifier(raw_label);
        let identifier = self.tree.owned(|out| push_lowercase(&normalized, out));
        let label = self.decoded(raw_label);
        let url = self.decoded(definition.dest);
        let title = match definition.title.is_empty() {
            true => Str::NO,
            false => self.title(definition.title),
        };
        if let Some(node) = self.tree.get_mut(node) {
            (node.identifier, node.third, node.value, node.second) =
                (identifier, label, url, title);
        }
        self.definitions.push((start, node));
    }

    fn enter_block(&mut self, block_type: BlockType, data: u32, flags: u32) -> JsResult<()> {
        let (marker, marker_end, indent) = self.source;
        let lines = std::mem::take(&mut self.lines);
        match block_type {
            BlockType::Doc => {}
            BlockType::Quote if flags & BLOCK_FOOTNOTE != 0 => {
                self.before_container(marker, indent, marker_end, false);
                let node = self.enter_container(Kind::FootnoteDefinition, marker, marker_end);
                let (label_start, label_end) = (marker + 2, marker_end.saturating_sub(2));
                let raw = self
                    .text
                    .get(label_start as usize..label_end as usize)
                    .unwrap_or_default();
                let identifier = normalize_identifier(raw);
                let lowercase = self.tree.owned(|out| push_lowercase(&identifier, out));
                let label = match bun_core::strings::index_of_any(raw, b"\\&") {
                    Some(_) => self.tree.owned(|out| unescape(raw, out)),
                    None => Str::source(label_start, label_end),
                };
                if let Some(node) = self.tree.get_mut(node) {
                    (node.value, node.identifier) = (label, lowercase);
                }
            }
            BlockType::Quote if flags & BLOCK_DIRECTIVE != 0 => {
                self.before_container(marker, indent, marker_end, false);
                let node = self.enter_container(Kind::Directive, marker, marker_end);
                if let Some(node) = self.tree.get_mut(node) {
                    (node.value, node.second) = (Str::source(marker, marker_end), Str::NO);
                }
            }
            BlockType::Quote => {
                self.before_container(marker, indent, marker_end, false);
                self.enter_container(Kind::Blockquote, marker, marker + 1);
            }
            BlockType::Ul | BlockType::Ol => {
                self.before_container(marker, indent, marker_end, false);
                let node = self.enter_container(Kind::List, marker, marker + 1);
                if let Some(node) = self.tree.get_mut(node) {
                    (node.ordered, node.number) = (block_type == BlockType::Ol, data);
                }
            }
            BlockType::Li => {
                let is_next_item = self
                    .tree
                    .get(self.parent())
                    .is_some_and(|list| list.first_child != NONE);
                if is_next_item {
                    self.before_container(marker, indent, marker_end, true);
                }
                self.enter_container(Kind::ListItem, marker, marker_end);
            }
            BlockType::Hr => {
                if let Some(line) = lines.first() {
                    let end = self.line_end(line.end);
                    self.add_leaf(Kind::ThematicBreak, line.beg, end);
                }
            }
            BlockType::H if flags & BLOCK_SETEXT_HEADER != 0 => self.paragraph(&lines, Some(data)),
            BlockType::H => {
                if let Some(line) = lines.first() {
                    self.atx_heading(line, data);
                }
            }
            BlockType::P => self.paragraph(&lines, None),
            BlockType::Code if flags & BLOCK_FENCED_CODE != 0 => {
                self.fenced_code(&lines, data + self.base, flags & BLOCK_CLOSED != 0);
            }
            BlockType::Code => self.indented_code(&lines),
            BlockType::Html if flags & BLOCK_EXTENSION != 0 => {
                if let Some(line) = lines.first() {
                    self.extension(line);
                }
            }
            BlockType::Html => self.html(
                &lines,
                flags & (BLOCK_HTML_UNTIL_TEXT | BLOCK_CLOSED) == BLOCK_HTML_UNTIL_TEXT,
                flags & BLOCK_HTML_UNTIL_TEXT != 0,
            ),
            BlockType::Table => self.table(&lines),
            BlockType::Thead | BlockType::Tbody => {}
            BlockType::Tr => self.table_row(),
            BlockType::Th => self.table_cell(Some(match data & 3 {
                0 => Align::None,
                1 => Align::Left,
                2 => Align::Center,
                _ => Align::Right,
            })),
            BlockType::Td => self.table_cell(None),
        }
        // A paragraph's content is sliced from them.
        self.lines = lines;
        Ok(())
    }

    fn leave_block(&mut self, block_type: BlockType, _data: u32) -> JsResult<()> {
        match block_type {
            BlockType::Quote | BlockType::Ul | BlockType::Ol | BlockType::Li => {
                self.leave_container();
            }
            BlockType::Doc => {
                self.add_definitions_before(u32::MAX);
                self.end_unended(None);
            }
            BlockType::P | BlockType::H | BlockType::Table | BlockType::Th | BlockType::Td => {
                self.end_guarded_break(Follower::Other);
                self.is_on_verbatim_line = false;
                self.end_text();
                self.can_start_with_check.set(false);
                let node = self.spans.pop();
                if std::mem::take(&mut self.starts_with_check)
                    && let Some(paragraph) = node
                {
                    self.strip_space_after_check(paragraph);
                }
            }
            BlockType::Tr => self.end_table_row(),
            _ => {}
        }
        Ok(())
    }

    fn enter_span(&mut self, span_type: SpanType, detail: SpanDetail<'_>) -> JsResult<()> {
        if self.is_in_image() {
            return Ok(());
        }
        self.end_guarded_break(match span_type {
            SpanType::Latexmath | SpanType::LatexmathDisplay => Follower::Verbatim,
            SpanType::Code => Follower::Code,
            _ => Follower::Other,
        });
        let is_image = span_type == SpanType::Img;
        let kind = match (span_type, detail.reference) {
            (SpanType::Em | SpanType::U, _) => Kind::Emphasis,
            (SpanType::Strong, _) => Kind::Strong,
            (SpanType::Del, _) => Kind::Delete,
            (SpanType::Code, _) => Kind::InlineCode,
            (SpanType::Latexmath | SpanType::LatexmathDisplay, _) => Kind::InlineMath,
            (SpanType::Wikilink, _) => Kind::WikiLink,
            (_, Reference::Footnote) => Kind::FootnoteReference,
            (_, Reference::None) if is_image => Kind::Image,
            (_, Reference::None) => Kind::Link,
            _ if is_image => Kind::ImageReference,
            _ => Kind::LinkReference,
        };
        let node = self.enter(kind);
        match kind {
            Kind::Link | Kind::Image => {
                let url = if detail.autolink_email {
                    self.tree.owned(|out| {
                        out.extend_from_slice(b"mailto:");
                        out.extend_from_slice(detail.href);
                    })
                } else if detail.autolink {
                    let nul = self.nul;
                    self.tree
                        .owned(|out| push_without_nul(detail.href, nul, out))
                } else if detail.href.is_empty() {
                    Str::EMPTY
                } else {
                    self.decoded(detail.href)
                };
                let title = match detail.title.is_empty() {
                    true => Str::NO,
                    false => self.title(detail.title),
                };
                if let Some(node) = self.tree.get_mut(node) {
                    (node.value, node.second) = (url, title);
                }
            }
            Kind::LinkReference | Kind::ImageReference => {
                if let Some(node) = self.tree.get_mut(node) {
                    node.reference_type = match detail.reference {
                        Reference::Full => ReferenceType::Full,
                        Reference::Collapsed => ReferenceType::Collapsed,
                        _ => ReferenceType::Shortcut,
                    };
                }
            }
            Kind::FootnoteReference => {
                let normalized = normalize_identifier(detail.href);
                let (label, identifier) = (
                    self.decoded(detail.href),
                    self.tree.owned(|out| push_lowercase(&normalized, out)),
                );
                if let Some(node) = self.tree.get_mut(node) {
                    (node.value, node.identifier) = (label, identifier);
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn leave_span(&mut self, span_type: SpanType) -> JsResult<()> {
        if self.is_in_image() && span_type != SpanType::Img {
            return Ok(());
        }
        self.end_guarded_break(Follower::Other);
        self.end_text();
        let (Some(node), Some(marker_end)) = (self.spans.pop(), self.marker_ends.pop()) else {
            return Ok(());
        };
        let (closing_start, end) = self.inline_range;
        self.set_end(node, end);
        let Some(&super::ast::Node {
            kind,
            reference_type,
            ..
        }) = self.tree.get(node)
        else {
            return Ok(());
        };
        if matches!(kind, Kind::Image | Kind::ImageReference) {
            let mut alt = std::mem::take(&mut self.alt);
            // remark-parse 8 uses the source text between the brackets, whatever it is. oxfmt prints that.
            if self.is_mdx || self.is_for_oxfmt {
                let mut raw_alt = Vec::new();
                self.push_content_between(marker_end, closing_start, &mut raw_alt);
                alt.clear();
                match self.is_mdx {
                    true => unescape(&raw_alt, &mut alt),
                    false => alt = raw_alt,
                }
            }
            let value = self.tree.owned(|out| out.extend_from_slice(&alt));
            self.alt = alt;
            self.alt.clear();
            if let Some(node) = self.tree.get_mut(node) {
                node.third = value;
            }
        }
        match kind {
            Kind::InlineCode => {
                let value = self.code_value(marker_end, closing_start);
                if let Some(node) = self.tree.get_mut(node) {
                    node.value = value;
                }
            }
            Kind::LinkReference | Kind::ImageReference => {
                // `][label]`, or the text is the label.
                let (label, identifier) = match reference_type {
                    ReferenceType::Full => self.label(closing_start + 2, end.saturating_sub(1)),
                    _ => self.label(marker_end, closing_start),
                };
                if let Some(node) = self.tree.get_mut(node) {
                    (node.value, node.identifier) = (label, identifier);
                }
            }
            _ => {}
        }
        Ok(())
    }

    fn text(&mut self, text_type: TextType, content: &[u8]) -> JsResult<()> {
        let is_white = |byte: &u8| is_space(*byte);
        if self.is_in_image() {
            match text_type {
                TextType::Normal | TextType::Code | TextType::Html | TextType::Latexmath => {
                    self.alt.extend_from_slice(content);
                }
                TextType::NullChar => self.alt.extend_from_slice(self.nul),
                TextType::Entity => unescape(content, &mut self.alt),
                TextType::Softbr => {
                    if self.alt_end == self.inline_range.0 {
                        let whitespace_len =
                            self.alt.iter().rev().take_while(|it| is_white(it)).count();
                        self.alt.truncate(self.alt.len() - whitespace_len);
                    }
                    self.alt.push(b'\n');
                }
                TextType::Br => {}
            }
            self.alt_end = self.inline_range.1;
            return Ok(());
        }
        self.end_guarded_break(match text_type {
            TextType::Normal | TextType::NullChar | TextType::Entity => Follower::Text,
            TextType::Html => Follower::Verbatim,
            _ => Follower::Other,
        });
        match text_type {
            // In an autolink.
            TextType::Normal if self.has_nul && bun_core::strings::contains_char(content, 0) => {
                let mut value = Vec::new();
                push_without_nul(content, self.nul, &mut value);
                self.add_text(&value, false);
            }
            TextType::Normal => {
                let matches_source = self.inline_range.1.saturating_sub(self.inline_range.0)
                    as usize
                    == content.len();
                self.add_text(content, matches_source);
            }
            // A code span's value is sliced from the text when it ends.
            TextType::Code | TextType::Latexmath => {}
            TextType::NullChar => self.add_text(self.nul, false),
            TextType::Entity => {
                self.add_text(b"", false);
                unescape(content, &mut self.text_value);
            }
            // The whitespace before it isn't part of the text.
            TextType::Softbr => {
                let so_far = match self.text_range {
                    Some((start, end)) if self.text_matches_source => {
                        &self.text[start as usize..end as usize]
                    }
                    _ => &self.text_value[..],
                };
                let whitespace_len = so_far.iter().rev().take_while(|it| is_white(it)).count();
                if whitespace_len > 0 {
                    self.copy_text();
                    self.text_value
                        .truncate(self.text_value.len() - whitespace_len);
                    if self.text_value.is_empty() {
                        self.text_range = None;
                    }
                }
                self.guarded_break = self.guarded_break(LineBreak::Soft {
                    matches_source: whitespace_len == 0,
                });
                if self.guarded_break.is_none() {
                    self.add_text(b"\n", whitespace_len == 0);
                }
            }
            TextType::Br => {
                self.add_span(Kind::Break);
                self.guarded_break = self.guarded_break(LineBreak::Hard);
            }
            TextType::Html => {
                let node = self.add_span(Kind::Html);
                let value = self.raw(self.inline_range.0, self.inline_range.1);
                if let Some(node) = self.tree.get_mut(node) {
                    node.value = value;
                }
            }
        }
        Ok(())
    }

    fn extension_span(&mut self, tag: u32, content: &[u8]) -> JsResult<()> {
        self.end_guarded_break(match tag {
            tag::LIQUID | tag::MATH => Follower::Verbatim,
            _ => Follower::Other,
        });
        let (start, end) = self.inline_range;
        let (kind, value) = match tag {
            tag::CHECK => {
                let item = self.parent();
                if let Some(item) = self.tree.get_mut(item) {
                    item.checked = if matches!(content.get(1), Some(b'x' | b'X')) {
                        2
                    } else {
                        1
                    };
                }
                self.starts_with_check = true;
                return Ok(());
            }
            tag::EMAIL => {
                self.literal_autolink(b"mailto:", content);
                return Ok(());
            }
            tag::URL => {
                self.literal_autolink(b"", content);
                return Ok(());
            }
            tag::WWW => {
                self.literal_autolink(b"http://", content);
                return Ok(());
            }
            tag::LIQUID => (Kind::LiquidNode, self.raw(start, end)),
            tag::WIKI_LINK => (Kind::WikiLink, self.raw(start + 2, end.saturating_sub(2))),
            tag::MATH => {
                let size = content.iter().take_while(|&&byte| byte == b'$').count() as u32;
                (
                    Kind::InlineMath,
                    self.code_value(start + size, end.saturating_sub(size)),
                )
            }
            _ => {
                let (from, to) = es_comment(content, 0).map_or((0, 0), |it| it.0);
                (
                    Kind::EsComment,
                    self.tree
                        .owned(|out| out.extend_from_slice(&content[from..to])),
                )
            }
        };
        if self.is_in_image() {
            if kind != Kind::EsComment {
                let value = self.tree.str(self.text, value).to_vec();
                self.alt.extend_from_slice(&value);
            }
            return Ok(());
        }
        let node = self.add_span(kind);
        if let Some(node) = self.tree.get_mut(node) {
            node.value = value;
        }
        Ok(())
    }
}

/// Fills `tree` with the syntax tree of `text`, in which every line break is `\n`, starting at `first_line`, which is
/// the start of a line. Returns the root.
pub(crate) fn parse_lines(
    text: &[u8],
    tree: &mut Tree,
    syntax: Syntax,
    first_line: usize,
) -> Option<NodeId> {
    tree.clear();
    if text.len() >= (1 << 30) {
        return None;
    }
    let root = tree.add(Kind::Root, 0, text.len() as u32);
    // The parser only reports line starts for the input it's given.
    let first_line = first_line.min(text.len());
    let mut from = 0;
    while from < first_line {
        tree.line_starts.push(from as u32);
        let len = bun_core::strings::index_of_char_usize(&text[from..first_line], b'\n');
        from = len.map_or(first_line, |len| from + len + 1);
    }
    let is_plain = syntax == Syntax::Plain;
    let is_mdx = syntax == Syntax::Mdx;
    let mut options = Options::default();
    (options.tables, options.math_blocks) = (!is_plain, !is_plain);
    (options.footnotes, options.no_single_tilde) = (true, true);
    let uses_oxfmt_syntax = matches!(syntax, Syntax::WithDirectives | Syntax::TwoLines);
    options.directives = uses_oxfmt_syntax;
    // See `tag::CHECK`.
    options.tasklists = false;
    (options.micromark, options.mdx) = (true, is_mdx);
    options.micromark_to_the_letter = !uses_oxfmt_syntax;
    if let Syntax::CommonMark { gfm, math } = syntax {
        (options.tables, options.strikethrough, options.footnotes) = (gfm, gfm, gfm);
        (options.math_blocks, options.no_single_tilde) = (math, false);
        (options.micromark, options.micromark_to_the_letter) = (false, false);
    }
    let leaf_memo = Cell::new(LeafMemo::default());
    let leaf = |start: &LeafStart<'_>| match is_mdx {
        true => es_syntax_end(start),
        false => liquid_end(start, &leaf_memo),
    };
    let memo = Cell::new(SpanMemo::default());
    let can_start_with_check = Cell::new(false);
    let span = |start: &SpanStart<'_>| span_at(start, syntax, can_start_with_check.get(), &memo);
    let extensions = Extensions {
        leaf_bytes: match syntax {
            Syntax::Plain | Syntax::CommonMark { .. } => b"",
            Syntax::Mdx => b"ie",
            Syntax::Markdown
            | Syntax::WithDirectives
            | Syntax::TwoLines
            | Syntax::MarkdownTwoLines => b"{",
        },
        leaf: &leaf,
        span_bytes: match syntax {
            Syntax::Plain => b"[",
            Syntax::CommonMark { gfm, math } => match (gfm, math) {
                (false, false) => b"",
                (false, true) => b"$",
                (true, false) => b"[@:.",
                (true, true) => b"$[@:.",
            },
            _ => SPAN_BYTES,
        },
        span: &span,
    };
    let mut builder = Builder {
        text,
        base: first_line as u32,
        is_mdx,
        is_for_oxfmt: syntax == Syntax::WithDirectives,
        has_nul: bun_core::strings::contains_char(text, 0),
        nul: match syntax {
            Syntax::WithDirectives => b"\0",
            _ => "\u{FFFD}".as_bytes(),
        },
        tree,
        open_blockquotes: 0,
        open: vec![Open {
            node: root,
            last_child_line: 0,
        }],
        source: (0, 0, 0),
        lines: Vec::new(),
        definitions: Vec::new(),
        next_definition: 0,
        are_definitions_sorted: false,
        segments: Vec::new(),
        unended: None,
        ended: Vec::new(),
        is_extended_to_the_end: false,
        spans: Vec::new(),
        inline_range: (0, 0),
        marker_ends: Vec::new(),
        text_range: None,
        text_value: Vec::new(),
        text_matches_source: false,
        alt: Vec::new(),
        alt_end: 0,
        can_start_with_check: &can_start_with_check,
        starts_with_check: false,
        two_lines: match syntax {
            Syntax::WithDirectives => Some(Syntax::TwoLines),
            Syntax::Markdown => Some(Syntax::MarkdownTwoLines),
            _ => None,
        },
        guarded_break: None,
        is_on_verbatim_line: false,
    };
    render_with_extensions(
        &text[first_line..],
        options,
        Renderer { ptr: &mut builder },
        extensions,
    )
    .ok()?;
    Some(root)
}
