use bun_lint::prelude::*;

/// Require `var` declarations be placed at the top of their containing scope.
pub struct VarsOnTop;

const TOP: Message = Message::new(
    "top",
    "All 'var' declarations must be at the top of the function scope.",
);

fn looks_like_directive(statement: Stmt) -> bool {
    matches!(statement.kind(), StmtKind::Expr(e) if e.tag() == ExprTag::String)
}

/// Whether only variable declarations precede `node` in `statements`, after the directives and
/// the imports if `skips_prologue`.
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
            return false;
        }
        if statement == node {
            return true;
        }
    }
    false
}

impl Rule for VarsOnTop {
    const META: Meta = Meta::eslint("vars-on-top", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        VarsOnTop
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Var], |_, statement, cx| {
            let StmtKind::Var(declarations) = statement.kind() else {
                return;
            };
            if declarations.first().is_none_or(|it| it.var_kind() != VarKind::Var) {
                return;
            }
            let is_on_top = match statement.parent() {
                Node::File(file) => is_var_on_top(statement, file.body(), true),
                Node::Func(func) => func.body_statements().is_some_and(|body| {
                    is_var_on_top(statement, body, func.kind() != FnKind::StaticBlock)
                }),
                // Only an `export` makes ESLint look at the body of a namespace.
                Node::Stmt(parent) => match parent.kind() {
                    StmtKind::Module(module) if statement.is_exported() => {
                        is_var_on_top(statement, module.body(), true)
                    }
                    _ => false,
                },
                _ => false,
            };
            if !is_on_top {
                cx.report(statement, TOP);
            }
        });
    }
}
