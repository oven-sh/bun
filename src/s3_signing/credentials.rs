use core::mem::size_of;
use std::io::Write as _;

use bstr::BStr;

use bun_core::strings;
use bun_http_types::Method::Method;
use bun_picohttp::Header as PicoHeader;
use bun_ptr::{RefCount, RefPtr};

use super::acl::ACL;
use super::storage_class::StorageClass;

bun_core::declare_scope!(AWS, visible);

use bun_core::fmt::buf_print;

/// Format into a fresh `Vec<u8>` and return it.
macro_rules! alloc_print {
    ($($arg:tt)*) => {{
        let mut v: Vec<u8> = Vec::new();
        write!(&mut v, $($arg)*).expect("write to Vec<u8> never fails");
        v
    }};
}

use bun_core::fmt::hex_lower as HexLower;

#[inline]
fn pico_header_empty() -> PicoHeader {
    PicoHeader::ZERO
}

#[inline]
fn pico_header_new(name: &[u8], value: &[u8]) -> PicoHeader {
    PicoHeader::new(name, value)
}

// ──────────────────────────────────────────────────────────────────────────
// MultiPartUploadOptions
// Moved from bun_runtime::webcore::s3::multipart_options.
// Pure config (no JSC deps), so it lives here at the signing tier; runtime
// re-exports it.
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy, Debug)]
pub struct MultiPartUploadOptions {
    /// more than 255 doesn't make sense — http thread cannot handle more than that
    pub queue_size: u8,
    /// In the AWS S3 client SDK this is set in bytes but the min is still 5 MiB.
    /// ```js
    /// var params = {Bucket: 'bucket', Key: 'key', Body: stream};
    /// var options = {partSize: 10 * 1024 * 1024, queueSize: 1};
    /// s3.upload(params, options, function(err, data) {
    ///   console.log(err, data);
    /// });
    /// ```
    /// See <https://docs.aws.amazon.com/AWSJavaScriptSDK/latest/AWS/S3.html#upload-property>.
    /// The value is in MiB; min is 5 and max 5120 (but we limit to 4 GiB aka 4096).
    pub part_size: u64,
    /// default is 3, max 255
    pub retry: u8,
}

impl MultiPartUploadOptions {
    pub(crate) const ONE_MIB: usize = 1_048_576;
    /// we limit to 5 GiB
    pub const MAX_SINGLE_UPLOAD_SIZE: usize = 5120 * Self::ONE_MIB;
    pub const MIN_SINGLE_UPLOAD_SIZE: usize = 5 * Self::ONE_MIB;
    pub const DEFAULT_PART_SIZE: usize = Self::MIN_SINGLE_UPLOAD_SIZE;
    /// dont make sense more than this because we use fetch; anything greater will be 64
    pub const MAX_QUEUE_SIZE: u8 = 64;
}

impl Default for MultiPartUploadOptions {
    fn default() -> Self {
        Self {
            queue_size: 5,
            part_size: Self::DEFAULT_PART_SIZE as u64,
            retry: 3,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// AWSSignatureCache — storage moved DOWN from `bun_jsc::rare_data`.
//
// The cache is process-global. Hosting it here as a `static` makes the
// layering honest — `bun_s3_signing` reads its own data, no upward hook.
// ──────────────────────────────────────────────────────────────────────────

use bun_collections::StringArrayHashMap;
use bun_core::Mutex;

/// Memoised SigV4 derived signing key, keyed by `(numeric_day,
/// sha256(region, service, secret))`. The lock owns the data — the mutex
/// wraps both `cache` and `date`.
#[derive(Default)]
struct AWSSignatureCache(Mutex<AWSSignatureCacheInner>);

#[derive(Default)]
struct AWSSignatureCacheInner {
    cache: StringArrayHashMap<[u8; DIGESTED_HMAC_256_LEN]>,
    date: u64,
}

impl AWSSignatureCache {
    /// Returns the cached 32-byte derived signing key for `key` if it was set
    /// for `numeric_day`.
    ///
    /// Returns the 32-byte *value* by copy; the only consumer (`sign` below)
    /// wants the digest, and a fixed-size copy avoids handing out a guard.
    pub(crate) fn get(&self, numeric_day: u64, key: &[u8]) -> Option<[u8; DIGESTED_HMAC_256_LEN]> {
        let inner = self.0.lock();
        if inner.date == 0 || inner.date != numeric_day {
            return None;
        }
        inner.cache.get(key).copied()
    }

    pub(crate) fn set(&self, numeric_day: u64, key: &[u8], value: [u8; DIGESTED_HMAC_256_LEN]) {
        let mut inner = self.0.lock();
        if inner.date == 0 {
            inner.cache = StringArrayHashMap::new();
        } else if inner.date != numeric_day {
            // day changed so we clean the old cache; StringArrayHashMap with
            // owned Box<[u8]> keys drops them on clear.
            inner.cache.clear();
        }
        inner.date = numeric_day;
        bun_core::handle_oom(inner.cache.put(key, value));
    }
}

// Drop: `StringArrayHashMap` drops its owned `Box<[u8]>` keys automatically.

/// Process-global instance.
/// `StringArrayHashMap::new` is not `const`, so lazy-init the inner on first
/// use; the outer `Mutex` itself is const-constructible.
static AWS_SIGNATURE_CACHE: std::sync::LazyLock<AWSSignatureCache> =
    std::sync::LazyLock::new(AWSSignatureCache::default);

#[inline]
fn aws_cache_get(day: u64, key: &[u8]) -> Option<[u8; DIGESTED_HMAC_256_LEN]> {
    AWS_SIGNATURE_CACHE.get(day, key)
}

#[inline]
fn aws_cache_set(day: u64, key: &[u8], digest: [u8; DIGESTED_HMAC_256_LEN]) {
    AWS_SIGNATURE_CACHE.set(day, key, digest)
}

// ──────────────────────────────────────────────────────────────────────────
// SseCustomerKey
// ──────────────────────────────────────────────────────────────────────────

/// A customer-provided key for SSE-C, kept as the two header values S3 wants:
/// base64 of the key and base64 of its MD5. The raw key is not kept.
pub struct SseCustomerKey {
    key_b64: [u8; Self::KEY_B64_LEN],
    key_md5_b64: [u8; Self::KEY_MD5_B64_LEN],
}

impl SseCustomerKey {
    /// SSE-C keys are 256-bit AES keys.
    pub const KEY_LEN: usize = 32;
    /// The only algorithm S3 accepts for SSE-C.
    pub const ALGORITHM: &'static [u8] = b"AES256";
    const KEY_B64_LEN: usize = bun_base64::encode_len_from_size(Self::KEY_LEN);
    const KEY_MD5_B64_LEN: usize = bun_base64::encode_len_from_size(bun_sha_hmac::MD5::DIGEST);

    pub fn new(key: &[u8; Self::KEY_LEN]) -> Self {
        let mut this = Self {
            key_b64: [0; Self::KEY_B64_LEN],
            key_md5_b64: [0; Self::KEY_MD5_B64_LEN],
        };
        let n = bun_base64::encode(&mut this.key_b64, key);
        debug_assert_eq!(n, Self::KEY_B64_LEN);
        let mut md5 = [0u8; bun_sha_hmac::MD5::DIGEST];
        bun_sha_hmac::MD5::hash(key, &mut md5);
        let n = bun_base64::encode(&mut this.key_md5_b64, &md5);
        debug_assert_eq!(n, Self::KEY_MD5_B64_LEN);
        this
    }

    pub fn key_b64(&self) -> &[u8] {
        &self.key_b64
    }

    pub fn key_md5_b64(&self) -> &[u8] {
        &self.key_md5_b64
    }
}

impl Clone for SseCustomerKey {
    fn clone(&self) -> Self {
        Self {
            key_b64: self.key_b64,
            key_md5_b64: self.key_md5_b64,
        }
    }
}

impl Drop for SseCustomerKey {
    fn drop(&mut self) {
        bun_core::secure_zero(&mut self.key_b64);
        bun_core::secure_zero(&mut self.key_md5_b64);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// S3Credentials
// ──────────────────────────────────────────────────────────────────────────

#[derive(bun_ptr::RefCounted)]
pub struct S3Credentials {
    ref_count: RefCount<S3Credentials>,
    pub access_key_id: Box<[u8]>,
    pub secret_access_key: Box<[u8]>,
    pub region: Box<[u8]>,
    pub endpoint: Box<[u8]>,
    pub bucket: Box<[u8]>,
    pub session_token: Box<[u8]>,
    /// SSE-C key. Every object request signed with these credentials carries
    /// the three `x-amz-server-side-encryption-customer-*` headers. Boxed so
    /// credentials without one stay small.
    pub sse_customer_key: Option<Box<SseCustomerKey>>,
    /// Important for MinIO support.
    pub insecure_http: bool,
    /// indicates if the endpoint is a virtual hosted style bucket
    pub virtual_hosted_style: bool,
}

// `S3Credentials` owns its bytes via
// `Box<[u8]>`, so a manual `Clone` deep-copies them and resets `ref_count` — the
// intrusive count only applies to heap (`RefPtr`) instances; a fresh value
// must start at 1.
impl Clone for S3Credentials {
    fn clone(&self) -> Self {
        Self {
            ref_count: RefCount::init(),
            access_key_id: self.access_key_id.clone(),
            secret_access_key: self.secret_access_key.clone(),
            region: self.region.clone(),
            endpoint: self.endpoint.clone(),
            bucket: self.bucket.clone(),
            session_token: self.session_token.clone(),
            sse_customer_key: self.sse_customer_key.clone(),
            insecure_http: self.insecure_http,
            virtual_hosted_style: self.virtual_hosted_style,
        }
    }
}

impl Default for S3Credentials {
    fn default() -> Self {
        Self {
            ref_count: RefCount::init(),
            access_key_id: Box::default(),
            secret_access_key: Box::default(),
            region: Box::default(),
            endpoint: Box::default(),
            bucket: Box::default(),
            session_token: Box::default(),
            sse_customer_key: None,
            insecure_http: false,
            virtual_hosted_style: false,
        }
    }
}

impl S3Credentials {
    /// Construct a value (refcount = 1) from owned field data. Exists so
    /// higher-tier callers (e.g. `bun_runtime`) can build the refcounted
    /// signing credentials from the lower-tier `bun_dotenv::S3Credentials`
    /// POD mirror without naming the private `ref_count` field.
    pub fn new_value(
        access_key_id: Box<[u8]>,
        secret_access_key: Box<[u8]>,
        region: Box<[u8]>,
        endpoint: Box<[u8]>,
        bucket: Box<[u8]>,
        session_token: Box<[u8]>,
        insecure_http: bool,
    ) -> Self {
        Self {
            ref_count: RefCount::init(),
            access_key_id,
            secret_access_key,
            region,
            endpoint,
            bucket,
            session_token,
            sse_customer_key: None,
            insecure_http,
            virtual_hosted_style: false,
        }
    }

    pub fn estimated_size(&self) -> usize {
        size_of::<S3Credentials>()
            + self.access_key_id.len()
            + self.region.len()
            + self.secret_access_key.len()
            + self.endpoint.len()
            + self.bucket.len()
    }

    pub fn dupe(&self) -> RefPtr<S3Credentials> {
        RefPtr::new(self.clone())
    }

    pub fn sign_request<const ALLOW_EMPTY_PATH: bool>(
        &self,
        sign_options: &SignOptions<'_>,
        sign_query_option: Option<SignQueryOptions>,
    ) -> Result<SignResult, SignError> {
        let method = sign_options.method;
        let request_path = sign_options.path;
        let content_hash = sign_options.content_hash;

        let content_md5_b64: Option<Vec<u8>> =
            sign_options.content_md5.map(bun_base64::encode_alloc);

        let search_params = sign_options.search_params;

        let content_disposition = sign_options.content_disposition.filter(|s| !s.is_empty());
        let content_type = sign_options.content_type.filter(|s| !s.is_empty());
        let content_encoding = sign_options.content_encoding.filter(|s| !s.is_empty());
        let session_token: Option<&[u8]> = if self.session_token.is_empty() {
            None
        } else {
            Some(&self.session_token)
        };

        let acl: Option<&'static [u8]> = sign_options.acl.map(|a| a.to_string());
        let storage_class: Option<&'static [u8]> =
            sign_options.storage_class.map(|s| s.to_string());
        let request_payer = sign_options.request_payer;

        if self.access_key_id.is_empty() || self.secret_access_key.is_empty() {
            return Err(SignError::MissingCredentials);
        }
        let sign_query = sign_query_option.is_some();
        let expires = sign_query_option.map(|o| o.expires).unwrap_or(0);
        let method_name: &'static str = match method {
            Method::GET => "GET",
            Method::POST => "POST",
            Method::PUT => "PUT",
            Method::DELETE => "DELETE",
            Method::HEAD => "HEAD",
            _ => return Err(SignError::InvalidMethod),
        };

        let region: &[u8] = if !self.region.is_empty() {
            &self.region
        } else {
            guess_region(&self.endpoint)
        };
        let mut full_path = request_path;
        // handle \\ on bucket name
        if strings::starts_with(full_path, b"/") || strings::starts_with(full_path, b"\\") {
            full_path = &full_path[1..];
        }

        let mut path: &[u8] = full_path;
        let mut bucket: &[u8] = &self.bucket;

        if !self.virtual_hosted_style {
            if bucket.is_empty() {
                // guess bucket using path
                if let Some(end) = strings::index_of(full_path, b"/") {
                    bucket = &full_path[..end];
                    path = &full_path[end + 1..];
                } else if let Some(backslash_index) = strings::index_of(full_path, b"\\") {
                    bucket = &full_path[..backslash_index];
                    path = &full_path[backslash_index + 1..];
                } else {
                    return Err(SignError::InvalidPath);
                }
            }
        }

        let path = normalize_name(path);
        let bucket = normalize_name(bucket);

        // if we allow path.len == 0 it will list the bucket for now we disallow
        if !ALLOW_EMPTY_PATH && path.is_empty() {
            return Err(SignError::InvalidPath);
        }

        // 1024 max key size and 63 max bucket name
        let mut normalized_path_buffer = [0u8; 1024 + 63 + 2];
        let mut path_buffer = [0u8; 1024];
        let mut bucket_buffer = [0u8; 63];
        let bucket = encode_uri_component::<false>(bucket, &mut bucket_buffer)
            .map_err(|_| SignError::InvalidPath)?;
        let path = encode_uri_component::<false>(path, &mut path_buffer)
            .map_err(|_| SignError::InvalidPath)?;
        // Default to https. Only use http if they explicit pass "http://" as the endpoint.
        let protocol: &str = if self.insecure_http { "http" } else { "https" };

        // detect service name and host from region or endpoint
        let mut extra_path: &[u8] = b"";
        let mut host_buffer = [0u8; MAX_ENDPOINT_LEN];
        let host: &[u8] = 'brk_host: {
            if !self.endpoint.is_empty() {
                if self.endpoint.len() >= MAX_ENDPOINT_LEN {
                    return Err(SignError::InvalidEndpoint);
                }
                let mut host: &[u8] = &self.endpoint;
                if let Some(index) = strings::index_of(&self.endpoint, b"/") {
                    host = &self.endpoint[..index];
                    extra_path = &self.endpoint[index..];
                }
                // only the host part is needed here
                break 'brk_host host;
            }
            if !is_valid_host_component(region) {
                return Err(SignError::InvalidEndpoint);
            }
            if self.virtual_hosted_style {
                // virtual hosted style requires a bucket name if an endpoint is not provided
                if bucket.is_empty() {
                    return Err(SignError::InvalidEndpoint);
                }
                // The bucket is interpolated into the host; a `/` (or `\`,
                // which encode_uri_component normalizes to `/`) would let a
                // crafted bucket redirect the signed request to another host.
                if strings::contains_char(bucket, b'/') {
                    return Err(SignError::InvalidEndpoint);
                }
                // default to https://<BUCKET_NAME>.s3.<REGION>.amazonaws.com/
                break 'brk_host buf_print(
                    &mut host_buffer,
                    format_args!(
                        "{}.s3.{}.amazonaws.com",
                        BStr::new(bucket),
                        BStr::new(region)
                    ),
                )
                .map_err(|_| SignError::InvalidEndpoint)?;
            }
            buf_print(
                &mut host_buffer,
                format_args!("s3.{}.amazonaws.com", BStr::new(region)),
            )
            .map_err(|_| SignError::InvalidEndpoint)?
        };

        let normalized_path: &[u8] = 'brk: {
            if self.virtual_hosted_style {
                break 'brk buf_print(
                    &mut normalized_path_buffer,
                    format_args!("{}/{}", BStr::new(extra_path), BStr::new(path)),
                )
                .map_err(|_| SignError::InvalidPath)?;
            } else {
                break 'brk buf_print(
                    &mut normalized_path_buffer,
                    format_args!(
                        "{}/{}/{}",
                        BStr::new(extra_path),
                        BStr::new(bucket),
                        BStr::new(path)
                    ),
                )
                .map_err(|_| SignError::InvalidPath)?;
            }
        };

        let date_result = get_amz_date();
        let amz_date: &[u8] = &date_result.date;
        let amz_day = &amz_date[0..8];

        let aws_content_hash: &[u8] = content_hash.unwrap_or(b"UNSIGNED-PAYLOAD");

        // S3 takes the SSE-C headers on requests that read or write an
        // object: GET, HEAD, PUT and the multipart POSTs. It does not take
        // them on DeleteObject, AbortMultipartUpload or ListObjectsV2.
        let sse_customer_key: Option<&SseCustomerKey> = self
            .sse_customer_key
            .as_deref()
            .filter(|_| !path.is_empty() && method != Method::DELETE);
        let values = if sign_query {
            // A presigned URL carries the credential, date and token as query
            // parameters. Only `host` and the SSE-C headers are signed as
            // headers: the SSE-C key must travel in headers and never in a URL.
            SignedHeaderValues {
                host,
                sse_customer_key: sse_customer_key.map(SseCustomerKey::key_b64),
                sse_customer_key_md5: sse_customer_key.map(SseCustomerKey::key_md5_b64),
                ..Default::default()
            }
        } else {
            SignedHeaderValues {
                content_disposition,
                content_encoding,
                content_md5: content_md5_b64.as_deref(),
                host,
                acl,
                content_sha256: Some(aws_content_hash),
                date: Some(amz_date),
                request_payer,
                session_token,
                sse_customer_key: sse_customer_key.map(SseCustomerKey::key_b64),
                sse_customer_key_md5: sse_customer_key.map(SseCustomerKey::key_md5_b64),
                storage_class,
            }
        };

        if !sign_query
            && (values.present().any(|(_, v)| contains_newline_or_cr(v))
                || search_params.is_some_and(contains_newline_or_cr)
                || contains_newline_or_cr(region)
                || contains_newline_or_cr(&self.access_key_id))
        {
            return Err(SignError::InvalidHeaderValue);
        }

        let mut signed_headers_buf = [0u8; SIGNED_HEADERS_MAX_LEN];
        let signed_headers: &[u8] = values.signed_headers(&mut signed_headers_buf);

        let service_name: &str = "s3";
        let mut tmp_buffer = [0u8; 1024];

        // we hash the hash so we need 2 buffers
        let mut hmac_sig_service = [0u8; bun_sha_hmac::hmac::EVP_MAX_MD_SIZE];
        let mut hmac_sig_service2 = [0u8; bun_sha_hmac::hmac::EVP_MAX_MD_SIZE];

        let sig_date_region_service_req: [u8; DIGESTED_HMAC_256_LEN] = 'brk_sign: {
            let mut cache_key = [0u8; bun_sha_hmac::sha::hashers::SHA256::DIGEST];
            {
                let mut hasher = bun_sha_hmac::sha::hashers::SHA256::init();
                hasher.update(region);
                hasher.update(b"\0");
                hasher.update(service_name.as_bytes());
                hasher.update(b"\0");
                hasher.update(&self.secret_access_key);
                hasher.r#final(&mut cache_key);
            }
            if let Some(cached) = aws_cache_get(date_result.numeric_day, &cache_key) {
                break 'brk_sign cached;
            }
            // not cached yet lets generate a new one
            let mut aws4_key = Vec::with_capacity(4 + self.secret_access_key.len());
            aws4_key.extend_from_slice(b"AWS4");
            aws4_key.extend_from_slice(&self.secret_access_key);
            let sig_date = bun_sha_hmac::generate(
                &aws4_key,
                amz_day,
                bun_sha_hmac::Algorithm::Sha256,
                &mut hmac_sig_service,
            )
            .ok_or(SignError::FailedToGenerateSignature)?;
            bun_core::secure_zero(&mut aws4_key);
            let sig_date_region = bun_sha_hmac::generate(
                sig_date,
                region,
                bun_sha_hmac::Algorithm::Sha256,
                &mut hmac_sig_service2,
            )
            .ok_or(SignError::FailedToGenerateSignature)?;
            let sig_date_region_service = bun_sha_hmac::generate(
                sig_date_region,
                service_name.as_bytes(),
                bun_sha_hmac::Algorithm::Sha256,
                &mut hmac_sig_service,
            )
            .ok_or(SignError::FailedToGenerateSignature)?;
            let _result = bun_sha_hmac::generate(
                sig_date_region_service,
                b"aws4_request",
                bun_sha_hmac::Algorithm::Sha256,
                &mut hmac_sig_service2,
            )
            .ok_or(SignError::FailedToGenerateSignature)?;

            let digest: [u8; DIGESTED_HMAC_256_LEN] = hmac_sig_service2[0..DIGESTED_HMAC_256_LEN]
                .try_into()
                .expect("infallible: size matches");
            aws_cache_set(date_result.numeric_day, &cache_key, digest);
            break 'brk_sign digest;
        };

        // The canonical request is hashed as it is written: method, path,
        // query, canonical headers, signed header names, payload hash.
        let mut canonical = bun_sha_hmac::SHA256::init();
        let mut sha_digest = [0u8; bun_sha_hmac::SHA256::DIGEST];

        if sign_query {
            let mut token_encoded_buffer = [0u8; 2048]; // token is normaly like 600-700 but can be up to 2k
            let mut encoded_session_token: Option<&[u8]> = None;
            if let Some(token) = session_token {
                encoded_session_token = Some(
                    encode_uri_component::<true>(token, &mut token_encoded_buffer)
                        .map_err(|_| SignError::InvalidSessionToken)?,
                );
            }

            // MD5 as base64 (which is required for AWS SigV4) is always 44, when encoded its always 46 (44 + ==)
            let mut content_md5_encoded_buffer = [0u8; 128];
            let mut encoded_content_md5: Option<&[u8]> = None;
            if let Some(content_md5_value) = content_md5_b64.as_deref() {
                encoded_content_md5 = Some(
                    encode_uri_component::<true>(
                        content_md5_value,
                        &mut content_md5_encoded_buffer,
                    )
                    .map_err(|_| SignError::FailedToGenerateSignature)?,
                );
            }

            // Encode response override parameters for presigned URLs
            let mut content_disposition_encoded_buffer = [0u8; 512];
            let mut encoded_content_disposition: Option<&[u8]> = None;
            if let Some(cd) = content_disposition {
                encoded_content_disposition = Some(
                    encode_uri_component::<true>(cd, &mut content_disposition_encoded_buffer)
                        .map_err(|_| SignError::FailedToGenerateSignature)?,
                );
            }

            let mut content_type_encoded_buffer = [0u8; 256];
            let mut encoded_content_type: Option<&[u8]> = None;
            if let Some(ct) = content_type {
                encoded_content_type = Some(
                    encode_uri_component::<true>(ct, &mut content_type_encoded_buffer)
                        .map_err(|_| SignError::FailedToGenerateSignature)?,
                );
            }

            // `;` between the header names becomes `%3B`.
            let mut signed_headers_encoded_buffer = [0u8; SIGNED_HEADERS_ENCODED_MAX_LEN];
            let encoded_signed_headers =
                encode_uri_component::<true>(signed_headers, &mut signed_headers_encoded_buffer)
                    .map_err(|_| SignError::FailedToGenerateSignature)?;

            let query = PresignQuery {
                content_md5: encoded_content_md5,
                acl,
                access_key_id: &self.access_key_id,
                amz_day,
                region,
                amz_date,
                expires,
                session_token: encoded_session_token,
                signed_headers: encoded_signed_headers,
                content_disposition: encoded_content_disposition,
                content_type: encoded_content_type,
                request_payer,
                storage_class,
            };

            let mut query_string: Vec<u8> = Vec::new();
            query.write(&mut query_string, None);

            canonical.update(method_name.as_bytes());
            canonical.update(b"\n");
            canonical.update(normalized_path);
            canonical.update(b"\n");
            canonical.update(&query_string);
            canonical.update(b"\n");
            values.write_canonical_headers(&mut canonical);
            canonical.update(b"\n");
            canonical.update(signed_headers);
            canonical.update(b"\n");
            canonical.update(aws_content_hash);
            canonical.r#final(&mut sha_digest);

            let signature = sign_string_to_sign(
                &mut tmp_buffer,
                &sig_date_region_service_req,
                amz_date,
                amz_day,
                region,
                &sha_digest,
                &mut hmac_sig_service,
            )?;

            // Build final URL with the signature in its alphabetical place.
            query_string.clear();
            query.write(&mut query_string, Some(signature));

            let url = alloc_print!(
                "{}://{}{}?{}",
                protocol,
                BStr::new(host),
                BStr::new(normalized_path),
                BStr::new(&query_string)
            )
            .into_boxed_slice();

            let mut r = SignResult::default();
            r.url = url;
            return Ok(r);
        }

        canonical.update(method_name.as_bytes());
        canonical.update(b"\n");
        canonical.update(normalized_path);
        canonical.update(b"\n");
        canonical.update(search_params.map(|p| &p[1..]).unwrap_or(b""));
        canonical.update(b"\n");
        values.write_canonical_headers(&mut canonical);
        canonical.update(b"\n");
        canonical.update(signed_headers);
        canonical.update(b"\n");
        canonical.update(aws_content_hash);
        canonical.r#final(&mut sha_digest);

        let signature = sign_string_to_sign(
            &mut tmp_buffer,
            &sig_date_region_service_req,
            amz_date,
            amz_day,
            region,
            &sha_digest,
            &mut hmac_sig_service,
        )?;

        // One buffer holds every header value that is not a static string.
        // The `PicoHeader`s below point into it. It is sized exactly, so
        // `into_boxed_slice` does not reallocate.
        let authorization_len = AUTHORIZATION_FIXED_LEN
            + self.access_key_id.len()
            + amz_day.len()
            + region.len()
            + service_name.len()
            + signed_headers.len();
        let mut arena = Arena::with_capacity(
            host.len()
                + amz_date.len()
                + authorization_len
                + session_token.map_or(0, <[u8]>::len)
                + content_disposition.map_or(0, <[u8]>::len)
                + content_encoding.map_or(0, <[u8]>::len)
                + content_md5_b64.as_ref().map_or(0, Vec::len)
                + sse_customer_key.map_or(0, |_| {
                    SseCustomerKey::KEY_B64_LEN + SseCustomerKey::KEY_MD5_B64_LEN
                }),
        );
        let host_range = arena.push(host);
        let date_range = arena.push(amz_date);
        let authorization_range = {
            let start = arena.buf.len();
            write!(
                &mut arena.buf,
                "AWS4-HMAC-SHA256 Credential={}/{}/{}/{}/aws4_request, SignedHeaders={}, Signature={}",
                BStr::new(&self.access_key_id),
                BStr::new(amz_day),
                BStr::new(region),
                service_name,
                BStr::new(signed_headers),
                HexLower(&signature[0..DIGESTED_HMAC_256_LEN])
            )
            .expect("write to Vec<u8> never fails");
            debug_assert_eq!(arena.buf.len() - start, authorization_len);
            start..arena.buf.len()
        };
        let session_token_range = session_token.map(|v| arena.push(v));
        let content_disposition_range = content_disposition.map(|v| arena.push(v));
        let content_encoding_range = content_encoding.map(|v| arena.push(v));
        let content_md5_range = content_md5_b64.as_deref().map(|v| arena.push(v));
        let sse_customer_key_range = sse_customer_key.map(|k| arena.push(k.key_b64()));
        let sse_customer_key_md5_range = sse_customer_key.map(|k| arena.push(k.key_md5_b64()));
        debug_assert_eq!(arena.buf.len(), arena.buf.capacity());
        let arena: Box<[u8]> = arena.buf.into_boxed_slice();

        let url = alloc_print!(
            "{}://{}{}{}",
            protocol,
            BStr::new(host),
            BStr::new(normalized_path),
            BStr::new(search_params.unwrap_or(b""))
        )
        .into_boxed_slice();

        // The same header set as `values`, now pointing into `arena` so the
        // result owns what its headers borrow.
        let owned_values = SignedHeaderValues {
            content_disposition: content_disposition_range.map(|r| &arena[r]),
            content_encoding: content_encoding_range.map(|r| &arena[r]),
            content_md5: content_md5_range.map(|r| &arena[r]),
            host: &arena[host_range],
            acl,
            content_sha256: Some(aws_content_hash),
            date: Some(&arena[date_range]),
            request_payer,
            session_token: session_token_range.map(|r| &arena[r]),
            sse_customer_key: sse_customer_key_range.map(|r| &arena[r]),
            sse_customer_key_md5: sse_customer_key_md5_range.map(|r| &arena[r]),
            storage_class,
        };

        let mut result = SignResult::default();
        // Self-referential: `_headers` borrow from `arena`, a Box<[u8]> that the
        // result owns. `PicoHeader` stores a raw `(ptr, len)` pair, so the heap
        // pointers stay valid across moves of the result.
        for (header, value) in owned_values.present() {
            result._headers[result._headers_len as usize] =
                pico_header_new(header.wire_name(), value);
            result._headers_len += 1;
        }
        result._headers[result._headers_len as usize] =
            pico_header_new(b"Authorization", &arena[authorization_range]);
        result._headers_len += 1;
        result.values = arena;
        result.url = url;

        Ok(result)
    }
}

/// Endpoints this long and longer are refused.
const MAX_ENDPOINT_LEN: usize = 2048;

/// Bytes of the `Authorization` value that do not depend on the request:
/// `AWS4-HMAC-SHA256 Credential=` + `/` x3 + `/aws4_request, SignedHeaders=` +
/// `, Signature=` + 64 hex digits.
const AUTHORIZATION_FIXED_LEN: usize = "AWS4-HMAC-SHA256 Credential=".len()
    + 3
    + "/aws4_request, SignedHeaders=".len()
    + ", Signature=".len()
    + DIGESTED_HMAC_256_LEN * 2;

/// HMAC of the SigV4 string to sign with the derived signing key.
fn sign_string_to_sign<'a>(
    tmp_buffer: &mut [u8],
    signing_key: &[u8; DIGESTED_HMAC_256_LEN],
    amz_date: &[u8],
    amz_day: &[u8],
    region: &[u8],
    canonical_request_hash: &[u8; bun_sha_hmac::SHA256::DIGEST],
    out: &'a mut [u8; bun_sha_hmac::hmac::EVP_MAX_MD_SIZE],
) -> Result<&'a [u8], SignError> {
    let string_to_sign = buf_print(
        tmp_buffer,
        format_args!(
            "AWS4-HMAC-SHA256\n{}\n{}/{}/s3/aws4_request\n{}",
            BStr::new(amz_date),
            BStr::new(amz_day),
            BStr::new(region),
            HexLower(canonical_request_hash)
        ),
    )
    .map_err(|_| SignError::NoSpaceLeft)?;
    bun_sha_hmac::generate(
        signing_key,
        string_to_sign,
        bun_sha_hmac::Algorithm::Sha256,
        out,
    )
    .ok_or(SignError::FailedToGenerateSignature)
}

/// Appends bytes to one growing buffer and hands back where they went.
struct Arena {
    buf: Vec<u8>,
}

impl Arena {
    fn with_capacity(capacity: usize) -> Self {
        Self {
            buf: Vec::with_capacity(capacity),
        }
    }

    fn push(&mut self, bytes: &[u8]) -> core::ops::Range<usize> {
        let start = self.buf.len();
        self.buf.extend_from_slice(bytes);
        start..self.buf.len()
    }
}

/// The query string of a presigned URL. Parameters are written in byte order
/// of their names, as the SigV4 canonical query string requires.
struct PresignQuery<'a> {
    content_md5: Option<&'a [u8]>,
    acl: Option<&'a [u8]>,
    access_key_id: &'a [u8],
    amz_day: &'a [u8],
    region: &'a [u8],
    amz_date: &'a [u8],
    expires: usize,
    session_token: Option<&'a [u8]>,
    signed_headers: &'a [u8],
    content_disposition: Option<&'a [u8]>,
    content_type: Option<&'a [u8]>,
    request_payer: bool,
    storage_class: Option<&'a [u8]>,
}

impl PresignQuery<'_> {
    /// Without `signature` this is the canonical query string. With it, the
    /// query of the final URL.
    fn write(&self, out: &mut Vec<u8>, signature: Option<&[u8]>) {
        let mut first = true;
        let mut param = |out: &mut Vec<u8>, args: core::fmt::Arguments<'_>| {
            if !first {
                out.push(b'&');
            }
            first = false;
            write!(out, "{}", args).expect("write to Vec<u8> never fails");
        };
        if let Some(v) = self.content_md5 {
            param(out, format_args!("Content-MD5={}", BStr::new(v)));
        }
        if let Some(v) = self.acl {
            param(out, format_args!("X-Amz-Acl={}", BStr::new(v)));
        }
        param(out, format_args!("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
        param(
            out,
            format_args!(
                "X-Amz-Credential={}%2F{}%2F{}%2Fs3%2Faws4_request",
                BStr::new(self.access_key_id),
                BStr::new(self.amz_day),
                BStr::new(self.region)
            ),
        );
        param(out, format_args!("X-Amz-Date={}", BStr::new(self.amz_date)));
        param(out, format_args!("X-Amz-Expires={}", self.expires));
        if let Some(token) = self.session_token {
            param(
                out,
                format_args!("X-Amz-Security-Token={}", BStr::new(token)),
            );
        }
        if let Some(signature) = signature {
            param(
                out,
                format_args!(
                    "X-Amz-Signature={}",
                    HexLower(&signature[0..DIGESTED_HMAC_256_LEN])
                ),
            );
        }
        param(
            out,
            format_args!("X-Amz-SignedHeaders={}", BStr::new(self.signed_headers)),
        );
        if let Some(cd) = self.content_disposition {
            param(
                out,
                format_args!("response-content-disposition={}", BStr::new(cd)),
            );
        }
        if let Some(ct) = self.content_type {
            param(out, format_args!("response-content-type={}", BStr::new(ct)));
        }
        if self.request_payer {
            param(out, format_args!("x-amz-request-payer=requester"));
        }
        if let Some(v) = self.storage_class {
            param(out, format_args!("x-amz-storage-class={}", BStr::new(v)));
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// DateResult / getAMZDate
// ──────────────────────────────────────────────────────────────────────────

/// `YYYYMMDDTHHMMSSZ`
const AMZ_DATE_LEN: usize = 16;

struct DateResult {
    /// numeric representation of year, month and day (excluding time components)
    numeric_day: u64,
    date: [u8; AMZ_DATE_LEN],
}

fn get_amz_date() -> DateResult {
    // We can also use Date.now() but would be slower and would add jsc dependency
    // the code below is the same as new Date(Date.now()).toISOString()
    // Date.now() ISO string via JS removed; uses libc gmtime_r

    // Create UTC timestamp.
    let secs: u64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let (year, month, day, hours, minutes, seconds, day_seconds) = epoch_to_utc_components(secs);

    let mut date = [0u8; AMZ_DATE_LEN];
    let written = bun_core::fmt::buf_print_infallible(
        &mut date,
        format_args!(
            "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
            year, month, day, hours, minutes, seconds
        ),
    )
    .len();
    debug_assert_eq!(written, AMZ_DATE_LEN);

    DateResult {
        numeric_day: secs - day_seconds,
        date,
    }
}

// Gregorian Y/M/D from Unix-epoch seconds, using Howard Hinnant's
// `civil_from_days` algorithm (public domain).
fn epoch_to_utc_components(secs: u64) -> (u32, u32, u32, u32, u32, u32, u64) {
    // returns (year, month(1-based), day(1-based), hours, minutes, seconds, seconds_into_day)
    let day_seconds = secs % 86_400;
    let hours = u32::try_from(day_seconds / 3600).expect("int cast");
    let minutes = u32::try_from((day_seconds % 3600) / 60).expect("int cast");
    let seconds = u32::try_from(day_seconds % 60).expect("int cast");

    // civil_from_days (days since 1970-01-01, non-negative for u64 secs)
    let z: i64 = i64::try_from(secs / 86_400).expect("int cast") + 719_468; // shift to 0000-03-01 era origin
    let era: i64 = z.div_euclid(146_097);
    let doe: u64 = u64::try_from(z - era * 146_097).expect("int cast"); // [0, 146096]
    let yoe: u64 = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365; // [0, 399]
    let y: i64 = i64::try_from(yoe).expect("int cast") + era * 400;
    let doy: u64 = doe - (365 * yoe + yoe / 4 - yoe / 100); // [0, 365]
    let mp: u64 = (5 * doy + 2) / 153; // [0, 11]
    let day: u32 = u32::try_from(doy - (153 * mp + 2) / 5 + 1).expect("int cast"); // [1, 31]
    let month: u32 = u32::try_from(if mp < 10 { mp + 3 } else { mp - 9 }).expect("int cast"); // [1, 12]
    let year: u32 = u32::try_from(y + i64::from(month <= 2)).expect("int cast");

    (year, month, day, hours, minutes, seconds, day_seconds)
}

const DIGESTED_HMAC_256_LEN: usize = 32;

// ──────────────────────────────────────────────────────────────────────────
// SignResult
// ──────────────────────────────────────────────────────────────────────────

pub struct SignResult {
    pub url: Box<[u8]>,
    /// The header values that are not static strings: host, date,
    /// authorization, session token, content-*, SSE-C. `_headers` point into it.
    values: Box<[u8]>,
    // Self-referential: entries borrow from `values`. PicoHeader must be a raw
    // (ptr,len) pair; see note in sign_request.
    _headers: [PicoHeader; Self::MAX_HEADERS],
    _headers_len: u8,
}

impl SignResult {
    /// Every signed header plus `Authorization`.
    pub const MAX_HEADERS: usize = SignedHeader::ALL.len() + 1;

    pub fn headers(&self) -> &[PicoHeader] {
        &self._headers[0..self._headers_len as usize]
    }

    pub fn mix_with_header<'b>(
        &self,
        headers_buffer: &'b mut [PicoHeader],
        header: PicoHeader,
    ) -> &'b [PicoHeader] {
        // copy the headers to buffer
        let len = self._headers_len as usize;
        for (i, existing_header) in self._headers[0..len].iter().enumerate() {
            headers_buffer[i] = *existing_header;
        }
        headers_buffer[len] = header;
        &headers_buffer[0..len + 1]
    }
}

impl Default for SignResult {
    fn default() -> Self {
        Self {
            url: Box::default(),
            values: Box::default(),
            _headers: [pico_header_empty(); Self::MAX_HEADERS],
            _headers_len: 0,
        }
    }
}

impl Drop for SignResult {
    fn drop(&mut self) {
        // Zero-before-free for secrets.
        bun_core::secure_zero(&mut self.values);
        bun_core::secure_zero(&mut self.url);
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Options structs
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct SignQueryOptions {
    pub expires: usize,
}

// transient param-pack struct; lifetime added because every field is a caller-owned
// borrow. PORTING.md discourages struct lifetimes, but raw pointers here would be strictly worse.
#[derive(Clone, Copy)]
pub struct SignOptions<'a> {
    pub path: &'a [u8],
    pub method: Method,
    pub content_hash: Option<&'a [u8]>,
    pub content_md5: Option<&'a [u8]>,
    pub search_params: Option<&'a [u8]>,
    pub content_disposition: Option<&'a [u8]>,
    pub content_type: Option<&'a [u8]>,
    pub content_encoding: Option<&'a [u8]>,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    pub request_payer: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// guessBucket / guessRegion
// ──────────────────────────────────────────────────────────────────────────

/// This is not used for signing but for console.log output, is just nice to have
pub fn guess_bucket(endpoint: &[u8]) -> Option<&[u8]> {
    // check if is amazonaws.com
    if strings::index_of(endpoint, b".amazonaws.com").is_some() {
        // check if is .s3. virtual host style
        if let Some(end) = strings::index_of(endpoint, b".s3.") {
            // its https://bucket-name.s3.region-code.amazonaws.com/key-name
            let Some(start) = strings::index_of(endpoint, b"/") else {
                return Some(&endpoint[0..end]);
            };
            return Some(
                endpoint
                    .get(start + 1..end)
                    .unwrap_or_else(|| &endpoint[0..end]),
            );
        }
    } else if let Some(r2_start) = strings::index_of(endpoint, b".r2.cloudflarestorage.com") {
        // check if is <BUCKET>.<ACCOUNT_ID>.r2.cloudflarestorage.com
        let end = strings::index_of(endpoint, b".")?; // actually unreachable
        if end > 0 && r2_start == end {
            // its https://<ACCOUNT_ID>.r2.cloudflarestorage.com
            return None;
        }
        // ok its virtual host style
        let Some(start) = strings::index_of(endpoint, b"/") else {
            return Some(&endpoint[0..end]);
        };
        return Some(
            endpoint
                .get(start + 1..end)
                .unwrap_or_else(|| &endpoint[0..end]),
        );
    }
    None
}

pub fn guess_region(endpoint: &[u8]) -> &[u8] {
    if !endpoint.is_empty() {
        if strings::ends_with(endpoint, b".r2.cloudflarestorage.com") {
            return b"auto";
        }
        if let Some(end) = strings::index_of(endpoint, b".amazonaws.com") {
            if let Some(start) = strings::index_of(endpoint, b"s3.") {
                return endpoint.get(start + 3..end).unwrap_or(b"us-east-1");
            }
        }
        // endpoint is informed but is not s3 so auto detect
        return b"auto";
    }

    // no endpoint so we default to us-east-1 because s3.us-east-1.amazonaws.com is the default endpoint
    b"us-east-1"
}

// ──────────────────────────────────────────────────────────────────────────
// URI encoding helpers
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, thiserror::Error, strum::IntoStaticStr)]
pub enum EncodeError {
    #[error("BufferTooSmall")]
    BufferTooSmall,
}

pub fn encode_uri_component<'b, const ENCODE_SLASH: bool>(
    input: &[u8],
    buffer: &'b mut [u8],
) -> Result<&'b [u8], EncodeError> {
    // returns a borrow into `buffer`; caller must not reuse buffer while result is live.
    let mut written: usize = 0;

    for &c in input {
        match c {
            // RFC 3986 Unreserved Characters (do not encode)
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                if written >= buffer.len() {
                    return Err(EncodeError::BufferTooSmall);
                }
                buffer[written] = c;
                written += 1;
            }
            // All other characters need to be percent-encoded
            _ => {
                if !ENCODE_SLASH && (c == b'/' || c == b'\\') {
                    if written >= buffer.len() {
                        return Err(EncodeError::BufferTooSmall);
                    }
                    buffer[written] = if c == b'\\' { b'/' } else { c };
                    written += 1;
                    continue;
                }
                if written + 3 > buffer.len() {
                    return Err(EncodeError::BufferTooSmall);
                }
                buffer[written] = b'%';
                buffer[written + 1] = bun_core::fmt::hex_char_upper(c >> 4);
                buffer[written + 2] = bun_core::fmt::hex_char_upper(c);
                written += 3;
            }
        }
    }

    // `written <= buffer.len()` by construction; safe sub-slice of the owning buffer.
    Ok(&buffer[..written])
}

fn normalize_name(name: &[u8]) -> &[u8] {
    if name.is_empty() {
        return name;
    }
    strings::trim(name, b"/\\")
}

// ──────────────────────────────────────────────────────────────────────────
// Errors
// ──────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error, strum::IntoStaticStr)]
pub enum SignError {
    #[error("MissingCredentials")]
    MissingCredentials,
    #[error("InvalidMethod")]
    InvalidMethod,
    #[error("InvalidPath")]
    InvalidPath,
    #[error("InvalidEndpoint")]
    InvalidEndpoint,
    #[error("InvalidSessionToken")]
    InvalidSessionToken,
    #[error("InvalidHeaderValue")]
    InvalidHeaderValue,
    #[error("FailedToGenerateSignature")]
    FailedToGenerateSignature,
    #[error("NoSpaceLeft")]
    NoSpaceLeft,
}

impl<'a> Default for SignOptions<'a> {
    fn default() -> Self {
        Self {
            path: b"",
            method: Method::GET,
            content_hash: None,
            content_md5: None,
            search_params: None,
            content_disposition: None,
            content_type: None,
            content_encoding: None,
            acl: None,
            storage_class: None,
            request_payer: false,
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// S3CredentialsWithOptions
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct S3CredentialsWithOptions {
    pub credentials: S3Credentials,
    pub options: MultiPartUploadOptions,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    pub content_disposition: Option<bun_core::Utf8Bytes<'static>>,
    pub content_type: Option<bun_core::Utf8Bytes<'static>>,
    pub content_encoding: Option<bun_core::Utf8Bytes<'static>>,
    /// indicates if requester pays for the request (for requester pays buckets)
    pub request_payer: bool,
    /// indicates if the credentials have changed
    pub changed_credentials: bool,
}

// ──────────────────────────────────────────────────────────────────────────
// Signed headers
// ──────────────────────────────────────────────────────────────────────────

/// Every header the signer can sign. `ALL` lists them in byte order of the
/// lowercase name, which is the order SigV4 wants in CanonicalHeaders and in
/// SignedHeaders.
#[derive(Clone, Copy, PartialEq, Eq)]
enum SignedHeader {
    ContentDisposition,
    ContentEncoding,
    ContentMd5,
    Host,
    Acl,
    ContentSha256,
    Date,
    RequestPayer,
    SecurityToken,
    SseCustomerAlgorithm,
    SseCustomerKey,
    SseCustomerKeyMd5,
    StorageClass,
}

impl SignedHeader {
    const ALL: [SignedHeader; 13] = [
        Self::ContentDisposition,
        Self::ContentEncoding,
        Self::ContentMd5,
        Self::Host,
        Self::Acl,
        Self::ContentSha256,
        Self::Date,
        Self::RequestPayer,
        Self::SecurityToken,
        Self::SseCustomerAlgorithm,
        Self::SseCustomerKey,
        Self::SseCustomerKeyMd5,
        Self::StorageClass,
    ];

    /// The lowercase name, as CanonicalHeaders and SignedHeaders spell it.
    const fn name(self) -> &'static [u8] {
        match self {
            Self::ContentDisposition => b"content-disposition",
            Self::ContentEncoding => b"content-encoding",
            Self::ContentMd5 => b"content-md5",
            Self::Host => b"host",
            Self::Acl => b"x-amz-acl",
            Self::ContentSha256 => b"x-amz-content-sha256",
            Self::Date => b"x-amz-date",
            Self::RequestPayer => b"x-amz-request-payer",
            Self::SecurityToken => b"x-amz-security-token",
            Self::SseCustomerAlgorithm => b"x-amz-server-side-encryption-customer-algorithm",
            Self::SseCustomerKey => b"x-amz-server-side-encryption-customer-key",
            Self::SseCustomerKeyMd5 => b"x-amz-server-side-encryption-customer-key-md5",
            Self::StorageClass => b"x-amz-storage-class",
        }
    }

    /// The name as the request carries it.
    const fn wire_name(self) -> &'static [u8] {
        match self {
            Self::Host => b"Host",
            _ => self.name(),
        }
    }
}

/// Longest `SignedHeaders` value: every name with `;` between them.
const SIGNED_HEADERS_MAX_LEN: usize = {
    let mut n = SignedHeader::ALL.len() - 1;
    let mut i = 0;
    while i < SignedHeader::ALL.len() {
        n += SignedHeader::ALL[i].name().len();
        i += 1;
    }
    n
};

/// `SIGNED_HEADERS_MAX_LEN` after `encode_uri_component`: each `;` is `%3B`.
const SIGNED_HEADERS_ENCODED_MAX_LEN: usize =
    SIGNED_HEADERS_MAX_LEN + 2 * (SignedHeader::ALL.len() - 1);

const _: () = {
    const fn less(a: &[u8], b: &[u8]) -> bool {
        let mut i = 0;
        while i < a.len() && i < b.len() {
            if a[i] != b[i] {
                return a[i] < b[i];
            }
            i += 1;
        }
        a.len() < b.len()
    }
    let mut i = 1;
    while i < SignedHeader::ALL.len() {
        assert!(
            less(SignedHeader::ALL[i - 1].name(), SignedHeader::ALL[i].name()),
            "SignedHeader::ALL must be in byte order of the names"
        );
        i += 1;
    }
};

/// The value of each signed header for one request. `None` leaves the header
/// out of the request and of the signature.
#[derive(Clone, Copy, Default)]
struct SignedHeaderValues<'a> {
    content_disposition: Option<&'a [u8]>,
    content_encoding: Option<&'a [u8]>,
    content_md5: Option<&'a [u8]>,
    host: &'a [u8],
    acl: Option<&'a [u8]>,
    content_sha256: Option<&'a [u8]>,
    date: Option<&'a [u8]>,
    request_payer: bool,
    session_token: Option<&'a [u8]>,
    sse_customer_key: Option<&'a [u8]>,
    sse_customer_key_md5: Option<&'a [u8]>,
    storage_class: Option<&'a [u8]>,
}

impl<'a> SignedHeaderValues<'a> {
    fn value(&self, header: SignedHeader) -> Option<&'a [u8]> {
        match header {
            SignedHeader::ContentDisposition => self.content_disposition,
            SignedHeader::ContentEncoding => self.content_encoding,
            SignedHeader::ContentMd5 => self.content_md5,
            SignedHeader::Host => Some(self.host),
            SignedHeader::Acl => self.acl,
            SignedHeader::ContentSha256 => self.content_sha256,
            SignedHeader::Date => self.date,
            SignedHeader::RequestPayer => self.request_payer.then_some(b"requester"),
            SignedHeader::SecurityToken => self.session_token,
            SignedHeader::SseCustomerAlgorithm => {
                self.sse_customer_key.map(|_| SseCustomerKey::ALGORITHM)
            }
            SignedHeader::SseCustomerKey => self.sse_customer_key,
            SignedHeader::SseCustomerKeyMd5 => self.sse_customer_key_md5,
            SignedHeader::StorageClass => self.storage_class,
        }
    }

    /// The headers that are set, in signing order.
    fn present(&self) -> impl Iterator<Item = (SignedHeader, &'a [u8])> + '_ {
        SignedHeader::ALL
            .iter()
            .filter_map(move |&header| self.value(header).map(|value| (header, value)))
    }

    /// The `SignedHeaders` value: the names of the set headers, `;` between them.
    fn signed_headers<'b>(&self, buf: &'b mut [u8; SIGNED_HEADERS_MAX_LEN]) -> &'b [u8] {
        let mut n = 0usize;
        for (header, _) in self.present() {
            if n > 0 {
                buf[n] = b';';
                n += 1;
            }
            let name = header.name();
            buf[n..n + name.len()].copy_from_slice(name);
            n += name.len();
        }
        &buf[..n]
    }

    /// CanonicalHeaders: one `name:value\n` line per set header.
    fn write_canonical_headers(&self, hasher: &mut bun_sha_hmac::SHA256) {
        for (header, value) in self.present() {
            hasher.update(header.name());
            hasher.update(b":");
            hasher.update(value);
            hasher.update(b"\n");
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/// Returns true if the given slice contains any CR (\r) or LF (\n) characters,
/// which would allow HTTP header injection if used in a header value.
fn contains_newline_or_cr(value: &[u8]) -> bool {
    strings::index_of_any(value, b"\r\n").is_some()
}

fn is_valid_host_component(value: &[u8]) -> bool {
    !value.is_empty()
        && value
            .iter()
            .all(|&c| c.is_ascii_alphanumeric() || c == b'-' || c == b'.' || c == b'_')
}
