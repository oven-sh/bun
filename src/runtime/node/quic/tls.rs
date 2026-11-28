use core::ffi::c_int;

use bun_boringssl_sys as ssl;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc};

pub(super) struct TlsConfig {
    pub is_server: bool,
    pub alpn: Vec<u8>,
    pub servername: Option<Vec<u8>>,
    pub certs_pem: Vec<Vec<u8>>,
    pub keys_pem: Vec<Vec<u8>>,
    pub ca_pem: Vec<Vec<u8>>,
    pub crl_pem: Vec<Vec<u8>>,
    pub verify_peer_strict: bool,
    pub verify_hostname: bool,
    pub verify_client: bool,
    pub keylog: bool,
    /// 0-RTT early data (`enableEarlyData`, default on — RFC 8446 §2.3).
    pub enable_early_data: bool,
    pub ciphers: Option<Vec<u8>>,
    pub groups: Option<Vec<u8>>,
}

fn value_to_bytes(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Vec<u8>>> {
    if value.is_empty_or_undefined_or_null() {
        return Ok(None);
    }
    if value.is_string() {
        return Ok(Some(
            bun_core::String::from_js(value, global)?.to_owned_slice(),
        ));
    }
    if let Some(buf) = value.as_array_buffer(global) {
        return Ok(Some(buf.byte_slice().to_vec()));
    }
    Ok(None)
}

fn collect_pem(global: &JSGlobalObject, value: JSValue) -> JsResult<Vec<Vec<u8>>> {
    let mut out = Vec::new();
    if value.is_array() {
        let len = value.get_length(global)? as u32;
        for i in 0..len {
            if let Some(bytes) = value_to_bytes(global, value.get_index(global, i)?)? {
                out.push(bytes);
            }
        }
    } else if let Some(bytes) = value_to_bytes(global, value)? {
        out.push(bytes);
    }
    Ok(out)
}

/// The TLS 1.3 cipher suites BoringSSL implements (RFC 8446 appendix B.4
/// names).
const TLS13_AES_128_GCM_SHA256: &[u8] = b"TLS_AES_128_GCM_SHA256";
const TLS13_AES_256_GCM_SHA384: &[u8] = b"TLS_AES_256_GCM_SHA384";
const TLS13_CHACHA20_POLY1305_SHA256: &[u8] = b"TLS_CHACHA20_POLY1305_SHA256";

// packages/bun-usockets/src/quic.cpp asserts these, and the `SSL_EARLY_DATA_*` and `X509_V_FLAG_*` values below, against BoringSSL's
// headers.
const SSL_COMPLIANCE_POLICY_FIPS_202205: c_int = 1;
const SSL_COMPLIANCE_POLICY_WPA3_192_202304: c_int = 3;

fn tls13_policy_for_ciphers(ciphers: &[u8]) -> Option<c_int> {
    let mut has_128 = false;
    let mut has_256 = false;
    let mut has_chacha = false;
    for name in bun_core::strings::split(ciphers, b":") {
        if name == TLS13_AES_128_GCM_SHA256 {
            has_128 = true;
        } else if name == TLS13_AES_256_GCM_SHA384 {
            has_256 = true;
        } else if name == TLS13_CHACHA20_POLY1305_SHA256 {
            has_chacha = true;
        }
    }
    if has_256 && !has_128 && !has_chacha {
        Some(SSL_COMPLIANCE_POLICY_WPA3_192_202304)
    } else if !has_chacha && (has_128 || has_256) {
        Some(SSL_COMPLIANCE_POLICY_FIPS_202205)
    } else {
        None
    }
}

impl TlsConfig {
    pub(super) fn from_js(
        global: &JSGlobalObject,
        tls: JSValue,
        is_server: bool,
    ) -> JsResult<Self> {
        let mut config = TlsConfig {
            is_server,
            // Node's default.
            alpn: b"\x02h3".to_vec(),
            servername: None,
            certs_pem: Vec::new(),
            keys_pem: Vec::new(),
            ca_pem: Vec::new(),
            crl_pem: Vec::new(),
            verify_peer_strict: false,
            verify_hostname: false,
            verify_client: false,
            keylog: false,
            enable_early_data: true,
            ciphers: None,
            groups: None,
        };
        if !tls.is_object() {
            return Ok(config);
        }
        if let Some(v) = tls.get(global, "alpn")? {
            if let Some(bytes) = value_to_bytes(global, v)?.filter(|it| !it.is_empty()) {
                config.alpn = bytes;
            }
        }
        if let Some(v) = tls.get(global, "servername")?.filter(|v| v.is_string()) {
            let mut bytes = bun_core::String::from_js(v, global)?.to_owned_slice();
            if bun_core::strings::contains_char(&bytes, 0) {
                return Err(global.throw_invalid_arguments(format_args!(
                    "servername must not contain null bytes"
                )));
            }
            bytes.push(0);
            config.servername = Some(bytes);
        }
        if let Some(v) = tls.get(global, "certs")? {
            config.certs_pem = collect_pem(global, v)?;
        }
        if let Some(v) = tls.get(global, "keys")? {
            config.keys_pem = collect_pem(global, v)?;
        }
        if let Some(v) = tls.get(global, "ca")? {
            config.ca_pem = collect_pem(global, v)?;
        }
        if let Some(v) = tls.get(global, "crl")? {
            config.crl_pem = collect_pem(global, v)?;
        }
        if let Some(v) = tls.get(global, "verifyPeerStrict")? {
            config.verify_peer_strict = v.to_boolean();
        }
        if let Some(v) = tls.get(global, "verifyHostname")? {
            config.verify_hostname = v.to_boolean();
        }
        if let Some(v) = tls.get(global, "verifyClient")? {
            config.verify_client = v.to_boolean();
        }
        if let Some(v) = tls.get(global, "keylog")? {
            config.keylog = v.to_boolean();
        }
        if let Some(v) = tls.get(global, "enableEarlyData")? {
            config.enable_early_data = v.to_boolean();
        }
        config.enable_early_data &= !(is_server && config.verify_client);
        if let Some(v) = tls.get(global, "ciphers")?.filter(|v| v.is_string()) {
            config.ciphers = Some(bun_core::String::from_js(v, global)?.to_owned_slice());
        }
        if let Some(v) = tls.get(global, "groups")?.filter(|v| v.is_string()) {
            let mut bytes = bun_core::String::from_js(v, global)?.to_owned_slice();
            bytes.push(0);
            config.groups = Some(bytes);
        }
        // Node defaults the servername to "localhost" when none is given
        // (node/src/quic/tlscontext.h TLSContext::Options::servername).
        if config.servername.is_none() {
            config.servername = Some(b"localhost\0".to_vec());
        }
        Ok(config)
    }
}

pub(super) fn early_data_info(ssl: &ssl::SSL) -> (bool, bool) {
    const SSL_EARLY_DATA_UNKNOWN: c_int = 0;
    const SSL_EARLY_DATA_DISABLED: c_int = 1;
    const SSL_EARLY_DATA_NO_SESSION_OFFERED: c_int = 5;
    let accepted = ssl::SSL_early_data_accepted(ssl) != 0;
    let reason = ssl::SSL_get_early_data_reason(ssl);
    let attempted = accepted
        || !matches!(
            reason,
            SSL_EARLY_DATA_UNKNOWN | SSL_EARLY_DATA_DISABLED | SSL_EARLY_DATA_NO_SESSION_OFFERED
        );
    (attempted, accepted)
}

fn load_cert_chain(ctx: &ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    let bio = ssl::MemBio::new(pem).ok_or("failed to allocate BIO for certificate")?;
    let leaf = bio
        .read_x509_aux()
        .ok_or("failed to parse certificate PEM")?;
    if ssl::SSL_CTX_use_certificate(ctx, &leaf) != 1 {
        return Err("failed to install certificate");
    }
    while let Some(extra) = bio.read_x509() {
        if ssl::SSL_CTX_add1_chain_cert(ctx, &extra) != 1 {
            return Err("failed to add chain certificate");
        }
    }
    ssl::ERR_clear_error();
    Ok(())
}

fn load_private_key(ctx: &ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    let bio = ssl::MemBio::new(pem).ok_or("failed to allocate BIO for key")?;
    let pkey = bio
        .read_private_key()
        .ok_or("failed to parse private key PEM")?;
    if ssl::SSL_CTX_use_PrivateKey(ctx, &pkey) != 1 {
        return Err("failed to install private key");
    }
    Ok(())
}

const X509_V_FLAG_CRL_CHECK: core::ffi::c_ulong = 0x4;
/// `X509_V_FLAG_CRL_CHECK_ALL` — also check intermediate CAs (Node sets both).
const X509_V_FLAG_CRL_CHECK_ALL: core::ffi::c_ulong = 0x8;
/// `X509_V_FLAG_IGNORE_EXPIRED_TRUST_ANCHORS` (oven-sh/boringssl) — as every other Bun SSL_CTX: an expired CA in the
/// trust set does not shadow the valid certificate for the same issuer that the peer sends.
const X509_V_FLAG_IGNORE_EXPIRED_TRUST_ANCHORS: core::ffi::c_ulong = 0x40000000;

/// SAFETY: `ctx` is not shared yet.
unsafe fn load_crl_store(ctx: &ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    let store = ssl::SSL_CTX_get_cert_store(ctx).expect("a new SSL_CTX has a store");
    let bio = ssl::MemBio::new(pem).ok_or("failed to allocate BIO for CRL")?;
    let mut added = 0;
    while let Some(crl) = bio.read_x509_crl() {
        if ssl::X509_STORE_add_crl(store, &crl) != 1 {
            ssl::ERR_clear_error();
            return Err("failed to add CRL to trust store");
        }
        added += 1;
    }
    ssl::ERR_clear_error();
    if added == 0 {
        return Err("CRL PEM contained no revocation lists");
    }
    // SAFETY: fn contract.
    unsafe { ssl::X509_STORE_set_flags(store, X509_V_FLAG_CRL_CHECK | X509_V_FLAG_CRL_CHECK_ALL) };
    Ok(())
}

fn load_ca_store(ctx: &ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    let store = ssl::SSL_CTX_get_cert_store(ctx).expect("a new SSL_CTX has a store");
    let bio = ssl::MemBio::new(pem).ok_or("failed to allocate BIO for CA")?;
    let mut added = 0;
    while let Some(cert) = bio.read_x509() {
        if ssl::X509_STORE_add_cert(store, &cert) != 1 {
            ssl::ERR_clear_error();
            return Err("failed to add CA certificate to trust store");
        }
        added += 1;
    }
    ssl::ERR_clear_error();
    if added == 0 {
        return Err("CA PEM contained no certificates");
    }
    Ok(())
}

impl TlsConfig {
    pub(super) fn create_context(&self) -> Result<ssl::OwnedSslCtx, &'static str> {
        let config = self;
        // SAFETY: the context is live, and is not shared before this returns.
        unsafe {
            let Some(owned) = ssl::SSL_CTX_new(ssl::TLS_method()) else {
                return Err("failed to allocate SSL_CTX");
            };
            let ctx = owned.as_ptr();

            if let Some(policy) = config.ciphers.as_deref().and_then(tls13_policy_for_ciphers) {
                if ssl::SSL_CTX_set_compliance_policy(ctx, policy) != 1 {
                    return Err("failed to apply cipher policy");
                }
            }
            if ssl::SSL_CTX_set_min_proto_version(ctx, ssl::TLS1_3_VERSION) != 1
                || ssl::SSL_CTX_set_max_proto_version(ctx, ssl::TLS1_3_VERSION) != 1
            {
                return Err("failed to pin TLS 1.3");
            }
            ssl::X509_VERIFY_PARAM_set_flags(
                ssl::SSL_CTX_get0_param(ctx),
                X509_V_FLAG_IGNORE_EXPIRED_TRUST_ANCHORS,
            );
            if us_ssl_ctx_set_verify_signature_algorithms(ctx) != 1 {
                return Err("failed to set the signature algorithms");
            }
            us_ssl_ctx_reject_blocked_keys(ctx);
            if let Some(groups) = &config.groups {
                if ssl::SSL_CTX_set1_groups_list(ctx, groups.as_ptr().cast()) != 1 {
                    return Err("invalid TLS groups list");
                }
            }
            if config.ca_pem.is_empty() {
                ssl::SSL_CTX_set_default_verify_paths(ctx);
            }

            // Node pairs `certs[i]` with `keys[i]`.
            for (i, pem) in config.certs_pem.iter().enumerate() {
                if i > 0 {
                    ssl::SSL_CTX_clear_chain_certs(ctx);
                }
                load_cert_chain(&owned, pem)?;
                if let Some(key) = config.keys_pem.get(i) {
                    load_private_key(&owned, key)?;
                }
            }
            if config.certs_pem.is_empty() {
                if let Some(key) = config.keys_pem.first() {
                    load_private_key(&owned, key)?;
                }
            }
            for pem in &config.ca_pem {
                load_ca_store(&owned, pem)?;
            }
            for pem in &config.crl_pem {
                load_crl_store(&owned, pem)?;
            }

            ssl::SSL_CTX_set_early_data_enabled(ctx, config.enable_early_data as c_int);
            if config.keylog {
                bun_quic_tls::enable_key_log(&owned);
            }
            owned.set_session_id_context(&config.session_context());
            if config.is_server {
                if config.verify_client {
                    // SSL_VERIFY_PEER alone matches Node's TLS 1.3 semantics (see QuicSession::maybe_report_handshake).
                    ssl::SSL_CTX_set_verify(ctx, ssl::SSL_VERIFY_PEER, None);
                }
                bun_quic_tls::enable_alpn(&owned);
            } else {
                bun_quic_tls::enable_tickets(&owned);
                if ssl::SSL_CTX_set_alpn_protos(ctx, config.alpn.as_ptr(), config.alpn.len()) != 0 {
                    return Err("failed to set ALPN protocols");
                }
                let mode = if config.verify_peer_strict {
                    ssl::SSL_VERIFY_PEER
                } else {
                    ssl::SSL_VERIFY_NONE
                };
                ssl::SSL_CTX_set_verify(ctx, mode, None);
                if config.verify_hostname {
                    let Some(servername) = &config.servername else {
                        return Err("verifyHostname requires a servername");
                    };
                    let host = servername.strip_suffix(b"\0").unwrap_or(servername);
                    if host.is_empty() {
                        return Err("verifyHostname requires a non-empty servername");
                    }
                    let param = ssl::SSL_CTX_get0_param(ctx);
                    if param.is_null()
                        || ssl::X509_VERIFY_PARAM_set1_host(param, host.as_ptr().cast(), host.len())
                            != 1
                    {
                        return Err("failed to bind hostname for certificate verification");
                    }
                }
            }

            ssl::ERR_clear_error();
            Ok(owned)
        }
    }

    /// Who the peers of a session are, and how that has been established.
    fn session_context(&self) -> [u8; bun_sha_hmac::SHA256::DIGEST] {
        let mut hasher = bun_sha_hmac::SHA256::init();
        let flags = [
            self.verify_hostname,
            self.is_server && self.verify_client,
            self.is_server && self.enable_early_data,
        ];
        hasher.update(&flags.map(u8::from));
        for list in [
            self.servername.as_slice(),
            &self.certs_pem,
            &self.ca_pem,
            &self.crl_pem,
        ] {
            hasher.update(&list.len().to_ne_bytes());
            for item in list {
                hasher.update(&item.len().to_ne_bytes());
                hasher.update(item);
            }
        }
        let mut digest = [0; _];
        hasher.r#final(&mut digest);
        digest
    }

    /// Whether the protocols are HTTP/3, or `None` if only some of them are.
    pub(super) fn is_http3(&self) -> Option<bool> {
        let mut rest = self.alpn.as_slice();
        let mut names = core::iter::from_fn(|| {
            let len = *rest.split_off_first()?;
            rest.split_off(..usize::from(len))
        })
        .map(|name| name == b"h3" || name.starts_with(b"h3-"));
        let first = names.next()?;
        names.all(|it| it == first).then_some(first)
    }
}

unsafe extern "C" {
    /// `X509_V_ERR_*` -> node's code name; see ncrypto.cpp.
    safe fn Bun__X509__validationErrorCode(err: i32) -> bun_core::CStrRef<'static>;
    /// openssl.cpp: the signature algorithms every other TLS context of Bun accepts from a peer.
    fn us_ssl_ctx_set_verify_signature_algorithms(ctx: *mut ssl::SSL_CTX) -> c_int;
    /// openssl.cpp: the blocked public keys every other TLS context of Bun rejects in a peer's chain.
    fn us_ssl_ctx_reject_blocked_keys(ctx: *mut ssl::SSL_CTX);
}

/// node's `X509_V_ERR_UNSPECIFIED`, reported when a peer sent no certificate
/// at all (`verifyPeerCertificate()` nullopt -> `value_or`).
pub(super) const X509_V_ERR_UNSPECIFIED: i32 = 1;

/// The `(code name, reason)` pair node reports as
/// `validationErrorCode` / `validationErrorReason`.
pub(super) fn validation_error_strings(code: i32) -> (&'static str, &'static str) {
    let name = Bun__X509__validationErrorCode(code).to_cstr();
    let name = name.to_str().unwrap_or("UNSPECIFIED");
    let reason = ssl::X509_verify_cert_error_string(code as _).to_cstr();
    (name, reason.to_str().unwrap_or(""))
}

pub(super) fn validation_error(ssl: &ssl::SSL) -> Option<(&'static str, &'static str)> {
    let code = ssl::SSL_get_verify_result(ssl);
    if code == 0 {
        return None;
    }
    Some(validation_error_strings(code as i32))
}

pub(super) fn ephemeral_key_info(
    ssl: &ssl::SSL,
) -> Option<(&'static str, Option<&'static str>, u32)> {
    let group = ssl::SSL_get_group_id(ssl);
    if group == 0 {
        return None;
    }
    let name = ssl::SSL_get_group_name(group).and_then(|name| name.to_cstr().to_str().ok());
    // Named-group sizes (RFC 8446 §4.2.7 / Node's GetEphemeralKey).
    let bits = match group {
        ssl::SSL_GROUP_X25519 => 253,
        ssl::SSL_GROUP_X448 => 448,
        ssl::SSL_GROUP_SECP256R1 => 256,
        ssl::SSL_GROUP_SECP384R1 => 384,
        ssl::SSL_GROUP_SECP521R1 => 521,
        _ => 0,
    };
    Some(("ECDH", name, bits))
}

pub(super) fn local_certificate_der(ssl: &ssl::SSL) -> Option<Vec<u8>> {
    // `load_cert_chain` only installs certificates on the context. The context parses its
    // leaf once, but `SSL_get_certificate` parses a copy for each SSL.
    // SAFETY: returns a borrowed X509 owned by `ssl`'s context.
    let cert = unsafe { ssl::SSL_CTX_get0_certificate(ssl::SSL_get_SSL_CTX(ssl)).as_ref() }?;
    Some(cert.to_der()?.to_vec())
}

pub(super) fn peer_certificate_der(ssl: &ssl::SSL) -> Option<Vec<u8>> {
    Some(ssl.peer_certificate()?.to_der()?.to_vec())
}
