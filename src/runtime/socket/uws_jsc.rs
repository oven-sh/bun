//! JSC bridges for `src/uws/` types. Keeps `uws/` free of JSC types.
//! Exports here are referenced via aliases on the original structs so call
//! sites do not change.

use core::ffi::CStr;

use bun_boringssl as boringssl;
use bun_jsc::node::{BlobOrStringOrBuffer, StringOrBuffer};
use bun_jsc::{JSGlobalObject, JSValue, JsResult, SystemError};
use bun_str::String as BunString;
use bun_uws::{
    us_bun_verify_error_t, us_socket_stream_buffer_t, us_socket_t, AnyWebSocket,
    CreateBunSocketError, RawWebSocket,
};

// ── create_bun_socket_error_t.toJS / us_bun_verify_error_t.toJS ────────────
pub fn create_bun_socket_error_to_js(
    this: CreateBunSocketError,
    global_object: &JSGlobalObject,
) -> JSValue {
    match this {
        // us_ssl_ctx_from_options only sets *err for the CA/cipher cases;
        // bad cert/key/DH return NULL with .none and the detail is on the
        // BoringSSL error queue. Surfacing it here keeps every
        // `createSSLContext(...) orelse return err.toJS()` site correct.
        CreateBunSocketError::None => {
            // SAFETY: ERR_get_error is thread-local queue read, always safe to call.
            boringssl::err_to_js(global_object, unsafe {
                bun_boringssl_sys::ERR_get_error()
            })
        }
        // TODO(port): exact shape of `JSGlobalObject::ERR(code, fmt, args)` builder
        CreateBunSocketError::LoadCaFile => global_object
            .ERR(bun_jsc::ErrorCode::BORINGSSL, format_args!("Failed to load CA file"))
            .to_js(),
        CreateBunSocketError::InvalidCaFile => global_object
            .ERR(bun_jsc::ErrorCode::BORINGSSL, format_args!("Invalid CA file"))
            .to_js(),
        CreateBunSocketError::InvalidCa => global_object
            .ERR(bun_jsc::ErrorCode::BORINGSSL, format_args!("Invalid CA"))
            .to_js(),
        CreateBunSocketError::InvalidCiphers => global_object
            .ERR(bun_jsc::ErrorCode::BORINGSSL, format_args!("Invalid ciphers"))
            .to_js(),
    }
}

pub fn verify_error_to_js(
    this: &us_bun_verify_error_t,
    global_object: &JSGlobalObject,
) -> JsResult<JSValue> {
    let code: &[u8] = if this.code.is_null() {
        b""
    } else {
        // SAFETY: this.code is a non-null NUL-terminated C string from uSockets.
        unsafe { CStr::from_ptr(this.code) }.to_bytes()
    };
    let reason: &[u8] = if this.reason.is_null() {
        b""
    } else {
        // SAFETY: this.reason is a non-null NUL-terminated C string from uSockets.
        unsafe { CStr::from_ptr(this.reason) }.to_bytes()
    };

    let fallback = SystemError {
        code: BunString::clone_utf8(code),
        message: BunString::clone_utf8(reason),
        ..SystemError::default()
    };

    fallback.to_error_instance(global_object)
}

// ── AnyWebSocket.getTopicsAsJSArray ────────────────────────────────────────
// TODO(port): move to bun_uws_sys
unsafe extern "C" {
    fn uws_ws_get_topics_as_js_array(
        ssl: i32,
        ws: *mut RawWebSocket,
        global_object: *mut JSGlobalObject,
    ) -> JSValue;
}

pub fn any_web_socket_get_topics_as_js_array(
    this: AnyWebSocket,
    global_object: &JSGlobalObject,
) -> JSValue {
    match this {
        AnyWebSocket::Ssl(_) => unsafe {
            // SAFETY: this.raw() yields a live *mut RawWebSocket; global_object is valid for the call.
            uws_ws_get_topics_as_js_array(
                1,
                this.raw(),
                global_object as *const _ as *mut JSGlobalObject,
            )
        },
        AnyWebSocket::Tcp(_) => unsafe {
            // SAFETY: this.raw() yields a live *mut RawWebSocket; global_object is valid for the call.
            uws_ws_get_topics_as_js_array(
                0,
                this.raw(),
                global_object as *const _ as *mut JSGlobalObject,
            )
        },
    }
}

// ── us_socket_buffered_js_write (C-exported, called from JSNodeHTTPServerSocket.cpp) ──
#[unsafe(no_mangle)]
pub extern "C" fn us_socket_buffered_js_write(
    socket: *mut us_socket_t,
    // kept for ABI parity with the C++ caller; TLS is now per-socket
    _ssl: bool,
    ended: bool,
    buffer: *mut us_socket_stream_buffer_t,
    global_object: &JSGlobalObject,
    data: JSValue,
    encoding: JSValue,
) -> JSValue {
    // SAFETY: caller (JSNodeHTTPServerSocket.cpp) guarantees socket and buffer are valid for the call.
    let socket = unsafe { &mut *socket };
    // SAFETY: see above.
    let buffer = unsafe { &mut *buffer };

    let mut stream_buffer = buffer.to_stream_buffer();
    let mut total_written: usize = 0;

    // PORT NOTE: Zig `defer { buffer.update(stream_buffer); buffer.wrote(total_written); }`
    // reshaped as a labeled block + post-block cleanup so the side effects run on every
    // exit path without a scopeguard borrow conflict.
    let result: JSValue = 'body: {
        // PERF(port): was stack-fallback (std.heap.stackFallback(16 * 1024)) — profile in Phase B
        let node_buffer: BlobOrStringOrBuffer = if data.is_undefined() {
            BlobOrStringOrBuffer::StringOrBuffer(StringOrBuffer::empty())
        } else {
            match BlobOrStringOrBuffer::from_js_with_encoding_value_allow_request_response(
                global_object,
                data,
                encoding,
                true,
            ) {
                Err(_) => break 'body JSValue::ZERO,
                Ok(Some(v)) => v,
                Ok(None) => {
                    if !global_object.has_exception() {
                        let _ = global_object.throw_invalid_argument_type_value(
                            "data",
                            "string, buffer, or blob",
                            data,
                        );
                    }
                    break 'body JSValue::ZERO;
                }
            }
        };

        if let BlobOrStringOrBuffer::Blob(ref blob) = node_buffer {
            if blob.needs_to_read_file() {
                let _ = global_object.throw(format_args!(
                    "File blob not supported yet in this function."
                ));
                break 'body JSValue::ZERO;
            }
        }

        let data_slice = node_buffer.slice();
        if stream_buffer.is_not_empty() {
            let to_flush = stream_buffer.slice();
            let to_flush_len = to_flush.len();
            let written: u32 = socket.write(to_flush).max(0) as u32;
            stream_buffer.wrote(written);
            total_written = total_written.saturating_add(usize::from(written));
            if (written as usize) < to_flush_len {
                if !data_slice.is_empty() {
                    stream_buffer.write(data_slice);
                }
                break 'body JSValue::FALSE;
            }
        }

        if !data_slice.is_empty() {
            let written: u32 = socket.write(data_slice).max(0) as u32;
            total_written = total_written.saturating_add(usize::from(written));
            if (written as usize) < data_slice.len() {
                stream_buffer.write(&data_slice[written as usize..]);
                break 'body JSValue::FALSE;
            }
        }
        if ended {
            socket.shutdown();
        }
        JSValue::TRUE
    };

    buffer.update(&stream_buffer);
    buffer.wrote(total_written);
    result
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/uws_jsc.zig (116 lines)
//   confidence: medium
//   todos:      2
//   notes:      defer reshaped to labeled block; ERR()/BlobOrStringOrBuffer API shapes guessed
// ──────────────────────────────────────────────────────────────────────────
