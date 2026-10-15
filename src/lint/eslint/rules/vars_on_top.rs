use bun_lint::prelude::*;
use bun_lint::utils::oxlint::AmbientAncestors;

/// Require `var` declarations be placed at the top of their containing scope.
pub struct VarsOnTop;

const TOP: Message = Message::new(
    "top",
    "All 'var' declarations must be at the top of the function scope.",
);

fn looks_like_directive(statement: Stmt) -> bool {
    matches!(statement.kind(), StmtKind::Expr(e) if e.tag() == ExprTag::String)
}

/// Whether only variable declarations precede `node`, which is one of `statements`, after the directives and the imports
/// if `skips_prologue`.
fn is_var_on_top<'a>(node: Stmt<'a>, statements: List<'a, Stmt<'a>>, skips_prologue: bool) -> bool {
    let mut is_in_prologue = skips_prologue;
    for statement in statements {
        if is_in_prologue {
            if looks_like_directive(statement) || statement.tag() == StmtTag::Import {
                continue;
            }
            is_in_prologue = false;
        }
        if statement.tag() != StmtTag::Var {
            return node.span().start < statement.span().start;
        }
    }
    true
}

impl Rule for VarsOnTop {
    const META: Meta = Meta::eslint("vars-on-top", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::Var]);
    type State<'a> = AmbientAncestors<'a>;

    fn new(_: &Options) -> Self {
        VarsOnTop
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(AmbientAncestors::default())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        // `const`, `let`
        if matches!(cx.text().get(statement.span().start as usize), Some(b'c' | b'l')) {
            return;
        }
        let Some(declarations) = statement.as_var() else {
            return;
        };
        if declarations.first().is_none_or(|it| it.var_kind() != VarKind::Var) {
            return;
        }
        let (parent, is_oxlint) = (statement.parent(), cx.language().is_oxlint);
        let is_on_top = match parent {
            Node::File(file) => is_var_on_top(statement, file.body(), true),
            Node::Func(func) => func.body_statements().is_some_and(|body| {
                let skips_prologue = func.kind() != FnKind::StaticBlock;
                is_var_on_top(statement, body, skips_prologue)
            }),
            // Only an `export` makes ESLint look at the body of a namespace.
            Node::Stmt(around) => match around.kind() {
                // oxlint says nothing about it.
                StmtKind::Module(_) if statement.is_exported() && is_oxlint => true,
                StmtKind::Module(module) if statement.is_exported() => {
                    is_var_on_top(statement, module.body(), true)
                }
                // For oxlint a block that is a statement of the body of a function has a top too.
                StmtKind::Block(body)
                    if is_oxlint
                        && matches!(around.parent(), Node::Func(func) if func.kind() != FnKind::StaticBlock) =>
                {
                    is_var_on_top(statement, body, true)
                }
                _ => false,
            },
            _ => false,
        };
        if is_on_top {
            return;
        }
        // oxlint says nothing about ambient declarations.
        if is_oxlint && cx.state.has_ambient_typescript_ancestor(statement.into()) {
            return;
        }
        cx.report(statement, TOP);
    }
}
