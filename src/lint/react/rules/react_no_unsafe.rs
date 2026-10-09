use bun_lint_oxlint::ast_util::{as_method_definition, as_object_property, static_name};
use crate::react::{get_parent_component, is_es5_component, is_jsx, supports_unsafe_lifecycle_prefix};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;

/// This rule identifies and restricts the use of unsafe React lifecycle methods.
pub struct NoUnsafe {
    check_aliases: bool,
}

const NO_UNSAFE: Message = Message::new("", "Unsafe lifecycle method `{{method_name}}` is not allowed");

const UNSAFE_METHODS: [&str; 3] =
    ["UNSAFE_componentWillMount", "UNSAFE_componentWillReceiveProps", "UNSAFE_componentWillUpdate"];
const ALIASES: [&str; 3] = ["componentWillMount", "componentWillReceiveProps", "componentWillUpdate"];

#[derive(Default)]
pub struct State<'a> {
    check_unsafe_prefix: bool,
    parent_component: AncestorMemo<'a, Node<'a>>,
    in_es5_component: AncestorMemo<'a, ()>,
}

impl Rule for NoUnsafe {
    const META: Meta = Meta::oxlint(Plugin::React, "no-unsafe", Kind::Problem);
    type State<'a> = State<'a>;

    fn new(options: &Options) -> Self {
        NoUnsafe { check_aliases: options.object(0).bool_or("checkAliases", false) }
    }

    fn register<'a>(&self, on: &mut Listeners<'a, Self>, file: &'a File<'a>) -> Self::State<'a> {
        if !is_jsx(file) || !(file.mentions_any(&UNSAFE_METHODS) || self.check_aliases && file.mentions_any(&ALIASES)) {
            return State::default();
        }
        on.members(|rule, member, cx| {
            if let Some(key) = as_method_definition(Node::Member(member)).and_then(Member::key)
                && let Some(name) = static_name(key)
                && rule.is_unsafe_method(name, cx.state.check_unsafe_prefix)
                && get_parent_component(Node::Member(member), &mut cx.state.parent_component).is_some()
            {
                cx.report(key.inner_span(cx.file()), NO_UNSAFE).data("method_name", name);
            }
        });
        on.props(|rule, prop, cx| {
            if let Some(key) = as_object_property(Node::Prop(prop)).and_then(Prop::key)
                && let Some(name) = static_name(key)
                && rule.is_unsafe_method(name, cx.state.check_unsafe_prefix)
                && cx
                    .state
                    .in_es5_component
                    .find(Node::Prop(prop), |_, ancestor| is_es5_component(ancestor).then_some(()))
                    .is_some()
            {
                cx.report(key.inner_span(cx.file()), NO_UNSAFE).data("method_name", name);
            }
        });
        State { check_unsafe_prefix: supports_unsafe_lifecycle_prefix(file), ..State::default() }
    }
}

impl NoUnsafe {
    fn is_unsafe_method(&self, name: Name, check_unsafe_prefix: bool) -> bool {
        check_unsafe_prefix && name.is_any(&UNSAFE_METHODS) || self.check_aliases && name.is_any(&ALIASES)
    }
}
