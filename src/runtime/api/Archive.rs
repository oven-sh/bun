//! `Bun.Archive` — tar/tgz pack + extract over libarchive.

use std::ffi::CString;

use crate::webcore::Blob;
use crate::webcore::BlobExt as _;
use crate::webcore::blob::Store;
use bun_core::{self, EncodedSlice, Output, Utf8Bytes, ZBox, strings};
use bun_glob as glob;
use bun_jsc::{
    self as jsc, CallFrame, JSGlobalObject, JSMap, JSPromise, JSPromiseStrong, JSValue, JsResult,
};
use bun_jsc::{EncodedSliceJsc as _, StringJsc as _, SysErrorJsc as _};
use bun_libarchive as libarchive;
use bun_ptr::RefPtr;
use bun_sys::{self, Fd, FdDirExt as _, FdExt as _, Mode};

/// libarchive `AE_IFREG` (== `S_IFREG`). The Rust `bun_libarchive::lib` port
/// does not yet expose `FileType`, so mirror the constant locally.
const FILETYPE_REGULAR: u32 = 0o100000;

/// Compression options for the archive
#[derive(Clone, Copy, Default)]
pub(crate) enum Compression {
    #[default]
    None,
    Gzip(GzipOptions),
}

#[derive(Clone, Copy)]
pub(crate) struct GzipOptions {
    /// Compression level: 1 (fastest) to 12 (maximum compression). Default is 6.
    pub level: u8,
}

// Hand-written JS class glue (not the `#[bun_jsc::JsClass]` derive): Archive
// has no constructor, which the proc-macro does not expose.
#[repr(C)]
pub struct Archive {
    /// The underlying data for the archive - uses Blob.Store for thread-safe ref counting
    store: RefPtr<Store>,
    /// Compression settings for this archive
    compress: Compression,
}

impl Archive {
    /// Borrow the backing `RefPtr<Store>`.
    #[inline]
    pub(crate) fn store_ref(&self) -> &RefPtr<Store> {
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
    /// so forward to the module-level [`write`] body below.
    #[inline]
    pub fn write(global: &JSGlobalObject, callframe: &CallFrame) -> JsResult<JSValue> {
        self::write(global, callframe)
    }

    /// Pretty-print for console.log
    pub(crate) fn write_format<F, W, const ENABLE_ANSI_COLORS: bool>(
        &self,
        formatter: &mut F,
        writer: &mut W,
    ) -> crate::Result<()>
    where
        F: bun_jsc::ConsoleFormatter,
        W: core::fmt::Write,
    {
        let data = self.store.shared_view();
        let fmt_err = |_: core::fmt::Error| crate::Error::FormatError;

        writeln!(
            writer,
            "Archive ({}) {{",
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
                .map_err(|_| crate::Error::JSError)?;
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

/// Entry pathname as owned UTF-8 bytes. libarchive on Windows keeps a
/// charset-converted name (every pax `path=`) only in the wide-string slot;
/// `archive_entry_pathname` lossily narrows that through the "C" locale.
#[cfg(windows)]
fn entry_pathname_utf8(entry: &libarchive::lib::Entry) -> Result<Vec<u8>, bun_alloc::AllocError> {
    bun_core::strings::to_utf8_list_with_type(Vec::new(), entry.pathname_w().as_slice())
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
    while archive.read_next_header(&mut entry).succeeded() {
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
    // NOTE: `#[bun_jsc::host_fn]` has no `constructor` kind yet; the
    // `JsClass` derive emits a `constructor` shim that calls this directly.
    pub(crate) fn constructor(
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<Box<Archive>> {
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

        let compress_str = compress_val.to_utf8(global)?;

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
    let store = Store::init(data);
    Box::new(Archive { store, compress })
}

/// `JSValue::as_::<Blob>()` shim — kept as a free fn. Returns a shared
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

    // `archive` is a live `archive_write_new()` handle (see `Archive::write_new`
    // above); `growing_buffer` is stack-local and outlives all callback invocations
    // (the archive is closed before this fn returns).
    let open_rc = lib::archive_write_open2(
        &archive,
        (&raw mut growing_buffer).cast(),
        Some(lib::GrowingBuffer::open_callback),
        Some(lib::GrowingBuffer::write_callback),
        Some(lib::GrowingBuffer::close_callback),
        None,
    );
    if open_rc != 0 {
        return Err(global
            .throw_invalid_arguments(format_args!("Failed to create tarball: ArchiveOpenError")));
    }

    let entry = lib::OwnedEntry::new();
    let entry_ref: &lib::Entry = &entry;

    let now_secs: isize = isize::try_from(bun_core::time::milli_timestamp() / 1000).unwrap_or(0);

    // Iterate over object properties and write directly to archive
    let iter = jsc::JSPropertyIterator::init(
        global,
        js_obj,
        jsc::PropertyIteratorOptions {
            skip_empty_name: true,
            include_value: true,
        },
    )?;

    while let Some((key, value)) = iter.next()? {
        if value == JSValue::ZERO {
            continue;
        }

        // Get the key as a null-terminated string
        let key_slice = key.to_utf8();
        let key_str = ZBox::from_vec_with_nul(key_slice.slice().to_vec());

        // Get data - use view for Blob/ArrayBuffer, convert for strings
        let mut array_buffer = None;
        let data_slice = get_entry_data(global, value, &mut array_buffer)?;

        // Write entry to archive
        let data = data_slice.slice();
        let _ = entry_ref.clear();
        // Same platform split as `pack_command::add_archive_entry`: the process
        // locale is always "C", so libarchive's locale-keyed pax writer is only
        // lossless with raw bytes on POSIX and with the UTF-8 form on Windows.
        #[cfg(windows)]
        entry_ref.set_pathname_utf8(key_str.as_zstr());
        #[cfg(not(windows))]
        entry_ref.set_pathname(key_str.as_zstr());
        entry_ref.set_size(i64::try_from(data.len()).expect("int cast"));
        entry_ref.set_filetype(FILETYPE_REGULAR);
        entry_ref.set_perm(0o644);
        entry_ref.set_mtime(now_secs, 0);

        // `Warn` means the header was still written (libarchive fell back to a
        // per-entry binary hdrcharset for a name its locale machinery could not
        // convert); only `Failed`/`Fatal` mean no header was produced.
        if !archive_ref.write_header(entry_ref).succeeded() {
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

fn get_entry_data<'a>(
    global: &JSGlobalObject,
    value: JSValue,
    array_buffer: &'a mut Option<bun_jsc::ArrayBuffer>,
) -> JsResult<Utf8Bytes<'a>> {
    // For Blob, use sharedView (no copy needed). The backing store outlives
    // the returned slice for the duration of the caller's tarball build.
    if let Some(blob) = blob_from_js(value) {
        return Ok(Utf8Bytes::Borrowed(blob.shared_view()));
    }

    // For ArrayBuffer/TypedArray, use view (no copy needed)
    if let Some(buffer) = value.as_array_buffer(global) {
        return Ok(Utf8Bytes::Borrowed(array_buffer.insert(buffer).slice()));
    }

    // For strings, convert (allocates)
    value.to_utf8(global)
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

    let path_slice = path_arg.to_utf8(global)?;

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
    pub(crate) fn extract(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [path_arg, options_arg] = callframe.arguments_as_array::<2>();
        if path_arg.is_empty() || !path_arg.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Archive.extract requires a path argument"
            )));
        }

        let path_slice = path_arg.to_utf8(global)?;

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
        let str_slice = arg.to_utf8(global)?;
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
            let str_slice = item.to_utf8(global)?;
            // Skip empty strings in array
            if str_slice.slice().is_empty() {
                i += 1;
                continue;
            }
            let pattern: Box<[u8]> = Box::from(str_slice.slice());
            patterns.push(pattern);
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
    pub(crate) fn blob(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        start_blob_task(global, &self.store, self.compress, BlobOutputType::Blob)
    }

    /// Instance method: archive.bytes()
    /// Returns Promise<Uint8Array> with the archive data (compressed if gzip was set in options)
    #[bun_jsc::host_fn(method)]
    pub(crate) fn bytes(&self, global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        start_blob_task(global, &self.store, self.compress, BlobOutputType::Bytes)
    }

    /// Instance method: archive.files(glob?)
    /// Returns Promise<Map<string, File>> with archive file contents
    #[bun_jsc::host_fn(method)]
    pub(crate) fn files(
        &self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
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
    fn fulfill(self, global: &JSGlobalObject, promise: &mut JSPromise) -> JsResult<()> {
        match self {
            PromiseResult::Resolve(v) => promise.resolve(global, v),
            PromiseResult::Reject(v) => promise.reject_with_async_stack(global, Ok(v)),
        }
    }
}

/// One `Bun.Archive` operation's pool-side work: `run` on the thread pool
/// stores its result on `self`; `run_from_js` turns it into the promise's
/// value. It is the off-thread part of an `AsyncTask<C>` job.
pub trait TaskContext: Send + 'static {
    /// Runs on thread pool. Stores its result on `self`.
    fn run(&mut self);
    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult>;
}

/// The job for a `TaskContext`: the context off-thread, its promise on the JS side.
pub struct AsyncTask<C: TaskContext>(core::marker::PhantomData<C>);

impl<C: TaskContext> bun_jsc::JobContext for AsyncTask<C> {
    type OffThread = C;
    type Js = JSPromiseStrong;
    fn run(ctx: &mut C, done: bun_jsc::Completion<Self>) -> Option<bun_jsc::Completion<Self>> {
        ctx.run();
        Some(done)
    }
    fn then(mut ctx: C, mut promise: JSPromiseStrong, cx: &bun_jsc::JsThread<'_>) -> JsResult<()> {
        let global = cx.global();
        let promise = promise.swap();
        let result = match ctx.run_from_js(global) {
            Ok(r) => r,
            Err(e) => {
                // JSError means exception is already pending
                return promise.reject(global, Err(e));
            }
        };
        result.fulfill(global, promise)
    }
}

impl<C: TaskContext> AsyncTask<C> {
    /// Schedule `ctx` on the work pool; returns the promise it settles.
    fn start(global: &JSGlobalObject, ctx: C) -> JSValue {
        let promise = JSPromiseStrong::init(global);
        let value = promise.value();
        bun_jsc::Job::<Self>::schedule(&global.js_thread(), ctx, promise);
        value
    }
}

// ============================================================================
// Task Contexts
// ============================================================================

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub enum ExtractError {
    #[error("ReadError")]
    ReadError,
}

pub enum ExtractResult {
    Success(u32),
    Err(ExtractError),
}

pub struct ExtractContext {
    store: RefPtr<Store>,
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

pub(crate) type ExtractTask = AsyncTask<ExtractContext>;

fn start_extract_task(
    global: &JSGlobalObject,
    store: &RefPtr<Store>,
    path: &[u8],
    glob_patterns: Option<Vec<Box<[u8]>>>,
) -> JsResult<JSValue> {
    let path_copy: Box<[u8]> = Box::from(path);
    // errdefer free(path_copy) — Drop handles it

    let store = store.clone();
    // errdefer store.deref() — Drop handles it

    Ok(ExtractTask::start(
        global,
        ExtractContext {
            store,
            path: path_copy,
            glob_patterns,
            result: ExtractResult::Err(ExtractError::ReadError),
        },
    ))
}

#[derive(Clone, Copy)]
enum BlobOutputType {
    Blob,
    Bytes,
}

enum BlobResult {
    Compressed(Vec<u8>),
    Uncompressed,
    Err(CompressError),
}

pub struct BlobContext {
    store: RefPtr<Store>,
    compress: Compression,
    output_type: BlobOutputType,
    result: BlobResult,
}

impl TaskContext for BlobContext {
    fn run(&mut self) {
        self.result = match &self.compress {
            Compression::Gzip(opts) => match compress_gzip(self.store.shared_view(), opts.level) {
                Ok(data) => BlobResult::Compressed(data),
                Err(e) => BlobResult::Err(e),
            },
            Compression::None => BlobResult::Uncompressed,
        };
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        match core::mem::replace(&mut self.result, BlobResult::Uncompressed) {
            BlobResult::Err(e) => Ok(PromiseResult::Reject(e.to_js(global))),
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
                        JSValue::create_buffer_from_box(global, data.into_boxed_slice())?
                    }
                }))
            }
            BlobResult::Uncompressed => Ok(match self.output_type {
                BlobOutputType::Blob => {
                    // The clone bumps the refcount; ownership of
                    // the new ref transfers into the Blob via init_with_store.
                    let store = self.store.clone();
                    let blob_ptr = Blob::new(Blob::init_with_store(store, global));
                    // SAFETY: blob_ptr is the heap allocation just produced by Blob::new.
                    PromiseResult::Resolve(unsafe { (*blob_ptr).to_js(global) })
                }
                BlobOutputType::Bytes => {
                    // On allocation failure, reject the promise instead of aborting.
                    let view = self.store.shared_view();
                    let mut dup: Vec<u8> = Vec::new();
                    if dup.try_reserve_exact(view.len()).is_err() {
                        return Ok(PromiseResult::Reject(global.create_out_of_memory_error()));
                    }
                    dup.extend_from_slice(view);
                    PromiseResult::Resolve(JSValue::create_buffer_from_box(
                        global,
                        dup.into_boxed_slice(),
                    )?)
                }
            }),
        }
    }
}

pub(crate) type BlobTask = AsyncTask<BlobContext>;

fn start_blob_task(
    global: &JSGlobalObject,
    store: &RefPtr<Store>,
    compress: Compression,
    output_type: BlobOutputType,
) -> JsResult<JSValue> {
    let store = store.clone();
    // errdefer store.deref() — Drop handles it

    Ok(BlobTask::start(
        global,
        BlobContext {
            store,
            compress,
            output_type,
            result: BlobResult::Uncompressed,
        },
    ))
}

enum WriteResult {
    Success,
    Err(CompressError),
    SysErr(bun_sys::Error),
}

enum WriteData {
    Owned(Vec<u8>),
    Store(RefPtr<Store>),
}

pub struct WriteContext {
    data: WriteData,
    path: ZBox,
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
            WriteResult::Err(e) => PromiseResult::Reject(e.to_js(global)),
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
                    Err(e) => return WriteResult::Err(e),
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

        match file.write_all(data_to_write) {
            Err(err) => WriteResult::SysErr(err),
            Ok(_) => WriteResult::Success,
        }
    }
}

pub(crate) type WriteTask = AsyncTask<WriteContext>;

fn start_write_task(
    global: &JSGlobalObject,
    data: WriteData,
    path: &[u8],
    compress: Compression,
) -> JsResult<JSValue> {
    let path_z = ZBox::from_vec_with_nul(path.to_vec());

    // Ref store if using store reference — already done by caller via Arc::clone into WriteData::Store.
    // errdefer store.deref / free(data.owned) — handled by WriteData Drop on early return.

    Ok(WriteTask::start(
        global,
        WriteContext {
            data,
            path: path_z,
            compress,
            result: WriteResult::Success,
        },
    ))
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
    store: RefPtr<Store>,
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
        let archive = lib::ReadArchive::new();
        configure_archive_reader(&archive);

        if archive.read_open_memory(self.store.shared_view()) != lib::Result::Ok {
            // SAFETY: `archive` is the live `read_new()` handle opened above.
            return Ok(if let Some(err) = Self::clone_error_string(&archive) {
                FilesResult::LibarchiveErr(err)
            } else {
                FilesResult::Err(FilesError::ReadError)
            });
        }

        let mut entries: FileEntryList = Vec::new();
        // errdefer freeEntries(&entries) — handled by Drop on `entries`

        let mut entry: *mut lib::Entry = core::ptr::null_mut();
        while archive.read_next_header(&mut entry).succeeded() {
            let entry_ref = lib::Entry::opaque_ref(entry);
            if entry_ref.filetype() != FILETYPE_REGULAR {
                continue;
            }

            // POSIX: the raw header/pax bytes; the locale-converting
            // `archive_entry_pathname_utf8` returns NULL for every non-ASCII
            // name in the "C" locale, which would key the Map by "".
            #[cfg(not(windows))]
            let pathname = entry_ref.pathname().as_bytes();
            #[cfg(windows)]
            let pathname_owned = entry_pathname_utf8(entry_ref)?;
            #[cfg(windows)]
            let pathname: &[u8] = &pathname_owned;
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
            while data.len() < size {
                let to_read = (size - data.len()).min(64 * 1024);
                data.try_reserve(to_read)
                    .map_err(|_| bun_alloc::AllocError)?;
                // SAFETY: `archive_read_data` only stores into the slice; the written prefix is committed below.
                let dest = unsafe { &mut bun_core::vec::spare_bytes_mut(&mut data)[..to_read] };
                let read = archive.read_data(dest);
                if read < 0 {
                    // Read error.
                    // NOTE: both `data` and `entries` drop automatically here.
                    // SAFETY: `archive` is the live `read_new()` handle opened above.
                    return Ok(if let Some(err) = Self::clone_error_string(&archive) {
                        FilesResult::LibarchiveErr(err)
                    } else {
                        FilesResult::Err(FilesError::ReadError)
                    });
                }
                if read == 0 {
                    break;
                }
                let bytes_read = usize::try_from(read).expect("int cast");
                // SAFETY: `archive_read_data` returns exactly the byte count it wrote (`<= to_read`).
                unsafe { bun_core::vec::commit_spare(&mut data, bytes_read) };
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
                EncodedSlice::utf8(err_msg.to_bytes()).to_error_instance(global),
            )),
            FilesResult::Err(e) => Ok(PromiseResult::Reject(
                global.create_error_instance(format_args!("{}", <&'static str>::from(&*e))),
            )),
        }
    }
}

pub(crate) type FilesTask = AsyncTask<FilesContext>;

fn start_files_task(
    global: &JSGlobalObject,
    store: &RefPtr<Store>,
    glob_patterns: Option<Vec<Box<[u8]>>>,
) -> JsResult<JSValue> {
    let store = store.clone();
    // errdefer store.deref() — Drop handles it
    // Ownership: On error, caller's errdefer frees glob_patterns.
    // On success, ownership transfers to FilesContext, which frees them in deinit().

    Ok(FilesTask::start(
        global,
        FilesContext {
            store,
            glob_patterns,
            result: FilesResult::Err(FilesError::ReadError),
        },
    ))
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
    /// The output buffer (sized by the data being compressed) could not be allocated.
    #[error("OutOfMemory")]
    OutOfMemory,
}

impl CompressError {
    fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        match self {
            CompressError::OutOfMemory => global.create_out_of_memory_error(),
            other => global.create_error_instance(format_args!("{}", <&'static str>::from(other))),
        }
    }
}

fn compress_gzip(data: &[u8], level: u8) -> Result<Vec<u8>, CompressError> {
    use bun_libdeflate_sys::libdeflate;
    libdeflate::load();

    let mut compressor =
        libdeflate::OwnedCompressor::new(i32::from(level)).ok_or(CompressError::GzipInitFailed)?;

    let mut output = Vec::new();
    let result = compressor
        .compress_to_vec(data, &mut output, libdeflate::Encoding::Gzip)
        .map_err(|_| CompressError::OutOfMemory)?;
    if result.status != libdeflate::Status::Success {
        return Err(CompressError::GzipCompressFailed);
    }
    Ok(output)
}

/// Check if a path is safe (no absolute paths or path traversal)
pub(crate) fn is_safe_path(pathname: &[u8]) -> bool {
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
    for component in strings::split(pathname, b"/") {
        if component == b".." {
            return false;
        }
        // Also check Windows-style separators
        for win_component in strings::split(component, b"\\") {
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
pub(crate) fn match_glob_patterns(patterns: &[Box<[u8]>], pathname: &[u8]) -> bool {
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
) -> crate::Result<u32> {
    use libarchive::lib;
    let archive = lib::ReadArchive::new();
    configure_archive_reader(&archive);

    if archive.read_open_memory(file_buffer) != lib::Result::Ok {
        return Err(crate::Error::ReadError);
    }

    // Open/create target directory using bun.sys
    let cwd = Fd::cwd();
    let _ = cwd.make_path(root);
    let dir_fd: Fd = 'brk: {
        if bun_paths::is_absolute(root) {
            break 'brk match bun_sys::open_a(root, bun_sys::O::RDONLY | bun_sys::O::DIRECTORY, 0) {
                Ok(fd) => fd,
                Err(_) => return Err(crate::Error::OpenError),
            };
        } else {
            break 'brk match bun_sys::openat_a(
                cwd,
                root,
                bun_sys::O::RDONLY | bun_sys::O::DIRECTORY,
                0,
            ) {
                Ok(fd) => fd,
                Err(_) => return Err(crate::Error::OpenError),
            };
        }
    };
    let _dir_close = bun_sys::CloseOnDrop::new(dir_fd);

    let mut count: u32 = 0;
    let mut entry: *mut lib::Entry = core::ptr::null_mut();
    let mut stack_buf = bun_core::vec::UninitBuf::<{ 64 * 1024 }>::uninit();
    // SAFETY: `archive_read_data` is the only writer of `buf`; each chunk reads back only `buf[..bytes_read]`.
    let buf = unsafe { stack_buf.as_bytes_mut() };

    while archive.read_next_header(&mut entry).succeeded() {
        let entry_ref = lib::Entry::opaque_ref(entry);
        // Same platform split as `FilesContext::do_run`; see `entry_pathname_utf8`.
        #[cfg(not(windows))]
        let raw_pathname_z = entry_ref.pathname();
        #[cfg(windows)]
        let raw_pathname_zbox = ZBox::from_vec_with_nul(
            entry_pathname_utf8(entry_ref)
                .map_err(|_| crate::Error::Alloc(bun_alloc::AllocError))?,
        );
        #[cfg(windows)]
        let raw_pathname_z = raw_pathname_zbox.as_zstr();
        let raw_pathname = raw_pathname_z.as_bytes();

        let mut normalized_buf = bun_paths::path_buffer_pool::get();
        if raw_pathname.len() >= normalized_buf.len() {
            continue;
        }
        let pathname_z: &bun_core::ZStr = bun_paths::resolve_path::normalize_buf_z::<
            bun_paths::platform::Posix,
        >(raw_pathname, &mut normalized_buf[..]);
        let pathname = pathname_z.as_bytes();

        // Validate path safety (reject absolute paths, path traversal)
        if pathname == b"." || !is_safe_path(pathname) {
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
                    Err(e) if e.get_errno() == bun_sys::E::EEXIST => continue,
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
                        Err(e) if e.get_errno() == bun_sys::E::EEXIST => {}
                        // Permission errors: skip this file, will fail at openat
                        Err(e) if e.get_errno() == bun_sys::E::EACCES => {}
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
