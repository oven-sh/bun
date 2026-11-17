//! https://html.spec.whatwg.org/#the-details-element

use super::prelude::*;
use super::top_layer::{Toggled, queue_toggle};
use crate::api::forms::{self, InputType};

pub(crate) fn summary_of(details: &Node) -> Option<&Element> {
    details
        .may_have_below(atom!("summary"))
        .then(|| details.first_html_child(atom!("summary")))?
}

pub(crate) fn is_summary(element: &Element) -> bool {
    element.is_html(atom!("summary"))
        && element
            .parent()
            .is_some_and(|it| it.is_html(atom!("details")) && summary_of(it) == Some(element))
}

pub(crate) fn is_default_summary(element: &Element) -> bool {
    element.has(NodeFlags::USER_AGENT) && element.is_part("-internal-default-summary")
}

fn is_open(details: &Element) -> bool {
    details.has_attr(atom!("open"))
}

fn toggle<'a>(cx: &mut Cx<'a>, details: &'a Element) {
    details.toggle_attr(cx, atom!("open"), !is_open(details));
}

fn other_open_ones_in_group(details: &Element) -> impl Iterator<Item = &Element> {
    let name = details.attr(atom!("name")).filter(|it| !it.is_empty());
    let candidates = name
        .is_some()
        .then(|| details.root().objects_with_attribute(atom!("open")))
        .into_iter()
        .flatten();
    candidates.filter(move |it| {
        it.kind() == Kind::Details
            && *it != details
            && is_open(it)
            && it.attr(atom!("name")) == name
    })
}

/// https://html.spec.whatwg.org/#interactive-content
fn is_interactive(element: &Element) -> bool {
    match element.html_tag() {
        atom!("a") => element.has_attr(atom!("href")),
        atom!("audio") | atom!("video") => element.has_attr(atom!("controls")),
        atom!("img") => element.has_attr(atom!("usemap")),
        atom!("input") => forms::input_type(element) != Some(InputType::Hidden),
        atom!("button")
        | atom!("details")
        | atom!("embed")
        | atom!("iframe")
        | atom!("label")
        | atom!("select")
        | atom!("textarea") => true,
        _ => false,
    }
}

pub(crate) fn is_in_interactive_content(origin: &Node, within: &Element) -> bool {
    origin
        .out_of_control()
        .inclusive_ancestors()
        .filter_map(Node::as_element)
        .take_while(|it| *it != within)
        .any(is_interactive)
}

fn build<'a>(cx: &mut Cx<'a>, details: &'a Element) {
    let (root, doc) = (details.attach_ua_shadow(cx), details.doc());
    let heap = &cx.heap;
    let [first, fallback, contents] =
        [atom!("slot"), atom!("summary"), atom!("slot")].map(|it| doc.create_html(heap, it));
    root.set_shadow_flags(ShadowFlags::OWN_SLOTTING, true);
    fallback.set_pseudo("-internal-default-summary", details);
    contents.set_pseudo("details-content", details);
    append_detached(
        fallback,
        doc.create_text(heap, DomString::from_latin1(b"Details")),
    );
    append_detached(first, fallback);
    insert(cx, first, root, None, Observers::Suppress);
    insert(cx, contents, root, None, Observers::Suppress);
}

pub(crate) static STEPS: Steps = Steps {
    ua_shadow: Some(build),
    attribute_changed: Some(|cx, details, change| {
        if change.is(atom!("name")) {
            if is_open(details) && other_open_ones_in_group(details).next().is_some() {
                details.remove_attr(cx, atom!("open"));
            }
        } else if change.is(atom!("open")) && change.old.is_some() != change.new.is_some() {
            queue_toggle(
                cx,
                details,
                change.new.is_some(),
                None,
                Toggled::DetailsOrDialog,
            );
            if change.new.is_some() {
                Refs::collect(&cx.heap, other_open_ones_in_group(details))
                    .iter()
                    .for_each(|it| _ = it.remove_attr(cx, atom!("open")));
            }
        }
    }),
    post_connection: Some(|cx, details, _| {
        let is_earlier = |it: &Element| -> bool {
            it.is_connected()
                && (!it.has(NodeFlags::AWAITS_CONNECTION_STEPS)
                    || it.compare_order(details).is_lt())
        };
        if is_open(details) && other_open_ones_in_group(details).any(is_earlier) {
            details.remove_attr(cx, atom!("open"));
        }
    }),
    ..Steps::NONE
};

pub(crate) static SUMMARY_STEPS: Steps = Steps {
    activate: Some(|cx, summary, _, origin, _| {
        let details = match is_default_summary(summary) {
            true => summary.out_of_control().as_element(),
            false => summary
                .parent_element()
                .filter(|_| is_summary(summary) && !is_in_interactive_content(origin, summary)),
        };
        if let Some(details) = details {
            toggle(cx, details);
        }
    }),
    ..Steps::NONE
};

/// https://html.spec.whatwg.org/#ancestor-revealing-algorithm
pub(crate) fn reveal<'a>(cx: &mut Cx<'a>, node: &'a Node) {
    let is_until_found = |it: &Element| it.attr_is(atom!("hidden"), "until-found");
    let (mut hiding, mut are_details) = (Refs::default(), Vec::new());
    for at in core::iter::successors(Some(node), |it| it.flat_parent().or_else(|| it.parent())) {
        let closed = |it: &&Element| {
            it.is_html(atom!("details")) && !is_open(it) && !at.as_element().is_some_and(is_summary)
        };
        for (found, is_details) in [
            (at.as_element().filter(|it| is_until_found(it)), false),
            (at.parent_element().filter(closed), true),
        ] {
            if let Some(found) = found {
                hiding.push(&cx.heap, found);
                are_details.push(is_details);
            }
        }
    }
    for (it, is_details) in hiding.iter().zip(are_details) {
        let still_hides = || {
            it.is_connected()
                && if is_details {
                    !is_open(it)
                } else {
                    is_until_found(it)
                }
        };
        if !still_hides() {
            return;
        }
        if is_details {
            it.toggle_attr(cx, atom!("open"), true);
            continue;
        }
        fire(cx, it, atom!("beforematch"), BUBBLES);
        if !still_hides() {
            return;
        }
        it.remove_attr(cx, atom!("hidden"));
    }
}
