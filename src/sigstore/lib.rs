#![recursion_limit = "256"]
// ↑ `provenance::gitlab_statement` expands `zstr!` × ~75 inside `json!` —
//   the default limit (128) trips on the nested macro depth.

//! npm provenance via Sigstore keyless signing.
//!
//! Produces a Sigstore bundle (DSSE envelope + Fulcio cert + Rekor
//! transparency-log entry) matching what `sigstore-js` emits for
//! `sigstore.attest()`, which is what the npm CLI's `--provenance` flag
//! drives. The bundle is then attached to the registry PUT body alongside the
//! tarball (see `libnpmpublish/lib/publish.js`).
//!
//! We implement the protocol directly rather than depending on the
//! `sigstore` crate — see `Cargo.toml` for the why.
//!
//! Flow (ported from sigstore-js `DSSEBundleBuilder` + `FulcioSigner` +
//! `RekorWitness`, all Apache-2.0):
//!   1. Fetch an OIDC identity token from the CI environment.
//!   2. Generate an ephemeral ECDSA P-256 keypair; sign the token's subject
//!      claim as proof-of-possession.
//!   3. POST to Fulcio `/api/v2/signingCert` → short-lived signing cert.
//!   4. Wrap the caller's in-toto statement in a DSSE envelope, PAE-encode,
//!      sign with the ephemeral key.
//!   5. POST an `intoto` entry to Rekor `/api/v1/log/entries`.
//!   6. Assemble the serialized bundle JSON.

use std::io::Write as _;

use bun_core::{MutableString, Output, ZStr};
use bun_http as http;
use bun_http::HeaderBuilder;
use bun_url::URL;

use p256::ecdsa::{Signature, SigningKey, signature::Signer as _};
use p256::pkcs8::EncodePublicKey as _;

use serde::{Deserialize, Serialize};

pub mod provenance;

// ──────────────────────────────────────────────────────────────────────────
// Public entry point
// ──────────────────────────────────────────────────────────────────────────

/// A serialized Sigstore bundle plus the bits the caller needs to report
/// on / attach to the publish body.
pub struct Attestation {
    /// `application/vnd.dev.sigstore.bundle+json;version=0.2`
    pub media_type: &'static str,
    /// Serialized bundle JSON.
    pub bundle_json: Vec<u8>,
    /// `https://search.sigstore.dev/?logIndex=N` — for the user-facing notice.
    pub transparency_log_url: Option<String>,
}

/// Public-good Sigstore + npm defaults, matching sigstore-js and
/// `libnpmpublish/lib/provenance.js`. Overridable for testing against a
/// mock Fulcio/Rekor (e.g. a `Bun.serve` fixture) via the `BUN_SIGSTORE_*`
/// env vars.
pub struct Endpoints {
    pub fulcio_url: String,
    pub rekor_url: String,
    pub tlog_search_url: String,
    pub oidc_audience: String,
}

impl Endpoints {
    pub fn from_env() -> Self {
        let env = |key: &ZStr, default: &str| -> String {
            match bun_core::getenv_z(key) {
                Some(v) if !v.is_empty() => String::from_utf8_lossy(v).into_owned(),
                _ => default.to_owned(),
            }
        };
        Self {
            fulcio_url: env(
                bun_core::zstr!("BUN_SIGSTORE_FULCIO_URL"),
                DEFAULT_FULCIO_URL,
            ),
            rekor_url: env(bun_core::zstr!("BUN_SIGSTORE_REKOR_URL"), DEFAULT_REKOR_URL),
            tlog_search_url: env(
                bun_core::zstr!("BUN_SIGSTORE_TLOG_BASE_URL"),
                DEFAULT_TLOG_BASE_URL,
            ),
            oidc_audience: env(bun_core::zstr!("BUN_SIGSTORE_OIDC_AUDIENCE"), "sigstore"),
        }
    }
}

pub const DEFAULT_FULCIO_URL: &str = "https://fulcio.sigstore.dev";
pub const DEFAULT_REKOR_URL: &str = "https://rekor.sigstore.dev";
pub const DEFAULT_TLOG_BASE_URL: &str = "https://search.sigstore.dev/";

/// in-toto DSSE payload type — what npm passes to `sigstore.attest()`.
pub const INTOTO_PAYLOAD_TYPE: &str = "application/vnd.in-toto+json";

/// Sigstore bundle media type for the v0.2 wire format (uses
/// `x509CertificateChain` for verification material; npm accepts v0.2+).
const BUNDLE_V02_MEDIA_TYPE: &str = "application/vnd.dev.sigstore.bundle+json;version=0.2";

/// Sign an in-toto statement and produce a Sigstore bundle.
///
/// `payload` is the JSON-encoded in-toto statement (e.g. from
/// [`provenance::generate`]). The payload is *not* re-serialized — it is
/// embedded as-is in the DSSE envelope, so the caller controls the exact
/// byte representation the tlog records.
pub fn attest(payload: &[u8], endpoints: &Endpoints) -> Result<Attestation, SigstoreError> {
    // 1) OIDC identity token from CI.
    let id_token = fetch_identity_token(&endpoints.oidc_audience)?;
    let subject = extract_jwt_subject(&id_token)?;

    // 2) Ephemeral P-256 keypair + proof-of-possession (sign the subject).
    let signing_key = SigningKey::random(&mut rand_core::OsRng);
    let public_key_pem = signing_key
        .verifying_key()
        .to_public_key_pem(p256::pkcs8::LineEnding::LF)
        .map_err(|e| SigstoreError::Crypto(e.to_string()))?;
    let proof: Signature = signing_key.sign(subject.as_bytes());
    let proof_der = proof.to_der();

    // 3) Fulcio: exchange (token, pubkey, proof) → short-lived x509 cert chain.
    let cert_chain = fulcio_request_cert(
        &endpoints.fulcio_url,
        &id_token,
        &public_key_pem,
        proof_der.as_bytes(),
    )?;
    let leaf_cert_pem = cert_chain
        .first()
        .ok_or_else(|| SigstoreError::Fulcio("empty certificate chain".into()))?;
    let leaf_cert_der = pem_to_der(leaf_cert_pem)?;

    // 4) DSSE PAE-encode the in-toto payload, sign, build envelope.
    let pae = dsse_pre_auth_encoding(INTOTO_PAYLOAD_TYPE, payload);
    let dsse_sig: Signature = signing_key.sign(&pae);
    let dsse_sig_der = dsse_sig.to_der();

    let payload_b64 = b64_std(payload);
    let sig_b64 = b64_std(dsse_sig_der.as_bytes());

    // 5) Rekor: upload an intoto entry for the envelope.
    let cert_pem_b64 = b64_std(leaf_cert_pem.as_bytes());
    let tlog_entry = rekor_create_intoto_entry(
        &endpoints.rekor_url,
        INTOTO_PAYLOAD_TYPE,
        payload,
        &payload_b64,
        &sig_b64,
        leaf_cert_pem,
        &cert_pem_b64,
    )?;

    // 6) Assemble the serialized Sigstore bundle.
    let bundle = SerializedBundle {
        media_type: BUNDLE_V02_MEDIA_TYPE,
        verification_material: SerializedVerificationMaterial {
            x509_certificate_chain: SerializedX509Chain {
                certificates: vec![SerializedX509Cert {
                    raw_bytes: b64_std(&leaf_cert_der),
                }],
            },
            tlog_entries: vec![tlog_entry.clone()],
            timestamp_verification_data: SerializedTimestampVerificationData {
                rfc3161_timestamps: vec![],
            },
        },
        dsse_envelope: SerializedEnvelope {
            payload: payload_b64,
            payload_type: INTOTO_PAYLOAD_TYPE,
            signatures: vec![SerializedEnvelopeSignature {
                sig: sig_b64,
                keyid: "",
            }],
        },
    };

    let bundle_json =
        serde_json::to_vec(&bundle).map_err(|e| SigstoreError::Bundle(e.to_string()))?;

    let transparency_log_url = Some(format!(
        "{}?logIndex={}",
        endpoints.tlog_search_url.trim_end_matches('/').to_owned() + "/",
        tlog_entry.log_index,
    ));

    Ok(Attestation {
        media_type: BUNDLE_V02_MEDIA_TYPE,
        bundle_json,
        transparency_log_url,
    })
}

/// Result of [`load_and_verify_bundle`] — a pre-built bundle ready to be
/// attached to the publish body.
pub struct LoadedBundle {
    pub media_type: String,
    pub bundle_json: Vec<u8>,
}

/// `--provenance-file` path: read an externally-generated Sigstore bundle
/// from disk, check its DSSE-envelope subject matches the package being
/// published (name + sha512), and return it for attachment. Ported from
/// `libnpmpublish` `verifyProvenance` — npm additionally runs
/// `sigstore.verify()` over the bundle (chain + tlog); we do the subject
/// match only, leaving full verification to the registry.
pub fn load_and_verify_bundle(
    path: &[u8],
    expected_subject: &serde_json::Value,
) -> Result<LoadedBundle, SigstoreError> {
    let bytes = std::fs::read(String::from_utf8_lossy(path).as_ref())
        .map_err(|e| SigstoreError::Usage(format!("Invalid provenance provided: {e}")))?;

    let bundle: serde_json::Value = serde_json::from_slice(&bytes)
        .map_err(|e| SigstoreError::Usage(format!("Invalid provenance provided: {e}")))?;

    let payload_b64 = bundle
        .pointer("/dsseEnvelope/payload")
        .and_then(|v| v.as_str())
        .ok_or_else(|| {
            SigstoreError::Usage("No dsseEnvelope with payload found in sigstore bundle".into())
        })?;
    let payload = bun_base64::decode_alloc(payload_b64.as_bytes()).map_err(|_| {
        SigstoreError::Usage("Failed to parse payload from dsseEnvelope: bad base64".into())
    })?;
    let stmt: serde_json::Value = serde_json::from_slice(&payload).map_err(|e| {
        SigstoreError::Usage(format!("Failed to parse payload from dsseEnvelope: {e}"))
    })?;

    let subjects = stmt
        .get("subject")
        .and_then(|v| v.as_array())
        .filter(|a| !a.is_empty())
        .ok_or_else(|| {
            SigstoreError::Usage("No subject found in sigstore bundle payload".into())
        })?;
    if subjects.len() > 1 {
        return Err(SigstoreError::Usage(
            "Found more than one subject in the sigstore bundle payload".into(),
        ));
    }
    let got = &subjects[0];
    let want = &expected_subject[0];

    let got_name = got.get("name").and_then(|v| v.as_str()).unwrap_or("");
    let want_name = want.get("name").and_then(|v| v.as_str()).unwrap_or("");
    if got_name != want_name {
        return Err(SigstoreError::Usage(format!(
            "Provenance subject {got_name} does not match the package: {want_name}"
        )));
    }
    let got_digest = got.pointer("/digest/sha512").and_then(|v| v.as_str());
    let want_digest = want.pointer("/digest/sha512").and_then(|v| v.as_str());
    if got_digest != want_digest {
        return Err(SigstoreError::Usage(
            "Provenance subject digest does not match the package".into(),
        ));
    }

    let media_type = bundle
        .get("mediaType")
        .and_then(|v| v.as_str())
        .unwrap_or(BUNDLE_V02_MEDIA_TYPE)
        .to_owned();

    Ok(LoadedBundle {
        media_type,
        bundle_json: bytes,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// OIDC identity — sigstore-js `CIContextProvider`
// ──────────────────────────────────────────────────────────────────────────

fn env(key: &ZStr) -> Option<&'static [u8]> {
    bun_core::getenv_z(key).filter(|v| !v.is_empty())
}

/// Which CI provider supplies the OIDC token. Drives the SLSA predicate
/// shape and the preflight error messages (matching npm's wording).
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum CiProvider {
    GithubActions,
    GitlabCi,
}

impl CiProvider {
    /// Detect the provider from the environment, mirroring npm's
    /// `ci-info` checks used in `libnpmpublish/lib/provenance.js`.
    pub fn detect() -> Option<Self> {
        if env(bun_core::zstr!("GITHUB_ACTIONS")).is_some() {
            Some(Self::GithubActions)
        } else if env(bun_core::zstr!("GITLAB_CI")).is_some() {
            Some(Self::GitlabCi)
        } else {
            None
        }
    }

    pub fn display_name(self) -> &'static str {
        match self {
            Self::GithubActions => "GitHub Actions",
            Self::GitlabCi => "GitLab CI",
        }
    }
}

/// Preflight checks ported from `libnpmpublish` `ensureProvenanceGeneration`
/// — surfaces a precise error *before* we start talking to Fulcio.
pub fn ensure_provenance_generation() -> Result<CiProvider, SigstoreError> {
    match CiProvider::detect() {
        Some(CiProvider::GithubActions) => {
            if env(bun_core::zstr!("ACTIONS_ID_TOKEN_REQUEST_URL")).is_none() {
                return Err(SigstoreError::Usage(
                    "Provenance generation in GitHub Actions requires \"write\" access to the \
                     \"id-token\" permission"
                        .into(),
                ));
            }
            Ok(CiProvider::GithubActions)
        }
        Some(CiProvider::GitlabCi) => {
            if env(bun_core::zstr!("SIGSTORE_ID_TOKEN")).is_none() {
                return Err(SigstoreError::Usage(
                    "Provenance generation in GitLab CI requires \"SIGSTORE_ID_TOKEN\" with \
                     \"sigstore\" audience to be present in \"id_tokens\". For more info see:\n\
                     https://docs.gitlab.com/ee/ci/secrets/id_token_authentication.html"
                        .into(),
                ));
            }
            Ok(CiProvider::GitlabCi)
        }
        None => Err(SigstoreError::Usage(
            "Automatic provenance generation not supported outside of GitHub Actions or \
             GitLab CI"
                .into(),
        )),
    }
}

fn fetch_identity_token(audience: &str) -> Result<String, SigstoreError> {
    // cosign-compatible env override — also how GitLab supplies its token.
    if let Some(tok) = env(bun_core::zstr!("SIGSTORE_ID_TOKEN")) {
        return Ok(String::from_utf8_lossy(tok).into_owned());
    }

    // GitHub Actions: GET $ACTIONS_ID_TOKEN_REQUEST_URL&audience=sigstore with
    // `Authorization: Bearer $ACTIONS_ID_TOKEN_REQUEST_TOKEN`.
    let (req_url, req_tok) = match (
        env(bun_core::zstr!("ACTIONS_ID_TOKEN_REQUEST_URL")),
        env(bun_core::zstr!("ACTIONS_ID_TOKEN_REQUEST_TOKEN")),
    ) {
        (Some(u), Some(t)) => (u, t),
        _ => {
            return Err(SigstoreError::Identity(
                "no OIDC token available — set SIGSTORE_ID_TOKEN or run in GitHub Actions with \
                 `id-token: write` permission"
                    .into(),
            ));
        }
    };

    let mut url = String::from_utf8_lossy(req_url).into_owned();
    let sep = if url.contains('?') { '&' } else { '?' };
    url.push(sep);
    url.push_str("audience=");
    url.push_str(audience);

    let mut auth = Vec::with_capacity(7 + req_tok.len());
    auth.extend_from_slice(b"Bearer ");
    auth.extend_from_slice(req_tok);

    let body = http_json(
        http::Method::GET,
        &url,
        &[(b"Accept", b"application/json"), (b"Authorization", &auth)],
        b"",
        "GitHub Actions OIDC",
    )?;

    #[derive(Deserialize)]
    struct Resp {
        value: String,
    }
    let r: Resp = serde_json::from_slice(&body)
        .map_err(|e| SigstoreError::Identity(format!("malformed OIDC response: {e}")))?;
    Ok(r.value)
}

/// Extract the subject to sign as proof-of-possession — sigstore-js
/// `oidc.extractJWTSubject`: `email` (if verified) else `sub`.
fn extract_jwt_subject(jwt: &str) -> Result<String, SigstoreError> {
    let mut parts = jwt.splitn(3, '.');
    let (_h, payload) = (parts.next(), parts.next());
    let payload = payload.ok_or_else(|| SigstoreError::Identity("malformed JWT".into()))?;
    let decoded = bun_base64::decode_alloc(payload.as_bytes())
        .map_err(|_| SigstoreError::Identity("malformed JWT: bad base64".into()))?;

    #[derive(Deserialize)]
    struct Claims {
        #[serde(default)]
        sub: Option<String>,
        #[serde(default)]
        email: Option<String>,
        #[serde(default)]
        email_verified: Option<bool>,
    }
    let c: Claims = serde_json::from_slice(&decoded)
        .map_err(|e| SigstoreError::Identity(format!("malformed JWT claims: {e}")))?;

    if let Some(email) = c.email.filter(|e| !e.is_empty()) {
        if c.email_verified != Some(true) {
            return Err(SigstoreError::Identity(
                "JWT email not verified by issuer".into(),
            ));
        }
        return Ok(email);
    }
    c.sub
        .filter(|s| !s.is_empty())
        .ok_or_else(|| SigstoreError::Identity("JWT subject not found".into()))
}

// ──────────────────────────────────────────────────────────────────────────
// Fulcio — sigstore-js `CAClient` / `external/fulcio.ts`
// ──────────────────────────────────────────────────────────────────────────

fn fulcio_request_cert(
    base_url: &str,
    id_token: &str,
    public_key_pem: &str,
    proof_of_possession: &[u8],
) -> Result<Vec<String>, SigstoreError> {
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Credentials<'a> {
        oidc_identity_token: &'a str,
    }
    #[derive(Serialize)]
    struct PublicKey<'a> {
        algorithm: &'a str,
        content: &'a str,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct PublicKeyRequest<'a> {
        public_key: PublicKey<'a>,
        proof_of_possession: String,
    }
    #[derive(Serialize)]
    #[serde(rename_all = "camelCase")]
    struct Req<'a> {
        credentials: Credentials<'a>,
        public_key_request: PublicKeyRequest<'a>,
    }

    let req = Req {
        credentials: Credentials {
            oidc_identity_token: id_token,
        },
        public_key_request: PublicKeyRequest {
            public_key: PublicKey {
                algorithm: "ECDSA",
                content: public_key_pem,
            },
            proof_of_possession: b64_std(proof_of_possession),
        },
    };
    let req_body = serde_json::to_vec(&req).map_err(|e| SigstoreError::Fulcio(e.to_string()))?;

    let url = format!("{}/api/v2/signingCert", base_url.trim_end_matches('/'));
    let body = http_json(
        http::Method::POST,
        &url,
        &[
            (b"Content-Type", b"application/json"),
            (b"Accept", b"application/json"),
        ],
        &req_body,
        "Fulcio",
    )?;

    #[derive(Deserialize)]
    struct Chain {
        certificates: Vec<String>,
    }
    #[derive(Deserialize)]
    struct Signed {
        chain: Chain,
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Resp {
        #[serde(default)]
        signed_certificate_embedded_sct: Option<Signed>,
        #[serde(default)]
        signed_certificate_detached_sct: Option<Signed>,
    }
    let r: Resp = serde_json::from_slice(&body)
        .map_err(|e| SigstoreError::Fulcio(format!("malformed response: {e}")))?;
    let chain = r
        .signed_certificate_embedded_sct
        .or(r.signed_certificate_detached_sct)
        .ok_or_else(|| SigstoreError::Fulcio("no certificate in response".into()))?
        .chain
        .certificates;
    if chain.is_empty() {
        return Err(SigstoreError::Fulcio("empty certificate chain".into()));
    }
    Ok(chain)
}

// ──────────────────────────────────────────────────────────────────────────
// Rekor — sigstore-js `toProposedIntotoEntry` + `TLogClient`
// ──────────────────────────────────────────────────────────────────────────

/// Build the Rekor `intoto` v0.0.2 proposed entry, POST it, and convert the
/// response into the serialized `tlogEntries[0]` object the bundle carries.
///
/// We use the legacy `intoto` kind (not `dsse`) — npm still submits `intoto`
/// by default via sigstore-js's `entryType: 'intoto'`, and the npm registry
/// accepts either, so matching keeps the bundle byte-for-byte diffable
/// against `npm publish --provenance` output.
#[allow(clippy::too_many_arguments)]
fn rekor_create_intoto_entry(
    base_url: &str,
    payload_type: &str,
    payload: &[u8],
    payload_b64: &str,
    sig_b64: &str,
    cert_pem: &str,
    cert_pem_b64: &str,
) -> Result<SerializedTlogEntry, SigstoreError> {
    let payload_hash_hex = hex(&sha256(payload));

    // Rekor's canonical DSSE-envelope hash — sigstore-js `calculateDSSEHash`:
    // JSON-canonicalize `{payloadType,payload:b64,signatures:[{sig:b64,publicKey:<PEM>}]}`
    // (keyid omitted when empty) and SHA-256 it. With no optional fields the
    // key-sorted form is fixed, so a hand-written template suffices; keep it
    // in sync if a `keyid` is ever threaded through here.
    let canon = format!(
        r#"{{"payload":{},"payloadType":{},"signatures":[{{"publicKey":{},"sig":{}}}]}}"#,
        json_str(payload_b64),
        json_str(payload_type),
        json_str(cert_pem),
        json_str(sig_b64),
    );
    let envelope_hash_hex = hex(&sha256(canon.as_bytes()));

    // Rekor double-base64-encodes payload and signature in the intoto entry.
    let payload_b64_b64 = b64_std(payload_b64.as_bytes());
    let sig_b64_b64 = b64_std(sig_b64.as_bytes());

    let proposed = serde_json::json!({
        "apiVersion": "0.0.2",
        "kind": "intoto",
        "spec": {
            "content": {
                "envelope": {
                    "payloadType": payload_type,
                    "payload": payload_b64_b64,
                    "signatures": [
                        { "sig": sig_b64_b64, "publicKey": cert_pem_b64 }
                    ],
                },
                "hash":        { "algorithm": "sha256", "value": envelope_hash_hex },
                "payloadHash": { "algorithm": "sha256", "value": payload_hash_hex },
            },
        },
    });
    let req_body =
        serde_json::to_vec(&proposed).map_err(|e| SigstoreError::Rekor(e.to_string()))?;

    let url = format!("{}/api/v1/log/entries", base_url.trim_end_matches('/'));
    let body = http_json(
        http::Method::POST,
        &url,
        &[
            (b"Content-Type", b"application/json"),
            (b"Accept", b"application/json"),
        ],
        &req_body,
        "Rekor",
    )?;

    // Response is `{ "<uuid>": { body, integratedTime, logID, logIndex, verification: {...} } }`.
    let entries: serde_json::Map<String, serde_json::Value> = serde_json::from_slice(&body)
        .map_err(|e| SigstoreError::Rekor(format!("malformed response: {e}")))?;
    let (_uuid, entry) = entries
        .into_iter()
        .next()
        .ok_or_else(|| SigstoreError::Rekor("empty response".into()))?;

    rekor_entry_to_tlog(&entry)
}

fn rekor_entry_to_tlog(e: &serde_json::Value) -> Result<SerializedTlogEntry, SigstoreError> {
    let get_str = |k: &str| -> Result<String, SigstoreError> {
        e.get(k)
            .and_then(|v| v.as_str())
            .map(|s| s.to_owned())
            .ok_or_else(|| SigstoreError::Rekor(format!("missing `{k}`")))
    };
    let get_i64 = |k: &str| -> Result<i64, SigstoreError> {
        e.get(k)
            .and_then(|v| v.as_i64())
            .ok_or_else(|| SigstoreError::Rekor(format!("missing `{k}`")))
    };

    let body_b64 = get_str("body")?;
    let body_json = bun_base64::decode_alloc(body_b64.as_bytes())
        .map_err(|_| SigstoreError::Rekor("bad base64 in `body`".into()))?;
    #[derive(Deserialize)]
    struct KindVersion {
        kind: String,
        #[serde(rename = "apiVersion")]
        api_version: String,
    }
    let kv: KindVersion = serde_json::from_slice(&body_json)
        .map_err(|e| SigstoreError::Rekor(format!("bad `body` JSON: {e}")))?;

    let log_id_hex = get_str("logID")?;
    let log_id_raw =
        hex_decode(&log_id_hex).ok_or_else(|| SigstoreError::Rekor("bad hex in `logID`".into()))?;

    let verification = e.get("verification");
    let inclusion_promise = verification
        .and_then(|v| v.get("signedEntryTimestamp"))
        .and_then(|v| v.as_str())
        .map(|s| SerializedInclusionPromise {
            // Already base64 in the Rekor response — pass through as-is.
            signed_entry_timestamp: s.to_owned(),
        });

    let inclusion_proof = verification
        .and_then(|v| v.get("inclusionProof"))
        .and_then(|p| {
            Some(SerializedInclusionProof {
                log_index: p.get("logIndex")?.as_i64()?.to_string(),
                root_hash: b64_std(&hex_decode(p.get("rootHash")?.as_str()?)?),
                tree_size: p.get("treeSize")?.as_i64()?.to_string(),
                hashes: p
                    .get("hashes")?
                    .as_array()?
                    .iter()
                    .filter_map(|h| Some(b64_std(&hex_decode(h.as_str()?)?)))
                    .collect(),
                checkpoint: SerializedCheckpoint {
                    envelope: p.get("checkpoint")?.as_str()?.to_owned(),
                },
            })
        });

    Ok(SerializedTlogEntry {
        log_index: get_i64("logIndex")?.to_string(),
        log_id: SerializedLogId {
            key_id: b64_std(&log_id_raw),
        },
        kind_version: SerializedKindVersion {
            kind: kv.kind,
            version: kv.api_version,
        },
        integrated_time: get_i64("integratedTime")?.to_string(),
        inclusion_promise,
        inclusion_proof,
        canonicalized_body: body_b64,
    })
}

// ──────────────────────────────────────────────────────────────────────────
// DSSE helpers
// ──────────────────────────────────────────────────────────────────────────

/// DSSE Pre-Authentication Encoding:
/// `"DSSEv1" SP len(type) SP type SP len(body) SP body`.
fn dsse_pre_auth_encoding(payload_type: &str, payload: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(64 + payload_type.len() + payload.len());
    write!(
        &mut out,
        "DSSEv1 {} {} {} ",
        payload_type.len(),
        payload_type,
        payload.len()
    )
    .ok();
    out.extend_from_slice(payload);
    out
}

// ──────────────────────────────────────────────────────────────────────────
// Serialized Sigstore bundle — mirrors sigstore-js `SerializedBundle`
// ──────────────────────────────────────────────────────────────────────────

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializedBundle<'a> {
    media_type: &'a str,
    verification_material: SerializedVerificationMaterial,
    dsse_envelope: SerializedEnvelope<'a>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializedVerificationMaterial {
    x509_certificate_chain: SerializedX509Chain,
    tlog_entries: Vec<SerializedTlogEntry>,
    timestamp_verification_data: SerializedTimestampVerificationData,
}

#[derive(Serialize)]
struct SerializedX509Chain {
    certificates: Vec<SerializedX509Cert>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializedX509Cert {
    raw_bytes: String,
}

#[derive(Serialize)]
struct SerializedTimestampVerificationData {
    #[serde(rename = "rfc3161Timestamps")]
    rfc3161_timestamps: Vec<()>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SerializedTlogEntry {
    log_index: String,
    log_id: SerializedLogId,
    kind_version: SerializedKindVersion,
    integrated_time: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    inclusion_promise: Option<SerializedInclusionPromise>,
    #[serde(skip_serializing_if = "Option::is_none")]
    inclusion_proof: Option<SerializedInclusionProof>,
    canonicalized_body: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SerializedLogId {
    key_id: String,
}

#[derive(Serialize, Clone)]
struct SerializedKindVersion {
    kind: String,
    version: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SerializedInclusionPromise {
    signed_entry_timestamp: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct SerializedInclusionProof {
    log_index: String,
    root_hash: String,
    tree_size: String,
    hashes: Vec<String>,
    checkpoint: SerializedCheckpoint,
}

#[derive(Serialize, Clone)]
struct SerializedCheckpoint {
    envelope: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SerializedEnvelope<'a> {
    payload: String,
    payload_type: &'a str,
    signatures: Vec<SerializedEnvelopeSignature<'a>>,
}

#[derive(Serialize)]
struct SerializedEnvelopeSignature<'a> {
    sig: String,
    keyid: &'a str,
}

// ──────────────────────────────────────────────────────────────────────────
// HTTP plumbing over `bun_http::AsyncHTTP`
// ──────────────────────────────────────────────────────────────────────────

/// One-shot synchronous JSON request. `publish`-style: build a
/// `HeaderBuilder`, drive `AsyncHTTP::init_sync` + `send_sync`. Returns the
/// raw response body on 2xx, or a `SigstoreError::{who}` otherwise.
///
/// All borrowed inputs to `init_sync` must outlive the request; since
/// `AsyncHTTP<'a>` ties everything to a single lifetime (including its own
/// `URL` parse), and CLI-path callers in this repo satisfy that with
/// process-lifetime leaks (`cli_dupe`/`cli_adopt`), we do the same here via
/// `Box::leak` — the number of calls per `bun publish --provenance` is
/// fixed (≤3), and the buffers are small.
fn http_json(
    method: http::Method,
    url: &str,
    headers: &[(&[u8], &[u8])],
    body: &[u8],
    who: &'static str,
) -> Result<Vec<u8>, SigstoreError> {
    let url_static: &'static [u8] = Box::leak(url.as_bytes().to_vec().into_boxed_slice());
    let body_static: &'static [u8] = if body.is_empty() {
        b""
    } else {
        Box::leak(body.to_vec().into_boxed_slice())
    };

    let parsed_url = URL::parse(url_static);
    let host = parsed_url.host;

    let mut hb = HeaderBuilder::default();
    for (k, v) in headers {
        hb.count(k, v);
    }
    hb.count(b"User-Agent", user_agent());
    hb.count(b"Connection", b"keep-alive");
    hb.count(b"Host", host);
    let len_s; // keep alive across count+append
    if !body_static.is_empty() {
        len_s = body_static.len().to_string();
        hb.count(b"Content-Length", len_s.as_bytes());
    } else {
        len_s = String::new();
    }
    hb.allocate().map_err(|_| SigstoreError::OutOfMemory)?;
    for (k, v) in headers {
        hb.append(k, v);
    }
    hb.append(b"User-Agent", user_agent());
    hb.append(b"Connection", b"keep-alive");
    hb.append(b"Host", host);
    if !body_static.is_empty() {
        hb.append(b"Content-Length", len_s.as_bytes());
    }

    // HeaderBuilder owns its backing buffer; leak it so the `&'a [u8]` the
    // client holds remains valid for the (synchronous) request lifetime.
    let hb = Box::leak(Box::new(hb));

    let mut response_buf = MutableString::init(1024).map_err(|_| SigstoreError::OutOfMemory)?;

    let mut req = http::AsyncHTTP::init_sync(
        method,
        parsed_url,
        hb.entries.clone().map_err(|_| SigstoreError::OutOfMemory)?,
        hb.content.written_slice(),
        &raw mut response_buf,
        body_static,
        None,
        None,
        http::FetchRedirect::Follow,
    );

    let res = req.send_sync().map_err(|e| SigstoreError::Http {
        who,
        detail: format!("{e}"),
    })?;

    if res.status_code >= 400 || res.status_code == 0 {
        let body_preview = String::from_utf8_lossy(&response_buf.list);
        let body_preview: String = body_preview.chars().take(512).collect();
        return Err(SigstoreError::Http {
            who,
            detail: format!("HTTP {}: {}", res.status_code, body_preview),
        });
    }

    Ok(std::mem::take(&mut response_buf.list))
}

fn user_agent() -> &'static [u8] {
    static UA: std::sync::OnceLock<Vec<u8>> = std::sync::OnceLock::new();
    UA.get_or_init(|| format!("bun/{}", bun_core::Global::package_json_version).into_bytes())
}

// ──────────────────────────────────────────────────────────────────────────
// Misc small helpers
// ──────────────────────────────────────────────────────────────────────────

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut out = [0u8; 32];
    bun_sha_hmac::sha::hashers::SHA256::hash(data, &mut out);
    out
}

fn hex(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut s = String::with_capacity(bytes.len() * 2);
    for &b in bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0xF) as usize] as char);
    }
    s
}

fn hex_decode(s: &str) -> Option<Vec<u8>> {
    let s = s.as_bytes();
    if s.len() % 2 != 0 {
        return None;
    }
    let nyb = |c: u8| -> Option<u8> {
        match c {
            b'0'..=b'9' => Some(c - b'0'),
            b'a'..=b'f' => Some(c - b'a' + 10),
            b'A'..=b'F' => Some(c - b'A' + 10),
            _ => None,
        }
    };
    let mut out = Vec::with_capacity(s.len() / 2);
    for pair in s.chunks_exact(2) {
        out.push((nyb(pair[0])? << 4) | nyb(pair[1])?);
    }
    Some(out)
}

/// Standard (padded, `+`/`/`) base64 — what every base64 field in the
/// Sigstore bundle and Fulcio/Rekor APIs uses.
fn b64_std(data: &[u8]) -> String {
    // `bun_base64::encode_alloc` returns `Vec<u8>` of ASCII — safe to
    // reinterpret as UTF-8.
    String::from_utf8(bun_base64::encode_alloc(data)).expect("base64 is ASCII")
}

/// JSON string literal for embedding in a hand-written canonical template.
fn json_str(s: &str) -> String {
    serde_json::to_string(s).expect("string always serializes")
}

/// Extract the DER body from a single-block PEM. We deliberately avoid
/// pulling in the `pem` crate for one call site.
fn pem_to_der(pem: &str) -> Result<Vec<u8>, SigstoreError> {
    let mut body = String::new();
    let mut in_block = false;
    for line in pem.lines() {
        let line = line.trim();
        if line.starts_with("-----BEGIN ") {
            in_block = true;
            continue;
        }
        if line.starts_with("-----END ") {
            break;
        }
        if in_block {
            body.push_str(line);
        }
    }
    if body.is_empty() {
        return Err(SigstoreError::Fulcio("malformed PEM certificate".into()));
    }
    bun_base64::decode_alloc(body.as_bytes())
        .map_err(|_| SigstoreError::Fulcio("malformed PEM base64".into()))
}

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

#[derive(thiserror::Error, Debug)]
pub enum SigstoreError {
    #[error("OutOfMemory")]
    OutOfMemory,
    /// User-facing precondition failures (npm's `EUSAGE`).
    #[error("{0}")]
    Usage(String),
    #[error("identity token: {0}")]
    Identity(String),
    #[error("crypto: {0}")]
    Crypto(String),
    #[error("Fulcio: {0}")]
    Fulcio(String),
    #[error("Rekor: {0}")]
    Rekor(String),
    #[error("bundle: {0}")]
    Bundle(String),
    #[error("{who}: {detail}")]
    Http { who: &'static str, detail: String },
}

impl SigstoreError {
    /// Print in the repo's `Output::err` style and return — callers on the
    /// publish path then `Global::crash()`.
    pub fn print(&self) {
        match self {
            SigstoreError::Usage(msg) => {
                // Flag-agnostic prefix: `Usage` errors come from both the
                // `--provenance` preflight and `--provenance-file` bundle
                // validation (which are mutually exclusive), as well as the
                // implicit `NPM_CONFIG_PROVENANCE` / `publishConfig` paths.
                Output::err_generic("provenance: {}", (msg.as_str(),));
            }
            other => {
                Output::err_generic(
                    "failed to generate provenance: {}",
                    (format!("{other}").as_str(),),
                );
            }
        }
    }
}
