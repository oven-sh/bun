use crate::node::{PathLike, PathOrBlob};
use crate::webcore::blob::store::{S3Ext as _, Store, StoreExt as _};
use crate::webcore::blob::{self, Blob, BlobExt};
use crate::webcore::s3::client as s3;
use crate::webcore::s3::client::error_jsc::s3_error_to_js_with_async_stack;
use crate::webcore::s3_client::S3CredentialsExt as _;
use bun_core::strings;
use bun_http::Method;
use bun_jsc::bun_string_jsc;
use bun_jsc::{JSGlobalObject, JSValue, JsClass as _, JsError, JsResult};
use bun_ptr::RefPtr;

// Local front for `bun_core::pretty_fmt!` that accepts a runtime / const-
// generic bool. The proc-macro only matches `true`/`false` literals, so
// monomorphized callers (`<const C: bool>`) branch here. Both arms yield
// `&'static str`.
macro_rules! pfmt {
    ($fmt:expr, $colors:expr) => {
        if $colors {
            ::bun_core::pretty_fmt!($fmt, true)
        } else {
            ::bun_core::pretty_fmt!($fmt, false)
        }
    };
}

use super::s3_client;
use super::s3_stat::S3Stat;

pub(crate) fn write_format<F, W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
    s3: &blob::store::S3,
    formatter: &mut F,
    writer: &mut W,
    content_type: &[u8],
    offset: u64,
) -> core::fmt::Result
where
    F: bun_jsc::ConsoleFormatter,
{
    writer.write_str(pfmt!("<r>S3Ref<r>", ENABLE_ANSI_COLORS))?;
    let credentials = &s3.credentials;
    // detect virtual host style bucket name
    let bucket_name: &[u8] = if credentials.virtual_hosted_style && !credentials.endpoint.is_empty()
    {
        <s3::S3Credentials>::guess_bucket(&credentials.endpoint).unwrap_or(&credentials.bucket)
    } else {
        &credentials.bucket
    };

    if !bucket_name.is_empty() {
        bun_core::write_pretty!(
            writer,
            ENABLE_ANSI_COLORS,
            " (<green>\"{s}/{s}\"<r>)<r> {{",
            bstr::BStr::new(bucket_name),
            bstr::BStr::new(s3.path()),
        )?;
    } else {
        bun_core::write_pretty!(
            writer,
            ENABLE_ANSI_COLORS,
            " (<green>\"{s}\"<r>)<r> {{",
            bstr::BStr::new(s3.path()),
        )?;
    }

    if !content_type.is_empty() {
        writer.write_str("\n")?;
        let mut formatter = formatter.indented();
        formatter.write_indent(writer)?;
        bun_core::write_pretty!(
            writer,
            ENABLE_ANSI_COLORS,
            "type<d>:<r> <green>\"{s}\"<r>",
            bstr::BStr::new(content_type),
        )?;

        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
        if offset > 0 {
            writer.write_str("\n")?;
        }
    }

    if offset > 0 {
        let mut formatter = formatter.indented();
        formatter.write_indent(writer)?;

        bun_core::write_pretty!(
            writer,
            ENABLE_ANSI_COLORS,
            "offset<d>:<r> <yellow>{d}<r>",
            offset
        )?;

        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
    }
    s3_client::write_format_credentials::<F, W, ENABLE_ANSI_COLORS>(
        &**credentials,
        s3.options,
        s3.acl,
        formatter,
        writer,
    )?;
    formatter.write_indent(writer)?;
    writer.write_str("}")?;
    formatter.reset_line();
    Ok(())
}

/// Shared prologue of the S3 static host fns: parse the first argument as a
/// path or Blob and require Blob arguments to be S3-backed.
pub(crate) fn parse_s3_path_or_blob(
    global: &JSGlobalObject,
    path: JSValue,
    error_message: &str,
) -> JsResult<PathOrBlob> {
    let mut args =
        bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), core::slice::from_ref(&path));
    let path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;
    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if !blob.is_s3() {
            return Err(global.throw_invalid_arguments(format_args!("{error_message}")));
        }
    }
    Ok(path_or_blob)
}

/// Rejects file-descriptor paths, and constructs the env-credentialed store for path arguments.
pub(crate) fn resolve_s3_blob(
    global: &JSGlobalObject,
    options: Option<JSValue>,
    path_or_blob: PathOrBlob,
    error_message: &str,
) -> JsResult<Box<Blob>> {
    match path_or_blob {
        PathOrBlob::Path(path) => {
            if matches!(path, crate::node::PathOrFileDescriptor::Fd(_)) {
                return Err(global.throw_invalid_arguments(format_args!("{error_message}")));
            }
            // The clone owns a copy of a buffer's bytes; `path` unpins at scope exit.
            let blob = construct_s3_file_internal_store(global, path.path().clone(), options)?;
            Ok(Box::new(blob))
        }
        PathOrBlob::Blob(blob) => Ok(blob),
    }
}

pub(crate) fn s3_blob_from_js(
    global: &JSGlobalObject,
    path: JSValue,
    options: Option<JSValue>,
    error_message: &str,
) -> JsResult<Box<Blob>> {
    let path_or_blob = parse_s3_path_or_blob(global, path, error_message)?;
    resolve_s3_blob(global, options, path_or_blob, error_message)
}

fn construct_s3_file_internal_store(
    global: &JSGlobalObject,
    path: PathLike<'static>,
    options: Option<JSValue>,
) -> JsResult<Blob> {
    // get credentials from env
    let existing_credentials = crate::webcore::fetch::s3_credentials_from_env(
        global.bun_vm().env_loader().get_s3_credentials(),
    );
    construct_s3_file_with_s3_credentials(global, path, options, &existing_credentials)
}

pub(crate) fn construct_s3_file_with_s3_credentials_and_options(
    global: &JSGlobalObject,
    path: PathLike<'static>,
    options: Option<JSValue>,
    default_credentials: &s3::S3Credentials,
    default_options: s3::MultiPartUploadOptions,
    default_acl: Option<s3::ACL>,
    default_storage_class: Option<s3::StorageClass>,
    default_request_payer: bool,
) -> JsResult<Blob> {
    let aws_options = <s3::S3Credentials>::get_credentials_with_options(
        default_credentials,
        default_options,
        options,
        default_acl,
        default_storage_class,
        default_request_payer,
        global,
    )?;
    let store = Store::init_s3(path, aws_options).expect("oom");
    let blob = Blob::init_with_store(store, global);
    // Unlike the write path, a non-string or invalid `type` is ignored here.
    if let Some(opts) = options {
        if opts.is_object() {
            if let Some(file_type) = opts.get_truthy(global, "type")? {
                if file_type.is_string() {
                    let str = file_type.to_utf8(global)?;
                    let slice = str.slice();
                    if blob::is_valid_blob_type(slice) {
                        blob.content_type_was_set.set(true);
                        blob.content_type
                            .set(match global.bun_vm().mime_type(slice) {
                                Some(mime) => blob::BlobContentType::from(mime),
                                None => blob::BlobContentType::from_lowercased(slice),
                            });
                    }
                }
            }
        }
    }
    Ok(blob)
}

pub(crate) fn construct_s3_file_with_s3_credentials(
    global: &JSGlobalObject,
    path: PathLike<'static>,
    options: Option<JSValue>,
    existing_credentials: &s3::S3Credentials,
) -> JsResult<Blob> {
    construct_s3_file_with_s3_credentials_and_options(
        global,
        path,
        options,
        existing_credentials,
        Default::default(),
        None,
        None,
        false,
    )
}

#[derive(Clone, Copy)]
enum StatQuery {
    Exists,
    Size,
    Stat,
}

pub(crate) struct S3BlobStatTask {
    query: StatQuery,
    promise: bun_jsc::JSPromiseStrong,
    // LIFETIMES.tsv: JSC_BORROW (&JSGlobalObject). `BackRef` so the heap task
    // can outlive the constructing frame while reads stay safe.
    global: bun_ptr::BackRef<JSGlobalObject>,
    store: RefPtr<Store>,
}

impl S3BlobStatTask {
    fn on_resolved(mut self, result: s3::S3StatResult) -> JsResult<()> {
        let global = self.global.get();
        let value = match (self.query, result) {
            (StatQuery::Exists, s3::S3StatResult::NotFound(_)) => JSValue::FALSE,
            // The size is not stored on the blob: the file can grow before it is downloaded.
            (StatQuery::Exists, s3::S3StatResult::Success(_)) => JSValue::TRUE,
            (StatQuery::Size, s3::S3StatResult::Success(stat)) => {
                JSValue::js_number(stat.size as f64)
            }
            (StatQuery::Stat, s3::S3StatResult::Success(stat)) => match S3Stat::init(
                stat.size as u64,
                stat.etag,
                stat.content_type,
                stat.last_modified,
                global,
            ) {
                Ok(stat) => stat.to_js(global),
                Err(_) => return self.promise.reject(global, Err(JsError::Thrown)),
            },
            (_, s3::S3StatResult::NotFound(err) | s3::S3StatResult::Failure(err)) => {
                let value = s3_error_to_js_with_async_stack(
                    &err,
                    global,
                    Some(self.store.data.as_s3().path()),
                    self.promise.get(),
                );
                return self.promise.reject(global, Ok(value));
            }
        };
        self.promise.resolve(global, value)
    }

    /// Sends the HEAD request behind `exists()`, `size()` and `stat()`.
    fn start(cx: &bun_jsc::JsThread<'_>, blob: &Blob, query: StatQuery) -> JsResult<JSValue> {
        let store = blob.store().expect("infallible: store present");
        let this = S3BlobStatTask {
            query,
            promise: bun_jsc::JSPromiseStrong::init(cx.global()),
            store: store.clone(),
            global: bun_ptr::BackRef::new(cx.global()),
        };
        let (promise, s3_store) = (this.promise.value(), store.data.as_s3());
        s3::stat(
            &s3_store.credentials,
            cx.context(),
            s3_store.path(),
            Box::new(move |result| this.on_resolved(result)),
            s3_store.request_payer,
        )?;
        Ok(promise)
    }

    #[inline(never)]
    pub(crate) fn exists(cx: &bun_jsc::JsThread<'_>, blob: &Blob) -> JsResult<JSValue> {
        bun_removable_features::removable_definition!(S3Client, Self::exists);
        Self::start(cx, blob, StatQuery::Exists)
    }

    #[inline(never)]
    pub(crate) fn stat(cx: &bun_jsc::JsThread<'_>, blob: &Blob) -> JsResult<JSValue> {
        bun_removable_features::removable_definition!(S3Client, Self::stat);
        Self::start(cx, blob, StatQuery::Stat)
    }

    #[inline(never)]
    pub(crate) fn size(cx: &bun_jsc::JsThread<'_>, blob: &Blob) -> JsResult<JSValue> {
        bun_removable_features::removable_definition!(S3Client, Self::size);
        Self::start(cx, blob, StatQuery::Size)
    }
}

// `Method.fromJS` lives in `bun_http_jsc` so `bun_http_types` stays
// JSC-free. Thin local alias for the `getPresignUrlFrom` body.
#[inline]
fn method_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Method>> {
    bun_http_jsc::method_jsc::from_js(global, value)
}

pub(crate) fn get_presign_url_from(
    this: &Blob,
    global: &JSGlobalObject,
    extra_options: Option<JSValue>,
) -> JsResult<JSValue> {
    let mut method: Method = Method::GET;
    let mut expires: usize = 86400; // 1 day default

    let s3 = this
        .store()
        .expect("infallible: store present")
        .data
        .as_s3();
    // `acl`/`storage_class`/`content_*` deliberately stay at their `None`
    // defaults here — they are only seeded from the store when extra_options
    // is provided (via `getCredentialsWithOptions` below).
    let mut credentials_with_options = s3::S3CredentialsWithOptions {
        credentials: (*s3.credentials).clone(),
        request_payer: s3.request_payer,
        ..Default::default()
    };

    if let Some(options) = extra_options {
        if options.is_object() {
            if let Some(method_) = options.get_truthy(global, "method")? {
                method = match method_from_js(global, method_)? {
                    Some(m) => m,
                    None => {
                        return Err(global.throw_invalid_arguments(format_args!(
                            "method must be GET, PUT, DELETE or HEAD when using s3 protocol",
                        )));
                    }
                };
            }
            if let Some(expires_) = options.get_optional::<i32>(global, "expiresIn")? {
                if expires_ <= 0 {
                    return Err(global.throw_invalid_arguments(format_args!(
                        "expiresIn must be greather than 0"
                    )));
                }
                expires = expires_ as usize;
            }
        }
        credentials_with_options = s3.get_credentials_with_options(Some(options), global)?;
    }
    let path = s3.path();

    let result = match credentials_with_options.credentials.sign_request::<false>(
        &bun_s3_signing::SignOptions {
            path,
            method,
            acl: credentials_with_options.acl,
            storage_class: credentials_with_options.storage_class,
            request_payer: credentials_with_options.request_payer,
            content_disposition: credentials_with_options.content_disposition.as_deref(),
            content_type: credentials_with_options.content_type.as_deref(),
            content_hash: None,
            content_md5: None,
            search_params: None,
            content_encoding: None,
        },
        Some(bun_s3_signing::SignQueryOptions { expires }),
    ) {
        Ok(r) => r,
        Err(sign_err) => return Err(s3::throw_sign_error(sign_err.into(), global)),
    };
    // `Blob.global_this` is the JSGlobalObject the blob was created with; live for VM lifetime.
    bun_string_jsc::create_utf8_for_js(
        this.global_this().expect("Blob.global_this set"),
        &result.url,
    )
}

fn get_bucket_name(this: &Blob) -> Option<&[u8]> {
    let store = this.store()?;
    if !matches!(store.data, blob::store::Data::S3(_)) {
        return None;
    }
    let credentials = &store.data.as_s3().credentials;
    let mut full_path = store.data.as_s3().path();
    if strings::starts_with(full_path, b"/") {
        full_path = &full_path[1..];
    }
    let bucket: &[u8] = &credentials.bucket;

    if bucket.is_empty() {
        if let Some(end) = strings::index_of(full_path, b"/") {
            let bucket = &full_path[0..end];
            if !bucket.is_empty() {
                return Some(bucket);
            }
        }
        return None;
    }
    Some(bucket)
}

// Exported as `JSS3File__*` (see the `exports` block below).
fn get_bucket(this: &Blob, global: &JSGlobalObject) -> JsResult<JSValue> {
    if let Some(name) = get_bucket_name(this) {
        return bun_string_jsc::create_utf8_for_js(global, name);
    }
    Ok(JSValue::UNDEFINED)
}

pub(crate) fn construct_internal_js(
    global: &JSGlobalObject,
    path: PathLike<'static>,
    options: Option<JSValue>,
) -> JsResult<JSValue> {
    Ok(construct_s3_file_internal_store(global, path, options)?.into_js(global))
}

pub(crate) fn into_js(global: &JSGlobalObject, blob: Blob) -> JSValue {
    // SAFETY: the JS wrapper adopts the one ref of the new allocation.
    unsafe { BUN__createJSS3FileUnsafely(global, Blob::new(blob).cast()) }
}

// Symbols exported with C linkage and JSC calling convention.
// JSS3File__presign     -> raw shim wrapping get_presign_url_from (method-with-context)
// JSS3File__bucket      -> get_bucket
// JSS3File__stat        -> raw shim wrapping S3BlobStatTask::stat (method-with-context)

pub(crate) mod exports {
    use super::*;

    /// Getter (JSC calling convention; takes `*Blob, *JSGlobalObject`,
    /// returns JSValue).
    #[unsafe(no_mangle)]
    #[bun_jsc::host_call]
    fn JSS3File__bucket(this: &Blob, global: &JSGlobalObject) -> JSValue {
        bun_jsc::to_js_host_call(global, || super::get_bucket(this, global))
    }

    /// `options` is empty when it was not passed.
    #[unsafe(no_mangle)]
    #[bun_jsc::host_call]
    fn JSS3File__presign(this: &Blob, global: &JSGlobalObject, options: JSValue) -> JSValue {
        bun_jsc::to_js_host_call(global, || {
            super::get_presign_url_from(this, global, (!options.is_empty()).then_some(options))
        })
    }

    #[unsafe(no_mangle)]
    #[bun_jsc::host_call]
    fn JSS3File__stat(this: &Blob, global: &JSGlobalObject) -> JSValue {
        bun_jsc::to_js_host_call(global, || {
            S3BlobStatTask::stat(&global.js_thread_of_caller(), this)
        })
    }
}

// C++ side defines `SYSV_ABI EncodedJSValue` (JSS3File.cpp).
bun_jsc::jsc_abi_extern! {
    fn BUN__createJSS3FileUnsafely(
        global: &JSGlobalObject,
        blob: *mut core::ffi::c_void,
    ) -> JSValue;
}
