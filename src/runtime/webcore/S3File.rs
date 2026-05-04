use core::fmt::Write as _;
use std::sync::Arc;

use bun_core::Output;
use bun_http::Method;
use bun_jsc::{CallFrame, ErrorCode, JSGlobalObject, JSPromise, JSValue, JsError, JsResult};
use bun_runtime::node::{PathLike, PathOrBlob};
use bun_runtime::webcore::blob::{self, Blob};
use bun_s3 as s3;
use bun_str::strings;

use super::s3_client;
use super::s3_stat::S3Stat;

pub fn write_format<F, W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
    s3: &mut blob::store::S3,
    formatter: &mut F,
    writer: &mut W,
    content_type: &[u8],
    offset: usize,
) -> Result<(), bun_core::Error>
// TODO(port): narrow error set — Zig `!void` only fails on writer ops
where
    // TODO(port): Formatter trait — needs write_indent / print_comma / indent / reset_line
    F: bun_jsc::ConsoleFormatter,
{
    writer.write_str(Output::pretty_fmt!("<r>S3Ref<r>", ENABLE_ANSI_COLORS))?;
    let credentials = s3.get_credentials();
    // detect virtual host style bucket name
    let bucket_name: &[u8] = if credentials.virtual_hosted_style && !credentials.endpoint.is_empty() {
        s3::S3Credentials::guess_bucket(&credentials.endpoint).unwrap_or(&credentials.bucket)
    } else {
        &credentials.bucket
    };

    if !bucket_name.is_empty() {
        write!(
            writer,
            // TODO(port): comptime Output.prettyFmt — needs const-format macro accepting ENABLE_ANSI_COLORS
            Output::pretty_fmt!(" (<green>\"{}/{}\"<r>)<r> {{", ENABLE_ANSI_COLORS),
            bstr::BStr::new(bucket_name),
            bstr::BStr::new(s3.path()),
        )?;
    } else {
        write!(
            writer,
            Output::pretty_fmt!(" (<green>\"{}\"<r>)<r> {{", ENABLE_ANSI_COLORS),
            bstr::BStr::new(s3.path()),
        )?;
    }

    if !content_type.is_empty() {
        writer.write_str("\n")?;
        // PORT NOTE: reshaped for borrowck — Zig `defer formatter.indent -|= 1;` inlined (scopeguard would alias &mut formatter)
        formatter.indent += 1;

        formatter.write_indent(writer)?;
        write!(
            writer,
            Output::pretty_fmt!("type<d>:<r> <green>\"{}\"<r>", ENABLE_ANSI_COLORS),
            bstr::BStr::new(content_type),
        )?;

        formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;
        if offset > 0 {
            writer.write_str("\n")?;
        }
        formatter.indent = formatter.indent.saturating_sub(1);
    }

    if offset > 0 {
        // PORT NOTE: reshaped for borrowck — Zig `defer formatter.indent -|= 1;` inlined
        formatter.indent += 1;

        formatter.write_indent(writer)?;

        write!(
            writer,
            Output::pretty_fmt!("offset<d>:<r> <yellow>{}<r>", ENABLE_ANSI_COLORS),
            offset,
        )?;

        formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;
        formatter.indent = formatter.indent.saturating_sub(1);
    }
    s3_client::write_format_credentials::<F, W, ENABLE_ANSI_COLORS>(credentials, s3.options, s3.acl, formatter, writer)?;
    formatter.write_indent(writer)?;
    writer.write_str("}")?;
    formatter.reset_line();
    Ok(())
}

#[bun_jsc::host_fn]
pub fn presign(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(3).slice();
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);

    // accept a path or a blob
    let mut path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;
    // errdefer: PathOrBlob impls Drop in Rust — path variant cleaned up automatically on `?`

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.is_none() || !matches!(blob.store.as_ref().unwrap().data, blob::store::Data::S3(_)) {
            return global.throw_invalid_arguments("Expected a S3 or path to presign", &[]);
        }
    }

    match path_or_blob {
        PathOrBlob::Path(path) => {
            if matches!(path, bun_runtime::node::PathOrFileDescriptor::Fd(_)) {
                return global.throw_invalid_arguments("Expected a S3 or path to presign", &[]);
            }
            let options = args.next_eat();
            let mut blob = construct_s3_file_internal_store(global, path.path(), options)?;
            get_presign_url_from(&mut blob, global, options)
        }
        PathOrBlob::Blob(mut blob) => get_presign_url_from(&mut blob, global, args.next_eat()),
    }
}

#[bun_jsc::host_fn]
pub fn unlink(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(3).slice();
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);

    // accept a path or a blob
    let path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.is_none() || !matches!(blob.store.as_ref().unwrap().data, blob::store::Data::S3(_)) {
            return global.throw_invalid_arguments("Expected a S3 or path to delete", &[]);
        }
    }

    match path_or_blob {
        PathOrBlob::Path(path) => {
            if matches!(path, bun_runtime::node::PathOrFileDescriptor::Fd(_)) {
                return global.throw_invalid_arguments("Expected a S3 or path to delete", &[]);
            }
            let options = args.next_eat();
            let blob = construct_s3_file_internal_store(global, path.path(), options)?;
            let store = blob.store.as_ref().unwrap();
            store.data.as_s3().unlink(store, global, options)
        }
        PathOrBlob::Blob(blob) => {
            let store = blob.store.as_ref().unwrap();
            store.data.as_s3().unlink(store, global, args.next_eat())
        }
    }
}

#[bun_jsc::host_fn]
pub fn write(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(3).slice();
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);

    // accept a path or a blob
    let mut path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.is_none() || !matches!(blob.store.as_ref().unwrap().data, blob::store::Data::S3(_)) {
            return global.throw_invalid_arguments("Expected a S3 or path to upload", &[]);
        }
    }

    let Some(data) = args.next_eat() else {
        return global.err(bun_jsc::ErrorCode::MISSING_ARGS, "Expected a Blob-y thing to upload", &[]).throw();
    };

    match path_or_blob {
        PathOrBlob::Path(path) => {
            let options = args.next_eat();
            if matches!(path, bun_runtime::node::PathOrFileDescriptor::Fd(_)) {
                return global.throw_invalid_arguments("Expected a S3 or path to upload", &[]);
            }
            let blob = construct_s3_file_internal_store(global, path.path(), options)?;

            let mut blob_internal = PathOrBlob::Blob(blob);
            Blob::write_file_internal(
                global,
                &mut blob_internal,
                data,
                blob::WriteFileOptions {
                    mkdirp_if_not_exists: false,
                    extra_options: options,
                    ..Default::default()
                },
            )
        }
        PathOrBlob::Blob(blob) => {
            // PORT NOTE: reshaped for borrowck — match consumes path_or_blob; rebuild to pass &mut PathOrBlob
            let mut pob = PathOrBlob::Blob(blob);
            Blob::write_file_internal(
                global,
                &mut pob,
                data,
                blob::WriteFileOptions {
                    mkdirp_if_not_exists: false,
                    extra_options: args.next_eat(),
                    ..Default::default()
                },
            )
        }
    }
}

#[bun_jsc::host_fn]
pub fn size(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(3).slice();
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);

    // accept a path or a blob
    let mut path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.is_none() || !matches!(blob.store.as_ref().unwrap().data, blob::store::Data::S3(_)) {
            return global.throw_invalid_arguments("Expected a S3 or path to get size", &[]);
        }
    }

    match &mut path_or_blob {
        PathOrBlob::Path(path) => {
            let options = args.next_eat();
            if matches!(path, bun_runtime::node::PathOrFileDescriptor::Fd(_)) {
                return global.throw_invalid_arguments("Expected a S3 or path to get size", &[]);
            }
            let mut blob = construct_s3_file_internal_store(global, path.path(), options)?;

            S3BlobStatTask::size(global, &mut blob)
        }
        PathOrBlob::Blob(blob) => Blob::get_size(blob, global),
    }
}

#[bun_jsc::host_fn]
pub fn exists(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(3).slice();
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);

    // accept a path or a blob
    let mut path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.is_none() || !matches!(blob.store.as_ref().unwrap().data, blob::store::Data::S3(_)) {
            return global.throw_invalid_arguments("Expected a S3 or path to check if it exists", &[]);
        }
    }

    match &mut path_or_blob {
        PathOrBlob::Path(path) => {
            let options = args.next_eat();
            if matches!(path, bun_runtime::node::PathOrFileDescriptor::Fd(_)) {
                return global.throw_invalid_arguments("Expected a S3 or path to check if it exists", &[]);
            }
            let mut blob = construct_s3_file_internal_store(global, path.path(), options)?;

            S3BlobStatTask::exists(global, &mut blob)
        }
        PathOrBlob::Blob(blob) => Blob::get_exists(blob, global, callframe),
    }
}

fn construct_s3_file_internal_store(
    global: &JSGlobalObject,
    path: PathLike,
    options: Option<JSValue>,
) -> JsResult<Blob> {
    // get credentials from env
    let existing_credentials = global.bun_vm().transpiler.env.get_s3_credentials();
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
    let aws_options = s3::S3Credentials::get_credentials_with_options(
        default_credentials.clone(),
        default_options,
        options,
        default_acl,
        default_storage_class,
        default_request_payer,
        global,
    )?;

    let store = 'brk: {
        if aws_options.changed_credentials {
            break 'brk blob::Store::init_s3(path, None, aws_options.credentials);
        } else {
            break 'brk blob::Store::init_s3_with_referenced_credentials(path, None, default_credentials);
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
                        blob.content_type_was_set = true;
                        if let Some(entry) = global.bun_vm().mime_type(str.slice()) {
                            blob.content_type = entry.value;
                            break 'inner;
                        }
                        let mut content_type_buf = vec![0u8; slice.len()].into_boxed_slice();
                        // TODO(port): blob.content_type ownership — Zig stores raw slice + allocated flag
                        blob.content_type = strings::copy_lowercase(slice, &mut content_type_buf);
                        blob.content_type_allocated = true;
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
    let aws_options = s3::S3Credentials::get_credentials_with_options(
        existing_credentials,
        Default::default(),
        options,
        None,
        None,
        false,
        global,
    )?;
    let store = blob::Store::init_s3(path, None, aws_options.credentials);
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
                        blob.content_type_was_set = true;
                        if let Some(entry) = global.bun_vm().mime_type(str.slice()) {
                            blob.content_type = entry.value;
                            break 'inner;
                        }
                        let mut content_type_buf = vec![0u8; slice.len()].into_boxed_slice();
                        // TODO(port): blob.content_type ownership — Zig stores raw slice + allocated flag
                        blob.content_type = strings::copy_lowercase(slice, &mut content_type_buf);
                        blob.content_type_allocated = true;
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
) -> JsResult<Box<Blob>> {
    Ok(Blob::new(construct_s3_file_internal_store(global, path, options)?))
}

pub struct S3BlobStatTask<'a> {
    promise: bun_jsc::JSPromiseStrong,
    global: &'a JSGlobalObject,
    store: Arc<blob::Store>,
    // TODO(port): lifetime — heap-allocated across async callback; LIFETIMES.tsv says JSC_BORROW (&JSGlobalObject)
}

impl<'a> S3BlobStatTask<'a> {
    pub fn new(init: S3BlobStatTask<'a>) -> *mut S3BlobStatTask<'a> {
        Box::into_raw(Box::new(init))
    }

    pub fn on_s3_exists_resolved(result: s3::S3StatResult, this: *mut S3BlobStatTask<'a>) -> JsResult<()> {
        // SAFETY: `this` was allocated via Box::into_raw in `exists`; reconstructing here replaces `defer this.deinit()`
        let this = unsafe { Box::from_raw(this) };
        match result {
            s3::S3StatResult::NotFound => {
                this.promise.resolve(this.global, JSValue::FALSE)?;
            }
            s3::S3StatResult::Success(_) => {
                // calling .exists() should not prevent it to download a bigger file
                // this would make it download a slice of the actual value, if the file changes before we download it
                // if (this.blob.size == Blob.max_size) {
                //     this.blob.size = @truncate(stat.size);
                // }
                this.promise.resolve(this.global, JSValue::TRUE)?;
            }
            s3::S3StatResult::Failure(err) => {
                this.promise.reject(
                    this.global,
                    err.to_js_with_async_stack(this.global, this.store.data.as_s3().path(), this.promise.get()),
                )?;
            }
        }
        Ok(())
    }

    pub fn on_s3_size_resolved(result: s3::S3StatResult, this: *mut S3BlobStatTask<'a>) -> JsResult<()> {
        // SAFETY: `this` was allocated via Box::into_raw in `size`; reconstructing here replaces `defer this.deinit()`
        let this = unsafe { Box::from_raw(this) };

        match result {
            s3::S3StatResult::Success(stat_result) => {
                this.promise.resolve(this.global, JSValue::js_number(stat_result.size))?;
            }
            s3::S3StatResult::NotFound(err) | s3::S3StatResult::Failure(err) => {
                // TODO(port): Zig binds same payload name for .not_found and .failure arms; verify NotFound carries an error payload
                this.promise.reject(
                    this.global,
                    err.to_js_with_async_stack(this.global, this.store.data.as_s3().path(), this.promise.get()),
                )?;
            }
        }
        Ok(())
    }

    pub fn on_s3_stat_resolved(result: s3::S3StatResult, this: *mut S3BlobStatTask<'a>) -> JsResult<()> {
        // SAFETY: `this` was allocated via Box::into_raw in `stat`; reconstructing here replaces `defer this.deinit()`
        let this = unsafe { Box::from_raw(this) };
        let global = this.global;
        match result {
            s3::S3StatResult::Success(stat_result) => {
                this.promise.resolve(
                    global,
                    S3Stat::init(
                        stat_result.size,
                        stat_result.etag,
                        stat_result.content_type,
                        stat_result.last_modified,
                        global,
                    )?
                    .to_js(global),
                )?;
            }
            s3::S3StatResult::NotFound(err) | s3::S3StatResult::Failure(err) => {
                this.promise.reject(
                    global,
                    err.to_js_with_async_stack(global, this.store.data.as_s3().path(), this.promise.get()),
                )?;
            }
        }
        Ok(())
    }

    pub fn exists(global: &'a JSGlobalObject, blob: &mut Blob) -> JsResult<JSValue> {
        let this = S3BlobStatTask::new(S3BlobStatTask {
            promise: JSPromise::Strong::init(global),
            store: blob.store.as_ref().unwrap().clone(),
            global,
        });
        // SAFETY: `this` is a freshly leaked Box; valid for the duration of this call
        let this_ref = unsafe { &mut *this };
        let promise = this_ref.promise.value();
        let s3_store = blob.store.as_ref().unwrap().data.as_s3();
        let credentials = s3_store.get_credentials();
        let path = s3_store.path();
        let env = &global.bun_vm().transpiler.env;

        s3::stat(
            credentials,
            path,
            // TODO(port): @ptrCast fn pointer — verify s3::stat callback signature matches
            S3BlobStatTask::on_s3_exists_resolved as _,
            this,
            env.get_http_proxy(true, None, None).map(|proxy| proxy.href),
            s3_store.request_payer,
        )?;
        Ok(promise)
    }

    pub fn stat(global: &'a JSGlobalObject, blob: &mut Blob) -> JsResult<JSValue> {
        let this = S3BlobStatTask::new(S3BlobStatTask {
            promise: JSPromise::Strong::init(global),
            store: blob.store.as_ref().unwrap().clone(),
            global,
        });
        // SAFETY: `this` is a freshly leaked Box; valid for the duration of this call
        let this_ref = unsafe { &mut *this };
        let promise = this_ref.promise.value();
        let s3_store = blob.store.as_ref().unwrap().data.as_s3();
        let credentials = s3_store.get_credentials();
        let path = s3_store.path();
        let env = &global.bun_vm().transpiler.env;

        s3::stat(
            credentials,
            path,
            S3BlobStatTask::on_s3_stat_resolved as _,
            this,
            env.get_http_proxy(true, None, None).map(|proxy| proxy.href),
            s3_store.request_payer,
        )?;
        Ok(promise)
    }

    pub fn size(global: &'a JSGlobalObject, blob: &mut Blob) -> JsResult<JSValue> {
        let this = S3BlobStatTask::new(S3BlobStatTask {
            promise: JSPromise::Strong::init(global),
            store: blob.store.as_ref().unwrap().clone(),
            global,
        });
        // SAFETY: `this` is a freshly leaked Box; valid for the duration of this call
        let this_ref = unsafe { &mut *this };
        let promise = this_ref.promise.value();
        let s3_store = blob.store.as_ref().unwrap().data.as_s3();
        let credentials = s3_store.get_credentials();
        let path = s3_store.path();
        let env = &global.bun_vm().transpiler.env;

        s3::stat(
            credentials,
            path,
            S3BlobStatTask::on_s3_size_resolved as _,
            this,
            env.get_http_proxy(true, None, None).map(|proxy| proxy.href),
            s3_store.request_payer,
        )?;
        Ok(promise)
    }

    // deinit: store.deref() + promise.deinit() + bun.destroy(this) — all handled by Box<Self> Drop
}

pub fn get_presign_url_from(this: &mut Blob, global: &JSGlobalObject, extra_options: Option<JSValue>) -> JsResult<JSValue> {
    if !this.is_s3() {
        return global.err(bun_jsc::ErrorCode::INVALID_THIS, "presign is only possible for s3:// files", &[]).throw();
    }

    let mut method: Method = Method::GET;
    let mut expires: usize = 86400; // 1 day default

    let s3 = this.store.as_ref().unwrap().data.as_s3();
    let mut credentials_with_options = s3::S3CredentialsWithOptions {
        credentials: s3.get_credentials().clone(),
        request_payer: s3.request_payer,
        ..Default::default()
    };

    if let Some(options) = extra_options {
        if options.is_object() {
            if let Some(method_) = options.get_truthy(global, "method")? {
                method = match Method::from_js(global, method_)? {
                    Some(m) => m,
                    None => {
                        return global.throw_invalid_arguments(
                            "method must be GET, PUT, DELETE or HEAD when using s3 protocol",
                            &[],
                        );
                    }
                };
            }
            if let Some(expires_) = options.get_optional::<i32>(global, "expiresIn")? {
                if expires_ <= 0 {
                    return global.throw_invalid_arguments("expiresIn must be greather than 0", &[]);
                }
                expires = usize::try_from(expires_).unwrap();
            }
        }
        credentials_with_options = s3.get_credentials_with_options(options, global)?;
    }
    let path = s3.path();

    let result = match credentials_with_options.credentials.sign_request(
        s3::SignRequestOptions {
            path,
            method,
            acl: credentials_with_options.acl,
            storage_class: credentials_with_options.storage_class,
            request_payer: credentials_with_options.request_payer,
            content_disposition: credentials_with_options.content_disposition,
            content_type: credentials_with_options.content_type,
            ..Default::default()
        },
        false,
        s3::SignQueryOptions { expires },
    ) {
        Ok(r) => r,
        Err(sign_err) => return s3::throw_sign_error(sign_err, global),
    };
    bun_str::String::create_utf8_for_js(this.global_this, &result.url)
}

pub fn get_bucket_name(this: &Blob) -> Option<&[u8]> {
    let store = this.store.as_ref()?;
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

#[bun_jsc::host_fn(getter)]
pub fn get_bucket(this: &Blob, global: &JSGlobalObject) -> JsResult<JSValue> {
    if let Some(name) = get_bucket_name(this) {
        return bun_str::String::create_utf8_for_js(global, name);
    }
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn(method)]
pub fn get_presign_url(this: &mut Blob, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let args = callframe.arguments_old(1);
    get_presign_url_from(this, global, if args.len() > 0 { Some(args.ptr[0]) } else { None })
}

#[bun_jsc::host_fn(method)]
pub fn get_stat(this: &mut Blob, global: &JSGlobalObject, _callframe: &CallFrame) -> JsResult<JSValue> {
    S3BlobStatTask::stat(global, this)
}

#[bun_jsc::host_fn]
pub fn stat(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments_old(3).slice();
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);

    // accept a path or a blob
    let mut path_or_blob = PathOrBlob::from_js_no_copy(global, &mut args)?;

    if let PathOrBlob::Blob(blob) = &path_or_blob {
        if blob.store.is_none() || !matches!(blob.store.as_ref().unwrap().data, blob::store::Data::S3(_)) {
            return global.throw_invalid_arguments("Expected a S3 or path to get size", &[]);
        }
    }

    match &mut path_or_blob {
        PathOrBlob::Path(path) => {
            let options = args.next_eat();
            if matches!(path, bun_runtime::node::PathOrFileDescriptor::Fd(_)) {
                return global.throw_invalid_arguments("Expected a S3 or path to get size", &[]);
            }
            let mut blob = construct_s3_file_internal_store(global, path.path(), options)?;

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
    Ok(blob.to_js(global))
}

pub fn to_js_unchecked(global: &JSGlobalObject, this: *mut Blob) -> JSValue {
    // SAFETY: BUN__createJSS3FileUnsafely is an FFI binding that takes ownership of the Blob pointer
    unsafe { BUN__createJSS3FileUnsafely(global, this) }
}

pub fn construct_internal(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<Box<Blob>> {
    let vm = global.bun_vm();
    let arguments = callframe.arguments_old(2).slice();
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments);

    let Some(path) = PathLike::from_js(global, &mut args)? else {
        return global.throw_invalid_arguments("Expected file path string", &[]);
    };
    construct_s3_file_internal(global, path, args.next_eat())
}

// TODO(port): callconv(jsc.conv) — #[bun_jsc::host_fn] macro emits the raw ABI shim; @export name handled below
pub fn construct(global: &JSGlobalObject, callframe: &CallFrame) -> Option<Box<Blob>> {
    match construct_internal(global, callframe) {
        Ok(b) => Some(b),
        Err(JsError::Thrown) => None,
        Err(JsError::OutOfMemory) => {
            let _ = global.throw_out_of_memory_value();
            None
        }
        Err(JsError::Terminated) => None,
    }
}

// TODO(port): callconv(jsc.conv) — raw ABI shim emitted by #[bun_jsc::host_fn]
pub fn has_instance(_: JSValue, _global: &JSGlobalObject, value: JSValue) -> bool {
    bun_jsc::mark_binding(core::panic::Location::caller());
    let Some(blob) = value.as_::<Blob>() else {
        return false;
    };
    blob.is_s3()
}

// @export block — symbols exported with C linkage and JSC calling convention.
// TODO(port): these need #[unsafe(export_name = "...")] on the raw ABI shims that #[bun_jsc::host_fn] emits.
// JSS3File__presign   -> raw shim wrapping get_presign_url (method-with-context)
// JSS3File__construct -> construct
// JSS3File__hasInstance -> has_instance
// JSS3File__bucket    -> get_bucket
// JSS3File__stat      -> raw shim wrapping get_stat (method-with-context)

pub mod exports {
    // TODO(port): jsc.toJSHostFnWithContext(Blob, fn) — equivalent is the shim #[bun_jsc::host_fn(method)] emits;
    // these consts are the raw `extern "sysv64"/"C"` fn pointers exported above.
    pub const JSS3FILE_PRESIGN: () = ();
    pub const JSS3FILE_STAT: () = ();
}

// TODO(port): move to <area>_sys
unsafe extern "C" {
    // TODO(port): callconv(jsc.conv) — actual ABI is sysv64 on Windows-x64, C elsewhere
    fn BUN__createJSS3File(global: *const JSGlobalObject, callframe: *const CallFrame) -> JSValue;
    fn BUN__createJSS3FileUnsafely(global: *const JSGlobalObject, blob: *mut Blob) -> JSValue;
}

#[bun_jsc::host_fn]
pub fn create_js_s3_file(global: &JSGlobalObject, callframe: &CallFrame) -> JSValue {
    // SAFETY: thin wrapper around the C++ FFI binding
    unsafe { BUN__createJSS3File(global, callframe) }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/S3File.zig (665 lines)
//   confidence: medium
//   todos:      13
//   notes:      S3BlobStatTask lifetime (<'a> on heap struct) is awkward — LIFETIMES.tsv says JSC_BORROW; Phase B may need *const JSGlobalObject. @export/jsc.conv shims and toJSHostFnWithContext need proc-macro wiring. Output::pretty_fmt! is a placeholder for comptime ANSI formatting.
// ──────────────────────────────────────────────────────────────────────────
