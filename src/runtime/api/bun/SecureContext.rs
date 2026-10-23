//! Native backing for `node:tls` `SecureContext`. Owns one BoringSSL
//! `SSL_CTX*`; every `tls.connect`/`upgradeTLS`/`addContext` that names this
//! object passes that pointer to listen/connect/adopt, where `SSL_new()`
//! up-refs it for each socket. Policy (verify mode, reneg limits) is encoded
//! on the SSL_CTX itself in `us_ssl_ctx_from_options`, so the SSL_CTX's own
//! refcount is the only refcount and a socket safely outlives a GC'd
//! SecureContext.
//!
//! `intern()` memoises by config digest at two levels: a `WeakGCMap` on the
//! global (same digest → same `JSSecureContext` while alive) and the per-VM
//! native `SSLContextCache` (same digest → same `SSL_CTX*` regardless of which
//! consumer asked). The "one config, thousands of connections" pattern
//! allocates one of these and one `SSL_CTX` total — `tls.ts` no longer hashes
//! in JS.

use crate::api::SSLContextCache::SSLContextCache;
use crate::crypto::boringssl_jsc::err_to_js;
use crate::socket::SSLConfig;
use crate::socket::ssl_config::ParsedTls;
use crate::socket::uws_jsc::create_bun_socket_error_to_js;
use bun_boringssl_sys as boringssl;
use bun_core::EncodedSlice;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::JsClass as _;
use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal, JsPayload as _, JsScope, JsWrapper};
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_uws as uws;
use core::cell::Cell;

pub(crate) struct SecureContext {
    pub ctx: boringssl::OwnedSslCtx,
    /// `BunSocketContextOptions.digest()` — exactly the fields that reach
    /// `us_ssl_ctx_from_options`. Stored so an `intern()` WeakGCMap hit (keyed by
    /// the low 64 bits) can do a full content-equality check before reusing.
    /// Also `ctx`'s session id context, so `addCACert` folds each added certificate into it.
    pub(crate) digest: Cell<[u8; 32]>,
    /// Approximate cert/key/CA byte length plus the BoringSSL `SSL_CTX` floor
    /// (~50 KB), so the GC can account for the off-heap allocation.
    pub(crate) extra_memory: usize,
    /// True when `ctx` is a digest-interned `SSL_CTX*` shared with other consumers.
    pub(crate) shared: bool,
}

/// Exposed via `bun:internal-for-testing` so churn tests can assert
/// `SSL_CTX_new` was called O(1) times, not O(connections).
#[bun_jsc::host_fn]
pub(crate) fn js_live_count(_global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
    // `us_ssl_ctx_live_count` is declared `safe fn` (reads a global atomic
    // counter, no preconditions).
    Ok(JSValue::js_number(c::us_ssl_ctx_live_count() as f64))
}

impl SecureContext {
    pub(crate) fn constructor(cx: &mut JsScope<'_>, options: JsLocal<'_>) -> JsResult<Self> {
        let global = cx.global();
        let config = Self::config_from_js(global, options.to_js())?;
        SecureContext::create(global, &config)
    }

    /// The `SSL_CTX` of `options.secureContext`. `None` if `options` isn't an object or names none.
    pub(crate) fn ctx_from_options(
        global: &JSGlobalObject,
        options: JSValue,
    ) -> JsResult<Option<boringssl::OwnedSslCtx>> {
        if !options.is_object() {
            return Ok(None);
        }
        let Some(value) = options.get_truthy(global, "secureContext")? else {
            return Ok(None);
        };
        match value.as_class_ref::<SecureContext>() {
            Some(context) => Ok(Some(context.ctx.clone())),
            None => Err(global.throw_invalid_argument_type_value(
                b"secureContext",
                b"SecureContext",
                value,
            )),
        }
    }

    fn config_from_js(global: &JSGlobalObject, options: JSValue) -> JsResult<SSLConfig> {
        let vm = global.bun_vm();
        // Only a server reads `rejectUnauthorized` back from a context (`server_ctx_rejects_unauthorized`).
        Ok(ParsedTls::from_js(vm, global, options, true)?.or_defaults(vm, true))
    }

    /// `SecureContext.parsePkcs12(pfx, passphrase)` - parses a PKCS#12 blob
    /// into `{ key, cert, ca? }` PEM strings so the regular key/cert/ca
    /// option plumbing can consume Node's `pfx` option.
    pub(crate) fn parse_pkcs12(
        cx: &mut JsScope<'_>,
        pfx: JsLocal<'_>,
        passphrase: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (pfx, passphrase) = (pfx.to_js(), passphrase.to_js());
        if pfx.is_undefined() {
            return Err(global.throw(format_args!("PFX certificate argument is mandatory")));
        }
        // The passphrase is optional; the C side treats NULL as "". Coerce it
        // before borrowing the pfx ArrayBuffer so a user toString() cannot
        // detach the buffer behind the borrowed slice.
        let pass_owned: Option<Vec<u8>> = if !passphrase.is_undefined_or_null() {
            let p = passphrase.to_utf8(global)?;
            let mut v = p.slice().to_vec();
            v.push(0);
            Some(v)
        } else {
            None
        };
        // The pfx arrives as a Buffer/TypedArray (binary DER) or a string;
        // a string-conversion would mangle the DER bytes, so read the raw
        // view when one exists.
        let pfx_view;
        let pfx_string;
        let pfx_bytes: &[u8] = match pfx.as_array_buffer(global) {
            Some(view) => {
                pfx_view = view;
                pfx_view.byte_slice()
            }
            None => {
                pfx_string = pfx.to_utf8(global)?;
                pfx_string.slice()
            }
        };
        if pfx_bytes.is_empty() {
            return Err(global.throw(format_args!("PFX certificate argument is mandatory")));
        }
        let mut out_key: *mut core::ffi::c_char = core::ptr::null_mut();
        let mut out_cert: *mut core::ffi::c_char = core::ptr::null_mut();
        let mut out_ca: *mut core::ffi::c_char = core::ptr::null_mut();
        let mut key_len = 0usize;
        let mut cert_len = 0usize;
        let mut ca_len = 0usize;
        let mut err_reason: *const core::ffi::c_char = core::ptr::null();
        // SAFETY: the buffers are live for the call; the out-pointers are
        // freed below with libc free per the helper's contract.
        let ok = unsafe {
            c::us_ssl_parse_pkcs12(
                pfx_bytes.as_ptr().cast(),
                pfx_bytes.len(),
                pass_owned
                    .as_ref()
                    .map_or(core::ptr::null(), |v| v.as_ptr().cast()),
                &raw mut out_key,
                &raw mut key_len,
                &raw mut out_cert,
                &raw mut cert_len,
                &raw mut out_ca,
                &raw mut ca_len,
                &raw mut err_reason,
            )
        };
        unsafe extern "C" {
            fn free(ptr: *mut core::ffi::c_void);
        }
        if ok == 0 {
            let reason = if err_reason.is_null() {
                ""
            } else {
                // SAFETY: the helper sets a static NUL-terminated tag on failure.
                unsafe { core::ffi::CStr::from_ptr(err_reason) }
                    .to_str()
                    .unwrap_or("")
            };
            let message = match reason {
                "key" => "Unable to load private key from PFX data",
                "cert" => "Unable to load certificate from PFX data",
                "mac" => "PFX MAC verification failed - is the passphrase correct?",
                _ => "Unable to load PFX certificate",
            };
            return Err(global.throw(format_args!("{message}")));
        }
        let _free = scopeguard::guard((out_key, out_cert, out_ca), |(key, cert, ca)| {
            // SAFETY: allocated by the helper with malloc; `ca` may be null.
            unsafe {
                free(key.cast());
                free(cert.cast());
                if !ca.is_null() {
                    free(ca.cast());
                }
            }
        });
        let result = JSValue::create_empty_object(global, 0);
        // SAFETY: the helper returned NUL-terminated PEM (ASCII) strings of the
        // given lengths; `to_js` copies into the JS heap.
        let (key_slice, cert_slice, ca_slice) = unsafe {
            (
                core::slice::from_raw_parts(out_key.cast::<u8>(), key_len),
                core::slice::from_raw_parts(out_cert.cast::<u8>(), cert_len),
                (!out_ca.is_null() && ca_len > 0)
                    .then(|| core::slice::from_raw_parts(out_ca.cast::<u8>(), ca_len)),
            )
        };
        result.put(
            global,
            b"key",
            EncodedSlice::latin1(key_slice).to_js(global),
        );
        result.put(
            global,
            b"cert",
            EncodedSlice::latin1(cert_slice).to_js(global),
        );
        if let Some(ca_slice) = ca_slice {
            result.put(global, b"ca", EncodedSlice::latin1(ca_slice).to_js(global));
        }
        Ok(result)
    }

    /// `tls.createSecureContext()` / `new tls.SecureContext()` entry - builds a context that owns its
    /// SSL_CTX exclusively: no digest memoisation at either the JS-wrapper
    /// cache or the native SSLContextCache level, so prototype mutators like
    /// `addCACert` can never affect another context (or the cached
    /// connect/listen contexts). The internal connect/listen paths keep using
    /// `intern` for the per-digest cache.
    pub(crate) fn create_private<'a>(
        cx: &mut JsScope<'a>,
        options: JsLocal<'a>,
    ) -> JsResult<JsWrapper<'a, Self>> {
        let global = cx.global();
        let config = Self::config_from_js(global, options.to_js())?;

        let ctx_opts = config.as_usockets();
        let d = ctx_opts.digest();

        let mut err = uws::create_bun_socket_error_t::none;
        let Some(ctx) = ctx_opts.create_ssl_context_with_digest(&d, &mut err) else {
            if err == uws::create_bun_socket_error_t::none
                || err == uws::create_bun_socket_error_t::invalid_ciphers
            {
                let code = boringssl::ERR_get_error();
                if code != 0 {
                    return Err(global.throw_value(err_to_js(global, code)));
                }
                if err == uws::create_bun_socket_error_t::none {
                    return Err(global.throw(format_args!("Failed to create SSL context")));
                }
            }
            return Err(global.throw_value(create_bun_socket_error_to_js(err, global)));
        };
        let sc = SecureContext {
            ctx,
            digest: Cell::new(d),
            extra_memory: ctx_opts.approx_cert_bytes() + SSL_CTX_BASE_COST,
            shared: false,
        };
        Ok(sc.into_js(&cx.heap))
    }

    /// `tls.createSecureContext(opts)`. Equal configs get the same live wrapper, which `Listener` compares by pointer.
    pub(crate) fn intern(cx: &mut JsScope<'_>, options: JsLocal<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let config = Self::config_from_js(global, options.to_js())?;

        let ctx_opts = config.as_usockets();
        let d = ctx_opts.digest();
        let key = u64::from_le_bytes(d[0..8].try_into().expect("infallible: size matches"));

        let cached = cpp::Bun__SecureContextCache__get(global, key);
        if !cached.is_empty() {
            if let Some(existing) = Self::from_js(cached) {
                // 64-bit key collision is ~2⁻⁶⁴ but a false hit hands the wrong
                // cert to a connection. Full-digest compare is 32 bytes; cheap.
                // SAFETY: the struct is stored inline in the wrapper, which `cached` keeps alive.
                if unsafe { (*existing).digest.get() } == d {
                    return Ok(cached);
                }
            }
        }

        let value = Self::create_with_digest(global, &ctx_opts, d)?.to_js(global);
        cpp::Bun__SecureContextCache__set(global, key, value);
        Ok(value)
    }

    /// Mode-neutral: Node lets one `SecureContext` back both `tls.connect()` and
    /// `tls.createServer({secureContext})`, so we cannot bake client-vs-server
    /// into the `SSL_CTX`. CTX-level verify mode is whatever `config` asked for
    /// (i.e. servers don't send CertificateRequest unless `requestCert` was set);
    /// the per-socket attach overrides client SSLs to `SSL_VERIFY_PEER` so chain
    /// validation always runs and `verify_error` is populated for the JS-side
    /// `rejectUnauthorized` decision. The trust store is loaded unconditionally in
    /// `us_ssl_ctx_from_options` so that override has roots to validate against.
    pub(crate) fn create(global: &JSGlobalObject, config: &SSLConfig) -> JsResult<SecureContext> {
        let ctx_opts = config.as_usockets();
        Self::create_with_digest(global, &ctx_opts, ctx_opts.digest())
    }

    fn create_with_digest(
        global: &JSGlobalObject,
        ctx_opts: &uws::socket_context::BunSocketContextOptions,
        d: [u8; 32],
    ) -> JsResult<SecureContext> {
        let mut err = uws::create_bun_socket_error_t::none;
        let Some(ctx) = SSLContextCache::get_or_create_digest(ctx_opts, d, &mut err) else {
            // `err` is only set for the input-validation paths (bad PEM, missing
            // file, …). When BoringSSL itself fails (e.g. unsupported curve) the
            // enum is still `.none`; surface the library error stack instead of
            // throwing an empty placeholder. A rejected cipher list also keeps
            // its specific reason (NO_CIPHER_MATCH, INVALID_COMMAND) on the
            // queue - Node reports that decomposed error rather than a generic
            // "invalid ciphers".
            if err == uws::create_bun_socket_error_t::none
                || err == uws::create_bun_socket_error_t::invalid_ciphers
            {
                // `ERR_get_error` is declared `safe fn` in `boringssl_sys` (no
                // preconditions; reads the thread-local error queue).
                let code = boringssl::ERR_get_error();
                if code != 0 {
                    return Err(global.throw_value(err_to_js(global, code)));
                }
                if err == uws::create_bun_socket_error_t::none {
                    return Err(global.throw(format_args!("Failed to create SSL context")));
                }
            }
            return Err(global.throw_value(create_bun_socket_error_to_js(err, global)));
        };
        Ok(SecureContext {
            ctx,
            digest: Cell::new(d),
            extra_memory: ctx_opts.approx_cert_bytes() + SSL_CTX_BASE_COST,
            shared: true,
        })
    }

    /// `secureContext.context._external` — Node exposes the SSL_CTX here as an
    /// opaque V8 External. Bun has nothing meaningful to hand out, so the
    /// getter exists only so the property behaves like an accessor (a foreign
    /// receiver gets a TypeError) instead of a missing property.
    pub(crate) fn get_external<'a>(&self, _: &JsHeap<'a>) -> JsLocal<'a> {
        JsLocal::UNDEFINED
    }

    /// `secureContext.context.addCACert(pem)` — appends the certificates in
    /// the given PEM string or buffer to this context's trust store, the way
    /// Node's SecureContext exposes it.
    pub(crate) fn add_ca_cert<'a>(
        &self,
        cx: &mut JsScope<'a>,
        cert: JsLocal<'a>,
    ) -> bindgen::Result<'a, ()> {
        let ctx = self.own_ctx(&cx.heap)?;
        let global = cx.global();
        let pem = cert.to_js().to_utf8(global)?;
        let bytes = pem.slice();
        if bytes.is_empty() {
            return Err(global
                .throw_invalid_arguments(format_args!("addCACert requires a certificate"))
                .into());
        }
        // The C side wants a NUL-terminated PEM document.
        let mut owned = bytes.to_vec();
        owned.push(0);
        // SAFETY: `ctx` is the live SSL_CTX this object owns a reference
        // to, and `owned` is a NUL-terminated buffer valid for the call.
        let ok =
            unsafe { c::us_ssl_ctx_add_ca_cert(ctx, owned.as_ptr().cast::<core::ffi::c_char>()) };
        if ok == 0 {
            return Err(global.throw(format_args!("Invalid CA certificate")).into());
        }
        // Its trust set changed, so it stops sharing sessions with same-option contexts.
        let mut folded = [0u8; 32];
        let mut hasher = bun_sha_hmac::SHA256::init();
        hasher.update(&self.digest.get());
        hasher.update(bytes);
        hasher.r#final(&mut folded);
        self.digest.set(folded);
        // SAFETY: `ctx` is live; the call copies the 32 bytes.
        unsafe {
            boringssl::SSL_CTX_set_session_id_context(ctx, folded.as_ptr(), folded.len());
        }
        Ok(())
    }

    /// The `SSL_CTX` for a member that changes it. A digest-interned one also serves other consumers, so it's refused.
    fn own_ctx<'a>(&self, heap: &JsHeap<'a>) -> bindgen::Result<'a, *mut boringssl::SSL_CTX> {
        if self.shared {
            return Err(heap.error(format_args!(
                "cannot mutate a shared SecureContext; use tls.createSecureContext()"
            )));
        }
        Ok(self.ctx.as_ptr())
    }

    /// `secureContext.context.getTicketKeys()`, for `tls.Server#getTicketKeys()`.
    pub(crate) fn get_ticket_keys<'a>(
        &self,
        heap: &JsHeap<'a>,
    ) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
        let mut keys = [0u8; TICKET_KEYS_LEN];
        // SAFETY: `self.ctx` is live and `keys` has the length BoringSSL requires.
        let ok = unsafe {
            boringssl::SSL_CTX_get_tlsext_ticket_keys(
                self.ctx.as_ptr(),
                keys.as_mut_ptr().cast(),
                keys.len(),
            )
        };
        // Setting the keys stops BoringSSL's 48-hour rotation, so a copy given to another server stays valid as in Node.
        if ok != 1 || (!self.shared && !self.apply_ticket_keys(&keys)) {
            return Err(heap.error(format_args!("Failed to get the session ticket keys")));
        }
        heap.create_buffer(&keys)
    }

    /// `secureContext.context.setTicketKeys(keys)`, for `tls.Server#setTicketKeys()` and the `ticketKeys` option.
    pub(crate) fn set_ticket_keys<'a>(
        &self,
        heap: &JsHeap<'a>,
        keys: &[u8],
    ) -> bindgen::Result<'a, ()> {
        self.own_ctx(heap)?;
        if !self.apply_ticket_keys(keys) {
            return Err(heap.error(format_args!("Failed to set the session ticket keys")));
        }
        Ok(())
    }

    fn apply_ticket_keys(&self, keys: &[u8]) -> bool {
        // SAFETY: `self.ctx` is live; the call copies `keys` and rejects any length but 48.
        unsafe {
            boringssl::SSL_CTX_set_tlsext_ticket_keys(
                self.ctx.as_ptr(),
                keys.as_ptr().cast(),
                keys.len(),
            ) == 1
        }
    }

    pub(crate) fn memory_cost(&self) -> usize {
        self.extra_memory
    }
}

const SSL_CTX_BASE_COST: usize = 50 * 1024;
/// A 16-byte name, a 16-byte HMAC key and a 16-byte AES key.
const TICKET_KEYS_LEN: usize = 48;

use bun_uws_sys::socket_context::c;

mod cpp {
    use super::*;
    unsafe extern "C" {
        pub(super) safe fn Bun__SecureContextCache__get(
            global: &JSGlobalObject,
            key: u64,
        ) -> JSValue;
        pub(super) safe fn Bun__SecureContextCache__set(
            global: &JSGlobalObject,
            key: u64,
            value: JSValue,
        );
    }
}
