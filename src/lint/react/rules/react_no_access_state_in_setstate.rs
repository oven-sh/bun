use crate::util_ast::{get_property_name, get_property_name_node};
use crate::util_component_util::{Pragmas, get_parent_es5_component, get_parent_es6_component};
use crate::util_is_create_element::is_member_called;
use bun_lint::context::MAX_REPORTS;
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
    State(Span, Option<&'a [u8]>),
    Call(Expr<'a>),
}

impl Event<'_> {
    fn span(self) -> Span {
        match self {
            Event::State(node, _) => node,
            Event::Call(node) => node.span(),
        }
    }
}

/// An element of `vars` that has a `variableName`.
struct Variable<'a> {
    node: Span,
    /// Where the node starts at which it is added.
    since: u32,
    scope: Scope<'a>,
    variable_name: &'a [u8],
}

/// Those of `vars`, which is in the order of the names, with the name `name`.
fn called<'v, 'a>(vars: &'v [Variable<'a>], name: &[u8]) -> &'v [Variable<'a>] {
    let rest = vars.get(vars.partition_point(|it| it.variable_name < name)..).unwrap_or_default();
    rest.get(..rest.partition_point(|it| it.variable_name == name)).unwrap_or_default()
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
        Node::Stmt(statement) => matches!(statement.kind(), StmtKind::With { object, .. } if Some(object) == current),
        _ => false,
    })
}

impl Rule for NoAccessStateInSetstate {
    const META: Meta = Meta::plugin(Plugin::React, "no-access-state-in-setstate", Kind::Problem);
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
        for node in states {
            if !is_class_component(node, &pragmas) {
                continue;
            }
            match around.find_with(Node::Expr(node), estree_parent, Around::of) {
                Some(Around::SetState) => {
                    cx.report(node, USE_CALLBACK);
                }
                Some(Around::Method(method_name)) => events.push(Event::State(node.span(), method_name)),
                Some(Around::Variable(Some(variable_name))) => vars.push(Variable {
                    node: node.span(),
                    since: node.span().start,
                    scope: Node::Expr(node).scope(),
                    variable_name,
                }),
                Some(Around::Variable(None)) | None => {}
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
                    let scope = Node::Pat(pattern).scope();
                    vars.push(Variable { node, since: pattern.span().start, scope, variable_name: b"state" });
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

/// `CallExpression`, for all calls, in the order of the source. `events`: what the `this.state` add to `methods`.
fn follow_methods<'a>(
    mut events: Vec<Event<'a>>,
    first_arguments: &FirstArguments,
    pragmas: &Pragmas<'_>,
    cx: &Cx<'a, NoAccessStateInSetstate>,
) {
    let is_asking = |it: &Expr<'a>| {
        it.callee().is_some_and(|callee| callee.tag() == ExprTag::Ident) || first_arguments.around(it.span().start) > 0
    };
    events.extend(cx.file().exprs_of_kind(ExprTag::Call).filter(is_asking).map(Event::Call));
    sort::sort_by_key(&mut events, |it| (it.span().start, Reverse(it.span().end)));
    let mut methods: FxHashMap<Option<&'a [u8]>, Vec<Span>> = FxHashMap::default();
    // How many more a call can add: upstream's list can double with each call.
    let mut room = MAX_REPORTS as usize;
    let mut method_around = AncestorMemo::default();
    for event in events {
        let node = match event {
            Event::State(node, method_name) => {
                methods.entry(method_name).or_default().push(node);
                continue;
            }
            Event::Call(node) => node,
        };
        let name = node.callee().and_then(Expr::as_ident).map(Name::bytes);
        let is_in_set_state = first_arguments.around(node.span().start) > 0;
        if !methods.contains_key(&name)
            || (name.is_none() && !is_in_set_state)
            || !is_class_component(node, pragmas)
        {
            continue;
        }
        if name.is_some()
            && room > 0
            && let Some(method_name) = method_around.find(Node::Expr(node), |_, current| {
                (matches!(current, Node::Member(_)) && estree_type_name(current) == "MethodDefinition")
                    .then(|| get_property_name(current))
            })
        {
            let found = methods.get(&name).map_or(&[][..], |it| it.get(..room).unwrap_or(it)).to_vec();
            room -= found.len();
            methods.entry(method_name).or_default().extend(found);
        }
        if is_in_set_state {
            for node in methods.get(&name).into_iter().flatten() {
                if cx.has_reported_too_much() {
                    return;
                }
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
    sort::sort_by_key(vars, |it| it.variable_name);
    let report = |variable: &Variable<'a>, identifier: Span| {
        for _ in 0..first_arguments.around(identifier.start) {
            if variable.since >= identifier.start || cx.has_reported_too_much() {
                return;
            }
            cx.report(variable.node, USE_CALLBACK);
        }
    };
    let mut known = AncestorMemo::default();
    for node in cx.file().exprs_of_kind(ExprTag::Ident) {
        if first_arguments.around(node.span().start) == 0 {
            continue;
        }
        let called = called(vars, node.as_ident().map_or(&[][..], Name::bytes));
        if called.is_empty() || known.find(Node::Expr(node), is_value_or_object) != Some(true) {
            continue;
        }
        let scope = Node::Expr(node).scope();
        called.iter().filter(|it| it.scope == scope).for_each(|it| report(it, node.span()));
    }
    // What a pattern binds is no expression. In the scope of a variable it is in the arguments that the variable is in.
    for variable in vars.iter().filter(|it| first_arguments.around(it.since) > 0) {
        let scopes = [Some(variable.scope), Some(variable.scope.variable_scope()).filter(|it| *it != variable.scope)];
        let symbols = scopes.into_iter().flatten().filter_map(|it| it.get_bytes(variable.variable_name));
        for declaration in symbols.flat_map(Symbol::declarations) {
            if let Declaration::Var(name) | Declaration::Param(name) = declaration
                && matches!(name.parent(), Node::PatProp(it) if it.default().is_none() && !it.is_rest())
                && Node::Pat(name).scope() == variable.scope
            {
                report(variable, name.span());
            }
        }
    }
}
