//! Making nodes, and folding constants on the way.

use bun_engine_number::math::{portable_pow, remainder};
use bun_engine_number::{exact_int32, to_int32, to_uint32};

use super::{Class, Expression, PauseKind, PausePosition, Session, Statement, nothing};
use crate::ast::{
    AssignOperator, BinaryOperator, Element, Expr, ExprFlags, ExprId, ExprKind, List,
    LogicalOperator, Number, OpenList, PatternId, PatternKind, ResultType, Stmt, StmtKind,
    UnaryOperator,
};
use crate::names::Name;
use crate::token::TokenKind;

const INT32: ResultType = ResultType::INT32.union(ResultType::NUMBER);
const INT32_OR_BIGINT: ResultType = INT32.union(ResultType::BIGINT);
const NUMERIC: ResultType = ResultType::NUMBER.union(ResultType::BIGINT);

/// An operand of a binary operator.
#[derive(Clone, Copy)]
pub(super) struct Operand {
    pub(super) id: ExprId,
    /// With its parentheses.
    pub(super) start: u32,
    pub(super) end: u32,
    pub(super) assigns: bool,
}

fn binary_operator(kind: TokenKind) -> BinaryOperator {
    type T = TokenKind;
    match kind {
        T::Plus | T::AddAssign => BinaryOperator::Add,
        T::Minus | T::SubtractAssign => BinaryOperator::Subtract,
        T::Star | T::MultiplyAssign => BinaryOperator::Multiply,
        T::Slash | T::DivideAssign => BinaryOperator::Divide,
        T::Percent | T::RemainderAssign => BinaryOperator::Remainder,
        T::Exponentiate | T::ExponentiateAssign => BinaryOperator::Exponentiate,
        T::BitAnd | T::BitAndAssign => BinaryOperator::BitAnd,
        T::BitOr | T::BitOrAssign => BinaryOperator::BitOr,
        T::BitXor | T::BitXorAssign => BinaryOperator::BitXor,
        T::ShiftLeft | T::ShiftLeftAssign => BinaryOperator::ShiftLeft,
        T::ShiftRight | T::ShiftRightAssign => BinaryOperator::ShiftRight,
        T::ShiftRightUnsigned | T::ShiftRightUnsignedAssign => BinaryOperator::ShiftRightUnsigned,
        T::Equal => BinaryOperator::Equal,
        T::NotEqual => BinaryOperator::NotEqual,
        T::StrictEqual => BinaryOperator::StrictEqual,
        T::StrictNotEqual => BinaryOperator::StrictNotEqual,
        T::Less => BinaryOperator::Less,
        T::LessEqual => BinaryOperator::LessEqual,
        T::Greater => BinaryOperator::Greater,
        _ => BinaryOperator::GreaterEqual,
    }
}

pub(super) fn assign_operator(kind: TokenKind) -> AssignOperator {
    match kind {
        TokenKind::Assign => AssignOperator::Plain,
        TokenKind::AndAssign => AssignOperator::Logical(LogicalOperator::And),
        TokenKind::OrAssign => AssignOperator::Logical(LogicalOperator::Or),
        TokenKind::CoalesceAssign => AssignOperator::Logical(LogicalOperator::Coalesce),
        _ => AssignOperator::Binary(binary_operator(kind)),
    }
}

/// The first of `kinds` that both operands are of.
fn common_type(a: ResultType, b: ResultType, kinds: &[ResultType]) -> Option<ResultType> {
    (kinds.iter().copied()).find(|&kind| a.is_only(kind) && b.is_only(kind))
}

fn binary_result(operator: BinaryOperator, a: ResultType, b: ResultType) -> ResultType {
    use BinaryOperator::*;
    let numeric = || common_type(a, b, &[ResultType::NUMBER, ResultType::BIGINT]);
    match operator {
        Add if a.is_only(ResultType::STRING) || b.is_only(ResultType::STRING) => ResultType::STRING,
        Add => numeric().unwrap_or(NUMERIC.union(ResultType::STRING)),
        Subtract | Multiply | Divide | Remainder | Exponentiate => numeric().unwrap_or(NUMERIC),
        BitAnd | BitOr | BitXor | ShiftLeft | ShiftRight => INT32_OR_BIGINT,
        ShiftRightUnsigned => ResultType::NUMBER,
        _ => ResultType::BOOLEAN,
    }
}

fn logical_result(operator: LogicalOperator, a: ResultType, b: ResultType) -> ResultType {
    match operator {
        LogicalOperator::Coalesce if a.is_only(ResultType::NULL) => b,
        LogicalOperator::Coalesce if !a.intersects(ResultType::NULL | ResultType::OTHER) => a,
        LogicalOperator::Coalesce => ResultType::UNKNOWN,
        _ => {
            let kinds = [
                ResultType::BOOLEAN,
                ResultType::NUMBER,
                ResultType::STRING,
                ResultType::BIGINT,
            ];
            common_type(a, b, &kinds).unwrap_or(ResultType::UNKNOWN)
        }
    }
}

/// The value, and whether it counts as written without a fraction.
fn fold(operator: BinaryOperator, a: f64, b: f64, are_integers: bool) -> Option<(f64, bool)> {
    use BinaryOperator::*;
    let shift = || to_uint32(b) & 31;
    Some(match operator {
        Add => (a + b, are_integers),
        Subtract => (a - b, are_integers),
        Multiply => (a * b, are_integers),
        Divide => {
            let quotient = a / b;
            let is_whole =
                quotient.abs() < 9_223_372_036_854_775_808.0 && quotient as i64 as f64 == quotient;
            (quotient, are_integers && is_whole)
        }
        Remainder => (remainder(a, b), true),
        Exponentiate => (portable_pow(a, b)?, are_integers),
        BitAnd => (f64::from(to_int32(a) & to_int32(b)), true),
        BitOr => (f64::from(to_int32(a) | to_int32(b)), true),
        BitXor => (f64::from(to_int32(a) ^ to_int32(b)), true),
        ShiftLeft => (f64::from(to_int32(a) << shift()), true),
        ShiftRight => (f64::from(to_int32(a) >> shift()), true),
        ShiftRightUnsigned => (f64::from(to_uint32(a) >> shift()), true),
        _ => return None,
    })
}

impl Session<'_> {
    #[inline(always)]
    pub(super) fn push_typed(&mut self, start: u32, result: ResultType, kind: ExprKind) -> ExprId {
        self.ast.push_expression(Expr {
            start,
            end: 0,
            flags: ExprFlags::empty(),
            result,
            kind,
        })
    }

    #[inline(always)]
    pub(super) fn typed_node<const BUILD: bool>(
        &mut self,
        class: Class,
        start: u32,
        result: ResultType,
        kind: ExprKind,
    ) -> Expression {
        let word = if BUILD {
            self.push_typed(start, result, kind).word()
        } else {
            0
        };
        Expression { word, class }
    }

    #[inline(always)]
    pub(super) fn node<const BUILD: bool>(
        &mut self,
        class: Class,
        start: u32,
        kind: ExprKind,
    ) -> Expression {
        self.typed_node::<BUILD>(class, start, ResultType::UNKNOWN, kind)
    }

    /// An identifier or a private member.
    #[inline(always)]
    pub(super) fn named_node<const BUILD: bool>(
        &mut self,
        class: Class,
        name: Name,
        start: u32,
        kind: ExprKind,
    ) -> Expression {
        if BUILD {
            return self.node::<true>(class, start, kind);
        }
        Expression {
            word: name.index() as u32,
            class,
        }
    }

    /// Of what [`Session::named_node`] made, or of a chain that ends in it.
    #[inline(always)]
    pub(super) fn name_of<const BUILD: bool>(&self, expression: Expression) -> Name {
        if !BUILD {
            return Name::from_word(expression.word).unwrap_or(Name::EMPTY);
        }
        let mut kind = self.ast[expression.id()].kind;
        if let ExprKind::OptionalChain { chain, .. } = kind {
            kind = self.ast[chain].kind;
        }
        match kind {
            ExprKind::Identifier(name) | ExprKind::PrivateDot { name, .. } => name,
            _ => Name::EMPTY,
        }
    }

    /// With the last token.
    #[inline(always)]
    pub(super) fn end_expression<const BUILD: bool>(&mut self, expression: Expression) {
        if BUILD {
            self.ast[expression.id()].end = self.lexer.previous_end;
        }
    }

    #[inline(always)]
    pub(super) fn pause_at<const BUILD: bool>(&mut self, expression: Expression) {
        if BUILD {
            let node = &mut self.ast[expression.id()];
            node.flags |= ExprFlags::PAUSE;
            let start = node.start;
            self.record_pause(PauseKind::Pause, start);
        }
    }

    #[inline(always)]
    pub(super) fn record_pause(&mut self, kind: PauseKind, offset: u32) {
        if let Some(pauses) = &mut self.pauses {
            pauses.push(PausePosition { offset, kind });
        }
    }

    /// It ends with the last token.
    #[inline(always)]
    pub(super) fn statement_node<const BUILD: bool>(
        &mut self,
        start: u32,
        kind: StmtKind,
    ) -> Statement {
        if !BUILD {
            return nothing();
        }
        let (has_value, jumps_early) = match kind {
            StmtKind::Continue(_) | StmtKind::Break(_) => (false, true),
            StmtKind::Block { body, .. } => self.completion_of(body),
            StmtKind::Labeled { body, .. } => {
                (self.ast[body].has_value, self.ast[body].jumps_early)
            }
            StmtKind::Empty
            | StmtKind::Debugger
            | StmtKind::Variables(_)
            | StmtKind::Function(_)
            | StmtKind::Class(_)
            | StmtKind::ModuleItem
            | StmtKind::Export(_) => (false, false),
            _ => (true, false),
        };
        self.ast.push_statement(Stmt {
            start,
            end: self.lexer.previous_end,
            pause: false,
            has_value,
            jumps_early,
            kind,
        })
    }

    fn completion_of(&self, statements: List<Statement>) -> (bool, bool) {
        let mut jumps_early = false;
        for statement in self.ast.iter(statements) {
            jumps_early |= self.ast[statement].jumps_early;
            if self.ast[statement].has_value {
                return (true, jumps_early);
            }
        }
        (false, jumps_early)
    }

    /// One that a debugger can pause at.
    #[inline(always)]
    pub(super) fn step_node<const BUILD: bool>(&mut self, start: u32, kind: StmtKind) -> Statement {
        let statement = self.statement_node::<BUILD>(start, kind);
        self.pause_at_statement::<BUILD>(statement);
        statement
    }

    #[inline(always)]
    pub(super) fn pause_at_statement<const BUILD: bool>(&mut self, statement: Statement) {
        if BUILD {
            let node = &mut self.ast[statement];
            node.pause = true;
            let start = node.start;
            self.record_pause(PauseKind::Pause, start);
        }
    }

    #[inline(always)]
    pub(super) fn pattern_node<const BUILD: bool>(
        &mut self,
        start: u32,
        end: u32,
        kind: PatternKind,
    ) -> PatternId {
        if !BUILD {
            return nothing();
        }
        (self.ast).push_pattern(crate::ast::Pattern { start, end, kind })
    }

    #[inline(always)]
    pub(super) fn open_list(&self) -> OpenList {
        self.ast.open_list()
    }

    #[inline(always)]
    pub(super) fn append<const BUILD: bool>(&mut self, element: impl Element) {
        if BUILD {
            self.ast.push_to_list(element);
        }
    }

    #[inline(always)]
    pub(super) fn close_list<const BUILD: bool, T>(&mut self, list: OpenList) -> List<T> {
        if BUILD {
            self.ast.close_list(list)
        } else {
            List::EMPTY
        }
    }

    #[inline(always)]
    pub(super) fn count_assignment<const BUILD: bool>(&mut self) {
        if BUILD {
            self.assignments = self.assignments.wrapping_add(1);
        }
    }

    #[inline]
    pub(super) fn number_node(&mut self, start: u32, value: f64, is_integer: bool) -> ExprId {
        let result = match exact_int32(value) {
            Some(_) => INT32,
            None => ResultType::NUMBER,
        };
        let value = Number::new(value);
        self.push_typed(start, result, ExprKind::Number { value, is_integer })
    }

    fn number_of(&self, id: ExprId) -> Option<(f64, bool)> {
        match self.ast[id].kind {
            ExprKind::Number { value, is_integer } => Some((value.get(), is_integer)),
            _ => None,
        }
    }

    pub(super) fn unary_node(
        &mut self,
        start: u32,
        operator: UnaryOperator,
        operand: ExprId,
    ) -> ExprId {
        let node = self.ast[operand];
        match (operator, node.kind) {
            (UnaryOperator::Not, ExprKind::Number { value, .. }) => {
                let is_falsy = value.get() == 0.0 || value.get().is_nan();
                return self.push_typed(start, ResultType::BOOLEAN, ExprKind::Boolean(is_falsy));
            }
            (UnaryOperator::BitNot, ExprKind::Number { value, .. }) => {
                return self.number_node(start, f64::from(!to_int32(value.get())), true);
            }
            (UnaryOperator::Negate, ExprKind::Number { value, is_integer }) => {
                return self.number_node(start, -value.get(), is_integer);
            }
            (
                UnaryOperator::Negate,
                ExprKind::BigInt {
                    digits,
                    radix,
                    is_negative,
                },
            ) => {
                let kind = ExprKind::BigInt {
                    digits,
                    radix,
                    is_negative: !is_negative,
                };
                return self.push_typed(start, ResultType::BIGINT, kind);
            }
            (UnaryOperator::Plus, _) if node.result.is_only(ResultType::NUMBER) => return operand,
            _ => {}
        }
        let result = match operator {
            UnaryOperator::Not => ResultType::BOOLEAN,
            UnaryOperator::BitNot => INT32_OR_BIGINT,
            UnaryOperator::Negate => {
                binary_result(BinaryOperator::Subtract, node.result, node.result)
            }
            UnaryOperator::Plus => ResultType::NUMBER,
            UnaryOperator::Void => ResultType::UNKNOWN,
        };
        self.push_typed(start, result, ExprKind::Unary { operator, operand })
    }

    pub(super) fn binary_node(
        &mut self,
        start: u32,
        kind: TokenKind,
        left: Operand,
        right: Operand,
    ) -> ExprId {
        let (lhs, rhs) = (left.id, right.id);
        self.ast[lhs].end = left.end;
        self.ast[rhs].end = right.end;
        let (a, b) = (self.ast[lhs].result, self.ast[rhs].result);
        let operator = match kind {
            TokenKind::And => LogicalOperator::And,
            TokenKind::Or => LogicalOperator::Or,
            TokenKind::Coalesce => LogicalOperator::Coalesce,
            TokenKind::In | TokenKind::Instanceof => {
                let is_instanceof = kind == TokenKind::Instanceof;
                let result = if is_instanceof {
                    ResultType::BOOLEAN
                } else {
                    ResultType::UNKNOWN
                };
                let kind = ExprKind::Relation {
                    is_instanceof,
                    rhs_assigns: right.assigns,
                    lhs,
                    rhs,
                    lhs_start: left.start,
                    divot: right.start,
                    end: right.end,
                };
                return self.push_typed(start, result, kind);
            }
            _ => return self.arithmetic_node(start, binary_operator(kind), left, right),
        };
        let result = logical_result(operator, a, b);
        self.push_typed(start, result, ExprKind::Logical { operator, lhs, rhs })
    }

    fn arithmetic_node(
        &mut self,
        start: u32,
        operator: BinaryOperator,
        left: Operand,
        right: Operand,
    ) -> ExprId {
        let (lhs, rhs) = (left.id, right.id);
        match (self.number_of(lhs), self.number_of(rhs)) {
            (Some(a), Some(b)) => {
                if let Some((value, is_integer)) = fold(operator, a.0, b.0, a.1 && b.1) {
                    return self.number_node(start, value, is_integer);
                }
            }
            (Some((1.0, _)), None) if operator == BinaryOperator::Multiply => {
                return self.unary_node(start, UnaryOperator::Plus, rhs);
            }
            (None, Some((1.0, _))) if operator == BinaryOperator::Multiply => {
                return self.unary_node(start, UnaryOperator::Plus, lhs);
            }
            _ => {}
        }
        let result = binary_result(operator, self.ast[lhs].result, self.ast[rhs].result);
        let kind = ExprKind::Binary {
            operator,
            lhs,
            rhs,
            rhs_assigns: right.assigns,
        };
        self.push_typed(start, result, kind)
    }

    /// NamedEvaluation of ECMA-262.
    #[inline]
    pub(super) fn name_anonymous(&mut self, value: ExprId, name: Name) {
        match self.ast[value].kind {
            ExprKind::Function(function) if self.ast[function].own_name.is_none() => {
                self.ast[function].name = Some(name);
            }
            ExprKind::Class(class) if self.ast[class].own_name.is_none() => {
                self.ast[class].name = Some(name);
                if let Some(constructor) = self.ast[class].constructor {
                    self.ast[constructor].name = Some(name);
                }
            }
            _ => {}
        }
    }

    /// If the target is an identifier without parentheses.
    pub(super) fn name_after_target(&mut self, value: ExprId, target: ExprId) {
        let node = self.ast[target];
        if let ExprKind::Identifier(name) = node.kind
            && !node.flags.contains(ExprFlags::PARENTHESIZED)
        {
            self.name_anonymous(value, name);
        }
    }

    pub(super) fn name_after_pattern(&mut self, value: ExprId, pattern: PatternId) {
        match self.ast[pattern].kind {
            PatternKind::Binding { name, .. } => self.name_anonymous(value, name),
            PatternKind::Target(target) => self.name_after_target(value, target),
            _ => {}
        }
    }
}
