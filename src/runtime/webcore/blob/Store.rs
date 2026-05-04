use core::ffi::c_void;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use bun_collections::HashMap;
use bun_http::MimeType;
use bun_jsc::{JSGlobalObject, JSPromise, JSValue, JsResult, ZigString};
use bun_paths::PathString;
use bun_runtime::node::{self, PathLike, PathOrFileDescriptor};
use bun_s3::{
    self as s3, MultiPartUploadOptions, S3Credentials, S3CredentialsWithOptions, S3DeleteResult,
    S3ListObjectsOptions, S3ListObjectsResult, ACL, StorageClass,
};
use bun_str::strings;
use bun_url::URL;

use super::{Blob, SizeType};

pub struct Store {
    pub data: Data,

    pub mime_type: MimeType,
    pub ref_count: AtomicU32,
    pub is_all_ascii: Option<bool>,
    // PORT NOTE: `allocator: std.mem.Allocator` field dropped — global mimalloc is used
    // everywhere in non-AST crates (see PORTING.md §Allocators).
}

impl Default for Store {
    fn default() -> Self {
        Self {
            data: Data::Bytes(Bytes::default()),
            mime_type: MimeType::NONE,
            ref_count: AtomicU32::new(1),
            is_all_ascii: None,
        }
    }
}

impl Store {
    #[inline]
    pub fn new(init: Store) -> Box<Store> {
        // bun.TrivialNew(@This())
        Box::new(init)
    }

    pub fn memory_cost(&self) -> usize {
        if self.has_one_ref() {
            core::mem::size_of::<Self>()
                + match &self.data {
                    Data::Bytes(bytes) => bytes.len() as usize,
                    Data::File(_) => 0,
                    Data::S3(s3) => s3.estimated_size(),
                }
        } else {
            0
        }
    }

    pub fn get_path(&self) -> Option<&[u8]> {
        match &self.data {
            Data::Bytes(bytes) => {
                if bytes.stored_name.len() > 0 {
                    Some(bytes.stored_name.slice())
                } else {
                    None
                }
            }
            Data::File(file) => {
                if let PathOrFileDescriptor::Path(path) = &file.pathlike {
                    Some(path.slice())
                } else {
                    None
                }
            }
            Data::S3(s3) => Some(s3.pathlike.slice()),
        }
    }

    pub fn size(&self) -> SizeType {
        match &self.data {
            Data::Bytes(bytes) => bytes.len(),
            Data::S3(_) | Data::File(_) => Blob::MAX_SIZE,
        }
    }

    pub fn ref_(&self) {
        let old = self.ref_count.fetch_add(1, Ordering::Relaxed);
        debug_assert!(old > 0);
    }

    pub fn has_one_ref(&self) -> bool {
        self.ref_count.load(Ordering::Relaxed) == 1
    }

    /// Caller is responsible for derefing the Store.
    pub fn to_any_blob(&mut self) -> Option<Blob::Any> {
        if self.has_one_ref() {
            if let Data::Bytes(bytes) = &mut self.data {
                return Some(Blob::Any::InternalBlob(bytes.to_internal_blob()));
            }
        }

        None
    }

    /// `extern fn external(ptr: ?*anyopaque, _: ?*anyopaque, _: usize) callconv(.c) void`
    // PORT NOTE: Zig has only `callconv(.c)` (callback fn pointer), no `@export` — so no
    // `#[unsafe(no_mangle)]` here.
    pub extern "C" fn external(ptr: *mut c_void, _: *mut c_void, _: usize) {
        if ptr.is_null() {
            return;
        }
        // SAFETY: caller passes a *Store as the opaque pointer; mirrors Zig `bun.cast(*Store, ptr)`.
        let this = unsafe { &mut *(ptr as *mut Store) };
        this.deref();
    }

    pub fn init_s3_with_referenced_credentials(
        pathlike: PathLike,
        mime_type: Option<MimeType>,
        credentials: Arc<S3Credentials>,
    ) -> Result<Box<Store>, bun_core::Error> {
        let mut path = pathlike;
        // this actually protects/refs the pathlike
        path.to_thread_safe();

        let store = Store::new(Store {
            data: Data::S3(S3::init_with_referenced_credentials(
                path.clone(),
                mime_type.or_else(|| 'brk: {
                    let sliced = path.slice();
                    if !sliced.is_empty() {
                        let mut extname = bun_paths::extension(sliced);
                        extname = strings::trim(extname, b".");
                        if let Some(mime) = MimeType::by_extension_no_default(extname) {
                            break 'brk Some(mime);
                        }
                    }
                    break 'brk None;
                }),
                credentials,
            )),
            mime_type: MimeType::NONE,
            ref_count: AtomicU32::new(1),
            is_all_ascii: None,
        });
        Ok(store)
    }

    pub fn init_s3(
        pathlike: PathLike,
        mime_type: Option<MimeType>,
        credentials: S3Credentials,
    ) -> Result<Box<Store>, bun_core::Error> {
        let mut path = pathlike;
        // this actually protects/refs the pathlike
        path.to_thread_safe();

        let store = Store::new(Store {
            data: Data::S3(S3::init(
                path.clone(),
                mime_type.or_else(|| 'brk: {
                    let sliced = path.slice();
                    if !sliced.is_empty() {
                        let mut extname = bun_paths::extension(sliced);
                        extname = strings::trim(extname, b".");
                        if let Some(mime) = MimeType::by_extension_no_default(extname) {
                            break 'brk Some(mime);
                        }
                    }
                    break 'brk None;
                }),
                credentials,
            )),
            mime_type: MimeType::NONE,
            ref_count: AtomicU32::new(1),
            is_all_ascii: None,
        });
        Ok(store)
    }

    pub fn init_file(
        pathlike: PathOrFileDescriptor,
        mime_type: Option<MimeType>,
    ) -> Result<Box<Store>, bun_core::Error> {
        let store = Store::new(Store {
            data: Data::File(File::init(
                pathlike.clone(),
                mime_type.or_else(|| 'brk: {
                    if let PathOrFileDescriptor::Path(path) = &pathlike {
                        let sliced = path.slice();
                        if !sliced.is_empty() {
                            let mut extname = bun_paths::extension(sliced);
                            extname = strings::trim(extname, b".");
                            if let Some(mime) = MimeType::by_extension_no_default(extname) {
                                break 'brk Some(mime);
                            }
                        }
                    }

                    break 'brk None;
                }),
            )),
            mime_type: MimeType::NONE,
            ref_count: AtomicU32::new(1),
            is_all_ascii: None,
        });
        Ok(store)
    }

    /// Takes ownership of `bytes`.
    pub fn init(bytes: Vec<u8>) -> Box<Store> {
        let store = Store::new(Store {
            data: Data::Bytes(Bytes::init(bytes)),
            mime_type: MimeType::NONE,
            ref_count: AtomicU32::new(1),
            is_all_ascii: None,
        });
        store
    }

    pub fn shared_view(&self) -> &[u8] {
        if let Data::Bytes(bytes) = &self.data {
            return bytes.slice();
        }

        &[]
    }

    pub fn deref(&self) {
        let old = self.ref_count.fetch_sub(1, Ordering::Relaxed);
        debug_assert!(old >= 1);
        if old == 1 {
            // SAFETY: refcount hit zero; this Store was allocated via `Box::new` (Store::new)
            // and we are the last owner. Mirrors Zig `this.deinit()` → `bun.destroy(this)`.
            unsafe {
                drop(Box::from_raw(self as *const Store as *mut Store));
            }
        }
    }

    // PORT NOTE: Zig `deinit` body became `impl Drop for Store` below. The manual
    // `allocator.free(file.pathlike.path.slice())` / `s3.deinit(allocator)` paths are
    // now handled by the owned types' own `Drop` impls.

    pub fn serialize(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
        match &self.data {
            Data::File(file) => {
                let pathlike_tag: node::PathOrFileDescriptorSerializeTag =
                    if matches!(file.pathlike, PathOrFileDescriptor::Fd(_)) {
                        node::PathOrFileDescriptorSerializeTag::Fd
                    } else {
                        node::PathOrFileDescriptorSerializeTag::Path
                    };
                writer.write_int_le::<u8>(pathlike_tag as u8)?;

                match &file.pathlike {
                    PathOrFileDescriptor::Fd(fd) => {
                        writer.write_struct(fd)?;
                    }
                    PathOrFileDescriptor::Path(path) => {
                        let path_slice = path.slice();
                        writer.write_int_le::<u32>(path_slice.len() as u32)?;
                        writer.write_all(path_slice)?;
                    }
                }
            }
            Data::S3(s3) => {
                let pathlike_tag = node::PathOrFileDescriptorSerializeTag::Path;
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

    pub fn from_array_list(list: Vec<u8>) -> Result<Box<Store>, bun_core::Error> {
        Ok(Store::init(list))
    }
}

impl Drop for Store {
    fn drop(&mut self) {
        // Zig `deinit`:
        // - .bytes => bytes.deinit()         → handled by Bytes::drop (Vec<u8>, PathString)
        // - .file  => free pathlike.path     → handled by PathOrFileDescriptor::drop
        // - .s3    => s3.deinit(allocator)   → handled by S3::drop
        // TODO(port): verify PathOrFileDescriptor/PathLike own their string storage so the
        // manual `allocator.free(@constCast(file.pathlike.path.slice()))` path is covered.
    }
}

// TODO(port): IdentityContext(u64) hasher — bun_collections::HashMap needs an identity hasher
// variant; load factor 80 is the std default in Zig.
pub type Map = HashMap<u64, *mut Store>;

pub enum Data {
    Bytes(Bytes),
    File(File),
    S3(S3),
}

#[repr(u8)]
pub enum SerializeTag {
    File = 0,
    Bytes = 1,
    Empty = 2,
}

/// A blob store that references a file on disk.
pub struct File {
    pub pathlike: PathOrFileDescriptor,
    pub mime_type: MimeType,
    pub is_atty: Option<bool>,
    pub mode: bun_sys::Mode,
    pub seekable: Option<bool>,
    pub max_size: SizeType,
    /// milliseconds since ECMAScript epoch
    pub last_modified: bun_jsc::JSTimeType,
}

impl Default for File {
    fn default() -> Self {
        Self {
            pathlike: PathOrFileDescriptor::default(),
            mime_type: MimeType::OTHER,
            is_atty: None,
            mode: 0,
            seekable: None,
            max_size: Blob::MAX_SIZE,
            last_modified: bun_jsc::INIT_TIMESTAMP,
        }
    }
}

impl File {
    pub fn unlink(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match &self.pathlike {
            PathOrFileDescriptor::Path(path_like) => {
                let encoded_slice = match path_like {
                    PathLike::EncodedSlice(slice) => slice.to_owned()?,
                    _ => ZigString::from_utf8(path_like.slice()).to_slice_clone()?,
                };
                // TODO(port): jsc.Node.fs.Async.unlink.create — second arg is `undefined` in Zig
                node::fs::async_::Unlink::create(
                    global_this,
                    /* undefined */ Default::default(),
                    node::fs::UnlinkArgs {
                        path: PathLike::EncodedSlice(encoded_slice),
                    },
                    global_this.bun_vm(),
                )
            }
            PathOrFileDescriptor::Fd(_) => Ok(JSPromise::resolved_promise_value(
                global_this,
                global_this
                    .create_invalid_args("Is not possible to unlink a file descriptor", &[]),
            )),
        }
    }

    pub fn is_seekable(&self) -> Option<bool> {
        if let Some(seekable) = self.seekable {
            return Some(seekable);
        }

        if self.mode != 0 {
            return Some(bun_sys::is_regular_file(self.mode));
        }

        None
    }

    pub fn init(pathlike: PathOrFileDescriptor, mime_type: Option<MimeType>) -> File {
        File {
            pathlike,
            mime_type: mime_type.unwrap_or(MimeType::OTHER),
            ..Default::default()
        }
    }
}

/// An S3 Blob Store
pub struct S3 {
    pub pathlike: PathLike,
    pub mime_type: MimeType,
    pub credentials: Option<Arc<S3Credentials>>,
    pub options: MultiPartUploadOptions,
    pub acl: Option<ACL>,
    pub storage_class: Option<StorageClass>,
    pub request_payer: bool,
}

impl Default for S3 {
    fn default() -> Self {
        Self {
            pathlike: PathLike::default(),
            mime_type: MimeType::OTHER,
            credentials: None,
            options: MultiPartUploadOptions::default(),
            acl: None,
            storage_class: None,
            request_payer: false,
        }
    }
}

impl S3 {
    pub fn is_seekable(&self) -> Option<bool> {
        Some(true)
    }

    pub fn get_credentials(&self) -> &Arc<S3Credentials> {
        debug_assert!(self.credentials.is_some());
        self.credentials.as_ref().unwrap()
    }

    pub fn get_credentials_with_options(
        &self,
        options: Option<JSValue>,
        global_object: &JSGlobalObject,
    ) -> JsResult<S3CredentialsWithOptions> {
        S3Credentials::get_credentials_with_options(
            (**self.get_credentials()).clone(),
            self.options,
            options,
            self.acl,
            self.storage_class,
            self.request_payer,
            global_object,
        )
    }

    pub fn path(&self) -> &[u8] {
        let mut path_name = URL::parse(self.pathlike.slice()).s3_path();
        // normalize start and ending
        if strings::ends_with(path_name, b"/") {
            path_name = &path_name[0..path_name.len()];
        } else if strings::ends_with(path_name, b"\\") {
            path_name = &path_name[0..path_name.len() - 1];
        }
        if strings::starts_with(path_name, b"/") {
            path_name = &path_name[1..];
        } else if strings::starts_with(path_name, b"\\") {
            path_name = &path_name[1..];
        }
        path_name
    }

    pub fn unlink(
        &mut self,
        store: &Store,
        global_this: &JSGlobalObject,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue> {
        struct Wrapper {
            promise: bun_jsc::JSPromiseStrong,
            // LIFETIMES.tsv: SHARED → Arc<Store>
            // TODO(port): Store is intrusively refcounted (ref_count: AtomicU32) and crosses
            // FFI; Phase B should reconcile Arc<Store> vs bun_ptr::IntrusiveArc<Store>.
            store: Arc<Store>,
            // LIFETIMES.tsv: JSC_BORROW → &JSGlobalObject — but this struct is heap-allocated
            // and passed through *anyopaque to an async callback, so a borrowed reference
            // cannot be expressed without a lifetime that outlives the constructing frame.
            // TODO(port): lifetime — using raw pointer for now.
            global: *const JSGlobalObject,
        }

        impl Wrapper {
            #[inline]
            fn new(init: Wrapper) -> Box<Wrapper> {
                Box::new(init)
            }

            fn resolve(
                result: S3DeleteResult,
                opaque_self: *mut c_void,
            ) -> Result<(), bun_jsc::JsTerminated> {
                // SAFETY: opaque_self was created via Box::into_raw(Wrapper::new(..)) below.
                let self_ = unsafe { Box::from_raw(opaque_self as *mut Wrapper) };
                // `defer self.deinit()` → Box drops at scope exit.
                // SAFETY: global was a valid &JSGlobalObject when the wrapper was created and
                // the VM keeps it alive for the duration of the async op.
                let global_object = unsafe { &*self_.global };
                match result {
                    S3DeleteResult::Success => {
                        self_.promise.resolve(global_object, JSValue::TRUE)?;
                    }
                    S3DeleteResult::NotFound(err) | S3DeleteResult::Failure(err) => {
                        self_.promise.reject(
                            global_object,
                            err.to_js_with_async_stack(
                                global_object,
                                self_.store.get_path(),
                                self_.promise.get(),
                            ),
                        )?;
                    }
                }
                Ok(())
            }
        }

        // PORT NOTE: Wrapper.deinit body deleted — store.deref() handled by Arc::drop,
        // promise.deinit() handled by JSPromiseStrong::drop, bun.destroy(wrap) handled by
        // Box::from_raw + drop in resolve().

        let promise = bun_jsc::JSPromiseStrong::init(global_this);
        let value = promise.value();
        let proxy_url = global_this
            .bun_vm()
            .transpiler
            .env
            .get_http_proxy(true, None, None);
        let proxy = proxy_url.as_ref().map(|url| url.href());
        let aws_options = self.get_credentials_with_options(extra_options, global_this)?;
        // `defer aws_options.deinit()` → Drop handles it.
        store.ref_();

        s3::delete(
            &aws_options.credentials,
            self.path(),
            Wrapper::resolve as *const _,
            Box::into_raw(Wrapper::new(Wrapper {
                promise,
                // TODO(port): see Wrapper.store note — Arc::from intrusive refcount mismatch.
                // SAFETY: `store` was Box-allocated via Store::new and ref()'d just above;
                // Arc::from_raw is a Phase-A placeholder for the intrusive refcount handle
                // pending IntrusiveArc reconciliation in Phase B.
                store: unsafe { Arc::from_raw(store as *const Store) },
                global: global_this as *const _,
            })) as *mut c_void,
            proxy,
            aws_options.request_payer,
        )?;

        Ok(value)
    }

    pub fn list_objects(
        &mut self,
        store: &Store,
        global_this: &JSGlobalObject,
        list_options: JSValue,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue> {
        if !list_options.is_empty_or_undefined_or_null() && !list_options.is_object() {
            return global_this.throw_invalid_arguments(
                "S3Client.listObjects() needs a S3ListObjectsOption as it's first argument",
                &[],
            );
        }

        struct Wrapper {
            promise: bun_jsc::JSPromiseStrong,
            // LIFETIMES.tsv: SHARED → Arc<Store>
            // TODO(port): see unlink::Wrapper.store note re intrusive refcount.
            store: Arc<Store>,
            resolved_list_options: S3ListObjectsOptions,
            // TODO(port): lifetime — JSC_BORROW per LIFETIMES.tsv; raw pointer for heap struct.
            global: *const JSGlobalObject,
        }

        impl Wrapper {
            fn resolve(
                result: S3ListObjectsResult,
                opaque_self: *mut c_void,
            ) -> Result<(), bun_jsc::JsTerminated> {
                // SAFETY: opaque_self was created via Box::into_raw below.
                let self_ = unsafe { Box::from_raw(opaque_self as *mut Wrapper) };
                // `defer self.deinit()` → Box drops at scope exit.
                // SAFETY: global was a valid &JSGlobalObject when the wrapper was created.
                let global_object = unsafe { &*self_.global };

                match result {
                    S3ListObjectsResult::Success(list_result) => {
                        // `defer list_result.deinit()` → Drop handles it.
                        let list_result_js = match list_result.to_js(global_object) {
                            Ok(v) => v,
                            Err(_) => {
                                return self_
                                    .promise
                                    .reject(global_object, bun_core::err!("JSError"));
                            }
                        };
                        self_.promise.resolve(global_object, list_result_js)?;
                    }

                    S3ListObjectsResult::NotFound(err) | S3ListObjectsResult::Failure(err) => {
                        self_.promise.reject(
                            global_object,
                            err.to_js_with_async_stack(
                                global_object,
                                self_.store.get_path(),
                                self_.promise.get(),
                            ),
                        )?;
                    }
                }
                Ok(())
            }
        }

        // PORT NOTE: Wrapper.deinit/destroy bodies deleted — store.deref() via Arc::drop,
        // promise.deinit() via JSPromiseStrong::drop, resolvedlistOptions.deinit() via
        // S3ListObjectsOptions::drop, bun.destroy(self) via Box::from_raw + drop.

        let promise = bun_jsc::JSPromiseStrong::init(global_this);
        let value = promise.value();
        let proxy_url = global_this
            .bun_vm()
            .transpiler
            .env
            .get_http_proxy(true, None, None);
        let proxy = proxy_url.as_ref().map(|url| url.href());
        let aws_options = self.get_credentials_with_options(extra_options, global_this)?;
        // `defer aws_options.deinit()` → Drop handles it.

        let options = s3::get_list_objects_options_from_js(global_this, list_options)?;
        store.ref_();

        s3::list_objects(
            &aws_options.credentials,
            options.clone(),
            Wrapper::resolve as *const _,
            Box::into_raw(Box::new(Wrapper {
                promise,
                // TODO(port): see Wrapper.store note — Arc::from intrusive refcount mismatch.
                // SAFETY: `store` was Box-allocated via Store::new and ref()'d just above;
                // Arc::from_raw is a Phase-A placeholder for the intrusive refcount handle
                // pending IntrusiveArc reconciliation in Phase B.
                store: unsafe { Arc::from_raw(store as *const Store) },
                resolved_list_options: options,
                global: global_this as *const _,
            })) as *mut c_void,
            proxy,
        )?;

        Ok(value)
    }

    pub fn init_with_referenced_credentials(
        pathlike: PathLike,
        mime_type: Option<MimeType>,
        credentials: Arc<S3Credentials>,
    ) -> S3 {
        // Zig: credentials.ref() — Arc::clone bumps the strong count.
        S3 {
            credentials: Some(Arc::clone(&credentials)),
            pathlike,
            mime_type: mime_type.unwrap_or(MimeType::OTHER),
            ..Default::default()
        }
    }

    pub fn init(pathlike: PathLike, mime_type: Option<MimeType>, credentials: S3Credentials) -> S3 {
        S3 {
            // Zig: credentials.dupe() — heap-allocate a fresh refcounted copy.
            credentials: Some(Arc::new(credentials)),
            pathlike,
            mime_type: mime_type.unwrap_or(MimeType::OTHER),
            ..Default::default()
        }
    }

    pub fn estimated_size(&self) -> usize {
        self.pathlike.estimated_size()
            + self
                .credentials
                .as_ref()
                .map(|c| c.estimated_size())
                .unwrap_or(0)
    }
}

// PORT NOTE: S3.deinit deleted — body only freed owned fields (pathlike, credentials.deref()),
// all handled by PathLike::drop / Option<Arc<_>>::drop. Per PORTING.md §Idiom map, no explicit
// `impl Drop` needed.
// TODO(port): verify PathLike owns its `.string` storage so the manual
// `allocator.free(@constCast(this.pathlike.slice()))` path from Zig deinit is covered.

#[derive(Default)]
pub struct Bytes {
    // LIFETIMES.tsv: ptr+len+cap+allocator collapse to Vec<u8>.
    // PORT NOTE: Zig stored len/cap as SizeType (Blob.SizeType); Vec<u8> uses usize.
    // Accessors below truncate to SizeType to preserve the original API surface.
    data: Vec<u8>,

    /// Used by standalone module graph and the File constructor
    pub stored_name: PathString,
}

impl Bytes {
    /// Takes ownership of `bytes`.
    pub fn init(bytes: Vec<u8>) -> Bytes {
        Bytes {
            data: bytes,
            stored_name: PathString::empty(),
        }
    }

    pub fn init_empty_with_name(name: PathString) -> Bytes {
        Bytes {
            data: Vec::new(),
            stored_name: name,
        }
    }

    pub fn from_array_list(list: Vec<u8>) -> Result<Bytes, bun_core::Error> {
        // TODO(port): Zig signature returns `!*Bytes` but body returns `Bytes` by value —
        // mirroring the by-value return here.
        Ok(Bytes::init(list))
    }

    pub fn to_internal_blob(&mut self) -> Blob::Internal {
        // PORT NOTE: reshaped — Zig manually rebuilt an ArrayList from ptr/len/cap then
        // zeroed self. With Vec<u8>, mem::take moves the buffer out and leaves an empty Vec.
        Blob::Internal {
            bytes: core::mem::take(&mut self.data),
        }
    }

    #[inline]
    pub fn len(&self) -> SizeType {
        self.data.len() as SizeType
    }

    pub fn slice(&self) -> &[u8] {
        self.data.as_slice()
    }

    pub fn allocated_slice(&self) -> &[u8] {
        // SAFETY: Vec guarantees ptr[0..capacity] is allocated; bytes in [len..cap] are
        // uninitialized. Mirrors Zig `ptr[0..this.cap]` which has the same caveat.
        unsafe { core::slice::from_raw_parts(self.data.as_ptr(), self.data.capacity()) }
    }

    pub fn as_array_list(&mut self) -> &mut Vec<u8> {
        self.as_array_list_leak()
    }

    pub fn as_array_list_leak(&mut self) -> &mut Vec<u8> {
        // PORT NOTE: Zig returned an ArrayListUnmanaged view (items=ptr[0..len], cap=cap)
        // without transferring ownership. Returning &mut Vec<u8> is the closest safe
        // equivalent; callers that need to take ownership should use to_internal_blob().
        &mut self.data
    }
}

// PORT NOTE: Bytes.deinit deleted — Vec<u8> and PathString fields drop automatically.
// Zig also freed `stored_name.slice()` via default_allocator; PathString::drop must own that.
// TODO(port): verify PathString::drop frees its backing buffer.

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/blob/Store.zig (577 lines)
//   confidence: medium
//   todos:      13
//   notes:      Store is intrusively refcounted + crosses FFI; LIFETIMES.tsv says Arc<Store> for Wrapper fields — Phase B must reconcile with bun_ptr::IntrusiveArc. Bytes collapsed to Vec<u8> per TSV.
// ──────────────────────────────────────────────────────────────────────────
