use std::sync::Arc;

use bstr::BStr;

use bun_core::output;
use bun_jsc::{CallFrame, JSGlobalObject, JSValue, JsResult};
use bun_jsc::node::{PathLike, PathOrBlob};
use bun_runtime::webcore::Blob;
use bun_runtime::s3::{self as S3, MultiPartUploadOptions, ACL, StorageClass, S3Credentials};
use bun_str::PathString;

use super::s3_file as S3File;

bun_core::declare_scope!(S3Client, visible);

// TODO(port): `bun.Output.prettyFmt` is a comptime color-tag expander; needs a
// const-fn/macro equivalent (`output::pretty_fmt!`) that yields `&'static str`
// keyed on `ENABLE_ANSI_COLORS`.
pub fn write_format_credentials<F, W, const ENABLE_ANSI_COLORS: bool>(
    credentials: &S3Credentials,
    options: MultiPartUploadOptions,
    acl: Option<ACL>,
    formatter: &mut F,
    writer: &mut W,
) -> Result<(), bun_core::Error>
where
    // TODO(port): bound `F` on the ConsoleObject formatter trait once it exists
    W: core::fmt::Write,
{
    // TODO(port): narrow error set
    writer.write_str("\n")?;

    {
        formatter.indent += 1;
        let _indent_guard = scopeguard::guard(&mut *formatter, |f| {
            f.indent = f.indent.saturating_sub(1);
        });
        // PORT NOTE: reshaped for borrowck — Zig used `defer formatter.indent -|= 1;`.
        // We need `formatter` mutably borrowed below, so re-borrow through the guard.
        let formatter = &mut **_indent_guard;

        let endpoint: &[u8] = if !credentials.endpoint.is_empty() {
            &credentials.endpoint
        } else if credentials.virtual_hosted_style {
            b"https://<bucket>.s3.<region>.amazonaws.com"
        } else {
            b"https://s3.<region>.amazonaws.com"
        };

        formatter.write_indent(writer)?;
        writer.write_str(output::pretty_fmt!("<r>endpoint<d>:<r> \"", ENABLE_ANSI_COLORS))?;
        write!(
            writer,
            "{}",
            // TODO(port): pretty_fmt with runtime arg — Zig: prettyFmt("<r><b>{s}<r>\"", ..)
            output::pretty_fmt_args!::<ENABLE_ANSI_COLORS>("<r><b>{}<r>\"", BStr::new(endpoint))
        )?;
        formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;
        writer.write_str("\n")?;

        let region: &[u8] = if !credentials.region.is_empty() {
            &credentials.region
        } else {
            S3Credentials::guess_region(&credentials.endpoint)
        };
        formatter.write_indent(writer)?;
        writer.write_str(output::pretty_fmt!("<r>region<d>:<r> \"", ENABLE_ANSI_COLORS))?;
        write!(
            writer,
            "{}",
            output::pretty_fmt_args!::<ENABLE_ANSI_COLORS>("<r><b>{}<r>\"", BStr::new(region))
        )?;
        formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;
        writer.write_str("\n")?;

        // PS: We don't want to print the credentials if they are empty just signal that they are there without revealing them
        if !credentials.access_key_id.is_empty() {
            formatter.write_indent(writer)?;
            writer.write_str(output::pretty_fmt!(
                "<r>accessKeyId<d>:<r> \"<r><b>[REDACTED]<r>\"",
                ENABLE_ANSI_COLORS
            ))?;
            formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;

            writer.write_str("\n")?;
        }

        if !credentials.secret_access_key.is_empty() {
            formatter.write_indent(writer)?;
            writer.write_str(output::pretty_fmt!(
                "<r>secretAccessKey<d>:<r> \"<r><b>[REDACTED]<r>\"",
                ENABLE_ANSI_COLORS
            ))?;
            formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;

            writer.write_str("\n")?;
        }

        if !credentials.session_token.is_empty() {
            formatter.write_indent(writer)?;
            writer.write_str(output::pretty_fmt!(
                "<r>sessionToken<d>:<r> \"<r><b>[REDACTED]<r>\"",
                ENABLE_ANSI_COLORS
            ))?;
            formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;

            writer.write_str("\n")?;
        }

        if let Some(acl_value) = acl {
            formatter.write_indent(writer)?;
            writer.write_str(output::pretty_fmt!("<r>acl<d>:<r> ", ENABLE_ANSI_COLORS))?;
            write!(
                writer,
                "{}",
                output::pretty_fmt_args!::<ENABLE_ANSI_COLORS>(
                    "<r><b>{}<r>\"",
                    BStr::new(acl_value.to_string())
                )
            )?;
            formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;

            writer.write_str("\n")?;
        }

        formatter.write_indent(writer)?;
        writer.write_str(output::pretty_fmt!("<r>partSize<d>:<r> ", ENABLE_ANSI_COLORS))?;
        formatter.print_as(
            FormatTag::Double,
            writer,
            JSValue::js_number(options.part_size),
            JSType::NumberObject,
            ENABLE_ANSI_COLORS,
        )?;
        formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;

        writer.write_str("\n")?;

        formatter.write_indent(writer)?;
        writer.write_str(output::pretty_fmt!("<r>queueSize<d>:<r> ", ENABLE_ANSI_COLORS))?;
        formatter.print_as(
            FormatTag::Double,
            writer,
            JSValue::js_number(options.queue_size),
            JSType::NumberObject,
            ENABLE_ANSI_COLORS,
        )?;
        formatter.print_comma(writer, ENABLE_ANSI_COLORS)?;
        writer.write_str("\n")?;

        formatter.write_indent(writer)?;
        writer.write_str(output::pretty_fmt!("<r>retry<d>:<r> ", ENABLE_ANSI_COLORS))?;
        formatter.print_as(
            FormatTag::Double,
            writer,
            JSValue::js_number(options.retry),
            JSType::NumberObject,
            ENABLE_ANSI_COLORS,
        )?;
        writer.write_str("\n")?;
    }

    Ok(())
}

#[bun_jsc::JsClass]
pub struct S3Client {
    pub credentials: Arc<S3Credentials>,
    pub options: MultiPartUploadOptions,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    pub request_payer: bool,
}

impl S3Client {
    #[bun_jsc::host_fn]
    pub fn constructor(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<Box<Self>> {
        let arguments = callframe.arguments_old(1).slice();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);
        let aws_options = S3Credentials::get_credentials_with_options(
            global.bun_vm().transpiler.env.get_s3_credentials(),
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
    ) -> Result<(), bun_core::Error>
    where
        W: core::fmt::Write,
    {
        writer.write_str(output::pretty_fmt!("<r>S3Client<r>", ENABLE_ANSI_COLORS))?;
        // detect virtual host style bucket name
        let bucket_name: &[u8] =
            if self.credentials.virtual_hosted_style && !self.credentials.endpoint.is_empty() {
                S3Credentials::guess_bucket(&self.credentials.endpoint)
                    .unwrap_or(&self.credentials.bucket)
            } else {
                &self.credentials.bucket
            };
        if !bucket_name.is_empty() {
            write!(
                writer,
                "{}",
                output::pretty_fmt_args!::<ENABLE_ANSI_COLORS>(
                    " (<green>\"{}\"<r>)<r> {{",
                    BStr::new(bucket_name)
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
    pub fn file(ptr: &mut Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return global
                        .ERR(bun_jsc::ErrorCode::MISSING_ARGS, format_args!("Expected a path "))
                        .throw();
                }
                return global.throw_invalid_arguments(format_args!("Expected a path"));
            }
        };
        let options = args.next_eat();
        let blob = Box::new(S3File::construct_s3_file_with_s3_credentials_and_options(
            global,
            path,
            options,
            &ptr.credentials,
            ptr.options,
            ptr.acl,
            ptr.storage_class,
            ptr.request_payer,
        )?);
        Ok(blob.to_js(global))
    }

    #[bun_jsc::host_fn(method)]
    pub fn presign(ptr: &mut Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return global
                        .ERR(
                            bun_jsc::ErrorCode::MISSING_ARGS,
                            format_args!("Expected a path to presign"),
                        )
                        .throw();
                }
                return global.throw_invalid_arguments(format_args!("Expected a path to presign"));
            }
        };

        let options = args.next_eat();
        let mut blob = scopeguard::guard(
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
            |mut b| b.detach(),
        );
        S3File::get_presign_url_from(&mut *blob, global, options)
    }

    #[bun_jsc::host_fn(method)]
    pub fn exists(ptr: &mut Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return global
                        .ERR(
                            bun_jsc::ErrorCode::MISSING_ARGS,
                            format_args!("Expected a path to check if it exists"),
                        )
                        .throw();
                }
                return global
                    .throw_invalid_arguments(format_args!("Expected a path to check if it exists"));
            }
        };
        let options = args.next_eat();
        let mut blob = scopeguard::guard(
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
            |mut b| b.detach(),
        );
        S3File::S3BlobStatTask::exists(global, &mut *blob)
    }

    #[bun_jsc::host_fn(method)]
    pub fn size(ptr: &mut Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return global
                        .ERR(
                            bun_jsc::ErrorCode::MISSING_ARGS,
                            format_args!("Expected a path to check the size of"),
                        )
                        .throw();
                }
                return global
                    .throw_invalid_arguments(format_args!("Expected a path to check the size of"));
            }
        };
        let options = args.next_eat();
        let mut blob = scopeguard::guard(
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
            |mut b| b.detach(),
        );
        S3File::S3BlobStatTask::size(global, &mut *blob)
    }

    #[bun_jsc::host_fn(method)]
    pub fn stat(ptr: &mut Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                if args.len() == 0 {
                    return global
                        .ERR(
                            bun_jsc::ErrorCode::MISSING_ARGS,
                            format_args!("Expected a path to check the stat of"),
                        )
                        .throw();
                }
                return global
                    .throw_invalid_arguments(format_args!("Expected a path to check the stat of"));
            }
        };
        let options = args.next_eat();
        let mut blob = scopeguard::guard(
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
            |mut b| b.detach(),
        );
        S3File::S3BlobStatTask::stat(global, &mut *blob)
    }

    #[bun_jsc::host_fn(method)]
    pub fn write(ptr: &mut Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(3).slice();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                return global
                    .ERR(
                        bun_jsc::ErrorCode::MISSING_ARGS,
                        format_args!("Expected a path to write to"),
                    )
                    .throw();
            }
        };
        let Some(data) = args.next_eat() else {
            return global
                .ERR(
                    bun_jsc::ErrorCode::MISSING_ARGS,
                    format_args!("Expected a Blob-y thing to write"),
                )
                .throw();
        };

        let options = args.next_eat();
        let blob = scopeguard::guard(
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
            |mut b| b.detach(),
        );
        let mut blob_internal = PathOrBlob::Blob(scopeguard::ScopeGuard::into_inner(blob));
        // PORT NOTE: reshaped for borrowck — Zig copied `blob` into `blob_internal`
        // by value while `defer blob.detach()` was still armed on the original.
        // Here we move into `PathOrBlob` and detach via the guard below instead.
        let result = Blob::write_file_internal(
            global,
            &mut blob_internal,
            data,
            Blob::WriteFileOptions {
                mkdirp_if_not_exists: false,
                extra_options: options,
            },
        );
        if let PathOrBlob::Blob(mut b) = blob_internal {
            b.detach();
        }
        result
    }

    #[bun_jsc::host_fn(method)]
    pub fn list_objects(
        ptr: &mut Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();

        let object_keys = args[0];
        let options = args[1];

        let blob = scopeguard::guard(
            S3File::construct_s3_file_with_s3_credentials_and_options(
                global,
                PathLike::String(PathString::empty()),
                options,
                &ptr.credentials,
                ptr.options,
                None,
                None,
                ptr.request_payer,
            )?,
            |mut b| b.detach(),
        );

        // TODO(port): `blob.store.?.data.s3` is a Zig tagged-union field access;
        // map to the Rust enum accessor once `Blob::Store` is ported.
        let store = blob.store.as_ref().unwrap();
        store.data.s3().list_objects(store, global, object_keys, options)
    }

    #[bun_jsc::host_fn(method)]
    pub fn unlink(ptr: &mut Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);
        let path: PathLike = match PathLike::from_js(global, &mut args)? {
            Some(p) => p,
            None => {
                return global
                    .ERR(
                        bun_jsc::ErrorCode::MISSING_ARGS,
                        format_args!("Expected a path to unlink"),
                    )
                    .throw();
            }
        };
        let options = args.next_eat();
        let blob = scopeguard::guard(
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
            |mut b| b.detach(),
        );
        // TODO(port): `blob.store.?.data.s3` tagged-union access — see list_objects.
        let store = blob.store.as_ref().unwrap();
        store.data.s3().unlink(store, global, options)
    }

    /// Called by the generated JSCell wrapper's `finalize()`. Runs on the
    /// mutator thread during lazy sweep — do not touch JS values here.
    pub fn finalize(this: *mut Self) {
        // SAFETY: `this` was produced by `Box::into_raw` in the codegen'd
        // constructor path; we are the unique owner at finalize time.
        drop(unsafe { Box::from_raw(this) });
        // `Arc<S3Credentials>` deref happens via Drop — matches Zig `credentials.deref()`.
    }

    // Static methods

    #[bun_jsc::host_fn]
    pub fn static_write(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::write(global, callframe)
    }

    #[bun_jsc::host_fn]
    pub fn static_presign(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::presign(global, callframe)
    }

    #[bun_jsc::host_fn]
    pub fn static_exists(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::exists(global, callframe)
    }

    #[bun_jsc::host_fn]
    pub fn static_size(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::size(global, callframe)
    }

    #[bun_jsc::host_fn]
    pub fn static_unlink(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::unlink(global, callframe)
    }

    #[bun_jsc::host_fn]
    pub fn static_file(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(2).slice();
        let mut args = bun_jsc::call_frame::ArgumentsSlice::init(global.bun_vm(), arguments);

        let Some(path) = PathLike::from_js(global, &mut args)? else {
            return global.throw_invalid_arguments(format_args!("Expected file path string"));
        };

        S3File::construct_internal_js(global, path, args.next_eat())
    }

    #[bun_jsc::host_fn]
    pub fn static_stat(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        S3File::stat(global, callframe)
    }

    #[bun_jsc::host_fn]
    pub fn static_list_objects(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let args = callframe.arguments_as_array::<2>();
        let object_keys = args[0];
        let options = args[1];

        // get credentials from env
        let existing_credentials = global.bun_vm().transpiler.env.get_s3_credentials();

        let blob = scopeguard::guard(
            S3File::construct_s3_file_with_s3_credentials(
                global,
                PathLike::String(PathString::empty()),
                options,
                existing_credentials,
            )?,
            |mut b| b.detach(),
        );

        // TODO(port): `blob.store.?.data.s3` tagged-union access — see list_objects.
        let store = blob.store.as_ref().unwrap();
        store.data.s3().list_objects(store, global, object_keys, options)
    }
}

// TODO(port): `FormatTag` / `JSType` are the ConsoleObject formatter enums
// (`.Double`, `.NumberObject`). Import from the ported ConsoleObject module
// once available.
use bun_runtime::console_object::{FormatTag, JSType};

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/S3Client.zig (332 lines)
//   confidence: medium
//   todos:      6
//   notes:      pretty_fmt! macro + ConsoleObject formatter trait + Blob store union accessor need Phase-B wiring; `write()` defer-detach reshaped for ownership
// ──────────────────────────────────────────────────────────────────────────
