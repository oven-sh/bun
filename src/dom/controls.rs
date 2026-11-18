//! The parts of text fields and of buttons that are `input`s. They are made when the control is displayed, and go with its style
//! unless they have got objects by then.

use crate::api::core::{DomString, StoredText, atom};
use crate::document::Document;
use crate::name::{Name, is_name, name};
use crate::selector::{Pseudo, filter, key};
use crate::tree::{Data, Element, Flags, Namespace, NodeId, State};

impl Element {
    fn stored(&self, name: Name) -> Option<&StoredText> {
        self.attributes
            .iter()
            .find(|it| it.name == name)
            .map(|it| &it.value)
    }

    /// Without what it inherits and what the user does to it, for an element that is dormant if it is a control.
    #[inline]
    pub(crate) fn state_if_dormant(&self) -> Option<State> {
        const OWN: State = (State::CHECKED
            .union(State::DEFAULT)
            .union(State::VALID)
            .union(State::PLACEHOLDER_SHOWN))
        .union(State::ENABLED.union(State::DISABLED).union(State::OPTIONAL));
        (self.state.intersects(State::ENABLED | State::DISABLED)).then(|| {
            self.state
                & if self.tag == name!("input") {
                    OWN | State::READ_WRITE
                } else {
                    OWN
                }
        })
    }

    /// Of a text field that has no parts.
    pub(crate) fn text_to_show(&self) -> StoredText {
        self.edited_text
            .as_ref()
            .or_else(|| self.stored(name!("value")))
            .cloned()
            .unwrap_or_default()
    }
}

impl Document {
    /// Whether it has got any. They have yet to be styled.
    #[inline(never)]
    pub(crate) fn provide_parts(&mut self, host: NodeId) -> bool {
        let lacks_them = |it: &Element| {
            it.shadow_root == 0
                && it.namespace == Namespace::Html
                && (it.is_text_field() || is_name!(it.input_type(), "button" | "submit" | "reset"))
        };
        if !self.tree.element(host).is_some_and(lacks_them) {
            return false;
        }
        let was_as_found = self.tree.is_as_found();
        let root = self.tree.create_bare(
            Data::ShadowRoot {
                host,
                user_agent: true,
            },
            0,
        );
        self.tree[root].scope = root;
        self.tree
            .element_mut(host)
            .into_iter()
            .for_each(|it| it.rare_mut().shadow_root = root);
        self.tree[host].set(Flags::REDIRECTS_CHILDREN);
        self.make_parts(host, root);
        self.tree.keep_found(was_as_found);
        self.marks.are_stale = true;
        true
    }

    /// In a shadow root that is empty.
    pub(crate) fn make_parts(&mut self, host: NodeId, root: NodeId) {
        let Some(element) = self.tree.element(host) else {
            return;
        };
        let kind = element.input_type();
        if !element.is_text_field() {
            let label = if kind == name!("submit") {
                "Submit"
            } else if kind == name!("reset") {
                "Reset"
            } else {
                ""
            };
            let label = element
                .stored(name!("value"))
                .cloned()
                .unwrap_or_else(|| label.into());
            self.tree.append_bare(root, Data::Text(label), 0);
            return;
        }
        let in_one_line = |it: &StoredText| {
            if it.string().has_newline() {
                crate::api::forms::without_newlines(it.string()).into()
            } else {
                it.clone()
            }
        };
        let (text, placeholder) = (
            element.text_to_show(),
            element.stored(name!("placeholder")).map(in_one_line),
        );
        let has_suggestions = element.has(name!("list")) && kind != name!("password");
        let container = self.make_part(host, root, name!("-webkit-textfield-decoration-container"));
        let inner = self.make_part(host, container, name!("-internal-editor-container"));
        for (name, text) in [
            (name!("placeholder"), placeholder),
            (name!("-internal-editor"), Some(text)),
        ] {
            if let Some(text) = text {
                let part = self.make_part(host, inner, name);
                self.tree.append_bare(part, Data::Text(text), 0);
            }
        }
        for (name, is_wanted) in [
            (
                name!("-webkit-search-cancel-button"),
                kind == name!("search"),
            ),
            (name!("-webkit-inner-spin-button"), kind == name!("number")),
            (name!("-webkit-calendar-picker-indicator"), has_suggestions),
        ] {
            if is_wanted {
                self.make_part(host, container, name);
            }
        }
    }

    /// For a control that may have its style.
    pub(crate) fn parts_made(&mut self, root: NodeId) {
        if self.tree.is_rendered(root) {
            self.children_replaced(root);
            self.start_rendering(self.tree[root].first_child);
        }
    }

    fn make_part(&mut self, host: NodeId, parent: NodeId, name: Name) -> NodeId {
        let part = self.tree.new_element(name!("div"), Namespace::Html, |it| {
            it.local = atom!("div").into();
            it.set_pseudo(Pseudo::Part(name), host);
        });
        self.tree.sequence.shape_changed(parent);
        let part = self.tree.append_bare(
            parent,
            Data::Element(part),
            filter(core::iter::once(key::tag(name!("div")))),
        );
        self.prepare(part, true);
        self.derive_state(part, true);
        part
    }

    /// The root of those that have no objects, which the caller frees.
    pub(crate) fn take_parts(&mut self, host: NodeId) -> Option<NodeId> {
        let root = self
            .tree
            .element(host)
            .map(|it| it.shadow_root)
            .filter(|it| *it != 0 && self.tree.is_bare(*it))?;
        self.tree.element_mut(host)?.rare_mut().shadow_root = 0;
        self.tree[host].unset(Flags::REDIRECTS_CHILDREN);
        Some(root)
    }

    pub(crate) fn set_text_to_show(&mut self, host: NodeId, text: &DomString) {
        if self.tree.element(host).is_some_and(|it| {
            it.edited_text
                .as_ref()
                .or_else(|| it.stored(name!("value")))
                .map_or(!text.is_empty(), |it| it.string() != text)
        }) {
            self.tree
                .element_mut(host)
                .into_iter()
                .for_each(|it| it.rare_mut().edited_text = Some(text.clone().into()));
            self.accessibility
                .iter_mut()
                .for_each(|it| it.contents_changed(host));
        }
    }
}
