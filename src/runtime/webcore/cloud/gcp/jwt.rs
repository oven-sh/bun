//! Just enough JWT to talk to Google's OAuth token endpoint: build and
//! RS256-sign a service-account assertion, and read `exp` back out of an ID
//! token.

use core::ffi::c_int;
use std::io::Write as _;

use bun_boringssl_sys as ssl;

use crate::webcore::cloud::json;

/// `NID_rsaEncryption` / `EVP_PKEY_RSA`.
const NID_RSA_ENCRYPTION: c_int = 6;

fn b64url(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&bun_base64::simdutf_encode_url_safe_alloc(bytes));
}

fn json_string(out: &mut Vec<u8>, s: &[u8]) {
    out.push(b'"');
    for &c in s {
        match c {
            b'"' => out.extend_from_slice(b"\\\""),
            b'\\' => out.extend_from_slice(b"\\\\"),
            b'\n' => out.extend_from_slice(b"\\n"),
            b'\r' => out.extend_from_slice(b"\\r"),
            b'\t' => out.extend_from_slice(b"\\t"),
            0..=0x1f => {
                let _ = write!(out, "\\u{:04x}", c);
            }
            _ => out.push(c),
        }
    }
    out.push(b'"');
}

pub struct Claims<'a> {
    pub iss: &'a [u8],
    /// Space-separated OAuth scopes (access tokens) …
    pub scope: Option<&'a [u8]>,
    /// … or the audience an ID token is minted for.
    pub target_audience: Option<&'a [u8]>,
    pub aud: &'a [u8],
    pub iat: u64,
    pub exp: u64,
}

/// `header.claims.signature`, RS256-signed with the PEM (PKCS#8 or PKCS#1)
/// RSA `private_key` from a service-account key file.
pub fn sign_rs256(
    private_key_pem: &[u8],
    key_id: Option<&[u8]>,
    claims: &Claims<'_>,
) -> Result<Vec<u8>, &'static str> {
    let mut header = Vec::with_capacity(96);
    header.extend_from_slice(b"{\"alg\":\"RS256\",\"typ\":\"JWT\"");
    if let Some(kid) = key_id {
        header.extend_from_slice(b",\"kid\":");
        json_string(&mut header, kid);
    }
    header.push(b'}');

    let mut payload = Vec::with_capacity(256);
    payload.extend_from_slice(b"{\"iss\":");
    json_string(&mut payload, claims.iss);
    payload.extend_from_slice(b",\"sub\":");
    json_string(&mut payload, claims.iss);
    payload.extend_from_slice(b",\"aud\":");
    json_string(&mut payload, claims.aud);
    if let Some(scope) = claims.scope {
        payload.extend_from_slice(b",\"scope\":");
        json_string(&mut payload, scope);
    }
    if let Some(aud) = claims.target_audience {
        payload.extend_from_slice(b",\"target_audience\":");
        json_string(&mut payload, aud);
    }
    let _ = write!(
        &mut payload,
        ",\"iat\":{},\"exp\":{}}}",
        claims.iat, claims.exp
    );

    let mut token = Vec::with_capacity(header.len() * 2 + payload.len() * 2 + 400);
    b64url(&mut token, &header);
    token.push(b'.');
    b64url(&mut token, &payload);

    let signature = rs256(private_key_pem, &token)?;
    token.push(b'.');
    b64url(&mut token, &signature);
    Ok(token)
}

fn rs256(private_key_pem: &[u8], message: &[u8]) -> Result<Vec<u8>, &'static str> {
    bun_boringssl::load();
    // SAFETY: straight-line BoringSSL FFI; every object created here is freed
    // on every path before returning, and all pointers passed are live locals.
    unsafe {
        let bio = ssl::BIO_new_mem_buf(
            private_key_pem.as_ptr().cast(),
            private_key_pem.len() as isize,
        );
        if bio.is_null() {
            return Err("out of memory");
        }
        let pkey =
            ssl::PEM_read_bio_PrivateKey(bio, core::ptr::null_mut(), None, core::ptr::null_mut());
        ssl::BIO_free(bio);
        if pkey.is_null() {
            ssl::ERR_clear_error();
            return Err("private_key is not a valid PEM private key");
        }
        let result = (|| {
            if ssl::EVP_PKEY_id(pkey) != NID_RSA_ENCRYPTION {
                return Err("private_key must be an RSA key for RS256");
            }
            let mut ctx: ssl::EVP_MD_CTX = bun_core::ffi::zeroed();
            ssl::EVP_MD_CTX_init(&mut ctx);
            let mut sig_len: usize = 0;
            let ok = ssl::EVP_DigestSignInit(
                &raw mut ctx,
                core::ptr::null_mut(),
                ssl::EVP_sha256(),
                core::ptr::null_mut(),
                pkey,
            ) == 1
                && ssl::EVP_DigestSign(
                    &raw mut ctx,
                    core::ptr::null_mut(),
                    &raw mut sig_len,
                    message.as_ptr(),
                    message.len(),
                ) == 1;
            if !ok {
                ssl::EVP_MD_CTX_cleanup(&raw mut ctx);
                return Err("RS256 signing failed");
            }
            let mut sig = vec![0u8; sig_len];
            let ok = ssl::EVP_DigestSign(
                &raw mut ctx,
                sig.as_mut_ptr(),
                &raw mut sig_len,
                message.as_ptr(),
                message.len(),
            ) == 1;
            ssl::EVP_MD_CTX_cleanup(&raw mut ctx);
            if !ok {
                return Err("RS256 signing failed");
            }
            sig.truncate(sig_len);
            Ok(sig)
        })();
        ssl::EVP_PKEY_free(pkey);
        if result.is_err() {
            ssl::ERR_clear_error();
        }
        result
    }
}

/// The `exp` claim of a compact JWT, without verifying it (we only need to
/// know when to refresh a token Google handed us).
pub fn unverified_exp(jwt: &[u8]) -> Option<u64> {
    let mut parts = bun_core::strings::split(jwt, b".");
    let _header = parts.next()?;
    let payload = parts.next()?;
    parts.next()?;
    let mut decoded = vec![0u8; bun_base64::decode_lenient_len(payload.len())];
    let n = bun_base64::decode_lenient(&mut decoded, payload, true);
    decoded.truncate(n);
    json::parse(&decoded, |o| o.number(b"exp"))
        .flatten()
        .filter(|e| e.is_finite() && *e > 0.0)
        .map(|e| e as u64)
}
