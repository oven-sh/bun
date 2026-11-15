use core::ffi::{CStr, c_int};

use crate::api::bun_secure_context::SecureContext;
use bun_boringssl_sys as boringssl;
use bun_core::{EncodedSlice, String as BunString, strings};
use bun_jsc::bindgen::{JsHeap, JsLocal, JsScope};
use bun_jsc::bun_string_jsc;
use bun_jsc::{
    self as jsc, EncodedSliceJsc as _, JSGlobalObject, JSValue, JsResult, StringJsc as _,
};
use bun_uws_sys::socket_context::c::{us_get_shared_default_ca_store, us_ssl_ctx_has_user_ca};

use crate::api::bun_x509 as X509;

use super::TLSSocket;
use crate::node::StringOrBuffer;

impl TLSSocket {
    /// Borrows `heap`, because JavaScript can close the socket, which frees the `SSL`.
    fn ssl<'a>(&'a self, _heap: &'a JsHeap<'_>) -> Option<&'a boringssl::SSL> {
        // SAFETY: `socket` is live or detached, no JavaScript runs during `'a`, and nothing in this file closes `socket`.
        unsafe { self.socket.get().ssl() }
    }

    pub(crate) fn get_servername(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };

        match ssl.servername() {
            Some(servername) => bun_string_jsc::create_utf8_for_js(cx.global(), &servername),
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
            let Some(ssl) = self.ssl(&cx.heap) else {
                return Ok(());
            };

            if ssl.is_init_finished() {
                // match node.js exceptions
                return Err(cx.global().throw(format_args!("Already started.")));
            }
            ssl.set_servername(host);
        }

        Ok(())
    }

    pub(crate) fn get_peer_x509_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };
        match ssl.peer_certificate() {
            Some(cert) => X509::to_js_object(cert, cx.global()),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn get_x509_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };
        match ssl.certificate() {
            Some(cert) => X509::to_js_object(cert, cx.global()),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn get_tls_version(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        jsc::mark_binding();

        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::NULL);
        };
        let version = ssl.version_str();
        c_str_to_js(cx.global(), version)
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

        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::FALSE);
        };
        Ok(JSValue::from(ssl.set_max_send_fragment(
            usize::try_from(size).expect("int cast"),
        )))
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

        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };
        let Some(mut last) = ssl.peer_certificate() else {
            return Ok(JSValue::UNDEFINED);
        };
        if abbreviated {
            return X509::to_js(&last, cx.global());
        }
        let mut candidates = ssl.peer_cert_chain_without_leaf();
        let ssl_ctx = ssl.ssl_ctx();
        let global = cx.global();
        let first_obj = X509::to_js(&last, global)?;

        // The detailed form links each certificate to its issuer through
        // `issuerCertificate`, the way Node's getPeerCertificate(true) does.
        // Link each certificate to its predecessor immediately so every object in
        // the chain is reachable from the stack-rooted `first_obj` before the next
        // `X509::to_js` allocation can trigger a GC - a heap-backed Vec<JSValue>
        // is not stack-scanned.
        let mut prev_obj: JSValue = first_obj;
        // Each link is the candidate that X509_check_issued accepts, like Node's AddIssuerChainToObject.
        while let Some(i) = candidates
            .iter()
            .position(|candidate| candidate.issued(&last))
        {
            last = candidates.remove(i);
            let obj = X509::to_js(&last, global)?;
            prev_obj.put(global, b"issuerCertificate", obj);
            prev_obj = obj;
        }

        // Extend the chain through the local trust store until a self-issued
        // certificate is reached, the way Node's getPeerCertificate(true) walks
        // X509_STORE_CTX_get1_issuer to surface the root that completed
        // verification even though the peer never sent it.
        let store = if us_ssl_ctx_has_user_ca(&ssl_ctx) != 0 {
            ssl_ctx
                .cert_store()
                .or_else(|| us_get_shared_default_ca_store())
        } else {
            // Without `ca`, Node looks in the bundled roots.
            us_get_shared_default_ca_store().or_else(|| ssl_ctx.cert_store())
        };
        let Some(lookup) = store.as_deref().and_then(boringssl::IssuerLookup::new) else {
            return Ok(first_obj);
        };
        // Cap the walk so a cyclic store cannot loop forever.
        for _ in 0..16 {
            if last.issued(&last) {
                break;
            }
            let Some(issuer) = lookup.issuer_of(&last) else {
                break;
            };
            last = issuer;
            let obj = X509::to_js(&last, global)?;
            prev_obj.put(global, b"issuerCertificate", obj);
            prev_obj = obj;
        }

        // A self-issued terminal certificate references itself, like Node.
        if last.issued(&last) {
            prev_obj.put(global, b"issuerCertificate", prev_obj);
        }
        Ok(first_obj)
    }

    pub(crate) fn get_certificate(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };
        match ssl.certificate() {
            Some(cert) => X509::to_js(&cert, cx.global()),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn get_tls_finished_message(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };
        match ssl.finished() {
            Some(finished) => jsc::ArrayBuffer::create_buffer(cx.global(), &finished),
            None => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn get_shared_sigalgs(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        jsc::mark_binding();
        if self.ssl(&cx.heap).is_none() {
            return Ok(JSValue::NULL);
        }
        // BoringSSL's `SSL_get_shared_sigalgs` always returns 0.
        JSValue::create_empty_array(cx.global(), 0)
    }

    pub(crate) fn get_cipher(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };
        let cipher = ssl.current_cipher();
        let global = cx.global();
        let result = JSValue::create_empty_object(global, 0);

        let Some(cipher) = cipher else {
            result.put(global, b"name", JSValue::NULL);
            result.put(global, b"standardName", JSValue::NULL);
            result.put(global, b"version", JSValue::NULL);
            return Ok(result);
        };

        result.put(global, b"name", c_str_to_js(global, cipher.name())?);
        let standard_name = cipher.standard_name();
        result.put(global, b"standardName", c_str_to_js(global, standard_name)?);

        // BoringSSL's SSL_CIPHER_get_version is a constant; these are OpenSSL's per-cipher minimum versions.
        let version = match cipher.min_version() {
            boringssl::TLS1_3_VERSION => "TLSv1.3",
            boringssl::TLS1_2_VERSION => "TLSv1.2",
            _ if cipher.kx_nid() == boringssl::NID_kx_ecdhe => "TLSv1.0",
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
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };
        match ssl.peer_finished() {
            Some(finished) => jsc::ArrayBuffer::create_buffer(cx.global(), &finished),
            None => Ok(JSValue::UNDEFINED),
        }
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
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(());
        };
        let applied = ssl.set_ssl_ctx(&sc.ctx);
        // A client keeps no session id context (see `us_internal_ssl_attach`).
        if !ssl.is_server() {
            ssl.clear_session_id_context();
        }
        if !applied {
            return Err(cx
                .global()
                .throw(format_args!("setKeyCert failed to apply the context")));
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

        let buffer_size = usize::try_from(length).expect("int cast");
        let buffer = JSValue::create_buffer_from_length(global, buffer_size)?;
        let mut out = buffer.as_array_buffer(global).unwrap();

        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };

        boringssl::ERR_clear_error();
        let context = context.as_ref().map(|context| context.slice());
        if !ssl.export_keying_material(out.slice_mut(), label.slice(), context) {
            let global = cx.global();
            return Err(global.throw_value(get_ssl_exception(
                global,
                b"Failed to export keying material",
            )));
        }
        Ok(buffer)
    }

    pub(crate) fn get_ephemeral_key_info(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::NULL);
        };
        if ssl.is_server() {
            return Ok(JSValue::NULL);
        }
        // A resumed TLS <= 1.2 handshake has no key exchange, but its session still names the original group.
        let no_key_exchange = ssl.is_session_reused() && ssl.version() < boringssl::TLS1_3_VERSION;
        let group = ssl.negotiated_group();
        let global = cx.global();
        let result = JSValue::create_empty_object(global, 0);

        if no_key_exchange {
            return Ok(result);
        }
        let (name, size) = match group {
            boringssl::NID_X25519 => ("X25519", 253),
            boringssl::NID_X9_62_prime256v1 => ("prime256v1", 256),
            boringssl::NID_secp384r1 => ("secp384r1", 384),
            boringssl::NID_secp521r1 => ("secp521r1", 521),
            _ => return Ok(result),
        };
        result.put(global, b"type", BunString::static_("ECDH").to_js(global)?);
        result.put(global, b"name", BunString::static_(name).to_js(global)?);
        result.put(global, b"size", JSValue::js_number(f64::from(size)));
        Ok(result)
    }

    pub(crate) fn get_alpn_protocol(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(protocol) = self.ssl(&cx.heap).and_then(|ssl| ssl.alpn_selected()) else {
            return Ok(JSValue::FALSE);
        };
        let slice = &*protocol;
        let global = cx.global();
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
    fn current_session(&self, ssl: &boringssl::SSL) -> Option<boringssl::OwnedSslSession> {
        self.latest_session
            .get()
            .as_deref()
            .map(boringssl::OwnedSslSession::retain)
            .or_else(|| self.socket.get().wrapper_latest_session())
            .or_else(|| ssl.session())
    }

    pub(crate) fn get_session(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };
        let session = self.current_session(ssl);
        match session.and_then(|session| session.to_der()) {
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
            let Some(ssl) = self.ssl(&cx.heap) else {
                return Ok(());
            };
            match boringssl::OwnedSslSession::from_der(session_slice) {
                Some(session) => ssl.set_session(&session),
                None => boringssl::ERR_clear_error(),
            }
            Ok(())
        } else {
            Err(global.throw(format_args!(
                "Expected session to be a string, Buffer or TypedArray"
            )))
        }
    }

    pub(crate) fn get_tls_ticket(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(JSValue::UNDEFINED);
        };
        match self.current_session(ssl) {
            Some(session) if !session.ticket().is_empty() => {
                jsc::ArrayBuffer::create_buffer(cx.global(), session.ticket())
            }
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    pub(crate) fn renegotiate(&self, cx: &mut JsScope<'_>) -> JsResult<()> {
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(());
        };
        boringssl::ERR_clear_error();
        if !ssl.renegotiate() {
            let global = cx.global();
            return Err(global.throw_value(get_ssl_exception(global, b"SSL_renegotiate error")));
        }
        Ok(())
    }

    pub(crate) fn disable_renegotiation(&self, heap: &JsHeap<'_>) {
        if let Some(ssl) = self.ssl(heap) {
            ssl.set_renegotiate_mode(boringssl::RenegotiateMode::Never);
        }
    }

    pub(crate) fn is_session_reused(&self, heap: &JsHeap<'_>) -> bool {
        self.ssl(heap).is_some_and(|ssl| ssl.is_session_reused())
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
        let Some(ssl) = self.ssl(&cx.heap) else {
            return Ok(());
        };
        if !acts_as_server && reject_unauthorized && !ssl.is_init_finished() {
            // The same in-handshake chain check as for a client that rejects from the start.
            self.socket.get().set_inline_reject();
        } else {
            // we always allow and check the SSL certificate after the handshake or renegotiation
            ssl.set_verify_always_continue(verify_mode);
        }
        Ok(())
    }
}

fn c_str_to_js(global: &JSGlobalObject, string: &CStr) -> JsResult<JSValue> {
    bun_string_jsc::create_utf8_for_js(global, string.to_bytes())
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

        for part in [
            &*boringssl::err_reason_error_string(ssl_error),
            b" via ",
            boringssl::ERR_func_error_string(ssl_error)
                .to_cstr()
                .to_bytes(),
            b" ",
            boringssl::ERR_lib_error_string(ssl_error)
                .to_cstr()
                .to_bytes(),
        ] {
            output_buf[written..written + part.len()].copy_from_slice(part);
            written += part.len();
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
