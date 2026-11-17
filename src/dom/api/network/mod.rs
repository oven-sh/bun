//! What scripts load with.

mod body;
pub(crate) mod bridge;
mod cache;
mod event_source;
mod fetch;
mod form_data;
mod headers;
mod request;
mod response;
mod web_socket;
mod xhr;

use core::cell::{Cell, RefCell};
use std::rc::Rc;

use bun_jsc::bindgen::{self, ClassStructure, Error, JsHeap, JsInterface, JsLocal, JsScope};
use bun_jsc::{JSObject, JSString, JSValue};
use bun_web::encoding::Encoding;
use bun_web::headers::HeaderList;
use bun_web::url::Url;

pub(crate) use self::body::{BodySource, Message};
pub(crate) use self::cache::{Cache, CacheStorage};
pub(crate) use self::event_source::EventSource;
pub(crate) use self::fetch::{FetchLaterResult, PendingFetch};
pub(crate) use self::headers::{Headers, HeadersIterator};
pub(crate) use self::request::Request;
pub(crate) use self::response::Response;
pub(crate) use self::web_socket::{CloseEvent, WebSocket};
pub(crate) use self::xhr::XMLHttpRequest;
use crate::api::core::*;
use crate::api::events::{Event, EventInit, Trusted, WindowTarget, dispatch, fire};
use crate::api::realm::{Kept, client_of, last_client_of, queue_task_after, spawn};
use crate::generated_bindgen::network::*;

type Cx<'c, 'a> = &'c mut JsScope<'a>;
type Result<'a, T = ()> = bindgen::Result<'a, T>;
type Bytes = Box<[u8]>;
type Str<'a> = JsLocal<'a, JSString>;

/// <https://html.spec.whatwg.org/#api-base-url>
pub(crate) fn base_url(heap: &JsHeap<'_>) -> Option<Url> {
    match WindowTarget::of_realm(heap).and_then(WindowTarget::doc) {
        Some(doc) => Url::parse(doc.base_url().to_utf8().as_bytes()),
        None => Some(last_client_of(heap)?.url()),
    }
}

pub(crate) fn parse_url(heap: &JsHeap<'_>, url: &DomString) -> Option<Url> {
    let url = url.to_utf8();
    base_url(heap).map_or_else(|| Url::parse(url.as_bytes()), |it| it.join(url.as_bytes()))
}

/// <https://html.spec.whatwg.org/#encoding-parsing-a-url>
pub(crate) fn parse_url_in_encoding(realm: &JsHeap<'_>, url: &DomString) -> Option<Url> {
    match WindowTarget::of_realm(realm)
        .and_then(WindowTarget::doc)
        .and_then(Doc::legacy_encoding)
    {
        Some(encoding) => Encoding::for_label(encoding.to_utf8().as_bytes())?
            .parse_url(&url.to_utf8(), &base_url(realm)?),
        None => parse_url(realm, url),
    }
}

fn type_error<'a>(heap: &JsHeap<'a>, message: &str) -> Error<'a> {
    heap.type_error(format_args!("{message}"))
}

/// Of a `ByteString`.
fn bytes_of(string: &DomString) -> std::borrow::Cow<'_, [u8]> {
    string
        .latin1()
        .map_or_else(|| string.units().map(|it| it as u8).collect(), Into::into)
}
