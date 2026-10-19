use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::types::{IdMap, IdSet};
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{get_inner_expression, is_react_hook, iter_outer_expressions};
use bun_lint_oxlint::import::has_module_syntax;
use rustc_hash::FxHashMap;
use smallvec::SmallVec;

/// Disallow functions that are declared in a scope which does not capture any variables from the outer scope.
pub struct ConsistentFunctionScoping {
    check_arrow_functions: bool,
}

const CONSISTENT_FUNCTION_SCOPING: Message = Message::new(
    "",
    "Function `{{name}}` does not capture any variables from its parent scope",
);

#[derive(Default)]
pub struct State<'a> {
    /// [`arrows_with_lexical_capture`], computed on first use.
    arrows_with_lexical_capture: Option<IdSet<Func<'a>>>,
    /// True if oxc treats the file as a module. Computed on first use.
    is_module: Option<bool>,
    /// Caches whether a scope is in strict mode for any other reason.
    is_strict: IdMap<Scope<'a>, bool>,
    /// [`Captures::of`], computed on first use.
    captures: Option<Captures<'a>>,
    /// [`functions_with_private_names`], computed on first use.
    with_private_names: Option<IdSet<Scope<'a>>>,
}

/// Up to three variables, outermost declarations first.
type Outermost<'a> = SmallVec<[Symbol<'a>; 4]>;

impl Rule for ConsistentFunctionScoping {
    const META: Meta = Meta::oxlint(
        Plugin::Unicorn,
        "consistent-function-scoping",
        Kind::Problem,
    );
    const ON: On = On::new().funcs();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        ConsistentFunctionScoping {
            check_arrow_functions: options.object(0).bool_or("checkArrowFunctions", true),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if file.is_declaration_file() {
            return None;
        }
        Some(State::default())
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        self.check(func, cx);
    }
}

/// True for the top level of the file or of a namespace.
fn is_top_level(statement_list: Node) -> bool {
    match statement_list {
        Node::File(_) => true,
        Node::Stmt(parent) => parent.tag() == StmtTag::Module,
        _ => false,
    }
}

/// The same for a scope.
fn is_top_or_module_block(scope: Scope) -> bool {
    match scope.kind() {
        ScopeKind::Global | ScopeKind::Module | ScopeKind::TsModule => true,
        // CommonJS
        ScopeKind::Function => matches!(scope.node(), Node::File(_)),
        _ => false,
    }
}

impl ConsistentFunctionScoping {
    /// Returns the variable `func` is assigned to and the function's expression. Returns `None` if the rule skips the
    /// function because of its position or because it has no name.
    fn binding_and_expression<'a>(
        &self,
        func: Func<'a>,
    ) -> Option<(Option<Pat<'a>>, Option<Expr<'a>>)> {
        if !func.has_body() {
            return None;
        }
        let (binding, expression) = match (func.kind(), func.owner()) {
            (FnKind::Decl, Node::Stmt(declaration)) => {
                let parent = declaration.parent();
                if is_top_level(parent) || matches!(parent, Node::Func(outer) if is_iife(outer)) {
                    return None;
                }
                (None, None)
            }
            (FnKind::Arrow, Node::Expr(_)) if !self.check_arrow_functions => return None,
            (FnKind::Expr | FnKind::Arrow, Node::Expr(e)) => match e.parent() {
                Node::VarDecl(declarator) if declarator.pat().tag() == PatTag::Ident => {
                    if is_top_level(declarator.parent().parent()) {
                        return None;
                    }
                    (Some(declarator.pat()), Some(e))
                }
                Node::Stmt(parent) if parent.tag() == StmtTag::Return => return None,
                Node::Expr(parent)
                    if !e.is_parenthesized()
                        && matches!(parent.tag(), ExprTag::Call | ExprTag::New)
                        && parent.callee() != Some(e) =>
                {
                    return None;
                }
                _ => (None, Some(e)),
            },
            _ => return None,
        };
        (binding.is_some() || func.name().is_some()).then_some((binding, expression))
    }

    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        let Some((binding, expression)) = self.binding_and_expression(func) else {
            return;
        };
        let (name, reporter_span) = match (binding, func.name(), expression) {
            (Some(binding), _, _) if func.is_arrow() => (binding.text(), binding.span()),
            (Some(binding), Some(own_name), _) => (binding.text(), own_name.span()),
            // The `function` keyword.
            (Some(binding), None, Some(e)) => (
                binding.text(),
                Span::new(e.span().start, e.span().start + 8),
            ),
            (None, Some(own_name), _) => (own_name.bytes(), own_name.span()),
            _ => return,
        };

        let Some(scope) = func.scope() else {
            return;
        };
        let Some(parent_scope) = scope
            .chain()
            .skip(1)
            .find(|it| it.kind() != ScopeKind::FunctionExpressionName)
        else {
            return;
        };
        let Some(symbol) = binding.map_or_else(|| func.symbol(), Pat::symbol) else {
            return;
        };
        let file = cx.file();
        let symbol_scope = scope_of_symbol(func, symbol, file, &mut cx.state);
        if !func.is_arrow() && is_top_or_module_block(parent_scope)
            || is_top_or_module_block(symbol_scope)
            || is_in_react_hook(parent_scope)
        {
            return;
        }

        let captures = cx.state.captures.get_or_insert_with(|| {
            Captures::of(file, |it| self.binding_and_expression(it).is_some())
        });
        // A variable declared outside the enclosing function doesn't keep `func` in that function.
        let is_in_plain_function = function_of(parent_scope).is_some()
            && !captures.with_eval.contains(parent_scope)
            && !captures.is_in_oxlint_only_scope(parent_scope, scope.span().start);
        let must_stay = match is_in_plain_function {
            true => captures.captures_from_parent.contains(scope),
            false => (captures.outermost.get(scope)).is_some_and(|it| {
                it.iter()
                    .any(|it| *it != symbol && Some(*it) != func.symbol())
            }),
        };
        if must_stay {
            return;
        }
        let with_private_names = &mut cx.state.with_private_names;
        if with_private_names
            .get_or_insert_with(|| functions_with_private_names(file))
            .contains(scope)
        {
            return;
        }
        let arrows = &mut cx.state.arrows_with_lexical_capture;
        if func.is_arrow()
            && arrows
                .get_or_insert_with(|| arrows_with_lexical_capture(file))
                .contains(func)
        {
            return;
        }

        // oxlint puts a function expression's name in the function's own scope.
        let parent_scope_span = match expression.filter(|_| binding.is_none()) {
            Some(e) if is_value_of_assignment_or_property(e) => {
                get_short_span_for_fn_scope(parent_scope)
            }
            Some(_) => Some((reporter_span, "function")),
            None => get_short_span_for_fn_scope(symbol_scope),
        };
        let report = match parent_scope_span {
            Some((parent, kind)) => cx
                .report(parent, CONSISTENT_FUNCTION_SCOPING)
                .comments_apply_at(reporter_span)
                .labels_with(|labels| {
                    labels.first("Outer scope where this function is defined");
                    let text = [
                        "This function does not use any variables from the parent ",
                        kind,
                    ]
                    .concat();
                    labels.push(reporter_span, text);
                }),
            None => cx.report(reporter_span, CONSISTENT_FUNCTION_SCOPING),
        };
        report.data("name", name);
    }
}

/// The function that `scope` belongs to.
fn function_of(scope: Scope<'_>) -> Option<Func<'_>> {
    match (scope.kind(), scope.node()) {
        (ScopeKind::Function, Node::Func(func)) => Some(func),
        _ => None,
    }
}

/// The variable the function is assigned to, and the function's own name.
fn own_symbols(func: Func<'_>) -> [Option<Symbol<'_>>; 2] {
    let variable = match func.owner() {
        Node::Expr(e) => match e.parent() {
            Node::VarDecl(declarator) => declarator.pat().symbol(),
            _ => None,
        },
        _ => None,
    };
    [variable, func.symbol()]
}

/// The part of a function where oxlint looks for references: its parameters and its body, but not its type parameters,
/// its `this` type or its return type.
#[derive(Copy, Clone)]
struct Region {
    params: Span,
    body_start: u32,
}

impl Region {
    fn of(func: Func) -> Region {
        let params = match (func.params().first(), func.params().last()) {
            (Some(first), Some(last)) => Span::new(first.span().start, last.span().end),
            _ => Span::new(0, 0),
        };
        let body_start = match func.body() {
            FnBody::Expr(body) => body.outer_span().start,
            _ => func.body_span().map_or(0, |it| it.start),
        };
        Region { params, body_start }
    }

    fn contains(self, at: u32) -> bool {
        at >= self.body_start || (self.params.start..self.params.end).contains(&at)
    }
}

/// A scope that refers to a variable declared outside it.
struct Direct<'a> {
    scope: Scope<'a>,
    /// The child scope on the current path for which `note` has already recorded the reference.
    noted: Option<Scope<'a>>,
}

/// The outside variables referenced by the functions the rule checks and by the functions nested in them.
struct Captures<'a> {
    regions: IdMap<Scope<'a>, Region>,
    /// [`oxlint_only_scopes`]
    oxlint_only_scopes: FxHashMap<Scope<'a>, Vec<Span>>,
    /// [`outermost_captures`]
    outermost: IdMap<Scope<'a>, Outermost<'a>>,
    /// The scopes of functions that refer to a variable tied to their parent scope: the variable is declared there, the
    /// parent scope also refers to it, or it's the name of the function that owns the parent scope or of the class this
    /// function is directly in.
    captures_from_parent: IdSet<Scope<'a>>,
    /// [`scopes_with_eval`]
    with_eval: IdSet<Scope<'a>>,
}

impl<'a> Captures<'a> {
    fn of(file: &'a File<'a>, is_checked: impl Fn(Func<'a>) -> bool) -> Captures<'a> {
        let mut captures = Captures {
            regions: IdMap::new(),
            oxlint_only_scopes: oxlint_only_scopes(file),
            outermost: IdMap::new(),
            captures_from_parent: IdSet::new(),
            with_eval: scopes_with_eval(file),
        };
        // The scope chain from the global scope to the current one.
        let mut path: Vec<Scope<'a>> = Vec::new();
        // `outermost` holds the scopes of checked functions that aren't nested in another checked function.
        // `contains_checked_function` marks the scopes that directly contain them.
        let mut outermost: Vec<Scope<'a>> = Vec::new();
        let mut contains_checked_function = vec![false; file.scopes().len()];
        // `file.scopes()` lists a scope before the scopes nested in it.
        for scope in file.scopes() {
            if outermost.last().is_some_and(|it| it.contains(scope)) {
                continue;
            }
            while path.last().is_some_and(|it| !it.contains(scope)) {
                path.pop();
            }
            if !function_of(scope).is_some_and(&is_checked) {
                path.push(scope);
                continue;
            }
            outermost.push(scope);
            for &it in path.iter().rev() {
                if let Some(flag) = contains_checked_function.get_mut(it.id().idx()) {
                    *flag = true;
                }
                if is_oxlint_scope(it) {
                    break;
                }
            }
        }
        path.clear();
        let mut outermost = outermost.into_iter().peekable();
        let mut current = None;
        // The scopes of those functions and every scope nested in them.
        let mut inside: Vec<Scope<'a>> = Vec::new();
        // For each variable, the scopes in `path` that refer to it.
        let mut direct: IdMap<Symbol<'a>, SmallVec<[Direct<'a>; 2]>> = IdMap::new();
        for scope in file.scopes() {
            while path.last().is_some_and(|it| !it.contains(scope)) {
                path.pop();
            }
            path.push(scope);
            current = outermost.next_if_eq(&scope).or(current);
            let is_inside = current.is_some_and(|it| it.contains(scope));
            if is_inside {
                inside.push(scope);
                if let Some(func) = function_of(scope) {
                    captures.regions.insert(scope, Region::of(func));
                }
            } else if outermost.peek().is_none() {
                break;
            } else if contains_checked_function.get(scope.id().idx()) != Some(&true) {
                continue;
            }
            for reference in scope.references_with_names_of_patterns_first() {
                let is_of_interest =
                    |it: &Symbol<'a>| it.scope() != scope && is_oxlint_reference(reference, *it);
                let Some(symbol) = reference.symbol().filter(is_of_interest) else {
                    continue;
                };
                let at = reference.ident().start();
                let entries = direct.get_or_insert_with(symbol, SmallVec::new);
                while entries.last().is_some_and(|it| !it.scope.contains(scope)) {
                    entries.pop();
                }
                if is_inside && !is_jsx_tag_name(reference) {
                    captures.note_reference(&path, entries, symbol, at);
                }
                let is_new = entries.last().is_none_or(|it| it.scope != scope);
                if is_new && !captures.is_in_oxlint_only_scope(scope, at) {
                    entries.push(Direct { scope, noted: None });
                }
            }
        }
        captures.outermost = outermost_captures(&inside, &captures.regions);
        captures
    }

    /// True if the position `at`, which is directly in `scope`, is in a nested scope that only oxlint has.
    fn is_in_oxlint_only_scope(&self, scope: Scope<'a>, at: u32) -> bool {
        self.oxlint_only_scopes.get(&scope).is_some_and(|spans| {
            let after = spans.partition_point(|it| it.start <= at);
            after
                .checked_sub(1)
                .and_then(|it| spans.get(it))
                .is_some_and(|it| at < it.end)
        })
    }

    /// Records that `inner` refers at `at` to `symbol`, which is tied to `inner`'s parent scope. Returns true if it was
    /// recorded, or if there's nothing to record because `inner` isn't the scope of a tracked function.
    fn note(&mut self, inner: Scope<'a>, symbol: Symbol<'a>, at: u32) -> bool {
        let (Some(region), Some(func)) = (self.regions.get(inner), function_of(inner)) else {
            return true;
        };
        if !region.contains(at) || own_symbols(func).contains(&Some(symbol)) {
            return false;
        }
        self.captures_from_parent.insert(inner);
        true
    }

    /// `entries` are the scopes in `path` that refer to `symbol`. The last scope in `path` refers to it at `at`.
    fn note_reference(
        &mut self,
        path: &[Scope<'a>],
        entries: &mut [Direct<'a>],
        symbol: Symbol<'a>,
        at: u32,
    ) {
        let in_scope_of_declaration = scope_in(path, symbol.scope());
        let in_named_scope = match symbol.declarations().next() {
            Some(Declaration::Fn(func)) => func.scope().and_then(|it| scope_in(path, it)),
            Some(Declaration::Class(class)) => class
                .scope()
                .and_then(|it| scope_in(path, it))
                .and_then(|it| scope_in(path, it)),
            _ => None,
        };
        for inner in [in_scope_of_declaration, in_named_scope]
            .into_iter()
            .flatten()
        {
            self.note(inner, symbol, at);
        }
        for entry in entries.iter_mut().rev() {
            // `None` means it's the last scope in `path`.
            let Some(inner) = scope_in(path, entry.scope) else {
                continue;
            };
            // Then it's already recorded for the outer entries too.
            if entry.noted == Some(inner) {
                break;
            }
            if self.note(inner, symbol, at) {
                entry.noted = Some(inner);
            }
        }
    }
}

/// oxlint has no scope for a function expression's name or a field's initializer.
fn is_oxlint_scope(scope: Scope) -> bool {
    !matches!(
        scope.kind(),
        ScopeKind::FunctionExpressionName | ScopeKind::ClassFieldInitializer
    )
}

/// Returns the scope in `path` that's directly in `outer`, going by oxlint's scopes. `path` runs from the global scope
/// inwards.
fn scope_in<'a>(path: &[Scope<'a>], outer: Scope<'a>) -> Option<Scope<'a>> {
    let after = path.partition_point(|it| it.contains(outer));
    if after.checked_sub(1).and_then(|it| path.get(it)) != Some(&outer) {
        return None;
    }
    path.get(after..)?
        .iter()
        .copied()
        .find(|it| is_oxlint_scope(*it))
}

/// The scopes that contain an `eval(..)`.
fn scopes_with_eval<'a>(file: &'a File<'a>) -> IdSet<Scope<'a>> {
    let mut found = IdSet::new();
    let Some(eval) = file.find_name("eval") else {
        return found;
    };
    let mut path: Vec<Scope<'a>> = Vec::new();
    for scope in file.scopes() {
        while path.last().is_some_and(|it| !it.contains(scope)) {
            path.pop();
        }
        path.push(scope);
        if scope
            .references_with_names_of_patterns_first()
            .any(|it| it.name() == eval && is_called(it))
        {
            for it in path.iter().rev() {
                // If a scope is already in the set, so are its ancestors.
                if !found.insert(*it) {
                    break;
                }
            }
        }
    }
    found
}

/// True for the `eval` in `eval(..)` or `(eval)(..)`.
fn is_called(reference: Reference) -> bool {
    reference.expr().is_some_and(|e| {
        matches!(iter_outer_expressions(e).next(), Some(Node::Expr(parent))
            if parent.as_call().is_some_and(|it| !it.is_optional() && get_inner_expression(it.callee()) == e))
    })
}

/// True if oxlint has this reference and takes it into account.
fn is_oxlint_reference(reference: Reference, referenced: Symbol) -> bool {
    !referenced.is_implicit_arguments() && !reference.is_jsx_pragma() && !is_import(referenced)
}

fn is_jsx_tag_name(reference: Reference) -> bool {
    matches!(reference.node(), Node::Expr(e) if e.is_jsx_tag_name())
}

/// `for (let ..` or `for (const ..`, which has a scope here too.
fn declares_in_head(statement: Stmt) -> bool {
    let head = match statement.kind() {
        StmtKind::For { init, .. } => init,
        StmtKind::ForIn { left, .. } | StmtKind::ForOf { left, .. } => Some(left),
        _ => None,
    };
    head.and_then(Stmt::as_var)
        .and_then(|it| it.first())
        .is_some_and(|it| it.var_kind() != VarKind::Var)
}

/// Maps a function's scope to the statements directly in it that have a scope only in oxlint, in source order.
/// Statements nested in another such statement are dropped.
fn oxlint_only_scopes<'a>(file: &'a File<'a>) -> FxHashMap<Scope<'a>, Vec<Span>> {
    let mut found: FxHashMap<Scope<'a>, Vec<Span>> = FxHashMap::default();
    for tag in [
        StmtTag::For,
        StmtTag::ForIn,
        StmtTag::ForOf,
        StmtTag::TypeAlias,
        StmtTag::Interface,
    ] {
        for statement in file.stmts_of_kind(tag) {
            if matches!(statement.parent(), Node::File(_)) || declares_in_head(statement) {
                continue;
            }
            let scope = Node::Stmt(statement).scope();
            if function_of(scope).is_some() {
                found.entry(scope).or_default().push(statement.span());
            }
        }
    }
    #[expect(
        clippy::iter_over_hash_type,
        reason = "each list is sorted independently"
    )]
    for spans in found.values_mut() {
        utils::sort::sort_unstable_by_key(spans, |it| it.start);
        let mut end = 0;
        spans.retain(|it| {
            let is_outermost = it.start >= end;
            if is_outermost {
                end = it.end;
            }
            is_outermost
        });
    }
    found
}

/// Maps a scope to the private names used in it and their positions.
fn private_references<'a>(file: &'a File<'a>) -> IdMap<Scope<'a>, Vec<(Name<'a>, u32)>> {
    let mut found: IdMap<Scope<'a>, Vec<(Name<'a>, u32)>> = IdMap::new();
    if !file.has_classes() || !strings::contains_char(file.text(), b'#') {
        return found;
    }
    let members = file
        .exprs_of_kind(ExprTag::Dot)
        .filter(|it| it.is_private_member());
    for usage in members.chain(file.exprs_of_kind(ExprTag::PrivateIdentifier)) {
        let name = match usage.kind() {
            ExprKind::Dot { name, .. } => name.name(),
            ExprKind::PrivateIdentifier(name) => name,
            _ => continue,
        };
        let scope = Node::Expr(usage).scope();
        let reference = (name, usage.span().start);
        found.get_or_insert_with(scope, Vec::new).push(reference);
    }
    found
}

/// The scopes of functions that use a class's private name and are directly in that class, or directly in something
/// that's directly in it.
fn functions_with_private_names<'a>(file: &'a File<'a>) -> IdSet<Scope<'a>> {
    let mut found = IdSet::new();
    let private_references = private_references(file);
    if private_references.is_empty() {
        return found;
    }
    // For each private name, the scopes of the classes in `path` that declare it, and where their bodies start.
    let mut declaring: FxHashMap<Name<'a>, SmallVec<[(Scope<'a>, u32); 1]>> = FxHashMap::default();
    // The scope chain from the global scope to the current one.
    let mut path: Vec<Scope<'a>> = Vec::new();
    for scope in file.scopes() {
        while path.last().is_some_and(|it| !it.contains(scope)) {
            path.pop();
        }
        path.push(scope);
        if let Node::Class(class) = scope.node() {
            let body_start = class.body_span().start;
            for member in class.members() {
                if let Some(KeyKind::Private(name)) = member.key().map(Key::kind) {
                    let classes = declaring.entry(name).or_default();
                    while classes.last().is_some_and(|it| !it.0.contains(scope)) {
                        classes.pop();
                    }
                    classes.push((scope, body_start));
                }
            }
        }
        for &(name, at) in private_references.get(scope).into_iter().flatten() {
            let Some(classes) = declaring.get_mut(&name) else {
                continue;
            };
            while classes.last().is_some_and(|it| !it.0.contains(scope)) {
                classes.pop();
            }
            // A class's heritage is in its scope but not in its body.
            let Some(&(class_scope, _)) = classes.iter().rev().find(|it| it.1 <= at) else {
                continue;
            };
            let mut outer = class_scope;
            while let Some(inner) = scope_in(&path, outer) {
                if function_of(inner).is_some_and(|it| Region::of(it).contains(at)) {
                    found.insert(inner);
                }
                // A function would move out of its parent scope, and then further out of any class scopes.
                if outer.kind() != ScopeKind::Class {
                    break;
                }
                outer = inner;
            }
        }
    }
    found
}

fn add_outermost<'a>(list: &mut Outermost<'a>, symbol: Symbol<'a>) {
    if !list.contains(&symbol) {
        let is_further_in =
            |it: &Symbol<'a>| it.scope() != symbol.scope() && symbol.scope().contains(it.scope());
        list.insert(
            list.iter().position(is_further_in).unwrap_or(list.len()),
            symbol,
        );
        list.truncate(3);
    }
}

/// Maps the scope of each function in `scopes` to the variables declared outside it that are referenced in its
/// [`Region`] or in a scope nested there. Three are enough to tell whether one of them isn't one of two given
/// variables, because if a variable is declared outside a scope, so is every variable declared further out. In
/// `scopes`, a scope comes before all the scopes nested in it.
fn outermost_captures<'a>(
    scopes: &[Scope<'a>],
    regions: &IdMap<Scope<'a>, Region>,
) -> IdMap<Scope<'a>, Outermost<'a>> {
    let mut captures_by_function = IdMap::new();
    // For a scope, the outside variables that its nested scopes refer to: all of them, and those in the function's
    // region.
    let mut from_inside: IdMap<Scope<'a>, (Outermost<'a>, Outermost<'a>)> = IdMap::new();
    for &scope in scopes.iter().rev() {
        let (mut all, mut in_region) = from_inside.remove(scope).unwrap_or_default();
        let region = regions.get(scope);
        for reference in scope.references_with_names_of_patterns_first() {
            let counts = |it: &Symbol<'a>| {
                it.scope() != scope
                    && is_oxlint_reference(reference, *it)
                    && !is_jsx_tag_name(reference)
            };
            let Some(referenced) = reference.symbol().filter(counts) else {
                continue;
            };
            add_outermost(&mut all, referenced);
            if region.is_some_and(|it| it.contains(reference.ident().start())) {
                add_outermost(&mut in_region, referenced);
            }
        }
        if region.is_some() {
            captures_by_function.insert(scope, in_region);
        }
        let Some(parent) = scope.parent().filter(|_| !all.is_empty()) else {
            continue;
        };
        let is_in_region = regions
            .get(parent)
            .is_some_and(|it| it.contains(scope.span().start));
        let (all_of_parent, in_region_of_parent) =
            from_inside.get_or_insert_with(parent, Default::default);
        for referenced in all.into_iter().filter(|it| it.scope() != parent) {
            add_outermost(all_of_parent, referenced);
            if is_in_region {
                add_outermost(in_region_of_parent, referenced);
            }
        }
    }
    captures_by_function
}

/// The scope where oxc puts `symbol`, which is `func`'s name or the variable it's assigned to. In sloppy JavaScript a
/// plain function declared in a block is also a variable of the enclosing function (Annex B.3.2.1). oxc moves it there
/// unless an earlier declaration there has the same name.
fn scope_of_symbol<'a>(
    func: Func<'a>,
    symbol: Symbol<'a>,
    file: &'a File<'a>,
    state: &mut State<'a>,
) -> Scope<'a> {
    let scope = symbol.scope();
    let var_scope = scope.variable_scope();
    let Some(name) = func
        .name()
        .filter(|_| func.kind() == FnKind::Decl && scope != var_scope)
    else {
        return scope;
    };
    if func.is_async()
        || func.is_generator()
        || !file.is_javascript()
        || is_strict_mode(scope, file, state)
    {
        return scope;
    }
    let is_before = |it: Declaration<'a>| {
        it.name_span()
            .is_some_and(|it| it.start < name.span().start)
    };
    match var_scope
        .get_name(name.name())
        .is_some_and(|it| it.declarations().any(is_before))
    {
        true => scope,
        false => var_scope,
    }
}

fn is_strict_mode<'a>(scope: Scope<'a>, file: &'a File<'a>, state: &mut State<'a>) -> bool {
    let is_module = *state.is_module.get_or_insert_with(|| match file.path() {
        [.., b'.', b'm', b'j', b's'] => true,
        [.., b'.', b'c', b'j', b's'] => false,
        _ => has_module_syntax(file),
    });
    if is_module {
        return true;
    }
    let has_use_strict = |statements: List<'a, Stmt<'a>>| {
        statements
            .iter()
            .map_while(Stmt::directive)
            .any(|it| it == b"use strict")
    };
    let mut visited_scopes: SmallVec<[Scope<'a>; 8]> = SmallVec::new();
    let mut answer = false;
    for scope in scope.chain() {
        if let Some(&known) = state.is_strict.get(scope) {
            answer = known;
            break;
        }
        visited_scopes.push(scope);
        answer = match (scope.kind(), scope.node()) {
            (ScopeKind::Class, _) => true,
            (_, Node::Func(func)) => func.body_statements().is_some_and(has_use_strict),
            (_, Node::File(file)) => has_use_strict(file.body()),
            _ => false,
        };
        if answer {
            break;
        }
    }
    state
        .is_strict
        .extend(visited_scopes.into_iter().map(|it| (it, answer)));
    answer
}

/// `(function () { .. })()`
fn is_iife(func: Func) -> bool {
    matches!(func.owner(), Node::Expr(e) if matches!(e.parent(), Node::Expr(call)
        if call.tag() == ExprTag::Call && call.callee() == Some(e)))
}

/// `parent_scope` is the scope that contains the function. True if it belongs to a function that's an argument of a
/// hook.
fn is_in_react_hook(parent_scope: Scope) -> bool {
    let (ScopeKind::Function, Node::Func(outer)) = (parent_scope.kind(), parent_scope.node())
    else {
        return false;
    };
    matches!(outer.owner(), Node::Expr(e) if !e.is_parenthesized() && matches!(e.parent(), Node::Expr(call)
        if call.as_call().is_some_and(|it| is_react_hook(it.callee()))))
}

fn is_import(symbol: Symbol) -> bool {
    matches!(
        symbol.declarations().next(),
        Some(
            Declaration::ImportDefault(_)
                | Declaration::ImportNamespace(_)
                | Declaration::ImportSpec(_)
                | Declaration::ImportEquals(_)
        )
    )
}

/// `a = e`, `{ a: e }`
fn is_value_of_assignment_or_property(e: Expr) -> bool {
    !e.is_parenthesized()
        && match e.parent() {
            Node::Expr(parent) => parent.tag() == ExprTag::Assign && !parent.is_assignment_target(),
            Node::Prop(prop) => !prop.is_jsx_attribute() && prop.kind() != PropKind::Spread,
            _ => false,
        }
}

/// The arrow functions that contain a `this`, `super` or `new.target` that refers to the enclosing context.
fn arrows_with_lexical_capture<'a>(file: &'a File<'a>) -> IdSet<Func<'a>> {
    let mut found = IdSet::new();
    // Maps a node to its enclosing function. `Some(None)` means it's in a field initializer, which has its own `this`.
    let mut owners: AncestorMemo<'a, Option<Func<'a>>> = AncestorMemo::default();
    let mut owner_of = |node: Node<'a>| {
        let owner = owners.find(node, |child, parent| match (parent, child) {
            (Node::Func(func), _) => Some(Some(func)),
            (Node::Member(member), Node::Expr(e)) if member.init() == Some(e) => Some(None),
            _ => None,
        });
        owner.flatten()
    };
    for tag in [ExprTag::This, ExprTag::Super, ExprTag::NewTarget] {
        for e in file.exprs_of_kind(tag).filter(|it| !it.is_jsx_tag_name()) {
            let mut at = owner_of(Node::Expr(e));
            // If an arrow is already in the set, so are the arrows around it.
            while let Some(arrow) = at.filter(|it| it.is_arrow() && found.insert(*it)) {
                at = owner_of(arrow.owner());
            }
        }
    }
    found
}

/// A short span that represents `scope`: the function's or class's name, or the statement's keyword. Also returns what
/// oxlint calls it.
fn get_short_span_for_fn_scope(scope: Scope) -> Option<(Span, &'static str)> {
    // oxlint has no scope for a field's initializer.
    let scope = if scope.kind() == ScopeKind::ClassFieldInitializer {
        scope.parent()?
    } else {
        scope
    };
    let keyword = |len: u32| Some(Span::new(scope.span().start, scope.span().start + len));
    let (span, kind) = match (scope.kind(), scope.node()) {
        (ScopeKind::Function, Node::Func(func)) if func.is_arrow() => {
            let Node::Expr(arrow) = func.owner() else {
                return None;
            };
            let span = match arrow.parent() {
                _ if arrow.is_parenthesized() => None,
                Node::VarDecl(declarator) => Some(declarator.pat().span()),
                Node::Expr(parent)
                    if parent.tag() == ExprTag::Assign && !parent.is_assignment_target() =>
                {
                    parent.left().map(Expr::span)
                }
                _ => None,
            };
            (span, "arrow function")
        }
        (ScopeKind::Function, Node::Func(func)) => (func.name().map(Ident::span), "function"),
        (ScopeKind::Class, Node::Class(class)) => (class.name().map(Ident::span), "class"),
        (ScopeKind::For, _) => (keyword(3), "for loop"),
        (ScopeKind::Switch, _) => (keyword(6), "switch statement"),
        _ => return None,
    };
    Some((span?, kind))
}
