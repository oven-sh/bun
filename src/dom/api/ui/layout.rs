//! What the user interface asks of styles and of the layout. Nodes that are not rendered by a window get the defaults.

use super::prelude::*;
use crate::abi::Rect;
use crate::document::Document;
use crate::properties::{Prop, Style};
use crate::scroll::{Alignment, Revealed};
use crate::selector::Pseudo;
use crate::tree::NodeId;

bitflags::bitflags! {
    /// Of `Document::style_bits`.
    #[derive(Clone, Copy, Default, PartialEq, Eq)]
    pub(crate) struct Looks: u32 {
        const RENDERED = 1;
        const VISIBLE = 1 << 1;
        const EDITABLE = 1 << 2;
        const PLAIN_TEXT = 1 << 3;
        const INERT = 1 << 4;
        const SCROLLS = 1 << 5;
        const CONTENTS = 1 << 6;
        const SKIPPED = 1 << 8;
        const UNSELECTABLE = 1 << 9;
        const SELECTS_ALL = 1 << 10;
        const BLOCK = 1 << 11;
        const RTL = 1 << 12;
        const KEEPS_SPACES = 1 << 13;
        const HIDDEN_CONTENTS = 1 << 14;
        const KEEPS_BREAKS = 1 << 15;
        const READING_FLOW = 1 << 16;
    }
}

fn is_shown(node: &Node) -> bool {
    node.is_connected() && Ui::of(node.doc()).is_some()
}

fn ask<'a, R: Default>(
    cx: &mut Cx<'a>,
    node: &'a Node,
    question: impl FnOnce(&mut Document, NodeId) -> R,
) -> R {
    if is_shown(node) {
        node.synced_engine(cx, question)
    } else {
        R::default()
    }
}

pub(crate) fn laid_out<'a, R: Default>(
    cx: &mut Cx<'a>,
    node: &'a Node,
    question: impl FnOnce(&mut Document, NodeId) -> R,
) -> R {
    ask(cx, node, |engine, id| {
        engine.catch_up_with_compositor();
        engine.update_layout_for(id);
        question(engine, id)
    })
}

pub(crate) fn painted<'a, R: Default>(
    cx: &mut Cx<'a>,
    node: &'a Node,
    question: impl FnOnce(&mut Document, NodeId) -> R,
) -> R {
    ask(cx, node, |engine, id| {
        engine.update_hits();
        question(engine, id)
    })
}

pub(crate) fn looks<'a>(cx: &mut Cx<'a>, node: &'a Node, wanted: Looks) -> Looks {
    ask(cx, node, |engine, id| {
        Looks::from_bits_retain(engine.current_style_bits(id, wanted.bits()))
    })
}

/// Whether it has any of them.
pub(crate) fn looks_like<'a>(cx: &mut Cx<'a>, node: &'a Node, wanted: Looks) -> bool {
    !looks(cx, node, wanted).is_empty()
}

pub(crate) fn style<'a, R>(
    cx: &mut Cx<'a>,
    node: &'a Element,
    read: impl FnOnce(&Style) -> R,
) -> Option<R> {
    ask(cx, node, |engine, id| engine.with_computed_style(id, read))
}

/// The resolved value, as `getComputedStyle()` has it.
pub(crate) fn computed<'a>(cx: &mut Cx<'a>, node: &'a Element, property: &str) -> Vec<u8> {
    ask(cx, node, |engine, id| {
        Prop::from_name(property.as_bytes()).map_or(Vec::new(), |it| {
            engine.computed_style(id, Pseudo::None, it, true)
        })
    })
}

pub(crate) fn bounding_rect<'a>(cx: &mut Cx<'a>, node: &'a Node) -> Rect {
    laid_out(cx, node, |engine, id| engine.bounding_rect(id))
}

pub(crate) fn hit_test<'a>(cx: &mut Cx<'a>, doc: &'a Doc, point: [f64; 2]) -> Option<&'a Node> {
    doc.rendered_node(painted(cx, doc, |engine, _| engine.hit_test(narrow(point))))
}

pub(crate) fn narrow(point: [f64; 2]) -> [f32; 2] {
    point.map(|it| it as f32)
}

/// Relative to the padding box.
pub(crate) fn offset_in<'a>(cx: &mut Cx<'a>, node: &'a Node, point: [f64; 2]) -> [f64; 2] {
    laid_out(cx, node, |engine, id| {
        let ([x, y], [left, top, ..]) = (
            engine.to_local(engine.holder_of_lines(id), point),
            engine.client_metrics(id),
        );
        [x - f64::from(left), y - f64::from(top)]
    })
}

pub(crate) fn viewport_scroll(doc: &Doc) -> [f64; 2] {
    doc.engine(|engine, id| engine.scroll_position(id).map(f64::from))
}

#[derive(Clone, Copy)]
pub(crate) enum ScrollUnit {
    Pixel,
    Line,
    Page,
    Document,
}

/// Whether something has scrolled.
pub(crate) fn user_scroll<'a>(
    cx: &mut Cx<'a>,
    from: &'a Node,
    delta: [f64; 2],
    unit: ScrollUnit,
    is_smooth: bool,
) -> bool {
    laid_out(cx, from, |engine, id| {
        engine.user_scroll(id, narrow(delta), unit as u8, is_smooth) != 0
    })
}

pub(crate) fn scroll_into_view<'a>(cx: &mut Cx<'a>, node: &'a Element, align: Alignment) {
    ask(cx, node, |engine, id| {
        engine.scroll_into_view_for_script(id, [align; 2], 0, crate::scroll::Scrollers::All, false)
    });
    node.doc().invalidate(cx);
}

#[derive(Clone, Copy)]
pub(crate) enum ScrollbarMouse {
    Move,
    Down,
    Up,
    Leave,
}

pub(crate) enum ScrollPart {
    None,
    Bar(NodeId),
    /// A scroll marker or a scroll button.
    Control(NodeId),
    Resizer(NodeId),
}

pub(crate) const SCROLL_CONTROL: u32 = 1 << 30;

pub(crate) fn scrollbar_mouse<'a>(
    cx: &mut Cx<'a>,
    doc: &'a Doc,
    action: ScrollbarMouse,
    point: [f64; 2],
) -> ScrollPart {
    const RESIZER: u32 = 1 << 31;
    match painted(cx, doc, |engine, _| {
        engine.scrollbar_mouse(action as u8, narrow(point))
    }) {
        0 => ScrollPart::None,
        id @ RESIZER.. => ScrollPart::Resizer(id - RESIZER),
        id @ SCROLL_CONTROL.. => ScrollPart::Control(id - SCROLL_CONTROL),
        id => ScrollPart::Bar(id),
    }
}

pub(crate) fn cursor_at<'a>(cx: &mut Cx<'a>, doc: &'a Doc, point: [f64; 2]) -> &'static str {
    painted(cx, doc, |engine, _| engine.cursor_at(narrow(point)))
}

#[derive(Clone, Copy)]
pub(crate) struct Caret<'a> {
    pub(crate) point: Point<'a>,
    /// At a soft wrap, it is at the end of the first line.
    pub(crate) is_upstream: bool,
}

fn caret(doc: &Doc, found: Option<([u32; 2], bool)>) -> Option<Caret<'_>> {
    let ([id, offset], is_upstream) = found.filter(|it| it.0[0] != 0)?;
    Some(Caret {
        point: range::from_engine(doc, id, offset)?,
        is_upstream,
    })
}

pub(crate) fn caret_at<'a>(cx: &mut Cx<'a>, root: &'a Node, point: [f64; 2]) -> Option<Caret<'a>> {
    let found = painted(cx, root, |engine, id| {
        engine
            .point_at(id, narrow(point))
            .map(|it| (engine.for_script(it.0), it.1))
    });
    caret(root.doc(), found)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Direction {
    Forward,
    Backward,
    Left,
    Right,
}

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd)]
pub(crate) enum By {
    Character,
    Word,
    Line,
    LineBoundary,
    Paragraph,
    ParagraphBoundary,
    DocumentBoundary,
    Page,
    Nearest,
}

/// `x` is where a caret that moves up and down tries to stay.
pub(crate) fn move_caret<'a>(
    cx: &mut Cx<'a>,
    root: &'a Node,
    from: Caret<'a>,
    direction: Direction,
    by: By,
    x: f32,
) -> Option<Caret<'a>> {
    let (node, offset) = range::to_engine(from.point);
    let found = laid_out(cx, root, |engine, id| {
        let moved = engine.move_point(
            id,
            engine.point(node, offset),
            from.is_upstream,
            direction as u8,
            by as u8,
            x,
        );
        moved.map(|it| (engine.for_script(it.0), it.1))
    });
    caret(root.doc(), found)
}

#[derive(Clone, Copy)]
pub(crate) enum Unit {
    Word,
    Paragraph,
}

pub(crate) fn expand<'a>(
    cx: &mut Cx<'a>,
    root: &'a Node,
    point: Point<'a>,
    unit: Unit,
) -> [Point<'a>; 2] {
    let (node, offset) = range::to_engine(point);
    let found = laid_out(cx, root, |engine, id| {
        Some(
            engine
                .expand_point(id, engine.point(node, offset), unit as u8)?
                .map(|it| engine.for_script(it)),
        )
    });
    found.map_or([point; 2], |it| {
        it.map(|[id, offset]| range::from_engine(root.doc(), id, offset).unwrap_or(point))
    })
}

pub(crate) fn caret_rect<'a>(cx: &mut Cx<'a>, caret: Caret<'a>) -> Option<Rect> {
    let (node, offset) = range::to_engine(caret.point);
    laid_out(cx, caret.point.node, |engine, _| {
        engine
            .caret_rect(engine.point(node, offset), caret.is_upstream)
            .map(|(at, rect)| rect.transformed(&engine.to_viewport(at)))
    })
}

pub(crate) fn reveal_caret<'a>(cx: &mut Cx<'a>, caret: Caret<'a>) {
    let (node, offset) = range::to_engine(caret.point);
    laid_out(cx, caret.point.node, |engine, _| {
        if let Some((at, rect)) = engine.caret_rect(engine.point(node, offset), caret.is_upstream) {
            engine.reveal(
                at,
                rect,
                [Alignment::Nearest; 2],
                1,
                crate::scroll::Scrollers::All,
            );
        }
    });
}

pub(crate) fn reveal_in_frame<'a>(
    cx: &mut Cx<'a>,
    frame: &'a Element,
    Revealed {
        rect,
        align,
        behavior,
    }: Revealed,
) -> Option<Revealed> {
    let revealed = laid_out(cx, frame, |engine, id| {
        let own = engine.own_box(id)?;
        let [x, y, width, height] = engine.content_box(own);
        engine.reveal(
            own,
            rect.intersection(&Rect::new([0.0, 0.0, width, height]))
                .moved([x, y]),
            align,
            behavior,
            crate::scroll::Scrollers::All,
        )
    });
    frame.doc().invalidate(cx);
    revealed
}

pub(crate) fn range_rects<'a>(cx: &mut Cx<'a>, start: Point<'a>, end: Point<'a>) -> Vec<Rect> {
    let ends = range::ends_for_engine(start, end);
    laid_out(cx, start.node, |engine, _| {
        engine.range_rects(&engine.range(ends))
    })
}

pub(crate) fn styled<'a, R: Default>(
    cx: &mut Cx<'a>,
    node: &'a Node,
    question: impl FnOnce(&mut Document, NodeId) -> R,
) -> R {
    ask(cx, node, |engine, id| {
        engine.update_style();
        question(engine, id)
    })
}

pub(crate) fn reveal_in_nearest_scroller<'a>(cx: &mut Cx<'a>, node: &'a Element) {
    ask(cx, node, |engine, id| {
        engine.scroll_into_view_for_script(
            id,
            [Alignment::Nearest; 2],
            1,
            crate::scroll::Scrollers::Nearest,
            false,
        )
    });
    node.doc().invalidate(cx);
}

/// In CSS pixels.
pub(crate) fn viewport_size(doc: &Doc) -> [f32; 2] {
    doc.engine(|engine, _| engine.environment.viewport)
}

pub(crate) fn zoom(doc: &Doc) -> f64 {
    doc.engine(|engine, _| engine.environment.zoom.into())
}

/// Also what the user cannot scroll.
pub(crate) fn scroll_by<'a>(cx: &mut Cx<'a>, node: &'a Node, [x, y]: [f64; 2]) {
    laid_out(cx, node, |engine, id| {
        let ([left, top], zoom) = (engine.scroll_position(id), engine.zoom_of(id));
        engine.scroll_to(
            id,
            [(left + x as f32) * zoom, (top + y as f32) * zoom],
            1,
            false,
        );
    });
}
