use core::fmt::Write as _;

use crate::node::types::PathLikeExt as _;
use crate::node::{PathLike, PathOrBlob};
use crate::webcore::blob::store::{S3Ext as _, StoreExt as _, StoreRef};
use crate::webcore::blob::{self, Blob, BlobExt};
use crate::webcore::s3::client as s3;
#[allow(unused_imports)]
use crate::webcore::s3::client::error_jsc::S3ErrorJsc as _;
use crate::webcore::s3::client::error_jsc::s3_error_to_js_with_async_stack;
use crate::webcore::s3_client::S3CredentialsExt as _;
use bun_core::output;
use bun_core::strings;
use bun_http::Method;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsClass as _, JsError, JsResult};

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

pub fn write_format<F, W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
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
    let credentials = s3.get_credentials();
    // detect virtual host style bucket name
    let bucket_name: &[u8] = if credentials.virtual_hosted_style && !credentials.endpoint.is_empty()
    {
        <s3::S3Credentials>::guess_bucket(&credentials.endpoint).unwrap_or(&credentials.bucket)
    } else {
        &credentials.bucket
    };

    if !bucket_name.is_empty() {
        write!(
            writer,
            "{}",
            output::pretty_fmt_args(
                " (<green>\"{}/{}\"<r>)<r> {{",
                ENABLE_ANSI_COLORS,
                (bstr::BStr::new(bucket_name), bstr::BStr::new(s3.path())),
            ),
        )?;
    } else {
        write!(
            writer,
            "{}",
            output::pretty_fmt_args(
                " (<green>\"{}\"<r>)<r> {{",
                ENABLE_ANSI_COLORS,
                (bstr::BStr::new(s3.path()),),
            ),
        )?;
    }

    if !content_type.is_empty() {
        writer.write_str("\n")?;
        let mut formatter = formatter.indented();
        formatter.write_indent(writer)?;
        write!(
            writer,
            "{}",
            output::pretty_fmt_args(
                "type<d>:<r> <green>\"{}\"<r>",
                ENABLE_ANSI_COLORS,
                (bstr::BStr::new(content_type),),
            ),
        )?;

        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
        if offset > 0 {
            writer.write_str("\n")?;
        }
    }

    if offset > 0 {
        let mut formatter = formatter.indented();
        formatter.write_indent(writer)?;

        write!(
            writer,
            "{}",
            output::pretty_fmt_args(
                "offset<d>:<r> <yellow>{}<r>",
                ENABLE_ANSI_COLORS,
                (offset,)
            ),
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

#[bun_jsc::host_fn]
pub fn presign(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<3>();
    // SAFETY: bun_vm() returns the live VM raw ptr.
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());

    // accept a path or a blob
    let path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;
    // errdefer: PathOrBlob impls Drop in Rust — path variant cleaned up automatically on `?`

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.get().is_none()
            || !matches!(
                blob.store.get().as_ref().unwrap().data,
                blob::store::Data::S3(_)
            )
        {
            return Err(
                global.throw_invalid_arguments(format_args!("Expected a S3 or path to presign"))
            );
        }
    }

    match path_or_blob {
        PathOrBlob::Path(path) => {
            if matches!(path, crate::node::PathOrFileDescriptor::Fd(_)) {
                return Err(global
                    .throw_invalid_arguments(format_args!("Expected a S3 or path to presign")));
            }
            let options = args.next_eat();
            let mut blob = construct_s3_file_internal_store(global, path.path().clone(), options)?;
            get_presign_url_from(&mut blob, global, options)
        }
        PathOrBlob::Blob(mut blob) => get_presign_url_from(&mut blob, global, args.next_eat()),
    }
}

#[bun_jsc::host_fn]
pub fn unlink(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<3>();
    // SAFETY: bun_vm() returns the live VM raw ptr.
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());

    // accept a path or a blob
    let path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.get().is_none()
            || !matches!(
                blob.store.get().as_ref().unwrap().data,
                blob::store::Data::S3(_)
            )
        {
            return Err(
                global.throw_invalid_arguments(format_args!("Expected a S3 or path to delete"))
            );
        }
    }

    match path_or_blob {
        PathOrBlob::Path(path) => {
            if matches!(path, crate::node::PathOrFileDescriptor::Fd(_)) {
                return Err(
                    global.throw_invalid_arguments(format_args!("Expected a S3 or path to delete"))
                );
            }
            let options = args.next_eat();
            let blob = construct_s3_file_internal_store(global, path.path().clone(), options)?;
            let store = blob.store.get().as_ref().unwrap();
            store.data.as_s3().unlink(store, global, options)
        }
        PathOrBlob::Blob(blob) => {
            let store = blob.store.get().as_ref().unwrap();
            store.data.as_s3().unlink(store, global, args.next_eat())
        }
    }
}

#[bun_jsc::host_fn]
pub fn write(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<3>();
    // SAFETY: bun_vm() returns the live VM raw ptr.
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());

    // accept a path or a blob
    let path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.get().is_none()
            || !matches!(
                blob.store.get().as_ref().unwrap().data,
                blob::store::Data::S3(_)
            )
        {
            return Err(
                global.throw_invalid_arguments(format_args!("Expected a S3 or path to upload"))
            );
        }
    }

    let Some(data) = args.next_eat() else {
        return Err(global
            .err(
                bun_jsc::ErrorCode::MISSING_ARGS,
                format_args!("Expected a Blob-y thing to upload"),
            )
            .throw());
    };

    match path_or_blob {
        PathOrBlob::Path(path) => {
            let options = args.next_eat();
            if matches!(path, crate::node::PathOrFileDescriptor::Fd(_)) {
                return Err(
                    global.throw_invalid_arguments(format_args!("Expected a S3 or path to upload"))
                );
            }
            let blob = construct_s3_file_internal_store(global, path.path().clone(), options)?;

            let mut blob_internal = PathOrBlob::Blob(blob);
            blob::write_file_internal(
                global,
                &mut blob_internal,
                data,
                blob::WriteFileOptions {
                    mkdirp_if_not_exists: Some(false),
                    extra_options: options,
                    ..Default::default()
                },
            )
        }
        PathOrBlob::Blob(blob) => {
            // PORT NOTE: reshaped for borrowck — match consumes path_or_blob; rebuild to pass &mut PathOrBlob
            let mut pob = PathOrBlob::Blob(blob);
            blob::write_file_internal(
                global,
                &mut pob,
                data,
                blob::WriteFileOptions {
                    mkdirp_if_not_exists: Some(false),
                    extra_options: args.next_eat(),
                    ..Default::default()
                },
            )
        }
    }
}

#[bun_jsc::host_fn]
pub fn size(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<3>();
    // SAFETY: bun_vm() returns the live VM raw ptr.
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());

    // accept a path or a blob
    let mut path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.get().is_none()
            || !matches!(
                blob.store.get().as_ref().unwrap().data,
                blob::store::Data::S3(_)
            )
        {
            return Err(
                global.throw_invalid_arguments(format_args!("Expected a S3 or path to get size"))
            );
        }
    }

    match &mut path_or_blob {
        PathOrBlob::Path(path) => {
            let options = args.next_eat();
            if matches!(path, crate::node::PathOrFileDescriptor::Fd(_)) {
                return Err(global
                    .throw_invalid_arguments(format_args!("Expected a S3 or path to get size")));
            }
            let mut blob = construct_s3_file_internal_store(global, path.path().clone(), options)?;

            S3BlobStatTask::size(global, &mut blob)
        }
        PathOrBlob::Blob(blob) => Ok(blob.get_size(global)),
    }
}

#[bun_jsc::host_fn]
pub fn exists(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<3>();
    // SAFETY: bun_vm() returns the live VM raw ptr.
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());

    // accept a path or a blob
    let mut path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.get().is_none()
            || !matches!(
                blob.store.get().as_ref().unwrap().data,
                blob::store::Data::S3(_)
            )
        {
            return Err(global.throw_invalid_arguments(format_args!(
                "Expected a S3 or path to check if it exists"
            )));
        }
    }

    match &mut path_or_blob {
        PathOrBlob::Path(path) => {
            let options = args.next_eat();
            if matches!(path, crate::node::PathOrFileDescriptor::Fd(_)) {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Expected a S3 or path to check if it exists"
                )));
            }
            let mut blob = construct_s3_file_internal_store(global, path.path().clone(), options)?;

            S3BlobStatTask::exists(global, &mut blob)
        }
        PathOrBlob::Blob(blob) => blob.get_exists(global, callframe),
    }
}

fn construct_s3_file_internal_store(
    global: &JSGlobalObject,
    path: PathLike,
    options: Option<JSValue>,
) -> JsResult<Blob> {
    // get credentials from env — `Transpiler::env_mut` is the safe accessor
    // for the process-singleton dotenv loader (set during init).
    let existing_credentials = crate::webcore::fetch::s3_credentials_from_env(
        global
            .bun_vm()
            .as_mut()
            .transpiler
            .env_mut()
            .get_s3_credentials(),
    );
    construct_s3_file_with_s3_credentials(global, path, options, existing_credentials)
}

/// if the credentials have changed, we need to clone it, if not we can just ref/deref it
pub fn construct_s3_file_with_s3_credentials_and_options(
    global: &JSGlobalObject,
    path: PathLike,
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

    let mut store = 'brk: {
        if aws_options.changed_credentials {
            break 'brk blob::Store::init_s3(path, None, aws_options.credentials).expect("oom");
        } else {
            // PORT NOTE: Zig `initS3WithReferencedCredentials` bumps the
            // intrusive ref on `default_credentials` (a `*S3Credentials`).
            // The Rust `Store::S3` field is `Arc<S3Credentials>` (separate rc
            // layer), so we can't share the existing intrusive allocation —
            // deep-clone the value instead and let `init_s3` `Arc::new` it.
            // PERF(port): was intrusive ref-bump (no copy) — profile in Phase B
            // once Store.rs migrates `Arc<S3Credentials>` → `IntrusiveRc`.
            break 'brk blob::Store::init_s3(path, None, default_credentials.clone()).expect("oom");
        }
    };
    // errdefer store.deinit() — handled by Drop on early return
    store.data.as_s3_mut().options = aws_options.options;
    store.data.as_s3_mut().acl = aws_options.acl;
    store.data.as_s3_mut().storage_class = aws_options.storage_class;
    store.data.as_s3_mut().request_payer = aws_options.request_payer;

    let mut blob = Blob::init_with_store(store, global);
    if let Some(opts) = options {
        if opts.is_object() {
            if let Some(file_type) = opts.get_truthy(global, "type")? {
                'inner: {
                    if file_type.is_string() {
                        let str = file_type.to_slice(global)?;
                        let slice = str.slice();
                        if !strings::is_all_ascii(slice) {
                            break 'inner;
                        }
                        blob.content_type_was_set.set(true);
                        // SAFETY: bun_vm() returns the live VM raw ptr.
                        if let Some(entry) = global.bun_vm().as_mut().mime_type(str.slice()) {
                            // PORT NOTE: `MimeType.value` is `Cow<'static, [u8]>`; the
                            // canonical-table hit (via `Compact::to_mime_type`) is always
                            // `Borrowed(&'static)`. If a future table source ever yields
                            // `Owned`, hand the buffer to the blob's allocated-content-type
                            // path so `Blob::deinit` reclaims it.
                            match entry.value {
                                std::borrow::Cow::Borrowed(s) => {
                                    blob.content_type.set(std::ptr::from_ref::<[u8]>(s));
                                }
                                std::borrow::Cow::Owned(v) => {
                                    blob.content_type
                                        .set(bun_core::heap::into_raw(v.into_boxed_slice()));
                                    blob.content_type_allocated.set(true);
                                }
                            }
                            break 'inner;
                        }
                        let mut content_type_buf = vec![0u8; slice.len()];
                        strings::copy_lowercase(slice, &mut content_type_buf);
                        blob.content_type.set(bun_core::heap::into_raw(
                            content_type_buf.into_boxed_slice(),
                        ));
                        blob.content_type_allocated.set(true);
                    }
                }
            }
        }
    }
    Ok(blob)
}

pub fn construct_s3_file_with_s3_credentials(
    global: &JSGlobalObject,
    path: PathLike,
    options: Option<JSValue>,
    existing_credentials: s3::S3Credentials,
) -> JsResult<Blob> {
    let aws_options = <s3::S3Credentials>::get_credentials_with_options(
        &existing_credentials,
        Default::default(),
        options,
        None,
        None,
        false,
        global,
    )?;
    let mut store = blob::Store::init_s3(path, None, aws_options.credentials).expect("oom");
    // errdefer store.deinit() — handled by Drop on early return
    store.data.as_s3_mut().options = aws_options.options;
    store.data.as_s3_mut().acl = aws_options.acl;
    store.data.as_s3_mut().storage_class = aws_options.storage_class;
    store.data.as_s3_mut().request_payer = aws_options.request_payer;

    let mut blob = Blob::init_with_store(store, global);
    if let Some(opts) = options {
        if opts.is_object() {
            if let Some(file_type) = opts.get_truthy(global, "type")? {
                'inner: {
                    if file_type.is_string() {
                        let str = file_type.to_slice(global)?;
                        let slice = str.slice();
                        if !strings::is_all_ascii(slice) {
                            break 'inner;
                        }
                        blob.content_type_was_set.set(true);
                        // SAFETY: bun_vm() returns the live VM raw ptr.
                        if let Some(entry) = global.bun_vm().as_mut().mime_type(str.slice()) {
                            // PORT NOTE: `MimeType.value` is `Cow<'static, [u8]>`; the
                            // canonical-table hit (via `Compact::to_mime_type`) is always
                            // `Borrowed(&'static)`. If a future table source ever yields
                            // `Owned`, hand the buffer to the blob's allocated-content-type
                            // path so `Blob::deinit` reclaims it.
                            match entry.value {
                                std::borrow::Cow::Borrowed(s) => {
                                    blob.content_type.set(std::ptr::from_ref::<[u8]>(s));
                                }
                                std::borrow::Cow::Owned(v) => {
                                    blob.content_type
                                        .set(bun_core::heap::into_raw(v.into_boxed_slice()));
                                    blob.content_type_allocated.set(true);
                                }
                            }
                            break 'inner;
                        }
                        let mut content_type_buf = vec![0u8; slice.len()];
                        strings::copy_lowercase(slice, &mut content_type_buf);
                        blob.content_type.set(bun_core::heap::into_raw(
                            content_type_buf.into_boxed_slice(),
                        ));
                        blob.content_type_allocated.set(true);
                    }
                }
            }
        }
    }
    Ok(blob)
}

fn construct_s3_file_internal(
    global: &JSGlobalObject,
    path: PathLike,
    options: Option<JSValue>,
) -> JsResult<*mut Blob> {
    Ok(Blob::new(construct_s3_file_internal_store(
        global, path, options,
    )?))
}

pub struct S3BlobStatTask {
    promise: bun_jsc::JSPromiseStrong,
    // LIFETIMES.tsv: JSC_BORROW (&JSGlobalObject). `BackRef` so the heap task
    // can outlive the constructing frame while reads stay safe.
    global: bun_ptr::BackRef<JSGlobalObject>,
    store: StoreRef,
}

impl S3BlobStatTask {
    /// Safe `&JSGlobalObject` accessor for the JSC_BORROW `global` back-pointer.
    #[inline]
    pub fn global(&self) -> &JSGlobalObject {
        self.global.get()
    }

    pub fn new(init: S3BlobStatTask) -> *mut S3BlobStatTask {
        bun_core::heap::into_raw(Box::new(init))
    }

    pub fn on_s3_exists_resolved(
        result: s3::S3StatResult,
        this: *mut core::ffi::c_void,
    ) -> Result<(), bun_jsc::JsTerminated> {
        // SAFETY: `this` was allocated via heap::alloc in `exists`; reconstructing here replaces `defer this.deinit()`
        let mut this = unsafe { bun_core::heap::take(this.cast::<S3BlobStatTask>()) };
        // Copy the BackRef out so `this` is not borrowed across `&mut this.promise`.
        let global_ref = this.global;
        let global = global_ref.get();
        match result {
            s3::S3StatResult::NotFound(_) => {
                this.promise.resolve(global, JSValue::FALSE)?;
            }
            s3::S3StatResult::Success(_) => {
                // calling .exists() should not prevent it to download a bigger file
                // this would make it download a slice of the actual value, if the file changes before we download it
                // if (this.blob.size == Blob.max_size) {
                //     this.blob.size = @truncate(stat.size);
                // }
                this.promise.resolve(global, JSValue::TRUE)?;
            }
            s3::S3StatResult::Failure(err) => {
                let value = s3_error_to_js_with_async_stack(
                    &err,
                    global,
                    Some(this.store.data.as_s3().path()),
                    this.promise.get(),
                );
                this.promise.reject(global, Ok(value))?;
            }
        }
        Ok(())
    }

    pub fn on_s3_size_resolved(
        result: s3::S3StatResult,
        this: *mut core::ffi::c_void,
    ) -> Result<(), bun_jsc::JsTerminated> {
        // SAFETY: `this` was allocated via heap::alloc in `size`; reconstructing here replaces `defer this.deinit()`
        let mut this = unsafe { bun_core::heap::take(this.cast::<S3BlobStatTask>()) };
        // Copy the BackRef out so `this` is not borrowed across `&mut this.promise`.
        let global_ref = this.global;
        let global = global_ref.get();

        match result {
            s3::S3StatResult::Success(stat_result) => {
                this.promise
                    .resolve(global, JSValue::js_number(stat_result.size as f64))?;
            }
            s3::S3StatResult::NotFound(err) | s3::S3StatResult::Failure(err) => {
                // TODO(port): Zig binds same payload name for .not_found and .failure arms; verify NotFound carries an error payload
                let value = s3_error_to_js_with_async_stack(
                    &err,
                    global,
                    Some(this.store.data.as_s3().path()),
                    this.promise.get(),
                );
                this.promise.reject(global, Ok(value))?;
            }
        }
        Ok(())
    }

    pub fn on_s3_stat_resolved(
        result: s3::S3StatResult,
        this: *mut core::ffi::c_void,
    ) -> Result<(), bun_jsc::JsTerminated> {
        // SAFETY: `this` was allocated via heap::alloc in `stat`; reconstructing here replaces `defer this.deinit()`
        let mut this = unsafe { bun_core::heap::take(this.cast::<S3BlobStatTask>()) };
        // Copy the BackRef out so `this` is not borrowed across `&mut this.promise`.
        let global_ref = this.global;
        let global = global_ref.get();
        match result {
            s3::S3StatResult::Success(stat_result) => {
                let s3_stat = match S3Stat::init(
                    stat_result.size as u64,
                    stat_result.etag,
                    stat_result.content_type,
                    stat_result.last_modified,
                    global,
                ) {
                    Ok(b) => (*b).to_js(global),
                    Err(_) => {
                        return this.promise.reject(global, Err(JsError::Thrown));
                    }
                };
                this.promise.resolve(global, s3_stat)?;
            }
            s3::S3StatResult::NotFound(err) | s3::S3StatResult::Failure(err) => {
                let value = s3_error_to_js_with_async_stack(
                    &err,
                    global,
                    Some(this.store.data.as_s3().path()),
                    this.promise.get(),
                );
                this.promise.reject(global, Ok(value))?;
            }
        }
        Ok(())
    }

    pub fn exists(global: &JSGlobalObject, blob: &Blob) -> JsResult<JSValue> {
        let this = S3BlobStatTask::new(S3BlobStatTask {
            promise: bun_jsc::JSPromiseStrong::init(global),
            store: blob.store.get().as_ref().unwrap().clone(),
            global: bun_ptr::BackRef::new(global),
        });
        // SAFETY: `this` is a freshly leaked Box; valid for the duration of this call
        let this_ref = unsafe { &mut *this };
        let promise = this_ref.promise.value();
        let s3_store = blob.store.get().as_ref().unwrap().data.as_s3();
        let credentials = s3_store.get_credentials();
        let path = s3_store.path();
        // `Transpiler::env_mut` is the safe accessor for the process-singleton
        // dotenv loader (set during init).
        let env = global.bun_vm().as_mut().transpiler.env_mut();

        s3::stat(
            credentials,
            path,
            // TODO(port): @ptrCast fn pointer — verify s3::stat callback signature matches
            S3BlobStatTask::on_s3_exists_resolved,
            this.cast::<core::ffi::c_void>(),
            env.get_http_proxy(true, None, None).map(|proxy| proxy.href),
            s3_store.request_payer,
        )?;
        Ok(promise)
    }

    pub fn stat(global: &JSGlobalObject, blob: &Blob) -> JsResult<JSValue> {
        let this = S3BlobStatTask::new(S3BlobStatTask {
            promise: bun_jsc::JSPromiseStrong::init(global),
            store: blob.store.get().as_ref().unwrap().clone(),
            global: bun_ptr::BackRef::new(global),
        });
        // SAFETY: `this` is a freshly leaked Box; valid for the duration of this call
        let this_ref = unsafe { &mut *this };
        let promise = this_ref.promise.value();
        let s3_store = blob.store.get().as_ref().unwrap().data.as_s3();
        let credentials = s3_store.get_credentials();
        let path = s3_store.path();
        // `Transpiler::env_mut` is the safe accessor for the process-singleton
        // dotenv loader (set during init).
        let env = global.bun_vm().as_mut().transpiler.env_mut();

        s3::stat(
            credentials,
            path,
            S3BlobStatTask::on_s3_stat_resolved,
            this.cast::<core::ffi::c_void>(),
            env.get_http_proxy(true, None, None).map(|proxy| proxy.href),
            s3_store.request_payer,
        )?;
        Ok(promise)
    }

    pub fn size(global: &JSGlobalObject, blob: &mut Blob) -> JsResult<JSValue> {
        let this = S3BlobStatTask::new(S3BlobStatTask {
            promise: bun_jsc::JSPromiseStrong::init(global),
            store: blob.store.get().as_ref().unwrap().clone(),
            global: bun_ptr::BackRef::new(global),
        });
        // SAFETY: `this` is a freshly leaked Box; valid for the duration of this call
        let this_ref = unsafe { &mut *this };
        let promise = this_ref.promise.value();
        let s3_store = blob.store.get().as_ref().unwrap().data.as_s3();
        let credentials = s3_store.get_credentials();
        let path = s3_store.path();
        // `Transpiler::env_mut` is the safe accessor for the process-singleton
        // dotenv loader (set during init).
        let env = global.bun_vm().as_mut().transpiler.env_mut();

        s3::stat(
            credentials,
            path,
            S3BlobStatTask::on_s3_size_resolved,
            this.cast::<core::ffi::c_void>(),
            env.get_http_proxy(true, None, None).map(|proxy| proxy.href),
            s3_store.request_payer,
        )?;
        Ok(promise)
    }

    // deinit: store.deref() + promise.deinit() + bun.destroy(this) — all handled by Box<Self> Drop
}

// PORT NOTE: `Method.fromJS` lives in `bun_http_jsc` so `bun_http_types` stays
// JSC-free. Thin local alias keeps the `getPresignUrlFrom` body diff-stable
// against the Zig.
#[inline]
fn method_from_js(global: &JSGlobalObject, value: JSValue) -> JsResult<Option<Method>> {
    bun_http_jsc::method_jsc::from_js(global, value)
}

pub fn get_presign_url_from(
    this: &mut Blob,
    global: &JSGlobalObject,
    extra_options: Option<JSValue>,
) -> JsResult<JSValue> {
    if !this.is_s3() {
        return Err(global
            .err(
                bun_jsc::ErrorCode::INVALID_THIS,
                format_args!("presign is only possible for s3:// files"),
            )
            .throw());
    }

    let mut method: Method = Method::GET;
    let mut expires: usize = 86400; // 1 day default

    let s3 = this.store.get().as_ref().unwrap().data.as_s3();
    // Zig: `.{ .credentials = s3.getCredentials().*, .request_payer = s3.request_payer }`.
    // `acl`/`storage_class`/`content_*` deliberately stay at their `None`
    // defaults here — they are only seeded from the store when extra_options
    // is provided (via `getCredentialsWithOptions` below).
    let mut credentials_with_options = s3::S3CredentialsWithOptions {
        credentials: (**s3.get_credentials()).clone(),
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
            if let Some(expires_) = options.get_optional_int::<i32>(global, "expiresIn")? {
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
        bun_s3_signing::SignOptions {
            path,
            method,
            acl: credentials_with_options.acl,
            storage_class: credentials_with_options.storage_class,
            request_payer: credentials_with_options.request_payer,
            // SAFETY: these `*const [u8]` borrow into sibling `_*_slice` fields on
            // `credentials_with_options`, which lives for the duration of this call.
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
    bun_jsc::bun_string_jsc::create_utf8_for_js(
        this.global_this().expect("Blob.global_this set"),
        &result.url,
    )
}

pub fn get_bucket_name(this: &Blob) -> Option<&[u8]> {
    let store = this.store.get().as_ref()?;
    if !matches!(store.data, blob::store::Data::S3(_)) {
        return None;
    }
    let credentials = store.data.as_s3().get_credentials();
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

// PORT NOTE: `#[bun_jsc::host_fn(getter|method)]` requires `Self` (impl-block
// context). These are free fns on `*Blob` exported manually as `JSS3File__*`
// (see `@export` block below) and called as `s3_file::get_*` from `Blob::get_*`,
// so the proc-macro shim is not used here — the raw ABI shim is hand-wired.
pub fn get_bucket(this: &Blob, global: &JSGlobalObject) -> JsResult<JSValue> {
    if let Some(name) = get_bucket_name(this) {
        return bun_jsc::bun_string_jsc::create_utf8_for_js(global, name);
    }
    Ok(JSValue::UNDEFINED)
}

pub fn get_presign_url(
    this: &mut Blob,
    global: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments_old::<1>();
    get_presign_url_from(
        this,
        global,
        if args.len > 0 {
            Some(args.ptr[0])
        } else {
            None
        },
    )
}

pub fn get_stat(this: &Blob, global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
    S3BlobStatTask::stat(global, this)
}

#[bun_jsc::host_fn]
pub fn stat(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old::<3>();
    // SAFETY: bun_vm() returns the live VM raw ptr.
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments.slice());

    // accept a path or a blob
    let mut path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.get().is_none()
            || !matches!(
                blob.store.get().as_ref().unwrap().data,
                blob::store::Data::S3(_)
            )
        {
            return Err(
                global.throw_invalid_arguments(format_args!("Expected a S3 or path to get size"))
            );
        }
    }

    match &mut path_or_blob {
        PathOrBlob::Path(path) => {
            let options = args.next_eat();
            if matches!(path, crate::node::PathOrFileDescriptor::Fd(_)) {
                return Err(global
                    .throw_invalid_arguments(format_args!("Expected a S3 or path to get size")));
            }
            let mut blob = construct_s3_file_internal_store(global, path.path().clone(), options)?;

            S3BlobStatTask::stat(global, &mut blob)
        }
        PathOrBlob::Blob(blob) => S3BlobStatTask::stat(global, blob),
    }
}

pub fn construct_internal_js(
    global: &JSGlobalObject,
    path: PathLike,
    options: Option<JSValue>,
) -> JsResult<JSValue> {
    let blob = construct_s3_file_internal(global, path, options)?;
    // SAFETY: `blob` is a freshly heap-allocated `*mut Blob` from `Blob::new`.
    // Call the `BlobExt::to_js` `&mut self` method (not the by-value
    // `JsClass::to_js`), which hands the existing heap pointer to the C++
    // wrapper.
    Ok(BlobExt::to_js(unsafe { &mut *blob }, global))
}

pub fn to_js_unchecked(global: &JSGlobalObject, this: *mut Blob) -> JSValue {
    // C++ adopts `this` opaquely (stored as `void* m_ctx` in the JS wrapper);
    // ownership-transfer contract lives on `to_js_unchecked`'s callers.
    BUN__createJSS3FileUnsafely(global, this.cast::<core::ffi::c_void>())
}

pub fn construct_internal(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<*mut Blob> {
    // SAFETY: bun_vm() returns the live VM raw ptr.
    let vm = global.bun_vm();
    let arguments = callframe.arguments_old::<2>();
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());

    let Some(path) = PathLike::from_js(global, &mut args)? else {
        return Err(global.throw_invalid_arguments(format_args!("Expected file path string")));
    };
    construct_s3_file_internal(global, path, args.next_eat())
}

// TODO(port): callconv(jsc.conv) — #[bun_jsc::host_fn] macro emits the raw ABI shim; @export name handled below
pub fn construct(global: &JSGlobalObject, callframe: &CallFrame) -> *mut Blob {
    match construct_internal(global, callframe) {
        Ok(b) => b,
        Err(JsError::Thrown) => core::ptr::null_mut(),
        Err(JsError::OutOfMemory) => {
            let _ = global.throw_out_of_memory_value();
            core::ptr::null_mut()
        }
        Err(JsError::Terminated) => core::ptr::null_mut(),
    }
}

pub fn has_instance(_: JSValue, _global: &JSGlobalObject, value: JSValue) -> bool {
    bun_jsc::mark_binding();
    let Some(blob) = value.as_class_ref::<Blob>() else {
        return false;
    };
    blob.is_s3()
}

// @export block — symbols exported with C linkage and JSC calling convention.
// JSS3File__presign     -> raw shim wrapping get_presign_url (method-with-context)
// JSS3File__construct   -> construct
// JSS3File__hasInstance -> has_instance
// JSS3File__bucket      -> get_bucket
// JSS3File__stat        -> raw shim wrapping get_stat (method-with-context)

pub mod exports {
    use super::*;

    /// `@export(&hasInstance, .{ .name = "JSS3File__hasInstance" })` —
    /// `customHasInstance` hook (`callconv(jsc.conv)`, `(EncodedJSValue,
    /// *JSGlobalObject, EncodedJSValue) -> bool`).
    #[unsafe(no_mangle)]
    #[bun_jsc::host_call]
    pub fn JSS3File__hasInstance(this: JSValue, global: &JSGlobalObject, value: JSValue) -> bool {
        super::has_instance(this, global, value)
    }

    /// `@export(&construct, .{ .name = "JSS3File__construct" })` — bare ctor,
    /// not routed through `toJSHostFn` (returns `?*Blob`, not `JSValue`).
    #[unsafe(no_mangle)]
    #[bun_jsc::host_call]
    pub fn JSS3File__construct(global: &JSGlobalObject, callframe: &CallFrame) -> *mut Blob {
        super::construct(global, callframe)
    }

    /// `@export(&getBucket, .{ .name = "JSS3File__bucket" })` — getter
    /// (`callconv(jsc.conv)`, takes `*Blob, *JSGlobalObject`, returns JSValue).
    #[unsafe(no_mangle)]
    #[bun_jsc::host_call]
    pub fn JSS3File__bucket(this: *mut Blob, global: *mut JSGlobalObject) -> JSValue {
        // SAFETY: C++ prototype getter passes the live `m_ctx` Blob and global.
        let (this, global) = unsafe { (&*this, &*global) };
        bun_jsc::to_js_host_call(global, || super::get_bucket(this, global))
    }

    /// `@export(&jsc.toJSHostFnWithContext(Blob, getPresignUrl), ...)`.
    #[unsafe(no_mangle)]
    #[bun_jsc::host_call]
    pub fn JSS3File__presign(
        this: *mut Blob,
        global: *mut JSGlobalObject,
        callframe: *mut CallFrame,
    ) -> JSValue {
        // SAFETY: JSC method shim passes live `m_ctx`/global/callframe.
        let (this, global, callframe) = unsafe { (&mut *this, &*global, &*callframe) };
        bun_jsc::to_js_host_call(global, || super::get_presign_url(this, global, callframe))
    }

    /// `@export(&getStat, .{ .name = "JSS3File__stat" })` — direct
    /// `callconv(jsc.conv)` method (Zig body already swallows JsError → .zero).
    #[unsafe(no_mangle)]
    #[bun_jsc::host_call]
    pub fn JSS3File__stat(
        this: *mut Blob,
        global: *mut JSGlobalObject,
        callframe: *mut CallFrame,
    ) -> JSValue {
        // SAFETY: JSC method shim passes live `m_ctx`/global/callframe.
        let (this, global, callframe) = unsafe { (&mut *this, &*global, &*callframe) };
        bun_jsc::to_js_host_call(global, || super::get_stat(this, global, callframe))
    }
}

// TODO(port): move to <area>_sys
// C++ side defines `SYSV_ABI EncodedJSValue` (JSS3File.cpp).
bun_jsc::jsc_abi_extern! {
    safe fn BUN__createJSS3File(global: &JSGlobalObject, callframe: &CallFrame) -> JSValue;
    // `&JSGlobalObject` discharges the only deref'd-param precondition; `blob`
    // is stored opaquely as `void* m_ctx` (module-private — sole caller is
    // `to_js_unchecked`, whose own signature carries the ownership-transfer
    // contract). Matches the `*__createObject` precedent.
    safe fn BUN__createJSS3FileUnsafely(
        global: &JSGlobalObject,
        blob: *mut core::ffi::c_void,
    ) -> JSValue;
}

#[bun_jsc::host_fn]
pub fn create_js_s3_file(global: &JSGlobalObject, callframe: &CallFrame) -> JSValue {
    BUN__createJSS3File(global, callframe)
}

// ported from: src/runtime/webcore/S3File.zig
