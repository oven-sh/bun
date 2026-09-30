//! Producer 1 of the node table: the statements of Bun's parse, walked in step with the scanner of the reference.

mod declarations;
mod expressions;
mod modules;
mod statements;
#[cfg(test)]
mod tests;
mod type_arguments;

use crate::ast::{
    Arg, CommentDirective, FileBuilder, Kind, ModifierListId, NodeFactory, NodeFlags, NodeId,
    NodeListId, NodeSink,
};
use crate::core::{LanguageVariant, ScriptKind, TextRange, new_text_range};
use crate::diagnostics::{self, MessageId};
use crate::scanner::{Scanner, ScannerState, new_scanner};
use bun_ast::{Stmt, StmtData};
use std::cell::{Cell, RefCell};
use std::rc::Rc;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LowerErrorKind {
    // The token at `pos` is not the one that the tree of the parse has there.
    OutOfStep,
    // The tree holds a node that the lowering has no node of the reference for.
    Unsupported,
    // The thread has no stack left for a tree this deep.
    StackLimit,
}

// Why a file has no table: the caller reports it as an internal diagnostic.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub struct LowerError {
    pub kind: LowerErrorKind,
    pub pos: i32,
    pub what: &'static str,
}

pub(crate) type Lowering<T> = Result<T, LowerError>;

// A diagnostic that the parser of the reference reports for the tokens of the file.
#[derive(Clone)]
pub struct ParseDiagnostic {
    pub message: MessageId,
    pub loc: TextRange,
    pub args: Vec<Vec<u8>>,
}

#[derive(Clone, Copy)]
pub struct LowerOptions {
    pub script_kind: ScriptKind,
    pub is_declaration_file: bool,
    // ExternalModuleIndicatorOptions.Force of the reference.
    pub force_module: bool,
}

// What `FileBuilder::finish` and the file data need besides the nodes. The node ids are ids of the builder, which `finish` maps.
pub struct Lowered {
    // The SourceFile node.
    pub root: NodeId,
    // SetExternalModuleIndicator: the first statement that makes the file a module, else the first `import.meta`, else the root when the module is forced.
    pub external_module_indicator: NodeId,
    pub identifier_count: u32,
    pub diagnostics: Vec<ParseDiagnostic>,
    pub comment_directives: Vec<CommentDirective>,
}

// Fills `builder` with the tree of `statements`, which Bun parsed from `text` without visiting.
pub fn lower_source_file(
    builder: &mut FileBuilder,
    text: &[u8],
    statements: &[Stmt],
    options: LowerOptions,
) -> Result<Lowered, LowerError> {
    let mut lowerer = Lowerer::new(builder, text, options);
    lowerer.next_token();
    let root = lowerer.lower_source(statements, options)?;
    let diagnostics = match lowerer.errors.diagnostics.try_borrow_mut() {
        Ok(mut diagnostics) => std::mem::take(&mut *diagnostics),
        Err(_) => Vec::new(),
    };
    Ok(Lowered {
        root,
        external_module_indicator: lowerer.external_module_indicator,
        identifier_count: lowerer.identifier_count,
        diagnostics,
        comment_directives: lowerer.scanner.comment_directives().to_vec(),
    })
}

// jsdocScannerInfo of the reference.
pub(crate) const JSDOC_PRESENT: u8 = 1 << 0;
pub(crate) const JSDOC_DEPRECATED: u8 = 1 << 1;

// The parsing contexts of the reference that a class declaration reads.
pub(crate) const PC_SOURCE_ELEMENTS: u8 = 1 << 0;
pub(crate) const PC_BLOCK_STATEMENTS: u8 = 1 << 1;
pub(crate) const PC_SWITCH_CLAUSE_STATEMENTS: u8 = 1 << 2;

#[derive(Default)]
struct ErrorState {
    diagnostics: RefCell<Vec<ParseDiagnostic>>,
    has_parse_error: Cell<bool>,
}

impl ErrorState {
    // parseErrorAtRange: a second error at the position of the last one is not kept.
    fn report(&self, message: MessageId, pos: i32, end: i32, args: &[Arg<'_>]) {
        if let Ok(mut diagnostics) = self.diagnostics.try_borrow_mut() {
            if diagnostics.last().is_none_or(|last| last.loc.pos() != pos) {
                diagnostics.push(ParseDiagnostic {
                    message,
                    loc: new_text_range(pos, end),
                    args: own_args(args),
                });
            }
        }
        self.has_parse_error.set(true);
    }
}

fn own_args(args: &[Arg<'_>]) -> Vec<Vec<u8>> {
    args.iter()
        .map(|arg| match arg {
            Arg::Str(text) => text.to_vec(),
            Arg::Int(value) => value.to_string().into_bytes(),
            Arg::Bool(value) => (if *value { &b"true"[..] } else { &b"false"[..] }).to_vec(),
        })
        .collect()
}

// getLanguageVariant
fn get_language_variant(script_kind: ScriptKind) -> LanguageVariant {
    if script_kind == ScriptKind::TSX
        || script_kind == ScriptKind::JSX
        || script_kind == ScriptKind::JS
        || script_kind == ScriptKind::JSON
    {
        return LanguageVariant::JSX;
    }
    LanguageVariant::STANDARD
}

// ast.IsKeyword
pub(crate) fn is_keyword(kind: Kind) -> bool {
    kind >= Kind::BreakKeyword && kind <= Kind::DeferKeyword
}

// tokenIsIdentifierOrKeyword
pub(crate) fn token_is_identifier_or_keyword(kind: Kind) -> bool {
    kind >= Kind::Identifier
}

// The statements of one list of Bun's parse. A comment that the parser kept as a statement has no token.
pub(crate) struct StmtCursor<'t> {
    stmts: &'t [Stmt],
    index: usize,
}

impl<'t> StmtCursor<'t> {
    pub(crate) fn new(stmts: &'t [Stmt], index: usize) -> Self {
        Self { stmts, index }
    }

    pub(crate) fn peek(&mut self) -> Option<&'t Stmt> {
        while let Some(stmt) = self.stmts.get(self.index) {
            if !matches!(stmt.data, StmtData::SComment(_)) {
                return Some(stmt);
            }
            self.index += 1;
        }
        None
    }

    pub(crate) fn bump(&mut self) {
        self.index += 1;
    }
}

// What mark() of the parser of the reference keeps, less the diagnostics.
pub(crate) struct Mark<'t> {
    scanner: ScannerState<'t>,
    token: Kind,
    context_flags: NodeFlags,
    diagnostics_len: usize,
    statement_has_await_identifier: bool,
    has_parse_error: bool,
}

// A statement of the source file and what makes the file a module in it.
#[derive(Clone, Copy)]
struct Statement {
    node: NodeId,
    // isAnExternalModuleIndicatorNode
    is_module_indicator: bool,
    // The first `import.meta` of the statement.
    import_meta: NodeId,
}

// One statement of the source file, as the first pass made it.
struct TopLevel {
    statement: Statement,
    pos: i32,
    // -1 when the reference, which reads `await` as an identifier there, ends its statement before this one ends.
    first_pass_end: i32,
    // The index of the next statement of Bun's parse when this one started.
    bun_index: usize,
}

pub(crate) struct Lowerer<'t, 'b> {
    b: &'b mut FileBuilder,
    scanner: Scanner<'t>,
    token: Kind,
    context_flags: NodeFlags,
    source_flags: NodeFlags,
    parsing_contexts: u8,
    statement_has_await_identifier: bool,
    // An await expression of this statement is, for the reference outside an await context, the identifier `await` and the end of its statement.
    await_splits_statement: bool,
    // The first `import.meta` since the statement of the source file started.
    first_import_meta: NodeId,
    external_module_indicator: NodeId,
    identifier_count: u32,
    errors: Rc<ErrorState>,
    stack_check: bun_core::StackCheck,
}

impl<'t, 'b> Lowerer<'t, 'b> {
    // initializeState
    fn new(b: &'b mut FileBuilder, text: &'t [u8], options: LowerOptions) -> Self {
        let errors = Rc::new(ErrorState::default());
        let sink = Rc::clone(&errors);
        let mut scanner = new_scanner();
        scanner.set_text(text);
        scanner.set_on_error(Some(Box::new(
            move |message: MessageId, pos: i32, length: i32, args: &[Arg<'_>]| {
                sink.report(message, pos, pos + length, args);
            },
        )));
        scanner.set_language_variant(get_language_variant(options.script_kind));
        let context_flags =
            if options.script_kind == ScriptKind::JS || options.script_kind == ScriptKind::JSX {
                NodeFlags::JAVA_SCRIPT_FILE
            } else {
                NodeFlags::NONE
            };
        Self {
            b,
            scanner,
            token: Kind::Unknown,
            context_flags,
            source_flags: NodeFlags::NONE,
            parsing_contexts: 0,
            statement_has_await_identifier: false,
            await_splits_statement: false,
            first_import_meta: NodeId::NIL,
            external_module_indicator: NodeId::NIL,
            identifier_count: 0,
            errors,
            stack_check: bun_core::StackCheck::init(),
        }
    }

    pub(crate) fn out_of_step(&self, what: &'static str) -> LowerError {
        LowerError {
            kind: LowerErrorKind::OutOfStep,
            pos: self.scanner.token_start(),
            what,
        }
    }

    pub(crate) fn unsupported(&self, what: &'static str) -> LowerError {
        LowerError {
            kind: LowerErrorKind::Unsupported,
            pos: self.scanner.token_start(),
            what,
        }
    }

    // Go stacks grow: a tree that is deeper than the stack of the thread ends the lowering of its file.
    pub(crate) fn check_stack(&self) -> Lowering<()> {
        if self.stack_check.is_safe_to_recurse() {
            return Ok(());
        }
        Err(LowerError {
            kind: LowerErrorKind::StackLimit,
            pos: self.scanner.token_start(),
            what: "stack limit reached",
        })
    }

    pub(crate) fn parse_error_at(
        &mut self,
        pos: i32,
        end: i32,
        message: MessageId,
        args: &[Arg<'_>],
    ) {
        self.errors.report(message, pos, end, args);
    }

    pub(crate) fn parse_error_at_current_token(&mut self, message: MessageId, args: &[Arg<'_>]) {
        let range = self.scanner.token_range();
        self.errors.report(message, range.pos(), range.end(), args);
    }

    pub(crate) fn mark(&self) -> Mark<'t> {
        Mark {
            scanner: self.scanner.mark(),
            token: self.token,
            context_flags: self.context_flags,
            diagnostics_len: self.diagnostics_len(),
            statement_has_await_identifier: self.statement_has_await_identifier,
            has_parse_error: self.errors.has_parse_error.get(),
        }
    }

    pub(crate) fn rewind(&mut self, mark: Mark<'t>) {
        self.scanner.rewind(mark.scanner);
        self.token = mark.token;
        self.context_flags = mark.context_flags;
        if let Ok(mut diagnostics) = self.errors.diagnostics.try_borrow_mut() {
            diagnostics.truncate(mark.diagnostics_len);
        }
        self.statement_has_await_identifier = mark.statement_has_await_identifier;
        self.errors.has_parse_error.set(mark.has_parse_error);
    }

    fn diagnostics_len(&self) -> usize {
        self.errors
            .diagnostics
            .try_borrow()
            .map_or(0, |diagnostics| diagnostics.len())
    }

    pub(crate) fn look_ahead<R>(&mut self, callback: impl FnOnce(&mut Self) -> R) -> R {
        let mark = self.mark();
        let result = callback(self);
        self.rewind(mark);
        result
    }

    pub(crate) fn next_token(&mut self) -> Kind {
        // if the keyword had an escape, issue a parse error for the escape
        if is_keyword(self.token)
            && (self.scanner.has_unicode_escape() || self.scanner.has_extended_unicode_escape())
        {
            self.parse_error_at_current_token(
                diagnostics::KEYWORDS_CANNOT_CONTAIN_ESCAPE_CHARACTERS,
                &[],
            );
        }
        self.token = self.scanner.scan();
        self.token
    }

    pub(crate) fn next_token_without_check(&mut self) -> Kind {
        self.token = self.scanner.scan();
        self.token
    }

    pub(crate) fn re_scan_greater_than_token(&mut self) -> Kind {
        self.token = self.scanner.re_scan_greater_than_token();
        self.token
    }

    pub(crate) fn re_scan_slash_token(&mut self) -> Kind {
        self.token = self.scanner.re_scan_slash_token(false);
        self.token
    }

    pub(crate) fn re_scan_template_token(&mut self, is_tagged_template: bool) -> Kind {
        self.token = self.scanner.re_scan_template_token(is_tagged_template);
        self.token
    }

    // The full start of the token that is read next: where a node that starts here starts, and where the one before it ends.
    pub(crate) fn node_pos(&self) -> i32 {
        self.scanner.token_full_start()
    }

    pub(crate) fn has_preceding_line_break(&self) -> bool {
        self.scanner.has_preceding_line_break()
    }

    pub(crate) fn jsdoc_scanner_info(&self) -> u8 {
        if !self.scanner.has_preceding_jsdoc_comment() {
            return 0;
        }
        let mut info = JSDOC_PRESENT;
        if self.scanner.has_preceding_jsdoc_with_deprecated_tag() {
            info |= JSDOC_DEPRECATED;
        }
        info
    }

    // withJSDoc, its flags only: the comment itself is not parsed.
    pub(crate) fn with_jsdoc(&mut self, node: NodeId, info: u8) {
        if info & JSDOC_PRESENT == 0 {
            return;
        }
        let mut flags = self.b.flags(node) | NodeFlags::HAS_JSDOC;
        if info & JSDOC_DEPRECATED != 0 {
            flags |= NodeFlags::POSSIBLY_CONTAINS_DEPRECATED_TAG;
        }
        self.b.set_flags(node, flags);
    }

    pub(crate) fn finish(&mut self, node: NodeId, pos: i32) -> NodeId {
        let end = self.node_pos();
        self.finish_with_end(node, pos, end)
    }

    // finishNodeWithEnd: the parents are set when the builder finishes.
    pub(crate) fn finish_with_end(&mut self, node: NodeId, pos: i32, end: i32) -> NodeId {
        self.b.set_loc(node, new_text_range(pos, end));
        let mut flags = self.b.flags(node) | self.context_flags;
        if self.errors.has_parse_error.replace(false) {
            flags |= NodeFlags::THIS_NODE_HAS_ERROR;
        }
        self.b.set_flags(node, flags);
        node
    }

    pub(crate) fn new_list(&mut self, pos: i32, end: i32, nodes: &[NodeId]) -> NodeListId {
        let list = self.b.new_node_list(nodes);
        self.b.set_list_loc(list, new_text_range(pos, end));
        list
    }

    pub(crate) fn new_modifier_list(
        &mut self,
        pos: i32,
        end: i32,
        nodes: &[NodeId],
    ) -> ModifierListId {
        let list = self.b.new_modifier_list(nodes);
        self.b
            .set_list_loc(list.as_node_list(), new_text_range(pos, end));
        list
    }

    pub(crate) fn set_context_flags(&mut self, flags: NodeFlags, value: bool) {
        if value {
            self.context_flags |= flags;
        } else {
            self.context_flags = self.context_flags.without(flags);
        }
    }

    pub(crate) fn in_await_context(&self) -> bool {
        self.context_flags.intersects(NodeFlags::AWAIT_CONTEXT)
    }

    pub(crate) fn in_yield_context(&self) -> bool {
        self.context_flags.intersects(NodeFlags::YIELD_CONTEXT)
    }

    // Ignore strict mode flag because we will report an error in type checker instead.
    pub(crate) fn is_identifier(&self) -> bool {
        if self.token == Kind::Identifier {
            return true;
        }
        // 'yield' in the [yield] context and 'await' in the [Await] context are keywords and not identifiers.
        if self.token == Kind::YieldKeyword && self.in_yield_context()
            || self.token == Kind::AwaitKeyword && self.in_await_context()
        {
            return false;
        }
        self.token > Kind::WithKeyword
    }

    // `let await`/`let yield` in [Yield] or [Await] are allowed here and disallowed in the binder.
    pub(crate) fn is_binding_identifier(&self) -> bool {
        self.token == Kind::Identifier || self.token > Kind::WithKeyword
    }

    pub(crate) fn expect(&mut self, kind: Kind) -> Lowering<()> {
        if self.token == kind {
            self.next_token();
            return Ok(());
        }
        Err(self.out_of_step("a token of the tree is not at its place"))
    }

    pub(crate) fn optional(&mut self, kind: Kind) -> bool {
        if self.token == kind {
            self.next_token();
            return true;
        }
        false
    }

    // parseTokenNode
    pub(crate) fn parse_token_node(&mut self) -> NodeId {
        let pos = self.node_pos();
        let kind = self.token;
        self.next_token();
        let node = self.b.new_token(kind);
        self.finish(node, pos)
    }

    pub(crate) fn expect_token_node(&mut self, kind: Kind) -> Lowering<NodeId> {
        if self.token == kind {
            return Ok(self.parse_token_node());
        }
        Err(self.out_of_step("a token that the reference keeps as a node is not at its place"))
    }

    pub(crate) fn optional_token_node(&mut self, kind: Kind) -> NodeId {
        if self.token == kind {
            return self.parse_token_node();
        }
        NodeId::NIL
    }

    // createIdentifier for a token that is an identifier here; newIdentifier counts it.
    pub(crate) fn create_identifier(&mut self) -> Lowering<NodeId> {
        if !token_is_identifier_or_keyword(self.token) || self.token == Kind::PrivateIdentifier {
            return Err(self.out_of_step("an identifier of the tree is not at its place"));
        }
        let pos = self.node_pos();
        let node = self.b.new_identifier(self.scanner.token_value());
        self.identifier_count = self.identifier_count.saturating_add(1);
        if self.scanner.token_value() == b"await" {
            self.statement_has_await_identifier = true;
        }
        self.next_token_without_check();
        Ok(self.finish(node, pos))
    }

    // parseBindingIdentifier
    pub(crate) fn parse_binding_identifier(&mut self) -> Lowering<NodeId> {
        let save_has_await_identifier = self.statement_has_await_identifier;
        let id = self.create_identifier()?;
        self.statement_has_await_identifier = save_has_await_identifier;
        Ok(id)
    }

    // parsePrivateIdentifier
    pub(crate) fn parse_private_identifier(&mut self) -> Lowering<NodeId> {
        if self.token != Kind::PrivateIdentifier {
            return Err(self.out_of_step("a private name of the tree is not at its place"));
        }
        let pos = self.node_pos();
        let node = self.b.new_private_identifier(self.scanner.token_value());
        self.next_token();
        Ok(self.finish(node, pos))
    }

    // parseLiteralExpression
    pub(crate) fn parse_literal_expression(&mut self) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let text = self.scanner.token_value();
        let token_flags = self.scanner.token_flags();
        let node = match self.token {
            Kind::StringLiteral => self.b.new_string_literal(text, token_flags),
            Kind::NumericLiteral => self.b.new_numeric_literal(text, token_flags),
            Kind::BigIntLiteral => self.b.new_big_int_literal(text, token_flags),
            Kind::RegularExpressionLiteral => {
                self.b.new_regular_expression_literal(text, token_flags)
            }
            Kind::NoSubstitutionTemplateLiteral => self
                .b
                .new_no_substitution_template_literal(text, token_flags),
            _ => return Err(self.out_of_step("a literal of the tree is not at its place")),
        };
        self.next_token();
        Ok(self.finish(node, pos))
    }

    // parseKeywordExpression
    pub(crate) fn parse_keyword_expression(&mut self, kind: Kind) -> Lowering<NodeId> {
        if self.token != kind {
            return Err(self.out_of_step("a keyword of the tree is not at its place"));
        }
        let pos = self.node_pos();
        let node = self.b.new_keyword_expression(kind);
        self.next_token();
        Ok(self.finish(node, pos))
    }

    pub(crate) fn can_parse_semicolon(&self) -> bool {
        // If there's a real semicolon, then we can always parse it out; else in the ASI cases.
        self.token == Kind::SemicolonToken
            || self.token == Kind::CloseBraceToken
            || self.token == Kind::EndOfFile
            || self.has_preceding_line_break()
    }

    pub(crate) fn try_parse_semicolon(&mut self) -> bool {
        if !self.can_parse_semicolon() {
            return false;
        }
        if self.token == Kind::SemicolonToken {
            // consume the semicolon if it was explicitly provided.
            self.next_token();
        }
        true
    }

    // parseSemicolon: a statement that Bun ended where the reference cannot end one has no tree here.
    pub(crate) fn parse_semicolon(&mut self) -> Lowering<()> {
        if self.try_parse_semicolon() {
            return Ok(());
        }
        Err(self.out_of_step("a statement of the tree ends where the reference needs a semicolon"))
    }

    // A list of the tree whose elements commas separate, up to the token that closes it when one does.
    pub(crate) fn lower_delimited<T>(
        &mut self,
        items: &'t [T],
        close: Option<Kind>,
        mut lower: impl FnMut(&mut Self, &'t T) -> Lowering<NodeId>,
    ) -> Lowering<NodeListId> {
        let pos = self.node_pos();
        let mut nodes: Vec<NodeId> = Vec::with_capacity(items.len());
        for (index, item) in items.iter().enumerate() {
            nodes.push(lower(self, item)?);
            if self.token == Kind::CommaToken {
                if close.is_none() && index + 1 == items.len() {
                    break;
                }
                self.next_token();
            } else if index + 1 != items.len() {
                return Err(self.out_of_step("a comma between two elements of a list"));
            }
        }
        if close.is_some_and(|close| self.token != close) {
            return Err(self.out_of_step("the end of a list"));
        }
        let end = self.node_pos();
        Ok(self.new_list(pos, end, &nodes))
    }

    // parseSourceFileWorker
    fn lower_source(&mut self, stmts: &'t [Stmt], options: LowerOptions) -> Lowering<NodeId> {
        if options.is_declaration_file {
            self.context_flags |= NodeFlags::AMBIENT;
        }
        let pos = self.node_pos();
        self.parsing_contexts |= PC_SOURCE_ELEMENTS;
        let mut top: Vec<TopLevel> = Vec::new();
        // The index of the first statement of each await span and the index after its last one, as possibleAwaitSpans.
        let mut spans: Vec<usize> = Vec::new();
        let mut cursor = StmtCursor::new(stmts, 0);
        while self.token != Kind::EndOfFile {
            let entry_pos = self.node_pos();
            let bun_index = cursor.index;
            self.statement_has_await_identifier = false;
            self.await_splits_statement = false;
            let statement = self.lower_top_level_statement(&mut cursor)?;
            let index = top.len();
            if self.statement_has_await_identifier
                && !self
                    .b
                    .flags(statement.node)
                    .intersects(NodeFlags::AWAIT_CONTEXT)
            {
                let extends_last = spans.last() == Some(&index)
                    && top.last().is_some_and(|last| last.first_pass_end >= 0);
                match spans.last_mut() {
                    Some(last) if extends_last => *last = index + 1,
                    _ => {
                        spans.push(index);
                        spans.push(index + 1);
                    }
                }
            }
            top.push(TopLevel {
                statement,
                pos: entry_pos,
                first_pass_end: if self.await_splits_statement {
                    -1
                } else {
                    self.node_pos()
                },
                bun_index,
            });
        }
        if cursor.peek().is_some() {
            return Err(self.out_of_step("a statement of the tree after the end of the file"));
        }
        self.parsing_contexts = 0;
        let end = self.node_pos();
        let end_jsdoc = self.jsdoc_scanner_info();
        let eof = self.parse_token_node();
        self.with_jsdoc(eof, end_jsdoc);

        // The first pass says whether the file is a module, as finishSourceFile does before the statements are read again.
        let first_pass: Vec<Statement> = top.iter().map(|entry| entry.statement).collect();
        let force_module = !options.is_declaration_file && options.force_module;
        let is_module = force_module || !external_module_indicator(&first_pass).is_nil();
        let statements = if !options.is_declaration_file && is_module && !spans.is_empty() {
            self.reparse_top_level_await(stmts, &top, &spans)?
        } else {
            first_pass
        };

        let nodes: Vec<NodeId> = statements.iter().map(|statement| statement.node).collect();
        let list = self.new_list(pos, end, &nodes);
        let root = self.b.new_source_file(list, eof);
        self.finish(root, pos);
        let flags = self.b.flags(root) | self.source_flags;
        self.b.set_flags(root, flags);
        // getExternalModuleIndicator
        self.external_module_indicator = external_module_indicator(&statements);
        if self.external_module_indicator.is_nil() && force_module {
            self.external_module_indicator = root;
        }
        Ok(root)
    }

    // One statement of the source file, with what SetExternalModuleIndicator reads of it.
    fn lower_top_level_statement(&mut self, cursor: &mut StmtCursor<'t>) -> Lowering<Statement> {
        self.first_import_meta = NodeId::NIL;
        let (node, stmt) = self.lower_list_statement(cursor)?;
        Ok(Statement {
            node,
            is_module_indicator: stmt.is_some_and(is_external_module_indicator),
            import_meta: self.first_import_meta,
        })
    }

    // reparseTopLevelAwait: the statements of each span are made again in an await context, up to where a statement of the first pass ends too.
    fn reparse_top_level_await(
        &mut self,
        stmts: &'t [Stmt],
        top: &[TopLevel],
        spans: &[usize],
    ) -> Lowering<Vec<Statement>> {
        let mut statements: Vec<Statement> = Vec::with_capacity(top.len());
        let saved_parse_diagnostics = match self.errors.diagnostics.try_borrow_mut() {
            Ok(mut diagnostics) => std::mem::take(&mut *diagnostics),
            Err(_) => Vec::new(),
        };
        let keep_diagnostics = |errors: &ErrorState, from: i32, to: Option<i32>| {
            if let Ok(mut diagnostics) = errors.diagnostics.try_borrow_mut() {
                diagnostics.extend(
                    saved_parse_diagnostics
                        .iter()
                        .skip_while(|diagnostic| diagnostic.loc.pos() < from)
                        .take_while(|diagnostic| to.is_none_or(|to| diagnostic.loc.pos() < to))
                        .cloned(),
                );
            }
        };

        let mut after_await_statement = 0usize;
        let mut i = 0usize;
        while let (Some(&next_await_statement), Some(&span_end)) = (spans.get(i), spans.get(i + 1))
        {
            // append all non-await statements between afterAwaitStatement and nextAwaitStatement
            let (Some(prev_statement), Some(next_statement)) = (
                top.get(after_await_statement),
                top.get(next_await_statement),
            ) else {
                break;
            };
            statements.extend(
                top.iter()
                    .take(next_await_statement)
                    .skip(after_await_statement)
                    .map(|entry| entry.statement),
            );
            // append all diagnostics associated with the copied range
            keep_diagnostics(&self.errors, prev_statement.pos, Some(next_statement.pos));

            let state = self.mark();
            // reparse all statements between start and pos, the parser generates new diagnostics for the range.
            self.context_flags |= NodeFlags::AWAIT_CONTEXT;
            if self.scanner.reset_pos(next_statement.pos).is_err() {
                return Err(self.out_of_step("the start of a statement"));
            }
            self.next_token();

            after_await_statement = span_end;
            self.parsing_contexts |= PC_SOURCE_ELEMENTS;
            let mut cursor = StmtCursor::new(stmts, next_statement.bun_index);
            while self.token != Kind::EndOfFile {
                let statement = self.lower_top_level_statement(&mut cursor)?;
                statements.push(statement);
                let statement_end = self.node_pos();
                if after_await_statement < top.len() {
                    let last_await_statement_end = top
                        .get(after_await_statement.wrapping_sub(1))
                        .map_or(-1, |entry| entry.first_pass_end);
                    if statement_end == last_await_statement_end {
                        // done reparsing this section
                        break;
                    }
                    if statement_end > last_await_statement_end {
                        // we ate into the next statement, so we must continue reparsing the next span
                        i += 2;
                        after_await_statement = spans.get(i + 1).copied().unwrap_or(top.len());
                    }
                }
            }
            self.parsing_contexts = 0;

            // Keep diagnostics from the reparse
            let kept = Mark {
                diagnostics_len: self.diagnostics_len(),
                ..state
            };
            self.rewind(kept);
            i += 2;
        }

        // append all statements between pos and the end of the list
        if let Some(prev_statement) = top.get(after_await_statement) {
            statements.extend(
                top.iter()
                    .skip(after_await_statement)
                    .map(|entry| entry.statement),
            );
            keep_diagnostics(&self.errors, prev_statement.pos, None);
        }
        Ok(statements)
    }
}

// isFileProbablyExternalModule: the first statement that is an external module indicator, else the first `import.meta` of the file.
fn external_module_indicator(statements: &[Statement]) -> NodeId {
    if let Some(statement) = statements
        .iter()
        .find(|statement| statement.is_module_indicator)
    {
        return statement.node;
    }
    statements
        .iter()
        .map(|statement| statement.import_meta)
        .find(|import_meta| !import_meta.is_nil())
        .unwrap_or(NodeId::NIL)
}

// isAnExternalModuleIndicatorNode, read from the statement of Bun's parse that the node was made of.
fn is_external_module_indicator(stmt: &Stmt) -> bool {
    match &stmt.data {
        StmtData::SImport(_)
        | StmtData::SExportClause(_)
        | StmtData::SExportFrom(_)
        | StmtData::SExportStar(_)
        | StmtData::SExportDefault(_)
        | StmtData::SExportEquals(_) => true,
        StmtData::SLocal(local) => local.is_export,
        StmtData::SClass(class) => class.is_export,
        StmtData::SFunction(function) => function
            .func
            .flags
            .contains(bun_ast::flags::Function::IsExport),
        _ => false,
    }
}
