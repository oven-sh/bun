//! Generic AWS Signature Version 4 signer (header and query-string forms) for
//! any service. `credentials.rs` keeps the S3-specialised fast path; this is
//! what `fetch(url, { aws })`, `Bun.aws.sign/presign` and STS AssumeRole use.
//!
//! <https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html>

use std::io::Write as _;

use bstr::BStr;
use bun_core::fmt::hex_lower;
use bun_core::strings;
use bun_sha_hmac::hmac::EVP_MAX_MD_SIZE;
use bun_sha_hmac::sha::hashers::SHA256;

use crate::credentials::SignError;

pub const UNSIGNED_PAYLOAD: &[u8] = b"UNSIGNED-PAYLOAD";
pub const EMPTY_SHA256: &[u8] = b"e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
/// Presigned URLs are valid for at most seven days.
pub const MAX_PRESIGN_EXPIRES: u32 = 604_800;

#[derive(Clone, Copy)]
pub struct Credentials<'a> {
    pub access_key_id: &'a [u8],
    pub secret_access_key: &'a [u8],
    pub session_token: Option<&'a [u8]>,
}

#[derive(Clone, Copy)]
pub enum Payload<'a> {
    /// Hash these bytes.
    Bytes(&'a [u8]),
    /// `UNSIGNED-PAYLOAD` (S3-family services only).
    Unsigned,
    /// Caller already has the lowercase hex SHA-256.
    Sha256Hex(&'a [u8]),
}

#[derive(Clone, Copy)]
pub struct Scope<'a> {
    pub service: &'a [u8],
    pub region: &'a [u8],
}

pub struct Request<'a> {
    pub method: &'a [u8],
    /// `Host` header value: hostname plus `:port` when non-default.
    pub host: &'a [u8],
    /// Path exactly as it will be sent (already percent-encoded), no query.
    pub path: &'a [u8],
    /// Raw query string without the leading `?`.
    pub query: &'a [u8],
    /// Headers to sign besides `host` / `x-amz-*` that the signer adds. Names
    /// in any case; values as they will be sent.
    pub headers: &'a [(&'a [u8], &'a [u8])],
    pub payload: Payload<'a>,
    pub scope: Scope<'a>,
    /// `YYYYMMDDTHHMMSSZ`; `None` = now.
    pub datetime: Option<[u8; 16]>,
    /// S3 (and S3-compatible) paths are encoded once and not normalised;
    /// every other service double-encodes. `None` picks by service name.
    pub s3_path_semantics: Option<bool>,
}

/// Headers to add to the request.
pub struct SignedRequest {
    pub authorization: Box<[u8]>,
    pub amz_date: [u8; 16],
    /// Signed (and so must be sent) only when `send_content_sha256`.
    pub content_sha256: Box<[u8]>,
    pub send_content_sha256: bool,
}

pub struct PresignedUrl {
    pub url: Box<[u8]>,
}

pub fn is_s3_service(service: &[u8]) -> bool {
    matches!(
        service,
        b"s3" | b"s3-object-lambda" | b"s3-outposts" | b"s3express"
    )
}

pub fn amz_datetime_now() -> [u8; 16] {
    let secs = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);
    amz_datetime(secs)
}

pub fn amz_datetime(epoch_secs: u64) -> [u8; 16] {
    let (year, month, day, hours, minutes, seconds, _) =
        crate::credentials::epoch_to_utc_components(epoch_secs);
    let mut out = [0u8; 16];
    let _ = bun_core::fmt::buf_print(
        &mut out,
        format_args!("{year:04}{month:02}{day:02}T{hours:02}{minutes:02}{seconds:02}Z"),
    );
    out
}

/// Parses `YYYYMMDDTHHMMSSZ` / ISO-8601 `YYYY-MM-DDTHH:MM:SS(.fff)Z` into
/// epoch seconds. Credential documents (IMDS, ECS, STS, SSO,
/// credential_process) all use the ISO form for `Expiration`.
pub fn parse_iso8601(s: &[u8]) -> Option<u64> {
    let digits = |r: core::ops::Range<usize>| -> Option<u64> {
        let part = s.get(r)?;
        if part.iter().all(u8::is_ascii_digit) {
            core::str::from_utf8(part).ok()?.parse().ok()
        } else {
            None
        }
    };
    let (y, mo, d, h, mi, se);
    // Seconds east of UTC (subtracted at the end).
    let mut offset: i64 = 0;
    if s.len() >= 16 && s[8] == b'T' && s[4] != b'-' {
        y = digits(0..4)?;
        mo = digits(4..6)?;
        d = digits(6..8)?;
        h = digits(9..11)?;
        mi = digits(11..13)?;
        se = digits(13..15)?;
    } else if s.len() >= 19 && s[4] == b'-' && (s[10] == b'T' || s[10] == b' ') {
        y = digits(0..4)?;
        mo = digits(5..7)?;
        d = digits(8..10)?;
        h = digits(11..13)?;
        mi = digits(14..16)?;
        se = digits(17..19)?;
        // Optional fractional seconds, then `Z`, `+HH:MM` or `+HHMM`.
        let mut rest = &s[19..];
        if let [b'.', tail @ ..] = rest {
            let n = tail.iter().take_while(|b| b.is_ascii_digit()).count();
            rest = &tail[n..];
        }
        offset = match rest {
            [] | [b'Z'] | [b'z'] => 0,
            [sign @ (b'+' | b'-'), tail @ ..]
                if (tail.len() == 5 && tail[2] == b':') || tail.len() == 4 =>
            {
                let two = |d: &[u8]| match d {
                    [a @ b'0'..=b'9', b @ b'0'..=b'9'] => {
                        Some(i64::from(a - b'0') * 10 + i64::from(b - b'0'))
                    }
                    _ => None,
                };
                let (oh, om) = (two(&tail[..2])?, two(&tail[tail.len() - 2..])?);
                if oh > 23 || om > 59 {
                    return None;
                }
                let secs = oh * 3600 + om * 60;
                if *sign == b'+' { secs } else { -secs }
            }
            _ => return None,
        };
    } else {
        return None;
    }
    if !(1..=12).contains(&mo) || !(1..=31).contains(&d) || h > 23 || mi > 59 || se > 60 {
        return None;
    }
    let utc = days_from_civil(y, mo, d)? * 86_400 + h * 3600 + mi * 60 + se;
    utc.checked_add_signed(-offset)
}

// Howard Hinnant's `days_from_civil`, restricted to years >= 1970.
fn days_from_civil(y: u64, m: u64, d: u64) -> Option<u64> {
    if y < 1970 {
        return None;
    }
    let y = i64::try_from(y).ok()? - i64::from(m <= 2);
    let era = y.div_euclid(400);
    let yoe = (y - era * 400) as u64;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + i64::try_from(doe).ok()? - 719_468;
    u64::try_from(days).ok()
}

/// Best-effort `(service, region)` from an endpoint hostname. Either part is
/// `None` when it cannot be told from the name. `service` is the SigV4
/// *signing name*, which for a few services differs from the hostname label.
pub fn infer_service_region(host: &[u8]) -> (Option<Box<[u8]>>, Option<Box<[u8]>>) {
    let host = match strings::last_index_of_char(host, b':') {
        Some(i) if !host.starts_with(b"[") || host[..i].ends_with(b"]") => &host[..i],
        _ => host,
    };
    let host = strings::trim(host, b".");
    let own = |s: &[u8]| Some(Box::<[u8]>::from(s));
    let labels_of = |s| -> Vec<&[u8]> { strings::split(s, b".").collect() };

    if host.ends_with(b".r2.cloudflarestorage.com") {
        return (own(b"s3"), own(b"auto"));
    }
    if let Some(stem) = host.strip_suffix(b".backblazeb2.com".as_slice()) {
        // [<bucket>.]s3.<region>.backblazeb2.com
        let labels = labels_of(stem);
        let region = match labels.as_slice() {
            [.., service, region] if *service == b"s3" => own(region),
            _ => None,
        };
        return (own(b"s3"), region);
    }
    if let Some(stem) = host.strip_suffix(b".on.aws".as_slice()) {
        // <id>.lambda-url.<region>.on.aws
        let labels = labels_of(stem);
        let region = labels.last().copied().filter(|r| looks_like_region(r));
        if labels.len() >= 2 && labels[labels.len() - 2] == b"lambda-url" {
            return (own(b"lambda"), region.and_then(own));
        }
        return (None, region.and_then(own));
    }
    let stem = if let Some(s) = host.strip_suffix(b".amazonaws.com".as_slice()) {
        s
    } else if let Some(s) = host.strip_suffix(b".amazonaws.com.cn".as_slice()) {
        s
    } else {
        return (None, None);
    };

    // <prefix…>.<service>.<region>[.dualstack|.fips|.vpce].amazonaws.com
    // <prefix…>.<region>.<service>.amazonaws.com   (es, aoss, older s3-website)
    // <service>.amazonaws.com                       (global: iam, sts, s3, cloudfront…)
    let mut labels = labels_of(stem);
    while labels.len() > 1
        && matches!(
            labels.last().copied(),
            Some(b"dualstack" | b"vpce" | b"fips" | b"api" | b"amazonaws")
        )
    {
        labels.pop();
    }
    let Some(&last) = labels.last() else {
        return (None, None);
    };
    let is_modifier = |l: &[u8]| matches!(l, b"dualstack" | b"vpce" | b"fips");
    let (mut service, mut region): (&[u8], Option<&[u8]>) = if looks_like_region(last) {
        labels.pop();
        while labels.len() > 1 && labels.last().is_some_and(|l| is_modifier(l)) {
            labels.pop();
        }
        match labels.pop() {
            Some(svc) => (svc, Some(last)),
            None => return (None, own(last)),
        }
    } else {
        labels.pop();
        // `<resource>.<region>.<service>` (rds, es, neptune, legacy
        // `<region>.queue` …): the label before the service is the region —
        // except for S3, where it is a bucket that may merely look like one.
        let r = if last == b"s3" || last.starts_with(b"s3-") {
            None
        } else {
            labels.last().copied().filter(|l| looks_like_region(l))
        };
        if r.is_some() {
            labels.clear();
        }
        (last, r)
    };
    let prefix = labels.last().copied();

    if let Some(s) = service.strip_suffix(b"-fips".as_slice()) {
        service = s;
    }
    // Legacy S3 spellings: s3-us-west-2, s3-external-1, s3-accelerate,
    // s3-website-us-east-1, s3-control, s3-accesspoint. (But s3-outposts /
    // s3-object-lambda are real signing names.)
    if let Some(tail) = service.strip_prefix(b"s3-".as_slice()) {
        let tail = tail.strip_prefix(b"fips-".as_slice()).unwrap_or(tail);
        if looks_like_region(tail) {
            region = region.or(Some(tail));
            service = b"s3";
        } else if let Some(r) = tail.strip_prefix(b"website-".as_slice()) {
            if looks_like_region(r) {
                region = region.or(Some(r));
            }
            service = b"s3";
        } else if matches!(
            tail,
            b"accelerate" | b"control" | b"website" | b"accesspoint"
        ) || tail.starts_with(b"external-")
        {
            service = b"s3";
        }
    }
    let service: &[u8] = match service {
        b"email" => b"ses",
        b"queue" => b"sqs",
        b"bedrock-runtime" | b"bedrock-agent" | b"bedrock-agent-runtime" => b"bedrock",
        b"iot" if prefix.is_some_and(|p| p.starts_with(b"data")) => b"iotdata",
        b"appsync-api" | b"appsync-realtime-api" => b"appsync",
        b"execute-api" => b"execute-api",
        other => other,
    };
    (
        own(service),
        // No region label on an amazonaws.com host means a global endpoint,
        // which signs as us-east-1.
        Some(Box::from(region.unwrap_or(b"us-east-1"))),
    )
}

fn looks_like_region(s: &[u8]) -> bool {
    // us-east-1, eu-central-2, us-gov-west-1, cn-north-1, us-iso-east-1, us-isob-east-1
    if s.len() < 9 || !s[s.len() - 1].is_ascii_digit() || s[s.len() - 2] != b'-' {
        return false;
    }
    let dashes = strings::count_char(s, b'-');
    (2..=3).contains(&dashes)
        && s[..2].iter().all(u8::is_ascii_lowercase)
        && s[2] == b'-'
        && s.iter()
            .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || *c == b'-')
}

// ─── canonicalisation ──────────────────────────────────────────────────────

fn is_unreserved(c: u8) -> bool {
    c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b'~')
}

fn push_pct(out: &mut Vec<u8>, c: u8) {
    out.push(b'%');
    out.push(bun_core::fmt::hex_char_upper(c >> 4));
    out.push(bun_core::fmt::hex_char_upper(c & 0xF));
}

/// RFC 3986 encode; `/` kept when `keep_slash`.
pub fn uri_encode_into(out: &mut Vec<u8>, input: &[u8], keep_slash: bool) {
    for &c in input {
        if is_unreserved(c) || (keep_slash && c == b'/') {
            out.push(c);
        } else {
            push_pct(out, c);
        }
    }
}

fn hex_val(c: u8) -> Option<u8> {
    match c {
        b'0'..=b'9' => Some(c - b'0'),
        b'a'..=b'f' => Some(c - b'a' + 10),
        b'A'..=b'F' => Some(c - b'A' + 10),
        _ => None,
    }
}

/// Decodes `%XX`; leaves malformed escapes and `+` as-is.
fn percent_decode(input: &[u8]) -> Vec<u8> {
    let mut out = Vec::with_capacity(input.len());
    let mut i = 0;
    while i < input.len() {
        let c = input[i];
        if c == b'%' && i + 2 < input.len() {
            if let (Some(h), Some(l)) = (hex_val(input[i + 1]), hex_val(input[i + 2])) {
                out.push((h << 4) | l);
                i += 3;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

fn canonical_uri(out: &mut Vec<u8>, path: &[u8], s3: bool) {
    if path.is_empty() {
        out.push(b'/');
        return;
    }
    if s3 {
        // Encode the *decoded* key once so `(`, `!`, spaces etc. match what S3
        // recomputes regardless of how the caller spelled them.
        let decoded = percent_decode(path);
        if !decoded.starts_with(b"/") {
            out.push(b'/');
        }
        uri_encode_into(out, &decoded, true);
        return;
    }
    // Normalise `.`/`..`/`//` per RFC 3986 remove_dot_segments, then encode
    // each (already once-encoded) segment again.
    let mut segments: Vec<&[u8]> = Vec::new();
    for seg in strings::split(path, b"/") {
        match seg {
            b"" | b"." => {}
            b".." => {
                segments.pop();
            }
            s => segments.push(s),
        }
    }
    out.push(b'/');
    for (i, seg) in segments.iter().enumerate() {
        if i > 0 {
            out.push(b'/');
        }
        uri_encode_into(out, seg, false);
    }
    if segments.is_empty() {
        return;
    }
    if path.ends_with(b"/") {
        out.push(b'/');
    }
}

/// Sorted, re-encoded `name=value` pairs; a stale `X-Amz-Signature` is dropped.
fn canonical_query(out: &mut Vec<u8>, query: &[u8], extra: &[(Vec<u8>, Vec<u8>)]) {
    let mut pairs: Vec<(Vec<u8>, Vec<u8>)> = Vec::new();
    for part in strings::split(query, b"&") {
        if part.is_empty() {
            continue;
        }
        let (k, v) = match strings::index_of_char_usize(part, b'=') {
            Some(i) => (&part[..i], &part[i + 1..]),
            None => (part, &b""[..]),
        };
        if k == b"X-Amz-Signature" {
            continue;
        }
        let mut ek = Vec::with_capacity(k.len());
        uri_encode_into(&mut ek, &percent_decode(k), false);
        let mut ev = Vec::with_capacity(v.len());
        uri_encode_into(&mut ev, &percent_decode(v), false);
        pairs.push((ek, ev));
    }
    for (k, v) in extra {
        pairs.push((k.clone(), v.clone()));
    }
    pairs.sort();
    for (i, (k, v)) in pairs.iter().enumerate() {
        if i > 0 {
            out.push(b'&');
        }
        out.extend_from_slice(k);
        out.push(b'=');
        out.extend_from_slice(v);
    }
}

fn trim_and_collapse_ws(value: &[u8], out: &mut Vec<u8>) {
    let v = strings::trim(value, b" \t");
    let mut prev_space = false;
    for &c in v {
        let is_space = c == b' ' || c == b'\t';
        if is_space {
            if !prev_space {
                out.push(b' ');
            }
        } else {
            out.push(c);
        }
        prev_space = is_space;
    }
}

struct CanonicalHeaders {
    /// `name:value\n…`
    block: Vec<u8>,
    /// `a;b;c`
    names: Vec<u8>,
}

fn canonical_headers(
    host: &[u8],
    amz_date: Option<&[u8]>,
    content_sha256: Option<&[u8]>,
    security_token: Option<&[u8]>,
    user_headers: &[(&[u8], &[u8])],
) -> Result<CanonicalHeaders, SignError> {
    let mut entries: Vec<(Vec<u8>, Vec<u8>)> = Vec::with_capacity(user_headers.len() + 4);
    entries.push((b"host".to_vec(), host.to_vec()));
    if let Some(d) = amz_date {
        entries.push((b"x-amz-date".to_vec(), d.to_vec()));
    }
    if let Some(h) = content_sha256 {
        entries.push((b"x-amz-content-sha256".to_vec(), h.to_vec()));
    }
    if let Some(t) = security_token {
        entries.push((b"x-amz-security-token".to_vec(), t.to_vec()));
    }
    for (name, value) in user_headers {
        if name.is_empty() {
            continue;
        }
        let lower: Vec<u8> = name.iter().map(u8::to_ascii_lowercase).collect();
        if matches!(
            lower.as_slice(),
            b"host"
                | b"x-amz-date"
                | b"x-amz-content-sha256"
                | b"x-amz-security-token"
                | b"authorization"
                | b"connection"
                | b"content-length"
                | b"expect"
                | b"keep-alive"
                | b"proxy-authenticate"
                | b"proxy-authorization"
                | b"te"
                | b"trailer"
                | b"transfer-encoding"
                | b"upgrade"
                | b"user-agent"
                | b"x-amzn-trace-id"
        ) {
            continue;
        }
        if strings::index_of_any(value, b"\r\n").is_some()
            || strings::index_of_any(name, b"\r\n: ").is_some()
        {
            return Err(SignError::InvalidHeaderValue);
        }
        let mut v = Vec::with_capacity(value.len());
        trim_and_collapse_ws(value, &mut v);
        if let Some(existing) = entries.iter_mut().find(|(n, _)| *n == lower) {
            existing.1.push(b',');
            existing.1.extend_from_slice(&v);
        } else {
            entries.push((lower, v));
        }
    }
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    let mut block = Vec::with_capacity(256);
    let mut names = Vec::with_capacity(64);
    for (i, (n, v)) in entries.iter().enumerate() {
        block.extend_from_slice(n);
        block.push(b':');
        block.extend_from_slice(v);
        block.push(b'\n');
        if i > 0 {
            names.push(b';');
        }
        names.extend_from_slice(n);
    }
    Ok(CanonicalHeaders { block, names })
}

fn payload_hash(payload: Payload<'_>) -> Box<[u8]> {
    match payload {
        Payload::Unsigned => Box::from(UNSIGNED_PAYLOAD),
        Payload::Sha256Hex(h) => Box::from(h),
        Payload::Bytes([]) => Box::from(EMPTY_SHA256),
        Payload::Bytes(b) => {
            let mut digest = [0u8; SHA256::DIGEST];
            SHA256::hash(b, &mut digest);
            format!("{}", hex_lower(&digest))
                .into_bytes()
                .into_boxed_slice()
        }
    }
}

const KEY_LEN: usize = 32;

fn hmac(key: &[u8], data: &[u8]) -> Result<[u8; KEY_LEN], SignError> {
    let mut buf = [0u8; EVP_MAX_MD_SIZE];
    let out = bun_sha_hmac::generate(key, data, bun_sha_hmac::Algorithm::Sha256, &mut buf)
        .ok_or(SignError::FailedToGenerateSignature)?;
    let mut k = [0u8; KEY_LEN];
    k.copy_from_slice(&out[..KEY_LEN]);
    Ok(k)
}

fn signing_key(secret: &[u8], date: &[u8], scope: Scope<'_>) -> Result<[u8; KEY_LEN], SignError> {
    let mut k_secret = Vec::with_capacity(4 + secret.len());
    k_secret.extend_from_slice(b"AWS4");
    k_secret.extend_from_slice(secret);
    let k_date = hmac(&k_secret, date)?;
    bun_core::secure_zero_slice(&mut k_secret);
    let k_region = hmac(&k_date, scope.region)?;
    let k_service = hmac(&k_region, scope.service)?;
    hmac(&k_service, b"aws4_request")
}

fn validate(creds: &Credentials<'_>, req: &Request<'_>) -> Result<(), SignError> {
    if creds.access_key_id.is_empty() || creds.secret_access_key.is_empty() {
        return Err(SignError::MissingCredentials);
    }
    if req.scope.region.is_empty() || req.scope.service.is_empty() || req.host.is_empty() {
        return Err(SignError::InvalidEndpoint);
    }
    let bad = |s: &[u8]| strings::index_of_any(s, b"\r\n").is_some();
    if bad(creds.access_key_id)
        || creds.session_token.is_some_and(bad)
        || bad(req.host)
        || bad(req.path)
        || bad(req.scope.region)
        || bad(req.scope.service)
        || bad(req.method)
    {
        return Err(SignError::InvalidHeaderValue);
    }
    if !req
        .scope
        .region
        .iter()
        .chain(req.scope.service.iter())
        .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.' | b'*'))
    {
        return Err(SignError::InvalidEndpoint);
    }
    Ok(())
}

struct StringToSign {
    value: Vec<u8>,
}

fn string_to_sign(
    amz_date: &[u8; 16],
    scope: Scope<'_>,
    method: &[u8],
    canonical_uri: &[u8],
    canonical_query: &[u8],
    headers: &CanonicalHeaders,
    payload_hash: &[u8],
) -> StringToSign {
    let mut canonical = Vec::with_capacity(
        method.len() + canonical_uri.len() + canonical_query.len() + headers.block.len() + 160,
    );
    canonical.extend_from_slice(method);
    canonical.push(b'\n');
    canonical.extend_from_slice(canonical_uri);
    canonical.push(b'\n');
    canonical.extend_from_slice(canonical_query);
    canonical.push(b'\n');
    canonical.extend_from_slice(&headers.block);
    canonical.push(b'\n');
    canonical.extend_from_slice(&headers.names);
    canonical.push(b'\n');
    canonical.extend_from_slice(payload_hash);

    let mut digest = [0u8; SHA256::DIGEST];
    SHA256::hash(&canonical, &mut digest);
    let mut value = Vec::with_capacity(160);
    let _ = write!(
        &mut value,
        "AWS4-HMAC-SHA256\n{}\n{}/{}/{}/aws4_request\n{}",
        BStr::new(amz_date),
        BStr::new(&amz_date[..8]),
        BStr::new(scope.region),
        BStr::new(scope.service),
        hex_lower(&digest)
    );
    StringToSign { value }
}

/// Header-form signature: returns the `Authorization`, `x-amz-date` and
/// `x-amz-content-sha256` values to attach.
pub fn sign(creds: &Credentials<'_>, req: &Request<'_>) -> Result<SignedRequest, SignError> {
    validate(creds, req)?;
    let s3 = req
        .s3_path_semantics
        .unwrap_or_else(|| is_s3_service(req.scope.service));
    let amz_date = req.datetime.unwrap_or_else(amz_datetime_now);
    let payload = payload_hash(req.payload);

    let mut uri = Vec::with_capacity(req.path.len() + 8);
    canonical_uri(&mut uri, req.path, s3);
    let mut query = Vec::with_capacity(req.query.len() + 8);
    canonical_query(&mut query, req.query, &[]);
    // Only S3 wants `x-amz-content-sha256` on the wire; any `x-amz-*` header
    // that is sent must be signed, so callers send it exactly when `s3`.
    let headers = canonical_headers(
        req.host,
        Some(&amz_date),
        if s3 { Some(&payload) } else { None },
        creds.session_token.filter(|t| !t.is_empty()),
        req.headers,
    )?;
    let sts = string_to_sign(
        &amz_date, req.scope, req.method, &uri, &query, &headers, &payload,
    );
    let key = signing_key(creds.secret_access_key, &amz_date[..8], req.scope)?;
    let signature = hmac(&key, &sts.value)?;

    let mut authorization = Vec::with_capacity(200 + headers.names.len());
    let _ = write!(
        &mut authorization,
        "AWS4-HMAC-SHA256 Credential={}/{}/{}/{}/aws4_request, SignedHeaders={}, Signature={}",
        BStr::new(creds.access_key_id),
        BStr::new(&amz_date[..8]),
        BStr::new(req.scope.region),
        BStr::new(req.scope.service),
        BStr::new(&headers.names),
        hex_lower(&signature)
    );
    Ok(SignedRequest {
        authorization: authorization.into_boxed_slice(),
        amz_date,
        content_sha256: payload,
        send_content_sha256: s3,
    })
}

/// Query-string form: returns `scheme://host/path?…&X-Amz-Signature=…`.
/// Only `host` (plus any `req.headers`) is signed.
pub fn presign(
    creds: &Credentials<'_>,
    req: &Request<'_>,
    scheme: &[u8],
    expires_in_seconds: u32,
) -> Result<PresignedUrl, SignError> {
    validate(creds, req)?;
    if expires_in_seconds == 0 || expires_in_seconds > MAX_PRESIGN_EXPIRES {
        return Err(SignError::InvalidExpires);
    }
    let s3 = req
        .s3_path_semantics
        .unwrap_or_else(|| is_s3_service(req.scope.service));
    let amz_date = req.datetime.unwrap_or_else(amz_datetime_now);
    // S3 verifies query-authenticated requests against the literal
    // UNSIGNED-PAYLOAD (the URL cannot carry a body hash); other services
    // hash the body.
    let payload: Box<[u8]> = if s3 {
        Box::from(UNSIGNED_PAYLOAD)
    } else {
        payload_hash(req.payload)
    };

    let headers = canonical_headers(req.host, None, None, None, req.headers)?;

    let enc = |s: &[u8]| {
        let mut v = Vec::with_capacity(s.len() + 8);
        uri_encode_into(&mut v, s, false);
        v
    };
    let mut credential = Vec::with_capacity(64);
    let _ = write!(
        &mut credential,
        "{}/{}/{}/{}/aws4_request",
        BStr::new(creds.access_key_id),
        BStr::new(&amz_date[..8]),
        BStr::new(req.scope.region),
        BStr::new(req.scope.service)
    );
    let mut extra: Vec<(Vec<u8>, Vec<u8>)> = vec![
        (b"X-Amz-Algorithm".to_vec(), b"AWS4-HMAC-SHA256".to_vec()),
        (b"X-Amz-Credential".to_vec(), enc(&credential)),
        (b"X-Amz-Date".to_vec(), amz_date.to_vec()),
        (
            b"X-Amz-Expires".to_vec(),
            expires_in_seconds.to_string().into_bytes(),
        ),
        (b"X-Amz-SignedHeaders".to_vec(), enc(&headers.names)),
    ];
    if let Some(token) = creds.session_token.filter(|t| !t.is_empty()) {
        extra.push((b"X-Amz-Security-Token".to_vec(), enc(token)));
    }
    let mut uri = Vec::with_capacity(req.path.len() + 8);
    canonical_uri(&mut uri, req.path, s3);
    let mut query = Vec::with_capacity(req.query.len() + 256);
    canonical_query(&mut query, req.query, &extra);

    let sts = string_to_sign(
        &amz_date, req.scope, req.method, &uri, &query, &headers, &payload,
    );
    let key = signing_key(creds.secret_access_key, &amz_date[..8], req.scope)?;
    let signature = hmac(&key, &sts.value)?;

    let mut url =
        Vec::with_capacity(scheme.len() + 3 + req.host.len() + uri.len() + query.len() + 82);
    url.extend_from_slice(scheme);
    url.extend_from_slice(b"://");
    url.extend_from_slice(req.host);
    // Send the canonical path so the server recomputes the same thing.
    url.extend_from_slice(if s3 { &uri } else { req.path });
    if !s3 && req.path.is_empty() {
        url.push(b'/');
    }
    url.push(b'?');
    url.extend_from_slice(&query);
    let _ = write!(&mut url, "&X-Amz-Signature={}", hex_lower(&signature));
    Ok(PresignedUrl {
        url: url.into_boxed_slice(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const AKID: &[u8] = b"AKIDEXAMPLE";
    const SECRET: &[u8] = b"wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY";

    fn creds() -> Credentials<'static> {
        Credentials {
            access_key_id: AKID,
            secret_access_key: SECRET,
            session_token: None,
        }
    }

    fn dt() -> [u8; 16] {
        *b"20150830T123600Z"
    }

    // Vectors from the AWS SigV4 test suite (aws-sig-v4-test-suite).
    #[test]
    fn get_vanilla() {
        let r = sign(
            &creds(),
            &Request {
                method: b"GET",
                host: b"example.amazonaws.com",
                path: b"/",
                query: b"",
                headers: &[],
                payload: Payload::Bytes(b""),
                scope: Scope {
                    service: b"service",
                    region: b"us-east-1",
                },
                datetime: Some(dt()),
                s3_path_semantics: None,
            },
        )
        .unwrap();
        assert_eq!(
            BStr::new(&r.authorization),
            BStr::new(b"AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31".as_slice())
        );
    }

    #[test]
    fn get_vanilla_query_order_key_case() {
        let r = sign(
            &creds(),
            &Request {
                method: b"GET",
                host: b"example.amazonaws.com",
                path: b"/",
                query: b"Param2=value2&Param1=value1",
                headers: &[],
                payload: Payload::Bytes(b""),
                scope: Scope {
                    service: b"service",
                    region: b"us-east-1",
                },
                datetime: Some(dt()),
                s3_path_semantics: None,
            },
        )
        .unwrap();
        assert!(r.authorization.ends_with(
            b"Signature=b97d918cfa904a5beff61c982a1b6f458b799221646efd99d3219ec94cdf2500"
        ));
    }

    #[test]
    fn post_x_www_form_urlencoded() {
        let r = sign(
            &creds(),
            &Request {
                method: b"POST",
                host: b"example.amazonaws.com",
                path: b"/",
                query: b"",
                headers: &[(b"Content-Type", b"application/x-www-form-urlencoded")],
                payload: Payload::Bytes(b"Param1=value1"),
                scope: Scope {
                    service: b"service",
                    region: b"us-east-1",
                },
                datetime: Some(dt()),
                s3_path_semantics: None,
            },
        )
        .unwrap();
        assert!(r.authorization.ends_with(b"SignedHeaders=content-type;host;x-amz-date, Signature=ff11897932ad3f4e8b18135d722051e5ac45fc38421b1da7b9d196a0fe09473a"), "{}", BStr::new(&r.authorization));
    }

    #[test]
    fn get_with_normalized_path() {
        // get-relative-relative: /example1/example2/../.. → /
        let r = sign(
            &creds(),
            &Request {
                method: b"GET",
                host: b"example.amazonaws.com",
                path: b"/example1/example2/../..",
                query: b"",
                headers: &[],
                payload: Payload::Bytes(b""),
                scope: Scope {
                    service: b"service",
                    region: b"us-east-1",
                },
                datetime: Some(dt()),
                s3_path_semantics: None,
            },
        )
        .unwrap();
        assert!(r.authorization.ends_with(
            b"Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31"
        ));
    }

    #[test]
    fn iso8601() {
        assert_eq!(parse_iso8601(b"1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(parse_iso8601(b"2015-08-30T12:36:00Z"), Some(1_440_938_160));
        assert_eq!(
            parse_iso8601(b"2015-08-30T12:36:00.123Z"),
            Some(1_440_938_160)
        );
        assert_eq!(parse_iso8601(b"20150830T123600Z"), Some(1_440_938_160));
        assert_eq!(
            parse_iso8601(b"2015-08-30T14:36:00+02:00"),
            Some(1_440_938_160)
        );
        assert_eq!(
            parse_iso8601(b"2015-08-30T14:36:00+0200"),
            Some(1_440_938_160)
        );
        assert_eq!(
            parse_iso8601(b"2015-08-30T11:06:00.5-0130"),
            Some(1_440_938_160)
        );
        assert_eq!(parse_iso8601(b"2015-08-30T14:36:00+020"), None);
        assert_eq!(parse_iso8601(b"2015-08-30T14:36:00++100"), None);
        assert_eq!(parse_iso8601(b"2015-08-30T14:36:00+9999"), None);
        assert_eq!(amz_datetime(1_440_938_160), *b"20150830T123600Z");
        assert_eq!(parse_iso8601(b"garbage"), None);
    }

    #[test]
    fn infer() {
        let t = |h: &str| {
            let (s, r) = infer_service_region(h.as_bytes());
            (
                s.map(|s| String::from_utf8(s.into_vec()).unwrap()),
                r.map(|r| String::from_utf8(r.into_vec()).unwrap()),
            )
        };
        assert_eq!(
            t("dynamodb.us-west-2.amazonaws.com"),
            (Some("dynamodb".into()), Some("us-west-2".into()))
        );
        // A region-shaped bucket name on a regionless S3 host is a bucket.
        assert_eq!(
            t("my-data-1.s3.amazonaws.com"),
            (Some("s3".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("my-data-1.s3-accelerate.amazonaws.com"),
            (Some("s3".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("search-dom.eu-west-1.es.amazonaws.com"),
            (Some("es".into()), Some("eu-west-1".into()))
        );
        assert_eq!(
            t("my-bucket.s3.us-west-004.backblazeb2.com"),
            (Some("s3".into()), Some("us-west-004".into()))
        );
        assert_eq!(
            t("s3.eu-central-003.backblazeb2.com"),
            (Some("s3".into()), Some("eu-central-003".into()))
        );
        assert_eq!(
            t("mydb.abc123.eu-west-1.rds.amazonaws.com"),
            (Some("rds".into()), Some("eu-west-1".into()))
        );
        assert_eq!(
            t("eu-west-1.queue.amazonaws.com"),
            (Some("sqs".into()), Some("eu-west-1".into()))
        );
        assert_eq!(
            t("myap-123456789012.s3-accesspoint.us-west-2.amazonaws.com"),
            (Some("s3".into()), Some("us-west-2".into()))
        );
        assert_eq!(
            t("myap-123456789012.s3-accesspoint-fips.dualstack.us-west-2.amazonaws.com"),
            (Some("s3".into()), Some("us-west-2".into()))
        );
        assert_eq!(t("f004.backblazeb2.com"), (Some("s3".into()), None));
        assert_eq!(
            t("bucket.s3-fips-us-gov-west-1.amazonaws.com"),
            (Some("s3".into()), Some("us-gov-west-1".into()))
        );
        assert_eq!(
            t("sts.amazonaws.com"),
            (Some("sts".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("bucket.s3.eu-central-1.amazonaws.com"),
            (Some("s3".into()), Some("eu-central-1".into()))
        );
        assert_eq!(
            t("bucket.s3.amazonaws.com"),
            (Some("s3".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("s3-us-west-2.amazonaws.com"),
            (Some("s3".into()), Some("us-west-2".into()))
        );
        assert_eq!(
            t("s3.dualstack.us-east-2.amazonaws.com"),
            (Some("s3".into()), Some("us-east-2".into()))
        );
        assert_eq!(
            t("abc.execute-api.ap-southeast-1.amazonaws.com"),
            (Some("execute-api".into()), Some("ap-southeast-1".into()))
        );
        assert_eq!(
            t("xyz.lambda-url.us-east-1.on.aws"),
            (Some("lambda".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("email.us-east-1.amazonaws.com"),
            (Some("ses".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("acct.r2.cloudflarestorage.com"),
            (Some("s3".into()), Some("auto".into()))
        );
        assert_eq!(
            t("bedrock-runtime.us-east-1.amazonaws.com"),
            (Some("bedrock".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("kms-fips.us-gov-west-1.amazonaws.com"),
            (Some("kms".into()), Some("us-gov-west-1".into()))
        );
        assert_eq!(
            t("dynamodb.cn-north-1.amazonaws.com.cn"),
            (Some("dynamodb".into()), Some("cn-north-1".into()))
        );
        assert_eq!(t("localhost:9000"), (None, None));
        assert_eq!(
            t("vpce-0a1b-xyz.sqs.us-west-2.vpce.amazonaws.com"),
            (Some("sqs".into()), Some("us-west-2".into()))
        );
        assert_eq!(
            t("bucket.vpce-xx.s3.us-east-1.vpce.amazonaws.com"),
            (Some("s3".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("my-domain.eu-west-1.es.amazonaws.com"),
            (Some("es".into()), Some("eu-west-1".into()))
        );
        assert_eq!(
            t("abc.eu-west-1.aoss.amazonaws.com"),
            (Some("aoss".into()), Some("eu-west-1".into()))
        );
        assert_eq!(
            t("data-ats.iot.us-east-1.amazonaws.com"),
            (Some("iotdata".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("runtime.sagemaker.us-east-1.amazonaws.com"),
            (Some("sagemaker".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("api.ecr.us-east-1.amazonaws.com"),
            (Some("ecr".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("streams.dynamodb.us-east-1.amazonaws.com"),
            (Some("dynamodb".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("bucket.s3-website-us-east-1.amazonaws.com"),
            (Some("s3".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("s3-outposts.us-east-1.amazonaws.com"),
            (Some("s3-outposts".into()), Some("us-east-1".into()))
        );
        assert_eq!(
            t("s3.eu-west-2.backblazeb2.com"),
            (Some("s3".into()), Some("eu-west-2".into()))
        );
    }

    #[test]
    fn presign_vectors() {
        let c = creds();
        // S3: canonical path in the URL, UNSIGNED-PAYLOAD, session token echoed.
        let session = Credentials {
            session_token: Some(b"tok en"),
            ..c
        };
        let req = Request {
            method: b"GET",
            host: b"examplebucket.s3.amazonaws.com",
            path: b"/test file.txt",
            query: b"",
            headers: &[],
            payload: Payload::Unsigned,
            scope: Scope {
                service: b"s3",
                region: b"us-east-1",
            },
            datetime: Some(dt()),
            s3_path_semantics: None,
        };
        let url = presign(&session, &req, b"https", 86400).unwrap().url;
        let url = std::str::from_utf8(&url).unwrap();
        assert!(url.starts_with("https://examplebucket.s3.amazonaws.com/test%20file.txt?"));
        assert!(url.contains("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        assert!(
            url.contains("X-Amz-Credential=AKIDEXAMPLE%2F20150830%2Fus-east-1%2Fs3%2Faws4_request")
        );
        assert!(url.contains("X-Amz-Date=20150830T123600Z&X-Amz-Expires=86400"));
        assert!(url.contains("X-Amz-Security-Token=tok%20en"));
        assert!(url.contains("X-Amz-SignedHeaders=host&"));
        assert_eq!(url.len() - url.rfind("X-Amz-Signature=").unwrap(), 16 + 64);
        // Deterministic for a fixed datetime.
        assert_eq!(
            presign(&session, &req, b"https", 86400).unwrap().url,
            presign(&session, &req, b"https", 86400).unwrap().url
        );

        // Non-S3: empty path becomes "/", existing query is kept and signed.
        let iam = Request {
            host: b"iam.amazonaws.com",
            path: b"",
            query: b"Action=ListUsers&Version=2010-05-08",
            payload: Payload::Bytes(b""),
            scope: Scope {
                service: b"iam",
                region: b"us-east-1",
            },
            ..req
        };
        let url = presign(&c, &iam, b"https", 60).unwrap().url;
        let url = std::str::from_utf8(&url).unwrap();
        assert!(url.starts_with(
            "https://iam.amazonaws.com/?Action=ListUsers&Version=2010-05-08&X-Amz-Algorithm="
        ));
        assert!(!url.contains("X-Amz-Security-Token"));

        assert_eq!(
            presign(&c, &req, b"https", 0).err(),
            Some(SignError::InvalidExpires)
        );
        assert_eq!(
            presign(&c, &req, b"https", MAX_PRESIGN_EXPIRES + 1).err(),
            Some(SignError::InvalidExpires)
        );
        let crlf = Request {
            path: b"/a\r\nb",
            ..req
        };
        assert!(presign(&c, &crlf, b"https", 60).is_err());
    }
}
