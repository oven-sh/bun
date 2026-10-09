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
    /// `references`: all those to a variable of `variable_scope`. For oxc a declaration that gives the variable a value
    /// is none.
    fn among<'a>(references: impl Iterator<Item = Reference<'a>>, variable_scope: Scope<'a>) -> Writes {
        let mut writes = Writes {
            is_in_other_function: false,
            last: None,
        };
        let is_oxlint = variable_scope.node().file().language().is_oxlint;
        for reference in references.filter(|it| it.is_write() && !(is_oxlint && it.is_init())) {
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
    /// With a configuration of oxlint: the functions of the file.
    functions: Vec<Func<'a>>,
    /// Those with a function in them that is not [called where it is written](is_safe_iife).
    with_lasting_functions: FxHashSet<Func<'a>>,
    /// [`Known::loop_with_body_around`]
    loops_with_body_around: AncestorMemo<'a, Option<Stmt<'a>>>,
    /// Where a variable is written to, but for its declarations, in the order of the file.
    places_of_writes: FxHashMap<usize, Vec<u32>>,
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
            // oxlint does not go on from a function that is called where it is written.
            Node::Func(func)
                if ast_utils::is_function_with_body(func)
                    && (func.file().language().is_oxlint || !is_skipped_iife(func)) =>
            {
                Some(None)
            }
            _ => None,
        });
        found.flatten()
    }

    /// The loop that oxlint's `LoopFunctionCollector` finds `func` for: the innermost one around it, in the same
    /// function, whose body it is in. What is in the head of a loop belongs to the loop around that.
    fn loop_with_body_around(&mut self, func: Func<'a>) -> Option<Stmt<'a>> {
        let found = self.loops_with_body_around.find(func.into(), |current, parent| match parent {
            Node::Stmt(statement) => {
                (body_of_loop(statement).map(Node::Stmt) == Some(current)).then_some(Some(statement))
            }
            Node::Func(outer) if is_function_of_oxc(outer) => Some(None),
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

fn body_of_loop(statement: Stmt<'_>) -> Option<Stmt<'_>> {
    match statement.kind() {
        StmtKind::For { body, .. }
        | StmtKind::ForIn { body, .. }
        | StmtKind::ForOf { body, .. }
        | StmtKind::While { body, .. }
        | StmtKind::DoWhile { body, .. } => Some(body),
        _ => None,
    }
}

/// What is a function for oxc: not a static block, a signature or a function type.
fn is_function_of_oxc(func: Func) -> bool {
    matches!(
        func.kind(),
        FnKind::Decl
            | FnKind::Expr
            | FnKind::Arrow
            | FnKind::Method
            | FnKind::Getter
            | FnKind::Setter
            | FnKind::Constructor
    )
}

/// oxlint's `is_safe_iife`, for all but `async` functions and generators: it is called where it is written, and its
/// name is not used.
fn is_safe_iife(func: Func) -> bool {
    !func.is_async()
        && !func.is_generator()
        && is_iife(func)
        && !func.symbol().is_some_and(|it| it.references().next().is_some())
}

/// The loop in whose head `declarator` is: as the `init` of a `for`, or on the left of `in` or `of`.
fn loop_with_head_of(declarator: VarDecl<'_>) -> Option<Stmt<'_>> {
    let Node::Stmt(declaration) = declarator.parent() else {
        return None;
    };
    let head = declaration.parent().as_stmt()?;
    let is_in_head = match head.kind() {
        StmtKind::For { init, .. } => init == Some(declaration),
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => left == declaration,
        _ => false,
    };
    is_in_head.then_some(head)
}

/// oxlint's `is_unsafe_reference`, for a function in the body of `loop_node`.
fn is_unsafe_for_oxlint<'a>(variable: Symbol<'a>, loop_node: Stmt<'a>, known: &mut Known<'a>) -> bool {
    let Some(declaration) = variable.declarations().next() else {
        return false;
    };
    let (is_var, declared, head) = match (declaration, declaration.node()) {
        (Declaration::Param(pat), _) => (true, pat.span(), None),
        (Declaration::Var(pat), _) if declaration.is_catch_parameter() => (false, pat.span(), None),
        (Declaration::Var(_), Some(Node::VarDecl(declarator))) => match declarator.var_kind() {
            VarKind::Var => (true, declarator.span(), loop_with_head_of(declarator)),
            VarKind::Let => (false, declarator.span(), loop_with_head_of(declarator)),
            VarKind::Const | VarKind::Using | VarKind::AwaitUsing => return false,
        },
        _ => return false,
    };
    let whole = loop_node.span();
    // The loop that declares it in its head, if it is around `loop_node`, or is it, in the same function.
    let function_of = |it: Stmt<'a>| Node::Stmt(it).scope().variable_scope();
    let head = head.filter(|it| it.span().contains(whole) && function_of(*it) == function_of(loop_node));
    if is_var {
        // All the iterations have the same variable.
        let is_set_by_head = |it: Stmt<'a>| !matches!(it.kind(), StmtKind::For { update: None, .. });
        if whole.contains(declared) || head.is_some_and(is_set_by_head) {
            return true;
        }
        let writes = known.places_of_writes.entry(variable.key()).or_insert_with(|| {
            let writes = variable.references().filter(|it| it.is_write() && !it.is_init());
            let mut places: Vec<u32> = writes.map(|it| it.span().start).collect();
            utils::sort::sort_unstable(&mut places);
            places
        });
        let first_in_loop = writes.get(writes.partition_point(|it| *it < whole.start));
        return first_in_loop.is_some_and(|it| *it < whole.end);
    }
    // Each iteration has a variable of its own.
    if body_of_loop(loop_node).is_some_and(|it| it.span().contains(declared)) || head.is_some() {
        return false;
    }
    let writes = *(known.writes_to_variables.entry(variable.key()))
        .or_insert_with(|| Writes::among(variable.references(), variable.scope().variable_scope()));
    known.has_unsafe_write(writes, loop_node, declared.end)
}

/// oxlint's rule, once [`check`] has seen all the functions. It looks at the functions that are directly in the body of
/// a loop, with all that is in them, and not at one that is called where it is written if all those in it are too.
pub fn check_as_oxlint<'a, R: Rule<State<'a> = Known<'a>>>(cx: &mut Cx<'a, R>) {
    for func in std::mem::take(&mut cx.state.functions) {
        let known = &mut cx.state;
        let (Some(loop_node), Some(scope)) = (known.loop_with_body_around(func), func.scope()) else {
            continue;
        };
        if is_safe_iife(func) && !known.with_lasting_functions.contains(&func) {
            continue;
        }
        let mut seen = FxHashSet::default();
        let is_unsafe = scope.through().filter(|it| it.is_value()).filter_map(Reference::symbol).any(|variable| {
            seen.insert(variable.key())
                && variable.is_value_variable()
                && is_unsafe_for_oxlint(variable, loop_node, known)
        });
        if is_unsafe {
            cx.report(func.estree_span(), UNSAFE_REFS);
        }
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
    // [`check_as_oxlint`] goes on.
    if cx.language().is_oxlint {
        if is_function_of_oxc(func) {
            cx.state.functions.push(func);
        }
        let mut outer = func.enclosing().filter(|_| is_function_of_oxc(func) && !is_safe_iife(func));
        while let Some(it) = outer
            && cx.state.with_lasting_functions.insert(it)
        {
            outer = it.enclosing();
        }
        return;
    }
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
    cx.report(func.estree_span(), UNSAFE_REFS).data("varNames", var_names);
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
            on.finish(|_, cx| check_as_oxlint(cx));
        }
        Known::default()
    }
}
