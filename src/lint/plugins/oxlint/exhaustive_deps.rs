//! oxlint 1.87's `react/exhaustive-deps`. It's more a separate rule than a port of `react-hooks/exhaustive-deps`: it
//! has different messages, reports each unnecessary dependency separately, and has its own definition of a dependency.
//!
//! oxlint walks the callback. This port instead goes through the references in the callback and looks at each one's
//! ancestors.

use bun_lint::prelude::*;
use bun_lint::types::IdMap;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::codegen::{Codegen, print_expression};
use bun_lint_oxlint::hash_order::HashOrder;
use rustc_hash::{FxBuildHasher, FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::hash::{BuildHasher, Hash, Hasher};

const MISSING_CALLBACK: Message =
    Message::new("", "React hook {{hook}} requires an effect callback.");
const DEPENDENCY_ARRAY_REQUIRED: Message = Message::new(
    "",
    "React Hook {{hook}} does nothing when called with only one argument.",
);
const UNKNOWN_DEPENDENCIES: Message = Message::new(
    "",
    "React Hook {{hook}} received a function whose dependencies are unknown.",
);
const ASYNC_EFFECT: Message = Message::new(
    "",
    "Effect callbacks are synchronous to prevent race conditions.",
);
const MISSING_DEPENDENCY: Message = Message::new(
    "",
    "React Hook {{hook}} has a missing dependency: {{dependencies}}{{mutable}}",
);
const MISSING_DEPENDENCIES: Message = Message::new(
    "",
    "React Hook {{hook}} has missing dependencies: {{dependencies}}{{mutable}}",
);
const INCLUDE_OR_REMOVE: Message =
    Message::new("", "Either include it or remove the dependency array.");
const UNNECESSARY_DEPENDENCY: Message = Message::new(
    "",
    "React Hook {{hook}} has unnecessary dependency: {{dependency}}",
);
const NOT_ARRAY_LITERAL: Message = Message::new(
    "",
    "React Hook {{hook}} was passed a dependency list that is not an array literal. This means we can't statically verify whether you've passed the correct dependencies.",
);
const LITERAL: Message = Message::new(
    "",
    "The literal is not a valid dependency because it never changes.",
);
const DUPLICATE: Message = Message::new(
    "",
    "This dependency is specified more than once in the dependency array.",
);
const COMPLEX_EXPRESSION: Message = Message::new(
    "",
    "React Hook {{hook}} has a complex expression in the dependency array.",
);
const CHANGES_EVERY_RENDER: Message = Message::new(
    "",
    "React hook {{hook}} depends on `{{dependency}}`, which changes every render",
);
const MEMOIZE: Message = Message::new(
    "",
    "Try memoizing this variable with `useRef` or `useCallback`.",
);
const UNNECESSARY_OUTER_SCOPE: Message = Message::new(
    "",
    "React Hook {{hook}} has an unnecessary dependency: {{dependency}}.",
);
const INFINITE_RERENDER: Message = Message::new(
    "",
    "React Hook {{hook}} contains a call to setState. Without a list of dependencies, this can lead to an infinite chain of updates.",
);
const REF_IN_CLEANUP: Message = Message::new(
    "",
    "The ref's value `.current` is accessed directly in the effect cleanup function.",
);
const USE_EFFECT_EVENT: Message = Message::new(
    "",
    "Functions returned from `useEffectEvent` must not be included in the dependency array.",
);

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

/// The state of one path `name.chain[0].chain[1]`.
#[derive(Default)]
struct Path {
    /// The path it's a property of. 0 for a variable.
    base: u32,
    /// True if it's read in the function.
    is_found: bool,
    /// True if it or one of its properties is read in the function.
    is_found_within: bool,
    /// Its index in the dependency array plus 1, or 0 if it isn't there.
    declared: u32,
    /// True if it's read in the function but missing from the array.
    is_undeclared: bool,
}

/// One function's dependencies as a tree, where a property's parent is the path it's a property of.
struct Paths<'a> {
    /// The first entry is the root, the parent of all variables.
    list: Vec<Path>,
    /// Maps a parent path's number and a property name to the property's path number.
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
    /// Returns `dependency`'s path number. Calls `visit` with each path from the variable down to `dependency`
    /// itself.
    fn number_of(&mut self, dependency: &Dependency<'a>, mut visit: impl FnMut(&mut Path)) -> u32 {
        let mut at = 0;
        for name in std::iter::once(&dependency.name).chain(&dependency.chain) {
            at = *self.properties.entry((at, *name)).or_insert_with(|| {
                self.list.push(Path {
                    base: at,
                    ..Path::default()
                });
                self.list.len() as u32 - 1
            });
            visit(&mut self.list[at as usize]);
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

    /// The ancestors of `path`, nearest first.
    fn above(&self, path: u32) -> impl Iterator<Item = &Path> {
        std::iter::successors(Some(self.get(path).base), |it| Some(self.get(*it).base))
            .take_while(|it| *it != 0)
            .map(|it| self.get(it))
    }
}

/// oxc's `get_inner_expression`. Parentheses aren't nodes in our tree.
fn inner(mut e: Expr) -> Expr {
    while matches!(
        e.tag(),
        ExprTag::As
            | ExprTag::AsConst
            | ExprTag::Satisfies
            | ExprTag::NonNull
            | ExprTag::Instantiation
    ) && let Some(operand) = e.operand()
    {
        e = operand;
    }
    e
}

/// The opposite of [`inner`]: `e` including the type-only wrappers around it.
fn outer(mut e: Expr) -> Expr {
    while let Node::Expr(parent) = e.parent()
        && matches!(
            parent.tag(),
            ExprTag::As
                | ExprTag::AsConst
                | ExprTag::Satisfies
                | ExprTag::NonNull
                | ExprTag::Instantiation
        )
    {
        e = parent;
    }
    e
}

/// `StaticMemberExpression`, for an expression that's known not to be part of a JSX tag name.
fn as_static_member_outside_tags<'a>(e: Expr<'a>) -> Option<(Expr<'a>, Ident<'a>)> {
    match e.kind() {
        ExprKind::Dot { obj, name, .. }
            if !name.bytes().starts_with(b"#") && !e.is_in_type_query() =>
        {
            Some((obj, name))
        }
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

/// `Err` if `e` isn't a property chain. `Ok(None)` if the chain starts at a JSX element.
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

/// Returns `useEffect` for both `useEffect` and `React.useEffect`.
fn name_without_react_namespace(callee: Expr) -> Option<Name> {
    match callee.as_ident() {
        Some(name) => Some(name),
        None => callee
            .object()
            .filter(|it| inner(*it).is_ident("React"))
            .and_then(|_| as_static_member(callee))
            .map(|it| it.1.name()),
    }
}

fn func_call_without_react_namespace(call: Call) -> Option<Name> {
    name_without_react_namespace(inner(call.callee()))
}

/// The kinds of node that oxc's `symbol_declaration` returns.
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
        declaration @ Declaration::Var(_) if !declaration.is_catch_parameter() => {
            match declaration.node() {
                Some(Node::VarDecl(declarator)) => Declared::Variable(declarator),
                _ => Declared::Other,
            }
        }
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

/// The scope that contains the declaring node. For a `var` in a block, that's the block.
fn scope_of_declaration<'a>(symbol: Symbol<'a>, declared: Declared<'a>) -> Scope<'a> {
    match declared {
        Declared::Variable(declarator) => Node::VarDecl(declarator).scope(),
        Declared::Function(func) => func.owner().parent().scope(),
        Declared::Parameter(param) => param
            .func()
            .map_or_else(|| symbol.scope(), |it| Node::Func(it).scope()),
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
    elements.get(1).is_some_and(|it| {
        it.default().is_none() && !it.is_rest() && it.pat().and_then(Pat::as_ident) == Some(name)
    })
}

/// The dependencies that a function reads.
#[derive(Default)]
struct Found<'a> {
    /// In source order, each with its number in `paths`.
    dependencies: Vec<(Dependency<'a>, u32)>,
    /// Maps a number in `paths` and a variable to the index in `dependencies`. The variable is part of the key because
    /// oxlint hashes it: a nested function's parameter is distinct from an outer variable with the same name.
    positions: FxHashMap<(u32, Option<Symbol<'a>>), u32>,
    paths: Paths<'a>,
    /// One entry per `insert` call, including repeats: the index in `dependencies`.
    inserted: Vec<u32>,
    /// True if a setter returned by `useState` or `useReducer` is referenced outside of nested functions.
    has_set_state_call: bool,
}

impl<'a> Found<'a> {
    fn insert(&mut self, dependency: Dependency<'a>) {
        let number = self
            .paths
            .number_of(&dependency, |it| it.is_found_within = true);
        let at = *self
            .positions
            .entry((number, dependency.symbol))
            .or_insert_with(|| {
                self.paths.get_mut(number).is_found = true;
                self.dependencies.push((dependency, number));
                self.dependencies.len() as u32 - 1
            });
        self.inserted.push(at);
    }

    /// The indices into `dependencies` in the iteration order of oxlint's hash table. oxlint lists the missing
    /// dependencies in that order and puts the report at the first. Inserting the same hashes into the same kind of
    /// table reproduces the order. `symbols` comes from [`symbol_sort_keys`].
    fn oxlint_report_order(&self, symbols: &[(u32, u32)]) -> Vec<u32> {
        let dependency = |at: &u32| Some((&self.dependencies.get(*at as usize)?.0, *at));
        hashbrown_table_order(&mut self.inserted.iter().filter_map(dependency), symbols)
    }
}

/// Inserts `inserted` one by one into a model of oxlint's hash table, and returns their numbers in its iteration order.
fn hashbrown_table_order<'d, 'a>(
    inserted: &mut dyn Iterator<Item = (&'d Dependency<'a>, u32)>,
    symbols: &[(u32, u32)],
) -> Vec<u32> {
    let (mut seen, mut table): (FxHashSet<Hashed>, HashOrder<u32>) =
        (FxHashSet::default(), HashOrder::new());
    for (dependency, at) in inserted {
        let sort_key = dependency.symbol.and_then(symbol_sort_key);
        let hashed = Hashed {
            dependency,
            // oxc stores the id XORed with `u32::MAX`, so that `u32::MAX` is stored as 0, and hashes the stored value.
            symbol: sort_key
                .and_then(|it| symbols.binary_search(&it).ok())
                .map(|it| it as u32 ^ u32::MAX),
        };
        let hash = FxBuildHasher.hash_one(&hashed);
        match seen.insert(hashed) {
            true => table.insert(hash, at),
            false => table.insert_again(),
        }
    }
    table.iter().collect()
}

/// The position of each of `declared` in the iteration order of oxlint's hash table.
fn table_positions<'a>(
    declared: &[(Dependency<'a>, u32)],
    file: &'a File<'a>,
    memo: &mut Memo<'a>,
) -> Vec<usize> {
    let symbols = memo
        .symbol_sort_keys
        .get_or_insert_with(|| symbol_sort_keys(file));
    let mut inserted = (declared.iter().enumerate()).map(|(at, it)| (&it.0, at as u32));
    let mut table_ranks = vec![0; declared.len()];
    for (table_rank, at) in hashbrown_table_order(&mut inserted, symbols)
        .into_iter()
        .enumerate()
    {
        if let Some(it) = table_ranks.get_mut(at as usize) {
            *it = table_rank;
        }
    }
    table_ranks
}

/// Sorts `positions`, which are indices into `declared`, into the order oxlint visits them.
fn sort_in_oxlint_order<'a>(
    positions: &mut [usize],
    declared: &[(Dependency<'a>, u32)],
    file: &'a File<'a>,
    memo: &mut Memo<'a>,
) {
    if positions.len() > 1 {
        let table_ranks = table_positions(declared, file, memo);
        utils::sort::sort_unstable_by_key(positions, |at| table_ranks.get(*at).copied());
    }
}

/// A dependency that hashes and compares like oxlint's `Dependency`.
struct Hashed<'d, 'a> {
    dependency: &'d Dependency<'a>,
    /// oxc's `SymbolId`
    symbol: Option<u32>,
}

/// Hashes `text` the way `str` is hashed.
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

/// The start of the node that declares the symbol, and the start of its name. oxc numbers symbols in that order.
fn symbol_sort_key(symbol: Symbol) -> Option<(u32, u32)> {
    let sort_keys = symbol.declarations().filter_map(|declaration| {
        let name = declaration.name_span()?.start;
        let node = match declaration {
            Declaration::Var(_) => declaration.node()?.span().start,
            // In oxc `this` isn't a parameter.
            Declaration::Param(_) if symbol.name().is("this") => return None,
            Declaration::Param(pat) => {
                Node::Pat(pat)
                    .ancestors()
                    .find(|it| matches!(it, Node::Param(_)))?
                    .span()
                    .start
            }
            Declaration::Class(class) => class.estree_span().start,
            Declaration::Other => return None,
            _ => name,
        };
        Some((node, name))
    });
    sort_keys.min()
}

/// The [`symbol_sort_key`] of every symbol, sorted. ESLint's scopes have a class's and an enum's name twice.
fn symbol_sort_keys<'a>(file: &'a File<'a>) -> Vec<(u32, u32)> {
    let mut sort_keys: Vec<(u32, u32)> = file.symbols().filter_map(symbol_sort_key).collect();
    // Add the symbols that ESLint has no variable for: an enum member with a computed name, and the names in `namespace
    // A.B.C`.
    for stmt in file
        .stmts_of_kind(StmtTag::Enum)
        .chain(file.stmts_of_kind(StmtTag::Module))
    {
        match stmt.kind() {
            StmtKind::Enum(it) => sort_keys.extend(
                it.members()
                    .iter()
                    .map(|it| (it.span().start, it.span().start)),
            ),
            StmtKind::Module(it) if it.nested().is_some() => {
                let names = std::iter::successors(Some(it), |it| it.nested())
                    .map(|it| it.name_span().start);
                sort_keys.extend(names.map(|it| (it, it)));
            }
            _ => {}
        }
    }
    sort_keys.sort_unstable();
    sort_keys.dedup();
    sort_keys
}

/// True if visiting `e` doesn't make oxlint reset its "inside a callee" flag.
fn keeps_callee_flag(e: Expr) -> bool {
    matches!(
        inner(e).tag(),
        ExprTag::Ident
            | ExprTag::This
            | ExprTag::String
            | ExprTag::Number
            | ExprTag::True
            | ExprTag::False
            | ExprTag::Null
    )
}

/// The value of oxlint's `is_callee_of_call_expr` flag when it visits `member`. It's true if `member` is inside a
/// call's callee, and oxlint hasn't visited a member access, call or function since it entered the callee. `a.b()`
/// reads `a`, and so do `a.b[c]()` and `x[a.b]()`.
fn is_callee_of_call(member: Expr) -> bool {
    let mut child = member;
    while let Node::Expr(parent) = child.parent() {
        let keeps_flag = match parent.kind() {
            ExprKind::Call(call) => return call.callee() == child,
            ExprKind::Index { obj, .. } => obj == child || keeps_callee_flag(obj),
            ExprKind::Binary { left, .. } => left == child || keeps_callee_flag(left),
            ExprKind::Cond { test, yes, .. } => {
                test == child || keeps_callee_flag(test) && (yes == child || keeps_callee_flag(yes))
            }
            ExprKind::As { .. }
            | ExprKind::AsConst(_)
            | ExprKind::Satisfies { .. }
            | ExprKind::NonNull(_)
            | ExprKind::Instantiation { .. }
            | ExprKind::Unary { .. }
            | ExprKind::Await(_) => true,
            _ => false,
        };
        if !keeps_flag {
            return false;
        }
        child = parent;
    }
    false
}

/// oxlint's `ExhaustiveDepsVisitor`. With `with_parameters` it covers the parameters as well as the body.
fn find_dependencies<'a>(func: Func<'a>, with_parameters: bool) -> Found<'a> {
    let start = match (with_parameters, func.body()) {
        (true, _) => 0,
        (false, FnBody::Expr(body)) => body.outer_span().start,
        (false, _) => func.body_span().map_or(0, |it| it.start),
    };
    let mut idents: Vec<Expr<'a>> = Vec::new();
    let mut scopes = vec![Node::Func(func).scope()];
    while let Some(scope) = scopes.pop() {
        let values = scope
            .references()
            .filter(|it| it.is_value())
            .filter_map(Reference::expr);
        idents.extend(values.filter(|it| {
            it.span().start >= start && it.tag() == ExprTag::Ident && !it.is_in_type_query()
        }));
        scopes.extend(scope.children());
    }
    utils::sort::sort_unstable_by_key(&mut idents, |it| it.span().start);
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
        // `member` ends up as the outermost member expression of `ident.a.b` with its property name, and `source` as
        // the chain it's a property of.
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
                && func_call_without_react_namespace(call)
                    .is_some_and(|it| it.is_any(&["useState", "useReducer"]))
                && is_second_of_array_pattern(declarator, name)
                && enclosing_function.find(Node::Expr(ident), |_, parent| parent.as_func())
                    == Some(func)
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

/// True if `e` is in a function that's returned from inside `callback`: `return () => ..`. `known` is the memo for
/// `callback`.
fn is_inside_effect_cleanup<'a>(
    e: Expr<'a>,
    callback: Func<'a>,
    known: &mut AncestorMemo<'a, bool>,
) -> bool {
    let is_inside = known.find(Node::Expr(e), |_, parent| match parent {
        Node::Func(func) if func == callback => Some(false),
        Node::Func(func) => match func.owner() {
            Node::Expr(owner) if !owner.is_parenthesized() => {
                matches!(owner.parent(), Node::Stmt(stmt) if stmt.tag() == StmtTag::Return)
                    .then_some(true)
            }
            _ => None,
        },
        _ => None,
    });
    is_inside == Some(true)
}

/// Caches shared by all the calls in a file.
#[derive(Default)]
pub(crate) struct Memo<'a> {
    /// True if a component variable's value is the same on every render.
    is_stable: IdMap<Symbol<'a>, bool>,
    /// True if `variable.current` appears on either side of an assignment.
    is_current_written: IdMap<Symbol<'a>, bool>,
    /// [`symbol_sort_keys`]
    symbol_sort_keys: Option<Vec<(u32, u32)>>,
    /// Every `a.current` in the file, in source order.
    currents: Option<Vec<Expr<'a>>>,
    /// The enclosing function of a node.
    enclosing_functions: AncestorMemo<'a, Func<'a>>,
}

struct Component<'a> {
    scope: Scope<'a>,
}

/// Tells whether a variable's value is the same on every render.
enum Stability<'a> {
    Known(bool),
    /// It's stable if everything the function reads is stable. Also holds the variable that the function is assigned
    /// to.
    OfFunction(Func<'a>, Option<Symbol<'a>>),
}

impl<'a> Component<'a> {
    /// `is_identifier_a_dependency`
    fn is_dependency(&self, dependency: &Dependency<'a>, memo: &mut Memo<'a>) -> bool {
        self.component_variable(dependency)
            .is_some_and(|it| !self.is_stable_value(it.0, it.1, memo))
    }

    /// Returns `dependency`'s variable if it's declared in the component, which makes it a dependency unless its value
    /// is stable.
    fn component_variable(
        &self,
        dependency: &Dependency<'a>,
    ) -> Option<(Symbol<'a>, Declared<'a>)> {
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
            Declared::Function(func) if func.has_body() => {
                return Stability::OfFunction(func, None);
            }
            _ => return Stability::Known(false),
        };
        let Some(init) = declarator.init().map(inner) else {
            return Stability::Known(false);
        };
        Stability::Known(match init.kind() {
            ExprKind::Fn(func) => {
                return Stability::OfFunction(func, declarator.pat().as_ident().map(|_| symbol));
            }
            ExprKind::True
            | ExprKind::False
            | ExprKind::Null
            | ExprKind::Number(_)
            | ExprKind::BigInt(_)
            | ExprKind::String(_) => declarator.var_kind() == VarKind::Const,
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

    /// The component's variables that `func` reads. `None` if it reads `own`, the variable it's assigned to.
    fn variables_read_in(
        &self,
        func: Func<'a>,
        own: Option<Symbol<'a>>,
    ) -> Option<Vec<(Symbol<'a>, Declared<'a>)>> {
        let found = find_dependencies(func, false);
        if own.is_some() && found.dependencies.iter().any(|it| it.0.symbol == own) {
            return None;
        }
        Some(
            found
                .dependencies
                .iter()
                .filter_map(|it| self.component_variable(&it.0))
                .collect(),
        )
    }

    /// oxlint's `is_stable_value`, which treats a function that it's already visiting as stable. So a variable's value
    /// is stable unless an unstable one is reachable from it, following edges from each function to the variables it
    /// reads. Functions that read each other are found like strongly connected components (Tarjan's algorithm), so each
    /// function is visited once per file.
    fn is_stable_value(
        &self,
        symbol: Symbol<'a>,
        declared: Declared<'a>,
        memo: &mut Memo<'a>,
    ) -> bool {
        struct Frame<'a> {
            symbol: Symbol<'a>,
            reads: Vec<(Symbol<'a>, Declared<'a>)>,
            next: usize,
            number: usize,
            /// The lowest number among the functions in `open` that are reachable from it.
            lowest: usize,
        }
        if let Some(&known) = memo.is_stable.get(symbol) {
            return known;
        }
        let mut stack: Vec<Frame<'a>> = Vec::new();
        // The functions that have been entered and from which a function in `stack` is reachable.
        let mut open: Vec<Symbol<'a>> = Vec::new();
        let mut numbers: IdMap<Symbol<'a>, usize> = IdMap::default();
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
                match (memo.is_stable.get(read.0), numbers.get(read.0)) {
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
        memo.is_stable
            .extend(open.into_iter().map(|it| (it, false)));
        false
    }
}

fn is_expression_referentially_unique(e: Expr) -> bool {
    let mut values: SmallVec<[Expr; 8]> = smallvec::smallvec![e];
    while let Some(value) = values.pop() {
        match inner(value).kind() {
            ExprKind::Array(_)
            | ExprKind::Object(_)
            | ExprKind::Fn(_)
            | ExprKind::Class(_)
            | ExprKind::New(_)
            | ExprKind::Regex(_)
            | ExprKind::Jsx(_) => {
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
            declarator.pat().tag() == PatTag::Ident
                && declarator
                    .init()
                    .is_some_and(is_expression_referentially_unique)
        }
        _ => false,
    }
}

/// `appended_to` is the array literal, if oxlint offers to append the missing dependencies to it, and the `is_first`
/// argument for [`replace_array`].
fn report_missing<'a, R: Rule>(
    cx: &Cx<'a, R>,
    (node, hook): (Expr<'a>, Name<'a>),
    missing: &[(Span, Vec<u8>)],
    array: Span,
    mutable: Option<&[u8]>,
    appended_to: Option<(Expr<'a>, bool)>,
) {
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
        let (before, after) = (
            &b". Mutable values like '"[..],
            &b"' aren't valid dependencies because mutating them doesn't re-render the component."
                [..],
        );
        [before, it, after].concat()
    });
    let report = cx
        .report(
            first.0,
            if missing.len() == 1 {
                MISSING_DEPENDENCY
            } else {
                MISSING_DEPENDENCIES
            },
        )
        .called_with(node)
        .comments_apply_at(array)
        .data("hook", hook)
        .data("dependencies", names)
        .data("mutable", mutable)
        .labels_with(|labels| {
            // Only label a single dependency. More label texts would be noise.
            if let [(_, name)] = missing {
                let (hook, name) = (bstr::BStr::new(hook.bytes()), bstr::BStr::new(name));
                labels.first(format!("{hook} uses `{name}` here"));
            }
            for (span, _) in missing.iter().skip(1) {
                labels.push(*span, "");
            }
            labels.push(array, "");
        });
    if let Some((array, is_first)) = appended_to {
        report.suggest_dangerously(INCLUDE_OR_REMOVE, |fixer| {
            replace_array(fixer, array, &print_array(array, None, missing), is_first)
        });
    }
}

/// Replaces `array` with `text`. If several fixes change one array, oxlint applies the first one it reaches and leaves
/// the others to the next pass. We apply the fix that starts first, so every fix but the first keeps the `[` and starts
/// after it.
fn replace_array<'a>(fixer: Fixer<'a>, array: Expr<'a>, text: &[u8], is_first: bool) -> Fix {
    let whole = array.span();
    match text {
        [b'[', rest @ ..] if !is_first => {
            fixer.replace(Span::new(whole.start + 1, whole.end), rest)
        }
        _ => fixer.replace(whole, text),
    }
}

/// oxlint's replacement for `array`: its elements without the one at `removed`, followed by `appended`. It's printed
/// like oxc prints an array, with each element on its own line if there are more than two, and without comments.
fn print_array(array: Expr, removed: Option<Span>, appended: &[(Span, Vec<u8>)]) -> Vec<u8> {
    let ExprKind::Array(elements) = array.kind() else {
        return Vec::new();
    };
    let remaining: SmallVec<[Expr; 8]> = elements
        .iter()
        .filter(|it| Some(it.outer_span()) != removed)
        .collect();
    let len = remaining.len() + appended.len();
    let is_multi_line = len > 2;
    let mut codegen = Codegen::default();
    codegen.code.push(b'[');
    if is_multi_line {
        codegen.indent();
    }
    let names = appended.iter().map(|it| Err(&it.1));
    for (i, item) in remaining.iter().map(Ok).chain(names).enumerate() {
        if i != 0 {
            codegen.code.push(b',');
        }
        if is_multi_line {
            codegen.print_soft_newline();
        } else if i != 0 {
            codegen.code.push(b' ');
        }
        match item {
            Ok(element) if element.is_missing() => {
                if i + 1 == len {
                    codegen.code.push(b',');
                }
            }
            Ok(element) => print_element(&mut codegen, *element),
            Err(name) => codegen.code.extend_from_slice(name),
        }
    }
    if is_multi_line {
        codegen.dedent();
        codegen.print_soft_newline();
    }
    codegen.code.push(b']');
    codegen.code
}

fn print_element(codegen: &mut Codegen, element: Expr) {
    let element = match element.kind() {
        ExprKind::Spread(argument) => {
            codegen.code.extend_from_slice(b"...");
            argument
        }
        _ => element,
    };
    let is_sequence = element.binary_op() == Some(BinOp::Comma);
    if is_sequence {
        codegen.code.push(b'(');
    }
    print_expression(codegen, element);
    if is_sequence {
        codegen.code.push(b')');
    }
}

/// `node` can be any call. `additional_hooks` is the rule's option.
pub(crate) fn run<'a, R: Rule>(
    cx: &Cx<'a, R>,
    node: Expr<'a>,
    additional_hooks: Option<&Regex>,
    memo: &mut Memo<'a>,
) {
    let Some(call) = node.as_call() else {
        return;
    };
    let callee = call.callee();
    let Some(hook) = name_without_react_namespace(callee).filter(|_| !callee.is_parenthesized())
    else {
        return;
    };
    let callback_index = match hook.bytes() {
        b"useEffect" | b"useLayoutEffect" | b"useCallback" | b"useMemo" => 0,
        b"useImperativeHandle" => 1,
        name if additional_hooks.is_some_and(|it| it.test(name)) => 0,
        _ => return,
    };
    let is_function = |it: &Func| !matches!(it.kind(), FnKind::StaticBlock);
    let Some(component) = memo
        .enclosing_functions
        .find(Node::Expr(node), |_, parent| {
            parent.as_func().filter(is_function)
        })
    else {
        return;
    };
    let component = Component {
        scope: Node::Func(component).scope(),
    };
    let args = call.args();
    let Some(callback_node) = args.get(callback_index) else {
        cx.report(node, MISSING_CALLBACK)
            .called_with(node)
            .data("hook", hook);
        return;
    };
    let dependencies_node = args.get(callback_index + 1);
    let is_effect = bun_core::strings::contains(hook.bytes(), b"Effect");
    if dependencies_node.is_none() && !is_effect {
        if hook.is_any(&["useCallback", "useMemo"]) {
            cx.report(node, DEPENDENCY_ARRAY_REQUIRED)
                .called_with(node)
                .data("hook", hook)
                .fix(|fixer| fixer.insert_after(callback_node.outer_span(), ", []"));
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
            // Don't report it if it's listed in the array.
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
            let missing = || {
                report_missing(
                    cx,
                    (node, hook),
                    &[(callback_expr.span(), name.bytes().to_vec())],
                    dependencies_node.outer_span(),
                    None,
                    None,
                )
            };
            match declared {
                Declared::Variable(declarator) => match declarator
                    .init()
                    .map(|it| (it.kind(), it.is_parenthesized()))
                {
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
            cx.report(callee, UNKNOWN_DEPENDENCIES)
                .called_with(node)
                .data("hook", hook);
            return;
        }
    };
    if callback.is_async() && is_effect {
        cx.report(callback.estree_span(), ASYNC_EFFECT)
            .called_with(node);
    }

    let array = dependencies_node.and_then(|it| {
        let array = inner(it);
        match array.kind() {
            ExprKind::Array(_) => return Some(array),
            ExprKind::Ident(name) if name.is("undefined") && symbol_of(array).is_none() => {}
            _ => drop(
                cx.report(it.outer_span(), NOT_ARRAY_LITERAL)
                    .called_with(node)
                    .data("hook", hook),
            ),
        }
        None
    });

    let mut found = find_dependencies(callback, true);
    if is_effect && cx.file().mentions("current") {
        report_refs_in_cleanups(cx, (node, callback), &component, memo);
    }
    let Some(array) = array else {
        if is_effect && find_dependencies(callback, false).has_set_state_call {
            cx.report(callee, INFINITE_RERENDER)
                .called_with(node)
                .data("hook", hook);
        }
        return;
    };
    let ExprKind::Array(elements) = array.kind() else {
        return;
    };

    // The declared dependencies, each with its number in `found.paths`.
    let mut declared: Vec<(Dependency<'a>, u32)> = Vec::new();
    for element in elements {
        if matches!(element.tag(), ExprTag::Missing) {
            continue;
        }
        if element.tag() == ExprTag::Spread {
            cx.report(element, COMPLEX_EXPRESSION)
                .called_with(node)
                .data("hook", hook);
            continue;
        }
        let element = inner(element);
        match analyze_property_chain(element) {
            Ok(None) => {}
            Ok(Some(dependency)) => {
                let number = found.paths.number_of(&dependency, |_| {});
                let path = found.paths.get_mut(number);
                if path.declared != 0 {
                    cx.report(dependency.span, DUPLICATE).called_with(node);
                } else {
                    declared.push((dependency, number));
                    path.declared = declared.len() as u32;
                }
            }
            Err(()) => {
                let is_literal = matches!(
                    element.tag(),
                    ExprTag::True
                        | ExprTag::False
                        | ExprTag::Null
                        | ExprTag::Number
                        | ExprTag::BigInt
                        | ExprTag::Regex
                        | ExprTag::String
                );
                match is_literal {
                    true => drop(cx.report(element, LITERAL).called_with(node)),
                    false => drop(
                        cx.report(element, COMPLEX_EXPRESSION)
                            .called_with(node)
                            .data("hook", hook),
                    ),
                }
            }
        }
    }

    // The unnecessary outer-scope dependencies, as indices into `declared`.
    let mut outer: Vec<usize> = Vec::new();
    for (at, (dependency, _)) in declared.iter().enumerate() {
        if let Some(symbol) = dependency.symbol {
            let is_ref_current = dependency.chain.len() == 1
                && dependency.ends_in_current()
                && !component.is_dependency(dependency, memo);
            if !is_strictly_inside(component.scope, symbol.scope()) && !is_ref_current {
                continue;
            }
        }
        outer.push(at);
    }
    sort_in_oxlint_order(&mut outer, &declared, cx.file(), memo);
    let first_outer = outer.first().copied();
    for (at, (dependency, _)) in outer
        .iter()
        .filter_map(|at| Some((*at, declared.get(*at)?)))
    {
        cx.report(dependency.span, UNNECESSARY_OUTER_SCOPE)
            .called_with(node)
            .data("hook", hook)
            .data("dependency", dependency.name)
            .fix(|fixer| {
                let text = print_array(array, Some(dependency.span), &[]);
                replace_array(fixer, array, &text, first_outer == Some(at))
            });
    }

    // The undeclared dependencies, as indices into `found.dependencies`.
    let mut undeclared: Vec<usize> = (found.dependencies.iter().enumerate())
        .filter(|(_, (_, number))| found.paths.get(*number).declared == 0)
        // A read of `foo.current` counts as a read of `foo`.
        .filter(|(_, (it, number))| {
            let base = (found.paths.get(*number).base, it.symbol);
            !(it.ends_in_current() && found.positions.contains_key(&base))
        })
        .filter(|(_, (_, number))| !found.paths.above(*number).any(|it| it.declared != 0))
        .filter(|(_, (it, _))| component.is_dependency(it, memo))
        .map(|it| it.0)
        .collect();
    if undeclared.len() > 1 {
        let symbols = memo
            .symbol_sort_keys
            .get_or_insert_with(|| symbol_sort_keys(cx.file()));
        let mut ranks = vec![0; found.dependencies.len()];
        for (rank, at) in found.oxlint_report_order(symbols).into_iter().enumerate() {
            if let Some(it) = ranks.get_mut(at as usize) {
                *it = rank;
            }
        }
        utils::sort::sort_by_key(&mut undeclared, |at| ranks.get(*at).copied());
    }
    for (_, number) in undeclared
        .iter()
        .filter_map(|at| found.dependencies.get(*at))
    {
        found.paths.get_mut(*number).is_undeclared = true;
    }
    let paths = &found.paths;
    if !undeclared.is_empty() {
        let mutable = declared
            .iter()
            .find(|(it, number)| it.ends_in_current() && paths.base(*number).is_undeclared);
        let missing: Vec<(Span, Vec<u8>)> = undeclared
            .iter()
            .filter_map(|at| found.dependencies.get(*at))
            .map(|(it, _)| (it.span, it.text()))
            .collect();
        report_missing(
            cx,
            (node, hook),
            &missing,
            array.span(),
            mutable.map(|it| it.0.text()).as_deref(),
            Some((array, outer.is_empty())),
        );
    }

    let is_effect_event = |dependency: &Dependency<'a>| {
        matches!(dependency.symbol.and_then(declaration_of), Some(Declared::Variable(declarator))
        if declarator.init().filter(|it| !it.is_parenthesized()).is_some_and(|init| {
            matches!(init.kind(), ExprKind::Call(call)
                if func_call_without_react_namespace(call).is_some_and(|it| it.is("useEffectEvent")))
        }))
    };
    let mut effect_events: Vec<usize> = (declared.iter().enumerate())
        .filter(|(_, it)| is_effect_event(&it.0))
        .map(|it| it.0)
        .collect();
    sort_in_oxlint_order(&mut effect_events, &declared, cx.file(), memo);
    for (dependency, _) in effect_events.iter().filter_map(|at| declared.get(*at)) {
        cx.report(dependency.span, USE_EFFECT_EVENT)
            .called_with(node);
    }

    // Effects may have more dependencies than they need.
    if !is_effect {
        let unnecessary = |dependency: &Dependency| {
            cx.report(array, UNNECESSARY_DEPENDENCY)
                .called_with(node)
                .data("hook", hook)
                .data("dependency", dependency.text());
        };
        // The pairs where one dependency is a property of the other: the array indices of the first, of the second, and
        // of the one that's the property.
        let mut pairs: Vec<(usize, usize, usize)> = Vec::new();
        for (at, (_, number)) in declared.iter().enumerate() {
            let above = paths
                .above(*number)
                .filter_map(|it| (it.declared as usize).checked_sub(1));
            pairs.extend(above.map(|other| (at.min(other), at.max(other), at)));
        }
        // oxlint visits the pairs in its hash table's iteration order.
        if pairs.len() > 1 {
            let table_ranks = table_positions(&declared, cx.file(), memo);
            let rank_of = |at: usize| table_ranks.get(at).copied().unwrap_or(0);
            for it in &mut pairs {
                let (first, second) = (rank_of(it.0), rank_of(it.1));
                (it.0, it.1) = (first.min(second), first.max(second));
            }
        }
        utils::sort::sort_unstable(&mut pairs);
        for (dependency, _) in pairs.iter().filter_map(|it| declared.get(it.2)) {
            unnecessary(dependency);
        }
        let is_needed = |number: u32| {
            paths.get(number).is_found
                || paths.get(number).is_found_within
                || paths.get(number).is_undeclared
                || paths
                    .above(number)
                    .any(|it| it.is_undeclared || it.declared != 0)
        };
        let mut not_needed: Vec<usize> = (declared.iter().enumerate())
            .filter(|(_, it)| !is_needed(it.1))
            .map(|it| it.0)
            .collect();
        sort_in_oxlint_order(&mut not_needed, &declared, cx.file(), memo);
        for (dependency, _) in not_needed.iter().filter_map(|at| declared.get(*at)) {
            unnecessary(dependency);
        }
    }

    let is_unique = |it: &Dependency<'a>| {
        it.chain.is_empty() && it.symbol.is_some_and(is_declaration_referentially_unique)
    };
    let mut changing: Vec<usize> = (declared.iter().enumerate())
        .filter(|(_, it)| is_unique(&it.0))
        .map(|it| it.0)
        .collect();
    sort_in_oxlint_order(&mut changing, &declared, cx.file(), memo);
    let first_changing =
        (changing.first().copied()).filter(|_| outer.is_empty() && undeclared.is_empty());
    for (at, (dependency, _)) in changing
        .iter()
        .filter_map(|at| Some((*at, declared.get(*at)?)))
    {
        cx.report(dependency.span, CHANGES_EVERY_RENDER)
            .called_with(node)
            .data("hook", hook)
            .data("dependency", dependency.name)
            .labels_with(|labels| {
                let declaration = dependency.symbol.and_then(|it| it.declarations().next());
                let name = bstr::BStr::new(dependency.name.bytes());
                labels.first("it will always cause this hook to re-evaluate");
                labels.push(
                    declaration
                        .and_then(Declaration::name_span)
                        .unwrap_or_default(),
                    format!("`{name}` is declared here"),
                );
            })
            .suggest_dangerously(MEMOIZE, |fixer| {
                let text = print_array(array, Some(dependency.span), &[]);
                replace_array(fixer, array, &text, first_changing == Some(at))
            });
    }
}

fn report_refs_in_cleanups<'a, R: Rule>(
    cx: &Cx<'a, R>,
    (node, callback): (Expr<'a>, Func<'a>),
    component: &Component<'a>,
    memo: &mut Memo<'a>,
) {
    let within = callback.estree_span();
    let currents = memo.currents.get_or_insert_with(|| {
        let is_current =
            |it: &Expr| as_static_member(*it).is_some_and(|it| it.1.name().is("current"));
        let mut currents: Vec<Expr<'a>> = cx
            .file()
            .exprs_of_kind(ExprTag::Dot)
            .filter(is_current)
            .collect();
        utils::sort::sort_unstable_by_key(&mut currents, |it| it.span().start);
        currents
    });
    let first = currents.partition_point(|it| it.span().start < within.start);
    let mut inside_effect_cleanup = AncestorMemo::default();
    for &member in currents[first..]
        .iter()
        .take_while(|it| it.span().start < within.end)
    {
        let Some((obj, _)) =
            as_static_member_outside_tags(member).filter(|_| within.contains(member.span()))
        else {
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
            let is_written = *memo.is_current_written.get_or_insert_with(symbol, || {
                symbol.references().filter_map(Reference::expr).any(|it| {
                    matches!(it.parent(), Node::Expr(parent) if !it.is_parenthesized()
                        && !parent.is_parenthesized()
                        && as_static_member(parent).is_some_and(|it| it.1.name().is("current"))
                        && matches!(parent.parent(), Node::Expr(assignment) if assignment.tag() == ExprTag::Assign))
                })
            });
            if is_written
                || declaration_of(symbol)
                    .is_some_and(|it| scope_of_declaration(symbol, it) != component.scope)
            {
                continue;
            }
        }
        cx.report(member, REF_IN_CLEANUP).called_with(node);
    }
}
