//! Find in page, `window.find`, and <https://wicg.github.io/scroll-to-text-fragment/>

use bun_jsc::bindgen::{JsInterface, JsScope};

use crate::api::core::*;
use crate::api::range::{Point, Range, compare_composed, from_engine, selection_of};
use crate::editing;
use crate::generated_bindgen::find::{Found, FoundRect};
use crate::name::name;
use crate::scroll::Alignment;
use crate::values::text as to_str;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

fn points(doc: &Doc, range: editing::Range) -> Option<[Point<'_>; 2]> {
    let [[a, b], [c, d]] = doc.engine(|engine, _| range.map(|it| engine.for_script(it)));
    Some([from_engine(doc, a, b)?, from_engine(doc, c, d)?])
}

fn show_matches<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    matches: Vec<editing::Range>,
    active: Option<editing::Range>,
) {
    doc.engine(|engine, _| {
        engine.mark_ranges(
            editing::Mark::Highlight(name!("-internal-match")),
            -2,
            matches,
        );
        engine.mark_ranges(
            editing::Mark::Highlight(name!("-internal-active-match")),
            -1,
            active.into_iter().collect(),
        );
    });
    doc.invalidate(cx);
}

fn active_match<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> Option<&'a Range> {
    Range::from_js(&cx.heap, doc.edge(Edge::ActiveMatch)?)
}

pub(crate) fn find_in_page<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    text: &[u8],
    forward: bool,
    find_next: bool,
    match_case: bool,
    zoom: f64,
) -> Found {
    let matches = doc.synced_engine(cx, |engine, _| engine.find_text(to_str(text), match_case));
    let index = active_match(cx, doc).map_or(0, |previous| {
        let order = |it: &editing::Range| {
            points(doc, *it).map(|it| compare_composed(it[0], previous.start()))
        };
        let is_next = |it| {
            order(it).is_some_and(|it| {
                if it.is_eq() {
                    find_next
                } else {
                    it.is_gt() == forward
                }
            })
        };
        match forward {
            true => matches.iter().position(is_next).unwrap_or(0),
            false => matches
                .iter()
                .rposition(is_next)
                .unwrap_or_else(|| matches.len().saturating_sub(1)),
        }
    });
    let (count, active) = (matches.len() as u32, matches.get(index).copied());
    match active.and_then(|it| points(doc, it)) {
        Some([start, end]) => doc.set_edge(
            &cx.heap,
            Edge::ActiveMatch,
            Range::new(&cx.heap, start, end).to_js(),
        ),
        None => doc.clear_edge(&cx.heap, Edge::ActiveMatch),
    }
    show_matches(cx, doc, matches, active);
    let [x, y, width, height] = doc
        .engine(|engine, _| {
            let active = active?;
            engine.reveal_caret(active[0], false, Alignment::Nearest);
            Some(
                engine
                    .range_rects(&active)
                    .first()?
                    .to_array()
                    .map(|it| (f64::from(it) * zoom).round()),
            )
        })
        .unwrap_or_default();
    Found {
        matches: count,
        active: active.map_or(0, |_| index as u32 + 1),
        rect: FoundRect {
            x,
            y,
            width,
            height,
        },
    }
}

pub(crate) fn stop_finding<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, keeps_selection: bool) {
    let active = active_match(cx, doc);
    doc.clear_edge(&cx.heap, Edge::ActiveMatch);
    show_matches(cx, doc, Vec::new(), None);
    if let Some(active) =
        active.filter(|it| keeps_selection && !it.collapsed() && it.start().node.is_connected())
    {
        selection_of(&cx.heap, doc).select(cx, active.start(), active.end());
    }
}

/// `window.find`
pub(crate) fn find_and_select<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    text: &[u8],
    match_case: bool,
    is_backward: bool,
    wraps: bool,
) -> bool {
    let mut matches = doc.synced_engine(cx, |engine, _| engine.find_text(to_str(text), match_case));
    if is_backward {
        matches.reverse();
    }
    let selection = selection_of(&cx.heap, doc);
    let is_beyond = |it: &&editing::Range| match (selection.span(), points(doc, **it)) {
        (Some(span), Some([_, end])) if is_backward => compare_composed(end, span.start()).is_le(),
        (Some(span), Some([start, _])) => compare_composed(start, span.end()).is_ge(),
        _ => true,
    };
    let found = matches
        .iter()
        .find(is_beyond)
        .or_else(|| matches.first().filter(|_| wraps));
    let Some((found, [start, end])) = found.and_then(|it| Some((*it, points(doc, *it)?))) else {
        return false;
    };
    selection.select(cx, start, end);
    doc.engine(|engine, _| engine.reveal_caret(found[0], false, Alignment::Nearest));
    true
}

/// Whether something was found.
pub(crate) fn show_text_fragment<'a>(
    cx: Cx<'_, 'a>,
    doc: &'a Doc,
    directives: &[u8],
    scrolls: bool,
) -> bool {
    let ranges = doc.synced_engine(cx, |engine, _| engine.find_text_directives(directives));
    let first = ranges.first().copied();
    doc.engine(|engine, _| {
        engine.mark_ranges(
            editing::Mark::Highlight(name!("::target-text")),
            i32::MAX,
            ranges,
        )
    });
    doc.invalidate(cx);
    let Some((first, [start, end])) = first.and_then(|it| Some((it, points(doc, it)?))) else {
        return false;
    };
    let target = core::iter::successors(start.node.flat_parent(), |it| it.flat_parent())
        .find(|it| it.contains_flat(end.node));
    crate::api::history::indicate_text(cx, doc, target, start.node);
    if scrolls && start.node.is_rendered() {
        doc.synced_engine(cx, |engine, _| {
            engine.reveal_caret(first[0], false, Alignment::Center)
        });
        doc.invalidate(cx);
    }
    true
}
