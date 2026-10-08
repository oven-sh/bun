//! `react/exhaustive-deps` of oxlint 1.80, which is a rule of its own more than a port of `react-hooks/exhaustive-deps`: it has other
//! messages, reports each dependency that is not needed by itself, and has its own notion of what a dependency is.
//!
//! oxlint walks the callback. Here the references in it are looked at, each with what is around it.

use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::{FxHashMap, FxHashSet};
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

    fn ends_in_current(&self) -> bool {
        self.chain.last().is_some_and(|it| it.is("current"))
    }
}

/// What is known about `name.chain[0].chain[1]`.
#[derive(Default)]
struct Path {
    /// What it is a property of. 0 for a variable.
    base: u32,
    /// It is read in the function.
    is_found: bool,
    /// It or a property of it is read in the function.
    is_found_within: bool,
    /// Its position in the array of dependencies, and 1.
    declared: u32,
    /// It is read in the function and missing in the array.
    is_undeclared: bool,
}

/// The dependencies of one function, as a tree: a dependency is a property of another if that is above it.
struct Paths<'a> {
    /// The first is above the variables.
    list: Vec<Path>,
    /// The number of a path, by the number of what it is a property of and its last name.
    properties: FxHashMap<(u32, Name<'a>), u32>,
}

impl Default for Paths<'_> {
    fn default() -> Self {
        Paths {
            list: vec![Path::default()],
            properties: FxHashMap::default(),
        }
    }
}

impl<'a> Paths<'a> {
    /// The number of `dependency`. Calls `on_the_way` with what it is a property of, from the variable on, and with itself.
    fn number_of(&mut self, dependency: &Dependency<'a>, mut on_the_way: impl FnMut(&mut Path)) -> u32 {
        let mut at = 0;
        for name in std::iter::once(&dependency.name).chain(&dependency.chain) {
            at = *self.properties.entry((at, *name)).or_insert_with(|| {
                self.list.push(Path {
                    base: at,
                    ..Path::default()
                });
                self.list.len() as u32 - 1
            });
            on_the_way(&mut self.list[at as usize]);
        }
        at
    }

    fn get(&self, path: u32) -> &Path {
        &self.list[path as usize]
    }

    fn get_mut(&mut self, path: u32) -> &mut Path {
        &mut self.list[path as usize]
    }

    fn base(&self, path: u32) -> &Path {
        self.get(self.get(path).base)
    }

    /// What `path` is a property of, the nearest first.
    fn above(&self, path: u32) -> impl Iterator<Item = &Path> {
        std::iter::successors(Some(self.get(path).base), |it| Some(self.get(*it).base)).take_while(|it| *it != 0).map(|it| self.get(it))
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

/// `StaticMemberExpression`, of what is known not to be in the name of a tag.
fn as_static_member_outside_tags<'a>(e: Expr<'a>) -> Option<(Expr<'a>, Ident<'a>)> {
    match e.kind() {
        ExprKind::Dot { obj, name, .. } if !name.bytes().starts_with(b"#") && !e.is_in_type_query() => Some((obj, name)),
        _ => None,
    }
}

/// `StaticMemberExpression`
fn as_static_member<'a>(e: Expr<'a>) -> Option<(Expr<'a>, Ident<'a>)> {
    as_static_member_outside_tags(e).filter(|_| !e.is_jsx_tag_name())
}

fn symbol_of(ident: Expr) -> Option<Symbol> {
    ident.reference()?.symbol()
}

/// `Err`: it is not a chain of properties. `Ok(None)`: of a JSX element.
fn analyze_property_chain(e: Expr) -> Result<Option<Dependency>, ()> {
    let e = inner(e);
    if e.tag() == ExprTag::Dot && e.is_jsx_tag_name() {
        return Err(());
    }
    let mut chain = SmallVec::new();
    let mut object = e;
    loop {
        match object.kind() {
            ExprKind::Ident(name) => {
                chain.reverse();
                return Ok(Some(Dependency {
                    span: e.span(),
                    name,
                    symbol: symbol_of(object),
                    chain,
                }));
            }
            ExprKind::Jsx(jsx) if jsx.tag().is_some() => return Ok(None),
            _ => {
                let (obj, name) = as_static_member_outside_tags(object).ok_or(())?;
                chain.push(name.name());
                object = inner(obj);
            }
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
    /// The number of each of `dependencies` in `paths`.
    numbers: Vec<u32>,
    /// By the number in `paths`, for those that are found: the position in `dependencies`.
    positions: FxHashMap<u32, u32>,
    paths: Paths<'a>,
    /// Every time that one was found: its position in `dependencies`.
    inserted: Vec<u32>,
    /// A function that `useState` or `useReducer` returns is named, outside the functions in the function.
    has_set_state_call: bool,
}

impl<'a> Found<'a> {
    fn insert(&mut self, dependency: Dependency<'a>) {
        let number = self.paths.number_of(&dependency, |it| it.is_found_within = true);
        let at = *self.positions.entry(number).or_insert_with(|| {
            self.paths.get_mut(number).is_found = true;
            self.dependencies.push(dependency);
            self.numbers.push(number);
            self.dependencies.len() as u32 - 1
        });
        self.inserted.push(at);
    }

    /// The positions in `dependencies` in the order in which oxlint has them, which is that of its hash table. It names what is
    /// missing in that order, and prints the report where the first is. The same hashes in the same table give the same order.
    /// `symbols`: [`places_of_symbols`].
    fn order_of_oxlint(&self, symbols: &[(u32, u32)]) -> Vec<u32> {
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
    let mut enclosing_function = AncestorMemo::default();
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
        let is_in_tag = ident.is_jsx_tag_name();
        while !is_in_tag
            && let Node::Expr(parent) = outer(at).parent()
            && let Some((obj, property)) = as_static_member_outside_tags(parent)
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
                && enclosing_function.find(Node::Expr(ident), |_, parent| parent.as_func()) == Some(func)
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

/// In a function that a function in `callback` returns: `return () => ..`. `known`: what is known for `callback`.
fn is_inside_effect_cleanup<'a>(e: Expr<'a>, callback: Func<'a>, known: &mut AncestorMemo<'a, bool>) -> bool {
    let is_inside = known.find(Node::Expr(e), |_, parent| match parent {
        Node::Func(func) if func == callback => Some(false),
        Node::Func(func) => match func.owner() {
            Node::Expr(owner) if !owner.is_parenthesized() => {
                matches!(owner.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Return).then_some(true)
            }
            _ => None,
        },
        _ => None,
    });
    is_inside == Some(true)
}

/// What is the same for all calls in a file.
#[derive(Default)]
pub(crate) struct Memo<'a> {
    /// Whether the value of a variable of a component is the same on every render.
    is_stable: FxHashMap<Symbol<'a>, bool>,
    /// Whether `variable.current` is on either side of an assignment.
    is_current_written: FxHashMap<Symbol<'a>, bool>,
    /// [`places_of_symbols`]
    places_of_symbols: Option<Vec<(u32, u32)>>,
    /// The `a.current` of the file, in the order of the source.
    currents: Option<Vec<Expr<'a>>>,
    /// The function around something.
    function_around: AncestorMemo<'a, Func<'a>>,
}

struct Component<'a> {
    scope: Scope<'a>,
}

/// What tells whether the value of a variable is the same on every render.
enum Stability<'a> {
    Known(bool),
    /// It is, if what the function reads is. With the variable that the function is the value of.
    OfFunction(Func<'a>, Option<Symbol<'a>>),
}

impl<'a> Component<'a> {
    /// `is_identifier_a_dependency`
    fn is_dependency(&self, dependency: &Dependency<'a>, memo: &mut Memo<'a>) -> bool {
        self.variable_of_component(dependency).is_some_and(|it| !self.is_stable_value(it.0, it.1, memo))
    }

    /// The variable, if `dependency` is a dependency unless the value of the variable is stable.
    fn variable_of_component(&self, dependency: &Dependency<'a>) -> Option<(Symbol<'a>, Declared<'a>)> {
        let symbol = dependency.symbol?;
        let declared = declaration_of(symbol)?;
        if scope_of_declaration(symbol, declared) != self.scope {
            return None;
        }
        let span = match declared {
            Declared::Variable(declarator) => declarator.span(),
            Declared::Function(func) => func.estree_span(),
            Declared::Class(class) => class.estree_span(),
            Declared::Parameter(param) => param.span(),
            Declared::Other => Span::empty(0),
        };
        (!span.contains(dependency.span)).then_some((symbol, declared))
    }

    fn stability(declared: Declared<'a>, symbol: Symbol<'a>) -> Stability<'a> {
        let declarator = match declared {
            Declared::Variable(declarator) => declarator,
            Declared::Function(func) if func.has_body() => return Stability::OfFunction(func, None),
            _ => return Stability::Known(false),
        };
        let Some(init) = declarator.init().map(inner) else {
            return Stability::Known(false);
        };
        Stability::Known(match init.kind() {
            ExprKind::Fn(func) => return Stability::OfFunction(func, declarator.pat().as_ident().map(|_| symbol)),
            ExprKind::True | ExprKind::False | ExprKind::Null | ExprKind::Number(_) | ExprKind::BigInt(_) | ExprKind::String(_) => {
                declarator.var_kind() == VarKind::Const
            }
            ExprKind::Call(call) => {
                let Some(hook) = func_call_without_react_namespace(call) else {
                    return Stability::Known(false);
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
        })
    }

    /// The variables of the component that `func` reads. `None` if it reads `own`, the variable that it is the value of.
    fn variables_read_in(&self, func: Func<'a>, own: Option<Symbol<'a>>) -> Option<Vec<(Symbol<'a>, Declared<'a>)>> {
        let found = find_dependencies(func, false);
        if own.is_some() && found.dependencies.iter().any(|it| it.symbol == own) {
            return None;
        }
        Some(found.dependencies.iter().filter_map(|it| self.variable_of_component(it)).collect())
    }

    /// oxlint's `is_stable_value`, which takes a function that it is looking at already for stable: so the value of a variable is
    /// stable unless an unstable one can be reached from it, from a function to what it reads. The functions that read each other
    /// are found as the strongly connected components of a graph are, so that each function is looked at once in a file.
    fn is_stable_value(&self, symbol: Symbol<'a>, declared: Declared<'a>, memo: &mut Memo<'a>) -> bool {
        struct Frame<'a> {
            symbol: Symbol<'a>,
            reads: Vec<(Symbol<'a>, Declared<'a>)>,
            next: usize,
            number: usize,
            /// The least number of the functions in `open` that can be reached from it.
            lowest: usize,
        }
        if let Some(&known) = memo.is_stable.get(&symbol) {
            return known;
        }
        let mut stack: Vec<Frame<'a>> = Vec::new();
        // The functions that have been entered, and from which one in `stack` can be reached.
        let mut open: Vec<Symbol<'a>> = Vec::new();
        let mut numbers: FxHashMap<Symbol<'a>, usize> = FxHashMap::default();
        let mut entering = Some((symbol, declared));
        loop {
            if let Some((symbol, declared)) = entering.take() {
                let reads = match Self::stability(declared, symbol) {
                    Stability::Known(true) => {
                        memo.is_stable.insert(symbol, true);
                        None
                    }
                    Stability::Known(false) => Some(None),
                    Stability::OfFunction(func, own) => Some(self.variables_read_in(func, own)),
                };
                match reads {
                    None => {}
                    Some(None) => {
                        memo.is_stable.insert(symbol, false);
                        break;
                    }
                    Some(Some(reads)) => {
                        let number = numbers.len();
                        numbers.insert(symbol, number);
                        open.push(symbol);
                        stack.push(Frame {
                            symbol,
                            reads,
                            next: 0,
                            number,
                            lowest: number,
                        });
                    }
                }
            }
            let Some(top) = stack.last_mut() else {
                return true;
            };
            if let Some(&read) = top.reads.get(top.next) {
                top.next += 1;
                match (memo.is_stable.get(&read.0), numbers.get(&read.0)) {
                    (Some(true), _) => {}
                    (Some(false), _) => break,
                    (None, Some(&number)) => top.lowest = top.lowest.min(number),
                    (None, None) => entering = Some(read),
                }
                continue;
            }
            let (symbol, number, lowest) = (top.symbol, top.number, top.lowest);
            stack.pop();
            if lowest == number {
                while let Some(stable) = open.pop() {
                    memo.is_stable.insert(stable, true);
                    if stable == symbol {
                        break;
                    }
                }
            }
            if let Some(below) = stack.last_mut() {
                below.lowest = below.lowest.min(lowest);
            }
        }
        memo.is_stable.extend(open.into_iter().map(|it| (it, false)));
        false
    }
}

fn is_expression_referentially_unique(e: Expr) -> bool {
    let mut values: SmallVec<[Expr; 8]> = smallvec::smallvec![e];
    while let Some(value) = values.pop() {
        match inner(value).kind() {
            ExprKind::Array(_) | ExprKind::Object(_) | ExprKind::Fn(_) | ExprKind::Class(_) | ExprKind::New(_) | ExprKind::Regex(_) | ExprKind::Jsx(_) => {
                return true;
            }
            ExprKind::Cond { yes, no, .. } => values.extend([yes, no]),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => values.extend([left, right]),
            ExprKind::Assign { value, .. } => values.push(value),
            _ => {}
        }
    }
    false
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
pub(crate) fn run<'a, R: Rule>(cx: &Cx<'a, R>, node: Expr<'a>, additional_hooks: Option<&Regex>, memo: &mut Memo<'a>) {
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
    let Some(component) = memo.function_around.find(Node::Expr(node), |_, parent| parent.as_func().filter(is_function)) else {
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

    let mut found = find_dependencies(callback, true);
    if is_effect && cx.file().mentions("current") {
        report_refs_in_cleanups(cx, callback, &component, memo);
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

    // Each with its number in `found.paths`.
    let mut declared: Vec<(Dependency<'a>, u32)> = Vec::new();
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
            Ok(Some(dependency)) => {
                let number = found.paths.number_of(&dependency, |_| {});
                let path = found.paths.get_mut(number);
                if path.declared != 0 {
                    cx.report(dependency.span, DUPLICATE);
                } else {
                    declared.push((dependency, number));
                    path.declared = declared.len() as u32;
                }
            }
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

    for (dependency, _) in &declared {
        if let Some(symbol) = dependency.symbol {
            let is_ref_current = dependency.chain.len() == 1 && dependency.ends_in_current() && !component.is_dependency(dependency, memo);
            if !is_strictly_inside(component.scope, symbol.scope()) && !is_ref_current {
                continue;
            }
        }
        cx.report(dependency.span, UNNECESSARY_OUTER_SCOPE)
            .data("hook", hook)
            .data("dependency", dependency.name)
            .fix(|fixer| fixer.replace(array, without_dependency(cx.file(), array, dependency.span)));
    }

    // Their positions in `found.dependencies`.
    let mut undeclared: Vec<usize> = (found.dependencies.iter().zip(&found.numbers).enumerate())
        .filter(|(_, (_, number))| found.paths.get(**number).declared == 0)
        // What is read of `foo.current` counts for `foo`.
        .filter(|(_, (it, number))| !(it.ends_in_current() && found.paths.base(**number).is_found))
        .filter(|(_, (_, number))| !found.paths.above(**number).any(|it| it.declared != 0))
        .filter(|(_, (it, _))| component.is_dependency(it, memo))
        .map(|it| it.0)
        .collect();
    if undeclared.len() > 1 {
        let symbols = memo.places_of_symbols.get_or_insert_with(|| places_of_symbols(cx.file()));
        let mut ranks = vec![0; found.dependencies.len()];
        for (rank, at) in found.order_of_oxlint(symbols).into_iter().enumerate() {
            if let Some(it) = ranks.get_mut(at as usize) {
                *it = rank;
            }
        }
        undeclared.sort_by_key(|at| ranks.get(*at).copied());
    }
    for number in undeclared.iter().filter_map(|at| found.numbers.get(*at)) {
        found.paths.get_mut(*number).is_undeclared = true;
    }
    let paths = &found.paths;
    if !undeclared.is_empty() {
        let mutable = declared.iter().find(|(it, number)| it.ends_in_current() && paths.base(*number).is_undeclared);
        let missing: Vec<(Span, Vec<u8>)> = undeclared.iter().filter_map(|at| found.dependencies.get(*at)).map(|it| (it.span, it.text())).collect();
        report_missing(cx, hook, &missing, array.span(), mutable.map(|it| it.0.text()).as_deref());
    }

    for (dependency, _) in &declared {
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
        // The pairs of which one is a property of the other: the positions of the first and of the second in the array, and that of
        // the property.
        let mut pairs: Vec<(usize, usize, usize)> = Vec::new();
        for (at, (_, number)) in declared.iter().enumerate() {
            let above = paths.above(*number).filter_map(|it| (it.declared as usize).checked_sub(1));
            pairs.extend(above.map(|other| (at.min(other), at.max(other), at)));
        }
        pairs.sort_unstable();
        for (dependency, _) in pairs.iter().filter_map(|it| declared.get(it.2)) {
            unnecessary(dependency);
        }
        for (dependency, number) in declared.iter().filter(|it| !paths.get(it.1).is_found) {
            let is_needed = paths.get(*number).is_found_within
                || paths.get(*number).is_undeclared
                || paths.above(*number).any(|it| it.is_undeclared || it.declared != 0);
            if !is_needed {
                unnecessary(dependency);
            }
        }
    }

    for (dependency, _) in &declared {
        if let Some(symbol) = dependency.symbol.filter(|it| dependency.chain.is_empty() && is_declaration_referentially_unique(*it)) {
            cx.report(dependency.span, CHANGES_EVERY_RENDER).data("hook", hook).data("dependency", symbol.name());
        }
    }
}

fn report_refs_in_cleanups<'a, R: Rule>(cx: &Cx<'a, R>, callback: Func<'a>, component: &Component<'a>, memo: &mut Memo<'a>) {
    let within = callback.estree_span();
    let currents = memo.currents.get_or_insert_with(|| {
        let is_current = |it: &Expr| as_static_member(*it).is_some_and(|it| it.1.name().is("current"));
        let mut currents: Vec<Expr<'a>> = cx.file().exprs_of_kind(ExprTag::Dot).filter(is_current).collect();
        currents.sort_unstable_by_key(|it| it.span().start);
        currents
    });
    let first = currents.partition_point(|it| it.span().start < within.start);
    let mut inside_effect_cleanup = AncestorMemo::default();
    for &member in currents[first..].iter().take_while(|it| it.span().start < within.end) {
        let Some((obj, _)) = as_static_member_outside_tags(member).filter(|_| within.contains(member.span())) else {
            continue;
        };
        if !is_inside_effect_cleanup(member, callback, &mut inside_effect_cleanup) {
            continue;
        }
        let obj = inner(obj);
        if obj.tag() == ExprTag::Ident
            && let Some(symbol) = symbol_of(obj)
        {
            // `ref.current` on either side of an assignment.
            let is_written = *memo.is_current_written.entry(symbol).or_insert_with(|| {
                symbol.references().filter_map(Reference::expr).any(|it| {
                    matches!(it.parent(), Node::Expr(parent) if !it.is_parenthesized()
                        && !parent.is_parenthesized()
                        && as_static_member(parent).is_some_and(|it| it.1.name().is("current"))
                        && matches!(parent.parent(), Node::Expr(assignment) if assignment.tag() == ExprTag::Assign))
                })
            });
            if is_written || declaration_of(symbol).is_some_and(|it| scope_of_declaration(symbol, it) != component.scope) {
                continue;
            }
        }
        cx.report(member, REF_IN_CLEANUP);
    }
}
