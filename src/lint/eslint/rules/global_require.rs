use bun_lint::prelude::*;

/// Require `require()` calls to be placed at top-level module scope.
pub struct GlobalRequire;

const UNEXPECTED: Message = Message::new("unexpected", "Unexpected require().");

/// ESLint's `ACCEPTABLE_PARENTS`.
fn is_acceptable_parent(node: Node<'_>) -> bool {
    match node {
        Node::File(_) | Node::VarDecl(_) => true,
        Node::Expr(e) => matches!(
            e.tag(),
            ExprTag::Assign | ExprTag::Dot | ExprTag::Index | ExprTag::Call | ExprTag::Cond
        ),
        Node::Stmt(statement) => match statement.tag() {
            StmtTag::Expr => true,
            StmtTag::Var => !statement.is_exported(),
            _ => false,
        },
        _ => false,
    }
}

/// ESLint's `isShadowed`.
fn is_shadowed(callee: Expr<'_>) -> bool {
    let symbol = callee.reference().and_then(Reference::symbol);
    symbol.is_some_and(|it| it.declarations().next().is_some())
}

impl Rule for GlobalRequire {
    const META: Meta = Meta::eslint("global-require", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        GlobalRequire
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.mentions("require") {
            return;
        }
        on.exprs([ExprTag::Call], |_, e, cx| {
            let Some(call) = e.as_call() else {
                return;
            };
            if call.callee().is_ident("require")
                && !Node::Expr(e).ancestors().all(is_acceptable_parent)
                && !is_shadowed(call.callee())
            {
                cx.report(e, UNEXPECTED);
            }
        });
    }
}
