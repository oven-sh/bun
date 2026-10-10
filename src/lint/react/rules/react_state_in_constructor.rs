use bun_lint_oxlint::ast_util::{as_method_definition, as_property_definition};
use crate::react::{self, get_outer_member_expression, is_es6_component};
use crate::util_ast::{in_constructor, name_of_key};
use crate::util_component_util::{self, Pragmas, get_parent_es6_component};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use std::cell::OnceCell;

/// Enforce class component state initialization style
pub struct StateInConstructor {
    is_always: bool,
}

const STATE_INIT_CONSTRUCTOR: Message =
    Message::new("stateInitConstructor", "State initialization should be in a constructor");
const STATE_INIT_CLASS_PROP: Message =
    Message::new("stateInitClassProp", "State initialization should be in a class property");
const OXLINT_IN_CONSTRUCTOR: Message = Message::new("", "State initialization should be in a constructor");
const OXLINT_IN_CLASS_PROPERTY: Message = Message::new("", "State initialization should be in a class property");

#[derive(Default)]
pub struct State<'a> {
    /// As oxlint finds it.
    in_es6_component: AncestorMemo<'a, ()>,
    /// Whether the innermost method around something is a constructor, for oxlint.
    in_constructor: AncestorMemo<'a, bool>,
    pragmas: OnceCell<Pragmas<'a>>,
}

impl Rule for StateInConstructor {
    const META: Meta = Meta::plugin(Plugin::React, "state-in-constructor", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Assign]).members();
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        StateInConstructor { is_always: options.str(0) != Some("never") }
    }

    fn narrow<'a>(&self, _: &'a File<'a>) -> On {
        if self.is_always { On::new().members() } else { On::new().exprs(&[ExprTag::Assign]) }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        if !file.has_classes() || !file.mentions_any(&["state", "#state"]) {
            return None;
        }
        Some(State::default())
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let Some(left) = e.left() else {
            return;
        };
        // oxlint also takes `this.state.a = b`, upstream `this[state] = a` and `this.#state = a`.
        let is_state = if is_oxlint {
            get_outer_member_expression(left).is_some_and(react::is_state_member_expression)
        } else {
            util_component_util::is_state_member_expression(left)
        };
        if !is_state || e.is_assignment_target() {
            return;
        }
        let node = Node::Expr(e);
        // oxlint asks the innermost method, upstream every function around.
        let is_in_constructor = if is_oxlint {
            let as_method = |node: Node<'a>| as_method_definition(node).map(Member::is_constructor);
            cx.state.in_constructor.find(node, |_, ancestor| as_method(ancestor)) == Some(true)
        } else {
            in_constructor(node)
        };
        if is_in_constructor && has_parent_es6_component(node, &mut cx.state, is_oxlint) {
            cx.report(e, if is_oxlint { OXLINT_IN_CLASS_PROPERTY } else { STATE_INIT_CLASS_PROP });
        }
    }

    fn member<'a>(&self, member: Member<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        // oxlint also takes `"state"` and an abstract field, upstream `[state]`.
        let is_state = if is_oxlint {
            as_property_definition(Node::Member(member)).is_some()
                && member.key().and_then(Key::name).is_some_and(|name| name.is_any(&["state", "#state"]))
        } else {
            ast_utils::is_property_definition(member)
                && member.key().and_then(name_of_key).is_some_and(|name| name == b"state")
        };
        if is_state && !member.is_static() && has_parent_es6_component(Node::Member(member), &mut cx.state, is_oxlint) {
            cx.report(member, if is_oxlint { OXLINT_IN_CONSTRUCTOR } else { STATE_INIT_CONSTRUCTOR });
        }
    }
}

/// oxlint takes any class around, upstream the innermost one.
fn has_parent_es6_component<'a>(node: Node<'a>, state: &mut State<'a>, is_oxlint: bool) -> bool {
    if is_oxlint {
        return state.in_es6_component.find(node, |_, ancestor| is_es6_component(ancestor).then_some(())).is_some();
    }
    let pragmas = state.pragmas.get_or_init(|| Pragmas::new(node.file()));
    get_parent_es6_component(node, pragmas).is_some()
}
