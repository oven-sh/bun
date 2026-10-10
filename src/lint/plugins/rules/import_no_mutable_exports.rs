use bun_lint::prelude::*;
use bun_lint::rule::Plugin;

/// Forbid the use of mutable exports with `var` or `let`.
pub struct NoMutableExports;

const MUTABLE: Message = Message::new("", "Exporting mutable '{{kind}}' binding, use 'const' instead.");

impl Rule for NoMutableExports {
    const META: Meta = Meta::plugin(Plugin::Import, "no-mutable-exports", Kind::Suggestion);
    const ON: On = On::new().stmts(&[StmtTag::Var, StmtTag::ExportDefault, StmtTag::ExportNamed]);
    no_state!();

    fn new(_: &Options) -> Self {
        NoMutableExports
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        match stmt.tag() {
            StmtTag::Var => {
                if stmt.is_exported() {
                    check_declaration(stmt, cx);
                }
            }
            StmtTag::ExportDefault => {
                if let StmtKind::ExportDefault(e) = stmt.kind()
                    && let Some(name) = e.as_ident()
                {
                    check_declarations_in_scope(stmt, name, cx);
                }
            }
            StmtTag::ExportNamed => {
                if let StmtKind::ExportNamed(export) = stmt.kind()
                    && !export.has_from()
                {
                    // For oxlint the name in `export { type a }` and in `export type { a }` refers to a type.
                    let is_oxlint = cx.file().language().is_oxlint;
                    for specifier in export.items() {
                        if !(is_oxlint && (export.is_type_only() || specifier.is_type_only())) {
                            check_declarations_in_scope(stmt, specifier.local().name(), cx);
                        }
                    }
                }
            }
            _ => {}
        }
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
