// Statements and the declarations at statement level.
use super::{
    JSDOC_PRESENT, Lowerer, Lowering, PC_BLOCK_STATEMENTS, PC_SWITCH_CLAUSE_STATEMENTS, StmtCursor,
};
use crate::ast::{Kind, ModifierListId, NodeFactory, NodeFlags, NodeId, NodeListId};
use bun_ast::{Expr, G, S, Stmt, StmtData, StmtOrExpr};

impl<'t> Lowerer<'t, '_> {
    // One statement of a list. Bun's parser drops an empty statement and a "use strict" directive from a list: their tokens say that they are there.
    pub(super) fn lower_list_statement(
        &mut self,
        cursor: &mut StmtCursor<'t>,
    ) -> Lowering<(NodeId, Option<&'t Stmt>)> {
        let next = cursor.peek();
        if self.token == Kind::SemicolonToken {
            // The body of a switch clause keeps its empty statements.
            if next.is_some_and(|stmt| matches!(stmt.data, StmtData::SEmpty(_))) {
                cursor.bump();
            }
            return Ok((self.lower_empty_statement()?, None));
        }
        if self.token == Kind::StringLiteral || self.token == Kind::OpenParenToken {
            let token_start = self.scanner.token_start();
            let starts_next = next.is_some_and(|stmt| {
                stmt.loc.start == token_start
                    && matches!(stmt.data, StmtData::SExpr(_) | StmtData::SDirective(_))
            });
            if !starts_next
                && (self.token == Kind::StringLiteral || self.is_string_in_parentheses())
            {
                return Ok((self.lower_directive()?, None));
            }
        }
        let Some(stmt) = next else {
            return Err(self.out_of_step("a statement that is not in the tree"));
        };
        cursor.bump();
        Ok((self.lower_statement(stmt)?, Some(stmt)))
    }

    // parseList of statements, in the parsing context `context`
    fn lower_statement_list(&mut self, stmts: &'t [Stmt], context: u8) -> Lowering<NodeListId> {
        let pos = self.node_pos();
        let save_parsing_contexts = self.parsing_contexts;
        self.parsing_contexts |= context;
        let mut cursor = StmtCursor::new(stmts, 0);
        let mut nodes: Vec<NodeId> = Vec::with_capacity(stmts.len());
        loop {
            // isListTerminator
            let at_end = match self.token {
                Kind::CloseBraceToken | Kind::EndOfFile => true,
                Kind::CaseKeyword | Kind::DefaultKeyword => context == PC_SWITCH_CLAUSE_STATEMENTS,
                _ => false,
            };
            if at_end {
                break;
            }
            nodes.push(self.lower_list_statement(&mut cursor)?.0);
        }
        if cursor.peek().is_some() {
            return Err(self.out_of_step("a statement of the tree after the end of its list"));
        }
        self.parsing_contexts = save_parsing_contexts;
        let end = self.node_pos();
        Ok(self.new_list(pos, end, &nodes))
    }

    // parseBlock
    pub(super) fn lower_block(&mut self, stmts: &'t [Stmt]) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::OpenBraceToken)?;
        let multiline = self.has_preceding_line_break();
        let statements = self.lower_statement_list(stmts, PC_BLOCK_STATEMENTS)?;
        self.expect(Kind::CloseBraceToken)?;
        let result = self.b.new_block(statements, multiline);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseStatement: the statement of Bun's tree says which one starts here.
    pub(super) fn lower_statement(&mut self, stmt: &'t Stmt) -> Lowering<NodeId> {
        self.check_stack()?;
        match &stmt.data {
            StmtData::SEmpty(_) => self.lower_empty_statement(),
            StmtData::SBlock(s) => self.lower_block(s.stmts.slice()),
            StmtData::SLocal(s) => self.lower_variable_statement(s),
            StmtData::SFunction(s) => self.lower_function_declaration(&s.func, false),
            StmtData::SClass(s) => self.lower_class_declaration(&s.class, s.is_export, false),
            StmtData::SIf(s) => self.lower_if_statement(s),
            StmtData::SDoWhile(s) => self.lower_do_statement(s),
            StmtData::SWhile(s) => self.lower_while_statement(s),
            StmtData::SFor(s) => self.lower_for_statement(s),
            StmtData::SForIn(s) => self.lower_for_in_statement(s),
            StmtData::SForOf(s) => self.lower_for_of_statement(s),
            StmtData::SBreak(s) => self.lower_break_or_continue_statement(true, s.label.is_some()),
            StmtData::SContinue(s) => {
                self.lower_break_or_continue_statement(false, s.label.is_some())
            }
            StmtData::SReturn(s) => self.lower_return_statement(s),
            StmtData::SWith(s) => self.lower_with_statement(s),
            StmtData::SSwitch(s) => self.lower_switch_statement(s),
            StmtData::SThrow(s) => self.lower_throw_statement(s),
            StmtData::STry(s) => self.lower_try_statement(s),
            StmtData::SDebugger(_) => self.lower_debugger_statement(),
            StmtData::SLabel(s) => self.lower_labeled_statement(s),
            StmtData::SExpr(s) => self.lower_expression_statement(&s.value),
            StmtData::SDirective(_) => self.lower_directive(),
            StmtData::SImport(_) => self.lower_import_declaration(),
            StmtData::SExportClause(_) | StmtData::SExportFrom(_) | StmtData::SExportStar(_) => {
                self.lower_export_declaration()
            }
            StmtData::SExportDefault(s) => match &s.value {
                StmtOrExpr::Expr(value) => self.lower_export_assignment(value),
                StmtOrExpr::Stmt(inner) => match &inner.data {
                    StmtData::SFunction(function) => {
                        self.lower_function_declaration(&function.func, true)
                    }
                    StmtData::SClass(class) => {
                        self.lower_class_declaration(&class.class, true, true)
                    }
                    _ => Err(self.unsupported("a default export of an unknown kind")),
                },
            },
            StmtData::SExportEquals(_)
            | StmtData::SEnum(_)
            | StmtData::SNamespace(_)
            | StmtData::STypeScript(_) => Err(self.unsupported("a TypeScript declaration")),
            StmtData::SComment(_) | StmtData::SLazyExport(_) => {
                Err(self.unsupported("a statement that has no token"))
            }
        }
    }

    // parseEmptyStatement
    fn lower_empty_statement(&mut self) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::SemicolonToken)?;
        let result = self.b.new_empty_statement();
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseExpressionOrLabeledStatement, the expression statement
    fn lower_expression_statement(&mut self, value: &'t Expr) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let has_paren = self.token == Kind::OpenParenToken;
        let expression = self.lower_expression(value)?;
        self.parse_semicolon()?;
        let result = self.b.new_expression_statement(expression);
        self.finish(result, pos);
        self.with_jsdoc(
            result,
            if has_paren {
                jsdoc & !JSDOC_PRESENT
            } else {
                jsdoc
            },
        );
        Ok(result)
    }

    // An expression statement that is one string literal: a directive, which Bun keeps as its text or drops. Bun keeps one in parentheses as its text too.
    fn lower_directive(&mut self) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let has_paren = self.token == Kind::OpenParenToken;
        let save_context_flags = self.context_flags;
        self.context_flags = self.context_flags.without(NodeFlags::DECORATOR_CONTEXT);
        let expression = self.lower_string_in_parentheses();
        self.context_flags = save_context_flags;
        let expression = expression?;
        self.parse_semicolon()?;
        let result = self.b.new_expression_statement(expression);
        self.finish(result, pos);
        self.with_jsdoc(
            result,
            if has_paren {
                jsdoc & !JSDOC_PRESENT
            } else {
                jsdoc
            },
        );
        Ok(result)
    }

    // Whether the statement here is one string literal in parentheses: a "use strict" that Bun dropped, when no statement of the tree starts here.
    fn is_string_in_parentheses(&mut self) -> bool {
        self.look_ahead(|this| {
            let mut open = 0u32;
            while this.token == Kind::OpenParenToken {
                open = open.saturating_add(1);
                this.next_token();
            }
            if this.token != Kind::StringLiteral {
                return false;
            }
            this.next_token();
            while open > 0 && this.token == Kind::CloseParenToken {
                open -= 1;
                this.next_token();
            }
            open == 0 && this.can_parse_semicolon()
        })
    }

    // parseParenthesizedExpression around one string literal, for each `(` before it
    fn lower_string_in_parentheses(&mut self) -> Lowering<NodeId> {
        let outer_flags = self.context_flags;
        let inner_flags =
            outer_flags.without(NodeFlags::DISALLOW_IN_CONTEXT | NodeFlags::DECORATOR_CONTEXT);
        let mut parens: Vec<(i32, u8)> = Vec::new();
        while self.token == Kind::OpenParenToken {
            parens.push((self.node_pos(), self.jsdoc_scanner_info()));
            self.next_token();
            self.context_flags = inner_flags;
        }
        if self.token != Kind::StringLiteral {
            return Err(self.out_of_step("a directive of the tree is not at its place"));
        }
        let mut node = self.parse_literal_expression()?;
        while let Some((paren_pos, jsdoc)) = parens.pop() {
            self.expect(Kind::CloseParenToken)?;
            self.context_flags = if parens.is_empty() {
                outer_flags
            } else {
                inner_flags
            };
            let result = self.b.new_parenthesized_expression(node);
            self.finish(result, paren_pos);
            self.with_jsdoc(result, jsdoc);
            node = result;
        }
        Ok(node)
    }

    // parseExpressionOrLabeledStatement, the labeled statement
    fn lower_labeled_statement(&mut self, s: &'t S::Label) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let save_context_flags = self.context_flags;
        self.context_flags = self.context_flags.without(NodeFlags::DECORATOR_CONTEXT);
        let label = self.create_identifier();
        self.context_flags = save_context_flags;
        let label = label?;
        self.expect(Kind::ColonToken)?;
        let statement = self.lower_statement(&s.stmt)?;
        let result = self.b.new_labeled_statement(label, statement);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseIfStatement: an `else if` chain is walked in a loop, so its length costs no stack.
    fn lower_if_statement(&mut self, first: &'t S::If) -> Lowering<NodeId> {
        let mut open: Vec<(i32, u8, NodeId, NodeId)> = Vec::new();
        let mut current: &'t S::If = first;
        let mut else_statement = NodeId::NIL;
        loop {
            let pos = self.node_pos();
            let jsdoc = self.jsdoc_scanner_info();
            self.expect(Kind::IfKeyword)?;
            self.expect(Kind::OpenParenToken)?;
            let expression = self.lower_expression_allow_in(&current.test)?;
            self.expect(Kind::CloseParenToken)?;
            let then_statement = self.lower_statement(&current.yes)?;
            open.push((pos, jsdoc, expression, then_statement));
            let Some(no) = current.no.as_ref() else {
                break;
            };
            self.expect(Kind::ElseKeyword)?;
            match &no.data {
                StmtData::SIf(next) if self.token == Kind::IfKeyword => current = &**next,
                _ => {
                    else_statement = self.lower_statement(no)?;
                    break;
                }
            }
        }
        while let Some((pos, jsdoc, expression, then_statement)) = open.pop() {
            let result = self
                .b
                .new_if_statement(expression, then_statement, else_statement);
            self.finish(result, pos);
            self.with_jsdoc(result, jsdoc);
            else_statement = result;
        }
        Ok(else_statement)
    }

    // parseDoStatement
    fn lower_do_statement(&mut self, s: &'t S::DoWhile) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::DoKeyword)?;
        let statement = self.lower_statement(&s.body)?;
        self.expect(Kind::WhileKeyword)?;
        self.expect(Kind::OpenParenToken)?;
        let expression = self.lower_expression_allow_in(&s.test)?;
        self.expect(Kind::CloseParenToken)?;
        // do;while(0)x will have a semicolon inserted before x.
        self.optional(Kind::SemicolonToken);
        let result = self.b.new_do_statement(statement, expression);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseWhileStatement
    fn lower_while_statement(&mut self, s: &'t S::While) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::WhileKeyword)?;
        self.expect(Kind::OpenParenToken)?;
        let expression = self.lower_expression_allow_in(&s.test)?;
        self.expect(Kind::CloseParenToken)?;
        let statement = self.lower_statement(&s.body)?;
        let result = self.b.new_while_statement(expression, statement);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseWithStatement
    fn lower_with_statement(&mut self, s: &'t S::With) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::WithKeyword)?;
        self.expect(Kind::OpenParenToken)?;
        let expression = self.lower_expression_allow_in(&s.value)?;
        self.expect(Kind::CloseParenToken)?;
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::IN_WITH_STATEMENT, true);
        let statement = self.lower_statement(&s.body);
        self.context_flags = save_context_flags;
        let result = self.b.new_with_statement(expression, statement?);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseForOrForInOrForOfStatement up to the end of the initializer
    fn lower_for_head(&mut self, init: Option<&'t Stmt>) -> Lowering<(i32, u8, NodeId, NodeId)> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::ForKeyword)?;
        let await_token = self.optional_token_node(Kind::AwaitKeyword);
        self.expect(Kind::OpenParenToken)?;
        let mut initializer = NodeId::NIL;
        if self.token != Kind::SemicolonToken {
            let Some(init) = init else {
                return Err(self.out_of_step("the initializer of a loop is not in the tree"));
            };
            initializer = match &init.data {
                StmtData::SLocal(local) => self.lower_variable_declaration_list(local, true)?,
                StmtData::SExpr(expression) => {
                    let save_context_flags = self.context_flags;
                    self.set_context_flags(NodeFlags::DISALLOW_IN_CONTEXT, true);
                    let node = self.lower_expression(&expression.value);
                    self.context_flags = save_context_flags;
                    node?
                }
                _ => return Err(self.unsupported("the initializer of a loop")),
            };
        } else if init.is_some() {
            return Err(self.out_of_step("the initializer of a loop"));
        }
        Ok((pos, jsdoc, await_token, initializer))
    }

    // parseForOrForInOrForOfStatement, the `for` statement
    fn lower_for_statement(&mut self, s: &'t S::For) -> Lowering<NodeId> {
        let (pos, jsdoc, await_token, initializer) = self.lower_for_head(s.init.as_ref())?;
        if !await_token.is_nil() {
            return Err(self.out_of_step("`await` in a loop that is no for-of"));
        }
        self.expect(Kind::SemicolonToken)?;
        let mut condition = NodeId::NIL;
        if self.token != Kind::SemicolonToken && self.token != Kind::CloseParenToken {
            let Some(test) = s.test.as_ref() else {
                return Err(self.out_of_step("the condition of a loop is not in the tree"));
            };
            condition = self.lower_expression_allow_in(test)?;
        }
        self.expect(Kind::SemicolonToken)?;
        let mut incrementor = NodeId::NIL;
        if self.token != Kind::CloseParenToken {
            let Some(update) = s.update.as_ref() else {
                return Err(self.out_of_step("the incrementor of a loop is not in the tree"));
            };
            incrementor = self.lower_expression_allow_in(update)?;
        }
        self.expect(Kind::CloseParenToken)?;
        let statement = self.lower_statement(&s.body)?;
        let result = self
            .b
            .new_for_statement(initializer, condition, incrementor, statement);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseForOrForInOrForOfStatement, the `for..in` statement
    fn lower_for_in_statement(&mut self, s: &'t S::ForIn) -> Lowering<NodeId> {
        let (pos, jsdoc, await_token, initializer) = self.lower_for_head(Some(&s.init))?;
        if !await_token.is_nil() {
            return Err(self.out_of_step("`await` in a loop that is no for-of"));
        }
        self.expect(Kind::InKeyword)?;
        let expression = self.lower_expression_allow_in(&s.value)?;
        self.expect(Kind::CloseParenToken)?;
        let statement = self.lower_statement(&s.body)?;
        let result = self.b.new_for_in_or_of_statement(
            Kind::ForInStatement,
            NodeId::NIL,
            initializer,
            expression,
            statement,
        );
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseForOrForInOrForOfStatement, the `for..of` statement
    fn lower_for_of_statement(&mut self, s: &'t S::ForOf) -> Lowering<NodeId> {
        let (pos, jsdoc, await_token, initializer) = self.lower_for_head(Some(&s.init))?;
        if s.is_await == await_token.is_nil() {
            return Err(self.out_of_step("the `await` of a for-of loop"));
        }
        self.expect(Kind::OfKeyword)?;
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::DISALLOW_IN_CONTEXT, false);
        let expression = self.lower_assignment_expression(&s.value);
        self.context_flags = save_context_flags;
        let expression = expression?;
        self.expect(Kind::CloseParenToken)?;
        let statement = self.lower_statement(&s.body)?;
        let result = self.b.new_for_in_or_of_statement(
            Kind::ForOfStatement,
            await_token,
            initializer,
            expression,
            statement,
        );
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseBreakStatement and parseContinueStatement
    fn lower_break_or_continue_statement(
        &mut self,
        is_break: bool,
        has_label: bool,
    ) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(if is_break {
            Kind::BreakKeyword
        } else {
            Kind::ContinueKeyword
        })?;
        // parseIdentifierUnlessAtSemicolon
        let label = if self.can_parse_semicolon() {
            NodeId::NIL
        } else {
            self.create_identifier()?
        };
        if has_label == label.is_nil() {
            return Err(self.out_of_step("the label of a break or continue statement"));
        }
        self.parse_semicolon()?;
        let result = if is_break {
            self.b.new_break_statement(label)
        } else {
            self.b.new_continue_statement(label)
        };
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseReturnStatement
    fn lower_return_statement(&mut self, s: &'t S::Return) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::ReturnKeyword)?;
        let mut expression = NodeId::NIL;
        if !self.can_parse_semicolon() {
            let Some(value) = s.value.as_ref() else {
                return Err(self.out_of_step("the value of a return statement is not in the tree"));
            };
            expression = self.lower_expression_allow_in(value)?;
        } else if s.value.is_some() {
            return Err(self.out_of_step("the value of a return statement"));
        }
        self.parse_semicolon()?;
        let result = self.b.new_return_statement(expression);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseThrowStatement
    fn lower_throw_statement(&mut self, s: &'t S::Throw) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::ThrowKeyword)?;
        let expression = self.lower_expression_allow_in(&s.value)?;
        self.parse_semicolon()?;
        let result = self.b.new_throw_statement(expression);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseSwitchStatement, parseCaseBlock, parseCaseClause and parseDefaultClause
    fn lower_switch_statement(&mut self, s: &'t S::Switch) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::SwitchKeyword)?;
        self.expect(Kind::OpenParenToken)?;
        let expression = self.lower_expression_allow_in(&s.test)?;
        self.expect(Kind::CloseParenToken)?;

        let block_pos = self.node_pos();
        let block_jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::OpenBraceToken)?;
        let clauses_pos = self.node_pos();
        let cases = s.cases.slice();
        let mut clauses: Vec<NodeId> = Vec::with_capacity(cases.len());
        for case in cases {
            let clause_pos = self.node_pos();
            let clause_jsdoc = self.jsdoc_scanner_info();
            let mut clause_expression = NodeId::NIL;
            let kind = match case.value.as_ref() {
                Some(value) => {
                    self.expect(Kind::CaseKeyword)?;
                    clause_expression = self.lower_expression_allow_in(value)?;
                    Kind::CaseClause
                }
                None => {
                    self.expect(Kind::DefaultKeyword)?;
                    Kind::DefaultClause
                }
            };
            self.expect(Kind::ColonToken)?;
            let statements =
                self.lower_statement_list(case.body.slice(), PC_SWITCH_CLAUSE_STATEMENTS)?;
            let clause = self
                .b
                .new_case_or_default_clause(kind, clause_expression, statements);
            self.finish(clause, clause_pos);
            self.with_jsdoc(clause, clause_jsdoc);
            clauses.push(clause);
        }
        let clauses_end = self.node_pos();
        let clauses = self.new_list(clauses_pos, clauses_end, &clauses);
        self.expect(Kind::CloseBraceToken)?;
        let case_block = self.b.new_case_block(clauses);
        self.finish(case_block, block_pos);
        self.with_jsdoc(case_block, block_jsdoc);

        let result = self.b.new_switch_statement(expression, case_block);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseTryStatement and parseCatchClause
    fn lower_try_statement(&mut self, s: &'t S::Try) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::TryKeyword)?;
        let try_block = self.lower_block(s.body.slice())?;
        let mut catch_clause = NodeId::NIL;
        if let Some(catch) = s.catch.as_ref() {
            let clause_pos = self.node_pos();
            self.expect(Kind::CatchKeyword)?;
            let mut variable_declaration = NodeId::NIL;
            if self.optional(Kind::OpenParenToken) {
                let Some(binding) = catch.binding.as_ref() else {
                    return Err(
                        self.out_of_step("the binding of a catch clause is not in the tree")
                    );
                };
                // parseVariableDeclaration
                let declaration_pos = self.node_pos();
                let declaration_jsdoc = self.jsdoc_scanner_info();
                let name = self.lower_identifier_or_pattern(binding)?;
                let declaration =
                    self.b
                        .new_variable_declaration(name, NodeId::NIL, NodeId::NIL, NodeId::NIL);
                self.finish(declaration, declaration_pos);
                self.with_jsdoc(declaration, declaration_jsdoc);
                variable_declaration = declaration;
                self.expect(Kind::CloseParenToken)?;
            } else if catch.binding.is_some() {
                return Err(self.out_of_step("the binding of a catch clause"));
            }
            let block = self.lower_block(catch.body.slice())?;
            let clause = self.b.new_catch_clause(variable_declaration, block);
            catch_clause = self.finish(clause, clause_pos);
        }
        let mut finally_block = NodeId::NIL;
        if let Some(finally) = s.finally.as_ref() {
            self.expect(Kind::FinallyKeyword)?;
            finally_block = self.lower_block(finally.stmts.slice())?;
        }
        let result = self
            .b
            .new_try_statement(try_block, catch_clause, finally_block);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseDebuggerStatement
    fn lower_debugger_statement(&mut self) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        self.expect(Kind::DebuggerKeyword)?;
        self.parse_semicolon()?;
        let result = self.b.new_debugger_statement();
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseModifiersEx of parseDeclaration: a keyword is a modifier where Bun's statement says that the declaration is what the keyword makes it.
    fn lower_declaration_modifiers(
        &mut self,
        pos: i32,
        decorators: &'t [Expr],
        is_export: bool,
        is_default: bool,
        is_async: bool,
    ) -> Lowering<(ModifierListId, bool)> {
        let mut list: Vec<NodeId> = Vec::new();
        let mut decorators = decorators.iter();
        let mut seen_export = false;
        let mut seen_default = false;
        let mut seen_async = false;
        loop {
            let modifier = match self.token {
                Kind::AtToken => {
                    let Some(decorator) = decorators.next() else {
                        return Err(self.out_of_step("a decorator that is not in the tree"));
                    };
                    self.lower_decorator(decorator)?
                }
                Kind::ExportKeyword if is_export && !seen_export => {
                    seen_export = true;
                    self.parse_token_node()
                }
                Kind::DefaultKeyword if is_default && seen_export && !seen_default => {
                    seen_default = true;
                    self.parse_token_node()
                }
                Kind::AsyncKeyword if is_async && !seen_async => {
                    seen_async = true;
                    self.parse_token_node()
                }
                _ => break,
            };
            list.push(modifier);
        }
        if decorators.next().is_some() || is_export != seen_export || is_async != seen_async {
            return Err(self.out_of_step("the modifiers of a declaration"));
        }
        if list.is_empty() {
            return Ok((ModifierListId::NIL, false));
        }
        let end = self.node_pos();
        Ok((self.new_modifier_list(pos, end, &list), seen_export))
    }

    // parseVariableStatement
    fn lower_variable_statement(&mut self, local: &'t S::Local) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let (modifiers, _) =
            self.lower_declaration_modifiers(pos, &[], local.is_export, false, false)?;
        let declaration_list = self.lower_variable_declaration_list(local, false)?;
        self.parse_semicolon()?;
        let result = self.b.new_variable_statement(modifiers, declaration_list);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseVariableDeclarationList
    fn lower_variable_declaration_list(
        &mut self,
        local: &'t S::Local,
        in_for_statement_initializer: bool,
    ) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let (keyword, flags) = match local.kind {
            S::Kind::KVar => (Kind::VarKeyword, NodeFlags::NONE),
            S::Kind::KLet => (Kind::LetKeyword, NodeFlags::LET),
            S::Kind::KConst => (Kind::ConstKeyword, NodeFlags::CONST),
            S::Kind::KUsing => (Kind::UsingKeyword, NodeFlags::USING),
            S::Kind::KAwaitUsing => (Kind::AwaitKeyword, NodeFlags::AWAIT_USING),
        };
        self.expect(keyword)?;
        if keyword == Kind::AwaitKeyword {
            self.expect(Kind::UsingKeyword)?;
        }
        let save_context_flags = self.context_flags;
        self.set_context_flags(NodeFlags::DISALLOW_IN_CONTEXT, in_for_statement_initializer);
        let declarations = self.lower_delimited(local.decls.as_slice(), None, |this, decl| {
            this.lower_variable_declaration(decl)
        });
        self.context_flags = save_context_flags;
        let result = self.b.new_variable_declaration_list(declarations?, flags);
        Ok(self.finish(result, pos))
    }

    // parseVariableDeclarationWorker
    fn lower_variable_declaration(&mut self, decl: &'t G::Decl) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let name = self.lower_identifier_or_pattern(&decl.binding)?;
        let mut initializer = NodeId::NIL;
        if self.token != Kind::InKeyword && self.token != Kind::OfKeyword {
            initializer = self.lower_initializer(decl.value.as_ref())?;
        } else if decl.value.is_some() {
            return Err(self.out_of_step("the initializer of the variable of a loop"));
        }
        let result = self
            .b
            .new_variable_declaration(name, NodeId::NIL, NodeId::NIL, initializer);
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseFunctionDeclaration, from the modifiers that parseDeclaration reads
    fn lower_function_declaration(
        &mut self,
        func: &'t G::Fn,
        is_default: bool,
    ) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let is_export = is_default || func.flags.contains(bun_ast::flags::Function::IsExport);
        let is_async = func.flags.contains(bun_ast::flags::Function::IsAsync);
        let (modifiers, has_export_modifier) =
            self.lower_declaration_modifiers(pos, &[], is_export, is_default, is_async)?;
        self.expect(Kind::FunctionKeyword)?;
        let asterisk_token = self.optional_token_node(Kind::AsteriskToken);
        // We don't parse the name here in await context, instead we will report a grammar error in the checker.
        let name = if func.name.is_some() {
            self.parse_binding_identifier()?
        } else {
            NodeId::NIL
        };
        let is_generator = !asterisk_token.is_nil();
        let save_context_flags = self.context_flags;
        if has_export_modifier {
            self.set_context_flags(NodeFlags::AWAIT_CONTEXT, true);
        }
        let parameters = self.lower_parameters(is_generator, is_async, func.args.slice())?;
        let body = self.lower_function_block(is_generator, is_async, func.body.stmts.slice())?;
        self.context_flags = save_context_flags;
        let result = self.b.new_function_declaration(
            modifiers,
            asterisk_token,
            name,
            NodeListId::NIL,
            parameters,
            NodeId::NIL,
            NodeId::NIL,
            body,
        );
        self.finish(result, pos);
        self.with_jsdoc(result, jsdoc);
        Ok(result)
    }

    // parseClassDeclaration, from the modifiers that parseDeclaration reads
    fn lower_class_declaration(
        &mut self,
        class: &'t G::Class,
        is_export: bool,
        is_default: bool,
    ) -> Lowering<NodeId> {
        let pos = self.node_pos();
        let jsdoc = self.jsdoc_scanner_info();
        let (modifiers, has_export_modifier) = self.lower_declaration_modifiers(
            pos,
            class.ts_decorators.as_slice(),
            is_export,
            is_default,
            false,
        )?;
        self.lower_class(pos, jsdoc, modifiers, class, true, has_export_modifier)
    }
}
