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

use crate::crypto::boringssl_jsc::err_to_js;
use crate::socket::uws_jsc::create_bun_socket_error_to_js;
use crate::socket::{SSLConfig, SSLConfigFromJs};
use bun_boringssl_sys as boringssl;
use bun_core::EncodedSlice;
use bun_jsc::EncodedSliceJsc as _;
use bun_jsc::JsClass as _;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_uws as uws;

/// Re-export the codegen-emitted module so
/// `$rust(SecureContext.rs, js.getConstructor)` in
/// `generated_js2native.rs` resolves as `secure_context::js::get_constructor`.
pub use crate::generated_classes::js_SecureContext as js;

// Codegen (`.classes.ts`) wires `to_js`/`from_js`/`from_js_direct` via this derive.
// `#[repr(C)]` only to satisfy the `improper_ctypes` lint on the generated
// `extern "C" fn(..., *mut SecureContext)` shims — C++ never reads this layout
// (it round-trips `m_ctx` as `void*`).
#[bun_jsc::JsClass]
#[repr(C)]
pub struct SecureContext {
    pub ctx: boringssl::OwnedSslCtx,
    /// `BunSocketContextOptions.digest()` — exactly the fields that reach
    /// `us_ssl_ctx_from_options`. Stored so an `intern()` WeakGCMap hit (keyed by
    /// the low 64 bits) can do a full content-equality check before reusing.
    pub(crate) digest: [u8; 32],
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
    // Note: no `#[bun_jsc::host_fn]` here — the `Free` shim it emits calls
    // a bare `constructor(...)` which cannot resolve inside an `impl`. The
    // `#[bun_jsc::JsClass]` macro already emits the `<Self>::constructor` shim.
    pub(crate) fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<SecureContext>> {
        let args = callframe.arguments();
        let opts = if args.len() > 0 {
            args[0]
        } else {
            JSValue::UNDEFINED
        };

        // SAFETY: `bun_vm()` returns the live per-global VM pointer; valid for the call.
        let vm = global.bun_vm().as_mut();
        // A SecureContext carries no client/server role; keep the client default.
        let config = SSLConfig::from_js(vm, global, opts, false)?.unwrap_or_else(SSLConfig::zero);
        // `defer config.deinit()` — handled by Drop.

        SecureContext::create(global, &config)
    }

    /// `tls.createSecureContext(opts)` entry point. WeakGCMap-memoised by config
    /// digest so identical configs return the same `JSSecureContext` cell while
    /// it's alive; falls through to `create()` (which itself hits the native
    /// `SSLContextCache`) on miss. Returning the same cell is what makes
    /// `secureContext === createSecureContext(opts)` hold and lets `Listener`
    /// pointer-compare without a JS-side WeakRef map.
    // Note: codegen (`generated_classes.rs::SecureContextClass__intern`)
    // wraps this in `host_fn_result` and exports the C-ABI shim, so no
    // `#[bun_jsc::host_fn]` here — that macro's Free shim calls by bare name
    // and cannot resolve an associated fn.
    /// `SecureContext.parsePkcs12(pfx, passphrase)` - parses a PKCS#12 blob
    /// into `{ key, cert, ca? }` PEM strings so the regular key/cert/ca
    /// option plumbing can consume Node's `pfx` option. Same codegen shim
    /// arrangement as `intern` (no `#[host_fn]` attribute here).
    pub(crate) fn parse_pkcs12(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments();
        if args.is_empty() {
            return Err(global.throw(format_args!("PFX certificate argument is mandatory")));
        }
        // The passphrase is optional; the C side treats NULL as "". Coerce it
        // before borrowing the pfx ArrayBuffer so a user toString() cannot
        // detach the buffer behind the borrowed slice.
        let pass_owned: Option<Vec<u8>> = if args.len() > 1 && !args[1].is_undefined_or_null() {
            let p = args[1].to_utf8(global)?;
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
        let pfx_bytes: &[u8] = match args[0].as_array_buffer(global) {
            Some(view) => {
                pfx_view = view;
                pfx_view.byte_slice()
            }
            None => {
                pfx_string = args[0].to_utf8(global)?;
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
    pub(crate) fn create_private(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments();
        let opts = if args.len() > 0 {
            args[0]
        } else {
            JSValue::UNDEFINED
        };

        // SAFETY: `bun_vm()` returns the live per-global VM pointer; valid for the call.
        let vm = global.bun_vm().as_mut();
        // A SecureContext carries no client/server role; keep the client default.
        let config = SSLConfig::from_js(vm, global, opts, false)?.unwrap_or_else(SSLConfig::zero);
        // `defer config.deinit()` — handled by Drop.

        let ctx_opts = config.as_usockets();
        let d = ctx_opts.digest();

        let mut err = uws::create_bun_socket_error_t::none;
        let Some(ctx) = ctx_opts.create_ssl_context(&mut err) else {
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
        let sc = Box::new(SecureContext {
            ctx,
            digest: d,
            extra_memory: ctx_opts.approx_cert_bytes() + SSL_CTX_BASE_COST,
            shared: false,
        });
        Ok(Self::to_js_boxed(sc, global))
    }

    pub(crate) fn intern(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments();
        let opts = if args.len() > 0 {
            args[0]
        } else {
            JSValue::UNDEFINED
        };

        // SAFETY: `bun_vm()` returns the live per-global VM pointer; valid for the call.
        let vm = global.bun_vm().as_mut();
        // A SecureContext carries no client/server role; keep the client default.
        let config = SSLConfig::from_js(vm, global, opts, false)?.unwrap_or_else(SSLConfig::zero);
        // `defer config.deinit()` — handled by Drop.

        let ctx_opts = config.as_usockets();
        let d = ctx_opts.digest();
        let key = u64::from_le_bytes(d[0..8].try_into().expect("infallible: size matches"));

        let cached = cpp::Bun__SecureContextCache__get(global, key);
        if !cached.is_empty() {
            if let Some(existing) = Self::from_js(cached) {
                // 64-bit key collision is ~2⁻⁶⁴ but a false hit hands the wrong
                // cert to a connection. Full-digest compare is 32 bytes; cheap.
                // SAFETY: `from_js` returns a live `m_ctx` pointer owned by the JS wrapper.
                if unsafe { (*existing).digest } == d {
                    return Ok(cached);
                }
            }
        }

        let sc = Self::create_with_digest(global, &ctx_opts, d)?;
        // `sc` is a fresh Box from `create_with_digest`; ownership transfers to the GC wrapper.
        let value = Self::to_js_boxed(sc, global);
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
    pub(crate) fn create(
        global: &JSGlobalObject,
        config: &SSLConfig,
    ) -> JsResult<Box<SecureContext>> {
        let ctx_opts = config.as_usockets();
        Self::create_with_digest(global, &ctx_opts, ctx_opts.digest())
    }

    fn create_with_digest(
        global: &JSGlobalObject,
        ctx_opts: &uws::socket_context::BunSocketContextOptions,
        d: [u8; 32],
    ) -> JsResult<Box<SecureContext>> {
        let mut err = uws::create_bun_socket_error_t::none;
        // Note: spec is `global.bunVM().rareData().sslCtxCache()`. In the
        // Rust crate split, `bun_jsc::RareData::ssl_ctx_cache()` returns an
        // opaque cycle-break stub; the concrete per-VM `SSLContextCache` lives
        // on this crate's `RuntimeState` (one per JS thread, same lifetime as
        // `RareData`). Reach it via the thread-local — same instance
        // `Bun__RareData__sslCtxCache` hands out over FFI.
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        // SAFETY: `state` is the boxed per-thread `RuntimeState` installed by
        // `init_runtime_state`; the embedded `ssl_ctx_cache` has a stable
        // address for the VM's lifetime and is only touched from the JS thread.
        let cache = unsafe { &mut (*state).ssl_ctx_cache };
        let Some(ctx) = cache.get_or_create_digest(ctx_opts, d, &mut err) else {
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
        Ok(Box::new(SecureContext {
            ctx,
            digest: d,
            extra_memory: ctx_opts.approx_cert_bytes() + SSL_CTX_BASE_COST,
            shared: true,
        }))
    }

    /// `secureContext.context._external` — Node exposes the SSL_CTX here as an
    /// opaque V8 External. Bun has nothing meaningful to hand out, so the
    /// getter exists only so the property behaves like an accessor (a foreign
    /// receiver gets a TypeError) instead of a missing property.
    #[bun_jsc::host_fn(getter)]
    pub(crate) fn get_external(_this: &Self, _global: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(JSValue::UNDEFINED)
    }

    /// `secureContext.context.addCACert(pem)` — appends the certificates in
    /// the given PEM string or buffer to this context's trust store, the way
    /// Node's SecureContext exposes it.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn add_ca_cert(
        this: &Self,
        global: &JSGlobalObject,
        frame: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.shared {
            return Err(global.throw(format_args!(
                "cannot mutate a shared SecureContext; use tls.createSecureContext()"
            )));
        }
        let args = frame.arguments();
        if args.is_empty() {
            return Err(
                global.throw_invalid_arguments(format_args!("addCACert requires a certificate"))
            );
        }
        let pem = args[0].to_utf8(global)?;
        let bytes = pem.slice();
        if bytes.is_empty() {
            return Err(
                global.throw_invalid_arguments(format_args!("addCACert requires a certificate"))
            );
        }
        // The C side wants a NUL-terminated PEM document.
        let mut owned = bytes.to_vec();
        owned.push(0);
        // SAFETY: `this.ctx` is the live SSL_CTX this object owns a reference
        // to, and `owned` is a NUL-terminated buffer valid for the call.
        let ok = unsafe {
            c::us_ssl_ctx_add_ca_cert(
                this.ctx.as_ptr(),
                owned.as_ptr().cast::<core::ffi::c_char>(),
            )
        };
        if ok == 0 {
            return Err(global.throw(format_args!("Invalid CA certificate")));
        }
        Ok(JSValue::UNDEFINED)
    }

    pub(crate) fn memory_cost(&self) -> usize {
        core::mem::size_of::<SecureContext>() + self.extra_memory
    }
}

const SSL_CTX_BASE_COST: usize = 50 * 1024;

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
