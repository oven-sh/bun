//! Core `webcore` data types — `Blob`, `Blob::Store` and friends.
//!
//! LAYERING: these are the **single nominal definitions**. `bun_runtime::webcore`
//! re-exports them and layers behaviour (S3 I/O, streaming, JS host-fns) on
//! top via extension traits / inherent impls in that crate. Defining the data
//! shapes here lets lower-tier crates (`bun_bundler_jsc`, `bun_http_jsc`,
//! `bun_sql_jsc`) construct/read Blobs without a `bun_runtime` forward-dep.
//!
//! Ported from `src/runtime/webcore/Blob.zig` (struct fields + `init`/
//! `initWithStore`/`sharedView`/`dupe`/`detach`/`deinit`) and
//! `src/runtime/webcore/blob/Store.zig` (`Store`/`Data`/`Bytes`/`File`/`S3`/
//! `init`/`initFile`/`ref`/`deref`/`sharedView`). Everything that touches the
//! event loop / fs / network stays in `bun_runtime`.

use core::ptr::NonNull;
use core::sync::atomic::{AtomicU32, Ordering};

use bun_http::MimeType::{self as mime, MimeType};
use bun_string::{strings::AsciiStatus, PathString};

use crate::node_path::{PathLike, PathOrFileDescriptor};
use crate::{JSGlobalObject, JSTimeType, JSValue, JsClass, INIT_TIMESTAMP};

/// `webcore.Blob.SizeType` (Blob.zig:60) — Zig `u52`; widened to `u64` here
/// (Rust has no native `u52`). Values are masked to 52 bits at the boundary.
pub type SizeType = u64;
/// `webcore.Blob.max_size` (Blob.zig:61) — `std.math.maxInt(u52)`.
pub const MAX_SIZE: SizeType = (1u64 << 52) - 1;

// ──────────────────────────────────────────────────────────────────────────
// Blob
// ──────────────────────────────────────────────────────────────────────────

/// `webcore.Blob` (src/runtime/webcore/Blob.zig:7-52). Field order mirrors the
/// Zig declaration so `Blob__create`'s `m_ctx` round-trips between this crate
/// and `bun_runtime` without layout drift.
#[repr(C)]
pub struct Blob {
    pub reported_estimated_size: usize,
    pub size: SizeType,
    pub offset: SizeType,
    /// Intrusively-refcounted backing store (one ref owned by this `Blob`).
    pub store: Option<NonNull<Store>>,
    /// Borrowed when `!content_type_allocated`; heap-owned (via mimalloc) when
    /// `content_type_allocated` is set. Freed in `Drop`.
    pub content_type: &'static [u8],
    pub content_type_allocated: bool,
    pub content_type_was_set: bool,
    /// Cached encoding probe of `shared_view()`.
    pub charset: AsciiStatus,
    pub is_jsdom_file: bool,
    /// `bun.ptr.RawRefCount(u32, .single_threaded)` — counts in-flight
    /// `*Blob` borrows handed to async readers; not the JS GC retain count.
    /// Zero while the JS cell is the sole owner (Blob.zig:44).
    ref_count: u32,
    pub global_this: *const JSGlobalObject,
    pub last_modified: f64,
    /// Only used by `<input type="file">` / `File` (issue #10178).
    pub name: bun_string::String,
}

// SAFETY: `Blob` is moved across threads via `WorkPoolTask`s in Zig; the
// store's atomic refcount and the `to_thread_safe()` path-string promotion
// uphold the invariants. Matches the Zig spec which freely sends `*Blob`.
unsafe impl Send for Blob {}

impl Default for Blob {
    fn default() -> Self {
        Self {
            reported_estimated_size: 0,
            size: 0,
            offset: 0,
            store: None,
            content_type: b"",
            content_type_allocated: false,
            content_type_was_set: false,
            charset: AsciiStatus::Unknown,
            is_jsdom_file: false,
            ref_count: 0,
            global_this: core::ptr::null(),
            last_modified: 0.0,
            name: bun_string::String::dead(),
        }
    }
}

// Codegen externs (build/debug/codegen/ZigGeneratedClasses.cpp `JSBlob`) — C++
// symbols, not Rust, so declaring them here is a normal FFI binding.
// TODO(port): jsc.conv ABI — `extern "sysv64"` on windows-x64.
unsafe extern "C" {
    fn Blob__fromJS(value: JSValue) -> Option<NonNull<Blob>>;
    fn Blob__fromJSDirect(value: JSValue) -> Option<NonNull<Blob>>;
    fn Blob__create(ptr: *mut Blob, global: *mut JSGlobalObject) -> JSValue;
    fn Blob__getConstructor(global: *mut JSGlobalObject) -> JSValue;
}

impl JsClass for Blob {
    fn from_js(value: JSValue) -> Option<*mut Self> {
        // SAFETY: codegen extern; `value` is a valid JSValue by contract.
        unsafe { Blob__fromJS(value) }.map(|p| p.as_ptr())
    }
    fn from_js_direct(value: JSValue) -> Option<*mut Self> {
        // SAFETY: caller checked `is_cell()`.
        unsafe { Blob__fromJSDirect(value) }.map(|p| p.as_ptr())
    }
    fn to_js(self, global: &JSGlobalObject) -> JSValue {
        // `Blob.toJS` (Blob.zig:3686-3706, simplified): heap-promote and hand
        // the pointer to the codegen `Blob__create` extern. The S3File
        // fast-path (different JS wrapper) is layered on by
        // `bun_runtime::webcore::Blob::to_js` for S3-backed blobs; lower-tier
        // callers never construct S3 blobs so this is sufficient here.
        let boxed = Box::into_raw(Blob::new(self));
        // SAFETY: codegen extern takes ownership of `boxed` and wraps it in a
        // `JSBlob`; freed via `Blob::finalize` → `Drop`.
        unsafe { Blob__create(boxed, global.as_mut_ptr()) }
    }
    fn get_constructor(global: &JSGlobalObject) -> JSValue {
        // SAFETY: `global` is live; codegen extern returns the cached ctor.
        unsafe { Blob__getConstructor(global.as_mut_ptr()) }
    }
}

impl Blob {
    /// `bun.TrivialNew(@This())` (Blob.zig:16) — heap-promote and mark as
    /// heap-allocated so `Drop` knows to `bun.destroy(self)`.
    #[inline]
    pub fn new(mut blob: Blob) -> Box<Blob> {
        blob.ref_count = 1;
        Box::new(blob)
    }

    /// `Blob.init(bytes, allocator, globalThis)` (Blob.zig:3576). Takes
    /// ownership of `bytes`.
    pub fn init(bytes: Vec<u8>, global_this: &JSGlobalObject) -> Blob {
        let size = bytes.len() as SizeType;
        let store = if !bytes.is_empty() {
            // SAFETY: `Box::into_raw` never returns null. Ownership is the +1
            // initial ref released via `Store::deref` → `Box::from_raw`.
            Some(unsafe { NonNull::new_unchecked(Box::into_raw(Store::init(bytes))) })
        } else {
            None
        };
        Blob { size, store, global_this, ..Default::default() }
    }

    /// `Blob.initWithStore(store, globalThis)` (Blob.zig:3649).
    pub fn init_with_store(store: NonNull<Store>, global_this: &JSGlobalObject) -> Blob {
        // SAFETY: caller hands over a +1 reference to a live `Store`.
        let store_ref = unsafe { store.as_ref() };
        Blob {
            size: store_ref.size(),
            store: Some(store),
            content_type: match &store_ref.data {
                // File mime types are populated from the static extension table
                // (`mime::by_extension_no_default` / const items), so `value`
                // is always `Cow::Borrowed(&'static [u8])`. Owned variants
                // (parsed from a request header) never reach `init_with_store`.
                store::Data::File(f) => match &f.mime_type.value {
                    std::borrow::Cow::Borrowed(s) => *s,
                    std::borrow::Cow::Owned(_) => b"",
                },
                _ => b"",
            },
            global_this,
            ..Default::default()
        }
    }

    /// `Blob.initEmpty(globalThis)` (Blob.zig:3660).
    #[inline]
    pub fn init_empty(global_this: &JSGlobalObject) -> Blob {
        Blob { global_this, ..Default::default() }
    }

    /// `Blob.sharedView()` (Blob.zig:3737) — borrowed view of the in-memory
    /// bytes (`offset..offset+size` of the backing store). Empty for
    /// file-/S3-backed or zero-length blobs.
    pub fn shared_view(&self) -> &[u8] {
        if self.size == 0 {
            return b"";
        }
        let Some(store) = self.store else { return b"" };
        // SAFETY: `self` holds a +1 ref on `store` for the lifetime of `&self`.
        let slice = unsafe { store.as_ref() }.shared_view();
        if slice.is_empty() {
            return b"";
        }
        // Defensive: `offset`/`size` may originate from untrusted
        // structured-clone data; never index past the store's length.
        let off = (self.offset as usize).min(slice.len());
        let tail = &slice[off..];
        &tail[..tail.len().min(self.size as usize)]
    }

    /// `Blob.detach()` (Blob.zig:3675) — release the store ref without
    /// dropping `self`.
    pub fn detach(&mut self) {
        if let Some(store) = self.store.take() {
            // SAFETY: `self` owned a +1 ref on `store`.
            unsafe { Store::deref(store) };
        }
    }

    /// `Blob.dupe()` (Blob.zig:3684) — new view onto the same store, +1 ref.
    /// Does **not** clone `content_type` (heap-allocated content types become
    /// borrowed in the duplicate, matching `dupeWithContentType(false)`).
    pub fn dupe(&self) -> Blob {
        if let Some(store) = self.store {
            // SAFETY: `self` proves `store` is live.
            unsafe { store.as_ref() }.ref_();
        }
        Blob {
            reported_estimated_size: self.reported_estimated_size,
            size: self.size,
            offset: self.offset,
            store: self.store,
            content_type: self.content_type,
            // Duplicate borrows the original's content_type allocation; the
            // original retains ownership (`content_type_allocated` stays
            // `false` here so `Drop` doesn't double-free).
            content_type_allocated: false,
            content_type_was_set: self.content_type_was_set,
            charset: self.charset,
            is_jsdom_file: self.is_jsdom_file,
            ref_count: 0,
            global_this: self.global_this,
            last_modified: self.last_modified,
            name: {
                self.name.ref_();
                self.name
            },
        }
    }

    /// Inherent `to_js` so callers don't need `JsClass` in scope.
    #[inline]
    pub fn to_js(self, global: &JSGlobalObject) -> JSValue {
        <Self as JsClass>::to_js(self, global)
    }

    #[inline]
    pub fn is_heap_allocated(&self) -> bool {
        self.ref_count > 0
    }

    #[inline]
    pub fn set_not_heap_allocated(&mut self) {
        self.ref_count = 0;
    }
}

impl Drop for Blob {
    /// `Blob.deinit` (Blob.zig:3720) sans the trailing `bun.destroy(this)` —
    /// `Box::drop` handles the allocation when `is_heap_allocated()`.
    fn drop(&mut self) {
        self.detach();
        self.name.deref();
        if self.content_type_allocated {
            // SAFETY: `content_type` was duped via mimalloc when
            // `content_type_allocated` was set; free with the same allocator.
            unsafe {
                bun_alloc::default_free(
                    self.content_type.as_ptr() as *mut u8,
                    self.content_type.len(),
                );
            }
            self.content_type = b"";
            self.content_type_allocated = false;
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Store (Blob.zig:11 → blob/Store.zig)
// ──────────────────────────────────────────────────────────────────────────

pub mod store {
    use super::*;

    /// `Blob.Store` (Store.zig:1-9). Intrusively-refcounted; always
    /// heap-allocated (`bun.TrivialNew`).
    #[repr(C)]
    pub struct Store {
        pub data: Data,
        pub mime_type: MimeType,
        pub ref_count: AtomicU32,
        pub is_all_ascii: Option<bool>,
        // PORT NOTE: `allocator: std.mem.Allocator` field dropped — global
        // mimalloc everywhere (PORTING.md §Allocators).
    }

    impl Default for Store {
        fn default() -> Self {
            Self {
                data: Data::Bytes(Bytes::default()),
                mime_type: mime::NONE,
                ref_count: AtomicU32::new(1),
                is_all_ascii: None,
            }
        }
    }

    /// `Store.Data` (Store.zig:37) — `union(enum) { bytes, file, s3 }`.
    pub enum Data {
        Bytes(Bytes),
        File(File),
        S3(S3),
    }

    /// `Store.Bytes` (Store.zig:472) — raw owned byte buffer.
    #[derive(Default)]
    pub struct Bytes {
        /// (`ptr`, `len`, `cap`) — kept as `Vec<u8>` so capacity is preserved
        /// for `toInternalBlob`/`asArrayList`. Allocated via mimalloc.
        pub bytes: Vec<u8>,
        /// Used by standalone module graph and the `File` constructor.
        pub stored_name: PathString,
    }

    impl Bytes {
        /// Takes ownership of `bytes`.
        #[inline]
        pub fn init(bytes: Vec<u8>) -> Bytes {
            Bytes { bytes, stored_name: PathString::empty() }
        }
        #[inline]
        pub fn init_empty_with_name(name: PathString) -> Bytes {
            Bytes { bytes: Vec::new(), stored_name: name }
        }
        #[inline]
        pub fn slice(&self) -> &[u8] {
            &self.bytes
        }
        #[inline]
        pub fn len(&self) -> SizeType {
            self.bytes.len() as SizeType
        }
    }

    impl Drop for Bytes {
        fn drop(&mut self) {
            // `bun.default_allocator.free(this.stored_name.slice())` — the
            // `PathString` borrows a heap dupe owned by this `Bytes`.
            // SAFETY: `stored_name` was set via `PathString::init_owned`
            // (mimalloc dupe) or is `empty()` (no-op).
            unsafe { self.stored_name.deinit_owned() };
            // `bytes: Vec` drops itself.
        }
    }

    /// `Store.File` (Store.zig:250) — a blob store referencing a file on disk.
    pub struct File {
        pub pathlike: PathOrFileDescriptor,
        pub mime_type: MimeType,
        pub is_atty: Option<bool>,
        pub mode: bun_sys::Mode,
        pub seekable: Option<bool>,
        pub max_size: SizeType,
        /// Milliseconds since ECMAScript epoch.
        pub last_modified: JSTimeType,
    }

    impl File {
        #[inline]
        pub fn init(pathlike: PathOrFileDescriptor, mime_type: Option<MimeType>) -> File {
            File {
                pathlike,
                mime_type: mime_type.unwrap_or(mime::OTHER),
                is_atty: None,
                mode: 0,
                seekable: None,
                max_size: MAX_SIZE,
                last_modified: INIT_TIMESTAMP,
            }
        }

        #[inline]
        pub fn is_seekable(&self) -> Option<bool> {
            if let Some(s) = self.seekable {
                return Some(s);
            }
            if self.mode != 0 {
                return Some(bun_sys::is_regular_file(self.mode));
            }
            None
        }
    }

    /// `Store.S3` (Store.zig:291) — an S3 blob store. Data-only at this tier;
    /// I/O methods (`unlink`/`stat`/`listObjects`/`getCredentialsWithOptions`)
    /// live in `bun_runtime` because they reach the HTTP client / event loop.
    pub struct S3 {
        pub pathlike: PathLike,
        pub mime_type: MimeType,
        pub credentials: Option<NonNull<bun_s3_signing::credentials::S3Credentials>>,
        pub options: bun_s3_signing::credentials::MultiPartUploadOptions,
        pub acl: Option<bun_s3_signing::ACL>,
        pub storage_class: Option<bun_s3_signing::StorageClass>,
        pub request_payer: bool,
    }

    impl S3 {
        #[inline]
        pub fn is_seekable(&self) -> Option<bool> {
            Some(true)
        }

        pub fn estimated_size(&self) -> usize {
            self.pathlike.estimated_size()
                + self
                    .credentials
                    // SAFETY: `credentials` is null or a live ref-counted ptr
                    // owned by this S3 (released in `bun_runtime`'s `deinit`).
                    .map(|c| unsafe { c.as_ref() }.estimated_size())
                    .unwrap_or(0)
        }
    }

    impl Store {
        /// `bun.TrivialNew(@This())`.
        #[inline]
        pub fn new(init: Store) -> Box<Store> {
            Box::new(init)
        }

        /// `Store.init(bytes, allocator)` (Store.zig:152). Takes ownership of
        /// `bytes`. Returns a +1-ref heap `Store`.
        pub fn init(bytes: Vec<u8>) -> Box<Store> {
            Store::new(Store {
                data: Data::Bytes(Bytes::init(bytes)),
                mime_type: mime::NONE,
                ref_count: AtomicU32::new(1),
                is_all_ascii: None,
            })
        }

        /// `Store.initFile(pathlike, mime_type, allocator)` (Store.zig:125).
        pub fn init_file(
            pathlike: PathOrFileDescriptor,
            mime_type: Option<MimeType>,
        ) -> Result<NonNull<Store>, bun_core::AllocError> {
            let mime_type = mime_type.or_else(|| match &pathlike {
                PathOrFileDescriptor::Path(path) => {
                    let sliced = path.slice();
                    if sliced.is_empty() {
                        return None;
                    }
                    let ext = bun_paths::extension(sliced);
                    let ext = ext.strip_prefix(b".").unwrap_or(ext);
                    mime::by_extension_no_default(ext)
                }
                PathOrFileDescriptor::Fd(_) => None,
            });
            let store = Store::new(Store {
                data: Data::File(File::init(pathlike, mime_type)),
                mime_type: mime::NONE,
                ref_count: AtomicU32::new(1),
                is_all_ascii: None,
            });
            // SAFETY: `Box::into_raw` never returns null. Paired with
            // `Box::from_raw` in `Store::deref` on last-ref.
            Ok(unsafe { NonNull::new_unchecked(Box::into_raw(store)) })
        }

        /// `Store.mime_type` setter — replaces the in-tree
        /// `Bun__Blob__Store__setMimeType` trampoline.
        #[inline]
        pub fn set_mime_type(&mut self, mime: MimeType) {
            self.mime_type = mime;
        }

        /// `Store.size()` (Store.zig:28).
        #[inline]
        pub fn size(&self) -> SizeType {
            match &self.data {
                Data::Bytes(b) => b.len(),
                Data::File(_) | Data::S3(_) => MAX_SIZE,
            }
        }

        /// `Store.sharedView()` (Store.zig:164).
        #[inline]
        pub fn shared_view(&self) -> &[u8] {
            match &self.data {
                Data::Bytes(b) => b.slice(),
                _ => b"",
            }
        }

        /// `Store.ref()` (Store.zig:43).
        #[inline]
        pub fn ref_(&self) {
            let old = self.ref_count.fetch_add(1, Ordering::Relaxed);
            debug_assert!(old > 0);
        }

        /// `Store.hasOneRef()` (Store.zig:48).
        #[inline]
        pub fn has_one_ref(&self) -> bool {
            self.ref_count.load(Ordering::Relaxed) == 1
        }

        /// `Store.deref()` (Store.zig:171). Consumes one reference; on last
        /// ref, drops & frees the heap `Store` (which was created via
        /// `Box::into_raw` in `init`/`init_file`/`new`).
        ///
        /// # Safety
        /// `this` must be a +1-ref pointer obtained from `Store::new`/`init`/
        /// `init_file` (i.e. a `Box::into_raw`).
        pub unsafe fn deref(this: NonNull<Store>) {
            // SAFETY: caller upheld contract; `ref_count` is atomic so the
            // shared-borrow read is sound even under concurrent `ref_`.
            let old = unsafe { this.as_ref() }.ref_count.fetch_sub(1, Ordering::AcqRel);
            debug_assert!(old >= 1);
            if old == 1 {
                // SAFETY: last ref; reconstitute the Box to drop+free.
                drop(unsafe { Box::from_raw(this.as_ptr()) });
            }
        }

        /// `extern "C" fn external` (Store.zig:63) — `JSCArrayBuffer`
        /// deallocator hook signature.
        #[unsafe(no_mangle)]
        pub extern "C" fn Blob__Store__external(
            ptr: *mut core::ffi::c_void,
            _: *mut core::ffi::c_void,
            _: usize,
        ) {
            let Some(this) = NonNull::new(ptr.cast::<Store>()) else { return };
            // SAFETY: C++ passes the `Store*` it was handed by
            // `BlobArrayBuffer_deallocator`'s context; that path always owns
            // a +1 ref.
            unsafe { Store::deref(this) };
        }
    }

    impl Drop for Store {
        /// `Store.deinit()` (Store.zig:179) sans the trailing `bun.destroy` —
        /// `Box` handles the allocation.
        fn drop(&mut self) {
            match &mut self.data {
                Data::Bytes(_) => { /* Bytes::drop frees buffer + stored_name */ }
                Data::File(file) => {
                    if let PathOrFileDescriptor::Path(path) = &mut file.pathlike {
                        if let PathLike::String(s) = path {
                            // Zig: `allocator.free(@constCast(path.slice()))` —
                            // the `PathString` payload was duped for this Store.
                            // SAFETY: duped via mimalloc by the constructing
                            // call site (e.g. `dupe_path`); `deinit_owned`
                            // no-ops on empty.
                            unsafe { s.deinit_owned() };
                        }
                        // Other `PathLike` variants drop themselves.
                    }
                }
                Data::S3(s3) => {
                    // `s3.deinit(allocator)` releases the credentials ref and
                    // frees the pathlike — both live in `bun_runtime`'s S3
                    // extension impl. The data-only fields (`pathlike`,
                    // `options`) drop normally; `credentials` is released by
                    // the extension `deinit` because `S3Credentials` is
                    // intrusively ref-counted at the higher tier.
                    if let Some(creds) = s3.credentials.take() {
                        // SAFETY: `credentials` is a +1 ref this S3 owned.
                        unsafe {
                            bun_ptr::RefCount::<
                                bun_s3_signing::credentials::S3Credentials,
                            >::deref(creds.as_ptr());
                        }
                    }
                }
            }
        }
    }
}
pub use store::Store;

// ──────────────────────────────────────────────────────────────────────────
// `jsc.API.BuildArtifact` (src/runtime/api/JSBundler.zig:1786)
// ──────────────────────────────────────────────────────────────────────────

/// Single nominal definition; `bun_runtime::api::BuildArtifact` re-exports this.
#[repr(C)]
pub struct BuildArtifact {
    pub blob: Blob,
    pub loader: bun_bundler::options::Loader,
    pub path: Box<[u8]>,
    pub hash: u64,
    pub output_kind: bun_bundler::options::OutputKind,
    pub sourcemap: crate::strong::Optional,
}

impl Default for BuildArtifact {
    fn default() -> Self {
        Self {
            blob: Blob::default(),
            loader: bun_bundler::options::Loader::File,
            path: Box::default(),
            hash: u64::MAX,
            output_kind: bun_bundler::options::OutputKind::Chunk,
            sourcemap: crate::strong::Optional::default(),
        }
    }
}

unsafe extern "C" {
    fn BuildArtifact__create(ptr: *mut BuildArtifact, global: *mut JSGlobalObject) -> JSValue;
}

impl BuildArtifact {
    /// `BuildArtifact.toJS` (codegen `JSBuildArtifact.toJS`). Heap-promotes
    /// `self` and hands ownership to the codegen `BuildArtifact__create` extern.
    pub fn to_js(self: Box<Self>, global: &JSGlobalObject) -> JSValue {
        // SAFETY: codegen extern takes ownership of the boxed artifact and
        // wraps it in a `JSBuildArtifact`.
        unsafe { BuildArtifact__create(Box::into_raw(self), global.as_mut_ptr()) }
    }
}
