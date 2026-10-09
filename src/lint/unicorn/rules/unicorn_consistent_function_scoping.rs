use bun_lint_oxlint::ast_util::is_react_hook;
use bun_lint_oxlint::import::has_module_syntax;
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
    /// The arrow functions that have a `this` of what is around them, once that is asked.
    arrows_with_this_of_parent: Option<FxHashSet<Func<'a>>>,
    /// Whether oxc takes the file for a module, once that is asked.
    is_module: Option<bool>,
    /// Whether a scope is in strict mode for a reason other than that.
    is_strict: FxHashMap<Scope<'a>, bool>,
    /// [`captured_by_bodies`], once that is asked.
    captured_by_bodies: Option<FxHashMap<Scope<'a>, Outermost<'a>>>,
}

/// Up to three variables, those first that are declared furthest out.
type Outermost<'a> = SmallVec<[Symbol<'a>; 4]>;

impl Rule for ConsistentFunctionScoping {
    const META: Meta = Meta::oxlint(Plugin::Unicorn, "consistent-function-scoping", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        ConsistentFunctionScoping { check_arrow_functions: options.object(0).bool_or("checkArrowFunctions", true) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !file.is_declaration_file() {
            on.funcs(Self::check);
        }
        State::default()
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
        let arrows = &mut cx.state.arrows_with_this_of_parent;
        if func.is_arrow() && arrows.get_or_insert_with(|| arrows_with_this_of_parent(file)).contains(&func) {
            return;
        }

        let captured = cx.state.captured_by_bodies.get_or_insert_with(|| captured_by_bodies(file)).get(&scope);
        if captured.is_some_and(|it| it.iter().any(|it| *it != symbol && Some(*it) != func.symbol())) {
            return;
        }

        // oxlint has the name of a function expression in the scope of the function itself.
        let parent_scope_span = match expression.filter(|_| binding.is_none()) {
            Some(e) if is_value_of_assignment_or_property(e) => get_short_span_for_fn_scope(parent_scope),
            Some(_) => Some(reporter_span),
            None => get_short_span_for_fn_scope(symbol_scope),
        };
        let report = match parent_scope_span {
            Some(parent) => cx.report(parent, CONSISTENT_FUNCTION_SCOPING).comments_apply_at(reporter_span),
            None => cx.report(reporter_span, CONSISTENT_FUNCTION_SCOPING),
        };
        report.data("name", name);
    }
}

/// Where the body of the function starts whose scope `scope` is.
fn body_start_of(scope: Scope) -> Option<u32> {
    match (scope.kind(), scope.node()) {
        (ScopeKind::Function, Node::Func(func)) => Some(match func.body() {
            FnBody::Expr(body) => body.outer_span().start,
            _ => func.body_span().map_or(0, |it| it.start),
        }),
        _ => None,
    }
}

fn add_outermost<'a>(list: &mut Outermost<'a>, symbol: Symbol<'a>) {
    if !list.contains(&symbol) {
        let is_further_in = |it: &Symbol<'a>| it.scope() != symbol.scope() && symbol.scope().contains(it.scope());
        list.insert(list.iter().position(is_further_in).unwrap_or(list.len()), symbol);
        list.truncate(3);
    }
}

/// For the scope of each function: variables that are declared outside it and referred to in its body, or in a scope in
/// its body. What is in the parameters does not count. Three are enough to know whether there is one that is not one of
/// two: if a variable is declared outside a scope, so are those that are declared further out.
fn captured_by_bodies<'a>(file: &'a File<'a>) -> FxHashMap<Scope<'a>, Outermost<'a>> {
    let counts = |reference: Reference<'a>, referenced: Symbol<'a>| {
        !referenced.is_implicit_arguments()
            && !reference.is_jsx_pragma()
            && !is_import(referenced)
            && !matches!(reference.node(), Node::Expr(e) if e.is_jsx_tag_name())
    };
    let mut of_bodies = FxHashMap::default();
    // What the scopes in a scope refer to and is declared outside it: all, and what is in the body of the function.
    let mut from_inside: FxHashMap<Scope<'a>, (Outermost<'a>, Outermost<'a>)> = FxHashMap::default();
    // A scope comes after the scopes that are in it.
    for scope in file.scopes().rev() {
        let (mut all, mut in_body) = from_inside.remove(&scope).unwrap_or_default();
        let body_start = body_start_of(scope);
        for reference in scope.references() {
            let Some(referenced) = reference.symbol().filter(|it| it.scope() != scope && counts(reference, *it)) else {
                continue;
            };
            add_outermost(&mut all, referenced);
            if body_start.is_some_and(|it| reference.span().start >= it) {
                add_outermost(&mut in_body, referenced);
            }
        }
        if body_start.is_some() {
            of_bodies.insert(scope, in_body);
        }
        let Some(parent) = scope.parent().filter(|_| !all.is_empty()) else {
            continue;
        };
        let is_in_body = body_start_of(parent).is_some_and(|it| scope.span().start >= it);
        let (all_of_parent, in_body_of_parent) = from_inside.entry(parent).or_default();
        for referenced in all.into_iter().filter(|it| it.scope() != parent) {
            add_outermost(all_of_parent, referenced);
            if is_in_body {
                add_outermost(in_body_of_parent, referenced);
            }
        }
    }
    of_bodies
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

/// The arrow functions in which there is a `this` that is not that of a function in them.
fn arrows_with_this_of_parent<'a>(file: &'a File<'a>) -> FxHashSet<Func<'a>> {
    let mut found = FxHashSet::default();
    let mut nearest_function = AncestorMemo::default();
    for this in file.exprs_of_kind(ExprTag::This).filter(|it| !it.is_jsx_tag_name()) {
        let mut at = nearest_function.find(Node::Expr(this), |_, parent| parent.as_func());
        while let Some(func) = at {
            match func.kind() {
                // Those around it are known as well then.
                FnKind::Arrow if !found.insert(func) => break,
                FnKind::Arrow | FnKind::StaticBlock => at = func.enclosing(),
                _ => break,
            }
        }
    }
    found
}

/// A short place that stands for `scope`: the name of the function or the class, the keyword of the statement.
fn get_short_span_for_fn_scope(scope: Scope) -> Option<Span> {
    // oxlint has no scope for the initializer of a field.
    let scope = if scope.kind() == ScopeKind::ClassFieldInitializer { scope.parent()? } else { scope };
    let keyword = |len: u32| Some(Span::new(scope.span().start, scope.span().start + len));
    match (scope.kind(), scope.node()) {
        (ScopeKind::Function, Node::Func(func)) if func.is_arrow() => {
            let Node::Expr(arrow) = func.owner() else {
                return None;
            };
            match arrow.parent() {
                _ if arrow.is_parenthesized() => None,
                Node::VarDecl(declarator) => Some(declarator.pat().span()),
                Node::Expr(parent) if parent.tag() == ExprTag::Assign && !parent.is_assignment_target() => {
                    parent.left().map(Expr::span)
                }
                _ => None,
            }
        }
        (ScopeKind::Function, Node::Func(func)) => func.name().map(Ident::span),
        (ScopeKind::Class, Node::Class(class)) => class.name().map(Ident::span),
        (ScopeKind::For, _) => keyword(3),
        (ScopeKind::Switch, _) => keyword(6),
        _ => None,
    }
}
