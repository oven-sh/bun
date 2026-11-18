//! What `input` and `textarea` share.

use super::validity::Validity;
use bun_jsc::Weak;

use super::*;
use crate::api::range::OpaqueRange;
use crate::generated_bindgen::forms::{HasSelection, SelectionMode};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Direction {
    None,
    Forward,
    Backward,
}

impl Default for Direction {
    fn default() -> Self {
        if IS_MAC {
            Direction::None
        } else {
            Direction::Forward
        }
    }
}

impl Direction {
    fn parse(name: &Atom) -> Direction {
        match name.known() {
            atom!("forward") => Direction::Forward,
            atom!("backward") => Direction::Backward,
            _ => Direction::default(),
        }
    }
}

struct Snapshot {
    text: DomString,
    selection: [u32; 2],
    /// At the other end of the step.
    other_selection: [u32; 2],
}

#[derive(Default)]
pub(crate) struct TextState {
    pub(super) control: Control,
    /// What the editor shows.
    text: RefCell<DomString>,
    pub(super) is_dirty: Cell<bool>,
    start: Cell<u32>,
    end: Cell<u32>,
    direction: Cell<Direction>,
    /// The value when the user began to change it.
    committed: RefCell<Option<DomString>>,
    pub(super) last_edit_was_by_user: Cell<bool>,
    undos: RefCell<Vec<Snapshot>>,
    redos: RefCell<Vec<Snapshot>>,
    last_input_type: Cell<Option<Known>>,
    /// `select` is due even if nothing is selected.
    has_set_selection: Cell<bool>,
    value_ranges: ValueRanges,
}

#[derive(Default)]
struct ValueRanges(RefCell<Vec<Weak<()>>>);

impl ValueRanges {
    fn push(&self, heap: &JsHeap<'_>, range: &OpaqueRange) {
        let mut all = self.0.borrow_mut();
        all.retain(|it| it.get().is_some());
        all.push(Weak::create_passive(range.to_js(), global_of(heap)));
    }

    fn for_each(&self, visit: impl FnMut(&OpaqueRange)) {
        self.0
            .borrow()
            .iter()
            .filter_map(|it| OpaqueRange::from_value(it.get()?))
            .filter(|it| it.control().is_some())
            .for_each(visit);
    }
}

#[derive(Clone, Copy)]
pub(crate) struct TextControl<'a> {
    pub(crate) element: &'a Element,
    pub(super) state: &'a TextState,
}

/// Edits of such a type are undone together.
pub(crate) fn continues_typing(input_type: Known) -> bool {
    matches!(
        input_type,
        atom!("insertText")
            | atom!("insertCompositionText")
            | atom!("deleteContentBackward")
            | atom!("deleteContentForward")
    )
}

impl<'a> TextControl<'a> {
    pub(super) fn of(element: &'a Element) -> Option<TextControl<'a>> {
        match element.html_tag() {
            atom!("input") => Some(Input::new(element).text),
            atom!("textarea") => Some(TextControl::of_textarea(element)),
            _ => None,
        }
    }

    pub(super) fn of_input(element: &'a Element, state: &'a TextState) -> TextControl<'a> {
        TextControl { element, state }
    }

    pub(super) fn of_textarea(element: &'a Element) -> TextControl<'a> {
        TextControl {
            element,
            state: element.extra(),
        }
    }

    /// `None` for a `textarea`.
    pub(crate) fn kind(self) -> Option<InputType> {
        input_type(self.element)
    }

    pub(super) fn has_editor(self) -> bool {
        self.kind().is_none_or(InputType::has_editor)
    }

    fn supports_selection(self) -> bool {
        self.kind().is_none_or(InputType::supports_selection)
    }

    pub(crate) fn is_password(self) -> bool {
        self.kind() == Some(InputType::Password)
    }

    pub(crate) fn text(self) -> DomString {
        self.state.text.borrow().clone()
    }

    pub(crate) fn len(self) -> u32 {
        self.state.text.borrow().len()
    }

    pub(super) fn put_text(self, text: DomString) {
        self.state.text.replace(text);
        self.put_selection(self.state.start.get(), self.state.end.get());
    }

    pub(crate) fn value(self) -> DomString {
        Input::of(self.element).map_or_else(|| self.text(), Input::value)
    }

    pub(crate) fn selection(self) -> [u32; 2] {
        [self.state.start.get(), self.state.end.get()]
    }

    pub(super) fn put_selection(self, start: u32, end: u32) {
        self.state.end.set(end.min(self.len()));
        self.state.start.set(start.min(self.state.end.get()));
    }

    pub(crate) fn is_mutable(self) -> bool {
        !self.element.has_attr(atom!("readonly")) && !is_disabled(self.element)
    }

    pub(crate) fn editor(self) -> Option<&'a Element> {
        let element = self.element;
        if !element.has(NodeFlags::HOST)
            && element.is_rendered()
            && element.is_html(atom!("input"))
            && !element.adopt_parts()
        {
            self.leave_text_to_engine();
            element.engine(|engine, id| engine.provide_parts(id));
        }
        self.editor_if_any()
    }

    fn editor_if_any(self) -> Option<&'a Element> {
        if !self.element.has(NodeFlags::HOST) {
            self.element.adopt_parts();
        }
        self.element.edge_node(Edge::Editor)?.as_element()
    }

    fn leave_text_to_engine(self) {
        if self.element.is_rendered() && self.kind().is_some_and(InputType::has_editor) {
            self.element
                .engine(|engine, id| engine.set_text_to_show(id, &self.state.text.borrow()));
        }
    }

    pub(crate) fn editor_text(self) -> Option<&'a Node> {
        self.editor()?.first_child()
    }

    pub(super) fn disconnect_value_ranges(self, cx: &mut Cx<'a>) {
        self.state
            .value_ranges
            .0
            .take()
            .iter()
            .filter_map(|it| OpaqueRange::from_value(it.get()?))
            .for_each(|it| it.disconnect(cx));
    }

    pub(super) fn build_editor(self, cx: &mut Cx<'a>, parent: &'a Node) {
        let editor = div(cx, self.element, parent, "-internal-editor");
        text_in(cx, editor, "");
        self.element
            .set_edge(&cx.heap, Edge::Editor, editor.value());
    }

    pub(super) fn render(self, cx: &mut Cx<'a>) {
        let (element, state, text) = (self.element, self.state, self.text());
        let placeholder = element
            .attr(atom!("placeholder"))
            .filter(|_| is_typed_in(element));
        element.set_state(
            cx,
            State::PLACEHOLDER_SHOWN,
            placeholder.is_some() && text.is_empty(),
        );
        let Some(editor) = self.editor_if_any() else {
            return self.leave_text_to_engine();
        };
        if let Some((placeholder, parent)) = placeholder.zip(editor.parent()) {
            let shown = editor
                .previous_sibling()
                .and_then(Node::first_child)
                .unwrap_or_else(|| {
                    let part = part_before(
                        cx,
                        element,
                        parent,
                        "placeholder",
                        atom!("div"),
                        Some(editor),
                    );
                    text_in(cx, part, "")
                });
            set_text(
                cx,
                Some(shown),
                &if element.is_html(atom!("input")) {
                    without_newlines(&placeholder)
                } else {
                    normalize_newlines(&placeholder)
                },
            );
        }
        let Some(shown) = editor.first_child().filter(|it| it.text() != text) else {
            return;
        };
        let ([start, end], direction) = (self.selection(), state.direction.get());
        set_text(cx, Some(shown), &text);
        match (text.units().next_back() == Some(10), shown.next_sibling()) {
            (false, Some(line_break)) => remove(cx, line_break, Observers::Suppress),
            (true, None) => {
                let line_break = element.doc().create_html(&cx.heap, atom!("br"));
                insert(cx, line_break, editor, None, Observers::Suppress);
            }
            _ => {}
        }
        self.put_selection(start, end);
        state.direction.set(direction);
        self.show_selection(cx);
    }

    pub(crate) fn show_selection(self, cx: &mut Cx<'a>) {
        let editor = if focus::has_focus(self.element) {
            self.editor()
        } else {
            self.element
                .edge_node(Edge::Editor)
                .and_then(Node::as_element)
        };
        let Some(node) = editor.and_then(|it| it.first_child()) else {
            return;
        };
        let is_here = || {
            range::try_selection(node.doc())
                .and_then(Selection::range)
                .is_some_and(|it| it.start().node == node)
        };
        if focus::has_focus(self.element) || is_here() {
            let [start, end] = self.selection().map(|offset| Point { node, offset });
            let (anchor, focus) = if self.state.direction.get() == Direction::Backward {
                (end, start)
            } else {
                (start, end)
            };
            range::selection_of(&cx.heap, node.doc()).select(cx, anchor, focus);
        }
    }

    /// In the value, of a point in the editor.
    fn offset_of(self, point: Point<'_>) -> u32 {
        if point.node.is_text() || point.offset == 0 {
            point.offset.min(self.len())
        } else {
            self.len()
        }
    }

    /// Its own selection, if a script has selected something else.
    pub(crate) fn offsets_of(self, span: [Point<'_>; 2]) -> [u32; 2] {
        let is_inside = self
            .editor()
            .is_some_and(|editor| span.iter().all(|it| editor.contains(it.node)));
        if is_inside {
            span.map(|it| self.offset_of(it))
        } else {
            self.selection()
        }
    }

    /// The selection of the document has changed, and it is in the editor.
    pub(crate) fn read_selection(self, range: &Range, is_backward: bool) {
        let state = self.state;
        state.start.set(self.offset_of(range.start()));
        state.end.set(self.offset_of(range.end()));
        if is_backward {
            state.direction.set(Direction::Backward);
        } else if state.direction.get() == Direction::Backward {
            state.direction.set(Direction::Forward);
        }
    }

    /// https://html.spec.whatwg.org/#set-the-selection-range
    pub(crate) fn select(self, cx: &mut Cx<'a>, start: u32, end: u32, direction: Direction) {
        let (state, before) = (self.state, self.selection());
        self.put_selection(start, end);
        if state.direction.replace(direction) == direction && before == self.selection() {
            return;
        }
        state.has_set_selection.set(true);
        state.last_input_type.set(None);
        render(cx, self.element);
        self.show_selection(cx);
        if let Some(ui) = Ui::of(self.element.doc()) {
            crate::api::editing::schedule_selection_events(cx, ui, self.element);
        }
    }

    pub(crate) fn select_all(self, cx: &mut Cx<'a>) {
        self.select(cx, 0, u32::MAX, Direction::default());
    }

    pub(crate) fn take_select_event(self) -> bool {
        self.state.has_set_selection.take() || self.state.start != self.state.end
    }

    pub(crate) fn selected_text(self) -> DomString {
        let [start, end] = self.selection();
        if self.is_password() {
            DomString::default()
        } else {
            self.text().substring(start, end - start)
        }
    }

    fn replace_from_script(self, cx: &mut Cx<'a>, text: DomString, start: u32, end: u32) {
        let state = self.state;
        state.is_dirty.set(true);
        state.last_edit_was_by_user.set(false);
        if text == *state.text.borrow() {
            return;
        }
        state
            .value_ranges
            .for_each(|it| it.replaced(start, end - start, text.len() + end - start - self.len()));
        self.put_text(text);
        self.put_selection(u32::MAX, u32::MAX);
        state.direction.take();
        state.undos.take();
        state.redos.take();
        self.changed(cx);
    }

    pub(super) fn set_from_script(self, cx: &mut Cx<'a>, text: DomString) {
        self.replace_from_script(cx, text, 0, self.len());
    }

    pub(super) fn set_default(self, cx: &mut Cx<'a>, text: DomString) {
        let ([start, end], changes) = (self.selection(), text != *self.state.text.borrow());
        self.set_from_script(cx, text);
        self.state.is_dirty.set(false);
        if changes && !focus::has_focus(self.element) {
            self.put_selection(start, end);
        }
    }

    pub(super) fn copy_to(self, copy: TextControl<'_>) {
        copy.put_text(self.text());
        copy.state.is_dirty.set(self.state.is_dirty.get());
        copy.state
            .last_edit_was_by_user
            .set(self.state.last_edit_was_by_user.get());
    }

    fn changed(self, cx: &mut Cx<'a>) {
        if focus::has_focus(self.element) {
            render(cx, self.element);
        }
        dirty(cx, self.element);
    }

    fn limit(self, name: Known) -> Option<u32> {
        self.element.integer(name)?.try_into().ok()
    }

    /// What may be typed or pasted in place of `start..end`.
    pub(crate) fn filter(self, inserted: &DomString, start: u32, end: u32) -> DomString {
        let inserted = match self.kind() {
            None => normalize_newlines(inserted),
            Some(InputType::Number) => return self.filter_for_number(inserted, start, end),
            Some(_) => on_one_line(inserted),
        };
        let Some(max) = self.limit(atom!("maxlength")) else {
            return inserted;
        };
        let room = max.saturating_sub(self.len() - (end - start));
        let splits_pair =
            room > 0 && room < inserted.len() && inserted.unit(room - 1) & 0xfc00 == 0xd800;
        inserted.substring(0, room - u32::from(splits_pair))
    }

    fn filter_for_number(self, inserted: &DomString, start: u32, end: u32) -> DomString {
        let text: Vec<u8> = self.text().units().map(|it| it.min(0xff) as u8).collect();
        let (mut left, right) = (text[..start as usize].to_vec(), &text[end as usize..]);
        for typed in inserted.units().filter_map(|it| u8::try_from(it).ok()) {
            if input_type::fits_in_number(&left, typed, right) {
                left.push(typed);
            }
        }
        DomString::from_latin1(&left[start as usize..])
    }

    pub(super) fn was_last_edited_by_user(self) -> bool {
        self.state.last_edit_was_by_user.get()
    }

    pub(super) fn begin_edit(self) {
        if self.state.committed.borrow().is_none() {
            self.state.committed.replace(Some(self.value()));
        }
    }

    /// By the user.
    pub(crate) fn edit(
        self,
        cx: &mut Cx<'a>,
        start: u32,
        end: u32,
        inserted: &DomString,
        input_type: Known,
    ) {
        let (state, old) = (self.state, self.text());
        self.begin_edit();
        if state.last_input_type.get() != Some(input_type) || !continues_typing(input_type) {
            state.undos.borrow_mut().push(Snapshot {
                text: old.clone(),
                selection: self.selection(),
                other_selection: [0; 2],
            });
        }
        state.redos.take();
        state
            .value_ranges
            .for_each(|it| it.replaced(start, end - start, inserted.len()));
        let (text, caret) = (
            DomString::concat(&[&old.prefix(start), inserted, &old.substring(end, u32::MAX)]),
            start + inserted.len(),
        );
        state
            .undos
            .borrow_mut()
            .last_mut()
            .into_iter()
            .for_each(|it| it.other_selection = [caret; 2]);
        self.restore(cx, text, [caret; 2]);
        state.last_input_type.set(Some(input_type));
    }

    fn restore(self, cx: &mut Cx<'a>, text: DomString, [start, end]: [u32; 2]) {
        let state = self.state;
        self.put_text(text);
        self.put_selection(start, end);
        state.is_dirty.set(true);
        state.last_edit_was_by_user.set(true);
        state.last_input_type.set(None);
        self.changed(cx);
        self.show_selection(cx);
    }

    fn history(self, is_undo: bool) -> &'a RefCell<Vec<Snapshot>> {
        if is_undo {
            &self.state.undos
        } else {
            &self.state.redos
        }
    }

    pub(crate) fn can_travel(self, is_undo: bool) -> bool {
        !self.history(is_undo).borrow().is_empty()
    }

    pub(crate) fn travel(self, cx: &mut Cx<'a>, is_undo: bool) -> bool {
        let Some(snapshot) = self.history(is_undo).borrow_mut().pop() else {
            return false;
        };
        self.begin_edit();
        self.history(!is_undo).borrow_mut().push(Snapshot {
            text: self.text(),
            selection: snapshot.other_selection,
            other_selection: snapshot.selection,
        });
        let (old, new) = (self.text(), &snapshot.text);
        self.state.value_ranges.for_each(|it| {
            let same = old
                .units()
                .zip(new.units())
                .take_while(|(a, b)| a == b)
                .count() as u32;
            let kept = old
                .units()
                .rev()
                .zip(new.units().rev())
                .take_while(|(a, b)| a == b)
                .count() as u32;
            let kept = kept.min(old.len().min(new.len()) - same);
            it.replaced(same, old.len() - kept - same, new.len() - kept - same);
        });
        self.restore(cx, snapshot.text, snapshot.selection);
        true
    }

    pub(super) fn commit(self, cx: &mut Cx<'a>) {
        let Some(committed) = self.state.committed.take() else {
            return;
        };
        self.state.control.was_edited.set(true);
        dirty(cx, self.element);
        if committed != self.value() {
            fire(cx, self.element, atom!("change"), BUBBLES);
        }
    }

    pub(super) fn length_errors(self, length: u32) -> Validity {
        if !self.state.last_edit_was_by_user.get() {
            Validity::empty()
        } else if self.limit(atom!("maxlength")).is_some_and(|it| length > it) {
            Validity::TOO_LONG
        } else if length > 0 && self.limit(atom!("minlength")).is_some_and(|it| length < it) {
            Validity::TOO_SHORT
        } else {
            Validity::empty()
        }
    }
}

fn on_one_line(text: &DomString) -> DomString {
    let text = normalize_newlines(text);
    if !text.units().any(|it| it == 10) {
        return text;
    }
    let length = text.len() as usize - text.units().rev().take_while(|it| *it == 10).count();
    let mut out = StringBuilder::with_capacity(length);
    text.units()
        .take(length)
        .for_each(|it| out.push_unit(if it == 10 { 32 } else { it }));
    out.finish()
}

pub(super) fn removed<'a>(cx: &mut Cx<'a>, element: &'a Element, scope: &'a Node, is_move: bool) {
    if let Some(it) = TextControl::of(element) {
        it.disconnect_value_ranges(cx);
    }
    super::removed(cx, element, scope, is_move);
}

impl HasSelection {
    fn selectable(&self) -> Option<TextControl<'_>> {
        TextControl::of(self).filter(|it| it.supports_selection())
    }

    fn require<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, TextControl<'_>> {
        self.selectable().ok_or_else(|| {
            dom_error(
                heap,
                DomError::InvalidStateError,
                "The input element's type does not support selection.",
            )
        })
    }

    pub(crate) fn get_selection_start(&self) -> Option<u32> {
        self.selectable().map(|it| it.state.start.get())
    }

    pub(crate) fn set_selection_start<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        value: Option<u32>,
    ) -> bindgen::Result<'a, ()> {
        let (it, start) = (self.require(&cx.heap)?, value.unwrap_or(0));
        it.select(
            cx,
            start,
            start.max(it.state.end.get()),
            it.state.direction.get(),
        );
        Ok(())
    }

    pub(crate) fn get_selection_end(&self) -> Option<u32> {
        self.selectable().map(|it| it.state.end.get())
    }

    pub(crate) fn set_selection_end<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        value: Option<u32>,
    ) -> bindgen::Result<'a, ()> {
        let it = self.require(&cx.heap)?;
        it.select(
            cx,
            it.state.start.get(),
            value.unwrap_or(0),
            it.state.direction.get(),
        );
        Ok(())
    }

    pub(crate) fn get_selection_direction(&self) -> Option<Known> {
        self.selectable().map(|it| {
            [atom!("none"), atom!("forward"), atom!("backward")][it.state.direction.get() as usize]
        })
    }

    pub(crate) fn set_selection_direction<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        value: Option<&Atom>,
    ) -> bindgen::Result<'a, ()> {
        let it = self.require(&cx.heap)?;
        it.select(
            cx,
            it.state.start.get(),
            it.state.end.get(),
            value.map(Direction::parse).unwrap_or_default(),
        );
        Ok(())
    }

    pub(crate) fn select<'a>(&'a self, cx: &mut Cx<'a>) {
        let Some(it) = TextControl::of(self).filter(|_| is_typed_in(self)) else {
            return;
        };
        it.select_all(cx);
        focus::focus(cx, self, focus::Cause::Script, focus::WITHOUT_SCROLLING);
        it.show_selection(cx);
        if let Some(it) = Ui::of(self.doc()) {
            it.editing.note_selection();
        }
    }

    pub(crate) fn set_selection_range<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        start: u32,
        end: u32,
        direction: Option<&Atom>,
    ) -> bindgen::Result<'a, ()> {
        self.require(&cx.heap)?.select(
            cx,
            start,
            end,
            direction.map(Direction::parse).unwrap_or_default(),
        );
        Ok(())
    }

    pub(crate) fn create_value_range<'a>(
        &self,
        heap: &JsHeap<'a>,
        start: u32,
        end: u32,
    ) -> bindgen::Result<'a, &'a OpaqueRange> {
        let it = self.selectable().ok_or_else(|| {
            dom_error(
                heap,
                DomError::NotSupportedError,
                "The input element's type has no value ranges.",
            )
        })?;
        if start.max(end) > it.len() {
            return Err(dom_error(
                heap,
                DomError::IndexSizeError,
                "An offset is larger than the value's length.",
            ));
        }
        let range = OpaqueRange::new(heap, self.doc(), self.to_js(), start, start.max(end));
        it.state.value_ranges.push(heap, range);
        Ok(range)
    }

    pub(crate) fn replace_selected_text<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        replacement: &DomString,
    ) -> bindgen::Result<'a, ()> {
        let [start, end] = self.require(&cx.heap)?.selection();
        self.set_range_text(cx, replacement, start, end, SelectionMode::Preserve)
    }

    /// https://html.spec.whatwg.org/#dom-textarea/input-setrangetext
    pub(crate) fn set_range_text<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        replacement: &DomString,
        start: u32,
        end: u32,
        mode: SelectionMode,
    ) -> bindgen::Result<'a, ()> {
        let it = self.require(&cx.heap)?;
        if start > end {
            return Err(dom_error(
                &cx.heap,
                DomError::IndexSizeError,
                "The start is larger than the end.",
            ));
        }
        let (old, before) = (it.text(), it.selection());
        let [start, end] = [start, end].map(|it| it.min(old.len()));
        let after = start + replacement.len();
        it.replace_from_script(
            cx,
            DomString::concat(&[
                &old.prefix(start),
                replacement,
                &old.substring(end, u32::MAX),
            ]),
            start,
            end,
        );
        it.state.start.set(before[0]);
        it.state.end.set(before[1]);
        let moved = |at: u32, inside: u32| {
            if at > end {
                at + after - end
            } else if at > start {
                inside
            } else {
                at
            }
        };
        let [first, last] = match mode {
            SelectionMode::Select => [start, after],
            SelectionMode::Start => [start, start],
            SelectionMode::End => [after, after],
            SelectionMode::Preserve => [moved(before[0], start), moved(before[1], after)],
        };
        it.select(cx, first, last, Direction::default());
        Ok(())
    }
}
