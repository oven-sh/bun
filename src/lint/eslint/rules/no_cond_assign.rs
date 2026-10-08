use bun_lint::prelude::*;

/// Disallow assignment operators in conditional expressions.
pub struct NoCondAssign {
    is_always: bool,
}

const UNEXPECTED: Message =
    Message::new("unexpected", "Unexpected assignment within {{type}}.");
const MISSING: Message = Message::new(
    "missing",
    "Expected a conditional expression and instead saw an assignment.",
);

/// The test of a statement or of a conditional expression, and what ESLint calls that.
fn test_of(node: Node<'_>) -> Option<(Expr<'_>, &'static str)> {
    match node {
        Node::Stmt(stmt) => match stmt.kind() {
            StmtKind::If { test, .. } => Some((test, "an 'if' statement")),
            StmtKind::While { test, .. } => Some((test, "a 'while' statement")),
            StmtKind::DoWhile { test, .. } => Some((test, "a 'do...while' statement")),
            StmtKind::For { test, .. } => Some((test?, "a 'for' statement")),
            _ => None,
        },
        Node::Expr(e) => match e.kind() {
            ExprKind::Cond { test, .. } => Some((test, "a conditional expression")),
            _ => None,
        },
        _ => None,
    }
}

impl NoCondAssign {
    /// `"always"`: an assignment anywhere in a test.
    fn check_assignment<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let mut inner = Node::Expr(e);
        for ancestor in inner.ancestors() {
            if matches!(ancestor, Node::Func(_)) {
                return;
            }
            if let Some((test, kind)) = test_of(ancestor)
                && Node::Expr(test) == inner
            {
                cx.report(e, UNEXPECTED).data("type", kind);
                return;
            }
            inner = ancestor;
        }
    }

    /// `"except-parens"`: a test that is an assignment, without parentheses of its own.
    fn check_test<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Some((test, _)) = test_of(node) else {
            return;
        };
        if test.tag() != ExprTag::Assign {
            return;
        }
        // Those of `if (..)` are not around the expression, those of `(..) ? a : b` are.
        let needed = if matches!(node, Node::Expr(_)) { 1 } else { 1 };
        if test.parens().len() < needed {
            cx.report(test, MISSING);
        }
    }
}

impl Rule for NoCondAssign {
    const META: Meta = Meta::eslint("no-cond-assign", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoCondAssign {
            is_always: options.str(0) == Some("always"),
        }
    }

    fn register<'a>(&'a self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        if self.is_always {
            on.exprs([ExprTag::Assign], Self::check_assignment);
        } else {
            on.stmts(
                [StmtTag::If, StmtTag::While, StmtTag::DoWhile, StmtTag::For],
                |rule, stmt, cx| rule.check_test(stmt.into(), cx),
            );
            on.exprs([ExprTag::Cond], |rule, e, cx| rule.check_test(e.into(), cx));
        }
    }
}
