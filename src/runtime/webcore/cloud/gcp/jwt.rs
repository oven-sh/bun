//! Just enough JWT to talk to Google's OAuth token endpoint: build and
//! RS256-sign a service-account assertion, and read `exp` back out of an ID
//! token.

use std::io::Write as _;

use crate::webcore::cloud::json;

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

/// `header.claims` of a JWT, ready for [`sign_rs256`].
pub fn unsigned(key_id: Option<&[u8]>, claims: &Claims<'_>) -> Vec<u8> {
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
    token
}

/// `token` + `.signature`, RS256-signed with the PEM (PKCS#8 or PKCS#1) RSA
/// `private_key` from a service-account key file.
pub fn sign_rs256(
    private_key_pem: &[u8],
    mut token: Vec<u8>,
) -> Result<Vec<u8>, bun_boringssl::SignPemError> {
    let signature = bun_boringssl::sign_pem_rs256(private_key_pem, &token)?;
    token.push(b'.');
    b64url(&mut token, &signature);
    Ok(token)
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
