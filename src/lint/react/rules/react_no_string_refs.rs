use bun_lint_oxlint::ast_util::static_property_name;
use crate::jsx::{AttributeValue, get_prop_value};
use crate::react::{get_parent_component, is_jsx};
use crate::util_ast::get_property_name;
use crate::util_component_util::{Pragmas, get_parent_es5_component, get_parent_es6_component};
use crate::util_version::get_react_version_from_context;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use std::cell::OnceCell;

/// Disallow using string references
pub struct NoStringRefs {
    no_template_literals: bool,
}

const THIS_REFS_DEPRECATED: Message = Message::new("thisRefsDeprecated", "Using this.refs is deprecated.");
const STRING_IN_REF_DEPRECATED: Message =
    Message::new("stringInRefDeprecated", "Using string literals in ref attributes is deprecated.");
const OXLINT_THIS_REFS_DEPRECATED: Message = Message::new("", "Using this.refs is deprecated.");
const OXLINT_STRING_IN_REF_DEPRECATED: Message =
    Message::new("", "Using string literals in ref attributes is deprecated.");

#[derive(Default)]
pub struct State<'a> {
    /// The component that something is in, as oxlint finds it.
    component_around: AncestorMemo<'a, Node<'a>>,
    pragmas: OnceCell<Pragmas<'a>>,
}

impl Rule for NoStringRefs {
    const META: Meta = Meta::plugin(Plugin::React, "no-string-refs", Kind::None).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Jsx, ExprTag::Dot, ExprTag::Index]);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoStringRefs { no_template_literals: options.object(0).bool_or("noTemplateLiterals", false) }
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let is_oxlint = file.language().is_oxlint;
        let mut on = On::new();
        if file.mentions("ref") {
            on = on.exprs(&[ExprTag::Jsx]);
        }
        // upstream takes a private name for its text, and lets `this.refs` be from React 18.3 on.
        if (file.mentions("refs") || (!is_oxlint && file.mentions("#refs")))
            && file.has_exprs([ExprTag::This])
            && (is_oxlint || get_react_version_from_context(file) < (18, 3, 0))
        {
            on = on.exprs(&[ExprTag::Dot, ExprTag::Index]);
        }
        on
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        // oxlint passes over a file that cannot have JSX.
        (!file.language().is_oxlint || is_jsx(file)).then(State::default)
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
        let is_oxlint = cx.language().is_oxlint;
        let message = if is_oxlint { OXLINT_STRING_IN_REF_DEPRECATED } else { STRING_IN_REF_DEPRECATED };
        for attribute in jsx.attrs().iter().filter(|it| self.is_literal_ref_attribute(*it, is_oxlint)) {
            cx.report(attribute, message);
        }
    }

    fn member_expression<'a>(&self, member: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let Some(object) = member.object().filter(|it| it.tag() == ExprTag::This) else {
            return;
        };
        let is_oxlint = cx.language().is_oxlint;
        let node = Node::Expr(member);
        // oxlint has a node for parentheses and knows `this["refs"]`, upstream knows `this[refs]` and `this.#refs`.
        let is_refs = if is_oxlint {
            !object.is_parenthesized()
                && static_property_name(member).is_some_and(|name| name.is("refs"))
                && !member.is_jsx_tag_name()
                && !member.is_in_type_query()
        } else {
            get_property_name(node).is_some_and(|name| name == b"refs")
        };
        if !is_refs {
            return;
        }
        // oxlint goes up the parents, upstream up the scopes.
        let is_in_component = if is_oxlint {
            get_parent_component(node, &mut cx.state.component_around).is_some()
        } else {
            let pragmas = cx.state.pragmas.get_or_init(|| Pragmas::new(member.file()));
            get_parent_es6_component(node, pragmas).is_some() || get_parent_es5_component(node, pragmas).is_some()
        };
        if is_in_component {
            cx.report(member, if is_oxlint { OXLINT_THIS_REFS_DEPRECATED } else { THIS_REFS_DEPRECATED });
        }
    }

    fn is_literal_ref_attribute(&self, attribute: Prop, is_oxlint: bool) -> bool {
        if !attribute.key().is_some_and(|key| key.is("ref")) {
            return false;
        }
        match get_prop_value(attribute) {
            Some(AttributeValue::StringLiteral(_)) => true,
            // oxlint has a node for parentheses.
            Some(AttributeValue::ExpressionContainer(e)) if !(is_oxlint && e.is_parenthesized()) => {
                e.tag() == ExprTag::String || self.no_template_literals && e.tag() == ExprTag::Template
            }
            _ => false,
        }
    }
}
