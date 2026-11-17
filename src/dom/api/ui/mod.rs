//! What the user does with a document: the focus, the top layer, the mouse and the keyboard.

pub(crate) mod activation;
pub(crate) mod assistive;
pub(crate) mod close_watcher;
pub(crate) mod context_menu;
pub(crate) mod controls;
pub(crate) mod details;
pub(crate) mod dialog;
mod drag;
mod engine;
pub(crate) mod entry;
pub(crate) mod focus;
pub(crate) mod fullscreen;
pub(crate) mod host;
pub(crate) mod image_map;
pub(crate) mod invokers;
pub(crate) mod keyboard;
mod keys;
pub(crate) mod layout;
pub(crate) mod members;
pub(crate) mod mouse;
pub(crate) mod pointer;
pub(crate) mod points;
pub(crate) mod popover;
pub(crate) mod refs;
pub(crate) mod seams;
pub(crate) mod selecting;
pub(crate) mod surface;
pub(crate) mod tabbing;
pub(crate) mod top_layer;
mod touch;

use core::cell::{Cell, RefCell};

use crate::api::frames::Frame;
use crate::generated_bindgen::interaction::js_Ui;
use crate::name::Name;
use crate::selector::Pseudo;
use prelude::*;

pub(crate) mod prelude {
    pub(crate) use bun_jsc::JSValue;
    pub(crate) use bun_jsc::bindgen::{
        self, ClassStructure, JsHeap, JsInterface, JsLocal, JsScope as Cx,
    };

    pub(crate) use super::layout::{self, Looks, looks, looks_like};
    pub(crate) use super::refs::{Handle, Refs, slots};
    pub(crate) use super::{
        BUBBLES, CANCELABLE, COMPOSED, IS_MAC, NodeExt, PLAIN, Refusal, Ui, host, refused,
    };
    pub(crate) use crate::api::core::steps::{AttrChange, Steps};
    pub(crate) use crate::api::core::*;
    pub(crate) use crate::api::events::WindowTarget;
    pub(crate) use crate::api::range::{self, Point, Range, Selection};
    pub(crate) use crate::tree::State;
}

pub(crate) const IS_MAC: bool = cfg!(target_os = "macos");

pub(crate) const PLAIN: EventInit = EventInit {
    bubbles: false,
    cancelable: false,
    composed: false,
};
pub(crate) const BUBBLES: EventInit = EventInit {
    bubbles: true,
    ..PLAIN
};
pub(crate) const CANCELABLE: EventInit = EventInit {
    cancelable: true,
    ..PLAIN
};
/// And bubbles.
pub(crate) const COMPOSED: EventInit = EventInit {
    composed: true,
    ..BUBBLES
};

/// What is thrown if a script has asked.
pub(crate) type Refusal = (DomError, &'static str);

pub(crate) fn refused<'a, T>(
    heap: &JsHeap<'a>,
    result: Result<T, Refusal>,
) -> bindgen::Result<'a, T> {
    result.map_err(|(error, message)| dom_error(heap, error, message))
}

/// Of a document that has or had a window.
#[derive(Default)]
pub(crate) struct Ui {
    pub(crate) has_window: Cell<bool>,
    pub(crate) is_focused: Cell<bool>,
    pub(crate) framing: crate::api::frames::Frames,
    pub(crate) has_spell_checker: bool,
    pub(crate) focus: focus::Focus,
    pub(crate) assistive: assistive::Assistive,
    pub(crate) activation: activation::Activation,
    pub(crate) layers: Box<top_layer::Layers>,
    pub(crate) touches: Box<touch::Touches>,
    pub(crate) pressed_key: RefCell<Option<keyboard::Key>>,
    pub(crate) editing: Box<crate::api::editing::Editing>,
}

slots!(Ui = js_Ui {
    document: Doc,
    focused: Element,
    tab_start: Node,
    hint_parent: Element,
    pressed_popover: Element,
    pressed_dialog: Element,
    open_picker: Element,
    select_with_popover: Element,
    container: Frame,
    focused_frame: Frame,
    touched_frame: Frame,
    frame_under_mouse: Frame,
    current_pointer: pointer::Pointer,
    system_mouse: pointer::Pointer,
    pen: pointer::Pointer,
    clipboard: crate::api::transfer::clipboard::Clipboard,
    composition_target: Element,
    composition_node: Node,
    input_method_node: Node,
    spelling: crate::api::editing::spelling::Spelling,
    recorded_step: crate::api::editing::history::EditStep,
    overrides_start: Node,
    overrides_end: Node,
} [
    top_layer: Element,
    open_dialogs: Element,
    autofocus_candidates: Element,
    close_watchers: close_watcher::Watcher,
    fullscreen_events: Element,
    changed_selections: Node,
    dirty_controls: Element,
    fingers: pointer::Pointer,
    frames: Frame,
    plugins: Element,
]);

impl Ui {
    /// If the document has a window.
    #[inline]
    pub(crate) fn of(doc: &Doc) -> Option<&Ui> {
        Ui::left_in(doc).filter(|it| it.has_window.get())
    }

    /// Also if it no longer has.
    #[inline]
    pub(crate) fn left_in(doc: &Doc) -> Option<&Ui> {
        Ui::from_value(doc.edge(Edge::Ui)?)
    }

    pub(crate) fn attach<'a>(heap: &JsHeap<'a>, doc: &Doc, state: Ui) -> &'a Ui {
        let ui = js_Ui::create(heap, state);
        let mouse = pointer::Pointer::mouse(heap);
        ui.has_window.set(true);
        ui.set_document(Some(doc));
        ui.set_current_pointer(Some(mouse));
        ui.set_system_mouse(Some(mouse));
        doc.set_edge(heap, Edge::Ui, ui.value());
        ui
    }

    pub(crate) fn doc(&self) -> &Doc {
        self.document().expect("set by attach")
    }

    /// The one whose event is being handled, which can be a pen or a finger.
    pub(crate) fn pointer(&self) -> &pointer::Pointer {
        self.current_pointer().expect("set by attach")
    }

    pub(crate) fn mouse(&self) -> &pointer::Pointer {
        self.system_mouse().expect("set by attach")
    }

    /// Before `node` leaves the document.
    pub(crate) fn before_remove<'a>(&'a self, cx: &mut Cx<'a>, node: &'a Node, is_move: bool) {
        if self
            .tab_start()
            .is_some_and(|it| node.contains_composed(it))
        {
            tabbing::start_in_place_of(self, node);
        }
        let Some(element) = node.as_element().filter(|_| !is_move) else {
            return;
        };
        if let Some(input) = self
            .open_picker()
            .filter(|it| node.contains_composed(it))
            .and_then(crate::api::forms::input::Input::of)
        {
            input.close_picker(cx);
        }
        let has_layers = !self.top_layer().is_empty();
        if (has_layers || element.state().contains(State::FOCUS_WITHIN))
            && self.focused().is_some_and(|it| node.contains_composed(it))
        {
            crate::api::forms::close_picker(cx, self);
            focus::drop_focus(cx, self, element);
        }
        if has_layers {
            fullscreen::before_remove(cx, self, element);
        }
        if node.parent() == Some(self.doc()) {
            top_layer::hide_bubble(cx, self);
        }
        pointer::forget(cx, self, element);
    }
}

pub(crate) trait NodeExt {
    fn flat_ancestors(&self) -> impl Iterator<Item = &Node>;
    fn is_part(&self, name: &str) -> bool;
    fn is_text(&self) -> bool;
    fn is_html_element(&self) -> bool;
    fn text(&self) -> DomString;
    fn has_state(&self, state: State) -> bool;
    fn attr_is(&self, name: Known, value: &str) -> bool;
    /// In lowercase.
    fn keyword(&self, name: Known) -> Option<Known>;
    fn integer(&self, name: Known) -> Option<i32>;
    fn set_edge_node(&self, heap: &JsHeap<'_>, edge: Edge, to: Option<&Element>);
    fn first_html_child(&self, tag: Known) -> Option<&Element>;
}

impl NodeExt for Node {
    /// Inclusive.
    fn flat_ancestors(&self) -> impl Iterator<Item = &Node> {
        core::iter::successors(Some(self), |it| it.flat_parent())
    }

    #[inline]
    fn is_part(&self, name: &str) -> bool {
        self.as_element()
            .is_some_and(|it| it.pseudo() == Pseudo::Part(Name::new(name.as_bytes())))
    }

    /// Or a CDATA section.
    fn is_text(&self) -> bool {
        self.as_text().is_some()
    }

    #[inline]
    fn is_html_element(&self) -> bool {
        self.kind().is_html()
    }

    /// Empty for what is not character data.
    fn text(&self) -> DomString {
        self.as_character_data()
            .map(CharacterData::data)
            .unwrap_or_default()
    }

    fn has_state(&self, state: State) -> bool {
        self.as_element()
            .is_some_and(|it| it.state().intersects(state))
    }

    fn attr_is(&self, name: Known, value: &str) -> bool {
        self.as_element()
            .and_then(|it| it.with_attr(name, |it| it.eq_ignore_ascii_case(value)))
            .unwrap_or(false)
    }

    fn keyword(&self, name: Known) -> Option<Known> {
        self.as_element()?
            .with_attr(name, |it| Known::from_latin1_lowercased(it.as_bytes()))
    }

    fn integer(&self, name: Known) -> Option<i32> {
        self.as_element()?
            .with_attr(name, |it| reflect::parse_integer(it.as_bytes()))?
    }

    fn set_edge_node(&self, heap: &JsHeap<'_>, edge: Edge, to: Option<&Element>) {
        match to {
            Some(to) => self.set_edge(heap, edge, to.to_js()),
            None => self.clear_edge(heap, edge),
        }
    }

    fn first_html_child(&self, tag: Known) -> Option<&Element> {
        self.element_children().find(|it| it.is_html(tag))
    }
}
