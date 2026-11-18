//! Questions to the engine that take more than one step.

use crate::abi::Rect;
use crate::api::core::Atom;
use crate::document::Document;
use crate::editing::Mark;
use crate::order::Order as _;
use crate::properties::Style;
use crate::scroll::RESIZER;
use crate::selector::Pseudo;
use crate::tree::{DOCUMENT, Data, Flags, Namespace, NodeId};
use crate::types::*;

impl Document {
    pub(crate) fn current_style_bits(&mut self, node: NodeId, wanted: u32) -> u32 {
        const RENDERED: u32 = 1;
        const SCROLLS: u32 = 1 << 5;
        if wanted & SCROLLS == 0 && !self.is_in_skipped_contents(node) {
            self.update_style_of(node);
            if wanted & RENDERED == 0 || self.is_settled_whether_it_has_a_box(node) {
                return self.style_bits(node, wanted) & wanted;
            }
        }
        self.update_layout();
        if !self.auto_visible.is_empty()
            && self.style_bits(node, 0) >> 14 & 1 == 0
            && self.is_in_skipped_contents(node)
        {
            self.force_leaves(node);
        }
        self.style_bits(node, wanted) & wanted
    }

    /// For a node whose style is up to date.
    fn is_settled_whether_it_has_a_box(&self, node: NodeId) -> bool {
        let Some(element) = self
            .tree
            .element(node)
            .filter(|_| !self.is_in_skipped_contents(node))
        else {
            return false;
        };
        element
            .style
            .as_ref()
            .is_none_or(|it| it.display() == Display::None)
            || self.tree[node].layout_box != 0
                && !core::iter::once(node)
                    .chain(self.tree.flat_ancestors(node))
                    .any(|it| self.tree[it].has(Flags::REBUILD))
    }

    pub(crate) fn with_computed_style<R>(
        &mut self,
        node: NodeId,
        read: impl FnOnce(&Style) -> R,
    ) -> Option<R> {
        match self.is_in_skipped_contents(node) {
            true => self.force(node, Document::update_style),
            false => self.update_style_of(node),
        }
        self.style_of_pseudo(node, Pseudo::None)
            .map(|it| read(&it.1))
    }

    pub(crate) fn hit_test(&self, point: [f32; 2]) -> NodeId {
        self.nodes_at(point)
            .next()
            .map_or(0, |it| self.not_generated(it))
    }

    pub(crate) fn hit_test_all(&self, point: [f32; 2]) -> Vec<NodeId> {
        let mut found = Vec::new();
        for node in self.nodes_at(point) {
            if !found.contains(&node) {
                found.push(node);
            }
        }
        found.into_iter().map(|it| self.not_generated(it)).collect()
    }

    pub(crate) fn cursor_at(&self, point: [f32; 2]) -> &'static str {
        match self.scrollbar_at(point) {
            Some((id, RESIZER)) => {
                let it = &self.boxes[id];
                return match (it.style.scroll.resize, it.mode.is_vertical()) {
                    (Resize::Both, _) if it.style.is_rtl() => "nesw-resize",
                    (Resize::Both, _) => "nwse-resize",
                    (Resize::Horizontal, _) | (Resize::Inline, false) | (Resize::Block, true) => {
                        "ew-resize"
                    }
                    _ => "ns-resize",
                };
            }
            Some(_) => return "default",
            None => {}
        }
        let Some(node) = self.nodes_at(point).next() else {
            return "default";
        };
        let is_text = self.tree[node].text().is_some();
        let Some(style) = self.tree.style(if is_text {
            self.tree.flat_parent(node)
        } else {
            node
        }) else {
            return "default";
        };
        match style.ink.cursor.0 {
            CursorName::Auto
                if style.is_editable() || is_text && style.ink.user_select != UserSelect::None =>
            {
                "text"
            }
            CursorName::Auto => "default",
            cursor => cursor.name(),
        }
    }

    pub(crate) fn cursor_asked_for_by(&self, node: NodeId) -> &'static str {
        self.tree
            .style(node)
            .map_or("", |it| it.ink.cursor.0.name())
    }

    /// What positions in an inline box are told from.
    pub(crate) fn holder_of_lines(&self, node: NodeId) -> NodeId {
        let is_inline = self.own_box(node).is_none() && self.svg_element_rect(node).is_none();
        self.tree
            .flat_ancestors(node)
            .take_while(|_| is_inline)
            .find(|it| self.own_box(*it).is_some())
            .unwrap_or(node)
    }

    pub(crate) fn to_local(&self, node: NodeId, point: [f64; 2]) -> [f64; 2] {
        let Some((at, rect)) = self.local_rects(node).first().copied() else {
            return point;
        };
        let [x, y] = apply(
            &invert(&self.to_viewport(at)).unwrap_or(IDENTITY),
            point.map(|it| it as f32),
        );
        [x - rect.x, y - rect.y].map(|it| (it / self.zoom_of(node)).into())
    }

    /// `align`: inline, block.
    pub(crate) fn set_implicit_anchor(&mut self, node: NodeId, anchor: NodeId) {
        self.implicit_anchors.insert(node, anchor);
        self.relayout(node);
    }

    /// `caret`: whether it is upstream.
    pub(crate) fn set_selection(&mut self, ends: Option<[u32; 4]>, caret: Option<bool>) {
        let selection = ends.map(|it| self.range(it));
        let marks = &mut self.marks;
        if (marks.selection, marks.caret) != (selection, caret) {
            (marks.selection, marks.caret, marks.are_stale) = (selection, caret, true);
            self.relevance_changed();
            self.pictures.outdate();
        }
    }

    pub(crate) fn set_marks(&mut self, mark: Mark, priority: i32, ranges: &[[u32; 4]]) {
        if ranges.is_empty() && !self.marks.highlights.iter().any(|it| it.0 == mark) {
            return;
        }
        let ranges: Vec<_> = ranges.iter().map(|it| self.range(*it)).collect();
        let marks = &mut self.marks;
        marks.highlights.retain(|it| it.0 != mark);
        marks
            .highlights
            .extend((!ranges.is_empty()).then_some((mark, priority, ranges)));
        marks.highlights.order_by_key(|it| it.1);
        marks.are_stale = true;
        self.pictures.outdate();
    }

    pub(crate) fn create_bubble(&mut self, root: NodeId, text: &str) -> NodeId {
        let (bubble, text) = (
            self.create_element(Atom::new("div"), Namespace::Html, None),
            self.tree.create(Data::Text(text.into())),
        );
        self.set_pseudo(bubble, b"-internal-bubble", root);
        self.insert(bubble, text, 0);
        self.set_attribute(bubble, "style", Some("left:0;top:0"));
        self.insert(DOCUMENT, bubble, 0);
        bubble
    }

    pub(crate) fn create_overlay(&mut self, root: NodeId, parts: &[[String; 2]]) -> NodeId {
        let create = |engine: &mut Document, style: &str| {
            let made = engine.create_element(Atom::new("div"), Namespace::Html, None);
            engine.set_pseudo(made, b"-internal-overlay", root);
            engine.set_attribute(made, "style", Some(style));
            made
        };
        let overlay = create(self, "inset:0");
        for [style, text] in parts {
            let (part, text) = (
                create(self, style),
                self.tree.create(Data::Text((&**text).into())),
            );
            self.insert(part, text, 0);
            self.insert(overlay, part, 0);
        }
        self.insert(DOCUMENT, overlay, 0);
        overlay
    }

    pub(crate) fn place_bubble(&mut self, bubble: NodeId, [x, y]: [f32; 2]) {
        self.update_layout_for(bubble);
        let (Rect { width, height, .. }, [right, bottom]) =
            (self.bounding_rect(bubble), self.environment.viewport);
        let (left, top) = (
            x.min(right - width).max(0.0),
            if y + height > bottom {
                y - height - 28.0
            } else {
                y
            },
        );
        self.set_attribute(bubble, "style", Some(&format!("left:{left}px;top:{top}px")));
    }
}
