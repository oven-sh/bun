use core::ffi::{CStr, c_char, c_int};
use core::net::IpAddr;
use core::ptr::null_mut;

use bun_boringssl_sys as ssl;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc};
use bun_uws as uws;

pub(super) struct TlsConfig {
    pub is_server: bool,
    pub alpn: Vec<u8>,
    /// Ends with a NUL.
    pub servername: Vec<u8>,
    pub certs_pem: Vec<Vec<u8>>,
    pub keys_pem: Vec<Vec<u8>>,
    /// `None` is the default CA store.
    pub ca_pem: Option<Vec<Vec<u8>>>,
    /// `ca_pem` is the list of `tls.setDefaultCACertificates()`, which a server trusts and doesn't announce.
    pub ca_is_default: bool,
    pub crl_pem: Vec<Vec<u8>>,
    pub verify_peer_strict: bool,
    pub verify_hostname: bool,
    pub verify_client: bool,
    pub keylog: bool,
    /// 0-RTT early data (`enableEarlyData`, default on — RFC 8446 §2.3).
    pub enable_early_data: bool,
    pub ciphers: Option<Vec<u8>>,
    pub groups: Option<Vec<u8>>,
}

fn value_to_bytes(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Vec<u8>>> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(None);
    }
    if value.is_string() {
        return Ok(Some(
            bun_core::String::from_js(value, global)?.to_owned_slice(),
        ));
    }
    if let Some(buf) = value.as_array_buffer(global) {
        return Ok(Some(buf.byte_slice().to_vec()));
    }
    Ok(None)
}

/// Each PEM ends with a NUL, for `pem_list`.
fn collect_pem(global: &JSGlobalObject, value: JSValue) -> JsResult<Vec<Vec<u8>>> {
    let mut out = Vec::new();
    if value.is_array() {
        let len = value.get_length(global)? as u32;
        for i in 0..len {
            out.extend(value_to_bytes(global, value.get_index(global, i)?)?);
        }
    } else {
        out.extend(value_to_bytes(global, value)?);
    }
    out.iter_mut().for_each(|pem| pem.push(0));
    Ok(out)
}

/// Returns each CRL of a PEM as its own entry, because `us_ssl_ctx_build_raw` reads one CRL per entry.
fn split_crls(mut pem: &[u8]) -> Vec<Vec<u8>> {
    const BEGIN: &[u8] = b"-----BEGIN X509 CRL-----";
    let mut crls = Vec::new();
    let mut after_begin = bun_core::strings::index_of(pem, BEGIN).unwrap_or(0) + 1;
    while let Some(next) = bun_core::strings::index_of(&pem[after_begin..], BEGIN) {
        let (crl, rest) = pem.split_at(after_begin + next);
        crls.push([crl, b"\0"].concat());
        pem = rest;
        after_begin = 1;
    }
    crls.push(pem.to_vec());
    crls
}

/// The C strings of `collect_pem`'s result, which has to outlive them.
fn pem_list(pems: &[Vec<u8>]) -> Vec<*const c_char> {
    debug_assert!(pems.iter().all(|pem| pem.last() == Some(&0)));
    pems.iter().map(|pem| pem.as_ptr().cast()).collect()
}

/// The TLS 1.3 cipher suites BoringSSL implements (RFC 8446 appendix B.4
/// names).
const TLS13_AES_128_GCM_SHA256: &[u8] = b"TLS_AES_128_GCM_SHA256";
const TLS13_AES_256_GCM_SHA384: &[u8] = b"TLS_AES_256_GCM_SHA384";
const TLS13_CHACHA20_POLY1305_SHA256: &[u8] = b"TLS_CHACHA20_POLY1305_SHA256";

const SSL_COMPLIANCE_POLICY_FIPS_202205: c_int = 1;
const SSL_COMPLIANCE_POLICY_WPA3_192_202304: c_int = 2;

fn tls13_policy_for_ciphers(ciphers: &[u8]) -> Option<c_int> {
    let mut has_128 = false;
    let mut has_256 = false;
    let mut has_chacha = false;
    for name in bun_core::strings::split(ciphers, b":") {
        if name == TLS13_AES_128_GCM_SHA256 {
            has_128 = true;
        } else if name == TLS13_AES_256_GCM_SHA384 {
            has_256 = true;
        } else if name == TLS13_CHACHA20_POLY1305_SHA256 {
            has_chacha = true;
        }
    }
    if has_256 && !has_128 && !has_chacha {
        Some(SSL_COMPLIANCE_POLICY_WPA3_192_202304)
    } else if !has_chacha && (has_128 || has_256) {
        Some(SSL_COMPLIANCE_POLICY_FIPS_202205)
    } else {
        None
    }
}

impl TlsConfig {
    pub(super) fn from_js(
        global: &JSGlobalObject,
        tls: JSValue,
        is_server: bool,
    ) -> JsResult<Self> {
        let mut given = bun_http::ssl_config::Builder::default();
        if tls.is_object()
            && let Some(v) = tls.get(global, "ca")?
        {
            let ca_pem = collect_pem(global, v)?;
            if !ca_pem.is_empty() {
                given.ca = Some(ca_pem.iter().map(|pem| bun_core::dupe_z(pem)).collect());
            }
        }
        let trust = global.bun_vm().tls_config(given, is_server);
        let mut config = TlsConfig {
            is_server,
            alpn: Vec::new(),
            // As in Node: https://github.com/nodejs/node/blob/v26.5.0/src/quic/tlscontext.h#L182
            servername: b"localhost\0".to_vec(),
            certs_pem: Vec::new(),
            keys_pem: Vec::new(),
            ca_pem: trust
                .ca_bytes()
                .map(|certs| certs.map(|cert| [cert, b"\0"].concat()).collect()),
            ca_is_default: trust.ca_is_default,
            crl_pem: Vec::new(),
            verify_peer_strict: false,
            verify_hostname: false,
            verify_client: false,
            keylog: false,
            enable_early_data: true,
            ciphers: None,
            groups: None,
        };
        if !tls.is_object() {
            return Ok(config);
        }
        if let Some(v) = tls.get(global, "alpn")? {
            if let Some(bytes) = value_to_bytes(global, v)? {
                config.alpn = bytes;
            }
        }
        if let Some(v) = tls.get(global, "servername")? {
            let mut bytes = bun_core::String::from_js(v, global)?.to_owned_slice();
            if bun_core::strings::contains_char(&bytes, 0) {
                return Err(global.throw_invalid_arguments(format_args!(
                    "servername must not contain null bytes"
                )));
            }
            bytes.push(0);
            config.servername = bytes;
        }
        if let Some(v) = tls.get(global, "certs")? {
            config.certs_pem = collect_pem(global, v)?;
        }
        if let Some(v) = tls.get(global, "keys")? {
            config.keys_pem = collect_pem(global, v)?;
        }
        if let Some(v) = tls.get(global, "crl")? {
            config.crl_pem = collect_pem(global, v)?
                .iter()
                .flat_map(|pem| split_crls(pem))
                .collect();
        }
        if let Some(v) = tls.get(global, "verifyPeerStrict")? {
            config.verify_peer_strict = v.to_boolean();
        }
        if let Some(v) = tls.get(global, "verifyHostname")? {
            config.verify_hostname = v.to_boolean();
        }
        if let Some(v) = tls.get(global, "verifyClient")? {
            config.verify_client = v.to_boolean();
        }
        if let Some(v) = tls.get(global, "keylog")? {
            config.keylog = v.to_boolean();
        }
        if let Some(v) = tls.get(global, "enableEarlyData")? {
            config.enable_early_data = v.to_boolean();
        }
        if let Some(v) = tls.get(global, "ciphers")? {
            config.ciphers = Some(bun_core::String::from_js(v, global)?.to_owned_slice());
        }
        if let Some(v) = tls.get(global, "groups")? {
            let mut bytes = bun_core::String::from_js(v, global)?.to_owned_slice();
            bytes.push(0);
            config.groups = Some(bytes);
        }
        Ok(config)
    }
}

pub(super) fn early_data_info(ssl_ptr: *mut ssl::SSL) -> (bool, bool) {
    const SSL_EARLY_DATA_UNKNOWN: c_int = 0;
    const SSL_EARLY_DATA_DISABLED: c_int = 1;
    const SSL_EARLY_DATA_NO_SESSION_OFFERED: c_int = 5;
    unsafe extern "C" {
        fn SSL_early_data_accepted(ssl: *const ssl::SSL) -> c_int;
        fn SSL_get_early_data_reason(ssl: *const ssl::SSL) -> c_int;
    }
    if ssl_ptr.is_null() {
        return (false, false);
    }
    // SAFETY: `ssl_ptr` is the live SSL for this handshake (caller contract).
    let (accepted, reason) = unsafe {
        (
            SSL_early_data_accepted(ssl_ptr) != 0,
            SSL_get_early_data_reason(ssl_ptr),
        )
    };
    let attempted = accepted
        || !matches!(
            reason,
            SSL_EARLY_DATA_UNKNOWN | SSL_EARLY_DATA_DISABLED | SSL_EARLY_DATA_NO_SESSION_OFFERED
        );
    (attempted, accepted)
}

/// lsquic borrows the raw pointer; this struct owns it.
pub(super) struct TlsContext {
    ctx: ssl::OwnedSslCtx,
    /// Keep the wire-format ALPN alive at a stable heap address: BoringSSL
    /// stores the `arg` pointer we pass to `SSL_CTX_set_alpn_select_cb` and
    /// the callback dereferences it on every ClientHello.
    #[expect(
        clippy::box_collection,
        reason = "BoringSSL keeps the `arg` pointer (this Vec's header address) across ClientHellos, so the Vec must not move; the Box pins it"
    )]
    _alpn: Option<Box<Vec<u8>>>,
}

/// Returns the session of the lsquic conn that owns `ssl`, which must be live.
unsafe fn session_of<'a>(ssl: *const ssl::SSL) -> Option<&'a super::session::QuicSession> {
    // SAFETY: lsquic keeps the SSL -> conn link for as long as the SSL lives.
    let conn = unsafe { bun_lsquic_sys::lsquic_ssl_to_conn(ssl.cast()) };
    if conn.is_null() {
        return None;
    }
    // SAFETY: `conn` is live, and its ctx is its session or null (`ctx_ref`).
    unsafe { super::ffi::ctx_ref(bun_lsquic_sys::lsquic_conn_get_ctx(conn)) }
}

unsafe extern "C" fn keylog_cb(ssl: *const ssl::SSL, line: *const core::ffi::c_char) {
    if line.is_null() {
        return;
    }
    // SAFETY: BoringSSL passes the SSL of the handshake that made the line.
    let Some(session) = (unsafe { session_of(ssl) }) else {
        return;
    };
    // SAFETY: BoringSSL passes a NUL-terminated line that is valid for this callback.
    let bytes = unsafe { core::ffi::CStr::from_ptr(line).to_bytes().to_vec() };
    session.push_event(super::session::SessionEvent::Keylog(bytes));
}

/// BoringSSL calls this once it has parsed a server handshake's ClientHello.
unsafe extern "C" fn client_hello_cb(hello: *const ssl::SSL_CLIENT_HELLO) -> c_int {
    // SAFETY: BoringSSL passes a live ClientHello, and `ssl` is the SSL of its handshake.
    if let Some(session) = unsafe { session_of((*hello).ssl) } {
        session.on_client_hello();
    }
    ssl::ssl_select_cert_success
}

unsafe extern "C" fn alpn_select_cb(
    _ssl: *mut ssl::SSL,
    out: *mut *const u8,
    outlen: *mut u8,
    inbuf: *const u8,
    inlen: u32,
    arg: *mut core::ffi::c_void,
) -> c_int {
    if arg.is_null() {
        return ssl::SSL_TLSEXT_ERR_NOACK;
    }
    // SAFETY: non-null `arg` is the Vec<u8> the context owns and keeps alive for
    // the SSL_CTX's life; `inbuf[..inlen]` is the client's wire-format ALPN
    // list, valid for this callback.
    unsafe {
        let server: &Vec<u8> = &*arg.cast::<Vec<u8>>();
        if ssl::SSL_select_next_proto(
            out.cast_mut().cast(),
            outlen,
            server.as_ptr(),
            server.len() as u32,
            inbuf,
            inlen,
        ) == ssl::OPENSSL_NPN_NEGOTIATED
        {
            ssl::SSL_TLSEXT_ERR_OK
        } else {
            ssl::SSL_TLSEXT_ERR_ALERT_FATAL
        }
    }
}

impl TlsContext {
    /// Throws what Node throws: https://github.com/nodejs/node/blob/v26.5.0/src/quic/endpoint.cc#L1198-L1203
    pub(super) fn new(global: &JSGlobalObject, config: &TlsConfig) -> JsResult<Self> {
        Self::build(config).map_err(|reason| {
            global
                .err(
                    bun_jsc::ErrorCode::INVALID_STATE,
                    format_args!("Failed to create TLS context: {reason}"),
                )
                .throw()
        })
    }

    fn build(config: &TlsConfig) -> Result<Self, &'static str> {
        let [cert, key, crl] =
            [&config.certs_pem, &config.keys_pem, &config.crl_pem].map(|pems| pem_list(pems));
        let ca = config.ca_pem.as_deref().map(pem_list);
        let mut err = uws::create_bun_socket_error_t::none;
        let Some(owned) = (uws::SocketContext::BunSocketContextOptions {
            cert: cert.as_ptr(),
            cert_count: cert.len() as u32,
            key: key.as_ptr(),
            key_count: key.len() as u32,
            ca: ca.as_ref().map_or(core::ptr::null(), |list| list.as_ptr()),
            ca_count: ca.as_ref().map_or(0, |list| list.len() as u32),
            ca_is_default: i32::from(config.ca_is_default),
            crl: crl.as_ptr(),
            crl_count: crl.len() as u32,
            ssl_min_version: ssl::TLS1_3_VERSION.into(),
            ssl_max_version: ssl::TLS1_3_VERSION.into(),
            ..Default::default()
        })
        .create_ssl_context(&mut err) else {
            // Without a message of its own, the reason is BoringSSL's.
            let reason = ssl::ERR_reason_error_string(ssl::ERR_get_error());
            ssl::ERR_clear_error();
            let reason: &[u8] = match err.message() {
                Some(message) => message,
                None if reason.is_null() => b"Invalid certificate or key",
                // SAFETY: BoringSSL's reason strings are static and NUL-terminated.
                None => unsafe { CStr::from_ptr(reason) }.to_bytes(),
            };
            return Err(core::str::from_utf8(reason).unwrap_or_default());
        };
        let ctx = owned.as_ptr();
        let mut this = TlsContext {
            ctx: owned,
            _alpn: None,
        };
        // SAFETY: `ctx` is live and nothing else has it yet. The pointers it's given are NUL-terminated or come with a length.
        unsafe {
            if let Some(policy) = config.ciphers.as_deref().and_then(tls13_policy_for_ciphers) {
                // A policy also sets the versions and the signature algorithms.
                if ssl::SSL_CTX_set_compliance_policy(ctx, policy) != 1
                    || ssl::SSL_CTX_set_min_proto_version(ctx, ssl::TLS1_3_VERSION) != 1
                    || ssl::SSL_CTX_set_max_proto_version(ctx, ssl::TLS1_3_VERSION) != 1
                    || us_ssl_ctx_set_verify_signature_algorithms(ctx) != 1
                {
                    return Err("failed to apply cipher policy");
                }
            }
            if let Some(groups) = &config.groups {
                if ssl::SSL_CTX_set1_groups_list(ctx, groups.as_ptr().cast()) != 1 {
                    return Err("invalid TLS groups list");
                }
            }

            ssl::SSL_CTX_set_early_data_enabled(ctx, config.enable_early_data as c_int);
            if config.keylog {
                ssl::SSL_CTX_set_keylog_callback(ctx, Some(keylog_cb));
            }
            if config.is_server {
                ssl::SSL_CTX_set_select_certificate_cb(ctx, Some(client_hello_cb));
                if config.verify_client {
                    // SSL_VERIFY_PEER alone matches Node's TLS 1.3 semantics (see QuicSession::maybe_report_handshake).
                    ssl::SSL_CTX_set_verify(ctx, ssl::SSL_VERIFY_PEER, None);
                }
                if !config.alpn.is_empty() {
                    let alpn = Box::new(config.alpn.clone());
                    // The callback's `arg` is the heap address of the boxed
                    // Vec (stable for the box's life, which is `this`'s).
                    ssl::SSL_CTX_set_alpn_select_cb(
                        ctx,
                        Some(alpn_select_cb),
                        (&raw const *alpn).cast_mut().cast(),
                    );
                    this._alpn = Some(alpn);
                }
            } else {
                if !config.alpn.is_empty()
                    && ssl::SSL_CTX_set_alpn_protos(ctx, config.alpn.as_ptr(), config.alpn.len())
                        != 0
                {
                    return Err("failed to set ALPN protocols");
                }
                let mode = if config.verify_peer_strict {
                    ssl::SSL_VERIFY_PEER
                } else {
                    ssl::SSL_VERIFY_NONE
                };
                ssl::SSL_CTX_set_verify(ctx, mode, None);
                if config.verify_hostname {
                    let host = &config.servername[..config.servername.len() - 1];
                    if host.is_empty() {
                        return Err("verifyHostname requires a non-empty servername");
                    }
                    let param = ssl::SSL_CTX_get0_param(ctx);
                    // BoringSSL's set1_host only matches DNS SANs. OpenSSL's SSL_set1_host, which Node calls, tries an IP first.
                    let bound = match bun_core::ip_address::parse_strict(host) {
                        Some(IpAddr::V4(ip)) => {
                            ssl::X509_VERIFY_PARAM_set1_ip(param, ip.octets().as_ptr(), 4)
                        }
                        Some(IpAddr::V6(ip)) => {
                            ssl::X509_VERIFY_PARAM_set1_ip(param, ip.octets().as_ptr(), 16)
                        }
                        None => ssl::X509_VERIFY_PARAM_set1_host(
                            param,
                            host.as_ptr().cast(),
                            host.len(),
                        ),
                    };
                    if bound != 1 {
                        return Err("failed to bind hostname for certificate verification");
                    }
                }
            }

            ssl::ERR_clear_error();
            Ok(this)
        }
    }

    pub(super) fn raw(&self) -> *mut ssl::SSL_CTX {
        self.ctx.as_ptr()
    }
}

pub(super) fn negotiated_alpn(ssl: *mut ssl::SSL) -> Option<Vec<u8>> {
    if ssl.is_null() {
        return None;
    }
    let mut data: *const u8 = core::ptr::null();
    let mut len: u32 = 0;
    // SAFETY: lsquic guarantees the SSL outlives the conn.
    unsafe {
        ssl::SSL_get0_alpn_selected(
            ssl,
            core::ptr::from_mut(&mut data),
            core::ptr::from_mut(&mut len),
        )
    };
    if data.is_null() || len == 0 {
        return None;
    }
    // SAFETY: BoringSSL guarantees `data[..len]` is valid until the SSL is
    // freed.
    Some(unsafe { core::slice::from_raw_parts(data, len as usize).to_vec() })
}

unsafe extern "C" {
    /// `X509_V_ERR_*` -> node's code name; see ncrypto.cpp.
    safe fn Bun__X509__validationErrorCode(err: i32) -> *const core::ffi::c_char;
    /// openssl.c: the signature algorithms every other TLS context of Bun accepts from a peer.
    fn us_ssl_ctx_set_verify_signature_algorithms(ctx: *mut ssl::SSL_CTX) -> c_int;
}

/// node's `X509_V_ERR_UNSPECIFIED`, reported when a peer sent no certificate
/// at all (`verifyPeerCertificate()` nullopt -> `value_or`).
pub(super) const X509_V_ERR_UNSPECIFIED: i32 = 1;

/// The `(code name, reason)` pair node reports as
/// `validationErrorCode` / `validationErrorReason`.
pub(super) fn validation_error_strings(code: i32) -> (&'static str, &'static str) {
    let name = Bun__X509__validationErrorCode(code);
    let name = if name.is_null() {
        "UNSPECIFIED"
    } else {
        // SAFETY: every arm of the C++ switch returns a string literal.
        unsafe {
            core::ffi::CStr::from_ptr(name)
                .to_str()
                .unwrap_or("UNSPECIFIED")
        }
    };
    let s = ssl::X509_verify_cert_error_string(code as _);
    let reason = if s.is_null() {
        ""
    } else {
        // SAFETY: a static string owned by BoringSSL.
        unsafe { core::ffi::CStr::from_ptr(s).to_str().unwrap_or("") }
    };
    (name, reason)
}

pub(super) fn validation_error(ssl: *mut ssl::SSL) -> Option<(&'static str, &'static str)> {
    if ssl.is_null() {
        return None;
    }
    // SAFETY: as above.
    let code = unsafe { ssl::SSL_get_verify_result(ssl) };
    if code == 0 {
        return None;
    }
    Some(validation_error_strings(code as i32))
}

pub(super) fn ephemeral_key_info(
    ssl: *mut ssl::SSL,
) -> Option<(&'static str, Option<&'static str>, u32)> {
    if ssl.is_null() {
        return None;
    }
    // SAFETY: as above.
    let group = unsafe { ssl::SSL_get_group_id(ssl) };
    if group == 0 {
        return None;
    }
    let name_ptr = ssl::SSL_get_group_name(group);
    let name = if name_ptr.is_null() {
        None
    } else {
        // SAFETY: a static string owned by BoringSSL.
        unsafe { core::ffi::CStr::from_ptr(name_ptr).to_str().ok() }
    };
    // Named-group sizes (RFC 8446 §4.2.7 / Node's GetEphemeralKey).
    let bits = match group {
        ssl::SSL_GROUP_X25519 => 253,
        ssl::SSL_GROUP_X448 => 448,
        ssl::SSL_GROUP_SECP256R1 => 256,
        ssl::SSL_GROUP_SECP384R1 => 384,
        ssl::SSL_GROUP_SECP521R1 => 521,
        _ => 0,
    };
    Some(("ECDH", name, bits))
}

pub(super) fn local_certificate_der(ssl: *mut ssl::SSL) -> Option<Vec<u8>> {
    if ssl.is_null() {
        return None;
    }
    // The context parses its leaf once, but `SSL_get_certificate` parses a copy for each SSL.
    // SAFETY: returns a borrowed X509 owned by `ssl`'s context.
    let cert = unsafe { ssl::SSL_CTX_get0_certificate(ssl::SSL_get_SSL_CTX(ssl)) };
    if cert.is_null() {
        return None;
    }
    let mut der: *mut u8 = null_mut();
    // SAFETY: cert is live; i2d allocates.
    let len = unsafe { ssl::i2d_X509(cert, core::ptr::from_mut(&mut der)) };
    if len <= 0 || der.is_null() {
        return None;
    }
    // SAFETY: i2d allocated `der[..len]`.
    let bytes = unsafe { core::slice::from_raw_parts(der, len as usize).to_vec() };
    // SAFETY: i2d's allocation is freed with OPENSSL_free.
    unsafe { ssl::OPENSSL_free(der.cast()) };
    Some(bytes)
}

pub(super) fn peer_certificate_der(ssl_ptr: *mut ssl::SSL) -> Option<Vec<u8>> {
    if ssl_ptr.is_null() {
        return None;
    }
    // SAFETY: `ssl_ptr` is non-null (checked above) and live for this call;
    // SSL_get_peer_certificate returns an owned +1 X509 reference we release
    // below.
    unsafe {
        let cert = ssl::SSL_get_peer_certificate(ssl_ptr);
        if cert.is_null() {
            return None;
        }
        let mut der: *mut u8 = null_mut();
        let len = ssl::i2d_X509(cert, core::ptr::from_mut(&mut der));
        let result = if len > 0 && !der.is_null() {
            let bytes = core::slice::from_raw_parts(der, len as usize).to_vec();
            ssl::OPENSSL_free(der.cast());
            Some(bytes)
        } else {
            None
        };
        ssl::X509_free(cert);
        result
    }
}

pub(super) fn leaf_certificate_der(stack: *mut core::ffi::c_void) -> Option<Vec<u8>> {
    if stack.is_null() {
        return None;
    }
    // SAFETY: lsquic returns a STACK_OF(X509)* the caller must free; the
    // leaf is at index 0.
    unsafe {
        let cert = ssl::sk_X509_value(stack.cast(), 0);
        let result = if cert.is_null() {
            None
        } else {
            let mut der: *mut u8 = null_mut();
            let len = ssl::i2d_X509(cert, core::ptr::from_mut(&mut der));
            if len > 0 && !der.is_null() {
                let bytes = core::slice::from_raw_parts(der, len as usize).to_vec();
                ssl::OPENSSL_free(der.cast());
                Some(bytes)
            } else {
                None
            }
        };
        ssl::sk_X509_pop_free(stack.cast());
        result
    }
}
