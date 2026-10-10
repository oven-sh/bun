use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Require `require()` calls to be placed at top-level module scope.
pub struct GlobalRequire;

const GLOBAL_REQUIRE: Message = Message::new("", "Unexpected require().");

impl Rule for GlobalRequire {
    const META: Meta = Meta::oxlint(Plugin::Node, "global-require", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]);
    /// That something is in what a `require()` must not be in.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(_: &Options) -> Self {
        GlobalRequire
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        file.mentions("require").then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if let Some(callee) = e.callee().filter(|it| it.is_ident("require") && !it.is_parenthesized())
            && cx.state.find(Node::Expr(e), |child, parent| (!is_acceptable_parent(child, parent)).then_some(())).is_some()
            && callee.symbol().is_none()
        {
            cx.report(e, GLOBAL_REQUIRE);
        }
    }
}

fn is_acceptable_parent(child: Node, parent: Node) -> bool {
    // oxc has a node for parentheses and one around an optional chain.
    if matches!(child, Node::Expr(e) if e.is_parenthesized() || e.is_chain_root()) {
        return false;
    }
    match parent {
        Node::Expr(e) => matches!(e.tag(), ExprTag::Assign | ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::Cond),
        Node::VarDecl(declarator) => matches!(declarator.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Var),
        Node::Stmt(stmt) => stmt.tag() == StmtTag::Expr || stmt.tag() == StmtTag::Var && !stmt.is_exported(),
        Node::File(_) => true,
        _ => false,
    }
}
