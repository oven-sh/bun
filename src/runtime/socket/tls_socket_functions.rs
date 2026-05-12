use core::ffi::{c_char, c_int, c_long, c_void};
use std::ffi::CStr;

use bun_boringssl_sys as boringssl;
use bun_core::{String as BunString, ZigString, strings};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, ZigStringJsc as _,
};

use crate::api::bun_x509 as X509;
use crate::webcore::blob::ZigStringBlobExt as _;


// ──────────────────────────────────────────────────────────────────────────
// Local BoringSSL FFI surface not yet in bun_boringssl_sys.
// Declared here per port rules (call the linked C symbol directly); migrate
// into `bun_boringssl_sys` once the bindgen pass covers them.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_camel_case_types, non_upper_case_globals, dead_code)]
pub mod ffi {
    use super::boringssl::{SSL, SSL_CTX, X509, X509_STORE_CTX, struct_stack_st_X509};
    use core::ffi::{c_char, c_int, c_long, c_uint, c_void};

    // Re-export the one decl whose `*const c_char` NUL-terminated arg keeps a
    // genuine caller precondition; the rest are re-declared `safe fn` below.
    pub use super::boringssl::SSL_set_tlsext_host_name;

    // Opaque handles missing from boringssl_sys.
    bun_opaque::opaque_ffi! {
        pub struct SSL_SESSION;
        pub struct SSL_CIPHER;
        pub struct EVP_PKEY;
        pub struct EC_KEY;
        pub struct EC_GROUP;
    }

    pub type ssl_renegotiate_mode_t = c_int;

    // ssl.h
    pub const TLSEXT_NAMETYPE_host_name: c_int = 0;

    // evp.h key types (NID values)
    pub const EVP_PKEY_RSA: c_int = 6;
    pub const EVP_PKEY_RSA_PSS: c_int = 912;
    pub const EVP_PKEY_DSA: c_int = 116;
    pub const EVP_PKEY_EC: c_int = 408;
    pub const EVP_PKEY_DH: c_int = 28;
    pub const EVP_PKEY_X25519: c_int = 948;
    pub const EVP_PKEY_X448: c_int = 961;

    // obj_mac.h
    pub const NID_ED25519: c_int = 949;
    pub const NID_ED448: c_int = 960;
    pub const NID_id_GostR3410_2001: c_int = 811;
    pub const NID_id_GostR3410_2012_256: c_int = 979;
    pub const NID_id_GostR3410_2012_512: c_int = 980;

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
        pub safe fn SSL_get_version(ssl: &SSL) -> *const c_char;
        pub safe fn SSL_get_peer_certificate(ssl: &SSL) -> *mut X509;
        pub safe fn SSL_get_certificate(ssl: &SSL) -> *mut X509;
        pub safe fn SSL_set_max_send_fragment(ssl: &SSL, max_send_fragment: usize) -> c_int;
        // SAFETY (unsafe fn): `buf` must be writable for `count` bytes.
        pub fn SSL_get_finished(ssl: *const SSL, buf: *mut c_void, count: usize) -> usize;
        // SAFETY (unsafe fn): `buf` must be writable for `count` bytes.
        pub fn SSL_get_peer_finished(ssl: *const SSL, buf: *mut c_void, count: usize) -> usize;
        // Opaque-ZST `&SSL` + `Option<&mut _>` out-params (NPO ⇒ ABI-identical
        // to nullable `*mut _`); BoringSSL writes each non-null slot in place.
        // No remaining caller-side precondition.
        pub safe fn SSL_get_shared_sigalgs(
            ssl: &SSL,
            idx: c_int,
            psign: Option<&mut c_int>,
            phash: Option<&mut c_int>,
            psignhash: Option<&mut c_int>,
            rsig: Option<&mut u8>,
            rhash: Option<&mut u8>,
        ) -> c_int;
        // SAFETY (unsafe fn): `out`/`label`/`context` must be valid for the given lengths.
        pub fn SSL_export_keying_material(
            ssl: *mut SSL,
            out: *mut u8,
            out_len: usize,
            label: *const c_char,
            label_len: usize,
            context: *const u8,
            context_len: usize,
            use_context: c_int,
        ) -> c_int;
        pub safe fn SSL_session_reused(ssl: &SSL) -> c_int;
        pub safe fn SSL_get_privatekey(ssl: &SSL) -> *mut EVP_PKEY;

        // ── SSL_SESSION ───────────────────────────────────────────────────
        pub safe fn SSL_get_session(ssl: &SSL) -> *mut SSL_SESSION;
        // Both handles are opaque-ZST refs (`UnsafeCell` body); BoringSSL bumps
        // `session`'s refcount internally — no caller-side precondition.
        pub safe fn SSL_set_session(ssl: &SSL, session: &SSL_SESSION) -> c_int;
        // SAFETY (unsafe fn): consumes a +1 reference; `session` must be uniquely owned or null.
        pub fn SSL_SESSION_free(session: *mut SSL_SESSION);
        // Opaque-ZST `&SSL_SESSION` + `&mut` out-params (FFI-nonnull) ⇒ no
        // caller-side precondition; BoringSSL writes a borrowed ptr/len pair.
        pub safe fn SSL_SESSION_get0_ticket(
            session: &SSL_SESSION,
            out_ticket: &mut *const u8,
            out_len: &mut usize,
        );
        // SAFETY (unsafe fn): `pp` (when non-null) must point to a buffer with capacity for the encoded session.
        pub fn i2d_SSL_SESSION(session: *mut SSL_SESSION, pp: *mut *mut u8) -> c_int;
        // SAFETY (unsafe fn): `*pp` must be readable for `length` bytes.
        pub fn d2i_SSL_SESSION(
            a: *mut *mut SSL_SESSION,
            pp: *mut *const u8,
            length: c_long,
        ) -> *mut SSL_SESSION;

        // ── SSL_CIPHER ────────────────────────────────────────────────────
        pub safe fn SSL_get_current_cipher(ssl: &SSL) -> *const SSL_CIPHER;
        pub safe fn SSL_CIPHER_get_name(cipher: &SSL_CIPHER) -> *const c_char;
        pub safe fn SSL_CIPHER_standard_name(cipher: &SSL_CIPHER) -> *const c_char;
        pub safe fn SSL_CIPHER_get_version(cipher: &SSL_CIPHER) -> *const c_char;

        // ── X509 ─────────────────────────────────────────────────────────
        pub safe fn X509_up_ref(x: &X509) -> c_int;
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
        pub safe fn sk_X509_value(sk: &struct_stack_st_X509, i: usize) -> *mut X509;

        // ── EVP / EC ──────────────────────────────────────────────────────
        pub safe fn EVP_PKEY_id(pkey: &EVP_PKEY) -> c_int;
        pub safe fn EVP_PKEY_bits(pkey: &EVP_PKEY) -> c_int;
        // Returns a +1 `EC_KEY*` (caller owns; the sole call site mirrors the
        // Zig spec and intentionally leaks it). The only pointer arg is an
        // opaque-ZST `&EVP_PKEY`, so the call itself has no precondition.
        pub safe fn EVP_PKEY_get1_EC_KEY(pkey: &EVP_PKEY) -> *mut EC_KEY;
        // Result is borrowed from `key`; opaque-ZST ref ⇒ no caller precondition.
        pub safe fn EC_KEY_get0_group(key: &EC_KEY) -> *const EC_GROUP;
        pub safe fn EC_GROUP_get_curve_name(group: &EC_GROUP) -> c_int;

        // ── OBJ ──────────────────────────────────────────────────────────
        // Pure NID→short-name lookup; takes a by-value int and returns a
        // pointer into BoringSSL's static OID table (or null). No pointer
        // precondition, so declare `safe fn`.
        pub safe fn OBJ_nid2sn(nid: c_int) -> *const c_char;

        // ── Safe re-declarations of upstream `bun_boringssl_sys` symbols ──
        // Upstream still takes raw `*const/*mut SSL`; the opaque-ZST `&SSL`
        // (UnsafeCell body, zero-byte deref, no `noalias`) plus by-value
        // scalars / `&mut` out-params leave no caller-side precondition, so
        // declare them `safe fn` here and route callers through
        // `SSL::opaque_ref` (panics on null, which every site already guards).
        pub safe fn SSL_get_servername(ssl: &SSL, ty: c_int) -> *const c_char;
        pub safe fn SSL_is_init_finished(ssl: &SSL) -> c_int;
        pub safe fn SSL_get_peer_cert_chain(ssl: &SSL) -> *mut struct_stack_st_X509;
        pub safe fn SSL_get0_alpn_selected(
            ssl: &SSL,
            out_data: &mut *const u8,
            out_len: &mut c_uint,
        );
        pub safe fn SSL_get_ex_data(ssl: &SSL, idx: c_int) -> *mut c_void;
        pub safe fn SSL_renegotiate(ssl: &SSL) -> c_int;
        pub safe fn SSL_set_renegotiate_mode(
            ssl: &SSL,
            mode: super::boringssl::ssl_renegotiate_mode_t,
        );
        pub safe fn SSL_set_verify(
            ssl: &SSL,
            mode: c_int,
            callback: super::boringssl::SSL_verify_cb,
        );
        // Opaque-ZST `&SSL` + opaque `*mut c_void` payload (BoringSSL stores
        // it verbatim, never derefs) ⇒ no caller-side precondition.
        pub safe fn SSL_set_ex_data(ssl: &SSL, idx: c_int, data: *mut c_void) -> c_int;
        // Returns the borrowed parent CTX (always non-null for a live `SSL*`).
        pub safe fn SSL_get_SSL_CTX(ssl: &SSL) -> *mut SSL_CTX;
        // Atomic refcount bump on a live `SSL_CTX*`; opaque-ZST ref ⇒ no
        // caller-side precondition (route via `SSL_CTX::opaque_ref`).
        pub safe fn SSL_CTX_up_ref(ctx: &SSL_CTX) -> c_int;
        // Stores `cb`/`arg` opaquely on the CTX (BoringSSL never derefs `arg`
        // outside the callback). Opaque-ZST `&SSL_CTX` + by-value fn-ptr +
        // opaque `*mut c_void` ⇒ no caller-side precondition.
        pub safe fn SSL_CTX_set_alpn_select_cb(
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
    }
}
use crate::node::StringOrBuffer;

// In Zig this file is a mixin of free functions over `jsc.API.TLSSocket`.
// The `#[bun_jsc::host_fn]` shims live on `NewSocket<SSL>` in `socket_body.rs`
// and forward into these free helpers — keep them as plain `fn`s.
// PORT NOTE: this file is `mod`-included from BOTH `socket/mod.rs` and
// `socket/socket_body.rs`; `super::TLSSocket` resolves to the parent's
// `NewSocket<true>` in either compilation, whereas the absolute path
// `crate::api::TLSSocket` always picked the `mod.rs` shape and broke the
// `socket_body` instance.
type This = super::TLSSocket;

pub fn get_servername(
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

pub fn set_servername(
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
    // Drop replaces the old value (Zig manually freed `old`).
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

pub fn get_peer_x509_certificate(
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

pub fn get_x509_certificate(
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

pub fn get_tls_version(
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

pub fn set_max_send_fragment(
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
    Ok(JSValue::from(
        ffi::SSL_set_max_send_fragment(
            boringssl::SSL::opaque_ref(ssl_ptr),
            usize::try_from(size).expect("int cast"),
        ) == 1,
    ))
}

pub fn get_peer_certificate(
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
    if this.is_server() {
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

    // TODO: we need to support the non abbreviated version of this
    Ok(JSValue::UNDEFINED)
}

pub fn get_certificate(
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

pub fn get_tls_finished_message(
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

    let buffer_size = usize::try_from(size).expect("int cast");
    let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
    let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr.cast::<c_void>();

    // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr points to a buffer_size-byte JS ArrayBuffer kept alive on the stack.
    let result_size = unsafe { ffi::SSL_get_finished(ssl_ptr, buffer_ptr, buffer_size) };
    debug_assert!(result_size == size);
    Ok(buffer)
}

pub fn get_shared_sigalgs(
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
        let mut sig_with_md: &[u8] = b"";

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

pub fn get_cipher(this: &This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
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

pub fn get_tls_peer_finished_message(
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

    let buffer_size = usize::try_from(size).expect("int cast");
    let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
    let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr.cast::<c_void>();

    // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr points to a buffer_size-byte JS ArrayBuffer kept alive on the stack.
    let result_size = unsafe { ffi::SSL_get_peer_finished(ssl_ptr, buffer_ptr, buffer_size) };
    debug_assert!(result_size == size);
    Ok(buffer)
}

pub fn export_keying_material(
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

        // PERF(port): was arena bulk-free — profile in Phase B
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

pub fn get_ephemeral_key_info(
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

pub fn get_alpn_protocol(this: &This, global: &JSGlobalObject) -> JsResult<JSValue> {
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

pub fn get_session(this: &This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
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

pub fn set_session(this: &This, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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
    // PERF(port): was arena bulk-free — profile in Phase B

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

pub fn get_tls_ticket(
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

pub fn renegotiate(this: &This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.get().ssl() else {
        return Ok(JSValue::UNDEFINED);
    };
    boringssl::ERR_clear_error();
    if ffi::SSL_renegotiate(boringssl::SSL::opaque_ref(ssl_ptr)) != 1 {
        return Err(global.throw_value(get_ssl_exception(global, b"SSL_renegotiate error")));
    }
    Ok(JSValue::UNDEFINED)
}

pub fn disable_renegotiation(
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

pub fn is_session_reused(
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

pub fn set_verify_mode(
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
    let mut verify_mode: c_int = boringssl::SSL_VERIFY_NONE;
    if this.is_server() {
        if request_cert {
            verify_mode = boringssl::SSL_VERIFY_PEER;
            if reject_unauthorized {
                verify_mode |= boringssl::SSL_VERIFY_FAIL_IF_NO_PEER_CERT;
            }
        }
    }
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
        let mut formatted: Vec<u8> = Vec::with_capacity(b"OpenSSL ".len() + message.len());
        {
            use std::io::Write;
            let _ = write!(&mut formatted, "OpenSSL {}", ::bstr::BStr::new(message));
        }
        // TODO(port): Zig leaks `formatted` into a global-marked ZigString; ownership semantics unclear.
        // `Interned::leak_vec` makes the process-lifetime leak explicit (the
        // bytes are never reclaimed). NOTE: `mark_global()` below tells JSC the
        // bytes are mimalloc-owned and may be freed via `mi_free`, but
        // `leak_vec` allocates with Rust's global allocator — allocator
        // mismatch if JSC ever adopts the buffer. `to_error_instance` clones
        // the string, so today the leaked bytes are simply never freed; the
        // `mark_global` is dead weight matching Zig 1:1 (see TODO below).
        zig_str = ZigString::init(bun_ptr::Interned::leak_vec(formatted).as_bytes());
        let mut encoded_str = zig_str.with_encoding();
        encoded_str.mark_global();
        // TODO(port): Zig discards encoded_str and continues using zig_str — possible upstream bug; matching Zig 1:1.
        let _ = encoded_str;

        // We shouldn't *need* to do this but it's not entirely clear.
        boringssl::ERR_clear_error();
    }

    if zig_str.len == 0 {
        zig_str = ZigString::init(default_message);
    }

    // store the exception in here
    // toErrorInstance clones the string
    let exception = zig_str.to_error_instance(global);

    // reference it in stack memory
    exception.ensure_still_alive();

    exception
}

// ported from: src/runtime/socket/tls_socket_functions.zig
