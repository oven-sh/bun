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

use super::parentheses::expression::{chain_expression_needs_parentheses, needs_parentheses};
use super::print::binary_like_expression::should_flatten;
use super::print::block_statement::is_empty_block;
use super::print::call_like_expression::keeps_arguments_on_one_line;
use super::print::class::write_class_body_after_head;
use super::print::function::FormatFunctionBody;
use super::print::parameters::can_avoid_parentheses;
use super::utils::member_chain::simple_argument::SimpleArgument;
use super::utils::number::format_trimmed_number;
use crate::ir::element::{FormatElement, LineMode, Tag, Text, TextWidth, Token};
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
                    self.context_mut().short_cuts.follows_line = true;
                    e.fmt(self);
                    self.context_mut().short_cuts.follows_line = false;
                }
                Part::Expr(e) => CertainIf(false, &e).fmt(self),
                Part::ClassBody(class) => write_class_body_after_head(class, self),
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
    f.write_line(member.span(), 1, |line| line.class_member(member))
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
        // Nothing of it has been handed to a part.
        if self.parts.len() != parts {
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

    // ───────────────────────────── statements ─────────────────────────────

    fn statement(&mut self, statement: Stmt<'a>) -> Written {
        match statement.kind() {
            StmtKind::Expr(expression) => {
                // A directive, or a string in parentheses that would be one without them.
                if expression.tag() == ExprTag::String {
                    return Err(Refused);
                }
                self.last_expr(expression, Place::Other)?;
            }
            StmtKind::Var(declarations) => {
                let (Some(declarator), 1) = (declarations.first(), declarations.len()) else {
                    return Err(Refused);
                };
                self.declaration_modifiers(statement)?;
                self.var_kind(declarator)?;
                self.pattern(declarator.pat())?;
                if declarator.is_definite() {
                    self.byte(b'!')?;
                }
                self.type_annotation(declarator.ty())?;
                if let Some(init) = declarator.init() {
                    self.token(" = ")?;
                    // A pattern breaks together with what it's assigned.
                    match declarator.pat().tag() {
                        PatTag::Ident => self.last_assigned(init)?,
                        _ => self.assigned(init)?,
                    }
                }
            }
            StmtKind::Return(argument) => {
                self.token("return")?;
                if let Some(argument) = argument {
                    self.byte(b' ')?;
                    self.last_expr(argument, Place::Other)?;
                }
            }
            StmtKind::Throw(argument) => {
                self.token("throw ")?;
                self.last_expr(argument, Place::Other)?;
            }
            StmtKind::Break(_) | StmtKind::Continue(_) => {
                self.token(match statement.tag() {
                    StmtTag::Break => "break",
                    _ => "continue",
                })?;
                if let Some(label) = statement.label() {
                    self.byte(b' ')?;
                    self.source(label.span())?;
                }
            }
            StmtKind::Debugger => self.token("debugger")?,
            StmtKind::Fn(func) => {
                self.declaration_modifiers(statement)?;
                self.function(func, true)?;
                if func.has_body() {
                    return Ok(());
                }
            }
            StmtKind::Class(class) => {
                self.declaration_modifiers(statement)?;
                return self.class(class);
            }
            StmtKind::If { .. } => return self.if_statement(statement),
            StmtKind::While { test, body } => {
                self.token("while (")?;
                self.expr(test, Place::Other)?;
                self.byte(b')')?;
                return self.block(body);
            }
            StmtKind::ForOf {
                left,
                expr,
                body,
                is_await,
            } => {
                self.token(match is_await {
                    true => "for await (",
                    false => "for (",
                })?;
                self.for_binding(left)?;
                self.token(" of ")?;
                self.expr(expr, Place::Other)?;
                self.byte(b')')?;
                return self.block(body);
            }
            StmtKind::ForIn { left, expr, body } => {
                self.token("for (")?;
                self.for_binding(left)?;
                self.token(" in ")?;
                self.expr(expr, Place::Other)?;
                self.byte(b')')?;
                return self.block(body);
            }
            StmtKind::Try {
                block,
                param,
                handler,
                finalizer,
            } => {
                self.token("try")?;
                self.block(block)?;
                if let Some(handler) = handler {
                    self.token(" catch")?;
                    if let Some(param) = param {
                        self.token(" (")?;
                        self.pattern(param.pat())?;
                        self.type_annotation(param.ty())?;
                        self.byte(b')')?;
                    }
                    self.block(handler)?;
                }
                if let Some(finalizer) = finalizer {
                    self.token(" finally")?;
                    self.block(finalizer)?;
                }
                return Ok(());
            }
            StmtKind::Import(import) => self.import(statement, import)?,
            StmtKind::ExportNamed(export) => self.export_named(statement, export)?,
            StmtKind::ExportDefault(expression) => {
                // A function or a class gets no semicolon.
                if matches!(expression.tag(), ExprTag::Fn | ExprTag::Class) {
                    return Err(Refused);
                }
                self.token("export default ")?;
                self.last_expr(expression, Place::Other)?;
            }
            StmtKind::TypeAlias(alias) => {
                self.declaration_modifiers(statement)?;
                self.token("type ")?;
                self.source(alias.name().span())?;
                self.type_parameters(alias.type_params())?;
                self.token(" = ")?;
                self.ty(alias.ty())?;
            }
            _ => return Err(Refused),
        }
        self.byte(b';')
    }

    fn var_kind(&mut self, declarator: VarDecl<'a>) -> Written {
        self.token(match declarator.var_kind() {
            VarKind::Var => "var ",
            VarKind::Let => "let ",
            VarKind::Const => "const ",
            VarKind::Using | VarKind::AwaitUsing => return Err(Refused),
        })
    }

    /// `export default declare abstract `, in this order.
    fn declaration_modifiers(&mut self, statement: Stmt<'a>) -> Written {
        let mut rank = 0;
        for modifier in statement.modifiers() {
            let flag = modifier.flag();
            let (next, keyword) = if flag == Flags::EXPORT {
                (1, "export ")
            } else if flag == Flags::DEFAULT {
                (2, "default ")
            } else if flag == Flags::AMBIENT {
                (3, "declare ")
            } else if flag == Flags::ABSTRACT {
                (4, "abstract ")
            } else if flag == Flags::ASYNC {
                // The function writes it.
                (5, "")
            } else {
                return Err(Refused);
            };
            if next <= rank || modifier.decorator().is_some() {
                return Err(Refused);
            }
            rank = next;
            self.token(keyword)?;
        }
        Ok(())
    }

    /// ` {`, and the rest of the block `body`, which has statements in it.
    fn block(&mut self, body: Stmt<'a>) -> Written {
        match body.as_block() {
            Some(statements) if !is_empty_block(statements) => {
                self.end_line_with(Part::Block(body), body.span(), 2)
            }
            _ => Err(Refused),
        }
    }

    fn if_statement(&mut self, mut statement: Stmt<'a>) -> Written {
        loop {
            let Some((test, yes, no)) = statement.as_if() else {
                return Err(Refused);
            };
            self.token("if (")?;
            self.expr(test, Place::Other)?;
            self.byte(b')')?;
            self.block(yes)?;
            let Some(no) = no else {
                return Ok(());
            };
            self.token(" else")?;
            if no.tag() != StmtTag::If {
                return self.block(no);
            }
            self.byte(b' ')?;
            statement = no;
        }
    }

    /// `const a`, in the head of a loop.
    fn for_binding(&mut self, left: Stmt<'a>) -> Written {
        let declarations = left.as_var().ok_or(Refused)?;
        let (Some(declarator), 1) = (declarations.first(), declarations.len()) else {
            return Err(Refused);
        };
        if declarator.init().is_some() || declarator.ty().is_some() {
            return Err(Refused);
        }
        self.var_kind(declarator)?;
        self.pattern(declarator.pat())
    }

    /// `"a"`, where the string isn't an expression.
    fn module_specifier(&mut self, statement: Stmt<'a>) -> Written {
        if statement.import_attributes().is_some() {
            return Err(Refused);
        }
        self.string(statement.module_specifier_span().ok_or(Refused)?)
    }

    fn open_brace(&mut self) -> Written {
        self.token(match self.f.options().bracket_spacing.value() {
            true => "{ ",
            false => "{",
        })
    }

    fn close_brace(&mut self) -> Written {
        self.token(match self.f.options().bracket_spacing.value() {
            true => " }",
            false => "}",
        })
    }

    fn module_export_name(&mut self, name: Ident<'a>) -> Written {
        match name.is_string() {
            true => self.string(name.span()),
            false => self.source(name.span()),
        }
    }

    /// `{ a, b }`, or each on a line if that's too wide.
    fn specifiers<T>(
        &mut self,
        count: usize,
        items: impl Iterator<Item = T>,
        mut write: impl FnMut(&mut Self, T) -> Written,
    ) -> Written {
        if count == 0 {
            return self.token("{}");
        }
        if self.breaks {
            self.byte(b'{')?;
            let has_last_comma = self.has_trailing_comma(false);
            // Nothing in them can break.
            self.lines(count, items, has_last_comma, |line, item| {
                line.limit = usize::MAX;
                write(line, item)
            })?;
            self.limit = usize::MAX;
            return self.byte(b'}');
        }
        self.open_brace()?;
        self.list(items, write)?;
        self.close_brace()
    }

    fn import(&mut self, statement: Stmt<'a>, import: Import<'a>) -> Written {
        if import.phase().is_some() {
            return Err(Refused);
        }
        self.token(match import.is_type_only() {
            true => "import type ",
            false => "import ",
        })?;
        if import.is_side_effect() {
            self.limit = usize::MAX;
            return self.module_specifier(statement);
        }
        let named = import.named();
        let has_braces = import.has_named_imports()
            && !(named.is_empty() && (import.default().is_some() || import.namespace().is_some()));
        let mut is_first = true;
        if let Some(default) = import.default() {
            self.source(default.span())?;
            is_first = false;
        }
        if let Some(namespace) = import.namespace() {
            if !is_first {
                self.token(", ")?;
            }
            self.token("* as ")?;
            self.source(namespace.span())?;
            is_first = false;
        }
        // Without a list of several names there's nowhere to break.
        if !has_braces || named.is_empty() || (named.len() == 1 && is_first) {
            self.limit = usize::MAX;
            self.breaks = false;
        }
        if has_braces {
            if !is_first {
                self.token(", ")?;
            }
            self.specifiers(named.len(), named.iter(), |line, specifier| {
                if specifier.is_type_only() {
                    line.token("type ")?;
                }
                if specifier.is_renamed() {
                    line.module_export_name(specifier.imported())?;
                    line.token(" as ")?;
                }
                line.source(specifier.local().span())
            })?;
        }
        self.token(" from ")?;
        self.module_specifier(statement)
    }

    fn export_named(&mut self, statement: Stmt<'a>, export: Export<'a>) -> Written {
        self.token(match export.is_type_only() {
            true => "export type ",
            false => "export ",
        })?;
        let items = export.items();
        if items.len() <= 1 {
            (self.limit, self.breaks) = (usize::MAX, false);
        }
        self.specifiers(items.len(), items.iter(), |line, specifier| {
            if specifier.is_type_only() {
                line.token("type ")?;
            }
            line.module_export_name(specifier.local())?;
            if specifier.is_renamed() {
                line.token(" as ")?;
                line.module_export_name(specifier.exported())?;
            }
            Ok(())
        })?;
        if export.has_from() {
            self.token(" from ")?;
            self.module_specifier(statement)?;
        }
        Ok(())
    }

    // ───────────────────────────── classes ─────────────────────────────

    /// A class declaration without decorators, which the modifiers have been written of.
    fn class(&mut self, class: Class<'a>) -> Written {
        self.token("class")?;
        if let Some(name) = class.name() {
            self.byte(b' ')?;
            self.source(name.span())?;
        }
        self.type_parameters(class.type_params())?;
        if let Some(extends) = class.extends() {
            self.token(" extends ")?;
            self.expr(extends, Place::Other)?;
            self.type_arguments(class.extends_args())?;
        }
        if !class.implements().is_empty() {
            self.token(" implements ")?;
            self.list(class.implements().iter(), |line, ty| line.ty(ty))?;
        }
        if class.members().is_empty() {
            return Err(Refused);
        }
        if !self.is_quiet {
            let owned = self.f.comments().of_node(AstNodes::ClassBody(class));
            if owned.is_ignored || !owned.leading.is_empty() || !owned.dangling.is_empty() {
                return Err(Refused);
            }
        }
        self.end_line_with(Part::ClassBody(class), class.body_span(), 2)
    }

    /// The modifiers of a member of a class, in the order in which they're printed.
    fn member_modifiers(&mut self, member: Member<'a>, is_method: bool) -> Written {
        let modifiers = member.modifiers();
        if modifiers.is_empty() {
            return Ok(());
        }
        let mut present = Flags::empty();
        for modifier in modifiers {
            if modifier.decorator().is_some() {
                return Err(Refused);
            }
            present |= modifier.flag();
        }
        let known = Flags::PUBLIC
            | Flags::PROTECTED
            | Flags::PRIVATE
            | Flags::STATIC
            | Flags::ABSTRACT
            | Flags::OVERRIDE
            | Flags::ASYNC
            | if is_method {
                Flags::empty()
            } else {
                Flags::AMBIENT | Flags::READONLY
            };
        if !known.contains(present) {
            return Err(Refused);
        }
        for (flag, keyword) in [
            (Flags::AMBIENT, "declare "),
            (Flags::PUBLIC, "public "),
            (Flags::PROTECTED, "protected "),
            (Flags::PRIVATE, "private "),
            (Flags::STATIC, "static "),
            (Flags::ABSTRACT, "abstract "),
            (Flags::OVERRIDE, "override "),
            (Flags::READONLY, "readonly "),
        ] {
            if present.contains(flag) {
                self.token(keyword)?;
            }
        }
        Ok(())
    }

    /// A property or a method of a class. Without the `;` of a property.
    fn class_member(&mut self, member: Member<'a>) -> Written {
        match member.as_ast_nodes() {
            AstNodes::PropertyDefinition(_) => {
                self.member_modifiers(member, false)?;
                self.member_key(member.key())?;
                let flags = member.flags();
                if flags.contains(Flags::OPTIONAL) {
                    self.byte(b'?')?;
                }
                if flags.contains(Flags::DEFINITE) {
                    self.byte(b'!')?;
                }
                self.type_annotation(member.ty())?;
                match member.init() {
                    Some(init) => {
                        self.token(" = ")?;
                        self.last_assigned(init)
                    }
                    None => Ok(()),
                }
            }
            AstNodes::MethodDefinition(_) => {
                let func = member.func().ok_or(Refused)?;
                if !func.has_body() {
                    return Err(Refused);
                }
                self.member_modifiers(member, true)?;
                match member.kind() {
                    MemberKind::Getter => self.token("get ")?,
                    MemberKind::Setter => self.token("set ")?,
                    _ => {}
                }
                if func.is_async() {
                    self.token("async ")?;
                }
                if func.is_generator() {
                    self.byte(b'*')?;
                }
                match member.constructor_keyword() {
                    Some(keyword) if self.text_of(keyword.span()) == b"constructor" => {
                        self.token("constructor")?
                    }
                    Some(_) => return Err(Refused),
                    None => self.member_key(member.key())?,
                }
                if member.flags().contains(Flags::OPTIONAL) {
                    self.byte(b'?')?;
                }
                self.signature(func)?;
                self.body(func, true)
            }
            _ => Err(Refused),
        }
    }

    /// The name of a member of a class: a plain or a private name.
    fn member_key(&mut self, key: Option<Key<'a>>) -> Written {
        let key = key.ok_or(Refused)?;
        if !matches!(key.kind(), KeyKind::Ident(_) | KeyKind::Private(_))
            || self.f.options().quote_properties.is_consistent()
        {
            return Err(Refused);
        }
        let span = key.span(self.f.file());
        self.source(span)
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// The right side of `=` or `:`.
    fn assigned(&mut self, value: Expr<'a>) -> Written {
        // `a = b = c` has a layout of its own.
        if value.tag() == ExprTag::Assign {
            return Err(Refused);
        }
        self.expr(value, Place::Free)
    }

    /// The right side of `=` or `:`, with nothing but closing brackets after it.
    fn last_assigned(&mut self, value: Expr<'a>) -> Written {
        match value.tag() {
            ExprTag::Assign => Err(Refused),
            // Where a call that's too wide breaks depends on what it's assigned to.
            ExprTag::Call | ExprTag::New | ExprTag::Await if self.breaks => Err(Refused),
            _ => self.last_expr(value, Place::Free),
        }
    }

    /// An expression with nothing but closing brackets after it, so that it can end the line.
    fn last_expr(&mut self, e: Expr<'a>, place: Place) -> Written {
        let tag = e.tag();
        if !matches!(
            tag,
            ExprTag::Fn
                | ExprTag::Object
                | ExprTag::Array
                | ExprTag::Call
                | ExprTag::New
                | ExprTag::Await
                | ExprTag::Assign
        ) || (place != Place::Free && needs_parentheses(e, self.f))
            || (tag == ExprTag::Call && e.is_chain_root())
        {
            return self.expr(e, place);
        }
        self.nested(|line| match tag {
            ExprTag::Fn => line.function(e.as_fn().ok_or(Refused)?, true),
            ExprTag::Object => line.object(e, true),
            ExprTag::Array => line.array(e, true),
            ExprTag::Call => line.call(e, true),
            ExprTag::New => line.new_expression(e, true),
            ExprTag::Await => {
                line.token("await ")?;
                line.last_expr(e.operand().ok_or(Refused)?, Place::Other)
            }
            _ => line.assignment(e, true),
        })
    }

    fn new_expression(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let call = e.as_new().ok_or(Refused)?;
        self.token("new ")?;
        self.expr(call.callee(), Place::Other)?;
        self.type_arguments(call.type_args())?;
        self.arguments(call.args(), is_last, false)
    }

    fn call(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let call = e.as_call().ok_or(Refused)?;
        let callee = call.callee();
        let mut is_plain_callee = true;
        if matches!(callee.tag(), ExprTag::Dot | ExprTag::Index) {
            is_plain_callee = self.check_member_chain(e)?;
        } else if callee.tag() == ExprTag::Ident {
            // `graphql(schema, `..`)` has another language in it.
            if callee.span().len() == 7 && self.text_of(callee.span()) == b"graphql" {
                return Err(Refused);
            }
        } else {
            is_plain_callee = false;
        }
        // The arguments of a test, of `require` and the like stay on one line however long they are.
        if self.breaks && keeps_arguments_on_one_line(e, call, self.f) {
            // Only where nothing in them can break either: `it("name", (done) => {`
            let args = call.args();
            let is_unbreakable = is_last
                && callee.tag() == ExprTag::Ident
                && args.len() == 2
                && args.first().is_some_and(|it| it.tag() == ExprTag::String)
                && (args.last().filter(|it| self.ends_line(*it)))
                    .and_then(Expr::as_fn)
                    .is_some_and(|func| {
                        func.return_type().is_none()
                            && func.type_params().is_empty()
                            && func.params().iter().all(|param| {
                                param.pat().tag() == PatTag::Ident
                                    && param.ty().is_none()
                                    && param.default().is_none()
                            })
                    });
            if !is_unbreakable {
                return Err(Refused);
            }
            (self.limit, self.breaks) = (usize::MAX, false);
        }
        self.expr(callee, Place::Object)?;
        if call.is_optional() {
            self.token("?.")?;
        }
        self.type_arguments(call.type_args())?;
        self.arguments(call.args(), is_last && is_plain_callee, is_plain_callee)
    }

    fn assignment(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let (op, target, value) = e.as_assign().ok_or(Refused)?;
        if matches!(target.tag(), ExprTag::Object | ExprTag::Array)
            || !matches!(e.as_chain_element(), AstNodes::AssignmentExpression(_))
        {
            return Err(Refused);
        }
        self.expr(target, Place::Other)?;
        self.byte(b' ')?;
        self.token(assign_op_text(op))?;
        self.byte(b' ')?;
        match is_last {
            true => self.last_assigned(value),
            false => self.assigned(value),
        }
    }

    fn expr(&mut self, e: Expr<'a>, place: Place) -> Written {
        let tag = e.tag();
        match tag {
            ExprTag::Ident => {
                let span = e.span();
                // `let`, `async`, `await` and the like can need parentheses.
                if place != Place::Free
                    && (3..=9).contains(&span.len())
                    && needs_parentheses(e, self.f)
                {
                    return Err(Refused);
                }
                return self.source(span);
            }
            ExprTag::This => return self.token("this"),
            ExprTag::Null => return self.token("null"),
            ExprTag::True => return self.token("true"),
            ExprTag::False => return self.token("false"),
            ExprTag::Super => return self.token("super"),
            ExprTag::String => return self.string(e.span()),
            _ => {}
        }
        let is_link = matches!(
            tag,
            ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull
        );
        let has_parentheses = match place {
            Place::Free => tag == ExprTag::Assign && needs_parentheses(e, self.f),
            Place::Object if is_link => {
                if e.is_chain_root() {
                    return Err(Refused);
                }
                false
            }
            _ => {
                let has_parentheses = needs_parentheses(e, self.f);
                if is_link
                    && e.is_chain_root()
                    && (has_parentheses || chain_expression_needs_parentheses(e, self.f))
                {
                    return Err(Refused);
                }
                has_parentheses
            }
        };
        if has_parentheses {
            self.byte(b'(')?;
        }
        self.nested(|line| line.expr_of(tag, e))?;
        if has_parentheses {
            self.byte(b')')?;
        }
        Ok(())
    }

    /// `e`, whose tag is `tag`, without parentheses.
    fn expr_of(&mut self, tag: ExprTag, e: Expr<'a>) -> Written {
        match tag {
            ExprTag::Dot => {
                let (obj, name, chain) = e.as_dot().ok_or(Refused)?;
                self.expr(obj, Place::Object)?;
                self.token(match chain {
                    Chain::Start => "?.",
                    _ => ".",
                })?;
                self.source(name.span())
            }
            ExprTag::Call => self.call(e, false),
            ExprTag::Number => {
                let printed = format_trimmed_number(self.text_of(e.span()));
                self.long_bytes(&printed)
            }
            ExprTag::Index => {
                let (obj, index, chain) = e.as_index().ok_or(Refused)?;
                self.expr(obj, Place::Object)?;
                self.token(match chain {
                    Chain::Start => "?.[",
                    _ => "[",
                })?;
                self.expr(index, Place::Free)?;
                self.byte(b']')
            }
            ExprTag::New => self.new_expression(e, false),
            ExprTag::Unary => {
                let (op, operand) = e.as_unary().ok_or(Refused)?;
                if op.is_update() && !op.is_prefix() {
                    self.expr(operand, Place::Other)?;
                    return self.token(op.as_str());
                }
                self.token(op.as_str())?;
                if op.is_keyword() {
                    self.byte(b' ')?;
                }
                self.expr(operand, Place::Other)
            }
            ExprTag::Binary => {
                let (op, left, right) = e.as_binary().ok_or(Refused)?;
                // `a && (b && c)` loses its parentheses.
                if op == BinOp::Comma || right.binary_op() == Some(op) {
                    return Err(Refused);
                }
                match left.binary_op() {
                    // One chain, without the parentheses that `(a | b) | c` would get otherwise.
                    Some(left_op) if left_op != BinOp::Comma && should_flatten(op, left_op) => {
                        self.nested(|line| line.expr_of(ExprTag::Binary, left))?
                    }
                    _ => self.expr(left, Place::Other)?,
                }
                self.byte(b' ')?;
                self.token(bin_op_text(op))?;
                self.byte(b' ')?;
                self.expr(right, Place::Other)
            }
            ExprTag::Assign => self.assignment(e, false),
            ExprTag::Cond => {
                let (test, yes, no) = e.as_cond().ok_or(Refused)?;
                self.expr(test, Place::Other)?;
                self.token(" ? ")?;
                match yes.tag() {
                    ExprTag::Cond => {
                        self.byte(b'(')?;
                        self.expr(yes, Place::Other)?;
                        self.byte(b')')?;
                    }
                    _ => self.expr(yes, Place::Other)?,
                }
                self.token(" : ")?;
                self.expr(no, Place::Other)
            }
            ExprTag::Array => self.array(e, false),
            ExprTag::Object => self.object(e, false),
            ExprTag::Fn => self.function(e.as_fn().ok_or(Refused)?, false),
            ExprTag::Template => self.template(e),
            _ => self.less_common_expr(e),
        }
    }

    #[inline(never)]
    fn less_common_expr(&mut self, e: Expr<'a>) -> Written {
        match e.kind() {
            ExprKind::Spread(argument) => {
                if e.jsx_container_span().is_some() {
                    return Err(Refused);
                }
                self.token("...")?;
                self.expr(argument, Place::Other)
            }
            ExprKind::Await(argument) => {
                self.token("await ")?;
                self.expr(argument, Place::Other)
            }
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                if e.is_angle_bracket_assertion() {
                    return Err(Refused);
                }
                self.expr(expr, Place::Other)?;
                self.token(match e.tag() {
                    ExprTag::Satisfies => " satisfies ",
                    _ => " as ",
                })?;
                self.ty(ty)
            }
            ExprKind::AsConst(expr) => {
                if e.is_angle_bracket_assertion() {
                    return Err(Refused);
                }
                self.expr(expr, Place::Other)?;
                self.token(" as const")
            }
            ExprKind::NonNull(expr) => {
                if e.non_null_count() != 1 {
                    return Err(Refused);
                }
                self.expr(expr, Place::Object)?;
                self.byte(b'!')
            }
            ExprKind::Regex(regex) if regex.flags().is_sorted() => {
                let text = self.text_of(e.span());
                match text.iter().all(|byte| *byte >= b' ') {
                    true => self.long_bytes(text),
                    false => Err(Refused),
                }
            }
            _ => Err(Refused),
        }
    }

    /// A string literal at `span`, with the quotes of the options. The text has no backslash.
    fn string(&mut self, span: Span) -> Written {
        let text = self.text_of(span);
        let [first @ (b'"' | b'\''), content @ .., last] = text else {
            return Err(Refused);
        };
        if first != last {
            return Err(Refused);
        }
        let preferred = self.f.options().quote_style.as_byte();
        // A tab has no width. A string with the preferred quote in it keeps the other one.
        let (mut has_preferred, mut has_odd) = (false, false);
        for &byte in content {
            has_preferred |= byte == preferred;
            has_odd |= byte < b' ';
        }
        if has_odd {
            return Err(Refused);
        }
        if *first == preferred || has_preferred {
            return self.source(span);
        }
        self.byte(preferred)?;
        self.source(span.shrink(1, 1))?;
        self.byte(preferred)
    }

    /// A template on one line that's in no other language: not a property's value, an element or tagged.
    fn template(&mut self, e: Expr<'a>) -> Written {
        let template = e.as_template().ok_or(Refused)?;
        if !self.text_of(e.span()).iter().all(|byte| *byte >= b' ') {
            return Err(Refused);
        }
        let expressions = template.exprs();
        self.byte(b'`')?;
        for i in 0..template.quasi_count() {
            self.long_bytes(template.raw(i))?;
            if let Some(expression) = expressions.get(i) {
                self.token("${")?;
                self.expr(expression, Place::Other)?;
                self.byte(b'}')?;
            }
        }
        self.byte(b'`')
    }

    /// Looks at the chain that the call `e`, whose callee is a member access, ends. A chain with more than two calls
    /// breaks if an argument isn't simple, whether it fits or not. Returns true if the last call can end the line.
    fn check_member_chain(&mut self, e: Expr<'a>) -> Result<bool, Refused> {
        let mut calls = 0;
        let mut has_function = false;
        let mut link = e;
        loop {
            link = match link.tag() {
                ExprTag::Call => {
                    let call = link.as_call().ok_or(Refused)?;
                    if calls > 0 {
                        has_function |= call.args().iter().any(|it| it.tag() == ExprTag::Fn);
                    }
                    calls += 1;
                    call.callee()
                }
                ExprTag::Dot | ExprTag::Index => link.object().ok_or(Refused)?,
                ExprTag::NonNull => link.operand().ok_or(Refused)?,
                _ => break,
            };
        }
        if calls <= 2 {
            // A chain breaks if its last call does and an earlier one has a function among its arguments. Where a chain
            // that's too wide breaks is another matter, unless all that's before the last `(` is names.
            return Ok(match self.breaks {
                true => calls == 1 && matches!(link.tag(), ExprTag::Ident | ExprTag::This),
                false => calls == 1 || !has_function,
            });
        }
        let mut link = e;
        loop {
            link = match link.tag() {
                ExprTag::Call => {
                    let call = link.as_call().ok_or(Refused)?;
                    let f = &*self.f;
                    if !(call.args().iter()).all(|it| SimpleArgument::new(it, f).is_simple()) {
                        return Err(Refused);
                    }
                    call.callee()
                }
                ExprTag::Dot | ExprTag::Index => link.object().ok_or(Refused)?,
                ExprTag::NonNull => link.operand().ok_or(Refused)?,
                _ => return Ok(false),
            };
        }
    }

    /// True if `argument` is certain to break, and is hugged as the last argument of a call.
    fn ends_line(&self, argument: Expr<'a>) -> bool {
        match argument.tag() {
            ExprTag::Fn => (argument.as_fn())
                .and_then(Func::body_statements)
                .is_some_and(|statements| !is_empty_block(statements)),
            ExprTag::Object => self.is_broken_object(argument),
            _ => false,
        }
    }

    /// True if the object `e` is certain to break: its first key is on a new line, or all of this is too wide.
    fn is_broken_object(&self, e: Expr<'a>) -> bool {
        (e.as_object().and_then(List::first)).is_some_and(|first| {
            self.breaks
                || (self.f.options().expand == Expand::Auto
                    && self.has_line_break_in(Span::new(e.span().start, first.span().start)))
        })
    }

    /// `is_last`: nothing but closing brackets follows. `can_break`: nothing before the `(` can break.
    fn arguments(&mut self, args: List<'a, Expr<'a>>, is_last: bool, can_break: bool) -> Written {
        self.byte(b'(')?;
        let count = args.len();
        if count > 1 {
            self.check_composition(args)?;
        }
        if is_last && let Some(last) = args.last() {
            if self.ends_line(last) {
                // Two arguments of the same kind aren't hugged.
                if count > 1
                    && (args.get(count - 2)).is_some_and(|it| {
                        it.tag() == last.tag() || matches!(it.tag(), ExprTag::Fn | ExprTag::Cond)
                    })
                {
                    return Err(Refused);
                }
                for argument in args.iter().take(count - 1) {
                    self.expr(argument, Place::Free)?;
                    self.token(", ")?;
                }
                self.last_expr(last, Place::Free)?;
                return self.byte(b')');
            }
            // Too wide, and no argument is hugged: each is on a line.
            if self.breaks
                && can_break
                && !args.iter().any(|it| {
                    matches!(
                        it.tag(),
                        ExprTag::Fn
                            | ExprTag::Object
                            | ExprTag::Array
                            | ExprTag::As
                            | ExprTag::AsConst
                            | ExprTag::Satisfies
                            | ExprTag::Template
                            | ExprTag::TaggedTemplate
                            | ExprTag::Spread
                            | ExprTag::Jsx
                    )
                })
            {
                let has_last_comma = self.has_trailing_comma(true);
                self.lines(count, args.iter(), has_last_comma, |line, argument| {
                    line.expr_on_own_line(argument)
                })?;
                return self.byte(b')');
            }
        }
        self.list(args.iter(), |line, argument| {
            line.expr(argument, Place::Free)
        })?;
        self.byte(b')')
    }

    /// Several functions among the arguments, or in the arguments of an argument, are each on a line.
    fn check_composition(&mut self, args: List<'a, Expr<'a>>) -> Written {
        let mut functions = 0;
        for argument in args {
            match argument.tag() {
                ExprTag::Fn => functions += 1,
                ExprTag::Call | ExprTag::NonNull => {
                    let mut inner = argument;
                    while inner.tag() == ExprTag::NonNull {
                        inner = inner.operand().ok_or(Refused)?;
                    }
                    if inner
                        .as_call()
                        .is_some_and(|call| call.args().iter().any(|it| it.tag() == ExprTag::Fn))
                    {
                        return Err(Refused);
                    }
                }
                _ => {}
            }
        }
        match functions > 1 {
            true => Err(Refused),
            false => Ok(()),
        }
    }

    fn array(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let elements = e.as_array().ok_or(Refused)?;
        if e.is_assignment_target() {
            return Err(Refused);
        }
        if is_last && self.breaks && !elements.is_empty() {
            return self.end_line_with(Part::Broken(e), e.span(), 1);
        }
        // Several objects, or several arrays, are each on a line.
        if elements.len() > 1
            && elements
                .first()
                .is_some_and(|it| matches!(it.tag(), ExprTag::Object | ExprTag::Array))
        {
            return Err(Refused);
        }
        self.byte(b'[')?;
        self.list(elements.iter(), |line, element| match element.tag() {
            ExprTag::Missing | ExprTag::Template => Err(Refused),
            _ => line.expr(element, Place::Free),
        })?;
        self.byte(b']')
    }

    fn object(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let props = e.as_object().ok_or(Refused)?;
        if e.is_assignment_target() {
            return Err(Refused);
        }
        if props.is_empty() {
            return self.token("{}");
        }
        if self.is_broken_object(e) {
            return match is_last {
                true => self.end_line_with(Part::Broken(e), e.span(), 1),
                false => Err(Refused),
            };
        }
        self.open_brace()?;
        self.list(props.iter(), |line, prop| line.property(prop, false))?;
        self.close_brace()
    }

    /// A key that's a plain name. Whether another kind of key gets or loses quotes depends on the other keys.
    fn key(&mut self, key: Option<Key<'a>>) -> Written {
        let key = key.ok_or(Refused)?;
        if !matches!(key.kind(), KeyKind::Ident(_))
            || self.f.options().quote_properties.is_consistent()
        {
            return Err(Refused);
        }
        let span = key.span(self.f.file());
        self.source(span)
    }

    fn property(&mut self, prop: Prop<'a>, is_last: bool) -> Written {
        if !prop.modifiers().is_empty() && prop.func().is_none() {
            return Err(Refused);
        }
        match prop.kind() {
            PropKind::Init => {
                self.key(prop.key())?;
                self.token(": ")?;
                let value = prop.value().ok_or(Refused)?;
                match (value.tag(), is_last) {
                    // It can be in another language.
                    (ExprTag::Template, _) => Err(Refused),
                    (_, true) => self.last_assigned(value),
                    (_, false) => self.assigned(value),
                }
            }
            PropKind::Shorthand => match prop.value() {
                Some(value) if value.tag() == ExprTag::Ident => self.source(value.span()),
                _ => Err(Refused),
            },
            PropKind::Spread => {
                self.token("...")?;
                self.expr(prop.value().ok_or(Refused)?, Place::Other)
            }
            kind @ (PropKind::Method | PropKind::Getter | PropKind::Setter) => {
                let func = prop.func().ok_or(Refused)?;
                if prop.is_optional() {
                    return Err(Refused);
                }
                match kind {
                    PropKind::Getter => self.token("get ")?,
                    PropKind::Setter => self.token("set ")?,
                    _ => {}
                }
                if func.is_async() {
                    self.token("async ")?;
                }
                if func.is_generator() {
                    self.byte(b'*')?;
                }
                self.key(prop.key())?;
                self.signature(func)?;
                self.body(func, is_last)
            }
        }
    }

    /// `<T>(a: A): B`
    fn signature(&mut self, func: Func<'a>) -> Written {
        self.type_parameters(func.type_params())?;
        self.parameters(func)?;
        self.type_annotation(func.return_type())
    }

    /// A function. Unless `is_last`, the body of an arrow function is an expression or empty, and that of any other
    /// function is empty.
    fn function(&mut self, func: Func<'a>, is_last: bool) -> Written {
        if func.is_async() {
            self.token("async ")?;
        }
        if !func.is_arrow() {
            self.token(match func.is_generator() {
                true => "function* ",
                false => "function ",
            })?;
            if let Some(name) = func.name() {
                self.source(name.span())?;
            }
            self.signature(func)?;
            return match func.has_body() {
                true => self.body(func, is_last),
                false => Ok(()),
            };
        }
        if !func.type_params().is_empty() {
            return Err(Refused);
        }
        match can_avoid_parentheses(func, self.f) {
            true => self.pattern(func.params().first().ok_or(Refused)?.pat())?,
            false => self.parameters(func)?,
        }
        self.type_annotation(func.return_type())?;
        self.token(" =>")?;
        let FnBody::Expr(body) = func.body() else {
            return self.body(func, is_last);
        };
        self.byte(b' ')?;
        match body.tag() {
            // A chain of arrow functions has a layout of its own.
            ExprTag::Fn => Err(Refused),
            ExprTag::Binary if body.binary_op() == Some(BinOp::Comma) => Err(Refused),
            // In parentheses, unless it breaks or starts with an object.
            ExprTag::Cond if matches!(self.text_of(body.span()), [b'(' | b'{', ..]) => Err(Refused),
            ExprTag::Cond => {
                self.byte(b'(')?;
                self.expr(body, Place::Other)?;
                self.byte(b')')
            }
            _ => self.expr(body, Place::Other),
        }
    }

    /// ` {}`, or ` {` and the rest of the body if it can end the line.
    fn body(&mut self, func: Func<'a>, is_last: bool) -> Written {
        let (Some(statements), Some(span)) = (func.body_statements(), func.body_span()) else {
            return Err(Refused);
        };
        if statements.is_empty() {
            return self.token(" {}");
        }
        if !is_last || is_empty_block(statements) {
            return Err(Refused);
        }
        if !self.is_quiet {
            let owned = self.f.comments().of_node(AstNodes::FunctionBody(func));
            if owned.is_ignored || !owned.leading.is_empty() || !owned.dangling.is_empty() {
                return Err(Refused);
            }
        }
        self.end_line_with(Part::Body(func), span, 2)
    }

    // ───────────────────────────── patterns and parameters ─────────────────────────────

    fn default_value(&mut self, default: Option<Expr<'a>>) -> Written {
        match default {
            Some(default) => {
                self.token(" = ")?;
                self.expr(default, Place::Other)
            }
            None => Ok(()),
        }
    }

    fn pattern(&mut self, pattern: Pat<'a>) -> Written {
        match pattern.kind() {
            PatKind::Ident(_) => self.source(pattern.span()),
            PatKind::Object(props) => {
                let Some(first) = props.first() else {
                    return self.token("{}");
                };
                // Like an object, it stays broken if it's written that way.
                if self.has_line_break_in(Span::new(pattern.span().start, first.span().start)) {
                    return Err(Refused);
                }
                self.open_brace()?;
                self.nested(|line| {
                    line.list(props.iter(), |line, prop| {
                        if prop.is_rest() {
                            line.token("...")?;
                            return line.pattern(prop.value());
                        }
                        // A pattern in a pattern can force a line break.
                        if prop.value().tag() != PatTag::Ident {
                            return Err(Refused);
                        }
                        if !prop.is_shorthand() {
                            line.key(prop.key())?;
                            line.token(": ")?;
                        }
                        line.source(prop.value().span())?;
                        line.default_value(prop.default())
                    })
                })?;
                self.close_brace()
            }
            PatKind::Array(elements) => {
                self.byte(b'[')?;
                self.nested(|line| {
                    line.list(elements.iter(), |line, element| {
                        let pattern = element.pat().ok_or(Refused)?;
                        if element.is_rest() {
                            line.token("...")?;
                        }
                        line.pattern(pattern)?;
                        line.default_value(element.default())
                    })
                })?;
                self.byte(b']')
            }
            PatKind::Missing => Err(Refused),
        }
    }

    /// `(a, b: T, c = 1, ...d)`
    fn parameters(&mut self, func: Func<'a>) -> Written {
        if func.this_param().is_some() {
            return Err(Refused);
        }
        self.byte(b'(')?;
        self.list(func.params().iter(), |line, param| {
            // A decorator, or an accessibility modifier, which puts each parameter on a line.
            if !param.modifiers().is_empty() {
                return Err(Refused);
            }
            if param.is_rest() {
                line.token("...")?;
            }
            line.pattern(param.pat())?;
            if param.is_optional() {
                line.byte(b'?')?;
            }
            line.type_annotation(param.ty())?;
            line.default_value(param.default())
        })?;
        self.byte(b')')
    }

    // ───────────────────────────── types ─────────────────────────────

    /// `: T`
    #[inline]
    fn type_annotation(&mut self, ty: Option<TypeNode<'a>>) -> Written {
        match ty {
            Some(ty) => {
                self.token(": ")?;
                self.ty(ty)
            }
            None => Ok(()),
        }
    }

    /// `<A, B>`
    #[inline]
    fn type_arguments(&mut self, args: List<'a, TypeNode<'a>>) -> Written {
        if args.is_empty() {
            return Ok(());
        }
        self.byte(b'<')?;
        self.list(args.iter(), |line, ty| line.ty(ty))?;
        self.byte(b'>')
    }

    /// `<A, B extends C = D>`
    #[inline]
    fn type_parameters(&mut self, params: List<'a, TypeParam<'a>>) -> Written {
        if params.is_empty() {
            return Ok(());
        }
        self.byte(b'<')?;
        self.list(params.iter(), |line, param| {
            // `const`, `in`, `out`
            if param.span().start != param.name().span().start {
                return Err(Refused);
            }
            line.source(param.name().span())?;
            if let Some(constraint) = param.constraint() {
                line.token(" extends ")?;
                line.ty(constraint)?;
            }
            if let Some(default) = param.default() {
                line.token(" = ")?;
                line.ty(default)?;
            }
            Ok(())
        })?;
        self.byte(b'>')
    }

    fn ty(&mut self, ty: TypeNode<'a>) -> Written {
        match ty.tag() {
            TypeTag::Keyword | TypeTag::BoolLit => return self.source(ty.span()),
            TypeTag::Union | TypeTag::Keyof | TypeTag::Readonly | TypeTag::Typeof | TypeTag::Fn
                if super::parentheses::ts_type::needs_parentheses(ty, self.f) =>
            {
                self.byte(b'(')?;
                self.nested(|line| line.type_without_parentheses(ty))?;
                return self.byte(b')');
            }
            _ => {}
        }
        self.nested(|line| line.type_without_parentheses(ty))
    }

    fn type_without_parentheses(&mut self, ty: TypeNode<'a>) -> Written {
        match ty.kind() {
            TypeKind::Ref { name, args } => {
                for (index, part) in name.parts().enumerate() {
                    if index > 0 {
                        self.byte(b'.')?;
                    }
                    self.source(part.span())?;
                }
                self.type_arguments(args)
            }
            TypeKind::StringLit(_) => self.string(ty.span()),
            TypeKind::Array(element) => {
                self.ty(element)?;
                self.token("[]")
            }
            TypeKind::Union(types) => {
                for (index, member) in types.iter().enumerate() {
                    if index > 0 {
                        self.token(" | ")?;
                    }
                    self.ty(member)?;
                }
                Ok(())
            }
            TypeKind::Keyof(operand) => {
                self.token("keyof ")?;
                self.ty(operand)
            }
            TypeKind::Readonly(operand) => {
                self.token("readonly ")?;
                self.ty(operand)
            }
            TypeKind::IndexedAccess { obj, index } => {
                self.ty(obj)?;
                self.byte(b'[')?;
                self.ty(index)?;
                self.byte(b']')
            }
            TypeKind::Fn(func) if func.kind() == FnKind::FunctionType => {
                self.type_parameters(func.type_params())?;
                self.parameters(func)?;
                self.token(" => ")?;
                self.ty(func.return_type().ok_or(Refused)?)
            }
            _ => Err(Refused),
        }
    }
}
