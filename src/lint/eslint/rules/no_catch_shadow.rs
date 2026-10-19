use bun_lint::prelude::*;
use bun_lint::utils::ast_utils::is_configured_global;
use rustc_hash::FxHashSet;

/// Disallow `catch` clause parameters from shadowing variables in the outer scope.
pub struct NoCatchShadow;

const MUTABLE: Message =
    Message::new("mutable", "Value of '{{name}}' may be overwritten in IE 8 and earlier.");

/// ESLint's `getVariableByName(scope, name) !== null`, where `scope` is the scope that contains `stmt`. That also finds
/// things that aren't a scope's `Symbol` here: the name of an enclosing function or class expression, a function's
/// `arguments`, and the config's global variables.
fn is_declared_in_enclosing_scope<'a>(stmt: Stmt<'a>, name: Name<'a>, cx: &mut Cx<'a, NoCatchShadow>) -> bool {
    let scope = Node::Stmt(stmt).scope();
    if scope.resolve_name(name).is_some() {
        return true;
    }
    let file = cx.file();
    let names = cx.state.get_or_insert_with(|| {
        let functions = file.funcs().filter_map(Func::name);
        functions.chain(file.classes().filter_map(Class::name)).map(Ident::name).collect()
    });
    let is_arguments = name.is("arguments");
    // Every function and class around a statement has a scope.
    (is_arguments || names.contains(&name))
        && scope.chain().any(|it| match it.node() {
            Node::Func(func) => {
                func.name().is_some_and(|it| it.name() == name)
                    || is_arguments && !func.is_arrow() && func.kind() != FnKind::StaticBlock
            }
            Node::Class(class) => class.name().is_some_and(|it| it.name() == name),
            _ => false,
        })
        || is_configured_global(file, name.bytes())
}

impl Rule for NoCatchShadow {
    const META: Meta = Meta::eslint("no-catch-shadow", Kind::Suggestion).deprecated();
    const ON: On = On::new().stmts(&[StmtTag::Try]);
    /// The names of the file's functions and classes, built when first needed.
    type State<'a> = Option<FxHashSet<Name<'a>>>;

    fn new(_: &Options) -> Self {
        NoCatchShadow
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(None)
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Try {
            param: Some(param), ..
        } = stmt.kind()
        else {
            return;
        };
        if let Some(name) = param.pat().as_ident()
            && is_declared_in_enclosing_scope(stmt, name, cx)
            && let Some(clause) = stmt.catch_clause_span()
        {
            cx.report(clause, MUTABLE).data("name", name);
        }
    }
}
