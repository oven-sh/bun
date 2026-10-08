use bun_lint::prelude::*;

/// Disallow function declarations that contain unsafe references inside loop statements.
pub struct NoLoopFunc;

const UNSAFE_REFS: Message = Message::new(
    "unsafeRefs",
    "Function declared in a loop contains unsafe references to variable(s) {{ varNames }}.",
);

/// Whose rule it is. That of typescript-eslint takes every reference in a type for safe, and names
/// a variable once for each reference.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Dialect {
    Eslint,
    TypeScript,
}

/// ESLint's `isIIFE`.
fn is_iife(func: Func) -> bool {
    let Node::Expr(e) = func.owner() else {
        return false;
    };
    matches!(func.kind(), FnKind::Expr | FnKind::Arrow)
        && matches!(e.parent(), Node::Expr(parent) if parent.as_call().is_some_and(|call| call.callee() == e))
}

/// Whether `func`, which is in a loop, is among ESLint's `SKIPPED_IIFE_NODES`: it is called where
/// it is written and nowhere else, so what is in it is in the loop.
fn is_skipped_iife(func: Func) -> bool {
    if func.is_async() || func.is_generator() || !is_iife(func) {
        return false;
    }
    match (func.name(), func.scope()) {
        (Some(name), Some(scope)) => !scope.through().any(|it| it.name() == name.name()),
        _ => true,
    }
}

/// ESLint's `getContainingLoopNode`.
fn get_containing_loop_node(node: Node<'_>) -> Option<Stmt<'_>> {
    let mut current = node;
    for parent in node.ancestors() {
        match parent {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::While { .. } | StmtKind::DoWhile { .. } => return Some(statement),
                // `init` is outside of the loop.
                StmtKind::For { init, .. } => {
                    let is_init = init.is_some_and(|init| match init.kind() {
                        StmtKind::Expr(e) => current == Node::Expr(e),
                        _ => current == Node::Stmt(init),
                    });
                    if !is_init {
                        return Some(statement);
                    }
                }
                // `right` is outside of the loop.
                StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => {
                    if current != Node::Expr(expr) {
                        return Some(statement);
                    }
                }
                _ => {}
            },
            Node::Func(func) if ast_utils::is_function_with_body(func) && !is_skipped_iife(func) => {
                return None;
            }
            _ => {}
        }
        current = parent;
    }
    None
}

/// ESLint's `getTopLoopNode`: the outermost of the loops around `node`, and `node` itself, that
/// start at `border` or after it.
fn get_top_loop_node(node: Stmt<'_>, border: u32) -> Stmt<'_> {
    let mut top = node;
    let mut containing = Some(node);
    while let Some(it) = containing
        && it.span().start >= border
    {
        top = it;
        containing = get_containing_loop_node(it.into());
    }
    top
}

/// Whether one of `references`, which are all those to a variable of `variable_scope`, can modify
/// it between the iterations of the loop: it is in another function, or not before the loop.
fn has_unsafe_write<'a>(
    references: impl Iterator<Item = Reference<'a>>,
    variable_scope: Scope<'a>,
    loop_node: Stmt<'a>,
    excluded_end: u32,
) -> bool {
    let mut border = None;
    references.filter(|it| it.is_write()).any(|it| {
        it.scope().variable_scope() != variable_scope
            || it.ident().start()
                >= *border.get_or_insert_with(|| get_top_loop_node(loop_node, excluded_end).span().start)
    })
}

/// It resolves to something, and ESLint's `isSafe` does not hold.
fn is_unsafe<'a>(loop_node: Stmt<'a>, reference: Reference<'a>, dialect: Dialect) -> bool {
    if dialect == Dialect::TypeScript && reference.is_type() {
        return false;
    }
    let Some(variable) = reference.symbol() else {
        let (file, name) = (loop_node.file(), reference.name().bytes());
        return has_unsafe_write(file.unresolved_references_to(name), file.scope(), loop_node, 0)
            && file.global(name).is_some_and(|it| it.accepts(reference.is_type()));
    };
    let declaration = match variable.declarations().next().and_then(Declaration::parent) {
        Some(Node::Stmt(statement)) => match statement.kind() {
            StmtKind::Var(declarations) => {
                declarations.first().map(|it| (it.var_kind(), statement.span_without_export()))
            }
            _ => None,
        },
        _ => None,
    };
    let excluded_end = match declaration {
        Some((VarKind::Const | VarKind::Using | VarKind::AwaitUsing, _)) => return false,
        Some((VarKind::Let, declaration)) => {
            // It is a different instance in each iteration.
            let whole = loop_node.span();
            if declaration.start > whole.start && declaration.end < whole.end {
                return false;
            }
            declaration.end
        }
        _ => 0,
    };
    has_unsafe_write(
        variable.references(),
        variable.scope().variable_scope(),
        loop_node,
        excluded_end,
    )
}

/// Whether there is anything to check in `file`.
pub fn has_loops(file: &File) -> bool {
    file.has_stmts([
        StmtTag::For,
        StmtTag::ForIn,
        StmtTag::ForOf,
        StmtTag::While,
        StmtTag::DoWhile,
    ])
}

/// ESLint's `checkForLoops`.
pub fn check<'a, R: Rule>(func: Func<'a>, dialect: Dialect, cx: &Cx<'a, R>) {
    if !ast_utils::is_function_with_body(func) {
        return;
    }
    let Some(loop_node) = get_containing_loop_node(func.into()) else {
        return;
    };
    if is_skipped_iife(func) {
        return;
    }
    let Some(scope) = func.scope() else {
        return;
    };
    let mut unsafe_refs: Vec<Reference<'a>> =
        scope.through().filter(|it| is_unsafe(loop_node, *it, dialect)).collect();
    if unsafe_refs.is_empty() {
        return;
    }
    unsafe_refs.sort_by_key(|it| it.ident().start());
    let mut names: Vec<Name<'a>> = Vec::new();
    for name in unsafe_refs.iter().map(|it| it.name()) {
        if dialect == Dialect::TypeScript || !names.contains(&name) {
            names.push(name);
        }
    }
    let mut var_names = Vec::new();
    for name in names {
        let separator: &[u8] = if var_names.is_empty() { b"'" } else { b"', '" };
        var_names.extend_from_slice(separator);
        var_names.extend_from_slice(name.bytes());
    }
    var_names.push(b'\'');
    cx.report(func.estree_span(), UNSAFE_REFS).data("varNames", var_names);
}

impl Rule for NoLoopFunc {
    const META: Meta = Meta::eslint("no-loop-func", Kind::Suggestion);
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoLoopFunc
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) {
        if has_loops(file) {
            on.funcs(|_, func, cx| check(func, Dialect::Eslint, cx));
        }
    }
}
