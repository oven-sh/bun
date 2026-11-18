//! <https://html.spec.whatwg.org/#the-origin-interface>

use bun_web::origin::{Origin, is_same_site};
use bun_web::url::Url;

use super::*;
use crate::api::messaging::{MessageEvent, sender_of};

unsafe extern "C" {
    safe fn Bun__DOM__hrefOfURLObject(value: JSValue) -> Option<DomString>;
}

/// The serialization. For one that is opaque: "null", a space, and what tells it from the others.
#[repr(C)]
pub(crate) struct DomOrigin(Box<[u8]>);

impl From<Origin> for DomOrigin {
    fn from(origin: Origin) -> DomOrigin {
        DomOrigin(match origin {
            Origin::Opaque(id) => format!("null #{id}").into_bytes().into(),
            Origin::Tuple(it) => it,
        })
    }
}

fn of_url(url: &DomString) -> Option<DomOrigin> {
    Some(Origin::of(&Url::parse(url.to_utf8().as_bytes())?).into())
}

fn of_client(client: &Client) -> DomOrigin {
    let origin = client.origin();
    if origin.is_opaque() {
        DomOrigin([b"null ", &*client.token].concat().into())
    } else {
        origin.into()
    }
}

fn of_link<'a>(cx: Cx<'_, 'a>, link: &'a Element) -> Option<DomOrigin> {
    let href = match link.kind() {
        Kind::Anchor | Kind::Area => link.attr(atom!("href")),
        Kind::SvgA => crate::api::svg::href(link),
        _ => None,
    };
    of_url(&link.doc().parse_url(cx, &href?)?.into_href())
}

fn of_value<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, Option<DomOrigin>> {
    if let Some(url) = value.as_string() {
        return Ok(of_url(&DomString::from_js_string(&cx.heap, url)?));
    }
    let value = value.to_js();
    if !value.is_object() {
        return Ok(None);
    }
    if let Some(origin) = DomOrigin::from_js(&cx.heap, value) {
        return Ok(Some(DomOrigin(origin.0.clone())));
    }
    if let Some(url) = Bun__DOM__hrefOfURLObject(value) {
        return Ok(of_url(&url));
    }
    if let Some(link) = Element::from_js(&cx.heap, value) {
        return Ok(of_link(cx, link));
    }
    if let Some(global) = WindowTarget::of(&cx.heap, value) {
        return Ok(realm_of(global.realm(&cx.heap))
            .client()
            .map(|it| of_client(&it)));
    }
    Ok(MessageEvent::from_js(&cx.heap, value)
        .and_then(sender_of)
        .map(|it| DomOrigin(it.to_utf8().as_bytes().into())))
}

impl DomOrigin {
    pub(crate) fn constructor() -> DomOrigin {
        Origin::new_opaque().into()
    }

    pub(crate) fn of<'a>(cx: Cx<'_, 'a>, value: JsLocal<'a>) -> Result<'a, &'a DomOrigin> {
        match of_value(cx, value)? {
            Some(origin) => Ok(js_DomOrigin::create(&cx.heap, origin)),
            None => Err(cx
                .heap
                .type_error(format_args!("The provided value has no origin."))),
        }
    }

    pub(crate) fn get_opaque(&self) -> bool {
        self.0.starts_with(b"null ")
    }

    pub(crate) fn is_same_origin(&self, other: &DomOrigin) -> bool {
        self.0 == other.0
    }

    pub(crate) fn is_same_site(&self, other: &DomOrigin) -> bool {
        self.0 == other.0
            || Url::parse(&self.0)
                .zip(Url::parse(&other.0))
                .is_some_and(|(a, b)| is_same_site(&a, &b))
    }
}
