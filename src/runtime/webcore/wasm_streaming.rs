//! `Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming` — moved UP from
//! `bun_jsc::JSGlobalObject` because the body inspects `Response`/`Body`/
//! `Blob`/`ReadableStream`, which are `bun_runtime` types (forward-dep of
//! `bun_jsc`). The Zig original lives in `src/jsc/JSGlobalObject.zig:871`.
//!
//! C++ calls this via `jsc.host_fn.wrap3` — i.e. plain C ABI with the three
//! original arguments, returning a possibly-empty `JSValue` (empty == thrown).

use core::ffi::c_void;

use bun_jsc::{ErrorCode, JSGlobalObject, JSValue, JsError, JsResult};

use crate::webcore::blob::{self, Any as AnyBlob, Store};
use crate::webcore::body::Value as BodyValue;
use crate::webcore::{ReadableStream, Response};

unsafe extern "C" {
    fn JSC__Wasm__StreamingCompiler__addBytes(
        streaming_compiler: *mut c_void,
        bytes_ptr: *const u8,
        bytes_len: usize,
    );
}

/// Spec `JSGlobalObject.zig:871 getBodyStreamOrBytesForWasmStreaming`.
pub fn get_body_stream_or_bytes_for_wasm_streaming(
    this: &JSGlobalObject,
    response_value: JSValue,
    streaming_compiler: *mut c_void,
) -> JsResult<JSValue> {
    // SAFETY: `from_js` returns a pointer to the GC-owned `Response` cell;
    // the cell stays live for the duration of this host call (rooted on the
    // C++ caller's stack).
    let response: &mut Response = match Response::js::from_js(response_value) {
        Some(r) => unsafe { &mut *r },
        None => {
            return Err(this.throw_invalid_argument_type_value2(
                b"source",
                b"an instance of Response or an Promise resolving to Response",
                response_value,
            ));
        }
    };

    let content_type_slice = response.get_content_type()?;
    let content_type: &[u8] = match &content_type_slice {
        Some(ct) => ct.slice(),
        None => b"null",
    };

    if content_type != b"application/wasm" {
        return Err(this
            .err(
                ErrorCode::WEBASSEMBLY_RESPONSE,
                format_args!(
                    "WebAssembly response has unsupported MIME type '{}'",
                    bstr::BStr::new(content_type)
                ),
            )
            .throw());
    }
    drop(content_type_slice);

    if !response.is_ok() {
        return Err(this
            .err(
                ErrorCode::WEBASSEMBLY_RESPONSE,
                format_args!("WebAssembly response has status code {}", response.status_code()),
            )
            .throw());
    }

    if response.get_body_used(this).to_boolean() {
        return Err(this
            .err(
                ErrorCode::WEBASSEMBLY_RESPONSE,
                format_args!("WebAssembly response body has already been used"),
            )
            .throw());
    }

    let body = response.get_body_value();
    if let BodyValue::Error(err) = body {
        return Err(this.throw_value(err.to_js(this)));
    }

    // We're done validating. From now on, deal with extracting the body.
    body.to_blob_if_possible();

    if matches!(body, BodyValue::Locked(_)) {
        if let Some(stream) = response.get_body_readable_stream(this) {
            return Ok(stream.value);
        }
    }

    let body = response.get_body_value();
    let mut any_blob: AnyBlob = match body {
        BodyValue::Locked(_) => match body.try_use_as_any_blob() {
            Some(b) => b,
            None => return body.to_readable_stream(this),
        },
        _ => body.use_as_any_blob(),
    };

    if let Some(store) = any_blob.store() {
        if !matches!(store.data, blob::store::Data::Bytes(_)) {
            // This is a file or an S3 object, which aren't accessible synchronously.
            // (using any_blob.slice() would return a bogus empty slice)

            // Logic from JSC.WebCore.Body.Value.toReadableStream
            let mut blob = any_blob.into_blob();
            // `defer blob.detach()` — RAII via scopeguard.
            let mut blob = scopeguard::guard(blob, |mut b| b.detach());
            blob.resolve_size();
            let size = blob.size;
            return Ok(ReadableStream::from_blob_copy_ref(this, &mut blob, size));
        }
    }

    // `defer any_blob.detach()` — RAII via scopeguard.
    let any_blob = scopeguard::guard(any_blob, |mut b| b.detach());

    // Push the blob contents into the streaming compiler by passing a pointer and
    // length, and return null to signify this has been done.
    let slice = any_blob.slice();
    // SAFETY: FFI — `streaming_compiler` is a valid C++ StreamingCompiler* passed in by
    // the caller; `slice.as_ptr()/len()` describe a buffer kept alive by `any_blob`
    // until `detach()` (scopeguard) runs at end of scope.
    unsafe {
        JSC__Wasm__StreamingCompiler__addBytes(streaming_compiler, slice.as_ptr(), slice.len());
    }

    Ok(JSValue::NULL)
}

/// `jsc.host_fn.wrap3(getBodyStreamOrBytesForWasmStreaming)` — plain C ABI
/// shim: returns `.zero` on thrown exception (matches `wrapN` semantics in
/// `src/jsc/host_fn.zig`).
#[unsafe(no_mangle)]
pub extern "C" fn Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming(
    this: *mut JSGlobalObject,
    response_value: JSValue,
    streaming_compiler: *mut c_void,
) -> JSValue {
    // SAFETY: C++ passes a live global object.
    let this = unsafe { &*this };
    match get_body_stream_or_bytes_for_wasm_streaming(this, response_value, streaming_compiler) {
        Ok(v) => v,
        Err(JsError::OutOfMemory) => {
            let _ = this.throw_out_of_memory();
            JSValue::ZERO
        }
        Err(_) => JSValue::ZERO,
    }
}
