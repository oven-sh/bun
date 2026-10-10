#![allow(dead_code)] // until every rule of the plugin is written
//! `lib/util/defaultProps.js` of eslint-plugin-react: the visitor that finds the `defaultProps` of
//! the components.
//!
//! What it finds is in `Component::default_props` after `Components::finish`, not before.

use crate::util_ast::{Property, find_return_statement, get_property_name};
use crate::util_component_util::{get_parent_es6_component, is_es5_component};
use crate::util_components::{Components, Instructions, Visit};
use crate::util_components_list::{ComponentId, DeclaredPropType, DeclaredPropTypes, DefaultProps};
use crate::util_pragma::{get_create_class_from_context, mentions_create_class};
use crate::util_prop_wrapper::is_prop_wrapper_function;
use crate::util_props::is_default_props_declaration;
use crate::util_variable::{Found, find_variable_by_name};
use bun_lint::prelude::*;
use bun_lint::utils::estree_parent;
use rustc_hash::FxHashMap;
use std::borrow::Cow;
use std::cell::Cell;

/// What `addDefaultPropsToComponent` is given: the `name` and the `node` of each. `None`:
/// `"unresolved"`.
type DefaultPropsList<'a> = Option<Vec<(&'a [u8], Node<'a>)>>;

/// `node.type === "AssignmentExpression"`. A default in a pattern is an `AssignmentPattern`.
fn is_assignment_expression(node: Expr<'_>) -> bool {
    node.tag() == ExprTag::Assign && !node.is_assignment_target()
}

/// `node.properties`, if `node.type === "ObjectExpression"`.
fn properties_of_object_expression(node: Expr<'_>) -> Option<List<'_, Prop<'_>>> {
    match node.kind() {
        ExprKind::Object(properties) => Some(properties),
        _ => None,
    }
}

/// `returnStatement.argument`. Upstream throws where there is none.
fn argument_of(return_statement: Stmt<'_>) -> Option<Expr<'_>> {
    match return_statement.kind() {
        StmtKind::Return(argument) => argument,
        _ => None,
    }
}

/// `resolveNodeValue`, for a node that is reached from above. `None` also for the specifier of an
/// import, which is no expression.
fn resolve_node_value(mut node: Expr<'_>) -> Option<Expr<'_>> {
    loop {
        if let Some(name) = node.as_ident() {
            return match find_variable_by_name(Node::Expr(node), name)? {
                Found::Init(init) => Some(init),
                Found::Import(_) => None,
            };
        }
        let call = node.as_call().filter(|_| !node.is_chain_root());
        let wrapped = call.filter(|call| {
            let name = call.callee().as_ident();
            name.is_some_and(|name| is_prop_wrapper_function(node.file(), name.bytes()))
        });
        match wrapped.and_then(|call| call.args().first()) {
            Some(argument) => node = argument,
            None => return Some(node),
        }
    }
}

/// How many default props of a file are looked at: n components can have one object of n.
const MAX_DEFAULT_PROPS_IN_A_FILE: u32 = 1 << 17;

/// `getDefaultPropsFromObjectExpression`. `found`: how many the file has had so far: after
/// [`MAX_DEFAULT_PROPS_IN_A_FILE`] all are `"unresolved"`.
fn get_default_props_from_object_expression<'a>(
    properties: List<'a, Prop<'a>>,
    found: &Cell<u32>,
) -> DefaultPropsList<'a> {
    if found.get() > MAX_DEFAULT_PROPS_IN_A_FILE {
        return None;
    }
    found.set(found.get().saturating_add(properties.len() as u32));
    let has_spread = properties.iter().any(|it| it.kind() == PropKind::Spread);
    if has_spread {
        return None;
    }
    let is_quote = |it: &u8| matches!(it, b'"' | b'\'');
    let default_props = properties.iter().filter_map(|default_prop| {
        let file = default_prop.file();
        let mut name = file.slice(default_prop.key()?.inner_span(file));
        // `QUOTES_REGEX`: one at the start, one at the end, whatever is between them.
        if let [first, rest @ ..] = name
            && is_quote(first)
        {
            name = rest;
        }
        if let [rest @ .., last] = name
            && is_quote(last)
        {
            name = rest;
        }
        Some((name, Node::Prop(default_prop)))
    });
    Some(default_props.collect())
}

/// `components.get(componentUtil.getParentES6Component(context, node))`
fn get_es6_component_around<'a>(
    node: Member<'a>,
    components: &Components<'a>,
) -> Option<ComponentId> {
    let class = get_parent_es6_component(Node::Member(node), components.pragmas())?;
    components.get(Node::Class(class))
}

/// `defaultPropsInstructions`
#[derive(Default)]
struct DefaultPropsInstructions<'a> {
    /// `component.defaultProps` of those that have one. `None`: `"unresolved"`.
    default_props: FxHashMap<ComponentId, Option<DeclaredPropTypes<'a>>>,
    /// See [`get_default_props_from_object_expression`].
    found: Cell<u32>,
}

impl<'a> DefaultPropsInstructions<'a> {
    /// `markDefaultPropsAsUnresolved`
    fn mark_default_props_as_unresolved(
        &mut self,
        component: ComponentId,
        components: &mut Components<'a>,
    ) {
        let node = components.component(component).node;
        if let Some(updated) = components.set(node) {
            self.default_props.insert(updated, None);
        }
    }

    /// `addDefaultPropsToComponent`
    fn add_default_props_to_component(
        &mut self,
        component: ComponentId,
        default_props: DefaultPropsList<'a>,
        components: &mut Components<'a>,
    ) {
        // Early return if this component's defaultProps is already marked as "unresolved".
        if matches!(self.default_props.get(&component), Some(None)) {
            return;
        }
        let Some(default_props) = default_props else {
            self.mark_default_props_as_unresolved(component, components);
            return;
        };
        let node = components.component(component).node;
        // For a component that is banned it is the component around it.
        let Some(updated) = components.set(node) else {
            return;
        };
        let defaults = match updated == component {
            true => self.default_props.remove(&component),
            false => self.default_props.get(&component).cloned(),
        };
        let mut new_default_props = defaults.flatten().unwrap_or_default();
        for (name, node) in default_props {
            // `Object.assign` calls the setter: it becomes no property.
            if name == b"__proto__" {
                continue;
            }
            let prop = DeclaredPropType {
                name: Some(Cow::Borrowed(name)),
                node: Some(node),
                ..DeclaredPropType::default()
            };
            new_default_props.insert(Cow::Borrowed(name), prop);
        }
        self.default_props.insert(updated, Some(new_default_props));
    }

    /// `MemberExpression(node)`, for one that `isDefaultPropsDeclaration`.
    fn member_expression(&mut self, node: Expr<'a>, components: &mut Components<'a>) {
        // find component this defaultProps belongs to
        let Some(component) = components.get_related_component(node) else {
            return;
        };
        // The whole of an optional chain is in a `ChainExpression`.
        if node.is_chain_root() {
            return;
        }
        let Node::Expr(parent) = estree_parent(Node::Expr(node)) else {
            return;
        };

        // e.g.: MyComponent.defaultProps = { foo: 1 };
        // or: MyComponent.defaultProps = myDefaultProps;
        if is_assignment_expression(parent) {
            let expression = parent.right().and_then(resolve_node_value);
            match expression.and_then(properties_of_object_expression) {
                Some(properties) => self.add_default_props_to_component(
                    component,
                    get_default_props_from_object_expression(properties, &self.found),
                    components,
                ),
                // If a value can't be found, we mark the defaultProps declaration as "unresolved".
                None => self.mark_default_props_as_unresolved(component, components),
            }
            return;
        }

        // e.g.: MyComponent.defaultProps.baz = 1;
        if ast_utils::is_member_expression(parent)
            && !parent.is_chain_root()
            && let Node::Expr(assignment) = estree_parent(Node::Expr(parent))
            && is_assignment_expression(assignment)
        {
            // `node.parent.property.name`, as a key.
            let name = get_property_name(Node::Expr(parent)).unwrap_or(b"undefined");
            let default_props = vec![(name, Node::Expr(assignment))];
            self.add_default_props_to_component(component, Some(default_props), components);
        }
    }

    /// `MethodDefinition(node)`, for one that is static and `isDefaultPropsDeclaration`.
    fn method_definition(&mut self, node: Member<'a>, components: &mut Components<'a>) {
        if node.kind() != MemberKind::Getter || node.flags().contains(Flags::ABSTRACT) {
            return;
        }
        // find component this propTypes/defaultProps belongs to
        let Some(component) = get_es6_component_around(node, components) else {
            return;
        };
        let Some(return_statement) = find_return_statement(Node::Member(node)) else {
            return;
        };
        let expression = argument_of(return_statement).and_then(resolve_node_value);
        let Some(properties) = expression.and_then(properties_of_object_expression) else {
            return;
        };
        self.add_default_props_to_component(
            component,
            get_default_props_from_object_expression(properties, &self.found),
            components,
        );
    }

    /// `"ClassProperty, PropertyDefinition"(node)`, for one that is static and
    /// `isDefaultPropsDeclaration`.
    fn property_definition(&mut self, node: Member<'a>, components: &mut Components<'a>) {
        let value = node.init();
        let Some(value) = value.filter(|_| ast_utils::is_property_definition(node)) else {
            return;
        };
        // find component this propTypes/defaultProps belongs to
        let Some(component) = get_es6_component_around(node, components) else {
            return;
        };
        let expression = resolve_node_value(value);
        let Some(properties) = expression.and_then(properties_of_object_expression) else {
            return;
        };
        self.add_default_props_to_component(
            component,
            get_default_props_from_object_expression(properties, &self.found),
            components,
        );
    }

    /// `ObjectExpression(node)`
    fn object_expression(
        &mut self,
        node: Expr<'a>,
        properties: List<'a, Prop<'a>>,
        components: &mut Components<'a>,
    ) {
        // find component this propTypes/defaultProps belongs to
        let is_es5 = is_es5_component(Node::Expr(node), components.pragmas());
        let Some(component) = is_es5.then(|| components.get(Node::Expr(node))).flatten() else {
            return;
        };

        // Search for the proptypes declaration
        for property in properties {
            let is_default_prop = is_default_props_declaration(Node::Prop(property));
            let is_function_expression =
                || (Property::Prop(property).func()).is_some_and(|it| !it.is_arrow());
            if !is_default_prop || !is_function_expression() {
                continue;
            }
            let return_statement = find_return_statement(Node::Prop(property));
            let argument = return_statement.and_then(argument_of);
            if let Some(properties) = argument.and_then(properties_of_object_expression) {
                self.add_default_props_to_component(
                    component,
                    get_default_props_from_object_expression(properties, &self.found),
                    components,
                );
            }
        }
    }
}

impl<'a> Instructions<'a> for DefaultPropsInstructions<'a> {
    fn nodes(&self, file: &'a File<'a>, add: &mut dyn FnMut(Node<'a>, Visit)) {
        // The `name` of a `PrivateIdentifier` is without the `#`.
        const NAMES: [&str; 4] = [
            "defaultProps",
            "getDefaultProps",
            "#defaultProps",
            "#getDefaultProps",
        ];
        if !file.mentions_any(&NAMES) {
            return;
        }
        // MemberExpression
        let members = [ExprTag::Dot, ExprTag::Index].map(|tag| file.exprs_of_kind(tag));
        for node in members.into_iter().flatten().map(Node::Expr) {
            if is_default_props_declaration(node) {
                add(node, Visit::Enter);
            }
        }
        // MethodDefinition, PropertyDefinition
        for member in file.classes().flat_map(Class::members) {
            let node = Node::Member(member);
            if member.is_static() && is_default_props_declaration(node) {
                add(node, Visit::Enter);
            }
        }
        // ObjectExpression
        if !mentions_create_class(file, get_create_class_from_context(file)) {
            return;
        }
        let calls = [ExprTag::Call, ExprTag::New].map(|tag| file.exprs_of_kind(tag));
        for call in calls.into_iter().flatten().filter_map(Expr::as_call_like) {
            for argument in call.args() {
                let properties = properties_of_object_expression(argument);
                let mut properties = properties.into_iter().flatten().map(Node::Prop);
                if properties.any(is_default_props_declaration) {
                    add(Node::Expr(argument), Visit::Enter);
                }
            }
        }
    }

    fn enter(&mut self, node: Node<'a>, components: &mut Components<'a>) {
        match node {
            Node::Expr(e) => match properties_of_object_expression(e) {
                Some(properties) => self.object_expression(e, properties, components),
                None => self.member_expression(e, components),
            },
            Node::Member(member) => {
                self.method_definition(member, components);
                self.property_definition(member, components);
            }
            _ => {}
        }
    }

    fn program_exit(&mut self, components: &mut Components<'a>) {
        for (component, default_props) in self.default_props.drain() {
            let default_props = match default_props {
                Some(default_props) => DefaultProps::Known(
                    default_props
                        .iter()
                        .filter_map(|(_, prop)| Some((prop.name.clone()?, prop.node?)))
                        .collect(),
                ),
                None => DefaultProps::Unresolved,
            };
            components.component_mut(component).default_props = Some(default_props);
        }
    }
}

/// `defaultPropsInstructions(context, components, utils)`
pub(crate) fn defaults<'a>() -> Box<dyn Instructions<'a> + 'a> {
    Box::new(DefaultPropsInstructions::default())
}
