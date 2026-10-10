use crate::util_ast::{Property, get_key_value, get_property_name, get_property_name_node};
use crate::util_component_util::{is_es5_component, is_es6_component};
use crate::util_components::Components;
use crate::util_is_create_element::is_member_called;
use crate::util_jsx::Branches;
use crate::util_lifecycle_methods::{INSTANCE, STATIC};
use crate::util_pragma::get_create_class_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::sort;
use smallvec::SmallVec;
use std::borrow::Cow;
use std::cell::OnceCell;

/// Disallow common typos
pub struct NoTypos;

const TYPO_PROP_TYPE_CHAIN: Message =
    Message::new("typoPropTypeChain", "Typo in prop type chain qualifier: {{name}}");
const TYPO_PROP_TYPE: Message = Message::new("typoPropType", "Typo in declared prop type: {{name}}");
const TYPO_STATIC_CLASS_PROP: Message =
    Message::new("typoStaticClassProp", "Typo in static class property declaration");
const TYPO_PROP_DECLARATION: Message = Message::new("typoPropDeclaration", "Typo in property declaration");
const TYPO_LIFECYCLE_METHOD: Message = Message::new(
    "typoLifecycleMethod",
    "Typo in component lifecycle method declaration: {{actual}} should be {{expected}}",
);
const STATIC_LIFECYCLE_METHOD: Message =
    Message::new("staticLifecycleMethod", "Lifecycle method should be static: {{method}}");
const NO_PROP_TYPES_BINDING: Message =
    Message::new("noPropTypesBinding", "`'prop-types'` imported without a local `PropTypes` binding.");
const NO_REACT_BINDING: Message =
    Message::new("noReactBinding", "`'react'` imported without a local `React` binding.");

/// `Object.keys(require("prop-types"))` of prop-types 15.8.1
const PROP_TYPES: [&str; 22] = [
    "array",
    "bigint",
    "bool",
    "func",
    "number",
    "object",
    "string",
    "symbol",
    "any",
    "arrayOf",
    "element",
    "elementType",
    "instanceOf",
    "node",
    "objectOf",
    "oneOf",
    "oneOfType",
    "shape",
    "exact",
    "checkPropTypes",
    "resetWarningCache",
    "PropTypes",
];

const STATIC_CLASS_PROPERTIES: [&str; 4] = ["propTypes", "contextTypes", "childContextTypes", "defaultProps"];

/// `propTypesPackageName` and `reactPackageName`
#[derive(Copy, Clone, Default)]
struct Packages<'a> {
    prop_types: Option<Name<'a>>,
    react: Option<Name<'a>>,
}

/// What the imports up to the one that starts at `start` make of the two names.
struct Imported<'a> {
    start: u32,
    packages: Packages<'a>,
}

pub struct State<'a> {
    components: Components<'a>,
    /// The imports of `prop-types` and of `react` that have a specifier, in the order of the source.
    imports: OnceCell<SmallVec<[Imported<'a>; 2]>>,
}

/// What upstream does about a property of a component. All of it is known before the component is asked for.
enum Finding<'a> {
    /// The key, which is one of `STATIC_CLASS_PROPERTIES` but for the case.
    Casing(Span),
    /// The properties of the value of `propTypes`, `contextTypes` or `childContextTypes`.
    PropObject(List<'a, Prop<'a>>, Packages<'a>),
    /// `node_key_name` is `method` but for the case, or without the `static` that it needs.
    LifecycleMethod { node: Node<'a>, node_key_name: Cow<'a, [u8]>, method: &'static str, is_static: bool },
}

impl Rule for NoTypos {
    const META: Meta = Meta::plugin(Plugin::React, "no-typos", Kind::Suggestion);
    const ON: On =
        On::new().exprs(&[ExprTag::Assign, ExprTag::Call, ExprTag::New]).stmts(&[StmtTag::Import]).classes();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoTypos
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new().exprs(&[ExprTag::Assign]).classes();
        if file.mentions_any(&["prop-types", "react"]) {
            on = on.stmts(&[StmtTag::Import]);
        }
        let create_class = std::str::from_utf8(get_create_class_from_context(file));
        if create_class.is_ok_and(|it| file.mentions(it)) {
            on = on.exprs(&[ExprTag::Call, ExprTag::New]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        Some(State { components: Components::new(file), imports: OnceCell::new() })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.kind() {
            // upstream's `MemberExpression`, which does nothing but in an `AssignmentExpression`.
            ExprKind::Assign { target, value, .. } => {
                for node in [target, value] {
                    member_expression(node, e, value, cx);
                }
            }
            ExprKind::Call(call) | ExprKind::New(call) => {
                for argument in call.args() {
                    object_expression(argument, cx);
                }
            }
            _ => {}
        }
    }

    fn stmt<'a>(&self, statement: Stmt<'a>, cx: &mut Cx<'a, Self>) {
        let StmtKind::Import(import) = statement.kind() else {
            return;
        };
        let message = match import.spec().bytes() {
            b"prop-types" => NO_PROP_TYPES_BINDING,
            b"react" => NO_REACT_BINDING,
            _ => return,
        };
        if first_specifier(import).is_none() {
            cx.report(statement, message);
        }
    }

    /// upstream's `PropertyDefinition` and `MethodDefinition`.
    fn class<'a>(&self, class: Class<'a>, cx: &mut Cx<'a, Self>) {
        let mut is_component = None;
        for member in class.members() {
            let node = Node::Member(member);
            let finding = match member.kind() {
                MemberKind::Property => Finding::of_property_casing(node, member.init(), cx)
                    .filter(|_| member.is_static() && ast_utils::is_property_definition(member)),
                MemberKind::Method | MemberKind::Getter | MemberKind::Setter => {
                    Finding::of_lifecycle_method_casing(Property::Member(member))
                        .filter(|_| !member.flags().contains(Flags::ABSTRACT))
                }
                _ => None,
            };
            let Some(finding) = finding else {
                continue;
            };
            if !*is_component.get_or_insert_with(|| is_es6_component(class, cx.state.components.pragmas())) {
                return;
            }
            finding.report(TYPO_STATIC_CLASS_PROP, cx);
        }
    }
}

/// `node.specifiers[0].local.name`
fn first_specifier(import: Import<'_>) -> Option<Name<'_>> {
    let first = import.default().or_else(|| import.namespace());
    first.or_else(|| import.named().first().map(ImportSpec::local)).map(Ident::name)
}

/// upstream's `MemberExpression`, for the left or the right of `parent`, whose right is `right`.
fn member_expression<'a>(node: Expr<'a>, parent: Expr<'a>, right: Expr<'a>, cx: &mut Cx<'a, NoTypos>) {
    if !matches!(node.tag(), ExprTag::Dot | ExprTag::Index) {
        return;
    }
    let Some(finding) = Finding::of_property_casing(Node::Expr(node), Some(right), cx) else {
        return;
    };
    // A `ChainExpression` is around the whole of an optional chain. A default is in an `AssignmentPattern`.
    if node.is_chain_root() || parent.is_assignment_target() {
        return;
    }
    let components = &mut cx.state.components;
    let Some(related_component) = components.get_related_component(node) else {
        return;
    };
    let is_component = match components.component(related_component).node {
        Node::Class(class) => is_es6_component(class, components.pragmas()),
        node => components.is_returning_jsx(node, Branches::Any),
    };
    if is_component {
        finding.report(TYPO_STATIC_CLASS_PROP, cx);
    }
}

/// upstream's `ObjectExpression`, for an argument of a call or a `new`. What `isES5Component` holds for is in the list.
fn object_expression<'a>(node: Expr<'a>, cx: &Cx<'a, NoTypos>) {
    let ExprKind::Object(properties) = node.kind() else {
        return;
    };
    if !is_es5_component(Node::Expr(node), cx.state.components.pragmas()) {
        return;
    }
    for property in properties.iter().filter(|it| it.kind() != PropKind::Spread) {
        let casing = Finding::of_property_casing(Node::Prop(property), property.value(), cx);
        for finding in casing.into_iter().chain(Finding::of_lifecycle_method_casing(Property::Prop(property))) {
            finding.report(TYPO_PROP_DECLARATION, cx);
        }
    }
}

impl<'a> State<'a> {
    /// The two names when ESLint's walk gets to `position`.
    fn packages_at(&self, file: &'a File<'a>, position: u32) -> Packages<'a> {
        let imports = self.imports.get_or_init(|| imports_of(file));
        let before = imports.partition_point(|it| it.start < position);
        before.checked_sub(1).and_then(|last| imports.get(last)).map(|it| it.packages).unwrap_or_default()
    }
}

/// upstream's `ImportDeclaration`, but for the reports.
fn imports_of<'a>(file: &'a File<'a>) -> SmallVec<[Imported<'a>; 2]> {
    let mut statements: SmallVec<[Stmt<'a>; 2]> = file
        .stmts_of_kind(StmtTag::Import)
        .filter(|it| matches!(it.kind(), StmtKind::Import(import) if import.spec().is_any(&["prop-types", "react"])))
        .collect();
    sort::sort_unstable_by_key(&mut statements, |it| it.span().start);
    let mut packages = Packages::default();
    let mut imports = SmallVec::new();
    for statement in statements {
        let StmtKind::Import(import) = statement.kind() else {
            continue;
        };
        let Some(first) = first_specifier(import) else {
            continue;
        };
        if import.spec().is("react") {
            packages.react = Some(first);
            let is_prop_types = |it: &ImportSpec| !it.imported().is_string() && it.imported().name().is("PropTypes");
            if let Some(prop_types_specifier) = import.named().iter().find(is_prop_types) {
                packages.prop_types = Some(prop_types_specifier.local().name());
            }
        } else {
            packages.prop_types = Some(first);
        }
        imports.push(Imported { start: statement.span().start, packages });
    }
    imports
}

impl<'a> Finding<'a> {
    /// upstream's `reportErrorIfPropertyCasingTypo`, for a `Member`, a `Prop`, a `Dot` or an `Index`.
    fn of_property_casing(
        property: Node<'a>,
        property_value: Option<Expr<'a>>,
        cx: &Cx<'a, NoTypos>,
    ) -> Option<Finding<'a>> {
        let property_name = get_property_name(property)?;
        // No character outside ASCII becomes one of the letters of these names in lower case.
        let class_prop =
            *STATIC_CLASS_PROPERTIES.iter().find(|it| property_name.eq_ignore_ascii_case(it.as_bytes()))?;
        if property_name != class_prop.as_bytes() {
            return get_property_name_node(property).map(Finding::Casing);
        }
        let ExprKind::Object(properties) = property_value.filter(|_| class_prop != "defaultProps")?.kind() else {
            return None;
        };
        let packages = cx.state.packages_at(cx.file(), property.span().start);
        (packages.prop_types.is_some() || packages.react.is_some()).then_some(Finding::PropObject(properties, packages))
    }

    /// upstream's `reportErrorIfLifecycleMethodCasingTypo`. A key that is a number, for which upstream throws, is like
    /// no method.
    fn of_lifecycle_method_casing(property: Property<'a>) -> Option<Finding<'a>> {
        let node = property.node();
        let node_key_name = get_property_name(node).map(Cow::Borrowed).or_else(|| get_key_value(node))?;
        let method = *INSTANCE.iter().chain(&STATIC).find(|it| node_key_name.eq_ignore_ascii_case(it.as_bytes()))?;
        let is_static = property.is_static();
        (*node_key_name != *method.as_bytes() || (!is_static && STATIC.contains(&method)))
            .then_some(Finding::LifecycleMethod { node, node_key_name, method, is_static })
    }

    /// `typo`: what a wrong case of one of `STATIC_CLASS_PROPERTIES` is called.
    fn report(self, typo: Message, cx: &Cx<'a, NoTypos>) {
        match self {
            Finding::Casing(property_key) => {
                cx.report(property_key, typo);
            }
            Finding::PropObject(properties, packages) => packages.check_valid_prop_object(properties, cx),
            Finding::LifecycleMethod { node, node_key_name, method, is_static } => {
                if !is_static && STATIC.contains(&method) {
                    cx.report(node, STATIC_LIFECYCLE_METHOD).data("method", node_key_name.clone());
                }
                if *node_key_name != *method.as_bytes() {
                    cx.report(node, TYPO_LIFECYCLE_METHOD).data("actual", node_key_name).data("expected", method);
                }
            }
        }
    }
}

/// `node.type === "MemberExpression"`, for a node that is reached from above.
fn is_member_expression(node: Expr<'_>) -> bool {
    ast_utils::is_member_expression(node) && !node.is_chain_root()
}

/// `astUtil.isCallExpression(node)`, for a node that is reached from above.
fn is_call_expression(node: Expr<'_>) -> bool {
    node.tag() == ExprTag::Call && !node.is_chain_root()
}

/// The values of the properties of an `ObjectExpression`, each of which is for `checkValidProp`.
fn values_of<'a>(properties: List<'a, Prop<'a>>) -> impl Iterator<Item = Expr<'a>> {
    properties.iter().filter(|it| it.kind() != PropKind::Spread).filter_map(Prop::value)
}

/// upstream's `checkValidPropTypeQualifier(member.property)`
fn check_valid_prop_type_qualifier<'a>(member: Expr<'a>, cx: &Cx<'a, NoTypos>) {
    let node = Node::Expr(member);
    let name = get_property_name(node);
    if name.is_none_or(|it| it != b"isRequired")
        && let Some(property) = get_property_name_node(node)
    {
        cx.report(property, TYPO_PROP_TYPE_CHAIN).data("name", name.unwrap_or(b"undefined"));
    }
}

/// upstream's `checkValidPropType(member.property)`
fn check_valid_prop_type<'a>(member: Expr<'a>, cx: &Cx<'a, NoTypos>) {
    let node = Node::Expr(member);
    if let Some(name) = get_property_name(node)
        && !PROP_TYPES.iter().any(|prop_type_name| prop_type_name.as_bytes() == name)
        && let Some(property) = get_property_name_node(node)
    {
        cx.report(property, TYPO_PROP_TYPE).data("name", name);
    }
}

/// upstream's `checkValidCallExpression`. `pending`: what `checkValidProp` is still to be called with.
fn check_valid_call_expression<'a>(node: Expr<'a>, pending: &mut SmallVec<[Expr<'a>; 8]>) {
    let Some(call) = node.as_call() else {
        return;
    };
    let first = call.args().first().map(Expr::kind);
    if is_member_called(call.callee(), "shape") {
        if let Some(ExprKind::Object(properties)) = first {
            pending.extend(values_of(properties));
        }
    } else if is_member_called(call.callee(), "oneOfType")
        && let Some(ExprKind::Array(elements)) = first
    {
        pending.extend(elements);
    }
}

impl<'a> Packages<'a> {
    /// upstream's `isPropTypesPackage`
    fn is_prop_types_package(self, node: Expr<'a>) -> bool {
        match node.as_ident() {
            Some(name) => self.prop_types == Some(name),
            None => {
                self.react.is_some()
                    && is_member_called(node, "PropTypes")
                    && node.object().and_then(Expr::as_ident) == self.react
            }
        }
    }

    /// upstream's `checkValidPropObject`, for the properties of an `ObjectExpression`.
    fn check_valid_prop_object(self, properties: List<'a, Prop<'a>>, cx: &Cx<'a, NoTypos>) {
        let mut pending: SmallVec<[Expr<'a>; 8]> = values_of(properties).collect();
        while let Some(node) = pending.pop() {
            self.check_valid_prop(node, &mut pending, cx);
        }
    }

    /// upstream's `checkValidProp`, where one of the two names is known.
    fn check_valid_prop(self, node: Expr<'a>, pending: &mut SmallVec<[Expr<'a>; 8]>, cx: &Cx<'a, NoTypos>) {
        if is_call_expression(node) {
            check_valid_call_expression(node, pending);
        }
        let Some(object) = node.object().filter(|_| is_member_expression(node)) else {
            return;
        };
        if is_member_expression(object) && object.object().is_some_and(|it| self.is_prop_types_package(it)) {
            // PropTypes.myProp.isRequired
            check_valid_prop_type(object, cx);
            check_valid_prop_type_qualifier(node, cx);
        } else if self.is_prop_types_package(object) && !is_member_called(node, "isRequired") {
            // PropTypes.myProp
            check_valid_prop_type(node, cx);
        } else if is_call_expression(object) {
            check_valid_prop_type_qualifier(node, cx);
            check_valid_call_expression(object, pending);
        }
    }
}
