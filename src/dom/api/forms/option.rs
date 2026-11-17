//! `option`, `optgroup`, `selectedcontent` and `datalist`

use super::*;
use crate::generated_bindgen::forms::{HTMLDataListElement, HTMLOptionElement};

const IS_DIRTY: u16 = 1;
const HAS_LEGEND: u16 = 1;

pub(super) fn is_option(element: &Element) -> bool {
    element.is_html(atom!("option"))
}

pub(crate) fn is_selected(option: &Element) -> bool {
    option.state().contains(State::CHECKED)
}

pub(super) fn set_selected<'a>(cx: &mut Cx<'a>, option: &'a Element, is_selected: bool) {
    if self::is_selected(option) != is_selected {
        owner(option)
            .into_iter()
            .for_each(|it| Select::new(it).count(&cx.heap, option, is_selected));
        option.set_state(cx, State::CHECKED, is_selected);
    }
}

pub(super) fn is_dirty(option: &Element) -> bool {
    option.bits_of_kind().get() == IS_DIRTY
}

pub(super) fn set_dirty(option: &Element, is_dirty: bool) {
    option
        .bits_of_kind()
        .set(if is_dirty { IS_DIRTY } else { 0 });
}

fn text(option: &Element) -> DomString {
    if let Some(only) = option
        .first_child()
        .filter(|it| it.next_sibling().is_none())
        .and_then(Node::as_text)
        .map(|it| it.data())
        && only.latin1().is_some_and(|it| {
            bun_core::strings::split(it, b" ")
                .all(|it| !it.is_empty() && !it.iter().any(u8::is_ascii_whitespace))
        })
    {
        return only;
    }
    let (mut out, mut at, mut has_space) = (StringBuilder::default(), option.first_child(), false);
    while let Some(node) = at {
        for unit in node
            .as_text()
            .map(|it| it.data())
            .unwrap_or_default()
            .units()
        {
            if is_ascii_whitespace(unit) {
                has_space = !out.is_empty();
                continue;
            }
            if core::mem::take(&mut has_space) {
                out.push_unit(32);
            }
            out.push_unit(unit);
        }
        let is_script = matches!(node.kind(), Kind::Script | Kind::SvgScript);
        at = if is_script {
            node.following_skip(Some(option))
        } else {
            node.following(Some(option))
        };
    }
    out.finish()
}

pub(super) fn value(option: &Element) -> DomString {
    option.attr(atom!("value")).unwrap_or_else(|| text(option))
}

pub(super) fn has_value(option: &Element, value: &DomString) -> bool {
    option
        .with_attr_string(atom!("value"), |it| it == value)
        .unwrap_or_else(|| text(option) == *value)
}

pub(crate) fn label(option: &Element) -> DomString {
    option
        .attr(atom!("label"))
        .filter(|it| !it.is_empty())
        .unwrap_or_else(|| text(option))
}

pub(super) fn ends_list_of_options(tag: Known) -> bool {
    matches!(
        tag,
        atom!("datalist") | atom!("hr") | atom!("option") | atom!("selectedcontent")
    )
}

/// https://html.spec.whatwg.org/#option-element-nearest-ancestor-select
pub(super) fn select_of(element: &Element) -> Option<Select<'_>> {
    let mut is_in_group = element.is_html(atom!("optgroup"));
    for at in element.ancestors().map_while(Node::as_element) {
        match at.html_tag() {
            atom!("select") => return Some(Select::new(at)),
            atom!("optgroup") if !core::mem::replace(&mut is_in_group, true) => {}
            atom!("optgroup") => return None,
            tag if ends_list_of_options(tag) => return None,
            _ => {}
        }
    }
    None
}

pub(super) fn select_or_group_of(option: &Element) -> Option<&Element> {
    option
        .ancestors()
        .find(|it| matches!(it.html_tag(), atom!("select") | atom!("optgroup")))?
        .as_element()
}

/// https://html.spec.whatwg.org/#cached-nearest-ancestor-select-element
pub(super) fn owner(option: &Element) -> Option<&Element> {
    option.edge_node(Edge::OptionOwner)?.as_element()
}

fn update_contents_later<'a>(cx: &mut Cx<'a>, select: Select<'a>, always: bool) {
    if select.may_have_selected_content() {
        host::queue_microtask(
            cx,
            [select.element.value(), always.into()],
            |cx, [select, always]| {
                if let Some(it) = Element::from_value(select) {
                    Select::new(it).update_selected_content(cx, always.as_boolean());
                }
            },
        );
    }
}

pub(super) fn update_owner<'a>(cx: &mut Cx<'a>, option: &'a Element) {
    let (old, new) = (owner(option).map(Select::new), select_of(option));
    if old.map(|it| it.element) == new.map(|it| it.element) {
        return;
    }
    option.clear_edge(&cx.heap, Edge::OptionOwner);
    if let Some(old) = old {
        if is_selected(option) {
            old.count(&cx.heap, option, false);
        }
        old.labels_changed(cx);
        if is_selected(option) || old.is_drop_down() {
            if !old.state().is_being_emptied.get() {
                old.settle(cx);
            }
            update_contents_later(cx, old, false);
        }
    }
    let Some(new) = new else { return };
    if is_selected(option) && !new.is_multiple() {
        new.selected().for_each(|it| set_selected(cx, it, false));
    }
    option.set_edge(&cx.heap, Edge::OptionOwner, new.element.value());
    if is_selected(option) {
        new.count(&cx.heap, option, true);
    }
    new.labels_changed(cx);
    new.settle(cx);
}

fn show_label<'a>(cx: &mut Cx<'a>, option: &'a Element, label: Option<&DomString>) {
    let label = label.cloned().unwrap_or_default();
    if option.shadow_root().is_none() && !label.is_empty() {
        let root = option.attach_ua_shadow(cx);
        text_in(cx, root, "");
        let slot = option.doc().create_html(&cx.heap, atom!("slot"));
        insert(cx, slot, root, None, Observers::Suppress);
    }
    let Some(root) = option.shadow_root() else {
        return;
    };
    set_text(cx, root.first_child(), &label);
    if let Some(it) = root.last_child().and_then(Node::as_element) {
        it.toggle_attr(cx, atom!("hidden"), !label.is_empty());
    }
}

/// `new Option()`
impl HTMLOptionElement {
    pub(crate) fn new_option<'a>(
        cx: &mut Cx<'a>,
        _: JsLocal<'a, bun_jsc::JSObject>,
        text: DomString,
        value: Option<DomString>,
        is_default: bool,
        is_selected: bool,
    ) -> bindgen::Result<'a, JSValue> {
        let option = seams::current_document(cx)?.create_html(&cx.heap, atom!("option"));
        string_replace_all(cx, text, option);
        if let Some(value) = value {
            option.set_attr(cx, atom!("value"), value);
        }
        option.toggle_attr(cx, atom!("selected"), is_default);
        set_selected(cx, option, is_selected);
        Ok(option.to_js())
    }

    pub(crate) fn get_form(&self) -> Option<&Node> {
        let select = select_of(self)?.element;
        seen_from(select, form_owner(select))
    }

    pub(crate) fn get_label(&self) -> DomString {
        self.attr(atom!("label")).unwrap_or_else(|| text(self))
    }

    pub(crate) fn set_label<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("label"), value);
    }

    pub(crate) fn get_value(&self) -> DomString {
        value(self)
    }

    pub(crate) fn set_value<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        self.set_attr(cx, atom!("value"), value);
    }

    pub(crate) fn get_text(&self) -> DomString {
        text(self)
    }

    pub(crate) fn set_text<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        string_replace_all(cx, value, self);
    }

    pub(crate) fn get_selected(&self) -> bool {
        is_selected(self)
    }

    pub(crate) fn set_selected<'a>(&'a self, cx: &mut Cx<'a>, value: bool) {
        set_dirty(self, true);
        match select_of(self) {
            Some(select) if value && !select.is_multiple() => select.select_only(cx, Some(self)),
            select => {
                set_selected(cx, self, value);
                if let Some(it) = select {
                    it.ask_for_reset(cx);
                }
            }
        }
    }

    pub(crate) fn get_index(&self) -> i32 {
        select_of(self)
            .and_then(|it| it.list().index_of(self))
            .unwrap_or(0) as i32
    }
}

fn option_attribute_changed<'a>(cx: &mut Cx<'a>, option: &'a Element, change: &AttrChange<'_>) {
    let select = select_of(option);
    match change.known() {
        atom!("selected") => {
            option.set_state(cx, State::DEFAULT, change.new.is_some());
            if is_dirty(option) {
                return;
            }
            if let Some(select) = select.filter(|it| change.new.is_some() && !it.is_multiple()) {
                select.selected().for_each(|it| set_selected(cx, it, false));
            }
            set_selected(cx, option, change.new.is_some());
            if let Some(it) = select {
                it.ask_for_reset(cx);
            }
        }
        atom!("disabled") => _ = select.map(|it| it.ask_for_reset(cx)),
        name => {
            if name == atom!("label") {
                show_label(cx, option, change.new);
            }
            if let Some(it) = select {
                it.labels_changed(cx);
            }
        }
    }
}

pub(crate) static STEPS: Steps = Steps {
    cloned: Some(|cx, from, to, _| set_selected(cx, to, is_selected(from))),
    parent_changed: Some(|cx, option, _| update_owner(cx, option)),
    post_connection: Some(|cx, option, is_move| {
        update_owner(cx, option);
        match owner(option).map(Select::new) {
            Some(select) if is_move => update_contents_later(cx, select, false),
            Some(select) => select.update_selected_content(cx, false),
            None => {}
        }
    }),
    removed: Some(|cx, option, _, _| update_owner(cx, option)),
    finished_parsing: Some(|cx, option| {
        _ = owner(option)
            .filter(|_| is_selected(option))
            .map(|it| Select::new(it).update_selected_content(cx, true))
    }),
    attribute_changed: Some(option_attribute_changed),
    ..Steps::NONE
};

pub(crate) static GROUP_STEPS: Steps = Steps {
    children_changed: Some(|cx, group, _| {
        let has_legend = group
            .element_children()
            .next()
            .is_some_and(|it| it.is_html(atom!("legend")));
        if group
            .bits_of_kind()
            .replace(if has_legend { HAS_LEGEND } else { 0 })
            != group.bits_of_kind().get()
        {
            group.set_custom_state(cx, ":legend", has_legend);
        }
    }),
    parent_changed: Some(|cx, group, _| {
        group
            .elements_with_objects()
            .filter(|it| is_option(it))
            .for_each(|it| update_owner(cx, it))
    }),
    attribute_changed: Some(|cx, group, change| {
        _ = select_of(group)
            .filter(|_| change.is(atom!("disabled")))
            .map(|it| it.ask_for_reset(cx))
    }),
    ..Steps::NONE
};

/// The `select` whose choice a `selectedcontent` shows.
pub(super) fn select_shown_by(content: &Element) -> Option<Select<'_>> {
    let mut found = None;
    for at in content.ancestors().map_while(Node::as_element) {
        match at.html_tag() {
            atom!("select") if found.is_none() => found = Some(Select::new(at)),
            atom!("select") | atom!("option") | atom!("selectedcontent") => return None,
            _ => {}
        }
    }
    let mut around = core::iter::successors(content.parent_or_host(), |it| it.parent_or_host());
    found.filter(|_| {
        !around.any(|it| matches!(it.html_tag(), atom!("option") | atom!("selectedcontent")))
    })
}

pub(crate) static SELECTED_CONTENT_STEPS: Steps = Steps {
    created: Some(|_, _| select::note_selected_content()),
    post_connection: Some(|cx, content, is_move| match select_shown_by(content) {
        Some(select) if is_move => update_contents_later(cx, select, true),
        Some(select) => select.selected_content_inserted(cx, content),
        None => {}
    }),
    ..Steps::NONE
};

pub(crate) static DATALIST_STEPS: Steps = Steps {
    children_changed: Some(suggestions::options_changed),
    ..Steps::NONE
};

impl HTMLDataListElement {
    pub(crate) fn get_options<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        static OPTIONS: Test = Test {
            tags: &[atom!("option")],
            matches: is_option,
            ..Test::ALL
        };
        self.same_object(heap, Edge::Options, || {
            HTMLCollection::new(heap, self, Filter::descendants(&OPTIONS)).to_js()
        })
    }
}
