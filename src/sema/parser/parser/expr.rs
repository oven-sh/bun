//! Expressions.

use super::stmt::ModifiersOf;
use super::{ListKind, Parser, ctx, oxc, take_span};
use crate::Rejection;
use crate::token::T;
use bun_sema::atom::{Atom, known};
use bun_sema::hir::*;

fn binary_operator(token: T) -> BinOp {
    match token {
        T::Plus => BinOp::Add,
        T::Minus => BinOp::Sub,
        T::Asterisk => BinOp::Mul,
        T::Slash => BinOp::Div,
        T::Percent => BinOp::Rem,
        T::AsteriskAsterisk => BinOp::Pow,
        T::LessThanLessThan => BinOp::Shl,
        T::GreaterThanGreaterThan => BinOp::Shr,
        T::GreaterThanGreaterThanGreaterThan => BinOp::UShr,
        T::Ampersand => BinOp::BitAnd,
        T::Bar => BinOp::BitOr,
        T::Caret => BinOp::BitXor,
        T::LessThan => BinOp::Lt,
        T::LessThanEquals => BinOp::Le,
        T::GreaterThan => BinOp::Gt,
        T::GreaterThanEquals => BinOp::Ge,
        T::EqualsEquals => BinOp::EqEq,
        T::ExclamationEquals => BinOp::NotEq,
        T::EqualsEqualsEquals => BinOp::EqEqEq,
        T::ExclamationEqualsEquals => BinOp::NotEqEq,
        T::In => BinOp::In,
        T::InstanceOf => BinOp::Instanceof,
        T::AmpersandAmpersand => BinOp::And,
        T::BarBar => BinOp::Or,
        T::QuestionQuestion => BinOp::Nullish,
        _ => BinOp::Comma,
    }
}

/// TypeScript reports an error in a type and continues. If what follows ends with a `>`, these are type arguments with
/// an error in them. `less_than` is the position of the `<`. The attempt failed at the token `failed_token` at
/// `failed_at`.
fn can_be_type_arguments_with_an_error(
    src: &[u8],
    less_than: usize,
    (failed_token, failed_at): (T, u32),
) -> bool {
    let rest = src.get(less_than..).unwrap_or_default();
    let statement = rest.get(..256).unwrap_or(rest);
    let statement = match bun_core::strings::index_of_char_usize(statement, b';') {
        Some(end) => &statement[..end],
        None => statement,
    };
    // TypeScript doesn't skip any token on the way, because any token but a comma ends a type argument list, which
    // makes `isInSomeParsingContext` true. So it never gets past a bracket that closes something opened before the `<`.
    let mut depth = 0u32;
    let is_unmatched = |c: &u8| match c {
        b'(' | b'[' | b'{' => {
            depth += 1;
            false
        }
        b')' | b']' | b'}' if depth == 0 => true,
        b')' | b']' | b'}' => {
            depth -= 1;
            false
        }
        _ => false,
    };
    let statement = match statement.iter().position(is_unmatched) {
        Some(end) => &statement[..end],
        None => statement,
    };
    // `canFollowTypeArgumentsInExpression`
    let ends_a_list = |at: usize| {
        let after = statement.get(at + 1..).unwrap_or_default();
        let next = after.iter().find(|c| !matches!(c, b' ' | b'\t'));
        statement.get(at.wrapping_sub(1)) != Some(&b'=')
            && !matches!(after.first(), Some(b'>' | b'='))
            && !next.is_some_and(|c| {
                c.is_ascii_alphanumeric() || b"_$\"'{[<+-~#@".contains(c) || *c >= 0x80
            })
    };
    // Everything before the error parsed cleanly.
    let mut from = (failed_at as usize).saturating_sub(less_than);
    // An unexpected word is left for the enclosing construct. Only a list accepts it, as its next element after a
    // missing comma.
    if failed_token.is_identifier_or_keyword() && !is_inside_type_list(statement, from) {
        from = statement.len();
    }
    while let Some(found) = statement
        .get(from..)
        .and_then(|rest| bun_core::strings::index_of_char_usize(rest, b'>'))
    {
        if ends_a_list(from + found) {
            return true;
        }
        from += found + 1;
    }
    false
}

/// `GetTextOfNodeFromSourceText`: returns the source range of `e`, including its parentheses if no other expression has
/// been parenthesized since.
fn source_range_of(f: &FileBuilder, e: ExprId) -> (u32, u32) {
    match (f.parens.last(), f.exprs.get(e.idx())) {
        (Some(&(inside, open, end)), _) if inside == e => (open, end),
        (_, Some(unparenthesized)) => (unparenthesized.pos, unparenthesized.end),
        _ => (0, 0),
    }
}

/// True if offset `end` of `text`, which is the source of some types, is inside a tuple, an object type or a parameter
/// list.
fn is_inside_type_list(text: &[u8], end: usize) -> bool {
    let mut open = Vec::new();
    for (at, c) in text.iter().enumerate().take(end) {
        match c {
            b'(' | b'[' | b'{' => open.push(at),
            b')' | b']' | b'}' => drop(open.pop()),
            _ => {}
        }
    }
    // `isUnambiguouslyStartOfFunctionType`: otherwise it's a parenthesized type.
    let starts_parameters = |after: &[u8]| {
        let after = after.trim_ascii_start();
        let is_in_name = |c: &&u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$' | 0x80..);
        let name = after.iter().take_while(is_in_name).count();
        let next = after
            .get(name..)
            .unwrap_or_default()
            .trim_ascii_start()
            .first();
        name == 0 || matches!(next, None | Some(b':' | b',' | b'?' | b'=' | b')'))
    };
    open.iter()
        .any(|&at| text[at] != b'(' || starts_parameters(&text[at + 1..]))
}

/// True for a name or a member access that isn't part of an optional chain.
#[inline(always)]
fn is_plain_target(kind: ExprKind) -> bool {
    matches!(
        kind,
        ExprKind::Ident(_)
            | ExprKind::Dot {
                chain: Chain::No,
                ..
            }
            | ExprKind::Index {
                chain: Chain::No,
                ..
            }
    )
}

/// Returns the binary operator of a compound assignment, or `None` for `=`.
fn assignment_operator(token: T) -> Option<BinOp> {
    Some(match token {
        T::PlusEquals => BinOp::Add,
        T::MinusEquals => BinOp::Sub,
        T::AsteriskEquals => BinOp::Mul,
        T::AsteriskAsteriskEquals => BinOp::Pow,
        T::SlashEquals => BinOp::Div,
        T::PercentEquals => BinOp::Rem,
        T::LessThanLessThanEquals => BinOp::Shl,
        T::GreaterThanGreaterThanEquals => BinOp::Shr,
        T::GreaterThanGreaterThanGreaterThanEquals => BinOp::UShr,
        T::AmpersandEquals => BinOp::BitAnd,
        T::BarEquals => BinOp::BitOr,
        T::CaretEquals => BinOp::BitXor,
        T::BarBarEquals => BinOp::Or,
        T::AmpersandAmpersandEquals => BinOp::And,
        T::QuestionQuestionEquals => BinOp::Nullish,
        _ => return None,
    })
}

impl<const GENERAL: bool, const COMMENTS: bool> Parser<'_, GENERAL, COMMENTS> {
    #[inline(always)]
    pub(crate) fn add_expr(&mut self, kind: ExprKind, pos: u32, end: u32) -> ExprId {
        let id = ExprId(self.f.exprs.len() as u32);
        self.finish_node(NodeData::Expr(id), pos, end);
        self.f.exprs.push(Expr { kind, pos, end });
        id
    }

    /// Adds an expression that ends with the previous token.
    #[inline(always)]
    pub(crate) fn finish_expr(&mut self, kind: ExprKind, pos: u32) -> ExprId {
        let end = self.prev_end();
        self.add_expr(kind, pos, end)
    }

    /// Adds `obj.name`, which ends at the end of the previous token.
    #[inline(always)]
    pub(crate) fn finish_dot(
        &mut self,
        obj: (ExprId, Chain),
        name: (Atom, u32),
        pos: u32,
    ) -> ExprId {
        let end = self.prev_end();
        let kind = self.f.dot(obj, name, end);
        self.add_expr(kind, pos, end)
    }

    /// Adds an expression that consists of the current token, and consumes the token.
    #[inline(always)]
    pub(crate) fn token_expr(&mut self, kind: ExprKind) -> ExprId {
        let id = self.add_expr(kind, self.lx.start, self.lx.end);
        self.next();
        id
    }

    /// Records that an `await` was parsed as a keyword.
    #[inline]
    pub(crate) fn note_await(&mut self) {
        if self.has_context(ctx::TOP_LEVEL) {
            self.has_top_level_await = true;
            self.has_plain_top_level_await = true;
            self.has_await_in_statement = true;
        }
    }

    /// `newIdentifier` for an `await`, which sets `statementHasAwaitIdentifier`. A function body restores the flag. A
    /// parameter default, a type and an arrow function's expression body don't, so an `await` there counts too. See
    /// `top_level_statement`.
    #[cold]
    #[inline(never)]
    pub(crate) fn note_await_as_a_name(&mut self) {
        if self.recovers() && !self.options.dialect.oxc {
            self.has_await_identifier = true;
        }
    }

    /// `allowInAnd(parseExpression)`
    #[inline]
    pub(crate) fn expression_allowing_in(&mut self) -> ExprId {
        let saved = self.enter_context(0, ctx::DISALLOW_IN);
        let expression = self.expression();
        self.context = saved;
        expression
    }

    /// `allowInAnd(parseAssignmentExpressionOrHigher)`
    #[inline]
    pub(crate) fn assignment_expression_allowing_in(&mut self) -> ExprId {
        let saved = self.enter_context(0, ctx::DISALLOW_IN);
        let expression = self.assignment_expression();
        self.context = saved;
        expression
    }

    /// `parseExpression`
    pub(crate) fn expression(&mut self) -> ExprId {
        self.expression_maybe_in_parentheses(false)
    }

    /// `parseExpression`. `is_in_parentheses` is set for `parseParenthesizedExpression`.
    #[inline(always)]
    fn expression_maybe_in_parentheses(&mut self, is_in_parentheses: bool) -> ExprId {
        let saved = self.enter_context(0, ctx::DECORATOR);
        let mut start = self.pos();
        let mut expression = self.assignment_expression();
        // The missing expression of `()` stays at the `)`.
        if is_in_parentheses && self.recovers() && self.token() != T::CloseParen {
            start = self.move_missing_operand_back(expression).unwrap_or(start);
        }
        while self.token() == T::Comma {
            self.next();
            let right = self.assignment_expression();
            if is_in_parentheses && self.recovers() {
                self.move_missing_operand_back(right);
            }
            let kind = ExprKind::Binary {
                op: BinOp::Comma,
                left: expression,
                right,
            };
            expression = self.finish_expr(kind, start);
        }
        self.context = saved;
        expression
    }

    /// `createMissingIdentifier`: if `operand` is a missing identifier at the current token, as in `(a, )` and
    /// `( , a)`, moves it to the end of the previous token and returns that position.
    #[cold]
    #[inline(never)]
    fn move_missing_operand_back(&mut self, operand: ExprId) -> Option<u32> {
        let (here, after_previous) = (self.pos(), self.full_start());
        let missing = self.f.exprs.get_mut(operand.idx())?;
        if !matches!(missing.kind, ExprKind::Missing) || missing.pos != here {
            return None;
        }
        missing.pos = after_previous;
        Some(after_previous)
    }

    #[inline(always)]
    pub(crate) fn assignment_expression(&mut self) -> ExprId {
        self.assignment_expression_or_higher(true)
    }

    /// True if `e`, which was just parsed, is parenthesized.
    #[inline(always)]
    pub(crate) fn is_parenthesized(&self, e: ExprId) -> bool {
        self.f.parens.last().is_some_and(|last| last.0 == e)
    }

    /// `IsLeftHandSideExpression` for `e`, which was just parsed and is followed by an assignment operator. Sets
    /// `rare::ODD_TARGET` unless it's a plain name or member.
    fn is_left_hand_side(&mut self, e: ExprId) -> bool {
        let Some(expr) = self.f.exprs.get(e.idx()) else {
            return false;
        };
        let kind = expr.kind;
        if is_plain_target(kind) {
            return true;
        }
        self.f.rare_syntax |= rare::ODD_TARGET;
        match kind {
            ExprKind::Fn(f) => self.f[f].kind != FnKind::Arrow || self.is_parenthesized(e),
            // oxc converts these into a target, and reports what can't be one. `<T>a = 1` and `a as T = 1` pass,
            // `-a = 1` is "Cannot assign to this expression".
            ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Await(_)
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_) => self.options.dialect.oxc || self.is_parenthesized(e),
            ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Yield { .. } => self.is_parenthesized(e),
            _ => true,
        }
    }

    /// Sets `rare::ODD_TARGET` unless `target` is a plain name or member.
    #[inline]
    pub(crate) fn note_target(&mut self, target: ExprId) {
        if !(self.f.exprs.get(target.idx())).is_some_and(|it| is_plain_target(it.kind)) {
            self.f.rare_syntax |= rare::ODD_TARGET;
        }
    }

    /// `parseAssignmentExpressionOrHigher`
    pub(crate) fn assignment_expression_or_higher(&mut self, allow_return_type: bool) -> ExprId {
        let (start, full) = (self.pos(), self.full_start());
        // Most arguments, elements and initializers are a name or a literal and nothing more.
        let Some(primary) = self.name_or_literal() else {
            return self.assignment_expression_slow(allow_return_type);
        };
        if self.token().ends_expression() {
            return primary;
        }
        if self.is_too_deep() {
            return ExprId::NONE;
        }
        let operand = self.rest_of_operand(start, primary);
        let expression = self.binary_expression_rest(0, operand, start);
        self.assignment_expression_rest(expression, (start, full), allow_return_type)
    }

    /// `parsePrimaryExpression`, if the expression is a single token.
    #[inline(always)]
    fn name_or_literal(&mut self) -> Option<ExprId> {
        let kind = match self.token() {
            T::Identifier => ExprKind::Ident(self.note_identifier(self.lx.atom, self.lx.start)),
            T::String => ExprKind::String(self.lx.atom),
            T::Number => ExprKind::Number(self.f.number(self.lx.number)),
            T::This => ExprKind::This,
            T::True => ExprKind::True,
            T::False => ExprKind::False,
            T::Null => ExprKind::Null,
            _ => return None,
        };
        Some(self.token_expr(kind))
    }

    fn assignment_expression_slow(&mut self, allow_return_type: bool) -> ExprId {
        if self.is_too_deep() {
            return ExprId::NONE;
        }
        let (start, full) = (self.pos(), self.full_start());
        match self.token() {
            T::OpenParen | T::LessThan | T::Async => {
                if let Some(arrow) = self.try_arrow_function(allow_return_type) {
                    return arrow;
                }
            }
            // `isParenthesizedArrowFunctionExpression`: "If we see a standalone => try to parse it as an
            // arrow function expression as that's likely what the user intended to write."
            T::EqualsGreaterThan if self.recovers() => {
                if let Some(arrow) = self.arrow_function_without_parameters(allow_return_type) {
                    return arrow;
                }
            }
            T::Yield => {
                if self.has_context(ctx::YIELD) {
                    return self.yield_expression();
                }
                // `isYieldExpression`
                if self.suspends_outside_context() {
                    return self.yield_outside_generator();
                }
            }
            _ => {}
        }
        let expression = self.binary_expression(0);
        self.assignment_expression_rest(expression, (start, full), allow_return_type)
    }

    /// What `parseAssignmentExpressionOrHigher` does after `parseBinaryExpressionOrHigher`.
    #[inline]
    fn assignment_expression_rest(
        &mut self,
        expression: ExprId,
        (start, full): (u32, u32),
        allow_return_type: bool,
    ) -> ExprId {
        let token = self.token();
        if token.ends_expression() {
            return expression;
        }
        if token == T::EqualsGreaterThan {
            // `parseSimpleArrowFunctionExpression`
            if expression.idx() + 1 == self.f.exprs.len()
                && let Some(&Expr {
                    kind: ExprKind::Ident(name),
                    pos,
                    end,
                }) = self.f.exprs.last()
                && pos == start
            {
                self.pop_expr();
                return self.simple_arrow_function(
                    name,
                    (pos, end, full),
                    false,
                    pos,
                    allow_return_type,
                );
            }
            self.fail_unless_recovering();
            return expression;
        }
        if token.is_assignment_operator() {
            return self.assignment(expression, start, allow_return_type);
        }
        if token == T::Question {
            // `parseConditionalExpressionRest`
            self.next();
            let saved = self.enter_context(0, ctx::DISALLOW_IN | ctx::DECORATOR);
            let yes = self.assignment_expression_or_higher(false);
            self.context = saved;
            let no = match self.expect(T::Colon) {
                true => self.assignment_expression_or_higher(allow_return_type),
                false => self.add_expr(ExprKind::Missing, self.pos(), self.full_start()),
            };
            let kind = ExprKind::Cond {
                test: expression,
                branches: self.f.store_branches(Branches { yes, no }),
            };
            return self.finish_expr(kind, start);
        }
        expression
    }

    /// `assignment_expression_rest` at an assignment operator. Kept out of line because every expression goes through
    /// the caller.
    #[inline(never)]
    fn assignment(&mut self, target: ExprId, start: u32, allow_return_type: bool) -> ExprId {
        let token = self.token();
        if !self.is_left_hand_side(target) {
            self.fail_unless_recovering();
            return target;
        }
        if let Some(Expr {
            kind: ExprKind::Fn(_),
            ..
        }) = self.f.exprs.get(target.idx())
            && !self.is_parenthesized(target)
            && (!self.recovers() || self.is_ecmascript)
        {
            self.report();
        }
        self.next();
        let value = self.assignment_expression_or_higher(allow_return_type);
        let kind = ExprKind::Assign {
            op: assignment_operator(token),
            target,
            value,
        };
        self.finish_expr(kind, start)
    }

    /// `nextTokenIsIdentifierOrKeywordOrLiteralOnSameLine`
    fn next_is_word_or_literal_on_same_line(&mut self) -> bool {
        self.look_ahead(|p| {
            p.next();
            !p.newline_before()
                && (p.token().is_identifier_or_keyword()
                    || matches!(p.token(), T::Number | T::BigInt | T::String))
        })
    }

    /// At an `await` or `yield` that could be a name here. It's still parsed as the keyword if a word or a literal
    /// follows. TypeScript's checker reports that. oxc's parser reports it too, even in JavaScript, but treats the
    /// `await` of `await in a` as a name.
    fn suspends_outside_context(&mut self) -> bool {
        if !self.options.dialect.oxc {
            return !self.is_ecmascript && self.next_is_word_or_literal_on_same_line();
        }
        let is_await = self.token() == T::Await;
        self.next_is_word_or_literal_on_same_line()
            && match self.peek() {
                T::In | T::InstanceOf => false,
                T::Of => !is_await,
                _ => true,
            }
    }

    /// oxc reports the `yield`, then parses what follows as if it were in a generator: `yield yield a` is one error.
    #[cold]
    fn yield_outside_generator(&mut self) -> ExprId {
        if !self.options.dialect.oxc {
            return self.yield_expression();
        }
        self.flag(DiagnosticKind::Grammar, 1163, (self.pos(), 0), &[]);
        let saved = self.enter_context(ctx::YIELD, 0);
        let expression = self.yield_expression();
        self.context = saved;
        expression
    }

    /// The same for the operand of the `await` at `start`.
    #[cold]
    fn operand_of_await_outside_async(&mut self, start: u32) -> ExprId {
        self.flag(DiagnosticKind::Grammar, 1308, (start, 0), &[]);
        // Outside all function bodies, oxc tolerates it in a file that can be a module, and the file is a module from
        // then on. Examples: in a function's return type, or in a class field's initializer.
        if self.context & (ctx::OUTSIDE_BODIES | ctx::IN_NAMESPACE) == ctx::OUTSIDE_BODIES {
            self.has_top_level_await = true;
            self.has_plain_top_level_await = true;
        }
        let saved = self.enter_context(ctx::AWAIT, 0);
        let operand = self.simple_unary_expression();
        self.context = saved;
        operand
    }

    /// `parseYieldExpression`
    fn yield_expression(&mut self) -> ExprId {
        let start = self.pos();
        self.next();
        let (mut value, mut star) = (ExprId::NONE, false);
        if !self.newline_before() && (self.token() == T::Asterisk || self.is_start_of_expression())
        {
            star = self.eat(T::Asterisk);
            value = self.assignment_expression();
        }
        self.suspensions += 1;
        self.finish_expr(ExprKind::Yield { value, star }, start)
    }

    /// `isBinaryOperator`
    fn is_binary_operator(&self) -> bool {
        if self.token() == T::In && self.has_context(ctx::DISALLOW_IN) {
            return false;
        }
        self.token().binary_precedence() > 0
    }

    /// `isStartOfLeftHandSideExpression`
    pub(crate) fn is_start_of_left_hand_side_expression(&mut self) -> bool {
        match self.token() {
            T::This
            | T::Super
            | T::Null
            | T::True
            | T::False
            | T::Number
            | T::BigInt
            | T::String
            | T::NoSubstitutionTemplate
            | T::TemplateHead
            | T::OpenParen
            | T::OpenBracket
            | T::OpenBrace
            | T::Function
            | T::Class
            | T::New
            | T::Slash
            | T::SlashEquals
            | T::Identifier => true,
            T::Import => matches!(self.peek(), T::OpenParen | T::LessThan | T::Dot),
            _ => self.is_identifier(),
        }
    }

    /// `isStartOfExpression`
    pub(crate) fn is_start_of_expression(&mut self) -> bool {
        if self.is_start_of_left_hand_side_expression() {
            return true;
        }
        match self.token() {
            T::Plus
            | T::Minus
            | T::Tilde
            | T::Exclamation
            | T::Delete
            | T::TypeOf
            | T::Void
            | T::PlusPlus
            | T::MinusMinus
            | T::LessThan
            | T::Await
            | T::Yield
            | T::PrivateIdentifier
            | T::At => true,
            // "Error tolerance. If we see the start of some binary operator, we consider that the
            // start of an expression."
            _ => self.is_binary_operator() || self.is_identifier(),
        }
    }

    /// `parseBinaryExpressionOrHigher`
    #[inline]
    fn binary_expression(&mut self, precedence: u8) -> ExprId {
        let start = self.pos();
        if self.token() == T::PrivateIdentifier && self.is_ecmascript {
            self.private_name_before_in(precedence);
        }
        let left = self.unary_expression();
        self.binary_expression_rest(precedence, left, start)
    }

    /// At a `#a` that's the first token of an operand, for acorn and Babel: it's only valid as the left side of `in`.
    #[cold]
    fn private_name_before_in(&mut self, precedence: u8) {
        if precedence < T::In.binary_precedence()
            && !self.has_context(ctx::DISALLOW_IN)
            && self.peek() == T::In
        {
            self.private_name_before_in = self.pos();
        }
    }

    /// `parseBinaryExpressionRest`
    #[inline(always)]
    fn binary_expression_rest(&mut self, precedence: u8, left: ExprId, start: u32) -> ExprId {
        // The token isn't an operator, or a `>` that could start one.
        if self.token().binary_precedence() == 0 {
            return left;
        }
        self.binary_expression_rest_at_operator(precedence, left, start)
    }

    fn binary_expression_rest_at_operator(
        &mut self,
        precedence: u8,
        mut left: ExprId,
        start: u32,
    ) -> ExprId {
        // This recurses, because the right operand of `**` can use `**` again.
        if self.is_too_deep() {
            return left;
        }
        // The precedence of the operator of `left`, if this loop built `left`. Otherwise `OperatorPrecedenceHighest`.
        let mut last_precedence = u8::MAX;
        loop {
            // "We either have a binary operator here, or we're finished."
            if self.token() == T::GreaterThan {
                self.lx.rescan_greater_than();
            }
            let token = self.token();
            let new_precedence = token.binary_precedence();
            // `**` is right associative.
            let consumes = match token {
                T::AsteriskAsterisk => new_precedence >= precedence,
                _ => new_precedence > precedence,
            };
            if !consumes {
                return left;
            }
            match token {
                T::In if self.has_context(ctx::DISALLOW_IN) => return left,
                T::As | T::Satisfies => {
                    // "Make sure we *do* perform ASI for constructs like this: var x = foo \n as
                    // (Bar)"
                    if self.newline_before() {
                        return left;
                    }
                    self.next();
                    let kind =
                        if token == T::As && self.token() == T::Const && self.is_at_bare_const() {
                            self.js_error((self.lx.start, self.lx.end), 8016, b"");
                            self.const_assertion_type();
                            ExprKind::AsConst(left)
                        } else {
                            let ty = match self.is_flow() {
                                true => self.flow_type(),
                                false => self.ty(),
                            };
                            if self.options.is_javascript {
                                self.js_error_at_type(ty, if token == T::As { 8016 } else { 8037 });
                            }
                            match token {
                                T::As => ExprKind::As { expr: left, ty },
                                _ => ExprKind::Satisfies { expr: left, ty },
                            }
                        };
                    left = self.finish_expr(kind, start);
                    // "Stop if the precedence of the next operator is too high": in `a + b as T * c`
                    // the `as T` could not be erased.
                    if self.token() == T::GreaterThan {
                        self.lx.rescan_greater_than();
                    }
                    if self.token().binary_precedence() > last_precedence && !self.is_flow() {
                        return left;
                    }
                }
                T::QuestionQuestion => {
                    self.next();
                    // `checkNullishCoalesceOperands` reports `a ?? b || c`, and callers that emulate acorn or Babel
                    // look for it in the tree.
                    let allows_mixed_coalesce = self.recovers();
                    let coalesce_binds_like_or =
                        allows_mixed_coalesce && !self.options.dialect.typescript_5;
                    // Check this before the right side records its parentheses.
                    let checks_mixed_coalesce = !allows_mixed_coalesce || self.is_for_oxc();
                    let is_left_mixed = checks_mixed_coalesce && self.is_logical_and_or_or(left);
                    let right = self.binary_expression(match coalesce_binds_like_or {
                        // `OperatorPrecedenceCoalesce` is `OperatorPrecedenceLogicalOR`.
                        true => T::BarBar.binary_precedence(),
                        false => new_precedence,
                    });
                    if is_left_mixed || (checks_mixed_coalesce && self.is_logical_and_or_or(right))
                    {
                        match allows_mixed_coalesce {
                            true => {
                                let at = (start, self.prev_end());
                                oxc::mixed_coalesce(&mut self.f.diagnostics, at);
                            }
                            false => self.report(),
                        }
                    }
                    let kind = ExprKind::Binary {
                        op: BinOp::Nullish,
                        left,
                        right,
                    };
                    left = self.finish_expr(kind, start);
                    last_precedence = new_precedence;
                }
                _ => {
                    self.next();
                    let right = self.binary_expression(new_precedence);
                    let kind = ExprKind::Binary {
                        op: binary_operator(token),
                        left,
                        right,
                    };
                    left = self.finish_expr(kind, start);
                    last_precedence = new_precedence;
                }
            }
        }
    }

    /// True if `e` is an unparenthesized `a || b` or `a && b`, which can't be an operand of `??`.
    fn is_logical_and_or_or(&self, e: ExprId) -> bool {
        matches!(
            self.f.exprs.get(e.idx()),
            Some(Expr {
                kind: ExprKind::Binary {
                    op: BinOp::And | BinOp::Or,
                    ..
                },
                ..
            })
        ) && !self.f.parens.iter().rev().take(2).any(|it| it.0 == e)
    }

    /// `IsConstTypeReference`, at a `const` in type position: true if the type doesn't continue after it, except with
    /// an empty type argument list. Without recovery, see `const_assertion_type`.
    #[inline(always)]
    fn is_at_bare_const(&mut self) -> bool {
        !self.recovers() || self.is_at_bare_const_slow()
    }

    #[cold]
    #[inline(never)]
    fn is_at_bare_const_slow(&mut self) -> bool {
        self.look_ahead(|p| {
            p.next();
            match p.token() {
                T::Dot => false,
                T::OpenBracket => p.newline_before(),
                T::LessThan => {
                    p.next();
                    p.token() == T::GreaterThan
                }
                _ => true,
            }
        })
    }

    /// Consumes the `const` of `e as const` or `<const>e`.
    fn const_assertion_type(&mut self) {
        self.next();
        // `const<>`
        if self.recovers() && self.token() == T::LessThan {
            self.next();
            self.next();
            return;
        }
        // The type continues after `const`.
        if matches!(self.token(), T::Dot | T::LessThan | T::OpenBracket) && !self.newline_before()
            || matches!(self.token(), T::Dot | T::LessThan)
        {
            self.reject(Rejection::Reported);
        }
    }

    /// `parseUnaryExpressionOrHigher`
    #[inline]
    pub(crate) fn unary_expression(&mut self) -> ExprId {
        let start = self.pos();
        match self.name_or_literal() {
            Some(primary) => self.rest_of_operand(start, primary),
            None => self.unary_expression_slow(),
        }
    }

    fn unary_expression_slow(&mut self) -> ExprId {
        let start = self.pos();
        match self.token() {
            T::Plus
            | T::Minus
            | T::Tilde
            | T::Exclamation
            | T::Delete
            | T::TypeOf
            | T::Void
            | T::Await => {}
            T::LessThan if !self.options.is_jsx => {}
            _ => {
                let expression = self.update_expression();
                return self.rest_of_power(start, expression);
            }
        }
        let operator = self.token();
        let is_await_name = operator == T::Await && !self.is_await_expression();
        let expression = self.simple_unary_expression();
        if self.token() == T::AsteriskAsterisk {
            if is_await_name && !self.recovers() {
                let precedence = T::AsteriskAsterisk.binary_precedence();
                return self.binary_expression_rest(precedence, expression, start);
            }
            self.unary_expression_before_power(operator, start);
        }
        expression
    }

    /// The end of `parseUnaryExpressionOrHigher`, at a `**` after an expression that starts with `operator`.
    #[cold]
    #[inline(never)]
    fn unary_expression_before_power(&mut self, operator: T, start: u32) {
        if !self.recovers() {
            return self.reject(Rejection::Reported);
        }
        let at = (start, self.prev_end());
        let text: &[u8] = match operator {
            T::LessThan => return self.error(17007, at, &[]),
            T::Plus => b"+",
            T::Minus => b"-",
            T::Tilde => b"~",
            T::Exclamation => b"!",
            keyword => keyword.text(),
        };
        self.error(17006, at, &[text]);
    }

    /// What `parseUnaryExpressionOrHigher` does after `parseUpdateExpression`.
    #[inline(always)]
    fn rest_of_power(&mut self, start: u32, base: ExprId) -> ExprId {
        if self.token() == T::AsteriskAsterisk {
            let precedence = T::AsteriskAsterisk.binary_precedence();
            return self.binary_expression_rest(precedence, base, start);
        }
        base
    }

    /// What `parseUnaryExpressionOrHigher` does after `parsePrimaryExpression`.
    #[inline]
    fn rest_of_operand(&mut self, start: u32, primary: ExprId) -> ExprId {
        let operand = self.expression_rest(start, primary, true);
        let operand = self.rest_of_update(start, operand);
        self.rest_of_power(start, operand)
    }

    /// `isAwaitExpression`
    fn is_await_expression(&mut self) -> bool {
        if self.has_context(ctx::AWAIT) {
            return true;
        }
        // "here we are using similar heuristics as 'isYieldExpression'"
        self.suspends_outside_context()
    }

    /// At a top-level `await` in a file that nothing has marked as a module yet. Before a token that can't follow a
    /// name, oxc still parses a name and then gives up, no matter what comes later. Before any other token both
    /// readings are possible, and `file_of` tries both.
    #[cold]
    #[inline(never)]
    fn is_await_a_name_to_oxc(&mut self) -> bool {
        if self.f.has_module_syntax || self.has_plain_top_level_await {
            return false;
        }
        let is_javascript = self.options.is_javascript;
        // `None`: the token can follow a name, but then it's scanned differently than after the operator.
        let cannot_follow_name = self.look_ahead(|p| {
            p.next();
            let is_on_same_line = !p.newline_before();
            let cannot_follow_name = match p.token() {
                T::Slash | T::SlashEquals | T::LessThan => return None,
                // `await!`
                T::Exclamation if !is_javascript => return None,
                T::Exclamation
                | T::Tilde
                | T::OpenBrace
                | T::PrivateIdentifier
                | T::DotDotDot
                | T::At => true,
                // `for (await of a)`
                T::Of => !p.has_context(ctx::DISALLOW_IN),
                // `await ++a`, not `await++`
                T::PlusPlus | T::MinusMinus => {
                    p.next();
                    !p.newline_before() && p.is_start_of_expression()
                }
                // `await () => 1`
                T::OpenParen => {
                    p.next();
                    p.token() == T::CloseParen && p.peek() == T::EqualsGreaterThan
                }
                _ => false,
            };
            Some(cannot_follow_name && is_on_same_line)
        });
        match cannot_follow_name {
            Some(cannot_follow_name) => cannot_follow_name && !self.is_module_so_far(),
            None => !self.is_module_so_far() && !self.can_await_be_a_name(),
        }
    }

    /// At an `await`: true if the expression that starts here parses with `await` as a name, up to a token that can
    /// follow an expression.
    #[cold]
    #[inline(never)]
    fn can_await_be_a_name(&mut self) -> bool {
        let saved_flags = (
            self.has_plain_top_level_await,
            self.has_await_in_statement,
            self.has_await_identifier,
        );
        let errors = |p: &Self| {
            let is_parse_error = |it: &&Diagnostic| it.kind == DiagnosticKind::Parse;
            p.f.diagnostics.iter().filter(is_parse_error).count()
        };
        let can_be = self.look_ahead_parsing(|p| {
            let before = errors(p);
            p.context &= !ctx::AWAIT;
            p.assignment_expression();
            p.take_scanner_errors();
            // oxc's lexer scans `</` as a `<` followed by a regular expression.
            let is_before_open_regex = p.token() == T::LessThanSlash && {
                let rest = p.lx.src.get(p.lx.end as usize..).unwrap_or_default();
                let stop = bun_core::strings::index_of_any(rest, b"/\n\r");
                stop.and_then(|at| rest.get(at)) != Some(&b'/')
            };
            errors(p) == before
                && !is_before_open_regex
                && (p.newline_before()
                    || !p.is_start_of_expression()
                    || matches!(p.token(), T::In | T::Of))
        });
        (
            self.has_plain_top_level_await,
            self.has_await_in_statement,
            self.has_await_identifier,
        ) = saved_flags;
        can_be
    }

    /// True if something before the current token has already told oxc that the file is a module.
    #[cold]
    #[inline(never)]
    fn is_module_so_far(&self) -> bool {
        let is_import_meta = |it: &Expr| matches!(it.kind, ExprKind::ImportMeta);
        self.f.has_module_syntax
            || self.has_plain_top_level_await
            || self.f.exprs.iter().any(is_import_meta)
    }

    /// `parseSimpleUnaryExpression`
    fn simple_unary_expression(&mut self) -> ExprId {
        if self.is_too_deep() {
            return ExprId::NONE;
        }
        let start = self.pos();
        let op = match self.token() {
            T::Plus => UnOp::Plus,
            T::Minus => UnOp::Minus,
            T::Tilde => UnOp::BitNot,
            T::Exclamation => UnOp::Not,
            T::Delete => UnOp::Delete,
            T::TypeOf => UnOp::Typeof,
            T::Void => UnOp::Void,
            T::LessThan if !self.options.is_jsx => return self.type_assertion(),
            T::LessThan if !self.is_ecmascript => return self.jsx_elements(true),
            T::Await if self.is_await_expression() => {
                if self.has_context(ctx::TOP_LEVEL)
                    && self.options.is_module_or_script
                    && self.is_await_a_name_to_oxc()
                {
                    return self.update_expression();
                }
                let had_plain = self.has_plain_top_level_await;
                self.note_await();
                // Outside the await context it's a name, except before a word or a literal.
                if self.has_context(ctx::TOP_LEVEL) && !self.next_is_word_or_literal_on_same_line()
                {
                    self.has_await_identifier = true;
                    self.has_plain_top_level_await = had_plain;
                }
                self.next();
                let operand = match self.has_context(ctx::AWAIT) || !self.options.dialect.oxc {
                    true => self.simple_unary_expression(),
                    false => self.operand_of_await_outside_async(start),
                };
                self.suspensions += 1;
                return self.finish_expr(ExprKind::Await(operand), start);
            }
            _ => return self.update_expression(),
        };
        self.next();
        let operand = self.simple_unary_expression();
        if op == UnOp::Delete {
            let is_private = |at: u32| self.lx.src.get(at as usize) == Some(&b'#');
            match self.f.exprs.get(operand.idx()).map(|it| it.kind) {
                Some(ExprKind::Ident(_)) => self.f.rare_syntax |= rare::DELETES_A_NAME,
                Some(ExprKind::Dot { .. }) if is_private(self.f.name_pos(operand)) => {
                    self.f.rare_syntax |= rare::DELETES_A_NAME;
                }
                // oxc looks through these wrappers.
                Some(
                    ExprKind::As { .. }
                    | ExprKind::AsConst(_)
                    | ExprKind::Satisfies { .. }
                    | ExprKind::NonNull(_),
                ) => self.f.rare_syntax |= rare::DELETES_A_NAME,
                _ => {}
            }
        }
        self.finish_expr(ExprKind::Unary { op, operand }, start)
    }

    /// `parseTypeAssertion`
    fn type_assertion(&mut self) -> ExprId {
        let start = self.pos();
        self.expect(T::LessThan);
        let ty = match self.token() {
            T::Const if self.is_at_bare_const() => {
                self.const_assertion_type();
                None
            }
            _ => Some(self.ty()),
        };
        self.expect(T::GreaterThan);
        let expr = self.simple_unary_expression();
        let kind = match ty {
            Some(ty) => ExprKind::As { expr, ty },
            None => ExprKind::AsConst(expr),
        };
        self.finish_expr(kind, start)
    }

    /// `parseUpdateExpression`
    #[inline]
    fn update_expression(&mut self) -> ExprId {
        let start = self.pos();
        match self.token() {
            T::PlusPlus | T::MinusMinus => return self.prefix_update(),
            // For acorn a JSX element is a primary expression.
            T::LessThan if self.options.is_jsx && !self.is_ecmascript => {
                return self.jsx_element_or_fragment();
            }
            _ => {}
        }
        let operand = self.left_hand_side_expression();
        self.rest_of_update(start, operand)
    }

    /// `parseUpdateExpression`, at a `++` or a `--`.
    #[inline(never)]
    fn prefix_update(&mut self) -> ExprId {
        let start = self.pos();
        let op = match self.token() {
            T::PlusPlus => UnOp::PreInc,
            _ => UnOp::PreDec,
        };
        self.next();
        // oxc parses a unary expression here, so it accepts `++<T>a`.
        let operand = match self.options.dialect.oxc {
            true => self.simple_unary_expression(),
            false => self.left_hand_side_expression(),
        };
        self.note_target(operand);
        self.finish_expr(ExprKind::Unary { op, operand }, start)
    }

    /// What `parseUpdateExpression` does after `parseLeftHandSideExpressionOrHigher`.
    #[inline(always)]
    fn rest_of_update(&mut self, start: u32, operand: ExprId) -> ExprId {
        if matches!(self.token(), T::PlusPlus | T::MinusMinus) && !self.newline_before() {
            return self.postfix_update(start, operand);
        }
        operand
    }

    /// Kept out of line because every operand goes through the caller.
    #[inline(never)]
    fn postfix_update(&mut self, start: u32, operand: ExprId) -> ExprId {
        let op = match self.token() {
            T::PlusPlus => UnOp::PostInc,
            _ => UnOp::PostDec,
        };
        self.next();
        self.note_target(operand);
        self.finish_expr(ExprKind::Unary { op, operand }, start)
    }

    /// `parseDecoratorExpression`
    pub(crate) fn decorator_expression(&mut self) -> ExprId {
        if self.token() == T::Await && self.has_context(ctx::AWAIT) && !self.options.dialect.oxc {
            return self.await_as_decorator();
        }
        // A JSX element can't be a decorator.
        if self.token() == T::LessThan {
            self.fail_unless_recovering();
        }
        self.left_hand_side_expression()
    }

    /// `parseDecoratorExpression`, at an `await` that isn't a name.
    #[cold]
    #[inline(never)]
    fn await_as_decorator(&mut self) -> ExprId {
        if !self.recovers() {
            self.reject(Rejection::Reported);
            return ExprId::NONE;
        }
        // The top level's await context extends into the decorators of a method's parameters.
        self.has_top_level_await = true;
        let start = self.pos();
        let missing = self.missing_expression(1109);
        self.next();
        self.expression_rest(start, missing, true)
    }

    /// `parseLeftHandSideExpressionOrHigher`
    #[inline]
    pub(crate) fn left_hand_side_expression(&mut self) -> ExprId {
        let start = self.pos();
        let expression = match self.token() {
            T::Import => self.import_expression(),
            T::Super => {
                let expression = self.token_expr(ExprKind::Super);
                match self.token() {
                    T::OpenParen | T::Dot | T::OpenBracket => expression,
                    _ => self.super_without_access(start, expression),
                }
            }
            _ => self.primary_expression(),
        };
        self.expression_rest(start, expression, true)
    }

    /// What `parseSuperExpression` does after a `super` that isn't followed by `(`, `.` or `[`.
    #[cold]
    #[inline(never)]
    fn super_without_access(&mut self, start: u32, mut obj: ExprId) -> ExprId {
        if !self.recovers() {
            self.fail();
            return obj;
        }
        if self.token() == T::LessThan && self.has_type_arguments_in_expressions {
            match self.type_arguments_of_super(start, obj) {
                (with_type_arguments, true) => return with_type_arguments,
                (with_type_arguments, false) => obj = with_type_arguments,
            }
        }
        self.error_at_token(1034, &[]);
        let name = self.right_side_of_dot();
        self.finish_dot((obj, Chain::No), name, start)
    }

    /// `parseSuperExpression`, at the `<` after `obj`. Returns `super` with its type arguments, and true if an argument
    /// list or a member access follows them.
    #[cold]
    #[inline(never)]
    fn type_arguments_of_super(&mut self, start: u32, obj: ExprId) -> (ExprId, bool) {
        let (after_super, less_than) = (self.full_start(), self.pos());
        let checkpoint = self.checkpoint();
        let reported = self.f.diagnostics.len();
        let Some(type_args) = self.try_type_arguments_in_expression(true) else {
            return (obj, false);
        };
        self.error(2754, (after_super, self.prev_end()), &[]);
        match self.token() {
            // `isTemplateStartOfTaggedTemplate`: the type arguments aren't stored in any node.
            T::NoSubstitutionTemplate | T::TemplateHead => {
                let template = self.pos();
                let mut errors = self.f.diagnostics.split_off(reported);
                errors.retain(|it| it.kind == DiagnosticKind::Parse);
                self.rollback(&checkpoint);
                while self.pos() < template && self.token() != T::Eof {
                    self.next();
                }
                // A token inside the type arguments was scanned differently this time.
                if self.pos() != template {
                    self.reject(Rejection::Unsupported);
                }
                // `errors` already has whatever the scanner just reported again.
                self.lx.errors.clear();
                self.f.diagnostics.extend(errors);
                (obj, false)
            }
            T::OpenParen => (self.call(start, obj, type_args, Chain::No), true),
            token => {
                let kind = ExprKind::Instantiation {
                    expr: obj,
                    type_args: self.f.store_list(type_args),
                };
                let instantiation = self.finish_expr(kind, start);
                match token {
                    T::Dot => {
                        let access =
                            self.access_to_instantiation(start, instantiation, less_than, true);
                        (access.0, true)
                    }
                    T::OpenBracket => (instantiation, true),
                    _ => (instantiation, false),
                }
            }
        }
    }

    /// `import(..)`, `import.meta`
    fn import_expression(&mut self) -> ExprId {
        let start = self.pos();
        // `nextTokenIsOpenParenOrLessThan`, `nextTokenIsDot`: otherwise `parsePrimaryExpression`.
        if self.recovers() && !matches!(self.peek(), T::OpenParen | T::LessThan | T::Dot) {
            if self.is_for_oxc() {
                self.next();
                self.import_without_call_like_oxc(start);
                return self.add_expr(ExprKind::Missing, start, start);
            }
            return self.missing_expression(1109);
        }
        self.next();
        let mut is_deferred = false;
        if self.token() == T::Dot {
            self.next();
            match self.name_after_import_and_dot() {
                b"meta" if self.token() == T::Identifier => {
                    self.next();
                    self.f.rare_syntax |= rare::IMPORT_META;
                    return self.finish_expr(ExprKind::ImportMeta, start);
                }
                // For Babel and oxc, `source` is a phase too. It's stored like `defer`, and the source text
                // distinguishes them.
                b"defer" if self.peek() == T::OpenParen => {}
                b"defer" if self.recovers() && self.is_callee(true) => {}
                b"source" if self.options.dialect.babel || self.options.dialect.oxc => {}
                _ => return self.unknown_import_meta_property(start),
            }
            // `parseIdentifierName`
            self.next_after_name();
            is_deferred = true;
            // `IsImportCall` doesn't look at the `?.`.
            if self.recovers() {
                self.eat(T::QuestionDot);
            }
        }
        match self.token() {
            T::OpenParen => self.import_call(start, is_deferred).0,
            _ => self.import_without_arguments(start, is_deferred),
        }
    }

    /// Returns `meta`, `defer` or `source`, or an empty slice. TypeScript's parser recognizes these names even when
    /// they contain an escape. acorn and Babel treat an escaped one as a different name, which is reported with its
    /// decoded spelling.
    fn name_after_import_and_dot(&self) -> &'static [u8] {
        let name = match self.lx.has_escape && !self.is_ecmascript {
            true => self.lx.text_of(self.lx.atom),
            false => self.lx.text(),
        };
        let names: [&'static [u8]; 3] = [b"meta", b"defer", b"source"];
        names.into_iter().find(|it| *it == name).unwrap_or_default()
    }

    /// `parseCallExpressionRest`: true if the expression that ends here is called, that is, a `(` follows, optionally
    /// after `?.` and type arguments. With `is_at_last_token`, the expression ends with the current token instead of
    /// before it.
    #[cold]
    #[inline(never)]
    fn is_callee(&mut self, is_at_last_token: bool) -> bool {
        self.look_ahead_parsing(|p| {
            if is_at_last_token {
                p.next();
            }
            p.eat(T::QuestionDot);
            if matches!(p.token(), T::LessThan | T::LessThanLessThan)
                && (!p.has_type_arguments_in_expressions
                    || p.try_type_arguments_in_expression(true).is_none())
            {
                return false;
            }
            p.token() == T::OpenParen
        })
    }

    /// At the `(` of an `import(..)` that starts at `start`. Returns the call and its arguments.
    fn import_call(&mut self, start: u32, is_deferred: bool) -> (ExprId, IdList<ExprId>) {
        self.next();
        let saved = self.enter_context(0, ctx::DISALLOW_IN | ctx::DECORATOR);
        let base = self.s.ids.len();
        let parens = self.f.parens.len();
        // `checkGrammarImportCallExpression` reports a spread, and any number of arguments but one or two.
        let lists = self.enter_list(ListKind::ArgumentExpressions);
        while self.is_in_list(T::CloseParen) && self.is_at_element(ListKind::ArgumentExpressions) {
            let element = self.full_start();
            let argument = match self.token() {
                T::DotDotDot => self.spread_element(),
                _ => self.assignment_expression(),
            };
            self.s.ids.push(argument.0);
            // `IsStringLiteralLike`: `("m")` is a `ParenthesizedExpression`.
            if self.s.ids.len() == base + 1 && self.f.parens.len() == parens {
                self.call_specifier(argument, SpecifierKind::ImportCall);
            }
            if !self.eat(T::Comma)
                && !self.continues_without_comma(ListKind::ArgumentExpressions, element)
            {
                break;
            }
        }
        self.leave_list(lists);
        self.context = saved;
        let close = self.close_of_argument_list();
        if self.s.ids.len() == base {
            let missing = self.add_expr(ExprKind::Missing, close, close);
            self.s.ids.push(missing.0);
        }
        let args = self.take_ids(base);
        if self.is_for_oxc() {
            oxc::import_call(&mut self.f, self.lx.src, start, args, close);
        }
        if is_deferred && !args.is_empty() {
            let specifier = self.f.id_at(args, 0);
            self.f.deferred_import_calls.push((specifier, close));
        }
        (self.finish_expr(ExprKind::ImportCall { args }, start), args)
    }

    /// `parseCallExpressionRest`, after an `import` that isn't followed by `(`. The keyword is stored as a missing
    /// expression.
    #[cold]
    #[inline(never)]
    fn import_without_arguments(&mut self, start: u32, is_deferred: bool) -> ExprId {
        if !self.recovers() || self.token() != T::LessThan {
            self.fail();
            return ExprId::NONE;
        }
        if !is_deferred {
            self.import_without_call_like_oxc(start);
        }
        let (less_than, reported) = (self.pos(), self.f.diagnostics.len());
        let type_args = match self.has_type_arguments_in_expressions {
            true => self.try_type_arguments_in_expression(true),
            false => None,
        };
        let Some(type_args) = type_args else {
            return self.add_expr(ExprKind::Missing, start, start);
        };
        if self.token() == T::OpenParen {
            // `checkImportCallExpression` doesn't look at the type arguments.
            let mut index = 0;
            self.f.diagnostics.retain(|it| {
                index += 1;
                index <= reported || it.kind == DiagnosticKind::Parse
            });
            let (call, args) = self.import_call(start, is_deferred);
            if !args.is_empty() {
                let specifier = self.f.id_at(args, 0);
                self.f.import_call_type_args.push((specifier, type_args));
            }
            return call;
        }
        let keyword = self.add_expr(ExprKind::Missing, start, start);
        if matches!(self.token(), T::NoSubstitutionTemplate | T::TemplateHead) {
            return self.tagged_template(start, keyword, type_args, false);
        }
        // `checkGrammarExpressionWithTypeArguments`
        let at = (start, self.prev_end());
        self.flag(DiagnosticKind::Grammar, 1326, at, &[]);
        let kind = ExprKind::Instantiation {
            expr: keyword,
            type_args: self.f.store_list(type_args),
        };
        let instantiation = self.finish_expr(kind, start);
        match self.token() {
            T::Dot => {
                self.access_to_instantiation(start, instantiation, less_than, true)
                    .0
            }
            // The chain would continue in `expression_rest`.
            T::QuestionDot => {
                self.reject(Rejection::Unsupported);
                instantiation
            }
            _ => instantiation,
        }
    }

    /// At the `x` of an `import.x` that starts at `start`. It's stored as a property access on a missing expression.
    /// Reports the errors of `checkGrammarMetaProperty` and `checkGrammarImportCallExpression`.
    #[cold]
    fn unknown_import_meta_property(&mut self, start: u32) -> ExprId {
        // `tokenIsIdentifierOrKeyword` is true for a private name.
        if !self.token().is_identifier_or_keyword() {
            let name = self.missing_identifier(0, 0);
            let obj = self.add_expr(ExprKind::Missing, start, start);
            return self.finish_dot((obj, Chain::No), name, start);
        }
        if self.token() == T::PrivateIdentifier && !self.recovers() {
            self.reject(Rejection::Unsupported);
        }
        let is_private = self.token() == T::PrivateIdentifier;
        let (name, at) = (self.lx.atom, (self.lx.start, self.lx.end));
        let word = match self.lx.has_escape {
            true => self.lx.text_of(name).to_vec(),
            false => self.lx.text().to_vec(),
        };
        let word = &word[..];
        // `parseIdentifierName`
        self.next_after_name();
        // This looks past type arguments and a `?.` to find the call.
        let is_callee = match self.token() {
            T::OpenParen => true,
            T::LessThan | T::LessThanLessThan | T::QuestionDot if self.recovers() => {
                self.is_callee(false)
            }
            T::LessThan | T::LessThanLessThan | T::QuestionDot => {
                self.reject(Rejection::Unsupported);
                false
            }
            _ => false,
        };
        match (word, is_callee) {
            (b"defer", false) => {
                let after = (at.1, Diagnostic::NO_LENGTH);
                self.flag(DiagnosticKind::Grammar, 1005, after, &[b"("]);
            }
            (_, true) => self.flag(DiagnosticKind::Grammar, 18061, at, &[word]),
            _ => self.flag(
                DiagnosticKind::Grammar,
                17012,
                at,
                &[word, b"import", b"meta"],
            ),
        }
        let obj = self.add_expr(ExprKind::Missing, start, start);
        // `parseIdentifierName` turns a private name into an `Identifier`, and nothing else is reported about it.
        let name = match is_private {
            true => (known::empty, start),
            false => (name, at.0),
        };
        let kind = self.f.dot((obj, Chain::No), name, at.1);
        self.add_expr(kind, start, at.1)
    }

    /// `collectDynamicImportOrRequireOrJsDocImportCalls`: `argument` is the argument of `import()`
    /// or `require()`.
    fn call_specifier(&mut self, argument: ExprId, kind: SpecifierKind) {
        let Some(&Expr {
            kind: literal, pos, ..
        }) = self.f.exprs.get(argument.idx())
        else {
            return;
        };
        let spec = match literal {
            ExprKind::String(text) => text,
            ExprKind::Template { exprs } if exprs.is_empty() => {
                self.f.id_at(self.f.template_texts(exprs), 0)
            }
            _ => return,
        };
        self.f.specifier_uses.push(SpecifierUse {
            spec,
            pos,
            kind,
            mode: ResolutionMode::None,
        });
    }

    /// `parseRightSideOfDot`: parses the name after a `.` or `?.`. The name is the current token.
    #[inline]
    fn right_side_of_dot(&mut self) -> (Atom, u32) {
        let token = self.token();
        if token.is_identifier_or_keyword() {
            // "a name on the next line that is followed by a word on its line belongs to the next
            // statement"
            if self.newline_before()
                && !self.is_ecmascript
                && self.is_followed_by_word_on_same_line()
            {
                if self.recovers() {
                    let after_dot = self.full_start();
                    self.error(1003, (after_dot, Diagnostic::NO_LENGTH), &[]);
                    return (known::empty, after_dot);
                }
                self.reject(Rejection::Reported);
            }
        } else {
            // `createMissingIdentifier`
            let after_dot = self.full_start();
            return (self.missing_identifier(0, 0).0, after_dot);
        }
        if token == T::Await {
            self.note_await_as_a_name();
        }
        let name = (self.lx.atom, self.lx.start);
        self.next_after_name();
        name
    }

    /// `nextTokenIsIdentifierOrKeywordOnSameLine`
    #[cold]
    pub(crate) fn is_followed_by_word_on_same_line(&mut self) -> bool {
        self.look_ahead(|p| {
            p.next();
            p.token().is_identifier_or_keyword() && !p.newline_before()
        })
    }

    /// `parseMemberExpressionRest` and, with `allows_calls`, `parseCallExpressionRest`.
    #[inline(always)]
    fn expression_rest(&mut self, start: u32, expression: ExprId, allows_calls: bool) -> ExprId {
        if !self.token().can_follow_member_expression() {
            return expression;
        }
        self.expression_rest_slow(start, expression, allows_calls)
    }

    fn expression_rest_slow(
        &mut self,
        start: u32,
        mut expression: ExprId,
        allows_calls: bool,
    ) -> ExprId {
        let mut chain = Chain::No;
        // `expression`, if it's a `NonNull` with nothing after it yet.
        let mut non_null = ExprId::NONE;
        loop {
            match self.token() {
                T::Dot => {
                    self.next();
                    if chain != Chain::No && self.token() == T::PrivateIdentifier {
                        self.private_name_in_optional_chain();
                    }
                    let name = self.right_side_of_dot();
                    expression = self.finish_dot((expression, chain), name, start);
                }
                T::OpenParen if allows_calls => {
                    expression = self.call(start, expression, IdList::EMPTY, chain);
                }
                T::OpenBracket => {
                    if self.has_context(ctx::DECORATOR) {
                        return expression;
                    }
                    expression = self.element_access(start, expression, chain);
                }
                T::Exclamation if !self.newline_before() => {
                    // `a! /* comment */ !`: the comment is after the node as it is now.
                    self.before_node_grows();
                    self.next();
                    let end = self.prev_end();
                    if self.options.is_javascript {
                        self.js_error((start, end), 8013, b"");
                    }
                    if non_null == expression {
                        let inner = std::mem::replace(&mut self.f.exprs[expression.idx()].end, end);
                        self.f.non_null_ends.push((expression, inner));
                    } else {
                        expression = self.add_expr(ExprKind::NonNull(expression), start, end);
                        non_null = expression;
                    }
                    continue;
                }
                T::QuestionDot => {
                    // `parseNewExpressionOrNewDotTarget` reports `new a?.b()`.
                    if !allows_calls {
                        return expression;
                    }
                    self.next();
                    match self.token() {
                        T::OpenParen => {
                            expression = self.call(start, expression, IdList::EMPTY, Chain::Start);
                        }
                        T::OpenBracket => {
                            expression = self.element_access(start, expression, Chain::Start);
                        }
                        T::LessThan | T::LessThanLessThan => {
                            // `parseTypeArgumentsInExpression` finds none in JavaScript.
                            let type_args = match self.has_type_arguments_in_expressions {
                                true => self.try_type_arguments_in_expression(true),
                                false => None,
                            };
                            let Some(type_args) = type_args else {
                                return self.missing_name_after_question_dot(start, expression);
                            };
                            expression = match self.token() {
                                T::OpenParen => {
                                    self.call(start, expression, type_args, Chain::Start)
                                }
                                _ => self
                                    .optional_call_without_open_paren(start, expression, type_args),
                            };
                        }
                        T::NoSubstitutionTemplate | T::TemplateHead => {
                            expression =
                                self.tagged_template(start, expression, IdList::EMPTY, true);
                        }
                        token if !token.is_identifier_or_keyword() => {
                            return self.missing_name_after_question_dot(start, expression);
                        }
                        _ => {
                            if self.token() == T::PrivateIdentifier {
                                self.private_name_in_optional_chain();
                            }
                            let name = self.right_side_of_dot();
                            expression = self.finish_dot((expression, Chain::Start), name, start);
                        }
                    }
                    chain = Chain::Continue;
                }
                T::NoSubstitutionTemplate | T::TemplateHead => {
                    // oxc treats `a?.b!` as still in the chain.
                    let is_in_chain =
                        chain != Chain::No && (non_null != expression || self.reports_like_oxc());
                    expression =
                        self.tagged_template(start, expression, IdList::EMPTY, is_in_chain);
                }
                T::LessThan | T::LessThanLessThan if self.has_type_arguments_in_expressions => {
                    let less_than = self.pos();
                    let Some(type_args) = self.try_type_arguments_in_expression(allows_calls)
                    else {
                        return expression;
                    };
                    expression = match self.token() {
                        T::OpenParen if allows_calls => {
                            self.call(start, expression, type_args, chain)
                        }
                        T::NoSubstitutionTemplate | T::TemplateHead => {
                            let is_in_chain = chain != Chain::No
                                && (non_null != expression || self.reports_like_oxc());
                            self.tagged_template(start, expression, type_args, is_in_chain)
                        }
                        _ => {
                            let kind = ExprKind::Instantiation {
                                expr: expression,
                                type_args: self.f.store_list(type_args),
                            };
                            let mut instantiation = self.finish_expr(kind, start);
                            // `tryReparseOptionalChain`: it isn't part of a chain.
                            if !self.is_flow() {
                                chain = Chain::No;
                            }
                            if matches!(self.token(), T::Dot | T::QuestionDot) {
                                (instantiation, chain) = self.access_to_instantiation(
                                    start,
                                    instantiation,
                                    less_than,
                                    allows_calls,
                                );
                            }
                            instantiation
                        }
                    };
                }
                T::OpenBrace if allows_calls && self.is_flow() => {
                    match self.flow_braces_after_expression(start, expression) {
                        Some(with_braces) => expression = with_braces,
                        None => return expression,
                    }
                }
                _ => return expression,
            }
            non_null = ExprId::NONE;
        }
    }

    /// `parsePropertyAccessExpressionRest`, at the `.` or `?.` after `obj`, which is `a<b>`. Returns the access and the
    /// chain state that continues after it, or `obj` if this is a `?.` that isn't followed by a name.
    #[cold]
    #[inline(never)]
    fn access_to_instantiation(
        &mut self,
        start: u32,
        obj: ExprId,
        less_than: u32,
        allows_chain: bool,
    ) -> (ExprId, Chain) {
        if !self.recovers() {
            self.reject(Rejection::Reported);
            return (obj, Chain::No);
        }
        let is_optional = self.token() == T::QuestionDot;
        // `isStartOfOptionalPropertyOrElementAccessChain`
        if is_optional && !(allows_chain && self.peek().is_identifier_or_keyword()) {
            return (obj, Chain::No);
        }
        let greater_than_end = self.prev_end();
        self.next();
        if is_optional && self.token() == T::PrivateIdentifier {
            self.private_name_in_optional_chain();
        }
        let name = self.right_side_of_dot();
        // `check_implemented_like_oxc` already reported oxc's error.
        if !self.is_in_implements_for_oxc {
            self.error(1477, (less_than, greater_than_end), &[]);
        }
        let (chain, chain_after) = match is_optional {
            true => (Chain::Start, Chain::Continue),
            false => (Chain::No, Chain::No),
        };
        (self.finish_dot((obj, chain), name, start), chain_after)
    }

    /// The end of `parseCallExpressionRest`, after a `?.` with nothing valid after it.
    #[cold]
    #[inline(never)]
    fn missing_name_after_question_dot(&mut self, start: u32, obj: ExprId) -> ExprId {
        self.error_at_token(1003, &[]);
        let name = (known::empty, self.full_start());
        self.finish_dot((obj, Chain::Start), name, start)
    }

    /// `parseCallExpressionRest`, after `callee?.<T>` at a token that isn't `(`.
    #[cold]
    #[inline(never)]
    fn optional_call_without_open_paren(
        &mut self,
        start: u32,
        callee: ExprId,
        type_args: IdList<TypeNodeId>,
    ) -> ExprId {
        if !self.recovers() {
            self.reject(Rejection::Reported);
            return callee;
        }
        if matches!(self.token(), T::NoSubstitutionTemplate | T::TemplateHead) {
            return self.tagged_template(start, callee, type_args, true);
        }
        self.expected(T::OpenParen);
        let (args, close_pos) = self.rest_of_argument_list();
        let type_args = self.f.store_list(type_args);
        let call = self.f.add_call(Call {
            callee,
            args,
            type_args,
            close_pos,
            chain: Chain::Start,
        });
        self.finish_expr(ExprKind::Call(call), start)
    }

    /// At the `#b` of `a?.#b` or `a?.b.#c`, which TypeScript's parser reports as an error.
    #[cold]
    fn private_name_in_optional_chain(&mut self) {
        match self.is_ecmascript {
            true => self.flag(
                DiagnosticKind::Grammar,
                18030,
                (self.lx.start, self.lx.end),
                &[],
            ),
            false => self.error_and_continue(18030, (self.lx.start, self.lx.end)),
        }
    }

    /// `parseElementAccessExpressionRest`, at the `[`.
    fn element_access(&mut self, start: u32, obj: ExprId, chain: Chain) -> ExprId {
        self.next();
        let index = match self.token() {
            T::CloseBracket => {
                self.error(1011, (self.full_start(), Diagnostic::NO_LENGTH), &[]);
                // `createMissingIdentifier`
                self.add_expr(ExprKind::Missing, self.full_start(), self.full_start())
            }
            _ => self.expression_allowing_in(),
        };
        self.expect(T::CloseBracket);
        self.finish_expr(ExprKind::Index { obj, index, chain }, start)
    }

    /// `parseArgumentList`, at the `(`. Returns the arguments and the position of the `)`.
    #[inline(always)]
    fn argument_list(&mut self) -> (IdList<ExprId>, u32) {
        self.next();
        self.rest_of_argument_list()
    }

    /// `parseArgumentList`, after the `(`.
    fn rest_of_argument_list(&mut self) -> (IdList<ExprId>, u32) {
        let saved = self.enter_context(0, ctx::DISALLOW_IN | ctx::DECORATOR);
        let base = self.s.ids.len();
        let lists = self.enter_list(ListKind::ArgumentExpressions);
        while self.is_in_list(T::CloseParen) && self.is_at_element(ListKind::ArgumentExpressions) {
            let element = self.full_start();
            let argument = match self.token() {
                T::DotDotDot => self.spread_element(),
                _ => self.assignment_expression(),
            };
            self.s.ids.push(argument.0);
            if !self.eat(T::Comma)
                && !self.continues_without_comma(ListKind::ArgumentExpressions, element)
            {
                break;
            }
        }
        self.leave_list(lists);
        self.context = saved;
        let close = self.close_of_argument_list();
        (self.take_ids(base), close)
    }

    /// The end of `parseArgumentList`. Returns the position of the `)`, or of the previous token's last character if
    /// the `)` is missing.
    #[inline(always)]
    fn close_of_argument_list(&mut self) -> u32 {
        let close = self.pos();
        match self.expect(T::CloseParen) {
            true => close,
            false => self.prev_end().saturating_sub(1),
        }
    }

    /// `parseSpreadElement`
    fn spread_element(&mut self) -> ExprId {
        let start = self.pos();
        self.next();
        let operand = self.assignment_expression();
        self.finish_expr(ExprKind::Spread(operand), start)
    }

    fn call(
        &mut self,
        start: u32,
        callee: ExprId,
        type_args: IdList<TypeNodeId>,
        chain: Chain,
    ) -> ExprId {
        // `IsRequireCall`
        let is_require = self.options.is_javascript
            && matches!(
                self.f.exprs.get(callee.idx()),
                Some(Expr {
                    kind: ExprKind::Ident(bun_sema::atom::known::require),
                    ..
                })
            )
            && !self.is_parenthesized(callee);
        let (args, close_pos) = self.argument_list();
        if is_require && args.len() == 1 {
            let argument = self.f.id_at(args, 0);
            if !self.is_parenthesized(argument) {
                self.call_specifier(argument, SpecifierKind::RequireCall);
            }
        }
        let type_args = self.f.store_list(type_args);
        let call = self.f.add_call(Call {
            callee,
            args,
            type_args,
            close_pos,
            chain,
        });
        self.finish_expr(ExprKind::Call(call), start)
    }

    /// `parseTypeArgumentsInExpression`, in a `tryParse`. `allows_calls` is false in the callee of `new`.
    fn try_type_arguments_in_expression(
        &mut self,
        allows_calls: bool,
    ) -> Option<IdList<TypeNodeId>> {
        if self.is_flow() {
            return self.flow_type_arguments_in_expression(!allows_calls);
        }
        let less_than = self.pos() as usize;
        // When a `<` doesn't start type arguments, what follows it is reparsed as an expression, including every `<` in
        // it. So an attempt that got far before it failed is cached and not retried. Otherwise each level of
        // `a < ({b = a < ({b = ..` takes twice as long as the level inside it.
        let at = (less_than as u32, self.context);
        if !self.not_type_arguments.is_empty() {
            // Outside a speculation the parser never goes back, so earlier positions can be dropped.
            if self.speculations == 0 {
                let read = self.not_type_arguments.partition_point(|it| it.0 < at.0);
                self.not_type_arguments.drain(..read);
            }
            if self.not_type_arguments.binary_search(&at).is_ok() {
                return None;
            }
        }
        let mut end = at.0;
        let type_arguments = self.try_parse(|p| {
            let type_arguments = p.type_arguments_in_expression(at.0);
            end = p.pos();
            type_arguments
        });
        if let Some((_, failed_at)) = self.was_abandoned_at {
            end = failed_at;
        }
        if type_arguments.is_none() && !self.has_failed() && end.saturating_sub(at.0) > 64 {
            let insert_at = self.not_type_arguments.partition_point(|it| *it < at);
            self.not_type_arguments.insert(insert_at, at);
        }
        if type_arguments.is_none() {
            self.reject_type_arguments_with_an_error(less_than);
        }
        type_arguments
    }

    /// `parseTypeArgumentsInExpression`, at the `<` at `less_than`.
    fn type_arguments_in_expression(&mut self, less_than: u32) -> Option<IdList<TypeNodeId>> {
        // `ReScanLessThanToken`
        if self.token() == T::LessThanLessThan {
            self.lx.token = T::LessThan;
            self.lx.end = self.lx.start + 1;
        }
        self.next();
        let base = self.s.ids.len();
        if let Some((at, code)) = self.type_argument_list(less_than) {
            self.flag(DiagnosticKind::Grammar, code, at, &[]);
        }
        // The scanner never merges a `>` with what follows it.
        if self.token() != T::GreaterThan {
            return None;
        }
        // `ReScanGreaterThanToken`: `>=`, `>>` and so on don't end the list.
        self.lx.rescan_greater_than();
        if self.token() != T::GreaterThan {
            return None;
        }
        self.next();
        // `canFollowTypeArgumentsInExpression`
        let follows = match self.token() {
            T::OpenParen | T::NoSubstitutionTemplate | T::TemplateHead => true,
            T::LessThan | T::GreaterThan | T::Plus | T::Minus => false,
            _ => {
                self.newline_before() || self.is_binary_operator() || !self.is_start_of_expression()
            }
        };
        follows.then(|| self.take_ids(base))
    }

    /// Call after a failed attempt to parse type arguments at the `<` at `less_than`.
    fn reject_type_arguments_with_an_error(&mut self, less_than: usize) {
        if let Some(failed) = self.was_abandoned_at
            && can_be_type_arguments_with_an_error(self.lx.src, less_than, failed)
        {
            self.reject(Rejection::Reported);
        }
    }

    /// `parsePrimaryExpression`
    #[inline]
    pub(crate) fn primary_expression(&mut self) -> ExprId {
        match self.token() {
            T::Identifier => {
                let name = self.lx.atom;
                self.note_identifier(name, self.lx.start);
                self.token_expr(ExprKind::Ident(name))
            }
            T::String => self.token_expr(ExprKind::String(self.lx.atom)),
            T::This => self.token_expr(ExprKind::This),
            T::OpenParen => self.parenthesized_expression(),
            T::Number => {
                let number = self.f.number(self.lx.number);
                self.token_expr(ExprKind::Number(number))
            }
            T::OpenBrace => self.object_literal(),
            T::OpenBracket => self.array_literal(),
            T::True => self.token_expr(ExprKind::True),
            T::False => self.token_expr(ExprKind::False),
            T::Null => self.token_expr(ExprKind::Null),
            T::New => self.new_expression(),
            T::Function => self.function_expression(),
            T::Async if self.next_is_function_on_same_line() => self.function_expression(),
            T::NoSubstitutionTemplate | T::TemplateHead => self.template_expression(),
            T::Class => self.class_expression(),
            T::At => self.decorated_expression(),
            T::Slash | T::SlashEquals => {
                self.lx.rescan_slash();
                self.token_expr(ExprKind::Regex)
            }
            T::BigInt => self.token_expr(ExprKind::BigInt(self.lx.atom)),
            T::PrivateIdentifier => {
                self.f.rare_syntax |= rare::ODD_PRIVATE_NAME;
                if self.is_ecmascript && self.private_name_before_in != self.pos() {
                    self.fail();
                }
                self.token_expr(ExprKind::PrivateIdentifier(self.lx.atom))
            }
            T::Super => self.token_expr(ExprKind::Super),
            T::LessThan if self.is_ecmascript => self.jsx_element_or_fragment(),
            // Only reached after `new`.
            T::Import if self.is_ecmascript || self.options.dialect.oxc => self.import_expression(),
            _ if self.is_identifier() => {
                if self.token() == T::Await {
                    self.note_await_as_a_name();
                }
                self.take_as_name();
                let name = self.lx.atom;
                self.note_identifier(name, self.lx.start);
                self.token_expr(ExprKind::Ident(name))
            }
            _ => self.missing_expression(1109),
        }
    }

    /// `nextTokenIsFunctionKeywordOnSameLine`
    pub(crate) fn next_is_function_on_same_line(&mut self) -> bool {
        self.look_ahead(|p| {
            p.next();
            p.token() == T::Function && !p.newline_before()
        })
    }

    /// `parseParenthesizedExpression`
    fn parenthesized_expression(&mut self) -> ExprId {
        let open = self.pos();
        self.next();
        let saved = self.enter_context(0, ctx::DISALLOW_IN);
        let expression = self.expression_maybe_in_parentheses(true);
        self.context = saved;
        if self.token() != T::CloseParen {
            return self.unclosed_parenthesized_expression(open, expression);
        }
        self.next();
        let end = self.prev_end();
        let expression = match self.reads_jsdoc() {
            true => self.parenthesized_jsdoc(open, expression),
            false => expression,
        };
        self.f.parens.push((expression, open, end));
        expression
    }

    /// Handles a missing `)` after `expression`, which follows the `(` at `open`.
    #[cold]
    fn unclosed_parenthesized_expression(&mut self, open: u32, expression: ExprId) -> ExprId {
        if self.token() == T::Colon && self.is_flow() {
            return self.flow_type_cast(open, expression);
        }
        self.expected(T::CloseParen);
        if self.recovers() {
            let expression = match self.reads_jsdoc() {
                true => self.parenthesized_jsdoc(open, expression),
                false => expression,
            };
            self.f.parens.push((expression, open, self.prev_end()));
            return expression;
        }
        expression
    }

    /// `parseArrayLiteralExpression`
    fn array_literal(&mut self) -> ExprId {
        let start = self.pos();
        self.next();
        let cleared = self.disallow_in_if_cleared_by_brackets() | ctx::DECORATOR;
        let saved = self.enter_context(0, cleared);
        let base = self.s.ids.len();
        let lists = self.enter_list(ListKind::ArrayLiteralMembers);
        while self.is_in_list(T::CloseBracket) && self.is_at_element(ListKind::ArrayLiteralMembers)
        {
            let full = self.full_start();
            let element = match self.token() {
                T::DotDotDot => self.spread_element(),
                // `NewOmittedExpression`
                T::Comma => self.add_expr(ExprKind::Missing, self.lx.start, self.lx.full_start),
                _ => self.assignment_expression(),
            };
            self.s.ids.push(element.0);
            if !self.eat(T::Comma)
                && !self.continues_without_comma(ListKind::ArrayLiteralMembers, full)
            {
                break;
            }
        }
        self.leave_list(lists);
        self.context = saved;
        self.expect_matching((T::OpenBracket, T::CloseBracket), Some(start));
        let elements = self.take_ids(base);
        self.finish_expr(ExprKind::Array(elements), start)
    }

    /// `parseTemplateExpression`, and a template without substitutions.
    fn template_expression(&mut self) -> ExprId {
        // A `NoSubstitutionTemplateLiteral` is a string.
        if self.token() == T::NoSubstitutionTemplate {
            self.untagged_template_piece();
            return self.token_expr(ExprKind::String(self.lx.atom));
        }
        let start = self.pos();
        let (exprs, _) = self.template_parts(false);
        self.finish_expr(ExprKind::Template { exprs }, start)
    }

    /// Call at a piece of an untagged template, where every escape has to be valid.
    pub(crate) fn untagged_template_piece(&mut self) {
        if self.lx.has_escape {
            self.rescan_template_piece();
        }
    }

    /// `reScanTemplateToken(false)`: reports the piece's invalid escapes.
    #[cold]
    #[inline(never)]
    fn rescan_template_piece(&mut self) {
        // Prettier lets Babel recover from them.
        if self.options.dialect.babel {
            return;
        }
        // oxc reports one error for the whole piece and continues.
        if self.is_for_oxc() {
            let closer = match self.token() {
                T::TemplateHead | T::TemplateMiddle => 2,
                _ => 1,
            };
            let at = (self.lx.start + 1, self.lx.end.saturating_sub(closer));
            return oxc::bad_escape_in_template(&mut self.f.diagnostics, at);
        }
        match self.recovers() {
            true => self.lx.rescan_template_without_tag(),
            false => self.report(),
        }
    }

    /// `IsUnterminated` for a template's last piece, which is the current token.
    #[inline(always)]
    fn is_at_unterminated_piece(&self) -> bool {
        self.recovers() && self.lx.end as usize == self.lx.src.len() && self.ends_without_backtick()
    }

    /// True if the template piece at the end of the text doesn't end with a closing `` ` ``.
    #[cold]
    #[inline(never)]
    fn ends_without_backtick(&self) -> bool {
        let piece = self.lx.text().get(1..).unwrap_or_default();
        let Some((b'`', before)) = piece.split_last() else {
            return true;
        };
        let backslashes = before.iter().rev().take_while(|&&c| c == b'\\').count();
        backslashes % 2 == 1
    }

    /// Parses the template at the current token. Returns its substitutions, which are followed by its texts in the id
    /// list, and `callIsIncomplete`.
    fn template_parts(&mut self, has_tag: bool) -> (IdList<ExprId>, bool) {
        // The first text, then each substitution and the text after it.
        let base = self.s.ids.len();
        if !has_tag {
            self.untagged_template_piece();
        }
        self.s.ids.push(self.lx.atom.0);
        let mut has_more_spans = self.token() == T::TemplateHead;
        let mut is_incomplete = has_tag && !has_more_spans && self.is_at_unterminated_piece();
        self.next();
        while has_more_spans {
            let expression = self.expression_allowing_in();
            self.s.ids.push(expression.0);
            if self.token() != T::CloseBrace {
                // `parseLiteralOfTemplateSpan`
                self.expected(T::CloseBrace);
                self.s.ids.push(known::empty.0);
                is_incomplete = true;
                break;
            }
            self.lx.rescan_template_continuation();
            if !has_tag {
                self.untagged_template_piece();
            }
            self.s.ids.push(self.lx.atom.0);
            has_more_spans = self.token() == T::TemplateMiddle;
            is_incomplete = has_tag && !has_more_spans && self.is_at_unterminated_piece();
            self.next();
        }
        let parts = self.s.ids.get(base..).unwrap_or_default();
        let start = self.f.ids.len() as u32;
        self.f.ids.extend(parts.iter().skip(1).step_by(2));
        self.f.ids.extend(parts.iter().step_by(2));
        let count = (parts.len() / 2) as u32;
        self.s.ids.truncate(base);
        (IdList::new(start, count), is_incomplete)
    }

    /// `parseTaggedTemplateRest`
    fn tagged_template(
        &mut self,
        start: u32,
        callee: ExprId,
        type_args: IdList<TypeNodeId>,
        is_in_chain: bool,
    ) -> ExprId {
        let backtick = self.pos();
        let head = self.lx.atom;
        if self.token() == T::NoSubstitutionTemplate && self.is_at_unterminated_piece() {
            self.re_report_unterminated_template();
        }
        // `checkTaggedTemplateExpression`: `checkGrammarTypeArguments` isn't called after the error below.
        let is_empty_list_error =
            |it: &Diagnostic| it.code == 1099 && (start..backtick).contains(&it.start);
        if is_in_chain
            && type_args.is_empty()
            && self.f.diagnostics.last().is_some_and(is_empty_list_error)
        {
            self.f.diagnostics.pop();
        }
        let (exprs, is_incomplete) = self.template_parts(true);
        // `checkGrammarTaggedTemplateChain`
        if is_in_chain {
            self.flag(
                DiagnosticKind::Grammar,
                1358,
                (backtick, self.prev_end()),
                &[],
            );
        }
        // A `NoSubstitutionTemplateLiteral` is a string, the same as without a tag.
        let kind = match exprs.is_empty() {
            true => ExprKind::String(head),
            false => ExprKind::Template { exprs },
        };
        let template = self.finish_expr(kind, backtick);
        let type_args = self.f.store_list(type_args);
        let call = self.f.add_call(Call {
            callee,
            args: exprs,
            type_args,
            close_pos: match is_incomplete {
                true => INCOMPLETE_TEMPLATE,
                false => u32::MAX,
            },
            chain: Chain::No,
        });
        self.f.tagged_templates.push((call, template));
        self.finish_expr(ExprKind::TaggedTemplate(call), start)
    }

    /// `reScanTemplateToken(true)` in `parseTaggedTemplateRest`: the scanner reports the unterminated template again.
    /// That makes it the last error, so no other error is reported at the end of the text.
    #[cold]
    #[inline(never)]
    fn re_report_unterminated_template(&mut self) {
        if self.options.dialect != Default::default() {
            return;
        }
        self.take_scanner_errors();
        let is_match = |it: &Diagnostic| it.code == 1160 && it.kind == DiagnosticKind::Parse;
        if let Some(at) = self.f.diagnostics.iter().rposition(is_match) {
            let error = self.f.diagnostics.remove(at);
            self.f.diagnostics.push(error);
        }
    }

    /// `parseNewExpressionOrNewDotTarget`
    fn new_expression(&mut self) -> ExprId {
        if self.is_too_deep() {
            return ExprId::NONE;
        }
        let start = self.pos();
        self.next();
        if self.eat(T::Dot) {
            // `checkGrammarMetaProperty`
            if self.lx.text() != b"target" && !self.lx.has_escape {
                let at = (self.lx.start, self.lx.end);
                let args = [self.lx.text(), b"new", b"target"];
                self.flag(DiagnosticKind::Grammar, 17012, at, &args);
            }
            let (name, _) = self.identifier_name();
            self.f.rare_syntax |= rare::NEW_TARGET;
            return self.finish_expr(ExprKind::NewTarget(name), start);
        }
        let callee_start = self.pos();
        let is_import_call = self.token() == T::Import && self.peek() == T::OpenParen;
        let callee = self.primary_expression();
        let mut callee = self.expression_rest(callee_start, callee, false);
        let mut type_args = IdList::EMPTY;
        // The type arguments belong to the `new` expression.
        if callee.idx() + 1 == self.f.exprs.len()
            && let Some(&Expr {
                kind:
                    ExprKind::Instantiation {
                        expr,
                        type_args: instantiation_args,
                    },
                ..
            }) = self.f.exprs.last()
            && !self.is_parenthesized(callee)
        {
            self.pop_expr();
            (callee, type_args) = (expr, self.f.list_at(instantiation_args));
        }
        let (args, close_pos) = match self.token() {
            T::OpenParen => self.argument_list(),
            T::QuestionDot => {
                self.optional_chain_from_new_expression(callee);
                (IdList::EMPTY, u32::MAX)
            }
            _ => (IdList::EMPTY, u32::MAX),
        };
        let type_args = self.f.store_list(type_args);
        let call = self.f.add_call(Call {
            callee,
            args,
            type_args,
            close_pos,
            chain: Chain::No,
        });
        if is_import_call && self.is_for_oxc() {
            let at = (callee_start, self.prev_end());
            oxc::new_import(&mut self.f.diagnostics, at);
        }
        self.finish_expr(ExprKind::New(call), start)
    }

    /// `parseNewExpressionOrNewDotTarget`, at the `?.` after `new callee`.
    #[cold]
    #[inline(never)]
    fn optional_chain_from_new_expression(&mut self, callee: ExprId) {
        if !self.recovers() {
            return self.reject(Rejection::Reported);
        }
        let (from, to) = source_range_of(&self.f, callee);
        let src = self.lx.src;
        let text = src.get(from as usize..to as usize).unwrap_or_default();
        self.error_at_token(1209, &[text]);
    }

    // ───────────────────────────── object literals ─────────────────────────────

    /// `parseObjectLiteralExpression`
    pub(crate) fn object_literal(&mut self) -> ExprId {
        let start = self.pos();
        // Only `parseJSONText` gets here at a token other than `{`.
        let open = self.expect(T::OpenBrace).then_some(start);
        let cleared = self.disallow_in_if_cleared_by_brackets() | ctx::DECORATOR;
        let saved = self.enter_context(0, cleared);
        let base = self.s.props.len();
        let modifiers = self.s.prop_modifiers.len();
        let lists = self.enter_list(ListKind::ObjectLiteralMembers);
        while self.is_in_list(T::CloseBrace) && self.is_at_element(ListKind::ObjectLiteralMembers) {
            let element = self.full_start();
            self.object_literal_element(base);
            if !self.eat(T::Comma)
                && !self.continues_without_comma(ListKind::ObjectLiteralMembers, element)
            {
                break;
            }
        }
        self.leave_list(lists);
        self.context = saved;
        self.expect_matching((T::OpenBrace, T::CloseBrace), open);
        let props: Span<PropId> = take_span!(self, props, base);
        if self.reads_jsdoc() {
            self.take_property_types(base, props);
        }
        for index in modifiers..self.s.prop_modifiers.len() {
            let (prop, list) = self.s.prop_modifiers[index];
            self.f
                .modifiers_of_props
                .push((props.at(prop as usize), list));
        }
        self.s.prop_modifiers.truncate(modifiers);
        self.finish_expr(ExprKind::Object(props), start)
    }

    /// `parsePropertyName`. Returns the key, its kind and its position.
    pub(crate) fn property_name(&mut self) -> (PropKey, NameKind, u32) {
        let pos = self.pos();
        let name = match self.token() {
            T::String => (PropKey::Name(self.lx.atom), NameKind::StringLiteral),
            T::Number => {
                let name = self.number_name(self.lx.number);
                (PropKey::Name(name), NameKind::NumericLiteral)
            }
            T::OpenBracket => {
                // `parseComputedPropertyName`
                self.next();
                let parens = self.f.parens.len();
                let had_identifier = std::mem::take(&mut self.has_await_identifier);
                let left = self.await_context_of_module();
                let saved = self.enter_context(0, ctx::DISALLOW_IN | ctx::TYPE | left);
                // "We parse any expression (including a comma expression)."
                let expression = match self.is_ecmascript {
                    true => self.assignment_expression(),
                    false => self.expression(),
                };
                self.context = saved;
                if saved & left != 0 {
                    self.computed_name_outside_await_context(pos);
                }
                // The native parser's `parsePropertyName` restores `statementHasAwaitIdentifier`, so an `await` in a
                // name doesn't cause the statement to be reparsed. See `top_level_statement`.
                if self.has_await_identifier
                    && !self.options.dialect.typescript_5
                    && !self.is_ecmascript
                    && !self.recovers()
                {
                    self.reject(Rejection::Unsupported);
                }
                self.has_await_identifier = had_identifier;
                self.expect(T::CloseBracket);
                // `IsDynamicName`: only a bare literal is a name.
                let is_bare = self.f.parens.len() == parens;
                let name_expr = self.f.exprs.get(expression.idx()).copied();
                let literal = name_expr.map_or((0, 0), |it| (it.pos, it.end));
                return match name_expr.map(|it| it.kind) {
                    Some(ExprKind::String(name)) if is_bare => {
                        self.drop_last_expr(expression);
                        self.finish_name(literal.0, literal.1);
                        (PropKey::Name(name), NameKind::ComputedString, pos)
                    }
                    Some(ExprKind::Number(n)) if is_bare => {
                        let name = self.number_name(self.f.numbers[n as usize]);
                        self.drop_last_expr(expression);
                        self.finish_name(literal.0, literal.1);
                        (PropKey::Name(name), NameKind::ComputedNumber, pos)
                    }
                    _ => {
                        // The kind of the literal under casts and parentheses.
                        let mut inner = expression;
                        while let Some(
                            ExprKind::As { expr, .. }
                            | ExprKind::Satisfies { expr, .. }
                            | ExprKind::AsConst(expr)
                            | ExprKind::NonNull(expr),
                        ) = self.f.exprs.get(inner.idx()).map(|it| it.kind)
                        {
                            inner = expr;
                        }
                        let name_kind = match self.f.exprs.get(inner.idx()).map(|it| it.kind) {
                            Some(ExprKind::String(_)) => NameKind::ComputedString,
                            Some(ExprKind::Number(_)) => NameKind::ComputedNumber,
                            _ => NameKind::Identifier,
                        };
                        (PropKey::Computed(expression), name_kind, pos)
                    }
                };
            }
            T::PrivateIdentifier => (PropKey::Private(self.lx.atom), NameKind::Identifier),
            T::BigInt => (PropKey::Name(self.lx.atom), NameKind::Identifier),
            token if token.is_identifier_or_keyword() => {
                (PropKey::Name(self.lx.atom), NameKind::Identifier)
            }
            _ => {
                let (name, pos) = self.missing_name();
                let key = match name.is_none() {
                    true => PropKey::None,
                    false => PropKey::Name(name),
                };
                return (key, NameKind::Identifier, pos);
            }
        };
        self.next_after_name();
        (name.0, name.1, pos)
    }

    /// `parsePropertyName` restores `statementHasAwaitIdentifier`, so a name is parsed outside a module's top-level
    /// await context. Returns `ctx::AWAIT` if there's such a context to clear here, otherwise 0.
    #[inline(always)]
    pub(crate) fn await_context_of_module(&self) -> u32 {
        match self.recovers() && self.has_context(ctx::TOP_LEVEL) {
            true if !self.options.dialect.typescript_5 && !self.names_are_in_await_context => {
                ctx::AWAIT
            }
            _ => 0,
        }
    }

    /// Call after the computed name that starts at `open`, which was parsed outside that context. See
    /// `top_level_statement`.
    #[cold]
    #[inline(never)]
    fn computed_name_outside_await_context(&mut self, open: u32) {
        let name = self.lx.src.get(open as usize..self.pos() as usize);
        self.has_await_in_name |= bun_core::strings::contains(name.unwrap_or_default(), b"await");
    }

    /// Removes `e`, which is the last expression and which nothing refers to.
    fn drop_last_expr(&mut self, e: ExprId) {
        if e.idx() + 1 == self.f.exprs.len() {
            if let Some(Expr {
                kind: ExprKind::Number(n),
                ..
            }) = self.pop_expr()
                && n as usize + 1 == self.f.numbers.len()
            {
                self.f.numbers.pop();
            }
        }
    }

    /// `parseObjectLiteralElement`: pushes the property on the property stack, where the literal's properties start at
    /// `base`.
    fn object_literal_element(&mut self, base: usize) {
        let start = self.pos();
        let token = self.token();
        if token == T::DotDotDot {
            self.next();
            let value = self.assignment_expression();
            let pos = self.first_operand_pos(value);
            return self.s.props.push(Prop {
                kind: PropKind::Spread,
                key: PropKey::None,
                name_kind: NameKind::Identifier,
                value,
                pos,
                start,
                end: self.prev_end(),
                postfix_token: 0,
            });
        }
        let mut flags = Flags::empty();
        let mut kind = PropKind::Init;
        let first_modifier = self.s.modifiers.len();
        if token.is_modifier() || token == T::At {
            flags = self.modifiers(ModifiersOf::Declaration);
            let is_decorator = |it: &Modifier| matches!(it.kind, ModifierKind::Decorator(_));
            if self.s.modifiers[first_modifier..].iter().any(is_decorator) {
                self.reject(Rejection::Reported);
            }
        }
        if matches!(self.token(), T::Get | T::Set) {
            // `parseContextualModifier`
            let accessor = self.token();
            let mark = self.lx.mark();
            self.next();
            if self.can_follow_accessor_keyword() {
                kind = match accessor {
                    T::Get => PropKind::Getter,
                    _ => PropKind::Setter,
                };
            } else {
                self.lx.reset(mark);
            }
        }
        let is_generator = kind == PropKind::Init && self.eat(T::Asterisk);
        // Even for oxc, `{ await }` isn't a shorthand where `await` is a keyword.
        let mut is_identifier = self.is_identifier_in_context();
        // As in a computed name.
        if self.token() == T::Await && self.await_context_of_module() != 0 {
            (is_identifier, self.has_await_in_name) = (true, true);
        }
        // oxc treats it as a name until it knows that the file is a module.
        if self.token() == T::Await
            && self.has_context(ctx::TOP_LEVEL)
            && self.options.is_module_or_script
            && !self.is_module_so_far()
        {
            is_identifier = true;
        }
        let is_bigint = self.token() == T::BigInt;
        let name_end = self.lx.end;
        let (mut key, name_kind, pos) = self.property_name();
        if matches!(key, PropKey::Private(_)) {
            self.f.rare_syntax |= rare::ODD_PRIVATE_NAME;
        }
        // `getDeclarationName`: a private name outside a class doesn't declare anything. Neither does a bigint.
        if self.class_depth == 0 && matches!(key, PropKey::Private(_)) || is_bigint {
            key = PropKey::None;
        }
        // "Disallowing of optional property assignments and definite assignment assertion happens in
        // the grammar checker."
        let mut postfix_token = 0;
        if kind == PropKind::Init
            && matches!(self.token(), T::Question | T::Exclamation)
            && !self.is_ecmascript
        {
            postfix_token = self.pos();
            self.next();
        }
        let is_function = kind != PropKind::Init
            || is_generator
            || matches!(self.token(), T::OpenParen | T::LessThan);
        let value = if is_function {
            let fn_kind = match kind {
                PropKind::Getter => FnKind::Getter,
                PropKind::Setter => FnKind::Setter,
                _ => {
                    kind = PropKind::Method;
                    FnKind::Method
                }
            };
            let mut fn_flags = match kind {
                PropKind::Method => flags & Flags::ASYNC,
                _ => Flags::empty(),
            };
            if is_generator {
                fn_flags |= Flags::GENERATOR;
            }
            let type_parameters = self.pos();
            let func = self.function_rest(
                fn_kind,
                fn_flags,
                key.name().unwrap_or(Atom::NONE),
                pos,
                start,
            );
            // The function expression starts at its parameters.
            let parameters = match self.recovers() {
                true => self.start_of_parameters(func),
                false => self.f[func].anchor,
            };
            let value = self.finish_expr(ExprKind::Fn(func), parameters);
            // In ESTree it starts at its type parameters: `{ a<T> /* comment */ () {} }`
            if type_parameters < parameters {
                self.unfinish_node(NodeData::Expr(value));
                self.finish_node(NodeData::Expr(value), type_parameters, self.prev_end());
            }
            value
        } else if is_identifier && self.token() != T::Colon {
            kind = PropKind::Shorthand;
            let PropKey::Name(name) = key else {
                return self.fail();
            };
            self.note_identifier(name, pos);
            let target = self.add_expr(ExprKind::Ident(name), pos, name_end);
            match self.token() {
                // `{ a = 1 }`, which only a destructuring assignment can have.
                T::Equals => {
                    self.next();
                    self.f.rare_syntax |= rare::DEFAULT_IN_OBJECT;
                    let value = self.assignment_expression_allowing_in();
                    let kind = ExprKind::Assign {
                        op: None,
                        target,
                        value,
                    };
                    self.finish_expr(kind, pos)
                }
                _ => target,
            }
        } else {
            // In a script `{ await }` is a shorthand.
            if self.recovers() && key == PropKey::Name(known::r#await) {
                self.note_await();
            }
            self.expect(T::Colon);
            self.assignment_expression_allowing_in()
        };
        let mut modifiers = Span::EMPTY;
        if self.s.modifiers.len() > first_modifier {
            modifiers = self.take_modifiers(first_modifier);
            let index = (self.s.props.len() - base) as u32;
            self.s.prop_modifiers.push((index, modifiers));
            let is_method = kind == PropKind::Method;
            if !(is_method && flags == Flags::ASYNC) && self.is_for_oxc() {
                oxc::object_member(&mut self.f, modifiers, is_method);
            }
        }
        let prop = Prop {
            kind,
            key,
            name_kind,
            value,
            pos,
            start,
            end: self.prev_end(),
            postfix_token,
        };
        if self.options.is_javascript && is_function {
            self.check_js_object_method(&prop, modifiers);
        }
        let prop = match self.reads_jsdoc() {
            true => self.property_jsdoc(prop),
            false => prop,
        };
        self.s.props.push(prop);
    }

    /// Returns the position of the `(` of the parameters of `func`, or of the token in its place.
    #[cold]
    #[inline(never)]
    fn start_of_parameters(&self, func: FnId) -> u32 {
        let anchor = self.f[func].anchor;
        match self.lx.src.get(anchor as usize) {
            Some(b'(') => anchor,
            // `createMissingList`: the anchor is before the end of the previous token.
            _ => bun_sema::check::spans::skip_trivia(self.lx.src, anchor as usize + 1) as u32,
        }
    }

    /// Returns the position of the first token of `e` that's neither a parenthesis nor part of `<T>`.
    pub(crate) fn first_operand_pos(&self, mut e: ExprId) -> u32 {
        loop {
            let Some(expr) = self.f.exprs.get(e.idx()) else {
                return 0;
            };
            e = match expr.kind {
                ExprKind::Binary { left, .. } => left,
                ExprKind::Assign { target, .. } => target,
                ExprKind::Cond { test, .. } => test,
                ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => obj,
                ExprKind::Call(call) | ExprKind::TaggedTemplate(call) => self.f[call].callee,
                ExprKind::Unary {
                    op: UnOp::PostInc | UnOp::PostDec,
                    operand,
                } => operand,
                ExprKind::As { expr, .. }
                | ExprKind::Satisfies { expr, .. }
                | ExprKind::Instantiation { expr, .. }
                | ExprKind::AsConst(expr)
                | ExprKind::NonNull(expr) => expr,
                _ => return expr.pos,
            };
        }
    }

    /// `canFollowGetOrSetKeyword`
    pub(crate) fn can_follow_accessor_keyword(&self) -> bool {
        match self.token() {
            T::OpenBracket | T::PrivateIdentifier => true,
            // acorn's `isClassElementNameStart`. Without recovery an accessor fails at them.
            T::OpenBrace | T::Asterisk | T::DotDotDot => !self.is_ecmascript && !self.recovers(),
            _ => self.is_literal_property_name(),
        }
    }
}
