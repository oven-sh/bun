use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

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

/// `scope.through` of the scope of `func`, in the order of the source.
fn through<'a>(func: Func<'a>, scope: Scope<'a>) -> impl Iterator<Item = Reference<'a>> {
    func.file().references_within(func.span()).filter(move |it| {
        scope.contains(it.scope()) && it.symbol().is_none_or(|variable| !scope.contains(variable.scope()))
    })
}

/// Whether `func`, which is in a loop, is among ESLint's `SKIPPED_IIFE_NODES`: it is called where
/// it is written and nowhere else, so what is in it is in the loop.
fn is_skipped_iife(func: Func) -> bool {
    if func.is_async() || func.is_generator() || !is_iife(func) {
        return false;
    }
    match (func.name(), func.scope()) {
        (Some(name), Some(scope)) => !through(func, scope).any(|it| it.name() == name.name()),
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
    /// Where the loops are that are in no other loop, in the order of the source.
    loops: SmallVec<[Span; 4]>,
    /// ESLint's `getContainingLoopNode`.
    containing_loops: AncestorMemo<'a, Option<Stmt<'a>>>,
    writes_to_variables: FxHashMap<usize, Writes>,
    writes_to_globals: FxHashMap<Name<'a>, Writes>,
    /// Where a variable is written to and not declared, sorted.
    assignments: FxHashMap<usize, Vec<u32>>,
    /// Where the functions start that are reported as oxlint does.
    reported_as_oxlint: FxHashSet<u32>,
}

impl<'a> Known<'a> {
    /// `None` if there is nothing to check in `file`.
    pub fn of(file: &'a File<'a>) -> Option<Known<'a>> {
        let tags = [StmtTag::For, StmtTag::ForIn, StmtTag::ForOf, StmtTag::While, StmtTag::DoWhile];
        let mut loops: SmallVec<[Span; 4]> =
            tags.into_iter().flat_map(|tag| file.stmts_of_kind(tag)).map(Stmt::span).collect();
        if loops.is_empty() {
            return None;
        }
        utils::sort::sort_unstable_by_key(&mut loops, |it| it.start);
        let mut end = 0;
        loops.retain(|it| {
            let is_outermost = it.end > end;
            end = end.max(it.end);
            is_outermost
        });
        Some(Known {
            loops,
            ..Known::default()
        })
    }

    #[inline]
    fn is_in_loop(&self, offset: u32) -> bool {
        let after = self.loops.partition_point(|it| it.start <= offset);
        after.checked_sub(1).and_then(|it| self.loops.get(it)).is_some_and(|it| offset < it.end)
    }

    /// ESLint's `getContainingLoopNode`.
    fn get_containing_loop_node(&mut self, node: Node<'a>) -> Option<Stmt<'a>> {
        let is_oxlint = node.file().language().is_oxlint;
        let found = self.containing_loops.find(node, |current, parent| match parent {
            Node::Stmt(statement) => match statement.kind() {
                // For oxlint what is in the head of a loop is in the body of the loop around that.
                StmtKind::For { body, .. }
                | StmtKind::ForIn { body, .. }
                | StmtKind::ForOf { body, .. }
                | StmtKind::While { body, .. }
                | StmtKind::DoWhile { body, .. }
                    if is_oxlint =>
                {
                    (current == Node::Stmt(body)).then_some(Some(statement))
                }
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
        let mut at = node;
        loop {
            if at.span().start <= last {
                return true;
            }
            match self.get_containing_loop_node(at.into()).filter(|outer| outer.span().start >= border) {
                Some(outer) => at = outer,
                None => return false,
            }
        }
    }

    /// Whether one of the `writes` to a variable can modify it between the iterations of the loop: it is in another function, or
    /// not before the loop.
    fn has_unsafe_write(&mut self, writes: Writes, loop_node: Stmt<'a>, excluded_end: u32) -> bool {
        writes.is_in_other_function
            || writes.last.is_some_and(|last| self.is_written_in_top_loop(loop_node, excluded_end, last))
    }
}

/// Where the loops that `statement` is in, in its function, and `statement` itself declare their variables: the `init` of a `for`,
/// the `left` of a `for`-`in`. With whether something gives them another value for the next iteration.
fn heads<'a>(statement: Stmt<'a>) -> impl Iterator<Item = (Span, bool)> {
    let around = Node::Stmt(statement).ancestors().take_while(|it| !matches!(it, Node::Func(_)));
    std::iter::once(Node::Stmt(statement)).chain(around).filter_map(|it| match it.as_stmt()?.kind() {
        StmtKind::For { init, update, .. } => Some((init?.span(), update.is_some())),
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => Some((left.span(), true)),
        _ => None,
    })
}

/// `is_unsafe_reference` of oxlint, which goes by the first declaration of `variable`. `None`: as for ESLint, where the end
/// of the declaration is given.
fn is_unsafe_for_oxlint<'a>(loop_node: Stmt<'a>, variable: Symbol<'a>, known: &mut Known<'a>) -> Option<bool> {
    let is_safe = Some(false);
    let Some(first) = variable.declarations().next() else {
        return is_safe;
    };
    let (Some(place), whole) = (first.name_span(), loop_node.span()) else {
        return is_safe;
    };
    let var_kind = match first.node() {
        Some(Node::VarDecl(it)) => Some(it.var_kind()),
        _ => None,
    };
    let is_in_head = |known: &Known<'a>, changing: bool| {
        known.is_in_loop(place.start) && heads(loop_node).any(|(head, changes)| head.contains(place) && (changes || !changing))
    };
    match (first.kind()?, var_kind) {
        (DeclarationKind::CatchClause, _) | (DeclarationKind::Variable, Some(VarKind::Let)) => {
            (whole.contains(place) || is_in_head(known, false)).then_some(false)
        }
        // All iterations share it. Else only what is written in the loop counts, and no declaration does.
        (DeclarationKind::Parameter, _) | (DeclarationKind::Variable, Some(VarKind::Var)) => {
            if whole.contains(place) || is_in_head(known, true) {
                return Some(true);
            }
            let assignments = known.assignments.entry(variable.key()).or_insert_with(|| {
                let assignments = variable.references().filter(|it| it.is_write() && !it.is_init());
                let mut starts: Vec<u32> = assignments.map(|it| it.ident().start()).collect();
                starts.sort_unstable();
                starts
            });
            let first_in_loop = assignments.get(assignments.partition_point(|&it| it < whole.start));
            Some(first_in_loop.is_some_and(|&it| it < whole.end))
        }
        _ => is_safe,
    }
}

/// It resolves to something, and ESLint's `isSafe` does not hold.
fn is_unsafe<'a>(loop_node: Stmt<'a>, reference: Reference<'a>, dialect: Dialect, known: &mut Known<'a>) -> bool {
    if dialect == Dialect::TypeScript && reference.is_type() {
        return false;
    }
    let is_oxlint = loop_node.file().language().is_oxlint;
    let Some(variable) = reference.symbol() else {
        let (file, name) = (loop_node.file(), reference.name());
        if is_oxlint {
            return false;
        }
        if !file.global(name.bytes()).is_some_and(|it| it.accepts(reference.is_type())) {
            return false;
        }
        let writes = *(known.writes_to_globals.entry(name))
            .or_insert_with(|| Writes::among(file.unresolved_references_to(name.bytes()), file.scope()));
        return known.has_unsafe_write(writes, loop_node, 0);
    };
    if is_oxlint && let Some(is_unsafe) = is_unsafe_for_oxlint(loop_node, variable, known) {
        return is_unsafe;
    }
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

/// ESLint's `checkForLoops`.
#[inline]
pub fn check<'a, R: Rule<State<'a> = Known<'a>>>(func: Func<'a>, dialect: Dialect, cx: &mut Cx<'a, R>) {
    if ast_utils::is_function_with_body(func) && cx.state.is_in_loop(func.span().start) {
        check_in_loop(func, dialect, cx);
    }
}

#[inline(never)]
fn check_in_loop<'a, R: Rule<State<'a> = Known<'a>>>(func: Func<'a>, dialect: Dialect, cx: &mut Cx<'a, R>) {
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
        through(func, scope).filter(|it| is_unsafe(loop_node, *it, dialect, known)).collect();
    if unsafe_refs.is_empty() {
        return;
    }
    utils::sort::sort_by_key(&mut unsafe_refs, |it| it.ident().start());
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
    const ON: On = On::new().funcs();
    type State<'a> = Known<'a>;

    fn new(_: &Options) -> Self {
        NoLoopFunc
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Known<'a>> {
        Known::of(file)
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        check(func, Dialect::Eslint, cx);
    }
}
