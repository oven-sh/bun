use core::mem::size_of;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::BoundedArray;
use bun_core::strings;
use bun_http_types::Method::Method;
use bun_picohttp::Header as PicoHeader;
use bun_ptr::{IntrusiveRc, RawSlice, RefCount, RefCounted};

use super::acl::ACL;
use super::storage_class::StorageClass;

bun_core::declare_scope!(AWS, visible);

use bun_core::fmt::buf_print;

/// `std.fmt.allocPrint` equivalent: build into a fresh Vec<u8>.
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

// TODO(b2-blocked): bun_picohttp::Header::new — fields are private; constructing via
// repr(C) layout-pun until a public ctor lands. Layout is asserted in bun_picohttp.
#[inline]
fn pico_header_new(name: &[u8], value: &[u8]) -> PicoHeader {
    PicoHeader::new(name, value)
}

// ──────────────────────────────────────────────────────────────────────────
// MultiPartUploadOptions
// Moved from bun_runtime::webcore::s3::multipart_options.
// Pure config (no JSC deps), so it lives here at the signing tier; runtime
// re-exports it. Source of truth: src/runtime/webcore/s3/multipart_options.zig
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
    pub const ONE_MIB: usize = 1_048_576;
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
// Zig (`credentials.zig:485`) reached `jsc.VirtualMachine.getMainThreadVM()
// orelse get()).rareData().awsCache` inline. The "per-VM" placement was
// nominal: the lookup always picked the *main-thread* VM, so the cache was
// process-global in practice. Hosting it here as a `static` makes the
// layering honest — `bun_s3_signing` reads its own data, no upward hook.
// ──────────────────────────────────────────────────────────────────────────

use bun_collections::StringArrayHashMap;
use bun_core::Mutex;

/// Memoised SigV4 derived signing key, keyed by `(numeric_day,
/// region+service+secret)`. PORTING.md §Concurrency: lock owns the data — Zig
/// had a sidecar `bun.Mutex` next to `cache`/`date`; here the mutex wraps
/// both.
#[derive(Default)]
pub struct AWSSignatureCache(Mutex<AWSSignatureCacheInner>);

#[derive(Default)]
struct AWSSignatureCacheInner {
    cache: StringArrayHashMap<[u8; DIGESTED_HMAC_256_LEN]>,
    date: u64,
}

impl AWSSignatureCache {
    /// Returns the cached 32-byte derived signing key for `key` if it was set
    /// for `numeric_day`.
    ///
    /// PORT NOTE: Zig returned `cache.getKey(key)` (a borrow into map storage)
    /// past `lock.unlock()` — racy against a concurrent `set` rehashing the
    /// map. Return the 32-byte *value* by copy instead; the only consumer
    /// (`sign` below) wants the digest, and a fixed-size copy avoids handing
    /// out a guard.
    pub fn get(&self, numeric_day: u64, key: &[u8]) -> Option<[u8; DIGESTED_HMAC_256_LEN]> {
        let inner = self.0.lock();
        if inner.date == 0 || inner.date != numeric_day {
            return None;
        }
        inner.cache.get(key).copied()
    }

    pub fn set(&self, numeric_day: u64, key: &[u8], value: [u8; DIGESTED_HMAC_256_LEN]) {
        let mut inner = self.0.lock();
        if inner.date == 0 {
            inner.cache = StringArrayHashMap::new();
        } else if inner.date != numeric_day {
            // day changed so we clean the old cache
            // PORT NOTE: Zig freed each key explicitly; StringArrayHashMap with
            // owned Box<[u8]> keys drops them on clear.
            inner.cache.clear();
        }
        inner.date = numeric_day;
        bun_core::handle_oom(inner.cache.put(key, value));
    }
}

// Drop: `StringArrayHashMap` drops its owned `Box<[u8]>` keys automatically;
// Zig's `deinit { date = 0; clean(); cache.deinit() }` is fully covered.

/// Process-global instance. Zig hung this off `RareData` but always reached it
/// via `getMainThreadVM()`, so it was a singleton in practice.
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

/// BoringSSL `ENGINE*` for `EVP_Digest`. Zig lazily `ENGINE_new()`'d one per
/// VM via `RareData::boringEngine`; BoringSSL's `EVP_Digest` ignores the
/// `impl` argument entirely (it's an OpenSSL-compat shim — see
/// `vendor/boringssl/include/openssl/digest.h`: "BoringSSL does not support
/// engines"). Passing null is bit-identical, so the upward hook is dropped.
#[inline]
fn boring_engine() -> *mut bun_sha_hmac::sha::ffi::ENGINE {
    core::ptr::null_mut()
}

// ──────────────────────────────────────────────────────────────────────────
// S3Credentials
// ──────────────────────────────────────────────────────────────────────────

// `bun.ptr.RefCount(...)` mixin → IntrusiveRc handles ref/deref; when count hits
// zero the boxed allocation is dropped, which drops the Box<[u8]> fields. The
// Zig `deinit` body only freed those fields + `bun.destroy(this)`, so no
// explicit Drop body is needed here.
#[derive(bun_ptr::RefCounted)]
pub struct S3Credentials {
    // Intrusive refcount; managed by bun_ptr::IntrusiveRc<S3Credentials>.
    ref_count: RefCount<S3Credentials>,
    pub access_key_id: Box<[u8]>,
    pub secret_access_key: Box<[u8]>,
    pub region: Box<[u8]>,
    pub endpoint: Box<[u8]>,
    pub bucket: Box<[u8]>,
    pub session_token: Box<[u8]>,
    pub storage_class: Option<StorageClass>,
    /// Important for MinIO support.
    pub insecure_http: bool,
    /// indicates if the endpoint is a virtual hosted style bucket
    pub virtual_hosted_style: bool,
}

// PORT NOTE: Zig `S3Credentials` is a value type with `[]const u8` fields and is
// freely copied (e.g. `default_credentials.*`). The Rust port owns its bytes via
// `Box<[u8]>`, so a manual `Clone` deep-copies them and resets `ref_count` — the
// intrusive count only applies to heap (`IntrusiveRc`) instances; a fresh value
// must start at 1.
impl Clone for S3Credentials {
    fn clone(&self) -> Self {
        Self {
            ref_count: RefCount::init(),
            access_key_id: dupe_slice(&self.access_key_id),
            secret_access_key: dupe_slice(&self.secret_access_key),
            region: dupe_slice(&self.region),
            endpoint: dupe_slice(&self.endpoint),
            bucket: dupe_slice(&self.bucket),
            session_token: dupe_slice(&self.session_token),
            storage_class: self.storage_class,
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
            storage_class: None,
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
    #[allow(clippy::too_many_arguments)]
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
            storage_class: None,
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

    // `hash_const` DELETED — dead code (no callers in Rust or Zig). If
    // resurrected: `bun_wyhash::hash_ascii_lowercase(0, acl)`.

    // Zig: `pub const getCredentialsWithOptions = @import("../runtime/webcore/s3/credentials_jsc.zig").getCredentialsWithOptions;`
    // Deleted per PORTING.md — *_jsc alias; the JS-facing fn lives in the *_jsc crate.

    pub fn dupe(&self) -> IntrusiveRc<S3Credentials> {
        IntrusiveRc::new(S3Credentials {
            ref_count: RefCount::init(),
            access_key_id: dupe_slice(&self.access_key_id),
            secret_access_key: dupe_slice(&self.secret_access_key),
            region: dupe_slice(&self.region),
            endpoint: dupe_slice(&self.endpoint),
            bucket: dupe_slice(&self.bucket),
            session_token: dupe_slice(&self.session_token),
            storage_class: None,
            insecure_http: self.insecure_http,
            virtual_hosted_style: self.virtual_hosted_style,
        })
    }

    pub fn sign_request<const ALLOW_EMPTY_PATH: bool>(
        &self,
        sign_options: SignOptions<'_>,
        sign_query_option: Option<SignQueryOptions>,
    ) -> Result<SignResult, SignError> {
        let method = sign_options.method;
        let request_path = sign_options.path;
        let content_hash = sign_options.content_hash;
        let mut content_md5: Option<Box<[u8]>> = None;

        if let Some(content_md5_val) = sign_options.content_md5 {
            let len = bun_base64::encode_len(content_md5_val);
            let mut content_md5_as_base64 = vec![0u8; len];
            let n = bun_base64::encode(&mut content_md5_as_base64, content_md5_val);
            content_md5_as_base64.truncate(n);
            content_md5 = Some(content_md5_as_base64.into_boxed_slice());
        }

        let search_params = sign_options.search_params;

        let mut content_disposition = sign_options.content_disposition;
        if matches!(content_disposition, Some(s) if s.is_empty()) {
            content_disposition = None;
        }
        let mut content_type = sign_options.content_type;
        if matches!(content_type, Some(s) if s.is_empty()) {
            content_type = None;
        }
        let mut content_encoding = sign_options.content_encoding;
        if matches!(content_encoding, Some(s) if s.is_empty()) {
            content_encoding = None;
        }
        let session_token: Option<&[u8]> = if self.session_token.is_empty() {
            None
        } else {
            Some(&self.session_token)
        };

        let acl: Option<&'static [u8]> = sign_options.acl.map(|a| a.to_string());
        let storage_class: Option<&'static [u8]> =
            sign_options.storage_class.map(|s| s.to_string());

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
        if strings::starts_with(full_path, b"/") {
            full_path = &full_path[1..];
        } else if strings::starts_with(full_path, b"\\") {
            full_path = &full_path[1..];
        }

        let mut path: &[u8] = full_path;
        let mut bucket: &[u8] = &self.bucket;

        if !self.virtual_hosted_style {
            if bucket.is_empty() {
                // guess bucket using path
                if let Some(end) = strings::index_of(full_path, b"/") {
                    if let Some(backslash_index) = strings::index_of(full_path, b"\\") {
                        if backslash_index < end {
                            bucket = &full_path[..backslash_index];
                            path = &full_path[backslash_index + 1..];
                        }
                    }
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
        let mut endpoint_owned: Option<Vec<u8>> = None;
        let mut extra_path: &[u8] = b"";
        let host: Box<[u8]> = 'brk_host: {
            if !self.endpoint.is_empty() {
                if self.endpoint.len() >= 2048 {
                    return Err(SignError::InvalidEndpoint);
                }
                let mut host: &[u8] = &self.endpoint;
                if let Some(index) = strings::index_of(&self.endpoint, b"/") {
                    host = &self.endpoint[..index];
                    extra_path = &self.endpoint[index..];
                }
                // only the host part is needed here
                break 'brk_host Box::<[u8]>::from(host);
            } else {
                if self.virtual_hosted_style {
                    // virtual hosted style requires a bucket name if an endpoint is not provided
                    if bucket.is_empty() {
                        return Err(SignError::InvalidEndpoint);
                    }
                    // default to https://<BUCKET_NAME>.s3.<REGION>.amazonaws.com/
                    let mut v = Vec::new();
                    write!(
                        &mut v,
                        "{}.s3.{}.amazonaws.com",
                        BStr::new(bucket),
                        BStr::new(region)
                    )
                    .unwrap();
                    endpoint_owned = Some(v.clone());
                    break 'brk_host v.into_boxed_slice();
                }
                let mut v = Vec::new();
                write!(&mut v, "s3.{}.amazonaws.com", BStr::new(region))
                    .expect("infallible: in-memory write");
                endpoint_owned = Some(v.clone());
                break 'brk_host v.into_boxed_slice();
            }
        };
        let _ = endpoint_owned; // PORT NOTE: in Zig `endpoint` was reassigned for later reuse; not read after this point.
        // errdefer free(host) — Box<[u8]> drops on `?`.

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
                    format_args!("{}/{}/{}", BStr::new(extra_path), BStr::new(bucket), BStr::new(path)),
                )
                .map_err(|_| SignError::InvalidPath)?;
            }
        };

        let date_result = get_amz_date();
        let amz_date: Box<[u8]> = date_result.date;
        // errdefer free(amz_date) — Box<[u8]> drops on `?`.

        let amz_day = &amz_date[0..8];
        let request_payer = sign_options.request_payer;
        let header_key = SignedHeadersKey {
            content_disposition: content_disposition.is_some(),
            content_encoding: content_encoding.is_some(),
            content_md5: content_md5.is_some(),
            acl: acl.is_some(),
            request_payer,
            session_token: session_token.is_some(),
            storage_class: storage_class.is_some(),
        };
        let mut signed_headers_buf = [0u8; 256];
        let signed_headers: &[u8] = if sign_query {
            b"host"
        } else {
            SignedHeaders::get(header_key, &mut signed_headers_buf)
        };

        let service_name: &str = "s3";

        let aws_content_hash: &[u8] = content_hash.unwrap_or(b"UNSIGNED-PAYLOAD");
        let mut tmp_buffer = [0u8; 4096];

        let authorization: Box<[u8]> = 'brk: {
            // we hash the hash so we need 2 buffers
            let mut hmac_sig_service = [0u8; bun_sha_hmac::hmac::EVP_MAX_MD_SIZE];
            let mut hmac_sig_service2 = [0u8; bun_sha_hmac::hmac::EVP_MAX_MD_SIZE];

            let sig_date_region_service_req: [u8; DIGESTED_HMAC_256_LEN] = 'brk_sign: {
                let key = buf_print(
                    &mut tmp_buffer,
                    format_args!("{}{}{}", BStr::new(region), service_name, BStr::new(&self.secret_access_key)),
                )
                .map_err(|_| SignError::NoSpaceLeft)?;
                // PORT NOTE: was `bun_jsc::VirtualMachine::get*().rare_data().aws_cache()`.
                // Storage moved DOWN — `AWS_SIGNATURE_CACHE` is a process static here.
                if let Some(cached) = aws_cache_get(date_result.numeric_day, key) {
                    break 'brk_sign cached;
                }
                // not cached yet lets generate a new one
                let aws4_key = buf_print(
                    &mut tmp_buffer,
                    format_args!("AWS4{}", BStr::new(&self.secret_access_key)),
                )
                .map_err(|_| SignError::NoSpaceLeft)?;
                let sig_date = bun_sha_hmac::generate(
                    aws4_key,
                    amz_day,
                    bun_sha_hmac::Algorithm::Sha256,
                    &mut hmac_sig_service,
                )
                .ok_or(SignError::FailedToGenerateSignature)?;
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

                let digest: [u8; DIGESTED_HMAC_256_LEN] = hmac_sig_service2
                    [0..DIGESTED_HMAC_256_LEN]
                    .try_into()
                    .expect("infallible: size matches");
                // PORT NOTE: intentionally diverges from Zig. In Zig, `key` is a slice into
                // `tmp_buffer` which has since been overwritten by the `AWS4{secret}` bufPrint,
                // so Zig passes corrupted bytes to `cache.set` (latent bug → cache never hits).
                // We recompute the correct `{region}{service}{secret}` key here.
                // TODO(port): fix the overwritten-key bug in credentials.zig as well.
                let key = buf_print(
                    &mut tmp_buffer,
                    format_args!("{}{}{}", BStr::new(region), service_name, BStr::new(&self.secret_access_key)),
                )
                .map_err(|_| SignError::NoSpaceLeft)?;
                aws_cache_set(date_result.numeric_day, key, digest);
                break 'brk_sign digest;
            };

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
                if let Some(content_md5_value) = content_md5.as_deref() {
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

                // Build query parameters in alphabetical order for AWS Signature V4 canonical request
                let canonical: &[u8] = 'brk_canonical: {
                    // PERF(port): was stack-fallback alloc
                    let mut query_parts: BoundedArray<Vec<u8>, 13> = BoundedArray::default();

                    // Add parameters in alphabetical order: Content-MD5, X-Amz-Acl, X-Amz-Algorithm, X-Amz-Credential, X-Amz-Date, X-Amz-Expires, X-Amz-Security-Token, X-Amz-SignedHeaders, response-content-disposition, response-content-type, x-amz-request-payer, x-amz-storage-class

                    if let Some(v) = encoded_content_md5 {
                        let _ = query_parts.push(alloc_print!("Content-MD5={}", BStr::new(v))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    }
                    if let Some(v) = acl {
                        let _ = query_parts.push(alloc_print!("X-Amz-Acl={}", BStr::new(v))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    }
                    let _ = query_parts.push(alloc_print!("X-Amz-Algorithm=AWS4-HMAC-SHA256")); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    let _ = query_parts.push(alloc_print!(
                        "X-Amz-Credential={}%2F{}%2F{}%2F{}%2Faws4_request",
                        BStr::new(&self.access_key_id),
                        BStr::new(amz_day),
                        BStr::new(region),
                        service_name
                    ));
                    let _ = query_parts.push(alloc_print!("X-Amz-Date={}", BStr::new(&amz_date))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    let _ = query_parts.push(alloc_print!("X-Amz-Expires={}", expires)); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    if let Some(token) = encoded_session_token {
                        let _ = query_parts
                            .push(alloc_print!("X-Amz-Security-Token={}", BStr::new(token))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    }
                    let _ = query_parts.push(alloc_print!("X-Amz-SignedHeaders=host")); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    if let Some(cd) = encoded_content_disposition {
                        // OOM/capacity: Zig aborts; port keeps fire-and-forget
                        let _ = query_parts.push(alloc_print!(
                            "response-content-disposition={}",
                            BStr::new(cd)
                        ));
                    }
                    if let Some(ct) = encoded_content_type {
                        let _ = query_parts
                            .push(alloc_print!("response-content-type={}", BStr::new(ct))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    }
                    if request_payer {
                        let _ = query_parts.push(alloc_print!("x-amz-request-payer=requester")); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    }
                    if let Some(v) = storage_class {
                        let _ =
                            query_parts.push(alloc_print!("x-amz-storage-class={}", BStr::new(v))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    }

                    // Join query parameters with &
                    let mut query_string: Vec<u8> = Vec::new();
                    for (i, part) in query_parts.as_slice().iter().enumerate() {
                        if i > 0 {
                            query_string.push(b'&');
                        }
                        query_string.extend_from_slice(part);
                    }

                    break 'brk_canonical buf_print(
                        &mut tmp_buffer,
                        format_args!(
                            "{}\n{}\n{}\nhost:{}\n\nhost\n{}",
                            method_name,
                            BStr::new(normalized_path),
                            BStr::new(&query_string),
                            BStr::new(&host),
                            BStr::new(aws_content_hash)
                        ),
                    )
                    .map_err(|_| SignError::NoSpaceLeft)?;
                };
                let mut sha_digest = [0u8; bun_sha_hmac::SHA256::DIGEST];
                // PORT NOTE: was `bun_jsc::VirtualMachine::get().rare_data().boring_engine()`;
                // BoringSSL ignores the ENGINE arg, so pass null (see `boring_engine()` doc).
                bun_sha_hmac::SHA256::hash(canonical, &mut sha_digest, boring_engine());

                let sign_value = buf_print(
                    &mut tmp_buffer,
                    format_args!(
                        "AWS4-HMAC-SHA256\n{}\n{}/{}/{}/aws4_request\n{}",
                        BStr::new(&amz_date),
                        BStr::new(amz_day),
                        BStr::new(region),
                        service_name,
                        HexLower(&sha_digest)
                    ),
                )
                .map_err(|_| SignError::NoSpaceLeft)?;

                let signature = bun_sha_hmac::generate(
                    &sig_date_region_service_req,
                    sign_value,
                    bun_sha_hmac::Algorithm::Sha256,
                    &mut hmac_sig_service,
                )
                .ok_or(SignError::FailedToGenerateSignature)?;

                // Build final URL with query parameters in alphabetical order to match canonical request
                // PERF(port): was stack-fallback alloc
                let mut url_query_parts: BoundedArray<Vec<u8>, 14> = BoundedArray::default();

                // Add parameters in alphabetical order: Content-MD5, X-Amz-Acl, X-Amz-Algorithm, X-Amz-Credential, X-Amz-Date, X-Amz-Expires, X-Amz-Security-Token, X-Amz-Signature, X-Amz-SignedHeaders, response-content-disposition, response-content-type, x-amz-request-payer, x-amz-storage-class

                if let Some(v) = encoded_content_md5 {
                    let _ = url_query_parts.push(alloc_print!("Content-MD5={}", BStr::new(v))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                }
                if let Some(v) = acl {
                    let _ = url_query_parts.push(alloc_print!("X-Amz-Acl={}", BStr::new(v))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                }
                let _ = url_query_parts.push(alloc_print!("X-Amz-Algorithm=AWS4-HMAC-SHA256")); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                // OOM/capacity: Zig aborts; port keeps fire-and-forget
                let _ = url_query_parts.push(alloc_print!(
                    "X-Amz-Credential={}%2F{}%2F{}%2F{}%2Faws4_request",
                    BStr::new(&self.access_key_id),
                    BStr::new(amz_day),
                    BStr::new(region),
                    service_name
                ));
                let _ = url_query_parts.push(alloc_print!("X-Amz-Date={}", BStr::new(&amz_date))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                let _ = url_query_parts.push(alloc_print!("X-Amz-Expires={}", expires)); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                if let Some(token) = encoded_session_token {
                    let _ = url_query_parts
                        .push(alloc_print!("X-Amz-Security-Token={}", BStr::new(token))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                }
                // OOM/capacity: Zig aborts; port keeps fire-and-forget
                let _ = url_query_parts.push(alloc_print!(
                    "X-Amz-Signature={}",
                    HexLower(&signature[0..DIGESTED_HMAC_256_LEN])
                ));
                let _ = url_query_parts.push(alloc_print!("X-Amz-SignedHeaders=host")); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                if let Some(cd) = encoded_content_disposition {
                    // OOM/capacity: Zig aborts; port keeps fire-and-forget
                    let _ = url_query_parts.push(alloc_print!(
                        "response-content-disposition={}",
                        BStr::new(cd)
                    ));
                }
                if let Some(ct) = encoded_content_type {
                    let _ = url_query_parts
                        .push(alloc_print!("response-content-type={}", BStr::new(ct))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                }
                if request_payer {
                    let _ = url_query_parts.push(alloc_print!("x-amz-request-payer=requester")); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                }
                if let Some(v) = storage_class {
                    let _ =
                        url_query_parts.push(alloc_print!("x-amz-storage-class={}", BStr::new(v))); // OOM/capacity: Zig aborts; port keeps fire-and-forget
                }

                // Join URL query parameters with &
                let mut url_query_string: Vec<u8> = Vec::new();
                for (i, part) in url_query_parts.as_slice().iter().enumerate() {
                    if i > 0 {
                        url_query_string.push(b'&');
                    }
                    url_query_string.extend_from_slice(part);
                }

                break 'brk alloc_print!(
                    "{}://{}{}?{}",
                    protocol,
                    BStr::new(&host),
                    BStr::new(normalized_path),
                    BStr::new(&url_query_string)
                )
                .into_boxed_slice();
            } else {
                let canonical = CanonicalRequest::format(
                    &mut tmp_buffer,
                    header_key,
                    method_name.as_bytes(),
                    normalized_path,
                    search_params.map(|p| &p[1..]).unwrap_or(b""),
                    content_disposition,
                    content_encoding,
                    content_md5.as_deref(),
                    &host,
                    acl,
                    aws_content_hash,
                    &amz_date,
                    session_token,
                    storage_class,
                    signed_headers,
                )
                .map_err(|_| SignError::NoSpaceLeft)?;
                let mut sha_digest = [0u8; bun_sha_hmac::SHA256::DIGEST];
                // PORT NOTE: was `bun_jsc::VirtualMachine::get().rare_data().boring_engine()`;
                // BoringSSL ignores the ENGINE arg, so pass null (see `boring_engine()` doc).
                bun_sha_hmac::SHA256::hash(canonical, &mut sha_digest, boring_engine());

                let sign_value = buf_print(
                    &mut tmp_buffer,
                    format_args!(
                        "AWS4-HMAC-SHA256\n{}\n{}/{}/{}/aws4_request\n{}",
                        BStr::new(&amz_date),
                        BStr::new(amz_day),
                        BStr::new(region),
                        service_name,
                        HexLower(&sha_digest)
                    ),
                )
                .map_err(|_| SignError::NoSpaceLeft)?;

                let signature = bun_sha_hmac::generate(
                    &sig_date_region_service_req,
                    sign_value,
                    bun_sha_hmac::Algorithm::Sha256,
                    &mut hmac_sig_service,
                )
                .ok_or(SignError::FailedToGenerateSignature)?;

                break 'brk alloc_print!(
                    "AWS4-HMAC-SHA256 Credential={}/{}/{}/{}/aws4_request, SignedHeaders={}, Signature={}",
                    BStr::new(&self.access_key_id),
                    BStr::new(amz_day),
                    BStr::new(region),
                    service_name,
                    BStr::new(signed_headers),
                    HexLower(&signature[0..DIGESTED_HMAC_256_LEN])
                )
                .into_boxed_slice();
            }
        };
        // errdefer free(authorization) — Box<[u8]> drops on `?`.

        if sign_query {
            // defer free(host); defer free(amz_date); — drop at scope exit.
            // PORT NOTE: SignResult implements Drop, so struct-update `..default()`
            // is forbidden; mutate a default in place instead.
            let mut r = SignResult::default();
            r.acl = sign_options.acl;
            r.url = authorization;
            r.storage_class = sign_options.storage_class;
            return Ok(r);
        }

        if contains_newline_or_cr(aws_content_hash)
            || acl.is_some_and(contains_newline_or_cr)
            || storage_class.is_some_and(contains_newline_or_cr)
            || content_md5.as_deref().is_some_and(contains_newline_or_cr)
            || content_disposition.is_some_and(contains_newline_or_cr)
            || content_encoding.is_some_and(contains_newline_or_cr)
            || session_token.is_some_and(contains_newline_or_cr)
        {
            return Err(SignError::InvalidHeaderValue);
        }

        let url = alloc_print!(
            "{}://{}{}{}",
            protocol,
            BStr::new(&host),
            BStr::new(normalized_path),
            BStr::new(search_params.unwrap_or(b""))
        )
        .into_boxed_slice();

        // PORT NOTE: SignResult implements Drop, so struct-update `..default()` is forbidden.
        let mut result = SignResult::default();
        result.amz_date = amz_date;
        result.host = host;
        result.authorization = authorization;
        result.acl = sign_options.acl;
        result.storage_class = sign_options.storage_class;
        result.request_payer = request_payer;
        result.url = url;
        result._headers_len = 4;
        // TODO(port): self-referential — _headers borrows from owned Box<[u8]> fields on SignResult.
        // bun_picohttp::Header stores raw `*const u8, len` (verified), so the heap pointers stay
        // valid across SignResult moves. SAFETY relies on the Box<[u8]> fields not being mutated
        // after the corresponding header is written.
        result._headers[0] = pico_header_new(b"x-amz-content-sha256", aws_content_hash);
        result._headers[1] = pico_header_new(b"x-amz-date", &result.amz_date);
        result._headers[2] = pico_header_new(b"Host", &result.host);
        result._headers[3] = pico_header_new(b"Authorization", &result.authorization);

        if let Some(acl_value) = acl {
            result._headers[result._headers_len as usize] =
                pico_header_new(b"x-amz-acl", acl_value);
            result._headers_len += 1;
        }

        if let Some(token) = session_token {
            let session_token_value = Box::<[u8]>::from(token);
            result._headers[result._headers_len as usize] =
                pico_header_new(b"x-amz-security-token", &session_token_value);
            result.session_token = session_token_value;
            result._headers_len += 1;
        }
        if let Some(storage_class_value) = storage_class {
            result._headers[result._headers_len as usize] =
                pico_header_new(b"x-amz-storage-class", storage_class_value);
            result._headers_len += 1;
        }

        if let Some(cd) = content_disposition {
            let content_disposition_value = Box::<[u8]>::from(cd);
            result._headers[result._headers_len as usize] =
                pico_header_new(b"content-disposition", &content_disposition_value);
            result.content_disposition = content_disposition_value;
            result._headers_len += 1;
        }

        if let Some(ce) = content_encoding {
            let content_encoding_value = Box::<[u8]>::from(ce);
            result._headers[result._headers_len as usize] =
                pico_header_new(b"content-encoding", &content_encoding_value);
            result.content_encoding = content_encoding_value;
            result._headers_len += 1;
        }

        if let Some(c_md5) = content_md5.as_deref() {
            let content_md5_value = Box::<[u8]>::from(c_md5);
            result._headers[result._headers_len as usize] =
                pico_header_new(b"content-md5", &content_md5_value);
            result.content_md5 = content_md5_value;
            result._headers_len += 1;
        }

        if request_payer {
            result._headers[result._headers_len as usize] =
                pico_header_new(b"x-amz-request-payer", b"requester");
            result._headers_len += 1;
        }

        Ok(result)
    }
}

use bun_ptr::owned::alloc_dupe_slice as dupe_slice;

// ──────────────────────────────────────────────────────────────────────────
// DateResult / getAMZDate
// ──────────────────────────────────────────────────────────────────────────

struct DateResult {
    /// numeric representation of year, month and day (excluding time components)
    numeric_day: u64,
    date: Box<[u8]>,
}

fn get_amz_date() -> DateResult {
    // We can also use Date.now() but would be slower and would add jsc dependency
    // the code below is the same as new Date(Date.now()).toISOString()
    // Date.now() ISO string via JS removed; uses libc gmtime_r

    // Create UTC timestamp
    // TODO(port): Zig used std.time.milliTimestamp() + std.time.epoch helpers. Replace with
    // bun_core::time equivalents in Phase B; using std::time here is OK (not banned).
    let secs: u64 = u64::try_from(
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_secs(),
    )
    .unwrap();
    let (year, month, day, hours, minutes, seconds, day_seconds) = epoch_to_utc_components(secs);

    DateResult {
        numeric_day: secs - day_seconds,
        date: alloc_print!(
            "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
            year,
            month,
            day,
            hours,
            minutes,
            seconds
        )
        .into_boxed_slice(),
    }
}

// Port of Zig std.time.epoch.{EpochSeconds, EpochDay, YearAndDay} → Gregorian Y/M/D from
// Unix-epoch seconds. Uses Howard Hinnant's `civil_from_days` algorithm (public domain),
// which is what Zig's stdlib derives from. Matches credentials.zig:116-123 exactly for the
// fields getAMZDate consumes.
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

pub const DIGESTED_HMAC_256_LEN: usize = 32;

// ──────────────────────────────────────────────────────────────────────────
// SignResult
// ──────────────────────────────────────────────────────────────────────────

pub struct SignResult {
    pub amz_date: Box<[u8]>,
    pub host: Box<[u8]>,
    pub authorization: Box<[u8]>,
    pub url: Box<[u8]>,

    pub content_disposition: Box<[u8]>,
    pub content_encoding: Box<[u8]>,
    pub content_md5: Box<[u8]>,
    pub session_token: Box<[u8]>,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    pub request_payer: bool,
    // TODO(port): self-referential — entries borrow from the Box<[u8]> fields above. PicoHeader
    // must be a raw (ptr,len) pair; see note in sign_request.
    pub _headers: [PicoHeader; Self::MAX_HEADERS],
    pub _headers_len: u8,
}

impl SignResult {
    pub const MAX_HEADERS: usize = 11;

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
            amz_date: Box::default(),
            host: Box::default(),
            authorization: Box::default(),
            url: Box::default(),
            content_disposition: Box::default(),
            content_encoding: Box::default(),
            content_md5: Box::default(),
            session_token: Box::default(),
            acl: None,
            storage_class: None,
            request_payer: false,
            _headers: [pico_header_empty(); Self::MAX_HEADERS],
            _headers_len: 0,
        }
    }
}

impl Drop for SignResult {
    fn drop(&mut self) {
        // Zig used bun.freeSensitive (zero-before-free) for secrets.
        zero_sensitive(&mut self.amz_date);
        zero_sensitive(&mut self.session_token);
        zero_sensitive(&mut self.content_disposition);
        zero_sensitive(&mut self.content_encoding);
        zero_sensitive(&mut self.host);
        zero_sensitive(&mut self.authorization);
        zero_sensitive(&mut self.url);
        // content_md5 was a plain free in Zig; Box drop handles it.
    }
}

#[inline]
fn zero_sensitive(b: &mut Box<[u8]>) {
    // SAFETY: `b` is exclusively borrowed; `len` bytes are valid for writes.
    unsafe { bun_core::secure_zero(b.as_mut_ptr(), b.len()) };
}

// ──────────────────────────────────────────────────────────────────────────
// Options structs
// ──────────────────────────────────────────────────────────────────────────

#[derive(Clone, Copy)]
pub struct SignQueryOptions {
    pub expires: usize,
}

impl Default for SignQueryOptions {
    fn default() -> Self {
        Self { expires: 86400 }
    }
}

// PORT NOTE: transient param-pack struct; lifetime added because every field is a caller-owned
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
            return Some(&endpoint[start + 1..end]);
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
        return Some(&endpoint[start + 1..end]);
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
                return &endpoint[start + 3..end];
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
    // PORT NOTE: returns a borrow into `buffer`; caller must not reuse buffer while result is live.
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

bun_core::named_error_set!(SignError);

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
    // Self-referential views: these `?[]const u8` fields are NOT freed in Zig
    // `deinit`; they borrow into the sibling `_*_slice: ZigStringSlice` fields
    // below. `RawSlice` encodes that non-owning contract (and gives callers
    // `.as_deref()` instead of an open-coded `unsafe { &*p }`).
    pub content_disposition: Option<RawSlice<u8>>,
    pub content_type: Option<RawSlice<u8>>,
    pub content_encoding: Option<RawSlice<u8>>,
    /// indicates if requester pays for the request (for requester pays buckets)
    pub request_payer: bool,
    /// indicates if the credentials have changed
    pub changed_credentials: bool,
    /// indicates if the virtual hosted style is used
    pub virtual_hosted_style: bool,
    pub _access_key_id_slice: Option<bun_core::ZigStringSlice>,
    pub _secret_access_key_slice: Option<bun_core::ZigStringSlice>,
    pub _region_slice: Option<bun_core::ZigStringSlice>,
    pub _endpoint_slice: Option<bun_core::ZigStringSlice>,
    pub _bucket_slice: Option<bun_core::ZigStringSlice>,
    pub _session_token_slice: Option<bun_core::ZigStringSlice>,
    pub _content_disposition_slice: Option<bun_core::ZigStringSlice>,
    pub _content_type_slice: Option<bun_core::ZigStringSlice>,
    pub _content_encoding_slice: Option<bun_core::ZigStringSlice>,
}

// `deinit` only called .deinit() on each Option<ZigStringSlice>; ZigStringSlice impls Drop, so
// the body is empty — no explicit Drop needed.

// ──────────────────────────────────────────────────────────────────────────
// SignedHeaders — runtime port of Zig comptime lookup table
// ──────────────────────────────────────────────────────────────────────────

/// Headers must be in alphabetical order per AWS Signature V4 spec.
// TODO(port): Zig `packed struct(u7)` (all-bool fields). Kept as a plain struct for
// readability of `key.field` accesses in SignedHeaders/CanonicalRequest; bitflags!/
// `#[repr(transparent)] u8` deferred to Phase B. `bits()` below preserves the u7 layout.
#[derive(Clone, Copy, Default)]
pub struct SignedHeadersKey {
    pub content_disposition: bool,
    pub content_encoding: bool,
    pub content_md5: bool,
    pub acl: bool,
    pub request_payer: bool,
    pub session_token: bool,
    pub storage_class: bool,
}

impl SignedHeadersKey {
    #[inline]
    pub const fn bits(self) -> u8 {
        (self.content_disposition as u8)
            | ((self.content_encoding as u8) << 1)
            | ((self.content_md5 as u8) << 2)
            | ((self.acl as u8) << 3)
            | ((self.request_payer as u8) << 4)
            | ((self.session_token as u8) << 5)
            | ((self.storage_class as u8) << 6)
    }
}

struct SignedHeaders;

impl SignedHeaders {
    // PERF(port): Zig builds a comptime [128]&'static str table via string concatenation.
    // Rust cannot concat &str in a const loop, so we build at runtime into a caller buffer.
    // Phase B may switch to a build.rs-generated static table if profiling shows this matters.
    fn get(key: SignedHeadersKey, buf: &mut [u8; 256]) -> &[u8] {
        let mut n = 0usize;
        macro_rules! push {
            ($s:expr) => {{
                let s: &[u8] = $s;
                buf[n..n + s.len()].copy_from_slice(s);
                n += s.len();
            }};
        }
        if key.content_disposition {
            push!(b"content-disposition;");
        }
        if key.content_encoding {
            push!(b"content-encoding;");
        }
        if key.content_md5 {
            push!(b"content-md5;");
        }
        push!(b"host;");
        if key.acl {
            push!(b"x-amz-acl;");
        }
        push!(b"x-amz-content-sha256;x-amz-date");
        if key.request_payer {
            push!(b";x-amz-request-payer");
        }
        if key.session_token {
            push!(b";x-amz-security-token");
        }
        if key.storage_class {
            push!(b";x-amz-storage-class");
        }
        // SAFETY: n <= 256 by construction.
        unsafe { core::slice::from_raw_parts(buf.as_ptr(), n) }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// CanonicalRequest — runtime port of Zig comptime format-string dispatch
// ──────────────────────────────────────────────────────────────────────────

struct CanonicalRequest;

impl CanonicalRequest {
    // PERF(port): Zig generates 128 monomorphized format strings and dispatches via
    // `switch (bits) { inline 0..127 => |idx| ... }`. We build the canonical request at
    // runtime with conditional writes. Same output bytes; profile in Phase B.
    pub(crate) fn format<'b>(
        buf: &'b mut [u8],
        key: SignedHeadersKey,
        method: &[u8],
        path: &[u8],
        query: &[u8],
        content_disposition: Option<&[u8]>,
        content_encoding: Option<&[u8]>,
        content_md5: Option<&[u8]>,
        host: &[u8],
        acl: Option<&[u8]>,
        hash: &[u8],
        date: &[u8],
        session_token: Option<&[u8]>,
        storage_class: Option<&[u8]>,
        signed_headers: &[u8],
    ) -> Result<&'b [u8], core::fmt::Error> {
        let mut c = bun_core::fmt::SliceCursor::new(buf);
        macro_rules! w {
            ($($arg:tt)*) => { core::fmt::Write::write_fmt(&mut c, format_args!($($arg)*))? };
        }
        // method, path, query
        w!(
            "{}\n{}\n{}\n",
            BStr::new(method),
            BStr::new(path),
            BStr::new(query)
        );
        if key.content_disposition {
            w!(
                "content-disposition:{}\n",
                BStr::new(content_disposition.unwrap())
            );
        }
        if key.content_encoding {
            w!(
                "content-encoding:{}\n",
                BStr::new(content_encoding.unwrap())
            );
        }
        if key.content_md5 {
            w!("content-md5:{}\n", BStr::new(content_md5.unwrap()));
        }
        w!("host:{}\n", BStr::new(host));
        if key.acl {
            w!("x-amz-acl:{}\n", BStr::new(acl.unwrap()));
        }
        w!(
            "x-amz-content-sha256:{}\nx-amz-date:{}\n",
            BStr::new(hash),
            BStr::new(date)
        );
        if key.request_payer {
            w!("x-amz-request-payer:requester\n");
        }
        if key.session_token {
            w!(
                "x-amz-security-token:{}\n",
                BStr::new(session_token.unwrap())
            );
        }
        if key.storage_class {
            w!(
                "x-amz-storage-class:{}\n",
                BStr::new(storage_class.unwrap())
            );
        }
        // signed_headers, hash
        w!("\n{}\n{}", BStr::new(signed_headers), BStr::new(hash));

        let len = c.at;
        Ok(&c.buf[..len])
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

// ported from: src/s3_signing/credentials.zig
