use core::ffi::{c_char, c_int, c_long, c_void};

use crate::api::bun_secure_context::SecureContext;
use bun_boringssl_sys as boringssl;
use bun_core::{String as BunString, ZigString, strings};
use bun_jsc::JsClass as _;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, ZigStringJsc as _,
};

use crate::api::bun_x509 as X509;

// ──────────────────────────────────────────────────────────────────────────
// Local BoringSSL FFI surface not yet in bun_boringssl_sys.
// Declared here per port rules (call the linked C symbol directly); migrate
// into `bun_boringssl_sys` once the bindgen pass covers them.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_camel_case_types, non_upper_case_globals)]
pub(super) mod ffi {
    use super::boringssl::{SSL, SSL_CTX, X509, X509_STORE, X509_STORE_CTX, struct_stack_st_X509};
    use core::ffi::{c_char, c_int, c_long, c_uint, c_void};

    // Re-export the one decl whose `*const c_char` NUL-terminated arg keeps a
    // genuine caller precondition; the rest are re-declared `safe fn` below.
    pub(crate) use super::boringssl::SSL_set_tlsext_host_name;

    // Opaque handles missing from boringssl_sys.
    bun_opaque::opaque_ffi! {
        pub(crate) struct SSL_SESSION;
        pub(crate) struct SSL_CIPHER;
        pub(crate) struct EVP_PKEY;
        pub(crate) struct EC_KEY;
        pub(crate) struct EC_GROUP;
    }

    // ssl.h
    pub(crate) const TLSEXT_NAMETYPE_host_name: c_int = 0;

    // evp.h key types (NID values)
    pub(crate) const EVP_PKEY_RSA: c_int = 6;
    pub(crate) const EVP_PKEY_RSA_PSS: c_int = 912;
    pub(crate) const EVP_PKEY_DSA: c_int = 116;
    pub(crate) const EVP_PKEY_EC: c_int = 408;
    pub(crate) const EVP_PKEY_DH: c_int = 28;
    pub(crate) const EVP_PKEY_X25519: c_int = 948;
    pub(crate) const EVP_PKEY_X448: c_int = 961;

    // obj_mac.h
    pub(crate) const NID_ED25519: c_int = 949;
    pub(crate) const NID_ED448: c_int = 960;
    pub(crate) const NID_id_GostR3410_2001: c_int = 811;
    pub(crate) const NID_id_GostR3410_2012_256: c_int = 979;
    pub(crate) const NID_id_GostR3410_2012_512: c_int = 980;

    // ffi-safe-fn: every handle type below (`SSL`, `X509`, `SSL_CIPHER`,
    // `EVP_PKEY`, `EC_KEY`, `EC_GROUP`) is an `opaque_ffi!` ZST — `&T`
    // dereferences zero bytes, carries no `dereferenceable`/`noalias`
    // obligation, and the `UnsafeCell` body lets BoringSSL mutate through a
    // shared ref. Functions whose *only* pointer arguments are such handles
    // (plus by-value scalars) therefore have no caller-side precondition and
    // are declared `safe fn`; callers convert raw pointers via the
    // const-asserted `T::opaque_ref` (panics on null, which every call site
    // already guards). Functions that additionally take raw out-params /
    // caller-owned buffers / +1 ownership pointers keep `unsafe fn`.
    unsafe extern "C" {
        // ── SSL session/handshake info ───────────────────────────────────
        pub(crate) safe fn SSL_get_version(ssl: &SSL) -> *const c_char;
        pub(crate) safe fn SSL_get_peer_certificate(ssl: &SSL) -> *mut X509;
        pub(crate) safe fn SSL_get_certificate(ssl: &SSL) -> *mut X509;
        pub(crate) safe fn SSL_set_max_send_fragment(ssl: &SSL, max_send_fragment: usize) -> c_int;
        // SAFETY (unsafe fn): `buf` must be writable for `count` bytes.
        pub(crate) fn SSL_get_finished(ssl: *const SSL, buf: *mut c_void, count: usize) -> usize;
        // SAFETY (unsafe fn): `buf` must be writable for `count` bytes.
        pub(crate) fn SSL_get_peer_finished(
            ssl: *const SSL,
            buf: *mut c_void,
            count: usize,
        ) -> usize;
        // Opaque-ZST `&SSL` + `Option<&mut _>` out-params (NPO ⇒ ABI-identical
        // to nullable `*mut _`); BoringSSL writes each non-null slot in place.
        // No remaining caller-side precondition.
        pub(crate) safe fn SSL_get_shared_sigalgs(
            ssl: &SSL,
            idx: c_int,
            psign: Option<&mut c_int>,
            phash: Option<&mut c_int>,
            psignhash: Option<&mut c_int>,
            rsig: Option<&mut u8>,
            rhash: Option<&mut u8>,
        ) -> c_int;
        // SAFETY (unsafe fn): `out`/`label`/`context` must be valid for the given lengths.
        pub(crate) fn SSL_export_keying_material(
            ssl: *mut SSL,
            out: *mut u8,
            out_len: usize,
            label: *const c_char,
            label_len: usize,
            context: *const u8,
            context_len: usize,
            use_context: c_int,
        ) -> c_int;
        pub(crate) safe fn SSL_session_reused(ssl: &SSL) -> c_int;
        pub(crate) safe fn SSL_get_privatekey(ssl: &SSL) -> *mut EVP_PKEY;

        // ── SSL_SESSION ───────────────────────────────────────────────────
        pub(crate) safe fn SSL_get_session(ssl: &SSL) -> *mut SSL_SESSION;
        // Both handles are opaque-ZST refs (`UnsafeCell` body); BoringSSL bumps
        // `session`'s refcount internally — no caller-side precondition.
        pub(crate) safe fn SSL_set_session(ssl: &SSL, session: &SSL_SESSION) -> c_int;
        // SAFETY (unsafe fn): consumes a +1 reference; `session` must be uniquely owned or null.
        pub(crate) fn SSL_SESSION_free(session: *mut SSL_SESSION);
        // Opaque-ZST `&SSL_SESSION` + `&mut` out-params (FFI-nonnull) ⇒ no
        // caller-side precondition; BoringSSL writes a borrowed ptr/len pair.
        pub(crate) safe fn SSL_SESSION_get0_ticket(
            session: &SSL_SESSION,
            out_ticket: &mut *const u8,
            out_len: &mut usize,
        );
        // SAFETY (unsafe fn): `pp` (when non-null) must point to a buffer with capacity for the encoded session.
        pub(crate) fn i2d_SSL_SESSION(session: *mut SSL_SESSION, pp: *mut *mut u8) -> c_int;
        // SAFETY (unsafe fn): `*pp` must be readable for `length` bytes.
        pub(crate) fn d2i_SSL_SESSION(
            a: *mut *mut SSL_SESSION,
            pp: *mut *const u8,
            length: c_long,
        ) -> *mut SSL_SESSION;

        // ── SSL_CIPHER ────────────────────────────────────────────────────
        pub(crate) safe fn SSL_get_current_cipher(ssl: &SSL) -> *const SSL_CIPHER;
        pub(crate) safe fn SSL_CIPHER_get_name(cipher: &SSL_CIPHER) -> *const c_char;
        pub(crate) safe fn SSL_CIPHER_standard_name(cipher: &SSL_CIPHER) -> *const c_char;
        pub(crate) safe fn SSL_CIPHER_get_version(cipher: &SSL_CIPHER) -> *const c_char;

        // ── X509 ─────────────────────────────────────────────────────────
        pub(crate) safe fn X509_up_ref(x: &X509) -> c_int;
        // ffi-safe-fn: BoringSSL's `sk_value` takes `const OPENSSL_STACK *` and
        // returns the element at `i` (or NULL if out-of-range — see
        // `crypto/stack/stack.cc`); it never dereferences past the header it
        // owns. The Rust `struct_stack_st_X509` is an `opaque_ffi!` ZST, so
        // `&struct_stack_st_X509` is a thin non-null pointer with no
        // `dereferenceable`/`noalias` obligation, and the `*mut X509` return is
        // a mut→mut narrowing of the C `void *` slot. No remaining caller-side
        // precondition; convert via `struct_stack_st_X509::opaque_ref` (panics
        // on null, which both call sites already guard).
        #[link_name = "sk_value"]
        pub(crate) safe fn sk_X509_value(sk: &struct_stack_st_X509, i: usize) -> *mut X509;

        // ── EVP / EC ──────────────────────────────────────────────────────
        pub(crate) safe fn EVP_PKEY_id(pkey: &EVP_PKEY) -> c_int;
        pub(crate) safe fn EVP_PKEY_bits(pkey: &EVP_PKEY) -> c_int;
        // Returns a +1 `EC_KEY*` (caller owns; the sole call site
        // intentionally leaks it). The only pointer arg is an
        // opaque-ZST `&EVP_PKEY`, so the call itself has no precondition.
        pub(crate) safe fn EVP_PKEY_get1_EC_KEY(pkey: &EVP_PKEY) -> *mut EC_KEY;
        // Result is borrowed from `key`; opaque-ZST ref ⇒ no caller precondition.
        pub(crate) safe fn EC_KEY_get0_group(key: &EC_KEY) -> *const EC_GROUP;
        pub(crate) safe fn EC_GROUP_get_curve_name(group: &EC_GROUP) -> c_int;

        // ── OBJ ──────────────────────────────────────────────────────────
        // Pure NID→short-name lookup; takes a by-value int and returns a
        // pointer into BoringSSL's static OID table (or null). No pointer
        // precondition, so declare `safe fn`.
        pub(crate) safe fn OBJ_nid2sn(nid: c_int) -> *const c_char;

        // ── Safe re-declarations of upstream `bun_boringssl_sys` symbols ──
        // Upstream still takes raw `*const/*mut SSL`; the opaque-ZST `&SSL`
        // (UnsafeCell body, zero-byte deref, no `noalias`) plus by-value
        // scalars / `&mut` out-params leave no caller-side precondition, so
        // declare them `safe fn` here and route callers through
        // `SSL::opaque_ref` (panics on null, which every site already guards).
        pub(crate) safe fn SSL_get_servername(ssl: &SSL, ty: c_int) -> *const c_char;
        pub(crate) safe fn SSL_is_init_finished(ssl: &SSL) -> c_int;
        pub(crate) safe fn SSL_get_peer_cert_chain(ssl: &SSL) -> *mut struct_stack_st_X509;
        pub(crate) safe fn SSL_get0_alpn_selected(
            ssl: &SSL,
            out_data: &mut *const u8,
            out_len: &mut c_uint,
        );
        pub(crate) safe fn SSL_get_ex_data(ssl: &SSL, idx: c_int) -> *mut c_void;
        /// Save/restore the per-loop BIO routing state around in-handshake JS
        /// callbacks (defined in usockets' openssl.c).
        pub(crate) safe fn us_internal_ssl_loop_state_save(ssl: &SSL, out5: *mut *mut c_void);
        pub(crate) safe fn us_internal_ssl_loop_state_restore(saved5: *mut *mut c_void);
        pub(crate) safe fn SSL_renegotiate(ssl: &SSL) -> c_int;
        pub(crate) safe fn SSL_set_renegotiate_mode(
            ssl: &SSL,
            mode: super::boringssl::ssl_renegotiate_mode_t,
        );
        pub(crate) safe fn SSL_set_verify(
            ssl: &SSL,
            mode: c_int,
            callback: super::boringssl::SSL_verify_cb,
        );
        pub(crate) safe fn SSL_is_server(ssl: &SSL) -> c_int;
        // Opaque-ZST `&SSL` + opaque `*mut c_void` payload (BoringSSL stores
        // it verbatim, never derefs) ⇒ no caller-side precondition.
        pub(crate) safe fn SSL_set_ex_data(ssl: &SSL, idx: c_int, data: *mut c_void) -> c_int;
        // Returns the borrowed parent CTX (always non-null for a live `SSL*`).
        pub(crate) safe fn SSL_get_SSL_CTX(ssl: &SSL) -> *mut SSL_CTX;
        // Swaps the cert/key/chain (and session-related state) this connection
        // serves to those of `ctx`; takes its own reference to `ctx`.
        pub(crate) fn SSL_set_SSL_CTX(ssl: *mut SSL, ctx: *mut SSL_CTX) -> *mut SSL_CTX;
        // Apply `ctx`'s leaf certificate / private key / extra chain directly
        // to the connection - SSL_set_SSL_CTX alone does not retarget the
        // certificate once ClientHello processing has reached ALPN selection.
        pub(crate) fn SSL_CTX_get0_certificate(ctx: *const SSL_CTX) -> *mut core::ffi::c_void;
        pub(crate) fn SSL_CTX_get0_privatekey(ctx: *const SSL_CTX) -> *mut core::ffi::c_void;
        pub(crate) fn SSL_use_certificate(
            ssl: *mut SSL,
            x509: *mut core::ffi::c_void,
        ) -> core::ffi::c_int;
        pub(crate) fn SSL_use_PrivateKey(
            ssl: *mut SSL,
            pkey: *mut core::ffi::c_void,
        ) -> core::ffi::c_int;
        pub(crate) fn SSL_CTX_get0_chain_certs(
            ctx: *const SSL_CTX,
            out_chain: *mut *mut core::ffi::c_void,
        ) -> core::ffi::c_int;
        pub(crate) fn SSL_set1_chain(
            ssl: *mut SSL,
            chain: *mut core::ffi::c_void,
        ) -> core::ffi::c_int;
        // Stores `cb`/`arg` opaquely on the CTX (BoringSSL never derefs `arg`
        // outside the callback). Opaque-ZST `&SSL_CTX` + by-value fn-ptr +
        // opaque `*mut c_void` ⇒ no caller-side precondition.
        pub(crate) safe fn SSL_CTX_set_alpn_select_cb(
            ctx: &SSL_CTX,
            cb: Option<
                unsafe extern "C" fn(
                    ssl: *mut SSL,
                    out: *mut *const u8,
                    out_len: *mut u8,
                    in_: *const u8,
                    in_len: c_uint,
                    arg: *mut c_void,
                ) -> c_int,
            >,
            arg: *mut c_void,
        );
        // Returns the borrowed cert store of a live `SSL_CTX*`.
        pub(crate) safe fn SSL_CTX_get_cert_store(ctx: &SSL_CTX) -> *mut X509_STORE;
        // Emptiness probe for a cert store: `get0_objects` borrows the
        // object stack and `OPENSSL_sk_num(NULL)` returns 0.
        pub(crate) fn X509_STORE_get0_objects(store: *mut X509_STORE) -> *mut c_void;
        pub(crate) fn OPENSSL_sk_num(sk: *const c_void) -> usize;
        // The process-wide default root store; up-refs before returning, so
        // the caller owns a reference it must release with X509_STORE_free.
        pub(crate) fn us_get_shared_default_ca_store() -> *mut X509_STORE;
        pub(crate) fn X509_STORE_free(store: *mut X509_STORE);
        // X509_STORE_CTX lifecycle for issuer lookups; `new` allocates,
        // `init` borrows the store, `free` releases. Used to extend the peer
        // certificate chain through the local trust store.
        pub(crate) fn X509_STORE_CTX_new() -> *mut X509_STORE_CTX;
        pub(crate) fn X509_STORE_CTX_init(
            ctx: *mut X509_STORE_CTX,
            store: *mut X509_STORE,
            x509: *mut X509,
            chain: *mut struct_stack_st_X509,
        ) -> c_int;
        pub(crate) fn X509_STORE_CTX_free(ctx: *mut X509_STORE_CTX);
        // Writes a +1 X509 reference to `*issuer` on success (> 0).
        pub(crate) fn X509_STORE_CTX_get1_issuer(
            issuer: *mut *mut X509,
            ctx: *mut X509_STORE_CTX,
            x: *mut X509,
        ) -> c_int;
        // Returns X509_V_OK (0) when `issuer` could have issued `subject`.
        pub(crate) fn X509_check_issued(issuer: *mut X509, subject: *mut X509) -> c_int;
    }
}
use crate::node::StringOrBuffer;

// The `#[bun_jsc::host_fn]` shims live on `NewSocket<SSL>` in `socket_body.rs`
// and forward into these free helpers — keep them as plain `fn`s.
// this file is `mod`-included from BOTH `socket/mod.rs` and
// `socket/socket_body.rs`; `super::TLSSocket` resolves to the parent's
// `NewSocket<true>` in either compilation, whereas the absolute path
// `crate::api::TLSSocket` always picked the `mod.rs` shape and broke the
// `socket_body` instance.
type This = super::TLSSocket;

pub(super) fn get_servername(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };

    let servername = ffi::SSL_get_servername(
        boringssl::SSL::opaque_ref(ssl_ptr),
        ffi::TLSEXT_NAMETYPE_host_name,
    );
    if servername.is_null() {
        return Ok(JSValue::UNDEFINED);
    }
    // SAFETY: SSL_get_servername returns a NUL-terminated C string owned by the SSL session.
    let slice = unsafe { bun_core::ffi::cstr(servername) }.to_bytes();
    Ok(ZigString::from_utf8(slice).to_js(global))
}

pub(super) fn set_servername(
    this: &This,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    if this.is_server() {
        return Err(global.throw(format_args!(
            "Cannot issue SNI from a TLS server-side socket"
        )));
    }

    let [server_name] = frame.arguments_as_array::<1>();
    if frame.arguments_count() < 1 {
        return Err(global.throw(format_args!("Expected 1 argument")));
    }

    if !server_name.is_string() {
        return Err(global.throw(format_args!("Expected \"serverName\" to be a string")));
    }

    let slice: Box<[u8]> = server_name
        .get_zig_string(global)?
        .to_owned_slice()
        .into_boxed_slice();
    // Drop replaces the old value.
    this.server_name.set(Some(slice));

    let host = this.server_name.get().as_deref().unwrap();
    if !host.is_empty() {
        let Some(ssl_ptr) = this.socket.get().ssl() else {
            return Ok(JSValue::UNDEFINED);
        };

        if ffi::SSL_is_init_finished(boringssl::SSL::opaque_ref(ssl_ptr)) != 0 {
            // match node.js exceptions
            return Err(global.throw(format_args!("Already started.")));
        }
        let host_z = bun_core::ZBox::from_bytes(host);
        // SAFETY: `host_z` is NUL-terminated; FFI reads until NUL.
        unsafe { ffi::SSL_set_tlsext_host_name(ssl_ptr, host_z.as_ptr()) };
    }

    Ok(JSValue::UNDEFINED)
}

pub(super) fn get_peer_x509_certificate(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    let cert = ffi::SSL_get_peer_certificate(boringssl::SSL::opaque_ref(ssl_ptr));
    if !cert.is_null() {
        return X509::to_js_object(boringssl::X509::opaque_mut(cert), global);
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn get_x509_certificate(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    let cert = ffi::SSL_get_certificate(boringssl::SSL::opaque_ref(ssl_ptr));
    if !cert.is_null() {
        // X509_up_ref bumps the refcount before handing to JS.
        ffi::X509_up_ref(boringssl::X509::opaque_ref(cert));
        return X509::to_js_object(boringssl::X509::opaque_mut(cert), global);
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn get_tls_version(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding();

    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::NULL);
    };
    let version = ffi::SSL_get_version(boringssl::SSL::opaque_ref(ssl_ptr));
    if version.is_null() {
        return Ok(JSValue::NULL);
    }
    // SAFETY: SSL_get_version returns a static NUL-terminated C string.
    let slice = unsafe { bun_core::ffi::cstr(version) }.to_bytes();
    if slice.is_empty() {
        return Ok(JSValue::NULL);
    }
    Ok(ZigString::from_utf8(slice).to_js(global))
}

pub(super) fn set_max_send_fragment(
    this: &This,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding();

    let [arg] = frame.arguments_as_array::<1>();

    if frame.arguments_count() < 1 {
        return Err(global.throw(format_args!("Expected size to be a number")));
    }

    if !arg.is_number() {
        return Err(global.throw(format_args!("Expected size to be a number")));
    }
    let size = arg.coerce_to_int64(global)?;
    if !(512..=16384).contains(&size) {
        return Ok(JSValue::FALSE);
    }

    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::FALSE);
    };
    Ok(JSValue::from(
        ffi::SSL_set_max_send_fragment(
            boringssl::SSL::opaque_ref(ssl_ptr),
            usize::try_from(size).expect("int cast"),
        ) == 1,
    ))
}

pub(super) fn get_peer_certificate(
    this: &This,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding();

    let [arg] = frame.arguments_as_array::<1>();
    let mut abbreviated: bool = true;
    if frame.arguments_count() > 0 {
        if !arg.is_boolean() {
            return Err(global.throw(format_args!("Expected abbreviated to be a boolean")));
        }
        abbreviated = arg.to_boolean();
    }

    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    let is_server_ssl = ffi::SSL_is_server(boringssl::SSL::opaque_ref(ssl_ptr)) != 0;

    if abbreviated {
        if is_server_ssl {
            // SSL_get_peer_certificate returns a +1 reference; we must free it.
            // X509::to_js only borrows the pointer (X509View is non-owning).
            let cert = ffi::SSL_get_peer_certificate(boringssl::SSL::opaque_ref(ssl_ptr));
            if !cert.is_null() {
                // SAFETY: `c` is the +1 X509 reference returned by SSL_get_peer_certificate; we own it.
                let _guard = scopeguard::guard(cert, |c| unsafe { boringssl::X509_free(c) });
                return X509::to_js(boringssl::X509::opaque_mut(cert), global);
            }
        }

        let cert_chain = ffi::SSL_get_peer_cert_chain(boringssl::SSL::opaque_ref(ssl_ptr));
        if cert_chain.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        let cert = ffi::sk_X509_value(boringssl::struct_stack_st_X509::opaque_ref(cert_chain), 0);
        if cert.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        return X509::to_js(boringssl::X509::opaque_mut(cert), global);
    }

    let mut cert: *mut boringssl::X509 = core::ptr::null_mut();
    if is_server_ssl {
        // SSL_get_peer_certificate returns a +1 reference; we must free it.
        cert = ffi::SSL_get_peer_certificate(boringssl::SSL::opaque_ref(ssl_ptr));
    }
    let _guard = scopeguard::guard(cert, |c| {
        if !c.is_null() {
            // SAFETY: `c` is the +1 X509 reference returned by SSL_get_peer_certificate; we own it.
            unsafe { boringssl::X509_free(c) };
        }
    });

    let cert_chain = ffi::SSL_get_peer_cert_chain(boringssl::SSL::opaque_ref(ssl_ptr));
    let first_cert: *mut boringssl::X509 = if !cert.is_null() {
        cert
    } else if !cert_chain.is_null() {
        ffi::sk_X509_value(boringssl::struct_stack_st_X509::opaque_ref(cert_chain), 0)
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
    let first_obj = X509::to_js(boringssl::X509::opaque_mut(first_cert), global)?;
    // Link each certificate to its predecessor immediately so every object in
    // the chain is reachable from the stack-rooted `first_obj` before the next
    // `X509::to_js` allocation can trigger a GC - a heap-backed Vec<JSValue>
    // is not stack-scanned.
    let mut prev_obj: JSValue = first_obj;
    let mut last_cert: *mut boringssl::X509 = first_cert;
    if !cert_chain.is_null() {
        let mut i: usize = if cert.is_null() { 1 } else { 0 };
        loop {
            let next =
                ffi::sk_X509_value(boringssl::struct_stack_st_X509::opaque_ref(cert_chain), i);
            if next.is_null() {
                break;
            }
            let obj = X509::to_js(boringssl::X509::opaque_mut(next), global)?;
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
        let mut store = ffi::SSL_CTX_get_cert_store(boringssl::SSL_CTX::opaque_ref(
            ffi::SSL_get_SSL_CTX(boringssl::SSL::opaque_ref(ssl_ptr)),
        ));
        // A context built without an explicit `ca` (and without requestCert,
        // which installs the shared roots) carries an empty store and the
        // issuer walk would stop at whatever the peer sent. Fall back to the
        // process-wide default roots the way Node's per-context store always
        // contains the bundled roots. The getter up-refs, so the temporary
        // reference is released after the walk.
        let mut shared_store: *mut boringssl::X509_STORE = core::ptr::null_mut();
        if store.is_null() || ffi::OPENSSL_sk_num(ffi::X509_STORE_get0_objects(store)) == 0 {
            shared_store = ffi::us_get_shared_default_ca_store();
            if !shared_store.is_null() {
                store = shared_store;
            }
        }
        let store_ctx = ffi::X509_STORE_CTX_new();
        if !store_ctx.is_null() {
            if !store.is_null()
                && ffi::X509_STORE_CTX_init(
                    store_ctx,
                    store,
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                ) == 1
            {
                let mut extras: Vec<*mut boringssl::X509> = Vec::new();
                // Cap the walk so a cyclic store cannot loop forever.
                while extras.len() < 16 && ffi::X509_check_issued(last_cert, last_cert) != 0 {
                    let mut issuer: *mut boringssl::X509 = core::ptr::null_mut();
                    if ffi::X509_STORE_CTX_get1_issuer(&raw mut issuer, store_ctx, last_cert) <= 0
                        || issuer.is_null()
                    {
                        break;
                    }
                    match X509::to_js(boringssl::X509::opaque_mut(issuer), global) {
                        Ok(obj) => {
                            prev_obj.put(global, b"issuerCertificate", obj);
                            prev_obj = obj;
                        }
                        Err(e) => {
                            boringssl::X509_free(issuer);
                            for extra in extras {
                                boringssl::X509_free(extra);
                            }
                            ffi::X509_STORE_CTX_free(store_ctx);
                            if !shared_store.is_null() {
                                ffi::X509_STORE_free(shared_store);
                            }
                            return Err(e);
                        }
                    }
                    extras.push(issuer);
                    last_cert = issuer;
                }
                last_is_self_issued = ffi::X509_check_issued(last_cert, last_cert) == 0;
                for extra in extras {
                    boringssl::X509_free(extra);
                }
            }
            ffi::X509_STORE_CTX_free(store_ctx);
        }
        if !shared_store.is_null() {
            ffi::X509_STORE_free(shared_store);
        }
    }

    // A self-issued terminal certificate references itself, like Node.
    if last_is_self_issued {
        prev_obj.put(global, b"issuerCertificate", prev_obj);
    }
    Ok(first_obj)
}

pub(super) fn get_certificate(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    let cert = ffi::SSL_get_certificate(boringssl::SSL::opaque_ref(ssl_ptr));

    if !cert.is_null() {
        return X509::to_js(boringssl::X509::opaque_mut(cert), global);
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn get_tls_finished_message(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    // We cannot just pass nullptr to SSL_get_finished()
    // because it would further be propagated to memcpy(),
    // where the standard requirements as described in ISO/IEC 9899:2011
    // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
    // Thus, we use a dummy byte.
    let mut dummy: [u8; 1] = [0; 1];
    // SAFETY: ssl_ptr is a live *mut SSL; dummy is a valid 1-byte writable buffer.
    let size = unsafe {
        ffi::SSL_get_finished(
            ssl_ptr,
            dummy.as_mut_ptr().cast::<c_void>(),
            core::mem::size_of_val(&dummy),
        )
    };
    if size == 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let buffer_size = size;
    let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
    let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr.cast::<c_void>();

    // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr points to a buffer_size-byte JS ArrayBuffer kept alive on the stack.
    let result_size = unsafe { ffi::SSL_get_finished(ssl_ptr, buffer_ptr, buffer_size) };
    debug_assert!(result_size == size);
    Ok(buffer)
}

pub(super) fn get_shared_sigalgs(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding();

    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::NULL);
    };

    let nsig = ffi::SSL_get_shared_sigalgs(
        boringssl::SSL::opaque_ref(ssl_ptr),
        0,
        None,
        None,
        None,
        None,
        None,
    );

    let array = JSValue::create_empty_array(global, usize::try_from(nsig).expect("int cast"))?;

    for i in 0..usize::try_from(nsig).expect("int cast") {
        let mut hash_nid: c_int = 0;
        let mut sign_nid: c_int = 0;
        let sig_with_md: &[u8];

        ffi::SSL_get_shared_sigalgs(
            boringssl::SSL::opaque_ref(ssl_ptr),
            c_int::try_from(i).expect("int cast"),
            Some(&mut sign_nid),
            Some(&mut hash_nid),
            None,
            None,
            None,
        );
        match sign_nid {
            ffi::EVP_PKEY_RSA => {
                sig_with_md = b"RSA";
            }
            ffi::EVP_PKEY_RSA_PSS => {
                sig_with_md = b"RSA-PSS";
            }
            ffi::EVP_PKEY_DSA => {
                sig_with_md = b"DSA";
            }
            ffi::EVP_PKEY_EC => {
                sig_with_md = b"ECDSA";
            }
            ffi::NID_ED25519 => {
                sig_with_md = b"Ed25519";
            }
            ffi::NID_ED448 => {
                sig_with_md = b"Ed448";
            }
            ffi::NID_id_GostR3410_2001 => {
                sig_with_md = b"gost2001";
            }
            ffi::NID_id_GostR3410_2012_256 => {
                sig_with_md = b"gost2012_256";
            }
            ffi::NID_id_GostR3410_2012_512 => {
                sig_with_md = b"gost2012_512";
            }
            _ => {
                let sn_str = ffi::OBJ_nid2sn(sign_nid);
                if !sn_str.is_null() {
                    // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
                    sig_with_md = unsafe { bun_core::ffi::cstr(sn_str) }.to_bytes();
                } else {
                    sig_with_md = b"UNDEF";
                }
            }
        }

        let hash_str = ffi::OBJ_nid2sn(hash_nid);
        if !hash_str.is_null() {
            // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
            let hash_slice = unsafe { bun_core::ffi::cstr(hash_str) }.to_bytes();
            let mut buffer: Vec<u8> = Vec::with_capacity(sig_with_md.len() + hash_slice.len() + 1);
            buffer.extend_from_slice(sig_with_md);
            buffer.push(b'+');
            buffer.extend_from_slice(hash_slice);
            array.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                ZigString::from_utf8(&buffer).to_js(global),
            )?;
        } else {
            let mut buffer: Vec<u8> = Vec::with_capacity(sig_with_md.len() + 6);
            buffer.extend_from_slice(sig_with_md);
            buffer.extend_from_slice(b"+UNDEF");
            array.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                ZigString::from_utf8(&buffer).to_js(global),
            )?;
        }
    }
    Ok(array)
}

pub(super) fn get_cipher(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    let cipher = ffi::SSL_get_current_cipher(boringssl::SSL::opaque_ref(ssl_ptr));
    let result = JSValue::create_empty_object(global, 0);

    if cipher.is_null() {
        result.put(global, b"name", JSValue::NULL);
        result.put(global, b"standardName", JSValue::NULL);
        result.put(global, b"version", JSValue::NULL);
        return Ok(result);
    }
    let cipher = ffi::SSL_CIPHER::opaque_ref(cipher);

    let name = ffi::SSL_CIPHER_get_name(cipher);
    if name.is_null() {
        result.put(global, b"name", JSValue::NULL);
    } else {
        // SAFETY: SSL_CIPHER_get_name returns a static NUL-terminated C string.
        let s = unsafe { bun_core::ffi::cstr(name) }.to_bytes();
        result.put(global, b"name", ZigString::from_utf8(s).to_js(global));
    }

    let standard_name = ffi::SSL_CIPHER_standard_name(cipher);
    if standard_name.is_null() {
        result.put(global, b"standardName", JSValue::NULL);
    } else {
        // SAFETY: SSL_CIPHER_standard_name returns a static NUL-terminated C string.
        let s = unsafe { bun_core::ffi::cstr(standard_name) }.to_bytes();
        result.put(
            global,
            b"standardName",
            ZigString::from_utf8(s).to_js(global),
        );
    }

    let version = ffi::SSL_CIPHER_get_version(cipher);
    if version.is_null() {
        result.put(global, b"version", JSValue::NULL);
    } else {
        // SAFETY: SSL_CIPHER_get_version returns a static NUL-terminated C string.
        let s = unsafe { bun_core::ffi::cstr(version) }.to_bytes();
        result.put(global, b"version", ZigString::from_utf8(s).to_js(global));
    }

    Ok(result)
}

pub(super) fn get_tls_peer_finished_message(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    // We cannot just pass nullptr to SSL_get_peer_finished()
    // because it would further be propagated to memcpy(),
    // where the standard requirements as described in ISO/IEC 9899:2011
    // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
    // Thus, we use a dummy byte.
    let mut dummy: [u8; 1] = [0; 1];
    // SAFETY: ssl_ptr is a live *mut SSL; dummy is a valid 1-byte writable buffer.
    let size = unsafe {
        ffi::SSL_get_peer_finished(
            ssl_ptr,
            dummy.as_mut_ptr().cast::<c_void>(),
            core::mem::size_of_val(&dummy),
        )
    };
    if size == 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let buffer_size = size;
    let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
    let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr.cast::<c_void>();

    // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr points to a buffer_size-byte JS ArrayBuffer kept alive on the stack.
    let result_size = unsafe { ffi::SSL_get_peer_finished(ssl_ptr, buffer_ptr, buffer_size) };
    debug_assert!(result_size == size);
    Ok(buffer)
}

/// `tlsSocket.setKeyCert(secureContext)` - serve this connection's identity
/// from the given context: SSL_set_SSL_CTX swaps the cert/key/chain used for
/// the rest of the handshake (Node calls it from ALPNCallback / SNICallback).
pub(crate) fn set_key_cert(
    this: &This,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    if this.socket.get().is_detached() {
        return Ok(JSValue::UNDEFINED);
    }
    let [arg] = frame.arguments_as_array::<1>();
    if frame.arguments_count() < 1 {
        return Err(global.throw(format_args!("setKeyCert requires a SecureContext")));
    }
    let Some(sc) = SecureContext::from_js(arg) else {
        return Err(global.throw(format_args!("setKeyCert requires a SecureContext")));
    };
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    // SAFETY: `sc` is a live SecureContext; borrow() hands back an owned
    // reference and SSL_set_SSL_CTX takes its own, so release the temporary.
    unsafe {
        let ctx = (*sc).borrow();
        ffi::SSL_set_SSL_CTX(ssl_ptr.cast(), ctx.cast());
        // SSL_set_SSL_CTX stops retargeting the certificate once ClientHello
        // processing has reached ALPN selection, and Node supports calling
        // setKeyCert from ALPNCallback - apply the identity directly.
        let leaf = ffi::SSL_CTX_get0_certificate(ctx.cast());
        let pkey = ffi::SSL_CTX_get0_privatekey(ctx.cast());
        if !leaf.is_null() && !pkey.is_null() {
            let ok_cert = ffi::SSL_use_certificate(ssl_ptr.cast(), leaf);
            let ok_key = ffi::SSL_use_PrivateKey(ssl_ptr.cast(), pkey);
            let mut ok_chain = 1;
            let mut chain: *mut core::ffi::c_void = core::ptr::null_mut();
            if ffi::SSL_CTX_get0_chain_certs(ctx.cast(), &raw mut chain) == 1 && !chain.is_null() {
                ok_chain = ffi::SSL_set1_chain(ssl_ptr.cast(), chain);
            }
            if ok_cert != 1 || ok_key != 1 || ok_chain != 1 {
                boringssl::SSL_CTX_free(ctx.cast());
                return Err(global.throw(format_args!("setKeyCert failed to apply the context")));
            }
        }
        boringssl::SSL_CTX_free(ctx.cast());
    }
    Ok(JSValue::UNDEFINED)
}

pub(crate) fn export_keying_material(
    this: &This,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    if this.socket.get().is_detached() {
        return Ok(JSValue::UNDEFINED);
    }

    let [length_arg, label_arg, context_arg] = frame.arguments_as_array::<3>();
    if frame.arguments_count() < 2 {
        return Err(global.throw(format_args!("Expected length and label to be provided")));
    }
    if !length_arg.is_number() {
        return Err(global.throw(format_args!("Expected length to be a number")));
    }

    let length = length_arg.coerce_to_int64(global)?;
    if length < 0 {
        return Err(global.throw(format_args!("Expected length to be a positive number")));
    }

    if !label_arg.is_string() {
        return Err(global.throw(format_args!("Expected label to be a string")));
    }

    let label = label_arg.to_slice_or_null(global)?;
    let label_slice = label.slice();
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };

    if frame.arguments_count() > 2 {
        if let Some(sb) = StringOrBuffer::from_js(global, context_arg)? {
            let context_slice = sb.slice();

            let buffer_size = usize::try_from(length).expect("int cast");
            let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
            let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr;

            // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr/label_slice/context_slice are valid for the lengths passed.
            let result = unsafe {
                ffi::SSL_export_keying_material(
                    ssl_ptr,
                    buffer_ptr,
                    buffer_size,
                    label_slice.as_ptr().cast::<c_char>(),
                    label_slice.len(),
                    context_slice.as_ptr(),
                    context_slice.len(),
                    1,
                )
            };
            if result != 1 {
                return Err(global.throw_value(get_ssl_exception(
                    global,
                    b"Failed to export keying material",
                )));
            }
            Ok(buffer)
        } else {
            Err(global.throw(format_args!(
                "Expected context to be a string, Buffer or TypedArray"
            )))
        }
    } else {
        let buffer_size = usize::try_from(length).expect("int cast");
        let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
        let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr;

        // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr/label_slice are valid for the lengths passed; context is null with use_context=0.
        let result = unsafe {
            ffi::SSL_export_keying_material(
                ssl_ptr,
                buffer_ptr,
                buffer_size,
                label_slice.as_ptr().cast::<c_char>(),
                label_slice.len(),
                core::ptr::null(),
                0,
                0,
            )
        };
        if result != 1 {
            return Err(global.throw_value(get_ssl_exception(
                global,
                b"Failed to export keying material",
            )));
        }
        Ok(buffer)
    }
}

pub(super) fn get_ephemeral_key_info(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::NULL);
    };
    if ffi::SSL_is_server(boringssl::SSL::opaque_ref(ssl_ptr)) != 0 {
        return Ok(JSValue::NULL);
    }
    let result = JSValue::create_empty_object(global, 0);

    // TODO: investigate better option or compatible way to get the key
    // this implementation follows nodejs but for BoringSSL SSL_get_server_tmp_key will always return 0
    // wich will result in a empty object
    // let mut raw_key: *mut boringssl::EVP_PKEY = core::ptr::null_mut();
    // if unsafe { boringssl::SSL_get_server_tmp_key(ssl_ptr, &mut raw_key) } == 0 {
    //     return Ok(result);
    // }
    let raw_key: *mut ffi::EVP_PKEY = ffi::SSL_get_privatekey(boringssl::SSL::opaque_ref(ssl_ptr));
    if raw_key.is_null() {
        return Ok(result);
    }
    let pkey = ffi::EVP_PKEY::opaque_ref(raw_key);

    let kid = ffi::EVP_PKEY_id(pkey);
    let bits = ffi::EVP_PKEY_bits(pkey);

    match kid {
        ffi::EVP_PKEY_DH => {
            result.put(global, b"type", BunString::static_("DH").to_js(global)?);
            result.put(global, b"size", JSValue::js_number(f64::from(bits)));
        }
        ffi::EVP_PKEY_EC | ffi::EVP_PKEY_X25519 | ffi::EVP_PKEY_X448 => {
            let curve_name: &[u8];
            if kid == ffi::EVP_PKEY_EC {
                // `pkey` is non-null (guarded above) and `kid == EVP_PKEY_EC`, so
                // BoringSSL guarantees a non-null EC_KEY with a group set; the
                // `opaque_ref` chain panics (not UB) if that invariant ever broke.
                let ec = ffi::EVP_PKEY_get1_EC_KEY(pkey);
                let group = ffi::EC_KEY_get0_group(ffi::EC_KEY::opaque_ref(ec));
                let nid = ffi::EC_GROUP_get_curve_name(ffi::EC_GROUP::opaque_ref(group));
                let nid_str = ffi::OBJ_nid2sn(nid);
                if !nid_str.is_null() {
                    // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
                    curve_name = unsafe { bun_core::ffi::cstr(nid_str) }.to_bytes();
                } else {
                    curve_name = b"";
                }
            } else {
                let kid_str = ffi::OBJ_nid2sn(kid);
                if !kid_str.is_null() {
                    // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
                    curve_name = unsafe { bun_core::ffi::cstr(kid_str) }.to_bytes();
                } else {
                    curve_name = b"";
                }
            }
            result.put(global, b"type", BunString::static_("ECDH").to_js(global)?);
            result.put(
                global,
                b"name",
                ZigString::from_utf8(curve_name).to_js(global),
            );
            result.put(global, b"size", JSValue::js_number(f64::from(bits)));
        }
        _ => {}
    }
    Ok(result)
}

pub(super) fn get_alpn_protocol(this: &This, global: &JSGlobalObject) -> JsResult<JSValue> {
    let mut alpn_proto: *const u8 = core::ptr::null();
    let mut alpn_proto_len: u32 = 0;

    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::FALSE);
    };

    ffi::SSL_get0_alpn_selected(
        boringssl::SSL::opaque_ref(ssl_ptr),
        &mut alpn_proto,
        &mut alpn_proto_len,
    );
    if alpn_proto.is_null() || alpn_proto_len == 0 {
        return Ok(JSValue::FALSE);
    }

    // SAFETY: SSL_get0_alpn_selected guarantees alpn_proto points to alpn_proto_len bytes owned by the SSL.
    let slice = unsafe { bun_core::ffi::slice(alpn_proto, alpn_proto_len as usize) };
    if strings::eql(slice, b"h2") {
        return BunString::static_("h2").to_js(global);
    }
    if strings::eql(slice, b"http/1.1") {
        return BunString::static_("http/1.1").to_js(global);
    }
    Ok(ZigString::from_utf8(slice).to_js(global))
}

pub(super) fn get_session(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    let session = ffi::SSL_get_session(boringssl::SSL::opaque_ref(ssl_ptr));
    if session.is_null() {
        return Ok(JSValue::UNDEFINED);
    }
    // SAFETY: session is a non-null *mut SSL_SESSION; null out-param requests only the encoded size.
    let size = unsafe { ffi::i2d_SSL_SESSION(session, core::ptr::null_mut()) };
    if size <= 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let buffer_size = usize::try_from(size).expect("int cast");
    let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
    let mut buffer_ptr: *mut u8 = buffer.as_array_buffer(global).unwrap().ptr;

    // SAFETY: session is a non-null *mut SSL_SESSION; buffer_ptr points to a buffer_size-byte JS ArrayBuffer kept alive on the stack.
    let result_size = unsafe { ffi::i2d_SSL_SESSION(session, &raw mut buffer_ptr) };
    debug_assert!(result_size == size);
    Ok(buffer)
}

pub(super) fn set_session(
    this: &This,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    if this.socket.get().is_detached() {
        return Ok(JSValue::UNDEFINED);
    }

    let [session_arg] = frame.arguments_as_array::<1>();

    if frame.arguments_count() < 1 {
        return Err(global.throw(format_args!(
            "Expected session to be a string, Buffer or TypedArray"
        )));
    }

    if let Some(sb) = StringOrBuffer::from_js(global, session_arg)? {
        let session_slice = sb.slice();
        let Some(ssl_ptr) = this.socket.get().ssl() else {
            return Ok(JSValue::UNDEFINED);
        };
        let mut tmp: *const u8 = session_slice.as_ptr();
        // SAFETY: tmp/session_slice.len() describe a valid readable buffer borrowed from `sb` for the duration of this call.
        let session = unsafe {
            ffi::d2i_SSL_SESSION(
                core::ptr::null_mut(),
                &raw mut tmp,
                c_long::try_from(session_slice.len()).expect("int cast"),
            )
        };
        if session.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SSL_set_session takes its own reference ("the caller retains ownership of |session|"),
        // so we must release the one returned by d2i_SSL_SESSION on every path.
        // SAFETY: `s` is the +1 SSL_SESSION reference returned by d2i_SSL_SESSION; we own it.
        let _guard = scopeguard::guard(session, |s| unsafe { ffi::SSL_SESSION_free(s) });
        if ffi::SSL_set_session(
            boringssl::SSL::opaque_ref(ssl_ptr),
            ffi::SSL_SESSION::opaque_ref(session),
        ) != 1
        {
            return Err(global.throw_value(get_ssl_exception(global, b"SSL_set_session error")));
        }
        Ok(JSValue::UNDEFINED)
    } else {
        Err(global.throw(format_args!(
            "Expected session to be a string, Buffer or TypedArray"
        )))
    }
}

pub(super) fn get_tls_ticket(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    let session = ffi::SSL_get_session(boringssl::SSL::opaque_ref(ssl_ptr));
    if session.is_null() {
        return Ok(JSValue::UNDEFINED);
    }
    let mut ticket: *const u8 = core::ptr::null();
    let mut length: usize = 0;
    // The pointer is only valid while the connection is in use so we need to copy it
    ffi::SSL_SESSION_get0_ticket(
        ffi::SSL_SESSION::opaque_ref(session),
        &mut ticket,
        &mut length,
    );

    if ticket.is_null() || length == 0 {
        return Ok(JSValue::UNDEFINED);
    }

    // SAFETY: SSL_SESSION_get0_ticket guarantees `ticket` points to `length` bytes owned by the session.
    let slice = unsafe { bun_core::ffi::slice(ticket, length) };
    jsc::ArrayBuffer::create_buffer(global, slice)
}

pub(super) fn renegotiate(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    boringssl::ERR_clear_error();
    if ffi::SSL_renegotiate(boringssl::SSL::opaque_ref(ssl_ptr)) != 1 {
        return Err(global.throw_value(get_ssl_exception(global, b"SSL_renegotiate error")));
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn disable_renegotiation(
    this: &This,
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    ffi::SSL_set_renegotiate_mode(
        boringssl::SSL::opaque_ref(ssl_ptr),
        boringssl::ssl_renegotiate_never,
    );
    Ok(JSValue::UNDEFINED)
}

pub(super) fn is_session_reused(
    this: &This,
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::FALSE);
    };
    Ok(JSValue::from(
        ffi::SSL_session_reused(boringssl::SSL::opaque_ref(ssl_ptr)) == 1,
    ))
}

pub(super) fn set_verify_mode(
    this: &This,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    if this.socket.get().is_detached() {
        return Ok(JSValue::UNDEFINED);
    }

    let [request_cert_js, reject_unauthorized_js] = frame.arguments_as_array::<2>();

    if frame.arguments_count() < 2 {
        return Err(global.throw(format_args!(
            "Expected requestCert and rejectUnauthorized arguments"
        )));
    }
    if !request_cert_js.is_boolean() || !reject_unauthorized_js.is_boolean() {
        return Err(global.throw(format_args!(
            "Expected requestCert and rejectUnauthorized arguments to be boolean"
        )));
    }

    let request_cert = request_cert_js.to_boolean();
    let reject_unauthorized = reject_unauthorized_js.to_boolean();
    let acts_as_server = this.acts_as_tls_server();
    let mut verify_mode: c_int = boringssl::SSL_VERIFY_NONE;
    if acts_as_server {
        if request_cert {
            verify_mode = boringssl::SSL_VERIFY_PEER;
            if reject_unauthorized {
                verify_mode |= boringssl::SSL_VERIFY_FAIL_IF_NO_PEER_CERT;
            }
        }
    }
    // Keep the enforcement flag in sync with the verify mode this call installs.
    this.update_flags(|f| {
        f.set(
            super::Flags::REJECT_UNAUTHORIZED,
            reject_unauthorized && (!acts_as_server || request_cert),
        );
    });
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    // we always allow and check the SSL certificate after the handshake or renegotiation
    ffi::SSL_set_verify(
        boringssl::SSL::opaque_ref(ssl_ptr),
        verify_mode,
        Some(always_allow_ssl_verify_callback),
    );
    Ok(JSValue::UNDEFINED)
}

extern "C" fn always_allow_ssl_verify_callback(
    _preverify_ok: c_int,
    _ctx: *mut boringssl::X509_STORE_CTX,
) -> c_int {
    1
}

#[cold]
#[inline(never)]
fn get_ssl_exception(global: &JSGlobalObject, default_message: &[u8]) -> JSValue {
    let mut zig_str = ZigString::init(b"");
    // Backing storage for the formatted "OpenSSL ..." message. Declared at
    // function scope so it outlives `to_error_instance` below. The string is
    // tagged UTF-8 (`init_utf8`) so that `to_error_instance` takes the copying
    // path (`fromUTF8ReplacingInvalidSequences`); an UNTAGGED ZigString would
    // be wrapped with `StringImpl::createWithoutCopying` and the JS Error's
    // message would dangle into this freed Vec.
    let mut formatted: Vec<u8> = Vec::new();
    let mut output_buf: [u8; 4096] = [0; 4096];

    output_buf[0] = 0;
    let mut written: usize = 0;
    let mut ssl_error = boringssl::ERR_get_error();
    while ssl_error != 0 && written < output_buf.len() {
        if written > 0 {
            output_buf[written] = b'\n';
            written += 1;
        }

        let reason_ptr = boringssl::ERR_reason_error_string(ssl_error);
        if !reason_ptr.is_null() {
            // SAFETY: ERR_reason_error_string returns a static NUL-terminated C string.
            let reason = unsafe { bun_core::ffi::cstr(reason_ptr) }.to_bytes();
            if reason.is_empty() {
                break;
            }
            output_buf[written..written + reason.len()].copy_from_slice(reason);
            written += reason.len();
        }

        let func_ptr = boringssl::ERR_func_error_string(ssl_error);
        if !func_ptr.is_null() {
            // SAFETY: ERR_func_error_string returns a static NUL-terminated C string.
            let reason = unsafe { bun_core::ffi::cstr(func_ptr) }.to_bytes();
            if !reason.is_empty() {
                const VIA: &[u8] = b" via ";
                output_buf[written..written + VIA.len()].copy_from_slice(VIA);
                written += VIA.len();
                output_buf[written..written + reason.len()].copy_from_slice(reason);
                written += reason.len();
            }
        }

        let lib_ptr = boringssl::ERR_lib_error_string(ssl_error);
        if !lib_ptr.is_null() {
            // SAFETY: ERR_lib_error_string returns a static NUL-terminated C string.
            let reason = unsafe { bun_core::ffi::cstr(lib_ptr) }.to_bytes();
            if !reason.is_empty() {
                output_buf[written] = b' ';
                written += 1;
                output_buf[written..written + reason.len()].copy_from_slice(reason);
                written += reason.len();
            }
        }

        ssl_error = boringssl::ERR_get_error();
    }

    if written > 0 {
        let message = &output_buf[0..written];
        formatted.reserve(b"OpenSSL ".len() + message.len());
        {
            use std::io::Write;
            let _ = write!(&mut formatted, "OpenSSL {}", ::bstr::BStr::new(message));
        }
        // `zig_str` borrows `formatted`, which lives until this function
        // returns. The UTF-8 tag is what makes `to_error_instance` clone the
        // bytes (untagged strings are wrapped without copying — see
        // Zig::toString in src/jsc/bindings/helpers.h), matching the
        // "Ensure we clone it" pattern in JSGlobalObject::create_error_instance.
        zig_str = ZigString::init_utf8(&formatted);

        // We shouldn't *need* to do this but it's not entirely clear.
        boringssl::ERR_clear_error();
    }

    if zig_str.len == 0 {
        zig_str = ZigString::init(default_message);
    }

    // store the exception in here
    // (UTF-8-tagged strings are cloned by toErrorInstance; the untagged
    // `default_message` fallback is wrapped without copying, which is safe
    // because callers pass static literals)
    let exception = zig_str.to_error_instance(global);

    // reference it in stack memory
    exception.ensure_still_alive();

    exception
}
