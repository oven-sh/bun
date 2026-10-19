//! Native halves of node's `[nodejs.util.inspect.custom]` method for `Response`, `Request` and `Blob`.

use core::ffi::{CStr, c_char};

use bun_core::String as BunString;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _};

use super::blob::{Blob, BlobExt as _, last_modified_if_known, size_if_known};
use super::body::{BodyMixin, Value as BodyValue};
use super::{AbortSignal, Request, Response};
use crate::generated_classes::{js_Blob, js_Request, js_Response};

unsafe extern "C" {
    fn Bun__inspectFields(
        global: &JSGlobalObject,
        callframe: &CallFrame,
        instance: JSValue,
        fields: JSValue,
        tag: *const c_char,
    ) -> JSValue;
    /// `{ locked, state, supportsBYOB }` of a ReadableStream. Empty for another value.
    safe fn Bun__ReadableStream__inspectState(global: &JSGlobalObject, stream: JSValue) -> JSValue;
}

/// Gives `fields`, the state of `instance`, to the `case` for `tag` in `inspect_hooks.ts`, which returns the text.
pub(crate) fn print(
    global: &JSGlobalObject,
    callframe: &CallFrame,
    instance: JSValue,
    fields: JSValue,
    tag: &'static CStr,
) -> JsResult<JSValue> {
    // SAFETY: `tag` is a NUL-terminated `'static` string. `instance` and `fields` are objects.
    bun_jsc::from_js_host_call(global, || unsafe {
        Bun__inspectFields(global, callframe, instance, fields, tag.as_ptr())
    })
}

/// The `body` that a reader can show without making a stream: `null`, or the state of a stream that exists.
fn existing_body(
    global: &JSGlobalObject,
    cached: Option<JSValue>,
    owner: &Response,
) -> Option<JSValue> {
    let stream = match cached {
        Some(body) if body.is_null() => return Some(JSValue::NULL),
        Some(body) => body,
        None => match owner.get_body_readable_stream() {
            Some(stream) => stream.value,
            None => {
                return matches!(owner.get_body_value(), BodyValue::Null).then_some(JSValue::NULL);
            }
        },
    };
    let state = Bun__ReadableStream__inspectState(global, stream);
    (!state.is_empty()).then_some(state)
}

impl Response {
    /// undici: `{ status, statusText, headers, body, bodyUsed, ok, redirected, type, url }`.
    pub(crate) fn inspect_custom(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let headers = match js_Response::headers_get_cached(this_value) {
            Some(headers) => headers,
            None => match self.get_init_headers_mut() {
                Some(headers) => headers.to_js(global),
                None => self.default_headers(global)?.to_js(global),
            },
        };
        let status_text = match js_Response::status_text_get_cached(this_value) {
            Some(status_text) => status_text,
            None => Self::get_status_text(self, global)?,
        };
        let url = match js_Response::url_get_cached(this_value) {
            Some(url) => url,
            None => Self::get_url(self, global)?,
        };
        let fields = JSValue::create_empty_object(global, 9);
        fields.put(global, b"status", Self::get_status(self, global));
        fields.put(global, b"statusText", status_text);
        fields.put(global, b"headers", headers);
        if let Some(body) = existing_body(global, js_Response::body_get_cached(this_value), self) {
            fields.put(global, b"body", body);
        }
        fields.put(global, b"bodyUsed", self.get_body_used(global));
        fields.put(global, b"ok", JSValue::from(self.is_ok()));
        fields.put(global, b"redirected", Self::get_redirected(self, global));
        fields.put(global, b"type", Self::get_response_type(self, global)?);
        fields.put(global, b"url", url);
        print(global, callframe, this_value, fields, c"Response")
    }
}

impl Request {
    /// The fields that undici prints. A reader attaches no header list and keeps no URL and no signal.
    pub(crate) fn inspect_custom(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let headers = match js_Request::headers_get_cached(this_value) {
            Some(headers) => headers,
            None if self.has_fetch_headers() => self.get_headers(global)?,
            None => self.default_fetch_headers(global)?.to_js(global),
        };
        // The `url` getter of a served Request builds the URL and keeps it. This builds it and takes it back.
        let url = match js_Request::url_get_cached(this_value) {
            Some(url) => url,
            None if self.url.get().is_empty() => {
                self.ensure_url()?;
                self.url.replace(BunString::EMPTY).to_js(global)?
            }
            None => self.url.get().to_js(global)?,
        };
        // `referrer` is a header lookup, and that call can throw without a sentinel value.
        let referrer = bun_jsc::call_check_slow(global, || self.get_referrer(global))?;
        // The `signal` getter makes a signal and keeps it. This one is not kept.
        let signal = match self.abort_signal() {
            Some(signal) => signal.to_js(global),
            None => AbortSignal::create(global),
        };
        let fields = JSValue::create_empty_object(global, 12);
        fields.put(global, b"method", self.get_method(global));
        fields.put(global, b"url", url);
        fields.put(global, b"headers", headers);
        fields.put(global, b"destination", Self::get_destination(self, global));
        fields.put(global, b"referrer", referrer);
        fields.put(
            global,
            b"referrerPolicy",
            Self::get_referrer_policy(self, global),
        );
        fields.put(global, b"mode", self.get_mode(global));
        fields.put(global, b"credentials", Self::get_credentials(self, global));
        fields.put(global, b"cache", self.get_cache(global));
        fields.put(global, b"redirect", self.get_redirect(global));
        fields.put(global, b"integrity", Self::get_integrity(self, global));
        fields.put(global, b"signal", signal);
        print(global, callframe, this_value, fields, c"Request")
    }
}

/// `Blob` is a `bun_jsc` type, so its reader is a trait method, like the rest of [`BlobExt`].
pub(crate) trait BlobInspect {
    fn inspect_custom(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue>;
}

impl BlobInspect for Blob {
    /// A File shares this prototype. A size or a time that needs a `stat` or a request is left out.
    fn inspect_custom(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        this_value: JSValue,
    ) -> JsResult<JSValue> {
        let is_file = self.is_jsdom_file.get();
        let fields = JSValue::create_empty_object(global, 4);
        if let Some(size) = size_if_known(self) {
            fields.put(global, b"size", JSValue::js_number(size as f64));
        }
        fields.put(global, b"type", self.get_type(global));
        if is_file {
            let name = match js_Blob::name_get_cached(this_value) {
                Some(name) => name,
                None => match self.get_name_string() {
                    Some(name) => name.to_js(global)?,
                    None => JSValue::UNDEFINED,
                },
            };
            fields.put(global, b"name", name);
            if let Some(last_modified) = last_modified_if_known(self) {
                fields.put(global, b"lastModified", last_modified);
            }
        }
        let tag = if is_file { c"File" } else { c"Blob" };
        print(global, callframe, this_value, fields, tag)
    }
}
