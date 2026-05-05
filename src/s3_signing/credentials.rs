use core::cell::Cell;
use core::mem::size_of;
use std::io::Write as _;

use bstr::BStr;

use bun_collections::BoundedArray;
use bun_http::Method;
use bun_picohttp::Header as PicoHeader;
use bun_ptr::IntrusiveRc;
use bun_str::strings;

use super::acl::ACL;
use super::storage_class::StorageClass;
// TODO(b0): MultiPartUploadOptions arrives from move-in (MOVE_DOWN from
// bun_runtime::webcore::s3::multipart_options → s3_signing). Referenced bare
// below; the move-in pass adds the struct def to this crate.

bun_output::declare_scope!(AWS, visible);

// ──────────────────────────────────────────────────────────────────────────
// CYCLEBREAK(b0) hooks — break upward dep on bun_jsc::VirtualMachine.
// bun_runtime::init() registers these; they are no-ops while null.
// ──────────────────────────────────────────────────────────────────────────

use core::ptr::null_mut;
use core::sync::atomic::{AtomicPtr, Ordering};

/// `unsafe fn(numeric_day: u64, key: &[u8]) -> Option<[u8; DIGESTED_HMAC_256_LEN]>`
pub type AwsCacheGetFn = unsafe fn(u64, &[u8]) -> Option<[u8; DIGESTED_HMAC_256_LEN]>;
/// `unsafe fn(numeric_day: u64, key: &[u8], digest: [u8; DIGESTED_HMAC_256_LEN])`
pub type AwsCacheSetFn = unsafe fn(u64, &[u8], [u8; DIGESTED_HMAC_256_LEN]);
/// `unsafe fn() -> *mut bun_boringssl_sys::ENGINE` (nullable)
pub type BoringEngineFn = unsafe fn() -> *mut bun_boringssl_sys::ENGINE;

/// Stored as type-erased fn-ptr; cast via [`AwsCacheGetFn`].
pub static AWS_CACHE_GET_HOOK: AtomicPtr<()> = AtomicPtr::new(null_mut());
/// Stored as type-erased fn-ptr; cast via [`AwsCacheSetFn`].
pub static AWS_CACHE_SET_HOOK: AtomicPtr<()> = AtomicPtr::new(null_mut());
/// Stored as type-erased fn-ptr; cast via [`BoringEngineFn`].
pub static BORING_ENGINE_HOOK: AtomicPtr<()> = AtomicPtr::new(null_mut());

#[inline]
fn aws_cache_get(day: u64, key: &[u8]) -> Option<[u8; DIGESTED_HMAC_256_LEN]> {
    let p = AWS_CACHE_GET_HOOK.load(Ordering::Relaxed);
    if p.is_null() {
        return None;
    }
    // SAFETY: hook registered by bun_runtime::init() with matching signature.
    unsafe { core::mem::transmute::<*mut (), AwsCacheGetFn>(p)(day, key) }
}

#[inline]
fn aws_cache_set(day: u64, key: &[u8], digest: [u8; DIGESTED_HMAC_256_LEN]) {
    let p = AWS_CACHE_SET_HOOK.load(Ordering::Relaxed);
    if p.is_null() {
        return;
    }
    // SAFETY: hook registered by bun_runtime::init() with matching signature.
    unsafe { core::mem::transmute::<*mut (), AwsCacheSetFn>(p)(day, key, digest) }
}

#[inline]
fn boring_engine() -> Option<&'static mut bun_boringssl_sys::ENGINE> {
    let p = BORING_ENGINE_HOOK.load(Ordering::Relaxed);
    if p.is_null() {
        return None;
    }
    // SAFETY: hook registered by bun_runtime::init() with matching signature.
    let eng = unsafe { core::mem::transmute::<*mut (), BoringEngineFn>(p)() };
    if eng.is_null() {
        None
    } else {
        // SAFETY: ENGINE lives for process lifetime once initialized.
        Some(unsafe { &mut *eng })
    }
}

// ──────────────────────────────────────────────────────────────────────────
// S3Credentials
// ──────────────────────────────────────────────────────────────────────────

pub struct S3Credentials {
    // Intrusive refcount; managed by bun_ptr::IntrusiveRc<S3Credentials>.
    ref_count: Cell<u32>,
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

// `bun.ptr.RefCount(...)` mixin → IntrusiveRc handles ref/deref; when count hits
// zero the boxed allocation is dropped, which drops the Box<[u8]> fields. The
// Zig `deinit` body only freed those fields + `bun.destroy(this)`, so no
// explicit Drop body is needed here.

impl S3Credentials {
    pub fn estimated_size(&self) -> usize {
        size_of::<S3Credentials>()
            + self.access_key_id.len()
            + self.region.len()
            + self.secret_access_key.len()
            + self.endpoint.len()
            + self.bucket.len()
    }

    fn hash_const(acl: &[u8]) -> u64 {
        let mut hasher = bun_wyhash::Wyhash::init(0);
        let mut remain = acl;

        // Zig's Wyhash buffer is 48 bytes; mirror the chunked-lowercase update.
        // TODO(port): confirm bun_wyhash::Wyhash exposes BUF_LEN; using 48 to match std.hash.Wyhash.
        const BUF_LEN: usize = 48;
        let mut buf = [0u8; BUF_LEN];

        while !remain.is_empty() {
            let end = BUF_LEN.min(remain.len());
            hasher.update(strings::copy_lowercase_if_needed(&remain[..end], &mut buf));
            remain = &remain[end..];
        }

        hasher.final_()
    }

    // Zig: `pub const getCredentialsWithOptions = @import("../runtime/webcore/s3/credentials_jsc.zig").getCredentialsWithOptions;`
    // Deleted per PORTING.md — *_jsc alias; the JS-facing fn lives in the *_jsc crate.

    pub fn dupe(&self) -> IntrusiveRc<S3Credentials> {
        IntrusiveRc::new(S3Credentials {
            ref_count: Cell::new(1),
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
                write!(&mut v, "s3.{}.amazonaws.com", BStr::new(region)).unwrap();
                endpoint_owned = Some(v.clone());
                break 'brk_host v.into_boxed_slice();
            }
        };
        let _ = endpoint_owned; // PORT NOTE: in Zig `endpoint` was reassigned for later reuse; not read after this point.
        // errdefer free(host) — Box<[u8]> drops on `?`.

        let normalized_path: &[u8] = 'brk: {
            if self.virtual_hosted_style {
                break 'brk buf_print!(
                    &mut normalized_path_buffer,
                    "{}/{}",
                    BStr::new(extra_path),
                    BStr::new(path)
                )
                .map_err(|_| SignError::InvalidPath)?;
            } else {
                break 'brk buf_print!(
                    &mut normalized_path_buffer,
                    "{}/{}/{}",
                    BStr::new(extra_path),
                    BStr::new(bucket),
                    BStr::new(path)
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
            let mut hmac_sig_service = [0u8; bun_boringssl_sys::EVP_MAX_MD_SIZE as usize];
            let mut hmac_sig_service2 = [0u8; bun_boringssl_sys::EVP_MAX_MD_SIZE as usize];

            let sig_date_region_service_req: [u8; DIGESTED_HMAC_256_LEN] = 'brk_sign: {
                let key = buf_print!(
                    &mut tmp_buffer,
                    "{}{}{}",
                    BStr::new(region),
                    service_name,
                    BStr::new(&self.secret_access_key)
                )
                .map_err(|_| SignError::NoSpaceLeft)?;
                // CYCLEBREAK(b0): was bun_jsc::VirtualMachine::get*().rare_data().aws_cache().
                // Runtime registers AWS_CACHE_{GET,SET}_HOOK; null hook = cache miss.
                if let Some(cached) = aws_cache_get(date_result.numeric_day, key) {
                    break 'brk_sign cached;
                }
                // not cached yet lets generate a new one
                let aws4_key = buf_print!(
                    &mut tmp_buffer,
                    "AWS4{}",
                    BStr::new(&self.secret_access_key)
                )
                .map_err(|_| SignError::NoSpaceLeft)?;
                let sig_date = bun_hmac::generate(
                    aws4_key,
                    amz_day,
                    bun_hmac::Algorithm::Sha256,
                    &mut hmac_sig_service,
                )
                .ok_or(SignError::FailedToGenerateSignature)?;
                let sig_date_region = bun_hmac::generate(
                    sig_date,
                    region,
                    bun_hmac::Algorithm::Sha256,
                    &mut hmac_sig_service2,
                )
                .ok_or(SignError::FailedToGenerateSignature)?;
                let sig_date_region_service = bun_hmac::generate(
                    sig_date_region,
                    service_name.as_bytes(),
                    bun_hmac::Algorithm::Sha256,
                    &mut hmac_sig_service,
                )
                .ok_or(SignError::FailedToGenerateSignature)?;
                let _result = bun_hmac::generate(
                    sig_date_region_service,
                    b"aws4_request",
                    bun_hmac::Algorithm::Sha256,
                    &mut hmac_sig_service2,
                )
                .ok_or(SignError::FailedToGenerateSignature)?;

                let digest: [u8; DIGESTED_HMAC_256_LEN] =
                    hmac_sig_service2[0..DIGESTED_HMAC_256_LEN].try_into().unwrap();
                // PORT NOTE: intentionally diverges from Zig. In Zig, `key` is a slice into
                // `tmp_buffer` which has since been overwritten by the `AWS4{secret}` bufPrint,
                // so Zig passes corrupted bytes to `cache.set` (latent bug → cache never hits).
                // We recompute the correct `{region}{service}{secret}` key here.
                // TODO(port): fix the overwritten-key bug in credentials.zig as well.
                let key = buf_print!(
                    &mut tmp_buffer,
                    "{}{}{}",
                    BStr::new(region),
                    service_name,
                    BStr::new(&self.secret_access_key)
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
                        encode_uri_component::<true>(content_md5_value, &mut content_md5_encoded_buffer)
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
                    let mut query_parts: BoundedArray<Vec<u8>, 13> = BoundedArray::new();

                    // Add parameters in alphabetical order: Content-MD5, X-Amz-Acl, X-Amz-Algorithm, X-Amz-Credential, X-Amz-Date, X-Amz-Expires, X-Amz-Security-Token, X-Amz-SignedHeaders, response-content-disposition, response-content-type, x-amz-request-payer, x-amz-storage-class

                    if let Some(v) = encoded_content_md5 {
                        query_parts.push(alloc_print!("Content-MD5={}", BStr::new(v)));
                    }
                    if let Some(v) = acl {
                        query_parts.push(alloc_print!("X-Amz-Acl={}", BStr::new(v)));
                    }
                    query_parts.push(alloc_print!("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
                    query_parts.push(alloc_print!(
                        "X-Amz-Credential={}%2F{}%2F{}%2F{}%2Faws4_request",
                        BStr::new(&self.access_key_id),
                        BStr::new(amz_day),
                        BStr::new(region),
                        service_name
                    ));
                    query_parts.push(alloc_print!("X-Amz-Date={}", BStr::new(&amz_date)));
                    query_parts.push(alloc_print!("X-Amz-Expires={}", expires));
                    if let Some(token) = encoded_session_token {
                        query_parts.push(alloc_print!("X-Amz-Security-Token={}", BStr::new(token)));
                    }
                    query_parts.push(alloc_print!("X-Amz-SignedHeaders=host"));
                    if let Some(cd) = encoded_content_disposition {
                        query_parts.push(alloc_print!(
                            "response-content-disposition={}",
                            BStr::new(cd)
                        ));
                    }
                    if let Some(ct) = encoded_content_type {
                        query_parts.push(alloc_print!("response-content-type={}", BStr::new(ct)));
                    }
                    if request_payer {
                        query_parts.push(alloc_print!("x-amz-request-payer=requester"));
                    }
                    if let Some(v) = storage_class {
                        query_parts.push(alloc_print!("x-amz-storage-class={}", BStr::new(v)));
                    }

                    // Join query parameters with &
                    let mut query_string: Vec<u8> = Vec::new();
                    for (i, part) in query_parts.as_slice().iter().enumerate() {
                        if i > 0 {
                            query_string.push(b'&');
                        }
                        query_string.extend_from_slice(part);
                    }

                    break 'brk_canonical buf_print!(
                        &mut tmp_buffer,
                        "{}\n{}\n{}\nhost:{}\n\nhost\n{}",
                        method_name,
                        BStr::new(normalized_path),
                        BStr::new(&query_string),
                        BStr::new(&host),
                        BStr::new(aws_content_hash)
                    )
                    .map_err(|_| SignError::NoSpaceLeft)?;
                };
                let mut sha_digest = [0u8; bun_sha::Sha256::DIGEST_LEN];
                // CYCLEBREAK(b0): was bun_jsc::VirtualMachine::get().rare_data().boring_engine().
                bun_sha::Sha256::hash(canonical, &mut sha_digest, boring_engine());

                let sign_value = buf_print!(
                    &mut tmp_buffer,
                    "AWS4-HMAC-SHA256\n{}\n{}/{}/{}/aws4_request\n{}",
                    BStr::new(&amz_date),
                    BStr::new(amz_day),
                    BStr::new(region),
                    service_name,
                    bun_core::fmt::bytes_to_hex_lower(&sha_digest)
                )
                .map_err(|_| SignError::NoSpaceLeft)?;

                let signature = bun_hmac::generate(
                    &sig_date_region_service_req,
                    sign_value,
                    bun_hmac::Algorithm::Sha256,
                    &mut hmac_sig_service,
                )
                .ok_or(SignError::FailedToGenerateSignature)?;

                // Build final URL with query parameters in alphabetical order to match canonical request
                // PERF(port): was stack-fallback alloc
                let mut url_query_parts: BoundedArray<Vec<u8>, 14> = BoundedArray::new();

                // Add parameters in alphabetical order: Content-MD5, X-Amz-Acl, X-Amz-Algorithm, X-Amz-Credential, X-Amz-Date, X-Amz-Expires, X-Amz-Security-Token, X-Amz-Signature, X-Amz-SignedHeaders, response-content-disposition, response-content-type, x-amz-request-payer, x-amz-storage-class

                if let Some(v) = encoded_content_md5 {
                    url_query_parts.push(alloc_print!("Content-MD5={}", BStr::new(v)));
                }
                if let Some(v) = acl {
                    url_query_parts.push(alloc_print!("X-Amz-Acl={}", BStr::new(v)));
                }
                url_query_parts.push(alloc_print!("X-Amz-Algorithm=AWS4-HMAC-SHA256"));
                url_query_parts.push(alloc_print!(
                    "X-Amz-Credential={}%2F{}%2F{}%2F{}%2Faws4_request",
                    BStr::new(&self.access_key_id),
                    BStr::new(amz_day),
                    BStr::new(region),
                    service_name
                ));
                url_query_parts.push(alloc_print!("X-Amz-Date={}", BStr::new(&amz_date)));
                url_query_parts.push(alloc_print!("X-Amz-Expires={}", expires));
                if let Some(token) = encoded_session_token {
                    url_query_parts.push(alloc_print!("X-Amz-Security-Token={}", BStr::new(token)));
                }
                url_query_parts.push(alloc_print!(
                    "X-Amz-Signature={}",
                    bun_core::fmt::bytes_to_hex_lower(&signature[0..DIGESTED_HMAC_256_LEN])
                ));
                url_query_parts.push(alloc_print!("X-Amz-SignedHeaders=host"));
                if let Some(cd) = encoded_content_disposition {
                    url_query_parts.push(alloc_print!(
                        "response-content-disposition={}",
                        BStr::new(cd)
                    ));
                }
                if let Some(ct) = encoded_content_type {
                    url_query_parts.push(alloc_print!("response-content-type={}", BStr::new(ct)));
                }
                if request_payer {
                    url_query_parts.push(alloc_print!("x-amz-request-payer=requester"));
                }
                if let Some(v) = storage_class {
                    url_query_parts.push(alloc_print!("x-amz-storage-class={}", BStr::new(v)));
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
                let mut sha_digest = [0u8; bun_sha::Sha256::DIGEST_LEN];
                // CYCLEBREAK(b0): was bun_jsc::VirtualMachine::get().rare_data().boring_engine().
                bun_sha::Sha256::hash(canonical, &mut sha_digest, boring_engine());

                let sign_value = buf_print!(
                    &mut tmp_buffer,
                    "AWS4-HMAC-SHA256\n{}\n{}/{}/{}/aws4_request\n{}",
                    BStr::new(&amz_date),
                    BStr::new(amz_day),
                    BStr::new(region),
                    service_name,
                    bun_core::fmt::bytes_to_hex_lower(&sha_digest)
                )
                .map_err(|_| SignError::NoSpaceLeft)?;

                let signature = bun_hmac::generate(
                    &sig_date_region_service_req,
                    sign_value,
                    bun_hmac::Algorithm::Sha256,
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
                    bun_core::fmt::bytes_to_hex_lower(&signature[0..DIGESTED_HMAC_256_LEN])
                )
                .into_boxed_slice();
            }
        };
        // errdefer free(authorization) — Box<[u8]> drops on `?`.

        if sign_query {
            // defer free(host); defer free(amz_date); — drop at scope exit.
            return Ok(SignResult {
                amz_date: Box::default(),
                host: Box::default(),
                authorization: Box::default(),
                acl: sign_options.acl,
                url: authorization,
                storage_class: sign_options.storage_class,
                ..SignResult::default()
            });
        }

        let url = alloc_print!(
            "{}://{}{}{}",
            protocol,
            BStr::new(&host),
            BStr::new(normalized_path),
            BStr::new(search_params.unwrap_or(b""))
        )
        .into_boxed_slice();

        let mut result = SignResult {
            amz_date,
            host,
            authorization,
            acl: sign_options.acl,
            storage_class: sign_options.storage_class,
            request_payer,
            url,
            _headers: [PicoHeader::EMPTY; SignResult::MAX_HEADERS],
            _headers_len: 4,
            ..SignResult::default()
        };
        // TODO(port): self-referential — _headers borrows from owned Box<[u8]> fields on SignResult.
        // PicoHeader must store raw `*const u8, len` (not `&'a [u8]`) for this to be sound. Phase B
        // should verify bun_picohttp::Header layout and add a SAFETY note.
        result._headers[0] = PicoHeader::new(b"x-amz-content-sha256", aws_content_hash);
        result._headers[1] = PicoHeader::new(b"x-amz-date", &result.amz_date);
        result._headers[2] = PicoHeader::new(b"Host", &result.host);
        result._headers[3] = PicoHeader::new(b"Authorization", &result.authorization);

        if let Some(acl_value) = acl {
            result._headers[result._headers_len as usize] =
                PicoHeader::new(b"x-amz-acl", acl_value);
            result._headers_len += 1;
        }

        if let Some(token) = session_token {
            let session_token_value = Box::<[u8]>::from(token);
            result._headers[result._headers_len as usize] =
                PicoHeader::new(b"x-amz-security-token", &session_token_value);
            result.session_token = session_token_value;
            result._headers_len += 1;
        }
        if let Some(storage_class_value) = storage_class {
            result._headers[result._headers_len as usize] =
                PicoHeader::new(b"x-amz-storage-class", storage_class_value);
            result._headers_len += 1;
        }

        if let Some(cd) = content_disposition {
            let content_disposition_value = Box::<[u8]>::from(cd);
            result._headers[result._headers_len as usize] =
                PicoHeader::new(b"content-disposition", &content_disposition_value);
            result.content_disposition = content_disposition_value;
            result._headers_len += 1;
        }

        if let Some(ce) = content_encoding {
            let content_encoding_value = Box::<[u8]>::from(ce);
            result._headers[result._headers_len as usize] =
                PicoHeader::new(b"content-encoding", &content_encoding_value);
            result.content_encoding = content_encoding_value;
            result._headers_len += 1;
        }

        if let Some(c_md5) = content_md5.as_deref() {
            let content_md5_value = Box::<[u8]>::from(c_md5);
            result._headers[result._headers_len as usize] =
                PicoHeader::new(b"content-md5", &content_md5_value);
            result.content_md5 = content_md5_value;
            result._headers_len += 1;
        }

        if request_payer {
            result._headers[result._headers_len as usize] =
                PicoHeader::new(b"x-amz-request-payer", b"requester");
            result._headers_len += 1;
        }

        Ok(result)
    }
}

#[inline]
fn dupe_slice(s: &[u8]) -> Box<[u8]> {
    if !s.is_empty() {
        Box::<[u8]>::from(s)
    } else {
        Box::default()
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
            year, month, day, hours, minutes, seconds
        )
        .into_boxed_slice(),
    }
}

// TODO(port): port std.time.epoch.{EpochSeconds, EpochDay, YearAndDay, MonthAndDay} into
// bun_core::time. Stubbed signature here; Phase B fills the body.
fn epoch_to_utc_components(secs: u64) -> (u32, u32, u32, u32, u32, u32, u64) {
    // returns (year, month(1-based), day(1-based), hours, minutes, seconds, seconds_into_day)
    let day_seconds = secs % 86400;
    let hours = u32::try_from(day_seconds / 3600).unwrap();
    let minutes = u32::try_from((day_seconds % 3600) / 60).unwrap();
    let seconds = u32::try_from(day_seconds % 60).unwrap();
    // TODO(port): year/month/day computation — needs std.time.epoch port.
    let (year, month, day) = (1970u32, 1u32, 1u32);
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

    pub fn mix_with_header(
        &self,
        headers_buffer: &mut [PicoHeader],
        header: PicoHeader,
    ) -> &[PicoHeader] {
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
            _headers: [PicoHeader::EMPTY; Self::MAX_HEADERS],
            _headers_len: 0,
        }
    }
}

impl Drop for SignResult {
    fn drop(&mut self) {
        // Zig used bun.freeSensitive (zero-before-free) for secrets.
        // TODO(port): wire bun_core::free_sensitive once available; for now zero manually.
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
    if !b.is_empty() {
        for byte in b.iter_mut() {
            // SAFETY: plain volatile zero to prevent the compiler from eliding the write.
            unsafe { core::ptr::write_volatile(byte, 0) };
        }
    }
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
    #[error("InvalidHexChar")]
    InvalidHexChar,
    #[error("BufferTooSmall")]
    BufferTooSmall,
}

fn to_hex_char(value: u8) -> Result<u8, EncodeError> {
    match value {
        0..=9 => Ok(value + b'0'),
        10..=15 => Ok((value - 10) + b'A'),
        _ => Err(EncodeError::InvalidHexChar),
    }
}

pub fn encode_uri_component<const ENCODE_SLASH: bool>(
    input: &[u8],
    buffer: &mut [u8],
) -> Result<&[u8], EncodeError> {
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
                // Convert byte to hex
                let high_nibble: u8 = (c >> 4) & 0xF;
                let low_nibble: u8 = c & 0xF;
                buffer[written + 1] = to_hex_char(high_nibble)?;
                buffer[written + 2] = to_hex_char(low_nibble)?;
                written += 3;
            }
        }
    }

    // SAFETY: `written <= buffer.len()` by construction; reborrow as immutable.
    Ok(unsafe { core::slice::from_raw_parts(buffer.as_ptr(), written) })
}

fn normalize_name(name: &[u8]) -> &[u8] {
    if name.is_empty() {
        return name;
    }
    bun_str::strings::trim(name, b"/\\")
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
    #[error("FailedToGenerateSignature")]
    FailedToGenerateSignature,
    #[error("NoSpaceLeft")]
    NoSpaceLeft,
}

impl From<SignError> for bun_core::Error {
    fn from(e: SignError) -> Self {
        bun_core::Error::from_name(<&'static str>::from(e))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// S3CredentialsWithOptions
// ──────────────────────────────────────────────────────────────────────────

pub struct S3CredentialsWithOptions {
    pub credentials: S3Credentials,
    pub options: MultiPartUploadOptions,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    // TODO(port): self-referential — these `?[]const u8` fields are NOT freed in Zig `deinit`;
    // they borrow into the sibling `_*_slice: ZigStringSlice` fields below. Verify against
    // LIFETIMES.tsv in Phase B. Raw `*const [u8]` here to avoid double-owning the bytes.
    pub content_disposition: Option<*const [u8]>,
    pub content_type: Option<*const [u8]>,
    pub content_encoding: Option<*const [u8]>,
    /// indicates if requester pays for the request (for requester pays buckets)
    pub request_payer: bool,
    /// indicates if the credentials have changed
    pub changed_credentials: bool,
    /// indicates if the virtual hosted style is used
    pub virtual_hosted_style: bool,
    pub _access_key_id_slice: Option<bun_str::ZigStringSlice>,
    pub _secret_access_key_slice: Option<bun_str::ZigStringSlice>,
    pub _region_slice: Option<bun_str::ZigStringSlice>,
    pub _endpoint_slice: Option<bun_str::ZigStringSlice>,
    pub _bucket_slice: Option<bun_str::ZigStringSlice>,
    pub _session_token_slice: Option<bun_str::ZigStringSlice>,
    pub _content_disposition_slice: Option<bun_str::ZigStringSlice>,
    pub _content_type_slice: Option<bun_str::ZigStringSlice>,
    pub _content_encoding_slice: Option<bun_str::ZigStringSlice>,
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
    pub fn format<'b>(
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
    ) -> Result<&'b [u8], NoSpaceLeft> {
        let mut cursor: &mut [u8] = buf;
        let total = cursor.len();
        macro_rules! w {
            ($($arg:tt)*) => {
                write!(cursor, $($arg)*).map_err(|_| NoSpaceLeft)?
            };
        }
        // method, path, query
        w!(
            "{}\n{}\n{}\n",
            BStr::new(method),
            BStr::new(path),
            BStr::new(query)
        );
        if key.content_disposition {
            w!("content-disposition:{}\n", BStr::new(content_disposition.unwrap()));
        }
        if key.content_encoding {
            w!("content-encoding:{}\n", BStr::new(content_encoding.unwrap()));
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
            w!("x-amz-security-token:{}\n", BStr::new(session_token.unwrap()));
        }
        if key.storage_class {
            w!("x-amz-storage-class:{}\n", BStr::new(storage_class.unwrap()));
        }
        // signed_headers, hash
        w!("\n{}\n{}", BStr::new(signed_headers), BStr::new(hash));

        let written = total - cursor.len();
        // PORT NOTE: reshaped for borrowck — recompute slice from original buffer.
        // SAFETY: `cursor` is a tail of `buf`; `written` bytes at the head are initialized.
        Ok(unsafe { core::slice::from_raw_parts(buf.as_ptr(), written) })
    }
}

#[derive(Debug)]
pub struct NoSpaceLeft;

// ──────────────────────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────────────────────

/// Returns true if the given slice contains any CR (\r) or LF (\n) characters,
/// which would allow HTTP header injection if used in a header value.
fn contains_newline_or_cr(value: &[u8]) -> bool {
    strings::index_of_any(value, b"\r\n").is_some()
}

/// `std.fmt.bufPrint` equivalent: write formatted bytes into `buf`, return the written slice.
macro_rules! buf_print {
    ($buf:expr, $($arg:tt)*) => {{
        let buf: &mut [u8] = &mut $buf[..];
        let mut cursor: &mut [u8] = buf;
        let total = cursor.len();
        match write!(cursor, $($arg)*) {
            Ok(()) => {
                let written = total - cursor.len();
                // SAFETY: cursor is a tail of buf; head is initialized.
                Ok::<&[u8], NoSpaceLeft>(unsafe {
                    core::slice::from_raw_parts(buf.as_ptr(), written)
                })
            }
            Err(_) => Err(NoSpaceLeft),
        }
    }};
}
use buf_print;

/// `std.fmt.allocPrint` equivalent: build into a fresh Vec<u8>.
macro_rules! alloc_print {
    ($($arg:tt)*) => {{
        let mut v: Vec<u8> = Vec::new();
        write!(&mut v, $($arg)*).expect("write to Vec<u8> never fails");
        v
    }};
}
use alloc_print;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/s3_signing/credentials.zig (939 lines)
//   confidence: medium
//   todos:      14
//   notes:      jsc::VirtualMachine awsCache/boringEngine deps need threading out; SignResult._headers and S3CredentialsWithOptions.content_* are self-referential (raw ptrs); SignedHeaders/CanonicalRequest comptime tables ported as runtime builders (PERF tagged); epoch date calc stubbed; cache.set key intentionally diverges from Zig bug.
// ──────────────────────────────────────────────────────────────────────────
