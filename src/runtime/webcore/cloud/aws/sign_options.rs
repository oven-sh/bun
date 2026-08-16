//! Options shared by `new Bun.AWSClient(...)`, `client.fetch(url, init)` and
//! `client.presign(...)`: which credentials to sign with, for what
//! service/region, and how.

use std::sync::Arc;

use bstr::BStr;
use bun_core::strings;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_s3_signing::sigv4;
use bun_s3_signing::{AwsCredentials, CredentialsProvider as _, CredentialsSource};

use super::DefaultProvider;

use crate::webcore::s3::credentials_jsc::get_truthy_string_utf8;

#[derive(Clone)]
pub enum Credentials {
    Static(Arc<AwsCredentials>),
    Provider(Arc<DefaultProvider>),
}

#[derive(Clone)]
pub struct AwsSignOptions {
    pub credentials: Credentials,
    pub service: Option<Box<[u8]>>,
    pub region: Option<Box<[u8]>>,
    /// Sign with `UNSIGNED-PAYLOAD` instead of hashing the body (S3 only).
    pub unsigned_payload: bool,
    /// Put the signature in the query string instead of headers.
    pub sign_query: bool,
    pub expires_in: u32,
    /// Test hook / reproducible signatures: `YYYYMMDDTHHMMSSZ`.
    pub datetime: Option<[u8; 16]>,
    /// Base URL for path-only requests (e.g. LocalStack); otherwise the
    /// service's standard endpoint is used.
    pub endpoint: Option<Box<[u8]>>,
}

/// `AWS_REGION` (or `AWS_DEFAULT_REGION`) right now.
fn env_region(global: &JSGlobalObject) -> Option<Box<[u8]>> {
    let env = crate::webcore::cloud::env::Env::new(global);
    env.get(b"AWS_REGION")
        .or_else(|| env.get(b"AWS_DEFAULT_REGION"))
        .filter(|s| !s.is_empty())
        .map(Vec::into_boxed_slice)
}

fn contains_crlf(s: &[u8]) -> bool {
    strings::index_of_any(s, b"\r\n").is_some()
}

impl AwsSignOptions {
    /// No overrides: ambient credentials, everything else inferred.
    pub fn ambient() -> Self {
        AwsSignOptions {
            credentials: Credentials::Provider(super::default_provider(None)),
            service: None,
            region: None,
            unsigned_payload: false,
            sign_query: false,
            expires_in: 900,
            datetime: None,
            endpoint: None,
        }
    }

    /// These options with the fields of `value` (an options object, or
    /// `undefined`/`null` for none) laid over them.
    pub fn with_overrides(&self, global: &JSGlobalObject, value: JSValue) -> JsResult<Self> {
        let mut out = self.clone();
        if value.is_undefined_or_null() {
            return Ok(out);
        }
        if !value.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "expected an options object like {{ region, profile, service, accessKeyId, secretAccessKey }}"
            )));
        }
        out.apply(global, value)?;
        Ok(out)
    }

    /// Overlay the fields present in `value`.
    fn apply(&mut self, global: &JSGlobalObject, value: JSValue) -> JsResult<()> {
        let out = self;
        if let Some(profile) = get_truthy_string_utf8(value, global, b"profile", true)? {
            out.credentials = Credentials::Provider(super::default_provider(Some(profile.slice())));
        }
        let access_key_id = get_truthy_string_utf8(value, global, b"accessKeyId", true)?;
        let secret_access_key = get_truthy_string_utf8(value, global, b"secretAccessKey", true)?;
        let session_token = get_truthy_string_utf8(value, global, b"sessionToken", true)?;
        match (access_key_id, secret_access_key) {
            (Some(a), Some(s)) => {
                if contains_crlf(a.slice())
                    || session_token
                        .as_ref()
                        .is_some_and(|t| contains_crlf(t.slice()))
                {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "AWS credentials must not contain newline characters"
                    )));
                }
                out.credentials = Credentials::Static(Arc::new(AwsCredentials {
                    access_key_id: Box::from(a.slice()),
                    secret_access_key: Box::from(s.slice()),
                    session_token: session_token
                        .map(|t| Box::from(t.slice()))
                        .unwrap_or_default(),
                    expiration: None,
                    account_id: None,
                    region: None,
                    source: CredentialsSource::Explicit,
                }));
            }
            (Some(_), None) | (None, Some(_)) => {
                return Err(global.throw_invalid_arguments(format_args!(
                    "accessKeyId and secretAccessKey must be given together"
                )));
            }
            (None, None) => {
                if session_token.is_some() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "sessionToken requires accessKeyId and secretAccessKey"
                    )));
                }
            }
        }
        if let Some(service) = get_truthy_string_utf8(value, global, b"service", true)? {
            let s = service.slice();
            if !s
                .iter()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'.'))
            {
                return Err(global.throw_invalid_arguments(format_args!(
                    "service \"{}\" is not a valid AWS service name",
                    BStr::new(s)
                )));
            }
            out.service = Some(s.iter().map(u8::to_ascii_lowercase).collect());
        }
        if let Some(region) = get_truthy_string_utf8(value, global, b"region", true)? {
            let r = region.slice();
            if !r
                .iter()
                .all(|c| c.is_ascii_alphanumeric() || matches!(c, b'-' | b'_' | b'*'))
            {
                return Err(global.throw_invalid_arguments(format_args!(
                    "region \"{}\" is not a valid AWS region",
                    BStr::new(r)
                )));
            }
            out.region = Some(r.iter().map(u8::to_ascii_lowercase).collect());
        }
        if let Some(b) = value.get_boolean_strict(global, "unsignedPayload")? {
            out.unsigned_payload = b;
        }
        if let Some(b) = value.get_boolean_strict(global, "signQuery")? {
            out.sign_query = b;
        }
        if let Some(n) = value.get_optional::<i32>(global, "expiresIn")? {
            if n <= 0 || n as u32 > sigv4::MAX_PRESIGN_EXPIRES {
                return Err(global.throw_range_error(
                    i64::from(n),
                    bun_jsc::RangeErrorOptions {
                        min: 1,
                        max: i64::from(sigv4::MAX_PRESIGN_EXPIRES),
                        field_name: b"expiresIn",
                        ..Default::default()
                    },
                ));
            }
            out.expires_in = n as u32;
        }
        if let Some(d) = get_truthy_string_utf8(value, global, b"signingDate", false)? {
            // Accept an `x-amz-date`-formatted string for reproducible signatures.
            let d = d.slice();
            if d.len() == 16 && sigv4::parse_iso8601(d).is_some() {
                let mut buf = [0u8; 16];
                buf.copy_from_slice(d);
                out.datetime = Some(buf);
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "signingDate must look like 20250101T000000Z"
                )));
            }
        } else if let Some(v) = value.get_truthy(global, "signingDate")? {
            if v.is_number() || v.is_date() {
                let ms = if v.is_number() {
                    v.as_number()
                } else {
                    v.get_unix_timestamp()
                };
                if ms.is_finite() && ms >= 0.0 {
                    out.datetime = Some(sigv4::amz_datetime((ms / 1000.0) as u64));
                }
            }
        }
        if let Some(endpoint) = get_truthy_string_utf8(value, global, b"endpoint", true)? {
            let e = endpoint.slice();
            let parsed = bun_url::URL::parse(e);
            if !(parsed.is_http() || parsed.is_https()) || parsed.host.is_empty() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "endpoint must be an http:// or https:// URL"
                )));
            }
            out.endpoint = Some(Box::from(bun_core::strings::trim_right(e, b"/")));
        }
        Ok(())
    }

    /// `https://{service}.{region}.amazonaws.com` (or the partition /
    /// global-service equivalent) for `Bun.aws.fetch("/path", { service })`.
    pub fn default_endpoint(&self, global: &JSGlobalObject) -> Result<Vec<u8>, EndpointError> {
        if let Some(e) = &self.endpoint {
            return Ok(e.to_vec());
        }
        let Some(service) = self.service.as_deref() else {
            return Err(EndpointError::NoService);
        };
        // Endpoint host label, where it differs from the signing name.
        let host_label: &[u8] = match service {
            b"ses" => b"email",
            b"iotdata" => b"data-ats.iot",
            b"execute-api" | b"lambda" | b"es" | b"aoss" => {
                return Err(EndpointError::NeedsHost(Box::from(service)));
            }
            other => other,
        };
        // Services with a single global endpoint (signed as us-east-1).
        const GLOBAL: &[&[u8]] = &[
            b"iam",
            b"cloudfront",
            b"route53",
            b"globalaccelerator",
            b"organizations",
            b"shield",
            b"waf",
            b"importexport",
            b"networkmanager",
        ];
        let region: Option<Box<[u8]>> = if GLOBAL.contains(&service) {
            None
        } else {
            match self.region.clone().or_else(|| env_region(global)) {
                Some(r) => Some(r),
                None => match &self.credentials {
                    Credentials::Static(c) => c.region.clone(),
                    Credentials::Provider(p) => match p.cached() {
                        Some(c) => c.region.clone(),
                        None if p.needs_resolution() => {
                            return Err(EndpointError::RegionPending(Arc::clone(p)));
                        }
                        None => None,
                    },
                },
            }
            .map(Some)
            .ok_or(EndpointError::NoRegion)?
        };
        let suffix = match region.as_deref() {
            Some(r) => super::chain::dns_suffix(r),
            None => "amazonaws.com",
        };
        Ok(match region {
            Some(r) => format!(
                "https://{}.{}.{suffix}",
                BStr::new(host_label),
                BStr::new(&r)
            ),
            None => format!("https://{}.{suffix}", BStr::new(host_label)),
        }
        .into_bytes())
    }

    pub fn provider(&self) -> Option<&Arc<DefaultProvider>> {
        match &self.credentials {
            Credentials::Provider(p) => Some(p),
            Credentials::Static(_) => None,
        }
    }

    pub fn needs_credentials_resolution(&self) -> bool {
        self.provider().is_some_and(|p| p.needs_resolution())
    }

    /// Static or already-resolved credentials. Asynchronous callers resolve
    /// the provider first, so `None` here means a caller skipped that.
    pub fn available_credentials(&self) -> Option<Arc<AwsCredentials>> {
        match &self.credentials {
            Credentials::Static(c) => Some(Arc::clone(c)),
            Credentials::Provider(p) => p.cached(),
        }
    }

    /// `(service, region)` for `host`, filling gaps from the hostname and
    /// the environment. Errors name what is missing.
    pub fn scope_for(
        &self,
        global: &JSGlobalObject,
        host: &[u8],
        creds: &AwsCredentials,
    ) -> Result<(Box<[u8]>, Box<[u8]>), ScopeError> {
        let (inferred_service, inferred_region) = if self.service.is_none() || self.region.is_none()
        {
            sigv4::infer_service_region(host)
        } else {
            (None, None)
        };
        let service = self
            .service
            .clone()
            .or(inferred_service)
            .ok_or_else(|| ScopeError::UnknownService(Box::from(host)))?;
        let region = self
            .region
            .clone()
            .or(inferred_region)
            .or_else(|| env_region(global))
            .or_else(|| creds.region.clone())
            .ok_or_else(|| ScopeError::UnknownRegion(Box::from(host)))?;
        Ok((service, region))
    }
}

/// Which part of the signing scope could not be worked out for a host.
#[derive(Debug, thiserror::Error)]
pub enum ScopeError {
    #[error("cannot tell which AWS service \"{}\" is; pass service: \"...\"", BStr::new(.0))]
    UnknownService(Box<[u8]>),
    #[error(
        "cannot tell which AWS region \"{}\" is in; pass region: \"...\" or set AWS_REGION",
        BStr::new(.0)
    )]
    UnknownRegion(Box<[u8]>),
}

pub enum EndpointError {
    NoService,
    NoRegion,
    NeedsHost(Box<[u8]>),
    /// The region may come with the credentials, which are not resolved yet.
    RegionPending(Arc<DefaultProvider>),
}

impl core::fmt::Display for EndpointError {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            EndpointError::NoService => {
                f.write_str("needs `service` (e.g. \"sqs\") to build a URL from a relative path")
            }
            EndpointError::NoRegion | EndpointError::RegionPending(_) => f.write_str(
                "cannot tell which region to use for a relative path; pass `region` or set AWS_REGION",
            ),
            EndpointError::NeedsHost(svc) => write!(
                f,
                "\"{}\" endpoints are per-resource; pass the full https:// URL",
                BStr::new(svc)
            ),
        }
    }
}

impl AwsSignOptions {
    /// Explicit region, else `AWS_REGION`, else the region already known from
    /// resolved/static credentials.
    pub fn configured_region(&self, global: &JSGlobalObject) -> Option<Box<[u8]>> {
        self.region
            .clone()
            .or_else(|| env_region(global))
            .or_else(|| match &self.credentials {
                Credentials::Static(c) => c.region.clone(),
                Credentials::Provider(p) => p.cached().and_then(|c| c.region.clone()),
            })
    }

    /// The profile the credentials come from, if they are ambient.
    pub fn profile_label(&self) -> Option<&[u8]> {
        match &self.credentials {
            Credentials::Provider(p) => Some(p.label()),
            Credentials::Static(_) => None,
        }
    }
}
