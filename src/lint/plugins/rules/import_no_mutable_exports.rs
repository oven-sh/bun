use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid the use of mutable exports with `var` or `let`.
pub struct NoMutableExports;

const MUTABLE: Message = Message::new("", "Exporting mutable '{{kind}}' binding, use 'const' instead.");

impl Rule for NoMutableExports {
    const META: Meta = Meta::plugin(Plugin::Import, "no-mutable-exports", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoMutableExports
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, _: &'a File<'a>) {
        on.stmts([StmtTag::Var], |_, stmt, cx| {
            if stmt.is_exported() {
                check_declaration(stmt, cx);
            }
        });
        on.stmts([StmtTag::ExportDefault], |_, stmt, cx| {
            if let StmtKind::ExportDefault(e) = stmt.kind()
                && let Some(name) = e.as_ident()
            {
                check_declarations_in_scope(stmt, name, cx);
            }
        });
        on.stmts([StmtTag::ExportNamed], |_, stmt, cx| {
            if let StmtKind::ExportNamed(export) = stmt.kind()
                && !export.has_from()
            {
                for specifier in export.items() {
                    check_declarations_in_scope(stmt, specifier.local().name(), cx);
                }
            }
        });
    }
}

fn check_declaration<'a>(declaration: Stmt<'a>, cx: &Cx<'a, NoMutableExports>) {
    let StmtKind::Var(declarators) = declaration.kind() else {
        return;
    };
    let kind = match declarators.first().map(VarDecl::var_kind) {
        Some(VarKind::Var) => "var",
        Some(VarKind::Let) => "let",
        _ => return,
    };
    cx.report(declaration.span_without_export(), MUTABLE).data("kind", kind);
}

fn check_declarations_in_scope<'a>(export: Stmt<'a>, name: Name<'a>, cx: &Cx<'a, NoMutableExports>) {
    let Some(symbol) = Node::Stmt(export).scope().get_name(name) else {
        return;
    };
    for declaration in symbol.declarations() {
        if declaration.kind() == Some(DeclarationKind::Variable)
            && let Some(Node::Stmt(parent)) = declaration.parent()
        {
            check_declaration(parent, cx);
        }
    }
}
