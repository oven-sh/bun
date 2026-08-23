//! `Blob.Store` — backing storage variants for `webcore::Blob`.
//!
//! LAYERING: the data types (`Store`/`RefPtr<Store>`/`Data`/`Bytes`/`File`/`S3`)
//! are the **single nominal definitions** in `bun_jsc::webcore_types::store`;
//! this module re-exports them and layers the `bun_runtime`-tier behaviour
//! (S3 I/O, async file ops, structured-clone serialize) via extension traits.

use crate::node::fs as node_fs;
use crate::node::types::PathOrFileDescriptorSerializeTag;
use crate::webcore::jsc::{JSGlobalObject, JSPromise, JSValue, JsResult};
use crate::webcore::node_types::{PathLike, PathOrFileDescriptor};
use crate::webcore::s3::client as s3_client;
use crate::webcore::s3::client::S3ErrorJsc as _;
use crate::webcore::s3::client::{
    S3Credentials, S3CredentialsWithOptions, S3DeleteResult, S3ListObjectsResult,
};
use bun_core::strings;
use bun_http_types::MimeType::MimeType;
use bun_ptr::RefPtr;
use bun_url::URL;

// ──────────────────────────────────────────────────────────────────────────
// Re-export the canonical data types from `bun_jsc`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_jsc::webcore_types::store::{
    Bytes, Data, DataTag, File, IsAllAscii, S3, SerializeTag, Store,
};

// ──────────────────────────────────────────────────────────────────────────
// Extension traits — `bun_runtime`-tier behaviour layered on the `bun_jsc`
// data types. Inherent data-only methods (`size`/`shared_view`/`ref_`/`deref`/
// `init`/…) live on the `bun_jsc` types directly.
// ──────────────────────────────────────────────────────────────────────────

pub trait StoreExt {
    fn to_any_blob(&mut self) -> Option<super::Any>;
    fn init_s3(
        pathlike: PathLike<'static>,
        mime_type: Option<MimeType>,
        credentials: S3Credentials,
    ) -> Result<RefPtr<Store>, crate::Error>
    where
        Self: Sized;
    fn init_file(
        pathlike: PathOrFileDescriptor<'static>,
        mime_type: Option<MimeType>,
    ) -> Result<RefPtr<Store>, crate::Error>
    where
        Self: Sized;
    fn serialize(&self, writer: &mut impl bun_io::Write) -> Result<(), crate::Error>;
}

pub trait S3Ext {
    fn get_credentials_with_options(
        &self,
        options: Option<JSValue>,
        global_object: &JSGlobalObject,
    ) -> JsResult<S3CredentialsWithOptions>;
    /// `store` is the heap `Store` that owns `self` (`self == &store.data.S3`);
    /// the request keeps its own ref on it.
    fn unlink(
        &self,
        store: &RefPtr<Store>,
        global_this: &JSGlobalObject,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue>;
    /// See `unlink`.
    fn list_objects(
        &self,
        store: &RefPtr<Store>,
        global_this: &JSGlobalObject,
        list_options: JSValue,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue>;
}

pub trait FileExt {
    fn unlink(&self, global_this: &JSGlobalObject) -> JsResult<JSValue>;
}

pub trait BytesExt {
    fn to_internal_blob(&mut self) -> super::Internal;
}

/// Shared mime-sniffing fallback for the `init_*` constructors below: derive a
/// `MimeType` from the path's extension, returning `None` for empty paths or
/// unknown extensions.
#[inline]
fn mime_from_path_ext(sliced: &[u8]) -> Option<MimeType> {
    if sliced.is_empty() {
        return None;
    }
    let ext = strings::trim(bun_paths::extension(sliced), b".");
    bun_http_types::MimeType::by_extension_no_default(ext)
}

impl StoreExt for Store {
    /// Caller is responsible for derefing the Store.
    fn to_any_blob(&mut self) -> Option<super::Any> {
        if self.has_one_ref() {
            if let Data::Bytes(bytes) = &mut self.data {
                return Some(super::Any::InternalBlob(bytes.to_internal_blob()));
            }
        }

        None
    }

    fn init_s3(
        pathlike: PathLike<'static>,
        mime_type: Option<MimeType>,
        credentials: S3Credentials,
    ) -> Result<RefPtr<Store>, crate::Error> {
        let path = pathlike.thread_isolated_copy();

        // Compute the extension-derived fallback before moving `path` into the
        // Store so we don't need to clone the owned PathLike.
        let mime_type = mime_type.or_else(|| mime_from_path_ext(path.slice()));

        Ok(RefPtr::new(Store {
            data: Data::S3(S3::init(path, mime_type, credentials)),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: IsAllAscii::default(),
        }))
    }

    fn init_file(
        pathlike: PathOrFileDescriptor<'static>,
        mime_type: Option<MimeType>,
    ) -> Result<RefPtr<Store>, crate::Error> {
        // Compute the extension-derived fallback before moving `pathlike` into
        // the Store so we don't need to clone the owned PathOrFileDescriptor.
        let mime_type = mime_type.or_else(|| match &pathlike {
            PathOrFileDescriptor::Path(path) => mime_from_path_ext(path.slice()),
            PathOrFileDescriptor::Fd(_) => None,
        });

        Ok(RefPtr::new(Store {
            data: Data::File(File::init(pathlike, mime_type)),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: IsAllAscii::default(),
        }))
    }

    fn serialize(&self, writer: &mut impl bun_io::Write) -> Result<(), crate::Error> {
        match &self.data {
            Data::File(file) => {
                let pathlike_tag: PathOrFileDescriptorSerializeTag =
                    if matches!(file.pathlike, PathOrFileDescriptor::Fd(_)) {
                        PathOrFileDescriptorSerializeTag::Fd
                    } else {
                        PathOrFileDescriptorSerializeTag::Path
                    };
                writer.write_int_le::<u8>(pathlike_tag as u8)?;

                match &file.pathlike {
                    PathOrFileDescriptor::Fd(fd) => {
                        // Write the raw bytes of the FD wrapper. `bun_sys::Fd` is
                        // `#[repr(transparent)]` over an integer (`i32` posix /
                        // `u64` windows), so its native-endian byte image is
                        // exactly the inner field's `to_ne_bytes()`.
                        writer.write_all(&fd.0.to_ne_bytes())?;
                    }
                    PathOrFileDescriptor::Path(path) => {
                        let path_slice = path.slice();
                        writer.write_int_le::<u32>(path_slice.len() as u32)?;
                        writer.write_all(path_slice)?;
                    }
                }
            }
            Data::S3(s3) => {
                let pathlike_tag = PathOrFileDescriptorSerializeTag::Path;
                writer.write_int_le::<u8>(pathlike_tag as u8)?;

                let path_slice = s3.pathlike.slice();
                writer.write_int_le::<u32>(path_slice.len() as u32)?;
                writer.write_all(path_slice)?;
            }
            Data::Bytes(bytes) => {
                let slice = bytes.slice();
                writer.write_int_le::<u32>(slice.len() as u32)?;
                writer.write_all(slice)?;

                writer.write_int_le::<u32>(bytes.stored_name.len() as u32)?;
                writer.write_all(&bytes.stored_name)?;
            }
        }
        Ok(())
    }
}

impl FileExt for File {
    fn unlink(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match &self.pathlike {
            PathOrFileDescriptor::Path(path_like) => {
                // The `*Binding` arg is unused in `AsyncFSTask::create`.
                let binding = node_fs::Binding::default();
                Ok(node_fs::async_::Unlink::create(
                    global_this,
                    &binding,
                    node_fs::args::Unlink::owned(path_like.slice().to_vec()),
                    global_this.bun_vm().as_mut(),
                ))
            }
            PathOrFileDescriptor::Fd(_) => Ok(JSPromise::resolved_promise_value(
                global_this,
                // `JSGlobalObject::create_invalid_args` lives in the still-gated
                // `JSGlobalObject.rs`; `ERR_INVALID_ARG_TYPE` (lib.rs) is the
                // same `ErrorCode::INVALID_ARG_TYPE.fmt(...)` body.
                global_this.ERR_INVALID_ARG_TYPE(format_args!(
                    "Is not possible to unlink a file descriptor"
                )),
            )),
        }
    }
}

impl S3Ext for S3 {
    fn get_credentials_with_options(
        &self,
        options: Option<JSValue>,
        global_object: &JSGlobalObject,
    ) -> JsResult<S3CredentialsWithOptions> {
        // The associated fn (surfaced via `S3CredentialsExt` in `webcore/S3Client.rs`)
        // takes `&S3Credentials` instead of by-value because `S3Credentials` carries a
        // private intrusive ref-count and cannot be struct-copied; the impl deep-copies
        // internally.
        use crate::webcore::s3_client::S3CredentialsExt as _;
        S3Credentials::get_credentials_with_options(
            self.get_credentials(),
            self.options,
            options,
            self.acl,
            self.storage_class,
            self.request_payer,
            global_object,
        )
    }

    fn unlink(
        &self,
        store: &RefPtr<Store>,
        global_this: &JSGlobalObject,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue> {
        let mut promise = bun_jsc::JSPromiseStrong::init(global_this);
        let value = promise.value();
        let global = bun_ptr::BackRef::new(global_this);
        let store = store.clone();
        let resolve = move |result: S3DeleteResult<'_>| -> JsResult<()> {
            let global_object = global.get();
            match result {
                S3DeleteResult::Success => {
                    promise.resolve(global_object, JSValue::TRUE)?;
                }
                S3DeleteResult::NotFound(err) | S3DeleteResult::Failure(err) => {
                    // Split borrows: `reject` takes `&mut promise`, so
                    // compute the error (which reads `promise.get()`) first.
                    let err_val =
                        err.to_js_with_async_stack(global_object, store.get_path(), promise.get());
                    promise.reject(global_object, err_val)?;
                }
            }
            Ok(())
        };

        // `Transpiler::env_mut` is the safe accessor for the process-singleton
        // dotenv loader (never null once the VM is initialised).
        let proxy_url: Option<URL<'_>> = global_this
            .bun_vm()
            .as_mut()
            .transpiler
            .env_mut()
            .get_http_proxy(true, None, None);
        let proxy = proxy_url.as_ref().map(|url| url.href);
        let aws_options = self.get_credentials_with_options(extra_options, global_this)?;
        // `defer aws_options.deinit()` → Drop handles it.

        s3_client::delete(
            &aws_options.credentials,
            self.path(),
            Box::new(resolve),
            proxy,
            aws_options.request_payer,
        )?;

        Ok(value)
    }

    fn list_objects(
        &self,
        store: &RefPtr<Store>,
        global_this: &JSGlobalObject,
        list_options: JSValue,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if !list_options.is_empty_or_undefined_or_null() && !list_options.is_object() {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "S3Client.listObjects() needs a S3ListObjectsOption as it's first argument"
            )));
        }

        let mut promise = bun_jsc::JSPromiseStrong::init(global_this);
        let value = promise.value();
        let global = bun_ptr::BackRef::new(global_this);
        let store = store.clone();
        let resolve = move |result: S3ListObjectsResult<'_>| -> JsResult<()> {
            let global_object = global.get();
            match result {
                S3ListObjectsResult::Success(list_result) => {
                    let list_result_js = match list_result.to_js(global_object) {
                        Ok(v) => v,
                        Err(e) => {
                            return promise.reject(global_object, Err(e));
                        }
                    };
                    promise.resolve(global_object, list_result_js)?;
                }

                S3ListObjectsResult::NotFound(err) | S3ListObjectsResult::Failure(err) => {
                    // Split borrows: `reject` takes `&mut promise`, so
                    // compute the error (which reads `promise.get()`) first.
                    let err_val =
                        err.to_js_with_async_stack(global_object, store.get_path(), promise.get());
                    promise.reject(global_object, err_val)?;
                }
            }
            Ok(())
        };

        // `Transpiler::env_mut` is the safe accessor for the process-singleton
        // dotenv loader (never null once the VM is initialised).
        let proxy_url: Option<URL<'_>> = global_this
            .bun_vm()
            .as_mut()
            .transpiler
            .env_mut()
            .get_http_proxy(true, None, None);
        let proxy = proxy_url.as_ref().map(|url| url.href);
        let aws_options = self.get_credentials_with_options(extra_options, global_this)?;
        // `defer aws_options.deinit()` → Drop handles it.

        // Only read synchronously, to build the search-params string.
        let options = s3_client::get_list_objects_options_from_js(global_this, list_options)?;

        s3_client::list_objects(&aws_options.credentials, &options, Box::new(resolve), proxy)?;

        Ok(value)
    }
}

impl BytesExt for Bytes {
    fn to_internal_blob(&mut self) -> super::Internal {
        // `Internal.bytes` is `Vec<u8>` (global allocator): the allocation
        // itself when the storage *is* the global allocator's, otherwise a
        // copy (and the original is freed through its allocator, e.g. munmap).
        super::Internal {
            bytes: self.take_vec(),
            was_string: false,
        }
    }
}
