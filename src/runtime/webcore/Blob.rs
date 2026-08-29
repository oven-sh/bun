//! The JS `Blob` class can be backed by different forms (in `Blob::Store`), which
//! represent different sources of Blob. For example, `Bun.file()` returns Blob
//! objects that reference the filesystem (`Blob::Store::File`). This is how
//! operations like writing `Store::File` to another `Store::File` knows to use a
//! basic file copy instead of a naive read write loop.

use core::cell::Cell;
use core::ops::Range;

use bun_jsc::JsCell;

use crate::webcore::jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSPromise, JSValue, JsResult, VirtualMachine,
};
use bun_core::Output;
use bun_core::{EncodedSlice, String as BunString, Utf8Bytes, WTFStringImplExt as _, strings};
use bun_http_types::MimeType::MimeType;
use bun_jsc::{EncodedSliceJsc as _, StringJsc as _, bun_string_jsc};
use bun_ptr::RefPtr;
use bun_sys::{self, Fd};

use crate::webcore::node_types::{PathLike, PathOrBlob, PathOrFileDescriptor};
use crate::webcore::s3 as S3;
use crate::webcore::{self, Lifetime, ReadableStream, Request, Response, streams};

bun_core::define_scoped_log!(debug, Blob, visible);

/// `bunVM().transpiler.env.getHttpProxy(true, null, null)?.href` as an owned
/// buffer. Owned (not borrowed) because the env loader's `URL<'_>` ties the
/// `href` slice to a `&mut Loader` borrow that we cannot keep open across the
/// S3 request setup.
#[inline]
fn http_proxy_href(global: &JSGlobalObject) -> Option<Vec<u8>> {
    // `Transpiler::env_mut` is the safe accessor for the process-singleton
    // dotenv loader (initialised before any JS runs).
    global
        .bun_vm()
        .as_mut()
        .transpiler
        .env_mut()
        .get_http_proxy(true, None, None)
        .map(|p| p.href.to_vec())
}

#[path = "blob/Store.rs"]
pub mod store;
use crate::node::types::{PathLikeExt as _, PathOrFdExt as _};
pub use store::Store;
use store::{BytesExt as _, FileExt as _, S3Ext as _, StoreExt as _};

#[path = "blob/copy_file.rs"]
pub mod copy_file;
#[path = "blob/read_file.rs"]
pub mod read_file;
#[path = "blob/write_file.rs"]
pub mod write_file;

/// The bytes a `to_*_with_bytes` conversion consumes: a buffer it now owns (a
/// finished file read), or a window of this blob's store bytes to clone,
/// share or transfer per its [`Lifetime`].
pub enum SourceBytes {
    Temporary(Box<[u8]>),
    Store(Range<usize>, Lifetime),
}

impl SourceBytes {
    /// The lifetime this variant is delivered under.
    #[inline]
    pub fn lifetime(&self) -> Lifetime {
        match self {
            SourceBytes::Temporary(_) => Lifetime::Temporary,
            SourceBytes::Store(_, lifetime) => *lifetime,
        }
    }
}

/// WHATWG File API §3.1: a Blob/File `type` is only used when every character
/// is in the range U+0020 to U+007E; otherwise it is treated as the empty
/// string. Stricter than `is_all_ascii`: also rejects control characters such
/// as CR/LF, which would otherwise be stored in `content_type` and written
/// verbatim into outgoing HTTP headers.
pub(crate) fn is_valid_blob_type(slice: &[u8]) -> bool {
    slice.iter().all(|&c| matches!(c, 0x20..=0x7E))
}

/// Result delivered to `ReadBytesHandler::on_read_bytes`.
pub enum ReadBytesResult {
    /// global-allocator-owned by the callback.
    Ok(Vec<u8>),
    Err(Box<bun_jsc::SystemError>),
}

/// Handler trait for `read_bytes_to_handler` — the body only requires
/// `on_read_bytes`.
pub trait ReadBytesHandler {
    /// Invoked exactly once, on the JS thread, with the handler given to
    /// `read_bytes_to_handler`. It may settle promises: an exception it
    /// leaves pending is the `Err`.
    fn on_read_bytes(self: Box<Self>, result: ReadBytesResult) -> JsResult<()>;
}

// ──────────────────────────────────────────────────────────────────────────
// Blob — single nominal definition lives in `bun_jsc::webcore_types`.
// This crate layers behaviour via the `BlobExt` extension trait below.
// ──────────────────────────────────────────────────────────────────────────

pub use bun_jsc::webcore_types::{Blob, BlobContentType, ClosingState, MAX_SIZE, SizeType};

/// 1: Initial
/// 2: Added byte for whether it's a dom file, length and bytes for `stored_name`,
///    and f64 for `last_modified`.
/// 3: Added File name serialization for File objects (when is_jsdom_file is true)
/// 4: Added the blob's `size` to file-backed stores so a sliced Bun.file()
///    keeps its window's end across structuredClone/postMessage
const SERIALIZATION_VERSION: u8 = 4;

pub use bun_jsc::generated::JSBlob as js;

// ──────────────────────────────────────────────────────────────────────────

// is_all_ascii: canonical impl lives later in this file (pub). Duplicate
// private helper removed here to fix E0592.

// ──────────────────────────────────────────────────────────────────────────
// BlobExt — `bun_runtime`-tier behaviour layered on the `bun_jsc` data type.
// Inherent methods (`new`/`init`/`shared_view`/`dupe`/`detach`/`deinit`/…)
// live on `bun_jsc::webcore_types::Blob`; everything that touches the event
// loop / S3 / fs / `VirtualMachine` is here.
// ──────────────────────────────────────────────────────────────────────────

#[allow(non_snake_case, clippy::too_many_arguments)]
pub trait BlobExt {
    fn get_form_data_encoding(&self) -> Option<Box<bun_core::form_data::AsyncFormData>>;
    // `has_content_type_from_user`/`content_type_or_mime_type`/`is_s3`/
    // `needs_to_read_file`/`get_file_name`: data-only predicates, hoisted to
    // inherent `impl Blob` in `bun_jsc::webcore_types` (LAYERING).
    fn do_read_from_s3<F: read_file::ReadFileToJs>(
        &self,
        global: &JSGlobalObject,
    ) -> JsResult<JSValue>;
    fn do_read_file<F: read_file::ReadFileToJs + 'static>(
        &self,
        global: &JSGlobalObject,
    ) -> JSValue;
    fn read_bytes_to_handler<H: ReadBytesHandler + 'static>(
        &self,
        handler: Box<H>,
        global: &JSGlobalObject,
    ) -> JsResult<()>;
    fn do_image(_this: &Self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue>
    where
        Self: Sized;
    fn do_read_file_internal(&self, on_done: read_file::ReadFileOnDone, global: &JSGlobalObject);
    fn get_content_type(&self) -> Option<Utf8Bytes<'_>>;
    fn _on_structured_clone_serialize<W: bun_io::Write>(&self, writer: &mut W)
    -> crate::Result<()>;
    fn on_structured_clone_serialize(
        &self,
        _global_this: &JSGlobalObject,
        writer: &mut jsc::host_fn::StructuredCloneWriter,
    );
    /// `Ok(None)`: the bytes are not a valid record (the deserializer reports its usual error).
    fn on_structured_clone_deserialize(
        global_this: &JSGlobalObject,
        reader: &mut jsc::host_fn::StructuredCloneReader<'_>,
    ) -> JsResult<Option<JSValue>>
    where
        Self: Sized;
    fn from_url_search_params(
        global_this: &JSGlobalObject,
        search_params: &mut jsc::URLSearchParams,
    ) -> Blob
    where
        Self: Sized;
    fn from_dom_form_data(global_this: &JSGlobalObject, form_data: &mut jsc::DOMFormData) -> Blob
    where
        Self: Sized;
    fn content_type(&self) -> &[u8];
    fn is_detached(&self) -> bool;
    fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> core::fmt::Result
    where
        F: jsc::ConsoleFormatter,
        W: core::fmt::Write;
    fn get_stream(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue>;
    fn get_stream_with_cache(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        get_cached: fn(JSValue) -> Option<JSValue>,
        set_cached: fn(JSValue, &JSGlobalObject, JSValue),
    ) -> JsResult<JSValue>;
    fn get_text(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue>;
    fn get_text_clone(&self, global_object: &JSGlobalObject) -> JsResult<JSValue>;
    fn get_json(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue>;
    fn get_json_share(&self, global_object: &JSGlobalObject) -> JsResult<JSValue>;
    fn get_array_buffer_clone(&self, global_this: &JSGlobalObject) -> JsResult<JSValue>;
    fn get_array_buffer(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue>;
    fn get_bytes_clone(&self, global_this: &JSGlobalObject) -> JsResult<JSValue>;
    fn get_bytes(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue>;
    fn get_form_data(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue>;
    fn get_exists_sync(&self) -> JSValue;
    fn do_write(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue>;
    fn do_unlink(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue>;
    fn get_exists(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue>;
    fn pipe_readable_stream_to_blob(
        &self,
        global_this: &JSGlobalObject,
        readable_stream: ReadableStream,
        options: &WriteFileOptions,
    ) -> JsResult<JSValue>;
    fn get_writer(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue>;
    fn get_slice_from(
        &self,
        global_this: &JSGlobalObject,
        relative_start: i64,
        relative_end: i64,
        content_type: BlobContentType,
    ) -> JSValue;
    fn get_slice(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue>;
    fn get_mime_type_or_content_type(&self) -> Option<MimeType>;
    fn get_type(&self, global_this: &JSGlobalObject) -> JSValue;
    fn get_name_string(&self) -> Option<&BunString>;
    fn get_name(&self, _: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue>;
    fn set_name(
        &self,
        js_this: JSValue,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()>;
    fn get_loader(&self, jsc_vm: &VirtualMachine) -> Option<bun_ast::Loader>;
    fn get_last_modified(&self, _: &JSGlobalObject) -> JSValue;
    fn get_size_for_bindings(&self) -> u64;
    fn get_stat(&self, global_this: &JSGlobalObject, callback: &CallFrame) -> JsResult<JSValue>;
    fn get_size(&self, _: &JSGlobalObject) -> JSValue;
    fn resolve_size(&self);
    fn resolved_size(&self) -> (SizeType, SizeType);
    fn constructor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<*mut Blob>
    where
        Self: Sized;
    fn init_with_all_ascii(
        bytes: Vec<u8>,
        global_this: &JSGlobalObject,
        is_all_ascii: bool,
    ) -> Blob
    where
        Self: Sized;
    fn create_with_bytes_and_allocator(
        bytes: Vec<u8>,
        global_this: &JSGlobalObject,
        was_string: bool,
    ) -> Blob
    where
        Self: Sized;
    fn try_create(
        bytes_: &[u8],
        global_this: &JSGlobalObject,
        was_string: bool,
    ) -> Result<Blob, bun_alloc::AllocError>
    where
        Self: Sized;
    fn create(bytes_: &[u8], global_this: &JSGlobalObject, was_string: bool) -> Blob
    where
        Self: Sized;
    fn transfer(&self);
    fn shared_view_range(&self) -> Range<usize>;
    fn source_slice<'a>(&'a self, bytes: &'a SourceBytes) -> &'a [u8];
    fn set_is_ascii_flag(&self, is_all_ascii: bool);
    fn to_string_with_bytes(
        &self,
        global: &JSGlobalObject,
        bytes: SourceBytes,
    ) -> JsResult<JSValue>;
    fn to_string_transfer(&self, global: &JSGlobalObject) -> JsResult<JSValue>;
    fn to_string(&self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue>;
    fn to_json(&self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue>;
    fn to_json_with_bytes(&self, global: &JSGlobalObject, bytes: SourceBytes) -> JsResult<JSValue>;
    fn to_form_data_with_bytes(&self, global: &JSGlobalObject, bytes: SourceBytes) -> JSValue;
    fn to_array_buffer_with_bytes(
        &self,
        global: &JSGlobalObject,
        bytes: SourceBytes,
    ) -> JsResult<JSValue>;
    fn to_uint8_array_with_bytes(
        &self,
        global: &JSGlobalObject,
        bytes: SourceBytes,
    ) -> JsResult<JSValue>;
    fn to_array_buffer_view_with_bytes<const TYPED_ARRAY_VIEW: jsc::JSType>(
        &self,
        global: &JSGlobalObject,
        bytes: SourceBytes,
    ) -> JsResult<JSValue>;
    fn to_array_buffer(&self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue>;
    fn to_uint8_array(&self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue>;
    fn to_array_buffer_view<const TYPED_ARRAY_VIEW: jsc::JSType>(
        &self,
        global: &JSGlobalObject,
        lifetime: Lifetime,
    ) -> JsResult<JSValue>;
    fn to_form_data(&self, global: &JSGlobalObject, _lifetime: Lifetime) -> JsResult<JSValue>;
    fn get<const MOVE: bool, const REQUIRE_ARRAY: bool>(
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<Blob>
    where
        Self: Sized;
    fn from_js_move(global: &JSGlobalObject, arg: JSValue) -> JsResult<Blob>
    where
        Self: Sized;
    fn from_js_clone(global: &JSGlobalObject, arg: JSValue) -> JsResult<Blob>
    where
        Self: Sized;
    fn from_js_clone_optional_array(global: &JSGlobalObject, arg: JSValue) -> JsResult<Blob>
    where
        Self: Sized;
    fn from_js_without_defer_gc<const MOVE: bool, const REQUIRE_ARRAY: bool>(
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<Blob>
    where
        Self: Sized;
    fn calculate_estimated_byte_size(&self);
    fn estimated_size(&self) -> usize;
    fn find_or_create_file_from_path(
        path_or_fd: &mut PathOrFileDescriptor<'static>,
        global_this: &JSGlobalObject,
        check_s3: bool,
    ) -> Blob
    where
        Self: Sized;
    fn is_all_ascii(&self) -> Option<bool>;
}

#[allow(non_snake_case, clippy::too_many_arguments)]
impl BlobExt for Blob {
    fn get_form_data_encoding(&self) -> Option<Box<bun_core::form_data::AsyncFormData>> {
        let content_type_slice = self.get_content_type()?;
        let encoding = bun_core::form_data::Encoding::get(content_type_slice.slice())?;
        // drop content_type_slice via Drop
        Some(bun_core::form_data::AsyncFormData::init(encoding))
    }

    /// `Function` is the `*WithBytes` callback.
    /// Modeled as a [`read_file::ReadFileToJs`] impl so the wrapped fn-pointer
    /// monomorphizes per call site without `fn_traits`.
    fn do_read_from_s3<F: read_file::ReadFileToJs>(
        &self,
        global: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        debug!("doReadFromS3");
        // Route through `to_js_host_call` so the exception scope is asserted.
        fn wrapped<F: read_file::ReadFileToJs>(
            b: &Blob,
            g: bun_ptr::BackRef<JSGlobalObject>,
            bytes: Range<usize>,
        ) -> JSValue {
            let g = g.get();
            jsc::host_fn::to_js_host_call(g, || {
                F::call(b, g, SourceBytes::Store(bytes, Lifetime::Clone))
            })
        }
        S3BlobDownloadTask::init(global, self, wrapped::<F>)
    }

    fn do_read_file<F: read_file::ReadFileToJs + 'static>(
        &self,
        global: &JSGlobalObject,
    ) -> JSValue {
        debug!("doReadFile");

        // The callback may read context.content_type (e.g. to_form_data_with_bytes),
        // which is heap-owned by the source JS Blob and freed on finalize(). Take
        // an owning dupe so the handler outliving the source can't dangle.
        let handler = read_file::NewReadFileHandler::<F>::new(self.dupe(), global);
        let promise_value = handler.promise.value();
        promise_value.ensure_still_alive();
        self.do_read_file_internal(read_file::ReadFileOnDone::new(handler), global);
        debug!("doReadFile: read_file_task scheduled");
        promise_value
    }
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
    ///
    /// Every store kind hands `handler` to exactly one `on_read_bytes` call:
    /// in-memory stores synchronously below, file stores from the read's
    /// `run`/`cancel` completion (exactly one of which fires), S3 from the
    /// download callback (which `execute_simple_s3_request` also invokes
    /// synchronously when it cannot start the request). An `Err` here is an
    /// exception a synchronous delivery left pending, so the handler has
    /// already been consumed in that case too.
    fn read_bytes_to_handler<H: ReadBytesHandler + 'static>(
        &self,
        handler: Box<H>,
        global: &JSGlobalObject,
    ) -> JsResult<()> {
        if self.needs_to_read_file() {
            struct Adapter<H>(Box<H>);
            impl<H: ReadBytesHandler> read_file::ReadFileCompletion for Adapter<H> {
                fn run(self: Box<Self>, r: read_file::ReadFileResultType) -> JsResult<()> {
                    let result = match r {
                        read_file::ReadFileResultType::Result(b) => {
                            ReadBytesResult::Ok(b.buf.into_vec())
                        }
                        read_file::ReadFileResultType::Err(e) => ReadBytesResult::Err(Box::new(e)),
                    };
                    self.0.on_read_bytes(result)
                }
                fn cancel(self: Box<Self>) {
                    let err = jsc::SystemError {
                        code: BunString::static_("ECANCELED"),
                        message: BunString::static_(
                            "The file read did not complete before its thread stopped",
                        ),
                        syscall: BunString::static_("read"),
                        ..Default::default()
                    };
                    // The read's thread stopped; this runs at teardown (the unrun job's release,
                    // or `JobList::release_all_js`), where what the handler leaves stays pending.
                    let _ = self.0.on_read_bytes(ReadBytesResult::Err(Box::new(err)));
                }
            }
            self.do_read_file_internal(read_file::ReadFileOnDone::new(Adapter(handler)), global);
            return Ok(());
        }
        if self.is_s3() {
            struct Task<H> {
                handler: Box<H>,
                blob: Blob, // dupe for store ref + offset/size
                poll: bun_io::KeepAlive,
            }
            impl<H: ReadBytesHandler> Task<H> {
                fn done(self, r: ReadBytesResult) -> JsResult<()> {
                    let Self {
                        handler,
                        mut blob,
                        mut poll,
                    } = self;
                    poll.unref(bun_io::js_vm_ctx());
                    blob.deinit();
                    handler.on_read_bytes(r)
                }
                fn cb(self, result: crate::webcore::__s3_client::S3DownloadResult) -> JsResult<()> {
                    match result {
                        // `body` is owned by us (simple_request.rs); take the Vec's items as-is.
                        crate::webcore::__s3_client::S3DownloadResult::Success(response) => {
                            self.done(ReadBytesResult::Ok(response.body.list))
                        }
                        // S3Error has its own JS-error builder; flatten to a
                        // SystemError so the callback has one shape to handle.
                        crate::webcore::__s3_client::S3DownloadResult::NotFound(e)
                        | crate::webcore::__s3_client::S3DownloadResult::Failure(e) => {
                            // reshaped for borrowck — `done` moves `self`, so
                            // build the SystemError (cloning the path out of
                            // `self.blob.store`) before the call.
                            let err = bun_jsc::SystemError {
                                code: BunString::clone_utf8(e.code),
                                message: BunString::clone_utf8(e.message),
                                path: BunString::clone_utf8(
                                    self.blob.store().and_then(|s| s.get_path()).unwrap_or(b""),
                                ),
                                syscall: BunString::static_("fetch"),
                                ..Default::default()
                            };
                            self.done(ReadBytesResult::Err(Box::new(err)))
                        }
                    }
                }
            }
            let mut t = Task::<H> {
                handler,
                blob: self.dupe(),
                poll: bun_io::KeepAlive::default(),
            };
            t.poll.ref_(bun_io::js_vm_ctx());
            let proxy = http_proxy_href(global);
            // The task moves into the download's completion, so read what the
            // request needs out of its blob's store (a fresh +1 ref) first.
            let store = t.blob.store().expect("infallible: store present").clone();
            let s3 = store.data.as_s3();
            let cred = s3.get_credentials().clone();
            let path = s3.path();
            let payer = s3.request_payer;
            let cb = Box::new(move |r: crate::webcore::__s3_client::S3DownloadResult<'_>| t.cb(r));
            if self.offset.get() > 0 || self.size.get() != MAX_SIZE {
                let len: Option<usize> = if self.size.get() != MAX_SIZE {
                    Some(self.size.get() as usize)
                } else {
                    None
                };
                crate::webcore::__s3_client::download_slice(
                    &cred,
                    path,
                    self.offset.get() as usize,
                    len,
                    cb,
                    proxy.as_deref(),
                    payer,
                )?;
            } else {
                crate::webcore::__s3_client::download(&cred, path, cb, proxy.as_deref(), payer)?;
            }
            return Ok(());
        }
        // In-memory or detached.
        let view = self.shared_view();
        let owned = view.to_vec();
        handler.on_read_bytes(ReadBytesResult::Ok(owned))
    }

    /// `Bun.file("…").image(opts?)` ≡ `new Bun.Image(this, opts?)`. Lives here so
    /// the proto entry covers Blob/BunFile/S3File in one place; the actual
    /// construction is `Image::from_blob_js` so Blob.rs doesn't grow image
    /// knowledge.
    fn do_image(_this: &Self, global: &JSGlobalObject, cf: &CallFrame) -> JsResult<JSValue> {
        Image::from_blob_js(global, cf.this(), cf.argument(0))
    }

    fn do_read_file_internal(&self, on_done: read_file::ReadFileOnDone, global: &JSGlobalObject) {
        #[cfg(windows)]
        {
            return read_file::ReadFileUV::start(
                global.bun_vm().event_loop_shared(),
                self.store().expect("infallible: store present").clone(),
                self.offset.get(),
                self.size.get(),
                on_done,
            );
        }
        #[cfg(not(windows))]
        {
            let file_read = read_file::ReadFile::create(
                self.store().expect("infallible: store present").clone(),
                self.offset.get(),
                self.size.get(),
            );
            read_file::ReadFile::schedule(file_read, on_done, global);
        }
    }
    fn get_content_type(&self) -> Option<Utf8Bytes<'_>> {
        let ct = self.content_type_slice();
        if !ct.is_empty() {
            return Some(Utf8Bytes::Borrowed(ct));
        }
        None
    }
    fn _on_structured_clone_serialize<W: bun_io::Write>(
        &self,
        writer: &mut W,
    ) -> crate::Result<()> {
        let is_memory_backed = if let Some(store) = self.store.get() {
            matches!(store.data, store::Data::Bytes(_))
        } else {
            false
        };

        writer.write_int_le::<u8>(SERIALIZATION_VERSION)?;
        writer.write_int_le::<u64>(if is_memory_backed {
            0
        } else {
            self.offset.get()
        })?;

        let ct = self.content_type_slice();
        writer.write_int_le::<u32>(ct.len() as u32)?;
        writer.write_all(ct)?;
        writer.write_int_le::<u8>(self.content_type_was_set.get() as u8)?;

        let store_tag: store::SerializeTag = if let Some(store) = self.store.get() {
            if matches!(store.data, store::Data::File(_)) {
                store::SerializeTag::File
            } else {
                store::SerializeTag::Bytes
            }
        } else {
            store::SerializeTag::Empty
        };

        writer.write_int_le::<u8>(store_tag as u8)?;

        if let Some(store) = self.store.get() {
            if let store::Data::Bytes(bytes) = &store.data {
                let view = self.shared_view();
                writer.write_int_le::<u32>(view.len() as u32)?;
                writer.write_all(view)?;

                let stored_name = &bytes.stored_name[..];
                writer.write_int_le::<u32>(stored_name.len() as u32)?;
                writer.write_all(stored_name)?;
            } else {
                // Version 4: a file-backed slice's window end. Written before
                // resolve_size() so an unresolved blob stays MAX_SIZE (unknown)
                // on the wire and the receiver stats it locally, like v3.
                writer.write_int_le::<u64>(self.size.get())?;
                self.resolve_size();
                store.serialize(writer)?;
            }
        }

        writer.write_int_le::<u8>(self.is_jsdom_file.get() as u8)?;
        write_float::<W>(self.last_modified.get(), writer)?;

        // Serialize File name if this is a File object
        if self.is_jsdom_file.get() {
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

    fn on_structured_clone_serialize(
        &self,
        _global_this: &JSGlobalObject,
        writer: &mut jsc::host_fn::StructuredCloneWriter,
    ) {
        let _ = self._on_structured_clone_serialize(writer);
    }

    fn on_structured_clone_deserialize(
        global_this: &JSGlobalObject,
        reader: &mut jsc::host_fn::StructuredCloneReader<'_>,
    ) -> JsResult<Option<JSValue>> {
        match on_structured_clone_deserialize(global_this, reader) {
            Ok(v) => Ok(Some(v)),
            Err(e) if e.name() == "OutOfMemory" => Err(global_this.throw_out_of_memory()),
            Err(_) => Ok(None),
        }
    }
    fn from_url_search_params(
        global_this: &JSGlobalObject,
        search_params: &mut jsc::URLSearchParams,
    ) -> Blob {
        let mut converter = URLSearchParamsConverter { buf: Vec::new() };
        search_params.to_string(&mut converter, URLSearchParamsConverter::convert);
        let store = RefPtr::new(Store {
            data: store::Data::Bytes(store::Bytes::init(converter.buf)),
            mime_type: bun_http_types::MimeType::Compact::from(
                // The bare tag, *without* `;charset=UTF-8` (charset promotion is
                // Compact::to_mime_type's job, applied when read).
                bun_http_types::MimeType::Table::from_mime_literal(
                    "application/x-www-form-urlencoded",
                ),
            )
            .to_mime_type(),
            ref_count: bun_ptr::ThreadSafeRefCount::init(),
            is_all_ascii: store::IsAllAscii::default(),
        });
        let content_type = BlobContentType::from_mime(&store.mime_type);

        let blob = Blob::init_with_store(store, global_this);
        blob.content_type.set(content_type);
        blob.content_type_was_set.set(true);
        blob
    }

    fn from_dom_form_data(global_this: &JSGlobalObject, form_data: &mut jsc::DOMFormData) -> Blob {
        // "----WebKitFormBoundary" (22 bytes) + 32 lowercase-hex chars of a fresh UUID.
        const BOUNDARY_PREFIX: &[u8; 22] = b"----WebKitFormBoundary";
        let mut boundary_buf = [0u8; BOUNDARY_PREFIX.len() + 32];
        let boundary: &[u8] = {
            let random = global_this.bun_vm().as_mut().rare_data().next_uuid().bytes;
            boundary_buf[..BOUNDARY_PREFIX.len()].copy_from_slice(BOUNDARY_PREFIX);
            bun_core::fmt::bytes_to_hex_lower(&random, &mut boundary_buf[BOUNDARY_PREFIX.len()..]);
            &boundary_buf
        };

        let mut context = FormDataContext {
            joiner: Parts::default(),
            boundary,
            failed: false,
            global_this,
        };
        // Size the node list up front: a file entry pushes at most 13 slices, a
        // string entry 8, plus 3 for the closing boundary.
        context.joiner.reserve(form_data.count() * 13 + 3);

        form_data.for_each(|name, entry| context.on_entry(name, entry));
        if context.failed {
            // Drop the joiner (Drop runs StringJoiner::deinit) so every
            // heap-owned slice already pushed — escaped names, non-ASCII
            // conversions, NodeFS read_file result buffers — is freed.
            drop(context.joiner);
            return Blob::init_empty(global_this);
        }

        context.joiner.push_static(b"--");
        context.joiner.push_static(boundary);
        context.joiner.push_static(b"--\r\n");

        let store = Store::init(context.joiner.done());
        let blob = Blob::init_with_store(store, global_this);
        const CONTENT_TYPE_PREFIX: &[u8] = b"multipart/form-data; boundary=";
        let mut ct = Vec::with_capacity(CONTENT_TYPE_PREFIX.len() + boundary.len());
        ct.extend_from_slice(CONTENT_TYPE_PREFIX);
        ct.extend_from_slice(boundary);
        blob.content_type
            .set(BlobContentType::Owned(std::sync::Arc::from(ct)));
        blob.content_type_was_set.set(true);

        blob
    }

    fn content_type(&self) -> &[u8] {
        self.content_type_slice()
    }

    fn is_detached(&self) -> bool {
        self.store.get().is_none()
    }
    fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
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
            if self.size.get() > 0 {
                if self.is_jsdom_file.get() {
                    bun_core::write_pretty!(
                        writer,
                        ENABLE_ANSI_COLORS,
                        "<d>[<r>File<r> detached<d>]<r>"
                    )?;
                } else {
                    bun_core::write_pretty!(
                        writer,
                        ENABLE_ANSI_COLORS,
                        "<d>[<r>Blob<r> detached<d>]<r>"
                    )?;
                }
                return Ok(());
            }
            write_format_for_size::<W, ENABLE_ANSI_COLORS>(self.is_jsdom_file.get(), 0, writer)?;
        } else {
            let content_type = self.content_type_slice();
            let offset = self.offset.get();
            let store = self.store().expect("infallible: store present");
            match Store::data_mut(store) {
                store::Data::S3(s3) => {
                    S3File::write_format::<F, W, ENABLE_ANSI_COLORS>(
                        s3,
                        formatter,
                        writer,
                        content_type,
                        offset as u64,
                    )
                    .map_err(|_| core::fmt::Error)?;
                }
                store::Data::File(file) => {
                    bun_core::write_pretty!(writer, ENABLE_ANSI_COLORS, "<r>FileRef<r>")?;
                    match &file.pathlike {
                        PathOrFileDescriptor::Path(path) => {
                            bun_core::write_pretty!(
                                writer,
                                ENABLE_ANSI_COLORS,
                                " (<green>\"{s}\"<r>)<r>",
                                bstr::BStr::new(path.slice()),
                            )?;
                        }
                        PathOrFileDescriptor::Fd(fd) => {
                            #[cfg(windows)]
                            match fd.decode_windows() {
                                bun_sys::fd::DecodeWindows::Uv(uv_file) => {
                                    bun_core::write_pretty!(
                                        writer,
                                        ENABLE_ANSI_COLORS,
                                        " (<r>fd<d>:<r> <yellow>{d}<r>)<r>",
                                        uv_file,
                                    )?;
                                }
                                bun_sys::fd::DecodeWindows::Windows(handle) => {
                                    if cfg!(debug_assertions) {
                                        panic!("this shouldn't be reachable.");
                                    }
                                    // pretty_fmt! doesn't rewrite `{x}`,
                                    // so use the Rust hex spec inline.
                                    bun_core::write_pretty!(
                                        writer,
                                        ENABLE_ANSI_COLORS,
                                        " (<r>fd<d>:<r> <yellow>0x{:x}<r>)<r>",
                                        handle as usize,
                                    )?;
                                }
                            }
                            #[cfg(not(windows))]
                            bun_core::write_pretty!(
                                writer,
                                ENABLE_ANSI_COLORS,
                                " (<r>fd<d>:<r> <yellow>{d}<r>)<r>",
                                fd.native(),
                            )?;
                        }
                    }
                }
                store::Data::Bytes(_) => {
                    write_format_for_size::<W, ENABLE_ANSI_COLORS>(
                        self.is_jsdom_file.get(),
                        self.size.get() as usize,
                        writer,
                    )?;
                }
            }
        }

        let show_name = (self.is_jsdom_file.get() && self.get_name_string().is_some())
            || (!self.name.get().is_empty()
                && self.store.get().is_some()
                && matches!(
                    self.store().expect("infallible: store present").data,
                    store::Data::Bytes(_)
                ));
        if !self.is_s3()
            && (!self.content_type_slice().is_empty()
                || self.offset.get() > 0
                || show_name
                || self.last_modified.get() != 0.0)
        {
            writer.write_str(" {\n")?;
            {
                formatter.indent_inc();

                if show_name {
                    formatter.write_indent(writer)?;
                    bun_core::write_pretty!(
                        writer,
                        ENABLE_ANSI_COLORS,
                        "name<d>:<r> <green>\"{f}\"<r>",
                        self.get_name_string().unwrap_or(&BunString::EMPTY),
                    )?;
                    if !self.content_type_slice().is_empty()
                        || self.offset.get() > 0
                        || self.last_modified.get() != 0.0
                    {
                        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                    }
                    writer.write_str("\n")?;
                }

                if !self.content_type_slice().is_empty() {
                    formatter.write_indent(writer)?;
                    bun_core::write_pretty!(
                        writer,
                        ENABLE_ANSI_COLORS,
                        "type<d>:<r> <green>\"{s}\"<r>",
                        bstr::BStr::new(self.content_type_slice()),
                    )?;
                    if self.offset.get() > 0 || self.last_modified.get() != 0.0 {
                        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                    }
                    writer.write_str("\n")?;
                }

                if self.offset.get() > 0 {
                    formatter.write_indent(writer)?;
                    bun_core::write_pretty!(
                        writer,
                        ENABLE_ANSI_COLORS,
                        "offset<d>:<r> <yellow>{d}<r>\n",
                        self.offset.get(),
                    )?;
                    if self.last_modified.get() != 0.0 {
                        formatter.print_comma::<W, ENABLE_ANSI_COLORS>(writer)?;
                    }
                    writer.write_str("\n")?;
                }

                if self.last_modified.get() != 0.0 {
                    formatter.write_indent(writer)?;
                    bun_core::write_pretty!(
                        writer,
                        ENABLE_ANSI_COLORS,
                        "lastModified<d>:<r> <yellow>{d}<r>\n",
                        self.last_modified.get(),
                    )?;
                }

                formatter.indent_dec();
            }
            formatter.write_indent(writer)?;
            writer.write_str("}")?;
        }
        Ok(())
    }
    fn get_stream(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self.get_stream_with_cache(
            global_this,
            callframe,
            bun_jsc::generated::JSBlob::stream_get_cached,
            bun_jsc::generated::JSBlob::stream_set_cached,
        )
    }

    /// Shared body of `.stream()` for every class whose receiver wraps a
    /// `Blob` (`Blob` itself and `BuildArtifact`). `callframe.this()` is that
    /// receiver, so its cached-stream slot accessors must come from the caller.
    fn get_stream_with_cache(
        &self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
        get_cached: fn(JSValue) -> Option<JSValue>,
        set_cached: fn(JSValue, &JSGlobalObject, JSValue),
    ) -> JsResult<JSValue> {
        let this_value = callframe.this();
        if let Some(cached) = get_cached(this_value) {
            return Ok(cached);
        }
        let mut recommended_chunk_size: SizeType = 0;
        let recommended_chunk_size_value = callframe.argument(0);
        if !recommended_chunk_size_value.is_undefined_or_null() {
            if !recommended_chunk_size_value.is_number() {
                return Err(
                    global_this.throw_invalid_arguments(format_args!("chunkSize must be a number"))
                );
            }
            // `(x << 12) >> 12` on i64 truncates to a sign-extended i52
            // (arithmetic right-shift sign-extends bit 51), so negatives clamp to 0
            // via `.max(0)` instead of becoming the 52-bit zero-extended mask.
            let v = (recommended_chunk_size_value.to_int64() << 12) >> 12;
            recommended_chunk_size = v.max(0) as SizeType;
        }
        let stream = ReadableStream::from_blob_copy_ref(global_this, self, recommended_chunk_size)?;

        if let Some(store) = self.store.get() {
            if let store::Data::File(f) = &store.data {
                if let PathOrFileDescriptor::Fd(_) = f.pathlike {
                    // in the case we have a file descriptor store, we want to de-duplicate
                    // readable streams. in every other case we want `.stream()` to be its
                    // own stream.
                    set_cached(this_value, global_this, stream);
                }
            }
        }

        Ok(stream)
    }
    fn get_text(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        self.get_text_clone(global_this)
    }

    fn get_text_clone(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let _store = self.store.get().clone(); // hold a ref across the call
        JSPromise::wrap(global_object, |g| self.to_string(g, Lifetime::Clone))
    }

    fn get_json(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        self.get_json_share(global_this)
    }

    fn get_json_share(&self, global_object: &JSGlobalObject) -> JsResult<JSValue> {
        let _store = self.store.get().clone();
        JSPromise::wrap(global_object, |g| self.to_json(g, Lifetime::Share))
    }

    fn get_array_buffer_clone(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let _store = self.store.get().clone();
        JSPromise::wrap(global_this, |g| self.to_array_buffer(g, Lifetime::Clone))
    }

    fn get_array_buffer(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        self.get_array_buffer_clone(global_this)
    }

    fn get_bytes_clone(&self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let _store = self.store.get().clone();
        JSPromise::wrap(global_this, |g| self.to_uint8_array(g, Lifetime::Clone))
    }

    fn get_bytes(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        self.get_bytes_clone(global_this)
    }

    fn get_form_data(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        let _store = self.store.get().clone();
        JSPromise::wrap(global_this, |g| self.to_form_data(g, Lifetime::Temporary))
    }

    fn get_exists_sync(&self) -> JSValue {
        if self.size.get() == MAX_SIZE {
            self.resolve_size();
        }

        // If there's no store that means it's empty and we just return true
        let Some(store) = self.store.get() else {
            return JSValue::TRUE;
        };

        if matches!(store.data, store::Data::Bytes(_)) {
            // Bytes will never error
            return JSValue::TRUE;
        }

        // We say regular files and pipes exist.
        let store::Data::File(file) = &store.data else {
            return JSValue::FALSE;
        };
        JSValue::from(bun_sys::S::ISREG(file.mode) || bun_sys::S::ISFIFO(file.mode))
    }
    fn do_write(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let mut args = jsc::ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());

        validate_writable_blob(global_this, self)?;

        let Some(data) = args.next_eat() else {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "blob.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write"
            )));
        };
        if data.is_empty_or_undefined_or_null() {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "blob.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write"
            )));
        }
        let mut mkdirp_if_not_exists: Option<bool> = None;
        let options = args.next_eat();
        if let Some(options_object) = options {
            if options_object.is_object() {
                if let Some(create_directory) =
                    options_object.get_truthy(global_this, "createPath")?
                {
                    if !create_directory.is_boolean() {
                        return Err(global_this.throw_invalid_argument_type(
                            "write",
                            "options.createPath",
                            "boolean",
                        ));
                    }
                    mkdirp_if_not_exists = Some(create_directory.to_boolean());
                }
                if let Some(content_type) = options_object.get_truthy(global_this, "type")? {
                    // override the content type
                    set_content_type_from_js(global_this, self, content_type)?;
                }
            } else if !options_object.is_empty_or_undefined_or_null() {
                return Err(global_this.throw_invalid_argument_type("write", "options", "object"));
            }
        }
        // A borrowed view with NO ref bumps; `write_file_internal` then `dupe()`s
        // its own owned `destination_blob` from it.
        let mut blob_internal = PathOrBlob::Blob(Box::new(self.borrowed_view()));
        write_file_internal(
            global_this,
            &mut blob_internal,
            data,
            WriteFileOptions {
                mkdirp_if_not_exists,
                extra_options: options,
                mode: None,
            },
        )
    }

    fn do_unlink(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let mut args = jsc::ArgumentsSlice::init(global_this.bun_vm(), callframe.arguments());

        validate_writable_blob(global_this, self)?;

        let store = self.store().expect("infallible: store present");
        match &store.data {
            store::Data::S3(s3) => s3.unlink(store, global_this, args.next_eat()),
            store::Data::File(file) => file.unlink(global_this),
            store::Data::Bytes(_) => unreachable!(), // validate_writable_blob should have caught this
        }
    }

    // This mostly means 'can it be read?'
    fn get_exists(&self, global_this: &JSGlobalObject, _: &CallFrame) -> JsResult<JSValue> {
        if self.is_s3() {
            return crate::webcore::s3_file::S3BlobStatTask::exists(global_this, self);
        }
        Ok(JSPromise::resolved_promise_value(
            global_this,
            self.get_exists_sync(),
        ))
    }
    fn pipe_readable_stream_to_blob(
        &self,
        global_this: &JSGlobalObject,
        readable_stream: ReadableStream,
        options: &WriteFileOptions,
    ) -> JsResult<JSValue> {
        let extra_options = options.extra_options;
        let Some(store) = self.store.get().clone() else {
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    global_this.create_error_instance(format_args!("Blob is detached")),
                ),
            );
        };

        if self.is_s3() {
            let store::Data::S3(s3) = &store.data else {
                unreachable!()
            };
            let aws_options = match s3.get_credentials_with_options(extra_options, global_this) {
                Ok(o) => o,
                Err(err) => {
                    return Ok(
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            global_this.take_exception(err),
                        ),
                    );
                }
            };

            let path = s3.path();
            let proxy = http_proxy_href(global_this);
            let proxy_url = proxy.as_deref();

            // When no JS overrides were supplied, hand the store's *base*
            // credentials to the upload.
            return crate::webcore::__s3_client::upload_stream(
                if extra_options.is_some() {
                    aws_options.credentials.dupe()
                } else {
                    s3.get_credentials().clone()
                },
                path,
                readable_stream,
                global_this,
                aws_options.options,
                aws_options.acl,
                aws_options.storage_class,
                self.content_type_or_mime_type(),
                aws_options.content_disposition.as_deref(),
                aws_options.content_encoding.as_deref(),
                proxy_url,
                aws_options.request_payer,
                None,
                core::ptr::null_mut(),
            );
        }

        if !matches!(store.data, store::Data::File(_)) {
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    global_this.create_error_instance(format_args!("Blob is read-only")),
                ),
            );
        }

        let file_sink: bun_ptr::RefPtr<webcore::FileSink> = 'brk_sink: {
            #[cfg(windows)]
            {
                let pathlike = &store.data.as_file().pathlike;
                let fd: Fd = if let PathOrFileDescriptor::Fd(fd) = pathlike {
                    *fd
                } else {
                    let mut file_path = bun_paths::PathBuffer::uninit();
                    let path = pathlike.path().slice_z(&mut file_path);
                    let flags = bun_sys::O::WRONLY
                        | bun_sys::O::CREAT
                        | bun_sys::O::TRUNC
                        | bun_sys::O::NONBLOCK;
                    let mode = options.mode.unwrap_or(WRITE_PERMISSIONS);
                    let mut result = bun_sys::open(path, flags, mode);
                    if let bun_sys::Result::Err(err) = &result {
                        if err.get_errno() == bun_sys::E::ENOENT
                            && options.mkdirp_if_not_exists.unwrap_or(true)
                        {
                            result = match mkdirp_parent(path.as_bytes()) {
                                Ok(()) => bun_sys::open(path, flags, mode),
                                Err(err) => Err(err),
                            };
                        }
                    }
                    match result {
                        bun_sys::Result::Ok(result) => result,
                        bun_sys::Result::Err(err) => {
                            return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                global_this,
                                err.with_path(path).to_js(global_this),
                            ));
                        }
                    }
                };

                let is_stdout_or_stderr = 'brk: {
                    if !matches!(pathlike, PathOrFileDescriptor::Fd(_)) {
                        break 'brk false;
                    }

                    if let Some(rare) = global_this.bun_vm().rare_data.as_ref() {
                        // `RareData::std{out,err}_store` is `Option<NonNull<c_void>>`
                        // (type-erased `*Blob.Store`); compare on raw pointer
                        // identity exactly like the POSIX arm below.
                        let store_ptr = store.as_ptr().cast::<core::ffi::c_void>();
                        if rare.stdout_store.map(|p| p.as_ptr()) == Some(store_ptr) {
                            break 'brk true;
                        }
                        if rare.stderr_store.map(|p| p.as_ptr()) == Some(store_ptr) {
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
                    jsc::EventLoopHandle::init(
                        self.global_this()
                            .expect("Blob.global_this set at construction")
                            .bun_vm()
                            .as_mut()
                            .event_loop() as *mut (),
                    ),
                );
                sink.writer
                    .with_mut(|w| w.owns_fd = !matches!(pathlike, PathOrFileDescriptor::Fd(_)));

                #[cfg(windows)]
                use bun_io::pipe_writer::BaseWindowsPipeWriter as _;
                if is_stdout_or_stderr {
                    if let bun_sys::Result::Err(err) =
                        sink.writer.with_mut(|w| w.start_sync(fd, false))
                    {
                        drop(sink);
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err.to_js(global_this),
                        ));
                    }
                } else {
                    if let bun_sys::Result::Err(err) = sink.writer.with_mut(|w| w.start(fd, true)) {
                        drop(sink);
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err.to_js(global_this),
                        ));
                    }
                }

                break 'brk_sink sink;
            }

            #[cfg(not(windows))]
            {
                let sink = webcore::FileSink::init(
                    Fd::INVALID,
                    jsc::EventLoopHandle::init(
                        self.global_this()
                            .expect("Blob.global_this set at construction")
                            .bun_vm()
                            .as_mut()
                            .event_loop()
                            .cast::<()>(),
                    ),
                );

                let input_path: webcore::PathOrFileDescriptor = match &store.data.as_file().pathlike
                {
                    PathOrFileDescriptor::Fd(fd) => webcore::PathOrFileDescriptor::Fd(*fd),
                    PathOrFileDescriptor::Path(p) => webcore::PathOrFileDescriptor::Path(
                        bun_core::Utf8Bytes::Owned(p.slice().to_vec()),
                    ),
                };

                let stream_start = streams::Start::FileSink(streams::FileSinkOptions {
                    truncate: matches!(input_path, webcore::PathOrFileDescriptor::Path(_)),
                    mkdirp: options.mkdirp_if_not_exists.unwrap_or(true),
                    mode: options.mode.unwrap_or(WRITE_PERMISSIONS),
                    input_path,
                    ..Default::default()
                });

                if let bun_sys::Result::Err(err) = sink.start(&stream_start) {
                    drop(sink);
                    return Ok(
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err.to_js(global_this),
                        ),
                    );
                }
                break 'brk_sink sink;
            }
        };

        if let Some(promise) =
            webcore::FileSink::pipe_stream(file_sink.this_ptr(), &readable_stream, global_this)
        {
            return Ok(promise);
        }

        let assignment_result: JSValue = webcore::file_sink::JSSink::assign_to_stream(
            global_this,
            readable_stream.value,
            file_sink.this_ptr().into(),
            |s| file_sink.source.set(s),
        );

        assignment_result.ensure_still_alive();

        if let Some(err) = assignment_result.to_error() {
            drop(file_sink);
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    err,
                ),
            );
        }

        if !assignment_result.is_empty_or_undefined_or_null() {
            global_this.bun_vm().as_mut().drain_microtasks();

            assignment_result.ensure_still_alive();
            // it returns a Promise when it goes through ReadableStreamDefaultReader
            if let Some(promise) = assignment_result.as_any_promise() {
                match promise.status() {
                    jsc::js_promise::Status::Pending => {
                        let sink = bun_ptr::BackRef::from(file_sink.this_ptr());
                        // The pump's ref: released by the reactions below, or
                        // by the controller's destructor at heap teardown.
                        sink.hold_stream_promise_ref(file_sink);
                        let wrapper = Box::new(FileStreamWrapper {
                            promise: jsc::JSPromiseStrong::init(global_this),
                            readable_stream_ref:
                                webcore::readable_stream::ReadableStreamStrong::init(
                                    readable_stream,
                                    global_this,
                                ),
                            sink,
                        });
                        let promise_value = wrapper.promise.value();
                        // Released to the reaction pair: exactly one of them
                        // runs, once, and takes the box back.
                        assignment_result.then(
                            global_this,
                            bun_core::heap::into_raw(wrapper),
                            crate::generated_host_exports::Bun__FileStreamWrapper__onResolveRequestStream,
                            crate::generated_host_exports::Bun__FileStreamWrapper__onRejectRequestStream,
                        );
                        return Ok(promise_value);
                    }
                    jsc::js_promise::Status::Fulfilled => {
                        let written = file_sink.stream_bytes.get().unwrap_or(0);
                        drop(file_sink);
                        readable_stream.done();
                        return Ok(JSPromise::resolved_promise_value(
                            global_this,
                            JSValue::js_number(written as f64),
                        ));
                    }
                    jsc::js_promise::Status::Rejected => {
                        drop(file_sink);
                        readable_stream.cancel(global_this)?;
                        promise.set_handled(global_this.vm());
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            promise.result(global_this.vm()),
                        ));
                    }
                }
            } else {
                drop(file_sink);
                readable_stream.cancel(global_this)?;
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        global_this,
                        assignment_result,
                    ),
                );
            }
        }
        let written = file_sink.stream_bytes.get().unwrap_or(0);
        drop(file_sink);

        Ok(JSPromise::resolved_promise_value(
            global_this,
            JSValue::js_number(written as f64),
        ))
    }

    fn get_writer(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let [arg0] = callframe.arguments_as_array::<1>();
        let has_args = callframe.arguments_count() > 0;

        if !arg0.is_empty_or_undefined_or_null() && !arg0.is_object() {
            return Err(global_this
                .throw_invalid_arguments(format_args!("options must be an object or undefined")));
        }

        validate_writable_blob(global_this, self)?;

        let store = self.store().expect("infallible: store present").clone();
        if self.is_s3() {
            // Borrow `s3` through the
            // cloned `store: RefPtr<Store>` (independent of `self`) so the
            // content-type writes below don't conflict.
            let s3 = store.data.as_s3();
            let path = s3.path();
            // Copy the href out of the env map before any reentrant JS (the
            // `get_truthy`/credential getters below) can mutate `process.env`
            // and free the backing allocation.
            let proxy_owned: Option<Vec<u8>> = http_proxy_href(global_this);
            let proxy = proxy_owned.as_deref();

            if has_args && arg0.is_object() {
                let options = arg0;
                if let Some(content_type) = options.get_truthy(global_this, "type")? {
                    // override the content type
                    set_content_type_from_js(global_this, self, content_type)?;
                }

                let content_disposition_str: Option<Utf8Bytes> =
                    match options.get_truthy(global_this, "contentDisposition")? {
                        Some(v) if !v.is_string() => {
                            return Err(global_this.throw_invalid_argument_type(
                                "write",
                                "options.contentDisposition",
                                "string",
                            ));
                        }
                        Some(v) => Some(v.to_utf8(global_this)?),
                        None => None,
                    };
                let content_encoding_str: Option<Utf8Bytes> =
                    match options.get_truthy(global_this, "contentEncoding")? {
                        Some(v) if !v.is_string() => {
                            return Err(global_this.throw_invalid_argument_type(
                                "write",
                                "options.contentEncoding",
                                "string",
                            ));
                        }
                        Some(v) => Some(v.to_utf8(global_this)?),
                        None => None,
                    };

                let credentials_with_options =
                    s3.get_credentials_with_options(Some(options), global_this)?;
                // `defer credentialsWithOptions.deinit()` → Drop handles slices.
                // `writable_stream` adopts the dup'd ref by value; the
                // MultiPartUpload derefs on done.
                return crate::webcore::s3::client::writable_stream(
                    credentials_with_options.credentials.dupe(),
                    path,
                    global_this,
                    credentials_with_options.options,
                    self.content_type_or_mime_type(),
                    content_disposition_str.as_ref().map(|s| s.slice()),
                    content_encoding_str.as_ref().map(|s| s.slice()),
                    proxy,
                    credentials_with_options.storage_class,
                    credentials_with_options.request_payer,
                );
            }

            return crate::webcore::s3::client::writable_stream(
                s3.get_credentials().clone(),
                path,
                global_this,
                Default::default(),
                self.content_type_or_mime_type(),
                None,
                None,
                proxy,
                None,
                s3.request_payer,
            );
        }

        #[cfg(windows)]
        {
            use bun_io::pipe_writer::BaseWindowsPipeWriter as _;

            let pathlike = &store.data.as_file().pathlike;
            let vm = global_this.bun_vm().as_mut();
            let fd: Fd = match pathlike {
                PathOrFileDescriptor::Fd(fd) => *fd,
                PathOrFileDescriptor::Path(p) => {
                    let mut file_path = bun_paths::PathBuffer::uninit();
                    match bun_sys::open(
                        p.slice_z(&mut file_path),
                        bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::NONBLOCK,
                        WRITE_PERMISSIONS,
                    ) {
                        bun_sys::Result::Ok(result) => result,
                        bun_sys::Result::Err(err) => {
                            return Err(global_this
                                .throw_value(err.with_path(p.slice()).to_js(global_this)));
                        }
                    }
                }
            };

            let is_stdout_or_stderr = 'brk: {
                if !matches!(pathlike, PathOrFileDescriptor::Fd(_)) {
                    break 'brk false;
                }
                if let Some(rare) = vm.rare_data.as_ref() {
                    let store_ptr = store.as_ptr().cast::<core::ffi::c_void>();
                    if rare.stdout_store.map(|p| p.as_ptr()) == Some(store_ptr) {
                        break 'brk true;
                    }
                    if rare.stderr_store.map(|p| p.as_ptr()) == Some(store_ptr) {
                        break 'brk true;
                    }
                }
                matches!(
                    fd.stdio_tag(),
                    Some(bun_core::Stdio::StdOut) | Some(bun_core::Stdio::StdErr)
                )
            };

            let sink = webcore::FileSink::init(
                fd,
                jsc::EventLoopHandle::init(
                    self.global_this()
                        .expect("Blob.global_this set at construction")
                        .bun_vm()
                        .as_mut()
                        .event_loop() as *mut (),
                ),
            );
            // `init`'s ref is released on every exit; `to_js` takes its own
            // per-wrapper ref, so rc >= 1 after `sink` drops on success.
            sink.writer
                .with_mut(|w| w.owns_fd = !matches!(pathlike, PathOrFileDescriptor::Fd(_)));

            let start_result = sink.writer.with_mut(|w| {
                if is_stdout_or_stderr {
                    w.start_sync(fd, false)
                } else {
                    w.start(fd, true)
                }
            });
            if let bun_sys::Result::Err(err) = start_result {
                return Err(global_this.throw_value(err.to_js(global_this)));
            }

            return Ok(sink.to_js(global_this));
        }

        #[cfg(not(windows))]
        {
            let sink = webcore::FileSink::init(
                bun_sys::Fd::INVALID,
                jsc::EventLoopHandle::init(
                    self.global_this()
                        .expect("Blob.global_this set at construction")
                        .bun_vm()
                        .as_mut()
                        .event_loop()
                        .cast::<()>(),
                ),
            );
            // `init`'s ref is released on every exit; `to_js` takes its own
            // per-wrapper ref, so rc >= 1 after `sink` drops on success.

            let input_path: webcore::PathOrFileDescriptor = match &store.data.as_file().pathlike {
                PathOrFileDescriptor::Fd(fd) => webcore::PathOrFileDescriptor::Fd(*fd),
                PathOrFileDescriptor::Path(p) => webcore::PathOrFileDescriptor::Path(
                    bun_core::Utf8Bytes::Owned(p.slice().to_vec()),
                ),
            };

            // `webcore::PathOrFileDescriptor` is not `Clone`; build user
            // options first, then move `input_path` in once.
            let mut stream_start = if has_args && arg0.is_object() {
                streams::Start::from_js_with_tag::<{ streams::StartTag::FileSink }>(
                    global_this,
                    arg0,
                )?
            } else {
                streams::Start::FileSink(streams::FileSinkOptions {
                    input_path: webcore::PathOrFileDescriptor::Fd(Fd::INVALID),
                    ..Default::default()
                })
            };
            if let streams::Start::FileSink(ref mut opts) = stream_start {
                opts.input_path = input_path;
            }

            if let bun_sys::Result::Err(err) = sink.start(&stream_start) {
                return Err(global_this.throw_value(err.to_js(global_this)));
            }

            Ok(sink.to_js(global_this))
        }
    }
    fn get_slice_from(
        &self,
        global_this: &JSGlobalObject,
        relative_start: i64,
        relative_end: i64,
        content_type: BlobContentType,
    ) -> JSValue {
        let offset = self
            .offset
            .get()
            .saturating_add(SizeType::try_from(relative_start).expect("int cast"));
        let len = SizeType::try_from((relative_end.saturating_sub(relative_start)).max(0)).unwrap();

        // This copies over the charset field
        // which is okay because this will only be a <= slice
        let blob = self.dupe();
        blob.offset.set(offset);
        blob.size.set(len);

        let content_type_was_allocated = content_type.is_owned() && !content_type.is_empty();
        // infer the content type if it was not specified
        if content_type.is_empty()
            && matches!(self.content_type.get(), BlobContentType::Static(s) if !s.is_empty())
        {
            blob.content_type.set(self.content_type.get().clone());
        } else {
            blob.content_type.set(content_type);
        }
        blob.content_type_was_set
            .set(self.content_type_was_set.get() || content_type_was_allocated);

        blob.to_js(global_this)
    }

    /// https://w3c.github.io/FileAPI/#slice-method-algo
    fn get_slice(&self, global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let mut arguments_ = callframe.arguments_as_array::<3>();
        // index the full fixed-3 array (args[2] is written below regardless of len).
        let args = &mut arguments_[..];

        if self.size.get() == 0 {
            return Ok(Blob::init_empty(global_this).to_js(global_this));
        }

        // If the optional start parameter is not used as a parameter, let relativeStart be 0.
        let mut relative_start: i64 = 0;
        // If the optional end parameter is not used, let relativeEnd be size.
        let mut relative_end: i64 = i64::try_from(self.size.get()).expect("int cast");

        // Mutate the fixed-3 args array in place to shift the string arg into [2].
        if args[0].is_string() {
            args[2] = args[0];
            args[1] = JSValue::ZERO;
            args[0] = JSValue::ZERO;
        } else if args[1].is_string() {
            args[2] = args[1];
            args[1] = JSValue::ZERO;
        }

        let mut args_iter = jsc::ArgumentsSlice::init(global_this.bun_vm(), &arguments_[..3]);
        if let Some(start_) = args_iter.next_eat() {
            if start_.is_number() {
                let start = start_.to_int64();
                if start < 0 {
                    relative_start = (start
                        .wrapping_add(i64::try_from(self.size.get()).expect("int cast")))
                    .max(0);
                } else {
                    relative_start = start.min(i64::try_from(self.size.get()).expect("int cast"));
                }
            }
        }

        if let Some(end_) = args_iter.next_eat() {
            if end_.is_number() {
                let end = end_.to_int64();
                if end < 0 {
                    relative_end = (end
                        .wrapping_add(i64::try_from(self.size.get()).expect("int cast")))
                    .max(0);
                } else {
                    relative_end = end.min(i64::try_from(self.size.get()).expect("int cast"));
                }
            }
        }

        let mut content_type = BlobContentType::default();
        if let Some(content_type_) = args_iter.next_eat() {
            'inner: {
                if content_type_.is_string() {
                    let content_type_view = content_type_.to_js_string_view(global_this)?;
                    let slicer = content_type_view.to_utf8();
                    let slice = slicer.slice();
                    if !is_valid_blob_type(slice) {
                        break 'inner;
                    }
                    content_type = match global_this.bun_vm().as_mut().mime_type(slice) {
                        Some(mime) => BlobContentType::from(mime),
                        None => BlobContentType::from_lowercased(slice),
                    };
                }
            }
        }

        Ok(self.get_slice_from(global_this, relative_start, relative_end, content_type))
    }

    fn get_mime_type_or_content_type(&self) -> Option<MimeType> {
        if self.content_type_was_set.get() {
            return Some(MimeType::init(self.content_type_slice(), false, None));
        }
        self.store().map(|s| s.mime_type.clone())
    }

    fn get_type(&self, global_this: &JSGlobalObject) -> JSValue {
        let ct = self.content_type_slice();
        if !ct.is_empty() {
            return EncodedSlice::latin1(ct).to_js(global_this);
        }
        if let Some(store) = self.store.get() {
            return EncodedSlice::latin1(&store.mime_type.value).to_js(global_this);
        }
        JSValue::js_empty_string(global_this)
    }

    fn get_name_string(&self) -> Option<&BunString> {
        if self.name.get().tag() != bun_core::Tag::Dead {
            return Some(self.name.get());
        }
        if let Some(path) = self.store_path() {
            self.name.set(BunString::clone_utf8(path));
            return Some(self.name.get());
        }
        None
    }

    // TODO: Move this to a separate `File` object or BunFile
    fn get_name(&self, _: JSValue, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        Ok(match self.get_name_string() {
            Some(name) => name.to_js(global_this)?,
            None => JSValue::UNDEFINED,
        })
    }

    fn set_name(
        &self,
        js_this: JSValue,
        global_this: &JSGlobalObject,
        value: JSValue,
    ) -> JsResult<()> {
        // by default we don't have a name so lets allow it to be set undefined
        if value.is_empty_or_undefined_or_null() {
            self.name.set(BunString::DEAD);
            bun_jsc::generated::JSBlob::name_set_cached(js_this, global_this, value);
            return Ok(());
        }
        if value.is_string() {
            self.name.set(BunString::from_js(value, global_this)?);
            bun_jsc::generated::JSBlob::name_set_cached(js_this, global_this, value);
        }
        Ok(())
    }

    fn get_loader(&self, jsc_vm: &VirtualMachine) -> Option<bun_ast::Loader> {
        use bun_resolver::fs::PathResolverExt as _;
        if let Some(filename) = self.get_file_name() {
            let current_path = bun_resolver::fs::Path::init(&filename);
            return Some(
                current_path
                    .loader(&jsc_vm.transpiler.options.loaders)
                    .unwrap_or(bun_ast::Loader::Tsx),
            );
        } else if let Some(mime_type) = self.get_mime_type_or_content_type() {
            return Some(bun_ast::Loader::from_mime_type(mime_type));
        } else {
            // Be maximally permissive.
            return Some(bun_ast::Loader::Tsx);
        }
    }

    // TODO: Move this to a separate `File` object or BunFile
    fn get_last_modified(&self, _: &JSGlobalObject) -> JSValue {
        if let Some(store) = self.store.get() {
            if matches!(store.data, store::Data::File(_)) {
                // do not hold a pattern-bound `&File` across
                // `resolve_file_stat` — it materializes `&mut File` on the same
                // memory (Stacked Borrows UB; the optimizer may legally cache the
                // pre-call `last_modified` and return the stale `INIT_TIMESTAMP`).
                // Re-read via `Store::data_mut` (raw-ptr-backed accessor) after
                // the mutating call.
                let last_modified = Store::data_mut(store).as_file().last_modified;
                // last_modified can be already set during read.
                if last_modified == jsc::INIT_TIMESTAMP && !self.is_s3() {
                    resolve_file_stat(store);
                }
                // Fresh borrow after possible mutation by `resolve_file_stat`.
                return JSValue::js_number(JSValue::purify_nan(
                    Store::data_mut(store).as_file().last_modified as f64,
                ));
            }
        }

        if self.is_jsdom_file.get() {
            return JSValue::js_number(JSValue::purify_nan(self.last_modified.get()));
        }

        JSValue::js_number(jsc::INIT_TIMESTAMP as f64)
    }

    fn get_size_for_bindings(&self) -> u64 {
        if self.size.get() == MAX_SIZE {
            self.resolve_size();
        }

        // If the file doesn't exist or is not seekable
        // signal that the size is unknown.
        if let Some(store) = self.store.get() {
            if let store::Data::File(file) = &store.data {
                if !file.seekable.unwrap_or(false) {
                    return u64::MAX;
                }
            }
        }

        if self.size.get() == MAX_SIZE {
            return u64::MAX;
        }

        self.size.get()
    }
    fn get_stat(&self, global_this: &JSGlobalObject, callback: &CallFrame) -> JsResult<JSValue> {
        // TODO: make this async for files
        let tag = match self.store.get() {
            None => return Ok(JSValue::UNDEFINED),
            Some(s) => s.data.tag(),
        };
        match tag {
            store::DataTag::File => {
                let file = self
                    .store()
                    .expect("infallible: store present")
                    .data
                    .as_file();
                match &file.pathlike {
                    PathOrFileDescriptor::Path(path_like) => {
                        let vm = global_this.bun_vm().as_mut();
                        // The `*Binding` arg is unused in `AsyncFSTask::create`.
                        let binding = crate::node::fs::Binding::default();
                        Ok(crate::node::fs::async_::Stat::create(
                            global_this,
                            &binding,
                            crate::node::fs::args::Stat::owned(path_like.slice().to_vec()),
                            vm,
                        ))
                    }
                    PathOrFileDescriptor::Fd(fd) => {
                        let vm = global_this.bun_vm().as_mut();
                        let binding = crate::node::fs::Binding::default();
                        Ok(crate::node::fs::async_::Fstat::create(
                            global_this,
                            &binding,
                            crate::node::fs::args::Fstat::for_fd(*fd),
                            vm,
                        ))
                    }
                }
            }
            store::DataTag::S3 => crate::webcore::s3_file::get_stat(self, global_this, callback),
            store::DataTag::Bytes => Ok(JSValue::UNDEFINED),
        }
    }

    fn get_size(&self, _: &JSGlobalObject) -> JSValue {
        if self.size.get() == MAX_SIZE {
            if self.is_s3() {
                return JSValue::js_number(f64::NAN);
            }
            self.resolve_size();
            if self.size.get() == MAX_SIZE && self.store.get().is_some() {
                return JSValue::js_number(f64::INFINITY);
            } else if self.size.get() == 0 && self.store.get().is_some() {
                if let store::Data::File(file) =
                    &self.store().expect("infallible: store present").data
                {
                    if !file.seekable.unwrap_or(true) && file.max_size == MAX_SIZE {
                        return JSValue::js_number(f64::INFINITY);
                    }
                }
            }
        }
        JSValue::js_number(self.size.get() as f64)
    }

    fn resolve_size(&self) {
        let Some(store) = self.store.get() else {
            self.size.set(0);
            return;
        };
        // dispatch on the copied `DataTag` rather than
        // `match &store.data { File(file) => … }`. The latter goes through
        // `RefPtr<Store>::Deref → &Store → &Data` (no `UnsafeCell`), and that shared
        // borrow is live across the arm body where `resolve_file_stat`
        // materializes `&mut File` on the same memory via the raw
        // `heap::alloc` pointer — Stacked Borrows UB, and under noalias the
        // optimizer may legally cache the pre-call `seekable: None` and fall
        // through to `self.size.get() = 0`. `Store::data_mut` centralises
        // the raw-ptr deref so each read here is a fresh, safe borrow.
        match Store::data_mut(store).tag() {
            store::DataTag::Bytes => {
                let offset = self.offset.get();
                let store_size = store.size();
                if store_size != MAX_SIZE {
                    self.offset.set(store_size.min(offset));
                    let available = store_size - self.offset.get();
                    self.size.set(window_size(self.size.get(), available));
                }
            }
            store::DataTag::File => {
                if Store::data_mut(store).as_file().seekable.is_none() {
                    resolve_file_stat(store);
                }
                // Fresh borrow after possible mutation by `resolve_file_stat`.
                let file = Store::data_mut(store).as_file();

                if file.seekable.is_some() && file.max_size != MAX_SIZE {
                    let store_size = file.max_size;
                    let offset = self.offset.get();
                    self.offset.set(store_size.min(offset));
                    let available = store_size - self.offset.get();
                    self.size.set(window_size(self.size.get(), available));
                    return;
                }

                // For non-seekable files (pipes, FIFOs), the size is genuinely
                // unknown — leave it as max_size so that stream readers don't
                // treat it as an empty file.
                if file.seekable == Some(false) {
                    return;
                }
                self.size.set(0);
            }
            store::DataTag::S3 => self.size.set(0),
        }
    }

    /// Non-mutating variant of [`resolve_size`]: returns the `(offset, size)` that
    /// `resolve_size` would assign without touching `self`. For callers
    /// (e.g. `ByteBlobLoader::setup`) that need the resolved size of a `Blob`
    /// they don't own mutably — `Blob` is not `Clone`.
    fn resolved_size(&self) -> (SizeType, SizeType) {
        let Some(store) = self.store.get() else {
            return (self.offset.get(), 0);
        };
        // see `resolve_size` — dispatch on the copied tag and re-read
        // via `Store::data_mut` after `resolve_file_stat` so no
        // `Deref`-produced `&Data`/`&File` is live across the mutating call.
        match Store::data_mut(store).tag() {
            store::DataTag::Bytes => {
                let offset = self.offset.get();
                let store_size = store.size();
                if store_size != MAX_SIZE {
                    let offset = store_size.min(offset);
                    let available = store_size - offset;
                    return (offset, window_size(self.size.get(), available));
                }
                (self.offset.get(), self.size.get())
            }
            store::DataTag::File => {
                if Store::data_mut(store).as_file().seekable.is_none() {
                    resolve_file_stat(store);
                }
                // Fresh borrow after possible mutation by `resolve_file_stat`.
                let file = Store::data_mut(store).as_file();
                if file.seekable.is_some() && file.max_size != MAX_SIZE {
                    let store_size = file.max_size;
                    let offset = store_size.min(self.offset.get());
                    let available = store_size - offset;
                    return (offset, window_size(self.size.get(), available));
                }
                if file.seekable == Some(false) {
                    return (self.offset.get(), self.size.get());
                }
                (self.offset.get(), 0)
            }
            store::DataTag::S3 => (self.offset.get(), 0),
        }
    }
    fn constructor(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<*mut Blob> {
        let blob: Blob;
        let args = callframe.arguments();

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
                                    let content_type_str = content_type.to_utf8(global_this)?;
                                    let slice = content_type_str.slice();
                                    if !is_valid_blob_type(slice) {
                                        break 'inner;
                                    }
                                    blob.content_type_was_set.set(true);
                                    blob.content_type.set(
                                        match global_this.bun_vm().as_mut().mime_type(slice) {
                                            Some(mime) => BlobContentType::from(mime),
                                            None => BlobContentType::from_lowercased(slice),
                                        },
                                    );
                                }
                            }
                        }
                    }
                }

                if blob.content_type_slice().is_empty() {
                    blob.content_type.set(BlobContentType::default());
                    blob.content_type_was_set.set(false);
                }
            }
        }

        blob.calculate_estimated_byte_size();
        Ok(Blob::new(blob))
    }

    // `finalize` is inherent on `Blob` (bun_jsc::webcore_types) so codegen's
    // `Blob::finalize(b)` resolves there ahead of the blanket `JsFinalize`.

    fn init_with_all_ascii(
        bytes: Vec<u8>,
        global_this: &JSGlobalObject,
        is_all_ascii: bool,
    ) -> Blob {
        // avoid allocating a Blob.Store if the buffer is actually empty
        let mut store: Option<RefPtr<Store>> = None;
        let len = bytes.len();
        if len > 0 {
            let s = Store::init(bytes);
            s.is_all_ascii.set(is_all_ascii);
            store = Some(s);
        }
        let blob = Blob::default();
        blob.size.set(len as SizeType);
        blob.store.set(store);
        blob.global_this.set(global_this);
        blob.charset
            .set(strings::AsciiStatus::from_bool(Some(is_all_ascii)));
        blob
    }

    fn create_with_bytes_and_allocator(
        bytes: Vec<u8>,
        global_this: &JSGlobalObject,
        was_string: bool,
    ) -> Blob {
        let len = bytes.len();
        let blob = Blob::default();
        blob.size.set(len as SizeType);
        blob.store.set(if len > 0 {
            Some(Store::init(bytes))
        } else {
            None
        });
        if was_string {
            blob.content_type
                .set(BlobContentType::from_mime(&bun_http_types::MimeType::TEXT));
        }
        blob.global_this.set(global_this);
        blob
    }

    fn try_create(
        bytes_: &[u8],
        global_this: &JSGlobalObject,
        was_string: bool,
    ) -> Result<Blob, bun_alloc::AllocError> {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            if crate::allocators::linux_mem_fd_allocator::LinuxMemFdAllocator::should_use(bytes_) {
                if let Ok(result) =
                    crate::allocators::linux_mem_fd_allocator::LinuxMemFdAllocator::create(bytes_)
                {
                    let store = RefPtr::new(Store {
                        data: store::Data::Bytes(result),
                        mime_type: bun_http_types::MimeType::NONE,
                        ref_count: bun_ptr::ThreadSafeRefCount::init(),
                        is_all_ascii: store::IsAllAscii::default(),
                    });
                    let blob = Blob::init_with_store(store, global_this);
                    if was_string && blob.content_type_slice().is_empty() {
                        blob.content_type
                            .set(BlobContentType::from_mime(&bun_http_types::MimeType::TEXT));
                    }
                    return Ok(blob);
                }
            }
        }

        Ok(Self::create_with_bytes_and_allocator(
            bytes_.to_vec(),
            global_this,
            was_string,
        ))
    }

    fn create(bytes_: &[u8], global_this: &JSGlobalObject, was_string: bool) -> Blob {
        Self::try_create(bytes_, global_this, was_string).expect("oom")
    }

    // Transferring doesn't change the reference count
    // It is a move
    #[inline]
    fn transfer(&self) {
        // No `.deref()` here: the receiver already
        // holds the same `*Store`; leak our +1 into theirs.
        if let Some(s) = self.take_store() {
            let _ = s.into_raw();
        }
    }

    // dupe / dupe_with_content_type / to_js: defined once below (top-level impl); duplicates removed (E0592).

    /// The window of the store's byte buffer [`shared_view`](Blob::shared_view)
    /// covers: `offset..offset+size`, clamped. Empty when there is no byte
    /// store.
    fn shared_view_range(&self) -> Range<usize> {
        if self.size.get() == 0 {
            return 0..0;
        }
        let Some(store) = self.store() else {
            return 0..0;
        };
        let len = store.shared_view().len();
        // Defensive: `offset` may originate from untrusted structured-clone data.
        let off = (self.offset.get() as usize).min(len);
        let clamped = (len - off).min(self.size.get() as usize);
        off..off + clamped
    }

    /// The bytes `bytes` stands for: its own, or that window of this blob's
    /// store.
    fn source_slice<'a>(&'a self, bytes: &'a SourceBytes) -> &'a [u8] {
        match bytes {
            SourceBytes::Temporary(owned) => owned,
            SourceBytes::Store(range, _) => self
                .store()
                .and_then(|s| s.shared_view().get(range.clone()))
                .unwrap_or(&[]),
        }
    }

    fn set_is_ascii_flag(&self, is_all_ascii: bool) {
        self.charset
            .set(strings::AsciiStatus::from_bool(Some(is_all_ascii)));
        // if this Blob represents the entire binary data
        // we can update the store's is_all_ascii flag
        if self.size.get() > 0 && self.offset.get() == 0 {
            if let Some(store) = self.store() {
                if matches!(store.data, store::Data::Bytes(_)) {
                    store.is_all_ascii.set(is_all_ascii);
                }
            }
        }
    }

    fn to_string_with_bytes(
        &self,
        global: &JSGlobalObject,
        bytes: SourceBytes,
    ) -> JsResult<JSValue> {
        let lifetime = bytes.lifetime();
        let raw_slice: &[u8] = self.source_slice(&bytes);
        let (bom, buf) = strings::BOM::detect_and_split(raw_slice);
        // `buf`'s window of the source (a BOM is skipped).
        let buf_range = match &bytes {
            SourceBytes::Store(range, _) => range.start + (raw_slice.len() - buf.len())..range.end,
            SourceBytes::Temporary(_) => raw_slice.len() - buf.len()..raw_slice.len(),
        };

        if buf.is_empty() {
            // If all it contained was the bom, `bytes` frees it on drop.
            return Ok(JSValue::js_empty_string(global));
        }

        if bom == Some(strings::BOM::Utf16Le) {
            // Reinterpret as u16: drop a trailing odd byte.
            // This branch intentionally does NOT `self.detach()` for
            // `Lifetime::Transfer`, unlike the toJSON path.
            let buf = &buf[..buf.len() & !1];
            let out = match bytemuck::try_cast_slice::<u8, u16>(buf) {
                Ok(units) => BunString::clone_utf16(units),
                Err(_) => {
                    let units: Vec<u16> = buf
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .map(|pair| u16::from_le_bytes(*pair))
                        .collect();
                    BunString::clone_utf16(&units)
                }
            };
            return out.into_js(global);
        }

        // null == unknown
        // false == can't be
        let could_be_all_ascii = self
            .is_all_ascii()
            .or_else(|| self.store().and_then(|s| s.is_all_ascii.get()));

        if could_be_all_ascii.is_none() || !could_be_all_ascii.unwrap() {
            // if to_utf16_alloc returns None, it means there are no non-ASCII characters
            let converted = match strings::to_utf16_alloc(buf, false, false) {
                Ok(converted) => converted,
                Err(_) => {
                    return Err(global.throw_out_of_memory());
                }
            };
            if let Some(external) = converted {
                if lifetime != Lifetime::Temporary {
                    self.set_is_ascii_flag(false);
                }
                if lifetime == Lifetime::Transfer {
                    self.detach();
                }
                drop(bytes);
                return bun_string_jsc::owned_utf16_into_js(global, external);
            }

            if lifetime != Lifetime::Temporary {
                self.set_is_ascii_flag(true);
            }
        }

        match bytes {
            // strings are immutable
            // we don't need to clone
            //
            // we don't need to worry about UTF-8 BOM in this case because the store owns the memory.
            SourceBytes::Store(_, Lifetime::Clone | Lifetime::Share) => {
                let store = self.store().expect("infallible: store present").clone();
                jsc::external_string_from_store(global, store, buf_range)
            }
            SourceBytes::Store(_, Lifetime::Transfer) => {
                // Cloning the RefPtr<Store> here would bump the
                // intrusive count by +1 *and* `transfer()` would leak the original
                // +1, leaving an unmatched ref. Move the existing ref out instead;
                // its single ref is handed to JSC.
                let store = self.take_store().expect("transfer with null store");
                debug_assert!(matches!(store.data, store::Data::Bytes(_)));
                jsc::external_string_from_store(global, store, buf_range)
            }
            SourceBytes::Store(_, Lifetime::Temporary) => {
                unreachable!("store-owned bytes are never Temporary")
            }
            SourceBytes::Temporary(owned) => {
                // if there was a UTF-8 BOM, we need to clone the buffer because
                // external doesn't support this case here yet.
                if buf_range.start != 0 {
                    let out = BunString::clone_latin1(&owned[buf_range]);
                    drop(owned);
                    return out.into_js(global);
                }
                bun_string_jsc::owned_latin1_into_js(global, owned.into_vec())
            }
        }
    }

    fn to_string_transfer(&self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_string(global, Lifetime::Transfer)
    }

    fn to_string(&self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        if self.needs_to_read_file() {
            return Ok(self.do_read_file::<ToStringWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToStringWithBytesFn>(global);
        }

        debug_assert!(
            lifetime != Lifetime::Temporary,
            "store-owned bytes are never Temporary"
        );
        let view = self.shared_view_range();
        if view.is_empty() {
            return Ok(JSValue::js_empty_string(global));
        }
        self.to_string_with_bytes(global, SourceBytes::Store(view, lifetime))
    }

    fn to_json(&self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        if self.needs_to_read_file() {
            return Ok(self.do_read_file::<ToJsonWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToJsonWithBytesFn>(global);
        }

        debug_assert!(
            lifetime != Lifetime::Temporary,
            "store-owned bytes are never Temporary"
        );
        self.to_json_with_bytes(
            global,
            SourceBytes::Store(self.shared_view_range(), lifetime),
        )
    }

    fn to_json_with_bytes(&self, global: &JSGlobalObject, bytes: SourceBytes) -> JsResult<JSValue> {
        let lifetime = bytes.lifetime();
        // `bytes` (freed on every return when it owns the buffer) outlives `buf`.
        let (bom, buf) = strings::BOM::detect_and_split(self.source_slice(&bytes));
        if buf.is_empty() {
            return Err(global.throw_value(
                global.create_syntax_error_instance(format_args!("Unexpected end of JSON input")),
            ));
        }

        if bom == Some(strings::BOM::Utf16Le) {
            // Reinterpret as u16: drop a trailing odd byte.
            let buf = &buf[..buf.len() & !1];
            let out = match bytemuck::try_cast_slice::<u8, u16>(buf) {
                Ok(units) => BunString::clone_utf16(units),
                Err(_) => {
                    let units: Vec<u16> = buf
                        .as_chunks::<2>()
                        .0
                        .iter()
                        .map(|pair| u16::from_le_bytes(*pair))
                        .collect();
                    BunString::clone_utf16(&units)
                }
            };
            let result = out.to_js_by_parse_json(global);
            if lifetime == Lifetime::Transfer {
                self.detach();
            }
            return result;
        }
        // null == unknown
        // false == can't be
        let could_be_all_ascii = self
            .is_all_ascii()
            .or_else(|| self.store().and_then(|s| s.is_all_ascii.get()));

        if could_be_all_ascii.is_none() || !could_be_all_ascii.unwrap() {
            if let Some(external) = strings::to_utf16_alloc(buf, false, false)
                .map_err(|_| global.throw_out_of_memory())?
            {
                if lifetime != Lifetime::Temporary {
                    self.set_is_ascii_flag(false);
                }
                let result = EncodedSlice::utf16(&external).to_json_object(global);
                drop(external);
                return result;
            }

            if lifetime != Lifetime::Temporary {
                self.set_is_ascii_flag(true);
            }
        }

        EncodedSlice::latin1(buf).to_json_object(global)
    }

    fn to_form_data_with_bytes(&self, global: &JSGlobalObject, bytes: SourceBytes) -> JSValue {
        let Some(encoder) = self.get_form_data_encoding() else {
            return global.create_error_instance(format_args!("Invalid encoding"));
        };

        // `crate::webcore::form_data::Encoding` re-exports
        // `bun_core::form_data::Encoding` — same type, no re-tagging needed.
        let buf = self.source_slice(&bytes);
        match crate::webcore::form_data::FormData::to_js(global, buf, &encoder.encoding) {
            Ok(v) => v,
            Err(err) => {
                global.create_error_instance(format_args!("FormData encoding failed: {err}"))
            }
        }
    }

    fn to_array_buffer_with_bytes(
        &self,
        global: &JSGlobalObject,
        bytes: SourceBytes,
    ) -> JsResult<JSValue> {
        self.to_array_buffer_view_with_bytes::<{ jsc::JSType::ArrayBuffer }>(global, bytes)
    }

    fn to_uint8_array_with_bytes(
        &self,
        global: &JSGlobalObject,
        bytes: SourceBytes,
    ) -> JsResult<JSValue> {
        self.to_array_buffer_view_with_bytes::<{ jsc::JSType::Uint8Array }>(global, bytes)
    }

    fn to_array_buffer_view_with_bytes<const TYPED_ARRAY_VIEW: jsc::JSType>(
        &self,
        global: &JSGlobalObject,
        bytes: SourceBytes,
    ) -> JsResult<JSValue> {
        let buf_len = self.source_slice(&bytes).len();
        match bytes {
            SourceBytes::Store(range, Lifetime::Clone) => {
                if TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer {
                    // ArrayBuffer doesn't have this limit.
                    if buf_len > jsc::virtual_machine::synthetic_allocation_limit() {
                        self.detach();
                        return Err(global.throw_out_of_memory());
                    }
                }

                // Held across the conversion so the bytes (and a memfd behind
                // them) stay put whatever `self` does meanwhile.
                let Some(store) = self.store().cloned() else {
                    return jsc::ArrayBuffer::create::<TYPED_ARRAY_VIEW>(global, b"");
                };
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    use crate::allocators::linux_mem_fd_allocator::LinuxMemFdAllocator;
                    // If we can use a copy-on-write clone of the buffer, do so.
                    if let store::Data::Bytes(store_bytes) = &store.data {
                        if let Some(memfd) = LinuxMemFdAllocator::from_bytes(store_bytes) {
                            // `shared_view()` starts at the mapping's start.
                            let byte_offset = range.start;
                            let result = jsc::ArrayBuffer::to_array_buffer_from_shared_memfd(
                                memfd.fd().native() as i64,
                                global,
                                byte_offset,
                                buf_len,
                                store_bytes.allocated_slice().len(),
                                TYPED_ARRAY_VIEW,
                            )?;
                            debug!(
                                "toArrayBuffer COW clone({}, {}) = {}",
                                byte_offset,
                                buf_len,
                                (result != JSValue::ZERO) as u8
                            );
                            if result != JSValue::ZERO {
                                return Ok(result);
                            }
                        }
                    }
                }
                jsc::ArrayBuffer::create::<TYPED_ARRAY_VIEW>(global, &store.shared_view()[range])
            }
            SourceBytes::Store(range, Lifetime::Share) => {
                if buf_len > jsc::virtual_machine::synthetic_allocation_limit()
                    && TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer
                {
                    return Err(global.throw_out_of_memory());
                }
                let store = self.store().expect("infallible: store present").clone();
                // JSC keeps the bytes alive through the store ref it is handed,
                // released at GC.
                jsc::ArrayBuffer::to_js_from_store(global, store, range, TYPED_ARRAY_VIEW)
            }
            SourceBytes::Store(range, Lifetime::Transfer) => {
                if self.store().is_some_and(|s| !s.has_one_ref()) {
                    let copied = self.to_array_buffer_view_with_bytes::<TYPED_ARRAY_VIEW>(
                        global,
                        SourceBytes::Store(range, Lifetime::Clone),
                    );
                    self.detach();
                    return copied;
                }
                if buf_len > jsc::virtual_machine::synthetic_allocation_limit()
                    && TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer
                {
                    self.detach();
                    return Err(global.throw_out_of_memory());
                }
                // Move the existing +1 out. Cloning then `transfer()` would leak a ref.
                let store = self.take_store().expect("transfer with null store");
                jsc::ArrayBuffer::to_js_from_store(global, store, range, TYPED_ARRAY_VIEW)
            }
            SourceBytes::Store(_, Lifetime::Temporary) => {
                unreachable!("store-owned bytes are never Temporary")
            }
            SourceBytes::Temporary(owned) => {
                if buf_len > jsc::virtual_machine::synthetic_allocation_limit()
                    && TYPED_ARRAY_VIEW != jsc::JSType::ArrayBuffer
                {
                    drop(owned);
                    return Err(global.throw_out_of_memory());
                }
                // Ownership is transferred to JSC.
                // `to_js_unchecked`: `to_js`'s heap-region probe would skip the deallocator
                // for a non-mimalloc buffer, but `Temporary` is always default-allocator.
                jsc::ArrayBuffer::from_owned_bytes(owned, TYPED_ARRAY_VIEW).to_js_unchecked(global)
            }
        }
    }

    fn to_array_buffer(&self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        debug!("toArrayBuffer");
        self.to_array_buffer_view::<{ jsc::JSType::ArrayBuffer }>(global, lifetime)
    }

    fn to_uint8_array(&self, global: &JSGlobalObject, lifetime: Lifetime) -> JsResult<JSValue> {
        debug!("toUin8Array");
        self.to_array_buffer_view::<{ jsc::JSType::Uint8Array }>(global, lifetime)
    }

    fn to_array_buffer_view<const TYPED_ARRAY_VIEW: jsc::JSType>(
        &self,
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
                jsc::JSType::ArrayBuffer => {
                    self.do_read_from_s3::<ToArrayBufferWithBytesFn>(global)
                }
                _ => self.do_read_from_s3::<ToUint8ArrayWithBytesFn>(global),
            };
        }

        debug_assert!(
            lifetime != Lifetime::Temporary,
            "store-owned bytes are never Temporary"
        );
        let view = self.shared_view_range();
        if view.is_empty() {
            return jsc::ArrayBuffer::create::<TYPED_ARRAY_VIEW>(global, b"");
        }
        self.to_array_buffer_view_with_bytes::<TYPED_ARRAY_VIEW>(
            global,
            SourceBytes::Store(view, lifetime),
        )
    }

    fn to_form_data(&self, global: &JSGlobalObject, _lifetime: Lifetime) -> JsResult<JSValue> {
        if self.needs_to_read_file() {
            return Ok(self.do_read_file::<ToFormDataWithBytesFn>(global));
        }
        if self.is_s3() {
            return self.do_read_from_s3::<ToFormDataWithBytesFn>(global);
        }

        let view = self.shared_view_range();
        if view.is_empty() {
            return Ok(jsc::DOMFormData::create(global));
        }
        Ok(self.to_form_data_with_bytes(global, SourceBytes::Store(view, Lifetime::Clone)))
    }
    #[inline]
    fn get<const MOVE: bool, const REQUIRE_ARRAY: bool>(
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<Blob> {
        match (MOVE, REQUIRE_ARRAY) {
            (true, false) => Self::from_js_move(global, arg),
            (false, false) => Self::from_js_clone_optional_array(global, arg),
            (_, true) => Self::from_js_clone(global, arg),
        }
    }

    #[inline]
    fn from_js_move(global: &JSGlobalObject, arg: JSValue) -> JsResult<Blob> {
        Self::from_js_without_defer_gc::<true, false>(global, arg)
    }

    #[inline]
    fn from_js_clone(global: &JSGlobalObject, arg: JSValue) -> JsResult<Blob> {
        Self::from_js_without_defer_gc::<false, true>(global, arg)
    }

    #[inline]
    fn from_js_clone_optional_array(global: &JSGlobalObject, arg: JSValue) -> JsResult<Blob> {
        Self::from_js_without_defer_gc::<false, false>(global, arg)
    }

    fn from_js_without_defer_gc<const MOVE: bool, const REQUIRE_ARRAY: bool>(
        global: &JSGlobalObject,
        arg: JSValue,
    ) -> JsResult<Blob> {
        let mut current = arg;
        if current.is_undefined_or_null() {
            return Ok(Blob::init_empty(global));
        }

        let mut top_value = current;
        let might_only_be_one_thing: bool;
        arg.ensure_still_alive();
        let _keep = jsc::EnsureStillAlive(arg);
        let mut fail_if_top_value_is_not_typed_array_like = false;
        match current.js_type_loose() {
            jsc::JSType::Array | jsc::JSType::DerivedArray => {
                let mut top_iter = jsc::JSArrayIterator::init(current, global)?;
                might_only_be_one_thing = top_iter.len == 1;
                if top_iter.len == 0 {
                    return Ok(Blob::init_empty(global));
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
                        let bytes = str.to_owned_slice();
                        let ascii = strings::is_all_ascii(&bytes);
                        return Ok(Blob::init_with_all_ascii(bytes, global, ascii));
                    }
                }

                t if t.is_array_buffer_like() => {
                    return Blob::try_create(
                        top_value.as_array_buffer(global).unwrap().byte_slice(),
                        global,
                        false,
                    )
                    .map_err(Into::into);
                }

                jsc::JSType::DOMWrapper => {
                    if !fail_if_top_value_is_not_typed_array_like {
                        if let Some(blob) = top_value.as_class_ref::<Blob>() {
                            if MOVE {
                                // Move the store without bumping its refcount, but take
                                // independent ownership of name/content_type so the
                                // source's eventual finalize() doesn't double-free them.
                                // *Take* the RefPtr<Store> out of `blob`
                                // (no clone, no into_raw leak) and field-copy the
                                // rest, deep-owning `name`/`content_type` — net 0 on
                                // the store refcount.
                                let _blob = Blob {
                                    reported_estimated_size: Cell::new(
                                        blob.reported_estimated_size.get(),
                                    ),
                                    size: Cell::new(blob.size.get()),
                                    offset: Cell::new(blob.offset.get()),
                                    store: JsCell::new(blob.take_store()), // ← the move
                                    content_type: JsCell::new(blob.content_type.get().clone()),
                                    content_type_was_set: Cell::new(
                                        blob.content_type_was_set.get(),
                                    ),
                                    charset: Cell::new(blob.charset.get()),
                                    is_jsdom_file: Cell::new(blob.is_jsdom_file.get()),
                                    ref_count: bun_ptr::RawRefCount::init(0), // setNotHeapAllocated
                                    global_this: Cell::new(blob.global_this.get()),
                                    last_modified: Cell::new(blob.last_modified.get()),
                                    name: blob.name.clone(),
                                };
                                return Ok(_blob);
                            } else {
                                return Ok(blob.dupe());
                            }
                        } else if let Some(artifact) =
                            top_value.as_class_ref::<crate::api::BuildArtifact>()
                        {
                            // The previous "move" path here only nulled the store on a
                            // local copy and left `build.blob` fully intact, so it was
                            // never a real move. Share the store and deep-copy owned
                            // buffers instead — regardless of `MOVE`.
                            return Ok(artifact.blob.dupe());
                        } else {
                            let view = current.to_js_string_view(global)?;
                            if !view.is_empty() {
                                return Ok(Blob::init_with_all_ascii(
                                    view.to_owned_slice(),
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
                return Err(
                    global.throw_invalid_arguments(format_args!("new Blob() expects an Array"))
                );
            }
        }

        // Every value pushed here is
        // reachable from `arg` (rooted by `_keep: EnsureStillAlive` above) via the
        // JS object graph, so a heap `Vec<JSValue>` is GC-safe with
        // unbounded capacity (a prior `BoundedArray<_, 128>` panicked on overflow).
        let mut stack: Vec<JSValue> = Vec::new();
        let mut joiner = Parts::default();
        let mut could_have_non_ascii = false;

        loop {
            match current.js_type_loose() {
                jsc::JSType::NumberObject
                | jsc::JSType::String
                | jsc::JSType::StringObject
                | jsc::JSType::DerivedStringObject => {
                    let utf8 = current.to_utf8(global)?;
                    could_have_non_ascii = could_have_non_ascii || utf8.is_owned();
                    joiner.push_cloned(utf8.slice());
                }

                jsc::JSType::Array | jsc::JSType::DerivedArray => {
                    let mut iter = jsc::JSArrayIterator::init(current, global)?;
                    stack.reserve(iter.len as usize);

                    // Decide up front whether processing any part (or any entry
                    // still pending on `stack`) can re-enter user JS (toString /
                    // Symbol.toPrimitive / proxy traps / getters) and detach a
                    // borrowed buffer before `joiner.done()` copies it out. If
                    // nothing can, typed-array parts are borrowed (`push_static`)
                    // instead of cloned, which would double peak memory for
                    // `new Blob(largeChunks)`. Non-fast arrays are conservatively
                    // treated as able to run user JS.
                    let mut parts_can_run_js = !iter.is_fast() || !stack.is_empty();
                    if !parts_can_run_js {
                        let mut prescan = jsc::JSArrayIterator::init(current, global)?;
                        while let Some(item) = prescan.next()? {
                            if item.is_undefined_or_null() {
                                continue;
                            }
                            match item.js_type_loose() {
                                jsc::JSType::String => {}
                                t if t.is_array_buffer_like() => {}
                                jsc::JSType::DOMWrapper
                                    if item.as_class_ref::<Blob>().is_some() => {}
                                _ => {
                                    parts_can_run_js = true;
                                    break;
                                }
                            }
                        }
                    }

                    while let Some(item) = iter.next()? {
                        if item.is_undefined_or_null() {
                            continue;
                        }

                        {
                            match item.js_type_loose() {
                                jsc::JSType::NumberObject
                                | jsc::JSType::Cell
                                | jsc::JSType::String
                                | jsc::JSType::StringObject
                                | jsc::JSType::DerivedStringObject => {
                                    let utf8 = item.to_utf8(global)?;
                                    could_have_non_ascii = could_have_non_ascii || utf8.is_owned();
                                    joiner.push_cloned(utf8.slice());
                                    continue;
                                }
                                t if t.is_array_buffer_like() => {
                                    could_have_non_ascii = true;
                                    let buf = item.as_array_buffer(global).unwrap();
                                    if parts_can_run_js {
                                        // A later part may run user JS that detaches
                                        // or resizes this buffer before `done()`.
                                        joiner.push_cloned(buf.byte_slice());
                                    } else {
                                        // The prescan above proved no remaining part
                                        // can run user JS, so this buffer (rooted via
                                        // `_keep`/`arg`) stays attached and valid until
                                        // `joiner.done()` below reads it.
                                        joiner.push(Part::Buffer(buf));
                                    }
                                    continue;
                                }
                                jsc::JSType::Array | jsc::JSType::DerivedArray => {
                                    let utf8 = item.to_utf8(global)?;
                                    could_have_non_ascii = could_have_non_ascii || utf8.is_owned();
                                    joiner.push_cloned(utf8.slice());
                                    continue;
                                }
                                jsc::JSType::DOMWrapper => {
                                    if let Some(blob) = item.as_class_ref::<Blob>() {
                                        could_have_non_ascii = could_have_non_ascii
                                            || blob.charset.get() != strings::AsciiStatus::AllAscii;
                                        // A later part may run user JS that drops the
                                        // last ref to this Blob's Store before `done()`.
                                        if parts_can_run_js {
                                            joiner.push_cloned(blob.shared_view());
                                        } else {
                                            joiner.push(Part::of_blob(blob));
                                        }
                                        continue;
                                    } else {
                                        let utf8 = item.to_utf8(global)?;
                                        could_have_non_ascii =
                                            could_have_non_ascii || utf8.is_owned();
                                        joiner.push_cloned(utf8.slice());
                                        continue;
                                    }
                                }
                                _ => {
                                    let utf8 = item.to_utf8(global)?;
                                    could_have_non_ascii = could_have_non_ascii || utf8.is_owned();
                                    joiner.push_cloned(utf8.slice());
                                }
                            }
                        }
                    }
                }

                jsc::JSType::DOMWrapper => {
                    if let Some(blob) = current.as_class_ref::<Blob>() {
                        could_have_non_ascii = could_have_non_ascii
                            || blob.charset.get() != strings::AsciiStatus::AllAscii;
                        // This arm only handles entries deferred onto the walk
                        // stack; other pending entries may still run user JS and
                        // free this Blob's Store before `done()`, so always copy.
                        joiner.push_cloned(blob.shared_view());
                    } else {
                        let utf8 = current.to_utf8(global)?;
                        could_have_non_ascii = could_have_non_ascii || utf8.is_owned();
                        joiner.push_cloned(utf8.slice());
                    }
                }

                t if t.is_array_buffer_like() => {
                    let buf = current.as_array_buffer(global).unwrap();
                    // This arm is only reached when the typed array is the
                    // top-level value (the walk stack is empty), so no user JS runs
                    // between this push and `joiner.done()` below; `_keep`/`arg` keeps
                    // the buffer alive for that span.
                    joiner.push(Part::Buffer(buf));
                    could_have_non_ascii = true;
                }

                _ => {
                    let utf8 = current.to_utf8(global)?;
                    could_have_non_ascii = could_have_non_ascii || utf8.is_owned();
                    joiner.push_cloned(utf8.slice());
                }
            }
            current = match stack.pop() {
                Some(v) => v,
                None => break,
            };
        }

        let joined: Vec<u8> = joiner.done();

        if !could_have_non_ascii {
            return Ok(Blob::init_with_all_ascii(joined, global, true));
        }
        Ok(Blob::init(joined, global))
    }

    // is_detached: defined once above; duplicate removed to fix E0034.

    fn calculate_estimated_byte_size(&self) {
        // in-memory size. not the size on disk.
        let mut size: usize = core::mem::size_of::<Blob>();

        if let Some(store) = self.store.get() {
            size += core::mem::size_of::<Store>();
            match &store.data {
                store::Data::Bytes(bytes) => {
                    size += bytes.stored_name.len();
                    size += if self.size.get() != MAX_SIZE {
                        self.size.get() as usize
                    } else {
                        bytes.len() as usize
                    };
                }
                store::Data::File(file) => size += file.pathlike.estimated_size(),
                store::Data::S3(s3) => size += s3.estimated_size(),
            }
        }

        let ct = self.content_type.get();
        self.reported_estimated_size.set(
            size + (ct.as_slice().len() * (ct.is_owned() as usize))
                + self.name.get().byte_slice().len(),
        );
    }

    fn estimated_size(&self) -> usize {
        self.reported_estimated_size.get()
    }

    /// `Bun.file(pathOrFd)` core: wrap a path-or-fd in a `Store::File` and
    /// return a Blob viewing it. Runtime `check_s3` matches the call shape used
    /// by `server_body.rs` / `fetch.rs` (collapsed from a const generic since
    /// it only guards a string prefix check).
    fn find_or_create_file_from_path(
        path_or_fd: &mut PathOrFileDescriptor<'static>,
        global_this: &JSGlobalObject,
        check_s3: bool,
    ) -> Blob {
        // ─── S3 (`s3://…`) branch ──────────────────────────────────────────
        if check_s3 {
            if let PathOrFileDescriptor::Path(p) = &*path_or_fd {
                if p.slice().starts_with(b"s3://") {
                    let vm = global_this.bun_vm().as_mut();
                    // `bun_dotenv::Loader` (T2) returns its local POD mirror by
                    // reference; lift it into the refcounted
                    // `bun_s3_signing::S3Credentials` here at the T6 call site
                    // (dotenv cannot name the s3_signing type — upward dep).
                    let env_creds = vm.transpiler.env_mut().get_s3_credentials();
                    let credentials = crate::webcore::fetch::s3_credentials_from_env(env_creds);
                    let copy = core::mem::replace(
                        path_or_fd,
                        PathOrFileDescriptor::Path(PathLike::default()),
                    );
                    let PathOrFileDescriptor::Path(path) = copy else {
                        unreachable!()
                    };
                    return Blob::init_with_store(
                        bun_core::handle_oom(Store::init_s3(path, None, credentials)),
                        global_this,
                    );
                }
            }
        }

        let path: PathOrFileDescriptor = match path_or_fd {
            PathOrFileDescriptor::Path(_) => {
                #[cfg(windows)]
                if path_or_fd.path().slice() == b"/dev/null" {
                    // The assignment below drops the old `PathLike` (releasing
                    // the caller-owned path) as part of the `*path_or_fd = …`
                    // write.
                    *path_or_fd = PathOrFileDescriptor::Path(PathLike::borrowed(b"\\\\.\\NUL"));
                }

                if let Some(file) = bun_standalone_graph::Graph::get_ref()
                    .and_then(|graph| graph.find_ref(path_or_fd.path().slice()))
                {
                    return crate::api::standalone_graph_jsc::file_blob(file, global_this);
                }

                core::mem::replace(path_or_fd, PathOrFileDescriptor::Path(PathLike::default()))
                    .thread_isolated_copy()
            }
            PathOrFileDescriptor::Fd(fd) => {
                if let Some(tag) = fd.stdio_tag() {
                    let store = global_this.bun_vm().as_mut().rare_data().stdio_store(tag);
                    return Blob::init_with_store(store, global_this);
                }
                PathOrFileDescriptor::Fd(*fd)
            }
        };

        Blob::init_with_store(
            bun_core::handle_oom(Store::init_file(path, None)),
            global_this,
        )
    }
    fn is_all_ascii(&self) -> Option<bool> {
        match self.charset.get() {
            strings::AsciiStatus::Unknown => None,
            strings::AsciiStatus::AllAscii => Some(true),
            strings::AsciiStatus::NonAscii => Some(false),
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Basic accessors
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// JSC-integration methods (host fns, to_js/from_js, S3/file I/O state machines)
// ──────────────────────────────────────────────────────────────────────────

use crate::api::archive::Archive;
use crate::image::Image;
use crate::node;
use crate::webcore::s3::client as s3_client;
use crate::webcore::s3::simple_request::S3UploadResult;
use crate::webcore::s3_file as S3File;
use bun_jsc::SysErrorJsc as _;
// The `write_file` module name coexists with `pub fn write_file` below (module
// vs value namespace); alias the module so the call sites read unambiguously.
use self::write_file as write_file_mod;
use self::write_file::{WriteFilePromise, WriteFileWaitFromLockedValueTask};
use bun_bundler::options_impl::LoaderExt as _;
use bun_jsc::JsClass as _;

pub(crate) use bun_jsc::dom_form_data::FormDataEntry;

/// Blob `to_js` for every tier (`JsClass::to_js` links here): heap-promote
/// `blob` into a new `JSBlob` — or `JSS3File` — wrapper that owns it.
// HOST_EXPORT(__bun_blob_to_js, rust)
pub fn blob_to_js(blob: crate::webcore::Blob, global_object: &JSGlobalObject) -> JSValue {
    blob.calculate_estimated_byte_size();
    let is_s3 = blob.is_s3();
    let this = Blob::new(blob);
    if is_s3 {
        return crate::webcore::s3_file::to_js_unchecked(global_object, this);
    }
    js::to_js_unchecked(global_object, this)
}

// ──────────────────────────────────────────────────────────────────────────
// Parts — pieces of a blob under assembly
// ──────────────────────────────────────────────────────────────────────────

/// One piece of a blob being assembled from JS values, holding whatever keeps
/// its bytes alive until [`Parts::done`] copies them out.
enum Part<'a> {
    Borrowed(&'a [u8]),
    Owned(Box<[u8]>),
    /// A string's bytes (and the pin on them, if any).
    Slice(Utf8Bytes<'a>),
    /// A rooted typed array's bytes; only pushed when no user JS can run
    /// (and detach it) before `done`.
    Buffer(jsc::ArrayBuffer),
    /// `range` of a blob's store bytes.
    Store(RefPtr<Store>, Range<usize>),
    ContentType(BlobContentType),
}

impl Part<'_> {
    fn of_blob(blob: &Blob) -> Part<'static> {
        match blob.store() {
            Some(store) => Part::Store(store.clone(), blob.shared_view_range()),
            None => Part::Borrowed(b""),
        }
    }

    fn bytes(&self) -> &[u8] {
        match self {
            Part::Borrowed(s) => s,
            Part::Owned(s) => s,
            Part::Slice(s) => s.slice(),
            Part::Buffer(b) => b.byte_slice(),
            Part::Store(store, range) => &store.shared_view()[range.clone()],
            Part::ContentType(c) => c.as_slice(),
        }
    }
}

#[derive(Default)]
struct Parts<'a> {
    parts: Vec<Part<'a>>,
    len: usize,
}

impl<'a> Parts<'a> {
    fn reserve(&mut self, additional: usize) {
        self.parts.reserve(additional);
    }

    fn push(&mut self, part: Part<'a>) {
        let n = part.bytes().len();
        if n == 0 {
            return;
        }
        self.len += n;
        self.parts.push(part);
    }

    fn push_static(&mut self, bytes: &'a [u8]) {
        self.push(Part::Borrowed(bytes));
    }

    fn push_owned(&mut self, bytes: Box<[u8]>) {
        self.push(Part::Owned(bytes));
    }

    fn push_cloned(&mut self, bytes: &[u8]) {
        if bytes.is_empty() {
            return;
        }
        self.push(Part::Owned(Box::from(bytes)));
    }

    /// Every piece, concatenated.
    fn done(self) -> Vec<u8> {
        let mut out = Vec::with_capacity(self.len);
        for part in &self.parts {
            out.extend_from_slice(part.bytes());
        }
        out
    }
}

// ──────────────────────────────────────────────────────────────────────────
// FormDataContext
// ──────────────────────────────────────────────────────────────────────────

/// Stack-local helper for `Blob::from_dom_form_data`. `boundary` borrows the
/// caller's `hex_buf` and `global_this` borrows the incoming `&JSGlobalObject`;
/// both strictly outlive this struct, so they are stored as plain references
/// rather than raw pointers.
struct FormDataContext<'a> {
    joiner: Parts<'a>,
    boundary: &'a [u8], // borrowed; outlives the joiner
    failed: bool,
    global_this: &'a JSGlobalObject,
}

/// Which piece of a `multipart/form-data` entry a string is, selecting the
/// transforms the WHATWG "multipart/form-data encoding algorithm" applies to
/// it: <https://html.spec.whatwg.org/multipage/form-control-infrastructure.html#multipart-form-data>
#[derive(Clone, Copy, PartialEq, Eq)]
enum FormDataComponent {
    /// Entry name: newlines normalized to CRLF, then `"`/CR/LF percent-encoded.
    Name,
    /// Non-File entry value: newlines normalized to CRLF, emitted unescaped.
    StringValue,
    /// Filename: `"`/CR/LF percent-encoded only; the spec does not normalize it.
    Filename,
}

/// WHATWG HTML "multipart/form-data encoding algorithm". Names and non-File
/// values first have every CR, LF, and CRLF replaced with CRLF; names and
/// filenames are then percent-encoded (`"` -> `%22`, CR -> `%0D`, LF -> `%0A`)
/// so they cannot terminate the quoted-string or inject part headers. Returns
/// `None` when no byte needs either transform so the caller can keep using the
/// original bytes without a copy.
fn encode_form_data_component(bytes: &[u8], component: FormDataComponent) -> Option<Box<[u8]>> {
    let escape = component != FormDataComponent::StringValue;
    let normalize = component != FormDataComponent::Filename;
    // Only the bytes a transform rewrites are needles; for a string value a
    // `"` stays literal and must not force a copy.
    let needles: &'static [u8] = if escape { b"\"\r\n" } else { b"\r\n" };

    // SIMD scan; the first hit doubles as the "needs a copy at all?" fast
    // path. `highway` directly: `bun_core::immutable::index_of_any` narrows
    // the index to `u32`, which a multi-GiB string value can overflow.
    let mut i = bun_highway::index_of_any_char(bytes, needles)?;
    let mut remain = bytes;
    let mut out = Vec::with_capacity(bytes.len() + 8);
    loop {
        out.extend_from_slice(&remain[..i]);
        let b = remain[i];
        let mut consumed = 1;
        match b {
            // `"` is a needle only when `escape` is set.
            b'"' => out.extend_from_slice(b"%22"),
            _ if normalize => {
                // CR, LF, and CRLF all normalize to one CRLF before escaping.
                out.extend_from_slice(if escape { b"%0D%0A" } else { b"\r\n" });
                if b == b'\r' && remain.get(i + 1) == Some(&b'\n') {
                    consumed = 2;
                }
            }
            b'\r' => out.extend_from_slice(b"%0D"),
            _ => out.extend_from_slice(b"%0A"),
        }
        remain = &remain[i + consumed..];
        match bun_highway::index_of_any_char(remain, needles) {
            Some(next) => i = next,
            None => break,
        }
    }
    out.extend_from_slice(remain);
    Some(out.into_boxed_slice())
}

impl<'a> FormDataContext<'a> {
    /// Append the UTF-8 view of a form-data string without copying it: the
    /// borrowed case points into a WTF string owned by the `DOMFormData` being
    /// serialized, which outlives `joiner.done()` in `from_dom_form_data`; an owned slice
    /// (UTF-16 / non-ASCII Latin-1 conversion) transfers its allocation to the
    /// joiner. `component` selects the spec's newline-normalization and
    /// percent-encoding transforms, which copy when they apply.
    fn push_string_slice(
        joiner: &mut Parts<'a>,
        slice: Utf8Bytes<'a>,
        component: FormDataComponent,
    ) {
        if let Some(encoded) = encode_form_data_component(slice.slice(), component) {
            joiner.push_owned(encoded);
            return;
        }
        match slice {
            // `into_vec` moves the buffer out of an `Owned` slice without copying.
            Utf8Bytes::Owned(_) => joiner.push_owned(slice.into_vec().into_boxed_slice()),
            // Borrowed bytes are owned by the `DOMFormData` being serialized,
            // which outlives `joiner.done()` in `from_dom_form_data`.
            Utf8Bytes::Borrowed(_) => joiner.push(Part::Slice(slice)),
            // Releases its ref on drop — copy rather than borrow past it.
            Utf8Bytes::Shared(_) => joiner.push_cloned(slice.slice()),
        }
    }

    #[allow(clippy::needless_pass_by_value)] // the shape `DOMFormData::for_each` yields
    fn on_entry(&mut self, name: EncodedSlice<'a>, entry: FormDataEntry<'a>) {
        if self.failed {
            return;
        }
        // Copy the borrowed refs out first (disjoint-field reads) so the
        // long-lived `&mut self.joiner` below doesn't conflict.
        let global_this = self.global_this;
        let boundary = self.boundary;
        let joiner = &mut self.joiner;

        joiner.push_static(b"--");
        joiner.push_static(boundary); // note: "static" here means "outlives the joiner"
        joiner.push_static(b"\r\n");

        joiner.push_static(b"Content-Disposition: form-data; name=\"");
        Self::push_string_slice(joiner, name.to_utf8(), FormDataComponent::Name);

        match entry {
            FormDataEntry::String(value) => {
                joiner.push_static(b"\"\r\n\r\n");
                Self::push_string_slice(joiner, value.to_utf8(), FormDataComponent::StringValue);
            }
            FormDataEntry::File { blob, filename } => {
                joiner.push_static(b"\"; filename=\"");
                Self::push_string_slice(joiner, filename.to_utf8(), FormDataComponent::Filename);
                joiner.push_static(b"\"\r\n");

                let blob_ct = blob.content_type_slice();
                joiner.push_static(b"Content-Type: ");
                if !blob_ct.is_empty() && !strings::contains_any(blob_ct, b"\r\n") {
                    joiner.push(Part::ContentType(blob.content_type.get().clone()));
                } else {
                    joiner.push_static(b"application/octet-stream");
                }
                joiner.push_static(b"\r\n\r\n");

                if blob.store.get().is_some() {
                    if blob.size.get() == MAX_SIZE {
                        blob.resolve_size();
                    }
                    let store = blob
                        .store
                        .get()
                        .as_deref()
                        .expect("infallible: store present");
                    match &store.data {
                        store::Data::S3(_) => {
                            // TODO: s3
                            // we need to make this async and use download/downloadSlice
                        }
                        store::Data::File(file) => {
                            // TODO: make this async + lazy
                            // Use a fresh stack
                            // `NodeFS` (it is stateless aside from a path scratch
                            // buffer; a per-VM cache would be purely a perf reuse).
                            let mut node_fs = crate::node::fs::NodeFS::default();
                            // `ReadFile` has `Drop`; can't use FRU `..Default::default()`.
                            let mut rf_args = crate::node::fs::args::ReadFile::default();
                            rf_args.encoding = crate::node::types::Encoding::Buffer;
                            rf_args.path = file.pathlike.clone();
                            rf_args.offset = blob.offset.get();
                            rf_args.max_size = Some(blob.size.get());
                            let res = node_fs.read_file(&rf_args, crate::node::fs::Flavor::Sync);
                            match res {
                                Err(err) => {
                                    self.failed = true;
                                    let js_err = err.to_js(global_this);
                                    let _ = global_this.throw_value(js_err);
                                }
                                Ok(mut result) => {
                                    joiner.push_cloned(result.slice());
                                    // StringOrBuffer::Drop is a no-op for Buffer; release
                                    // the readFile allocation explicitly.
                                    if let crate::node::types::StringOrBuffer::Buffer(buf) =
                                        &mut result
                                    {
                                        buf.destroy();
                                    }
                                }
                            }
                        }
                        store::Data::Bytes(_) => {
                            joiner.push(Part::of_blob(blob));
                        }
                    }
                }
            }
        }

        joiner.push_static(b"\r\n");
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Structured clone serialize / deserialize
// ──────────────────────────────────────────────────────────────────────────

// Only ever called with f64 (Blob.last_modified). A concrete impl
// because Rust forbids `[u8; size_of::<F>()]`
// without `generic_const_exprs`. Bit-cast → native-endian bytes.
fn write_float<W: bun_io::Write>(value: f64, writer: &mut W) -> crate::Result<()> {
    Ok(writer.write_all(&value.to_ne_bytes())?)
}

fn read_float<B: AsRef<[u8]>>(reader: &mut bun_io::FixedBufferStream<B>) -> crate::Result<f64> {
    let mut bytes_buf = [0u8; core::mem::size_of::<f64>()];
    reader.read_exact(&mut bytes_buf)?;
    Ok(f64::from_ne_bytes(bytes_buf))
}

fn read_slice<B: AsRef<[u8]>>(
    reader: &mut bun_io::FixedBufferStream<B>,
    len: usize,
) -> crate::Result<Vec<u8>> {
    let buffer = reader.buffer.as_ref();
    let end = reader
        .pos
        .checked_add(len)
        .filter(|&end| end <= buffer.len())
        .ok_or(crate::Error::TooSmall)?;
    let slice = buffer[reader.pos..end].to_vec();
    reader.pos = end;
    Ok(slice)
}

fn on_structured_clone_deserialize<B: AsRef<[u8]>>(
    global_this: &JSGlobalObject,
    reader: &mut bun_io::FixedBufferStream<B>,
) -> crate::Result<JSValue> {
    let version = reader.read_int_le::<u8>()?;
    let offset = reader.read_int_le::<u64>()?;

    let content_type_len = reader.read_int_le::<u32>()?;
    let content_type = read_slice(reader, content_type_len as usize)?;

    let content_type_was_set: bool = reader.read_int_le::<u8>()? != 0;

    let store_tag = store::SerializeTag::from_raw(reader.read_int_le::<u8>()?)
        .ok_or(crate::Error::InvalidValue)?;

    // Version 4: file-backed records carry the blob's own size so a sliced
    // Bun.file() keeps its window's end. MAX_SIZE means unknown.
    let mut file_size: Option<u64> = None;

    // Until `to_js` at the end, an early return drops `blob` and with it the
    // store (and payload bytes) it owns.
    let blob: Blob = match store_tag {
        store::SerializeTag::Bytes => 'bytes: {
            let bytes_len = reader.read_int_le::<u32>()?;
            let bytes = read_slice(reader, bytes_len as usize)?;

            let blob = Blob::init(bytes, global_this);

            'versions: {
                if version == 1 {
                    break 'versions;
                }

                let name_len = reader.read_int_le::<u32>()?;
                let name = read_slice(reader, name_len as usize)?;

                if let Some(store) = blob.store() {
                    if let store::Data::Bytes(bytes_store) = &mut Store::data_mut(store) {
                        // Transfer ownership of the local `name: Vec<u8>` into
                        // `stored_name` (a `Box<[u8]>`); freed by `Bytes::Drop`.
                        bytes_store.stored_name = name.into_boxed_slice();
                    }
                }
                // else: `name` drops here.

                if version == 2 {
                    break 'versions;
                }
            }

            break 'bytes blob;
        }
        store::SerializeTag::File => 'file: {
            use crate::node::types::PathOrFileDescriptorSerializeTag;
            if version >= 4 {
                file_size = Some(reader.read_int_le::<u64>()?);
            }
            let pathlike_tag =
                PathOrFileDescriptorSerializeTag::from_raw(reader.read_int_le::<u8>()?)
                    .ok_or(crate::Error::InvalidValue)?;

            match pathlike_tag {
                PathOrFileDescriptorSerializeTag::Fd => {
                    let fd: Fd = reader.read_struct()?;
                    // Wire bytes are untrusted: enforce the same range as `FdJsc::from_js_validated`
                    // so a crafted record cannot materialize an fd no JS could construct (fd == -1
                    // hits `Fd::as_borrowed_fd`'s `raw != -1` assert on posix and aborts).
                    #[cfg(not(windows))]
                    if fd.0 < 0 {
                        return Err(crate::Error::InvalidValue);
                    }
                    let mut path_or_fd = PathOrFileDescriptor::Fd(fd);
                    break 'file Blob::find_or_create_file_from_path(
                        &mut path_or_fd,
                        global_this,
                        true,
                    );
                }
                PathOrFileDescriptorSerializeTag::Path => {
                    let path_len = reader.read_int_le::<u32>()?;
                    let path = read_slice(reader, path_len as usize)?;
                    // Same constraint the JS entry (`Valid::path_null_bytes`)
                    // enforces: a NUL-embedded path cannot be handed to the
                    // syscall layer (`ZStr::as_cstr` would truncate / panic).
                    if strings::index_of_char(&path, 0).is_some() {
                        return Err(crate::Error::InvalidValue);
                    }
                    let mut dest = PathOrFileDescriptor::Path(PathLike::owned(path));
                    break 'file Blob::find_or_create_file_from_path(&mut dest, global_this, true);
                }
            }
        }
        store::SerializeTag::Empty => Blob::init_empty(global_this),
    };

    'versions: {
        if version == 1 {
            break 'versions;
        }

        blob.is_jsdom_file.set(reader.read_int_le::<u8>()? != 0);
        blob.last_modified.set(read_float(reader)?);

        if version == 2 {
            break 'versions;
        }

        // Version 3: Read File name if this is a File object
        if blob.is_jsdom_file.get() {
            let name_len = reader.read_int_le::<u32>()?;
            let name_bytes = read_slice(reader, name_len as usize)?;
            blob.name.set(BunString::clone_utf8(&name_bytes));
        }

        if version == 3 {
            break 'versions;
        }
    }

    // `offset` comes from untrusted bytes. Clamp it so a crafted payload cannot
    // make shared_view() slice past the end of the backing store (OOB heap read).
    blob.offset.set(offset as SizeType); // intentional truncate
    if let Some(size) = file_size {
        // resolve_size() clamps this to the actual file size on first use.
        if size != MAX_SIZE {
            blob.size.set(size as SizeType);
        }
    }
    if let Some(store) = blob.store.get() {
        let store_size = store.size();
        if store_size != MAX_SIZE {
            blob.offset.set(blob.offset.get().min(store_size));
            blob.size
                .set(blob.size.get().min(store_size - blob.offset.get()));
        }
    } else {
        blob.offset.set(0);
    }

    if !content_type.is_empty() {
        blob.content_type
            .set(BlobContentType::Owned(std::sync::Arc::from(content_type)));
        blob.content_type_was_set.set(content_type_was_set);
    }

    Ok(blob.to_js(global_this))
}

// ──────────────────────────────────────────────────────────────────────────
// URLSearchParamsConverter / fromURLSearchParams / fromDOMFormData
// ──────────────────────────────────────────────────────────────────────────

struct URLSearchParamsConverter {
    buf: Vec<u8>,
}

impl URLSearchParamsConverter {
    fn convert(&mut self, str: EncodedSlice) {
        self.buf = str.to_owned_slice();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// C-exported helpers
// ──────────────────────────────────────────────────────────────────────────

/// A new heap `Blob` sharing `value`'s store, or null if `value` is not a `Blob`.
// HOST_EXPORT(Blob__dupeFromJS, c)
pub fn blob_dupe_from_js(value: JSValue) -> *mut crate::webcore::Blob {
    match value.as_class_ref::<Blob>() {
        Some(blob) => blob_dupe(blob),
        None => core::ptr::null_mut(),
    }
}

// HOST_EXPORT(Blob__setAsFile, c)
pub fn blob_set_as_file(this: &crate::webcore::Blob, path_str: &bun_core::String) {
    this.is_jsdom_file.set(true);
    if !path_str.is_empty() && this.get_file_name().is_none() {
        this.name.set(path_str.clone());
    }
}

/// A new heap `Blob` (refcount 1, for C++ to adopt) sharing `this`'s store.
// HOST_EXPORT(Blob__dupe, c)
pub fn blob_dupe(this: &crate::webcore::Blob) -> *mut crate::webcore::Blob {
    Blob::new(this.dupe_with_content_type(true))
}

// HOST_EXPORT(Blob__getFileNameString, c)
pub fn blob_get_file_name_string(this: &crate::webcore::Blob) -> BunString {
    this.get_name_string()
        .map_or(BunString::EMPTY, Clone::clone)
}

// ──────────────────────────────────────────────────────────────────────────
// writeFormat
// ──────────────────────────────────────────────────────────────────────────

pub(crate) fn write_format_for_size<W: core::fmt::Write, const ENABLE_ANSI_COLORS: bool>(
    is_jdom_file: bool,
    size: usize,
    writer: &mut W,
) -> core::fmt::Result {
    if is_jdom_file {
        bun_core::write_pretty!(writer, ENABLE_ANSI_COLORS, "<r>File<r>")?;
    } else {
        bun_core::write_pretty!(writer, ENABLE_ANSI_COLORS, "<r>Blob<r>")?;
    }
    bun_core::write_pretty!(
        writer,
        ENABLE_ANSI_COLORS,
        " (<yellow>{f}<r>)",
        bun_core::fmt::size(size, Default::default()),
    )
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

/// Create the parent directories of `path`.
#[inline(never)]
pub(crate) fn mkdirp_parent(path: &[u8]) -> bun_sys::Result<()> {
    let Some(dirname) = bun_core::dirname(path) else {
        return Err(bun_sys::Error::from_code(
            bun_sys::E::ENOENT,
            bun_sys::Tag::mkdir,
        ));
    };
    node::fs::NodeFS::default()
        .mkdir_recursive(&node::fs::args::Mkdir {
            path: PathLike::borrowed(dirname),
            recursive: true,
            always_return_none: true,
            ..Default::default()
        })
        .map(|_| ())
}

// TODO: move this to bun_sys?
#[inline(never)]
#[cfg_attr(windows, allow(dead_code))] // the Windows writers mkdirp through `AsyncMkdirp`
pub(crate) fn mkdir_if_not_exists<T: MkdirpTarget>(
    this: &mut T,
    err: &bun_sys::Error,
    path_string: &bun_core::ZStr,
    err_path: &[u8],
) -> Retry {
    if err.get_errno() == bun_sys::E::ENOENT && this.mkdirp_if_not_exists() {
        match mkdirp_parent(path_string.as_bytes()) {
            bun_sys::Result::Ok(()) => {
                this.set_mkdirp_if_not_exists(false);
                return Retry::Continue;
            }
            bun_sys::Result::Err(err2) => {
                this.set_errno_if_present(bun_errno::from_errno(err2.errno as i32).into());
                this.set_system_error(err.with_path(err_path).to_system_error());
                this.set_opened_fd_if_present(Fd::INVALID);
                return Retry::Fail;
            }
        }
    }
    Retry::No
}

/// `bun_sys::Error` only
/// exposes `with_path(&[u8])`, so route through the
/// `PathOrFileDescriptor`'s slice when it's a path and leave the error
/// unchanged for fds.
#[inline]
fn sys_error_with_path_like(
    err: &bun_sys::Error,
    pathlike: &PathOrFileDescriptor,
) -> bun_sys::Error {
    match pathlike {
        PathOrFileDescriptor::Path(p) => err.with_path(p.slice()),
        PathOrFileDescriptor::Fd(_) => err.clone(),
    }
}

/// Receiver trait for `mkdir_if_not_exists`; impls optionally
/// write `errno` / `opened_fd` via the defaulted setters.
pub trait MkdirpTarget {
    fn mkdirp_if_not_exists(&self) -> bool;
    fn set_mkdirp_if_not_exists(&mut self, v: bool);
    fn set_system_error(&mut self, e: bun_sys::SystemError);
    fn set_errno_if_present(&mut self, _e: crate::Error) {}
    fn set_opened_fd_if_present(&mut self, _fd: Fd) {}
}

// ──────────────────────────────────────────────────────────────────────────
// writeFileWithEmptySourceToDestination / writeFileWithSourceDestination
// ──────────────────────────────────────────────────────────────────────────

fn body_used_rejection(global: &JSGlobalObject) -> JSValue {
    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
        global,
        global
            .err(
                jsc::ErrorCode::BODY_ALREADY_USED,
                format_args!("Body already used"),
            )
            .to_js(),
    )
}

#[derive(Default, Clone, Copy)]
pub struct WriteFileOptions {
    pub(crate) mkdirp_if_not_exists: Option<bool>,
    pub(crate) extra_options: Option<JSValue>,
    pub(crate) mode: Option<bun_sys::Mode>,
}

/// Write an empty string to a file by truncating it.
///
/// This behavior matches what we do with the fast path.
fn write_file_with_empty_source_to_destination(
    ctx: &JSGlobalObject,
    destination_blob: &mut Blob,
    options: &WriteFileOptions,
) -> JsResult<JSValue> {
    let destination_store = destination_blob
        .store()
        .expect("infallible: store present")
        .clone();
    let destination_blob = &*destination_blob;
    let _detach = scopeguard::guard((), |_| destination_blob.detach());

    match &destination_store.data {
        store::Data::File(file) => {
            // TODO: make this async
            // `VirtualMachine::node_fs()` currently returns `*mut c_void`; the
            // typed `&mut NodeFS` accessor isn't wired yet, so use a fresh
            // `NodeFS` (it carries no per-call state for
            // `truncate`/`mkdir_recursive`).
            let mut node_fs = node::fs::NodeFS::default();
            let mut result = node_fs.truncate(
                &node::fs::args::Truncate {
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
                            bun_sys::E::EPERM => {
                                was_eperm = true;
                                err.errno = bun_sys::E::ENOENT as _;
                                current = bun_sys::E::ENOENT;
                                continue;
                            }
                            bun_sys::E::ENOENT => {
                                if options.mkdirp_if_not_exists == Some(false) {
                                    break 'err;
                                }
                                let dirpath: &[u8] = match &file.pathlike {
                                    PathOrFileDescriptor::Path(path) => {
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
                                let mkdir_result =
                                    node_fs.mkdir_recursive(&node::fs::args::Mkdir {
                                        path: PathLike::borrowed(dirpath),
                                        recursive: true,
                                        always_return_none: true,
                                        ..Default::default()
                                    });
                                if let bun_sys::Result::Err(e) = mkdir_result {
                                    *err = e;
                                    break 'err;
                                }

                                // `file.pathlike` is a path: the fd case returned above.
                                let mut buf = bun_paths::PathBuffer::uninit();
                                let mode: bun_sys::Mode =
                                    options.mode.unwrap_or(node::fs::DEFAULT_PERMISSION);
                                match bun_sys::File::open(
                                    file.pathlike.path().slice_z(&mut buf),
                                    bun_sys::O::CREAT | bun_sys::O::TRUNC,
                                    mode,
                                ) {
                                    bun_sys::Result::Err(e) => {
                                        *err = e;
                                        break 'err;
                                    }
                                    bun_sys::Result::Ok(f) => {
                                        let _ = f.close(); // close error is non-actionable
                                        return Ok(JSPromise::resolved_promise_value(
                                            ctx,
                                            JSValue::js_number(0.0),
                                        ));
                                    }
                                }
                            }
                            _ => break 'err,
                        }
                    }
                }

                *err = sys_error_with_path_like(err, &file.pathlike);
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        ctx,
                        err.to_js(ctx),
                    ),
                );
            }
        }
        store::Data::S3(s3) => {
            // create empty file
            let aws_options = match s3.get_credentials_with_options(options.extra_options, ctx) {
                Ok(o) => o,
                Err(err) => {
                    return Ok(
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            ctx,
                            ctx.take_exception(err),
                        ),
                    );
                }
            };

            let mut promise = jsc::JSPromiseStrong::init(ctx);
            let promise_value = promise.value();
            let store = destination_store.clone();
            let global = bun_ptr::BackRef::new(ctx);
            let resolve = move |result: S3UploadResult<'_>| -> JsResult<()> {
                let global = global.get();
                match result {
                    S3UploadResult::Success => promise.resolve(global, JSValue::js_number(0.0))?,
                    S3UploadResult::Failure(err) => {
                        let err_js = s3_client::error_jsc::s3_error_to_js_with_async_stack(
                            &err,
                            global,
                            store.get_path(),
                            promise.get(),
                        );
                        promise.reject(global, Ok(err_js))?;
                    }
                }
                Ok(())
            };
            let proxy_owned = http_proxy_href(ctx);
            let proxy_url = proxy_owned.as_deref();
            s3_client::upload(
                &aws_options.credentials,
                s3.path(),
                b"",
                destination_blob.content_type_or_mime_type(),
                aws_options.content_disposition.as_deref(),
                aws_options.content_encoding.as_deref(),
                aws_options.acl,
                proxy_url,
                aws_options.storage_class,
                aws_options.request_payer,
                Box::new(resolve),
            )?;
            return Ok(promise_value);
        }
        // Writing to a buffer-backed blob should be a type error,
        // making this unreachable. TODO: `{}` -> `unreachable`
        store::Data::Bytes(_) => {}
    }

    Ok(JSPromise::resolved_promise_value(
        ctx,
        JSValue::js_number(0.0),
    ))
}

pub(crate) fn write_file_with_source_destination(
    ctx: &JSGlobalObject,
    source_blob: &mut Blob,
    destination_blob: &mut Blob,
    options: &WriteFileOptions,
) -> JsResult<JSValue> {
    let destination_store = destination_blob
        .store
        .get()
        .clone()
        .unwrap_or_else(|| Output::panic(format_args!("Destination blob is detached")));
    let destination_type = destination_store.data.tag();

    // TODO: make sure this invariant isn't being broken elsewhere, then upgrade to allow_assert
    debug_assert!(
        destination_type != store::DataTag::Bytes,
        "Cannot write to a Blob backed by a Buffer or TypedArray. This is a bug in the caller."
    );

    let Some(source_store) = source_blob.store.get().clone() else {
        return write_file_with_empty_source_to_destination(ctx, destination_blob, options);
    };
    let source_type = source_store.data.tag();

    if destination_type == store::DataTag::File && source_type == store::DataTag::Bytes {
        // The borrowed views below are +0 on the store ref;
        // `WriteFile::create` takes its own ref.
        #[cfg(windows)]
        {
            let promise = WriteFilePromise::new(ctx);
            let promise_value = promise.value();
            promise_value.ensure_still_alive();
            match write_file_mod::WriteFileWindows::create(
                ctx.bun_vm(),
                destination_blob.borrowed_view(),
                source_blob.borrowed_view(),
                promise,
                options.mkdirp_if_not_exists.unwrap_or(true),
            ) {
                Err(write_file_mod::WriteFileWindowsError::WriteFileWindowsDeinitialized) => {}
                Err(write_file_mod::WriteFileWindowsError::Js(err)) => return Err(err),
                Ok(()) => {}
            }
            return Ok(promise_value);
        }

        #[cfg(not(windows))]
        {
            let file_copier = write_file_mod::WriteFile::create(
                destination_blob.borrowed_view(),
                source_blob.borrowed_view(),
                options.mkdirp_if_not_exists.unwrap_or(true),
            )
            .expect("unreachable");
            // Defer promise creation until we're just about to schedule the task.
            let promise = WriteFilePromise::new(ctx);
            let promise_value = promise.value();
            promise_value.ensure_still_alive();
            write_file_mod::WriteFile::schedule(file_copier, promise, ctx);
            return Ok(promise_value);
        }
    }
    // If this is file <> file, we can just copy the file
    else if destination_type == store::DataTag::File && source_type == store::DataTag::File {
        #[cfg(windows)]
        {
            return Ok(copy_file::CopyFileWindows::init(
                destination_store,
                source_store,
                ctx.bun_vm().event_loop_shared(),
                options.mkdirp_if_not_exists.unwrap_or(true),
                destination_blob.size.get(),
                options.mode,
            ));
        }
        #[cfg(not(windows))]
        {
            return Ok(copy_file::CopyFile::create(
                destination_store,
                source_store,
                destination_blob.offset.get(),
                destination_blob.size.get(),
                ctx,
                options.mkdirp_if_not_exists.unwrap_or(true),
                options.mode,
            ));
        }
    } else if destination_type == store::DataTag::File && source_type == store::DataTag::S3 {
        let s3 = source_store.data.as_s3();
        if let Some(stream) = ReadableStream::from_js(
            ReadableStream::from_blob_copy_ref(
                ctx,
                source_blob,
                s3.options.part_size as crate::webcore::blob::SizeType,
            )?,
            ctx,
        )? {
            return destination_blob.pipe_readable_stream_to_blob(ctx, stream, options);
        } else {
            return Ok(
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    ctx,
                    ctx.create_error_instance(format_args!(
                        "Failed to stream bytes from s3 bucket"
                    )),
                ),
            );
        }
    } else if destination_type == store::DataTag::Bytes && source_type == store::DataTag::Bytes {
        // If this is bytes <> bytes, we can just duplicate it
        // this is an edgecase
        // it will happen if someone did Bun.write(new Blob([123]), new Blob([456]))
        let cloned = source_blob.dupe().to_js(ctx);
        return Ok(JSPromise::resolved_promise_value(ctx, cloned));
    } else if destination_type == store::DataTag::Bytes
        && (source_type == store::DataTag::File || source_type == store::DataTag::S3)
    {
        let blob_value = source_blob.get_slice_from(ctx, 0, 0, BlobContentType::default());
        return Ok(JSPromise::resolved_promise_value(ctx, blob_value));
    } else if destination_type == store::DataTag::S3 {
        let s3 = destination_store.data.as_s3();
        let aws_options = match s3.get_credentials_with_options(options.extra_options, ctx) {
            Ok(o) => o,
            Err(err) => {
                return Ok(
                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                        ctx,
                        ctx.take_exception(err),
                    ),
                );
            }
        };
        let proxy_owned = http_proxy_href(ctx);
        let proxy_url = proxy_owned.as_deref();
        match &source_store.data {
            store::Data::Bytes(bytes) => {
                if bytes.len() as usize > S3::MultiPartUploadOptions::MAX_SINGLE_UPLOAD_SIZE {
                    if let Some(stream) = ReadableStream::from_js(
                        ReadableStream::from_blob_copy_ref(
                            ctx,
                            source_blob,
                            s3.options.part_size as crate::webcore::blob::SizeType,
                        )?,
                        ctx,
                    )? {
                        return s3_client::upload_stream(
                            if options.extra_options.is_some() {
                                aws_options.credentials.dupe()
                            } else {
                                s3.get_credentials().clone()
                            },
                            s3.path(),
                            stream,
                            ctx,
                            aws_options.options,
                            aws_options.acl,
                            aws_options.storage_class,
                            destination_blob.content_type_or_mime_type(),
                            aws_options.content_disposition.as_deref(),
                            aws_options.content_encoding.as_deref(),
                            proxy_url,
                            aws_options.request_payer,
                            None,
                            core::ptr::null_mut(),
                        );
                    } else {
                        return Ok(JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            ctx,
                            ctx.create_error_instance(format_args!("Failed to stream bytes to s3 bucket")),
                        ));
                    }
                } else {
                    let mut promise = jsc::JSPromiseStrong::init(ctx);
                    let promise_value = promise.value();
                    let store = source_store.clone();
                    let global = bun_ptr::BackRef::new(ctx);
                    let resolve = move |result: S3UploadResult<'_>| -> JsResult<()> {
                        let global = global.get();
                        match result {
                            S3UploadResult::Success => {
                                promise.resolve(
                                    global,
                                    JSValue::js_number(store.data.as_bytes().len() as f64),
                                )?;
                            }
                            S3UploadResult::Failure(err) => {
                                let err_js = s3_client::error_jsc::s3_error_to_js_with_async_stack(
                                    &err,
                                    global,
                                    store.get_path(),
                                    promise.get(),
                                );
                                promise.reject(global, Ok(err_js))?;
                            }
                        }
                        Ok(())
                    };
                    s3_client::upload(
                        &aws_options.credentials,
                        s3.path(),
                        bytes.slice(),
                        destination_blob.content_type_or_mime_type(),
                        aws_options.content_disposition.as_deref(),
                        aws_options.content_encoding.as_deref(),
                        aws_options.acl,
                        proxy_url,
                        aws_options.storage_class,
                        aws_options.request_payer,
                        Box::new(resolve),
                    )?;
                    return Ok(promise_value);
                }
            }
            store::Data::File(_) | store::Data::S3(_) => {
                // stream
                if let Some(stream) = ReadableStream::from_js(
                    ReadableStream::from_blob_copy_ref(
                        ctx,
                        source_blob,
                        s3.options.part_size as crate::webcore::blob::SizeType,
                    )?,
                    ctx,
                )? {
                    return s3_client::upload_stream(
                        if options.extra_options.is_some() {
                            aws_options.credentials.dupe()
                        } else {
                            s3.get_credentials().clone()
                        },
                        s3.path(),
                        stream,
                        ctx,
                        s3.options,
                        aws_options.acl,
                        aws_options.storage_class,
                        destination_blob.content_type_or_mime_type(),
                        aws_options.content_disposition.as_deref(),
                        aws_options.content_encoding.as_deref(),
                        proxy_url,
                        aws_options.request_payer,
                        None,
                        core::ptr::null_mut(),
                    );
                } else {
                    return Ok(
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            ctx,
                            ctx.create_error_instance(format_args!(
                                "Failed to stream bytes to s3 bucket"
                            )),
                        ),
                    );
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
/// - If `path_or_blob` is a `Blob` backed by a byte store. A destination that
///   comes from JS must go through [`write_destination_from_js`] first.
pub(crate) fn write_file_internal(
    global_this: &JSGlobalObject,
    path_or_blob_: &mut PathOrBlob,
    data: JSValue,
    options: WriteFileOptions,
) -> JsResult<JSValue> {
    if data.is_empty_or_undefined_or_null() {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write"
        )));
    }
    // Blob is non-Clone, so reborrow.
    let path_or_blob = &mut *path_or_blob_;
    if let PathOrBlob::Blob(ref blob) = *path_or_blob {
        let Some(blob_store) = blob.store.get() else {
            return Err(global_this.throw_invalid_arguments(format_args!("Blob is detached")));
        };
        debug_assert!(!matches!(blob_store.data, store::Data::Bytes(_)));
        // TODO only reset last_modified on success paths instead of resetting
        // last_modified at the beginning for better performance.
        if let store::Data::File(ref mut file) = *Store::data_mut(blob_store) {
            file.last_modified = jsc::INIT_TIMESTAMP;
        }
    }

    let input_store: Option<RefPtr<Store>> = if let PathOrBlob::Blob(ref b) = *path_or_blob {
        b.store.get().clone()
    } else {
        None
    };
    // RefPtr<Store> clone+drop keeps the store alive for the duration of this call.
    let _input_store_hold = input_store;

    if let Some(mkdir) = options.mkdirp_if_not_exists {
        if mkdir
            && matches!(*path_or_blob, PathOrBlob::Blob(ref b)
                if b.store.get().is_some()
                    && matches!(b.store().expect("infallible: store present").data, store::Data::File(ref f)
                        if matches!(f.pathlike, PathOrFileDescriptor::Fd(_))))
        {
            return Err(global_this.throw_invalid_arguments(format_args!(
                "Cannot create a directory for a file descriptor"
            )));
        }
    }

    // If you're doing Bun.write(), try to go fast by writing short input on the main thread.
    // This is a heuristic, but it's a good one.
    //
    // except if you're on Windows. Windows I/O is slower. Let's not even try.
    #[cfg(not(windows))]
    {
        let mut needs_async = false;
        let fast_path_ok = matches!(*path_or_blob, PathOrBlob::Path(_))
            || (matches!(*path_or_blob, PathOrBlob::Blob(ref b)
                if b.offset.get() == 0 && !b.is_s3()
                    && !(b.store.get().is_some()
                        && matches!(b.store().expect("infallible: store present").data, store::Data::File(ref f)
                            if f.mode != 0 && bun_core::kind_from_mode(f.mode) == bun_core::FileKind::File))));
        if fast_path_ok {
            if data.is_string() {
                let len = data.get_length(global_this)?;
                if len < 256 * 1024 {
                    let str = data.to_bun_string(global_this)?;
                    let pathlike: &PathOrFileDescriptor = match &*path_or_blob {
                        PathOrBlob::Path(p) => p,
                        PathOrBlob::Blob(b) => {
                            &b.store()
                                .expect("infallible: store present")
                                .data
                                .as_file()
                                .pathlike
                        }
                    };
                    let result = if matches!(pathlike, PathOrFileDescriptor::Path(_)) {
                        write_string_to_file_fast::<true>(
                            global_this,
                            pathlike,
                            &str,
                            &mut needs_async,
                        )
                    } else {
                        write_string_to_file_fast::<false>(
                            global_this,
                            pathlike,
                            &str,
                            &mut needs_async,
                        )
                    };
                    if !needs_async {
                        return Ok(result);
                    }
                }
            } else if let Some(buffer_view) = data.as_array_buffer(global_this) {
                if buffer_view.byte_len < 256 * 1024 {
                    let pathlike: &PathOrFileDescriptor = match &*path_or_blob {
                        PathOrBlob::Path(p) => p,
                        PathOrBlob::Blob(b) => {
                            &b.store()
                                .expect("infallible: store present")
                                .data
                                .as_file()
                                .pathlike
                        }
                    };
                    let result = if matches!(pathlike, PathOrFileDescriptor::Path(_)) {
                        write_bytes_to_file_fast::<true>(
                            global_this,
                            pathlike,
                            buffer_view.byte_slice(),
                            &mut needs_async,
                        )
                    } else {
                        write_bytes_to_file_fast::<false>(
                            global_this,
                            pathlike,
                            buffer_view.byte_slice(),
                            &mut needs_async,
                        )
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
            if new_blob.store.get().is_none() {
                return Err(global_this.throw_invalid_arguments(format_args!(
                    "Writing to an empty blob is not implemented yet"
                )));
            }
            new_blob
        }
        PathOrBlob::Blob(b) => {
            debug_assert!(b.store.get().is_some());
            b.dupe()
        }
    };

    // TODO: implement a writev() fast path
    let source_blob: Blob = 'brk: {
        // `Response` and `Request` both expose `body_value()` /
        // `get_body_readable_stream()` (`BodyMixin`). Every body borrow below
        // is re-derived and scoped so none spans the JS-running calls in the
        // arms.
        fn body_dispatch<B: webcore::body::BodyMixin>(
            body: &B,
            destination_blob: &mut Blob,
            global_this: &JSGlobalObject,
            options: &WriteFileOptions,
        ) -> JsResult<core::ops::ControlFlow<JSValue, Blob>> {
            use core::ops::ControlFlow;
            use webcore::body::Value as BodyValue;
            enum BodyTag {
                Use,
                Error,
                Locked,
            }
            // A stream someone holds a reader on, or has read from, is theirs.
            let existing =
                body.get_body_readable_stream()
                    .or_else(|| match body.body_value().get() {
                        BodyValue::Locked(locked) => locked.readable.get(),
                        _ => None,
                    });
            if let Some(readable) = existing {
                if readable.is_locked(global_this) || readable.is_disturbed(global_this) {
                    destination_blob.detach();
                    return Ok(ControlFlow::Break(body_used_rejection(global_this)));
                }
            }
            // A body that is all here (also behind an untouched `.body` stream) is written as a blob.
            body.body_value().with_mut(|v| v.to_blob_if_possible());
            let tag = match body.body_value().get() {
                BodyValue::Error(_) => BodyTag::Error,
                BodyValue::Locked(_) => BodyTag::Locked,
                BodyValue::Used => {
                    destination_blob.detach();
                    return Ok(ControlFlow::Break(body_used_rejection(global_this)));
                }
                _ => BodyTag::Use,
            };
            match tag {
                BodyTag::Use => {
                    // `use_()` runs no JS.
                    Ok(ControlFlow::Continue(
                        body.body_value().with_mut(|v| v.use_()),
                    ))
                }
                BodyTag::Error => {
                    let err_js = body.body_value().with_mut(|v| {
                        let BodyValue::Error(err_ref) = v else {
                            unreachable!()
                        };
                        err_ref.to_js(global_this)
                    });
                    destination_blob.detach();
                    let _ = body.body_value().with_mut(|v| v.use_());
                    Ok(ControlFlow::Break(
                        JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                            global_this,
                            err_js,
                        ),
                    ))
                }
                BodyTag::Locked => {
                    if destination_blob.is_s3() {
                        let dest_store = destination_blob
                            .store()
                            .expect("infallible: store present")
                            .clone();
                        let s3 = dest_store.data.as_s3();
                        let aws_options =
                            s3.get_credentials_with_options(options.extra_options, global_this)?;
                        // May run JS.
                        let _ = body
                            .body_value()
                            .with_mut(|v| v.to_readable_stream(global_this))?;
                        let readable_opt = body.get_body_readable_stream().or_else(|| {
                            let BodyValue::Locked(locked) = body.body_value().get() else {
                                return None;
                            };
                            locked.readable.get()
                        });
                        if let Some(readable) = readable_opt {
                            if readable.is_disturbed(global_this) {
                                destination_blob.detach();
                                return Err(global_this.throw_invalid_arguments(format_args!(
                                    "ReadableStream has already been used"
                                )));
                            }
                            let proxy_owned = http_proxy_href(global_this);
                            let proxy_url = proxy_owned.as_deref();
                            return Ok(ControlFlow::Break(s3_client::upload_stream(
                                if options.extra_options.is_some() {
                                    aws_options.credentials.dupe()
                                } else {
                                    s3.get_credentials().clone()
                                },
                                s3.path(),
                                readable,
                                global_this,
                                aws_options.options,
                                aws_options.acl,
                                aws_options.storage_class,
                                destination_blob.content_type_or_mime_type(),
                                aws_options.content_disposition.as_deref(),
                                aws_options.content_encoding.as_deref(),
                                proxy_url,
                                aws_options.request_payer,
                                None,
                                core::ptr::null_mut(),
                            )?));
                        }
                        destination_blob.detach();
                        return Err(global_this.throw_invalid_arguments(format_args!(
                            "ReadableStream has already been used"
                        )));
                    }
                    // A body that is a stream, or that its producer can stream (fetch, the
                    // server, HTMLRewriter): pipe it into the file instead of collecting it in
                    // memory first. The stream also outlives the Response it came from.
                    let streamable = body.get_body_readable_stream().is_some()
                        || body.body_value().with_mut(|v| {
                            let BodyValue::Locked(locked) = v else {
                                unreachable!()
                            };
                            locked.readable.has() || locked.on_start_streaming.is_some()
                        });
                    if streamable {
                        // May run JS.
                        let _ = body
                            .body_value()
                            .with_mut(|v| v.to_readable_stream(global_this))?;
                        let readable = body.get_body_readable_stream().or_else(|| {
                            let BodyValue::Locked(locked) = body.body_value().get() else {
                                return None;
                            };
                            locked.readable.get()
                        });
                        // `to_readable_stream` may have replaced the value.
                        if let (Some(readable), BodyValue::Locked(_)) =
                            (readable, body.body_value().get())
                        {
                            let promise = destination_blob.pipe_readable_stream_to_blob(
                                global_this,
                                readable,
                                options,
                            )?;
                            // The destination could not be opened: the stream was not touched and
                            // is still the body's.
                            let failed = promise.as_any_promise().is_some_and(|p| {
                                matches!(p.status(), jsc::js_promise::Status::Rejected)
                            });
                            if !failed {
                                // The stream now belongs to the sink.
                                body.body_value().set(BodyValue::Used);
                            }
                            return Ok(ControlFlow::Break(promise));
                        }
                        // The producer settled the body while the stream was being made.
                        enum Settled {
                            No,
                            Error(JSValue),
                            Value,
                        }
                        let settled = body.body_value().with_mut(|v| match v {
                            BodyValue::Locked(_) => Settled::No,
                            BodyValue::Error(err) => Settled::Error(err.to_js(global_this)),
                            _ => Settled::Value,
                        });
                        match settled {
                            Settled::No => {}
                            Settled::Error(err_js) => {
                                destination_blob.detach();
                                let _ = body.body_value().with_mut(|v| v.use_());
                                return Ok(ControlFlow::Break(
                                    JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                                        global_this,
                                        err_js,
                                    ),
                                ));
                            }
                            Settled::Value => {
                                return Ok(ControlFlow::Continue(
                                    body.body_value().with_mut(|v| v.use_()),
                                ));
                            }
                        }
                    }
                    let task = Box::new(WriteFileWaitFromLockedValueTask {
                        global_this: bun_ptr::BackRef::new(global_this),
                        // Move `destination_blob` by value into the task.
                        file_blob: core::mem::replace(
                            destination_blob,
                            Blob::init_empty(global_this),
                        ),
                        promise: jsc::JSPromiseStrong::init(global_this),
                        mkdirp_if_not_exists: options.mkdirp_if_not_exists.unwrap_or(true),
                    });
                    let promise = task.promise.value();
                    let producer_hook = body.body_value().with_mut(|v| {
                        let BodyValue::Locked(locked) = v else {
                            unreachable!()
                        };
                        let producer_hook = locked.on_start_buffering.take().zip(locked.task);
                        locked.on_receive_value =
                            Some(webcore::body::ReceiveValue::WriteFile(task));
                        producer_hook
                    });
                    // Signalled last (see `PendingValue::on_start_buffering`):
                    // the task may run and the body value be replaced inside.
                    if let Some((on_start_buffering, producer_task)) = producer_hook {
                        on_start_buffering(producer_task);
                    }
                    Ok(ControlFlow::Break(promise))
                }
            }
        }

        if let Some(response) = data.as_class_ref::<Response>() {
            match body_dispatch(response, &mut destination_blob, global_this, &options)? {
                core::ops::ControlFlow::Break(v) => return Ok(v),
                core::ops::ControlFlow::Continue(b) => break 'brk b,
            }
        }

        if let Some(request) = data.as_class_ref::<Request>() {
            match body_dispatch(request, &mut destination_blob, global_this, &options)? {
                core::ops::ControlFlow::Break(v) => return Ok(v),
                core::ops::ControlFlow::Continue(b) => break 'brk b,
            }
        }

        // Check for Archive - allows Bun.write() and S3 writes to accept Archive instances
        if let Some(archive) = data.as_class_ref::<Archive>() {
            break 'brk Blob::init_with_store(archive.store_ref().clone(), global_this);
        }

        if let Some(readable) = ReadableStream::from_js_direct(data) {
            if readable.is_locked(global_this) || readable.is_disturbed(global_this) {
                destination_blob.detach();
                return Ok(body_used_rejection(global_this));
            }
            return destination_blob.pipe_readable_stream_to_blob(global_this, readable, &options);
        }

        break 'brk Blob::get::<false, false>(global_this, data)?;
    };
    // Detach the source blob on scope exit.
    let mut source_blob = scopeguard::guard(source_blob, |b| b.detach());

    let destination_store = destination_blob.store.get().clone();
    // RefPtr<Store> clone+drop keeps the destination store alive across the call.
    let _dest_hold = destination_store;

    write_file_with_source_destination(
        global_this,
        &mut *source_blob,
        &mut destination_blob,
        &options,
    )
}

fn validate_writable_blob(global_this: &JSGlobalObject, blob: &Blob) -> JsResult<()> {
    let Some(store) = blob.store.get() else {
        return Err(global_this.throw(format_args!("Cannot write to a detached Blob")));
    };
    if matches!(store.data, store::Data::Bytes(_)) {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "Cannot write to a Blob backed by bytes, which are always read-only"
        )));
    }
    Ok(())
}

/// Parses the destination argument of `Bun.write` (shared by `Image.write`):
/// a path, a file descriptor, or a `Bun.file()` / S3 blob. A `Blob` that is
/// not backed by a file or S3 is rejected here; that is the precondition
/// [`write_file_internal`] relies on for a `PathOrBlob::Blob` destination.
pub(crate) fn write_destination_from_js(
    global_this: &JSGlobalObject,
    args: &mut jsc::ArgumentsSlice,
) -> JsResult<PathOrBlob> {
    let path_or_blob = PathOrBlob::from_js_no_copy(global_this, args)?;
    if let PathOrBlob::Blob(ref blob) = path_or_blob {
        validate_writable_blob(global_this, blob)?;
    }
    Ok(path_or_blob)
}

/// Applies a write-path `options.type` override to `blob`. Throws if the
/// value is not a string; an invalid blob type is silently ignored.
fn set_content_type_from_js(
    global_this: &JSGlobalObject,
    blob: &Blob,
    content_type: JSValue,
) -> JsResult<()> {
    if !content_type.is_string() {
        return Err(global_this.throw_invalid_argument_type("write", "options.type", "string"));
    }
    let content_type_str = content_type.to_utf8(global_this)?;
    let slice = content_type_str.slice();
    if is_valid_blob_type(slice) {
        blob.content_type_was_set.set(true);
        blob.content_type
            .set(match global_this.bun_vm().as_mut().mime_type(slice) {
                Some(mime) => BlobContentType::from(mime),
                None => BlobContentType::from_lowercased(slice),
            });
    }
    Ok(())
}

/// `Bun.write(destination, input, options?)`
pub(crate) fn write_file(global_this: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let arguments = callframe.arguments();
    let mut args = jsc::ArgumentsSlice::init(global_this.bun_vm(), arguments);

    let mut path_or_blob = write_destination_from_js(global_this, &mut args)?;

    let Some(data) = args.next_eat() else {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "Bun.write(pathOrFdOrBlob, blob) expects a Blob-y thing to write"
        )));
    };
    let mut mkdirp_if_not_exists: Option<bool> = None;
    let mut mode: Option<bun_sys::Mode> = None;
    let options = args.next_eat();
    if let Some(options_object) = options {
        if options_object.is_object() {
            if let Some(create_directory) = options_object.get_truthy(global_this, "createPath")? {
                if !create_directory.is_boolean() {
                    return Err(global_this.throw_invalid_argument_type(
                        "write",
                        "options.createPath",
                        "boolean",
                    ));
                }
                mkdirp_if_not_exists = Some(create_directory.to_boolean());
            }
            if let Some(mode_value) = options_object.get(global_this, "mode")? {
                if !mode_value.is_empty_or_undefined_or_null() {
                    if !mode_value.is_number() {
                        return Err(global_this.throw_invalid_argument_type(
                            "write",
                            "options.mode",
                            "number",
                        ));
                    }
                    let mode_int = mode_value.to_int64();
                    if mode_int < 0 || mode_int > 0o777 {
                        return Err(global_this.throw_range_error(
                            mode_int,
                            jsc::RangeErrorOptions {
                                field_name: b"mode",
                                min: 0,
                                max: 0o777,
                                msg: b"",
                            },
                        ));
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
        &mut path_or_blob,
        data,
        WriteFileOptions {
            mkdirp_if_not_exists,
            extra_options: options,
            mode,
        },
    )
}

const WRITE_PERMISSIONS: bun_sys::Mode = 0o664;

#[cfg(not(windows))]
fn write_string_to_file_fast<const NEEDS_OPEN: bool>(
    global_this: &JSGlobalObject,
    pathlike: &PathOrFileDescriptor,
    str: &BunString,
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

    // Declared before the truncate guard so it drops *after* it (close runs last).
    let _close = NEEDS_OPEN.then(|| bun_sys::CloseOnDrop::new(fd));

    // scopeguard's closure captures borrows at construction, conflicting
    // with later `written += ...` / `truncate = false`. Route through `Cell`
    // so the guard and the loop body share `&Cell<_>` (no mutable-borrow conflict).
    let truncate = core::cell::Cell::new(NEEDS_OPEN || str.is_empty());
    let written = core::cell::Cell::new(0usize);

    // we only truncate if it's a path
    // if it's a file descriptor, we assume they want manual control over that behavior
    scopeguard::defer! {
        if truncate.get() {
            let _ = bun_sys::ftruncate(fd, i64::try_from(written.get()).expect("int cast"));
        }
    }

    if !str.is_empty() {
        let decoded = str.to_utf8();
        let mut remain = decoded.slice();
        while !remain.is_empty() {
            match bun_sys::write(fd, remain) {
                bun_sys::Result::Ok(res) => {
                    written.set(written.get() + res);
                    remain = &remain[res..];
                    if res == 0 {
                        break;
                    }
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

#[cfg(not(windows))]
fn write_bytes_to_file_fast<const NEEDS_OPEN: bool>(
    global_this: &JSGlobalObject,
    pathlike: &PathOrFileDescriptor,
    bytes: &[u8],
    _needs_async: &mut bool,
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
        match bun_sys::open(
            pathlike.path().slice_z(&mut file_path),
            flags,
            WRITE_PERMISSIONS,
        ) {
            bun_sys::Result::Ok(result) => result,
            bun_sys::Result::Err(err) => {
                #[cfg(not(windows))]
                if err.get_errno() == bun_sys::E::ENOENT {
                    *_needs_async = true;
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
    let _close = NEEDS_OPEN.then(|| bun_sys::CloseOnDrop::new(fd));

    let mut remain = bytes;
    while !remain.is_empty() {
        match bun_sys::write(fd, remain) {
            bun_sys::Result::Ok(res) => {
                written += res;
                remain = &remain[res..];
                if res == 0 {
                    break;
                }
            }
            bun_sys::Result::Err(err) => {
                #[cfg(not(windows))]
                if err.get_errno() == bun_sys::E::EAGAIN {
                    *_needs_async = true;
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
        let _ = bun_sys::ftruncate(fd, i64::try_from(written).expect("int cast"));
    }

    JSPromise::resolved_promise_value(global_this, JSValue::js_number(written as f64))
}

// ──────────────────────────────────────────────────────────────────────────
// JSDOMFile constructor
// ──────────────────────────────────────────────────────────────────────────

/// C++ side declares `extern "C" SYSV_ABI void* JSDOMFile__construct(...)` (JSDOMFile.cpp).
// HOST_EXPORT(JSDOMFile__construct, jsc)
pub fn jsdom_file_construct_export(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> *mut crate::webcore::Blob {
    match jsdom_file_construct(global_this, callframe) {
        Ok(b) => b,
        Err(jsc::JsError::Thrown) => core::ptr::null_mut(),
        Err(jsc::JsError::Terminated) => {
            // A constructor runs beneath script: rethrow so the caller keeps unwinding.
            let _ = bun_jsc::Stopped.throw(global_this);
            core::ptr::null_mut()
        }
        Err(jsc::JsError::OutOfMemory) => {
            let _ = global_this.throw_out_of_memory();
            core::ptr::null_mut()
        }
    }
}

pub(crate) fn jsdom_file_construct(
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<*mut Blob> {
    jsc::mark_binding();
    let args = callframe.arguments();

    if args.len() < 2 {
        return Err(global_this.throw_invalid_arguments(format_args!(
            "new File(bits, name) expects at least 2 arguments"
        )));
    }
    let name = BunString::from_js(args[1], global_this)?;
    let blob = Blob::get::<false, true>(global_this, args[0])?;
    // The store may be shared with the source blob (`dupe()`); never rename it.
    blob.name.set(name);

    let mut set_last_modified = false;

    if args.len() > 2 {
        let options = args[2];
        if options.is_object() {
            // type, the ASCII-encoded string in lower case
            // representing the media type of the Blob.
            if let Some(content_type) = options.get(global_this, "type")? {
                'inner: {
                    if content_type.is_string() {
                        let content_type_str = content_type.to_utf8(global_this)?;
                        let slice = content_type_str.slice();
                        if !is_valid_blob_type(slice) {
                            break 'inner;
                        }
                        blob.content_type_was_set.set(true);
                        blob.content_type.set(
                            match global_this.bun_vm().as_mut().mime_type(slice) {
                                Some(mime) => BlobContentType::from(mime),
                                None => BlobContentType::from_lowercased(slice),
                            },
                        );
                    }
                }
            }

            // WebIDL dictionary member: only `undefined` / not-present falls
            // through to the Date.now() default. Any present value (including
            // `null`) goes through ToNumber, with NaN normalized to 0.
            if let Some(last_modified) = options.get(global_this, "lastModified")? {
                set_last_modified = true;
                let n = last_modified.to_number(global_this)?;
                blob.last_modified.set(if n.is_nan() { 0.0 } else { n });
            }
        }
    }

    if !set_last_modified {
        // `lastModified` should be the current date in milliseconds if unspecified.
        blob.last_modified
            .set(bun_core::time::milli_timestamp() as f64);
    }

    if blob.content_type_slice().is_empty() {
        blob.content_type.set(BlobContentType::default());
        blob.content_type_was_set.set(false);
    }

    blob.is_jsdom_file.set(true);
    Ok(Blob::new(blob))
}

// ──────────────────────────────────────────────────────────────────────────
// estimatedSize / constructBunFile / findOrCreateFileFromPath
// ──────────────────────────────────────────────────────────────────────────

// `calculate_estimated_byte_size` / `estimated_size`: canonical impls live
// later in this file (near `dupe`/`to_js`). Duplicates removed here.

pub(crate) fn construct_bun_file(
    global_object: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let vm = global_object.bun_vm();
    let arguments_slice = callframe.arguments();
    let mut args = jsc::ArgumentsSlice::init(vm, arguments_slice);

    let Some(mut path) = PathOrFileDescriptor::from_js(global_object, &mut args)? else {
        return Err(global_object.throw_invalid_arguments(format_args!(
            "Expected file path string or file descriptor"
        )));
    };
    let options = if arguments_slice.len() >= 2 {
        Some(arguments_slice[1])
    } else {
        None
    };

    if let PathOrFileDescriptor::Path(ref p) = path {
        if p.slice().starts_with(b"s3://") {
            // The clone owns a copy of a buffer's bytes; `path` unpins at scope exit.
            return S3File::construct_internal_js(global_object, p.clone(), options);
        }
    }

    let blob = Blob::find_or_create_file_from_path(&mut path, global_object, false);

    if let Some(opts) = options {
        if opts.is_object() {
            if let Some(file_type) = opts.get_truthy(global_object, "type")? {
                'inner: {
                    if file_type.is_string() {
                        let str = file_type.to_utf8(global_object)?;
                        let slice = str.slice();
                        if !is_valid_blob_type(slice) {
                            break 'inner;
                        }
                        blob.content_type_was_set.set(true);
                        blob.content_type.set(
                            match global_object.bun_vm().as_mut().mime_type(slice) {
                                Some(mime) => BlobContentType::from(mime),
                                None => BlobContentType::from_lowercased(slice),
                            },
                        );
                    }
                }
            }
            if let Some(last_modified) = opts.get(global_object, "lastModified")? {
                let n = last_modified.to_number(global_object)?;
                blob.last_modified.set(if n.is_nan() { 0.0 } else { n });
            }
        }
    }

    Ok(blob.to_js(global_object))
}

// `find_or_create_file_from_path`: canonical impl lives later in this file
// (runtime `check_s3: bool` form). Const-generic duplicate removed here.

// ──────────────────────────────────────────────────────────────────────────
// getStream / toStreamWithOffset / lifetimeWrap / accessor host fns
// ──────────────────────────────────────────────────────────────────────────

// The `Lifetime` collapses to a
// captured constant inside `JSPromise::wrap`'s `FnOnce(&JSGlobalObject)`, so
// no dedicated wrap helper is needed at each call site.

// ──────────────────────────────────────────────────────────────────────────
// S3BlobDownloadTask
// ──────────────────────────────────────────────────────────────────────────

struct S3BlobDownloadTask {
    pub(crate) blob: Blob,
    /// JSC_BORROW: process-lifetime global; `BackRef` so the deref is safe and
    /// the borrow detaches from `&self` (Copy) for use across `&mut self` calls.
    pub global_this: bun_ptr::BackRef<JSGlobalObject>,
    pub(crate) promise: jsc::JSPromiseStrong,
    pub poll_ref: bun_io::KeepAlive,
    pub(crate) handler: S3ReadHandler,
}

/// `(blob, global, bytes)`: `bytes` is the window of `blob`'s freshly
/// installed store holding the download.
type S3ReadHandler = fn(&Blob, bun_ptr::BackRef<JSGlobalObject>, Range<usize>) -> JSValue;

impl S3BlobDownloadTask {
    pub(crate) fn call_handler(&mut self, bytes: Range<usize>) -> JSValue {
        (self.handler)(&self.blob, self.global_this, bytes)
    }

    #[allow(clippy::boxed_local, reason = "reclaim point for the boxed task")]
    pub(crate) fn on_s3_download_resolved(
        result: crate::webcore::__s3_client::S3DownloadResult,
        mut this: Box<S3BlobDownloadTask>,
    ) -> JsResult<()> {
        // Copy the `BackRef` out so the `&JSGlobalObject` borrow is detached
        // from `this` (it must coexist with `&mut this` calls below).
        let global_ref = this.global_this;
        let global = global_ref.get();
        match result {
            crate::webcore::__s3_client::S3DownloadResult::Success(response) => {
                // Move the downloaded body into a Blob store so its lifetime is
                // tied to the Blob/JS view and freed via the store's finalizer.
                let len = response.body.list.len();
                let store = Store::init(response.body.list);
                this.blob.store.set(Some(store));
                if this.blob.size.get() == MAX_SIZE {
                    this.blob.size.set(len as SizeType);
                }
                let value = JSPromise::wrap(global, |_g| Ok(this.call_handler(0..len)))?;
                this.promise.resolve(global, value)?;
            }
            crate::webcore::__s3_client::S3DownloadResult::NotFound(err)
            | crate::webcore::__s3_client::S3DownloadResult::Failure(err) => {
                let path = this.blob.store().and_then(|s| s.get_path());
                let promise = this.promise.get();
                let value = crate::webcore::s3::client::error_jsc::s3_error_to_js_with_async_stack(
                    &err, global, path, promise,
                );
                this.promise.reject(global, Ok(value))?;
            }
        }
        Ok(())
    }

    pub(crate) fn init(
        global_this: &JSGlobalObject,
        blob: &Blob,
        handler: S3ReadHandler,
    ) -> JsResult<JSValue> {
        // The callback may read this.blob.content_type, which is heap-owned by the
        // source JS Blob and freed on finalize(). Take an owning dupe so the task
        // outliving the source can't dangle.
        let mut this = Box::new(S3BlobDownloadTask {
            global_this: bun_ptr::BackRef::new(global_this),
            blob: Blob::dupe(blob),
            promise: jsc::JSPromiseStrong::init(global_this),
            poll_ref: bun_io::KeepAlive::default(),
            handler,
        });
        this.poll_ref.ref_(bun_io::js_vm_ctx());
        let promise = this.promise.value();
        // The task moves into the download's completion, so read what the
        // request needs out of its blob's store (a fresh +1 ref) first.
        let store = this
            .blob
            .store()
            .expect("infallible: store present")
            .clone();
        let store::Data::S3(s3_store) = &store.data else {
            unreachable!("S3BlobDownloadTask::init on non-S3 blob")
        };
        let credentials = s3_store.get_credentials();
        let path = s3_store.path();

        let proxy_owned = http_proxy_href(global_this);
        let proxy = proxy_owned.as_deref();

        let s3_cb = Box::new(
            move |result: crate::webcore::__s3_client::S3DownloadResult<'_>| {
                S3BlobDownloadTask::on_s3_download_resolved(result, this)
            },
        );

        if blob.offset.get() > 0 {
            let len: Option<usize> = if blob.size.get() != MAX_SIZE {
                Some(usize::try_from(blob.size.get()).expect("int cast"))
            } else {
                None
            };
            let offset: usize = usize::try_from(blob.offset.get()).expect("int cast");
            crate::webcore::__s3_client::download_slice(
                credentials,
                path,
                offset,
                len,
                s3_cb,
                proxy,
                s3_store.request_payer,
            )?;
        } else if blob.size.get() == MAX_SIZE {
            crate::webcore::__s3_client::download(
                credentials,
                path,
                s3_cb,
                proxy,
                s3_store.request_payer,
            )?;
        } else {
            let len: usize = usize::try_from(blob.size.get()).expect("int cast");
            let offset: usize = usize::try_from(blob.offset.get()).expect("int cast");
            crate::webcore::__s3_client::download_slice(
                credentials,
                path,
                offset,
                Some(len),
                s3_cb,
                proxy,
                s3_store.request_payer,
            )?;
        }
        Ok(promise)
    }
}

impl Drop for S3BlobDownloadTask {
    fn drop(&mut self) {
        Blob::deinit(&mut self.blob);
        self.poll_ref.unref(bun_io::js_vm_ctx());
        // promise: Drop handles deinit.
    }
}

// ──────────────────────────────────────────────────────────────────────────
// doWrite / doUnlink / getExists
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// FileStreamWrapper / pipeReadableStreamToBlob
// ──────────────────────────────────────────────────────────────────────────

pub struct FileStreamWrapper {
    pub(crate) promise: jsc::JSPromiseStrong,
    pub(crate) readable_stream_ref: webcore::readable_stream::ReadableStreamStrong,
    /// Kept alive by the pump ref `pipe_readable_stream_to_blob` parked in the
    /// sink (`hold_stream_promise_ref`); released on drop.
    pub sink: bun_ptr::BackRef<webcore::FileSink, bun_ptr::Root>,
}

impl Drop for FileStreamWrapper {
    fn drop(&mut self) {
        webcore::FileSink::release_stream_promise_ref(self.sink.this_ptr());
    }
}

// C++ `promiseHandlerID` compares the handler passed to `JSValue::then` against
// these symbols by address, so they must stay function exports. The box comes
// back from the reaction pair; dropping it releases the pump's sink ref.
// HOST_EXPORT(Bun__FileStreamWrapper__onResolveRequestStream, jsc)
#[allow(clippy::boxed_local)] // the reaction hands the box back; dropping it releases the sink ref
pub fn on_file_stream_resolve_request_stream(
    mut this: Box<crate::webcore::blob::FileStreamWrapper>,
    global_this: &JSGlobalObject,
    _callframe: &CallFrame,
) -> JsResult<JSValue> {
    let strong = core::mem::take(&mut this.readable_stream_ref);
    if let Some(stream) = strong.get() {
        stream.done();
    }
    let written = this.sink.stream_bytes.get().unwrap_or(0);
    this.promise
        .resolve(global_this, JSValue::js_number(written as f64))?;
    Ok(JSValue::UNDEFINED)
}

// HOST_EXPORT(Bun__FileStreamWrapper__onRejectRequestStream, jsc)
#[allow(clippy::boxed_local)]
pub fn on_file_stream_reject_request_stream(
    mut this: Box<crate::webcore::blob::FileStreamWrapper>,
    global_this: &JSGlobalObject,
    callframe: &CallFrame,
) -> JsResult<JSValue> {
    let args = callframe.arguments();
    let err = args[0];

    let strong = core::mem::take(&mut this.readable_stream_ref);

    this.promise.reject(global_this, Ok(err))?;

    if let Some(stream) = strong.get() {
        stream.cancel(global_this)?;
    }
    Ok(JSValue::UNDEFINED)
}

// ──────────────────────────────────────────────────────────────────────────
// getSliceFrom / getSlice / type/name/lastModified/size getters
// ──────────────────────────────────────────────────────────────────────────

// HOST_EXPORT(Bun__Blob__getSizeForBindings, c)
pub fn blob_get_size_for_bindings(this: &crate::webcore::Blob) -> u64 {
    this.get_size_for_bindings()
}

/// The start of `value`'s in-memory bytes (null if not a `Blob` or empty);
/// pairs with `Blob__getSize`. Valid while the blob and its store live.
// HOST_EXPORT(Blob__getDataPtr, c)
pub fn blob_get_data_ptr(value: JSValue) -> *const u8 {
    match value.as_class_ref::<Blob>().map(Blob::shared_view) {
        Some(data) if !data.is_empty() => data.as_ptr(),
        _ => core::ptr::null(),
    }
}

// HOST_EXPORT(Blob__getSize, c)
pub fn blob_get_size(value: JSValue) -> usize {
    value
        .as_class_ref::<Blob>()
        .map_or(0, |blob| blob.shared_view().len())
}

// `Blob__fromBytes` / `Blob__fromBytesWithType` / `Blob__fromMmapWithType`
// live next to `Store` in `bun_jsc::webcore_types`.

/// `stat.{st_mtime, st_mtime_nsec}` → JS epoch ms. `bun_sys::Stat` is
/// `libc::stat` on POSIX (fields) and `uv_stat_t` on Windows (`mtim` timespec);
/// cfg-split here so the call sites stay shared.
#[inline]
fn stat_to_js_mtime(stat: &bun_sys::Stat) -> jsc::JSTimeType {
    #[cfg(not(windows))]
    {
        jsc::to_js_time(stat.st_mtime as isize, stat.st_mtime_nsec as isize)
    }
    #[cfg(windows)]
    {
        jsc::to_js_time(stat.mtim.sec as isize, stat.mtim.nsec as isize)
    }
}

/// Window clamp shared by the `resolve_size`/`resolved_size` arms: only an
/// unknown (`MAX_SIZE`) size resolves to the store's remainder; a concrete
/// size (a slice's window) is authoritative, clamped so a bogus or stale
/// value can't report past the end of the backing store.
fn window_size(current: SizeType, available: SizeType) -> SizeType {
    if current == MAX_SIZE {
        available
    } else {
        current.min(available)
    }
}

/// resolve file stat like size, last_modified
fn resolve_file_stat(store: &RefPtr<Store>) {
    // `Store::data_mut` encapsulates the raw-pointer deref under the
    // `RefPtr<Store>` liveness invariant; the caller holds the only ref across
    // this call, so an exclusive borrow is sound.
    let file = Store::data_mut(store).as_file_mut();
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
                    file.last_modified = stat_to_js_mtime(&stat);
                }
                // the file may not exist yet. That's okay.
                _ => {}
            }
        }
        PathOrFileDescriptor::Fd(fd) => match bun_sys::fstat(*fd) {
            bun_sys::Result::Ok(stat) => {
                file.max_size = if bun_sys::S::ISREG(stat.st_mode as _) || stat.st_size > 0 {
                    ((stat.st_size.max(0)) as u64) as SizeType
                } else {
                    MAX_SIZE
                };
                file.mode = stat.st_mode as bun_sys::Mode;
                file.seekable = Some(bun_sys::S::ISREG(stat.st_mode as _));
                file.last_modified = stat_to_js_mtime(&stat);
            }
            _ => {}
        },
    }
}

// ──────────────────────────────────────────────────────────────────────────
// toStringWithBytes / toString / toJSON / toFormData / toArrayBuffer{View}
// ──────────────────────────────────────────────────────────────────────────

// Marker types for static fn dispatch through do_read_file/do_read_from_s3.
// Each implements `ReadFileToJs` so a plain fn-pointer monomorphizes per `*WithBytes` body.
pub(crate) struct ToStringWithBytesFn;
pub(crate) struct ToJsonWithBytesFn;
pub(crate) struct ToArrayBufferWithBytesFn;
pub(crate) struct ToUint8ArrayWithBytesFn;
pub(crate) struct ToFormDataWithBytesFn;

impl read_file::ReadFileToJs for ToStringWithBytesFn {
    fn call(b: &Blob, g: &JSGlobalObject, bytes: SourceBytes) -> JsResult<JSValue> {
        b.to_string_with_bytes(g, bytes)
    }
}
impl read_file::ReadFileToJs for ToJsonWithBytesFn {
    fn call(b: &Blob, g: &JSGlobalObject, bytes: SourceBytes) -> JsResult<JSValue> {
        b.to_json_with_bytes(g, bytes)
    }
}
impl read_file::ReadFileToJs for ToArrayBufferWithBytesFn {
    fn call(b: &Blob, g: &JSGlobalObject, bytes: SourceBytes) -> JsResult<JSValue> {
        b.to_array_buffer_with_bytes(g, bytes)
    }
}
impl read_file::ReadFileToJs for ToUint8ArrayWithBytesFn {
    fn call(b: &Blob, g: &JSGlobalObject, bytes: SourceBytes) -> JsResult<JSValue> {
        b.to_uint8_array_with_bytes(g, bytes)
    }
}
impl read_file::ReadFileToJs for ToFormDataWithBytesFn {
    fn call(b: &Blob, g: &JSGlobalObject, bytes: SourceBytes) -> JsResult<JSValue> {
        // FormData ignores lifetime — bytes are read-only.
        Ok(b.to_form_data_with_bytes(g, bytes))
    }
}

// ──────────────────────────────────────────────────────────────────────────
// get / fromJSMove / fromJSClone / fromJSWithoutDeferGC
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Core constructors / JS bridging (init_with_store / to_js /
// find_or_create_file_from_path). These are referenced by `Bun.file` /
// `Bun.stdin` / `Bun.stdout` / `Bun.stderr` callers in BunObject /
// ReadableStream / Archive / server.
// ──────────────────────────────────────────────────────────────────────────

// ──────────────────────────────────────────────────────────────────────────
// Any (AnyBlob)
// ──────────────────────────────────────────────────────────────────────────

// Constructed/matched by-value
// across many crates (spawn stdio, shell, ReadableStream, DevServer, fetch);
// boxing the `Blob` arm would change the public ABI in all of them.
#[allow(clippy::large_enum_variant)]
pub enum Any {
    Blob(Blob),
    InternalBlob(Internal),
    WTFStringImpl(bun_core::WTFString),
}

impl Any {
    /// Unwrap the `InternalBlob` payload. Panics on any other variant — callers
    /// (e.g. DevServer asset bundling) only invoke this on values they
    /// constructed via `from_owned_slice`.
    pub(crate) fn internal_blob(&self) -> &Internal {
        match self {
            Any::InternalBlob(ib) => ib,
            _ => unreachable!("Any::internal_blob called on non-InternalBlob variant"),
        }
    }

    pub(crate) fn from_owned_slice(bytes: Vec<u8>) -> Any {
        Any::InternalBlob(Internal {
            bytes,
            was_string: false,
        })
    }

    pub(crate) fn from_array_list(list: Vec<u8>) -> Any {
        Any::InternalBlob(Internal {
            bytes: list,
            was_string: false,
        })
    }

    /// Assumed that AnyBlob itself is covered by the caller.
    pub(crate) fn memory_cost(&self) -> usize {
        match self {
            Any::Blob(blob) => blob.store().map(|s| s.memory_cost()).unwrap_or(0),
            Any::WTFStringImpl(s) => {
                if s.ref_count() == 1 {
                    s.memory_cost()
                } else {
                    0
                }
            }
            Any::InternalBlob(ib) => ib.memory_cost(),
        }
    }

    pub(crate) fn get_file_name(&self) -> Option<bun_core::Utf8Bytes<'_>> {
        match self {
            Any::Blob(b) => b.get_file_name(),
            Any::WTFStringImpl(_) | Any::InternalBlob(_) => None,
        }
    }

    #[inline]
    pub(crate) fn fast_size(&self) -> SizeType {
        match self {
            Any::Blob(b) => b.size.get(),
            Any::WTFStringImpl(s) => s.byte_length() as SizeType,
            Any::InternalBlob(_) => self.slice().len() as SizeType,
        }
    }

    #[inline]
    pub(crate) fn size(&self) -> SizeType {
        match self {
            Any::Blob(b) => b.size.get(),
            Any::WTFStringImpl(s) => s.utf8_byte_length() as SizeType,
            _ => self.slice().len() as SizeType,
        }
    }

    pub(crate) fn has_content_type_from_user(&self) -> bool {
        match self {
            Any::Blob(b) => b.has_content_type_from_user(),
            Any::WTFStringImpl(_) | Any::InternalBlob(_) => false,
        }
    }
}

// ─── Any: JSC-integration (to_js/from_js paths) ──────────────────────────────

impl Any {
    fn to_internal_blob_if_possible(&mut self) {
        if let Any::Blob(blob) = self {
            if let Some(s) = blob.store.get() {
                if matches!(s.data, store::Data::Bytes(_)) && s.has_one_ref() {
                    let internal = Store::data_mut(s).as_bytes_mut().to_internal_blob();
                    *self = Any::InternalBlob(internal);
                    return;
                }
            }
        }
    }

    pub(crate) fn to_action_value(
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
                    return self.to_array_buffer_view::<{ jsc::JSType::Uint8Array }>(
                        global_this,
                        Lifetime::Clone,
                    );
                }
                self.to_uint8_array_transfer(global_this)
            }
            streams::BufferActionTag::Blob => {
                let result = self.to_blob(global_this);
                result.global_this.set(global_this);
                Ok(result.to_js(global_this))
            }
            streams::BufferActionTag::ArrayBuffer => {
                if matches!(self, Any::Blob(_)) {
                    return self.to_array_buffer_view::<{ jsc::JSType::ArrayBuffer }>(
                        global_this,
                        Lifetime::Clone,
                    );
                }
                self.to_array_buffer_transfer(global_this)
            }
            streams::BufferActionTag::Json => self.to_json(global_this, Lifetime::Share),
        }
    }

    pub(crate) fn to_promise(
        &mut self,
        global_this: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> JsResult<JSValue> {
        // `JSPromise::wrap` takes a `FnOnce(&JSGlobalObject) -> JsResult<JSValue>`;
        // capture `self`/`action` in the closure.
        JSPromise::wrap(global_this, |g| self.to_action_value(g, action))
    }

    pub(crate) fn wrap(
        &mut self,
        promise: jsc::AnyPromise,
        global_this: &JSGlobalObject,
        action: streams::BufferActionTag,
    ) -> JsResult<()> {
        // Must route through `AnyPromise::wrap` (NOT open-coded resolve/reject):
        // it opens a `top_scope!` and calls `to_action_value` via
        // `JSC__AnyPromise__wrap` → `to_js_host_call`, so the C++ ThrowScope inside
        // `JSGenericTypedArrayView::create` (reached unscoped via
        // `JSUint8Array__fromDefaultAllocator` on the `InternalBlob` →
        // `from_default_allocator` path) has a parent that observes its
        // `simulateThrow()`. The previous open-coded form ran `to_action_value`
        // at scope-depth 0 from the event-loop `ByteStream::on_data` → `fulfill`
        // path, then constructed the `cpp::JSC__JSPromise__resolve` `top_scope!`
        // — whose ctor asserted (`verifyExceptionCheckNeedIsSatisfied`) on the
        // unchecked simulated throw under `BUN_JSC_validateExceptionChecks=1`.
        promise.wrap(global_this, |g| self.to_action_value(g, action))
    }

    pub(crate) fn to_json(
        &mut self,
        global: &JSGlobalObject,
        lifetime: Lifetime,
    ) -> JsResult<JSValue> {
        match self {
            Any::Blob(b) => b.to_json(global, lifetime),
            Any::InternalBlob(ib) => {
                if ib.bytes.is_empty() {
                    return Ok(JSValue::NULL);
                }
                let str = ib.to_json(global);
                // the GC will collect the string
                *self = Any::Blob(Blob::default());
                str
            }
            Any::WTFStringImpl(impl_) => {
                // Copy the handle out (a ref) and drop `self`'s (a deref)
                // rather than moving the whole `Any`.
                let str = BunString::from(impl_.clone());
                *self = Any::Blob(Blob::default());
                if str.length() == 0 {
                    return Ok(JSValue::NULL);
                }
                str.to_js_by_parse_json(global)
            }
        }
    }

    pub(crate) fn to_json_share(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_json(global, Lifetime::Share)
    }

    pub(crate) fn to_string_transfer(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_string(global, Lifetime::Transfer)
    }

    pub(crate) fn to_uint8_array_transfer(&mut self, global: &JSGlobalObject) -> JsResult<JSValue> {
        self.to_uint8_array(global, Lifetime::Transfer)
    }

    pub(crate) fn to_array_buffer_transfer(
        &mut self,
        global: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        self.to_array_buffer(global, Lifetime::Transfer)
    }

    pub(crate) fn to_blob(&mut self, global: &JSGlobalObject) -> Blob {
        if self.size() == 0 {
            return Blob::init_empty(global);
        }

        if let Any::Blob(b) = self {
            return b.dupe();
        }

        if let Any::WTFStringImpl(_) = self {
            let blob = Blob::create(self.slice(), global, true);
            // `Blob::create(.., true)` copied the bytes; `Any` still owns the
            // +1 WTF ref. `detach()` releases it and resets `*self` (the bare
            // `*self = Any::Blob(default)` here previously leaked that ref).
            self.detach();
            return blob;
        }

        let Any::InternalBlob(ib) = self else {
            unreachable!()
        };
        let blob = Blob::init(core::mem::take(&mut ib.bytes), global);
        *self = Any::Blob(Blob::default());
        blob
    }

    pub(crate) fn to_string(
        &mut self,
        global: &JSGlobalObject,
        lifetime: Lifetime,
    ) -> JsResult<JSValue> {
        match self {
            Any::Blob(b) => b.to_string(global, lifetime),
            Any::InternalBlob(ib) => {
                if ib.bytes.is_empty() {
                    return Ok(JSValue::js_empty_string(global));
                }
                let owned = ib.to_string_owned(global)?;
                *self = Any::Blob(Blob::default());
                Ok(owned)
            }
            Any::WTFStringImpl(impl_) => {
                // Copy the handle out (a ref) and drop `self`'s (a deref)
                // rather than moving the whole `Any`.
                let str = BunString::from(impl_.clone());
                *self = Any::Blob(Blob::default());
                str.into_js(global)
            }
        }
    }

    pub(crate) fn to_array_buffer(
        &mut self,
        global: &JSGlobalObject,
        lifetime: Lifetime,
    ) -> JsResult<JSValue> {
        self.to_array_buffer_view::<{ jsc::JSType::ArrayBuffer }>(global, lifetime)
    }

    pub(crate) fn to_uint8_array(
        &mut self,
        global: &JSGlobalObject,
        lifetime: Lifetime,
    ) -> JsResult<JSValue> {
        self.to_array_buffer_view::<{ jsc::JSType::Uint8Array }>(global, lifetime)
    }

    pub(crate) fn to_array_buffer_view<const TYPED_ARRAY_VIEW: jsc::JSType>(
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
                jsc::ArrayBuffer::from_default_allocator(global, TYPED_ARRAY_VIEW, bytes)
            }
            Any::WTFStringImpl(impl_) => {
                // Copy the handle out (a ref) and drop `self`'s (a deref)
                // rather than moving the whole `Any`.
                let str = BunString::from(impl_.clone());
                *self = Any::Blob(Blob::default());

                let out_bytes = str.to_utf8();
                if out_bytes.is_owned() {
                    let owned: &mut [u8] = out_bytes.into_vec().leak();
                    return jsc::ArrayBuffer::from_default_allocator(
                        global,
                        TYPED_ARRAY_VIEW,
                        owned,
                    );
                }
                jsc::ArrayBuffer::create::<TYPED_ARRAY_VIEW>(global, out_bytes.slice())
            }
        }
    }

    pub(crate) fn is_detached(&self) -> bool {
        match self {
            Any::Blob(blob) => blob.is_detached(),
            Any::InternalBlob(ib) => ib.bytes.is_empty(),
            Any::WTFStringImpl(s) => s.length() == 0,
        }
    }
}

impl Any {
    pub(crate) fn store(&self) -> Option<&Store> {
        // Returns a borrow with no refcount change.
        if let Any::Blob(b) = self {
            return b.store.get().as_deref();
        }
        None
    }

    pub(crate) fn content_type(&self) -> &[u8] {
        match self {
            Any::Blob(b) => b.content_type_slice(),
            // MimeType::TEXT is `const` — see Internal::content_type.
            Any::WTFStringImpl(_) => b"text/plain;charset=utf-8",
            Any::InternalBlob(ib) => ib.content_type(),
        }
    }

    pub(crate) fn was_string(&self) -> bool {
        match self {
            Any::Blob(b) => b.charset.get() == strings::AsciiStatus::AllAscii,
            Any::WTFStringImpl(_) => true,
            Any::InternalBlob(ib) => ib.was_string,
        }
    }

    #[inline]
    pub(crate) fn slice(&self) -> &[u8] {
        match self {
            Any::Blob(b) => b.shared_view(),
            Any::WTFStringImpl(s) => s.utf8_slice(),
            Any::InternalBlob(ib) => ib.slice_const(),
        }
    }

    pub(crate) fn needs_to_read_file(&self) -> bool {
        match self {
            Any::Blob(b) => b.needs_to_read_file(),
            Any::WTFStringImpl(_) | Any::InternalBlob(_) => false,
        }
    }

    pub(crate) fn is_s3(&self) -> bool {
        match self {
            Any::Blob(b) => b.is_s3(),
            Any::WTFStringImpl(_) | Any::InternalBlob(_) => false,
        }
    }

    pub(crate) fn detach(&mut self) {
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
            Any::WTFStringImpl(_) => {
                // Dropping the handle releases `Any`'s ref on the WTFStringImpl.
                *self = Any::Blob(Blob::default());
            }
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Internal (InternalBlob)
// ──────────────────────────────────────────────────────────────────────────

/// A single-use Blob backed by an allocation of memory.
#[derive(Default)]
pub struct Internal {
    pub(crate) bytes: Vec<u8>,
    pub(crate) was_string: bool,
}

impl Internal {
    pub(crate) fn memory_cost(&self) -> usize {
        self.bytes.capacity()
    }

    pub(crate) fn to_string_owned(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let mut bytes = self.to_owned_slice();
        let bom_len = bytes.len() - strings::without_utf8_bom(&bytes).len();
        if bom_len == 0 {
            return bun_string_jsc::owned_utf8_into_js(global_this, bytes);
        }
        match strings::to_utf16_alloc(&bytes[bom_len..], false, false) {
            Ok(Some(utf16)) => bun_string_jsc::owned_utf16_into_js(global_this, utf16),
            Ok(None) => {
                bytes.drain(..bom_len);
                bun_string_jsc::owned_latin1_into_js(global_this, bytes)
            }
            Err(_) => Err(global_this.throw_out_of_memory()),
        }
    }

    pub(crate) fn to_json(&mut self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        let str_bytes = EncodedSlice::from_bytes(strings::without_utf8_bom(&self.bytes));
        let json = str_bytes.to_json_object(global_this);
        self.bytes = Vec::new();
        json
    }

    #[inline]
    pub(crate) fn slice_const(&self) -> &[u8] {
        &self.bytes
    }

    pub(crate) fn to_owned_slice(&mut self) -> Vec<u8> {
        if self.bytes.is_empty() && self.bytes.capacity() > 0 {
            self.bytes = Vec::new();
            return Vec::new();
        }
        core::mem::take(&mut self.bytes)
    }

    pub(crate) fn content_type(&self) -> &'static [u8] {
        // MimeType::{TEXT,OTHER} are `const` (not `static`), so
        // borrowing `.value` would borrow a temporary. Inline the literals
        // (matches `MimeType::init_comptime` values).
        if self.was_string {
            return b"text/plain;charset=utf-8"; // MimeType::TEXT
        }
        b"application/octet-stream" // MimeType::OTHER
    }
}

// ──────────────────────────────────────────────────────────────────────────
// JSDOMFile__hasInstance / FileOpener / FileCloser
// ──────────────────────────────────────────────────────────────────────────

/// C++ side declares `extern "C" SYSV_ABI bool JSDOMFile__hasInstance(...)` (JSDOMFile.cpp).
// HOST_EXPORT(JSDOMFile__hasInstance, jsc)
pub fn jsdom_file_has_instance(_a: JSValue, _b: &JSGlobalObject, value: JSValue) -> bool {
    jsc::mark_binding();
    let Some(blob) = value.as_class_ref::<Blob>() else {
        return false;
    };
    blob.is_jsdom_file.get()
}

// ──────────────────────────────────────────────────────────────────────────
// FileOpener<T> / FileCloser<T>
// ──────────────────────────────────────────────────────────────────────────

/// What a pool-thread job (`ReadFile`, `CopyFile`) needs of a `store::File`,
/// copied on the JS thread when the job is created: the JS thread may re-stat
/// the live store (`resolve_file_stat` rewrites `mode`/`seekable`/...) while
/// the job runs, so the job never reads the store's `File` itself.
#[cfg_attr(windows, allow(dead_code))] // the Windows jobs run on the JS thread
pub struct FileSnapshot {
    pub pathlike: SnapshotPath,
    pub mode: bun_sys::Mode,
    pub is_atty: Option<bool>,
}

#[cfg_attr(windows, allow(dead_code))] // the Windows jobs run on the JS thread
impl FileSnapshot {
    pub fn new(file: &store::File) -> Self {
        Self {
            pathlike: match &file.pathlike {
                PathOrFileDescriptor::Fd(fd) => SnapshotPath::Fd(*fd),
                PathOrFileDescriptor::Path(p) => {
                    SnapshotPath::Path(SnapshotPathBuf(p.slice().into()))
                }
            },
            mode: file.mode,
            is_atty: file.is_atty,
        }
    }
}

/// [`FileSnapshot`]'s owned copy of a `PathOrFileDescriptor`.
#[cfg_attr(windows, allow(dead_code))] // the Windows jobs run on the JS thread
pub enum SnapshotPath {
    Fd(Fd),
    Path(SnapshotPathBuf),
}

#[cfg_attr(windows, allow(dead_code))] // the Windows jobs run on the JS thread
pub struct SnapshotPathBuf(Box<[u8]>);

#[cfg_attr(windows, allow(dead_code))] // the Windows jobs run on the JS thread
impl SnapshotPathBuf {
    #[inline]
    pub fn slice(&self) -> &[u8] {
        &self.0
    }

    /// NUL-terminated in `buf` (empty if it does not fit), as
    /// `PathLike::slice_z` does on POSIX.
    pub fn slice_z<'a>(&'a self, buf: &'a mut bun_paths::PathBuffer) -> &'a bun_core::ZStr {
        let path = &self.0[..];
        if path.len() >= buf.len() {
            bun_core::debug_warn!(
                "path too long: {} bytes exceeds PathBuffer capacity of {}\n",
                path.len(),
                buf.len()
            );
            return bun_core::ZStr::EMPTY;
        }
        buf[..path.len()].copy_from_slice(path);
        buf[path.len()] = 0;
        bun_core::ZStr::from_buf(&buf[..], path.len())
    }
}

#[cfg_attr(windows, allow(dead_code))] // the Windows jobs run on the JS thread
impl SnapshotPath {
    #[inline]
    pub fn is_fd(&self) -> bool {
        matches!(self, SnapshotPath::Fd(_))
    }
    #[inline]
    pub fn is_path(&self) -> bool {
        matches!(self, SnapshotPath::Path(_))
    }
    #[inline]
    pub fn fd(&self) -> Fd {
        match self {
            SnapshotPath::Fd(fd) => *fd,
            SnapshotPath::Path(_) => unreachable!("SnapshotPath::fd on a path"),
        }
    }
    #[inline]
    pub fn path(&self) -> &SnapshotPathBuf {
        match self {
            SnapshotPath::Path(p) => p,
            SnapshotPath::Fd(_) => unreachable!("SnapshotPath::path on an fd"),
        }
    }
    #[inline]
    pub fn as_ref(&self) -> PathOrFdRef<'_> {
        match self {
            SnapshotPath::Fd(fd) => PathOrFdRef::Fd(*fd),
            SnapshotPath::Path(p) => PathOrFdRef::Path(p.slice()),
        }
    }
}

/// A path-or-fd borrowed from wherever a [`FileOpener`] keeps it.
#[cfg_attr(windows, allow(dead_code))] // the Windows jobs run on the JS thread
pub enum PathOrFdRef<'a> {
    Fd(Fd),
    Path(&'a [u8]),
}

#[cfg(not(windows))]
impl<'a> From<&'a PathOrFileDescriptor<'_>> for PathOrFdRef<'a> {
    fn from(p: &'a PathOrFileDescriptor<'_>) -> Self {
        match p {
            PathOrFileDescriptor::Fd(fd) => PathOrFdRef::Fd(*fd),
            PathOrFileDescriptor::Path(p) => PathOrFdRef::Path(p.slice()),
        }
    }
}

// TODO: move to bun_sys?
/// Generic (POSIX, pool-thread) file-open helper used by the ReadFile/WriteFile
/// state machines, modeled as a trait the target implements. Windows opens go
/// through `bun_io::uv_fs::open`.
#[cfg(not(windows))]
pub trait FileOpener: Sized {
    /// Override if you need different open flags; defaults to RDONLY.
    const OPEN_FLAGS: i32 = bun_sys::O::RDONLY;
    const OPENER_FLAGS: i32 = bun_sys::O::NONBLOCK | bun_sys::O::CLOEXEC;

    fn opened_fd(&self) -> Fd;
    fn set_opened_fd(&mut self, fd: Fd);
    fn set_errno(&mut self, e: crate::Error);
    fn set_system_error(&mut self, e: jsc::SystemError);
    /// The file to open: the job's snapshot, or `self.file_blob.store.data.file.pathlike`.
    fn pathlike(&self) -> PathOrFdRef<'_>;
    /// Implementors that have a `mkdirp_if_not_exists` field (`WriteFile`,
    /// `CopyFile`) override this to call [`mkdir_if_not_exists`]; everyone else
    /// (e.g. `ReadFile`) keeps the default `Retry::No`, so the open path falls
    /// straight through to the error branch.
    fn try_mkdirp(
        &mut self,
        _err: bun_sys::Error,
        _path: &bun_core::ZStr,
        _display_path: &[u8],
    ) -> Retry {
        Retry::No
    }

    fn get_fd_by_opening(&mut self, callback: fn(&mut Self, Fd)) {
        let mut buf = bun_paths::PathBuffer::uninit();
        let path_string = match self.pathlike() {
            PathOrFdRef::Path(p) => SnapshotPathBuf(p.into()),
            PathOrFdRef::Fd(_) => unreachable!(),
        };
        let path = path_string.slice_z(&mut buf);

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
                    if err.get_errno() == bun_sys::E::ENOENT {
                        match self.try_mkdirp(err.clone(), path, path_string.slice()) {
                            Retry::Continue => continue,
                            Retry::Fail => {
                                // `mkdir_if_not_exists` already populated
                                // `errno`/`system_error` on the impl.
                                self.set_opened_fd(Fd::INVALID);
                                break;
                            }
                            Retry::No => {}
                        }
                    }
                    self.set_errno(bun_errno::from_errno(err.errno as i32).into());
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

        if let PathOrFdRef::Fd(fd) = self.pathlike() {
            self.set_opened_fd(fd);
            callback(self, fd);
            return;
        }

        self.get_fd_by_opening(callback);
    }
}

// TODO: move to bun_sys?
/// The close half of a POSIX parked-io job (`ReadFile`/`WriteFile`): closing
/// the fd it opened and, when its poll is still registered with the io loop,
/// getting it unregistered there first.
#[cfg(not(windows))]
pub trait FileCloser:
    Sized + bun_io::PollOwner + bun_io::IntrusiveIoRequest + bun_threading::WorkTaskHandler + 'static
{
    fn opened_fd(&self) -> Fd;
    fn set_opened_fd(&mut self, fd: Fd);
    fn close_after_io(&self) -> bool;
    fn set_close_after_io(&mut self, v: bool);
    fn state(&self) -> &core::sync::atomic::AtomicU8;
    fn io_request(&mut self) -> &mut bun_io::Request;
    fn task(&mut self) -> &mut bun_jsc::WorkPoolTask;

    /// The io-thread action that unregisters this job's poll; its completion
    /// comes back as [`on_io_request_closed`](Self::on_io_request_closed).
    fn close_action(&mut self) -> bun_io::Action<'_> {
        let fd = self.opened_fd();
        bun_io::Action::Close(bun_io::FileAction::new(self, fd))
    }

    /// io thread: the poll is unregistered; hand the job back to the pool
    /// (its [`WorkTaskHandler`](bun_threading::WorkTaskHandler) resumes it).
    fn on_io_request_closed(this: &mut Self) {
        bun_core::IntrusiveField::<bun_io::Poll>::field_mut(this)
            .flags
            .remove(bun_io::Flags::WasEverRegistered);
        this.set_close_after_io(false);
        *this.task() = bun_threading::work_task_for::<Self>();
        bun_jsc::WorkPool::schedule(this.task());
    }

    fn do_close(&mut self, is_allowed_to_close_fd: bool) -> bool {
        if self.close_after_io() {
            self.state().store(
                ClosingState::Closing as u8,
                core::sync::atomic::Ordering::SeqCst,
            );
            let io_request = self.io_request();
            // The io thread reads `callback` after popping from its MPSC
            // queue; a plain store here is a data race. `bun_io::Request::
            // store_callback_seq_cst` lowers to a volatile write + SeqCst
            // fence (Rust has no `AtomicFnPtr`).
            io_request
                .store_callback_seq_cst(bun_io::io_request_callback_with::<Self, CloseRequest>());
            if !io_request.scheduled {
                bun_io::IoRequestLoop::schedule(io_request);
            }
            return true;
        }

        if is_allowed_to_close_fd
            && self.opened_fd() != Fd::INVALID
            && self.opened_fd().stdio_tag().is_none()
        {
            use bun_sys::FdExt as _;
            let _ = self.opened_fd().close_allowing_bad_file_descriptor(None);
            self.set_opened_fd(Fd::INVALID);
        }

        false
    }
}

/// The io-thread hook `do_close` re-queues a [`FileCloser`]'s request with:
/// answers its [`close_action`](FileCloser::close_action).
#[cfg(not(windows))]
pub struct CloseRequest;

#[cfg(not(windows))]
impl<T: FileCloser> bun_io::IoRequestHook<T> for CloseRequest {
    fn on_io_request(owner: &mut T) -> bun_io::Action<'_> {
        owner.close_action()
    }
}

/// Implements [`FileCloser`] for a task struct with the standard field set
/// (`opened_fd`, `close_after_io`, `state`, `io: ParkedRequest`, `io_poll`,
/// `task`). The type must also carry `bun_io::intrusive_io_request!`,
/// `bun_io::poll_owner!` and a `bun_threading::WorkTaskHandler` impl that
/// resumes it.
macro_rules! impl_file_closer {
    ($T:ident) => {
        #[cfg(not(windows))]
        impl crate::webcore::blob::FileCloser for $T {
            fn opened_fd(&self) -> ::bun_sys::Fd {
                self.opened_fd
            }
            fn set_opened_fd(&mut self, fd: ::bun_sys::Fd) {
                self.opened_fd = fd;
            }
            fn close_after_io(&self) -> bool {
                self.close_after_io
            }
            fn set_close_after_io(&mut self, v: bool) {
                self.close_after_io = v;
            }
            fn state(&self) -> &::core::sync::atomic::AtomicU8 {
                &self.state
            }
            fn io_request(&mut self) -> &mut ::bun_io::Request {
                self.io.request()
            }
            fn task(&mut self) -> &mut ::bun_jsc::WorkPoolTask {
                &mut self.task
            }
        }
    };
}
pub(crate) use impl_file_closer;
