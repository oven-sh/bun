//! <https://dom.spec.whatwg.org/#mutation-algorithms>
//!
//! A seam may run a script, which may change the tree. None is called while links, flags, ids and the arena disagree.

use core::cell::Cell;
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsScope};

use super::node::Link;
use super::steps::Has;
use super::{NodeFlags as F, *};
use crate::api::forms::dormant;
use crate::tree::{DOCUMENT, Data, NodeId, State};

type Result<'a, T = ()> = bindgen::Result<'a, T>;

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Observers {
    Notify,
    Suppress,
}

/// What becomes of a node that is removed.
#[derive(Clone, Copy, PartialEq, Eq)]
enum Next {
    Gone,
    /// It is about to be inserted in the same document or shadow tree, so the engine keeps it.
    Reinserted,
    /// By `moveBefore`, which keeps its state.
    Moved,
}

thread_local! {
    /// It has no parent, is still `RENDERED`, and is on the stack of the `insert_or_move` that has removed it.
    static KEPT: Cell<*const Node> = const { Cell::new(core::ptr::null()) };
}

#[inline]
pub(super) fn children_changed(parent: &Node) {
    parent.arena().tree_changed(!parent.has(F::USER_AGENT));
    parent.unset(F::CHILD_CACHE | F::CHILD_NODES_ARE_CACHED | F::CHILDREN_ARE_CACHED);
}

#[inline]
fn child_moved(node: &Node, parent: &Node, is_removal: bool) {
    let flags = parent.flags();
    children_changed(parent);
    if !flags.contains(F::USER_AGENT) {
        parent.arena().record_move(node, parent, is_removal, flags);
    }
}

#[inline]
fn link(node: &Node, parent: &Node, before: Option<&Node>) {
    dormant::wake_unless_they_can_stay(node, parent);
    let previous = before.map_or_else(|| parent.last_child(), Node::previous_sibling);
    node.set_link(Link::Parent, Some(parent));
    node.set_link(Link::Previous, previous);
    node.set_link(Link::Next, before);
    node.written();
    match previous {
        Some(previous) => {
            previous.set_link(Link::Next, Some(node));
            previous.written();
        }
        None => {
            parent.set_link(Link::First, Some(node));
            parent.written();
        }
    }
    match before {
        Some(before) => before.set_link(Link::Previous, Some(node)),
        None => parent.set_link(Link::Last, Some(node)),
    }
    if node.has(F::USER_AGENT) != parent.has(F::USER_AGENT) {
        parent.arena().tree_changed(node.has(F::USER_AGENT));
        node.objects()
            .for_each(|it| it.toggle(F::USER_AGENT, parent.has(F::USER_AGENT)));
    }
    child_moved(node, parent, false);
}

#[inline]
fn unlink(node: &Node, parent: &Node) {
    let (previous, next) = (node.previous_sibling(), node.next_sibling());
    match previous {
        Some(previous) => {
            previous.set_link(Link::Next, next);
            previous.written();
        }
        None => {
            parent.set_link(Link::First, next);
            parent.written();
        }
    }
    match next {
        Some(next) => next.set_link(Link::Previous, previous),
        None => parent.set_link(Link::Last, previous),
    }
    [Link::Parent, Link::Previous, Link::Next]
        .into_iter()
        .for_each(|it| node.set_link(it, None));
    child_moved(node, parent, true);
}

/// The first one that the engine has, of `node` and its next siblings.
#[inline]
pub(crate) fn linked_from(node: Option<&Node>) -> NodeId {
    core::iter::successors(node, |it| it.next_sibling())
        .find(|it| it.kind().is_linked())
        .map_or(0, Node::id)
}

impl Node {
    /// Whether nothing would notice `append_detached`.
    #[inline]
    pub(crate) fn takes_plain_append(&self, node: &Node) -> bool {
        self.ignores_children()
            && !node.is_rendered()
            && !node.steps_for_moving().contains(Has::PARENT_CHANGED)
            && node.parent().is_none()
            && node.doc() == self.doc()
            && node.as_fragment().is_none()
    }

    /// No steps run when they change.
    #[inline(always)]
    fn ignores_children(&self) -> bool {
        !self.has(F::CONNECTED | F::RENDERED | F::USER_AGENT | F::HOST | F::SLOT | F::IN_SELECT)
            && !self.steps().contains(Has::CHILDREN_CHANGED)
            && !(self.arena().has_slots.get() && self.is_in_shadow_tree())
    }

    /// It is connected, and no steps run when its children change.
    #[inline(always)]
    fn is_watched_by_engine_only(&self) -> bool {
        self.flags() & (F::CONNECTED | F::USER_AGENT | F::HOST | F::SLOT | F::IN_SELECT)
            == F::CONNECTED
            && !self.steps().contains(Has::CHILDREN_CHANGED)
            && !self.arena().has_slots.get()
    }

    /// In its subtree, which has no ids, and it has none of those.
    #[inline(always)]
    fn is_only_object(&self, flags: F, steps: Has) -> bool {
        !self.has(flags | F::HAS_ID | F::HOST)
            && !self.steps().intersects(steps)
            && self.first_object().is_none()
            && !(self.has(F::HAS_BARE_CHILDREN)
                && (self.doc().is(DocFlags::WATCHES_IDS) || bare::may_have_ids_below(self)))
    }

    /// Whether nothing would notice `remove_detached`.
    #[inline(always)]
    fn allows_plain_removal(&self, child: &Node) -> bool {
        const WATCH: DocFlags = DocFlags::HAS_RANGES
            .union(DocFlags::HAS_ITERATORS)
            .union(DocFlags::OBSERVES_CHILDREN)
            .union(DocFlags::OBSERVES_ATTRIBUTES)
            .union(DocFlags::OBSERVES_DATA)
            .union(DocFlags::RECORDS_EDITS);
        self.ignores_children()
            && !child.steps_for_moving().contains(Has::PARENT_CHANGED)
            && !self.doc().is(WATCH)
    }
}

#[inline]
fn remove_detached(parent: &Node, node: &Node) {
    unlink(node, parent);
    if node.kind().is_linked() {
        parent.arena().write(|engine| {
            engine.tree.unlink_unknown(node.id());
            engine.tree.set_scope(node.id(), 0);
        });
    }
}

/// `pre_insert`, if that is valid and only links change.
#[inline]
fn insert_detached(node: &Node, parent: &Node, child: Option<&Node>) -> bool {
    let old = node.parent();
    if !parent.ignores_children()
        || !(parent.is_element() || parent.kind() == Kind::Fragment)
        || !(node.is_element() || node.kind() == Kind::Text)
        || node.has(F::RENDERED | F::USER_AGENT)
        || node.steps_for_moving().contains(Has::PARENT_CHANGED)
        || node.doc() != parent.doc()
        || child.is_some_and(|it| it.parent() != Some(parent) || parent.has(F::HAS_RANGES))
        || old.map_or_else(
            || parent.has_observed_children(),
            |it| !it.allows_plain_removal(node),
        )
    {
        return false;
    }
    if old == Some(parent) && (child == Some(node) || child == node.next_sibling()) {
        return true;
    }
    if is_host_including_inclusive_ancestor(node, parent) {
        return false;
    }
    old.into_iter().for_each(|it| unlink(node, it));
    link(node, parent, child);
    let (id, before) = (node.id(), linked_from(child));
    parent.arena().write(|engine| {
        if old.is_some() {
            engine.tree.unlink_unknown(id);
        }
        engine.tree.link(parent.id(), id, before);
        engine.tree.set_scope(id, engine.tree[parent.id()].scope);
    });
    true
}

/// `pre_insert` into a document, if that is valid and only what is inserted has steps.
#[inline]
fn insert_connected<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    parent: &'a Node,
    child: Option<&'a Node>,
) -> bool {
    let doc = parent.doc();
    if node.parent().is_some()
        || !parent.is_element()
        || !parent.is_watched_by_engine_only()
        || !(node.is_element() || node.kind() == Kind::Text)
        || node.has(F::CONNECTED | F::RENDERED | F::USER_AGENT)
        || node.steps().contains(Has::PARENT_CHANGED)
        || node.doc() != doc
        || child.is_some_and(|it| it.parent() != Some(parent) || parent.has(F::HAS_RANGES))
        || !KEPT.get().is_null()
    {
        return false;
    }
    link(node, parent, child);
    let (id, before, previous) = (node.id(), linked_from(child), node.previous_sibling());
    parent.restructure(|engine, parent| engine.insert(parent, id, before));
    let mut after = None;
    if node.is_only_object(RARE_TO_CONNECT, CONNECTION_STEPS) {
        node.set(parent.flags() & (F::CONNECTED | F::RENDERED));
    } else if let Some(scope) = parent.scope() {
        connect(
            cx,
            node,
            scope,
            Arrival::default(),
            after.insert(Rooted::default()),
        );
    }
    if parent.is_rendered() {
        doc.invalidate(cx);
    }
    if doc.is(DocFlags::OBSERVES_CHILDREN | DocFlags::RECORDS_EDITS) {
        queue_mutation_record(
            &cx.heap,
            parent,
            Record::Children {
                added: &Rooted::from_nodes(&cx.heap, [node]),
                removed: &Rooted::default(),
                previous,
                next: child,
            },
        );
    }
    after.inspect(|it| run_post_connection_steps(cx, it, false));
    true
}

/// No observer is told.
#[inline]
pub(crate) fn append_detached(parent: &Node, node: &Node) {
    link(node, parent, None);
    if node.kind().is_linked() {
        let (parent_id, id) = (parent.id(), node.id());
        parent.arena().write(|engine| {
            engine.tree.link(parent_id, id, 0);
            engine.tree.set_scope(id, engine.tree[parent_id].scope);
        });
    }
}

/// `outer`: that of the root of the subtree.
fn scope_within<'a>(at: &'a Node, outer: &'a Node) -> &'a Node {
    let known = if at.kind().is_linked() || at.has(F::SHADOW_ROOT) {
        Some(at)
    } else {
        at.parent()
    };
    known
        .and_then(|it| {
            it.node(Some(it.read(|tree, id| tree[id].scope)).filter(|it| *it > DOCUMENT)?)
        })
        .unwrap_or(outer)
}

fn id_of(element: &Element) -> Atom {
    Atom::from_string(&element.attr(atom!("id")).unwrap_or_default())
}

#[inline]
fn make_objects_with_ids(root: &Node) {
    if root.doc().is(DocFlags::WATCHES_IDS) {
        root.shadow_including_descendants().for_each(|_| {});
    }
}

const RARE_TO_CONNECT: F = F::NAMED
    .union(F::HAS_NONCE)
    .union(F::AUTOFOCUS)
    .union(F::CUSTOM)
    .union(F::UNDEFINED)
    .union(F::ANIMATED)
    .union(F::WATCHED)
    .union(F::BLOCKS_WHEEL)
    .union(F::SHADOW_ROOT);
const RARE_TO_DISCONNECT: F = F::NAMED
    .union(F::SHADOW_ROOT)
    .union(F::CUSTOM)
    .union(F::ANIMATED)
    .union(F::SHOWS_AS_POPOVER);
const CONNECTION_STEPS: Has = Has::UA_SHADOW
    .union(Has::INSERTED)
    .union(Has::POST_CONNECTION)
    .union(Has::RENDERED);

/// Whether nothing is to be done when it leaves its scope and enters it again, and no script runs meanwhile.
fn can_stay_connected(root: &Node, parent: &Node) -> bool {
    !parent.has(F::HOST | F::SLOT | F::IN_SELECT)
        && !parent.steps().contains(Has::CHILDREN_CHANGED)
        && !root.steps_for_moving().contains(Has::PARENT_CHANGED)
        && !root.doc().is(DocFlags::WATCHES_IDS)
        && !(parent.arena().has_slots.get() && parent.is_in_shadow_tree())
        && root.shadow_including_objects().all(|it| {
            it.prefetch_after();
            !it.has(RARE_TO_CONNECT | RARE_TO_DISCONNECT)
                && !it
                    .steps_for_moving()
                    .intersects(CONNECTION_STEPS | Has::REMOVED)
        })
}

#[derive(Default)]
struct Arrival {
    is_move: bool,
    was_kept: bool,
}

fn connect<'a>(
    cx: &mut JsScope<'a>,
    root: &'a Node,
    scope: &'a Node,
    Arrival { is_move, was_kept }: Arrival,
    after: &mut Rooted<'a>,
) {
    let inherited = scope.flags() & F::RENDERED | F::CONNECTED;
    make_objects_with_ids(root);
    let (mut next, mut told) = (Some(root), Rooted::default());
    while let Some(at) = next {
        at.prefetch_after();
        at.set(inherited);
        if at.has(RARE_TO_CONNECT | F::HAS_ID) || at.steps_for_moving().intersects(CONNECTION_STEPS)
        {
            connect_rare(cx, at, scope, is_move, after, &mut told);
        }
        if at.has(F::HAS_BARE_CHILDREN) {
            bare::for_each_id(at, |id, element| {
                scope_within(at, scope).add_id(&cx.heap, id, element)
            });
        }
        next = at.shadow_including_following(root, Node::first_object);
    }
    for at in told.iter().filter(|it| it.is_connected()) {
        tell_of_connection(cx, at, is_move, at.is_rendered() && !was_kept);
    }
}

/// No script runs.
#[inline(never)]
fn connect_rare<'a>(
    cx: &mut JsScope<'a>,
    at: &'a Node,
    scope: &'a Node,
    is_move: bool,
    after: &mut Rooted<'a>,
    told: &mut Rooted<'a>,
) {
    let steps = at.steps_for_moving();
    if steps.contains(Has::POST_CONNECTION) {
        after.push(&cx.heap, at);
    }
    let Some(element) = at.as_element() else {
        if at.has(F::SHADOW_ROOT) {
            told.push(&cx.heap, at);
        }
        return;
    };
    if at.has(F::HAS_ID) {
        scope_within(at, scope).add_id(&cx.heap, element.with(|it| it.id), element.id());
    }
    if at.has(F::NAMED) {
        named::changed(&cx.heap, element);
    }
    if at.flags().contains(F::BLOCKS_WHEEL | F::RENDERED) {
        at.engine(|engine, id| engine.set_blocks_wheel(id, true));
    }
    if at.has(F::AUTOFOCUS | F::HAS_NONCE | F::ANIMATED | F::WATCHED)
        || steps.intersects(Has::RENDERED | Has::UA_SHADOW)
        || at.has(F::HAS_ID) && at.doc().is(DocFlags::WATCHES_IDS)
    {
        told.push(&cx.heap, at);
    }
    if let Some(inserted) = at.kind().steps().inserted {
        inserted(&cx.heap, element, is_move);
    }
    if at.has(F::CUSTOM | F::UNDEFINED) {
        custom::connected(cx, element, is_move);
    }
}

fn tell_of_connection<'a>(cx: &mut JsScope<'a>, at: &'a Node, is_move: bool, is_new: bool) {
    let Some(at) = at.as_element() else {
        if is_new {
            seams::shadow_root_rendered(cx, at);
        }
        return;
    };
    if at.has(F::AUTOFOCUS) && !is_move {
        seams::autofocus_inserted(cx, at);
    }
    if at.has(F::HAS_ID) {
        at.doc().id_changed(cx, &id_of(at));
    }
    if at.has(F::HAS_NONCE) && !is_move {
        at.hide_nonce(cx);
    }
    if is_new && at.steps().contains(Has::RENDERED) {
        seams::rendered(cx, at);
    }
    if is_new && at.has(F::ANIMATED) {
        crate::api::animation::rendered(cx, at);
    }
    if is_new && at.has(F::WATCHED) {
        crate::api::observers::rendered(&cx.heap, at);
    }
    if at.steps().contains(Has::UA_SHADOW) && !at.has(F::HOST) && at.is_rendered() {
        seams::ua_shadow(cx, at);
    }
}

/// No script runs. `removed` gets each node that has steps, and then its scope. The result is for `tell_of_disconnection`.
fn disconnect<'a>(
    cx: &mut JsScope<'a>,
    root: &'a Node,
    scope: &'a Node,
    next_step: Next,
    is_move: bool,
    removed: &mut Rooted<'a>,
) -> Rooted<'a> {
    let lost = if next_step == Next::Gone {
        F::CONNECTED | F::RENDERED
    } else {
        F::CONNECTED
    };
    make_objects_with_ids(root);
    let (mut next, mut told) = (Some(root), Rooted::default());
    while let Some(at) = next {
        at.prefetch_after();
        at.unset(lost);
        if at.has(RARE_TO_DISCONNECT | F::HAS_ID) || at.steps_for_moving().contains(Has::REMOVED) {
            disconnect_rare(cx, at, scope, is_move, removed, &mut told);
        }
        if at.has(F::HAS_BARE_CHILDREN) {
            bare::for_each_id(at, |id, element| {
                scope_within(at, scope).remove_id(id, element)
            });
        }
        next = at.shadow_including_following(root, Node::first_object);
    }
    told
}

#[inline(never)]
fn disconnect_rare<'a>(
    cx: &mut JsScope<'a>,
    at: &'a Node,
    scope: &'a Node,
    is_move: bool,
    removed: &mut Rooted<'a>,
    told: &mut Rooted<'a>,
) {
    if at.steps_for_moving().contains(Has::REMOVED) || at.has(F::SHOWS_AS_POPOVER) {
        [at, scope_within(at, scope)]
            .into_iter()
            .for_each(|it| removed.push(&cx.heap, it));
    }
    if at.has(F::SHADOW_ROOT | F::ANIMATED)
        || at.has(F::HAS_ID) && at.doc().is(DocFlags::WATCHES_IDS)
    {
        told.push(&cx.heap, at);
    }
    let Some(element) = at.as_element() else {
        return;
    };
    if at.has(F::HAS_ID) {
        scope_within(at, scope).remove_id(element.with(|it| it.id), element.id());
    }
    if at.has(F::NAMED) {
        named::changed(&cx.heap, element);
    }
    if at.has(F::CUSTOM) {
        custom::disconnected(cx, element, is_move);
    }
}

fn tell_of_disconnection<'a>(cx: &mut JsScope<'a>, at: &'a Node, was_rendered: bool) {
    if let Some(element) = at.as_element().filter(|it| it.has(F::HAS_ID)) {
        at.doc().id_changed(cx, &id_of(element));
    }
    if was_rendered {
        tell_of_unrendering(cx, at);
    }
}

fn tell_of_unrendering<'a>(cx: &mut JsScope<'a>, at: &'a Node) {
    if at.is_rendered() {
        return;
    }
    if let Some(shadow) = at.as_shadow_root().filter(|it| !it.has(F::USER_AGENT)) {
        seams::shadow_root_unrendered(shadow);
    } else if let Some(element) = at.as_element().filter(|it| it.has(F::ANIMATED)) {
        crate::api::animation::unrendered(&cx.heap, element);
    }
}

/// Whether the engine has events.
fn detach(node: &Node) -> bool {
    node.kind().is_linked()
        && node.restructure(|engine, id| {
            engine.detach(id);
            node.is_rendered() && engine.has_events()
        })
}

/// Before anything but the shadow tree of a control that has stayed changes.
#[inline]
pub(crate) fn let_go_before_changing<'a>(cx: &mut JsScope<'a>, node: &'a Node) {
    // SAFETY: as `KEPT` says.
    if let Some(kept) = unsafe { KEPT.get().as_ref() }
        && (kept.has(F::USER_AGENT) || !node.flags().contains(F::USER_AGENT | F::CONNECTED))
    {
        let_go(cx, kept);
    }
}

/// Finishes the removal of what `KEPT` has.
#[cold]
fn let_go<'a>(cx: &mut JsScope<'a>, kept: &'a Node) {
    KEPT.set(core::ptr::null());
    if let Some(scope) = kept.scope() {
        disconnect(
            cx,
            kept,
            scope,
            Next::Reinserted,
            false,
            &mut Rooted::default(),
        );
    }
    let has_events = detach(kept);
    kept.arena().tree_changed(true);
    let all = kept
        .shadow_including_objects()
        .inspect(|it| it.unset(F::RENDERED));
    let told = Rooted::from_nodes(
        &cx.heap,
        all.filter(|it| it.has(F::SHADOW_ROOT | F::ANIMATED)),
    );
    told.iter().for_each(|it| tell_of_unrendering(cx, it));
    if has_events {
        crate::api::animation::take_events_after_removing(cx, kept.doc(), Some(kept));
    }
    kept.doc().invalidate(cx);
}

/// Only the ancestors of what is hovered, pressed or focused have these.
const INTERACTION: State = State::HOVER
    .union(State::ACTIVE)
    .union(State::FOCUS)
    .union(State::FOCUS_VISIBLE)
    .union(State::FOCUS_WITHIN);

fn forget_interaction(root: &Node) {
    let Some(state) = root
        .as_element()
        .map(|it| it.state() & INTERACTION)
        .filter(|it| !it.is_empty())
    else {
        return;
    };
    let mut pending = vec![root];
    while let Some(at) = pending.pop() {
        // The control of a label is active without its ancestors.
        let follows = |it: &&Node| {
            state.contains(State::ACTIVE)
                || it
                    .as_element()
                    .is_some_and(|it| it.state().intersects(INTERACTION))
        };
        let shadow = at.as_element().and_then(Element::shadow_root);
        pending.extend(
            at.children()
                .chain(shadow.into_iter().flat_map(|it| it.children()))
                .filter(follows),
        );
        at.as_element()
            .into_iter()
            .for_each(|it| it.change(|engine, id| engine.set_state(id, INTERACTION, false)));
    }
}

#[inline]
fn is_host_including_inclusive_ancestor(node: &Node, of: &Node) -> bool {
    (node == of
        || node.first_object().is_some()
        || node.has(F::HOST)
        || node.kind() == Kind::Template)
        && (node.is_connected() || !of.is_connected())
        && core::iter::successors(Some(of), |it| {
            it.parent()
                .or_else(|| it.as_fragment()?.edge_node(Edge::Host))
        })
        .any(|it| it == node)
}

/// Does nothing if a script has made it impossible meanwhile.
fn insert_one<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    parent: &'a Node,
    before: Option<&'a Node>,
    is_move: bool,
    after: &mut Rooted<'a>,
) {
    if core::ptr::eq(KEPT.get(), node)
        && (!parent.is_rendered()
            || node.kind().is_linked()
                && node.read(|tree, id| tree[id].scope != tree[parent.id()].scope))
    {
        let_go(cx, node);
    }
    if node.parent().is_some()
        || before.is_some_and(|it| it.parent() != Some(parent))
        || node.doc() != parent.doc()
        || is_host_including_inclusive_ancestor(node, parent)
    {
        return;
    }
    let was_kept = node.is_rendered();
    if was_kept {
        KEPT.set(core::ptr::null());
    }
    link(node, parent, before);
    if node.kind().is_linked() {
        let (id, before) = (node.id(), linked_from(before));
        parent.restructure(|engine, parent| {
            if is_move {
                engine.move_node(parent, id, before)
            } else {
                engine.insert(parent, id, before)
            }
        });
    }
    if !node.is_connected()
        && let Some(scope) = parent.scope()
    {
        connect(cx, node, scope, Arrival { is_move, was_kept }, after);
    }
    if parent.is_rendered() {
        parent.doc().invalidate(cx);
    }
    if parent.arena().has_slots.get() {
        slots::after_insert(cx, node, parent);
    }
    if node.steps_for_moving().contains(Has::PARENT_CHANGED) {
        seams::parent_changed(cx, node, None);
    }
    seams::child_moved(cx, parent, node);
}

fn run_post_connection_steps<'a>(cx: &mut JsScope<'a>, after: &Rooted<'a>, is_move: bool) {
    if !after.is_empty() {
        seams::post_connection(cx, after, is_move);
    }
}

/// With the adoption that comes before it.
pub(crate) fn insert<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    parent: &'a Node,
    before: Option<&'a Node>,
    observers: Observers,
) {
    insert_or_move(cx, node, parent, before, observers, false);
}

fn insert_or_move<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    parent: &'a Node,
    before: Option<&'a Node>,
    observers: Observers,
    is_move: bool,
) {
    let_go_before_changing(cx, if is_move { parent.doc() } else { parent });
    let mut nodes = Rooted::default();
    if node.as_fragment().is_some() {
        if before.is_none() && bare::move_children(cx, node, parent) {
            return;
        }
        while let Some(child) = node.first_child() {
            nodes.push(&cx.heap, child);
            remove(cx, child, Observers::Suppress);
        }
        if nodes.is_empty() {
            return;
        }
        if node
            .doc()
            .is(DocFlags::OBSERVES_CHILDREN | DocFlags::RECORDS_EDITS)
        {
            queue_mutation_record(
                &cx.heap,
                node,
                Record::Children {
                    added: &Rooted::default(),
                    removed: &nodes,
                    previous: None,
                    next: None,
                },
            );
        }
    } else {
        nodes.push(&cx.heap, node);
        if node.parent().is_some() {
            dormant::wake_unless_they_can_stay(node, parent);
            let keeps =
                node.is_rendered() && node.scope() == parent.scope() && KEPT.get().is_null();
            remove_for(
                cx,
                node,
                Observers::Notify,
                if keeps && !is_move {
                    Next::Reinserted
                } else if keeps {
                    Next::Moved
                } else {
                    Next::Gone
                },
                is_move,
            );
        }
    }
    let doc = parent.doc();
    nodes
        .iter()
        .filter(|it| it.doc() != doc)
        .for_each(|it| adopt(cx, it, doc));
    if let Some(before) = before.filter(|_| parent.has(F::HAS_RANGES)) {
        seams::ranges_after_insert(cx, parent, before.index(), nodes.len());
    }
    let previous = before.map_or_else(|| parent.last_child(), Node::previous_sibling);
    let mut after = Rooted::default();
    nodes
        .iter()
        .for_each(|it| insert_one(cx, it, parent, before, is_move, &mut after));
    if core::ptr::eq(KEPT.get(), node) {
        let_go(cx, node);
    }
    if doc.is(DocFlags::OBSERVES_CHILDREN | DocFlags::RECORDS_EDITS)
        && observers == Observers::Notify
    {
        queue_mutation_record(
            &cx.heap,
            parent,
            Record::Children {
                added: &nodes,
                removed: &Rooted::default(),
                previous,
                next: before,
            },
        );
    }
    if parent.steps().contains(Has::CHILDREN_CHANGED) || parent.has(F::IN_SELECT) {
        seams::children_changed(cx, parent, is_move);
    }
    run_post_connection_steps(cx, &after, is_move);
}

pub(crate) fn remove<'a>(cx: &mut JsScope<'a>, node: &'a Node, observers: Observers) {
    remove_for(cx, node, observers, Next::Gone, false);
}

fn remove_for<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    observers: Observers,
    next_step: Next,
    is_move: bool,
) {
    let_go_before_changing(cx, node);
    let Some(parent) = node.parent() else { return };
    if parent.allows_plain_removal(node) {
        return remove_detached(parent, node);
    }
    node.prefetch_first_below();
    if node.doc().is(DocFlags::HAS_RANGES) {
        seams::ranges_before_remove(cx, node, parent);
    }
    if node.doc().is(DocFlags::HAS_ITERATORS) {
        traversal::before_remove(&cx.heap, node);
    }
    if node.is_rendered() {
        seams::before_remove(cx, node, is_move);
    }
    if node.parent() != Some(parent) {
        return;
    }
    let (doc, was_rendered) = (node.doc(), node.is_rendered());
    if node.is_connected() && !is_move {
        forget_interaction(node);
    }
    let (previous, next) = (node.previous_sibling(), node.next_sibling());
    if next_step == Next::Gone
        && parent.is_watched_by_engine_only()
        && node.is_only_object(RARE_TO_DISCONNECT, Has::REMOVED | Has::PARENT_CHANGED)
    {
        unlink(node, parent);
        let has_events = detach(node);
        node.objects()
            .for_each(|it| it.unset(F::CONNECTED | F::RENDERED));
        if was_rendered {
            if has_events {
                crate::api::animation::take_events_after_removing(cx, doc, Some(node));
            }
            doc.invalidate(cx);
        }
        return record_removal(cx, node, parent, observers, previous, next);
    }
    let (scope, slot) = (node.scope(), node.assigned_slot());
    unlink(node, parent);
    let has_events = next_step == Next::Gone && detach(node);
    let slots = if parent.arena().has_slots.get() {
        slots::unassign_removed(&cx.heap, node, parent)
    } else {
        None
    };
    let mut removed = Rooted::default();
    if let Some(scope) = scope {
        let told =
            if next_step != Next::Gone && node.is_rendered() && can_stay_connected(node, parent) {
                Rooted::default()
            } else {
                disconnect(cx, node, scope, next_step, is_move, &mut removed)
            };
        if node.is_rendered() {
            KEPT.set(node);
        }
        let is_unrendered = was_rendered && !node.is_rendered();
        told.iter()
            .for_each(|it| tell_of_disconnection(cx, it, is_unrendered));
    }
    if was_rendered && next_step == Next::Gone {
        if has_events {
            crate::api::animation::take_events_after_removing(cx, doc, Some(node));
        }
        doc.invalidate(cx);
    }
    if parent.arena().has_slots.get() {
        slots::after_remove(cx, node, parent, slot, slots);
    }
    if node.steps_for_moving().contains(Has::PARENT_CHANGED) {
        seams::parent_changed(cx, node, Some(parent));
    }
    let runs_scripts = || {
        matches!(parent.kind(), Kind::Script | Kind::SvgScript)
            || removed.iter().any(|it| {
                matches!(
                    it.kind(),
                    Kind::IFrame | Kind::Frame | Kind::Object | Kind::Embed
                )
            })
    };
    if next_step == Next::Reinserted && runs_scripts() {
        let_go_before_changing(cx, doc);
    }
    for index in (0..removed.len()).step_by(2) {
        if let (Some(it), Some(scope)) = (removed.get(index), removed.get(index + 1)) {
            seams::removed(cx, it, scope, is_move);
        }
    }
    record_removal(cx, node, parent, observers, previous, next);
    if parent.steps().contains(Has::CHILDREN_CHANGED)
        && !matches!(parent.kind(), Kind::Script | Kind::SvgScript)
        || parent.has(F::IN_SELECT)
    {
        seams::child_moved(cx, parent, node);
        seams::children_changed(cx, parent, is_move);
    }
}

#[inline]
fn record_removal<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    parent: &'a Node,
    observers: Observers,
    previous: Option<&'a Node>,
    next: Option<&'a Node>,
) {
    if parent.doc().is(DocFlags::OBSERVES_CHILDREN
        | DocFlags::OBSERVES_ATTRIBUTES
        | DocFlags::OBSERVES_DATA
        | DocFlags::RECORDS_EDITS)
    {
        observers::observe_transiently(&cx.heap, node, parent);
        if parent
            .doc()
            .is(DocFlags::OBSERVES_CHILDREN | DocFlags::RECORDS_EDITS)
            && observers == Observers::Notify
        {
            let removed = Rooted::from_nodes(&cx.heap, [node]);
            queue_mutation_record(
                &cx.heap,
                parent,
                Record::Children {
                    added: &Rooted::default(),
                    removed: &removed,
                    previous,
                    next,
                },
            );
        }
    }
}

/// If no script runs in between, and their order makes no difference.
fn remove_children_at_once<'a>(cx: &mut JsScope<'a>, parent: &'a Node) -> Option<()> {
    const WATCHES: DocFlags = DocFlags::HAS_ITERATORS
        .union(DocFlags::RECORDS_EDITS)
        .union(DocFlags::WATCHES_IDS)
        .union(DocFlags::IS_ACCESSIBLE);
    const LOST: F = F::CONNECTED.union(F::RENDERED);
    parent.first_object()?.next_sibling()?;
    let_go_before_changing(cx, parent);
    let (doc, scope) = (parent.doc(), parent.scope()?);
    if !parent.is_rendered()
        || parent.has(F::HOST | F::SLOT | F::USER_AGENT | F::IN_SELECT | F::HAS_RANGES)
        || parent.steps().contains(Has::CHILDREN_CHANGED)
        || doc.is(WATCHES)
        || parent.arena().has_slots.get() && parent.is_in_shadow_tree()
        || parent.as_element()?.state().intersects(INTERACTION)
        || !seams::is_left_alone(parent)
    {
        return None;
    }
    let (mut next, mut controls) = (parent.first_object(), Rooted::default());
    while let Some(at) = next {
        at.prefetch_after();
        if at.has(RARE_TO_DISCONNECT | F::HAS_RANGES)
            || at
                .steps_for_moving()
                .intersects(Has::REMOVED | Has::PARENT_CHANGED)
        {
            let is_control = matches!(at.kind(), Kind::Input | Kind::Button | Kind::TextArea);
            if at.has((RARE_TO_DISCONNECT - F::SHADOW_ROOT) | F::HAS_RANGES)
                || !(is_control || at.flags().contains(F::SHADOW_ROOT | F::USER_AGENT))
            {
                parent
                    .shadow_including_objects()
                    .take_while(|it| *it != at)
                    .for_each(|it| it.set(LOST));
                return None;
            }
            if is_control {
                controls.push(&cx.heap, at);
            }
        }
        at.unset(LOST);
        next = at.shadow_including_following(parent, Node::first_object);
    }
    bare::for_each_id(parent, |id, element| scope.remove_id(id, element));
    let ids =
        parent.read(|tree, id| smallvec::SmallVec::<[NodeId; 32]>::from_iter(tree.children(id)));
    let has_events = parent.restructure(|engine, id| {
        engine.detach_children(id, &ids);
        engine.has_events()
    });
    let is_observed = doc
        .is(DocFlags::OBSERVES_CHILDREN | DocFlags::OBSERVES_ATTRIBUTES | DocFlags::OBSERVES_DATA);
    let removed = Rooted::from_nodes(
        &cx.heap,
        parent.children().take_while(|_| has_events || is_observed),
    );
    let mut next = parent.first_object();
    while let Some(child) = next {
        next = child.next_sibling();
        [Link::Parent, Link::Previous, Link::Next]
            .into_iter()
            .for_each(|it| child.set_link(it, None));
        if matches!(
            child.kind(),
            Kind::Input | Kind::Button | Kind::TextArea | Kind::Meter | Kind::Progress
        ) {
            forget_interaction(child);
        }
    }
    [Link::First, Link::Last]
        .into_iter()
        .for_each(|it| parent.set_link(it, None));
    children_changed(parent);
    if has_events {
        crate::api::animation::take_events_after_removing_all(cx, doc, &removed);
    }
    doc.invalidate(cx);
    for control in controls.iter() {
        if control.parent().is_none() {
            seams::parent_changed(cx, control, Some(parent));
        }
        seams::removed(cx, control, scope, false);
    }
    removed
        .iter()
        .take_while(|_| is_observed)
        .for_each(|it| observers::observe_transiently(&cx.heap, it, parent));
    Some(())
}

/// Gives the nodes slots in the arena of `doc`.
fn move_to_arena(root: &Node, doc: &Doc) {
    let (old, new) = (root.share_arena(), doc.share_arena());
    let extras = |it: &'_ Node| {
        it.try_edge_list(Edge::AttributeNodes)
            .into_iter()
            .flat_map(List::nodes)
            .map(core::ptr::from_ref)
            .collect::<Vec<_>>()
    };
    let mut ids = crate::name::Map::default();
    if old.has_dormant_controls.get() {
        doc.prepare_for_dormant_controls();
    }
    root.shadow_including_descendants().for_each(|_| {});
    for node in root.shadow_including_objects() {
        // SAFETY: nothing allocates here.
        let extras = extras(node).into_iter().map(|it| unsafe { &*it });
        for node in extras.chain([node]) {
            debug_assert!(core::ptr::eq(node.arena(), &raw const *old));
            let slot = old.write(|engine| engine.tree.take(node.id()));
            let id = new.write(|engine| engine.tree.put(slot));
            ids.insert(node.id(), id);
            node.move_to(Rc::clone(&new), id);
        }
    }
    [&old, &new]
        .into_iter()
        .for_each(|it| it.tree_changed(true));
    new.has_slots
        .set(new.has_slots.get() || old.has_slots.get());
    new.has_remote_owners
        .set(new.has_remote_owners.get() || old.has_remote_owners.get());
    new.write(|engine| {
        ids.values()
            .for_each(|id| engine.rehome(*id, |old| ids.get(&old).copied().unwrap_or(0)))
    });
}

fn adopt_tree<'a>(cx: &mut JsScope<'a>, root: &'a Node, doc: &'a Doc, old: &'a Doc) {
    let is_scoped = has_scoped_registries();
    let (mut told, checks_style) = (
        Rooted::default(),
        doc.is(DocFlags::CHECKS_STYLE_ATTRIBUTES) && !old.has_page(),
    );
    if !bare::are_alike_but_for_quirks(old, doc) {
        root.shadow_including_descendants().for_each(|_| {});
    }
    if doc.quirks() != old.quirks() {
        doc.arena().classes_changed();
        doc.arena()
            .write(|engine| engine.reclassify(root.id(), doc.quirks()));
    }
    for at in root.shadow_including_objects() {
        at.set_link(Link::Document, Some(doc));
        at.written();
        if at.has(F::HAS_ATTR_NODES) {
            for attr in at
                .try_edge_list(Edge::AttributeNodes)
                .into_iter()
                .flat_map(List::nodes)
            {
                attr.set_link(Link::Document, Some(doc));
                attr.written();
            }
        }
        if let Some(element) = at
            .as_element()
            .filter(|it| checks_style && !it.has(F::USER_AGENT))
        {
            page::check_style_attribute(cx, element, doc);
        }
        if at.has(F::OBSERVED) {
            doc.set_doc_flags(
                old.doc_flags()
                    & (DocFlags::OBSERVES_CHILDREN
                        | DocFlags::OBSERVES_ATTRIBUTES
                        | DocFlags::OBSERVES_DATA),
                true,
            );
        }
        if is_scoped || at.has(F::CUSTOM) {
            custom::adopted(cx, at, old);
        }
        if at.has(F::HAS_RANGES)
            || at.steps().contains(Has::ADOPTED)
            || at.as_shadow_root().is_some()
        {
            told.push(&cx.heap, at);
        }
    }
    told.iter().for_each(|it| seams::adopted(cx, it, old));
    crate::api::history::targets_may_have_moved(cx, [old, doc]);
}

pub(crate) fn adopt<'a>(cx: &mut JsScope<'a>, node: &'a Node, doc: &'a Doc) {
    remove(cx, node, Observers::Notify);
    let old = node.doc();
    let is_held = || {
        node.parent().is_some()
            || node.has(F::SHADOW_ROOT)
            || node.kind().is_document()
            || node.edge(Edge::OwnerElement).is_some()
    };
    if old != doc && !is_held() {
        if old.is(DocFlags::HAS_ITERATORS) {
            doc.set_doc_flags(DocFlags::HAS_ITERATORS, true);
        }
        if !old.is_in_arena_of(doc) {
            move_to_arena(node, doc);
        }
        adopt_tree(cx, node, doc, old);
    }
}

fn hierarchy_error<'a>(heap: &JsHeap<'a>, message: &str) -> Result<'a> {
    Err(dom_error(heap, DomError::HierarchyRequestError, message))
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Validity {
    Inserting,
    Replacing,
}

pub(crate) fn ensure_pre_insert_validity<'a>(
    heap: &JsHeap<'a>,
    node: &Node,
    parent: &Node,
    child: Option<&Node>,
    validity: Validity,
) -> Result<'a> {
    let (kind, parent_kind) = (node.kind(), parent.kind());
    if parent_kind.is_character_data() || matches!(parent_kind, Kind::Doctype | Kind::Attr) {
        return hierarchy_error(heap, "This node type does not support this method.");
    }
    if is_host_including_inclusive_ancestor(node, parent) {
        return hierarchy_error(heap, "The new child element contains the parent.");
    }
    if child.is_some_and(|it| it.parent() != Some(parent)) {
        let message = match validity {
            Validity::Replacing => "The node to be replaced is not a child of this node.",
            Validity::Inserting => {
                "The node before which the new node is to be inserted is not a child of this node."
            }
        };
        return Err(dom_error(heap, DomError::NotFoundError, message));
    }
    if kind.is_document()
        || kind == Kind::Attr
        || kind == Kind::Doctype && !parent_kind.is_document()
    {
        return hierarchy_error(
            heap,
            "Nodes of this type may not be inserted inside nodes of that type.",
        );
    }
    if !parent_kind.is_document() {
        return Ok(());
    }
    let except = child.filter(|_| validity == Validity::Replacing);
    let has_other = |is_it: fn(Kind) -> bool| {
        parent
            .children()
            .any(|it| is_it(it.kind()) && Some(it) != except)
    };
    let elements = match node.as_fragment() {
        Some(_) if node.children().any(|it| it.kind().is_text()) => 2,
        Some(_) => node.element_children().count(),
        None => kind.is_element().into(),
    };
    let after = || {
        core::iter::successors(except.map_or(child, Node::next_sibling), |it| {
            it.next_sibling()
        })
    };
    let before = || {
        core::iter::successors(
            child.map_or_else(|| parent.last_child(), Node::previous_sibling),
            |it| it.previous_sibling(),
        )
    };
    if kind.is_text()
        || elements > 1
        || elements == 1
            && (has_other(Kind::is_element) || after().any(|it| it.kind() == Kind::Doctype))
        || kind == Kind::Doctype
            && (has_other(|it| it == Kind::Doctype) || before().any(Node::is_element))
    {
        return hierarchy_error(
            heap,
            "A document has one doctype, one element after it, and no text.",
        );
    }
    Ok(())
}

pub(crate) fn pre_insert<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    parent: &'a Node,
    child: Option<&'a Node>,
) -> Result<'a> {
    if insert_detached(node, parent, child) || insert_connected(cx, node, parent, child) {
        return Ok(());
    }
    ensure_pre_insert_validity(&cx.heap, node, parent, child, Validity::Inserting)?;
    if child.is_none() && parent.takes_plain_append(node) && !parent.has_observed_children() {
        append_detached(parent, node);
        return Ok(());
    }
    insert(
        cx,
        node,
        parent,
        if child == Some(node) {
            node.next_sibling()
        } else {
            child
        },
        Observers::Notify,
    );
    Ok(())
}

#[inline]
pub(crate) fn append<'a>(cx: &mut JsScope<'a>, node: &'a Node, parent: &'a Node) -> Result<'a> {
    pre_insert(cx, node, parent, None)
}

pub(crate) fn pre_remove<'a>(
    cx: &mut JsScope<'a>,
    child: &'a Node,
    parent: &'a Node,
) -> Result<'a> {
    if child.parent() != Some(parent) {
        return Err(dom_error(
            &cx.heap,
            DomError::NotFoundError,
            "The node to be removed is not a child of this node.",
        ));
    }
    remove(cx, child, Observers::Notify);
    Ok(())
}

fn itself_or_children<'a>(heap: &JsHeap<'a>, node: &'a Node) -> Rooted<'a> {
    match node.as_fragment() {
        Some(_) => Rooted::from_nodes(heap, node.children()),
        None => Rooted::from_nodes(heap, [node]),
    }
}

pub(crate) fn replace<'a>(
    cx: &mut JsScope<'a>,
    child: &'a Node,
    node: &'a Node,
    parent: &'a Node,
) -> Result<'a> {
    ensure_pre_insert_validity(&cx.heap, node, parent, Some(child), Validity::Replacing)?;
    let next = child.next_sibling().and_then(|it| {
        if it == node {
            node.next_sibling()
        } else {
            Some(it)
        }
    });
    let previous = child.previous_sibling().and_then(|it| {
        if it == node {
            node.previous_sibling()
        } else {
            Some(it)
        }
    });
    let added = itself_or_children(&cx.heap, node);
    remove(cx, node, Observers::Notify);
    let removed = Rooted::from_nodes(&cx.heap, child.parent().map(|_| child));
    remove(cx, child, Observers::Suppress);
    insert(cx, node, parent, next, Observers::Suppress);
    if parent
        .doc()
        .is(DocFlags::OBSERVES_CHILDREN | DocFlags::RECORDS_EDITS)
    {
        queue_mutation_record(
            &cx.heap,
            parent,
            Record::Children {
                added: &added,
                removed: &removed,
                previous,
                next,
            },
        );
    }
    Ok(())
}

pub(crate) fn replace_all<'a>(cx: &mut JsScope<'a>, node: Option<&'a Node>, parent: &'a Node) {
    bare::drop_children(cx, parent);
    let is_observed = parent.has_observed_children();
    let removed = Rooted::from_nodes(&cx.heap, parent.children().take_while(|_| is_observed));
    let added = node
        .filter(|_| is_observed)
        .map_or_else(Rooted::default, |it| itself_or_children(&cx.heap, it));
    let select = parent
        .as_element()
        .filter(|it| it.kind() == Kind::Select && it.first_child().is_some());
    select
        .into_iter()
        .for_each(|it| crate::api::forms::select::set_being_emptied(it, true));
    remove_children_at_once(cx, parent);
    while let Some(child) = parent.first_child() {
        remove(cx, child, Observers::Suppress);
    }
    select
        .into_iter()
        .for_each(|it| crate::api::forms::select::set_being_emptied(it, false));
    match node {
        Some(node) if parent.takes_plain_append(node) => append_detached(parent, node),
        Some(node) => insert(cx, node, parent, None, Observers::Suppress),
        None => {}
    }
    if !removed.is_empty() || !added.is_empty() {
        queue_mutation_record(
            &cx.heap,
            parent,
            Record::Children {
                added: &added,
                removed: &removed,
                previous: None,
                next: None,
            },
        );
    }
}

pub(crate) fn string_replace_all<'a>(cx: &mut JsScope<'a>, text: DomString, parent: &'a Node) {
    let Some(text) = bare::replace_with_text(cx, text, parent) else {
        return;
    };
    let node = (!text.is_empty()).then(|| parent.doc().create_text(&cx.heap, text));
    replace_all(cx, node.map(|it| &***it), parent);
}

pub(crate) fn move_before<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    parent: &'a Node,
    child: Option<&'a Node>,
) -> Result<'a> {
    if node.shadow_including_root() != parent.shadow_including_root()
        || !node.is_element() && !node.kind().is_character_data()
    {
        return hierarchy_error(
            &cx.heap,
            "State-preserving atomic move cannot be performed on these nodes.",
        );
    }
    ensure_pre_insert_validity(&cx.heap, node, parent, child, Validity::Inserting)?;
    let has_focus = seams::before_move(cx, node);
    insert_or_move(
        cx,
        node,
        parent,
        if child == Some(node) {
            node.next_sibling()
        } else {
            child
        },
        Observers::Notify,
        true,
    );
    if has_focus {
        seams::after_move(cx, node);
    }
    Ok(())
}

fn clone_single<'a>(
    cx: &mut JsScope<'a>,
    node: &'a Node,
    doc: &'a Doc,
    fallback_registry: JSValue,
) -> Result<'a, &'a Node> {
    let kind = node.kind();
    if let Some(element) = node.as_element() {
        element.flush_style(cx);
        let is_plain = !node.has(F::CUSTOM | F::UNDEFINED | F::FAILED_CUSTOM | F::HAS_NONCE)
            && !has_scoped_registries()
            && !element.may_be_custom()
            && element.is_value().is_none();
        let copy = match is_plain {
            true if node.is_in_arena_of(doc)
                && element.has_only_passive_attributes()
                && doc.quirks() == node.doc().quirks()
                && !doc.is(DocFlags::CHECKS_STYLE_ATTRIBUTES) =>
            {
                let copy =
                    doc.create_of_kind(&cx.heap, kind, |engine| engine.copy_element(node.id()));
                copy.set(node.flags() & (F::HAS_ID | F::HAS_NAMESPACED_ATTR));
                return Ok(copy);
            }
            true => doc.create_plain(&cx.heap, element.qual_name()),
            false => custom::create_copy(cx, element, doc, fallback_registry),
        };
        let has_edited_style = element.engine(|engine, id| engine.has_edited_style(id));
        let suspended = doc.doc_flags()
            & if has_edited_style {
                DocFlags::CHECKS_STYLE_ATTRIBUTES
            } else {
                DocFlags::empty()
            };
        doc.set_doc_flags(suspended, false);
        for (name, value) in element.attrs() {
            copy.set_attr_ns(cx, name, value);
        }
        doc.set_doc_flags(suspended, true);
        if has_edited_style {
            copy.engine(|engine, id| engine.count_style_as_edited(id));
        }
        if !is_plain {
            element.copy_nonce(copy);
        }
        return Ok(copy);
    }
    Ok(match kind {
        Kind::Text | Kind::CData => {
            let text = node.read(|tree, id| {
                if let Data::Text(text) = &tree[id].data {
                    text.clone()
                } else {
                    StoredText::default()
                }
            });
            doc.create_node(&cx.heap, kind, F::empty(), |engine| {
                engine.tree.create(Data::Text(text))
            })
        }
        Kind::Fragment | Kind::ShadowRoot => doc.create_fragment(&cx.heap),
        Kind::Attr => node
            .downcast::<Attr>()
            .map(|it| doc.create_attr(&cx.heap, it.qual_name(), it.value()))
            .expect("of that kind"),
        _ if let Some(from) = node.as_doc() => from.copy(cx),
        _ => doc.create_inert(&cx.heap, kind, node.with_inert(Clone::clone)),
    })
}

/// Copies what follows `node` below `parent` for as long as the copies can be bare. Returns what is left to copy, with the parent of its copy.
fn clone_plain<'a>(
    cx: &mut JsScope<'a>,
    mut node: &'a Node,
    root: &'a Node,
    owner: &'a Node,
) -> Option<(&'a Node, &'a Node)> {
    let (doc, arena, mut parent, mut count) = (owner.doc(), owner.arena(), owner.id(), 0);
    let top = node.parent()?;
    while bare::is_plain(node, doc) {
        node.prefetch_after();
        owner.set(F::HAS_BARE_CHILDREN);
        let copy = arena.write(|engine| {
            let copy = engine.append_bare_copy(node.id(), parent);
            count += 1 + if node.has(F::HAS_BARE_CHILDREN) {
                engine.copy_children(node.id(), copy)
            } else {
                0
            };
            copy
        });
        if let Some(child) = node.first_object() {
            (node, parent) = (child, copy);
            continue;
        }
        while node.next_sibling().is_none() {
            node = node.parent()?;
            if node == top {
                owner.bare_changed(cx, count);
                return None;
            }
            parent = owner.read(|tree, _| tree[parent].parent);
        }
        node = node.next_sibling()?;
    }
    debug_assert!(root.contains(node));
    owner.bare_changed(cx, count);
    Some((node, owner.node(parent)?))
}

/// `fallback_registry`: null for none.
pub(crate) fn clone_node<'a>(
    cx: &mut JsScope<'a>,
    root: &'a Node,
    doc: &'a Doc,
    subtree: bool,
    parent: Option<&'a Node>,
    fallback_registry: JSValue,
) -> Result<'a, &'a Node> {
    let (mut node, mut parent, mut doc, mut first) = (root, parent, doc, None);
    let copies_slots = subtree
        && !has_scoped_registries()
        && !doc.is(DocFlags::CHECKS_STYLE_ATTRIBUTES)
        && doc
            .arena()
            .read(|engine| engine.smil.effects.bases.is_empty());
    loop {
        node.prefetch_after();
        let copy = clone_single(cx, node, doc, fallback_registry)?;
        let result = *first.get_or_insert(copy);
        doc = copy.doc();
        if node.steps().contains(Has::CLONED) {
            seams::cloned(cx, node, copy, subtree);
        }
        match parent {
            Some(parent) if parent.takes_plain_append(copy) => append_detached(parent, copy),
            Some(parent) => insert(cx, copy, parent, None, Observers::Suppress),
            None => {}
        }
        if copies_slots
            && node.has_children()
            && !node.has(F::HOST)
            && !copy.is_connected()
            && copy.takes_bare()
            && bare::are_alike(node.doc(), doc)
        {
            if node.has(F::HAS_BARE_CHILDREN) {
                let count = copy
                    .arena()
                    .write(|engine| engine.copy_children(node.id(), copy.id()));
                copy.set(F::HAS_BARE_CHILDREN);
                copy.bare_changed(cx, count);
            } else if let Some((rest, parent_of_rest)) = node
                .first_object()
                .and_then(|it| clone_plain(cx, it, root, copy))
            {
                (node, parent) = (rest, Some(parent_of_rest));
                continue;
            }
        } else if let Some(child) = node.first_child().filter(|_| subtree) {
            (node, parent) = (child, Some(copy));
            continue;
        }
        let mut finished = copy;
        loop {
            if node.has(F::HOST) {
                clone_shadow_root(cx, node, finished)?;
            }
            if node == root {
                doc.report_bare(cx);
                return Ok(result);
            }
            if let Some(next) = node.next_sibling() {
                node = next;
                break;
            }
            let (Some(up), Some(copy_of_it)) = (node.parent(), parent) else {
                return Ok(result);
            };
            (node, finished, parent) = (up, copy_of_it, copy_of_it.parent());
        }
    }
}

fn clone_shadow_root<'a>(cx: &mut JsScope<'a>, host: &'a Node, copy: &'a Node) -> Result<'a> {
    let (Some(shadow), Some(copy)) = (
        host.as_element().and_then(Element::shadow_root),
        copy.as_element(),
    ) else {
        return Ok(());
    };
    if !shadow.is(ShadowFlags::CLONABLE) || !bun_core::StackCheck::init().is_safe_to_recurse() {
        return Ok(());
    }
    let root = copy.attach_shadow_unchecked(cx, false);
    root.bits_of_kind().set(shadow.bits_of_kind().get());
    root.set_reference_target(shadow.reference_target());
    custom::set_own_registry(&cx.heap, root, custom::own_registry(shadow));
    let mut next = shadow.first_child();
    while let Some(child) = next {
        clone_node(cx, child, copy.doc(), true, Some(root), JSValue::NULL)?;
        next = child.next_sibling();
    }
    Ok(())
}

pub(crate) fn normalize<'a>(cx: &mut JsScope<'a>, root: &'a Node) {
    let exclusive_text = |node: &'a Node| node.as_text().filter(|it| it.kind() == Kind::Text);
    let mut next = root.first_child();
    while let Some(node) = next {
        if let Some(text) = exclusive_text(node) {
            if text.data_length() == 0 {
                next = node.following(Some(root));
                remove(cx, node, Observers::Notify);
                continue;
            }
            while let Some(merged) = node.next_sibling().and_then(exclusive_text) {
                let length = text.data_length();
                text.append_data(cx, &merged.data());
                if node.doc().is(DocFlags::HAS_RANGES) {
                    seams::ranges_before_merge(cx, node, merged, length);
                }
                remove(cx, merged, Observers::Notify);
            }
        }
        next = node.following(Some(root));
    }
}
