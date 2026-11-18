//! What images ask of the page.

use bun_web::net::body::SharedBytes;
use bun_web::origin::Origin;
use bun_web::url::Url;

use super::*;
use crate::api::loading::{load_subresource, when_loaded};
use crate::api::media::controls::add_part;
use crate::tree::Replaced;

pub(crate) use bun_web::request::Destination;

pub(crate) struct Resource {
    pub(crate) requested: Vec<u8>,
    pub(crate) bytes: SharedBytes,
    pub(crate) mime: Vec<u8>,
    pub(crate) status: u16,
    pub(crate) is_readable: bool,
    pub(crate) is_same_origin: bool,
}

/// What a style sheet says about the request follows the URL, after null characters.
#[optimize(size)]
pub(crate) fn fetch<'a>(
    cx: Cx<'_, 'a>,
    document: &'a Doc,
    request: &str,
    destination: Destination,
    element: Option<&'a Element>,
    steps: impl for<'b> FnOnce(Cx<'_, 'b>, Option<Resource>) + 'static,
) {
    fetch_boxed(cx, document, request, destination, element, Box::new(steps));
}

type Fetched = dyn for<'b> FnOnce(Cx<'_, 'b>, Option<Resource>);

#[optimize(size)]
fn fetch_boxed<'a>(
    cx: Cx<'_, 'a>,
    document: &'a Doc,
    request: &str,
    destination: Destination,
    element: Option<&'a Element>,
    steps: Box<Fetched>,
) {
    let requested = before(request, 0).as_bytes().to_vec();
    let loading = load_subresource(cx, document, request.as_bytes(), destination, element);
    when_loaded(
        document,
        JSValue::UNDEFINED,
        loading,
        move |cx, document, _, loaded| {
            let resource = loaded.filter(|_| document.is_fully_active()).map(|it| {
                let is_same_origin = matches!(it.url.scheme(), b"data" | b"blob")
                    || Url::parse(document.url().to_utf8().as_bytes()).is_some_and(|own| {
                        Origin::of(&own).as_bytes() == Origin::of(&it.url).as_bytes()
                    });
                Resource {
                    requested,
                    mime: it.essence().to_vec(),
                    bytes: it.bytes,
                    status: it.status,
                    is_readable: it.is_readable,
                    is_same_origin,
                }
            });
            steps(cx, resource);
        },
    );
}

pub(crate) fn scale<'a>(cx: Cx<'_, 'a>, document: &'a Doc) -> f64 {
    document.synced_engine(cx, |engine, _| engine.environment.scale.into())
}

pub(super) fn referrer_policy(attribute: Option<&DomString>) -> Option<usize> {
    const POLICIES: [&str; 8] = [
        "no-referrer",
        "no-referrer-when-downgrade",
        "same-origin",
        "origin",
        "strict-origin",
        "origin-when-cross-origin",
        "strict-origin-when-cross-origin",
        "unsafe-url",
    ];
    POLICIES
        .iter()
        .position(|it| attribute.is_some_and(|attribute| attribute.eq_ignore_ascii_case(it)))
}

#[optimize(size)]
pub(crate) fn matches_media(element: &Element) -> bool {
    let document = element.doc();
    !document.has_page()
        || element.with_attr(atom!("media"), |it| {
            document.engine(|engine, _| engine.match_media(it.as_bytes()))
        }) != Some(false)
}

/// https://html.spec.whatwg.org/#being-rendered
pub(crate) fn is_being_rendered<'a>(cx: Cx<'_, 'a>, element: &'a Element) -> bool {
    element.is_rendered()
        && element.synced_engine(cx, |engine, id| engine.updated_style_bits(id, 1) != 0)
}

/// Returns the parent for the text.
#[optimize(size)]
pub(crate) fn add_alt_text<'a>(cx: Cx<'_, 'a>, host: &'a Element, root: &'a Node) -> &'a Element {
    let text = add_part(cx, host, root, atom!("span"), "-internal-alt-text");
    add_part(cx, host, text, atom!("span"), "-internal-alt-icon");
    text
}

pub(crate) fn show_replaced<'a>(cx: Cx<'_, 'a>, element: &'a Element, replaced: Option<Replaced>) {
    if element.is_rendered() {
        element.engine(|engine, id| engine.set_own_replaced(id, replaced));
        element.doc().invalidate(cx);
    }
}

#[optimize(size)]
pub(crate) fn fire_later<'a>(cx: Cx<'_, 'a>, element: &'a Element, event: Known) {
    delay_load(cx, element.doc());
    queue_task(
        element.doc(),
        &[element.to_js(), element.doc().to_js()],
        move |cx, values| {
            if let [Some(element), Some(document)] =
                [values[0], values[1]].map(|it| Node::from_js(&cx.heap, it))
            {
                fire(cx, element, event, Default::default());
                document
                    .as_doc()
                    .into_iter()
                    .for_each(|it| allow_load(cx, it));
            }
            Ok(())
        },
    );
}

/// https://html.spec.whatwg.org/#will-lazy-load-element-steps
#[optimize(size)]
pub(crate) fn is_lazy(element: &Element) -> bool {
    element.with_attr_string(atom!("loading"), |it| it.eq_ignore_ascii_case("lazy")) == Some(true)
        && element.doc().runs_scripts()
}
