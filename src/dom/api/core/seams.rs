//! What the tree needs of the rest.

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsScope};

use super::steps::AttrChange;
use super::*;
use crate::api::events::WindowTarget;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

pub(crate) use crate::api::cssom::{flush_style, shadow_root_rendered, shadow_root_unrendered};
pub(crate) use crate::api::ui::seams::{
    after_move, autofocus_inserted, before_move, before_remove, id_changed, is_left_alone,
    make_form_associated, show_controls, slotted_first,
};

// ───────────────────────────── steps ─────────────────────────────

macro_rules! step {
    ($cx:ident, $node:ident, $step:ident($($argument:expr),*)) => {
        if let (Some(step), Some(element)) = ($node.kind().steps().$step, $node.as_element()) {
            step($cx, element $(, $argument)*);
        }
    };
}

pub(crate) fn created<'a>(heap: &JsHeap<'a>, element: &'a Element) {
    if let Some(step) = element.kind().steps().created {
        step(heap, element);
    }
}

pub(crate) fn ua_shadow<'a>(cx: Cx<'_, 'a>, element: &'a Element) {
    if let Some(step) = element.kind().steps().ua_shadow {
        step(cx, element);
    }
}

pub(crate) fn attribute_changed<'a>(cx: Cx<'_, 'a>, element: &'a Element, change: &AttrChange<'_>) {
    if let Some(step) = element.kind().steps().attribute_changed {
        step(cx, element, change);
    }
}

pub(crate) fn post_connection<'a>(cx: Cx<'_, 'a>, nodes: &Rooted<'a>, is_move: bool) {
    nodes
        .iter()
        .for_each(|it| it.set(NodeFlags::AWAITS_CONNECTION_STEPS));
    let is_style = |it: &&Node| matches!(it.kind(), Kind::Style | Kind::SvgStyle | Kind::Link);
    for node in nodes
        .iter()
        .filter(is_style)
        .chain(nodes.iter().filter(|it| !is_style(it)))
    {
        node.unset(NodeFlags::AWAITS_CONNECTION_STEPS);
        if node.is_connected() {
            step!(cx, node, post_connection(is_move));
        }
    }
}

pub(crate) fn removed<'a>(cx: Cx<'_, 'a>, node: &'a Node, scope: &'a Node, is_move: bool) {
    step!(cx, node, removed(scope, is_move));
    crate::api::ui::seams::removed(cx, node, is_move);
}

pub(crate) fn parent_changed<'a>(cx: Cx<'_, 'a>, child: &'a Node, old: Option<&'a Node>) {
    match child.kind() {
        Kind::Instruction => crate::api::loading::instruction_moved(cx, child, old),
        _ => step!(cx, child, parent_changed(old)),
    }
}

/// From or to `parent`.
#[inline]
pub(crate) fn child_moved<'a>(cx: Cx<'_, 'a>, parent: &'a Node, child: &'a Node) {
    if parent.has(NodeFlags::IN_SELECT) || parent.kind() == Kind::Select {
        crate::api::forms::select::descendant_moved(cx, child);
    }
}

pub(crate) fn children_changed<'a>(cx: Cx<'_, 'a>, parent: &'a Node, is_move: bool) {
    if parent.has(NodeFlags::IN_SELECT) {
        crate::api::forms::select::contents_changed(cx, parent);
    }
    step!(cx, parent, children_changed(is_move));
}

pub(crate) fn finished_parsing<'a>(cx: Cx<'_, 'a>, node: &'a Node) {
    step!(cx, node, finished_parsing());
}

pub(crate) fn cloned<'a>(cx: Cx<'_, 'a>, from: &'a Node, to: &'a Node, subtree: bool) {
    if let (Some(step), Some(from), Some(to)) = (
        from.kind().steps().cloned,
        from.as_element(),
        to.as_element(),
    ) {
        step(cx, from, to, subtree);
    }
}

pub(crate) fn adopted<'a>(cx: Cx<'_, 'a>, node: &'a Node, old: &'a Doc) {
    crate::api::range::live::adopted(node);
    crate::api::cssom::scope_adopted(cx, node, old);
    if let (Some(step), Some(element)) = (node.kind().steps().adopted, node.as_element()) {
        step(cx, element, old);
    }
}

pub(crate) fn rendered<'a>(cx: Cx<'_, 'a>, element: &'a Element) {
    if let Some(step) = element.kind().steps().rendered {
        step(cx, element);
    }
}

// ───────────────────────────── creation ─────────────────────────────

/// That of the window that is calling.
pub(crate) fn current_document<'a>(cx: Cx<'_, 'a>) -> bindgen::Result<'a, &'a Doc> {
    let Some(scope) = WindowTarget::of_realm_or_program(&cx.heap) else {
        return Err(cx.heap.type_error(format_args!("There is no document.")));
    };
    Ok(scope
        .doc()
        .unwrap_or_else(|| Agent::of(&cx.heap).scratch(cx, scope.base_url())))
}

// ───────────────────────────── markup ─────────────────────────────

/// `registry_from`: what has the custom element registry.
pub(crate) fn parse_fragment<'a>(
    cx: Cx<'_, 'a>,
    context: &'a Element,
    markup: &DomString,
    registry_from: &'a Node,
) -> bindgen::Result<'a, &'a Node> {
    crate::api::markup::parse_fragment(cx, context, markup, registry_from, Default::default())
}

pub(crate) fn serialize_inner<'a>(cx: Cx<'_, 'a>, node: &'a Node) -> bindgen::Result<'a, JSValue> {
    Ok(crate::api::markup::serialize_inner(cx, node)?
        .to_js(&cx.heap)
        .to_js())
}

pub(crate) fn serialize_outer<'a>(cx: Cx<'_, 'a>, node: &'a Node) -> bindgen::Result<'a, JSValue> {
    Ok(crate::api::markup::serialize_outer(cx, node)?
        .to_js(&cx.heap)
        .to_js())
}

pub(crate) use crate::api::range::live::{
    after_insert as ranges_after_insert, after_replace_data as ranges_after_replace_data,
    after_split as ranges_after_split, before_merge as ranges_before_merge,
    before_remove as ranges_before_remove,
};
