//! How live ranges follow the tree.

use core::cell::RefCell;

use smallvec::SmallVec;

use super::*;
use crate::api::core::NodeFlags as F;

/// Those that start or end in a node.
#[derive(Default)]
struct Ranges(RefCell<SmallVec<[Rc<Weak<()>>; 1]>>);

/// Nothing moves the start of a document.
fn can_move(point: Point<'_>) -> bool {
    point.offset != 0 || !point.node.kind().is_document()
}

/// The nodes that have to know a range with these ends.
fn watchers<'a>(start: Point<'a>, end: Point<'a>) -> [Option<&'a Node>; 2] {
    let first = can_move(start).then_some(start.node);
    [
        first,
        can_move(end)
            .then_some(end.node)
            .filter(|it| Some(*it) != first),
    ]
}

impl Range {
    fn register(&self, heap: &JsHeap<'_>, node: &Node) {
        let handle = self
            .handle
            .get_or_init(|| Rc::new(Weak::create_passive(self.to_js(), global_of(heap))));
        let mut ranges = node.extra::<Ranges>().0.borrow_mut();
        if ranges.len() == ranges.capacity() {
            ranges.retain(|it| it.get().is_some());
        }
        ranges.push(Rc::clone(handle));
        node.set(F::HAS_RANGES);
        node.doc().set_doc_flags(DocFlags::HAS_RANGES, true);
    }

    fn unregister(&self, node: &Node) {
        let (Some(handle), mut ranges) = (self.handle.get(), node.extra::<Ranges>().0.borrow_mut())
        else {
            return;
        };
        if let Some(index) = ranges.iter().rposition(|it| Rc::ptr_eq(it, handle)) {
            ranges.remove(index);
        }
        node.toggle(F::HAS_RANGES, !ranges.is_empty());
    }

    pub(super) fn begin(&self, heap: &JsHeap<'_>, start: Point<'_>, end: Point<'_>) {
        self.store(start, end);
        watchers(start, end)
            .into_iter()
            .flatten()
            .for_each(|it| self.register(heap, it));
    }

    /// It is not used any more.
    pub(crate) fn stop_following(&self) {
        watchers(self.start(), self.end())
            .into_iter()
            .flatten()
            .for_each(|it| self.unregister(it));
    }

    pub(crate) fn extract_between<'a>(
        cx: Cx<'_, 'a>,
        start: Point<'a>,
        end: Point<'a>,
    ) -> Result<'a, &'a DocumentFragment> {
        let range = Range::new(&cx.heap, start, end);
        range
            .extract_contents(cx)
            .inspect(|_| range.stop_following())
    }

    pub(super) fn put<'a>(&'a self, cx: Cx<'_, 'a>, start: Point<'a>, end: Point<'a>) {
        let (old_start, old_end) = (self.start(), self.end());
        if (start, end) == (old_start, old_end) {
            return;
        }
        let (old, new) = (watchers(old_start, old_end), watchers(start, end));
        old.into_iter()
            .filter(|it| !new.contains(it))
            .flatten()
            .for_each(|it| self.unregister(it));
        new.into_iter()
            .filter(|it| !old.contains(it))
            .flatten()
            .for_each(|it| self.register(&cx.heap, it));
        self.store(start, end);
        if let Some(selection) = self.selection(&cx.heap) {
            selection.changed(cx);
        }
    }
}

/// `to` gets the offsets of the points in `node`, and answers for those that move.
fn move_points<'a>(cx: Cx<'_, 'a>, node: &'a Node, to: impl Fn(u32) -> Option<Point<'a>>) {
    if !node.has(F::HAS_RANGES) {
        return;
    }
    let handles = {
        let mut ranges = node.extra::<Ranges>().0.borrow_mut();
        ranges.retain(|it| it.get().is_some());
        node.toggle(F::HAS_RANGES, !ranges.is_empty());
        ranges.clone()
    };
    let moved = |point: Point<'a>| {
        if point.node == node {
            to(point.offset).unwrap_or(point)
        } else {
            point
        }
    };
    for handle in handles.into_iter().rev() {
        if let Some(range) = handle.get().and_then(|it| Range::from_js(&cx.heap, it)) {
            range.put(cx, moved(range.start()), moved(range.end()));
        }
    }
}

pub(super) fn after_replacing(offset: u32, at: u32, removed: u32, added: u32) -> u32 {
    match offset {
        _ if offset <= at => offset,
        _ if offset <= at + removed => at,
        _ => offset + added - removed,
    }
}

pub(crate) fn after_insert<'a>(cx: Cx<'_, 'a>, parent: &'a Node, index: u32, count: u32) {
    move_points(cx, parent, |offset| {
        (offset > index).then(|| Point::new(parent, offset + count))
    });
}

pub(crate) fn before_remove<'a>(cx: Cx<'_, 'a>, removed: &'a Node, parent: &'a Node) {
    let index = core::cell::LazyCell::new(|| removed.index());
    move_points(cx, parent, |offset| {
        (offset > *index).then(|| Point::new(parent, offset - 1))
    });
    for node in removed.objects().filter(|it| it.has(F::HAS_RANGES)) {
        move_points(cx, node, |_| Some(Point::new(parent, *index)));
    }
    if let Some(selection) = try_selection(parent.doc()) {
        selection.before_remove(cx, removed);
    }
}

pub(crate) fn after_replace_data<'a>(
    cx: Cx<'_, 'a>,
    node: &'a Node,
    at: u32,
    removed: u32,
    added: u32,
) {
    move_points(cx, node, |offset| {
        Some(Point::new(
            node,
            after_replacing(offset, at, removed, added),
        ))
    });
}

pub(crate) fn after_split<'a>(cx: Cx<'_, 'a>, node: &'a Node, rest: &'a Node, at: u32) {
    move_points(cx, node, |offset| {
        (offset > at).then(|| Point::new(rest, offset - at))
    });
    if let Some(parent) = node.parent().filter(|it| it.has(F::HAS_RANGES)) {
        let index = rest.index();
        move_points(cx, parent, |offset| {
            (offset == index).then(|| Point::new(parent, index + 1))
        });
    }
}

pub(crate) fn before_merge<'a>(cx: Cx<'_, 'a>, into: &'a Node, merged: &'a Node, length: u32) {
    move_points(cx, merged, |offset| Some(Point::new(into, offset + length)));
    if let Some(parent) = into.parent().filter(|it| it.has(F::HAS_RANGES)) {
        let index = merged.index();
        move_points(cx, parent, |offset| {
            (offset == index).then(|| Point::new(into, length))
        });
    }
}

pub(crate) fn adopted(node: &Node) {
    if node.has(F::HAS_RANGES) {
        node.doc().set_doc_flags(DocFlags::HAS_RANGES, true);
    }
}
