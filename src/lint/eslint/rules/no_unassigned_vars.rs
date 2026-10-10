use bun_lint::prelude::*;

/// Disallow `let` or `var` variables that are read but never assigned.
pub struct NoUnassignedVars;

const UNASSIGNED: Message = Message::new(
    "unassigned",
    "'{{name}}' is always 'undefined' because it's never assigned.",
);

/// The statement has the modifier `declare`, or it is in a namespace that has.
fn is_declared(decl: VarDecl<'_>) -> bool {
    // In a declaration file everything has the flag.
    decl.flags().contains(Flags::AMBIENT)
        && (!decl.file().is_declaration_file()
            || Node::VarDecl(decl).ancestors().any(|ancestor| match ancestor {
                Node::Stmt(stmt) => {
                    matches!(stmt.tag(), StmtTag::Var | StmtTag::Module) && stmt.flags().contains(Flags::AMBIENT)
                }
                _ => false,
            }))
}

impl Rule for NoUnassignedVars {
    const META: Meta = Meta::eslint("no-unassigned-vars", Kind::Problem).recommended();
    const ON: On = On::new().var_decls();
    no_state!();

    fn new(_: &Options) -> Self {
        NoUnassignedVars
    }

    fn var_decl<'a>(&self, decl: VarDecl<'a>, cx: &mut Cx<'a, Self>) {
        if decl.init().is_some() || decl.var_kind() == VarKind::Const {
            return;
        }
        let Some(name) = decl.pat().as_ident() else {
            return;
        };
        // Otherwise it is the parameter of a `catch`.
        let is_declarator = matches!(decl.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Var);
        if !is_declarator || is_declared(decl) {
            return;
        }
        let Some(symbol) = decl.pat().symbol() else {
            return;
        };
        if !symbol.has_writes() && symbol.has_reads() {
            // oxlint points at the name, without its type.
            let place = if cx.language().is_oxlint { decl.pat().span() } else { decl.span() };
            cx.report(place, UNASSIGNED).data("name", name);
        }
    }
}
