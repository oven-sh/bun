//! Undo and redo in editable elements.

use core::cell::{Cell, RefCell};

use super::{Span, selected_span};
use crate::api::forms::text::continues_typing;
use crate::api::ui::prelude::*;
use crate::generated_bindgen::interaction::js_EditStep;

const MAX_STEPS: u32 = 200;

/// Each has its target in `EditStep::nodes`.
enum Change {
    /// After the target are the next sibling, what was added and what was removed.
    Children {
        added: u32,
        removed: u32,
    },
    Attribute {
        name: QualName,
        old: Option<DomString>,
    },
    Data {
        old: DomString,
    },
}

impl Change {
    fn node_count(&self) -> u32 {
        match self {
            Change::Children { added, removed } => 2 + added + removed,
            _ => 1,
        }
    }
}

/// What is undone at once.
pub(crate) struct EditStep {
    changes: RefCell<Vec<Change>>,
    input_type: Known,
    /// Also those that are part of an earlier one.
    change_count: Cell<u32>,
    /// Of the selection before and after.
    offsets: Cell<[[u32; 2]; 2]>,
}

slots!(EditStep = js_EditStep {
    host: Element,
    start_before: Node,
    end_before: Node,
    start_after: Node,
    end_after: Node,
} [
    nodes: Node,
]);

impl EditStep {
    fn new<'a>(heap: &JsHeap<'a>, host: &Element, input_type: Known) -> &'a EditStep {
        let step = js_EditStep::create(
            heap,
            EditStep {
                changes: Default::default(),
                input_type,
                change_count: 0.into(),
                offsets: Default::default(),
            },
        );
        step.set_host(Some(host));
        step
    }

    fn before(&self) -> Option<Span<'_>> {
        let [start, end] = self.offsets.get()[0];
        Some([
            Point {
                node: self.start_before()?,
                offset: start,
            },
            Point {
                node: self.end_before()?,
                offset: end,
            },
        ])
    }

    fn after(&self) -> Option<Span<'_>> {
        let [start, end] = self.offsets.get()[1];
        Some([
            Point {
                node: self.start_after()?,
                offset: start,
            },
            Point {
                node: self.end_after()?,
                offset: end,
            },
        ])
    }

    fn set_before(&self, span: Option<Span<'_>>) {
        self.set_start_before(span.map(|it| it[0].node));
        self.set_end_before(span.map(|it| it[1].node));
        self.offsets
            .update(|it| [span.map_or([0; 2], |it| it.map(|it| it.offset)), it[1]]);
    }

    fn set_after(&self, span: Option<Span<'_>>) {
        self.set_start_after(span.map(|it| it[0].node));
        self.set_end_after(span.map(|it| it[1].node));
        self.offsets
            .update(|it| [it[0], span.map_or([0; 2], |it| it.map(|it| it.offset))]);
    }

    fn push<'a, 'n>(
        &'a self,
        heap: &JsHeap<'a>,
        change: Change,
        nodes: impl IntoIterator<Item = &'n Node>,
    ) {
        let mut list = self.nodes();
        nodes.into_iter().for_each(|it| list.push(heap, it));
        self.set_nodes(list);
        self.changes.borrow_mut().push(change);
    }

    fn revert<'a>(&'a self, cx: &mut Cx<'a>) {
        let (nodes, mut end) = (self.nodes(), self.nodes().len());
        for change in self.changes.take().into_iter().rev() {
            let start = end - change.node_count() as usize;
            let mut own =
                (start..core::mem::replace(&mut end, start)).filter_map(|it| nodes.get(it));
            let Some(target) = own.next() else { continue };
            match change {
                Change::Data { old } => {
                    _ = target
                        .as_character_data()
                        .map(|it| it.replace_all_data(cx, &old))
                }
                Change::Attribute {
                    name,
                    old: Some(old),
                } => _ = target.as_element().map(|it| it.set_attr_ns(cx, name, old)),
                Change::Attribute { name, old: None } => {
                    _ = target.as_element().map(|it| it.remove_attr_ns(cx, name))
                }
                Change::Children { added, .. } => {
                    let next = own.next();
                    own.by_ref()
                        .take(added as usize)
                        .filter(|it| it.parent() == Some(target))
                        .for_each(|it| remove(cx, it, Observers::Notify));
                    for node in own {
                        if pre_insert(
                            cx,
                            node,
                            target,
                            next.filter(|it| it.parent() == Some(target)),
                        )
                        .is_err()
                        {
                            cx.global().clear_exception_except_termination();
                        }
                    }
                }
            }
        }
    }
}

/// While the document `RECORDS_EDITS`.
pub(crate) fn note<'a>(heap: &JsHeap<'a>, target: &'a Node, record: &Record<'_, '_>) {
    let Some(step) = Ui::left_in(target.doc()).and_then(Ui::recorded_step) else {
        return;
    };
    if target.has(NodeFlags::USER_AGENT)
        || target.is_connected() && !step.host().is_some_and(|it| it.contains(target))
    {
        return;
    }
    step.change_count.update(|it| it + 1);
    match *record {
        Record::Data { .. }
            if matches!(step.changes.borrow().last(), Some(Change::Data { .. }))
                && step.nodes().last() == Some(target) => {}
        Record::Data { old } => step.push(heap, Change::Data { old: old.clone() }, [target]),
        Record::Attribute { name, old } => step.push(
            heap,
            Change::Attribute {
                name: name.clone(),
                old: old.cloned(),
            },
            [target],
        ),
        Record::Children {
            added,
            removed,
            next,
            ..
        } => {
            let nodes = [target, next.unwrap_or(target)]
                .into_iter()
                .chain(added.iter())
                .chain(removed.iter());
            step.push(
                heap,
                Change::Children {
                    added: added.len(),
                    removed: removed.len(),
                },
                nodes,
            );
        }
    }
}

pub(super) fn before_style_changes<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    element.flush_style(cx);
    note(
        &cx.heap,
        element,
        &Record::Attribute {
            name: &QualName::plain(atom!("style")),
            old: element.attr(atom!("style")).as_ref(),
        },
    );
}

fn record<'a, R>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    step: &'a EditStep,
    change: impl FnOnce(&mut Cx<'a>) -> R,
) -> R {
    let outer = ui.recorded_step();
    ui.set_recorded_step(Some(step));
    ui.doc().set_doc_flags(DocFlags::RECORDS_EDITS, true);
    let result = change(cx);
    ui.set_recorded_step(outer);
    ui.doc()
        .set_doc_flags(DocFlags::RECORDS_EDITS, outer.is_some());
    result
}

fn edge(is_undo: bool) -> Edge {
    if is_undo { Edge::Undos } else { Edge::Redos }
}

fn last(steps: List<'_>) -> Option<&EditStep> {
    EditStep::from_value(steps.get(steps.len().checked_sub(1)?))
}

/// What `body` answers, and whether something has changed.
pub(super) fn change<'a, R>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    host: &'a Element,
    input_type: Known,
    body: impl FnOnce(&mut Cx<'a>) -> R,
) -> (R, bool) {
    let undos = host.edge_list(&cx.heap, Edge::Undos);
    let continued = last(undos).filter(|it| {
        it.input_type == input_type
            && continues_typing(input_type)
            && (input_type == atom!("insertCompositionText") || it.after() == selected_span(ui))
    });
    let step = continued.unwrap_or_else(|| {
        let step = EditStep::new(&cx.heap, host, input_type);
        step.set_before(selected_span(ui));
        step
    });
    let (count, mark) = (step.change_count.get(), custom::enter(cx));
    let result = record(cx, ui, step, body);
    let has_changed = count != step.change_count.get();
    if has_changed {
        step.set_after(selected_span(ui));
        host.clear_edge(&cx.heap, Edge::Redos);
        if continued.is_none() {
            undos.push(&cx.heap, step.value());
            undos.remove_range(&cx.heap, 0, undos.len().saturating_sub(MAX_STEPS));
        }
    }
    _ = custom::leave(cx, mark);
    (result, has_changed)
}

pub(super) fn can_travel(host: &Element, is_undo: bool) -> bool {
    host.try_edge_list(edge(is_undo))
        .is_some_and(|it| !it.is_empty())
}

pub(super) fn travel<'a>(cx: &mut Cx<'a>, ui: &'a Ui, host: &'a Element, is_undo: bool) -> bool {
    let Some((steps, step)) = host
        .try_edge_list(edge(is_undo))
        .and_then(|it| Some((it, last(it)?)))
    else {
        return false;
    };
    steps.remove_range(&cx.heap, steps.len() - 1, 1);
    let back = EditStep::new(&cx.heap, host, atom!(""));
    back.set_before(step.after());
    back.set_after(step.before());
    record(cx, ui, back, |cx| step.revert(cx));
    host.edge_list(&cx.heap, edge(!is_undo))
        .push(&cx.heap, back.value());
    if let Some(span) = step
        .before()
        .filter(|it| it.iter().all(|it| host.contains(it.node)))
    {
        let [start, end] = span.map(|it| Point {
            offset: it.offset.min(it.node.length()),
            ..it
        });
        range::selection_of(&cx.heap, ui.doc()).select(cx, start, end);
    }
    true
}
