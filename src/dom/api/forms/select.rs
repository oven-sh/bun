//! https://html.spec.whatwg.org/#the-select-element

use core::sync::atomic::{AtomicBool, Ordering};

use super::option::{is_option, is_selected, select_of, set_dirty, set_selected};
use super::validity::Validity;
use super::*;
use crate::generated_bindgen::forms::{
    ElementOrIndex, HTMLOptionElement, HTMLSelectElement, OptionOrGroup, js_HTMLOptionsCollection,
};
use crate::tree::Flags;

#[derive(Default)]
pub(super) struct SelectState {
    pub(super) typed: RefCell<String>,
    pub(super) typed_at: Cell<Option<f64>>,
    pub(super) is_pressed: Cell<bool>,
    pub(super) is_being_emptied: Cell<bool>,
    pub(super) opened_at: Cell<Option<[f64; 2]>>,
    /// How many of the options whose owner it is are selected. `Edge::ChosenOption` has the one that was last counted.
    chosen: Cell<u32>,
    /// What gives it its width has them.
    has_measured_labels: Cell<bool>,
}

static OPTIONS: Test = Test {
    tags: &[atom!("option")],
    matches: is_option,
    belongs: |select, it| select_of(it).is_some_and(|it| **it.element == *select),
    ..Test::ALL
};

/// `node` has come from, or gone to, a `select` or one of its descendants.
pub(crate) fn descendant_moved<'a>(cx: &mut Cx<'a>, node: &'a Node) {
    let is_inside = node
        .parent()
        .is_some_and(|it| it.has(NodeFlags::IN_SELECT) || it.kind() == Kind::Select);
    let (mut next, mut options) = (Some(node), Refs::default());
    while let Some(at) = next {
        at.toggle(NodeFlags::IN_SELECT, is_inside);
        if let Some(option) = at.as_element().filter(|it| is_option(it) && at != node) {
            options.push(&cx.heap, option);
        }
        next = if at.kind() == Kind::Select {
            at.following_skip(Some(node))
        } else {
            at.following(Some(node))
        };
    }
    options.iter().for_each(|it| option::update_owner(cx, it));
}

/// The children of a descendant of a `select`, or their text.
pub(crate) fn contents_changed<'a>(cx: &mut Cx<'a>, parent: &'a Node) {
    parent
        .closest_html(atom!("select"))
        .into_iter()
        .for_each(|it| Select::new(it).labels_changed(cx));
}

#[derive(Clone, Copy)]
pub(crate) struct Select<'a> {
    pub(crate) element: &'a Element,
}

static HAS_SELECTED_CONTENT: AtomicBool = AtomicBool::new(false);

fn show_in<'a>(cx: &mut Cx<'a>, option: Option<&'a Element>, content: &'a Element) {
    let fragment = content.doc().create_fragment(&cx.heap);
    for child in option.into_iter().flat_map(|it| it.children()) {
        _ = clone_node(
            cx,
            child,
            content.doc(),
            true,
            Some(fragment),
            JSValue::NULL,
        );
    }
    replace_all(cx, Some(fragment), content);
}

pub(super) fn note_selected_content() {
    HAS_SELECTED_CONTENT.store(true, Ordering::Relaxed);
}

impl<'a> Select<'a> {
    pub(super) fn new(element: &'a Element) -> Select<'a> {
        Select { element }
    }

    pub(crate) fn of(element: &'a Element) -> Option<Select<'a>> {
        element
            .is_html(atom!("select"))
            .then_some(Select { element })
    }

    pub(super) fn state(self) -> &'a SelectState {
        self.element.extra()
    }

    /// https://html.spec.whatwg.org/#concept-select-option-list
    pub(crate) fn options(self) -> impl Iterator<Item = &'a Element> + Clone {
        let root: &Node = self.element;
        let next = move |at: &&'a Node| {
            let is_closed = match at.html_tag() {
                atom!("select") => true,
                atom!("optgroup") => at
                    .ancestors()
                    .take_while(|it| *it != root)
                    .any(|it| it.is_html(atom!("optgroup"))),
                tag => option::ends_list_of_options(tag),
            };
            if is_closed {
                at.following_skip(Some(root))
            } else {
                at.following(Some(root))
            }
        };
        core::iter::successors(root.first_child(), next)
            .filter(|it| it.is_html(atom!("option")))
            .filter_map(Node::as_element)
    }

    /// The same, remembered.
    pub(super) fn list(self) -> &'a HTMLCollection {
        self.element
            .collection_at(Edge::Options, js_HTMLOptionsCollection::CLASS, &OPTIONS)
    }

    pub(crate) fn selected(self) -> impl Iterator<Item = &'a Element> + Clone {
        let count = self.state().chosen.get();
        let last = (count == 1)
            .then(|| self.element.edge_node(Edge::ChosenOption)?.as_element())
            .flatten();
        let all = (count > 0 && last.is_none()).then(|| {
            self.options()
                .filter(|it| is_selected(it) && option::owner(it) == Some(self.element))
        });
        last.into_iter()
            .chain(all.into_iter().flatten().take(count as usize))
    }

    /// One of its options was selected, or has come that way, or the opposite.
    pub(super) fn count(self, heap: &JsHeap<'a>, option: &'a Element, is_chosen: bool) {
        self.state()
            .chosen
            .update(|it| if is_chosen { it + 1 } else { it - 1 });
        if is_chosen {
            self.element
                .set_edge(heap, Edge::ChosenOption, option.value());
        } else if self.element.edge_node(Edge::ChosenOption) == Some(option) {
            self.element.clear_edge(heap, Edge::ChosenOption);
        }
    }

    pub(super) fn labels_changed(self, cx: &mut Cx<'a>) {
        self.state().has_measured_labels.set(false);
        dirty(cx, self.element);
    }

    pub(crate) fn is_multiple(self) -> bool {
        self.element.has_attr(atom!("multiple"))
    }

    pub(crate) fn is_drop_down(self) -> bool {
        let size = self.element.integer(atom!("size"));
        if self.is_multiple() {
            size == Some(1)
        } else {
            size.is_none_or(|it| it <= 1)
        }
    }

    pub(crate) fn is_open(self) -> bool {
        self.element.state().contains(State::PICKER_OPEN)
    }

    fn appearance(self, cx: &mut Cx<'a>) -> Flags {
        layout::styled(cx, self.element, |engine, id| {
            engine.tree[id].flags.get() & (Flags::BASE_SELECT | Flags::BASE_OPTIONS)
        })
    }

    pub(super) fn has_base_options(self, cx: &mut Cx<'a>) -> bool {
        self.appearance(cx).contains(Flags::BASE_OPTIONS)
    }

    fn is_base_list_box(self, cx: &mut Cx<'a>) -> bool {
        !self.is_drop_down() && !self.appearance(cx).is_empty()
    }

    pub(super) fn author_button(self) -> Option<&'a Element> {
        self.element
            .element_children()
            .next()
            .filter(|it| it.is_html(atom!("button")))
    }

    /// `::picker(select)`
    pub(super) fn popover(self) -> Option<&'a Element> {
        self.element.shadow_root()?.last_child()?.as_element()
    }

    pub(super) fn picker(self) -> Option<&'a Element> {
        self.popover()?.first_child()?.as_element()
    }

    pub(super) fn focusable_options(self, cx: &mut Cx<'a>) -> Vec<&'a Element> {
        self.options()
            .filter(|it| focus::is_focusable(cx, it))
            .collect()
    }

    pub(super) fn may_have_selected_content(self) -> bool {
        HAS_SELECTED_CONTENT.load(Ordering::Relaxed)
    }

    /// https://html.spec.whatwg.org/#update-a-select's-selectedcontent
    pub(super) fn update_selected_content(self, cx: &mut Cx<'a>, always: bool) {
        if !self.may_have_selected_content() || self.is_multiple() {
            return;
        }
        let (element, chosen) = (self.element, self.selected().next());
        if !always && chosen.map(|it| &**it) == element.edge_node(Edge::ShownOption)
            || chosen.is_some_and(|it| it.has(NodeFlags::BEING_PARSED))
        {
            return;
        }
        element.set_edge_node(&cx.heap, Edge::ShownOption, chosen);
        let shows_it = |it: &&Element| {
            it.is_html(atom!("selectedcontent"))
                && option::select_shown_by(it).is_some_and(|it| it.element == element)
        };
        Refs::collect(&cx.heap, element.elements_with_objects().filter(shows_it))
            .iter()
            .for_each(|it| show_in(cx, chosen, it));
    }

    pub(super) fn selected_content_inserted(self, cx: &mut Cx<'a>, content: &'a Element) {
        let chosen = self.selected().next();
        if chosen.map(|it| &**it) != self.element.edge_node(Edge::ShownOption) {
            self.update_selected_content(cx, true);
        } else if !self.is_multiple() && !chosen.is_some_and(|it| it.has(NodeFlags::BEING_PARSED)) {
            show_in(cx, chosen, content);
        }
    }

    /// https://html.spec.whatwg.org/#selectedness-setting-algorithm
    pub(super) fn settle(self, cx: &mut Cx<'a>) {
        dirty(cx, self.element);
        if self.is_multiple() {
            return;
        }
        let last = self.selected().reduce(|earlier, it| {
            set_selected(cx, earlier, false);
            it
        });
        if last.is_none()
            && self.is_drop_down()
            && let Some(first) = self.options().find(|it| !is_disabled(it))
        {
            set_selected(cx, first, true);
        }
    }

    pub(super) fn ask_for_reset(self, cx: &mut Cx<'a>) {
        self.settle(cx);
        self.update_selected_content(cx, false);
    }

    pub(super) fn select_only(self, cx: &mut Cx<'a>, chosen: Option<&'a Element>) {
        self.selected()
            .filter(|it| Some(*it) != chosen)
            .for_each(|it| set_selected(cx, it, false));
        if let Some(it) = chosen {
            set_selected(cx, it, true);
            set_dirty(it, true);
        }
        dirty(cx, self.element);
        self.update_selected_content(cx, true);
    }

    /// By the user.
    pub(super) fn choose(self, cx: &mut Cx<'a>, chosen: &'a Element) {
        set_dirty(chosen, true);
        if !self.selected().eq([chosen]) {
            self.select_only(cx, Some(chosen));
            user_changed(cx, self.element);
        }
    }

    pub(super) fn errors(self) -> Validity {
        let is_placeholder = |it: &Element| {
            self.is_drop_down()
                && !self.is_multiple()
                && self.options().next() == Some(it)
                && option::select_or_group_of(it) == Some(self.element)
                && option::value(it).is_empty()
        };
        let is_missing = self.element.has_attr(atom!("required"))
            && self.selected().next().is_none_or(is_placeholder);
        if is_missing {
            Validity::VALUE_MISSING
        } else {
            Validity::empty()
        }
    }

    pub(super) fn reset(self, cx: &mut Cx<'a>) {
        for option in self.options() {
            set_selected(cx, option, option.has_attr(atom!("selected")));
            set_dirty(option, false);
        }
        self.ask_for_reset(cx);
    }

    fn build(self, cx: &mut Cx<'a>) {
        let element = self.element;
        let root = element.attach_ua_shadow(cx);
        root.set_shadow_flags(ShadowFlags::OWN_SLOTTING, true);
        let button = div(cx, element, root, "-internal-select-button");
        let texts = div(cx, element, button, "-internal-select-texts");
        for name in ["-internal-select-label", "-internal-select-sizer"] {
            let part = div(cx, element, texts, name);
            text_in(cx, part, "");
        }
        part(
            cx,
            element,
            root,
            "-internal-select-button-slot",
            atom!("slot"),
        );
        let popover = div(cx, element, root, "picker(select)");
        let picker = div(cx, element, popover, "-internal-select-picker");
        let slot = element.doc().create_html(&cx.heap, atom!("slot"));
        insert(cx, slot, picker, None, Observers::Suppress);
        self.state().has_measured_labels.set(false);
        self.render(cx);
    }

    pub(super) fn render(self, cx: &mut Cx<'a>) {
        let (Some(popover), Some(button)) = (
            self.popover(),
            self.element
                .shadow_root()
                .and_then(|it| it.element_children().next()),
        ) else {
            return;
        };
        let rename = |part: &Element, name| {
            (!part.is_part(name)).then(|| part.set_pseudo(name, self.element))
        };
        rename(
            button,
            if self.author_button().is_some() {
                "-internal-select-replaced-button"
            } else {
                "-internal-select-button"
            },
        );
        if !self.is_drop_down() {
            self.set_open(cx, false);
        }
        rename(
            popover,
            if self.is_drop_down() {
                "picker(select)"
            } else {
                "-internal-select-list"
            },
        );
        let mut texts = button.descendants().filter(|it| it.is_text());
        let counts = self.is_multiple() && self.options().next().is_some();
        let count = counts
            .then(|| self.selected().count())
            .filter(|it| *it != 1)
            .map(|it| format!("{it} selected").as_str().into());
        let label = count
            .or_else(|| self.selected().next().map(option::label))
            .filter(|it| !it.is_empty());
        let shown = texts.next();
        shown.and_then(Node::parent_element).map(|it| {
            rename(
                it,
                if label.is_some() {
                    "-internal-select-label"
                } else {
                    "-internal-select-no-label"
                },
            )
        });
        set_text(cx, shown, &label.unwrap_or_else(|| "\u{200b}".into()));
        if self.state().has_measured_labels.replace(true) {
            return;
        }
        let mut all = StringBuilder::default();
        if counts {
            all.push_str(&format!("{} selected", self.options().count()));
        }
        for option in self.options() {
            all.push_str(if all.is_empty() { "" } else { "\n" });
            all.push(&option::label(option));
        }
        set_text(cx, texts.next(), &all.finish());
    }

    pub(super) fn selected_index(self) -> i32 {
        self.selected()
            .next()
            .and_then(|it| self.list().index_of(it))
            .map_or(-1, |it| it as i32)
    }

    fn option_at(self, index: i32) -> Option<&'a Element> {
        self.list().at(index.try_into().ok()?)
    }

    pub(super) fn set_selected_index(self, cx: &mut Cx<'a>, index: i32) {
        self.select_only(cx, self.option_at(index));
    }

    /// https://html.spec.whatwg.org/#dom-htmloptionscollection-add
    pub(super) fn add(
        self,
        cx: &mut Cx<'a>,
        added: OptionOrGroup<'a>,
        before: Option<ElementOrIndex<'a>>,
    ) -> bindgen::Result<'a, ()> {
        let added: &Element = match added {
            OptionOrGroup::Option(it) => it,
            OptionOrGroup::Group(it) => it,
        };
        let before = match before {
            Some(ElementOrIndex::Element(it)) => Some(&**it),
            Some(ElementOrIndex::Index(it)) => self.option_at(it),
            None => None,
        };
        if before.is_some_and(|it| it == self.element || !self.element.contains(it))
            && !added.contains(self.element)
        {
            return Err(dom_error(
                &cx.heap,
                DomError::NotFoundError,
                "The reference is not in the select element.",
            ));
        }
        if before == Some(added) {
            return Ok(());
        }
        pre_insert(
            cx,
            added,
            before.and_then(|it| it.parent()).unwrap_or(self.element),
            before.map(|it| &**it),
        )
    }

    pub(super) fn remove(self, cx: &mut Cx<'a>, index: i32) {
        if let Some(it) = self.option_at(index) {
            remove(cx, it, Observers::Notify);
        }
    }

    pub(super) fn set_length(self, cx: &mut Cx<'a>, length: u32) {
        const MAX_LENGTH: u32 = 100_000;
        let old = self.list().len();
        Refs::collect(&cx.heap, (length..old).filter_map(|it| self.list().at(it)))
            .iter()
            .for_each(|it| remove(cx, it, Observers::Notify));
        if old < length && length <= MAX_LENGTH {
            let (doc, heap) = (self.element.doc(), &cx.heap);
            let fragment = doc.create_fragment(heap);
            (old..length)
                .for_each(|_| append_detached(fragment, doc.create_html(heap, atom!("option"))));
            insert(cx, fragment, self.element, None, Observers::Notify);
        }
    }

    /// https://html.spec.whatwg.org/#dom-htmloptionscollection-setter
    pub(super) fn set_option(
        self,
        cx: &mut Cx<'a>,
        index: u32,
        new: Option<&'a Element>,
    ) -> bindgen::Result<'a, ()> {
        match (self.list().at(index), new) {
            (Some(old), Some(new)) => {
                return replace(cx, old, new, old.parent().unwrap_or(self.element));
            }
            (Some(old), None) => remove(cx, old, Observers::Notify),
            (None, Some(new)) => {
                self.set_length(cx, index);
                return append(cx, new, self.element);
            }
            (None, None) => {}
        }
        Ok(())
    }
}

pub(crate) fn is_base_list_box<'a>(cx: &mut Cx<'a>, select: &'a Element) -> bool {
    Select::new(select).is_base_list_box(cx)
}

pub(crate) fn is_focusable_option<'a>(cx: &mut Cx<'a>, option: &'a Element) -> bool {
    select_of(option).is_some_and(|it| !is_disabled(it.element) && it.has_base_options(cx))
}

/// Tab goes to one option of a list box.
pub(crate) fn is_skipped_option<'a>(cx: &mut Cx<'a>, option: &'a Element) -> bool {
    let Some(select) = is_option(option)
        .then(|| select_of(option))
        .flatten()
        .filter(|it| it.is_base_list_box(cx))
    else {
        return false;
    };
    let all = select.focusable_options(cx);
    let last = select
        .element
        .edge_node(Edge::LastFocusedOption)
        .and_then(Node::as_element);
    let mut preferred = focus::focused(option.doc())
        .into_iter()
        .chain(last)
        .chain(select.selected());
    preferred
        .find(|it| all.contains(it))
        .or_else(|| all.first().copied())
        != Some(option)
}

/// Whether `element` is a `select` or one of its options.
pub(crate) fn press<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    match element.html_tag() {
        atom!("select") => Select::new(element).set_open(cx, !Select::new(element).is_open()),
        atom!("option") if let Some(select) = option::select_of(element) => {
            select.pick(cx, element)
        }
        _ => return false,
    }
    true
}

pub(crate) fn set_being_emptied(select: &Element, on: bool) {
    Select::new(select).state().is_being_emptied.set(on);
}

/// `::picker(select)` only is a popover in the base appearance.
pub(crate) fn close_popover_of_native<'a>(cx: &mut Cx<'a>, ui: &'a Ui, element: &'a Element) {
    let select = Select::new(element);
    if select.is_open() && !select.has_base_options(cx) {
        select.set_open(cx, false);
    }
    if !select.is_open() {
        ui.set_select_with_popover(None);
    }
}

pub(crate) fn picker_popover(element: &Element) -> Option<&Element> {
    Select::of(element)?.popover()
}

pub(crate) fn author_button(select: &Element) -> Option<&Element> {
    Select::new(select).author_button()
}

impl HTMLSelectElement {
    fn select(&self) -> Select<'_> {
        Select::new(self)
    }

    pub(crate) fn get_type(&self) -> Known {
        if self.select().is_multiple() {
            atom!("select-multiple")
        } else {
            atom!("select-one")
        }
    }

    pub(crate) fn get_options(&self, _: &JsHeap<'_>) -> JSValue {
        self.select().list().to_js()
    }

    pub(crate) fn get_length(&self) -> u32 {
        self.select().list().len()
    }

    pub(crate) fn set_length<'a>(&'a self, cx: &mut Cx<'a>, length: u32) {
        self.select().set_length(cx, length);
    }

    pub(crate) fn item(&self, index: u32) -> Option<&Element> {
        self.select().list().at(index)
    }

    pub(crate) fn indexed_get<'a>(
        &'a self,
        _: &mut Cx<'a>,
        index: u32,
    ) -> bindgen::Result<'a, Option<&'a Element>> {
        Ok(self.item(index))
    }

    pub(crate) fn indexed_set<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        index: u32,
        option: Option<&'a HTMLOptionElement>,
    ) -> bindgen::Result<'a, ()> {
        self.select().set_option(cx, index, option.map(|it| &***it))
    }

    pub(crate) fn named_item(&self, name: &DomString) -> Option<&Element> {
        self.select()
            .list()
            .named(&Atom::from_string(name))
            .first()
            .copied()
    }

    pub(crate) fn add<'a>(
        &'a self,
        cx: &mut Cx<'a>,
        element: OptionOrGroup<'a>,
        before: Option<ElementOrIndex<'a>>,
    ) -> bindgen::Result<'a, ()> {
        self.select().add(cx, element, before)
    }

    pub(crate) fn remove_itself<'a>(&'a self, cx: &mut Cx<'a>) {
        if self.parent().is_some() {
            remove(cx, self, Observers::Notify);
        }
    }

    pub(crate) fn remove_option<'a>(&'a self, cx: &mut Cx<'a>, index: i32) {
        self.select().remove(cx, index);
    }

    pub(crate) fn get_selected_options<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        let selected = Filter::uncached(|it, add| {
            it.as_element()
                .into_iter()
                .flat_map(|it| Select::new(it).selected())
                .for_each(add)
        });
        self.same_object(heap, Edge::SelectedOptions, || {
            HTMLCollection::new(heap, self, selected).to_js()
        })
    }

    pub(crate) fn get_selected_index(&self) -> i32 {
        self.select().selected_index()
    }

    pub(crate) fn set_selected_index<'a>(&'a self, cx: &mut Cx<'a>, index: i32) {
        self.select().set_selected_index(cx, index);
    }

    pub(crate) fn get_value(&self) -> DomString {
        self.select()
            .selected()
            .next()
            .map(option::value)
            .unwrap_or_default()
    }

    pub(crate) fn set_value<'a>(&'a self, cx: &mut Cx<'a>, value: &DomString) {
        self.select().select_only(
            cx,
            self.select()
                .list()
                .elements()
                .find(|it| option::has_value(it, value)),
        );
    }

    pub(crate) fn show_picker<'a>(&'a self, cx: &mut Cx<'a>) -> bindgen::Result<'a, ()> {
        let allowed = require_picker(self, !is_disabled(self), false);
        refused(&cx.heap, allowed)?;
        if looks(cx, self, Looks::RENDERED | Looks::SKIPPED) != Looks::RENDERED {
            return Err(dom_error(
                &cx.heap,
                DomError::NotSupportedError,
                "The select element is not being rendered.",
            ));
        }
        Ui::of(self.doc()).map(|it| it.consume_activation(cx));
        if self.select().is_drop_down() {
            self.select().set_open(cx, true);
        }
        Ok(())
    }
}

pub(crate) static STEPS: Steps = Steps {
    ua_shadow: Some(|cx, element| Select::new(element).build(cx)),
    post_connection: Some(inserted),
    removed: Some(|cx, element, scope, is_move| {
        let select = Select::new(element);
        if !select.popover().is_some_and(popover::is_showing) {
            select.set_open(cx, false);
        } else if !is_move {
            element.set_state(cx, State::PICKER_OPEN, false);
        }
        removed(cx, element, scope, is_move);
    }),
    attribute_changed: Some(|cx, element, change| {
        attribute_changed(cx, element, change);
        let (select, is_multiple) = (Select::new(element), change.is(atom!("multiple")));
        if is_multiple || change.is(atom!("size")) {
            select.labels_changed(cx);
            if is_multiple && change.new.is_none() {
                select
                    .selected()
                    .skip(1)
                    .for_each(|it| set_selected(cx, it, false));
            }
            select.settle(cx);
            select.update_selected_content(cx, is_multiple);
        }
    }),
    children_changed: Some(|cx, element, _| Select::new(element).labels_changed(cx)),
    default_action: Some(|cx, element, event, origin| {
        Select::new(element).default_action(cx, event, origin)
    }),
    ..Steps::NONE
};
