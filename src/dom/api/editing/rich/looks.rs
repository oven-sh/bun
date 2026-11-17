//! What is editable, and what shows.

use super::tags::{is_break, is_line_container, is_replaced};
use super::*;
use crate::properties::Style;
use crate::types::{Display, Interactivity, WhiteSpaceCollapse};

fn editability(node: &Node) -> Option<Known> {
    node.keyword(atom!("contenteditable"))
        .filter(|_| node.is_html_element())
}

pub(super) fn is_host(node: &Node) -> bool {
    match editability(node) {
        Some(atom!("") | atom!("true") | atom!("plaintext-only")) => true,
        _ if node.is_html_element()
            && node.parent() == Some(node.doc())
            && node.doc().is(DocFlags::DESIGN_MODE) =>
        {
            true
        }
        Some(atom!("false")) => false,
        _ => {
            node.is_html(atom!("body"))
                && node
                    .parent()
                    .is_some_and(|it| it.is_html(atom!("html")) && is_host(it))
        }
    }
}

pub(super) fn host_of(node: &Node) -> Maybe<'_> {
    let inherits = |it: &Node| match it.as_element().map(|it| (it.ns(), it.tag())) {
        None => it.parent().is_some_and(Node::is_html_element),
        Some((Ns::Html, _)) => editability(it) != Some(atom!("false")),
        Some(other) => matches!(other, (Ns::Svg, atom!("svg")) | (Ns::MathMl, atom!("math"))),
    };
    node.inclusive_ancestors()
        .find(|it| is_host(it) || !inherits(it))
        .filter(|it| is_host(it))
}

/// The `<head>` of an editable `<html>` is not.
pub(super) fn is_editable(node: &Node) -> bool {
    !node.is_html(atom!("head")) && host_of(node).is_some_and(|it| it != node)
}

pub(super) fn is_part_of_document(node: &Node) -> bool {
    matches!(node.html_tag(), atom!("head") | atom!("body"))
        && node.parent().is_some_and(|it| it.is_html(atom!("html")))
}

pub(super) fn editable(node: Maybe<'_>) -> Maybe<'_> {
    node.filter(|it| is_editable(it))
}

pub(super) fn share_host(a: &Node, b: &Node) -> bool {
    host_of(a).is_some_and(|it| Some(it) == host_of(b))
}

pub(super) fn shares_host_with_parent(node: &Node) -> bool {
    node.parent().is_some_and(|it| share_host(node, it))
}

pub(super) fn is_plain(node: &Node) -> bool {
    editability(host_of(node).unwrap_or(node)) == Some(atom!("plaintext-only"))
}

fn is_svg(node: &Node) -> bool {
    node.as_element().is_some_and(|it| it.ns() == Ns::Svg)
}

/// Deleted as a whole.
pub(super) fn is_unit(node: &Node) -> bool {
    is_break(node)
        || node.is_html(atom!("hr"))
        || is_replaced(node)
        || is_svg(node)
        || !is_editable(node)
}

pub(super) fn is_white(unit: u16) -> bool {
    matches!(unit, 9 | 10 | 13 | 32)
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum Beside {
    Edge,
    Break,
    Content,
}

pub(super) fn sibling(node: &Node, is_forward: bool) -> Maybe<'_> {
    if is_forward {
        node.next_sibling()
    } else {
        node.previous_sibling()
    }
}

impl<'a> Editor<'_, 'a> {
    pub(super) fn style<R>(&self, node: &'a Node, read: impl FnOnce(&Style) -> R) -> Option<R> {
        self.with(|cx| layout::style(cx, node.as_element()?, read))
    }

    pub(super) fn computed(&self, element: &'a Element, property: &str) -> String {
        str::from_utf8(&self.with(|cx| layout::computed(cx, element, property)))
            .unwrap_or_default()
            .into()
    }

    pub(super) fn display(&self, node: &'a Node) -> Option<Display> {
        self.style(node, Style::display)
    }

    pub(super) fn is_block(&self, node: &'a Node) -> bool {
        match node.is_element() {
            true => self.display(node).is_some_and(|it| {
                !it.is_inline_level() && !matches!(it, Display::None | Display::Contents)
            }),
            false => node.as_doc().is_some() || node.as_fragment().is_some(),
        }
    }

    pub(super) fn is_inline(&self, node: &'a Node) -> bool {
        !self.is_block(node)
    }

    pub(super) fn block(&self, node: Maybe<'a>) -> Maybe<'a> {
        node.filter(|it| self.is_block(it))
    }

    pub(super) fn inline(&self, node: Maybe<'a>) -> Maybe<'a> {
        node.filter(|it| self.is_inline(it))
    }

    pub(super) fn is_atomic(&self, node: &'a Node) -> bool {
        is_replaced(node)
            || is_svg(node)
            || matches!(
                self.display(node),
                Some(
                    Display::InlineBlock
                        | Display::InlineFlex
                        | Display::InlineGrid
                        | Display::InlineTable
                )
            )
    }

    pub(super) fn is_inert(&self, node: &'a Node) -> bool {
        element_at(node)
            .and_then(|it| self.style(it, |it| it.ink.interactivity))
            .is_some_and(|it| it != Interactivity::Auto)
    }

    /// In the element, or around the text.
    fn collapsing(&self, node: &'a Node) -> WhiteSpaceCollapse {
        element_at(node)
            .and_then(|it| self.style(it, |it| it.text.collapse))
            .unwrap_or(WhiteSpaceCollapse::Collapse)
    }

    pub(super) fn keeps_spaces(&self, node: &'a Node) -> bool {
        self.collapsing(node).preserves_spaces()
    }

    pub(super) fn keeps_breaks(&self, node: &'a Node) -> bool {
        self.collapsing(node) != WhiteSpaceCollapse::Collapse
    }

    fn is_whitespace(&self, node: &'a Node) -> bool {
        let Some(data) = node.as_text().map(|it| it.data()) else {
            return false;
        };
        data.is_empty()
            || data.units().all(is_white)
                && !self.keeps_spaces(node)
                && !(self.keeps_breaks(node) && data.units().any(|it| it == NEWLINE))
    }

    pub(super) fn is_hidden(&self, node: &'a Node) -> bool {
        node.inclusive_ancestors()
            .any(|it| it.is_element() && self.display(it).is_none_or(|it| it == Display::None))
    }

    fn beside_text(&self, text: &'a Node, is_forward: bool) -> Beside {
        if !self.keeps_breaks(text) {
            return Beside::Content;
        }
        let (data, keeps_spaces) = (text.text(), self.keeps_spaces(text));
        let shows = |it: &u16| keeps_spaces || !matches!(it, 9 | 32);
        let nearest = if is_forward {
            data.units().find(shows)
        } else {
            data.units().rfind(shows)
        };
        if nearest == Some(NEWLINE) {
            Beside::Break
        } else {
            Beside::Content
        }
    }

    /// What is next to `node` on its line.
    pub(super) fn beside(&self, node: &'a Node, is_forward: bool) -> Beside {
        let mut at = node;
        loop {
            let mut next = sibling(at, is_forward);
            if next.is_none() {
                match at
                    .parent()
                    .filter(|it| !self.is_block(it) && !self.is_atomic(it) && !is_host(it))
                {
                    Some(parent) => at = parent,
                    None => return Beside::Edge,
                }
            }
            while let Some(it) = next.take() {
                at = it;
                if at.is_text() {
                    if !self.is_whitespace(at) {
                        return self.beside_text(at, is_forward);
                    }
                } else if !at.is_element() || self.display(at) == Some(Display::None) {
                } else if is_break(at) {
                    return Beside::Break;
                } else if self.is_block(at) {
                    let is_in_flow = |it: &Style| !it.is_out_of_flow() && !it.is_floating();
                    if self.style(at, is_in_flow) == Some(true) {
                        return Beside::Edge;
                    }
                } else if self.is_atomic(at) {
                    return Beside::Content;
                } else {
                    next = if is_forward {
                        at.first_child()
                    } else {
                        at.last_child()
                    };
                }
            }
        }
    }

    /// The line that it begins has nothing on it.
    pub(super) fn is_collapsed_break(&self, node: &'a Node) -> bool {
        is_break(node) && self.beside(node, true) == Beside::Edge
    }

    pub(super) fn is_extraneous_break(&self, node: &'a Node) -> bool {
        !(tags::is(node.parent(), atom!("li")) && is_only_child(node))
            && self.is_collapsed_break(node)
            && self.beside(node, false) == Beside::Content
    }

    fn is_collapsed_whitespace(&self, node: &'a Node) -> bool {
        self.is_whitespace(node)
            && (node.length() == 0
                || [false, true]
                    .into_iter()
                    .any(|it| self.beside(node, it) != Beside::Content))
    }

    fn is_shown(&self, node: &'a Node) -> bool {
        match () {
            () if node.is_text() => !self.is_collapsed_whitespace(node),
            () if !node.is_element() => self.is_block(node),
            () if self.display(node) == Some(Display::None) => false,
            () if is_break(node) => !self.is_extraneous_break(node),
            () => {
                self.is_block(node)
                    || is_replaced(node)
                    || is_svg(node)
                    || self.inside(node).any(|it| self.is_shown(it))
            }
        }
    }

    pub(super) fn is_visible(&self, node: &'a Node) -> bool {
        !self.is_hidden(node) && self.is_shown(node)
    }

    pub(super) fn invisible(&self, node: Maybe<'a>) -> Maybe<'a> {
        node.filter(|it| !self.is_visible(it))
    }

    pub(super) fn has_visible_child(&self, node: &'a Node) -> bool {
        node.children().any(|it| self.is_visible(it))
    }

    pub(super) fn is_removable(&self, node: &'a Node) -> bool {
        is_editable(node) && (!self.is_visible(node) || self.is_empty_block(node))
    }

    pub(super) fn removable(&self, node: Maybe<'a>) -> Maybe<'a> {
        node.filter(|it| self.is_removable(it))
    }

    fn is_empty_block(&self, node: &'a Node) -> bool {
        is_line_container(node)
            && self.inside(node).all(|it| self.is_removable(it))
            && node
                .as_element()
                .is_some_and(|it| self.computed(it, "height") == "0px")
    }

    /// It only keeps its block from having no height.
    pub(super) fn is_block_prop(&self, node: &'a Node) -> bool {
        if is_break(node) {
            return self.is_collapsed_break(node) && !self.is_extraneous_break(node);
        }
        node.is_element()
            && !self.is_block(node)
            && self.has_visible_child(node)
            && !self.has_content(node)
    }

    pub(super) fn has_content(&self, node: &'a Node) -> bool {
        self.inside(node)
            .any(|it| self.is_visible(it) && !self.is_block_prop(it))
    }

    pub(super) fn has_only_block_prop(&self, node: &'a Node) -> bool {
        has_at_most_one_child(node) && node.first_child().is_some_and(|it| self.is_block_prop(it))
    }

    /// A block that cannot be edited goes when what is around it is joined.
    pub(super) fn is_obstacle(&self, node: &'a Node) -> bool {
        self.is_block(node)
            && !node.is_html(atom!("hr"))
            && (!is_editable(node)
                || tags::is_list(node)
                    && self
                        .inside(node)
                        .all(|it| self.is_obstacle(it) || !self.is_visible(it)))
    }

    pub(super) fn block_of(&self, node: &'a Node) -> &'a Node {
        node.inclusive_ancestors()
            .find(|it| self.is_block(it))
            .unwrap_or_else(|| node.root())
    }

    pub(super) fn last_equivalent(&self, mut point: Point<'a>) -> Point<'a> {
        while point.node.length() > 0 {
            if is_at_end(point)
                && self.is_inline(point.node)
                && !is_host(point.node)
                && let Ok(outside) = after(point.node)
            {
                point = outside;
            } else if let Some(next) = child_after(point).filter(|it| {
                it.length() > 0 && self.is_inline(it) && is_editable(it) && !is_replaced(*it)
            }) {
                point = at(next, 0);
            } else {
                break;
            }
        }
        point
    }

    pub(super) fn first_equivalent(&self, mut point: Point<'a>) -> Point<'a> {
        while point.node.length() > 0 {
            if point.offset == 0
                && self.is_inline(point.node)
                && !is_host(point.node)
                && let Ok(outside) = before(point.node)
            {
                point = outside;
            } else if let Some(previous) = child_before(point).filter(|it| {
                it.length() > 0 && self.is_inline(it) && is_editable(it) && !is_replaced(*it)
            }) {
                point = end_of(previous);
            } else {
                break;
            }
        }
        point
    }

    fn is_block_start(&self, point: Point<'a>) -> bool {
        point.node.parent().is_none() && point.offset == 0
            || child_before(point)
                .is_some_and(|it| (self.is_block(it) || is_break(it)) && self.is_visible(it))
    }

    fn is_block_end(&self, point: Point<'a>) -> bool {
        point.node.parent().is_none() && is_at_end(point)
            || child_after(point).is_some_and(|it| self.is_block(it) && self.is_visible(it))
    }

    fn is_block_boundary(&self, point: Point<'a>) -> bool {
        self.is_block_start(point) || self.is_block_end(point)
    }

    pub(super) fn block_extend(&self, [start, end]: [Point<'a>; 2]) -> [Point<'a>; 2] {
        let item = |point: Point<'a>| point.node.closest_html(atom!("li"));
        let mut start = item(start).and_then(|it| before(it).ok()).unwrap_or(start);
        let mut end = item(end).and_then(|it| after(it).ok()).unwrap_or(end);
        let mut is_there = self.is_block_start(start);
        while !is_there {
            start = match start.offset {
                0 => before(start.node).unwrap_or(start),
                offset => at(
                    start.node,
                    if start.node.is_text() { 0 } else { offset - 1 },
                ),
            };
            is_there = self.is_block_boundary(start);
        }
        while let (0, Ok(outside)) = (start.offset, before(start.node)) {
            start = outside;
        }
        is_there = self.is_block_end(end);
        while !is_there {
            end = match () {
                () if is_at_end(end) => after(end.node).unwrap_or(end),
                () if end.node.is_text() => end_of(end.node),
                () => at(end.node, end.offset + 1),
            };
            is_there = self.is_block_boundary(end);
        }
        while let (true, Ok(outside)) = (is_at_end(end), after(end.node)) {
            end = outside;
        }
        [start, end]
    }

    pub(super) fn selected_lines(&self) -> [Point<'a>; 2] {
        self.block_extend([self.start(), self.end()])
    }

    pub(super) fn selected_leaves(&self) -> Nodes<'a> {
        self.contained(
            self.selected_lines(),
            &|it| it.first_child().is_none() && is_editable(it) && self.is_visible(it),
            false,
        )
    }

    pub(super) fn follows_break(&self, node: &'a Node) -> bool {
        let mut point = at(node, 0);
        while !self.is_block_boundary(point) {
            match child_before(point) {
                Some(it) if self.is_visible(it) => {
                    return ends_with_newline(it) && self.keeps_breaks(it);
                }
                Some(_) => point.offset -= 1,
                None => point = before(point.node).unwrap_or(point),
            }
        }
        true
    }

    pub(super) fn precedes_break(&self, node: &'a Node) -> bool {
        let mut point = end_of(node);
        while !self.is_block_boundary(point) {
            match child_after(point) {
                Some(it) if self.is_visible(it) => return false,
                Some(_) => point.offset += 1,
                None => point = after(point.node).unwrap_or(point),
            }
        }
        true
    }
}
