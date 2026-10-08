use bun_lint::prelude::*;

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
        let mut node = await_node;
        for parent in await_node.ancestors() {
            if is_boundary(parent) {
                return;
            }
            if is_looped(node, parent) {
                cx.report(await_node, UNEXPECTED_AWAIT);
                return;
            }
            node = parent;
        }
    }
}

impl Rule for NoAwaitInLoop {
    const META: Meta = Meta::eslint("no-await-in-loop", Kind::Problem);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAwaitInLoop
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.exprs([ExprTag::Await], |rule, e, cx| rule.validate(e.into(), cx));
        on.stmts([StmtTag::ForOf], |rule, stmt, cx| {
            if matches!(stmt.kind(), StmtKind::ForOf { is_await: true, .. }) {
                rule.validate(stmt.into(), cx);
            }
        });
        on.stmts([StmtTag::Var], |rule, stmt, cx| {
            if is_await_using(stmt) {
                rule.validate(stmt.into(), cx);
            }
        });
    }
}
