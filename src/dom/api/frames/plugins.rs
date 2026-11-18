//! `object` and `embed`

use super::*;
use crate::api::images::{
    Pictures, Used, delay_load_for, fire_later, is_supported_type, show_replaced,
};
use crate::api::ui::host::queue_task;

#[derive(Default)]
struct Plugin {
    picture: RefCell<Option<Used>>,
    serial: Cell<u32>,
    is_queued: Cell<bool>,
    was_rendered: Cell<bool>,
    /// Else there is the fallback content of an `object`, and nothing for an `embed`.
    has_content: Cell<bool>,
    /// An `embed` then has no box, which is no reason to try again.
    has_failed: Cell<bool>,
}

pub(super) fn is_plugin(element: &Element) -> bool {
    matches!(element.html_tag(), atom!("object") | atom!("embed"))
}

fn is_object(element: &Element) -> bool {
    element.is_html(atom!("object"))
}

fn type_of(element: &Element) -> String {
    let given = element
        .attr(atom!("type"))
        .unwrap_or_default()
        .to_utf8()
        .to_ascii_lowercase();
    let essence = bun_core::strings::index_of_char_usize(given.as_bytes(), b';')
        .map_or(&given[..], |it| &given[..it]);
    essence.trim().into()
}

fn is_type_of_document(it: &str) -> bool {
    matches!(
        it,
        "text/html"
            | "text/plain"
            | "text/xml"
            | "application/xml"
            | "application/xhtml+xml"
            | "image/svg+xml"
    )
}

fn names_content(element: &Element) -> bool {
    let has = |name: Known| element.attr(name).is_some_and(|it| !it.is_empty());
    !(is_object(element) && has(atom!("classid")))
        && (has(if is_object(element) {
            atom!("data")
        } else {
            atom!("src")
        }) || is_type_of_document(&type_of(element)))
}

fn is_rendered<'a>(cx: &mut Cx<'a>, element: &'a Element) -> bool {
    !looks(cx, element, Looks::RENDERED | Looks::SKIPPED).is_empty()
}

fn is_inactive(element: &Element) -> bool {
    let hides = |it: &Element| {
        matches!(it.html_tag(), atom!("audio") | atom!("video"))
            || is_object(it) && it.extra::<Plugin>().has_content.get()
    };
    element.ancestors().filter_map(Node::as_element).any(hides)
}

pub(super) fn show<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    let it = element.extra::<Plugin>();
    let picture = it
        .picture
        .borrow()
        .as_ref()
        .and_then(|it| Some(it.contents()?.replaced(1.0)));
    let [width, height] = DEFAULT_SIZE;
    let document = || {
        Frame::of(element).map_or_else(
            || Replaced::new(0, width, height, f64::NAN),
            Frame::replaced_for_plugin,
        )
    };
    show_replaced(
        cx,
        element,
        picture.or_else(|| it.has_content.get().then(document)),
    );
}

/// The root of a document gives its size to the `object` or `embed` that shows it.
pub(crate) static SVG_STEPS: Steps = Steps {
    attribute_changed: Some(|cx, svg, change| {
        let matters = [atom!("width"), atom!("height"), atom!("viewBox")]
            .into_iter()
            .any(|it| change.is(it))
            && svg.doc().document_element() == Some(svg);
        matters
            .then(|| super::container(svg.doc()))
            .flatten()
            .filter(|it| is_plugin(it))
            .into_iter()
            .for_each(|it| show(cx, it));
    }),
    ..Steps::NONE
};

fn set_has_content<'a>(cx: &mut Cx<'a>, element: &'a Element, has_content: bool) {
    let had_content = element.extra::<Plugin>().has_content.replace(has_content);
    show(cx, element);
    if had_content != has_content {
        Refs::collect(
            &cx.heap,
            element.elements_with_objects().filter(|it| is_plugin(it)),
        )
        .iter()
        .for_each(|it| queue_update(cx, it));
    }
}

fn empty<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    close(cx, element);
    let it = element.extra::<Plugin>();
    it.serial.update(|it| it.wrapping_add(1));
    drop(it.picture.take());
}

pub(super) fn fail<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    empty(cx, element);
    set_has_content(cx, element, false);
    element
        .extra::<Plugin>()
        .has_failed
        .set(!is_object(element));
    if is_object(element) {
        queue_task(cx, element.doc(), [element.to_js()], |cx, [element]| {
            _ = Element::from_value(element)
                .map(|it| fire(cx, it, atom!("error"), EventInit::default()))
        });
    }
}

pub(super) fn show_image<'a>(cx: &mut Cx<'a>, element: &'a Element, url: &DomString) {
    let doc = element.doc();
    delay_load(cx, doc);
    empty(cx, element);
    // Another directive than for images says whether it may be shown, so they do not share it.
    let request = DomString::concat(&[url, &"\0".into(), &element.local().to_dom_string()]);
    let (used, serial) = (
        Pictures::request(cx, doc, request, Some(element)),
        element.extra::<Plugin>().serial.get(),
    );
    delay_load_for(cx, element, &used.picture(), move |cx, element| {
        let it = element.extra::<Plugin>();
        if it.serial.get() != serial {
        } else if used.contents().is_none() {
            fail(cx, element);
        } else {
            it.picture.replace(Some(used));
            show(cx, element);
            fire_later(cx, element, atom!("load"));
        }
    });
    allow_load(cx, doc);
}

fn update<'a>(cx: &mut Cx<'a>, element: &'a Element, ui: &'a Ui) {
    let it = element.extra::<Plugin>();
    it.was_rendered.set(is_rendered(cx, element));
    if !it.was_rendered.get() || is_inactive(element) {
        return empty(cx, element);
    }
    let has_url = element
        .attr(if is_object(element) {
            atom!("data")
        } else {
            atom!("src")
        })
        .is_some_and(|it| !it.is_empty());
    if !has_url
        && !type_of(element).is_empty()
        && !crate::api::loading::allows_plugin_without_url(&cx.heap, element)
    {
        return fail(cx, element);
    }
    if !names_content(element) {
        return empty(cx, element);
    }
    let Some(url) = source_of(cx, element).filter(|it| !it.to_utf8().starts_with("javascript:"))
    else {
        return fail(cx, element);
    };
    let kind = type_of(element);
    if !kind.is_empty() && is_supported_type(&kind) && !is_type_of_document(&kind) {
        show_image(cx, element, &url);
    } else if !host::is_local(ui, &url) {
        fail(cx, element);
    } else if let Some(frame) = Frame::of(element).filter(|_| !is_object(element)) {
        frame.navigate(cx);
    } else {
        empty(cx, element);
        local::open(cx, ui, element);
    }
}

fn queue_update<'a>(cx: &mut Cx<'a>, element: &'a Element) {
    element.extra::<Plugin>().has_failed.set(false);
    set_has_content(cx, element, names_content(element));
    let doc = element.doc();
    if Ui::of(doc).is_none()
        || !element.is_connected()
        || element.extra::<Plugin>().is_queued.replace(true)
    {
        return;
    }
    delay_load(cx, doc);
    queue_task(
        cx,
        doc,
        [element.to_js(), doc.to_js()],
        |cx, [element, doc]| {
            let (Some(element), Some(doc)) = (Element::from_value(element), Doc::from_value(doc))
            else {
                return;
            };
            element.extra::<Plugin>().is_queued.set(false);
            if let Some(ui) = Ui::of(doc).filter(|_| element.is_connected() && element.doc() == doc)
            {
                update(cx, element, ui);
            }
            allow_load(cx, doc);
        },
    );
}

pub(crate) fn update_rendered<'a>(cx: &mut Cx<'a>, ui: &'a Ui) {
    for element in ui.plugins().iter() {
        let it = element.extra::<Plugin>();
        if !it.is_queued.get()
            && !it.has_failed.get()
            && it.was_rendered.get() != is_rendered(cx, element)
        {
            queue_update(cx, element);
        }
    }
}

pub(crate) static STEPS: Steps = Steps {
    rendered: Some(show),
    post_connection: Some(|cx, element, is_move| {
        if !is_move {
            Ui::of(element.doc())
                .into_iter()
                .for_each(|it| it.set_plugins(it.plugins().with(&cx.heap, element)));
            queue_update(cx, element);
        }
    }),
    removed: Some(|cx, element, _, is_move| {
        if !is_move {
            Ui::of(element.doc())
                .into_iter()
                .for_each(|it| it.set_plugins(it.plugins().without(&cx.heap, element)));
            empty(cx, element);
        }
    }),
    attribute_changed: Some(|cx, element, change| {
        if [atom!("src"), atom!("data"), atom!("type"), atom!("classid")]
            .into_iter()
            .any(|it| change.is(it))
        {
            queue_update(cx, element);
        }
    }),
    ..Steps::NONE
};
