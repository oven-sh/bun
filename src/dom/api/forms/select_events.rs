//! What the mouse and the keys do to a `select`.

use super::option::{is_option, is_selected, select_of, set_dirty, set_selected};
use super::*;
use crate::api::ui::top_layer::set_in_top_layer;
use crate::api::ui::{details, popover};
use crate::api::uievents::{KeyboardEvent, Modifiers, MouseEvent};
use crate::scroll::Alignment;

const TYPE_AHEAD_PAUSE: f64 = 1000.0;

pub(super) fn is_typed(event: &KeyboardEvent) -> bool {
    event.get_key().as_utf8().chars().count() == 1
        && !event
            .modifiers()
            .intersects(Modifiers::CONTROL | Modifiers::ALT | Modifiers::META)
}

fn stepped<'a>(list: &[&'a Element], index: Option<usize>, step: i32) -> Option<&'a Element> {
    list.get(usize::try_from(index.map_or(-1, |it| it as i32) + step).ok()?)
        .copied()
}

impl<'a> Select<'a> {
    fn linked(self, edge: Edge) -> Option<&'a Element> {
        self.element.edge_node(edge)?.as_element()
    }

    fn link(self, cx: &mut Cx<'a>, edge: Edge, option: Option<&'a Element>) {
        self.element.set_edge_node(&cx.heap, edge, option);
    }

    fn highlight(self, cx: &mut Cx<'a>, option: Option<&'a Element>) {
        if let Some(it) = self.linked(Edge::ActiveOption) {
            it.set_state(cx, State::TARGET, false);
        }
        self.link(cx, Edge::ActiveOption, option);
        if let Some(option) = option {
            option.set_state(cx, State::TARGET, true);
            layout::reveal_in_nearest_scroller(cx, option);
        }
    }

    pub(crate) fn set_open(self, cx: &mut Cx<'a>, opens: bool) {
        if opens == self.is_open() {
            return;
        }
        let element = self.element;
        let (Some(ui), Some(popover), Some(picker)) =
            (Ui::left_in(element.doc()), self.popover(), self.picker())
        else {
            return;
        };
        if !opens && popover::is_showing(popover) {
            _ = popover::hide(cx, popover, popover::Hiding::default());
            return;
        }
        if opens && self.has_base_options(cx) {
            return self.open_popover(cx, popover);
        }
        element.set_state(cx, State::PICKER_OPEN, opens);
        set_in_top_layer(cx, ui, picker, opens);
        ui.set_open_picker(opens.then_some(element));
        if !opens {
            return self.highlight(cx, None);
        }
        let (rect, [width, height]) = (
            layout::bounding_rect(cx, element),
            layout::viewport_size(ui.doc()),
        );
        let (top, below) = (rect.y, height - rect.bottom());
        set_part_style(
            cx,
            picker,
            &format!(
                "left:{}px;top:{}px;min-width:{}px",
                rect.x,
                rect.bottom(),
                rect.width
            ),
        );
        let size = layout::bounding_rect(cx, picker);
        let place = match size.height > below && top > below {
            true => format!("bottom:{}px;max-height:{}px", height - top, top - 4.0),
            false => format!("top:{}px;max-height:{}px", rect.bottom(), below - 4.0),
        };
        set_part_style(
            cx,
            picker,
            &format!(
                "left:{}px;min-width:{}px;{place}",
                rect.x.min(width - size.width).max(0.0),
                rect.width
            ),
        );
        self.highlight(cx, self.selected().next());
    }

    fn open_popover(self, cx: &mut Cx<'a>, popover: &'a Element) {
        let element = self.element;
        _ = popover::show(cx, popover, Some(element));
        if !popover::is_showing(popover) {
            return;
        }
        popover::set_previous_focus(popover, element);
        if let Some(ui) = Ui::of(element.doc()) {
            ui.set_select_with_popover(Some(element));
        }
        element.set_state(cx, State::PICKER_OPEN, true);
        let first = focus::autofocus_delegate(cx, element).or_else(|| match self.is_dialog(cx) {
            true => element
                .descendant_elements()
                .find(|it| Some(*it) != self.author_button() && focus::is_focusable(cx, it)),
            false => self
                .selected()
                .chain(self.options())
                .find(|it| focus::is_focusable(cx, it)),
        });
        let is_visible = self.state().is_pressed.get().then_some(false);
        if let Some(it) = first {
            focus::focus(
                cx,
                it,
                focus::Cause::Script,
                focus::Options {
                    is_visible,
                    ..Default::default()
                },
            );
        }
    }

    /// There is more than options to interact with in the picker.
    fn is_dialog(self, cx: &mut Cx<'a>) -> bool {
        let button = self.author_button();
        self.element.descendant_elements().any(|it| {
            !is_option(it)
                && !button.is_some_and(|button| button.contains(it))
                && focus::is_focusable(cx, it)
        })
    }

    pub(crate) fn pick(self, cx: &mut Cx<'a>, chosen: &'a Element) {
        if self.is_drop_down() && !self.is_multiple() {
            let uses_mouse =
                Ui::of(self.element.doc()).is_some_and(|it| it.activation.was_by_mouse.get());
            self.choose(cx, chosen);
            self.set_open(cx, false);
            if uses_mouse {
                self.element.set_state(cx, State::FOCUS_VISIBLE, false);
            }
        } else if !self.is_multiple() && !is_selected(chosen) {
            self.choose(cx, chosen);
        } else {
            set_selected(cx, chosen, !is_selected(chosen));
            set_dirty(chosen, true);
            user_changed(cx, self.element);
        }
    }

    fn scroller(self) -> &'a Element {
        self.popover()
            .filter(|_| self.is_drop_down())
            .unwrap_or(self.element)
    }

    /// The farthest one that is in view, or else a page away.
    fn page_from(
        self,
        cx: &mut Cx<'a>,
        all: &[&'a Element],
        index: usize,
        is_down: bool,
    ) -> Option<&'a Element> {
        let view = layout::bounding_rect(cx, self.scroller());
        let rects: Vec<_> = all.iter().map(|it| layout::bounding_rect(cx, it)).collect();
        let edge = |it: &crate::abi::Rect| if is_down { it.bottom() } else { -it.y };
        let farthest = |limit: f32| {
            let fits = |it: &usize| edge(&rects[*it]) <= limit + 0.5;
            if is_down {
                (index + 1..all.len()).take_while(fits).last()
            } else {
                (0..index).rev().take_while(fits).last()
            }
        };
        let own = rects.get(index)?;
        Some(
            all[farthest(edge(&view))
                .or_else(|| farthest(edge(own) + view.height - own.height))
                .unwrap_or(index)],
        )
    }

    fn is_typing(self, event: &Event) -> bool {
        self.state()
            .typed_at
            .get()
            .is_some_and(|it| event.time() - it < TYPE_AHEAD_PAUSE)
    }

    fn type_ahead(
        self,
        event: &KeyboardEvent,
        enabled: &[&'a Element],
        index: Option<usize>,
    ) -> Option<&'a Element> {
        let mut typed = self.state().typed.borrow_mut();
        if !self.is_typing(event) {
            typed.clear();
        }
        let from = index.map_or(0, |it| it + usize::from(typed.is_empty()));
        typed.push_str(&event.get_key().as_utf8().to_lowercase());
        self.state().typed_at.set(Some(event.time()));
        enabled[from..]
            .iter()
            .chain(&enabled[..from])
            .find(|it| {
                option::label(it)
                    .to_utf8()
                    .to_lowercase()
                    .starts_with(&*typed)
            })
            .copied()
    }

    fn key_in_base_list(self, cx: &mut Cx<'a>, event: &'a KeyboardEvent, origin: &'a Node) -> bool {
        let key = event.key();
        let own = origin.as_element().filter(|it| {
            is_option(it) && select_of(it).is_some_and(|it| it.element == self.element)
        });
        if key == atom!("Tab") {
            if self.is_drop_down() && !self.is_dialog(cx) {
                self.set_open(cx, false);
            }
            return false;
        }
        if let Some(option) =
            own.filter(|_| key == atom!("Enter") || key == atom!(" ") && !self.is_typing(event))
        {
            self.pick(cx, option);
            return true;
        }
        if matches!(
            origin.html_tag(),
            atom!("select") | atom!("input") | atom!("textarea")
        ) {
            return false;
        }
        let all = self.focusable_options(cx);
        let index = origin
            .closest_html(atom!("option"))
            .and_then(|around| all.iter().position(|it| *it == around));
        let next = match (key, arrow_step(key)) {
            (_, Some(step)) => {
                let (flow, is_sideways) = (
                    writing_mode(cx, self.scroller()),
                    matches!(key, atom!("ArrowLeft") | atom!("ArrowRight")),
                );
                let step = if is_sideways && flow.sides()[0] == 1 {
                    -step
                } else {
                    step
                };
                let before = || {
                    all.iter()
                        .filter(|it| it.compare_order(origin).is_lt())
                        .count() as i32
                        - i32::from(step > 0)
                };
                let from = index.map_or_else(before, |it| it as i32);
                stepped(&all, None, from + step + 1).filter(|_| !is_sideways || flow.is_vertical())
            }
            (atom!("Home"), _) => all.first().copied(),
            (atom!("End"), _) => all.last().copied(),
            (atom!("PageUp") | atom!("PageDown"), _) => {
                self.page_from(cx, &all, index.unwrap_or(0), key == atom!("PageDown"))
            }
            _ if own.is_some() && is_typed(event) => self.type_ahead(event, &all, index),
            _ => return false,
        };
        if let Some(next) = next {
            focus::focus(cx, next, focus::Cause::Keyboard, focus::WITHOUT_SCROLLING);
            layout::scroll_into_view(cx, next, Alignment::Nearest);
        }
        true
    }

    fn is_in_list(self, origin: &Node) -> bool {
        !self.is_drop_down() || self.popover().is_some_and(|it| it.contains_flat(origin))
    }

    fn key_in_base(self, cx: &mut Cx<'a>, event: &'a KeyboardEvent, origin: &'a Node) -> bool {
        if self.is_in_list(origin) {
            return self.key_in_base_list(cx, event, origin);
        }
        if arrow_step(event.key()).is_some() {
            self.set_open(cx, true);
            return true;
        }
        IS_MAC && event.key() == atom!("Enter") || self.key_down(cx, event)
    }

    fn mouse_in_base(self, cx: &mut Cx<'a>, event: &'a MouseEvent, origin: &'a Node) -> bool {
        let (state, mouse) = (self.state(), event.mouse());
        match event.name() {
            _ if mouse.button != 0 => {}
            atom!("mousedown") => {
                state.is_pressed.set(true);
                state.opened_at.set(None);
                if !self.is_in_list(origin) {
                    self.set_open(cx, !self.is_open());
                    state.opened_at.set(Some(mouse.client));
                    return true;
                }
            }
            atom!("mouseup") if state.is_pressed.take() => {
                let has_just_opened = state
                    .opened_at
                    .get()
                    .is_some_and(|[x, y]| (mouse.client[0] - x).hypot(mouse.client[1] - y) < 5.0);
                if let Some(chosen) = origin
                    .closest_html(atom!("option"))
                    .filter(|_| !has_just_opened && self.is_in_list(origin))
                    && select_of(chosen).is_some_and(|it| it.element == self.element)
                    && !is_disabled(chosen)
                    && !details::is_in_interactive_content(origin, chosen)
                {
                    self.pick(cx, chosen);
                }
            }
            _ => {}
        }
        false
    }

    fn move_to(self, cx: &mut Cx<'a>, option: Option<&'a Element>) {
        let Some(option) = option else { return };
        if !self.is_open() {
            self.choose(cx, option);
        }
        if self.is_open() || !self.is_drop_down() {
            self.link(cx, Edge::AnchorOption, Some(option));
            self.highlight(cx, Some(option));
        }
    }

    fn key_down(self, cx: &mut Cx<'a>, event: &'a KeyboardEvent) -> bool {
        let (key, active) = (event.key(), self.linked(Edge::ActiveOption));
        let is_arrow = matches!(key, atom!("ArrowUp") | atom!("ArrowDown"));
        let toggles = is_arrow && event.get_alt_key();
        if self.is_open()
            && (toggles || matches!(key, atom!("Enter") | atom!("Tab") | atom!("Escape")))
        {
            self.set_open(cx, false);
            if let Some(it) = active.filter(|_| key != atom!("Escape")) {
                self.choose(cx, it);
            }
            return key != atom!("Tab");
        }
        let opens = toggles
            || is_arrow && IS_MAC
            || matches!(key, atom!("Enter") | atom!("F4"))
            || key == atom!(" ") && !self.is_typing(event);
        if opens && !self.is_open() && self.is_drop_down() {
            self.set_open(cx, true);
            return true;
        }
        let enabled: Vec<_> = self
            .options()
            .filter(|it| !is_disabled(it) && !it.has_attr(atom!("hidden")))
            .collect();
        let index = active
            .or_else(|| self.selected().next())
            .and_then(|current| enabled.iter().position(|it| *it == current));
        let next = match (key, arrow_step(key)) {
            (_, Some(step)) => {
                let is_reversed = !is_arrow
                    && !self.is_drop_down()
                    && writing_mode(cx, self.element).sides()[0] == 1;
                stepped(&enabled, index, if is_reversed { -step } else { step })
            }
            (atom!("Home"), _) => enabled.first().copied(),
            (atom!("End"), _) => enabled.last().copied(),
            (atom!("PageUp"), _) => {
                stepped(&enabled, index, -10).or_else(|| enabled.first().copied())
            }
            (atom!("PageDown"), _) => {
                stepped(&enabled, index, 10).or_else(|| enabled.last().copied())
            }
            _ if is_typed(event) => self.type_ahead(event, &enabled, index),
            _ => return false,
        };
        self.move_to(cx, next);
        true
    }

    fn press_in_list(self, cx: &mut Cx<'a>, chosen: &'a Element, modifiers: Modifiers) {
        if let Some(anchor) = self
            .linked(Edge::AnchorOption)
            .filter(|_| self.is_multiple() && modifiers.contains(Modifiers::SHIFT))
        {
            let [a, b] =
                [anchor, chosen].map(|end| self.options().position(|it| it == end).unwrap_or(0));
            for (index, option) in self.options().enumerate() {
                set_selected(
                    cx,
                    option,
                    (a.min(b)..=a.max(b)).contains(&index) && !is_disabled(option),
                );
            }
            return user_changed(cx, self.element);
        }
        self.link(cx, Edge::AnchorOption, Some(chosen));
        self.link(cx, Edge::ActiveOption, Some(chosen));
        let is_tap = || Ui::of(chosen.doc()).is_some_and(|it| it.pointer().tapped_by().is_some());
        if self.is_multiple()
            && (modifiers.intersects(Modifiers::CONTROL | Modifiers::META) || is_tap())
        {
            self.pick(cx, chosen)
        } else {
            self.choose(cx, chosen)
        }
    }

    fn mouse(self, cx: &mut Cx<'a>, event: &'a MouseEvent, origin: &'a Node) {
        let chosen = origin
            .closest_html(atom!("option"))
            .filter(|it| !is_disabled(it));
        match (event.name(), chosen) {
            (atom!("mousedown"), Some(chosen)) if !self.is_drop_down() => {
                self.press_in_list(cx, chosen, event.modifiers())
            }
            _ if !self.is_drop_down() => {}
            (atom!("mousedown"), _) => {
                if event.get_button() == 0
                    && !self.picker().is_some_and(|it| it.contains_flat(origin))
                {
                    self.set_open(cx, !self.is_open());
                }
            }
            (atom!("mousemove"), Some(_))
                if self.is_open() && chosen != self.linked(Edge::ActiveOption) =>
            {
                self.highlight(cx, chosen)
            }
            (atom!("mouseup"), Some(chosen)) if self.is_open() && self.is_multiple() => {
                self.pick(cx, chosen)
            }
            (atom!("mouseup"), Some(chosen)) if self.is_open() => {
                self.set_open(cx, false);
                self.choose(cx, chosen);
            }
            _ => {}
        }
    }

    pub(super) fn default_action(
        self,
        cx: &mut Cx<'a>,
        event: &'a Event,
        origin: &'a Node,
    ) -> bool {
        let name = event.name();
        if is_disabled(self.element) {
            return false;
        }
        let is_base = name != atom!("mousemove") && self.has_base_options(cx);
        if let Some(event) = event.downcast::<KeyboardEvent>() {
            return name == atom!("keydown")
                && if is_base {
                    self.key_in_base(cx, event, origin)
                } else {
                    self.key_down(cx, event)
                };
        }
        let Some(event) = event.downcast::<MouseEvent>() else {
            return false;
        };
        if is_base {
            return self.mouse_in_base(cx, event, origin);
        }
        self.mouse(cx, event, origin);
        false
    }
}
