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
        // SAFETY: buffer_stream.pos() <= (end - *ptr) by construction; result stays within [*ptr, end].
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
    // SAFETY: Blob__dupe returns Box::into_raw of a fresh allocation; never null.
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
        Store::Data::File(file) => {
            // TODO: make this async
            let node_fs = ctx.bun_vm().node_fs();
            let mut result = node_fs.truncate(
                node::fs::TruncateArgs {
                    path: file.pathlike.clone(),
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
                            bun_sys::E::PERM => {
                                was_eperm = true;
                                err.errno = bun_sys::E::NOENT as _;
                                current = bun_sys::E::NOENT;
                                continue;
                            }
                            bun_sys::E::NOENT => {
                                if options.mkdirp_if_not_exists == Some(false) { break 'err; }
                                let dirpath: &[u8] = match &file.pathlike {
                                    node::PathLike::Path(path) => {
                                        match bun_paths::dirname(path.slice(), bun_paths::Platform::Auto) {
                                            Some(d) => d,
                                            None => break 'err,
                                        }
                                    }
                                    node::PathLike::Fd(_) => {
                                        // NOTE: if this is an fd, it means the file
                                        // exists, so we shouldn't try to mkdir it
                                        if was_eperm {
                                            err.errno = bun_sys::E::PERM as _;
                                        }
                                        break 'err;
                                    }
                                };
                                let mkdir_result = node_fs.mkdir_recursive(node::fs::MkdirArgs {
                                    path: node::PathLike::String(bun_core::PathString::init_borrowed(dirpath)),
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
                                            if e.get_errno() == bun_sys::E::INTR { continue; }
                                            *err = e;
                                            break 'err;
                                        }
                                        bun_sys::Result::Ok(fd) => {
                                            fd.close();
                                            return Ok(JSPromise::resolved_promise_value(ctx, JSValue::js_number(0)));
                                        }
                                    }
                                }
                            }
                            _ => break 'err,
                        }
                    }
                }

                *err = err.with_path_like(&file.pathlike);
                return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    result.to_js(ctx)?,
                ));
            }
        }
        Store::Data::S3(s3) => {
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

            // TODO(port): local Wrapper struct { promise, store: Arc<Store>, global }
            // with `resolve(result, opaque_this)` callback. See Zig lines 1098-1146.
            struct Wrapper {
                promise: jsc::JSPromiseStrong,
                store: Arc<Store>,
                global: *mut JSGlobalObject,
            }
            impl Wrapper {
                fn resolve(result: S3::S3UploadResult, opaque_this: *mut c_void) -> jsc::JsTerminatedResult<()> {
                    // SAFETY: opaque_this was Box::into_raw'd in the caller below.
                    let this = unsafe { Box::from_raw(opaque_this.cast::<Wrapper>()) };
                    let global = unsafe { &*this.global };
                    match result {
                        S3::S3UploadResult::Success => this.promise.resolve(global, JSValue::js_number(0))?,
                        S3::S3UploadResult::Failure(err) => {
                            this.promise.reject(
                                global,
                                err.to_js_with_async_stack(global, this.store.get_path(), this.promise.get()),
                            )?;
                        }
                    }
                    Ok(())
                }
            }

            let promise = jsc::JSPromiseStrong::init(ctx);
            let promise_value = promise.value();
            let proxy = ctx.bun_vm().transpiler.env.get_http_proxy(true, None, None);
            let proxy_url = proxy.map(|p| p.href);
            S3::upload(
                &aws_options.credentials,
                s3.path(),
                b"",
                destination_blob.content_type_or_mime_type(),
                aws_options.content_disposition,
                aws_options.content_encoding,
                aws_options.acl,
                proxy_url,
                aws_options.storage_class,
                aws_options.request_payer,
                Wrapper::resolve,
                Box::into_raw(Box::new(Wrapper {
                    promise,
                    store: destination_store.clone(),
                    global: ctx as *const _ as *mut _,
                })) as *mut c_void,
            )?;
            return Ok(promise_value);
        }
        // Writing to a buffer-backed blob should be a type error,
        // making this unreachable. TODO: `{}` -> `unreachable`
        Store::Data::Bytes(_) => {}
    }

    Ok(JSPromise::resolved_promise_value(ctx, JSValue::js_number(0)))
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
        .unwrap_or_else(|| Output::panic("Destination blob is detached"));
    let destination_type = destination_store.data.tag();

    // TODO: make sure this invariant isn't being broken elsewhere, then upgrade to allow_assert
    if cfg!(debug_assertions) {
        debug_assert!(
            destination_type != Store::DataTag::Bytes,
            "Cannot write to a Blob backed by a Buffer or TypedArray. This is a bug in the caller."
        );
    }

    let Some(source_store) = source_blob.store.clone() else {
        return write_file_with_empty_source_to_destination(ctx, destination_blob, options);
    };
    let source_type = source_store.data.tag();

    if destination_type == Store::DataTag::File && source_type == Store::DataTag::Bytes {
        let write_file_promise = Box::into_raw(Box::new(WriteFilePromise {
            global_this: ctx as *const _ as *mut _,
            ..Default::default()
        }));

        #[cfg(windows)]
        {
            let promise = JSPromise::create(ctx);
            let promise_value = promise.as_value(ctx);
            promise_value.ensure_still_alive();
            // SAFETY: write_file_promise was just produced by Box::into_raw above; sole owner.
            unsafe { (*write_file_promise).promise.strong.set(ctx, promise_value) };
            match write_file::WriteFileWindows::create(
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
            let file_copier = write_file::WriteFile::create(
                destination_blob.clone(),
                source_blob.clone(),
                write_file_promise,
                WriteFilePromise::run,
                options.mkdirp_if_not_exists.unwrap_or(true),
            )
            .expect("unreachable");
            let task = write_file::WriteFileTask::create_on_js_thread(ctx, file_copier);
            // Defer promise creation until we're just about to schedule the task
            let promise = JSPromise::create(ctx);
            let promise_value = promise.as_value(ctx);
            // SAFETY: write_file_promise was just produced by Box::into_raw above; sole owner.
            unsafe { (*write_file_promise).promise.strong.set(ctx, promise_value) };
            promise_value.ensure_still_alive();
            task.schedule();
            return Ok(promise_value);
        }
    }
    // If this is file <> file, we can just copy the file
    else if destination_type == Store::DataTag::File && source_type == Store::DataTag::File {
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
            let file_copier = copy_file::CopyFile::create(
                destination_store,
                source_store,
                destination_blob.offset,
                destination_blob.size,
                ctx,
                options.mkdirp_if_not_exists.unwrap_or(true),
                options.mode,
            );
            file_copier.schedule();
            return Ok(file_copier.promise.value());
        }
    } else if destination_type == Store::DataTag::File && source_type == Store::DataTag::S3 {
        let s3 = source_store.data.as_s3();
        if let Some(stream) = ReadableStream::from_js(
            ReadableStream::from_blob_copy_ref(ctx, source_blob, s3.options.part_size as u32)?,
            ctx,
        )? {
            return destination_blob.pipe_readable_stream_to_blob(ctx, stream, options.extra_options);
        } else {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                ctx,
                ctx.create_error_instance("Failed to stream bytes from s3 bucket"),
            ));
        }
    } else if destination_type == Store::DataTag::Bytes && source_type == Store::DataTag::Bytes {
        // If this is bytes <> bytes, we can just duplicate it
        // this is an edgecase
        // it will happen if someone did Bun.write(new Blob([123]), new Blob([456]))
        let cloned = Blob::new(source_blob.dupe());
        // SAFETY: ptr was just produced by Box::into_raw in Blob::new.
        return Ok(JSPromise::resolved_promise_value(ctx, unsafe { (*cloned).to_js(ctx) }));
    } else if destination_type == Store::DataTag::Bytes
        && (source_type == Store::DataTag::File || source_type == Store::DataTag::S3)
    {
        let blob_value = source_blob.get_slice_from(ctx, 0, 0, b"", false);
        return Ok(JSPromise::resolved_promise_value(ctx, blob_value));
    } else if destination_type == Store::DataTag::S3 {
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
        let proxy = ctx.bun_vm().transpiler.env.get_http_proxy(true, None, None);
        let proxy_url = proxy.map(|p| p.href);
        match &source_store.data {
            Store::Data::Bytes(bytes) => {
                if bytes.len > S3::MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE {
                    if let Some(stream) = ReadableStream::from_js(
                        ReadableStream::from_blob_copy_ref(ctx, source_blob, s3.options.part_size as u32)?,
                        ctx,
                    )? {
                        return Ok(S3::upload_stream(
                            if options.extra_options.is_some() { aws_options.credentials.dupe() } else { s3.get_credentials() },
                            s3.path(),
                            stream,
                            ctx,
                            aws_options.options,
                            aws_options.acl,
                            aws_options.storage_class,
                            destination_blob.content_type_or_mime_type(),
                            aws_options.content_disposition,
                            aws_options.content_encoding,
                            proxy_url,
                            aws_options.request_payer,
                            None,
                            core::ptr::null_mut(),
                        ));
                    } else {
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            ctx,
                            ctx.create_error_instance("Failed to stream bytes to s3 bucket"),
                        ));
                    }
                } else {
                    // TODO(port): local Wrapper struct { store: Arc<Store>, promise, global } with resolve cb.
                    struct Wrapper {
                        store: Arc<Store>,
                        promise: jsc::JSPromiseStrong,
                        global: *mut JSGlobalObject,
                    }
                    impl Wrapper {
                        fn resolve(result: S3::S3UploadResult, opaque_self: *mut c_void) -> jsc::JsTerminatedResult<()> {
                            // SAFETY: opaque_self is the Box::into_raw(Wrapper) we passed to S3::upload below.
                            let this = unsafe { Box::from_raw(opaque_self.cast::<Wrapper>()) };
                            // SAFETY: global was stored from a live &JSGlobalObject; the VM outlives this callback.
                            let global = unsafe { &*this.global };
                            match result {
                                S3::S3UploadResult::Success => {
                                    this.promise.resolve(global, JSValue::js_number(this.store.data.as_bytes().len))?;
                                }
                                S3::S3UploadResult::Failure(err) => {
                                    this.promise.reject(global, err.to_js_with_async_stack(global, this.store.get_path(), this.promise.get()))?;
                                }
                            }
                            Ok(())
                        }
                    }
                    let promise = jsc::JSPromiseStrong::init(ctx);
                    let promise_value = promise.value();
                    S3::upload(
                        &aws_options.credentials,
                        s3.path(),
                        bytes.slice(),
                        destination_blob.content_type_or_mime_type(),
                        aws_options.content_disposition,
                        aws_options.content_encoding,
                        aws_options.acl,
                        proxy_url,
                        aws_options.storage_class,
                        aws_options.request_payer,
                        Wrapper::resolve,
                        Box::into_raw(Box::new(Wrapper {
                            store: source_store.clone(),
                            promise,
                            global: ctx as *const _ as *mut _,
                        })) as *mut c_void,
                    )?;
                    return Ok(promise_value);
                }
            }
            Store::Data::File(_) | Store::Data::S3(_) => {
                // stream
                if let Some(stream) = ReadableStream::from_js(
                    ReadableStream::from_blob_copy_ref(ctx, source_blob, s3.options.part_size as u32)?,
                    ctx,
                )? {
                    return Ok(S3::upload_stream(
                        if options.extra_options.is_some() { aws_options.credentials.dupe() } else { s3.get_credentials() },
                        s3.path(),
                        stream,
                        ctx,
                        s3.options,
                        aws_options.acl,
                        aws_options.storage_class,
                        destination_blob.content_type_or_mime_type(),
                        aws_options.content_disposition,
                        aws_options.content_encoding,
                        proxy_url,
                        aws_options.request_payer,
                        None,
                        core::ptr::null_mut(),
                    ));
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
        return global_this.throw_invalid_arguments(
            "Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write",
        );
    }
    let mut path_or_blob = path_or_blob_.clone();
    if let PathOrBlob::Blob(ref blob) = path_or_blob {
        let Some(blob_store) = &blob.store else {
            return global_this.throw_invalid_arguments("Blob is detached");
        };
        debug_assert!(!matches!(blob_store.data, Store::Data::Bytes(_)));
        // TODO only reset last_modified on success paths instead of resetting
        // last_modified at the beginning for better performance.
        if let Store::Data::File(ref mut file) = blob_store.data_mut() {
            file.last_modified = jsc::INIT_TIMESTAMP;
        }
    }

    let input_store: Option<Arc<Store>> =
        if let PathOrBlob::Blob(ref b) = path_or_blob { b.store.clone() } else { None };
    // PORT NOTE: Zig manually ref/deref's; Arc clone+drop achieves the same.
    let _input_store_hold = input_store;

    let mut needs_async = false;

    if let Some(mkdir) = options.mkdirp_if_not_exists {
        if mkdir
            && matches!(path_or_blob, PathOrBlob::Blob(ref b)
                if b.store.is_some()
                    && matches!(b.store.as_ref().unwrap().data, Store::Data::File(ref f)
                        if matches!(f.pathlike, node::PathLike::Fd(_))))
        {
            return global_this
                .throw_invalid_arguments("Cannot create a directory for a file descriptor");
        }
    }

    // If you're doing Bun.write(), try to go fast by writing short input on the main thread.
    // This is a heuristic, but it's a good one.
    //
    // except if you're on Windows. Windows I/O is slower. Let's not even try.
    #[cfg(not(windows))]
    {
        let fast_path_ok = matches!(path_or_blob, PathOrBlob::Path(_))
            || (matches!(path_or_blob, PathOrBlob::Blob(ref b)
                if b.offset == 0 && !b.is_s3()
                    && !(b.store.is_some()
                        && matches!(b.store.as_ref().unwrap().data, Store::Data::File(ref f)
                            if f.mode != 0 && bun_sys::is_regular_file(f.mode)))));
        if fast_path_ok {
            if data.is_string() {
                let len = data.get_length(global_this)?;
                if len < 256 * 1024 {
                    let str = data.to_bun_string(global_this)?;
                    let pathlike: PathOrFileDescriptor = match &path_or_blob {
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
                    let pathlike: PathOrFileDescriptor = match &path_or_blob {
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
    let mut destination_blob: Blob = if let PathOrBlob::Path(_) = path_or_blob {
        let new_blob = Blob::find_or_create_file_from_path::<true>(
            path_or_blob_.as_path_mut(),
            global_this,
        );
        if new_blob.store.is_none() {
            return global_this
                .throw_invalid_arguments("Writing to an empty blob is not implemented yet");
        }
        new_blob
    } else {
        path_or_blob.as_blob().dupe()
    };

    if cfg!(debug_assertions) {
        if let PathOrBlob::Blob(ref b) = path_or_blob {
            debug_assert!(b.store.is_some());
        }
    }

    // TODO: implement a writev() fast path
    let mut source_blob: Blob = 'brk: {
        if let Some(response) = data.as_::<Response>() {
            let body_value = response.get_body_value();
            match body_value {
                webcore::Body::WTFStringImpl(_)
                | webcore::Body::InternalBlob(_)
                | webcore::Body::Used
                | webcore::Body::Empty
                | webcore::Body::Blob(_)
                | webcore::Body::Null => break 'brk body_value.use_(),
                webcore::Body::Error(err_ref) => {
                    destination_blob.detach();
                    let _ = body_value.use_();
                    return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        err_ref.to_js(global_this),
                    ));
                }
                webcore::Body::Locked(_) => {
                    // TODO(port): S3 upload-stream from locked body — see Zig lines 1546-1590.
                    if destination_blob.is_s3() {
                        // ... full S3.upload_stream dispatch from Response body
                        // TODO(port): port S3 upload-stream branch for Response.Locked
                        destination_blob.detach();
                        return global_this
                            .throw_invalid_arguments("ReadableStream has already been used");
                    }
                    let task = Box::into_raw(Box::new(WriteFileWaitFromLockedValueTask {
                        global_this: global_this as *const _ as *mut _,
                        file_blob: destination_blob,
                        promise: jsc::JSPromiseStrong::init(global_this),
                        mkdirp_if_not_exists: options.mkdirp_if_not_exists.unwrap_or(true),
                    }));
                    body_value.as_locked_mut().task = task as *mut c_void;
                    body_value.as_locked_mut().on_receive_value = WriteFileWaitFromLockedValueTask::then_wrap;
                    // SAFETY: task was just produced by Box::into_raw; ownership handed to body_value.task.
                    return Ok(unsafe { (*task).promise.value() });
                }
            }
        }

        if let Some(request) = data.as_::<Request>() {
            let body_value = request.get_body_value();
            match body_value {
                webcore::Body::WTFStringImpl(_)
                | webcore::Body::InternalBlob(_)
                | webcore::Body::Used
                | webcore::Body::Empty
                | webcore::Body::Blob(_)
                | webcore::Body::Null => break 'brk body_value.use_(),
                webcore::Body::Error(err_ref) => {
                    destination_blob.detach();
                    let _ = body_value.use_();
                    return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        err_ref.to_js(global_this),
                    ));
                }
                webcore::Body::Locked(_locked) => {
                    // TODO(port): S3 upload-stream from locked body — see Zig lines 1611-1655.
                    if destination_blob.is_s3() {
                        destination_blob.detach();
                        return global_this
                            .throw_invalid_arguments("ReadableStream has already been used");
                    }
                    let task = Box::into_raw(Box::new(WriteFileWaitFromLockedValueTask {
                        global_this: global_this as *const _ as *mut _,
                        file_blob: destination_blob,
                        promise: jsc::JSPromiseStrong::init(global_this),
                        mkdirp_if_not_exists: options.mkdirp_if_not_exists.unwrap_or(true),
                    }));
                    body_value.as_locked_mut().task = task as *mut c_void;
                    body_value.as_locked_mut().on_receive_value = WriteFileWaitFromLockedValueTask::then_wrap;
                    // SAFETY: task was just produced by Box::into_raw; ownership handed to body_value.task.
                    return Ok(unsafe { (*task).promise.value() });
                }
            }
        }

        // Check for Archive - allows Bun.write() and S3 writes to accept Archive instances
        if let Some(archive) = data.as_::<Archive>() {
            break 'brk Blob::init_with_store(archive.store.clone(), global_this);
        }

        break 'brk Blob::get::<false, false>(global_this, data)?;
    };
    let _source_detach = scopeguard::guard(&mut source_blob, |b| b.detach());

    let destination_store = destination_blob.store.clone();
    // PORT NOTE: Zig manually ref/deref's; Arc clone+drop covers this.
    let _dest_hold = destination_store;

    write_file_with_source_destination(global_this, &mut source_blob, &mut destination_blob, &options)
}

fn validate_writable_blob(global_this: &JSGlobalObject, blob: &Blob) -> JsResult<()> {
    let Some(store) = &blob.store else {
        return global_this.throw("Cannot write to a detached Blob");
    };
    if matches!(store.data, Store::Data::Bytes(_)) {
        return global_this.throw_invalid_arguments(
            "Cannot write to a Blob backed by bytes, which are always read-only",
        );
    }
    Ok(())
}

/// `Bun.write(destination, input, options?)`
#[bun_jsc::host_fn]
pub fn write_file(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();
    let mut args = jsc::ArgumentsSlice::init(global_this.bun_vm(), arguments);

    // accept a path or a blob
    let mut path_or_blob = PathOrBlob::from_js_no_copy(global_this, &mut args)?;
    let _path_cleanup = scopeguard::guard(&mut path_or_blob, |p| {
        if let PathOrBlob::Path(path) = p { path.deinit(); }
    });
    // "Blob" must actually be a BunFile, not a webcore blob.
    if let PathOrBlob::Blob(ref blob) = path_or_blob {
        validate_writable_blob(global_this, blob)?;
    }

    let Some(data) = args.next_eat() else {
        return global_this.throw_invalid_arguments(
            "Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write",
        );
    };
    let mut mkdirp_if_not_exists: Option<bool> = None;
    let mut mode: Option<bun_sys::Mode> = None;
    let options = args.next_eat();
    if let Some(options_object) = options {
        if options_object.is_object() {
            if let Some(create_directory) = options_object.get_truthy(global_this, "createPath")? {
                if !create_directory.is_boolean() {
                    return global_this.throw_invalid_argument_type("write", "options.createPath", "boolean");
                }
                mkdirp_if_not_exists = Some(create_directory.to_boolean());
            }
            if let Some(mode_value) = options_object.get(global_this, "mode")? {
                if !mode_value.is_empty_or_undefined_or_null() {
                    if !mode_value.is_number() {
                        return global_this.throw_invalid_argument_type("write", "options.mode", "number");
                    }
                    let mode_int = mode_value.to_int64();
                    if mode_int < 0 || mode_int > 0o777 {
                        return global_this.throw_range_error(mode_int, jsc::RangeErrorOptions {
                            field_name: "mode", min: 0, max: 0o777,
                        });
                    }
                    mode = Some(mode_int as bun_sys::Mode);
                }
            }
        } else if !options_object.is_empty_or_undefined_or_null() {
            return global_this.throw_invalid_argument_type("write", "options", "object");
        }
    }
    write_file_internal(
        global_this,
        &mut path_or_blob,
        data,
        WriteFileOptions { mkdirp_if_not_exists, extra_options: options, mode },
    )
}

const WRITE_PERMISSIONS: u32 = 0o664;

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
                if err.get_errno() == bun_sys::E::NOENT {
                    *needs_async = true;
                    return JSValue::ZERO;
                }
                return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    match err.with_path(pathlike.path().slice()).to_js(global_this) {
                        Ok(v) => v,
                        Err(_) => return JSValue::ZERO,
                    },
                );
            }
        }
    };

    let mut truncate = NEEDS_OPEN || str.is_empty();
    let mut written: usize = 0;

    let _cleanup = scopeguard::guard((), |_| {
        // we only truncate if it's a path
        // if it's a file descriptor, we assume they want manual control over that behavior
        if truncate {
            let _ = fd.truncate(i64::try_from(written).unwrap());
        }
        if NEEDS_OPEN {
            fd.close();
        }
    });

    if !str.is_empty() {
        let decoded = str.to_utf8();
        let mut remain = decoded.slice();
        while !remain.is_empty() {
            match bun_sys::write(fd, remain) {
                bun_sys::Result::Ok(res) => {
                    written += res;
                    remain = &remain[res..];
                    if res == 0 { break; }
                }
                bun_sys::Result::Err(err) => {
                    truncate = false;
                    if err.get_errno() == bun_sys::E::AGAIN {
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
                        match err_js { Ok(v) => v, Err(_) => return JSValue::ZERO },
                    );
                }
            }
        }
    }

    JSPromise::resolved_promise_value(global_this, JSValue::js_number(written))
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
                if err.get_errno() == bun_sys::E::NOENT {
                    *needs_async = true;
                    return JSValue::ZERO;
                }
                return JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    match err.with_path(pathlike.path().slice()).to_js(global_this) {
                        Ok(v) => v,
                        Err(_) => return JSValue::ZERO,
                    },
                );
            }
        }
    };

    // TODO: on windows this is always synchronous

    let truncate = NEEDS_OPEN || bytes.is_empty();
    let mut written: usize = 0;
    let _close = scopeguard::guard((), |_| if NEEDS_OPEN { fd.close() });

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
                if err.get_errno() == bun_sys::E::AGAIN {
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
                    match err_js { Ok(v) => v, Err(_) => return JSValue::ZERO },
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

    JSPromise::resolved_promise_value(global_this, JSValue::js_number(written))
}

// ──────────────────────────────────────────────────────────────────────────
// JSDOMFile constructor
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): callconv(jsc.conv) — emitted by #[bun_jsc::host_fn] macro.
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
    let arguments = callframe.arguments_old(3);
    let args = arguments.slice();

    if args.len() < 2 {
        return global_this
            .throw_invalid_arguments("new File(bits, name) expects at least 2 arguments");
    }
    {
        let name_value_str = BunString::from_js(args[1], global_this)?;

        blob = Blob::get::<false, true>(global_this, args[0])?;
        if let Some(store_) = &blob.store {
            match &mut store_.data_mut() {
                Store::Data::Bytes(bytes) => {
                    bytes.stored_name =
                        bun_core::PathString::init(name_value_str.to_utf8_bytes());
                }
                Store::Data::S3(_) | Store::Data::File(_) => {
                    blob.name = name_value_str.dupe_ref();
                }
            }
        } else if !name_value_str.is_empty() {
            // not store but we have a name so we need a store
            blob.store = Some(Arc::new(Store::new_raw(Store::Init {
                data: Store::Data::Bytes(Store::Bytes::init_empty_with_name(
                    bun_core::PathString::init(name_value_str.to_utf8_bytes()),
                )),
                ref_count: AtomicU32::new(1),
                ..Default::default()
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

                        if let Some(mime) = global_this.bun_vm().mime_type(slice) {
                            blob.content_type = mime.value as *const [u8];
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
                blob.last_modified = last_modified.coerce::<f64>(global_this)?;
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

impl Blob {
    fn calculate_estimated_byte_size(&mut self) {
        // in-memory size. not the size on disk.
        let mut size: usize = core::mem::size_of::<Blob>();

        if let Some(store) = &self.store {
            size += core::mem::size_of::<Store>();
            match &store.data {
                Store::Data::Bytes(bytes) => {
                    size += bytes.stored_name.estimated_size();
                    size += if self.size != MAX_SIZE { self.size as usize } else { bytes.len };
                }
                Store::Data::File(file) => size += file.pathlike.estimated_size(),
                Store::Data::S3(s3) => size += s3.estimated_size(),
            }
        }

        self.reported_estimated_size = size
            + (self.content_type_slice().len() * (self.content_type_allocated as usize))
            + self.name.byte_slice().len();
    }

    pub fn estimated_size(&self) -> usize {
        self.reported_estimated_size
    }
}

#[bun_jsc::host_fn]
pub fn construct_bun_file(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let vm = global_object.bun_vm();
    let arguments = callframe.arguments_old(2);
    let arguments_slice = arguments.slice();
    let mut args = jsc::ArgumentsSlice::init(vm, arguments_slice);

    let mut path = PathOrFileDescriptor::from_js(global_object, &mut args)?.ok_or_else(|| {
        global_object
            .throw_invalid_arguments("Expected file path string or file descriptor")
            .unwrap_err()
    })?;
    let options = if arguments_slice.len() >= 2 { Some(arguments_slice[1]) } else { None };

    if let PathOrFileDescriptor::Path(ref p) = path {
        if p.slice().starts_with(b"s3://") {
            return S3File::construct_internal_js(global_object, p.clone(), options);
        }
    }
    let _path_cleanup = scopeguard::guard(&mut path, |p| p.deinit_and_unprotect());

    let mut blob = Blob::find_or_create_file_from_path::<false>(&mut path, global_object);

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
                        if let Some(entry) = vm.mime_type(str.slice()) {
                            blob.content_type = entry.value as *const [u8];
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
                blob.last_modified = last_modified.coerce::<f64>(global_object)?;
            }
        }
    }

    let ptr = Blob::new(blob);
    // SAFETY: ptr was just produced by Box::into_raw in Blob::new.
    Ok(unsafe { (*ptr).to_js(global_object) })
}

impl Blob {
    pub fn find_or_create_file_from_path<const CHECK_S3: bool>(
        path_or_fd: &mut PathOrFileDescriptor,
        global_this: &JSGlobalObject,
    ) -> Blob {
        let vm = global_this.bun_vm();
        if CHECK_S3 {
            if let PathOrFileDescriptor::Path(ref p) = path_or_fd {
                if p.slice().starts_with(b"s3://") {
                    let credentials = global_this.bun_vm().transpiler.env.get_s3_credentials();
                    let copy = core::mem::replace(
                        path_or_fd,
                        PathOrFileDescriptor::Path(node::PathLike::String(bun_core::PathString::empty())),
                    );
                    return Blob::init_with_store(
                        Store::init_s3(copy.into_path(), None, credentials),
                        global_this,
                    );
                }
            }
        }

        let path: PathOrFileDescriptor = 'brk: {
            match path_or_fd {
                PathOrFileDescriptor::Path(_) => {
                    let mut slice = path_or_fd.path().slice();

                    #[cfg(windows)]
                    if slice == b"/dev/null" {
                        path_or_fd.deinit();
                        *path_or_fd = PathOrFileDescriptor::Path(node::PathLike::String(
                            bun_core::PathString::init(b"\\\\.\\NUL".to_vec().into_boxed_slice()),
                        ));
                        slice = path_or_fd.path().slice();
                    }

                    if let Some(graph) = vm.standalone_module_graph {
                        if let Some(file) = graph.find(slice) {
                            let result = file.blob(global_this).dupe();
                            if !matches!(path_or_fd.path(), node::PathLike::String(_)) {
                                path_or_fd.deinit();
                                *path_or_fd = PathOrFileDescriptor::Path(node::PathLike::String(
                                    bun_core::PathString::empty(),
                                ));
                            }
                            return result;
                        }
                    }

                    path_or_fd.to_thread_safe();
                    let copy = core::mem::replace(
                        path_or_fd,
                        PathOrFileDescriptor::Path(node::PathLike::String(bun_core::PathString::empty())),
                    );
                    break 'brk copy;
                }
                PathOrFileDescriptor::Fd(fd) => {
                    if let Some(tag) = fd.stdio_tag() {
                        let store = match tag {
                            bun_sys::StdioTag::StdIn => vm.rare_data().stdin(),
                            bun_sys::StdioTag::StdErr => vm.rare_data().stderr(),
                            bun_sys::StdioTag::StdOut => vm.rare_data().stdout(),
                        };
                        return Blob::init_with_store(store, global_this);
                    }
                    break 'brk path_or_fd.clone();
                }
            }
        };

        Blob::init_with_store(Store::init_file(path, None), global_this)
    }
}

// ──────────────────────────────────────────────────────────────────────────
// getStream / toStreamWithOffset / lifetimeWrap / accessor host fns
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    #[bun_jsc::host_fn(method)]
    pub fn get_stream(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        if let Some(cached) = js::stream_get_cached(this_value) {
            return Ok(cached);
        }
        let mut recommended_chunk_size: SizeType = 0;
        let recommended_chunk_size_value = callframe.argument(0);
        if !recommended_chunk_size_value.is_undefined_or_null() {
            if !recommended_chunk_size_value.is_number() {
                return global_this.throw_invalid_arguments("chunkSize must be a number");
            }
            // PERF(port): Zig used @truncate to i52 then @intCast to SizeType.
            recommended_chunk_size = SizeType::try_from(
                (recommended_chunk_size_value.to_int64() & ((1i64 << 52) - 1)).max(0),
            )
            .unwrap();
        }
        let stream = ReadableStream::from_blob_copy_ref(global_this, self, recommended_chunk_size as u32)?;

        if let Some(store) = &self.store {
            if let Store::Data::File(f) = &store.data {
                if let node::PathLike::Fd(_) = f.pathlike {
                    // in the case we have a file descriptor store, we want to de-duplicate
                    // readable streams. in every other case we want `.stream()` to be its
                    // own stream.
                    js::stream_set_cached(this_value, global_this, stream);
                }
            }
        }

        Ok(stream)
    }
}

#[bun_jsc::host_fn]
pub fn to_stream_with_offset(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let this = callframe
        .this()
        .as_::<Blob>()
        .unwrap_or_else(|| panic!("this is not a Blob"));
    let args = callframe.arguments_old(1);
    ReadableStream::from_file_blob_with_offset(
        global_this,
        this,
        usize::try_from(args.slice()[0].to_int64()).unwrap(),
    )
}

// Zig doesn't let you pass a function with a comptime argument to a runtime-known function.
// In Rust we monomorphize via const-generic Lifetime.
// TODO(port): lifetime_wrap should produce a fn(&mut Blob, &JSGlobalObject) -> JSValue
// that calls jsc::to_js_host_call(global, F, (this, global, LIFETIME)). Phase B.
fn lifetime_wrap<const L: Lifetime>(
    f: fn(&mut Blob, &JSGlobalObject, Lifetime) -> JsResult<JSValue>,
) -> impl Fn(&mut Blob, &JSGlobalObject) -> JSValue {
    move |this, global| jsc::to_js_host_call(global, |t, g| f(t, g, L), (this, global))
}

impl Blob {
    #[bun_jsc::host_fn(method)]
    pub fn get_text(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        self.get_text_clone(global_this)
    }

    pub fn get_text_clone(&mut self, global_object: &JSGlobalObject) -> jsc::JsTerminatedResult<JSValue> {
        let _store = self.store.clone(); // hold a ref across the call
        Ok(JSPromise::wrap(
            global_object,
            lifetime_wrap::<{ Lifetime::Clone }>(Self::to_string),
            (self, global_object),
        ))
    }

    pub fn get_text_transfer(&mut self, global_object: &JSGlobalObject) -> JSValue {
        let _store = self.store.clone();
        JSPromise::wrap(
            global_object,
            lifetime_wrap::<{ Lifetime::Transfer }>(Self::to_string),
            (self, global_object),
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_json(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        self.get_json_share(global_this)
    }

    pub fn get_json_share(&mut self, global_object: &JSGlobalObject) -> jsc::JsTerminatedResult<JSValue> {
        let _store = self.store.clone();
        Ok(JSPromise::wrap(
            global_object,
            lifetime_wrap::<{ Lifetime::Share }>(Self::to_json),
            (self, global_object),
        ))
    }

    pub fn get_array_buffer_transfer(&mut self, global_this: &JSGlobalObject) -> JSValue {
        let _store = self.store.clone();
        JSPromise::wrap(
            global_this,
            lifetime_wrap::<{ Lifetime::Transfer }>(Self::to_array_buffer),
            (self, global_this),
        )
    }

    pub fn get_array_buffer_clone(&mut self, global_this: &JSGlobalObject) -> jsc::JsTerminatedResult<JSValue> {
        let _store = self.store.clone();
        Ok(JSPromise::wrap(
            global_this,
            lifetime_wrap::<{ Lifetime::Clone }>(Self::to_array_buffer),
            (self, global_this),
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_array_buffer(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        self.get_array_buffer_clone(global_this)
    }

    pub fn get_bytes_clone(&mut self, global_this: &JSGlobalObject) -> jsc::JsTerminatedResult<JSValue> {
        let _store = self.store.clone();
        Ok(JSPromise::wrap(
            global_this,
            lifetime_wrap::<{ Lifetime::Clone }>(Self::to_uint8_array),
            (self, global_this),
        ))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_bytes(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        self.get_bytes_clone(global_this)
    }

    pub fn get_bytes_transfer(&mut self, global_this: &JSGlobalObject) -> JSValue {
        let _store = self.store.clone();
        JSPromise::wrap(
            global_this,
            lifetime_wrap::<{ Lifetime::Transfer }>(Self::to_uint8_array),
            (self, global_this),
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_form_data(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let _store = self.store.clone();
        Ok(JSPromise::wrap(
            global_this,
            lifetime_wrap::<{ Lifetime::Temporary }>(Self::to_form_data),
            (self, global_this),
        ))
    }

    fn get_exists_sync(&mut self) -> JSValue {
        if self.size == MAX_SIZE {
            self.resolve_size();
        }

        // If there's no store that means it's empty and we just return true
        let Some(store) = &self.store else { return JSValue::TRUE };

        if matches!(store.data, Store::Data::Bytes(_)) {
            // Bytes will never error
            return JSValue::TRUE;
        }

        // We say regular files and pipes exist.
        let file = store.data.as_file();
        JSValue::from(bun_sys::is_regular_file(file.mode) || bun_sys::S::isfifo(file.mode))
    }

    pub fn is_s3(&self) -> bool {
        if let Some(store) = &self.store {
            return matches!(store.data, Store::Data::S3(_));
        }
        false
    }
}

// ──────────────────────────────────────────────────────────────────────────
// S3BlobDownloadTask
// ──────────────────────────────────────────────────────────────────────────

pub struct S3BlobDownloadTask {
    pub blob: Blob,
    pub global_this: *mut JSGlobalObject,
    pub promise: jsc::JSPromiseStrong,
    pub poll_ref: bun_aio::KeepAlive,
    pub handler: S3ReadHandler,
}

pub type S3ReadHandler = fn(&mut Blob, *mut JSGlobalObject, &mut [u8]) -> JSValue;

impl S3BlobDownloadTask {
    pub fn call_handler(&mut self, raw_bytes: &mut [u8]) -> JSValue {
        (self.handler)(&mut self.blob, self.global_this, raw_bytes)
    }

    pub fn on_s3_download_resolved(
        result: S3::S3DownloadResult,
        this: *mut S3BlobDownloadTask,
    ) -> jsc::JsTerminatedResult<()> {
        // SAFETY: `this` was Box::into_raw'd in init() and is consumed here.
        let this = unsafe { &mut *this };
        let _drop = scopeguard::guard(this as *mut S3BlobDownloadTask, |p| unsafe {
            drop(Box::from_raw(p));
        });
        let global = unsafe { &*this.global_this };
        match result {
            S3::S3DownloadResult::Success(response) => {
                let bytes = response.body.list.items;
                if this.blob.size == MAX_SIZE {
                    this.blob.size = bytes.len() as SizeType;
                }
                jsc::AnyPromise::Normal(this.promise.get()).wrap(
                    global,
                    S3BlobDownloadTask::call_handler,
                    (this, bytes),
                )?;
            }
            S3::S3DownloadResult::NotFound(err) | S3::S3DownloadResult::Failure(err) => {
                this.promise.reject(
                    global,
                    err.to_js_with_async_stack(
                        global,
                        this.blob.store.as_ref().unwrap().get_path(),
                        this.promise.get(),
                    ),
                )?;
            }
        }
        Ok(())
    }

    pub fn init(
        global_this: &JSGlobalObject,
        blob: &mut Blob,
        handler: S3ReadHandler,
    ) -> jsc::JsTerminatedResult<JSValue> {
        // The callback may read this.blob.content_type, which is heap-owned by the
        // source JS Blob and freed on finalize(). Take an owning dupe so the task
        // outliving the source can't dangle.
        let this = Box::into_raw(Box::new(S3BlobDownloadTask {
            global_this: global_this as *const _ as *mut _,
            blob: blob.dupe(),
            promise: jsc::JSPromiseStrong::init(global_this),
            poll_ref: bun_aio::KeepAlive::default(),
            handler,
        }));
        // SAFETY: just allocated.
        let this_ref = unsafe { &mut *this };
        let promise = this_ref.promise.value();
        let env = global_this.bun_vm().transpiler.env;
        let s3_store = this_ref.blob.store.as_ref().unwrap().data.as_s3();
        let credentials = s3_store.get_credentials();
        let path = s3_store.path();

        this_ref.poll_ref.ref_(global_this.bun_vm());
        let proxy = env.get_http_proxy(true, None, None).map(|p| p.href);

        if blob.offset > 0 {
            let len: Option<usize> = if blob.size != MAX_SIZE { Some(usize::try_from(blob.size).unwrap()) } else { None };
            let offset: usize = usize::try_from(blob.offset).unwrap();
            S3::download_slice(
                credentials, path, offset, len,
                Self::on_s3_download_resolved as _, this as *mut c_void,
                proxy, s3_store.request_payer,
            )?;
        } else if blob.size == MAX_SIZE {
            S3::download(
                credentials, path,
                Self::on_s3_download_resolved as _, this as *mut c_void,
                proxy, s3_store.request_payer,
            )?;
        } else {
            let len: usize = usize::try_from(blob.size).unwrap();
            let offset: usize = usize::try_from(blob.offset).unwrap();
            S3::download_slice(
                credentials, path, offset, Some(len),
                Self::on_s3_download_resolved as _, this as *mut c_void,
                proxy, s3_store.request_payer,
            )?;
        }
        Ok(promise)
    }
}

impl Drop for S3BlobDownloadTask {
    fn drop(&mut self) {
        self.blob.deinit();
        // SAFETY: global_this is valid for the lifetime of the task.
        self.poll_ref.unref(unsafe { (*self.global_this).bun_vm() });
        // promise: Drop handles deinit.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// doWrite / doUnlink / getExists
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    #[bun_jsc::host_fn(method)]
    pub fn do_write(&mut self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(3);
        let mut args = jsc::ArgumentsSlice::init(global_this.bun_vm(), arguments.slice());

        validate_writable_blob(global_this, self)?;

        let Some(data) = args.next_eat() else {
            return global_this.throw_invalid_arguments(
                "blob.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write",
            );
        };
        if data.is_empty_or_undefined_or_null() {
            return global_this.throw_invalid_arguments(
                "blob.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write",
            );
        }
        let mut mkdirp_if_not_exists: Option<bool> = None;
        let options = args.next_eat();
        if let Some(options_object) = options {
            if options_object.is_object() {
                if let Some(create_directory) = options_object.get_truthy(global_this, "createPath")? {
                    if !create_directory.is_boolean() {
                        return global_this.throw_invalid_argument_type("write", "options.createPath", "boolean");
                    }
                    mkdirp_if_not_exists = Some(create_directory.to_boolean());
                }
                if let Some(content_type) = options_object.get_truthy(global_this, "type")? {
                    // override the content type
                    if !content_type.is_string() {
                        return global_this.throw_invalid_argument_type("write", "options.type", "string");
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

                        if let Some(mime) = global_this.bun_vm().mime_type(slice) {
                            self.content_type = mime.value as *const [u8];
                        } else {
                            let mut buf = vec![0u8; slice.len()];
                            strings::copy_lowercase(slice, &mut buf);
                            self.content_type = Box::into_raw(buf.into_boxed_slice());
                            self.content_type_allocated = true;
                        }
                    }
                }
            } else if !options_object.is_empty_or_undefined_or_null() {
                return global_this.throw_invalid_argument_type("write", "options", "object");
            }
        }
        let mut blob_internal = PathOrBlob::Blob(self.clone()); // TODO(port): Zig copies struct by value
        write_file_internal(
            global_this,
            &mut blob_internal,
            data,
            WriteFileOptions { mkdirp_if_not_exists, extra_options: options, mode: None },
        )
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unlink(&mut self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let arguments = callframe.arguments_old(1);
        let mut args = jsc::ArgumentsSlice::init(global_this.bun_vm(), arguments.slice());

        validate_writable_blob(global_this, self)?;

        let store = self.store.as_ref().unwrap();
        match &store.data {
            Store::Data::S3(s3) => s3.unlink(store.clone(), global_this, args.next_eat()),
            Store::Data::File(file) => Ok(file.unlink(global_this)),
            _ => unreachable!(), // validate_writable_blob should have caught this
        }
    }

    // This mostly means 'can it be read?'
    #[bun_jsc::host_fn(method)]
    pub fn get_exists(&mut self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        if self.is_s3() {
            return Ok(S3File::S3BlobStatTask::exists(global_this, self));
        }
        Ok(JSPromise::resolved_promise_value(global_this, self.get_exists_sync()))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FileStreamWrapper / pipeReadableStreamToBlob
// ──────────────────────────────────────────────────────────────────────────

pub struct FileStreamWrapper {
    pub promise: jsc::JSPromiseStrong,
    pub readable_stream_ref: webcore::ReadableStreamStrong,
    // LIFETIMES.tsv: SHARED → Arc<FileSink>
    pub sink: Arc<webcore::FileSink>,
}

// Drop for FileStreamWrapper: promise/readable_stream_ref/sink all impl Drop.

#[bun_jsc::host_fn]
pub fn on_file_stream_resolve_request_stream(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments_old(2);
    // SAFETY: last arg is a promise-ptr created by FileStreamWrapper::new in pipe_readable_stream_to_blob.
    let this = unsafe {
        Box::from_raw(args.ptr()[args.len() - 1].as_promise_ptr::<FileStreamWrapper>())
    };
    let mut strong = core::mem::take(&mut this.readable_stream_ref);
    if let Some(stream) = strong.get(global_this) {
        stream.done(global_this);
    }
    this.promise.resolve(global_this, JSValue::js_number(0))?;
    Ok(JSValue::UNDEFINED)
}

#[bun_jsc::host_fn]
pub fn on_file_stream_reject_request_stream(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments_old(2);
    let this = unsafe {
        Box::from_raw(args.ptr()[args.len() - 1].as_promise_ptr::<FileStreamWrapper>())
    };
    // PORT NOTE: Zig defers `this.sink.deref()` here but does not deinit `this`;
    // matches by holding Arc until end of scope only.
    let _sink_hold = this.sink.clone();
    let err = args.ptr()[0];

    let mut strong = core::mem::take(&mut this.readable_stream_ref);

    this.promise.reject(global_this, err)?;

    if let Some(stream) = strong.get(global_this) {
        stream.cancel(global_this);
    }
    Ok(JSValue::UNDEFINED)
}

// TODO(port): @export of jsc::to_js_host_fn wrappers under
// "Bun__FileStreamWrapper__onResolveRequestStream" / "...Reject..." names.
// The #[bun_jsc::host_fn] attribute should support a `link_name = "..."` arg.

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
            let s3 = store.data.as_s3();
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
            let proxy = global_this.bun_vm().transpiler.env.get_http_proxy(true, None, None);
            let proxy_url = proxy.map(|p| p.href);

            return Ok(S3::upload_stream(
                if extra_options.is_some() { aws_options.credentials.dupe() } else { s3.get_credentials() },
                path,
                readable_stream,
                global_this,
                aws_options.options,
                aws_options.acl,
                aws_options.storage_class,
                self.content_type_or_mime_type(),
                aws_options.content_disposition,
                aws_options.content_encoding,
                proxy_url,
                aws_options.request_payer,
                None,
                core::ptr::null_mut(),
            ));
        }

        if !matches!(store.data, Store::Data::File(_)) {
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this,
                global_this.create_error_instance("Blob is read-only"),
            ));
        }

        // TODO(port): Windows-specific FileSink open path (Zig lines 2627-2689) and
        // POSIX FileSink start path (lines 2691-2720). Elided in Phase A for brevity;
        // both paths produce `file_sink: Arc<FileSink>` and continue below.
        let file_sink: Arc<webcore::FileSink> = todo!("port FileSink open/start branches");

        let signal = &mut file_sink.signal;
        *signal = webcore::FileSink::JSSink::SinkSignal::init(JSValue::ZERO);

        // explicitly set it to a dead pointer
        // we use this memory address to disable signals being sent
        signal.clear();
        debug_assert!(signal.is_dead());

        let assignment_result: JSValue = webcore::FileSink::JSSink::assign_to_stream(
            global_this,
            readable_stream.value,
            file_sink.clone(),
            &mut signal.ptr as *mut _ as *mut *mut c_void,
        );

        assignment_result.ensure_still_alive();

        // assert that it was updated
        debug_assert!(!signal.is_dead());

        if let Some(err) = assignment_result.to_error() {
            drop(file_sink);
            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                global_this, err,
            ));
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            global_this.bun_vm().drain_microtasks();

            assignment_result.ensure_still_alive();
            // it returns a Promise when it goes through ReadableStreamDefaultReader
            if let Some(promise) = assignment_result.as_any_promise() {
                match promise.status() {
                    jsc::PromiseStatus::Pending => {
                        let wrapper = Box::into_raw(Box::new(FileStreamWrapper {
                            promise: jsc::JSPromiseStrong::init(global_this),
                            readable_stream_ref: webcore::ReadableStreamStrong::init(readable_stream, global_this),
                            sink: file_sink,
                        }));
                        // SAFETY: wrapper was just produced by Box::into_raw; sole owner here.
                        let promise_value = unsafe { (*wrapper).promise.value() };
                        assignment_result.then(
                            global_this,
                            wrapper as *mut c_void,
                            on_file_stream_resolve_request_stream,
                            on_file_stream_reject_request_stream,
                        )?;
                        return Ok(promise_value);
                    }
                    jsc::PromiseStatus::Fulfilled => {
                        drop(file_sink);
                        readable_stream.done(global_this);
                        return Ok(JSPromise::resolved_promise_value(global_this, JSValue::js_number(0)));
                    }
                    jsc::PromiseStatus::Rejected => {
                        drop(file_sink);
                        readable_stream.cancel(global_this);
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            promise.result(global_this.vm()),
                        ));
                    }
                }
            } else {
                drop(file_sink);
                readable_stream.cancel(global_this);
                return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this, assignment_result,
                ));
            }
        }
        drop(file_sink);

        Ok(JSPromise::resolved_promise_value(global_this, JSValue::js_number(0)))
    }

    #[bun_jsc::host_fn(method)]
    pub fn get_writer(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let arguments_ = callframe.arguments_old(1);
        let arguments = &arguments_.ptr()[..arguments_.len()];

        if !arguments[0].is_empty_or_undefined_or_null() && !arguments[0].is_object() {
            return global_this.throw_invalid_arguments("options must be an object or undefined");
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
                bun_sys::INVALID_FD,
                // SAFETY: self.global_this stored from a live &JSGlobalObject; VM outlives this task.
                unsafe { (*self.global_this).bun_vm() }.event_loop(),
            );

            let input_path: webcore::PathOrFileDescriptor = match &store.data.as_file().pathlike {
                node::PathLike::Fd(fd) => webcore::PathOrFileDescriptor::Fd(*fd),
                p => webcore::PathOrFileDescriptor::Path(ZigString::Slice::init_dupe(p.slice())),
            };

            let mut stream_start = streams::Start::FileSink(streams::FileSinkStart {
                input_path: input_path.clone(),
                ..Default::default()
            });

            if !arguments.is_empty() && arguments[0].is_object() {
                stream_start = streams::Start::from_js_with_tag(global_this, arguments[0], streams::Tag::FileSink)?;
                stream_start.as_file_sink_mut().input_path = input_path;
            }

            match sink.start(stream_start) {
                bun_sys::Result::Err(err) => {
                    drop(sink);
                    return global_this.throw_value(err.to_js(global_this)?);
                }
                _ => {}
            }

            return Ok(sink.to_js(global_this));
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

        let blob_ = Blob::new(blob);
        // SAFETY: ptr was just produced by Box::into_raw in Blob::new.
        unsafe { (*blob_).to_js(global_this) }
    }

    /// https://w3c.github.io/FileAPI/#slice-method-algo
    #[bun_jsc::host_fn(method)]
    pub fn get_slice(
        &mut self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let mut arguments_ = callframe.arguments_old(3);
        let args = &mut arguments_.ptr_mut()[..arguments_.len()];

        if self.size == 0 {
            let empty = Blob::init_empty(global_this);
            let ptr = Blob::new(empty);
            // SAFETY: ptr was just produced by Box::into_raw in Blob::new.
            return Ok(unsafe { (*ptr).to_js(global_this) });
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

        let mut args_iter = jsc::ArgumentsSlice::init(global_this.bun_vm(), &arguments_.ptr()[..3]);
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

                    if let Some(mime) = global_this.bun_vm().mime_type(slice) {
                        content_type = mime.value as *const [u8];
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
        self.store.as_ref().map(|s| s.mime_type)
    }

    pub fn get_mime_type_or_content_type(&self) -> Option<MimeType> {
        if self.content_type_was_set {
            return Some(MimeType::init(self.content_type_slice(), None, None));
        }
        self.store.as_ref().map(|s| s.mime_type)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_type(&self, global_this: &JSGlobalObject) -> JSValue {
        let ct = self.content_type_slice();
        if !ct.is_empty() {
            return ZigString::init(ct).to_js(global_this);
        }
        if let Some(store) = &self.store {
            return ZigString::init(store.mime_type.value).to_js(global_this);
        }
        ZigString::EMPTY.to_js(global_this)
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
    #[bun_jsc::host_fn(getter)]
    pub fn get_name(&mut self, _: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match self.get_name_string() {
            Some(name) => name.to_js(global_this),
            None => JSValue::UNDEFINED,
        })
    }

    #[bun_jsc::host_fn(setter)]
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
            js::name_set_cached(js_this, global_this, value);
            return Ok(());
        }
        if value.is_string() {
            let old_name = core::mem::replace(&mut self.name, BunString::empty());
            // errdefer this.name = bun.String.empty — handled by the replace above.
            self.name = BunString::from_js(value, global_this)?;
            // We don't need to increment the reference count since try_from_js already did it.
            js::name_set_cached(js_this, global_this, value);
            old_name.deref();
        }
        Ok(())
    }

    pub fn get_file_name(&self) -> Option<&[u8]> {
        if let Some(store) = &self.store {
            match &store.data {
                Store::Data::File(file) => {
                    if let node::PathLike::Path(p) = &file.pathlike {
                        return Some(p.slice());
                    }
                    // we shouldn't return Number here.
                }
                Store::Data::Bytes(bytes) => {
                    if !bytes.stored_name.slice().is_empty() {
                        return Some(bytes.stored_name.slice());
                    }
                }
                Store::Data::S3(s3) => return Some(s3.path()),
            }
        }
        None
    }

    pub fn get_loader(&self, jsc_vm: &VirtualMachine) -> Option<bun_bundler::options::Loader> {
        if let Some(filename) = self.get_file_name() {
            let current_path = bun_core::fs::Path::init(filename);
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
    #[bun_jsc::host_fn(getter)]
    pub fn get_last_modified(&mut self, _: &JSGlobalObject) -> JSValue {
        if let Some(store) = &self.store {
            if let Store::Data::File(file) = &store.data {
                // last_modified can be already set during read.
                if file.last_modified == jsc::INIT_TIMESTAMP && !self.is_s3() {
                    resolve_file_stat(store);
                }
                return JSValue::js_number(file.last_modified);
            }
        }

        if self.is_jsdom_file {
            return JSValue::js_number(self.last_modified);
        }

        JSValue::js_number(jsc::INIT_TIMESTAMP)
    }

    pub fn get_size_for_bindings(&mut self) -> u64 {
        if self.size == MAX_SIZE {
            self.resolve_size();
        }

        // If the file doesn't exist or is not seekable
        // signal that the size is unknown.
        if let Some(store) = &self.store {
            if let Store::Data::File(file) = &store.data {
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
    let data = blob.shared_view();
    if data.is_empty() { return core::ptr::null_mut(); }
    data.as_ptr() as *mut c_void
}

#[unsafe(no_mangle)]
pub extern "C" fn Blob__getSize(value: JSValue) -> usize {
    let Some(blob) = Blob::from_js(value) else { return 0 };
    blob.shared_view().len()
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
    // TODO(port): expose as a `&'static dyn bun_alloc::Allocator` so Store can
    // own a slice with a custom-free path. See Zig lines 3316-3339.
    pub fn free(buf: &mut [u8]) {
        if let Err(err) = bun_sys::munmap(buf).unwrap() {
            bun_core::Output::debug_warn(format_args!("Blob mmap-store munmap failed: {:?}", err));
        }
    }
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
        // TODO(port): Store::init with a custom allocator vtable that munmap's on free.
        // SAFETY: caller guarantees [ptr, ptr+len) is a valid mmap'd region.
        let store = Store::init_with_allocator(
            unsafe { core::slice::from_raw_parts_mut(ptr, len) },
            bun_alloc::AllocatorVTable::mmap(),
        );
        let blob = Blob::new(Blob::init_with_store(store, global_this));
        // SAFETY: caller (C++) passes a valid NUL-terminated C string.
        let mime_slice = unsafe { core::ffi::CStr::from_ptr(mime) }.to_bytes();
        if !mime_slice.is_empty() {
            // SAFETY: blob was just produced by Box::into_raw in Blob::new.
            unsafe {
                (*blob).content_type = mime_slice as *const [u8];
                (*blob).content_type_was_set = true;
            }
        }
        blob
    }
}

impl Blob {
    #[bun_jsc::host_fn(method)]
    pub fn get_stat(&mut self, global_this: &JSGlobalObject, callback: &CallFrame) -> JsResult<JSValue> {
        let Some(store) = &self.store else { return Ok(JSValue::UNDEFINED) };
        // TODO: make this async for files
        match &store.data {
            Store::Data::File(file) => match &file.pathlike {
                node::PathLike::Path(path_like) => {
                    return Ok(node::fs::Async::stat::create(
                        global_this,
                        (),
                        node::fs::StatArgs {
                            path: node::PathLike::EncodedSlice(match path_like {
                                node::PathLike::EncodedSlice(slice) => slice.to_owned()?,
                                _ => ZigString::from_utf8(path_like.slice()).to_slice_clone()?,
                            }),
                            ..Default::default()
                        },
                        global_this.bun_vm(),
                    ));
                }
                node::PathLike::Fd(fd) => {
                    return Ok(node::fs::Async::fstat::create(
                        global_this, (), node::fs::FstatArgs { fd: *fd }, global_this.bun_vm(),
                    ));
                }
            },
            Store::Data::S3(_) => return S3File::get_stat(self, global_this, callback),
            _ => Ok(JSValue::UNDEFINED),
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_size(&mut self, _: &JSGlobalObject) -> JSValue {
        if self.size == MAX_SIZE {
            if self.is_s3() {
                return JSValue::js_number(f64::NAN);
            }
            self.resolve_size();
            if self.size == MAX_SIZE && self.store.is_some() {
                return JSValue::js_number(f64::INFINITY);
            } else if self.size == 0 && self.store.is_some() {
                if let Store::Data::File(file) = &self.store.as_ref().unwrap().data {
                    if file.seekable.unwrap_or(true) == false && file.max_size == MAX_SIZE {
                        return JSValue::js_number(f64::INFINITY);
                    }
                }
            }
        }
        JSValue::js_number(self.size)
    }

    pub fn resolve_size(&mut self) {
        if let Some(store) = &self.store {
            match &store.data {
                Store::Data::Bytes(_) => {
                    let offset = self.offset;
                    let store_size = store.size();
                    if store_size != MAX_SIZE {
                        self.offset = store_size.min(offset);
                        self.size = store_size - offset;
                    }
                    return;
                }
                Store::Data::File(file) => {
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
}

/// resolve file stat like size, last_modified
fn resolve_file_stat(store: &Arc<Store>) {
    let file = store.data.as_file_mut();
    match &file.pathlike {
        node::PathLike::Path(path) => {
            let mut buffer = bun_paths::PathBuffer::uninit();
            match bun_sys::stat(path.slice_z(&mut buffer)) {
                bun_sys::Result::Ok(stat) => {
                    file.max_size = if bun_sys::is_regular_file(stat.mode) || stat.size > 0 {
                        ((stat.size.max(0)) as u64) as SizeType
                    } else {
                        MAX_SIZE
                    };
                    file.mode = stat.mode as bun_sys::Mode;
                    file.seekable = Some(bun_sys::is_regular_file(stat.mode));
                    file.last_modified = jsc::to_js_time(stat.mtime().sec, stat.mtime().nsec);
                }
                // the file may not exist yet. That's okay.
                _ => {}
            }
        }
        node::PathLike::Fd(fd) => {
            match bun_sys::fstat(*fd) {
                bun_sys::Result::Ok(stat) => {
                    file.max_size = if bun_sys::is_regular_file(stat.mode) || stat.size > 0 {
                        ((stat.size.max(0)) as u64) as SizeType
                    } else {
                        MAX_SIZE
                    };
                    file.mode = stat.mode as bun_sys::Mode;
                    file.seekable = Some(bun_sys::is_regular_file(stat.mode));
                    file.last_modified = jsc::to_js_time(stat.mtime().sec, stat.mtime().nsec);
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
    #[bun_jsc::host_fn]
    pub fn constructor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<*mut Blob> {
        let mut blob: Blob;
        let arguments = callframe.arguments_old(2);
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

                                    if let Some(mime) = global_this.bun_vm().mime_type(slice) {
                                        blob.content_type = mime.value as *const [u8];
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
        let mut shared = Ref::adopt(this);
        shared.deinit();
    }

    pub fn init_with_all_ascii(bytes: Vec<u8>, global_this: &JSGlobalObject, is_all_ascii: bool) -> Blob {
        // avoid allocating a Blob.Store if the buffer is actually empty
        let mut store: Option<Arc<Store>> = None;
        let len = bytes.len();
        if len > 0 {
            let s = Store::init(bytes);
            s.is_all_ascii = Some(is_all_ascii);
            store = Some(s);
        }
        Blob {
            size: len as SizeType,
            store,
            content_type: b"" as &'static [u8] as *const [u8],
            global_this: global_this as *const _ as *mut _,
            charset: strings::AsciiStatus::from_bool(is_all_ascii),
            ..Default::default()
        }
    }

    /// Takes ownership of `bytes`.
    pub fn init(bytes: Vec<u8>, global_this: &JSGlobalObject) -> Blob {
        let len = bytes.len();
        Blob {
            size: len as SizeType,
            store: if len > 0 { Some(Store::init(bytes)) } else { None },
            content_type: b"" as &'static [u8] as *const [u8],
            global_this: global_this as *const _ as *mut _,
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
                MimeType::TEXT.value as *const [u8]
            } else {
                b"" as &'static [u8] as *const [u8]
            },
            global_this: global_this as *const _ as *mut _,
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
            if bun_sys::linux::MemFdAllocator::should_use(bytes_) {
                if let bun_sys::Result::Ok(result) = bun_sys::linux::MemFdAllocator::create(bytes_) {
                    let store = Arc::new(Store::new_raw(Store::Init {
                        data: Store::Data::Bytes(result),
                        ref_count: AtomicU32::new(1),
                        ..Default::default()
                    }));
                    let mut blob = Blob::init_with_store(store, global_this);
                    if was_string && blob.content_type_slice().is_empty() {
                        blob.content_type = MimeType::TEXT.value as *const [u8];
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

    pub fn init_with_store(store: Arc<Store>, global_this: &JSGlobalObject) -> Blob {
        let size = store.size();
        let content_type = if let Store::Data::File(ref f) = store.data {
            f.mime_type.value as *const [u8]
        } else {
            b"" as &'static [u8] as *const [u8]
        };
        Blob {
            size,
            store: Some(store),
            content_type,
            global_this: global_this as *const _ as *mut _,
            ..Default::default()
        }
    }

    pub fn init_empty(global_this: &JSGlobalObject) -> Blob {
        Blob {
            size: 0,
            store: None,
            content_type: b"" as &'static [u8] as *const [u8],
            global_this: global_this as *const _ as *mut _,
            ..Default::default()
        }
    }

    // Transferring doesn't change the reference count
    // It is a move
    #[inline]
    fn transfer(&mut self) {
        // PORT NOTE: in Zig this just nulls the field without deref. With Arc<Store>
        // we cannot drop without decrementing; use ManuallyDrop to leak the count.
        // TODO(port): if Store is intrusive-refcounted, replace Arc with IntrusiveArc
        // so transfer is a plain `self.store = None` without the leak hack.
        if let Some(s) = self.store.take() {
            core::mem::forget(s);
        }
    }

    pub fn detach(&mut self) {
        self.store = None; // Arc::drop decrements
    }

    /// This does not duplicate
    /// This creates a new view
    /// and increment the reference count
    pub fn dupe(&self) -> Blob {
        self.dupe_with_content_type(false)
    }

    pub fn dupe_with_content_type(&self, _include_content_type: bool) -> Blob {
        // PORT NOTE: Zig does `this.store.?.ref()` then bitwise-copies the struct.
        // With Arc, cloning the Option<Arc<Store>> achieves the ref bump.
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
        // If the source's content_type is heap-allocated, the bitwise copy above aliases
        // the same allocation. Take our own copy so freeing one side doesn't dangle the other.
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
            return S3File::to_js_unchecked(global_object, self);
        }

        js::to_js_unchecked(global_object, self)
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

    pub fn set_is_ascii_flag(&mut self, is_all_ascii: bool) {
        self.charset = strings::AsciiStatus::from_bool(is_all_ascii);
        // if this Blob represents the entire binary data
        // we can update the store's is_all_ascii flag
        if self.size > 0 && self.offset == 0 {
            if let Some(store) = &self.store {
                if matches!(store.data, Store::Data::Bytes(_)) {
                    store.is_all_ascii = Some(is_all_ascii);
                }
            }
        }
    }

    pub fn needs_to_read_file(&self) -> bool {
        self.store
            .as_ref()
            .map(|s| matches!(s.data, Store::Data::File(_)))
            .unwrap_or(false)
    }
}

pub use Lifetime as BlobLifetime;

// ──────────────────────────────────────────────────────────────────────────
// toStringWithBytes / toString / toJSON / toFormData / toArrayBuffer{View}
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    pub fn to_string_with_bytes<const LIFETIME: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        raw_bytes: &[u8],
    ) -> JsResult<JSValue> {
        let (bom, buf) = strings::BOM::detect_and_split(raw_bytes);

        if buf.is_empty() {
            // If all it contained was the bom, we need to free the bytes
            if LIFETIME == Lifetime::Temporary {
                // SAFETY: temporary lifetime means raw_bytes is a leaked default-allocator buffer.
                unsafe { drop(Box::from_raw(raw_bytes as *const [u8] as *mut [u8])) };
            }
            return Ok(ZigString::EMPTY.to_js(global));
        }

        if bom == Some(strings::BOM::Utf16Le) {
            let _free = scopeguard::guard((), |_| {
                if LIFETIME == Lifetime::Temporary {
                    unsafe { drop(Box::from_raw(raw_bytes as *const [u8] as *mut [u8])) };
                }
            });
            let out = BunString::clone_utf16(bun_core::reinterpret_slice::<u16>(buf));
            return Ok(out.to_js(global));
        }

        // null == unknown
        // false == can't be
        let could_be_all_ascii = self.is_all_ascii().or_else(|| self.store.as_ref().unwrap().is_all_ascii);

        if could_be_all_ascii.is_none() || !could_be_all_ascii.unwrap() {
            // if to_utf16_alloc returns None, it means there are no non-ASCII characters
            if let Some(external) = strings::to_utf16_alloc(buf, false, false)
                .map_err(|_| global.throw_out_of_memory().unwrap_err())?
            {
                if LIFETIME != Lifetime::Temporary {
                    self.set_is_ascii_flag(false);
                }
                if LIFETIME == Lifetime::Transfer {
                    self.detach();
                }
                if LIFETIME == Lifetime::Temporary {
                    unsafe { drop(Box::from_raw(raw_bytes as *const [u8] as *mut [u8])) };
                }
                return Ok(ZigString::to_external_u16(external.as_ptr(), external.len(), global));
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
                Ok(ZigString::init(buf).external(global, Arc::into_raw(store) as *mut c_void, Store::external))
            }
            Lifetime::Transfer => {
                let store = self.store.as_ref().unwrap().clone();
                debug_assert!(matches!(store.data, Store::Data::Bytes(_)));
                self.transfer();
                Ok(ZigString::init(buf).external(global, Arc::into_raw(store) as *mut c_void, Store::external))
            }
            Lifetime::Share => {
                let store = self.store.as_ref().unwrap().clone();
                Ok(ZigString::init(buf).external(global, Arc::into_raw(store) as *mut c_void, Store::external))
            }
            Lifetime::Temporary => {
                // if there was a UTF-8 BOM, we need to clone the buffer because
                // external doesn't support this case here yet.
                if buf.len() != raw_bytes.len() {
                    let out = BunString::clone_latin1(buf);
                    unsafe { drop(Box::from_raw(raw_bytes as *const [u8] as *mut [u8])) };
                    return Ok(out.to_js(global));
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
            // TODO(port): do_read_file is monomorphized over the WithBytes fn.
            return Ok(self.do_read_file::<ToStringWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToStringWithBytesFn>(global);
        }

        let view_ = self.shared_view();
        if view_.is_empty() {
            return Ok(ZigString::EMPTY.to_js(global));
        }

        // PORT NOTE: reshaped for borrowck — Zig @constCast'd shared_view().
        // TODO(port): dispatch on `lifetime` (was comptime in Zig). Phase B.
        match lifetime {
            Lifetime::Clone => self.to_string_with_bytes::<{ Lifetime::Clone }>(global, view_),
            Lifetime::Transfer => self.to_string_with_bytes::<{ Lifetime::Transfer }>(global, view_),
            Lifetime::Share => self.to_string_with_bytes::<{ Lifetime::Share }>(global, view_),
            Lifetime::Temporary => self.to_string_with_bytes::<{ Lifetime::Temporary }>(global, view_),
        }
    }

    pub fn to_json(&mut self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        if self.needs_to_read_file() {
            return Ok(self.do_read_file::<ToJsonWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToJsonWithBytesFn>(global);
        }

        let view_ = self.shared_view();
        // TODO(port): dispatch on lifetime const-generic
        self.to_json_with_bytes::<{ Lifetime::Share }>(global, view_)
    }

    pub fn to_json_with_bytes<const LIFETIME: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        raw_bytes: &[u8],
    ) -> JsResult<JSValue> {
        let (bom, buf) = strings::BOM::detect_and_split(raw_bytes);
        if buf.is_empty() {
            if LIFETIME == Lifetime::Temporary {
                unsafe { drop(Box::from_raw(raw_bytes as *const [u8] as *mut [u8])) };
            }
            return Ok(global.create_syntax_error_instance("Unexpected end of JSON input"));
        }

        if bom == Some(strings::BOM::Utf16Le) {
            let out = BunString::clone_utf16(bun_core::reinterpret_slice::<u16>(buf));
            let _free = scopeguard::guard((), |_| {
                if LIFETIME == Lifetime::Temporary {
                    unsafe { drop(Box::from_raw(raw_bytes as *const [u8] as *mut [u8])) };
                }
                if LIFETIME == Lifetime::Transfer {
                    self.detach();
                }
            });
            return out.to_js_by_parse_json(global);
        }
        // null == unknown
        // false == can't be
        let could_be_all_ascii = self.is_all_ascii().or_else(|| self.store.as_ref().unwrap().is_all_ascii);
        // When a BOM is present `buf` is an interior slice of `raw_bytes`; we must
        // free the original allocation, not the offset pointer.
        let _free = scopeguard::guard((), |_| {
            if LIFETIME == Lifetime::Temporary {
                unsafe { drop(Box::from_raw(raw_bytes as *const [u8] as *mut [u8])) };
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

    pub fn to_form_data_with_bytes<const _L: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        buf: &mut [u8],
    ) -> JSValue {
        let Some(encoder) = self.get_form_data_encoding() else {
            return ZigString::init(b"Invalid encoding").to_error_instance(global);
        };

        match bun_core::FormData::to_js(global, buf, encoder.encoding) {
            Ok(v) => v,
            Err(err) => global
                .create_error_instance(format_args!("FormData encoding failed: {}", err.name())),
        }
    }

    pub fn to_array_buffer_with_bytes<const LIFETIME: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        buf: &mut [u8],
    ) -> JsResult<JSValue> {
        self.to_array_buffer_view_with_bytes::<LIFETIME, { jsc::JSType::ArrayBuffer }>(global, buf)
    }

    pub fn to_uint8_array_with_bytes<const LIFETIME: Lifetime>(
        &mut self,
        global: &JSGlobalObject,
        buf: &mut [u8],
    ) -> JsResult<JSValue> {
        self.to_array_buffer_view_with_bytes::<LIFETIME, { jsc::JSType::Uint8Array }>(global, buf)
    }

    pub fn to_array_buffer_view_with_bytes<const LIFETIME: Lifetime, const TYPED_ARRAY_VIEW: jsc::JSType>(
        &mut self,
        global: &JSGlobalObject,
        buf: &mut [u8],
    ) -> JsResult<JSValue> {
        match LIFETIME {
            Lifetime::Clone => {
                if TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer {
                    // ArrayBuffer doesn't have this limit.
                    if buf.len() > VirtualMachine::SYNTHETIC_ALLOCATION_LIMIT {
                        self.detach();
                        return global.throw_out_of_memory();
                    }
                }

                #[cfg(target_os = "linux")]
                {
                    // If we can use a copy-on-write clone of the buffer, do so.
                    if let Some(store) = &self.store {
                        if let Store::Data::Bytes(bytes) = &store.data {
                            let allocated_slice = bytes.allocated_slice();
                            if bun_core::is_slice_in_buffer(buf, allocated_slice) {
                                if let Some(allocator) = bun_sys::linux::MemFdAllocator::from(bytes.allocator) {
                                    let _hold = allocator.clone();
                                    let byte_offset = (buf.as_ptr() as usize)
                                        .saturating_sub(allocated_slice.as_ptr() as usize);
                                    let byte_length = buf.len();
                                    let result = jsc::ArrayBuffer::to_array_buffer_from_shared_memfd(
                                        allocator.fd.cast(),
                                        global,
                                        byte_offset,
                                        byte_length,
                                        allocated_slice.len(),
                                        TYPED_ARRAY_VIEW,
                                    );
                                    debug!(
                                        "toArrayBuffer COW clone({}, {}) = {}",
                                        byte_offset,
                                        byte_length,
                                        (!result.is_empty()) as u8
                                    );
                                    if !result.is_empty() {
                                        return Ok(result);
                                    }
                                }
                            }
                        }
                    }
                }
                Ok(jsc::ArrayBuffer::create(global, buf, TYPED_ARRAY_VIEW))
            }
            Lifetime::Share => {
                if buf.len() > jsc::SYNTHETIC_ALLOCATION_LIMIT && TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer {
                    return global.throw_out_of_memory();
                }
                let store = self.store.as_ref().unwrap().clone();
                Ok(jsc::ArrayBuffer::from_bytes(buf, TYPED_ARRAY_VIEW).to_js_with_context(
                    global,
                    Arc::into_raw(store) as *mut c_void,
                    jsc::BlobArrayBuffer_deallocator,
                    None,
                ))
            }
            Lifetime::Transfer => {
                if buf.len() > VirtualMachine::SYNTHETIC_ALLOCATION_LIMIT
                    && TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer
                {
                    self.detach();
                    return global.throw_out_of_memory();
                }
                let store = self.store.as_ref().unwrap().clone();
                self.transfer();
                Ok(jsc::ArrayBuffer::from_bytes(buf, TYPED_ARRAY_VIEW).to_js_with_context(
                    global,
                    Arc::into_raw(store) as *mut c_void,
                    jsc::array_buffer::BlobArrayBuffer_deallocator,
                ))
            }
            Lifetime::Temporary => {
                if buf.len() > VirtualMachine::SYNTHETIC_ALLOCATION_LIMIT
                    && TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer
                {
                    unsafe { drop(Box::from_raw(buf as *mut [u8])) };
                    return global.throw_out_of_memory();
                }
                Ok(jsc::ArrayBuffer::from_bytes(buf, TYPED_ARRAY_VIEW).to_js(global))
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
            // TODO(port): select WithBytesFn by TYPED_ARRAY_VIEW; Zig dispatched at comptime.
            return Ok(self.do_read_file::<ToArrayBufferWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToArrayBufferWithBytesFn>(global);
        }

        let view_ = self.shared_view();
        if view_.is_empty() {
            return Ok(jsc::ArrayBuffer::create(global, b"", TYPED_ARRAY_VIEW));
        }

        // SAFETY: shared_view borrows store data; the WithBytes fns only read from
        // it under .clone/.share and the store outlives this call.
        let mut_view = unsafe { core::slice::from_raw_parts_mut(view_.as_ptr() as *mut u8, view_.len()) };
        // TODO(port): dispatch on lifetime const-generic and TYPED_ARRAY_VIEW.
        match lifetime {
            Lifetime::Clone => self.to_array_buffer_view_with_bytes::<{ Lifetime::Clone }, TYPED_ARRAY_VIEW>(global, mut_view),
            Lifetime::Share => self.to_array_buffer_view_with_bytes::<{ Lifetime::Share }, TYPED_ARRAY_VIEW>(global, mut_view),
            Lifetime::Transfer => self.to_array_buffer_view_with_bytes::<{ Lifetime::Transfer }, TYPED_ARRAY_VIEW>(global, mut_view),
            Lifetime::Temporary => self.to_array_buffer_view_with_bytes::<{ Lifetime::Temporary }, TYPED_ARRAY_VIEW>(global, mut_view),
        }
    }

    pub fn to_form_data(&mut self, global: &JSGlobalObject, _lifetime: Lifetime) -> jsc::JsTerminatedResult<JSValue> {
        if self.needs_to_read_file() {
            return Ok(self.do_read_file::<ToFormDataWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToFormDataWithBytesFn>(global);
        }

        let view_ = self.shared_view();
        if view_.is_empty() {
            return Ok(jsc::DOMFormData::create(global));
        }

        // SAFETY: view_ borrows the Store's bytes for the duration of this call; FormData parsing
        // mutates in place (Zig passed `[]u8`). Store is uniquely referenced via &mut self here.
        let mut_view = unsafe { core::slice::from_raw_parts_mut(view_.as_ptr() as *mut u8, view_.len()) };
        Ok(self.to_form_data_with_bytes::<{ Lifetime::Temporary }>(global, mut_view))
    }
}

// TODO(port): marker types for the comptime fn dispatch through do_read_file/do_read_from_s3.
pub struct ToStringWithBytesFn;
pub struct ToJsonWithBytesFn;
pub struct ToArrayBufferWithBytesFn;
pub struct ToFormDataWithBytesFn;

// ──────────────────────────────────────────────────────────────────────────
// get / fromJSMove / fromJSClone / fromJSWithoutDeferGC
// ──────────────────────────────────────────────────────────────────────────

impl Blob {
    #[inline]
    pub fn get<const MOVE: bool, const REQUIRE_ARRAY: bool>(
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<Blob> {
        Self::from_js_movable::<MOVE, REQUIRE_ARRAY>(global, arg)
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

    fn from_js_movable<const MOVE: bool, const REQUIRE_ARRAY: bool>(
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<Blob> {
        if MOVE && !REQUIRE_ARRAY {
            Self::from_js_move(global, arg)
        } else if !REQUIRE_ARRAY {
            Self::from_js_clone_optional_array(global, arg)
        } else {
            Self::from_js_clone(global, arg)
        }
    }

    fn from_js_without_defer_gc<const MOVE: bool, const REQUIRE_ARRAY: bool>(
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<Blob> {
        let mut current = arg;
        if current.is_undefined_or_null() {
            return Ok(Blob { global_this: global as *const _ as *mut _, ..Default::default() });
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
                    return Ok(Blob { global_this: global as *const _ as *mut _, ..Default::default() });
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
                        let (bytes, ascii) = str.to_owned_slice_returning_all_ascii()?;
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
                        if let Some(blob) = top_value.as_::<Blob>() {
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
                        } else if let Some(build) = top_value.as_::<jsc::api::BuildArtifact>() {
                            return Ok(build.blob.dupe());
                        } else {
                            let sliced = current.to_slice_clone(global)?;
                            if let Some(_allocator) = sliced.allocator_get() {
                                return Ok(Blob::init_with_all_ascii(
                                    sliced.into_owned(),
                                    global,
                                    false,
                                ));
                            }
                        }
                    }
                }

                _ => {}
            }

            // new Blob("ok")
            // new File("ok", "file.txt")
            if fail_if_top_value_is_not_typed_array_like {
                return global.throw_invalid_arguments("new Blob() expects an Array");
            }
        }

        // PERF(port): was stack-fallback(1024) alloc — ArrayVec keeps JSValues on the
        // conservatively-scanned stack (heap Vec<JSValue> is NOT GC-safe). Zig spilled
        // to heap past 128 entries; Phase B may need a rooted overflow path.
        let mut stack: arrayvec::ArrayVec<JSValue, 128> = arrayvec::ArrayVec::new();
        let mut joiner = bun_core::StringJoiner::default();
        let mut could_have_non_ascii = false;

        loop {
            match current.js_type_loose() {
                jsc::JSType::NumberObject
                | jsc::JSType::String
                | jsc::JSType::StringObject
                | jsc::JSType::DerivedStringObject => {
                    let sliced = current.to_slice(global)?;
                    let allocator = sliced.allocator_get();
                    could_have_non_ascii = could_have_non_ascii || !sliced.allocator_is_wtf();
                    joiner.push(sliced.slice(), allocator);
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
                                    let allocator = sliced.allocator_get();
                                    could_have_non_ascii = could_have_non_ascii || !sliced.allocator_is_wtf();
                                    joiner.push(sliced.slice(), allocator);
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
                                    if let Some(blob) = item.as_::<Blob>() {
                                        could_have_non_ascii = could_have_non_ascii
                                            || blob.charset != strings::AsciiStatus::AllAscii;
                                        joiner.push_static(blob.shared_view());
                                        continue;
                                    } else {
                                        let sliced = current.to_slice_clone(global)?;
                                        let allocator = sliced.allocator_get();
                                        could_have_non_ascii = could_have_non_ascii || allocator.is_some();
                                        joiner.push(sliced.slice(), allocator);
                                    }
                                }
                                _ => {}
                            }
                        }

                        stack.push(item); // PERF(port): was assume_capacity
                    }
                }

                jsc::JSType::DOMWrapper => {
                    if let Some(blob) = current.as_::<Blob>() {
                        could_have_non_ascii =
                            could_have_non_ascii || blob.charset != strings::AsciiStatus::AllAscii;
                        joiner.push_static(blob.shared_view());
                    } else {
                        let sliced = current.to_slice_clone(global)?;
                        let allocator = sliced.allocator_get();
                        could_have_non_ascii = could_have_non_ascii || allocator.is_some();
                        joiner.push(sliced.slice(), allocator);
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
                    could_have_non_ascii = could_have_non_ascii || !sliced.allocator_is_wtf();
                    joiner.push(sliced.slice(), sliced.allocator_get());
                }
            }
            current = match stack.pop() {
                Some(v) => v,
                None => break,
            };
        }

        let joined = joiner.done();

        if !could_have_non_ascii {
            return Ok(Blob::init_with_all_ascii(joined, global, true));
        }
        Ok(Blob::init(joined, global))
    }
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
            Any::WTFStringImpl(str) => if str.ref_count() == 1 { str.memory_cost() } else { 0 },
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
            Any::WTFStringImpl(s) => s.byte_length() as SizeType,
            Any::InternalBlob(_) => self.slice().len() as SizeType,
        }
    }

    #[inline]
    pub fn size(&self) -> SizeType {
        match self {
            Any::Blob(b) => b.size,
            Any::WTFStringImpl(s) => s.utf8_byte_length() as SizeType,
            _ => self.slice().len() as SizeType,
        }
    }

    pub fn has_content_type_from_user(&self) -> bool {
        match self {
            Any::Blob(b) => b.has_content_type_from_user(),
            Any::WTFStringImpl(_) | Any::InternalBlob(_) => false,
        }
    }

    fn to_internal_blob_if_possible(&mut self) {
        if let Any::Blob(blob) = self {
            if let Some(s) = &blob.store {
                if matches!(s.data, Store::Data::Bytes(_)) && s.has_one_ref() {
                    let internal = s.data.as_bytes_mut().to_internal_blob();
                    // PORT NOTE: Zig deref's the store; Arc drop on replace handles it.
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
                unsafe { (*result).global_this = global_this as *const _ as *mut _ };
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
    ) -> jsc::JsTerminatedResult<JSValue> {
        Ok(JSPromise::wrap(global_this, Self::to_action_value, (self, global_this, action)))
    }

    pub fn wrap(
        &mut self,
        promise: jsc::AnyPromise,
        global_this: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> jsc::JsTerminatedResult<()> {
        promise.wrap(global_this, Self::to_action_value, (self, global_this, action))
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
                let str = BunString::init_wtf(core::mem::replace(impl_, bun_str::WTFStringImpl::null()));
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
                let str = BunString::init_wtf(core::mem::replace(impl_, bun_str::WTFStringImpl::null()));
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
                let bytes = ib.to_owned_slice();
                *self = Any::Blob(Blob::default());
                Ok(jsc::ArrayBuffer::from_default_allocator(global, bytes, TYPED_ARRAY_VIEW))
            }
            Any::WTFStringImpl(impl_) => {
                let str = BunString::init_wtf(core::mem::replace(impl_, bun_str::WTFStringImpl::null()));
                *self = Any::Blob(Blob::default());

                let out_bytes = str.to_utf8_without_ref();
                if out_bytes.is_allocated() {
                    return Ok(jsc::ArrayBuffer::from_default_allocator(
                        global,
                        out_bytes.into_owned(),
                        TYPED_ARRAY_VIEW,
                    ));
                }
                Ok(jsc::ArrayBuffer::create(global, out_bytes.slice(), TYPED_ARRAY_VIEW))
            }
        }
    }

    pub fn is_detached(&self) -> bool {
        match self {
            Any::Blob(blob) => blob.is_detached(),
            Any::InternalBlob(ib) => ib.bytes.is_empty(),
            Any::WTFStringImpl(s) => s.length() == 0,
        }
    }

    pub fn store(&self) -> Option<Arc<Store>> {
        if let Any::Blob(b) = self {
            return b.store.clone();
        }
        None
    }

    pub fn content_type(&self) -> &[u8] {
        match self {
            Any::Blob(b) => b.content_type_slice(),
            Any::WTFStringImpl(_) => MimeType::TEXT.value,
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
            Any::WTFStringImpl(s) => s.utf8_slice(),
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
                s.deref();
                *self = Any::Blob(Blob::default());
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Internal (InternalBlob)
// ──────────────────────────────────────────────────────────────────────────

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

    pub fn to_string_owned(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let bytes_without_bom = strings::without_utf8_bom(&self.bytes);
        if let Some(out) = strings::to_utf16_alloc(bytes_without_bom, false, false).unwrap_or(Some(Vec::new())) {
            // TODO(port): Zig used `catch &[_]u16{}` to swallow alloc errors into empty.
            let return_value = ZigString::to_external_u16(out.as_ptr(), out.len(), global_this);
            return_value.ensure_still_alive();
            self.deinit();
            return Ok(return_value);
        } else if bytes_without_bom.len() != self.bytes.len() {
            // If there was a UTF8 BOM, we clone it
            let out = BunString::clone_latin1(&self.bytes[3..]);
            self.deinit();
            return out.to_js(global_this);
        } else {
            let mut str = ZigString::init(&self.to_owned_slice());
            str.mark_global();
            return Ok(str.to_external_value(global_this));
        }
    }

    pub fn to_json(&mut self, global_this: &JSGlobalObject) -> JSValue {
        let str_bytes = ZigString::init(strings::without_utf8_bom(&self.bytes)).with_encoding();
        let json = str_bytes.to_json_object(global_this);
        self.deinit();
        json
    }

    #[inline]
    pub fn slice_const(&self) -> &[u8] {
        &self.bytes
    }

    pub fn deinit(&mut self) {
        self.bytes.clear();
        self.bytes.shrink_to_fit();
    }

    #[inline]
    pub fn slice(&mut self) -> &mut [u8] {
        &mut self.bytes
    }

    pub fn to_owned_slice(&mut self) -> Vec<u8> {
        if self.bytes.is_empty() && self.bytes.capacity() > 0 {
            self.bytes.clear();
            self.bytes.shrink_to_fit();
            return Vec::new();
        }
        core::mem::take(&mut self.bytes)
    }

    pub fn clear_and_free(&mut self) {
        self.bytes.clear();
        self.bytes.shrink_to_fit();
    }

    pub fn content_type(&self) -> &'static [u8] {
        if self.was_string {
            return MimeType::TEXT.value;
        }
        MimeType::OTHER.value
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

impl Inline {
    const REAL_BLOB_SIZE: usize = core::mem::size_of::<Blob>();
    pub type IntSize = u8;
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
        if self.was_string { MimeType::TEXT.value } else { MimeType::OTHER.value }
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
// JSDOMFile__hasInstance
// ──────────────────────────────────────────────────────────────────────────

// TODO(port): callconv(jsc.conv) — emitted via #[bun_jsc::host_call].
#[unsafe(no_mangle)]
pub extern "C" fn JSDOMFile__hasInstance(
    _: JSValue,
    _: &JSGlobalObject,
    value: JSValue,
) -> bool {
    jsc::mark_binding();
    let Some(blob) = value.as_::<Blob>() else { return false };
    blob.is_jsdom_file
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

    fn get_fd_by_opening(&mut self, callback: fn(&mut Self, Fd)) {
        let mut buf = bun_paths::PathBuffer::uninit();
        let path_string = match self.pathlike() {
            PathOrFileDescriptor::Path(p) => p.clone(),
            PathOrFileDescriptor::Fd(_) => unreachable!(),
        };
        let path = path_string.slice_z(&mut buf);

        #[cfg(windows)]
        {
            // TODO(port): libuv async open with WrappedCallback (Zig lines 4918-4957).
            // Stores `self` in req.data, on completion sets opened_fd or errno+system_error.
            unimplemented!("FileOpener::get_fd_by_opening (windows libuv path)");
        }

        #[cfg(not(windows))]
        loop {
            match bun_sys::open(
                path,
                Self::OPEN_FLAGS | Self::OPENER_FLAGS,
                node::fs::DEFAULT_PERMISSION,
            ) {
                bun_sys::Result::Ok(fd) => {
                    self.set_opened_fd(fd);
                    break;
                }
                bun_sys::Result::Err(err) => {
                    // TODO(port): @hasField(This, "mkdirp_if_not_exists") — optional
                    // mkdir-retry hook via MkdirpTarget. Phase B: add a default-noop method.
                    if err.errno == bun_sys::E::NOENT as _ {
                        // mkdir_if_not_exists(self, err, path, path_string.slice()) → Retry
                        // (only if Self: MkdirpTarget)
                    }
                    self.set_errno(bun_core::errno_to_zig_err(err.errno));
                    self.set_system_error(err.with_path(path_string.slice()).to_system_error());
                    self.set_opened_fd(bun_sys::INVALID_FD);
                    break;
                }
            }
        }

        callback(self, self.opened_fd());
    }

    fn get_fd(&mut self, callback: fn(&mut Self, Fd)) {
        if self.opened_fd() != bun_sys::INVALID_FD {
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
    fn task(&mut self) -> &mut bun_threading::WorkPoolTask;
    fn update(&mut self);
    #[cfg(windows)]
    fn loop_(&self) -> *mut bun_uv_sys::uv_loop_t;

    fn schedule_close(request: &mut bun_io::Request) -> bun_io::Action {
        // SAFETY: request is the io_request field of Self.
        let this: &mut Self = unsafe {
            &mut *(request as *mut _ as *mut u8)
                .sub(core::mem::offset_of!(Self, io_request))
                .cast::<Self>()
        };
        bun_io::Action::Close(bun_io::CloseAction {
            ctx: this as *mut Self as *mut c_void,
            fd: this.opened_fd(),
            on_done: Self::on_io_request_closed as _,
            poll: this.io_poll(),
            tag: Self::IO_TAG,
        })
    }

    fn on_io_request_closed(this: &mut Self) {
        this.io_poll().flags.remove(bun_aio::PollFlags::WasEverRegistered);
        *this.task() = bun_threading::WorkPoolTask { callback: Self::on_close_io_request };
        bun_threading::WorkPool::schedule(this.task());
    }

    fn on_close_io_request(task: &mut bun_threading::WorkPoolTask) {
        debug!("onCloseIORequest()");
        // SAFETY: task is the `task` field of Self.
        let this: &mut Self = unsafe {
            &mut *(task as *mut _ as *mut u8)
                .sub(core::mem::offset_of!(Self, task))
                .cast::<Self>()
        };
        this.set_close_after_io(false);
        this.update();
    }

    fn do_close(&mut self, is_allowed_to_close_fd: bool) -> bool {
        if let Some(io_request) = self.io_request() {
            if self.close_after_io() {
                self.state()
                    .store(ClosingState::Closing as u8, core::sync::atomic::Ordering::SeqCst);
                // TODO(port): @atomicStore on the io_request.callback fn pointer.
                io_request.callback = Self::schedule_close;
                if !io_request.scheduled {
                    bun_io::Loop::get().schedule(io_request);
                }
                return true;
            }
        }

        if is_allowed_to_close_fd
            && self.opened_fd() != bun_sys::INVALID_FD
            && self.opened_fd().stdio_tag().is_none()
        {
            #[cfg(windows)]
            bun_aio::Closer::close(self.opened_fd(), self.loop_());
            #[cfg(not(windows))]
            let _ = self.opened_fd().close_allowing_bad_file_descriptor(None);
            self.set_opened_fd(bun_sys::INVALID_FD);
        }

        false
    }
}

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
        self.ref_count.raw_value() != 0
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
    if self_.ref_count.decrement() == bun_ptr::DecrementResult::ShouldDestroy {
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
//   todos:      46
//   notes:      Huge JSC class; comptime-fn dispatch (do_read_file/lifetime_wrap), Store intrusive-vs-Arc semantics (transfer/ref), content_type dual-ownership, S3 locked-body upload paths, FileSink open branches, and Windows libuv FileOpener all need Phase B attention.
// ──────────────────────────────────────────────────────────────────────────
