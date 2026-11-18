//! `<input type=image>`, the `<image>` and `<use>` of SVG, and what style sheets ask for.

use bun_collections::HashMap;
use bun_jsc::Strong;

use super::*;
use crate::api::canvas::Source;
use crate::api::core::steps::Steps;
use crate::api::graphics::Failure;
use crate::api::svg::href;
use crate::generated_bindgen::svg::SVGImageElement;

#[derive(Default)]
struct Simple {
    current: RefCell<Option<Used>>,
    serial: Cell<u32>,
    is_queued: Cell<bool>,
    is_loading: Cell<bool>,
}

impl Simple {
    fn picture(&self) -> Option<Rc<Picture>> {
        self.current.borrow().as_ref().map(Used::picture)
    }

    fn is_showing(&self, picture: &Picture) -> bool {
        self.current
            .borrow()
            .as_ref()
            .is_some_and(|it| it.is(picture))
    }
}

/// `then` runs while the `load` event of the document waits.
#[optimize(size)]
pub(crate) fn delay_load_for<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    picture: &Picture,
    then: impl for<'b> FnOnce(Cx<'_, 'b>, &'b Element) + 'static,
) {
    delay_load_for_boxed(cx, element, picture, Box::new(then));
}

type Settled = dyn for<'b> FnOnce(Cx<'_, 'b>, &'b Element);

#[optimize(size)]
fn delay_load_for_boxed<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    picture: &Picture,
    then: Box<Settled>,
) {
    delay_load(cx, element.doc());
    let document = Strong::create(element.doc().to_js(), cx.global());
    picture.when_settled(cx, element.to_js(), move |cx, element| {
        if let Some(element) = element_in(&cx.heap, element) {
            then(cx, element);
        }
        Node::from_js(&cx.heap, document.get())
            .and_then(Node::as_doc)
            .into_iter()
            .for_each(|it| allow_load(cx, it));
    });
}

fn outcome(picture: &Picture) -> Known {
    if picture.contents().is_some() {
        atom!("load")
    } else {
        atom!("error")
    }
}

pub(crate) fn source_of_svg_image(
    image: &Element,
) -> core::result::Result<Option<Source>, Failure> {
    let Some(picture) = picture_of_svg_image(image).filter(|it| it.is_settled()) else {
        return Ok(None);
    };
    let contents = picture.contents().ok_or(Failure::invalid_state(
        "The image is in the 'broken' state.",
    ))?;
    Ok(Some(
        contents.source(image.doc(), natural_size(Some(contents), 1.0)),
    ))
}

pub(crate) fn picture_of_svg_image(image: &Element) -> Option<Rc<Picture>> {
    image.try_extra::<Simple>()?.picture()
}

#[optimize(size)]
fn update_svg_image<'a>(cx: Cx<'_, 'a>, image: &'a Element) {
    let (it, href) = (image.extra::<Simple>(), href(image));
    it.is_queued.set(false);
    if !image.doc().has_page() {
        return;
    }
    let url = href
        .as_ref()
        .filter(|it| !it.is_empty())
        .and_then(|it| resolve(cx, image.doc(), it));
    let used = url.map(|it| Pictures::request(cx, image.doc(), it, Some(image)));
    drop(it.current.replace(used));
    if let Some(picture) = it.picture() {
        let wanted = Rc::clone(&picture);
        delay_load_for(cx, image, &picture, move |cx, image| {
            if image.extra::<Simple>().is_showing(&wanted) {
                let kept = &image.doc().extra::<OfStyleSheets>().0;
                if let (Some(contents), Some(href)) = (wanted.contents(), href)
                    && image.is_rendered()
                    && !kept.borrow().iter().any(|it| it.is(&wanted))
                {
                    kept.borrow_mut().push(Used::new(Rc::clone(&wanted)));
                    image.engine(|engine, _| {
                        engine
                            .set_image(&engine.resolve_url(&href.to_utf8()), contents.replaced(1.0))
                    });
                    image.doc().invalidate(cx);
                }
                fire_later(cx, image, outcome(&wanted));
            }
        });
    } else if href.is_some() {
        fire_later(cx, image, atom!("error"));
    }
}

pub(crate) static SVG_IMAGE_STEPS: Steps = Steps {
    attribute_changed: Some(|cx, image, change| {
        if !matches!(
            change.name.local.known(),
            atom!("href") | atom!("crossorigin")
        ) {
            return;
        }
        let it = image.extra::<Simple>();
        it.serial.update(|it| it.wrapping_add(1));
        if !it.is_queued.replace(true) {
            later(&cx.heap, image, update_svg_image);
        }
    }),
    ..Steps::NONE
};

impl SVGImageElement {
    pub(crate) fn decode<'a>(&'a self, heap: &JsHeap<'a>) -> JSValue {
        let promise = heap.create_promise().to_js();
        heap.queue_microtask(
            heap.create_callback(
                wait_for_decoding,
                [self.to_js(), promise],
                self.extra::<Simple>().serial.get().into(),
            ),
            JSValue::UNDEFINED,
        );
        promise
    }
}

#[optimize(size)]
fn wait_for_decoding<'a>(
    cx: Cx<'_, 'a>,
    [image, promise]: [JsLocal<'a>; 2],
    serial: u64,
    _: &[JsLocal<'a>],
) -> Result<'a, JSValue> {
    let is_unchanged = move |it: &&Element| u64::from(it.extra::<Simple>().serial.get()) == serial;
    match element_in(&cx.heap, image.to_js())
        .filter(is_unchanged)
        .and_then(picture_of_svg_image)
    {
        Some(picture) => {
            let (wanted, promise) = (
                Rc::clone(&picture),
                Strong::create(promise.to_js(), cx.global()),
            );
            picture.when_settled(cx, image.to_js(), move |cx, image| {
                let is_current = element_in(&cx.heap, image).filter(is_unchanged).is_some();
                settle_decoding(cx, promise.get(), is_current && wanted.contents().is_some());
            });
        }
        None => settle_decoding(cx, promise.to_js(), false),
    }
    Ok(JSValue::UNDEFINED)
}

#[optimize(size)]
pub(crate) fn show_button_image<'a>(cx: Cx<'_, 'a>, input: &'a Element) {
    if let Some(it) = input.try_extra::<Simple>() {
        let blank = (it.is_queued.get() || it.is_loading.get())
            .then(|| crate::tree::Replaced::new(0, 0.0, 0.0, f64::NAN));
        show_replaced(
            cx,
            input,
            it.picture()
                .as_ref()
                .and_then(|it| it.contents())
                .map(|it| it.replaced(1.0))
                .or(blank),
        );
    }
}

#[optimize(size)]
pub(crate) fn update_button_image<'a>(cx: Cx<'_, 'a>, input: &'a Element) {
    if !input.doc().has_page() || input.extra::<Simple>().is_queued.replace(true) {
        return;
    }
    delay_load(cx, input.doc());
    input.set_edge(&cx.heap, Edge::DelayedDocument, input.doc().to_js());
    later(&cx.heap, input, |cx, input| {
        let (it, src) = (
            input.extra::<Simple>(),
            input.attr(atom!("src")).filter(|_| {
                input.with_attr_string(atom!("type"), |it| it.eq_ignore_ascii_case("image"))
                    == Some(true)
            }),
        );
        let serial = it.serial.get().wrapping_add(1);
        it.serial.set(serial);
        it.is_queued.set(false);
        let url = src
            .as_ref()
            .filter(|it| !it.is_empty())
            .and_then(|it| resolve(cx, input.doc(), it));
        it.is_loading.set(url.is_some());
        if let Some(used) = url.map(|it| Pictures::request(cx, input.doc(), it, Some(input))) {
            show_button_image(cx, input);
            delay_load_for(cx, input, &used.picture(), move |cx, input| {
                let (it, event) = (input.extra::<Simple>(), outcome(&used));
                if it.serial.get() == serial {
                    it.is_loading.set(false);
                    drop(it.current.replace(Some(used)));
                    show_button_image(cx, input);
                    fire_later(cx, input, event);
                }
            });
        } else {
            drop(it.current.take());
            show_button_image(cx, input);
            if src.is_some() {
                fire_later(cx, input, atom!("error"));
            }
        }
        input
            .edge_node(Edge::DelayedDocument)
            .and_then(Node::as_doc)
            .into_iter()
            .for_each(|it| allow_load(cx, it));
        input.clear_edge(&cx.heap, Edge::DelayedDocument);
    });
}

#[optimize(size)]
pub(crate) fn natural_size_of_button_image(input: &Element) -> [f64; 2] {
    natural_size(
        input
            .extra::<Simple>()
            .picture()
            .as_ref()
            .and_then(|it| it.contents()),
        1.0,
    )
}

/// They stay for as long as the document does.
#[derive(Default)]
struct OfStyleSheets(RefCell<Vec<Used>>);

#[optimize(size)]
pub(crate) fn load_for_style<'a>(cx: Cx<'_, 'a>, document: &'a Doc, url: &str) {
    let (used, url) = (
        Pictures::request(cx, document, DomString::from_utf8(url), None),
        Box::<str>::from(url),
    );
    let (picture, loaded) = (used.picture(), used.picture());
    document.extra::<OfStyleSheets>().0.borrow_mut().push(used);
    delay_load(cx, document);
    picture.when_settled(cx, document.to_js(), move |cx, document| {
        let Some(document) = Node::from_js(&cx.heap, document).and_then(Node::as_doc) else {
            return;
        };
        document.engine(|engine, _| {
            engine.set_image(
                &url,
                loaded
                    .contents()
                    .map(|it| it.replaced(1.0))
                    .unwrap_or_default(),
            )
        });
        crate::api::performance::note_new_images(&cx.heap, document);
        document.invalidate(cx);
        allow_load(cx, document);
    });
}

/// Whether each has loaded, or `None` while the edge of the document has the `<use>` elements that wait.
#[derive(Default)]
struct ExternalDocuments(RefCell<HashMap<Box<str>, Option<bool>>>);

#[optimize(size)]
pub(crate) fn load_external_svg<'a>(cx: Cx<'_, 'a>, document: &'a Doc, url: &str) -> Option<bool> {
    let all = &document.extra::<ExternalDocuments>().0;
    if let Some(state) = all.borrow().get(url) {
        return *state;
    }
    all.borrow_mut().insert(url.into(), None);
    delay_load(cx, document);
    let (owned, held) = (
        Box::<str>::from(url),
        Strong::create(document.to_js(), cx.global()),
    );
    fetch(
        cx,
        document,
        url,
        Destination::Image,
        None,
        move |cx, resource| {
            let Some(document) = Node::from_js(&cx.heap, held.get())
                .and_then(Node::as_doc)
                .filter(|it| it.has_page())
            else {
                return;
            };
            let is_xml = |mime: &[u8]| {
                bun_core::strings::split(mime, b";")
                    .next()
                    .is_some_and(|it| it.ends_with(b"/xml") || it.ends_with(b"+xml"))
            };
            let usable =
                resource.filter(|it| it.status < 300 && is_xml(&it.mime) && it.is_same_origin);
            document.engine(|engine, _| {
                engine.set_external(&owned, usable.as_ref().map_or(&[], |it| &it.bytes))
            });
            document
                .extra::<ExternalDocuments>()
                .0
                .borrow_mut()
                .insert(owned, Some(usable.is_some()));
            document.invalidate(cx);
            let waiting = document.try_edge_list(Edge::WaitingUses);
            document.clear_edge(&cx.heap, Edge::WaitingUses);
            waiting
                .into_iter()
                .flat_map(|it| it.nodes())
                .filter_map(Node::as_element)
                .for_each(|it| update_use(cx, it));
            allow_load(cx, document);
        },
    );
    None
}

#[optimize(size)]
fn update_use<'a>(cx: Cx<'_, 'a>, element: &'a Element) {
    let document = element.doc();
    let href = href(element).filter(|it| {
        !it.is_empty()
            && it.unit(0) != u16::from(b'#')
            && document.has_page()
            && element.is_connected()
    });
    let Some(url) = href.and_then(|it| resolve(cx, document, &it)) else {
        return;
    };
    let (url, own) = (url.to_utf8(), document.url());
    let url = before(&url, b'#');
    if url == before(&own.to_utf8(), b'#') {
        return;
    }
    match if url.starts_with("data:") {
        Some(false)
    } else {
        load_external_svg(cx, document, url)
    } {
        Some(is_loaded) => {
            let wanted = crate::api::svg::href(element);
            delay_load(cx, document);
            queue_task(
                document,
                &[element.to_js(), document.to_js()],
                move |cx, values| {
                    if let Some(element) = element_in(&cx.heap, values[0])
                        .filter(|it| crate::api::svg::href(it) == wanted)
                    {
                        fire(
                            cx,
                            element,
                            if is_loaded {
                                atom!("load")
                            } else {
                                atom!("error")
                            },
                            Default::default(),
                        );
                    }
                    Node::from_js(&cx.heap, values[1])
                        .and_then(Node::as_doc)
                        .into_iter()
                        .for_each(|it| allow_load(cx, it));
                    Ok(())
                },
            );
        }
        None => {
            let waiting = document.edge_list(&cx.heap, Edge::WaitingUses);
            if !waiting.contains(element.to_js()) {
                waiting.push(&cx.heap, element.to_js());
            }
        }
    }
}

pub(crate) static USE_STEPS: Steps = Steps {
    post_connection: Some(|cx, element, _| update_use(cx, element)),
    attribute_changed: Some(|cx, element, change| {
        if change.name.local.known() == atom!("href") {
            update_use(cx, element);
        }
    }),
    ..Steps::NONE
};
