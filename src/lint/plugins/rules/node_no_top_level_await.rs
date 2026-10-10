use bun_lint_oxlint::import::is_script;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallow top-level `await` in modules.
pub struct NoTopLevelAwait {
    ignore_bin: bool,
}

const NO_TOP_LEVEL_AWAIT: Message =
    Message::new("", "Top-level `await` prevents this module from being loaded with `require(esm)`.");

impl Rule for NoTopLevelAwait {
    const META: Meta = Meta::oxlint(Plugin::Node, "no-top-level-await", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Await]).stmts(&[StmtTag::ForOf, StmtTag::Var]);
    /// That something is in a function.
    type State<'a> = AncestorMemo<'a, ()>;

    fn new(options: &Options) -> Self {
        NoTopLevelAwait { ignore_bin: options.object(0).bool_or("ignoreBin", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (!(self.ignore_bin && file.text().starts_with(b"#!")) && !is_script(file)).then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        check(Node::Expr(e), cx);
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::ForOf => {
                if matches!(stmt.kind(), StmtKind::ForOf { is_await: true, .. }) {
                    check(Node::Stmt(stmt), cx);
                }
            }
            StmtTag::Var => {
                if matches!(stmt.kind(), StmtKind::Var(declarations)
                    if declarations.first().is_some_and(|it| it.var_kind() == VarKind::AwaitUsing))
                {
                    check(Node::Stmt(stmt), cx);
                }
            }
            _ => {}
        }
    }
}

fn check<'a>(node: Node<'a>, cx: &mut Cx<'a, NoTopLevelAwait>) {
    let is_function = |it: Node| matches!(it, Node::Func(func) if func.kind() != FnKind::StaticBlock);
    if cx.state.find(node, |_, parent| is_function(parent).then_some(())).is_none() {
        cx.report(node, NO_TOP_LEVEL_AWAIT);
    }
}
