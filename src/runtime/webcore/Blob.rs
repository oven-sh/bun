//! The JS `Blob` class can be backed by different forms (in `Blob::Store`), which
//! represent different sources of Blob. For example, `Bun.file()` returns Blob
//! objects that reference the filesystem (`Blob::Store::File`). This is how
//! operations like writing `Store::File` to another `Store::File` knows to use a
//! basic file copy instead of a naive read write loop.

use core::ffi::{c_char, c_void};
use core::ptr::NonNull;
use core::sync::atomic::AtomicU32;

use bun_core::{self as bun, Output};
use crate::webcore::jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, VirtualMachine,
};
use bun_str::{self, strings, String as BunString, ZigString, ZigStringSlice};
use bun_sys::{self, Fd, FdExt as _};
use bun_jsc::StringJsc as _;
use bun_http_types::MimeType::MimeType;

use crate::webcore::node_types::{PathOrBlob, PathOrFileDescriptor};
use crate::webcore::{self, streams, Lifetime, ReadableStream, Request, Response};
use crate::webcore::s3_stub as S3;

bun_core::declare_scope!(Blob, visible);
macro_rules! debug {
    ($($args:tt)*) => { bun_core::scoped_log!(Blob, $($args)*); };
}

#[path = "blob/Store.rs"]
pub mod store;
pub use store::{Store, StoreRef};
// `Store` is referenced as both a module path (`store::Data::*`) and a type
// name in the Phase-A draft. Alias the module form so `Store::Data` resolves.
pub use store as Store_;

#[path = "blob/read_file.rs"]  pub mod read_file;
#[path = "blob/write_file.rs"] pub mod write_file;
#[path = "blob/copy_file.rs"]  pub mod copy_file;

/// Deallocator for `ArrayBuffer`s backed by a `Blob::Store` ref. Passed as a C
/// callback to `ArrayBuffer::to_js_with_context`; the `ctx` is a raw `Store*`
/// produced by `StoreRef::into_raw()`.
///
/// Mirrors Zig `jsc.array_buffer.BlobArrayBuffer_deallocator`; defined here
/// (rather than in `bun_jsc`) because `Store` is a `bun_runtime` type and the
/// `bun_jsc` copy is a forward-dep placeholder.
pub unsafe extern "C" fn blob_store_array_buffer_deallocator(
    _bytes: *mut c_void,
    ctx: *mut c_void,
) {
    // SAFETY: `ctx` is a `*mut Store` previously yielded by `StoreRef::into_raw`
    // (one outstanding strong ref). `Store::deref` consumes that ref.
    if let Some(store) = NonNull::new(ctx.cast::<Store>()) {
        unsafe { Store::deref(store) };
    }
}

/// Result delivered to `ReadBytesHandler::on_read_bytes`.
pub enum ReadBytesResult {
    /// global-allocator-owned by the callback.
    Ok(Vec<u8>),
    Err(bun_jsc::SystemError),
}

/// Trait extracted from the Zig `comptime Handler: type` pattern in
/// `read_bytes_to_handler` — the body only requires `on_read_bytes`.
pub trait ReadBytesHandler {
    fn on_read_bytes(&mut self, result: ReadBytesResult);
}

// ──────────────────────────────────────────────────────────────────────────
// Blob struct
// ──────────────────────────────────────────────────────────────────────────

/// The `m_ctx` payload of the codegen'd `JSBlob` wrapper.
// TODO(b2-blocked): #[bun_jsc::JsClass]
#[repr(C)]
pub struct Blob {
    pub reported_estimated_size: usize,

    pub size: SizeType,
    pub offset: SizeType,
    /// Intrusively-refcounted backing store. `StoreRef::clone`/`drop` map
    /// directly to Zig's `store.ref()`/`store.deref()`; see `blob/Store.rs`.
    pub store: Option<StoreRef>,
    /// Either a `&'static [u8]` (mime constant / literal) or a heap allocation
    /// owned by this Blob, discriminated by `content_type_allocated`.
    // TODO(port): model as Cow<'static, [u8]> once callers are audited.
    pub content_type: *const [u8],
    pub content_type_allocated: bool,
    pub content_type_was_set: bool,

    /// JavaScriptCore strings are either latin1 or UTF-16
    /// When UTF-16, they're nearly always due to non-ascii characters
    pub charset: strings::AsciiStatus,

    /// Was it created via file constructor?
    pub is_jsdom_file: bool,

    /// Reference count, for use with `bun_ptr::ExternalShared`. If the reference count is 0,
    /// that means this blob is *not* heap-allocated, and will not be freed in `deinit`.
    // PORT NOTE: `RawRefCount(u32, .single_threaded)` → non-generic `RawRefCount` (always u32).
    ref_count: bun_ptr::RawRefCount,

    // LIFETIMES.tsv: JSC_BORROW → *const JSGlobalObject (opaque FFI handle;
    // all access goes through `&self` methods, so `*const` preserves the
    // shared-borrow provenance from callers passing `&JSGlobalObject`).
    pub global_this: *const JSGlobalObject,

    pub last_modified: f64,
    /// Blob name will lazy initialize when getName is called, but
    /// we must be able to set the name, and we need to keep the value alive
    /// https://github.com/oven-sh/bun/issues/10178
    pub name: BunString,
}

pub type Ref = bun_ptr::ExternalShared<Blob>;

// SAFETY: `Blob` holds raw pointers (`content_type: *const [u8]`,
// `global_this: *const JSGlobalObject`) which default to `!Send`/`!Sync`. The
// Zig original moves `Blob` across threads under `ObjectURLRegistry`'s mutex
// and via the work-pool read/write tasks; the pointee data is either
// `'static`/heap-owned (content_type) or an opaque JSC handle only ever
// dereferenced on its owning JS thread. Matching Zig semantics here.
unsafe impl Send for Blob {}
unsafe impl Sync for Blob {}

/// Max int of double precision
/// ~4.5 petabytes is probably enough for awhile
/// We want to avoid coercing to a BigInt because that's a heap allocation
/// and it's generally just harder to use
pub type SizeType = u64; // TODO(port): Zig used `u52`; Rust has no native u52. Use u64 with MAX_SIZE clamp.
pub const MAX_SIZE: SizeType = (1u64 << 52) - 1;

/// 1: Initial
/// 2: Added byte for whether it's a dom file, length and bytes for `stored_name`,
///    and f64 for `last_modified`. Removed reserved bytes, it's handled by version
///    number.
/// 3: Added File name serialization for File objects (when is_jsdom_file is true)
const SERIALIZATION_VERSION: u8 = 3;

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum ClosingState {
    Running,
    Closing,
}

// ──────────────────────────────────────────────────────────────────────────
// Codegen aliases
// ──────────────────────────────────────────────────────────────────────────

pub use jsc::codegen::JSBlob as js;

// Hand-written `JsClass` impl — what `#[bun_jsc::JsClass]` would emit. Kept
// explicit because Blob owns custom `finalize`/`to_js` paths (S3File dispatch,
// ref-counted heap promotion via `Blob::new`) that the derive cannot express.
//
// `*mut Blob` is opaque to C++ — only Rust dereferences it. The
// `improper_ctypes` lint recurses through `Option<StoreRef>` → `NonNull<Store>`
// and complains `Store` lacks `#[repr(C)]`, but `Store` never crosses FFI by
// value, so silence it for the whole anon-const (covers both cfg'd extern
// blocks regardless of attribute/cfg ordering).
#[allow(improper_ctypes)]
const _: () = {
    #[cfg(all(windows, target_arch = "x86_64"))]
    unsafe extern "sysv64" {
        #[link_name = "Blob__fromJS"]
        fn __from_js(value: bun_jsc::JSValue) -> *mut Blob;
        #[link_name = "Blob__fromJSDirect"]
        fn __from_js_direct(value: bun_jsc::JSValue) -> *mut Blob;
        #[link_name = "Blob__create"]
        fn __create(global: *const bun_jsc::JSGlobalObject, ptr: *mut Blob) -> bun_jsc::JSValue;
        #[link_name = "Blob__getConstructor"]
        fn __get_constructor(global: *const bun_jsc::JSGlobalObject) -> bun_jsc::JSValue;
    }
    #[cfg(not(all(windows, target_arch = "x86_64")))]
    unsafe extern "C" {
        #[link_name = "Blob__fromJS"]
        fn __from_js(value: bun_jsc::JSValue) -> *mut Blob;
        #[link_name = "Blob__fromJSDirect"]
        fn __from_js_direct(value: bun_jsc::JSValue) -> *mut Blob;
        #[link_name = "Blob__create"]
        fn __create(global: *const bun_jsc::JSGlobalObject, ptr: *mut Blob) -> bun_jsc::JSValue;
        #[link_name = "Blob__getConstructor"]
        fn __get_constructor(global: *const bun_jsc::JSGlobalObject) -> bun_jsc::JSValue;
    }

    impl bun_jsc::JsClass for Blob {
        fn from_js(value: bun_jsc::JSValue) -> Option<*mut Self> {
            // SAFETY: pure FFI downcast; returns null on type mismatch.
            let p = unsafe { __from_js(value) };
            if p.is_null() { None } else { Some(p) }
        }
        fn from_js_direct(value: bun_jsc::JSValue) -> Option<*mut Self> {
            // SAFETY: pure FFI downcast (exact-structure check); null on miss.
            let p = unsafe { __from_js_direct(value) };
            if p.is_null() { None } else { Some(p) }
        }
        fn to_js(self, global: &bun_jsc::JSGlobalObject) -> bun_jsc::JSValue {
            // Heap-promote via `Blob::new` (initialises ref_count) rather than
            // a bare `Box::into_raw`, then hand to the C++ wrapper.
            let ptr = Blob::new(self);
            // SAFETY: `global` is live; ownership of `ptr` transfers to the
            // C++ wrapper (freed via `BlobClass__finalize`).
            unsafe { __create(global, ptr) }
        }
        fn get_constructor(global: &bun_jsc::JSGlobalObject) -> bun_jsc::JSValue {
            // SAFETY: `global` is a live JSC global; C++ reads its cached
            // structure/constructor table.
            unsafe { __get_constructor(global) }
        }
    }
};

// ──────────────────────────────────────────────────────────────────────────
// new() — heap promote
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    pub fn new(mut blob: Blob) -> *mut Blob {
        blob.ref_count = bun_ptr::RawRefCount::init(1);
        Box::into_raw(Box::new(blob))
    }
}

impl Default for Blob {
    fn default() -> Self {
        Self {
            reported_estimated_size: 0,
            size: 0,
            offset: 0,
            store: None,
            content_type: b"" as &'static [u8] as *const [u8],
            content_type_allocated: false,
            content_type_was_set: false,
            charset: strings::AsciiStatus::Unknown,
            is_jsdom_file: false,
            ref_count: bun_ptr::RawRefCount::init(0),
            global_this: core::ptr::null(),
            last_modified: 0.0,
            name: BunString::dead(),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Basic accessors
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    #[inline]
    pub fn content_type_slice(&self) -> &[u8] {
        // SAFETY: content_type is always a valid (possibly empty) slice pointer
        // owned either by 'static data or by this Blob (when content_type_allocated).
        unsafe { &*self.content_type }
    }

    // TODO(b2-blocked): bun_core::FormData (gated module)
    
    pub fn get_form_data_encoding(&mut self) -> Option<Box<bun_core::form_data::AsyncFormData>> {
        let content_type_slice = self.get_content_type()?;
        let encoding = bun_core::form_data::Encoding::get(content_type_slice.slice())?;
        // drop content_type_slice via Drop
        Some(bun_core::form_data::AsyncFormData::init(encoding))
    }

    pub fn has_content_type_from_user(&self) -> bool {
        self.content_type_was_set
            || self
                .store
                .as_ref()
                .map(|s| matches!(s.data, store::Data::File(_) | store::Data::S3(_)))
                .unwrap_or(false)
    }

    pub fn content_type_or_mime_type(&self) -> Option<&[u8]> {
        let ct = self.content_type_slice();
        if !ct.is_empty() {
            return Some(ct);
        }
        if let Some(store) = &self.store {
            match &store.data {
                store::Data::File(file) => return Some(&file.mime_type.value),
                store::Data::S3(s3) => return Some(&s3.mime_type.value),
                _ => return None,
            }
        }
        None
    }

    pub fn is_bun_file(&self) -> bool {
        let Some(store) = &self.store else { return false };
        matches!(store.data, store::Data::File(_))
    }

    pub fn is_s3(&self) -> bool {
        if let Some(store) = &self.store {
            return matches!(store.data, store::Data::S3(_));
        }
        false
    }

    pub fn needs_to_read_file(&self) -> bool {
        self.store
            .as_ref()
            .map(|s| matches!(s.data, store::Data::File(_)))
            .unwrap_or(false)
    }

    pub fn get_file_name(&self) -> Option<&[u8]> {
        let store = self.store.as_deref()?;
        match &store.data {
            store::Data::Bytes(bytes) => {
                let n = bytes.stored_name.slice();
                if n.is_empty() { None } else { Some(n) }
            }
            store::Data::File(file) => match &file.pathlike {
                PathOrFileDescriptor::Path(path) => Some(path.slice()),
                _ => None,
            },
            // Zig: `s3.path()` (URL-normalized), NOT `s3.pathlike.slice()`.
            store::Data::S3(s3) => Some(s3.path()),
        }
    }

    // detach: defined once below in the JSC-gated impl block; duplicate removed
    // here to fix E0592/E0034.

    pub fn shared_view(&self) -> &[u8] {
        if self.size == 0 || self.store.is_none() {
            return b"";
        }
        let mut slice_ = self.store.as_ref().unwrap().shared_view();
        if slice_.is_empty() {
            return b"";
        }
        // Defensive: `offset` may originate from untrusted structured-clone data.
        let off = (self.offset as usize).min(slice_.len());
        slice_ = &slice_[off..];
        &slice_[..slice_.len().min(self.size as usize)]
    }

    /// C-ABI trampoline for [`shared_view`] so lower-tier crates
    /// (`bun_jsc::webcore::Blob`, `bun_http_jsc`) can read blob bytes without a
    /// `bun_runtime` forward-dep. Mirrors Zig `Blob.sharedView`'s
    /// `(ptr,len)` shape.
    #[unsafe(no_mangle)]
    pub unsafe extern "C" fn Bun__Blob__sharedView(this: *const Blob, len: *mut usize) -> *const u8 {
        // SAFETY: caller (bun_jsc shim) passes a live `*const Blob` obtained
        // from `Blob__fromJS`; `len` is a stack out-param.
        let view = unsafe { (*this).shared_view() };
        unsafe { *len = view.len() };
        view.as_ptr()
    }

    /// Tear down owned resources. If heap-allocated, also frees the heap box.
    // PORT NOTE: kept as an explicit method (not Drop) because Blob is the m_ctx
    // payload of a .classes.ts class — finalize() owns teardown, and many
    // call-sites tear down stack copies explicitly.
    pub fn deinit(&mut self) {
        self.detach();
        self.name.deref();
        self.name = BunString::dead();

        if self.content_type_allocated {
            // SAFETY: content_type_allocated implies content_type is a leaked Box<[u8]>.
            unsafe { drop(Box::from_raw(self.content_type as *mut [u8])) };
            self.content_type = b"" as &'static [u8] as *const [u8];
            self.content_type_allocated = false;
        }

        if self.is_heap_allocated() {
            // SAFETY: self is the *mut Blob originally produced by Blob::new (Box::into_raw).
            unsafe { drop(Box::from_raw(self as *mut Blob)) };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSC-integration methods (host fns, to_js/from_js, S3/file I/O state machines)
// ──────────────────────────────────────────────────────────────────────────
// TODO(b2-blocked): bun_jsc::* — the entire block below depends on the real
// `bun_jsc` method surface (JSValue methods, host_fn proc-macro, ArgumentsSlice,
// codegen gc slots) and on gated runtime modules (`crate::node::fs`, `S3File`,
// `read_file`/`write_file`). Struct/enum payloads referenced by Body/Request/
// Response are defined outside this gate; un-gate progressively as bun_jsc
// becomes a dep of bun_runtime.

mod _jsc_gated {
use super::*;
use super::read_file;
use crate::node as node;
use crate::image::Image;
use bun_str::string_joiner::StringJoiner;
use bun_jsc::SysErrorJsc as _;
// `crate::webcore::jsc` glob-reexports `bun_jsc::*` but the double-glob loses
// `JsTerminatedResult`; alias it locally (same shape as bun_jsc::event_loop).
type JsTerminatedResult<T> = Result<T, bun_jsc::JsTerminated>;
use crate::webcore::s3_file as S3File;
use crate::webcore::s3::client as s3_client;
use crate::webcore::s3::simple_request::S3UploadResult;
use crate::api::archive::Archive;
// `write_file` (module) is shadowed inside this scope by `pub fn write_file`;
// alias the module so `write_file_mod::WriteFile{,Task,Windows,Promise}` resolve.
use super::write_file as write_file_mod;
use super::write_file::{WriteFilePromise, WriteFileWaitFromLockedValueTask};
#[allow(unused_imports)]
use bun_jsc::{StringJsc as _, JsClass as _};
#[allow(unused_imports)]
use bun_bundler::options_impl::LoaderExt as _;
// Local: the `bun_jsc::zig_string::ZigString` (repr(C)-identical to
// `bun_str::ZigString`) carries the `to_js`/`EMPTY` JSC-side methods.
#[allow(unused_imports)]
use bun_jsc::zig_string::ZigString as JscZigString;

/// Local mirror of `jsc.DOMFormData.FormDataEntry` (`union(enum) { string, file }`).
/// `bun_jsc::dom_form_data::FormDataEntry` carries `&Blob` (immutable) but
/// `FormDataContext::on_entry` needs `&mut Blob` to call `resolve_size()`, so
/// we drive the C++ `DOMFormData__forEach` directly with this mutable variant.
pub enum FormDataEntry<'a> {
    String(ZigString),
    File { blob: &'a mut Blob, filename: ZigString },
}

impl Blob {
    /// `Function` is the comptime `*WithBytes` callback (Zig: `comptime Function: anytype`).
    /// Modeled as a [`read_file::ReadFileToJs`] impl so the wrapped fn-pointer
    /// monomorphizes per call site without `fn_traits`.
    pub fn do_read_from_s3<F: read_file::ReadFileToJs>(
        &mut self,
        global: &JSGlobalObject,
    ) -> JsTerminatedResult<JSValue> {
        debug!("doReadFromS3");
        // Zig: `WrappedFn.wrapped` — adapt `(b, g, bytes)` → `(b, g, bytes, .clone)`
        // and route through `to_js_host_call` so the exception scope is asserted.
        fn wrapped<F: read_file::ReadFileToJs>(
            b: &mut Blob,
            g: *const JSGlobalObject,
            by: &mut [u8],
        ) -> JSValue {
            // SAFETY: `g` is the `&JSGlobalObject` stored on the task in `init`.
            let g = unsafe { &*g };
            jsc::host_fn::to_js_host_call(g, core::panic::Location::caller(), || {
                F::call(b, g, by, Lifetime::Clone)
            })
        }
        S3BlobDownloadTask::init(global, self, wrapped::<F>)
    }

    pub fn do_read_file<F: read_file::ReadFileToJs>(&mut self, global: &JSGlobalObject) -> JSValue {
        debug!("doReadFile");

        type Handler<'a, F> = read_file::NewReadFileHandler<'a, F>;

        // The callback may read context.content_type (e.g. to_form_data_with_bytes),
        // which is heap-owned by the source JS Blob and freed on finalize(). Take
        // an owning dupe so the handler outliving the source can't dangle.
        let handler = Box::into_raw(Box::new(Handler::<'_, F>::new(self.dupe(), global)));

        #[cfg(windows)]
        {
            // SAFETY: handler was just boxed; sole owner.
            unsafe { (*handler).promise = jsc::JSPromiseStrong::init(global) };
            let promise_value = unsafe { (*handler).promise.value() };
            promise_value.ensure_still_alive();

            read_file::ReadFileUV::start(
                // SAFETY: `bun_vm()` returns the live VM for this global.
                unsafe { &*global.bun_vm() }.event_loop(),
                self.store.as_ref().unwrap().clone(),
                self.offset,
                self.size,
                handler,
            );
            return promise_value;
        }

        #[cfg(not(windows))]
        {
            let file_read = read_file::ReadFile::create(
                self.store.as_ref().unwrap().clone(),
                self.offset,
                self.size,
                handler,
                Handler::<'_, F>::run,
            )
            .unwrap_or_else(|e| bun_core::handle_oom(Err(e)));
            let read_file_task =
                read_file::ReadFileTask::create_on_js_thread(global, Box::into_raw(file_read));

            // Create the Promise only after the store has been ref()'d.
            // The garbage collector runs on memory allocations
            // The JSPromise is the next GC'd memory allocation.
            // This shouldn't really fix anything, but it's a little safer.
            // PORT NOTE: `JSPromiseStrong.strong` is private; `init` creates the
            // JSPromise *and* the strong handle in one step, matching the Zig.
            // SAFETY: handler was just boxed; sole owner.
            unsafe { (*handler).promise = jsc::JSPromiseStrong::init(global) };
            let promise_value = unsafe { (*handler).promise.value() };
            promise_value.ensure_still_alive();

            read_file::ReadFileTask::schedule(read_file_task);

            debug!("doReadFile: read_file_task scheduled");
            promise_value
        }
    }
}

/// Carries `Function(ctx, bytes)` at the type level — Zig's
/// `comptime Function: anytype` becomes a trait impl so `run` can be taken as a
/// plain `fn(*mut c_void, ReadFileResultType)` thunk, monomorphized per `(C, F)`.
pub trait InternalReadFileFn<C> {
    fn call(ctx: *mut C, bytes: read_file::ReadFileResultType);
}

pub struct NewInternalReadFileHandler<C, F>(core::marker::PhantomData<(C, F)>);

impl<C, F> NewInternalReadFileHandler<C, F>
where
    F: InternalReadFileFn<C>,
{
    /// Type-erased thunk: `handler` is the `*mut C` ctx that was passed into
    /// `ReadFile`/`ReadFileUV` cast to `*anyopaque`. Mirrors Zig
    /// `Function(bun.cast(Context, handler), bytes)`.
    pub fn run(handler: *mut c_void, bytes: read_file::ReadFileResultType) {
        // SAFETY: every call site passes a `*mut C` (Zig `*Handler`) round-tripped
        // through `*anyopaque`; `bun.cast` is the inverse pointer cast.
        F::call(handler.cast::<C>(), bytes);
    }
}

impl Blob {
    /// Read this Blob's bytes — file (`ReadFile`/`ReadFileUV`), S3 (`S3.download`),
    /// or in-memory — and deliver them to `Handler::on_read_bytes(ctx, result)` on the
    /// JS thread without ever materialising a JSValue. `.ok` bytes are
    /// global-allocator-OWNED by the callback. The point is to give callers
    /// the same store-agnostic dispatch as `.bytes()` while staying in native land,
    /// so e.g. `Bun.Image` can read a `Bun.file`/`Bun.s3` source straight into its
    /// `.owned` buffer with no JS-heap copy in between.
    ///
    /// In-memory stores are duped before the callback so the ownership contract is
    /// uniform (and so the source Blob can outlive or be re-sliced independently);
    /// callers that already special-case `shared_view()` can keep doing that and
    /// only call this when it's empty.
    pub fn read_bytes_to_handler<H: ReadBytesHandler>(
        &mut self,
        ctx: *mut H,
        global: &JSGlobalObject,
    ) -> JsTerminatedResult<()> {
        if self.needs_to_read_file() {
            struct Adapter<H>(core::marker::PhantomData<H>);
            impl<H: ReadBytesHandler> InternalReadFileFn<H> for Adapter<H> {
                fn call(c: *mut H, r: read_file::ReadFileResultType) {
                    // SAFETY: `c` is the `*mut H` passed by the caller and kept
                    // alive across the async read by contract.
                    let c = unsafe { &mut *c };
                    H::on_read_bytes(
                        c,
                        match r {
                            // `is_temporary` ⇒ `r.buf` is the ReadFile Vec's
                            // items handed over (default allocator) — we own it.
                            // SAFETY: `buf` was leaked from a `Box<[u8]>` by the
                            // ReadFile finisher; reclaim it here.
                            read_file::ReadFileResultType::Result(b) => ReadBytesResult::Ok(
                                unsafe { Box::from_raw(b.buf as *mut [u8]) }.into_vec(),
                            ),
                            read_file::ReadFileResultType::Err(e) => ReadBytesResult::Err(e),
                        },
                    );
                }
            }
            self.do_read_file_internal::<H, Adapter<H>>(ctx, global);
            return Ok(());
        }
        if self.is_s3() {
            struct Task<H> {
                ctx: *mut H,
                blob: Blob, // dupe for store ref + offset/size
                poll: bun_aio::KeepAlive,
            }
            impl<H: ReadBytesHandler> Task<H> {
                fn done(mut self: Box<Self>, r: ReadBytesResult) {
                    self.poll.unref(vm_ctx());
                    self.blob.deinit();
                    // SAFETY: caller-owned ctx, kept alive by contract.
                    let c = unsafe { &mut *self.ctx };
                    drop(self);
                    H::on_read_bytes(c, r);
                }
                fn cb(
                    result: crate::webcore::__s3_client::S3DownloadResult,
                    opaque_self: *mut c_void,
                ) -> JsTerminatedResult<()> {
                    // SAFETY: `opaque_self` was Box::into_raw'd below.
                    let t = unsafe { Box::from_raw(opaque_self.cast::<Task<H>>()) };
                    match result {
                        // `body` is owned by us (simple_request.rs); take the Vec's items as-is.
                        crate::webcore::__s3_client::S3DownloadResult::Success(response) => {
                            t.done(ReadBytesResult::Ok(response.body.list));
                        }
                        // S3Error has its own JS-error builder; flatten to a
                        // SystemError so the callback has one shape to handle.
                        crate::webcore::__s3_client::S3DownloadResult::NotFound(e)
                        | crate::webcore::__s3_client::S3DownloadResult::Failure(e) => {
                            let path = t
                                .blob
                                .store
                                .as_ref()
                                .and_then(|s| s.get_path())
                                .unwrap_or(b"");
                            t.done(ReadBytesResult::Err(bun_jsc::SystemError {
                                code: BunString::clone_utf8(e.code),
                                message: BunString::clone_utf8(e.message),
                                path: BunString::clone_utf8(path),
                                syscall: BunString::static_("fetch"),
                                ..Default::default()
                            }));
                        }
                    }
                    Ok(())
                }
            }
            let mut t = Box::new(Task::<H> {
                ctx,
                blob: self.dupe(),
                poll: bun_aio::KeepAlive::default(),
            });
            t.poll.ref_(vm_ctx());
            let proxy = http_proxy_href(global);
            let (cred, path, payer);
            {
                let s3 = t.blob.store.as_ref().unwrap().data.as_s3();
                cred = s3.get_credentials();
                path = s3.path() as *const [u8];
                payer = s3.request_payer;
            }
            // SAFETY: `path` borrows the store held by `t.blob` (a fresh +1 ref);
            // it stays valid until `Task::done` deinits the blob in the callback.
            let path = unsafe { &*path };
            let t_ptr = Box::into_raw(t).cast::<c_void>();
            if self.offset > 0 || self.size != MAX_SIZE {
                let len: Option<usize> =
                    if self.size != MAX_SIZE { Some(self.size as usize) } else { None };
                crate::webcore::__s3_client::download_slice(
                    cred, path, self.offset as usize, len,
                    Task::<H>::cb, t_ptr, proxy.as_deref(), payer,
                )?;
            } else {
                crate::webcore::__s3_client::download(
                    cred, path, Task::<H>::cb, t_ptr, proxy.as_deref(), payer,
                )?;
            }
            return Ok(());
        }
        // In-memory or detached.
        let view = self.shared_view();
        let owned = view.to_vec(); // PERF(port): was allocator.dupe — global mimalloc
        // SAFETY: caller-owned ctx.
        H::on_read_bytes(unsafe { &mut *ctx }, ReadBytesResult::Ok(owned));
        Ok(())
    }

    /// `Bun.file("…").image(opts?)` ≡ `new Bun.Image(this, opts?)`. Lives here so
    /// the proto entry covers Blob/BunFile/S3File in one place; the actual
    /// construction is `Image::from_blob_js` so Blob.rs doesn't grow image
    /// knowledge.
    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn do_image(_this: &mut Self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        Image::from_blob_js(global, cf.this(), cf.argument(0))
    }

    pub fn do_read_file_internal<C, F: InternalReadFileFn<C>>(
        &mut self,
        ctx: *mut C,
        global: &JSGlobalObject,
    ) {
        #[cfg(windows)]
        {
            return read_file::ReadFileUV::start(
                // SAFETY: `bun_vm()` returns the live VM for this global.
                unsafe { &*global.bun_vm() }.event_loop(),
                self.store.as_ref().unwrap().clone(),
                self.offset,
                self.size,
                NewInternalReadFileHandler::<C, F>::run,
                ctx.cast::<c_void>(),
            );
        }
        #[cfg(not(windows))]
        {
            let file_read = read_file::ReadFile::create_with_ctx(
                self.store.as_ref().unwrap().clone(),
                ctx.cast::<c_void>(),
                NewInternalReadFileHandler::<C, F>::run,
                self.offset,
                self.size,
            )
            .unwrap_or_else(|e| bun_core::handle_oom(Err(e)));
            let read_file_task =
                read_file::ReadFileTask::create_on_js_thread(global, Box::into_raw(file_read));
            read_file::ReadFileTask::schedule(read_file_task);
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FormDataContext
// ──────────────────────────────────────────────────────────────────────────

struct FormDataContext {
    joiner: StringJoiner,
    boundary: *const [u8], // borrowed; outlives the joiner
    failed: bool,
    global_this: *const JSGlobalObject,
}

impl FormDataContext {
    pub fn on_entry(&mut self, name: ZigString, entry: FormDataEntry<'_>) {
        if self.failed {
            return;
        }
        // SAFETY: global_this is valid for the duration of from_dom_form_data.
        let global_this = unsafe { &*self.global_this };
        let joiner = &mut self.joiner;
        // SAFETY: boundary outlives the joiner (stack buffer in from_dom_form_data).
        let boundary = unsafe { &*self.boundary };

        joiner.push_static(b"--");
        joiner.push_static(boundary); // note: "static" here means "outlives the joiner"
        joiner.push_static(b"\r\n");

        joiner.push_static(b"Content-Disposition: form-data; name=\"");
        // PORT NOTE: Zig `joiner.push(slice, allocator?)` encoded ownership in
        // the optional allocator. `StringJoiner::push_owned` is the Rust
        // equivalent; `ZigStringSlice::into_vec` moves out the buffer if owned
        // or copies if borrowed (matching Zig's `null`-allocator borrow case).
        joiner.push_owned(name.to_slice().into_vec().into_boxed_slice());

        match entry {
            FormDataEntry::String(value) => {
                joiner.push_static(b"\"\r\n\r\n");
                joiner.push_owned(value.to_slice().into_vec().into_boxed_slice());
            }
            FormDataEntry::File { blob, filename } => {
                joiner.push_static(b"\"; filename=\"");
                joiner.push_owned(filename.to_slice().into_vec().into_boxed_slice());
                joiner.push_static(b"\"\r\n");

                let content_type: &[u8] = if !blob.content_type_slice().is_empty() {
                    blob.content_type_slice()
                } else {
                    b"application/octet-stream"
                };
                joiner.push_static(b"Content-Type: ");
                joiner.push_cloned(content_type);
                joiner.push_static(b"\r\n\r\n");

                if blob.store.is_some() {
                    if blob.size == MAX_SIZE {
                        blob.resolve_size();
                    }
                    let store = blob.store.as_deref().unwrap();
                    match &store.data {
                        store::Data::S3(_) => {
                            // TODO: s3
                            // we need to make this async and use download/downloadSlice
                        }
                        store::Data::File(file) => {
                            // TODO: make this async + lazy
                            // PORT NOTE (layering): Zig used the per-VM cached
                            // `globalThis.bunVM().nodeFS()`. That accessor lives
                            // behind a `bun_runtime → bun_jsc` cycle, so use a
                            // fresh stack `NodeFS` (it is stateless aside from a
                            // path scratch buffer; the per-VM cache is purely a
                            // perf reuse).
                            let mut node_fs = crate::node::node_fs::NodeFS::default();
                            let res = node_fs.read_file(
                                &crate::node::node_fs::args::ReadFile {
                                    encoding: crate::node::types::Encoding::Buffer,
                                    path: file.pathlike.clone(),
                                    offset: blob.offset,
                                    max_size: Some(blob.size),
                                    ..Default::default()
                                },
                                crate::node::node_fs::Flavor::Sync,
                            );
                            match res {
                                bun_sys::Maybe::Err(err) => {
                                    self.failed = true;
                                    let Ok(js_err) = err.to_js(global_this) else { return };
                                    let _ = global_this.throw_value(js_err);
                                }
                                bun_sys::Maybe::Ok(result) => {
                                    // PORT NOTE: Zig handed `result.buffer.allocator`
                                    // to the joiner so it freed in-place.
                                    // `StringOrBuffer::slice()` borrows; clone into
                                    // the joiner so `result` can drop normally.
                                    joiner.push_cloned(result.slice());
                                }
                            }
                        }
                        store::Data::Bytes(_) => {
                            joiner.push_cloned(blob.shared_view());
                        }
                    }
                }
            }
        }

        joiner.push_static(b"\r\n");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// getContentType
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    pub fn get_content_type(&self) -> Option<ZigStringSlice> {
        let ct = self.content_type_slice();
        if !ct.is_empty() {
            return Some(ZigStringSlice::from_utf8_never_free(ct));
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Structured clone serialize / deserialize
// ──────────────────────────────────────────────────────────────────────────

struct StructuredCloneWriter {
    ctx: *mut c_void,
    // TODO(port): callconv(jsc.conv) — use // TODO(b2-blocked): #[bun_jsc::host_call] ABI on the fn ptr type.
    impl_: unsafe extern "C" fn(*mut c_void, *const u8, u32),
}

impl StructuredCloneWriter {
    pub fn write(&self, bytes: &[u8]) -> usize {
        // SAFETY: ctx and impl_ are supplied by C++ SerializedScriptValue and valid
        // for the duration of on_structured_clone_serialize.
        unsafe { (self.impl_)(self.ctx, bytes.as_ptr(), bytes.len() as u32) };
        bytes.len()
    }
}

// Zig used std.Io.GenericWriter over StructuredCloneWriter; map onto
// `bun_io::Write` so `write_int_le` / `write_all` work directly.
impl bun_io::Write for StructuredCloneWriter {
    fn write_all(&mut self, bytes: &[u8]) -> Result<(), bun_core::Error> {
        StructuredCloneWriter::write(self, bytes);
        Ok(())
    }
}

impl Blob {
    fn _on_structured_clone_serialize<W: bun_io::Write>(&mut self, writer: &mut W) -> Result<(), bun_core::Error> {
        writer.write_int_le::<u8>(SERIALIZATION_VERSION)?;
        writer.write_int_le::<u64>(u64::try_from(self.offset).unwrap())?;

        let ct = self.content_type_slice();
        writer.write_int_le::<u32>(ct.len() as u32)?;
        writer.write_all(ct)?;
        writer.write_int_le::<u8>(self.content_type_was_set as u8)?;

        let store_tag: store::SerializeTag = if let Some(store) = &self.store {
            if matches!(store.data, store::Data::File(_)) {
                store::SerializeTag::File
            } else {
                store::SerializeTag::Bytes
            }
        } else {
            store::SerializeTag::Empty
        };

        writer.write_int_le::<u8>(store_tag as u8)?;

        self.resolve_size();
        if let Some(store) = &self.store {
            store.serialize(writer)?;
        }

        writer.write_int_le::<u8>(self.is_jsdom_file as u8)?;
        write_float::<W>(self.last_modified, writer)?;

        // Serialize File name if this is a File object
        if self.is_jsdom_file {
            if let Some(name_string) = self.get_name_string() {
                let name_slice = name_string.to_utf8();
                writer.write_int_le::<u32>(name_slice.slice().len() as u32)?;
                writer.write_all(name_slice.slice())?;
            } else {
                // No name available, write empty string
                writer.write_int_le::<u32>(0)?;
            }
        }
        Ok(())
    }

    pub fn on_structured_clone_serialize(
        &mut self,
        _global_this: &JSGlobalObject,
        ctx: *mut c_void,
        write_bytes: unsafe extern "C" fn(*mut c_void, *const u8, u32),
    ) {
        let mut writer = StructuredCloneWriter { ctx, impl_: write_bytes };
        // TODO(port): wrap StructuredCloneWriter in a bun_io::Write adapter.
        let _ = self._on_structured_clone_serialize(&mut writer);
    }

    pub fn on_structured_clone_transfer(
        &mut self,
        _global_this: &JSGlobalObject,
        _ctx: *mut c_void,
        _write: unsafe extern "C" fn(*mut c_void, *const u8, usize),
    ) {
        // no-op
    }
}

// Only ever called with f64 (Blob.last_modified). Zig generic `comptime FloatType`
// collapses to a concrete impl here because Rust forbids `[u8; size_of::<F>()]`
// without `generic_const_exprs`. `@bitCast` → native-endian bytes.
fn write_float<W: bun_io::Write>(value: f64, writer: &mut W) -> Result<(), bun_core::Error> {
    writer.write_all(&value.to_ne_bytes())
}

fn read_float<B: AsRef<[u8]>>(reader: &mut bun_io::FixedBufferStream<B>) -> Result<f64, bun_core::Error> {
    let mut bytes_buf = [0u8; core::mem::size_of::<f64>()];
    reader.read_exact(&mut bytes_buf)?;
    Ok(f64::from_ne_bytes(bytes_buf))
}

fn read_slice<B: AsRef<[u8]>>(reader: &mut bun_io::FixedBufferStream<B>, len: usize) -> Result<Vec<u8>, bun_core::Error> {
    let mut slice = vec![0u8; len];
    reader.read_exact(&mut slice).map_err(|_| bun_core::err!("TooSmall"))?;
    Ok(slice)
}

fn _on_structured_clone_deserialize<B: AsRef<[u8]>>(
    global_this: &JSGlobalObject,
    reader: &mut bun_io::FixedBufferStream<B>,
) -> Result<JSValue, bun_core::Error> {
    let version = reader.read_int_le::<u8>()?;
    let offset = reader.read_int_le::<u64>()?;

    let content_type_len = reader.read_int_le::<u32>()?;
    let mut content_type = read_slice(reader, content_type_len as usize)?;
    // Ownership transfers to `blob.content_type` at the end of the success
    // path below; until then `content_type`'s Drop is responsible for it.
    // (errdefer → automatic Drop on `?`.)

    let content_type_was_set: bool = reader.read_int_le::<u8>()? != 0;

    let store_tag = store::SerializeTag::from_raw(reader.read_int_le::<u8>()?)
        .ok_or(bun_core::err!("InvalidValue"))?;

    let blob: *mut Blob = match store_tag {
        store::SerializeTag::Bytes => 'bytes: {
            let bytes_len = reader.read_int_le::<u32>()?;
            let bytes = read_slice(reader, bytes_len as usize)?;

            let mut blob = Blob::init(bytes, global_this);
            // `blob` now owns `bytes` (via its Store when non-empty). If any
            // of the remaining reads fail before we heap-promote it, Drop on
            // `blob` releases the store so the payload bytes don't leak.
            let guard = scopeguard::guard(blob, |mut b| b.deinit());

            'versions: {
                if version == 1 { break 'versions; }

                let name_len = reader.read_int_le::<u32>()?;
                let name = read_slice(reader, name_len as usize)?;

                let mut name_consumed = false;
                // ScopeGuard derefs to its inner Blob.
                if let Some(store) = &(*guard).store {
                    if let store::Data::Bytes(bytes_store) = &mut store.data_mut() {
                        bytes_store.stored_name = bun_str::PathString::init(&name);
                        name_consumed = true;
                    }
                }
                if !name_consumed {
                    drop(name);
                }

                if version == 2 { break 'versions; }
            }

            let blob = scopeguard::ScopeGuard::into_inner(guard);
            break 'bytes Blob::new(blob);
        }
        store::SerializeTag::File => 'file: {
            use crate::node::types::PathOrFileDescriptorSerializeTag;
            let pathlike_tag = PathOrFileDescriptorSerializeTag::from_raw(reader.read_int_le::<u8>()?)
                .ok_or(bun_core::err!("InvalidValue"))?;

            match pathlike_tag {
                PathOrFileDescriptorSerializeTag::Fd => {
                    // TODO(port): readStruct(bun.FD) — read raw FD bytes.
                    let fd: Fd = reader.read_struct()?;
                    let mut path_or_fd = PathOrFileDescriptor::Fd(fd);
                    break 'file Blob::new(Blob::find_or_create_file_from_path(
                        &mut path_or_fd,
                        global_this,
                        true,
                    ));
                }
                PathOrFileDescriptorSerializeTag::Path => {
                    let path_len = reader.read_int_le::<u32>()?;
                    let path = read_slice(reader, path_len as usize)?;
                    let mut dest = PathOrFileDescriptor::Path(node::PathLike::String(
                        bun_str::PathString::init(&path),
                    ));
                    break 'file Blob::new(Blob::find_or_create_file_from_path(
                        &mut dest,
                        global_this,
                        true,
                    ));
                }
            }
            #[allow(unreachable_code)]
            return Ok(JSValue::ZERO);
        }
        store::SerializeTag::Empty => Blob::new(Blob::init_empty(global_this)),
    };
    // `blob` is heap-allocated past this point; on any remaining error
    // (truncated trailer fields) tear down both the heap object and its
    // store. `content_type` is handled by its own Drop above since it
    // hasn't been attached to `blob` yet.
    // SAFETY: blob is a freshly-allocated heap pointer from Blob::new.
    let mut blob_guard = scopeguard::guard(blob, |b| unsafe { (*b).deinit() });
    let blob = unsafe { &mut **blob_guard };

    'versions: {
        if version == 1 { break 'versions; }

        blob.is_jsdom_file = reader.read_int_le::<u8>()? != 0;
        blob.last_modified = read_float(reader)?;

        if version == 2 { break 'versions; }

        // Version 3: Read File name if this is a File object
        if blob.is_jsdom_file {
            let name_len = reader.read_int_le::<u32>()?;
            let name_bytes = read_slice(reader, name_len as usize)?;
            blob.name = BunString::clone_utf8(&name_bytes);
        }

        if version == 3 { break 'versions; }
    }

    debug_assert!(blob.is_heap_allocated(), "expected blob to be heap-allocated");

    // `offset` comes from untrusted bytes. Clamp it so a crafted payload cannot
    // make shared_view() slice past the end of the backing store (OOB heap read).
    blob.offset = offset as SizeType; // intentional truncate
    if let Some(store) = &blob.store {
        let store_size = store.size();
        if store_size != MAX_SIZE {
            blob.offset = blob.offset.min(store_size);
            blob.size = blob.size.min(store_size - blob.offset);
        }
    } else {
        blob.offset = 0;
    }

    if !content_type.is_empty() {
        let leaked = content_type.into_boxed_slice();
        blob.content_type = Box::into_raw(leaked);
        blob.content_type_allocated = true;
        blob.content_type_was_set = content_type_was_set;
        // Ownership handed to `blob`; disarm the implicit drop by replacing local.
        content_type = Vec::new();
    }
    let _ = content_type;

    let blob_ptr = scopeguard::ScopeGuard::into_inner(blob_guard);
    // SAFETY: blob_ptr is valid; toJS is infallible. Explicit `&mut *` forces
    // the inherent `Blob::to_js(&mut self)` over `JsClass::to_js(self)`.
    Ok(unsafe { (&mut *blob_ptr).to_js(global_this) })
}

impl Blob {
    pub fn on_structured_clone_deserialize(
        global_this: &JSGlobalObject,
        ptr: &mut *mut u8,
        end: *mut u8,
    ) -> JsResult<JSValue> {
        let total_length: usize = (end as usize) - (*ptr as usize);
        // SAFETY: caller guarantees [*ptr, end) is a valid byte range.
        let mut buffer_stream =
            bun_io::FixedBufferStream::new(unsafe { core::slice::from_raw_parts(*ptr, total_length) });

        let result = match _on_structured_clone_deserialize(global_this, &mut buffer_stream) {
            Ok(v) => v,
            Err(e) if e == bun_core::err!("EndOfStream")
                || e == bun_core::err!("TooSmall")
                || e == bun_core::err!("InvalidValue") =>
            {
                return Err(global_this.throw("Blob.onStructuredCloneDeserialize failed"));
            }
            Err(e) if e == bun_core::err!("OutOfMemory") => {
                return Err(global_this.throw_out_of_memory());
            }
            Err(_) => unreachable!(),
        };

        // Advance the pointer by the number of bytes consumed
        // SAFETY: buffer_stream.pos() <= (end - *ptr) by construction; result stays within [*ptr, end].
        *ptr = unsafe { (*ptr).add(buffer_stream.pos) };

        Ok(result)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// URLSearchParamsConverter / fromURLSearchParams / fromDOMFormData
// ──────────────────────────────────────────────────────────────────────────

struct URLSearchParamsConverter {
    buf: Vec<u8>,
    global_this: *const JSGlobalObject,
}

impl URLSearchParamsConverter {
    pub fn convert(&mut self, str: ZigString) {
        self.buf = str.to_owned_slice();
    }
}

impl Blob {
    pub fn from_url_search_params(
        global_this: &JSGlobalObject,
        search_params: &mut jsc::URLSearchParams,
    ) -> Blob {
        let mut converter = URLSearchParamsConverter {
            buf: Vec::new(),
            global_this: global_this,
        };
        search_params.to_string(&mut converter, URLSearchParamsConverter::convert);
        let store = Store::init(converter.buf);
        // SAFETY: `store` is the sole +1 on this freshly-allocated Store.
        unsafe {
            (*store.as_ptr()).mime_type = bun_http_types::MimeType::Compact::from(
                bun_http_types::MimeType::Table::from_mime_literal(
                    "application/x-www-form-urlencoded;charset=UTF-8",
                ),
            )
            .to_mime_type();
        }
        let content_type_ptr = store.mime_type.value.as_ref() as *const [u8];

        let mut blob = Blob::init_with_store(store, global_this);
        blob.content_type = content_type_ptr;
        blob.content_type_was_set = true;
        blob
    }

    pub fn from_dom_form_data(
        global_this: &JSGlobalObject,
        form_data: &mut jsc::DOMFormData,
    ) -> Blob {
        // PERF(port): was arena bulk-free + stack-fallback alloc — profile in Phase B.

        let mut hex_buf = [0u8; 70];
        let boundary = {
            // SAFETY: bun_vm() never returns null for a Bun-owned global.
            let random = unsafe { (*global_this.bun_vm()).rare_data() }.next_uuid().bytes;
            use std::io::Write;
            let mut cursor = &mut hex_buf[..];
            write!(&mut cursor, "----WebKitFormBoundary{:x?}", &random).expect("unreachable");
            let written = 70 - cursor.len();
            &hex_buf[..written]
        };

        let mut context = FormDataContext {
            joiner: bun_str::string_joiner::StringJoiner::default(),
            boundary: boundary as *const [u8],
            failed: false,
            global_this: global_this,
        };

        // PORT NOTE (layering): `bun_jsc::DOMFormData::for_each` yields the
        // lower-tier `bun_jsc::dom_form_data::FormDataEntry`, whose `blob`
        // field is `&bun_jsc::WebCore::Blob` (the forward-decl). The native
        // pointer the C++ hands us is the `m_ctx` `*mut Blob`; reinterpret it
        // as the runtime `&mut Blob` here. Driving the FFI directly (rather
        // than going through `for_each`'s immutable wrapper) avoids a
        // `&T → &mut T` cast.
        unsafe extern "C" fn for_each_thunk(
            ctx_ptr: *mut c_void,
            name_: *mut ZigString,
            value_ptr: *mut c_void,
            filename: *mut ZigString,
            is_blob: u8,
        ) {
            // SAFETY: `ctx_ptr` is the `&mut FormDataContext` passed below.
            let ctx = unsafe { &mut *(ctx_ptr as *mut FormDataContext) };
            let entry = if is_blob == 0 {
                // SAFETY: when `is_blob == 0`, `value_ptr` points to a `ZigString`.
                FormDataEntry::String(unsafe { *(value_ptr as *mut ZigString) })
            } else {
                FormDataEntry::File {
                    // SAFETY: `value_ptr` is the C++ `JSBlob::m_ctx` (`*mut Blob`);
                    // valid for the synchronous callback scope.
                    blob: unsafe { &mut *(value_ptr as *mut Blob) },
                    filename: if filename.is_null() {
                        ZigString::EMPTY
                    } else {
                        // SAFETY: non-null `filename` is a valid `*ZigString` for this call.
                        unsafe { *filename }
                    },
                }
            };
            // SAFETY: `name_` is always a valid non-null `*ZigString` for this callback.
            ctx.on_entry(unsafe { *name_ }, entry);
        }
        unsafe extern "C" {
            fn DOMFormData__forEach(
                this: *mut jsc::DOMFormData,
                ctx: *mut c_void,
                cb: unsafe extern "C" fn(*mut c_void, *mut ZigString, *mut c_void, *mut ZigString, u8),
            );
        }
        // SAFETY: C++ invokes the callback synchronously and does not retain
        // `ctx`/`cb` past this call.
        unsafe {
            DOMFormData__forEach(form_data, &mut context as *mut _ as *mut c_void, for_each_thunk);
        }
        if context.failed {
            // The joiner's Node structs are owned by the (former) arena, but each
            // node's data carries its own owner allocator — heap for non-ASCII
            // name/value slices and the NodeFS read_file result buffer. Drop the
            // joiner (Drop runs StringJoiner::deinit) so every heap-owned slice
            // already pushed is freed.
            drop(context.joiner);
            return Blob::init_empty(global_this);
        }

        context.joiner.push_static(b"--");
        context.joiner.push_static(boundary);
        context.joiner.push_static(b"--\r\n");

        let store = Store::init(
            context
                .joiner
                .done()
                .map(|b| b.into_vec())
                .unwrap_or_else(|_| bun_core::out_of_memory()),
        );
        let mut blob = Blob::init_with_store(store, global_this);
        // Always allocate content_type with the default allocator so deinit() can
        // free it unconditionally.
        let mut ct = Vec::new();
        {
            use std::io::Write;
            write!(
                &mut ct,
                "multipart/form-data; boundary={}",
                bstr::BStr::new(boundary)
            )
            .unwrap();
        }
        blob.content_type = Box::into_raw(ct.into_boxed_slice());
        blob.content_type_allocated = true;
        blob.content_type_was_set = true;

        blob
    }

    pub fn content_type(&self) -> &[u8] {
        self.content_type_slice()
    }

    pub fn is_detached(&self) -> bool {
        self.store.is_none()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// C-exported helpers
// ──────────────────────────────────────────────────────────────────────────

#[unsafe(no_mangle)]
pub extern "C" fn Blob__dupeFromJS(value: JSValue) -> Option<NonNull<Blob>> {
    let this = Blob::from_js(value)?;
    // SAFETY: Blob__dupe returns Box::into_raw of a fresh allocation; never null.
    // SAFETY: `from_js` returns a live heap pointer when Some.
    Some(unsafe { NonNull::new_unchecked(Blob__dupe(&*this)) })
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__setAsFile(this: &mut Blob, path_str: &mut BunString) {
    this.is_jsdom_file = true;

    // This is not 100% correct...
    if let Some(store) = &this.store {
        if let store::Data::Bytes(bytes) = &mut store.data_mut() {
            if bytes.stored_name.is_empty() {
                let utf8 = path_str.to_utf8();
                bytes.stored_name = bun_str::PathString::init(utf8.slice());
            }
        }
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__dupe(this: &Blob) -> *mut Blob {
    Blob::new(this.dupe_with_content_type(true))
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__getFileNameString(this: &Blob) -> BunString {
    if let Some(filename) = this.get_file_name() {
        return BunString::from_bytes(filename);
    }
    BunString::empty()
}

// ──────────────────────────────────────────────────────────────────────────
// writeFormat
// ──────────────────────────────────────────────────────────────────────────

pub fn write_format_for_size<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
    is_jdom_file: bool,
    size: usize,
    writer: &mut W,
) -> core::fmt::Result {
    if is_jdom_file {
        write!(writer, "{}", Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>File<r>"))?;
    } else {
        write!(writer, "{}", Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>Blob<r>"))?;
    }
    write!(
        writer,
        "{}",
        // TODO(port): Output::pretty_fmt with embedded format args
        bun_core::fmt::size(size, Default::default())
    )
}

impl Blob {
    pub fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &mut self,
        formatter: &mut F,
        writer: &mut W,
    ) -> core::fmt::Result
    where
        F: jsc::ConsoleFormatter,
        W: core::fmt::Write,
    {
        if self.is_detached() {
            // A blob with no store and size > 0 was genuinely detached (e.g. after
            // transferring its contents). An empty `new Blob([])` or `new File([])`
            // also has no store but is a valid zero-byte blob — render it like a
            // normal zero-sized blob instead of calling it "detached".
            if self.size > 0 {
                if self.is_jsdom_file {
                    write!(writer, "{}", Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                        "<d>[<r>File<r> detached<d>]<r>",
                    ))?;
                } else {
                    write!(writer, "{}", Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                        "<d>[<r>Blob<r> detached<d>]<r>",
                    ))?;
                }
                return Ok(());
            }
            write_format_for_size::<W, ENABLE_ANSI_COLORS>(self.is_jsdom_file, 0, writer)?;
        } else {
            let content_type = self.content_type_slice();
            let offset = self.offset;
            let store = self.store.as_ref().unwrap();
            match store.data_mut() {
                store::Data::S3(s3) => {
                    S3File::write_format::<F, W, ENABLE_ANSI_COLORS>(
                        s3, formatter, writer, content_type, offset as u64,
                    )
                    .map_err(|_| core::fmt::Error)?;
                }
                store::Data::File(file) => {
                    write!(writer, "{}", Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>FileRef<r>"))?;
                    match &file.pathlike {
                        PathOrFileDescriptor::Path(path) => {
                            // TODO(port): Output::pretty_fmt with embedded {s}
                            write!(writer, " (\"{}\")", bstr::BStr::new(path.slice()))?;
                        }
                        PathOrFileDescriptor::Fd(fd) => {
                            #[cfg(windows)]
                            match fd.decode_windows() {
                                bun_sys::WindowsFd::Uv(uv_file) => {
                                    write!(writer, " (fd: {})", uv_file)?;
                                }
                                bun_sys::WindowsFd::Windows(handle) => {
                                    if cfg!(debug_assertions) {
                                        panic!("this shouldn't be reachable.");
                                    }
                                    write!(writer, " (fd: 0x{:x})", handle as usize)?;
                                }
                            }
                            #[cfg(not(windows))]
                            write!(writer, " (fd: {})", fd.native())?;
                        }
                    }
                }
                store::Data::Bytes(_) => {
                    write_format_for_size::<W, ENABLE_ANSI_COLORS>(
                        self.is_jsdom_file,
                        self.size as usize,
                        writer,
                    )?;
                }
            }
        }

        let show_name = (self.is_jsdom_file && self.get_name_string().is_some())
            || (!self.name.is_empty()
                && self.store.is_some()
                && matches!(self.store.as_ref().unwrap().data, store::Data::Bytes(_)));
        if !self.is_s3()
            && (!self.content_type_slice().is_empty()
                || self.offset > 0
                || show_name
                || self.last_modified != 0.0)
        {
            writer.write_str(" {\n")?;
            {
                formatter.indent_inc();

                if show_name {
                    formatter.write_indent(writer)?;
                    write!(
                        writer,
                        "name: \"{}\"",
                        self.get_name_string().unwrap_or_else(BunString::empty)
                    )?;
                    if !self.content_type_slice().is_empty() || self.offset > 0 || self.last_modified != 0.0 {
                        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                    }
                    writer.write_str("\n")?;
                }

                if !self.content_type_slice().is_empty() {
                    formatter.write_indent(writer)?;
                    write!(writer, "type: \"{}\"", bstr::BStr::new(self.content_type_slice()))?;
                    if self.offset > 0 || self.last_modified != 0.0 {
                        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                    }
                    writer.write_str("\n")?;
                }

                if self.offset > 0 {
                    formatter.write_indent(writer)?;
                    write!(writer, "offset: {}\n", self.offset)?;
                    if self.last_modified != 0.0 {
                        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                    }
                    writer.write_str("\n")?;
                }

                if self.last_modified != 0.0 {
                    formatter.write_indent(writer)?;
                    write!(writer, "lastModified: {}\n", self.last_modified)?;
                }

                formatter.indent_dec();
            }
            formatter.write_indent(writer)?;
            writer.write_str("}")?;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// mkdirIfNotExists / Retry
// ──────────────────────────────────────────────────────────────────────────

#[derive(Copy, Clone, PartialEq, Eq)]
pub enum Retry {
    Continue,
    Fail,
    No,
}

// TODO: move this to bun_sys?
// we choose not to inline this so that the path buffer is not on the stack unless necessary.
#[inline(never)]
pub fn mkdir_if_not_exists<T: MkdirpTarget>(
    this: &mut T,
    err: bun_sys::Error,
    path_string: &bun_str::ZStr,
    err_path: &[u8],
) -> Retry {
    if err.get_errno() == bun_sys::E::ENOENT && this.mkdirp_if_not_exists() {
        // Zig: `std.fs.path.dirname(path_string)` → `bun_core::dirname` (Option-returning).
        if let Some(dirname) = bun_core::dirname(path_string.as_bytes()) {
            let mut node_fs = node::fs::NodeFS::default();
            match node_fs.mkdir_recursive(&node::fs::args::Mkdir {
                path: node::PathLike::String(bun_str::PathString::init(dirname)),
                recursive: true,
                always_return_none: true,
                ..Default::default()
            }) {
                bun_sys::Result::Ok(_) => {
                    this.set_mkdirp_if_not_exists(false);
                    return Retry::Continue;
                }
                bun_sys::Result::Err(err2) => {
                    this.set_errno_if_present(bun_core::errno_to_zig_err(err2.errno as i32));
                    this.set_system_error(err.with_path(err_path).to_system_error());
                    this.set_opened_fd_if_present(Fd::INVALID);
                    return Retry::Fail;
                }
            }
        }
    }
    Retry::No
}

/// Local shim for Zig's `bun.sys.Error.withPathLike` — `bun_sys::Error` only
/// exposes `with_path(&[u8])` on the Rust side, so route through the
/// `PathOrFileDescriptor`'s slice when it's a path and leave the error
/// unchanged for fds (matching Zig, which formats the fd into the message).
#[inline]
fn sys_error_with_path_like(err: &bun_sys::Error, pathlike: &PathOrFileDescriptor) -> bun_sys::Error {
    match pathlike {
        PathOrFileDescriptor::Path(p) => err.with_path(p.slice()),
        PathOrFileDescriptor::Fd(_) => err.clone(),
    }
}

/// Trait extracted from the Zig `anytype` receiver of `mkdir_if_not_exists`.
/// The Zig body uses `@hasField` to optionally write `errno` / `opened_fd`.
pub trait MkdirpTarget {
    fn mkdirp_if_not_exists(&self) -> bool;
    fn set_mkdirp_if_not_exists(&mut self, v: bool);
    fn set_system_error(&mut self, e: bun_sys::SystemError);
    fn set_errno_if_present(&mut self, _e: bun_core::Error) {}
    fn set_opened_fd_if_present(&mut self, _fd: Fd) {}
}

// ──────────────────────────────────────────────────────────────────────────
// writeFileWithEmptySourceToDestination / writeFileWithSourceDestination
// ──────────────────────────────────────────────────────────────────────────

#[derive(Default)]
pub struct WriteFileOptions {
    pub mkdirp_if_not_exists: Option<bool>,
    pub extra_options: Option<JSValue>,
    pub mode: Option<bun_sys::Mode>,
}

/// Write an empty string to a file by truncating it.
///
/// This behavior matches what we do with the fast path.
fn write_file_with_empty_source_to_destination(
    ctx: &JSGlobalObject,
    destination_blob: &mut Blob,
    options: &WriteFileOptions,
) -> JsResult<JSValue> {
    // SAFETY: null-checked by caller
    let destination_store = destination_blob.store.as_ref().unwrap().clone();
    let _detach = scopeguard::guard(&mut *destination_blob, |b| b.detach());

    match &destination_store.data {
        store::Data::File(file) => {
            // TODO: make this async
            // `VirtualMachine::node_fs()` currently returns `*mut c_void`; the
            // typed `&mut NodeFS` accessor isn't wired yet, so use a fresh
            // `NodeFS` (matches Zig — it carries no per-call state for
            // `truncate`/`mkdir_recursive`).
            let mut node_fs = node::fs::NodeFS::default();
            let mut result = node_fs.truncate(
                &node::fs::args::Truncate {
                    path: file.pathlike.dupe(),
                    len: 0,
                    flags: bun_sys::O::CREAT,
                },
                node::fs::Flavor::Sync,
            );

            if let bun_sys::Result::Err(ref mut err) = result {
                let errno = err.get_errno();
                let mut was_eperm = false;
                'err: {
                    let mut current = errno;
                    loop {
                        match current {
                            // truncate might return EPERM when the parent directory doesn't exist
                            // #6336
                            bun_sys::E::EPERM => {
                                was_eperm = true;
                                err.errno = bun_sys::E::ENOENT as _;
                                current = bun_sys::E::ENOENT;
                                continue;
                            }
                            bun_sys::E::ENOENT => {
                                if options.mkdirp_if_not_exists == Some(false) { break 'err; }
                                let dirpath: &[u8] = match &file.pathlike {
                                    PathOrFileDescriptor::Path(path) => {
                                        // Zig: `std.fs.path.dirname` — Option-returning.
                                        match bun_core::dirname(path.slice()) {
                                            Some(d) => d,
                                            None => break 'err,
                                        }
                                    }
                                    PathOrFileDescriptor::Fd(_) => {
                                        // NOTE: if this is an fd, it means the file
                                        // exists, so we shouldn't try to mkdir it
                                        if was_eperm {
                                            err.errno = bun_sys::E::EPERM as _;
                                        }
                                        break 'err;
                                    }
                                };
                                let mkdir_result = node_fs.mkdir_recursive(&node::fs::args::Mkdir {
                                    path: node::PathLike::String(bun_str::PathString::init(dirpath)),
                                    recursive: true,
                                    always_return_none: true,
                                    ..Default::default()
                                });
                                if let bun_sys::Result::Err(e) = mkdir_result {
                                    *err = e;
                                    break 'err;
                                }

                                // SAFETY: we check if `file.pathlike` is an fd above, returning if it is.
                                let mut buf = bun_paths::PathBuffer::uninit();
                                let mode: bun_sys::Mode =
                                    options.mode.unwrap_or(node::fs::DEFAULT_PERMISSION);
                                loop {
                                    let open_res = bun_sys::open(
                                        file.pathlike.path().slice_z(&mut buf),
                                        bun_sys::O::CREAT | bun_sys::O::TRUNC,
                                        mode,
                                    );
                                    match open_res {
                                        bun_sys::Result::Err(e) => {
                                            if e.get_errno() == bun_sys::E::EINTR { continue; }
                                            *err = e;
                                            break 'err;
                                        }
                                        bun_sys::Result::Ok(fd) => {
                                            fd.close();
                                            return Ok(JSPromise::resolved_promise_value(ctx, JSValue::js_number(0.0)));
                                        }
                                    }
                                }
                            }
                            _ => break 'err,
                        }
                    }
                }

                *err = sys_error_with_path_like(err, &file.pathlike);
                return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    err.to_js(ctx),
                ));
            }
        }
        store::Data::S3(s3) => {
            // create empty file
            let aws_options = match s3.get_credentials_with_options(options.extra_options, ctx) {
                Ok(o) => o,
                Err(err) => {
                    return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        ctx,
                        ctx.take_exception(err),
                    ));
                }
            };

            // TODO(port): local Wrapper struct { promise, store: StoreRef, global }
            // with `resolve(result, opaque_this)` callback. See Zig lines 1098-1146.
            struct Wrapper {
                promise: jsc::JSPromiseStrong,
                store: StoreRef,
                global: *const JSGlobalObject,
            }
            impl Wrapper {
                fn resolve(result: S3UploadResult, opaque_this: *mut c_void) -> jsc::JsTerminatedResult<()> {
                    // SAFETY: opaque_this was Box::into_raw'd in the caller below.
                    let mut this = unsafe { Box::from_raw(opaque_this.cast::<Wrapper>()) };
                    let global = unsafe { &*this.global };
                    match result {
                        S3UploadResult::Success => this.promise.resolve(global, JSValue::js_number(0.0))?,
                        S3UploadResult::Failure(err) => {
                            // SAFETY: sole `&mut JSPromise` borrow; consumed immediately.
                            let err_js = s3_client::error_jsc::s3_error_to_js_with_async_stack(
                                &err, global, this.store.get_path(), unsafe { this.promise.get() },
                            );
                            this.promise.reject(global, Ok(err_js))?;
                        }
                    }
                    Ok(())
                }
            }

            let promise = jsc::JSPromiseStrong::init(ctx);
            let promise_value = promise.value();
            let proxy_owned = http_proxy_href(ctx);
            let proxy_url = proxy_owned.as_deref();
            s3_client::upload(
                &aws_options.credentials,
                s3.path(),
                b"",
                destination_blob.content_type_or_mime_type(),
                // SAFETY: `*const [u8]` borrows from sibling `_*_slice` fields
                // on `aws_options`, which outlives this call.
                aws_options.content_disposition.map(|p| unsafe { &*p }),
                aws_options.content_encoding.map(|p| unsafe { &*p }),
                aws_options.acl,
                proxy_url,
                aws_options.storage_class,
                aws_options.request_payer,
                Wrapper::resolve,
                Box::into_raw(Box::new(Wrapper {
                    promise,
                    store: destination_store.clone(),
                    global: ctx,
                })) as *mut c_void,
            )?;
            return Ok(promise_value);
        }
        // Writing to a buffer-backed blob should be a type error,
        // making this unreachable. TODO: `{}` -> `unreachable`
        store::Data::Bytes(_) => {}
    }

    Ok(JSPromise::resolved_promise_value(ctx, JSValue::js_number(0.0)))
}

pub fn write_file_with_source_destination(
    ctx: &JSGlobalObject,
    source_blob: &mut Blob,
    destination_blob: &mut Blob,
    options: &WriteFileOptions,
) -> JsResult<JSValue> {
    let destination_store = destination_blob
        .store
        .clone()
        .unwrap_or_else(|| Output::panic(format_args!("Destination blob is detached")));
    let destination_type = destination_store.data.tag();

    // TODO: make sure this invariant isn't being broken elsewhere, then upgrade to allow_assert
    if cfg!(debug_assertions) {
        debug_assert!(
            destination_type != store::DataTag::Bytes,
            "Cannot write to a Blob backed by a Buffer or TypedArray. This is a bug in the caller."
        );
    }

    let Some(source_store) = source_blob.store.clone() else {
        return write_file_with_empty_source_to_destination(ctx, destination_blob, options);
    };
    let source_type = source_store.data.tag();

    if destination_type == store::DataTag::File && source_type == store::DataTag::Bytes {
        let write_file_promise = Box::into_raw(Box::new(WriteFilePromise {
            promise: jsc::JSPromiseStrong::default(),
            global_this: ctx,
        }));

        #[cfg(windows)]
        {
            let promise = JSPromise::create(ctx);
            let promise_value = promise.as_value(ctx);
            promise_value.ensure_still_alive();
            // SAFETY: write_file_promise was just produced by Box::into_raw above; sole owner.
            unsafe { (*write_file_promise).promise.strong.set(ctx, promise_value) };
            match write_file_mod::WriteFileWindows::create(
                ctx.bun_vm().event_loop(),
                destination_blob.clone(),
                source_blob.clone(),
                write_file_promise,
                WriteFilePromise::run,
                options.mkdirp_if_not_exists.unwrap_or(true),
            ) {
                Err(e) if e == bun_core::err!("WriteFileWindowsDeinitialized") => {}
                Err(e) => return Err(e.into()),
                Ok(_) => {}
            }
            return Ok(promise_value);
        }

        #[cfg(not(windows))]
        {
            let file_copier = write_file_mod::WriteFile::create(
                destination_blob.dupe(),
                source_blob.dupe(),
                write_file_promise,
                WriteFilePromise::run,
                options.mkdirp_if_not_exists.unwrap_or(true),
            )
            .expect("unreachable");
            let task = write_file_mod::WriteFileTask::create_on_js_thread(ctx, file_copier);
            // Defer promise creation until we're just about to schedule the task.
            // PORT NOTE: Zig wrote `promise.strong.set(ctx, promise_value)` directly;
            // `JSPromiseStrong.strong` is private in `bun_jsc`, so use `init` (which
            // creates the JSPromise *and* the strong handle in one step) instead.
            // SAFETY: write_file_promise was just produced by Box::into_raw above; sole owner.
            unsafe { (*write_file_promise).promise = jsc::JSPromiseStrong::init(ctx) };
            let promise_value = unsafe { (*write_file_promise).promise.value() };
            promise_value.ensure_still_alive();
            task.schedule();
            return Ok(promise_value);
        }
    }
    // If this is file <> file, we can just copy the file
    else if destination_type == store::DataTag::File && source_type == store::DataTag::File {
        #[cfg(windows)]
        {
            return copy_file::CopyFileWindows::init(
                destination_store,
                source_store,
                ctx.bun_vm().event_loop(),
                options.mkdirp_if_not_exists.unwrap_or(true),
                destination_blob.size,
                options.mode,
            );
        }
        #[cfg(not(windows))]
        {
            let mut file_copier = copy_file::CopyFile::create(
                destination_store,
                source_store,
                destination_blob.offset,
                destination_blob.size,
                ctx,
                options.mkdirp_if_not_exists.unwrap_or(true),
                options.mode,
            );
            file_copier.schedule();
            // PORT NOTE: Zig returned `file_copier.promise.value()` directly.
            // `ConcurrentPromiseTask` is consumed by the work-pool and freed via
            // `ManualDeinit` → `destroy(*mut Self)`, so hand ownership over as a
            // raw pointer (paired with `Box::from_raw` in `destroy()`).
            let promise_value = file_copier.promise.value();
            let _ = Box::into_raw(file_copier);
            return Ok(promise_value);
        }
    } else if destination_type == store::DataTag::File && source_type == store::DataTag::S3 {
        let s3 = source_store.data.as_s3();
        if let Some(stream) = ReadableStream::from_js(
            ReadableStream::from_blob_copy_ref(ctx, source_blob, s3.options.part_size as crate::webcore::blob::SizeType)?,
            ctx,
        )? {
            return destination_blob.pipe_readable_stream_to_blob(ctx, stream, options.extra_options);
        } else {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                ctx,
                ctx.create_error_instance("Failed to stream bytes from s3 bucket"),
            ));
        }
    } else if destination_type == store::DataTag::Bytes && source_type == store::DataTag::Bytes {
        // If this is bytes <> bytes, we can just duplicate it
        // this is an edgecase
        // it will happen if someone did Bun.write(new Blob([123]), new Blob([456]))
        let cloned = Blob::new(source_blob.dupe());
        // SAFETY: ptr was just produced by Box::into_raw in Blob::new; the
        // inherent `to_js(&mut self)` (not the by-value `JsClass` one) hands
        // ownership to the C++ wrapper.
        return Ok(JSPromise::resolved_promise_value(ctx, unsafe { (&mut *cloned).to_js(ctx) }));
    } else if destination_type == store::DataTag::Bytes
        && (source_type == store::DataTag::File || source_type == store::DataTag::S3)
    {
        let blob_value = source_blob.get_slice_from(ctx, 0, 0, b"", false);
        return Ok(JSPromise::resolved_promise_value(ctx, blob_value));
    } else if destination_type == store::DataTag::S3 {
        let s3 = destination_store.data.as_s3();
        let aws_options = match s3.get_credentials_with_options(options.extra_options, ctx) {
            Ok(o) => o,
            Err(err) => {
                return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    ctx.take_exception(err),
                ));
            }
        };
        let proxy_owned = http_proxy_href(ctx);
        let proxy_url = proxy_owned.as_deref();
        match &source_store.data {
            store::Data::Bytes(bytes) => {
                if bytes.len() as usize > S3::MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE {
                    if let Some(stream) = ReadableStream::from_js(
                        ReadableStream::from_blob_copy_ref(ctx, source_blob, s3.options.part_size as crate::webcore::blob::SizeType)?,
                        ctx,
                    )? {
                        return Ok(s3_client::upload_stream(
                            // PORT NOTE: Zig conditionally `.dupe()`d when extra_options
                            // were provided (passing ownership). Rust `upload_stream`
                            // takes `&S3Credentials`, and `aws_options.credentials`
                            // already reflects extra_options, so borrow it directly.
                            &aws_options.credentials,
                            s3.path(),
                            stream,
                            ctx,
                            aws_options.options,
                            aws_options.acl,
                            aws_options.storage_class,
                            destination_blob.content_type_or_mime_type(),
                            // SAFETY: `*const [u8]` borrows from sibling `_*_slice`
                            // fields on `aws_options`, which outlives this call.
                            aws_options.content_disposition.map(|p| unsafe { &*p }),
                            aws_options.content_encoding.map(|p| unsafe { &*p }),
                            proxy_url,
                            aws_options.request_payer,
                            None,
                            core::ptr::null_mut(),
                        )?);
                    } else {
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            ctx,
                            ctx.create_error_instance("Failed to stream bytes to s3 bucket"),
                        ));
                    }
                } else {
                    // TODO(port): local Wrapper struct { store: StoreRef, promise, global } with resolve cb.
                    struct Wrapper {
                        store: StoreRef,
                        promise: jsc::JSPromiseStrong,
                        global: *const JSGlobalObject,
                    }
                    impl Wrapper {
                        fn resolve(result: S3UploadResult, opaque_self: *mut c_void) -> jsc::JsTerminatedResult<()> {
                            // SAFETY: opaque_self is the Box::into_raw(Wrapper) we passed to S3::upload below.
                            let mut this = unsafe { Box::from_raw(opaque_self.cast::<Wrapper>()) };
                            // SAFETY: global was stored from a live &JSGlobalObject; the VM outlives this callback.
                            let global = unsafe { &*this.global };
                            match result {
                                S3UploadResult::Success => {
                                    this.promise.resolve(global, JSValue::js_number(this.store.data.as_bytes().len() as f64))?;
                                }
                                S3UploadResult::Failure(err) => {
                                    // SAFETY: sole `&mut JSPromise` borrow; consumed immediately.
                                    let err_js = s3_client::error_jsc::s3_error_to_js_with_async_stack(
                                        &err, global, this.store.get_path(), unsafe { this.promise.get() },
                                    );
                                    this.promise.reject(global, Ok(err_js))?;
                                }
                            }
                            Ok(())
                        }
                    }
                    let promise = jsc::JSPromiseStrong::init(ctx);
                    let promise_value = promise.value();
                    s3_client::upload(
                        &aws_options.credentials,
                        s3.path(),
                        bytes.slice(),
                        destination_blob.content_type_or_mime_type(),
                        // SAFETY: `*const [u8]` borrows from sibling `_*_slice` fields
                        // on `aws_options`, which outlives this call.
                        aws_options.content_disposition.map(|p| unsafe { &*p }),
                        aws_options.content_encoding.map(|p| unsafe { &*p }),
                        aws_options.acl,
                        proxy_url,
                        aws_options.storage_class,
                        aws_options.request_payer,
                        Wrapper::resolve,
                        Box::into_raw(Box::new(Wrapper {
                            store: source_store.clone(),
                            promise,
                            global: ctx,
                        })) as *mut c_void,
                    )?;
                    return Ok(promise_value);
                }
            }
            store::Data::File(_) | store::Data::S3(_) => {
                // stream
                if let Some(stream) = ReadableStream::from_js(
                    ReadableStream::from_blob_copy_ref(ctx, source_blob, s3.options.part_size as crate::webcore::blob::SizeType)?,
                    ctx,
                )? {
                    return Ok(s3_client::upload_stream(
                        // PORT NOTE: Zig conditionally `.dupe()`d when extra_options
                        // were provided. Rust `upload_stream` takes `&S3Credentials`;
                        // `aws_options.credentials` already reflects extra_options.
                        &aws_options.credentials,
                        s3.path(),
                        stream,
                        ctx,
                        s3.options,
                        aws_options.acl,
                        aws_options.storage_class,
                        destination_blob.content_type_or_mime_type(),
                        // SAFETY: `*const [u8]` borrows from sibling `_*_slice` fields
                        // on `aws_options`, which outlives this call.
                        aws_options.content_disposition.map(|p| unsafe { &*p }),
                        aws_options.content_encoding.map(|p| unsafe { &*p }),
                        proxy_url,
                        aws_options.request_payer,
                        None,
                        core::ptr::null_mut(),
                    )?);
                } else {
                    return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        ctx,
                        ctx.create_error_instance("Failed to stream bytes to s3 bucket"),
                    ));
                }
            }
        }
    }

    unreachable!()
}

// ──────────────────────────────────────────────────────────────────────────
// writeFileInternal / writeFile (Bun.write)
// ──────────────────────────────────────────────────────────────────────────

/// ## Errors
/// - If `path_or_blob` is a detached blob
/// ## Panics
/// - If `path_or_blob` is a `Blob` backed by a byte store
pub fn write_file_internal(
    global_this: &JSGlobalObject,
    path_or_blob_: &mut PathOrBlob,
    data: JSValue,
    options: WriteFileOptions,
) -> JsResult<JSValue> {
    if data.is_empty_or_undefined_or_null() {
        return Err(global_this.throw_invalid_arguments(
            "Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write",
        ));
    }
    // PORT NOTE: Zig copies `path_or_blob_.*`; Blob is non-Clone, so reborrow.
    let path_or_blob = &mut *path_or_blob_;
    if let PathOrBlob::Blob(ref blob) = *path_or_blob {
        let Some(blob_store) = &blob.store else {
            return Err(global_this.throw_invalid_arguments("Blob is detached"));
        };
        debug_assert!(!matches!(blob_store.data, store::Data::Bytes(_)));
        // TODO only reset last_modified on success paths instead of resetting
        // last_modified at the beginning for better performance.
        if let store::Data::File(ref mut file) = *blob_store.data_mut() {
            file.last_modified = jsc::INIT_TIMESTAMP as f64;
        }
    }

    let input_store: Option<StoreRef> =
        if let PathOrBlob::Blob(ref b) = *path_or_blob { b.store.clone() } else { None };
    // PORT NOTE: Zig manually ref/deref's; StoreRef clone+drop achieves the same.
    let _input_store_hold = input_store;

    let mut needs_async = false;

    if let Some(mkdir) = options.mkdirp_if_not_exists {
        if mkdir
            && matches!(*path_or_blob, PathOrBlob::Blob(ref b)
                if b.store.is_some()
                    && matches!(b.store.as_ref().unwrap().data, store::Data::File(ref f)
                        if matches!(f.pathlike, PathOrFileDescriptor::Fd(_))))
        {
            return Err(global_this
                .throw_invalid_arguments("Cannot create a directory for a file descriptor"));
        }
    }

    // If you're doing Bun.write(), try to go fast by writing short input on the main thread.
    // This is a heuristic, but it's a good one.
    //
    // except if you're on Windows. Windows I/O is slower. Let's not even try.
    #[cfg(not(windows))]
    {
        let fast_path_ok = matches!(*path_or_blob, PathOrBlob::Path(_))
            || (matches!(*path_or_blob, PathOrBlob::Blob(ref b)
                if b.offset == 0 && !b.is_s3()
                    && !(b.store.is_some()
                        && matches!(b.store.as_ref().unwrap().data, store::Data::File(ref f)
                            if f.mode != 0 && bun_core::kind_from_mode(f.mode) == bun_core::FileKind::File))));
        if fast_path_ok {
            if data.is_string() {
                let len = data.get_length(global_this)?;
                if len < 256 * 1024 {
                    let str = data.to_bun_string(global_this)?;
                    let pathlike: PathOrFileDescriptor = match &*path_or_blob {
                        PathOrBlob::Path(p) => p.clone(),
                        PathOrBlob::Blob(b) => b.store.as_ref().unwrap().data.as_file().pathlike.clone(),
                    };
                    let result = if matches!(pathlike, PathOrFileDescriptor::Path(_)) {
                        write_string_to_file_fast::<true>(global_this, pathlike, str, &mut needs_async)
                    } else {
                        write_string_to_file_fast::<false>(global_this, pathlike, str, &mut needs_async)
                    };
                    if !needs_async {
                        return Ok(result);
                    }
                }
            } else if let Some(buffer_view) = data.as_array_buffer(global_this) {
                if buffer_view.byte_len < 256 * 1024 {
                    let pathlike: PathOrFileDescriptor = match &*path_or_blob {
                        PathOrBlob::Path(p) => p.clone(),
                        PathOrBlob::Blob(b) => b.store.as_ref().unwrap().data.as_file().pathlike.clone(),
                    };
                    let result = if matches!(pathlike, PathOrFileDescriptor::Path(_)) {
                        write_bytes_to_file_fast::<true>(global_this, pathlike, buffer_view.byte_slice(), &mut needs_async)
                    } else {
                        write_bytes_to_file_fast::<false>(global_this, pathlike, buffer_view.byte_slice(), &mut needs_async)
                    };
                    if !needs_async {
                        return Ok(result);
                    }
                }
            }
        }
    }

    // if path_or_blob is a path, convert it into a file blob
    let mut destination_blob: Blob = match path_or_blob {
        PathOrBlob::Path(path) => {
            let new_blob = Blob::find_or_create_file_from_path(path, global_this, true);
            if new_blob.store.is_none() {
                return Err(global_this
                    .throw_invalid_arguments("Writing to an empty blob is not implemented yet"));
            }
            new_blob
        }
        PathOrBlob::Blob(b) => {
            debug_assert!(b.store.is_some());
            b.dupe()
        }
    };

    // TODO: implement a writev() fast path
    let mut source_blob: Blob = 'brk: {
        // PORT NOTE: Zig has two near-identical arms for `Response` and
        // `Request`. Both expose `get_body_value()` /
        // `get_body_readable_stream()`; collapse into one helper that takes the
        // body-value pointer and a `get_stream` closure.
        let body_dispatch = |body_value: *mut webcore::body::Value,
                             get_stream: &mut dyn FnMut(
            &JSGlobalObject,
        )
            -> Option<ReadableStream>|
         -> JsResult<core::ops::ControlFlow<JSValue, Blob>> {
            use core::ops::ControlFlow;
            use webcore::body::Value as BodyValue;
            // SAFETY: `body_value` is `&mut Body::Value` from a live JS heap
            // Response/Request `m_ctx`; raw to allow re-borrow after `use_()`.
            let body_value_ref = unsafe { &mut *body_value };
            match body_value_ref {
                BodyValue::WTFStringImpl(_)
                | BodyValue::InternalBlob(_)
                | BodyValue::Used
                | BodyValue::Empty
                | BodyValue::Blob(_)
                | BodyValue::Null => Ok(ControlFlow::Continue(body_value_ref.use_())),
                BodyValue::Error(err_ref) => {
                    let err_js = err_ref.to_js(global_this);
                    destination_blob.detach();
                    let _ = unsafe { &mut *body_value }.use_();
                    Ok(ControlFlow::Break(
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this, err_js,
                        ),
                    ))
                }
                BodyValue::Locked(_) => {
                    if destination_blob.is_s3() {
                        let dest_store = destination_blob.store.as_ref().unwrap().clone();
                        let s3 = dest_store.data.as_s3();
                        let aws_options =
                            s3.get_credentials_with_options(options.extra_options, global_this)?;
                        let _ = body_value_ref.to_readable_stream(global_this)?;
                        let readable_opt = get_stream(global_this).or_else(|| {
                            // SAFETY: re-borrow after `to_readable_stream`.
                            let BodyValue::Locked(locked) = unsafe { &mut *body_value } else {
                                return None;
                            };
                            locked.readable.get(global_this)
                        });
                        if let Some(readable) = readable_opt {
                            if readable.is_disturbed(global_this) {
                                destination_blob.detach();
                                return Err(global_this.throw_invalid_arguments(
                                    "ReadableStream has already been used",
                                ));
                            }
                            let proxy_owned = http_proxy_href(global_this);
                            let proxy_url = proxy_owned.as_deref();
                            return Ok(ControlFlow::Break(s3_client::upload_stream(
                                &aws_options.credentials,
                                s3.path(),
                                readable,
                                global_this,
                                aws_options.options,
                                aws_options.acl,
                                aws_options.storage_class,
                                destination_blob.content_type_or_mime_type(),
                                // SAFETY: `*const [u8]` borrows from sibling
                                // `_*_slice` fields on `aws_options`, which
                                // outlives this call.
                                aws_options.content_disposition.map(|p| unsafe { &*p }),
                                aws_options.content_encoding.map(|p| unsafe { &*p }),
                                proxy_url,
                                aws_options.request_payer,
                                None,
                                core::ptr::null_mut(),
                            )?));
                        }
                        destination_blob.detach();
                        return Err(global_this
                            .throw_invalid_arguments("ReadableStream has already been used"));
                    }
                    let task = Box::into_raw(Box::new(WriteFileWaitFromLockedValueTask {
                        global_this,
                        file_blob: destination_blob.dupe(),
                        promise: jsc::JSPromiseStrong::init(global_this),
                        mkdirp_if_not_exists: options.mkdirp_if_not_exists.unwrap_or(true),
                    }));
                    // SAFETY: re-borrow after the early-return paths.
                    let BodyValue::Locked(locked) = unsafe { &mut *body_value } else {
                        unreachable!()
                    };
                    locked.task = Some(task.cast::<c_void>());
                    locked.on_receive_value = Some(WriteFileWaitFromLockedValueTask::then_wrap);
                    // SAFETY: `task` was just Box::into_raw'd; consumed in `then_wrap`.
                    Ok(ControlFlow::Break(unsafe { (*task).promise.value() }))
                }
            }
        };

        if let Some(response) = data.as_::<Response>() {
            // SAFETY: `as_` returns the live `m_ctx` pointer.
            let response = unsafe { &mut *response };
            let bv = response.get_body_value() as *mut _;
            match body_dispatch(bv, &mut |g| response.get_body_readable_stream(g))? {
                core::ops::ControlFlow::Break(v) => return Ok(v),
                core::ops::ControlFlow::Continue(b) => break 'brk b,
            }
        }

        if let Some(request) = data.as_::<Request>() {
            // SAFETY: `as_` returns the live `m_ctx` pointer.
            let request = unsafe { &mut *request };
            let bv = request.get_body_value() as *mut _;
            match body_dispatch(bv, &mut |g| request.get_body_readable_stream(g))? {
                core::ops::ControlFlow::Break(v) => return Ok(v),
                core::ops::ControlFlow::Continue(b) => break 'brk b,
            }
        }

        // Check for Archive - allows Bun.write() and S3 writes to accept Archive instances
        if let Some(archive) = data.as_::<Archive>() {
            // SAFETY: `as_` returns a non-null `*mut Archive` owned by the live JS wrapper.
            break 'brk Blob::init_with_store(unsafe { (*archive).store_ref().clone() }, global_this);
        }

        break 'brk Blob::get::<false, false>(global_this, data)?;
    };
    // Zig: `defer source_blob.detach();`
    let mut source_blob = scopeguard::guard(source_blob, |mut b| b.detach());

    let destination_store = destination_blob.store.clone();
    // PORT NOTE: Zig manually ref/deref's; StoreRef clone+drop covers this.
    let _dest_hold = destination_store;

    write_file_with_source_destination(global_this, &mut *source_blob, &mut destination_blob, &options)
}

fn validate_writable_blob(global_this: &JSGlobalObject, blob: &Blob) -> JsResult<()> {
    let Some(store) = &blob.store else {
        return Err(global_this.throw("Cannot write to a detached Blob"));
    };
    if matches!(store.data, store::Data::Bytes(_)) {
        return Err(global_this.throw_invalid_arguments(
            "Cannot write to a Blob backed by bytes, which are always read-only",
        ));
    }
    Ok(())
}

/// `Bun.write(destination, input, options?)`
// TODO(b2-blocked): #[bun_jsc::host_fn]
pub fn write_file(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();
    // SAFETY: `bun_vm()` returns a live VM pointer for the calling JS context.
    let mut args = jsc::ArgumentsSlice::init(unsafe { &*global_this.bun_vm() }, arguments);

    // accept a path or a blob
    let path_or_blob = PathOrBlob::from_js_no_copy(global_this, &mut args)?;
    let mut path_or_blob = scopeguard::guard(path_or_blob, |p| {
        if let PathOrBlob::Path(ref path) = p { path.deinit(); }
    });
    // "Blob" must actually be a BunFile, not a webcore blob.
    if let PathOrBlob::Blob(ref blob) = *path_or_blob {
        validate_writable_blob(global_this, blob)?;
    }

    let Some(data) = args.next_eat() else {
        return Err(global_this.throw_invalid_arguments(
            "Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write",
        ));
    };
    let mut mkdirp_if_not_exists: Option<bool> = None;
    let mut mode: Option<bun_sys::Mode> = None;
    let options = args.next_eat();
    if let Some(options_object) = options {
        if options_object.is_object() {
            if let Some(create_directory) = options_object.get_truthy(global_this, "createPath")? {
                if !create_directory.is_boolean() {
                    return Err(global_this.throw_invalid_argument_type("write", "options.createPath", "boolean"));
                }
                mkdirp_if_not_exists = Some(create_directory.to_boolean());
            }
            if let Some(mode_value) = options_object.get(global_this, "mode")? {
                if !mode_value.is_empty_or_undefined_or_null() {
                    if !mode_value.is_number() {
                        return Err(global_this.throw_invalid_argument_type("write", "options.mode", "number"));
                    }
                    let mode_int = mode_value.to_int64();
                    if mode_int < 0 || mode_int > 0o777 {
                        return Err(global_this.throw_range_error(mode_int, jsc::RangeErrorOptions {
                            field_name: b"mode", min: 0, max: 0o777, msg: b"",
                        }));
                    }
                    mode = Some(mode_int as bun_sys::Mode);
                }
            }
        } else if !options_object.is_empty_or_undefined_or_null() {
            return Err(global_this.throw_invalid_argument_type("write", "options", "object"));
        }
    }
    write_file_internal(
        global_this,
        &mut *path_or_blob,
        data,
        WriteFileOptions { mkdirp_if_not_exists, extra_options: options, mode },
    )
}

const WRITE_PERMISSIONS: bun_sys::Mode = 0o664;

fn write_string_to_file_fast<const NEEDS_OPEN: bool>(
    global_this: &JSGlobalObject,
    pathlike: PathOrFileDescriptor,
    str: BunString,
    needs_async: &mut bool,
) -> JSValue {
    let fd: Fd = if !NEEDS_OPEN {
        pathlike.fd()
    } else {
        let mut file_path = bun_paths::PathBuffer::uninit();
        match bun_sys::open(
            pathlike.path().slice_z(&mut file_path),
            // we deliberately don't use O_TRUNC here
            // it's a perf optimization
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::NONBLOCK,
            WRITE_PERMISSIONS,
        ) {
            bun_sys::Result::Ok(result) => result,
            bun_sys::Result::Err(err) => {
                if err.get_errno() == bun_sys::E::ENOENT {
                    *needs_async = true;
                    return JSValue::ZERO;
                }
                return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    err.with_path(pathlike.path().slice()).to_js(global_this),
                );
            }
        }
    };

    // PORT NOTE: Zig used `defer` which can read locals at unwind time.
    // Rust scopeguard's closure captures borrows at construction, conflicting
    // with later `written += ...` / `truncate = false`. Route through `Cell`
    // so the guard and the loop body share `&Cell<_>` (no mutable-borrow conflict).
    let truncate = core::cell::Cell::new(NEEDS_OPEN || str.is_empty());
    let written = core::cell::Cell::new(0usize);

    let _cleanup = scopeguard::guard((), |_| {
        // we only truncate if it's a path
        // if it's a file descriptor, we assume they want manual control over that behavior
        if truncate.get() {
            let _ = bun_sys::ftruncate(fd, i64::try_from(written.get()).unwrap());
        }
        if NEEDS_OPEN {
            let _ = bun_sys::close(fd);
        }
    });

    if !str.is_empty() {
        let decoded = str.to_utf8();
        let mut remain = decoded.slice();
        while !remain.is_empty() {
            match bun_sys::write(fd, remain) {
                bun_sys::Result::Ok(res) => {
                    written.set(written.get() + res);
                    remain = &remain[res..];
                    if res == 0 { break; }
                }
                bun_sys::Result::Err(err) => {
                    truncate.set(false);
                    if err.get_errno() == bun_sys::E::EAGAIN {
                        *needs_async = true;
                        return JSValue::ZERO;
                    }
                    let err_js = if !NEEDS_OPEN {
                        err.to_js(global_this)
                    } else {
                        err.with_path(pathlike.path().slice()).to_js(global_this)
                    };
                    return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        err_js,
                    );
                }
            }
        }
    }

    JSPromise::resolved_promise_value(global_this, JSValue::js_number(written.get() as f64))
}

fn write_bytes_to_file_fast<const NEEDS_OPEN: bool>(
    global_this: &JSGlobalObject,
    pathlike: PathOrFileDescriptor,
    bytes: &[u8],
    needs_async: &mut bool,
) -> JSValue {
    let fd: Fd = if !NEEDS_OPEN {
        pathlike.fd()
    } else {
        let mut file_path = bun_paths::PathBuffer::uninit();
        let flags = if cfg!(not(windows)) {
            bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::NONBLOCK
        } else {
            bun_sys::O::WRONLY | bun_sys::O::CREAT
        };
        match bun_sys::open(pathlike.path().slice_z(&mut file_path), flags, WRITE_PERMISSIONS) {
            bun_sys::Result::Ok(result) => result,
            bun_sys::Result::Err(err) => {
                #[cfg(not(windows))]
                if err.get_errno() == bun_sys::E::ENOENT {
                    *needs_async = true;
                    return JSValue::ZERO;
                }
                return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    err.with_path(pathlike.path().slice()).to_js(global_this),
                );
            }
        }
    };

    // TODO: on windows this is always synchronous

    let truncate = NEEDS_OPEN || bytes.is_empty();
    let mut written: usize = 0;
    let _close = scopeguard::guard((), |_| if NEEDS_OPEN { let _ = bun_sys::close(fd); });

    let mut remain = bytes;
    while !remain.is_empty() {
        match bun_sys::write(fd, remain) {
            bun_sys::Result::Ok(res) => {
                written += res;
                remain = &remain[res..];
                if res == 0 { break; }
            }
            bun_sys::Result::Err(err) => {
                #[cfg(not(windows))]
                if err.get_errno() == bun_sys::E::EAGAIN {
                    *needs_async = true;
                    return JSValue::ZERO;
                }
                let err_js = if !NEEDS_OPEN {
                    err.to_js(global_this)
                } else {
                    err.with_path(pathlike.path().slice()).to_js(global_this)
                };
                return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    err_js,
                );
            }
        }
    }

    if truncate {
        #[cfg(windows)]
        // SAFETY: fd is a valid open handle on this code path; FFI call.
        unsafe { bun_sys::windows::kernel32::SetEndOfFile(fd.cast()) };
        #[cfg(not(windows))]
        let _ = bun_sys::ftruncate(fd, i64::try_from(written).unwrap());
    }

    JSPromise::resolved_promise_value(global_this, JSValue::js_number(written as f64))
}

// ──────────────────────────────────────────────────────────────────────────
// JSDOMFile constructor
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): callconv(jsc.conv) — emitted by // TODO(b2-blocked): #[bun_jsc::host_fn] macro.
#[unsafe(no_mangle)]
pub extern "C" fn JSDOMFile__construct(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> Option<NonNull<Blob>> {
    match jsdom_file_construct_(global_this, callframe) {
        // SAFETY: jsdom_file_construct_ returns Blob::new (Box::into_raw); never null on Ok.
        Ok(b) => Some(unsafe { NonNull::new_unchecked(b) }),
        Err(jsc::JsError::Thrown) => None,
        Err(jsc::JsError::OutOfMemory) => {
            let _ = global_this.throw_out_of_memory();
            None
        }
        Err(jsc::JsError::Terminated) => None,
    }
}

pub fn jsdom_file_construct_(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<*mut Blob> {
    jsc::mark_binding();
    let mut blob: Blob;
    let arguments = callframe.arguments_old::<3>();
    let args = arguments.slice();

    if args.len() < 2 {
        return Err(global_this
            .throw_invalid_arguments("new File(bits, name) expects at least 2 arguments"));
    }
    {
        use bun_jsc::StringJsc as _;
        let name_value_str = BunString::from_js(args[1], global_this)?;

        blob = Blob::get::<false, true>(global_this, args[0])?;
        if let Some(store_) = &blob.store {
            match store_.data_mut() {
                store::Data::Bytes(bytes) => {
                    bytes.stored_name =
                        bun_str::PathString::init(name_value_str.to_utf8().slice());
                }
                store::Data::S3(_) | store::Data::File(_) => {
                    blob.name = name_value_str.dupe_ref();
                }
            }
        } else if !name_value_str.is_empty() {
            // not store but we have a name so we need a store
            blob.store = Some(StoreRef::from(Store::new(Store {
                data: store::Data::Bytes(store::Bytes::init_empty_with_name(
                    bun_str::PathString::init(name_value_str.to_utf8().slice()),
                )),
                ref_count: AtomicU32::new(1),
                mime_type: bun_http_types::MimeType::NONE,
                is_all_ascii: None,
            })));
        }
    }

    let mut set_last_modified = false;

    if args.len() > 2 {
        let options = args[2];
        if options.is_object() {
            // type, the ASCII-encoded string in lower case
            // representing the media type of the Blob.
            if let Some(content_type) = options.get(global_this, "type")? {
                'inner: {
                    if content_type.is_string() {
                        let content_type_str = content_type.to_slice(global_this)?;
                        let slice = content_type_str.slice();
                        if !strings::is_all_ascii(slice) {
                            break 'inner;
                        }
                        blob.content_type_was_set = true;

                        // SAFETY: bun_vm() returns the live VM pointer for this global.
                        if let Some(mime) = unsafe { (*global_this.bun_vm()).mime_type(slice) } {
                            blob.content_type = match mime.value {
                                        ::std::borrow::Cow::Borrowed(s) => s as *const [u8],
                                        ::std::borrow::Cow::Owned(v) => {
                                            blob.content_type_allocated = true;
                                            Box::into_raw(v.into_boxed_slice())
                                        }
                                    };
                            break 'inner;
                        }
                        let mut content_type_buf = vec![0u8; slice.len()];
                        strings::copy_lowercase(slice, &mut content_type_buf);
                        blob.content_type = Box::into_raw(content_type_buf.into_boxed_slice());
                        blob.content_type_allocated = true;
                    }
                }
            }

            if let Some(last_modified) = options.get_truthy(global_this, "lastModified")? {
                set_last_modified = true;
                blob.last_modified = last_modified.to_number(global_this)?;
            }
        }
    }

    if !set_last_modified {
        // `lastModified` should be the current date in milliseconds if unspecified.
        blob.last_modified = bun_core::time::milli_timestamp() as f64;
    }

    if blob.content_type_slice().is_empty() {
        blob.content_type = b"" as &'static [u8] as *const [u8];
        blob.content_type_was_set = false;
    }

    let blob_ = Blob::new(blob);
    // SAFETY: ptr was just produced by Box::into_raw in Blob::new.
    unsafe { (*blob_).is_jsdom_file = true };
    Ok(blob_)
}

// ──────────────────────────────────────────────────────────────────────────
// estimatedSize / constructBunFile / findOrCreateFileFromPath
// ──────────────────────────────────────────────────────────────────────────

// `calculate_estimated_byte_size` / `estimated_size`: canonical impls live
// later in this file (near `dupe`/`to_js`). Duplicates removed here.

// TODO(b2-blocked): #[bun_jsc::host_fn]
pub fn construct_bun_file(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    // SAFETY: bun_vm() never returns null for a Bun-owned global.
    let vm = unsafe { &*global_object.bun_vm() };
    let arguments = callframe.arguments_old::<2>();
    let arguments_slice = arguments.slice();
    let mut args = jsc::ArgumentsSlice::init(vm, arguments_slice);

    let Some(mut path) = PathOrFileDescriptor::from_js(global_object, &mut args)? else {
        return Err(global_object
            .throw_invalid_arguments("Expected file path string or file descriptor"));
    };
    let options = if arguments_slice.len() >= 2 { Some(arguments_slice[1]) } else { None };

    if let PathOrFileDescriptor::Path(ref p) = path {
        if p.slice().starts_with(b"s3://") {
            // PORT NOTE (layering): `webcore::node_types::PathLike` re-exports
            // `crate::node::types::PathLike`, so no conversion is needed —
            // clone the path (Zig consumed it; the Rust `path` is dropped at
            // scope exit by `deinit_and_unprotect` below).
            return S3File::construct_internal_js(global_object, p.clone(), options);
        }
    }
    // PORT NOTE: Zig `defer path.deinitAndUnprotect()` — stub PathOrFileDescriptor
    // owns its data and `deinit_and_unprotect` is a no-op; drop handles it.

    let mut blob = Blob::find_or_create_file_from_path(&mut path, global_object, false);

    if let Some(opts) = options {
        if opts.is_object() {
            if let Some(file_type) = opts.get_truthy(global_object, "type")? {
                'inner: {
                    if file_type.is_string() {
                        let str = file_type.to_slice(global_object)?;
                        let slice = str.slice();
                        if !strings::is_all_ascii(slice) {
                            break 'inner;
                        }
                        blob.content_type_was_set = true;
                        // SAFETY: bun_vm() never returns null for a Bun-owned global.
                        if let Some(entry) = unsafe { (*global_object.bun_vm()).mime_type(str.slice()) } {
                            blob.content_type = entry.value.as_ref() as *const [u8];
                            break 'inner;
                        }
                        let mut content_type_buf = vec![0u8; slice.len()];
                        strings::copy_lowercase(slice, &mut content_type_buf);
                        blob.content_type = Box::into_raw(content_type_buf.into_boxed_slice());
                        blob.content_type_allocated = true;
                    }
                }
            }
            if let Some(last_modified) = opts.get_truthy(global_object, "lastModified")? {
                blob.last_modified = last_modified.to_number(global_object)?;
            }
        }
    }

    let ptr = Blob::new(blob);
    // SAFETY: ptr was just produced by Box::into_raw in Blob::new. Explicit
    // `&mut *` forces inherent `Blob::to_js(&mut self)` over `JsClass::to_js(self)`.
    Ok(unsafe { (&mut *ptr).to_js(global_object) })
}

// `find_or_create_file_from_path`: canonical impl lives later in this file
// (runtime `check_s3: bool` form). Const-generic duplicate removed here.

// ──────────────────────────────────────────────────────────────────────────
// getStream / toStreamWithOffset / lifetimeWrap / accessor host fns
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_stream(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        if let Some(cached) = bun_jsc::generated::JSBlob::stream_get_cached(this_value) {
            return Ok(cached);
        }
        let mut recommended_chunk_size: SizeType = 0;
        let recommended_chunk_size_value = callframe.argument(0);
        if !recommended_chunk_size_value.is_undefined_or_null() {
            if !recommended_chunk_size_value.is_number() {
                return Err(global_this.throw_invalid_arguments("chunkSize must be a number"));
            }
            // PERF(port): Zig used @truncate to i52 then @intCast to SizeType.
            recommended_chunk_size = SizeType::try_from(
                (recommended_chunk_size_value.to_int64() & ((1i64 << 52) - 1)).max(0),
            )
            .unwrap();
        }
        let stream = ReadableStream::from_blob_copy_ref(global_this, self, recommended_chunk_size)?;

        if let Some(store) = &self.store {
            if let store::Data::File(f) = &store.data {
                if let PathOrFileDescriptor::Fd(_) = f.pathlike {
                    // in the case we have a file descriptor store, we want to de-duplicate
                    // readable streams. in every other case we want `.stream()` to be its
                    // own stream.
                    bun_jsc::generated::JSBlob::stream_set_cached(this_value, global_this, stream);
                }
            }
        }

        Ok(stream)
    }
}

// TODO(b2-blocked): #[bun_jsc::host_fn]
pub fn to_stream_with_offset(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let this = callframe
        .this()
        .as_::<Blob>()
        .unwrap_or_else(|| panic!("this is not a Blob"));
    let args = callframe.arguments_old::<1>();
    ReadableStream::from_file_blob_with_offset(
        global_this,
        // SAFETY: as_::<Blob>() returned a non-null *mut Blob.
        unsafe { &*this },
        usize::try_from(args.slice()[0].to_int64()).unwrap(),
    )
}

// Zig doesn't let you pass a function with a comptime argument to a
// runtime-known function. In Rust the comptime `Lifetime` collapses to a
// captured constant inside `JSPromise::wrap`'s `FnOnce(&JSGlobalObject)`, so
// the dedicated `lifetimeWrap` helper from Zig is folded into each call site.

impl Blob {
    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_text(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(self.get_text_clone(global_this)?)
    }

    pub fn get_text_clone(&mut self, global_object: &JSGlobalObject) -> Result<JSValue, jsc::JsTerminated> {
        let _store = self.store.clone(); // hold a ref across the call
        JSPromise::wrap(global_object, |g| self.to_string(g, Lifetime::Clone))
    }

    pub fn get_text_transfer(&mut self, global_object: &JSGlobalObject) -> Result<JSValue, jsc::JsTerminated> {
        let _store = self.store.clone();
        JSPromise::wrap(global_object, |g| self.to_string(g, Lifetime::Transfer))
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_json(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(self.get_json_share(global_this)?)
    }

    pub fn get_json_share(&mut self, global_object: &JSGlobalObject) -> Result<JSValue, jsc::JsTerminated> {
        let _store = self.store.clone();
        JSPromise::wrap(global_object, |g| self.to_json(g, Lifetime::Share))
    }

    pub fn get_array_buffer_transfer(&mut self, global_this: &JSGlobalObject) -> Result<JSValue, jsc::JsTerminated> {
        let _store = self.store.clone();
        JSPromise::wrap(global_this, |g| self.to_array_buffer(g, Lifetime::Transfer))
    }

    pub fn get_array_buffer_clone(&mut self, global_this: &JSGlobalObject) -> Result<JSValue, jsc::JsTerminated> {
        let _store = self.store.clone();
        JSPromise::wrap(global_this, |g| self.to_array_buffer(g, Lifetime::Clone))
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_array_buffer(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(self.get_array_buffer_clone(global_this)?)
    }

    pub fn get_bytes_clone(&mut self, global_this: &JSGlobalObject) -> Result<JSValue, jsc::JsTerminated> {
        let _store = self.store.clone();
        JSPromise::wrap(global_this, |g| self.to_uint8_array(g, Lifetime::Clone))
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_bytes(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        Ok(self.get_bytes_clone(global_this)?)
    }

    pub fn get_bytes_transfer(&mut self, global_this: &JSGlobalObject) -> Result<JSValue, jsc::JsTerminated> {
        let _store = self.store.clone();
        JSPromise::wrap(global_this, |g| self.to_uint8_array(g, Lifetime::Transfer))
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_form_data(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let _store = self.store.clone();
        Ok(JSPromise::wrap(global_this, |g| {
            self.to_form_data(g, Lifetime::Temporary).map_err(Into::into)
        })?)
    }

    fn get_exists_sync(&mut self) -> JSValue {
        if self.size == MAX_SIZE {
            self.resolve_size();
        }

        // If there's no store that means it's empty and we just return true
        let Some(store) = &self.store else { return JSValue::TRUE };

        if matches!(store.data, store::Data::Bytes(_)) {
            // Bytes will never error
            return JSValue::TRUE;
        }

        // We say regular files and pipes exist.
        let store::Data::File(file) = &store.data else { return JSValue::FALSE };
        JSValue::from(bun_sys::S::ISREG(file.mode) || bun_sys::S::ISFIFO(file.mode))
    }

    // is_s3: defined once above (near is_bun_file); duplicate removed to fix E0034.
}

// ──────────────────────────────────────────────────────────────────────────
// S3BlobDownloadTask
// ──────────────────────────────────────────────────────────────────────────

pub struct S3BlobDownloadTask {
    pub blob: Blob,
    pub global_this: *const JSGlobalObject,
    pub promise: jsc::JSPromiseStrong,
    pub poll_ref: bun_aio::KeepAlive,
    pub handler: S3ReadHandler,
}

pub type S3ReadHandler = fn(&mut Blob, *const JSGlobalObject, &mut [u8]) -> JSValue;

impl S3BlobDownloadTask {
    pub fn call_handler(&mut self, raw_bytes: &mut [u8]) -> JSValue {
        (self.handler)(&mut self.blob, self.global_this, raw_bytes)
    }

    pub fn on_s3_download_resolved(
        result: crate::webcore::__s3_client::S3DownloadResult,
        this: *mut S3BlobDownloadTask,
    ) -> Result<(), jsc::JsTerminated> {
        // SAFETY: `this` was Box::into_raw'd in init() and is consumed here.
        let this = unsafe { &mut *this };
        let _drop = scopeguard::guard(this as *mut S3BlobDownloadTask, |p| unsafe {
            drop(Box::from_raw(p));
        });
        let global = unsafe { &*this.global_this };
        match result {
            crate::webcore::__s3_client::S3DownloadResult::Success(mut response) => {
                let bytes = &mut response.body.list[..];
                if this.blob.size == MAX_SIZE {
                    this.blob.size = bytes.len() as SizeType;
                }
                let value = JSPromise::wrap(global, |g| Ok(this.call_handler(bytes)))?;
                this.promise.resolve(global, value)?;
            }
            crate::webcore::__s3_client::S3DownloadResult::NotFound(err) | crate::webcore::__s3_client::S3DownloadResult::Failure(err) => {
                let path = this.blob.store.as_ref().and_then(|s| s.get_path());
                // SAFETY: sole `&mut JSPromise` borrow; consumed by `reject` below.
                let promise = unsafe { this.promise.get() };
                let value = crate::webcore::s3::client::error_jsc::s3_error_to_js_with_async_stack(
                    &err, global, path, promise,
                );
                this.promise.reject(global, Ok(value))?;
            }
        }
        Ok(())
    }

    pub fn init(
        global_this: &JSGlobalObject,
        blob: &mut Blob,
        handler: S3ReadHandler,
    ) -> Result<JSValue, jsc::JsTerminated> {
        // The callback may read this.blob.content_type, which is heap-owned by the
        // source JS Blob and freed on finalize(). Take an owning dupe so the task
        // outliving the source can't dangle.
        let this = Box::into_raw(Box::new(S3BlobDownloadTask {
            global_this: global_this,
            blob: Blob::dupe(blob),
            promise: jsc::JSPromiseStrong::init(global_this),
            poll_ref: bun_aio::KeepAlive::default(),
            handler,
        }));
        // SAFETY: just allocated.
        let this_ref = unsafe { &mut *this };
        let promise = this_ref.promise.value();
        // SAFETY: bun_vm() never returns null for a Bun-owned global.
        let env = unsafe { &(*global_this.bun_vm()).transpiler.env };
        let store::Data::S3(s3_store) = &this_ref.blob.store.as_ref().unwrap().data else {
            unreachable!("S3BlobDownloadTask::init on non-S3 blob")
        };
        let credentials = s3_store.get_credentials();
        let path = s3_store.path();

        let _ = env;
        this_ref.poll_ref.ref_(vm_ctx());
        let proxy_owned = http_proxy_href(global_this);
        let proxy = proxy_owned.as_deref();

        // Adapter: S3 download callback ABI takes `*mut c_void` context — cast
        // back to the boxed task.
        fn s3_cb(
            result: crate::webcore::__s3_client::S3DownloadResult<'_>,
            ctx: *mut c_void,
        ) -> Result<(), jsc::JsTerminated> {
            S3BlobDownloadTask::on_s3_download_resolved(result, ctx as *mut S3BlobDownloadTask)
        }

        if blob.offset > 0 {
            let len: Option<usize> = if blob.size != MAX_SIZE { Some(usize::try_from(blob.size).unwrap()) } else { None };
            let offset: usize = usize::try_from(blob.offset).unwrap();
            crate::webcore::__s3_client::download_slice(
                credentials, path, offset, len,
                s3_cb, this as *mut c_void,
                proxy, s3_store.request_payer,
            )?;
        } else if blob.size == MAX_SIZE {
            crate::webcore::__s3_client::download(
                credentials, path,
                s3_cb, this as *mut c_void,
                proxy, s3_store.request_payer,
            )?;
        } else {
            let len: usize = usize::try_from(blob.size).unwrap();
            let offset: usize = usize::try_from(blob.offset).unwrap();
            crate::webcore::__s3_client::download_slice(
                credentials, path, offset, Some(len),
                s3_cb, this as *mut c_void,
                proxy, s3_store.request_payer,
            )?;
        }
        Ok(promise)
    }
}

impl Drop for S3BlobDownloadTask {
    fn drop(&mut self) {
        Blob::deinit(&mut self.blob);
        self.poll_ref.unref(vm_ctx());
        // promise: Drop handles deinit.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// doWrite / doUnlink / getExists
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn do_write(&mut self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<3>();
        // SAFETY: bun_vm() never returns null for a Bun-owned global.
        let mut args = jsc::ArgumentsSlice::init(unsafe { &*global_this.bun_vm() }, arguments.slice());

        validate_writable_blob(global_this, self)?;

        let Some(data) = args.next_eat() else {
            return Err(global_this.throw_invalid_arguments(
                "blob.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write",
            ));
        };
        if data.is_empty_or_undefined_or_null() {
            return Err(global_this.throw_invalid_arguments(
                "blob.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write",
            ));
        }
        let mut mkdirp_if_not_exists: Option<bool> = None;
        let options = args.next_eat();
        if let Some(options_object) = options {
            if options_object.is_object() {
                if let Some(create_directory) = options_object.get_truthy(global_this, "createPath")? {
                    if !create_directory.is_boolean() {
                        return Err(global_this.throw_invalid_argument_type("write", "options.createPath", "boolean"));
                    }
                    mkdirp_if_not_exists = Some(create_directory.to_boolean());
                }
                if let Some(content_type) = options_object.get_truthy(global_this, "type")? {
                    // override the content type
                    if !content_type.is_string() {
                        return Err(global_this.throw_invalid_argument_type("write", "options.type", "string"));
                    }
                    let content_type_str = content_type.to_slice(global_this)?;
                    let slice = content_type_str.slice();
                    if strings::is_all_ascii(slice) {
                        if self.content_type_allocated {
                            // SAFETY: content_type_allocated implies content_type is a Box<[u8]>.
                            unsafe { drop(Box::from_raw(self.content_type as *mut [u8])) };
                            self.content_type_allocated = false;
                        }
                        self.content_type_was_set = true;

                        // SAFETY: bun_vm() never returns null for a Bun-owned global.
                        if let Some(mime) = unsafe { (*global_this.bun_vm()).mime_type(slice) } {
                            self.content_type = mime.value.as_ref() as *const [u8];
                        } else {
                            let mut buf = vec![0u8; slice.len()];
                            strings::copy_lowercase(slice, &mut buf);
                            self.content_type = Box::into_raw(buf.into_boxed_slice());
                            self.content_type_allocated = true;
                        }
                    }
                }
            } else if !options_object.is_empty_or_undefined_or_null() {
                return Err(global_this.throw_invalid_argument_type("write", "options", "object"));
            }
        }
        let mut blob_internal = PathOrBlob::Blob(self.dupe()); // TODO(port): Zig copies struct by value
        write_file_internal(
            global_this,
            &mut blob_internal,
            data,
            WriteFileOptions { mkdirp_if_not_exists, extra_options: options, mode: None },
        )
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn do_unlink(&mut self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old::<1>();
        // SAFETY: bun_vm() never returns null for a Bun-owned global.
        let mut args = jsc::ArgumentsSlice::init(unsafe { &*global_this.bun_vm() }, arguments.slice());

        validate_writable_blob(global_this, self)?;

        let store = self.store.as_ref().unwrap();
        match store.data_mut() {
            store::Data::S3(s3) => s3.unlink(store, global_this, args.next_eat()),
            store::Data::File(file) => file.unlink(global_this),
            store::Data::Bytes(_) => unreachable!(), // validate_writable_blob should have caught this
        }
    }

    // This mostly means 'can it be read?'
    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_exists(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        if self.is_s3() {
            return crate::webcore::s3_file::S3BlobStatTask::exists(global_this, self);
        }
        Ok(JSPromise::resolved_promise_value(global_this, self.get_exists_sync()))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FileStreamWrapper / pipeReadableStreamToBlob
// ──────────────────────────────────────────────────────────────────────────

pub struct FileStreamWrapper {
    pub promise: jsc::JSPromiseStrong,
    pub readable_stream_ref: webcore::readable_stream::ReadableStreamStrong,
    // LIFETIMES.tsv: SHARED — but FileSink uses an intrusive single-thread refcount
    // (`ref_`/`deref`) and crosses FFI as a raw pointer, so this stays `*mut`
    // rather than `Arc<T>` (matches Zig `sink: *jsc.WebCore.FileSink`).
    pub sink: *mut webcore::FileSink,
}

impl Drop for FileStreamWrapper {
    fn drop(&mut self) {
        // SAFETY: `sink` is the +1 ref handed over by `pipe_readable_stream_to_blob`.
        unsafe { webcore::FileSink::deref(self.sink) };
    }
}

// TODO(b2-blocked): #[bun_jsc::host_fn]
pub fn on_file_stream_resolve_request_stream(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments_old::<2>();
    // SAFETY: last arg is a promise-ptr created by FileStreamWrapper::new in pipe_readable_stream_to_blob.
    let mut this: Box<FileStreamWrapper> = unsafe {
        Box::from_raw(args.ptr[args.len - 1].as_number() as usize as *mut FileStreamWrapper)
    };
    let mut strong = core::mem::take(&mut this.readable_stream_ref);
    if let Some(stream) = strong.get(global_this) {
        stream.done(global_this);
    }
    this.promise.resolve(global_this, JSValue::js_number(0.0))?;
    Ok(JSValue::UNDEFINED)
}

// TODO(b2-blocked): #[bun_jsc::host_fn]
pub fn on_file_stream_reject_request_stream(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments_old::<2>();
    // PORT NOTE: Zig defers `this.sink.deref()` here but does NOT call `this.deinit()`
    // (leaks the wrapper). We take ownership via Box so Drop runs `sink.deref()`
    // and frees the wrapper — same observable effect on the sink, fixes the leak.
    let mut this: Box<FileStreamWrapper> = unsafe {
        Box::from_raw(args.ptr[args.len - 1].as_number() as usize as *mut FileStreamWrapper)
    };
    let err = args.ptr[0];

    let mut strong = core::mem::take(&mut this.readable_stream_ref);

    this.promise.reject(global_this, Ok(err))?;

    if let Some(stream) = strong.get(global_this) {
        stream.cancel(global_this);
    }
    Ok(JSValue::UNDEFINED)
}

// C-ABI shims for `JSValue::then` (mirrors Zig `toJSHostFn`). The Rust-side
// host fns above are `JSHostFnZig`; `then()` wants the raw `JSHostFn` shape.
// Exported under the Zig `@export` names so C++ (`BunPromiseInlines.h`) links
// the same symbol it does today.
#[unsafe(export_name = "Bun__FileStreamWrapper__onResolveRequestStream")]
unsafe extern "C" fn on_file_stream_resolve_request_stream_shim(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
) -> JSValue {
    // SAFETY: JSC guarantees both pointers are live for the host call.
    let (global, callframe) = unsafe { (&*global, &*callframe) };
    bun_jsc::host_fn::to_js_host_fn_result(global, on_file_stream_resolve_request_stream(global, callframe))
}
#[unsafe(export_name = "Bun__FileStreamWrapper__onRejectRequestStream")]
unsafe extern "C" fn on_file_stream_reject_request_stream_shim(
    global: *mut JSGlobalObject,
    callframe: *mut CallFrame,
) -> JSValue {
    // SAFETY: JSC guarantees both pointers are live for the host call.
    let (global, callframe) = unsafe { (&*global, &*callframe) };
    bun_jsc::host_fn::to_js_host_fn_result(global, on_file_stream_reject_request_stream(global, callframe))
}

// PORT NOTE: the local `AnyPromiseResultExt` shim was removed —
// `bun_jsc::AnyPromise::result` is an inherent method (and `JSInternalPromise`
// is a transparent alias for `JSPromise`), so the `.result(vm)` call below
// resolves directly upstream.

// TODO(port): @export of jsc::to_js_host_fn wrappers under
// "Bun__FileStreamWrapper__onResolveRequestStream" / "...Reject..." names.
// The // TODO(b2-blocked): #[bun_jsc::host_fn] attribute should support a `link_name = "..."` arg.

impl Blob {
    pub fn pipe_readable_stream_to_blob(
        &mut self,
        global_this: &JSGlobalObject,
        readable_stream: ReadableStream,
        extra_options: Option<JSValue>,
    ) -> JsResult<JSValue> {
        let Some(store) = self.store.clone() else {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                global_this.create_error_instance("Blob is detached"),
            ));
        };

        if self.is_s3() {
            let store::Data::S3(s3) = &store.data else { unreachable!() };
            let aws_options = match s3.get_credentials_with_options(extra_options, global_this) {
                Ok(o) => o,
                Err(err) => {
                    return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        global_this.take_exception(err),
                    ));
                }
            };

            let path = s3.path();
            // SAFETY: bun_vm() never returns null for a Bun-owned global; `env`
            // is a live `*mut Loader` owned by the transpiler.
            let proxy = unsafe {
                (*(*global_this.bun_vm()).transpiler.env).get_http_proxy(true, None, None)
            };
            let proxy_url = proxy.map(|p| p.href);

            return crate::webcore::__s3_client::upload_stream(
                if extra_options.is_some() { &aws_options.credentials } else { s3.get_credentials() },
                path,
                readable_stream,
                global_this,
                aws_options.options,
                aws_options.acl,
                aws_options.storage_class,
                self.content_type_or_mime_type(),
                // SAFETY: option-wrapped raw `*const [u8]` borrowed back; the
                // backing storage is owned by `aws_options` which outlives this call.
                aws_options.content_disposition.map(|p| unsafe { &*p }),
                aws_options.content_encoding.map(|p| unsafe { &*p }),
                proxy_url,
                aws_options.request_payer,
                None,
                core::ptr::null_mut(),
            );
        }

        if !matches!(store.data, store::Data::File(_)) {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                global_this.create_error_instance("Blob is read-only"),
            ));
        }

        let file_sink: *mut webcore::FileSink = 'brk_sink: {
            #[cfg(windows)]
            {
                let pathlike = &store.data.as_file().pathlike;
                let fd: Fd = if let PathOrFileDescriptor::Fd(fd) = pathlike {
                    *fd
                } else {
                    let mut file_path = bun_paths::PathBuffer::uninit();
                    let path = pathlike.path().slice_z(&mut file_path);
                    match bun_sys::open(
                        path,
                        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::NONBLOCK,
                        WRITE_PERMISSIONS,
                    ) {
                        bun_sys::Result::Ok(result) => result,
                        bun_sys::Result::Err(err) => {
                            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                global_this,
                                err.with_path(path).to_js(global_this)?,
                            ));
                        }
                    }
                };

                let is_stdout_or_stderr = 'brk: {
                    if !matches!(pathlike, PathOrFileDescriptor::Fd(_)) {
                        break 'brk false;
                    }

                    if let Some(rare) = global_this.bun_vm().rare_data.as_ref() {
                        if rare.stdout_store.as_ref().is_some_and(|s| Arc::ptr_eq(s, &store)) {
                            break 'brk true;
                        }
                        if rare.stderr_store.as_ref().is_some_and(|s| Arc::ptr_eq(s, &store)) {
                            break 'brk true;
                        }
                    }

                    if let Some(tag) = fd.stdio_tag() {
                        matches!(tag, bun_sys::Stdio::StdOut | bun_sys::Stdio::StdErr)
                    } else {
                        false
                    }
                };
                let sink = webcore::FileSink::init(
                    fd,
                    // SAFETY: self.global_this stored from a live &JSGlobalObject; VM outlives this task.
                    jsc::EventLoopHandle::init(
                        unsafe { (*(*self.global_this).bun_vm()).event_loop() } as *mut (),
                    ),
                );
                // SAFETY: `init` returns a freshly-allocated +1 *mut FileSink.
                unsafe { (*sink).writer.owns_fd = !matches!(pathlike, PathOrFileDescriptor::Fd(_)) };

                if is_stdout_or_stderr {
                    // SAFETY: sink is live; sole owner here.
                    if let bun_sys::Result::Err(err) = unsafe { (*sink).writer.start_sync(fd, false) } {
                        unsafe { webcore::FileSink::deref(sink) };
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err.to_js(global_this)?,
                        ));
                    }
                } else {
                    // SAFETY: sink is live; sole owner here.
                    if let bun_sys::Result::Err(err) = unsafe { (*sink).writer.start(fd, true) } {
                        unsafe { webcore::FileSink::deref(sink) };
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err.to_js(global_this)?,
                        ));
                    }
                }

                break 'brk_sink sink;
            }

            #[cfg(not(windows))]
            {
                let sink = webcore::FileSink::init(
                    Fd::INVALID,
                    // SAFETY: self.global_this stored from a live &JSGlobalObject; VM outlives this task.
                    jsc::EventLoopHandle::init(
                        unsafe { (*(*self.global_this).bun_vm()).event_loop() } as *mut (),
                    ),
                );

                let input_path: webcore::PathOrFileDescriptor = match &store.data.as_file().pathlike {
                    PathOrFileDescriptor::Fd(fd) => webcore::PathOrFileDescriptor::Fd(*fd),
                    PathOrFileDescriptor::Path(p) => {
                        webcore::PathOrFileDescriptor::Path(bun_str::ZigStringSlice::init_dupe(p.slice()).expect("oom"))
                    }
                };
                // input_path drops at scope exit (Zig: `defer input_path.deinit()`).

                let stream_start = streams::Start::FileSink(streams::FileSinkOptions {
                    input_path,
                    chunk_size: 0
                });

                // SAFETY: `init` returns a freshly-allocated +1 *mut FileSink.
                if let bun_sys::Result::Err(err) = unsafe { (*sink).start(stream_start) } {
                    unsafe { webcore::FileSink::deref(sink) };
                    return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        err.to_js(global_this),
                    ));
                }
                break 'brk_sink sink;
            }
        };

        // SAFETY: file_sink is a live +1 *mut FileSink for the rest of this fn.
        let signal = unsafe { &mut (*file_sink).signal };
        *signal = webcore::file_sink::SinkSignal::init(JSValue::ZERO);

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        signal.clear();
        debug_assert!(signal.is_dead());

        let signal_ptr: *mut *mut c_void =
            unsafe { &mut (*file_sink).signal.ptr as *mut _ as *mut *mut c_void };
        let assignment_result: JSValue = webcore::file_sink::JSSink::assign_to_stream(
            global_this,
            readable_stream.value,
            // SAFETY: file_sink is a live +1 *mut FileSink.
            unsafe { &mut *file_sink },
            signal_ptr,
        );

        assignment_result.ensure_still_alive();

        // assert that it was updated
        debug_assert!(!signal.is_dead());

        if let Some(err) = assignment_result.to_error() {
            // SAFETY: release our +1 ref on the sink.
            unsafe { webcore::FileSink::deref(file_sink) };
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this, err,
            ));
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            unsafe { (*global_this.bun_vm()).drain_microtasks() };

            assignment_result.ensure_still_alive();
            // it returns a Promise when it goes through ReadableStreamDefaultReader
            if let Some(promise) = assignment_result.as_any_promise() {
                match promise.status() {
                    jsc::js_promise::Status::Pending => {
                        let wrapper = Box::into_raw(Box::new(FileStreamWrapper {
                            promise: jsc::JSPromiseStrong::init(global_this),
                            readable_stream_ref: webcore::readable_stream::ReadableStreamStrong::init(readable_stream, global_this),
                            sink: file_sink,
                        }));
                        // SAFETY: wrapper was just produced by Box::into_raw; sole owner here.
                        let promise_value = unsafe { (*wrapper).promise.value() };
                        assignment_result.then(
                            global_this,
                            wrapper as *mut c_void,
                            on_file_stream_resolve_request_stream_shim,
                            on_file_stream_reject_request_stream_shim,
                        );
                        return Ok(promise_value);
                    }
                    jsc::js_promise::Status::Fulfilled => {
                        // SAFETY: release our +1 ref on the sink.
                        unsafe { webcore::FileSink::deref(file_sink) };
                        readable_stream.done(global_this);
                        return Ok(JSPromise::resolved_promise_value(global_this, JSValue::js_number(0.0)));
                    }
                    jsc::js_promise::Status::Rejected => {
                        // SAFETY: release our +1 ref on the sink.
                        unsafe { webcore::FileSink::deref(file_sink) };
                        readable_stream.cancel(global_this);
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            promise.result(global_this.vm()),
                        ));
                    }
                }
            } else {
                // SAFETY: release our +1 ref on the sink.
                unsafe { webcore::FileSink::deref(file_sink) };
                readable_stream.cancel(global_this);
                return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this, assignment_result,
                ));
            }
        }
        // SAFETY: release our +1 ref on the sink.
        unsafe { webcore::FileSink::deref(file_sink) };

        Ok(JSPromise::resolved_promise_value(global_this, JSValue::js_number(0.0)))
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_writer(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old::<1>();
        let arguments = &arguments_.ptr[..arguments_.len];

        if !arguments[0].is_empty_or_undefined_or_null() && !arguments[0].is_object() {
            return Err(global_this.throw_invalid_arguments("options must be an object or undefined"));
        }

        validate_writable_blob(global_this, self)?;

        let store = self.store.as_ref().unwrap().clone();
        if self.is_s3() {
            // TODO(port): full S3 writableStream branch (Zig lines 2812-2888).
            // Reads options.type/contentDisposition/contentEncoding, then calls S3::writable_stream.
            return Err(jsc::JsError::Thrown); // placeholder
        }

        // TODO(port): Windows-specific FileSink open path (Zig lines 2890-2952).

        #[cfg(not(windows))]
        {
            let mut sink = webcore::FileSink::init(
                bun_sys::Fd::INVALID,
                // SAFETY: self.global_this stored from a live &JSGlobalObject; VM outlives this task.
                jsc::EventLoopHandle::init(
                    unsafe { (*(*self.global_this).bun_vm()).event_loop() } as *mut (),
                ),
            );

            let input_path: webcore::PathOrFileDescriptor = match &store.data.as_file().pathlike {
                PathOrFileDescriptor::Fd(fd) => webcore::PathOrFileDescriptor::Fd(*fd),
                PathOrFileDescriptor::Path(p) => webcore::PathOrFileDescriptor::Path(
                    bun_str::ZigStringSlice::init_dupe(p.slice()).expect("oom"),
                ),
            };

            // PORT NOTE: `webcore::PathOrFileDescriptor` is not `Clone`; build user
            // options first, then move `input_path` in once.
            let mut stream_start = if !arguments.is_empty() && arguments[0].is_object() {
                streams::Start::from_js_with_tag::<{ streams::StartTag::FileSink }>(global_this, arguments[0])?
            } else {
                streams::Start::FileSink(streams::FileSinkOptions { chunk_size: 0, input_path: webcore::PathOrFileDescriptor::Fd(Fd::INVALID) })
            };
            if let streams::Start::FileSink(ref mut opts) = stream_start {
                opts.input_path = input_path;
            } else {
                stream_start = streams::Start::FileSink(streams::FileSinkOptions { chunk_size: 0, input_path });
            }

            // SAFETY: `init` returns a freshly-allocated +1 *mut FileSink; sole owner here.
            match unsafe { (*sink).start(stream_start) } {
                bun_sys::Result::Err(err) => {
                    // SAFETY: release the +1 ref from `init`.
                    unsafe { webcore::FileSink::deref(sink) };
                    return Err(global_this.throw_value(err.to_js(global_this)));
                }
                _ => {}
            }

            // SAFETY: sink is live; `to_js` transfers ownership to the JS wrapper.
            return Ok(unsafe { (*sink).to_js(global_this) });
        }
        #[cfg(windows)]
        unreachable!()
    }
}

// ──────────────────────────────────────────────────────────────────────────
// getSliceFrom / getSlice / type/name/lastModified/size getters
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    pub fn get_slice_from(
        &mut self,
        global_this: &JSGlobalObject,
        relative_start: i64,
        relative_end: i64,
        content_type: &[u8],
        content_type_was_allocated: bool,
    ) -> JSValue {
        let offset = self.offset.saturating_add(SizeType::try_from(relative_start).unwrap());
        let len = SizeType::try_from((relative_end.saturating_sub(relative_start)).max(0)).unwrap();

        // This copies over the charset field
        // which is okay because this will only be a <= slice
        let mut blob = self.dupe();
        blob.offset = offset;
        blob.size = len;

        // dupe() deep-copies an allocated content_type; we're about to replace it,
        // so release that copy first to avoid leaking it.
        if blob.content_type_allocated {
            // SAFETY: content_type_allocated implies a Box<[u8]> was leaked into content_type.
            unsafe { drop(Box::from_raw(blob.content_type as *mut [u8])) };
        }

        // infer the content type if it was not specified
        if content_type.is_empty() && !self.content_type_slice().is_empty() && !self.content_type_allocated {
            blob.content_type = self.content_type;
        } else {
            blob.content_type = content_type as *const [u8];
        }
        blob.content_type_allocated = content_type_was_allocated;
        blob.content_type_was_set = self.content_type_was_set || content_type_was_allocated;

        // PORT NOTE: `JsClass::to_js` heap-promotes via `Blob::new` internally.
        blob.to_js(global_this)
    }

    /// https://w3c.github.io/FileAPI/#slice-method-algo
    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_slice(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut arguments_ = callframe.arguments_old::<3>();
        // PORT NOTE: index the full fixed-3 array (Zig writes args[2] regardless of len).
        let args = &mut arguments_.ptr[..];

        if self.size == 0 {
            // PORT NOTE: `JsClass::to_js` heap-promotes via `Blob::new` internally.
            return Ok(Blob::init_empty(global_this).to_js(global_this));
        }

        // If the optional start parameter is not used as a parameter, let relativeStart be 0.
        let mut relative_start: i64 = 0;
        // If the optional end parameter is not used, let relativeEnd be size.
        let mut relative_end: i64 = i64::try_from(self.size).unwrap();

        // PORT NOTE: Zig mutates the fixed-3 args array in place to shift string arg into [2].
        if args[0].is_string() {
            args[2] = args[0];
            args[1] = JSValue::ZERO;
            args[0] = JSValue::ZERO;
        } else if args[1].is_string() {
            args[2] = args[1];
            args[1] = JSValue::ZERO;
        }

        let mut args_iter = jsc::ArgumentsSlice::init(unsafe { &*global_this.bun_vm() }, &arguments_.ptr[..3]);
        if let Some(start_) = args_iter.next_eat() {
            if start_.is_number() {
                let start = start_.to_int64();
                if start < 0 {
                    relative_start = (start.wrapping_add(i64::try_from(self.size).unwrap())).max(0);
                } else {
                    relative_start = start.min(i64::try_from(self.size).unwrap());
                }
            }
        }

        if let Some(end_) = args_iter.next_eat() {
            if end_.is_number() {
                let end = end_.to_int64();
                if end < 0 {
                    relative_end = (end.wrapping_add(i64::try_from(self.size).unwrap())).max(0);
                } else {
                    relative_end = end.min(i64::try_from(self.size).unwrap());
                }
            }
        }

        let mut content_type: *const [u8] = b"" as &'static [u8] as *const [u8];
        let mut content_type_was_allocated = false;
        if let Some(content_type_) = args_iter.next_eat() {
            'inner: {
                if content_type_.is_string() {
                    let zig_str = content_type_.get_zig_string(global_this)?;
                    let slicer = zig_str.to_slice();
                    let slice = slicer.slice();
                    if !strings::is_all_ascii(slice) {
                        break 'inner;
                    }

                    if let Some(mime) = unsafe { (*global_this.bun_vm()).mime_type(slice) } {
                        content_type = match mime.value {
                            ::std::borrow::Cow::Borrowed(s) => s as *const [u8],
                            ::std::borrow::Cow::Owned(v) => {
                                content_type_was_allocated = true;
                                Box::into_raw(v.into_boxed_slice())
                            }
                        };
                        break 'inner;
                    }

                    content_type_was_allocated = !slice.is_empty();
                    let mut buf = vec![0u8; slice.len()];
                    strings::copy_lowercase(slice, &mut buf);
                    content_type = Box::into_raw(buf.into_boxed_slice());
                }
            }
        }

        // SAFETY: content_type points to either a static literal, a 'static mime value,
        // or a freshly-leaked Box<[u8]> (when content_type_was_allocated).
        Ok(self.get_slice_from(
            global_this,
            relative_start,
            relative_end,
            unsafe { &*content_type },
            content_type_was_allocated,
        ))
    }

    pub fn get_mime_type(&self) -> Option<MimeType> {
        self.store.as_ref().map(|s| s.mime_type.clone())
    }

    pub fn get_mime_type_or_content_type(&self) -> Option<MimeType> {
        if self.content_type_was_set {
            return Some(MimeType::init(self.content_type_slice(), false, None));
        }
        self.store.as_ref().map(|s| s.mime_type.clone())
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_type(&self, global_this: &JSGlobalObject) -> JSValue {
        let ct = self.content_type_slice();
        if !ct.is_empty() {
            return JscZigString::init(ct).to_js(global_this);
        }
        if let Some(store) = &self.store {
            return JscZigString::init(&store.mime_type.value).to_js(global_this);
        }
        JscZigString::EMPTY.to_js(global_this)
    }

    pub fn get_name_string(&mut self) -> Option<BunString> {
        if self.name.tag() != bun_str::Tag::Dead {
            return Some(self.name.clone());
        }
        if let Some(path) = self.get_file_name() {
            self.name = BunString::clone_utf8(path);
            return Some(self.name.clone());
        }
        None
    }

    // TODO: Move this to a separate `File` object or BunFile
    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_name(&mut self, _: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match self.get_name_string() {
            Some(name) => name.to_js(global_this)?,
            None => JSValue::UNDEFINED,
        })
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(setter)]
    pub fn set_name(
        &mut self,
        js_this: JSValue,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        // by default we don't have a name so lets allow it to be set undefined
        if value.is_empty_or_undefined_or_null() {
            self.name.deref();
            self.name = BunString::dead();
            bun_jsc::generated::JSBlob::name_set_cached(js_this, global_this, value);
            return Ok(());
        }
        if value.is_string() {
            let old_name = core::mem::replace(&mut self.name, BunString::empty());
            // errdefer this.name = bun.String.empty — handled by the replace above.
            self.name = BunString::from_js(value, global_this)?;
            // We don't need to increment the reference count since try_from_js already did it.
            bun_jsc::generated::JSBlob::name_set_cached(js_this, global_this, value);
            old_name.deref();
        }
        Ok(())
    }

    pub fn get_loader(&self, jsc_vm: &VirtualMachine) -> Option<bun_bundler::options::Loader> {
        if let Some(filename) = self.get_file_name() {
            let current_path = bun_resolver::fs::Path::init(filename);
            return Some(
                current_path
                    .loader(&jsc_vm.transpiler.options.loaders)
                    .unwrap_or(bun_bundler::options::Loader::Tsx),
            );
        } else if let Some(mime_type) = self.get_mime_type_or_content_type() {
            return Some(bun_bundler::options::Loader::from_mime_type(mime_type));
        } else {
            // Be maximally permissive.
            return Some(bun_bundler::options::Loader::Tsx);
        }
    }

    // TODO: Move this to a separate `File` object or BunFile
    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_last_modified(&mut self, _: &JSGlobalObject) -> JSValue {
        if let Some(store) = &self.store {
            if let store::Data::File(file) = &store.data {
                // last_modified can be already set during read.
                if file.last_modified == jsc::INIT_TIMESTAMP as f64 && !self.is_s3() {
                    resolve_file_stat(store);
                }
                return JSValue::js_number(file.last_modified);
            }
        }

        if self.is_jsdom_file {
            return JSValue::js_number(self.last_modified);
        }

        JSValue::js_number(jsc::INIT_TIMESTAMP as f64)
    }

    pub fn get_size_for_bindings(&mut self) -> u64 {
        if self.size == MAX_SIZE {
            self.resolve_size();
        }

        // If the file doesn't exist or is not seekable
        // signal that the size is unknown.
        if let Some(store) = &self.store {
            if let store::Data::File(file) = &store.data {
                if !file.seekable.unwrap_or(false) {
                    return u64::MAX;
                }
            }
        }

        if self.size == MAX_SIZE {
            return u64::MAX;
        }

        self.size
    }
}

#[unsafe(no_mangle)]
pub extern "C" fn Bun__Blob__getSizeForBindings(this: &mut Blob) -> u64 {
    this.get_size_for_bindings()
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__getDataPtr(value: JSValue) -> *mut c_void {
    let Some(blob) = Blob::from_js(value) else { return core::ptr::null_mut() };
    // SAFETY: `from_js` returns a non-null pointer to a live JSC-owned Blob.
    let data = unsafe { (*blob).shared_view() };
    if data.is_empty() { return core::ptr::null_mut(); }
    data.as_ptr() as *mut c_void
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__getSize(value: JSValue) -> usize {
    let Some(blob) = Blob::from_js(value) else { return 0 };
    // SAFETY: `from_js` returns a non-null pointer to a live JSC-owned Blob.
    unsafe { (*blob).shared_view().len() }
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__fromBytes(
    global_this: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
) -> *mut Blob {
    if ptr.is_null() || len == 0 {
        return Blob::new(Blob::init_empty(global_this));
    }
    // SAFETY: caller guarantees [ptr, ptr+len) is valid.
    let bytes = unsafe { core::slice::from_raw_parts(ptr, len) }.to_vec();
    let store = Store::init(bytes);
    Blob::new(Blob::init_with_store(store, global_this))
}

/// Same as Blob__fromBytes but stamps content_type. `mime` must be a
/// string literal with process lifetime (not freed by deinit — the caller
/// passes one of the image/* constants).
#[unsafe(no_mangle)]
pub extern "C" fn Blob__fromBytesWithType(
    global_this: &JSGlobalObject,
    ptr: *const u8,
    len: usize,
    mime: *const c_char,
) -> *mut Blob {
    let blob = Blob__fromBytes(global_this, ptr, len);
    // SAFETY: caller guarantees `mime` is a NUL-terminated 'static C string.
    let mime_slice = unsafe { core::ffi::CStr::from_ptr(mime) }.to_bytes();
    if !mime_slice.is_empty() {
        unsafe {
            (*blob).content_type = mime_slice as *const [u8];
            (*blob).content_type_was_set = true;
            // content_type_allocated stays false — caller guarantees the string
            // outlives the Blob (it's a C string literal in the caller's .rodata).
        }
    }
    blob
}

// POSIX-only — bun_sys::munmap is a compile error on Windows, and the only
// caller (WebKit screenshot path) is macOS.
#[cfg(unix)]
pub mod mmap_free_interface {
    use super::*;
    // Stateless allocator vtable whose free() munmap's. Same pattern as
    // LinuxMemFdAllocator but without the stateful fd.
    unsafe fn free(_: *mut c_void, buf: &mut [u8], _: bun_alloc::Alignment, _: usize) {
        if let bun_sys::Result::Err(err) = bun_sys::munmap(buf.as_mut_ptr(), buf.len()) {
            bun_core::Output::debug_warn(format_args!("Blob mmap-store munmap failed: {:?}", err));
        }
    }
    unsafe fn alloc(_: *mut c_void, _: usize, _: bun_alloc::Alignment, _: usize) -> *mut u8 {
        // Unreachable: mmap-backed `Bytes` is fixed-size and never grows.
        core::ptr::null_mut()
    }
    static VTABLE: bun_alloc::AllocatorVTable = bun_alloc::AllocatorVTable {
        alloc,
        resize: bun_alloc::AllocatorVTable::NO_RESIZE,
        remap: bun_alloc::AllocatorVTable::NO_REMAP,
        free,
    };
    pub static ALLOCATOR: bun_alloc::StdAllocator = bun_alloc::StdAllocator {
        ptr: core::ptr::null_mut(),
        vtable: &VTABLE,
    };
}

/// Adopts an mmap'd region — no copy. The Blob's store holds the mapping;
/// when the store's refcount drops to zero, deinit calls allocator.free
/// which munmap's.
#[unsafe(no_mangle)]
pub extern "C" fn Blob__fromMmapWithType(
    global_this: &JSGlobalObject,
    ptr: *mut u8,
    len: usize,
    mime: *const c_char,
) -> *mut Blob {
    #[cfg(not(unix))]
    {
        // Windows Chrome backend never calls this; if it ever does, fall back to copying.
        return Blob__fromBytesWithType(global_this, ptr, len, mime);
    }
    #[cfg(unix)]
    {
        // SAFETY: caller (C++ WebKit screenshot path) guarantees `[ptr, ptr+len)`
        // is a valid page-aligned mmap'd region we now own.
        let store = Store::init_mmap(unsafe { core::slice::from_raw_parts_mut(ptr, len) });
        let blob = Blob::new(Blob::init_with_store(store, global_this));
        // SAFETY: caller (C++) passes a valid NUL-terminated C string.
        let mime_slice = unsafe { core::ffi::CStr::from_ptr(mime) }.to_bytes();
        if !mime_slice.is_empty() {
            // SAFETY: `blob` was just produced by Box::into_raw in Blob::new.
            unsafe {
                (*blob).content_type = mime_slice as *const [u8];
                (*blob).content_type_was_set = true;
            }
        }
        blob
    }
}

impl Blob {
    // TODO(b2-blocked): #[bun_jsc::host_fn(method)]
    pub fn get_stat(&mut self, global_this: &JSGlobalObject, callback: &CallFrame) -> JsResult<JSValue> {
        // TODO: make this async for files
        let tag = match &self.store {
            None => return Ok(JSValue::UNDEFINED),
            Some(s) => s.data.tag(),
        };
        match tag {
            store::DataTag::File => {
                let file = self.store.as_ref().unwrap().data.as_file();
                match &file.pathlike {
                    PathOrFileDescriptor::Path(path_like) => {
                        // SAFETY: bun_vm() returns the live VM for this global.
                        let vm = unsafe { &mut *global_this.bun_vm() };
                        // SAFETY: lazily-initialised per-VM NodeFS binding; never null after init.
                        let binding = unsafe { &mut *vm.node_fs().cast::<crate::node::node_fs_binding::Binding>() };
                        Ok(crate::node::fs::async_::Stat::create(
                            global_this,
                            binding,
                            crate::node::fs::args::Stat {
                                path: crate::node::types::PathLike::EncodedSlice(match path_like {
                                    // Already UTF-8 — take an owned copy.
                                    crate::node::types::PathLike::EncodedSlice(slice) => {
                                        ZigStringSlice::init_owned(slice.slice().to_vec())
                                    }
                                    other => ZigStringSlice::init_owned(other.slice().to_vec()),
                                }),
                                big_int: false,
                                throw_if_no_entry: true,
                            },
                            vm,
                        ))
                    }
                    PathOrFileDescriptor::Fd(fd) => {
                        // SAFETY: bun_vm() returns the live VM for this global.
                        let vm = unsafe { &mut *global_this.bun_vm() };
                        // SAFETY: lazily-initialised per-VM NodeFS binding; never null after init.
                        let binding = unsafe { &mut *vm.node_fs().cast::<crate::node::node_fs_binding::Binding>() };
                        Ok(crate::node::fs::async_::Fstat::create(
                            global_this,
                            binding,
                            crate::node::fs::args::Fstat { fd: *fd, big_int: false },
                            vm,
                        ))
                    }
                }
            }
            store::DataTag::S3 => crate::webcore::s3_file::get_stat(self, global_this, callback),
            store::DataTag::Bytes => Ok(JSValue::UNDEFINED),
        }
    }

    // TODO(b2-blocked): #[bun_jsc::host_fn(getter)]
    pub fn get_size(&mut self, _: &JSGlobalObject) -> JSValue {
        if self.size == MAX_SIZE {
            if self.is_s3() {
                return JSValue::js_number(f64::NAN);
            }
            self.resolve_size();
            if self.size == MAX_SIZE && self.store.is_some() {
                return JSValue::js_number(f64::INFINITY);
            } else if self.size == 0 && self.store.is_some() {
                if let store::Data::File(file) = &self.store.as_ref().unwrap().data {
                    if file.seekable.unwrap_or(true) == false && file.max_size == MAX_SIZE {
                        return JSValue::js_number(f64::INFINITY);
                    }
                }
            }
        }
        JSValue::js_number(self.size as f64)
    }

    pub fn resolve_size(&mut self) {
        if let Some(store) = &self.store {
            match &store.data {
                store::Data::Bytes(_) => {
                    let offset = self.offset;
                    let store_size = store.size();
                    if store_size != MAX_SIZE {
                        self.offset = store_size.min(offset);
                        self.size = store_size - offset;
                    }
                    return;
                }
                store::Data::File(file) => {
                    if file.seekable.is_none() {
                        resolve_file_stat(store);
                    }

                    if file.seekable.is_some() && file.max_size != MAX_SIZE {
                        let store_size = file.max_size;
                        let offset = self.offset;
                        self.offset = store_size.min(offset);
                        self.size = store_size.saturating_sub(offset);
                        return;
                    }

                    // For non-seekable files (pipes, FIFOs), the size is genuinely
                    // unknown — leave it as max_size so that stream readers don't
                    // treat it as an empty file.
                    if file.seekable == Some(false) {
                        return;
                    }
                }
                _ => {}
            }
            self.size = 0;
        } else {
            self.size = 0;
        }
    }

    /// Non-mutating variant of [`resolve_size`]: returns the `(offset, size)` that
    /// `resolve_size` would assign without touching `self`. Ported for callers
    /// (e.g. `ByteBlobLoader::setup`) that in Zig copied the whole `Blob` value
    /// (`var blobe = blob.*; blobe.resolveSize();`) — `Blob` is not `Clone` in Rust.
    pub fn resolved_size(&self) -> (SizeType, SizeType) {
        if let Some(store) = &self.store {
            match &store.data {
                store::Data::Bytes(_) => {
                    let offset = self.offset;
                    let store_size = store.size();
                    if store_size != MAX_SIZE {
                        return (store_size.min(offset), store_size - offset);
                    }
                    return (self.offset, self.size);
                }
                store::Data::File(file) => {
                    if file.seekable.is_none() {
                        resolve_file_stat(store);
                    }
                    if file.seekable.is_some() && file.max_size != MAX_SIZE {
                        let store_size = file.max_size;
                        let offset = self.offset;
                        return (store_size.min(offset), store_size.saturating_sub(offset));
                    }
                    if file.seekable == Some(false) {
                        return (self.offset, self.size);
                    }
                }
                _ => {}
            }
            (self.offset, 0)
        } else {
            (self.offset, 0)
        }
    }
}

/// resolve file stat like size, last_modified
fn resolve_file_stat(store: &StoreRef) {
    // SAFETY: `StoreRef::as_ptr()` yields the original `Box::into_raw` pointer; the
    // caller holds the only ref across this call, so an exclusive borrow is sound.
    let file = unsafe { (*store.as_ptr()).data.as_file_mut() };
    match &file.pathlike {
        PathOrFileDescriptor::Path(path) => {
            let mut buffer = bun_paths::PathBuffer::uninit();
            match bun_sys::stat(path.slice_z(&mut buffer)) {
                bun_sys::Result::Ok(stat) => {
                    file.max_size = if bun_sys::S::ISREG(stat.st_mode as _) || stat.st_size > 0 {
                        ((stat.st_size.max(0)) as u64) as SizeType
                    } else {
                        MAX_SIZE
                    };
                    file.mode = stat.st_mode as bun_sys::Mode;
                    file.seekable = Some(bun_sys::S::ISREG(stat.st_mode as _));
                    file.last_modified = jsc::to_js_time(stat.st_mtime as isize, stat.st_mtime_nsec as isize) as f64;
                }
                // the file may not exist yet. That's okay.
                _ => {}
            }
        }
        PathOrFileDescriptor::Fd(fd) => {
            match bun_sys::fstat(*fd) {
                bun_sys::Result::Ok(stat) => {
                    file.max_size = if bun_sys::S::ISREG(stat.st_mode as _) || stat.st_size > 0 {
                        ((stat.st_size.max(0)) as u64) as SizeType
                    } else {
                        MAX_SIZE
                    };
                    file.mode = stat.st_mode as bun_sys::Mode;
                    file.seekable = Some(bun_sys::S::ISREG(stat.st_mode as _));
                    file.last_modified = jsc::to_js_time(stat.st_mtime as isize, stat.st_mtime_nsec as isize) as f64;
                }
                _ => {}
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// constructor / finalize / init* / dupe / toJS / deinit / sharedView
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    // TODO(b2-blocked): #[bun_jsc::host_fn]
    pub fn constructor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<*mut Blob> {
        let mut blob: Blob;
        let arguments = callframe.arguments_old::<2>();
        let args = arguments.slice();

        match args.len() {
            0 => {
                blob = Blob::init(Vec::new(), global_this);
            }
            _ => {
                blob = Blob::get::<false, true>(global_this, args[0])?;

                if args.len() > 1 {
                    let options = args[1];
                    if options.is_object() {
                        if let Some(content_type) = options.get(global_this, "type")? {
                            'inner: {
                                if content_type.is_string() {
                                    let content_type_str = content_type.to_slice(global_this)?;
                                    let slice = content_type_str.slice();
                                    if !strings::is_all_ascii(slice) {
                                        break 'inner;
                                    }
                                    blob.content_type_was_set = true;

                                    if let Some(mime) = unsafe { (*global_this.bun_vm()).mime_type(slice) } {
                                        blob.content_type = match mime.value {
                                        ::std::borrow::Cow::Borrowed(s) => s as *const [u8],
                                        ::std::borrow::Cow::Owned(v) => {
                                            blob.content_type_allocated = true;
                                            Box::into_raw(v.into_boxed_slice())
                                        }
                                    };
                                        break 'inner;
                                    }
                                    let mut buf = vec![0u8; slice.len()];
                                    strings::copy_lowercase(slice, &mut buf);
                                    blob.content_type = Box::into_raw(buf.into_boxed_slice());
                                    blob.content_type_allocated = true;
                                }
                            }
                        }
                    }
                }

                if blob.content_type_slice().is_empty() {
                    blob.content_type = b"" as &'static [u8] as *const [u8];
                    blob.content_type_was_set = false;
                }
            }
        }

        blob.calculate_estimated_byte_size();
        Ok(Blob::new(blob))
    }

    pub fn finalize(this: *mut Self) {
        // SAFETY: called by codegen with a valid heap pointer.
        let this_ref = unsafe { &mut *this };
        debug_assert!(
            this_ref.is_heap_allocated(),
            "`finalize` may only be called on a heap-allocated Blob"
        );
        // PORT NOTE: `Ref::adopt` requires `Blob: ExternalSharedDescriptor`,
        // which is not yet implemented. Decrement the intrusive refcount directly;
        // `deref` calls `deinit()` (which `drop(Box::from_raw)`s if heap-allocated)
        // when the count reaches zero.
        super::Blob__deref(this_ref);
    }

    pub fn init_with_all_ascii(bytes: Vec<u8>, global_this: &JSGlobalObject, is_all_ascii: bool) -> Blob {
        // avoid allocating a Blob.Store if the buffer is actually empty
        let mut store: Option<StoreRef> = None;
        let len = bytes.len();
        if len > 0 {
            let s = Store::init(bytes);
            // SAFETY: freshly-minted Store with refcount==1; no other alias.
            unsafe { (*s.as_ptr()).is_all_ascii = Some(is_all_ascii) };
            store = Some(s);
        }
        Blob {
            size: len as SizeType,
            store,
            content_type: b"" as &'static [u8] as *const [u8],
            global_this: global_this,
            charset: strings::AsciiStatus::from_bool(Some(is_all_ascii)),
            ..Default::default()
        }
    }

    /// Takes ownership of `bytes`.
    pub fn init(bytes: impl Into<Vec<u8>>, global_this: &JSGlobalObject) -> Blob {
        let bytes: Vec<u8> = bytes.into();
        let len = bytes.len();
        Blob {
            size: len as SizeType,
            store: if len > 0 { Some(Store::init(bytes)) } else { None },
            content_type: b"" as &'static [u8] as *const [u8],
            global_this: global_this,
            ..Default::default()
        }
    }

    pub fn create_with_bytes_and_allocator(
        bytes: Vec<u8>,
        global_this: &JSGlobalObject,
        was_string: bool,
    ) -> Blob {
        let len = bytes.len();
        Blob {
            size: len as SizeType,
            store: if len > 0 { Some(Store::init(bytes)) } else { None },
            content_type: if was_string {
                bun_http_types::MimeType::TEXT.value.as_ref() as *const [u8]
            } else {
                b"" as &'static [u8] as *const [u8]
            },
            global_this: global_this,
            ..Default::default()
        }
    }

    pub fn try_create(
        bytes_: &[u8],
        global_this: &JSGlobalObject,
        was_string: bool,
    ) -> Result<Blob, bun_alloc::AllocError> {
        #[cfg(target_os = "linux")]
        {
            if crate::allocators::linux_mem_fd_allocator::LinuxMemFdAllocator::should_use(bytes_) {
                if let Ok(result) = crate::allocators::linux_mem_fd_allocator::LinuxMemFdAllocator::create(bytes_) {
                    // PORT NOTE: spell out all fields — `..Default::default()` would
                    // attempt a partial move out of `Store` which has a `Drop` impl.
                    let store = StoreRef::from(Store::new(Store {
                        data: store::Data::Bytes(result),
                        mime_type: bun_http_types::MimeType::NONE,
                        ref_count: AtomicU32::new(1),
                        is_all_ascii: None,
                    }));
                    let mut blob = Blob::init_with_store(store, global_this);
                    if was_string && blob.content_type_slice().is_empty() {
                        blob.content_type = bun_http_types::MimeType::TEXT.value.as_ref() as *const [u8];
                    }
                    return Ok(blob);
                }
            }
        }

        Ok(Self::create_with_bytes_and_allocator(bytes_.to_vec(), global_this, was_string))
    }

    pub fn create(bytes_: &[u8], global_this: &JSGlobalObject, was_string: bool) -> Blob {
        Self::try_create(bytes_, global_this, was_string).expect("oom")
    }

    // PORT NOTE: non-generic `init_with_store(StoreRef, ...)` / `init_empty` removed —
    // duplicates of the generic `init_with_store<S: Into<StoreRef>>` / `init_empty` below
    // (E0592). All `StoreRef` callers resolve to the generic via the reflexive `Into` impl.

    // Transferring doesn't change the reference count
    // It is a move
    #[inline]
    fn transfer(&mut self) {
        // Zig: `this.store = null` without `.deref()`. The receiver already
        // holds the same `*Store`; leak our +1 into theirs.
        if let Some(s) = self.store.take() {
            let _ = s.into_raw();
        }
    }

    pub fn detach(&mut self) {
        // Zig: `if (this.store != null) this.store.?.deref(); this.store = null;`
        // `StoreRef::drop` calls `Store::deref()`.
        self.store = None;
    }

    // dupe / dupe_with_content_type / to_js: defined once below (top-level impl); duplicates removed (E0592).

    /// Raw-pointer counterpart of [`shared_view`]: returns a `*mut [u8]` into
    /// the Store's byte buffer with **mutable provenance** (derived through
    /// `StoreRef::as_ptr()` → the original `Box::into_raw` tag), suitable for
    /// the `*_with_bytes` paths that hand the buffer to JSC as a writable
    /// ArrayBuffer backing. Mirrors Zig `@constCast(this.sharedView())` without
    /// laundering a `&[u8]` through `as *const _ as *mut _` (which would carry
    /// read-only provenance and make the downstream `&mut *buf` retag UB).
    ///
    /// Returns a dangling-empty slice when there is no byte store.
    ///
    /// # Aliasing
    /// The returned pointer aliases the Store's `Vec<u8>` payload. Callers must
    /// not hold a live `&`/`&mut` into the same Store across uses of this
    /// pointer, and must keep a `StoreRef` alive for the pointer's lifetime.
    fn shared_view_raw(&self) -> *mut [u8] {
        let empty = || core::ptr::slice_from_raw_parts_mut(core::ptr::NonNull::<u8>::dangling().as_ptr(), 0);
        if self.size == 0 {
            return empty();
        }
        let Some(store_ref) = self.store.as_ref() else { return empty() };
        // `as_ptr()` yields the `*mut Store` originally produced by
        // `Box::into_raw` (see `StoreRef::from<Box<Store>>`), so it carries
        // mutable provenance over the whole allocation.
        let store = store_ref.as_ptr();
        // SAFETY: `store` is live (we hold a `StoreRef`). No `&Store` is
        // materialized here — we go straight from the raw pointer — so the
        // brief `&mut` to the payload below does not alias any outstanding
        // borrow (other `StoreRef`s only hold raw `NonNull<Store>`, never a
        // long-lived `&Store`; JS execution is single-threaded).
        let (base, len) = unsafe {
            match &mut (*store).data {
                store::Data::Bytes(bytes) => {
                    let v = bytes.as_array_list_leak();
                    (v.as_mut_ptr(), v.len())
                }
                _ => return empty(),
            }
        };
        if len == 0 {
            return empty();
        }
        // Defensive: `offset` may originate from untrusted structured-clone data.
        let off = (self.offset as usize).min(len);
        let clamped = (len - off).min(self.size as usize);
        // SAFETY: `off <= len` and `clamped <= len - off`; `base[..len]` is the
        // initialized prefix of the Store's `Vec<u8>`.
        core::ptr::slice_from_raw_parts_mut(unsafe { base.add(off) }, clamped)
    }

    pub fn set_is_ascii_flag(&mut self, is_all_ascii: bool) {
        self.charset = strings::AsciiStatus::from_bool(Some(is_all_ascii));
        // if this Blob represents the entire binary data
        // we can update the store's is_all_ascii flag
        if self.size > 0 && self.offset == 0 {
            if let Some(store_ref) = self.store.as_ref() {
                let store = store_ref.as_ptr();
                // SAFETY: `store` is live (we hold a `StoreRef`); single-threaded
                // JS execution means no concurrent &Store borrow is outstanding.
                unsafe {
                    if matches!((*store).data, store::Data::Bytes(_)) {
                        (*store).is_all_ascii = Some(is_all_ascii);
                    }
                }
            }
        }
    }

    // is_all_ascii: canonical impl lives later in this file (pub). Duplicate
    // private helper removed here to fix E0592.

    // needs_to_read_file: defined once above; duplicate removed to fix E0034.
}

pub use crate::webcore::Lifetime as BlobLifetime;

// ──────────────────────────────────────────────────────────────────────────
// Local FFI shims for `ZigString` JSC methods not yet on `bun_jsc::ZigStringJsc`.
// Mirrors the `BunObject.rs` `ZigStringToJs` pattern.
// TODO(port): hoist into `bun_jsc::ZigStringJsc` once that trait grows these.
// ──────────────────────────────────────────────────────────────────────────
mod zigstring_blob_ext {
    use super::*;
    unsafe extern "C" {
        fn ZigString__toValueGC(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
        fn ZigString__toExternalValue(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
        fn ZigString__toExternalU16(ptr: *const u16, len: usize, global: *const JSGlobalObject) -> JSValue;
        fn ZigString__external(
            this: *const ZigString,
            global: *const JSGlobalObject,
            ctx: *mut c_void,
            cb: unsafe extern "C" fn(*mut c_void, *mut c_void, usize),
        ) -> JSValue;
        fn ZigString__toJSONObject(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    }
    // PORT NOTE: `to_js` / `to_external_value` / `to_json_object` live on the
    // crate-level `ZigStringBlobExt` (pulled in via `use super::*`). This local
    // trait only adds `external` (the JSC finalizer-backed external string),
    // which the crate-level trait doesn't carry yet, to avoid E0034 collisions.
    pub(super) trait ZigStringExternalExt {
        fn external(
            &self,
            global: &JSGlobalObject,
            ctx: *mut c_void,
            cb: unsafe extern "C" fn(*mut c_void, *mut c_void, usize),
        ) -> JSValue;
    }
    impl ZigStringExternalExt for ZigString {
        #[inline] fn external(
            &self,
            global: &JSGlobalObject,
            ctx: *mut c_void,
            cb: unsafe extern "C" fn(*mut c_void, *mut c_void, usize),
        ) -> JSValue {
            // SAFETY: `self` is `#[repr(C)] (ptr,len)`; `global` is live;
            // ownership of `ctx` transfers to JSC's finalizer.
            unsafe { ZigString__external(self, global, ctx, cb) }
        }
    }
    // Silence dead_code on the unused FFI re-decls (kept for symbol parity;
    // `to_js`/`to_external_value`/`to_json_object` resolve via the crate-level
    // `ZigStringBlobExt` instead).
    #[allow(dead_code)]
    const _: (unsafe extern "C" fn(*const ZigString, *const JSGlobalObject) -> JSValue,
              unsafe extern "C" fn(*const ZigString, *const JSGlobalObject) -> JSValue,
              unsafe extern "C" fn(*const ZigString, *const JSGlobalObject) -> JSValue) =
        (ZigString__toValueGC, ZigString__toExternalValue, ZigString__toJSONObject);
    #[inline]
    pub(super) fn zig_string_to_external_u16(ptr: *const u16, len: usize, global: &JSGlobalObject) -> JSValue {
        // SAFETY: `ptr[..len]` is a leaked default-allocator `Box<[u16]>`;
        // ownership transfers to JSC's external-string finalizer.
        unsafe { ZigString__toExternalU16(ptr, len, global) }
    }

    /// Zig `JSValue.jsTypeLoose()` — like `js_type()` but returns `Cell` for non-cell values.
    pub(super) trait JSValueBlobExt {
        fn js_type_loose(self) -> jsc::JSType;
    }
    impl JSValueBlobExt for JSValue {
        #[inline] fn js_type_loose(self) -> jsc::JSType {
            if self.is_cell() { self.js_type() } else { jsc::JSType::Cell }
        }
    }

    /// Local shim for `ZigString.Slice` allocator-identity queries that the
    /// `bun_str::ZigStringSlice` enum collapsed away. Used by
    /// `from_js_without_defer_gc` to decide whether a converted slice was
    /// freshly heap-allocated (=> may contain non-ASCII UTF-8) or is a
    /// borrowed WTF Latin-1 view (=> already known ASCII-safe).
    pub(super) trait ZigStringSliceBlobExt {
        /// Zig `slice.isWTFAllocator()` — true iff the bytes are backed by a
        /// `WTF::StringImpl` ref (i.e. no UTF-8 transcoding happened).
        fn is_wtf_backed(&self) -> bool;
        /// Zig `slice.allocator.get().is_some()` — true iff the slice owns a
        /// heap allocation (either default-allocator or WTF-refcounted).
        fn is_allocated(&self) -> bool;
    }
    impl ZigStringSliceBlobExt for bun_str::ZigStringSlice {
        #[inline] fn is_wtf_backed(&self) -> bool {
            matches!(self, bun_str::ZigStringSlice::WTF { .. })
        }
        #[inline] fn is_allocated(&self) -> bool {
            !matches!(self, bun_str::ZigStringSlice::Static(..))
        }
    }
}
use zigstring_blob_ext::{
    ZigStringExternalExt as _, JSValueBlobExt as _, ZigStringSliceBlobExt as _,
    zig_string_to_external_u16,
};
use bun_jsc::{StringJsc as _, ZigStringJsc as _};

// ──────────────────────────────────────────────────────────────────────────
// toStringWithBytes / toString / toJSON / toFormData / toArrayBuffer{View}
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    /// `raw_bytes` is a raw `*mut [u8]` (not `&[u8]`) so the
    /// `LIFETIME == Temporary` branch can `Box::from_raw` it with the
    /// caller's original allocation provenance — going through `&[u8]`
    /// would narrow to read-only and make the dealloc UB.
    pub fn to_string_with_bytes<const LIFETIME: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        raw_bytes: *mut [u8],
    ) -> JsResult<JSValue> {
        // SAFETY: `raw_bytes` is valid for reads for the duration of this call
        // (either a leaked Box for `Temporary` or a store-backed view otherwise).
        let raw_slice: &[u8] = unsafe { &*raw_bytes };
        let (bom, buf) = strings::BOM::detect_and_split(raw_slice);

        if buf.is_empty() {
            // If all it contained was the bom, we need to free the bytes
            if LIFETIME == Lifetime::Temporary {
                // SAFETY: temporary lifetime means raw_bytes is a leaked default-allocator buffer.
                unsafe { drop(Box::from_raw(raw_bytes)) };
            }
            return Ok(ZigString::EMPTY.to_js(global));
        }

        if bom == Some(strings::BOM::Utf16Le) {
            let _free = scopeguard::guard((), |_| {
                if LIFETIME == Lifetime::Temporary {
                    unsafe { drop(Box::from_raw(raw_bytes)) };
                }
            });
            // SAFETY: BOM::Utf16Le ⇒ buf is UTF-16LE bytes; len is even after BOM strip.
            // Mirrors Zig `bun.reinterpretSlice(u16, buf)`.
            let out = BunString::clone_utf16(unsafe {
                core::slice::from_raw_parts(buf.as_ptr() as *const u16, buf.len() / 2)
            });
            return out.to_js(global);
        }

        // null == unknown
        // false == can't be
        let could_be_all_ascii = self.is_all_ascii().or(self.store.as_ref().and_then(|s| s.is_all_ascii));

        if could_be_all_ascii.is_none() || !could_be_all_ascii.unwrap() {
            // if to_utf16_alloc returns None, it means there are no non-ASCII characters
            if let Some(external) = strings::to_utf16_alloc(buf, false, false)
                .map_err(|_| global.throw_out_of_memory())?
            {
                if LIFETIME != Lifetime::Temporary {
                    self.set_is_ascii_flag(false);
                }
                if LIFETIME == Lifetime::Transfer {
                    self.detach();
                }
                if LIFETIME == Lifetime::Temporary {
                    unsafe { drop(Box::from_raw(raw_bytes)) };
                }
                // Ownership of the UTF-16 buffer transfers to JSC's external-string finalizer.
                let external = Box::leak(external.into_boxed_slice());
                return Ok(zig_string_to_external_u16(external.as_ptr(), external.len(), global));
            }

            if LIFETIME != Lifetime::Temporary {
                self.set_is_ascii_flag(true);
            }
        }

        match LIFETIME {
            // strings are immutable
            // we don't need to clone
            Lifetime::Clone => {
                let store = self.store.as_ref().unwrap().clone();
                // we don't need to worry about UTF-8 BOM in this case because the store owns the memory.
                Ok(ZigString::init(buf).external(global, store.into_raw() as *mut c_void, Store::external))
            }
            Lifetime::Transfer => {
                let store = self.store.as_ref().unwrap().clone();
                debug_assert!(matches!(store.data, store::Data::Bytes(_)));
                self.transfer();
                Ok(ZigString::init(buf).external(global, store.into_raw() as *mut c_void, Store::external))
            }
            Lifetime::Share => {
                let store = self.store.as_ref().unwrap().clone();
                Ok(ZigString::init(buf).external(global, store.into_raw() as *mut c_void, Store::external))
            }
            Lifetime::Temporary => {
                // if there was a UTF-8 BOM, we need to clone the buffer because
                // external doesn't support this case here yet.
                if buf.len() != raw_slice.len() {
                    let out = BunString::clone_latin1(buf);
                    // SAFETY: `Temporary` ⇒ caller passed a leaked `Box<[u8]>`.
                    unsafe { drop(Box::from_raw(raw_bytes)) };
                    return out.to_js(global);
                }
                Ok(ZigString::init(buf).to_external_value(global))
            }
        }
    }

    pub fn to_string_transfer(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_string(global, Lifetime::Transfer)
    }

    pub fn to_string(&mut self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        if self.needs_to_read_file() {
            return Ok(self.do_read_file::<ToStringWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToStringWithBytesFn>(global).map_err(Into::into);
        }

        // PORT NOTE: reshaped for borrowck — Zig @constCast'd shared_view().
        // `shared_view_raw` yields a `*mut [u8]` with mutable provenance (via
        // `StoreRef::as_ptr`), avoiding the const→mut cast. `to_string_with_bytes`
        // only ever reads through it (`&*raw_bytes`); the sole write path —
        // `Box::from_raw` in the `Temporary` arm — is statically unreachable
        // below. Mirrors Zig `@constCast(this.sharedView())`.
        let view_ptr = self.shared_view_raw();
        if view_ptr.len() == 0 {
            return Ok(ZigString::EMPTY.to_js(global));
        }
        // TODO(port): dispatch on `lifetime` (was comptime in Zig). Phase B.
        match lifetime {
            Lifetime::Clone => self.to_string_with_bytes::<{ Lifetime::Clone }>(global, view_ptr),
            Lifetime::Transfer => self.to_string_with_bytes::<{ Lifetime::Transfer }>(global, view_ptr),
            Lifetime::Share => self.to_string_with_bytes::<{ Lifetime::Share }>(global, view_ptr),
            // UB guard: `Temporary` would `Box::from_raw(view_ptr)`, but
            // `view_ptr` points at a store-owned interior slice (not a leaked
            // `Box<[u8]>`). No Zig caller passes `.temporary` to `toString`;
            // the leaked-buffer path calls `to_string_with_bytes` directly.
            Lifetime::Temporary => unreachable!("Blob::to_string: store-owned bytes are never Temporary"),
        }
    }

    pub fn to_json(&mut self, global: &JSGlobalObject, _lifetime: Lifetime) -> JsResult<JSValue> {
        if self.needs_to_read_file() {
            return Ok(self.do_read_file::<ToJsonWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToJsonWithBytesFn>(global).map_err(Into::into);
        }

        // `shared_view_raw` yields a `*mut [u8]` with mutable provenance (via
        // `StoreRef::as_ptr`). `LIFETIME == Share` ⇒ `to_json_with_bytes` never
        // frees the pointer; it is read-only. Mirrors Zig
        // `@constCast(this.sharedView())`.
        let view_ptr = self.shared_view_raw();
        // TODO(port): dispatch on lifetime const-generic
        self.to_json_with_bytes::<{ Lifetime::Share }>(global, view_ptr)
    }

    /// See [`to_string_with_bytes`] for why `raw_bytes` is `*mut [u8]`.
    pub fn to_json_with_bytes<const LIFETIME: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        raw_bytes: *mut [u8],
    ) -> JsResult<JSValue> {
        // SAFETY: `raw_bytes` is valid for reads for the duration of this call
        // (either a leaked Box for `Temporary` or a store-backed view otherwise).
        let (bom, buf) = strings::BOM::detect_and_split(unsafe { &*raw_bytes });
        if buf.is_empty() {
            if LIFETIME == Lifetime::Temporary {
                unsafe { drop(Box::from_raw(raw_bytes)) };
            }
            return Ok(global.create_syntax_error_instance(format_args!("Unexpected end of JSON input")));
        }

        if bom == Some(strings::BOM::Utf16Le) {
            // SAFETY: BOM::Utf16Le ⇒ buf is UTF-16LE bytes; len is even after BOM strip.
            // Mirrors Zig `bun.reinterpretSlice(u16, buf)`.
            let mut out = BunString::clone_utf16(unsafe {
                core::slice::from_raw_parts(buf.as_ptr() as *const u16, buf.len() / 2)
            });
            // PORT NOTE: Zig used `defer { free; detach }`. Reshaped to compute the
            // result first, then perform the deferred work explicitly — capturing
            // `&mut self` in a scopeguard closure conflicts with later uses below.
            let result = out.to_js_by_parse_json(global);
            if LIFETIME == Lifetime::Temporary {
                // SAFETY: `Temporary` ⇒ caller passed a leaked `Box<[u8]>`.
                unsafe { drop(Box::from_raw(raw_bytes)) };
            }
            if LIFETIME == Lifetime::Transfer {
                self.detach();
            }
            return result;
        }
        // null == unknown
        // false == can't be
        let could_be_all_ascii = self.is_all_ascii().or(self.store.as_ref().and_then(|s| s.is_all_ascii));
        // When a BOM is present `buf` is an interior slice of `raw_bytes`; we must
        // free the original allocation, not the offset pointer.
        let _free = scopeguard::guard((), |_| {
            if LIFETIME == Lifetime::Temporary {
                unsafe { drop(Box::from_raw(raw_bytes)) };
            }
        });

        if could_be_all_ascii.is_none() || !could_be_all_ascii.unwrap() {
            // PERF(port): was stack-fallback alloc — profile in Phase B.
            if let Some(external) = strings::to_utf16_alloc(buf, false, false).ok().flatten() {
                if LIFETIME != Lifetime::Temporary {
                    self.set_is_ascii_flag(false);
                }
                let result = ZigString::init_utf16(&external).to_json_object(global);
                drop(external);
                return Ok(result);
            }

            if LIFETIME != Lifetime::Temporary {
                self.set_is_ascii_flag(true);
            }
        }

        Ok(ZigString::init(buf).to_json_object(global))
    }

    /// See [`to_string_with_bytes`] for why `buf` is `*mut [u8]`.
    pub fn to_form_data_with_bytes<const _L: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        buf: *mut [u8],
    ) -> JSValue {
        let Some(encoder) = self.get_form_data_encoding() else {
            return ZigString::init(b"Invalid encoding").to_error_instance(global);
        };

        // PORT NOTE: `crate::webcore::form_data::Encoding` re-exports
        // `bun_core::form_data::Encoding` — same type, no re-tagging needed.
        // SAFETY: `buf` is valid for reads for the duration of this call (either a
        // leaked Box for `Temporary` or a store-backed view otherwise);
        // `FormData::to_js` only reads it.
        match crate::webcore::form_data::FormData::to_js(global, unsafe { &*buf }, &encoder.encoding) {
            Ok(v) => v,
            Err(err) => global
                .create_error_instance(format_args!("FormData encoding failed: {err}")),
        }
    }

    pub fn to_array_buffer_with_bytes<const LIFETIME: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        buf: *mut [u8],
    ) -> JsResult<JSValue> {
        self.to_array_buffer_view_with_bytes::<LIFETIME, { jsc::JSType::ArrayBuffer }>(global, buf)
    }

    pub fn to_uint8_array_with_bytes<const LIFETIME: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        buf: *mut [u8],
    ) -> JsResult<JSValue> {
        self.to_array_buffer_view_with_bytes::<LIFETIME, { jsc::JSType::Uint8Array }>(global, buf)
    }

    /// See [`to_string_with_bytes`] for why `buf` is `*mut [u8]`.
    pub fn to_array_buffer_view_with_bytes<const LIFETIME: Lifetime, const TYPED_ARRAY_VIEW: jsc::JSType>(
        &mut self,
        global: &JSGlobalObject,
        buf: *mut [u8],
    ) -> JsResult<JSValue> {
        // SAFETY: `buf` is valid for reads for the duration of this call (either a
        // leaked Box for `Temporary` or a store-backed view otherwise).
        let buf_len = unsafe { &*buf }.len();
        match LIFETIME {
            Lifetime::Clone => {
                if TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer {
                    // ArrayBuffer doesn't have this limit.
                    if buf_len > unsafe { jsc::virtual_machine::SYNTHETIC_ALLOCATION_LIMIT } {
                        self.detach();
                        return Err(global.throw_out_of_memory());
                    }
                }

                #[cfg(target_os = "linux")]
                {
                    // If we can use a copy-on-write clone of the buffer, do so.
                    // TODO(port): blocked_on: store::Bytes.allocator —
                    // ByteStore collapsed `ptr+len+cap+allocator` into `Vec<u8>`
                    // (see Store.rs PORT NOTE), so there is no allocator handle to
                    // downcast via `LinuxMemFdAllocator::from`. The COW-memfd fast
                    // path is a perf optimization; fall through to the copying path
                    // below until Phase B re-threads memfd identity (likely a tag on
                    // `store::Bytes` set by `LinuxMemFdAllocator::create`).
                    let _ = &self.store;
                }
                // SAFETY: `Clone` copies into a new JSC allocation; `buf` is only read.
                jsc::ArrayBuffer::create::<TYPED_ARRAY_VIEW>(global, unsafe { &*buf })
            }
            Lifetime::Share => {
                if buf_len > unsafe { jsc::virtual_machine::SYNTHETIC_ALLOCATION_LIMIT } && TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer {
                    return Err(global.throw_out_of_memory());
                }
                let store = self.store.as_ref().unwrap().clone();
                // SAFETY: `from_bytes` only records ptr+len into the FFI struct; the
                // pointer is then handed to JSC as an external buffer backing whose
                // lifetime is the cloned `store` ref above. No Rust-side `&` to the
                // Store bytes is live across this reborrow. Mirrors Zig `@constCast`.
                jsc::ArrayBuffer::from_bytes(unsafe { &mut *buf }, TYPED_ARRAY_VIEW).to_js_with_context(
                    global,
                    store.into_raw() as *mut c_void,
                    Some(blob_store_array_buffer_deallocator),
                )
            }
            Lifetime::Transfer => {
                if buf_len > unsafe { jsc::virtual_machine::SYNTHETIC_ALLOCATION_LIMIT }
                    && TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer
                {
                    self.detach();
                    return Err(global.throw_out_of_memory());
                }
                let store = self.store.as_ref().unwrap().clone();
                self.transfer();
                // SAFETY: see `Share` arm. After `transfer()` the store ref is moved
                // out of `self`, so JSC becomes the sole owner via the deallocator.
                jsc::ArrayBuffer::from_bytes(unsafe { &mut *buf }, TYPED_ARRAY_VIEW).to_js_with_context(
                    global,
                    store.into_raw() as *mut c_void,
                    Some(blob_store_array_buffer_deallocator),
                )
            }
            Lifetime::Temporary => {
                if buf_len > unsafe { jsc::virtual_machine::SYNTHETIC_ALLOCATION_LIMIT }
                    && TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer
                {
                    // SAFETY: `Temporary` ⇒ `buf` is a leaked default-allocator `Box<[u8]>`.
                    unsafe { drop(Box::from_raw(buf)) };
                    return Err(global.throw_out_of_memory());
                }
                // SAFETY: `Temporary` ⇒ `buf` is a leaked `Box<[u8]>` we exclusively own;
                // ownership is transferred to JSC via `to_js` (Zig: `JSC.MarkedArrayBuffer.fromBytes`).
                jsc::ArrayBuffer::from_bytes(unsafe { &mut *buf }, TYPED_ARRAY_VIEW).to_js(global)
            }
        }
    }

    pub fn to_array_buffer(&mut self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        debug!("toArrayBuffer");
        self.to_array_buffer_view::<{ jsc::JSType::ArrayBuffer }>(global, lifetime)
    }

    pub fn to_uint8_array(&mut self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        debug!("toUin8Array");
        self.to_array_buffer_view::<{ jsc::JSType::Uint8Array }>(global, lifetime)
    }

    pub fn to_array_buffer_view<const TYPED_ARRAY_VIEW: jsc::JSType>(
        &mut self,
        global: &JSGlobalObject,
        lifetime: Lifetime,
    ) -> JsResult<JSValue> {
        if self.needs_to_read_file() {
            return Ok(match TYPED_ARRAY_VIEW {
                jsc::JSType::ArrayBuffer => self.do_read_file::<ToArrayBufferWithBytesFn>(global),
                _ => self.do_read_file::<ToUint8ArrayWithBytesFn>(global),
            });
        }
        if self.is_s3() {
            return match TYPED_ARRAY_VIEW {
                jsc::JSType::ArrayBuffer => self.do_read_from_s3::<ToArrayBufferWithBytesFn>(global),
                _ => self.do_read_from_s3::<ToUint8ArrayWithBytesFn>(global),
            }.map_err(Into::into);
        }

        // PORT NOTE: reshaped for borrowck — Zig @constCast'd shared_view().
        // `shared_view_raw` yields a `*mut [u8]` with mutable provenance (via
        // `StoreRef::as_ptr`). The `Clone` arm only reads (`&*buf`);
        // `Share`/`Transfer` hand the ptr to JSC as an external ArrayBuffer
        // backing via FFI and materialize `&mut *buf` to record ptr+len, which
        // is sound now that the provenance is writable. The `Temporary` arm
        // (`Box::from_raw`) is statically unreachable below. Mirrors Zig
        // `@constCast(this.sharedView())`.
        let view_ptr = self.shared_view_raw();
        if view_ptr.len() == 0 {
            return jsc::ArrayBuffer::create::<TYPED_ARRAY_VIEW>(global, b"");
        }
        // TODO(port): dispatch on lifetime const-generic and TYPED_ARRAY_VIEW.
        match lifetime {
            Lifetime::Clone => self.to_array_buffer_view_with_bytes::<{ Lifetime::Clone }, TYPED_ARRAY_VIEW>(global, view_ptr),
            Lifetime::Share => self.to_array_buffer_view_with_bytes::<{ Lifetime::Share }, TYPED_ARRAY_VIEW>(global, view_ptr),
            Lifetime::Transfer => self.to_array_buffer_view_with_bytes::<{ Lifetime::Transfer }, TYPED_ARRAY_VIEW>(global, view_ptr),
            // UB guard: `Temporary` would `Box::from_raw(view_ptr)`, but
            // `view_ptr` points at a store-owned interior slice (not a leaked
            // `Box<[u8]>`). No Zig caller passes `.temporary` to
            // `toArrayBufferView`; the leaked-buffer path calls
            // `to_array_buffer_view_with_bytes` directly.
            Lifetime::Temporary => unreachable!("Blob::to_array_buffer_view: store-owned bytes are never Temporary"),
        }
    }

    pub fn to_form_data(&mut self, global: &JSGlobalObject, _lifetime: Lifetime) -> Result<JSValue, jsc::JsTerminated> {
        if self.needs_to_read_file() {
            return Ok(self.do_read_file::<ToFormDataWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToFormDataWithBytesFn>(global);
        }

        // PORT NOTE: reshaped for borrowck — Zig @constCast'd shared_view().
        // `shared_view_raw` yields a `*mut [u8]` with mutable provenance (via
        // `StoreRef::as_ptr`). It is *only ever read* by
        // `to_form_data_with_bytes` (`FormData::to_js` takes `&[u8]`). Note: the
        // Store is intrusively shared (`ref_count: AtomicU32`); `&mut self` does
        // NOT imply exclusive ownership of the underlying bytes. Mirrors Zig
        // `@constCast(this.sharedView())`.
        let view_ptr = self.shared_view_raw();
        if view_ptr.len() == 0 {
            return Ok(jsc::DOMFormData::create(global));
        }
        Ok(self.to_form_data_with_bytes::<{ Lifetime::Temporary }>(global, view_ptr))
    }
}

// Marker types for the comptime fn dispatch through do_read_file/do_read_from_s3.
// Each implements `ReadFileToJs` so a plain fn-pointer monomorphizes per `*WithBytes` body.
pub struct ToStringWithBytesFn;
pub struct ToJsonWithBytesFn;
pub struct ToArrayBufferWithBytesFn;
pub struct ToUint8ArrayWithBytesFn;
pub struct ToFormDataWithBytesFn;

impl read_file::ReadFileToJs for ToStringWithBytesFn {
    fn call(b: &mut Blob, g: &JSGlobalObject, by: &mut [u8], l: Lifetime) -> JsResult<JSValue> {
        match l {
            Lifetime::Clone => b.to_string_with_bytes::<{ Lifetime::Clone }>(g, by as *mut [u8]),
            Lifetime::Temporary => b.to_string_with_bytes::<{ Lifetime::Temporary }>(g, by as *mut [u8]),
            Lifetime::Share => b.to_string_with_bytes::<{ Lifetime::Share }>(g, by as *mut [u8]),
            Lifetime::Transfer => b.to_string_with_bytes::<{ Lifetime::Transfer }>(g, by as *mut [u8]),
        }
    }
}
impl read_file::ReadFileToJs for ToJsonWithBytesFn {
    fn call(b: &mut Blob, g: &JSGlobalObject, by: &mut [u8], l: Lifetime) -> JsResult<JSValue> {
        match l {
            Lifetime::Clone => b.to_json_with_bytes::<{ Lifetime::Clone }>(g, by as *mut [u8]),
            Lifetime::Temporary => b.to_json_with_bytes::<{ Lifetime::Temporary }>(g, by as *mut [u8]),
            Lifetime::Share => b.to_json_with_bytes::<{ Lifetime::Share }>(g, by as *mut [u8]),
            Lifetime::Transfer => b.to_json_with_bytes::<{ Lifetime::Transfer }>(g, by as *mut [u8]),
        }
    }
}
impl read_file::ReadFileToJs for ToArrayBufferWithBytesFn {
    fn call(b: &mut Blob, g: &JSGlobalObject, by: &mut [u8], l: Lifetime) -> JsResult<JSValue> {
        match l {
            Lifetime::Clone => b.to_array_buffer_with_bytes::<{ Lifetime::Clone }>(g, by as *mut [u8]),
            Lifetime::Temporary => b.to_array_buffer_with_bytes::<{ Lifetime::Temporary }>(g, by as *mut [u8]),
            Lifetime::Share => b.to_array_buffer_with_bytes::<{ Lifetime::Share }>(g, by as *mut [u8]),
            Lifetime::Transfer => b.to_array_buffer_with_bytes::<{ Lifetime::Transfer }>(g, by as *mut [u8]),
        }
    }
}
impl read_file::ReadFileToJs for ToUint8ArrayWithBytesFn {
    fn call(b: &mut Blob, g: &JSGlobalObject, by: &mut [u8], l: Lifetime) -> JsResult<JSValue> {
        match l {
            Lifetime::Clone => b.to_uint8_array_with_bytes::<{ Lifetime::Clone }>(g, by as *mut [u8]),
            Lifetime::Temporary => b.to_uint8_array_with_bytes::<{ Lifetime::Temporary }>(g, by as *mut [u8]),
            Lifetime::Share => b.to_uint8_array_with_bytes::<{ Lifetime::Share }>(g, by as *mut [u8]),
            Lifetime::Transfer => b.to_uint8_array_with_bytes::<{ Lifetime::Transfer }>(g, by as *mut [u8]),
        }
    }
}
impl read_file::ReadFileToJs for ToFormDataWithBytesFn {
    fn call(b: &mut Blob, g: &JSGlobalObject, by: &mut [u8], l: Lifetime) -> JsResult<JSValue> {
        let _ = l; // FormData ignores lifetime — bytes are read-only.
        Ok(b.to_form_data_with_bytes::<{ Lifetime::Temporary }>(g, by as *mut [u8]))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// get / fromJSMove / fromJSClone / fromJSWithoutDeferGC
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    #[inline]
    pub fn get<const MOVE: bool, const REQUIRE_ARRAY: bool>(
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<Blob> {
        // Zig: `comptime move: bool, comptime require_array: bool`.
        match (MOVE, REQUIRE_ARRAY) {
            (true, false) => Self::from_js_move(global, arg),
            (false, false) => Self::from_js_clone_optional_array(global, arg),
            (_, true) => Self::from_js_clone(global, arg),
        }
    }

    #[inline]
    pub fn from_js_move(global: &JSGlobalObject, arg: JSValue) -> JsResult<Blob> {
        Self::from_js_without_defer_gc::<true, false>(global, arg)
    }

    #[inline]
    pub fn from_js_clone(global: &JSGlobalObject, arg: JSValue) -> JsResult<Blob> {
        Self::from_js_without_defer_gc::<false, true>(global, arg)
    }

    #[inline]
    pub fn from_js_clone_optional_array(global: &JSGlobalObject, arg: JSValue) -> JsResult<Blob> {
        Self::from_js_without_defer_gc::<false, false>(global, arg)
    }

    fn from_js_without_defer_gc<const MOVE: bool, const REQUIRE_ARRAY: bool>(
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<Blob> {
        let mut current = arg;
        if current.is_undefined_or_null() {
            return Ok(Blob { global_this: global, ..Default::default() });
        }

        let mut top_value = current;
        let mut might_only_be_one_thing = false;
        arg.ensure_still_alive();
        let _keep = jsc::EnsureStillAlive(arg);
        let mut fail_if_top_value_is_not_typed_array_like = false;
        match current.js_type_loose() {
            jsc::JSType::Array | jsc::JSType::DerivedArray => {
                let mut top_iter = jsc::JSArrayIterator::init(current, global)?;
                might_only_be_one_thing = top_iter.len == 1;
                if top_iter.len == 0 {
                    return Ok(Blob { global_this: global, ..Default::default() });
                }
                if might_only_be_one_thing {
                    top_value = top_iter.next()?.unwrap();
                }
            }
            _ => {
                might_only_be_one_thing = true;
                if REQUIRE_ARRAY {
                    fail_if_top_value_is_not_typed_array_like = true;
                }
            }
        }

        if might_only_be_one_thing || !MOVE {
            // Fast path: one item, we don't need to join
            match top_value.js_type_loose() {
                jsc::JSType::Cell
                | jsc::JSType::NumberObject
                | jsc::JSType::String
                | jsc::JSType::StringObject
                | jsc::JSType::DerivedStringObject => {
                    if !fail_if_top_value_is_not_typed_array_like {
                        let str = top_value.to_bun_string(global)?;
                        // PORT NOTE: Zig `toOwnedSliceReturningAllASCII` collapsed into
                        // `to_owned_slice` + a SIMD ASCII scan; identical observable result.
                        let bytes = str.to_owned_slice();
                        let ascii = strings::is_all_ascii(&bytes);
                        return Ok(Blob::init_with_all_ascii(bytes, global, ascii));
                    }
                }

                jsc::JSType::ArrayBuffer
                | jsc::JSType::Int8Array
                | jsc::JSType::Uint8Array
                | jsc::JSType::Uint8ClampedArray
                | jsc::JSType::Int16Array
                | jsc::JSType::Uint16Array
                | jsc::JSType::Int32Array
                | jsc::JSType::Uint32Array
                | jsc::JSType::Float16Array
                | jsc::JSType::Float32Array
                | jsc::JSType::Float64Array
                | jsc::JSType::BigInt64Array
                | jsc::JSType::BigUint64Array
                | jsc::JSType::DataView => {
                    return Blob::try_create(
                        top_value.as_array_buffer(global).unwrap().byte_slice(),
                        global,
                        false,
                    )
                    .map_err(Into::into);
                }

                jsc::JSType::DOMWrapper => {
                    if !fail_if_top_value_is_not_typed_array_like {
                        if let Some(blob_ptr) = top_value.as_::<Blob>() {
                            // SAFETY: JS heap pointer; single-threaded JS execution.
                            let blob = unsafe { &mut *blob_ptr };
                            if MOVE {
                                // Move the store without bumping its refcount, but take
                                // independent ownership of name/content_type so the
                                // source's eventual finalize() doesn't double-free them.
                                let mut _blob = blob.dupe_with_content_type(false);
                                // PORT NOTE: dupe() bumps Arc; Zig did a raw bitwise copy
                                // then transfer(). To preserve "no refcount bump", drop
                                // the source's store here without decrement.
                                blob.transfer();
                                // TODO(port): _blob.store currently double-counts; reconcile
                                // once Store is intrusive-refcounted.
                                return Ok(_blob);
                            } else {
                                return Ok(blob.dupe());
                            }
                        } else if let Some(artifact_ptr) = top_value.as_::<crate::api::BuildArtifact>() {
                            // SAFETY: `as_` returns a live `*mut BuildArtifact` rooted by `top_value`.
                            let blob = unsafe { &mut (*artifact_ptr).blob };
                            if MOVE {
                                let mut _blob = blob.dupe_with_content_type(false);
                                blob.transfer();
                                return Ok(_blob);
                            } else {
                                return Ok(blob.dupe());
                            }
                        } else {
                            let sliced = current.to_slice_clone(global)?;
                            // PORT NOTE: Zig checked `sliced.allocator.get()` to detect
                            // an owned (heap) slice; `ZigStringSlice` collapsed the
                            // allocator-vtable into an enum, so dispatch on the variant.
                            match sliced {
                                ZigStringSlice::Owned(v) => {
                                    return Ok(Blob::init(v, global));
                                }
                                _ => {
                                    return Blob::try_create(sliced.slice(), global, false)
                                        .map_err(Into::into);
                                }
                            }
                        }
                    }
                }

                _ => {}
            }

            // new Blob("ok")
            // new File("ok", "file.txt")
            if fail_if_top_value_is_not_typed_array_like {
                return Err(global.throw_invalid_arguments("new Blob() expects an Array"));
            }
        }

        // PERF(port): was stack-fallback(1024) alloc — BoundedArray keeps JSValues on
        // the conservatively-scanned stack (heap Vec<JSValue> is NOT GC-safe). Zig
        // spilled to heap past 128 entries; Phase B may need a rooted overflow path.
        let mut stack: bun_collections::BoundedArray<JSValue, 128> = bun_collections::BoundedArray::default();
        let mut joiner = bun_string::string_joiner::StringJoiner::default();
        let mut could_have_non_ascii = false;

        loop {
            match current.js_type_loose() {
                jsc::JSType::NumberObject
                | jsc::JSType::String
                | jsc::JSType::StringObject
                | jsc::JSType::DerivedStringObject => {
                    let sliced = current.to_slice(global)?;
                    could_have_non_ascii = could_have_non_ascii || !sliced.is_wtf_backed();
                    // PORT NOTE: Zig handed `allocator` to the joiner so it could
                    // free in-place; `StringJoiner::push` dropped that param, so
                    // clone into the joiner and let `sliced` drop normally.
                    joiner.push_cloned(sliced.slice());
                }

                jsc::JSType::Array | jsc::JSType::DerivedArray => {
                    let mut iter = jsc::JSArrayIterator::init(current, global)?;
                    // PERF(port): Zig ensureUnusedCapacity(iter.len); ArrayVec is fixed-cap.
                    let mut any_arrays = false;
                    while let Some(item) = iter.next()? {
                        if item.is_undefined_or_null() { continue; }

                        if !any_arrays {
                            match item.js_type_loose() {
                                jsc::JSType::NumberObject
                                | jsc::JSType::Cell
                                | jsc::JSType::String
                                | jsc::JSType::StringObject
                                | jsc::JSType::DerivedStringObject => {
                                    let sliced = item.to_slice(global)?;
                                    could_have_non_ascii = could_have_non_ascii || !sliced.is_wtf_backed();
                                    joiner.push_cloned(sliced.slice());
                                    continue;
                                }
                                jsc::JSType::ArrayBuffer
                                | jsc::JSType::Int8Array
                                | jsc::JSType::Uint8Array
                                | jsc::JSType::Uint8ClampedArray
                                | jsc::JSType::Int16Array
                                | jsc::JSType::Uint16Array
                                | jsc::JSType::Int32Array
                                | jsc::JSType::Uint32Array
                                | jsc::JSType::Float16Array
                                | jsc::JSType::Float32Array
                                | jsc::JSType::Float64Array
                                | jsc::JSType::BigInt64Array
                                | jsc::JSType::BigUint64Array
                                | jsc::JSType::DataView => {
                                    could_have_non_ascii = true;
                                    let buf = item.as_array_buffer(global).unwrap();
                                    joiner.push_static(buf.byte_slice());
                                    continue;
                                }
                                jsc::JSType::Array | jsc::JSType::DerivedArray => {
                                    any_arrays = true;
                                    could_have_non_ascii = true;
                                    break;
                                }
                                jsc::JSType::DOMWrapper => {
                                    if let Some(blob_ptr) = item.as_::<Blob>() {
                                        // SAFETY: JS-heap pointer; single-threaded JS execution.
                                        let blob = unsafe { &*blob_ptr };
                                        could_have_non_ascii = could_have_non_ascii
                                            || blob.charset != strings::AsciiStatus::AllAscii;
                                        joiner.push_static(blob.shared_view());
                                        continue;
                                    } else {
                                        let sliced = current.to_slice_clone(global)?;
                                        could_have_non_ascii = could_have_non_ascii || sliced.is_allocated();
                                        joiner.push_cloned(sliced.slice());
                                    }
                                }
                                _ => {}
                            }
                        }

                        stack.push(item); // PERF(port): was assume_capacity
                    }
                }

                jsc::JSType::DOMWrapper => {
                    if let Some(blob_ptr) = current.as_::<Blob>() {
                        // SAFETY: JS-heap pointer; single-threaded JS execution.
                        let blob = unsafe { &*blob_ptr };
                        could_have_non_ascii =
                            could_have_non_ascii || blob.charset != strings::AsciiStatus::AllAscii;
                        joiner.push_static(blob.shared_view());
                    } else {
                        let sliced = current.to_slice_clone(global)?;
                        could_have_non_ascii = could_have_non_ascii || sliced.is_allocated();
                        joiner.push_cloned(sliced.slice());
                    }
                }

                jsc::JSType::ArrayBuffer
                | jsc::JSType::Int8Array
                | jsc::JSType::Uint8Array
                | jsc::JSType::Uint8ClampedArray
                | jsc::JSType::Int16Array
                | jsc::JSType::Uint16Array
                | jsc::JSType::Int32Array
                | jsc::JSType::Uint32Array
                | jsc::JSType::Float16Array
                | jsc::JSType::Float32Array
                | jsc::JSType::Float64Array
                | jsc::JSType::BigInt64Array
                | jsc::JSType::BigUint64Array
                | jsc::JSType::DataView => {
                    let buf = current.as_array_buffer(global).unwrap();
                    joiner.push_static(buf.slice());
                    could_have_non_ascii = true;
                }

                _ => {
                    let sliced = current.to_slice(global)?;
                    if global.has_exception() {
                        let _end_result = joiner.done();
                        return Err(jsc::JsError::Thrown);
                    }
                    could_have_non_ascii = could_have_non_ascii || !sliced.is_wtf_backed();
                    joiner.push_cloned(sliced.slice());
                }
            }
            current = match stack.pop() {
                Some(v) => v,
                None => break,
            };
        }

        let joined: Vec<u8> = joiner.done().expect("oom").into_vec();

        if !could_have_non_ascii {
            return Ok(Blob::init_with_all_ascii(joined, global, true));
        }
        Ok(Blob::init(joined, global))
    }
}

} // mod _jsc_gated

// Re-export the write-file glue so sibling modules (S3File.rs) can call it
// without reaching through the private `_jsc_gated` shim module.
pub use _jsc_gated::{WriteFileOptions, write_file_internal};
// Re-export the mkdirp helper + types for blob/copy_file.rs (CopyFile open path).
pub use _jsc_gated::{MkdirpTarget, Retry, mkdir_if_not_exists};
// Re-export for Body.rs `writeFormat` (Blob size pretty-printer).
pub use _jsc_gated::write_format_for_size;

// ──────────────────────────────────────────────────────────────────────────
// Un-gated core constructors / JS bridging (B-2 round: init_with_store / to_js
// / construct_bun_file / find_or_create_file_from_path). These were lifted
// out of `_jsc_gated` so `Bun.file` / `Bun.stdin` / `Bun.stdout` / `Bun.stderr`
// callers in BunObject/ReadableStream/Archive/server resolve.
// ──────────────────────────────────────────────────────────────────────────

// FFI: S3-backed Blob → JS wrapper. Declared locally because `webcore::s3_file`
// is not yet a wired module; the C++ symbol is already linked.
unsafe extern "C" {
    fn BUN__createJSS3FileUnsafely(
        global: *const JSGlobalObject,
        blob: *mut core::ffi::c_void,
    ) -> JSValue;
}

impl Blob {
    /// Construct a Blob viewing an existing `Store`. Accepts both `Box<Store>`
    /// (from `Store::new` / `Store::init*`) and `StoreRef` (cloned refs) —
    /// callers across the tree pass either depending on which constructor they
    /// hit, and `From<Box<Store>> for StoreRef` covers the former.
    pub fn init_with_store<S: Into<StoreRef>>(store: S, global_this: &JSGlobalObject) -> Blob {
        let store: StoreRef = store.into();
        let size = store.size();
        // PORT NOTE: `MimeType::value` is `Cow<'static, [u8]>`; the raw slice
        // pointer is stable for the life of `store` (either 'static or backed
        // by the heap allocation we hold a ref to below).
        let content_type: *const [u8] = if let store::Data::File(ref f) = store.data {
            f.mime_type.value.as_ref() as *const [u8]
        } else {
            b"" as &'static [u8] as *const [u8]
        };
        Blob {
            size,
            store: Some(store),
            content_type,
            global_this: global_this,
            ..Default::default()
        }
    }

    pub fn init_empty(global_this: &JSGlobalObject) -> Blob {
        Blob {
            size: 0,
            store: None,
            content_type: b"" as &'static [u8] as *const [u8],
            global_this: global_this,
            ..Default::default()
        }
    }

    // is_detached: defined once above; duplicate removed to fix E0034.

    fn calculate_estimated_byte_size(&mut self) {
        // in-memory size. not the size on disk.
        let mut size: usize = core::mem::size_of::<Blob>();

        if let Some(store) = &self.store {
            size += core::mem::size_of::<Store>();
            match &store.data {
                store::Data::Bytes(bytes) => {
                    size += bytes.stored_name.estimated_size();
                    size += if self.size != MAX_SIZE { self.size as usize } else { bytes.len() as usize };
                }
                store::Data::File(file) => size += file.pathlike.estimated_size(),
                store::Data::S3(s3) => size += s3.estimated_size(),
            }
        }

        self.reported_estimated_size = size
            + (self.content_type_slice().len() * (self.content_type_allocated as usize))
            + self.name.byte_slice().len();
    }

    pub fn estimated_size(&self) -> usize {
        self.reported_estimated_size
    }

    /// This does not duplicate
    /// This creates a new view
    /// and increments the reference count
    pub fn dupe(&self) -> Blob {
        self.dupe_with_content_type(false)
    }

    pub fn dupe_with_content_type(&self, _include_content_type: bool) -> Blob {
        // Zig: `if (this.store != null) this.store.?.ref()` then bitwise-copy.
        // `Option<StoreRef>::clone` bumps the intrusive `Store::ref_count`.
        let mut duped = Blob {
            reported_estimated_size: self.reported_estimated_size,
            size: self.size,
            offset: self.offset,
            store: self.store.clone(),
            content_type: self.content_type,
            content_type_allocated: self.content_type_allocated,
            content_type_was_set: self.content_type_was_set,
            charset: self.charset,
            is_jsdom_file: self.is_jsdom_file,
            ref_count: bun_ptr::RawRefCount::init(0), // setNotHeapAllocated
            global_this: self.global_this,
            last_modified: self.last_modified,
            name: self.name.dupe_ref(),
        };
        // If the source's content_type is heap-allocated, the bitwise copy above
        // aliases the same allocation. Take our own copy so freeing one side
        // doesn't dangle the other.
        if duped.content_type_allocated {
            let copy = self.content_type_slice().to_vec().into_boxed_slice();
            duped.content_type = Box::into_raw(copy);
        }
        duped
    }

    pub fn to_js(&mut self, global_object: &JSGlobalObject) -> JSValue {
        // if cfg!(debug_assertions) { debug_assert!(self.is_heap_allocated()); }
        self.calculate_estimated_byte_size();

        if self.is_s3() {
            // SAFETY: `self` is a heap-allocated *mut Blob (see `Blob::new`); the
            // C++ side wraps it in a JSS3File without taking a second ref.
            return unsafe {
                BUN__createJSS3FileUnsafely(global_object, self as *mut Blob as *mut core::ffi::c_void)
            };
        }

        // codegen stub takes an erased `*mut ()`; cast through the heap pointer.
        js::to_js_unchecked(global_object, self as *mut Blob as *mut ())
    }

    /// `Bun.file(pathOrFd)` core: wrap a path-or-fd in a `Store::File` and
    /// return a Blob viewing it. Runtime `check_s3` matches the call shape used
    /// by `server_body.rs` / `fetch.rs` (the `_jsc_gated` draft used a const
    /// generic — collapsed here since it only guards a string prefix check).
    pub fn find_or_create_file_from_path(
        path_or_fd: &mut PathOrFileDescriptor,
        global_this: &JSGlobalObject,
        check_s3: bool,
    ) -> Blob {
        // ─── S3 (`s3://…`) branch ──────────────────────────────────────────
        // TODO(b2-blocked): bun_s3 / Store::init_s3 — `Store::init_s3` is gated
        // in `blob/Store.rs` and `transpiler.env.get_s3_credentials()` is not
        // yet on the VM surface. Re-gated until both land; this only short-
        // circuits the `s3://` prefix, the file path below is unaffected.
        
        // TODO(b2-blocked): the s3:// branch is gated until
        // `bun_dotenv::Loader::get_s3_credentials` returns an owned/cloneable
        // value (`Store::init_s3` consumes `S3Credentials` by value, env loader
        // hands back `&S3Credentials`). Falls through to the file path below.
        if check_s3 {
            if let PathOrFileDescriptor::Path(ref p) = path_or_fd {
                if p.slice().starts_with(b"s3://") {
                    // SAFETY: bun_vm() is live for the duration of a host call.
                    let vm = unsafe { &mut *global_this.bun_vm() };
                    // SAFETY: transpiler.env is set during VM init and outlives the VM.
                    let credentials = unsafe { &mut *vm.transpiler.env }.get_s3_credentials();
                    let copy = core::mem::replace(
                        path_or_fd,
                        PathOrFileDescriptor::Path(crate::webcore::node_types::PathLike::String(
                            bun_str::PathString::default(),
                        )),
                    );
                    let PathOrFileDescriptor::Path(path) = copy else { unreachable!() };
                    return Blob::init_with_store(
                        Store::init_s3(path, None, credentials).expect("oom"),
                        global_this,
                    );
                }
            }
        }
        let _ = check_s3;

        let path: PathOrFileDescriptor = match path_or_fd {
            PathOrFileDescriptor::Path(_) => {
                #[allow(unused_mut)]
                let mut slice = path_or_fd.path().slice();

                #[cfg(windows)]
                if slice == b"/dev/null" {
                    *path_or_fd = PathOrFileDescriptor::Path(
                        crate::webcore::node_types::PathLike::String(
                            bun_str::PathString::init(b"\\\\.\\NUL"),
                        ),
                    );
                    slice = path_or_fd.path().slice();
                }

                // TODO(b2-blocked): standalone_module_graph — VM field is an
                // opaque `Option<NonNull<c_void>>` until the graph type is
                // ported; cannot `.find(slice)` on it yet. Re-gated.
                
                {
                    // blocked_on: bun_jsc::VirtualMachine::standalone_module_graph
                    // (typed as `Option<NonNull<c_void>>` until the graph type is ported)
                    if let Some(graph) = unsafe { &*global_this.bun_vm() }.standalone_module_graph {
                        if let Some(file) = graph.find(slice) {
                            return file.blob(global_this).dupe();
                        }
                    }
                }
                let _ = slice;

                path_or_fd.to_thread_safe();
                core::mem::replace(
                    path_or_fd,
                    PathOrFileDescriptor::Path(crate::webcore::node_types::PathLike::String(
                        bun_str::PathString::default(),
                    )),
                )
            }
            PathOrFileDescriptor::Fd(fd) => {
                // TODO(b2-blocked): rare_data().{stdin,stdout,stderr}() return
                // `&Arc<high_tier::BlobStore>` (an opaque stub in
                // `bun_jsc::rare_data`), not `Arc<webcore::blob::Store>`. The
                // type unification is a cross-crate change (rare_data.rs +
                // webcore.rs); re-gated until that lands. Falls through to a
                // plain fd-backed `Store::File` below, which is behaviourally
                // correct (just misses the cached-store fast path).
                
                if let Some(tag) = fd.stdio_tag() {
                    // blocked_on: bun_jsc::rare_data::BlobStore ↔ webcore::blob::Store unification
                    // (rare_data().stdin/out/err() return `&Arc<high_tier::BlobStore>`, not StoreRef)
                    let vm = unsafe { &mut *global_this.bun_vm() };
                    let store = match tag {
                        bun_sys::Stdio::StdIn => vm.rare_data().stdin(),
                        bun_sys::Stdio::StdErr => vm.rare_data().stderr(),
                        bun_sys::Stdio::StdOut => vm.rare_data().stdout(),
                    };
                    return Blob::init_with_store(store.clone(), global_this);
                }
                PathOrFileDescriptor::Fd(*fd)
            }
        };

        // PORT NOTE: `Store::init_file` is ``-gated in
        // `blob/Store.rs`; inline its body here so the file-backed path works
        // without touching that file.
        let mime_type = if let PathOrFileDescriptor::Path(ref p) = path {
            let sliced = p.slice();
            if sliced.is_empty() {
                None
            } else {
                let ext = strings::trim(bun_paths::extension(sliced), b".");
                bun_http_types::MimeType::by_extension_no_default(ext)
            }
        } else {
            None
        };
        let store = Store::new(Store {
            data: store::Data::File(store::File::init(path, mime_type)),
            mime_type: bun_http_types::MimeType::NONE,
            ref_count: AtomicU32::new(1),
            is_all_ascii: None,
        });
        Blob::init_with_store(store, global_this)
    }
}

// ─── node_types stub augmentation ────────────────────────────────────────────
// `crate::webcore::node_types::{PathOrFileDescriptor, PathLike}` are minimal
// shape-stubs (see webcore.rs) used by `Store`. The real
// `crate::node::PathOrFileDescriptor` carries `from_js`/`to_thread_safe`/…
// but is a *distinct type*. Until the two are unified (TODO in webcore.rs),
// `path_slice` / `to_thread_safe` now live on the canonical stub impl in
// `crate::webcore::node_types` (webcore.rs); the local duplicates were
// removed to resolve E0034.

/// `Bun.file(pathOrFd, options?)` — entry point referenced by
/// `BunObject::export_callbacks!{ file => … }`.
// TODO(b2-blocked): #[bun_jsc::host_fn]
pub fn construct_bun_file(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let vm = global_object.bun_vm();
    let arguments = callframe.arguments_old::<2>();
    let arguments_slice = arguments.slice();
    let mut args = jsc::ArgumentsSlice::init(unsafe { &*vm }, arguments_slice);

    // TODO(b2-blocked): node_types unification — `PathOrFileDescriptor::from_js`
    // exists on `crate::node::PathOrFileDescriptor` but Store::File::pathlike is
    // typed as the `crate::webcore::node_types` stub. The two enums are
    // shape-distinct (real `PathLike` carries a JSC-backed `SliceWithUnderlying`
    // variant the stub lacks), so a `From` impl can't be written from this file
    // alone. Un-gate once webcore.rs swaps `node_types` to a re-export of
    // `crate::node::types`.
    
    {
        let mut path = PathOrFileDescriptor::from_js(global_object, &mut args)?.ok_or_else(|| {
            global_object.throw_invalid_arguments(format_args!(
                "Expected file path string or file descriptor"
            ))
        })?;
        let options = if arguments_slice.len() >= 2 { Some(arguments_slice[1]) } else { None };

        if let PathOrFileDescriptor::Path(ref p) = path {
            if p.slice().starts_with(b"s3://") {
                // `webcore::node_types::PathLike` re-exports the real
                // `crate::node::types::PathLike`, so no bridging is needed.
                return crate::webcore::s3_file::construct_internal_js(
                    global_object,
                    p.clone(),
                    options,
                );
            }
        }
        // Move `path` into the guard so the cleanup closure owns it (avoids
        // borrow conflict with the `&mut` below) and deref through the guard.
        let mut path = scopeguard::guard(path, |p| p.deinit_and_unprotect());

        let mut blob = Blob::find_or_create_file_from_path(&mut *path, global_object, false);

        if let Some(opts) = options {
            if opts.is_object() {
                if let Some(file_type) = opts.get_truthy(global_object, b"type")? {
                    'inner: {
                        if file_type.is_string() {
                            let str = file_type.to_slice(global_object)?;
                            let slice = str.slice();
                            if !strings::is_all_ascii(slice) {
                                break 'inner;
                            }
                            blob.content_type_was_set = true;
                            // PORT NOTE: `vm.mime_type()` lookup skipped — it
                            // requires `&mut VirtualMachine` (RareData cache).
                            // Always heap-dupe the lowercased type; revisit when
                            // the mime cache is wired through here.
                            let mut content_type_buf = vec![0u8; slice.len()];
                            strings::copy_lowercase(slice, &mut content_type_buf);
                            blob.content_type = Box::into_raw(content_type_buf.into_boxed_slice());
                            blob.content_type_allocated = true;
                        }
                    }
                }
                if let Some(last_modified) = opts.get_truthy(global_object, b"lastModified")? {
                    blob.last_modified = last_modified.to_number(global_object)?;
                }
            }
        }

        let ptr = Blob::new(blob);
        // SAFETY: ptr was just produced by Box::into_raw in Blob::new. Explicit
        // `&mut *` forces inherent `Blob::to_js(&mut self)` over `JsClass::to_js(self)`.
        return Ok(unsafe { (&mut *ptr).to_js(global_object) });
    }
    #[allow(unreachable_code)]
    {
        let _ = (vm, &mut args, arguments_slice);
        unreachable!(
            "construct_bun_file: blocked on webcore::node_types ↔ crate::node::types unification"
        );
    }
}

/// `Bun.write(dest, src, options?)` — entry point.
// TODO(b2-blocked): #[bun_jsc::host_fn]
pub fn write_file(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    // The full argument-parsing + `write_file_internal` body lives inside
    // `_jsc_gated` (it depends on `WriteFilePromise`, `write_file::WriteFile*`,
    // `S3.upload`, `node::fs::mkdirp`, `Body::Value::from_js`). Delegate so the
    // un-gated `Bun.write` symbol resolves for BunObject.rs callers.
    _jsc_gated::write_file(global_this, callframe)
}

// ──────────────────────────────────────────────────────────────────────────
// Any (AnyBlob)
// ──────────────────────────────────────────────────────────────────────────

pub enum Any {
    Blob(Blob),
    InternalBlob(Internal),
    WTFStringImpl(bun_str::WTFStringImpl),
}

impl Any {
    /// Unwrap the `InternalBlob` payload. Panics on any other variant — callers
    /// (e.g. DevServer asset bundling) only invoke this on values they
    /// constructed via `from_owned_slice`.
    pub fn internal_blob(&self) -> &Internal {
        match self {
            Any::InternalBlob(ib) => ib,
            _ => unreachable!("Any::internal_blob called on non-InternalBlob variant"),
        }
    }

    pub fn from_owned_slice(bytes: Vec<u8>) -> Any {
        Any::InternalBlob(Internal { bytes, was_string: false })
    }

    pub fn from_array_list(list: Vec<u8>) -> Any {
        Any::InternalBlob(Internal { bytes: list, was_string: false })
    }

    /// Assumed that AnyBlob itself is covered by the caller.
    pub fn memory_cost(&self) -> usize {
        match self {
            Any::Blob(blob) => blob.store.as_ref().map(|s| s.memory_cost()).unwrap_or(0),
            Any::WTFStringImpl(str) => if unsafe { (**str).ref_count() } == 1 { unsafe { (**str).memory_cost() } } else { 0 },
            Any::InternalBlob(ib) => ib.memory_cost(),
        }
    }

    pub fn has_one_ref(&self) -> bool {
        if let Some(s) = self.store() {
            return s.has_one_ref();
        }
        false
    }

    pub fn get_file_name(&self) -> Option<&[u8]> {
        match self {
            Any::Blob(b) => b.get_file_name(),
            Any::WTFStringImpl(_) | Any::InternalBlob(_) => None,
        }
    }

    #[inline]
    pub fn fast_size(&self) -> SizeType {
        match self {
            Any::Blob(b) => b.size,
            Any::WTFStringImpl(s) => (unsafe { (**s).byte_length() }) as SizeType,
            Any::InternalBlob(_) => self.slice().len() as SizeType,
        }
    }

    #[inline]
    pub fn size(&self) -> SizeType {
        match self {
            Any::Blob(b) => b.size,
            Any::WTFStringImpl(s) => (unsafe { (**s).utf8_byte_length() }) as SizeType,
            _ => self.slice().len() as SizeType,
        }
    }

    pub fn has_content_type_from_user(&self) -> bool {
        match self {
            Any::Blob(b) => b.has_content_type_from_user(),
            Any::WTFStringImpl(_) | Any::InternalBlob(_) => false,
        }
    }

}

// ─── Any: JSC-integration (to_js/from_js paths) ──────────────────────────────
// TODO(b2-blocked): bun_jsc::* — Any::{to_action_value,to_promise,wrap,
// to_json,to_string,to_array_buffer*,to_blob,to_uint8_array*} call into
// JSValue/ZigString JSC methods and Blob JSC impls gated above.

impl Any {
    fn to_internal_blob_if_possible(&mut self) {
        if let Any::Blob(blob) = self {
            if let Some(s) = &blob.store {
                if matches!(s.data, store::Data::Bytes(_)) && s.has_one_ref() {
                    // `StoreRef` exposes interior-mutable `data_mut()` (no DerefMut).
                    let internal = s.data_mut().as_bytes_mut().to_internal_blob();
                    // PORT NOTE: Zig deref's the store; StoreRef::drop on replace handles it.
                    *self = Any::InternalBlob(internal);
                    return;
                }
            }
        }
    }

    pub fn to_action_value(
        &mut self,
        global_this: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> JsResult<JSValue> {
        if action != streams::BufferActionTag::Blob {
            self.to_internal_blob_if_possible();
        }

        match action {
            streams::BufferActionTag::Text => {
                if matches!(self, Any::Blob(_)) {
                    return self.to_string(global_this, Lifetime::Clone);
                }
                self.to_string_transfer(global_this)
            }
            streams::BufferActionTag::Bytes => {
                if matches!(self, Any::Blob(_)) {
                    return self.to_array_buffer_view::<{ jsc::JSType::Uint8Array }>(global_this, Lifetime::Clone);
                }
                self.to_uint8_array_transfer(global_this)
            }
            streams::BufferActionTag::Blob => {
                let result = Blob::new(self.to_blob(global_this));
                unsafe { (*result).global_this = global_this };
                Ok(unsafe { (*result).to_js(global_this) })
            }
            streams::BufferActionTag::ArrayBuffer => {
                if matches!(self, Any::Blob(_)) {
                    return self.to_array_buffer_view::<{ jsc::JSType::ArrayBuffer }>(global_this, Lifetime::Clone);
                }
                self.to_array_buffer_transfer(global_this)
            }
            streams::BufferActionTag::Json => self.to_json(global_this, Lifetime::Share),
        }
    }

    pub fn to_promise(
        &mut self,
        global_this: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> Result<JSValue, jsc::JsTerminated> {
        // `JSPromise::wrap` takes a `FnOnce(&JSGlobalObject) -> JsResult<JSValue>`;
        // capture `self`/`action` in the closure (Zig threaded an args tuple).
        JSPromise::wrap(global_this, |g| self.to_action_value(g, action))
    }

    pub fn wrap(
        &mut self,
        promise: jsc::AnyPromise,
        global_this: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> Result<(), jsc::JsTerminated> {
        // `AnyPromise` has no `wrap` in bun_jsc — open-code it: run
        // `to_action_value`, resolve on Ok, reject with the pending exception
        // on Err. Mirrors Zig's `AnyPromise.wrap` (AnyPromise.zig).
        match self.to_action_value(global_this, action) {
            Ok(value) => match promise {
                jsc::AnyPromise::Normal(p) => {
                    unsafe { (*p).resolve(global_this, value) }?;
                }
                jsc::AnyPromise::Internal(p) => unsafe { (*p).resolve(global_this, value) }?,
            },
            Err(e) => {
                let err = global_this.take_exception(e);
                match promise {
                    jsc::AnyPromise::Normal(p) => {
                        unsafe { (*p).reject(global_this, Ok(err)) }?;
                    }
                    jsc::AnyPromise::Internal(p) => unsafe { (*p).reject(global_this, Ok(err)) }?,
                }
            }
        }
        Ok(())
    }

    pub fn to_json(&mut self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        match self {
            Any::Blob(b) => b.to_json(global, lifetime),
            Any::InternalBlob(ib) => {
                if ib.bytes.is_empty() {
                    return Ok(JSValue::NULL);
                }
                let str = ib.to_json(global);
                // the GC will collect the string
                *self = Any::Blob(Blob::default());
                Ok(str)
            }
            Any::WTFStringImpl(impl_) => {
                let mut str = BunString::adopt_wtf_impl(core::mem::replace(impl_, core::ptr::null_mut()));
                *self = Any::Blob(Blob::default());
                if str.length() == 0 {
                    return Ok(JSValue::NULL);
                }
                str.to_js_by_parse_json(global)
            }
        }
    }

    pub fn to_json_share(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_json(global, Lifetime::Share)
    }

    pub fn to_string_transfer(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_string(global, Lifetime::Transfer)
    }

    pub fn to_uint8_array_transfer(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_uint8_array(global, Lifetime::Transfer)
    }

    pub fn to_array_buffer_transfer(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_array_buffer(global, Lifetime::Transfer)
    }

    pub fn to_blob(&mut self, global: &JSGlobalObject) -> Blob {
        if self.size() == 0 {
            return Blob::init_empty(global);
        }

        if let Any::Blob(b) = self {
            return b.dupe();
        }

        if let Any::WTFStringImpl(_) = self {
            let blob = Blob::create(self.slice(), global, true);
            *self = Any::Blob(Blob::default());
            return blob;
        }

        let Any::InternalBlob(ib) = self else { unreachable!() };
        let blob = Blob::init(core::mem::take(&mut ib.bytes), global);
        *self = Any::Blob(Blob::default());
        blob
    }

    pub fn to_string(&mut self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        match self {
            Any::Blob(b) => b.to_string(global, lifetime),
            Any::InternalBlob(ib) => {
                if ib.bytes.is_empty() {
                    return Ok(ZigString::EMPTY.to_js(global));
                }
                let owned = ib.to_string_owned(global)?;
                *self = Any::Blob(Blob::default());
                Ok(owned)
            }
            Any::WTFStringImpl(impl_) => {
                let str = BunString::adopt_wtf_impl(core::mem::replace(impl_, core::ptr::null_mut()));
                *self = Any::Blob(Blob::default());
                str.to_js(global)
            }
        }
    }

    pub fn to_array_buffer(&mut self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        self.to_array_buffer_view::<{ jsc::JSType::ArrayBuffer }>(global, lifetime)
    }

    pub fn to_uint8_array(&mut self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        self.to_array_buffer_view::<{ jsc::JSType::Uint8Array }>(global, lifetime)
    }

    pub fn to_array_buffer_view<const TYPED_ARRAY_VIEW: jsc::JSType>(
        &mut self,
        global: &JSGlobalObject,
        lifetime: Lifetime,
    ) -> JsResult<JSValue> {
        match self {
            Any::Blob(b) => b.to_array_buffer_view::<TYPED_ARRAY_VIEW>(global, lifetime),
            Any::InternalBlob(ib) => {
                // Ownership transfers to JSC via the default-allocator path.
                let bytes: &mut [u8] = ib.to_owned_slice().leak();
                *self = Any::Blob(Blob::default());
                Ok(jsc::ArrayBuffer::from_default_allocator(global, TYPED_ARRAY_VIEW, bytes))
            }
            Any::WTFStringImpl(impl_) => {
                let str = BunString::adopt_wtf_impl(core::mem::replace(impl_, core::ptr::null_mut()));
                *self = Any::Blob(Blob::default());

                let out_bytes = str.to_utf8_without_ref();
                if matches!(out_bytes, bun_str::ZigStringSlice::Owned(_)) {
                    let owned: &mut [u8] = out_bytes.into_vec().leak();
                    return Ok(jsc::ArrayBuffer::from_default_allocator(
                        global,
                        TYPED_ARRAY_VIEW,
                        owned,
                    ));
                }
                jsc::ArrayBuffer::create::<TYPED_ARRAY_VIEW>(global, out_bytes.slice())
            }
        }
    }

    pub fn is_detached(&self) -> bool {
        match self {
            Any::Blob(blob) => blob.is_detached(),
            Any::InternalBlob(ib) => ib.bytes.is_empty(),
            Any::WTFStringImpl(s) => (unsafe { (**s).length() }) == 0,
        }
    }
}

impl Any {
    pub fn store(&self) -> Option<&Store> {
        // Spec (Blob.zig:4651-4657) returns a borrow with no refcount change.
        if let Any::Blob(b) = self {
            return b.store.as_deref();
        }
        None
    }

    pub fn content_type(&self) -> &[u8] {
        match self {
            Any::Blob(b) => b.content_type_slice(),
            // PORT NOTE: MimeType::TEXT is `const` — see Internal::content_type.
            Any::WTFStringImpl(_) => b"text/plain;charset=utf-8",
            Any::InternalBlob(ib) => ib.content_type(),
        }
    }

    pub fn was_string(&self) -> bool {
        match self {
            Any::Blob(b) => b.charset == strings::AsciiStatus::AllAscii,
            Any::WTFStringImpl(_) => true,
            Any::InternalBlob(ib) => ib.was_string,
        }
    }

    #[inline]
    pub fn slice(&self) -> &[u8] {
        match self {
            Any::Blob(b) => b.shared_view(),
            Any::WTFStringImpl(s) => unsafe { (**s).utf8_slice() },
            Any::InternalBlob(ib) => ib.slice_const(),
        }
    }

    pub fn needs_to_read_file(&self) -> bool {
        match self {
            Any::Blob(b) => b.needs_to_read_file(),
            Any::WTFStringImpl(_) | Any::InternalBlob(_) => false,
        }
    }

    pub fn is_s3(&self) -> bool {
        match self {
            Any::Blob(b) => b.is_s3(),
            Any::WTFStringImpl(_) | Any::InternalBlob(_) => false,
        }
    }

    pub fn detach(&mut self) {
        match self {
            Any::Blob(b) => {
                b.detach();
                *self = Any::Blob(Blob::default());
            }
            Any::InternalBlob(ib) => {
                ib.bytes.clear();
                ib.bytes.shrink_to_fit();
                *self = Any::Blob(Blob::default());
            }
            Any::WTFStringImpl(s) => {
                // SAFETY: Any owns one ref on the WTFStringImpl pointee.
                unsafe { (**s).deref() };
                *self = Any::Blob(Blob::default());
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Internal (InternalBlob)
// ──────────────────────────────────────────────────────────────────────────

// PORT NOTE: `bun_str::ZigString` lacks the JSC-side methods (`to_js`,
// `to_external_value`, `with_encoding`) — those live as inherent methods on
// `bun_jsc::zig_string::ZigString` (a `repr(C)`-identical local twin). We
// can't add inherent impls cross-crate, so shim via a local extension trait
// that round-trips through the FFI surface directly.
unsafe extern "C" {
    fn ZigString__toValueGC(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
    fn ZigString__toExternalValue(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
}
pub(crate) trait ZigStringBlobExt {
    fn to_js(&self, global: &JSGlobalObject) -> JSValue;
    fn to_external_value(&self, global: &JSGlobalObject) -> JSValue;
    fn with_encoding(self) -> Self;
    fn to_json_object(&self, global: &JSGlobalObject) -> JSValue;
}
impl ZigStringBlobExt for ZigString {
    #[inline]
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        if (*self).is_globally_allocated() {
            return self.to_external_value(global);
        }
        // SAFETY: `self` is `#[repr(C)] (ptr,len)`; `global` is live.
        unsafe { ZigString__toValueGC(self, global) }
    }
    #[inline]
    fn to_external_value(&self, global: &JSGlobalObject) -> JSValue {
        // SAFETY: see `to_js`.
        unsafe { ZigString__toExternalValue(self, global) }
    }
    #[inline]
    fn with_encoding(mut self) -> Self {
        // PORT NOTE: `bun_str::ZigString` lacks `set_output_encoding`; mirror
        // its effect (mark UTF-8 when bytes are not all-ASCII).
        if !strings::is_all_ascii(self.byte_slice()) {
            self.mark_utf8();
        }
        self
    }
    fn to_json_object(&self, global: &JSGlobalObject) -> JSValue {
        unsafe extern "C" {
            fn ZigString__toJSONObject(this: *const ZigString, global: *const JSGlobalObject) -> JSValue;
        }
        // SAFETY: `self` is `#[repr(C)] (ptr,len)`; `global` is live.
        unsafe { ZigString__toJSONObject(self, global) }
    }
}

/// A single-use Blob backed by an allocation of memory.
pub struct Internal {
    pub bytes: Vec<u8>,
    pub was_string: bool,
}

impl Default for Internal {
    fn default() -> Self {
        Self { bytes: Vec::new(), was_string: false }
    }
}

impl Internal {
    pub fn memory_cost(&self) -> usize {
        self.bytes.capacity()
    }

    // TODO(b2-blocked): bun_jsc::* — ZigString::to_external_u16/to_js_object.
    
    pub fn to_string_owned(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let bytes_without_bom = strings::without_utf8_bom(&self.bytes);
        if let Some(out) = strings::to_utf16_alloc(bytes_without_bom, false, false).unwrap_or(Some(Vec::new())) {
            // TODO(port): Zig used `catch &[_]u16{}` to swallow alloc errors into empty.
            let out_len = out.len();
            // Ownership transfers to JSC's external-string finalizer.
            let out_ptr = Box::into_raw(out.into_boxed_slice()) as *const u16;
            let return_value = jsc::zig_string::to_external_u16(out_ptr, out_len, global_this);
            return_value.ensure_still_alive();
            self.bytes = Vec::new();
            return Ok(return_value);
        } else if bytes_without_bom.len() != self.bytes.len() {
            // If there was a UTF8 BOM, we clone it
            let out = BunString::clone_latin1(&self.bytes[3..]);
            self.bytes = Vec::new();
            return jsc::StringJsc::to_js(&out, global_this);
        } else {
            let mut str = ZigString::init(&self.to_owned_slice());
            str.mark_global();
            return Ok(str.to_external_value(global_this));
        }
    }

    // TODO(b2-blocked): bun_jsc::* — ZigString::to_json_object.
    
    pub fn to_json(&mut self, global_this: &JSGlobalObject) -> JSValue {
        let str_bytes = ZigString::init(strings::without_utf8_bom(&self.bytes)).with_encoding();
        let json = str_bytes.to_json_object(global_this);
        self.bytes = Vec::new();
        json
    }

    #[inline]
    pub fn slice_const(&self) -> &[u8] {
        &self.bytes
    }

    #[inline]
    pub fn slice(&mut self) -> &mut [u8] {
        &mut self.bytes
    }

    pub fn to_owned_slice(&mut self) -> Vec<u8> {
        if self.bytes.is_empty() && self.bytes.capacity() > 0 {
            self.bytes = Vec::new();
            return Vec::new();
        }
        core::mem::take(&mut self.bytes)
    }

    pub fn content_type(&self) -> &'static [u8] {
        // PORT NOTE: MimeType::{TEXT,OTHER} are `const` (not `static`), so
        // borrowing `.value` would borrow a temporary. Inline the literals
        // (matches `MimeType::init_comptime` values).
        if self.was_string {
            return b"text/plain;charset=utf-8"; // MimeType::TEXT
        }
        b"application/octet-stream" // MimeType::OTHER
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Inline (InlineBlob)
// ──────────────────────────────────────────────────────────────────────────

/// A blob which stores all the data in the same space as a real Blob
/// This is an optimization for small Response and Request bodies
#[repr(C, packed)]
pub struct Inline {
    pub bytes: [u8; Inline::AVAILABLE_BYTES],
    pub len: u8,
    pub was_string: bool,
}

pub type InlineIntSize = u8;

impl Inline {
    const REAL_BLOB_SIZE: usize = core::mem::size_of::<Blob>();
    // PORT NOTE: Zig `pub const IntSize = u8` — inherent assoc types are nightly-only;
    // hoisted to module-level `InlineIntSize` above.
    pub const AVAILABLE_BYTES: usize = Self::REAL_BLOB_SIZE - core::mem::size_of::<u8>() - 1 - 1;

    pub fn concat(first: &[u8], second: &[u8]) -> Inline {
        let total = first.len() + second.len();
        debug_assert!(total <= Self::AVAILABLE_BYTES);

        let mut inline_blob = Inline::default();
        let bytes_slice = &mut inline_blob.bytes[..total];

        if !first.is_empty() {
            bytes_slice[..first.len()].copy_from_slice(first);
        }
        if !second.is_empty() {
            bytes_slice[first.len()..][..second.len()].copy_from_slice(second);
        }

        inline_blob.len = total as u8;
        inline_blob
    }

    fn internal_init(data: &[u8], was_string: bool) -> Inline {
        debug_assert!(data.len() <= Self::AVAILABLE_BYTES);

        let mut blob = Inline {
            bytes: [0; Self::AVAILABLE_BYTES],
            len: data.len() as u8,
            was_string,
        };
        if !data.is_empty() {
            blob.bytes[..data.len()].copy_from_slice(data);
        }
        blob
    }

    pub fn init(data: &[u8]) -> Inline {
        Self::internal_init(data, false)
    }

    pub fn init_string(data: &[u8]) -> Inline {
        Self::internal_init(data, true)
    }

    // TODO(b2-blocked): bun_jsc::* — ZigString::to_js.
    
    pub fn to_string_owned(&mut self, global_this: &JSGlobalObject) -> JSValue {
        if self.len == 0 {
            return ZigString::EMPTY.to_js(global_this);
        }

        let mut str = ZigString::init(self.slice_const());
        if !strings::is_all_ascii(self.slice_const()) {
            str.mark_utf8();
        }

        let out = str.to_js(global_this);
        out.ensure_still_alive();
        self.len = 0;
        out
    }

    pub fn content_type(&self) -> &'static [u8] {
        // PORT NOTE: see Internal::content_type — MimeType consts are `const`, not `static`.
        if self.was_string { b"text/plain;charset=utf-8" } else { b"application/octet-stream" }
    }

    pub fn deinit(&mut self) {}

    #[inline]
    pub fn slice(&mut self) -> &mut [u8] {
        let len = self.len as usize;
        &mut self.bytes[..len]
    }

    #[inline]
    pub fn slice_const(&self) -> &[u8] {
        let len = self.len as usize;
        &self.bytes[..len]
    }

    pub fn to_owned_slice(&mut self) -> &mut [u8] {
        self.slice()
    }

    pub fn clear_and_free(&mut self) {}
}

impl Default for Inline {
    fn default() -> Self {
        Self { bytes: [0; Self::AVAILABLE_BYTES], len: 0, was_string: false }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSDOMFile__hasInstance / FileOpener / FileCloser
// TODO(b2-blocked): bun_jsc::* + bun_io/bun_aio surface — host_call ABI,
// JSValue::as_<Blob>(), bun_sys::open/INVALID_FD/E, bun_io::{Tag,Request,
// Action,Loop}, bun_aio::{FilePoll,PollFlags,Closer}.
// ──────────────────────────────────────────────────────────────────────────

mod _io_gated {
use super::*;

// TODO(port): callconv(jsc.conv) — emitted via // TODO(b2-blocked): #[bun_jsc::host_call].
#[unsafe(no_mangle)]
pub extern "C" fn JSDOMFile__hasInstance(
    _: JSValue,
    _: &JSGlobalObject,
    value: JSValue,
) -> bool {
    jsc::mark_binding();
    let Some(blob) = value.as_::<Blob>() else { return false };
    // SAFETY: `as_::<Blob>` returns a live `*mut Blob` rooted by `value`.
    unsafe { (*blob).is_jsdom_file }
}

// ──────────────────────────────────────────────────────────────────────────
// FileOpener<T> / FileCloser<T>
// ──────────────────────────────────────────────────────────────────────────

// TODO: move to bun_sys?
/// Generic file-open helper used by ReadFile/WriteFile/CopyFile state machines.
/// In Zig this is a `fn(comptime This: type) type` that adds methods over `*This`.
/// In Rust we model it as a trait the target implements.
pub trait FileOpener: Sized {
    /// Override if you need different open flags; defaults to RDONLY.
    const OPEN_FLAGS: i32 = bun_sys::O::RDONLY;
    const OPENER_FLAGS: i32 = bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC;

    fn opened_fd(&self) -> Fd;
    fn set_opened_fd(&mut self, fd: Fd);
    fn set_errno(&mut self, e: bun_core::Error);
    fn set_system_error(&mut self, e: jsc::SystemError);
    /// Either `self.file_store.pathlike` or `self.file_blob.store.data.file.pathlike`.
    fn pathlike(&self) -> &PathOrFileDescriptor;
    #[cfg(windows)]
    fn loop_(&self) -> *mut bun_uv_sys::uv_loop_t;
    #[cfg(windows)]
    fn req(&mut self) -> &mut bun_uv_sys::uv_fs_t;
    /// Stash/retrieve the open completion callback across the libuv async hop.
    /// Zig captured this at comptime (`comptime Callback`) so the generated
    /// `WrappedCallback` was monomorphic; Rust can't const-generic over fn
    /// pointers, so the implementor stores it on `self` (e.g. next to `req`).
    #[cfg(windows)]
    fn set_open_callback(&mut self, cb: fn(&mut Self, Fd));
    #[cfg(windows)]
    fn open_callback(&self) -> fn(&mut Self, Fd);

    fn get_fd_by_opening(&mut self, callback: fn(&mut Self, Fd)) {
        let mut buf = bun_paths::PathBuffer::uninit();
        let path_string = match self.pathlike() {
            PathOrFileDescriptor::Path(p) => p.clone(),
            PathOrFileDescriptor::Fd(_) => unreachable!(),
        };
        let path = path_string.slice_z(&mut buf);

        #[cfg(windows)]
        {
            // Monomorphic libuv completion thunk — recovers `*mut Self` from
            // `req.data`, mirrors Zig's `WrappedCallback.callback`.
            extern "C" fn wrapped_callback<S: FileOpener>(req: *mut bun_uv_sys::uv_fs_t) {
                // SAFETY: `req.data` was set to `self as *mut Self` below before
                // `uv_fs_open` was queued; libuv guarantees `req` is valid here.
                let self_: &mut S = unsafe { &mut *(*req).data.cast::<S>() };
                {
                    // SAFETY: req points into self_.req(); cleanup before reuse.
                    let _guard = scopeguard::guard((), |_| unsafe {
                        bun_uv_sys::uv_fs_req_cleanup(req);
                    });
                    // SAFETY: req is the live uv_fs_t from the open request.
                    let result = unsafe { (*req).result };
                    if let Some(err_enum) = result.err_enum() {
                        let path_string_2 = match self_.pathlike() {
                            PathOrFileDescriptor::Path(p) => p.clone(),
                            PathOrFileDescriptor::Fd(_) => unreachable!(),
                        };
                        self_.set_errno(bun_core::errno_to_zig_err(err_enum as _));
                        self_.set_system_error(
                            bun_sys::Error::from_code(err_enum, bun_sys::Tag::open)
                                .with_path(path_string_2.slice())
                                .to_system_error(),
                        );
                        self_.set_opened_fd(bun_sys::Fd::INVALID);
                    } else {
                        self_.set_opened_fd(result.to_fd());
                    }
                }
                let cb = self_.open_callback();
                cb(self_, self_.opened_fd());
            }

            self.set_open_callback(callback);
            let loop_ = self.loop_();
            let self_ptr = self as *mut Self;
            let req = self.req();
            // SAFETY: loop_/req are live for the duration of the async open;
            // req.data is consumed by `wrapped_callback::<Self>` above.
            let rc = unsafe {
                bun_uv_sys::uv_fs_open(
                    loop_,
                    req,
                    path.as_ptr(),
                    Self::OPEN_FLAGS | Self::OPENER_FLAGS,
                    node::fs::DEFAULT_PERMISSION,
                    Some(wrapped_callback::<Self>),
                )
            };
            if let Some(errno) = rc.err_enum() {
                self.set_errno(bun_core::errno_to_zig_err(errno as _));
                self.set_system_error(
                    bun_sys::Error::from_code(errno, bun_sys::Tag::open)
                        .with_path(path_string.slice())
                        .to_system_error(),
                );
                self.set_opened_fd(bun_sys::Fd::INVALID);
                callback(self, bun_sys::Fd::INVALID);
            }
            // SAFETY: req() borrows self; re-borrow to set data after rc check.
            self.req().data = self_ptr.cast();
            return;
        }

        #[cfg(not(windows))]
        loop {
            match bun_sys::open(
                path,
                Self::OPEN_FLAGS | Self::OPENER_FLAGS,
                crate::node::fs::DEFAULT_PERMISSION,
            ) {
                bun_sys::Result::Ok(fd) => {
                    self.set_opened_fd(fd);
                    break;
                }
                bun_sys::Result::Err(err) => {
                    // TODO(port): @hasField(This, "mkdirp_if_not_exists") — optional
                    // mkdir-retry hook via MkdirpTarget. Phase B: add a default-noop method.
                    if err.get_errno() == bun_sys::E::ENOENT {
                        // mkdir_if_not_exists(self, err, path, path_string.slice()) → Retry
                        // (only if Self: MkdirpTarget)
                    }
                    self.set_errno(bun_core::errno_to_zig_err(err.errno as i32));
                    self.set_system_error(jsc::SysErrorJsc::to_system_error(
                        &err.with_path(path_string.slice()),
                    ));
                    self.set_opened_fd(Fd::INVALID);
                    break;
                }
            }
        }

        callback(self, self.opened_fd());
    }

    fn get_fd(&mut self, callback: fn(&mut Self, Fd)) {
        if self.opened_fd() != Fd::INVALID {
            callback(self, self.opened_fd());
            return;
        }

        if let PathOrFileDescriptor::Fd(fd) = self.pathlike() {
            let fd = *fd;
            self.set_opened_fd(fd);
            callback(self, fd);
            return;
        }

        self.get_fd_by_opening(callback);
    }
}

// TODO: move to bun_sys?
pub trait FileCloser: Sized {
    const IO_TAG: bun_io::Tag;

    fn opened_fd(&self) -> Fd;
    fn set_opened_fd(&mut self, fd: Fd);
    fn close_after_io(&self) -> bool;
    fn set_close_after_io(&mut self, v: bool);
    fn state(&self) -> &core::sync::atomic::AtomicU8;
    fn io_request(&mut self) -> Option<&mut bun_io::Request>;
    fn io_poll(&mut self) -> &mut bun_aio::FilePoll;
    fn task(&mut self) -> &mut bun_jsc::WorkPoolTask;
    fn update(&mut self);
    #[cfg(windows)]
    fn loop_(&self) -> *mut bun_uv_sys::uv_loop_t;

    /// `@fieldParentPtr("io_request", request)` — Rust `offset_of!` cannot name
    /// fields on a trait `Self`, so each concrete impl supplies its own
    /// container_of recovery (no default body).
    fn schedule_close(request: &mut bun_io::Request) -> bun_io::Action<'_>;

    fn on_io_request_closed(this: &mut Self) {
        this.io_poll().flags.remove(bun_aio::PollFlag::WasEverRegistered);
        *this.task() = bun_jsc::WorkPoolTask {
            node: Default::default(),
            callback: Self::on_close_io_request,
        };
        bun_jsc::WorkPool::schedule(this.task());
    }

    /// `@fieldParentPtr("task", task)` — concrete impl supplies its own
    /// container_of recovery (no default body).
    unsafe fn on_close_io_request(task: *mut bun_jsc::WorkPoolTask);

    fn do_close(&mut self, is_allowed_to_close_fd: bool) -> bool {
        // PORT NOTE: Zig nests `if (@hasField(This, "io_request")) { if (this.close_after_io) … }`.
        // `@hasField` is comptime (constant per concrete `Self`), so swapping the
        // order is sound and lets us finish the immutable `self` reads before
        // taking the `&mut self` borrow via `io_request()`.
        if self.close_after_io() {
            self.state()
                .store(ClosingState::Closing as u8, core::sync::atomic::Ordering::SeqCst);
            if let Some(io_request) = self.io_request() {
                // TODO(port): @atomicStore on the io_request.callback fn pointer.
                io_request.callback = Self::schedule_close;
                if !io_request.scheduled {
                    bun_io::Loop::get().schedule(io_request);
                }
                return true;
            }
        }

        if is_allowed_to_close_fd
            && self.opened_fd() != Fd::INVALID
            && self.opened_fd().stdio_tag().is_none()
        {
            #[cfg(windows)]
            bun_aio::Closer::close(self.opened_fd(), self.loop_());
            #[cfg(not(windows))]
            {
                use bun_sys::FdExt as _;
                let _ = self.opened_fd().close_allowing_bad_file_descriptor(None);
            }
            self.set_opened_fd(Fd::INVALID);
        }

        false
    }
}

} // mod _io_gated

// ──────────────────────────────────────────────────────────────────────────
// isAllASCII / takeOwnership / heap-alloc helpers / external_shared_descriptor
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    pub fn is_all_ascii(&self) -> Option<bool> {
        match self.charset {
            strings::AsciiStatus::Unknown => None,
            strings::AsciiStatus::AllAscii => Some(true),
            strings::AsciiStatus::NonAscii => Some(false),
        }
    }

    /// Takes ownership of `self` by value. Invalidates `self`.
    pub fn take_ownership(&mut self) -> Blob {
        // PORT NOTE: Zig writes `self.* = undefined` after the copy.
        let mut result = core::mem::replace(self, Blob::default());
        result.set_not_heap_allocated();
        result
    }

    pub fn is_heap_allocated(&self) -> bool {
        // Spec (Blob.zig:5092-5094): single read of `self.#ref_count.raw_value != 0`.
        self.ref_count.unsafe_get_value() != 0
    }

    fn set_not_heap_allocated(&mut self) {
        self.ref_count = bun_ptr::RawRefCount::init(0);
    }
}

pub mod external_shared_descriptor {
    pub use super::Blob__ref as ref_;
    pub use super::Blob__deref as deref;
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__ref(self_: &mut Blob) {
    debug_assert!(self_.is_heap_allocated(), "cannot ref: this Blob is not heap-allocated");
    self_.ref_count.increment();
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__deref(self_: &mut Blob) {
    debug_assert!(self_.is_heap_allocated(), "cannot deref: this Blob is not heap-allocated");
    if self_.ref_count.decrement() == bun_ptr::raw_ref_count::DecrementResult::ShouldDestroy {
        // deinit has its own is_heap_allocated() guard around drop(Box::from_raw),
        // so this is needed to ensure that returns true.
        self_.ref_count.increment();
        self_.deinit();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/webcore/Blob.zig (5155 lines)
//   confidence: low
//   todos:      45
//   notes:      Huge JSC class; comptime-fn dispatch (do_read_file/lifetime_wrap), content_type dual-ownership, S3 locked-body upload paths, FileSink open branches, and Windows libuv FileOpener all need Phase B attention. Store refcount is intrusive via StoreRef (NonNull<Store> + ref_/deref). fromJS stack uses on-stack ArrayVec<JSValue,128> for GC safety (Zig spilled to heap past 128).
// ──────────────────────────────────────────────────────────────────────────
