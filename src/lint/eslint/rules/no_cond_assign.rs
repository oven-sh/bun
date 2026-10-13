use bun_lint::prelude::*;
use bun_lint_oxlint::ast_util::get_inner_expression;
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
#[inline]
fn test_of(node: Node<'_>) -> Option<(Expr<'_>, &'static str)> {
    match node {
        Node::Stmt(stmt) if stmt.tag() == StmtTag::If => Some((stmt.as_if()?.0, "an 'if' statement")),
        Node::Stmt(stmt) if !stmt.is_loop() => None,
        Node::Stmt(stmt) => match stmt.kind() {
            StmtKind::While { test, .. } => Some((test, "a 'while' statement")),
            StmtKind::DoWhile { test, .. } => Some((test, "a 'do...while' statement")),
            StmtKind::For { test, .. } => Some((test?, "a 'for' statement")),
            _ => None,
        },
        Node::Expr(e) => Some((e.as_cond()?.0, "ConditionalExpression")),
        _ => None,
    }
}

/// oxlint points at the operator.
fn place<'a>(assignment: Expr<'a>, cx: &Cx<'a, NoCondAssign>) -> Span {
    match assignment.operator_span() {
        Some(operator) if cx.language().is_oxlint => operator,
        _ => assignment.span(),
    }
}

/// `can_stay` means the rule allows the assignment once it's wrapped in another pair of parentheses.
fn hint(assignment: Expr<'_>, can_stay: bool) -> &'static str {
    let is_plain = matches!(assignment.kind(), ExprKind::Assign { op: None, .. });
    match (is_plain, can_stay) {
        (true, true) => "Did you mean ===? To keep the assignment, wrap it in another pair of parentheses.",
        (true, false) => "Did you mean ===?",
        (false, true) => "To keep the assignment, wrap it in another pair of parentheses.",
        (false, false) => "",
    }
}

impl NoCondAssign {
    /// `"always"`: an assignment anywhere in a test.
    #[inline(never)]
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
            cx.report(place(e, cx), UNEXPECTED).data("type", kind).hint(hint(e, false));
        }
    }

    /// With `"always"` oxlint says it once more of a test that is an assignment.
    #[inline(never)]
    fn check_test_once_more<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((test, kind)) = test_of(node)
            && let assignment = get_inner_expression(test)
            && assignment.tag() == ExprTag::Assign
        {
            cx.report(place(assignment, cx), UNEXPECTED).data("type", kind);
        }
    }

    /// `"except-parens"`: a test that is an assignment, without parentheses of its own.
    #[inline]
    fn check_test<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        if let Some((test, _)) = test_of(node)
            && test.tag() == ExprTag::Assign
        {
            Self::check_parentheses(node, test, cx);
        }
    }

    /// `test`: that of `node`, an assignment.
    #[inline(never)]
    fn check_parentheses<'a>(node: Node<'a>, test: Expr<'a>, cx: &Cx<'a, Self>) {
        // ESLint wants two pairs around every test but that of a `for`. One of them is part of an
        // `if`, a `while` and a `do`, and none is part of a conditional expression.
        let needed = match node {
            // oxlint sees through the parentheses there.
            Node::Expr(_) if cx.language().is_oxlint => usize::MAX,
            Node::Expr(_) => 2,
            _ => 1,
        };
        if test.parens().len() < needed {
            cx.report(place(test, cx), MISSING).hint(hint(test, needed == 1));
        }
    }
}

impl Rule for NoCondAssign {
    const META: Meta = Meta::eslint("no-cond-assign", Kind::Problem).recommended().hints();
    const ON: On = On::new()
        .exprs(&[ExprTag::Assign, ExprTag::Cond])
        .stmts(&[StmtTag::If, StmtTag::While, StmtTag::DoWhile, StmtTag::For]);
    /// How the message describes what a node is in the test of, within its function.
    type State<'a> = AncestorMemo<'a, Option<&'static str>>;

    fn new(options: &Options) -> Self {
        NoCondAssign {
            is_always: options.str(0) == Some("always"),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if self.is_always {
            on = on.exprs(&[ExprTag::Assign]);
            if file.language().is_oxlint {
                on = on.stmts(&[StmtTag::If, StmtTag::While, StmtTag::DoWhile, StmtTag::For]);
                on = on.exprs(&[ExprTag::Cond]);
            }
        } else {
            on = on.stmts(&[StmtTag::If, StmtTag::While, StmtTag::DoWhile, StmtTag::For]);
            on = on.exprs(&[ExprTag::Cond]);
        }
        on
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    #[inline]
    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Assign => self.check_assignment(e, cx),
            ExprTag::Cond if self.is_always => self.check_test_once_more(e.into(), cx),
            ExprTag::Cond => self.check_test(e.into(), cx),
            _ => {}
        }
    }

    #[inline]
    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if self.is_always {
            self.check_test_once_more(stmt.into(), cx);
        } else {
            self.check_test(stmt.into(), cx);
        }
    }
}
