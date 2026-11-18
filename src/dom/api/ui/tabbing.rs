//! https://html.spec.whatwg.org/#sequential-focus-navigation

use super::focus::{self, Cause, is_click_focusable, tab_index};
use super::popover;
use super::prelude::*;
use crate::api::forms;
use crate::name::Map;
use crate::order::Order as _;
use crate::properties::Id;
use crate::tree::NodeId;
use crate::types::{Display, FlexDirection};

/// Where the starting point is, once the node that it was is gone.
#[derive(Clone, Copy, Default, PartialEq, Eq)]
pub(crate) enum Gap {
    #[default]
    None,
    After,
    BeforeFirstChild,
}

pub(crate) fn start_at(ui: &Ui, node: Option<&Node>) {
    ui.set_tab_start(node);
    ui.focus.gap.set(Gap::None);
}

pub(crate) fn start_in_place_of(ui: &Ui, node: &Node) {
    let parent = node.flat_parent().or_else(|| node.parent());
    let previous = match parent.filter(|it| it.has(NodeFlags::SLOT)) {
        Some(slot) => slot.flat_children().take_while(|it| *it != node).last(),
        None => node.previous_sibling(),
    };
    ui.set_tab_start(previous.or(parent));
    ui.focus.gap.set(if previous.is_some() {
        Gap::After
    } else {
        Gap::BeforeFirstChild
    });
}

type Ranks = Map<NodeId, usize>;

fn children_within_reach(parent: &Node) -> impl Iterator<Item = &Node> {
    parent
        .flat_children()
        .take_while(|_| bun_core::StackCheck::init().is_safe_to_recurse())
}

fn items_of<'a>(cx: &mut Cx<'a>, parent: &'a Node, into: &mut Vec<&'a Node>) {
    for child in children_within_reach(parent) {
        if child.as_element().is_some() && looks_like(cx, child, Looks::CONTENTS) {
            items_of(cx, child, into)
        } else {
            into.push(child)
        }
    }
}

#[derive(Clone, Copy, Default)]
struct Item {
    id: NodeId,
    is_out_of_flow: bool,
    order: i32,
    reading_order: i32,
    /// Across the lines, and along them.
    start: [f32; 2],
}

/// https://drafts.csswg.org/css-display-4/#reading-flow
fn reading_ranks<'a>(cx: &mut Cx<'a>, container: &'a Element) -> Option<Ranks> {
    let (flow, display, sides, is_column) = layout::style(cx, container, |it| {
        (
            it.other_if_set(Id::ReadingFlow)
                .unwrap_or_default()
                .to_owned(),
            it.display(),
            it.flow().sides(),
            matches!(
                it.layout.flex_direction,
                FlexDirection::Column | FlexDirection::ColumnReverse
            ),
        )
    })?;
    let applies = match flow.as_str() {
        "source-order" => display != Display::Inline,
        "flex-visual" | "flex-flow" => matches!(display, Display::Flex | Display::InlineFlex),
        _ => matches!(display, Display::Grid | Display::InlineGrid),
    };
    if !applies {
        return None;
    }
    let is_by_column = flow == "grid-columns" || flow == "flex-visual" && is_column;
    let mut nodes = Vec::new();
    items_of(cx, container, &mut nodes);
    let describe = |node: &'a Node| {
        let rect = layout::bounding_rect(cx, node);
        let start = |is_inline: bool| {
            [rect.y, -rect.right(), -rect.bottom(), rect.x][sides[if is_inline { 3 } else { 0 }]]
        };
        let styled = node.as_element().and_then(|it| {
            layout::style(cx, it, |it| Item {
                is_out_of_flow: it.is_out_of_flow(),
                order: it.layout.order,
                reading_order: it
                    .other_if_set(Id::ReadingOrder)
                    .and_then(|it| it.parse().ok())
                    .unwrap_or(0),
                ..Default::default()
            })
        });
        Item {
            id: node.id(),
            start: [start(is_by_column), start(!is_by_column)],
            ..styled.unwrap_or_default()
        }
    };
    let (mut rest, mut items): (Vec<_>, Vec<_>) = nodes
        .into_iter()
        .map(describe)
        .partition(|it| it.is_out_of_flow);
    if flow != "source-order" {
        items.order_by_key(|it| it.order);
    }
    if matches!(flow.as_str(), "flex-visual" | "grid-rows" | "grid-columns") {
        items.order_by(|a, b| {
            a.start[0]
                .round()
                .total_cmp(&b.start[0].round())
                .then(a.start[1].total_cmp(&b.start[1]))
        });
    }
    items.order_by_key(|it| it.reading_order);
    rest.order_by_key(|it| it.reading_order);
    Some(
        items
            .iter()
            .chain(&rest)
            .enumerate()
            .map(|(rank, it)| (it.id, rank))
            .collect(),
    )
}

fn in_reading_order<'a>(cx: &mut Cx<'a>, parent: &'a Node, ranks: &Ranks) -> Vec<&'a Node> {
    fn without_slots<'a>(parent: &'a Node, ranks: &Ranks, into: &mut Vec<&'a Node>) {
        for child in children_within_reach(parent) {
            if child.has(NodeFlags::SLOT) && !ranks.contains_key(&child.id()) {
                without_slots(child, ranks, into)
            } else {
                into.push(child)
            }
        }
    }
    let mut children = Vec::new();
    without_slots(parent, ranks, &mut children);
    children.order_by_cached_key(|node| {
        ranks.get(&node.id()).copied().unwrap_or_else(|| {
            let mut items = Vec::new();
            items_of(cx, node, &mut items);
            items
                .iter()
                .filter_map(|it| ranks.get(&it.id()).copied())
                .min()
                .unwrap_or(ranks.len())
        })
    });
    children
}

/// The document stands for a gap at the marker.
struct Order<'a> {
    marker: Option<&'a Node>,
    gap: Gap,
}

struct Entry {
    index: i32,
    stops: Vec<NodeId>,
}

impl<'a> Order<'a> {
    fn marks(&self, node: &Node, gap: Gap) -> bool {
        self.gap == gap && self.marker == Some(node)
    }

    /// Adds the stops in the focus navigation scope of `owner`, and the marker.
    fn collect(
        &self,
        cx: &mut Cx<'a>,
        owner: &'a Node,
        ranks: Option<&Ranks>,
        into: &mut Vec<NodeId>,
    ) {
        let mut entries = Vec::new();
        self.visit(cx, owner, owner, ranks, &mut entries);
        entries.order_by_key(|it| {
            if it.index == 0 {
                i32::MAX
            } else {
                it.index - 1
            }
        });
        into.extend(entries.into_iter().flat_map(|it| it.stops));
    }

    /// Whether there is a stop below `parent`.
    fn visit(
        &self,
        cx: &mut Cx<'a>,
        owner: &'a Node,
        parent: &'a Node,
        ranks: Option<&Ranks>,
        entries: &mut Vec<Entry>,
    ) -> bool {
        let gap = || Entry {
            index: 0,
            stops: vec![parent.doc().id()],
        };
        let mut has_stop = false;
        if self.marks(parent, Gap::BeforeFirstChild) {
            entries.push(gap());
        }
        for node in ranks.map_or_else(
            || children_within_reach(parent).collect(),
            |it| in_reading_order(cx, parent, it),
        ) {
            let Some(element) = node.as_element() else {
                if self.marker == Some(node) {
                    entries.push(if self.gap == Gap::None {
                        Entry {
                            index: 0,
                            stops: vec![node.id()],
                        }
                    } else {
                        gap()
                    });
                }
                continue;
            };
            if popover::invoker_of(element)
                .is_some_and(|it| &**it != owner && !node.contains_flat(it))
            {
                continue;
            }
            let bits = looks(
                cx,
                node,
                Looks::RENDERED | Looks::CONTENTS | Looks::SCROLLS | Looks::READING_FLOW,
            );
            let has_marker = || self.marker.is_some_and(|it| node.contains_flat(it));
            if !bits.intersects(Looks::RENDERED | Looks::CONTENTS)
                && !has_marker()
                && !node.is_html(atom!("area"))
            {
                continue;
            }
            let index = tab_index(cx, element).min(if ranks.is_some() { 0 } else { i32::MAX });
            let is_stop = index >= 0
                && is_click_focusable(cx, element)
                && !forms::is_skipped_radio(cx, element);
            let at = entries.len();
            entries.push(Entry {
                index: index.max(0),
                stops: (is_stop || self.marks(node, Gap::None))
                    .then(|| node.id())
                    .into_iter()
                    .collect(),
            });
            let own = (bits & (Looks::CONTENTS | Looks::READING_FLOW) == Looks::READING_FLOW)
                .then(|| reading_ranks(cx, element))
                .flatten();
            let inner = if bits.contains(Looks::CONTENTS) {
                ranks
            } else {
                own.as_ref()
            };
            let owns_scope = node.has(NodeFlags::SLOT) && !node.has(NodeFlags::USER_AGENT)
                || element
                    .shadow_root()
                    .is_some_and(|it| !it.has(NodeFlags::USER_AGENT));
            let has_inner = if owns_scope || inner.is_some() || ranks.is_some() {
                let before = entries[at].stops.len();
                if index >= 0 || !owns_scope || has_marker() {
                    self.collect(cx, node, inner, &mut entries[at].stops);
                }
                entries[at].stops.len() > before
            } else {
                self.visit(cx, owner, node, ranks, entries)
            };
            if let Some(popover) = popover::invoked_by(element).filter(|it| !it.contains_flat(node))
            {
                if is_click_focusable(cx, popover) && tab_index(cx, popover) >= 0 {
                    entries[at].stops.push(popover.id());
                }
                self.collect(cx, popover, None, &mut entries[at].stops);
            }
            if !has_inner
                && index >= 0
                && entries[at].stops.is_empty()
                && bits.contains(Looks::SCROLLS)
                && focus::is_focusable(cx, element)
            {
                entries[at].stops.push(node.id());
            }
            if self.marks(node, Gap::After) {
                entries.push(gap());
            }
            has_stop |= is_stop || has_inner;
        }
        has_stop
    }
}

/// In which the focus is moving, if Tab moves it.
pub(crate) fn direction(ui: &Ui) -> i32 {
    match ui.focus.is_tabbing.get() && !ui.activation.was_by_mouse.get() {
        true if ui
            .mouse()
            .modifiers
            .get()
            .contains(crate::api::uievents::Modifiers::SHIFT) =>
        {
            -1
        }
        is_tabbing => is_tabbing.into(),
    }
}

pub(crate) fn move_focus<'a>(cx: &mut Cx<'a>, ui: &'a Ui, is_backward: bool, enters_frame: bool) {
    let doc = ui.doc();
    let marker = ui
        .focused()
        .map(|it| &**it)
        .or_else(|| ui.tab_start())
        .filter(|it| it.is_connected());
    let gap = if ui.focused().is_none() && marker.is_some() {
        ui.focus.gap.get()
    } else {
        Gap::None
    };
    let mut stops = Vec::new();
    Order { marker, gap }.collect(cx, doc, None, &mut stops);
    let marker = if gap == Gap::None {
        marker.map(Node::id)
    } else {
        Some(doc.id())
    };
    let index = stops.iter().position(|it| Some(*it) == marker);
    stops.retain(|it| Some(*it) != marker);
    let next = match index {
        Some(index) if is_backward => index.checked_sub(1).map(|it| &stops[it]),
        Some(index) => stops.get(index),
        None => None,
    };
    if next.is_none()
        && (index.is_some() || stops.is_empty())
        && let Some(container) = ui.any_container()
    {
        if enters_frame {
            return;
        }
        focus::set_focus(cx, ui, None, Cause::Keyboard, None);
        return container.tab_out(cx, is_backward);
    }
    let next = next.or_else(|| {
        if is_backward {
            stops.last()
        } else {
            stops.first()
        }
    });
    if let Some(next) = next.and_then(|it| doc.rendered_node(*it)?.as_element()) {
        forms::date_fields::enter_by_tab(next, is_backward);
        ui.focus.is_tabbing.set(true);
        focus::focus(cx, next, Cause::Keyboard, focus::Options::default());
        ui.focus.is_tabbing.set(false);
    }
}
