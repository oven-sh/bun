//! SSL_CTX construction from options, verify errors, default CA store,
//! pending session/keylog queues, raw tap, tls_feed plumbing, adopt_tls.
//! Implements docs/tls.md §7 (Context/options) + Appendix A.1-A.4.
//! `BunSocketContextOptions` layout FROZEN (memcpy-shared with
//! `uWS::SocketContextOptions` — docs/cabi.md §3.7).

use core::ffi::{CStr, c_char, c_int, c_long, c_void};
use core::ptr;

use crate::tls::SSL;
use crate::unsafe_core::bssl;

pub use crate::unsafe_core::bssl::{Pkcs12Pem, parse_pkcs12};
// Consumed by state.rs / sni.rs.
#[allow(unused_imports)]
pub(crate) use crate::unsafe_core::bssl::{
    RenegState, SniSuspension, reneg_policy, reneg_state_ptr, set_reneg_policy, sni_is_waiting,
    sni_set, sni_take,
};

/// BoringSSL `SSL_CTX`, from the pre-generated bssl-sys bindings (see
/// src/bssl/bindings/README.md and docs/tls.md PART 2). Kept under the frozen
/// `SslCtx` name; all access goes through `unsafe_core::bssl`.
pub type SslCtx = bun_bssl::SSL_CTX;

/// Parked-payload caps: a serialized SSL_SESSION (i2d) and one keylog line.
/// Oversize entries are dropped at the parking site (openssl.c:233-236).
pub const US_SSL_PENDING_SESSION_MAX: usize = 65536;
pub const US_SSL_PENDING_KEYLOG_LINE_MAX: usize = 4096;
/// `US_SSL_FATAL_ERROR_REASON_MAX` (openssl.c:66-69).
pub const US_SSL_FATAL_ERROR_REASON_MAX: usize = 256;

/// `enum create_bun_socket_error_t` (0..4) — out-param of ctx construction.
#[repr(C)]
#[derive(Clone, Copy, Eq, PartialEq, Debug)]
pub enum create_bun_socket_error_t {
    none = 0,
    load_ca_file,
    invalid_ca_file,
    invalid_ca,
    invalid_ciphers,
}

impl create_bun_socket_error_t {
    pub fn message(self) -> Option<&'static [u8]> {
        match self {
            Self::none => None,
            Self::load_ca_file => Some(b"Failed to load CA file"),
            Self::invalid_ca_file => Some(b"Invalid CA file"),
            Self::invalid_ca => Some(b"Invalid CA"),
            Self::invalid_ciphers => Some(b"Invalid ciphers"),
        }
    }
}

/// `struct us_bun_verify_error_t` — TLS handshake verification result, BY
/// VALUE across the ABI. Only `code` is static; `reason` may point into the
/// parked `FatalReason` (docs/tls.md §3.4) — copy it before the callback returns.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct us_bun_verify_error_t {
    pub error_no: core::ffi::c_int,
    pub code: *const c_char,
    pub reason: *const c_char,
}

impl Default for us_bun_verify_error_t {
    fn default() -> Self {
        Self {
            error_no: 0,
            code: ptr::null(),
            reason: ptr::null(),
        }
    }
}

impl us_bun_verify_error_t {
    /// Borrow `code` as a `CStr`, or `None` if null.
    #[inline]
    pub fn code(&self) -> Option<&core::ffi::CStr> {
        bssl::cstr_opt(self.code)
    }

    /// Borrow `reason` as a `CStr`, or `None` if null.
    #[inline]
    pub fn reason(&self) -> Option<&core::ffi::CStr> {
        bssl::cstr_opt(self.reason)
    }

    /// `code` as bytes (no NUL), or `b""` if null.
    #[inline]
    pub fn code_bytes(&self) -> &[u8] {
        self.code().map_or(b"", core::ffi::CStr::to_bytes)
    }

    /// `reason` as bytes (no NUL), or `b""` if null.
    #[inline]
    pub fn reason_bytes(&self) -> &[u8] {
        self.reason().map_or(b"", core::ffi::CStr::to_bytes)
    }

    /// `us_ssl_socket_verify_error_from_ssl` (openssl.c:1432-1440): default
    /// UNABLE_TO_GET_ISSUER_CERT when no peer cert, with the PSK / TLS1.3-
    /// resumption exemptions; `error == 0` ⇒ code/reason null.
    pub fn from_ssl(ssl: *const SSL) -> Self {
        let err = bssl::verify_peer_certificate(ssl, bssl::X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT);
        if err == bssl::X509_V_OK {
            return Self::default();
        }
        Self {
            error_no: err as c_int,
            code: x509_error_code(err).as_ptr(),
            reason: bssl::verify_error_string(err),
        }
    }

    /// Close-before-established variant (openssl.c:1517-1520).
    pub fn econnreset() -> Self {
        Self {
            error_no: -46,
            code: c"ECONNRESET".as_ptr(),
            reason:
                c"Client network socket disconnected before secure TLS connection was established"
                    .as_ptr(),
        }
    }

    /// Parked fatal-reason variant (openssl.c:1489-1491). `reason` borrows
    /// the caller's stack copy of the parked reason; the caller dispatches
    /// before releasing it (§3.4).
    pub fn eproto(reason: *const c_char) -> Self {
        Self {
            error_no: -71,
            code: c"EPROTO".as_ptr(),
            reason,
        }
    }
}

/// `us_X509_error_code` (openssl.c:1376-1411): symbolic name for an
/// X509_V_ERR (values from vendor x509.h), else "UNSPECIFIED".
pub fn x509_error_code(err: c_long) -> &'static CStr {
    match err {
        2 => c"UNABLE_TO_GET_ISSUER_CERT",
        3 => c"UNABLE_TO_GET_CRL",
        4 => c"UNABLE_TO_DECRYPT_CERT_SIGNATURE",
        5 => c"UNABLE_TO_DECRYPT_CRL_SIGNATURE",
        6 => c"UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
        7 => c"CERT_SIGNATURE_FAILURE",
        8 => c"CRL_SIGNATURE_FAILURE",
        9 => c"CERT_NOT_YET_VALID",
        10 => c"CERT_HAS_EXPIRED",
        11 => c"CRL_NOT_YET_VALID",
        12 => c"CRL_HAS_EXPIRED",
        13 => c"ERROR_IN_CERT_NOT_BEFORE_FIELD",
        14 => c"ERROR_IN_CERT_NOT_AFTER_FIELD",
        15 => c"ERROR_IN_CRL_LAST_UPDATE_FIELD",
        16 => c"ERROR_IN_CRL_NEXT_UPDATE_FIELD",
        17 => c"OUT_OF_MEM",
        18 => c"DEPTH_ZERO_SELF_SIGNED_CERT",
        19 => c"SELF_SIGNED_CERT_IN_CHAIN",
        20 => c"UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        21 => c"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        22 => c"CERT_CHAIN_TOO_LONG",
        23 => c"CERT_REVOKED",
        24 => c"INVALID_CA",
        25 => c"PATH_LENGTH_EXCEEDED",
        26 => c"INVALID_PURPOSE",
        27 => c"CERT_UNTRUSTED",
        28 => c"CERT_REJECTED",
        62 => c"HOSTNAME_MISMATCH",
        _ => c"UNSPECIFIED",
    }
}

/// `us_bun_socket_context_options_t` — 20 fields, layout FROZEN (passed BY
/// VALUE to ctx builders; memcpy'd onto `uWS::SocketContextOptions`).
/// sessionTimeout/ticketKeys stay unplumbed (C parity — docs/tls.md §Resolved design notes).
#[repr(C)]
#[derive(Clone, Copy)]
pub struct BunSocketContextOptions {
    pub key_file_name: *const c_char,
    pub cert_file_name: *const c_char,
    pub passphrase: *const c_char,
    pub dh_params_file_name: *const c_char,
    pub ca_file_name: *const c_char,
    pub ssl_ciphers: *const c_char,
    pub ssl_prefer_low_memory_usage: i32,
    pub key: *const *const c_char,
    pub key_count: u32,
    pub cert: *const *const c_char,
    pub cert_count: u32,
    pub ca: *const *const c_char,
    pub ca_count: u32,
    pub secure_options: u32,
    pub ssl_min_version: i32,
    pub ssl_max_version: i32,
    pub reject_unauthorized: i32,
    pub request_cert: i32,
    pub client_renegotiation_limit: u32,
    pub client_renegotiation_window: u32,
}

impl Default for BunSocketContextOptions {
    fn default() -> Self {
        Self {
            key_file_name: ptr::null(),
            cert_file_name: ptr::null(),
            passphrase: ptr::null(),
            dh_params_file_name: ptr::null(),
            ca_file_name: ptr::null(),
            ssl_ciphers: ptr::null(),
            ssl_prefer_low_memory_usage: 0,
            key: ptr::null(),
            key_count: 0,
            cert: ptr::null(),
            cert_count: 0,
            ca: ptr::null(),
            ca_count: 0,
            secure_options: 0,
            ssl_min_version: 0,
            ssl_max_version: 0,
            reject_unauthorized: 0,
            request_cert: 0,
            client_renegotiation_limit: 3,
            client_renegotiation_window: 600,
        }
    }
}

impl BunSocketContextOptions {
    /// Build a BoringSSL `SSL_CTX*`. Caller owns one ref (release with
    /// `SSL_CTX_free`); the passphrase is freed inside once key load
    /// completes. Mode-neutral: client verify override is applied per-SSL at
    /// attach (docs/tls.md §7).
    // Options pass BY VALUE across the frozen ABI (docs/cabi.md §3.7).
    #[allow(clippy::large_types_passed_by_value)]
    pub fn create_ssl_context(self, err: &mut create_bun_socket_error_t) -> Option<*mut SslCtx> {
        let ctx = ssl_ctx_from_options(self, err);
        if ctx.is_null() { None } else { Some(ctx) }
    }

    /// Content-addressed SHA-256 over all fields (file-backed fields fed
    /// path + mtime/size) — the SSLContextCache key (docs/tls.md A.2).
    pub fn digest(&self) -> [u8; 32] {
        let mut h = bssl::Sha256::init();

        // Presence byte so null ≠ ""; terminator so {a:"xy"} ≠ {a:"x",b:"y"}.
        let feed_z = |h: &mut bssl::Sha256, s: *const c_char| {
            h.update(&[(!s.is_null()) as u8]);
            if let Some(c) = bssl::cstr_opt(s) {
                h.update(c.to_bytes());
            }
            h.update(&[0]);
        };

        let feed_arr = |h: &mut bssl::Sha256, arr: *const *const c_char, n: u32| {
            h.update(&[(!arr.is_null()) as u8]);
            h.update(&n.to_ne_bytes());
            for &s in bssl::ptr_array(arr, n as usize) {
                h.update(&[(!s.is_null()) as u8]);
                if let Some(c) = bssl::cstr_opt(s) {
                    h.update(c.to_bytes());
                }
                h.update(&[0]);
            }
            h.update(&[0]);
        };

        // File-backed fields also feed [mtime_sec, mtime_nsec, size] so an
        // in-place cert rotation invalidates. Stat failure feeds zeros AND
        // ctx construction fails on the same path — the entry never caches.
        let feed_path = |h: &mut bssl::Sha256, s: *const c_char| {
            h.update(&[(!s.is_null()) as u8]);
            if let Some(path) = bssl::cstr_opt(s) {
                h.update(path.to_bytes());
                let mut meta: [i64; 3] = [0; 3];
                if !path.to_bytes().is_empty() {
                    if let Some(m) = bssl::stat_for_digest(path) {
                        meta = m;
                    }
                }
                for v in meta {
                    h.update(&v.to_ne_bytes());
                }
            }
            h.update(&[0]);
        };

        feed_path(&mut h, self.key_file_name);
        feed_path(&mut h, self.cert_file_name);
        feed_z(&mut h, self.passphrase);
        feed_path(&mut h, self.dh_params_file_name);
        feed_path(&mut h, self.ca_file_name);
        feed_z(&mut h, self.ssl_ciphers);
        h.update(&self.ssl_prefer_low_memory_usage.to_ne_bytes());
        feed_arr(&mut h, self.key, self.key_count);
        feed_arr(&mut h, self.cert, self.cert_count);
        feed_arr(&mut h, self.ca, self.ca_count);
        h.update(&self.secure_options.to_ne_bytes());
        h.update(&self.ssl_min_version.to_ne_bytes());
        h.update(&self.ssl_max_version.to_ne_bytes());
        h.update(&self.reject_unauthorized.to_ne_bytes());
        h.update(&self.request_cert.to_ne_bytes());
        h.update(&self.client_renegotiation_limit.to_ne_bytes());
        h.update(&self.client_renegotiation_window.to_ne_bytes());
        h.finish()
    }

    /// Best-effort byte count of cert/key/CA material (memoryCost feed).
    pub fn approx_cert_bytes(&self) -> usize {
        let sum = |arr: *const *const c_char, count: u32| -> usize {
            bssl::ptr_array(arr, count as usize)
                .iter()
                .filter_map(|&s| bssl::cstr_opt(s))
                .map(|c| c.to_bytes().len())
                .sum()
        };
        sum(self.key, self.key_count)
            + sum(self.cert, self.cert_count)
            + sum(self.ca, self.ca_count)
    }
}

// ── ctx-level API (native successors of the us_ssl_* externs) ────────────────

/// `us_ssl_ctx_from_options` — `build_raw` + the packed reneg policy ex_data
/// (openssl.c:1234-1257); caller owns one ref.
#[allow(clippy::large_types_passed_by_value)]
pub fn ssl_ctx_from_options(
    options: BunSocketContextOptions,
    err: &mut create_bun_socket_error_t,
) -> *mut SslCtx {
    let ctx = ssl_ctx_build_raw(options, err);
    if ctx.is_null() {
        return ctx;
    }
    if options.client_renegotiation_limit != 0 || options.client_renegotiation_window != 0 {
        bssl::set_reneg_policy(
            ctx,
            options.client_renegotiation_limit,
            options.client_renegotiation_window,
        );
    }
    ctx
}

/// `us_ssl_ctx_build_raw` (openssl.c:893-1088) — also exported for quic.c
/// (lsquic sets ALPN/transport params itself). Application order is
/// normative (docs/tls.md §7.1). Failures beyond the four `err` codes
/// return null with the reason left on the OpenSSL error queue.
#[allow(clippy::large_types_passed_by_value)]
pub fn ssl_ctx_build_raw(
    options: BunSocketContextOptions,
    err: &mut create_bun_socket_error_t,
) -> *mut SslCtx {
    bssl::err_clear_error();

    let ctx = bssl::ssl_ctx_new_base();
    if ctx.is_null() {
        return ptr::null_mut();
    }
    // `ssl_ctx_build_fail`: drop passphrase + free (ex_data live-count slot
    // is already registered, so the free_func balances the counter).
    fn fail(ctx: *mut SslCtx) -> *mut SslCtx {
        bssl::ctx_drop_passphrase(ctx);
        bssl::ssl_ctx_free(ctx);
        ptr::null_mut()
    }

    // Default floor TLS1.2 when no minimum requested; max only when nonzero.
    bssl::ctx_set_min_proto_version(
        ctx,
        if options.ssl_min_version != 0 {
            options.ssl_min_version as u16
        } else {
            bssl::TLS1_2_VERSION
        },
    );
    if options.ssl_max_version != 0 {
        bssl::ctx_set_max_proto_version(ctx, options.ssl_max_version as u16);
    }

    if options.ssl_prefer_low_memory_usage != 0 {
        bssl::ctx_set_release_buffers_mode(ctx);
    }

    if let Some(pass) = bssl::cstr_opt(options.passphrase) {
        bssl::ctx_set_passphrase(ctx, pass);
    }

    // Multiple identities (RSA + EC pairs) load PAIR-WISE: certs-then-keys
    // would fail KEY_TYPE_MISMATCH on mixed configurations (openssl.c:926-936).
    let certs = bssl::ptr_array(options.cert, options.cert_count as usize);
    let keys = bssl::ptr_array(options.key, options.key_count as usize);
    let interleave_identities = options.cert_file_name.is_null()
        && options.key_file_name.is_null()
        && !options.cert.is_null()
        && !options.key.is_null()
        && options.cert_count == options.key_count
        && options.cert_count > 1;
    let load_cert = |c: *const c_char| {
        bssl::cstr_opt(c).is_some_and(|c| bssl::ctx_use_certificate_chain_content(ctx, c))
    };
    let load_key = |k: *const c_char| {
        bssl::cstr_opt(k).is_some_and(|k| bssl::ctx_use_privatekey_content(ctx, k, true))
    };
    if interleave_identities {
        for (&c, &k) in certs.iter().zip(keys) {
            if !load_cert(c) || !load_key(k) {
                return fail(ctx);
            }
        }
    } else {
        if let Some(file) = bssl::cstr_opt(options.cert_file_name) {
            if !bssl::ctx_use_certificate_chain_file(ctx, file) {
                return fail(ctx);
            }
        } else if !certs.is_empty() {
            for &c in certs {
                if !load_cert(c) {
                    return fail(ctx);
                }
            }
        }
        if let Some(file) = bssl::cstr_opt(options.key_file_name) {
            if !bssl::ctx_use_privatekey_file(ctx, file) {
                return fail(ctx);
            }
        } else if !keys.is_empty() {
            for &k in keys {
                if !load_key(k) {
                    return fail(ctx);
                }
            }
        }
    }
    // The passwd_cb was only consulted by the key loads above; drop the
    // secret now so plain SSL_CTX_free is sufficient everywhere downstream.
    bssl::ctx_drop_passphrase(ctx);

    let verify_mode = if options.reject_unauthorized != 0 {
        bssl::SSL_VERIFY_PEER | bssl::SSL_VERIFY_FAIL_IF_NO_PEER_CERT
    } else {
        bssl::SSL_VERIFY_PEER
    };
    if let Some(ca_file) = bssl::cstr_opt(options.ca_file_name) {
        // Explicit CA REPLACES default trust (Node semantics): load into the
        // fresh empty store from SSL_CTX_new.
        if !bssl::ctx_load_client_ca_file(ctx, ca_file) {
            *err = create_bun_socket_error_t::load_ca_file;
            return fail(ctx);
        }
        mark_ctx_user_ca(ctx);
        if !bssl::ctx_load_verify_locations(ctx, ca_file) {
            *err = create_bun_socket_error_t::invalid_ca_file;
            return fail(ctx);
        }
        bssl::ctx_set_verify(ctx, verify_mode);
    } else if !options.ca.is_null() && options.ca_count > 0 {
        mark_ctx_user_ca(ctx);
        // User CAs only, into the CTX's own initially-empty store — otherwise
        // an mTLS server with `ca: [internalCA]` would also accept any client
        // cert chaining to a public root.
        let cert_store = bssl::ctx_get_cert_store(ctx);
        for &ca in bssl::ptr_array(options.ca, options.ca_count as usize) {
            let ok = bssl::cstr_opt(ca)
                .is_some_and(|ca| bssl::add_ca_cert_to_store(ctx, ca, cert_store));
            if !ok {
                *err = create_bun_socket_error_t::invalid_ca;
                return fail(ctx);
            }
            bssl::err_clear_error();
            bssl::ctx_set_verify(ctx, verify_mode);
        }
    } else if options.request_cert != 0 {
        // Process-shared bundled-roots store (refcounted; ownership of the
        // returned up-ref transfers to the CTX).
        bssl::ctx_set_cert_store(ctx, bssl::shared_default_ca_store());
        bssl::ctx_set_verify(ctx, verify_mode);
    }

    if let Some(dh_file) = bssl::cstr_opt(options.dh_params_file_name) {
        if !bssl::ctx_set_dh_params_from_file(ctx, dh_file) {
            return fail(ctx);
        }
        if !bssl::ctx_set_cipher_list(ctx, bssl::default_ciphers()) {
            return fail(ctx);
        }
    }

    if let Some(ciphers) = bssl::cstr_opt(options.ssl_ciphers) {
        if !bssl::ctx_set_cipher_list(ctx, ciphers) {
            // Peek, don't consume: the Rust caller decomposes the queued
            // reason (NO_CIPHER_MATCH, INVALID_COMMAND) into the JS error.
            if !bssl::cipher_failure_tolerated(ciphers) {
                *err = create_bun_socket_error_t::invalid_ciphers;
                return fail(ctx);
            }
            bssl::err_clear_error();
        }
    }

    if options.secure_options != 0 {
        bssl::ctx_set_secure_options(ctx, options.secure_options);
    }

    bssl::ctx_install_session_callbacks(ctx);
    ctx
}

pub fn ssl_ctx_up_ref(ctx: *mut SslCtx) {
    bssl::ssl_ctx_up_ref(ctx);
}

pub fn ssl_ctx_unref(ctx: *mut SslCtx) {
    bssl::ssl_ctx_free(ctx);
}

/// Process-global live-ctx counter (leak canary in tests). Decremented by the
/// ex_data free_func so it tracks true refcount-zero destruction.
pub fn ssl_ctx_live_count() -> c_long {
    bssl::ssl_ctx_live_count() as c_long
}

/// Append PEM certs to `ctx`'s trust store; 0 when nothing could be added.
/// Clone-on-write (openssl.c:1093-1132): a shared-default or still-empty
/// store is replaced with a fresh FULL default store first, so addCACert
/// EXTENDS default trust (Node's SecureContext::AddCACert).
pub fn ssl_ctx_add_ca_cert(ctx: *mut SslCtx, pem: &core::ffi::CStr) -> i32 {
    if ctx.is_null() {
        return 0;
    }
    let mut store = bssl::ctx_get_cert_store(ctx);
    let shared = bssl::shared_default_ca_store();
    let store_is_shared = !store.is_null() && core::ptr::eq(store, shared);
    // shared_default_ca_store up-refs per return; release the comparison ref.
    bssl::x509_store_free(shared);
    let store_is_empty = !store.is_null() && !store_is_shared && bssl::x509_store_is_empty(store);
    if store_is_shared || store_is_empty {
        let own = bssl::default_ca_store();
        if own.is_null() {
            return 0;
        }
        bssl::ctx_set_cert_store(ctx, own);
        store = own;
    }
    if store.is_null() {
        return 0;
    }
    mark_ctx_user_ca(ctx);
    bssl::add_ca_cert_to_store(ctx, pem, store) as i32
}

/// Bun's default trust store (root_certs.cpp stays C++ — docs/cabi.md §1.7).
/// Fresh full store (bundled + NODE_EXTRA_CA_CERTS + system CAs when
/// enabled); caller owns the returned ref.
pub fn default_ca_store() -> *mut core::ffi::c_void {
    bssl::default_ca_store().cast::<core::ffi::c_void>()
}

/// Process-shared immutable default store — UP-REF'D PER RETURN, caller must
/// release (used by the per-SSL client attach override and `request_cert`).
pub fn shared_default_ca_store() -> *mut core::ffi::c_void {
    bssl::shared_default_ca_store().cast::<core::ffi::c_void>()
}

/// `us_get_default_ciphers`.
pub fn default_ciphers() -> &'static core::ffi::CStr {
    bssl::default_ciphers()
}

// ── CTX/SSL markers + backrefs (ex_data policy, openssl.c:140-185) ──────────

/// Mark the CTX's verification store as holding user-provided CAs: the
/// per-socket client attach must NOT replace such a store with the shared
/// default roots (openssl.c:161-164).
pub(crate) fn mark_ctx_user_ca(ctx: *mut SslCtx) {
    bssl::ctx_set_ex_data(
        ctx,
        bssl::ex_indices().ctx_user_ca,
        ptr::without_provenance_mut(1),
    );
}

pub(crate) fn ctx_has_user_ca(ctx: *const SslCtx) -> bool {
    !bssl::ctx_get_ex_data(ctx, bssl::ex_indices().ctx_user_ca).is_null()
}

/// SSLContextCache tombstone back-pointer; its `CRYPTO_EX_free` is the Rust
/// `bun_ssl_ctx_cache_on_free` (docs/tls.md A.2).
pub fn ctx_cache_set_entry(ctx: *mut SslCtx, entry: *mut c_void) {
    bssl::ctx_set_ex_data(ctx, bssl::ex_indices().ctx_cache, entry);
}

pub fn ctx_cache_entry(ctx: *const SslCtx) -> *mut c_void {
    bssl::ctx_get_ex_data(ctx, bssl::ex_indices().ctx_cache)
}

/// Per-domain SNI userdata stashed on the selected CTX so per-socket lookup
/// works via `SSL_get_SSL_CTX` regardless of which ctx SNI picked.
pub(crate) fn ctx_set_sni_user(ctx: *mut SslCtx, user: *mut c_void) {
    bssl::ctx_set_ex_data(ctx, bssl::ex_indices().sni_user, user);
}

pub(crate) fn ctx_sni_user(ctx: *const SslCtx) -> *mut c_void {
    bssl::ctx_get_ex_data(ctx, bssl::ex_indices().sni_user)
}

/// Accepting-listener backref, stored per-SSL (never as CTX servername arg —
/// the shared CTX can outlive a listener; documented UAF, openssl.c:147-150).
/// Listener teardown MUST wipe this on every accepted socket, including ones
/// parked on the low-prio queue (docs/tls.md §2.6).
pub(crate) fn set_listener_backref(ssl: *mut SSL, listener: *mut c_void) {
    bssl::ssl_set_ex_data(ssl, bssl::ex_indices().listener, listener);
}

pub(crate) fn listener_backref(ssl: *const SSL) -> *mut c_void {
    bssl::ssl_get_ex_data(ssl, bssl::ex_indices().listener)
}

pub(crate) fn clear_listener_backref(ssl: *mut SSL) {
    bssl::ssl_set_ex_data(ssl, bssl::ex_indices().listener, ptr::null_mut());
}

/// Session/keylog opt-in marker for SSLs attached to a real socket
/// (Bun.connect / node:tls only — fetch/serve/postgres/ws never pay session
/// serialization, openssl.c:169-179).
pub(crate) fn mark_session_events_socket(ssl: *mut SSL) {
    bssl::enable_pending_events(ssl);
}

pub(crate) fn session_events_enabled(ssl: *const SSL) -> bool {
    bssl::is_socket_marked(ssl)
}

// ── Pending session/keylog park-then-flush queues (openssl.c:226-439) ───────
// Both callbacks fire from INSIDE SSL_read/SSL_do_handshake; they only
// serialize + park (caps above, wire-order preserved). Flushes happen after
// the SSL stack unwinds (C11) — state.rs dispatches the drained entries at its
// flush points, before delivering data.

/// `us_ssl_enable_pending_events` — non-us_socket owners (SSLWrapper for
/// TLS-over-duplex / named pipes) opt into the parked queues and drain with
/// the pop functions below after their reads unwind.
pub fn enable_pending_events(ssl: *mut SSL) {
    bssl::enable_pending_events(ssl);
}

/// `us_ssl_pop_pending_session`: oldest parked entry into `out`; returns the
/// byte length, 0 when empty. Entries pop in parking order.
pub fn pop_pending_session(ssl: *mut SSL, out: &mut [u8]) -> usize {
    bssl::pop_pending_session(ssl, out)
}

/// `us_ssl_pop_pending_keylog`: line already carries the trailing `\n` Node
/// appends before emitting 'keylog'.
pub fn pop_pending_keylog(ssl: *mut SSL, out: &mut [u8]) -> usize {
    bssl::pop_pending_keylog(ssl, out)
}

/// Drain ALL parked sessions in arrival order for dispatch (each entry is a
/// distinct resumable session and gets its own 'session' event).
pub(crate) fn drain_pending_sessions(ssl: *mut SSL) -> Vec<Box<[u8]>> {
    bssl::drain_pending_sessions(ssl)
}

pub(crate) fn drain_pending_keylog(ssl: *mut SSL) -> Vec<Box<[u8]>> {
    bssl::drain_pending_keylog(ssl)
}
