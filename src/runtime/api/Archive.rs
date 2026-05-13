//! `Bun.Archive` — tar/tgz pack + extract over libarchive.

use core::ffi::{CStr, c_char};
use core::mem::offset_of;
use std::ffi::CString;
use std::sync::Arc;

use crate::webcore::Blob;
use crate::webcore::BlobExt as _;
use crate::webcore::blob::{Store as BlobStore, StoreRef};
use bun_core::zig_string::Slice as ZigStringSlice;
use bun_core::{self, Output, ZBox};
use bun_core::{ZigString, strings};
use bun_event_loop::{TaskTag, Taskable, task_tag};
use bun_glob as glob;
use bun_io::KeepAlive;
use bun_jsc::ConcurrentTask::{AutoDeinit, ConcurrentTask};
use bun_jsc::virtual_machine::VirtualMachine;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSMap, JSPromise, JSPromiseStrong, JSPropertyIterator,
    JSPropertyIteratorOptions, JSValue, JsResult, WorkPool, WorkPoolTask,
};
use bun_jsc::{StringJsc as _, SysErrorJsc as _};
use bun_libarchive as libarchive;
use bun_sys::{self, Fd, FdDirExt as _, FdExt as _, Mode};

/// libarchive `AE_IFREG` (== `S_IFREG`). The Rust `bun_libarchive::lib` port
/// does not yet expose `FileType`, so mirror the constant locally.
const FILETYPE_REGULAR: u32 = 0o100000;

/// Compression options for the archive
#[derive(Clone, Copy)]
pub enum Compression {
    None,
    Gzip(GzipOptions),
}

#[derive(Clone, Copy)]
pub struct GzipOptions {
    /// Compression level: 1 (fastest) to 12 (maximum compression). Default is 6.
    pub level: u8,
}

impl Default for GzipOptions {
    fn default() -> Self {
        Self { level: 6 }
    }
}

impl Default for Compression {
    fn default() -> Self {
        Compression::None
    }
}

// TODO(port): #[bun_jsc::JsClass] derive — hand-written until the proc-macro
// grows `no_finalize`/`no_construct` knobs Archive needs (custom `finalize`).
#[repr(C)]
pub struct Archive {
    /// The underlying data for the archive - uses Blob.Store for thread-safe ref counting
    store: StoreRef,
    /// Compression settings for this archive
    compress: Compression,
}

impl Archive {
    /// Borrow the backing `StoreRef` (Zig: `archive.store`).
    #[inline]
    pub fn store_ref(&self) -> &StoreRef {
        &self.store
    }
}

// `jsc.Codegen.JSArchive` — codegen already emits `js_Archive`
// (`generate-classes.ts:generateRust()`); route through it so the
// `Archive__{fromJS,create,getConstructor}` externs are declared exactly once.
bun_jsc::impl_js_class_via_generated!(Archive => crate::generated_classes::js_Archive);

impl Archive {
    /// `Archive.write(path, data, options?)` static class fn — codegen
    /// (`ArchiveClass__write`) resolves it as an associated item on the struct,
    /// so forward to the module-level [`write`] body below (Zig had it as
    /// `pub fn write` in the file struct, which is both).
    #[inline]
    pub fn write(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self::write(global, callframe)
    }

    pub fn finalize(self: Box<Self>) {
        jsc::mark_binding();
        drop(self);
        // store.deref() happens via Arc<BlobStore>::drop
    }

    /// Pretty-print for console.log
    pub fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> Result<(), bun_core::Error>
    where
        F: bun_jsc::ConsoleFormatter,
        W: core::fmt::Write,
    {
        let data = self.store.shared_view();
        let fmt_err = |_: core::fmt::Error| bun_core::err!("FormatError");

        write!(
            writer,
            "Archive ({}) {{\n",
            bun_core::fmt::size(data.len(), bun_core::fmt::SizeFormatterOptions::default()),
        )
        .map_err(fmt_err)?;

        {
            let mut formatter = formatter.indented();
            formatter.write_indent(writer).map_err(fmt_err)?;
            write!(
                writer,
                "{}",
                Output::pretty_fmt::<ENABLE_ANSI_COLORS>("<r>files<d>:<r> "),
            )
            .map_err(fmt_err)?;
            formatter
                .print_as::<W, ENABLE_ANSI_COLORS>(
                    jsc::FormatTag::Double,
                    writer,
                    JSValue::js_number(f64::from(count_files_in_archive(data))),
                    jsc::JSType::NumberObject,
                )
                .map_err(|_| bun_core::err!("JSError"))?;
        }
        writer.write_str("\n").map_err(fmt_err)?;
        formatter.write_indent(writer).map_err(fmt_err)?;
        writer.write_str("}").map_err(fmt_err)?;
        formatter.reset_line();
        Ok(())
    }
}

/// Configure archive for reading tar/tar.gz
fn configure_archive_reader(archive: &libarchive::lib::Archive) {
    let _ = archive.read_support_format_tar();
    let _ = archive.read_support_format_gnutar();
    let _ = archive.read_support_filter_gzip();
    let _ = archive.read_set_options(c"read_concatenated_archives");
}

/// Count the number of files in an archive
fn count_files_in_archive(data: &[u8]) -> u32 {
    use libarchive::lib;
    let archive = lib::ReadArchive::new();
    configure_archive_reader(&archive);

    if archive.read_open_memory(data) != lib::Result::Ok {
        return 0;
    }

    let mut count: u32 = 0;
    let mut entry: *mut lib::Entry = core::ptr::null_mut();
    while archive.read_next_header(&mut entry) == lib::Result::Ok {
        if lib::Entry::opaque_ref(entry).filetype() == FILETYPE_REGULAR {
            count += 1;
        }
    }

    count
}

impl Archive {
    /// Constructor: new Archive(data, options?)
    /// Creates an Archive from either:
    /// - An object { [path: string]: Blob | string | ArrayBufferView | ArrayBufferLike }
    /// - A Blob, ArrayBufferView, or ArrayBufferLike (assumes it's already a valid archive)
    /// Options:
    /// - compress: "gzip" - Enable gzip compression
    /// - level: number (1-12) - Compression level (default 6)
    /// When no options are provided, no compression is applied
    // PORT NOTE: `#[bun_jsc::host_fn]` has no `constructor` kind yet; the
    // `JsClass` derive emits a `constructor` shim that calls this directly.
    pub fn constructor(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<Box<Archive>> {
        let [data_arg, options_arg] = callframe.arguments_as_array::<2>();
        if data_arg.is_empty() {
            return Err(
                global.throw_invalid_arguments(format_args!("new Archive() requires an argument"))
            );
        }

        // Parse compression options
        let compress = parse_compression_options(global, options_arg)?;

        // For Blob/Archive, ref the existing store (zero-copy)
        if let Some(blob) = blob_from_js(data_arg) {
            if let Some(store) = blob.store.get().as_ref() {
                // StoreRef::clone == store.ref()
                return Ok(Box::new(Archive {
                    store: store.clone(),
                    compress,
                }));
            }
        }

        // For ArrayBuffer/TypedArray, copy the data
        if let Some(array_buffer) = data_arg.as_array_buffer(global) {
            let data: Vec<u8> = array_buffer.slice().to_vec();
            return Ok(create_archive(data, compress));
        }

        // For plain objects, build a tarball
        if data_arg.is_object() {
            let data = build_tarball_from_object(global, data_arg)?;
            return Ok(create_archive(data, compress));
        }

        Err(global.throw_invalid_arguments(format_args!(
            "Expected an object, Blob, TypedArray, or ArrayBuffer"
        )))
    }
}

/// Parse compression options from JS value
/// Returns .none if no compression specified, caller must handle defaults
fn parse_compression_options(
    global: &JSGlobalObject,
    options_arg: JSValue,
) -> JsResult<Compression> {
    // No options provided means no compression (caller handles defaults)
    if options_arg.is_undefined_or_null() {
        return Ok(Compression::None);
    }

    if !options_arg.is_object() {
        return Err(
            global.throw_invalid_arguments(format_args!("Archive: options must be an object"))
        );
    }

    // Check for compress option
    if let Some(compress_val) = options_arg.get_truthy(global, "compress")? {
        // compress must be "gzip"
        if !compress_val.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Archive: compress option must be a string"
            )));
        }

        let compress_str = compress_val.to_slice(global)?;
        // Drop handles compress_str.deinit()

        if compress_str.slice() != b"gzip" {
            return Err(global.throw_invalid_arguments(format_args!(
                "Archive: compress option must be \"gzip\""
            )));
        }

        // Parse level option (1-12, default 6)
        let mut level: u8 = 6;
        if let Some(level_val) = options_arg.get_truthy(global, "level")? {
            if !level_val.is_number() {
                return Err(
                    global.throw_invalid_arguments(format_args!("Archive: level must be a number"))
                );
            }
            let level_num = level_val.to_int64();
            if level_num < 1 || level_num > 12 {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Archive: level must be between 1 and 12"
                )));
            }
            level = u8::try_from(level_num).expect("int cast");
        }

        return Ok(Compression::Gzip(GzipOptions { level }));
    }

    // No compress option specified in options object means no compression
    Ok(Compression::None)
}

fn create_archive(data: Vec<u8>, compress: Compression) -> Box<Archive> {
    let store = BlobStore::init(data);
    Box::new(Archive { store, compress })
}

/// `JSValue::as_::<Blob>()` shim — kept as a free fn so the call sites read
/// the same as the Zig (`jsc.WebCore.Blob.fromJS(value)`). Returns a shared
/// borrow (BACKREF: m_ctx payload kept live by the JSC cell rooted by `value`
/// on the caller's stack) so callers don't open-code `unsafe { &*ptr }`.
#[inline]
fn blob_from_js(value: JSValue) -> Option<&'static Blob> {
    value.as_class_ref::<Blob>()
}

/// Shared helper that builds tarball bytes from a JS object
fn build_tarball_from_object(global: &JSGlobalObject, obj: JSValue) -> JsResult<Vec<u8>> {
    use libarchive::lib;

    let Some(js_obj) = obj.get_object() else {
        return Err(global.throw_invalid_arguments(format_args!("Expected an object")));
    };

    // Set up archive first
    let mut growing_buffer = lib::GrowingBuffer::init();
    // errdefer growing_buffer.deinit() — handled by Drop on Vec<u8>

    let archive = lib::WriteArchive::new();
    let archive_ref: &lib::Archive = &archive;

    if archive_ref.write_set_format_pax_restricted() != lib::Result::Ok {
        return Err(global.throw_invalid_arguments(format_args!(
            "Failed to create tarball: ArchiveFormatError"
        )));
    }

    if lib::archive_write_open2(
        archive.as_ptr(),
        (&raw mut growing_buffer).cast(),
        Some(lib::GrowingBuffer::open_callback),
        Some(lib::GrowingBuffer::write_callback),
        Some(lib::GrowingBuffer::close_callback),
        None,
    ) != 0
    {
        return Err(global
            .throw_invalid_arguments(format_args!("Failed to create tarball: ArchiveOpenError")));
    }

    let entry = lib::OwnedEntry::new();
    let entry_ref: &lib::Entry = &entry;

    let now_secs: isize = isize::try_from(bun_core::time::milli_timestamp() / 1000).unwrap_or(0);

    // Iterate over object properties and write directly to archive
    let mut iter = jsc::JSPropertyIterator::init(
        global,
        js_obj,
        jsc::PropertyIteratorOptions {
            skip_empty_name: true,
            include_value: true,
        },
    )?;
    // defer iter.deinit() — handled by Drop

    while let Some(key) = iter.next()? {
        let value = iter.value;
        if value == JSValue::ZERO {
            continue;
        }

        // Get the key as a null-terminated string
        let key_slice = key.to_utf8();
        let key_str = ZBox::from_vec_with_nul(key_slice.slice().to_vec());
        // defer free(key_str)/key_slice.deinit() — handled by Drop

        // Get data - use view for Blob/ArrayBuffer, convert for strings
        let data_slice = get_entry_data(global, value)?;
        // defer data_slice.deinit() — handled by Drop

        // Write entry to archive
        let data = data_slice.slice();
        let _ = entry_ref.clear();
        entry_ref.set_pathname_utf8(key_str.as_zstr());
        entry_ref.set_size(i64::try_from(data.len()).expect("int cast"));
        entry_ref.set_filetype(FILETYPE_REGULAR);
        entry_ref.set_perm(0o644);
        entry_ref.set_mtime(now_secs, 0);

        if archive_ref.write_header(entry_ref) != lib::Result::Ok {
            return Err(global.throw_invalid_arguments(format_args!(
                "Failed to create tarball: ArchiveHeaderError"
            )));
        }
        if archive_ref.write_data(data) < 0 {
            return Err(global.throw_invalid_arguments(format_args!(
                "Failed to create tarball: ArchiveWriteError"
            )));
        }
        if archive_ref.write_finish_entry() != lib::Result::Ok {
            return Err(global.throw_invalid_arguments(format_args!(
                "Failed to create tarball: ArchiveFinishEntryError"
            )));
        }
    }

    if archive_ref.write_close() != lib::Result::Ok {
        return Err(global
            .throw_invalid_arguments(format_args!("Failed to create tarball: ArchiveCloseError")));
    }

    match growing_buffer.to_owned_slice() {
        Ok(v) => Ok(v),
        Err(_) => {
            Err(global
                .throw_invalid_arguments(format_args!("Failed to create tarball: OutOfMemory")))
        }
    }
}

/// Returns data as a ZigString.Slice (handles ownership automatically via deinit)
fn get_entry_data(global: &JSGlobalObject, value: JSValue) -> JsResult<ZigStringSlice> {
    // For Blob, use sharedView (no copy needed). The backing store outlives
    // the returned slice for the duration of the caller's tarball build.
    if let Some(blob) = blob_from_js(value) {
        return Ok(ZigStringSlice::from_utf8_never_free(blob.shared_view()));
    }

    // For ArrayBuffer/TypedArray, use view (no copy needed)
    if let Some(array_buffer) = value.as_array_buffer(global) {
        return Ok(ZigStringSlice::from_utf8_never_free(array_buffer.slice()));
    }

    // For strings, convert (allocates)
    value.to_slice(global)
}

/// Static method: Archive.write(path, data, options?)
/// Creates and writes an archive to disk in one operation.
/// For Archive instances, uses the archive's compression settings unless overridden by options.
/// Options:
///   - gzip: { level?: number } - Override compression settings
#[bun_jsc::host_fn]
pub fn write(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
    let [path_arg, data_arg, options_arg] = callframe.arguments_as_array::<3>();
    if data_arg.is_empty() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Archive.write requires 2 arguments (path, data)"
        )));
    }

    // Get the path
    if !path_arg.is_string() {
        return Err(global.throw_invalid_arguments(format_args!(
            "Archive.write: first argument must be a string path"
        )));
    }

    let path_slice = path_arg.to_slice(global)?;

    // Parse options for compression override
    let options_compress = parse_compression_options(global, options_arg)?;

    // For Archive instances, use options override or archive's compression settings
    if let Some(archive) = data_arg.as_class_ref::<Archive>() {
        let compress = if !matches!(options_compress, Compression::None) {
            options_compress
        } else {
            archive.compress
        };
        return start_write_task(
            global,
            WriteData::Store(archive.store.clone()),
            path_slice.slice(),
            compress,
        );
    }

    // For Blobs, use store reference with options compression
    if let Some(blob) = blob_from_js(data_arg) {
        if let Some(store) = blob.store.get().as_ref() {
            return start_write_task(
                global,
                WriteData::Store(store.clone()),
                path_slice.slice(),
                options_compress,
            );
        }
    }

    // For ArrayBuffer/TypedArray, copy the data with options compression
    if let Some(array_buffer) = data_arg.as_array_buffer(global) {
        let data = array_buffer.slice().to_vec();
        return start_write_task(
            global,
            WriteData::Owned(data),
            path_slice.slice(),
            options_compress,
        );
    }

    // For plain objects, build a tarball with options compression
    if data_arg.is_object() {
        let data = build_tarball_from_object(global, data_arg)?;
        return start_write_task(
            global,
            WriteData::Owned(data),
            path_slice.slice(),
            options_compress,
        );
    }

    Err(global.throw_invalid_arguments(format_args!(
        "Expected an object, Blob, TypedArray, ArrayBuffer, or Archive"
    )))
}

impl Archive {
    /// Instance method: archive.extract(path, options?)
    /// Extracts the archive to the given path
    /// Options:
    ///   - glob: string | string[] - Only extract files matching the glob pattern(s). Supports negative patterns with "!".
    /// Returns Promise<number> with count of extracted files
    #[bun_jsc::host_fn(method)]
    pub fn extract(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let [path_arg, options_arg] = callframe.arguments_as_array::<2>();
        if path_arg.is_empty() || !path_arg.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Archive.extract requires a path argument"
            )));
        }

        let path_slice = path_arg.to_slice(global)?;

        // Parse options
        let mut glob_patterns: Option<Vec<Box<[u8]>>> = None;
        // errdefer freePatterns — handled by Drop on Vec<Box<[u8]>>

        if !options_arg.is_undefined_or_null() {
            if !options_arg.is_object() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "Archive.extract: second argument must be an options object"
                )));
            }

            // Parse glob option
            if let Some(glob_val) = options_arg.get_truthy(global, "glob")? {
                glob_patterns = parse_pattern_arg(global, glob_val, b"Archive.extract", b"glob")?;
            }
        }

        start_extract_task(global, &self.store, path_slice.slice(), glob_patterns)
    }
}

/// Parse a string or array of strings into a pattern list.
/// Returns null for empty strings or empty arrays (treated as "no filter").
fn parse_pattern_arg(
    global: &JSGlobalObject,
    arg: JSValue,
    api_name: &[u8],
    name: &[u8],
) -> JsResult<Option<Vec<Box<[u8]>>>> {
    // Single string
    if arg.is_string() {
        let str_slice = arg.to_slice(global)?;
        // Empty string = no filter
        if str_slice.slice().is_empty() {
            return Ok(None);
        }
        let pattern: Box<[u8]> = Box::from(str_slice.slice());
        let patterns = vec![pattern];
        return Ok(Some(patterns));
    }

    // Array of strings
    if arg.js_type() == jsc::JSType::Array {
        let len = arg.get_length(global)?;
        // Empty array = no filter
        if len == 0 {
            return Ok(None);
        }

        let mut patterns: Vec<Box<[u8]>> =
            Vec::with_capacity(usize::try_from(len).expect("int cast"));
        // errdefer { for p free; deinit } — handled by Drop on Vec<Box<[u8]>>

        // Use index-based iteration for safety (avoids issues if array mutates)
        let mut i: u32 = 0;
        while u64::from(i) < len {
            let item = arg.get_index(global, i)?;
            if !item.is_string() {
                return Err(global.throw_invalid_arguments(format_args!(
                    "{}: {} array must contain only strings",
                    bstr::BStr::new(api_name),
                    bstr::BStr::new(name),
                )));
            }
            let str_slice = item.to_slice(global)?;
            // Skip empty strings in array
            if str_slice.slice().is_empty() {
                i += 1;
                continue;
            }
            let pattern: Box<[u8]> = Box::from(str_slice.slice());
            patterns.push(pattern);
            // PERF(port): was appendAssumeCapacity — profile in Phase B
            i += 1;
        }

        // If all strings were empty, treat as no filter
        if patterns.is_empty() {
            return Ok(None);
        }

        return Ok(Some(patterns));
    }

    Err(global.throw_invalid_arguments(format_args!(
        "{}: {} must be a string or array of strings",
        bstr::BStr::new(api_name),
        bstr::BStr::new(name),
    )))
}

// freePatterns deleted — Vec<Box<[u8]>> drops elements then itself.

impl Archive {
    /// Instance method: archive.blob()
    /// Returns Promise<Blob> with the archive data (compressed if gzip was set in options)
    #[bun_jsc::host_fn(method)]
    pub fn blob(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        start_blob_task(global, &self.store, self.compress, BlobOutputType::Blob)
    }

    /// Instance method: archive.bytes()
    /// Returns Promise<Uint8Array> with the archive data (compressed if gzip was set in options)
    #[bun_jsc::host_fn(method)]
    pub fn bytes(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        start_blob_task(global, &self.store, self.compress, BlobOutputType::Bytes)
    }

    /// Instance method: archive.files(glob?)
    /// Returns Promise<Map<string, File>> with archive file contents
    #[bun_jsc::host_fn(method)]
    pub fn files(&self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let glob_arg = callframe.argument(0);

        let mut glob_patterns: Option<Vec<Box<[u8]>>> = None;
        // errdefer freePatterns — handled by Drop

        if !glob_arg.is_undefined_or_null() {
            glob_patterns = parse_pattern_arg(global, glob_arg, b"Archive.files", b"glob")?;
        }

        start_files_task(global, &self.store, glob_patterns)
    }
}

// ============================================================================
// Generic Async Task Infrastructure
// ============================================================================

pub enum PromiseResult {
    Resolve(JSValue),
    Reject(JSValue),
}

impl PromiseResult {
    fn fulfill(
        self,
        global: &JSGlobalObject,
        promise: &mut JSPromise,
    ) -> Result<(), bun_jsc::JsTerminated> {
        match self {
            PromiseResult::Resolve(v) => promise.resolve(global, v),
            PromiseResult::Reject(v) => promise.reject_with_async_stack(global, Ok(v)),
        }
    }
}

/// Trait extracted from the Zig structural-duck-typing on `Context`.
/// Context must provide:
///   - `run` — runs on thread pool, stores result in `self`
///   - `run_from_js` — returns value to resolve/reject
///   - `Drop` — cleanup
pub trait TaskContext: Send {
    /// Dispatch tag for this context's `AsyncTask<Self>` variant.
    const TAG: TaskTag;
    /// Runs on thread pool. Stores its result on `self`.
    // TODO(port): Zig's `AsyncTask.run` used `@typeInfo(@TypeOf(result)) == .error_union`
    // to generically catch and store `.err`. Rust has no reflection; each impl handles
    // its own error path inside `run` and writes `self.result`.
    fn run(&mut self);
    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult>;
}

/// Generic async task that handles all the boilerplate for thread pool tasks.
pub struct AsyncTask<C: TaskContext> {
    ctx: C,
    promise: JSPromiseStrong,
    vm: *mut VirtualMachine,
    task: WorkPoolTask,
    concurrent_task: ConcurrentTask,
    keep_alive: KeepAlive,
}

impl<C: TaskContext> Taskable for AsyncTask<C> {
    const TAG: TaskTag = C::TAG;
}

impl<C: TaskContext> AsyncTask<C> {
    fn create(global: &JSGlobalObject, ctx: C) -> Result<*mut Self, bun_alloc::AllocError> {
        // `bun_vm_ptr()` returns `*mut VirtualMachine` with write provenance; valid for
        // process lifetime. Do NOT launder `bun_vm()` (a `&VirtualMachine`) through
        // `*const _ as *mut _` — that derives a writeable pointer from a shared
        // reference and is UB under Stacked Borrows.
        let vm: *mut VirtualMachine = global.bun_vm_ptr();
        let this = Box::new(AsyncTask {
            ctx,
            promise: JSPromiseStrong::init(global),
            vm,
            task: WorkPoolTask {
                callback: Self::run_callback,
                node: Default::default(),
            },
            concurrent_task: ConcurrentTask::default(),
            keep_alive: KeepAlive::default(),
        });
        let raw = bun_core::heap::into_raw(this);
        // SAFETY: raw was just produced by heap::alloc; not yet shared. Keep the event
        // loop alive until `run_from_js` unrefs after the threadpool work completes.
        unsafe { (*raw).keep_alive.ref_(bun_io::js_vm_ctx()) };
        Ok(raw)
    }

    fn schedule(this: *mut Self) {
        // SAFETY: `this` is alive (owned by the task system) until run_from_js drops it;
        // task field is intrusive and stable since `this` is heap-allocated.
        WorkPool::schedule(unsafe { &raw mut (*this).task });
    }

    /// Read the pending promise's `JSValue` from a freshly-`create`d task.
    ///
    /// Centralises the `*mut Self → field` deref so the four
    /// `start_*_task` callers stay safe. Sound because every caller passes the
    /// pointer returned by [`create`](Self::create) (heap-allocated, sole owner
    /// on the JS thread) and reads the promise *before* [`schedule`] hands the
    /// allocation to the thread pool — i.e. `this` is live and unaliased.
    #[inline]
    fn promise_value(this: *mut Self) -> JSValue {
        // SAFETY: see fn doc — `this` is the live, unscheduled `heap::into_raw`
        // allocation from `create()`.
        unsafe { (*this).promise.value() }
    }

    /// Thread-pool callback (safe fn — coerces to the `WorkPoolTask.callback`
    /// field type at the struct-init site in `create`).
    fn run_callback(work_task: *mut WorkPoolTask) {
        // SAFETY: `work_task` points to the `task` field of an `AsyncTask<C>`
        // allocated by `create` — only ever invoked by the thread pool against
        // a task it scheduled, so provenance covers the full allocation.
        let this: *mut Self = unsafe { bun_core::from_field_ptr!(Self, task, work_task) };
        // SAFETY: thread-pool has exclusive access to ctx until it enqueues the concurrent task.
        unsafe { (*this).ctx.run() };
        // SAFETY: vm points to the live owning VM; concurrent_task is intrusive on the same allocation.
        unsafe {
            let ct: *mut ConcurrentTask =
                (*this).concurrent_task.from(this, AutoDeinit::ManualDeinit);
            (*(*this).vm).enqueue_task_concurrent(ct);
        }
    }

    pub fn run_from_js(this: *mut Self) -> Result<(), bun_jsc::JsTerminated> {
        // SAFETY: called once on the JS thread after run_callback enqueued us; reclaim ownership.
        let mut owned = unsafe { bun_core::heap::take(this) };
        owned.keep_alive.unref(bun_io::js_vm_ctx());

        // `defer { ctx.deinit; destroy(this) }` — handled by `owned: Box<Self>` dropping at scope
        // exit (ctx implements Drop).

        let vm = VirtualMachine::get();
        if vm.is_shutting_down() {
            return Ok(());
        }

        let global = vm.global();
        let mut promise = owned.promise.swap();
        let result = match owned.ctx.run_from_js(global) {
            Ok(r) => r,
            Err(e) => {
                // JSError means exception is already pending
                return promise.reject(global, Ok(global.take_exception(e)));
            }
        };
        result.fulfill(global, &mut promise)
    }
}

// ============================================================================
// Task Contexts
// ============================================================================

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
enum ExtractError {
    #[error("ReadError")]
    ReadError,
}

enum ExtractResult {
    Success(u32),
    Err(ExtractError),
}

pub struct ExtractContext {
    store: StoreRef,
    path: Box<[u8]>,
    glob_patterns: Option<Vec<Box<[u8]>>>,
    result: ExtractResult,
}

impl TaskContext for ExtractContext {
    const TAG: TaskTag = task_tag::ArchiveExtractTask;

    fn run(&mut self) {
        self.result = self.do_run();
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        Ok(match &self.result {
            ExtractResult::Success(count) => {
                PromiseResult::Resolve(JSValue::js_number(*count as f64))
            }
            ExtractResult::Err(e) => PromiseResult::Reject(
                global.create_error_instance(format_args!("{}", <&'static str>::from(e))),
            ),
        })
    }
}

impl ExtractContext {
    fn do_run(&mut self) -> ExtractResult {
        // If we have glob patterns, use filtered extraction
        if self.glob_patterns.is_some() {
            let count = match extract_to_disk_filtered(
                self.store.shared_view(),
                &self.path,
                self.glob_patterns.as_deref(),
            ) {
                Ok(c) => c,
                Err(_) => return ExtractResult::Err(ExtractError::ReadError),
            };
            return ExtractResult::Success(count);
        }

        // Otherwise use the fast path without filtering
        let count = match libarchive::Archiver::extract_to_disk(
            self.store.shared_view(),
            &self.path,
            None,
            &mut (),
            libarchive::ExtractOptions {
                depth_to_skip: 0,
                close_handles: true,
                log: false,
                npm: false,
            },
        ) {
            Ok(c) => c,
            Err(_) => return ExtractResult::Err(ExtractError::ReadError),
        };
        ExtractResult::Success(count)
    }
}

pub type ExtractTask = AsyncTask<ExtractContext>;

fn start_extract_task(
    global: &JSGlobalObject,
    store: &StoreRef,
    path: &[u8],
    glob_patterns: Option<Vec<Box<[u8]>>>,
) -> JsResult<JSValue> {
    let path_copy: Box<[u8]> = Box::from(path);
    // errdefer free(path_copy) — Drop handles it

    let store = store.clone();
    // errdefer store.deref() — Drop handles it

    let task = ExtractTask::create(
        global,
        ExtractContext {
            store,
            path: path_copy,
            glob_patterns,
            result: ExtractResult::Err(ExtractError::ReadError),
        },
    )?;

    let promise_js = ExtractTask::promise_value(task);
    ExtractTask::schedule(task);
    Ok(promise_js)
}

#[derive(Clone, Copy)]
enum BlobOutputType {
    Blob,
    Bytes,
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
enum BlobError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("GzipInitFailed")]
    GzipInitFailed,
    #[error("GzipCompressFailed")]
    GzipCompressFailed,
}

enum BlobResult {
    Compressed(Vec<u8>),
    Uncompressed,
    Err(BlobError),
}

pub struct BlobContext {
    store: StoreRef,
    compress: Compression,
    output_type: BlobOutputType,
    result: BlobResult,
}

impl TaskContext for BlobContext {
    const TAG: TaskTag = task_tag::ArchiveBlobTask;

    fn run(&mut self) {
        self.result = match &self.compress {
            Compression::Gzip(opts) => match compress_gzip(self.store.shared_view(), opts.level) {
                Ok(data) => BlobResult::Compressed(data),
                Err(e) => BlobResult::Err(e.into()),
            },
            Compression::None => BlobResult::Uncompressed,
        };
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        match core::mem::replace(&mut self.result, BlobResult::Uncompressed) {
            BlobResult::Err(e) => Ok(PromiseResult::Reject(
                global.create_error_instance(format_args!("{}", <&'static str>::from(&e))),
            )),
            BlobResult::Compressed(data) => {
                // self.result already replaced with Uncompressed above — ownership transferred
                Ok(PromiseResult::Resolve(match self.output_type {
                    BlobOutputType::Blob => {
                        let blob_ptr =
                            Blob::new(Blob::create_with_bytes_and_allocator(data, global, false));
                        // SAFETY: blob_ptr is the heap allocation just produced by Blob::new.
                        unsafe { (*blob_ptr).to_js(global) }
                    }
                    BlobOutputType::Bytes => {
                        // Ownership transfers to JSC's `MarkedArrayBuffer_deallocator`.
                        JSValue::create_buffer_from_box(global, data.into_boxed_slice())
                    }
                }))
            }
            BlobResult::Uncompressed => Ok(match self.output_type {
                BlobOutputType::Blob => {
                    // Zig: `this.store.ref()` — clone bumps the refcount; ownership of
                    // the new ref transfers into the Blob via init_with_store.
                    let store = self.store.clone();
                    let blob_ptr = Blob::new(Blob::init_with_store(store, global));
                    // SAFETY: blob_ptr is the heap allocation just produced by Blob::new.
                    PromiseResult::Resolve(unsafe { (*blob_ptr).to_js(global) })
                }
                BlobOutputType::Bytes => {
                    let dup = self.store.shared_view().to_vec();
                    // TODO(port): Zig matched OOM here and rejected; Rust Vec aborts on OOM.
                    PromiseResult::Resolve(JSValue::create_buffer_from_box(
                        global,
                        dup.into_boxed_slice(),
                    ))
                }
            }),
        }
    }
}

pub type BlobTask = AsyncTask<BlobContext>;

fn start_blob_task(
    global: &JSGlobalObject,
    store: &StoreRef,
    compress: Compression,
    output_type: BlobOutputType,
) -> JsResult<JSValue> {
    let store = store.clone();
    // errdefer store.deref() — Drop handles it

    let task = BlobTask::create(
        global,
        BlobContext {
            store,
            compress,
            output_type,
            result: BlobResult::Uncompressed,
        },
    )?;

    let promise_js = BlobTask::promise_value(task);
    BlobTask::schedule(task);
    Ok(promise_js)
}

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
enum WriteError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("GzipInitFailed")]
    GzipInitFailed,
    #[error("GzipCompressFailed")]
    GzipCompressFailed,
}

enum WriteResult {
    Success,
    Err(WriteError),
    SysErr(bun_sys::Error),
}

enum WriteData {
    Owned(Vec<u8>),
    Store(StoreRef),
}

pub struct WriteContext {
    data: WriteData,
    path: ZBox,
    compress: Compression,
    result: WriteResult,
}

impl TaskContext for WriteContext {
    const TAG: TaskTag = task_tag::ArchiveWriteTask;

    fn run(&mut self) {
        self.result = self.do_run();
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        Ok(match &self.result {
            WriteResult::Success => PromiseResult::Resolve(JSValue::UNDEFINED),
            WriteResult::Err(e) => PromiseResult::Reject(
                global.create_error_instance(format_args!("{}", <&'static str>::from(e))),
            ),
            WriteResult::SysErr(sys_err) => PromiseResult::Reject(sys_err.to_js(global)),
        })
    }
}

impl WriteContext {
    fn do_run(&mut self) -> WriteResult {
        let source_data: &[u8] = match &self.data {
            WriteData::Owned(d) => d,
            WriteData::Store(s) => s.shared_view(),
        };
        let compressed_buf;
        let data_to_write: &[u8] = match &self.compress {
            Compression::Gzip(opts) => {
                compressed_buf = match compress_gzip(source_data, opts.level) {
                    Ok(v) => v,
                    Err(e) => return WriteResult::Err(e.into()),
                };
                &compressed_buf
            }
            Compression::None => source_data,
        };
        // `defer if (compress != .none) free(data_to_write)` — handled by `compressed_buf: Vec<u8>` Drop.

        let file = match bun_sys::File::openat(
            Fd::cwd(),
            self.path.as_bytes(),
            bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC,
            0o644,
        ) {
            Err(err) => return WriteResult::SysErr(err),
            Ok(f) => f,
        };

        let res = match file.write_all(data_to_write) {
            Err(err) => WriteResult::SysErr(err),
            Ok(_) => WriteResult::Success,
        };
        let _ = file.close();
        res
    }
}

pub type WriteTask = AsyncTask<WriteContext>;

fn start_write_task(
    global: &JSGlobalObject,
    data: WriteData,
    path: &[u8],
    compress: Compression,
) -> JsResult<JSValue> {
    let path_z = ZBox::from_vec_with_nul(path.to_vec());

    // Ref store if using store reference — already done by caller via Arc::clone into WriteData::Store.
    // errdefer store.deref / free(data.owned) — handled by WriteData Drop on early return.

    let task = WriteTask::create(
        global,
        WriteContext {
            data,
            path: path_z,
            compress,
            result: WriteResult::Success,
        },
    )?;

    let promise_js = WriteTask::promise_value(task);
    WriteTask::schedule(task);
    Ok(promise_js)
}

struct FileEntry {
    path: Box<[u8]>,
    data: Vec<u8>,
    mtime: i64,
}

type FileEntryList = Vec<FileEntry>;

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
enum FilesError {
    #[error("OutOfMemory")]
    OutOfMemory,
    #[error("ReadError")]
    ReadError,
}

enum FilesResult {
    Success(FileEntryList),
    LibarchiveErr(CString),
    Err(FilesError),
}

// freeEntries deleted — Vec<FileEntry> drops each entry; FileEntry fields drop their boxes.

pub struct FilesContext {
    store: StoreRef,
    glob_patterns: Option<Vec<Box<[u8]>>>,
    result: FilesResult,
}

impl FilesContext {
    fn clone_error_string(archive: *mut libarchive::lib::Archive) -> Option<CString> {
        let err_str = libarchive::lib::Archive::error_string(archive);
        if err_str.is_empty() {
            return None;
        }
        CString::new(err_str).ok()
    }

    fn do_run(&mut self) -> Result<FilesResult, bun_alloc::AllocError> {
        use libarchive::lib;
        let archive = lib::ReadArchive::new();
        configure_archive_reader(&archive);

        if archive.read_open_memory(self.store.shared_view()) != lib::Result::Ok {
            return Ok(
                if let Some(err) = Self::clone_error_string(archive.as_ptr()) {
                    FilesResult::LibarchiveErr(err)
                } else {
                    FilesResult::Err(FilesError::ReadError)
                },
            );
        }

        let mut entries: FileEntryList = Vec::new();
        // errdefer freeEntries(&entries) — handled by Drop on `entries`

        let mut entry: *mut lib::Entry = core::ptr::null_mut();
        while archive.read_next_header(&mut entry) == lib::Result::Ok {
            let entry_ref = lib::Entry::opaque_ref(entry);
            if entry_ref.filetype() != FILETYPE_REGULAR {
                continue;
            }

            let pathname = entry_ref.pathname_utf8().as_bytes();
            // Apply glob pattern filtering (supports both positive and negative patterns)
            if let Some(patterns) = &self.glob_patterns {
                if !match_glob_patterns(patterns, pathname) {
                    continue;
                }
            }

            let size: usize = usize::try_from(entry_ref.size().max(0)).expect("int cast");
            let mtime: i64 = entry_ref.mtime();

            // Read data incrementally so untrusted entry sizes don't drive allocation.
            let mut data: Vec<u8> = Vec::new();
            if size > 0 {
                let mut total_read: usize = 0;
                let mut buf = [0u8; 64 * 1024];
                while total_read < size {
                    let to_read = (size - total_read).min(buf.len());
                    let read = archive.read_data(&mut buf[..to_read]);
                    if read < 0 {
                        // Read error - returned as a normal Result (not a Zig error), so the
                        // errdefer above won't fire. Free the current buffer and all previously
                        // collected entries manually to avoid leaking them.
                        // PORT NOTE: in Rust both `data` and `entries` drop automatically here.
                        return Ok(
                            if let Some(err) = Self::clone_error_string(archive.as_ptr()) {
                                FilesResult::LibarchiveErr(err)
                            } else {
                                FilesResult::Err(FilesError::ReadError)
                            },
                        );
                    }
                    if read == 0 {
                        break;
                    }
                    let bytes_read = usize::try_from(read).expect("int cast");
                    data.try_reserve(bytes_read)
                        .map_err(|_| bun_alloc::AllocError)?;
                    data.extend_from_slice(&buf[..bytes_read]);
                    total_read += bytes_read;
                }
            }
            // errdefer free(data) — handled by Drop

            let path_copy: Box<[u8]> = Box::from(pathname);
            // errdefer free(path_copy) — handled by Drop

            entries.push(FileEntry {
                path: path_copy,
                data,
                mtime,
            });
        }

        Ok(FilesResult::Success(entries))
    }
}

impl TaskContext for FilesContext {
    const TAG: TaskTag = task_tag::ArchiveFilesTask;

    fn run(&mut self) {
        self.result = match self.do_run() {
            Ok(r) => r,
            Err(_) => FilesResult::Err(FilesError::OutOfMemory),
        };
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        match &mut self.result {
            FilesResult::Success(entries) => {
                let map = JSMap::create(global);
                let Some(mut map_ptr) = JSMap::from_js(map) else {
                    return Ok(PromiseResult::Reject(
                        global.create_error_instance(format_args!("Failed to create Map")),
                    ));
                };

                for entry in entries.iter_mut() {
                    let data = core::mem::take(&mut entry.data); // Ownership transferred
                    let blob_ptr =
                        Blob::new(Blob::create_with_bytes_and_allocator(data, global, false));
                    // SAFETY: blob_ptr is the heap allocation just produced by Blob::new.
                    let blob = unsafe { &mut *blob_ptr };
                    blob.is_jsdom_file.set(true);
                    blob.name.set(bun_core::String::clone_utf8(&entry.path));
                    blob.last_modified.set((entry.mtime * 1000) as f64);

                    let name_js = blob.name.get().to_js(global)?;
                    let blob_js = blob.to_js(global);
                    // SAFETY: map_ptr came from JSMap::from_js on a live value.
                    unsafe { map_ptr.as_mut() }.set(global, name_js, blob_js)?;
                }

                Ok(PromiseResult::Resolve(map))
            }
            FilesResult::LibarchiveErr(err_msg) => Ok(PromiseResult::Reject(
                global
                    .create_error_instance(format_args!("{}", bstr::BStr::new(err_msg.to_bytes()))),
            )),
            FilesResult::Err(e) => Ok(PromiseResult::Reject(
                global.create_error_instance(format_args!("{}", <&'static str>::from(&*e))),
            )),
        }
    }
}

pub type FilesTask = AsyncTask<FilesContext>;

fn start_files_task(
    global: &JSGlobalObject,
    store: &StoreRef,
    glob_patterns: Option<Vec<Box<[u8]>>>,
) -> JsResult<JSValue> {
    let store = store.clone();
    // errdefer store.deref() — Drop handles it
    // Ownership: On error, caller's errdefer frees glob_patterns.
    // On success, ownership transfers to FilesContext, which frees them in deinit().

    let task = FilesTask::create(
        global,
        FilesContext {
            store,
            glob_patterns,
            result: FilesResult::Err(FilesError::ReadError),
        },
    )?;

    let promise_js = FilesTask::promise_value(task);
    FilesTask::schedule(task);
    Ok(promise_js)
}

// ============================================================================
// Helpers
// ============================================================================

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
enum CompressError {
    #[error("GzipInitFailed")]
    GzipInitFailed,
    #[error("GzipCompressFailed")]
    GzipCompressFailed,
    #[error("OutOfMemory")]
    OutOfMemory,
}

impl From<CompressError> for BlobError {
    fn from(e: CompressError) -> Self {
        match e {
            CompressError::GzipInitFailed => BlobError::GzipInitFailed,
            CompressError::GzipCompressFailed => BlobError::GzipCompressFailed,
            CompressError::OutOfMemory => BlobError::OutOfMemory,
        }
    }
}

impl From<CompressError> for WriteError {
    fn from(e: CompressError) -> Self {
        match e {
            CompressError::GzipInitFailed => WriteError::GzipInitFailed,
            CompressError::GzipCompressFailed => WriteError::GzipCompressFailed,
            CompressError::OutOfMemory => WriteError::OutOfMemory,
        }
    }
}

fn compress_gzip(data: &[u8], level: u8) -> Result<Vec<u8>, CompressError> {
    use bun_libdeflate_sys::libdeflate;
    libdeflate::load();

    let compressor_ptr = libdeflate::Compressor::alloc(i32::from(level));
    if compressor_ptr.is_null() {
        return Err(CompressError::GzipInitFailed);
    }
    // defer compressor.deinit();
    let _guard = scopeguard::guard(compressor_ptr, |p| unsafe {
        libdeflate::Compressor::destroy(p)
    });
    // SAFETY: alloc returned non-null; freed by `_guard` on scope exit.
    let compressor: &mut libdeflate::Compressor = unsafe { &mut *compressor_ptr };

    let max_size = compressor.max_bytes_needed(data, libdeflate::Encoding::Gzip);

    // PERF(port): the Zig spec used a 256 KiB on-stack scratch for small inputs;
    // in Rust the scratch is heap-allocated either way, so the threshold is dead
    // weight — just size the Vec to `max_size` once.
    let mut output = Vec::with_capacity(max_size);
    let result = compressor.compress_to_vec(data, &mut output, libdeflate::Encoding::Gzip);
    if result.status != libdeflate::Status::Success {
        return Err(CompressError::GzipCompressFailed);
    }
    Ok(output)
}

/// Check if a path is safe (no absolute paths or path traversal)
pub fn is_safe_path(pathname: &[u8]) -> bool {
    // Reject empty paths
    if pathname.is_empty() {
        return false;
    }

    // Reject absolute paths
    if pathname[0] == b'/' || pathname[0] == b'\\' {
        return false;
    }

    // Check for Windows drive letters (e.g., "C:")
    if pathname.len() >= 2 && pathname[1] == b':' {
        return false;
    }

    // Reject paths with ".." components
    for component in pathname.split(|b| *b == b'/') {
        if component == b".." {
            return false;
        }
        // Also check Windows-style separators
        for win_component in component.split(|b| *b == b'\\') {
            if win_component == b".." {
                return false;
            }
        }
    }

    true
}

/// Match a path against multiple glob patterns with support for negative patterns.
/// Positive patterns: at least one must match for the path to be included.
/// Negative patterns (starting with "!"): if any matches, the path is excluded.
/// Returns true if the path should be included, false if excluded.
pub fn match_glob_patterns(patterns: &[Box<[u8]>], pathname: &[u8]) -> bool {
    let mut has_positive_patterns = false;
    let mut matches_positive = false;

    for pattern in patterns {
        // Check if it's a negative pattern
        if !pattern.is_empty() && pattern[0] == b'!' {
            // Negative pattern - if it matches, exclude the file
            let neg_pattern = &pattern[1..];
            if !neg_pattern.is_empty() && glob::r#match(neg_pattern, pathname).matches() {
                return false;
            }
        } else {
            // Positive pattern - at least one must match
            has_positive_patterns = true;
            if glob::r#match(pattern, pathname).matches() {
                matches_positive = true;
            }
        }
    }

    // If there are no positive patterns, include everything (that wasn't excluded)
    // If there are positive patterns, at least one must match
    !has_positive_patterns || matches_positive
}

/// Extract archive to disk with glob pattern filtering.
/// Supports negative patterns with "!" prefix (e.g., "!node_modules/**").
fn extract_to_disk_filtered(
    file_buffer: &[u8],
    root: &[u8],
    glob_patterns: Option<&[Box<[u8]>]>,
) -> Result<u32, bun_core::Error> {
    // TODO(port): narrow error set
    use libarchive::lib;
    let archive = lib::ReadArchive::new();
    configure_archive_reader(&archive);

    if archive.read_open_memory(file_buffer) != lib::Result::Ok {
        return Err(bun_core::err!("ReadError"));
    }

    // Open/create target directory using bun.sys
    let cwd = Fd::cwd();
    let _ = cwd.make_path(root);
    let dir_fd: Fd = 'brk: {
        if bun_paths::is_absolute(root) {
            break 'brk match bun_sys::open_a(root, bun_sys::O::RDONLY | bun_sys::O::DIRECTORY, 0) {
                Ok(fd) => fd,
                Err(_) => return Err(bun_core::err!("OpenError")),
            };
        } else {
            break 'brk match bun_sys::openat_a(
                cwd,
                root,
                bun_sys::O::RDONLY | bun_sys::O::DIRECTORY,
                0,
            ) {
                Ok(fd) => fd,
                Err(_) => return Err(bun_core::err!("OpenError")),
            };
        }
    };
    let _dir_close = bun_sys::CloseOnDrop::new(dir_fd);

    let mut count: u32 = 0;
    let mut entry: *mut lib::Entry = core::ptr::null_mut();

    while archive.read_next_header(&mut entry) == lib::Result::Ok {
        let entry_ref = lib::Entry::opaque_ref(entry);
        let pathname_z = entry_ref.pathname_utf8();
        let pathname = pathname_z.as_bytes();

        // Validate path safety (reject absolute paths, path traversal)
        if !is_safe_path(pathname) {
            continue;
        }

        // Apply glob pattern filtering. Supports negative patterns with "!" prefix.
        // Positive patterns: at least one must match
        // Negative patterns: if any matches, the file is excluded
        if let Some(patterns) = glob_patterns {
            if !match_glob_patterns(patterns, pathname) {
                continue;
            }
        }

        let filetype = entry_ref.filetype();
        let kind = bun_sys::kind_from_mode(filetype);

        match kind {
            bun_sys::FileKind::Directory => {
                match dir_fd.make_path(pathname) {
                    // Directory already exists - don't count as extracted
                    Err(e) if e == bun_core::err!("PathAlreadyExists") => continue,
                    Err(_) => continue,
                    Ok(()) => {}
                }
                count += 1;
            }
            bun_sys::FileKind::File => {
                let size: usize = usize::try_from(entry_ref.size().max(0)).expect("int cast");
                // Sanitize permissions: use entry perms masked to 0o777, or default 0o644
                let entry_perm = entry_ref.perm();
                let mode: Mode = if entry_perm != 0 {
                    Mode::try_from(entry_perm & 0o777).expect("int cast")
                } else {
                    0o644
                };

                // Create parent directories if needed (ignore expected errors)
                if let Some(parent_dir) = bun_core::dirname(pathname) {
                    match dir_fd.make_path(parent_dir) {
                        // Expected: directory already exists
                        Err(e) if e == bun_core::err!("PathAlreadyExists") => {}
                        // Permission errors: skip this file, will fail at openat
                        Err(e) if e == bun_core::err!("AccessDenied") => {}
                        // Other errors: skip, will fail at openat
                        Err(_) => {}
                        Ok(()) => {}
                    }
                }

                // Create and write the file using bun.sys
                let file_fd: Fd = match bun_sys::openat(
                    dir_fd,
                    pathname_z,
                    bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                    mode,
                ) {
                    Ok(fd) => fd,
                    Err(_) => continue,
                };

                let mut write_success = true;
                if size > 0 {
                    // Read archive data and write to file
                    let mut remaining = size;
                    let mut buf = [0u8; 64 * 1024];
                    while remaining > 0 {
                        let to_read = remaining.min(buf.len());
                        let read = archive.read_data(&mut buf[..to_read]);
                        if read <= 0 {
                            write_success = false;
                            break;
                        }
                        let bytes_read: usize = usize::try_from(read).expect("int cast");
                        // Write all bytes, handling partial writes
                        let mut written: usize = 0;
                        while written < bytes_read {
                            let w = match bun_sys::write(file_fd, &buf[written..bytes_read]) {
                                Ok(w) => w,
                                Err(_) => {
                                    write_success = false;
                                    break;
                                }
                            };
                            if w == 0 {
                                write_success = false;
                                break;
                            }
                            written += w;
                        }
                        if !write_success {
                            break;
                        }
                        remaining -= bytes_read;
                    }
                }
                let _ = file_fd.close();

                if write_success {
                    count += 1;
                } else {
                    // Remove partial file on failure
                    let _ = bun_sys::unlinkat(dir_fd, pathname_z);
                }
            }
            bun_sys::FileKind::SymLink => {
                let link_target_z = entry_ref.symlink();
                // Validate symlink target is also safe
                if !is_safe_path(link_target_z.as_bytes()) {
                    continue;
                }
                // Symlinks are only extracted on POSIX systems (Linux/macOS).
                // On Windows, symlinks are skipped since they require elevated privileges.
                #[cfg(unix)]
                {
                    match bun_sys::symlinkat(link_target_z, dir_fd, pathname_z) {
                        Err(err) => {
                            if matches!(err.get_errno(), bun_sys::E::EPERM | bun_sys::E::ENOENT) {
                                if let Some(parent) = bun_core::dirname(pathname) {
                                    let _ = dir_fd.make_path(parent);
                                }
                                if bun_sys::symlinkat(link_target_z, dir_fd, pathname_z).is_err() {
                                    continue;
                                }
                            } else {
                                continue;
                            }
                        }
                        Ok(()) => {}
                    }
                    count += 1;
                }
            }
            _ => {}
        }
    }

    Ok(count)
}

// ported from: src/runtime/api/Archive.zig
