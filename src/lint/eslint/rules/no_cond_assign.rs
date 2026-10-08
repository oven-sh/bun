use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow assignment operators in conditional expressions.
pub struct NoCondAssign {
    is_always: bool,
}

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected assignment within {{type}}.");
const MISSING: Message = Message::new(
    "missing",
    "Expected a conditional expression and instead saw an assignment.",
);

/// The test of a statement or of a conditional expression, and how the message describes that.
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
            ExprKind::Cond { test, .. } => Some((test, "ConditionalExpression")),
            _ => None,
        },
        _ => None,
    }
}

impl NoCondAssign {
    /// `"always"`: an assignment anywhere in a test.
    fn check_assignment<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let kind = cx.state.find(Node::Expr(e), |inner, ancestor| {
            if ast_utils::is_function(ancestor) {
                return Some(None);
            }
            let (test, kind) = test_of(ancestor)?;
            (Node::Expr(test) == inner).then_some(Some(kind))
        });
        // The default value of a part of a destructuring assignment is not an assignment.
        if let Some(Some(kind)) = kind
            && !utils::is_assignment_target(e)
        {
            cx.report(e, UNEXPECTED).data("type", kind);
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
        // ESLint wants two pairs around every test but that of a `for`. One of them is part of an
        // `if`, a `while` and a `do`, and none is part of a conditional expression.
        let needed = if matches!(node, Node::Expr(_)) { 2 } else { 1 };
        if test.parens().len() < needed {
            cx.report(test, MISSING);
        }
    }
}

impl Rule for NoCondAssign {
    const META: Meta = Meta::eslint("no-cond-assign", Kind::Problem).recommended();
    /// How the message describes what a node is in the test of, within its function.
    type State<'a> = AncestorMemo<'a, Option<&'static str>>;

    fn new(options: &Options) -> Self {
        NoCondAssign {
            is_always: options.str(0) == Some("always"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> Self::State<'a> {
        if self.is_always {
            on.exprs([ExprTag::Assign], Self::check_assignment);
        } else {
            on.stmts(
                [StmtTag::If, StmtTag::While, StmtTag::DoWhile, StmtTag::For],
                |rule, stmt, cx| rule.check_test(stmt.into(), cx),
            );
            on.exprs([ExprTag::Cond], |rule, e, cx| rule.check_test(e.into(), cx));
        }
        AncestorMemo::default()
    }
}
