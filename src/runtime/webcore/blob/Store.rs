//! `Blob.Store` — backing storage variants for `webcore::Blob`.
//!
//! LAYERING: the data types (`Store`/`StoreRef`/`Data`/`Bytes`/`File`/`S3`)
//! are the **single nominal definitions** in `bun_jsc::webcore_types::store`;
//! this module re-exports them and layers the `bun_runtime`-tier behaviour
//! (S3 I/O, async file ops, structured-clone serialize) via extension traits.

use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use crate::node::fs as node_fs;
use crate::node::types::PathOrFileDescriptorSerializeTag;
use crate::webcore::jsc::{JSGlobalObject, JSPromise, JSValue, JsResult};
use crate::webcore::node_types::{self as node, PathLike, PathOrFileDescriptor};
use crate::webcore::s3::client as s3_client;
use crate::webcore::s3::client::S3ErrorJsc as _;
use crate::webcore::s3::client::{
    ACL, MultiPartUploadOptions, S3Credentials, S3CredentialsWithOptions, S3DeleteResult,
    S3ListObjectsOptions, S3ListObjectsResult, StorageClass,
};
use bun_collections::HashMap;
use bun_core::{PathString, ZigString, strings};
use bun_http_types::MimeType::MimeType;
use bun_url::URL;

use super::{Blob, SizeType};

// ──────────────────────────────────────────────────────────────────────────
// Re-export the canonical data types from `bun_jsc`.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_jsc::webcore_types::store::{
    Bytes, Data, DataTag, File, S3, SerializeTag, Store, StoreRef,
};

// TODO(port): IdentityContext(u64) hasher — bun_collections::HashMap needs an
// identity-hasher variant; load factor 80 is the std default in Zig.
pub type Map = HashMap<u64, *mut Store>;

// ──────────────────────────────────────────────────────────────────────────
// Extension traits — `bun_runtime`-tier behaviour layered on the `bun_jsc`
// data types. Inherent data-only methods (`size`/`shared_view`/`ref_`/`deref`/
// `init`/…) live on the `bun_jsc` types directly.
// ──────────────────────────────────────────────────────────────────────────

pub trait StoreExt {
    fn to_any_blob(&mut self) -> Option<super::Any>;
    fn init_s3_with_referenced_credentials(
        pathlike: PathLike,
        mime_type: Option<MimeType>,
        credentials: Arc<S3Credentials>,
    ) -> Result<Box<Store>, bun_core::Error>
    where
        Self: Sized;
    fn init_s3(
        pathlike: PathLike,
        mime_type: Option<MimeType>,
        credentials: S3Credentials,
    ) -> Result<Box<Store>, bun_core::Error>
    where
        Self: Sized;
    fn init_file(
        pathlike: PathOrFileDescriptor,
        mime_type: Option<MimeType>,
    ) -> Result<Box<Store>, bun_core::Error>
    where
        Self: Sized;
    #[cfg(unix)]
    fn init_mmap(slice: &'static mut [u8]) -> StoreRef
    where
        Self: Sized;
    fn serialize(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error>;
    fn from_array_list(list: Vec<u8>) -> Result<StoreRef, bun_core::Error>
    where
        Self: Sized;
}

pub trait S3Ext {
    fn get_credentials_with_options(
        &self,
        options: Option<JSValue>,
        global_object: &JSGlobalObject,
    ) -> JsResult<S3CredentialsWithOptions>;
    /// `store` is the heap `Store` that owns `self` (`self == &store.data.S3`).
    /// Neither impl mutates `self`, so a shared receiver lets callers hold the
    /// natural `&Store` alongside `&S3` without Stacked-Borrows gymnastics.
    fn unlink(
        &self,
        store: &Store,
        global_this: &JSGlobalObject,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue>;
    /// See `unlink` — `self` is read-only; `store` is the owning `Store`.
    fn list_objects(
        &self,
        store: &Store,
        global_this: &JSGlobalObject,
        list_options: JSValue,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue>;
}

pub trait FileExt {
    fn unlink(&self, global_this: &JSGlobalObject) -> JsResult<JSValue>;
}

pub trait BytesExt {
    #[cfg(unix)]
    fn init_mmap(slice: &'static mut [u8]) -> Bytes
    where
        Self: Sized;
    fn from_array_list(list: Vec<u8>) -> Result<Bytes, bun_core::Error>
    where
        Self: Sized;
    fn to_internal_blob(&mut self) -> super::Internal;
}

/// Shared mime-sniffing fallback for the `init_*` constructors below: derive a
/// `MimeType` from the path's extension, returning `None` for empty paths or
/// unknown extensions (Zig's `brk:` block in `initS3*`/`initFile`).
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

    fn init_s3_with_referenced_credentials(
        pathlike: PathLike,
        mime_type: Option<MimeType>,
        credentials: Arc<S3Credentials>,
    ) -> Result<Box<Store>, bun_core::Error> {
        let mut path = pathlike;
        // this actually protects/refs the pathlike
        path.to_thread_safe();

        // Compute the extension-derived fallback before moving `path` into the
        // Store so we don't need to clone the owned PathLike.
        let mime_type = mime_type.or_else(|| mime_from_path_ext(path.slice()));

        Ok(Store::new(Store {
            data: Data::S3(S3::init_with_referenced_credentials(
                path,
                mime_type,
                credentials,
            )),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: None,
        }))
    }

    fn init_s3(
        pathlike: PathLike,
        mime_type: Option<MimeType>,
        credentials: S3Credentials,
    ) -> Result<Box<Store>, bun_core::Error> {
        let mut path = pathlike;
        // this actually protects/refs the pathlike
        path.to_thread_safe();

        // Compute the extension-derived fallback before moving `path` into the
        // Store so we don't need to clone the owned PathLike.
        let mime_type = mime_type.or_else(|| mime_from_path_ext(path.slice()));

        Ok(Store::new(Store {
            data: Data::S3(S3::init(path, mime_type, credentials)),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: None,
        }))
    }

    fn init_file(
        pathlike: PathOrFileDescriptor,
        mime_type: Option<MimeType>,
    ) -> Result<Box<Store>, bun_core::Error> {
        // Compute the extension-derived fallback before moving `pathlike` into
        // the Store so we don't need to clone the owned PathOrFileDescriptor.
        let mime_type = mime_type.or_else(|| match &pathlike {
            PathOrFileDescriptor::Path(path) => mime_from_path_ext(path.slice()),
            PathOrFileDescriptor::Fd(_) => None,
        });

        Ok(Store::new(Store {
            data: Data::File(File::init(pathlike, mime_type)),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: None,
        }))
    }

    /// Adopt an mmap'd region — no copy. The store's `Bytes` payload owns the
    /// mapping; when the refcount drops to zero, `Bytes::drop` calls `munmap`.
    /// Mirrors Zig `Store.init(ptr[0..len], .{ .vtable = MmapFreeInterface.vtable })`.
    #[cfg(unix)]
    fn init_mmap(slice: &'static mut [u8]) -> StoreRef {
        StoreRef::from(Store::new(Store {
            data: Data::Bytes(Bytes::init_mmap(slice)),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: None,
        }))
    }

    // PORT NOTE: Zig `deinit` body became `impl Drop for Store` below. The manual
    // `allocator.free(file.pathlike.path.slice())` / `s3.deinit(allocator)` paths are
    // now handled by the owned types' own `Drop` impls.

    fn serialize(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
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
                        // PORT NOTE: Zig `writer.writeStruct(fd)` writes the raw
                        // bytes of the FD wrapper. `bun_sys::Fd` is
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

                writer.write_int_le::<u32>(bytes.stored_name.slice().len() as u32)?;
                writer.write_all(bytes.stored_name.slice())?;
            }
        }
        Ok(())
    }

    fn from_array_list(list: Vec<u8>) -> Result<StoreRef, bun_core::Error> {
        Ok(Store::init(list))
    }
}

impl FileExt for File {
    fn unlink(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match &self.pathlike {
            PathOrFileDescriptor::Path(path_like) => {
                // PORT NOTE: Zig `slice.toOwned()` / `toSliceClone()` are
                // fallible only on OOM; the Rust ports return the slice
                // directly (mimalloc aborts on OOM), so no `?`.
                let encoded_slice = match path_like {
                    PathLike::EncodedSlice(slice) => {
                        bun_core::ZigStringSlice::Owned(slice.slice().to_vec())
                    }
                    _ => ZigString::from_utf8(path_like.slice()).to_slice_clone(),
                };
                // Zig passes `undefined` for the `*Binding` arg (it is unused in
                // `AsyncFSTask::create`).
                let binding = node_fs::Binding::default();
                // SAFETY: `bun_vm()` returns the live per-global VM pointer; the
                // task is created on the JS thread that owns it.
                Ok(node_fs::async_::Unlink::create(
                    global_this,
                    &binding,
                    node_fs::args::Unlink {
                        path: PathLike::EncodedSlice(encoded_slice),
                    },
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
        // Zig: `S3Credentials.getCredentialsWithOptions(this.getCredentials().*, this.options,
        // options, this.acl, this.storage_class, this.request_payer, globalObject)`.
        // The Rust associated fn (surfaced via `S3CredentialsExt` in `webcore/S3Client.rs`)
        // takes `&S3Credentials` instead of by-value because `S3Credentials` carries a
        // private intrusive ref-count and cannot be struct-copied; the impl deep-copies
        // internally, matching the Zig `.*` value-copy semantics.
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
        store: &Store,
        global_this: &JSGlobalObject,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue> {
        struct Wrapper {
            promise: bun_jsc::JSPromiseStrong,
            store: StoreRef,
            // LIFETIMES.tsv: JSC_BORROW → &JSGlobalObject. `BackRef` so the heap
            // wrapper can outlive the constructing frame while reads stay safe.
            global: bun_ptr::BackRef<JSGlobalObject>,
        }

        impl Wrapper {
            #[inline]
            fn new(init: Wrapper) -> Box<Wrapper> {
                Box::new(init)
            }

            fn resolve(
                result: S3DeleteResult<'_>,
                opaque_self: *mut c_void,
            ) -> Result<(), bun_jsc::JsTerminated> {
                // SAFETY: opaque_self was created via heap::alloc(Wrapper::new(..)) below.
                let mut self_ = unsafe { bun_core::heap::take(opaque_self.cast::<Wrapper>()) };
                // `defer self.deinit()` → Box drops at scope exit.
                let global_object = self_.global.get();
                match result {
                    S3DeleteResult::Success => {
                        self_.promise.resolve(global_object, JSValue::TRUE)?;
                    }
                    S3DeleteResult::NotFound(err) | S3DeleteResult::Failure(err) => {
                        // Split borrows: `reject` takes `&mut promise`, so
                        // compute the error (which reads `promise.get()`) first.
                        let err_val = err.to_js_with_async_stack(
                            global_object,
                            self_.store.get_path(),
                            self_.promise.get(),
                        );
                        self_.promise.reject(global_object, err_val)?;
                    }
                }
                Ok(())
            }
        }

        // PORT NOTE: Wrapper.deinit body deleted — store.deref() handled by StoreRef::drop,
        // promise.deinit() handled by JSPromiseStrong::drop, bun.destroy(wrap) handled by
        // heap::take + drop in resolve().

        let promise = bun_jsc::JSPromiseStrong::init(global_this);
        let value = promise.value();
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
            Wrapper::resolve,
            bun_core::heap::into_raw(Wrapper::new(Wrapper {
                promise,
                // SAFETY: `store` is a live heap `Store`; `retained` bumps the
                // intrusive refcount (Zig: `store.ref()`).
                store: unsafe { StoreRef::retained(NonNull::from(store)) },
                global: bun_ptr::BackRef::new(global_this),
            }))
            .cast::<c_void>(),
            proxy,
            aws_options.request_payer,
        )?;

        Ok(value)
    }

    fn list_objects(
        &self,
        store: &Store,
        global_this: &JSGlobalObject,
        list_options: JSValue,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if !list_options.is_empty_or_undefined_or_null() && !list_options.is_object() {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "S3Client.listObjects() needs a S3ListObjectsOption as it's first argument"
            )));
        }

        struct Wrapper {
            promise: bun_jsc::JSPromiseStrong,
            store: StoreRef,
            resolved_list_options: S3ListObjectsOptions,
            // LIFETIMES.tsv: JSC_BORROW. `BackRef` for safe deref across the async callback.
            global: bun_ptr::BackRef<JSGlobalObject>,
        }

        impl Wrapper {
            fn resolve(
                result: S3ListObjectsResult<'_>,
                opaque_self: *mut c_void,
            ) -> Result<(), bun_jsc::JsTerminated> {
                // SAFETY: opaque_self was created via heap::alloc below.
                let mut self_ = unsafe { bun_core::heap::take(opaque_self.cast::<Wrapper>()) };
                // `defer self.deinit()` → Box drops at scope exit.
                let global_object = self_.global.get();

                match result {
                    S3ListObjectsResult::Success(list_result) => {
                        // `defer list_result.deinit()` → Drop handles it.
                        let list_result_js = match list_result.to_js(global_object) {
                            Ok(v) => v,
                            Err(e) => {
                                // Zig: `catch return self.promise.reject(global, error.JSError)`
                                return self_.promise.reject(global_object, Err(e));
                            }
                        };
                        self_.promise.resolve(global_object, list_result_js)?;
                    }

                    S3ListObjectsResult::NotFound(err) | S3ListObjectsResult::Failure(err) => {
                        // Split borrows: `reject` takes `&mut promise`, so
                        // compute the error (which reads `promise.get()`) first.
                        let err_val = err.to_js_with_async_stack(
                            global_object,
                            self_.store.get_path(),
                            self_.promise.get(),
                        );
                        self_.promise.reject(global_object, err_val)?;
                    }
                }
                Ok(())
            }
        }

        // PORT NOTE: Wrapper.deinit/destroy bodies deleted — store.deref() via StoreRef::drop,
        // promise.deinit() via JSPromiseStrong::drop, resolvedlistOptions.deinit() via
        // S3ListObjectsOptions::drop, bun.destroy(self) via heap::take + drop.

        let promise = bun_jsc::JSPromiseStrong::init(global_this);
        let value = promise.value();
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

        let options = s3_client::get_list_objects_options_from_js(global_this, list_options)?;

        // PORT NOTE: Zig passed `options` by-value to both `bun.S3.listObjects`
        // and `Wrapper.resolvedlistOptions` (implicit struct copy).
        // `S3ListObjectsOptions` is not `Clone` in Rust (owns `Utf8Slice`s);
        // box the wrapper first so the options live on the heap, then hand a
        // borrow to `list_objects` (which only reads them synchronously to
        // build the search-params string). The wrapper retains ownership for
        // `Drop` after the async callback — matching Zig's `deinit()`.
        let wrapper = bun_core::heap::into_raw(Box::new(Wrapper {
            promise,
            // SAFETY: `store` is a live heap `Store`; `retained` bumps the
            // intrusive refcount (Zig: `store.ref()`).
            store: unsafe { StoreRef::retained(NonNull::from(store)) },
            resolved_list_options: options,
            global: bun_ptr::BackRef::new(global_this),
        }));

        s3_client::list_objects(
            &aws_options.credentials,
            // SAFETY: `wrapper` is freshly leaked and untouched until the
            // callback; this borrow ends before any other access.
            unsafe { &(*wrapper).resolved_list_options },
            Wrapper::resolve,
            wrapper.cast::<c_void>(),
            proxy,
        )?;

        Ok(value)
    }
}

impl BytesExt for Bytes {
    /// Adopt an mmap'd region. `Drop` (`allocator.free`) will `munmap` it.
    /// Mirrors Zig `Store.init(ptr[0..len], .{ .vtable = MmapFreeInterface.vtable })`.
    #[cfg(unix)]
    fn init_mmap(slice: &'static mut [u8]) -> Bytes {
        // Stateless allocator vtable whose `free` munmap's. Same pattern as
        // `LinuxMemFdAllocator` but without the stateful fd. Body is fully
        // safe (`bun_sys::munmap` is a safe wrapper); the safe fn item coerces
        // into `AllocatorVTable::free_only`'s raw fn-pointer slot.
        fn free(_: *mut core::ffi::c_void, buf: &mut [u8], _: bun_alloc::Alignment, _: usize) {
            if let bun_sys::Result::Err(err) = bun_sys::munmap(buf.as_mut_ptr(), buf.len()) {
                bun_core::Output::debug_warn(format_args!(
                    "Blob mmap-store munmap failed: {err:?}"
                ));
            }
        }
        static MMAP_FREE_VTABLE: bun_alloc::AllocatorVTable =
            bun_alloc::AllocatorVTable::free_only(free);
        // SAFETY: caller (C++ WebKit screenshot path) guarantees `slice` is a
        // page-aligned mmap'd region we now own. `len == cap` so `free` munmaps
        // exactly the same range.
        unsafe {
            Bytes::from_raw_parts(
                slice.as_mut_ptr(),
                slice.len() as SizeType,
                slice.len() as SizeType,
                bun_alloc::StdAllocator {
                    ptr: core::ptr::null_mut(),
                    vtable: &MMAP_FREE_VTABLE,
                },
            )
        }
    }

    fn from_array_list(list: Vec<u8>) -> Result<Bytes, bun_core::Error> {
        // TODO(port): Zig signature returns `!*Bytes` but body returns `Bytes` by value —
        // mirroring the by-value return here.
        Ok(Bytes::init(list))
    }

    fn to_internal_blob(&mut self) -> super::Internal {
        // Zig built an `array_list.Managed(u8)` over the same allocator and
        // zeroed self. `Internal.bytes` is `Vec<u8>` (global allocator), so
        // round-trip only when the storage *is* the global allocator; otherwise
        // copy + free through the original allocator (e.g. memfd → munmap).
        let bytes = if self.ptr.is_none() {
            Vec::new()
        } else if core::ptr::eq(
            std::ptr::from_ref(self.allocator.vtable),
            std::ptr::from_ref(bun_alloc::basic::C_ALLOCATOR.vtable),
        ) {
            let len = self.len as usize;
            let cap = self.cap as usize;
            let ptr = self.ptr.take().unwrap();
            // SAFETY: `init(Vec<u8>)` is the only path that stores
            // `C_ALLOCATOR`, and it recorded the exact `(ptr, len, cap)`
            // from `Vec::into_raw_parts`-equivalent decomposition.
            unsafe { Vec::from_raw_parts(ptr.as_ptr(), len, cap) }
        } else {
            // Non-global allocator (e.g. memfd → munmap): copy through the
            // safe `Bytes::slice()` accessor, then free via the owning vtable
            // — same path `Bytes::drop` takes (`allocator.free(allocated_slice())`).
            let copy = self.slice().to_vec();
            self.allocator.free(self.allocated_slice());
            self.ptr = None;
            copy
        };
        self.len = 0;
        self.cap = 0;
        self.allocator = bun_alloc::basic::C_ALLOCATOR;
        super::Internal {
            bytes,
            was_string: false,
        }
    }
}

/// `array_buffer.zig:BlobArrayBuffer_deallocator` — JSC `ArrayBuffer` external
/// deallocator callback for buffers backed by a `Blob.Store`. C++ stashes a
/// `*mut Store` as the deallocator context; this releases that ref.
#[unsafe(no_mangle)]
pub extern "C" fn BlobArrayBuffer_deallocator(
    _bytes: *mut core::ffi::c_void,
    blob: *mut core::ffi::c_void,
) {
    // SAFETY: `blob` is the non-null `*mut Store` C++ stashed as deallocator
    // context (originating from `heap::alloc` / `StoreRef::into_raw`); it
    // owns one outstanding reference being released here.
    unsafe { Store::deref(NonNull::new_unchecked(blob.cast::<Store>())) };
}
