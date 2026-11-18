//! Moving and showing the selection.

use super::{By, Span, input_method, selected, spelling, typing_target};
use crate::api::forms::text_control;
use crate::api::ui::focus::{editing_host, is_editing_host};
use crate::api::ui::layout::{By as Reach, Caret, Direction, Unit};
use crate::api::ui::prelude::*;
use crate::api::ui::top_layer::top_modal;

/// What a caret in `node` cannot leave.
pub(crate) fn selection_root<'a>(cx: &mut Cx<'a>, node: &'a Node) -> &'a Node {
    let editor = text_control(node.out_of_control())
        .and_then(|it| it.editor())
        .or_else(|| editing_host(cx, node));
    editor.map_or_else(|| &**node.doc(), |it| &**it)
}

/// What was selected in a control that has lost the focus is kept, but not shown.
pub(super) fn is_in_idle_control(ui: &Ui, node: &Node) -> bool {
    node.has(NodeFlags::USER_AGENT)
        && text_control(node.out_of_control()).is_some_and(|it| Some(it.element) != ui.focused())
}

pub(super) fn caret(ui: &Ui) -> Option<Caret<'_>> {
    let selection = range::try_selection(ui.doc())?;
    Some(Caret {
        point: selection.anchor_and_focus()?[1],
        is_upstream: selection.is_upstream(),
    })
}

pub(crate) fn text<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> DomString {
    range::try_selection(ui.doc())
        .map(|it| it.text(cx))
        .unwrap_or_default()
}

fn moved_at<'a>(
    cx: &mut Cx<'a>,
    root: &'a Node,
    from: Caret<'a>,
    direction: Direction,
    reach: Reach,
    x: f32,
) -> Caret<'a> {
    layout::move_caret(cx, root, from, direction, reach, x).unwrap_or(from)
}

pub(super) fn moved<'a>(
    cx: &mut Cx<'a>,
    root: &'a Node,
    from: Caret<'a>,
    direction: Direction,
    reach: Reach,
) -> Caret<'a> {
    moved_at(cx, root, from, direction, reach, f32::NAN)
}

fn moved_from<'a>(
    cx: &mut Cx<'a>,
    root: &'a Node,
    point: Point<'a>,
    direction: Direction,
    reach: Reach,
) -> Point<'a> {
    moved(
        cx,
        root,
        Caret {
            point,
            is_upstream: false,
        },
        direction,
        reach,
    )
    .point
}

fn moved_by_paragraph<'a>(
    cx: &mut Cx<'a>,
    root: &'a Node,
    mut caret: Caret<'a>,
    direction: Direction,
    x: f32,
) -> Caret<'a> {
    let own = moved_from(
        cx,
        root,
        caret.point,
        Direction::Backward,
        Reach::ParagraphBoundary,
    );
    loop {
        let next = moved_at(cx, root, caret, direction, Reach::Line, x);
        if next.point == caret.point {
            return caret;
        }
        caret = next;
        if moved_from(
            cx,
            root,
            caret.point,
            Direction::Backward,
            Reach::ParagraphBoundary,
        ) != own
        {
            return caret;
        }
    }
}

pub(super) fn reveal<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if let Some(caret) = caret(ui) {
        layout::reveal_caret(cx, caret);
        ui.doc().invalidate(cx);
    }
}

/// https://w3c.github.io/selection-api/#dom-selection-modify
pub(crate) fn modify<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    extends: bool,
    direction: Direction,
    reach: Reach,
    by: By,
) -> Option<()> {
    let selection = range::try_selection(ui.doc())?;
    let (span, focus) = (selection.span()?, caret(ui)?);
    let (root, mut from) = (selection_root(cx, focus.point.node), focus);
    if !extends
        && !span.collapsed()
        && (reach == Reach::Character || IS_MAC && reach != Reach::Word)
    {
        let ahead = if looks_like(cx, root, Looks::RTL) {
            Direction::Left
        } else {
            Direction::Right
        };
        from.point = if direction == Direction::Forward || direction == ahead {
            span.end()
        } else {
            span.start()
        };
        if reach == Reach::Character {
            selection.collapse(cx, from.point);
            return None;
        }
    }
    let x = match reach {
        Reach::Line | Reach::Page | Reach::Paragraph => Some(selection.goal_x().get() as f32)
            .filter(|it| !it.is_nan())
            .or_else(|| Some(layout::caret_rect(cx, focus)?.x)),
        _ => None,
    };
    let to = match (reach, x.unwrap_or(f32::NAN)) {
        (Reach::Paragraph, x) => moved_by_paragraph(cx, root, from, direction, x),
        (_, x) => moved_at(cx, root, from, direction, reach, x),
    };
    let anchor = if extends {
        selection.anchor_and_focus()?[0]
    } else {
        to.point
    };
    if by == By::User
        && extends
        && span.collapsed()
        && (anchor == to.point
            || !fire(
                cx,
                anchor.node.out_of_control(),
                atom!("selectstart"),
                EventInit {
                    cancelable: true,
                    ..BUBBLES
                },
            ))
    {
        return None;
    }
    selection.select_with_affinity(cx, anchor, to.point, to.is_upstream);
    selection.goal_x().set(x.map_or(f64::NAN, f64::from));
    None
}

/// Moves its ends by that many characters.
pub(crate) fn adjust<'a>(cx: &mut Cx<'a>, ui: &'a Ui, by: [i32; 2]) -> Option<()> {
    let selection = range::try_selection(ui.doc())?;
    let span = selection.span()?;
    let (root, mut ends) = (
        selection_root(cx, span.start().node),
        [span.start(), span.end()],
    );
    for (end, by) in ends.iter_mut().zip(by) {
        for _ in 0..by.unsigned_abs() {
            let next = moved_from(
                cx,
                root,
                *end,
                if by < 0 {
                    Direction::Backward
                } else {
                    Direction::Forward
                },
                Reach::Character,
            );
            if core::mem::replace(end, next) == next {
                return None;
            }
        }
    }
    range::compare_points(ends[0], ends[1])
        .is_le()
        .then(|| selection.select(cx, ends[0], ends[1]))
}

/// `Range.expand()`. Without a unit it gets all of its tree.
pub(crate) fn expand<'a>(cx: &mut Cx<'a>, range: &'a Range, unit: Option<Unit>) {
    let root = range.start().node.root();
    if !root.is_connected() {
        return;
    }
    let Some(unit) = unit else {
        return range.set(
            cx,
            Point {
                node: root,
                offset: 0,
            },
            Point {
                node: root,
                offset: root.length(),
            },
        );
    };
    let ([first, _], [_, last]) = (
        layout::expand(cx, root, range.start(), unit),
        layout::expand(cx, root, range.end(), unit),
    );
    let in_tree = |point: Point<'a>, is_end: bool| {
        let host = core::iter::successors(Some(point.node), |it| it.root().host())
            .find(|it| it.root() == root)?;
        Some(if host == point.node {
            point
        } else {
            Point {
                node: host.parent()?,
                offset: host.index() + u32::from(is_end),
            }
        })
    };
    if let Some((start, end)) = in_tree(first, false)
        .zip(in_tree(last, true))
        .filter(|(a, b)| range::compare_points(*a, *b).is_le())
    {
        range.set(cx, start, end);
    }
}

pub(super) fn select_all<'a>(cx: &mut Cx<'a>, ui: &'a Ui, by: By) {
    let (selection, focused, doc): (_, _, &Node) = (
        range::selection_of(&cx.heap, ui.doc()),
        ui.focused(),
        ui.doc(),
    );
    if let Some(control) = focused.and_then(|it| text_control(it)) {
        return control.select_all(cx);
    }
    let shown = |it: Option<&'a Range>| {
        it.map(|it| it.start().node)
            .filter(|it| !is_in_idle_control(ui, it))
    };
    let mut root = match shown(selection.range()) {
        Some(start) => selection_root(
            cx,
            start
                .parent()
                .filter(|_| text_control(start).is_some())
                .unwrap_or(start),
        ),
        None => focused
            .and_then(|it| editing_host(cx, it))
            .map_or(doc, |it| it),
    };
    if root == doc {
        root = shown(selection.span()).map_or(doc, Node::root);
    } else if by == By::User
        && selection.range().is_some_and(|it| it.collapsed())
        && !focused.is_some_and(|it| root.contains(it))
    {
        // A caret that is not shown counts as no selection.
        root = doc;
    }
    if root == doc {
        root = top_modal(ui.doc())
            .or_else(|| ui.doc().body())
            .map_or(doc, |it| it);
    }
    if !fire(
        cx,
        root.host().map_or(root, |it| it),
        atom!("selectstart"),
        EventInit {
            cancelable: true,
            ..BUBBLES
        },
    ) {
        return;
    }
    let (mut start, mut end) = (
        Point {
            node: root,
            offset: 0,
        },
        Point {
            node: root,
            offset: root.length(),
        },
    );
    if root.is_element() {
        start = moved_from(cx, root, start, Direction::Forward, Reach::Nearest);
        end = moved_from(cx, root, end, Direction::Backward, Reach::Nearest);
    }
    selection.select(cx, start, end);
}

fn is_blank(text: &Node) -> bool {
    text.text().to_utf8().trim().is_empty()
}

fn first_caret_in<'a>(cx: &mut Cx<'a>, host: &'a Node) -> Point<'a> {
    let (mut block, mut near) = (host, host);
    for node in host.descendants() {
        let bits = looks(
            cx,
            node,
            Looks::RENDERED | Looks::KEEPS_BREAKS | Looks::EDITABLE | Looks::BLOCK,
        );
        let place = || Point {
            node: node.parent().unwrap_or(host),
            offset: node.index(),
        };
        match node.html_tag() {
            _ if node.is_text()
                && bits.contains(Looks::RENDERED)
                && node.length() > 0
                && (bits.contains(Looks::KEEPS_BREAKS) || !is_blank(node)) =>
            {
                near = node;
                break;
            }
            _ if !node.is_element() => {}
            tag if tag == atom!("hr") || !bits.contains(Looks::EDITABLE) => {
                return if block.contains(node) {
                    Point {
                        node: block,
                        offset: 0,
                    }
                } else {
                    place()
                };
            }
            atom!("br") if bits.contains(Looks::RENDERED) => return place(),
            atom!("audio")
            | atom!("button")
            | atom!("canvas")
            | atom!("embed")
            | atom!("iframe")
            | atom!("img")
            | atom!("input") => break,
            atom!("meter")
            | atom!("object")
            | atom!("progress")
            | atom!("select")
            | atom!("textarea")
            | atom!("video") => break,
            _ if !node.is_html_element() => break,
            _ if bits.contains(Looks::BLOCK) => block = node,
            _ => {}
        }
    }
    moved_from(
        cx,
        host,
        Point {
            node: near,
            offset: 0,
        },
        Direction::Forward,
        Reach::Nearest,
    )
}

pub(crate) fn select_on_focus<'a>(cx: &mut Cx<'a>, element: &'a Element, is_from_keyboard: bool) {
    if let Some(control) = text_control(element) {
        element.doc().sync(cx);
        if is_from_keyboard && element.is_html(atom!("input")) {
            control.select_all(cx);
        }
        return control.show_selection(cx);
    }
    let selection = range::selection_of(&cx.heap, element.doc());
    if is_editing_host(cx, element)
        && !selection
            .range()
            .is_some_and(|it| element.contains(it.start().node))
    {
        let caret = first_caret_in(cx, element);
        selection.collapse(cx, caret);
    }
}

/// Whether that is all there is to reveal.
pub(crate) fn reveal_caret_in<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    let Some((ui, range)) = Ui::of(element.doc()).and_then(|it| Some((it, selected(it)?))) else {
        return false;
    };
    if text_control(element).is_none() && editing_host(cx, range.start().node) != Some(element) {
        return false;
    }
    reveal(cx, ui);
    !element.is_html(atom!("input"))
}

/// The last or the first of the positions that the caret shows in the same place.
fn outermost<'a>(
    cx: &mut Cx<'a>,
    root: &'a Node,
    mut point: Point<'a>,
    is_forward: bool,
) -> Point<'a> {
    let is_block =
        |cx: &mut Cx<'a>, it: &'a Node| it.is_element() && looks_like(cx, it, Looks::BLOCK);
    let shown = |cx: &mut Cx<'a>, from: Option<&'a Node>, is_forward: bool| {
        let mut all = core::iter::successors(from, |it| {
            if is_forward {
                it.next_sibling()
            } else {
                it.previous_sibling()
            }
        });
        all.find(|it| {
            it.is_element()
                || it.is_text() && (!is_blank(it) || looks_like(cx, it, Looks::KEEPS_BREAKS))
        })
    };
    let mut found = point;
    loop {
        let node = point.node;
        if node.is_text() && point.offset != if is_forward { node.length() } else { 0 } {
            return point;
        }
        let after = node.child_at(point.offset);
        let before = after.map_or_else(|| node.last_child(), Node::previous_sibling);
        let (ahead, behind) = if is_forward {
            (after, before)
        } else {
            (before, after)
        };
        let Some(next) = shown(cx, ahead, is_forward) else {
            let Some(parent) = node
                .parent()
                .filter(|_| node != root && !is_block(cx, node))
            else {
                return found;
            };
            point = Point {
                node: parent,
                offset: node.index() + u32::from(is_forward),
            };
            continue;
        };
        if is_block(cx, next) {
            if next.first_child().is_none()
                || found.node.is_text()
                || shown(cx, behind, !is_forward).is_some_and(|it| !is_block(cx, it))
            {
                return found;
            }
        } else if next.is_element()
            && (next.first_child().is_none() || !looks_like(cx, next, Looks::EDITABLE))
        {
            return Point {
                node,
                offset: next.index() + u32::from(!is_forward),
            };
        }
        point = Point {
            node: next,
            offset: if is_forward { 0 } else { next.length() },
        };
        if next.is_text() {
            found = point;
        }
    }
}

/// With its ends where the first and the last of what it shows are.
pub(super) fn tighten<'a>(cx: &mut Cx<'a>, span @ [start, end]: Span<'a>) -> Span<'a> {
    if start.node.is_text() && start.node == end.node {
        return span;
    }
    let root = selection_root(cx, start.node);
    let keeps_end =
        end.node.is_element() && end.offset == 0 && looks_like(cx, end.node, Looks::BLOCK);
    let tight = [
        outermost(cx, root, start, true),
        if keeps_end {
            end
        } else {
            outermost(cx, root, end, false)
        },
    ];
    if range::compare_composed(tight[0], tight[1]).is_gt() {
        span
    } else {
        tight
    }
}

pub(crate) fn changed<'a>(cx: &mut Cx<'a>, ui: &'a Ui, selection: &'a Selection) {
    let control = selection
        .range()
        .and_then(|range| Some((range, text_control(range.start().node.out_of_control())?)));
    if let Some((range, control)) = control {
        control.read_selection(range, selection.is_backward());
    }
    ui.editing.note_selection();
    let target: &Node = control.map_or_else(|| &**ui.doc(), |it| it.1.element);
    schedule_selection_events(cx, ui, target);
    looks_changed(cx, ui);
}

pub(crate) fn looks_changed<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    ui.editing.is_selection_unsent.set(true);
    ui.doc().set_needs_sync();
    ui.doc().invalidate(cx);
}

pub(crate) fn schedule_selection_events<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Node) {
    let waiting = ui.changed_selections();
    if waiting.is_empty() {
        host::queue_task(cx, ui.doc(), [ui.value()], |cx, [ui]| {
            _ = Ui::from_value(ui).map(|it| fire_selection_events(cx, it))
        });
    }
    if ui.editing.changed_selections.borrow_mut().insert(target) {
        ui.set_changed_selections(waiting.followed_by(&cx.heap, target));
    }
}

fn fire_selection_events<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let (targets, doc): (_, &Node) = (ui.changed_selections(), ui.doc());
    ui.set_changed_selections(Refs::default());
    let has_doc = ui
        .editing
        .changed_selections
        .take()
        .contains(&core::ptr::from_ref(doc));
    for target in targets.iter() {
        let control = text_control(target);
        if target.scope().is_none_or(|it| it == doc) {
            fire(
                cx,
                target,
                atom!("selectionchange"),
                EventInit {
                    bubbles: control.is_some(),
                    ..PLAIN
                },
            );
        } else if !has_doc {
            fire(cx, doc, atom!("selectionchange"), PLAIN);
        }
        if control.is_some_and(|it| it.take_select_event()) {
            fire(cx, target, atom!("select"), BUBBLES);
        }
    }
}

/// To the engine.
pub(crate) fn send<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let selection = range::try_selection(ui.doc());
    let span = selection
        .and_then(Selection::span)
        .filter(|it| it.start().node.is_connected() && !is_in_idle_control(ui, it.start().node));
    let has_caret = span.is_some_and(|it| it.collapsed())
        && ui.is_focused.get()
        && typing_target(cx, ui).is_some();
    let points = span.map(|it| range::ends_for_engine(it.start(), it.end()));
    ui.doc().engine(|engine, _| {
        engine.set_selection(
            points,
            has_caret.then(|| selection.is_some_and(Selection::is_upstream)),
        )
    });
}

pub(crate) fn before_frame<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    send(cx, ui);
    if let Some(it) = ui.spelling() {
        it.before_frame(cx, ui);
    }
    if range::try_selection(ui.doc()).is_some()
        && ui.focused_frame().is_none()
        && input_method::update(cx, ui)
    {
        spelling::caret_or_text_changed(cx, ui);
    }
}
