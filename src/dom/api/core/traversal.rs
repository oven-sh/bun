//! <https://dom.spec.whatwg.org/#traversal>

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::{self, Class, JsHeap, JsInterface, JsLocal, JsScope};
use bun_jsc::{JSObject, Weak};

use super::gc::global_of;
use super::*;
use crate::api::events::call_operation_in_its_realm;
use crate::generated_bindgen::traversal::{
    DocumentTraversal, NodeIterator, Traverses, TreeWalker, js_NodeIterator, js_Traversal,
    js_TreeWalker,
};

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Found<'a> = bindgen::Result<'a, Option<&'a Node>>;

#[derive(Clone, Copy, PartialEq, Eq)]
enum Verdict {
    Accept,
    Reject,
    Skip,
    Other,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Direction {
    Forward,
    Backward,
}

impl Direction {
    #[inline(always)]
    fn child(self, node: &Node) -> Option<&Node> {
        if self == Direction::Forward {
            node.first_child()
        } else {
            node.last_child()
        }
    }

    #[inline(always)]
    fn sibling(self, node: &Node) -> Option<&Node> {
        if self == Direction::Forward {
            node.next_sibling()
        } else {
            node.previous_sibling()
        }
    }
}

#[repr(C)]
pub(crate) struct Traversal {
    what_to_show: u32,
    is_active: Cell<bool>,
    is_before_node: Cell<bool>,
    is_before_candidate: Cell<bool>,
    has_filter: bool,
}

impl Traversal {
    fn create<'a, T: JsInterface<Struct = Traversal> + core::ops::Deref<Target = Traversal>>(
        heap: &JsHeap<'a>,
        class: Class<T>,
        root: &'a Node,
        what_to_show: u32,
        filter: Option<JsLocal<'a, JSObject>>,
    ) -> &'a T {
        let made = class.create(
            heap,
            Traversal {
                what_to_show,
                is_active: Cell::new(false),
                is_before_node: Cell::new(true),
                is_before_candidate: Cell::new(true),
                has_filter: filter.is_some(),
            },
        );
        js_Traversal::set_root(made, Some(root));
        js_Traversal::set_node(made, Some(root));
        if let Some(filter) = filter {
            js_Traversal::set_filter(made, filter.to_js());
        }
        made
    }

    #[inline(always)]
    fn root(&self) -> &Node {
        js_Traversal::root(self).expect("set when it is made")
    }

    #[inline(always)]
    fn node(&self) -> &Node {
        js_Traversal::node(self).expect("set when it is made")
    }

    #[inline(always)]
    fn move_to<'a>(&'a self, node: &'a Node) -> Found<'a> {
        js_Traversal::set_node(self, Some(node));
        Ok(Some(node))
    }

    /// <https://dom.spec.whatwg.org/#concept-node-filter>
    #[inline(always)]
    fn filter<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> bindgen::Result<'a, Verdict> {
        let is_shown = self.what_to_show & 1 << (node.node_type() as u32 - 1) != 0;
        match self.has_filter {
            true => self.call_filter(cx, node, is_shown),
            false => Ok(if is_shown {
                Verdict::Accept
            } else {
                Verdict::Skip
            }),
        }
    }

    fn call_filter<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        node: &'a Node,
        is_shown: bool,
    ) -> bindgen::Result<'a, Verdict> {
        if self.is_active.get() {
            return Err(dom_error(
                &cx.heap,
                DomError::InvalidStateError,
                "Filter function can't be recursive",
            ));
        }
        let Some(filter) = js_Traversal::filter(self).filter(|_| is_shown) else {
            return Ok(Verdict::Skip);
        };
        self.is_active.set(true);
        let (filter, node) = (JsLocal::new(&cx.heap, filter), node.to_local(&cx.heap));
        let answer =
            match call_operation_in_its_realm(cx, filter.to_js(), "acceptNode", node.to_js()) {
                Some(answer) => answer.map_err(Into::into),
                None => filter
                    .call_operation(cx, "acceptNode", &[node])
                    .map(JsLocal::to_js),
            };
        let verdict = answer.and_then(|it| Ok(it.coerce_to_i32(cx.global())? as u16));
        self.is_active.set(false);
        Ok(match verdict? {
            1 => Verdict::Accept,
            2 => Verdict::Reject,
            3 => Verdict::Skip,
            _ => Verdict::Other,
        })
    }
}

impl Traverses {
    pub(crate) fn get_what_to_show(&self) -> u32 {
        self.what_to_show
    }
}

/// Those that have the node as their root.
#[derive(Default)]
struct Iterators(RefCell<Vec<Weak<()>>>);

impl DocumentTraversal {
    pub(crate) fn create_node_iterator<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        root: &'a Node,
        what_to_show: u32,
        filter: Option<JsLocal<'a, JSObject>>,
    ) -> &'a NodeIterator {
        let made = Traversal::create(
            self.realm(heap),
            js_NodeIterator::CLASS,
            root,
            what_to_show,
            filter,
        );
        let mut all = root.extra::<Iterators>().0.borrow_mut();
        if all.len() == all.capacity() {
            all.retain(|it| it.get().is_some());
        }
        all.push(Weak::create_passive(made.to_js(), global_of(heap)));
        root.doc().set_doc_flags(DocFlags::HAS_ITERATORS, true);
        made
    }

    pub(crate) fn create_tree_walker<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        root: &'a Node,
        what_to_show: u32,
        filter: Option<JsLocal<'a, JSObject>>,
    ) -> &'a TreeWalker {
        Traversal::create(
            self.realm(heap),
            js_TreeWalker::CLASS,
            root,
            what_to_show,
            filter,
        )
    }
}

/// <https://dom.spec.whatwg.org/#nodeiterator-pre-removing-steps>
pub(super) fn before_remove<'a>(heap: &JsHeap<'a>, removed: &'a Node) {
    for root in removed.ancestors() {
        let Some(all) = root.try_extra::<Iterators>() else {
            continue;
        };
        let moved = |is_before: &Cell<bool>| {
            let next = removed
                .following_skip(Some(root))
                .filter(|_| is_before.get());
            is_before.set(next.is_some());
            next.or_else(|| removed.preceding(None))
        };
        all.0.borrow_mut().retain(|it| it.get().is_some());
        for it in all
            .0
            .borrow()
            .iter()
            .filter_map(|it| NodeIterator::from_js(heap, it.get()?))
        {
            if removed.contains(it.node()) {
                js_Traversal::set_node(it, moved(&it.is_before_node));
            }
            if js_Traversal::candidate(it).is_some_and(|it| removed.contains(it)) {
                js_Traversal::set_candidate(it, moved(&it.is_before_candidate));
            }
        }
    }
}

impl NodeIterator {
    pub(crate) fn get_pointer_before_reference_node(&self) -> bool {
        self.is_before_node.get()
    }

    /// <https://dom.spec.whatwg.org/#concept-nodeiterator-traverse>
    #[inline(always)]
    fn traverse<'a>(&'a self, cx: Cx<'_, 'a>, direction: Direction) -> Found<'a> {
        let (root, is_forward) = (self.root(), direction == Direction::Forward);
        let (mut node, mut is_before) = (self.node(), self.is_before_node.get());
        loop {
            if is_before == is_forward {
                is_before = !is_forward;
            } else {
                let Some(next) = (if is_forward {
                    node.following(Some(root))
                } else {
                    node.preceding(Some(root))
                }) else {
                    return Ok(None);
                };
                node = next;
            }
            let tested = node;
            let may_be_removed = self.has_filter && !self.is_active.get();
            if may_be_removed {
                js_Traversal::set_candidate(self, Some(node));
                self.is_before_candidate.set(is_before);
            }
            let verdict = self.filter(cx, tested);
            if may_be_removed {
                (node, is_before) = (
                    js_Traversal::candidate(self).unwrap_or(node),
                    self.is_before_candidate.get(),
                );
                js_Traversal::set_candidate(self, None);
            }
            if verdict? == Verdict::Accept {
                js_Traversal::set_node(self, Some(node));
                self.is_before_node.set(is_before);
                return Ok(Some(tested));
            }
        }
    }

    pub(crate) fn next_node<'a>(&'a self, cx: Cx<'_, 'a>) -> Found<'a> {
        self.traverse(cx, Direction::Forward)
    }

    pub(crate) fn previous_node<'a>(&'a self, cx: Cx<'_, 'a>) -> Found<'a> {
        self.traverse(cx, Direction::Backward)
    }

    pub(crate) fn detach(&self) {}
}

impl TreeWalker {
    pub(crate) fn get_current_node(&self) -> &Node {
        self.node()
    }

    pub(crate) fn set_current_node(&self, node: &Node) {
        js_Traversal::set_node(self, Some(node));
    }

    pub(crate) fn parent_node<'a>(&'a self, cx: Cx<'_, 'a>) -> Found<'a> {
        let mut node = self.node();
        while node != self.root() {
            let Some(parent) = node.parent() else { break };
            node = parent;
            if self.filter(cx, node)? == Verdict::Accept {
                return self.move_to(node);
            }
        }
        Ok(None)
    }

    /// <https://dom.spec.whatwg.org/#concept-traverse-children>
    fn traverse_children<'a>(&'a self, cx: Cx<'_, 'a>, direction: Direction) -> Found<'a> {
        let mut next = direction.child(self.node());
        while let Some(mut node) = next {
            let verdict = self.filter(cx, node)?;
            if verdict == Verdict::Accept {
                return self.move_to(node);
            }
            next = direction
                .child(node)
                .filter(|_| verdict == Verdict::Skip)
                .or_else(|| direction.sibling(node));
            while next.is_none() {
                let Some(parent) = node
                    .parent()
                    .filter(|it| *it != self.root() && *it != self.node())
                else {
                    return Ok(None);
                };
                node = parent;
                next = direction.sibling(node);
            }
        }
        Ok(None)
    }

    /// <https://dom.spec.whatwg.org/#concept-traverse-siblings>
    fn traverse_siblings<'a>(&'a self, cx: Cx<'_, 'a>, direction: Direction) -> Found<'a> {
        let mut node = self.node();
        if node == self.root() {
            return Ok(None);
        }
        loop {
            let mut next = direction.sibling(node);
            while let Some(sibling) = next {
                node = sibling;
                let verdict = self.filter(cx, node)?;
                if verdict == Verdict::Accept {
                    return self.move_to(node);
                }
                next = direction
                    .child(node)
                    .filter(|_| verdict != Verdict::Reject)
                    .or_else(|| direction.sibling(node));
            }
            let Some(parent) = node.parent().filter(|it| *it != self.root()) else {
                return Ok(None);
            };
            node = parent;
            if self.filter(cx, node)? == Verdict::Accept {
                return Ok(None);
            }
        }
    }

    pub(crate) fn first_child<'a>(&'a self, cx: Cx<'_, 'a>) -> Found<'a> {
        self.traverse_children(cx, Direction::Forward)
    }

    pub(crate) fn last_child<'a>(&'a self, cx: Cx<'_, 'a>) -> Found<'a> {
        self.traverse_children(cx, Direction::Backward)
    }

    pub(crate) fn next_sibling<'a>(&'a self, cx: Cx<'_, 'a>) -> Found<'a> {
        self.traverse_siblings(cx, Direction::Forward)
    }

    pub(crate) fn previous_sibling<'a>(&'a self, cx: Cx<'_, 'a>) -> Found<'a> {
        self.traverse_siblings(cx, Direction::Backward)
    }

    pub(crate) fn previous_node<'a>(&'a self, cx: Cx<'_, 'a>) -> Found<'a> {
        let mut node = self.node();
        while node != self.root() {
            while let Some(sibling) = node.previous_sibling() {
                node = sibling;
                let mut verdict = self.filter(cx, node)?;
                while let Some(child) = node.last_child().filter(|_| verdict != Verdict::Reject) {
                    node = child;
                    verdict = self.filter(cx, node)?;
                }
                if verdict == Verdict::Accept {
                    return self.move_to(node);
                }
            }
            let Some(parent) = node.parent().filter(|_| node != self.root()) else {
                break;
            };
            node = parent;
            if self.filter(cx, node)? == Verdict::Accept {
                return self.move_to(node);
            }
        }
        Ok(None)
    }

    pub(crate) fn next_node<'a>(&'a self, cx: Cx<'_, 'a>) -> Found<'a> {
        let (root, mut node, mut verdict) = (self.root(), self.node(), Verdict::Accept);
        loop {
            let Some(next) = node
                .first_child()
                .filter(|_| verdict != Verdict::Reject)
                .or_else(|| node.following_skip(Some(root)))
            else {
                return Ok(None);
            };
            node = next;
            verdict = self.filter(cx, node)?;
            if verdict == Verdict::Accept {
                return self.move_to(node);
            }
        }
    }
}
