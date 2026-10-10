use crate::util_ast::{is_assignment_lhs, name_of_key};
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use bun_lint::utils::estree_type_name;

/// Disallow using another component's propTypes
pub struct ForbidForeignPropTypes {
    allow_in_prop_types: bool,
}

const FORBIDDEN_PROP_TYPE: Message = Message::new(
    "forbiddenPropType",
    "Using propTypes from another component is not safe because they may be removed in production builds",
);

pub struct State<'a> {
    prop_types: Name<'a>,
    /// Whether the nearest `AssignmentExpression` around a node assigns to a `propTypes`.
    assignments: AncestorMemo<'a, bool>,
    /// Whether the nearest `PropertyDefinition` around a node is called `propTypes`.
    class_properties: AncestorMemo<'a, bool>,
}

/// `key.name === "propTypes"`
fn is_prop_types(key: Option<Key>) -> bool {
    key.and_then(name_of_key).is_some_and(|it| it == b"propTypes")
}

impl Rule for ForbidForeignPropTypes {
    const META: Meta = Meta::plugin(Plugin::React, "forbid-foreign-prop-types", Kind::None);
    const ON: On = On::new()
        .exprs(&[ExprTag::Dot, ExprTag::Index, ExprTag::Object])
        .types(&[TypeTag::Ref])
        .pats(&[PatTag::Object]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        ForbidForeignPropTypes { allow_in_prop_types: options.object(0).bool_or("allowInPropTypes", false) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        file.mentions("propTypes").then(|| State {
            prop_types: file.name_of("propTypes"),
            assignments: AncestorMemo::default(),
            class_properties: AncestorMemo::default(),
        })
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let prop_types = cx.state.prop_types;
        let property = match e.kind() {
            ExprKind::Dot { name, .. } if name.name() == prop_types && ast_utils::is_member_expression(e) => {
                name.span()
            }
            ExprKind::Index { index, .. } if index.as_string() == Some(prop_types) => index.span(),
            // An `ObjectPattern`
            ExprKind::Object(properties) => {
                if let Some(property) = properties.iter().find(|it| is_prop_types(it.key()))
                    && e.is_assignment_target()
                {
                    cx.report(property.span(), FORBIDDEN_PROP_TYPE);
                }
                return;
            }
            _ => return,
        };
        if !is_assignment_lhs(e) && !self.is_allowed_assignment(e.into(), cx) {
            cx.report(property, FORBIDDEN_PROP_TYPE);
        }
    }

    /// `A.b` after `implements`, or after the `extends` of an interface, is a `MemberExpression`.
    fn ty<'a>(&self, ty: TypeNode<'a>, cx: &mut Cx<'a, Self>) {
        let prop_types = cx.state.prop_types;
        let TypeKind::Ref { name, .. } = ty.kind() else {
            return;
        };
        let mut properties = name.parts().skip(1).filter(|it| it.name() == prop_types).peekable();
        if properties.peek().is_none()
            || !matches!(estree_type_name(ty.into()), "TSClassImplements" | "TSInterfaceHeritage")
            || self.is_allowed_assignment(ty.into(), cx)
        {
            return;
        }
        for property in properties {
            cx.report(property, FORBIDDEN_PROP_TYPE);
        }
    }

    fn pat<'a>(&self, pat: Pat<'a>, cx: &mut Cx<'a, Self>) {
        if let PatKind::Object(properties) = pat.kind()
            && let Some(property) = properties.iter().find(|it| is_prop_types(it.key()))
        {
            cx.report(property.span(), FORBIDDEN_PROP_TYPE);
        }
    }
}

impl ForbidForeignPropTypes {
    /// `isAllowedAssignment`
    fn is_allowed_assignment<'a>(&self, node: Node<'a>, cx: &mut Cx<'a, Self>) -> bool {
        if !self.allow_in_prop_types {
            return false;
        }
        // `findParentAssignmentExpression`. A default in a pattern is none.
        let assignment = cx.state.assignments.find(node, |_, parent| match parent {
            Node::Expr(parent) if parent.tag() == ExprTag::Assign && !parent.is_assignment_target() => {
                parent.left().map(|left| is_member_called(left, "propTypes"))
            }
            _ => None,
        });
        // `findParentClassProperty`
        assignment == Some(true)
            || cx.state.class_properties.find(node, |_, parent| match parent {
                Node::Member(member) if ast_utils::is_property_definition(member) => Some(is_prop_types(member.key())),
                _ => None,
            }) == Some(true)
    }
}
