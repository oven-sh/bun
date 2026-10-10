use crate::util_component_util::{get_parent_es6_component, may_have_explicit_components};
use crate::util_components::Components;
use crate::util_props::{
    is_child_context_types_declaration, is_context_type_declaration, is_context_types_declaration,
    is_default_props_declaration, is_display_name_declaration, is_display_name_key, is_prop_types_declaration,
};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::estree_parent;

/// Enforces where React component static properties should be positioned.
pub struct StaticPropertyPlacement {
    /// upstream's `config`, in the order of `CLASS_PROPERTIES`.
    config: [Placement; 6],
}

const NOT_STATIC_CLASS_PROP: Message =
    Message::new("notStaticClassProp", "'{{name}}' should be declared as a static class property.");
const NOT_GETTER_CLASS_FUNC: Message =
    Message::new("notGetterClassFunc", "'{{name}}' should be declared as a static getter class function.");
const DECLARE_OUTSIDE_CLASS: Message =
    Message::new("declareOutsideClass", "'{{name}}' should be declared outside the class body.");

/// `POSITION_SETTINGS`
#[derive(Copy, Clone, PartialEq, Eq)]
enum Placement {
    StaticPublicField,
    StaticGetter,
    PropertyAssignment,
}

impl Placement {
    fn of(setting: &str) -> Option<Placement> {
        match setting {
            "static public field" => Some(Placement::StaticPublicField),
            "static getter" => Some(Placement::StaticGetter),
            "property assignment" => Some(Placement::PropertyAssignment),
            _ => None,
        }
    }

    /// `ERROR_MESSAGES`
    fn error_message(self) -> Message {
        match self {
            Placement::StaticPublicField => NOT_STATIC_CLASS_PROP,
            Placement::StaticGetter => NOT_GETTER_CLASS_FUNC,
            Placement::PropertyAssignment => DECLARE_OUTSIDE_CLASS,
        }
    }
}

const CLASS_PROPERTIES: [&str; 6] =
    ["propTypes", "defaultProps", "childContextTypes", "contextTypes", "contextType", "displayName"];

/// The values of `propertiesToCheck`, in the order of `CLASS_PROPERTIES`.
const PROPERTIES_TO_CHECK: [fn(Node<'_>) -> bool; 6] = [
    is_prop_types_declaration,
    is_default_props_declaration,
    is_child_context_types_declaration,
    is_context_types_declaration,
    is_context_type_declaration,
    is_display_name,
];

/// What a declaration can be called. upstream takes a private name for its text, but for `displayName`.
const NAMES: [&str; 13] = [
    "propTypes",
    "defaultProps",
    "getDefaultProps",
    "childContextTypes",
    "contextTypes",
    "contextType",
    "displayName",
    "#propTypes",
    "#defaultProps",
    "#getDefaultProps",
    "#childContextTypes",
    "#contextTypes",
    "#contextType",
];

/// With a type, these fields count as `propTypes` and `contextTypes`.
const ANNOTATED_FIELDS: [&str; 4] = ["props", "context", "#props", "#context"];

/// What `reportNodeIncorrectlyPositioned` reports.
struct Misplaced {
    name: &'static str,
    message: Message,
}

pub struct State<'a> {
    components: Components<'a>,
}

impl Rule for StaticPropertyPlacement {
    const META: Meta = Meta::plugin(Plugin::React, "static-property-placement", Kind::None);
    const ON: On = On::new().exprs(&[ExprTag::Dot, ExprTag::Index]).members();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        let default_check_type = options.str(0).and_then(Placement::of).unwrap_or(Placement::StaticPublicField);
        let additional_config = options.object(1);
        StaticPropertyPlacement {
            config: CLASS_PROPERTIES
                .map(|property| additional_config.str(property).and_then(Placement::of).unwrap_or(default_check_type)),
        }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        if !file.has_classes() && !may_have_explicit_components(file) {
            return On::new();
        }
        // Where all are to be assigned, no assignment is wrong.
        let is_any_in_the_class = self.config.iter().any(|it| *it != Placement::PropertyAssignment);
        match is_any_in_the_class && file.mentions_any(&NAMES) {
            true => Self::ON,
            false => On::new().members(),
        }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        (file.mentions_any(&NAMES) || file.mentions_any(&ANNOTATED_FIELDS))
            .then(|| State { components: Components::new(file) })
    }

    fn expr<'a>(&self, node: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_static = false;
        if !parent_has_right(node) || !ast_utils::is_member_expression(node) {
            return;
        }
        let Some(misplaced) = self.misplaced(Node::Expr(node), Placement::PropertyAssignment, is_static) else {
            return;
        };
        if is_context_in_class(node) {
            return;
        }
        let components = &mut cx.state.components;
        let Some(related_component) = components.get_related_component(node) else {
            return;
        };
        let related_node = components.component(related_component).node;
        if components.is_es6_component(related_node) {
            cx.report(node, misplaced.message).data("name", misplaced.name);
        }
    }

    fn member<'a>(&self, node: Member<'a>, cx: &mut Cx<'a, Self>) {
        let expected_rule = match node.kind() {
            MemberKind::Property if ast_utils::is_property_definition(node) => Placement::StaticPublicField,
            MemberKind::Getter if is_static_getter(node) => Placement::StaticGetter,
            _ => return,
        };
        let is_static = node.is_static();
        if let Some(misplaced) = self.misplaced(Node::Member(node), expected_rule, is_static)
            && get_parent_es6_component(Node::Member(node), cx.state.components.pragmas()).is_some()
        {
            cx.report(node, misplaced.message).data("name", misplaced.name);
        }
    }
}

impl StaticPropertyPlacement {
    /// upstream's `reportNodeIncorrectlyPositioned`, but for the report.
    fn misplaced(&self, node: Node<'_>, expected_rule: Placement, is_static: bool) -> Option<Misplaced> {
        let property = PROPERTIES_TO_CHECK.iter().position(|is_declaration| is_declaration(node))?;
        let configured = *self.config.get(property)?;
        let name = *CLASS_PROPERTIES.get(property)?;
        (configured != expected_rule || (!is_static && configured != Placement::PropertyAssignment))
            .then(|| Misplaced { name, message: configured.error_message() })
    }
}

/// `propsUtil.isDisplayNameDeclaration(astUtil.getPropertyNameNode(node))`
fn is_display_name(node: Node<'_>) -> bool {
    match node {
        Node::Member(member) => member.key().is_some_and(|key| is_display_name_key(member.file(), key)),
        Node::Expr(e) => match e.kind() {
            ExprKind::Dot { name, .. } => name.name().is("displayName"),
            ExprKind::Index { index, .. } => is_display_name_declaration(Node::Expr(index)),
            _ => false,
        },
        _ => false,
    }
}

/// Whether a getter is a `MethodDefinition` with `static`.
fn is_static_getter(member: Member<'_>) -> bool {
    let flags = member.flags();
    flags.contains(Flags::STATIC) && !flags.contains(Flags::ABSTRACT) && !member.is_signature()
}

/// Whether there is a `node.parent.right`, which can be `node` itself.
fn parent_has_right(node: Expr<'_>) -> bool {
    if node.is_chain_root() {
        return false;
    }
    match estree_parent(Node::Expr(node)) {
        Node::Expr(parent) => match parent.kind() {
            ExprKind::Assign { .. } => true,
            ExprKind::Binary { op, .. } => op != BinOp::Comma,
            _ => false,
        },
        Node::Stmt(parent) => matches!(parent.kind(), StmtKind::ForIn { .. } | StmtKind::ForOf { .. }),
        // A default is the `right` of an `AssignmentPattern`.
        Node::Param(param) => param.default() == Some(node),
        Node::PatProp(property) => property.default() == Some(node),
        Node::PatElem(element) => element.default() == Some(node),
        _ => false,
    }
}

/// upstream's `isContextInClass`: in a class declaration, not in a class expression.
fn is_context_in_class(node: Expr<'_>) -> bool {
    let mut scopes = Node::Expr(node).scope().chain();
    scopes.any(|scope| matches!(scope.node(), Node::Class(class) if matches!(class.owner(), Node::Stmt(_))))
}
