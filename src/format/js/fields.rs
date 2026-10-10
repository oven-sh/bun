//! The fields of ESTree nodes, as methods of the handles.
//!
//! `match e.kind()` is the way to take a node apart. These are for a question about one field of
//! a node whose kind is known, mostly a parent: `parent.object() == Some(e)`. Each is `None`, or
//! empty, for a node that has no such field.

use bun_lint::ast::{BinOp, Call, Expr, ExprKind, Func, Stmt, StmtKind, TypeNode, UnOp};
use bun_sema::hir::ExprTag;

pub(crate) trait ExprFields<'a>: Copy {
    /// `TaggedTemplateExpression.tag`
    fn tag_expression(self) -> Option<Expr<'a>>;
    /// The call of a `CallExpression`, a `NewExpression` or a `TaggedTemplateExpression`.
    fn call(self) -> Option<Call<'a>>;
    /// `BinaryExpression.operator`, `LogicalExpression.operator`
    fn binary_operator(self) -> Option<BinOp>;
    /// `UnaryExpression.operator`, `UpdateExpression.operator`
    fn unary_operator(self) -> Option<UnOp>;
    /// `ConditionalExpression.test`
    fn test(self) -> Option<Expr<'a>>;
    /// `ConditionalExpression.alternate`
    fn alternate(self) -> Option<Expr<'a>>;
    /// `.argument` of a `UnaryExpression`, an `UpdateExpression`, an `AwaitExpression`, a
    /// `YieldExpression` or a `SpreadElement`.
    fn argument(self) -> Option<Expr<'a>>;
    /// `.expression` of a `TSAsExpression`, a `TSSatisfiesExpression`, a `TSTypeAssertion`, a
    /// `TSNonNullExpression` or a `TSInstantiationExpression`, and the index of a
    /// `ComputedMemberExpression`.
    fn expression(self) -> Option<Expr<'a>>;
    /// `.typeAnnotation` of a `TSAsExpression`, a `TSSatisfiesExpression` or a `TSTypeAssertion`.
    /// `None` for `as const`.
    fn type_annotation(self) -> Option<TypeNode<'a>>;
    /// The function of an `ArrowFunctionExpression`.
    fn arrow_function(self) -> Option<Func<'a>>;
    /// `optional: true`
    fn optional(self) -> bool;
}

impl<'a> ExprFields<'a> for Expr<'a> {
    #[inline]
    fn tag_expression(self) -> Option<Expr<'a>> {
        match self.tag() {
            ExprTag::TaggedTemplate => self.as_call_like().map(Call::callee),
            _ => None,
        }
    }

    #[inline]
    fn call(self) -> Option<Call<'a>> {
        self.as_call_like()
    }

    #[inline]
    fn binary_operator(self) -> Option<BinOp> {
        self.binary_op()
    }

    #[inline]
    fn unary_operator(self) -> Option<UnOp> {
        self.unary_op()
    }

    #[inline]
    fn test(self) -> Option<Expr<'a>> {
        match self.tag() {
            ExprTag::Cond => match self.kind() {
                ExprKind::Cond { test, .. } => Some(test),
                _ => None,
            },
            _ => None,
        }
    }

    #[inline]
    fn alternate(self) -> Option<Expr<'a>> {
        match self.tag() {
            ExprTag::Cond => match self.kind() {
                ExprKind::Cond { no, .. } => Some(no),
                _ => None,
            },
            _ => None,
        }
    }

    #[inline]
    fn argument(self) -> Option<Expr<'a>> {
        match self.tag() {
            ExprTag::Unary | ExprTag::Await | ExprTag::Spread => self.operand(),
            ExprTag::Yield => match self.kind() {
                ExprKind::Yield { value, .. } => value,
                _ => None,
            },
            _ => None,
        }
    }

    #[inline]
    fn expression(self) -> Option<Expr<'a>> {
        match self.tag() {
            ExprTag::As
            | ExprTag::Satisfies
            | ExprTag::AsConst
            | ExprTag::NonNull
            | ExprTag::Instantiation => self.operand(),
            ExprTag::Index => self.index(),
            _ => None,
        }
    }

    #[inline]
    fn type_annotation(self) -> Option<TypeNode<'a>> {
        match self.tag() {
            ExprTag::As | ExprTag::Satisfies => match self.kind() {
                ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => Some(ty),
                _ => None,
            },
            _ => None,
        }
    }

    #[inline]
    fn arrow_function(self) -> Option<Func<'a>> {
        self.as_fn().filter(|func| func.is_arrow())
    }

    #[inline]
    fn optional(self) -> bool {
        self.is_optional()
    }
}

pub(crate) trait StmtFields<'a>: Copy {
    /// `ForInStatement.left`, `ForOfStatement.left`: a `Var` statement, or the wrapper of an
    /// expression.
    fn for_left(self) -> Option<Stmt<'a>>;
    /// `ForStatement.init`
    fn for_init(self) -> Option<Stmt<'a>>;
    /// `IfStatement.consequent`
    fn consequent(self) -> Option<Stmt<'a>>;
    /// `IfStatement.alternate`
    fn alternate(self) -> Option<Stmt<'a>>;
    /// `TryStatement.finalizer`
    fn finalizer(self) -> Option<Stmt<'a>>;
    /// `for await`
    fn is_for_await(self) -> bool;
}

impl<'a> StmtFields<'a> for Stmt<'a> {
    fn for_left(self) -> Option<Stmt<'a>> {
        match self.kind() {
            StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => Some(left),
            _ => None,
        }
    }

    fn for_init(self) -> Option<Stmt<'a>> {
        match self.kind() {
            StmtKind::For { init, .. } => init,
            _ => None,
        }
    }

    fn consequent(self) -> Option<Stmt<'a>> {
        match self.kind() {
            StmtKind::If { yes, .. } => Some(yes),
            _ => None,
        }
    }

    fn alternate(self) -> Option<Stmt<'a>> {
        match self.kind() {
            StmtKind::If { no, .. } => no,
            _ => None,
        }
    }

    fn finalizer(self) -> Option<Stmt<'a>> {
        match self.kind() {
            StmtKind::Try { finalizer, .. } => finalizer,
            _ => None,
        }
    }

    fn is_for_await(self) -> bool {
        matches!(self.kind(), StmtKind::ForOf { is_await: true, .. })
    }
}
