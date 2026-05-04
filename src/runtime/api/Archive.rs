use core::ffi::{c_char, CStr};
use core::mem::offset_of;
use std::ffi::CString;
use std::sync::Arc;

use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSValue, JsResult, JSPromise, JSPromiseStrong,
    ConcurrentTask, VirtualMachine, JSMap, JSPropertyIterator, JSPropertyIteratorOptions,
};
use bun_jsc::webcore::{Blob, BlobStore};
use bun_threading::{WorkPool, WorkPoolTask};
use bun_aio::KeepAlive;
use bun_core::{self, Output};
use bun_str::{self as strings, ZigString};
use bun_sys::{self, Fd, Mode};
use bun_glob as glob;
use bun_libarchive as libarchive;
use bun_libdeflate_sys as libdeflate;

// TODO(port): codegen aliases (`js`, `toJS`, `fromJS`, `fromJSDirect`) are wired by
// `#[bun_jsc::JsClass]`; the Zig `pub const js = jsc.Codegen.JSArchive;` lines are deleted.

/// Compression options for the archive
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

#[bun_jsc::JsClass]
pub struct Archive {
    /// The underlying data for the archive - uses Blob.Store for thread-safe ref counting
    store: Arc<BlobStore>,
    /// Compression settings for this archive
    compress: Compression,
}

impl Archive {
    pub fn finalize(this: *mut Self) {
        jsc::mark_binding(core::panic::Location::caller());
        // SAFETY: called once by the JSC finalizer on the mutator thread; `this`
        // was allocated by `Box::into_raw` in `constructor`/`create_archive`.
        drop(unsafe { Box::from_raw(this) });
        // store.deref() happens via Arc<BlobStore>::drop
    }

    /// Pretty-print for console.log
    pub fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> Result<(), bun_core::Error>
    where
        // TODO(port): narrow to the actual ConsoleObject.Formatter trait once ported
        F: bun_jsc::ConsoleFormatter,
        W: core::fmt::Write,
    {
        let data = self.store.shared_view();

        write!(
            writer,
            "{}",
            Output::pretty_fmt::<ENABLE_ANSI_COLORS>(&format_args!(
                "Archive ({}) {{\n",
                bun_core::fmt::size(data.len(), Default::default())
            )),
        )?;

        {
            formatter.indent_add(1);
            let _guard = scopeguard::guard((), |_| formatter.indent_saturating_sub(1));
            // PORT NOTE: reshaped for borrowck — Zig used `defer formatter.indent -|= 1;`

            formatter.write_indent(writer)?;
            writer.write_str(Output::pretty_fmt_str::<ENABLE_ANSI_COLORS>("<r>files<d>:<r> "))?;
            formatter.print_as(
                bun_jsc::FormatterTag::Double,
                writer,
                JSValue::js_number(count_files_in_archive(data) as f64),
                bun_jsc::JSType::NumberObject,
                ENABLE_ANSI_COLORS,
            )?;
        }
        writer.write_str("\n")?;
        formatter.write_indent(writer)?;
        writer.write_str("}")?;
        formatter.reset_line();
        Ok(())
    }
}

/// Configure archive for reading tar/tar.gz
fn configure_archive_reader(archive: &mut libarchive::lib::Archive) {
    let _ = archive.read_support_format_tar();
    let _ = archive.read_support_format_gnutar();
    let _ = archive.read_support_filter_gzip();
    let _ = archive.read_set_options(b"read_concatenated_archives\0");
}

/// Count the number of files in an archive
fn count_files_in_archive(data: &[u8]) -> u32 {
    let archive = libarchive::lib::Archive::read_new();
    let _guard = scopeguard::guard((), |_| {
        let _ = archive.read_free();
    });
    configure_archive_reader(archive);

    if archive.read_open_memory(data) != libarchive::lib::Status::Ok {
        return 0;
    }

    let mut count: u32 = 0;
    let mut entry: *mut libarchive::lib::ArchiveEntry = core::ptr::null_mut();
    while archive.read_next_header(&mut entry) == libarchive::lib::Status::Ok {
        // SAFETY: read_next_header returned Ok, so entry is valid until the next call.
        if unsafe { (*entry).filetype() } == libarchive::lib::FileType::Regular as u32 {
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
    #[bun_jsc::host_fn(constructor)]
    pub fn constructor(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<Box<Archive>> {
        let [data_arg, options_arg] = callframe.arguments_as_array::<2>();
        if data_arg.is_empty() {
            return global.throw_invalid_arguments("new Archive() requires an argument", &[]);
        }

        // Parse compression options
        let compress = parse_compression_options(global, options_arg)?;

        // For Blob/Archive, ref the existing store (zero-copy)
        if let Some(blob_ptr) = data_arg.as_::<Blob>() {
            if let Some(store) = blob_ptr.store() {
                // Arc::clone == store.ref()
                return Ok(Box::new(Archive { store: Arc::clone(store), compress }));
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

        global.throw_invalid_arguments("Expected an object, Blob, TypedArray, or ArrayBuffer", &[])
    }
}

/// Parse compression options from JS value
/// Returns .none if no compression specified, caller must handle defaults
fn parse_compression_options(global: &JSGlobalObject, options_arg: JSValue) -> JsResult<Compression> {
    // No options provided means no compression (caller handles defaults)
    if options_arg.is_undefined_or_null() {
        return Ok(Compression::None);
    }

    if !options_arg.is_object() {
        return global.throw_invalid_arguments("Archive: options must be an object", &[]);
    }

    // Check for compress option
    if let Some(compress_val) = options_arg.get_truthy(global, "compress")? {
        // compress must be "gzip"
        if !compress_val.is_string() {
            return global.throw_invalid_arguments("Archive: compress option must be a string", &[]);
        }

        let compress_str = compress_val.to_slice(global)?;
        // Drop handles compress_str.deinit()

        if compress_str.slice() != b"gzip" {
            return global.throw_invalid_arguments("Archive: compress option must be \"gzip\"", &[]);
        }

        // Parse level option (1-12, default 6)
        let mut level: u8 = 6;
        if let Some(level_val) = options_arg.get_truthy(global, "level")? {
            if !level_val.is_number() {
                return global.throw_invalid_arguments("Archive: level must be a number", &[]);
            }
            let level_num = level_val.to_int64();
            if level_num < 1 || level_num > 12 {
                return global.throw_invalid_arguments("Archive: level must be between 1 and 12", &[]);
            }
            level = u8::try_from(level_num).unwrap();
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

/// Shared helper that builds tarball bytes from a JS object
fn build_tarball_from_object(global: &JSGlobalObject, obj: JSValue) -> JsResult<Vec<u8>> {
    use libarchive::lib;

    let Some(js_obj) = obj.get_object() else {
        return global.throw_invalid_arguments("Expected an object", &[]);
    };

    // Set up archive first
    let mut growing_buffer = lib::GrowingBuffer::init();
    // errdefer growing_buffer.deinit() — handled by Drop on early return

    let archive = lib::Archive::write_new();
    let _archive_guard = scopeguard::guard((), |_| {
        let _ = archive.write_free();
    });

    if archive.write_set_format_pax_restricted() != lib::Status::Ok {
        return global.throw_invalid_arguments("Failed to create tarball: ArchiveFormatError", &[]);
    }

    // SAFETY: archive and growing_buffer live for the duration of the write; callbacks
    // are libarchive C callbacks with the documented signatures.
    if unsafe {
        lib::archive_write_open2(
            archive as *mut _ as *mut _,
            &mut growing_buffer as *mut _ as *mut _,
            Some(lib::GrowingBuffer::open_callback),
            Some(lib::GrowingBuffer::write_callback),
            Some(lib::GrowingBuffer::close_callback),
            None,
        )
    } != 0
    {
        return global.throw_invalid_arguments("Failed to create tarball: ArchiveOpenError", &[]);
    }

    let entry = lib::ArchiveEntry::new();
    let _entry_guard = scopeguard::guard((), |_| entry.free());

    // TODO(port): std.time.milliTimestamp() — map to bun_core time helper
    let now_secs: isize = isize::try_from(bun_core::time::milli_timestamp() / 1000).unwrap();

    // Iterate over object properties and write directly to archive
    let mut iter = JSPropertyIterator::init(
        global,
        js_obj,
        JSPropertyIteratorOptions {
            skip_empty_name: true,
            include_value: true,
        },
    )?;
    // Drop handles iter.deinit()

    while let Some(key) = iter.next()? {
        let value = iter.value();
        if value.is_empty() {
            continue;
        }

        // Get the key as a null-terminated string
        let key_slice = key.to_utf8();
        let key_str = bun_str::ZStr::from_bytes(key_slice.slice());

        // Get data - use view for Blob/ArrayBuffer, convert for strings
        let data_slice = get_entry_data(global, value)?;

        // Write entry to archive
        let data = data_slice.slice();
        let _ = entry.clear();
        entry.set_pathname_utf8(key_str.as_cstr());
        entry.set_size(i64::try_from(data.len()).unwrap());
        entry.set_filetype(lib::FileType::Regular as u32);
        entry.set_perm(0o644);
        entry.set_mtime(now_secs, 0);

        if archive.write_header(entry) != lib::Status::Ok {
            return global.throw_invalid_arguments("Failed to create tarball: ArchiveHeaderError", &[]);
        }
        if archive.write_data(data) < 0 {
            return global.throw_invalid_arguments("Failed to create tarball: ArchiveWriteError", &[]);
        }
        if archive.write_finish_entry() != lib::Status::Ok {
            return global.throw_invalid_arguments("Failed to create tarball: ArchiveFinishEntryError", &[]);
        }
    }

    if archive.write_close() != lib::Status::Ok {
        return global.throw_invalid_arguments("Failed to create tarball: ArchiveCloseError", &[]);
    }

    match growing_buffer.to_owned_slice() {
        Ok(v) => Ok(v),
        Err(_) => global.throw_invalid_arguments("Failed to create tarball: OutOfMemory", &[]),
    }
}

/// Returns data as a ZigString.Slice (handles ownership automatically via deinit)
fn get_entry_data(global: &JSGlobalObject, value: JSValue) -> JsResult<ZigString::Slice> {
    // For Blob, use sharedView (no copy needed)
    if let Some(blob_ptr) = value.as_::<Blob>() {
        return Ok(ZigString::Slice::from_utf8_never_free(blob_ptr.shared_view()));
    }

    // For ArrayBuffer/TypedArray, use view (no copy needed)
    if let Some(array_buffer) = value.as_array_buffer(global) {
        return Ok(ZigString::Slice::from_utf8_never_free(array_buffer.slice()));
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
        return global.throw_invalid_arguments("Archive.write requires 2 arguments (path, data)", &[]);
    }

    // Get the path
    if !path_arg.is_string() {
        return global.throw_invalid_arguments("Archive.write: first argument must be a string path", &[]);
    }

    let path_slice = path_arg.to_slice(global)?;

    // Parse options for compression override
    let options_compress = parse_compression_options(global, options_arg)?;

    // For Archive instances, use options override or archive's compression settings
    if let Some(archive) = Archive::from_js(data_arg) {
        let compress = if !matches!(options_compress, Compression::None) {
            options_compress
        } else {
            archive.compress.clone_shallow()
            // TODO(port): Compression is not Copy due to Gzip payload struct; verify clone semantics
        };
        return start_write_task(global, WriteData::Store(Arc::clone(&archive.store)), path_slice.slice(), compress);
    }

    // For Blobs, use store reference with options compression
    if let Some(blob_ptr) = data_arg.as_::<Blob>() {
        if let Some(store) = blob_ptr.store() {
            return start_write_task(global, WriteData::Store(Arc::clone(store)), path_slice.slice(), options_compress);
        }
    }

    // For ArrayBuffer/TypedArray, copy the data with options compression
    if let Some(array_buffer) = data_arg.as_array_buffer(global) {
        let data = array_buffer.slice().to_vec();
        return start_write_task(global, WriteData::Owned(data), path_slice.slice(), options_compress);
    }

    // For plain objects, build a tarball with options compression
    if data_arg.is_object() {
        let data = build_tarball_from_object(global, data_arg)?;
        return start_write_task(global, WriteData::Owned(data), path_slice.slice(), options_compress);
    }

    global.throw_invalid_arguments("Expected an object, Blob, TypedArray, ArrayBuffer, or Archive", &[])
}

impl Archive {
    /// Instance method: archive.extract(path, options?)
    /// Extracts the archive to the given path
    /// Options:
    ///   - glob: string | string[] - Only extract files matching the glob pattern(s). Supports negative patterns with "!".
    /// Returns Promise<number> with count of extracted files
    #[bun_jsc::host_fn(method)]
    pub fn extract(this: &mut Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let [path_arg, options_arg] = callframe.arguments_as_array::<2>();
        if path_arg.is_empty() || !path_arg.is_string() {
            return global.throw_invalid_arguments("Archive.extract requires a path argument", &[]);
        }

        let path_slice = path_arg.to_slice(global)?;

        // Parse options
        let mut glob_patterns: Option<Vec<Box<[u8]>>> = None;
        // errdefer freePatterns — handled by Drop on Vec<Box<[u8]>>

        if !options_arg.is_undefined_or_null() {
            if !options_arg.is_object() {
                return global.throw_invalid_arguments(
                    "Archive.extract: second argument must be an options object",
                    &[],
                );
            }

            // Parse glob option
            if let Some(glob_val) = options_arg.get_truthy(global, "glob")? {
                glob_patterns = parse_pattern_arg(global, glob_val, b"Archive.extract", b"glob")?;
            }
        }

        start_extract_task(global, &this.store, path_slice.slice(), glob_patterns)
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
        if str_slice.len() == 0 {
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

        let mut patterns: Vec<Box<[u8]>> = Vec::with_capacity(usize::try_from(len).unwrap());
        // errdefer { for p free; deinit } — handled by Drop on Vec<Box<[u8]>>

        // Use index-based iteration for safety (avoids issues if array mutates)
        let mut i: u32 = 0;
        while u64::from(i) < len {
            let item = arg.get_index(global, i)?;
            if !item.is_string() {
                return global.throw_invalid_arguments(
                    "{s}: {s} array must contain only strings",
                    &[api_name.into(), name.into()],
                );
                // TODO(port): format-args plumbing for throw_invalid_arguments
            }
            let str_slice = item.to_slice(global)?;
            // Skip empty strings in array
            if str_slice.len() == 0 {
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

    global.throw_invalid_arguments(
        "{s}: {s} must be a string or array of strings",
        &[api_name.into(), name.into()],
    )
}

// freePatterns deleted — Vec<Box<[u8]>> drops elements then itself.

impl Archive {
    /// Instance method: archive.blob()
    /// Returns Promise<Blob> with the archive data (compressed if gzip was set in options)
    #[bun_jsc::host_fn(method)]
    pub fn blob(this: &mut Self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        start_blob_task(global, &this.store, this.compress.clone_shallow(), BlobOutputType::Blob)
    }

    /// Instance method: archive.bytes()
    /// Returns Promise<Uint8Array> with the archive data (compressed if gzip was set in options)
    #[bun_jsc::host_fn(method)]
    pub fn bytes(this: &mut Self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        start_blob_task(global, &this.store, this.compress.clone_shallow(), BlobOutputType::Bytes)
    }

    /// Instance method: archive.files(glob?)
    /// Returns Promise<Map<string, File>> with archive file contents
    #[bun_jsc::host_fn(method)]
    pub fn files(this: &mut Self, global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        let glob_arg = callframe.argument(0);

        let mut glob_patterns: Option<Vec<Box<[u8]>>> = None;
        // errdefer freePatterns — handled by Drop

        if !glob_arg.is_undefined_or_null() {
            glob_patterns = parse_pattern_arg(global, glob_arg, b"Archive.files", b"glob")?;
        }

        start_files_task(global, &this.store, glob_patterns)
    }
}

impl Compression {
    // TODO(port): helper to mimic Zig's struct copy semantics; replace with #[derive(Clone, Copy)]
    // once GzipOptions is confirmed Copy-safe across the crate.
    fn clone_shallow(&self) -> Self {
        match self {
            Compression::None => Compression::None,
            Compression::Gzip(o) => Compression::Gzip(*o),
        }
    }
}

// ============================================================================
// Generic Async Task Infrastructure
// ============================================================================

enum PromiseResult {
    Resolve(JSValue),
    Reject(JSValue),
}

impl PromiseResult {
    fn fulfill(self, global: &JSGlobalObject, promise: &mut JSPromise) -> bun_jsc::JsTerminatedResult<()> {
        match self {
            PromiseResult::Resolve(v) => promise.resolve(global, v),
            PromiseResult::Reject(v) => promise.reject_with_async_stack(global, v),
        }
    }
}

/// Trait extracted from the Zig structural-duck-typing on `Context`.
/// Context must provide:
///   - `run` — runs on thread pool, stores result in `self`
///   - `run_from_js` — returns value to resolve/reject
///   - `Drop` — cleanup
trait TaskContext: Send {
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
    vm: &'static VirtualMachine,
    task: WorkPoolTask,
    concurrent_task: ConcurrentTask,
    keep_alive: KeepAlive,
}

impl<C: TaskContext> AsyncTask<C> {
    fn create(global: &JSGlobalObject, ctx: C) -> Result<*mut Self, bun_alloc::AllocError> {
        let vm = global.bun_vm();
        let this = Box::new(AsyncTask {
            ctx,
            promise: JSPromiseStrong::init(global),
            vm,
            task: WorkPoolTask { callback: Self::run_callback },
            concurrent_task: ConcurrentTask::default(),
            keep_alive: KeepAlive::default(),
        });
        let raw = Box::into_raw(this);
        // SAFETY: raw was just produced by Box::into_raw; not yet shared.
        unsafe { (*raw).keep_alive.ref_(vm) };
        Ok(raw)
    }

    fn schedule(this: *mut Self) {
        // SAFETY: `this` is alive (owned by the task system) until run_from_js drops it;
        // task field is intrusive and stable since `this` is heap-allocated.
        unsafe { WorkPool::schedule(&mut (*this).task) };
    }

    fn run_callback(work_task: *mut WorkPoolTask) {
        // SAFETY: work_task points to the `task` field of an AsyncTask<C> allocated by `create`.
        let this: *mut Self = unsafe {
            (work_task as *mut u8)
                .sub(offset_of!(Self, task))
                .cast::<Self>()
        };
        // SAFETY: thread-pool has exclusive access to ctx until it enqueues the concurrent task.
        unsafe { (*this).ctx.run() };
        // SAFETY: vm is &'static; concurrent_task is intrusive on the same allocation.
        unsafe {
            (*this)
                .vm
                .enqueue_task_concurrent((*this).concurrent_task.from(this, ConcurrentTask::ManualDeinit));
        }
    }

    pub fn run_from_js(this: *mut Self) -> bun_jsc::JsTerminatedResult<()> {
        // SAFETY: called once on the JS thread after run_callback enqueued us; reclaim ownership.
        let mut owned = unsafe { Box::from_raw(this) };
        owned.keep_alive.unref(owned.vm);

        // `defer { ctx.deinit; destroy(this) }` — handled by `owned: Box<Self>` dropping at scope
        // exit (ctx implements Drop).

        if owned.vm.is_shutting_down() {
            return Ok(());
        }

        let global = owned.vm.global();
        let mut promise = owned.promise.swap();
        let result = match owned.ctx.run_from_js(global) {
            Ok(r) => r,
            Err(e) => {
                // JSError means exception is already pending
                return promise.reject(global, global.take_exception(e));
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

struct ExtractContext {
    store: Arc<BlobStore>,
    path: Box<[u8]>,
    glob_patterns: Option<Vec<Box<[u8]>>>,
    result: ExtractResult,
}

impl TaskContext for ExtractContext {
    fn run(&mut self) {
        self.result = self.do_run();
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        Ok(match &self.result {
            ExtractResult::Success(count) => PromiseResult::Resolve(JSValue::js_number(*count as f64)),
            ExtractResult::Err(e) => {
                PromiseResult::Reject(global.create_error_instance("{s}", &[<&'static str>::from(e).into()]))
            }
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
            (),
            (),
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
    store: &Arc<BlobStore>,
    path: &[u8],
    glob_patterns: Option<Vec<Box<[u8]>>>,
) -> JsResult<JSValue> {
    let path_copy: Box<[u8]> = Box::from(path);
    // errdefer free(path_copy) — Drop handles it

    let store = Arc::clone(store);
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

    // SAFETY: task is alive until run_from_js drops it.
    let promise_js = unsafe { (*task).promise.value() };
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

struct BlobContext {
    store: Arc<BlobStore>,
    compress: Compression,
    output_type: BlobOutputType,
    result: BlobResult,
}

impl TaskContext for BlobContext {
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
                global.create_error_instance("{s}", &[<&'static str>::from(&e).into()]),
            )),
            BlobResult::Compressed(data) => {
                // self.result already replaced with Uncompressed above — ownership transferred
                Ok(PromiseResult::Resolve(match self.output_type {
                    BlobOutputType::Blob => {
                        Blob::new(Blob::create_with_bytes_and_allocator(data, global, false)).to_js(global)
                    }
                    BlobOutputType::Bytes => JSValue::create_buffer(global, data),
                }))
            }
            BlobResult::Uncompressed => Ok(match self.output_type {
                BlobOutputType::Blob => {
                    let store = Arc::clone(&self.store);
                    PromiseResult::Resolve(Blob::new(Blob::init_with_store(store, global)).to_js(global))
                }
                BlobOutputType::Bytes => {
                    let dup = self.store.shared_view().to_vec();
                    // TODO(port): Zig matched OOM here and rejected; Rust Vec aborts on OOM.
                    PromiseResult::Resolve(JSValue::create_buffer(global, dup))
                }
            }),
        }
    }
}

pub type BlobTask = AsyncTask<BlobContext>;

fn start_blob_task(
    global: &JSGlobalObject,
    store: &Arc<BlobStore>,
    compress: Compression,
    output_type: BlobOutputType,
) -> JsResult<JSValue> {
    let store = Arc::clone(store);
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

    // SAFETY: task is alive until run_from_js drops it.
    let promise_js = unsafe { (*task).promise.value() };
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
    Store(Arc<BlobStore>),
}

struct WriteContext {
    data: WriteData,
    path: bun_str::ZStr,
    compress: Compression,
    result: WriteResult,
}

impl TaskContext for WriteContext {
    fn run(&mut self) {
        self.result = self.do_run();
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        Ok(match &self.result {
            WriteResult::Success => PromiseResult::Resolve(JSValue::UNDEFINED),
            WriteResult::Err(e) => {
                PromiseResult::Reject(global.create_error_instance("{s}", &[<&'static str>::from(e).into()]))
            }
            WriteResult::SysErr(sys_err) => PromiseResult::Reject(sys_err.to_js(global)?),
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
            self.path.as_cstr(),
            bun_sys::O::CREAT | bun_sys::O::WRONLY | bun_sys::O::TRUNC,
            0o644,
        ) {
            bun_sys::Result::Err(err) => return WriteResult::SysErr(err.clone_owned()),
            bun_sys::Result::Ok(f) => f,
        };
        let _close = scopeguard::guard((), |_| file.close());

        match file.write_all(data_to_write) {
            bun_sys::Result::Err(err) => WriteResult::SysErr(err.clone_owned()),
            bun_sys::Result::Ok(_) => WriteResult::Success,
        }
    }
}

pub type WriteTask = AsyncTask<WriteContext>;

fn start_write_task(
    global: &JSGlobalObject,
    data: WriteData,
    path: &[u8],
    compress: Compression,
) -> JsResult<JSValue> {
    let path_z = bun_str::ZStr::from_bytes(path);

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

    // SAFETY: task is alive until run_from_js drops it.
    let promise_js = unsafe { (*task).promise.value() };
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

struct FilesContext {
    store: Arc<BlobStore>,
    glob_patterns: Option<Vec<Box<[u8]>>>,
    result: FilesResult,
}

impl FilesContext {
    fn clone_error_string(archive: &libarchive::lib::Archive) -> Option<CString> {
        let err_str = archive.error_string();
        if err_str.is_empty() {
            return None;
        }
        CString::new(err_str).ok()
    }

    fn do_run(&mut self) -> Result<FilesResult, bun_alloc::AllocError> {
        use libarchive::lib;
        let archive = lib::Archive::read_new();
        let _guard = scopeguard::guard((), |_| {
            let _ = archive.read_free();
        });
        configure_archive_reader(archive);

        if archive.read_open_memory(self.store.shared_view()) != lib::Status::Ok {
            return Ok(if let Some(err) = Self::clone_error_string(archive) {
                FilesResult::LibarchiveErr(err)
            } else {
                FilesResult::Err(FilesError::ReadError)
            });
        }

        let mut entries: FileEntryList = Vec::new();
        // errdefer freeEntries(&entries) — handled by Drop on `entries`

        let mut entry: *mut lib::ArchiveEntry = core::ptr::null_mut();
        while archive.read_next_header(&mut entry) == lib::Status::Ok {
            // SAFETY: read_next_header returned Ok; entry valid until next call.
            let entry_ref = unsafe { &*entry };
            if entry_ref.filetype() != lib::FileType::Regular as u32 {
                continue;
            }

            let pathname = entry_ref.pathname_utf8();
            // Apply glob pattern filtering (supports both positive and negative patterns)
            if let Some(patterns) = &self.glob_patterns {
                if !match_glob_patterns(patterns, pathname) {
                    continue;
                }
            }

            let size: usize = usize::try_from(entry_ref.size().max(0)).unwrap();
            let mtime = entry_ref.mtime();

            // Read data first before allocating path
            let mut data: Vec<u8> = Vec::new();
            if size > 0 {
                data = vec![0u8; size];
                let mut total_read: usize = 0;
                while total_read < size {
                    let read = archive.read_data(&mut data[total_read..]);
                    if read < 0 {
                        // Read error - returned as a normal Result (not a Zig error), so the
                        // errdefer above won't fire. Free the current buffer and all previously
                        // collected entries manually to avoid leaking them.
                        // PORT NOTE: in Rust both `data` and `entries` drop automatically here.
                        return Ok(if let Some(err) = Self::clone_error_string(archive) {
                            FilesResult::LibarchiveErr(err)
                        } else {
                            FilesResult::Err(FilesError::ReadError)
                        });
                    }
                    if read == 0 {
                        break;
                    }
                    total_read += usize::try_from(read).unwrap();
                }
            }
            // errdefer free(data) — handled by Drop

            let path_copy: Box<[u8]> = Box::from(pathname);
            // errdefer free(path_copy) — handled by Drop

            entries.push(FileEntry { path: path_copy, data, mtime });
        }

        Ok(FilesResult::Success(entries))
    }
}

impl TaskContext for FilesContext {
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
                let Some(map_ptr) = JSMap::from_js(map) else {
                    return Ok(PromiseResult::Reject(
                        global.create_error_instance("Failed to create Map", &[]),
                    ));
                };

                for entry in entries.iter_mut() {
                    let data = core::mem::take(&mut entry.data); // Ownership transferred
                    let blob_ptr = Blob::new(Blob::create_with_bytes_and_allocator(data, global, false));
                    blob_ptr.is_jsdom_file = true;
                    blob_ptr.name = bun_str::String::clone_utf8(&entry.path);
                    blob_ptr.last_modified = (entry.mtime * 1000) as f64;

                    map_ptr.set(global, blob_ptr.name.to_js(global)?, blob_ptr.to_js(global))?;
                }

                Ok(PromiseResult::Resolve(map))
            }
            FilesResult::LibarchiveErr(err_msg) => Ok(PromiseResult::Reject(
                global.create_error_instance("{s}", &[bstr::BStr::new(err_msg.to_bytes()).into()]),
            )),
            FilesResult::Err(e) => Ok(PromiseResult::Reject(
                global.create_error_instance("{s}", &[<&'static str>::from(&*e).into()]),
            )),
        }
    }
}

pub type FilesTask = AsyncTask<FilesContext>;

fn start_files_task(
    global: &JSGlobalObject,
    store: &Arc<BlobStore>,
    glob_patterns: Option<Vec<Box<[u8]>>>,
) -> JsResult<JSValue> {
    let store = Arc::clone(store);
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

    // SAFETY: task is alive until run_from_js drops it.
    let promise_js = unsafe { (*task).promise.value() };
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
    libdeflate::load();

    let Some(compressor) = libdeflate::Compressor::alloc(i32::from(level)) else {
        return Err(CompressError::GzipInitFailed);
    };
    // Drop on Compressor calls deinit()
    let _guard = scopeguard::guard((), |_| compressor.deinit());
    // TODO(port): if libdeflate::Compressor implements Drop, remove the scopeguard.

    let max_size = compressor.max_bytes_needed(data, libdeflate::Encoding::Gzip);

    // Use stack buffer for small data, heap for large
    const STACK_THRESHOLD: usize = 256 * 1024;
    // PERF(port): was 256 KiB on-stack buffer; Rust uses heap Vec to avoid stack overflow.
    // Phase B: consider Box<[u8; STACK_THRESHOLD]> or thread-local.
    let mut stack_buf = vec![0u8; STACK_THRESHOLD];

    if max_size <= STACK_THRESHOLD {
        let result = compressor.gzip(data, &mut stack_buf);
        if result.status != libdeflate::Status::Success {
            return Err(CompressError::GzipCompressFailed);
        }
        return Ok(stack_buf[..result.written].to_vec());
    }

    let mut output = vec![0u8; max_size];
    // errdefer free(output) — Drop handles it

    let result = compressor.gzip(data, &mut output);
    if result.status != libdeflate::Status::Success {
        return Err(CompressError::GzipCompressFailed);
    }

    output.truncate(result.written);
    // Zig: realloc(output, written) catch output[0..written] — truncate is the moral equivalent.
    Ok(output)
}

/// Check if a path is safe (no absolute paths or path traversal)
fn is_safe_path(pathname: &[u8]) -> bool {
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
fn match_glob_patterns(patterns: &[Box<[u8]>], pathname: &[u8]) -> bool {
    let mut has_positive_patterns = false;
    let mut matches_positive = false;

    for pattern in patterns {
        // Check if it's a negative pattern
        if !pattern.is_empty() && pattern[0] == b'!' {
            // Negative pattern - if it matches, exclude the file
            let neg_pattern = &pattern[1..];
            if !neg_pattern.is_empty() && glob::match_(neg_pattern, pathname).matches() {
                return false;
            }
        } else {
            // Positive pattern - at least one must match
            has_positive_patterns = true;
            if glob::match_(pattern, pathname).matches() {
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
    let archive = lib::Archive::read_new();
    let _guard = scopeguard::guard((), |_| {
        let _ = archive.read_free();
    });
    configure_archive_reader(archive);

    if archive.read_open_memory(file_buffer) != lib::Status::Ok {
        return Err(bun_core::err!("ReadError"));
    }

    // Open/create target directory using bun.sys
    let cwd = Fd::cwd();
    let _ = cwd.make_path(root);
    let dir_fd: Fd = 'brk: {
        if bun_paths::is_absolute(root) {
            break 'brk match bun_sys::open_a(root, bun_sys::O::RDONLY | bun_sys::O::DIRECTORY, 0).unwrap_result() {
                Ok(fd) => fd,
                Err(_) => return Err(bun_core::err!("OpenError")),
            };
        } else {
            break 'brk match bun_sys::openat_a(cwd, root, bun_sys::O::RDONLY | bun_sys::O::DIRECTORY, 0).unwrap_result() {
                Ok(fd) => fd,
                Err(_) => return Err(bun_core::err!("OpenError")),
            };
        }
    };
    let _dir_close = scopeguard::guard((), |_| {
        let _ = dir_fd.close();
    });

    let mut count: u32 = 0;
    let mut entry: *mut lib::ArchiveEntry = core::ptr::null_mut();

    while archive.read_next_header(&mut entry) == lib::Status::Ok {
        // SAFETY: read_next_header returned Ok; entry valid until next call.
        let entry_ref = unsafe { &*entry };
        let pathname = entry_ref.pathname_utf8();

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
                let size: usize = usize::try_from(entry_ref.size().max(0)).unwrap();
                // Sanitize permissions: use entry perms masked to 0o777, or default 0o644
                let entry_perm = entry_ref.perm();
                let mode: Mode = if entry_perm != 0 {
                    Mode::try_from(entry_perm & 0o777).unwrap()
                } else {
                    0o644
                };

                // Create parent directories if needed (ignore expected errors)
                if let Some(parent_dir) = bun_paths::dirname(pathname) {
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
                    pathname,
                    bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC,
                    mode,
                )
                .unwrap_result()
                {
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
                        let bytes_read: usize = usize::try_from(read).unwrap();
                        // Write all bytes, handling partial writes
                        let mut written: usize = 0;
                        while written < bytes_read {
                            let w = match file_fd.write(&buf[written..bytes_read]).unwrap_result() {
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
                    let _ = dir_fd.unlinkat(pathname);
                }
            }
            bun_sys::FileKind::SymLink => {
                let link_target = entry_ref.symlink();
                // Validate symlink target is also safe
                if !is_safe_path(link_target) {
                    continue;
                }
                // Symlinks are only extracted on POSIX systems (Linux/macOS).
                // On Windows, symlinks are skipped since they require elevated privileges.
                #[cfg(unix)]
                {
                    match bun_sys::symlinkat(link_target, dir_fd, pathname).unwrap_result() {
                        Err(err) => {
                            if err == bun_core::err!("EPERM") || err == bun_core::err!("ENOENT") {
                                if let Some(parent) = bun_paths::dirname(pathname) {
                                    let _ = dir_fd.make_path(parent);
                                }
                                if bun_sys::symlinkat(link_target, dir_fd, pathname)
                                    .unwrap_result()
                                    .is_err()
                                {
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

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/Archive.zig (1146 lines)
//   confidence: medium
//   todos:      10
//   notes:      AsyncTask @typeInfo reflection collapsed into TaskContext trait; Arc<BlobStore> used per LIFETIMES.tsv but BlobStore is intrusive-refcounted in Zig — verify; libarchive Archive handle treated as &mut via FFI guards; start_write_task store-ref moved to caller (Arc::clone into WriteData::Store).
// ──────────────────────────────────────────────────────────────────────────
