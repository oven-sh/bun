use bun_lint::prelude::*;
use bun_lint::utils::oxlint::AmbientAncestors;
use rustc_hash::FxHashMap;

/// Require `var` declarations be placed at the top of their containing scope.
pub struct VarsOnTop;

const TOP: Message = Message::new(
    "top",
    "All 'var' declarations must be at the top of the function scope.",
);

fn looks_like_directive(statement: Stmt) -> bool {
    matches!(statement.kind(), StmtKind::Expr(e) if e.tag() == ExprTag::String)
}

/// Where the first of `statements` starts that is not a variable declaration, after the directives
/// and the imports if `skips_prologue`. `None` if it is not among the first `limit`.
fn end_of_top<'a>(statements: List<'a, Stmt<'a>>, skips_prologue: bool, limit: usize) -> Option<u32> {
    let mut is_in_prologue = skips_prologue;
    let mut statements = statements.iter();
    for statement in statements.by_ref().take(limit) {
        if is_in_prologue {
            if looks_like_directive(statement) || statement.tag() == StmtTag::Import {
                continue;
            }
            is_in_prologue = false;
        }
        if statement.tag() != StmtTag::Var {
            return Some(statement.span().start);
        }
    }
    statements.next().is_none().then_some(u32::MAX)
}

#[derive(Default)]
pub struct State<'a> {
    /// [`end_of_top`] of the bodies that start with many declarations, by what they are the body of.
    ends: FxHashMap<Node<'a>, u32>,
    ambient: AmbientAncestors<'a>,
}

/// Whether only variable declarations precede `node`, which is one of `statements`, the body of
/// `parent`.
fn is_var_on_top<'a>(
    node: Stmt<'a>,
    parent: Node<'a>,
    statements: List<'a, Stmt<'a>>,
    skips_prologue: bool,
    state: &mut State<'a>,
) -> bool {
    let end = end_of_top(statements, skips_prologue, 8).unwrap_or_else(|| {
        let all = || end_of_top(statements, skips_prologue, usize::MAX).unwrap_or(u32::MAX);
        *state.ends.entry(parent).or_insert_with(all)
    });
    node.span().start < end
}

impl Rule for VarsOnTop {
    const META: Meta = Meta::eslint("vars-on-top", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        VarsOnTop
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) -> State<'a> {
        on.stmts([StmtTag::Var], |_, statement, cx| {
            let StmtKind::Var(declarations) = statement.kind() else {
                return;
            };
            if declarations.first().is_none_or(|it| it.var_kind() != VarKind::Var) {
                return;
            }
            let parent = statement.parent();
            let is_on_top = match parent {
                Node::File(file) => is_var_on_top(statement, parent, file.body(), true, &mut cx.state),
                Node::Func(func) => func.body_statements().is_some_and(|body| {
                    let skips_prologue = func.kind() != FnKind::StaticBlock;
                    is_var_on_top(statement, parent, body, skips_prologue, &mut cx.state)
                }),
                // Only an `export` makes ESLint look at the body of a namespace.
                Node::Stmt(namespace) => match namespace.kind() {
                    StmtKind::Module(module) if statement.is_exported() => {
                        is_var_on_top(statement, parent, module.body(), true, &mut cx.state)
                    }
                    _ => false,
                },
                _ => false,
            };
            if is_on_top {
                return;
            }
            // oxlint says nothing about ambient declarations.
            if cx.language().is_oxlint && cx.state.ambient.has_ambient_typescript_ancestor(statement.into()) {
                return;
            }
            cx.report(statement, TOP);
        });
        State::default()
    }
}
