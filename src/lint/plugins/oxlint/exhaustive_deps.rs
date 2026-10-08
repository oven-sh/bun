//! `react/exhaustive-deps` of oxlint 1.80, which is a rule of its own more than a port of `react-hooks/exhaustive-deps`: it has other
//! messages, reports each dependency that is not needed by itself, and has its own notion of what a dependency is.
//!
//! oxlint walks the callback. Here the references in it are looked at, each with what is around it.

use bun_lint::prelude::*;
use rustc_hash::FxHashSet;
use smallvec::SmallVec;
use std::hash::{Hash, Hasher};

const MISSING_CALLBACK: Message = Message::new("", "React hook {{hook}} requires an effect callback.");
const DEPENDENCY_ARRAY_REQUIRED: Message = Message::new("", "React Hook {{hook}} does nothing when called with only one argument.");
const UNKNOWN_DEPENDENCIES: Message = Message::new("", "React Hook {{hook}} received a function whose dependencies are unknown.");
const ASYNC_EFFECT: Message = Message::new("", "Effect callbacks are synchronous to prevent race conditions.");
const MISSING_DEPENDENCY: Message = Message::new("", "React Hook {{hook}} has a missing dependency: {{dependencies}}{{mutable}}");
const MISSING_DEPENDENCIES: Message = Message::new("", "React Hook {{hook}} has missing dependencies: {{dependencies}}{{mutable}}");
const UNNECESSARY_DEPENDENCY: Message = Message::new("", "React Hook {{hook}} has unnecessary dependency: {{dependency}}");
const NOT_ARRAY_LITERAL: Message = Message::new(
    "",
    "React Hook {{hook}} was passed a dependency list that is not an array literal. This means we can't statically verify whether you've passed the correct dependencies.",
);
const LITERAL: Message = Message::new("", "The literal is not a valid dependency because it never changes.");
const DUPLICATE: Message = Message::new("", "This dependency is specified more than once in the dependency array.");
const COMPLEX_EXPRESSION: Message = Message::new("", "React Hook {{hook}} has a complex expression in the dependency array.");
const CHANGES_EVERY_RENDER: Message = Message::new("", "React hook {{hook}} depends on `{{dependency}}`, which changes every render");
const UNNECESSARY_OUTER_SCOPE: Message = Message::new("", "React Hook {{hook}} has an unnecessary dependency: {{dependency}}.");
const INFINITE_RERENDER: Message = Message::new(
    "",
    "React Hook {{hook}} contains a call to setState. Without a list of dependencies, this can lead to an infinite chain of updates.",
);
const REF_IN_CLEANUP: Message = Message::new("", "The ref's value `.current` is accessed directly in the effect cleanup function.");
const USE_EFFECT_EVENT: Message = Message::new("", "Functions returned from `useEffectEvent` must not be included in the dependency array.");

/// `name.chain[0].chain[1]`
#[derive(Clone)]
struct Dependency<'a> {
    span: Span,
    name: Name<'a>,
    symbol: Option<Symbol<'a>>,
    chain: SmallVec<[Name<'a>; 2]>,
}

impl PartialEq for Dependency<'_> {
    fn eq(&self, other: &Self) -> bool {
        self.name == other.name && self.chain == other.chain
    }
}

impl<'a> Dependency<'a> {
    fn text(&self) -> Vec<u8> {
        let mut text = self.name.bytes().to_vec();
        for part in &self.chain {
            text.push(b'.');
            text.extend_from_slice(part.bytes());
        }
        text
    }

    /// `other` is this, or what this is a property of.
    fn contains(&self, other: &Self) -> bool {
        self.name == other.name && self.chain.starts_with(&other.chain)
    }

    fn ends_in_current(&self) -> bool {
        self.chain.last().is_some_and(|it| it.is("current"))
    }

    /// Without the last property.
    fn base(&self) -> Dependency<'a> {
        let mut base = self.clone();
        base.chain.pop();
        base
    }
}

/// oxc's `get_inner_expression`. Parentheses are not nodes here.
fn inner(mut e: Expr) -> Expr {
    while matches!(e.tag(), ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull | ExprTag::Instantiation)
        && let Some(operand) = e.operand()
    {
        e = operand;
    }
    e
}

/// The opposite of [`inner`]: `e` with what is around it that only concerns types.
fn outer(mut e: Expr) -> Expr {
    while let Node::Expr(parent) = e.parent()
        && matches!(parent.tag(), ExprTag::As | ExprTag::AsConst | ExprTag::Satisfies | ExprTag::NonNull | ExprTag::Instantiation)
    {
        e = parent;
    }
    e
}

/// `StaticMemberExpression`
fn as_static_member<'a>(e: Expr<'a>) -> Option<(Expr<'a>, Ident<'a>)> {
    match e.kind() {
        ExprKind::Dot { obj, name, .. } if !name.bytes().starts_with(b"#") && !e.is_jsx_tag_name() && !e.is_in_type_query() => Some((obj, name)),
        _ => None,
    }
}

fn symbol_of(ident: Expr) -> Option<Symbol> {
    ident.reference()?.symbol()
}

/// `Err`: it is not a chain of properties. `Ok(None)`: of a JSX element.
fn analyze_property_chain(e: Expr) -> Result<Option<Dependency>, ()> {
    let e = inner(e);
    match e.kind() {
        ExprKind::Ident(name) => Ok(Some(Dependency {
            span: e.span(),
            name,
            symbol: symbol_of(e),
            chain: SmallVec::new(),
        })),
        ExprKind::Jsx(jsx) if jsx.tag().is_some() => Ok(None),
        _ => {
            let (obj, name) = as_static_member(e).ok_or(())?;
            Ok(analyze_property_chain(obj)?.map(|mut source| {
                source.span = e.span();
                source.chain.push(name.name());
                source
            }))
        }
    }
}

/// `useEffect` for `useEffect` and `React.useEffect`.
fn name_without_react_namespace(callee: Expr) -> Option<Name> {
    match callee.kind() {
        ExprKind::Ident(name) => Some(name),
        _ => as_static_member(callee).filter(|it| inner(it.0).is_ident("React")).map(|it| it.1.name()),
    }
}

fn func_call_without_react_namespace(call: Call) -> Option<Name> {
    name_without_react_namespace(inner(call.callee()))
}

/// What oxc's `symbol_declaration` is.
#[derive(Copy, Clone)]
enum Declared<'a> {
    Variable(VarDecl<'a>),
    Function(Func<'a>),
    Class(Class<'a>),
    Parameter(Param<'a>),
    Other,
}

fn declaration_of(symbol: Symbol) -> Option<Declared> {
    Some(match symbol.declarations().next()? {
        declaration @ Declaration::Var(_) if !declaration.is_catch_parameter() => match declaration.node() {
            Some(Node::VarDecl(declarator)) => Declared::Variable(declarator),
            _ => Declared::Other,
        },
        Declaration::Param(pat) => {
            let param = Node::Pat(pat).ancestors().find_map(|it| match it {
                Node::Param(param) => Some(param),
                _ => None,
            });
            param.map_or(Declared::Other, Declared::Parameter)
        }
        Declaration::Fn(func) => Declared::Function(func),
        Declaration::Class(class) => Declared::Class(class),
        _ => Declared::Other,
    })
}

/// The scope that the node which declares it is in. For a `var` in a block that is the block.
fn scope_of_declaration<'a>(symbol: Symbol<'a>, declared: Declared<'a>) -> Scope<'a> {
    match declared {
        Declared::Variable(declarator) => Node::VarDecl(declarator).scope(),
        Declared::Function(func) => func.owner().parent().scope(),
        Declared::Parameter(param) => param.func().map_or_else(|| symbol.scope(), |it| Node::Func(it).scope()),
        Declared::Class(_) | Declared::Other => symbol.scope(),
    }
}

fn is_strictly_inside<'a>(scope: Scope<'a>, ancestor: Scope<'a>) -> bool {
    scope != ancestor && ancestor.contains(scope)
}

/// `const [state, name] = ..`
fn is_second_of_array_pattern<'a>(declarator: VarDecl<'a>, name: Name<'a>) -> bool {
    let PatKind::Array(elements) = declarator.pat().kind() else {
        return false;
    };
    elements.get(1).is_some_and(|it| it.default().is_none() && !it.is_rest() && it.pat().and_then(Pat::as_ident) == Some(name))
}

/// What is read in a function.
#[derive(Default)]
struct Found<'a> {
    /// In the order of the source.
    dependencies: Vec<Dependency<'a>>,
    /// Every time that one was found: its position in `dependencies`.
    inserted: Vec<u32>,
    /// A function that `useState` or `useReducer` returns is named, outside the functions in the function.
    has_set_state_call: bool,
}

impl<'a> Found<'a> {
    fn insert(&mut self, dependency: Dependency<'a>) {
        let at = self.dependencies.iter().position(|it| *it == dependency).unwrap_or_else(|| {
            self.dependencies.push(dependency);
            self.dependencies.len() - 1
        });
        self.inserted.push(at as u32);
    }

    /// The positions in `dependencies` in the order in which oxlint has them, which is that of its hash table. It names what is
    /// missing in that order, and prints the report where the first is. The same hashes in the same table give the same order.
    fn order_of_oxlint(&self, file: &'a File<'a>) -> Vec<u32> {
        let symbols = places_of_symbols(file);
        let mut table: FxHashSet<Hashed> = FxHashSet::default();
        for &at in &self.inserted {
            if let Some(dependency) = self.dependencies.get(at as usize) {
                let place = dependency.symbol.and_then(place_of_symbol);
                table.insert(Hashed {
                    dependency,
                    // oxc keeps the number so that `u32::MAX` is 0.
                    symbol: place.and_then(|it| symbols.binary_search(&it).ok()).map(|it| it as u32 ^ u32::MAX),
                    at,
                });
            }
        }
        table.iter().map(|it| it.at).collect()
    }
}

/// A dependency that is hashed and compared as oxlint's `Dependency`.
struct Hashed<'d, 'a> {
    dependency: &'d Dependency<'a>,
    /// oxc's `SymbolId`
    symbol: Option<u32>,
    at: u32,
}

/// As a `str` is hashed.
fn write_str<H: Hasher>(state: &mut H, text: Name) {
    state.write(text.bytes());
    state.write_u8(0xFF);
}

impl Hash for Hashed<'_, '_> {
    fn hash<H: Hasher>(&self, state: &mut H) {
        write_str(state, self.dependency.name);
        self.symbol.hash(state);
        state.write_usize(self.dependency.chain.len());
        for part in &self.dependency.chain {
            write_str(state, *part);
        }
    }
}

impl PartialEq for Hashed<'_, '_> {
    fn eq(&self, other: &Self) -> bool {
        self.dependency == other.dependency
    }
}

impl Eq for Hashed<'_, '_> {}

/// Where oxc comes to the node that declares the symbol, and where the name is. It numbers the symbols in that order.
fn place_of_symbol(symbol: Symbol) -> Option<(u32, u32)> {
    let places = symbol.declarations().filter_map(|declaration| {
        let name = declaration.name_span()?.start;
        let node = match declaration {
            Declaration::Var(_) => declaration.node()?.span().start,
            // For oxc `this` is not a parameter.
            Declaration::Param(_) if symbol.name().is("this") => return None,
            Declaration::Param(pat) => Node::Pat(pat).ancestors().find(|it| matches!(it, Node::Param(_)))?.span().start,
            Declaration::Class(class) => class.estree_span().start,
            Declaration::Other => return None,
            _ => name,
        };
        Some((node, name))
    });
    places.min()
}

/// The [`place_of_symbol`] of all symbols, sorted. ESLint has the name of a class and of an enum twice.
fn places_of_symbols<'a>(file: &'a File<'a>) -> Vec<(u32, u32)> {
    let mut places: Vec<(u32, u32)> = file.symbols().filter_map(place_of_symbol).collect();
    // What ESLint has no variable for: a member of an enum with a computed name, and the names in `namespace A.B.C`.
    for stmt in file.stmts_of_kind(StmtTag::Enum).chain(file.stmts_of_kind(StmtTag::Module)) {
        match stmt.kind() {
            StmtKind::Enum(it) => places.extend(it.members().iter().map(|it| (it.span().start, it.span().start))),
            StmtKind::Module(it) if it.nested().is_some() => {
                let names = std::iter::successors(Some(it), |it| it.nested()).map(|it| it.name_span().start);
                places.extend(names.map(|it| (it, it)));
            }
            _ => {}
        }
    }
    places.sort_unstable();
    places.dedup();
    places
}

/// Nothing in `e` makes oxlint forget that it is in what is called.
fn keeps_callee_flag(e: Expr) -> bool {
    matches!(
        inner(e).tag(),
        ExprTag::Ident | ExprTag::This | ExprTag::String | ExprTag::Number | ExprTag::True | ExprTag::False | ExprTag::Null
    )
}

/// oxlint's `is_callee_of_call_expr` when it comes to `member`: it is in what a call calls, and no member access, call or function
/// is in between or before. `a.b()` reads `a`, and so do `a.b[c]()` and `x[a.b]()`.
fn is_callee_of_call(member: Expr) -> bool {
    let mut child = member;
    while let Node::Expr(parent) = child.parent() {
        let is_kept = match parent.kind() {
            ExprKind::Call(call) => return call.callee() == child,
            ExprKind::Index { obj, .. } => obj == child || keeps_callee_flag(obj),
            ExprKind::Binary { left, .. } => left == child || keeps_callee_flag(left),
            ExprKind::Cond { test, yes, .. } => test == child || keeps_callee_flag(test) && (yes == child || keeps_callee_flag(yes)),
            ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Satisfies { .. }
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Unary { .. }
            | ExprKind::Await(_) => true,
            _ => false,
        };
        if !is_kept {
            return false;
        }
        child = parent;
    }
    false
}

/// oxlint's `ExhaustiveDepsVisitor`. `with_parameters`: not only the body.
fn find_dependencies<'a>(func: Func<'a>, with_parameters: bool) -> Found<'a> {
    let start = match (with_parameters, func.body()) {
        (true, _) => 0,
        (false, FnBody::Expr(body)) => body.outer_span().start,
        (false, _) => func.body_span().map_or(0, |it| it.start),
    };
    let mut idents: Vec<Expr<'a>> = Vec::new();
    let mut scopes = vec![Node::Func(func).scope()];
    while let Some(scope) = scopes.pop() {
        let values = scope.references().filter(|it| it.is_value()).filter_map(Reference::expr);
        idents.extend(values.filter(|it| it.span().start >= start && it.tag() == ExprTag::Ident && !it.is_in_type_query()));
        scopes.extend(scope.children());
    }
    idents.sort_unstable_by_key(|it| it.span().start);
    let mut found = Found::default();
    for ident in idents {
        let Some(name) = ident.as_ident() else {
            continue;
        };
        let mut source = Dependency {
            span: ident.span(),
            name,
            symbol: symbol_of(ident),
            chain: SmallVec::new(),
        };
        // The outermost of `ident.a.b`, and what it is a property of.
        let mut member = None;
        let mut at = ident;
        while let Node::Expr(parent) = outer(at).parent()
            && !ident.is_jsx_tag_name()
            && let Some((obj, property)) = as_static_member(parent)
            && obj == outer(at)
        {
            if let Some((before, property)) = member.replace((parent, property.name())) {
                let before: Expr = before;
                source.span = before.span();
                source.chain.push(property);
            }
            at = parent;
        }
        let Some((member, property)) = member else {
            if let Some(Declared::Variable(declarator)) = source.symbol.and_then(declaration_of)
                && let Some(init) = declarator.init().filter(|it| !it.is_parenthesized())
                && let ExprKind::Call(call) = init.kind()
                && func_call_without_react_namespace(call).is_some_and(|it| it.is_any(&["useState", "useReducer"]))
                && is_second_of_array_pattern(declarator, name)
                && Node::Expr(ident).enclosing_function() == Some(func)
            {
                found.has_set_state_call = true;
            }
            found.insert(source);
            continue;
        };
        if is_callee_of_call(member) {
            found.insert(source);
            continue;
        }
        if property.is("current") {
            found.insert(source.clone());
        }
        source.chain.push(property);
        found.insert(source);
    }
    found
}

/// In a function that a function in `callback` returns: `return () => ..`.
fn is_inside_effect_cleanup<'a>(e: Expr<'a>, callback: Func<'a>) -> bool {
    Node::Expr(e).ancestors().take_while(|it| *it != Node::Func(callback)).any(|it| match it {
        Node::Func(func) => match func.owner() {
            Node::Expr(owner) => !owner.is_parenthesized() && matches!(owner.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Return),
            _ => false,
        },
        _ => false,
    })
}

struct Component<'a> {
    scope: Scope<'a>,
}

impl<'a> Component<'a> {
    fn is_dependency(&self, dependency: &Dependency<'a>) -> bool {
        self.is_dependency_impl(dependency, &mut Vec::new())
    }

    /// `is_identifier_a_dependency_impl`
    fn is_dependency_impl(&self, dependency: &Dependency<'a>, visited: &mut Vec<Symbol<'a>>) -> bool {
        let Some(symbol) = dependency.symbol else {
            return false;
        };
        let Some(declared) = declaration_of(symbol) else {
            return false;
        };
        if scope_of_declaration(symbol, declared) != self.scope {
            return false;
        }
        let span = match declared {
            Declared::Variable(declarator) => declarator.span(),
            Declared::Function(func) => func.estree_span(),
            Declared::Class(class) => class.estree_span(),
            Declared::Parameter(param) => param.span(),
            Declared::Other => Span::empty(0),
        };
        !span.contains(dependency.span) && !self.is_stable_value(declared, symbol, visited)
    }

    fn is_stable_value(&self, declared: Declared<'a>, symbol: Symbol<'a>, visited: &mut Vec<Symbol<'a>>) -> bool {
        if visited.contains(&symbol) {
            return true;
        }
        visited.push(symbol);
        let declarator = match declared {
            Declared::Variable(declarator) => declarator,
            Declared::Function(func) => return func.has_body() && self.is_function_stable(func, None, visited),
            _ => return false,
        };
        let Some(init) = declarator.init().map(inner) else {
            return false;
        };
        match init.kind() {
            ExprKind::Fn(func) => {
                let own = declarator.pat().as_ident().map(|_| symbol);
                self.is_function_stable(func, own, visited)
            }
            ExprKind::True | ExprKind::False | ExprKind::Null | ExprKind::Number(_) | ExprKind::BigInt(_) | ExprKind::String(_) => {
                declarator.var_kind() == VarKind::Const
            }
            ExprKind::Call(call) => {
                let Some(hook) = func_call_without_react_namespace(call) else {
                    return false;
                };
                let is_assigned = || {
                    symbol.references().filter_map(Reference::expr).any(|it| {
                        matches!(it.parent(), Node::Expr(parent) if matches!(parent.kind(), ExprKind::Assign { target, .. } if target == it))
                    })
                };
                hook.is_any(&["useRef", "useEffectEvent"])
                    || hook.is_any(&["useState", "useReducer", "useTransition", "useActionState"])
                        && is_second_of_array_pattern(declarator, symbol.name())
                        && !is_assigned()
            }
            _ => false,
        }
    }

    /// `own`: the variable that the function is the value of.
    fn is_function_stable(&self, func: Func<'a>, own: Option<Symbol<'a>>, visited: &mut Vec<Symbol<'a>>) -> bool {
        let found = find_dependencies(func, false);
        found.dependencies.iter().all(|it| (own.is_none() || it.symbol != own) && !self.is_dependency_impl(it, visited))
    }
}

fn is_expression_referentially_unique(e: Expr) -> bool {
    let e = inner(e);
    match e.kind() {
        ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::New(_) | ExprKind::Regex(_) | ExprKind::Jsx(_) => true,
        ExprKind::Cond { yes, no, .. } => is_expression_referentially_unique(yes) || is_expression_referentially_unique(no),
        ExprKind::Binary {
            op: BinOp::And | BinOp::Or | BinOp::Nullish,
            left,
            right,
        } => is_expression_referentially_unique(left) || is_expression_referentially_unique(right),
        ExprKind::Assign { value, .. } => is_expression_referentially_unique(value),
        _ => false,
    }
}

fn is_declaration_referentially_unique(symbol: Symbol) -> bool {
    match declaration_of(symbol) {
        Some(Declared::Class(_) | Declared::Function(_)) => true,
        Some(Declared::Variable(declarator)) => {
            declarator.pat().tag() == PatTag::Ident && declarator.init().is_some_and(is_expression_referentially_unique)
        }
        _ => false,
    }
}

fn report_missing<'a, R: Rule>(cx: &Cx<'a, R>, hook: Name<'a>, missing: &[(Span, Vec<u8>)], array: Span, mutable: Option<&[u8]>) {
    let Some(first) = missing.first() else {
        return;
    };
    let mut names = Vec::new();
    for (at, (_, name)) in missing.iter().enumerate() {
        names.extend_from_slice(match at {
            0 => b"'",
            _ if at + 1 == missing.len() => b", and '",
            _ => b", '",
        });
        names.extend_from_slice(name);
        names.push(b'\'');
    }
    let mutable = mutable.map_or_else(Vec::new, |it| {
        let (before, after) = (&b". Mutable values like '"[..], &b"' aren't valid dependencies because mutating them doesn't re-render the component."[..]);
        [before, it, after].concat()
    });
    cx.report(first.0, if missing.len() == 1 { MISSING_DEPENDENCY } else { MISSING_DEPENDENCIES })
        .comments_apply_at(array)
        .data("hook", hook)
        .data("dependencies", names)
        .data("mutable", mutable);
}

/// The array without the element at `removed`, as oxc prints it.
fn without_dependency(file: &File, array: Expr, removed: Span) -> Vec<u8> {
    let ExprKind::Array(elements) = array.kind() else {
        return Vec::new();
    };
    let kept: Vec<&[u8]> = elements.iter().filter(|it| it.outer_span() != removed).map(|it| file.slice(it.outer_span())).collect();
    [b"[", &kept.join(&b", "[..])[..], b"]"].concat()
}

/// `call`: any call. `additional_hooks`: the option.
pub(crate) fn run<'a, R: Rule>(cx: &Cx<'a, R>, node: Expr<'a>, additional_hooks: Option<&Regex>) {
    let ExprKind::Call(call) = node.kind() else {
        return;
    };
    let callee = call.callee();
    let Some(hook) = name_without_react_namespace(callee).filter(|_| !callee.is_parenthesized()) else {
        return;
    };
    let callback_index = match hook.bytes() {
        b"useEffect" | b"useLayoutEffect" | b"useCallback" | b"useMemo" => 0,
        b"useImperativeHandle" => 1,
        name if additional_hooks.is_some_and(|it| it.test(name)) => 0,
        _ => return,
    };
    let is_function = |it: &Func| !matches!(it.kind(), FnKind::StaticBlock);
    let Some(component) = Node::Expr(node).ancestors().find_map(|it| it.as_func().filter(is_function)) else {
        return;
    };
    let component = Component {
        scope: Node::Func(component).scope(),
    };
    let args = call.args();
    let Some(callback_node) = args.get(callback_index) else {
        cx.report(node, MISSING_CALLBACK).data("hook", hook);
        return;
    };
    let dependencies_node = args.get(callback_index + 1);
    let is_effect = bun_core::strings::contains(hook.bytes(), b"Effect");
    if dependencies_node.is_none() && !is_effect {
        if hook.is_any(&["useCallback", "useMemo"]) {
            cx.report(node, DEPENDENCY_ARRAY_REQUIRED).data("hook", hook).fix(|fixer| fixer.insert_after(callback_node.outer_span(), ", []"));
        }
        return;
    }

    let callback_expr = inner(callback_node);
    let callback = match callback_expr.kind() {
        ExprKind::Fn(func) => func,
        ExprKind::Ident(name) => {
            let Some(dependencies_node) = dependencies_node else {
                return;
            };
            // Perhaps it is in the array.
            if let ExprKind::Array(elements) = inner(dependencies_node).kind()
                && elements.iter().any(|it| inner(it).as_ident() == Some(name))
            {
                return;
            }
            let Some(symbol) = symbol_of(callback_expr) else {
                return;
            };
            let Some(declared) = declaration_of(symbol) else {
                return;
            };
            if is_strictly_inside(component.scope, scope_of_declaration(symbol, declared)) {
                return;
            }
            let missing = || report_missing(cx, hook, &[(callback_expr.span(), name.bytes().to_vec())], dependencies_node.outer_span(), None);
            match declared {
                Declared::Variable(declarator) => match declarator.init().map(|it| (it.kind(), it.is_parenthesized())) {
                    Some((ExprKind::Fn(func), false)) => func,
                    Some(_) => return missing(),
                    None => return,
                },
                Declared::Function(func) => func,
                Declared::Parameter(_) => return missing(),
                _ => return,
            }
        }
        _ => {
            cx.report(callee, UNKNOWN_DEPENDENCIES).data("hook", hook);
            return;
        }
    };
    if callback.is_async() && is_effect {
        cx.report(callback.estree_span(), ASYNC_EFFECT);
    }

    let array = dependencies_node.and_then(|it| {
        let array = inner(it);
        match array.kind() {
            ExprKind::Array(_) => return Some(array),
            ExprKind::Ident(name) if name.is("undefined") && symbol_of(array).is_none() => {}
            _ => drop(cx.report(it.outer_span(), NOT_ARRAY_LITERAL).data("hook", hook)),
        }
        None
    });

    let found = find_dependencies(callback, true);
    if is_effect && cx.file().mentions("current") {
        report_refs_in_cleanups(cx, callback, &component);
    }
    let Some(array) = array else {
        if is_effect && find_dependencies(callback, false).has_set_state_call {
            cx.report(callee, INFINITE_RERENDER).data("hook", hook);
        }
        return;
    };
    let ExprKind::Array(elements) = array.kind() else {
        return;
    };

    let mut declared: Vec<Dependency<'a>> = Vec::new();
    for element in elements {
        if matches!(element.tag(), ExprTag::Missing) {
            continue;
        }
        if element.tag() == ExprTag::Spread {
            cx.report(element, COMPLEX_EXPRESSION).data("hook", hook);
            continue;
        }
        let element = inner(element);
        match analyze_property_chain(element) {
            Ok(None) => {}
            Ok(Some(dependency)) if declared.contains(&dependency) => drop(cx.report(dependency.span, DUPLICATE)),
            Ok(Some(dependency)) => declared.push(dependency),
            Err(()) => {
                let is_literal = matches!(
                    element.tag(),
                    ExprTag::True | ExprTag::False | ExprTag::Null | ExprTag::Number | ExprTag::BigInt | ExprTag::Regex | ExprTag::String
                );
                match is_literal {
                    true => drop(cx.report(element, LITERAL)),
                    false => drop(cx.report(element, COMPLEX_EXPRESSION).data("hook", hook)),
                }
            }
        }
    }

    for dependency in &declared {
        if let Some(symbol) = dependency.symbol {
            let is_ref_current = dependency.chain.len() == 1 && dependency.ends_in_current() && !component.is_dependency(dependency);
            if !is_strictly_inside(component.scope, symbol.scope()) && !is_ref_current {
                continue;
            }
        }
        cx.report(dependency.span, UNNECESSARY_OUTER_SCOPE)
            .data("hook", hook)
            .data("dependency", dependency.name)
            .fix(|fixer| fixer.replace(array, without_dependency(cx.file(), array, dependency.span)));
    }

    let mut undeclared: Vec<&Dependency<'a>> = (found.dependencies.iter())
        .filter(|it| !declared.contains(it))
        // What is read of `foo.current` counts for `foo`.
        .filter(|it| !(it.ends_in_current() && found.dependencies.contains(&it.base())))
        .filter(|it| !declared.iter().any(|declared| it.contains(declared)))
        .filter(|it| component.is_dependency(it))
        .collect();
    if undeclared.len() > 1 {
        let order = found.order_of_oxlint(cx.file());
        undeclared.sort_by_cached_key(|wanted| {
            let at = found.dependencies.iter().position(|it| it == *wanted);
            order.iter().position(|it| Some(*it as usize) == at)
        });
    }
    if !undeclared.is_empty() {
        let mutable = declared.iter().find(|it| it.ends_in_current() && undeclared.iter().any(|missing| **missing == it.base()));
        let missing: Vec<(Span, Vec<u8>)> = undeclared.iter().map(|it| (it.span, it.text())).collect();
        report_missing(cx, hook, &missing, array.span(), mutable.map(Dependency::text).as_deref());
    }

    for dependency in &declared {
        if let Some(Declared::Variable(declarator)) = dependency.symbol.and_then(declaration_of)
            && let Some(init) = declarator.init().filter(|it| !it.is_parenthesized())
            && let ExprKind::Call(call) = init.kind()
            && func_call_without_react_namespace(call).is_some_and(|it| it.is("useEffectEvent"))
        {
            cx.report(dependency.span, USE_EFFECT_EVENT);
        }
    }

    // Effects may have more dependencies than they need.
    if !is_effect {
        let unnecessary = |dependency: &Dependency| {
            cx.report(array, UNNECESSARY_DEPENDENCY).data("hook", hook).data("dependency", dependency.text());
        };
        for (at, a) in declared.iter().enumerate() {
            for b in &declared[at + 1..] {
                if a.contains(b) {
                    unnecessary(a);
                } else if b.contains(a) {
                    unnecessary(b);
                }
            }
        }
        for dependency in declared.iter().filter(|it| !found.dependencies.contains(it)) {
            let is_needed = found.dependencies.iter().any(|it| it.contains(dependency))
                || undeclared.iter().any(|it| dependency.contains(it))
                || declared.iter().any(|it| it != dependency && dependency.contains(it));
            if !is_needed {
                unnecessary(dependency);
            }
        }
    }

    for dependency in &declared {
        if let Some(symbol) = dependency.symbol.filter(|it| dependency.chain.is_empty() && is_declaration_referentially_unique(*it)) {
            cx.report(dependency.span, CHANGES_EVERY_RENDER).data("hook", hook).data("dependency", symbol.name());
        }
    }
}

fn report_refs_in_cleanups<'a, R: Rule>(cx: &Cx<'a, R>, callback: Func<'a>, component: &Component<'a>) {
    let within = callback.estree_span();
    for member in cx.file().exprs_of_kind(ExprTag::Dot) {
        let Some((obj, _)) = as_static_member(member).filter(|it| it.1.name().is("current") && within.contains(member.span())) else {
            continue;
        };
        if !is_inside_effect_cleanup(member, callback) {
            continue;
        }
        let obj = inner(obj);
        if obj.tag() == ExprTag::Ident
            && let Some(symbol) = symbol_of(obj)
        {
            // `ref.current` on either side of an assignment.
            let is_written = symbol.references().filter_map(Reference::expr).any(|it| {
                matches!(it.parent(), Node::Expr(parent) if !it.is_parenthesized()
                    && !parent.is_parenthesized()
                    && as_static_member(parent).is_some_and(|it| it.1.name().is("current"))
                    && matches!(parent.parent(), Node::Expr(assignment) if assignment.tag() == ExprTag::Assign))
            });
            if is_written || declaration_of(symbol).is_some_and(|it| scope_of_declaration(symbol, it) != component.scope) {
                continue;
            }
        }
        cx.report(member, REF_IN_CLEANUP);
    }
}
