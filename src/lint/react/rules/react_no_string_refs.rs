use bun_lint_oxlint::ast_util::static_property_name;
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::{get_parent_component, is_jsx};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// This rule prevents using the deprecated behavior of string literals in ref attributes.
pub struct NoStringRefs {
    no_template_literals: bool,
}

const THIS_REFS_DEPRECATED: Message = Message::new("", "Using this.refs is deprecated.");
const STRING_IN_REF_DEPRECATED: Message = Message::new("", "Using string literals in ref attributes is deprecated.");

impl Rule for NoStringRefs {
    const META: Meta = Meta::oxlint(Plugin::React, "no-string-refs", Kind::Problem);
    /// The component that something is in.
    type State<'a> = AncestorMemo<'a, Node<'a>>;

    fn new(options: &Options) -> Self {
        NoStringRefs { no_template_literals: options.object(0).bool_or("noTemplateLiterals", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !is_jsx(file) {
            return AncestorMemo::default();
        }
        if file.mentions("ref") {
            on.exprs([ExprTag::Jsx], |rule, e, cx| {
                let ExprKind::Jsx(jsx) = e.kind() else {
                    return;
                };
                for attribute in
                    jsx.attrs().iter().filter(|it| is_literal_ref_attribute(*it, rule.no_template_literals))
                {
                    cx.report(attribute, STRING_IN_REF_DEPRECATED);
                }
            });
        }
        if file.mentions("refs") && file.has_exprs([ExprTag::This]) {
            on.exprs([ExprTag::Dot, ExprTag::Index], |_, member, cx| {
                if member.object().is_some_and(|object| object.tag() == ExprTag::This && !object.is_parenthesized())
                    && static_property_name(member).is_some_and(|name| name.is("refs"))
                    && !member.is_jsx_tag_name()
                    && !member.is_in_type_query()
                    && get_parent_component(Node::Expr(member), &mut cx.state).is_some()
                {
                    cx.report(member, THIS_REFS_DEPRECATED);
                }
            });
        }
        AncestorMemo::default()
    }
}

fn is_literal_ref_attribute(attribute: Prop, no_template_literals: bool) -> bool {
    if !attribute.key().is_some_and(|key| key.is("ref")) {
        return false;
    }
    match get_prop_value(attribute) {
        Some(AttributeValue::StringLiteral(_)) => true,
        Some(AttributeValue::ExpressionContainer(e)) if !e.is_parenthesized() => {
            e.tag() == ExprTag::String || no_template_literals && e.tag() == ExprTag::Template
        }
        _ => false,
    }
}
