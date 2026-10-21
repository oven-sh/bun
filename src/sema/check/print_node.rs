//! printer.go's `Printer` for a node that the declaration emitter keeps: the writer, comments, lists and expressions.

use super::errors_declaration_emit::{Writer, positions_are_on_same_line};
use super::errors_operators::language_version;
use super::print::{OperatorPrecedence as P, unary_operator_text};
use super::spans::{
    line_break_len, skip_trivia, skip_trivia_back, template_text, unescaped_identifier, word_end,
};
use super::*;
use crate::resolve::ScriptTarget;

/// Why a node is not printed.
pub(super) enum Stop {
    /// The stack is too low for a node that is nested this deeply.
    OutOfStack,
}

pub(super) type Emitted = Result<(), Stop>;

/// `commentState`: `Pos()` and `End()` of the node, and the container that it replaced.
#[derive(Copy, Clone)]
pub(super) struct NodeState {
    pos: usize,
    end: usize,
    container_pos: usize,
    container_end: usize,
    declaration_list_container_end: usize,
}

/// A position that no node has: `-1`.
pub(super) const NONE: usize = usize::MAX;

/// What `emit_expression_at` does next for a node that it has entered.
#[derive(Copy, Clone)]
enum Step {
    /// The rest of a node whose first child is emitted: `emit_after_head`.
    AfterHead,
    /// The `:` of a conditional expression with these two branches, and what follows it.
    AfterYes(ExprId, ExprId),
    /// `exitNode`, and the `)` that the printer adds.
    End,
}

/// A last child that `emit_expression_at` emits in its loop, so a chain (`a = b = c`, `!!a`) takes no stack per link.
struct Tail {
    child: ExprId,
    precedence: P,
    /// How often the indentation decreases after the child.
    unindent: u8,
    then: Step,
}

impl Tail {
    /// The last child of a node.
    fn last(child: ExprId, precedence: P) -> Self {
        Tail {
            child,
            precedence,
            unindent: 0,
            then: Step::End,
        }
    }
}

/// A node that `emit_expression_at` has entered and not finished.
struct Entered {
    node: ExprId,
    pos: usize,
    state: NodeState,
    needs_parentheses: bool,
    unindent: u8,
    step: Step,
}

/// `ListFormat`
pub(super) mod lf {
    pub(in super::super) const NONE: u32 = 0;
    pub(in super::super) const MULTI_LINE: u32 = 1 << 0;
    pub(in super::super) const PRESERVE_LINES: u32 = 1 << 1;
    pub(in super::super) const BAR_DELIMITED: u32 = 1 << 2;
    pub(in super::super) const AMPERSAND_DELIMITED: u32 = 1 << 3;
    pub(in super::super) const COMMA_DELIMITED: u32 = 1 << 4;
    pub(in super::super) const DELIMITERS_MASK: u32 =
        BAR_DELIMITED | AMPERSAND_DELIMITED | COMMA_DELIMITED;
    pub(in super::super) const ALLOW_TRAILING_COMMA: u32 = 1 << 6;
    pub(in super::super) const INDENTED: u32 = 1 << 7;
    pub(in super::super) const SPACE_BETWEEN_BRACES: u32 = 1 << 8;
    pub(in super::super) const SPACE_BETWEEN_SIBLINGS: u32 = 1 << 9;
    pub(in super::super) const BRACES: u32 = 1 << 10;
    pub(in super::super) const PARENTHESIS: u32 = 1 << 11;
    pub(in super::super) const ANGLE_BRACKETS: u32 = 1 << 12;
    pub(in super::super) const SQUARE_BRACKETS: u32 = 1 << 13;
    pub(in super::super) const BRACKETS_MASK: u32 =
        BRACES | PARENTHESIS | ANGLE_BRACKETS | SQUARE_BRACKETS;
    pub(in super::super) const OPTIONAL_IF_NIL: u32 = 1 << 14;
    pub(in super::super) const OPTIONAL_IF_EMPTY: u32 = 1 << 15;
    pub(in super::super) const OPTIONAL: u32 = OPTIONAL_IF_NIL | OPTIONAL_IF_EMPTY;
    pub(in super::super) const PREFER_NEW_LINE: u32 = 1 << 16;
    pub(in super::super) const NO_TRAILING_NEW_LINE: u32 = 1 << 17;
    pub(in super::super) const NO_INTERVENING_COMMENTS: u32 = 1 << 18;
    pub(in super::super) const NO_SPACE_IF_EMPTY: u32 = 1 << 19;
    pub(in super::super) const SPACE_AFTER_LIST: u32 = 1 << 21;

    pub(in super::super) const MODIFIERS: u32 =
        SPACE_BETWEEN_SIBLINGS | NO_INTERVENING_COMMENTS | SPACE_AFTER_LIST;
    pub(in super::super) const HERITAGE_CLAUSES: u32 = SPACE_BETWEEN_SIBLINGS;
    pub(in super::super) const MULTI_LINE_TYPE_LITERAL_MEMBERS: u32 =
        MULTI_LINE | INDENTED | OPTIONAL_IF_EMPTY;
    pub(in super::super) const MULTI_LINE_TUPLE_TYPE_ELEMENTS: u32 =
        COMMA_DELIMITED | INDENTED | SPACE_BETWEEN_SIBLINGS | MULTI_LINE;
    pub(in super::super) const UNION_TYPE_CONSTITUENTS: u32 =
        BAR_DELIMITED | SPACE_BETWEEN_SIBLINGS;
    pub(in super::super) const INTERSECTION_TYPE_CONSTITUENTS: u32 =
        AMPERSAND_DELIMITED | SPACE_BETWEEN_SIBLINGS;
    pub(in super::super) const OBJECT_BINDING_PATTERN_ELEMENTS: u32 = ALLOW_TRAILING_COMMA
        | SPACE_BETWEEN_BRACES
        | COMMA_DELIMITED
        | SPACE_BETWEEN_SIBLINGS
        | NO_SPACE_IF_EMPTY;
    pub(in super::super) const ARRAY_BINDING_PATTERN_ELEMENTS: u32 =
        ALLOW_TRAILING_COMMA | COMMA_DELIMITED | SPACE_BETWEEN_SIBLINGS | NO_SPACE_IF_EMPTY;
    pub(in super::super) const OBJECT_LITERAL_EXPRESSION_PROPERTIES: u32 = PRESERVE_LINES
        | COMMA_DELIMITED
        | SPACE_BETWEEN_SIBLINGS
        | SPACE_BETWEEN_BRACES
        | INDENTED
        | BRACES
        | NO_SPACE_IF_EMPTY;
    pub(in super::super) const IMPORT_ATTRIBUTES: u32 = OBJECT_LITERAL_EXPRESSION_PROPERTIES;
    pub(in super::super) const ARRAY_LITERAL_EXPRESSION_ELEMENTS: u32 = PRESERVE_LINES
        | COMMA_DELIMITED
        | SPACE_BETWEEN_SIBLINGS
        | ALLOW_TRAILING_COMMA
        | INDENTED
        | SQUARE_BRACKETS;
    pub(in super::super) const CALL_EXPRESSION_ARGUMENTS: u32 =
        COMMA_DELIMITED | SPACE_BETWEEN_SIBLINGS | PARENTHESIS;
    pub(in super::super) const NEW_EXPRESSION_ARGUMENTS: u32 =
        CALL_EXPRESSION_ARGUMENTS | OPTIONAL_IF_NIL;
    pub(in super::super) const TEMPLATE_EXPRESSION_SPANS: u32 = NO_INTERVENING_COMMENTS;
    pub(in super::super) const SINGLE_LINE_BLOCK_STATEMENTS: u32 =
        SPACE_BETWEEN_BRACES | SPACE_BETWEEN_SIBLINGS;
    pub(in super::super) const MULTI_LINE_BLOCK_STATEMENTS: u32 = INDENTED | MULTI_LINE;
    pub(in super::super) const VARIABLE_DECLARATION_LIST: u32 =
        COMMA_DELIMITED | SPACE_BETWEEN_SIBLINGS;
    pub(in super::super) const SINGLE_LINE_FUNCTION_BODY_STATEMENTS: u32 =
        SPACE_BETWEEN_SIBLINGS | SPACE_BETWEEN_BRACES;
    pub(in super::super) const MULTI_LINE_FUNCTION_BODY_STATEMENTS: u32 = MULTI_LINE;
    pub(in super::super) const CLASS_HERITAGE_CLAUSES: u32 = 0;
    pub(in super::super) const CLASS_MEMBERS: u32 = INDENTED | MULTI_LINE;
    pub(in super::super) const INTERFACE_MEMBERS: u32 = INDENTED | MULTI_LINE;
    pub(in super::super) const ENUM_MEMBERS: u32 = COMMA_DELIMITED | INDENTED | MULTI_LINE;
    pub(in super::super) const CASE_BLOCK_CLAUSES: u32 = INDENTED | MULTI_LINE;
    pub(in super::super) const NAMED_IMPORTS_OR_EXPORTS_ELEMENTS: u32 = COMMA_DELIMITED
        | SPACE_BETWEEN_SIBLINGS
        | ALLOW_TRAILING_COMMA
        | SPACE_BETWEEN_BRACES
        | NO_SPACE_IF_EMPTY;
    pub(in super::super) const JSX_ELEMENT_OR_FRAGMENT_CHILDREN: u32 = NO_INTERVENING_COMMENTS;
    pub(in super::super) const JSX_ELEMENT_ATTRIBUTES: u32 =
        SPACE_BETWEEN_SIBLINGS | NO_INTERVENING_COMMENTS;
    pub(in super::super) const CASE_OR_DEFAULT_CLAUSE_STATEMENTS: u32 =
        INDENTED | MULTI_LINE | NO_TRAILING_NEW_LINE | OPTIONAL_IF_EMPTY;
    pub(in super::super) const HERITAGE_CLAUSE_TYPES: u32 =
        COMMA_DELIMITED | SPACE_BETWEEN_SIBLINGS;
    pub(in super::super) const DECORATORS: u32 = MULTI_LINE | OPTIONAL | SPACE_AFTER_LIST;
    pub(in super::super) const TYPE_ARGUMENTS: u32 =
        COMMA_DELIMITED | SPACE_BETWEEN_SIBLINGS | ANGLE_BRACKETS | OPTIONAL;
    pub(in super::super) const TYPE_PARAMETERS: u32 = TYPE_ARGUMENTS;
    pub(in super::super) const PARAMETERS: u32 =
        COMMA_DELIMITED | SPACE_BETWEEN_SIBLINGS | PARENTHESIS;
    pub(in super::super) const INDEX_SIGNATURE_PARAMETERS: u32 =
        COMMA_DELIMITED | SPACE_BETWEEN_SIBLINGS | INDENTED | SQUARE_BRACKETS;
}

/// `Pos()` and `End()` of a node: the end of the token before it, and of its last token. A missing node has no width.
#[derive(Copy, Clone)]
pub(super) struct Child {
    pub(super) pos: usize,
    pub(super) end: usize,
}

/// `Printer`, for the nodes of one file.
pub(super) struct NodePrinter<'a, 'p, 's> {
    pub(super) c: &'a Checker<'p, 's>,
    pub(super) file: FileId,
    pub(super) hir: &'p hir::File<'s>,
    pub(super) text: &'p [u8],
    pub(super) writer: Writer<'p>,
    /// `containerPos`, `containerEnd`, `declarationListContainerEnd`
    container_pos: usize,
    container_end: usize,
    declaration_list_container_end: usize,
    /// `commentsDisabled`
    pub(super) comments_disabled: bool,
    /// `HasTrailingComment`: the length of the text when a comment was written last.
    after_comment: usize,
    /// `nextListElementPos`
    next_list_element_pos: usize,
    /// `detachedCommentsInfo`: `nodePos`, `detachedCommentEndPos`.
    pub(super) detached_comments: Vec<(usize, usize)>,
    /// `getLiteralTextFlagsAllowNumericSeparator`
    allows_numeric_separators: bool,
}

/// `IsInvalid` of the token flags of the numeric literal `written`, and `TokenFlagsContainsSeparator`.
#[optimize(size)]
fn numeric_literal_flags(written: &[u8]) -> (bool, bool) {
    let digit = |at: usize| written.get(at).is_some_and(u8::is_ascii_digit);
    let has_separator = bun_core::strings::contains_char(written, b'_');
    // `scanHexDigits` sets no flag for a separator that is misplaced.
    if matches!(written, [b'0', b'x' | b'X' | b'b' | b'B' | b'o' | b'O', ..]) {
        return (false, has_separator);
    }
    if written.first() == Some(&b'0') && (digit(1) || written.get(1) == Some(&b'_')) {
        return (true, has_separator);
    }
    // `scanNumberFragment`: a separator is allowed after a digit, and not at the end.
    let (mut allows_separator, mut previous_is_separator) = (false, false);
    for &byte in written {
        match byte {
            b'0'..=b'9' => (allows_separator, previous_is_separator) = (true, false),
            b'_' if allows_separator => (allows_separator, previous_is_separator) = (false, true),
            b'_' => return (true, true),
            // The fraction and the exponent are fragments of their own.
            _ if previous_is_separator => return (true, true),
            _ => allows_separator = false,
        }
    }
    (previous_is_separator, has_separator)
}

impl<'a, 'p, 's> NodePrinter<'a, 'p, 's> {
    /// For a node of the statement at `statement` (`Pos()`, `End()`). The text continues a line indented by `indent`.
    #[optimize(size)]
    pub(super) fn new(
        c: &'a Checker<'p, 's>,
        file: FileId,
        indent: usize,
        statement: (u32, u32),
    ) -> Self {
        let hir = c.hir(file);
        NodePrinter {
            c,
            file,
            hir,
            text: &hir.text[..],
            writer: Writer::new(&hir.text, indent),
            container_pos: statement.0 as usize,
            container_end: statement.1 as usize,
            declaration_list_container_end: NONE,
            comments_disabled: c.files().options.remove_comments,
            after_comment: NONE,
            next_list_element_pos: NONE,
            detached_comments: Vec::new(),
            allows_numeric_separators: language_version(c) >= ScriptTarget::ES2021,
        }
    }

    /// What was written. If its last line is empty, it has the indentation for the text that follows.
    #[optimize(size)]
    pub(super) fn into_text(mut self) -> Vec<u8> {
        if self.writer.is_at_start_of_line {
            self.writer.write_indentation();
        }
        self.writer.into_text()
    }

    // ───────────────────────────── the source ─────────────────────────────

    /// `SkipTrivia`
    #[inline]
    #[optimize(size)]
    pub(super) fn skip_trivia(&self, pos: usize) -> usize {
        skip_trivia(self.text, pos.min(self.text.len()))
    }

    /// `Pos()` of a node whose first token is at `start`: the end of the token before it.
    #[inline]
    #[optimize(size)]
    pub(super) fn pos_before(&self, start: usize) -> usize {
        skip_trivia_back(self.text, start)
    }

    #[inline]
    #[optimize(size)]
    pub(super) fn source(&self, start: usize, end: usize) -> &'p [u8] {
        self.text.get(start..end).unwrap_or_default()
    }

    #[inline]
    #[optimize(size)]
    pub(super) fn byte(&self, at: usize) -> u8 {
        self.text.get(at).copied().unwrap_or(0)
    }

    /// Where `token`, which starts at `start`, ends: a keyword can have escapes. `None`: another token is there.
    #[optimize(size)]
    pub(super) fn token_end_at(&self, token: &[u8], start: usize) -> Option<usize> {
        if !token.first().is_some_and(u8::is_ascii_alphabetic) {
            let end = start + token.len();
            return (self.source(start, end) == token).then_some(end);
        }
        let end = word_end(self.text, start);
        (end > start && &*unescaped_identifier(self.source(start, end)) == token).then_some(end)
    }

    /// The end in the source of the token `token` that follows `pos`, if it is there.
    #[optimize(size)]
    pub(super) fn token_after(&self, token: &[u8], pos: usize) -> Option<usize> {
        self.token_end_at(token, self.skip_trivia(pos))
    }

    /// `PositionsAreOnSameLine`
    #[inline]
    #[optimize(size)]
    pub(super) fn on_same_line(&self, pos1: usize, pos2: usize) -> bool {
        let last = self.text.len();
        positions_are_on_same_line(self.text, pos1.min(last), pos2.min(last))
    }

    /// `getLinesBetweenNodes(parent, node1, node2)`, 0 or 1, for `node1.End()` and `node2.Pos()`.
    #[inline]
    #[optimize(size)]
    pub(super) fn is_on_next_line(&self, end: usize, pos: usize) -> bool {
        !self.on_same_line(end, self.skip_trivia(pos))
    }

    /// `RangeIsOnSingleLine`
    #[inline]
    #[optimize(size)]
    pub(super) fn range_is_on_single_line(&self, (pos, end): (usize, usize)) -> bool {
        self.on_same_line(self.skip_trivia(pos), end)
    }

    // ───────────────────────────── the writer ─────────────────────────────

    /// `Write`. Source text can end with a line break (an unterminated template, JSX text): what follows starts a line.
    #[inline]
    #[optimize(size)]
    pub(super) fn write(&mut self, text: &[u8]) {
        self.writer.write(text);
        let ends_line =
            |len: usize| text.len() >= len && line_break_len(text, text.len() - len) == len;
        if ends_line(1) || ends_line(3) {
            self.writer.is_at_start_of_line = true;
        }
    }

    #[inline]
    #[optimize(size)]
    pub(super) fn write_space(&mut self) {
        self.writer.write(b" ");
    }

    #[inline]
    #[optimize(size)]
    pub(super) fn write_line(&mut self) {
        self.writer.write_line();
    }

    #[inline]
    #[optimize(size)]
    pub(super) fn increase_indent(&mut self) {
        self.writer.indent += 1;
    }

    #[inline]
    #[optimize(size)]
    pub(super) fn decrease_indent(&mut self) {
        self.writer.indent = self.writer.indent.saturating_sub(1);
    }

    #[optimize(size)]
    pub(super) fn increase_indent_if(&mut self, indented: bool) {
        if indented {
            self.increase_indent();
        }
    }

    #[optimize(size)]
    pub(super) fn decrease_indent_if(&mut self, indented: bool) {
        if indented {
            self.decrease_indent();
        }
    }

    /// `writeLinesAndIndent`, for 0 or 1 lines.
    #[optimize(size)]
    pub(super) fn write_lines_and_indent(
        &mut self,
        on_next_line: bool,
        space_if_not_indenting: bool,
    ) {
        if on_next_line {
            self.increase_indent();
            self.write_line();
        } else if space_if_not_indenting {
            self.write_space();
        }
    }

    /// `HasTrailingComment`, `HasTrailingWhitespace`
    #[optimize(size)]
    fn has_trailing_comment_or_whitespace(&self) -> bool {
        self.after_comment == self.writer.text.len()
            || self.writer.text.last().is_some_and(u8::is_ascii_whitespace)
    }

    // ───────────────────────────── comments ─────────────────────────────

    /// `emitLeadingComments`
    #[optimize(size)]
    pub(super) fn emit_leading_comments(&mut self, pos: usize) {
        if self.comments_disabled || pos == self.container_pos || pos > self.text.len() {
            return;
        }
        let mut pos = pos;
        // "skip detached comments"
        if let Some(&(node_pos, end)) = self.detached_comments.last()
            && node_pos == pos
        {
            self.detached_comments.pop();
            pos = end;
        }
        self.writer.emit_leading_comments(pos);
    }

    /// Whether the node that has the comments at `end` is another one than this.
    #[inline]
    #[optimize(size)]
    fn owns_comments_after(&self, end: usize) -> bool {
        !self.comments_disabled
            && end <= self.text.len()
            && (self.container_end == NONE
                || end != self.container_end && end != self.declaration_list_container_end)
    }

    /// `emitTrailingComments`, with `commentSeparatorBefore`
    #[optimize(size)]
    pub(super) fn emit_trailing_comments(&mut self, end: usize) {
        if !self.owns_comments_after(end) {
            return;
        }
        let before = self.writer.text.len();
        self.writer.emit_trailing_comments_with_space_before(end);
        if self.writer.text.len() != before {
            self.after_comment = self.writer.text.len();
        }
    }

    /// `emitTrailingComments`, with `commentSeparatorAfter`
    #[optimize(size)]
    pub(super) fn emit_trailing_comments_with_space_after(&mut self, end: usize) {
        if self.owns_comments_after(end) {
            self.writer.emit_trailing_comments_with_space_after(end);
        }
    }

    /// `emitTrailingCommentsOfPosition`
    #[optimize(size)]
    pub(super) fn emit_trailing_comments_of_position(
        &mut self,
        pos: usize,
        prefix_space: bool,
        force_no_newline: bool,
    ) {
        if !self.owns_comments_after(pos) {
            return;
        }
        match prefix_space {
            true => self.writer.emit_trailing_comments(pos),
            false => self
                .writer
                .emit_trailing_comments_of_position(pos, force_no_newline),
        }
    }

    /// `enterNode`: `emitCommentsBeforeNode`, for a node from `pos` to `end`.
    #[optimize(size)]
    pub(super) fn enter_node(&mut self, pos: usize, end: usize) -> NodeState {
        let state = NodeState {
            pos,
            end,
            container_pos: self.container_pos,
            container_end: self.container_end,
            declaration_list_container_end: self.declaration_list_container_end,
        };
        if pos != end {
            self.emit_leading_comments(pos);
            self.container_pos = pos;
            self.container_end = end;
        }
        state
    }

    /// `enterNode` for a `VariableDeclarationList`.
    #[optimize(size)]
    pub(super) fn enter_declaration_list(&mut self, pos: usize, end: usize) -> NodeState {
        let state = self.enter_node(pos, end);
        if pos != end {
            self.declaration_list_container_end = end;
        }
        state
    }

    /// `exitNode`: `emitCommentsAfterNode`
    #[optimize(size)]
    pub(super) fn exit_node(&mut self, state: NodeState) {
        if state.pos != state.end {
            self.container_pos = state.container_pos;
            self.container_end = state.container_end;
            self.declaration_list_container_end = state.declaration_list_container_end;
            self.emit_trailing_comments(state.end);
        }
    }

    /// `emitToken(token, pos, writeKind, contextNode)`. Returns the same: the start of the token plus its length.
    #[optimize(size)]
    pub(super) fn emit_token(&mut self, token: &[u8], pos: usize, node: (usize, usize)) -> usize {
        let start = self.skip_trivia(pos);
        if node.0 != pos {
            self.emit_leading_comments(pos);
        }
        self.write(token);
        let end = start + token.len();
        if node.1 != end {
            self.emit_trailing_comments(end);
        }
        end
    }

    /// `emitTokenNode` for a token that is a node from `pos` to `end`. A missing one is written too.
    #[optimize(size)]
    pub(super) fn emit_token_node(&mut self, token: &[u8], pos: usize, end: usize) {
        let state = self.enter_node(pos, end);
        self.write(token);
        self.exit_node(state);
    }

    /// A node that is one token, from after the trivia at `pos` to `end`, written as `written`.
    #[optimize(size)]
    pub(super) fn emit_leaf(&mut self, pos: usize, end: usize, written: &[u8]) {
        let state = self.enter_node(pos, end);
        self.write(written);
        self.exit_node(state);
    }

    /// A node written as its source text: an identifier or a literal (`getTextOfNode`, `getLiteralTextOfNode`).
    #[optimize(size)]
    pub(super) fn emit_source(&mut self, pos: usize, end: usize) {
        let start = self.skip_trivia(pos);
        self.emit_leaf(pos, end, self.source(start, end));
    }

    // ───────────────────────────── lists ─────────────────────────────

    /// `emitList`. `parent`, `list`: `Pos()` and `End()` of the node and of its list, `None` for a list that is nil.
    #[inline(always)]
    pub(super) fn emit_list(
        &mut self,
        parent: (usize, usize),
        list: Option<(usize, usize)>,
        children: &[Child],
        format: u32,
        mut emit: impl FnMut(&mut Self, usize) -> Emitted,
    ) -> Emitted {
        self.emit_list_with(parent, list, children, format, &mut emit)
    }

    /// `emit_list`, compiled once for every `emit`.
    #[optimize(size)]
    fn emit_list_with(
        &mut self,
        parent: (usize, usize),
        list: Option<(usize, usize)>,
        children: &[Child],
        format: u32,
        emit: &mut dyn FnMut(&mut Self, usize) -> Emitted,
    ) -> Emitted {
        let is_empty = children.is_empty();
        if list.is_none() && format & lf::OPTIONAL_IF_NIL != 0
            || is_empty && format & lf::OPTIONAL_IF_EMPTY != 0
        {
            return Ok(());
        }
        let brackets: Option<(&[u8], &[u8])> = match format & lf::BRACKETS_MASK {
            lf::BRACES => Some((b"{", b"}")),
            lf::PARENTHESIS => Some((b"(", b")")),
            lf::ANGLE_BRACKETS => Some((b"<", b">")),
            lf::SQUARE_BRACKETS => Some((b"[", b"]")),
            _ => None,
        };
        if let Some((open, _)) = brackets {
            self.write(open);
            // "Emit comments within empty lists"
            if let (true, Some(list)) = (is_empty, list) {
                self.emit_trailing_comments(list.0);
            }
        }
        if is_empty {
            // "Write a line terminator if the parent node was multi-line"
            if format & lf::MULTI_LINE != 0 {
                self.write_line();
            } else if format & lf::SPACE_BETWEEN_BRACES != 0 && format & lf::NO_SPACE_IF_EMPTY == 0
            {
                self.write_space();
            }
        } else {
            self.emit_list_items(parent, list.unwrap_or((NONE, 0)), children, format, emit)?;
        }
        if let Some((_, close)) = brackets {
            if let (true, Some(list)) = (is_empty, list) {
                self.emit_leading_comments(list.1);
            }
            self.write(close);
        }
        Ok(())
    }

    /// `emitListItems`. No node is synthesized.
    #[optimize(size)]
    pub(super) fn emit_list_items(
        &mut self,
        parent: (usize, usize),
        list: (usize, usize),
        children: &[Child],
        format: u32,
        emit: &mut dyn FnMut(&mut Self, usize) -> Emitted,
    ) -> Emitted {
        let Some(&last) = children.last() else {
            return Ok(());
        };
        let is_delimited = format & lf::DELIMITERS_MASK != 0;
        let may_emit_intervening_comments = format & lf::NO_INTERVENING_COMMENTS == 0;
        let mut should_emit_intervening_comments = may_emit_intervening_comments;
        // `getLeadingLineTerminatorCount`
        let leads_with_line = match format & lf::PRESERVE_LINES != 0 {
            true if format & lf::PREFER_NEW_LINE != 0 => true,
            true if children[0].pos == self.next_list_element_pos => false,
            _ => format & lf::MULTI_LINE != 0,
        };
        if leads_with_line {
            self.write_line();
            should_emit_intervening_comments = false;
        } else if format & lf::SPACE_BETWEEN_BRACES != 0 {
            self.write_space();
        }
        if format & lf::INDENTED != 0 {
            self.increase_indent();
        }
        let mut previous: Option<Child> = None;
        for (index, &child) in children.iter().enumerate() {
            if let Some(previous) = previous {
                // A comment after the element, before the delimiter that is on a later line.
                if is_delimited && previous.end != parent.1 {
                    self.emit_leading_comments(previous.end);
                }
                // `writeDelimiter`
                match format & lf::DELIMITERS_MASK {
                    lf::COMMA_DELIMITED => self.write(b","),
                    lf::BAR_DELIMITED => self.write(b" |"),
                    lf::AMPERSAND_DELIMITED => self.write(b" &"),
                    _ => {}
                }
                // `getSeparatingLineTerminatorCount`
                let separates_with_line = match format & lf::PRESERVE_LINES != 0 {
                    true => self.is_on_next_line(previous.end, child.pos),
                    false => format & lf::MULTI_LINE != 0,
                };
                if separates_with_line {
                    if should_emit_intervening_comments && is_delimited {
                        let prefix_space = format & lf::SPACE_BETWEEN_SIBLINGS != 0;
                        self.emit_trailing_comments_of_position(child.pos, prefix_space, true);
                    }
                    self.write_line();
                    should_emit_intervening_comments = false;
                } else if format & lf::SPACE_BETWEEN_SIBLINGS != 0 {
                    self.write_space();
                }
            }
            if should_emit_intervening_comments {
                self.emit_trailing_comments_of_position(child.pos, false, false);
            } else {
                should_emit_intervening_comments = may_emit_intervening_comments;
            }
            self.next_list_element_pos = child.pos;
            emit(self, index)?;
            previous = Some(child);
        }
        // `children.HasTrailingComma()`: the list ends after its last element.
        let has_trailing_comma = last.end < list.1 && list.0 != NONE;
        let emits_trailing_comma = has_trailing_comma
            && format & lf::ALLOW_TRAILING_COMMA != 0
            && format & lf::COMMA_DELIMITED != 0;
        if emits_trailing_comma {
            self.emit_token(b",", last.end, (last.pos, last.end));
        }
        // A comment after the last element, on a later line.
        if parent.1 != last.end && is_delimited {
            let comments_pos = match emits_trailing_comma && list.1 > 0 {
                true => list.1,
                false => last.end,
            };
            self.emit_leading_comments(comments_pos);
        }
        if format & lf::INDENTED != 0 {
            self.decrease_indent();
        }
        // `getClosingLineTerminatorCount`
        let closes_with_line = match format & lf::PRESERVE_LINES != 0 {
            true => format & lf::PREFER_NEW_LINE != 0 || !self.on_same_line(parent.1, last.end),
            false => format & lf::MULTI_LINE != 0 && format & lf::NO_TRAILING_NEW_LINE == 0,
        };
        if closes_with_line {
            self.write_line();
        } else if format & (lf::SPACE_AFTER_LIST | lf::SPACE_BETWEEN_BRACES) != 0 {
            self.write_space();
        }
        Ok(())
    }

    /// `Loc` of the list after the bracket that ends at `open`. It ends where the token after it starts, with trivia.
    #[optimize(size)]
    pub(super) fn list_range(
        &self,
        open: usize,
        close: u8,
        last: Option<usize>,
        node_end: usize,
    ) -> (usize, usize) {
        let after_last = last.unwrap_or(open);
        let has_close =
            node_end > after_last && node_end > open && self.byte(node_end - 1) == close;
        let end = match has_close {
            true => skip_trivia_back(self.text, node_end - 1),
            false => node_end,
        };
        (open, end.max(after_last))
    }

    // ───────────────────────────── expressions ─────────────────────────────

    /// `Pos()` of `e`, with its parentheses: the end of the token before it.
    #[optimize(size)]
    pub(super) fn pos_of(&self, e: ExprId) -> usize {
        let hir = self.hir;
        let start = match (hir::open_parenthesis(hir, e), hir[e].kind) {
            (Some(open), _) => open,
            (None, ExprKind::Missing) => match self.end_of_missing_declaration(e) {
                Some(_) => hir[e].pos,
                // A missing node is where the token before it ends.
                None => return hir[e].end as usize,
            },
            (None, _) => hir::start_inside_parentheses(hir, e),
        };
        self.pos_before(start as usize)
    }

    /// `End()` of `e`, with its parentheses. A missing node ends where it starts.
    #[optimize(size)]
    pub(super) fn end_of(&self, e: ExprId) -> usize {
        let hir = self.hir;
        match hir::parentheses_around(hir, e).last() {
            Some(outermost) => outermost.2 as usize,
            None => self
                .end_of_missing_declaration(e)
                .unwrap_or(hir[e].end as usize),
        }
    }

    /// `End()` of `e` if it is a `MissingDeclaration`: decorators that decorate nothing (`File::stray_decorators`).
    #[optimize(size)]
    fn end_of_missing_declaration(&self, e: ExprId) -> Option<usize> {
        let hir = self.hir;
        let at = hir[e].pos as usize;
        if !matches!(hir[e].kind, ExprKind::Missing) || self.byte(at) != b'@' {
            return None;
        }
        let expression = self.skip_trivia(at + 1);
        let mut decorators = hir.stray_decorators.iter();
        let own = decorators.find(|it| it.0 as usize == expression)?;
        Some(own.1 as usize)
    }

    /// `<T>operand`, not `operand as T`: it starts before its operand.
    #[optimize(size)]
    pub(super) fn is_type_assertion(&self, e: ExprId, operand: ExprId) -> bool {
        let hir = self.hir;
        let start = hir::open_parenthesis(hir, operand);
        hir[e].pos < start.unwrap_or_else(|| hir::start_inside_parentheses(hir, operand))
    }

    /// `GetExpressionPrecedence` of `e` without the parentheses around it.
    #[optimize(size)]
    fn precedence_of(&self, e: ExprId) -> P {
        let hir = self.hir;
        match hir[e].kind {
            ExprKind::As { expr, .. } if self.is_type_assertion(e, expr) => P::Unary,
            ExprKind::As { .. } | ExprKind::Satisfies { .. } => P::Relational,
            ExprKind::Instantiation { .. } => P::Member,
            ExprKind::Fn(f) if hir[f].kind == FnKind::Arrow => P::Assignment,
            _ => P::for_expression(hir, e),
        }
    }

    /// The child of `e` that starts where `e` starts, and its precedence. A chain of these is as deep as it is long.
    #[optimize(size)]
    fn head_of(&self, e: ExprId) -> Option<(ExprId, P)> {
        let hir = self.hir;
        Some(match hir[e].kind {
            ExprKind::Binary { op, left, .. } => (
                left,
                binary_operand_precedences(P::for_binary_operator(op)).0,
            ),
            ExprKind::Assign { target, .. } => (target, P::Conditional),
            // `emitShortCircuitExpression`
            ExprKind::Cond { test, .. } => (test, P::LogicalOr),
            // `import.x` is a `MetaProperty`, which starts with a token.
            ExprKind::Dot { obj, .. } if hir.is_import_keyword(obj) => return None,
            ExprKind::Dot { obj, chain, .. } | ExprKind::Index { obj, chain, .. } => {
                (obj, P::for_chain(chain))
            }
            ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => {
                // `emitCallee`: "Parenthesize `new C` inside of a CallExpression"
                let callee = hir[call].callee;
                let is_new_without_arguments = matches!(hir[callee].kind, ExprKind::New(new) if hir[new].close_pos == u32::MAX)
                    && !hir::is_parenthesized(hir, callee);
                match is_new_without_arguments && matches!(hir[e].kind, ExprKind::Call(_)) {
                    true => (callee, P::Parentheses),
                    false => (callee, P::for_chain(hir[call].chain)),
                }
            }
            ExprKind::Unary {
                op: UnOp::PostInc | UnOp::PostDec,
                operand,
            } => (operand, P::LeftHandSide),
            ExprKind::NonNull(operand) => (operand, P::Member),
            ExprKind::As { expr, .. } if self.is_type_assertion(e, expr) => return None,
            ExprKind::AsConst(operand) if self.is_type_assertion(e, operand) => return None,
            ExprKind::As { expr, .. } | ExprKind::Satisfies { expr, .. } => (expr, P::Relational),
            ExprKind::AsConst(operand) => (operand, P::Relational),
            ExprKind::Instantiation { expr, .. } => (expr, P::Member),
            _ => return None,
        })
    }

    /// `emitExpression(node, precedence)`
    #[optimize(size)]
    pub(super) fn emit_expression(&mut self, e: ExprId, precedence: P) -> Emitted {
        let pos = self.pos_of(e);
        let parentheses = hir::parentheses_around(self.hir, e).len();
        self.emit_expression_at(e, pos, precedence, parentheses)
    }

    /// `emitExpression(node, precedence)` for `e` in the innermost `parentheses` of its parentheses. `pos`: `Pos()`.
    #[optimize(size)]
    fn emit_expression_at(
        &mut self,
        e: ExprId,
        pos: usize,
        precedence: P,
        parentheses: usize,
    ) -> Emitted {
        if self.c.is_stack_low_for_printing() {
            return Err(Stop::OutOfStack);
        }
        // Entered and not finished, from the outermost. This frame is on the stack once per level of nesting.
        let mut entered: Vec<Entered> = Vec::new();
        let mut next = Some((e, pos, precedence, parentheses));
        loop {
            if let Some((e, pos, precedence, parentheses)) = next.take() {
                next = match parentheses {
                    0 => self.emit_to_tail(e, pos, precedence, &mut entered)?,
                    _ => self
                        .emit_parenthesized(e, parentheses, pos)
                        .map(|()| None)?,
                };
                continue;
            }
            let Some(top) = entered.pop() else {
                return Ok(());
            };
            for _ in 0..top.unindent {
                self.decrease_indent();
            }
            let tail = match top.step {
                Step::AfterHead => self.emit_after_head(top.node, top.pos)?,
                Step::AfterYes(yes, no) => Some(self.emit_after_yes(yes, no)),
                Step::End => None,
            };
            let Some(tail) = tail else {
                self.exit_node(top.state);
                if top.needs_parentheses {
                    self.write(b")");
                }
                continue;
            };
            entered.push(Entered {
                unindent: tail.unindent,
                step: tail.then,
                ..top
            });
            next = Some(self.at_tail(&tail));
        }
    }

    /// The arguments of `emit_expression_at` for the child of `tail`: see `emit_expression`.
    #[optimize(size)]
    fn at_tail(&self, tail: &Tail) -> (ExprId, usize, P, usize) {
        let parentheses = hir::parentheses_around(self.hir, tail.child).len();
        (
            tail.child,
            self.pos_of(tail.child),
            tail.precedence,
            parentheses,
        )
    }

    /// `e` without its parentheses, up to a child that the caller emits. `entered` gets the nodes that the child is in.
    #[inline(always)]
    fn emit_to_tail(
        &mut self,
        e: ExprId,
        pos: usize,
        precedence: P,
        entered: &mut Vec<Entered>,
    ) -> Result<Option<(ExprId, usize, P, usize)>, Stop> {
        let hir = self.hir;
        // The nodes that start where `e` starts, from the outermost.
        let (mut node, mut required) = (e, precedence);
        let mut is_import_keyword = false;
        while let Some((head, of_head)) = self.head_of(node) {
            let needs_parentheses = self.precedence_of(node) < required;
            if needs_parentheses {
                self.write(b"(");
            }
            let state = self.enter_node(pos, hir[node].end as usize);
            entered.push(Entered {
                node,
                pos,
                state,
                needs_parentheses,
                unindent: 0,
                step: Step::AfterHead,
            });
            if let ExprKind::NonNull(_) = hir[node].kind {
                self.enter_non_null_run(node, pos, entered);
            }
            is_import_keyword = self.is_import_keyword_of(node, head);
            (node, required) = (head, of_head);
            if is_import_keyword || !hir::parentheses_around(hir, node).is_empty() {
                break;
            }
        }
        // The parentheses around `e` itself are emitted.
        let around = match node == e {
            true => 0,
            false => hir::parentheses_around(hir, node).len(),
        };
        if is_import_keyword {
            // `emitKeywordExpression`
            self.emit_leaf(pos, self.end_of_head(node, true), b"import");
        } else if around > 0 {
            self.emit_parenthesized(node, around, pos)?;
        } else if let Some((tail, state, needs_parentheses)) =
            self.emit_without_head(node, pos, required)?
        {
            let next = self.at_tail(&tail);
            entered.push(Entered {
                node,
                pos,
                state,
                needs_parentheses,
                unindent: tail.unindent,
                step: tail.then,
            });
            return Ok(Some(next));
        }
        Ok(None)
    }

    /// Whether `head` is the `import` of `import<T>` or of a tagged template: a missing expression in the HIR.
    #[optimize(size)]
    fn is_import_keyword_of(&self, e: ExprId, head: ExprId) -> bool {
        matches!(
            self.hir[e].kind,
            ExprKind::Instantiation { .. } | ExprKind::TaggedTemplate(_)
        ) && self.hir.is_import_keyword(head)
    }

    /// `End()` of `head`, the first child of a node. `is_import_keyword`: `is_import_keyword_of`.
    #[optimize(size)]
    fn end_of_head(&self, head: ExprId, is_import_keyword: bool) -> usize {
        if is_import_keyword {
            let start = self.hir[head].pos as usize;
            return self.token_end_at(b"import", start).unwrap_or(start + 6);
        }
        self.end_of(head)
    }

    /// `x!!!` is one node of the HIR. Enters each inner `NonNullExpression`, in the parentheses that the printer adds.
    #[optimize(size)]
    fn enter_non_null_run(&mut self, e: ExprId, pos: usize, entered: &mut Vec<Entered>) {
        for &(_, inner_end) in hir::non_null_ends_in(self.hir, e).iter().rev() {
            self.write(b"(");
            let state = self.enter_node(pos, inner_end as usize);
            entered.push(Entered {
                node: e,
                pos,
                state,
                needs_parentheses: true,
                unindent: 0,
                step: Step::AfterHead,
            });
        }
    }

    /// `emitParenthesizedExpression` for the outermost of the innermost `parentheses` of the parentheses around `e`.
    #[optimize(size)]
    fn emit_parenthesized(&mut self, e: ExprId, parentheses: usize, pos: usize) -> Emitted {
        let around = hir::parentheses_around(self.hir, e);
        let Some(&(_, open, end)) = around.get(parentheses - 1) else {
            return Ok(());
        };
        let (open, end) = (open as usize, end as usize);
        let state = self.enter_node(pos, end);
        self.emit_token(b"(", pos, (pos, end));
        self.emit_expression_at(e, open + 1, P::Comma, parentheses - 1)?;
        let inner_end = match parentheses {
            1 => self
                .end_of_missing_declaration(e)
                .unwrap_or(self.hir[e].end as usize),
            _ => around[parentheses - 2].2 as usize,
        };
        self.emit_token(b")", inner_end, (pos, end));
        self.exit_node(state);
        Ok(())
    }

    /// The rest of `e` after its first child (`head_of`). Returns the child that the caller emits before `e` ends.
    #[inline(never)]
    #[optimize(size)]
    fn emit_after_head(&mut self, e: ExprId, pos: usize) -> Result<Option<Tail>, Stop> {
        let hir = self.hir;
        let end = hir[e].end as usize;
        let node = (pos, end);
        match hir[e].kind {
            ExprKind::Binary { op, left, right } => {
                let operator = super::errors::operator_text(op, false);
                let of_right = binary_operand_precedences(P::for_binary_operator(op)).1;
                return Ok(Some(
                    self.emit_binary_rest(left, right, &operator, of_right),
                ));
            }
            ExprKind::Assign { op, target, value } => {
                let operator = match op {
                    Some(op) => super::errors::operator_text(op, true),
                    None => b"=".to_vec(),
                };
                return Ok(Some(self.emit_binary_rest(
                    target,
                    value,
                    &operator,
                    P::Yield,
                )));
            }
            ExprKind::Cond { test, branches } => {
                let Branches { yes, no } = hir.branches(branches);
                let test_end = self.end_of(test);
                let question = self.skip_trivia(test_end);
                let question_end = question + 1;
                let lines_before_question = self.is_on_next_line(test_end, test_end);
                let lines_after_question = self.is_on_next_line(question_end, self.pos_of(yes));
                self.write_lines_and_indent(lines_before_question, true);
                self.emit_token_node(b"?", test_end, question_end);
                self.write_lines_and_indent(lines_after_question, true);
                return Ok(Some(Tail {
                    child: yes,
                    precedence: P::Yield,
                    unindent: u8::from(lines_before_question) + u8::from(lines_after_question),
                    then: Step::AfterYes(yes, no),
                }));
            }
            ExprKind::Dot {
                obj, name, chain, ..
            } => {
                let object_end = self.end_of(obj);
                let is_question_dot = chain == Chain::Start;
                let token: &[u8] = if is_question_dot { b"?." } else { b"." };
                // A `.` that the source does not have is a token without text.
                let dot_end = self.token_after(token, object_end).unwrap_or(object_end);
                let lines_before_dot = self.is_on_next_line(object_end, object_end);
                if lines_before_dot {
                    self.write_line();
                }
                self.increase_indent_if(lines_before_dot);
                if is_question_dot {
                    self.emit_token_node(token, object_end, dot_end);
                } else {
                    if self.may_need_dot_dot_for_property_access(obj) {
                        self.write(b".");
                    }
                    self.emit_token(b".", object_end, node);
                }
                let lines_after_dot = self.is_on_next_line(dot_end, dot_end);
                if lines_after_dot {
                    self.write_line();
                }
                self.increase_indent_if(lines_after_dot);
                // `emitMemberName`. A name that is missing has no text.
                let name_start = hir.name_pos(e) as usize;
                if name.is_some() && name_start >= dot_end && name_start < end {
                    self.emit_leaf(dot_end, end, self.source(name_start, end));
                }
                self.decrease_indent_if(lines_after_dot);
                self.decrease_indent_if(lines_before_dot);
            }
            ExprKind::Index { obj, index, chain } => {
                let mut at = self.end_of(obj);
                if chain == Chain::Start {
                    let question_dot = self.token_after(b"?.", at).unwrap_or(at);
                    self.emit_token_node(b"?.", at, question_dot);
                    at = question_dot;
                }
                self.emit_token(b"[", at, node);
                self.emit_expression(index, P::Comma)?;
                self.emit_token(b"]", self.end_of(index), node);
            }
            ExprKind::Call(call) => {
                let call = &hir[call];
                let mut at = self.end_of(call.callee);
                if call.chain == Chain::Start {
                    let question_dot = self.token_after(b"?.", at).unwrap_or(at);
                    self.emit_token_node(b"?.", at, question_dot);
                    at = question_dot;
                }
                let type_args = hir.list_at(call.type_args);
                at = self.emit_type_arguments(node, type_args, at)?;
                self.emit_arguments(call.args, at, node, lf::CALL_EXPRESSION_ARGUMENTS)?;
            }
            ExprKind::TaggedTemplate(call) => {
                let call = &hir[call];
                let type_args = hir.list_at(call.type_args);
                let tag_end =
                    self.end_of_head(call.callee, self.is_import_keyword_of(e, call.callee));
                self.emit_type_arguments(node, type_args, tag_end)?;
                self.write_space();
                self.emit_expression(hir.template_of(hir_call_id(hir, e)), P::Comma)?;
            }
            ExprKind::Unary { op, operand } => {
                self.emit_token(unary_operator_text(op), self.end_of(operand), node);
            }
            ExprKind::NonNull(_) => self.write(b"!"),
            ExprKind::As { ty, .. } => {
                self.write(b" as ");
                self.emit_type_node(ty)?;
            }
            ExprKind::Satisfies { ty, .. } => {
                self.write(b" satisfies ");
                self.emit_type_node(ty)?;
            }
            ExprKind::AsConst(operand) => {
                // The type is a reference to the name `const`.
                self.write(b" as ");
                let keyword_end = self.token_after(b"as", self.end_of(operand)).unwrap_or(end);
                self.emit_source(keyword_end, end);
            }
            ExprKind::Instantiation { type_args, .. } => {
                let ExprKind::Instantiation { expr, .. } = hir[e].kind else {
                    return Ok(None);
                };
                let expression_end = self.end_of_head(expr, self.is_import_keyword_of(e, expr));
                self.emit_type_arguments(node, hir.list_at(type_args), expression_end)?;
            }
            _ => {}
        }
        Ok(None)
    }

    /// `emitConditionalExpression`, after the branch `yes` and up to the branch `no`.
    #[optimize(size)]
    fn emit_after_yes(&mut self, yes: ExprId, no: ExprId) -> Tail {
        let yes_end = self.end_of(yes);
        // A `:` that is missing is a token without text, where the token before it ends.
        let colon_end = self.token_after(b":", yes_end).unwrap_or(yes_end);
        let lines_before_colon = self.is_on_next_line(yes_end, yes_end);
        let lines_after_colon = self.is_on_next_line(colon_end, self.pos_of(no));
        self.write_lines_and_indent(lines_before_colon, true);
        self.emit_token_node(b":", yes_end, colon_end);
        self.write_lines_and_indent(lines_after_colon, true);
        Tail {
            child: no,
            precedence: P::Yield,
            unindent: u8::from(lines_before_colon) + u8::from(lines_after_colon),
            then: Step::End,
        }
    }

    /// `emitBinaryExpression`, after the left operand and up to the right one.
    #[optimize(size)]
    fn emit_binary_rest(
        &mut self,
        left: ExprId,
        right: ExprId,
        operator: &[u8],
        of_right: P,
    ) -> Tail {
        let left_end = self.end_of(left);
        let operator_start = self.skip_trivia(left_end);
        // A keyword that is written with escapes is longer than its text.
        let operator_end = self
            .token_end_at(operator, operator_start)
            .unwrap_or(operator_start + operator.len());
        // The comma between two JSX elements without a parent is no token: it has no width, where the right one starts.
        let right_pos = self.pos_of(right);
        let is_written = operator != b"," || self.byte(operator_start) == b',';
        let (operator_pos, operator_end) = match is_written {
            true => (left_end, operator_end),
            false => (right_pos, right_pos),
        };
        let lines_before_operator = self.is_on_next_line(left_end, operator_pos);
        let lines_after_operator = self.is_on_next_line(operator_end, right_pos);
        self.write_lines_and_indent(lines_before_operator, operator != b",");
        self.emit_token_node(operator, operator_pos, operator_end);
        self.write_lines_and_indent(lines_after_operator, true);
        Tail {
            child: right,
            precedence: of_right,
            unindent: u8::from(lines_before_operator) + u8::from(lines_after_operator),
            then: Step::End,
        }
    }

    /// `mayNeedDotDotForPropertyAccess`, and that nothing follows the literal.
    #[optimize(size)]
    fn may_need_dot_dot_for_property_access(&self, obj: ExprId) -> bool {
        let hir = self.hir;
        let ExprKind::Number(index) = hir[obj].kind else {
            return false;
        };
        if hir::is_parenthesized(hir, obj) {
            return false;
        }
        let (start, end) = (hir[obj].pos as usize, hir[obj].end as usize);
        let written = self.number_literal_text(index, start, end);
        !matches!(
            self.source(start, end),
            [b'0', b'x' | b'X' | b'b' | b'B' | b'o' | b'O', ..]
        ) && bun_core::strings::index_of_any(&written, b".eE").is_none()
            && !self.has_trailing_comment_or_whitespace()
    }

    /// `getLiteralTextOfNode` for a numeric literal: its text, or its value if it is invalid or has a separator.
    #[optimize(size)]
    pub(super) fn number_literal_text(&self, index: u32, start: usize, end: usize) -> Vec<u8> {
        let written = self.source(start, end);
        if self.is_numeric_literal_written_as_value(written) {
            let value = self.hir.numbers.get(index as usize).copied().unwrap_or(0.0);
            return crate::atom::number_to_string(value);
        }
        written.to_vec()
    }

    /// `canUseOriginalText`, negated, for the numeric literal `written`.
    #[optimize(size)]
    pub(super) fn is_numeric_literal_written_as_value(&self, written: &[u8]) -> bool {
        let (is_invalid, has_separator) = numeric_literal_flags(written);
        is_invalid || has_separator && !self.allows_numeric_separators
    }

    /// `emitKeywordNode`: a node that is the keyword `keyword`. Returns its end.
    #[optimize(size)]
    pub(super) fn emit_keyword(&mut self, pos: usize, keyword: &[u8]) -> usize {
        let start = self.skip_trivia(pos);
        let end = self
            .token_end_at(keyword, start)
            .unwrap_or(start + keyword.len());
        self.emit_leaf(pos, end, keyword);
        end
    }

    /// An expression that starts with no other one. If it ends with an operand, returns it and what finishes the node.
    #[inline(never)]
    #[optimize(size)]
    fn emit_without_head(
        &mut self,
        e: ExprId,
        pos: usize,
        precedence: P,
    ) -> Result<Option<(Tail, NodeState, bool)>, Stop> {
        let hir = self.hir;
        let needs_parentheses = self.precedence_of(e) < precedence;
        if needs_parentheses {
            self.write(b"(");
        }
        let end = hir[e].end as usize;
        let node = (pos, end);
        let start = self.skip_trivia(pos);
        match hir[e].kind {
            // An identifier without text, or an `OmittedExpression`.
            ExprKind::Missing => {}
            ExprKind::Ident(_)
            | ExprKind::PrivateIdentifier(_)
            | ExprKind::String(_)
            | ExprKind::Regex => self.emit_source(pos, end),
            // `emitKeywordExpression`, `emitTokenNode`
            ExprKind::This => self.emit_leaf(pos, end, b"this"),
            ExprKind::Super => self.emit_leaf(pos, end, b"super"),
            ExprKind::Null => self.emit_leaf(pos, end, b"null"),
            ExprKind::True => self.emit_leaf(pos, end, b"true"),
            ExprKind::False => self.emit_leaf(pos, end, b"false"),
            ExprKind::Number(index) => {
                let written = self.number_literal_text(index, start, end);
                self.emit_leaf(pos, end, &written);
            }
            // `node.Text()`: the text of a bigint literal is never that of the source.
            ExprKind::BigInt(_) => {
                let written = crate::json::bigint_token_value(self.source(start, end));
                self.emit_leaf(pos, end, &written);
            }
            ExprKind::Template { exprs } => self.emit_template(exprs, pos, end)?,
            ExprKind::Array(items) => {
                let state = self.enter_node(pos, end);
                let children: Vec<Child> = hir
                    .ids(items)
                    .map(|item: ExprId| Child {
                        pos: self.pos_of(item),
                        end: self.end_of(item),
                    })
                    .collect();
                let list = self.list_range(start + 1, b']', children.last().map(|it| it.end), end);
                // `node.MultiLine`
                let prefers_new_line = match self.is_on_next_line(start + 1, start + 1) {
                    true => lf::PREFER_NEW_LINE,
                    false => lf::NONE,
                };
                let format = lf::ARRAY_LITERAL_EXPRESSION_ELEMENTS | prefers_new_line;
                self.emit_list(node, Some(list), &children, format, |printer, index| {
                    let item: ExprId = hir.id_at(items, index);
                    printer.emit_expression(item, P::Spread)
                })?;
                self.exit_node(state);
            }
            ExprKind::Object(props) => self.emit_object_literal(props, pos, end)?,
            ExprKind::ImportCall { args } => {
                let state = self.enter_node(pos, end);
                let mut at = self.emit_import_callee(e, pos);
                let type_args = hir.type_args_of_import_call(args);
                at = self.emit_type_arguments(node, type_args, at)?;
                self.emit_arguments(args, at, node, lf::CALL_EXPRESSION_ARGUMENTS)?;
                self.exit_node(state);
            }
            ExprKind::New(call) => {
                let call = &hir[call];
                let state = self.enter_node(pos, end);
                self.emit_token(b"new", pos, node);
                self.write_space();
                // "Parenthesize `C()` inside of a NewExpression"
                let is_call = matches!(
                    hir[call.callee].kind,
                    ExprKind::Call(_) | ExprKind::ImportCall { .. }
                ) && !hir::is_parenthesized(hir, call.callee);
                let of_callee = if is_call { P::Parentheses } else { P::Member };
                let type_args = hir.list_at(call.type_args);
                // `LFOptionalIfNil`
                let has_arguments = call.close_pos != u32::MAX;
                if type_args.is_empty() && !has_arguments {
                    return Ok(Some((
                        Tail::last(call.callee, of_callee),
                        state,
                        needs_parentheses,
                    )));
                }
                self.emit_expression(call.callee, of_callee)?;
                let at = self.emit_type_arguments(node, type_args, self.end_of(call.callee))?;
                if has_arguments {
                    self.emit_arguments(call.args, at, node, lf::NEW_EXPRESSION_ARGUMENTS)?;
                }
                self.exit_node(state);
            }
            ExprKind::Unary { op, operand } => {
                let state = self.enter_node(pos, end);
                self.emit_token(unary_operator_text(op), pos, node);
                let inner = match hir[operand].kind {
                    ExprKind::Unary { op: inner, .. } if !hir::is_parenthesized(hir, operand) => {
                        Some(inner)
                    }
                    _ => None,
                };
                // `delete`, `typeof` and `void` are expressions of their own, and have a space.
                let has_space = matches!(
                    (op, inner),
                    (UnOp::Typeof | UnOp::Void | UnOp::Delete, _)
                        | (UnOp::Plus, Some(UnOp::Plus | UnOp::PreInc))
                        | (UnOp::Minus, Some(UnOp::Minus | UnOp::PreDec))
                );
                if has_space {
                    self.write_space();
                }
                return Ok(Some((
                    Tail::last(operand, P::Unary),
                    state,
                    needs_parentheses,
                )));
            }
            ExprKind::Await(operand) => {
                let state = self.enter_node(pos, end);
                self.emit_token(b"await", pos, node);
                self.write_space();
                return Ok(Some((
                    Tail::last(operand, P::Unary),
                    state,
                    needs_parentheses,
                )));
            }
            ExprKind::Spread(operand) => {
                let state = self.enter_node(pos, end);
                self.emit_token(b"...", pos, node);
                return Ok(Some((
                    Tail::last(operand, P::Yield),
                    state,
                    needs_parentheses,
                )));
            }
            ExprKind::Yield { value, star } => {
                let state = self.enter_node(pos, end);
                let keyword_end = self.token_end_at(b"yield", start).unwrap_or(start + 5);
                self.emit_token(b"yield", pos, node);
                if star {
                    let asterisk_end = self.token_after(b"*", keyword_end).unwrap_or(keyword_end);
                    self.emit_token_node(b"*", keyword_end, asterisk_end);
                }
                if value.is_some() {
                    self.write_space();
                    return Ok(Some((
                        Tail::last(value, P::Yield),
                        state,
                        needs_parentheses,
                    )));
                }
                self.exit_node(state);
            }
            ExprKind::As { expr, ty } => {
                // `emitTypeAssertionExpression`
                let state = self.enter_node(pos, end);
                self.write(b"<");
                self.emit_type_node(ty)?;
                self.write(b">");
                return Ok(Some((
                    Tail::last(expr, P::Update),
                    state,
                    needs_parentheses,
                )));
            }
            ExprKind::AsConst(operand) => {
                // `<const>e`: the type is a reference to the name `const`.
                let state = self.enter_node(pos, end);
                self.write(b"<");
                let name = self.skip_trivia(start + 1);
                self.emit_source(start + 1, word_end(self.text, name));
                self.write(b">");
                return Ok(Some((
                    Tail::last(operand, P::Update),
                    state,
                    needs_parentheses,
                )));
            }
            ExprKind::ImportMeta | ExprKind::NewTarget(_) | ExprKind::Dot { .. } => {
                // `emitMetaProperty`
                let state = self.enter_node(pos, end);
                let keyword: &[u8] = match hir[e].kind {
                    ExprKind::NewTarget(_) => b"new",
                    _ => b"import",
                };
                let keyword_end = self
                    .token_end_at(keyword, start)
                    .unwrap_or(start + keyword.len());
                self.emit_token(keyword, pos, node);
                self.write(b".");
                let dot_end = self.token_after(b".", keyword_end).unwrap_or(keyword_end);
                self.emit_source(dot_end, end);
                self.exit_node(state);
            }
            ExprKind::Fn(f) => self.emit_function_expression(e, f, pos)?,
            ExprKind::Class(class) => self.emit_class_expression(e, class, pos)?,
            ExprKind::Jsx(jsx) => self.emit_jsx(e, jsx, pos)?,
            // The kinds that start with their first child: `emit_expression` has emitted that.
            _ => {}
        }
        if needs_parentheses {
            self.write(b")");
        }
        Ok(None)
    }

    /// The `import` of `import(..)`, or the `import.defer` of `import.defer(..)`, a `MetaProperty`. Returns its end.
    #[optimize(size)]
    fn emit_import_callee(&mut self, e: ExprId, pos: usize) -> usize {
        let hir = self.hir;
        let start = self.skip_trivia(pos);
        let keyword_end = self.token_end_at(b"import", start).unwrap_or(start + 6);
        let ExprKind::ImportCall { args } = hir[e].kind else {
            return keyword_end;
        };
        let specifier: ExprId = hir.id_at(args, 0);
        let is_deferred = hir.deferred_import_calls.iter().any(|it| it.0 == specifier);
        let Some(dot_end) = self.token_after(b".", keyword_end).filter(|_| is_deferred) else {
            self.emit_leaf(pos, keyword_end, b"import");
            return keyword_end;
        };
        let name = self.skip_trivia(dot_end);
        let name_end = word_end(self.text, name);
        let state = self.enter_node(pos, name_end);
        self.emit_token(b"import", pos, (pos, name_end));
        self.write(b".");
        self.emit_source(dot_end, name_end);
        self.exit_node(state);
        name_end
    }

    /// `emitList(emitArgument, node, node.Arguments, format)`. `before`: the end of what precedes the `(`.
    #[optimize(size)]
    fn emit_arguments(
        &mut self,
        args: IdList<ExprId>,
        before: usize,
        node: (usize, usize),
        format: u32,
    ) -> Emitted {
        let hir = self.hir;
        // A list that is missing is at the end of the token before it, and has no element.
        let open_end = self.token_after(b"(", before).unwrap_or(before);
        // The placeholder for the specifier that `import()` has not.
        let is_placeholder = |argument: ExprId| {
            args.len() == 1
                && matches!(hir[argument].kind, ExprKind::Missing)
                && !hir::is_parenthesized(hir, argument)
                && matches!(self.byte(self.skip_trivia(open_end)), b')' | 0)
        };
        let children: Vec<Child> = hir
            .ids(args)
            .filter(|&argument: &ExprId| !is_placeholder(argument))
            .map(|argument: ExprId| Child {
                pos: self.pos_of(argument),
                end: self.end_of(argument),
            })
            .collect();
        let list = self.list_range(open_end, b')', children.last().map(|it| it.end), node.1);
        self.emit_list(node, Some(list), &children, format, |printer, index| {
            let argument: ExprId = hir.id_at(args, index);
            printer.emit_expression(argument, P::Spread)
        })
    }

    /// `emitTemplateExpression`, `emitNoSubstitutionTemplateLiteral`
    #[optimize(size)]
    fn emit_template(&mut self, exprs: IdList<ExprId>, pos: usize, end: usize) -> Emitted {
        let hir = self.hir;
        let start = self.skip_trivia(pos);
        if exprs.is_empty() {
            self.emit_source(pos, end);
            return Ok(());
        }
        let state = self.enter_node(pos, end);
        // `emitTemplateHead`
        let (mut piece_end, _) = template_text(self.text, start + 1);
        piece_end = piece_end.min(end);
        self.emit_leaf(pos, piece_end, self.source(start, piece_end));
        for substitution in hir.ids(exprs) {
            // `emitTemplateSpan`
            let substitution: ExprId = substitution;
            let expression_end = self.end_of(substitution);
            let literal = self.skip_trivia(expression_end);
            // A `}` that is missing: the literal has no text.
            let literal_end = match self.byte(literal) {
                b'}' if literal < end => template_text(self.text, literal + 1).0.min(end),
                _ => expression_end,
            };
            let span = self.enter_node(piece_end, literal_end);
            self.emit_expression(substitution, P::Comma)?;
            self.emit_leaf(
                expression_end,
                literal_end,
                self.source(literal, literal_end),
            );
            self.exit_node(span);
            piece_end = literal_end;
        }
        self.exit_node(state);
        Ok(())
    }

    /// `emitObjectLiteralExpression`
    #[optimize(size)]
    fn emit_object_literal(&mut self, props: Span<PropId>, pos: usize, end: usize) -> Emitted {
        let hir = self.hir;
        let start = self.skip_trivia(pos);
        let state = self.enter_node(pos, end);
        let children: Vec<Child> = props
            .iter()
            .map(|p| Child {
                pos: self.pos_before(hir[p].start as usize),
                end: self.c.end_of_prop(self.file, p) as usize,
            })
            .collect();
        let list = self.list_range(start + 1, b'}', children.last().map(|it| it.end), end);
        // `node.MultiLine`
        let prefers_new_line = match self.is_on_next_line(start + 1, start + 1) {
            true => lf::PREFER_NEW_LINE,
            false => lf::NONE,
        };
        let format =
            lf::OBJECT_LITERAL_EXPRESSION_PROPERTIES | lf::ALLOW_TRAILING_COMMA | prefers_new_line;
        self.emit_list(
            (pos, end),
            Some(list),
            &children,
            format,
            |printer, index| {
                let p = PropId(props.start + index as u32);
                printer.emit_object_literal_element(p, children[index])
            },
        )?;
        self.exit_node(state);
        Ok(())
    }
}

/// `getBinaryExpressionPrecedence` for the operands. The parser creates no right operand that is the operator itself.
#[optimize(size)]
fn binary_operand_precedences(precedence: P) -> (P, P) {
    match precedence {
        P::Assignment => (P::Conditional, P::Yield),
        P::LogicalOr => (precedence, P::LogicalAnd),
        P::LogicalAnd => (precedence, P::BitwiseOr),
        P::Equality => (precedence, P::Relational),
        P::Relational => (precedence, P::Shift),
        P::Shift => (precedence, P::Additive),
        P::Additive => (precedence, P::Multiplicative),
        P::Multiplicative => (precedence, P::Exponentiation),
        P::Exponentiation => (P::Update, precedence),
        _ => (precedence, precedence),
    }
}

/// The call of the tagged template `e`.
#[optimize(size)]
fn hir_call_id(hir: &hir::File, e: ExprId) -> CallId {
    match hir[e].kind {
        ExprKind::TaggedTemplate(call) | ExprKind::Call(call) | ExprKind::New(call) => call,
        _ => CallId(u32::MAX),
    }
}
