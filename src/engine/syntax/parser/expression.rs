//! Operators.

use super::node::{Operand, assign_operator};
use super::{Class, Context, Expression, Facts, Failed, In, Parsed, Session};
use crate::ast::{Element, ExprId, ExprKind, ResultType, UnaryOperator, UpdateOperator};
use crate::chars::{self, Start};
use crate::names::Name;
use crate::token::{RELATIONAL_PRECEDENCE, TokenKind};

/// An operand that waits for the other one.
pub(super) struct Pending {
    left: Operand,
    operator: TokenKind,
}

const AMBIGUOUS_BASE: &str = "Ambiguous unary expression in the left hand side of the exponentiation expression; \
    parentheses must be used to disambiguate the expression";

type Reader = fn(&mut Session<'_>, In) -> Parsed<Expression>;

/// What reads an AssignmentExpression of ECMA-262, by the kind of its first token.
const fn readers<const BUILD: bool>() -> [Reader; 128] {
    let mut readers: [Reader; 128] = [|it, r#in| it.assignment_from_operand::<BUILD>(r#in); 128];
    let mut index = 0;
    while index < readers.len() {
        readers[index] = match TokenKind::from_index(index as u8) {
            TokenKind::Identifier => |it, r#in| it.assignment_from_identifier::<BUILD>(r#in),
            TokenKind::Number | TokenKind::String => {
                |it, r#in| it.assignment_from_token::<BUILD>(r#in, Session::scalar::<BUILD>)
            }
            TokenKind::This => {
                |it, r#in| it.assignment_from_token::<BUILD>(r#in, Session::this::<BUILD>)
            }
            TokenKind::Null | TokenKind::True | TokenKind::False => {
                |it, r#in| it.assignment_from_token::<BUILD>(r#in, Session::constant::<BUILD>)
            }
            TokenKind::Function => |it, r#in| it.assignment_from_function::<BUILD>(r#in),
            TokenKind::OpenParen => |it, r#in| it.assignment_from_paren::<BUILD>(r#in),
            TokenKind::OpenBrace | TokenKind::OpenBracket => {
                |it, r#in| it.assignment_from_literal::<BUILD>(r#in)
            }
            TokenKind::Let | TokenKind::Yield | TokenKind::Await | TokenKind::EscapedKeyword => {
                |it, r#in| it.assignment_from_word::<BUILD>(r#in)
            }
            _ => readers[index],
        };
        index += 1;
    }
    readers
}

static BUILDERS: [Reader; 128] = readers::<true>();
static CHECKERS: [Reader; 128] = readers::<false>();

fn update_operator(kind: TokenKind) -> UpdateOperator {
    match kind {
        TokenKind::Increment => UpdateOperator::Increment,
        _ => UpdateOperator::Decrement,
    }
}

impl Session<'_> {
    #[inline(always)]
    pub(super) fn expression<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        self.expression_in::<BUILD>(In::Allowed)
    }

    #[inline(always)]
    pub(super) fn expression_in<const BUILD: bool>(&mut self, r#in: In) -> Parsed<Expression> {
        let start = self.start();
        let first = self.assignment_in::<BUILD>(r#in)?;
        self.end_expression::<BUILD>(first);
        if !self.at(TokenKind::Comma) {
            return Ok(first);
        }
        self.sequence::<BUILD>(start, first, r#in)
    }

    #[inline(never)]
    fn sequence<const BUILD: bool>(
        &mut self,
        start: u32,
        first: Expression,
        r#in: In,
    ) -> Parsed<Expression> {
        let list = self.open_list();
        self.pause_at::<BUILD>(first);
        self.append::<BUILD>(first.id());
        while self.eat(TokenKind::Comma) {
            let element = self.assignment_in::<BUILD>(r#in)?;
            self.end_expression::<BUILD>(element);
            self.pause_at::<BUILD>(element);
            self.append::<BUILD>(element.id());
        }
        let elements = self.close_list::<BUILD, _>(list);
        let sequence = self.node::<BUILD>(Class::Operation, start, ExprKind::Sequence(elements));
        self.end_expression::<BUILD>(sequence);
        Ok(sequence)
    }

    #[inline(always)]
    pub(super) fn assignment<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        self.assignment_in::<BUILD>(In::Allowed)
    }

    #[inline(always)]
    pub(super) fn assignment_in<const BUILD: bool>(&mut self, r#in: In) -> Parsed<Expression> {
        let starts = if BUILD { &BUILDERS } else { &CHECKERS };
        starts[self.kind().index() % starts.len()](self, r#in)
    }

    #[inline(always)]
    fn assignment_from_identifier<const BUILD: bool>(&mut self, r#in: In) -> Parsed<Expression> {
        let first = self.token();
        if (Name::ARGUMENTS..=Name::ASYNC).contains(&first.name()) {
            return self.assignment_from_word::<BUILD>(r#in);
        }
        self.next();
        if self.at(TokenKind::Arrow) {
            return self.arrow_after_name::<BUILD>(first, r#in);
        }
        let identifier = self.reference::<BUILD>(Class::Identifier, first);
        self.assignment_after_primary::<BUILD>(first.start(), identifier, r#in)
    }

    /// `primary` reads one token.
    #[inline(always)]
    fn assignment_from_token<const BUILD: bool>(
        &mut self,
        r#in: In,
        primary: impl Fn(&mut Self) -> Expression,
    ) -> Parsed<Expression> {
        let start = self.start();
        let primary = primary(self);
        self.assignment_after_primary::<BUILD>(start, primary, r#in)
    }

    #[inline(always)]
    fn assignment_from_function<const BUILD: bool>(&mut self, r#in: In) -> Parsed<Expression> {
        let start = self.start();
        match self.function_expression::<BUILD>(start) {
            Ok(function) => self.assignment_after_primary::<BUILD>(start, function, r#in),
            Err(Failed) => Err(self.failed_after(start)),
        }
    }

    #[inline(always)]
    fn assignment_from_operand<const BUILD: bool>(&mut self, r#in: In) -> Parsed<Expression> {
        let (start, assignments) = (self.start(), self.assignments);
        match self.operand::<BUILD>(0) {
            Ok(operand) if self.kind().ends_expression() => Ok(operand),
            Ok(operand) => {
                self.assignment_after_operand::<BUILD>(start, operand, assignments, r#in)
            }
            Err(Failed) => Err(self.failed_after(start)),
        }
    }

    /// One that assigns nothing.
    #[inline(always)]
    fn assignment_after_primary<const BUILD: bool>(
        &mut self,
        start: u32,
        primary: Expression,
        r#in: In,
    ) -> Parsed<Expression> {
        if self.kind().ends_expression() {
            return Ok(primary);
        }
        self.assignment_after_operand::<BUILD>(start, primary, self.assignments, r#in)
    }

    /// The operand may lack its suffixes yet, unless it is an operation. `assignments` is what it was at `start`.
    #[inline(never)]
    pub(super) fn assignment_after_operand<const BUILD: bool>(
        &mut self,
        start: u32,
        mut left: Expression,
        assignments: u32,
        r#in: In,
    ) -> Parsed<Expression> {
        if left.class != Class::Operation {
            let Ok(operand) = self.rest_of_operand::<BUILD>(start, left) else {
                return Err(self.failed_after(start));
            };
            if self.kind().ends_expression() {
                return Ok(operand);
            }
            left = operand;
        }
        if !self.kind().is_assignment() {
            let Ok(conditional) = self.rest_of_conditional::<BUILD>(start, left, assignments, r#in)
            else {
                return Err(self.failed_after(start));
            };
            if self.at(TokenKind::Arrow) && self.starts_with_word(start) {
                return Err(self.unexpected());
            }
            left = conditional;
        }
        self.rest_of_assignment::<BUILD>(start, left, assignments, r#in)
    }

    #[cold]
    fn starts_with_word(&self, start: u32) -> bool {
        let byte = self.lexer.byte(start as usize);
        chars::start(byte) == Start::Name || chars::continues_name(byte) || byte == b'@'
    }

    /// What starts with a word could have been an arrow function, but for the arrow.
    #[cold]
    #[inline(never)]
    fn failed_after(&mut self, start: u32) -> Failed {
        let is_settled = self.at(TokenKind::End)
            || (self.at(TokenKind::Await) && self.context.contains(Context::STATIC_BLOCK));
        if !is_settled && self.starts_with_word(start) {
            return self.skip_attempt();
        }
        Failed
    }

    /// ConditionalExpression of ECMA-262.
    pub(super) fn conditional<const BUILD: bool>(&mut self, r#in: In) -> Parsed<Expression> {
        let (start, assignments) = (self.start(), self.assignments);
        let operand = self.operand::<BUILD>(0)?;
        if self.kind().ends_expression() {
            return Ok(operand);
        }
        self.rest_of_conditional::<BUILD>(start, operand, assignments, r#in)
    }

    /// `assignments` is what it was at `start`.
    #[inline(always)]
    pub(super) fn rest_of_assignment<const BUILD: bool>(
        &mut self,
        start: u32,
        target: Expression,
        assignments: u32,
        r#in: In,
    ) -> Parsed<Expression> {
        let operator = self.token();
        if !operator.kind().is_assignment() {
            return Ok(target);
        }
        self.check_stack()?;
        if target.class != Class::Member {
            self.begin_assignment::<BUILD>(start, target)?;
        }
        let target_assigns = self.assignments != assignments;
        self.count_assignment::<BUILD>();
        let assignments = self.assignments;
        self.next();
        if target.class.is_eval_or_arguments() && self.is_strict() {
            return Err(self.reject_modification::<BUILD>(target));
        }
        let value = self.assignment_in::<BUILD>(r#in)?;
        if self.kind().is_assignment() {
            return Err(self.reject_target(value));
        }
        if BUILD
            && (operator.kind() == TokenKind::Assign || operator.kind().is_logical_assignment())
        {
            self.name_after_target(value.id(), target.id());
        }
        let kind = ExprKind::Assign {
            operator: assign_operator(operator.kind()),
            target_assigns,
            value_assigns: self.assignments != assignments,
            target: target.id(),
            value: value.id(),
            divot: operator.start() + 1,
            end: self.previous_end(),
        };
        Ok(self.node::<BUILD>(Class::Operation, start, kind))
    }

    /// At the operator.
    #[inline(always)]
    fn begin_assignment<const BUILD: bool>(
        &mut self,
        start: u32,
        target: Expression,
    ) -> Parsed<()> {
        if !target.class.is_reference()
            && (!self.is_assignable(target) || self.kind().is_logical_assignment())
        {
            return Err(self.reject_target(target));
        }
        self.note_write::<BUILD>(start, target);
        Ok(())
    }

    /// An assignment to a call is an error only when it runs, for the sake of old code.
    #[inline(always)]
    pub(super) fn is_assignable(&self, target: Expression) -> bool {
        target.class.is_reference() || (target.class == Class::Call && !self.is_strict())
    }

    #[inline(always)]
    pub(super) fn note_write<const BUILD: bool>(&mut self, start: u32, target: Expression) {
        if target.class.is_identifier() {
            self.scopes.write(self.name_of::<BUILD>(target), start);
        } else {
            self.note_more_than_read(target);
        }
    }

    #[inline(always)]
    pub(super) fn note_more_than_read(&mut self, expression: Expression) {
        if expression.class == Class::ArgumentsLength {
            self.facts |= Facts::USES_ARGUMENTS;
        }
    }

    #[cold]
    #[inline(never)]
    fn reject_target(&mut self, target: Expression) -> Failed {
        if target.class == Class::Operation {
            let parts = &[self.token().into()];
            return self.reject_with("Left hand side of operator '%' must be a reference", parts);
        }
        self.reject_operand(
            target,
            "% can't be the left hand side of an assignment expression",
            "Left side of assignment is not a reference",
        )
    }

    #[cold]
    #[inline(never)]
    fn reject_operand(
        &mut self,
        operand: Expression,
        if_meta_property: &'static str,
        otherwise: &'static str,
    ) -> Failed {
        match operand.class {
            Class::NewTarget => self.reject_saying(if_meta_property, "new.target"),
            Class::ImportMeta => self.reject_saying(if_meta_property, "import.meta"),
            _ => self.reject(otherwise),
        }
    }

    #[cold]
    #[inline(never)]
    pub(super) fn reject_modification<const BUILD: bool>(&mut self, target: Expression) -> Failed {
        let name = self.name_of::<BUILD>(target);
        self.reject_naming("Cannot modify '%' in strict mode", name)
    }

    #[inline(never)]
    fn rest_of_conditional<const BUILD: bool>(
        &mut self,
        start: u32,
        operand: Expression,
        assignments: u32,
        r#in: In,
    ) -> Parsed<Expression> {
        let test = if self.precedence(r#in) == 0 {
            operand
        } else if BUILD {
            self.build_binary(start, operand, assignments, r#in)?
        } else {
            self.check_binary(start, r#in)?
        };
        if !self.eat(TokenKind::Question) {
            return Ok(test);
        }
        self.check_stack()?;
        let consequent = self.assignment::<BUILD>()?;
        self.end_expression::<BUILD>(consequent);
        self.expect(TokenKind::Colon, "Expected ':' in ternary operator")?;
        let alternate = self.assignment_in::<BUILD>(r#in)?;
        self.end_expression::<BUILD>(alternate);
        let kind = ExprKind::Conditional {
            test: test.id(),
            consequent: consequent.id(),
            alternate: alternate.id(),
        };
        Ok(self.node::<BUILD>(Class::Operation, start, kind))
    }

    #[inline(always)]
    fn precedence(&self, r#in: In) -> u8 {
        if r#in == In::Forbidden && self.at(TokenKind::In) {
            return 0;
        }
        self.kind().precedence()
    }

    /// At a binary operator. `seen` has a bit for `??` and one for `&&` and `||`.
    #[inline(always)]
    fn check_operator(&mut self, operand_start: u32, seen: &mut u8) -> Parsed<()> {
        match self.kind() {
            TokenKind::Exponentiate if self.starts_with_unary_operator(operand_start) => {
                return Err(self.fail(AMBIGUOUS_BASE));
            }
            TokenKind::And | TokenKind::Or => *seen |= 1,
            TokenKind::Coalesce => *seen |= 2,
            _ => {}
        }
        if *seen == 3 {
            return Err(self.fail(
                "Coalescing and logical operators used together in the same expression; \
                parentheses must be used to disambiguate",
            ));
        }
        Ok(())
    }

    /// One that is neither `++` nor `--`.
    #[cold]
    fn starts_with_unary_operator(&mut self, start: u32) -> bool {
        let (token, previous_end) = (self.token(), self.previous_end());
        self.lexer.jump(start);
        let kind = self.kind();
        self.lexer.restore(token, previous_end);
        kind.is_prefix_operator() && !kind.is_update()
    }

    #[inline(always)]
    fn check_binary(&mut self, mut operand_start: u32, r#in: In) -> Parsed<Expression> {
        let mut seen = 0;
        loop {
            let precedence = self.precedence(r#in);
            if precedence == 0 {
                return Ok(Expression {
                    word: 0,
                    class: Class::Operation,
                });
            }
            self.check_operator(operand_start, &mut seen)?;
            self.next();
            operand_start = self.start();
            self.operand::<false>(precedence)?;
        }
    }

    #[inline(always)]
    fn build_binary(
        &mut self,
        start: u32,
        first: Expression,
        assignments: u32,
        r#in: In,
    ) -> Parsed<Expression> {
        let floor = self.stacks.operands.len();
        let mut operand = Operand {
            id: first.id(),
            start,
            end: self.previous_end(),
            assigns: self.assignments != assignments,
        };
        let (mut seen, mut operand_start) = (0, start);
        loop {
            let (operator, precedence) = (self.kind(), self.precedence(r#in));
            while self.stacks.operands.len() > floor
                && let Some(Pending { left, operator }) = self.stacks.operands.pop_if(|pending| {
                    precedence <= pending.operator.precedence()
                        && operator != TokenKind::Exponentiate
                })
            {
                operand = Operand {
                    id: self.binary_node(start, operator, left, operand),
                    start: left.start,
                    end: operand.end,
                    assigns: left.assigns || operand.assigns,
                };
            }
            if precedence == 0 {
                return Ok(Expression {
                    word: operand.id.word(),
                    class: Class::Operation,
                });
            }
            self.stacks.operands.push(Pending {
                left: operand,
                operator,
            });
            let assignments = self.assignments;
            let right = self
                .check_operator(operand_start, &mut seen)
                .and_then(|()| {
                    self.next();
                    operand_start = self.start();
                    self.operand::<true>(precedence)
                });
            let Ok(right) = right else {
                self.stacks.operands.truncate(floor);
                return Err(Failed);
            };
            operand = Operand {
                id: right.id(),
                start: operand_start,
                end: self.previous_end(),
                assigns: self.assignments != assignments,
            };
            if let ExprKind::PrivateName(_) = self.ast[operand.id].kind {
                self.ast[operand.id].start = start;
            }
        }
    }

    /// UnaryExpression of ECMA-262, or what stands before `in`. `precedence` is that of the operator before it.
    #[inline(never)]
    fn operand<const BUILD: bool>(&mut self, precedence: u8) -> Parsed<Expression> {
        self.check_stack()?;
        let start = self.start();
        match self.kind() {
            kind if kind.is_prefix_operator() => self.prefixed::<BUILD>(),
            TokenKind::Await if self.is_await_operator() => {
                if self.context.contains(Context::STATIC_BLOCK) {
                    return Err(self.reject("Cannot use 'await' within static block"));
                }
                self.await_expression::<BUILD>()
            }
            TokenKind::PrivateName => self.private_name_before_in::<BUILD>(precedence),
            _ => {
                let operand = self.member_inline::<BUILD>()?;
                self.postfix::<BUILD>(start, start, operand, None)
            }
        }
    }

    #[inline(always)]
    fn rest_of_operand<const BUILD: bool>(
        &mut self,
        start: u32,
        mut operand: Expression,
    ) -> Parsed<Expression> {
        if self.kind().continues_member() {
            operand = self.plain_suffixes::<BUILD>(start, operand)?;
        }
        self.postfix::<BUILD>(start, start, operand, None)
    }

    #[cold]
    #[inline(never)]
    fn private_name_before_in<const BUILD: bool>(&mut self, precedence: u8) -> Parsed<Expression> {
        let token = self.token();
        self.refer_to_private_name(token);
        self.next();
        if !self.at(TokenKind::In) || precedence >= RELATIONAL_PRECEDENCE {
            return Err(self.reject(
                "Bare private name can only be used as the left-hand side of an `in` expression",
            ));
        }
        let kind = ExprKind::PrivateName(token.name());
        Ok(self.node::<BUILD>(Class::Other, token.start(), kind))
    }

    /// `prefix` is a `++` or `--` before the operand.
    #[inline(always)]
    fn postfix<const BUILD: bool>(
        &mut self,
        start: u32,
        operand_start: u32,
        operand: Expression,
        prefix: Option<TokenKind>,
    ) -> Parsed<Expression> {
        if !self.kind().is_update() || self.follows_newline() {
            return Ok(operand);
        }
        self.postfix_update::<BUILD>(start, operand_start, operand, prefix)
    }

    #[inline(never)]
    fn postfix_update<const BUILD: bool>(
        &mut self,
        start: u32,
        operand_start: u32,
        operand: Expression,
        prefix: Option<TokenKind>,
    ) -> Parsed<Expression> {
        let operator = self.token();
        let is_increment = operator.kind() == TokenKind::Increment;
        if !self.is_assignable(operand) {
            return Err(self.reject_operand(
                operand,
                "% can't come before a postfix operator",
                if is_increment {
                    "Postfix ++ operator applied to value that is not a reference"
                } else {
                    "Postfix -- operator applied to value that is not a reference"
                },
            ));
        }
        if operand.class.is_eval_or_arguments() && self.is_strict() {
            if is_increment {
                return Err(self.reject_modification::<BUILD>(operand));
            }
            let name = self.name_of::<BUILD>(operand);
            return Err(self.reject_naming("'%' cannot be modified in strict mode", name));
        }
        if let Some(prefix) = prefix {
            return Err(self.reject(match prefix {
                TokenKind::Increment => "The increment operator requires a reference expression",
                _ => "The decrement operator requires a reference expression",
            }));
        }
        self.note_write::<BUILD>(operand_start, operand);
        self.count_assignment::<BUILD>();
        let kind = ExprKind::Postfix {
            operator: update_operator(operator.kind()),
            operand: operand.id(),
            operand_start,
            divot: self.previous_end(),
            end: operator.end(),
        };
        self.next();
        Ok(self.node::<BUILD>(Class::Operation, start, kind))
    }

    #[inline(never)]
    fn prefixed<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let floor = self.stacks.prefixes.len();
        let result = self.prefixed_above::<BUILD>(floor);
        if BUILD {
            self.stacks.prefixes.truncate(floor);
        }
        result
    }

    #[inline(always)]
    fn prefixed_above<const BUILD: bool>(&mut self, floor: usize) -> Parsed<Expression> {
        let start = self.start();
        let mut last = self.kind();
        loop {
            if BUILD {
                let prefix = (last, self.start());
                self.stacks.prefixes.push(prefix);
            }
            self.next();
            if !self.kind().is_prefix_operator() {
                break;
            }
            if last.is_update() {
                return Err(self.reject(match last {
                    TokenKind::Increment => {
                        "The prefix-increment operator requires a reference expression"
                    }
                    _ => "The prefix-decrement operator requires a reference expression",
                }));
            }
            last = self.kind();
        }
        let operand_start = self.start();
        if BUILD && last == TokenKind::Not {
            self.eager_start = operand_start;
        }
        let operand = if self.at_await_operator() {
            self.await_expression::<BUILD>()?
        } else {
            self.member::<BUILD>()?
        };
        let update = last.is_update().then_some(last);
        if update.is_some() {
            self.begin_prefix_update::<BUILD>(last, operand_start, operand)?;
        }
        let operand = self.postfix::<BUILD>(start, operand_start, operand, update)?;
        if last == TokenKind::Delete {
            self.check_delete::<BUILD>(operand)?;
        }
        let mut word = operand.word;
        if BUILD {
            for index in (floor..self.stacks.prefixes.len()).rev() {
                let (operator, operator_start) = self.stacks.prefixes[index];
                let operand = ExprId::from_word(word);
                word = self
                    .prefix_node(start, operator, operator_start, operand)
                    .word();
            }
        }
        Ok(Expression {
            word,
            class: Class::Operation,
        })
    }

    fn begin_prefix_update<const BUILD: bool>(
        &mut self,
        operator: TokenKind,
        start: u32,
        operand: Expression,
    ) -> Parsed<()> {
        if !self.is_assignable(operand) {
            return Err(self.reject_operand(
                operand,
                "% can't come after a prefix operator",
                match operator {
                    TokenKind::Increment => {
                        "Prefix ++ operator applied to value that is not a reference"
                    }
                    _ => "Prefix -- operator applied to value that is not a reference",
                },
            ));
        }
        if operand.class.is_eval_or_arguments() && self.is_strict() {
            return Err(self.reject_modification::<BUILD>(operand));
        }
        self.note_write::<BUILD>(start, operand);
        self.count_assignment::<BUILD>();
        Ok(())
    }

    fn check_delete<const BUILD: bool>(&mut self, operand: Expression) -> Parsed<()> {
        self.note_more_than_read(operand);
        let sentence = match operand.class {
            class if class.is_identifier() && self.is_strict() => {
                "Cannot delete unqualified property '%' in strict mode"
            }
            Class::PrivateMember | Class::OptionalPrivateMember => "Cannot delete private field %",
            _ => return Ok(()),
        };
        let name = self.name_of::<BUILD>(operand);
        Err(self.reject_naming(sentence, name))
    }

    fn prefix_node(
        &mut self,
        start: u32,
        operator: TokenKind,
        operator_start: u32,
        operand: ExprId,
    ) -> ExprId {
        let end = self.previous_end();
        let operator = match operator {
            TokenKind::Not => UnaryOperator::Not,
            TokenKind::BitNot => UnaryOperator::BitNot,
            TokenKind::Minus => UnaryOperator::Negate,
            TokenKind::Plus => UnaryOperator::Plus,
            TokenKind::Void => UnaryOperator::Void,
            TokenKind::Typeof => {
                let kind = ExprKind::Typeof { operand, end };
                return self.push_typed(start, ResultType::STRING, kind);
            }
            TokenKind::Delete => return self.delete_node(start, operator_start, operand),
            _ => {
                let kind = ExprKind::Prefix {
                    operator: update_operator(operator),
                    operand,
                    operator_start,
                    end,
                };
                return self.push_typed(start, ResultType::UNKNOWN, kind);
            }
        };
        self.unary_node(start, operator, operand)
    }

    fn delete_node(&mut self, start: u32, operator_start: u32, operand: ExprId) -> ExprId {
        let end = self.previous_end();
        let delete = |operand| ExprKind::Delete {
            operand,
            operator_start,
            end,
        };
        if let ExprKind::OptionalChain {
            chain,
            is_outermost,
        } = self.ast[operand].kind
            && let ExprKind::Dot { .. } | ExprKind::Index { .. } = self.ast[chain].kind
        {
            let deletion = self.push_typed(start, ResultType::UNKNOWN, delete(chain));
            self.ast[deletion].end = self.ast[chain].end;
            self.ast[operand].kind = ExprKind::OptionalChain {
                chain: deletion,
                is_outermost,
            };
            return operand;
        }
        self.push_typed(start, ResultType::UNKNOWN, delete(operand))
    }

    #[inline(never)]
    pub(super) fn await_expression<const BUILD: bool>(&mut self) -> Parsed<Expression> {
        let start = self.start();
        self.next();
        if self.at(TokenKind::PrivateName) {
            return Err(self.unexpected());
        }
        let operand = if self.at_await_operator() {
            self.check_stack()?;
            self.await_expression::<BUILD>()?
        } else {
            self.operand::<BUILD>(0)?
        };
        if self.at(TokenKind::Exponentiate) {
            return Err(self.fail(AMBIGUOUS_BASE));
        }
        self.note_await();
        let kind = ExprKind::Await(operand.id());
        Ok(self.node::<BUILD>(operand.class.of_wrapper(), start, kind))
    }

    pub(super) fn note_await(&mut self) {
        self.facts |= Facts::AWAITS;
        self.scopes.note_suspension();
    }

    pub(super) fn yield_expression<const BUILD: bool>(&mut self, r#in: In) -> Parsed<Expression> {
        if !self.context.contains(Context::GENERATOR)
            || self.context.contains(Context::PARAMETERS_OF_ARROW)
        {
            return Err(self.fail("Cannot use yield expression out of generator"));
        }
        if self.context.contains(Context::PARAMETERS) {
            return Err(self.fail("Cannot use yield expression within parameters"));
        }
        if self.context.contains(Context::FIELD_INITIALIZER) {
            return Err(
                self.fail("Cannot use yield expression inside class field initializer expression")
            );
        }
        self.check_stack()?;
        self.scopes.note_suspension();
        let (start, mark) = (self.start(), self.mark());
        self.next();
        if !self.follows_newline() && !self.kind().ends_expression() {
            let delegates = self.eat(TokenKind::Star);
            let divot = self.start();
            if let Ok(argument) = self.assignment_in::<BUILD>(r#in) {
                let kind = if delegates {
                    ExprKind::YieldDelegate {
                        argument: argument.id(),
                        divot,
                        end: self.previous_end(),
                    }
                } else {
                    ExprKind::Yield(Some(argument.id()))
                };
                return Ok(self.node::<BUILD>(argument.class.of_wrapper(), start, kind));
            }
            if self.has_given_up() {
                return Err(Failed);
            }
            self.rewind(&mark);
            self.next();
        }
        Ok(self.node::<BUILD>(Class::Other, start, ExprKind::Yield(None)))
    }
}
