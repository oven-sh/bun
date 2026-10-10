use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow `await` inside of loops.
pub struct NoAwaitInLoop;

const UNEXPECTED_AWAIT: Message =
    Message::new("unexpectedAwait", "Unexpected `await` inside a loop.");

fn is_await_using(stmt: Stmt) -> bool {
    match stmt.kind() {
        StmtKind::Var(declarations) => {
            declarations.first().is_some_and(|it| it.var_kind() == VarKind::AwaitUsing)
        }
        _ => false,
    }
}

/// ESLint's `isBoundary`. A `for await` iterates asynchronously on purpose.
fn is_boundary(node: Node) -> bool {
    match node {
        Node::Func(func) => func.kind() != FnKind::StaticBlock,
        Node::Stmt(stmt) => matches!(stmt.kind(), StmtKind::ForOf { is_await: true, .. }),
        _ => false,
    }
}

/// ESLint's `isLooped`
fn is_looped<'a>(node: Node<'a>, parent: Node<'a>) -> bool {
    let Node::Stmt(parent) = parent else {
        return false;
    };
    let is = |e: Option<Expr<'a>>| e.is_some_and(|e| Node::Expr(e) == node);
    match parent.kind() {
        StmtKind::For {
            test, update, body, ..
        } => is(test) || is(update) || Node::Stmt(body) == node,
        StmtKind::ForOf { left, body, .. } | StmtKind::ForIn { left, body, .. } => {
            Node::Stmt(body) == node || (Node::Stmt(left) == node && is_await_using(left))
        }
        StmtKind::While { test, body } | StmtKind::DoWhile { body, test } => {
            is(Some(test)) || Node::Stmt(body) == node
        }
        _ => false,
    }
}

impl NoAwaitInLoop {
    fn validate<'a>(&self, await_node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let is_in_loop = cx.state.find(await_node, |node, parent| match is_boundary(parent) {
            true => Some(false),
            false => is_looped(node, parent).then_some(true),
        });
        if is_in_loop == Some(true) {
            let whole = await_node.span();
            // oxlint points at the keyword, which it takes to be four bytes after the start of a `for`.
            let place = match (cx.language().is_oxlint, await_node) {
                (false, _) => whole,
                (true, Node::Stmt(it)) if it.tag() == StmtTag::ForOf => Span::new(whole.start + 4, whole.start + 9),
                (true, _) => Span::new(whole.start, whole.start + 5),
            };
            cx.report(place, UNEXPECTED_AWAIT);
        }
    }
}

impl Rule for NoAwaitInLoop {
    const META: Meta = Meta::eslint("no-await-in-loop", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Await]).stmts(&[StmtTag::ForOf, StmtTag::Var]);
    /// Whether a node is in a loop.
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(_: &Options) -> Self {
        NoAwaitInLoop
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AncestorMemo::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.validate(e.into(), cx);
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::ForOf => {
                if matches!(stmt.kind(), StmtKind::ForOf { is_await: true, .. }) {
                    self.validate(stmt.into(), cx);
                }
            }
            StmtTag::Var => {
                if is_await_using(stmt) {
                    self.validate(stmt.into(), cx);
                }
            }
            _ => {}
        }
    }
}
