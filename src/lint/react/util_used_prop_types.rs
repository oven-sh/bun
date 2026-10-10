#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/usedPropTypes.js` of eslint-plugin-react: the visitor that fills
//! `Component::used_prop_types` and `Component::ignore_unused_prop_types_validation`.
//!
//! | upstream | here |
//! |---|---|
//! | `usedPropTypesInstructions(context, components, utils)` | [`used`] |
//! | `hasSpreadOperator(context, property)` | `property.is_rest()` |
//! | `name in Object.prototype` | [`is_in_object_prototype`] |
//!
//! Where upstream throws, nothing is done: an `ObjectPattern` that is no parameter, two levels
//! below a property with the name of a lifecycle method.

use crate::util_ast::{
    self, Property, get_key_value, get_property_name_node, in_constructor, is_assignment_lhs,
    unwrap_ts_as_expression,
};
use crate::util_component_util::{Pragmas, get_parent_es5_component, get_parent_es6_component};
use crate::util_components::{Components, Instructions, Visit};
use crate::util_components_list::{Component, ComponentId, UsedPropType};
use crate::util_is_create_element::is_member_called;
use crate::util_version::get_react_version_from_context;
use bun_lint::prelude::*;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::{estree_parent, estree_type_name};
use rustc_hash::{FxHashMap, FxHashSet};
use smallvec::SmallVec;
use std::borrow::Cow;

const LIFE_CYCLE_METHODS: [&[u8]; 4] = [
    b"componentWillReceiveProps",
    b"shouldComponentUpdate",
    b"componentWillUpdate",
    b"componentDidUpdate",
];
const ASYNC_SAFE_LIFE_CYCLE_METHODS: [&[u8]; 4] = [
    b"getDerivedStateFromProps",
    b"getSnapshotBeforeUpdate",
    b"UNSAFE_componentWillReceiveProps",
    b"UNSAFE_componentWillUpdate",
];
const COMPUTED_PROP: &[u8] = b"__COMPUTED_PROP__";

/// How many names a used prop type has at most: those of all the links of `props.a.a.a ..` take
/// the square of it. Upstream goes on until its stack is full.
const MAX_DEPTH: usize = 100;

/// `props.a.b` is `["a", "b"]`.
type AllNames<'a> = SmallVec<[&'a [u8]; 2]>;

/// `parentNames.concat(name)`
fn concat<'a>(parent_names: &[&'a [u8]], name: &'a [u8]) -> AllNames<'a> {
    let mut all_names = AllNames::from_slice(parent_names);
    all_names.push(name);
    all_names
}

/// `createPropVariables`: the variable by its name, to its definition. Where upstream copies the
/// map for a scope, this remembers what the scope overwrites, and puts it back at the end.
struct PropVariables<'a> {
    prop_variables: FxHashMap<Name<'a>, AllNames<'a>>,
    has_been_written: bool,
    /// For each scope that has a map of its own upstream: how long `overwritten` was before.
    stack: Vec<Option<usize>>,
    overwritten: Vec<(Name<'a>, Option<AllNames<'a>>)>,
}

impl<'a> PropVariables<'a> {
    fn new() -> PropVariables<'a> {
        PropVariables {
            prop_variables: FxHashMap::default(),
            has_been_written: false,
            stack: vec![None],
            overwritten: Vec::new(),
        }
    }

    /// As upstream, `has_been_written` stays what the last `pop_scope` has made it: after that, a
    /// scope in one that has written writes to the map of that one.
    fn push_scope(&mut self) {
        self.stack.push(None);
    }

    fn pop_scope(&mut self) {
        if let Some(Some(before)) = self.stack.pop() {
            while self.overwritten.len() > before
                && let Some((name, all_names)) = self.overwritten.pop()
            {
                match all_names {
                    Some(all_names) => self.prop_variables.insert(name, all_names),
                    None => self.prop_variables.remove(&name),
                };
            }
        }
        self.has_been_written = self.stack.last().is_some_and(Option::is_some);
    }

    /// Adds a variable name to the current scope.
    fn set(&mut self, name: Name<'a>, all_names: AllNames<'a>) {
        // copy on write
        if !self.has_been_written
            && let Some(scope) = self.stack.last_mut()
        {
            scope.get_or_insert(self.overwritten.len());
        }
        let before = self.prop_variables.insert(name, all_names);
        self.overwritten.push((name, before));
    }

    /// The definition of a variable.
    fn get(&self, name: Name<'a>) -> Option<&AllNames<'a>> {
        self.prop_variables.get(&name)
    }
}

/// `isCommonVariableNameForProps`
fn is_common_variable_name_for_props(name: Name<'_>) -> bool {
    name.is_any(&["props", "nextProps", "prevProps"])
}

/// `mustBeValidated`
fn must_be_validated(component: &Component<'_>) -> bool {
    !component.ignore_props_validation
}

/// `name` is in `LIFE_CYCLE_METHODS`, or in the other list if that counts.
fn is_name_of_life_cycle_method(name: &[u8], check_async_safe_life_cycles: bool) -> bool {
    LIFE_CYCLE_METHODS.contains(&name)
        || (check_async_safe_life_cycles && ASYNC_SAFE_LIFE_CYCLE_METHODS.contains(&name))
}

/// `node.parent`, if that has a `key`, for a function, a class or the initializer of a field: a
/// `Member` or a `Prop`.
fn parent_with_key(node: Node<'_>) -> Option<Node<'_>> {
    let written = match node {
        Node::Func(func) => func.owner(),
        Node::Class(class) => class.owner(),
        _ => node,
    };
    match written {
        // A signature is the node itself.
        Node::Member(member) => (!member.is_signature()).then_some(written),
        Node::Expr(e) => match e.parent() {
            parent @ Node::Prop(_) => Some(parent),
            // Not from a decorator.
            parent @ Node::Member(member) => (member.init() == Some(e)).then_some(parent),
            _ => None,
        },
        _ => None,
    }
}

/// `inLifeCycleMethod`
fn in_life_cycle_method(node: Node<'_>, check_async_safe_life_cycles: bool) -> bool {
    node.scope().chain().any(|scope| {
        parent_with_key(scope.node())
            .and_then(util_ast::get_property_name)
            .is_some_and(|name| is_name_of_life_cycle_method(name, check_async_safe_life_cycles))
    })
}

/// `isNodeALifeCycleMethod`, for a `Member`, a `Prop` or a `PatProp`.
fn is_node_a_life_cycle_method(node: Node<'_>, check_async_safe_life_cycles: bool) -> bool {
    matches!(node, Node::Member(member) if member.is_constructor())
        || util_ast::get_property_name(node)
            .is_some_and(|name| is_name_of_life_cycle_method(name, check_async_safe_life_cycles))
}

/// `isSetStateUpdater`
fn is_set_state_updater(node: Func<'_>) -> bool {
    let Some(written) = node.owner().as_expr() else {
        return false;
    };
    let parent = written.parent().as_expr().and_then(Expr::as_call);
    parent.is_some_and(|parent| {
        is_member_called(unwrap_ts_as_expression(parent.callee()), "setState")
            // Make sure we are in the updater not the callback
            && parent.args().first() == Some(written)
    })
}

/// `param.name`
fn name_of_param(param: Param<'_>) -> Option<Name<'_>> {
    let is_pattern =
        !param.is_rest() && !param.is_parameter_property() && param.default().is_none();
    param.pat().as_ident().filter(|_| is_pattern)
}

/// `isPropArgumentInSetStateUpdater`
fn is_prop_argument_in_set_state_updater<'a>(node: Node<'a>, name: Name<'a>) -> bool {
    let prop_argument = node.scope().chain().find_map(|scope| match scope.node() {
        Node::Func(block) if is_set_state_updater(block) => block.params_with_this().nth(1),
        _ => None,
    });
    prop_argument.and_then(name_of_param) == Some(name)
}

/// `isInClassComponent`
fn is_in_class_component(node: Node<'_>, pragmas: &Pragmas<'_>) -> bool {
    get_parent_es6_component(node, pragmas).is_some()
        || get_parent_es5_component(node, pragmas).is_some()
}

/// `isThisDotProps`, for a node that is reached from above.
fn is_this_dot_props(node: Expr<'_>) -> bool {
    is_member_called(node, "props")
        && (node.object()).is_some_and(|it| unwrap_ts_as_expression(it).tag() == ExprTag::This)
}

/// `isPropTypesUsageByMemberExpression`: `this.props.*`, `props.*`, `prevProps.*`, `nextProps.*`.
fn is_prop_types_usage_by_member_expression(
    node: Expr<'_>,
    pragmas: &Pragmas<'_>,
    check_async_safe_life_cycles: bool,
) -> bool {
    let Some(unwrapped_object_node) = node.object().map(unwrap_ts_as_expression) else {
        return false;
    };
    let name = unwrapped_object_node.as_ident();
    let member = Node::Expr(node);
    if is_in_class_component(member, pragmas) {
        // this.props.*
        return is_this_dot_props(unwrapped_object_node)
            // props.* or prevProps.* or nextProps.*
            || (name.is_some_and(is_common_variable_name_for_props)
                && (in_life_cycle_method(member, check_async_safe_life_cycles)
                    || in_constructor(member)))
            // this.setState((_, props) => props.*))
            || name.is_some_and(|name| is_prop_argument_in_set_state_updater(member, name));
    }
    // props.* in function component
    name.is_some_and(|name| name.is("props")) && !is_assignment_lhs(node)
}

/// `getPropertyName`. It can be empty.
fn get_property_name<'a>(
    node: Expr<'a>,
    pragmas: &Pragmas<'_>,
    check_async_safe_life_cycles: bool,
) -> Option<&'a [u8]> {
    match node.kind() {
        ExprKind::Dot { name, .. } => (!node.is_private_member()).then(|| name.bytes()),
        ExprKind::Index { index, .. } => match index.kind() {
            ExprKind::Dot { .. } | ExprKind::Index { .. } if !index.is_chain_root() => None,
            // Accept computed properties that are literal strings
            ExprKind::String(value) => Some(value.bytes()),
            // Accept number as well but only accept props[123]
            ExprKind::Number(_)
                if is_prop_types_usage_by_member_expression(
                    node,
                    pragmas,
                    check_async_safe_life_cycles,
                ) =>
            {
                Some(index.text())
            }
            _ => Some(COMPUTED_PROP),
        },
        _ => None,
    }
}

/// `name in Object.prototype`
pub(crate) fn is_in_object_prototype(name: &[u8]) -> bool {
    matches!(
        name,
        b"constructor"
            | b"__defineGetter__"
            | b"__defineSetter__"
            | b"hasOwnProperty"
            | b"__lookupGetter__"
            | b"__lookupSetter__"
            | b"isPrototypeOf"
            | b"propertyIsEnumerable"
            | b"toString"
            | b"valueOf"
            | b"__proto__"
            | b"toLocaleString"
    )
}

/// `param.type === "AssignmentPattern" ? param.left.properties : param.properties`
fn properties_of_param(param: Param<'_>) -> Option<List<'_, PatProp<'_>>> {
    match param.pat().kind() {
        PatKind::Object(properties) if !param.is_rest() && !param.is_parameter_property() => {
            Some(properties)
        }
        _ => None,
    }
}

/// `isSetStateUpdater(node) ? node.params[1] : node.params[0]`
fn prop_param(node: Func<'_>) -> Option<Param<'_>> {
    (node.params_with_this()).nth(usize::from(is_set_state_updater(node)))
}

/// `components.get(utils.getParentComponent(node))`
fn get_parent_component<'a>(
    node: Node<'a>,
    components: &mut Components<'a>,
) -> Option<ComponentId> {
    let parent_component = components.get_parent_component(node)?;
    components.get(parent_component)
}

/// `components.set(component ? component.node : node, ..)`: whose properties are assigned to.
fn set<'a>(
    component: Option<ComponentId>,
    node: Node<'a>,
    components: &mut Components<'a>,
) -> Option<ComponentId> {
    let node = component.map_or(node, |id| components.component(id).node);
    components.set(node)
}

/// `usedPropTypes` of `markPropTypesAsUsed`.
struct UsedPropTypes<'a> {
    /// It is the array of this component itself: what is pushed is in there at once, twice too.
    of: Option<ComponentId>,
    /// It is another array: at the end, what the component does not have yet is added.
    new: Vec<UsedPropType<'a>>,
}

impl<'a> UsedPropTypes<'a> {
    fn push(&mut self, used_prop_type: UsedPropType<'a>, components: &mut Components<'a>) {
        if let Some(id) = self.of
            && let Some(own) = components.component_mut(id).used_prop_types.as_mut()
        {
            own.push(used_prop_type);
        } else {
            self.new.push(used_prop_type);
        }
    }
}

/// `JSXSpreadAttribute(node)`
fn jsx_spread_attribute<'a>(node: Prop<'a>, components: &mut Components<'a>) {
    let component = get_parent_component(Node::Prop(node), components);
    if let Some(id) = set(component, Node::Prop(node), components) {
        components
            .component_mut(id)
            .ignore_unused_prop_types_validation =
            node.value().is_none_or(|it| it.tag() != ExprTag::Object);
    }
}

struct UsedPropTypesInstructions<'a> {
    check_async_safe_life_cycles: bool,
    prop_variables: PropVariables<'a>,
    /// What `isInLifeCycleMethod` has found.
    life_cycle_methods: AncestorMemo<'a, ()>,
}

/// `usedPropTypesInstructions`
pub(crate) fn used<'a>(file: &'a File<'a>) -> Box<dyn Instructions<'a> + 'a> {
    Box::new(UsedPropTypesInstructions {
        check_async_safe_life_cycles: get_react_version_from_context(file) >= (16, 3, 0),
        prop_variables: PropVariables::new(),
        life_cycle_methods: AncestorMemo::default(),
    })
}

impl<'a> UsedPropTypesInstructions<'a> {
    /// `isInLifeCycleMethod`, for a node that is no `MethodDefinition` and no `Property` itself.
    fn is_in_life_cycle_method(&mut self, node: Node<'a>) -> bool {
        let check_async_safe_life_cycles = self.check_async_safe_life_cycles;
        let found = (self.life_cycle_methods).find_with(node, estree_parent, |_, parent| {
            let is_method_definition_or_property = match parent {
                Node::Member(_) => estree_type_name(parent) == "MethodDefinition",
                Node::Prop(_) | Node::PatProp(_) => true,
                _ => false,
            };
            (is_method_definition_or_property
                && is_node_a_life_cycle_method(parent, check_async_safe_life_cycles))
            .then_some(())
        });
        found.is_some()
    }

    /// `markPropTypesAsUsed`, for a `MemberExpression`, a function or an `ObjectPattern`.
    fn mark_prop_types_as_used(
        &mut self,
        node: Node<'a>,
        parent_names: &[&'a [u8]],
        components: &mut Components<'a>,
    ) {
        if parent_names.len() >= MAX_DEPTH {
            return;
        }
        let mut direct = None;
        let mut properties = None;
        match node {
            Node::Expr(member) => {
                let pragmas = *components.pragmas();
                let name = get_property_name(member, &pragmas, self.check_async_safe_life_cycles);
                if let Some(name) = name.filter(|it| !it.is_empty()) {
                    let all_names = concat(parent_names, name);
                    match member.parent() {
                        // It is in a `ChainExpression`.
                        _ if member.is_chain_root() => {}
                        // Match props.foo.bar, don't match bar[props.foo]
                        Node::Expr(parent)
                            if parent.object() == Some(member)
                                && ast_utils::is_member_expression(parent) =>
                        {
                            self.mark_prop_types_as_used(
                                Node::Expr(parent),
                                &all_names,
                                components,
                            );
                        }
                        Node::VarDecl(parent) => match parent.pat().kind() {
                            // Handle the destructuring part of `const {foo} = props.a.b`
                            PatKind::Object(_) => {
                                let id = Node::Pat(parent.pat());
                                self.mark_prop_types_as_used(id, &all_names, components);
                            }
                            // const a = props.a
                            PatKind::Ident(id) => self.prop_variables.set(id, all_names.clone()),
                            _ => {}
                        },
                        _ => {}
                    }
                    // Do not mark computed props as used.
                    direct = get_property_name_node(node)
                        .filter(|_| name != COMPUTED_PROP)
                        .map(|at| UsedPropType {
                            name,
                            all_names,
                            at,
                            is_property: false,
                        });
                }
            }
            // A `TSEmptyBodyFunctionExpression` is not looked at.
            Node::Func(func) if !func.has_body() => {}
            Node::Func(func) => properties = prop_param(func).and_then(properties_of_param),
            Node::Pat(pat) => match pat.kind() {
                PatKind::Object(list) => properties = Some(list),
                _ => return,
            },
            _ => return,
        }

        let component = get_parent_component(node, components);
        let known = component.map(|id| components.component(id));
        let mut used_prop_types = UsedPropTypes {
            of: component.filter(|_| known.is_some_and(|it| it.used_prop_types.is_some())),
            new: Vec::new(),
        };
        let mut ignore_unused_prop_types_validation =
            known.is_some_and(|it| it.ignore_unused_prop_types_validation);

        // Ignore Object methods
        if let Some(direct) = direct.filter(|it| !is_in_object_prototype(it.name)) {
            used_prop_types.push(direct, components);
        }
        for property in properties.into_iter().flatten() {
            let key = property.key();
            if property.is_rest() || key.is_some_and(Key::is_computed) {
                ignore_unused_prop_types_validation = true;
                break;
            }
            // Only the value of a computed key is made here.
            let Some(Cow::Borrowed(prop_name)) = get_key_value(Node::PatProp(property)) else {
                break;
            };
            // `!propName`
            if prop_name.is_empty()
                || matches!(key.map(Key::kind), Some(KeyKind::Number(it)) if it.is("0"))
            {
                break;
            }
            let all_names = concat(parent_names, prop_name);
            let used_prop_type = UsedPropType {
                name: prop_name,
                all_names: all_names.clone(),
                at: property.span(),
                is_property: true,
            };
            used_prop_types.push(used_prop_type, components);
            match property.value().kind() {
                // The value is an `AssignmentPattern`.
                _ if property.default().is_some() => {}
                PatKind::Object(_) => {
                    let value = Node::Pat(property.value());
                    self.mark_prop_types_as_used(value, &all_names, components);
                    // Which has given the component another array.
                    used_prop_types.of = None;
                }
                PatKind::Ident(value) => self.prop_variables.set(value, all_names),
                _ => {}
            }
        }

        if let Some(id) = set(component, node, components) {
            let component = components.component_mut(id);
            component.ignore_unused_prop_types_validation = ignore_unused_prop_types_validation;
            if !used_prop_types.new.is_empty() {
                component.merge_used_prop_types(used_prop_types.new);
            }
        }
    }

    /// `markDestructuredFunctionArgumentsAsUsed`
    fn mark_destructured_function_arguments_as_used(
        &mut self,
        node: Func<'a>,
        components: &mut Components<'a>,
    ) {
        let destructuring = prop_param(node).and_then(properties_of_param).is_some();
        // Of a declaration it is a block, the program or an `export`, which are no components.
        let parent = || {
            let written = node.owner().as_expr()?;
            (written.jsx_container_span().is_none()).then(|| estree_parent(Node::Func(node)))
        };
        if destructuring
            && (components.get(Node::Func(node)).is_some()
                || parent().is_some_and(|it| components.get(it).is_some()))
        {
            self.mark_prop_types_as_used(Node::Func(node), &[], components);
        }
    }

    /// `handleSetStateUpdater`
    fn handle_set_state_updater(&mut self, node: Func<'a>, components: &mut Components<'a>) {
        if node.params_with_this().nth(1).is_none() || !is_set_state_updater(node) {
            return;
        }
        self.mark_prop_types_as_used(Node::Func(node), &[], components);
    }

    /// `handleFunctionLikeExpressions`: both stateless functions and setState updater functions.
    fn handle_function_like_expressions(
        &mut self,
        node: Func<'a>,
        components: &mut Components<'a>,
    ) {
        self.prop_variables.push_scope();
        self.handle_set_state_updater(node, components);
        self.mark_destructured_function_arguments_as_used(node, components);
    }

    /// `handleCustomValidators`
    fn handle_custom_validators(
        &mut self,
        component: ComponentId,
        components: &mut Components<'a>,
    ) {
        let Some(prop_types) = &components.component(component).declared_prop_types else {
            return;
        };
        let values = prop_types.iter().filter_map(|(_, it)| match it.node {
            Some(Node::Prop(node)) => Property::Prop(node).func(),
            _ => None,
        });
        let values: Vec<Func<'a>> = values.collect();
        for value in values {
            self.mark_prop_types_as_used(Node::Func(value), &[], components);
        }
    }

    /// `VariableDeclarator(node)`
    fn variable_declarator(&mut self, node: VarDecl<'a>, components: &mut Components<'a>) {
        let Some(unwrapped_init_node) = node.init().map(unwrap_ts_as_expression) else {
            return;
        };
        let (declarator, id) = (Node::VarDecl(node), Node::Pat(node.pat()));
        let pragmas = *components.pragmas();
        let properties = match node.pat().kind() {
            // let props = this.props
            PatKind::Ident(id) => {
                if is_this_dot_props(unwrapped_init_node)
                    && is_in_class_component(declarator, &pragmas)
                {
                    self.prop_variables.set(id, AllNames::new());
                }
                return;
            }
            PatKind::Object(properties) => properties,
            // Only handles destructuring
            _ => return,
        };

        if unwrapped_init_node.tag() == ExprTag::This {
            let props_property = properties.iter().find(|&property| {
                let key = get_key_value(Node::PatProp(property));
                !property.is_rest() && key.is_some_and(|it| &*it == b"props")
            });
            // With a default it is an `AssignmentPattern`.
            let Some(value) = props_property.filter(|it| it.default().is_none()) else {
                return;
            };
            match value.value().kind() {
                // let {props: {firstname}} = this
                PatKind::Object(_) => {
                    self.mark_prop_types_as_used(Node::Pat(value.value()), &[], components);
                }
                // let {props} = this
                PatKind::Ident(name) if name.is("props") => {
                    self.prop_variables.set(name, AllNames::new());
                }
                _ => {}
            }
            return;
        }

        // let {firstname} = props
        let name = unwrapped_init_node.as_ident();
        if name.is_some_and(is_common_variable_name_for_props)
            && (components
                .get_parent_stateless_component(declarator)
                .is_some()
                || self.is_in_life_cycle_method(declarator))
        {
            self.mark_prop_types_as_used(id, &[], components);
            return;
        }

        // let {firstname} = this.props
        if is_this_dot_props(unwrapped_init_node) && is_in_class_component(declarator, &pragmas) {
            self.mark_prop_types_as_used(id, &[], components);
            return;
        }

        // let {firstname} = thing, where thing is defined by const thing = this.props.**.*
        if let Some(prop_variable) = name.and_then(|it| self.prop_variables.get(it)).cloned() {
            self.mark_prop_types_as_used(id, &prop_variable, components);
        }
    }

    /// `"MemberExpression, OptionalMemberExpression"(node)`
    fn member_expression(&mut self, node: Expr<'a>, components: &mut Components<'a>) {
        if is_prop_types_usage_by_member_expression(
            node,
            components.pragmas(),
            self.check_async_safe_life_cycles,
        ) {
            self.mark_prop_types_as_used(Node::Expr(node), &[], components);
            return;
        }

        let object = node.object().map(unwrap_ts_as_expression);
        let name = object.and_then(Expr::as_ident);
        if let Some(prop_variable) = name.and_then(|it| self.prop_variables.get(it)).cloned() {
            self.mark_prop_types_as_used(Node::Expr(node), &prop_variable, components);
        }
    }
}

impl<'a> Instructions<'a> for UsedPropTypesInstructions<'a> {
    fn nodes(&self, file: &'a File<'a>, add: &mut dyn FnMut(Node<'a>, Visit)) {
        // All that can be the name of the props or get into `propVariables`.
        let mut names: FxHashSet<Name<'a>> = FxHashSet::default();
        names.extend(["props", "nextProps", "prevProps"].map(|it| file.name_of(it)));

        // VariableDeclarator
        for statement in file.stmts_of_kind(StmtTag::Var) {
            let StmtKind::Var(declarations) = statement.kind() else {
                continue;
            };
            for node in declarations {
                let Some(init) = node.init().map(unwrap_ts_as_expression) else {
                    continue;
                };
                let is_wanted = match node.pat().kind() {
                    PatKind::Ident(id) => {
                        if matches!(init.tag(), ExprTag::Dot | ExprTag::Index) {
                            names.insert(id);
                        }
                        is_this_dot_props(init)
                    }
                    PatKind::Object(_) => {
                        (node.pat()).for_each_binding(&mut |it| names.extend(it.as_ident()));
                        matches!(init.tag(), ExprTag::This | ExprTag::Ident)
                            || is_this_dot_props(init)
                    }
                    _ => false,
                };
                if is_wanted {
                    add(Node::VarDecl(node), Visit::Enter);
                }
            }
        }

        for node in file.funcs() {
            // FunctionDeclaration, ArrowFunctionExpression, FunctionExpression
            if ast_utils::is_function_with_body(node) {
                add(Node::Func(node), Visit::EnterAndExit);
                for param in node.params_with_this().take(2) {
                    if properties_of_param(param).is_some() {
                        (param.pat()).for_each_binding(&mut |it| names.extend(it.as_ident()));
                    }
                }
                if is_set_state_updater(node) {
                    names.extend(node.params_with_this().nth(1).and_then(name_of_param));
                }
            }
            // ObjectPattern: a destructured props object in a lifecycle method
            if parent_with_key(Node::Func(node)).is_some_and(|it| {
                is_node_a_life_cycle_method(it, self.check_async_safe_life_cycles)
            }) {
                for param in node.params_with_this() {
                    if param.default().is_none()
                        && properties_of_param(param).is_some_and(|it| !it.is_empty())
                    {
                        add(Node::Pat(param.pat()), Visit::Enter);
                    }
                }
            }
        }

        // JSXSpreadAttribute
        for e in file.exprs_of_kind(ExprTag::Jsx) {
            let ExprKind::Jsx(jsx) = e.kind() else {
                continue;
            };
            for attribute in jsx.attrs() {
                if attribute.kind() == PropKind::Spread {
                    add(Node::Prop(attribute), Visit::Enter);
                }
            }
        }

        // MemberExpression
        let members = [ExprTag::Dot, ExprTag::Index].map(|tag| file.exprs_of_kind(tag));
        for node in members.into_iter().flatten() {
            let Some(object) = node.object().map(unwrap_ts_as_expression) else {
                continue;
            };
            let is_wanted = match object.as_ident() {
                Some(name) => names.contains(&name),
                None => is_this_dot_props(object),
            };
            if is_wanted && ast_utils::is_member_expression(node) {
                add(Node::Expr(node), Visit::Enter);
            }
        }
    }

    fn enter(&mut self, node: Node<'a>, components: &mut Components<'a>) {
        match node {
            Node::VarDecl(node) => self.variable_declarator(node, components),
            Node::Func(node) => self.handle_function_like_expressions(node, components),
            Node::Prop(node) => jsx_spread_attribute(node, components),
            Node::Expr(node) => self.member_expression(node, components),
            // ObjectPattern: `nodes` has looked at `node.parent.parent`.
            Node::Pat(node) => {
                if let Node::Param(param) = node.parent()
                    && let Some(func) = param.func()
                {
                    self.mark_prop_types_as_used(Node::Func(func), &[], components);
                }
            }
            _ => {}
        }
    }

    fn exit(&mut self, _: Node<'a>, _: &mut Components<'a>) {
        self.prop_variables.pop_scope();
    }

    fn program_exit(&mut self, components: &mut Components<'a>) {
        for id in components.list() {
            if must_be_validated(components.component(id)) {
                self.handle_custom_validators(id, components);
            }
        }
    }
}
