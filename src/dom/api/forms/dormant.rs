//! Controls about which there is nothing to know but their attributes. They need no steps, and no object.
//!
//! None of them is in a `form`, a `fieldset`, a `datalist` or a `select`.

use super::input_type::ValueMode;
use super::*;
use crate::api::core::bare;
use crate::name::name;
use crate::selector::{Pseudo, filter, key};
use crate::tree::Tree;

/// All but what it inherits. `None` if it cannot be dormant. The attributes are in no namespace.
pub(crate) fn state_of<'t>(
    tag: Known,
    attributes: impl Iterator<Item = (&'t Atom, &'t DomString)>,
) -> Option<State> {
    use InputType::*;
    let (
        mut kind,
        mut value,
        mut is_checked,
        mut has_placeholder,
        mut is_disabled,
        mut is_read_only,
    ) = (Known::Other, None, false, false, false, false);
    for (name, text) in attributes {
        match name.known() {
            atom!("type") => {
                kind = text
                    .latin1()
                    .map_or(Known::Other, Known::from_latin1_lowercased)
            }
            atom!("value") => value = Some(text).filter(|it| !it.is_empty()),
            atom!("checked") => is_checked = true,
            atom!("placeholder") => has_placeholder = true,
            atom!("disabled") => is_disabled = true,
            atom!("readonly") => is_read_only = true,
            atom!("class")
            | atom!("id")
            | atom!("name")
            | atom!("style")
            | atom!("title")
            | atom!("role")
            | atom!("tabindex")
            | atom!("hidden")
            | atom!("size") => {}
            atom!("autocomplete")
            | atom!("maxlength")
            | atom!("minlength")
            | atom!("spellcheck")
            | atom!("inputmode") => {}
            known
                if known == Known::Other && !bare::needs_object(name)
                    || key::has_values(name.as_utf8().as_bytes()) => {}
            _ => return None,
        }
    }
    let mut state = if is_disabled {
        State::DISABLED
    } else {
        State::ENABLED
    };
    if tag == atom!("button") {
        state.set(
            State::VALID,
            !is_disabled && !matches!(kind, atom!("reset") | atom!("button")),
        );
        return Some(state);
    }
    let kind = InputType::from_keyword(kind);
    match kind {
        Text | Search | Password if !value.is_some_and(DomString::has_newline) => {}
        Email | Url | Number if value.is_none() => {}
        Checkbox | Hidden | Submit | Reset | Button => {}
        _ => return None,
    }
    state.set(
        State::CHECKED | State::DEFAULT,
        kind == Checkbox && is_checked,
    );
    state.set(
        State::PLACEHOLDER_SHOWN,
        has_placeholder && value.is_none() && kind.value_mode() == ValueMode::Value,
    );
    state.set(
        State::VALID,
        !(is_disabled || is_read_only || matches!(kind, Hidden | Reset | Button)),
    );
    state.set(
        State::READ_WRITE,
        kind.has_editor() && !is_disabled && !is_read_only,
    );
    Some(state | State::OPTIONAL)
}

#[inline]
fn keys() -> u64 {
    filter([key::tag(name!("input")), key::tag(name!("button"))].into_iter())
}

pub(crate) fn can_be_in(parent: &Node) -> bool {
    !parent.inclusive_ancestors().any(|it| {
        matches!(
            it.kind(),
            Kind::Form | Kind::FieldSet | Kind::DataList | Kind::Select
        )
    })
}

/// Whether those in `node` can stay so if it is inserted there.
#[inline]
pub(crate) fn can_stay(node: &Node, parent: &Node) -> bool {
    !node.arena().has_dormant_controls.get() || can_stay_if_any(node, parent)
}

fn can_stay_if_any(node: &Node, parent: &Node) -> bool {
    !(node.has(NodeFlags::DORMANT) || node.read(|tree, id| tree.may_have_below(id, keys())))
        || can_be_in(parent)
}

/// For those below `root`.
pub(crate) fn make_objects(root: &Node) -> impl Iterator<Item = &Node> {
    let find = |tree: &Tree, id| {
        tree.descendants_with(id, keys())
            .filter(|it| crate::name::is_name!(tree.html_tag(*it), "input" | "button"))
            .collect()
    };
    let found: Vec<_> = if root.arena().has_dormant_controls.get() {
        root.read(find)
    } else {
        Vec::new()
    };
    found.into_iter().filter_map(|it| root.node(it))
}

#[inline]
pub(crate) fn wake_unless_they_can_stay(node: &Node, parent: &Node) {
    if !can_stay(node, parent) {
        wake(node);
    }
}

#[cold]
fn wake(root: &Node) {
    core::iter::once(root)
        .chain(make_objects(root))
        .for_each(|it| it.unset(NodeFlags::DORMANT));
}

/// They have got objects. The engine may be busy.
pub(crate) fn note_parts(heap: &JsHeap<'_>, host: &Node, root: &Node, tree: &Tree) {
    for part in root.descendants() {
        match tree.element(part.id()) {
            Some(it) if it.pseudo == Pseudo::Part(name!("-internal-editor")) => {
                host.set_edge(heap, Edge::Editor, part.to_js())
            }
            None if part.parent() == Some(root) => host.set_edge(heap, Edge::Look, part.to_js()),
            _ => {}
        }
    }
}
