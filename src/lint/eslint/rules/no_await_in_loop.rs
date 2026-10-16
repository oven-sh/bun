use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow `await` inside of loops.
pub struct NoAwaitInLoop;

const UNEXPECTED_AWAIT: Message =
    Message::new("unexpectedAwait", "Unexpected `await` inside a loop.");

fn is_await_using(stmt: Stmt) -> bool {
    (stmt.as_var().and_then(|declarations| declarations.first())).is_some_and(|it| it.var_kind() == VarKind::AwaitUsing)
}

/// ESLint's `isBoundary`. A `for await` iterates asynchronously on purpose.
fn is_boundary(node: Node) -> bool {
    match node {
        Node::Func(func) => func.kind() != FnKind::StaticBlock,
        Node::Stmt(stmt) => stmt.as_for_of().is_some_and(|(.., is_await)| is_await),
        _ => false,
    }
}

/// ESLint's `isLooped`
fn is_looped<'a>(node: Node<'a>, parent: Node<'a>) -> bool {
    let Node::Stmt(parent) = parent else {
        return false;
    };
    if !parent.is_loop() {
        return false;
    }
    // oxlint knows a body that is a block or an expression, and no test that is a member or has a type around it.
    let is_oxlint = parent.file().language().is_oxlint;
    let is_known = |e: Expr<'a>| {
        let tags = [
            ExprTag::Dot,
            ExprTag::Index,
            ExprTag::As,
            ExprTag::AsConst,
            ExprTag::Satisfies,
            ExprTag::NonNull,
            ExprTag::Instantiation,
            ExprTag::Jsx,
        ];
        !is_oxlint || e.is_parenthesized() || e.is_chain_root() || !tags.contains(&e.tag())
    };
    let is = |e: Option<Expr<'a>>| e.is_some_and(|e| Node::Expr(e) == node && is_known(e));
    let is_body = |body: Stmt<'a>| {
        Node::Stmt(body) == node && (!is_oxlint || body.as_block().is_some() || body.tag() == StmtTag::Expr)
    };
    match parent.kind() {
        StmtKind::For {
            test, update, body, ..
        } => is(test) || is(update) || is_body(body),
        StmtKind::ForOf { left, body, .. } | StmtKind::ForIn { left, body, .. } => {
            is_body(body) || (Node::Stmt(left) == node && is_await_using(left))
        }
        StmtKind::While { test, body } | StmtKind::DoWhile { body, test } => is(Some(test)) || is_body(body),
        _ => false,
    }
}

impl NoAwaitInLoop {
    #[inline(never)]
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
    const ON: On = On::new().exprs(&[ExprTag::Await]).stmts(&[StmtTag::ForOf]).var_decls();
    /// Whether a node is in a loop.
    type State<'a> = AncestorMemo<'a, bool>;

    fn new(_: &Options) -> Self {
        NoAwaitInLoop
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let loops = [StmtTag::For, StmtTag::ForIn, StmtTag::ForOf, StmtTag::While, StmtTag::DoWhile];
        file.has_stmts(loops).then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.validate(e.into(), cx);
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        if stmt.as_for_of().is_some_and(|(.., is_await)| is_await) {
            self.validate(stmt.into(), cx);
        }
    }

    /// The statement is validated with the first that it declares.
    #[inline]
    fn var_decl<'a>(&self, declaration: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if declaration.var_kind() == VarKind::AwaitUsing
            && let Node::Stmt(stmt) = declaration.parent()
            && stmt.as_var().and_then(|all| all.first()) == Some(declaration)
        {
            self.validate(stmt.into(), cx);
        }
    }
}
