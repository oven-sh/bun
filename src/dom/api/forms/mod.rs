//! https://html.spec.whatwg.org/#forms

mod autofill;
pub(crate) mod button;
pub(crate) mod collections;
pub(crate) mod color_picker;
pub(crate) mod date_fields;
mod date_picker;
pub(crate) mod dormant;
pub(crate) mod entry;
pub(crate) mod form;
pub(crate) mod form_data;
pub(crate) mod gauge;
pub(crate) mod input;
mod input_events;
mod input_type;
pub(crate) mod internals;
mod locale;
pub(crate) mod microsyntax;
pub(crate) mod option;
pub(crate) mod restoration;
pub(crate) mod select;
mod select_events;
mod steps;
pub(crate) mod suggestions;
pub(crate) mod text;
pub(crate) mod textarea;
pub(crate) mod validity;

use core::cell::{Cell, RefCell};

use smallvec::SmallVec;

use crate::api::core::custom;
use crate::api::ui::prelude::*;
use crate::api::ui::top_layer::set_in_top_layer;
use crate::api::ui::{focus, popover};
use crate::order::Order as _;
pub(crate) use button::button_type;
use input::Input;
pub(crate) use input_type::InputType;
use internals::Custom;
use select::Select;
pub(crate) use text::TextControl;

/// What all the controls have.
#[derive(Default)]
pub(crate) struct Control {
    custom_error: RefCell<Option<DomString>>,
    /// For `:user-valid`.
    was_edited: Cell<bool>,
    /// It is in `Ui::dirty_controls`.
    /// The address of the `Ui` that has it among its dirty controls, or 0.
    stale_in: Cell<usize>,
}

fn control(element: &Element) -> &Control {
    element.unset(NodeFlags::DORMANT);
    match element.kind().only_tag() {
        atom!("input") => &Input::new(element).state.text.control,
        atom!("textarea") => &element.extra::<text::TextState>().control,
        _ => element.extra(),
    }
}

/// An element in the shadow tree of `host`.
fn part<'a>(
    cx: &mut Cx<'a>,
    host: &'a Element,
    parent: &'a Node,
    pseudo: &str,
    tag: Known,
) -> &'a Element {
    part_before(cx, host, parent, pseudo, tag, None)
}

fn part_before<'a>(
    cx: &mut Cx<'a>,
    host: &'a Element,
    parent: &'a Node,
    pseudo: &str,
    tag: Known,
    before: Option<&'a Node>,
) -> &'a Element {
    let made = host.doc().create_html(&cx.heap, tag);
    made.set_pseudo(pseudo, host);
    insert(cx, made, parent, before, Observers::Suppress);
    made
}

fn div<'a>(cx: &mut Cx<'a>, host: &'a Element, parent: &'a Node, pseudo: &str) -> &'a Element {
    part(cx, host, parent, pseudo, atom!("div"))
}

fn text_in<'a>(cx: &mut Cx<'a>, parent: &'a Node, text: &str) -> &'a Node {
    let made = parent.doc().create_text(&cx.heap, text.into());
    insert(cx, made, parent, None, Observers::Suppress);
    made
}

fn set_text<'a>(cx: &mut Cx<'a>, node: Option<&'a Node>, text: &DomString) {
    if let Some(node) = node
        .and_then(Node::as_character_data)
        .filter(|it| it.data() != *text)
    {
        node.replace_all_data(cx, text);
    }
}

fn set_part_style<'a>(cx: &mut Cx<'a>, part: &'a Element, style: &str) {
    if part.with_attr(atom!("style"), |it| it == style) != Some(true) {
        part.set_attr(cx, atom!("style"), DomString::from(style));
    }
}

pub(crate) fn before_attribute_changes(input: &Element) {
    Input::new(input);
}

fn parts_of(host: &Element) -> Option<&ShadowRoot> {
    TextControl::of(host).map(TextControl::editor);
    host.shadow_root()
}

fn pop_up<'a>(host: &'a Element, pseudo: &str) -> Option<&'a Element> {
    host.shadow_root()?
        .last_child()?
        .as_element()
        .filter(|it| it.is_part(pseudo))
}

fn open_pop_up<'a>(cx: &mut Cx<'a>, host: &'a Element, pseudo: &str) -> Option<&'a Element> {
    let (ui, root) = (
        Ui::of(host.doc()).filter(|_| host.is_connected())?,
        parts_of(host)?,
    );
    close_picker(cx, ui);
    let made = div(cx, host, root, pseudo);
    set_in_top_layer(cx, ui, made, true);
    made.synced_engine(cx, |engine, id| engine.set_implicit_anchor(id, host.id()));
    ui.set_open_picker(Some(host));
    Some(made)
}

fn close_pop_up<'a>(cx: &mut Cx<'a>, host: &'a Element, pseudo: &str) {
    if let (Some(ui), Some(it)) = (Ui::left_in(host.doc()), pop_up(host, pseudo)) {
        set_in_top_layer(cx, ui, it, false);
        remove(cx, it, Observers::Suppress);
        ui.set_open_picker(None);
    }
}

fn remove_children<'a>(cx: &mut Cx<'a>, parent: &'a Node) {
    while let Some(child) = parent.first_child() {
        remove(cx, child, Observers::Suppress);
    }
}

/// Its looks and its validity are brought up to date before the engine is next asked something.
fn dirty<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    element.unset(NodeFlags::DORMANT);
    let Some(ui) = Ui::of(element.doc()).filter(|_| element.is_connected()) else {
        return;
    };
    let address = core::ptr::from_ref(ui).addr();
    if control(element).stale_in.replace(address) != address {
        let mut list = ui.dirty_controls();
        list.push(&cx.heap, element);
        ui.set_dirty_controls(list);
        ui.doc().set_needs_sync();
        ui.doc().invalidate(cx);
    }
}

fn fire_input<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    fire(cx, element, atom!("input"), COMPOSED);
}

fn user_changed<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    control(element).was_edited.set(true);
    dirty(cx, element);
    fire_input(cx, element);
    fire(cx, element, atom!("change"), BUBBLES);
}

pub(crate) fn normalize_newlines(text: &DomString) -> DomString {
    const CR: u16 = 13;
    const LF: u16 = 10;
    if !text.chars().contains(b'\r') {
        return text.clone();
    }
    let (mut out, mut last) = (StringBuilder::with_capacity(text.len() as usize), 0);
    for unit in text.units() {
        if (last, unit) != (CR, LF) {
            out.push_unit(if unit == CR { LF } else { unit });
        }
        last = unit;
    }
    out.finish()
}

pub(crate) fn without_newlines(text: &DomString) -> DomString {
    if !text.has_newline() {
        return text.clone();
    }
    let mut out = StringBuilder::with_capacity(text.len() as usize);
    text.units()
        .filter(|it| !matches!(it, 10 | 13))
        .for_each(|it| out.push_unit(it));
    out.finish()
}

fn from_ascii(text: &[u8]) -> DomString {
    DomString::from_latin1(text)
}

pub(crate) fn input_type(element: &Element) -> Option<InputType> {
    Input::of(element).map(Input::kind)
}

/// An `input` or a `textarea` that has an editor.
pub(crate) fn text_control(node: &Node) -> Option<TextControl<'_>> {
    TextControl::of(node.as_element()?).filter(|it| it.has_editor())
}

/// Dates too.
pub(crate) fn is_typed_in(element: &Element) -> bool {
    element.is_html(atom!("textarea")) || input_type(element).is_some_and(InputType::is_typed)
}

/// <https://html.spec.whatwg.org/#create-an-element-for-the-token>
pub(crate) fn associate_by_parser(
    heap: &JsHeap<'_>,
    control: &Element,
    form: &Element,
    parent: &Node,
) {
    let follows_attribute = control.has_attr(atom!("form")) && !control.is_html(atom!("img"));
    let is_associated = control.kind() != Kind::HtmlElement && !control.has(NodeFlags::CUSTOM);
    if is_associated && !follows_attribute && parent.closest_html(atom!("form")) != Some(form) {
        control.unset(NodeFlags::DORMANT);
        control.arena().has_remote_owners.set(true);
        control.ties_changed();
        control.set_edge(heap, Edge::ParserForm, form.to_js());
        form.edge_list(heap, Edge::ParserControls)
            .push(heap, control.to_js());
    }
}

fn is_form_associated_custom(element: &Element) -> bool {
    element.has(NodeFlags::CUSTOM) && element.state().contains(State::FORM_ASSOCIATED)
}

/// https://html.spec.whatwg.org/#category-listed
pub(crate) fn is_listed(element: &Element) -> bool {
    use Kind::*;
    matches!(
        element.kind(),
        Button | FieldSet | Input | Object | Output | Select | TextArea
    ) || is_form_associated_custom(element)
}

pub(crate) fn is_labelable(element: &Element) -> bool {
    match element.html_tag() {
        atom!("input") => input_type(element) != Some(InputType::Hidden),
        atom!("button")
        | atom!("meter")
        | atom!("output")
        | atom!("progress")
        | atom!("select")
        | atom!("textarea") => true,
        _ => is_form_associated_custom(element),
    }
}

/// https://html.spec.whatwg.org/#concept-element-disabled
pub(crate) fn is_disabled(element: &Element) -> bool {
    let has_attribute = |it: &Element| it.has_attr(atom!("disabled"));
    match element.html_tag() {
        atom!("optgroup") => return has_attribute(element),
        atom!("option") => {
            return has_attribute(element)
                || option::select_or_group_of(element)
                    .is_some_and(|it| it.is_html(atom!("optgroup")) && has_attribute(it));
        }
        atom!("button")
        | atom!("fieldset")
        | atom!("input")
        | atom!("select")
        | atom!("textarea") => {
            if element.is_rendered() && element.is_connected() {
                return element.has_state(State::DISABLED);
            }
        }
        _ if is_form_associated_custom(element) => {}
        _ => return false,
    }
    let disables = |(child, parent): (&Node, &Node)| {
        parent.is_html(atom!("fieldset"))
            && parent.as_element().is_some_and(has_attribute)
            && !(child.is_html(atom!("legend"))
                && parent
                    .first_html_child(atom!("legend"))
                    .is_some_and(|it| &**it == child))
    };
    has_attribute(element)
        || element
            .inclusive_ancestors()
            .zip(element.ancestors())
            .any(disables)
}

/// https://html.spec.whatwg.org/#form-owner
pub(crate) fn form_owner(element: &Element) -> Option<&Element> {
    match (may_have_remote_owners(element) && element.is_connected())
        .then(|| element.attr(atom!("form")))
        .flatten()
    {
        Some(id) => element
            .root()
            .element_by_id(&Atom::from_string(&id))?
            .reference_target()
            .filter(|it| it.is_html(atom!("form"))),
        None => {
            let by_parser = may_have_remote_owners(element)
                .then(|| element.edge_node(Edge::ParserForm))
                .flatten();
            by_parser.map_or_else(
                || element.parent()?.closest_html(atom!("form")),
                Node::as_element,
            )
        }
    }
}

/// `target` as the scripts that have `element` see it.
fn seen_from<'a>(element: &Element, target: Option<&'a Element>) -> Option<&'a Node> {
    target.map(|it| it.retarget(Some(element)))
}

fn controls_of(form: &Element) -> impl Iterator<Item = &Element> {
    static CONTROLS: Test = Test {
        bare: Bare::None,
        reads: Reads::Ties,
        matches: is_listed,
        belongs: |form, it| form_owner(it).is_some_and(|it| **it == *form),
        lists: |form, add| {
            may_have_remote_owners(form) && {
                add.into_iter().for_each(|add| {
                    form.as_element()
                        .into_iter()
                        .flat_map(find_controls_of)
                        .for_each(add)
                });
                true
            }
        },
        ..Test::ALL
    };
    form.unseen_collection(15, &CONTROLS).elements()
}

fn find_controls_of(form: &Element) -> Vec<&Element> {
    let (root, belongs) = (form.root(), |it: &&Element| {
        is_listed(it) && form_owner(it) == Some(form)
    });
    if root
        .as_shadow_root()
        .is_some_and(|it| it.reference_target().is_some())
    {
        return form.referrers().filter(belongs).collect();
    }
    let id = form
        .attr(atom!("id"))
        .map(|it| Atom::from_string(&it))
        .filter(|it| form.is_connected() && root.element_by_id(it) == Some(form));
    let mut outside = id
        .map(|it| with_form_attribute(root, &it).into_vec())
        .unwrap_or_default();
    let in_order = outside.len();
    let by_parser = form
        .try_edge_list(Edge::ParserControls)
        .into_iter()
        .flat_map(List::nodes)
        .filter_map(Node::as_element);
    outside.extend(
        by_parser.filter(|it| it.edge_node(Edge::ParserForm) == Some(form) && it.root() == root),
    );
    let needs_order = outside.len() > in_order;
    outside.retain(|it| belongs(it) && !form.contains(it));
    if needs_order {
        outside.order_by(|a, b| a.compare_order(b));
        outside.dedup();
    }
    let at = outside.partition_point(|it| it.compare_order(form).is_lt());
    outside.splice(at..at, form.elements_with_objects().filter(belongs));
    outside
}

fn with_form_attribute<'a>(scope: &'a Node, id: &Atom) -> SmallVec<[&'a Element; 2]> {
    static REMOTE: Test = Test {
        bare: Bare::None,
        reads: Reads::Ties,
        matches: |it| is_listed(it) && it.has_attr(atom!("form")),
        ..Test::ALL
    };
    scope
        .unseen_collection(17, &REMOTE)
        .all_named(id, |it| [it.attr(atom!("form")), None])
}

/// https://html.spec.whatwg.org/#labeled-control
pub(crate) fn labeled_control(label: &Element) -> Option<&Element> {
    let control = |it: &'_ Element| {
        it.reference_target()
            .filter(|it| is_labelable(it))
            .is_some()
    };
    let found = match label.attr(atom!("for")) {
        Some(id) => label
            .root()
            .element_by_id(&Atom::from_string(&id))
            .filter(|it| control(it)),
        None => {
            dormant::make_objects(label).take(1).for_each(drop);
            label.elements_with_objects().find(|it| control(it))
        }
    };
    found?.reference_target()
}

pub(crate) fn labels_of(element: &Element) -> impl Iterator<Item = &Element> {
    static LABELS: Test = Test {
        tags: &[atom!("label")],
        reads: Reads::Ties,
        matches: |it| it.kind() == Kind::Label && it.has_attr(atom!("for")),
        ..Test::ALL
    };
    let root = element.root();
    let mut found: SmallVec<[&Element; 2]> = match root
        .as_shadow_root()
        .is_some_and(|it| it.reference_target().is_some())
    {
        true => element
            .referrers()
            .filter(|it| it.kind() == Kind::Label)
            .collect(),
        false => {
            let id = element
                .attr(atom!("id"))
                .filter(|_| root.may_have_below(atom!("label")))
                .map(|it| Atom::from_string(&it));
            let mut found = id
                .map(|it| {
                    root.unseen_collection(14, &LABELS)
                        .all_named(&it, |it| [it.attr(atom!("for")), None])
                })
                .unwrap_or_default();
            let around = element
                .ancestors()
                .filter_map(Node::as_element)
                .filter(|it| it.kind() == Kind::Label && !found.contains(it))
                .collect::<SmallVec<[_; 1]>>();
            if !around.is_empty() {
                found.extend(around);
                found.order_by(|a, b| a.compare_order(b));
            }
            found
        }
    };
    found.retain(|it| labeled_control(it) == Some(element));
    found.into_iter()
}

fn render<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    match element.html_tag() {
        atom!("input") => Input::new(element).render(cx),
        atom!("textarea") => TextControl::of_textarea(element).render(cx),
        atom!("select") => Select::new(element).render(cx),
        atom!("button") => {
            button::update_default(cx, element);
            if element.has_attr(atom!("interestfor")) && is_disabled(element) {
                crate::api::ui::interest::forget(cx, element);
            }
        }
        atom!("meter") | atom!("progress") => gauge::render(cx, element),
        _ => {}
    }
}

/// https://html.spec.whatwg.org/#concept-form-reset-control
fn reset<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    match element.html_tag() {
        atom!("input") => return Input::new(element).reset(cx),
        atom!("textarea") => textarea::reset(cx, element),
        atom!("select") => Select::new(element).reset(cx),
        atom!("output") => button::reset_output(cx, element),
        _ if is_form_associated_custom(element) => {
            custom::enqueue_callback(cx, element, custom::Callback::FormReset, &[])
        }
        _ => {}
    }
    control(element).was_edited.set(false);
    dirty(cx, element);
}

fn is_group(element: &Element) -> bool {
    matches!(element.html_tag(), atom!("form") | atom!("fieldset"))
}

fn update<'a>(cx: &mut Cx<'a>, controls: Refs<'a, Element>) {
    let (mut groups, mut seen) = (Refs::default(), crate::name::Set::default());
    input::remembering_groups(|| {
        let mut add = |heap: &JsHeap<'a>, group: &Element| {
            if seen.insert(group.id()) {
                groups.push(heap, group);
            }
        };
        for element in controls.iter() {
            if is_group(element) {
                add(&cx.heap, element);
                continue;
            }
            let was_invalid = element.has_state(State::INVALID);
            render(cx, element);
            if is_listed(element) && validity::update_states(cx, element) != was_invalid {
                let fieldsets = element
                    .ancestors()
                    .filter(|it| it.is_html(atom!("fieldset")))
                    .filter_map(Node::as_element);
                form_owner(element)
                    .into_iter()
                    .chain(fieldsets)
                    .for_each(|it| add(&cx.heap, it));
            }
        }
        groups
            .iter()
            .for_each(|it| validity::update_states_of_group(cx, it));
    });
}

fn may_have_remote_owners(node: &Node) -> bool {
    node.arena().has_remote_owners.get()
}

pub(crate) fn flush<'a>(cx: &mut Cx<'a>, doc: &'a Doc) {
    let Some(ui) = Ui::of(doc) else { return };
    ui.radios.dirty_changed_groups(cx, doc);
    if ui.dirty_controls().is_empty() {
        return;
    }
    let dirty = ui.dirty_controls();
    ui.set_dirty_controls(Refs::default());
    ui.scope_of_dirty_groups.set(0);
    let address = core::ptr::from_ref(ui).addr();
    dirty.iter().for_each(|it| {
        control(it)
            .stale_in
            .update(|it| if it == address { 0 } else { it })
    });
    let still_here = Refs::collect(
        &cx.heap,
        dirty
            .iter()
            .filter(|it| it.is_connected() && it.doc() == doc),
    );
    update(cx, still_here);
}

/// For matching selectors in a tree that is not shown.
pub(crate) fn update_all_in<'a>(cx: &mut Cx<'a>, root: &'a Node) {
    let is_control =
        |it: &&Element| is_listed(it) || matches!(it.html_tag(), atom!("form") | atom!("progress"));
    let controls = Refs::collect(
        &cx.heap,
        root.objects()
            .filter_map(Node::as_element)
            .filter(is_control),
    );
    update(cx, controls);
}

/// The groups that it is in now hear of it if it is invalid.
fn inserted<'a>(cx: &mut Cx<'a>, element: &'a Element, _: bool) {
    element.set_state(cx, State::INVALID, false);
    dirty(cx, element);
}

fn attribute_changed<'a>(cx: &mut Cx<'a>, element: &'a Element, change: &AttrChange<'_>) {
    if change.is(atom!("form")) {
        element.clear_edge(&cx.heap, Edge::ParserForm);
        owner_changed(cx, element, element.root());
    }
    dirty(cx, element);
}

fn owner_changed<'a>(cx: &mut Cx<'a>, control: &'a Element, scope: &'a Node) {
    if control.has_state(State::INVALID) {
        dirty_invalid_groups(cx, scope);
        form_owner(control).into_iter().for_each(|it| dirty(cx, it));
    }
    Input::of(control)
        .into_iter()
        .for_each(|it| it.group_changed(cx, scope));
}

fn dirty_invalid_groups<'a>(cx: &mut Cx<'a>, scope: &'a Node) {
    let address = core::ptr::from_ref(scope).addr();
    if Ui::of(scope.doc()).is_some_and(|it| it.scope_of_dirty_groups.replace(address) != address) {
        let groups = [atom!("form"), atom!("fieldset")]
            .into_iter()
            .flat_map(|it| scope.objects_with_tag(it));
        groups
            .filter(|it| is_group(it) && it.has_state(State::INVALID))
            .for_each(|it| dirty(cx, it));
    }
}

/// Another element goes by it.
pub(crate) fn id_changed<'a>(cx: &mut Cx<'a>, scope: &'a Node, id: &DomString) {
    for control in
        Refs::collect(&cx.heap, with_form_attribute(scope, &Atom::from_string(id))).iter()
    {
        dirty(cx, control);
        owner_changed(cx, control, scope);
    }
}

fn removed<'a>(cx: &mut Cx<'a>, element: &'a Element, scope: &'a Node, _: bool) {
    if element
        .edge_node(Edge::ParserForm)
        .is_some_and(|it| it.root() != element.root())
    {
        element.clear_edge(&cx.heap, Edge::ParserForm);
        element.ties_changed();
    }
    if element.has_state(State::INVALID) {
        dirty_invalid_groups(cx, scope);
    }
}

pub(crate) fn can_activate(element: &Element) -> bool {
    match element.local().known() {
        atom!("a") | atom!("area") => element.has_href(),
        atom!("audio") | atom!("video") => element.has_attr(atom!("controls")),
        atom!("label") => labeled_control(element).is_some(),
        _ => match input_type(element) {
            Some(InputType::Checkbox | InputType::Radio) => true,
            Some(InputType::Hidden) => false,
            _ => !is_disabled(element),
        },
    }
}

pub(crate) fn invokes_popovers(element: &Element) -> bool {
    input_type(element).map_or_else(|| element.is_html(atom!("button")), InputType::is_button)
        && !is_disabled(element)
        && !(button::is_submit_button(element) && form_owner(element).is_some())
}

/// Tab goes to one of a group.
pub(crate) fn is_skipped_radio<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    let Some(input) =
        Input::of(element).filter(|it| it.kind() == InputType::Radio && !it.is_checked())
    else {
        return false;
    };
    input.group().any(|it| {
        focus::has_focus(it.element) || it.is_checked() && focus::is_focusable(cx, it.element)
    }) || input
        .group()
        .find(|it| focus::is_focusable(cx, it.element))
        .is_none_or(|it| it.element != element)
}

pub(crate) fn before_blur<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element) {
    if let Some(select) =
        Select::of(element).filter(|it| !it.popover().is_some_and(popover::is_showing))
    {
        select.set_open(cx, false);
    } else if let Some(owner) = option::owner(element) {
        owner.set_edge(&cx.heap, Edge::LastFocusedOption, element.value());
    }
    if element.has_state(State::ACTIVE) && !ui.pointer().pressed().contains(element) {
        element.set_state(cx, State::ACTIVE, false);
    }
    crate::api::editing::input_method::end_composition(cx, ui);
    if let Some(input) = Input::of(element).filter(|it| !it.kind().has_date_fields()) {
        input.close_picker(cx);
    }
    let Some(text) = TextControl::of(element) else {
        return;
    };
    text.commit(cx);
    if let Some(editor) = text.editor().filter(|_| element.is_html(atom!("input"))) {
        layout::laid_out(cx, editor, |engine, id| {
            engine.scroll_to(id, [0.0; 2], 0, false)
        });
    }
    crate::api::editing::selection::looks_changed(cx, ui);
}

pub(crate) fn focus_changed<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    if let Some(input) = Input::of(element).filter(|it| it.kind().has_date_fields()) {
        date_fields::focus_changed(cx, input);
    }
}

pub(crate) fn close_picker<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    let Some(control) = ui.open_picker() else {
        return;
    };
    match Input::of(control) {
        Some(input) if input.kind() == InputType::Color => color_picker::finish(cx, input),
        Some(input) => input.close_picker(cx),
        None => Select::new(control).set_open(cx, false),
    }
}

fn require_picker(
    element: &Element,
    is_mutable: bool,
    is_for_any_origin: bool,
) -> Result<(), Refusal> {
    let ui = Ui::of(element.doc());
    if !is_mutable {
        Err((
            DomError::InvalidStateError,
            "showPicker() cannot be used on immutable controls.",
        ))
    } else if !is_for_any_origin
        && ui.is_some_and(|it| crate::api::frames::top_of_same_origin(it).is_none())
    {
        Err((
            DomError::SecurityError,
            "showPicker() called from cross-origin iframe.",
        ))
    } else if !ui.is_some_and(Ui::has_transient_activation) {
        Err((
            DomError::NotAllowedError,
            "showPicker() requires a user gesture.",
        ))
    } else {
        Ok(())
    }
}

/// -1 or 1.
fn arrow_step(key: Known) -> Option<i32> {
    match key {
        atom!("ArrowUp") | atom!("ArrowLeft") => Some(-1),
        atom!("ArrowDown") | atom!("ArrowRight") => Some(1),
        _ => None,
    }
}

fn writing_mode<'a>(cx: &mut Cx<'a>, element: &'a Element) -> crate::values::Flow {
    layout::style(cx, element, |it| it.flow()).unwrap_or(crate::values::Flow::DEFAULT)
}

pub(crate) fn custom_control(element: &Element) -> Option<&Custom> {
    element
        .state()
        .contains(State::FORM_ASSOCIATED)
        .then(|| element.extra())
}
