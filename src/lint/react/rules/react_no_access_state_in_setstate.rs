use crate::util_ast::{get_property_name, get_property_name_node};
use crate::util_component_util::{Pragmas, get_parent_es5_component, get_parent_es6_component};
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_compat::{estree_parent, estree_type_name, normalize};
use bun_lint::utils::sort;
use rustc_hash::FxHashMap;
use std::cmp::Reverse;

/// Disallow when this.state is accessed within setState
pub struct NoAccessStateInSetstate;

const USE_CALLBACK: Message =
    Message::new("useCallback", "Use callback in setState when referencing the previous state.");

fn is_set_state_call(node: Expr<'_>) -> bool {
    node.as_call().is_some_and(|call| {
        let callee = call.callee();
        is_member_called(callee, "setState") && callee.object().is_some_and(|it| it.tag() == ExprTag::This)
    })
}

fn is_class_component(node: Expr<'_>, pragmas: &Pragmas<'_>) -> bool {
    let node = Node::Expr(node);
    get_parent_es6_component(node, pragmas).is_some() || get_parent_es5_component(node, pragmas).is_some()
}

/// `"key" in parent && parent.key`, for the parent of the `FunctionExpression` `function`.
fn has_key<'a>(parent: Node<'a>, function: Node<'a>) -> bool {
    let is_function = |it| normalize(Node::Expr(it)) == function;
    match parent {
        // A decorator's parent is a `Decorator`.
        Node::Member(member) => !member.decorators().any(is_function),
        Node::Prop(_) => estree_type_name(parent) == "Property",
        // A default value's parent is an `AssignmentPattern`.
        Node::PatProp(property) => !property.default().is_some_and(is_function),
        _ => false,
    }
}

/// The first relevant ancestor of a `this.state`.
#[derive(Copy, Clone)]
enum Enclosing<'a> {
    /// A `this.setState` call that has it in its first argument.
    SetState,
    /// A method, or a function that's a property's value, with its `key.name`.
    Method(Option<&'a [u8]>),
    /// A `VariableDeclarator`, with its `id.name`.
    Variable(Option<&'a [u8]>),
}

impl<'a> Enclosing<'a> {
    /// Returns what `current`, the parent of `child`, is, if it's one of these.
    fn from_ancestor(child: Node<'a>, current: Node<'a>) -> Option<Enclosing<'a>> {
        match current {
            Node::Expr(call) if is_set_state_call(call) => {
                let first = call.as_call()?.args().first()?;
                (normalize(Node::Expr(first)) == child).then_some(Enclosing::SetState)
            }
            Node::Member(_) if estree_type_name(current) == "MethodDefinition" => {
                Some(Enclosing::Method(get_property_name(current)))
            }
            Node::Func(_) if estree_type_name(current) == "FunctionExpression" => {
                let parent = estree_parent(current);
                has_key(parent, current).then(|| Enclosing::Method(get_property_name(parent)))
            }
            Node::VarDecl(declarator) if estree_type_name(current) == "VariableDeclarator" => {
                Some(Enclosing::Variable(declarator.pat().as_ident().map(Name::bytes)))
            }
            _ => None,
        }
    }
}

/// The sorted starts and the sorted ends of the first arguments of all `this.setState` calls.
#[derive(Default)]
struct FirstArguments {
    starts: Vec<u32>,
    ends: Vec<u32>,
}

impl FirstArguments {
    /// Returns how many of them contain `offset`. Any two are either disjoint or nested.
    fn count_containing(&self, offset: u32) -> usize {
        let started = self.starts.partition_point(|it| *it <= offset);
        started.saturating_sub(self.ends.partition_point(|it| *it <= offset))
    }
}

/// Something that updates upstream's `methods` or looks a name up in it.
#[derive(Copy, Clone)]
enum Event<'a> {
    /// A `this.state`, and the `methodName` it's stored under.
    State(Expr<'a>, Option<&'a [u8]>),
    Call(Expr<'a>),
}

impl Event<'_> {
    fn span(self) -> Span {
        match self {
            Event::State(node, _) | Event::Call(node) => node.span(),
        }
    }
}

/// An entry of `vars` that has a `variableName`.
struct Variable<'a> {
    variable_name: &'a [u8],
    /// The scope's id.
    scope: usize,
    /// The start of the node at which upstream adds it.
    since: u32,
    node: Span,
}

impl<'a> Variable<'a> {
    /// Returns the entries of `vars` with `identifier`'s name. `vars` is sorted by its fields in declaration order.
    fn with_name<'v>(vars: &'v [Variable<'a>], identifier: Option<Name<'_>>) -> &'v [Variable<'a>] {
        let name = identifier.map_or(&[][..], Name::bytes);
        let rest = vars.get(vars.partition_point(|it| it.variable_name < name)..).unwrap_or_default();
        rest.get(..rest.partition_point(|it| it.variable_name == name)).unwrap_or_default()
    }

    /// Returns the entries of `same_name_vars` in the scope `scope` that were added before `offset`.
    fn added_before<'v>(same_name_vars: &'v [Variable<'a>], scope: usize, offset: u32) -> &'v [Variable<'a>] {
        let rest = same_name_vars.get(same_name_vars.partition_point(|it| it.scope < scope)..).unwrap_or_default();
        rest.get(..rest.partition_point(|it| it.scope == scope && it.since < offset)).unwrap_or_default()
    }
}

/// Skips the `BinaryExpression`s around an identifier, then returns whether the result is its parent's `value` or
/// `object`.
fn is_value_or_object<'a>(current: Node<'a>, parent: Node<'a>) -> Option<bool> {
    let current = current.as_expr();
    Some(match parent {
        Node::Expr(above) => match above.kind() {
            ExprKind::Binary { op, .. } if !matches!(op, BinOp::And | BinOp::Or | BinOp::Nullish | BinOp::Comma) => {
                return None;
            }
            _ => above.object() == current && ast_utils::is_member_expression(above),
        },
        Node::Prop(property) => property.value() == current && estree_type_name(parent) == "Property",
        Node::Member(member) => member.init() == current,
        // A `with` statement's `object` is in a different scope.
        _ => false,
    })
}

impl Rule for NoAccessStateInSetstate {
    const META: Meta = Meta::plugin(Plugin::React, "no-access-state-in-setstate", Kind::None);
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(_: &Options) -> Self {
        NoAccessStateInSetstate
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        (file.mentions_any(&["setState", "#setState"]) && file.mentions_any(&["state", "#state"])).then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let file = cx.file();
        let (mut states, mut patterns) = (Vec::new(), Vec::new());
        let mut first_arguments = FirstArguments::default();
        for this in file.exprs_of_kind(ExprTag::This) {
            match this.parent() {
                Node::Expr(member) if member.object() == Some(this) => match get_property_name(Node::Expr(member)) {
                    Some(b"state") => states.push(member),
                    Some(b"setState") => {
                        if let Node::Expr(call) = member.parent()
                            && call.callee() == Some(member)
                            && is_set_state_call(call)
                            && let Some(first) = call.as_call().and_then(|it| it.args().first())
                        {
                            first_arguments.starts.push(first.span().start);
                            first_arguments.ends.push(first.span().end);
                        }
                    }
                    _ => {}
                },
                Node::VarDecl(declarator) if declarator.pat().tag() == PatTag::Object => {
                    patterns.push(declarator.pat());
                }
                _ => {}
            }
        }
        if first_arguments.starts.is_empty() || (states.is_empty() && patterns.is_empty()) {
            return;
        }
        sort::sort_unstable(&mut first_arguments.starts);
        sort::sort_unstable(&mut first_arguments.ends);
        let pragmas = Pragmas::new(file);
        let (mut events, mut vars) = (Vec::new(), Vec::new());
        let mut enclosing_memo = AncestorMemo::default();
        // `is_class_component` needs the scopes, so it's checked last.
        for node in states {
            match enclosing_memo.find_with(Node::Expr(node), estree_parent, Enclosing::from_ancestor) {
                Some(Enclosing::SetState) if is_class_component(node, &pragmas) => {
                    cx.report(node, USE_CALLBACK);
                }
                Some(Enclosing::Method(method_name)) => events.push(Event::State(node, method_name)),
                Some(Enclosing::Variable(Some(variable_name))) if is_class_component(node, &pragmas) => {
                    vars.push(Variable {
                        variable_name,
                        scope: Node::Expr(node).scope().id().idx(),
                        since: node.span().start,
                        node: node.span(),
                    });
                }
                _ => {}
            }
        }
        for pattern in patterns {
            let PatKind::Object(properties) = pattern.kind() else {
                continue;
            };
            for property in properties.iter().map(Node::PatProp) {
                if get_property_name(property).is_some_and(|it| it == b"state")
                    && let Some(node) = get_property_name_node(property)
                {
                    let scope = Node::Pat(pattern).scope().id().idx();
                    vars.push(Variable { variable_name: b"state", scope, since: pattern.span().start, node });
                }
            }
        }
        if !events.is_empty() {
            follow_methods(events, &first_arguments, &pragmas, cx);
        }
        if !vars.is_empty() {
            follow_vars(&mut vars, &first_arguments, cx);
        }
    }
}

/// The `CallExpression` listener, for all calls in source order. `events`: what each `this.state` adds to `methods`, if
/// it's in a component.
fn follow_methods<'a>(
    mut events: Vec<Event<'a>>,
    first_arguments: &FirstArguments,
    pragmas: &Pragmas<'_>,
    cx: &Cx<'a, NoAccessStateInSetstate>,
) {
    let is_in_set_state = |it: &Expr<'a>| first_arguments.count_containing(it.span().start) > 0;
    // Only such a call can report.
    if !cx.file().exprs_of_kind(ExprTag::Call).any(|it| is_in_set_state(&it)) {
        return;
    }
    events.retain(|it| matches!(it, Event::State(node, _) if is_class_component(*node, pragmas)));
    let is_lookup =
        |it: &Expr<'a>| it.callee().is_some_and(|callee| callee.tag() == ExprTag::Ident) || is_in_set_state(it);
    events.extend(cx.file().exprs_of_kind(ExprTag::Call).filter(is_lookup).map(Event::Call));
    sort::sort_by_key(&mut events, |it| (it.span().start, Reverse(it.span().end)));
    let mut methods: FxHashMap<Option<&'a [u8]>, Vec<Span>> = FxHashMap::default();
    let mut enclosing_method = AncestorMemo::default();
    for event in events {
        let node = match event {
            Event::State(node, method_name) => {
                methods.entry(method_name).or_default().push(node.span());
                continue;
            }
            Event::Call(node) => node,
        };
        let name = node.callee().and_then(Expr::as_ident).map(Name::bytes);
        let is_in_set_state = is_in_set_state(&node);
        if !methods.contains_key(&name)
            || (name.is_none() && !is_in_set_state)
            || !is_class_component(node, pragmas)
        {
            continue;
        }
        if name.is_some()
            && let Some(method_name) = enclosing_method.find(Node::Expr(node), |_, current| {
                (matches!(current, Node::Member(_)) && estree_type_name(current) == "MethodDefinition")
                    .then(|| get_property_name(current))
            })
        {
            let found = methods.get(&name).cloned().unwrap_or_default();
            methods.entry(method_name).or_default().extend(found);
        }
        if is_in_set_state {
            for node in methods.get(&name).into_iter().flatten() {
                cx.report(*node, USE_CALLBACK);
            }
        }
    }
}

/// The `Identifier` listener, for every identifier in a first argument of `this.setState`.
fn follow_vars<'a>(
    vars: &mut [Variable<'a>],
    first_arguments: &FirstArguments,
    cx: &Cx<'a, NoAccessStateInSetstate>,
) {
    sort::sort_by_key(vars, |it| (it.variable_name, it.scope, it.since));
    let vars = &*vars;
    let report = |same_name_vars: &[Variable<'a>], identifier: Node<'a>| {
        let start = identifier.span().start;
        for variable in Variable::added_before(same_name_vars, identifier.scope().id().idx(), start) {
            for _ in 0..first_arguments.count_containing(start) {
                cx.report(variable.node, USE_CALLBACK);
            }
        }
    };
    let mut known = AncestorMemo::default();
    for node in cx.file().exprs_of_kind(ExprTag::Ident) {
        if first_arguments.count_containing(node.span().start) == 0 {
            continue;
        }
        let same_name_vars = Variable::with_name(vars, node.as_ident());
        if !same_name_vars.is_empty() && known.find(Node::Expr(node), is_value_or_object) == Some(true) {
            report(same_name_vars, Node::Expr(node));
        }
    }
    // A pattern's bindings aren't expressions, so they're handled here. A parameter comes before anything added in its
    // scope.
    for statement in cx.file().stmts_of_kind(StmtTag::Var) {
        if first_arguments.count_containing(statement.span().start) == 0 {
            continue;
        }
        let StmtKind::Var(declarators) = statement.kind() else {
            continue;
        };
        for declarator in declarators.iter() {
            declarator.pat().for_each_binding(&mut |name| {
                if matches!(name.parent(), Node::PatProp(it) if it.default().is_none() && !it.is_rest()) {
                    report(Variable::with_name(vars, name.as_ident()), Node::Pat(name));
                }
            });
        }
    }
}
