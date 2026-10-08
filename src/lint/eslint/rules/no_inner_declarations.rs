use bun_lint::prelude::*;

/// Disallow variable or `function` declarations in nested blocks.
pub struct NoInnerDeclarations {
    is_both: bool,
    allows_block_scoped_functions: bool,
}

const MOVE_DECL_TO_ROOT: Message =
    Message::new("moveDeclToRoot", "Move {{type}} declaration to {{body}} root.");

/// It is directly in the file, in the body of a function or in a static block, or it is exported.
fn is_at_root(statement: Stmt) -> bool {
    matches!(statement.parent(), Node::File(_) | Node::Func(_)) || statement.is_exported()
}

/// ESLint's `getAllowedBodyDescription`.
fn get_allowed_body_description(statement: Stmt) -> &'static str {
    match Node::Stmt(statement).enclosing_function().map(Func::kind) {
        Some(FnKind::StaticBlock) => "class static block body",
        Some(_) => "function body",
        None => "program",
    }
}

impl Rule for NoInnerDeclarations {
    const META: Meta = Meta::eslint("no-inner-declarations", Kind::Problem);
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        NoInnerDeclarations {
            is_both: options.str(0) == Some("both"),
            allows_block_scoped_functions: options.object(1).str("blockScopedFunctions") != Some("disallow"),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Fn], |rule, statement, cx| {
            let StmtKind::Fn(func) = statement.kind() else {
                return;
            };
            if !func.has_body() || is_at_root(statement) {
                return;
            }
            if rule.allows_block_scoped_functions
                && cx.language().ecma_version >= 2015
                && func.scope().and_then(Scope::parent).is_some_and(Scope::is_strict)
            {
                return;
            }
            cx.report(statement, MOVE_DECL_TO_ROOT)
                .data("type", "function")
                .data("body", get_allowed_body_description(statement));
        });
        if self.is_both {
            on.stmts([StmtTag::Var], |_, statement, cx| {
                let StmtKind::Var(declarations) = statement.kind() else {
                    return;
                };
                if declarations.first().is_some_and(|it| it.var_kind() == VarKind::Var) && !is_at_root(statement) {
                    cx.report(statement, MOVE_DECL_TO_ROOT)
                        .data("type", "variable")
                        .data("body", get_allowed_body_description(statement));
                }
            });
        }
    }
}
