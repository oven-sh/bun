//! JSC bridges for `src/uws/` types. Keeps `uws/` free of JSC types.
//! Exports here are referenced via aliases on the original structs so call
//! sites do not change.

use bun_jsc::{JSGlobalObject, JSValue, JsError};
use bun_uws::{AnyWebSocket, RawWebSocket, create_bun_socket_error_t};

/// What a failed `listen()` was asked to listen on.
pub(crate) enum ListenTarget<'a> {
    Tcp {
        hostname: Option<&'a [u8]>,
        port: u16,
    },
    Unix(&'a [u8]),
    Fd,
}

impl<'a> ListenTarget<'a> {
    fn address(&self) -> Option<&'a [u8]> {
        match *self {
            ListenTarget::Tcp { hostname, .. } => hostname,
            ListenTarget::Unix(path) => Some(path),
            ListenTarget::Fd => None,
        }
    }
}

/// Each API keeps the message it has always thrown.
#[derive(Clone, Copy)]
pub(crate) enum ListenApi {
    BunServe,
    BunListen,
}

/// Throws the error of a failed `Bun.serve()` or `Bun.listen()`. node:http and node:net build theirs from its `code` and `syscall`.
#[cold]
pub(crate) fn throw_listen_error(
    global: &JSGlobalObject,
    api: ListenApi,
    target: &ListenTarget<'_>,
    failure: bun_uws_sys::app::ListenError,
) -> JsError {
    use bun_sys::SystemErrno;

    if let Some(err) = crate::dns_jsc::cares_jsc::getaddrinfo_error(
        failure.dns_error,
        target.address().unwrap_or(b""),
    ) {
        return global.throw_value(err.to_error_instance(global));
    }

    let errno = bun_uws_sys::SocketGroup::errno(failure.error).unwrap_or(SystemErrno::EUNKNOWN);
    throw_listen_errno(global, api, target, errno)
}

/// [`throw_listen_error`] for a `listen()` that isn't uSockets': a Windows named pipe's.
#[cold]
pub(crate) fn throw_listen_errno(
    global: &JSGlobalObject,
    api: ListenApi,
    target: &ListenTarget<'_>,
    errno: bun_sys::SystemErrno,
) -> JsError {
    use bun_sys::SystemErrno;

    let address = target.address();
    // Winsock has no privileged ports: WSAEACCES means the port is held or in an excluded range.
    #[cfg(windows)]
    let errno = match (api, target, errno) {
        (ListenApi::BunServe, ListenTarget::Tcp { .. }, SystemErrno::EACCES) => {
            SystemErrno::EADDRINUSE
        }
        _ => errno,
    };

    let mut sys_error = bun_sys::Error::new(errno, bun_sys::Tag::listen);
    if let ListenTarget::Unix(path) = *target {
        sys_error = sys_error.with_path(path);
    }
    let mut err = bun_jsc::SystemError::from(sys_error.to_system_error());
    match (api, target, errno) {
        (ListenApi::BunListen, ..) => {
            err.message = bun_core::String::create_format(format_args!(
                "Failed to listen at {}",
                bstr::BStr::new(address.unwrap_or(b""))
            ));
        }
        (ListenApi::BunServe, ListenTarget::Tcp { port, .. }, SystemErrno::EADDRINUSE) => {
            err.message = bun_core::String::create_format(format_args!(
                "Failed to start server. Is port {port} in use?"
            ));
        }
        (ListenApi::BunServe, ListenTarget::Tcp { port, .. }, SystemErrno::EACCES) => {
            err.message = bun_core::String::create_format(format_args!(
                "permission denied {}:{port}",
                bstr::BStr::new(address.unwrap_or(b"0.0.0.0"))
            ));
        }
        (ListenApi::BunServe, ..) => {}
    }

    let error = err.to_error_instance(global);
    if let Some(address) = address {
        match bun_jsc::bun_string_jsc::create_utf8_for_js(global, address) {
            Ok(address) => error.put(global, b"address", address),
            Err(thrown) => return thrown,
        }
    }
    if let ListenTarget::Tcp { port, .. } = *target {
        error.put(global, b"port", JSValue::js_number(f64::from(port)));
    }
    global.throw_value(error)
}

// ── create_bun_socket_error_t.toJS / us_bun_verify_error_t.toJS ────────────
pub(crate) fn create_bun_socket_error_to_js(
    this: create_bun_socket_error_t,
    global_object: &JSGlobalObject,
) -> JSValue {
    let queued = bun_boringssl_sys::ERR_get_error();
    bun_boringssl_sys::ERR_clear_error();
    match this {
        // us_ssl_ctx_from_options only sets *err for the CA/cipher cases;
        // bad cert/key/DH return NULL with .none and the detail is on the
        // BoringSSL error queue. Surfacing it here keeps every
        // `createSSLContext(...) orelse return err.toJS()` site correct.
        create_bun_socket_error_t::none => {
            crate::crypto::boringssl_jsc::err_to_js(global_object, queued)
        }
        create_bun_socket_error_t::load_ca_file => global_object
            .err(
                bun_jsc::ErrorCode::BORINGSSL,
                format_args!("Failed to load CA file"),
            )
            .to_js(),
        create_bun_socket_error_t::invalid_ca_file => global_object
            .err(
                bun_jsc::ErrorCode::BORINGSSL,
                format_args!("Invalid CA file"),
            )
            .to_js(),
        create_bun_socket_error_t::invalid_ca => global_object
            .err(bun_jsc::ErrorCode::BORINGSSL, format_args!("Invalid CA"))
            .to_js(),
        create_bun_socket_error_t::invalid_ciphers => global_object
            .err(
                bun_jsc::ErrorCode::BORINGSSL,
                format_args!("Invalid ciphers"),
            )
            .to_js(),
        create_bun_socket_error_t::invalid_crl => global_object
            .err(
                bun_jsc::ErrorCode::ERR_CRYPTO_OPERATION_FAILED,
                format_args!("Failed to parse CRL"),
            )
            .to_js(),
        create_bun_socket_error_t::invalid_ecdh_curve => global_object
            .err(
                bun_jsc::ErrorCode::ERR_CRYPTO_OPERATION_FAILED,
                format_args!("Failed to set ECDH curve"),
            )
            .to_js(),
    }
}

// LAYERING: body sunk to `bun_jsc::system_error` so `bun_sql_jsc` (which this
// crate depends on) shares the single canonical impl instead of carrying a
// verbatim copy.
pub(crate) use bun_jsc::system_error::verify_error_to_js;

// ── AnyWebSocket.getTopicsAsJSArray ────────────────────────────────────────
// Declared inline; migrate into `bun_uws_sys` with the rest of the
// WebSocket FFI surface.
unsafe extern "C" {
    // Opaque-handle (`RawWebSocket` is an `opaque_ffi!` ZST — `&mut` carries no
    // `noalias`, dereferences zero bytes) + live `&JSGlobalObject`
    // (UnsafeCell-backed, FFI may mutate VM state). No caller-side precondition;
    // matches `uws_ws_close` / `uws_ws_get_user_data` in `bun_uws_sys::WebSocket`.
    safe fn uws_ws_get_topics_as_js_array(
        ssl: i32,
        ws: &mut RawWebSocket,
        global_object: &JSGlobalObject,
    ) -> JSValue;
}

pub(crate) fn any_web_socket_get_topics_as_js_array(
    this: AnyWebSocket,
    global_object: &JSGlobalObject,
) -> JSValue {
    // S012: route the `*mut → &mut` opaque-ZST deref through the const-asserted
    // safe accessor (`RawWebSocket::opaque_mut`, generated by `opaque_ffi!`).
    let (ssl, ws) = match this {
        AnyWebSocket::Ssl(p) => (1, RawWebSocket::opaque_mut(p)),
        AnyWebSocket::Tcp(p) => (0, RawWebSocket::opaque_mut(p)),
    };
    uws_ws_get_topics_as_js_array(ssl, ws, global_object)
}
