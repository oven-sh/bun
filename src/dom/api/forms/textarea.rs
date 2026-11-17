//! https://html.spec.whatwg.org/#the-textarea-element

use super::validity::Validity;
use super::*;
use crate::api::ui::layout::{By, Caret, Direction};
use crate::generated_bindgen::forms::HTMLTextAreaElement;

pub(super) fn errors(element: &Element) -> Validity {
    let it = TextControl::of_textarea(element);
    if it.len() == 0 && element.has_attr(atom!("required")) && it.is_mutable() {
        Validity::VALUE_MISSING
    } else {
        it.length_errors(it.len())
    }
}

pub(super) fn reset<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    TextControl::of_textarea(element)
        .set_default(cx, normalize_newlines(&element.child_text_content()));
}

/// https://html.spec.whatwg.org/#textarea-wrapping-transformation
pub(super) fn submitted_value<'a>(cx: &mut Cx<'a>, element: &'a Element) -> DomString {
    let it = TextControl::of_textarea(element);
    let text = it.text();
    if !matches!(
        element.keyword(atom!("wrap")),
        Some(atom!("hard") | atom!("physical"))
    ) || !looks_like(cx, element, Looks::RENDERED)
    {
        return text;
    }
    let (Some(editor), Some(node)) = (it.editor(), it.editor_text()) else {
        return text;
    };
    let (mut out, mut at) = (StringBuilder::default(), 0);
    while at < text.len() {
        let from = Caret {
            point: Point { node, offset: at },
            is_upstream: false,
        };
        let end = layout::move_caret(
            cx,
            editor,
            from,
            Direction::Forward,
            By::LineBoundary,
            f32::NAN,
        );
        let next = end.map_or(text.len(), |it| {
            (it.point.offset + u32::from(!it.is_upstream)).max(at + 1)
        });
        out.push(&text.substring(at, next - at));
        if next < text.len() && text.unit(next - 1) != 10 {
            out.push_unit(10);
        }
        at = next;
    }
    out.finish()
}

impl HTMLTextAreaElement {
    pub(crate) fn get_type(&self) -> Known {
        atom!("textarea")
    }

    pub(crate) fn get_value(&self) -> DomString {
        TextControl::of_textarea(self).text()
    }

    pub(crate) fn set_value<'a>(&'a self, cx: &mut Cx<'a>, value: &DomString) {
        TextControl::of_textarea(self).set_from_script(cx, normalize_newlines(value));
    }

    pub(crate) fn get_default_value(&self) -> DomString {
        self.child_text_content()
    }

    pub(crate) fn set_default_value<'a>(&'a self, cx: &mut Cx<'a>, value: DomString) {
        string_replace_all(cx, value, self);
    }

    pub(crate) fn get_text_length(&self) -> u32 {
        TextControl::of_textarea(self).len()
    }
}

pub(crate) static STEPS: Steps = Steps {
    ua_shadow: Some(|cx, element| {
        let (it, root) = (
            TextControl::of_textarea(element),
            element.attach_ua_shadow(cx),
        );
        it.build_editor(cx, root);
        it.render(cx);
    }),
    post_connection: Some(inserted),
    removed: Some(text::removed),
    attribute_changed: Some(attribute_changed),
    children_changed: Some(|cx, element, _| {
        if !TextControl::of_textarea(element).state.is_dirty.get() {
            reset(cx, element);
        }
    }),
    cloned: Some(|_, from, to, _| {
        TextControl::of_textarea(from).copy_to(TextControl::of_textarea(to))
    }),
    ..Steps::NONE
};
