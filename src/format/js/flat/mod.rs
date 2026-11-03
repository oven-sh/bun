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
//!    group breaks first.
//! 5. Everything here is an "or else". What isn't known to be printed in exactly this way is [`Refused`], and the
//!    printers in `print/` write it: comments, text that isn't plain ASCII, syntax that's missing below, and whatever
//!    breaks whether it fits or not (an array of objects, a chain of three calls with a function among the arguments,
//!    two functions as arguments).
//!
//! `bun fmt --no-short-cuts` turns it off, and the tests compare.

mod classes;
mod expressions;
mod functions;
mod holes;
mod signatures;
mod statements;
mod ts_declarations;
mod types;

pub(crate) use statements::write_case_head;
pub(crate) use ts_declarations::{write_enum_member, write_signature};

use crate::ir::element::{FormatElement, LineMode, Tag, Text, TextWidth, Token};
use crate::js::parentheses::expression::{chain_expression_needs_parentheses, needs_parentheses};
use crate::js::print::binary_like_expression::should_flatten;
use crate::js::print::block_statement::is_empty_block;
use crate::js::print::call_like_expression::keeps_arguments_on_one_line;
use crate::js::print::class::write_class_body_after_head;
use crate::js::print::function::FormatFunctionBody;
use crate::js::print::parameters::can_avoid_parentheses;
use crate::js::utils::member_chain::simple_argument::SimpleArgument;
use crate::js::utils::number::format_trimmed_number;
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
}

impl ShortCuts {
    pub(crate) fn for_file(file: &File<'_>, options: &FormatOptions) -> ShortCuts {
        let is_plain_run = !options.no_short_cuts
            && !options.flavor.is_oxfmt()
            && options.semicolons.is_always()
            && !options.experimental_ternaries
            && options.cursor_offset.is_none()
            && options.range_start.is_none()
            && options.range_end.is_none()
            && options.in_html.root == HtmlRoot::None
            && !options.is_in_markdown
            && !options.is_mdx_jsx
            && !options.is_mdx_es_syntax
            && options.html_template_depth == 0
            && options.sort_imports.is_none()
            && options.tailwind.is_none()
            && options.debug_comments == DebugComments::Off
            && !file.is_flow()
            // Every check for a line break below looks for `\n`.
            && !strings::contains_char(file.text(), b'\r');
        ShortCuts {
            mode: if is_plain_run { Mode::All } else { Mode::Off },
            depth: 0,
            is_certain: true,
            next_in_list: 0,
            follows_line: false,
            properties_start_lines: false,
        }
    }
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

/// It isn't certain how the node is printed.
pub(crate) struct Refused;

type Written = Result<(), Refused>;

/// How deep expressions, types and patterns can be nested in a [`Line`]. Anything deeper goes the long way, which asks
/// the stack.
const MAX_NESTING: u32 = 48;

/// What a [`Line`] has written.
#[derive(Copy, Clone)]
enum Part<'a> {
    /// A range of the text buffer, and the width of what follows it on its line. `None` if the text is printed like this
    /// however wide it is.
    Text {
        start: u32,
        len: u32,
        after: Option<u32>,
    },
    /// A line break, after which the indentation is this many levels deeper.
    Break(i8),
    /// The `{ .. }` of a function, with statements in it.
    Body(Func<'a>),
    /// A block.
    Block(Stmt<'a>),
    /// An object or an array that's certain to break.
    Broken(Expr<'a>),
    /// Any expression, on a line of its own.
    Expr(Expr<'a>),
    /// The `{ .. }` of a class, with members in it.
    ClassBody(Class<'a>),
    Hole(holes::Hole<'a>),
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

/// Writes nodes to the end of the formatter's text buffer.
struct Line<'f, 'a> {
    f: &'f mut Formatter<'a>,
    source: &'a [u8],
    /// How many columns there are between the indentation and the end of the line.
    room: usize,
    indent_width: usize,
    /// Where the text of the current line starts in the text buffer.
    start: usize,
    /// Where the text buffer ends. The vector is longer, so that a short text can be copied as a block.
    len: usize,
    /// The `len` at which the line is full.
    limit: usize,
    /// The width of what a part has written on the current line before the text: its closing bracket.
    taken: usize,
    /// The text went past `limit`.
    is_too_wide: bool,
    /// On one line it's too wide, so the outermost group breaks.
    breaks: bool,
    /// There's no comment anywhere in the source of what's written.
    is_quiet: bool,
    /// Up to here the source is known to be plain and without comments.
    checked_to: u32,
    nesting: u32,
    parts: SmallVec<[Part<'a>; 6]>,
}

/// True if `text` has a line with nothing but white space on it.
fn has_empty_line(text: &[u8]) -> bool {
    let mut rest = text;
    while let Some(at) = strings::index_of_char_usize(rest, b'\n') {
        rest = &rest[at + 1..];
        let blank = rest
            .iter()
            .take_while(|byte| matches!(byte, b' ' | b'\t'))
            .count();
        if rest.get(blank) == Some(&b'\n') {
            return true;
        }
    }
    false
}

/// By how much the text buffer is longer than what's written to it while a [`Line`] writes.
const SLACK: usize = 256;

impl<'a> Formatter<'a> {
    /// Calls `write` with a [`Line`] that starts a line of the output, for the node at `span`. `after` is the width of
    /// what the caller writes behind it on the same line. Returns false, with nothing written, if the short cut isn't
    /// taken.
    fn write_line(
        &mut self,
        span: Span,
        after: u32,
        write: impl Fn(&mut Line<'_, 'a>) -> Written,
    ) -> bool {
        let state = self.context().short_cuts;
        if state.mode == Mode::Off {
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
        // A block comment after it is printed on its line.
        let mut rest = source.get(span.end as usize..).unwrap_or_default();
        while let [b' ' | b'\t' | b',' | b';', tail @ ..] = rest {
            rest = tail;
        }
        if rest.starts_with(b"/*") {
            return false;
        }
        // So is one before it, with a blank after it, and the line doesn't start where the indentation ends.
        if matches!(self.storage.pool.last(), Some(FormatElement::Space)) {
            return false;
        }
        let start = self.storage.text.len();
        self.storage.text.resize(start + SLACK, 0);
        let mut line = Line {
            room,
            indent_width,
            start,
            len: start,
            limit: start + room,
            taken: 0,
            is_too_wide: false,
            breaks: false,
            is_quiet: self.is_quiet(),
            f: self,
            source,
            checked_to: span.start,
            nesting: 0,
            parts: SmallVec::new(),
        };
        let mut written = line.finish(&write, span.end, after);
        // That it's too wide is only certain if the indentation is.
        if written.is_err() && line.is_too_wide && state.is_certain {
            line.parts.clear();
            (line.room, line.start, line.len, line.limit) = (room, start, start, start + room);
            (line.taken, line.checked_to, line.nesting) = (0, span.start, 0);
            line.breaks = true;
            written = line.finish(&write, span.end, after);
        }
        let (parts, len) = (line.parts, line.len);
        if written.is_err() {
            self.storage.text.truncate(start);
            return false;
        }
        self.storage.text.truncate(len);
        for part in parts {
            match part {
                Part::Text { start, len, after } => {
                    self.write_element(FormatElement::OwnedText(Text {
                        start,
                        len,
                        width: match after {
                            Some(after) => TextWidth::short_cut(len, after),
                            None => TextWidth::single(len),
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
                Part::Body(func) => {
                    self.context_mut().short_cuts.follows_line = true;
                    FormatFunctionBody(func).fmt(self);
                }
                Part::Block(block) => write!(self, [space(), block]),
                Part::Broken(e) => {
                    // What's in an array isn't counted as a level.
                    self.context_mut().short_cuts.follows_line = e.tag() == ExprTag::Object;
                    e.fmt(self);
                    self.context_mut().short_cuts.follows_line = false;
                }
                Part::Expr(e) => CertainIf(false, &e).fmt(self),
                Part::ClassBody(class) => write_class_body_after_head(class, self),
                Part::Hole(hole) => hole.write(self),
            }
        }
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
    f.write_line(statement.span(), 0, |line| line.statement(statement))
}

/// Writes `property` of an object whose properties are each on a line. A comma can follow it.
pub(crate) fn write_property<'a>(property: Prop<'a>, f: &mut Formatter<'a>) -> bool {
    f.write_line(property.span(), 1, |line| line.property(property, true))
}

/// Writes `member` of a class. The caller writes the `;` of a property.
pub(crate) fn write_class_member<'a>(member: Member<'a>, f: &mut Formatter<'a>) -> bool {
    let after = u32::from(member.kind() == MemberKind::Property);
    f.write_line(member.span(), after, |line| line.class_member(member))
}

impl<'a> Line<'_, 'a> {
    fn finish(&mut self, write: &impl Fn(&mut Self) -> Written, end: u32, after: u32) -> Written {
        write(self)?;
        self.check_source_up_to(end)?;
        self.end_text(Some(after))
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
            if let Some(next) = (self.f.storage.text)
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
        let len = self.f.storage.text.len();
        self.f.storage.text.resize(len + 4 * SLACK, 0);
    }

    #[inline(never)]
    fn long_bytes(&mut self, text: &[u8]) -> Written {
        let end = self.len + text.len();
        if end > self.limit {
            self.is_too_wide = true;
            return Err(Refused);
        }
        if self.f.storage.text.len() < end + SLACK {
            self.f.storage.text.resize(end + SLACK, 0);
        }
        if let Some(next) = self.f.storage.text.get_mut(self.len..end) {
            next.copy_from_slice(text);
        }
        self.len = end;
        Ok(())
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
        let source = self.source;
        if span.len() <= 16
            && let Some(block) = source
                .get(span.start as usize..)
                .and_then(|rest| rest.first_chunk::<16>())
        {
            return self.chunk(block, span.len() as usize);
        }
        self.long_bytes(source.get(span.range()).ok_or(Refused)?)
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
        let is_fine = self.f.is_plain_source(span)
            && (self.is_quiet || !self.f.comments().has_comment_or_owner_in(span))
            && !has_empty_line(self.text_of(span));
        match is_fine {
            true => Ok(()),
            false => Err(Refused),
        }
    }

    /// Ends the text of the current line, which `after` more columns follow.
    fn end_text(&mut self, after: Option<u32>) -> Written {
        let len = self.len - self.start;
        let after = after.filter(|_| self.limit != usize::MAX);
        if let Some(after) = after
            && len + self.taken + after as usize > self.room
        {
            self.is_too_wide = true;
            return Err(Refused);
        }
        if len > 0 {
            self.parts.push(Part::Text {
                start: self.start as u32,
                len: len as u32,
                after,
            });
        }
        self.start = self.len;
        Ok(())
    }

    /// Starts a line after a part, of which `taken` columns are on it.
    fn start_line(&mut self, taken: usize) {
        self.taken = taken;
        self.start = self.len;
        self.limit = self.start + self.room.saturating_sub(taken);
    }

    /// Ends the line with `part`, whose source is at `span` and which starts with `after` columns of text on this line.
    /// What's written next follows its closing bracket, on a line that starts where this line starts.
    fn end_line_with(&mut self, part: Part<'a>, span: Span, after: u32) -> Written {
        self.check_source_up_to(span.start)?;
        // That it's too wide on one line has been found by counting its bytes.
        if self.breaks
            && matches!(part, Part::Broken(_) | Part::Hole(_))
            && !self.f.is_plain_source(span)
        {
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

    /// Writes `e` on a line of its own, before a comma: on one line if that fits, else the long way.
    fn expr_on_own_line(&mut self, e: Expr<'a>) -> Written {
        let span = e.outer_span();
        self.check_source_up_to(span.start)?;
        let (len, parts) = (self.len, self.parts.len());
        let (breaks, limit) = (self.breaks, self.limit);
        (self.breaks, self.limit) = (false, limit.saturating_sub(1));
        let written = self
            .expr(e, Place::Free)
            .and_then(|()| self.check_source_up_to(span.end));
        (self.breaks, self.limit) = (breaks, limit);
        if written.is_ok() {
            return Ok(());
        }
        // Nothing of it has been handed to a part. That all of this is too wide has been found by counting its bytes.
        if self.parts.len() != parts || !self.f.is_plain_source(span) {
            return Err(Refused);
        }
        self.len = len;
        self.end_text(None)?;
        self.parts.push(Part::Expr(e));
        self.checked_to = span.end;
        // How wide its last line is isn't known, and nothing but a comma follows.
        self.start_line(0);
        self.limit = usize::MAX;
        Ok(())
    }

    fn has_trailing_comma(&self, in_arguments: bool) -> bool {
        match self.f.options().trailing_commas {
            TrailingCommas::All => true,
            TrailingCommas::Es5 => !in_arguments,
            TrailingCommas::None => false,
        }
    }
}
