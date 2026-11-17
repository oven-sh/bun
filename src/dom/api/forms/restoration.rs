//! <https://html.spec.whatwg.org/#persisted-user-state>

use bun_core::strings;
use bun_web::host::StateOfControl;

use super::input_type::ValueMode;
use super::*;

/// Each with what tells it from the others when the document has been loaded again.
fn controls(doc: &Doc) -> impl Iterator<Item = (&Element, String)> {
    let is_off = |it: &Element| it.attr_is(atom!("autocomplete"), "off");
    let mut seen = bun_collections::HashMap::<String, u32>::default();
    let candidates = doc.elements_with_objects().filter(|it| {
        matches!(
            it.html_tag(),
            atom!("input") | atom!("select") | atom!("textarea")
        )
    });
    candidates
        .filter(move |it| !is_off(it) && !form_owner(it).is_some_and(is_off))
        .map(move |it| {
            let action = form_owner(it).map(|it| it.attr(atom!("action")).unwrap_or_default());
            let kind = input_type(it).map_or_else(|| it.html_tag(), InputType::name);
            let name = format!(
                "{:?} {} {}",
                action.as_ref().map(DomString::to_utf8),
                kind.as_str(),
                it.attr(atom!("name")).unwrap_or_default().to_utf8()
            );
            let count = seen.entry(name.clone()).or_default();
            *count += 1;
            (it, format!("{name} {count}"))
        })
}

fn state_of(element: &Element) -> Option<String> {
    if let Some(select) = Select::of(element) {
        let chosen = select
            .options()
            .enumerate()
            .filter(|it| option::is_selected(it.1));
        return select.options().any(option::is_dirty).then(|| {
            chosen
                .map(|it| it.0.to_string())
                .collect::<Vec<_>>()
                .join(" ")
        });
    }
    match Input::of(element) {
        Some(input) if input.kind().is_checkable() => {
            input.state.is_checked_dirty.get().then(|| {
                if input.is_checked() {
                    "1".into()
                } else {
                    String::new()
                }
            })
        }
        Some(input)
            if input.kind().value_mode() != ValueMode::Value
                || input.kind() == InputType::Password =>
        {
            None
        }
        _ => TextControl::of(element)
            .filter(|it| it.state.is_dirty.get())
            .map(|it| it.text().to_utf8().into_owned()),
    }
}

pub(crate) fn save(doc: &Doc) -> Vec<StateOfControl> {
    controls(doc)
        .filter_map(|(it, control)| {
            Some(StateOfControl {
                control,
                state: state_of(it)?,
            })
        })
        .collect()
}

pub(crate) fn restore<'a>(cx: &mut Cx<'a>, doc: &'a Doc, saved: &[StateOfControl]) {
    let mut states = bun_collections::HashMap::<&str, &str>::default();
    saved
        .iter()
        .for_each(|it| _ = states.insert(&it.control, &it.state));
    for (element, control) in controls(doc).filter(|it| state_of(it.0).is_none()) {
        let Some(&state) = states.get(&&*control) else {
            continue;
        };
        if let Some(select) = Select::of(element) {
            let chosen: Vec<usize> = strings::tokenize(state.as_bytes(), b" ")
                .filter_map(|it| crate::values::text(it).parse().ok())
                .collect();
            for (index, it) in select.options().enumerate() {
                option::set_selected(cx, it, chosen.contains(&index));
                option::set_dirty(it, true);
            }
            dirty(cx, element);
            select.update_selected_content(cx, true);
            continue;
        }
        match Input::of(element) {
            Some(input) if input.kind().is_checkable() => {
                input.state.is_checked_dirty.set(true);
                input.set_checked(cx, !state.is_empty());
            }
            Some(input) => input.set_value(cx, &DomString::from_utf8(state)),
            None => {
                TextControl::of_textarea(element).set_from_script(cx, DomString::from_utf8(state))
            }
        }
    }
}
