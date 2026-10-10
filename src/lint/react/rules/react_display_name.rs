use bun_lint_oxlint::ast_util::{
    as_call_expression, as_function_expression, as_method_definition, as_property_definition, callee_name,
    is_react_component_name, iter_outer_expressions, static_name,
};
use crate::react::{
    Returns, component_wrapper_functions, expression_returns, find_innermost_function_with_jsx, function_returns,
    is_es6_component, is_hoc_call, react_version,
};
use crate::util_ast::unwrap_ts_as_expression;
use crate::util_component_util::{Pragmas, is_es5_component};
use crate::util_components::Components;
use crate::util_components_list::{At, ComponentId, Queue};
use crate::util_is_create_context::is_create_context;
use crate::util_is_create_element::is_member_called;
use crate::util_props::{is_display_name_declaration, is_display_name_key};
use crate::util_version::get_react_version_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{estree_parent, estree_span, estree_type_name};
use rustc_hash::{FxHashMap, FxHashSet};

/// Disallow missing displayName in a React component definition.
pub struct DisplayName {
    ignore_transpiler_name: bool,
    check_context_objects: bool,
}

const NO_DISPLAY_NAME: Message = Message::new("noDisplayName", "Component definition is missing display name");
const NO_CONTEXT_DISPLAY_NAME: Message =
    Message::new("noContextDisplayName", "Context definition is missing display name");
const COMPONENT_DISPLAY_NAME: Message = Message::new("", "Component definition is missing display name.");
const CONTEXT_DISPLAY_NAME: Message = Message::new("", "Context definition is missing display name.");

#[derive(Copy, Clone)]
struct ReactComponentInfo<'a> {
    span: Span,
    is_context: bool,
    name: Option<Name<'a>>,
}

/// What oxlint's rule keeps.
struct State<'a> {
    ignore_transpiler_name: bool,
    /// The option, and React is 16.3 or later.
    check_context_objects: bool,
    memo_forwardref_compatible: bool,
    component_wrapper_functions: &'a [Json],
    returns: Returns<'a>,
    /// The innermost assignment around something.
    assignments: AncestorMemo<'a, Expr<'a>>,
}

impl Rule for DisplayName {
    const META: Meta = Meta::plugin(Plugin::React, "display-name", Kind::None).recommended();
    const ON: On = On::new().finish();
    type State<'a> = ();

    fn new(options: &Options) -> Self {
        let options = options.object(0);
        DisplayName {
            ignore_transpiler_name: options.bool_or("ignoreTranspilerName", false),
            check_context_objects: options.bool_or("checkContextObjects", false),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<()> {
        let may_have_context_objects = self.check_context_objects && file.mentions("createContext");
        // oxlint goes by the variables of the file, upstream by its list of components.
        if !file.language().is_oxlint {
            return (may_have_context_objects || Components::may_have_any(file)).then_some(());
        }
        let names = ["createElement", "createClass", "createReactClass", "memo", "forwardRef"];
        (file.has_exprs([ExprTag::Jsx])
            || file.mentions_any(&names)
            || may_have_context_objects
            || !component_wrapper_functions(file).is_empty())
        .then_some(())
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        if cx.language().is_oxlint { run_once(self, cx) } else { self.program_exit(cx) }
    }
}

// ───────────────────────────── upstream's rule ─────────────────────────────

/// A value of `contextObjects`.
struct ContextObject<'a> {
    node: Node<'a>,
    has_display_name: bool,
}

/// What upstream's listeners share.
struct Walk<'a> {
    ignore_transpiler_name: bool,
    components: Components<'a>,
    pragmas: Pragmas<'a>,
    /// The components with `hasDisplayName`.
    has_display_name: FxHashSet<ComponentId>,
    /// The values of `contextObjects`, as their keys came.
    context_objects: Vec<ContextObject<'a>>,
    /// Where in `context_objects` the value of a key is. `None`: `undefined`.
    context_object_of: FxHashMap<Option<Name<'a>>, usize>,
}

impl DisplayName {
    /// The nodes at which a listener of upstream does what depends on the time, in the order of ESLint's walk. Then
    /// `Program:exit`.
    fn program_exit<'a>(&self, cx: &Cx<'a, DisplayName>) {
        let file = cx.file();
        let mut version = None;
        let mut react_version = || *version.get_or_insert_with(|| get_react_version_from_context(file));
        let mut queue = Queue::default();
        let mut listen = |node: Node<'a>| queue.push(At::enter(node), 0, node);

        // ExpressionStatement, VariableDeclarator
        if self.check_context_objects && file.mentions("createContext") && react_version() >= (16, 3, 0) {
            for call in [ExprTag::Call, ExprTag::New].map(|tag| file.exprs_of_kind(tag)).into_iter().flatten() {
                let node = match estree_parent(Node::Expr(call)) {
                    Node::Expr(assignment) if assignment.right() == Some(call) => estree_parent(Node::Expr(assignment)),
                    parent => parent,
                };
                if is_create_context(node) {
                    listen(node);
                }
            }
        }
        for class in file.classes() {
            // ClassExpression, ClassDeclaration
            if !self.ignore_transpiler_name && class.name().is_some() {
                listen(Node::Class(class));
            }
            // PropertyDefinition, MethodDefinition
            for member in class.members().iter().map(Node::Member) {
                if is_display_name_declaration(member) || is_display_name_method(member) {
                    listen(member);
                }
            }
        }
        // MemberExpression
        if file.mentions("displayName") {
            for e in [ExprTag::Dot, ExprTag::Index].map(|tag| file.exprs_of_kind(tag)).into_iter().flatten() {
                let is_display_name = match e.kind() {
                    ExprKind::Dot { name, .. } => name.name().is("displayName") && ast_utils::is_member_expression(e),
                    ExprKind::Index { index, .. } => is_display_name_declaration(Node::Expr(index)),
                    _ => false,
                };
                if is_display_name {
                    listen(Node::Expr(e));
                }
            }
        }
        // CallExpression
        if file.mentions_any(&["memo", "forwardRef"]) || file.settings().get(b"componentWrapperFunctions").is_some() {
            for e in file.exprs_of_kind(ExprTag::Call) {
                if e.as_call().and_then(|call| call.args().first()).is_some_and(|it| it.as_fn().is_some()) {
                    listen(Node::Expr(e));
                }
            }
        }

        let components = Components::new(file);
        let mut walk = Walk {
            ignore_transpiler_name: self.ignore_transpiler_name,
            pragmas: *components.pragmas(),
            components,
            has_display_name: FxHashSet::default(),
            context_objects: Vec::new(),
            context_object_of: FxHashMap::default(),
        };
        while let Some(event) = queue.pop_until(At::END) {
            walk.components.advance(event.at);
            walk.enter(event.node);
        }

        walk.components.finish();
        for id in walk.components.list() {
            let node = walk.components.component(id).node;
            if walk.has_display_name.contains(&id) || walk.has_display_name_by_itself(node) {
                continue;
            }
            // `reportMissingDisplayName`: "^0.14.10 || ^15.7.0 || >= 16.12.0"
            if walk.is_nested_memo(node) {
                let version = react_version();
                if ((0, 14, 10)..(0, 15, 0)).contains(&version)
                    || ((15, 7, 0)..(16, 0, 0)).contains(&version)
                    || version >= (16, 12, 0)
                {
                    continue;
                }
            }
            cx.report(walk.components.component(id).span(), NO_DISPLAY_NAME).at_the_end();
        }
        for context_object in walk.context_objects.iter().filter(|it| !it.has_display_name) {
            cx.report(estree_span(context_object.node), NO_CONTEXT_DISPLAY_NAME).at_the_end();
        }
    }
}

impl<'a> Walk<'a> {
    fn enter(&mut self, node: Node<'a>) {
        match node {
            Node::Stmt(statement) => {
                if let StmtKind::Expr(expression) = statement.kind() {
                    self.set_context_object(expression.left().and_then(Expr::as_ident), node);
                }
            }
            Node::VarDecl(declarator) => self.set_context_object(declarator.pat().as_ident(), node),
            Node::Expr(e) if e.tag() == ExprTag::Call => self.call_expression(e),
            Node::Expr(e) => self.member_expression(e),
            _ => self.mark_display_name_as_declared(node),
        }
    }

    /// `contextObjects.set(name, { node, hasDisplayName: false })`
    fn set_context_object(&mut self, name: Option<Name<'a>>, node: Node<'a>) {
        let context_object = ContextObject { node, has_display_name: false };
        let next = self.context_objects.len();
        let at = *self.context_object_of.entry(name).or_insert(next);
        match self.context_objects.get_mut(at) {
            Some(known) => *known = context_object,
            None => self.context_objects.push(context_object),
        }
    }

    /// `markDisplayNameAsDeclared`
    fn mark_display_name_as_declared(&mut self, node: Node<'a>) {
        self.has_display_name.extend(self.components.set(node));
    }

    fn member_expression(&mut self, node: Expr<'a>) {
        if let Some(name) = node.object().and_then(Expr::as_ident)
            && let Some(&at) = self.context_object_of.get(&Some(name))
            && let Some(context_object) = self.context_objects.get_mut(at)
        {
            context_object.has_display_name = true;
        }
        let Some(component) = self.components.get_related_component(node) else {
            return;
        };
        let component_node = match self.components.component(component).node {
            Node::Expr(e) => Node::Expr(unwrap_ts_as_expression(e)),
            component_node => component_node,
        };
        self.mark_display_name_as_declared(component_node);
    }

    fn call_expression(&mut self, e: Expr<'a>) {
        let node = Node::Expr(e);
        let Some(function) = e.as_call().and_then(|call| call.args().first()).and_then(Expr::as_fn) else {
            return;
        };
        if !self.components.is_pragma_component_wrapper(node) {
            return;
        }
        // One report for `React.memo(React.forwardRef(..))`, at the call of `memo`.
        let is_wrapped_in_another_pragma = self.components.get_pragma_component_wrapper(node).is_some();
        if (is_wrapped_in_another_pragma || self.has_transpiler_name(Node::Func(function)))
            && self.components.get(node).is_some()
        {
            self.mark_display_name_as_declared(node);
        }
    }

    /// What the listeners for functions and for `ObjectExpression` say of `node`, which is in the list from the moment
    /// when ESLint enters it.
    fn has_display_name_by_itself(&self, node: Node<'a>) -> bool {
        match node {
            Node::Func(_) => self.has_transpiler_name(node),
            Node::Expr(e) => match e.kind() {
                ExprKind::Object(properties) => {
                    let is_display_name = |key: Key<'a>| is_display_name_key(e.file(), key);
                    self.has_transpiler_name(node) || properties.iter().any(|it| it.key().is_some_and(is_display_name))
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// `!ignoreTranspilerName && hasTranspilerName(node)`, for a function or an argument of `createClass`.
    fn has_transpiler_name(&self, node: Node<'a>) -> bool {
        if self.ignore_transpiler_name {
            return false;
        }
        match node {
            Node::Func(func) if func.name().is_some() => true,
            // namedFunctionExpression
            Node::Func(func) => match func.owner().as_expr().and_then(parent_of) {
                Some(Node::VarDecl(_)) => true,
                Some(Node::Prop(property)) => {
                    property.kind() != PropKind::Spread
                        && !property.is_jsx_attribute()
                        && !is_es5_component(property.parent(), &self.pragmas)
                }
                Some(Node::PatProp(property)) => property.default() != func.owner().as_expr(),
                _ => false,
            },
            Node::Expr(object) => match parent_of(object).and_then(Node::as_expr).and_then(parent_of) {
                // namedObjectDeclaration
                Some(Node::VarDecl(_)) => true,
                // namedObjectAssignment
                Some(Node::Expr(parent)) if parent.tag() == ExprTag::Assign && !parent.is_assignment_target() => {
                    !parent.left().is_some_and(|left| {
                        left.object().is_some_and(|it| it.is_ident("module")) && is_member_called(left, "exports")
                    })
                }
                _ => false,
            },
            _ => false,
        }
    }

    /// `isNestedMemo`
    fn is_nested_memo(&mut self, node: Node<'a>) -> bool {
        let argument = node.as_expr().and_then(Expr::as_call).and_then(|call| call.args().first());
        argument.is_some_and(|it| it.tag() == ExprTag::Call && !it.is_chain_root())
            && self.components.is_pragma_component_wrapper(node)
    }
}

/// `node.parent`. `None`: a `ChainExpression` or a `JSXExpressionContainer`.
fn parent_of(e: Expr<'_>) -> Option<Node<'_>> {
    (!e.is_chain_root() && e.jsx_container_span().is_none()).then(|| estree_parent(Node::Expr(e)))
}

/// `isDisplayNameDeclaration(node.key)` of a `MethodDefinition`.
fn is_display_name_method(node: Node<'_>) -> bool {
    matches!(node, Node::Member(member) if estree_type_name(node) == "MethodDefinition"
        && member.key().is_some_and(|key| is_display_name_key(member.file(), key)))
}

// ───────────────────────────── oxlint's rule ─────────────────────────────

fn run_once<'a>(rule: &DisplayName, cx: &Cx<'a, DisplayName>) {
    let file = cx.file();
    let version = react_version(file);
    let state = &mut State {
        ignore_transpiler_name: rule.ignore_transpiler_name,
        check_context_objects: rule.check_context_objects && version.is_none_or(|it| it >= (16, 3, 0)),
        memo_forwardref_compatible: version.is_none_or(|(major, minor, patch)| {
            major == 0 && minor >= 14 && patch >= 10 || major == 15 && minor >= 7 || (major, minor) >= (16, 12)
        }),
        component_wrapper_functions: component_wrapper_functions(file),
        returns: Returns::default(),
        assignments: AncestorMemo::default(),
    };
    let report = |cx: &Cx<'a, DisplayName>, info: ReactComponentInfo<'a>| {
        cx.report(info.span, if info.is_context { CONTEXT_DISPLAY_NAME } else { COMPONENT_DISPLAY_NAME });
    };
    // All the names of a pattern are declared by the same declarator.
    let mut last_declarator = None;
    for symbol in file.symbols() {
        let component_info = symbol.declarations().find_map(|declaration| match (declaration, declaration.node()) {
            (Declaration::Var(_), Some(Node::VarDecl(declarator))) => match last_declarator {
                Some((last, info)) if last == declarator => info,
                _ => {
                    let info = is_react_component_declarator(declarator, state);
                    last_declarator = Some((declarator, info));
                    info
                }
            },
            (Declaration::Class(class), _) => is_react_component_class(class, state),
            (Declaration::Fn(func), _) => is_react_component_function(func, state),
            _ => None,
        });
        let component_info = match component_info {
            // The name counts as the display name.
            Some(info) if info.name.is_some() && !state.ignore_transpiler_name && !info.is_context => continue,
            Some(info) => Some(info),
            None if state.check_context_objects => check_context_assignment_references(symbol, state),
            None => None,
        };
        if let Some(info) = component_info
            && !has_display_name_via_semantic(symbol, info.name)
        {
            report(cx, info);
        }
    }
    let is_export_default = |it: &Stmt| it.tag() == StmtTag::ExportDefault || it.is_default_export();
    if let Some(span) =
        file.body().iter().find(is_export_default).and_then(|it| is_anonymous_export_component(it, state))
    {
        report(cx, ReactComponentInfo { span, is_context: false, name: None });
    }
    if !file.mentions("module") {
        return;
    }
    // Many a `module` can be in the same assignment.
    let mut known = FxHashMap::default();
    for reference in file.unresolved_references_to(b"module") {
        let is_assignment = |node: Node<'a>| node.as_expr().filter(|it| it.tag() == ExprTag::Assign);
        if let Some(assign) = state.assignments.find(reference.node(), |_, ancestor| is_assignment(ancestor))
            && let Some(info) = *known
                .entry(Node::Expr(assign))
                .or_insert_with(|| is_module_exports_component(assign, state))
        {
            report(cx, info);
        }
    }
}

/// `Name.displayName = ..`
fn has_display_name_via_semantic<'a>(symbol: Symbol<'a>, component_name: Option<Name<'a>>) -> bool {
    symbol.references().filter(|it| it.is_read()).filter_map(Reference::expr).any(|reference| {
        let mut parents = iter_outer_expressions(reference);
        let (Some(Node::Expr(member)), Some(Node::Expr(assign))) = (parents.next(), parents.next()) else {
            return false;
        };
        member.member_name().is_some_and(|it| it.name().is("displayName"))
            && !member.is_jsx_tag_name()
            && assign.tag() == ExprTag::Assign
            && assign.left().is_some_and(|left| left.span().contains(reference.span()))
            // With a name, oxlint compares it with what is before the `.`, which has to be an identifier as it is
            // written.
            && (component_name.is_none() || member.object().is_some_and(|it| it == reference && !it.is_parenthesized()))
    })
}

fn is_create_context_call(call: Call) -> bool {
    callee_name(call).is_some_and(|name| name.is("createContext"))
}

fn is_create_class_call(call: Call) -> bool {
    callee_name(call).is_some_and(|name| name.is_any(&["createClass", "createReactClass"]))
}

/// `var Hello; Hello = createContext();`
fn check_context_assignment_references<'a>(
    symbol: Symbol<'a>,
    state: &mut State<'a>,
) -> Option<ReactComponentInfo<'a>> {
    let name = symbol.declarations().find_map(|declaration| match declaration.node()? {
        Node::VarDecl(declarator) if declarator.init().is_none() => Some(declarator.pat().as_ident()),
        _ => None,
    })?;
    symbol.references().filter(|it| it.is_write()).find_map(|reference| {
        let is_assignment = |node: Node<'a>| node.as_expr().filter(|it| it.tag() == ExprTag::Assign);
        let assign = state.assignments.find(reference.node(), |_, ancestor| is_assignment(ancestor))?;
        assign.right().and_then(as_call_expression).filter(|call| is_create_context_call(*call))?;
        Some(ReactComponentInfo { span: assign.span(), is_context: true, name })
    })
}

fn is_react_component_declarator<'a>(decl: VarDecl<'a>, state: &mut State<'a>) -> Option<ReactComponentInfo<'a>> {
    let (name, init) = (decl.pat().as_ident(), decl.init()?);
    let info = |is_context: bool, name: Option<Name<'a>>| {
        Some(ReactComponentInfo { span: decl.pat().span(), is_context, name })
    };
    if let Some(call) = as_call_expression(init)
        && let Some(callee_name_of_call) = callee_name(call)
    {
        if is_create_context_call(call) {
            return info(true, name).filter(|_| state.check_context_objects);
        }
        let is_hoc = |name: Name| is_hoc_call(name.bytes(), state.component_wrapper_functions);
        if is_hoc(callee_name_of_call) {
            let first_arg = call.args().first().filter(|it| !it.is_parenthesized());
            // `React.memo(React.forwardRef(..))`
            if callee_name_of_call.bytes().ends_with(b"memo")
                && first_arg.and_then(as_call_expression).and_then(callee_name).is_some_and(is_hoc)
                && state.memo_forwardref_compatible
            {
                return None;
            }
            let inner_has_name = first_arg.is_some_and(|it| match it.kind() {
                ExprKind::Fn(func) => func.name().is_some(),
                ExprKind::Ident(_) => true,
                _ => false,
            });
            return info(false, name.filter(|_| inner_has_name));
        }
        if is_create_class_call(call) {
            return info(false, name)
                .filter(|_| !has_create_react_class_display_name(call, state.ignore_transpiler_name));
        }
    }
    if expression_returns(init, &mut state.returns).has_jsx() {
        return info(false, name).filter(|_| name.is_some_and(|name| is_react_component_name(name.bytes())));
    }
    // A function that returns a component.
    if let Some(innermost) =
        find_innermost_function_with_jsx(init, state.component_wrapper_functions, &mut state.returns)
    {
        let start = innermost.estree_span().start;
        let span = Span::new(start, innermost.params_span().map_or(start, |it| it.end));
        return innermost.name().is_none().then_some(ReactComponentInfo { span, is_context: false, name: None });
    }
    match init.kind() {
        ExprKind::Object(properties)
            if !init.is_parenthesized()
                && name.is_some()
                && state.ignore_transpiler_name
                && properties.iter().any(|it| is_component_method(it, state)) =>
        {
            info(false, name)
        }
        _ => None,
    }
}

/// `Name() { return <a />; }` in an object
fn is_component_method<'a>(property: Prop<'a>, state: &mut State<'a>) -> bool {
    property.kind() == PropKind::Method
        && matches!(property.key().map(Key::kind), Some(KeyKind::Ident(name)) if is_react_component_name(name.bytes()))
        && property.func().is_some_and(|func| function_returns(func, &mut state.returns).has_jsx())
}

fn is_react_component_class<'a>(class: Class<'a>, state: &mut State<'a>) -> Option<ReactComponentInfo<'a>> {
    let name = class.name()?.name();
    (is_react_component_name(name.bytes()) && !class_has_static_display_name(class) && class_returns_jsx(class, state))
        .then(|| ReactComponentInfo { span: class.estree_span(), is_context: false, name: Some(name) })
}

fn is_react_component_function<'a>(func: Func<'a>, state: &mut State<'a>) -> Option<ReactComponentInfo<'a>> {
    let name = func.name().map(Ident::name).filter(|name| is_react_component_name(name.bytes()))?;
    let info = |name: Option<Name<'a>>| Some(ReactComponentInfo { span: func.estree_span(), is_context: false, name });
    if function_returns(func, &mut state.returns).has_jsx() {
        return info(Some(name));
    }
    for statement in func.body_statements()? {
        let StmtKind::Return(Some(expr)) = statement.kind() else {
            continue;
        };
        // The name of a function that returns a component is not the name of the component.
        if find_innermost_function_with_jsx(expr, state.component_wrapper_functions, &mut state.returns).is_some() {
            return info(None);
        }
        if let Some(call) = as_call_expression(expr).filter(|call| is_create_class_call(*call)) {
            return info(Some(name))
                .filter(|_| !has_create_react_class_display_name(call, state.ignore_transpiler_name));
        }
    }
    None
}

/// `statement`: an `export default`. The place to report, if it exports a component without a name.
fn is_anonymous_export_component<'a>(statement: Stmt<'a>, state: &mut State<'a>) -> Option<Span> {
    let is_component = match statement.kind() {
        StmtKind::ExportDefault(e) => as_function_expression(e)
            .is_some_and(|func| func.is_arrow() && function_returns(func, &mut state.returns).has_jsx()),
        StmtKind::Fn(func) => func.name().is_none() && function_returns(func, &mut state.returns).has_jsx(),
        StmtKind::Class(class) => {
            class.name().is_none()
                && !class_has_static_display_name(class)
                && class_returns_jsx(class, state)
                && (state.ignore_transpiler_name || is_es6_component(Node::Class(class)))
        }
        _ => false,
    };
    is_component.then(|| statement.export_span().unwrap_or_else(|| statement.span()))
}

/// `module.exports = ..`
fn is_module_exports_component<'a>(assign: Expr<'a>, state: &mut State<'a>) -> Option<ReactComponentInfo<'a>> {
    let ExprKind::Assign { target, value, .. } = assign.kind() else {
        return None;
    };
    let ExprKind::Dot { obj, name, .. } = target.kind() else {
        return None;
    };
    if !obj.is_ident("module") || obj.is_parenthesized() || !name.name().is("exports") {
        return None;
    }
    let info = |is_context: bool| Some(ReactComponentInfo { span: assign.span(), is_context, name: None });
    if let Some(func) = as_function_expression(value) {
        let has_no_name = func.name().is_none() || state.ignore_transpiler_name;
        return info(false).filter(|_| has_no_name && function_returns(func, &mut state.returns).has_jsx());
    }
    let call = as_call_expression(value)?;
    if is_create_class_call(call) {
        return info(false).filter(|_| !has_create_react_class_display_name(call, state.ignore_transpiler_name));
    }
    info(true).filter(|_| is_create_context_call(call) && state.check_context_objects)
}

/// An argument is an object with `displayName: ..`, or with `name: ..`.
fn has_create_react_class_display_name(call: Call, ignore_transpiler_name: bool) -> bool {
    let is_display_name = |property: Prop| {
        property.kind() != PropKind::Shorthand
            && matches!(property.key().map(Key::kind), Some(KeyKind::Ident(name) | KeyKind::String(name))
                if name.is("displayName") || !ignore_transpiler_name && name.is("name"))
    };
    call.args().iter().any(|arg| {
        matches!(arg.kind(), ExprKind::Object(properties)
        if !arg.is_parenthesized() && properties.iter().any(is_display_name))
    })
}

fn class_has_static_display_name(class: Class) -> bool {
    class.members().iter().any(|member| {
        member.is_static()
            && (as_method_definition(Node::Member(member)).is_some()
                || as_property_definition(Node::Member(member)).is_some())
            && member.key().and_then(static_name).is_some_and(|name| name.is("displayName"))
    })
}

/// A method of the class returns JSX.
fn class_returns_jsx<'a>(class: Class<'a>, state: &mut State<'a>) -> bool {
    let mut methods = class.members().iter().filter_map(|it| as_method_definition(Node::Member(it))?.func());
    methods.any(|func| function_returns(func, &mut state.returns).has_jsx())
}
