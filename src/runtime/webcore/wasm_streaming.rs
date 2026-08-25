//! `Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming` — lives here rather
//! than in `bun_jsc::JSGlobalObject` because the body inspects `Response`/`Body`/
//! `Blob`/`ReadableStream`, which are `bun_runtime` types (forward-dep of
//! `bun_jsc`).
//!
//! C++ calls this via `jsc.host_fn.wrap3` — i.e. plain C ABI with the three
//! original arguments, returning a possibly-empty `JSValue` (empty == thrown).

use core::ffi::c_void;

use bun_core::strings;
use bun_jsc::{ErrorCode, JSGlobalObject, JSValue, JsError, JsResult};

use crate::webcore::blob::{self, Any as AnyBlob, Blob, BlobExt};
use crate::webcore::body::{BodyMixin as _, Value as BodyValue};
use crate::webcore::{ReadableStream, Response};

unsafe extern "C" {
    // `streaming_compiler` is the opaque C++ `StreamingCompiler*` handed in by
    // the host; `bytes_ptr`/`bytes_len` are the ptr/len of a Rust `&[u8]`.
    // Module-private with one call site below — no caller-side precondition
    // remains.
    safe fn JSC__Wasm__StreamingCompiler__addBytes(
        streaming_compiler: *mut c_void,
        bytes_ptr: *const u8,
        bytes_len: usize,
    );
}

fn get_body_stream_or_bytes_for_wasm_streaming(
    this: &JSGlobalObject,
    response_value: JSValue,
    streaming_compiler: *mut c_void,
) -> JsResult<JSValue> {
    // The GC-owned `Response` cell stays live for the duration of this host
    // call (rooted on the C++ caller's stack).
    let Some(response) = response_value.as_class_ref::<Response>() else {
        return Err(this.throw_invalid_argument_type_value2(
            b"source",
            // "an Promise" is byte-for-byte what Node's ERR_INVALID_ARG_TYPE
            // formatter emits for an uppercase-initial non-class entry.
            b"an instance of Response or an Promise resolving to Response",
            response_value,
        ));
    };

    {
        let content_type_slice = response.get_content_type()?;
        let content_type: &[u8] = match &content_type_slice {
            Some(ct) => ct.slice(),
            None => b"null",
        };

        // https://webassembly.github.io/spec/web-api/#compile-a-potential-webassembly-response
        // requires a byte-case-insensitive match for `application/wasm`. Parameters
        // are disallowed, so this is a whole-value compare, not an essence check.
        if !strings::eql_case_insensitive_ascii(content_type, b"application/wasm", true) {
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
        // `content_type_slice` drops here.
    }

    if !response.is_ok() {
        return Err(this
            .err(
                ErrorCode::WEBASSEMBLY_RESPONSE,
                format_args!(
                    "WebAssembly response has status code {}",
                    response.status_code()
                ),
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

    // Each body borrow is closure-scoped so none spans `get_body_readable_stream`.
    if let Some(err_js) = response.body_value().with_mut(|body| {
        if let BodyValue::Error(err) = body {
            return Some(err.to_js(this));
        }

        // We're done validating. From now on, deal with extracting the body.
        body.to_blob_if_possible();
        None
    }) {
        return Err(this.throw_value(err_js));
    }

    if matches!(response.body_value().get(), BodyValue::Locked(_)) {
        if let Some(stream) = response.get_body_readable_stream() {
            return Ok(stream.value);
        }
    }

    let any_blob: AnyBlob = match response.body_value().with_mut(|body| match body {
        BodyValue::Locked(_) => match body.try_use_as_any_blob() {
            Some(b) => Ok(b),
            None => Err(body.to_readable_stream(this)),
        },
        _ => Ok(body.use_as_any_blob()),
    }) {
        Ok(any_blob) => any_blob,
        Err(stream) => return stream,
    };

    // `Any::store()` only yields `Some` for the `Blob` variant; non-`Bytes` data means
    // a file/S3-backed store that must go through a ReadableStream.
    if any_blob
        .store()
        .is_some_and(|store| !matches!(store.data, blob::store::Data::Bytes(_)))
    {
        // This is a file or an S3 object, which aren't accessible synchronously.
        // (using any_blob.slice() would return a bogus empty slice)

        // Logic from JSC.WebCore.Body.Value.toReadableStream
        let AnyBlob::Blob(blob) = any_blob else {
            unreachable!("Any::store() returned Some, so this is the Blob variant");
        };
        // `defer blob.detach()` — RAII via scopeguard.
        let blob = scopeguard::guard(blob, |b: Blob| b.detach());
        blob.resolve_size();
        let size = blob.size.get();
        return ReadableStream::from_blob_copy_ref(this, &blob, size);
    }

    // `defer any_blob.detach()` — RAII via scopeguard.
    let any_blob = scopeguard::guard(any_blob, |mut b: AnyBlob| b.detach());

    // Push the blob contents into the streaming compiler by passing a pointer and
    // length, and return null to signify this has been done.
    let slice = any_blob.slice();
    // `slice` is kept alive by `any_blob` until `detach()` (scopeguard) runs
    // at end of scope.
    JSC__Wasm__StreamingCompiler__addBytes(streaming_compiler, slice.as_ptr(), slice.len());

    Ok(JSValue::NULL)
}

/// Plain C ABI shim: returns `.zero` on thrown exception.
// HOST_EXPORT(Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming, c)
pub fn get_body_stream_or_bytes_for_wasm_streaming_export(
    this: &JSGlobalObject,
    response_value: JSValue,
    streaming_compiler: *mut c_void,
) -> JSValue {
    match get_body_stream_or_bytes_for_wasm_streaming(this, response_value, streaming_compiler) {
        Ok(v) => v,
        Err(JsError::OutOfMemory) => {
            let _ = this.throw_out_of_memory();
            JSValue::ZERO
        }
        Err(_) => JSValue::ZERO,
    }
}
