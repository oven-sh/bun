//! Primary expressions, and what follows them to access a member or to call.

use super::{Class, Context, Expression, Facts, Failed, Parsed, Session};
use crate::ast::{CallFlags, ExprFlags, ExprId, ExprKind, List, ResultType};
use crate::chars::{self, Start};
use crate::names::Name;
use crate::options::{EvalContext, Goal};
use crate::token::{Token, TokenKind};

#[derive(Clone, Copy, PartialEq, Eq)]
enum Base {
    Plain,
    Super,
    Async,
}

struct Arguments {
    list: List<ExprId>,
    flags: CallFlags,
}

impl Session<'_> {
    /// LeftHandSideExpression of ECMA-262.
    #[inline(never)]
    pub(super) fn member<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        self.check_stack()?;
        self.member_inline::<BUILD>()
    }

    #[inline(always)]
    pub(super) fn member_inline<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let start = self.start();
        let Some(base) = self.common_primary::<BUILD>() else {
            return self.unusual_member::<BUILD>();
        };
        let base = base?;
        if !self.kind().continues_member() {
            return Ok(base);
        }
        self.plain_suffixes::<BUILD>(start, base)
    }

    #[inline(always)]
    pub(super) fn plain_suffixes<const BUILD: bool>(
        &mut self,
        start: u32,
        base: Expression,
    ) -> Parsed<Expression> {
        self.suffixes::<BUILD>(start, base, Base::Plain, 0)
    }

    #[inline(always)]
    fn common_primary<const BUILD: bool>(&mut self) -> Option<Parsed<Expression>> {
        let token = self.token();
        Some(match token.kind() {
            TokenKind::Identifier if !(Name::ARGUMENTS..=Name::ASYNC).contains(&token.name()) => {
                self.identifier::<BUILD>(Class::Identifier)
            }
            TokenKind::This => Ok(self.this::<BUILD>()),
            TokenKind::Number | TokenKind::String => Ok(self.scalar::<BUILD>()),
            TokenKind::Null | TokenKind::True | TokenKind::False => Ok(self.constant::<BUILD>()),
            TokenKind::OpenParen => self.parenthesized::<BUILD>(),
            TokenKind::OpenBrace => self.object_literal::<BUILD>(),
            TokenKind::OpenBracket => self.array_literal::<BUILD>(),
            TokenKind::Function => self.function_expression::<BUILD>(token.start()),
            _ => return None,
        })
    }

    #[inline(always)]
    pub(super) fn this<const BUILD: bool>(&mut self) -> Expression {
        let start = self.start();
        self.note_this();
        self.next();
        self.node::<BUILD>(Class::Other, start, ExprKind::This)
    }

    /// `null`, `true` or `false`.
    #[inline(always)]
    pub(super) fn constant<const BUILD: bool>(&mut self) -> Expression {
        let token = self.token();
        self.next();
        let (result, kind) = match token.kind() {
            TokenKind::Null => (ResultType::NULL, ExprKind::Null),
            kind => (
                ResultType::BOOLEAN,
                ExprKind::Boolean(kind == TokenKind::True),
            ),
        };
        self.typed_node::<BUILD>(Class::Other, token.start(), result, kind)
    }

    #[inline(always)]
    fn identifier<const BUILD: bool>(&mut self, class: Class) -> Parsed<Expression> {
        let token = self.token();
        self.next();
        if self.at(TokenKind::Arrow) {
            return Err(self.fail("Cannot parse base expression"));
        }
        Ok(self.reference::<BUILD>(class, token))
    }

    #[inline(always)]
    pub(super) fn reference<const BUILD: bool>(
        &mut self,
        class: Class,
        token: Token,
    ) -> Expression {
        let name = token.name();
        self.scopes.read(name, token.start());
        self.named_node::<BUILD>(class, name, token.start(), ExprKind::Identifier(name))
    }

    #[inline(always)]
    fn note_this(&mut self) {
        self.facts |= Facts::USES_THIS;
        if self.context.contains(Context::ARROW) {
            self.scopes.capture(Name::THIS_VALUE, false);
        }
    }

    #[inline(always)]
    fn parenthesized<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let may_be_called = BUILD && self.may_open_call();
        self.next();
        if may_be_called {
            self.eager_start = self.start();
        }
        let Ok(mut inner) = self.expression::<BUILD>() else {
            self.eat(TokenKind::CloseParen);
            return Err(Failed);
        };
        self.expect(
            TokenKind::CloseParen,
            "Expected ')' to end a compound expression",
        )?;
        if BUILD {
            self.ast[inner.id()].flags |= ExprFlags::PARENTHESIZED;
            if let ExprKind::Function(function) = self.ast[inner.id()].kind
                && !matches!(
                    self.kind(),
                    TokenKind::OpenParen | TokenKind::Dot | TokenKind::CloseParen | TokenKind::End
                )
            {
                self.ast[function].tree = None;
            }
        }
        if inner.class == Class::Operation {
            inner.class = Class::Other;
        }
        Ok(inner)
    }

    /// At a parenthesis. Bundlers put them around the modules in their tables too.
    #[inline(always)]
    fn may_open_call(&self) -> bool {
        let previous = (self.previous_end() as usize).wrapping_sub(1);
        !matches!(self.lexer.byte(previous), b'[' | b',' | b':') || self.eager_start == self.start()
    }

    #[inline(never)]
    fn unusual_member<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let floor = self.stacks.prefixes.len();
        let result = self.unusual_member_above::<BUILD>(floor);
        if BUILD {
            self.stacks.prefixes.truncate(floor);
        }
        result
    }

    #[inline(always)]
    fn unusual_member_above<const BUILD: bool>(&mut self, floor: usize) -> Parsed<Expression> {
        let start = self.start();
        let mut news = 0;
        while self.at(TokenKind::New) {
            if BUILD {
                let prefix = (TokenKind::New, self.start());
                self.stacks.prefixes.push(prefix);
            }
            news += 1;
            self.next();
        }
        let mut kind = Base::Plain;
        let base = match self.kind() {
            TokenKind::Dot if news != 0 => {
                news -= 1;
                self.new_target::<BUILD>(start)?
            }
            TokenKind::Super => {
                kind = Base::Super;
                self.super_keyword::<BUILD>(start)?
            }
            TokenKind::Import => self.import_expression::<BUILD>(start, news != 0)?,
            _ if news != 0 && self.at_await_operator() => return Err(self.misplaced_await()),
            _ if self.at_contextual(Name::ASYNC) => {
                let base = self.async_primary::<BUILD>()?;
                if base.class == Class::Identifier && !self.follows_newline() {
                    kind = Base::Async;
                    if self.at_name() {
                        return Err(self.unexpected());
                    }
                }
                base
            }
            _ => match self.common_primary::<BUILD>() {
                Some(base) => base?,
                None => self.unusual_primary::<BUILD>(start)?,
            },
        };
        if BUILD {
            self.stacks.prefixes.truncate(floor + news as usize);
            if news != 0
                && let ExprKind::Function(function) = self.ast[base.id()].kind
            {
                self.ast[function].tree = None;
            }
        }
        self.suffixes::<BUILD>(start, base, kind, news)
    }

    fn async_primary<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let token = self.token();
        self.next();
        match self.kind() {
            TokenKind::Function if !self.follows_newline() => {
                self.function_expression::<BUILD>(token.start())
            }
            TokenKind::Arrow => Err(self.fail("Cannot parse base expression")),
            _ => Ok(self.reference::<BUILD>(Class::Identifier, token)),
        }
    }

    #[inline(always)]
    fn unusual_primary<const BUILD: bool>(&mut self, start: u32) -> Parsed<Expression> {
        let token = self.token();
        match token.kind() {
            TokenKind::Identifier => match token.name() {
                Name::ARGUMENTS => self.arguments_object::<BUILD>(start),
                Name::EVAL => self.identifier::<BUILD>(Class::Eval),
                _ => self.identifier::<BUILD>(Class::Identifier),
            },
            TokenKind::Class => self.class_expression::<BUILD>(),
            TokenKind::Backquote => self.template_literal::<BUILD>(),
            TokenKind::Slash | TokenKind::DivideAssign => self.regexp_literal::<BUILD>(),
            TokenKind::BigInt => Ok(self.bigint_literal::<BUILD>()),
            TokenKind::Await => self.await_as_primary::<BUILD>(),
            TokenKind::Let | TokenKind::Yield | TokenKind::EscapedKeyword
                if self.is_unreserved(token) =>
            {
                self.identifier::<BUILD>(Class::Identifier)
            }
            _ => Err(self.unexpected()),
        }
    }

    pub(super) fn refuse_arguments(&mut self) -> Parsed<()> {
        if (self.context).intersects(Context::STATIC_BLOCK | Context::FIELD_IN_STATIC_BLOCK) {
            return Err(self.reject("Cannot use 'arguments' as an identifier in static block"));
        }
        if self.context.contains(Context::FIELD_INITIALIZER) {
            return Err(self.fail("Cannot reference 'arguments' in class field initializer"));
        }
        if self.context.contains(Context::NO_ARGUMENTS_IN_EVAL) {
            return Err(self.fail("arguments is not valid in this context"));
        }
        if self.context.contains(Context::NO_ARGUMENTS_IN_STATIC_BLOCK) {
            return Err(self.reject("Cannot use 'arguments' as an identifier in static block"));
        }
        Ok(())
    }

    fn arguments_object<const BUILD: bool>(&mut self, start: u32) -> Parsed<Expression> {
        self.refuse_arguments()?;
        let arguments = self.identifier::<BUILD>(Class::Arguments)?;
        if !BUILD {
            return Ok(arguments);
        }
        if !self.at(TokenKind::Dot) || !self.peek().is_contextual(Name::LENGTH) {
            self.facts |= Facts::USES_ARGUMENTS;
            return Ok(arguments);
        }
        self.facts |= Facts::READS_ARGUMENTS_LENGTH;
        let divot = self.start();
        self.next();
        let kind = ExprKind::Dot {
            base: arguments.id(),
            name: Name::LENGTH,
            divot,
            end: self.token().end(),
        };
        self.next();
        Ok(self.node::<BUILD>(Class::ArgumentsLength, start, kind))
    }

    #[cold]
    fn await_as_primary<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        if self.context.contains(Context::STATIC_BLOCK) {
            return Err(self.reject(
                "The 'await' keyword is disallowed in the IdentifierReference position within static block",
            ));
        }
        if self.context.contains(Context::PARAMETERS) {
            if self.context.contains(Context::NO_AWAIT_IN_PARAMETERS) {
                return Err(self.reject("Cannot use 'await' within a parameter default expression"));
            }
        } else if self.is_await_operator() {
            return self.await_expression::<BUILD>();
        }
        if self.context.contains(Context::MODULE) {
            return Err(self.reject("Cannot use 'await' as an identifier in a module"));
        }
        self.identifier::<BUILD>(Class::Identifier)
    }

    /// Where only a member expression can be.
    #[cold]
    pub(super) fn misplaced_await(&mut self) -> Failed {
        let (token, previous_end) = (self.token(), self.previous_end());
        if self.await_expression::<false>().is_ok() {
            self.lexer.restore(token, previous_end);
        }
        self.unexpected()
    }

    /// At the dot.
    fn new_target<const BUILD: bool>(&mut self, start: u32) -> Parsed<Expression> {
        self.next();
        if !self.at_contextual(Name::TARGET) {
            if self.at(TokenKind::Identifier) {
                return Err(self.fail("\"new.\" can only be followed with target"));
            }
            return Err(self.unexpected());
        }
        if !self.context.contains(Context::NEW_TARGET) {
            return Err(self.reject(if self.context.contains(Context::ARROW) {
                "new.target is not valid inside arrow functions in global code"
            } else {
                "new.target is only valid inside functions or static blocks"
            }));
        }
        self.facts |= Facts::USES_NEW_TARGET;
        if self.context.contains(Context::ARROW) {
            self.scopes.capture(Name::NEW_TARGET, false);
        }
        self.next();
        Ok(self.node::<BUILD>(Class::NewTarget, start, ExprKind::NewTarget))
    }

    fn is_top_level_of_eval_in_field(&self) -> bool {
        matches!(
            self.options.goal,
            Goal::Eval { context, .. } if context.contains(EvalContext::IN_FIELD_INITIALIZER)
        ) && self.scopes.depth() == 1
    }

    fn super_keyword<const BUILD: bool>(&mut self, start: u32) -> Parsed<Expression> {
        const SENTENCE: &str = "super is not valid in this context";
        let is_allowed = self.context.contains(Context::SUPER_PROPERTY);
        if !is_allowed && !self.context.contains(Context::FUNCTION) {
            return Err(self.reject(SENTENCE));
        }
        self.next();
        if self.at(TokenKind::OpenParen) && self.is_top_level_of_eval_in_field() {
            return Err(self.fail("super call is not valid in this context"));
        }
        if !is_allowed {
            return Err(self.reject(SENTENCE));
        }
        self.note_this();
        Ok(self.node::<BUILD>(Class::Other, start, ExprKind::Super))
    }

    fn note_super_property(&mut self) {
        self.facts |= Facts::USES_SUPER_PROPERTY;
        if self.context.contains(Context::ARROW) {
            self.scopes.capture(Name::HOME, false);
        }
    }

    fn note_super_call(&mut self) -> Parsed<()> {
        if !self.context.contains(Context::SUPER_CALL) {
            return Err(self.reject("super is not valid in this context"));
        }
        self.facts |= Facts::USES_NEW_TARGET;
        if self.context.contains(Context::ARROW) {
            self.scopes.capture(Name::THIS_VALUE, true);
            for name in [
                Name::NEW_TARGET,
                Name::ACTIVE_FUNCTION,
                Name::FIELD_INITIALIZER,
            ] {
                self.scopes.capture(name, false);
            }
        }
        Ok(())
    }

    fn import_expression<const BUILD: bool>(
        &mut self,
        start: u32,
        follows_new: bool,
    ) -> Parsed<Expression> {
        const SENTENCE: &str = "import call expects one or two arguments";
        self.next();
        let is_deferred = self.eat(TokenKind::Dot);
        if is_deferred {
            if self.at_contextual(Name::META) {
                if !self.context.contains(Context::MODULE) {
                    return Err(self.reject("import.meta is only valid inside modules"));
                }
                self.scopes.capture(Name::IMPORT_META, false);
                self.next();
                return Ok(self.node::<BUILD>(Class::ImportMeta, start, ExprKind::ImportMeta));
            }
            if !self.at_contextual(Name::DEFER) {
                if self.at(TokenKind::Identifier) {
                    return Err(self.fail("\"import.\" can only be followed with meta or defer"));
                }
                return Err(self.unexpected());
            }
            self.next();
        }
        let divot = self.previous_end();
        if follows_new {
            return Err(self.reject("Cannot use new with import"));
        }
        self.expect(TokenKind::OpenParen, SENTENCE)?;
        let specifier = self.assignment::<BUILD>()?.id();
        let mut options = None;
        if self.eat(TokenKind::Comma) && !self.at(TokenKind::CloseParen) {
            options = Some(self.assignment::<BUILD>()?.id());
            self.eat(TokenKind::Comma);
        }
        self.expect(TokenKind::CloseParen, SENTENCE)?;
        let kind = ExprKind::Import {
            specifier,
            options,
            divot,
            end: self.previous_end(),
            is_deferred,
        };
        Ok(self.node::<BUILD>(Class::Other, start, kind))
    }

    pub(super) fn refer_to_private_name(&mut self, token: Token) {
        self.facts |= Facts::PRIVATE_NAMES;
        self.scopes.read(token.name(), token.start());
    }

    /// `news` operators are waiting for their arguments, with their places on top of the stack of prefixes.
    #[inline(never)]
    fn suffixes<const BUILD: bool>(
        &mut self,
        start: u32,
        mut base: Expression,
        mut kind: Base,
        mut news: u32,
    ) -> Parsed<Expression> {
        self.check_stack()?;
        let mut is_in_chain = false;
        loop {
            match self.kind() {
                TokenKind::Dot => {
                    if kind == Base::Super {
                        self.note_super_property();
                    }
                    base = self.dot::<BUILD>(start, base, kind, is_in_chain)?;
                }
                TokenKind::OpenParen if news != 0 => {
                    if kind == Base::Super {
                        return Err(self.reject_new_super());
                    }
                    news -= 1;
                    base = self.construction::<BUILD>(start, base)?;
                }
                TokenKind::OpenParen => {
                    base = self.call::<BUILD>(start, base, kind, CallFlags::empty())?;
                }
                TokenKind::OpenBracket => {
                    if kind == Base::Super {
                        self.note_super_property();
                    }
                    base = self.index::<BUILD>(start, base)?;
                }
                TokenKind::Backquote => {
                    if is_in_chain {
                        return Err(self.reject("Cannot use tagged templates in an optional chain"));
                    }
                    if kind == Base::Super {
                        return Err(self.reject("Cannot use super as tag for tagged templates"));
                    }
                    base = self.tagged_template::<BUILD>(start, base)?;
                }
                TokenKind::QuestionDot => {
                    if news != 0 {
                        return Err(self.reject("Cannot call constructor in an optional chain"));
                    }
                    if kind == Base::Super {
                        return Err(
                            self.reject("Cannot use super as the base of an optional chain")
                        );
                    }
                    if is_in_chain {
                        base = self.end_chain::<BUILD>(start, base, false);
                    }
                    is_in_chain = true;
                    base = self.optional_link::<BUILD>(start, base, kind)?;
                }
                _ => break,
            }
            if kind == Base::Super {
                kind = Base::Plain;
            }
        }
        if is_in_chain {
            return Ok(self.end_chain::<BUILD>(start, base, true));
        }
        if kind == Base::Super {
            return Err(self.reject(match news {
                0 => "super is not valid in this context",
                _ => "Cannot use new with super call",
            }));
        }
        for _ in 0..news {
            let divot = if BUILD { self.pop_new() } else { 0 };
            let kind = ExprKind::New {
                callee: base.id(),
                arguments: List::EMPTY,
                divot,
                end: self.previous_end(),
                flags: CallFlags::empty(),
            };
            base = self.node::<BUILD>(Class::Other, start, kind);
        }
        Ok(base)
    }

    fn pop_new(&mut self) -> u32 {
        self.stacks.prefixes.pop().map_or(0, |(_, start)| start)
    }

    #[cold]
    #[inline(never)]
    fn reject_new_super(&mut self) -> Failed {
        if self.context.contains(Context::FIELD_INITIALIZER) {
            return self.fail("super call is not valid in class field initializer context");
        }
        self.reject("Cannot use new with super call")
    }

    /// At `.` or `?.`.
    #[inline(always)]
    fn dot<const BUILD: bool>(
        &mut self,
        start: u32,
        base: Expression,
        kind: Base,
        is_in_chain: bool,
    ) -> Parsed<Expression> {
        let divot = self.start();
        self.lexer.next_key::<BUILD>();
        let token = self.token();
        if !token.kind().is_identifier_name() {
            return self.private_dot::<BUILD>(start, base, divot, kind, is_in_chain);
        }
        self.next();
        let kind = ExprKind::Dot {
            base: base.id(),
            name: token.name(),
            divot,
            end: token.end(),
        };
        Ok(self.node::<BUILD>(Class::Member, start, kind))
    }

    #[inline(never)]
    fn private_dot<const BUILD: bool>(
        &mut self,
        start: u32,
        base: Expression,
        divot: u32,
        kind: Base,
        is_in_chain: bool,
    ) -> Parsed<Expression> {
        let token = self.token();
        if token.kind() != TokenKind::PrivateName {
            return Err(self.fail(if is_in_chain {
                "Expected a property name after '?.'"
            } else {
                "Expected a property name after '.'"
            }));
        }
        if kind == Base::Super {
            return Err(self.fail("Cannot access private names from super"));
        }
        let name = token.name();
        if self.is_top_level_of_eval_in_field() && !self.is_private_name_declared_outside(name) {
            let parts = &[name.into()];
            return Err(self.reject_with("Cannot reference undeclared private field '%'", parts));
        }
        self.refer_to_private_name(token);
        self.next();
        let kind = ExprKind::PrivateDot {
            base: base.id(),
            name,
            divot,
            end: token.end(),
        };
        Ok(self.named_node::<BUILD>(Class::PrivateMember, name, start, kind))
    }

    #[inline(always)]
    fn index<const BUILD: bool>(&mut self, start: u32, base: Expression) -> Parsed<Expression> {
        let (divot, assignments) = (self.start(), self.assignments);
        self.next();
        let key = self.expression::<BUILD>()?;
        self.expect(
            TokenKind::CloseBracket,
            "Expected ']' to end a subscript expression",
        )?;
        let kind = ExprKind::Index {
            base: base.id(),
            key: key.id(),
            divot,
            end: self.previous_end(),
            key_assigns: self.assignments != assignments,
        };
        Ok(self.node::<BUILD>(Class::Member, start, kind))
    }

    #[inline(always)]
    fn construction<const BUILD: bool>(
        &mut self,
        start: u32,
        callee: Expression,
    ) -> Parsed<Expression> {
        if BUILD {
            self.pop_new();
        }
        let divot = self.previous_end();
        let arguments = self.arguments::<BUILD>(false)?;
        let kind = ExprKind::New {
            callee: callee.id(),
            arguments: arguments.list,
            divot,
            end: self.previous_end(),
            flags: arguments.flags,
        };
        Ok(self.node::<BUILD>(Class::Other, start, kind))
    }

    #[inline(always)]
    fn call<const BUILD: bool>(
        &mut self,
        start: u32,
        callee: Expression,
        kind: Base,
        flags: CallFlags,
    ) -> Parsed<Expression> {
        if kind == Base::Super && self.context.contains(Context::FIELD_INITIALIZER) {
            return Err(self.reject_new_super());
        }
        let divot = self.previous_end();
        let is_wrapper = BUILD && matches!(self.ast[callee.id()].kind, ExprKind::Function(_));
        let arguments = self.arguments::<BUILD>(is_wrapper)?;
        if kind != Base::Plain || matches!(callee.class, Class::Eval | Class::ArgumentsLength) {
            self.finish_unusual_call(callee, kind, flags)?;
        }
        let kind = ExprKind::Call {
            callee: callee.id(),
            arguments: arguments.list,
            divot,
            end: self.previous_end(),
            flags: flags | arguments.flags,
        };
        Ok(self.node::<BUILD>(Class::Call, start, kind))
    }

    #[cold]
    #[inline(never)]
    fn finish_unusual_call(
        &mut self,
        callee: Expression,
        kind: Base,
        flags: CallFlags,
    ) -> Parsed<()> {
        self.note_more_than_read(callee);
        if callee.class == Class::Eval && !flags.contains(CallFlags::OPTIONAL) {
            self.scopes.note_direct_eval(self.is_strict());
        }
        match kind {
            Base::Async if self.at(TokenKind::Arrow) => Err(self.unexpected()),
            Base::Super => self.note_super_call(),
            _ => Ok(()),
        }
    }

    /// A function that is written where it is called is likely to call the functions that it is given.
    #[inline(always)]
    fn arguments<const BUILD: bool>(&mut self, are_for_wrapper: bool) -> Parsed<Arguments> {
        let (list, assignments) = (self.open_list(), self.assignments);
        let mut flags = CallFlags::empty();
        self.next();
        while !self.at(TokenKind::CloseParen) {
            if are_for_wrapper {
                self.eager_start = self.start();
            }
            let argument = if self.at(TokenKind::Ellipsis) {
                flags |= CallFlags::SPREAD;
                self.spread::<BUILD>()?
            } else {
                self.assignment::<BUILD>()?
            };
            self.append::<BUILD>(argument.id());
            if !self.eat(TokenKind::Comma) {
                if !self.at(TokenKind::CloseParen) {
                    return Err(self.fail_in_arguments());
                }
                break;
            }
        }
        self.next();
        if self.assignments != assignments {
            flags |= CallFlags::ARGUMENTS_ASSIGN;
        }
        Ok(Arguments {
            list: self.close_list::<BUILD, _>(list),
            flags,
        })
    }

    #[cold]
    #[inline(never)]
    fn fail_in_arguments(&mut self) -> Failed {
        if self.at(TokenKind::Ellipsis) {
            return self.reject("The '...' operator should come before the target expression");
        }
        self.fail("Expected ')' to end an argument list")
    }

    #[inline(never)]
    pub(super) fn spread<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let operator = self.token();
        self.next();
        let value = self.assignment::<BUILD>()?;
        let kind = ExprKind::Spread {
            value: value.id(),
            divot: operator.end(),
            end: self.previous_end(),
        };
        Ok(self.node::<BUILD>(Class::Other, operator.start(), kind))
    }

    /// At `?.`.
    #[inline(never)]
    fn optional_link<const BUILD: bool>(
        &mut self,
        start: u32,
        mut base: Expression,
        kind: Base,
    ) -> Parsed<Expression> {
        self.end_expression::<BUILD>(base);
        let next = match chars::start(self.lexer.byte(self.token().end() as usize)) {
            Start::Name => TokenKind::Identifier,
            _ => self.peek().kind(),
        };
        if next == TokenKind::OpenParen {
            self.next();
            if BUILD {
                base = self.without_chain(base);
            }
            return self.call::<BUILD>(start, base, kind, CallFlags::OPTIONAL);
        }
        if BUILD {
            self.ast[base.id()].flags |= ExprFlags::OPTIONAL_BASE;
        }
        match next {
            TokenKind::OpenBracket => {
                self.next();
                self.index::<BUILD>(start, base)
            }
            TokenKind::Backquote => {
                self.next();
                Err(self.reject("Cannot use tagged templates in an optional chain"))
            }
            _ => self.dot::<BUILD>(start, base, kind, true),
        }
    }

    /// The callee of `a?.b?.()` is a member of `a`, which is the `this` of the call.
    fn without_chain(&self, callee: Expression) -> Expression {
        if let ExprKind::OptionalChain { chain, .. } = self.ast[callee.id()].kind
            && let ExprKind::Dot { .. } | ExprKind::PrivateDot { .. } | ExprKind::Index { .. } =
                self.ast[chain].kind
        {
            return Expression {
                word: crate::ast::Element::word(chain),
                class: Class::Member,
            };
        }
        callee
    }

    #[inline(never)]
    fn end_chain<const BUILD: bool>(
        &mut self,
        start: u32,
        chain: Expression,
        is_outermost: bool,
    ) -> Expression {
        self.end_expression::<BUILD>(chain);
        let class = match chain.class {
            Class::PrivateMember => Class::OptionalPrivateMember,
            _ => Class::Other,
        };
        if !BUILD {
            return Expression { class, ..chain };
        }
        let kind = ExprKind::OptionalChain {
            chain: chain.id(),
            is_outermost,
        };
        self.node::<BUILD>(class, start, kind)
    }
}
