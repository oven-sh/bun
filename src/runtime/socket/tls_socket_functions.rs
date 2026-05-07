use core::ffi::{c_char, c_int, c_long, c_void};
use std::ffi::CStr;

use bun_boringssl_sys as boringssl;
use bun_jsc::{self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, StringJsc as _, ZigStringJsc as _};
use bun_str::{self, strings, String as BunString, ZigString};

use crate::api::bun_x509 as X509;
use crate::webcore::blob::ZigStringBlobExt as _;

// ──────────────────────────────────────────────────────────────────────────
// `JSValue::createBufferFromLength` lives upstream in `bun_jsc` (Zig) but the
// Rust port currently exposes it only via the private
// `crate::napi::napi_body::JSValueNapiExt`. Per port rules we shim the FFI
// locally rather than touching the napi crate; migrate once `bun_jsc::JSValue`
// grows the inherent method.
// ──────────────────────────────────────────────────────────────────────────
unsafe extern "C" {
    fn JSBuffer__bufferFromLength(global: *mut JSGlobalObject, len: i64) -> JSValue;
}
#[inline]
fn create_buffer_from_length(global: &JSGlobalObject, len: usize) -> JsResult<JSValue> {
    // SAFETY: FFI; may throw OOM.
    let v = unsafe { JSBuffer__bufferFromLength(global.as_ptr(), len as i64) };
    if global.has_exception() {
        return Err(jsc::JsError::Thrown);
    }
    Ok(v)
}

// ──────────────────────────────────────────────────────────────────────────
// Local BoringSSL FFI surface not yet in bun_boringssl_sys.
// Declared here per port rules (call the linked C symbol directly); migrate
// into `bun_boringssl_sys` once the bindgen pass covers them.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_camel_case_types, non_upper_case_globals, dead_code)]
pub mod ffi {
    use super::boringssl::{SSL, X509, struct_stack_st_X509, X509_STORE_CTX};
    use core::ffi::{c_char, c_int, c_long, c_uint, c_void};

    // Opaque handles missing from boringssl_sys.
    #[repr(C)] pub struct SSL_SESSION { _p: [u8; 0] }
    #[repr(C)] pub struct SSL_CIPHER { _p: [u8; 0] }
    #[repr(C)] pub struct EVP_PKEY { _p: [u8; 0] }
    #[repr(C)] pub struct EC_KEY { _p: [u8; 0] }
    #[repr(C)] pub struct EC_GROUP { _p: [u8; 0] }

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

    unsafe extern "C" {
        // ── SSL session/handshake info ───────────────────────────────────
        pub fn SSL_get_servername(ssl: *const SSL, type_: c_int) -> *const c_char;
        pub fn SSL_get_version(ssl: *const SSL) -> *const c_char;
        pub fn SSL_set_tlsext_host_name(ssl: *mut SSL, name: *const c_char) -> c_int;
        pub fn SSL_get_peer_certificate(ssl: *const SSL) -> *mut X509;
        pub fn SSL_get_certificate(ssl: *const SSL) -> *mut X509;
        pub fn SSL_set_max_send_fragment(ssl: *mut SSL, max_send_fragment: usize) -> c_int;
        pub fn SSL_get_finished(ssl: *const SSL, buf: *mut c_void, count: usize) -> usize;
        pub fn SSL_get_peer_finished(ssl: *const SSL, buf: *mut c_void, count: usize) -> usize;
        pub fn SSL_get_shared_sigalgs(
            ssl: *mut SSL,
            idx: c_int,
            psign: *mut c_int,
            phash: *mut c_int,
            psignhash: *mut c_int,
            rsig: *mut u8,
            rhash: *mut u8,
        ) -> c_int;
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
        pub fn SSL_get0_alpn_selected(
            ssl: *const SSL,
            out_data: *mut *const u8,
            out_len: *mut c_uint,
        );
        pub fn SSL_session_reused(ssl: *const SSL) -> c_int;
        pub fn SSL_get_privatekey(ssl: *const SSL) -> *mut EVP_PKEY;

        // ── SSL_SESSION ───────────────────────────────────────────────────
        pub fn SSL_get_session(ssl: *const SSL) -> *mut SSL_SESSION;
        pub fn SSL_set_session(ssl: *mut SSL, session: *mut SSL_SESSION) -> c_int;
        pub fn SSL_SESSION_free(session: *mut SSL_SESSION);
        pub fn SSL_SESSION_get0_ticket(
            session: *const SSL_SESSION,
            out_ticket: *mut *const u8,
            out_len: *mut usize,
        );
        pub fn i2d_SSL_SESSION(session: *mut SSL_SESSION, pp: *mut *mut u8) -> c_int;
        pub fn d2i_SSL_SESSION(
            a: *mut *mut SSL_SESSION,
            pp: *mut *const u8,
            length: c_long,
        ) -> *mut SSL_SESSION;

        // ── SSL_CIPHER ────────────────────────────────────────────────────
        pub fn SSL_get_current_cipher(ssl: *const SSL) -> *const SSL_CIPHER;
        pub fn SSL_CIPHER_get_name(cipher: *const SSL_CIPHER) -> *const c_char;
        pub fn SSL_CIPHER_standard_name(cipher: *const SSL_CIPHER) -> *const c_char;
        pub fn SSL_CIPHER_get_version(cipher: *const SSL_CIPHER) -> *const c_char;

        // ── X509 ─────────────────────────────────────────────────────────
        pub fn X509_free(x: *mut X509);
        pub fn X509_up_ref(x: *mut X509) -> c_int;

        // ── EVP / EC ──────────────────────────────────────────────────────
        pub fn EVP_PKEY_id(pkey: *const EVP_PKEY) -> c_int;
        pub fn EVP_PKEY_bits(pkey: *const EVP_PKEY) -> c_int;
        pub fn EVP_PKEY_get1_EC_KEY(pkey: *mut EVP_PKEY) -> *mut EC_KEY;
        pub fn EC_KEY_get0_group(key: *const EC_KEY) -> *const EC_GROUP;
        pub fn EC_GROUP_get_curve_name(group: *const EC_GROUP) -> c_int;

        // ── OBJ / ERR ─────────────────────────────────────────────────────
        pub fn OBJ_nid2sn(nid: c_int) -> *const c_char;
        pub fn ERR_reason_error_string(e: u32) -> *const c_char;
        pub fn ERR_func_error_string(e: u32) -> *const c_char;
        pub fn ERR_lib_error_string(e: u32) -> *const c_char;
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

pub fn get_servername(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };

    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let servername = unsafe { boringssl::SSL_get_servername(ssl_ptr, ffi::TLSEXT_NAMETYPE_host_name) };
    if servername.is_null() {
        return Ok(JSValue::UNDEFINED);
    }
    // SAFETY: SSL_get_servername returns a NUL-terminated C string owned by the SSL session.
    let slice = unsafe { CStr::from_ptr(servername) }.to_bytes();
    Ok(ZigString::from_utf8(slice).to_js(global))
}

pub fn set_servername(this: &mut This, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    if this.is_server() {
        return Err(global.throw(format_args!("Cannot issue SNI from a TLS server-side socket")));
    }

    let args = frame.arguments_old::<1>();
    if args.len < 1 {
        return Err(global.throw(format_args!("Expected 1 argument")));
    }

    let server_name = args.ptr[0];
    if !server_name.is_string() {
        return Err(global.throw(format_args!("Expected \"serverName\" to be a string")));
    }

    let slice: Box<[u8]> = server_name.get_zig_string(global)?.to_owned_slice().into_boxed_slice();
    // Drop replaces the old value (Zig manually freed `old`).
    this.server_name = Some(slice);

    let host = this.server_name.as_deref().unwrap();
    if !host.is_empty() {
        let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };

        // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
        if unsafe { boringssl::SSL_is_init_finished(ssl_ptr) } != 0 {
            // match node.js exceptions
            return Err(global.throw(format_args!("Already started.")));
        }
        let host_z = bun_core::ZBox::from_bytes(host);
        // SAFETY: `host_z` is NUL-terminated; FFI reads until NUL.
        unsafe { ffi::SSL_set_tlsext_host_name(ssl_ptr, host_z.as_ptr()) };
    }

    Ok(JSValue::UNDEFINED)
}

pub fn get_peer_x509_certificate(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let cert = unsafe { ffi::SSL_get_peer_certificate(ssl_ptr) };
    if !cert.is_null() {
        // SAFETY: cert is a non-null *mut X509 (null-checked above).
        return X509::to_js_object(unsafe { &mut *cert }, global);
    }
    Ok(JSValue::UNDEFINED)
}

pub fn get_x509_certificate(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let cert = unsafe { ffi::SSL_get_certificate(ssl_ptr) };
    if !cert.is_null() {
        // SAFETY: cert is a non-null *mut X509 (null-checked above); X509_up_ref bumps the refcount before handing to JS.
        unsafe { ffi::X509_up_ref(cert) };
        return X509::to_js_object(unsafe { &mut *cert }, global);
    }
    Ok(JSValue::UNDEFINED)
}

pub fn get_tls_version(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding();

    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::NULL) };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let version = unsafe { ffi::SSL_get_version(ssl_ptr) };
    if version.is_null() {
        return Ok(JSValue::NULL);
    }
    // SAFETY: SSL_get_version returns a static NUL-terminated C string.
    let slice = unsafe { CStr::from_ptr(version) }.to_bytes();
    if slice.is_empty() {
        return Ok(JSValue::NULL);
    }
    Ok(ZigString::from_utf8(slice).to_js(global))
}

pub fn set_max_send_fragment(this: &mut This, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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

    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::FALSE) };
    Ok(JSValue::from(
        // SAFETY: ssl_ptr is a live *mut SSL; size is range-checked to [1, 16384] above.
        unsafe { ffi::SSL_set_max_send_fragment(ssl_ptr, usize::try_from(size).expect("int cast")) } == 1,
    ))
}

pub fn get_peer_certificate(this: &mut This, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
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

    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };

    if abbreviated {
        if this.is_server() {
            // SSL_get_peer_certificate returns a +1 reference; we must free it.
            // X509::to_js only borrows the pointer (X509View is non-owning).
            // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
            let cert = unsafe { ffi::SSL_get_peer_certificate(ssl_ptr) };
            if !cert.is_null() {
                // SAFETY: `c` is the +1 X509 reference returned by SSL_get_peer_certificate; we own it.
                let _guard = scopeguard::guard(cert, |c| unsafe { ffi::X509_free(c) });
                // SAFETY: cert is a non-null *mut X509 (null-checked above).
                return X509::to_js(unsafe { &mut *cert }, global);
            }
        }

        // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
        let cert_chain = unsafe { boringssl::SSL_get_peer_cert_chain(ssl_ptr) };
        if cert_chain.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: cert_chain is a non-null STACK_OF(X509) just returned by SSL_get_peer_cert_chain.
        let cert = unsafe { boringssl::sk_X509_value(cert_chain, 0) };
        if cert.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SAFETY: cert is a non-null *mut X509 (null-checked above).
        return X509::to_js(unsafe { &mut *cert }, global);
    }

    let mut cert: *mut boringssl::X509 = core::ptr::null_mut();
    if this.is_server() {
        // SSL_get_peer_certificate returns a +1 reference; we must free it.
        // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
        cert = unsafe { ffi::SSL_get_peer_certificate(ssl_ptr) };
    }
    let _guard = scopeguard::guard(cert, |c| {
        if !c.is_null() {
            // SAFETY: `c` is the +1 X509 reference returned by SSL_get_peer_certificate; we own it.
            unsafe { ffi::X509_free(c) };
        }
    });

    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let cert_chain = unsafe { boringssl::SSL_get_peer_cert_chain(ssl_ptr) };
    let first_cert: *mut boringssl::X509 = if !cert.is_null() {
        cert
    } else if !cert_chain.is_null() {
        // SAFETY: cert_chain is a non-null STACK_OF(X509) just returned by SSL_get_peer_cert_chain.
        unsafe { boringssl::sk_X509_value(cert_chain, 0) }
    } else {
        core::ptr::null_mut()
    };

    if first_cert.is_null() {
        return Ok(JSValue::UNDEFINED);
    }

    // TODO: we need to support the non abbreviated version of this
    Ok(JSValue::UNDEFINED)
}

pub fn get_certificate(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let cert = unsafe { ffi::SSL_get_certificate(ssl_ptr) };

    if !cert.is_null() {
        // SAFETY: cert is a non-null *mut X509 (null-checked above).
        return X509::to_js(unsafe { &mut *cert }, global);
    }
    Ok(JSValue::UNDEFINED)
}

pub fn get_tls_finished_message(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // We cannot just pass nullptr to SSL_get_finished()
    // because it would further be propagated to memcpy(),
    // where the standard requirements as described in ISO/IEC 9899:2011
    // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
    // Thus, we use a dummy byte.
    let mut dummy: [u8; 1] = [0; 1];
    // SAFETY: ssl_ptr is a live *mut SSL; dummy is a valid 1-byte writable buffer.
    let size = unsafe {
        ffi::SSL_get_finished(ssl_ptr, dummy.as_mut_ptr().cast::<c_void>(), core::mem::size_of_val(&dummy))
    };
    if size == 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let buffer_size = usize::try_from(size).expect("int cast");
    let buffer = create_buffer_from_length(global, buffer_size)?;
    let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr.cast::<c_void>();

    // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr points to a buffer_size-byte JS ArrayBuffer kept alive on the stack.
    let result_size = unsafe { ffi::SSL_get_finished(ssl_ptr, buffer_ptr, buffer_size) };
    debug_assert!(result_size == size);
    Ok(buffer)
}

pub fn get_shared_sigalgs(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    jsc::mark_binding();

    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::NULL) };

    // SAFETY: ssl_ptr is a live *mut SSL; passing null out-params requests only the count.
    let nsig = unsafe {
        ffi::SSL_get_shared_sigalgs(
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

    for i in 0..usize::try_from(nsig).expect("int cast") {
        let mut hash_nid: c_int = 0;
        let mut sign_nid: c_int = 0;
        let mut sig_with_md: &[u8] = b"";

        // SAFETY: ssl_ptr is a live *mut SSL; i is in [0, nsig); out-params are valid stack locals or null.
        unsafe {
            ffi::SSL_get_shared_sigalgs(
                ssl_ptr,
                c_int::try_from(i).expect("int cast"),
                &mut sign_nid,
                &mut hash_nid,
                core::ptr::null_mut(),
                core::ptr::null_mut(),
                core::ptr::null_mut(),
            );
        }
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
                // SAFETY: OBJ_nid2sn is safe to call with any nid; returns null if unknown.
                let sn_str = unsafe { ffi::OBJ_nid2sn(sign_nid) };
                if !sn_str.is_null() {
                    // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
                    sig_with_md = unsafe { CStr::from_ptr(sn_str) }.to_bytes();
                } else {
                    sig_with_md = b"UNDEF";
                }
            }
        }

        // SAFETY: OBJ_nid2sn is safe to call with any nid; returns null if unknown.
        let hash_str = unsafe { ffi::OBJ_nid2sn(hash_nid) };
        if !hash_str.is_null() {
            // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
            let hash_slice = unsafe { CStr::from_ptr(hash_str) }.to_bytes();
            let mut buffer: Vec<u8> = Vec::with_capacity(sig_with_md.len() + hash_slice.len() + 1);
            buffer.extend_from_slice(sig_with_md);
            buffer.push(b'+');
            buffer.extend_from_slice(hash_slice);
            array.put_index(global, u32::try_from(i).expect("int cast"), ZigString::from_utf8(&buffer).to_js(global))?;
        } else {
            let mut buffer: Vec<u8> = Vec::with_capacity(sig_with_md.len() + 6);
            buffer.extend_from_slice(sig_with_md);
            buffer.extend_from_slice(b"+UNDEF");
            array.put_index(global, u32::try_from(i).expect("int cast"), ZigString::from_utf8(&buffer).to_js(global))?;
        }
    }
    Ok(array)
}

pub fn get_cipher(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let cipher = unsafe { ffi::SSL_get_current_cipher(ssl_ptr) };
    let result = JSValue::create_empty_object(global, 0);

    if cipher.is_null() {
        result.put(global, b"name", JSValue::NULL);
        result.put(global, b"standardName", JSValue::NULL);
        result.put(global, b"version", JSValue::NULL);
        return Ok(result);
    }

    // SAFETY: cipher is a non-null *const SSL_CIPHER (null-checked above).
    let name = unsafe { ffi::SSL_CIPHER_get_name(cipher) };
    if name.is_null() {
        result.put(global, b"name", JSValue::NULL);
    } else {
        // SAFETY: SSL_CIPHER_get_name returns a static NUL-terminated C string.
        let s = unsafe { CStr::from_ptr(name) }.to_bytes();
        result.put(global, b"name", ZigString::from_utf8(s).to_js(global));
    }

    // SAFETY: cipher is a non-null *const SSL_CIPHER (null-checked above).
    let standard_name = unsafe { ffi::SSL_CIPHER_standard_name(cipher) };
    if standard_name.is_null() {
        result.put(global, b"standardName", JSValue::NULL);
    } else {
        // SAFETY: SSL_CIPHER_standard_name returns a static NUL-terminated C string.
        let s = unsafe { CStr::from_ptr(standard_name) }.to_bytes();
        result.put(global, b"standardName", ZigString::from_utf8(s).to_js(global));
    }

    // SAFETY: cipher is a non-null *const SSL_CIPHER (null-checked above).
    let version = unsafe { ffi::SSL_CIPHER_get_version(cipher) };
    if version.is_null() {
        result.put(global, b"version", JSValue::NULL);
    } else {
        // SAFETY: SSL_CIPHER_get_version returns a static NUL-terminated C string.
        let s = unsafe { CStr::from_ptr(version) }.to_bytes();
        result.put(global, b"version", ZigString::from_utf8(s).to_js(global));
    }

    Ok(result)
}

pub fn get_tls_peer_finished_message(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // We cannot just pass nullptr to SSL_get_peer_finished()
    // because it would further be propagated to memcpy(),
    // where the standard requirements as described in ISO/IEC 9899:2011
    // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
    // Thus, we use a dummy byte.
    let mut dummy: [u8; 1] = [0; 1];
    // SAFETY: ssl_ptr is a live *mut SSL; dummy is a valid 1-byte writable buffer.
    let size = unsafe {
        ffi::SSL_get_peer_finished(ssl_ptr, dummy.as_mut_ptr().cast::<c_void>(), core::mem::size_of_val(&dummy))
    };
    if size == 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let buffer_size = usize::try_from(size).expect("int cast");
    let buffer = create_buffer_from_length(global, buffer_size)?;
    let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr.cast::<c_void>();

    // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr points to a buffer_size-byte JS ArrayBuffer kept alive on the stack.
    let result_size = unsafe { ffi::SSL_get_peer_finished(ssl_ptr, buffer_ptr, buffer_size) };
    debug_assert!(result_size == size);
    Ok(buffer)
}

pub fn export_keying_material(this: &mut This, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    if this.socket.is_detached() {
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
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };

    if args.len > 2 {
        let context_arg = args.ptr[2];

        // PERF(port): was arena bulk-free — profile in Phase B
        if let Some(sb) = StringOrBuffer::from_js(global, context_arg)? {
            let context_slice = sb.slice();

            let buffer_size = usize::try_from(length).expect("int cast");
            let buffer = create_buffer_from_length(global, buffer_size)?;
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
                return Err(global.throw_value(get_ssl_exception(global, b"Failed to export keying material")));
            }
            Ok(buffer)
        } else {
            Err(global.throw(format_args!("Expected context to be a string, Buffer or TypedArray")))
        }
    } else {
        let buffer_size = usize::try_from(length).expect("int cast");
        let buffer = create_buffer_from_length(global, buffer_size)?;
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
            return Err(global.throw_value(get_ssl_exception(global, b"Failed to export keying material")));
        }
        Ok(buffer)
    }
}

pub fn get_ephemeral_key_info(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    // only available for clients
    if this.is_server() {
        return Ok(JSValue::NULL);
    }

    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::NULL) };
    let result = JSValue::create_empty_object(global, 0);

    // TODO: investigate better option or compatible way to get the key
    // this implementation follows nodejs but for BoringSSL SSL_get_server_tmp_key will always return 0
    // wich will result in a empty object
    // let mut raw_key: *mut boringssl::EVP_PKEY = core::ptr::null_mut();
    // if unsafe { boringssl::SSL_get_server_tmp_key(ssl_ptr, &mut raw_key) } == 0 {
    //     return Ok(result);
    // }
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let raw_key: *mut ffi::EVP_PKEY = unsafe { ffi::SSL_get_privatekey(ssl_ptr) };
    if raw_key.is_null() {
        return Ok(result);
    }

    // SAFETY: raw_key is a non-null *mut EVP_PKEY (null-checked above).
    let kid = unsafe { ffi::EVP_PKEY_id(raw_key) };
    // SAFETY: raw_key is a non-null *mut EVP_PKEY (null-checked above).
    let bits = unsafe { ffi::EVP_PKEY_bits(raw_key) };

    match kid {
        ffi::EVP_PKEY_DH => {
            result.put(global, b"type", BunString::static_("DH").to_js(global)?);
            result.put(global, b"size", JSValue::js_number(f64::from(bits)));
        }
        ffi::EVP_PKEY_EC | ffi::EVP_PKEY_X25519 | ffi::EVP_PKEY_X448 => {
            let curve_name: &[u8];
            if kid == ffi::EVP_PKEY_EC {
                // SAFETY: raw_key is a non-null EVP_PKEY of type EVP_PKEY_EC (checked just above).
                let ec = unsafe { ffi::EVP_PKEY_get1_EC_KEY(raw_key) };
                // SAFETY: ec is the EC_KEY returned for an EC pkey; EC_KEY_get0_group on it is valid.
                let nid = unsafe { ffi::EC_GROUP_get_curve_name(ffi::EC_KEY_get0_group(ec)) };
                // SAFETY: OBJ_nid2sn is safe to call with any nid; returns null if unknown.
                let nid_str = unsafe { ffi::OBJ_nid2sn(nid) };
                if !nid_str.is_null() {
                    // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
                    curve_name = unsafe { CStr::from_ptr(nid_str) }.to_bytes();
                } else {
                    curve_name = b"";
                }
            } else {
                // SAFETY: OBJ_nid2sn is safe to call with any nid; returns null if unknown.
                let kid_str = unsafe { ffi::OBJ_nid2sn(kid) };
                if !kid_str.is_null() {
                    // SAFETY: OBJ_nid2sn returns a static NUL-terminated C string.
                    curve_name = unsafe { CStr::from_ptr(kid_str) }.to_bytes();
                } else {
                    curve_name = b"";
                }
            }
            result.put(global, b"type", BunString::static_("ECDH").to_js(global)?);
            result.put(global, b"name", ZigString::from_utf8(curve_name).to_js(global));
            result.put(global, b"size", JSValue::js_number(f64::from(bits)));
        }
        _ => {}
    }
    Ok(result)
}

pub fn get_alpn_protocol(this: &This, global: &JSGlobalObject) -> JsResult<JSValue> {
    let mut alpn_proto: *const u8 = core::ptr::null();
    let mut alpn_proto_len: u32 = 0;

    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::FALSE) };

    // SAFETY: ssl_ptr is a live *mut SSL; out-params are valid stack locals.
    unsafe { ffi::SSL_get0_alpn_selected(ssl_ptr, &mut alpn_proto, &mut alpn_proto_len) };
    if alpn_proto.is_null() || alpn_proto_len == 0 {
        return Ok(JSValue::FALSE);
    }

    // SAFETY: SSL_get0_alpn_selected guarantees alpn_proto points to alpn_proto_len bytes owned by the SSL.
    let slice = unsafe { core::slice::from_raw_parts(alpn_proto, alpn_proto_len as usize) };
    if strings::eql(slice, b"h2") {
        return BunString::static_("h2").to_js(global);
    }
    if strings::eql(slice, b"http/1.1") {
        return BunString::static_("http/1.1").to_js(global);
    }
    Ok(ZigString::from_utf8(slice).to_js(global))
}

pub fn get_session(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let session = unsafe { ffi::SSL_get_session(ssl_ptr) };
    if session.is_null() {
        return Ok(JSValue::UNDEFINED);
    }
    // SAFETY: session is a non-null *mut SSL_SESSION; null out-param requests only the encoded size.
    let size = unsafe { ffi::i2d_SSL_SESSION(session, core::ptr::null_mut()) };
    if size <= 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let buffer_size = usize::try_from(size).expect("int cast");
    let buffer = create_buffer_from_length(global, buffer_size)?;
    let mut buffer_ptr: *mut u8 = buffer.as_array_buffer(global).unwrap().ptr;

    // SAFETY: session is a non-null *mut SSL_SESSION; buffer_ptr points to a buffer_size-byte JS ArrayBuffer kept alive on the stack.
    let result_size = unsafe { ffi::i2d_SSL_SESSION(session, &mut buffer_ptr) };
    debug_assert!(result_size == size);
    Ok(buffer)
}

pub fn set_session(this: &mut This, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    if this.socket.is_detached() {
        return Ok(JSValue::UNDEFINED);
    }

    let args = frame.arguments_old::<1>();

    if args.len < 1 {
        return Err(global.throw(format_args!("Expected session to be a string, Buffer or TypedArray")));
    }

    let session_arg = args.ptr[0];
    // PERF(port): was arena bulk-free — profile in Phase B

    if let Some(sb) = StringOrBuffer::from_js(global, session_arg)? {
        let session_slice = sb.slice();
        let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
        let mut tmp: *const u8 = session_slice.as_ptr();
        // SAFETY: tmp/session_slice.len() describe a valid readable buffer borrowed from `sb` for the duration of this call.
        let session = unsafe {
            ffi::d2i_SSL_SESSION(core::ptr::null_mut(), &mut tmp, c_long::try_from(session_slice.len()).expect("int cast"))
        };
        if session.is_null() {
            return Ok(JSValue::UNDEFINED);
        }
        // SSL_set_session takes its own reference ("the caller retains ownership of |session|"),
        // so we must release the one returned by d2i_SSL_SESSION on every path.
        // SAFETY: `s` is the +1 SSL_SESSION reference returned by d2i_SSL_SESSION; we own it.
        let _guard = scopeguard::guard(session, |s| unsafe { ffi::SSL_SESSION_free(s) });
        // SAFETY: ssl_ptr is a live *mut SSL; session is a non-null *mut SSL_SESSION owned above.
        if unsafe { ffi::SSL_set_session(ssl_ptr, session) } != 1 {
            return Err(global.throw_value(get_ssl_exception(global, b"SSL_set_session error")));
        }
        Ok(JSValue::UNDEFINED)
    } else {
        Err(global.throw(format_args!("Expected session to be a string, Buffer or TypedArray")))
    }
}

pub fn get_tls_ticket(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    let session = unsafe { ffi::SSL_get_session(ssl_ptr) };
    if session.is_null() {
        return Ok(JSValue::UNDEFINED);
    }
    let mut ticket: *const u8 = core::ptr::null();
    let mut length: usize = 0;
    // The pointer is only valid while the connection is in use so we need to copy it
    // SAFETY: session is a non-null *mut SSL_SESSION; out-params are valid stack locals.
    unsafe { ffi::SSL_SESSION_get0_ticket(session, &mut ticket, &mut length) };

    if ticket.is_null() || length == 0 {
        return Ok(JSValue::UNDEFINED);
    }

    // SAFETY: SSL_SESSION_get0_ticket guarantees `ticket` points to `length` bytes owned by the session.
    let slice = unsafe { core::slice::from_raw_parts(ticket, length) };
    jsc::ArrayBuffer::create_buffer(global, slice)
}

pub fn renegotiate(this: &mut This, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // SAFETY: ERR_clear_error has no preconditions; clears the calling thread's BoringSSL error queue.
    unsafe { boringssl::ERR_clear_error() };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    if unsafe { boringssl::SSL_renegotiate(ssl_ptr) } != 1 {
        return Err(global.throw_value(get_ssl_exception(global, b"SSL_renegotiate error")));
    }
    Ok(JSValue::UNDEFINED)
}

pub fn disable_renegotiation(this: &mut This, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    unsafe { boringssl::SSL_set_renegotiate_mode(ssl_ptr, boringssl::ssl_renegotiate_never) };
    Ok(JSValue::UNDEFINED)
}

pub fn is_session_reused(this: &mut This, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::FALSE) };
    // SAFETY: ssl_ptr is a live *mut SSL returned by this.socket.ssl().
    Ok(JSValue::from(unsafe { ffi::SSL_session_reused(ssl_ptr) } == 1))
}

pub fn set_verify_mode(this: &mut This, global: &JSGlobalObject, frame: &CallFrame) -> JsResult<JSValue> {
    if this.socket.is_detached() {
        return Ok(JSValue::UNDEFINED);
    }

    let args = frame.arguments_old::<2>();

    if args.len < 2 {
        return Err(global.throw(format_args!("Expected requestCert and rejectUnauthorized arguments")));
    }
    let request_cert_js = args.ptr[0];
    let reject_unauthorized_js = args.ptr[1];
    if !request_cert_js.is_boolean() || !reject_unauthorized_js.is_boolean() {
        return Err(global.throw(format_args!("Expected requestCert and rejectUnauthorized arguments to be boolean")));
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
    let Some(ssl_ptr) = this.socket.ssl() else { return Ok(JSValue::UNDEFINED) };
    // we always allow and check the SSL certificate after the handshake or renegotiation
    // SAFETY: ssl_ptr is a live *mut SSL; the callback is an `extern "C"` fn with the SSL_verify_cb signature.
    unsafe { boringssl::SSL_set_verify(ssl_ptr, verify_mode, Some(always_allow_ssl_verify_callback)) };
    Ok(JSValue::UNDEFINED)
}

extern "C" fn always_allow_ssl_verify_callback(_preverify_ok: c_int, _ctx: *mut boringssl::X509_STORE_CTX) -> c_int {
    1
}

#[cold]
#[inline(never)]
fn get_ssl_exception(global: &JSGlobalObject, default_message: &[u8]) -> JSValue {
    let mut zig_str = ZigString::init(b"");
    let mut output_buf: [u8; 4096] = [0; 4096];

    output_buf[0] = 0;
    let mut written: usize = 0;
    // SAFETY: ERR_get_error has no preconditions; reads the calling thread's BoringSSL error queue.
    let mut ssl_error = unsafe { boringssl::ERR_get_error() };
    while ssl_error != 0 && written < output_buf.len() {
        if written > 0 {
            output_buf[written] = b'\n';
            written += 1;
        }

        // SAFETY: ERR_reason_error_string accepts any packed error code; returns null if unknown.
        let reason_ptr = unsafe { ffi::ERR_reason_error_string(ssl_error) };
        if !reason_ptr.is_null() {
            // SAFETY: ERR_reason_error_string returns a static NUL-terminated C string.
            let reason = unsafe { CStr::from_ptr(reason_ptr) }.to_bytes();
            if reason.is_empty() {
                break;
            }
            output_buf[written..written + reason.len()].copy_from_slice(reason);
            written += reason.len();
        }

        // SAFETY: ERR_func_error_string accepts any packed error code; returns null if unknown.
        let func_ptr = unsafe { ffi::ERR_func_error_string(ssl_error) };
        if !func_ptr.is_null() {
            // SAFETY: ERR_func_error_string returns a static NUL-terminated C string.
            let reason = unsafe { CStr::from_ptr(func_ptr) }.to_bytes();
            if !reason.is_empty() {
                const VIA: &[u8] = b" via ";
                output_buf[written..written + VIA.len()].copy_from_slice(VIA);
                written += VIA.len();
                output_buf[written..written + reason.len()].copy_from_slice(reason);
                written += reason.len();
            }
        }

        // SAFETY: ERR_lib_error_string accepts any packed error code; returns null if unknown.
        let lib_ptr = unsafe { ffi::ERR_lib_error_string(ssl_error) };
        if !lib_ptr.is_null() {
            // SAFETY: ERR_lib_error_string returns a static NUL-terminated C string.
            let reason = unsafe { CStr::from_ptr(lib_ptr) }.to_bytes();
            if !reason.is_empty() {
                output_buf[written] = b' ';
                written += 1;
                output_buf[written..written + reason.len()].copy_from_slice(reason);
                written += reason.len();
            }
        }

        // SAFETY: ERR_get_error has no preconditions; reads the calling thread's BoringSSL error queue.
        ssl_error = unsafe { boringssl::ERR_get_error() };
    }

    if written > 0 {
        let message = &output_buf[0..written];
        let mut formatted: Vec<u8> = Vec::with_capacity(b"OpenSSL ".len() + message.len());
        {
            use std::io::Write;
            let _ = write!(&mut formatted, "OpenSSL {}", ::bstr::BStr::new(message));
        }
        // TODO(port): Zig leaks `formatted` into a global-marked ZigString; ownership semantics unclear.
        zig_str = ZigString::init(formatted.leak());
        let mut encoded_str = zig_str.with_encoding();
        encoded_str.mark_global();
        // TODO(port): Zig discards encoded_str and continues using zig_str — possible upstream bug; matching Zig 1:1.
        let _ = encoded_str;

        // We shouldn't *need* to do this but it's not entirely clear.
        // SAFETY: ERR_clear_error has no preconditions; clears the calling thread's BoringSSL error queue.
        unsafe { boringssl::ERR_clear_error() };
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/socket/tls_socket_functions.zig (673 lines)
//   confidence: medium
//   todos:      3
//   notes:      Mixin host-fns for TLSSocket; BoringSSL FFI return-type nullability (Option vs raw ptr) and StringOrBuffer::from_js signature need Phase B fixup.
// ──────────────────────────────────────────────────────────────────────────
