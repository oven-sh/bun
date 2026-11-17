//! What assistive technology is told, and what it does.

use core::cell::Cell;

use super::activation::{self, Click};
use super::focus::{self, Cause};
use super::keyboard::{self, Key};
use super::prelude::*;
use super::{layout, mouse, tabbing};
use crate::abi::accessibility::{self as abi, Action};
use crate::accessibility::{Facts, Page};
use crate::api::core::reflect::{self, Owner};
use crate::api::editing::{self, By, Command, selection};
use crate::api::forms::input::Input;
use crate::api::forms::internals::ElementInternals;
use crate::api::forms::{self, InputType, color_picker, date_fields, gauge, suggestions};
use crate::api::frames::Frame;
use crate::api::media::controls;
use crate::api::uievents::{Modifiers, Mouse, MouseEvent, PointerData, PointerEvent};
use crate::api::window::Window;
use crate::document::Document;
use crate::generated_bindgen::interaction::{
    AriaNotificationOptions, AriaNotifier, AriaNotifyPriority,
};
use crate::name::{Name, name};
use crate::scroll::Alignment;

/// How many times as long as an update took it is until the next one.
const REST: f64 = 100.0;
const SHORT_REST: f64 = 5.0;
const SHORTEST_REST: f64 = 100.0;
const REST_WHILE_LOADING: f64 = 350.0;
const LONGEST_REST: f64 = 500.0;

#[derive(Default)]
pub(crate) struct Assistive {
    /// What the library calls it. 0 while nothing listens.
    tree: Cell<u32>,
    updated_at: Cell<f64>,
    cost: Cell<f64>,
    /// The other timers do nothing.
    timer: Cell<u32>,
    due: Cell<Option<f64>>,
}

// ───────────────────────────── what it is told ─────────────────────────────

const REFERRING: [Known; 8] = [
    atom!("aria-activedescendant"),
    atom!("aria-controls"),
    atom!("aria-describedby"),
    atom!("aria-details"),
    atom!("aria-errormessage"),
    atom!("aria-flowto"),
    atom!("aria-labelledby"),
    atom!("aria-owns"),
];

/// The value, the minimum, the maximum and the step.
fn range_of(control: &Element) -> [Option<f64>; 4] {
    if let tag @ (atom!("meter") | atom!("progress")) = control.html_tag() {
        let [value, min, max] =
            [atom!("value"), atom!("min"), atom!("max")].map(|it| Some(gauge::number(control, it)));
        return [
            value.filter(|_| tag == atom!("meter") || control.has_attr(atom!("value"))),
            min,
            max,
            None,
        ];
    }
    let input =
        Input::of(control).filter(|it| matches!(it.kind(), InputType::Range | InputType::Number));
    input.map_or([None; 4], |it| {
        [
            it.number(),
            it.limits().min,
            it.limits().max,
            it.limits().step,
        ]
    })
}

/// In the place of attributes.
pub(crate) type Semantics = Vec<(&'static str, String)>;

fn is_media(element: &Element) -> bool {
    matches!(element.html_tag(), atom!("audio") | atom!("video"))
}

fn semantics<'a>(cx: &mut Cx<'a>, element: &'a Element) -> Semantics {
    match element.out_of_control().as_element() {
        Some(media) if is_media(media) => controls::semantics(&cx.heap, media, element),
        control => match control.and_then(Input::of) {
            Some(input) if control == Some(element) => suggestions::shown(input)
                .map(|_| ("aria-expanded", "true".to_owned()))
                .into_iter()
                .collect(),
            Some(input) if input.kind().has_date_fields() => date_fields::semantics(input, element),
            Some(input) if input.kind() == InputType::Color => {
                color_picker::semantics(input, element)
            }
            Some(_) => suggestions::semantics(element),
            None => Vec::new(),
        },
    }
}

fn facts_of<'a>(cx: &mut Cx<'a>, element: &'a Element) -> Facts {
    let semantics = semantics(cx, element);
    let is_control = matches!(
        element.html_tag(),
        atom!("input") | atom!("meter") | atom!("progress") | atom!("textarea")
    ) || is_media(element)
        || !semantics.is_empty();
    let internals = element
        .edge(Edge::Internals)
        .and_then(ElementInternals::from_value);
    let mut references = Vec::new();
    let mut relate = |name: Name, to: &mut dyn Iterator<Item = &Element>| {
        references.push((
            name,
            to.filter(|it| it.is_connected() && it.doc() == element.doc())
                .map(|it| it.id())
                .collect(),
        ));
    };
    if internals.is_some()
        || element
            .root()
            .as_shadow_root()
            .is_some_and(|it| it.reference_target().is_some())
    {
        relate(name!("labels"), &mut forms::labels_of(element));
    }
    let target = element.reference_target();
    if target != Some(element) {
        relate(name!("target"), &mut target.into_iter());
    }
    for attribute in REFERRING
        .into_iter()
        .filter(|_| element.has(NodeFlags::HAS_EXPLICIT_ELEMENTS))
    {
        let name = Atom::of(attribute).name();
        if reflect::explicit_elements(element, Owner::Element, attribute).is_some() {
            relate(
                name,
                &mut reflect::elements(element, attribute)
                    .into_iter()
                    .flatten()
                    .filter_map(Element::reference_target),
            );
        } else if let Some(mut defaults) =
            reflect::explicit_elements(element, Owner::Internals, attribute)
                .filter(|_| !element.has_attr(attribute))
        {
            relate(name, &mut defaults);
        }
    }
    if let Some((list, row)) = Input::of(element).and_then(suggestions::shown) {
        relate(name!("aria-controls"), &mut core::iter::once(list));
        relate(name!("aria-activedescendant"), &mut row.into_iter());
    }
    let value = Input::of(element).and_then(|input| match input.kind() {
        InputType::File => Some(
            input
                .names_of_files()
                .map(|it| it.to_utf8().into_owned())
                .collect::<Vec<_>>()
                .join(", ")
                .into(),
        ),
        InputType::Color
        | InputType::Date
        | InputType::DateTimeLocal
        | InputType::Month
        | InputType::Time
        | InputType::Week => Some(input.value().to_utf8().into()),
        _ => None,
    });
    Facts {
        is_clickable: [atom!("click"), atom!("mousedown"), atom!("mouseup")]
            .into_iter()
            .any(|it| element.has_listeners(it)),
        has_custom_error: forms::validity::has_custom_error(element),
        are_volatile: is_control || internals.is_some() || !references.is_empty(),
        numbers: range_of(element).map(|it| it.filter(|it| it.is_finite())),
        value,
        defaults: match internals {
            Some(it) => it
                .all_semantics()
                .iter()
                .map(|it| (Atom::of(it.0).name(), it.1.to_utf8().into()))
                .collect(),
            None => semantics
                .into_iter()
                .map(|it| (Name::new(it.0.as_bytes()), it.1.into()))
                .collect(),
        },
        references,
    }
}

fn tell_facts<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    if is_media(element) {
        controls::parts_of(element).for_each(|it| tell_facts(cx, it));
    }
    let facts = facts_of(cx, element);
    element.engine(|engine, id| engine.set_facts(id, facts));
}

fn gather_facts<'a>(cx: &mut Cx<'a>, doc: &'a Doc, only_new: bool) {
    let wanted = doc.synced_engine(cx, |engine, _| engine.elements_without_facts(only_new));
    wanted
        .into_iter()
        .filter_map(|it| doc.rendered_node(it)?.as_element())
        .for_each(|it| tell_facts(cx, it));
}

fn is_loading(ui: &Ui) -> bool {
    ui.doc().ready_state() != ReadyState::Complete
}

fn focused(ui: &Ui) -> Option<&Element> {
    ui.focused().map(|it| {
        Input::of(it)
            .and_then(|it| date_fields::active_part(it).or_else(|| color_picker::active_part(it)))
            .unwrap_or(it)
    })
}

fn about_page<R: Default>(ui: &Ui, run: impl FnOnce(&mut Document, &Page) -> R) -> R {
    let (doc, url) = (ui.doc(), ui.doc().url());
    let selects_backwards = range::try_selection(doc).is_some_and(Selection::is_backward);
    let page = Page {
        url: &url.to_utf8(),
        focused: focused(ui).map_or(0, |it| it.id()),
        is_loading: is_loading(ui),
        selects_backwards,
    };
    doc.engine(|engine, _| run(engine, &page))
}

fn send<'a>(cx: &mut Cx<'a>, ui: &'a Ui, only_focused: bool) {
    selection::send(cx, ui);
    about_page(ui, |engine, page| {
        engine.update_accessibility(ui.assistive.tree.get(), page, only_focused)
    });
}

fn stop_timer(ui: &Ui) {
    ui.assistive.timer.update(|it| it.wrapping_add(1));
    ui.assistive.due.set(None);
}

fn update_in<'a>(cx: &mut Cx<'a>, ui: &'a Ui, delay: f64) {
    let due = host::now() + delay;
    if ui.assistive.due.get().is_some_and(|it| it <= due + 1.0) {
        return;
    }
    stop_timer(ui);
    ui.assistive.due.set(Some(due));
    host::set_timeout(
        cx,
        ui,
        delay,
        [
            ui.value(),
            JSValue::js_number(ui.assistive.timer.get().into()),
        ],
        |cx, [ui, timer]| {
            if let Some(ui) = Ui::from_value(ui)
                .filter(|it| f64::from(it.assistive.timer.get()) == timer.as_number())
            {
                update_accessibility(cx, ui);
            }
        },
    );
}

/// Nothing may be painted for it.
pub(crate) fn facts_changed<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    if let Some(ui) = Ui::of(element.doc()).filter(|it| it.assistive.tree.get() != 0) {
        update_in(cx, ui, SHORTEST_REST);
    }
}

pub(crate) fn update_accessibility<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    stop_timer(ui);
    let it = &ui.assistive;
    if it.tree.get() == 0 || !ui.has_window.get() {
        return;
    }
    let start = host::now();
    if ui
        .doc()
        .synced_engine(cx, |engine, _| engine.unlock_for_screen_reader())
    {
        ui.doc().invalidate(cx);
    }
    gather_facts(cx, ui.doc(), false);
    send(cx, ui, false);
    it.updated_at.set(host::now());
    it.cost.set(it.updated_at.get() - start);
    if is_loading(ui) {
        update_in(cx, ui, REST_WHILE_LOADING);
    }
}

pub(crate) fn update_accessibility_soon<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let (doc, focused, cost) = (ui.doc(), focused(ui), ui.assistive.cost.get());
    gather_facts(cx, doc, true);
    focused.into_iter().for_each(|it| tell_facts(cx, it));
    let rest = match doc.engine(|engine, _| engine.has_urgent_news(focused.map_or(0, |it| it.id())))
    {
        true => cost * SHORT_REST,
        false => (cost * REST).max(if is_loading(ui) {
            REST_WHILE_LOADING
        } else {
            SHORTEST_REST
        }),
    };
    let left = ui.assistive.updated_at.get() + rest.min(LONGEST_REST) - host::now();
    if left <= 0.0 {
        return update_accessibility(cx, ui);
    }
    send(cx, ui, true);
    update_in(cx, ui, left);
}

/// Whether any is running.
pub(crate) fn note_technology<'a>(cx: &mut Cx<'a>, ui: &'a Ui, starts_over: bool) {
    let is_active = bun_ui::surfaces::is_accessibility_active();
    if !is_active && !ui.doc().is(DocFlags::IS_ACCESSIBLE) {
        return;
    }
    let shown = || {
        ui.container()
            .map(Frame::accessible_tree)
            .or_else(|| Window::of(ui.doc()).map(Window::surface))
    };
    let tree = if is_active { shown().unwrap_or(0) } else { 0 };
    stop_timer(ui);
    if ui.assistive.tree.replace(tree) != tree || starts_over {
        ui.doc().engine(|engine, _| engine.accessibility = None);
    }
    ui.doc().set_doc_flags(DocFlags::IS_ACCESSIBLE, tree != 0);
    ui.doc().engine(|engine, _| {
        engine.set_screen_reader(tree != 0 && bun_ui::surfaces::has_screen_reader())
    });
    ui.doc().invalidate(cx);
}

fn inspect<'a, R>(cx: &mut Cx<'a>, doc: &'a Doc, read: impl FnOnce() -> R) -> R {
    gather_facts(cx, doc, false);
    let result = read();
    if !doc.is(DocFlags::IS_ACCESSIBLE) {
        doc.engine(|engine, _| engine.accessibility = None);
    }
    result
}

pub(crate) fn computed_role_and_name<'a>(cx: &mut Cx<'a>, node: &'a Node) -> [String; 2] {
    inspect(cx, node.doc(), || {
        node.engine(Document::computed_role_and_name)
    })
}

pub(crate) fn inspect_accessibility<'a>(cx: &mut Cx<'a>, ui: &'a Ui) -> Vec<u8> {
    inspect(cx, ui.doc(), || {
        about_page(ui, Document::inspect_accessibility)
    })
}

impl AriaNotifier {
    pub(crate) fn aria_notify<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        announcement: &DomString,
        options: &AriaNotificationOptions,
    ) {
        let doc = self.doc();
        if let Some(ui) = Ui::of(doc).filter(|it| it.assistive.tree.get() != 0)
            && host::allows_feature(ui, "aria-notify")
        {
            doc.engine(|engine, _| {
                engine.announce_to_user(
                    &announcement.to_utf8(),
                    options.priority == AriaNotifyPriority::High,
                )
            });
            update_accessibility(cx, ui);
        }
    }
}

// ───────────────────────────── what it does ─────────────────────────────

fn center_of<'a>(cx: &mut Cx<'a>, element: &'a Element) -> [f64; 2] {
    let rect = layout::bounding_rect(cx, element);
    [rect.x + rect.width / 2.0, rect.y + rect.height / 2.0].map(f64::from)
}

/// Pages tell it from a press of the mouse by the `buttons` of the click.
fn press<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element) {
    ui.note_user_activation(false);
    if element.is_html(atom!("option")) && forms::select::press(cx, element) {
        return;
    }
    tabbing::start_at(ui, Some(element));
    if let Some(it) = [Some(element), element.out_of_control().as_element()]
        .into_iter()
        .flatten()
        .find(|it| focus::is_focusable(cx, it))
    {
        focus::focus(cx, it, Cause::Mouse, Default::default());
    }
    let (doc, client) = (element.doc(), center_of(cx, element));
    let (zoom, seen_at, seen_on_screen) = (
        layout::zoom(doc),
        ui.pointer().at.get(),
        ui.pointer().screen.get(),
    );
    let screen = [0, 1].map(|it| seen_on_screen[it] + (client[it] - seen_at[it]) * zoom);
    let mouse = |buttons| {
        Mouse {
            client,
            screen,
            buttons,
            ..Default::default()
        }
        .floored()
    };
    let pointer = || PointerData {
        id: 1,
        kind: atom!("mouse").into(),
        is_primary: true,
        ..Default::default()
    };
    let init = EventInit {
        cancelable: true,
        ..COMPOSED
    };
    let fire_pointer = |cx: &mut Cx<'a>, name, buttons| {
        let event = PointerEvent::new(
            &cx.heap,
            doc,
            name,
            init,
            Trusted::Yes,
            0,
            mouse(buttons),
            pointer(),
        );
        dispatch(cx, element, event)
    };
    let fire_mouse = |cx: &mut Cx<'a>, name, buttons| {
        let event = MouseEvent::new(&cx.heap, doc, name, init, 0, mouse(buttons));
        dispatch(cx, element, event)
            && (element.out_of_control() == &**element
                || !mouse::run_default_actions(cx, element, event))
    };
    let fires_mouse_events = fire_pointer(cx, atom!("pointerdown"), 1);
    if !fires_mouse_events || fire_mouse(cx, atom!("mousedown"), 1) {
        forms::select::press(cx, element);
    }
    element.set_state(cx, State::ACTIVE, true);
    fire_pointer(cx, atom!("pointerup"), 0);
    if fires_mouse_events {
        fire_mouse(cx, atom!("mouseup"), 0);
    }
    element.set_state(cx, State::ACTIVE, false);
    activation::click(
        cx,
        element,
        Trusted::Yes,
        Click {
            mouse: mouse(1),
            detail: 1,
            pointer: Some(pointer()),
        },
    );
}

/// The caret is about to be put in `node`.
fn focus_for_caret<'a>(cx: &mut Cx<'a>, ui: &'a Ui, node: &'a Node) {
    let control = Some(node.out_of_control())
        .filter(|it| *it != node)
        .and_then(Node::as_element);
    match control.or_else(|| focus::editing_host(cx, node)) {
        Some(field) => focus::focus(cx, field, Cause::Mouse, Default::default()),
        None => tabbing::start_at(ui, Some(node)),
    }
}

fn key(name: Known) -> Key {
    Key {
        key: name.into(),
        code: name.into(),
        location: 0,
        repeat: false,
        modifiers: Modifiers::empty(),
        is_composing: false,
    }
}

/// The focus stays.
fn adjust<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, is_up: bool) {
    let is_upright = element
        .attr(atom!("aria-orientation"))
        .is_some_and(|it| it.eq_ignore_ascii_case("vertical"));
    let is_sideways = match &*element.engine(Document::computed_role_and_name)[0] {
        "slider" => !is_upright,
        "separator" => is_upright,
        _ => false,
    };
    let name = match (
        is_sideways,
        is_up != (is_sideways && looks_like(cx, element, Looks::RTL)),
    ) {
        (true, true) => atom!("ArrowRight"),
        (true, false) => atom!("ArrowLeft"),
        (false, true) => atom!("ArrowUp"),
        (false, false) => atom!("ArrowDown"),
    };
    ui.note_user_activation(false);
    keyboard::press_at(cx, ui, element, &key(name));
}

fn press_key<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, name: Known) {
    focus::focus(cx, element, Cause::Keyboard, Default::default());
    let key = key(name);
    keyboard::key_down(cx, ui, &key);
    keyboard::key_up(cx, ui, &key);
}

fn select_text<'a>(cx: &mut Cx<'a>, ui: &'a Ui, ends: [abi::Point; 2]) {
    let doc = ui.doc();
    let in_tree = |point| {
        doc.engine(|engine, _| engine.accessible_point(point))
            .and_then(|[node, offset]| range::from_engine(doc, node, offset))
    };
    if let [Some(anchor), Some(focus)] = ends.map(in_tree) {
        focus_for_caret(cx, ui, focus.node);
        if [anchor, focus]
            .iter()
            .all(|it| it.node.is_connected() && it.offset <= it.node.length())
        {
            range::selection_of(&cx.heap, doc).select(cx, anchor, focus);
        }
    }
}

/// A listener may have sent the focus elsewhere.
fn is_typed_in(ui: &Ui, element: &Element) -> bool {
    ui.focused()
        .is_some_and(|it| it.contains_composed(element) || element.contains_composed(it))
}

fn replace_selected_text<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, text: &DomString) {
    if is_typed_in(ui, element) {
        editing::insert_text(cx, ui, text, atom!("insertReplacementText"), By::User);
    }
}

fn set_value<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element, text: &DomString) {
    focus::focus(cx, element, Cause::Keyboard, Default::default());
    if let Some(input) = Input::of(element).filter(|it| !it.kind().has_editor()) {
        return input.set_value_by_user(cx, text);
    }
    if is_typed_in(ui, element) {
        editing::execute(cx, ui, Command::SelectAll, &DomString::default(), By::User);
    }
    replace_selected_text(cx, ui, element, text);
}

fn show_context_menu<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element) {
    ui.pointer().at.set(center_of(cx, element));
    ui.note_user_activation(false);
    mouse::context_menu(cx, ui, element);
}

/// `node` is what the library calls it.
pub(crate) fn perform_accessibility_action<'a>(
    cx: &mut Cx<'a>,
    ui: &'a Ui,
    node: u32,
    action: u8,
    numbers: &[u32],
    text: &DomString,
) {
    let (doc, Some(action)) = (ui.doc(), Action::ALL.get(usize::from(action))) else {
        return;
    };
    if let (Action::SelectText, &[a, b, c, d]) = (action, numbers) {
        return select_text(
            cx,
            ui,
            [
                abi::Point { node: a, offset: b },
                abi::Point { node: c, offset: d },
            ],
        );
    }
    let node = doc
        .rendered_node(doc.engine(|engine, _| engine.not_generated(engine.accessible_node(node))));
    let Some(element) =
        node.and_then(|it| it.as_element().or_else(|| it.flat_parent()?.as_element()))
    else {
        return;
    };
    let input = element.out_of_control().as_element().filter(|_| {
        matches!(
            action,
            Action::Click | Action::Focus | Action::Increment | Action::Decrement
        )
    });
    let has_entered = input.and_then(Input::of).is_some_and(|it| {
        date_fields::enter(cx, it, element) || color_picker::enter(cx, it, element)
    });
    let element = input
        .filter(|_| has_entered && *action == Action::Focus)
        .unwrap_or(element);
    let is_tree_item = || element.engine(Document::computed_role_and_name)[0] == "treeitem";
    match action {
        Action::Expand if is_tree_item() => press_key(cx, ui, element, atom!("ArrowRight")),
        Action::Collapse if is_tree_item() => press_key(cx, ui, element, atom!("ArrowLeft")),
        Action::Click | Action::Select | Action::Deselect | Action::Expand | Action::Collapse => {
            press(cx, ui, element)
        }
        Action::Focus => focus::focus(cx, element, Cause::Script, Default::default()),
        Action::Blur => focus::blur(cx, element),
        Action::SetValue => set_value(cx, ui, element, text),
        Action::Increment | Action::Decrement => {
            adjust(cx, ui, element, *action == Action::Increment)
        }
        Action::ScrollIntoView => layout::scroll_into_view(cx, element, Alignment::Nearest),
        Action::ShowContextMenu => show_context_menu(cx, ui, element),
        Action::ReplaceSelectedText => {
            focus::focus(cx, element, Cause::Mouse, Default::default());
            replace_selected_text(cx, ui, element, text);
        }
        Action::Cancel => press_key(cx, ui, element, atom!("Escape")),
        Action::SelectText => {}
    }
}
