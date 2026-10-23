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

use bun_core::fmt::buf_print_len;

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
    pub(crate) storage_class: Option<StorageClass>,
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

    pub fn dupe(&self) -> RefPtr<S3Credentials> {
        RefPtr::new(S3Credentials {
            ref_count: RefCount::init(),
            access_key_id: self.access_key_id.clone(),
            secret_access_key: self.secret_access_key.clone(),
            region: self.region.clone(),
            endpoint: self.endpoint.clone(),
            bucket: self.bucket.clone(),
            session_token: self.session_token.clone(),
            storage_class: None,
            insecure_http: self.insecure_http,
            virtual_hosted_style: self.virtual_hosted_style,
        })
    }

    pub fn sign_request<const ALLOW_EMPTY_PATH: bool>(
        &self,
        sign_options: &SignOptions<'_>,
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

        if path.len() > MAX_KEY_LEN {
            return Err(SignError::InvalidPath);
        }
        // Default to https. Only use http if they explicit pass "http://" as the endpoint.
        let protocol: &str = if self.insecure_http { "http" } else { "https" };

        // detect service name and host from region or endpoint
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
                if !is_valid_host_component(region) {
                    return Err(SignError::InvalidEndpoint);
                }
                if self.virtual_hosted_style {
                    // virtual hosted style requires a bucket name if an endpoint is not provided
                    if bucket.is_empty() {
                        return Err(SignError::InvalidEndpoint);
                    }
                    // The bucket is interpolated into the host; a `/` (or `\`,
                    // which encode_uri_component_into writes as `/`) would let a
                    // crafted bucket redirect the signed request to another host.
                    if strings::index_of_any(bucket, b"/\\").is_some() {
                        return Err(SignError::InvalidEndpoint);
                    }
                    // default to https://<BUCKET_NAME>.s3.<REGION>.amazonaws.com/
                    let mut v = Vec::with_capacity(
                        encoded_len::<false>(bucket) + ".s3..amazonaws.com".len() + region.len(),
                    );
                    encode_uri_component_into::<false>(bucket, &mut v);
                    write!(&mut v, ".s3.{}.amazonaws.com", BStr::new(region))
                        .expect("infallible: in-memory write");
                    break 'brk_host v.into_boxed_slice();
                }
                let mut v = Vec::with_capacity("s3..amazonaws.com".len() + region.len());
                write!(&mut v, "s3.{}.amazonaws.com", BStr::new(region))
                    .expect("infallible: in-memory write");
                break 'brk_host v.into_boxed_slice();
            }
        };
        // `host` (Box<[u8]>) drops on `?`.

        let date_result = get_amz_date();
        let amz_date: Box<[u8]> = date_result.date;
        // `amz_date` (Box<[u8]>) drops on `?`.

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

        // The URL is written once. The canonical request reads its path and presigned query back.
        let path_capacity = extra_path.len()
            + "/".len()
            + if self.virtual_hosted_style {
                0
            } else {
                encoded_len::<false>(bucket) + "/".len()
            }
            + encoded_len::<false>(path);
        let query_capacity = if sign_query {
            "?X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential=%2F%2F%2F%2Faws4_request&X-Amz-Date=&X-Amz-Expires=&X-Amz-Signature=&X-Amz-SignedHeaders=host".len()
                + self.access_key_id.len()
                + amz_day.len()
                + region.len()
                + service_name.len()
                + amz_date.len()
                + bun_core::fmt::digit_count(expires)
                + SIGNATURE_HEX_LEN
                + content_md5.as_deref().map_or(0, |md5| {
                    "Content-MD5=&".len() + encoded_len::<true>(md5)
                })
                + acl.map_or(0, |acl| "X-Amz-Acl=&".len() + acl.len())
                + session_token.map_or(0, |token| {
                    "X-Amz-Security-Token=&".len() + encoded_len::<true>(token)
                })
                + content_disposition.map_or(0, |disposition| {
                    "&response-content-disposition=".len() + encoded_len::<true>(disposition)
                })
                + content_type.map_or(0, |content_type| {
                    "&response-content-type=".len() + encoded_len::<true>(content_type)
                })
                + if request_payer {
                    "&x-amz-request-payer=requester".len()
                } else {
                    0
                }
                + storage_class.map_or(0, |storage_class| {
                    "&x-amz-storage-class=".len() + storage_class.len()
                })
        } else {
            search_params.map_or(0, <[u8]>::len)
        };
        // This capacity is exact for text that is UTF-8, so the Vec does not grow.
        let mut url = Zeroing(Vec::with_capacity(
            protocol.len() + "://".len() + host.len() + path_capacity + query_capacity,
        ));
        write!(&mut url.0, "{}://{}", protocol, BStr::new(&host))
            .expect("infallible: in-memory write");
        let path_start = url.0.len();
        write!(&mut url.0, "{}/", BStr::new(extra_path)).expect("infallible: in-memory write");
        if !self.virtual_hosted_style {
            encode_uri_component_into::<false>(bucket, &mut url.0);
            url.0.push(b'/');
        }
        encode_uri_component_into::<false>(path, &mut url.0);
        let path_end = url.0.len();

        // The canonical request needs the query parameters in the order of their bytes.
        let presigned_query = if sign_query {
            url.0.push(b'?');
            let start = url.0.len();
            if let Some(md5) = content_md5.as_deref() {
                url.0.extend_from_slice(b"Content-MD5=");
                encode_uri_component_into::<true>(md5, &mut url.0);
                url.0.push(b'&');
            }
            if let Some(acl) = acl {
                write!(&mut url.0, "X-Amz-Acl={}&", BStr::new(acl))
                    .expect("infallible: in-memory write");
            }
            write!(
                &mut url.0,
                "X-Amz-Algorithm=AWS4-HMAC-SHA256&X-Amz-Credential={}%2F{}%2F{}%2F{}%2Faws4_request&X-Amz-Date={}&X-Amz-Expires={}&",
                BStr::new(&self.access_key_id),
                BStr::new(amz_day),
                BStr::new(region),
                service_name,
                BStr::new(&amz_date),
                expires
            )
            .expect("infallible: in-memory write");
            if let Some(token) = session_token {
                url.0.extend_from_slice(b"X-Amz-Security-Token=");
                encode_uri_component_into::<true>(token, &mut url.0);
                url.0.push(b'&');
            }
            let signature_param = url.0.len();
            url.0.extend_from_slice(b"X-Amz-Signature=");
            let signature = url.0.len();
            url.0.extend_from_slice(&[b'0'; SIGNATURE_HEX_LEN]);
            url.0.push(b'&');
            let after_signature = url.0.len();
            url.0.extend_from_slice(b"X-Amz-SignedHeaders=host");
            if let Some(disposition) = content_disposition {
                url.0.extend_from_slice(b"&response-content-disposition=");
                encode_uri_component_into::<true>(disposition, &mut url.0);
            }
            if let Some(content_type) = content_type {
                url.0.extend_from_slice(b"&response-content-type=");
                encode_uri_component_into::<true>(content_type, &mut url.0);
            }
            if request_payer {
                url.0.extend_from_slice(b"&x-amz-request-payer=requester");
            }
            if let Some(storage_class) = storage_class {
                write!(
                    &mut url.0,
                    "&x-amz-storage-class={}",
                    BStr::new(storage_class)
                )
                .expect("infallible: in-memory write");
            }
            Some(PresignedQuery {
                start,
                signature_param,
                signature,
                after_signature,
            })
        } else {
            None
        };

        let mut hash_block = [0u8; HASH_BLOCK_LEN];

        let authorization: Box<[u8]> = 'brk: {
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
                // was `bun_jsc::VirtualMachine::get*().rare_data().aws_cache()`.
                // Storage moved DOWN — `AWS_SIGNATURE_CACHE` is a process static here.
                if let Some(cached) = aws_cache_get(date_result.numeric_day, &cache_key) {
                    break 'brk_sign cached;
                }
                // not cached yet lets generate a new one
                // `BStr` writes at most three bytes for one, so no growth frees a copy of the secret.
                let mut aws4_key = Zeroing(Vec::with_capacity(
                    "AWS4".len() + self.secret_access_key.len() * 3,
                ));
                write!(
                    &mut aws4_key.0,
                    "AWS4{}",
                    BStr::new(&self.secret_access_key)
                )
                .expect("infallible: in-memory write");
                let sig_date = bun_sha_hmac::generate(
                    &aws4_key.0,
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
                aws_cache_set(date_result.numeric_day, &cache_key, digest);
                break 'brk_sign digest;
            };

            let mut canonical = HashWriter::new(&mut hash_block);
            if let Some(query) = &presigned_query {
                // The canonical query is the query of the URL without its signature.
                canonical.update(method_name.as_bytes());
                canonical.update(b"\n");
                canonical.update(&url.0[path_start..path_end]);
                canonical.update(b"\n");
                canonical.update(&url.0[query.start..query.signature_param]);
                canonical.update(&url.0[query.after_signature..]);
                write!(
                    canonical,
                    "\nhost:{}\n\nhost\n{}",
                    BStr::new(&host),
                    BStr::new(aws_content_hash)
                );
            } else {
                CanonicalRequest::format(
                    &mut canonical,
                    header_key,
                    method_name.as_bytes(),
                    &url.0[path_start..path_end],
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
                );
            }
            let sha_digest = canonical.finish();

            // The string to sign is 124 bytes and the region. Above 132 bytes of region it is on the heap.
            macro_rules! scope {
                () => {
                    format_args!(
                        "AWS4-HMAC-SHA256\n{}\n{}/{}/{}/aws4_request\n",
                        BStr::new(&amz_date),
                        BStr::new(amz_day),
                        BStr::new(region),
                        service_name
                    )
                };
            }
            const DIGEST_HEX_LEN: usize = bun_sha_hmac::sha::hashers::SHA256::DIGEST * 2;
            let string_to_sign_len = "AWS4-HMAC-SHA256\n\n///aws4_request\n".len()
                + amz_date.len()
                + amz_day.len()
                + region.len()
                + service_name.len()
                + DIGEST_HEX_LEN;
            let mut long_string_to_sign = Vec::new();
            let scope_len = if string_to_sign_len <= HASH_BLOCK_LEN {
                // A region that is not UTF-8 is longer as text and can still not fit.
                buf_print_len(&mut hash_block[..HASH_BLOCK_LEN - DIGEST_HEX_LEN], scope!()).ok()
            } else {
                None
            };
            let string_to_sign: &[u8] = match scope_len {
                Some(scope_len) => {
                    let end = scope_len + DIGEST_HEX_LEN;
                    bun_core::fmt::bytes_to_hex_lower(&sha_digest, &mut hash_block[scope_len..end]);
                    &hash_block[..end]
                }
                None => {
                    long_string_to_sign.reserve_exact(string_to_sign_len);
                    write!(
                        &mut long_string_to_sign,
                        "{}{}",
                        scope!(),
                        HexLower(&sha_digest)
                    )
                    .expect("infallible: in-memory write");
                    &long_string_to_sign
                }
            };
            let signature = bun_sha_hmac::generate(
                &sig_date_region_service_req,
                string_to_sign,
                bun_sha_hmac::Algorithm::Sha256,
                &mut hmac_sig_service,
            )
            .ok_or(SignError::FailedToGenerateSignature)?;

            if let Some(query) = &presigned_query {
                bun_core::fmt::bytes_to_hex_lower(
                    &signature[0..DIGESTED_HMAC_256_LEN],
                    &mut url.0[query.signature..query.signature + SIGNATURE_HEX_LEN],
                );
                // The signature is in the query; a presigned URL has no Authorization header.
                break 'brk Box::default();
            }

            // Written once, at its size. The signature is its last 64 bytes.
            let mut authorization = Zeroing(Vec::with_capacity(
                "AWS4-HMAC-SHA256 Credential=////aws4_request, SignedHeaders=, Signature=".len()
                    + self.access_key_id.len()
                    + amz_day.len()
                    + region.len()
                    + service_name.len()
                    + signed_headers.len()
                    + SIGNATURE_HEX_LEN,
            ));
            write!(
                &mut authorization.0,
                "AWS4-HMAC-SHA256 Credential={}/{}/{}/{}/aws4_request, SignedHeaders={}, Signature=",
                BStr::new(&self.access_key_id),
                BStr::new(amz_day),
                BStr::new(region),
                service_name,
                BStr::new(signed_headers)
            )
            .expect("infallible: in-memory write");
            let signature_start = authorization.0.len();
            authorization
                .0
                .resize(signature_start + SIGNATURE_HEX_LEN, 0);
            bun_core::fmt::bytes_to_hex_lower(
                &signature[0..DIGESTED_HMAC_256_LEN],
                &mut authorization.0[signature_start..],
            );
            authorization.into_boxed_slice()
        };
        // `authorization` (Box<[u8]>) drops on `?`.

        if sign_query {
            // SignResult implements Drop, so struct-update `..default()`
            // is forbidden; mutate a default in place instead.
            let mut r = SignResult::default();
            r.acl = sign_options.acl;
            r.url = url.into_boxed_slice();
            r.storage_class = sign_options.storage_class;
            return Ok(r);
        }

        if contains_newline_or_cr(aws_content_hash)
            || search_params.is_some_and(contains_newline_or_cr)
            || acl.is_some_and(contains_newline_or_cr)
            || storage_class.is_some_and(contains_newline_or_cr)
            || content_md5.as_deref().is_some_and(contains_newline_or_cr)
            || content_disposition.is_some_and(contains_newline_or_cr)
            || content_encoding.is_some_and(contains_newline_or_cr)
            || session_token.is_some_and(contains_newline_or_cr)
            || contains_newline_or_cr(region)
            || contains_newline_or_cr(&self.access_key_id)
            || contains_newline_or_cr(&host)
        {
            return Err(SignError::InvalidHeaderValue);
        }

        write!(&mut url.0, "{}", BStr::new(search_params.unwrap_or(b"")))
            .expect("infallible: in-memory write");
        let url = url.into_boxed_slice();

        // SignResult implements Drop, so struct-update `..default()` is forbidden.
        let mut result = SignResult::default();
        result.amz_date = amz_date;
        result.host = host;
        result.authorization = authorization;
        result.acl = sign_options.acl;
        result.storage_class = sign_options.storage_class;
        result.request_payer = request_payer;
        result.url = url;
        result._headers_len = 4;
        // Self-referential: _headers borrows from owned Box<[u8]> fields on SignResult.
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

    // Create UTC timestamp.
    let secs: u64 = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_secs();
    let (year, month, day, hours, minutes, seconds, day_seconds) = epoch_to_utc_components(secs);

    let mut date = Vec::with_capacity("YYYYMMDDTHHMMSSZ".len());
    write!(
        &mut date,
        "{:04}{:02}{:02}T{:02}{:02}{:02}Z",
        year, month, day, hours, minutes, seconds
    )
    .expect("infallible: in-memory write");
    DateResult {
        numeric_day: secs - day_seconds,
        date: date.into_boxed_slice(),
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
const SIGNATURE_HEX_LEN: usize = DIGESTED_HMAC_256_LEN * 2;
/// S3 limits an object key to 1024 bytes, counted before percent-encoding.
const MAX_KEY_LEN: usize = 1024;

// ──────────────────────────────────────────────────────────────────────────
// SignResult
// ──────────────────────────────────────────────────────────────────────────

pub struct SignResult {
    pub(crate) amz_date: Box<[u8]>,
    pub(crate) host: Box<[u8]>,
    pub(crate) authorization: Box<[u8]>,
    pub url: Box<[u8]>,

    pub(crate) content_disposition: Box<[u8]>,
    pub(crate) content_encoding: Box<[u8]>,
    pub(crate) content_md5: Box<[u8]>,
    pub(crate) session_token: Box<[u8]>,
    pub(crate) acl: Option<ACL>,
    pub(crate) storage_class: Option<StorageClass>,
    pub(crate) request_payer: bool,
    // Self-referential: entries borrow from the Box<[u8]> fields above. PicoHeader
    // must be a raw (ptr,len) pair; see note in sign_request.
    pub(crate) _headers: [PicoHeader; Self::MAX_HEADERS],
    pub(crate) _headers_len: u8,
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
        // Zero-before-free for secrets.
        zero_sensitive(&mut self.amz_date);
        zero_sensitive(&mut self.session_token);
        zero_sensitive(&mut self.content_disposition);
        zero_sensitive(&mut self.content_encoding);
        zero_sensitive(&mut self.host);
        zero_sensitive(&mut self.authorization);
        zero_sensitive(&mut self.url);
        // content_md5 is not sensitive; Box drop handles it.
    }
}

#[inline]
fn zero_sensitive(b: &mut Box<[u8]>) {
    // SAFETY: `b` is exclusively borrowed; `len` bytes are valid for writes.
    unsafe { bun_core::secure_zero(b.as_mut_ptr(), b.len()) };
}

/// Offsets into a presigned URL. Its query is written before the signature exists.
struct PresignedQuery {
    start: usize,
    /// The `X-Amz-Signature` parameter. The canonical query does not have it.
    signature_param: usize,
    /// The hex digits of the signature.
    signature: usize,
    /// The parameter after `X-Amz-Signature`.
    after_signature: usize,
}

/// Bytes that are zeroed before they are freed, on every path out of `sign_request`.
struct Zeroing(Vec<u8>);

impl Zeroing {
    /// Hands the bytes to an owner that zeroes them itself.
    fn into_boxed_slice(mut self) -> Box<[u8]> {
        if self.0.len() == self.0.capacity() {
            return core::mem::take(&mut self.0).into_boxed_slice();
        }
        // Shrinking to fit can move the bytes; copy, so that `drop` zeroes the original.
        Box::from(self.0.as_slice())
    }
}

impl Drop for Zeroing {
    fn drop(&mut self) {
        // SAFETY: the Vec owns `len` initialised bytes.
        unsafe { bun_core::secure_zero(self.0.as_mut_ptr(), self.0.len()) };
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

/// The bytes that a URI component keeps: RFC 3986 unreserved, and in the second table `/` and `\`.
static KEPT: [[bool; 256]; 2] = [kept_bytes(false), kept_bytes(true)];

const fn kept_bytes(keep_slash: bool) -> [bool; 256] {
    let mut table = [false; 256];
    let mut c = 0;
    while c < table.len() {
        table[c] = matches!(c as u8, b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~')
            || (keep_slash && matches!(c as u8, b'/' | b'\\'));
        c += 1;
    }
    table
}

/// Appends `input` percent-encoded. Without `ENCODE_SLASH`, `/` stays and `\` becomes `/`.
pub fn encode_uri_component_into<const ENCODE_SLASH: bool>(input: &[u8], out: &mut Vec<u8>) {
    let kept = &KEPT[usize::from(!ENCODE_SLASH)];
    let mut run_start = 0;
    for (i, &c) in input.iter().enumerate() {
        if kept[usize::from(c)] && c != b'\\' {
            continue;
        }
        out.extend_from_slice(&input[run_start..i]);
        run_start = i + 1;
        if kept[usize::from(c)] {
            out.push(b'/');
        } else {
            out.extend_from_slice(&[
                b'%',
                bun_core::fmt::hex_char_upper(c >> 4),
                bun_core::fmt::hex_char_upper(c),
            ]);
        }
    }
    out.extend_from_slice(&input[run_start..]);
}

/// The number of bytes [`encode_uri_component_into`] appends for `input`.
fn encoded_len<const ENCODE_SLASH: bool>(input: &[u8]) -> usize {
    let kept = &KEPT[usize::from(!ENCODE_SLASH)];
    let encoded = input.iter().filter(|&&c| !kept[usize::from(c)]).count();
    input.len() + encoded * 2
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
    #[error("InvalidHeaderValue")]
    InvalidHeaderValue,
    #[error("FailedToGenerateSignature")]
    FailedToGenerateSignature,
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
// SignedHeaders
// ──────────────────────────────────────────────────────────────────────────

/// Headers must be in alphabetical order per AWS Signature V4 spec.
#[derive(Clone, Copy, Default)]
pub(crate) struct SignedHeadersKey {
    pub content_disposition: bool,
    pub content_encoding: bool,
    pub content_md5: bool,
    pub acl: bool,
    pub request_payer: bool,
    pub session_token: bool,
    pub storage_class: bool,
}

struct SignedHeaders;

impl SignedHeaders {
    // Built at runtime into a caller buffer.
    // Could switch to a build.rs-generated static table if profiling shows this matters.
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
// CanonicalRequest
// ──────────────────────────────────────────────────────────────────────────

struct CanonicalRequest;

impl CanonicalRequest {
    // Builds the canonical request at runtime with conditional writes; profile if hot.
    fn format(
        out: &mut HashWriter<'_>,
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
    ) {
        macro_rules! w {
            ($($arg:tt)*) => { out.write_fmt(format_args!($($arg)*)) };
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
    }
}

const HASH_BLOCK_LEN: usize = 256;

/// Sends the canonical request to SHA-256 in pieces. `block` collects the small ones.
struct HashWriter<'a> {
    hash: bun_sha_hmac::sha::hashers::SHA256,
    block: &'a mut [u8; HASH_BLOCK_LEN],
    len: usize,
}

impl<'a> HashWriter<'a> {
    fn new(block: &'a mut [u8; HASH_BLOCK_LEN]) -> Self {
        Self {
            hash: bun_sha_hmac::sha::hashers::SHA256::init(),
            block,
            len: 0,
        }
    }

    #[inline]
    fn update(&mut self, bytes: &[u8]) {
        if bytes.len() > HASH_BLOCK_LEN - self.len {
            self.flush();
            if bytes.len() >= HASH_BLOCK_LEN {
                self.hash.update(bytes);
                return;
            }
        }
        self.block[self.len..self.len + bytes.len()].copy_from_slice(bytes);
        self.len += bytes.len();
    }

    fn flush(&mut self) {
        if self.len > 0 {
            self.hash.update(&self.block[..self.len]);
            self.len = 0;
        }
    }

    /// The target of `write!`. A hash takes every byte, so this cannot fail.
    fn write_fmt(&mut self, args: core::fmt::Arguments<'_>) {
        core::fmt::write(self, args).expect("infallible: write_str never fails");
    }

    /// The digest of every written byte.
    fn finish(mut self) -> [u8; bun_sha_hmac::sha::hashers::SHA256::DIGEST] {
        self.flush();
        let mut digest = [0u8; bun_sha_hmac::sha::hashers::SHA256::DIGEST];
        self.hash.r#final(&mut digest);
        digest
    }
}

impl core::fmt::Write for HashWriter<'_> {
    #[inline]
    fn write_str(&mut self, s: &str) -> core::fmt::Result {
        self.update(s.as_bytes());
        Ok(())
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
