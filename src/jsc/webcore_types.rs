//! Core `webcore` data types — `Blob`, `Blob::Store`.
//!
//! LAYERING: these are the **single nominal definitions**. `bun_runtime::webcore`
//! re-exports them (`pub use bun_jsc::webcore_types::*`) and layers behaviour
//! (S3 I/O, streaming, JS host-fns, async readers) on top via the `BlobExt` /
//! `StoreExt` / … extension traits in that crate. Defining the data shapes here
//! lets lower-tier crates (`bun_http_jsc`, `bun_sql_jsc`) downcast a `JSValue`
//! to `Blob` and read its bytes without a `bun_runtime` forward-dep.
//!
//! Everything that touches the
//! event loop / fs / network stays in `bun_runtime`.
//!
//! `BuildArtifact` is **not** hoisted here: its accessors call `BlobExt` methods. With no lower-tier
//! consumer, the canonical `BuildArtifact` stays in `bun_runtime::api`.

use core::cell::Cell;
use core::ffi::c_void;
use core::ops::Range;

use bun_core::strings::AsciiStatus;
use bun_http_types::MimeType::MimeType;
use bun_ptr::RefPtr;

use crate::JsCell;
use crate::{JSGlobalObject, JSValue, JsClass, WrapperGuard};

/// Blob size type. Values are masked to 52 bits at the boundary.
pub type SizeType = u64;
/// Maximum blob size (52 bits).
pub const MAX_SIZE: SizeType = (1u64 << 52) - 1;

#[cfg(not(windows))]
#[derive(Copy, Clone, Default, PartialEq, Eq)]
pub enum ClosingState {
    #[default]
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
    /// Script named a type that Bun sends with a charset: `type` is `given`, a `Content-Type` header is `header`.
    Named {
        given: &'static [u8],
        header: &'static [u8],
    },
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
            Self::Named { header, .. } => header,
        }
    }

    /// What the `type` attribute answers.
    #[inline]
    pub fn given(&self) -> &[u8] {
        match self {
            Self::Named { given, .. } => given,
            _ => self.as_slice(),
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

    /// The type that script gave to `new Blob()`, `new File()` or `slice()`.
    pub fn from_script(slice: &[u8]) -> Self {
        Self::from_known_name(slice).unwrap_or_else(|| Self::from_lowercased(slice))
    }

    /// The `type` of the Blob that a clone is made from. Not every Blob's is lowercase.
    pub fn from_clone(given: &[u8]) -> Self {
        Self::from_known_name(given)
            .filter(|known| known.given() == given)
            .unwrap_or_else(|| Self::Owned(std::sync::Arc::from(given)))
    }

    fn from_known_name(slice: &[u8]) -> Option<Self> {
        let given = bun_http_types::MimeType::interned_name(slice)?;
        Some(
            match bun_http_types::MimeType::by_name_static(given).map(|mime| mime.value) {
                Some(std::borrow::Cow::Borrowed(header)) if header != given => {
                    Self::Named { given, header }
                }
                _ => Self::Static(given),
            },
        )
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

/// What a JS `Blob` wraps (`src/runtime/webcore/Blob.bind.ts`).
///
/// Every JS-facing host-fn takes `&Blob` (not `&mut Blob`)
/// so re-entrant JS calls cannot stack two `&mut` to the same instance. Fields
/// mutated by host-fns are therefore wrapped in `Cell` (Copy scalars) or
/// `JsCell` (`content_type`, `name`). `Cell<T>` and `JsCell<T>` are both
/// `#[repr(transparent)]`, so `#[repr(C)]` field layout is unchanged.
#[repr(C)]
#[derive(bun_ptr::RefCounted)]
pub struct Blob {
    pub reported_estimated_size: Cell<usize>,
    pub size: Cell<SizeType>,
    pub offset: Cell<SizeType>,
    pub store: Option<RefPtr<Store>>,
    pub content_type: JsCell<BlobContentType>,
    pub content_type_was_set: Cell<bool>,
    /// Cached encoding probe of `shared_view()`.
    pub charset: Cell<AsciiStatus>,
    /// Was it created via the `File` constructor?
    pub is_jsdom_file: Cell<bool>,
    /// On a heap `Blob`, the JS wrapper, `BlobRefPtr`s and `ExternalShared`s each hold a ref.
    ///
    /// Public so `bun_runtime` can construct `Blob { ref_count: …, .. }`
    /// literals.
    pub ref_count: bun_ptr::RefCount,
    pub global_this: Cell<*const JSGlobalObject>,
    pub last_modified: Cell<f64>,
    /// Only used by `<input type="file">` / `File` (issue #10178).
    pub name: bun_ptr::JsCell<bun_core::String>,
}

impl Default for Blob {
    fn default() -> Self {
        Self {
            reported_estimated_size: Cell::new(0),
            size: Cell::new(0),
            offset: Cell::new(0),
            store: None,
            content_type: JsCell::new(BlobContentType::default()),
            content_type_was_set: Cell::new(false),
            charset: Cell::new(AsciiStatus::Unknown),
            is_jsdom_file: Cell::new(false),
            ref_count: bun_ptr::RefCount::init(),
            global_this: Cell::new(core::ptr::null()),
            last_modified: Cell::new(0.0),
            name: bun_ptr::JsCell::new(bun_core::String::DEAD),
        }
    }
}

const _: () = {
    // The class is generated into `bun_runtime`, which has its members (`BlobExt`).
    unsafe extern "C" {
        safe fn Bun__Bindgen__Blob__fromJS(value: JSValue) -> *mut c_void;
        fn Bun__Bindgen__Blob__fromJSDirect(value: JSValue) -> *mut c_void;
        fn Bun__Bindgen__Blob__create(global: *mut JSGlobalObject, wrapped: *mut c_void)
        -> JSValue;
    }

    // `JSValue::as(Blob)` special-case: a `BuildArtifact`
    // wraps a `Blob`, so downcasting to `Blob` must also match it. The struct
    // lives in `bun_runtime`, so resolve the fallback at link time.
    //
    // safe: the Rust-ABI body in `bun_runtime` is a safe function.
    unsafe extern "Rust" {
        safe fn __bun_blob_from_build_artifact(value: JSValue) -> *mut Blob;
    }

    impl JsClass for Blob {
        fn from_js(value: &JSValue) -> Option<WrapperGuard<'_, Self>> {
            let blob = match Bun__Bindgen__Blob__fromJS(*value) {
                blob if blob.is_null() => __bun_blob_from_build_artifact(*value),
                blob => blob.cast(),
            };
            // C++ `mayHoldBlob` (blob.h) answers for a cell of any other type without this call.
            debug_assert!(blob.is_null() || value.js_type() == crate::JSType::DOMWrapper);
            // SAFETY: a `JSBlob` holds a ref on what it wraps, and so does a `JSBuildArtifact`, of which the `Blob` is a field.
            unsafe { WrapperGuard::new(value, blob) }
        }
        fn from_js_direct(value: &JSValue) -> Option<WrapperGuard<'_, Self>> {
            if !value.is_cell() {
                return None;
            }
            // SAFETY: `value` is a cell, and a `JSBlob` holds a ref on what it wraps.
            unsafe { WrapperGuard::new(value, Bun__Bindgen__Blob__fromJSDirect(*value).cast()) }
        }
        fn to_js(self, global: &JSGlobalObject) -> JSValue {
            // Heap-promote and hand
            // ownership to the codegen wrapper. The S3File fast-path (different
            // JS wrapper) is layered on by `bun_runtime`'s `BlobExt::into_js` for
            // S3-backed blobs; lower-tier callers never construct S3 blobs.
            let ptr = Blob::new(self);
            // SAFETY: the new object takes the one ref `Blob::new` made.
            unsafe { Bun__Bindgen__Blob__create(global.as_mut_ptr(), ptr.cast()) }
        }
    }
};

impl Blob {
    /// Heap-promote, with the one ref that the caller owns.
    #[inline]
    pub fn new(blob: Blob) -> *mut Blob {
        RefPtr::new(blob).into_raw()
    }

    #[inline]
    pub fn content_type_slice(&self) -> &[u8] {
        self.content_type.get().as_slice()
    }

    #[inline]
    pub fn store(&self) -> Option<&RefPtr<Store>> {
        self.store.as_ref()
    }

    /// `None` also if the store is shared, see [`Store::get_mut`].
    #[inline]
    pub fn store_mut(&mut self) -> Option<&mut Store> {
        Store::get_mut(self.store.as_mut()?)
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

    pub fn init_with_store(store: RefPtr<Store>, global_this: &JSGlobalObject) -> Blob {
        let size = store.size();
        let content_type = if let store::Data::File(ref f) = store.data {
            BlobContentType::from_mime(&f.mime_type)
        } else {
            BlobContentType::default()
        };
        let blob = Blob {
            store: Some(store),
            ..Blob::default()
        };
        blob.size.set(size);
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
        let blob = Blob {
            store,
            ..Blob::default()
        };
        blob.size.set(size);
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

    /// Where [`Self::shared_view`] lies in the bytes of the store.
    pub fn window(&self) -> Range<usize> {
        let start = self.offset.get() as usize;
        match self.shared_view().len() {
            0 => 0..0,
            len => start..start + len,
        }
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
        Blob {
            reported_estimated_size: Cell::new(self.reported_estimated_size.get()),
            size: Cell::new(self.size.get()),
            offset: Cell::new(self.offset.get()),
            store: self.store.clone(),
            content_type: JsCell::new(self.content_type.get().clone()),
            content_type_was_set: Cell::new(self.content_type_was_set.get()),
            charset: Cell::new(self.charset.get()),
            is_jsdom_file: Cell::new(self.is_jsdom_file.get()),
            ref_count: bun_ptr::RefCount::init(),
            global_this: Cell::new(self.global_this.get()),
            last_modified: Cell::new(self.last_modified.get()),
            name: self.name.clone(),
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

    #[inline]
    pub fn file(&self) -> Option<&store::File> {
        match &self.store()?.data {
            store::Data::File(file) => Some(file),
            store::Data::Bytes(_) | store::Data::S3(_) => None,
        }
    }

    /// `Blob.isS3()` — backed by an S3 `Store::S3`.
    #[inline]
    pub fn is_s3(&self) -> bool {
        matches!(self.store.as_deref(), Some(s) if matches!(s.data, store::Data::S3(_)))
    }

    /// `Blob.needsToReadFile()` — backed by a filesystem `Store::File` (a
    /// `Bun.file()`), so the bytes must be fetched off-disk before any
    /// in-memory consumer can see them.
    #[inline]
    pub fn needs_to_read_file(&self) -> bool {
        matches!(self.store.as_deref(), Some(s) if matches!(s.data, store::Data::File(_)))
    }

    /// A usable filename: a non-empty `name`, else [`store_path`]. (`file.name`
    /// itself may be `""`; that is not a filename.)
    ///
    /// [`store_path`]: Self::store_path
    pub fn get_file_name(&self) -> Option<bun_core::Utf8Bytes<'_>> {
        let name = self.name.get();
        if !name.is_empty() {
            return Some(name.to_utf8());
        }
        self.store_path().map(bun_core::Utf8Bytes::Borrowed)
    }

    /// `Bytes.stored_name`, the file path, or the S3 key, ignoring `name`.
    /// `None` for fd-backed or unnamed stores.
    pub fn store_path(&self) -> Option<&[u8]> {
        match &self.store.as_deref()?.data {
            store::Data::Bytes(bytes) => {
                let n = &bytes.stored_name[..];
                if n.is_empty() { None } else { Some(n) }
            }
            store::Data::File(file) => file.path(),
            // Use `s3.path()` (URL-normalized), NOT `s3.path_as_written`.
            store::Data::S3(s3) => Some(s3.path()),
        }
    }
}

// SAFETY: `Blob__ref`/`Blob__deref` operate on the intrusive `ref_count` and
// keep the heap-allocated `Blob` alive while the count is > 0.
unsafe impl bun_ptr::ExternalSharedDescriptor for Blob {
    unsafe fn ext_ref(this: *mut Self) {
        // SAFETY: caller guarantees `this` points to a live heap-allocated Blob.
        unsafe { Blob__ref(this) }
    }
    unsafe fn ext_deref(this: *mut Self) {
        // SAFETY: caller guarantees `this` points to a live heap-allocated Blob
        // and is releasing a count it owns.
        unsafe { Blob__deref(this) }
    }
}

/// Retain half of the refcount protocol behind `BlobImplRefDerefTraits`
/// (`src/jsc/bindings/blob.h`) and [`bun_ptr::ExternalShared`].
///
/// # Safety
/// `this` must point to a live `Blob` produced by [`Blob::new`], and the call
/// must happen on the thread that owns it (the count is not atomic).
#[unsafe(no_mangle)]
unsafe extern "C" fn Blob__ref(this: *mut Blob) {
    // SAFETY: caller contract above.
    unsafe { RefPtr::increment_strong_count(this) };
}

/// Release half of the refcount protocol behind `BlobImplRefDerefTraits`
/// (`src/jsc/bindings/blob.h`) and [`bun_ptr::ExternalShared`].
///
/// # Safety
/// `this` must point to a live `Blob` produced by [`Blob::new`], the caller
/// must own one of its counts (which this call consumes), and the call must
/// happen on the thread that owns it (the count is not atomic). Releasing the
/// last count frees the `Blob`, so `this` is dangling once this returns.
#[unsafe(no_mangle)]
unsafe extern "C" fn Blob__deref(this: *mut Blob) {
    // SAFETY: caller contract above.
    unsafe { RefPtr::decrement_strong_count(this) };
}

// ──────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────

pub mod store {
    use core::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
    use std::borrow::Cow;
    use std::sync::Arc;

    use bun_sys::{Fd, Mode};

    use super::*;
    use crate::JSTimeType;
    use crate::node_path::{JoinedPath, PathLike, PathOrFileDescriptor};

    /// Intrusively-refcounted; always
    /// heap-allocated.
    #[derive(bun_ptr::RefCounted)]
    pub struct Store {
        pub data: Data,
        pub mime_type: MimeType,
        ref_count: bun_ptr::ThreadSafeRefCount,
        pub is_all_ascii: IsAllAscii,
    }

    /// Tri-state "are the bytes all ASCII", learned lazily by whichever
    /// thread's dupe reads or writes the full store first.
    #[derive(Default)]
    pub struct IsAllAscii(core::sync::atomic::AtomicU8);

    impl IsAllAscii {
        #[inline]
        pub fn get(&self) -> Option<bool> {
            match self.0.load(core::sync::atomic::Ordering::Relaxed) {
                0 => None,
                v => Some(v == 2),
            }
        }
        #[inline]
        pub fn set(&self, is_all_ascii: bool) {
            self.0.store(
                1 + u8::from(is_all_ascii),
                core::sync::atomic::Ordering::Relaxed,
            );
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
        bun_core::enum_unwrap!(pub Data, File  => fn as_file -> File);
        bun_core::enum_unwrap!(pub Data, S3    => fn as_s3 -> S3);
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

    pub struct Bytes {
        storage: Storage,
        /// What `Storage::Mapped` maps, if it can be mapped again for a copy-on-write clone.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        memfd: Option<bun_sys::File>,
        /// Used by standalone module graph and the `File` constructor.
        pub stored_name: Box<[u8]>,
    }

    enum Storage {
        Heap(Vec<u8>),
        Static(&'static [u8]),
        #[cfg(unix)]
        Mapped(bun_sys::Mmap),
    }

    impl Bytes {
        fn new(storage: Storage) -> Bytes {
            Bytes {
                storage,
                #[cfg(any(target_os = "linux", target_os = "android"))]
                memfd: None,
                stored_name: Box::default(),
            }
        }

        pub fn init(bytes: Vec<u8>) -> Bytes {
            Self::new(Storage::Heap(bytes))
        }

        pub fn init_static(bytes: &'static [u8]) -> Bytes {
            Self::new(Storage::Static(bytes))
        }

        /// # Safety
        /// `mapping` is readable, writable and covered by its file until the `Bytes` is dropped.
        #[cfg(unix)]
        pub unsafe fn from_mapping(mapping: bun_sys::Mmap) -> Bytes {
            Self::new(Storage::Mapped(mapping))
        }

        /// # Safety
        /// As [`Self::from_mapping`], and `mapping` maps `memfd` from its start.
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub unsafe fn from_memfd_mapping(mapping: bun_sys::Mmap, memfd: bun_sys::File) -> Bytes {
            Bytes {
                memfd: Some(memfd),
                ..Self::new(Storage::Mapped(mapping))
            }
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(crate) fn memfd(&self) -> Option<bun_sys::Fd> {
            self.memfd.as_ref().map(|file| file.handle)
        }

        #[inline]
        pub fn len(&self) -> SizeType {
            self.slice().len() as SizeType
        }

        pub fn slice(&self) -> &[u8] {
            match &self.storage {
                Storage::Heap(bytes) => bytes,
                Storage::Static(bytes) => bytes,
                // SAFETY: the contract of `from_mapping`.
                #[cfg(unix)]
                Storage::Mapped(mapping) => unsafe { mapping.as_slice() },
            }
        }

        /// `None` for static bytes.
        pub fn slice_mut(&mut self) -> Option<&mut [u8]> {
            match &mut self.storage {
                Storage::Heap(bytes) => Some(bytes),
                Storage::Static(_) => None,
                // SAFETY: the contract of `from_mapping`.
                #[cfg(unix)]
                Storage::Mapped(mapping) => Some(unsafe { mapping.as_mut_slice() }),
            }
        }

        /// Moves the bytes out if they are on the heap, and copies them otherwise.
        pub fn take_vec(&mut self) -> Vec<u8> {
            match &mut self.storage {
                Storage::Heap(bytes) => core::mem::take(bytes),
                _ => self.slice().to_vec(),
            }
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // File
    // ────────────────────────────────────────────────────────────────────

    /// A blob store referencing a file on disk.
    pub struct File {
        pathlike: StoredPathOrFileDescriptor,
        pub mime_type: MimeType,
        is_atty: AtomicBool,
        mode: AtomicU32,
        /// Publishes `mode` and `max_size`. The other atomics publish nothing, so they are relaxed.
        has_stat: AtomicBool,
        max_size: AtomicU64,
        last_modified: AtomicU64,
        /// `st_mode` as a body's `clone()` saw it, kept apart from what the `Bun.file()` sharing this store answers from.
        mode_seen_by_clone: AtomicU32,
    }

    /// A [`PathOrFileDescriptor`] that holds no JS string or buffer.
    enum StoredPathOrFileDescriptor {
        Fd(Fd),
        Path(Vec<u8>),
        Joined(JoinedPath),
    }

    impl File {
        pub fn init(pathlike: PathOrFileDescriptor<'_>, mime_type: Option<MimeType>) -> File {
            File {
                pathlike: match pathlike {
                    PathOrFileDescriptor::Fd(fd) => StoredPathOrFileDescriptor::Fd(fd),
                    PathOrFileDescriptor::Path(PathLike::Joined(path)) => {
                        StoredPathOrFileDescriptor::Joined(path.into_owned())
                    }
                    PathOrFileDescriptor::Path(path) => {
                        StoredPathOrFileDescriptor::Path(path.into_vec())
                    }
                },
                mime_type: mime_type.unwrap_or(bun_http_types::MimeType::OTHER),
                is_atty: AtomicBool::new(false),
                mode: AtomicU32::new(0),
                has_stat: AtomicBool::new(false),
                max_size: AtomicU64::new(MAX_SIZE),
                last_modified: AtomicU64::new(crate::INIT_TIMESTAMP),
                mode_seen_by_clone: AtomicU32::new(0),
            }
        }

        pub fn init_stdio(fd: Fd, is_atty: bool, mode: Mode) -> File {
            File {
                is_atty: AtomicBool::new(is_atty),
                mode: AtomicU32::new(mode),
                ..File::init(PathOrFileDescriptor::Fd(fd), None)
            }
        }

        #[inline]
        pub fn pathlike(&self) -> PathOrFileDescriptor<'_> {
            match &self.pathlike {
                StoredPathOrFileDescriptor::Fd(fd) => PathOrFileDescriptor::Fd(*fd),
                StoredPathOrFileDescriptor::Path(path) => {
                    PathOrFileDescriptor::Path(PathLike::borrowed(path))
                }
                StoredPathOrFileDescriptor::Joined(path) => {
                    PathOrFileDescriptor::Path(PathLike::Joined(Cow::Borrowed(path)))
                }
            }
        }

        /// As [`PathLike::slice`]. `None` for a file descriptor.
        #[inline]
        pub fn path(&self) -> Option<&[u8]> {
            match &self.pathlike {
                StoredPathOrFileDescriptor::Fd(_) => None,
                StoredPathOrFileDescriptor::Path(path) => Some(path),
                StoredPathOrFileDescriptor::Joined(path) => Some(&path.joined),
            }
        }

        /// `None` for a path.
        #[inline]
        pub fn fd(&self) -> Option<Fd> {
            match self.pathlike {
                StoredPathOrFileDescriptor::Fd(fd) => Some(fd),
                StoredPathOrFileDescriptor::Path(_) | StoredPathOrFileDescriptor::Joined(_) => None,
            }
        }

        #[inline]
        pub fn is_atty(&self) -> bool {
            self.is_atty.load(Ordering::Relaxed)
        }

        #[inline]
        pub fn set_is_atty(&self, is_atty: bool) {
            self.is_atty.store(is_atty, Ordering::Relaxed);
        }

        /// 0: unknown.
        #[inline]
        pub fn mode(&self) -> Mode {
            self.mode.load(Ordering::Relaxed)
        }

        /// `None` until [`Self::set_stat`].
        #[inline]
        pub fn seekable(&self) -> Option<bool> {
            self.has_stat
                .load(Ordering::Acquire)
                .then(|| bun_sys::S::ISREG(self.mode()))
        }

        #[inline]
        pub fn max_size(&self) -> SizeType {
            self.max_size.load(Ordering::Relaxed)
        }

        /// Milliseconds since ECMAScript epoch.
        #[inline]
        pub fn last_modified(&self) -> JSTimeType {
            self.last_modified.load(Ordering::Relaxed)
        }

        #[inline]
        pub fn set_last_modified(&self, last_modified: JSTimeType) {
            self.last_modified.store(last_modified, Ordering::Relaxed);
        }

        #[inline]
        pub fn mode_seen_by_clone(&self) -> Option<Mode> {
            Some(self.mode_seen_by_clone.load(Ordering::Relaxed)).filter(|&mode| mode != 0)
        }

        #[inline]
        pub fn set_mode_seen_by_clone(&self, mode: Mode) {
            self.mode_seen_by_clone.store(mode, Ordering::Relaxed);
        }

        pub fn set_stat(&self, mode: Mode, max_size: SizeType, last_modified: JSTimeType) {
            self.max_size.store(max_size, Ordering::Relaxed);
            self.mode.store(mode, Ordering::Relaxed);
            self.set_last_modified(last_modified);
            self.has_stat.store(true, Ordering::Release);
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // S3
    // ────────────────────────────────────────────────────────────────────

    /// An S3 blob store. Data-only at this tier;
    /// I/O methods (`unlink`/`stat`/`listObjects`/`getCredentialsWithOptions`)
    /// live in `bun_runtime` because they reach the HTTP client / event loop.
    pub struct S3 {
        pub path_as_written: Vec<u8>,
        pub(crate) mime_type: MimeType,
        pub credentials: Arc<bun_s3_signing::S3Credentials>,
        pub options: bun_s3_signing::MultiPartUploadOptions,
        pub acl: Option<bun_s3_signing::ACL>,
        pub storage_class: Option<bun_s3_signing::StorageClass>,
        pub request_payer: bool,
    }

    impl S3 {
        pub fn estimated_size(&self) -> usize {
            self.path_as_written.len() + self.credentials.estimated_size()
        }

        pub fn path(&self) -> &[u8] {
            let mut path_name = bun_url::URL::parse(&self.path_as_written).s3_path();
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
            path_as_written: Vec<u8>,
            mime_type: Option<MimeType>,
            aws_options: bun_s3_signing::S3CredentialsWithOptions,
        ) -> S3 {
            S3 {
                credentials: Arc::new(aws_options.credentials),
                path_as_written,
                mime_type: mime_type.unwrap_or(bun_http_types::MimeType::OTHER),
                options: aws_options.options,
                acl: aws_options.acl,
                storage_class: aws_options.storage_class,
                request_payer: aws_options.request_payer,
            }
        }
    }

    // ────────────────────────────────────────────────────────────────────
    // Store impl
    // ────────────────────────────────────────────────────────────────────

    impl Store {
        #[inline]
        pub fn new(data: Data, mime_type: MimeType) -> Store {
            Store {
                data,
                mime_type,
                ref_count: bun_ptr::ThreadSafeRefCount::init(),
                is_all_ascii: IsAllAscii::default(),
            }
        }

        /// Takes ownership of
        /// `bytes`. Returns a +1-ref heap `Store`.
        pub fn init(bytes: Vec<u8>) -> RefPtr<Store> {
            RefPtr::new(Store::new(
                Data::Bytes(Bytes::init(bytes)),
                bun_http_types::MimeType::NONE,
            ))
        }

        pub fn get_path(&self) -> Option<&[u8]> {
            match &self.data {
                Data::Bytes(bytes) => {
                    let n = &bytes.stored_name[..];
                    if n.is_empty() { None } else { Some(n) }
                }
                Data::File(file) => file.path(),
                Data::S3(s3) => Some(&s3.path_as_written),
            }
        }

        pub fn memory_cost(&self) -> usize {
            if self.ref_count.has_one_ref() {
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

        /// `JSCArrayBuffer` deallocator hook. Only ever passed as a
        /// callback fn pointer, so no `#[unsafe(no_mangle)]` here.
        ///
        /// # Safety
        /// `ptr` is from `RefPtr<Store>::into_raw`, and this releases that ref.
        pub unsafe extern "C" fn external(
            ptr: *mut core::ffi::c_void,
            _: *mut core::ffi::c_void,
            _: usize,
        ) {
            // SAFETY: fn contract.
            unsafe { RefPtr::decrement_strong_count(ptr.cast::<Store>()) };
        }

        /// `None` unless `this` is the last ref.
        #[inline]
        pub fn get_mut(this: &mut RefPtr<Store>) -> Option<&mut Store> {
            // SAFETY: nothing keeps a `ThisPtr` or `BackRef` to a `Store`, so every pointer to it is a counted ref. `this` is the last one, and it stays borrowed.
            RefPtr::has_one_ref(this).then(|| unsafe { &mut *this.as_ptr() })
        }
    }
}
pub use store::Store;
