use bstr::BStr;

use crate::node::PathLike;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::BlobExt as _;
use crate::webcore::blob::store::S3Ext as _;
use crate::webcore::s3::MultiPartUploadOptions;
use crate::webcore::s3::client::{ACL, S3Credentials, StorageClass};
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{ConsoleFormatter, ErrorCode, JSGlobalObject, JSValue, JsResult};

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

/// `presign`/`exists`/`size`/`stat` report `undefined` as `MISSING_ARGS` and any other non-path as invalid; `unlink` reports both as `MISSING_ARGS`.
#[derive(Clone, Copy)]
enum MissingPathError {
    MissingOrInvalid,
    AlwaysMissingArgs,
}

#[inline]
fn opt_js(v: JSValue) -> Option<JSValue> {
    if v.is_undefined_or_null() {
        None
    } else {
        Some(v)
    }
}

fn path_from_js(global: &JSGlobalObject, path: JSValue) -> JsResult<Option<PathLike<'static>>> {
    let vm = global.bun_vm();
    let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, core::slice::from_ref(&path));
    PathLike::from_js(global, &mut args)
}

/// `presign(path, undefined)` signs with the `acl` and `storageClass` of the store, `presign(path)` without.
fn presign_args(args: &[JsLocal<'_>]) -> (JSValue, Option<JSValue>) {
    (
        args.first().map_or(JSValue::UNDEFINED, |path| path.to_js()),
        args.get(1).map(|options| options.to_js()),
    )
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

pub(crate) struct S3Client {
    pub(crate) credentials: bun_ptr::RefPtr<S3Credentials>,
    pub(crate) options: MultiPartUploadOptions,
    pub(crate) acl: Option<ACL>,
    pub(crate) storage_class: Option<StorageClass>,
    pub(crate) request_payer: bool,
}

impl S3Client {
    pub(crate) fn constructor(cx: &mut JsScope<'_>, options: JsLocal<'_>) -> JsResult<Self> {
        let global = cx.global();
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
            Some(options.to_js()),
            None,
            None,
            false,
            global,
        )?;
        Ok(S3Client {
            credentials: aws_options.credentials.dupe(),
            options: aws_options.options,
            acl: aws_options.acl,
            storage_class: aws_options.storage_class,
            request_payer: aws_options.request_payer,
        })
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

    /// `verb` completes the "Expected a path to {verb}" error message.
    fn blob_for_path(
        &self,
        global: &JSGlobalObject,
        path: JSValue,
        options: Option<JSValue>,
        verb: &str,
        missing_path: MissingPathError,
    ) -> JsResult<crate::webcore::blob::Blob> {
        let Some(path) = path_from_js(global, path)? else {
            return Err(match missing_path {
                MissingPathError::MissingOrInvalid if !path.is_undefined() => {
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
        self.construct_blob(global, path, options)
    }

    pub(crate) fn file(
        &self,
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let path: PathLike = match path_from_js(global, path.to_js())? {
            Some(p) => p,
            None => {
                if path.to_js().is_undefined() {
                    return Err(global
                        .err(ErrorCode::MISSING_ARGS, format_args!("Expected a path "))
                        .throw());
                }
                return Err(global.throw_invalid_arguments(format_args!("Expected a path")));
            }
        };
        let options = opt_js(options.to_js());
        // `Blob::new` heap-promotes and marks `ref_count = 1` so
        // the JSS3File wrapper's `finalize` knows to free the blob.
        let blob = crate::webcore::blob::Blob::new(self.construct_blob(global, path, options)?);
        // `to_js` runs `calculate_estimated_byte_size()`
        // before wrapping the heap Blob in a JSS3File so JSC sees the correct
        // GC pressure. Route through `BlobExt::to_js` (the `&self` impl, which
        // hands the heap pointer to the wrapper), same as `S3File::construct_internal_js`.
        // SAFETY: `blob` is a freshly leaked `*mut Blob` from `Blob::new`;
        // `to_js` hands ownership of that pointer to the C++ wrapper.
        Ok(unsafe { &mut *blob }.to_js(global))
    }

    pub(crate) fn presign(&self, cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let global = cx.global();
        let (path, options) = presign_args(args);
        let blob = self.blob_for_path(
            global,
            path,
            options,
            "presign",
            MissingPathError::MissingOrInvalid,
        )?;
        S3File::get_presign_url_from(&blob, global, options)
    }

    pub(crate) fn exists(
        &self,
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let blob = self.blob_for_path(
            cx.global(),
            path.to_js(),
            opt_js(options.to_js()),
            "check if it exists",
            MissingPathError::MissingOrInvalid,
        )?;
        S3File::S3BlobStatTask::exists(&cx, &blob)
    }

    pub(crate) fn size(
        &self,
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let mut blob = self.blob_for_path(
            cx.global(),
            path.to_js(),
            opt_js(options.to_js()),
            "check the size of",
            MissingPathError::MissingOrInvalid,
        )?;
        S3File::S3BlobStatTask::size(&cx, &mut blob)
    }

    pub(crate) fn stat(
        &self,
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let blob = self.blob_for_path(
            cx.global(),
            path.to_js(),
            opt_js(options.to_js()),
            "check the stat of",
            MissingPathError::MissingOrInvalid,
        )?;
        S3File::S3BlobStatTask::stat(&cx, &blob)
    }

    pub(crate) fn write(
        &self,
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        data: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let path: PathLike = match path_from_js(global, path.to_js())? {
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
        let data = data.to_js();
        if data.is_undefined() {
            return Err(global
                .err(
                    ErrorCode::MISSING_ARGS,
                    format_args!("Expected a Blob-y thing to write"),
                )
                .throw());
        }

        let options = opt_js(options.to_js());
        let blob = self.construct_blob(global, path, options)?;
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

    pub(crate) fn list(
        &self,
        cx: &mut JsScope<'_>,
        input: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let options = opt_js(options.to_js());

        let blob = S3File::construct_s3_file_with_s3_credentials_and_options(
            cx.global(),
            PathLike::default(),
            options,
            &self.credentials,
            self.options,
            None,
            None,
            self.request_payer,
        )?;

        let store = blob.store.get().as_ref().unwrap().clone();
        store
            .data
            .as_s3()
            .list_objects(store.clone(), &cx, input.to_js(), options)
    }

    pub(crate) fn unlink(
        &self,
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let options = opt_js(options.to_js());
        let blob = self.blob_for_path(
            cx.global(),
            path.to_js(),
            options,
            "unlink",
            MissingPathError::AlwaysMissingArgs,
        )?;
        let store = blob.store.get().as_ref().unwrap().clone();
        store.data.as_s3().unlink(store.clone(), &cx, options)
    }

    // ── Static methods ────────────────────────────────────────────────────

    pub(crate) fn static_write(
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        data: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let error_message = "Expected a S3 or path to upload";
        let path_or_blob = S3File::parse_s3_path_or_blob(global, path.to_js(), error_message)?;

        let data = data.to_js();
        if data.is_undefined() {
            return Err(global
                .err(
                    ErrorCode::MISSING_ARGS,
                    format_args!("Expected a Blob-y thing to upload"),
                )
                .throw());
        }

        let options = opt_js(options.to_js());
        let blob = S3File::resolve_s3_blob(global, options, path_or_blob, error_message)?;
        let mut blob_internal = crate::webcore::node_types::PathOrBlob::Blob(blob);
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

    pub(crate) fn static_presign(cx: &mut JsScope<'_>, args: &[JsLocal<'_>]) -> JsResult<JSValue> {
        let global = cx.global();
        let (path, options) = presign_args(args);
        let blob =
            S3File::s3_blob_from_js(global, path, options, "Expected a S3 or path to presign")?;
        S3File::get_presign_url_from(&blob, global, options)
    }

    pub(crate) fn static_exists(
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let blob = S3File::s3_blob_from_js(
            cx.global(),
            path.to_js(),
            opt_js(options.to_js()),
            "Expected a S3 or path to check if it exists",
        )?;
        S3File::S3BlobStatTask::exists(&cx, &blob)
    }

    pub(crate) fn static_size(
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let error_message = "Expected a S3 or path to get size";
        let mut blob = match S3File::parse_s3_path_or_blob(global, path.to_js(), error_message)? {
            crate::webcore::node_types::PathOrBlob::Blob(blob) => {
                return Ok(JSValue::js_number(blob.get_size()));
            }
            path => S3File::resolve_s3_blob(global, opt_js(options.to_js()), path, error_message)?,
        };
        S3File::S3BlobStatTask::size(&cx, &mut blob)
    }

    pub(crate) fn static_unlink(
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let options = opt_js(options.to_js());
        let blob = S3File::s3_blob_from_js(
            cx.global(),
            path.to_js(),
            options,
            "Expected a S3 or path to delete",
        )?;
        let store = blob.store.get().as_ref().unwrap().clone();
        store.data.as_s3().unlink(store.clone(), &cx, options)
    }

    pub(crate) fn static_file(
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let global = cx.global();
        let Some(path) = path_from_js(global, path.to_js())? else {
            return Err(global.throw_invalid_arguments(format_args!("Expected file path string")));
        };

        S3File::construct_internal_js(global, path, opt_js(options.to_js()))
    }

    pub(crate) fn static_stat(
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let blob = S3File::s3_blob_from_js(
            cx.global(),
            path.to_js(),
            opt_js(options.to_js()),
            "Expected a S3 or path to get size",
        )?;
        S3File::S3BlobStatTask::stat(&cx, &blob)
    }

    pub(crate) fn static_list(
        cx: &mut JsScope<'_>,
        input: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let options = opt_js(options.to_js());

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

        let store = blob.store.get().as_ref().unwrap().clone();
        store
            .data
            .as_s3()
            .list_objects(store.clone(), &cx, input.to_js(), options)
    }
}

// `FormatTag` / `JSType` are the ConsoleObject formatter enums
// (`.Double`, `.NumberObject`), re-exported at the `bun_jsc` crate root.
use bun_jsc::{FormatTag, JSType};
