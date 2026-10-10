use crate::react::{callee_of_this_set_state, get_parent_component, is_jsx};
use crate::util_components::Components;
use crate::util_components_list::{At, ComponentId, Queue};
use crate::util_is_create_element::is_member_called;
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::ancestor_memo::AncestorMemo;
use rustc_hash::FxHashMap;

/// Disallow usage of setState
pub struct NoSetState;

const NO_SET_STATE: Message = Message::new("noSetState", "Do not use setState");
const OXLINT: Message = Message::new("", "Do not use `setState`.");

#[derive(Default)]
pub struct State<'a> {
    /// The component that something is in, as oxlint finds it.
    component_around: AncestorMemo<'a, Node<'a>>,
    /// The calls of `this.setState`, for upstream.
    calls: Vec<Expr<'a>>,
}

impl Rule for NoSetState {
    const META: Meta = Meta::plugin(Plugin::React, "no-set-state", Kind::Suggestion);
    const ON: On = On::new().exprs(&[ExprTag::Call]).finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoSetState
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Call]);
        // What is a component depends for upstream on what comes before.
        if file.language().is_oxlint { on } else { on.finish() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<State<'a>> {
        let is_candidate = if file.language().is_oxlint {
            is_jsx(file) && file.mentions("setState")
        } else {
            // upstream takes a private name for its text.
            file.mentions_any(&["setState", "#setState"])
                && file.has_exprs([ExprTag::This])
                && Components::may_have_any(file)
        };
        is_candidate.then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        if !cx.language().is_oxlint {
            // Also `this[setState]()` and `(this).setState()`, not `this["setState"]()`.
            if let Some(callee) = e.callee()
                && is_member_called(callee, "setState")
                && callee.object().is_some_and(|it| it.tag() == ExprTag::This)
            {
                cx.state.calls.push(e);
            }
            return;
        }
        if let Some(callee) = callee_of_this_set_state(e)
            && get_parent_component(Node::Expr(e), &mut cx.state.component_around).is_some()
        {
            cx.report(callee, OXLINT);
        }
    }

    /// upstream's listener, in the order of ESLint's walk. Then its `Program:exit`.
    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mut queue = Queue::default();
        for call in std::mem::take(&mut cx.state.calls) {
            queue.push(At::enter(Node::Expr(call)), 0, Node::Expr(call));
        }
        let mut components = Components::new(cx.file());
        // `component.setStateUsages`: which of `lists`. Two components can have one.
        let mut set_state_usages: FxHashMap<ComponentId, usize> = FxHashMap::default();
        let mut lists: Vec<Vec<Span>> = Vec::new();
        while let Some(event) = queue.pop_until(At::END) {
            components.advance(event.at);
            let component = components.get_parent_component(event.node).and_then(|it| components.get(it));
            let known = component.and_then(|id| set_state_usages.get(&id).copied());
            let assigned_to = components.set(event.node);
            if known.is_none() && assigned_to.is_none() {
                continue;
            }
            let next = lists.len();
            let list = known.unwrap_or(next);
            if list == next {
                lists.push(Vec::new());
            }
            if let Some(usages) = lists.get_mut(list) {
                usages.extend(event.node.as_expr().and_then(Expr::callee).map(Expr::span));
            }
            if let Some(id) = assigned_to {
                set_state_usages.insert(id, list);
            }
        }
        if lists.is_empty() {
            return;
        }
        components.finish();
        for id in components.list() {
            let usages = set_state_usages.get(&id).and_then(|&list| lists.get(list));
            for &set_state_usage in usages.into_iter().flatten() {
                cx.report(set_state_usage, NO_SET_STATE).at_the_end();
            }
        }
    }
}
