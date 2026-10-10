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
                    for specifier in export.items() {
                        check_declarations_in_scope(stmt, specifier.local().name(), cx);
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
    let Some(symbol) = Node::Stmt(export).scope().get_name(name).filter(|_| !cx.has_reported_too_much()) else {
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
