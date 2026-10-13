use bun_lint::prelude::*;
use smallvec::SmallVec;

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
    // oxlint compares a declaration with the first of the name, which is also where it points.
    if cx.language().is_oxlint {
        if let Some(first) = variable.declarations().next().filter(|it| is_unsafe_kind(*it))
            && let Some(place) = first.name_span()
        {
            cx.report(place, UNSAFE_MERGING).label(name, "");
        }
        return;
    }
    if variable.declarations().len() > 1 && variable.declarations().any(is_unsafe_kind) {
        cx.report(name, UNSAFE_MERGING)
            .hint("TypeScript does not check that the class sets what the interface declares.");
    }
}

impl Rule for NoUnsafeDeclarationMerging {
    const META: Meta = Meta::typescript("no-unsafe-declaration-merging", Kind::Problem).recommended().hints();
    const ON: On = On::new().stmts(&[StmtTag::Class, StmtTag::Interface]);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoUnsafeDeclarationMerging
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        // A class and an interface of one name.
        let classes = file.stmts_of_kind(StmtTag::Class).filter_map(|it| it.as_class()?.name());
        let classes: SmallVec<[Name<'a>; 8]> = classes.map(Ident::name).collect();
        let mut interfaces = file.stmts_of_kind(StmtTag::Interface).filter_map(Stmt::as_interface);
        interfaces.any(|it| classes.contains(&it.name().name())).then_some(())
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match statement.kind() {
            StmtKind::Class(class) => {
                // What merges with the class is in the scope around the scope of the class.
                if let Some(name) = class.name()
                    && let Some(scope) = class.scope().and_then(|it| it.parent())
                {
                    check_unsafe_declaration(scope, name, |it| matches!(it, Declaration::Interface(_)), cx);
                }
            }
            // Upstream looks in the scope of the interface. With type parameters that is its own, which
            // only declares those. oxlint looks around it.
            StmtKind::Interface(interface) => {
                let own = Node::Stmt(statement).scope();
                let scope = match interface.type_params().is_empty() {
                    true => Some(own),
                    false => own.parent().filter(|_| cx.language().is_oxlint),
                };
                if let Some(scope) = scope {
                    check_unsafe_declaration(scope, interface.name(), |it| matches!(it, Declaration::Class(_)), cx);
                }
            }
            _ => {}
        }
    }
}
