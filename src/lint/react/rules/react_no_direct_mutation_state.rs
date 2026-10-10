use bun_lint_oxlint::ast_util::as_method_definition;
use crate::react::{
    AncestorWalk, get_outer_member_expression, is_es5_component, is_es6_component, is_jsx, is_state_member_expression,
};
use crate::util_component_util;
use crate::util_components::Components;
use crate::util_components_list::{At, ComponentId, Queue};
use bun_lint::prelude::*;
use bun_lint::rule::Plugin;
use bun_lint::utils::estree_type_name;
use rustc_hash::FxHashMap;
use std::ops::ControlFlow;

/// Disallow direct mutation of this.state
pub struct NoDirectMutationState;

const NO_DIRECT_MUTATION: Message = Message::new("noDirectMutation", "Do not mutate state directly. Use setState().");
const OXLINT: Message = Message::new("", "Never mutate `this.state` directly.");

const UPDATES: [UnOp; 4] = [UnOp::PreInc, UnOp::PreDec, UnOp::PostInc, UnOp::PostDec];

const IN_CONSTRUCTOR: u8 = 1 << 0;
const IN_CALL_EXPRESSION: u8 = 1 << 1;
const IN_COMPONENT: u8 = 1 << 2;

#[derive(Default)]
pub struct State<'a> {
    /// What something is in, up to the innermost class.
    around: AncestorWalk<'a, u8, u8>,
    /// The assignments to something in `this.state` and the updates of it, for upstream.
    mutations: Vec<Expr<'a>>,
}

/// What upstream keeps in a component.
#[derive(Copy, Clone, Default)]
struct Component {
    in_constructor: bool,
    in_call_expression: bool,
    /// Which list of `mutations`: two components can have one.
    mutations: Option<usize>,
}

impl Rule for NoDirectMutationState {
    const META: Meta = Meta::plugin(Plugin::React, "no-direct-mutation-state", Kind::None).recommended();
    const ON: On = On::new().exprs(&[ExprTag::Assign]).unaries(&UPDATES).finish();
    type State<'a> = State<'a>;

    fn new(_: &Options) -> Self {
        NoDirectMutationState
    }

    fn narrow<'a>(&self, file: &'a File<'a>) -> On {
        let on = On::new().exprs(&[ExprTag::Assign]).unaries(&UPDATES);
        // What is a component, and in what, depends for upstream on what comes before.
        if file.language().is_oxlint { on } else { on.finish() }
    }

    fn start<'a>(&self, file: &'a File<'a>) -> Option<Self::State<'a>> {
        let is_oxlint = file.language().is_oxlint;
        // upstream takes `this.#state` for `this.state`.
        let is_candidate = (file.mentions("state") || (!is_oxlint && file.mentions("#state")))
            && file.has_exprs([ExprTag::This])
            && if is_oxlint { is_jsx(file) } else { Components::may_have_any(file) };
        is_candidate.then(State::default)
    }

    fn expr<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        let Some(left) = e.left().filter(|&left| state_of(left, is_oxlint).is_some() && !e.is_assignment_target())
        else {
            return;
        };
        if !is_oxlint {
            cx.state.mutations.push(e);
        } else if !should_ignore_component(e, cx) {
            cx.report(left, OXLINT);
        }
    }

    fn unary<'a>(&self, e: Expr<'a>, cx: &mut Cx<'a, Self>) {
        let is_oxlint = cx.language().is_oxlint;
        if e.operand().and_then(|it| state_of(it, is_oxlint)).is_none() {
            return;
        }
        if !is_oxlint {
            cx.state.mutations.push(e);
        } else if !should_ignore_component(e, cx) {
            cx.report(e, OXLINT);
        }
    }

    fn finish(&self, cx: &mut Cx<'_, Self>) {
        let mutations = std::mem::take(&mut cx.state.mutations);
        if !mutations.is_empty() && !walk(&mutations, false, cx) {
            walk(&mutations, true, cx);
        }
    }
}

/// The `this.state` that `target`, which is assigned to, is or is in.
fn state_of(target: Expr<'_>, is_oxlint: bool) -> Option<Expr<'_>> {
    if is_oxlint {
        return get_outer_member_expression(target).filter(|&it| is_state_member_expression(it));
    }
    // upstream's `getOuterMemberExpression`, which has a `ChainExpression` around `(a?.b)`.
    let is_member = |it: &Expr| matches!(it.tag(), ExprTag::Dot | ExprTag::Index) && !it.is_chain_root();
    let mut item = Some(target).filter(is_member)?;
    while let Some(object) = item.object().filter(is_member) {
        item = object;
    }
    util_component_util::is_state_member_expression(item).then_some(item)
}

fn should_ignore_component<'a>(e: Expr<'a>, cx: &mut Cx<'a, NoDirectMutationState>) -> bool {
    let found = cx.state.around.run(Node::Expr(e), 0, |_, parent, found| match parent {
        Node::Member(_) if as_method_definition(parent).is_some_and(Member::is_constructor) => {
            ControlFlow::Continue(found | IN_CONSTRUCTOR)
        }
        Node::Expr(e) if e.tag() == ExprTag::Call && is_es5_component(parent) => {
            ControlFlow::Continue(found | IN_CALL_EXPRESSION | IN_COMPONENT)
        }
        Node::Expr(e) if e.tag() == ExprTag::Call => ControlFlow::Continue(found | IN_CALL_EXPRESSION),
        Node::Class(_) if is_es6_component(parent) => ControlFlow::Break(found | IN_COMPONENT),
        Node::Class(_) | Node::File(_) => ControlFlow::Break(found),
        _ => ControlFlow::Continue(found),
    });
    found & (IN_CONSTRUCTOR | IN_CALL_EXPRESSION) == IN_CONSTRUCTOR || found & IN_COMPONENT == 0
}

/// upstream's listeners, in the order of ESLint's walk, in a file that has `mutations`. Then its `Program:exit`.
/// `false`, and nothing is reported: `inCallExpression` is asked for, which only a walk `with_calls` knows.
fn walk<'a>(mutations: &[Expr<'a>], with_calls: bool, cx: &Cx<'a, NoDirectMutationState>) -> bool {
    let file = cx.file();
    let mut queue = Queue::default();
    for &e in mutations {
        queue.push(At::enter(Node::Expr(e)), 0, Node::Expr(e));
    }
    let members = file.classes().flat_map(|class| class.members());
    let constructors = members
        .filter(|it| it.is_constructor())
        .map(Node::Member)
        .filter(|&it| estree_type_name(it) == "MethodDefinition");
    let calls = with_calls.then(|| file.exprs_of_kind(ExprTag::Call).map(Node::Expr));
    for node in constructors.chain(calls.into_iter().flatten()) {
        queue.push(At::enter(node), 0, node);
        queue.push(At::exit(node), 0, node);
    }

    let mut components = Components::new(file);
    let mut known: FxHashMap<ComponentId, Component> = FxHashMap::default();
    let mut lists: Vec<Vec<Span>> = Vec::new();
    while let Some(event) = queue.pop_until(At::END) {
        components.advance(event.at);
        let is_entered = !event.at.is_exit();
        let e = match event.node {
            Node::Expr(e) if e.tag() != ExprTag::Call => e,
            node => {
                if let Some(id) = components.set(node) {
                    let component = known.entry(id).or_default();
                    match node {
                        Node::Member(_) => component.in_constructor = is_entered,
                        _ => component.in_call_expression = is_entered,
                    }
                }
                continue;
            }
        };
        let parent = components.get_parent_component(event.node).and_then(|it| components.get(it));
        let Some(component) = parent.map(|id| known.get(&id).copied().unwrap_or_default()) else {
            continue;
        };
        if component.in_constructor && !with_calls {
            return false;
        }
        if component.in_constructor && !component.in_call_expression {
            continue;
        }
        // Of an assignment `node.left.object`, of an update the `this.state`.
        let mutation = match e.left() {
            Some(left) => left.object(),
            None => e.operand().and_then(|it| state_of(it, cx.language().is_oxlint)),
        };
        let next = lists.len();
        let list = component.mutations.unwrap_or(next);
        if list == next {
            lists.push(Vec::new());
        }
        if let Some(list) = lists.get_mut(list) {
            list.extend(mutation.map(Expr::span));
        }
        if let Some(id) = components.set(event.node) {
            known.entry(id).or_default().mutations = Some(list);
        }
    }

    components.finish();
    for id in components.list() {
        let list = known.get(&id).and_then(|it| lists.get(it.mutations?));
        for &mutation in list.into_iter().flatten() {
            cx.report(mutation, NO_DIRECT_MUTATION).at_the_end();
        }
    }
    true
}
