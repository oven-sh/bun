//! The JS `Blob` class can be backed by different forms (in `Blob::Store`), which
//! represent different sources of Blob. For example, `Bun.file()` returns Blob
//! objects that reference the filesystem (`Blob::Store::File`). This is how
//! operations like writing `Store::File` to another `Store::File` knows to use a
//! basic file copy instead of a naive read write loop.

use core::ffi::{c_char, c_void};
use core::ptr::NonNull;
use core::sync::atomic::AtomicU32;
use std::sync::Arc;

use bun_core::{self as bun, Output};
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, VirtualMachine, ZigString,
};
use bun_str::{self, strings, String as BunString};
use bun_sys::{self, Fd};
use bun_http::MimeType;

use crate::api::Archive;
use crate::image::Image;
use crate::node::{self as node, PathOrBlob, PathOrFileDescriptor};
use crate::webcore::{self, streams, Lifetime, ReadableStream, Request, Response};
use crate::webcore::s3_file::{self as S3File};
use bun_s3 as S3;

bun_output::declare_scope!(Blob, visible);
macro_rules! debug {
    ($($args:tt)*) => { bun_output::scoped_log!(Blob, $($args)*); };
}

pub use crate::webcore::blob::store::{self as Store, Store};
pub use crate::webcore::blob::read_file;
pub use crate::webcore::blob::write_file;
pub use crate::webcore::blob::copy_file;

use read_file::NewReadFileHandler;
use write_file::{WriteFilePromise, WriteFileWaitFromLockedValueTask};

// ──────────────────────────────────────────────────────────────────────────
// Blob struct
// ──────────────────────────────────────────────────────────────────────────

/// The `m_ctx` payload of the codegen'd `JSBlob` wrapper.
#[bun_jsc::JsClass]
pub struct Blob {
    pub reported_estimated_size: usize,

    pub size: SizeType,
    pub offset: SizeType,
    // LIFETIMES.tsv: SHARED → Option<Arc<Store>>
    // TODO(port): Store uses intrusive atomic refcount (.ref()/.deref()) across FFI;
    // verify Arc<Store> vs IntrusiveArc<Store> in Phase B.
    pub store: Option<Arc<Store>>,
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
    ref_count: bun_ptr::RawRefCount<u32, { bun_ptr::Threading::SingleThreaded }>,

    // LIFETIMES.tsv: JSC_BORROW → *mut JSGlobalObject
    pub global_this: *mut JSGlobalObject,

    pub last_modified: f64,
    /// Blob name will lazy initialize when getName is called, but
    /// we must be able to set the name, and we need to keep the value alive
    /// https://github.com/oven-sh/bun/issues/10178
    pub name: BunString,
}

pub type Ref = bun_ptr::ExternalShared<Blob>;

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
// TODO(port): from_js / from_js_direct are provided by the codegen via #[JsClass].

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
            global_this: core::ptr::null_mut(),
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
    fn content_type_slice(&self) -> &[u8] {
        // SAFETY: content_type is always a valid (possibly empty) slice pointer
        // owned either by 'static data or by this Blob (when content_type_allocated).
        unsafe { &*self.content_type }
    }

    pub fn get_form_data_encoding(&mut self) -> Option<Box<bun_core::FormData::AsyncFormData>> {
        let content_type_slice = self.get_content_type()?;
        let encoding = bun_core::FormData::Encoding::get(content_type_slice.slice())?;
        // drop content_type_slice via Drop
        Some(bun_core::FormData::AsyncFormData::init(encoding))
    }

    pub fn has_content_type_from_user(&self) -> bool {
        self.content_type_was_set
            || self
                .store
                .as_ref()
                .map(|s| matches!(s.data, Store::Data::File(_) | Store::Data::S3(_)))
                .unwrap_or(false)
    }

    pub fn content_type_or_mime_type(&self) -> Option<&[u8]> {
        let ct = self.content_type_slice();
        if !ct.is_empty() {
            return Some(ct);
        }
        if let Some(store) = &self.store {
            match &store.data {
                Store::Data::File(file) => return Some(file.mime_type.value),
                Store::Data::S3(s3) => return Some(s3.mime_type.value),
                _ => return None,
            }
        }
        None
    }

    pub fn is_bun_file(&self) -> bool {
        let Some(store) = &self.store else { return false };
        matches!(store.data, Store::Data::File(_))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// doReadFromS3 / doReadFile / readBytesToHandler / doReadFileInternal
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    pub fn do_read_from_s3<F>(&mut self, global: &JSGlobalObject) -> jsc::JsTerminatedResult<JSValue>
    where
        F: Fn(&mut Blob, &JSGlobalObject, &mut [u8], Lifetime) -> JSValue + 'static,
    {
        debug!("doReadFromS3");
        // TODO(port): WrappedFn struct that calls jsc::to_js_host_call(g, F, (b, g, by, Lifetime::Clone)).
        fn wrapped<F>(b: &mut Blob, g: *mut JSGlobalObject, by: &mut [u8]) -> JSValue
        where
            F: Fn(&mut Blob, &JSGlobalObject, &mut [u8], Lifetime) -> JSValue + 'static,
        {
            // SAFETY: g is a valid JSGlobalObject pointer for the duration of the call.
            let g = unsafe { &*g };
            jsc::to_js_host_call(g, F::call, (b, g, by, Lifetime::Clone))
        }
        S3BlobDownloadTask::init(global, self, wrapped::<F>)
    }

    pub fn do_read_file<F>(&mut self, global: &JSGlobalObject) -> JSValue
    where
        F: Fn(&mut Blob, &JSGlobalObject, &mut [u8], Lifetime) -> jsc::JsResult<JSValue> + 'static,
    {
        debug!("doReadFile");

        // TODO(port): NewReadFileHandler<F> is a generic struct from read_file.rs.
        type Handler<F> = NewReadFileHandler<F>;

        // The callback may read context.content_type (e.g. to_form_data_with_bytes),
        // which is heap-owned by the source JS Blob and freed on finalize(). Take
        // an owning dupe so the handler outliving the source can't dangle.
        let handler = Box::into_raw(Box::new(Handler::<F> {
            context: self.dupe(),
            global_this: global as *const _ as *mut _,
            ..Default::default()
        }));

        #[cfg(windows)]
        {
            let promise = JSPromise::create(global);
            let promise_value = promise.to_js();
            promise_value.ensure_still_alive();
            // SAFETY: handler was just boxed
            unsafe { (*handler).promise.strong.set(global, promise_value) };

            read_file::ReadFileUV::start(
                global.bun_vm().event_loop(),
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
                Handler::<F>::run,
            );
            let read_file_task = read_file::ReadFileTask::create_on_js_thread(global, file_read);

            // Create the Promise only after the store has been ref()'d.
            // The garbage collector runs on memory allocations
            // The JSPromise is the next GC'd memory allocation.
            // This shouldn't really fix anything, but it's a little safer.
            let promise = JSPromise::create(global);
            let promise_value = promise.to_js();
            promise_value.ensure_still_alive();
            // SAFETY: handler was just boxed
            unsafe { (*handler).promise.strong.set(global, promise_value) };

            read_file_task.schedule();

            debug!("doReadFile: read_file_task scheduled");
            promise_value
        }
    }
}

// TODO(port): NewInternalReadFileHandler — generic adapter that erases ctx type.
pub struct NewInternalReadFileHandler<C, F> {
    _p: core::marker::PhantomData<(C, F)>,
}
impl<C, F> NewInternalReadFileHandler<C, F>
where
    F: Fn(C, read_file::ReadFileResultType),
{
    pub fn run(handler: *mut c_void, bytes: read_file::ReadFileResultType) {
        // SAFETY: handler was created from Box<C>::into_raw by the caller.
        let ctx: C = unsafe { core::ptr::read(handler.cast()) };
        // TODO(port): cannot name F as a value here without a fn-pointer; in Zig
        // this is a comptime fn. Phase B: pass F as a fn pointer.
        let _ = (ctx, bytes);
        unimplemented!("NewInternalReadFileHandler::run — comptime fn dispatch");
    }
}

/// Result delivered to `Handler::on_read_bytes`.
pub enum ReadBytesResult {
    /// global-allocator-owned by the callback.
    Ok(Vec<u8>),
    Err(jsc::SystemError),
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
        ctx: &mut H,
        global: &JSGlobalObject,
    ) -> jsc::JsTerminatedResult<()> {
        if self.needs_to_read_file() {
            // TODO(port): inline Adapter struct mapping ReadFileResultType → ReadBytesResult.
            return self.do_read_file_internal(ctx, |c, r| {
                H::on_read_bytes(
                    c,
                    match r {
                        // `is_temporary` ⇒ `r.buf` is the ReadFile Vec's
                        // items handed over (default allocator) — we own it.
                        read_file::ReadFileResultType::Result(b) => ReadBytesResult::Ok(b.buf),
                        read_file::ReadFileResultType::Err(e) => ReadBytesResult::Err(e),
                    },
                );
            }, global);
        }
        if self.is_s3() {
            // TODO(port): heap-allocate a Task { ctx, blob, poll, vm } and pass
            // its callback into S3::download / S3::download_slice. The Zig
            // version defines a local `Task` struct with `done` and `cb` fns.
            struct Task<'a, H> {
                ctx: &'a mut H,
                blob: Blob, // dupe for store ref + offset/size
                poll: bun_aio::KeepAlive,
                vm: *mut VirtualMachine,
            }
            // ... full body elided in Phase A; the dispatch matches Zig 1:1.
            // TODO(port): implement Task::done / Task::cb and S3 download dispatch.
            let _ = Task::<H> {
                ctx,
                blob: self.dupe(),
                poll: bun_aio::KeepAlive::default(),
                vm: global.bun_vm(),
            };
            return Ok(());
        }
        // In-memory or detached.
        let view = self.shared_view();
        let owned = view.to_vec(); // PERF(port): was allocator.dupe — global mimalloc
        H::on_read_bytes(ctx, ReadBytesResult::Ok(owned));
        Ok(())
    }

    /// `Bun.file("…").image(opts?)` ≡ `new Bun.Image(this, opts?)`. Lives here so
    /// the proto entry covers Blob/BunFile/S3File in one place; the actual
    /// construction is `Image::from_blob_js` so Blob.rs doesn't grow image
    /// knowledge.
    #[bun_jsc::host_fn(method)]
    pub fn do_image(_this: &mut Self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        Image::from_blob_js(global, cf.this(), cf.argument(0))
    }

    pub fn do_read_file_internal<H>(
        &mut self,
        ctx: H,
        function: fn(H, read_file::ReadFileResultType),
        global: &JSGlobalObject,
    ) {
        #[cfg(windows)]
        {
            return read_file::ReadFileUV::start(
                global.bun_vm().event_loop(),
                self.store.as_ref().unwrap().clone(),
                self.offset,
                self.size,
                // TODO(port): NewInternalReadFileHandler<H, function>
                ctx,
            );
        }
        #[cfg(not(windows))]
        {
            let file_read = read_file::ReadFile::create_with_ctx(
                self.store.as_ref().unwrap().clone(),
                ctx,
                function,
                self.offset,
                self.size,
            );
            let read_file_task = read_file::ReadFileTask::create_on_js_thread(global, file_read);
            read_file_task.schedule();
        }
    }
}

/// Trait extracted from the Zig `comptime Handler: type` pattern in
/// `read_bytes_to_handler` — the body only requires `on_read_bytes`.
pub trait ReadBytesHandler {
    fn on_read_bytes(&mut self, result: ReadBytesResult);
}

// ──────────────────────────────────────────────────────────────────────────
// FormDataContext
// ──────────────────────────────────────────────────────────────────────────

struct FormDataContext {
    joiner: bun_core::StringJoiner,
    boundary: *const [u8], // borrowed; outlives the joiner
    failed: bool,
    global_this: *mut JSGlobalObject,
}

impl FormDataContext {
    pub fn on_entry(&mut self, name: ZigString, entry: jsc::DOMFormData::FormDataEntry) {
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
        let name_slice = name.to_slice();
        joiner.push(name_slice.slice(), name_slice.allocator_get());

        match entry {
            jsc::DOMFormData::FormDataEntry::String(value) => {
                joiner.push_static(b"\"\r\n\r\n");
                let value_slice = value.to_slice();
                joiner.push(value_slice.slice(), value_slice.allocator_get());
            }
            jsc::DOMFormData::FormDataEntry::File(value) => {
                joiner.push_static(b"\"; filename=\"");
                let filename_slice = value.filename.to_slice();
                joiner.push(filename_slice.slice(), filename_slice.allocator_get());
                joiner.push_static(b"\"\r\n");

                let blob = value.blob;
                let content_type = if !blob.content_type_slice().is_empty() {
                    blob.content_type_slice()
                } else {
                    b"application/octet-stream"
                };
                joiner.push_static(b"Content-Type: ");
                joiner.push_static(content_type);
                joiner.push_static(b"\r\n\r\n");

                if let Some(store) = &blob.store {
                    if blob.size == MAX_SIZE {
                        blob.resolve_size();
                    }
                    match &store.data {
                        Store::Data::S3(_) => {
                            // TODO: s3
                            // we need to make this async and use download/downloadSlice
                        }
                        Store::Data::File(file) => {
                            // TODO: make this async + lazy
                            let res = node::fs::NodeFS::read_file(
                                global_this.bun_vm().node_fs(),
                                node::fs::ReadFileArgs {
                                    encoding: node::Encoding::Buffer,
                                    path: file.pathlike.clone(),
                                    offset: blob.offset,
                                    max_size: blob.size,
                                    ..Default::default()
                                },
                                node::fs::Flavor::Sync,
                            );
                            match res {
                                bun_sys::Result::Err(err) => {
                                    self.failed = true;
                                    let Ok(js_err) = err.to_js(global_this) else { return };
                                    let _ = global_this.throw_value(js_err);
                                }
                                bun_sys::Result::Ok(result) => {
                                    joiner.push(result.slice(), result.buffer.allocator);
                                }
                            }
                        }
                        Store::Data::Bytes(_) => {
                            joiner.push_static(blob.shared_view());
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
    pub fn get_content_type(&self) -> Option<ZigString::Slice> {
        let ct = self.content_type_slice();
        if !ct.is_empty() {
            return Some(ZigString::Slice::from_utf8_never_free(ct));
        }
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Structured clone serialize / deserialize
// ──────────────────────────────────────────────────────────────────────────

struct StructuredCloneWriter {
    ctx: *mut c_void,
    // TODO(port): callconv(jsc.conv) — use #[bun_jsc::host_call] ABI on the fn ptr type.
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

// TODO(port): Zig used std.Io.GenericWriter over StructuredCloneWriter. In Rust,
// implement bun_io::Write for StructuredCloneWriter so write_int_le / write_all work.

impl Blob {
    fn _on_structured_clone_serialize<W: bun_io::Write>(&mut self, writer: &mut W) -> Result<(), bun_core::Error> {
        writer.write_int_le::<u8>(SERIALIZATION_VERSION)?;
        writer.write_int_le::<u64>(u64::try_from(self.offset).unwrap())?;

        let ct = self.content_type_slice();
        writer.write_int_le::<u32>(ct.len() as u32)?;
        writer.write_all(ct)?;
        writer.write_int_le::<u8>(self.content_type_was_set as u8)?;

        let store_tag: Store::SerializeTag = if let Some(store) = &self.store {
            if matches!(store.data, Store::Data::File(_)) {
                Store::SerializeTag::File
            } else {
                Store::SerializeTag::Bytes
            }
        } else {
            Store::SerializeTag::Empty
        };

        writer.write_int_le::<u8>(store_tag as u8)?;

        self.resolve_size();
        if let Some(store) = &self.store {
            store.serialize(writer)?;
        }

        writer.write_int_le::<u8>(self.is_jsdom_file as u8)?;
        write_float::<f64, W>(self.last_modified, writer)?;

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

fn write_float<F, W: bun_io::Write>(value: F, writer: &mut W) -> Result<(), bun_core::Error>
where
    F: Copy,
{
    // SAFETY: F is f32/f64 — POD, all bit patterns valid.
    let bytes: [u8; core::mem::size_of::<F>()] =
        unsafe { core::mem::transmute_copy(&value) };
    writer.write_all(&bytes)
}

fn read_float<F, R: bun_io::Read>(reader: &mut R) -> Result<F, bun_core::Error>
where
    F: Copy,
{
    let mut bytes_buf = [0u8; core::mem::size_of::<F>()];
    reader.read_slice_all(&mut bytes_buf)?;
    // SAFETY: F is f32/f64 — POD, all bit patterns valid.
    Ok(unsafe { core::mem::transmute_copy(&bytes_buf) })
}

fn read_slice<R: bun_io::Read>(reader: &mut R, len: usize) -> Result<Vec<u8>, bun_core::Error> {
    let mut slice = vec![0u8; len];
    let n = reader.read(&mut slice)?;
    if n != len {
        return Err(bun_core::err!("TooSmall"));
    }
    Ok(slice)
}

fn _on_structured_clone_deserialize<R: bun_io::Read>(
    global_this: &JSGlobalObject,
    reader: &mut R,
) -> Result<JSValue, bun_core::Error> {
    let version = reader.read_int_le::<u8>()?;
    let offset = reader.read_int_le::<u64>()?;

    let content_type_len = reader.read_int_le::<u32>()?;
    let mut content_type = read_slice(reader, content_type_len as usize)?;
    // Ownership transfers to `blob.content_type` at the end of the success
    // path below; until then `content_type`'s Drop is responsible for it.
    // (errdefer → automatic Drop on `?`.)

    let content_type_was_set: bool = reader.read_int_le::<u8>()? != 0;

    let store_tag = Store::SerializeTag::from_raw(reader.read_int_le::<u8>()?)
        .ok_or(bun_core::err!("InvalidValue"))?;

    let blob: *mut Blob = match store_tag {
        Store::SerializeTag::Bytes => 'bytes: {
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
                if let Some(store) = &scopeguard::guard_ref(&guard).store {
                    if let Store::Data::Bytes(bytes_store) = &mut store.data_mut() {
                        bytes_store.stored_name = bun_core::PathString::init(name);
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
        Store::SerializeTag::File => 'file: {
            let pathlike_tag = PathOrFileDescriptor::SerializeTag::from_raw(reader.read_int_le::<u8>()?)
                .ok_or(bun_core::err!("InvalidValue"))?;

            match pathlike_tag {
                PathOrFileDescriptor::SerializeTag::Fd => {
                    // TODO(port): readStruct(bun.FD) — read raw FD bytes.
                    let fd: Fd = reader.read_struct()?;
                    let mut path_or_fd = PathOrFileDescriptor::Fd(fd);
                    break 'file Blob::new(Blob::find_or_create_file_from_path::<true>(
                        &mut path_or_fd,
                        global_this,
                    ));
                }
                PathOrFileDescriptor::SerializeTag::Path => {
                    let path_len = reader.read_int_le::<u32>()?;
                    let path = read_slice(reader, path_len as usize)?;
                    let mut dest = PathOrFileDescriptor::Path(node::PathLike::String(
                        bun_core::PathString::init(path),
                    ));
                    break 'file Blob::new(Blob::find_or_create_file_from_path::<true>(
                        &mut dest,
                        global_this,
                    ));
                }
            }
            #[allow(unreachable_code)]
            return Ok(JSValue::ZERO);
        }
        Store::SerializeTag::Empty => Blob::new(Blob::init_empty(global_this)),
    };
    // `blob` is heap-allocated past this point; on any remaining error
    // (truncated trailer fields) tear down both the heap object and its
    // store. `content_type` is handled by its own Drop above since it
    // hasn't been attached to `blob` yet.
    // SAFETY: blob is a freshly-allocated heap pointer from Blob::new.
    let blob_guard = scopeguard::guard(blob, |b| unsafe { (*b).deinit() });
    let blob = unsafe { &mut **blob_guard };

    'versions: {
        if version == 1 { break 'versions; }

        blob.is_jsdom_file = reader.read_int_le::<u8>()? != 0;
        blob.last_modified = read_float::<f64, R>(reader)?;

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
    // SAFETY: blob_ptr is valid; toJS is infallible.
    Ok(unsafe { (*blob_ptr).to_js(global_this) })
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
                return global_this.throw("Blob.onStructuredCloneDeserialize failed");
            }
            Err(e) if e == bun_core::err!("OutOfMemory") => {
                return global_this.throw_out_of_memory();
            }
            Err(_) => unreachable!(),
        };

        // Advance the pointer by the number of bytes consumed
        *ptr = unsafe { (*ptr).add(buffer_stream.pos()) };

        Ok(result)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// URLSearchParamsConverter / fromURLSearchParams / fromDOMFormData
// ──────────────────────────────────────────────────────────────────────────

struct URLSearchParamsConverter {
    buf: Vec<u8>,
    global_this: *mut JSGlobalObject,
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
            global_this: global_this as *const _ as *mut _,
        };
        search_params.to_string(&mut converter, URLSearchParamsConverter::convert);
        let store = Store::init(converter.buf);
        store.mime_type = MimeType::Compact::from(MimeType::Compact::ApplicationXWwwFormUrlencoded).to_mime_type();

        let mut blob = Blob::init_with_store(store, global_this);
        blob.content_type = store.mime_type.value as *const [u8];
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
            let random = global_this.bun_vm().rare_data().next_uuid().bytes;
            use std::io::Write;
            let mut cursor = &mut hex_buf[..];
            write!(&mut cursor, "----WebKitFormBoundary{:x?}", &random).expect("unreachable");
            let written = 70 - cursor.len();
            &hex_buf[..written]
        };

        let mut context = FormDataContext {
            joiner: bun_core::StringJoiner::default(),
            boundary: boundary as *const [u8],
            failed: false,
            global_this: global_this as *const _ as *mut _,
        };

        form_data.for_each(&mut context, FormDataContext::on_entry);
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

        let store = Store::init(context.joiner.done());
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
    Some(unsafe { NonNull::new_unchecked(Blob__dupe(this)) })
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__setAsFile(this: &mut Blob, path_str: &mut BunString) {
    this.is_jsdom_file = true;

    // This is not 100% correct...
    if let Some(store) = &this.store {
        if let Store::Data::Bytes(bytes) = &mut store.data_mut() {
            if bytes.stored_name.len() == 0 {
                let utf8 = path_str.to_utf8_bytes();
                bytes.stored_name = bun_core::PathString::init(utf8);
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
        writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>File<r>"))?;
    } else {
        writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>Blob<r>"))?;
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
        F: jsc::ConsoleObjectFormatter,
        W: core::fmt::Write,
    {
        if self.is_detached() {
            // A blob with no store and size > 0 was genuinely detached (e.g. after
            // transferring its contents). An empty `new Blob([])` or `new File([])`
            // also has no store but is a valid zero-byte blob — render it like a
            // normal zero-sized blob instead of calling it "detached".
            if self.size > 0 {
                if self.is_jsdom_file {
                    writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                        "<d>[<r>File<r> detached<d>]<r>",
                    ))?;
                } else {
                    writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>(
                        "<d>[<r>Blob<r> detached<d>]<r>",
                    ))?;
                }
                return Ok(());
            }
            write_format_for_size::<W, ENABLE_ANSI_COLORS>(self.is_jsdom_file, 0, writer)?;
        } else {
            let store = self.store.as_ref().unwrap();
            match &store.data {
                Store::Data::S3(s3) => {
                    S3File::write_format::<F, W, ENABLE_ANSI_COLORS>(
                        s3, formatter, writer, self.content_type_slice(), self.offset,
                    )?;
                }
                Store::Data::File(file) => {
                    writer.write_str(Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>FileRef<r>"))?;
                    match &file.pathlike {
                        node::PathLike::Path(path) => {
                            // TODO(port): Output::pretty_fmt with embedded {s}
                            write!(writer, " (\"{}\")", bstr::BStr::new(path.slice()))?;
                        }
                        node::PathLike::Fd(fd) => {
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
                Store::Data::Bytes(_) => {
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
                && matches!(self.store.as_ref().unwrap().data, Store::Data::Bytes(_)));
        if !self.is_s3()
            && (!self.content_type_slice().is_empty()
                || self.offset > 0
                || show_name
                || self.last_modified != 0.0)
        {
            writer.write_str(" {\n")?;
            {
                formatter.indent_inc();
                let _dec = scopeguard::guard((), |_| formatter.indent_dec());

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
    if err.get_errno() == bun_sys::E::NOENT && this.mkdirp_if_not_exists() {
        if let Some(dirname) = bun_paths::dirname(path_string.as_bytes(), bun_paths::Platform::Auto) {
            let mut node_fs = node::fs::NodeFS::default();
            match node_fs.mkdir_recursive(node::fs::MkdirArgs {
                path: node::PathLike::String(bun_core::PathString::init_borrowed(dirname)),
                recursive: true,
                always_return_none: true,
                ..Default::default()
            }) {
                bun_sys::Result::Ok(_) => {
                    this.set_mkdirp_if_not_exists(false);
                    return Retry::Continue;
                }
                bun_sys::Result::Err(err2) => {
                    this.set_errno_if_present(bun_core::errno_to_zig_err(err2.errno));
                    this.set_system_error(err.with_path(err_path).to_system_error());
                    this.set_opened_fd_if_present(bun_sys::INVALID_FD);
                    return Retry::Fail;
                }
            }
        }
    }
    Retry::No
}

/// Trait extracted from the Zig `anytype` receiver of `mkdir_if_not_exists`.
/// The Zig body uses `@hasField` to optionally write `errno` / `opened_fd`.
pub trait MkdirpTarget {
    fn mkdirp_if_not_exists(&self) -> bool;
    fn set_mkdirp_if_not_exists(&mut self, v: bool);
    fn set_system_error(&mut self, e: jsc::SystemError);
    fn set_errno_if_present(&mut self, _e: bun_core::Error) {}
    fn set_opened_fd_if_present(&mut self, _fd: Fd) {}
}
