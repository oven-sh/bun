//! What `bun_web` needs of blobs, requests and responses.

pub(crate) mod blob;

use bun_boringssl::c::{OwnedX509, X509};
use bun_http::{Headers, Method};
use bun_jsc::bindgen::JsScope;
use bun_jsc::{AbortSignalRef, FetchHeaders, JSGlobalObject, JSValue, JsResult};
use bun_ptr::RefPtr;
use bun_web::convert::data_of_blob;
use bun_web::headers::HeaderList;
use bun_web::net::body::Data;
use bun_web::runtime::{ResponseBody, TakenResponse};

use crate::api::bun_x509;
use crate::webcore::blob::BlobExt;
use crate::webcore::body::{self, Body, Value as BodyValue};
use crate::webcore::response::{self, HeadersRef};
use crate::webcore::{Blob, Request, Response};

pub(crate) fn resolve_blob(cx: &mut JsScope<'_>, url: &[u8]) -> JSValue {
    blob::resolve_url(url).map_or(JSValue::UNDEFINED, |it| it.into_js(cx.global()))
}

#[unsafe(no_mangle)]
fn __bun_web_size_of_blob(blob: &Blob) -> u64 {
    blob.resolved_size().1
}

fn fetch_headers(headers: &HeaderList) -> HeadersRef {
    let mut list = Headers::default();
    headers.iter().for_each(|it| list.append(it.0, it.1));
    // SAFETY: a new object, with one reference.
    unsafe { HeadersRef::adopt(FetchHeaders::create_from_headers(&list)) }
}

#[unsafe(no_mangle)]
fn __bun_web_create_headers(global: &JSGlobalObject, headers: &HeaderList) -> JSValue {
    fetch_headers(headers).to_js(global)
}

#[unsafe(no_mangle)]
fn __bun_web_create_request(
    global: &JSGlobalObject,
    url: &[u8],
    method: &[u8],
    headers: &HeaderList,
    body: JSValue,
    signal: AbortSignalRef,
) -> JsResult<JSValue> {
    let body = body::hive_alloc(BodyValue::from_js(global, body)?);
    let method = Method::which(method).unwrap_or(Method::GET);
    let request = Request::init2(
        bun_core::String::clone_utf8(url),
        Some(fetch_headers(headers)),
        body,
        method,
    );
    request.set_abort_signal(signal);
    Ok(Request::to_js(RefPtr::new(request), global))
}

#[unsafe(no_mangle)]
fn __bun_web_create_response(
    global: &JSGlobalObject,
    status_code: u16,
    status_text: &[u8],
    headers: &HeaderList,
    body: JSValue,
) -> JsResult<JSValue> {
    let init = response::Init {
        headers: Some(fetch_headers(headers)),
        status_code,
        status_text: bun_core::String::clone_latin1(status_text),
        method: Method::GET,
    };
    let body = Body::new(BodyValue::from_js(global, body)?);
    Ok(Response::to_js(
        RefPtr::new(Response::init(init, body, bun_core::String::EMPTY, false)),
        global,
    ))
}

#[unsafe(no_mangle)]
fn __bun_web_take_response(
    global: &JSGlobalObject,
    value: JSValue,
) -> JsResult<Option<TakenResponse>> {
    let Some(response) = value
        .as_class_ref::<Response>()
        .filter(|it| it.status_code() >= 200)
    else {
        return Ok(None);
    };
    let headers = bun_http_jsc::headers_jsc::from_fetch_headers(
        global,
        Some(response.get_or_create_headers(global)?),
        None,
    )?;
    let headers = headers.iter().map(|it| (it.name(), it.value())).collect();
    let content = response.get_body_value();
    if response.get_body_readable_stream().is_none() {
        content.to_blob_if_in_memory();
    }
    let body = match content {
        BodyValue::Used | BodyValue::Error(_) => return Ok(None),
        BodyValue::Null => Some(Data::Bytes(Vec::new().into())),
        BodyValue::Blob(blob) if data_of_blob(blob, 0).is_none() => None,
        BodyValue::Locked(_) => None,
        _ => {
            let blob = content.use_();
            data_of_blob(&blob, blob.size.get())
        }
    };
    let body = match body {
        Some(data) => ResponseBody::Blob(data),
        None => ResponseBody::Stream(value.get(global, "body")?.unwrap_or(JSValue::UNDEFINED)),
    };
    let status_text = bun_web::convert::isomorphic_encode(response.get_init_status_text()).into();
    Ok(Some(TakenResponse {
        status: response.status_code(),
        status_text,
        headers,
        body,
    }))
}

#[unsafe(no_mangle)]
fn __bun_web_create_certificate_chain(
    global: &JSGlobalObject,
    certificate: &[u8],
    issuers: &[Box<[u8]>],
) -> JsResult<JSValue> {
    unsafe extern "C" {
        safe fn X509_check_issued(issuer: &X509, subject: &X509) -> core::ffi::c_int;
    }
    let (mut first, mut subject) = (JSValue::UNDEFINED, JSValue::UNDEFINED);
    for der in core::iter::once(certificate).chain(issuers.iter().map(|it| &**it)) {
        let Some(mut x509) = OwnedX509::from_der(der) else {
            return Ok(JSValue::UNDEFINED);
        };
        let described = bun_x509::to_js(&mut x509, global)?;
        if first.is_undefined() {
            first = described;
        } else {
            subject.put(global, b"issuerCertificate", described);
        }
        subject = described;
        if X509_check_issued(&x509, &x509) == 0 {
            subject.put(global, b"issuerCertificate", subject);
            break;
        }
    }
    Ok(first)
}

#[unsafe(no_mangle)]
fn __bun_web_map_resource(path: &[u8]) -> Option<&'static [u8]> {
    super::map_resource(path)
}
