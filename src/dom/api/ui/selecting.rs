//! Selecting with the mouse.

use super::layout::{By, Direction, ScrollUnit, Unit};
use super::pointer::{Tracking, chain_of};
use super::prelude::*;
use crate::api::editing;
use crate::api::forms::text_control;
use crate::api::uievents::Modifiers;

/// What was selected by the press is between these offsets of `Pointer::selection_first` and `selection_last`.
#[derive(Clone, Copy)]
pub(crate) struct Extent {
    unit: Option<Unit>,
    offsets: [u32; 2],
}

pub(super) fn is_over_selection<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> bool {
    let Some(span) = range::try_selection(ui.doc())
        .and_then(Selection::span)
        .filter(|it| !it.collapsed())
    else {
        return false;
    };
    let (root, at) = (
        editing::selection_root(cx, span.start().node),
        ui.pointer().at.get(),
    );
    let Some(hit) = layout::hit_test(cx, ui.doc(), at) else {
        return false;
    };
    let root = if root.contains_flat(hit) {
        root
    } else {
        editing::selection_root(cx, hit)
    };
    let is_between = |it: Point<'a>| {
        range::compare_composed(span.start(), it).is_le()
            && range::compare_composed(it, span.end()).is_le()
    };
    layout::caret_at(cx, root, at).is_some_and(|it| is_between(it.point))
}

/// And not beside it.
fn is_on_selection<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> bool {
    let (span, at) = (
        range::try_selection(ui.doc()).and_then(Selection::span),
        ui.pointer().at.get(),
    );
    layout::hit_test(cx, ui.doc(), at).is_some_and(|it| it.is_text() || it.first_child().is_none())
        && span.is_some_and(|it| is_within(cx, [it.start(), it.end()], at))
}

fn is_within<'a>(cx: &mut Cx<'a>, [start, end]: [Point<'a>; 2], point: [f64; 2]) -> bool {
    layout::range_rects(cx, start, end)
        .iter()
        .any(|it| it.contains(layout::narrow(point)))
}

pub(super) fn is_link(element: &Element) -> bool {
    element.is_html(atom!("a")) && element.has_attr(atom!("href"))
}

fn around<'a>(
    cx: &mut Cx<'a>,
    root: &'a Node,
    point: Point<'a>,
    unit: Option<Unit>,
) -> [Point<'a>; 2] {
    unit.map_or([point; 2], |it| layout::expand(cx, root, point, it))
}

pub(super) fn start<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Element, button: i16) {
    let (pointer, control) = (ui.pointer(), target.out_of_control());
    let bits = looks(
        cx,
        target,
        Looks::EDITABLE | Looks::UNSELECTABLE | Looks::SELECTS_ALL,
    );
    let is_editable = bits.contains(Looks::EDITABLE);
    let is_selectable = match text_control(control) {
        Some(_) => super::mouse::disabled_control_above(target).is_none(),
        None => {
            control == &**target
                && !target.is_html(atom!("button"))
                && (is_editable || !bits.contains(Looks::UNSELECTABLE))
        }
    };
    if !is_selectable
        || !target.is_connected()
        || !is_editable && matches!(target.html_tag(), atom!("canvas") | atom!("img"))
    {
        return;
    }
    let (is_over, has_shift) = (
        is_over_selection(cx, ui),
        pointer.modifiers.get().contains(Modifiers::SHIFT),
    );
    if is_over && button != 0 {
        return;
    }
    if is_over && pointer.clicks.get() == 1 && !has_shift && is_on_selection(cx, ui) {
        return pointer.may_drag_selection.set(true);
    }
    if !fire(
        cx,
        control,
        atom!("selectstart"),
        EventInit {
            cancelable: true,
            ..BUBBLES
        },
    ) {
        return;
    }
    let selection = range::selection_of(&cx.heap, ui.doc());
    if bits.contains(Looks::SELECTS_ALL) && !is_editable {
        let above = target
            .ancestors()
            .take_while(|it| it.is_element() && looks_like(cx, it, Looks::SELECTS_ALL));
        let node = above.last().unwrap_or(target);
        return selection.select(
            cx,
            Point { node, offset: 0 },
            Point {
                node,
                offset: node.length(),
            },
        );
    }
    let root = editing::selection_root(cx, target);
    let Some(hit) = layout::caret_at(cx, root, pointer.at.get()) else {
        return selection.clear(cx);
    };
    let is_in_link = pointer.pressed().iter().any(is_link);
    let unit = match pointer.clicks.get() {
        ..=1 => None,
        2 => Some(Unit::Word),
        _ => Some(Unit::Paragraph),
    };
    let extends = has_shift
        && !is_in_link
        && selection
            .range()
            .is_some_and(|it| editing::selection_root(cx, it.start().node) == root);
    let [first, last] = selection
        .anchor_and_focus()
        .map(|it| it[0])
        .filter(|_| extends)
        .map_or_else(|| around(cx, root, hit.point, unit), |it| [it; 2]);
    let extent = Extent {
        unit,
        offsets: [first.offset, last.offset],
    };
    pointer.track(Tracking::Selection(extent), root);
    pointer.set_selection_first(Some(first.node));
    pointer.set_selection_last(Some(last.node));
    extend(cx, ui, extent);
    if button == 0 {
        pointer.set_autoscrolls(Some(if root.as_doc().is_some() {
            target
        } else {
            root
        }));
    } else {
        pointer.stop_tracking();
    }
}

/// The link or the word under the pointer.
pub(super) fn select_for_context_menu<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Element) {
    let at = ui.pointer().at.get();
    let bits = looks(cx, target, Looks::EDITABLE | Looks::UNSELECTABLE);
    let is_on_text = layout::hit_test(cx, ui.doc(), at).is_some_and(|it| it.is_text());
    if !is_on_text || bits == Looks::UNSELECTABLE || is_over_selection(cx, ui) {
        return;
    }
    if !fire(
        cx,
        target.out_of_control(),
        atom!("selectstart"),
        EventInit {
            cancelable: true,
            ..BUBBLES
        },
    ) || !target.is_connected()
    {
        return;
    }
    let link = chain_of(Some(target))
        .find(|it| is_link(it))
        .filter(|_| !bits.contains(Looks::EDITABLE));
    let root = editing::selection_root(cx, target);
    let mut word = || {
        let caret = layout::caret_at(cx, root, at)?;
        let after = layout::expand(cx, root, caret.point, Unit::Word);
        if is_within(cx, after, at) {
            return Some(after);
        }
        let before = layout::move_caret(cx, root, caret, Direction::Backward, By::Character, 0.0)?;
        Some(layout::expand(cx, root, before.point, Unit::Word))
    };
    if let Some([start, end]) = link
        .map(|it| [Point::new(it, 0), Point::at_end_of(it)])
        .or_else(&mut word)
    {
        range::selection_of(&cx.heap, ui.doc()).select(cx, start, end);
    }
}

pub(super) fn extend<'a>(cx: &mut Cx<'a>, ui: &'a Ui, extent: Extent) {
    let pointer = ui.pointer();
    let (Some(root), Some(first), Some(last)) = (
        pointer.tracked(),
        pointer.selection_first(),
        pointer.selection_last(),
    ) else {
        return;
    };
    if ![root, first, last].iter().all(|it| it.is_connected()) {
        return;
    }
    let Some(found) = layout::caret_at(cx, root, pointer.at.get()) else {
        return;
    };
    let expected = if root.has(NodeFlags::USER_AGENT) {
        root.out_of_control()
    } else {
        found.point.node
    };
    if found.point.node.out_of_control() != expected {
        return;
    }
    let (first, last) = (
        Point::new(first, extent.offsets[0].min(first.length())),
        Point::new(last, extent.offsets[1].min(last.length())),
    );
    let [start, end] = around(cx, root, found.point, extent.unit);
    let (anchor, focus) = if range::compare_composed(start, first).is_lt() {
        (last, start)
    } else {
        (first, end)
    };
    range::selection_of(&cx.heap, ui.doc()).select_with_affinity(
        cx,
        anchor,
        focus,
        found.is_upstream,
    );
}

/// Once per frame, while the mouse selects or drags beyond the edge of what scrolls. True if it has scrolled.
pub(crate) fn autoscroll<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> bool {
    let pointer = ui.pointer();
    let is_dragging = pointer.drag.get().is_some();
    let origin = if is_dragging {
        pointer.drag_over().map(|it| &**it)
    } else {
        pointer.autoscrolls()
    };
    let Some(origin) = origin.filter(|it| it.is_connected()) else {
        return false;
    };
    let is_part = |it: &Node| it.has(NodeFlags::USER_AGENT);
    let scroller = origin
        .flat_ancestors()
        .take_while(|it| it.is_element())
        .find(|it| is_part(it) || looks_like(cx, it, Looks::SCROLLS));
    let [width, height] = layout::viewport_size(ui.doc());
    let rect = scroller.map_or_else(
        || crate::abi::Rect::new([0.0, 0.0, width, height]),
        |it| layout::bounding_rect(cx, it),
    );
    let margin = if is_dragging || scroller.is_none() {
        20.0
    } else {
        0.0
    };
    let delta = [0, 1].map(|axis| {
        let (at, [start, end]) = (pointer.at.get()[axis], rect.span(axis).map(f64::from));
        ((at - start - margin).min(0.0) + (at - end + margin).max(0.0)) / 2.0
    });
    if delta == [0.0; 2] {
        return false;
    }
    match scroller {
        Some(part) if is_part(part) => layout::scroll_by(cx, part, delta),
        _ if layout::user_scroll(
            cx,
            scroller.unwrap_or(origin),
            delta,
            ScrollUnit::Pixel,
            false,
        ) => {}
        _ => return false,
    }
    super::mouse::follow(cx, ui);
    true
}
