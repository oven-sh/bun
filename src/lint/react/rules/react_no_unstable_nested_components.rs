use bun_lint_oxlint::ast_util::{
    as_call_expression, as_function, as_function_expression, as_member_expression, as_object_property, callee_name,
    is_react_component_name, is_react_hook, static_name, static_property_name,
};
use crate::react::{
    FunctionsWithJsx, component_wrapper_functions, is_create_element_call, is_es6_component, is_hoc_call, is_jsx,
};
use crate::util_ast::{get_property_name, name_of_key};
use crate::util_component_util::get_parent_es6_component;
use crate::util_components::Components as Detected;
use crate::util_components_list::{At, Queue};
use crate::util_is_create_element::{is_create_element, is_member_called};
use crate::util_jsx::Branches;
use bun_lint_oxlint::text::glob_match;
use bun_core::strings;
use bun_glob::{Options as GlobOptions, Pattern};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{estree_parent, estree_span};

/// Disallow creating unstable components inside components
pub struct NoUnstableNestedComponents {
    allow_as_props: bool,
    prop_name_pattern: Box<[u8]>,
    /// `propNamePattern` as upstream reads it.
    minimatch: Pattern,
}

/// upstream's `generateErrorMessageWithParentName`, and `COMPONENT_AS_PROPS_INFO` or nothing.
const DO_NOT_DEFINE_COMPONENTS_DURING_RENDER: Message = Message::new(
    "",
    "Do not define components during render. React will see a new component type on every render and destroy the entire subtree’s DOM nodes and state (https://reactjs.org/docs/reconciliation.html#elements-of-different-types). Instead, move this component definition out of the parent component{{parentName}}and pass data as props.{{info}}",
);
const NO_UNSTABLE_NESTED_COMPONENTS: Message = Message::new("", "Do not define components during render.");

const COMPONENT_AS_PROPS_INFO: &str =
    " If you want to allow component creation in props, set allowAsProps option to true.";

/// What makes upstream take for a component that which it is a property of.
const RELATED: [&str; 3] = ["propTypes", "defaultProps", "getDefaultProps"];

/// What tells oxlint a component.
struct Components<'a> {
    functions_with_jsx: FunctionsWithJsx<'a>,
    component_wrapper_functions: &'a [Json],
}

pub struct State<'a> {
    /// `None`: upstream's, which are detected in `finish`.
    components: Option<Components<'a>>,
    /// What upstream listens for.
    queue: Queue<'a>,
    in_jsx_attribute_expression: AncestorMemo<'a, bool>,
    inside_create_element_props_object: AncestorMemo<'a, bool>,
    nearest_jsx_attribute_name: AncestorMemo<'a, Option<Name<'a>>>,
    nearest_call: AncestorMemo<'a, Expr<'a>>,
    /// The name of the component that something is in. `Some(None)`: it has none.
    in_component: AncestorMemo<'a, Option<Name<'a>>>,
}

impl Rule for NoUnstableNestedComponents {
    const META: Meta = Meta::plugin(Plugin::React, "no-unstable-nested-components", Kind::Problem);
    const ON: On = On::new().exprs(&[ExprTag::Call]).funcs().classes().finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let prop_name_pattern = options.str("propNamePattern");
        // An empty pattern is none for upstream.
        let minimatch = prop_name_pattern.filter(|it| !it.is_empty()).unwrap_or("render*");
        NoUnstableNestedComponents {
            allow_as_props: options.bool_or("allowAsProps", false),
            prop_name_pattern: prop_name_pattern.unwrap_or("render*").as_bytes().into(),
            minimatch: Pattern::new(minimatch.as_bytes(), GlobOptions::MINIMATCH_3),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let is_oxlint = file.language().is_oxlint;
        let has_related = !is_oxlint && file.mentions_any(&RELATED);
        let has_jsx = file.has_exprs([ExprTag::Jsx]) || file.mentions("createElement");
        let has_wrapper_functions = match is_oxlint {
            true => !component_wrapper_functions(file).is_empty(),
            false => file.settings().get(b"componentWrapperFunctions").is_some(),
        };
        let mut on = On::new().classes();
        if has_jsx || has_related {
            on = on.funcs();
        }
        // For oxlint a wrapper makes a component of a function with JSX only.
        if has_related
            || (has_jsx || !is_oxlint) && (has_wrapper_functions || file.mentions_any(&["memo", "forwardRef"]))
        {
            on = on.exprs(&[ExprTag::Call]);
        }
        // What is a component depends for upstream on what comes before.
        if is_oxlint { on } else { on.finish() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let is_oxlint = file.language().is_oxlint;
        let can_have_components = if is_oxlint { is_jsx(file) } else { Detected::may_have_any(file) };
        if !can_have_components {
            return None;
        }
        let components = is_oxlint.then(|| {
            let component_wrapper_functions = component_wrapper_functions(file);
            Components { functions_with_jsx: FunctionsWithJsx::new(file), component_wrapper_functions }
        });
        Some(State {
            components,
            queue: Queue::default(),
            in_jsx_attribute_expression: AncestorMemo::default(),
            inside_create_element_props_object: AncestorMemo::default(),
            nearest_jsx_attribute_name: AncestorMemo::default(),
            nearest_call: AncestorMemo::default(),
            in_component: AncestorMemo::default(),
        })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.listen(Node::Expr(e), cx);
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        if cx.language().is_oxlint || ast_utils::is_function_with_body(func) {
            self.listen(Node::Func(func), cx);
        }
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        // upstream listens for declarations only.
        if cx.language().is_oxlint || matches!(class.owner(), Node::Stmt(_)) {
            self.listen(Node::Class(class), cx);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut detected = Detected::new(cx.file());
        while let Some(event) = cx.state.queue.pop_until(At::END) {
            detected.advance(event.at);
            check(self, event.node, Some(&mut detected), cx);
        }
    }
}

impl NoUnstableNestedComponents {
    fn listen<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        match cx.language().is_oxlint {
            true => check(self, node, None, cx),
            false => cx.state.queue.push(At::enter(node), 0, node),
        }
    }
}

/// `node`: a `Func`, a `Class`, or the `Expr` of a call. `detected`: upstream's components when ESLint enters `node`.
fn check<'a>(
    rule: &NoUnstableNestedComponents,
    node: Node<'a>,
    mut detected: Option<&mut Detected<'a>>,
    cx: &mut Cx<'a, NoUnstableNestedComponents>,
) {
    let (file, state) = (cx.file(), &mut cx.state);
    let is_oxlint = detected.is_none();
    // What takes no walk comes first. oxlint goes by the JSX in a function and by names.
    let (is_component, is_returning_jsx) = match (detected.as_deref(), &state.components) {
        (Some(detected), _) => (detected.get(node).is_some(), detected.is_returning_jsx(node, Branches::Any)),
        (None, Some(components)) => match components.name_of_candidate(node) {
            Some(name) => {
                (matches!(node, Node::Expr(_)) || name.is_some_and(|name| is_react_component_name(name.bytes())), true)
            }
            None => return,
        },
        (None, None) => return,
    };
    if !is_component && !is_returning_jsx {
        return;
    }
    let (parent, outer) = (parent_node(node, is_oxlint), node.as_written());
    let property = parent.filter(|&it| is_property(it, outer, is_oxlint));
    let pragma = detected.as_deref().map(|it| it.pragmas().pragma);
    // upstream's `isComponentInProp`
    let is_component_in_prop = if property.is_some()
        || (state.in_jsx_attribute_expression)
            .find(outer, |child, parent| is_in_jsx_attribute_expression(child, parent, is_oxlint))
            == Some(true)
    {
        is_returning_jsx
    } else {
        (is_oxlint || is_component)
            && file.mentions("createElement")
            && (state.inside_create_element_props_object)
                .find(outer, |child, parent| is_inside_create_element_props_object(child, parent, pragma))
                == Some(true)
    };
    let is_candidate = is_component_in_prop
        || is_component
        || detected.as_deref_mut().is_some_and(|it| is_function_component_inside_class_component(node, it));
    if !is_candidate || is_component_in_prop && rule.allow_as_props || is_map_callback(node, is_oxlint) {
        return;
    }
    // `is_return_statement_of_hook`
    let as_call = |node: Node<'a>| node.as_expr().filter(|it| it.tag() == ExprTag::Call);
    if matches!(parent, Some(Node::Stmt(statement)) if statement.tag() == StmtTag::Return)
        && (state.nearest_call.find(outer, |_, ancestor| as_call(ancestor)).and_then(Expr::callee))
            .is_some_and(|callee| if is_oxlint { is_react_hook(callee) } else { is_called_as_a_hook(callee) })
    {
        return;
    }
    // `is_allowed_render_prop`. For upstream `children` is the name of an attribute only.
    let matches_pattern = |it: &[u8]| match is_oxlint {
        true => glob_match(&rule.prop_name_pattern, it),
        false => rule.minimatch.matches(it),
    };
    let key = property.and_then(|it| match is_oxlint {
        true => as_object_property(it)?.key().and_then(static_name).map(Name::bytes),
        false => get_property_name(it),
    });
    if key.is_some_and(|it| matches_pattern(it) || (is_oxlint && it == b"children")) {
        return;
    }
    // upstream asks this of what is declared in props only.
    if (is_oxlint || is_component_in_prop)
        && (is_direct_jsx_child_render_prop(node, is_oxlint)
            || (state.nearest_jsx_attribute_name)
                .find(outer, |child, parent| nearest_jsx_attribute_name(child, parent, is_oxlint))
                .flatten()
                .is_some_and(|it| it.is("children") || matches_pattern(it.bytes())))
    {
        return;
    }
    let parent_name = match (detected, &state.components) {
        (Some(detected), _) => {
            if is_inside_render_method(node, detected) || is_stateless_component_returning_null(node, detected) {
                return;
            }
            // upstream knows a component by its range, which the `ChainExpression` around a call has too.
            let is_in_chain_expression = matches!(node, Node::Expr(e) if e.is_chain_root());
            let parent_component = match estree_parent(node) {
                _ if is_in_chain_expression => detected.get(node),
                Node::File(_) => None,
                parent => detected.set(parent),
            };
            parent_component.map(|it| resolve_component_name(detected.component(it).node))
        }
        (None, Some(components)) => (state.in_component)
            .find(outer, |_, ancestor| components.component_name(ancestor))
            .map(|it| it.map(Name::bytes)),
        (None, None) => None,
    };
    let Some(parent_name) = parent_name else {
        return;
    };
    let span = estree_span(node);
    if is_oxlint {
        cx.report(span, NO_UNSTABLE_NESTED_COMPONENTS).help_with(|| {
            let parent = parent_name.map(|it| format!(" `{}`", bstr::BStr::new(it))).unwrap_or_default();
            let info = match is_component_in_prop {
                true => " If you want to allow component creation in props, set `allowAsProps` option to true.",
                false => "",
            };
            format!("Move this component definition out of the parent component{parent} and pass data as props.{info}")
        });
        return;
    }
    // Exclude lowercase parents, e.g. function createTestComponent()
    let is_lowercase = parent_name.is_some_and(|it| {
        let (first, size) = strings::wtf8_codepoint_at(it, 0);
        // `parentName[0]` of a character outside the BMP has no case.
        first > 0xFFFF || it.get(..size).is_some_and(text::is_lower_case)
    });
    if !is_lowercase {
        let parent_name = parent_name.map(|it| [" “".as_bytes(), it, "” ".as_bytes()].concat());
        cx.report(span, DO_NOT_DEFINE_COMPONENTS_DURING_RENDER)
            .data("parentName", parent_name.unwrap_or_else(|| b" ".to_vec()))
            .data("info", if is_component_in_prop { COMPONENT_AS_PROPS_INFO } else { "" });
    }
}

/// upstream's `isFunctionComponentInsideClassComponent`, for a `node` that returns JSX.
fn is_function_component_inside_class_component<'a>(node: Node<'a>, detected: &mut Detected<'a>) -> bool {
    is_in_class_declaration(node, detected)
        && detected
            .get_parent_stateless_component(node)
            .is_some_and(|it| detected.get_stateless_component(it).is_some())
}

/// `utils.getParentComponent(node).type === "ClassDeclaration"`
fn is_in_class_declaration<'a>(node: Node<'a>, detected: &Detected<'a>) -> bool {
    get_parent_es6_component(node, detected.pragmas()).is_some_and(|it| matches!(it.owner(), Node::Stmt(_)))
}

/// upstream's `isInsideRenderMethod`
fn is_inside_render_method<'a>(node: Node<'a>, detected: &Detected<'a>) -> bool {
    matches!(node.as_written(), Node::Member(method)
        if method.key().and_then(name_of_key).is_some_and(|it| it == b"render"))
        && is_in_class_declaration(node, detected)
}

/// upstream's `isStatelessComponentReturningNull`
fn is_stateless_component_returning_null<'a>(node: Node<'a>, detected: &mut Detected<'a>) -> bool {
    detected.get_stateless_component(node).is_some_and(|it| !detected.is_returning_jsx(it, Branches::Any))
}

/// upstream's `resolveComponentName`
fn resolve_component_name(node: Node<'_>) -> Option<&[u8]> {
    match node {
        Node::Func(func) if func.is_arrow() => match estree_parent(node) {
            Node::VarDecl(declarator) => declarator.pat().as_ident().map(Name::bytes),
            _ => None,
        },
        Node::Func(func) => func.name().map(Ident::bytes),
        Node::Class(class) => class.name().map(Ident::bytes),
        Node::VarDecl(declarator) => declarator.pat().as_ident().map(Name::bytes),
        _ => None,
    }
}

/// `HOOK_REGEXP.test(callee.name)`
fn is_called_as_a_hook(callee: Expr) -> bool {
    let after_use = callee.as_ident().and_then(|it| it.bytes().strip_prefix(b"use"));
    after_use.and_then(<[u8]>::first).is_some_and(|it| it.is_ascii_uppercase() || it.is_ascii_digit())
}

/// `parent`, in which `child` is, is a `Property`: for upstream also one of a pattern.
fn is_property<'a>(parent: Node<'a>, child: Node<'a>, is_oxlint: bool) -> bool {
    match parent {
        Node::PatProp(property) => !is_oxlint && property.default().map(Node::Expr) != Some(child),
        _ => as_object_property(parent).is_some(),
    }
}

/// The parent of a function, a class or a call. `None`: it is the whole of an optional chain or, for oxlint, which has
/// nodes for them, in parentheses.
fn parent_node(node: Node<'_>, is_oxlint: bool) -> Option<Node<'_>> {
    match node.as_written() {
        Node::Expr(e) => (!(is_oxlint && e.is_parenthesized()) && !e.is_chain_root()).then(|| e.parent()),
        // The function of a method is in the method.
        outer @ Node::Member(_) => Some(outer),
        outer => Some(outer.parent()),
    }
}

/// `argument` is the first argument of the call that it is in.
fn as_first_argument(argument: Node<'_>) -> Option<Call<'_>> {
    let call = parent_node(argument, true)?.as_expr()?.as_call()?;
    (call.args().first().map(Node::Expr) == Some(argument.as_written())).then_some(call)
}

impl<'a> Components<'a> {
    /// The name of a function with JSX, of a class that is a component, or of a call that makes one.
    /// `None`: `node` is none of these. `Some(None)`: it has no name.
    fn name_of_candidate(&self, node: Node<'a>) -> Option<Option<Name<'a>>> {
        let name = match node {
            Node::Func(func) if as_function(node).is_some() && self.functions_with_jsx.function_contains_jsx(func) => {
                func.name().map(Ident::name).or_else(|| function_like_name(node))
            }
            Node::Class(class) if is_es6_component(node) => {
                return Some(class.name().map(Ident::name).or_else(|| function_like_name(node)));
            }
            Node::Expr(e) if e.as_call().is_some_and(|call| self.is_hoc_component_call(call)) => None,
            _ => return None,
        };
        (!self.is_first_argument_of_hoc_call(node)).then_some(name)
    }

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
    /// `None`: `ancestor` is no component. `Some(None)`: one without a name.
    fn component_name(&self, ancestor: Node<'a>) -> Option<Option<Name<'a>>> {
        let is_component_name = |name: &Name| is_react_component_name(name.bytes());
        match ancestor {
            Node::Func(func) if as_function(ancestor).is_some() => {
                if !self.functions_with_jsx.function_contains_jsx(func) || self.is_first_argument_of_hoc_call(ancestor) {
                    return None;
                }
                match func.name().map(Ident::name).or_else(|| function_like_name(ancestor)) {
                    Some(name) => is_component_name(&name).then_some(Some(name)),
                    None => is_anonymous_default_export(ancestor).then_some(None),
                }
            }
            Node::Class(class) if is_es6_component(ancestor) => {
                class.name().map(Ident::name).or_else(|| function_like_name(ancestor)).filter(is_component_name).map(Some)
            }
            Node::Expr(e) => {
                let call = e.as_call().filter(|call| self.is_hoc_component_call(*call))?;
                if self.is_first_argument_of_hoc_call(ancestor) {
                    return None;
                }
                let name = function_like_name(ancestor).filter(is_component_name);
                Some(name.or_else(|| hoc_first_argument_name(call).filter(is_component_name)))
            }
            _ => None,
        }
    }
}

/// The `A` of `memo(forwardRef(function A() {}))`.
fn hoc_first_argument_name(mut call: Call<'_>) -> Option<Name<'_>> {
    loop {
        let first_arg = call.args().first().filter(|it| !it.is_parenthesized() && !it.is_chain_root())?;
        match first_arg.kind() {
            ExprKind::Fn(func) if !func.is_arrow() => return func.name().map(Ident::name),
            ExprKind::Call(inner) => call = inner,
            _ => return None,
        }
    }
}

/// The name of the variable, of the property or of what is assigned to.
fn function_like_name(node: Node<'_>) -> Option<Name<'_>> {
    match parent_node(node, true)? {
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
    match node.as_written() {
        Node::Stmt(statement) => statement.is_default_export(),
        _ => matches!(parent_node(node, true), Some(Node::Stmt(it)) if it.tag() == StmtTag::ExportDefault),
    }
}

/// `child` is the `e` of `{e}`.
fn is_in_jsx_expression_container(child: Node) -> bool {
    matches!(child, Node::Expr(e) if e.tag() != ExprTag::Spread && e.jsx_container_span().is_some())
}

/// One step of the way up: whether the braces that it is in, with no function and no class in between, are those of an
/// attribute. For upstream: whether it is in the braces of an attribute at all.
fn is_in_jsx_attribute_expression<'a>(child: Node<'a>, parent: Node<'a>, is_oxlint: bool) -> Option<bool> {
    if is_in_jsx_expression_container(child) && (is_oxlint || matches!(parent, Node::Prop(_))) {
        return Some(matches!(parent, Node::Prop(_)));
    }
    match parent {
        _ if !is_oxlint => None,
        Node::Expr(e) if e.tag() == ExprTag::Jsx => Some(false),
        Node::Func(_) if as_function(parent).is_some() => Some(false),
        Node::Class(_) => Some(false),
        _ => None,
    }
}

/// One step of the way up: whether the first object that is an argument of `createElement` is the second argument.
/// With upstream's `pragma`: whether the first object is the second argument of the first call of `createElement`.
fn is_inside_create_element_props_object<'a>(
    child: Node<'a>,
    parent: Node<'a>,
    pragma: Option<&[u8]>,
) -> Option<bool> {
    let object = child.as_expr().filter(|it| it.tag() == ExprTag::Object);
    if let Some(pragma) = pragma {
        let call = parent.as_expr().filter(|it| it.tag() == ExprTag::Call && is_create_element(*it, pragma));
        return match object.filter(|it| !it.is_assignment_target()) {
            Some(_) => Some(call.and_then(Expr::as_call).is_some_and(|call| call.args().get(1) == object)),
            None => call.map(|_| false),
        };
    }
    let object = object.filter(|it| !it.is_parenthesized())?;
    let call = parent.as_expr()?.as_call().filter(|call| is_create_element_call(*call))?;
    Some(call.args().get(1) == Some(object))
}

/// One step of the way up: the name of the attribute whose braces it is in.
fn nearest_jsx_attribute_name<'a>(child: Node<'a>, parent: Node<'a>, is_oxlint: bool) -> Option<Option<Name<'a>>> {
    if is_in_jsx_expression_container(child) {
        let Node::Prop(attribute) = parent else {
            return Some(None);
        };
        return Some(attribute.key().and_then(Key::name).filter(|name| !strings::contains_char(name.bytes(), b':')));
    }
    // oxlint does not look beyond an element.
    (is_oxlint && matches!(parent, Node::Expr(e) if e.tag() == ExprTag::Jsx)).then_some(None)
}

/// `<a>{() => <b />}</a>`. For upstream whatever is in the braces.
fn is_direct_jsx_child_render_prop(node: Node, is_oxlint: bool) -> bool {
    (!is_oxlint || matches!(node, Node::Func(_)))
        && is_in_jsx_expression_container(node.as_written())
        && matches!(parent_node(node, is_oxlint), Some(Node::Expr(e))
            if matches!(e.kind(), ExprKind::Jsx(jsx) if !jsx.is_fragment()))
}

/// `a.map(node)`. For upstream also `a.map(b, node)`, `new a.map(node)`, and a `node` that is `a.map()`.
fn is_map_callback(node: Node, is_oxlint: bool) -> bool {
    if !is_oxlint {
        let is_map_call = |it: Node| it.as_expr().and_then(Expr::callee).is_some_and(|it| is_member_called(it, "map"));
        return is_map_call(node) || parent_node(node, is_oxlint).is_some_and(is_map_call);
    }
    as_first_argument(node).is_some_and(|call| {
        as_member_expression(call.callee()).and_then(static_property_name).is_some_and(|name| name.is("map"))
    })
}
