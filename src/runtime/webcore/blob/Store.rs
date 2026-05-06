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
// `error_jsc` is a sub-module of the client umbrella (`client.rs` declares
// `pub mod error_jsc`); the inline `mod s3 { }` in webcore.rs does not re-export
// it directly, so reach it through `client::`.
use crate::webcore::s3::client::S3ErrorJsc as _;
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


    /// Adopt an mmap'd region — no copy. The store's `Bytes` payload owns the
    /// mapping; when the refcount drops to zero, `Bytes::drop` calls `munmap`.
    /// Mirrors Zig `Store.init(ptr[0..len], .{ .vtable = MmapFreeInterface.vtable })`.
    #[cfg(unix)]
    pub fn init_mmap(slice: &'static mut [u8]) -> StoreRef {
        StoreRef::from(Store::new(Store {
            data: Data::Bytes(Bytes::init_mmap(slice)),
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
    /// C-ABI trampoline for `bun_jsc::array_buffer::BlobArrayBuffer_deallocator` —
    /// breaks the `bun_jsc → bun_runtime` forward-dep cycle (same pattern as
    /// `Bun__Blob__Store__initFile` / `Bun__Blob__sharedView`).
    ///
    /// # Safety
    /// `this` must be non-null and satisfy [`Store::deref`]'s contract.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn Bun__Blob__Store__deref(this: *mut Store) {
        // SAFETY: caller (JSC ArrayBuffer deallocator) passes the non-null
        // `*Store` it stashed as deallocator context; that pointer carries
        // mutable provenance from `Box::into_raw` and owns one outstanding ref.
        unsafe { Store::deref(NonNull::new_unchecked(this)) };
    }

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
                        // PORT NOTE: Zig `writer.writeStruct(fd)` writes the raw
                        // bytes of the FD wrapper. `bun_io::Write` has no
                        // `write_struct`; shim it locally over the POD bytes.
                        // SAFETY: `bun_sys::Fd` is a `#[repr(C)]`/transparent
                        // integer wrapper — every bit pattern is valid `u8`.
                        let bytes = unsafe {
                            core::slice::from_raw_parts(
                                (fd as *const bun_sys::Fd).cast::<u8>(),
                                core::mem::size_of::<bun_sys::Fd>(),
                            )
                        };
                        writer.write_all(bytes)?;
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
#[repr(transparent)]
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
                // PORT NOTE: Zig `slice.toOwned()` / `toSliceClone()` are
                // fallible only on OOM; the Rust ports return the slice
                // directly (mimalloc aborts on OOM), so no `?`.
                let encoded_slice = match path_like {
                    PathLike::EncodedSlice(slice) => {
                        bun_str::ZigStringSlice::Owned(slice.slice().to_vec())
                    }
                    _ => ZigString::from_utf8(path_like.slice()).to_slice_clone(),
                };
                // Zig passes `undefined` for the `*Binding` arg (it is unused in
                // `AsyncFSTask::create`). `Binding` is an opaque ZST in
                // `node_fs.rs`; zero-init a local stand-in.
                // SAFETY: ZST — `zeroed()` produces a valid value.
                let mut binding: node_fs::Binding = unsafe { core::mem::zeroed() };
                // SAFETY: `bun_vm()` returns the live per-global VM pointer; the
                // task is created on the JS thread that owns it.
                Ok(node_fs::async_::Unlink::create(
                    global_this,
                    &mut binding,
                    node_fs::args::Unlink {
                        path: PathLike::EncodedSlice(encoded_slice),
                    },
                    unsafe { &mut *global_this.bun_vm() },
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
                let mut self_ = unsafe { Box::from_raw(opaque_self as *mut Wrapper) };
                // `defer self.deinit()` → Box drops at scope exit.
                // SAFETY: global was a valid &JSGlobalObject when the wrapper was created and
                // the VM keeps it alive for the duration of the async op.
                let global_object = unsafe { &*self_.global };
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
                            // SAFETY: sole `&mut JSPromise` borrow; consumed immediately.
                            unsafe { self_.promise.get() },
                        );
                        self_.promise.reject(global_object, err_val)?;
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
        // SAFETY: `bun_vm()` returns the live per-global VM pointer (JS thread);
        // `transpiler.env` is the process-singleton dotenv loader, never null
        // once the VM is initialised.
        let proxy_url: Option<URL<'_>> = unsafe {
            (*(*global_this.bun_vm()).transpiler.env).get_http_proxy(true, None, None)
        };
        let proxy = proxy_url.as_ref().map(|url| url.href);
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
            return Err(global_this.throw_invalid_arguments(
                "S3Client.listObjects() needs a S3ListObjectsOption as it's first argument",
            ));
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
                let mut self_ = unsafe { Box::from_raw(opaque_self as *mut Wrapper) };
                // `defer self.deinit()` → Box drops at scope exit.
                // SAFETY: global was a valid &JSGlobalObject when the wrapper was created.
                let global_object = unsafe { &*self_.global };

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
                            // SAFETY: sole `&mut JSPromise` borrow; consumed immediately.
                            unsafe { self_.promise.get() },
                        );
                        self_.promise.reject(global_object, err_val)?;
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
        // SAFETY: `bun_vm()` returns the live per-global VM pointer (JS thread);
        // `transpiler.env` is the process-singleton dotenv loader, never null
        // once the VM is initialised.
        let proxy_url: Option<URL<'_>> = unsafe {
            (*(*global_this.bun_vm()).transpiler.env).get_http_proxy(true, None, None)
        };
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
        let wrapper = Box::into_raw(Box::new(Wrapper {
            promise,
            // SAFETY: `store` is a live heap `Store`; `retained` bumps the
            // intrusive refcount (Zig: `store.ref()`).
            store: unsafe { StoreRef::retained(NonNull::from(store)) },
            resolved_list_options: options,
            global: global_this as *const _,
        }));

        s3_client::list_objects(
            &aws_options.credentials,
            // SAFETY: `wrapper` is freshly leaked and untouched until the
            // callback; this borrow ends before any other access.
            unsafe { &(*wrapper).resolved_list_options },
            Wrapper::resolve,
            wrapper as *mut c_void,
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
            options: MultiPartUploadOptions::default(),
            acl: None,
            storage_class: None,
            request_payer: false,
        }
    }

    pub fn init(pathlike: PathLike, mime_type: Option<MimeType>, credentials: S3Credentials) -> S3 {
        S3 {
            // Zig: credentials.dupe() — heap-allocate a fresh refcounted copy.
            credentials: Some(Arc::new(credentials)),
            pathlike,
            mime_type: mime_type.unwrap_or(bun_http_types::MimeType::OTHER),
            options: MultiPartUploadOptions::default(),
            acl: None,
            storage_class: None,
            request_payer: false,
        }
    }

}

// PORT NOTE: S3.deinit deleted — body only freed owned fields (pathlike, credentials.deref()),
// all handled by PathLike::drop / Option<Arc<_>>::drop. Per PORTING.md §Idiom map, no explicit
// `impl Drop` needed.
// TODO(port): verify PathLike owns its `.string` storage so the manual
// `allocator.free(@constCast(this.pathlike.slice()))` path from Zig deinit is covered.

/// Port of `Blob.Store.Bytes` (Zig: `ptr/len/cap/allocator/stored_name`).
///
/// PORT NOTE: an earlier pass collapsed this to `Vec<u8>`, but that cannot
/// represent the memfd-backed path (`LinuxMemFdAllocator::create` hands back an
/// `mmap`'d region whose `free` is `munmap`, not heap `free`). Restored to the
/// Zig shape so the allocator vtable travels with the buffer; the common case
/// (`init(Vec<u8>)`) stores the global mimalloc allocator and round-trips back
/// to `Vec<u8>` in [`Bytes::to_internal_blob`].
pub struct Bytes {
    ptr: Option<NonNull<u8>>,
    len: SizeType,
    cap: SizeType,
    allocator: bun_alloc::StdAllocator,

    /// Used by standalone module graph and the File constructor
    pub stored_name: PathString,
}

// SAFETY: `Bytes` is morally `Vec<u8>`-with-custom-free. The raw `NonNull<u8>`
// is uniquely owned (Zig: `ptr` is the sole alias) and `StdAllocator` is
// `Send + Sync` (its vtable dispatch is the implementor's thread-safety
// concern, same as Zig). Restores the auto-traits the previous `Vec<u8>` field
// provided.
unsafe impl Send for Bytes {}
unsafe impl Sync for Bytes {}

impl Default for Bytes {
    fn default() -> Self {
        Self {
            ptr: None,
            len: 0,
            cap: 0,
            allocator: bun_alloc::basic::C_ALLOCATOR,
            stored_name: PathString::default(),
        }
    }
}

impl Bytes {
    /// Takes ownership of `bytes` (allocated by the global mimalloc allocator).
    pub fn init(bytes: Vec<u8>) -> Bytes {
        let mut v = core::mem::ManuallyDrop::new(bytes);
        let len = v.len();
        let cap = v.capacity();
        Bytes {
            ptr: NonNull::new(v.as_mut_ptr()),
            // Zig: `@truncate(bytes.len)` for both — we additionally keep the
            // real `cap` so `to_internal_blob` can soundly `Vec::from_raw_parts`.
            len: len as SizeType,
            cap: cap as SizeType,
            allocator: bun_alloc::basic::C_ALLOCATOR,
            stored_name: PathString::default(),
        }
    }

    /// Construct from a raw `(ptr, len, cap)` triple owned by `allocator`.
    ///
    /// # Safety
    /// `ptr[..cap]` must be a live allocation owned by `allocator`'s vtable
    /// (i.e. `(allocator.vtable.free)(allocator.ptr, ptr[..cap], …)` is the
    /// correct release), and `len <= cap`. Ownership transfers to the returned
    /// `Bytes`; the caller must not free `ptr` afterwards.
    pub unsafe fn from_raw_parts(
        ptr: *mut u8,
        len: SizeType,
        cap: SizeType,
        allocator: bun_alloc::StdAllocator,
    ) -> Bytes {
        Bytes {
            ptr: NonNull::new(ptr),
            len,
            cap,
            allocator,
            stored_name: PathString::default(),
        }
    }

    pub fn init_empty_with_name(name: PathString) -> Bytes {
        Bytes {
            ptr: None,
            len: 0,
            cap: 0,
            allocator: bun_alloc::basic::C_ALLOCATOR,
            stored_name: name,
        }
    }

    pub fn from_array_list(list: Vec<u8>) -> Result<Bytes, bun_core::Error> {
        // TODO(port): Zig signature returns `!*Bytes` but body returns `Bytes` by value —
        // mirroring the by-value return here.
        Ok(Bytes::init(list))
    }

    /// The allocator that owns `ptr[..cap]` (Zig: `this.allocator`).
    #[inline]
    pub fn allocator(&self) -> bun_alloc::StdAllocator {
        self.allocator
    }

    pub fn to_internal_blob(&mut self) -> super::Internal {
        // Zig built an `array_list.Managed(u8)` over the same allocator and
        // zeroed self. `Internal.bytes` is `Vec<u8>` (global allocator), so
        // round-trip only when the storage *is* the global allocator; otherwise
        // copy + free through the original allocator (e.g. memfd → munmap).
        let bytes = match self.ptr.take() {
            None => Vec::new(),
            Some(ptr) => {
                let len = self.len as usize;
                let cap = self.cap as usize;
                if core::ptr::eq(
                    self.allocator.vtable as *const _,
                    bun_alloc::basic::C_ALLOCATOR.vtable as *const _,
                ) {
                    // SAFETY: `init(Vec<u8>)` is the only path that stores
                    // `C_ALLOCATOR`, and it recorded the exact `(ptr, len, cap)`
                    // from `Vec::into_raw_parts`-equivalent decomposition.
                    unsafe { Vec::from_raw_parts(ptr.as_ptr(), len, cap) }
                } else {
                    // SAFETY: `ptr[..len]` is a live initialized region per the
                    // `from_raw_parts` contract; freed via its own allocator below.
                    let copy = unsafe { core::slice::from_raw_parts(ptr.as_ptr(), len) }.to_vec();
                    // SAFETY: releasing the `ptr[..cap]` allocation through the
                    // vtable that owns it (e.g. `LinuxMemFdAllocator` → munmap).
                    let buf = unsafe { core::slice::from_raw_parts_mut(ptr.as_ptr(), cap) };
                    self.allocator.raw_free(buf, bun_alloc::Alignment::of::<u8>(), 0);
                    copy
                }
            }
        };
        self.len = 0;
        self.cap = 0;
        self.allocator = bun_alloc::basic::C_ALLOCATOR;
        super::Internal { bytes, was_string: false }
    }

    #[inline]
    pub fn len(&self) -> SizeType {
        self.len
    }

    pub fn slice(&self) -> &[u8] {
        match self.ptr {
            // SAFETY: `ptr[..len]` is a live initialized region (init/from_raw_parts contract).
            Some(p) => unsafe { core::slice::from_raw_parts(p.as_ptr(), self.len as usize) },
            None => &[],
        }
    }

    pub fn allocated_slice(&self) -> &[u8] {
        match self.ptr {
            // SAFETY: `ptr[..cap]` is the full allocation; bytes in `[len..cap]`
            // may be uninitialized. Mirrors Zig `ptr[0..this.cap]` (same caveat).
            Some(p) => unsafe { core::slice::from_raw_parts(p.as_ptr(), self.cap as usize) },
            None => &[],
        }
    }

    pub fn as_array_list(&mut self) -> &mut [u8] {
        self.as_array_list_leak()
    }

    pub fn as_array_list_leak(&mut self) -> &mut [u8] {
        // Zig returned an `ArrayListUnmanaged{ items=ptr[0..len], capacity=cap }`
        // view without transferring ownership. The sole caller only needs
        // `as_mut_ptr()`/`len()`, both of which `&mut [u8]` provides.
        match self.ptr {
            // SAFETY: `ptr[..len]` is live and uniquely owned by `*self`.
            Some(p) => unsafe { core::slice::from_raw_parts_mut(p.as_ptr(), self.len as usize) },
            None => &mut [],
        }
    }
}

impl Drop for Bytes {
    fn drop(&mut self) {
        // Zig `deinit`: `default_allocator.free(stored_name.slice())` then
        // `this.allocator.free(ptr[0..cap])`. `stored_name` drops itself.
        if let Some(ptr) = self.ptr.take() {
            // SAFETY: `ptr[..cap]` is the allocation owned by `self.allocator`;
            // sole owner at drop time. Reconstructing the slice only for the
            // vtable signature (callee treats it as opaque ptr+len).
            let buf = unsafe { core::slice::from_raw_parts_mut(ptr.as_ptr(), self.cap as usize) };
            self.allocator.raw_free(buf, bun_alloc::Alignment::of::<u8>(), 0);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/blob/Store.zig (577 lines)
//   confidence: medium
//   todos:      13
//   notes:      Store is intrusively refcounted + crosses FFI; `StoreRef` (NonNull<Store> + ref_/deref) is the canonical handle. Bytes collapsed to Vec<u8> per TSV.
// ──────────────────────────────────────────────────────────────────────────
