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
use bun_jsc::JsClass as _;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_uws as uws;

/// Re-export the codegen-emitted module so
/// `$zig(SecureContext.zig, js.getConstructor)` in
/// `generated_js2native.rs` resolves as `secure_context::js::get_constructor`.
pub use crate::generated_classes::js_SecureContext as js;

// Codegen (`.classes.ts`) wires `to_js`/`from_js`/`from_js_direct` via this derive.
// `#[repr(C)]` only to satisfy the `improper_ctypes` lint on the generated
// `extern "C" fn(..., *mut SecureContext)` shims — C++ never reads this layout
// (it round-trips `m_ctx` as `void*`).
#[bun_jsc::JsClass]
#[repr(C)]
pub struct SecureContext {
    pub ctx: *mut boringssl::SSL_CTX,
    /// `BunSocketContextOptions.digest()` — exactly the fields that reach
    /// `us_ssl_ctx_from_options`. Stored so an `intern()` WeakGCMap hit (keyed by
    /// the low 64 bits) can do a full content-equality check before reusing.
    pub digest: [u8; 32],
    /// Approximate cert/key/CA byte length plus the BoringSSL `SSL_CTX` floor
    /// (~50 KB), so the GC can account for the off-heap allocation.
    pub extra_memory: usize,
}

/// Exposed via `bun:internal-for-testing` so churn tests can assert
/// `SSL_CTX_new` was called O(1) times, not O(connections).
#[bun_jsc::host_fn]
pub(crate) fn js_live_count(_global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
    // `us_ssl_ctx_live_count` is declared `safe fn` (reads a global atomic
    // counter, no preconditions).
    Ok(JSValue::js_number(c::us_ssl_ctx_live_count() as f64))
}

/// Exposed via `bun:internal-for-testing`. Takes a JS `SecureContext.context`
/// and returns its BoringSSL `SSL_CTX_get_verify_mode` value — used by tests
/// to assert `addCACert` doesn't flip mode-neutral contexts to
/// `SSL_VERIFY_PEER`, which would make servers send CertificateRequest.
#[bun_jsc::host_fn]
pub(crate) fn js_verify_mode(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let args = callframe.arguments();
    if args.is_empty() {
        return Err(global.throw_not_enough_arguments("secureContextVerifyMode", 1, 0));
    }
    let Some(this) = SecureContext::from_js(args[0]) else {
        return Err(global.throw_invalid_arguments(format_args!(
            "secureContextVerifyMode: expected a SecureContext"
        )));
    };
    // SAFETY: `from_js` returns a live `m_ctx` pointer owned by the JS wrapper;
    // `SSL_CTX_get_verify_mode` only reads it.
    let mode = unsafe { boringssl::SSL_CTX_get_verify_mode((*this).ctx) };
    Ok(JSValue::js_number(mode as f64))
}

impl SecureContext {
    // Note: no `#[bun_jsc::host_fn]` here — the `Free` shim it emits calls
    // a bare `constructor(...)` which cannot resolve inside an `impl`. The
    // `#[bun_jsc::JsClass]` macro already emits the `<Self>::constructor` shim.
    pub fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<SecureContext>> {
        let args = callframe.arguments();
        let opts = if args.len() > 0 {
            args[0]
        } else {
            JSValue::UNDEFINED
        };

        // `tls.createSecureContext()` / `createSecureContext(null)` — Node
        // treats both as an empty options bag (WebIDL: undefined → empty
        // dictionary). Bindgen's converter throws ERR_INVALID_ARG_TYPE on
        // non-objects, so skip it when the caller passed nothing.
        let config = if opts.is_undefined_or_null() {
            SSLConfig::zero()
        } else {
            // SAFETY: `bun_vm()` returns the live per-global VM pointer; valid for the call.
            let vm = global.bun_vm().as_mut();
            SSLConfig::from_js(vm, global, opts)?.unwrap_or_else(SSLConfig::zero)
        };
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
    pub fn intern(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments();
        let opts = if args.len() > 0 {
            args[0]
        } else {
            JSValue::UNDEFINED
        };

        // See `constructor`: `undefined`/`null` means an empty options bag
        // (Node WebIDL), but bindgen throws on non-objects — skip it.
        let config = if opts.is_undefined_or_null() {
            SSLConfig::zero()
        } else {
            // SAFETY: `bun_vm()` returns the live per-global VM pointer; valid for the call.
            let vm = global.bun_vm().as_mut();
            SSLConfig::from_js(vm, global, opts)?.unwrap_or_else(SSLConfig::zero)
        };
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
    pub fn create(global: &JSGlobalObject, config: &SSLConfig) -> JsResult<Box<SecureContext>> {
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
            // throwing an empty placeholder.
            if err == uws::create_bun_socket_error_t::none {
                // `ERR_get_error` is declared `safe fn` in `boringssl_sys` (no
                // preconditions; reads the thread-local error queue).
                let code = boringssl::ERR_get_error();
                if code != 0 {
                    return Err(global.throw_value(err_to_js(global, code)));
                }
                return Err(global.throw(format_args!("Failed to create SSL context")));
            }
            return Err(global.throw_value(create_bun_socket_error_to_js(err, global)));
        };
        Ok(Box::new(SecureContext {
            ctx,
            digest: d,
            extra_memory: ctx_opts.approx_cert_bytes() + SSL_CTX_BASE_COST,
        }))
    }

    /// `SSL_CTX_up_ref` and return — for callers that want to outlive this
    /// wrapper's GC. Most paths just pass `this.ctx` directly and let `SSL_new`
    /// take its own ref.
    pub fn borrow(&self) -> *mut boringssl::SSL_CTX {
        unsafe {
            // SAFETY: self.ctx is a valid SSL_CTX* held for the lifetime of this wrapper.
            let _ = boringssl::SSL_CTX_up_ref(self.ctx);
        }
        self.ctx
    }

    /// Node's `secureContext.context.addCACert(pem)` — append one-or-more PEM
    /// X.509 certificates to this context's trust store. Accepts strings and
    /// Buffers/TypedArrays/ArrayBuffers (Node is the same). Lenient: empty /
    /// malformed input is silently ignored, duplicates are no-ops. Returns
    /// `undefined`.
    ///
    /// Shared-CTX caveat: `intern()` memoises both the JS cell (per-global
    /// `Bun__SecureContextCache`) and the native `SSL_CTX*` (per-VM
    /// `SSLContextCache`) by config digest. Before mutating we drop ourselves
    /// from both caches so a subsequent `createSecureContext(sameOptions)`
    /// from the SAME global builds a FRESH context instead of handing back the
    /// now-mutated one. Native `us_ssl_ctx_add_ca_pem` does NOT touch
    /// verify_mode (flipping CTX VERIFY_PEER would make servers built from a
    /// mode-neutral SecureContext send CertificateRequest); it appends to the
    /// CTX's own store and flips the `us_ctx_user_ca` marker so the per-socket
    /// client override preserves the user CAs.
    #[bun_jsc::host_fn(method)]
    pub(crate) fn add_ca_cert(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments();
        if args.is_empty() {
            // Node asserts here. Prefer a clean TypeError to a crash.
            return Err(global.throw_not_enough_arguments("addCACert", 1, 0));
        }
        // StringOrBuffer covers string/Buffer/TypedArray/ArrayBuffer/DataView.
        // Anything else is a no-op (Node silently accepts non-byte input).
        let Some(sob) = crate::node::StringOrBuffer::from_js(global, args[0])? else {
            return Ok(JSValue::UNDEFINED);
        };
        let bytes = sob.slice();

        // `us_ssl_ctx_add_ca_pem` short-circuits on empty input without
        // touching the SSL_CTX, so nothing to invalidate. Bail BEFORE the
        // cache eviction to preserve `createSecureContext(opts) ===
        // createSecureContext(opts)` identity for the empty-bytes Node no-op.
        if bytes.is_empty() {
            return Ok(JSValue::UNDEFINED);
        }

        // Detach from the per-VM native cache AND the per-global JS cache
        // BEFORE mutating the SSL_CTX — both are keyed by the original config
        // digest, and a mutated CTX no longer matches that digest's contract.
        // SAFETY: `runtime_state()` is the boxed per-thread RuntimeState; the
        // embedded `ssl_ctx_cache` has a stable address for the VM's lifetime
        // and is only touched from the JS thread.
        let state = crate::jsc_hooks::runtime_state();
        debug_assert!(!state.is_null(), "RuntimeState not installed");
        let cache = unsafe { &mut (*state).ssl_ctx_cache };
        cache.invalidate(self.ctx, &self.digest);

        // JS cache: only evict if WE are still the cell under this key. A prior
        // addCACert already evicted us; a subsequent createSecureContext with
        // the same digest may have installed a *different* cell. Mirror the
        // `entry.ctx == ctx` guard in `SSLContextCache::invalidate`.
        let key =
            u64::from_le_bytes(self.digest[0..8].try_into().expect("infallible: size matches"));
        if cpp::Bun__SecureContextCache__get(global, key) == callframe.this() {
            cpp::Bun__SecureContextCache__remove(global, key);
        }

        // SAFETY: `self.ctx` is a valid SSL_CTX*; `bytes` is valid for this
        // call. The C helper copies the PEM bytes it parses.
        unsafe {
            c::us_ssl_ctx_add_ca_pem(self.ctx, bytes.as_ptr().cast(), bytes.len());
        }
        Ok(JSValue::UNDEFINED)
    }

    // Codegen's `host_fn_finalize` calls this via `|b| SecureContext::finalize(b)`
    // and requires `fn finalize(self: Box<Self>)`; clippy::boxed_local is a
    // false positive on that contract.
    #[allow(clippy::boxed_local)]
    pub fn finalize(self: Box<Self>) {
        // SAFETY: `ctx` was created by `SSL_CTX_new`; freed exactly once here.
        unsafe { boringssl::SSL_CTX_free(self.ctx) };
    }

    pub fn memory_cost(&self) -> usize {
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
        pub(super) safe fn Bun__SecureContextCache__remove(global: &JSGlobalObject, key: u64);
    }
}
