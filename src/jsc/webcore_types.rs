//! Core `webcore` data types — `Blob`, `Blob::Store`.
//!
//! LAYERING: these are the **single nominal definitions**. `bun_runtime::webcore`
//! re-exports them (`pub use bun_jsc::webcore_types::*`) and layers behaviour
//! (S3 I/O, streaming, JS host-fns, async readers) on top via the `BlobExt` /
//! `StoreExt` / … extension traits in that crate. Defining the data shapes here
//! lets lower-tier crates (`bun_http_jsc`, `bun_sql_jsc`) downcast a `JSValue`
//! to `*mut Blob` and read its bytes without a `bun_runtime` forward-dep.
//!
//! Everything that touches the
//! event loop / fs / network stays in `bun_runtime`.
//!
//! `BuildArtifact` is **not** hoisted here: its `#[host_fn]`-decorated accessors
//! must live in an inherent `impl` (the macro emits a sibling shim referencing
//! `Self`), and those accessors call `BlobExt` methods. With no lower-tier
//! consumer, the canonical `BuildArtifact` stays in `bun_runtime::api`.

use core::cell::Cell;
use core::ptr::NonNull;
// (atomic refcounting now via `bun_ptr::ThreadSafeRefCount`)
use std::rc::Rc;

use bun_core::strings::AsciiStatus;
use bun_http_types::MimeType::MimeType;

use crate::JsCell;

use crate::node_path::{PathLike, PathOrFileDescriptor};
use crate::{JSGlobalObject, JSValue, JsClass};

/// Blob size type. Values are masked to 52 bits at the boundary.
pub type SizeType = u64;
/// Maximum blob size (52 bits).
pub const MAX_SIZE: SizeType = (1u64 << 52) - 1;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ClosingState {
    Running,
    Closing,
}

/// A Blob's `type` string with ownership encoded in the variant, so assigning
/// a new value drops the old one and a static pointer can never be freed.
/// `Owned` is `Arc` so `clone()` just bumps a refcount.
#[derive(Clone)]
pub enum BlobContentType {
    Static(&'static [u8]),
    Owned(std::sync::Arc<[u8]>),
}

impl Default for BlobContentType {
    #[inline]
    fn default() -> Self {
        Self::Static(b"")
    }
}

impl BlobContentType {
    #[inline]
    pub fn as_slice(&self) -> &[u8] {
        match self {
            Self::Static(s) => s,
            Self::Owned(b) => b,
        }
    }

    #[inline]
    pub fn is_empty(&self) -> bool {
        self.as_slice().is_empty()
    }

    #[inline]
    pub fn is_owned(&self) -> bool {
        matches!(self, Self::Owned(_))
    }

    /// Borrow a `MimeType`'s value: `'static` stays static, `Owned` is copied.
    #[inline]
    pub fn from_mime(mime: &MimeType) -> Self {
        match &mime.value {
            std::borrow::Cow::Borrowed(s) => Self::Static(s),
            std::borrow::Cow::Owned(v) => Self::Owned(std::sync::Arc::from(v.as_slice())),
        }
    }

    /// Heap-owned ASCII-lowercased copy of `slice`.
    #[inline]
    pub fn from_lowercased(slice: &[u8]) -> Self {
        let mut buf = vec![0u8; slice.len()];
        bun_core::strings::copy_lowercase(slice, &mut buf);
        Self::Owned(std::sync::Arc::from(buf))
    }
}

impl From<MimeType> for BlobContentType {
    #[inline]
    fn from(mime: MimeType) -> Self {
        match mime.value {
            std::borrow::Cow::Borrowed(s) => Self::Static(s),
            std::borrow::Cow::Owned(v) => Self::Owned(std::sync::Arc::from(v)),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Blob
// ──────────────────────────────────────────────────────────────────────────

/// The `m_ctx` payload of
/// the codegen'd `JSBlob` wrapper.
///
/// R-2 (`sharedThis`): every JS-facing host-fn takes `&Blob` (not `&mut Blob`)
/// so re-entrant JS calls cannot stack two `&mut` to the same instance. Fields
/// mutated by host-fns are therefore wrapped in `Cell` (Copy scalars) or
/// `JsCell` (the non-Copy `store`). `Cell<T>` and `JsCell<T>` are both
/// `#[repr(transparent)]`, so `#[repr(C)]` field layout is unchanged.
#[repr(C)]
pub struct Blob {
    pub reported_estimated_size: Cell<usize>,
    pub size: Cell<SizeType>,
    pub offset: Cell<SizeType>,
    /// Intrusively-refcounted backing store. `StoreRef::clone`/`drop` map
    /// directly to `Store::ref_()`/`Store::deref()`.
    pub store: JsCell<Option<StoreRef>>,
    pub content_type: JsCell<BlobContentType>,
    pub content_type_was_set: Cell<bool>,
    /// Cached encoding probe of `shared_view()`.
    pub charset: Cell<AsciiStatus>,
    /// Was it created via the `File` constructor?
    pub is_jsdom_file: Cell<bool>,
    /// True when `size` is a bound the caller asked for (`Blob.slice`). For a
    /// file store `size` is otherwise a `stat` hint, and a hint must never cap
    /// a read: procfs/sysfs regular files report `st_size == 0` yet read more.
    pub size_is_explicit: Cell<bool>,
    /// `bun.ptr.RawRefCount(u32, .single_threaded)` — counts in-flight `*Blob`
    /// borrows handed to async readers; not the JS GC retain count. Zero while
    /// the JS cell is the sole owner.
    ///
    /// Public so `bun_runtime` can construct `Blob { ref_count: …, .. }`
    /// literals.
    pub ref_count: bun_ptr::RawRefCount,
    pub global_this: Cell<*const JSGlobalObject>,
    pub last_modified: Cell<f64>,
    /// Only used by `<input type="file">` / `File` (issue #10178).
    pub name: bun_core::OwnedStringCell,
}

// SAFETY: `Blob` holds a raw `global_this` pointer which defaults to
// `!Send`/`!Sync`. `Blob` moves across threads under `ObjectURLRegistry`'s
// mutex and via the work-pool read/write tasks; `global_this` is an opaque
// JSC handle only ever dereferenced on its owning JS thread.
unsafe impl Send for Blob {}
// SAFETY: concurrent `&Blob` access only occurs under `ObjectURLRegistry`'s
// mutex or on the single owning JS thread; the `Cell` fields are never raced.
unsafe impl Sync for Blob {}

impl Default for Blob {
    fn default() -> Self {
        Self {
            reported_estimated_size: Cell::new(0),
            size: Cell::new(0),
            offset: Cell::new(0),
            store: JsCell::new(None),
            content_type: JsCell::new(BlobContentType::default()),
            content_type_was_set: Cell::new(false),
            charset: Cell::new(AsciiStatus::Unknown),
            is_jsdom_file: Cell::new(false),
            size_is_explicit: Cell::new(false),
            ref_count: bun_ptr::RawRefCount::init(0),
            global_this: Cell::new(core::ptr::null()),
            last_modified: Cell::new(0.0),
            name: bun_core::OwnedStringCell::new(bun_core::String::dead()),
        }
    }
}

// Codegen externs (build/debug/codegen/ZigGeneratedClasses.cpp `JSBlob`).
// `*mut Blob` is opaque to C++ — only Rust dereferences it. The
// `improper_ctypes` lint recurses through `Option<StoreRef>` → `NonNull<Store>`
// and complains `Store` lacks `#[repr(C)]`, but `Store` never crosses FFI by
// value, so silence it for the whole anon-const.
#[allow(improper_ctypes)]
const _: () = {
    use crate::generated::JSBlob;

    // `JSValue::as(Blob)` special-case: a `BuildArtifact`
    // wraps a `Blob`, so downcasting to `Blob` must also match it. The struct
    // lives in `bun_runtime`, so resolve the fallback at link time.
    //
    // safe: by-value `JSValue` (tagged i64); the Rust-ABI body in `bun_runtime`
    // only type-checks the encoded value and returns the stored payload pointer
    // (or `None`) — no precondition beyond the link succeeding.
    unsafe extern "Rust" {
        safe fn __bun_blob_from_build_artifact(value: JSValue) -> Option<*mut Blob>;
    }

    impl JsClass for Blob {
        fn from_js(value: JSValue) -> Option<*mut Self> {
            JSBlob::from_js(value).or_else(|| __bun_blob_from_build_artifact(value))
        }
        fn from_js_direct(value: JSValue) -> Option<*mut Self> {
            JSBlob::from_js_direct(value)
        }
        fn to_js(self, global: &JSGlobalObject) -> JSValue {
            // Heap-promote and hand
            // ownership to the codegen wrapper. The S3File fast-path (different
            // JS wrapper) is layered on by `bun_runtime`'s `BlobExt::to_js` for
            // S3-backed blobs; lower-tier callers never construct S3 blobs.
            let ptr = Blob::new(self);
            JSBlob::to_js(ptr, global)
        }
        fn get_constructor(global: &JSGlobalObject) -> JSValue {
            JSBlob::get_constructor(global)
        }
    }
};

impl Blob {
    /// Heap-promote and mark as
    /// heap-allocated so `deinit` knows to free the heap box.
    #[inline]
    pub fn new(mut blob: Blob) -> *mut Blob {
        blob.ref_count = bun_ptr::RawRefCount::init(1);
        bun_core::heap::into_raw(Box::new(blob))
    }

    /// JS-wrapper finalizer (codegen `BlobClass__finalize` thunk). Releases the
    /// JS wrapper's `+1` on the intrusive refcount; the allocation may outlive
    /// this call if other refs remain.
    ///
    /// Inherent (not on `BlobExt`) so the generated `Blob::finalize(b)` call
    /// resolves here ahead of the blanket [`crate::JsFinalize::finalize`] —
    /// trait-vs-trait would be ambiguous.
    pub fn finalize(self: Box<Self>) {
        debug_assert!(
            self.is_heap_allocated(),
            "`finalize` may only be called on a heap-allocated Blob"
        );
        // `release` returns the raw `m_ctx` pointer without dropping;
        // `Blob__deref` runs `deinit()` (which `drop(heap::take)`s) when the
        // count reaches zero.
        Blob__deref(bun_core::heap::release(self));
    }

    #[inline]
    pub fn is_heap_allocated(&self) -> bool {
        // Single read of `self.ref_count`'s raw value.
        self.ref_count.unsafe_get_value() != 0
    }

    #[inline]
    pub fn content_type_slice(&self) -> &[u8] {
        self.content_type.get().as_slice()
    }

    /// Borrowed accessor for the `JsCell`-wrapped store. R-2: the field is
    /// interior-mutable so host-fns can take `&self`; this projects back to the
    /// `Option<&StoreRef>` shape every caller used pre-migration.
    #[inline]
    pub fn store(&self) -> Option<&StoreRef> {
        self.store.get().as_ref()
    }

    /// Move the store ref out without releasing it —
    /// the caller adopts the existing +1. `None` if already detached.
    #[inline]
    pub fn take_store(&self) -> Option<StoreRef> {
        self.store.replace(None)
    }

    /// Safe accessor for `global_this`. `None` only for default-constructed
    /// blobs (e.g. structured-clone payloads before the receiving thread
    /// patches it in); every JS-reachable `Blob` has it set at construction.
    #[inline]
    pub fn global_this(&self) -> Option<&JSGlobalObject> {
        // When non-null, `global_this` was stored from a live `&JSGlobalObject`
        // whose VM outlives this `Blob` (the JS heap that owns the `Blob` is
        // itself owned by that global). `JSGlobalObject` is an `opaque_ffi!`
        // ZST handle; `opaque_ref` is the centralised non-null-ZST deref proof.
        let p = self.global_this.get();
        (!p.is_null()).then(|| JSGlobalObject::opaque_ref(p))
    }

    /// Accepts both
    /// `Box<Store>` (from `Store::new` / `Store::init*`) and `StoreRef`.
    pub fn init_with_store<S: Into<StoreRef>>(store: S, global_this: &JSGlobalObject) -> Blob {
        let store: StoreRef = store.into();
        let size = store.size();
        let content_type = if let store::Data::File(ref f) = store.data {
            BlobContentType::from_mime(&f.mime_type)
        } else {
            BlobContentType::default()
        };
        let blob = Blob::default();
        blob.size.set(size);
        blob.store.set(Some(store));
        blob.content_type.set(content_type);
        blob.global_this.set(global_this);
        blob
    }

    /// Takes ownership of `bytes`.
    pub fn init(bytes: Vec<u8>, global_this: &JSGlobalObject) -> Blob {
        let size = bytes.len() as SizeType;
        let store = if !bytes.is_empty() {
            Some(Store::init(bytes))
        } else {
            None
        };
        let blob = Blob::default();
        blob.size.set(size);
        blob.store.set(store);
        blob.global_this.set(global_this);
        blob
    }

    #[inline]
    pub fn init_empty(global_this: &JSGlobalObject) -> Blob {
        let blob = Blob::default();
        blob.global_this.set(global_this);
        blob
    }

    /// Borrowed view of the in-memory
    /// bytes (`offset..offset+size` of the backing store). Empty for
    /// file-/S3-backed or zero-length blobs.
    pub fn shared_view(&self) -> &[u8] {
        let Some(store) = self.store() else {
            return b"";
        };
        if self.size.get() == 0 {
            return b"";
        }
        let mut slice = store.shared_view();
        if slice.is_empty() {
            return b"";
        }
        // Defensive: `offset`/`size` may originate from untrusted
        // structured-clone data; never index past the store's length.
        let off = (self.offset.get() as usize).min(slice.len());
        slice = &slice[off..];
        &slice[..slice.len().min(self.size.get() as usize)]
    }

    /// Release the store ref without
    /// dropping `self`.
    #[inline]
    pub fn detach(&self) {
        // `StoreRef::drop` calls `Store::deref()`.
        self.store.set(None);
    }

    /// New view onto the same store, +1 ref.
    #[inline]
    pub fn dupe(&self) -> Blob {
        self.dupe_with_content_type(false)
    }

    /// Alias for [`Self::dupe`].
    #[inline]
    pub fn borrowed_view(&self) -> Blob {
        self.dupe()
    }

    /// Ignores
    /// `include_content_type` and **always** deep-copies a heap-allocated
    /// `content_type` so freeing one side does not dangle the other (the old
    /// borrow path was removed because it dropped user-supplied parameters
    /// like multipart boundaries on a static-mime miss).
    pub fn dupe_with_content_type(&self, _include_content_type: bool) -> Blob {
        // `Option<StoreRef>::clone` bumps the intrusive `Store::ref_count`.
        Blob {
            reported_estimated_size: Cell::new(self.reported_estimated_size.get()),
            size: Cell::new(self.size.get()),
            offset: Cell::new(self.offset.get()),
            store: JsCell::new(self.store.get().clone()),
            content_type: JsCell::new(self.content_type.get().clone()),
            content_type_was_set: Cell::new(self.content_type_was_set.get()),
            charset: Cell::new(self.charset.get()),
            is_jsdom_file: Cell::new(self.is_jsdom_file.get()),
            size_is_explicit: Cell::new(self.size_is_explicit.get()),
            ref_count: bun_ptr::RawRefCount::init(0), // setNotHeapAllocated
            global_this: Cell::new(self.global_this.get()),
            last_modified: Cell::new(self.last_modified.get()),
            name: self.name.clone(),
        }
    }

    /// Upper bound on the bytes a read of this view may return. `MAX_SIZE`
    /// means "until EOF" — the only bound a file-backed blob has is one the
    /// caller set with `slice()`.
    #[inline]
    pub fn read_limit(&self) -> SizeType {
        if self.size_is_explicit.get() {
            self.size.get()
        } else {
            MAX_SIZE
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // Data-only predicates. LAYERING: hoisted from
    // `bun_runtime::webcore::blob::BlobExt` — these read only the `Store`
    // discriminant / `content_type` / `pathlike`, so lower-tier crates
    // (`bun_http_jsc`, `bun_runtime::server`, …) can call them without
    // pulling the whole `BlobExt` trait into scope.
    // ────────────────────────────────────────────────────────────────────

    /// `Blob.hasContentTypeFromUser()` — `true` when the user set a type
    /// explicitly *or* the store is file/S3-backed (whose mime is sniffed).
    #[inline]
    pub fn has_content_type_from_user(&self) -> bool {
        self.content_type_was_set.get()
            || self
                .store()
                .map(|s| matches!(s.data, store::Data::File(_) | store::Data::S3(_)))
                .unwrap_or(false)
    }

    /// `Blob.contentTypeOrMimeType()` — explicit `content_type` if set, else
    /// the store-derived mime (file extension / S3 metadata), else `None`.
    pub fn content_type_or_mime_type(&self) -> Option<&[u8]> {
        let ct = self.content_type_slice();
        if !ct.is_empty() {
            return Some(ct);
        }
        match &self.store()?.data {
            store::Data::File(file) => Some(&file.mime_type.value),
            store::Data::S3(s3) => Some(&s3.mime_type.value),
            store::Data::Bytes(_) => None,
        }
    }

    /// `Blob.isBunFile()` — backed by a filesystem `Store::File`.
    #[inline]
    pub fn is_bun_file(&self) -> bool {
        matches!(self.store.get().as_deref(), Some(s) if matches!(s.data, store::Data::File(_)))
    }

    /// `Blob.isS3()` — backed by an S3 `Store::S3`.
    #[inline]
    pub fn is_s3(&self) -> bool {
        matches!(self.store.get().as_deref(), Some(s) if matches!(s.data, store::Data::S3(_)))
    }

    /// `Blob.needsToReadFile()` — true when bytes must be fetched off-disk
    /// before any in-memory consumer can see them (i.e. `Store::File`).
    #[inline]
    pub fn needs_to_read_file(&self) -> bool {
        matches!(self.store.get().as_deref(), Some(s) if matches!(s.data, store::Data::File(_)))
    }

    /// `Blob.getFileName()` — the user-visible name: `Bytes.stored_name`,
    /// the file path, or the S3 key. `None` for fd-backed or unnamed blobs.
    pub fn get_file_name(&self) -> Option<&[u8]> {
        match &self.store.get().as_deref()?.data {
            store::Data::Bytes(bytes) => {
                let n = &bytes.stored_name[..];
                if n.is_empty() { None } else { Some(n) }
            }
            store::Data::File(file) => match &file.pathlike {
                PathOrFileDescriptor::Path(path) => Some(path.slice()),
                PathOrFileDescriptor::Fd(_) => None,
            },
            // Use `s3.path()` (URL-normalized), NOT `s3.pathlike.slice()`.
            store::Data::S3(s3) => Some(s3.path()),
        }
    }

    /// Tear down owned resources; if
    /// heap-allocated, also frees the heap box.
    pub fn deinit(&mut self) {
        self.detach();
        self.name.set(bun_core::String::dead());

        self.content_type.set(BlobContentType::default());

        if self.is_heap_allocated() {
            // SAFETY: `self` is the `*mut Blob` originally produced by
            // `Blob::new` (`heap::alloc`).
            unsafe { drop(bun_core::heap::take(std::ptr::from_mut::<Blob>(self))) };
        }
    }
}

// SAFETY: `Blob__ref`/`Blob__deref` operate on the intrusive `ref_count` and
// keep the heap-allocated `Blob` alive while the count is > 0.
unsafe impl bun_ptr::ExternalSharedDescriptor for Blob {
    unsafe fn ext_ref(this: *mut Self) {
        // SAFETY: caller guarantees `this` points to a live heap-allocated Blob.
        unsafe { Blob__ref(&mut *this) }
    }
    unsafe fn ext_deref(this: *mut Self) {
        // SAFETY: caller guarantees `this` points to a live heap-allocated Blob.
        unsafe { Blob__deref(&mut *this) }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__ref(self_: &mut Blob) {
    debug_assert!(
        self_.is_heap_allocated(),
        "cannot ref: this Blob is not heap-allocated"
    );
    self_.ref_count.increment();
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__deref(self_: &mut Blob) {
    debug_assert!(
        self_.is_heap_allocated(),
        "cannot deref: this Blob is not heap-allocated"
    );
    if self_.ref_count.decrement() == bun_ptr::raw_ref_count::DecrementResult::ShouldDestroy {
        // `deinit` has its own `is_heap_allocated()` guard around the
        // `drop(heap::take)`, so re-arm so it returns true.
        self_.ref_count.increment();
        self_.deinit();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────

pub mod store {
    use super::*;

    /// Intrusively-refcounted; always
    /// heap-allocated.
    #[derive(bun_ptr::ThreadSafeRefCounted)]
    pub struct Store {
        pub data: Data,
        pub mime_type: MimeType,
        pub ref_count: bun_ptr::ThreadSafeRefCount<Store>,
        pub is_all_ascii: Option<bool>,
    }

    impl Default for Store {
        fn default() -> Self {
            Self {
                data: Data::Bytes(Bytes::default()),
                mime_type: bun_http_types::MimeType::NONE,
                ref_count: bun_ptr::ThreadSafeRefCount::init(),
                is_all_ascii: None,
            }
        }
    }

    /// Backing data for a `Store`.
    #[derive(bun_core::EnumTag)]
    #[enum_tag(existing = DataTag)]
    pub enum Data {
        Bytes(Bytes),
        File(File),
        S3(S3),
    }

    /// Discriminant-only tag for `Data`.
    #[derive(Clone, Copy, PartialEq, Eq, Debug)]
    pub enum DataTag {
        Bytes,
        File,
        S3,
    }

    impl Data {
        bun_core::enum_unwrap!(pub Data, File  => fn as_file  / as_file_mut  -> File);
        bun_core::enum_unwrap!(pub Data, S3    => fn as_s3    / as_s3_mut    -> S3);
        bun_core::enum_unwrap!(pub Data, Bytes => fn as_bytes / as_bytes_mut -> Bytes);
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

    // ────────────────────────────────────────────────────────────────────
    // Bytes
    // ────────────────────────────────────────────────────────────────────

    /// Kept as `(ptr,len,cap,allocator)`
    /// rather than `Vec<u8>` so the memfd-backed path
    /// (`LinuxMemFdAllocator::create` → `mmap`'d region freed via `munmap`)
    /// can carry its allocator vtable with the buffer.
    pub struct Bytes {
        pub ptr: Option<NonNull<u8>>,
        pub len: SizeType,
        pub cap: SizeType,
        pub allocator: bun_alloc::StdAllocator,
        /// Used by standalone module graph and the `File` constructor.
        /// Heap-owned (or empty); freed by `Bytes`'s `Drop`.
        pub stored_name: Box<[u8]>,
    }

    // SAFETY: `Bytes` is morally `Vec<u8>`-with-custom-free. The raw
    // `NonNull<u8>` is uniquely owned (`ptr` is the sole alias) and
    // `StdAllocator` is `Send + Sync`.
    unsafe impl Send for Bytes {}
    // SAFETY: `&Bytes` only reads the uniquely-owned slice via `slice()`; no
    // interior mutability, so sharing references across threads is sound.
    unsafe impl Sync for Bytes {}

    impl Default for Bytes {
        fn default() -> Self {
            Self {
                ptr: None,
                len: 0,
                cap: 0,
                allocator: bun_alloc::basic::C_ALLOCATOR,
                stored_name: Box::default(),
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
                // We keep
                // the real `cap` so `to_internal_blob` can soundly
                // `Vec::from_raw_parts`.
                len: len as SizeType,
                cap: cap as SizeType,
                allocator: bun_alloc::basic::C_ALLOCATOR,
                stored_name: Box::default(),
            }
        }

        /// Takes ownership of a `Box<[u8]>` (global allocator, `cap == len`).
        /// Paired with [`Bytes::into_boxed_slice`] for round-tripping the
        /// `is_temporary` handoff in `read_file`.
        pub fn init_owned(bytes: Box<[u8]>) -> Bytes {
            let len = bytes.len();
            let ptr = bun_core::heap::into_raw(bytes).cast::<u8>();
            Bytes {
                ptr: NonNull::new(ptr),
                len: len as SizeType,
                cap: len as SizeType,
                allocator: bun_alloc::basic::C_ALLOCATOR,
                stored_name: Box::default(),
            }
        }

        /// Reclaim the buffer as a `Box<[u8]>`, shrinking if `cap > len`.
        ///
        /// Only valid for global-allocator-backed storage (the `init`/
        /// `init_owned` paths) — asserts on a custom allocator (mmap/memfd).
        pub fn into_boxed_slice(self) -> Box<[u8]> {
            let mut this = core::mem::ManuallyDrop::new(self);
            // `ManuallyDrop` suppresses the `Drop` impl, so free `stored_name`
            // here explicitly (the buffer itself is reclaimed below).
            drop(core::mem::take(&mut this.stored_name));
            let Some(ptr) = this.ptr else {
                return Box::new([]);
            };
            debug_assert!(
                core::ptr::eq(this.allocator.vtable, bun_alloc::basic::C_ALLOCATOR.vtable),
                "Bytes::into_boxed_slice on non-global allocator",
            );
            // SAFETY: `ptr[..cap]` is the live global-allocator allocation
            // recorded by `init`/`init_owned`; `len <= cap`. `Vec::from_raw_parts`
            // reconstitutes ownership, `into_boxed_slice` reallocates iff
            // `cap > len` so the result has the canonical `Box<[u8]>` layout.
            unsafe { Vec::from_raw_parts(ptr.as_ptr(), this.len as usize, this.cap as usize) }
                .into_boxed_slice()
        }

        /// Construct from a raw `(ptr, len, cap)` triple owned by `allocator`.
        ///
        /// # Safety
        /// `ptr[..cap]` must be a live allocation owned by `allocator`'s vtable
        /// and `len <= cap`. Ownership transfers to the returned `Bytes`.
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
                stored_name: Box::default(),
            }
        }

        #[inline]
        pub fn init_empty_with_name(name: Box<[u8]>) -> Bytes {
            Bytes {
                stored_name: name,
                ..Default::default()
            }
        }

        #[inline]
        pub fn allocator(&self) -> bun_alloc::StdAllocator {
            self.allocator
        }

        #[inline]
        pub fn len(&self) -> SizeType {
            self.len
        }

        pub fn slice(&self) -> &[u8] {
            match self.ptr {
                // SAFETY: `ptr[..len]` is a live initialized region
                // (init/from_raw_parts contract).
                Some(p) => unsafe { core::slice::from_raw_parts(p.as_ptr(), self.len as usize) },
                None => &[],
            }
        }

        pub fn allocated_slice(&self) -> &[u8] {
            match self.ptr {
                // SAFETY: `ptr[..cap]` is the full allocation; bytes in
                // `[len..cap]` may be uninitialized.
                Some(p) => unsafe { core::slice::from_raw_parts(p.as_ptr(), self.cap as usize) },
                None => &[],
            }
        }

        pub fn as_array_list(&mut self) -> &mut [u8] {
            self.as_array_list_leak()
        }

        pub fn as_array_list_leak(&mut self) -> &mut [u8] {
            match self.ptr {
                // SAFETY: `ptr[..len]` is live and uniquely owned by `*self`.
                Some(p) => unsafe {
                    core::slice::from_raw_parts_mut(p.as_ptr(), self.len as usize)
                },
                None => &mut [],
            }
        }
    }

    impl Drop for Bytes {
        fn drop(&mut self) {
            // `stored_name` is a `Box<[u8]>`, so its field `Drop` frees it;
            // only the custom-allocator buffer needs an explicit free here.
            // Route through the existing accessor instead of re-deriving the
            // slice from raw parts here: `allocated_slice` already encapsulates
            // the `(ptr, cap)` → `&[u8]` invariant (and the `None` ⇒ `&[]`
            // case), and `StdAllocator::free` is `raw_free` with byte alignment
            // plus an empty-slice early-out — identical to the previous
            // open-coded `raw_free(.., Alignment::of::<u8>(), 0)`.
            self.allocator.free(self.allocated_slice());
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // File
    // ────────────────────────────────────────────────────────────────────

    /// A blob store referencing a file on disk.
    #[derive(Clone)]
    pub struct File {
        pub pathlike: PathOrFileDescriptor,
        pub mime_type: MimeType,
        pub is_atty: Option<bool>,
        pub mode: bun_sys::Mode,
        pub seekable: Option<bool>,
        pub max_size: SizeType,
        /// Milliseconds since ECMAScript epoch.
        pub last_modified: crate::JSTimeType,
    }

    impl Default for File {
        fn default() -> Self {
            Self {
                pathlike: PathOrFileDescriptor::Fd(bun_sys::Fd::INVALID),
                mime_type: bun_http_types::MimeType::OTHER,
                is_atty: None,
                mode: 0,
                seekable: None,
                max_size: MAX_SIZE,
                last_modified: crate::INIT_TIMESTAMP,
            }
        }
    }

    impl File {
        #[inline]
        pub fn init(pathlike: PathOrFileDescriptor, mime_type: Option<MimeType>) -> File {
            File {
                pathlike,
                mime_type: mime_type.unwrap_or(bun_http_types::MimeType::OTHER),
                ..Default::default()
            }
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // S3
    // ────────────────────────────────────────────────────────────────────

    /// An S3 blob store. Data-only at this tier;
    /// I/O methods (`unlink`/`stat`/`listObjects`/`getCredentialsWithOptions`)
    /// live in `bun_runtime` because they reach the HTTP client / event loop.
    pub struct S3 {
        pub pathlike: PathLike,
        pub mime_type: MimeType,
        pub credentials: Option<Rc<bun_s3_signing::S3Credentials>>,
        pub options: bun_s3_signing::MultiPartUploadOptions,
        pub acl: Option<bun_s3_signing::ACL>,
        pub storage_class: Option<bun_s3_signing::StorageClass>,
        pub request_payer: bool,
    }

    impl S3 {
        pub fn get_credentials(&self) -> &Rc<bun_s3_signing::S3Credentials> {
            debug_assert!(self.credentials.is_some());
            self.credentials.as_ref().unwrap()
        }

        pub fn estimated_size(&self) -> usize {
            self.pathlike.estimated_size()
                + self
                    .credentials
                    .as_ref()
                    .map(|c| c.estimated_size())
                    .unwrap_or(0)
        }

        pub fn path(&self) -> &[u8] {
            let mut path_name = bun_url::URL::parse(self.pathlike.slice()).s3_path();
            // normalize start and ending
            if bun_core::strings::ends_with(path_name, b"/") {
                path_name = &path_name[0..path_name.len()];
            } else if bun_core::strings::ends_with(path_name, b"\\") {
                path_name = &path_name[0..path_name.len() - 1];
            }
            if bun_core::strings::starts_with(path_name, b"/")
                || bun_core::strings::starts_with(path_name, b"\\")
            {
                path_name = &path_name[1..];
            }
            path_name
        }

        pub fn init(
            pathlike: PathLike,
            mime_type: Option<MimeType>,
            credentials: bun_s3_signing::S3Credentials,
        ) -> S3 {
            S3 {
                // Heap-allocate a fresh refcounted copy.
                credentials: Some(Rc::new(credentials)),
                pathlike,
                mime_type: mime_type.unwrap_or(bun_http_types::MimeType::OTHER),
                options: bun_s3_signing::MultiPartUploadOptions::default(),
                acl: None,
                storage_class: None,
                request_payer: false,
            }
        }
    }

    // No explicit `Drop`: the owned fields (`pathlike`, `credentials`) are
    // all released by `PathLike::drop` / `Option<Arc<_>>::drop`.

    // ────────────────────────────────────────────────────────────────────
    // Store impl
    // ────────────────────────────────────────────────────────────────────

    impl Store {
        /// `bun.TrivialNew(@This())`.
        #[inline]
        pub fn new(init: Store) -> Box<Store> {
            Box::new(init)
        }

        /// Takes ownership of
        /// `bytes`. Returns a +1-ref heap `Store`.
        pub fn init(bytes: Vec<u8>) -> StoreRef {
            StoreRef::from(Store::new(Store {
                data: Data::Bytes(Bytes::init(bytes)),
                mime_type: bun_http_types::MimeType::NONE,
                ref_count: bun_ptr::ThreadSafeRefCount::init(),
                is_all_ascii: None,
            }))
        }

        pub fn get_path(&self) -> Option<&[u8]> {
            match &self.data {
                Data::Bytes(bytes) => {
                    let n = &bytes.stored_name[..];
                    if n.is_empty() { None } else { Some(n) }
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

        #[inline]
        pub fn size(&self) -> SizeType {
            match &self.data {
                Data::Bytes(b) => b.len(),
                Data::File(_) | Data::S3(_) => MAX_SIZE,
            }
        }

        #[inline]
        pub fn shared_view(&self) -> &[u8] {
            if let Data::Bytes(bytes) = &self.data {
                return bytes.slice();
            }
            &[]
        }

        /// Bump the intrusive refcount.
        #[inline]
        pub fn ref_(&self) {
            // SAFETY: `self` is live; `ref_` only touches the interior-mutable
            // atomic counter, never mutates through the pointer.
            unsafe {
                bun_ptr::ThreadSafeRefCount::<Self>::ref_(core::ptr::from_ref(self).cast_mut())
            };
        }

        #[inline]
        pub fn has_one_ref(&self) -> bool {
            self.ref_count.has_one_ref()
        }

        /// Consumes one reference; on last
        /// ref, drops & frees the heap `Store`.
        ///
        /// # Safety
        /// `this` must point to a live `Store` originally allocated via
        /// `Store::new` / `Box::new`, and the caller must own one outstanding
        /// reference being released.
        #[inline]
        pub unsafe fn deref(this: NonNull<Store>) {
            // SAFETY: caller contract.
            unsafe { bun_ptr::ThreadSafeRefCount::<Self>::deref(this.as_ptr()) };
        }

        /// `JSCArrayBuffer` deallocator hook. Only ever passed as a
        /// callback fn pointer, so no `#[unsafe(no_mangle)]` here.
        pub extern "C" fn external(
            ptr: *mut core::ffi::c_void,
            _: *mut core::ffi::c_void,
            _: usize,
        ) {
            let Some(this) = NonNull::new(ptr.cast::<Store>()) else {
                return;
            };
            // SAFETY: caller passes a `*Store` (originally leaked via
            // `heap::alloc`) as the opaque pointer.
            unsafe { Store::deref(this) };
        }
    }

    impl Drop for Store {
        /// `Box` handles the allocation. Every `Data` variant self-frees on
        /// field drop: `Bytes::drop` frees its buffer + `stored_name`; the
        /// `File.pathlike` / `S3` payloads (including an owned
        /// `PathLike::String`, which owns its buffer via `CowSlice`) release in
        /// `PathLike::drop`.
        fn drop(&mut self) {}
    }

    // ────────────────────────────────────────────────────────────────────
    // StoreRef — intrusive-refcounted handle
    // ────────────────────────────────────────────────────────────────────

    /// Owning handle to a heap `Store`, refcounted via the *intrusive*
    /// `Store::ref_count` field.
    ///
    /// Not `Arc<Store>`: `Store::deref()` (reachable from `Store::external` and
    /// other FFI callbacks) frees via `heap::take` when the intrusive count
    /// hits zero; `Arc` would own the allocation itself, and the two refcounts
    /// would diverge. One refcount, one deallocation path.
    #[repr(transparent)]
    pub struct StoreRef {
        ptr: NonNull<Store>,
    }

    impl StoreRef {
        /// Wrap a raw `*Store`, incrementing its intrusive refcount.
        ///
        /// # Safety
        /// `ptr` must be a live `Store` allocated by `Store::new`/`Box::new`.
        #[inline]
        pub unsafe fn retained(ptr: NonNull<Store>) -> Self {
            let this = Self { ptr };
            // Deref impl encapsulates the `NonNull::as_ref` (caller contract
            // discharges its liveness precondition).
            this.ref_();
            this
        }

        #[inline]
        pub fn as_ptr(&self) -> *mut Store {
            self.ptr.as_ptr()
        }

        /// Leak the held +1 and return the raw pointer. Pair with a later
        /// `Store::deref()` (typically via `Store::external` / an FFI
        /// deallocator).
        #[inline]
        pub fn into_raw(self) -> *mut Store {
            core::mem::ManuallyDrop::new(self).ptr.as_ptr()
        }

        /// Mutable access to `data` through the shared handle. The caller
        /// must ensure no
        /// other `&mut` to the same `Store` is live (single-threaded JS
        /// event-loop discipline).
        #[inline]
        #[allow(clippy::mut_from_ref)]
        pub fn data_mut(&self) -> &mut Data {
            // SAFETY: caller guarantees no other `&mut` to this `Store` is
            // live; see doc comment.
            unsafe { &mut (*self.as_ptr()).data }
        }
    }

    impl From<Box<Store>> for StoreRef {
        #[inline]
        fn from(b: Box<Store>) -> Self {
            // `Store::new` initializes `ref_count` to 1 — adopt that +1.
            Self {
                ptr: bun_core::heap::into_raw_nn(b),
            }
        }
    }

    impl Clone for StoreRef {
        #[inline]
        fn clone(&self) -> Self {
            // `Deref` (below) encapsulates the NonNull access under the
            // `StoreRef` liveness invariant.
            (**self).ref_();
            Self { ptr: self.ptr }
        }
    }

    impl Drop for StoreRef {
        #[inline]
        fn drop(&mut self) {
            // SAFETY: invariant — `ptr` is live and originated from
            // `heap::alloc` (mutable provenance); `deref()` frees on last ref.
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

    // SAFETY: `Store`'s refcount is atomic and its payload is either
    // immutable-after-init or guarded by callers.
    unsafe impl Send for StoreRef {}
    // SAFETY: `Store::ref_count` is atomic and `&StoreRef` only derefs to
    // `&Store`.
    unsafe impl Sync for StoreRef {}
}
pub use store::{Store, StoreRef};
