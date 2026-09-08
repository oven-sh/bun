use core::ffi::{CStr, c_int, c_long, c_ulong};

use bun_boringssl_sys as ssl;
use bun_jsc::{JSGlobalObject, JSValue, JsResult, StringJsc};
use bun_lsquic_sys as lsquic;

use super::endpoint::QuicEndpoint;
use super::session::{QuicSession, SessionEvent, StoredAddr};

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
    pub groups: Option<std::ffi::CString>,
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

/// Interior NULs cannot be represented in the C string the option feeds;
/// truncate at the first one, as the C side would have read it.
fn cstring_lossy(mut bytes: Vec<u8>) -> std::ffi::CString {
    if let Some(nul) = bun_core::strings::index_of_char_usize(&bytes, 0) {
        bytes.truncate(nul);
    }
    std::ffi::CString::new(bytes).unwrap_or_default()
}

/// The TLS 1.3 cipher suites BoringSSL implements (RFC 8446 appendix B.4
/// names).
const TLS13_AES_128_GCM_SHA256: &[u8] = b"TLS_AES_128_GCM_SHA256";
const TLS13_AES_256_GCM_SHA384: &[u8] = b"TLS_AES_256_GCM_SHA384";
const TLS13_CHACHA20_POLY1305_SHA256: &[u8] = b"TLS_CHACHA20_POLY1305_SHA256";

const SSL_COMPLIANCE_POLICY_FIPS_202205: c_int = 1;
const SSL_COMPLIANCE_POLICY_WPA3_192_202304: c_int = 2;

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
    /// The SNI to send, as lsquic takes it.
    pub(super) fn servername_cstr(&self) -> Option<std::ffi::CString> {
        self.servername.clone().map(cstring_lossy)
    }

    pub(super) fn from_js(
        global: &JSGlobalObject,
        tls: JSValue,
        is_server: bool,
    ) -> JsResult<Self> {
        let mut config = TlsConfig {
            is_server,
            alpn: Vec::new(),
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
            if let Some(bytes) = value_to_bytes(global, v)? {
                config.alpn = bytes;
            }
        }
        if let Some(v) = tls.get(global, "servername")?.filter(|v| v.is_string()) {
            config.servername = Some(bun_core::String::from_js(v, global)?.to_owned_slice());
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
        if let Some(v) = tls.get(global, "ciphers")?.filter(|v| v.is_string()) {
            config.ciphers = Some(bun_core::String::from_js(v, global)?.to_owned_slice());
        }
        if let Some(v) = tls.get(global, "groups")?.filter(|v| v.is_string()) {
            let bytes = bun_core::String::from_js(v, global)?.to_owned_slice();
            config.groups = Some(cstring_lossy(bytes));
        }
        // Node defaults the servername to "localhost" when none is given
        // (node/src/quic/tlscontext.h TLSContext::Options::servername).
        if config.servername.is_none() {
            config.servername = Some(b"localhost".to_vec());
        }
        Ok(config)
    }
}

pub(super) fn early_data_info(ssl: &ssl::SSL) -> (bool, bool) {
    const SSL_EARLY_DATA_UNKNOWN: c_int = 0;
    const SSL_EARLY_DATA_DISABLED: c_int = 1;
    const SSL_EARLY_DATA_NO_SESSION_OFFERED: c_int = 5;
    let accepted = ssl.early_data_accepted();
    let reason = ssl.early_data_reason();
    let attempted = accepted
        || !matches!(
            reason,
            SSL_EARLY_DATA_UNKNOWN | SSL_EARLY_DATA_DISABLED | SSL_EARLY_DATA_NO_SESSION_OFFERED
        );
    (attempted, accepted)
}

/// lsquic borrows the raw pointer; this struct owns one reference.
pub(super) struct TlsContext {
    ctx: ssl::OwnedSslCtx,
}

/// Routes BoringSSL's key log lines to the session (or, before the session
/// is bound, the endpoint) of the conn the handshake belongs to.
struct QuicKeylog;

impl ssl::KeylogCallback for QuicKeylog {
    fn log(ssl: &ssl::SSL, line: &[u8]) {
        let Some(conn) = lsquic::HandshakeConn::from_ssl(ssl) else {
            return;
        };
        if let Some(session) = conn.ctx::<QuicSession>() {
            session.push_event(SessionEvent::Keylog(line.to_vec()));
            return;
        }
        let Some(endpoint) = conn.peer_ctx::<QuicEndpoint>() else {
            return;
        };
        let Some((_, peer)) = conn.sockaddrs() else {
            return;
        };
        endpoint.buffer_early_keylog(ssl, StoredAddr::from_lsquic(&peer), line.to_vec());
    }
}

fn load_cert_chain(ctx: &ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    let Some(mut bio) = ssl::MemBio::new(pem) else {
        return Err("failed to allocate BIO for certificate");
    };
    let Some(leaf) = bio.read_pem_x509_aux() else {
        return Err("failed to parse certificate PEM");
    };
    if !ctx.use_certificate(&leaf) {
        return Err("failed to install certificate");
    }
    drop(leaf);
    while let Some(extra) = bio.read_pem_x509() {
        if ctx.add0_chain_cert(extra).is_err() {
            return Err("failed to add chain certificate");
        }
    }
    ssl::ERR_clear_error();
    Ok(())
}

fn load_private_key(ctx: &ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    let Some(mut bio) = ssl::MemBio::new(pem) else {
        return Err("failed to allocate BIO for key");
    };
    let pkey = bio.read_pem_private_key();
    drop(bio);
    let Some(pkey) = pkey else {
        return Err("failed to parse private key PEM");
    };
    if !ctx.use_private_key(&pkey) {
        return Err("failed to install private key");
    }
    Ok(())
}

const X509_V_FLAG_CRL_CHECK: c_ulong = 0x4;
/// `X509_V_FLAG_CRL_CHECK_ALL` — also check intermediate CAs (Node sets both).
const X509_V_FLAG_CRL_CHECK_ALL: c_ulong = 0x8;
/// `X509_V_FLAG_IGNORE_EXPIRED_TRUST_ANCHORS` (oven-sh/boringssl) — as every other Bun SSL_CTX: an expired CA in the
/// trust set does not shadow the valid certificate for the same issuer that the peer sends.
const X509_V_FLAG_IGNORE_EXPIRED_TRUST_ANCHORS: c_ulong = 0x2000000;

fn load_crl_store(ctx: &ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    let store = ctx.cert_store();
    let Some(mut bio) = ssl::MemBio::new(pem) else {
        return Err("failed to allocate BIO for CRL");
    };
    let mut added = 0;
    while let Some(crl) = bio.read_pem_x509_crl() {
        if !store.add_crl(&crl) {
            ssl::ERR_clear_error();
            return Err("failed to add CRL to trust store");
        }
        added += 1;
    }
    ssl::ERR_clear_error();
    drop(bio);
    if added == 0 {
        return Err("CRL PEM contained no revocation lists");
    }
    store.set_flags(X509_V_FLAG_CRL_CHECK | X509_V_FLAG_CRL_CHECK_ALL);
    Ok(())
}

fn load_ca_store(ctx: &ssl::SSL_CTX, pem: &[u8]) -> Result<(), &'static str> {
    let store = ctx.cert_store();
    let Some(mut bio) = ssl::MemBio::new(pem) else {
        return Err("failed to allocate BIO for CA");
    };
    let mut added = 0;
    while let Some(cert) = bio.read_pem_x509() {
        if !store.add_cert(&cert) {
            ssl::ERR_clear_error();
            return Err("failed to add CA certificate to trust store");
        }
        added += 1;
    }
    ssl::ERR_clear_error();
    drop(bio);
    if added == 0 {
        return Err("CA PEM contained no certificates");
    }
    Ok(())
}

impl TlsContext {
    pub(super) fn new(config: &TlsConfig) -> Result<Self, &'static str> {
        let Some(ctx) = ssl::OwnedSslCtx::new_tls() else {
            return Err("failed to allocate SSL_CTX");
        };

        if let Some(policy) = config.ciphers.as_deref().and_then(tls13_policy_for_ciphers) {
            if !ctx.set_compliance_policy(policy) {
                return Err("failed to apply cipher policy");
            }
        }
        if !ctx.set_proto_version_range(ssl::TLS1_3_VERSION, ssl::TLS1_3_VERSION) {
            return Err("failed to pin TLS 1.3");
        }
        ctx.set_verify_flags(X509_V_FLAG_IGNORE_EXPIRED_TRUST_ANCHORS);
        if let Some(groups) = &config.groups {
            if !ctx.set1_groups_list(groups) {
                return Err("invalid TLS groups list");
            }
        }
        if config.ca_pem.is_empty() {
            ctx.set_default_verify_paths();
        }

        // Node pairs `certs[i]` with `keys[i]`.
        for (i, pem) in config.certs_pem.iter().enumerate() {
            if i > 0 {
                ctx.clear_chain_certs();
            }
            load_cert_chain(&ctx, pem)?;
            if let Some(key) = config.keys_pem.get(i) {
                load_private_key(&ctx, key)?;
            }
        }
        if config.certs_pem.is_empty() {
            if let Some(key) = config.keys_pem.first() {
                load_private_key(&ctx, key)?;
            }
        }
        for pem in &config.ca_pem {
            load_ca_store(&ctx, pem)?;
        }
        for pem in &config.crl_pem {
            load_crl_store(&ctx, pem)?;
        }

        ctx.set_early_data_enabled(config.enable_early_data);
        if config.keylog {
            ctx.set_keylog_callback::<QuicKeylog>();
        }
        if config.is_server {
            if config.verify_client {
                // SSL_VERIFY_PEER alone matches Node's TLS 1.3 semantics (see QuicSession::maybe_report_handshake).
                ctx.set_verify_mode(ssl::SSL_VERIFY_PEER);
            }
            if !config.alpn.is_empty() && !ctx.set_alpn_select_from(&config.alpn) {
                return Err("failed to set ALPN protocols");
            }
        } else {
            if !config.alpn.is_empty() && !ctx.set_alpn_protos(&config.alpn) {
                return Err("failed to set ALPN protocols");
            }
            let mode = if config.verify_peer_strict {
                ssl::SSL_VERIFY_PEER
            } else {
                ssl::SSL_VERIFY_NONE
            };
            ctx.set_verify_mode(mode);
            if config.verify_hostname {
                let Some(servername) = &config.servername else {
                    return Err("verifyHostname requires a servername");
                };
                let host = servername.as_slice();
                if host.is_empty() {
                    return Err("verifyHostname requires a non-empty servername");
                }
                if !ctx.set1_verify_host(host) {
                    return Err("failed to bind hostname for certificate verification");
                }
            }
        }

        ssl::ERR_clear_error();
        Ok(TlsContext { ctx })
    }

    pub(super) fn raw(&self) -> *mut ssl::SSL_CTX {
        self.ctx.as_ptr()
    }

    pub(super) fn alpn_cstr(config: &TlsConfig) -> Vec<u8> {
        if config.alpn.len() < 2 {
            return Vec::new();
        }
        let n = config.alpn[0] as usize;
        let mut out = config.alpn[1..1 + n.min(config.alpn.len() - 1)].to_vec();
        out.push(0);
        out
    }
}

pub(super) fn negotiated_alpn(ssl: &ssl::SSL) -> Option<Vec<u8>> {
    ssl.alpn_selected().map(<[u8]>::to_vec)
}

/// The code name node reports for a peer-certificate validation failure.
fn validation_error_code(err: c_long) -> &'static str {
    match err {
        ssl::X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT => "UNABLE_TO_GET_ISSUER_CERT",
        ssl::X509_V_ERR_UNABLE_TO_GET_CRL => "UNABLE_TO_GET_CRL",
        ssl::X509_V_ERR_UNABLE_TO_DECRYPT_CERT_SIGNATURE => "UNABLE_TO_DECRYPT_CERT_SIGNATURE",
        ssl::X509_V_ERR_UNABLE_TO_DECRYPT_CRL_SIGNATURE => "UNABLE_TO_DECRYPT_CRL_SIGNATURE",
        ssl::X509_V_ERR_UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY => "UNABLE_TO_DECODE_ISSUER_PUBLIC_KEY",
        ssl::X509_V_ERR_CERT_SIGNATURE_FAILURE => "CERT_SIGNATURE_FAILURE",
        ssl::X509_V_ERR_CRL_SIGNATURE_FAILURE => "CRL_SIGNATURE_FAILURE",
        ssl::X509_V_ERR_CERT_NOT_YET_VALID => "CERT_NOT_YET_VALID",
        ssl::X509_V_ERR_CERT_HAS_EXPIRED => "CERT_HAS_EXPIRED",
        ssl::X509_V_ERR_CRL_NOT_YET_VALID => "CRL_NOT_YET_VALID",
        ssl::X509_V_ERR_CRL_HAS_EXPIRED => "CRL_HAS_EXPIRED",
        ssl::X509_V_ERR_ERROR_IN_CERT_NOT_BEFORE_FIELD => "ERROR_IN_CERT_NOT_BEFORE_FIELD",
        ssl::X509_V_ERR_ERROR_IN_CERT_NOT_AFTER_FIELD => "ERROR_IN_CERT_NOT_AFTER_FIELD",
        ssl::X509_V_ERR_ERROR_IN_CRL_LAST_UPDATE_FIELD => "ERROR_IN_CRL_LAST_UPDATE_FIELD",
        ssl::X509_V_ERR_ERROR_IN_CRL_NEXT_UPDATE_FIELD => "ERROR_IN_CRL_NEXT_UPDATE_FIELD",
        ssl::X509_V_ERR_OUT_OF_MEM => "OUT_OF_MEM",
        ssl::X509_V_ERR_DEPTH_ZERO_SELF_SIGNED_CERT => "DEPTH_ZERO_SELF_SIGNED_CERT",
        ssl::X509_V_ERR_SELF_SIGNED_CERT_IN_CHAIN => "SELF_SIGNED_CERT_IN_CHAIN",
        ssl::X509_V_ERR_UNABLE_TO_GET_ISSUER_CERT_LOCALLY => "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
        ssl::X509_V_ERR_UNABLE_TO_VERIFY_LEAF_SIGNATURE => "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
        ssl::X509_V_ERR_CERT_CHAIN_TOO_LONG => "CERT_CHAIN_TOO_LONG",
        ssl::X509_V_ERR_CERT_REVOKED => "CERT_REVOKED",
        ssl::X509_V_ERR_INVALID_CA => "INVALID_CA",
        ssl::X509_V_ERR_PATH_LENGTH_EXCEEDED => "PATH_LENGTH_EXCEEDED",
        ssl::X509_V_ERR_INVALID_PURPOSE => "INVALID_PURPOSE",
        ssl::X509_V_ERR_CERT_UNTRUSTED => "CERT_UNTRUSTED",
        ssl::X509_V_ERR_CERT_REJECTED => "CERT_REJECTED",
        ssl::X509_V_ERR_HOSTNAME_MISMATCH => "HOSTNAME_MISMATCH",
        _ => "UNSPECIFIED",
    }
}

/// The `(code name, reason)` pair node reports as
/// `validationErrorCode` / `validationErrorReason`.
pub(super) fn validation_error_strings(code: c_long) -> (&'static str, &'static str) {
    let name = validation_error_code(code);
    let reason = ssl::verify_cert_error_string(code).to_str().unwrap_or("");
    (name, reason)
}

pub(super) fn validation_error(ssl: &ssl::SSL) -> Option<(&'static str, &'static str)> {
    let code = ssl.verify_result();
    if code == ssl::X509_V_OK {
        return None;
    }
    Some(validation_error_strings(code))
}

pub(super) fn ephemeral_key_info(
    ssl: &ssl::SSL,
) -> Option<(&'static str, Option<&'static str>, u32)> {
    let group = ssl.group_id();
    if group == 0 {
        return None;
    }
    let name = ssl::group_name(group).and_then(|s| CStr::to_str(s).ok());
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
    ssl.certificate()?.to_der()
}

pub(super) fn peer_certificate_der(ssl: &ssl::SSL) -> Option<Vec<u8>> {
    ssl.peer_certificate()?.to_der()
}
