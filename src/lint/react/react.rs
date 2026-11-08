//! The half of oxlint's `utils/react.rs` that deals with components, ported to this linter's AST handles. Each function
//! keeps oxlint's name. JSX element names and attributes are in [`jsx`](crate::jsx).
//!
//! | oxc | here |
//! |---|---|
//! | `AstKind::Class` | `Node::Class`. The `Expr` or the `Stmt` above it is the same node there |
//! | `AstKind::Function`, `AstKind::ArrowFunctionExpression` | `Node::Func`: [`as_function`]. The same goes for the node above it |
//! | `AstKind::ObjectProperty`, `MethodDefinition`, `PropertyDefinition` | [`as_object_property`], [`as_method_definition`], [`as_property_definition`] |
//! | `ctx.nodes().ancestors(id)` from each of many nodes | [`AncestorWalk`], `bun_lint::utils::ancestor_memo::AncestorMemo` |

use crate::jsx::Child;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::types::{IdMap, IdSet};
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint_oxlint::ast_util::{
    as_call_expression, as_function, as_function_expression, as_member_expression,
    as_method_definition, as_object_property, as_property_definition, callee_name,
    get_inner_expression, static_name, static_property_name,
};
use rustc_hash::FxHashMap;
use smallvec::{SmallVec, smallvec};
use std::hash::Hash;
use std::ops::ControlFlow;

/// `ctx.source_type().is_jsx()`: oxlint parses JSX in every JavaScript file and in `.tsx`.
pub(crate) fn is_jsx(file: &File) -> bool {
    file.is_javascript() || file.path().ends_with(b".tsx")
}

/// Whitespace that contains a line break, which React drops.
pub(crate) fn is_padding_spaces(child: Child) -> bool {
    matches!(child, Child::Text(text) if strings::is_all_unicode_whitespace(text) && strings::contains_char(text, b'\n'))
}

pub(crate) fn is_create_element_call(call: Call) -> bool {
    let callee = call.callee();
    if callee.is_parenthesized() {
        return false;
    }
    match callee.tag() {
        ExprTag::Ident => callee.is_ident("createElement"),
        ExprTag::Dot | ExprTag::Index => {
            static_property_name(callee).is_some_and(|name| name.is("createElement"))
                && !callee
                    .object()
                    .is_some_and(|object| get_inner_expression(object).is_ident("document"))
        }
        _ => false,
    }
}

/// `React.name` or `name`, for one of `names`.
pub(crate) fn is_pragma_member_or_identifier(e: Expr, names: &[&str]) -> bool {
    if let Some(member) = as_member_expression(e)
        && let Some(object) = member.object()
        && object.tag() == ExprTag::Ident
        && !object.is_parenthesized()
    {
        return object.is_ident("React")
            && static_property_name(member).is_some_and(|name| name.is_any(names));
    }
    get_inner_expression(e)
        .as_ident()
        .is_some_and(|name| name.is_any(names))
}

pub(crate) fn is_es5_component(node: Node) -> bool {
    let is_create_react_class =
        |call: Call| is_pragma_member_or_identifier(call.callee(), &["createReactClass"]);
    matches!(node, Node::Expr(e) if e.as_call().is_some_and(is_create_react_class))
}

pub(crate) fn is_es6_component(node: Node) -> bool {
    matches!(node, Node::Class(class)
        if class.extends().is_some_and(|it| is_pragma_member_or_identifier(it, &["Component", "PureComponent"])))
}

/// `memo`: the rule's own cache, used only for this lookup.
pub(crate) fn get_parent_component<'a>(
    node: Node<'a>,
    memo: &mut AncestorMemo<'a, Node<'a>>,
) -> Option<Node<'a>> {
    memo.find(node, |_, parent| {
        (is_es5_component(parent) || is_es6_component(parent)).then_some(parent)
    })
}

/// Returns the callee of `this.setState(..)`.
pub(crate) fn callee_of_this_set_state(call: Expr<'_>) -> Option<Expr<'_>> {
    let member = as_member_expression(call.as_call()?.callee())?;
    (static_property_name(member)?.is("setState")
        && member
            .object()
            .is_some_and(|it| it.tag() == ExprTag::This && !it.is_parenthesized()))
    .then_some(member)
}

/// The cache for [`function_count_before_lifecycle_component`]. Always pass the same names with it.
#[derive(Default)]
pub(crate) struct LifecycleWalk<'a> {
    /// The enclosing method with one of the names, and the number of functions between the node and it.
    methods: FxHashMap<Node<'a>, Option<(u32, Node<'a>)>>,
    components: AncestorMemo<'a, ()>,
}

/// Returns how many functions are between `node` and the enclosing component method that has one of these names.
/// `node`'s parent isn't checked.
pub(crate) fn function_count_before_lifecycle_component<'a>(
    node: Expr<'a>,
    lifecycle_method_names: &[&str],
    walk: &mut LifecycleWalk<'a>,
) -> Option<u32> {
    // In these cases oxlint has a node between it and its parent.
    let from = if node.is_parenthesized() || node.is_chain_root() {
        Node::Expr(node)
    } else {
        node.parent()
    };
    let (mut child, mut function_count, mut steps) = (from, 0, 0);
    // The nodes passed on the way up, each with the number of functions up to it.
    let mut passed = Vec::new();
    let found = loop {
        if matches!(child, Node::File(_)) {
            break None;
        }
        if steps >= PLAIN_STEPS {
            if let Some(&known) = walk.methods.get(&child) {
                break known.map(|(count, method)| (count + function_count, method));
            }
            passed.push((child, function_count));
        }
        let ancestor = child.parent();
        if is_lifecycle_component_method(ancestor, lifecycle_method_names) {
            break Some((function_count, ancestor));
        }
        function_count += u32::from(as_function(ancestor).is_some());
        child = ancestor;
        steps += 1;
    };
    let from_there = |before: u32| found.map(|(count, method)| (count - before, method));
    walk.methods.extend(
        passed
            .into_iter()
            .map(|(node, before)| (node, from_there(before))),
    );
    let (function_count, method) = found?;
    let is_component = |ancestor: Node| is_es5_component(ancestor) || is_es6_component(ancestor);
    walk.components
        .find(method, |_, ancestor| is_component(ancestor).then_some(()))
        .map(|()| function_count)
}

fn is_lifecycle_component_method(node: Node, lifecycle_method_names: &[&str]) -> bool {
    let key = match node {
        Node::Prop(_) => as_object_property(node).and_then(Prop::key),
        Node::Member(_) => as_method_definition(node)
            .or_else(|| as_property_definition(node))
            .and_then(Member::key),
        _ => None,
    };
    key.and_then(static_name)
        .is_some_and(|name| name.is_any(lifecycle_method_names))
}

/// `settings.react[key]`, if it's an array.
fn components_from_settings<'a>(file: &'a File<'a>, key: &[u8]) -> &'a [Json] {
    file.settings()
        .get(b"react")
        .and_then(|it| it.get(key)?.as_array())
        .unwrap_or_default()
}

/// `settings.react.linkComponents`, for [`get_component_attrs_by_name`]
pub(crate) fn link_components<'a>(file: &'a File<'a>) -> &'a [Json] {
    components_from_settings(file, b"linkComponents")
}

/// `settings.react.formComponents`, for [`get_component_attrs_by_name`]
pub(crate) fn form_components<'a>(file: &'a File<'a>) -> &'a [Json] {
    components_from_settings(file, b"formComponents")
}

/// The attributes of a component from the settings that hold a URL.
#[derive(Copy, Clone)]
pub(crate) enum ComponentAttrs<'a> {
    One(&'a [u8]),
    Many(&'a [Json]),
}

impl ComponentAttrs<'_> {
    pub(crate) fn contains(self, attribute: &[u8]) -> bool {
        match self {
            ComponentAttrs::One(it) => it == attribute,
            ComponentAttrs::Many(all) => all.iter().any(|it| it.as_str() == Some(attribute)),
        }
    }
}

/// `ctx.settings().react.get_link_component_attrs(name)`, `get_form_component_attrs(name)`. An element of `components`
/// is `"Name"`, `{ name, linkAttribute: "to" }` or `{ name, linkAttribute: ["to", "href"] }`.
pub(crate) fn get_component_attrs_by_name<'a>(
    components: &'a [Json],
    name: &[u8],
) -> Option<ComponentAttrs<'a>> {
    components.iter().find_map(|item| {
        if let Some(only) = item.as_str() {
            return (only == name).then_some(ComponentAttrs::Many(&[]));
        }
        if item.get(b"name")?.as_str()? != name {
            return None;
        }
        let field = |key: &[u8]| item.get(key);
        let shared = || field(b"formAttribute").or_else(|| field(b"linkAttribute"));
        (field(b"attribute")
            .or_else(shared)
            .and_then(Json::as_str)
            .map(ComponentAttrs::One))
        .or_else(|| {
            field(b"attributes")
                .or_else(shared)
                .and_then(Json::as_array)
                .map(ComponentAttrs::Many)
        })
    })
}

/// `ctx.settings().react.version`: major, minor and patch. Also `None` for a version that oxlint rejects.
pub(crate) fn react_version(file: &File) -> Option<(u32, u32, u32)> {
    let version = file.settings().get(b"react")?.get(b"version")?.as_str()?;
    let mut parts = strings::split(version, b".")
        .map(|part| std::str::from_utf8(part).ok()?.parse::<u32>().ok());
    let major = parts.next()??;
    let (minor, patch) = (
        parts.next().unwrap_or(Some(0))?,
        parts.next().unwrap_or(Some(0))?,
    );
    parts.next().is_none().then_some((major, minor, patch))
}

/// `ctx.settings().react.version.as_ref().is_none_or(ReactVersion::supports_unsafe_lifecycle_prefix)`: React is 16.3 or
/// later.
pub(crate) fn supports_unsafe_lifecycle_prefix(file: &File) -> bool {
    react_version(file).is_none_or(|version| version >= (16, 3, 0))
}

/// `expected_call(..)`, `React.expected_call(..)`
pub(crate) fn is_react_function_call(call: Call, expected_call: &str) -> bool {
    callee_name(call).is_some_and(|subject| subject.is(expected_call))
        && call
            .callee()
            .object()
            .is_none_or(|object| get_inner_expression(object).is_ident("React"))
}

/// From `ast_util.rs`: returns the `a.b` at the start of `a.b.c[d].e`. `assignment` is an assignment target, so the
/// parentheses around it aren't nodes for oxlint either.
pub(crate) fn get_outer_member_expression(assignment: Expr<'_>) -> Option<Expr<'_>> {
    let mut member =
        Some(assignment).filter(|it| matches!(it.tag(), ExprTag::Dot | ExprTag::Index))?;
    while let Some(object) = member.object().and_then(as_member_expression) {
        member = object;
    }
    (member.tag() == ExprTag::Dot && !member.is_private_member()).then_some(member)
}

/// `this.state`
pub(crate) fn is_state_member_expression(expression: Expr) -> bool {
    matches!(expression.kind(), ExprKind::Dot { obj, name, .. }
        if obj.tag() == ExprTag::This && !obj.is_parenthesized() && name.name().is("state"))
}

/// `settings.react.componentWrapperFunctions`, for [`is_hoc_call`]
pub(crate) fn component_wrapper_functions<'a>(file: &'a File<'a>) -> &'a [Json] {
    components_from_settings(file, b"componentWrapperFunctions")
}

/// `callee_name`: see [`callee_name`]. For `React.memo(..)` it's `memo`.
pub(crate) fn is_hoc_call(callee_name: &[u8], component_wrapper_functions: &[Json]) -> bool {
    matches!(callee_name, b"memo" | b"forwardRef")
        || component_wrapper_functions
            .iter()
            .any(|it| it.as_str() == Some(callee_name))
}

/// The kinds of values a function can return.
#[derive(Copy, Clone, Default)]
pub(crate) struct FunctionReturns(u8);

impl FunctionReturns {
    const JSX: u8 = 1 << 0;
    const NULL: u8 = 1 << 1;

    pub(crate) fn has_jsx(self) -> bool {
        self.0 & FunctionReturns::JSX != 0
    }

    pub(crate) fn has_jsx_or_null(self) -> bool {
        self.0 != 0
    }
}

pub(crate) type Variables<'a> = SmallVec<[Symbol<'a>; 4]>;

/// A stack entry of the depth-first search in [`VariableFlags::of_variable`].
struct Visited<'a> {
    variable: Symbol<'a>,
    flags: u8,
    /// The variables in its initializer that haven't been visited yet.
    rest: Variables<'a>,
    index: usize,
    /// The lowest index of a variable it's known to reach (Tarjan's lowlink).
    low: usize,
}

/// Per-variable flags for a file. A variable has its own declaration's flags plus those of the variables in its
/// initializer: `const a = b || c`. Use a separate instance for each meaning of the flags.
#[derive(Default)]
pub(crate) struct VariableFlags<'a> {
    known: IdMap<Symbol<'a>, u8>,
}

impl<'a> VariableFlags<'a> {
    /// `declared_with`: returns the flags of a variable's declaration by itself, and the variables in its initializer.
    ///
    /// Each variable is visited once, no matter how many lookups there are. Variables that are initialized from each
    /// other in a cycle share the same flags, so they're found like a graph's strongly connected components.
    pub(crate) fn of_variable(
        &mut self,
        variable: Symbol<'a>,
        declared_with: impl Fn(Symbol<'a>) -> (u8, Variables<'a>),
    ) -> u8 {
        if let Some(&known) = self.known.get(variable) {
            return known;
        }
        let (flags, rest) = declared_with(variable);
        if rest.is_empty() {
            self.known.insert(variable, flags);
            return flags;
        }
        let mut path = vec![Visited {
            variable,
            flags,
            rest,
            index: 0,
            low: 0,
        }];
        // The variables whose component isn't complete yet.
        let mut open = vec![variable];
        let mut indices: IdMap<Symbol<'a>, usize> = IdMap::new();
        indices.insert(variable, 0);
        while let Some(at) = path.last_mut() {
            if let Some(next) = at.rest.pop() {
                if let Some(&known) = self.known.get(next) {
                    at.flags |= known;
                } else if let Some(&index) = indices.get(next) {
                    at.low = at.low.min(index);
                } else {
                    let index = indices.len();
                    indices.insert(next, index);
                    open.push(next);
                    let (flags, rest) = declared_with(next);
                    path.push(Visited {
                        variable: next,
                        flags,
                        rest,
                        index,
                        low: index,
                    });
                }
                continue;
            }
            let Some(done) = path.pop() else {
                break;
            };
            if done.low == done.index {
                while let Some(member) = open.pop() {
                    self.known.insert(member, done.flags);
                    if member == done.variable {
                        break;
                    }
                }
            }
            let Some(before) = path.last_mut() else {
                return done.flags;
            };
            before.flags |= done.flags;
            before.low = before.low.min(done.low);
        }
        0
    }
}

/// `FunctionReturns::add_expression`, except that the variables `expression` can evaluate to are added to `variables`
/// instead of being followed.
fn add_expression<'a>(expression: Expr<'a>, variables: &mut Variables<'a>) -> u8 {
    let mut returns = 0;
    let mut pending: SmallVec<[Expr<'a>; 8]> = smallvec![expression];
    while let Some(expression) = pending.pop() {
        let expression = get_inner_expression(expression);
        match expression.kind() {
            ExprKind::Jsx(_) => returns |= FunctionReturns::JSX,
            ExprKind::Call(call) if is_create_element_call(call) && !expression.is_chain_root() => {
                returns |= FunctionReturns::JSX
            }
            ExprKind::Null => returns |= FunctionReturns::NULL,
            ExprKind::Cond { yes, no, .. } => pending.extend([yes, no]),
            ExprKind::Binary {
                op: BinOp::And | BinOp::Or | BinOp::Nullish,
                left,
                right,
            } => pending.extend([left, right]),
            ExprKind::Binary {
                op: BinOp::Comma,
                right,
                ..
            } => pending.push(right),
            ExprKind::Ident(_) => variables.extend(expression.symbol()),
            _ => {}
        }
    }
    returns
}

/// Caches what a file's variables can evaluate to, for [`function_returns`].
#[derive(Default)]
pub(crate) struct Returns<'a> {
    variable_flags: VariableFlags<'a>,
}

impl<'a> Returns<'a> {
    fn add_expression(&mut self, expression: Expr<'a>, returns: &mut FunctionReturns) {
        let mut variables = Variables::new();
        returns.0 |= add_expression(expression, &mut variables);
        for variable in variables {
            returns.0 |= self.variable_flags.of_variable(variable, |variable| {
                let mut variables = Variables::new();
                let declarator = variable.declarations().next().and_then(Declaration::node);
                let returns = match declarator {
                    Some(Node::VarDecl(declarator)) => declarator
                        .init()
                        .map_or(0, |init| add_expression(init, &mut variables)),
                    _ => 0,
                };
                (returns, variables)
            });
        }
    }
}

/// Also `arrow_function_returns`. Collects what the reachable `return` statements return. oxlint uses its control flow
/// graph, where the code after a loop is always reachable.
pub(crate) fn function_returns<'a>(function: Func<'a>, known: &mut Returns<'a>) -> FunctionReturns {
    let mut returns = FunctionReturns::default();
    match function.body() {
        FnBody::None => {}
        FnBody::Expr(expression) => known.add_expression(expression, &mut returns),
        FnBody::Block(_) => {
            for statement in function.returns() {
                let can_matter = |argument: Expr| {
                    use ExprTag::{Binary, Call, Cond, Ident, Jsx, Null};
                    matches!(
                        get_inner_expression(argument).tag(),
                        Jsx | Call | Null | Cond | Binary | Ident
                    )
                };
                if let StmtKind::Return(Some(argument)) = statement.kind()
                    && can_matter(argument)
                    && statement.is_reachable()
                {
                    known.add_expression(argument, &mut returns);
                }
            }
        }
    }
    returns
}

pub(crate) fn expression_returns<'a>(
    expression: Expr<'a>,
    known: &mut Returns<'a>,
) -> FunctionReturns {
    as_function_expression(expression).map_or_else(FunctionReturns::default, |function| {
        function_returns(function, known)
    })
}

/// Returns the function that returns JSX in `memo(forwardRef(() => () => <a />))`.
pub(crate) fn find_innermost_function_with_jsx<'a>(
    expr: Expr<'a>,
    component_wrapper_functions: &[Json],
    known: &mut Returns<'a>,
) -> Option<Func<'a>> {
    let mut expr = expr;
    loop {
        if let Some(call) = as_call_expression(expr) {
            callee_name(call)
                .filter(|name| is_hoc_call(name.bytes(), component_wrapper_functions))?;
            expr = call
                .args()
                .first()
                .filter(|it| it.tag() != ExprTag::Spread)?;
            continue;
        }
        let function = as_function_expression(expr)?;
        if function_returns(function, known).has_jsx() {
            return Some(function);
        }
        if !function.is_arrow() {
            return None;
        }
        expr = match function.body() {
            FnBody::None => return None,
            FnBody::Expr(expression) => expression,
            FnBody::Block(statements) => statements.iter().find_map(|it| match it.kind() {
                StmtKind::Return(argument) => argument,
                _ => None,
            })?,
        };
    }
}

/// The functions with JSX or a `createElement` call directly in their body, not in a nested function. Those are the
/// ones for which oxlint's `function_contains_jsx` and `arrow_function_body_contains_jsx` return true.
pub(crate) struct FunctionsWithJsx<'a> {
    functions: IdSet<Func<'a>>,
}

impl<'a> FunctionsWithJsx<'a> {
    pub(crate) fn new(file: &'a File<'a>) -> Self {
        let mut functions = IdSet::new();
        // Caches a node's enclosing function. `None` inside a parameter, which isn't in any function's body.
        let mut enclosing_function: AncestorMemo<'a, Option<Func<'a>>> = AncestorMemo::default();
        let mut add = |e: Expr<'a>| {
            let is_in_body = |child: Node<'a>| !matches!(child, Node::Param(_));
            let function = enclosing_function.find(Node::Expr(e), |child, parent| {
                as_function(parent).map(|it| is_in_body(child).then_some(it))
            });
            if let Some(function) = function.flatten() {
                functions.insert(function);
            }
        };
        // A nested element is in the same function as its parent element.
        let is_child =
            |e: &Expr<'a>| matches!(e.parent(), Node::Expr(parent) if parent.tag() == ExprTag::Jsx);
        file.exprs_of_kind(ExprTag::Jsx)
            .filter(|it| !is_child(it))
            .for_each(&mut add);
        if file.mentions("createElement") {
            file.exprs_of_kind(ExprTag::Call)
                .filter(|it| it.as_call().is_some_and(is_create_element_call))
                .for_each(&mut add);
        }
        FunctionsWithJsx { functions }
    }

    /// `function_contains_jsx`, `arrow_function_body_contains_jsx`
    pub(crate) fn function_contains_jsx(&self, function: Func<'a>) -> bool {
        self.functions.contains(function)
    }
}

/// How many steps a walk takes before it starts consulting the cache. See `AncestorMemo`.
const PLAIN_STEPS: usize = 32;

/// A stateful walk from a node up to the ancestor that decides the answer, for use from many nodes. Walking up from
/// every link of `a, a, ..` or `a + a + ..` takes quadratic time. With this cache, all of a file's walks together take
/// time proportional to the number of walks plus nodes, as long as each node is reached in only a few different states.
///
/// Use a separate instance for each question.
pub(crate) struct AncestorWalk<'a, S, T> {
    known: FxHashMap<(Node<'a>, S), T>,
}

impl<S, T> Default for AncestorWalk<'_, S, T> {
    fn default() -> Self {
        AncestorWalk {
            known: FxHashMap::default(),
        }
    }
}

impl<'a, S: Copy + Eq + Hash, T: Copy + Default> AncestorWalk<'a, S, T> {
    /// Calls `step(child, parent, state)` with `node` and its parent, then with the parent and its parent, and so on
    /// until `parent` is the file. `step` returns either the answer or the state to continue with. If no call gives an
    /// answer, the result is the default. `step`'s result must depend only on its arguments.
    pub(crate) fn run(
        &mut self,
        node: Node<'a>,
        start: S,
        mut step: impl FnMut(Node<'a>, Node<'a>, S) -> ControlFlow<T, S>,
    ) -> T {
        let (mut child, mut state, mut steps) = (node, start, 0);
        let mut passed = Vec::new();
        let answer = loop {
            if matches!(child, Node::File(_)) {
                break T::default();
            }
            if steps >= PLAIN_STEPS {
                if let Some(&known) = self.known.get(&(child, state)) {
                    break known;
                }
                passed.push((child, state));
            }
            let parent = child.parent();
            match step(child, parent, state) {
                ControlFlow::Break(answer) => break answer,
                ControlFlow::Continue(next) => state = next,
            }
            child = parent;
            steps += 1;
        };
        self.known.extend(passed.into_iter().map(|at| (at, answer)));
        answer
    }
}
