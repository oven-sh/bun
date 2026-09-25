//! The peer certificate as JS, and `tls.checkServerIdentity`, for every TLS client whose handshake events run on the JS thread.

use core::ffi::c_int;

use bun_boringssl::c::{SSL, SSL_CTX, X509, X509_STORE, X509_STORE_CTX, struct_stack_st_X509};

use crate::{ErrorCode, JSGlobalObject, JSValue, JsResult};

unsafe extern "C" {
    // JSX509Certificate.cpp. Opaque `repr(C)` handles: `&mut`/`&` are ABI-identical to non-null pointers.
    safe fn Bun__X509__toJSLegacyEncoding(
        cert: &mut X509,
        global_object: &JSGlobalObject,
    ) -> JSValue;

    safe fn SSL_is_server(ssl: &SSL) -> c_int;
    // The process-wide default root store; up-refs before returning, so
    // the caller owns a reference it must release with X509_STORE_free.
    fn us_get_shared_default_ca_store() -> *mut X509_STORE;
    fn us_ssl_ctx_has_user_ca(ctx: *mut SSL_CTX) -> c_int;
    fn X509_STORE_free(store: *mut X509_STORE);
    // X509_STORE_CTX lifecycle for issuer lookups; `new` allocates,
    // `init` borrows the store, `free` releases. Used to extend the peer
    // certificate chain through the local trust store.
    fn X509_STORE_CTX_new() -> *mut X509_STORE_CTX;
    fn X509_STORE_CTX_init(
        ctx: *mut X509_STORE_CTX,
        store: *mut X509_STORE,
        x509: *mut X509,
        chain: *mut struct_stack_st_X509,
    ) -> c_int;
    fn X509_STORE_CTX_free(ctx: *mut X509_STORE_CTX);
    // Writes a +1 X509 reference to `*issuer` on success (> 0).
    fn X509_STORE_CTX_get1_issuer(
        issuer: *mut *mut X509,
        ctx: *mut X509_STORE_CTX,
        x: *mut X509,
    ) -> c_int;
    // Returns X509_V_OK (0) when `issuer` could have issued `subject`.
    fn X509_check_issued(issuer: *mut X509, subject: *mut X509) -> c_int;
}

/// The `tls.getPeerCertificate()`-style object for `cert` (borrowed, not adopted).
pub fn x509_to_legacy_object(cert: &mut X509, global: &JSGlobalObject) -> JsResult<JSValue> {
    crate::from_js_host_call(global, || Bun__X509__toJSLegacyEncoding(cert, global))
}

/// `getPeerCertificate(true)`: the peer's certificate, or `undefined` when it sent none.
pub fn peer_certificate_chain(ssl: &mut SSL, global: &JSGlobalObject) -> JsResult<JSValue> {
    let ssl_ptr: *mut SSL = ssl;
    let mut cert: *mut X509 = core::ptr::null_mut();
    if SSL_is_server(ssl) != 0 {
        // SSL_get_peer_certificate returns a +1 reference; we must free it.
        // SAFETY: `ssl_ptr` is the live SSL behind `ssl`.
        cert = unsafe { bun_boringssl::c::SSL_get_peer_certificate(ssl_ptr) };
    }
    let _guard = scopeguard::guard(cert, |c| {
        if !c.is_null() {
            // SAFETY: `c` is the +1 X509 reference returned by SSL_get_peer_certificate; we own it.
            unsafe { bun_boringssl::c::X509_free(c) };
        }
    });

    // SAFETY: `ssl_ptr` is the live SSL behind `ssl`; the chain and its entries are borrowed from it.
    let cert_chain = unsafe { bun_boringssl::c::SSL_get_peer_cert_chain(ssl_ptr) };
    let first_cert: *mut X509 = if !cert.is_null() {
        cert
    } else if !cert_chain.is_null() {
        // SAFETY: `cert_chain` is non-null and owned by the SSL.
        unsafe { bun_boringssl::c::sk_X509_value(cert_chain, 0) }
    } else {
        core::ptr::null_mut()
    };

    if first_cert.is_null() {
        return Ok(JSValue::UNDEFINED);
    }

    // The detailed form returns the whole chain the peer presented, each
    // certificate linking to its issuer through `issuerCertificate`, the way
    // Node's getPeerCertificate(true) does. SSL_get_peer_cert_chain includes
    // the leaf on the client side but not on the server side, where the +1
    // peer certificate above is the leaf instead.
    let first_obj = x509_to_legacy_object(X509::opaque_mut(first_cert), global)?;
    // Link each certificate to its predecessor immediately so every object in
    // the chain is reachable from the stack-rooted `first_obj` before the next
    // `x509_to_legacy_object` allocation can trigger a GC - a heap-backed Vec<JSValue>
    // is not stack-scanned.
    let mut prev_obj: JSValue = first_obj;
    let mut last_cert: *mut X509 = first_cert;
    if !cert_chain.is_null() {
        let mut i: usize = if cert.is_null() { 1 } else { 0 };
        loop {
            // SAFETY: `cert_chain` is non-null and owned by the SSL; out of range yields null.
            let next = unsafe { bun_boringssl::c::sk_X509_value(cert_chain, i) };
            if next.is_null() {
                break;
            }
            let obj = x509_to_legacy_object(X509::opaque_mut(next), global)?;
            prev_obj.put(global, b"issuerCertificate", obj);
            prev_obj = obj;
            last_cert = next;
            i += 1;
        }
    }

    // Extend the chain through the local trust store until a self-issued
    // certificate is reached, the way Node's getPeerCertificate(true) walks
    // X509_STORE_CTX_get1_issuer to surface the root that completed
    // verification even though the peer never sent it.
    let mut last_is_self_issued = false;
    // SAFETY: the store ctx is created, initialized against the live SSL_CTX's
    // store, used only within this scope and freed before returning; every
    // issuer returned by get1_issuer is a +1 reference collected in `extras`
    // and released after its fields have been copied into JS values and the
    // terminal self-issued check has run.
    unsafe {
        let ssl_ctx = bun_boringssl::c::SSL_get_SSL_CTX(ssl_ptr);
        let mut store = bun_boringssl::c::SSL_CTX_get_cert_store(ssl_ctx);
        // A context built without an explicit `ca` (and without requestCert,
        // which installs the shared roots) carries an empty store and the
        // issuer walk would stop at whatever the peer sent. Fall back to the
        // process-wide default roots the way Node's per-context store always
        // contains the bundled roots. The getter up-refs, so the temporary
        // reference is released after the walk.
        let mut shared_store: *mut X509_STORE = core::ptr::null_mut();
        if store.is_null() || us_ssl_ctx_has_user_ca(ssl_ctx) == 0 {
            shared_store = us_get_shared_default_ca_store();
            if !shared_store.is_null() {
                store = shared_store;
            }
        }
        let store_ctx = X509_STORE_CTX_new();
        if !store_ctx.is_null() {
            if !store.is_null()
                && X509_STORE_CTX_init(
                    store_ctx,
                    store,
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                ) == 1
            {
                let mut extras: Vec<*mut X509> = Vec::new();
                // Cap the walk so a cyclic store cannot loop forever.
                while extras.len() < 16 && X509_check_issued(last_cert, last_cert) != 0 {
                    let mut issuer: *mut X509 = core::ptr::null_mut();
                    if X509_STORE_CTX_get1_issuer(&raw mut issuer, store_ctx, last_cert) <= 0
                        || issuer.is_null()
                    {
                        break;
                    }
                    match x509_to_legacy_object(X509::opaque_mut(issuer), global) {
                        Ok(obj) => {
                            prev_obj.put(global, b"issuerCertificate", obj);
                            prev_obj = obj;
                        }
                        Err(e) => {
                            bun_boringssl::c::X509_free(issuer);
                            for extra in extras {
                                bun_boringssl::c::X509_free(extra);
                            }
                            X509_STORE_CTX_free(store_ctx);
                            if !shared_store.is_null() {
                                X509_STORE_free(shared_store);
                            }
                            return Err(e);
                        }
                    }
                    extras.push(issuer);
                    last_cert = issuer;
                }
                last_is_self_issued = X509_check_issued(last_cert, last_cert) == 0;
                for extra in extras {
                    bun_boringssl::c::X509_free(extra);
                }
            }
            X509_STORE_CTX_free(store_ctx);
        }
        if !shared_store.is_null() {
            X509_STORE_free(shared_store);
        }
    }

    // A self-issued terminal certificate references itself, like Node.
    if last_is_self_issued {
        prev_obj.put(global, b"issuerCertificate", prev_obj);
    }
    Ok(first_obj)
}

/// Runs `callback(hostname, getPeerCertificate(true))` as Node does. `Err` is what the connection fails with.
pub fn check_with_callback(
    global: &JSGlobalObject,
    callback: JSValue,
    ssl: Option<&mut SSL>,
    hostname: &[u8],
) -> Result<(), JSValue> {
    let js_cert = match ssl {
        Some(ssl) => peer_certificate_chain(ssl, global).map_err(|e| global.take_exception(e))?,
        None => JSValue::UNDEFINED,
    };
    if js_cert.is_undefined() {
        return Err(global
            .err(
                ErrorCode::TLS_CERT_ALTNAME_INVALID,
                format_args!("The server did not present a certificate"),
            )
            .to_js());
    }
    let js_hostname = crate::bun_string_jsc::create_utf8_for_js(global, hostname)
        .map_err(|e| global.take_exception(e))?;
    let result = {
        let _scope = global.bun_vm().enter_event_loop_scope();
        callback.call(global, JSValue::UNDEFINED, &[js_hostname, js_cert])
    };
    let result = result.map_err(|e| global.take_exception(e))?;
    verdict_of(global, result)
}

/// What a `tls.checkServerIdentity` function decided, from the value it returned. `Err` is the reason it refused the server.
pub fn verdict_of(global: &JSGlobalObject, returned: JSValue) -> Result<(), JSValue> {
    // > Returns <Error> object [...] on failure
    // Any object counts: a DOMException or a util.inherits() error is not an ErrorInstance cell.
    if returned.is_object() && returned.as_any_promise().is_none() {
        return Err(returned);
    }
    // Like Node, fail on any other truthy value, a Promise included: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/tls/wrap.js#L1671-L1688
    if returned.to_boolean() {
        let received = JSGlobalObject::determine_specific_type(global, returned)
            .map_err(|e| global.take_exception(e))?;
        return Err(global
            .err(
                ErrorCode::INVALID_RETURN_VALUE,
                format_args!(
                    "Expected undefined or an Error to be returned from the \"tls.checkServerIdentity\" function but got {received}."
                ),
            )
            .to_js());
    }
    // > On success, returns <undefined>
    Ok(())
}
