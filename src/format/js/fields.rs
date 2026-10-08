//! The fields of ESTree nodes, as methods of the handles.
//!
//! `match e.kind()` is the way to take a node apart. These are for a question about one field of
//! a node whose kind is known, mostly a parent: `parent.object() == Some(e)`. Each is `None`, or
//! empty, for a node that has no such field.

use bun_lint::ast::{BinOp, Call, Expr, ExprKind, Func, Stmt, StmtKind, TypeNode, UnOp};

pub(crate) trait ExprFields<'a>: Copy {
    /// `MemberExpression.object`
    fn object(self) -> Option<Expr<'a>>;
    /// `CallExpression.callee`, `NewExpression.callee`
    fn callee(self) -> Option<Expr<'a>>;
    /// `TaggedTemplateExpression.tag`
    fn tag_expression(self) -> Option<Expr<'a>>;
    /// The call of a `CallExpression`, a `NewExpression` or a `TaggedTemplateExpression`.
    fn call(self) -> Option<Call<'a>>;
    /// `BinaryExpression.left`, `LogicalExpression.left`, `AssignmentExpression.left`
    fn left(self) -> Option<Expr<'a>>;
    /// `BinaryExpression.right`, `LogicalExpression.right`, `AssignmentExpression.right`
    fn right(self) -> Option<Expr<'a>>;
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
    fn object(self) -> Option<Expr<'a>> {
        match self.kind() {
            ExprKind::Dot { obj, .. } | ExprKind::Index { obj, .. } => Some(obj),
            _ => None,
        }
    }

    fn callee(self) -> Option<Expr<'a>> {
        match self.kind() {
            ExprKind::Call(call) | ExprKind::New(call) => Some(call.callee()),
            _ => None,
        }
    }

    fn tag_expression(self) -> Option<Expr<'a>> {
        match self.kind() {
            ExprKind::TaggedTemplate(call) => Some(call.callee()),
            _ => None,
        }
    }

    fn call(self) -> Option<Call<'a>> {
        match self.kind() {
            ExprKind::Call(call) | ExprKind::New(call) | ExprKind::TaggedTemplate(call) => Some(call),
            _ => None,
        }
    }

    fn left(self) -> Option<Expr<'a>> {
        match self.kind() {
            ExprKind::Binary { left, .. } => Some(left),
            ExprKind::Assign { target, .. } => Some(target),
            _ => None,
        }
    }

    fn right(self) -> Option<Expr<'a>> {
        match self.kind() {
            ExprKind::Binary { right, .. } => Some(right),
            ExprKind::Assign { value, .. } => Some(value),
            _ => None,
        }
    }

    fn binary_operator(self) -> Option<BinOp> {
        match self.kind() {
            ExprKind::Binary { op, .. } => Some(op),
            _ => None,
        }
    }

    fn unary_operator(self) -> Option<UnOp> {
        match self.kind() {
            ExprKind::Unary { op, .. } => Some(op),
            _ => None,
        }
    }

    fn test(self) -> Option<Expr<'a>> {
        match self.kind() {
            ExprKind::Cond { test, .. } => Some(test),
            _ => None,
        }
    }

    fn alternate(self) -> Option<Expr<'a>> {
        match self.kind() {
            ExprKind::Cond { no, .. } => Some(no),
            _ => None,
        }
    }

    fn argument(self) -> Option<Expr<'a>> {
        match self.kind() {
            ExprKind::Unary { operand, .. } | ExprKind::Await(operand) | ExprKind::Spread(operand) => {
                Some(operand)
            }
            ExprKind::Yield { value, .. } => value,
            _ => None,
        }
    }

    fn expression(self) -> Option<Expr<'a>> {
        match self.kind() {
            ExprKind::As { expr, .. }
            | ExprKind::Satisfies { expr, .. }
            | ExprKind::AsConst(expr)
            | ExprKind::NonNull(expr)
            | ExprKind::Instantiation { expr, .. } => Some(expr),
            ExprKind::Index { index, .. } => Some(index),
            _ => None,
        }
    }

    fn type_annotation(self) -> Option<TypeNode<'a>> {
        match self.kind() {
            ExprKind::As { ty, .. } | ExprKind::Satisfies { ty, .. } => Some(ty),
            _ => None,
        }
    }

    fn arrow_function(self) -> Option<Func<'a>> {
        self.as_fn().filter(|func| func.is_arrow())
    }

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
