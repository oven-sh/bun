use core::ffi::{c_char, c_int, c_void};

use crate::api::bun_secure_context::SecureContext;
use bun_boringssl_sys as boringssl;
use bun_core::{EncodedSlice, String as BunString, strings};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    self as jsc, EncodedSliceJsc as _, JSGlobalObject, JSValue, JsResult, StringJsc as _,
};

use crate::api::bun_x509 as X509;

// ──────────────────────────────────────────────────────────────────────────
// Local BoringSSL FFI surface not yet in bun_boringssl_sys.
// Declared here per port rules (call the linked C symbol directly); migrate
// into `bun_boringssl_sys` once the bindgen pass covers them.
// ──────────────────────────────────────────────────────────────────────────
#[allow(non_upper_case_globals)]
pub(super) mod ffi {
    use super::boringssl::{
        OwnedX509Store, SSL, SSL_CIPHER, SSL_CTX, SSL_SESSION, X509, struct_stack_st_X509,
    };
    use core::ffi::{c_char, c_int, c_void};

    // ssl.h
    pub(crate) const TLS1_2_VERSION: u16 = 0x0303;
    pub(crate) use super::boringssl::TLS1_3_VERSION;

    // evp.h key types (NID values)
    pub(crate) const EVP_PKEY_RSA: c_int = 6;
    pub(crate) const EVP_PKEY_RSA_PSS: c_int = 912;
    pub(crate) const EVP_PKEY_DSA: c_int = 116;
    pub(crate) const EVP_PKEY_EC: c_int = 408;

    // obj_mac.h
    pub(crate) const NID_ED25519: c_int = 949;
    pub(crate) const NID_ED448: c_int = 960;
    pub(crate) const NID_id_GostR3410_2001: c_int = 811;
    pub(crate) const NID_id_GostR3410_2012_256: c_int = 979;
    pub(crate) const NID_id_GostR3410_2012_512: c_int = 980;
    pub(crate) const NID_X9_62_prime256v1: c_int = 415;
    pub(crate) const NID_secp384r1: c_int = 715;
    pub(crate) const NID_secp521r1: c_int = 716;
    pub(crate) const NID_X25519: c_int = 948;
    pub(crate) const NID_kx_ecdhe: c_int = 952;

    unsafe extern "C" {
        // ── SSL session/handshake info ───────────────────────────────────
        pub(crate) safe fn SSL_get_version(ssl: &SSL) -> bun_core::CStrRef<'static>;
        pub(crate) safe fn SSL_version(ssl: &SSL) -> c_int;
        pub(crate) safe fn SSL_get_negotiated_group(ssl: &SSL) -> c_int;
        pub(crate) safe fn SSL_set_max_send_fragment(ssl: &SSL, max_send_fragment: usize) -> c_int;
        // SAFETY (unsafe fn): `buf` must be writable for `count` bytes.
        pub(crate) fn SSL_get_finished(ssl: *const SSL, buf: *mut c_void, count: usize) -> usize;
        // SAFETY (unsafe fn): `buf` must be writable for `count` bytes.
        pub(crate) fn SSL_get_peer_finished(
            ssl: *const SSL,
            buf: *mut c_void,
            count: usize,
        ) -> usize;
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
        // Copies at most `min(max_out, 32)` bytes, so a 32-byte `out` leaves no precondition.
        pub(crate) safe fn SSL_get_client_random(
            ssl: &SSL,
            out: &mut [u8; 32],
            max_out: usize,
        ) -> usize;

        // ── SSL_SESSION ───────────────────────────────────────────────────
        pub(crate) safe fn SSL_get_session(ssl: &SSL) -> *mut SSL_SESSION;
        pub(crate) safe fn SSL_SESSION_get0_ticket(
            session: &SSL_SESSION,
            out_ticket: &mut *const u8,
            out_len: &mut usize,
        );

        // ── SSL_CIPHER ────────────────────────────────────────────────────
        pub(crate) safe fn SSL_CIPHER_get_min_version(cipher: &SSL_CIPHER) -> u16;
        pub(crate) safe fn SSL_CIPHER_get_kx_nid(cipher: &SSL_CIPHER) -> c_int;

        pub(crate) safe fn OBJ_nid2sn(nid: c_int) -> Option<bun_core::CStrRef<'static>>;

        /// Save/restore the per-loop BIO routing state around in-handshake JS
        /// callbacks (defined in usockets' openssl.cpp). The caller's snapshot
        /// array must have exactly `us_internal_ssl_loop_state_slots()`
        /// elements (US_SSL_LOOP_STATE_SLOTS in internal.h).
        pub(crate) safe fn us_internal_ssl_loop_state_slots() -> c_int;
        pub(crate) safe fn us_internal_ssl_loop_state_save(ssl: &SSL, out: *mut *mut c_void);
        pub(crate) safe fn us_internal_ssl_loop_state_restore(saved: *mut *mut c_void);
        pub(crate) safe fn SSL_is_server(ssl: &SSL) -> c_int;
        // Swaps the cert/key/chain (and session-related state) this connection
        // serves to those of `ctx`; takes its own reference to `ctx`.
        pub(crate) fn SSL_set_SSL_CTX(ssl: *mut SSL, ctx: *mut SSL_CTX) -> *mut SSL_CTX;
        // Apply `ctx`'s leaf certificate / private key / extra chain directly
        // to the connection - SSL_set_SSL_CTX alone does not retarget the
        // certificate once ClientHello processing has reached ALPN selection.
        pub(crate) fn SSL_CTX_get0_privatekey(ctx: *const SSL_CTX) -> *mut core::ffi::c_void;
        pub(crate) fn SSL_use_certificate(ssl: *mut SSL, x509: *mut X509) -> core::ffi::c_int;
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
        // The process-wide default root store.
        pub(crate) safe fn us_get_shared_default_ca_store() -> Option<OwnedX509Store>;
        pub(crate) safe fn us_ssl_ctx_has_user_ca(ctx: &SSL_CTX) -> c_int;
        pub(crate) safe fn us_ssl_get0_other_path(ssl: &mut SSL) -> Option<&struct_stack_st_X509>;
        // Returns X509_V_OK (0) when `issuer` could have issued `subject`.
        pub(crate) safe fn X509_check_issued(issuer: &X509, subject: &X509) -> c_int;
    }
}
use super::TLSSocket;
use crate::node::StringOrBuffer;

impl TLSSocket {
    pub(crate) fn get_servername(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::UNDEFINED);
        };

        match ssl.servername() {
            Some(servername) => bun_string_jsc::create_utf8_for_js(cx.global(), servername),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn set_servername(&self, cx: &mut JsScope<'_>, name: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        let name = name.to_js();
        if self.is_server() {
            return Err(global.throw(format_args!(
                "Cannot issue SNI from a TLS server-side socket"
            )));
        }

        if !name.is_string() {
            return Err(global.throw(format_args!("Expected \"serverName\" to be a string")));
        }

        let slice: Box<[u8]> = name
            .to_bun_string(global)?
            .to_owned_slice()
            .into_boxed_slice();
        // Drop replaces the old value.
        self.server_name.set(Some(slice));

        let host = self.server_name.get().as_deref().unwrap();
        if !host.is_empty() {
            // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
            let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
                return Ok(());
            };

            if boringssl::SSL_is_init_finished(ssl) != 0 {
                // match node.js exceptions
                return Err(global.throw(format_args!("Already started.")));
            }
            ssl.set_servername(&bun_core::ZBox::from_bytes(host));
        }

        Ok(())
    }

    pub(crate) fn get_peer_x509_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::UNDEFINED);
        };
        match ssl.peer_certificate() {
            Some(cert) => X509::to_js_object(cert, cx.global()),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn get_x509_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::UNDEFINED);
        };
        match boringssl::SSL_get_certificate(ssl) {
            Some(cert) => X509::to_js_object(boringssl::OwnedX509::retain(cert), cx.global()),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn get_tls_version(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        jsc::mark_binding();

        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::NULL);
        };
        let slice = ffi::SSL_get_version(ssl).to_cstr().to_bytes();
        if slice.is_empty() {
            return Ok(JSValue::NULL);
        }
        bun_string_jsc::create_utf8_for_js(cx.global(), slice)
    }

    pub(crate) fn set_max_send_fragment(
        &self,
        cx: &mut JsScope<'_>,
        size: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();
        let global = cx.global();
        let size = size.to_js();

        if !size.is_number() {
            return Err(global.throw(format_args!("Expected size to be a number")));
        }
        let size = size.coerce_to_int64(global)?;
        if !(512..=16384).contains(&size) {
            return Ok(JSValue::FALSE);
        }

        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::FALSE);
        };
        Ok(JSValue::from(
            ffi::SSL_set_max_send_fragment(ssl, usize::try_from(size).expect("int cast")) == 1,
        ))
    }

    pub(crate) fn get_peer_certificate(
        &self,
        cx: &mut JsScope<'_>,
        abbreviated: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        jsc::mark_binding();
        let global = cx.global();
        let abbreviated = abbreviated.to_js();

        let abbreviated = if abbreviated.is_undefined() {
            true
        } else {
            if !abbreviated.is_boolean() {
                return Err(global.throw(format_args!("Expected abbreviated to be a boolean")));
            }
            abbreviated.to_boolean()
        };

        let Some(ssl_ptr) = self.socket.get().ssl() else {
            return Ok(JSValue::UNDEFINED);
        };
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let ssl = unsafe { &mut *ssl_ptr };
        let is_server_ssl = ffi::SSL_is_server(ssl) != 0;

        if abbreviated {
            if is_server_ssl && let Some(cert) = ssl.peer_certificate() {
                return X509::to_js(&cert, global);
            }

            return match ssl.peer_leaf_certificate() {
                Some(cert) => X509::to_js(cert, global),
                None => Ok(JSValue::UNDEFINED),
            };
        }

        // Applications pin this chain, and names lead along a path that was refused.
        if let Some(path) = ffi::us_ssl_get0_other_path(ssl)
            && let Some(mut last) = boringssl::sk_X509_value(path, 0)
        {
            let first_obj = X509::to_js(last, global)?;
            let mut prev_obj = first_obj;
            for issuer in (1..).map_while(|i| boringssl::sk_X509_value(path, i)) {
                let obj = X509::to_js(issuer, global)?;
                prev_obj.put(global, b"issuerCertificate", obj);
                prev_obj = obj;
                last = issuer;
            }
            if ffi::X509_check_issued(last, last) == 0 {
                prev_obj.put(global, b"issuerCertificate", prev_obj);
            }
            return Ok(first_obj);
        }

        let cert = if is_server_ssl {
            ssl.peer_certificate()
        } else {
            None
        };

        let cert_chain = boringssl::SSL_get_peer_cert_chain(ssl);
        let Some(first_cert) = cert
            .as_deref()
            .or_else(|| boringssl::sk_X509_value(cert_chain?, 0))
        else {
            return Ok(JSValue::UNDEFINED);
        };

        // The detailed form links each certificate to its issuer through
        // `issuerCertificate`, the way Node's getPeerCertificate(true) does.
        // SSL_get_peer_cert_chain includes the leaf on the client side but not on
        // the server side, where the peer certificate above is the leaf instead.
        let first_obj = X509::to_js(first_cert, global)?;
        // Link each certificate to its predecessor immediately so every object in
        // the chain is reachable from the stack-rooted `first_obj` before the next
        // `X509::to_js` allocation can trigger a GC - a heap-backed Vec<JSValue>
        // is not stack-scanned.
        let mut prev_obj: JSValue = first_obj;
        let mut last_sent = first_cert;
        if let Some(chain) = cert_chain {
            // The certificates the peer sent are candidates: each link is the one that
            // X509_check_issued accepts, like Node's AddIssuerChainToObject
            // (src/crypto/crypto_common.cc).
            let mut candidates: Vec<&boringssl::X509> = (usize::from(cert.is_none())..)
                .map_while(|i| boringssl::sk_X509_value(chain, i))
                .collect();
            while let Some(i) = candidates
                .iter()
                .position(|candidate| ffi::X509_check_issued(candidate, last_sent) == 0)
            {
                let issuer = candidates.remove(i);
                let obj = X509::to_js(issuer, global)?;
                prev_obj.put(global, b"issuerCertificate", obj);
                prev_obj = obj;
                last_sent = issuer;
            }
        }

        // Extend the chain through the local trust store until a self-issued
        // certificate is reached, the way Node's getPeerCertificate(true) walks
        // X509_STORE_CTX_get1_issuer to surface the root that completed
        // verification even though the peer never sent it.
        // SAFETY: `ssl` holds a reference to its context. Asking for it frees nothing that `ssl` has lent.
        let ssl_ctx = unsafe { &*boringssl::SSL_get_SSL_CTX(ssl_ptr) };
        let ctx_store = boringssl::SSL_CTX_get_cert_store(ssl_ctx);
        // Without `ca`, Node looks in the bundled roots.
        let shared_store = if ctx_store.is_none() || ffi::us_ssl_ctx_has_user_ca(ssl_ctx) == 0 {
            ffi::us_get_shared_default_ca_store()
        } else {
            None
        };
        let store = shared_store.as_deref().or(ctx_store);
        let Some(lookup) = store.and_then(boringssl::IssuerLookup::new) else {
            return Ok(first_obj);
        };
        let mut last_found: Option<boringssl::OwnedX509> = None;
        // Cap the walk so a cyclic store cannot loop forever.
        for _ in 0..16 {
            let subject = last_found.as_deref().unwrap_or(last_sent);
            if ffi::X509_check_issued(subject, subject) == 0 {
                break;
            }
            let Some(issuer) = lookup.issuer_of(subject) else {
                break;
            };
            let obj = X509::to_js(&issuer, global)?;
            prev_obj.put(global, b"issuerCertificate", obj);
            prev_obj = obj;
            last_found = Some(issuer);
        }

        // A self-issued terminal certificate references itself, like Node.
        let last = last_found.as_deref().unwrap_or(last_sent);
        if ffi::X509_check_issued(last, last) == 0 {
            prev_obj.put(global, b"issuerCertificate", prev_obj);
        }
        Ok(first_obj)
    }

    pub(crate) fn get_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::UNDEFINED);
        };
        match boringssl::SSL_get_certificate(ssl) {
            Some(cert) => X509::to_js(cert, cx.global()),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn get_tls_finished_message(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let Some(ssl_ptr) = self.socket.get().ssl() else {
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

    pub(crate) fn get_shared_sigalgs(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        jsc::mark_binding();
        let global = cx.global();

        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::NULL);
        };

        let nsig = ffi::SSL_get_shared_sigalgs(ssl, 0, None, None, None, None, None);

        let array = JSValue::create_empty_array(global, usize::try_from(nsig).expect("int cast"))?;

        for i in 0..usize::try_from(nsig).expect("int cast") {
            let mut hash_nid: c_int = 0;
            let mut sign_nid: c_int = 0;
            let sig_with_md: &[u8];

            ffi::SSL_get_shared_sigalgs(
                ssl,
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
                    if let Some(sn_str) = ffi::OBJ_nid2sn(sign_nid) {
                        sig_with_md = sn_str.to_cstr().to_bytes();
                    } else {
                        sig_with_md = b"UNDEF";
                    }
                }
            }

            if let Some(hash_str) = ffi::OBJ_nid2sn(hash_nid) {
                let hash_slice = hash_str.to_cstr().to_bytes();
                let mut buffer: Vec<u8> =
                    Vec::with_capacity(sig_with_md.len() + hash_slice.len() + 1);
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

    pub(crate) fn get_cipher(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::UNDEFINED);
        };
        let cipher = boringssl::SSL_get_current_cipher(ssl);
        let result = JSValue::create_empty_object(global, 0);

        let Some(cipher) = cipher else {
            result.put(global, b"name", JSValue::NULL);
            result.put(global, b"standardName", JSValue::NULL);
            result.put(global, b"version", JSValue::NULL);
            return Ok(result);
        };

        let to_js = |name: bun_core::CStrRef<'_>| {
            bun_string_jsc::create_utf8_for_js(global, name.to_cstr().to_bytes())
        };
        let name = to_js(boringssl::SSL_CIPHER_get_name(cipher))?;
        result.put(global, b"name", name);
        let standard_name = to_js(boringssl::SSL_CIPHER_standard_name(cipher))?;
        result.put(global, b"standardName", standard_name);

        // BoringSSL's SSL_CIPHER_get_version is a constant; these are OpenSSL's per-cipher minimum versions.
        let version = match ffi::SSL_CIPHER_get_min_version(cipher) {
            ffi::TLS1_3_VERSION => "TLSv1.3",
            ffi::TLS1_2_VERSION => "TLSv1.2",
            _ if ffi::SSL_CIPHER_get_kx_nid(cipher) == ffi::NID_kx_ecdhe => "TLSv1.0",
            _ => "SSLv3",
        };
        result.put(
            global,
            b"version",
            BunString::static_(version).to_js(global)?,
        );

        Ok(result)
    }

    pub(crate) fn get_tls_peer_finished_message(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        let Some(ssl_ptr) = self.socket.get().ssl() else {
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
    pub(crate) fn set_key_cert(&self, cx: &mut JsScope<'_>, context: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        if self.socket.get().is_detached() {
            return Ok(());
        }
        let Some(sc) = context.as_class_ref::<SecureContext>() else {
            return Err(global.throw(format_args!("setKeyCert requires a SecureContext")));
        };
        let Some(ssl_ptr) = self.socket.get().ssl() else {
            return Ok(());
        };
        // SAFETY: an attached socket is open; `sc` is a live SecureContext; SSL_set_SSL_CTX takes its own reference.
        unsafe {
            let ctx = &sc.ctx;
            ffi::SSL_set_SSL_CTX(ssl_ptr.cast(), ctx.as_ptr().cast());
            // A client keeps no session id context (see `us_internal_ssl_attach`).
            if ffi::SSL_is_server(&*ssl_ptr) == 0 {
                boringssl::SSL_set_session_id_context(ssl_ptr, core::ptr::null(), 0);
            }
            // SSL_set_SSL_CTX stops retargeting the certificate once ClientHello
            // processing has reached ALPN selection, and Node supports calling
            // setKeyCert from ALPNCallback - apply the identity directly.
            let leaf = boringssl::SSL_CTX_get0_certificate(ctx.as_ptr());
            let pkey = ffi::SSL_CTX_get0_privatekey(ctx.as_ptr().cast());
            if !leaf.is_null() && !pkey.is_null() {
                let ok_cert = ffi::SSL_use_certificate(ssl_ptr.cast(), leaf);
                let ok_key = ffi::SSL_use_PrivateKey(ssl_ptr.cast(), pkey);
                let mut ok_chain = 1;
                let mut chain: *mut core::ffi::c_void = core::ptr::null_mut();
                if ffi::SSL_CTX_get0_chain_certs(ctx.as_ptr().cast(), &raw mut chain) == 1
                    && !chain.is_null()
                {
                    ok_chain = ffi::SSL_set1_chain(ssl_ptr.cast(), chain);
                }
                if ok_cert != 1 || ok_key != 1 || ok_chain != 1 {
                    return Err(
                        global.throw(format_args!("setKeyCert failed to apply the context"))
                    );
                }
            }
        }
        Ok(())
    }

    pub(crate) fn export_keying_material(
        &self,
        cx: &mut JsScope<'_>,
        length: JsLocal<'_>,
        label: JsLocal<'_>,
        context: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let (length, label, context) = (length.to_js(), label.to_js(), context.to_js());
        if self.socket.get().is_detached() {
            return Ok(JSValue::UNDEFINED);
        }

        if !length.is_number() {
            return Err(global.throw(format_args!("Expected length to be a number")));
        }

        let length = length.coerce_to_int64(global)?;
        if length < 0 {
            return Err(global.throw(format_args!("Expected length to be a positive number")));
        }

        if !label.is_string() {
            return Err(global.throw(format_args!("Expected label to be a string")));
        }

        let label = label.to_utf8(global)?;
        let label_slice = label.slice();

        // Converting `context` can run user JS (toString / Symbol.toPrimitive)
        // that closes the socket, so do it before fetching the SSL*.
        let context = if !context.is_undefined() {
            match StringOrBuffer::from_js(global, context)? {
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
        let (context_ptr, context_len, use_context) = match &context {
            Some(sb) => (sb.slice().as_ptr(), sb.slice().len(), 1),
            None => (core::ptr::null(), 0, 0),
        };

        let buffer_size = usize::try_from(length).expect("int cast");
        let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
        let buffer_ptr = buffer.as_array_buffer(global).unwrap().ptr;

        let Some(ssl_ptr) = self.socket.get().ssl() else {
            return Ok(JSValue::UNDEFINED);
        };

        boringssl::ERR_clear_error();
        // SAFETY: ssl_ptr is a live *mut SSL; buffer_ptr/label_slice/context are valid for the lengths passed (context is null with use_context=0).
        let result = unsafe {
            ffi::SSL_export_keying_material(
                ssl_ptr,
                buffer_ptr,
                buffer_size,
                label_slice.as_ptr().cast::<c_char>(),
                label_slice.len(),
                context_ptr,
                context_len,
                use_context,
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

    pub(crate) fn get_ephemeral_key_info(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::NULL);
        };
        if ffi::SSL_is_server(ssl) != 0 {
            return Ok(JSValue::NULL);
        }
        let result = JSValue::create_empty_object(global, 0);

        // A resumed TLS <= 1.2 handshake has no key exchange, but its session still names the original group.
        if ffi::SSL_session_reused(ssl) != 0
            && ffi::SSL_version(ssl) < c_int::from(ffi::TLS1_3_VERSION)
        {
            return Ok(result);
        }
        let (name, size) = match ffi::SSL_get_negotiated_group(ssl) {
            ffi::NID_X25519 => ("X25519", 253),
            ffi::NID_X9_62_prime256v1 => ("prime256v1", 256),
            ffi::NID_secp384r1 => ("secp384r1", 384),
            ffi::NID_secp521r1 => ("secp521r1", 521),
            _ => return Ok(result),
        };
        result.put(global, b"type", BunString::static_("ECDH").to_js(global)?);
        result.put(global, b"name", BunString::static_(name).to_js(global)?);
        result.put(global, b"size", JSValue::js_number(f64::from(size)));
        Ok(result)
    }

    pub(crate) fn get_alpn_protocol(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let global = cx.global();
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(JSValue::FALSE);
        };

        let slice = ssl.alpn_selected();
        if slice.is_empty() {
            return Ok(JSValue::FALSE);
        }
        if strings::eql(slice, b"h2") {
            return Ok(global.common_strings().alpn_h2());
        }
        if strings::eql(slice, b"http/1.1") {
            return Ok(global.common_strings().alpn_http11());
        }
        bun_string_jsc::create_utf8_for_js(global, slice)
    }

    /// The session Node's `getSession()`/`getTLSTicket()` read: the one most
    /// recently delivered to the new-session callback (the only place BoringSSL
    /// surfaces a TLS 1.3 NewSessionTicket), falling back to the SSL's own.
    fn current_session(&self, ssl: &boringssl::SSL) -> *mut boringssl::SSL_SESSION {
        if let Some(latest) = self.latest_session.get() {
            return latest.as_ptr();
        }
        let latest = self.socket.get().wrapper_latest_session();
        if !latest.is_null() {
            return latest;
        }
        ffi::SSL_get_session(ssl)
    }

    pub(crate) fn get_session(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // SAFETY: an attached socket is open, and nothing replaces the session before it is encoded.
        let session = unsafe {
            let ssl = self.socket.get().ssl_mut();
            ssl.and_then(|ssl| self.current_session(ssl).as_ref())
        };
        match session.and_then(boringssl::SSL_SESSION::to_der) {
            Some(der) => jsc::ArrayBuffer::create_buffer(cx.global(), &der),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn set_session(&self, cx: &mut JsScope<'_>, session: JsLocal<'_>) -> JsResult<()> {
        let global = cx.global();
        if self.socket.get().is_detached() {
            return Ok(());
        }

        if let Some(sb) = StringOrBuffer::from_js(global, session.to_js())? {
            let session_slice = sb.slice();
            // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
            let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
                return Ok(());
            };
            // SSL_set_session abort()s once the ClientHello is built, which is when the client random is filled.
            let mut client_random = [0u8; 32];
            ffi::SSL_get_client_random(ssl, &mut client_random, 32);
            if ffi::SSL_is_server(ssl) != 0 || client_random != [0u8; 32] {
                return Ok(());
            }
            if let Some(session) = boringssl::OwnedSslSession::from_der(session_slice) {
                boringssl::SSL_set_session(ssl, &session);
            }
            Ok(())
        } else {
            Err(global.throw(format_args!(
                "Expected session to be a string, Buffer or TypedArray"
            )))
        }
    }

    pub(crate) fn get_tls_ticket(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        // SAFETY: an attached socket is open, and nothing replaces the session before the copy below.
        let session = unsafe {
            let ssl = self.socket.get().ssl_mut();
            ssl.and_then(|ssl| self.current_session(ssl).as_ref())
        };
        let Some(session) = session else {
            return Ok(JSValue::UNDEFINED);
        };
        let mut ticket: *const u8 = core::ptr::null();
        let mut length: usize = 0;
        // The pointer is only valid while the connection is in use so we need to copy it
        ffi::SSL_SESSION_get0_ticket(session, &mut ticket, &mut length);

        if ticket.is_null() || length == 0 {
            return Ok(JSValue::UNDEFINED);
        }

        // SAFETY: SSL_SESSION_get0_ticket guarantees `ticket` points to `length` bytes owned by the session.
        let slice = unsafe { bun_core::ffi::slice(ticket, length) };
        jsc::ArrayBuffer::create_buffer(cx.global(), slice)
    }

    pub(crate) fn renegotiate(&self, cx: &mut JsScope<'_>) -> JsResult<()> {
        let global = cx.global();
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(());
        };
        boringssl::ERR_clear_error();
        if boringssl::SSL_renegotiate(ssl) != 1 {
            return Err(global.throw_value(get_ssl_exception(global, b"SSL_renegotiate error")));
        }
        Ok(())
    }

    pub(crate) fn disable_renegotiation(&self) {
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return;
        };
        boringssl::SSL_set_renegotiate_mode(ssl, boringssl::ssl_renegotiate_never);
    }

    pub(crate) fn is_session_reused(&self) -> bool {
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return false;
        };
        ffi::SSL_session_reused(ssl) == 1
    }

    pub(crate) fn set_verify_mode(
        &self,
        cx: &mut JsScope<'_>,
        request_cert: JsLocal<'_>,
        reject_unauthorized: JsLocal<'_>,
    ) -> JsResult<()> {
        let request_cert = request_cert.to_js();
        let reject_unauthorized = reject_unauthorized.to_js();
        if self.socket.get().is_detached() {
            return Ok(());
        }

        if !request_cert.is_boolean() || !reject_unauthorized.is_boolean() {
            return Err(cx.global().throw(format_args!(
                "Expected requestCert and rejectUnauthorized arguments to be boolean"
            )));
        }

        let request_cert = request_cert.to_boolean();
        let reject_unauthorized = reject_unauthorized.to_boolean();
        let acts_as_server = self.acts_as_tls_server();
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
        self.update_flags(|f| {
            f.set(
                super::Flags::REJECT_UNAUTHORIZED,
                reject_unauthorized && (!acts_as_server || request_cert),
            );
        });
        // SAFETY: an attached socket is open, and `ssl` is last used before JS runs or the socket closes.
        let Some(ssl) = (unsafe { self.socket.get().ssl_mut() }) else {
            return Ok(());
        };
        if !acts_as_server && reject_unauthorized && boringssl::SSL_is_init_finished(ssl) == 0 {
            // The same in-handshake chain check as for a client that rejects from the start.
            self.socket.get().set_inline_reject();
        } else {
            // we always allow and check the SSL certificate after the handshake or renegotiation
            boringssl::SSL_set_verify(ssl, verify_mode, Some(always_allow_ssl_verify_callback));
        }
        Ok(())
    }
}

extern "C" fn always_allow_ssl_verify_callback(
    _preverify_ok: c_int,
    _ctx: &boringssl::X509_STORE_CTX,
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

        // SAFETY: nothing calls `strerror` before `reason` is copied.
        let reason = unsafe { boringssl::ERR_reason_error_string(ssl_error) };
        let reason = reason.to_cstr().to_bytes();
        if reason.is_empty() {
            break;
        }
        output_buf[written..written + reason.len()].copy_from_slice(reason);
        written += reason.len();

        let reason = boringssl::ERR_func_error_string(ssl_error)
            .to_cstr()
            .to_bytes();
        if !reason.is_empty() {
            const VIA: &[u8] = b" via ";
            output_buf[written..written + VIA.len()].copy_from_slice(VIA);
            written += VIA.len();
            output_buf[written..written + reason.len()].copy_from_slice(reason);
            written += reason.len();
        }

        let reason = boringssl::ERR_lib_error_string(ssl_error)
            .to_cstr()
            .to_bytes();
        if !reason.is_empty() {
            output_buf[written] = b' ';
            written += 1;
            output_buf[written..written + reason.len()].copy_from_slice(reason);
            written += reason.len();
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
