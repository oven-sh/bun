use core::ffi::c_int;

use crate::api::bun_secure_context::SecureContext;
use bun_boringssl_sys as boringssl;
use bun_core::{EncodedSlice, String as BunString, strings};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    self as jsc, CallFrame, EncodedSliceJsc as _, JSGlobalObject, JSValue, JsResult, StringJsc as _,
};

use crate::api::bun_x509 as X509;
use crate::node::StringOrBuffer;

// The `#[bun_jsc::host_fn]` shims live on `NewSocket<SSL>` in `socket_body.rs`
// and forward into these free helpers — keep them as plain `fn`s.
// this file is `mod`-included from BOTH `socket/mod.rs` and
// `socket/socket_body.rs`; `super::TLSSocket` resolves to the parent's
// `NewSocket<true>` in either compilation, whereas the absolute path
// `crate::api::TLSSocket` always picked the `mod.rs` shape and broke the
// `socket_body` instance.
type This = super::TLSSocket;

/// The socket's `SSL`, if it has one (an opaque handle owned by the
/// transport, live while the socket is).
fn ssl_of(this: &This) -> Option<&mut boringssl::SSL> {
    this.socket.get().ssl().map(boringssl::SSL::opaque_mut)
}

pub(super) fn get_servername(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };

    let Some(servername) = ssl.servername() else {
        return Ok(JSValue::UNDEFINED);
    };
    bun_string_jsc::create_utf8_for_js(global, servername)
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
        .to_bun_string(global)?
        .to_owned_slice()
        .into_boxed_slice();
    // Drop replaces the old value.
    this.server_name.set(Some(slice));

    let host = this.server_name.get().as_deref().unwrap();
    if !host.is_empty() {
        let Some(ssl) = ssl_of(this) else {
            return Ok(JSValue::UNDEFINED);
        };

        if ssl.is_init_finished() {
            // match node.js exceptions
            return Err(global.throw(format_args!("Already started.")));
        }
        // The C API reads up to the first NUL; keep that truncation.
        let host_z = bun_core::ZBox::from_bytes(host);
        let host_c = core::ffi::CStr::from_bytes_until_nul(host_z.as_zstr().as_bytes_with_nul())
            .expect("ZBox is NUL-terminated");
        ssl.set_tlsext_host_name(host_c);
    }

    Ok(JSValue::UNDEFINED)
}

pub(super) fn get_peer_x509_certificate(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    if let Some(cert) = ssl.peer_certificate() {
        return X509::to_js_object(cert, global);
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn get_x509_certificate(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    if let Some(cert) = ssl.certificate() {
        // A new reference for the JS object to own.
        return X509::to_js_object(cert.up_ref(), global);
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn get_tls_version(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding();

    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::NULL);
    };
    let Some(version) = ssl.version_str() else {
        return Ok(JSValue::NULL);
    };
    let slice = version.to_bytes();
    if slice.is_empty() {
        return Ok(JSValue::NULL);
    }
    bun_string_jsc::create_utf8_for_js(global, slice)
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

    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::FALSE);
    };
    Ok(JSValue::from(ssl.set_max_send_fragment(
        usize::try_from(size).expect("int cast"),
    )))
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

    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    let ssl: &boringssl::SSL = ssl;
    let is_server_ssl = ssl.is_server();

    if abbreviated {
        if is_server_ssl {
            // A +1 reference released when `cert` drops; `X509::to_js` only
            // borrows it.
            if let Some(cert) = ssl.peer_certificate() {
                return X509::to_js(&cert, global);
            }
        }

        let Some(cert_chain) = ssl.peer_cert_chain() else {
            return Ok(JSValue::UNDEFINED);
        };
        let Some(cert) = cert_chain.get(0) else {
            return Ok(JSValue::UNDEFINED);
        };
        return X509::to_js(cert, global);
    }

    // SSL_get_peer_certificate returns a +1 reference, released when this
    // drops.
    let cert: Option<boringssl::OwnedX509> = if is_server_ssl {
        ssl.peer_certificate()
    } else {
        None
    };

    let cert_chain = ssl.peer_cert_chain();
    let first_cert: Option<&boringssl::X509> = match (&cert, cert_chain) {
        (Some(cert), _) => Some(cert),
        (None, Some(chain)) => chain.get(0),
        (None, None) => None,
    };
    let Some(first_cert) = first_cert else {
        return Ok(JSValue::UNDEFINED);
    };

    // The detailed form returns the whole chain the peer presented, each
    // certificate linking to its issuer through `issuerCertificate`, the way
    // Node's getPeerCertificate(true) does. SSL_get_peer_cert_chain includes
    // the leaf on the client side but not on the server side, where the +1
    // peer certificate above is the leaf instead.
    let first_obj = X509::to_js(first_cert, global)?;
    // Link each certificate to its predecessor immediately so every object in
    // the chain is reachable from the stack-rooted `first_obj` before the next
    // `X509::to_js` allocation can trigger a GC - a heap-backed Vec<JSValue>
    // is not stack-scanned.
    let mut prev_obj: JSValue = first_obj;
    let mut last_cert: &boringssl::X509 = first_cert;
    if let Some(cert_chain) = cert_chain {
        let mut i: usize = if cert.is_none() { 1 } else { 0 };
        while let Some(next) = cert_chain.get(i) {
            let obj = X509::to_js(next, global)?;
            prev_obj.put(global, b"issuerCertificate", obj);
            prev_obj = obj;
            last_cert = next;
            i += 1;
        }
    }

    // Extend the chain through the local trust store until a self-issued
    // certificate is reached, the way Node's getPeerCertificate(true) walks
    // X509_STORE_CTX_get1_issuer to surface the root that completed
    // verification even though the peer never sent it. Every issuer found is
    // a +1 reference held in `extras` until its fields have been copied into
    // JS values and the terminal self-issued check has run.
    let mut last_is_self_issued = false;
    {
        // A context built without an explicit `ca` (and without requestCert,
        // which installs the shared roots) carries an empty store and the
        // issuer walk would stop at whatever the peer sent. Fall back to the
        // process-wide default roots the way Node's per-context store always
        // contains the bundled roots. That reference is released after the
        // walk.
        let own_store = ssl.ssl_ctx().cert_store_opt();
        let shared_store = if own_store.is_none_or(|s| s.is_empty()) {
            bun_uws_sys::ssl::shared_default_ca_store()
        } else {
            None
        };
        let store: Option<&boringssl::X509_STORE> = shared_store.as_deref().or(own_store);
        if let Some(mut store_ctx) = store.and_then(boringssl::X509StoreCtx::new) {
            let mut extras: Vec<boringssl::OwnedX509> = Vec::new();
            // Cap the walk so a cyclic store cannot loop forever.
            while extras.len() < 16 && last_cert.check_issued(last_cert) != 0 {
                let Some(issuer) = store_ctx.get1_issuer(last_cert) else {
                    break;
                };
                let obj = X509::to_js(&issuer, global)?;
                prev_obj.put(global, b"issuerCertificate", obj);
                prev_obj = obj;
                // `X509` is an opaque handle: this borrows the certificate,
                // which `extras` keeps alive past the loop.
                last_cert = boringssl::X509::opaque_ref(issuer.as_mut_ptr());
                extras.push(issuer);
            }
            last_is_self_issued = last_cert.check_issued(last_cert) == 0;
            drop(extras);
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
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    if let Some(cert) = ssl.certificate() {
        return X509::to_js(cert, global);
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn get_tls_finished_message(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    // We cannot just pass nullptr to SSL_get_finished()
    // because it would further be propagated to memcpy(),
    // where the standard requirements as described in ISO/IEC 9899:2011
    // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
    // Thus, we use a dummy byte.
    let mut dummy: [u8; 1] = [0; 1];
    let size = ssl.get_finished(&mut dummy);
    if size == 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let buffer_size = size;
    let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
    let mut array_buffer = buffer.as_array_buffer(global).unwrap();
    let result_size = ssl.get_finished(array_buffer.byte_slice_mut());
    debug_assert!(result_size == size);
    Ok(buffer)
}

pub(super) fn get_shared_sigalgs(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    jsc::mark_binding();

    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::NULL);
    };

    let nsig = ssl.shared_sigalgs_count();

    let array = JSValue::create_empty_array(global, nsig)?;

    for i in 0..nsig {
        let (sign_nid, hash_nid) = ssl.shared_sigalg(i);
        let sig_with_md: &[u8] = match sign_nid {
            boringssl::EVP_PKEY_RSA => b"RSA",
            boringssl::EVP_PKEY_RSA_PSS => b"RSA-PSS",
            boringssl::EVP_PKEY_DSA => b"DSA",
            boringssl::EVP_PKEY_EC => b"ECDSA",
            boringssl::NID_ED25519 => b"Ed25519",
            boringssl::NID_ED448 => b"Ed448",
            boringssl::NID_id_GostR3410_2001 => b"gost2001",
            boringssl::NID_id_GostR3410_2012_256 => b"gost2012_256",
            boringssl::NID_id_GostR3410_2012_512 => b"gost2012_512",
            _ => match boringssl::nid2sn(sign_nid) {
                Some(sn) => sn.to_bytes(),
                None => b"UNDEF",
            },
        };

        if let Some(hash) = boringssl::nid2sn(hash_nid) {
            let hash_slice = hash.to_bytes();
            let mut buffer: Vec<u8> = Vec::with_capacity(sig_with_md.len() + hash_slice.len() + 1);
            buffer.extend_from_slice(sig_with_md);
            buffer.push(b'+');
            buffer.extend_from_slice(hash_slice);
            array.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                bun_string_jsc::create_utf8_for_js(global, &buffer)?,
            )?;
        } else {
            let mut buffer: Vec<u8> = Vec::with_capacity(sig_with_md.len() + 6);
            buffer.extend_from_slice(sig_with_md);
            buffer.extend_from_slice(b"+UNDEF");
            array.put_index(
                global,
                u32::try_from(i).expect("int cast"),
                bun_string_jsc::create_utf8_for_js(global, &buffer)?,
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
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    let result = JSValue::create_empty_object(global, 0);

    let Some(cipher) = ssl.current_cipher() else {
        result.put(global, b"name", JSValue::NULL);
        result.put(global, b"standardName", JSValue::NULL);
        result.put(global, b"version", JSValue::NULL);
        return Ok(result);
    };

    let to_js = |s: Option<&core::ffi::CStr>| match s {
        Some(s) => bun_string_jsc::create_utf8_for_js(global, s.to_bytes()),
        None => Ok(JSValue::NULL),
    };
    result.put(global, b"name", to_js(cipher.name())?);
    result.put(global, b"standardName", to_js(cipher.standard_name())?);
    result.put(global, b"version", to_js(cipher.version())?);

    Ok(result)
}

pub(super) fn get_tls_peer_finished_message(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    // We cannot just pass nullptr to SSL_get_peer_finished()
    // because it would further be propagated to memcpy(),
    // where the standard requirements as described in ISO/IEC 9899:2011
    // sections 7.21.2.1, 7.21.1.2, and 7.1.4, would be violated.
    // Thus, we use a dummy byte.
    let mut dummy: [u8; 1] = [0; 1];
    let size = ssl.get_peer_finished(&mut dummy);
    if size == 0 {
        return Ok(JSValue::UNDEFINED);
    }

    let buffer_size = size;
    let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
    let mut array_buffer = buffer.as_array_buffer(global).unwrap();
    let result_size = ssl.get_peer_finished(array_buffer.byte_slice_mut());
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
    let Some(sc) = arg.as_class_ref::<SecureContext>() else {
        return Err(global.throw(format_args!("setKeyCert requires a SecureContext")));
    };
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    // SSL_set_SSL_CTX takes its own reference. Node supports calling
    // setKeyCert from ALPNCallback, past the point SSL_set_SSL_CTX alone
    // retargets the certificate, so the identity is applied directly too.
    if !ssl.set_key_cert_from(sc.ctx.ctx()) {
        return Err(global.throw(format_args!("setKeyCert failed to apply the context")));
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

    let label = label_arg.to_utf8(global)?;
    let label_slice = label.slice();

    // Converting `context` can run user JS (toString / Symbol.toPrimitive)
    // that closes the socket, so do it before fetching the SSL*.
    let context = if frame.arguments_count() > 2 {
        match StringOrBuffer::from_js(global, context_arg)? {
            Some(sb) => Some(sb),
            None => {
                return Err(global.throw(format_args!(
                    "Expected context to be a string, Buffer or TypedArray"
                )));
            }
        }
    } else {
        None
    };

    let buffer_size = usize::try_from(length).expect("int cast");
    let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
    let mut array_buffer = buffer.as_array_buffer(global).unwrap();

    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };

    if !ssl.export_keying_material(
        array_buffer.byte_slice_mut(),
        label_slice,
        context.as_ref().map(|sb| sb.slice()),
    ) {
        return Err(global.throw_value(get_ssl_exception(
            global,
            b"Failed to export keying material",
        )));
    }
    Ok(buffer)
}

pub(super) fn get_ephemeral_key_info(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::NULL);
    };
    if ssl.is_server() {
        return Ok(JSValue::NULL);
    }
    let result = JSValue::create_empty_object(global, 0);

    // TODO: investigate better option or compatible way to get the key
    // this implementation follows nodejs but for BoringSSL SSL_get_server_tmp_key will always return 0
    // wich will result in a empty object
    let Some(pkey) = ssl.private_key() else {
        return Ok(result);
    };

    let kid = pkey.id();
    let bits = pkey.bits();

    match kid {
        boringssl::EVP_PKEY_DH => {
            result.put(global, b"type", BunString::static_("DH").to_js(global)?);
            result.put(global, b"size", JSValue::js_number(f64::from(bits)));
        }
        boringssl::EVP_PKEY_EC | boringssl::EVP_PKEY_X25519 | boringssl::EVP_PKEY_X448 => {
            let nid = if kid == boringssl::EVP_PKEY_EC {
                // `kid == EVP_PKEY_EC`, so BoringSSL guarantees an EC_KEY with
                // a group set.
                pkey.ec_curve_nid().expect("EC key has a group")
            } else {
                kid
            };
            let curve_name: &[u8] = match boringssl::nid2sn(nid) {
                Some(sn) => sn.to_bytes(),
                None => b"",
            };
            result.put(global, b"type", BunString::static_("ECDH").to_js(global)?);
            result.put(
                global,
                b"name",
                bun_string_jsc::create_utf8_for_js(global, curve_name)?,
            );
            result.put(global, b"size", JSValue::js_number(f64::from(bits)));
        }
        _ => {}
    }
    Ok(result)
}

pub(super) fn get_alpn_protocol(this: &This, global: &JSGlobalObject) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::FALSE);
    };

    let Some(slice) = ssl.alpn_selected() else {
        return Ok(JSValue::FALSE);
    };

    if strings::eql(slice, b"h2") {
        return BunString::static_("h2").to_js(global);
    }
    if strings::eql(slice, b"http/1.1") {
        return BunString::static_("http/1.1").to_js(global);
    }
    bun_string_jsc::create_utf8_for_js(global, slice)
}

/// The session Node's `getSession()`/`getTLSTicket()` read: the one most
/// recently delivered to the new-session callback (the only place BoringSSL
/// surfaces a TLS 1.3 NewSessionTicket), falling back to the SSL's own.
fn current_session(ssl: &boringssl::SSL) -> Option<&boringssl::SSL_SESSION> {
    bun_uws_sys::ssl::ssl_new_session(ssl).or_else(|| ssl.session())
}

pub(super) fn get_session(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    let Some(session) = current_session(ssl) else {
        return Ok(JSValue::UNDEFINED);
    };
    let Some(size) = session.der_len() else {
        return Ok(JSValue::UNDEFINED);
    };

    let buffer = JSValue::create_buffer_from_length(global, size)?;
    let mut array_buffer = buffer.as_array_buffer(global).unwrap();
    let result_size = session.to_der_into(array_buffer.byte_slice_mut());
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
        let Some(ssl) = ssl_of(this) else {
            return Ok(JSValue::UNDEFINED);
        };
        let Some(session) = boringssl::OwnedSslSession::from_der(session_slice) else {
            return Ok(JSValue::UNDEFINED);
        };
        // SSL_set_session takes its own reference ("the caller retains ownership of |session|"),
        // so ours is released when `session` drops on every path.
        if !ssl.set_session(&session) {
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
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    let Some(session) = current_session(ssl) else {
        return Ok(JSValue::UNDEFINED);
    };
    // The pointer is only valid while the connection is in use so we need to copy it
    let ticket = session.ticket();
    if ticket.is_empty() {
        return Ok(JSValue::UNDEFINED);
    }
    jsc::ArrayBuffer::create_buffer(global, ticket)
}

pub(super) fn renegotiate(
    this: &This,
    global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    boringssl::ERR_clear_error();
    if !ssl.renegotiate() {
        return Err(global.throw_value(get_ssl_exception(global, b"SSL_renegotiate error")));
    }
    Ok(JSValue::UNDEFINED)
}

pub(super) fn disable_renegotiation(
    this: &This,
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    ssl.set_renegotiate_mode(boringssl::ssl_renegotiate_never);
    Ok(JSValue::UNDEFINED)
}

pub(super) fn is_session_reused(
    this: &This,
    _global: &JSGlobalObject,
    _frame: &CallFrame,
) -> JsResult<JSValue> {
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::FALSE);
    };
    Ok(JSValue::from(ssl.session_reused()))
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
    let Some(ssl) = ssl_of(this) else {
        return Ok(JSValue::UNDEFINED);
    };
    // we always allow and check the SSL certificate after the handshake or renegotiation
    ssl.set_verify(verify_mode, Some(always_allow_ssl_verify_callback));
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
    let mut message = EncodedSlice::EMPTY;
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

        if let Some(reason) = boringssl::err_reason_error_string(ssl_error) {
            let reason = reason.to_bytes();
            if reason.is_empty() {
                break;
            }
            output_buf[written..written + reason.len()].copy_from_slice(reason);
            written += reason.len();
        }

        if let Some(reason) = boringssl::err_func_error_string(ssl_error) {
            let reason = reason.to_bytes();
            if !reason.is_empty() {
                const VIA: &[u8] = b" via ";
                output_buf[written..written + VIA.len()].copy_from_slice(VIA);
                written += VIA.len();
                output_buf[written..written + reason.len()].copy_from_slice(reason);
                written += reason.len();
            }
        }

        if let Some(reason) = boringssl::err_lib_error_string(ssl_error) {
            let reason = reason.to_bytes();
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
        let text = &output_buf[0..written];
        formatted.reserve(b"OpenSSL ".len() + text.len());
        {
            use std::io::Write;
            let _ = write!(&mut formatted, "OpenSSL {}", ::bstr::BStr::new(text));
        }
        message = EncodedSlice::utf8(&formatted);

        // We shouldn't *need* to do this but it's not entirely clear.
        boringssl::ERR_clear_error();
    }

    if message.is_empty() {
        message = EncodedSlice::latin1(default_message);
    }

    let exception = message.to_error_instance(global);

    // reference it in stack memory
    exception.ensure_still_alive();

    exception
}
