//! `{ aws: … }` on `fetch()` and the options bag of `Bun.aws.sign/presign`:
//! which credentials to sign with and for what service/region.

use std::sync::Arc;

use bstr::BStr;
use bun_core::strings;
use bun_jsc::{JSGlobalObject, JSValue, JsResult};
use bun_s3_signing::sigv4;
use bun_s3_signing::{AwsCredentials, CredentialsSource, SharedProvider};

use crate::webcore::s3::credentials_jsc::get_truthy_string_utf8;

pub enum Credentials {
    Static(Arc<AwsCredentials>),
    Provider(SharedProvider),
}

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
    /// `AWS_REGION` at parse time, used when neither the options nor the
    /// hostname give a region.
    env_region: Option<Box<[u8]>>,
}

fn contains_crlf(s: &[u8]) -> bool {
    strings::index_of_any(s, b"\r\n").is_some()
}

impl AwsSignOptions {
    /// `value` is `true` (everything inferred/ambient) or an options object.
    /// Returns `None` for `false`/`undefined`/`null`.
    pub fn from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Self>> {
        if value.is_undefined_or_null() || (value.is_boolean() && !value.as_boolean()) {
            return Ok(None);
        }
        let env = crate::webcore::cloud::env::Env::new(global);
        let env_region: Option<Box<[u8]>> = env
            .get(b"AWS_REGION")
            .or_else(|| env.get(b"AWS_DEFAULT_REGION"))
            .filter(|s| !s.is_empty())
            .map(Vec::into_boxed_slice);
        let env_static = match (
            env.get(b"AWS_ACCESS_KEY_ID"),
            env.get(b"AWS_SECRET_ACCESS_KEY"),
        ) {
            (Some(a), Some(s)) if !a.is_empty() && !s.is_empty() => {
                Some(Arc::new(AwsCredentials {
                    access_key_id: a.into_boxed_slice(),
                    secret_access_key: s.into_boxed_slice(),
                    session_token: env
                        .get(b"AWS_SESSION_TOKEN")
                        .map(Vec::into_boxed_slice)
                        .unwrap_or_default(),
                    expiration: None,
                    account_id: None,
                    region: env_region.clone(),
                    source: CredentialsSource::Env,
                }))
            }
            _ => None,
        };

        let mut out = AwsSignOptions {
            credentials: match env_static {
                Some(c) => Credentials::Static(c),
                None => Credentials::Provider(super::shared(None)),
            },
            service: None,
            region: None,
            unsigned_payload: false,
            sign_query: false,
            expires_in: 900,
            datetime: None,
            env_region,
        };
        if value.is_boolean() {
            return Ok(Some(out));
        }
        if !value.is_object() {
            return Err(global.throw_invalid_arguments(format_args!(
                "aws must be true or an object like {{ service, region, accessKeyId, secretAccessKey }}"
            )));
        }

        if let Some(profile) = get_truthy_string_utf8(value, global, b"profile", true)? {
            out.credentials = Credentials::Provider(super::shared(Some(profile.slice())));
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
                    "aws.accessKeyId and aws.secretAccessKey must be given together"
                )));
            }
            (None, None) => {
                if session_token.is_some() {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "aws.sessionToken requires aws.accessKeyId and aws.secretAccessKey"
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
                    "aws.service \"{}\" is not a valid AWS service name",
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
                    "aws.region \"{}\" is not a valid AWS region",
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
        if let Some(d) = get_truthy_string_utf8(value, global, b"date", false)? {
            // Accept an `x-amz-date`-formatted string for reproducible signatures.
            let d = d.slice();
            if d.len() == 16 && sigv4::parse_iso8601(d).is_some() {
                let mut buf = [0u8; 16];
                buf.copy_from_slice(d);
                out.datetime = Some(buf);
            } else {
                return Err(global.throw_invalid_arguments(format_args!(
                    "aws.date must look like 20250101T000000Z"
                )));
            }
        } else if let Some(v) = value.get_truthy(global, "date")? {
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
        Ok(Some(out))
    }

    pub fn provider(&self) -> Option<&SharedProvider> {
        match &self.credentials {
            Credentials::Provider(p) => Some(p),
            Credentials::Static(_) => None,
        }
    }

    pub fn needs_credentials_resolution(&self) -> bool {
        self.provider().is_some_and(|p| p.needs_refresh())
    }

    /// Cached / static credentials, resolving synchronously as a last resort.
    pub fn resolve_credentials(&self) -> Result<Arc<AwsCredentials>, Box<[u8]>> {
        match &self.credentials {
            Credentials::Static(c) => Ok(Arc::clone(c)),
            Credentials::Provider(p) => p.resolve_blocking().map_err(|e| e.message.clone()),
        }
    }

    /// `(service, region)` for `host`, filling gaps from the hostname and
    /// the environment. Errors name what is missing.
    pub fn scope_for(
        &self,
        host: &[u8],
        creds: &AwsCredentials,
    ) -> Result<(Box<[u8]>, Box<[u8]>), String> {
        let (inferred_service, inferred_region) = if self.service.is_none() || self.region.is_none()
        {
            sigv4::infer_service_region(host)
        } else {
            (None, None)
        };
        let service = self.service.clone().or(inferred_service).ok_or_else(|| {
            format!(
                "cannot tell which AWS service \"{}\" is; pass aws: {{ service: \"...\" }}",
                BStr::new(host)
            )
        })?;
        let region = self
            .region
            .clone()
            .or(inferred_region)
            .or_else(|| self.env_region.clone())
            .or_else(|| creds.region.clone())
            .ok_or_else(|| {
                format!(
                    "cannot tell which AWS region \"{}\" is in; pass aws: {{ region: \"...\" }} or set AWS_REGION",
                    BStr::new(host)
                )
            })?;
        Ok((service, region))
    }
}
