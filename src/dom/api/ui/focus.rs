//! https://html.spec.whatwg.org/#focus

use core::cell::Cell;

use super::prelude::*;
use super::{details, image_map, interest, tabbing, top_layer};
use crate::api::editing;
use crate::api::forms::{self, InputType};
use crate::api::frames::{self, Frame};
use crate::api::uievents::FocusEvent;
use crate::name::Map;
use crate::scroll::Alignment;
use crate::tree::NodeId;
use crate::types::Display;

#[derive(Default)]
pub(crate) struct Focus {
    pub(super) serial: Cell<u32>,
    /// But for those that come with leaving a frame.
    pub(crate) changes: Cell<u32>,
    pub(crate) gap: Cell<tabbing::Gap>,
    pub(crate) is_tabbing: Cell<bool>,
    pub(crate) was_by_mouse: Cell<bool>,
    had_key: Cell<bool>,
    is_hidden: Cell<bool>,
    /// A frame only gets the events if a script has focused its element.
    tells_frame: Cell<bool>,
    /// A scroll marker or a scroll button has it.
    pub(crate) is_on_scroll_control: Cell<bool>,
    pub(crate) has_autofocused: Cell<bool>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum Cause {
    Script,
    Mouse,
    Keyboard,
}

#[derive(Clone, Copy, Default)]
pub(crate) struct Options {
    pub(crate) prevents_scroll: bool,
    /// What has the focus already is not scrolled into view again.
    pub(crate) leaves_focused_alone: bool,
    pub(crate) is_visible: Option<bool>,
}

pub(crate) const WITHOUT_SCROLLING: Options = Options {
    prevents_scroll: true,
    leaves_focused_alone: true,
    is_visible: None,
};

pub(crate) fn focused(doc: &Doc) -> Option<&Element> {
    Ui::left_in(doc)?.focused()
}

pub(crate) fn has_focus(element: &Element) -> bool {
    focused(element.doc()) == Some(element)
}

pub(crate) fn is_editing_host<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    let doc = element.doc();
    (element.has_attr(atom!("contenteditable"))
        || doc.is(DocFlags::DESIGN_MODE) && element.parent() == Some(doc))
        && looks_like(cx, element, Looks::EDITABLE)
        && !element
            .parent_element()
            .is_some_and(|it| looks_like(cx, it, Looks::EDITABLE))
}

/// The outermost editable element around the node.
pub(crate) fn editing_host<'a>(cx: &mut Cx<'a>, node: &'a Node) -> Option<&'a Element> {
    let first = node.as_element().or_else(|| node.parent_element());
    core::iter::successors(first, |it| it.parent_element())
        .take_while(|it| looks_like(cx, it, Looks::EDITABLE))
        .last()
}

pub(crate) fn is_inert<'a>(cx: &mut Cx<'a>, node: &'a Node) -> bool {
    top_layer::top_modal(node.doc()).is_some_and(|it| !it.contains_flat(node))
        || looks_like(cx, node, Looks::INERT)
}

fn supports_focus<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    if element.has(NodeFlags::USER_AGENT) || forms::is_disabled(element) {
        return details::is_default_summary(element);
    }
    if element.integer(atom!("tabindex")).is_some() {
        return true;
    }
    match element.html_tag() {
        atom!("a") | atom!("area") => element.has_attr(atom!("href")),
        atom!("input") => forms::input_type(element) != Some(InputType::Hidden),
        atom!("select") => !forms::select::is_base_list_box(cx, element),
        atom!("button")
        | atom!("textarea")
        | atom!("iframe")
        | atom!("frame")
        | atom!("dialog") => true,
        atom!("object") | atom!("embed") => Frame::of(element).is_some(),
        atom!("option") => forms::select::is_focusable_option(cx, element),
        atom!("audio") | atom!("video") => element.has_attr(atom!("controls")),
        atom!("summary") if details::is_summary(element) => true,
        _ => match element.ns() {
            Ns::Html => is_editing_host(cx, element),
            Ns::Svg => element.local() == atom!("a") && element.has_href(),
            _ => false,
        },
    }
}

fn is_reachable<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    if element.is_html(atom!("area")) {
        return image_map::image_of(element).is_some_and(|it| is_reachable(cx, it))
            && !element.has_attr(atom!("inert"));
    }
    if element.ns() == Ns::Svg && element.engine(|engine, id| engine.is_never_rendered(id)) {
        return false;
    }
    let bits = looks(
        cx,
        element,
        Looks::RENDERED | Looks::VISIBLE | Looks::HIDDEN_CONTENTS,
    );
    (bits == Looks::RENDERED | Looks::VISIBLE
        || !bits.contains(Looks::RENDERED) && is_canvas_fallback(cx, element))
        && !is_inert(cx, element)
}

fn is_canvas_fallback<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    let Some(canvas) = element
        .parent()
        .and_then(|it| it.closest_html(atom!("canvas")))
    else {
        return false;
    };
    let mut inside = element
        .inclusive_ancestors()
        .filter_map(Node::as_element)
        .take_while(|it| *it != canvas);
    looks_like(cx, canvas, Looks::RENDERED)
        && inside.all(|it| {
            !it.has_attr(atom!("inert"))
                && layout::style(cx, it, |it| it.display() != Display::None) == Some(true)
        })
        && layout::style(cx, element, |it| {
            it.is_visible() && it.display() != Display::Contents
        }) == Some(true)
        && !is_inert(cx, canvas)
}

pub(crate) fn delegates_focus(element: &Element) -> bool {
    element.has(NodeFlags::HOST)
        && element
            .shadow_root()
            .is_some_and(|it| it.is(ShadowFlags::DELEGATES_FOCUS))
}

fn is_scroller<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    !matches!(element.html_tag(), atom!("body") | atom!("html"))
        && looks_like(cx, element, Looks::SCROLLS)
}

pub(crate) fn is_click_focusable<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    supports_focus(cx, element) && !delegates_focus(element) && is_reachable(cx, element)
}

pub(crate) fn is_focusable<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    (supports_focus(cx, element) || is_scroller(cx, element))
        && !delegates_focus(element)
        && is_reachable(cx, element)
}

pub(crate) fn tab_index<'a>(cx: &mut Cx<'a>, element: &'a Element) -> i32 {
    element.integer(atom!("tabindex")).unwrap_or_else(|| {
        let is_skipped = element.is_html(atom!("dialog")) && !is_editing_host(cx, element)
            || forms::select::is_skipped_option(cx, element);
        -i32::from(is_skipped)
    })
}

fn area_for<'a>(cx: &mut Cx<'a>, element: &'a Element, is_candidate: bool) -> Option<&'a Element> {
    if is_candidate {
        Some(element)
    } else if delegates_focus(element) && bun_core::StackCheck::init().is_safe_to_recurse() {
        focus_delegate(cx, element)
    } else {
        None
    }
}

/// https://html.spec.whatwg.org/#focus-delegate
pub(crate) fn focus_delegate<'a>(cx: &mut Cx<'a>, target: &'a Element) -> Option<&'a Element> {
    let root: &Node = target
        .shadow_root()
        .filter(|it| it.is(ShadowFlags::DELEGATES_FOCUS))
        .map_or(target, |it| it);
    let (is_dialog, mut first) = (target.is_html(atom!("dialog")), None);
    for element in root.descendant_elements() {
        let wants = element.has(NodeFlags::AUTOFOCUS);
        if wants || first.is_none() {
            let is_candidate = is_click_focusable(cx, element)
                && (wants || !is_dialog || tab_index(cx, element) >= 0);
            let area = area_for(cx, element, is_candidate);
            if wants && area.is_some() {
                return area;
            }
            first = first.or(area);
        }
    }
    first
}

fn autofocus_area<'a>(cx: &mut Cx<'a>, element: &'a Element) -> Option<&'a Element> {
    let is_candidate = is_click_focusable(cx, element);
    area_for(cx, element, is_candidate)
}

pub(crate) fn autofocus_delegate<'a>(cx: &mut Cx<'a>, root: &'a Element) -> Option<&'a Element> {
    root.objects()
        .skip(1)
        .filter(|it| it.has(NodeFlags::AUTOFOCUS))
        .filter_map(Node::as_element)
        .find_map(|it| autofocus_area(cx, it))
}

/// `:focus` and `:focus-within`, which ends at the top layer.
pub(crate) fn mark_chain<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, on: bool) {
    let has_it = on && !ui.focus.is_on_scroll_control.get() && !is_shown_frame(element);
    element.set_state(cx, State::FOCUS, has_it);
    if !on && ui.focus.is_on_scroll_control.replace(false) {
        ui.doc()
            .engine(|engine, _| engine.control_scrolling(ScrollAction::Blur as u8, 0));
    }
    let (layer, mut is_within) = (ui.top_layer(), on);
    let chain = core::iter::successors(Some::<&Node>(element), |it| {
        it.flat_parent().or_else(|| it.parent_or_host())
    });
    for at in chain.map_while(Node::as_element) {
        at.set_state(cx, State::FOCUS_WITHIN, is_within);
        is_within &= !layer.contains(at);
    }
    let hosts = core::iter::successors(element.root().host(), |it| it.root().host());
    hosts
        .filter_map(Node::as_element)
        .for_each(|it| it.set_state(cx, State::FOCUS, on));
}

fn is_shown_frame(element: &Element) -> bool {
    Ui::of(element.doc()).is_some_and(|it| it.framing.are_shown.get())
        && Frame::shown_by(element).is_some()
}

fn fire_focus<'a>(
    cx: &mut Cx<'a>,
    element: &'a Element,
    gains: bool,
    related: Option<&'a Element>,
) {
    if is_shown_frame(element)
        && !Ui::of(element.doc()).is_some_and(|it| it.focus.tells_frame.get())
    {
        return;
    }
    let related = related.filter(|it| !is_shown_frame(it));
    let [own, bubbling] = if gains {
        [atom!("focus"), atom!("focusin")]
    } else {
        [atom!("blur"), atom!("focusout")]
    };
    for (name, bubbles) in [(own, false), (bubbling, true)] {
        if is_listened_to(name) {
            let event = FocusEvent::new(
                &cx.heap,
                element.doc(),
                name,
                EventInit {
                    bubbles,
                    ..COMPOSED
                },
                related,
            );
            dispatch(cx, element, event);
        }
    }
}

fn takes_text<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    if forms::is_typed_in(element) {
        return true;
    }
    let says_so = matches!(
        element.keyword(atom!("contenteditable")),
        Some(atom!("") | atom!("true") | atom!("plaintext-only"))
    );
    let mut above = element.ancestors().map_while(Node::as_element);
    says_so
        && !element.doc().is(DocFlags::DESIGN_MODE)
        && !above.any(|it| it.has_attr(atom!("contenteditable")))
        || is_editing_host(cx, element)
}

/// https://html.spec.whatwg.org/#focus-update-steps. False if a listener has moved the focus elsewhere.
pub(crate) fn set_focus<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    new: Option<&'a Element>,
    cause: Cause,
    mut is_visible: Option<bool>,
) -> bool {
    let (old, state) = (ui.focused(), &ui.focus);
    if old == new {
        return true;
    }
    let serial = state.serial.get().wrapping_add(1);
    state.serial.set(serial);
    state.changes.update(|it| it.wrapping_add(1));
    ui.set_tab_start(None);
    if cause == Cause::Mouse {
        state.had_key.set(false);
    }
    if let Some(old) = old {
        frames::input::blur_focused_frame(ui);
        if is_visible.is_none()
            && cause == Cause::Script
            && old.has_state(State::FOCUS_VISIBLE)
            && !takes_text(cx, old)
        {
            is_visible = Some(true);
        }
        forms::before_blur(cx, ui, old);
        if serial != state.serial.get() {
            return false;
        }
        ui.set_focused(None);
        mark_chain(cx, ui, old, false);
        old.set_state(cx, State::FOCUS_VISIBLE, false);
        forms::focus_changed(cx, old);
        interest::focus_changed(cx, ui, old, false);
        if ui.is_focused.get() {
            fire_focus(cx, old, false, new);
        }
        if serial != state.serial.get() {
            return false;
        }
    }
    if let Some(new) = new.filter(|it| it.is_connected() && it.doc() == ui.doc()) {
        if cause != Cause::Script {
            state.was_by_mouse.set(cause == Cause::Mouse);
        }
        state.is_hidden.set(is_visible == Some(false));
        let takes_text = takes_text(cx, new);
        ui.set_focused(Some(new));
        mark_chain(cx, ui, new, true);
        new.set_state(
            cx,
            State::FOCUS_VISIBLE,
            is_visible
                .unwrap_or_else(|| takes_text || !state.was_by_mouse.get() || state.had_key.get()),
        );
        forms::focus_changed(cx, new);
        interest::focus_changed(cx, ui, new, true);
        if takes_text && ui.pointer().autoscrolls().is_some() {
            ui.pointer().stop_tracking();
        }
        if cause != Cause::Mouse {
            editing::select_on_focus(cx, new, cause == Cause::Keyboard);
        }
        // Else it gets the events together with its window.
        let was_focused = ui.is_focused.get();
        state.tells_frame.set(cause == Cause::Script);
        frames::input::focus_changed(cx, ui);
        if was_focused && serial == state.serial.get() {
            fire_focus(cx, new, true, old);
        }
    } else {
        frames::input::focus_changed(cx, ui);
    }
    focus_changed(cx, ui);
    serial == state.serial.get()
}

fn focus_changed<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    editing::input_method::focus_changed(cx, ui);
    ui.doc().invalidate(cx);
}

pub(crate) fn note_key<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    ui.focus.had_key.set(true);
    if let Some(focused) = ui
        .focused()
        .filter(|_| !ui.focus.is_hidden.get() && !ui.focus.is_on_scroll_control.get())
    {
        focused.set_state(cx, State::FOCUS_VISIBLE, true);
    }
}

/// https://html.spec.whatwg.org/#focusing-steps
pub(crate) fn focus<'a>(cx: &mut Cx<'a>, element: &'a Element, cause: Cause, options: Options) {
    let Some(ui) = Ui::of(element.doc()).filter(|_| element.is_connected()) else {
        return;
    };
    let stays = |it: &Element| options.leaves_focused_alone && ui.focused() == Some(it);
    if stays(element) {
        return;
    }
    let target = if ui.doc().document_element() == Some(element) && !supports_focus(cx, element) {
        None
    } else if delegates_focus(element) {
        if ui.focused().is_some_and(|it| element.contains_composed(it)) {
            return;
        }
        let Some(delegate) = focus_delegate(cx, element) else {
            return;
        };
        Some(delegate)
    } else if is_focusable(cx, element) {
        Some(element)
    } else {
        let control = element
            .is_html(atom!("label"))
            .then(|| forms::labeled_control(element))
            .flatten();
        let Some(control) = control.filter(|it| is_focusable(cx, it)) else {
            return;
        };
        Some(control)
    };
    if !target.is_some_and(stays)
        && set_focus(cx, ui, target, cause, options.is_visible)
        && let Some(target) = target.filter(|_| !options.prevents_scroll)
    {
        if target.is_html(atom!("input")) {
            layout::scroll_into_view(cx, target, Alignment::CenterIfNeeded);
        }
        if !editing::reveal_caret_in(cx, target) {
            layout::scroll_into_view(cx, target, Alignment::CenterIfNeeded);
        }
        if let Some(container) = ui.container() {
            let rect = layout::bounding_rect(cx, target);
            container.reveal(
                cx,
                crate::scroll::Revealed {
                    rect,
                    align: [Alignment::CenterIfNeeded; 2],
                    behavior: 1,
                },
            );
        }
    }
}

pub(crate) fn blur<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    let Some(ui) = Ui::of(element.doc()) else {
        return;
    };
    let Some(old) = ui
        .focused()
        .filter(|it| it.retarget(Some(element)) == &**element)
    else {
        return;
    };
    set_focus(cx, ui, None, Cause::Script, None);
    if ui.tab_start().is_none() {
        tabbing::start_at(ui, Some(old));
    }
}

pub(crate) fn focus_on_mouse_down<'a>(cx: &mut Cx<'a>, ui: &'a Ui, target: &'a Element) {
    let mut found = None;
    for at in target.flat_ancestors().map_while(Node::as_element) {
        if delegates_focus(at) {
            if ui.focused().is_some_and(|it| at.contains_composed(it)) {
                return;
            }
            found = focus_delegate(cx, at);
            break;
        }
        if is_click_focusable(cx, at) {
            found = Some(at);
            break;
        }
    }
    set_focus(cx, ui, found, Cause::Mouse, None);
    if ui.focused().is_none() {
        tabbing::start_at(ui, Some(target));
    }
}

/// A script has put the selection in editable content.
pub(crate) fn follow_selection<'a>(cx: &mut Cx<'a>, ui: &'a Ui, start: &'a Node) {
    if let Some(host) = editing_host(cx, start)
        && !ui.focused().is_some_and(|it| host.contains_composed(it))
        && is_click_focusable(cx, host)
    {
        set_focus(cx, ui, Some(host), Cause::Mouse, None);
    }
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum ScrollAction {
    Click,
    Activate,
    Previous,
    Next,
    Blur,
}

/// The element that a scroll marker or a scroll button belongs to counts as focused in its place.
pub(crate) fn control_scrolling<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    action: ScrollAction,
    part: NodeId,
) -> bool {
    let doc = ui.doc();
    if action == ScrollAction::Click {
        set_focus(cx, ui, None, Cause::Mouse, None);
    }
    let found = layout::laid_out(cx, doc, |engine, _| {
        engine.control_scrolling(action as u8, part)
    });
    doc.invalidate(cx);
    if found >= layout::SCROLL_CONTROL {
        tabbing::start_at(ui, doc.rendered_node(found - layout::SCROLL_CONTROL));
    } else if found != 0 && action == ScrollAction::Click {
        ui.focus.is_on_scroll_control.set(true);
        set_focus(
            cx,
            ui,
            doc.rendered_node(found).and_then(Node::as_element),
            Cause::Mouse,
            Some(false),
        );
    }
    found != 0
}

/// The focus goes with a node that is removed.
pub(crate) fn drop_focus<'a>(cx: &mut Cx<'a>, ui: &'a Ui, removed: &'a Element) {
    let Some(old) = ui.focused() else { return };
    frames::input::blur_focused_frame(ui);
    ui.set_focused(None);
    ui.focus.serial.update(|it| it.wrapping_add(1));
    mark_chain(cx, ui, old, false);
    old.set_state(cx, State::FOCUS_VISIBLE, false);
    tabbing::start_in_place_of(ui, removed);
    frames::input::focus_changed(cx, ui);
    focus_changed(cx, ui);
}

/// https://html.spec.whatwg.org/#focus-fixup-rule
pub(crate) fn fix_up<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if let Some(select) = ui.select_with_popover() {
        forms::select::close_popover_of_native(cx, ui, select);
    }
    let is_kept_by_frame = |cx: &mut Cx<'a>, it: &'a Element| {
        ui.focused_frame().is_some() && looks_like(cx, it, Looks::RENDERED)
    };
    if let Some(old) = ui.focused().filter(|it| {
        !ui.focus.is_on_scroll_control.get() && !is_focusable(cx, it) && !is_kept_by_frame(cx, it)
    }) {
        set_focus(cx, ui, None, Cause::Script, None);
        tabbing::start_at(ui, Some(old));
    }
}

pub(crate) fn fire_at_window<'a>(cx: &mut Cx<'a>, ui: &'a Ui, gains: bool) {
    if gains {
        crate::api::transfer::clipboard::window_got_focus(cx, ui);
    }
    if let Some(window) = ui.doc().window() {
        let event = FocusEvent::new(
            &cx.heap,
            ui.doc(),
            if gains { atom!("focus") } else { atom!("blur") },
            PLAIN,
            None,
        );
        dispatch(cx, window, event);
    }
}

pub(crate) fn window_focus_changed<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if ui.focused_frame().is_some() {
        return;
    }
    let (focused, gains) = (ui.focused(), ui.is_focused.get());
    if let Some(focused) = focused.filter(|_| !gains) {
        fire_focus(cx, focused, false, None);
    }
    fire_at_window(cx, ui, gains);
    if let Some(focused) = focused.filter(|it| gains && ui.focused() == Some(it)) {
        fire_focus(cx, focused, true, None);
    }
}

pub(crate) fn autofocus_inserted<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    if let Some(ui) = Ui::of(element.doc())
        && let Some(top) =
            frames::top_of_same_origin(ui).filter(|it| !it.focus.has_autofocused.get())
        && !host::is_sandboxed(ui, "allow-scripts")
    {
        top.set_autofocus_candidates(top.autofocus_candidates().followed_by(&cx.heap, element));
        top.doc().invalidate(cx);
    }
}

pub(crate) fn end_autofocus(doc: &Doc) {
    if let Some(top) = Ui::of(doc).and_then(|it| frames::top_of_same_origin(it)) {
        top.set_autofocus_candidates(Refs::default());
        top.focus.has_autofocused.set(true);
    }
}

/// https://html.spec.whatwg.org/#flush-autofocus-candidates
pub(crate) fn flush_autofocus_candidates<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    if ui.focused().is_some() || ui.focus.has_autofocused.get() {
        return end_autofocus(ui.doc());
    }
    let candidates = ui.autofocus_candidates();
    let last_places: Map<*const Element, usize> = candidates
        .iter()
        .enumerate()
        .map(|(index, it)| (core::ptr::from_ref(it), index))
        .collect();
    for (index, element) in candidates
        .iter()
        .enumerate()
        .filter(|(index, it)| last_places.get(&core::ptr::from_ref(*it)) == Some(index))
    {
        let Some(own) = Ui::of(element.doc())
            .filter(|it| frames::top_of_same_origin(it).is_some_and(|it| core::ptr::eq(it, ui)))
        else {
            continue;
        };
        if own.doc().has_blocking_sheets() {
            return ui.set_autofocus_candidates(candidates.skip(&cx.heap, index));
        }
        if !host::has_target_element(own)
            && let Some(area) = autofocus_area(cx, element)
        {
            end_autofocus(ui.doc());
            return focus(cx, area, Cause::Script, Options::default());
        }
    }
    ui.set_autofocus_candidates(Refs::default());
}
