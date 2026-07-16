use core::ffi::c_int;
use core::ptr::null_mut;

use bun_boringssl_sys as ssl;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc};

pub(super) struct TlsConfig {
    pub is_server: bool,
    pub alpn: Vec<u8>,
    pub servername: Option<Vec<u8>>,
    pub certs_pem: Vec<Vec<u8>>,
    pub keys_pem: Vec<Vec<u8>>,
    pub ca_pem: Vec<Vec<u8>>,
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
            bun_core::String::from_js(value, global)?.to_utf8_bytes(),
        ));
    }
    if let Some(buf) = value.as_array_buffer(global) {
        return Ok(Some(buf.byte_slice().to_vec()));
    }
    Ok(None)
}

fn collect_pem(global: &JSGlobalObject, value: JSValue) -> JsResult<Vec<Vec<u8>>> {
    let mut out = Vec::new();
    if value.is_array() {
        let len = value.get_length(global)? as u32;
        for i in 0..len {
            if let Some(bytes) = value_to_bytes(global, value.get_index(global, i)?)? {
                out.push(bytes);
            }
        }
    } else if let Some(bytes) = value_to_bytes(global, value)? {
        out.push(bytes);
    }
    Ok(out)
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
    for name in ciphers.split(|&b| b == b':') {
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
        let mut config = TlsConfig {
            is_server,
            alpn: Vec::new(),
            servername: None,
            certs_pem: Vec::new(),
            keys_pem: Vec::new(),
            ca_pem: Vec::new(),
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
        if let Some(v) = tls.get(global, "servername")?.filter(|v| v.is_string()) {
            let mut bytes = bun_core::String::from_js(v, global)?.to_utf8_bytes();
            bytes.push(0);
            config.servername = Some(bytes);
        }
        if let Some(v) = tls.get(global, "certs")? {
            config.certs_pem = collect_pem(global, v)?;
        }
        if let Some(v) = tls.get(global, "keys")? {
            config.keys_pem = collect_pem(global, v)?;
        }
        if let Some(v) = tls.get(global, "ca")? {
            config.ca_pem = collect_pem(global, v)?;
        }
        if let Some(v) = tls.get(global, "crl")? {
            config.crl_pem = collect_pem(global, v)?;
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
        if let Some(v) = tls.get(global, "ciphers")?.filter(|v| v.is_string()) {
            config.ciphers = Some(bun_core::String::from_js(v, global)?.to_utf8_bytes());
        }
        if let Some(v) = tls.get(global, "groups")?.filter(|v| v.is_string()) {
            let mut bytes = bun_core::String::from_js(v, global)?.to_utf8_bytes();
            bytes.push(0);
            config.groups = Some(bytes);
        }
        // Node defaults the servername to "localhost" when none is given
        // (node/src/quic/tlscontext.h TLSContext::Options::servername).
        if config.servername.is_none() {
            config.servername = Some(b"localhost\0".to_vec());
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

/// lsquic borrows the raw pointer; this struct owns it and frees it on Drop.
pub(super) struct TlsContext {
    ctx: *mut ssl::SSL_CTX,
    /// Keep the wire-format ALPN alive at a stable heap address: BoringSSL
    /// stores the `arg` pointer we pass to `SSL_CTX_set_alpn_select_cb` and
    /// the callback dereferences it on every ClientHello.
    #[expect(
        clippy::box_collection,
        reason = "BoringSSL keeps the `arg` pointer (this Vec's header address) across ClientHellos, so the Vec must not move; the Box pins it"
    )]
    _alpn: Option<Box<Vec<u8>>>,
}

impl Drop for TlsContext {
    fn drop(&mut self) {
        if !self.ctx.is_null() {
            // SAFETY: `ctx` was created by `SSL_CTX_new` and not freed before.
            unsafe { ssl::SSL_CTX_free(self.ctx) };
        }
    }
}

unsafe extern "C" fn keylog_cb(ssl: *const ssl::SSL, line: *const core::ffi::c_char) {
    if line.is_null() {
        return;
    }
    // SAFETY: `line` is the NUL-terminated NSS key log line BoringSSL
    // guarantees valid for this callback; the SSL → conn → session walk is
    // safe because lsquic owns all three for the SSL's lifetime.
    let bytes = unsafe { core::ffi::CStr::from_ptr(line).to_bytes().to_vec() };
    // SAFETY: lsquic stored the conn on the SSL via SSL_set_app_data — but
    // we can't rely on that index; use lsquic_ssl_to_conn instead.
    let conn = unsafe { bun_lsquic_sys::lsquic_ssl_to_conn(ssl.cast()) };
    if conn.is_null() {
        return;
    }
    // SAFETY: as above.
    let ctx = unsafe { bun_lsquic_sys::lsquic_conn_get_ctx(conn) };
    if ctx.is_null() {
        // SAFETY: peer_ctx is the Rust QuicEndpoint for every conn on it.
        let peer_ctx = unsafe { bun_lsquic_sys::lsquic_conn_get_peer_ctx(conn, core::ptr::null()) };
        if !peer_ctx.is_null() {
            // SAFETY: as above.
            let endpoint = unsafe { &*peer_ctx.cast::<super::endpoint::QuicEndpoint>() };
            let mut local = core::ptr::null();
            let mut peer = core::ptr::null();
            // SAFETY: `conn` is live; out-params point at stack slots.
            let peer_addr = if unsafe {
                bun_lsquic_sys::lsquic_conn_get_sockaddr(
                    conn,
                    core::ptr::from_mut(&mut local),
                    core::ptr::from_mut(&mut peer),
                )
            } == 0
            {
                super::endpoint::stored_addr_from_sockaddr(peer)
            } else {
                return;
            };
            endpoint.buffer_early_keylog(ssl.cast_mut().cast(), peer_addr, bytes);
        }
        return;
    }
    // SAFETY: ctx is the QuicSession (conn-ctx).
    let session = unsafe { &*ctx.cast::<super::session::QuicSession>() };
    session.push_event(super::session::SessionEvent::Keylog(bytes));
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

fn load_cert_chain(ctx: *mut ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    // SAFETY: `pem` is a live slice; the BIO copies what it parses.
    unsafe {
        let bio = ssl::BIO_new_mem_buf(pem.as_ptr().cast(), pem.len() as _);
        if bio.is_null() {
            return Err("failed to allocate BIO for certificate");
        }
        let leaf = ssl::PEM_read_bio_X509_AUX(bio, null_mut(), None, null_mut());
        if leaf.is_null() {
            ssl::BIO_free(bio);
            return Err("failed to parse certificate PEM");
        }
        // `use_certificate` ups the X509's refcount.
        if ssl::SSL_CTX_use_certificate(ctx, leaf) != 1 {
            ssl::X509_free(leaf);
            ssl::BIO_free(bio);
            return Err("failed to install certificate");
        }
        ssl::X509_free(leaf);
        loop {
            let extra = ssl::PEM_read_bio_X509(bio, null_mut(), None, null_mut());
            if extra.is_null() {
                break;
            }
            // `add0_chain_cert` takes ownership (no refcount bump).
            if ssl::SSL_CTX_add0_chain_cert(ctx, extra) != 1 {
                ssl::X509_free(extra);
                ssl::BIO_free(bio);
                return Err("failed to add chain certificate");
            }
        }
        ssl::ERR_clear_error();
        ssl::BIO_free(bio);
    }
    Ok(())
}

fn load_private_key(ctx: *mut ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    // SAFETY: as above.
    unsafe {
        let bio = ssl::BIO_new_mem_buf(pem.as_ptr().cast(), pem.len() as _);
        if bio.is_null() {
            return Err("failed to allocate BIO for key");
        }
        let pkey = ssl::PEM_read_bio_PrivateKey(bio, null_mut(), None, null_mut());
        ssl::BIO_free(bio);
        if pkey.is_null() {
            return Err("failed to parse private key PEM");
        }
        let ok = ssl::SSL_CTX_use_PrivateKey(ctx, pkey);
        ssl::EVP_PKEY_free(pkey);
        if ok != 1 {
            return Err("failed to install private key");
        }
    }
    Ok(())
}

const X509_V_FLAG_CRL_CHECK: core::ffi::c_ulong = 0x4;
/// `X509_V_FLAG_CRL_CHECK_ALL` — also check intermediate CAs (Node sets both).
const X509_V_FLAG_CRL_CHECK_ALL: core::ffi::c_ulong = 0x8;

fn load_crl_store(ctx: *mut ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    // SAFETY: as above.
    unsafe {
        let store = ssl::SSL_CTX_get_cert_store(ctx);
        let bio = ssl::BIO_new_mem_buf(pem.as_ptr().cast(), pem.len() as _);
        if bio.is_null() {
            return Err("failed to allocate BIO for CRL");
        }
        let mut added = 0;
        loop {
            let crl = ssl::PEM_read_bio_X509_CRL(bio, null_mut(), None, null_mut());
            if crl.is_null() {
                break;
            }
            let ok = ssl::X509_STORE_add_crl(store, crl);
            ssl::X509_CRL_free(crl);
            if ok != 1 {
                ssl::ERR_clear_error();
                ssl::BIO_free(bio);
                return Err("failed to add CRL to trust store");
            }
            added += 1;
        }
        ssl::ERR_clear_error();
        ssl::BIO_free(bio);
        if added == 0 {
            return Err("CRL PEM contained no revocation lists");
        }
        ssl::X509_STORE_set_flags(store, X509_V_FLAG_CRL_CHECK | X509_V_FLAG_CRL_CHECK_ALL);
    }
    Ok(())
}

fn load_ca_store(ctx: *mut ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    // SAFETY: as above.
    unsafe {
        let store = ssl::SSL_CTX_get_cert_store(ctx);
        let bio = ssl::BIO_new_mem_buf(pem.as_ptr().cast(), pem.len() as _);
        if bio.is_null() {
            return Err("failed to allocate BIO for CA");
        }
        let mut added = 0;
        loop {
            let cert = ssl::PEM_read_bio_X509(bio, null_mut(), None, null_mut());
            if cert.is_null() {
                break;
            }
            let ok = ssl::X509_STORE_add_cert(store, cert);
            ssl::X509_free(cert);
            if ok != 1 {
                ssl::ERR_clear_error();
                ssl::BIO_free(bio);
                return Err("failed to add CA certificate to trust store");
            }
            added += 1;
        }
        ssl::ERR_clear_error();
        ssl::BIO_free(bio);
        if added == 0 {
            return Err("CA PEM contained no certificates");
        }
    }
    Ok(())
}

impl TlsContext {
    pub(super) fn new(config: &TlsConfig) -> Result<Self, &'static str> {
        // SAFETY: each SSL_CTX call below is paired with the matching free on
        // failure via Drop (the half-built `this` is dropped on early return).
        unsafe {
            let ctx = ssl::SSL_CTX_new(ssl::TLS_method());
            if ctx.is_null() {
                return Err("failed to allocate SSL_CTX");
            }
            let mut this = TlsContext { ctx, _alpn: None };

            if let Some(policy) = config.ciphers.as_deref().and_then(tls13_policy_for_ciphers) {
                if ssl::SSL_CTX_set_compliance_policy(ctx, policy) != 1 {
                    return Err("failed to apply cipher policy");
                }
            }
            if ssl::SSL_CTX_set_min_proto_version(ctx, ssl::TLS1_3_VERSION) != 1
                || ssl::SSL_CTX_set_max_proto_version(ctx, ssl::TLS1_3_VERSION) != 1
            {
                return Err("failed to pin TLS 1.3");
            }
            if let Some(groups) = &config.groups {
                if ssl::SSL_CTX_set1_groups_list(ctx, groups.as_ptr().cast()) != 1 {
                    return Err("invalid TLS groups list");
                }
            }
            if config.ca_pem.is_empty() {
                ssl::SSL_CTX_set_default_verify_paths(ctx);
            }

            // Node pairs `certs[i]` with `keys[i]`.
            for (i, pem) in config.certs_pem.iter().enumerate() {
                if i > 0 {
                    ssl::SSL_CTX_clear_chain_certs(ctx);
                }
                load_cert_chain(ctx, pem)?;
                if let Some(key) = config.keys_pem.get(i) {
                    load_private_key(ctx, key)?;
                }
            }
            if config.certs_pem.is_empty() {
                if let Some(key) = config.keys_pem.first() {
                    load_private_key(ctx, key)?;
                }
            }
            for pem in &config.ca_pem {
                load_ca_store(ctx, pem)?;
            }
            for pem in &config.crl_pem {
                load_crl_store(ctx, pem)?;
            }

            ssl::SSL_CTX_set_early_data_enabled(ctx, config.enable_early_data as c_int);
            if config.keylog {
                ssl::SSL_CTX_set_keylog_callback(ctx, Some(keylog_cb));
            }
            if config.is_server {
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
                    let Some(servername) = &config.servername else {
                        return Err("verifyHostname requires a servername");
                    };
                    let host = servername.strip_suffix(b"\0").unwrap_or(servername);
                    if host.is_empty() {
                        return Err("verifyHostname requires a non-empty servername");
                    }
                    let param = ssl::SSL_CTX_get0_param(ctx);
                    if param.is_null()
                        || ssl::X509_VERIFY_PARAM_set1_host(param, host.as_ptr().cast(), host.len())
                            != 1
                    {
                        return Err("failed to bind hostname for certificate verification");
                    }
                }
            }

            ssl::ERR_clear_error();
            Ok(this)
        }
    }

    pub(super) fn raw(&self) -> *mut ssl::SSL_CTX {
        self.ctx
    }

    pub(super) fn alpn_cstr(config: &TlsConfig) -> Vec<u8> {
        if config.alpn.len() < 2 {
            return Vec::new();
        }
        let n = config.alpn[0] as usize;
        let mut out = config.alpn[1..1 + n.min(config.alpn.len() - 1)].to_vec();
        out.push(0);
        out
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
    fn Bun__X509__validationErrorCode(err: i32) -> *const core::ffi::c_char;
}

/// node's `X509_V_ERR_UNSPECIFIED`, reported when a peer sent no certificate
/// at all (`verifyPeerCertificate()` nullopt -> `value_or`).
pub(super) const X509_V_ERR_UNSPECIFIED: i32 = 1;

/// The `(code name, reason)` pair node reports as
/// `validationErrorCode` / `validationErrorReason`.
pub(super) fn validation_error_strings(code: i32) -> (&'static str, &'static str) {
    // SAFETY: every arm of the C++ switch returns a string literal.
    let name = unsafe { Bun__X509__validationErrorCode(code) };
    let name = if name.is_null() {
        "UNSPECIFIED"
    } else {
        // SAFETY: as above; NUL-terminated and 'static.
        unsafe { core::ffi::CStr::from_ptr(name).to_str().unwrap_or("UNSPECIFIED") }
    };
    // SAFETY: the returned string is a static name owned by BoringSSL.
    let s = unsafe { ssl::X509_verify_cert_error_string(code as _) };
    let reason = if s.is_null() {
        ""
    } else {
        // SAFETY: as above.
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
    // SAFETY: returned string is static.
    let name_ptr = unsafe { ssl::SSL_get_group_name(group) };
    let name = if name_ptr.is_null() {
        None
    } else {
        // SAFETY: as above.
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
    // SAFETY: returns a borrowed X509 owned by the SSL.
    let cert = unsafe { ssl::SSL_get_certificate(ssl) };
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
