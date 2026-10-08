//! Expressions.

use super::stmt::ModifiersOf;
use super::{ListKind, ListStep, Parser, ctx, take_span};
use crate::Refusal;
use crate::token::T;
use bun_sema::atom::Atom;
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

/// Whether `end` is in a tuple, in an object type or among parameters in the text of types `text`.
fn is_in_list_of_type(text: &[u8], end: usize) -> bool {
    let mut open = Vec::new();
    for (at, c) in text.iter().enumerate().take(end) {
        match c {
            b'(' | b'[' | b'{' => open.push(at),
            b')' | b']' | b'}' => drop(open.pop()),
            _ => {}
        }
    }
    // `isUnambiguouslyStartOfFunctionType`: otherwise it is a type in parentheses.
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

/// The operator that a compound assignment combines with. `None` for `=`.
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

impl Parser<'_> {
    #[inline(always)]
    pub(crate) fn add_expr(&mut self, kind: ExprKind, pos: u32, end: u32) -> ExprId {
        let id = ExprId(self.f.exprs.len() as u32);
        self.f.exprs.push(Expr { kind, pos, end });
        id
    }

    /// An expression that ends with the previous token.
    #[inline(always)]
    pub(crate) fn finish_expr(&mut self, kind: ExprKind, pos: u32) -> ExprId {
        let end = self.prev_end();
        self.add_expr(kind, pos, end)
    }

    /// An expression that is the token, which is consumed.
    #[inline(always)]
    fn token_expr(&mut self, kind: ExprKind) -> ExprId {
        let id = self.add_expr(kind, self.lx.start, self.lx.end);
        self.next();
        id
    }

    /// `await` is read as a keyword.
    #[inline]
    pub(crate) fn note_await(&mut self) {
        if self.has_context(ctx::TOP_LEVEL) {
            self.has_top_level_await = true;
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
        let saved = self.enter_context(0, ctx::DECORATOR);
        let start = self.pos();
        let mut expression = self.assignment_expression();
        while self.token() == T::Comma {
            self.next();
            let right = self.assignment_expression();
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

    #[inline(always)]
    pub(crate) fn assignment_expression(&mut self) -> ExprId {
        self.assignment_expression_or_higher(true)
    }

    /// Whether `e`, which was just parsed, is in parentheses.
    #[inline(always)]
    pub(crate) fn is_parenthesized(&self, e: ExprId) -> bool {
        self.f.parens.last().is_some_and(|last| last.0 == e)
    }

    /// `IsLeftHandSideExpression` for `e`, which was just parsed.
    fn is_left_hand_side(&self, e: ExprId) -> bool {
        let Some(expr) = self.f.exprs.get(e.idx()) else {
            return false;
        };
        match expr.kind {
            ExprKind::Fn(f) => self.f[f].kind != FnKind::Arrow || self.is_parenthesized(e),
            ExprKind::Unary { .. }
            | ExprKind::Binary { .. }
            | ExprKind::Assign { .. }
            | ExprKind::Cond { .. }
            | ExprKind::Spread(_)
            | ExprKind::Await(_)
            | ExprKind::Yield { .. }
            | ExprKind::As { .. }
            | ExprKind::Satisfies { .. }
            | ExprKind::AsConst(_) => self.is_parenthesized(e),
            _ => true,
        }
    }

    /// `parseAssignmentExpressionOrHigher`
    pub(crate) fn assignment_expression_or_higher(&mut self, allow_return_type: bool) -> ExprId {
        let (start, full) = (self.pos(), self.full_start());
        // Most arguments, elements and initializers are a name or a literal and nothing more.
        let Some(primary) = self.name_or_literal() else {
            return self.assignment_expression_in_general(allow_return_type);
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

    /// `parsePrimaryExpression` if the token is all of it.
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

    fn assignment_expression_in_general(&mut self, allow_return_type: bool) -> ExprId {
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
            T::Yield => {
                if self.has_context(ctx::YIELD) {
                    return self.yield_expression();
                }
                // `isYieldExpression`: it is read as one. The checker reports it.
                if !self.is_ecmascript && self.next_is_word_or_literal_on_same_line() {
                    return self.yield_expression();
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
                self.f.exprs.pop();
                return self.simple_arrow_function(
                    name,
                    (pos, end, full),
                    false,
                    pos,
                    allow_return_type,
                );
            }
            self.fail();
            return expression;
        }
        if token.is_assignment_operator() {
            if !self.is_left_hand_side(expression) {
                self.fail();
                return expression;
            }
            if let Some(Expr {
                kind: ExprKind::Fn(_),
                ..
            }) = self.f.exprs.get(expression.idx())
                && !self.is_parenthesized(expression)
            {
                self.report();
            }
            self.next();
            let value = self.assignment_expression_or_higher(allow_return_type);
            let kind = ExprKind::Assign {
                op: assignment_operator(token),
                target: expression,
                value,
            };
            return self.finish_expr(kind, start);
        }
        if token == T::Question {
            // `parseConditionalExpressionRest`
            self.next();
            let saved = self.enter_context(0, ctx::DISALLOW_IN | ctx::DECORATOR);
            let yes = self.assignment_expression_or_higher(false);
            self.context = saved;
            self.expect(T::Colon);
            let no = self.assignment_expression_or_higher(allow_return_type);
            let kind = ExprKind::Cond {
                test: expression,
                yes,
                no,
            };
            return self.finish_expr(kind, start);
        }
        expression
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

    /// At a `#a` that is the first token of an operand, for acorn and Babel: it is the left side of
    /// `in` or nothing.
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
        // No operator is here, nor a `>` that one may start with.
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
                // The only operator whose right operand can have the same operator.
                T::AsteriskAsterisk if self.is_too_deep() => return left,
                T::In if self.has_context(ctx::DISALLOW_IN) => return left,
                T::As | T::Satisfies => {
                    // "Make sure we *do* perform ASI for constructs like this: var x = foo \n as
                    // (Bar)"
                    if self.newline_before() {
                        return left;
                    }
                    self.next();
                    let kind = if token == T::As && self.token() == T::Const {
                        self.js_error((self.lx.start, self.lx.end), 8016, b"");
                        self.const_assertion_type();
                        ExprKind::AsConst(left)
                    } else {
                        let ty = match self.is_flow {
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
                }
                _ => {
                    self.next();
                    let right = self.binary_expression(new_precedence);
                    if token == T::QuestionQuestion
                        && (self.is_logical_and_or_or(left) || self.is_logical_and_or_or(right))
                    {
                        self.report();
                    }
                    let kind = ExprKind::Binary {
                        op: binary_operator(token),
                        left,
                        right,
                    };
                    left = self.finish_expr(kind, start);
                }
            }
        }
    }

    /// `e` is `a || b` or `a && b`, not in parentheses: not an operand of `??`.
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

    /// The `const` of `e as const` and of `<const>e`.
    fn const_assertion_type(&mut self) {
        self.next();
        // `const` goes on as a type.
        if matches!(self.token(), T::Dot | T::LessThan | T::OpenBracket) && !self.newline_before()
            || matches!(self.token(), T::Dot | T::LessThan)
        {
            self.refuse(Refusal::Reported);
        }
    }

    /// `parseUnaryExpressionOrHigher`
    #[inline]
    fn unary_expression(&mut self) -> ExprId {
        let start = self.pos();
        match self.name_or_literal() {
            Some(primary) => self.rest_of_operand(start, primary),
            None => self.unary_expression_in_general(),
        }
    }

    fn unary_expression_in_general(&mut self) -> ExprId {
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
        let is_await_name = self.token() == T::Await && !self.is_await_expression();
        let expression = self.simple_unary_expression();
        if self.token() == T::AsteriskAsterisk {
            if is_await_name {
                let precedence = T::AsteriskAsterisk.binary_precedence();
                return self.binary_expression_rest(precedence, expression, start);
            }
            // The operand of `**` cannot be a unary expression.
            self.refuse(Refusal::Reported);
        }
        expression
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
        // "here we are using similar heuristics as 'isYieldExpression'". The checker reports it.
        !self.is_ecmascript && self.next_is_word_or_literal_on_same_line()
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
            T::Await if self.is_await_expression() => {
                self.note_await();
                self.next();
                let operand = self.simple_unary_expression();
                return self.finish_expr(ExprKind::Await(operand), start);
            }
            _ => return self.update_expression(),
        };
        self.next();
        let operand = self.simple_unary_expression();
        self.finish_expr(ExprKind::Unary { op, operand }, start)
    }

    /// `parseTypeAssertion`
    fn type_assertion(&mut self) -> ExprId {
        let start = self.pos();
        self.expect(T::LessThan);
        let ty = match self.token() {
            T::Const => {
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
            token @ (T::PlusPlus | T::MinusMinus) => {
                self.next();
                let operand = self.left_hand_side_expression();
                let op = match token {
                    T::PlusPlus => UnOp::PreInc,
                    _ => UnOp::PreDec,
                };
                return self.finish_expr(ExprKind::Unary { op, operand }, start);
            }
            // For acorn an element is a primary expression.
            T::LessThan if self.options.is_jsx && !self.is_ecmascript => {
                return self.jsx_element_or_fragment();
            }
            _ => {}
        }
        let operand = self.left_hand_side_expression();
        self.rest_of_update(start, operand)
    }

    /// What `parseUpdateExpression` does after `parseLeftHandSideExpressionOrHigher`.
    #[inline(always)]
    fn rest_of_update(&mut self, start: u32, operand: ExprId) -> ExprId {
        let token = self.token();
        if matches!(token, T::PlusPlus | T::MinusMinus) && !self.newline_before() {
            self.next();
            let op = match token {
                T::PlusPlus => UnOp::PostInc,
                _ => UnOp::PostDec,
            };
            return self.finish_expr(ExprKind::Unary { op, operand }, start);
        }
        operand
    }

    /// `parseDecoratorExpression`
    pub(crate) fn decorator_expression(&mut self) -> ExprId {
        if self.token() == T::Await && self.has_context(ctx::AWAIT) {
            self.refuse(Refusal::Reported);
        }
        // An element is no decorator.
        if self.token() == T::LessThan {
            self.fail();
        }
        self.left_hand_side_expression()
    }

    /// `parseLeftHandSideExpressionOrHigher`
    #[inline]
    pub(crate) fn left_hand_side_expression(&mut self) -> ExprId {
        let start = self.pos();
        let expression = match self.token() {
            T::Import => self.import_expression(),
            T::Super => {
                let expression = self.token_expr(ExprKind::Super);
                if !matches!(self.token(), T::OpenParen | T::Dot | T::OpenBracket) {
                    self.fail();
                }
                expression
            }
            _ => self.primary_expression(),
        };
        self.expression_rest(start, expression, true)
    }

    /// `import(..)`, `import.meta`
    fn import_expression(&mut self) -> ExprId {
        let start = self.pos();
        self.next();
        let mut is_deferred = false;
        if self.token() == T::Dot {
            self.next();
            match self.lx.text() {
                b"meta" if self.token() == T::Identifier => {
                    self.next();
                    return self.finish_expr(ExprKind::ImportMeta, start);
                }
                // For Babel `source` is a phase too. It is kept like `defer`: the text tells them
                // apart.
                b"defer" if self.peek() == T::OpenParen => {}
                b"source" if self.options.dialect.babel => {}
                _ => return self.other_meta_property_of_import(start),
            }
            self.next();
            is_deferred = true;
        }
        match self.token() {
            T::OpenParen => {
                self.next();
                let saved = self.enter_context(0, ctx::DISALLOW_IN | ctx::DECORATOR);
                let base = self.s.ids.len();
                let parens = self.f.parens.len();
                // `checkGrammarImportCallExpression` reports a spread, and any number of arguments but
                // one or two.
                while self.is_in_list(T::CloseParen) {
                    let argument = match self.token() {
                        T::DotDotDot => self.spread_element(),
                        _ => self.assignment_expression(),
                    };
                    self.s.ids.push(argument.0);
                    // `IsStringLiteralLike`: `("m")` is a `ParenthesizedExpression`.
                    if self.s.ids.len() == base + 1 && self.f.parens.len() == parens {
                        self.call_specifier(argument, SpecifierKind::ImportCall);
                    }
                    if !self.eat(T::Comma) {
                        break;
                    }
                }
                self.context = saved;
                let close = self.pos();
                self.expect(T::CloseParen);
                if self.s.ids.len() == base {
                    let missing = self.add_expr(ExprKind::Missing, close, close);
                    self.s.ids.push(missing.0);
                }
                let args = self.take_ids(base);
                if is_deferred && !args.is_empty() {
                    let specifier = self.f.id_at(args, 0);
                    self.f.deferred_import_calls.push((specifier, close));
                }
                self.finish_expr(ExprKind::ImportCall { args }, start)
            }
            _ => {
                self.fail();
                ExprId::NONE
            }
        }
    }

    /// At the `x` of `import.x`, which starts at `start`: it is kept as a property of nothing.
    /// `checkGrammarMetaProperty`, `checkGrammarImportCallExpression`
    #[cold]
    fn other_meta_property_of_import(&mut self, start: u32) -> ExprId {
        if !self.token().is_identifier_or_keyword()
            || self.token() == T::PrivateIdentifier
            || self.lx.has_escape
        {
            self.refuse(Refusal::Unsupported);
        }
        let (name, at, word) = (self.lx.atom, (self.lx.start, self.lx.end), self.lx.text());
        self.next();
        // Type arguments, and a call with `?.`, are looked at on the way.
        if matches!(
            self.token(),
            T::LessThan | T::LessThanLessThan | T::QuestionDot
        ) {
            self.refuse(Refusal::Unsupported);
        }
        match (word, self.token()) {
            (b"defer", _) => {
                let after = (at.1, Diagnostic::NO_LENGTH);
                self.flag(DiagnosticKind::Grammar, 1005, after, &[b"("]);
            }
            (_, T::OpenParen) => self.flag(DiagnosticKind::Grammar, 18061, at, &[word]),
            _ => self.flag(
                DiagnosticKind::Grammar,
                17012,
                at,
                &[word, b"import", b"meta"],
            ),
        }
        let obj = self.add_expr(ExprKind::Missing, start, start);
        let kind = ExprKind::Dot {
            obj,
            name,
            name_pos: at.0,
            chain: Chain::No,
        };
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

    /// `parseRightSideOfDot`: the name after a `.` or a `?.`, which is the token.
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
                self.refuse(Refusal::Reported);
            }
        } else if token != T::PrivateIdentifier {
            self.fail();
        }
        let name = (self.lx.atom, self.lx.start);
        self.next();
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
        self.expression_rest_in_general(start, expression, allows_calls)
    }

    fn expression_rest_in_general(
        &mut self,
        start: u32,
        mut expression: ExprId,
        allows_calls: bool,
    ) -> ExprId {
        let mut chain = Chain::No;
        // `expression`, if it is a `NonNull` with nothing after it yet.
        let mut non_null = ExprId::NONE;
        loop {
            match self.token() {
                T::Dot => {
                    self.next();
                    if chain != Chain::No && self.token() == T::PrivateIdentifier {
                        self.private_name_in_optional_chain();
                    }
                    let (name, name_pos) = self.right_side_of_dot();
                    let kind = ExprKind::Dot {
                        obj: expression,
                        name,
                        name_pos,
                        chain,
                    };
                    expression = self.finish_expr(kind, start);
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
                    // `new a?.b()` is an error.
                    if !allows_calls {
                        self.refuse(Refusal::Reported);
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
                                self.fail();
                                return expression;
                            };
                            if self.token() != T::OpenParen {
                                self.refuse(Refusal::Reported);
                            }
                            expression = self.call(start, expression, type_args, Chain::Start);
                        }
                        T::NoSubstitutionTemplate | T::TemplateHead => {
                            expression =
                                self.tagged_template(start, expression, IdList::EMPTY, true);
                        }
                        _ => {
                            if self.token() == T::PrivateIdentifier {
                                self.private_name_in_optional_chain();
                            }
                            let (name, name_pos) = self.right_side_of_dot();
                            let kind = ExprKind::Dot {
                                obj: expression,
                                name,
                                name_pos,
                                chain: Chain::Start,
                            };
                            expression = self.finish_expr(kind, start);
                        }
                    }
                    chain = Chain::Continue;
                }
                T::NoSubstitutionTemplate | T::TemplateHead => {
                    let is_in_chain = chain != Chain::No && non_null != expression;
                    expression =
                        self.tagged_template(start, expression, IdList::EMPTY, is_in_chain);
                }
                T::LessThan | T::LessThanLessThan if self.has_type_arguments_in_expressions => {
                    let Some(type_args) = self.try_type_arguments_in_expression(allows_calls)
                    else {
                        return expression;
                    };
                    expression = match self.token() {
                        T::OpenParen if allows_calls => {
                            self.call(start, expression, type_args, chain)
                        }
                        T::NoSubstitutionTemplate | T::TemplateHead => {
                            let is_in_chain = chain != Chain::No && non_null != expression;
                            self.tagged_template(start, expression, type_args, is_in_chain)
                        }
                        _ => {
                            let kind = ExprKind::Instantiation {
                                expr: expression,
                                type_args,
                            };
                            let instantiation = self.finish_expr(kind, start);
                            // `a<b>.c` is an error.
                            if matches!(self.token(), T::Dot | T::QuestionDot) {
                                self.refuse(Refusal::Reported);
                            }
                            instantiation
                        }
                    };
                }
                T::OpenBrace if allows_calls && self.is_flow => {
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

    /// At the `#b` of `a?.#b` or `a?.b.#c`, which is an error of TypeScript's parser.
    #[cold]
    fn private_name_in_optional_chain(&mut self) {
        match self.is_ecmascript {
            true => self.flag(
                DiagnosticKind::Grammar,
                18030,
                (self.lx.start, self.lx.end),
                &[],
            ),
            false => self.report(),
        }
    }

    /// `parseElementAccessExpressionRest`, at the `[`.
    fn element_access(&mut self, start: u32, obj: ExprId, chain: Chain) -> ExprId {
        self.next();
        let index = self.expression_allowing_in();
        self.expect(T::CloseBracket);
        self.finish_expr(ExprKind::Index { obj, index, chain }, start)
    }

    /// `parseArgumentList`, at the `(`: the arguments and the position of the `)`.
    fn argument_list(&mut self) -> (IdList<ExprId>, u32) {
        self.next();
        let saved = self.enter_context(0, ctx::DISALLOW_IN | ctx::DECORATOR);
        let base = self.s.ids.len();
        let lists = self.enter_list(ListKind::ArgumentExpressions);
        while self.is_in_list(T::CloseParen) {
            if self.recovers {
                match self.list_step(ListKind::ArgumentExpressions) {
                    ListStep::Element => {}
                    ListStep::Skipped => continue,
                    ListStep::Over => break,
                }
            }
            let element = self.full_start();
            let argument = match self.token() {
                T::DotDotDot => self.spread_element(),
                _ => self.assignment_expression(),
            };
            self.s.ids.push(argument.0);
            if !self.eat(T::Comma)
                && !(self.recovers
                    && self.recover_missing_comma(ListKind::ArgumentExpressions, element))
            {
                break;
            }
        }
        self.lists = lists;
        self.context = saved;
        let close = self.pos();
        self.expect(T::CloseParen);
        (self.take_ids(base), close)
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
        let call = self.f.add_call(Call {
            callee,
            args,
            type_args,
            close_pos,
            chain,
            template: ExprId::NONE,
        });
        self.finish_expr(ExprKind::Call(call), start)
    }

    /// `parseTypeArgumentsInExpression`, in a `tryParse`. `allows_calls`: not in the callee of `new`.
    fn try_type_arguments_in_expression(
        &mut self,
        allows_calls: bool,
    ) -> Option<IdList<TypeNodeId>> {
        if self.is_flow {
            return self.flow_type_arguments_in_expression(!allows_calls);
        }
        let less_than = self.pos() as usize;
        let type_arguments = self.try_parse(|p| {
            // `ReScanLessThanToken`
            if p.token() == T::LessThanLessThan {
                p.lx.token = T::LessThan;
                p.lx.end = p.lx.start + 1;
            }
            p.next();
            let base = p.s.ids.len();
            if let Some((at, code)) = p.type_argument_list(less_than as u32) {
                p.flag(DiagnosticKind::Grammar, code, at, &[]);
            }
            // The scanner never joins a `>` with what follows it.
            if p.token() != T::GreaterThan {
                return None;
            }
            // `ReScanGreaterThanToken`: `>=`, `>>` and so on do not end the list.
            p.lx.rescan_greater_than();
            if p.token() != T::GreaterThan {
                return None;
            }
            p.next();
            // `canFollowTypeArgumentsInExpression`
            let follows = match p.token() {
                T::OpenParen | T::NoSubstitutionTemplate | T::TemplateHead => true,
                T::LessThan | T::GreaterThan | T::Plus | T::Minus => false,
                _ => p.newline_before() || p.is_binary_operator() || !p.is_start_of_expression(),
            };
            follows.then(|| p.take_ids(base))
        });
        // TypeScript reports an error in a type and goes on. What it goes on with can end with a `>`,
        // and then these are type arguments with an error in them.
        if type_arguments.is_none()
            && let Some((failed_token, failed_at)) = self.was_abandoned_at
        {
            let rest = self.lx.src.get(less_than..).unwrap_or_default();
            let statement = rest.get(..256).unwrap_or(rest);
            let statement = match bun_core::strings::index_of_char_usize(statement, b';') {
                Some(end) => &statement[..end],
                None => statement,
            };
            // It skips no token on the way: any but a comma ends a list of type arguments, which
            // makes `isInSomeParsingContext` true. So it does not get past a bracket that closes
            // what was opened before the `<`.
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
            // What is before the error was read without one.
            let mut from = (failed_at as usize).saturating_sub(less_than);
            // A word where none is expected is left to what is around. Only a list takes it, as its
            // next element after a missing comma.
            if failed_token.is_identifier_or_keyword() && !is_in_list_of_type(statement, from) {
                from = statement.len();
            }
            while let Some(found) = statement
                .get(from..)
                .and_then(|rest| bun_core::strings::index_of_char_usize(rest, b'>'))
            {
                if ends_a_list(from + found) {
                    self.refuse(Refusal::Reported);
                    break;
                }
                from += found + 1;
            }
        }
        type_arguments
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
                if self.is_ecmascript && self.private_name_before_in != self.pos() {
                    self.fail();
                }
                self.token_expr(ExprKind::PrivateIdentifier(self.lx.atom))
            }
            T::Super => self.token_expr(ExprKind::Super),
            T::LessThan if self.is_ecmascript => self.jsx_element_or_fragment(),
            T::Import if self.is_ecmascript => self.import_expression(),
            _ if self.is_identifier() => {
                let name = self.lx.atom;
                self.note_identifier(name, self.lx.start);
                self.token_expr(ExprKind::Ident(name))
            }
            _ => {
                self.fail();
                ExprId::NONE
            }
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
        let expression = self.expression_allowing_in();
        if self.token() != T::CloseParen {
            return self.unclosed_parenthesized_expression(open, expression);
        }
        self.next();
        let end = self.prev_end();
        self.f.parens.push((expression, open, end));
        expression
    }

    /// No `)` follows the `expression` after the `(` at `open`.
    #[cold]
    fn unclosed_parenthesized_expression(&mut self, open: u32, expression: ExprId) -> ExprId {
        if self.token() == T::Colon && self.is_flow {
            return self.flow_type_cast(open, expression);
        }
        self.fail();
        expression
    }

    /// `parseArrayLiteralExpression`
    fn array_literal(&mut self) -> ExprId {
        let start = self.pos();
        self.next();
        let cleared = self.disallow_in_if_brackets_end_it() | ctx::DECORATOR;
        let saved = self.enter_context(0, cleared);
        let base = self.s.ids.len();
        while self.is_in_list(T::CloseBracket) {
            let element = match self.token() {
                T::DotDotDot => self.spread_element(),
                // `NewOmittedExpression`
                T::Comma => self.add_expr(ExprKind::Missing, self.lx.start, self.lx.full_start),
                _ => self.assignment_expression(),
            };
            self.s.ids.push(element.0);
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.context = saved;
        self.expect(T::CloseBracket);
        let elements = self.take_ids(base);
        self.finish_expr(ExprKind::Array(elements), start)
    }

    /// `parseTemplateExpression`, and a template without substitutions.
    fn template_expression(&mut self) -> ExprId {
        // A `NoSubstitutionTemplateLiteral` is a string.
        if self.token() == T::NoSubstitutionTemplate {
            self.piece_of_template_without_tag();
            return self.token_expr(ExprKind::String(self.lx.atom));
        }
        let start = self.pos();
        let exprs = self.template_parts(false);
        self.finish_expr(ExprKind::Template { exprs }, start)
    }

    /// The token is a piece of a template in which every escape has to be valid.
    pub(crate) fn piece_of_template_without_tag(&mut self) {
        if self.lx.has_escape {
            self.report();
        }
    }

    /// The substitutions of the template at the token. The texts follow them in the list of ids.
    fn template_parts(&mut self, has_tag: bool) -> IdList<ExprId> {
        // The first text, then each substitution and the text after it.
        let base = self.s.ids.len();
        if !has_tag {
            self.piece_of_template_without_tag();
        }
        self.s.ids.push(self.lx.atom.0);
        let mut goes_on = self.token() == T::TemplateHead;
        self.next();
        while goes_on {
            let expression = self.expression_allowing_in();
            if self.token() != T::CloseBrace {
                self.fail();
                break;
            }
            self.lx.rescan_template_continuation();
            if !has_tag {
                self.piece_of_template_without_tag();
            }
            self.s.ids.push(expression.0);
            self.s.ids.push(self.lx.atom.0);
            goes_on = self.token() == T::TemplateMiddle;
            self.next();
        }
        let parts = self.s.ids.get(base..).unwrap_or_default();
        let start = self.f.ids.len() as u32;
        self.f.ids.extend(parts.iter().skip(1).step_by(2));
        self.f.ids.extend(parts.iter().step_by(2));
        let count = (parts.len() / 2) as u32;
        self.s.ids.truncate(base);
        IdList::new(start, count)
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
        let exprs = self.template_parts(true);
        // `checkGrammarTaggedTemplateChain`
        if is_in_chain {
            self.flag(
                DiagnosticKind::Grammar,
                1358,
                (backtick, self.prev_end()),
                &[],
            );
        }
        // A `NoSubstitutionTemplateLiteral` is a string, as it is without a tag.
        let kind = match exprs.is_empty() {
            true => ExprKind::String(head),
            false => ExprKind::Template { exprs },
        };
        let template = self.finish_expr(kind, backtick);
        let call = self.f.add_call(Call {
            callee,
            args: exprs,
            type_args,
            close_pos: u32::MAX,
            chain: Chain::No,
            template,
        });
        self.finish_expr(ExprKind::TaggedTemplate(call), start)
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
            return self.finish_expr(ExprKind::NewTarget(name), start);
        }
        let callee_start = self.pos();
        let callee = self.primary_expression();
        let mut callee = self.expression_rest(callee_start, callee, false);
        let mut type_args = IdList::EMPTY;
        // The type arguments belong to the `new` expression.
        if callee.idx() + 1 == self.f.exprs.len()
            && let Some(&Expr {
                kind:
                    ExprKind::Instantiation {
                        expr,
                        type_args: written,
                    },
                ..
            }) = self.f.exprs.last()
            && !self.is_parenthesized(callee)
        {
            self.f.exprs.pop();
            (callee, type_args) = (expr, written);
        }
        let (args, close_pos) = match self.token() {
            T::OpenParen => self.argument_list(),
            _ => (IdList::EMPTY, u32::MAX),
        };
        let call = self.f.add_call(Call {
            callee,
            args,
            type_args,
            close_pos,
            chain: Chain::No,
            template: ExprId::NONE,
        });
        self.finish_expr(ExprKind::New(call), start)
    }

    // ───────────────────────────── object literals ─────────────────────────────

    /// `parseObjectLiteralExpression`
    pub(crate) fn object_literal(&mut self) -> ExprId {
        let start = self.pos();
        self.next();
        let cleared = self.disallow_in_if_brackets_end_it() | ctx::DECORATOR;
        let saved = self.enter_context(0, cleared);
        let base = self.s.props.len();
        let modifiers = self.s.prop_modifiers.len();
        while self.is_in_list(T::CloseBrace) {
            self.object_literal_element(base);
            if !self.eat(T::Comma) {
                break;
            }
        }
        self.context = saved;
        self.expect(T::CloseBrace);
        let props: Span<PropId> = take_span!(self, props, base);
        for index in modifiers..self.s.prop_modifiers.len() {
            let (prop, list) = self.s.prop_modifiers[index];
            self.f
                .modifiers_of_props
                .push((props.at(prop as usize), list));
        }
        self.s.prop_modifiers.truncate(modifiers);
        self.finish_expr(ExprKind::Object(props), start)
    }

    /// `parsePropertyName`: the key, its kind and its position.
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
                let had_await = std::mem::take(&mut self.has_top_level_await);
                let saved = self.enter_context(0, ctx::DISALLOW_IN | ctx::TYPE);
                // "We parse any expression (including a comma expression)."
                let expression = match self.is_ecmascript {
                    true => self.assignment_expression(),
                    false => self.expression(),
                };
                self.context = saved;
                // `parsePropertyName` of the native parser restores `statementHasAwaitIdentifier`, so
                // that no statement is parsed again for an `await` in a name.
                if self.has_top_level_await
                    && !self.options.dialect.typescript_5
                    && !self.is_ecmascript
                {
                    self.refuse(Refusal::Unsupported);
                }
                self.has_top_level_await |= had_await;
                self.expect(T::CloseBracket);
                // `IsDynamicName`: only a bare literal is a name.
                let is_bare = self.f.parens.len() == parens;
                let kind = self.f.exprs.get(expression.idx()).map(|it| it.kind);
                return match kind {
                    Some(ExprKind::String(name)) if is_bare => {
                        self.drop_last_expr(expression);
                        (PropKey::Name(name), NameKind::ComputedString, pos)
                    }
                    Some(ExprKind::Number(n)) if is_bare => {
                        let name = self.number_name(self.f.numbers[n as usize]);
                        self.drop_last_expr(expression);
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
                self.fail();
                (PropKey::None, NameKind::Identifier)
            }
        };
        self.next();
        (name.0, name.1, pos)
    }

    /// Removes `e`, which is the last expression and is not referred to.
    fn drop_last_expr(&mut self, e: ExprId) {
        if e.idx() + 1 == self.f.exprs.len() {
            if let Some(Expr {
                kind: ExprKind::Number(n),
                ..
            }) = self.f.exprs.pop()
                && n as usize + 1 == self.f.numbers.len()
            {
                self.f.numbers.pop();
            }
        }
    }

    /// `parseObjectLiteralElement`: pushes it on the stack of properties, which the literal's start
    /// at `base`.
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
                self.refuse(Refusal::Reported);
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
        let is_identifier = self.is_identifier();
        let is_bigint = self.token() == T::BigInt;
        let name_end = self.lx.end;
        let (mut key, name_kind, pos) = self.property_name();
        // `getDeclarationName`: a private name outside a class declares nothing. Neither does a
        // bigint.
        if self.classes_around == 0 && matches!(key, PropKey::Private(_)) || is_bigint {
            key = PropKey::None;
        }
        // "Disallowing of optional property assignments and definite assignment assertion happens in
        // the grammar checker."
        let mut postfix_token = 0;
        if kind == PropKind::Init && matches!(self.token(), T::Question | T::Exclamation) {
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
            let func = self.function_rest(
                fn_kind,
                fn_flags,
                key.name().unwrap_or(Atom::NONE),
                pos,
                start,
            );
            // The function expression starts at its parameters.
            self.finish_expr(ExprKind::Fn(func), self.f[func].anchor)
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
            self.expect(T::Colon);
            self.assignment_expression_allowing_in()
        };
        let mut modifiers = Span::EMPTY;
        if self.s.modifiers.len() > first_modifier {
            modifiers = self.take_modifiers(first_modifier);
            let index = (self.s.props.len() - base) as u32;
            self.s.prop_modifiers.push((index, modifiers));
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
            self.check_js_method_of_object(&prop, modifiers);
        }
        self.s.props.push(prop);
    }

    /// The position of the first token of `e` that is neither a parenthesis nor part of `<T>`.
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

    /// `canFollowModifier`, after `get` or `set`.
    pub(crate) fn can_follow_accessor_keyword(&self) -> bool {
        match self.token() {
            T::OpenBracket | T::PrivateIdentifier => true,
            // acorn's `isClassElementNameStart`
            T::OpenBrace | T::Asterisk | T::DotDotDot => !self.is_ecmascript,
            _ => self.is_literal_property_name(),
        }
    }
}
