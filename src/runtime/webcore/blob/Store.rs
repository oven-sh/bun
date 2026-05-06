use core::ffi::c_void;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;

use bun_collections::HashMap;
use bun_http_types::MimeType::MimeType;
use crate::webcore::jsc::{JSGlobalObject, JSPromise, JSValue, JsResult};
use bun_str::{strings, PathString, ZigString};
use crate::webcore::node_types::{self as node, PathLike, PathOrFileDescriptor};
use crate::node::types::PathOrFileDescriptorSerializeTag;
use crate::node::fs as node_fs;
// PORT NOTE: migrated off `webcore::s3_stub` — `bun_s3_signing` now provides
// the real `S3Credentials`/`ACL`/`StorageClass` and `s3::client` re-exports
// the result enums. The stub module is kept only for types not yet ported.
use crate::webcore::s3::client::{
    MultiPartUploadOptions, S3Credentials, S3CredentialsWithOptions, S3DeleteResult,
    S3ListObjectsOptions, S3ListObjectsResult, ACL, StorageClass,
};
use crate::webcore::s3::client as s3_client;
use crate::webcore::s3::error_jsc::S3ErrorJsc as _;
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
            mime_type: bun_http_types::MimeType::NONE,
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
                if !bytes.stored_name.slice().is_empty() {
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
            Data::S3(_) | Data::File(_) => super::MAX_SIZE,
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
    pub fn to_any_blob(&mut self) -> Option<super::Any> {
        if self.has_one_ref() {
            if let Data::Bytes(bytes) = &mut self.data {
                return Some(super::Any::InternalBlob(bytes.to_internal_blob()));
            }
        }

        None
    }

    /// `extern fn external(ptr: ?*anyopaque, _: ?*anyopaque, _: usize) callconv(.c) void`
    // PORT NOTE: Zig has only `callconv(.c)` (callback fn pointer), no `@export` — so no
    // `#[unsafe(no_mangle)]` here.
    pub extern "C" fn external(ptr: *mut c_void, _: *mut c_void, _: usize) {
        let Some(this) = NonNull::new(ptr as *mut Store) else { return };
        // SAFETY: caller passes a `*Store` (originally leaked via `Box::into_raw`)
        // as the opaque pointer; mirrors Zig `bun.cast(*Store, ptr)`. Stay on raw
        // pointers — never materialize `&mut Store` here, other `StoreRef`s may
        // hold `&Store` to the same allocation.
        unsafe { Store::deref(this) };
    }

    // TODO(b2-blocked): S3/file constructors call PathLike::to_thread_safe/clone,
    // bun_paths::extension, bun_http_types::MimeType::by_extension_no_default — un-gate once
    // node_types::PathLike is the real `crate::node::PathLike`.
    
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
                        if let Some(mime) = bun_http_types::MimeType::by_extension_no_default(extname) {
                            break 'brk Some(mime);
                        }
                    }
                    break 'brk None;
                }),
                credentials,
            )),
            mime_type: bun_http_types::MimeType::NONE,
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
                        if let Some(mime) = bun_http_types::MimeType::by_extension_no_default(extname) {
                            break 'brk Some(mime);
                        }
                    }
                    break 'brk None;
                }),
                credentials,
            )),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: AtomicU32::new(1),
            is_all_ascii: None,
        });
        Ok(store)
    }

    
    /// C-ABI trampoline for `bun_jsc::webcore::blob::Store::init_file` —
    /// breaks the `bun_jsc → bun_webcore` forward-dep cycle (same pattern as
    /// `Bun__Blob__sharedView`). `pathlike` is moved out of `*pathlike` by
    /// `ptr::read`; caller must `mem::forget` its local.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn Bun__Blob__Store__initFile(
        pathlike: *mut PathOrFileDescriptor,
        mime_type: *const MimeType,
    ) -> *mut Store {
        // SAFETY: caller guarantees `pathlike` points to an initialised
        // `PathOrFileDescriptor` whose ownership is being transferred here.
        let pathlike = unsafe { core::ptr::read(pathlike) };
        let mime_type = if mime_type.is_null() {
            None
        } else {
            // SAFETY: caller passes a live `&MimeType` when non-null.
            Some(unsafe { (*mime_type).clone() })
        };
        match Store::init_file(pathlike, mime_type) {
            Ok(b) => Box::into_raw(b),
            Err(_) => core::ptr::null_mut(),
        }
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
                            if let Some(mime) = bun_http_types::MimeType::by_extension_no_default(extname) {
                                break 'brk Some(mime);
                            }
                        }
                    }

                    break 'brk None;
                }),
            )),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: AtomicU32::new(1),
            is_all_ascii: None,
        });
        Ok(store)
    }

    /// Takes ownership of `bytes`.
    pub fn init(bytes: Vec<u8>) -> StoreRef {
        StoreRef::from(Store::new(Store {
            data: Data::Bytes(Bytes::init(bytes)),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: AtomicU32::new(1),
            is_all_ascii: None,
        }))
    }

    pub fn shared_view(&self) -> &[u8] {
        if let Data::Bytes(bytes) = &self.data {
            return bytes.slice();
        }

        &[]
    }

    /// Decrement the intrusive refcount; frees the allocation when it hits zero.
    ///
    /// Takes a raw pointer (mirrors Zig `pub fn deref(this: *Blob.Store)`) rather
    /// than `&self`: deriving the freeing `*mut` from a `&self` borrow is UB —
    /// the shared-ref provenance forbids mutation/deallocation through it.
    ///
    /// # Safety
    /// `this` must point to a live `Store` originally allocated via `Store::new`
    /// / `Box::new` (i.e. carrying mutable provenance from `Box::into_raw`), and
    /// the caller must own one outstanding reference being released.
    pub unsafe fn deref(this: NonNull<Store>) {
        // SAFETY: place-project to the atomic field without materializing a
        // `&Store`; `AtomicU32` is interior-mutable so `&AtomicU32` here is sound
        // even with concurrent refs.
        let old = unsafe { (*this.as_ptr()).ref_count.fetch_sub(1, Ordering::Relaxed) };
        debug_assert!(old >= 1);
        if old == 1 {
            // SAFETY: refcount hit zero; we are the sole remaining owner. `this`
            // carries mutable provenance from `Box::into_raw`, so reconstructing
            // the `Box` is sound. Mirrors Zig `this.deinit()` → `bun.destroy(this)`.
            drop(unsafe { Box::from_raw(this.as_ptr()) });
        }
    }

    // PORT NOTE: Zig `deinit` body became `impl Drop for Store` below. The manual
    // `allocator.free(file.pathlike.path.slice())` / `s3.deinit(allocator)` paths are
    // now handled by the owned types' own `Drop` impls.

    // TODO(b2-blocked): node::PathOrFileDescriptorSerializeTag (gated in crate::node).
    
    pub fn serialize(&self, writer: &mut impl bun_io::Write) -> Result<(), bun_core::Error> {
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

    pub fn from_array_list(list: Vec<u8>) -> Result<StoreRef, bun_core::Error> {
        Ok(Store::init(list))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// StoreRef — intrusive-refcounted handle
// ──────────────────────────────────────────────────────────────────────────

/// Owning handle to a heap `Store`, refcounted via the *intrusive*
/// `Store::ref_count` field. Mirrors Zig's `*Store` with `.ref()`/`.deref()`.
///
/// This replaces the Phase-A `Arc<Store>` placeholder. `Arc` was a UAF hazard:
/// `Store::deref()` (reachable from `Store::external` and other FFI callbacks)
/// frees via `Box::from_raw` when the intrusive count hits zero, but `Arc`
/// owns the allocation itself — so either the Arc would free an already-freed
/// box, or the intrusive count and Arc strong count would silently diverge
/// (`has_one_ref()` lying). One refcount, one deallocation path.
pub struct StoreRef {
    ptr: NonNull<Store>,
}

impl StoreRef {
    /// Adopt an existing +1 (e.g. a raw `*Store` whose refcount was already
    /// bumped for us). Does **not** increment.
    ///
    /// # Safety
    /// `ptr` must be a live `Store` allocated by `Store::new`/`Box::new`, and
    /// the caller transfers one outstanding reference into the returned handle.
    #[inline]
    pub unsafe fn adopt(ptr: NonNull<Store>) -> Self {
        Self { ptr }
    }

    /// Wrap a raw `*Store`, incrementing its intrusive refcount.
    ///
    /// # Safety
    /// `ptr` must be a live `Store` allocated by `Store::new`/`Box::new`.
    #[inline]
    pub unsafe fn retained(ptr: NonNull<Store>) -> Self {
        // SAFETY: caller contract.
        unsafe { ptr.as_ref() }.ref_();
        Self { ptr }
    }

    #[inline]
    pub fn as_ptr(&self) -> *mut Store {
        self.ptr.as_ptr()
    }

    /// Leak the held +1 and return the raw pointer. Pair with a later
    /// `Store::deref()` (typically via `Store::external` / an FFI deallocator).
    #[inline]
    pub fn into_raw(self) -> *mut Store {
        let p = self.ptr.as_ptr();
        core::mem::forget(self);
        p
    }
}

impl From<Box<Store>> for StoreRef {
    #[inline]
    fn from(b: Box<Store>) -> Self {
        // `Store::new` initializes `ref_count` to 1 — adopt that +1.
        // SAFETY: Box::into_raw never returns null.
        Self { ptr: unsafe { NonNull::new_unchecked(Box::into_raw(b)) } }
    }
}

impl Clone for StoreRef {
    #[inline]
    fn clone(&self) -> Self {
        // SAFETY: invariant — `ptr` is live while any `StoreRef` exists.
        unsafe { self.ptr.as_ref() }.ref_();
        Self { ptr: self.ptr }
    }
}

impl Drop for StoreRef {
    #[inline]
    fn drop(&mut self) {
        // SAFETY: invariant — `ptr` is live and originated from `Box::into_raw`
        // (mutable provenance); `deref()` frees on last ref.
        unsafe { Store::deref(self.ptr) };
    }
}

impl core::ops::Deref for StoreRef {
    type Target = Store;
    #[inline]
    fn deref(&self) -> &Store {
        // SAFETY: invariant — `ptr` is live while any `StoreRef` exists.
        unsafe { self.ptr.as_ref() }
    }
}

impl PartialEq for StoreRef {
    #[inline]
    fn eq(&self, other: &Self) -> bool {
        self.ptr == other.ptr
    }
}
impl Eq for StoreRef {}

// Store's refcount is atomic and its payload is either immutable-after-init or
// guarded by callers; matches Zig's cross-thread `*Store` usage.
unsafe impl Send for StoreRef {}
unsafe impl Sync for StoreRef {}

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

/// Discriminant-only tag for `Data` (Zig: `std.meta.Tag(Store.Data)`).
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum DataTag {
    Bytes,
    File,
    S3,
}

impl Data {
    #[inline]
    pub fn tag(&self) -> DataTag {
        match self {
            Self::Bytes(_) => DataTag::Bytes,
            Self::File(_) => DataTag::File,
            Self::S3(_) => DataTag::S3,
        }
    }
    /// Panics if not a `File` (Zig: `data.file` union access).
    pub fn as_file(&self) -> &File {
        match self { Self::File(f) => f, _ => unreachable!("Store.data is not .file") }
    }
    pub fn as_file_mut(&mut self) -> &mut File {
        match self { Self::File(f) => f, _ => unreachable!("Store.data is not .file") }
    }
    /// Panics if not `S3` (Zig: `data.s3` union access).
    pub fn as_s3(&self) -> &S3 {
        match self { Self::S3(s) => s, _ => unreachable!("Store.data is not .s3") }
    }
    pub fn as_s3_mut(&mut self) -> &mut S3 {
        match self { Self::S3(s) => s, _ => unreachable!("Store.data is not .s3") }
    }
    /// Panics if not `Bytes` (Zig: `data.bytes` union access).
    pub fn as_bytes(&self) -> &Bytes {
        match self { Self::Bytes(b) => b, _ => unreachable!("Store.data is not .bytes") }
    }
    pub fn as_bytes_mut(&mut self) -> &mut Bytes {
        match self { Self::Bytes(b) => b, _ => unreachable!("Store.data is not .bytes") }
    }
}

impl StoreRef {
    /// Mutable access to `data` through the shared handle.
    ///
    /// Zig mutates `store.data` freely through any holder; the caller must
    /// ensure no other `&mut` to the same `Store` is live (single-threaded
    /// JS event-loop discipline).
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub fn data_mut(&self) -> &mut Data {
        // SAFETY: Zig-semantics shared-mutable interior; see doc comment.
        unsafe { &mut (*self.as_ptr()).data }
    }
}

#[repr(u8)]
pub enum SerializeTag {
    File = 0,
    Bytes = 1,
    Empty = 2,
}

impl SerializeTag {
    #[inline]
    pub fn from_raw(raw: u8) -> Option<Self> {
        match raw {
            0 => Some(Self::File),
            1 => Some(Self::Bytes),
            2 => Some(Self::Empty),
            _ => None,
        }
    }
}

/// A blob store that references a file on disk.
#[derive(Clone)]
pub struct File {
    pub pathlike: PathOrFileDescriptor,
    pub mime_type: MimeType,
    pub is_atty: Option<bool>,
    pub mode: bun_sys::Mode,
    pub seekable: Option<bool>,
    pub max_size: SizeType,
    /// milliseconds since ECMAScript epoch
    // TODO(b2-blocked): bun_jsc::JSTimeType (= f64).
    pub last_modified: f64,
}

impl Default for File {
    fn default() -> Self {
        Self {
            pathlike: PathOrFileDescriptor::Fd(bun_sys::Fd::INVALID),
            mime_type: bun_http_types::MimeType::OTHER,
            is_atty: None,
            mode: 0,
            seekable: None,
            max_size: super::MAX_SIZE,
            // TODO(b2-blocked): bun_jsc::INIT_TIMESTAMP.
            last_modified: 0.0,
        }
    }
}

impl File {
    // TODO(b2-blocked): bun_jsc::* + crate::node::fs (gated).
    
    pub fn unlink(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        match &self.pathlike {
            PathOrFileDescriptor::Path(path_like) => {
                let encoded_slice = match path_like {
                    PathLike::EncodedSlice(slice) => slice.to_owned()?,
                    _ => ZigString::from_utf8(path_like.slice()).to_slice_clone()?,
                };
                // TODO(port): jsc.Node.fs.Async.unlink.create — second arg is `undefined` in Zig
                // SAFETY: `bun_vm()` returns the live per-global VM pointer; the
                // task is created on the JS thread that owns it.
                node_fs::async_::Unlink::create(
                    global_this,
                    /* undefined */ Default::default(),
                    node_fs::args::Unlink {
                        path: PathLike::EncodedSlice(encoded_slice),
                    },
                    unsafe { &mut *global_this.bun_vm() },
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
            // bun.isRegularFile(mode) → S_ISREG check.
            return Some(bun_core::kind_from_mode(self.mode) == bun_core::FileKind::File);
        }

        None
    }

    pub fn init(pathlike: PathOrFileDescriptor, mime_type: Option<MimeType>) -> File {
        File {
            pathlike,
            mime_type: mime_type.unwrap_or(bun_http_types::MimeType::OTHER),
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

impl S3 {
    pub fn is_seekable(&self) -> Option<bool> {
        Some(true)
    }

    pub fn get_credentials(&self) -> &Arc<S3Credentials> {
        debug_assert!(self.credentials.is_some());
        self.credentials.as_ref().unwrap()
    }

    pub fn estimated_size(&self) -> usize {
        self.pathlike.estimated_size()
            + self.credentials.as_ref().map(|c| c.estimated_size()).unwrap_or(0)
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
}

// TODO(b2-blocked): bun_jsc::* + bun_s3 — S3 JSC integration (presign/stat/unlink/
// list_objects/get_credentials_with_options/upload). All depend on JSPromise
// resolved_promise_value, JSValue methods, and the real `bun_s3` crate.

impl S3 {

    pub fn get_credentials_with_options(
        &self,
        options: Option<JSValue>,
        global_object: &JSGlobalObject,
    ) -> JsResult<S3CredentialsWithOptions> {
        let _ = (options, global_object, &self.options, self.acl, self.storage_class, self.request_payer);
        // The trait shim in `webcore/S3Client.rs` (`S3CredentialsExt`) is itself
        // `todo!()` until `s3/credentials_jsc.rs` is mounted; inlining the same
        // marker here avoids the `S3Credentials: !Clone` move-out and keeps the
        // stub→real type migration compiling.
        todo!("blocked_on: crate::webcore::s3::credentials_jsc::get_credentials_with_options")
    }

    pub fn unlink(
        &mut self,
        store: &Store,
        global_this: &JSGlobalObject,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue> {
        struct Wrapper {
            promise: bun_jsc::JSPromiseStrong,
            store: StoreRef,
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
                result: S3DeleteResult<'_>,
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
                                // SAFETY: sole `&mut JSPromise` borrow; consumed immediately.
                                unsafe { self_.promise.get() },
                            ),
                        )?;
                    }
                }
                Ok(())
            }
        }

        // PORT NOTE: Wrapper.deinit body deleted — store.deref() handled by StoreRef::drop,
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

        s3_client::delete(
            &aws_options.credentials,
            self.path(),
            Wrapper::resolve,
            Box::into_raw(Wrapper::new(Wrapper {
                promise,
                // SAFETY: `store` is a live heap `Store`; `retained` bumps the
                // intrusive refcount (Zig: `store.ref()`).
                store: unsafe { StoreRef::retained(NonNull::from(store)) },
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
            store: StoreRef,
            resolved_list_options: S3ListObjectsOptions,
            // TODO(port): lifetime — JSC_BORROW per LIFETIMES.tsv; raw pointer for heap struct.
            global: *const JSGlobalObject,
        }

        impl Wrapper {
            fn resolve(
                result: S3ListObjectsResult<'_>,
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
                                // SAFETY: sole `&mut JSPromise` borrow; consumed immediately.
                                unsafe { self_.promise.get() },
                            ),
                        )?;
                    }
                }
                Ok(())
            }
        }

        // PORT NOTE: Wrapper.deinit/destroy bodies deleted — store.deref() via StoreRef::drop,
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

        let options = s3_client::get_list_objects_options_from_js(global_this, list_options)?;

        s3_client::list_objects(
            &aws_options.credentials,
            options.clone(),
            Wrapper::resolve,
            Box::into_raw(Box::new(Wrapper {
                promise,
                // SAFETY: `store` is a live heap `Store`; `retained` bumps the
                // intrusive refcount (Zig: `store.ref()`).
                store: unsafe { StoreRef::retained(NonNull::from(store)) },
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
            mime_type: mime_type.unwrap_or(bun_http_types::MimeType::OTHER),
            ..Default::default()
        }
    }

    pub fn init(pathlike: PathLike, mime_type: Option<MimeType>, credentials: S3Credentials) -> S3 {
        S3 {
            // Zig: credentials.dupe() — heap-allocate a fresh refcounted copy.
            credentials: Some(Arc::new(credentials)),
            pathlike,
            mime_type: mime_type.unwrap_or(bun_http_types::MimeType::OTHER),
            ..Default::default()
        }
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
            stored_name: PathString::default(),
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

    pub fn to_internal_blob(&mut self) -> super::Internal {
        // PORT NOTE: reshaped — Zig manually rebuilt an ArrayList from ptr/len/cap then
        // zeroed self. With Vec<u8>, mem::take moves the buffer out and leaves an empty Vec.
        super::Internal {
            bytes: core::mem::take(&mut self.data),
            was_string: false,
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
//   notes:      Store is intrusively refcounted + crosses FFI; `StoreRef` (NonNull<Store> + ref_/deref) is the canonical handle. Bytes collapsed to Vec<u8> per TSV.
// ──────────────────────────────────────────────────────────────────────────
