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
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Dot, ExprTag::Index]);
    /// The component that something is in.
    type State<'a> = AncestorMemo<'a, Node<'a>>;

    fn new(options: &Options) -> Self {
        NoStringRefs { no_template_literals: options.object(0).bool_or("noTemplateLiterals", false) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let mut on = On::new();
        if file.mentions("ref") {
            on = on.exprs(&[ExprTag::Jsx]);
        }
        if file.mentions("refs") && file.has_exprs([ExprTag::This]) {
            on = on.exprs(&[ExprTag::Dot, ExprTag::Index]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        is_jsx(file).then(AncestorMemo::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        match e.tag() {
            ExprTag::Jsx => self.jsx(e, cx),
            ExprTag::Dot | ExprTag::Index => self.member_expression(e, cx),
            _ => {}
        }
    }
}

impl NoStringRefs {
    fn jsx<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let ExprKind::Jsx(jsx) = e.kind() else {
            return;
        };
        for attribute in jsx.attrs().iter().filter(|it| is_literal_ref_attribute(*it, self.no_template_literals)) {
            cx.report(attribute, STRING_IN_REF_DEPRECATED);
        }
    }

    fn member_expression<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if member.object().is_some_and(|object| object.tag() == ExprTag::This && !object.is_parenthesized())
            && static_property_name(member).is_some_and(|name| name.is("refs"))
            && !member.is_jsx_tag_name()
            && !member.is_in_type_query()
            && get_parent_component(Node::Expr(member), &mut cx.state).is_some()
        {
            cx.report(member, THIS_REFS_DEPRECATED);
        }
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
