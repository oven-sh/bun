//! Statements that are printed while they're read.
//!
//! Most of a style sheet is `name: words;`, `.class {`, `@include name(words);`, comments, and maps with a pair on each
//! line. What's printed for those follows from their text, the options and the number of blocks around them. So the
//! parser of `postcss.rs` first asks this module about each statement. One scan over its bytes finds where the
//! statement ends and what's printed for it, without tokens, trees or documents.
//!
//! **Whatever isn't certain is refused**, and the parser reads the statement from its start. A statement is only taken
//! if
//!
//! - the tokenizer and the parser of its syntax would split it the way it looks, and leave no state behind that matters
//!   later (see `Parser::read_known_statements`),
//! - the parsers of values and selectors would make of it what it looks like,
//! - and the printer would print it as written here, in every context that the statement can be in. What the printer
//!   asks the ancestors of a node is in `Block`.
//!
//! What becomes of a statement that's taken:
//!
//! - **A run** (`Kind::Run`): statements in a row, with the line breaks, the empty lines and the indentation between
//!   them, are one node and one text. A block whose head is known and whose statements are one run is a statement of
//!   the run around it, so a style sheet with nothing unusual in it is one node. Nothing else is known of a run. If the
//!   printer can't write it where it stands, which no style sheet is known to cause, everything starts over without
//!   this module.
//! - **A node with `Node::printed`**, if what's printed also depends on what's next to the statement: a comment after
//!   it on its line, an `@else`, a stray `;`, a `prettier-ignore` before it. And the head of a block with something in
//!   it that isn't known. Such a node has exactly the fields that the parser would give it, so the printer decides
//!   whether it uses the text (`Printer::print_known`), and can always print the node the long way.

mod layout;
mod selector;
mod value;

use self::layout::{Page, Position, Request};
use self::value::{Owner, Values};
use super::Parser as Syntax;
use super::postcss::{Kind, NodeId, Parser, Range, Token, TokenKind, extra_start};
use crate::FormatOptions;
use crate::options::{HtmlRoot, IndentStyle, QuoteStyle, TrailingCommas};
use crate::syntax_error::Rejected;
use bun_core::strings;

// ───────────────────────────── bytes ─────────────────────────────

const LOWER: u8 = 1;
const UPPER: u8 = 2;
const DIGIT: u8 = 4;
const DASH: u8 = 8;
const UNDERSCORE: u8 = 16;
/// A blank or a tab.
const INDENTATION: u8 = 32;
/// A blank, a tab or a line break.
const BLANK: u8 = INDENTATION | NEWLINE;
const NEWLINE: u8 = 64;
/// What leaves a string like a word to all that looks at it: letters, digits, a blank and `-_/:@.`.
const PLAIN: u8 = 128;

static CLASSES: [u8; 256] = {
    let mut classes = [0; 256];
    let mut byte = 0;
    while byte < 256 {
        classes[byte] = match byte as u8 {
            b'a'..=b'z' => LOWER | PLAIN,
            b'A'..=b'Z' => UPPER | PLAIN,
            b'0'..=b'9' => DIGIT | PLAIN,
            b'-' => DASH | PLAIN,
            b'_' => UNDERSCORE | PLAIN,
            b' ' => INDENTATION | PLAIN,
            b'\t' => INDENTATION,
            b'\n' => NEWLINE,
            b'/' | b':' | b'@' | b'.' => PLAIN,
            _ => 0,
        };
        byte += 1;
    }
    classes
};

#[inline]
fn class(byte: u8) -> u8 {
    CLASSES[byte as usize]
}

/// The byte at `at`, or 0 at the end of the text. Nothing takes a 0.
#[inline]
fn byte(css: &[u8], at: usize) -> u8 {
    css.get(at).copied().unwrap_or(0)
}

/// Returns the offset of the first byte from `at` on that's in none of `classes`.
#[inline]
fn skip(css: &[u8], at: usize, classes: u8) -> usize {
    let rest = css.get(at..).unwrap_or_default();
    at + rest
        .iter()
        .take_while(|it| class(**it) & classes != 0)
        .count()
}

/// `skip` for what's a name or longer, most of the time. It looks at eight bytes at once, so that there's no branch for
/// the processor to guess wrong at the end of each name.
#[inline]
fn skip_long(css: &[u8], mut at: usize, classes: u8) -> usize {
    while let Some(bytes) = css.get(at..at + 8).and_then(|it| it.first_chunk::<8>()) {
        let others = in_classes(u64::from_le_bytes(*bytes), classes) ^ HIGHEST_BITS;
        if others != 0 {
            return at + (others.trailing_zeros() / 8) as usize;
        }
        at += 8;
    }
    skip(css, at, classes)
}

const ONES: u64 = 0x0101_0101_0101_0101;
const HIGHEST_BITS: u64 = 0x80 * ONES;

/// Eight bytes at once: the highest bit of each byte of the result is set if the byte of `bytes` is in one of `classes`.
#[inline]
const fn in_classes(bytes: u64, classes: u8) -> u64 {
    // The same for the bytes from `first` to `last`, of eight bytes below 0x80. The other bits are anything.
    const fn in_range(bytes: u64, first: u8, last: u8) -> u64 {
        (bytes + (0x80 - first as u64) * ONES) & !(bytes + (0x7F - last as u64) * ONES)
    }
    let ascii = bytes & !HIGHEST_BITS;
    let mut found = 0;
    if classes & (LOWER | PLAIN) != 0 {
        found |= in_range(ascii, b'a', b'z');
    }
    if classes & UPPER != 0 {
        found |= in_range(ascii, b'A', b'Z');
    }
    if classes & DIGIT != 0 {
        found |= in_range(ascii, b'0', b'9');
    }
    if classes & DASH != 0 {
        found |= in_range(ascii, b'-', b'-');
    }
    if classes & (UNDERSCORE | PLAIN) != 0 {
        found |= in_range(ascii, b'_', b'_');
    }
    if classes & (INDENTATION | PLAIN) != 0 {
        found |= in_range(ascii, b' ', b' ');
    }
    if classes & INDENTATION != 0 {
        found |= in_range(ascii, b'\t', b'\t');
    }
    if classes & NEWLINE != 0 {
        found |= in_range(ascii, b'\n', b'\n');
    }
    if classes & PLAIN != 0 {
        // `-./`, the digits and `:`. `@` and the capitals.
        found |= in_range(ascii, b'-', b':') | in_range(ascii, b'@', b'Z');
    }
    found & !bytes & HIGHEST_BITS
}

// `in_classes` says what `CLASSES` says.
const _: () = {
    let mut classes = 0;
    while classes < 256 {
        let mut byte = 0;
        while byte < 256 {
            let expected = if CLASSES[byte] & classes as u8 != 0 {
                HIGHEST_BITS
            } else {
                0
            };
            assert!(in_classes(byte as u64 * ONES, classes as u8) == expected);
            byte += 1;
        }
        classes += 1;
    }
};

// ───────────────────────────── what the parser leaves for the printer ─────────────────────────────

#[derive(Debug, Copy, Clone, Default, PartialEq, Eq)]
pub(crate) enum Shape {
    /// The parser doesn't know what's printed.
    #[default]
    Unknown,
    /// One line, in which no line can break.
    Word,
    /// This is what's printed if the whole line fits.
    Line,
    /// What's printed for something that's alone on its lines in `Printed::depth` blocks.
    Lines,
}

/// What's printed for a node: a run, all of a statement, or the head of a block through its `{`.
#[derive(Debug, Copy, Clone, Default)]
pub(crate) struct Printed {
    pub(crate) shape: Shape,
    /// See `text_of_range`. Line breaks are `\n`, with the indentation after them.
    pub(crate) text: Range,
    pub(crate) depth: u32,
}

/// The nearest at-rule around a statement, as far as printing depends on it.
#[derive(Debug, Copy, Clone, PartialEq, Eq)]
enum Around {
    None,
    /// `@if`, `@else`, `@for`, `@each`, `@while` of SCSS.
    ControlDirective,
    /// One in which values and selectors are printed as they are outside of at-rules, except for capitals in selectors.
    Plain,
    /// Any other. Nothing in it is taken but comments.
    Other,
}

/// The head of a block, if the block can become part of a run.
#[derive(Debug, Copy, Clone)]
struct Head {
    slot: Slot,
    /// The length of `Tree::extra` after the head.
    end: usize,
    /// The sibling before the node of the block.
    previous: NodeId,
}

/// An open block.
#[derive(Debug, Copy, Clone)]
pub(crate) struct Block {
    // What the printer asks the ancestors of a statement.
    around: Around,
    /// One of the blocks around is that of a declaration: `font: { .. }`.
    is_in_declaration: bool,
    head: Option<Head>,
}

impl Block {
    /// `outer` is the block around the node that this is the block of. `name` is the name of an at-rule.
    pub(crate) fn new(outer: Option<&Block>, kind: Kind, name: &[u8], syntax: Syntax) -> Block {
        let around = match kind {
            Kind::AtRule => match name {
                b"if" | b"else" | b"for" | b"each" | b"while" if syntax == Syntax::Scss => {
                    Around::ControlDirective
                }
                _ if is_asked_for_by_name(name) => Around::Other,
                // `@name: {` of Less is a variable.
                _ if skip(name, 0, LOWER | DIGIT | DASH) < name.len() => Around::Other,
                _ => Around::Plain,
            },
            _ => outer.map_or(Around::None, |it| it.around),
        };
        Block {
            around,
            is_in_declaration: kind == Kind::Decl || outer.is_some_and(|it| it.is_in_declaration),
            head: None,
        }
    }
}

/// The head of a block that `Parser::read_standing_lines` has read and whose `}` it hasn't.
#[derive(Debug, Copy, Clone)]
struct StandingHead {
    start: usize,
    /// ` {` follows.
    end: usize,
    shape: Shape,
    /// Of an at-rule: where its name ends, and its params.
    at_rule: Option<(usize, (usize, usize))>,
    /// Where the statements start and end that it has read before this one, in the same block.
    before: Option<(usize, usize)>,
}

/// Where `read_stretch` starts, as far as it matters to what's printed for the lines from there on.
#[derive(Copy, Clone)]
struct Surroundings<'a> {
    /// Comments are printed from this. It's the text that's read, but for some comments: see `Parser::original`.
    original: &'a [u8],
    syntax: Syntax,
    page: Page,
    quote: u8,
    /// The number of blocks around.
    level: usize,
    is_in_declaration: bool,
    is_in_at_rule: bool,
    takes_long_comments: bool,
    lays_out_values: bool,
    /// A comment on the line of the statement before it is printed there.
    is_on_its_line: bool,
}

/// What `read_stretch` has read, apart from the heads of the blocks that are still open.
#[derive(Debug, Copy, Clone, Default)]
pub(crate) struct Stretch {
    /// The statements that were taken of the innermost block.
    segment: Option<(usize, usize)>,
    /// Whether the last of them has a `;`, if that's not as it was before them.
    semicolon: Option<bool>,
    /// Where the line starts that ended the stretch because it isn't taken wherever it stands.
    refused: Option<usize>,
}

/// True for the at-rules that the printer asks for by name, in any case, when it prints their params or what's in them,
/// except where that's about something that's never taken. A variable of Less is an at-rule to it, and so is the call of
/// a mixin: `@import: a;`, `.else();`.
fn is_asked_for_by_name(name: &[u8]) -> bool {
    const NAMES: [&[u8]; 8] = [
        b"else",
        b"custom-selector",
        b"extend",
        b"nest",
        b"utility",
        b"forward",
        b"namespace",
        b"import",
    ];
    NAMES.iter().any(|it| name.eq_ignore_ascii_case(it))
}

/// White space between two statements.
#[derive(Debug, Copy, Clone, Default)]
struct Gap {
    start: usize,
    end: usize,
    /// The number of `\n` in it.
    lines: u32,
    /// There's nothing in it but blanks, tabs and `\n`.
    is_plain: bool,
}

impl Gap {
    /// The white space from `start` on.
    #[inline]
    fn new(css: &[u8], start: usize) -> Gap {
        // Most of the time: one or two line breaks, and less than eight blanks.
        if byte(css, start) == b'\n' {
            let lines = 1 + u32::from(byte(css, start + 1) == b'\n');
            let from = start + lines as usize;
            if let Some(bytes) = css.get(from..from + 8).and_then(|it| it.first_chunk::<8>()) {
                let others = u64::from_le_bytes(*bytes) ^ (b' ' as u64 * ONES);
                let blanks = (others.trailing_zeros() / 8) as usize;
                if let Some(next) = bytes.get(blanks)
                    && !matches!(next, b'\t' | b'\n' | b'\r' | 0x0C)
                {
                    return Gap {
                        start,
                        end: from + blanks,
                        lines,
                        is_plain: true,
                    };
                }
            }
        }
        Gap::of_any_kind(css, start)
    }

    #[inline(never)]
    fn of_any_kind(css: &[u8], start: usize) -> Gap {
        // One or two line breaks, and the indentation.
        if byte(css, start) == b'\n' {
            let lines = 1 + u32::from(byte(css, start + 1) == b'\n');
            let end = skip_long(css, start + lines as usize, INDENTATION);
            if !matches!(byte(css, end), b'\n' | b'\r' | 0x0C) {
                return Gap {
                    start,
                    end,
                    lines,
                    is_plain: true,
                };
            }
        }
        let (mut lines, mut is_plain) = (0, true);
        let mut end = start;
        loop {
            match byte(css, end) {
                b' ' | b'\t' => {}
                b'\n' => lines += 1,
                b'\r' | 0x0C => is_plain = false,
                _ => break,
            }
            end += 1;
        }
        Gap {
            start,
            end,
            lines,
            is_plain,
        }
    }
}

/// Where the text of the statement that's being read goes in `Tree::extra`.
#[derive(Debug, Copy, Clone)]
struct Slot {
    /// The length of `extra` before anything was written for the statement.
    mark: usize,
    /// Where the text of the statement starts: after the line break and the indentation that come before it in a run.
    start: usize,
    /// If those are in the source as they're printed, they aren't written yet. This is where they start, and they end
    /// where the statement starts. So they can be copied together with a statement that's printed as it's written.
    copy_from: Option<usize>,
    /// The sibling before the statement is a run that ends at `mark`.
    joins: bool,
    /// The statement can be part of a run.
    can_run: bool,
}

/// The options, and buffers that are reused from one style sheet to the next.
#[derive(Default)]
pub(crate) struct Quick {
    page: Page,
    /// The quote that strings are printed with.
    quote: u8,
    /// False in HTML, where `cleanDoc` changes the documents that `layout.rs` is the closed form of.
    lays_out_values: bool,
    /// False where a line break in a text isn't printed like one between two statements.
    takes_long_comments: bool,
    /// The open blocks.
    pub(crate) blocks: Vec<Block>,
    /// The white space before the statement that's being read.
    gap: Gap,
    /// The white space after the statement that was read last, if it has been looked at.
    next_gap: Option<Gap>,
    /// Where the tokenizer was after the last statement that became part of a run, and after the last head of a block
    /// that can become part of one. As long as it's still there, nothing else has happened.
    after_run: usize,
    after_head: usize,
    /// See `Parser::read_standing_lines`.
    standing_heads: Vec<StandingHead>,
    /// What `read_first_lines` has read, and where it starts, until the parser gets there. Its heads are in
    /// `standing_heads`.
    first_stretch: Option<(usize, Stretch)>,
    /// Where a line starts that `read_stretch` doesn't take.
    refused_line: Option<usize>,
    values: Values,
    up: Vec<(Option<u32>, Position)>,
    /// The printer couldn't write a run.
    pub(crate) is_refused: bool,
}

impl Quick {
    /// Before each style sheet.
    pub(crate) fn start(&mut self, options: &FormatOptions) {
        self.page = Page {
            width: options.line_width.value() as usize,
            tab_width: options.indent_width.value() as usize,
            use_tabs: matches!(options.indent_style, IndentStyle::Tab),
            trailing_comma: !matches!(options.trailing_commas, TrailingCommas::None),
        };
        self.quote = match options.quote_style {
            QuoteStyle::Single => b'\'',
            QuoteStyle::Double => b'"',
        };
        self.lays_out_values = options.in_html.root == HtmlRoot::None;
        self.takes_long_comments = !options.is_in_markdown;
        self.blocks.clear();
        self.next_gap = None;
        (self.first_stretch, self.refused_line) = (None, None);
        (self.after_run, self.after_head) = (usize::MAX, usize::MAX);
        self.is_refused = false;
    }

    fn around(&self) -> Around {
        self.blocks.last().map_or(Around::None, |it| it.around)
    }

    /// After `start`, for a style sheet that's parsed as it is: reads the lines that stand, from its start on. If that's
    /// all of it, returns where they start and end: they're what's printed, with a line break after them. If not, the
    /// parser goes on from what was read.
    pub(crate) fn read_first_lines(
        &mut self,
        css: &[u8],
        syntax: Syntax,
    ) -> Option<(usize, usize)> {
        let start = Gap::new(css, 0).end;
        let surroundings = Surroundings {
            original: css,
            syntax,
            page: self.page,
            quote: self.quote,
            level: 0,
            is_in_declaration: false,
            is_in_at_rule: false,
            takes_long_comments: self.takes_long_comments,
            lays_out_values: self.lays_out_values,
            is_on_its_line: true,
        };
        self.standing_heads.clear();
        let stretch = read_stretch(css, start, surroundings, &mut self.standing_heads);
        if let (Some(segment), true) = (stretch.segment, self.standing_heads.is_empty())
            && Gap::new(css, segment.1).end == css.len()
        {
            return Some(segment);
        }
        self.first_stretch = Some((start, stretch));
        None
    }
}

/// The params of `@media` from `p` on, if they're written as they're printed: words and `(feature: value)`. Returns
/// where they end.
fn end_of_media_queries(css: &[u8], mut p: usize, syntax: Syntax) -> Option<usize> {
    const WORD: u8 = LOWER | DIGIT | DASH;
    let word = |p: usize| {
        let is_word = class(byte(css, p)) & LOWER != 0 && !value::starts_with_url(css, p);
        is_word.then(|| skip(css, p, WORD))
    };
    loop {
        if byte(css, p) == b'(' {
            p = word(p + 1 + usize::from(byte(css, p + 1) == b'-'))?;
            if byte(css, p) == b':' {
                if byte(css, p + 1) != b' ' {
                    return None;
                }
                p += 2;
                p = match byte(css, p) {
                    b'0'..=b'9' => value::number(css, p).filter(|end| css[end - 1] != b'%')?,
                    b'$' if syntax == Syntax::Scss => word(p + 1)?,
                    b'@' if syntax == Syntax::Less => word(p + 1)?,
                    _ => word(p)?,
                };
            }
            if byte(css, p) != b')' {
                return None;
            }
            p += 1;
        } else {
            p = word(p)?;
        }
        match (byte(css, p), byte(css, p + 1)) {
            (b' ', b'{') => return Some(p),
            (b' ', _) => p += 1,
            (b',', b' ') => p += 2,
            _ => return None,
        }
    }
}

/// For an at-rule whose params no parser looks at, so that they're printed as they're written: whether it's taken with
/// a block, and without one.
fn forms_of_plain_at_rule(name: &[u8], syntax: Syntax) -> Option<(bool, bool)> {
    match name {
        _ if syntax == Syntax::Less => None,
        b"layer" => Some((true, true)),
        b"theme" => Some((true, false)),
        b"apply" | b"tailwind" => Some((false, true)),
        _ => None,
    }
}

/// The params of such an at-rule from `p` on: names with a blank, or a comma and a blank, between them. `is_apply`: the
/// names are those of classes, as in `hover:a-b/50`. Returns where they end: at a `;`, or at the blank before a `{`.
fn end_of_plain_params(css: &[u8], mut p: usize, is_apply: bool) -> Option<usize> {
    const NAME: u8 = LOWER | DIGIT | DASH;
    loop {
        if class(byte(css, p)) & LOWER == 0 || value::starts_with_url(css, p) {
            return None;
        }
        p = skip_long(css, p, NAME);
        while is_apply && matches!(byte(css, p), b':' | b'/' | b'.') {
            if class(byte(css, p + 1)) & (LOWER | DIGIT) == 0 || value::starts_with_url(css, p + 1)
            {
                return None;
            }
            p = skip_long(css, p + 1, NAME);
        }
        match (byte(css, p), byte(css, p + 1)) {
            (b';', _) | (b' ', b'{') => return Some(p),
            (b' ', _) => p += 1,
            (b',', b' ') if !is_apply => p += 2,
            _ => return None,
        }
    }
}

/// What follows the value of a statement.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Tail {
    Semicolon,
    /// Nothing in the source, where a `}` follows. A `;` is printed.
    NoSemicolon,
    Important,
    Default,
    Global,
    Block,
}

impl Tail {
    fn text(self) -> &'static [u8] {
        match self {
            Tail::Semicolon | Tail::NoSemicolon => b";",
            Tail::Important => b" !important;",
            Tail::Default => b" !default;",
            Tail::Global => b" !global;",
            Tail::Block => b" {",
        }
    }
}

/// A statement with a value: `prop: value;`, `@name value;`, `@name value {`.
struct Statement {
    start: usize,
    /// Where the property ends, or the name of the at-rule.
    head_end: usize,
    value_start: usize,
    owner: Owner,
    /// It's `@name: value;` of Less.
    is_less_variable: bool,
}

/// What `Parser::read_value` has found.
struct Read {
    value_end: usize,
    tail: Tail,
    /// Where the statement ends: after the `;`, or the `{`.
    end: usize,
    shape: Shape,
    /// `layout.rs` has broken the value, or left it on a line that's too long.
    is_laid_out: bool,
}

/// An at-rule as `postcss` sees it.
struct AtRule {
    start: usize,
    name_end: usize,
    /// Empty if there are none.
    params: (usize, usize),
    /// After the `;` or the `{`.
    end: usize,
    has_block: bool,
}

impl<'a> Parser<'a> {
    /// Reads statements as long as it's known what's printed for them. Stops before the first one that isn't taken, or
    /// before the white space in front of it.
    ///
    /// The tokenizer has state that outlives a statement. None of it may matter here, and none of it may be missing
    /// afterwards:
    ///
    /// - `returned`: has to be empty.
    /// - `shift`: 0, or all offsets are off.
    /// - `buffer`: all that counts is whether the word that a `(` takes from it is `url`. So there must be no `url` in
    ///   it, and no statement is taken that would leave one there.
    /// - `last_bad_paren`: has to be before the statement. What's taken has balanced parentheses, so the one it would
    ///   leave is before the next statement.
    pub(super) fn read_known_statements(&mut self) -> Result<(), Rejected> {
        let css = self.css;
        if !self.tokenizer.returned.is_empty()
            || self.tokenizer.shift != 0
            || self.tokenizer.urls_in_buffer != 0
        {
            return Ok(());
        }
        loop {
            let start = self.tokenizer.pos;
            // The indentation of blocks in blocks grows with the square of their number. A style sheet that's rejected in
            // the end, for a `}` that's missing, has to be rejected in linear time, so no more is written here than a
            // few times the length of the source.
            if self.tokenizer.last_bad_paren.is_some_and(|it| it >= start)
                || crate::is_too_long(self.texts.extra.len())
                || self.texts.extra.len() / 8 > css.len() + 512
            {
                return Ok(());
            }
            let quick = &mut *self.quick;
            let gap = match quick.next_gap.take() {
                Some(gap) if gap.start == start => gap,
                _ => Gap::new(css, start),
            };
            quick.gap = gap;
            let at = gap.end;
            if at > start {
                let spaces = Range::new(start as u32, at as u32);
                self.spaces = self.texts.join(self.spaces, spaces);
                self.tokenizer.pos = at;
            }
            let is_taken = match (byte(css, at), byte(css, at + 1)) {
                (b'}', _) if self.current != 0 => {
                    self.close_block(at)?;
                    true
                }
                (b'/', b'*') => self.read_standing_lines(at) || self.read_comment()?,
                (b'/', b'/') => match self.syntax {
                    Syntax::Css => false,
                    Syntax::Scss => self.read_standing_lines(at) || self.read_comment()?,
                    Syntax::Less => self.read_standing_lines(at) || self.read_less_line_comment(at),
                },
                _ if quick.around() == Around::Other => false,
                (b'@', _) => self.read_standing_lines(at) || self.read_at_rule(at),
                (b'a'..=b'z' | b'-' | b'$', _) => {
                    self.read_standing_lines(at) || self.read_declaration(at) || self.read_rule(at)
                }
                (b'.', _) if self.syntax == Syntax::Less => {
                    self.read_standing_lines(at)
                        || self.read_rule(at)
                        || self.read_less_mixin_call(at)
                }
                (b'.' | b'#' | b'&' | b':' | b'*' | b'[', _)
                | (b'A'..=b'Z' | b'_' | b'0'..=b'9' | b'%', _) => {
                    self.read_standing_lines(at) || self.read_rule(at)
                }
                (b'>' | b'+' | b'~', _) => self.read_rule(at),
                _ => false,
            };
            if !is_taken {
                return Ok(());
            }
        }
    }

    // ───────────────────────────── runs ─────────────────────────────

    fn depth(&self) -> usize {
        self.quick.blocks.len()
    }

    /// The range of `Tree::extra` from `start` to its end.
    fn text_from(&self, start: usize) -> Range {
        let offset = extra_start(self.css);
        Range::new(
            (offset + start) as u32,
            (offset + self.texts.extra.len()) as u32,
        )
    }

    /// Before the text of a statement is written: if the statement may go on a run, or be the first one after the head
    /// of a block that may become part of one, writes what's between the two.
    fn slot(&mut self) -> Slot {
        let css = self.css;
        let mark = self.texts.extra.len();
        let mut slot = Slot {
            mark,
            start: mark,
            copy_from: None,
            joins: false,
            can_run: true,
        };
        let quick = &*self.quick;
        let (gap, level) = (quick.gap, quick.blocks.len());
        let mut has_empty_line = false;
        if gap.start == quick.after_run && gap.is_plain {
            slot.joins = true;
            has_empty_line = gap.lines > 1;
        } else if gap.start != quick.after_head {
            let previous = &self.nodes[self.nodes[self.current as usize].last_child as usize];
            slot.can_run =
                !(previous.kind == Kind::Comment && is_ignore_comment(previous.text.of(css)));
            return slot;
        }
        let line_break = gap.start + usize::from(has_empty_line);
        if (!has_empty_line || css[gap.start] == b'\n')
            && quick.page.is_line_break(&css[line_break..gap.end], level)
        {
            slot.copy_from = Some(gap.start);
            slot.start = mark + (gap.end - gap.start);
            return slot;
        }
        let extra = &mut self.texts.extra;
        if has_empty_line {
            extra.push(b'\n');
        }
        quick.page.break_line(extra, level);
        slot.start = extra.len();
        slot
    }

    /// Before anything but the source is written for the statement that starts at `start`.
    fn start_text(&mut self, slot: &mut Slot, start: usize) {
        if let Some(from) = slot.copy_from.take() {
            self.texts.extra.extend_from_slice(&self.css[from..start]);
        }
    }

    /// Writes the text of a statement that's printed as it's written: `css[start..end]`.
    fn copy_text(&mut self, slot: &mut Slot, start: usize, end: usize) {
        let from = slot.copy_from.take().unwrap_or(start);
        self.texts.extra.extend_from_slice(&self.css[from..end]);
    }

    /// Takes back what was written for a statement that isn't taken.
    fn refuse(&mut self, slot: Slot) -> bool {
        self.texts.extra.truncate(slot.mark);
        false
    }

    /// True if nothing that follows a statement that ends at `end` has a say in how the statement is printed: no
    /// comment on its line, no `@else`, which goes on its line too, no stray `;`.
    fn is_alone(&mut self, end: usize) -> bool {
        let gap = Gap::new(self.css, end);
        self.quick.next_gap = Some(gap);
        is_alone(self.css, gap)
    }

    /// The text from `slot.start` on is what's printed for `css[start..end]`, whatever is next to it. Makes it a run,
    /// or part of the one before it.
    fn add_to_run(&mut self, slot: Slot, start: usize, end: usize) {
        let text = self.text_from(slot.start);
        let depth = self.depth() as u32;
        if slot.joins {
            let previous = self.nodes[self.current as usize].last_child;
            let run = self.node(previous);
            run.end = Some(end as u32);
            run.printed.text.end = text.end;
            self.spaces = Range::default();
        } else {
            let id = self.new_node(Kind::Run, start as u32);
            let run = self.node(id);
            run.end = Some(end as u32);
            run.printed = Printed {
                shape: Shape::Lines,
                text,
                depth,
            };
        }
        self.quick.after_run = self.tokenizer.pos;
    }

    /// The `}` at `at`.
    fn close_block(&mut self, at: usize) -> Result<(), Rejected> {
        let id = self.current;
        let head = self.quick.blocks.last().and_then(|it| it.head);
        self.tokenizer.pos = at + 1;
        self.end(Token {
            kind: TokenKind::Control(b'}'),
            range: Range::new(at as u32, at as u32 + 1),
            start: at as u32,
            last: None,
            inline: false,
        })?;
        let Some(head) = head else {
            return Ok(());
        };
        let quick = &*self.quick;
        // Is all that's in it one run, right after the head?
        let (level, page, gap) = (quick.blocks.len(), quick.page, quick.gap);
        let node = &self.nodes[id as usize];
        let start = node.start as usize;
        let child = node.first_child;
        let text_end = extra_start(self.css) + self.texts.extra.len();
        let is_one_text = match child {
            0 => head.end == self.texts.extra.len(),
            _ => {
                let run = &self.nodes[child as usize];
                let start = head.end + 1 + page.indentation_len(level + 1);
                run.kind == Kind::Run
                    && child == node.last_child
                    && run.printed.text.end as usize == text_end
                    && run.printed.text.start as usize == extra_start(self.css) + start
            }
        };
        let last = if child == 0 { id } else { child };
        if !is_one_text || last as usize + 1 != self.nodes.len() || !self.is_alone(at + 1) {
            return Ok(());
        }
        match page.is_line_break(&self.css[gap.start..gap.end], level) {
            true => (self.texts.extra).extend_from_slice(&self.css[gap.start..at + 1]),
            false => {
                page.break_line(&mut self.texts.extra, level);
                self.texts.extra.push(b'}');
            }
        }
        // The block is a statement of the run around it.
        self.nodes.truncate(id as usize);
        let current = self.current;
        self.node(current).last_child = head.previous;
        match head.previous {
            0 => self.node(current).first_child = 0,
            previous => self.node(previous).next_sibling = 0,
        }
        self.add_to_run(head.slot, start, at + 1);
        self.semicolon = false;
        Ok(())
    }

    /// After `Parser::open` for a node whose head is the text from `slot.start` on. `is_exact`: that's what's printed
    /// for it, whatever is next to it.
    fn note_head(&mut self, slot: Slot, previous: NodeId, is_exact: bool) {
        let end = self.texts.extra.len();
        let quick = &mut *self.quick;
        if let Some(block) = quick.blocks.last_mut()
            && is_exact
            && slot.can_run
        {
            block.head = Some(Head {
                slot,
                end,
                previous,
            });
            quick.after_head = self.tokenizer.pos;
        }
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// Makes the comment `original[start..end]` part of a run, if it's printed on lines of its own. `is_inline`: it's
    /// a `//` comment.
    fn add_comment_to_run(&mut self, start: usize, end: usize, is_inline: bool) -> bool {
        let quick = &*self.quick;
        let text = self.original.get(start..end).unwrap_or_default();
        let text = match is_inline {
            true => strings::trim_js_whitespace_end(text),
            false => text,
        };
        let content = match is_inline {
            true => text.get(2..),
            false => text.get(2..text.len().saturating_sub(2)),
        };
        let has_previous = self.nodes[self.current as usize].last_child != 0;
        if (has_previous && !(quick.gap.is_plain && quick.gap.lines > 0))
            || is_ignore_comment(content.unwrap_or_default())
            // The printer sees the text that was parsed.
            || (is_inline && is_ignore_comment(self.css.get(start + 2..end).unwrap_or_default()))
            || (!quick.takes_long_comments && text.contains(&b'\n'))
            || !self.is_alone(end)
        {
            return false;
        }
        let mut slot = self.slot();
        if !slot.can_run {
            return self.refuse(slot);
        }
        self.start_text(&mut slot, start);
        self.texts.extra.extend_from_slice(text);
        // A comment says nothing about the `;` of the statement before it.
        let semicolon = self.semicolon;
        self.add_to_run(slot, start, end);
        self.semicolon = semicolon;
        true
    }

    /// A comment that's one token.
    fn read_comment(&mut self) -> Result<bool, Rejected> {
        if let Some(token) = self.tokenizer.next_token(false)? {
            let (start, end) = (token.range.start as usize, token.range.end as usize);
            if !self.add_comment_to_run(start, end, token.inline) {
                self.comment(token);
            }
        }
        Ok(true)
    }

    /// `postcss-less` makes a `//` comment from the tokens up to the end of the line. None of them may be more than it
    /// seems.
    fn read_less_line_comment(&mut self, start: usize) -> bool {
        let css = self.css;
        let Some(p) = end_of_less_line_comment(css, start) else {
            return false;
        };
        let end = start + css[start..p].trim_ascii_end().len();
        self.tokenizer.pos = end;
        if self.add_comment_to_run(start, p, true) {
            return true;
        }
        let id = self.new_node(Kind::Comment, start as u32);
        let text = self.trimmed(Range::new(start as u32 + 2, end as u32));
        let node = self.node(id);
        node.inline = true;
        node.text = text;
        true
    }

    // ───────────────────────────── statements with a value ─────────────────────────────

    /// Reads the value of `statement` and what follows it, and appends what's printed for the statement to
    /// `Tree::extra`. With `None`, anything can have been appended.
    fn read_value(&mut self, statement: &Statement, slot: &mut Slot) -> Option<Read> {
        let css = self.css;
        let syntax = self.syntax;
        let &Statement {
            start,
            head_end,
            value_start,
            owner,
            is_less_variable,
        } = statement;
        let quick = &mut *self.quick;
        let is_at_rule = owner == Owner::AtRule;
        let head = css.get(start..head_end)?;
        let (around, is_in_declaration) = match quick.blocks.last() {
            Some(block) => (block.around, block.is_in_declaration),
            None => (Around::None, false),
        };
        // The printer asks for the property of the nearest declaration around a value.
        if is_at_rule && is_in_declaration {
            return None;
        }
        if !quick
            .values
            .read(css, value_start, syntax, owner, quick.quote)
        {
            return None;
        }
        let values = &quick.values;
        let value_end = values.end;
        let rest = css.get(value_end..)?;
        let is_variable = head.first() == Some(&b'$');
        let (tail, end) = if rest.starts_with(b";") {
            (Tail::Semicolon, value_end + 1)
        } else if is_at_rule {
            match rest.starts_with(b" {") && !is_less_variable {
                true => (Tail::Block, value_end + 2),
                false => return None,
            }
        } else if rest.starts_with(b" !important;") {
            (Tail::Important, value_end + 12)
        } else if rest.starts_with(b" !default;") && is_variable && syntax == Syntax::Scss {
            (Tail::Default, value_end + 10)
        } else if rest.starts_with(b" !global;") && is_variable && syntax == Syntax::Scss {
            (Tail::Global, value_end + 9)
        } else if rest.trim_ascii_start().starts_with(b"}") {
            (Tail::NoSemicolon, value_end)
        } else {
            return None;
        };
        if values.has_tight_slash && (values.top_commas > 0 || values.has_complex) {
            return None;
        }
        // `postcss` looks for a `!` before it, however far away.
        if !is_at_rule
            && value_end - value_start >= 9
            && css[value_end - 9..value_end].eq_ignore_ascii_case(b"important")
        {
            return None;
        }
        let is_custom = owner == Owner::CustomProperty;
        if is_custom && (!values.is_as_written || values.has_complex || values.has_line_breaks) {
            return None;
        }

        let level = quick.blocks.len();
        let colon: &[u8] = if is_at_rule && !is_less_variable {
            b""
        } else {
            b":"
        };
        let head_width = head.len() + colon.len() + 1;
        let flat_len = values.flat(css).len();
        let is_word = values.records.is_empty() && !values.has_blanks && !is_at_rule;
        let fits = level * quick.page.tab_width + head_width + flat_len + tail.text().len()
            <= quick.page.width;
        // A list with an item of several nodes has one item on each line.
        let breaks_list = owner == Owner::Declaration || is_less_variable;
        let is_flat =
            is_word || (fits && !values.has_complex && (values.top_commas == 0 || !breaks_list));
        // In `grid` and `grid-template-*`, the line breaks of the source are kept, and there are no others.
        if !is_at_rule
            && head.first() == Some(&b'g')
            && head.starts_with(b"grid")
            && (values.has_line_breaks || !is_flat)
        {
            return None;
        }
        let extra = &mut self.texts.extra;
        let shape;
        if is_flat {
            shape = if is_word { Shape::Word } else { Shape::Line };
            if values.is_as_written
                && value_start == head_end + colon.len() + 1
                && css[value_start - 1] == b' '
                && tail != Tail::NoSemicolon
            {
                // It's in the source as it's printed.
                extra.extend_from_slice(&css[slot.copy_from.take().unwrap_or(start)..end]);
                return Some(Read {
                    value_end,
                    tail,
                    end,
                    shape,
                    is_laid_out: false,
                });
            }
            extra.extend_from_slice(&css[slot.copy_from.take().unwrap_or(start)..head_end]);
            extra.extend_from_slice(colon);
            extra.push(b' ');
            extra.extend_from_slice(values.flat(css));
        } else {
            if is_custom || !quick.lays_out_values {
                return None;
            }
            extra.extend_from_slice(&css[slot.copy_from.take().unwrap_or(start)..head_end]);
            extra.extend_from_slice(colon);
            let request = Request {
                level,
                head_width,
                tail_width: tail.text().len(),
                is_variable,
                is_declaration: !is_at_rule,
                breaks_list,
                is_in_control_directive: around == Around::ControlDirective && !is_at_rule,
            };
            let Quick {
                values, up, page, ..
            } = quick;
            let is_scss = syntax == Syntax::Scss;
            shape = match layout::write_value(values, up, css, is_scss, *page, request, extra)? {
                true => Shape::Lines,
                false => Shape::Line,
            };
        }
        extra.extend_from_slice(tail.text());
        Some(Read {
            value_end,
            tail,
            end,
            shape,
            is_laid_out: !is_flat && !(fits && shape == Shape::Line),
        })
    }

    /// `raw` in `postcss`: the value that was read last, up to `end`, without its comments, all of which have a space
    /// next to them. `None` if it has no comments.
    fn clean_value(&self, end: usize) -> Option<Box<[u8]>> {
        let values = &self.quick.values;
        if !values.has_comments {
            return None;
        }
        let css = self.css;
        let mut clean = Vec::with_capacity(end - values.start);
        let mut from = values.start;
        for record in &values.records {
            if record.kind == value::Kind::Comment {
                clean.extend_from_slice(&css[from..record.at as usize]);
                from = record.link as usize;
            }
        }
        clean.extend_from_slice(&css[from..end]);
        Some(clean.into_boxed_slice())
    }

    // ───────────────────────────── lines that stand ─────────────────────────────

    /// Most lines of most style sheets are in the source as they're printed, with their indentation and the line breaks
    /// between them: where a formatter is in use, nearly all of them. And most are of a few simple kinds: a statement
    /// with a simple value, the head of a rule with plain selectors, a `}`, a comment. This reads such lines from
    /// `start` on, as long as each is followed by the next the way it's printed. Only the first one needn't be where
    /// it's printed.
    ///
    /// It's no more than a shorter way to what `read_declaration`, `read_rule`, `close_block` and the like make of the
    /// same lines, one at a time: a rule that's opened and closed on the way leaves no trace, and all of it is copied
    /// at once.
    fn read_standing_lines(&mut self, start: usize) -> bool {
        let css = self.css;
        let quick = &mut *self.quick;
        let around = quick.around();
        if around == Around::Other || quick.refused_line == Some(start) {
            return false;
        }
        let mut heads = std::mem::take(&mut quick.standing_heads);
        let stretch = match quick.first_stretch.take() {
            Some((at, stretch)) if at == start => stretch,
            _ => {
                let surroundings = Surroundings {
                    original: self.original,
                    syntax: self.syntax,
                    page: quick.page,
                    quote: quick.quote,
                    level: quick.blocks.len(),
                    is_in_declaration: quick.blocks.last().is_some_and(|it| it.is_in_declaration),
                    is_in_at_rule: around != Around::None,
                    takes_long_comments: quick.takes_long_comments,
                    lays_out_values: quick.lays_out_values,
                    is_on_its_line: self.nodes[self.current as usize].last_child == 0
                        || (quick.gap.is_plain && quick.gap.lines > 0),
                };
                heads.clear();
                read_stretch(css, start, surroundings, &mut heads)
            }
        };
        let Stretch {
            segment,
            semicolon,
            refused,
        } = stretch;
        quick.refused_line = refused;

        // ───────────── what was taken becomes what the long way makes of it
        if segment.is_none() && heads.is_empty() {
            self.quick.standing_heads = heads;
            return false;
        }
        let mut slot = self.slot();
        if !slot.can_run {
            self.quick.standing_heads = heads;
            return self.refuse(slot);
        }
        let mut is_first = true;
        let mut next_slot = |parser: &mut Self, start: usize| {
            if std::mem::take(&mut is_first) {
                return slot;
            }
            let gap = Gap::new(css, parser.tokenizer.pos);
            parser.quick.gap = gap;
            parser.spaces = range(gap.start, start);
            slot = parser.slot();
            slot
        };
        for head in &heads {
            if let Some((start, end)) = head.before {
                let mut slot = next_slot(self, start);
                self.copy_text(&mut slot, start, end);
                self.tokenizer.pos = end;
                self.add_to_run(slot, start, end);
            }
            let mut slot = next_slot(self, head.start);
            let brace = head.end + 1;
            self.copy_text(&mut slot, head.start, brace + 1);
            match head.at_rule {
                None => self.add_rule(slot, head.start, head.end, brace, head.shape),
                Some((name_end, params)) => {
                    let at_rule = AtRule {
                        start: head.start,
                        name_end,
                        params,
                        end: brace + 1,
                        has_block: true,
                    };
                    // (There are no comments in these params.)
                    self.quick.values.has_comments = false;
                    self.add_at_rule(&at_rule, slot, head.shape, true);
                }
            }
        }
        if let Some((start, end)) = segment {
            let mut slot = next_slot(self, start);
            self.copy_text(&mut slot, start, end);
            self.tokenizer.pos = end;
            let semicolon = semicolon.unwrap_or(self.semicolon);
            self.add_to_run(slot, start, end);
            self.semicolon = semicolon;
        }
        self.quick.next_gap = None;
        self.quick.standing_heads = heads;
        true
    }

    /// `name: value;`
    fn read_declaration(&mut self, start: usize) -> bool {
        let css = self.css;
        let first = css[start];
        // The name: `a-b`, `-a-b`, `--a-b`, `$a-b`.
        let name = match (first, byte(css, start + 1)) {
            (b'$', _) if self.syntax != Syntax::Scss => return false,
            (b'$', _) => start + 1,
            (b'-', b'-') => start + 2,
            (b'-', _) => start + 1,
            _ => start,
        };
        let is_variable = first == b'$';
        let is_custom = name == start + 2;
        let starts_name = match is_variable {
            true => LOWER | UPPER | UNDERSCORE | DASH,
            false => LOWER,
        };
        let in_name = LOWER | DIGIT | DASH | UNDERSCORE | if is_variable { UPPER } else { 0 };
        let mut colon = name;
        if is_custom && self.syntax == Syntax::Scss {
            // `--#{$prefix}name`
            while css[colon..].starts_with(b"#{$") {
                let end = skip_long(css, colon + 3, LOWER | DIGIT | DASH | UNDERSCORE);
                if end == colon + 3
                    || value::starts_with_url(css, colon + 3)
                    || byte(css, end) != b'}'
                {
                    return false;
                }
                if value::starts_with_url(css, end + 1) {
                    return false;
                }
                colon = skip_long(css, end + 1, in_name);
            }
        }
        if colon == name {
            if class(byte(css, name)) & starts_name == 0 || value::starts_with_url(css, name) {
                return false;
            }
            colon = skip_long(css, name, in_name);
        }
        if byte(css, colon) != b':' {
            return false;
        }
        let value_start = skip(css, colon + 1, BLANK);
        // `a:hover {` is more likely than `a:hover;`.
        if value_start == colon + 1 && !self.is_declaration(value_start) {
            return false;
        }
        if &css[start..colon] == b"composes" {
            return false;
        }
        let mut slot = self.slot();
        let statement = Statement {
            start,
            head_end: colon,
            value_start,
            owner: match is_custom {
                true => Owner::CustomProperty,
                false => Owner::Declaration,
            },
            is_less_variable: false,
        };
        let Some(read) = self.read_value(&statement, &mut slot) else {
            return self.refuse(slot);
        };
        self.tokenizer.pos = read.end;
        if slot.can_run && self.is_alone(read.end) {
            self.add_to_run(slot, start, read.end);
            self.semicolon = read.tail != Tail::NoSemicolon;
            return true;
        }
        // `postcss` knows nothing of `!default`.
        let value_end = match read.tail {
            Tail::Default | Tail::Global => read.end - 1,
            _ => read.value_end,
        };
        let clean_value = self.clean_value(value_end);
        let printed = Printed {
            shape: read.shape,
            text: self.text_from(slot.start),
            depth: self.depth() as u32,
        };
        let id = self.new_node(Kind::Decl, start as u32);
        let node = self.node(id);
        node.end = Some(read.end as u32);
        node.prop = Range::new(start as u32, colon as u32);
        node.between = Range::new(colon as u32, value_start as u32);
        node.value = Range::new(value_start as u32, value_end as u32);
        node.clean_value = clean_value;
        node.important = read.tail == Tail::Important;
        node.printed = printed;
        self.semicolon = read.tail != Tail::NoSemicolon;
        true
    }

    /// Is the statement whose colon is right before `at` a declaration? True if a `;` or a `}` comes before any `{`.
    fn is_declaration(&self, at: usize) -> bool {
        let rest = self.css.get(at..).unwrap_or_default();
        let end = rest.iter().position(|it| matches!(it, b';' | b'{' | b'}'));
        end.is_some_and(|end| rest[end] != b'{')
    }

    /// `selectors {`
    fn read_rule(&mut self, start: usize) -> bool {
        let css = self.css;
        let syntax = self.syntax;
        // To `postcss`, what starts like a custom property is one, and a `{` after its colon is part of its value.
        if css[start..].starts_with(b"--") {
            return false;
        }
        let mut slot = self.slot();
        let quick = &mut *self.quick;
        let level = quick.blocks.len();
        let context = selector::Context {
            syntax,
            quote: quick.quote,
            is_in_at_rule: quick.around() != Around::None,
            page: quick.page,
            level,
        };
        let copy_from = slot.copy_from.take().unwrap_or(start);
        let extra = &mut self.texts.extra;
        let Some(read) = selector::read(css, copy_from, start, context, extra) else {
            return self.refuse(slot);
        };
        self.add_rule(slot, start, read.end, read.brace, read.shape);
        true
    }

    /// Makes the node for the rule that starts at `start`, whose selectors end at `end` and whose `{` is at `brace`.
    /// What's printed for its head is the text from `slot.start` on.
    fn add_rule(&mut self, slot: Slot, start: usize, end: usize, brace: usize, shape: Shape) {
        let printed = Printed {
            shape,
            text: self.text_from(slot.start),
            depth: self.depth() as u32,
        };
        let previous = self.nodes[self.current as usize].last_child;
        let id = self.new_node(Kind::Rule, start as u32);
        let node = self.node(id);
        node.selector = Range::new(start as u32, end as u32);
        node.between = range(end, brace);
        node.printed = printed;
        self.tokenizer.pos = brace + 1;
        self.open(id);
        self.note_head(slot, previous, true);
    }

    // ───────────────────────────── at-rules ─────────────────────────────

    /// Makes what's printed for `at_rule`, the text from `slot.start` on, part of a run, or makes the node for it.
    /// `is_exact`: that's what's printed for it if nothing is next to it.
    fn add_at_rule(&mut self, at_rule: &AtRule, slot: Slot, shape: Shape, is_exact: bool) {
        let &AtRule {
            start,
            name_end,
            params,
            end,
            has_block,
        } = at_rule;
        self.tokenizer.pos = end;
        if !has_block && is_exact && slot.can_run && self.is_alone(end) {
            self.add_to_run(slot, start, end);
            self.semicolon = true;
            return;
        }
        let clean_params = match params.0 < params.1 {
            true => self.clean_value(params.1),
            false => None,
        };
        let printed = Printed {
            shape,
            text: self.text_from(slot.start),
            depth: self.depth() as u32,
        };
        let previous = self.nodes[self.current as usize].last_child;
        let id = self.new_node(Kind::AtRule, start as u32);
        let node = self.node(id);
        node.name = Range::new(start as u32 + 1, name_end as u32);
        let params_end = match params.0 < params.1 {
            true => {
                node.after_name = Range::new(name_end as u32, params.0 as u32);
                node.params = Range::new(params.0 as u32, params.1 as u32);
                params.1
            }
            false => name_end,
        };
        node.clean_params = clean_params;
        node.between = range(params_end, end - 1);
        node.printed = printed;
        match has_block {
            true => {
                self.open(id);
                // An `@else` goes on the line of the `}` before it.
                let is_else = &self.css[start + 1..name_end] == b"else";
                self.note_head(slot, previous, is_exact && !is_else);
            }
            false => {
                node.end = Some(end as u32);
                self.semicolon = true;
            }
        }
    }

    /// `@name params;` or `@name params {`
    fn read_at_rule(&mut self, start: usize) -> bool {
        let css = self.css;
        let syntax = self.syntax;
        if syntax == Syntax::Less {
            let name_end = skip_long(css, start + 1, LOWER | UPPER | DIGIT | DASH | UNDERSCORE);
            if byte(css, name_end) == b':' && name_end > start + 1 {
                return self.read_less_variable(start, name_end);
            }
        }
        let name_end = skip_long(css, start + 1, LOWER | DIGIT | DASH | UNDERSCORE);
        let name = &css[start + 1..name_end];
        if name.is_empty() {
            return false;
        }
        let after = byte(css, name_end);
        // Without params.
        if matches!(name, b"else" | b"font-face" | b"content") {
            let has_block = css[name_end..].starts_with(b" {");
            let is_known = match name {
                b"else" => has_block && syntax == Syntax::Scss,
                b"font-face" => has_block,
                _ => after == b';' && syntax == Syntax::Scss,
            };
            if !is_known {
                return name == b"else" && self.read_at_rule_with_value(start, name_end);
            }
            let end = name_end + if has_block { 2 } else { 1 };
            let mut slot = self.slot();
            self.copy_text(&mut slot, start, end);
            let at_rule = AtRule {
                start,
                name_end,
                params: (0, 0),
                end,
                has_block,
            };
            self.add_at_rule(&at_rule, slot, Shape::Word, true);
            return true;
        }
        if after == b' '
            && (name == b"media"
                || name.ends_with(b"keyframes")
                || name == b"charset"
                || forms_of_plain_at_rule(name, syntax).is_some())
        {
            return self.read_at_rule_with_text(start, name_end);
        }
        self.read_at_rule_with_value(start, name_end)
    }

    /// An at-rule whose params are printed as they're written, if they're written like that.
    fn read_at_rule_with_text(&mut self, start: usize, name_end: usize) -> bool {
        let css = self.css;
        let params = name_end + 1;
        let name = &css[start + 1..name_end];
        let forms = forms_of_plain_at_rule(name, self.syntax);
        let (params_end, shape) = match name {
            _ if forms.is_some() => (
                end_of_plain_params(css, params, name == b"apply"),
                Shape::Word,
            ),
            b"media" => (end_of_media_queries(css, params, self.syntax), Shape::Line),
            b"charset" => {
                // A string, which keeps its quotes.
                let quote = byte(css, params);
                let content = skip_long(css, params + 1, LOWER | UPPER | DIGIT | DASH | UNDERSCORE);
                let is_string = matches!(quote, b'"' | b'\'') && byte(css, content) == quote;
                (is_string.then_some(content + 1), Shape::Word)
            }
            _ => {
                let is_name = class(byte(css, params)) & (LOWER | UPPER | UNDERSCORE | DASH) != 0
                    && !value::starts_with_url(css, params);
                let end = skip_long(css, params, LOWER | UPPER | DIGIT | DASH | UNDERSCORE);
                (is_name.then_some(end), Shape::Word)
            }
        };
        let Some(params_end) = params_end else {
            return false;
        };
        let has_block = match forms {
            Some((takes_block, takes_none)) => {
                let has_block = byte(css, params_end) == b' ';
                if !(if has_block { takes_block } else { takes_none }) {
                    return false;
                }
                has_block
            }
            None => name != b"charset",
        };
        let tail: &[u8] = if has_block { b" {" } else { b";" };
        if !css[params_end..].starts_with(tail) {
            return false;
        }
        let end = params_end + tail.len();
        let quick = &*self.quick;
        let fits = quick.blocks.len() * quick.page.tab_width + (end - start) <= quick.page.width;
        let mut slot = self.slot();
        self.copy_text(&mut slot, start, end);
        let at_rule = AtRule {
            start,
            name_end,
            params: (params, params_end),
            end,
            has_block,
        };
        // (There are no comments in these params.)
        self.quick.values.has_comments = false;
        self.add_at_rule(&at_rule, slot, shape, shape == Shape::Word || fits);
        true
    }

    /// An at-rule whose params are a value.
    fn read_at_rule_with_value(&mut self, start: usize, name_end: usize) -> bool {
        let css = self.css;
        let name = &css[start + 1..name_end];
        // With a block only, without one only, or either way.
        let (takes_block, takes_none) = match name {
            // `@import (reference) "a"`, `@import url(a)`
            b"import" if matches!(css.get(name_end..name_end + 2), Some(b" \"" | b" '")) => {
                (false, true)
            }
            _ if self.syntax != Syntax::Scss => return false,
            b"if" | b"else" | b"for" | b"each" | b"while" => (true, false),
            b"use" | b"return" | b"import" | b"forward" => (false, true),
            b"mixin" | b"include" | b"function" => (true, true),
            _ => return false,
        };
        if class(byte(css, name_end)) & BLANK == 0 {
            return false;
        }
        let value_start = skip(css, name_end, BLANK);
        let mut slot = self.slot();
        let statement = Statement {
            start,
            head_end: name_end,
            value_start,
            owner: Owner::AtRule,
            is_less_variable: false,
        };
        let Some(read) = self.read_value(&statement, &mut slot) else {
            return self.refuse(slot);
        };
        let has_block = read.tail == Tail::Block;
        let is_refused = !(if has_block { takes_block } else { takes_none })
            // What follows `as` is printed in a way of its own.
            || (name == b"forward"
                && !self.quick.values.has_wildcard
                && strings::contains(&css[value_start..read.value_end], b"as"))
            || (name != b"forward" && self.quick.values.has_wildcard)
            || (name != b"use" && self.quick.values.ends_with_star)
            // There's no blank before `()`.
            || (name != b"return" && self.quick.values.flat(css) == b"()")
            // Only these are known to be laid out like a declaration.
            || (read.is_laid_out && !matches!(name, b"return" | b"include" | b"mixin" | b"function"));
        if is_refused {
            return self.refuse(slot);
        }
        let at_rule = AtRule {
            start,
            name_end,
            params: (value_start, read.value_end),
            end: read.end,
            has_block,
        };
        self.add_at_rule(&at_rule, slot, read.shape, true);
        true
    }

    /// `@name: value;` of Less. `colon` is where the name ends.
    fn read_less_variable(&mut self, start: usize, colon: usize) -> bool {
        let css = self.css;
        if class(byte(css, colon + 1)) & BLANK == 0 || is_asked_for_by_name(&css[start + 1..colon])
        {
            return false;
        }
        let value_start = skip(css, colon + 1, BLANK);
        let mut slot = self.slot();
        let statement = Statement {
            start,
            head_end: colon,
            value_start,
            owner: Owner::AtRule,
            is_less_variable: true,
        };
        let Some(read) = self.read_value(&statement, &mut slot) else {
            return self.refuse(slot);
        };
        let nodes = self.nodes.len();
        let at_rule = AtRule {
            start,
            name_end: colon + 1,
            params: (value_start, read.value_end),
            end: read.end,
            has_block: false,
        };
        self.add_at_rule(&at_rule, slot, read.shape, true);
        if self.nodes.len() > nodes && self.nodes[nodes].kind == Kind::AtRule {
            self.less_variable();
        }
        true
    }

    /// `.name(words);` of Less: the call of a mixin. The parser of selectors takes it for a class that goes on to the
    /// `)`, so it's printed as it's written, except for its strings and numbers.
    fn read_less_mixin_call(&mut self, start: usize) -> bool {
        let css = self.css;
        let first = skip(css, start + 1, DASH);
        if class(byte(css, first)) & (LOWER | UNDERSCORE) == 0 || value::starts_with_url(css, first)
        {
            return false;
        }
        let paren = skip_long(css, first, LOWER | DIGIT | DASH | UNDERSCORE);
        if is_asked_for_by_name(&css[start + 1..paren]) {
            return false;
        }
        if byte(css, paren) == b';' {
            // `.name;`
            let mut slot = self.slot();
            self.copy_text(&mut slot, start, paren + 1);
            self.add_less_mixin_call(start, paren, paren + 1, slot);
            return true;
        }
        if byte(css, paren) != b'(' {
            return false;
        }
        let quick = &mut *self.quick;
        // Read as a value, it's one call.
        let values = &mut quick.values;
        if !values.read(css, start + 1, Syntax::Less, Owner::AtRule, quick.quote)
            || !(byte(css, values.end) == b';' || css[values.end..].starts_with(b" {"))
            || values.is_reshaped
            || values.records.first().is_none_or(|open| {
                open.at as usize != paren - (start + 1)
                    || open.link as usize + 1 != values.records.len()
            })
            || css[values.end - 1] != b')'
        {
            return false;
        }
        let (value_end, level) = (values.end, quick.blocks.len());
        let mut slot = self.slot();
        self.start_text(&mut slot, start);
        let quick = &*self.quick;
        let extra = &mut self.texts.extra;
        extra.push(b'.');
        extra.extend_from_slice(quick.values.flat(css));
        if css[value_end] == b';' {
            extra.push(b';');
            self.add_less_mixin_call(start, paren, value_end + 1, slot);
            return true;
        }
        // `.name(words) {`: a rule.
        extra.extend_from_slice(b" {");
        let printed = Printed {
            shape: Shape::Word,
            text: self.text_from(slot.start),
            depth: level as u32,
        };
        let previous = self.nodes[self.current as usize].last_child;
        let id = self.new_node(Kind::Rule, start as u32);
        let node = self.node(id);
        node.selector = Range::new(start as u32, value_end as u32);
        node.between = Range::new(value_end as u32, value_end as u32 + 1);
        node.printed = printed;
        self.tokenizer.pos = value_end + 2;
        self.open(id);
        self.note_head(slot, previous, true);
        true
    }

    /// The call of a mixin `css[start..end]`, whose name ends at `name_end`. What's printed for it is the text from
    /// `slot.start` on.
    fn add_less_mixin_call(&mut self, start: usize, name_end: usize, end: usize, slot: Slot) {
        self.quick.values.has_comments = false;
        let nodes = self.nodes.len();
        let at_rule = AtRule {
            start,
            name_end,
            params: (name_end, end - 1),
            end,
            has_block: false,
        };
        self.add_at_rule(&at_rule, slot, Shape::Word, true);
        if self.nodes.len() > nodes && self.nodes[nodes].kind == Kind::AtRule {
            let node = &mut self.nodes[nodes];
            node.mixin = true;
            node.identifier = Range::new(start as u32, start as u32 + 1);
        }
    }
}

/// See `Parser::read_standing_lines`. Reads lines from `start` on. Appends the heads of the blocks that are open at the
/// end to `heads`, which is empty.
fn read_stretch(
    css: &[u8],
    start: usize,
    surroundings: Surroundings<'_>,
    heads: &mut Vec<StandingHead>,
) -> Stretch {
    let Surroundings {
        original,
        syntax,
        page,
        quote,
        level: base,
        is_in_declaration,
        is_in_at_rule,
        takes_long_comments,
        lays_out_values,
        is_on_its_line,
    } = surroundings;
    let is_original = std::ptr::eq(css, original);
    let is_as_printed =
        |start: usize, end: usize| is_original || css.get(start..end) == original.get(start..end);
    let mut segment: Option<(usize, usize)> = None;
    let mut semicolon = None;
    // How many of `heads` are those of at-rules.
    let mut at_rules = 0usize;
    let mut at = start;
    // Does it end with a line that isn't taken?
    let is_refused = loop {
        let level = base + heads.len();
        let room = page.width.saturating_sub(level * page.tab_width);
        // ───────────── the line
        let mut head = None;
        let end = match byte(css, at) {
            b'}' if !heads.is_empty() => at + 1,
            b'/' if at > start || is_on_its_line => {
                match end_of_standing_comment(css, at, syntax, takes_long_comments) {
                    Some(end) if is_as_printed(at, end) => end,
                    _ => break true,
                }
            }
            b'}' | b'/' => break true,
            b'@' if !(syntax == Syntax::Less && is_less_variable(css, at)) => {
                match read_simple_at_rule(css, at, syntax, quote) {
                    Some(it) if it.end - at <= room && !is_in_declaration => {
                        if it.has_block {
                            head = Some((it.end - 2, Shape::Line, Some((it.name_end, it.params))));
                        }
                        it.end
                    }
                    None if lays_out_values && !is_in_declaration => {
                        match end_of_at_rule_with_standing_call(css, at, syntax, quote, page, level)
                        {
                            Some(end) => end,
                            None => break true,
                        }
                    }
                    _ => break true,
                }
            }
            _ => {
                let lists = lays_out_values.then_some((page, level));
                match value::end_of_simple_statement(
                    css,
                    at,
                    syntax,
                    quote,
                    is_in_declaration,
                    lists,
                ) {
                    Some((end, shape, true)) => {
                        head = Some((end, shape, None));
                        end + 2
                    }
                    Some((end, shape, false)) if shape != Shape::Line || end - at <= room => {
                        if css.get(end..end + 2) != Some(b" /") {
                            end
                        } else if let Some(end) =
                            end_of_standing_comment(css, end + 1, syntax, false)
                            && is_as_printed(at, end)
                            && (shape == Shape::Word || (shape == Shape::Line && end - at <= room))
                        {
                            // A comment behind a statement stays there, and the line is measured with it.
                            end
                        } else {
                            break true;
                        }
                    }
                    Some(_) => break true,
                    None => {
                        let Some(selectors) = selector::end_of_standing_selectors(
                            css, at, syntax, quote, page, level,
                        ) else {
                            break true;
                        };
                        if selectors.has_upper && (is_in_at_rule || at_rules > 0) {
                            break true;
                        }
                        head = Some((selectors.end, selectors.shape, None));
                        selectors.end + 2
                    }
                }
            }
        };
        // ───────────── what follows it
        let gap = Gap::new(css, end);
        let next = byte(css, gap.end);
        if head.is_none() && !is_alone(css, gap) {
            break true;
        }
        let mut takes_empty_line = true;
        if let Some((end, shape, at_rule)) = head {
            at_rules += usize::from(at_rule.is_some());
            heads.push(StandingHead {
                start: at,
                end,
                shape,
                at_rule,
                before: segment.take(),
            });
            semicolon = None;
            takes_empty_line = false;
        } else if css[at] == b'}' {
            let Some(head) = heads.pop() else {
                break true;
            };
            at_rules = at_rules.saturating_sub(usize::from(head.at_rule.is_some()));
            segment = Some((head.before.map_or(head.start, |it| it.0), end));
            semicolon = Some(false);
        } else {
            segment = Some((segment.map_or(at, |it| it.0), end));
            if css[at] != b'/' {
                semicolon = Some(true);
            }
        }
        // ───────────── is the next line where it's printed?
        let mut level = base + heads.len();
        if next == b'}' {
            if level == base {
                break false;
            }
            level -= 1;
            takes_empty_line = false;
        }
        let has_empty_line = takes_empty_line && byte(css, end + 1) == b'\n';
        let line_break = end + usize::from(has_empty_line);
        if css.get(end) != Some(&b'\n') || !page.is_line_break(&css[line_break..gap.end], level) {
            break false;
        }
        at = gap.end;
    };
    Stretch {
        segment,
        semicolon,
        refused: is_refused.then_some(at),
    }
}

/// See `Parser::is_alone`. `gap` is the white space after the statement.
#[inline]
fn is_alone(css: &[u8], gap: Gap) -> bool {
    gap.is_plain
        && match byte(css, gap.end) {
            b';' => false,
            b'/' => gap.lines > 0,
            b'@' => !css[gap.end..].starts_with(b"@else"),
            _ => true,
        }
}

/// `@name:`
fn is_less_variable(css: &[u8], start: usize) -> bool {
    let name_end = skip_long(css, start + 1, LOWER | UPPER | DIGIT | DASH | UNDERSCORE);
    byte(css, name_end) == b':' && name_end > start + 1
}

/// An at-rule on one line, from `start` on, that's written as it's printed if it fits, up to its `;` or through its
/// `{`. This is no more than a shorter way to what `Parser::read_at_rule` finds.
fn read_simple_at_rule(css: &[u8], start: usize, syntax: Syntax, quote: u8) -> Option<AtRule> {
    let name_end = skip_long(css, start + 1, LOWER | DIGIT | DASH | UNDERSCORE);
    let params = name_end + 1;
    let name = css.get(start + 1..name_end)?;
    if let Some((takes_block, takes_none)) = forms_of_plain_at_rule(name, syntax) {
        if byte(css, name_end) != b' ' {
            return None;
        }
        let params_end = end_of_plain_params(css, params, name == b"apply")?;
        let has_block = css[params_end] == b' ';
        return (if has_block { takes_block } else { takes_none }).then_some(AtRule {
            start,
            name_end,
            params: (params, params_end),
            end: params_end + if has_block { 2 } else { 1 },
            has_block,
        });
    }
    let (takes_block, takes_none) = match name {
        b"font-face" => {
            return css[name_end..].starts_with(b" {").then_some(AtRule {
                start,
                name_end,
                params: (0, 0),
                end: name_end + 2,
                has_block: true,
            });
        }
        b"content" if syntax == Syntax::Scss => {
            return (byte(css, name_end) == b';').then_some(AtRule {
                start,
                name_end,
                params: (0, 0),
                end: name_end + 1,
                has_block: false,
            });
        }
        b"media" if byte(css, name_end) == b' ' => {
            let params_end = end_of_media_queries(css, params, syntax)?;
            return css[params_end..].starts_with(b" {").then_some(AtRule {
                start,
                name_end,
                params: (params, params_end),
                end: params_end + 2,
                has_block: true,
            });
        }
        name if name.ends_with(b"keyframes") && byte(css, name_end) == b' ' => {
            let is_name = class(byte(css, params)) & (LOWER | UPPER | UNDERSCORE | DASH) != 0
                && !value::starts_with_url(css, params);
            let params_end = skip_long(css, params, LOWER | UPPER | DIGIT | DASH | UNDERSCORE);
            return (is_name && css[params_end..].starts_with(b" {")).then_some(AtRule {
                start,
                name_end,
                params: (params, params_end),
                end: params_end + 2,
                has_block: true,
            });
        }
        b"import" if matches!(css.get(name_end..name_end + 2), Some(b" \"" | b" '")) => {
            (false, true)
        }
        _ if syntax != Syntax::Scss || byte(css, name_end) != b' ' => return None,
        b"if" | b"for" | b"each" | b"while" => (true, false),
        b"use" | b"return" => (false, true),
        b"mixin" | b"include" | b"function" => (true, true),
        _ => return None,
    };
    let (params_end, ends_with_star) = value::end_of_simple_value(css, params, syntax, quote)?;
    if ends_with_star && name != b"use" {
        return None;
    }
    let has_block = match css.get(params_end..params_end + 2)? {
        [b';', ..] if takes_none => false,
        b" {" if takes_block => true,
        _ => return None,
    };
    Some(AtRule {
        start,
        name_end,
        params: (params, params_end),
        end: params_end + if has_block { 2 } else { 1 },
        has_block,
    })
}

/// `@include name(..);` or `@return name(..);` of SCSS, from `start` on, `level` blocks deep, with an argument on each
/// line because it doesn't fit on one. Returns where it ends.
fn end_of_at_rule_with_standing_call(
    css: &[u8],
    start: usize,
    syntax: Syntax,
    quote: u8,
    page: Page,
    level: usize,
) -> Option<usize> {
    let name_end = skip_long(css, start + 1, LOWER);
    if syntax != Syntax::Scss
        || !matches!(css.get(start + 1..name_end)?, b"include" | b"return")
        || byte(css, name_end) != b' '
    {
        return None;
    }
    let places = (start, name_end + 1);
    let (close, flat_len) =
        value::end_of_standing_call(css, places, syntax, quote, Owner::AtRule, page, level)?;
    // With its `;`.
    let fits = level * page.tab_width + flat_len < page.width;
    (byte(css, close + 1) == b';' && !fits).then_some(close + 2)
}

/// See `Parser::read_less_line_comment`. Returns where the line ends.
fn end_of_less_line_comment(css: &[u8], start: usize) -> Option<usize> {
    let mut p = start + 2;
    loop {
        match byte(css, p) {
            b'\n' => return Some(p),
            b'"' | b'\'' | b'*' | b'\\' | b')' | 0..=8 | 0x0B..=0x1F => return None,
            b'u' | b'U' if value::starts_with_url(css, p) => return None,
            b'(' => {
                // One token, if it's closed on the line and nothing is in it that the tokenizer looks for.
                p += 1;
                while byte(css, p) != b')' {
                    if matches!(
                        css.get(p),
                        None | Some(
                            b'\n' | b'\r' | b'"' | b'\'' | b'(' | b'/' | b'\\' | b'*' | 0x0C
                        )
                    ) {
                        return None;
                    }
                    p += 1;
                }
            }
            _ => {}
        }
        p += 1;
    }
}

/// The white space at the end of a `//` comment isn't printed. That's what `trim` of JavaScript takes for white space:
/// a vertical tab too, and some of what isn't ASCII, all of which counts here.
fn may_end_with_white_space(text: &[u8]) -> bool {
    matches!(text.last(), Some(b'\t'..=b'\r' | b' ' | 0x80..))
}

/// A comment from `start` on that's printed as it's written. Returns its end. `takes_lines`: it can have line breaks.
fn end_of_standing_comment(
    css: &[u8],
    start: usize,
    syntax: Syntax,
    takes_lines: bool,
) -> Option<usize> {
    let rest = css.get(start + 2..)?;
    // (Nothing here looks further than the comment goes: there can be any number of them on a line.)
    let (content, delimiter_len) = match byte(css, start + 1) {
        b'*' => {
            let content = &rest[..strings::index_of(rest, b"*/")?];
            let others: &[u8] = if takes_lines { b"\r\x0C" } else { b"\n\r\x0C" };
            if strings::contains_any(content, others) {
                return None;
            }
            (content, 2)
        }
        b'/' => {
            let len = match syntax {
                Syntax::Css => return None,
                Syntax::Scss => strings::index_of_any(rest, b"\n\r\x0C")?,
                Syntax::Less => end_of_less_line_comment(css, start)? - (start + 2),
            };
            let line = &rest[..len];
            if may_end_with_white_space(line) {
                return None;
            }
            (line, 0)
        }
        _ => return None,
    };
    (!is_ignore_comment(content)).then_some(start + 2 + content.len() + delimiter_len)
}

/// The range that the parser makes of the tokens from `start` to `end`.
fn range(start: usize, end: usize) -> Range {
    match start < end {
        true => Range::new(start as u32, end as u32),
        false => Range::default(),
    }
}

/// True if a comment with this text says to leave the next node as it is.
fn is_ignore_comment(text: &[u8]) -> bool {
    strings::trim_js_whitespace(text) == b"prettier-ignore"
}
