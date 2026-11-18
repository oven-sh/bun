use bun_jsc::JSString;
use bun_jsc::bindgen::JsLocal;

use super::*;
use crate::api::core::NodeFlags as F;
use crate::generated_bindgen::range::{GetComposedRangesOptions, js_Selection as js};

bitflags::bitflags! {
    #[derive(Clone, Copy, Default)]
    struct State: u32 {
        const BACKWARD = 1;
        /// The caret is at the end of a line that wraps, not at the start of the next one.
        const UPSTREAM = 1 << 1;
        /// A script has the range.
        const EXPOSED = 1 << 2;
        const IN_SHADOW = 1 << 3;
        /// Else scripts do not see into shadow trees.
        const FROM_SCRIPT = 1 << 4;
    }
}

/// The range may be in the shadow tree of a control, where scripts do not see it.
pub(crate) struct Selection {
    state: Cell<State>,
    /// Where moving up and down aims at.
    goal_x: Cell<f64>,
}

/// Of a document or a shadow root.
pub(crate) fn try_selection(scope: &Node) -> Option<&Selection> {
    // SAFETY: what `selection_of` has put there.
    scope
        .edge(Edge::Selection)
        .map(|it| unsafe { Selection::from_js_unchecked(it) })
}

/// For the scripts of the tree at `scope`, a document or a shadow root.
pub(crate) fn selection_of<'a>(heap: &JsHeap<'a>, scope: &'a Node) -> &'a Selection {
    if let Some(known) = try_selection(scope).filter(|it| it.doc() == scope.doc()) {
        return known;
    }
    let made = js::create(
        scope.doc().realm(heap),
        Selection {
            state: Cell::default(),
            goal_x: Cell::new(f64::NAN),
        },
    );
    js::set_scope(made, Some(scope));
    js::set_of_document(
        made,
        Some(if scope.kind().is_document() {
            made
        } else {
            selection_of(heap, scope.doc())
        }),
    );
    scope.set_edge(heap, Edge::Selection, made.to_js());
    made
}

fn is_in_author_shadow(node: &Node) -> bool {
    node.out_of_control().root().has(F::SHADOW_ROOT)
}

/// For the selection of a document.
impl Selection {
    fn is(&self, state: State) -> bool {
        self.state.get().intersects(state)
    }

    fn toggle(&self, state: State, on: bool) {
        self.state.set(if on {
            self.state.get() | state
        } else {
            self.state.get() - state
        });
    }

    pub(crate) fn range(&self) -> Option<&Range> {
        js::range(self)
    }

    /// What is selected, whose ends may be in different trees.
    pub(crate) fn span(&self) -> Option<&Range> {
        js::composed(self).or_else(|| self.range())
    }

    pub(crate) fn is_backward(&self) -> bool {
        self.is(State::BACKWARD)
    }

    pub(crate) fn is_upstream(&self) -> bool {
        self.is(State::UPSTREAM)
    }

    pub(crate) fn goal_x(&self) -> &Cell<f64> {
        &self.goal_x
    }

    fn directed<'a>(&self, start: Point<'a>, end: Point<'a>) -> [Point<'a>; 2] {
        if self.is_backward() {
            [end, start]
        } else {
            [start, end]
        }
    }

    pub(crate) fn anchor_and_focus(&self) -> Option<[Point<'_>; 2]> {
        self.span().map(|it| self.directed(it.start(), it.end()))
    }

    pub(super) fn changed<'a>(&'a self, cx: Cx<'_, 'a>) {
        self.toggle(State::UPSTREAM, false);
        self.goal_x.set(f64::NAN);
        if self.doc().is(DocFlags::HAS_PAGE) {
            crate::api::ui::seams::selection_changed(cx, self.doc());
        }
    }

    fn drop_composed(&self) {
        if let Some(composed) = js::composed(self) {
            composed.stop_following();
            js::set_composed(self, None);
        }
    }

    fn replace_range(&self, range: Option<&Range>, is_backward: bool) {
        self.drop_composed();
        if let Some(old) = self.range() {
            old.set_selection(None);
            if !self.is(State::EXPOSED) {
                old.stop_following();
            }
        }
        self.toggle(State::EXPOSED | State::FROM_SCRIPT, false);
        self.toggle(
            State::IN_SHADOW,
            range.is_some_and(|it| is_in_author_shadow(it.start().node)),
        );
        self.toggle(State::BACKWARD, is_backward);
        js::set_range(self, range);
        range
            .into_iter()
            .for_each(|it| it.set_selection(Some(self)));
    }

    pub(crate) fn use_range<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        range: Option<&'a Range>,
        is_backward: bool,
    ) {
        self.replace_range(range, is_backward);
        self.changed(cx);
    }

    pub(crate) fn select<'a>(&'a self, cx: Cx<'_, 'a>, anchor: Point<'a>, focus: Point<'a>) {
        self.select_with_affinity(cx, anchor, focus, false);
    }

    pub(crate) fn collapse<'a>(&'a self, cx: Cx<'_, 'a>, at: Point<'a>) {
        self.select(cx, at, at);
    }

    pub(crate) fn select_with_affinity<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        anchor: Point<'a>,
        focus: Point<'a>,
        is_upstream: bool,
    ) {
        if anchor.node.doc() != self.doc() || focus.node.doc() != self.doc() {
            return;
        }
        let [anchor, focus] =
            [anchor, focus].map(|it| Point::new(it.node, it.offset.min(it.node.length())));
        let is_backward = compare_composed(anchor, focus).is_gt();
        let (start, end) = if is_backward {
            (focus, anchor)
        } else {
            (anchor, focus)
        };
        if start.node.root() != end.node.root() {
            let range = Range::new(&cx.heap, end, end);
            self.use_range(cx, Some(range), is_backward);
            return self.compose(&cx.heap, start, end);
        }
        let is_same = self
            .span()
            .is_some_and(|it| (it.start(), it.end()) == (start, end))
            && (is_backward, is_upstream) == (self.is_backward(), self.is_upstream());
        if !is_same || self.is(State::EXPOSED) {
            self.replace_range(Some(Range::new(&cx.heap, start, end)), is_backward);
        }
        if !is_same {
            self.changed(cx);
        }
        self.toggle(State::UPSTREAM, is_upstream);
    }

    pub(super) fn compose<'a>(&'a self, heap: &JsHeap<'a>, start: Point<'a>, end: Point<'a>) {
        if start.node.root() != end.node.root() && compare_composed(start, end).is_lt() {
            let composed = Range::new(heap, start, end);
            composed.set_selection(Some(self));
            js::set_composed(self, Some(composed));
            self.toggle(State::IN_SHADOW, true);
        }
    }

    pub(super) fn range_was_set<'a>(&'a self, cx: Cx<'_, 'a>) {
        let Some(start) = self.range().map(|it| it.start().node) else {
            return;
        };
        if !self.can_select(start) {
            return self.clear(cx);
        }
        if js::composed(self).is_some() {
            self.changed(cx);
            self.drop_composed();
        }
        self.toggle(State::IN_SHADOW, is_in_author_shadow(start));
    }

    /// The shadow trees in `removed` go with it.
    pub(super) fn before_remove<'a>(&'a self, cx: Cx<'_, 'a>, removed: &'a Node) {
        let Some(ends) = self
            .anchor_and_focus()
            .filter(|_| self.is(State::IN_SHADOW))
        else {
            return;
        };
        let moved = ends.map(|it| {
            if removed.contains_composed(it.node) {
                Point::before(removed).unwrap_or(it)
            } else {
                it
            }
        });
        if moved != ends {
            self.select(cx, moved[0], moved[1]);
        }
    }

    fn select_for_script<'a>(&'a self, cx: Cx<'_, 'a>, anchor: Point<'a>, focus: Point<'a>) {
        self.select(cx, anchor, focus);
        self.toggle(State::FROM_SCRIPT, true);
        crate::api::ui::seams::focus_selection(cx, self);
    }
}

/// For the selection of a shadow root too.
impl Selection {
    fn of_document(&self) -> &Selection {
        js::of_document(self).unwrap_or(self)
    }

    pub(crate) fn doc(&self) -> &Doc {
        js::scope(self.of_document()).expect("it was set").doc()
    }

    fn can_select(&self, node: &Node) -> bool {
        node.is_connected() && node.doc() == self.doc()
    }

    /// The anchor and the focus, as the scripts of the tree see them.
    fn seen(&self) -> Option<[Point<'_>; 2]> {
        let (main, scope) = (self.of_document(), js::scope(self)?);
        let range = main.range()?;
        if scope.kind().is_document() && (main.is(State::FROM_SCRIPT) || !main.is(State::IN_SHADOW))
        {
            return Some(
                main.directed(range.start().out_of_control(), range.end().out_of_control()),
            );
        }
        let lift = |point| {
            core::iter::successors(Some(point), |it: &Point<'_>| {
                Point::before(it.node.root().host()?)
            })
            .find(|it| it.node.root() == scope)
        };
        let [anchor, focus] = main.anchor_and_focus()?;
        Some([lift(anchor)?, lift(focus)?])
    }

    fn require_range<'a>(&'a self, heap: &JsHeap<'a>) -> Result<'a, &'a Range> {
        self.of_document()
            .span()
            .ok_or_else(|| dom_error(heap, DomError::InvalidStateError, "There is no selection."))
    }

    pub(crate) fn clear<'a>(&'a self, cx: Cx<'_, 'a>) {
        if self.of_document().range().is_some() {
            self.of_document().use_range(cx, None, false);
        }
    }

    pub(crate) fn get_anchor_node(&self) -> Option<&Node> {
        Some(self.seen()?[0].node)
    }

    pub(crate) fn get_anchor_offset(&self) -> u32 {
        self.seen().map_or(0, |it| it[0].offset)
    }

    pub(crate) fn get_focus_node(&self) -> Option<&Node> {
        Some(self.seen()?[1].node)
    }

    pub(crate) fn get_focus_offset(&self) -> u32 {
        self.seen().map_or(0, |it| it[1].offset)
    }

    pub(crate) fn get_is_collapsed(&self) -> bool {
        self.seen().is_none_or(|it| it[0] == it[1])
    }

    pub(crate) fn get_range_count(&self) -> u32 {
        self.seen().is_some().into()
    }

    pub(crate) fn get_type<'a>(&'a self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        Atom::new(match self.seen().and_then(|_| self.of_document().span()) {
            None => "None",
            Some(span) if span.collapsed() => "Caret",
            Some(_) => "Range",
        })
        .to_js(heap)
    }

    pub(crate) fn get_direction<'a>(&'a self, heap: &JsHeap<'a>) -> JsLocal<'a, JSString> {
        Atom::new(match self.of_document().span() {
            Some(span) if !span.collapsed() && self.of_document().is_backward() => "backward",
            Some(span) if !span.collapsed() => "forward",
            _ => "none",
        })
        .to_js(heap)
    }

    pub(crate) fn get_range_at<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        index: u32,
    ) -> Result<'a, &'a Range> {
        let main = self.of_document();
        let Some(([anchor, focus], range)) = self.seen().zip(main.range()).filter(|_| index == 0)
        else {
            return Err(heap.dom_exception(
                DomError::IndexSizeError,
                format_args!("{index} is not a valid index."),
            ));
        };
        let [start, end] = main.directed(anchor, focus);
        if start.node != range.start().node || end.node != range.end().node {
            return Ok(Range::new(heap, start, end));
        }
        main.toggle(State::EXPOSED, true);
        Ok(range)
    }

    pub(crate) fn get_composed_ranges<'a>(
        &'a self,
        heap: &JsHeap<'a>,
        options: &GetComposedRangesOptions<'a>,
    ) -> Option<&'a StaticRange> {
        let lift = |point: Point<'a>, beside: fn(&'a Node) -> Option<Point<'a>>| {
            let is_hidden = |root: &&'a Node| {
                !options
                    .shadow_roots
                    .iter()
                    .any(|it| root.contains_composed(it))
            };
            core::iter::successors(Some(point), |it| {
                beside(Some(it.node.root()).filter(is_hidden)?.host()?)
            })
            .last()
            .unwrap_or(point)
        };
        self.of_document().span().map(|it| {
            static_range(
                heap,
                lift(it.start(), Point::before),
                lift(it.end(), Point::after),
            )
        })
    }

    pub(crate) fn add_range<'a>(&'a self, cx: Cx<'_, 'a>, range: &'a Range) {
        if self.seen().is_none() && self.can_select(range.start().node) {
            let main = self.of_document();
            main.use_range(cx, Some(range), false);
            main.toggle(State::EXPOSED | State::FROM_SCRIPT, true);
            crate::api::ui::seams::focus_selection(cx, main);
        }
    }

    pub(crate) fn remove_range<'a>(&'a self, cx: Cx<'_, 'a>, range: &'a Range) -> Result<'a> {
        if !self
            .of_document()
            .range()
            .is_some_and(|it| core::ptr::eq(it, range))
        {
            return Err(dom_error(
                &cx.heap,
                DomError::NotFoundError,
                "The given range isn't in the selection.",
            ));
        }
        self.clear(cx);
        Ok(())
    }

    fn select_if_possible<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        anchor: Point<'a>,
        focus: Point<'a>,
    ) -> Result<'a> {
        let (anchor, focus) = (anchor.check(&cx.heap)?, focus.check(&cx.heap)?);
        if self.can_select(anchor.node) && self.can_select(focus.node) {
            self.of_document().select_for_script(cx, anchor, focus);
        }
        Ok(())
    }

    pub(crate) fn set_position<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        node: Option<&'a Node>,
        offset: u32,
    ) -> Result<'a> {
        let Some(node) = node else {
            self.clear(cx);
            return Ok(());
        };
        self.select_if_possible(cx, Point::new(node, offset), Point::new(node, offset))
    }

    pub(crate) fn collapse_to_start<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        let start = self.require_range(&cx.heap)?.start();
        self.of_document().select_for_script(cx, start, start);
        Ok(())
    }

    pub(crate) fn collapse_to_end<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        let end = self.require_range(&cx.heap)?.end();
        self.of_document().select_for_script(cx, end, end);
        Ok(())
    }

    pub(crate) fn extend<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node, offset: u32) -> Result<'a> {
        if !self.can_select(node) {
            return Ok(());
        }
        let focus = Point::new(node, offset).check(&cx.heap)?;
        let span = self.require_range(&cx.heap)?;
        let [anchor, _] = self.of_document().directed(span.start(), span.end());
        self.of_document().select_for_script(cx, anchor, focus);
        Ok(())
    }

    pub(crate) fn set_base_and_extent<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        anchor_node: &'a Node,
        anchor_offset: u32,
        focus_node: &'a Node,
        focus_offset: u32,
    ) -> Result<'a> {
        self.select_if_possible(
            cx,
            Point::new(anchor_node, anchor_offset),
            Point::new(focus_node, focus_offset),
        )
    }

    pub(crate) fn select_all_children<'a>(&'a self, cx: Cx<'_, 'a>, node: &'a Node) -> Result<'a> {
        self.select_if_possible(
            cx,
            Point::new(node, 0),
            Point::new(node, node.children().count() as u32),
        )
    }

    pub(crate) fn modify<'a>(
        &'a self,
        cx: Cx<'_, 'a>,
        alter: JsLocal<'a, JSString>,
        direction: JsLocal<'a, JSString>,
        granularity: JsLocal<'a, JSString>,
    ) -> Result<'a> {
        crate::api::ui::seams::modify_selection(
            cx,
            self.of_document(),
            [alter, direction, granularity],
        )
    }

    pub(crate) fn delete_from_document<'a>(&'a self, cx: Cx<'_, 'a>) -> Result<'a> {
        self.of_document()
            .range()
            .map_or(Ok(()), |it| it.delete_contents(cx))
    }

    pub(crate) fn contains_node(&self, node: &Node, allow_partial_containment: bool) -> bool {
        let Some(range) = self
            .of_document()
            .range()
            .filter(|it| it.start().node.root() == node.root())
        else {
            return false;
        };
        let is_left_out = |it: &Node| {
            it.parent().is_some_and(|parent| {
                parent.assigned_nodes().next().is_some() || it.flat_parent().is_none()
            })
        };
        if node.inclusive_ancestors().any(is_left_out) {
            return false;
        }
        let around = if node.kind().is_character_data() {
            Some((Point::new(node, 0), Point::at_end_of(node)))
        } else {
            Point::before(node).zip(Point::after(node))
        };
        around.is_some_and(|(start, end)| {
            let (first, last) = if allow_partial_containment {
                (end, start)
            } else {
                (start, end)
            };
            compare_points(first, range.start()).is_ge()
                && compare_points(last, range.end()).is_le()
        })
    }

    pub(crate) fn text<'a>(&'a self, cx: Cx<'_, 'a>) -> DomString {
        let Some(span) = self.of_document().span().filter(|it| !it.collapsed()) else {
            return DomString::default();
        };
        let control =
            Some(span.start().node.out_of_control()).filter(|it| *it != span.start().node);
        control
            .and_then(|it| crate::api::ui::seams::selected_text_of_control(cx, it))
            .unwrap_or_else(|| {
                self.doc().sync(cx);
                let ends = ends_for_engine(span.start(), span.end());
                self.doc().engine(|engine, _| {
                    DomString::from_utf8(crate::values::text(
                        &engine.selectable_text_of_range(ends),
                    ))
                })
            })
    }

    pub(crate) fn stringify<'a>(&'a self, cx: Cx<'_, 'a>) -> JSValue {
        self.text(cx).to_js(&cx.heap).to_js()
    }
}
