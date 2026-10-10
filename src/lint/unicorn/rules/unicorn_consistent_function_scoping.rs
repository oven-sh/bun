use bun_lint_oxlint::ast_util::{get_inner_expression, is_react_hook, iter_outer_expressions};
use bun_lint_oxlint::import::has_module_syntax;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;

/// Disallow functions that are declared in a scope which does not capture any variables from the outer scope.
pub struct ConsistentFunctionScoping {
    check_arrow_functions: bool,
}

const CONSISTENT_FUNCTION_SCOPING: Message =
    Message::new("", "Function `{{name}}` does not capture any variables from its parent scope");

#[derive(Default)]
pub struct State<'a> {
    /// [`arrows_with_lexical_capture`], once that is asked.
    arrows_with_lexical_capture: Option<FxHashSet<Func<'a>>>,
    /// Whether oxc takes the file for a module, once that is asked.
    is_module: Option<bool>,
    /// Whether a scope is in strict mode for a reason other than that.
    is_strict: FxHashMap<Scope<'a>, bool>,
    /// [`Captures::of`], once that is asked.
    captures: Option<Captures<'a>>,
}

/// Up to three variables, those first that are declared furthest out.
type Outermost<'a> = SmallVec<[Symbol<'a>; 4]>;

impl Rule for ConsistentFunctionScoping {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "consistent-function-scoping", Kind::Problem);
    const ON: On = On::new().funcs();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        ConsistentFunctionScoping { check_arrow_functions: options.object(0).bool_or("checkArrowFunctions", true) }
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

/// The top level of the file or of a namespace.
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
    fn check<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if !func.has_body() {
            return;
        }
        // The variable that it is the value of, and the expression that it is.
        let (binding, expression) = match (func.kind(), func.owner()) {
            (FnKind::Decl, Node::Stmt(declaration)) => {
                let parent = declaration.parent();
                if is_top_level(parent) || matches!(parent, Node::Func(outer) if is_iife(outer)) {
                    return;
                }
                (None, None)
            }
            (FnKind::Arrow, Node::Expr(_)) if !self.check_arrow_functions => return,
            (FnKind::Expr | FnKind::Arrow, Node::Expr(e)) => match e.parent() {
                Node::VarDecl(declarator) if declarator.pat().tag() == PatTag::Ident => {
                    if is_top_level(declarator.parent().parent()) {
                        return;
                    }
                    (Some(declarator.pat()), Some(e))
                }
                Node::Stmt(parent) if parent.tag() == StmtTag::Return => return,
                Node::Expr(parent)
                    if !e.is_parenthesized()
                        && matches!(parent.tag(), ExprTag::Call | ExprTag::New)
                        && parent.callee() != Some(e) =>
                {
                    return;
                }
                _ => (None, Some(e)),
            },
            _ => return,
        };
        let (name, reporter_span) = match (binding, func.name(), expression) {
            (Some(binding), _, _) if func.is_arrow() => (binding.text(), binding.span()),
            (Some(binding), Some(own_name), _) => (binding.text(), own_name.span()),
            // The `function`.
            (Some(binding), None, Some(e)) => (binding.text(), Span::new(e.span().start, e.span().start + 8)),
            (None, Some(own_name), _) => (own_name.bytes(), own_name.span()),
            _ => return,
        };

        let Some(scope) = func.scope() else {
            return;
        };
        let Some(parent_scope) = scope.chain().skip(1).find(|it| it.kind() != ScopeKind::FunctionExpressionName) else {
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
        let arrows = &mut cx.state.arrows_with_lexical_capture;
        if func.is_arrow() && arrows.get_or_insert_with(|| arrows_with_lexical_capture(file)).contains(&func) {
            return;
        }

        let captures = cx.state.captures.get_or_insert_with(|| Captures::of(file));
        // What is declared further out than the function around it does not keep it in that function.
        let is_in_plain_function = function_of(parent_scope).is_some()
            && !captures.with_eval.contains(&parent_scope)
            && !captures.is_in_scope_of_oxlint_only(parent_scope, scope.span().start);
        let is_kept = match is_in_plain_function {
            true => captures.of_parent.contains(&scope),
            false => (captures.outermost.get(&scope))
                .is_some_and(|it| it.iter().any(|it| *it != symbol && Some(*it) != func.symbol())),
        };
        if is_kept || captures.of_class.contains(&scope) {
            return;
        }

        // oxlint has the name of a function expression in the scope of the function itself.
        let parent_scope_span = match expression.filter(|_| binding.is_none()) {
            Some(e) if is_value_of_assignment_or_property(e) => get_short_span_for_fn_scope(parent_scope),
            Some(_) => Some((reporter_span, "function")),
            None => get_short_span_for_fn_scope(symbol_scope),
        };
        let report = match parent_scope_span {
            Some((parent, kind)) => {
                cx.report(parent, CONSISTENT_FUNCTION_SCOPING).comments_apply_at(reporter_span).labels_with(|labels| {
                    labels.first("Outer scope where this function is defined");
                    let text = ["This function does not use any variables from the parent ", kind].concat();
                    labels.push(reporter_span, text);
                })
            }
            None => cx.report(reporter_span, CONSISTENT_FUNCTION_SCOPING),
        };
        report.data("name", name);
    }
}

/// The function whose scope `scope` is.
fn function_of(scope: Scope<'_>) -> Option<Func<'_>> {
    match (scope.kind(), scope.node()) {
        (ScopeKind::Function, Node::Func(func)) => Some(func),
        _ => None,
    }
}

/// The variable that the function is the value of, and its own name.
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

/// Where oxlint looks for what a function refers to: in its parameters and in its body. Not in its type parameters, in
/// the type of its `this` and in its return type.
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

/// A scope in which a variable is referred to that is declared outside it.
struct Direct<'a> {
    scope: Scope<'a>,
    /// The scope in it of which that is noted, if it is the one that leads to the current scope.
    noted: Option<Scope<'a>>,
}

/// How many classes directly in classes are looked at.
const MAX_CLASSES: usize = 16;

/// What the functions of a file refer to that is not their own.
struct Captures<'a> {
    regions: FxHashMap<Scope<'a>, Region>,
    /// [`scopes_of_oxlint_only`]
    scopes_of_oxlint_only: FxHashMap<Scope<'a>, Vec<Span>>,
    /// [`outermost_captures`]
    outermost: FxHashMap<Scope<'a>, Outermost<'a>>,
    /// The scopes of the functions that refer to a variable that has to do with the scope around them: it is declared
    /// there, that scope refers to it as well, it is the name of the function whose scope that is, or of the class that
    /// this function is directly in.
    of_parent: FxHashSet<Scope<'a>>,
    /// The scopes of the functions that use a private name of a class, and are directly in that class or directly in
    /// what is directly in it.
    of_class: FxHashSet<Scope<'a>>,
    /// The scopes with an `eval(..)` in them.
    with_eval: FxHashSet<Scope<'a>>,
}

impl<'a> Captures<'a> {
    fn of(file: &'a File<'a>) -> Captures<'a> {
        let regions: FxHashMap<Scope<'a>, Region> =
            file.scopes().filter_map(|it| Some((it, Region::of(function_of(it)?)))).collect();
        let mut captures = Captures {
            outermost: outermost_captures(file, &regions),
            regions,
            scopes_of_oxlint_only: scopes_of_oxlint_only(file),
            of_parent: FxHashSet::default(),
            of_class: FxHashSet::default(),
            with_eval: FxHashSet::default(),
        };
        let private_references = private_references(file);
        // The scopes of the classes of `path` that declare a private name, and where their bodies start.
        let mut declaring: FxHashMap<Name<'a>, SmallVec<[(Scope<'a>, u32); 1]>> = FxHashMap::default();
        let eval = file.mentions("eval").then(|| file.name_of("eval"));
        // From the global scope to the current one.
        let mut path: Vec<Scope<'a>> = Vec::new();
        // The scopes of `path` that refer to a variable.
        let mut direct: FxHashMap<Symbol<'a>, SmallVec<[Direct<'a>; 2]>> = FxHashMap::default();
        // A scope comes before the scopes that are in it.
        for scope in file.scopes() {
            while path.last().is_some_and(|it| !it.contains(scope)) {
                path.pop();
            }
            path.push(scope);
            if let Node::Class(class) = scope.node()
                && !private_references.is_empty()
            {
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
            for &(name, at) in private_references.get(&scope).into_iter().flatten() {
                let Some(classes) = declaring.get_mut(&name) else {
                    continue;
                };
                while classes.last().is_some_and(|it| !it.0.contains(scope)) {
                    classes.pop();
                }
                // The heritage of a class is in its scope, not in its body.
                if let Some(&(class_scope, _)) = classes.iter().rev().find(|it| it.1 <= at) {
                    captures.note_private_reference(&path, class_scope, at);
                }
            }
            for reference in scope.references() {
                if eval.is_some_and(|it| it == reference.name()) && is_called(reference) {
                    for it in path.iter().rev() {
                        // Those around one that is known are known.
                        if !captures.with_eval.insert(*it) {
                            break;
                        }
                    }
                }
                let is_of_interest = |it: &Symbol<'a>| it.scope() != scope && is_reference_of_oxlint(reference, *it);
                let Some(symbol) = reference.symbol().filter(is_of_interest) else {
                    continue;
                };
                let at = reference.span().start;
                let entries = direct.entry(symbol).or_default();
                while entries.last().is_some_and(|it| !it.scope.contains(scope)) {
                    entries.pop();
                }
                if !is_jsx_tag_name(reference) {
                    captures.note_reference(&path, entries, symbol, at);
                }
                let is_new = entries.last().is_none_or(|it| it.scope != scope);
                if is_new && !captures.is_in_scope_of_oxlint_only(scope, at) {
                    entries.push(Direct { scope, noted: None });
                }
            }
        }
        captures
    }

    /// Whether what is at `at`, directly in `scope`, is in a scope in it for oxlint.
    fn is_in_scope_of_oxlint_only(&self, scope: Scope<'a>, at: u32) -> bool {
        self.scopes_of_oxlint_only.get(&scope).is_some_and(|spans| {
            let after = spans.partition_point(|it| it.start <= at);
            after.checked_sub(1).and_then(|it| spans.get(it)).is_some_and(|it| at < it.end)
        })
    }

    /// `symbol`, which has to do with the scope around `inner`, is referred to at `at`, in `inner`. Whether that is
    /// noted, or there is nothing to note as `inner` is not the scope of a function.
    fn note(&mut self, inner: Scope<'a>, symbol: Symbol<'a>, at: u32) -> bool {
        let Some(func) = function_of(inner) else {
            return true;
        };
        if self.regions.get(&inner).is_some_and(|it| !it.contains(at)) || own_symbols(func).contains(&Some(symbol)) {
            return false;
        }
        self.of_parent.insert(inner);
        true
    }

    /// `entries`: the scopes of `path` that refer to `symbol`, which the last of `path` does at `at`.
    fn note_reference(&mut self, path: &[Scope<'a>], entries: &mut [Direct<'a>], symbol: Symbol<'a>, at: u32) {
        let in_scope_of_declaration = scope_in(path, symbol.scope());
        let in_what_it_names = match symbol.declarations().next() {
            Some(Declaration::Fn(func)) => func.scope().and_then(|it| scope_in(path, it)),
            Some(Declaration::Class(class)) => {
                class.scope().and_then(|it| scope_in(path, it)).and_then(|it| scope_in(path, it))
            }
            _ => None,
        };
        for inner in [in_scope_of_declaration, in_what_it_names].into_iter().flatten() {
            self.note(inner, symbol, at);
        }
        for entry in entries.iter_mut().rev() {
            // `None`: it is the last of `path`.
            let Some(inner) = scope_in(path, entry.scope) else {
                continue;
            };
            // Then it is noted of those further out as well.
            if entry.noted == Some(inner) {
                break;
            }
            if self.note(inner, symbol, at) {
                entry.noted = Some(inner);
            }
        }
    }

    /// A private name that the class with the scope `class_scope` declares is used at `at`, in the last of `path`.
    fn note_private_reference(&mut self, path: &[Scope<'a>], class_scope: Scope<'a>, at: u32) {
        let mut outer = class_scope;
        for _ in 0..MAX_CLASSES {
            let Some(inner) = scope_in(path, outer) else {
                break;
            };
            if self.regions.get(&inner).is_some_and(|it| it.contains(at)) {
                self.of_class.insert(inner);
            }
            // A function moves out of the scope around it, and on out of classes.
            if outer.kind() != ScopeKind::Class {
                break;
            }
            outer = inner;
        }
    }
}

/// The scope directly in `outer` that is one of `path`, which leads from the global scope inwards. For oxlint the name
/// of a function expression and the initializer of a field have no scope.
fn scope_in<'a>(path: &[Scope<'a>], outer: Scope<'a>) -> Option<Scope<'a>> {
    let after = path.partition_point(|it| it.contains(outer));
    if after.checked_sub(1).and_then(|it| path.get(it)) != Some(&outer) {
        return None;
    }
    let is_scope_of_oxlint =
        |it: &&Scope<'a>| !matches!(it.kind(), ScopeKind::FunctionExpressionName | ScopeKind::ClassFieldInitializer);
    path.get(after..)?.iter().find(is_scope_of_oxlint).copied()
}

/// It is the `eval` of `eval(..)` or `(eval)(..)`.
fn is_called(reference: Reference) -> bool {
    reference.expr().is_some_and(|e| {
        matches!(iter_outer_expressions(e).next(), Some(Node::Expr(parent))
            if parent.as_call().is_some_and(|it| !it.is_optional() && get_inner_expression(it.callee()) == e))
    })
}

/// Whether oxlint has it, and looks at it.
fn is_reference_of_oxlint(reference: Reference, referenced: Symbol) -> bool {
    !referenced.is_implicit_arguments() && !reference.is_jsx_pragma() && !is_import(referenced)
}

fn is_jsx_tag_name(reference: Reference) -> bool {
    matches!(reference.node(), Node::Expr(e) if e.is_jsx_tag_name())
}

/// By the scope of the function that they are directly in: the statements that have a scope for oxlint only, without
/// those that are in another of them, in the order of the file.
fn scopes_of_oxlint_only<'a>(file: &'a File<'a>) -> FxHashMap<Scope<'a>, Vec<Span>> {
    let mut found: FxHashMap<Scope<'a>, Vec<Span>> = FxHashMap::default();
    for tag in [StmtTag::For, StmtTag::ForIn, StmtTag::ForOf, StmtTag::TypeAlias, StmtTag::Interface] {
        for statement in file.stmts_of_kind(tag) {
            let scope = Node::Stmt(statement).scope();
            if function_of(scope).is_some() {
                found.entry(scope).or_default().push(statement.span());
            }
        }
    }
    for spans in found.values_mut() {
        utils::sort::sort_unstable_by_key(spans, |it| it.start);
        let mut end = 0;
        spans.retain(|it| {
            let is_in_none = it.start >= end;
            if is_in_none {
                end = it.end;
            }
            is_in_none
        });
    }
    found
}

/// By the scope that it is in: a private name that is used, and where.
fn private_references<'a>(file: &'a File<'a>) -> FxHashMap<Scope<'a>, Vec<(Name<'a>, u32)>> {
    let mut found: FxHashMap<Scope<'a>, Vec<(Name<'a>, u32)>> = FxHashMap::default();
    if !file.has_classes() || !strings::contains_char(file.text(), b'#') {
        return found;
    }
    for usage in file.exprs_of_kind(ExprTag::Dot).chain(file.exprs_of_kind(ExprTag::PrivateIdentifier)) {
        let name = match usage.kind() {
            ExprKind::Dot { name, .. } if usage.is_private_member() => name.name(),
            ExprKind::PrivateIdentifier(name) => name,
            _ => continue,
        };
        found.entry(Node::Expr(usage).scope()).or_default().push((name, usage.span().start));
    }
    found
}

fn add_outermost<'a>(list: &mut Outermost<'a>, symbol: Symbol<'a>) {
    if !list.contains(&symbol) {
        let is_further_in = |it: &Symbol<'a>| it.scope() != symbol.scope() && symbol.scope().contains(it.scope());
        list.insert(list.iter().position(is_further_in).unwrap_or(list.len()), symbol);
        list.truncate(3);
    }
}

/// For the scope of each function: variables that are declared outside it and referred to in its [`Region`], or in a
/// scope there. Three are enough to know whether there is one that is not one of two: if a variable is declared outside
/// a scope, so are those that are declared further out.
fn outermost_captures<'a>(
    file: &'a File<'a>,
    regions: &FxHashMap<Scope<'a>, Region>,
) -> FxHashMap<Scope<'a>, Outermost<'a>> {
    let mut of_functions = FxHashMap::default();
    // What the scopes in a scope refer to and is declared outside it: all, and what is in the region of the function.
    let mut from_inside: FxHashMap<Scope<'a>, (Outermost<'a>, Outermost<'a>)> = FxHashMap::default();
    // A scope comes after the scopes that are in it.
    for scope in file.scopes().rev() {
        let (mut all, mut in_region) = from_inside.remove(&scope).unwrap_or_default();
        let region = regions.get(&scope);
        for reference in scope.references() {
            let counts = |it: &Symbol<'a>| {
                it.scope() != scope && is_reference_of_oxlint(reference, *it) && !is_jsx_tag_name(reference)
            };
            let Some(referenced) = reference.symbol().filter(counts) else {
                continue;
            };
            add_outermost(&mut all, referenced);
            if region.is_some_and(|it| it.contains(reference.span().start)) {
                add_outermost(&mut in_region, referenced);
            }
        }
        if region.is_some() {
            of_functions.insert(scope, in_region);
        }
        let Some(parent) = scope.parent().filter(|_| !all.is_empty()) else {
            continue;
        };
        let is_in_region = regions.get(&parent).is_some_and(|it| it.contains(scope.span().start));
        let (all_of_parent, in_region_of_parent) = from_inside.entry(parent).or_default();
        for referenced in all.into_iter().filter(|it| it.scope() != parent) {
            add_outermost(all_of_parent, referenced);
            if is_in_region {
                add_outermost(in_region_of_parent, referenced);
            }
        }
    }
    of_functions
}

/// The scope that oxc has `symbol` in, which is the name of `func` or the variable that it is the value of. In sloppy
/// JavaScript a plain function that is declared in a block is a variable of the function around it as well (Annex
/// B.3.2.1): oxc moves it there, unless something before it has the name there.
fn scope_of_symbol<'a>(func: Func<'a>, symbol: Symbol<'a>, file: &'a File<'a>, state: &mut State<'a>) -> Scope<'a> {
    let scope = symbol.scope();
    let var_scope = scope.variable_scope();
    let Some(name) = func.name().filter(|_| func.kind() == FnKind::Decl && scope != var_scope) else {
        return scope;
    };
    if func.is_async() || func.is_generator() || !file.is_javascript() || is_strict_mode(scope, file, state) {
        return scope;
    }
    let is_before = |it: Declaration<'a>| it.name_span().is_some_and(|it| it.start < name.span().start);
    match var_scope.get_name(name.name()).is_some_and(|it| it.declarations().any(is_before)) {
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
    let has_use_strict =
        |statements: List<'a, Stmt<'a>>| statements.iter().map_while(Stmt::directive).any(|it| it == b"use strict");
    let mut passed: SmallVec<[Scope<'a>; 8]> = SmallVec::new();
    let mut answer = false;
    for scope in scope.chain() {
        if let Some(&known) = state.is_strict.get(&scope) {
            answer = known;
            break;
        }
        passed.push(scope);
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
    state.is_strict.extend(passed.into_iter().map(|it| (it, answer)));
    answer
}

/// `(function () { .. })()`
fn is_iife(func: Func) -> bool {
    matches!(func.owner(), Node::Expr(e) if matches!(e.parent(), Node::Expr(call)
        if call.tag() == ExprTag::Call && call.callee() == Some(e)))
}

/// `parent_scope`: the scope that the function is in. Whether that is of a function that is an argument of a hook.
fn is_in_react_hook(parent_scope: Scope) -> bool {
    let (ScopeKind::Function, Node::Func(outer)) = (parent_scope.kind(), parent_scope.node()) else {
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

/// The arrow functions in which there is a `this`, a `super` or a `new.target` that is that of what is around them.
fn arrows_with_lexical_capture<'a>(file: &'a File<'a>) -> FxHashSet<Func<'a>> {
    let mut found = FxHashSet::default();
    // The function that a node is in. `Some(None)`: it is in the initializer of a field, which has a `this` of its own.
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
            // Of those around one that is known it is known as well.
            while let Some(arrow) = at.filter(|it| it.is_arrow() && found.insert(*it)) {
                at = owner_of(arrow.owner());
            }
        }
    }
    found
}

/// A short place that stands for `scope`: the name of the function or the class, the keyword of the statement. And what
/// oxlint calls it.
fn get_short_span_for_fn_scope(scope: Scope) -> Option<(Span, &'static str)> {
    // oxlint has no scope for the initializer of a field.
    let scope = if scope.kind() == ScopeKind::ClassFieldInitializer { scope.parent()? } else { scope };
    let keyword = |len: u32| Some(Span::new(scope.span().start, scope.span().start + len));
    let (span, kind) = match (scope.kind(), scope.node()) {
        (ScopeKind::Function, Node::Func(func)) if func.is_arrow() => {
            let Node::Expr(arrow) = func.owner() else {
                return None;
            };
            let span = match arrow.parent() {
                _ if arrow.is_parenthesized() => None,
                Node::VarDecl(declarator) => Some(declarator.pat().span()),
                Node::Expr(parent) if parent.tag() == ExprTag::Assign && !parent.is_assignment_target() => {
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
