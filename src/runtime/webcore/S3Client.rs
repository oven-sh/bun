use bstr::BStr;

use crate::node::PathLike;
use crate::node::types::PathLikeExt as _;
use crate::webcore::blob::BlobExt as _;
use crate::webcore::blob::store::S3Ext as _;
use crate::webcore::s3::MultiPartUploadOptions;
use crate::webcore::s3::client::{ACL, S3Credentials, StorageClass};
use bun_core::output;
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
// an extension trait so call sites keep their Zig shape
// (`S3Credentials.guessRegion(...)` / `.getCredentialsWithOptions(...)`).
pub trait S3CredentialsExt {
    fn guess_region(endpoint: &[u8]) -> &[u8];
    fn guess_bucket(endpoint: &[u8]) -> Option<&[u8]>;
    #[allow(clippy::too_many_arguments)]
    fn get_credentials_with_options(
        // PORT NOTE: takes `&S3Credentials` (not by-value) — `bun_s3_signing::S3Credentials`
        // has a private `ref_count` field and no `Clone`, so callers holding a borrow
        // (e.g. `&IntrusiveRc<S3Credentials>` deref) cannot produce an owned copy. The
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

#[inline]
fn opt_js(v: JSValue) -> Option<JSValue> {
    if v.is_empty_or_undefined_or_null() {
        None
    } else {
        Some(v)
    }
}

pub fn write_format_credentials<F, W, const ENABLE_ANSI_COLORS: bool>(
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
        // Zig: `formatter.indent += 1; defer formatter.indent -|= 1;`.
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
        write!(
            writer,
            "{}",
            output::pretty_fmt_args("<r><b>{}<r>\"", ENABLE_ANSI_COLORS, (BStr::new(endpoint),))
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
        write!(
            writer,
            "{}",
            output::pretty_fmt_args("<r><b>{}<r>\"", ENABLE_ANSI_COLORS, (BStr::new(region),))
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
            writer.write_str(pfmt!("<r>acl<d>:<r> ", ENABLE_ANSI_COLORS))?;
            write!(
                writer,
                "{}",
                output::pretty_fmt_args(
                    "<r><b>{}<r>\"",
                    ENABLE_ANSI_COLORS,
                    (BStr::new(acl_value.to_string()),),
                )
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
pub struct S3Client {
    pub credentials: bun_ptr::IntrusiveRc<S3Credentials>,
    pub options: MultiPartUploadOptions,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    pub request_payer: bool,
}

impl Drop for S3Client {
    fn drop(&mut self) {
        // `IntrusiveRc<T>` is `bun_ptr::RefPtr<T>`, which has no `Drop` impl
        // of its own (only `ScopedRef<T>` does), so the +1 taken by
        // `aws_options.credentials.dupe()` in `constructor` must be released
        // explicitly. Mirrors Zig `S3Client.deinit`: `this.credentials.deref()`.
        self.credentials.deref();
    }
}

impl S3Client {
    // PORT NOTE: no `#[bun_jsc::host_fn]` here — the `#[bun_jsc::JsClass]`
    // derive on the struct emits `S3ClientClass__construct` which calls
    // `<S3Client>::constructor` directly.
    pub fn constructor(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<Box<Self>> {
        let arguments = callframe.arguments_old::<1>();
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());
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

    pub fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
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
            write!(
                writer,
                "{}",
                output::pretty_fmt_args(
                    " (<green>\"{}\"<r>)<r> {{",
                    ENABLE_ANSI_COLORS,
                    (BStr::new(bucket_name),),
                )
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

    #[bun_jsc::host_fn(method)]
    pub fn file(ptr: &Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());
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
        // Zig: `Blob.new(try ...)` — heap-promote and mark `ref_count = 1` so
        // the JSS3File wrapper's `finalize` knows to `bun.destroy(blob)`.
        let blob = crate::webcore::blob::Blob::new(
            S3File::construct_s3_file_with_s3_credentials_and_options(
                global,
                path,
                options,
                &ptr.credentials,
                ptr.options,
                ptr.acl,
                ptr.storage_class,
                ptr.request_payer,
            )?,
        );
        // Zig: `blob.toJS(globalThis)` — runs `calculateEstimatedByteSize()`
        // before wrapping the heap Blob in a JSS3File so JSC sees the correct
        // GC pressure. Route through `BlobExt::to_js` (the `&mut self` method
        // that owns the heap pointer), same as `S3File::construct_internal_js`.
        // SAFETY: `blob` is a freshly leaked `*mut Blob` from `Blob::new`;
        // `to_js` hands ownership of that pointer to the C++ wrapper.
        Ok(unsafe { &mut *blob }.to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn presign(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return Err(global
                        .err(
                            ErrorCode::MISSING_ARGS,
                            format_args!("Expected a path to presign"),
                        )
                        .throw());
                }
                return Err(
                    global.throw_invalid_arguments(format_args!("Expected a path to presign"))
                );
            }
        };

        let options = args.next_eat();
        // `defer blob.detach()` — `Blob`'s `store: Option<StoreRef>` field
        // drops at scope exit, which calls `Store::deref()` (same as detach).
        let mut blob = S3File::construct_s3_file_with_s3_credentials_and_options(
            global,
            path,
            options,
            &ptr.credentials,
            ptr.options,
            ptr.acl,
            ptr.storage_class,
            ptr.request_payer,
        )?;
        S3File::get_presign_url_from(&mut blob, global, options)
    }

    #[bun_jsc::host_fn(method)]
    pub fn exists(ptr: &Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return Err(global
                        .err(
                            ErrorCode::MISSING_ARGS,
                            format_args!("Expected a path to check if it exists"),
                        )
                        .throw());
                }
                return Err(global.throw_invalid_arguments(format_args!(
                    "Expected a path to check if it exists"
                )));
            }
        };
        let options = args.next_eat();
        // `defer blob.detach()` — handled by Drop of `Option<StoreRef>` field.
        let mut blob = S3File::construct_s3_file_with_s3_credentials_and_options(
            global,
            path,
            options,
            &ptr.credentials,
            ptr.options,
            ptr.acl,
            ptr.storage_class,
            ptr.request_payer,
        )?;
        S3File::S3BlobStatTask::exists(global, &mut blob)
    }

    #[bun_jsc::host_fn(method)]
    pub fn size(ptr: &Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return Err(global
                        .err(
                            ErrorCode::MISSING_ARGS,
                            format_args!("Expected a path to check the size of"),
                        )
                        .throw());
                }
                return Err(global.throw_invalid_arguments(format_args!(
                    "Expected a path to check the size of"
                )));
            }
        };
        let options = args.next_eat();
        // `defer blob.detach()` — handled by Drop of `Option<StoreRef>` field.
        let mut blob = S3File::construct_s3_file_with_s3_credentials_and_options(
            global,
            path,
            options,
            &ptr.credentials,
            ptr.options,
            ptr.acl,
            ptr.storage_class,
            ptr.request_payer,
        )?;
        S3File::S3BlobStatTask::size(global, &mut blob)
    }

    #[bun_jsc::host_fn(method)]
    pub fn stat(ptr: &Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return Err(global
                        .err(
                            ErrorCode::MISSING_ARGS,
                            format_args!("Expected a path to check the stat of"),
                        )
                        .throw());
                }
                return Err(global.throw_invalid_arguments(format_args!(
                    "Expected a path to check the stat of"
                )));
            }
        };
        let options = args.next_eat();
        // `defer blob.detach()` — handled by Drop of `Option<StoreRef>` field.
        let mut blob = S3File::construct_s3_file_with_s3_credentials_and_options(
            global,
            path,
            options,
            &ptr.credentials,
            ptr.options,
            ptr.acl,
            ptr.storage_class,
            ptr.request_payer,
        )?;
        S3File::S3BlobStatTask::stat(global, &mut blob)
    }

    #[bun_jsc::host_fn(method)]
    pub fn write(ptr: &Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<3>();
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());
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
        let blob = S3File::construct_s3_file_with_s3_credentials_and_options(
            global,
            path,
            options,
            &ptr.credentials,
            ptr.options,
            ptr.acl,
            ptr.storage_class,
            ptr.request_payer,
        )?;
        // PORT NOTE: reshaped for borrowck — Zig copied `blob` into `blob_internal`
        // by value while `defer blob.detach()` was still armed on the original.
        // Here we move into `PathOrBlob` directly; cleanup of the moved-out
        // value is handled by `Drop`.
        let mut blob_internal = crate::webcore::node_types::PathOrBlob::Blob(blob);
        crate::webcore::blob::write_file_internal(
            global,
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
    pub fn list_objects(
        ptr: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();

        let object_keys = args[0];
        let options = opt_js(args[1]);

        // `defer blob.detach()` — handled by Drop of `Option<StoreRef>` field.
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

        // Zig: `blob.store.?.data.s3.listObjects(blob.store.?, globalThis, object_keys, options)`.
        let store = blob.store.get().as_ref().unwrap();
        store
            .data
            .as_s3()
            .list_objects(store, global, object_keys, options)
    }

    #[bun_jsc::host_fn(method)]
    pub fn unlink(ptr: &Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                return Err(global
                    .err(
                        ErrorCode::MISSING_ARGS,
                        format_args!("Expected a path to unlink"),
                    )
                    .throw());
            }
        };
        let options = args.next_eat();
        // `defer blob.detach()` — handled by Drop of `Option<StoreRef>` field.
        let blob = S3File::construct_s3_file_with_s3_credentials_and_options(
            global,
            path,
            options,
            &ptr.credentials,
            ptr.options,
            ptr.acl,
            ptr.storage_class,
            ptr.request_payer,
        )?;
        // Zig: `blob.store.?.data.s3.unlink(blob.store.?, globalThis, options)`.
        let store = blob.store.get().as_ref().unwrap();
        store.data.as_s3().unlink(store, global, options)
    }

    // ── Static methods ────────────────────────────────────────────────────
    // Codegen (`generated_classes.rs`) emits `S3ClientClass__static*` extern
    // wrappers that call these as `S3Client::static_*(global, callframe)`,
    // so they must be associated fns (no `#[bun_jsc::host_fn]` needed — the
    // codegen layer already handles the `host_fn_result` wrapping).

    pub fn static_write(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::write(global, callframe)
    }

    pub fn static_presign(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::presign(global, callframe)
    }

    pub fn static_exists(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::exists(global, callframe)
    }

    pub fn static_size(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::size(global, callframe)
    }

    pub fn static_unlink(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::unlink(global, callframe)
    }

    pub fn static_file(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<2>();
        // SAFETY: `bun_vm()` returns the live VM pointer for `global`.
        let vm = global.bun_vm();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(vm, arguments.slice());

        let Some(path) = PathLike::from_js(global, &mut args)? else {
            return Err(global.throw_invalid_arguments(format_args!("Expected file path string")));
        };

        S3File::construct_internal_js(global, path, args.next_eat())
    }

    pub fn static_stat(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::stat(global, callframe)
    }

    pub fn static_list_objects(
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

        // `defer blob.detach()` — handled by Drop of `Option<StoreRef>` field.
        let blob = S3File::construct_s3_file_with_s3_credentials(
            global,
            PathLike::default(),
            options,
            existing_credentials,
        )?;

        // Zig: `blob.store.?.data.s3.listObjects(blob.store.?, globalThis, object_keys, options)`.
        let store = blob.store.get().as_ref().unwrap();
        store
            .data
            .as_s3()
            .list_objects(store, global, object_keys, options)
    }
}

// `FormatTag` / `JSType` are the ConsoleObject formatter enums
// (`.Double`, `.NumberObject`), re-exported at the `bun_jsc` crate root.
use bun_jsc::{FormatTag, JSType};

// ported from: src/runtime/webcore/S3Client.zig
