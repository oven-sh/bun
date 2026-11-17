//! What the tree asks of the page that shows a document.

use core::cell::RefCell;
use std::rc::Rc;

use bun_jsc::JSValue;
use bun_jsc::bindgen::{self, JsHeap, JsScope};
use bun_web::client::Client;
use bun_web::encoding::Encoding;
use bun_web::origin::is_same_site;
use bun_web::url::Url;

use super::*;
use crate::api::events::WindowTarget;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;

pub(super) fn style_attribute_changed<'a>(
    cx: Cx<'_, 'a>,
    element: &'a Element,
    value: Option<&DomString>,
) {
    let is_refused =
        value.is_some_and(|it| !crate::api::loading::allows_style_attribute(&cx.heap, element, it));
    element.engine(|engine, id| engine.refuse_inline_style(id, is_refused));
}

/// For what was parsed in a document without a window, where nothing is refused. `by` has one.
pub(crate) fn check_style_attribute<'a>(cx: Cx<'_, 'a>, element: &'a Element, by: &'a Doc) {
    if let Some(value) = element
        .attr(atom!("style"))
        .filter(|_| !element.engine(|engine, id| engine.has_edited_style(id)))
    {
        let is_refused =
            !crate::api::loading::document_allows_style_attribute(&cx.heap, by, element, &value);
        element.engine(|engine, id| engine.refuse_inline_style(id, is_refused));
    }
}

pub(super) fn allows_base<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, url: &DomString) -> bool {
    let check = |(client, url): (Rc<Client>, Url)| {
        let verdict = client.policies().csp.check_base(&url);
        client.enforce(verdict, JSValue::UNDEFINED)
    };
    !doc.is(DocFlags::HAS_PAGE)
        || doc
            .client(&cx.heap)
            .zip(Url::parse(url.to_utf8().as_bytes()))
            .is_none_or(check)
}

pub(super) fn has_policy_from_header<'a>(cx: Cx<'_, 'a>, doc: &'a Doc) -> bool {
    doc.is(DocFlags::HAS_PAGE)
        && doc
            .client(&cx.heap)
            .is_some_and(|it| it.policies().csp.is_from_header())
}

pub(crate) fn encoding_of(doc: &Doc) -> Encoding {
    doc.legacy_encoding()
        .and_then(|it| Encoding::for_label(it.to_utf8().as_bytes()))
        .unwrap_or_default()
}

pub(super) fn parse_url_in_legacy_encoding(doc: &Doc, url: &DomString) -> Option<DomString> {
    let parsed = encoding_of(doc).parse_url(
        &url.to_utf8(),
        &Url::parse(doc.base_url().to_utf8().as_bytes())?,
    )?;
    Some(DomString::from_latin1(parsed.href()))
}

pub(super) fn domain(doc: &Doc) -> Vec<u8> {
    let origin = doc
        .window()
        .or_else(|| WindowTarget::of_realm(JsHeap::from_global(doc.global())))
        .and_then(|it| it.host().origin());
    Url::parse(
        origin
            .unwrap_or_else(|| doc.url().to_utf8().into_owned())
            .as_bytes(),
    )
    .map(|it| it.hostname().to_vec())
    .unwrap_or_default()
}

/// Agent clusters are by origin, so it has no effect.
pub(super) fn set_domain<'a>(cx: Cx<'_, 'a>, doc: &'a Doc, value: &[u8]) -> Result<'a> {
    let as_url = |host: &[u8]| Url::parse(&[b"http://", host].concat());
    let (domain, is_host) = (
        domain(doc),
        value.ends_with(b"]") || !value.iter().any(|it| b"/:@?#\\".contains(it)),
    );
    let is_suffix = |wanted: Url| {
        let is_above = domain
            .strip_suffix(wanted.hostname())
            .is_some_and(|it| it.ends_with(b"."));
        wanted.hostname() == domain
            || (is_above && as_url(&domain).is_some_and(|it| is_same_site(&wanted, &it)))
    };
    let is_allowed = doc
        .window()
        .is_some_and(|it| !it.host().is_sandboxed("allow-document-domain".into()));
    if is_allowed && is_host && !domain.is_empty() && as_url(value).is_some_and(is_suffix) {
        return Ok(());
    }
    Err(dom_error(
        &cx.heap,
        DomError::SecurityError,
        &format!(
            "'{}' is not a suffix of '{}'.",
            bstr::BStr::new(value),
            bstr::BStr::new(&domain)
        ),
    ))
}

pub(super) fn referrer<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> DomString {
    doc.own_client(heap)
        .map(|it| DomString::from_latin1(&it.referrer()))
        .unwrap_or_default()
}

/// With the version of the jar and the URL that they are for.
#[derive(Default)]
struct Cookies(RefCell<Option<(u32, Url, DomString)>>);

fn client_for_cookies<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> Result<'a, Option<Rc<Client>>> {
    match doc.own_client(heap).filter(|_| doc.is_fully_active()) {
        Some(client) if client.origin().is_opaque() => Err(dom_error(
            heap,
            DomError::SecurityError,
            "Cookies are disabled in this document.",
        )),
        client => Ok(client),
    }
}

pub(super) fn cookie<'a>(heap: &JsHeap<'a>, doc: &'a Doc) -> Result<'a, DomString> {
    let Some(client) = client_for_cookies(heap, doc)? else {
        return Ok(DomString::default());
    };
    let (version, url, mut known) = (
        client.cookie_version(),
        client.url(),
        doc.extra::<Cookies>().0.borrow_mut(),
    );
    known.take_if(|it| it.0 != version || it.1.href() != url.href());
    Ok(known
        .get_or_insert_with(|| {
            (
                version,
                url,
                DomString::from_utf8(&bstr::ByteSlice::to_str_lossy(&*client.cookie_string())),
            )
        })
        .2
        .clone())
}

pub(super) fn set_cookie<'a>(heap: &JsHeap<'a>, doc: &'a Doc, value: &[u8]) -> Result<'a> {
    client_for_cookies(heap, doc)?.map(|it| it.set_cookie(value));
    Ok(())
}
