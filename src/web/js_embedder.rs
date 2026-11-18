//! Requests and responses as the scripts of the app have them.

use bun_jsc::bindgen::{self, JsLocal, JsScope};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{AbortSignalRef, CommonAbortReason, JSValue};

use crate::exec::with_js;
use crate::net::NetError;
use crate::net::body::{Data, SharedBytes};
use crate::net::embedder::Outgoing;
use crate::net::response::{Answer, is_null_body_status};
use crate::request::RequestBody;
use crate::runtime::{self, ResponseBody};
use crate::streams::{body_of_stream, rejection, stream_of};

#[derive(Default)]
pub struct AbortOnDrop(pub Option<AbortSignalRef>);

impl AbortOnDrop {
    pub fn disarm(mut self) {
        self.0 = None;
    }
}

impl Drop for AbortOnDrop {
    fn drop(&mut self) {
        if let Some(signal) = self
            .0
            .take()
            .filter(|_| VirtualMachine::get().script_allowed())
        {
            with_js(|cx| signal.signal(cx.global(), CommonAbortReason::UserAbort));
        }
    }
}

pub fn request_to_js<'a>(
    cx: &mut JsScope<'a>,
    request: Outgoing,
    signal: AbortSignalRef,
) -> bindgen::Result<'a, JsLocal<'a>> {
    let body = match request.body {
        None | Some(RequestBody::Stream(None) | RequestBody::Upgrade(_)) => JSValue::NULL,
        Some(RequestBody::Data(Data::Bytes(bytes))) => cx.heap.create_uint8_array(&bytes)?.to_js(),
        Some(RequestBody::Data(data)) => stream_of(cx, Answer::of_body(data.open()))?,
        Some(RequestBody::Stream(Some(body))) => stream_of(cx, Answer::of_body(body))?,
    };
    let request = runtime::create_request(
        cx.global(),
        request.url.href(),
        &request.method,
        &request.headers,
        body,
        signal,
    )?;
    Ok(JsLocal::new(&cx.heap, request))
}

pub fn answer_from_js<'a>(
    cx: &mut JsScope<'a>,
    value: JsLocal<'a>,
    maps_file: bool,
) -> bindgen::Result<'a, Answer> {
    let response = runtime::take_response(cx.global(), value.to_js())?
        .ok_or_else(|| rejection(cx, NetError::Failed))?;
    let body = match response.body {
        ResponseBody::Blob(Data::File {
            path,
            range,
            modified: None,
        }) if maps_file && range.start == 0 => {
            let mapped = runtime::map_resource(&path)
                .map(|it| Data::Bytes(SharedBytes::new(it)).slice(range.clone()));
            let data = mapped.unwrap_or(Data::File {
                path,
                range,
                modified: None,
            });
            Answer::of_body(data.open())
        }
        ResponseBody::Blob(data) => Answer::of_body(data.open()),
        ResponseBody::Stream(stream) => body_of_stream(cx, stream)?,
    };
    Ok(Answer {
        status: response.status,
        status_text: response.status_text,
        headers: response.headers,
        ..body
    })
}

pub fn answer_to_js<'a>(
    cx: &mut JsScope<'a>,
    mut answer: Answer,
) -> bindgen::Result<'a, JsLocal<'a>> {
    let (status, status_text, headers) = (
        answer.status,
        core::mem::take(&mut answer.status_text),
        core::mem::take(&mut answer.headers),
    );
    let body = if is_null_body_status(status) {
        JSValue::NULL
    } else {
        stream_of(cx, answer)?
    };
    let response = runtime::create_response(cx.global(), status, &status_text, &headers, body)?;
    Ok(JsLocal::new(&cx.heap, response))
}
