use bun_lint::prelude::*;

/// Disallow unsafe declaration merging.
pub struct NoUnsafeDeclarationMerging;

const UNSAFE_MERGING: Message =
    Message::new("unsafeMerging", "Unsafe declaration merging between classes and interfaces.");

fn check_unsafe_declaration<'a>(
    scope: Scope<'a>,
    name: Ident<'a>,
    is_unsafe_kind: fn(Declaration<'a>) -> bool,
    cx: &Cx<'a, NoUnsafeDeclarationMerging>,
) {
    let Some(variable) = scope.get_name(name.name()) else {
        return;
    };
    if variable.declarations().len() > 1 && variable.declarations().any(is_unsafe_kind) {
        cx.report(name, UNSAFE_MERGING);
    }
}

impl Rule for NoUnsafeDeclarationMerging {
    const META: Meta = Meta::typescript("no-unsafe-declaration-merging", Kind::Problem).recommended();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnsafeDeclarationMerging
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if !file.has_stmts([StmtTag::Class]) || !file.has_stmts([StmtTag::Interface]) {
            return;
        }
        on.stmts([StmtTag::Class, StmtTag::Interface], |_, statement, cx| match statement.kind() {
            StmtKind::Class(class) => {
                // What merges with the class is in the scope around the scope of the class.
                if let Some(name) = class.name()
                    && let Some(scope) = class.scope().and_then(|it| it.parent())
                {
                    check_unsafe_declaration(scope, name, |it| matches!(it, Declaration::Interface(_)), cx);
                }
            }
            // Upstream looks in the scope of the interface. With type parameters that is its own, which
            // only declares those.
            StmtKind::Interface(interface) if interface.type_params().is_empty() => check_unsafe_declaration(
                Node::Stmt(statement).scope(),
                interface.name(),
                |it| matches!(it, Declaration::Class(_)),
                cx,
            ),
            _ => {}
        });
    }
}
