use std::collections::BTreeSet;

use bun_jsc::bun_string_jsc::parse_date;
use bun_sha_hmac::sha::evp::SHA256;
use bun_web::net::NetError;

use super::Session;
use crate::prelude::*;
use crate::realm::{self, Module};
use crate::text::{base64, split};
use crate::value::Value;
use crate::webview::wire;

pub(super) const VERIFY: &str = "setCertificateVerifyProc";

fn tls() -> JsResult<JSValue> {
    realm::require(global(), Module::Tls)
}

/// A root is its own issuer.
fn issuer_of(certificate: JSValue) -> JsResult<Option<JSValue>> {
    Ok(Some(get(certificate, "issuerCertificate")?)
        .filter(|it| it.is_object() && *it != certificate))
}

fn encoded(certificate: JSValue) -> JsResult<Option<Vec<u8>>> {
    Ok(get(certificate, "raw")?
        .as_array_buffer(global())
        .map(|it| it.byte_slice().to_vec()))
}

state!(fn bundled() -> RefCell<BTreeSet<String>>);

fn has_known_root(mut certificate: JSValue) -> JsResult<bool> {
    while let Some(issuer) = issuer_of(certificate)? {
        certificate = issuer;
    }
    if bundled().borrow().is_empty() {
        let body = |it: String| {
            split(&it, "-----")
                .nth(2)
                .unwrap_or_default()
                .split_whitespace()
                .collect()
        };
        bundled().replace(
            texts_of(get(tls()?, "rootCertificates")?)?
                .into_iter()
                .map(body)
                .collect(),
        );
    }
    Ok(bundled()
        .borrow()
        .contains(&base64(&encoded(certificate)?.unwrap_or_default())))
}

fn principal(it: &Value) -> Value {
    let all = |it: &Value| {
        if it.is_list() {
            it.clone()
        } else {
            it.as_text().map(Value::from).into_iter().collect()
        }
    };
    record! {
        "commonName": it["CN"].text(),
        "organizations": all(&it["O"]),
        "organizationUnits": all(&it["OU"]),
        "locality": it["L"].text(),
        "state": it["ST"].text(),
        "country": it["C"].text(),
    }
}

/// `certificate` is as `getPeerCertificate()` has it.
pub(super) fn describe(certificate: JSValue) -> JsResult<Value> {
    let (raw, mut digest) = (encoded(certificate)?.unwrap_or_default(), [0; 32]);
    SHA256::hash(&raw, &mut digest);
    let lines = base64(&raw)
        .as_bytes()
        .chunks(64)
        .map(string)
        .collect::<Vec<_>>()
        .join("\n");
    let data = |name| wire::data_from_js(get(certificate, name)?);
    let seconds = |name| {
        JsResult::Ok(
            parse_date(&get(certificate, name)?.to_bun_string(global())?, global())? / 1000.,
        )
    };
    let (issuer, subject) = (data("issuer")?, data("subject")?);
    let of_issuer = match issuer_of(certificate)? {
        Some(issuer) if encoded(issuer)?.is_some() => describe(issuer)?,
        _ => Value::Undefined,
    };
    Ok(record! {
        "data": format!("-----BEGIN CERTIFICATE-----\n{lines}\n-----END CERTIFICATE-----\n"),
        "fingerprint": format!("sha256/{}", base64(&digest)),
        "issuer": principal(&issuer),
        "issuerName": issuer["CN"].text(),
        "issuerCert": of_issuer,
        "subject": principal(&subject),
        "subjectName": subject["CN"].text(),
        "serialNumber": data("serialNumber")?,
        "validStart": seconds("valid_from")?,
        "validExpiry": seconds("valid_to")?,
    })
}

/// In the PEM format.
pub(super) fn authorities() -> JsResult<Vec<String>> {
    let of = |store| texts_of(invoke(tls()?, "getCACertificates", &[js(store)?])?);
    Ok([of("default")?, of("system")?].concat())
}

impl Session {
    pub(super) fn ask_to_verify(
        &self,
        hostname: JSValue,
        peer: JSValue,
        problem: Option<NetError>,
        callback: JSValue,
    ) -> JsResult<()> {
        let Some(verify) = self.handler(VERIFY)? else {
            return call(callback, &[(-3).into()]).map(drop);
        };
        let certificate = js(&describe(peer)?)?;
        let request = object!({
            "hostname": hostname,
            "certificate": certificate,
            "validatedCertificate": certificate,
            "isIssuedByKnownRoot": has_known_root(peer)?,
            "verificationResult": problem.map_or("net::OK", NetError::message),
            "errorCode": problem.map_or(0, |it| it as i32),
        });
        call(verify, &[request, callback]).map(drop)
    }
}
