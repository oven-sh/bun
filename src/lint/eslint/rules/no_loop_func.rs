use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::{FxHashMap, FxHashSet};

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

/// Where a variable is written to.
#[derive(Copy, Clone)]
struct Writes {
    /// In another function than the one that it is a variable of.
    is_in_other_function: bool,
    /// Where the last one starts.
    last: Option<u32>,
}

impl Writes {
    /// `references`: all those to a variable of `variable_scope`.
    fn among<'a>(references: impl Iterator<Item = Reference<'a>>, variable_scope: Scope<'a>) -> Writes {
        let mut writes = Writes {
            is_in_other_function: false,
            last: None,
        };
        for reference in references.filter(|it| it.is_write()) {
            writes.is_in_other_function |= reference.scope().variable_scope() != variable_scope;
            writes.last = writes.last.max(Some(reference.ident().start()));
        }
        writes
    }
}

/// What has been found out about a file.
#[derive(Default)]
pub struct Known<'a> {
    /// ESLint's `getContainingLoopNode`.
    containing_loops: AncestorMemo<'a, Option<Stmt<'a>>>,
    writes_to_variables: FxHashMap<usize, Writes>,
    writes_to_globals: FxHashMap<Name<'a>, Writes>,
    /// [`Known::is_written_in_top_loop`], by its arguments, for the loops that are far up from where it was asked.
    is_written_in_top_loop: FxHashMap<(Stmt<'a>, u32, u32), bool>,
    /// Where the functions start that are reported as oxlint does.
    reported_as_oxlint: FxHashSet<u32>,
}

impl<'a> Known<'a> {
    /// ESLint's `getContainingLoopNode`.
    fn get_containing_loop_node(&mut self, node: Node<'a>) -> Option<Stmt<'a>> {
        let found = self.containing_loops.find(node, |current, parent| match parent {
            Node::Stmt(statement) => match statement.kind() {
                StmtKind::While { .. } | StmtKind::DoWhile { .. } => Some(Some(statement)),
                // `init` is outside of the loop.
                StmtKind::For { init, .. } => {
                    let is_init = init.is_some_and(|init| match init.kind() {
                        StmtKind::Expr(e) => current == Node::Expr(e),
                        _ => current == Node::Stmt(init),
                    });
                    (!is_init).then_some(Some(statement))
                }
                // `right` is outside of the loop.
                StmtKind::ForIn { expr, .. } | StmtKind::ForOf { expr, .. } => {
                    (current != Node::Expr(expr)).then_some(Some(statement))
                }
                _ => None,
            },
            Node::Func(func) if ast_utils::is_function_with_body(func) && !is_skipped_iife(func) => Some(None),
            _ => None,
        });
        found.flatten()
    }

    /// Whether `last` is not before ESLint's `getTopLoopNode`: the outermost of the loops around `node`, and `node` itself, that
    /// start at `border` or after it.
    fn is_written_in_top_loop(&mut self, node: Stmt<'a>, border: u32, last: u32) -> bool {
        /// So far out nothing is remembered.
        const PLAIN_STEPS: usize = 4;
        let outer = |known: &mut Self, it: Stmt<'a>| {
            known.get_containing_loop_node(it.into()).filter(|outer| outer.span().start >= border)
        };
        let (mut at, mut steps) = (node, 0);
        let answer = loop {
            if at.span().start <= last {
                break true;
            }
            if steps >= PLAIN_STEPS
                && let Some(&known) = self.is_written_in_top_loop.get(&(at, border, last))
            {
                break known;
            }
            match outer(self, at) {
                Some(outer) => at = outer,
                None => break false,
            }
            steps += 1;
        };
        let mut passed = Some(node);
        for step in 0..steps {
            let Some(it) = passed.filter(|_| steps > PLAIN_STEPS) else {
                break;
            };
            if step >= PLAIN_STEPS {
                self.is_written_in_top_loop.insert((it, border, last), answer);
            }
            passed = outer(self, it);
        }
        answer
    }

    /// Whether one of the `writes` to a variable can modify it between the iterations of the loop: it is in another function, or
    /// not before the loop.
    fn has_unsafe_write(&mut self, writes: Writes, loop_node: Stmt<'a>, excluded_end: u32) -> bool {
        writes.is_in_other_function
            || writes.last.is_some_and(|last| self.is_written_in_top_loop(loop_node, excluded_end, last))
    }
}

/// It resolves to something, and ESLint's `isSafe` does not hold.
fn is_unsafe<'a>(loop_node: Stmt<'a>, reference: Reference<'a>, dialect: Dialect, known: &mut Known<'a>) -> bool {
    if dialect == Dialect::TypeScript && reference.is_type() {
        return false;
    }
    let Some(variable) = reference.symbol() else {
        let (file, name) = (loop_node.file(), reference.name());
        if !file.global(name.bytes()).is_some_and(|it| it.accepts(reference.is_type())) {
            return false;
        }
        let writes = *(known.writes_to_globals.entry(name))
            .or_insert_with(|| Writes::among(file.unresolved_references_to(name.bytes()), file.scope()));
        return known.has_unsafe_write(writes, loop_node, 0);
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
    let writes = *(known.writes_to_variables.entry(variable.key()))
        .or_insert_with(|| Writes::among(variable.references(), variable.scope().variable_scope()));
    known.has_unsafe_write(writes, loop_node, excluded_end)
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
pub fn check<'a, R: Rule<State<'a> = Known<'a>>>(func: Func<'a>, dialect: Dialect, cx: &mut Cx<'a, R>) {
    if !ast_utils::is_function_with_body(func) {
        return;
    }
    let known = &mut cx.state;
    let Some(loop_node) = known.get_containing_loop_node(func.into()) else {
        return;
    };
    if is_skipped_iife(func) {
        return;
    }
    let Some(scope) = func.scope() else {
        return;
    };
    let mut unsafe_refs: Vec<Reference<'a>> =
        scope.through().filter(|it| is_unsafe(loop_node, *it, dialect, known)).collect();
    if unsafe_refs.is_empty() {
        return;
    }
    unsafe_refs.sort_by_key(|it| it.ident().start());
    let mut named = FxHashSet::default();
    let names = unsafe_refs.iter().map(|it| it.name());
    let mut var_names = Vec::new();
    for name in names.filter(|name| dialect == Dialect::TypeScript || named.insert(*name)) {
        let separator: &[u8] = if var_names.is_empty() { b"'" } else { b"', '" };
        var_names.extend_from_slice(separator);
        var_names.extend_from_slice(name.bytes());
    }
    var_names.push(b'\'');
    let mut place = func.estree_span();
    if cx.language().is_oxlint {
        let body = match loop_node.kind() {
            StmtKind::For { body, .. }
            | StmtKind::ForIn { body, .. }
            | StmtKind::ForOf { body, .. }
            | StmtKind::While { body, .. }
            | StmtKind::DoWhile { body, .. } => body,
            _ => loop_node,
        };
        // What is in the head of a loop is in the body of the loop around that.
        if !body.span().contains(place) && cx.state.get_containing_loop_node(loop_node.into()).is_none() {
            return;
        }
        // oxlint looks at the functions that are directly in the loop, with all that is in them: once at the function
        // that is called where it is written, not at those in it.
        let (whole, mut at) = (loop_node.span(), func);
        while let Some(outer) = at.enclosing().filter(|it| whole.contains(it.span())) {
            if ast_utils::is_function_with_body(outer) {
                place = outer.estree_span();
            }
            at = outer;
        }
        if !cx.state.reported_as_oxlint.insert(place.start) {
            return;
        }
    }
    cx.report(place, UNSAFE_REFS).data("varNames", var_names);
}

impl Rule for NoLoopFunc {
    const META: Meta = Meta::eslint("no-loop-func", Kind::Suggestion);
    type State<'a> = Known<'a>;

    fn new(_: &Options) -> Self {
        NoLoopFunc
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Known<'a> {
        if has_loops(file) {
            on.funcs(|_, func, cx| check(func, Dialect::Eslint, cx));
        }
        Known::default()
    }
}
