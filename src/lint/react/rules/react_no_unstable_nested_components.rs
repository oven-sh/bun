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
use bun_lint::glob::Minimatch;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{estree_parent, estree_span};

/// Disallow creating unstable components inside components
pub struct NoUnstableNestedComponents {
    allow_as_props: bool,
    prop_name_pattern: Box<[u8]>,
    /// `propNamePattern` as upstream matches it, with minimatch.
    minimatch: Minimatch,
}

/// Upstream's `generateErrorMessageWithParentName`. `info` is `COMPONENT_AS_PROPS_INFO` or empty.
const DO_NOT_DEFINE_COMPONENTS_DURING_RENDER: Message = Message::new(
    "",
    "Do not define components during render. React will see a new component type on every render and destroy the entire subtree’s DOM nodes and state (https://reactjs.org/docs/reconciliation.html#elements-of-different-types). Instead, move this component definition out of the parent component{{parentName}}and pass data as props.{{info}}",
);
const NO_UNSTABLE_NESTED_COMPONENTS: Message = Message::new("", "Do not define components during render.");

const COMPONENT_AS_PROPS_INFO: &str =
    " If you want to allow component creation in props, set allowAsProps option to true.";

/// Properties that make upstream treat the object they belong to as a component.
const RELATED: [&str; 3] = ["propTypes", "defaultProps", "getDefaultProps"];

/// How oxlint detects components.
struct Components<'a> {
    functions_with_jsx: FunctionsWithJsx<'a>,
    component_wrapper_functions: &'a [Json],
}

/// How upstream detects components.
struct Upstream<'a> {
    detected: Detected<'a>,
    /// The nodes upstream listens for, minus those that can't be reported.
    queue: Queue<'a>,
    /// The file mentions one of [`RELATED`].
    has_related: bool,
    /// The settings define `componentWrapperFunctions`.
    has_wrapper_functions: bool,
}

pub struct State<'a> {
    components: Option<Components<'a>>,
    /// `None` when emulating oxlint.
    upstream: Option<Upstream<'a>>,
    in_jsx_attribute_expression: AncestorMemo<'a, bool>,
    inside_create_element_props_object: AncestorMemo<'a, bool>,
    nearest_create_element_call: AncestorMemo<'a, Expr<'a>>,
    nearest_object: AncestorMemo<'a, Expr<'a>>,
    nearest_jsx_attribute_name: AncestorMemo<'a, Option<Name<'a>>>,
    nearest_call: AncestorMemo<'a, Expr<'a>>,
    /// Name of the enclosing component. `Some(None)` if it's unnamed.
    in_component: AncestorMemo<'a, Option<Name<'a>>>,
}

impl Rule for NoUnstableNestedComponents {
    const META: Meta = Meta::plugin(Plugin::React, "no-unstable-nested-components", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Call]).funcs().classes().finish();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        let prop_name_pattern = options.str("propNamePattern");
        // Upstream treats an empty pattern as unset.
        let minimatch = prop_name_pattern.filter(|it| !it.is_empty()).unwrap_or("render*");
        NoUnstableNestedComponents {
            allow_as_props: options.bool_or("allowAsProps", false),
            prop_name_pattern: prop_name_pattern.unwrap_or("render*").as_bytes().into(),
            minimatch: Minimatch::new(minimatch.as_bytes()),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let is_oxlint = file.language().is_oxlint;
        let has_related = !is_oxlint && file.mentions_any(&RELATED);
        let has_jsx = file.has_exprs([ExprTag::Jsx]) || file.mentions("createElement");
        let has_wrapper_functions = match is_oxlint {
            true => !component_wrapper_functions(file).is_empty(),
            false => has_wrapper_functions(file),
        };
        let mut on = On::new().classes();
        if has_jsx || has_related {
            on = on.funcs();
        }
        // For oxlint, a wrapper only makes a component out of a function that contains JSX.
        if has_related
            || (has_jsx || !is_oxlint) && (has_wrapper_functions || file.mentions_any(&["memo", "forwardRef"]))
        {
            on = on.exprs(&[ExprTag::Call]);
        }
        // For upstream, whether a node is a component depends on the code before it, so the checks run in `finish`.
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
        let upstream = (!is_oxlint).then(|| Upstream {
            detected: Detected::new(file),
            queue: Queue::default(),
            has_related: file.mentions_any(&RELATED),
            has_wrapper_functions: has_wrapper_functions(file),
        });
        Some(State {
            components,
            upstream,
            in_jsx_attribute_expression: AncestorMemo::default(),
            inside_create_element_props_object: AncestorMemo::default(),
            nearest_create_element_call: AncestorMemo::default(),
            nearest_object: AncestorMemo::default(),
            nearest_jsx_attribute_name: AncestorMemo::default(),
            nearest_call: AncestorMemo::default(),
            in_component: AncestorMemo::default(),
        })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        self.listen(Node::Expr(e), cx);
    }

    fn func<'a>(&self, func: Func<'a>, cx: &mut Cx<'a, Self>) {
        self.listen(Node::Func(func), cx);
    }

    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        self.listen(Node::Class(class), cx);
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let Some(Upstream { mut detected, mut queue, .. }) = cx.state.upstream.take() else {
            return;
        };
        while let Some(event) = queue.pop_until(At::END) {
            detected.advance(event.at);
            check(self, event.node, Some(&mut detected), cx);
        }
    }
}

impl NoUnstableNestedComponents {
    fn listen<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) {
        let Some(upstream) = &mut cx.state.upstream else {
            return check(self, node, None, cx);
        };
        if upstream.can_report(node) {
            upstream.queue.push(At::enter(node), 0, node);
        }
    }
}

/// `context.settings.componentWrapperFunctions`
fn has_wrapper_functions(file: &File) -> bool {
    file.settings().get(b"componentWrapperFunctions").is_some()
}

impl<'a> Upstream<'a> {
    /// Returns false only if `node` can't be reported: it doesn't return JSX and can't be in the component list.
    fn can_report(&self, node: Node<'a>) -> bool {
        match node {
            Node::Func(func) => {
                ast_utils::is_function_with_body(func)
                    && (self.detected.is_returning_jsx_or_null(node, Branches::Any) || self.can_be_related(node))
            }
            Node::Class(class) => matches!(class.owner(), Node::Stmt(_)),
            Node::Expr(call) => {
                let is_called = |name: &str| {
                    call.callee().is_some_and(|callee| callee.is_ident(name) || is_member_called(callee, name))
                };
                self.has_wrapper_functions || is_called("memo") || is_called("forwardRef") || self.can_be_related(node)
            }
            _ => false,
        }
    }

    /// True if `getRelatedComponent` can find `node`: it's a declaration, or its parent's `init`, `right` or `value`.
    fn can_be_related(&self, node: Node<'a>) -> bool {
        self.has_related
            && match node.owner_or_self() {
                Node::Stmt(_) => true,
                Node::Expr(e) => match e.parent() {
                    Node::VarDecl(_) | Node::Prop(_) => true,
                    Node::Expr(parent) => matches!(parent.tag(), ExprTag::Assign | ExprTag::Binary),
                    Node::Stmt(parent) => matches!(parent.tag(), StmtTag::ForIn | StmtTag::ForOf),
                    _ => false,
                },
                _ => false,
            }
    }
}

/// `node` is a `Func`, a `Class`, or a call `Expr`. `detected` has upstream's components at the point where ESLint
/// enters `node`.
fn check<'a>(
    rule: &NoUnstableNestedComponents,
    node: Node<'a>,
    mut detected: Option<&mut Detected<'a>>,
    cx: &mut Cx<'a, NoUnstableNestedComponents>,
) {
    let (file, state) = (cx.file(), &mut cx.state);
    let is_oxlint = detected.is_none();
    // Checks that don't walk the tree come first. oxlint detects components by the JSX in a function and by name.
    let (is_component, is_returning_jsx) = match (detected.as_deref(), &state.components) {
        (Some(detected), _) => {
            // `is_returning_jsx_or_null` is already known for every function, so it's tested first.
            let is_returning_jsx = detected.is_returning_jsx_or_null(node, Branches::Any)
                && detected.is_returning_jsx(node, Branches::Any);
            (detected.get(node).is_some(), is_returning_jsx)
        }
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
    let (parent, outer) = (parent_node(node, is_oxlint), node.owner_or_self());
    let property = parent.filter(|&it| is_property(it, outer, is_oxlint));
    let pragma = detected.as_deref().map(|it| it.pragmas().pragma);
    // Upstream's `isComponentInProp`
    let is_component_in_prop = if property.is_some()
        || (state.in_jsx_attribute_expression)
            .find(outer, |child, parent| is_in_jsx_attribute_expression(child, parent, is_oxlint))
            == Some(true)
    {
        is_returning_jsx
    } else if !file.mentions("createElement") {
        false
    } else if let Some(pragma) = pragma {
        is_component && is_component_inside_create_elements_prop(outer, pragma, state)
    } else {
        state.inside_create_element_props_object.find(outer, is_inside_create_element_props_object) == Some(true)
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
    // `is_allowed_render_prop`. Upstream only allows `children` as an attribute name, not as a property key.
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
    // Upstream only checks this for components declared in props.
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
            // Upstream identifies a component by its range, and the `ChainExpression` around a call has the same range.
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
        // For a character outside the BMP, `parentName[0]` is a lone surrogate, which has no case.
        first > 0xFFFF || it.get(..size).is_some_and(text::is_lower_case)
    });
    if !is_lowercase {
        let parent_name = parent_name.map(|it| [" “".as_bytes(), it, "” ".as_bytes()].concat());
        cx.report(span, DO_NOT_DEFINE_COMPONENTS_DURING_RENDER)
            .data("parentName", parent_name.unwrap_or_else(|| b" ".to_vec()))
            .data("info", if is_component_in_prop { COMPONENT_AS_PROPS_INFO } else { "" });
    }
}

/// Upstream's `isComponentInsideCreateElementsProp`, for a component. Also true if the call has no second argument and
/// `node` isn't inside an object, because both lookups then come back empty.
fn is_component_inside_create_elements_prop<'a>(node: Node<'a>, pragma: &[u8], state: &mut State<'a>) -> bool {
    let expr_with_tag = |node: Node<'a>, tag: ExprTag| node.as_expr().filter(|it| it.tag() == tag);
    let create_element_parent = state.nearest_create_element_call.find(node, |_, ancestor| {
        expr_with_tag(ancestor, ExprTag::Call).filter(|it| is_create_element(*it, pragma))
    });
    create_element_parent.and_then(Expr::as_call).is_some_and(|call| {
        let is_object_expression = |it: &Expr| !it.is_assignment_target();
        call.args().get(1)
            == state.nearest_object.find(node, |_, it| expr_with_tag(it, ExprTag::Object).filter(is_object_expression))
    })
}

/// Upstream's `isFunctionComponentInsideClassComponent`, for a `node` that returns JSX.
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

fn is_inside_render_method<'a>(node: Node<'a>, detected: &Detected<'a>) -> bool {
    matches!(node.owner_or_self(), Node::Member(method)
        if method.key().and_then(name_of_key).is_some_and(|it| it == b"render"))
        && is_in_class_declaration(node, detected)
}

fn is_stateless_component_returning_null<'a>(node: Node<'a>, detected: &mut Detected<'a>) -> bool {
    detected.get_stateless_component(node).is_some_and(|it| !detected.is_returning_jsx(it, Branches::Any))
}

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

/// True if `child`'s `parent` is a `Property`. Upstream also counts a property of an object pattern.
fn is_property<'a>(parent: Node<'a>, child: Node<'a>, is_oxlint: bool) -> bool {
    match parent {
        Node::PatProp(property) => !is_oxlint && property.default().map(Node::Expr) != Some(child),
        _ => as_object_property(parent).is_some(),
    }
}

/// Parent of a function, class or call. `None` if the node is a whole optional chain or, for oxlint (which has nodes
/// for parentheses), is parenthesized.
fn parent_node(node: Node<'_>, is_oxlint: bool) -> Option<Node<'_>> {
    match node.owner_or_self() {
        Node::Expr(e) => (!(is_oxlint && e.is_parenthesized()) && !e.is_chain_root()).then(|| e.parent()),
        // A method's function has the method as its parent.
        outer @ Node::Member(_) => Some(outer),
        outer => Some(outer.parent()),
    }
}

/// Returns the enclosing call if `argument` is its first argument.
fn as_first_argument(argument: Node<'_>) -> Option<Call<'_>> {
    let call = parent_node(argument, true)?.as_expr()?.as_call()?;
    (call.args().first().map(Node::Expr) == Some(argument.owner_or_self())).then_some(call)
}

impl<'a> Components<'a> {
    /// Name of a function with JSX, a component class, or a call that creates a component.
    /// `None` if `node` is none of these, `Some(None)` if it's unnamed.
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

    /// oxlint's `find_parent_component_name` stops at the first ancestor for which this returns `Some`.
    /// `None` if `ancestor` isn't a component, `Some(None)` if it's an unnamed one.
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

/// Name of the variable, property or assignment target that `node` is assigned to.
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
    match node.owner_or_self() {
        Node::Stmt(statement) => statement.is_default_export(),
        _ => matches!(parent_node(node, true), Some(Node::Stmt(it)) if it.tag() == StmtTag::ExportDefault),
    }
}

/// True if `child` is the `e` in `{e}`.
fn is_in_jsx_expression_container(child: Node) -> bool {
    matches!(child, Node::Expr(e) if e.tag() != ExprTag::Spread && e.jsx_container_span().is_some())
}

/// One step of the ancestor walk. For oxlint, true if the nearest enclosing `{}` belongs to an attribute, with no
/// element, function or class in between. For upstream, true if any enclosing `{}` belongs to an attribute.
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

/// One step of the ancestor walk. True if the first object that's a `createElement` argument is the second argument.
fn is_inside_create_element_props_object<'a>(child: Node<'a>, parent: Node<'a>) -> Option<bool> {
    let object = child.as_expr().filter(|it| it.tag() == ExprTag::Object && !it.is_parenthesized())?;
    let call = parent.as_expr()?.as_call().filter(|call| is_create_element_call(*call))?;
    Some(call.args().get(1) == Some(object))
}

/// One step of the ancestor walk. Returns the name of the attribute whose `{}` encloses the node.
fn nearest_jsx_attribute_name<'a>(child: Node<'a>, parent: Node<'a>, is_oxlint: bool) -> Option<Option<Name<'a>>> {
    if is_in_jsx_expression_container(child) {
        let Node::Prop(attribute) = parent else {
            return Some(None);
        };
        return Some(attribute.key().and_then(Key::name).filter(|name| !strings::contains_char(name.bytes(), b':')));
    }
    // oxlint stops at the nearest element.
    (is_oxlint && matches!(parent, Node::Expr(e) if e.tag() == ExprTag::Jsx)).then_some(None)
}

/// `<a>{() => <b />}</a>`. Upstream accepts anything in the braces, not only a function.
fn is_direct_jsx_child_render_prop(node: Node, is_oxlint: bool) -> bool {
    (!is_oxlint || matches!(node, Node::Func(_)))
        && is_in_jsx_expression_container(node.owner_or_self())
        && matches!(parent_node(node, is_oxlint), Some(Node::Expr(e))
            if matches!(e.kind(), ExprKind::Jsx(jsx) if !jsx.is_fragment()))
}

/// `a.map(node)`. Upstream also accepts `a.map(b, node)`, `new a.map(node)`, and a `node` that is itself `a.map()`.
fn is_map_callback(node: Node, is_oxlint: bool) -> bool {
    if !is_oxlint {
        let is_map_call = |it: Node| it.as_expr().and_then(Expr::callee).is_some_and(|it| is_member_called(it, "map"));
        return is_map_call(node) || parent_node(node, is_oxlint).is_some_and(is_map_call);
    }
    as_first_argument(node).is_some_and(|call| {
        as_member_expression(call.callee()).and_then(static_property_name).is_some_and(|name| name.is("map"))
    })
}
