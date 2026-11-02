//! The short cut for what is printed on one line.
//!
//! Most statements, class members and properties fit on their line. For those, everything that the printers in `print/`
//! do (groups, indentation, possible line breaks, several layouts to choose from) and everything that the printer of
//! `ir/` does with it comes to the same as writing the tokens one after the other. [`Line`] does that, straight from the
//! tree to one text.
//!
//! What makes it right:
//!
//! 1. The text starts a line of the output and a forced line break follows it: a statement of a list, a member of a
//!    class, the head of a statement up to its `{`.
//! 2. A document without a forced line break, whose possible line breaks are all in groups, is printed on one line if
//!    that fits. Whether it fits depends on the indentation. [`ShortCuts::depth`] counts the lists that are open. Where
//!    only statements are between the file and the line, that's the indentation. In a function that's part of an
//!    expression it's a lower bound, the indentation in the source is a guess, and the printer checks: a text that's
//!    too wide after all makes it give up, and the file is formatted again with [`Mode::Certain`].
//! 3. Everything here is an "or else". What isn't known to be printed on one line in exactly this way is [`Refused`],
//!    and the printers in `print/` write it: comments, text that isn't plain ASCII, syntax that's missing below, and
//!    whatever breaks whether it fits or not (an object whose first key is on a new line, an array of objects, a chain
//!    of three calls with a function among the arguments, two functions as arguments).
//!
//! `bun fmt --no-short-cuts` turns it off, and the tests compare.

use super::parentheses::expression::{chain_expression_needs_parentheses, needs_parentheses};
use super::print::binary_like_expression::should_flatten;
use super::print::block_statement::is_empty_block;
use super::print::class::write_class_body_after_head;
use super::print::function::FormatFunctionBody;
use super::print::parameters::can_avoid_parentheses;
use super::utils::member_chain::simple_argument::SimpleArgument;
use super::utils::number::format_trimmed_number;
use crate::ir::element::{FormatElement, Text, TextWidth};
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
            && !file.is_flow();
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

/// It isn't certain that the node is printed on one line, or how.
pub(crate) struct Refused;

type Written = Result<(), Refused>;

/// How deep expressions, types and patterns can be nested in a [`Line`]. Anything deeper goes the long way, which asks
/// the stack.
const MAX_NESTING: u32 = 48;

/// What a [`Line`] has written.
#[derive(Copy, Clone)]
enum Part<'a> {
    /// A range of the text buffer, and the width of what follows it on its line.
    Text { start: u32, len: u32, after: u32 },
    /// The `{ .. }` of a function, with statements in it.
    Body(Func<'a>),
    /// A block.
    Block(Stmt<'a>),
    /// An object that's certain to break.
    Object(Expr<'a>),
    /// The `{ .. }` of a class, with members in it.
    ClassBody(Class<'a>),
}

/// Writes nodes on one line, to the end of the formatter's text buffer.
///
/// Where nothing but closing brackets follows, the line can end with the `{` of something that's certain to break. That
/// is a part of its own, which the printers in `print/` write, and what follows it is the next line.
struct Line<'f, 'a> {
    f: &'f mut Formatter<'a>,
    source: &'a [u8],
    /// How many columns there are between the indentation and the end of the line.
    room: usize,
    /// Where the text of the current line starts in the text buffer.
    start: usize,
    /// The length of the text buffer at which the line is full.
    limit: usize,
    /// The width of what a part has written on the current line before the text: its closing bracket.
    taken: usize,
    /// The source of what's written has a line break in it.
    is_multiline: bool,
    /// There's no comment anywhere in the source of what's written.
    is_quiet: bool,
    /// Up to here the source is known to be plain and without comments.
    checked_to: u32,
    nesting: u32,
    parts: SmallVec<[Part<'a>; 4]>,
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

impl<'a> Formatter<'a> {
    /// Calls `write` with a [`Line`] that starts a line of the output, for the node at `span`, which has no comments.
    /// `after` is the width of what the caller writes behind it on the same line. Returns false, with nothing written,
    /// if the short cut isn't taken.
    fn write_line(
        &mut self,
        span: Span,
        after: u32,
        write: impl FnOnce(&mut Line<'_, 'a>) -> Written,
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
        let Some(text) = source.get(span.range()) else {
            return false;
        };
        let is_multiline = strings::index_of_any(text, b"\r\n").is_some();
        // What's printed is rarely much shorter than the source.
        if !is_multiline
            && (text.len() > room + 16
                || !self.is_plain_source(span)
                || !(self.is_quiet() || !self.comments().has_comment_or_owner_in(span)))
        {
            return false;
        }
        let start = self.storage.text.len();
        let mut line = Line {
            room,
            start,
            limit: start + room,
            taken: 0,
            is_quiet: self.is_quiet(),
            f: self,
            source,
            is_multiline,
            checked_to: span.start,
            nesting: 0,
            parts: SmallVec::new(),
        };
        let written = write(&mut line)
            .and_then(|()| line.check_source_up_to(span.end))
            .and_then(|()| line.end_text(after));
        let parts = line.parts;
        if written.is_err() {
            self.storage.text.truncate(start);
            return false;
        }
        for part in parts {
            match part {
                Part::Text { start, len, after } => {
                    self.write_element(FormatElement::OwnedText(Text {
                        start,
                        len,
                        width: TextWidth::short_cut(len, after),
                    }));
                }
                Part::Body(func) => {
                    self.context_mut().short_cuts.follows_line = true;
                    FormatFunctionBody(func).fmt(self);
                }
                Part::Block(block) => write!(self, [space(), block]),
                Part::Object(object) => {
                    self.context_mut().short_cuts.follows_line = true;
                    object.fmt(self);
                }
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

/// Writes `statement`, which a list of statements is about to write on a line of its own and which has no comments in
/// it. Returns false if it has to go the long way.
pub(crate) fn write_statement<'a>(statement: Stmt<'a>, f: &mut Formatter<'a>) -> bool {
    if !matches!(
        statement.tag(),
        StmtTag::Expr
            | StmtTag::Var
            | StmtTag::Return
            | StmtTag::Throw
            | StmtTag::Break
            | StmtTag::Continue
            | StmtTag::Debugger
            | StmtTag::Import
            | StmtTag::ExportNamed
            | StmtTag::ExportDefault
            | StmtTag::TypeAlias
            | StmtTag::Fn
            | StmtTag::Class
            | StmtTag::If
            | StmtTag::While
            | StmtTag::ForOf
            | StmtTag::ForIn
            | StmtTag::Try
    ) {
        return false;
    }
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
    #[inline(always)]
    fn bytes(&mut self, text: &[u8]) -> Written {
        let out = &mut self.f.storage.text;
        out.extend_from_slice(text);
        match out.len() > self.limit {
            true => Err(Refused),
            false => Ok(()),
        }
    }

    #[inline(always)]
    fn token(&mut self, text: &'static str) -> Written {
        self.bytes(text.as_bytes())
    }

    /// A token of the source: a name, a keyword.
    #[inline(always)]
    fn source(&mut self, span: Span) -> Written {
        let source = self.source;
        self.bytes(source.get(span.range()).ok_or(Refused)?)
    }

    #[inline]
    fn text_of(&self, span: Span) -> &'a [u8] {
        self.source.get(span.range()).unwrap_or_default()
    }

    /// Refuses if the source from where the last check ended up to `end` has a comment in it, a character that isn't as
    /// wide as it has bytes, or an empty line: between arguments, parameters, properties, elements and the links of a
    /// chain it's kept, which breaks what is around it.
    fn check_source_up_to(&mut self, end: u32) -> Written {
        let span = Span::new(self.checked_to, end.max(self.checked_to));
        self.checked_to = span.end;
        let is_fine = self.f.is_plain_source(span)
            && (self.is_quiet || !self.f.comments().has_comment_or_owner_in(span))
            && !(self.is_multiline && {
                let text = self.text_of(span);
                strings::contains_char(text, b'\r') || has_empty_line(text)
            });
        match is_fine {
            true => Ok(()),
            false => Err(Refused),
        }
    }

    /// Ends the text of the current line, which `after` more columns follow.
    fn end_text(&mut self, after: u32) -> Written {
        let len = self.f.storage.text.len() - self.start;
        if len + self.taken + after as usize > self.room {
            return Err(Refused);
        }
        if len > 0 {
            self.parts.push(Part::Text {
                start: self.start as u32,
                len: len as u32,
                after,
            });
        }
        Ok(())
    }

    /// Ends the line with `part`, whose source is at `span` and which starts with `after` columns of text on this line.
    /// What's written next follows its last line, which starts where this line starts.
    fn end_line_with(&mut self, part: Part<'a>, span: Span, after: u32) -> Written {
        self.check_source_up_to(span.start)?;
        self.end_text(after)?;
        self.parts.push(part);
        self.checked_to = span.end;
        self.start = self.f.storage.text.len();
        self.taken = 1;
        self.limit = self.start + self.room.saturating_sub(1);
        Ok(())
    }

    /// True if the source has a line break in `span`.
    #[inline]
    fn has_line_break_in(&self, span: Span) -> bool {
        self.is_multiline && strings::contains_char(self.text_of(span), b'\n')
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

    // ───────────────────────────── statements ─────────────────────────────

    fn statement(&mut self, statement: Stmt<'a>) -> Written {
        let modifiers = statement.modifiers();
        match statement.kind() {
            StmtKind::Expr(expression) => {
                // A directive, or a string in parentheses that would be one without them.
                if expression.tag() == ExprTag::String {
                    return Err(Refused);
                }
                self.last_expr(expression)?;
            }
            StmtKind::Var(declarations) => {
                let (Some(declarator), 1) = (declarations.first(), declarations.len()) else {
                    return Err(Refused);
                };
                self.declaration_modifiers(modifiers)?;
                self.token(match declarator.var_kind() {
                    VarKind::Var => "var ",
                    VarKind::Let => "let ",
                    VarKind::Const => "const ",
                    VarKind::Using | VarKind::AwaitUsing => return Err(Refused),
                })?;
                self.pattern(declarator.pat())?;
                if declarator.is_definite() {
                    self.token("!")?;
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
                    self.token(" ")?;
                    self.last_expr(argument)?;
                }
            }
            StmtKind::Throw(argument) => {
                self.token("throw ")?;
                self.expr(argument)?;
            }
            StmtKind::Break(_) | StmtKind::Continue(_) => {
                self.token(match statement.tag() {
                    StmtTag::Break => "break",
                    _ => "continue",
                })?;
                if let Some(label) = statement.label() {
                    self.token(" ")?;
                    self.source(label.span())?;
                }
            }
            StmtKind::Debugger => self.token("debugger")?,
            StmtKind::Fn(func) => {
                self.declaration_modifiers(modifiers)?;
                self.function(func, true)?;
                match func.has_body() {
                    true => return Ok(()),
                    false => {}
                }
            }
            StmtKind::Class(class) => {
                self.declaration_modifiers(modifiers)?;
                return self.class(class);
            }
            StmtKind::If { .. } => return self.if_statement(statement),
            StmtKind::While { test, body } => {
                self.token("while (")?;
                self.expr(test)?;
                self.token(")")?;
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
                self.expr(expr)?;
                self.token(")")?;
                return self.block(body);
            }
            StmtKind::ForIn { left, expr, body } => {
                self.token("for (")?;
                self.for_binding(left)?;
                self.token(" in ")?;
                self.expr(expr)?;
                self.token(")")?;
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
                        self.token(")")?;
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
                self.last_expr(expression)?;
            }
            StmtKind::TypeAlias(alias) => {
                self.declaration_modifiers(modifiers)?;
                self.token("type ")?;
                self.source(alias.name().span())?;
                self.type_parameters(alias.type_params())?;
                self.token(" = ")?;
                self.ty(alias.ty())?;
            }
            _ => return Err(Refused),
        }
        self.token(";")
    }

    /// `export default declare abstract `, in this order.
    fn declaration_modifiers(&mut self, modifiers: List<'a, Modifier<'a>>) -> Written {
        let mut rank = 0;
        for modifier in modifiers {
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
            if next <= rank {
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
            let StmtKind::If { test, yes, no } = statement.kind() else {
                return Err(Refused);
            };
            self.token("if (")?;
            self.expr(test)?;
            self.token(")")?;
            self.block(yes)?;
            let Some(no) = no else {
                return Ok(());
            };
            self.token(" else")?;
            if no.tag() != StmtTag::If {
                return self.block(no);
            }
            self.token(" ")?;
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
        self.token(match declarator.var_kind() {
            VarKind::Var => "var ",
            VarKind::Let => "let ",
            VarKind::Const => "const ",
            VarKind::Using | VarKind::AwaitUsing => return Err(Refused),
        })?;
        self.pattern(declarator.pat())
    }

    /// A class declaration without decorators, which the modifiers have been written of.
    fn class(&mut self, class: Class<'a>) -> Written {
        self.token("class")?;
        if let Some(name) = class.name() {
            self.token(" ")?;
            self.source(name.span())?;
        }
        self.type_parameters(class.type_params())?;
        if let Some(extends) = class.extends() {
            self.token(" extends ")?;
            self.expr(extends)?;
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
                    self.token("?")?;
                }
                if flags.contains(Flags::DEFINITE) {
                    self.token("!")?;
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
                    self.token("*")?;
                }
                match member.constructor_keyword() {
                    Some(keyword) if self.text_of(keyword.span()) == b"constructor" => {
                        self.token("constructor")?
                    }
                    Some(_) => return Err(Refused),
                    None => self.member_key(member.key())?,
                }
                if member.flags().contains(Flags::OPTIONAL) {
                    self.token("?")?;
                }
                self.type_parameters(func.type_params())?;
                self.parameters(func)?;
                self.type_annotation(func.return_type())?;
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

    fn import(&mut self, statement: Stmt<'a>, import: Import<'a>) -> Written {
        if import.phase().is_some() {
            return Err(Refused);
        }
        self.token(match import.is_type_only() {
            true => "import type ",
            false => "import ",
        })?;
        if import.is_side_effect() {
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
        if has_braces {
            if !is_first {
                self.token(", ")?;
            }
            if named.is_empty() {
                self.token("{}")?;
            } else {
                self.open_brace()?;
                self.list(named.iter(), |line, specifier| {
                    if specifier.is_type_only() {
                        line.token("type ")?;
                    }
                    if specifier.is_renamed() {
                        line.module_export_name(specifier.imported())?;
                        line.token(" as ")?;
                    }
                    line.source(specifier.local().span())
                })?;
                self.close_brace()?;
            }
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
        if items.is_empty() {
            self.token("{}")?;
        } else {
            self.open_brace()?;
            self.list(items.iter(), |line, specifier| {
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
            self.close_brace()?;
        }
        if export.has_from() {
            self.token(" from ")?;
            self.module_specifier(statement)?;
        }
        Ok(())
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// The right side of `=` or `:`.
    fn assigned(&mut self, value: Expr<'a>) -> Written {
        // `a = b = c` has a layout of its own.
        if value.tag() == ExprTag::Assign {
            return Err(Refused);
        }
        self.expr(value)
    }

    /// The right side of `=` or `:`, with nothing but closing brackets after it.
    fn last_assigned(&mut self, value: Expr<'a>) -> Written {
        if value.tag() == ExprTag::Assign {
            return Err(Refused);
        }
        self.last_expr(value)
    }

    /// An expression with nothing but closing brackets after it, so that it can end the line.
    fn last_expr(&mut self, e: Expr<'a>) -> Written {
        match e.tag() {
            ExprTag::Fn
            | ExprTag::Object
            | ExprTag::Call
            | ExprTag::New
            | ExprTag::Await
            | ExprTag::Assign
                if !needs_parentheses(e, self.f) => {}
            _ => return self.expr(e),
        }
        if e.tag() == ExprTag::Call && e.is_chain_root() {
            return self.expr(e);
        }
        self.nested(|line| match e.kind() {
            ExprKind::Fn(func) => line.function(func, true),
            ExprKind::Object(props) => line.object(e, props, true),
            ExprKind::Call(call) => line.call(e, call, true),
            ExprKind::New(call) => {
                line.token("new ")?;
                line.expr(call.callee())?;
                line.type_arguments(call.type_args())?;
                line.arguments(call.args(), true)
            }
            ExprKind::Await(argument) => {
                line.token("await ")?;
                line.last_expr(argument)
            }
            ExprKind::Assign { .. } => line.assignment(e, true),
            _ => Err(Refused),
        })
    }

    fn call(&mut self, e: Expr<'a>, call: Call<'a>, is_last: bool) -> Written {
        self.check_member_chain(e, call)?;
        let callee = call.callee();
        self.expr(callee)?;
        if call.is_optional() {
            self.token("?.")?;
        }
        self.type_arguments(call.type_args())?;
        // `a(b)(() => { .. })` has a layout of its own. A chain breaks if its last call does and an earlier one has a
        // function among its arguments.
        let is_last = is_last && callee.tag() != ExprTag::Call && {
            let mut link = callee;
            loop {
                link = match link.kind() {
                    ExprKind::Call(call)
                        if call.args().iter().any(|it| it.tag() == ExprTag::Fn) =>
                    {
                        break false;
                    }
                    ExprKind::Call(call) => call.callee(),
                    ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                    ExprKind::NonNull(inner) => inner,
                    _ => break true,
                };
            }
        };
        self.arguments(call.args(), is_last)
    }

    fn assignment(&mut self, e: Expr<'a>, is_last: bool) -> Written {
        let ExprKind::Assign { op, target, value } = e.kind() else {
            return Err(Refused);
        };
        if matches!(target.tag(), ExprTag::Object | ExprTag::Array)
            || !matches!(e.as_chain_element(), AstNodes::AssignmentExpression(_))
        {
            return Err(Refused);
        }
        self.expr(target)?;
        self.token(" ")?;
        self.token(assign_op_text(op))?;
        self.token(" ")?;
        match is_last {
            true => self.last_assigned(value),
            false => self.assigned(value),
        }
    }

    fn expr(&mut self, e: Expr<'a>) -> Written {
        let tag = e.tag();
        match tag {
            ExprTag::Ident => {
                let span = e.span();
                // The names that can need parentheses: `let`, `async`, `await`, ..
                if (3..=9).contains(&span.len()) && needs_parentheses(e, self.f) {
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
        let is_chain_root = matches!(
            tag,
            ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::NonNull
        ) && e.is_chain_root();
        let has_parentheses = needs_parentheses(e, self.f);
        if is_chain_root && (has_parentheses || chain_expression_needs_parentheses(e, self.f)) {
            return Err(Refused);
        }
        if has_parentheses {
            self.token("(")?;
        }
        self.nested(|line| line.expr_without_parentheses(e))?;
        if has_parentheses {
            self.token(")")?;
        }
        Ok(())
    }

    fn expr_without_parentheses(&mut self, e: Expr<'a>) -> Written {
        match e.kind() {
            ExprKind::Number(_) => {
                let printed = format_trimmed_number(self.text_of(e.span()));
                self.bytes(&printed)
            }
            ExprKind::Dot { obj, name, chain } => {
                self.expr(obj)?;
                self.token(match chain {
                    Chain::Start => "?.",
                    _ => ".",
                })?;
                self.source(name.span())
            }
            ExprKind::Index { obj, index, chain } => {
                self.expr(obj)?;
                self.token(match chain {
                    Chain::Start => "?.[",
                    _ => "[",
                })?;
                self.expr(index)?;
                self.token("]")
            }
            ExprKind::Call(call) => self.call(e, call, false),
            ExprKind::New(call) => {
                self.token("new ")?;
                self.expr(call.callee())?;
                self.type_arguments(call.type_args())?;
                self.arguments(call.args(), false)
            }
            ExprKind::Unary { op, operand } => match op.is_update() && !op.is_prefix() {
                true => {
                    self.expr(operand)?;
                    self.token(op.as_str())
                }
                false => {
                    self.token(op.as_str())?;
                    if op.is_keyword() {
                        self.token(" ")?;
                    }
                    self.expr(operand)
                }
            },
            ExprKind::Binary { op, left, right } => {
                // `a && (b && c)` loses its parentheses.
                if op == BinOp::Comma || right.binary_op() == Some(op) {
                    return Err(Refused);
                }
                match left.binary_op() {
                    // One chain, without the parentheses that `(a | b) | c` would get otherwise.
                    Some(left_op) if left_op != BinOp::Comma && should_flatten(op, left_op) => {
                        self.nested(|line| line.expr_without_parentheses(left))?
                    }
                    _ => self.expr(left)?,
                }
                self.token(" ")?;
                self.token(bin_op_text(op))?;
                self.token(" ")?;
                self.expr(right)
            }
            ExprKind::Assign { .. } => self.assignment(e, false),
            ExprKind::Cond { test, yes, no } => {
                self.expr(test)?;
                self.token(" ? ")?;
                match yes.tag() {
                    ExprTag::Cond => {
                        self.token("(")?;
                        self.expr(yes)?;
                        self.token(")")?;
                    }
                    _ => self.expr(yes)?,
                }
                self.token(" : ")?;
                self.expr(no)
            }
            ExprKind::Array(elements) => self.array(e, elements),
            ExprKind::Object(props) => self.object(e, props, false),
            ExprKind::Fn(func) => self.function(func, false),
            ExprKind::Spread(argument) => {
                if e.jsx_container_span().is_some() {
                    return Err(Refused);
                }
                self.token("...")?;
                self.expr(argument)
            }
            ExprKind::Await(argument) => {
                self.token("await ")?;
                self.expr(argument)
            }
            ExprKind::As { expr, ty } | ExprKind::Satisfies { expr, ty } => {
                if e.is_angle_bracket_assertion() {
                    return Err(Refused);
                }
                self.expr(expr)?;
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
                self.expr(expr)?;
                self.token(" as const")
            }
            ExprKind::NonNull(expr) => {
                if e.non_null_count() != 1 {
                    return Err(Refused);
                }
                self.expr(expr)?;
                self.token("!")
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
        let stop = strings::index_of_any(content, &[b'\t', b'\n', preferred]);
        match stop.map(|at| content[at]) {
            None if *first == preferred => self.bytes(text),
            None => {
                self.bytes(&[preferred])?;
                self.bytes(content)?;
                self.bytes(&[preferred])
            }
            Some(b'\t' | b'\n') => Err(Refused),
            Some(_) if strings::index_of_any(content, b"\t\n").is_some() => Err(Refused),
            Some(_) => self.bytes(text),
        }
    }

    /// A chain with more than two calls breaks if an argument isn't simple, whether it fits or not.
    fn check_member_chain(&mut self, e: Expr<'a>, call: Call<'a>) -> Written {
        if !matches!(call.callee().tag(), ExprTag::Dot | ExprTag::Index) {
            return Ok(());
        }
        let mut calls = 0;
        let mut link = e;
        loop {
            link = match link.kind() {
                ExprKind::Call(call) => {
                    calls += 1;
                    call.callee()
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::NonNull(inner) => inner,
                _ => break,
            };
        }
        if calls <= 2 {
            return Ok(());
        }
        let mut link = e;
        loop {
            link = match link.kind() {
                ExprKind::Call(call) => {
                    let f = &*self.f;
                    if !(call.args().iter()).all(|it| SimpleArgument::new(it, f).is_simple()) {
                        return Err(Refused);
                    }
                    call.callee()
                }
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::NonNull(inner) => inner,
                _ => return Ok(()),
            };
        }
    }

    /// True if `argument` is certain to break, and is hugged as the last argument of a call.
    fn ends_line(&self, argument: Expr<'a>) -> bool {
        match argument.kind() {
            ExprKind::Fn(func) => {
                (func.body_statements()).is_some_and(|statements| !is_empty_block(statements))
            }
            ExprKind::Object(props) => self.is_broken_object(argument, props),
            _ => false,
        }
    }

    /// True if the first key of the object `e` is on a new line, which keeps it broken.
    fn is_broken_object(&self, e: Expr<'a>, props: List<'a, Prop<'a>>) -> bool {
        self.f.options().expand == Expand::Auto
            && (props.first()).is_some_and(|first| {
                self.has_line_break_in(Span::new(e.span().start, first.span().start))
            })
    }

    fn arguments(&mut self, args: List<'a, Expr<'a>>, is_last: bool) -> Written {
        self.token("(")?;
        if is_last
            && let Some(last) = args.last()
            && self.ends_line(last)
        {
            let count = args.len();
            // Two arguments of the same kind aren't hugged.
            if count > 1
                && (args.get(count - 2)).is_some_and(|it| {
                    it.tag() == last.tag() || it.tag() == ExprTag::Fn || it.tag() == ExprTag::Cond
                })
            {
                return Err(Refused);
            }
            self.check_composition(args)?;
            for argument in args.iter().take(count - 1) {
                self.expr(argument)?;
                self.token(", ")?;
            }
            self.last_expr(last)?;
            return self.token(")");
        }
        self.check_composition(args)?;
        self.list(args.iter(), |line, argument| line.expr(argument))?;
        self.token(")")
    }

    fn check_composition(&mut self, args: List<'a, Expr<'a>>) -> Written {
        // Several functions among the arguments, or in the arguments of an argument, are each on a line.
        if args.len() > 1 {
            let mut functions = 0;
            for argument in args {
                match argument.tag() {
                    ExprTag::Fn => functions += 1,
                    ExprTag::Call | ExprTag::NonNull => {
                        let mut inner = argument;
                        while let ExprKind::NonNull(it) = inner.kind() {
                            inner = it;
                        }
                        if inner.as_call().is_some_and(|call| {
                            call.args().iter().any(|it| it.tag() == ExprTag::Fn)
                        }) {
                            return Err(Refused);
                        }
                    }
                    _ => {}
                }
            }
            if functions > 1 {
                return Err(Refused);
            }
        }
        Ok(())
    }

    fn array(&mut self, e: Expr<'a>, elements: List<'a, Expr<'a>>) -> Written {
        if e.is_assignment_target() {
            return Err(Refused);
        }
        // Several objects, or several arrays, are each on a line.
        if elements.len() > 1
            && elements
                .first()
                .is_some_and(|it| matches!(it.tag(), ExprTag::Object | ExprTag::Array))
        {
            return Err(Refused);
        }
        self.token("[")?;
        self.list(elements.iter(), |line, element| match element.tag() {
            ExprTag::Missing => Err(Refused),
            _ => line.expr(element),
        })?;
        self.token("]")
    }

    fn object(&mut self, e: Expr<'a>, props: List<'a, Prop<'a>>, is_last: bool) -> Written {
        if e.is_assignment_target() {
            return Err(Refused);
        }
        if props.is_empty() {
            return self.token("{}");
        }
        if self.is_broken_object(e, props) {
            return match is_last {
                true => self.end_line_with(Part::Object(e), e.span(), 1),
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
                match is_last {
                    true => self.last_assigned(value),
                    false => self.assigned(value),
                }
            }
            PropKind::Shorthand => match prop.value() {
                Some(value) if value.tag() == ExprTag::Ident => self.source(value.span()),
                _ => Err(Refused),
            },
            PropKind::Spread => {
                self.token("...")?;
                self.expr(prop.value().ok_or(Refused)?)
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
                    self.token("*")?;
                }
                self.key(prop.key())?;
                self.type_parameters(func.type_params())?;
                self.parameters(func)?;
                self.type_annotation(func.return_type())?;
                self.body(func, is_last)
            }
        }
    }

    /// An arrow function whose body is an expression or empty, or a function expression with an empty body.
    fn function(&mut self, func: Func<'a>, is_last: bool) -> Written {
        if func.is_async() {
            self.token("async ")?;
        }
        if !func.is_arrow() {
            self.token(match func.is_generator() {
                true => "function* ",
                false => "function ",
            })?;
            match func.name() {
                Some(name) => self.source(name.span())?,
                // `function ()`, `function* ()`
                None => {}
            }
            self.type_parameters(func.type_params())?;
            self.parameters(func)?;
            self.type_annotation(func.return_type())?;
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
        self.token(" ")?;
        match body.tag() {
            // A chain of arrow functions has a layout of its own.
            ExprTag::Fn => Err(Refused),
            ExprTag::Binary if is_sequence(body) => Err(Refused),
            // In parentheses, unless it breaks or starts with an object.
            ExprTag::Cond if matches!(self.text_of(body.span()), [b'(' | b'{', ..]) => Err(Refused),
            ExprTag::Cond => {
                self.token("(")?;
                self.expr(body)?;
                self.token(")")
            }
            _ => self.expr(body),
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
                        match prop.default() {
                            Some(default) => {
                                line.token(" = ")?;
                                line.expr(default)
                            }
                            None => Ok(()),
                        }
                    })
                })?;
                self.close_brace()
            }
            PatKind::Array(elements) => {
                self.token("[")?;
                self.nested(|line| {
                    line.list(elements.iter(), |line, element| {
                        let pattern = element.pat().ok_or(Refused)?;
                        if element.is_rest() {
                            line.token("...")?;
                        }
                        line.pattern(pattern)?;
                        match element.default() {
                            Some(default) => {
                                line.token(" = ")?;
                                line.expr(default)
                            }
                            None => Ok(()),
                        }
                    })
                })?;
                self.token("]")
            }
            PatKind::Missing => Err(Refused),
        }
    }

    /// `(a, b: T, c = 1, ...d)`
    fn parameters(&mut self, func: Func<'a>) -> Written {
        if func.this_param().is_some() {
            return Err(Refused);
        }
        self.token("(")?;
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
                line.token("?")?;
            }
            line.type_annotation(param.ty())?;
            match param.default() {
                Some(default) => {
                    line.token(" = ")?;
                    line.expr(default)
                }
                None => Ok(()),
            }
        })?;
        self.token(")")
    }

    // ───────────────────────────── types ─────────────────────────────

    /// `: T`
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
    fn type_arguments(&mut self, args: List<'a, TypeNode<'a>>) -> Written {
        if args.is_empty() {
            return Ok(());
        }
        self.token("<")?;
        self.list(args.iter(), |line, ty| line.ty(ty))?;
        self.token(">")
    }

    /// `<A, B extends C = D>`
    fn type_parameters(&mut self, params: List<'a, TypeParam<'a>>) -> Written {
        if params.is_empty() {
            return Ok(());
        }
        self.token("<")?;
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
        self.token(">")
    }

    fn ty(&mut self, ty: TypeNode<'a>) -> Written {
        match ty.tag() {
            TypeTag::Keyword | TypeTag::BoolLit => return self.source(ty.span()),
            TypeTag::Union | TypeTag::Keyof | TypeTag::Readonly | TypeTag::Typeof | TypeTag::Fn
                if super::parentheses::ts_type::needs_parentheses(ty, self.f) =>
            {
                self.token("(")?;
                self.nested(|line| line.type_without_parentheses(ty))?;
                return self.token(")");
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
                        self.token(".")?;
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
                self.token("[")?;
                self.ty(index)?;
                self.token("]")
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

fn is_sequence(e: Expr<'_>) -> bool {
    e.binary_op() == Some(BinOp::Comma)
}
