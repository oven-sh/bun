use bstr::BStr;

use crate::node::PathLike;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::BlobExt as _;
use crate::webcore::blob::store::S3Ext as _;
use crate::webcore::s3::MultiPartUploadOptions;
use crate::webcore::s3::client::{ACL, S3Credentials, StorageClass};
use bun_jsc::{CallFrame, ConsoleFormatter, ErrorCode, JSGlobalObject, JSValue, JsResult};

use super::s3_file as S3File;

bun_core::declare_scope!(S3Client, visible);

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

// ── Local extension shims ─────────────────────────────────────────────────
// `bun_s3_signing::S3Credentials` exposes `guessRegion` / `guessBucket` as
// FREE fns and the JS-options parser lives in
// `runtime/webcore/s3/credentials_jsc.rs`. Surface them as associated fns via
// an extension trait so call sites can use the associated-fn shape
// (`S3Credentials.guessRegion(...)` / `.getCredentialsWithOptions(...)`).
pub(crate) trait S3CredentialsExt {
    fn guess_region(endpoint: &[u8]) -> &[u8];
    fn guess_bucket(endpoint: &[u8]) -> Option<&[u8]>;
    fn get_credentials_with_options(
        // Takes `&S3Credentials` (not by-value) — `bun_s3_signing::S3Credentials`
        // has a private `ref_count` field and no `Clone`, so callers holding a borrow
        // (e.g. `&RefPtr<S3Credentials>` deref) cannot produce an owned copy. The
        // real impl in `s3/credentials_jsc.rs` deep-copies internally.
        this: &S3Credentials,
        default_options: MultiPartUploadOptions,
        options: Option<JSValue>,
        default_acl: Option<ACL>,
        default_storage_class: Option<StorageClass>,
        default_request_payer: bool,
        global: &JSGlobalObject,
    ) -> JsResult<bun_s3_signing::S3CredentialsWithOptions>;
}
impl S3CredentialsExt for S3Credentials {
    #[inline]
    fn guess_region(endpoint: &[u8]) -> &[u8] {
        bun_s3_signing::credentials::guess_region(endpoint)
    }
    #[inline]
    fn guess_bucket(endpoint: &[u8]) -> Option<&[u8]> {
        bun_s3_signing::credentials::guess_bucket(endpoint)
    }
    #[inline]
    fn get_credentials_with_options(
        this: &S3Credentials,
        default_options: MultiPartUploadOptions,
        options: Option<JSValue>,
        default_acl: Option<ACL>,
        default_storage_class: Option<StorageClass>,
        default_request_payer: bool,
        global: &JSGlobalObject,
    ) -> JsResult<bun_s3_signing::S3CredentialsWithOptions> {
        crate::webcore::s3::credentials_jsc::get_credentials_with_options(
            this,
            default_options,
            options,
            default_acl,
            default_storage_class,
            default_request_payer,
            global,
        )
    }
}

/// How [`S3Client::blob_and_options`] reports a missing or unparseable path
/// argument. `presign`/`exists`/`size`/`stat` distinguish "no argument"
/// (`MISSING_ARGS`) from "argument is not a path" (invalid arguments), while
/// `unlink` reports `MISSING_ARGS` for both.
#[derive(Clone, Copy)]
enum MissingPathError {
    MissingOrInvalid,
    AlwaysMissingArgs,
}

#[inline]
fn opt_js(v: JSValue) -> Option<JSValue> {
    if v.is_empty_or_undefined_or_null() {
        None
    } else {
        Some(v)
    }
}

pub(crate) fn write_format_credentials<F, W, const ENABLE_ANSI_COLORS: bool>(
    credentials: &S3Credentials,
    options: MultiPartUploadOptions,
    acl: Option<ACL>,
    formatter: &mut F,
    writer: &mut W,
) -> core::fmt::Result
where
    F: ConsoleFormatter,
    W: core::fmt::Write,
{
    writer.write_str("\n")?;

    {
        // `IndentScope` shadows the borrow and restores indent on `Drop`, so a
        // `?` early-return below still leaves the formatter at its original
        // depth (observable when `print_as` throws and the caller continues
        // formatting).
        let mut formatter = bun_jsc::IndentScope::new(&mut *formatter);

        let endpoint: &[u8] = if !credentials.endpoint.is_empty() {
            &credentials.endpoint
        } else if credentials.virtual_hosted_style {
            b"https://<bucket>.s3.<region>.amazonaws.com"
        } else {
            b"https://s3.<region>.amazonaws.com"
        };

        formatter.write_indent(writer)?;
        writer.write_str(pfmt!("<r>endpoint<d>:<r> \"", ENABLE_ANSI_COLORS))?;
        bun_core::write_pretty!(
            writer,
            ENABLE_ANSI_COLORS,
            "<r><b>{s}<r>\"",
            BStr::new(endpoint),
        )?;
        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
        writer.write_str("\n")?;

        let region: &[u8] = if !credentials.region.is_empty() {
            &credentials.region
        } else {
            <S3Credentials as S3CredentialsExt>::guess_region(&credentials.endpoint)
        };
        formatter.write_indent(writer)?;
        writer.write_str(pfmt!("<r>region<d>:<r> \"", ENABLE_ANSI_COLORS))?;
        bun_core::write_pretty!(
            writer,
            ENABLE_ANSI_COLORS,
            "<r><b>{s}<r>\"",
            BStr::new(region),
        )?;
        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
        writer.write_str("\n")?;

        // PS: We don't want to print the credentials if they are empty just signal that they are there without revealing them
        if !credentials.access_key_id.is_empty() {
            formatter.write_indent(writer)?;
            writer.write_str(pfmt!(
                "<r>accessKeyId<d>:<r> \"<r><b>[REDACTED]<r>\"",
                ENABLE_ANSI_COLORS
            ))?;
            formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;

            writer.write_str("\n")?;
        }

        if !credentials.secret_access_key.is_empty() {
            formatter.write_indent(writer)?;
            writer.write_str(pfmt!(
                "<r>secretAccessKey<d>:<r> \"<r><b>[REDACTED]<r>\"",
                ENABLE_ANSI_COLORS
            ))?;
            formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;

            writer.write_str("\n")?;
        }

        if !credentials.session_token.is_empty() {
            formatter.write_indent(writer)?;
            writer.write_str(pfmt!(
                "<r>sessionToken<d>:<r> \"<r><b>[REDACTED]<r>\"",
                ENABLE_ANSI_COLORS
            ))?;
            formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;

            writer.write_str("\n")?;
        }

        if let Some(acl_value) = acl {
            formatter.write_indent(writer)?;
            writer.write_str(pfmt!("<r>acl<d>:<r> \"", ENABLE_ANSI_COLORS))?;
            bun_core::write_pretty!(
                writer,
                ENABLE_ANSI_COLORS,
                "<r><b>{s}<r>\"",
                BStr::new(acl_value.to_string()),
            )?;
            formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;

            writer.write_str("\n")?;
        }

        formatter.write_indent(writer)?;
        writer.write_str(pfmt!("<r>partSize<d>:<r> ", ENABLE_ANSI_COLORS))?;
        formatter
            .print_as::<W, ENABLE_ANSI_COLORS>(
                FormatTag::Double,
                writer,
                JSValue::js_number(options.part_size as f64),
                JSType::NumberObject,
            )
            .map_err(|_| core::fmt::Error)?;
        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;

        writer.write_str("\n")?;

        formatter.write_indent(writer)?;
        writer.write_str(pfmt!("<r>queueSize<d>:<r> ", ENABLE_ANSI_COLORS))?;
        formatter
            .print_as::<W, ENABLE_ANSI_COLORS>(
                FormatTag::Double,
                writer,
                JSValue::js_number(options.queue_size as f64),
                JSType::NumberObject,
            )
            .map_err(|_| core::fmt::Error)?;
        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
        writer.write_str("\n")?;

        formatter.write_indent(writer)?;
        writer.write_str(pfmt!("<r>retry<d>:<r> ", ENABLE_ANSI_COLORS))?;
        formatter
            .print_as::<W, ENABLE_ANSI_COLORS>(
                FormatTag::Double,
                writer,
                JSValue::js_number(options.retry as f64),
                JSType::NumberObject,
            )
            .map_err(|_| core::fmt::Error)?;
        writer.write_str("\n")?;
    }

    Ok(())
}

#[bun_jsc::JsClass]
pub(crate) struct S3Client {
    pub(crate) credentials: bun_ptr::RefPtr<S3Credentials>,
    pub(crate) options: MultiPartUploadOptions,
    pub(crate) acl: Option<ACL>,
    pub(crate) storage_class: Option<StorageClass>,
    pub(crate) request_payer: bool,
}

impl S3Client {
    // No `#[bun_jsc::host_fn]` here — the `#[bun_jsc::JsClass]`
    // derive on the struct emits `S3ClientClass__construct` which calls
    // `<S3Client>::constructor` directly.
    pub(crate) fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<Self>> {
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, callframe.arguments());
        // `Transpiler::env_mut` is the safe accessor for the process-singleton
        // dotenv loader (set during init). `get_s3_credentials` takes `&mut self`
        // only to lazily memoize — single-threaded JS event-loop discipline applies.
        let env_creds = crate::webcore::fetch::s3_credentials_from_env(
            global
                .bun_vm()
                .as_mut()
                .transpiler
                .env_mut()
                .get_s3_credentials(),
        );
        let aws_options = <S3Credentials as S3CredentialsExt>::get_credentials_with_options(
            &env_creds,
            MultiPartUploadOptions::default(),
            args.next_eat(),
            None,
            None,
            false,
            global,
        )?;
        Ok(Box::new(S3Client {
            credentials: aws_options.credentials.dupe(),
            options: aws_options.options,
            acl: aws_options.acl,
            storage_class: aws_options.storage_class,
            request_payer: aws_options.request_payer,
        }))
    }

    pub(crate) fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> core::fmt::Result
    where
        F: ConsoleFormatter,
        W: core::fmt::Write,
    {
        writer.write_str(pfmt!("<r>S3Client<r>", ENABLE_ANSI_COLORS))?;
        // detect virtual host style bucket name
        let bucket_name: &[u8] =
            if self.credentials.virtual_hosted_style && !self.credentials.endpoint.is_empty() {
                <S3Credentials as S3CredentialsExt>::guess_bucket(&self.credentials.endpoint)
                    .unwrap_or(&self.credentials.bucket)
            } else {
                &self.credentials.bucket
            };
        if !bucket_name.is_empty() {
            bun_core::write_pretty!(
                writer,
                ENABLE_ANSI_COLORS,
                " (<green>\"{s}\"<r>)<r> {{",
                BStr::new(bucket_name),
            )?;
        } else {
            writer.write_str(" {")?;
        }

        write_format_credentials::<F, W, ENABLE_ANSI_COLORS>(
            &self.credentials,
            self.options,
            self.acl,
            formatter,
            writer,
        )?;
        formatter.write_indent(writer)?;
        writer.write_str("}")?;
        formatter.reset_line();
        Ok(())
    }

    /// Constructs the S3 blob for `path` from this client's credentials and
    /// per-client defaults merged with the per-call `options` object. The
    /// returned blob releases its store ref on drop (the Zig `defer
    /// blob.detach()`).
    fn construct_blob(
        &self,
        global: &JSGlobalObject,
        path: PathLike<'static>,
        options: Option<JSValue>,
    ) -> JsResult<crate::webcore::blob::Blob> {
        S3File::construct_s3_file_with_s3_credentials_and_options(
            global,
            path,
            options,
            &self.credentials,
            self.options,
            self.acl,
            self.storage_class,
            self.request_payer,
        )
    }

    /// Shared prologue of the `(path, options?)` instance methods: parses the
    /// path, eats the options argument, and constructs the blob. `verb`
    /// completes the "Expected a path to {verb}" error message.
    fn blob_and_options(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
        verb: &str,
        missing_path: MissingPathError,
    ) -> JsResult<(crate::webcore::blob::Blob, Option<JSValue>)> {
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, callframe.arguments());
        let Some(path) = PathLike::from_js(global, &mut args)? else {
            return Err(match missing_path {
                MissingPathError::MissingOrInvalid if args.len() != 0 => {
                    global.throw_invalid_arguments(format_args!("Expected a path to {verb}"))
                }
                _ => global
                    .err(
                        ErrorCode::MISSING_ARGS,
                        format_args!("Expected a path to {verb}"),
                    )
                    .throw(),
            });
        };
        let options = args.next_eat();
        Ok((self.construct_blob(global, path, options)?, options))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn file(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, callframe.arguments());
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return Err(global
                        .err(ErrorCode::MISSING_ARGS, format_args!("Expected a path "))
                        .throw());
                }
                return Err(global.throw_invalid_arguments(format_args!("Expected a path")));
            }
        };
        let options = args.next_eat();
        // `Blob::new` heap-promotes and marks `ref_count = 1` so
        // the JSS3File wrapper's `finalize` knows to free the blob.
        let blob = crate::webcore::blob::Blob::new(ptr.construct_blob(global, path, options)?);
        // `to_js` runs `calculate_estimated_byte_size()`
        // before wrapping the heap Blob in a JSS3File so JSC sees the correct
        // GC pressure. Route through `BlobExt::to_js` (the `&self` impl, which
        // hands the heap pointer to the wrapper), same as `S3File::construct_internal_js`.
        // SAFETY: `blob` is a freshly leaked `*mut Blob` from `Blob::new`;
        // `to_js` hands ownership of that pointer to the C++ wrapper.
        Ok(unsafe { &mut *blob }.to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn presign(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (mut blob, options) = ptr.blob_and_options(
            global,
            callframe,
            "presign",
            MissingPathError::MissingOrInvalid,
        )?;
        S3File::get_presign_url_from(&mut blob, global, options)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn exists(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (blob, _) = ptr.blob_and_options(
            global,
            callframe,
            "check if it exists",
            MissingPathError::MissingOrInvalid,
        )?;
        S3File::S3BlobStatTask::exists(&global.js_thread_of_caller(callframe), &blob)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn size(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (mut blob, _) = ptr.blob_and_options(
            global,
            callframe,
            "check the size of",
            MissingPathError::MissingOrInvalid,
        )?;
        S3File::S3BlobStatTask::size(&global.js_thread_of_caller(callframe), &mut blob)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn stat(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (blob, _) = ptr.blob_and_options(
            global,
            callframe,
            "check the stat of",
            MissingPathError::MissingOrInvalid,
        )?;
        S3File::S3BlobStatTask::stat(&global.js_thread_of_caller(callframe), &blob)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn write(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let cx = global.js_thread_of_caller(callframe);
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, callframe.arguments());
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                return Err(global
                    .err(
                        ErrorCode::MISSING_ARGS,
                        format_args!("Expected a path to write to"),
                    )
                    .throw());
            }
        };
        let Some(data) = args.next_eat() else {
            return Err(global
                .err(
                    ErrorCode::MISSING_ARGS,
                    format_args!("Expected a Blob-y thing to write"),
                )
                .throw());
        };

        let options = args.next_eat();
        let blob = ptr.construct_blob(global, path, options)?;
        // Move into `PathOrBlob` directly; cleanup of the moved-out value is
        // handled by `Drop`.
        let mut blob_internal = crate::webcore::node_types::PathOrBlob::Blob(Box::new(blob));
        crate::webcore::blob::write_file_internal(
            &cx,
            &mut blob_internal,
            data,
            crate::webcore::blob::WriteFileOptions {
                mkdirp_if_not_exists: Some(false),
                extra_options: options,
                mode: None,
            },
        )
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn list_objects(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();

        let object_keys = args[0];
        let options = opt_js(args[1]);

        let blob = S3File::construct_s3_file_with_s3_credentials_and_options(
            global,
            PathLike::default(),
            options,
            &ptr.credentials,
            ptr.options,
            None,
            None,
            ptr.request_payer,
        )?;

        let store = blob.store.get().as_ref().unwrap();
        store.data.as_s3().list_objects(
            store,
            &global.js_thread_of_caller(callframe),
            object_keys,
            options,
        )
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn unlink(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let (blob, options) = ptr.blob_and_options(
            global,
            callframe,
            "unlink",
            MissingPathError::AlwaysMissingArgs,
        )?;
        let store = blob.store.get().as_ref().unwrap();
        store
            .data
            .as_s3()
            .unlink(store, &global.js_thread_of_caller(callframe), options)
    }

    fn bucket_request(
        &self,
        global: &JSGlobalObject,
        name: JSValue,
        options: Option<JSValue>,
    ) -> JsResult<BucketRequest> {
        let aws_options = <S3Credentials as S3CredentialsExt>::get_credentials_with_options(
            &self.credentials,
            self.options,
            options,
            None,
            None,
            self.request_payer,
            global,
        )?;
        BucketRequest::new(global, aws_options, &self.credentials.bucket, name, options)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn bucket_exists(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();
        let request = ptr.bucket_request(global, args[0], opt_js(args[1]))?;
        BucketTask::exists(&global.js_thread_of_caller(callframe), &request)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn create_bucket(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();
        let request = ptr.bucket_request(global, args[0], opt_js(args[1]))?;
        BucketTask::create(&global.js_thread_of_caller(callframe), &request)
    }

    #[bun_jsc::host_fn(method)]
    pub(crate) fn delete_bucket(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();
        let request = ptr.bucket_request(global, args[0], opt_js(args[1]))?;
        BucketTask::delete(&global.js_thread_of_caller(callframe), &request)
    }

    // ── Static methods ────────────────────────────────────────────────────
    // Codegen (`generated_classes.rs`) emits `S3ClientClass__static*` extern
    // wrappers that call these as `S3Client::static_*(global, callframe)`,
    // so they must be associated fns (no `#[bun_jsc::host_fn]` needed — the
    // codegen layer already handles the `host_fn_result` wrapping).

    pub(crate) fn static_write(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        S3File::write(global, callframe)
    }

    pub(crate) fn static_presign(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        S3File::presign(global, callframe)
    }

    pub(crate) fn static_exists(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        S3File::exists(global, callframe)
    }

    pub(crate) fn static_size(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::size(global, callframe)
    }

    pub(crate) fn static_unlink(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        S3File::unlink(global, callframe)
    }

    pub(crate) fn static_file(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, callframe.arguments());

        let Some(path) = PathLike::from_js(global, &mut args)? else {
            return Err(global.throw_invalid_arguments(format_args!("Expected file path string")));
        };

        S3File::construct_internal_js(global, path, args.next_eat())
    }

    pub(crate) fn static_stat(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::stat(global, callframe)
    }

    fn static_bucket_request(
        global: &JSGlobalObject,
        name: JSValue,
        options: Option<JSValue>,
    ) -> JsResult<BucketRequest> {
        let env_creds = crate::webcore::fetch::s3_credentials_from_env(
            global
                .bun_vm()
                .as_mut()
                .transpiler
                .env_mut()
                .get_s3_credentials(),
        );
        let aws_options = <S3Credentials as S3CredentialsExt>::get_credentials_with_options(
            &env_creds,
            MultiPartUploadOptions::default(),
            options,
            None,
            None,
            false,
            global,
        )?;
        BucketRequest::new(global, aws_options, &env_creds.bucket, name, options)
    }

    pub(crate) fn static_bucket_exists(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();
        let request = Self::static_bucket_request(global, args[0], opt_js(args[1]))?;
        BucketTask::exists(&global.js_thread_of_caller(callframe), &request)
    }

    pub(crate) fn static_create_bucket(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();
        let request = Self::static_bucket_request(global, args[0], opt_js(args[1]))?;
        BucketTask::create(&global.js_thread_of_caller(callframe), &request)
    }

    pub(crate) fn static_delete_bucket(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();
        let request = Self::static_bucket_request(global, args[0], opt_js(args[1]))?;
        BucketTask::delete(&global.js_thread_of_caller(callframe), &request)
    }

    pub(crate) fn static_list_objects(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();
        let object_keys = args[0];
        let options = opt_js(args[1]);

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

        let blob = S3File::construct_s3_file_with_s3_credentials(
            global,
            PathLike::default(),
            options,
            &existing_credentials,
        )?;

        let store = blob.store.get().as_ref().unwrap();
        store.data.as_s3().list_objects(
            store,
            &global.js_thread_of_caller(callframe),
            object_keys,
            options,
        )
    }
}

struct BucketRequest {
    credentials: S3Credentials,
    /// Only from the call, never the client's: S3 refuses a bucket ACL under enforced object ownership.
    acl: Option<ACL>,
    object_lock_enabled: bool,
    request_payer: bool,
}

impl BucketRequest {
    /// `base_bucket` is the bucket of the client or the environment, before
    /// the options of the call.
    fn new(
        global: &JSGlobalObject,
        mut aws_options: bun_s3_signing::S3CredentialsWithOptions,
        base_bucket: &[u8],
        name: JSValue,
        options: Option<JSValue>,
    ) -> JsResult<Self> {
        if !name.is_empty_or_undefined_or_null() {
            if !name.is_string() {
                return Err(global.throw_invalid_argument_type_value(b"name", b"string", name));
            }
            aws_options.credentials.bucket = name.to_utf8(global)?.into_vec().into_boxed_slice();
        }
        let credentials = &aws_options.credentials;
        // The host is the bucket here, so a name or a bucket option could not reach the wire.
        if credentials.virtual_hosted_style && !credentials.endpoint.is_empty() {
            let host_bucket =
                <S3Credentials as S3CredentialsExt>::guess_bucket(&credentials.endpoint)
                    .unwrap_or(base_bucket);
            if !credentials.bucket.is_empty() && *credentials.bucket != *host_bucket {
                return Err(global.throw_invalid_arguments(format_args!(
                    "A virtualHostedStyle endpoint names its bucket. Pass no name, or a client for that bucket"
                )));
            }
        }
        // A separator inside the bucket would make the request an object request on the bucket before it.
        let bucket = bun_core::strings::trim(&aws_options.credentials.bucket, b"/\\");
        if bun_core::strings::index_of_any(bucket, b"/\\").is_some() {
            return Err(global.throw_invalid_arguments(format_args!(
                "The bucket name must not contain a slash"
            )));
        }
        let object_lock_enabled = match options {
            Some(opts) if opts.is_object() => opts
                .get_boolean_strict(global, "objectLockEnabled")?
                .unwrap_or(false),
            _ => false,
        };
        Ok(Self {
            credentials: core::mem::take(&mut aws_options.credentials),
            acl: aws_options.acl,
            object_lock_enabled,
            request_payer: aws_options.request_payer,
        })
    }
}

struct BucketTask {
    promise: bun_jsc::JSPromiseStrong,
    global: bun_ptr::BackRef<JSGlobalObject>,
    bucket: Box<[u8]>,
}

impl BucketTask {
    fn new(cx: &bun_jsc::JsThread<'_>, request: &BucketRequest) -> *mut Self {
        bun_core::heap::into_raw(Box::new(Self {
            promise: bun_jsc::JSPromiseStrong::init(cx.global()),
            global: bun_ptr::BackRef::new(cx.global()),
            bucket: request.credentials.bucket.clone(),
        }))
    }

    /// # Safety
    /// `this` is the pointer `new` returned, reclaimed exactly once.
    unsafe fn take(this: *mut core::ffi::c_void) -> Box<Self> {
        // SAFETY: fn contract.
        unsafe { bun_core::heap::take(this.cast::<Self>()) }
    }

    fn reject(&mut self, err: &crate::webcore::s3::client::error_jsc::S3Error) -> JsResult<()> {
        let global_ref = self.global;
        let global = global_ref.get();
        let value = crate::webcore::s3::client::error_jsc::s3_error_to_js_with_async_stack(
            err,
            global,
            Some(&self.bucket),
            self.promise.get(),
        );
        self.promise.reject(global, Ok(value))
    }

    fn on_exists(
        result: crate::webcore::s3::client::S3StatResult,
        this: *mut core::ffi::c_void,
    ) -> JsResult<()> {
        // SAFETY: `this` comes from `BucketTask::new` in `exists`.
        let mut this = unsafe { Self::take(this) };
        let global_ref = this.global;
        let global = global_ref.get();
        match result {
            crate::webcore::s3::client::S3StatResult::NotFound(_) => {
                this.promise.resolve(global, JSValue::FALSE)
            }
            crate::webcore::s3::client::S3StatResult::Success(_) => {
                this.promise.resolve(global, JSValue::TRUE)
            }
            crate::webcore::s3::client::S3StatResult::Failure(err) => this.reject(&err),
        }
    }

    fn on_created(
        result: crate::webcore::s3::client::S3UploadResult,
        this: *mut core::ffi::c_void,
    ) -> JsResult<()> {
        // SAFETY: `this` comes from `BucketTask::new` in `create`.
        let mut this = unsafe { Self::take(this) };
        let global_ref = this.global;
        let global = global_ref.get();
        match result {
            crate::webcore::s3::client::S3UploadResult::Success => {
                this.promise.resolve(global, JSValue::UNDEFINED)
            }
            crate::webcore::s3::client::S3UploadResult::Failure(err) => this.reject(&err),
        }
    }

    fn on_deleted(
        result: crate::webcore::s3::client::S3DeleteResult,
        this: *mut core::ffi::c_void,
    ) -> JsResult<()> {
        // SAFETY: `this` comes from `BucketTask::new` in `delete`.
        let mut this = unsafe { Self::take(this) };
        let global_ref = this.global;
        let global = global_ref.get();
        match result {
            crate::webcore::s3::client::S3DeleteResult::Success => {
                this.promise.resolve(global, JSValue::UNDEFINED)
            }
            crate::webcore::s3::client::S3DeleteResult::NotFound(err)
            | crate::webcore::s3::client::S3DeleteResult::Failure(err) => this.reject(&err),
        }
    }

    fn exists(cx: &bun_jsc::JsThread<'_>, request: &BucketRequest) -> JsResult<JSValue> {
        let this = Self::new(cx, request);
        // SAFETY: `this` is a freshly leaked Box; sole pointer until handed to
        // the callback below.
        let promise = unsafe { (*this).promise.value() };
        crate::webcore::s3::client::head_bucket(
            &request.credentials,
            cx.context(),
            request.request_payer,
            Self::on_exists,
            this.cast::<core::ffi::c_void>(),
        )?;
        Ok(promise)
    }

    fn create(cx: &bun_jsc::JsThread<'_>, request: &BucketRequest) -> JsResult<JSValue> {
        let this = Self::new(cx, request);
        // SAFETY: as in `exists`.
        let promise = unsafe { (*this).promise.value() };
        crate::webcore::s3::client::create_bucket(
            &request.credentials,
            cx.context(),
            request.acl,
            request.object_lock_enabled,
            request.request_payer,
            Self::on_created,
            this.cast::<core::ffi::c_void>(),
        )?;
        Ok(promise)
    }

    fn delete(cx: &bun_jsc::JsThread<'_>, request: &BucketRequest) -> JsResult<JSValue> {
        let this = Self::new(cx, request);
        // SAFETY: as in `exists`.
        let promise = unsafe { (*this).promise.value() };
        crate::webcore::s3::client::delete_bucket(
            &request.credentials,
            cx.context(),
            request.request_payer,
            Self::on_deleted,
            this.cast::<core::ffi::c_void>(),
        )?;
        Ok(promise)
    }
}

// `FormatTag` / `JSType` are the ConsoleObject formatter enums
// (`.Double`, `.NumberObject`), re-exported at the `bun_jsc` crate root.
use bun_jsc::{FormatTag, JSType};
