use bun_lint_oxlint::ast_util::{as_method_definition, as_property_definition};
use crate::react::{get_outer_member_expression, is_es6_component, is_state_member_expression};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// Enforce a consistent style for initializing class component state.
pub struct StateInConstructor {
    is_always: bool,
}

const IN_CONSTRUCTOR: Message = Message::new("", "State initialization should be in a constructor");
const IN_CLASS_PROPERTY: Message = Message::new("", "State initialization should be in a class property");

#[derive(Default)]
pub struct State<'a> {
    in_es6_component: AncestorMemo<'a, ()>,
    /// Whether the innermost method around something is a constructor.
    in_constructor: AncestorMemo<'a, bool>,
}

impl Rule for StateInConstructor {
    const META: Meta = Meta::oxlint(Plugin::React, "state-in-constructor", Kind::Suggestion);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        StateInConstructor { is_always: options.str(0) != Some("never") }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !file.has_classes() || !file.mentions_any(&["state", "#state"]) {
            return State::default();
        }
        if self.is_always {
            on.members(|_, member, cx| {
                if as_property_definition(Node::Member(member)).is_some()
                    && !member.is_static()
                    && member.key().and_then(Key::name).is_some_and(|name| name.is_any(&["state", "#state"]))
                    && has_parent_es6_component(Node::Member(member), &mut cx.state)
                {
                    cx.report(member, IN_CONSTRUCTOR);
                }
            });
        } else {
            on.exprs([ExprTag::Assign], |_, e, cx| {
                let as_method = |node: Node<'a>| as_method_definition(node).map(Member::is_constructor);
                if e.left().and_then(get_outer_member_expression).is_some_and(is_state_member_expression)
                    && !e.is_assignment_target()
                    && cx.state.in_constructor.find(Node::Expr(e), |_, ancestor| as_method(ancestor)) == Some(true)
                    && has_parent_es6_component(Node::Expr(e), &mut cx.state)
                {
                    cx.report(e, IN_CLASS_PROPERTY);
                }
            });
        }
        State::default()
    }
}

fn has_parent_es6_component<'a>(node: Node<'a>, state: &mut State<'a>) -> bool {
    state.in_es6_component.find(node, |_, ancestor| is_es6_component(ancestor).then_some(())).is_some()
}
