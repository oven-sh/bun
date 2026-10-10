use bun_lint::prelude::*;
use bun_lint::semantic::DeclarationKinds;

/// Disallow assigning to imported bindings.
pub struct NoImportAssign;

const READONLY: Message = Message::new("readonly", "'{{name}}' is read-only.");
const READONLY_MEMBER: Message =
    Message::new("readonlyMember", "The members of '{{name}}' are read-only.");

/// ESLint's `isOperandOfMutationUnaryOperator`.
fn is_operand_of_mutation_unary_operator(e: Expr) -> bool {
    matches!(e.parent(), Node::Expr(parent) if matches!(
        parent.kind(),
        ExprKind::Unary {
            op: UnOp::PreInc | UnOp::PreDec | UnOp::PostInc | UnOp::PostDec | UnOp::Delete,
            ..
        }
    ))
}

/// ESLint's `isArgumentOfWellKnownMutationFunction`.
fn is_argument_of_well_known_mutation_function(id: Expr) -> bool {
    let Node::Expr(parent) = id.parent() else {
        return false;
    };
    let ExprKind::Call(call) = parent.kind() else {
        return false;
    };
    if call.args().first() != Some(id) {
        return false;
    }
    let callee = call.callee();
    let Some(object_node) = ast_utils::member_object(callee) else {
        return false;
    };
    let Some(object) = object_node.as_ident() else {
        return false;
    };
    let Some(property) = ast_utils::get_static_property_name(callee) else {
        return false;
    };
    let is_well_known = match object.bytes() {
        b"Object" => matches!(
            &*property,
            b"assign" | b"defineProperty" | b"defineProperties" | b"freeze" | b"setPrototypeOf"
        ),
        b"Reflect" => {
            matches!(&*property, b"defineProperty" | b"deleteProperty" | b"set" | b"setPrototypeOf")
        }
        _ => false,
    };
    is_well_known
        && match Node::Expr(object_node).scope().resolve_name(object) {
            Some(variable) => variable.scope().kind() == ScopeKind::Global,
            None => ast_utils::is_configured_global(id.file(), object.bytes()),
        }
}

/// ESLint's `isMemberWrite`.
fn is_member_write(id: Expr) -> bool {
    matches!(id.parent(), Node::Expr(parent)
        if ast_utils::member_object(parent) == Some(id)
            && (utils::is_assignment_target(parent) || is_operand_of_mutation_unary_operator(parent)))
        || is_argument_of_well_known_mutation_function(id)
}

/// ESLint's `getWriteNode`.
fn get_write_node(reference: Reference) -> Span {
    for node in reference.node().ancestors() {
        match node {
            Node::Expr(e) => match e.tag() {
                ExprTag::Unary | ExprTag::Call => return e.span(),
                // Not the default value in a pattern.
                ExprTag::Assign if !utils::is_assignment_target(e) => return e.span(),
                _ => {}
            },
            Node::Stmt(s) if matches!(s.tag(), StmtTag::ForIn | StmtTag::ForOf) => return s.span(),
            _ => {}
        }
    }
    // `import type { A } from "a"; const A: A = 0`: the annotation is a part of the `Identifier`.
    match reference.node() {
        id @ Node::Pat(_) => utils::estree_span(id),
        _ => reference.span(),
    }
}

/// oxlint points at the name, or at the member that is written to.
fn oxlint_place(reference: Reference) -> Span {
    let id = reference.expr().filter(|_| !reference.is_write());
    match id.map(Expr::parent) {
        Some(Node::Expr(parent)) if ast_utils::member_object(parent) == id => parent.span(),
        _ => reference.span(),
    }
}

impl Rule for NoImportAssign {
    const META: Meta = Meta::eslint("no-import-assign", Kind::Problem).recommended();
    const ON: On = On::new().stmts(&[StmtTag::Import]);
    /// Whether an import that is not of a namespace can have something to report: something is assigned to what one imports,
    /// or declared several times. Found out for the first import.
    type State<'a> = Option<bool>;

    fn new(_: &Options) -> Self {
        NoImportAssign
    }

    fn start<'a>(&self, _: &'a File<'a>) -> Option<Option<bool>> {
        Some(None)
    }

    fn stmt<'a>(&self, stmt: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let file = cx.file();
        let looks_at_all = *cx.state.get_or_insert_with(|| {
            let mut imported = file.symbols_declared_as(DeclarationKinds::IMPORT_BINDING);
            imported.any(|it| it.has_writes() || it.declaration_count() > 1)
        });
        if !looks_at_all && !matches!(stmt.kind(), StmtKind::Import(import) if import.namespace().is_some()) {
            return;
        }
        for variable in Node::Stmt(stmt).declared_symbols() {
            let should_check_members =
                variable.declarations().any(|it| matches!(it, Declaration::ImportNamespace(_)));
            if !should_check_members && !variable.has_writes() {
                continue;
            }
            // `[a = 0] = b` writes to `a` twice.
            let mut previous = None;
            let is_oxlint = cx.language().is_oxlint;
            for reference in variable.references() {
                if previous.replace(reference.span()) == Some(reference.span()) {
                    continue;
                }
                // `import type { A } from "a"; const A = 0`: for oxlint a declaration assigns nothing.
                if is_oxlint && reference.is_init() {
                    continue;
                }
                let message = if reference.is_write() {
                    READONLY
                } else if should_check_members && reference.expr().is_some_and(is_member_write) {
                    READONLY_MEMBER
                } else {
                    continue;
                };
                let place = if is_oxlint { oxlint_place(reference) } else { get_write_node(reference) };
                cx.report(place, message).data("name", reference.name());
            }
        }
    }
}
