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

/// What oxlint says nothing about: what is declared in the head of a loop, or anywhere in a namespace.
fn oxlint_passes_over(decl: VarDecl<'_>) -> bool {
    let is_module = |it: Node| matches!(it, Node::Stmt(stmt) if stmt.tag() == StmtTag::Module);
    matches!(decl.parent().parent(), Node::Stmt(stmt) if stmt.is_loop()) || Node::VarDecl(decl).ancestors().any(is_module)
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
        let is_oxlint = cx.language().is_oxlint;
        // For oxc a declaration that gives a value writes nothing: `var a; var a = 1;`.
        let has_writes = symbol.has_writes()
            && (!is_oxlint || symbol.references().any(|it| it.is_write() && it.expr().is_some()));
        if !has_writes && symbol.has_reads() {
            // For oxc the `a` of the type `typeof a` is not read, nor is `React` by JSX.
            let is_read = |it: Reference| {
                it.is_read() && !it.is_jsx_pragma() && !it.expr().is_some_and(Expr::is_in_type_query)
            };
            if is_oxlint && (oxlint_passes_over(decl) || !symbol.references().any(is_read)) {
                return;
            }
            // oxlint points at the name, without its type.
            let place = if is_oxlint { decl.pat().span() } else { decl.span() };
            cx.report(place, UNASSIGNED).data("name", name);
        }
    }
}
