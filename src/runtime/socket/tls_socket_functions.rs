use core::ffi::{c_char, c_int, c_long, c_void};

use crate::api::bun_secure_context::SecureContext;
use bun_boringssl_sys as boringssl;
use bun_boringssl_sys::BsslOpaqueExt as _;
use bun_core::{String as BunString, ZigString, strings};
use bun_jsc::JsClass as _;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, ZigStringJsc as _,
};

use crate::api::bun_x509 as X509;

// ──────────────────────────────────────────────────────────────────────────
// uSockets helpers (not BoringSSL, so not covered by bssl-sys) plus thin
// safe shims over `bun_boringssl_sys` for the call sites in `socket_body.rs`
// that route through this module with opaque-ZST `&SSL` / `&SSL_CTX`.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_snake_case)]
pub(super) mod ffi {
    use super::boringssl::{SSL, SSL_CTX, X509_STORE};
    use core::ffi::{c_int, c_uint, c_void};

    unsafe extern "C" {
        /// Save/restore the per-loop BIO routing state around in-handshake JS
        /// callbacks (defined in usockets' openssl.c).
        pub(crate) safe fn us_internal_ssl_loop_state_save(ssl: &SSL, out5: *mut *mut c_void);
        pub(crate) safe fn us_internal_ssl_loop_state_restore(saved5: *mut *mut c_void);
        // The process-wide default root store; up-refs before returning, so
        // the caller owns a reference it must release with X509_STORE_free.
        pub(crate) fn us_get_shared_default_ca_store() -> *mut X509_STORE;
    }

    #[inline]
    pub(crate) fn SSL_get_ex_data(ssl: &SSL, idx: c_int) -> *mut c_void {
        // SAFETY: `&SSL` is a live opaque-ZST handle; FFI only reads through it.
        unsafe { super::boringssl::SSL_get_ex_data(ssl, idx) }
    }

    #[inline]
    pub(crate) fn SSL_set_ex_data(ssl: &SSL, idx: c_int, data: *mut c_void) -> c_int {
        // SAFETY: `&SSL` is a live opaque-ZST handle; BoringSSL stores `data` verbatim.
        unsafe { super::boringssl::SSL_set_ex_data(core::ptr::from_ref(ssl).cast_mut(), idx, data) }
    }

    #[inline]
    pub(crate) fn SSL_is_init_finished(ssl: &SSL) -> c_int {
        // SAFETY: `&SSL` is a live opaque-ZST handle; FFI only reads through it.
        unsafe { super::boringssl::SSL_is_init_finished(ssl) }
    }

    #[inline]
    pub(crate) fn SSL_get_SSL_CTX(ssl: &SSL) -> *mut SSL_CTX {
        // SAFETY: `&SSL` is a live opaque-ZST handle; FFI only reads through it.
        unsafe { super::boringssl::SSL_get_SSL_CTX(ssl) }
    }

    #[inline]
    pub(crate) fn SSL_CTX_set_alpn_select_cb(
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
    ) {
        // SAFETY: `&SSL_CTX` is a live opaque-ZST handle; BoringSSL stores the
        // callback/arg verbatim and never derefs `arg` outside the callback.
        unsafe {
            super::boringssl::SSL_CTX_set_alpn_select_cb(
                core::ptr::from_ref(ctx).cast_mut(),
                cb,
                arg,
            )
        }
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

    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let servername =
        unsafe { boringssl::SSL_get_servername(ssl_ptr, boringssl::TLSEXT_NAMETYPE_host_name) };
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

    let args = frame.arguments_old::<1>();
    if args.len < 1 {
        return Err(global.throw(format_args!("Expected 1 argument")));
    }

    let server_name = args.ptr[0];
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

        // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
        if unsafe { boringssl::SSL_is_init_finished(ssl_ptr) } != 0 {
            // match node.js exceptions
            return Err(global.throw(format_args!("Already started.")));
        }
        let host_z = bun_core::ZBox::from_bytes(host);
        // SAFETY: `host_z` is NUL-terminated; FFI reads until NUL.
        unsafe { boringssl::SSL_set_tlsext_host_name(ssl_ptr, host_z.as_ptr()) };
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let cert = unsafe { boringssl::SSL_get_peer_certificate(ssl_ptr) };
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let cert = unsafe { boringssl::SSL_get_certificate(ssl_ptr) };
    if !cert.is_null() {
        // SAFETY: `cert` is a non-null borrowed X509; bump the refcount before handing to JS.
        unsafe { boringssl::X509_up_ref(cert) };
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let version = unsafe { boringssl::SSL_get_version(ssl_ptr) };
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

    let args = frame.arguments_old::<1>();

    if args.len < 1 {
        return Err(global.throw(format_args!("Expected size to be a number")));
    }

    let arg = args.ptr[0];
    if !arg.is_number() {
        return Err(global.throw(format_args!("Expected size to be a number")));
    }
    let size = args.ptr[0].coerce_to_int64(global)?;
    if size < 1 {
        return Err(global.throw(format_args!("Expected size to be greater than 1")));
    }
    if size > 16384 {
        return Err(global.throw(format_args!("Expected size to be less than 16385")));
    }

    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::FALSE);
    };
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    Ok(JSValue::from(
        unsafe {
            boringssl::SSL_set_max_send_fragment(ssl_ptr, usize::try_from(size).expect("int cast"))
        } == 1,
    ))
}

pub(super) fn get_peer_certificate(
    this: &This,
    global: &JSGlobalObject,
    frame: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding();

    let args = frame.arguments_old::<1>();
    let mut abbreviated: bool = true;
    if args.len > 0 {
        let arg = args.ptr[0];
        if !arg.is_boolean() {
            return Err(global.throw(format_args!("Expected abbreviated to be a boolean")));
        }
        abbreviated = arg.to_boolean();
    }

    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };

    if abbreviated {
        if this.is_server() {
            // SSL_get_peer_certificate returns a +1 reference; we must free it.
            // X509::to_js only borrows the pointer (X509View is non-owning).
            // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
            let cert = unsafe { boringssl::SSL_get_peer_certificate(ssl_ptr) };
            if !cert.is_null() {
                // SAFETY: `c` is the +1 X509 reference returned by SSL_get_peer_certificate; we own it.
                let _guard = scopeguard::guard(cert, |c| unsafe { boringssl::X509_free(c) });
                return X509::to_js(boringssl::X509::opaque_mut(cert), global);
            }
        }

        // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
        let cert_chain = unsafe { boringssl::SSL_get_peer_cert_chain(ssl_ptr) };
        if cert_chain.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: `cert_chain` is a live borrowed stack owned by the SSL.
        let cert = unsafe { boringssl::sk_X509_value(cert_chain, 0) };
        if cert.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        return X509::to_js(boringssl::X509::opaque_mut(cert), global);
    }

    let mut cert: *mut boringssl::X509 = core::ptr::null_mut();
    if this.is_server() {
        // SSL_get_peer_certificate returns a +1 reference; we must free it.
        // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
        cert = unsafe { boringssl::SSL_get_peer_certificate(ssl_ptr) };
    }
    let _guard = scopeguard::guard(cert, |c| {
        if !c.is_null() {
            // SAFETY: `c` is the +1 X509 reference returned by SSL_get_peer_certificate; we own it.
            unsafe { boringssl::X509_free(c) };
        }
    });

    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let cert_chain = unsafe { boringssl::SSL_get_peer_cert_chain(ssl_ptr) };
    let first_cert: *mut boringssl::X509 = if !cert.is_null() {
        cert
    } else if !cert_chain.is_null() {
        // SAFETY: `cert_chain` is a live borrowed stack owned by the SSL.
        unsafe { boringssl::sk_X509_value(cert_chain, 0) }
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
            // SAFETY: `cert_chain` is a live borrowed stack; sk_X509_value returns null past the end.
            let next = unsafe { boringssl::sk_X509_value(cert_chain, i) };
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
        let mut store = boringssl::SSL_CTX_get_cert_store(boringssl::SSL_get_SSL_CTX(ssl_ptr));
        // A context built without an explicit `ca` (and without requestCert,
        // which installs the shared roots) carries an empty store and the
        // issuer walk would stop at whatever the peer sent. Fall back to the
        // process-wide default roots the way Node's per-context store always
        // contains the bundled roots. The getter up-refs, so the temporary
        // reference is released after the walk.
        let mut shared_store: *mut boringssl::X509_STORE = core::ptr::null_mut();
        if store.is_null()
            || boringssl::sk_X509_OBJECT_num(boringssl::X509_STORE_get0_objects(store)) == 0
        {
            shared_store = ffi::us_get_shared_default_ca_store();
            if !shared_store.is_null() {
                store = shared_store;
            }
        }
        let store_ctx = boringssl::X509_STORE_CTX_new();
        if !store_ctx.is_null() {
            if !store.is_null()
                && boringssl::X509_STORE_CTX_init(
                    store_ctx,
                    store,
                    core::ptr::null_mut(),
                    core::ptr::null_mut(),
                ) == 1
            {
                let mut extras: Vec<*mut boringssl::X509> = Vec::new();
                // Cap the walk so a cyclic store cannot loop forever.
                while extras.len() < 16 && boringssl::X509_check_issued(last_cert, last_cert) != 0 {
                    let mut issuer: *mut boringssl::X509 = core::ptr::null_mut();
                    if boringssl::X509_STORE_CTX_get1_issuer(&raw mut issuer, store_ctx, last_cert)
                        <= 0
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
                            boringssl::X509_STORE_CTX_free(store_ctx);
                            if !shared_store.is_null() {
                                boringssl::X509_STORE_free(shared_store);
                            }
                            return Err(e);
                        }
                    }
                    extras.push(issuer);
                    last_cert = issuer;
                }
                last_is_self_issued = boringssl::X509_check_issued(last_cert, last_cert) == 0;
                for extra in extras {
                    boringssl::X509_free(extra);
                }
            }
            boringssl::X509_STORE_CTX_free(store_ctx);
        }
        if !shared_store.is_null() {
            boringssl::X509_STORE_free(shared_store);
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let cert = unsafe { boringssl::SSL_get_certificate(ssl_ptr) };

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
        boringssl::SSL_get_finished(
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
    let result_size = unsafe { boringssl::SSL_get_finished(ssl_ptr, buffer_ptr, buffer_size) };
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

    // SAFETY: `ssl_ptr` is a live *mut SSL; null out-params request only the count.
    let nsig = unsafe {
        boringssl::SSL_get_shared_sigalgs(
            ssl_ptr,
            0,
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            core::ptr::null_mut(),
            core::ptr::null_mut(),
        )
    };

    let array = JSValue::create_empty_array(global, usize::try_from(nsig).expect("int cast"))?;

    // OpenSSL NIDs BoringSSL lacks; unreachable in practice but kept for Node parity.
    const NID_ID_GOSTR3410_2012_256: c_int = 979;
    const NID_ID_GOSTR3410_2012_512: c_int = 980;

    for i in 0..usize::try_from(nsig).expect("int cast") {
        let mut hash_nid: c_int = 0;
        let mut sign_nid: c_int = 0;
        let sig_with_md: &[u8];

        // SAFETY: `ssl_ptr` is a live *mut SSL; the two non-null out-params are stack locals.
        unsafe {
            boringssl::SSL_get_shared_sigalgs(
                ssl_ptr,
                c_int::try_from(i).expect("int cast"),
                &raw mut sign_nid,
                &raw mut hash_nid,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
            )
        };
        match sign_nid {
            boringssl::EVP_PKEY_RSA => {
                sig_with_md = b"RSA";
            }
            boringssl::EVP_PKEY_RSA_PSS => {
                sig_with_md = b"RSA-PSS";
            }
            boringssl::EVP_PKEY_DSA => {
                sig_with_md = b"DSA";
            }
            boringssl::EVP_PKEY_EC => {
                sig_with_md = b"ECDSA";
            }
            boringssl::NID_ED25519 => {
                sig_with_md = b"Ed25519";
            }
            boringssl::NID_ED448 => {
                sig_with_md = b"Ed448";
            }
            boringssl::NID_id_GostR3410_2001 => {
                sig_with_md = b"gost2001";
            }
            NID_ID_GOSTR3410_2012_256 => {
                sig_with_md = b"gost2012_256";
            }
            NID_ID_GOSTR3410_2012_512 => {
                sig_with_md = b"gost2012_512";
            }
            _ => {
                // SAFETY: pure NID→short-name lookup into BoringSSL's static OID table.
                let sn_str = unsafe { boringssl::OBJ_nid2sn(sign_nid) };
                if !sn_str.is_null() {
                    // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
                    sig_with_md = unsafe { bun_core::ffi::cstr(sn_str) }.to_bytes();
                } else {
                    sig_with_md = b"UNDEF";
                }
            }
        }

        // SAFETY: pure NID→short-name lookup into BoringSSL's static OID table.
        let hash_str = unsafe { boringssl::OBJ_nid2sn(hash_nid) };
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let cipher = unsafe { boringssl::SSL_get_current_cipher(ssl_ptr) };
    let result = JSValue::create_empty_object(global, 0);

    if cipher.is_null() {
        result.put(global, b"name", JSValue::NULL);
        result.put(global, b"standardName", JSValue::NULL);
        result.put(global, b"version", JSValue::NULL);
        return Ok(result);
    }

    // SAFETY: `cipher` is a non-null borrowed SSL_CIPHER; getters return static C strings.
    let name = unsafe { boringssl::SSL_CIPHER_get_name(cipher) };
    if name.is_null() {
        result.put(global, b"name", JSValue::NULL);
    } else {
        // SAFETY: SSL_CIPHER_get_name returns a static NUL-terminated C string.
        let s = unsafe { bun_core::ffi::cstr(name) }.to_bytes();
        result.put(global, b"name", ZigString::from_utf8(s).to_js(global));
    }

    // SAFETY: `cipher` is a non-null borrowed SSL_CIPHER; getters return static C strings.
    let standard_name = unsafe { boringssl::SSL_CIPHER_standard_name(cipher) };
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

    // SAFETY: `cipher` is a non-null borrowed SSL_CIPHER; getters return static C strings.
    let version = unsafe { boringssl::SSL_CIPHER_get_version(cipher) };
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
        boringssl::SSL_get_peer_finished(
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
    let result_size = unsafe { boringssl::SSL_get_peer_finished(ssl_ptr, buffer_ptr, buffer_size) };
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
    let args = frame.arguments_old::<1>();
    if args.len < 1 {
        return Err(global.throw(format_args!("setKeyCert requires a SecureContext")));
    }
    let Some(sc) = SecureContext::from_js(args.ptr[0]) else {
        return Err(global.throw(format_args!("setKeyCert requires a SecureContext")));
    };
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    // SAFETY: `sc` is a live SecureContext; borrow() hands back an owned
    // reference and SSL_set_SSL_CTX takes its own, so release the temporary.
    unsafe {
        let ctx = (*sc).borrow();
        boringssl::SSL_set_SSL_CTX(ssl_ptr.cast(), ctx.cast());
        // SSL_set_SSL_CTX stops retargeting the certificate once ClientHello
        // processing has reached ALPN selection, and Node supports calling
        // setKeyCert from ALPNCallback - apply the identity directly.
        let leaf = boringssl::SSL_CTX_get0_certificate(ctx.cast());
        let pkey = boringssl::SSL_CTX_get0_privatekey(ctx.cast());
        if !leaf.is_null() && !pkey.is_null() {
            let ok_cert = boringssl::SSL_use_certificate(ssl_ptr.cast(), leaf);
            let ok_key = boringssl::SSL_use_PrivateKey(ssl_ptr.cast(), pkey);
            let mut ok_chain = 1;
            let mut chain: *mut boringssl::stack_st_X509 = core::ptr::null_mut();
            if boringssl::SSL_CTX_get0_chain_certs(ctx.cast(), &raw mut chain) == 1
                && !chain.is_null()
            {
                ok_chain = boringssl::SSL_set1_chain(ssl_ptr.cast(), chain);
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

    let args = frame.arguments_old::<3>();
    if args.len < 2 {
        return Err(global.throw(format_args!("Expected length and label to be provided")));
    }
    let length_arg = args.ptr[0];
    if !length_arg.is_number() {
        return Err(global.throw(format_args!("Expected length to be a number")));
    }

    let length = length_arg.coerce_to_int64(global)?;
    if length < 0 {
        return Err(global.throw(format_args!("Expected length to be a positive number")));
    }

    let label_arg = args.ptr[1];
    if !label_arg.is_string() {
        return Err(global.throw(format_args!("Expected label to be a string")));
    }

    let label = label_arg.to_slice_or_null(global)?;
    let label_slice = label.slice();
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };

    if args.len > 2 {
        let context_arg = args.ptr[2];

        if let Some(sb) = StringOrBuffer::from_js(global, context_arg)? {
            let context_slice = sb.slice();

            let buffer_size = usize::try_from(length).expect("int cast");
            let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
            let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr;

            // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr/label_slice/context_slice are valid for the lengths passed.
            let result = unsafe {
                boringssl::SSL_export_keying_material(
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
            boringssl::SSL_export_keying_material(
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
    // only available for clients
    if this.is_server() {
        return Ok(JSValue::NULL);
    }

    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::NULL);
    };
    let result = JSValue::create_empty_object(global, 0);

    // TODO: investigate better option or compatible way to get the key
    // this implementation follows nodejs but for BoringSSL SSL_get_server_tmp_key will always return 0
    // wich will result in a empty object
    // let mut raw_key: *mut boringssl::EVP_PKEY = core::ptr::null_mut();
    // if unsafe { boringssl::SSL_get_server_tmp_key(ssl_ptr, &mut raw_key) } == 0 {
    //     return Ok(result);
    // }
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let raw_key: *mut boringssl::EVP_PKEY = unsafe { boringssl::SSL_get_privatekey(ssl_ptr) };
    if raw_key.is_null() {
        return Ok(result);
    }

    // SAFETY: `raw_key` is a non-null borrowed EVP_PKEY owned by the SSL.
    let kid = unsafe { boringssl::EVP_PKEY_id(raw_key) };
    // SAFETY: `raw_key` is a non-null borrowed EVP_PKEY owned by the SSL.
    let bits = unsafe { boringssl::EVP_PKEY_bits(raw_key) };

    match kid {
        boringssl::EVP_PKEY_DH => {
            result.put(global, b"type", BunString::static_("DH").to_js(global)?);
            result.put(global, b"size", JSValue::js_number(f64::from(bits)));
        }
        boringssl::EVP_PKEY_EC | boringssl::EVP_PKEY_X25519 | boringssl::EVP_PKEY_X448 => {
            let curve_name: &[u8];
            if kid == boringssl::EVP_PKEY_EC {
                // SAFETY: `raw_key` is non-null and `kid == EVP_PKEY_EC`, so
                // BoringSSL guarantees a non-null EC_KEY with a group set.
                let nid_str = unsafe {
                    let ec = boringssl::EVP_PKEY_get1_EC_KEY(raw_key);
                    let group = boringssl::EC_KEY_get0_group(ec);
                    let nid = boringssl::EC_GROUP_get_curve_name(group);
                    boringssl::OBJ_nid2sn(nid)
                };
                if !nid_str.is_null() {
                    // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
                    curve_name = unsafe { bun_core::ffi::cstr(nid_str) }.to_bytes();
                } else {
                    curve_name = b"";
                }
            } else {
                // SAFETY: pure NID→short-name lookup into BoringSSL's static OID table.
                let kid_str = unsafe { boringssl::OBJ_nid2sn(kid) };
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

    // SAFETY: `ssl_ptr` is a live *mut SSL; out-params are stack locals.
    unsafe {
        boringssl::SSL_get0_alpn_selected(ssl_ptr, &raw mut alpn_proto, &raw mut alpn_proto_len)
    };
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let session = unsafe { boringssl::SSL_get_session(ssl_ptr) };
    if session.is_null() {
        return Ok(JSValue::UNDEFINED);
    }
    // SAFETY: session is a non-null *mut SSL_SESSION; null out-param requests only the encoded size.
    let size = unsafe { boringssl::i2d_SSL_SESSION(session, core::ptr::null_mut()) };
    if size <= 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let buffer_size = usize::try_from(size).expect("int cast");
    let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
    let mut buffer_ptr: *mut u8 = buffer.as_array_buffer(global).unwrap().ptr;

    // SAFETY: session is a non-null *mut SSL_SESSION; buffer_ptr points to a buffer_size-byte JS ArrayBuffer kept alive on the stack.
    let result_size = unsafe { boringssl::i2d_SSL_SESSION(session, &raw mut buffer_ptr) };
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

    let args = frame.arguments_old::<1>();

    if args.len < 1 {
        return Err(global.throw(format_args!(
            "Expected session to be a string, Buffer or TypedArray"
        )));
    }

    let session_arg = args.ptr[0];

    if let Some(sb) = StringOrBuffer::from_js(global, session_arg)? {
        let session_slice = sb.slice();
        let Some(ssl_ptr) = this.socket.get().ssl() else {
            return Ok(JSValue::UNDEFINED);
        };
        let mut tmp: *const u8 = session_slice.as_ptr();
        // SAFETY: tmp/session_slice.len() describe a valid readable buffer borrowed from `sb` for the duration of this call.
        let session = unsafe {
            boringssl::d2i_SSL_SESSION(
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
        let _guard = scopeguard::guard(session, |s| unsafe { boringssl::SSL_SESSION_free(s) });
        // SAFETY: `ssl_ptr` is live; `session` is non-null; BoringSSL bumps the session refcount.
        if unsafe { boringssl::SSL_set_session(ssl_ptr, session) } != 1 {
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    let session = unsafe { boringssl::SSL_get_session(ssl_ptr) };
    if session.is_null() {
        return Ok(JSValue::UNDEFINED);
    }
    let mut ticket: *const u8 = core::ptr::null();
    let mut length: usize = 0;
    // The pointer is only valid while the connection is in use so we need to copy it
    // SAFETY: `session` is non-null; out-params are stack locals.
    unsafe { boringssl::SSL_SESSION_get0_ticket(session, &raw mut ticket, &raw mut length) };

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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    if unsafe { boringssl::SSL_renegotiate(ssl_ptr) } != 1 {
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    unsafe { boringssl::SSL_set_renegotiate_mode(ssl_ptr, boringssl::ssl_renegotiate_never) };
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    Ok(JSValue::from(
        unsafe { boringssl::SSL_session_reused(ssl_ptr) } == 1,
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

    let args = frame.arguments_old::<2>();

    if args.len < 2 {
        return Err(global.throw(format_args!(
            "Expected requestCert and rejectUnauthorized arguments"
        )));
    }
    let request_cert_js = args.ptr[0];
    let reject_unauthorized_js = args.ptr[1];
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
    // SAFETY: `ssl_ptr` is a live *mut SSL from a connected socket.
    unsafe {
        boringssl::SSL_set_verify(ssl_ptr, verify_mode, Some(always_allow_ssl_verify_callback))
    };
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
