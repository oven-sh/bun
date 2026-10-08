use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::is_configured_global;

/// Disallow `catch` clause parameters from shadowing variables in the outer scope.
pub struct NoCatchShadow;

const MUTABLE: Message =
    Message::new("mutable", "Value of '{{name}}' may be overwritten in IE 8 and earlier.");

/// ESLint's `getVariableByName(scope, name) !== null`, where `scope` is the one `stmt` is in. That
/// also finds what is not a `Symbol` of a scope here: the name of a function or class expression
/// inside it, the `arguments` of a function, the global variables of the configuration.
fn is_declared_around<'a>(stmt: Stmt<'a>, name: Name<'a>) -> bool {
    let node = Node::Stmt(stmt);
    let is_arguments = name.is("arguments");
    node.scope().chain().any(|scope| scope.symbols().any(|symbol| symbol.name() == name))
        || node.ancestors().any(|it| match it {
            Node::Func(func) => {
                func.name().is_some_and(|it| it.name() == name)
                    || is_arguments && !func.is_arrow() && func.kind() != FnKind::StaticBlock
            }
            Node::Class(class) => class.name().is_some_and(|it| it.name() == name),
            _ => false,
        })
        || is_configured_global(stmt.file(), name.bytes())
}

impl Rule for NoCatchShadow {
    const META: Meta = Meta::eslint("no-catch-shadow", Kind::Suggestion).deprecated();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoCatchShadow
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Try], |_, stmt, cx| {
            let StmtKind::Try {
                param: Some(param), ..
            } = stmt.kind()
            else {
                return;
            };
            if let Some(name) = param.pat().as_ident()
                && is_declared_around(stmt, name)
                && let Some(clause) = stmt.catch_clause_span()
            {
                cx.report(clause, MUTABLE).data("name", name);
            }
        });
    }
}
