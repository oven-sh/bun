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

/// `isSetStateCall`
fn is_set_state_call(node: Expr<'_>) -> bool {
    node.as_call().is_some_and(|call| {
        let callee = call.callee();
        is_member_called(callee, "setState") && callee.object().is_some_and(|it| it.tag() == ExprTag::This)
    })
}

/// `isClassComponent`
fn is_class_component(node: Expr<'_>, pragmas: &Pragmas<'_>) -> bool {
    let node = Node::Expr(node);
    get_parent_es6_component(node, pragmas).is_some() || get_parent_es5_component(node, pragmas).is_some()
}

/// `"key" in parent && parent.key`, of the parent of the `FunctionExpression` `function`.
fn has_key<'a>(parent: Node<'a>, function: Node<'a>) -> bool {
    let is_function = |it| normalize(Node::Expr(it)) == function;
    match parent {
        // The parent of a decorator is a `Decorator`.
        Node::Member(member) => !member.decorators().any(is_function),
        Node::Prop(_) => estree_type_name(parent) == "Property",
        // The parent of a default is an `AssignmentPattern`.
        Node::PatProp(property) => !property.default().is_some_and(is_function),
        _ => false,
    }
}

/// What is found first on the way up from a `this.state`.
#[derive(Copy, Clone)]
enum Around<'a> {
    /// A call of `this.setState`, in whose first argument it is.
    SetState,
    /// A method, or a function that is the value of a property: `key.name`.
    Method(Option<&'a [u8]>),
    /// A `VariableDeclarator`: `id.name`.
    Variable(Option<&'a [u8]>),
}

impl<'a> Around<'a> {
    /// Whether `current`, in which `child` is, is one of these.
    fn of(child: Node<'a>, current: Node<'a>) -> Option<Around<'a>> {
        match current {
            Node::Expr(call) if is_set_state_call(call) => {
                let first = call.as_call()?.args().first()?;
                (normalize(Node::Expr(first)) == child).then_some(Around::SetState)
            }
            Node::Member(_) if estree_type_name(current) == "MethodDefinition" => {
                Some(Around::Method(get_property_name(current)))
            }
            Node::Func(_) if estree_type_name(current) == "FunctionExpression" => {
                let parent = estree_parent(current);
                has_key(parent, current).then(|| Around::Method(get_property_name(parent)))
            }
            Node::VarDecl(declarator) if estree_type_name(current) == "VariableDeclarator" => {
                Some(Around::Variable(declarator.pat().as_ident().map(Name::bytes)))
            }
            _ => None,
        }
    }
}

/// Where the first arguments of the calls of `this.setState` start, and where they end, each in order.
#[derive(Default)]
struct FirstArguments {
    starts: Vec<u32>,
    ends: Vec<u32>,
}

impl FirstArguments {
    /// In how many of them `offset` is. Two of them are apart, or one is in the other.
    fn around(&self, offset: u32) -> usize {
        let started = self.starts.partition_point(|it| *it <= offset);
        started.saturating_sub(self.ends.partition_point(|it| *it <= offset))
    }
}

/// What changes `methods`, or asks it.
#[derive(Copy, Clone)]
enum Event<'a> {
    /// A `this.state`, and the `methodName` that it is kept under.
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

/// An element of `vars` that has a `variableName`.
struct Variable<'a> {
    variable_name: &'a [u8],
    /// The number of the scope.
    scope: usize,
    /// Where the node starts at which it is added.
    since: u32,
    node: Span,
}

impl<'a> Variable<'a> {
    /// Those of `vars`, which is in the order of the fields, with the name of `identifier`.
    fn named<'v>(vars: &'v [Variable<'a>], identifier: Option<Name<'_>>) -> &'v [Variable<'a>] {
        let name = identifier.map_or(&[][..], Name::bytes);
        let rest = vars.get(vars.partition_point(|it| it.variable_name < name)..).unwrap_or_default();
        rest.get(..rest.partition_point(|it| it.variable_name == name)).unwrap_or_default()
    }

    /// Those of `named` of the scope `scope` that are added before `offset`.
    fn added_before<'v>(named: &'v [Variable<'a>], scope: usize, offset: u32) -> &'v [Variable<'a>] {
        let rest = named.get(named.partition_point(|it| it.scope < scope)..).unwrap_or_default();
        rest.get(..rest.partition_point(|it| it.scope == scope && it.since < offset)).unwrap_or_default()
    }
}

/// Above the `BinaryExpression`s around an identifier: whether that is the `value` or the `object` of its parent.
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
        // The `object` of a `with` is in a scope of its own.
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
        let mut around = AncestorMemo::default();
        // The scopes say what is in a component: they are asked last.
        for node in states {
            match around.find_with(Node::Expr(node), estree_parent, Around::of) {
                Some(Around::SetState) if is_class_component(node, &pragmas) => {
                    cx.report(node, USE_CALLBACK);
                }
                Some(Around::Method(method_name)) => events.push(Event::State(node, method_name)),
                Some(Around::Variable(Some(variable_name))) if is_class_component(node, &pragmas) => {
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

/// `CallExpression`, for all calls, in the order of the source. `events`: what the `this.state` add to `methods`, if
/// they are in a component.
fn follow_methods<'a>(
    mut events: Vec<Event<'a>>,
    first_arguments: &FirstArguments,
    pragmas: &Pragmas<'_>,
    cx: &Cx<'a, NoAccessStateInSetstate>,
) {
    let is_in_set_state = |it: &Expr<'a>| first_arguments.around(it.span().start) > 0;
    // Only such a call reports.
    if !cx.file().exprs_of_kind(ExprTag::Call).any(|it| is_in_set_state(&it)) {
        return;
    }
    events.retain(|it| matches!(it, Event::State(node, _) if is_class_component(*node, pragmas)));
    let is_asking =
        |it: &Expr<'a>| it.callee().is_some_and(|callee| callee.tag() == ExprTag::Ident) || is_in_set_state(it);
    events.extend(cx.file().exprs_of_kind(ExprTag::Call).filter(is_asking).map(Event::Call));
    sort::sort_by_key(&mut events, |it| (it.span().start, Reverse(it.span().end)));
    let mut methods: FxHashMap<Option<&'a [u8]>, Vec<Span>> = FxHashMap::default();
    let mut method_around = AncestorMemo::default();
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
            && let Some(method_name) = method_around.find(Node::Expr(node), |_, current| {
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

/// `Identifier`, for all that are in a first argument of `this.setState`.
fn follow_vars<'a>(
    vars: &mut [Variable<'a>],
    first_arguments: &FirstArguments,
    cx: &Cx<'a, NoAccessStateInSetstate>,
) {
    sort::sort_by_key(vars, |it| (it.variable_name, it.scope, it.since));
    let vars = &*vars;
    let report = |named: &[Variable<'a>], identifier: Node<'a>| {
        let start = identifier.span().start;
        for variable in Variable::added_before(named, identifier.scope().id().idx(), start) {
            for _ in 0..first_arguments.around(start) {
                cx.report(variable.node, USE_CALLBACK);
            }
        }
    };
    let mut known = AncestorMemo::default();
    for node in cx.file().exprs_of_kind(ExprTag::Ident) {
        if first_arguments.around(node.span().start) == 0 {
            continue;
        }
        let named = Variable::named(vars, node.as_ident());
        if !named.is_empty() && known.find(Node::Expr(node), is_value_or_object) == Some(true) {
            report(named, Node::Expr(node));
        }
    }
    // What a pattern binds is no expression. A parameter comes before all that is added in its scope.
    for statement in cx.file().stmts_of_kind(StmtTag::Var) {
        if first_arguments.around(statement.span().start) == 0 {
            continue;
        }
        let StmtKind::Var(declarators) = statement.kind() else {
            continue;
        };
        for declarator in declarators.iter() {
            declarator.pat().for_each_binding(&mut |name| {
                if matches!(name.parent(), Node::PatProp(it) if it.default().is_none() && !it.is_rest()) {
                    report(Variable::named(vars, name.as_ident()), Node::Pat(name));
                }
            });
        }
    }
}
