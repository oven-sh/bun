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

use crate::webcore::blob::{self, Any as AnyBlob, BlobExt};
use crate::webcore::body::{BodyMixin as _, Tag as BodyTag};
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
    // `WebAssembly.compileStreaming` / `instantiateStreaming`, C++ host functions, call this.
    let context = this.bun_vm().context_of_caller();
    let Some(response) = response_value.as_class_ref::<Response>() else {
        return Err(this.throw_invalid_argument_type_value2(
            b"source",
            // "an Promise" is byte-for-byte what Node's ERR_INVALID_ARG_TYPE formatter emits.
            b"an instance of Response or an Promise resolving to Response",
            response_value,
        ));
    };

    // Parameters are disallowed: https://webassembly.github.io/spec/web-api/#compile-a-potential-webassembly-response
    let is_wasm = response.with_content_type(|content_type| {
        strings::eql_case_insensitive_ascii(content_type, b"application/wasm", true)
    });
    if !is_wasm.unwrap_or(false) {
        let content_type = response.with_content_type(<[u8]>::to_vec);
        return Err(this
            .err(
                ErrorCode::WEBASSEMBLY_RESPONSE,
                format_args!(
                    "WebAssembly response has unsupported MIME type '{}'",
                    bstr::BStr::new(content_type.as_deref().unwrap_or(b"null"))
                ),
            )
            .throw());
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

    if response.body_stream_check(this, ReadableStream::is_disturbed) {
        return Err(this
            .err(
                ErrorCode::WEBASSEMBLY_RESPONSE,
                format_args!("WebAssembly response body has already been used"),
            )
            .throw());
    }

    let body = response.body();
    if let Some(err) = body.error_to_js(this) {
        return Err(this.throw_value(err));
    }

    // We're done validating. From now on, deal with extracting the body.
    body.to_blob_if_possible();

    if body.tag() == BodyTag::Locked {
        if let Some(stream) = response.get_body_readable_stream() {
            return Ok(stream.value);
        }
    }

    let any_blob: AnyBlob = match body.tag() {
        BodyTag::Locked => match body.try_use_as_any_blob() {
            Some(b) => b,
            None => return body.to_readable_stream(&this.js_thread(context)),
        },
        _ => body.use_as_any_blob(),
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
        blob.resolve_size();
        let size = blob.size.get();
        return ReadableStream::from_blob_copy_ref(&this.js_thread(context), &blob, size);
    }

    // Push the blob contents into the streaming compiler by passing a pointer and
    // length, and return null to signify this has been done.
    let slice = any_blob.slice();
    JSC__Wasm__StreamingCompiler__addBytes(streaming_compiler, slice.as_ptr(), slice.len());

    Ok(JSValue::NULL)
}

/// Plain C ABI
/// shim: returns `.zero` on thrown exception.
///
/// # Safety
/// `this` must be a valid, live `JSGlobalObject` pointer for the duration of
/// the call (guaranteed by the C++ host caller).
#[unsafe(no_mangle)]
unsafe extern "C" fn Zig__GlobalObject__getBodyStreamOrBytesForWasmStreaming(
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
