//! `Bun.Archive` — tar/tgz pack + extract.

use crate::webcore::Blob;
use crate::webcore::BlobExt as _;
use crate::webcore::blob::Store;
use bun_archive::tar;
use bun_core::{self, Output, Utf8Bytes, ZBox, strings};
use bun_glob as glob;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{self as jsc, JSGlobalObject, JSMap, JSPromise, JSPromiseStrong, JSValue, JsResult};
use bun_jsc::{StringJsc as _, SysErrorJsc};
use bun_ptr::RefPtr;
#[cfg(unix)]
use bun_sys::beneath::{self, Symlinks};
use bun_sys::{self, Fd, FdDirExt as _, FdExt as _, Mode};

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

pub(crate) struct Archive {
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

impl Archive {
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
                    JSValue::js_number(f64::from(bun_removable_features::call_removable!(
                        Archive,
                        Abort,
                        count_files_in_archive,
                        data
                    ))),
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

/// Count the number of files in an archive
#[inline(never)]
fn count_files_in_archive(data: &[u8]) -> u32 {
    let Ok(mut reader) = bun_archive::open_memory(data, tar::Dialect::General) else {
        return 0;
    };
    let mut count: u32 = 0;
    while let Ok(Some(entry)) = reader.next_entry() {
        if entry.kind() == bun_sys::FileKind::File {
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
    pub(crate) fn constructor(
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<Self> {
        let global = cx.global();
        let data = data.to_js();

        // Parse compression options
        let compress = parse_compression_options(global, options.to_js())?;

        // For Blob/Archive, ref the existing store (zero-copy)
        if let Some(blob) = blob_from_js(data) {
            if let Some(store) = blob.store.get().as_ref() {
                return Ok(Self {
                    store: store.clone(),
                    compress,
                });
            }
        }

        // For ArrayBuffer/TypedArray, copy the data
        if let Some(array_buffer) = data.as_array_buffer(global) {
            let data: Vec<u8> = array_buffer.slice().to_vec();
            return Ok(create_archive(data, compress));
        }

        // For plain objects, build a tarball
        if data.is_object() {
            let data = build_tarball_from_object(global, data)?;
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

fn create_archive(data: Vec<u8>, compress: Compression) -> Archive {
    let store = Store::init(data);
    Archive { store, compress }
}

/// The caller's `value` keeps the `Blob` alive.
#[inline]
fn blob_from_js(value: JSValue) -> Option<&'static Blob> {
    value.as_class_ref::<Blob>()
}

/// Shared helper that builds tarball bytes from a JS object
fn build_tarball_from_object(global: &JSGlobalObject, obj: JSValue) -> JsResult<Vec<u8>> {
    let Some(js_obj) = obj.get_object() else {
        return Err(global.throw_invalid_arguments(format_args!("Expected an object")));
    };

    let mut writer = tar::writer::Writer::new(Vec::<u8>::new(), tar::writer::Names::for_host());
    // Writing to a `Vec` fails for want of memory only.
    let fail = |_: tar::Error| {
        global.throw_invalid_arguments(format_args!("Failed to create tarball: OutOfMemory"))
    };

    let now_secs: i64 = bun_core::time::milli_timestamp() / 1000;

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

        let key_slice = key.to_utf8();

        // Get data - use view for Blob/ArrayBuffer, convert for strings
        let mut array_buffer = None;
        let data_slice = get_entry_data(global, value, &mut array_buffer)?;
        let data = data_slice.slice();

        writer
            .header(&tar::writer::File {
                path: key_slice.slice(),
                size: data.len() as u64,
                perm: 0o644,
                mtime: now_secs,
            })
            .map_err(fail)?;
        writer.data(data).map_err(fail)?;
    }

    writer.finish(true).map_err(fail)
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

impl Archive {
    /// `Archive.write(path, data, options?)`. `options.gzip` overrides the compression of an `Archive` given as `data`.
    pub(crate) fn write(
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        data: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let (path_arg, data_arg) = (path.to_js(), data.to_js());

        // Get the path
        if !path_arg.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Archive.write: first argument must be a string path"
            )));
        }

        let path_slice = path_arg.to_utf8(global)?;

        // Parse options for compression override
        let options_compress = parse_compression_options(global, options.to_js())?;

        // For Archive instances, use options override or archive's compression settings
        if let Some(archive) = data_arg.as_class_ref::<Archive>() {
            let compress = if !matches!(options_compress, Compression::None) {
                options_compress
            } else {
                archive.compress
            };
            return start_write_task(
                &cx,
                WriteData::Store(archive.store.clone()),
                path_slice.slice(),
                compress,
            );
        }

        // For Blobs, use store reference with options compression
        if let Some(blob) = blob_from_js(data_arg) {
            if let Some(store) = blob.store.get().as_ref() {
                return start_write_task(
                    &cx,
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
                &cx,
                WriteData::Owned(data),
                path_slice.slice(),
                options_compress,
            );
        }

        // For plain objects, build a tarball with options compression
        if data_arg.is_object() {
            let data = build_tarball_from_object(global, data_arg)?;
            return start_write_task(
                &cx,
                WriteData::Owned(data),
                path_slice.slice(),
                options_compress,
            );
        }

        Err(global.throw_invalid_arguments(format_args!(
            "Expected an object, Blob, TypedArray, ArrayBuffer, or Archive"
        )))
    }

    /// Instance method: archive.extract(path, options?)
    /// Extracts the archive to the given path
    /// Options:
    ///   - glob: string | string[] - Only extract files matching the glob pattern(s). Supports negative patterns with "!".
    /// Returns Promise<number> with count of extracted files
    pub(crate) fn extract(
        &self,
        cx: &mut JsScope<'_>,
        path: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let (path_arg, options_arg) = (path.to_js(), options.to_js());
        if !path_arg.is_string() {
            return Err(global.throw_invalid_arguments(format_args!(
                "Archive.extract requires a path argument"
            )));
        }

        let path_slice = path_arg.to_utf8(global)?;

        // Parse options
        let mut glob_patterns: Option<Vec<GlobPattern>> = None;

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

        start_extract_task(&cx, &self.store, path_slice.slice(), glob_patterns)
    }
}

/// Parse a string or array of strings into a pattern list.
/// Returns null for empty strings or empty arrays (treated as "no filter").
fn parse_pattern_arg(
    global: &JSGlobalObject,
    arg: JSValue,
    api_name: &[u8],
    name: &[u8],
) -> JsResult<Option<Vec<GlobPattern>>> {
    // Single string
    if arg.is_string() {
        let str_slice = arg.to_utf8(global)?;
        // Empty string = no filter
        if str_slice.slice().is_empty() {
            return Ok(None);
        }
        let patterns = vec![GlobPattern::new(str_slice.slice())];
        return Ok(Some(patterns));
    }

    // Array of strings
    if arg.js_type() == jsc::JSType::Array {
        let len = arg.get_length(global)?;
        // Empty array = no filter
        if len == 0 {
            return Ok(None);
        }

        let mut patterns: Vec<GlobPattern> =
            Vec::with_capacity(usize::try_from(len).expect("int cast"));

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
            patterns.push(GlobPattern::new(str_slice.slice()));
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

impl Archive {
    /// Instance method: archive.blob()
    /// Returns Promise<Blob> with the archive data (compressed if gzip was set in options)
    pub(crate) fn blob(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        start_blob_task(&cx, &self.store, self.compress, BlobOutputType::Blob)
    }

    /// Instance method: archive.bytes()
    /// Returns Promise<Uint8Array> with the archive data (compressed if gzip was set in options)
    pub(crate) fn bytes(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        start_blob_task(&cx, &self.store, self.compress, BlobOutputType::Bytes)
    }

    /// Instance method: archive.files(glob?)
    /// Returns Promise<Map<string, File>> with archive file contents
    pub(crate) fn files(&self, cx: &mut JsScope<'_>, glob: JsLocal<'_>) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        let global = cx.global();
        let glob = glob.to_js();

        let mut glob_patterns: Option<Vec<GlobPattern>> = None;
        // errdefer freePatterns — handled by Drop

        if !glob.is_undefined_or_null() {
            glob_patterns = parse_pattern_arg(global, glob, b"Archive.files", b"glob")?;
        }

        start_files_task(&cx, &self.store, glob_patterns)
    }
}

// ============================================================================
// Generic Async Task Infrastructure
// ============================================================================

pub(crate) enum PromiseResult {
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
pub(crate) trait TaskContext: Send + 'static {
    /// Runs on thread pool. Stores its result on `self`.
    fn run(&mut self);
    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult>;
}

/// The job for a `TaskContext`: the context off-thread, its promise on the JS side.
pub(crate) struct AsyncTask<C: TaskContext>(core::marker::PhantomData<C>);

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
    fn start(cx: &bun_jsc::JsThread<'_>, ctx: C) -> JSValue {
        let promise = JSPromiseStrong::init(cx.global());
        let value = promise.value();
        bun_jsc::Job::<Self>::schedule(cx, ctx, promise);
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

pub(crate) enum ExtractResult {
    Success(u32),
    Err(ExtractError),
    LeavesDestination(bun_sys::Error),
}

pub(crate) struct ExtractContext {
    store: RefPtr<Store>,
    path: Box<[u8]>,
    glob_patterns: Option<Vec<GlobPattern>>,
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
            ExtractResult::LeavesDestination(e) => {
                let mut e = SysErrorJsc::to_system_error(e);
                // Not formatted, so that it has no bytes of the archive in it.
                e.message = bun_core::String::static_(
                    "A symlink in the destination is absolute or leads outside of it",
                );
                PromiseResult::Reject(e.to_error_instance(global))
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
        let count = match bun_archive::Archiver::extract_to_disk(
            self.store.shared_view(),
            &self.path,
            None,
            &mut (),
            bun_archive::ExtractOptions {
                depth_to_skip: 0,
                close_handles: true,
                log: false,
                npm: false,
                skip_symlinks: false,
                new_destination: false,
            },
        ) {
            Ok(c) => c,
            Err(bun_archive::Error::LeavesDestination(e)) => {
                return ExtractResult::LeavesDestination(e);
            }
            Err(_) => return ExtractResult::Err(ExtractError::ReadError),
        };
        ExtractResult::Success(count)
    }
}

pub(crate) type ExtractTask = AsyncTask<ExtractContext>;

fn start_extract_task(
    cx: &bun_jsc::JsThread<'_>,
    store: &RefPtr<Store>,
    path: &[u8],
    glob_patterns: Option<Vec<GlobPattern>>,
) -> JsResult<JSValue> {
    let path_copy: Box<[u8]> = Box::from(path);
    // errdefer free(path_copy) — Drop handles it

    let store = store.clone();
    // errdefer store.deref() — Drop handles it

    Ok(ExtractTask::start(
        cx,
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

pub(crate) struct BlobContext {
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
    cx: &bun_jsc::JsThread<'_>,
    store: &RefPtr<Store>,
    compress: Compression,
    output_type: BlobOutputType,
) -> JsResult<JSValue> {
    let store = store.clone();
    // errdefer store.deref() — Drop handles it

    Ok(BlobTask::start(
        cx,
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

pub(crate) struct WriteContext {
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
    cx: &bun_jsc::JsThread<'_>,
    data: WriteData,
    path: &[u8],
    compress: Compression,
) -> JsResult<JSValue> {
    let path_z = ZBox::from_vec_with_nul(path.to_vec());

    // Ref store if using store reference — already done by caller via Arc::clone into WriteData::Store.
    // errdefer store.deref / free(data.owned) — handled by WriteData Drop on early return.

    Ok(WriteTask::start(
        cx,
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
    ArchiveErr(tar::Error),
    Err(FilesError),
}

// freeEntries deleted — Vec<FileEntry> drops each entry; FileEntry fields drop their boxes.

pub(crate) struct FilesContext {
    store: RefPtr<Store>,
    glob_patterns: Option<Vec<GlobPattern>>,
    result: FilesResult,
}

impl FilesContext {
    fn do_run(&mut self) -> Result<FilesResult, bun_alloc::AllocError> {
        let read_error = |err: tar::Error| match err {
            tar::Error::Alloc(err) => Err(err),
            err => Ok(FilesResult::ArchiveErr(err)),
        };
        let mut reader =
            match bun_archive::open_memory(self.store.shared_view(), tar::Dialect::General) {
                Ok(reader) => reader,
                Err(err) => return read_error(err),
            };

        let mut entries: FileEntryList = Vec::new();

        loop {
            let entry_ref = match reader.next_entry() {
                Ok(None) => break,
                Ok(Some(entry)) => entry,
                Err(err) => return read_error(err),
            };
            if entry_ref.kind() != bun_sys::FileKind::File {
                continue;
            }

            let pathname = bun_archive::display_path(entry_ref)?;
            let pathname: &[u8] = &pathname;
            // Apply glob pattern filtering (supports both positive and negative patterns)
            if let Some(patterns) = &self.glob_patterns {
                if !match_glob_patterns(patterns, pathname) {
                    continue;
                }
            }

            let size: usize = usize::try_from(entry_ref.size().max(0)).expect("int cast");
            let mtime: i64 = entry_ref.mtime();

            let path_copy: Box<[u8]> = Box::from(pathname);

            let mut data: Vec<u8> = Vec::new();
            if let Err(err) = reader.read_data(size, &mut data) {
                return read_error(err);
            }

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
                    blob.last_modified.set(entry.mtime as f64 * 1000.0);

                    let name_js = blob.name.get().to_js(global)?;
                    let blob_js = blob.to_js(global);
                    // SAFETY: map_ptr came from JSMap::from_js on a live value.
                    unsafe { map_ptr.as_mut() }.set(global, name_js, blob_js)?;
                }

                Ok(PromiseResult::Resolve(map))
            }
            FilesResult::ArchiveErr(err) => Ok(PromiseResult::Reject(
                global.create_error_instance(format_args!("{err}")),
            )),
            FilesResult::Err(e) => Ok(PromiseResult::Reject(
                global.create_error_instance(format_args!("{}", <&'static str>::from(&*e))),
            )),
        }
    }
}

pub(crate) type FilesTask = AsyncTask<FilesContext>;

fn start_files_task(
    cx: &bun_jsc::JsThread<'_>,
    store: &RefPtr<Store>,
    glob_patterns: Option<Vec<GlobPattern>>,
) -> JsResult<JSValue> {
    let store = store.clone();
    // errdefer store.deref() — Drop handles it
    // Ownership: On error, caller's errdefer frees glob_patterns.
    // On success, ownership transfers to FilesContext, which frees them in deinit().

    Ok(FilesTask::start(
        cx,
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

/// One pattern of the `glob` option.
pub(crate) struct GlobPattern {
    /// It started with `!`, which isn't part of `glob`.
    is_negative: bool,
    glob: glob::Prepared<Box<[u8]>>,
}

impl GlobPattern {
    fn new(pattern: &[u8]) -> GlobPattern {
        let positive = pattern.strip_prefix(b"!");
        GlobPattern {
            is_negative: positive.is_some(),
            glob: glob::Prepared::new(positive.unwrap_or(pattern).into()),
        }
    }
}

/// Match a path against multiple glob patterns with support for negative patterns.
/// Positive patterns: at least one must match for the path to be included.
/// Negative patterns (starting with "!"): if any matches, the path is excluded.
/// Returns true if the path should be included, false if excluded.
pub(crate) fn match_glob_patterns(patterns: &[GlobPattern], pathname: &[u8]) -> bool {
    let mut has_positive_patterns = false;
    let mut matches_positive = false;

    for pattern in patterns {
        if pattern.is_negative {
            // Negative pattern - if it matches, exclude the file
            if !pattern.glob.pattern().is_empty() && pattern.glob.r#match(pathname).matches() {
                return false;
            }
        } else {
            // Positive pattern - at least one must match
            has_positive_patterns = true;
            if pattern.glob.r#match(pathname).matches() {
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
    glob_patterns: Option<&[GlobPattern]>,
) -> crate::Result<u32> {
    let mut reader =
        bun_archive::open_memory(file_buffer, tar::Dialect::General).map_err(|err| match err {
            tar::Error::Alloc(err) => crate::Error::Alloc(err),
            _ => crate::Error::ReadError,
        })?;

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

    #[cfg(unix)]
    let make_path = |path: &[u8]| beneath::make_path(dir_fd, path, Symlinks::FollowInside);
    #[cfg(windows)]
    let make_path = |path: &[u8]| dir_fd.make_path(path);

    let mut count: u32 = 0;
    let mut write_strategy = bun_archive::WriteStrategy::default();
    #[cfg(unix)]
    let mut symlink_join_buf = None;

    loop {
        let entry_ref = match reader.next_entry() {
            Ok(None) => break,
            Ok(Some(entry)) => entry,
            Err(_) => return Err(crate::Error::ReadError),
        };
        let raw_pathname = bun_archive::display_path(entry_ref)?;
        let raw_pathname: &[u8] = &raw_pathname;

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

        match entry_ref.kind() {
            bun_sys::FileKind::Directory => {
                match make_path(pathname) {
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

                let flags = bun_sys::O::WRONLY | bun_sys::O::CREAT | bun_sys::O::TRUNC;
                #[cfg(unix)]
                let open =
                    || beneath::openat(dir_fd, pathname_z, flags, mode, Symlinks::FollowInside);
                #[cfg(windows)]
                let open = || bun_sys::openat(dir_fd, pathname_z, flags, mode);
                let opened = open().or_else(|err| {
                    make_path(bun_core::dirname(pathname).ok_or(err)?)?;
                    open()
                });
                let Ok(file_fd) = opened else { continue };

                let write_success = size == 0
                    || bun_archive::read_data_into_fd(&mut reader, file_fd, &mut write_strategy)
                        .is_ok();
                let _ = file_fd.close();

                if !write_success {
                    // Remove partial file on failure
                    #[cfg(unix)]
                    let _ = beneath::unlinkat(dir_fd, pathname, Symlinks::FollowInside);
                    #[cfg(windows)]
                    let _ = bun_sys::unlinkat(dir_fd, pathname_z);
                    return Err(crate::Error::ReadError);
                }
                count += 1;
            }
            bun_sys::FileKind::SymLink => {
                let link_target = ZBox::from_bytes(entry_ref.symlink().unwrap_or_default());
                let link_target_z = link_target.as_zstr();
                // Validate symlink target is also safe
                if !is_safe_path(link_target_z.as_bytes()) {
                    continue;
                }
                // Symlinks are only extracted on POSIX systems (Linux/macOS).
                // On Windows, symlinks are skipped since they require elevated privileges.
                #[cfg(unix)]
                {
                    let mut symlinkat = || {
                        beneath::symlinkat_where_safe(link_target_z, dir_fd, pathname, |path| {
                            let target = link_target_z.as_bytes();
                            bun_archive::is_symlink_target_safe(path, target, &mut symlink_join_buf)
                        })
                    };
                    match symlinkat() {
                        Err(err) => {
                            if matches!(err.get_errno(), bun_sys::E::EPERM | bun_sys::E::ENOENT) {
                                if let Some(parent) = bun_core::dirname(pathname) {
                                    let _ = make_path(parent);
                                }
                                if symlinkat().is_err() {
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

/// `bun:internal-for-testing`
pub(crate) mod testing {
    use crate::generated_bindgen::archive_internals::{
        ReadTarOptions, ReadTarSkip as Skip, WriteTarFile, WriteTarOptions,
    };
    use bun_archive::tar::output::Output;
    use bun_archive::tar::writer::{File, Names, Writer};
    use bun_archive::tar::{self, Event};
    use bun_core::{S, strings};
    use bun_jsc::bindgen::{self, BufferSource, JsHeap, JsLocal};
    use core::fmt::Write as _;

    enum Source<'a> {
        Whole(tar::MemoryDecoder<'a>),
        Pieces(tar::Decoder),
    }

    fn type_name(filetype: u32) -> Option<&'static str> {
        Some(match filetype {
            S::IFREG => "file",
            S::IFDIR => "directory",
            S::IFLNK => "symlink",
            S::IFCHR => "character-device",
            S::IFBLK => "block-device",
            S::IFIFO => "fifo",
            _ => return None,
        })
    }

    /// A long name is cut short, with what tells it from another.
    fn write_name(log: &mut String, name: &[u8]) {
        const LONGEST: usize = 300;
        const SHOWN: usize = 32;
        if name.len() <= LONGEST {
            _ = write!(log, "\"{}\"", name.escape_ascii());
        } else {
            _ = write!(
                log,
                "\"{}\"... {} bytes crc32={:08x}",
                name[..SHOWN].escape_ascii(),
                name.len(),
                bun_zlib::crc32_bytes(0, name),
            );
        }
    }

    /// Contents that follow each other, however many pieces they came in.
    #[derive(Default)]
    struct Run {
        offset: i64,
        len: i64,
    }

    impl Run {
        fn flush(&mut self, log: &mut String) {
            if self.len != 0 {
                _ = writeln!(log, "  data {}+{}", self.offset, self.len);
            }
            *self = Self::default();
        }
    }

    pub(crate) fn read_tar(data: &[u8], options: &ReadTarOptions) -> String {
        let reader_options = tar::Options {
            dialect: if options.npm {
                tar::Dialect::Npm
            } else {
                tar::Dialect::General
            },
            charset: if options.windows {
                tar::Charset::Utf8
            } else {
                tar::Charset::Ascii
            },
            mac_metadata: options.macos,
        };
        let opened = if options.stream {
            tar::Decoder::new(reader_options, data.starts_with(&[0x1f, 0x8b])).map(Source::Pieces)
        } else {
            tar::MemoryDecoder::new(data, reader_options).map(Source::Whole)
        };
        let mut source = match opened {
            Ok(source) => source,
            Err(err) => return format!("refused: {err}\n"),
        };

        let mut log = String::new();
        // `data[pos..end]` has arrived and was not taken yet.
        let (mut pos, mut end) = (0usize, 0usize);
        let mut index = 0usize;
        let mut crc = 0u32;
        let mut run = Run::default();
        loop {
            let mut skip = false;
            let ended = end == data.len() && (!options.late_end || pos == end);
            let next = match &mut source {
                Source::Whole(reader) => reader.next().map(|event| (0, event)),
                Source::Pieces(decoder) => decoder.next(&data[pos..end], ended),
            };
            let (used, event) = match next {
                Ok(next) => next,
                Err(err) => {
                    run.flush(&mut log);
                    _ = writeln!(log, "error: {err}");
                    return log;
                }
            };
            match event {
                Event::NeedInput if ended => {
                    log.push_str("error: the reader wants more input than there is\n");
                    return log;
                }
                Event::NeedInput => {
                    end = match options.piece_size {
                        0 => data.len(),
                        size => end.saturating_add(size).min(data.len()),
                    };
                }
                Event::Entry(entry) => {
                    match type_name(entry.filetype()) {
                        Some(name) => log.push_str(name),
                        None => _ = write!(log, "type-{:o}", entry.filetype()),
                    }
                    _ = write!(
                        log,
                        " perm={:o} size={} mtime={} path=",
                        entry.perm(),
                        entry.size(),
                        entry.mtime(),
                    );
                    let mut wide = Vec::new();
                    if options.windows
                        && tar::compose::to_utf16(entry.path(), entry.path_is_utf8(), &mut wide)
                            .is_ok()
                    {
                        // A name that is not UTF-8 has one unit for each byte.
                        let name = if entry.path_is_utf8() {
                            String::from_utf16_lossy(&wide).into_bytes()
                        } else {
                            wide.into_iter().map(|unit| unit as u8).collect()
                        };
                        write_name(&mut log, &name);
                    } else {
                        write_name(&mut log, entry.path());
                    }
                    // Nothing reads a link's target on Windows.
                    if let Some(target) = entry.symlink().filter(|_| !options.windows) {
                        log.push_str(" -> ");
                        write_name(&mut log, target);
                    }
                    log.push('\n');
                    skip = match options.skip {
                        Skip::None => false,
                        Skip::All => true,
                        Skip::Odd => index % 2 == 1,
                        Skip::OtherThanFiles => entry.filetype() != S::IFREG,
                    };
                    index += 1;
                    crc = 0;
                    run = Run::default();
                }
                Event::Data { offset, bytes } => {
                    crc = bun_zlib::crc32_bytes(crc, bytes);
                    if offset != run.offset + run.len {
                        run.flush(&mut log);
                        run.offset = offset;
                    }
                    run.len += bytes.len() as i64;
                }
                Event::EndOfEntry { size } => {
                    run.flush(&mut log);
                    _ = writeln!(log, "  end {size} crc32={crc:08x}");
                }
                Event::EndOfArchive => {
                    log.push_str("end\n");
                    return log;
                }
            }
            pos += used;
            if skip {
                log.push_str("  skipped\n");
                match &mut source {
                    Source::Whole(reader) => reader.skip_entry(),
                    Source::Pieces(decoder) => decoder.skip_entry(),
                }
            }
        }
    }

    fn write_files<O: Output>(
        out: O,
        files: Vec<WriteTarFile>,
        names: &[u8],
        mut contents: &[u8],
        options: &WriteTarOptions,
    ) -> tar::Result<Writer<O>> {
        let mut writer = Writer::new(
            out,
            if options.windows {
                Names::Utf8
            } else {
                Names::Binary
            },
        );
        for (file, path) in files.into_iter().zip(strings::split(names, b"\0")) {
            writer.header(&File {
                path,
                size: file.size as u64,
                perm: file.perm,
                mtime: file.mtime as i64,
            })?;
            let (given, rest) = contents.split_at(file.given.min(contents.len()));
            contents = rest;
            for piece in given.chunks(options.write_size.max(1)) {
                writer.data(piece)?;
            }
        }
        Ok(writer)
    }

    pub(crate) fn write_tar<'a>(
        heap: &JsHeap<'a>,
        files: Vec<WriteTarFile>,
        names: &[u8],
        contents: &[u8],
        options: &WriteTarOptions,
    ) -> bindgen::Result<'a, JsLocal<'a, BufferSource>> {
        let written = match options.gzip_level {
            _ if !options.finish => {
                let mut written = Vec::new();
                let sink = |bytes: &[u8]| written.extend_from_slice(bytes);
                let result = write_files(sink, files, names, contents, options).map(drop);
                result.map(|()| written)
            }
            None => write_files(Vec::new(), files, names, contents, options)
                .and_then(|writer| writer.finish(true)),
            Some(level) => tar::gzip::Encoder::new(Vec::new(), level)
                .and_then(|encoder| write_files(encoder, files, names, contents, options))
                .and_then(|writer| writer.finish(false))
                .and_then(|encoder| encoder.finish()),
        };
        heap.create_buffer(&written.map_err(|err| heap.error(format_args!("{err}")))?)
    }
}
