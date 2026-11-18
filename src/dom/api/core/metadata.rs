//! <https://html.spec.whatwg.org/#document-metadata>

use core::cell::{Cell, RefCell};

use bun_jsc::bindgen::JsScope;
use bun_web::origin::Origin;
use bun_web::url::Url;

use super::*;
use crate::api::cssom;

type Cx<'c, 'a> = &'c mut JsScope<'a>;

#[derive(Default)]
struct Told {
    title: RefCell<DomString>,
    is_setting_title: Cell<bool>,
    has_new_icons: Cell<bool>,
    has_color_scheme: Cell<bool>,
    has_theme_color: Cell<bool>,
    has_new_theme_color: Cell<bool>,
    sizes_container: Cell<bool>,
}

fn lowercase(element: &Element, attribute: Known) -> DomString {
    element
        .attr(attribute)
        .unwrap_or_default()
        .to_ascii_lowercase()
}

/// As one change.
pub(super) fn set_title<'a>(
    cx: &mut JsScope<'a>,
    doc: &'a Doc,
    element: &'a Element,
    title: DomString,
) {
    let is_setting_title = &doc.extra::<Told>().is_setting_title;
    is_setting_title.set(true);
    string_replace_all(cx, title, element);
    is_setting_title.set(false);
    title_changed(doc);
}

pub(super) fn title_changed(doc: &Doc) {
    let told = doc.extra::<Told>();
    let Some(window) = (!told.is_setting_title.get())
        .then(|| doc.window())
        .flatten()
    else {
        return;
    };
    let title = doc.title();
    if told.title.replace(title.clone()) != title {
        window.host().set_title(title.to_utf8().into_owned());
    }
}

/// Whether it is the first since `tell_icons`.
pub(crate) fn note_new_icon(doc: &Doc) -> bool {
    !doc.extra::<Told>().has_new_icons.replace(true)
}

pub(crate) fn tell_icons<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) {
    doc.extra::<Told>().has_new_icons.set(false);
    let Some(window) = doc.window() else { return };
    let is_icon = |it: &&Element| {
        it.is_html(atom!("link"))
            && it
                .attr(atom!("rel"))
                .is_some_and(|it| it.has_token(&"icon".into(), true))
    };
    let links: Vec<_> = doc
        .objects_with_tag(atom!("link"))
        .filter(is_icon)
        .map(|it| it.attr(atom!("href")).unwrap_or_default())
        .collect();
    window.host().icons_changed(
        links
            .iter()
            .filter_map(|it| Some(doc.parse_url(cx, it)?.into_href().to_utf8().into_owned()))
            .collect(),
    );
}

#[cold]
pub(super) fn update_color_scheme(doc: &Doc) {
    let set = |scheme: &str| doc.engine(|engine, _| engine.set_color_scheme(scheme.as_bytes()));
    let mut candidates = doc.objects_with_tag(atom!("meta")).filter(|it| {
        it.is_html(atom!("meta")) && lowercase(it, atom!("name")).eq_str("color-scheme")
    });
    let has = candidates.any(|it| set(&it.attr(atom!("content")).unwrap_or_default().to_utf8()));
    if !has {
        set("normal");
    }
    doc.extra::<Told>().has_color_scheme.set(has);
}

pub(crate) fn tell_theme_color(doc: &Doc) {
    let color = |it: &Element| {
        let media = it.attr(atom!("media")).unwrap_or_default();
        let content = it
            .attr(atom!("content"))
            .filter(|_| doc.engine(|engine, _| engine.match_media(media.to_utf8().as_bytes())))?;
        crate::bindings::parse_rgba(content.to_utf8().trim_ascii().as_bytes(), 0xff)
    };
    let is_candidate = |it: &&Element| {
        it.is_html(atom!("meta")) && lowercase(it, atom!("name")).eq_str("theme-color")
    };
    let found = doc.extra::<Told>().has_theme_color.get().then(|| {
        doc.objects_with_tag(atom!("meta"))
            .filter(is_candidate)
            .find_map(color)
    });
    doc.window()
        .into_iter()
        .for_each(|it| it.host().theme_color_changed(found.flatten()));
}

/// <https://drafts.csswg.org/css-sizing-4/#responsive-iframes>
fn allow_sizing(doc: &Doc, content: &str) -> Option<()> {
    let origins = content
        .strip_prefix("allow-origins=")
        .filter(|_| doc.body().is_none())?;
    let apart = || {
        Some(
            crate::api::window::Window::of(doc)?
                .environment()
                .container
                .as_ref()?
                .origin
                .clone(),
        )
    };
    let (embedder, own) = (
        crate::api::frames::container(doc)
            .map_or_else(apart, |it| it.doc().window()?.host().origin())?,
        Url::parse(doc.url().to_utf8().as_bytes())?,
    );
    let origins = origins
        .split_ascii_whitespace()
        .map(str::as_bytes)
        .collect();
    bun_web::csp::lists_origin(origins, &Origin::from_serialized(embedder.as_bytes()), &own)
        .then(|| doc.extra::<Told>().sizes_container.set(true))
}

/// Whether the frame that shows it may take its size.
pub(crate) fn sizes_container(doc: &Doc) -> bool {
    doc.try_extra::<Told>()
        .is_some_and(|it| it.sizes_container.get())
}

pub(super) fn meta_changed<'a>(cx: Cx<'_, 'a>, meta: &'a Element) {
    let doc = meta.doc();
    let Some(window) = doc.window() else { return };
    let name = lowercase(meta, atom!("name"));
    if name.eq_str("color-scheme") || doc.extra::<Told>().has_color_scheme.get() {
        doc.arena().has_new_color_scheme.set(true);
        doc.set_needs_sync();
        doc.invalidate(cx);
    }
    if name.eq_str("theme-color") || doc.extra::<Told>().has_theme_color.get() {
        doc.extra::<Told>().has_theme_color.set(true);
        if !doc.extra::<Told>().has_new_theme_color.replace(true) {
            crate::api::loading::queue_task(doc, [], |_, doc, []| {
                doc.extra::<Told>().has_new_theme_color.set(false);
                tell_theme_color(doc);
            });
        }
    }
    let Some(content) = meta.attr(atom!("content")).filter(|_| meta.is_connected()) else {
        return;
    };
    match &*name.to_utf8() {
        "responsive-embedded-sizing" => _ = allow_sizing(doc, &content.to_utf8()),
        "referrer" => {
            let value = content.to_ascii_lowercase();
            let value = value.to_utf8();
            let policy = match &*value {
                "never" => "no-referrer",
                "always" => "unsafe-url",
                "default" => "strict-origin-when-cross-origin",
                "origin-when-crossorigin" => "origin-when-cross-origin",
                it => it,
            };
            window.host().set_referrer_policy(policy.into());
        }
        _ => {}
    }
    match &*lowercase(meta, atom!("http-equiv")).to_utf8() {
        "content-security-policy" if meta.parent().is_some_and(|it| it.is_html(atom!("head"))) => {
            crate::api::window::Window::of(doc)
                .into_iter()
                .for_each(|it| it.add_security_policy(cx, &content))
        }
        "default-style" => cssom::prefer_sheets_titled(cx, doc, content, true),
        "content-language" if !content.units().any(|it| it == u16::from(b',')) => {
            if let Some(language) = content.tokens().next() {
                doc.engine(|engine, _| engine.set_language(language.to_utf8().as_bytes()));
                doc.invalidate(cx);
            }
        }
        "refresh" => crate::api::history::refresh_by_meta(cx, doc, &content),
        _ => {}
    }
}
