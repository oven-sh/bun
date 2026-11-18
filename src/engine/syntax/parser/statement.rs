//! Statements and declarations.

use super::context::is_eval_or_arguments;
use super::function::Site;
use super::pattern::{Binder, LET_IN_LEXICAL_DECLARATION};
use super::{
    Class, Context, Expression, Facts, Failed, In, Parsed, Pattern, Session, Statement, nothing,
};
use crate::ast::{
    BindingFlags, BindingKind, Case, DeclarationKind, ExprId, ExprKind, List, PatternKind, ScopeId,
    ScopeKind, StmtId, StmtKind,
};
use crate::chars::{self, Start};
use crate::names::Name;
use crate::options::Goal;
use crate::token::{Token, TokenKind};

/// An `else if`.
pub(super) struct Branch {
    start: u32,
    test: ExprId,
    consequent: StmtId,
}

/// Where a statement stands.
#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Position {
    InList,
    /// Of `if`, which can be a function (ECMA-262 B.3.3).
    Branch,
    Body,
}

/// A list of declarators.
pub(super) struct Declarators {
    pub(super) node: Expression,
    pub(super) count: u32,
    pub(super) last: Declarator,
    pub(super) lacks_initializer: bool,
}

#[derive(Clone, Copy)]
pub(super) struct Declarator {
    pub(super) target: Declared,
    pub(super) has_initializer: bool,
}

#[derive(Clone, Copy)]
pub(super) enum Declared {
    Name(Token),
    Pattern(Pattern),
}

fn role(kind: DeclarationKind) -> &'static str {
    match kind {
        DeclarationKind::Var => "variable name",
        DeclarationKind::Let | DeclarationKind::Const => "lexical variable name",
        DeclarationKind::Using | DeclarationKind::AwaitUsing => "using variable name",
    }
}

fn is_using(kind: DeclarationKind) -> bool {
    matches!(kind, DeclarationKind::Using | DeclarationKind::AwaitUsing)
}

impl Session<'_> {
    #[inline(always)]
    fn at_end_of_statements(&self) -> bool {
        matches!(
            self.kind(),
            TokenKind::CloseBrace | TokenKind::End | TokenKind::Case | TokenKind::Default
        )
    }

    #[inline(always)]
    pub(super) fn append_statement<const BUILD: bool>(&mut self, statement: Statement) {
        if BUILD && !matches!(self.ast[statement].kind, StmtKind::Empty) {
            self.append::<BUILD>(statement);
        }
    }

    #[inline(always)]
    fn append_statements<const BUILD: bool>(&mut self) -> Parsed<()> {
        while !self.at_end_of_statements() {
            let statement = self.statement::<BUILD>(Position::InList)?;
            self.append_statement::<BUILD>(statement);
        }
        Ok(())
    }

    #[inline(always)]
    fn statements<const BUILD: bool>(&mut self) -> Parsed<List<StmtId>> {
        let list = self.open_list();
        self.append_statements::<BUILD>()?;
        Ok(self.close_list::<BUILD, _>(list))
    }

    #[inline(never)]
    pub(super) fn statements_with_directives<const BUILD: bool>(&mut self) -> Parsed<List<StmtId>> {
        let list = self.open_list();
        if self.at(TokenKind::String) {
            self.directives::<BUILD>()?;
        }
        self.append_statements::<BUILD>()?;
        Ok(self.close_list::<BUILD, _>(list))
    }

    /// Up to the first statement that is none, or `"use strict"`.
    #[inline(never)]
    fn directives<const BUILD: bool>(&mut self) -> Parsed<()> {
        let mark = self.mark();
        while self.at(TokenKind::String) {
            let token = self.token();
            let (statement, class) = self.classified_expression_statement::<BUILD>()?;
            self.append_statement::<BUILD>(statement);
            if class != Class::String {
                break;
            }
            if let [_, text @ .., _] = self.lexer.bytes_of(token)
                && text == b"use strict"
            {
                let was_strict = self.is_strict();
                self.set_context(self.context | Context::STRICT);
                if self.facts.contains(Facts::ELABORATE_PARAMETERS) {
                    return Err(self.reject(
                        "'use strict' directive not allowed inside a function with a non-simple parameter list",
                    ));
                }
                if self.facts.contains(Facts::PARAMETERS_INVALID_IF_STRICT) {
                    return Err(self.reject("Invalid parameters or function name in strict mode"));
                }
                if !was_strict {
                    self.rewind(&mark);
                    self.lexer.read_again();
                }
                break;
            }
        }
        Ok(())
    }

    /// `sentence` is for when there is none.
    #[inline(always)]
    pub(super) fn substatement<const BUILD: bool>(
        &mut self,
        position: Position,
        sentence: &'static str,
    ) -> Parsed<Statement> {
        match self.statement::<BUILD>(position) {
            Ok(statement) => Ok(statement),
            Err(Failed) => Err(self.fail(sentence)),
        }
    }

    /// Fails without a complaint at a token that ends a list of statements.
    #[inline(never)]
    pub(super) fn statement<const BUILD: bool>(&mut self, position: Position) -> Parsed<Statement> {
        self.check_stack()?;
        let is_in_list = position == Position::InList;
        match self.kind() {
            TokenKind::Identifier if !matches!(self.token().name(), Name::ASYNC | Name::USING) => {
                if self.may_be_at_label() {
                    return self.labeled_statement::<BUILD>(position);
                }
                self.expression_statement::<BUILD>()
            }
            TokenKind::OpenBrace => self.block::<BUILD>(),
            TokenKind::If => self.if_statement::<BUILD>(),
            TokenKind::Return => self.return_statement::<BUILD>(),
            TokenKind::Var => self.variable_statement::<BUILD>(DeclarationKind::Var),
            TokenKind::Const if is_in_list => {
                self.variable_statement::<BUILD>(DeclarationKind::Const)
            }
            TokenKind::Let if is_in_list => self.let_statement::<BUILD>(),
            TokenKind::Function if is_in_list => {
                self.function_declaration::<BUILD>(self.start(), Site::Ordinary, None)
            }
            TokenKind::Function => self.function_as_branch::<BUILD>(position),
            TokenKind::Class if is_in_list => self.class_declaration::<BUILD>(Site::Ordinary),
            TokenKind::Class => {
                Err(self.fail("'class' declaration is not directly within a block statement"))
            }
            TokenKind::For => self.for_statement::<BUILD>(),
            TokenKind::While => self.while_statement::<BUILD>(),
            TokenKind::Do => self.do_while_statement::<BUILD>(),
            TokenKind::Break => self.break_statement::<BUILD>(),
            TokenKind::Continue => self.continue_statement::<BUILD>(),
            TokenKind::Switch => self.switch_statement::<BUILD>(),
            TokenKind::Throw => self.throw_statement::<BUILD>(),
            TokenKind::Try => self.try_statement::<BUILD>(),
            TokenKind::With => self.with_statement::<BUILD>(),
            TokenKind::Semicolon => {
                let start = self.start();
                self.next();
                Ok(self.statement_node::<BUILD>(start, StmtKind::Empty))
            }
            TokenKind::Debugger => {
                let start = self.start();
                self.next();
                self.expect_semicolon("Debugger keyword must be followed by a ';'")?;
                Ok(self.step_node::<BUILD>(start, StmtKind::Debugger))
            }
            TokenKind::CloseBrace | TokenKind::End | TokenKind::Case | TokenKind::Default => {
                Err(Failed)
            }
            TokenKind::Identifier
            | TokenKind::Let
            | TokenKind::Yield
            | TokenKind::Await
            | TokenKind::EscapedKeyword => self.statement_from_word::<BUILD>(position),
            _ => self.expression_statement::<BUILD>(),
        }
    }

    /// One that is a keyword in some places.
    #[inline(never)]
    fn statement_from_word<const BUILD: bool>(&mut self, position: Position) -> Parsed<Statement> {
        let token = self.token();
        if token.kind() == TokenKind::EscapedKeyword && !self.is_unreserved(token) {
            return Err(self.unexpected());
        }
        if position == Position::InList {
            if let Some(kind) = self.using_declaration_ahead(false) {
                return self.using_statement::<BUILD>(kind);
            }
            if self.at_async_function() {
                self.next();
                return self.function_declaration::<BUILD>(token.start(), Site::Ordinary, None);
            }
            if self.context.contains(Context::STATIC_BLOCK) {
                match token.kind() {
                    TokenKind::Yield => {
                        return Err(self.fail("Cannot use 'yield' within static block"));
                    }
                    TokenKind::Await => {
                        return Err(self.fail("Cannot use 'await' within static block"));
                    }
                    _ => {}
                }
            }
        }
        self.labeled_statement::<BUILD>(position)
    }

    pub(super) fn at_async_function(&mut self) -> bool {
        self.at_contextual(Name::ASYNC) && {
            let next = self.peek();
            next.kind() == TokenKind::Function && !next.follows_newline()
        }
    }

    /// At `let`, which it passes if that starts a declaration.
    #[inline(always)]
    pub(super) fn eat_let_keyword(&mut self) -> bool {
        let (token, previous_end) = (self.token(), self.previous_end());
        self.next();
        let next = self.token();
        let is_keyword = self.is_strict()
            || matches!(
                next.kind(),
                TokenKind::Identifier | TokenKind::OpenBrace | TokenKind::OpenBracket
            )
            || next.spells(TokenKind::Let)
            || next.spells(TokenKind::Yield)
            || next.spells(TokenKind::Await);
        if !is_keyword {
            self.lexer.restore(token, previous_end);
        }
        is_keyword
    }

    #[inline(never)]
    fn let_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let start = self.start();
        if !self.eat_let_keyword() {
            return self.labeled_statement::<BUILD>(Position::InList);
        }
        let statement = self.variable_declaration::<BUILD>(DeclarationKind::Let, start)?;
        self.pause_at_statement::<BUILD>(statement);
        Ok(statement)
    }

    pub(super) fn using_declaration_ahead(&mut self, is_in_for: bool) -> Option<DeclarationKind> {
        if self.at_contextual(Name::USING) {
            let (name, after) = self.peek_twice();
            let is_enumeration =
                is_in_for && name.is_contextual(Name::OF) && after.kind() != TokenKind::Assign;
            return (!name.follows_newline() && self.is_name(name) && !is_enumeration)
                .then_some(DeclarationKind::Using);
        }
        if self.at_await_operator() && self.peek().is_contextual(Name::USING) {
            let (using, name) = self.peek_twice();
            return (!using.follows_newline() && !name.follows_newline() && self.is_name(name))
                .then_some(DeclarationKind::AwaitUsing);
        }
        None
    }

    fn using_statement<const BUILD: bool>(&mut self, kind: DeclarationKind) -> Parsed<Statement> {
        let keyword = match kind {
            DeclarationKind::Using => "using",
            _ => "await using",
        };
        if self.scopes.depth() == 1
            && matches!(self.options.goal, Goal::Script { .. } | Goal::Eval { .. })
        {
            let sentence = "'%' declaration is not allowed at the top level of a script or eval";
            return Err(self.reject_saying(sentence, keyword));
        }
        if self.scopes.kind() == ScopeKind::Switch {
            let sentence =
                "'%' declaration is not allowed directly in a switch case or default clause";
            return Err(self.reject_saying(sentence, keyword));
        }
        self.variable_statement::<BUILD>(kind)
    }

    #[inline(always)]
    fn expression_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        (self.classified_expression_statement::<BUILD>()).map(|(statement, _)| statement)
    }

    #[inline(always)]
    fn classified_expression_statement<const BUILD: bool>(&mut self) -> Parsed<(Statement, Class)> {
        let start = self.start();
        let expression = self.expression::<BUILD>()?;
        if !self.eat_semicolon() {
            return Err(self.unexpected());
        }
        let kind = StmtKind::Expression(expression.id());
        Ok((self.step_node::<BUILD>(start, kind), expression.class))
    }

    /// False if the characters after the word rule it out.
    #[inline(always)]
    fn may_be_at_label(&self) -> bool {
        let end = self.token().end() as usize;
        let next = (self.lexer).byte(end + usize::from(self.lexer.byte(end) == b' '));
        next == b':'
            || matches!(
                chars::start(next),
                Start::Blank | Start::Newline | Start::Slash
            )
    }

    /// At a word, which may turn out to be no label.
    #[inline(never)]
    fn labeled_statement<const BUILD: bool>(&mut self, position: Position) -> Parsed<Statement> {
        let floor = self.scopes.label_count();
        let statement = self.labeled_statement_above::<BUILD>(floor, position);
        self.scopes.drop_labels(floor);
        statement
    }

    #[inline(always)]
    fn labeled_statement_above<const BUILD: bool>(
        &mut self,
        floor: u32,
        position: Position,
    ) -> Parsed<Statement> {
        let mut start;
        loop {
            if self.peek().kind() != TokenKind::Colon {
                return self.expression_statement_from_word::<BUILD>();
            }
            start = self.start();
            self.label(floor)?;
            if !self.at_name() {
                break;
            }
        }
        if matches!(
            self.kind(),
            TokenKind::For | TokenKind::While | TokenKind::Do
        ) {
            self.scopes.label_loop(floor);
        }
        let mut body =
            if position == Position::InList && self.at(TokenKind::Function) && !self.is_strict() {
                self.function_declaration::<BUILD>(self.start(), Site::SingleStatement, None)?
            } else {
                self.substatement::<BUILD>(Position::Body, "Cannot parse statement")?
            };
        if BUILD {
            for index in (floor..self.scopes.label_count()).rev() {
                let label = self.scopes.label_at(index);
                body = self.statement_node::<BUILD>(start, StmtKind::Labeled { label, body });
            }
        }
        Ok(body)
    }

    fn label(&mut self, floor: u32) -> Parsed<()> {
        let token = self.token();
        if token.spells(TokenKind::Let) && self.is_strict() {
            return Err(self.reject("Cannot use 'let' as a label in strict mode"));
        }
        self.refuse_await(token, "label")?;
        if token.spells(TokenKind::Yield) && self.is_yield_reserved() {
            let reason = self.why_yield_is_reserved();
            return Err(self.reject_saying("Cannot use 'yield' as a label %", reason));
        }
        self.next();
        self.next();
        let name = token.name();
        if self.scopes.find_label(name, floor).is_some() {
            return Err(self.fail_naming("Attempted to redeclare the label '%'", name));
        }
        if self.find_label(name).is_some() {
            return Err(self.fail_naming("Cannot find scope for the label '%'", name));
        }
        self.scopes.add_label(name);
        Ok(())
    }

    /// Whether it is that of a loop.
    fn find_label(&mut self, name: Name) -> Option<bool> {
        self.scopes.find_label(name, self.first_label)
    }

    fn expression_statement_from_word<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        if self.at(TokenKind::Let) && self.peek().kind() == TokenKind::OpenBracket {
            self.next();
            return Err(self.fail("Cannot use lexical declaration in single-statement context"));
        }
        if self.at_async_function() {
            self.next();
            return Err(
                self.fail("Cannot use async function declaration in single-statement context")
            );
        }
        self.expression_statement::<BUILD>()
    }

    #[inline(never)]
    fn function_as_branch<const BUILD: bool>(&mut self, position: Position) -> Parsed<Statement> {
        if self.is_strict() {
            return Err(self.reject(
                "Function declarations are only allowed inside blocks or switch statements in strict mode",
            ));
        }
        if position != Position::Branch {
            return Err(self.fail(
                "Function declarations are only allowed inside block statements or at the top level of a program",
            ));
        }
        let (start, list) = (self.start(), self.open_list());
        self.scopes.push(ScopeKind::Block, start);
        let function = self.function_declaration::<BUILD>(start, Site::SingleStatement, None)?;
        self.append::<BUILD>(function);
        let kind = StmtKind::Block {
            body: self.close_list::<BUILD, _>(list),
            scope: self.pop_scope::<BUILD>(),
        };
        Ok(self.statement_node::<BUILD>(start, kind))
    }

    /// From brace to brace, in a scope that the caller has opened.
    #[inline(always)]
    pub(super) fn block_contents<const BUILD: bool>(&mut self) -> Parsed<List<StmtId>> {
        self.next();
        let body = self.statements::<BUILD>()?;
        self.expect(
            TokenKind::CloseBrace,
            "Expected a closing '}' at the end of a block statement",
        )?;
        Ok(body)
    }

    #[inline(always)]
    fn block<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        self.scopes.push(ScopeKind::Block, self.start());
        self.block_in_open_scope::<BUILD>()
    }

    #[inline(never)]
    fn block_in_open_scope<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let start = self.start();
        let body = self.block_contents::<BUILD>()?;
        let scope = self.pop_scope::<BUILD>();
        Ok(self.statement_node::<BUILD>(start, StmtKind::Block { body, scope }))
    }

    /// `(expression)`, with what to say if either parenthesis is missing.
    #[inline(always)]
    pub(super) fn condition<const BUILD: bool>(
        &mut self,
        to_open: &'static str,
        to_close: &'static str,
    ) -> Parsed<ExprId> {
        self.expect(TokenKind::OpenParen, to_open)?;
        let condition = self.expression::<BUILD>()?;
        self.pause_at::<BUILD>(condition);
        self.expect(TokenKind::CloseParen, to_close)?;
        Ok(condition.id())
    }

    /// At `if`.
    #[inline(always)]
    fn branch<const BUILD: bool>(&mut self, start: u32) -> Parsed<Branch> {
        self.next();
        let test = self.condition::<BUILD>(
            "Expected '(' to start an 'if' condition",
            "Expected ')' to end an 'if' condition",
        )?;
        let consequent = self.substatement::<BUILD>(
            Position::Branch,
            "Expected a statement as the body of an if block",
        )?;
        Ok(Branch {
            start,
            test,
            consequent,
        })
    }

    #[inline(never)]
    fn if_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let floor = self.stacks.branches.len();
        let statement = self.if_statement_above::<BUILD>(floor);
        if BUILD {
            self.stacks.branches.truncate(floor);
        }
        statement
    }

    #[inline(always)]
    fn if_statement_above<const BUILD: bool>(&mut self, floor: usize) -> Parsed<Statement> {
        let mut start = self.start();
        let mut alternate = None;
        loop {
            let branch = self.branch::<BUILD>(start)?;
            if BUILD {
                self.stacks.branches.push(branch);
            }
            start = self.start();
            if !self.eat(TokenKind::Else) {
                break;
            }
            if !self.at(TokenKind::If) {
                alternate = Some(self.substatement::<BUILD>(
                    Position::Branch,
                    "Expected a statement as the body of an else block",
                )?);
                break;
            }
        }
        while BUILD
            && self.stacks.branches.len() > floor
            && let Some(branch) = self.stacks.branches.pop()
        {
            let kind = StmtKind::If {
                test: branch.test,
                consequent: branch.consequent,
                alternate,
            };
            alternate = Some(self.statement_node::<BUILD>(branch.start, kind));
        }
        Ok(alternate.unwrap_or_else(nothing))
    }

    #[inline(never)]
    fn return_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        if self.context & (Context::FUNCTION | Context::STATIC_BLOCK) != Context::FUNCTION {
            return Err(self.reject("Return statements are only valid inside functions"));
        }
        let start = self.start();
        self.next();
        let mut value = None;
        if !self.eat_semicolon() {
            value = Some(self.expression::<BUILD>()?.id());
            self.expect_semicolon("Expected a ';' following a return statement")?;
            if self.context.contains(Context::ASYNC | Context::GENERATOR) {
                self.scopes.note_suspension();
            }
        }
        Ok(self.step_node::<BUILD>(start, StmtKind::Return(value)))
    }

    #[inline(never)]
    fn throw_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        const SENTENCE: &str = "Expected expression after 'throw'";
        let (keyword, start) = (self.token(), self.start());
        self.next();
        if self.at(TokenKind::Semicolon) {
            return Err(self.fail(SENTENCE));
        }
        if self.eat_semicolon() {
            self.blame_comment_after(keyword, SENTENCE);
            return Err(self.reject("Cannot have a newline after 'throw'"));
        }
        let value = self.expression::<BUILD>()?.id();
        let end = self.previous_end();
        self.expect_semicolon("Expected a ';' after a throw statement")?;
        Ok(self.step_node::<BUILD>(start, StmtKind::Throw { value, end }))
    }

    #[inline(never)]
    fn break_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        let is_valid = self.context.contains(Context::BREAK);
        if !is_valid
            && self.context.contains(Context::STATIC_BLOCK)
            && (self.follows_newline()
                || !self.at_name()
                || self.find_label(self.token().name()).is_none())
        {
            return Err(self.reject("'break' cannot cross static block boundary"));
        }
        let mut label = None;
        if self.eat_semicolon() {
            if !is_valid {
                return Err(self.reject("'break' is only valid inside a switch or loop statement"));
            }
        } else {
            let sentence = "Expected an identifier as the target for a break statement";
            label = Some(self.jump_target(sentence)?.0);
            self.next();
            self.expect_semicolon("Expected a ';' following a targeted break statement")?;
        }
        Ok(self.step_node::<BUILD>(start, StmtKind::Break(label)))
    }

    #[inline(never)]
    fn continue_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        let is_valid = self.context.contains(Context::CONTINUE);
        if !is_valid && self.context.contains(Context::STATIC_BLOCK) {
            return Err(self.reject("'continue' cannot cross static block boundary"));
        }
        let mut label = None;
        if self.eat_semicolon() {
            if !is_valid {
                return Err(self.reject("'continue' is only valid inside a loop statement"));
            }
        } else {
            let sentence = "Expected an identifier as the target for a continue statement";
            let (name, is_loop) = self.jump_target(sentence)?;
            if !is_loop {
                return Err(self.reject_naming(
                    "Cannot continue to the label '%' as it is not targeting a loop",
                    name,
                ));
            }
            label = Some(name);
            self.next();
            self.expect_semicolon("Expected a ';' following a targeted continue statement")?;
        }
        Ok(self.step_node::<BUILD>(start, StmtKind::Continue(label)))
    }

    /// The label, and whether it is that of a loop.
    fn jump_target(&mut self, sentence: &'static str) -> Parsed<(Name, bool)> {
        if !self.at_name() {
            return Err(self.fail(sentence));
        }
        let name = self.token().name();
        match self.find_label(name) {
            Some(is_loop) => Ok((name, is_loop)),
            None => Err(self.reject_naming("Cannot use the undeclared label '%'", name)),
        }
    }

    #[inline(never)]
    fn with_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        if self.is_strict() {
            return Err(self.reject("'with' statements are not valid in strict mode"));
        }
        let start = self.start();
        self.next();
        self.expect(
            TokenKind::OpenParen,
            "Expected '(' to start a subject of a 'with' statement",
        )?;
        let object_start = self.start();
        let object = self.expression::<BUILD>()?;
        self.pause_at::<BUILD>(object);
        let object_end = self.previous_end();
        self.expect(
            TokenKind::CloseParen,
            "Expected ')' to start a subject of a 'with' statement",
        )?;
        self.scopes.push(ScopeKind::With, self.start());
        let body =
            self.substatement::<BUILD>(Position::Body, "A 'with' statement must have a body")?;
        self.scopes.pop_with();
        let kind = StmtKind::With {
            object: object.id(),
            body,
            object_start,
            object_end,
        };
        Ok(self.statement_node::<BUILD>(start, kind))
    }

    #[inline(never)]
    fn switch_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        let discriminant = self.condition::<BUILD>(
            "Expected '(' to start a subject of a 'switch'",
            "Expected ')' to end a subject of a 'switch'",
        )?;
        self.expect(
            TokenKind::OpenBrace,
            "Expected '{' to start a body of a 'switch'",
        )?;
        self.scopes.push(ScopeKind::Switch, self.previous_end());
        let could_break = self.context & Context::BREAK;
        self.context |= Context::BREAK;
        let (list, mut has_default) = (self.open_list(), false);
        loop {
            let (start, declared) = (self.start(), self.scopes.lexical_count());
            let test = if self.eat(TokenKind::Case) {
                let test = self.expression::<BUILD>()?.id();
                self.expect(
                    TokenKind::Colon,
                    "Expected a ':' after switch clause expression",
                )?;
                Some(test)
            } else if !has_default && self.eat(TokenKind::Default) {
                has_default = true;
                self.expect(
                    TokenKind::Colon,
                    "Expected a ':' after switch default clause",
                )?;
                None
            } else {
                break;
            };
            let body = self.statements::<BUILD>()?;
            if BUILD {
                let end = self.previous_end();
                self.scopes.end_clause(declared, end);
                let case = self.ast.push_case(Case {
                    test,
                    body,
                    start,
                    end,
                });
                self.ast.push_to_list(case);
            }
        }
        self.context = (self.context - Context::BREAK) | could_break;
        self.expect(
            TokenKind::CloseBrace,
            "Expected '}' to end a body of a 'switch'",
        )?;
        let kind = StmtKind::Switch {
            discriminant,
            cases: self.close_list::<BUILD, _>(list),
            scope: self.pop_scope::<BUILD>(),
        };
        Ok(self.statement_node::<BUILD>(start, kind))
    }

    #[inline(never)]
    fn try_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        self.require(
            TokenKind::OpenBrace,
            "Expected a block statement as body of a try statement",
        )?;
        let block = self.block::<BUILD>()?;
        let (mut parameter, mut parameter_scope) = (None, None);
        let (mut handler, mut finalizer) = (None, None);
        if self.eat(TokenKind::Catch) {
            if self.at(TokenKind::OpenBrace) {
                handler = Some(self.block::<BUILD>()?);
            } else {
                let (pattern, is_simple) = self.catch_parameter::<BUILD>()?;
                self.scopes.push_catch_block(self.start());
                handler = Some(self.block_in_open_scope::<BUILD>()?);
                let scope = self.pop_scope::<BUILD>();
                if BUILD && (!is_simple || self.is_anything_used(scope)) {
                    (parameter, parameter_scope) = (Some(pattern), scope);
                }
            }
        }
        if self.eat(TokenKind::Finally) {
            self.require(
                TokenKind::OpenBrace,
                "Expected block statement for finally body",
            )?;
            finalizer = Some(self.block::<BUILD>()?);
        }
        if handler.is_none() && finalizer.is_none() {
            return Err(self.fail("Try statements must have at least a catch or finally block"));
        }
        let kind = StmtKind::Try {
            block,
            parameter,
            parameter_scope,
            handler,
            finalizer,
        };
        Ok(self.statement_node::<BUILD>(start, kind))
    }

    fn is_anything_used(&self, scope: Option<ScopeId>) -> bool {
        scope.is_some_and(|scope| {
            (self.ast.bindings(scope).iter())
                .any(|binding| binding.flags.contains(BindingFlags::USED))
        })
    }

    /// Opens its scope, and stops at the brace. Returns whether it is just a name.
    fn catch_parameter<const BUILD: bool>(&mut self) -> Parsed<(Pattern, bool)> {
        self.expect(
            TokenKind::OpenParen,
            "Expected '(' to start a 'catch' target",
        )?;
        let (token, declared) = (self.token(), self.scopes.lexical_count());
        let is_simple = self.is_name(token);
        let pattern = if is_simple {
            self.scopes.push(ScopeKind::SimpleCatch, token.start());
            self.refuse_await(token, "catch parameter name")?;
            self.next();
            let name = token.name();
            if is_eval_or_arguments(name) {
                let sentence = "Cannot declare a catch variable named '%' in strict mode";
                self.declare_eval_or_arguments(name, sentence)?;
            }
            self.scopes.declare_lexical(name, BindingKind::Let);
            let declaration = Some(DeclarationKind::Let);
            let kind = PatternKind::Binding { name, declaration };
            self.pattern_node::<BUILD>(token.start(), token.end(), kind)
        } else {
            self.scopes.push(ScopeKind::Block, token.start());
            self.pattern::<BUILD>(Binder::Catch)?
        };
        (self.scopes).initialize_lexicals(declared, self.lexer.previous_end);
        self.expect(
            TokenKind::CloseParen,
            "Expected ')' to end a 'catch' target",
        )?;
        self.require(
            TokenKind::OpenBrace,
            "Expected exception handler to be a block statement",
        )?;
        Ok((pattern, is_simple))
    }

    #[inline(always)]
    fn variable_statement<const BUILD: bool>(
        &mut self,
        kind: DeclarationKind,
    ) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        let statement = self.variable_declaration::<BUILD>(kind, start)?;
        self.pause_at_statement::<BUILD>(statement);
        Ok(statement)
    }

    /// After the keyword, which is at `start`.
    #[inline(never)]
    pub(super) fn variable_declaration<const BUILD: bool>(
        &mut self,
        kind: DeclarationKind,
        start: u32,
    ) -> Parsed<Statement> {
        let declarators = self.declarators::<BUILD>(kind, start, In::Allowed)?;
        self.expect_semicolon("Expected ';' after variable declaration")?;
        Ok(self.statement_node::<BUILD>(start, StmtKind::Variables(declarators.node.id())))
    }

    /// After the first keyword, which is at `start`. `in` is forbidden in the head of a loop, and only there.
    #[inline(always)]
    pub(super) fn declarators<const BUILD: bool>(
        &mut self,
        kind: DeclarationKind,
        start: u32,
        r#in: In,
    ) -> Parsed<Declarators> {
        let list = self.open_list();
        if kind == DeclarationKind::AwaitUsing {
            self.note_await();
            self.next();
        }
        let (mut node, mut last) = self.declarator::<BUILD>(kind, start, r#in)?;
        let (mut count, mut lacks_initializer) = (1, !last.has_initializer);
        while self.eat(TokenKind::Comma) {
            if kind == DeclarationKind::AwaitUsing {
                self.scopes.note_suspension();
            }
            if count == 1 {
                self.pause_at::<BUILD>(node);
                self.append::<BUILD>(node.id());
            }
            (node, last) = self.declarator::<BUILD>(kind, self.start(), r#in)?;
            self.pause_at::<BUILD>(node);
            self.append::<BUILD>(node.id());
            count += 1;
            lacks_initializer |= !last.has_initializer;
        }
        if count > 1 {
            let elements = self.close_list::<BUILD, _>(list);
            node = self.node::<BUILD>(Class::Other, start, ExprKind::Sequence(elements));
        }
        Ok(Declarators {
            node,
            count,
            last,
            lacks_initializer,
        })
    }

    #[inline(always)]
    fn declarator<const BUILD: bool>(
        &mut self,
        kind: DeclarationKind,
        start: u32,
        r#in: In,
    ) -> Parsed<(Expression, Declarator)> {
        let token = self.token();
        if token.kind() != TokenKind::Identifier || token.name() <= Name::EVAL {
            if !self.is_name(token) {
                return self.pattern_declarator::<BUILD>(kind, start, r#in);
            }
            self.check_unusual_declared_name(kind)?;
        }
        let (name, declared) = (token.name(), self.scopes.lexical_count());
        self.next();
        self.declare_name(kind, token)?;
        if BUILD && self.context.contains(Context::EXPORTING) {
            self.export_declaration(name, "Cannot export a duplicate name '%'")?;
        }
        let has_initializer = self.eat(TokenKind::Assign);
        let node = if has_initializer {
            if kind == DeclarationKind::Var {
                self.scopes.write(name, token.start());
            }
            let value_start = self.start();
            let value = self.assignment_in::<BUILD>(r#in)?.id();
            if BUILD {
                self.name_anonymous(value, name);
                let initialized_from = match self.ast[value].kind {
                    ExprKind::Function(_) => value_start,
                    _ => self.previous_end(),
                };
                self.scopes.initialize_lexicals(declared, initialized_from);
            }
            let kind = ExprKind::Initialize {
                kind,
                name,
                name_start: token.start(),
                value,
            };
            let node = self.node::<BUILD>(Class::Other, start, kind);
            self.end_expression::<BUILD>(node);
            node
        } else {
            if r#in == In::Allowed && !matches!(kind, DeclarationKind::Var | DeclarationKind::Let) {
                return Err(self.fail_for_initializer(kind, name));
            }
            if BUILD
                && kind == DeclarationKind::Let
                && (r#in == In::Allowed || !self.at_enumeration())
            {
                self.scopes.initialize_lexicals(declared, token.end());
                self.scopes.note_starts_undefined();
            }
            self.node::<BUILD>(
                Class::Other,
                token.start(),
                ExprKind::Declare { kind, name },
            )
        };
        let declarator = Declarator {
            target: Declared::Name(token),
            has_initializer,
        };
        Ok((node, declarator))
    }

    pub(super) fn at_enumeration(&self) -> bool {
        self.at(TokenKind::In) || self.at_contextual(Name::OF)
    }

    #[cold]
    #[inline(never)]
    fn fail_for_initializer(&mut self, kind: DeclarationKind, name: Name) -> Failed {
        if is_using(kind) {
            return self.fail("'using' declaration requires an initializer");
        }
        self.fail_naming("const declared variable '%' must have an initializer", name)
    }

    #[cold]
    #[inline(never)]
    fn check_unusual_declared_name(&mut self, kind: DeclarationKind) -> Parsed<()> {
        let token = self.token();
        if token.name() == Name::ARGUMENTS && self.context.contains(Context::STATIC_BLOCK) {
            return self.refuse_arguments();
        }
        if token.spells(TokenKind::Let) && kind != DeclarationKind::Var {
            return Err(self.fail(LET_IN_LEXICAL_DECLARATION));
        }
        self.refuse_await(token, role(kind))
    }

    #[inline(always)]
    fn declare_name(&mut self, kind: DeclarationKind, token: Token) -> Parsed<()> {
        let name = token.name();
        if is_eval_or_arguments(name) {
            let sentence = "Cannot declare a variable named % in strict mode";
            self.declare_eval_or_arguments(name, sentence)?;
        }
        let (kind, keyword) = match kind {
            DeclarationKind::Var => return self.declare_variable(name, token.start()),
            DeclarationKind::Let => (BindingKind::Let, "let"),
            DeclarationKind::Const => (BindingKind::Const, "const"),
            DeclarationKind::Using => (BindingKind::Using, "using"),
            DeclarationKind::AwaitUsing => (BindingKind::AwaitUsing, "using"),
        };
        if !self.scopes.declare_lexical(name, kind) {
            let parts = &[keyword.into(), name.into()];
            return Err(self.reject_with("Cannot declare a % variable twice: '%'", parts));
        }
        Ok(())
    }

    /// In the head of a loop that enumerates, the node is not used.
    #[inline(never)]
    fn pattern_declarator<const BUILD: bool>(
        &mut self,
        kind: DeclarationKind,
        start: u32,
        r#in: In,
    ) -> Parsed<(Expression, Declarator)> {
        if self.at(TokenKind::PrivateName) {
            return Err(self.fail("Cannot use a private name to declare a variable"));
        }
        let binder = match kind {
            DeclarationKind::Var => Binder::Var,
            DeclarationKind::Let => Binder::Let,
            DeclarationKind::Const => Binder::Const,
            _ if matches!(self.kind(), TokenKind::OpenBrace | TokenKind::OpenBracket) => {
                return Err(self.fail("'using' declarations cannot have a destructuring pattern"));
            }
            _ => return Err(self.fail("Expected an identifier name in 'using' declaration")),
        };
        let declared = self.scopes.lexical_count();
        let pattern = match r#in {
            In::Allowed => self.pattern::<BUILD>(binder)?,
            In::Forbidden => self.repeated_pattern::<BUILD>(binder)?,
        };
        let has_initializer = self.eat(TokenKind::Assign);
        let node = if has_initializer {
            let value = self.assignment_in::<BUILD>(r#in)?.id();
            (self.scopes).initialize_lexicals(declared, self.lexer.previous_end);
            let kind = ExprKind::Destructure { pattern, value };
            self.node::<BUILD>(Class::Other, start, kind)
        } else if r#in == In::Forbidden && self.at_enumeration() {
            self.node::<BUILD>(Class::Other, start, ExprKind::Null)
        } else {
            return Err(self.fail("Expected an initializer in destructuring variable declaration"));
        };
        let declarator = Declarator {
            target: Declared::Pattern(pattern),
            has_initializer,
        };
        Ok((node, declarator))
    }
}
