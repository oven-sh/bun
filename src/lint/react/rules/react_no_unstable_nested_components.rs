use bun_lint_oxlint::ast_util::{
    as_call_expression, as_function, as_function_expression, as_member_expression, as_object_property, callee_name,
    is_react_component_name, is_react_hook, static_name, static_property_name,
};
use crate::react::{
    FunctionsWithJsx, component_wrapper_functions, is_create_element_call, is_es6_component, is_hoc_call, is_jsx,
};
use bun_lint_oxlint::text::glob_match;
use bun_core::strings;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Disallows defining React components inside other components.
pub struct NoUnstableNestedComponents {
    allow_as_props: bool,
    prop_name_pattern: Box<[u8]>,
}

const NO_UNSTABLE_NESTED_COMPONENTS: Message = Message::new("", "Do not define components during render.");

/// What tells a component.
struct Components<'a> {
    functions_with_jsx: FunctionsWithJsx<'a>,
    component_wrapper_functions: &'a [Json],
}

pub struct State<'a> {
    /// `None`: no listener is called.
    components: Option<Components<'a>>,
    in_jsx_attribute_expression: AncestorMemo<'a, bool>,
    inside_create_element_props_object: AncestorMemo<'a, bool>,
    nearest_jsx_attribute_name: AncestorMemo<'a, Option<Name<'a>>>,
    nearest_call: AncestorMemo<'a, Expr<'a>>,
    in_component: AncestorMemo<'a, ()>,
}

impl Rule for NoUnstableNestedComponents {
    const META: Meta = Meta::oxlint(Plugin::React, "no-unstable-nested-components", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        NoUnstableNestedComponents {
            allow_as_props: options.bool_or("allowAsProps", false),
            prop_name_pattern: options.str("propNamePattern").unwrap_or("render*").as_bytes().into(),
        }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        let components = is_jsx(file).then(|| {
            let component_wrapper_functions = component_wrapper_functions(file);
            if file.has_exprs([ExprTag::Jsx]) || file.mentions("createElement") {
                on.funcs(|rule, func, cx| check(rule, Node::Func(func), cx));
                if file.mentions_any(&["memo", "forwardRef"]) || !component_wrapper_functions.is_empty() {
                    on.exprs([ExprTag::Call], |rule, e, cx| check(rule, Node::Expr(e), cx));
                }
            }
            on.classes(|rule, class, cx| check(rule, Node::Class(class), cx));
            Components { functions_with_jsx: FunctionsWithJsx::new(file), component_wrapper_functions }
        });
        State {
            components,
            in_jsx_attribute_expression: AncestorMemo::default(),
            inside_create_element_props_object: AncestorMemo::default(),
            nearest_jsx_attribute_name: AncestorMemo::default(),
            nearest_call: AncestorMemo::default(),
            in_component: AncestorMemo::default(),
        }
    }
}

/// `node`: a `Func`, a `Class`, or the `Expr` of a call.
fn check<'a>(rule: &NoUnstableNestedComponents, node: Node<'a>, cx: &mut Cx<'a, NoUnstableNestedComponents>) {
    let (file, state) = (cx.file(), &mut cx.state);
    let Some(components) = &state.components else {
        return;
    };
    // What takes no walk comes first.
    let (span, name) = match node {
        Node::Func(func)
            if as_function(node).is_some() && components.functions_with_jsx.function_contains_jsx(func) =>
        {
            (func.estree_span(), func.name().map(Ident::name).or_else(|| function_like_name(node)))
        }
        Node::Class(class) if is_es6_component(node) => {
            (class.estree_span(), class.name().map(Ident::name).or_else(|| function_like_name(node)))
        }
        Node::Expr(e) if e.as_call().is_some_and(|call| components.is_hoc_component_call(call)) => (e.span(), None),
        _ => return,
    };
    let parent = parent_node(node);
    if !matches!(node, Node::Class(_)) && components.is_first_argument_of_hoc_call(node) {
        return;
    }
    let outer = outer_node(node);
    let is_component_in_prop = parent.and_then(as_object_property).is_some()
        || state.in_jsx_attribute_expression.find(outer, is_in_jsx_attribute_expression) == Some(true)
        || file.mentions("createElement")
            && state.inside_create_element_props_object.find(outer, is_inside_create_element_props_object)
                == Some(true);
    let is_candidate = is_component_in_prop
        || matches!(node, Node::Expr(_))
        || name.is_some_and(|name| is_react_component_name(name.bytes()));
    if !is_candidate || is_component_in_prop && rule.allow_as_props || is_map_callback(node) {
        return;
    }
    // `is_return_statement_of_hook`
    let as_call = |node: Node<'a>| node.as_expr().filter(|it| it.tag() == ExprTag::Call);
    if matches!(parent, Some(Node::Stmt(statement)) if statement.tag() == StmtTag::Return)
        && (state.nearest_call.find(outer, |_, ancestor| as_call(ancestor)).and_then(Expr::callee))
            .is_some_and(is_react_hook)
    {
        return;
    }
    // `is_allowed_render_prop`
    let is_allowed = |it: Name| it.is("children") || glob_match(&rule.prop_name_pattern, it.bytes());
    if is_direct_jsx_child_render_prop(node)
        || parent.and_then(as_object_property).and_then(|it| it.key().and_then(static_name)).is_some_and(is_allowed)
        || state.nearest_jsx_attribute_name.find(outer, nearest_jsx_attribute_name).flatten().is_some_and(is_allowed)
    {
        return;
    }
    if state.in_component.find(outer, |_, ancestor| components.is_component(ancestor).then_some(())).is_some() {
        cx.report(span, NO_UNSTABLE_NESTED_COMPONENTS);
    }
}

/// The `Expr`, the `Stmt` or the `Member` that a function or a class is.
fn outer_node(node: Node<'_>) -> Node<'_> {
    match node {
        Node::Func(func) => func.owner(),
        Node::Class(class) => class.owner(),
        _ => node,
    }
}

/// `ctx.nodes().parent_node(..)` of a function, a class or a call. `None`: it is in parentheses, or is the whole of an
/// optional chain.
fn parent_node(node: Node<'_>) -> Option<Node<'_>> {
    match outer_node(node) {
        Node::Expr(e) => (!e.is_parenthesized() && !e.is_chain_root()).then(|| e.parent()),
        // The function of a method is in the method.
        outer @ Node::Member(_) => Some(outer),
        outer => Some(outer.parent()),
    }
}

/// `argument` is the first argument of the call that it is in.
fn as_first_argument(argument: Node<'_>) -> Option<Call<'_>> {
    let call = parent_node(argument)?.as_expr()?.as_call()?;
    (call.args().first().map(Node::Expr) == Some(outer_node(argument))).then_some(call)
}

impl<'a> Components<'a> {
    /// `memo(forwardRef(() => <a />))`
    fn is_hoc_component_call(&self, call: Call<'a>) -> bool {
        let mut call = call;
        loop {
            if !callee_name(call).is_some_and(|name| is_hoc_call(name.bytes(), self.component_wrapper_functions)) {
                return false;
            }
            let Some(first) = call.args().first() else {
                return false;
            };
            if let Some(function) = as_function_expression(first) {
                return self.functions_with_jsx.function_contains_jsx(function);
            }
            match as_call_expression(first) {
                Some(inner) => call = inner,
                None => return false,
            }
        }
    }

    fn is_first_argument_of_hoc_call(&self, node: Node<'a>) -> bool {
        as_first_argument(node).is_some_and(|call| self.is_hoc_component_call(call))
    }

    /// What `find_parent_component_name` stops at.
    fn is_component(&self, ancestor: Node<'a>) -> bool {
        let is_component_name = |name: Name| is_react_component_name(name.bytes());
        match ancestor {
            Node::Func(func) if as_function(ancestor).is_some() => {
                self.functions_with_jsx.function_contains_jsx(func)
                    && !self.is_first_argument_of_hoc_call(ancestor)
                    && match func.name().map(Ident::name).or_else(|| function_like_name(ancestor)) {
                        Some(name) => is_component_name(name),
                        None => is_anonymous_default_export(ancestor),
                    }
            }
            Node::Class(class) => {
                is_es6_component(ancestor)
                    && class
                        .name()
                        .map(Ident::name)
                        .or_else(|| function_like_name(ancestor))
                        .is_some_and(is_component_name)
            }
            Node::Expr(e) => {
                e.as_call().is_some_and(|call| self.is_hoc_component_call(call))
                    && !self.is_first_argument_of_hoc_call(ancestor)
            }
            _ => false,
        }
    }
}

/// The name of the variable, of the property or of what is assigned to.
fn function_like_name(node: Node<'_>) -> Option<Name<'_>> {
    match parent_node(node)? {
        Node::VarDecl(declarator) => declarator.pat().as_ident(),
        parent @ Node::Prop(_) => as_object_property(parent)?.key().and_then(static_name),
        Node::Expr(assign) if assign.tag() == ExprTag::Assign => {
            let left = assign.left()?;
            left.as_ident().or_else(|| static_property_name(left))
        }
        _ => None,
    }
}

fn is_anonymous_default_export(node: Node) -> bool {
    match outer_node(node) {
        Node::Stmt(statement) => statement.is_default_export(),
        _ => matches!(parent_node(node), Some(Node::Stmt(statement)) if statement.tag() == StmtTag::ExportDefault),
    }
}

/// `child` is the `e` of `{e}`.
fn is_in_jsx_expression_container(child: Node) -> bool {
    matches!(child, Node::Expr(e) if e.tag() != ExprTag::Spread && e.jsx_container_span().is_some())
}

/// One step of the way up: whether the braces that it is in, with no function and no class in between, are those of an
/// attribute.
fn is_in_jsx_attribute_expression<'a>(child: Node<'a>, parent: Node<'a>) -> Option<bool> {
    if is_in_jsx_expression_container(child) {
        return Some(matches!(parent, Node::Prop(_)));
    }
    match parent {
        Node::Expr(e) if e.tag() == ExprTag::Jsx => Some(false),
        Node::Func(_) if as_function(parent).is_some() => Some(false),
        Node::Class(_) => Some(false),
        _ => None,
    }
}

/// One step of the way up: whether the first object that is an argument of `createElement` is the second argument.
fn is_inside_create_element_props_object<'a>(child: Node<'a>, parent: Node<'a>) -> Option<bool> {
    let object = child.as_expr().filter(|it| it.tag() == ExprTag::Object && !it.is_parenthesized())?;
    let call = parent.as_expr()?.as_call().filter(|call| is_create_element_call(*call))?;
    Some(call.args().get(1) == Some(object))
}

/// One step of the way up: the name of the attribute whose braces it is in.
fn nearest_jsx_attribute_name<'a>(child: Node<'a>, parent: Node<'a>) -> Option<Option<Name<'a>>> {
    if is_in_jsx_expression_container(child) {
        let Node::Prop(attribute) = parent else {
            return Some(None);
        };
        return Some(attribute.key().and_then(Key::name).filter(|name| !strings::contains_char(name.bytes(), b':')));
    }
    matches!(parent, Node::Expr(e) if e.tag() == ExprTag::Jsx).then_some(None)
}

/// `<a>{() => <b />}</a>`
fn is_direct_jsx_child_render_prop(node: Node) -> bool {
    matches!(node, Node::Func(_))
        && is_in_jsx_expression_container(outer_node(node))
        && matches!(parent_node(node), Some(Node::Expr(e))
            if matches!(e.kind(), ExprKind::Jsx(jsx) if !jsx.is_fragment()))
}

/// `a.map(node)`
fn is_map_callback(node: Node) -> bool {
    as_first_argument(node).is_some_and(|call| {
        as_member_expression(call.callee()).and_then(static_property_name).is_some_and(|name| name.is("map"))
    })
}
