//! The short cut for what starts a line: statements, members of classes, properties of broken objects.
//!
//! Most of them fit on their line. For those, everything that the printers in `print/` do (groups, indentation, possible
//! line breaks, several layouts to choose from) and everything that the printer of `ir/` does with it comes to the same
//! as writing the tokens one after the other. [`Line`] does that, straight from the tree to one text.
//!
//! What makes it right:
//!
//! 1. The text starts a line of the output and a forced line break follows it.
//! 2. A document without a forced line break, whose possible line breaks are all in groups, is printed on one line if
//!    that fits. Whether it fits depends on the indentation. [`ShortCuts::depth`] counts the lists that are open. Where
//!    only statements are between the file and the line, that's the indentation. In a function that's part of an
//!    expression it's a lower bound, the indentation in the source is a guess, and the printer checks: a text that's
//!    too wide after all makes it give up, and the file is formatted again with [`Mode::Certain`].
//! 3. Where nothing but closing brackets follows, the line can end with the opening bracket of something that's certain
//!    to break: the body of a function, a block, an object whose first key is on a new line. The printers in `print/`
//!    write that ([`Part`]), and what follows it is the next line.
//! 4. What is too wide is written once more ([`Line::breaks`]), with the line breaks that are certain then: the outermost
//!    group breaks first, and each group in it is tried on one line in turn. See `breaks.rs`.
//! 5. Everything here is an "or else". What isn't known to be printed in exactly this way is [`Refused`], and the
//!    printers in `print/` write it: comments, syntax that's missing below, and whatever breaks whether it fits or not
//!    (an array of objects, a chain of three calls with a function among the arguments, two functions as arguments).
//! 6. Bytes are counted for columns. Source that isn't plain ASCII gets an attempt of its own ([`Line::is_careful`]), in
//!    which every text is measured.
//!
//! `bun fmt --no-short-cuts` turns it off, and the tests compare.

mod arrows;
mod assignments;
mod binary;
mod breaks;
mod chains;
mod classes;
mod conditionals;
mod expressions;
mod flow;
mod forced;
mod functions;
mod holes;
mod jsx;
mod plain;
mod signatures;
mod statements;
mod suffixes;
mod ts_declarations;
mod types;

use self::breaks::is_unbreakable;
pub(crate) use self::forced::write_array_element;
pub(crate) use jsx::write_jsx_child;
pub(crate) use statements::write_case_head;
pub(crate) use ts_declarations::{write_enum_member, write_signature};

use crate::ir::element::{FormatElement, LineMode, Tag, Text, TextWidth, Token};
use crate::js::parentheses::expression::{
    chain_expression_needs_parentheses, needs_parentheses, operand_needs_parentheses,
};
use crate::js::print::binary_like_expression::should_flatten;
use crate::js::print::block_statement::is_empty_block;
use crate::js::print::call_like_expression::keeps_arguments_on_one_line;
use crate::js::print::class::write_class_body_after_head;
use crate::js::print::function::FormatFunctionBody;
use crate::js::print::jsx::write_children_on_lines;
use crate::js::print::parameters::can_avoid_parentheses;
use crate::js::print::statements::{
    expression_statement_needs_semicolon, follows_type_cast_comment,
};
use crate::js::utils::member_chain::simple_argument::SimpleArgument;
use crate::js::utils::number::format_trimmed_number;
use crate::js::utils::string::{FormatLiteralStringToken, StringLiteralParentKind};
use crate::prelude::*;
use crate::write;
use bun_core::strings;
use smallvec::SmallVec;

/// Which lines take the short cut.
#[derive(Copy, Clone, PartialEq, Eq, PartialOrd, Ord, Debug, Default)]
pub(crate) enum Mode {
    #[default]
    Off,
    /// Only those whose indentation is known.
    Certain,
    All,
}

/// Where the line that's being written starts.
#[derive(Copy, Clone, Debug, Default)]
pub(crate) struct ShortCuts {
    pub(crate) mode: Mode,
    /// By how many levels the items of the innermost list are indented, at least.
    pub(crate) depth: u32,
    /// `depth` is exact.
    pub(crate) is_certain: bool,
    /// One more than the start of the statement that a list is about to write, or 0.
    pub(crate) next_in_list: u32,
    /// The function body or the object that's written next follows a [`Line`] on its line, so what's in it is indented
    /// by one level more than that line.
    pub(crate) follows_line: bool,
    /// The properties of the object that's being written are each on a line.
    pub(crate) properties_start_lines: bool,
    /// See [`ShortCuts::start_script_at`].
    is_before_script: bool,
    /// The file has a block comment with something before or after it on its line.
    has_block_comment_in_line: bool,
    /// The file has a comment that says to ignore something, or one that starts with `<!--` or `-->`.
    has_ignore_comment: bool,
    is_flow: bool,
    is_typescript: bool,
    /// Statements end with a `;`.
    has_semicolons: bool,
}

impl ShortCuts {
    /// For a file that's formatted by itself.
    pub(crate) fn for_file<'a>(file: &'a File<'a>, options: &FormatOptions) -> ShortCuts {
        let whole = ShortCuts {
            mode: match options.in_html.root {
                HtmlRoot::None => Mode::All,
                _ => Mode::Off,
            },
            is_certain: true,
            ..ShortCuts::default()
        };
        whole.for_code(file, options)
    }

    /// For a document in another language with scripts in it, which is written again the long way if the printer finds
    /// a guess to be wrong.
    pub(crate) fn for_host(options: &FormatOptions) -> ShortCuts {
        let has_place = options.cursor_offset.is_some()
            || options.range_start.is_some()
            || options.range_end.is_some();
        ShortCuts {
            mode: match options.no_short_cuts || has_place {
                true => Mode::Off,
                false => Mode::All,
            },
            ..ShortCuts::default()
        }
    }

    /// What the host writes next is what's in a `<script>`, indented by `level` levels, if that's known.
    pub(crate) fn start_script_at(&mut self, level: Option<u32>) {
        (self.depth, self.is_certain) = (level.unwrap_or(0), level.is_some());
        self.is_before_script = true;
    }

    pub(crate) fn end_script(&mut self) {
        self.is_before_script = false;
    }

    /// For a script in the document of a host, whose state this is. Every line of it is indented like the first. Code
    /// that the host hasn't announced gets none: in an attribute, its quotes are written as entities afterwards.
    pub(crate) fn for_script<'a>(
        &mut self,
        file: &'a File<'a>,
        options: &FormatOptions,
    ) -> ShortCuts {
        if !std::mem::take(&mut self.is_before_script) {
            return ShortCuts::default();
        }
        let in_script = InHtml {
            root: HtmlRoot::Program,
            quote_style: options.in_html.quote_style,
            has_babel_tree: options.in_html.has_babel_tree,
            ..InHtml::default()
        };
        match options.in_html == in_script {
            true => self.for_code(file, options),
            false => ShortCuts::default(),
        }
    }

    fn for_code<'a>(self, file: &'a File<'a>, options: &FormatOptions) -> ShortCuts {
        let is_plain_run = self.mode != Mode::Off
            && !options.no_short_cuts
            && !options.experimental_ternaries
            && options.cursor_offset.is_none()
            && options.range_start.is_none()
            && options.range_end.is_none()
            && !options.is_mdx_jsx
            && options.html_template_depth == 0
            && options.sort_imports.is_none()
            && options.tailwind.is_none()
            && options.debug_comments == DebugComments::Off
            && !has_lone_carriage_return(file.text());
        if !is_plain_run {
            return ShortCuts::default();
        }
        ShortCuts {
            mode: self.mode,
            depth: self.depth,
            is_certain: self.is_certain,
            has_block_comment_in_line: file.comments_by_id().any(|comment| {
                comment.is_block() && !is_alone_on_its_lines(file.text(), comment.span())
            }),
            has_ignore_comment: file.comments_by_id().any(|comment| {
                comment.is_ignore_comment(options.flavor)
                    || file.text().get(comment.span().start as usize) != Some(&b'/')
            }),
            is_flow: file.is_flow(),
            is_typescript: !file.is_flow() && !file.is_javascript(),
            has_semicolons: options.semicolons.is_always(),
            ..ShortCuts::default()
        }
    }
}

/// True if nothing but blanks and tabs is before and after `span` on its lines. Other white space counts as something:
/// who asks whether a comment starts its line doesn't skip it everywhere.
fn is_alone_on_its_lines(text: &[u8], span: Span) -> bool {
    let mut before = text.get(..span.start as usize).unwrap_or_default();
    while let [rest @ .., b' ' | b'\t'] = before {
        before = rest;
    }
    let mut after = text.get(span.end as usize..).unwrap_or_default();
    while let [b' ' | b'\t' | b'\r', rest @ ..] = after {
        after = rest;
    }
    matches!(before, [] | [.., b'\n']) && matches!(after, [] | [b'\n', ..])
}

/// True if `text` has a `\r` that isn't part of `\r\n`. Every check for a line break below looks for `\n`.
fn has_lone_carriage_return(text: &[u8]) -> bool {
    let mut rest = text;
    while let Some(at) = strings::index_of_char_usize(rest, b'\r') {
        if rest.get(at + 1) != Some(&b'\n') {
            return true;
        }
        rest = &rest[at + 2..];
    }
    false
}

/// The items of a list that's indented by one level more than what's around it.
pub(crate) struct Deeper<'c, C>(pub(crate) &'c C);

impl<'a, C: Format<'a>> Format<'a> for Deeper<'_, C> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        f.context_mut().short_cuts.depth += 1;
        self.0.fmt(f);
        f.context_mut().short_cuts.depth -= 1;
    }
}

/// Content whose indentation depends on which groups break, unless `is_certain`.
pub(crate) struct CertainIf<'c, C>(pub(crate) bool, pub(crate) &'c C);

impl<'a, C: Format<'a>> Format<'a> for CertainIf<'_, C> {
    #[inline]
    fn fmt(&self, f: &mut Formatter<'a>) {
        let outer = f.context().short_cuts.is_certain;
        f.context_mut().short_cuts.is_certain = outer && self.0;
        self.1.fmt(f);
        f.context_mut().short_cuts.is_certain = outer;
    }
}

/// Content that isn't printed as part of the file, so that nothing is known about where its lines start, and nobody
/// formats it again if a guess is wrong.
pub(crate) struct LongWay<'c, C: ?Sized>(pub(crate) &'c C);

impl<'a, C: Format<'a> + ?Sized> Format<'a> for LongWay<'_, C> {
    fn fmt(&self, f: &mut Formatter<'a>) {
        let outer = std::mem::replace(&mut f.context_mut().short_cuts.mode, Mode::Off);
        self.0.fmt(f);
        f.context_mut().short_cuts.mode = outer;
    }
}

/// It isn't certain how the node is printed.
pub(crate) struct Refused;

type Written = Result<(), Refused>;

/// How deep expressions, types and patterns can be nested in a [`Line`]. Anything deeper goes the long way, which asks
/// the stack.
const MAX_NESTING: u32 = 48;

/// What a [`Line`] has written.
#[derive(Copy, Clone)]
enum Part<'a> {
    /// A range of the text buffer, its width, and the width of what follows it on its line. `None` if the text is printed
    /// like this however wide it is.
    Text {
        start: u32,
        len: u32,
        width: u32,
        after: Option<u32>,
    },
    /// A line break, after which the indentation is this many levels deeper.
    Break(i8),
    /// The indentation is one level less deep from the next line break on.
    Outdent,
    /// The `{ .. }` of a function, with statements in it.
    Body(Func<'a>),
    /// A block.
    Block(Stmt<'a>),
    /// An object or an array that's certain to break.
    Broken(Expr<'a>),
    /// Any expression, on a line of its own.
    Expr(Expr<'a>),
    /// What follows the `?` or the `:` of a conditional expression that's broken.
    Aligned(Expr<'a>),
    /// The `{ .. }` of a class, with members in it.
    ClassBody(Class<'a>),
    Hole(holes::Hole<'a>),
    /// What's between the tags of an element, on lines of its own.
    JsxChildren(Jsx<'a>),
    /// An attribute on a line of its own.
    JsxAttribute(Prop<'a>),
}

/// Where an expression is, as far as parentheses go.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Place {
    /// An argument, an element, an initializer, the value of a property, between brackets. Only a sequence needs
    /// parentheses there.
    Free,
    /// The object of a member access or the callee of a call. A name, a member access or a call needs none, unless it
    /// ends an optional chain.
    Object,
    Other,
}

/// What's known about how wide the current line is.
#[derive(Copy, Clone, PartialEq, Eq)]
enum Width {
    /// As wide as the text that has been written.
    Known,
    /// Something that can't break has gone past the end of the line, so nothing more fits.
    TooWide,
    /// It starts with the end of something that has gone the long way.
    Unknown,
}

/// What a [`Line`] writes to, kept from one to the next.
#[derive(Default)]
pub(crate) struct Buffers<'a> {
    /// Its length stays, and what's in it means nothing.
    pub(crate) text: Vec<u8>,
    /// Empty lists. A part can write lines of its own while the list that it's in is read.
    parts: Vec<Vec<Part<'a>>>,
}

/// Writes nodes to a buffer, which goes to the end of the formatter's text buffer if the short cut is taken.
struct Line<'f, 'a> {
    f: &'f mut Formatter<'a>,
    /// Longer than what's written to it, so that a short text can be copied as a block.
    text: Vec<u8>,
    source: &'a [u8],
    /// The source, or nothing if the line is careful.
    plain_source: &'a [u8],
    /// How many columns there are between the indentation and the end of the line.
    room: usize,
    indent_width: usize,
    /// Where the text of the current line starts in `text`.
    start: usize,
    /// Where what's written to `text` ends.
    len: usize,
    /// The `len` at which the line is full.
    limit: usize,
    /// The width of what a part has written on the current line before the text: its closing bracket.
    taken: usize,
    /// By how many bytes the text of the current line is longer than it's wide. `limit` is later by as much.
    extra: usize,
    width: Width,
    /// While there are this many parts, the line that's being written has to fit: if it doesn't, it starts elsewhere.
    must_fit: usize,
    /// The text went past `limit`.
    is_too_wide: bool,
    /// The source has something in it that isn't plain. For a careful line: a text has more bytes than columns.
    is_odd: bool,
    /// The source isn't plain, so every text from it is looked at and measured.
    is_careful: bool,
    /// All of the source is known to be plain.
    is_plain: bool,
    /// On one line it's too wide, so the outermost group breaks.
    breaks: bool,
    /// The indentation is known, so that what's too wide can break.
    is_certain: bool,
    /// Something has been found too wide, by the number of its bytes and before all of it was looked at. So all of it
    /// has to be plain and without comments, also what goes the long way.
    has_measured: bool,
    /// The width of what follows the expression that ends the line: closing brackets, a comma, a semicolon.
    tail: usize,
    /// There's no comment anywhere in the source of what's written.
    is_quiet: bool,
    is_flow: bool,
    /// Neither Flow nor JavaScript, where types are printed like those of Flow.
    is_typescript: bool,
    has_semicolons: bool,
    /// Up to here the source is known to be plain and without comments.
    checked_to: u32,
    nesting: u32,
    parts: Vec<Part<'a>>,
}

/// True if `text` has a line with nothing but white space on it, or nothing but a comma or a `(`: oxfmt counts the line
/// breaks between two arguments.
fn has_empty_line(text: &[u8]) -> bool {
    let mut rest = text;
    while let Some(at) = strings::index_of_char_usize(rest, b'\n') {
        rest = &rest[at + 1..];
        let blank = rest
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t' | b'\r' | b',' | b'('))
            .count();
        if rest.get(blank) == Some(&b'\n') {
            return true;
        }
    }
    false
}

/// True if `text`, which isn't plain, can have an empty line in it, or a line break that isn't `\n`. What is white space
/// is not the same everywhere, so every character that isn't ASCII counts.
#[cold]
#[inline(never)]
fn has_odd_line(text: &[u8]) -> bool {
    let mut rest = text;
    while let Some(at) = strings::index_of_char_usize(rest, b'\n') {
        rest = &rest[at + 1..];
        let blank = rest
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b',' | b'(' | 0..=9 | 11..=31 | 0x7F..))
            .count();
        if rest.get(blank) == Some(&b'\n') {
            return true;
        }
    }
    // U+2028 and U+2029
    strings::contains(text, b"\xE2\x80\xA8") || strings::contains(text, b"\xE2\x80\xA9")
}

/// True if a block comment follows what ends at `end` and is printed on its line: nothing but commas and semicolons is
/// between the two, and the comment doesn't start a line.
#[inline(never)]
fn is_before_block_comment(source: &[u8], end: u32) -> bool {
    let mut rest = source.get(end as usize..).unwrap_or_default();
    let mut starts_line = false;
    let mut is_behind_comment = false;
    loop {
        rest = match rest {
            [b' ' | b'\t' | b'\r', tail @ ..] => tail,
            // `a;⏎/* b */;`: the `;` is an empty statement, which isn't printed, and the comment follows `a;` on its line.
            // `a⏎/* b */,`, `a⏎/* b */⏎,`: the comment is printed before the comma.
            [b',' | b';', ..] if is_behind_comment => return true,
            // A comment after other white space, also what isn't ASCII, doesn't count as one that starts its line.
            [b',' | b';' | 0x0B | 0x0C | 0x80.., tail @ ..] => {
                starts_line = false;
                tail
            }
            [b'\n', tail @ ..] => {
                starts_line = true;
                tail
            }
            // `a // b⏎, /* c */`
            [b'/', b'/', tail @ ..] => {
                let end = strings::index_of_char_usize(tail, b'\n').unwrap_or(tail.len());
                tail.get(end..).unwrap_or_default()
            }
            [b'/', b'*', ..] if !starts_line => return true,
            [b'/', b'*', text @ ..] => {
                is_behind_comment = true;
                let end = strings::index_of(text, b"*/").map_or(text.len(), |at| at + 2);
                text.get(end..).unwrap_or_default()
            }
            _ => return false,
        };
    }
}

/// True if a block comment is before what starts at `start` on its line, so that it doesn't start where its line does.
/// A `;` between the two is an empty statement, which isn't printed. A comment before the `:` of a `case` is printed behind it.
/// `/* a */;⏎b`: the comment doesn't end its line, so it's printed on the line of what follows, wherever that is.
fn is_after_block_comment(source: &[u8], start: u32) -> bool {
    let mut before = source.get(..start as usize).unwrap_or_default();
    let mut ends_line = false;
    loop {
        (before, ends_line) = match before {
            [rest @ .., b' ' | b'\t' | 0x0B | 0x0C | 0x80..] => (rest, ends_line),
            [rest @ .., b';' | b':'] => (rest, false),
            [rest @ .., b'\n' | b'\r'] => (rest, true),
            _ => return !ends_line && before.ends_with(b"*/"),
        };
    }
}

/// By how much the text buffer of a [`Line`] is longer than what's written to it.
const SLACK: usize = 256;

impl<'a> Formatter<'a> {
    #[cold]
    #[inline(never)]
    fn has_comment_in_item(&self, span: Span) -> bool {
        !self.is_quiet() && self.comments().has_comment_or_owner_in(span)
    }

    /// Calls `write` with a [`Line`] that starts a line of the output, for the node at `span`. `after` is the width of
    /// what the caller writes behind it on the same line: at least, and at most. Returns false, with nothing written, if
    /// the short cut isn't taken.
    fn write_line(
        &mut self,
        span: Span,
        after: (u32, u32),
        write: impl Fn(&mut Line<'_, 'a>) -> Written,
    ) -> bool {
        let state = self.context().short_cuts;
        if state.mode == Mode::Off {
            return false;
        }
        // What a line leaves to the printers asks for lines again, and not always by way of `Expr` or `Stmt`: the
        // children of an element.
        if !self.context_mut().has_stack_left() {
            return false;
        }
        let options = self.options();
        let (width, indent_width) = (
            options.line_width.value() as usize,
            options.indent_width.value() as usize,
        );
        let mut column = state.depth as usize * indent_width;
        if !state.is_certain {
            if state.mode != Mode::All {
                return false;
            }
            column = column.max(self.column_in_source(span.start, indent_width));
        }
        let Some(room) = width.checked_sub(column) else {
            return false;
        };
        let source = self.source_text().as_bytes();
        if state.has_block_comment_in_line
            && (is_before_block_comment(source, span.end)
                || is_after_block_comment(source, span.start))
        {
            return false;
        }
        // What's ignored is copied, so nothing that's known about where a node breaks holds for it.
        if state.has_ignore_comment && self.has_comment_in_item(span) {
            return false;
        }
        // Looking at all of a long item takes longer than an attempt that ends where the source isn't plain.
        let is_short = span.len() <= 256;
        let is_plain = is_short && self.is_plain_source(span);
        let is_careful = is_short && !is_plain;
        let buffers = &mut self.context_mut().line_buffers;
        let mut text = std::mem::take(&mut buffers.text);
        let parts = buffers.parts.pop().unwrap_or_default();
        if text.len() < SLACK {
            text.resize(4 * SLACK, 0);
        }
        let mut line = Line {
            text,
            room,
            indent_width,
            start: 0,
            len: 0,
            limit: room,
            taken: 0,
            extra: 0,
            width: Width::Known,
            must_fit: usize::MAX,
            is_too_wide: false,
            is_odd: false,
            is_careful,
            is_plain,
            breaks: false,
            // What's decided by a column needs to know what follows to the column.
            is_certain: state.is_certain && after.0 == after.1,
            has_measured: false,
            tail: after.1 as usize,
            is_quiet: self.is_quiet(),
            is_flow: state.is_flow,
            is_typescript: state.is_typescript,
            has_semicolons: state.has_semicolons,
            f: self,
            source,
            plain_source: match is_careful {
                true => &[],
                false => source,
            },
            checked_to: span.start,
            nesting: 0,
            parts,
        };
        let mut written = line.finish(&write, span.end, after);
        let mut is_last = false;
        while written.is_err() && !is_last {
            if !line.is_careful
                && (line.is_odd || (line.is_too_wide && !line.f.is_plain_source(span)))
            {
                // Bytes have been counted, which are more than columns in text that isn't plain.
                (line.is_careful, line.plain_source) = (true, &[]);
            } else if line.is_too_wide && !line.is_odd && state.is_certain && line.parts.is_empty()
            {
                // That it's too wide is only certain if the indentation is.
                (line.is_careful, line.plain_source) = (false, source);
                (line.breaks, is_last) = (true, true);
            } else {
                break;
            }
            line.parts.clear();
            (line.room, line.start, line.len, line.limit) = (room, 0, 0, room);
            (line.taken, line.extra, line.checked_to, line.nesting) = (0, 0, span.start, 0);
            (line.is_too_wide, line.is_odd) = (false, false);
            (line.width, line.must_fit, line.has_measured) =
                (Width::Known, usize::MAX, line.breaks);
            written = line.finish(&write, span.end, after);
        }
        let Line {
            text,
            mut parts,
            len,
            ..
        } = line;
        let base = self.storage.text.len() as u32;
        if written.is_ok() {
            (self.storage.text).extend_from_slice(text.get(..len).unwrap_or_default());
        }
        self.context_mut().line_buffers.text = text;
        if written.is_err() {
            parts.clear();
            self.context_mut().line_buffers.parts.push(parts);
            return false;
        }
        for &part in &parts {
            match part {
                Part::Text {
                    start,
                    len,
                    width,
                    after,
                } => {
                    self.write_element(FormatElement::OwnedText(Text {
                        start: base + start,
                        len,
                        width: match after {
                            Some(after) => TextWidth::short_cut(width, after),
                            None => TextWidth::single(width),
                        },
                    }));
                }
                Part::Break(0) => self.write_element(FormatElement::Line(LineMode::Hard)),
                Part::Break(1..) => {
                    self.context_mut().short_cuts.depth += 1;
                    self.write_element(FormatElement::Tag(Tag::StartIndentWithLine(
                        LineMode::Hard,
                    )));
                }
                Part::Break(_) => {
                    self.context_mut().short_cuts.depth -= 1;
                    self.write_element(FormatElement::Tag(Tag::EndIndentWithLine(LineMode::Hard)));
                }
                Part::Outdent => {
                    self.context_mut().short_cuts.depth -= 1;
                    self.write_element(FormatElement::Tag(Tag::EndIndent));
                }
                Part::Body(func) => {
                    self.context_mut().short_cuts.follows_line = true;
                    FormatFunctionBody(func).fmt(self);
                }
                Part::Block(block) => write!(self, [space(), block]),
                Part::Broken(e) => {
                    self.context_mut().short_cuts.follows_line = true;
                    e.fmt(self);
                    self.context_mut().short_cuts.follows_line = false;
                }
                Part::Expr(e) => CertainIf(false, &e).fmt(self),
                Part::Aligned(e) => match self.options().indent_style.is_space() {
                    true => write!(self, align(2, &CertainIf(false, &e))),
                    false => write!(self, indent(&CertainIf(false, &e))),
                },
                Part::ClassBody(class) => write_class_body_after_head(class, self),
                Part::Hole(hole) => hole.write(self),
                Part::JsxChildren(element) => {
                    self.context_mut().short_cuts.follows_line = true;
                    // The printer measures what's in a fill again after a forced line break, until a group starts.
                    let children = format_with(|f| write_children_on_lines(element, f));
                    write!(self, group(&children).should_expand(true));
                }
                Part::JsxAttribute(attribute) => {
                    if !jsx::write_jsx_attribute(attribute, self) {
                        attribute.fmt(self);
                    }
                }
            }
        }
        parts.clear();
        self.context_mut().line_buffers.parts.push(parts);
        true
    }

    /// The column at which the line of `offset` starts in the source, with a tab counted as one level.
    fn column_in_source(&self, offset: u32, indent_width: usize) -> usize {
        let before = self
            .source_text()
            .as_bytes()
            .get(..offset as usize)
            .unwrap_or_default();
        let mut column = 0;
        for byte in before.iter().rev() {
            match byte {
                b' ' => column += 1,
                b'\t' => column += indent_width,
                _ => break,
            }
        }
        column
    }
}

/// Writes `statement`, which a list of statements is about to write on a line of its own. Returns false if it has to go
/// the long way.
pub(crate) fn write_statement<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) -> bool {
    f.write_line(statement.span(), (0, 0), |line| {
        line.tail = usize::from(line.has_semicolons);
        if !line.has_semicolons {
            line.semicolon_before(statement)?;
        }
        line.statement(statement)
    })
}

/// Writes `property` of an object whose properties are each on a line.
pub(crate) fn write_property<'a>(property: Prop<'a>, f: &mut Formatter<'a>) -> bool {
    let has_comma = !f.options().trailing_commas.is_none()
        || !matches!(property.parent(), Node::Expr(object)
            if object.as_object().and_then(List::last) == Some(property));
    let after = u32::from(has_comma);
    f.write_line(property.span(), (after, after), |line| {
        line.property(property, true)
    })
}

/// Writes `member` of a class. The caller writes the `;` of a property.
pub(crate) fn write_class_member<'a>(member: Member<'a>, f: &mut Formatter<'a>) -> bool {
    let after = match member.kind() {
        MemberKind::Property => (u32::from(f.options().semicolons.is_always()), 1),
        _ => (0, 0),
    };
    f.write_line(member.span(), after, |line| {
        if line.is_flow {
            line.check_flow_member(member)?;
        }
        line.class_member(member)
    })
}

impl<'a> Line<'_, 'a> {
    fn finish(
        &mut self,
        write: &impl Fn(&mut Self) -> Written,
        end: u32,
        (least, most): (u32, u32),
    ) -> Written {
        write(self)?;
        self.check_source_up_to(end)?;
        let written = self.end_text(Some(most));
        if written.is_err() && least < most {
            // It isn't certain that it's too wide.
            self.is_too_wide = self.end_text(Some(least)).is_err();
        }
        written
    }

    /// The `;` that ends a statement.
    #[inline]
    fn semicolon(&mut self) -> Written {
        match self.has_semicolons {
            true => self.byte(b';'),
            false => Ok(()),
        }
    }

    /// Without semicolons, the `;` before a statement that would go on with the line before it.
    fn semicolon_before(&mut self, statement: Stmt<'a>) -> Written {
        if let StmtKind::Expr(expression) = statement.kind()
            && expression_statement_needs_semicolon(statement, expression, self.f)
        {
            // It's before the comment.
            if follows_type_cast_comment(statement.span().start, self.f) {
                return Err(Refused);
            }
            self.byte(b';')?;
        }
        Ok(())
    }

    // ───────────────────────────── text ─────────────────────────────

    /// Writes the first `len` bytes of `block`.
    #[inline(always)]
    fn chunk<const N: usize>(&mut self, block: &[u8; N], len: usize) -> Written {
        let end = self.len + len;
        if end > self.limit {
            self.is_too_wide = true;
            return Err(Refused);
        }
        loop {
            if let Some(next) = (self.text)
                .get_mut(self.len..)
                .and_then(|rest| rest.first_chunk_mut())
            {
                *next = *block;
                self.len = end;
                return Ok(());
            }
            self.grow();
        }
    }

    #[cold]
    #[inline(never)]
    fn grow(&mut self) {
        let len = self.text.len();
        self.text.resize(len + 4 * SLACK, 0);
    }

    /// Text that's printed as it is.
    #[inline(never)]
    fn long_bytes(&mut self, text: &[u8]) -> Written {
        if self.is_careful {
            self.measure(text)?;
        }
        let end = self.len + text.len();
        if end > self.limit {
            self.is_too_wide = true;
            return Err(Refused);
        }
        if self.text.len() < end + SLACK {
            self.text.resize(end + SLACK, 0);
        }
        if let Some(next) = self.text.get_mut(self.len..end) {
            next.copy_from_slice(text);
        }
        self.len = end;
        Ok(())
    }

    /// Makes room for the bytes of `text`, which isn't known to be plain, that aren't columns.
    #[cold]
    #[inline(never)]
    fn measure(&mut self, text: &[u8]) -> Written {
        // How wide a control character is depends on what else is in the text.
        if text.iter().any(|byte| matches!(byte, 0..=31 | 0x7F)) {
            return Err(Refused);
        }
        let extra = text
            .len()
            .saturating_sub(self.f.string_width(text) as usize);
        self.is_odd |= extra > 0;
        self.extra += extra;
        self.limit = self.limit.saturating_add(extra);
        Ok(())
    }

    /// A string literal that isn't known to be plain.
    #[cold]
    #[inline(never)]
    fn odd_string(&mut self, span: Span) -> Written {
        let text = self.text_of(span);
        if !matches!(text, [b'"' | b'\'', _, ..]) {
            return Err(Refused);
        }
        let kind = StringLiteralParentKind::Expression;
        let printed = FormatLiteralStringToken::new(text, false, kind).clean_text(self.f);
        self.long_bytes(&printed)
    }

    /// A keyword or a punctuator.
    #[inline(always)]
    fn token(&mut self, text: &'static str) -> Written {
        match Token::new(text) {
            Some(token) => self.chunk(token.padded(), token.len()),
            None => self.long_bytes(text.as_bytes()),
        }
    }

    #[inline(always)]
    fn byte(&mut self, byte: u8) -> Written {
        self.chunk(&[byte], 1)
    }

    /// The source at `span`: a name, a keyword, a literal.
    #[inline(always)]
    fn source(&mut self, span: Span) -> Written {
        if span.len() <= 16
            && let Some(block) = (self.plain_source)
                .get(span.start as usize..)
                .and_then(|rest| rest.first_chunk::<16>())
        {
            return self.chunk(block, span.len() as usize);
        }
        self.long_source(span)
    }

    #[inline(never)]
    fn long_source(&mut self, span: Span) -> Written {
        let text = self.source.get(span.range()).ok_or(Refused)?;
        // A name is printed without escapes.
        if self.is_careful && strings::contains_char(text, b'\\') {
            return Err(Refused);
        }
        self.long_bytes(text)
    }

    #[inline]
    fn text_of(&self, span: Span) -> &'a [u8] {
        self.source.get(span.range()).unwrap_or_default()
    }

    /// True if the source has a line break in `span`, which is short.
    #[inline]
    fn has_line_break_in(&self, span: Span) -> bool {
        strings::contains_char(self.text_of(span), b'\n')
    }

    /// Refuses if the source from where the last check ended up to `end` has a comment in it, a character that isn't as
    /// wide as it has bytes, or an empty line: between arguments, parameters, properties, elements and the links of a
    /// chain it's kept, which breaks what is around it.
    fn check_source_up_to(&mut self, end: u32) -> Written {
        let span = Span::new(self.checked_to, end.max(self.checked_to));
        self.checked_to = span.end;
        if self.is_careful {
            if has_odd_line(self.text_of(span)) {
                return Err(Refused);
            }
        } else if !self.is_plain && !self.f.is_plain_source(span) {
            self.is_odd = true;
            return Err(Refused);
        }
        let is_fine = (self.is_quiet || !self.f.comments().has_comment_or_owner_in(span))
            && !has_empty_line(self.text_of(span));
        match is_fine {
            true => Ok(()),
            false => Err(Refused),
        }
    }

    /// Ends the text of the current line, which `after` more columns follow.
    fn end_text(&mut self, after: Option<u32>) -> Written {
        let len = self.len - self.start;
        let width = len - self.extra;
        let after = after.filter(|_| self.limit != usize::MAX);
        if let Some(after) = after
            && width + self.taken + after as usize > self.room
        {
            self.is_too_wide = true;
            return Err(Refused);
        }
        if len > 0 {
            self.parts.push(Part::Text {
                start: self.start as u32,
                len: len as u32,
                width: width as u32,
                after,
            });
        }
        (self.start, self.extra) = (self.len, 0);
        Ok(())
    }

    /// Starts a line after a part, of which `taken` columns are on it.
    fn start_line(&mut self, taken: usize) {
        self.taken = taken;
        (self.start, self.extra) = (self.len, 0);
        self.limit = self.start + self.room.saturating_sub(taken);
        self.width = Width::Known;
    }

    /// Ends the line with `part`, whose source is at `span` and which starts with `after` columns of text on this line.
    /// What's written next follows its closing bracket, on a line that starts where this line starts.
    fn end_line_with(&mut self, part: Part<'a>, span: Span, after: u32) -> Written {
        self.check_source_up_to(span.start)?;
        if matches!(part, Part::Broken(_)) {
            self.check_measured(span)?;
        }
        // That it's too wide on one line has been found by counting its bytes.
        if self.breaks && matches!(part, Part::Hole(_)) && !self.f.is_plain_source(span) {
            return Err(Refused);
        }
        self.end_text(Some(after))?;
        self.parts.push(part);
        self.checked_to = span.end;
        self.start_line(1);
        Ok(())
    }

    /// A line break, after which the indentation is `levels` deeper.
    fn break_line(&mut self, levels: i8) -> Written {
        self.end_text(Some(0))?;
        self.parts.push(Part::Break(levels));
        self.room = match levels {
            0 => self.room,
            1.. => self.room.checked_sub(self.indent_width).ok_or(Refused)?,
            _ => self.room + self.indent_width,
        };
        self.start_line(0);
        Ok(())
    }

    #[inline]
    fn nested(&mut self, write: impl FnOnce(&mut Self) -> Written) -> Written {
        if self.nesting >= MAX_NESTING {
            return Err(Refused);
        }
        self.nesting += 1;
        let written = write(self);
        self.nesting -= 1;
        written
    }

    /// `items`, with `, ` between them.
    #[inline]
    fn list<T>(
        &mut self,
        items: impl Iterator<Item = T>,
        mut write: impl FnMut(&mut Self, T) -> Written,
    ) -> Written {
        for (index, item) in items.enumerate() {
            if index > 0 {
                self.token(", ")?;
            }
            write(self, item)?;
        }
        Ok(())
    }

    /// `items`, each on a line of its own, indented, with a comma after each. The last one has it if `has_last_comma`.
    fn lines<T>(
        &mut self,
        count: usize,
        items: impl Iterator<Item = T>,
        has_last_comma: bool,
        mut write: impl FnMut(&mut Self, T) -> Written,
    ) -> Written {
        self.break_line(1)?;
        for (index, item) in items.enumerate() {
            if index > 0 {
                self.break_line(0)?;
            }
            write(self, item)?;
            if index + 1 < count || has_last_comma {
                self.byte(b',')?;
            }
        }
        self.break_line(-1)
    }

    fn has_trailing_comma(&self, in_arguments: bool) -> bool {
        match self.f.options().trailing_commas {
            TrailingCommas::All => true,
            TrailingCommas::Es5 => !in_arguments,
            TrailingCommas::None => false,
        }
    }
}
