//! Loops.

use super::cover::Role;
use super::pattern::Binder;
use super::statement::{Declared, Position};
use super::{Class, Context, Expression, Failed, In, Parsed, Pass, Pattern, Session, Statement};
use crate::ast::{
    DeclarationKind, Enumeration, ExprId, ForTarget, PatternKind, ScopeKind, StmtKind,
};
use crate::names::Name;
use crate::token::TokenKind;

/// What is known of a `for` at the parenthesis.
#[derive(Clone, Copy)]
struct Head {
    start: u32,
    is_await: bool,
    /// Of the first token in the parentheses.
    init_start: u32,
}

impl Head {
    fn enumeration(self, is_of: bool, enumeration: Enumeration) -> StmtKind {
        match (is_of, self.is_await) {
            (false, _) => StmtKind::ForIn(enumeration),
            (true, false) => StmtKind::ForOf(enumeration),
            (true, true) => StmtKind::ForAwait(enumeration),
        }
    }
}

impl Session<'_> {
    #[inline(always)]
    fn loop_body<const BUILD: bool>(&mut self, sentence: &'static str) -> Parsed<Statement> {
        let outer = self.context & Context::LOOP;
        self.context |= Context::LOOP;
        let body = self.substatement::<BUILD>(Position::Body, sentence);
        self.context = (self.context - Context::LOOP) | outer;
        body
    }

    /// One that may be in the head of a loop that enumerates.
    pub(super) fn repeated_pattern<const BUILD: bool>(
        &mut self,
        binder: Binder,
    ) -> Parsed<Pattern> {
        self.scopes.enter_loop();
        let pattern = self.pattern::<BUILD>(binder);
        self.scopes.leave_loop();
        pattern
    }

    /// At the opening parenthesis. The sentences are for its absence, for nothing after it, and for the closing one.
    #[inline(always)]
    fn loop_condition<const BUILD: bool>(
        &mut self,
        [to_open, to_fill, to_close]: [&'static str; 3],
    ) -> Parsed<ExprId> {
        self.expect(TokenKind::OpenParen, to_open)?;
        if self.at(TokenKind::CloseParen) {
            return Err(self.reject(to_fill));
        }
        let test = self.expression::<BUILD>()?;
        self.pause_at::<BUILD>(test);
        self.expect(TokenKind::CloseParen, to_close)?;
        Ok(test.id())
    }

    #[inline(never)]
    pub(super) fn while_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        self.scopes.enter_loop();
        let closures = self.scopes.closure_count();
        let test = self.loop_condition::<BUILD>([
            "Expected '(' to start a while loop condition",
            "Must provide an expression as a while loop condition",
            "Expected ')' to end a while loop condition",
        ])?;
        let test_has_closure = self.scopes.closure_count() != closures;
        let body = self.loop_body::<BUILD>("Expected a statement as the body of a while loop")?;
        self.scopes.leave_loop();
        let kind = StmtKind::While {
            test,
            body,
            test_has_closure,
        };
        Ok(self.statement_node::<BUILD>(start, kind))
    }

    #[inline(never)]
    pub(super) fn do_while_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        self.scopes.enter_loop();
        let body = self.loop_body::<BUILD>("Expected a statement following 'do'")?;
        self.expect(TokenKind::While, "Expected 'while' to end a do-while loop")?;
        let test = self.loop_condition::<BUILD>([
            "Expected '(' to start a do-while loop condition",
            "Must provide an expression as a do-while loop condition",
            "Expected ')' to end a do-while loop condition",
        ])?;
        self.scopes.leave_loop();
        self.eat(TokenKind::Semicolon);
        Ok(self.statement_node::<BUILD>(start, StmtKind::DoWhile { body, test }))
    }

    #[inline(never)]
    pub(super) fn for_statement<const BUILD: bool>(&mut self) -> Parsed<Statement> {
        let start = self.start();
        self.next();
        let is_await = self.at(TokenKind::Await);
        if is_await {
            self.begin_for_await()?;
        }
        self.expect(
            TokenKind::OpenParen,
            "Expected '(' to start a for-loop header",
        )?;
        let head = Head {
            start,
            is_await,
            init_start: self.start(),
        };
        let kind = match self.kind() {
            TokenKind::Var => DeclarationKind::Var,
            TokenKind::Const => DeclarationKind::Const,
            TokenKind::Let if self.eat_let_keyword() => {
                return self.for_with_declaration::<BUILD>(head, DeclarationKind::Let);
            }
            TokenKind::Semicolon => return self.rest_of_plain_for::<BUILD>(head, None, None),
            _ => match self.using_declaration_ahead(true) {
                Some(kind) => kind,
                None => return self.for_with_expression::<BUILD>(head),
            },
        };
        self.next();
        self.for_with_declaration::<BUILD>(head, kind)
    }

    #[cold]
    fn begin_for_await(&mut self) -> Parsed<()> {
        if self.context.contains(Context::STATIC_BLOCK) || !self.is_await_operator() {
            return Err(self
                .reject("for-await-of can only be used in an async function or async generator"));
        }
        self.note_await();
        self.next();
        Ok(())
    }

    /// After the first keyword.
    #[inline(never)]
    fn for_with_declaration<const BUILD: bool>(
        &mut self,
        head: Head,
        kind: DeclarationKind,
    ) -> Parsed<Statement> {
        let is_lexical = kind != DeclarationKind::Var;
        if is_lexical {
            self.scopes.push(ScopeKind::Block, head.init_start);
        }
        let declared = self.scopes.lexical_count();
        let declarators = self.declarators::<BUILD>(kind, head.init_start, In::Forbidden)?;
        if self.at(TokenKind::Semicolon) {
            let declaration = (kind, declarators.lacks_initializer);
            return self.rest_of_plain_for::<BUILD>(
                head,
                Some(declarators.node),
                Some(declaration),
            );
        }
        if declarators.count != 1 {
            return Err(self.fail("can only declare a single variable in an enumeration"));
        }
        let divot = self.start();
        let is_of = !self.at(TokenKind::In);
        if is_of {
            self.require_of()?;
        } else if matches!(kind, DeclarationKind::Using | DeclarationKind::AwaitUsing) {
            return Err(self.fail("Cannot use 'using' declaration in for-in loop"));
        }
        self.pass_in_or_of(head, is_of)?;
        let last = declarators.last;
        if last.has_initializer {
            if is_of {
                return Err(
                    self.reject("Cannot assign to the loop variable inside a for-of loop header")
                );
            }
            if self.is_strict() || is_lexical || matches!(last.target, Declared::Pattern(_)) {
                return Err(
                    self.reject("Cannot assign to the loop variable inside a for-in loop header")
                );
            }
        }
        let (target_start, pattern) = match last.target {
            Declared::Pattern(pattern) => (head.init_start, pattern),
            Declared::Name(token) => {
                let name = token.name();
                if !is_lexical {
                    self.scopes.rewrite(name, token.start());
                }
                let declaration = Some(kind);
                let kind = PatternKind::Binding { name, declaration };
                let pattern = self.pattern_node::<BUILD>(token.start(), token.end(), kind);
                (token.start(), pattern)
            }
        };
        let (subject, end) = self.subject::<BUILD>(is_of)?;
        self.scopes.initialize_lexicals(declared, end);
        self.scopes.enter_loop();
        let body = self.loop_body::<BUILD>(if is_of {
            "Expected statement as body of for-of statement"
        } else {
            "Expected statement as body of for-in statement"
        })?;
        self.scopes.leave_loop();
        let enumeration = Enumeration {
            target: if last.has_initializer {
                ForTarget::Expression(declarators.node.id())
            } else {
                ForTarget::Pattern {
                    pattern,
                    start: head.init_start,
                }
            },
            subject,
            body,
            scope: if is_lexical {
                self.pop_scope::<BUILD>()
            } else {
                None
            },
            target_start,
            divot,
            end,
        };
        Ok(self.statement_node::<BUILD>(head.start, head.enumeration(is_of, enumeration)))
    }

    fn require_of(&mut self) -> Parsed<()> {
        if !self.at_contextual(Name::OF) {
            return Err(self.fail("Expected either 'in' or 'of' in enumeration syntax"));
        }
        Ok(())
    }

    fn pass_in_or_of(&mut self, head: Head, is_of: bool) -> Parsed<()> {
        if head.is_await && !is_of {
            return Err(self.fail("Expected 'of' in for-await syntax"));
        }
        self.next();
        Ok(())
    }

    /// With the closing parenthesis. Returns where it ends without.
    fn subject<const BUILD: bool>(&mut self, is_of: bool) -> Parsed<(ExprId, u32)> {
        let (subject, sentence) = if is_of {
            (
                self.assignment::<BUILD>()?,
                "Expected ')' to end a for-of header",
            )
        } else {
            (
                self.expression::<BUILD>()?,
                "Expected ')' to end a for-in header",
            )
        };
        self.pause_at::<BUILD>(subject);
        let end = self.previous_end();
        self.expect(TokenKind::CloseParen, sentence)?;
        Ok((subject.id(), end))
    }

    /// At the first semicolon. `declaration` says whether an initializer is missing.
    #[inline(never)]
    fn rest_of_plain_for<const BUILD: bool>(
        &mut self,
        head: Head,
        init: Option<Expression>,
        declaration: Option<(DeclarationKind, bool)>,
    ) -> Parsed<Statement> {
        if head.is_await {
            return Err(self.fail("Unexpected a ';' in for-await-of header"));
        }
        if let Some(init) = init {
            self.pause_at::<BUILD>(init);
        }
        let is_lexical = declaration.is_some_and(|(kind, _)| kind != DeclarationKind::Var);
        let init_has_closure = BUILD && is_lexical && self.scopes.has_closures();
        self.next();
        match declaration {
            Some((DeclarationKind::Const, true)) => {
                return Err(self.fail("const variables in for loops must have initializers"));
            }
            Some((DeclarationKind::Using | DeclarationKind::AwaitUsing, true)) => {
                return Err(self.fail("'using' declaration requires an initializer"));
            }
            _ => {}
        }
        self.scopes.enter_loop();
        let closures = self.scopes.closure_count();
        let test = self.clause_of_for::<BUILD>(
            TokenKind::Semicolon,
            "Expected a ';' after the for loop condition expression",
        )?;
        let test_has_closure = self.scopes.closure_count() != closures;
        let update = self.clause_of_for::<BUILD>(
            TokenKind::CloseParen,
            "Expected ')' to end a for-loop header",
        )?;
        let body = self.loop_body::<BUILD>("Expected a statement as the body of a for loop")?;
        self.scopes.leave_loop();
        let kind = StmtKind::For {
            init: init.map(Expression::id),
            test,
            update,
            body,
            scope: if is_lexical {
                self.pop_scope::<BUILD>()
            } else {
                None
            },
            init_has_closure,
            test_has_closure,
        };
        Ok(self.statement_node::<BUILD>(head.start, kind))
    }

    fn clause_of_for<const BUILD: bool>(
        &mut self,
        terminator: TokenKind,
        sentence: &'static str,
    ) -> Parsed<Option<ExprId>> {
        if self.eat(terminator) {
            return Ok(None);
        }
        let clause = self.expression::<BUILD>()?;
        self.pause_at::<BUILD>(clause);
        self.expect(terminator, sentence)?;
        Ok(Some(clause.id()))
    }

    /// None if what looks like a pattern is an expression.
    fn pattern_before_in_or_of<const BUILD: bool>(&mut self) -> Parsed<Option<Pattern>> {
        match (self.pass, self.stacks.memo.recall(self.start())) {
            (Pass::First, None) => {}
            (_, Some(Role::Target)) => {
                return self.repeated_pattern::<BUILD>(Binder::Assignment).map(Some);
            }
            _ => return Ok(None),
        }
        let (mark, tentative) = (self.mark(), self.scopes.begin_tentative());
        match self.repeated_pattern::<BUILD>(Binder::Assignment) {
            Ok(pattern) if self.at_enumeration() => {
                self.scopes.commit_tentative(tentative);
                return Ok(Some(pattern));
            }
            _ if !self.may_try_again() => return Err(Failed),
            _ => self.rewind(&mark),
        }
        self.stacks.memo.remember(self.start(), Role::Expression);
        Ok(None)
    }

    #[inline(never)]
    fn for_with_expression<const BUILD: bool>(&mut self, head: Head) -> Parsed<Statement> {
        let first = self.token();
        if matches!(first.kind(), TokenKind::OpenBrace | TokenKind::OpenBracket)
            && let Some(pattern) = self.pattern_before_in_or_of::<BUILD>()?
        {
            let start = first.start();
            let target = ForTarget::Pattern { pattern, start };
            return self.rest_of_enumeration::<BUILD>(head, target, true);
        }
        let is_async_of = first.is_contextual(Name::ASYNC) && self.peek().is_contextual(Name::OF);
        let tentative = self.scopes.begin_tentative();
        let init = if is_async_of && head.is_await {
            self.next();
            self.reference::<BUILD>(Class::Identifier, first)
        } else {
            self.expression_in::<BUILD>(In::Forbidden)?
        };
        if self.at(TokenKind::Semicolon) {
            self.scopes.commit_tentative(tentative);
            return self.rest_of_plain_for::<BUILD>(head, Some(init), None);
        }
        self.scopes.commit_tentative_as_repeated(tentative);
        self.pause_at::<BUILD>(init);
        if init.class == Class::Operation {
            return Err(
                self.fail("Expected a reference on the left hand side of an enumeration statement")
            );
        }
        if !self.at(TokenKind::In) {
            self.require_of()?;
            if first.kind() == TokenKind::Let {
                return Err(
                    self.fail("The left hand side of a for-of statement cannot start with 'let'")
                );
            }
            if is_async_of && !head.is_await {
                return Err(self.fail("The left hand side of a for-of statement cannot be 'async'"));
            }
        }
        if init.class.is_eval_or_arguments() && self.is_strict() {
            return Err(self.reject_modification::<BUILD>(init));
        }
        self.scopes.enter_loop();
        self.note_write::<BUILD>(first.start(), init);
        self.scopes.leave_loop();
        let is_pattern = self.pass == Pass::Scouting && init.class == Class::Literal;
        if is_pattern {
            self.stacks.memo.remember(first.start(), Role::Target);
        }
        let target = ForTarget::Expression(init.id());
        self.rest_of_enumeration::<BUILD>(head, target, is_pattern || self.is_assignable(init))
    }

    /// At `in` or `of`, after what is no declaration.
    fn rest_of_enumeration<const BUILD: bool>(
        &mut self,
        head: Head,
        target: ForTarget,
        is_assignable: bool,
    ) -> Parsed<Statement> {
        let divot = self.start();
        let is_of = !self.at(TokenKind::In);
        self.pass_in_or_of(head, is_of)?;
        let (subject, end) = self.subject::<BUILD>(is_of)?;
        self.scopes.enter_loop();
        let body = self.loop_body::<BUILD>(if is_of {
            "Expected a statement as the body of a for-of loop"
        } else {
            "Expected a statement as the body of a for-in loop"
        })?;
        self.scopes.leave_loop();
        if !is_assignable {
            return Err(self.reject("Left side of assignment is not a reference"));
        }
        let enumeration = Enumeration {
            target,
            subject,
            body,
            scope: None,
            target_start: head.init_start,
            divot,
            end,
        };
        Ok(self.statement_node::<BUILD>(head.start, head.enumeration(is_of, enumeration)))
    }
}
