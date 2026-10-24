//! `Bun.Archive` — tar/tgz pack + extract over libarchive.

use core::cell::{Cell, RefCell};
use std::borrow::Cow;
use std::ffi::CString;
use std::sync::Arc;

use crate::node::types::PathLikeExt as _;
use crate::webcore::Blob;
use crate::webcore::BlobExt as _;
use crate::webcore::blob::store::Data as StoreData;
use crate::webcore::blob::{SizeType, Store};
use crate::webcore::node_types::{PathLike, PathOrFileDescriptor};
use bun_core::{self, EncodedSlice, Output, Utf8Bytes, ZBox, ZStr, strings};
use bun_glob as glob;
use bun_jsc::bindgen::{JsLocal, JsScope};
use bun_jsc::{self as jsc, JSGlobalObject, JSMap, JSPromise, JSPromiseStrong, JSValue, JsResult};
use bun_jsc::{EncodedSliceJsc as _, StringJsc as _, SysErrorJsc as _};
use bun_libarchive as libarchive;
use bun_ptr::RefPtr;
use bun_sys::{self, Fd, FdDirExt as _, FdExt as _, Mode};
use bun_threading::Guarded;

/// libarchive `AE_IFREG` (== `S_IFREG`). The Rust `bun_libarchive::lib` port
/// does not yet expose `FileType`, so mirror the constant locally.
const FILETYPE_REGULAR: u32 = 0o100000;

/// A tar ends with two records of zeros.
const TAR_END_MARKER: usize = 2 * 512;
/// libarchive's default block. It pads the last one of an archive with zeros.
const TAR_BLOCK: usize = 10240;
/// The read size for a file entry. A file of at most this size is read before its header.
const FILE_CHUNK: usize = 256 * 1024;

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
    source: Source,
    /// Compression settings for this archive
    compress: Compression,
}

/// Where the bytes of an archive are.
#[derive(Clone)]
enum Source {
    /// A tar built from values in memory, or the store of a Blob given as the archive.
    Store(RefPtr<Store>),
    /// `Bun.file()` input. The work pool reads it for the first method that needs the bytes.
    Pending(Arc<Pending>),
}

impl Source {
    /// JS thread. `None` for a Blob with no store.
    fn of_blob(blob: &Blob) -> Option<Source> {
        let store = blob.store()?;
        Some(match FileWindow::of_blob(blob) {
            Some(file) => Source::Pending(Pending::new(Input::File(file), None)),
            None => Source::Store(store.clone()),
        })
    }

    /// Work pool: the store that has the bytes of the archive.
    fn store(&self) -> Result<Cow<'_, RefPtr<Store>>, SourceError> {
        match self {
            Source::Store(store) => Ok(Cow::Borrowed(store)),
            Source::Pending(pending) => pending.get_or_build().map(Cow::Owned),
        }
    }

    /// Work pool: give the bytes of the archive to `read`.
    fn with_bytes<R>(&self, read: impl FnOnce(&[u8]) -> R) -> Result<R, SourceError> {
        let store = self.store()?;
        Ok(read(in_memory(&store)?))
    }
}

/// A file store here has no path: `Source::of_blob` makes one with a path `Source::Pending`.
fn in_memory(store: &Store) -> Result<&[u8], SourceError> {
    match &store.data {
        StoreData::Bytes(bytes) => Ok(bytes.slice()),
        StoreData::File(_) => Err(SourceError::NoPath(FILE_DESCRIPTOR)),
        StoreData::S3(_) => Err(SourceError::NoPath(S3_FILE)),
    }
}

const S3_FILE: &str = "an S3 file";
const FILE_DESCRIPTOR: &str = "a Bun.file() of a file descriptor";

/// Why the work pool could not give the bytes of an archive.
pub(crate) enum SourceError {
    /// A file could not be opened or read, or is not a regular file.
    Sys(bun_sys::Error),
    /// A file gave fewer bytes than the size that its entry header already states.
    Shrank(Box<[u8]>),
    /// The Blob has no path to read: `S3_FILE` or `FILE_DESCRIPTOR`.
    NoPath(&'static str),
    /// libarchive did not write the tar.
    Tar(&'static str),
    OutOfMemory,
}

impl SourceError {
    pub(crate) fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        match self {
            SourceError::Sys(err) => err.to_js(global),
            SourceError::Shrank(path) => jsc::SystemError {
                code: bun_core::String::static_("EIO"),
                message: bun_core::String::static_("The file got smaller while it was read"),
                path: bun_core::String::clone_utf8(path),
                syscall: bun_core::String::static_("read"),
                ..Default::default()
            }
            .to_error_instance(global),
            SourceError::NoPath(kind) => global.to_invalid_arguments(format_args!(
                "Archive: cannot read {kind}. Pass the result of \"await file.bytes()\""
            )),
            SourceError::Tar(what) => {
                global.to_invalid_arguments(format_args!("Failed to create tarball: {what}"))
            }
            SourceError::OutOfMemory => global.create_out_of_memory_error(),
        }
    }
}

impl Archive {
    /// For `Bun.write`: the archive as a Blob, when its store already is what `bytes()` gives.
    pub(crate) fn to_blob(&self, global: &JSGlobalObject) -> Option<Blob> {
        match (&self.source, &self.compress) {
            (Source::Store(store), Compression::None) => {
                Some(Blob::init_with_store(store.clone(), global))
            }
            _ => None,
        }
    }

    /// For `Bun.write` when `to_blob` gives nothing: what makes the bytes on the work pool.
    pub(crate) fn output(&self) -> ArchiveOutput {
        ArchiveOutput {
            source: self.source.clone(),
            compress: self.compress,
        }
    }
}

/// The bytes that `archive.bytes()` resolves with, for another job to make.
pub(crate) struct ArchiveOutput {
    source: Source,
    compress: Compression,
}

impl ArchiveOutput {
    /// Work pool. Reads `Bun.file()` input that no method has read, and gzips.
    pub(crate) fn produce(&self) -> Result<RefPtr<Store>, OutputError> {
        match &self.compress {
            Compression::None => Ok(self.source.store()?.into_owned()),
            Compression::Gzip(opts) => Ok(Store::init(
                self.source
                    .with_bytes(|data| compress_gzip(data, opts.level))??,
            )),
        }
    }
}

pub(crate) enum OutputError {
    Source(SourceError),
    Compress(CompressError),
}

impl From<SourceError> for OutputError {
    fn from(err: SourceError) -> Self {
        OutputError::Source(err)
    }
}

impl From<CompressError> for OutputError {
    fn from(err: CompressError) -> Self {
        OutputError::Compress(err)
    }
}

impl OutputError {
    pub(crate) fn to_js(&self, global: &JSGlobalObject) -> JSValue {
        match self {
            OutputError::Source(err) => err.to_js(global),
            OutputError::Compress(err) => err.to_js(global),
        }
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
        let fmt_err = |_: core::fmt::Error| crate::Error::FormatError;
        // `Bun.file()` input is not read to print the archive.
        let files = match &self.source {
            Source::Store(store) => {
                let data = store.shared_view();
                writeln!(
                    writer,
                    "Archive ({}) {{",
                    bun_core::fmt::size(data.len(), bun_core::fmt::SizeFormatterOptions::default()),
                )
                .map_err(fmt_err)?;
                count_files_in_archive(data)
            }
            Source::Pending(pending) => match pending.files {
                Some(files) => {
                    writer.write_str("Archive {\n").map_err(fmt_err)?;
                    files
                }
                None => return writer.write_str("Archive {}").map_err(fmt_err),
            },
        };

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
                    JSValue::js_number(f64::from(files)),
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
    pub(crate) fn constructor(
        cx: &mut JsScope<'_>,
        data: JsLocal<'_>,
        options: JsLocal<'_>,
    ) -> JsResult<Self> {
        let global = cx.global();
        let data = data.to_js();

        // Parse compression options
        let compress = parse_compression_options(global, options.to_js())?;

        // For a Blob, ref the existing store (zero-copy). A `Bun.file()` is not read here.
        if let Some(blob) = blob_from_js(data) {
            if let Some(source) = Source::of_blob(blob) {
                return Ok(Self { source, compress });
            }
        }

        // For ArrayBuffer/TypedArray, copy the data
        if let Some(array_buffer) = data.as_array_buffer(global) {
            let data: Vec<u8> = array_buffer.slice().to_vec();
            return Ok(create_archive(data, compress));
        }

        // For plain objects, build a tarball
        if data.is_object() {
            return Ok(match build_tarball_from_object(global, data)? {
                ObjectForm::Tar(data) => create_archive(data, compress),
                ObjectForm::Pending(pending) => Self {
                    source: Source::Pending(pending),
                    compress,
                },
            });
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
    Archive {
        source: Source::Store(Store::init(data)),
        compress,
    }
}

/// The caller's `value` keeps the `Blob` alive.
#[inline]
fn blob_from_js(value: JSValue) -> Option<&'static Blob> {
    value.as_class_ref::<Blob>()
}

/// What the values of an object form give.
enum ObjectForm {
    /// Every value was in memory: the tar.
    Tar(Vec<u8>),
    /// A value is a `Bun.file()`. The work pool writes the tar from that entry on.
    Pending(Arc<Pending>),
}

/// Make `archive` a tar writer into `buffer`, which must not move until `archive` is closed.
fn open_tar_writer(
    archive: &libarchive::lib::Archive,
    buffer: *mut libarchive::lib::GrowingBuffer<'_>,
) -> Result<(), &'static str> {
    use libarchive::lib;
    if archive.write_set_format_pax_restricted() != lib::Result::Ok {
        return Err("ArchiveFormatError");
    }
    let open_rc = lib::archive_write_open2(
        archive,
        buffer.cast(),
        Some(lib::GrowingBuffer::open_callback),
        Some(lib::GrowingBuffer::write_callback),
        Some(lib::GrowingBuffer::close_callback),
        None,
    );
    if open_rc != 0 {
        return Err("ArchiveOpenError");
    }
    Ok(())
}

/// Begin the entry of a regular file of `size` bytes.
fn write_entry_header(
    archive: &libarchive::lib::Archive,
    entry: &libarchive::lib::Entry,
    name: &ZStr,
    size: u64,
    mtime: isize,
) -> Result<(), &'static str> {
    let _ = entry.clear();
    // As in `pack_command::add_archive_entry`: under the "C" locale only these forms are lossless.
    #[cfg(windows)]
    entry.set_pathname_utf8(name);
    #[cfg(not(windows))]
    entry.set_pathname(name);
    entry.set_size(i64::try_from(size).expect("int cast"));
    entry.set_filetype(FILETYPE_REGULAR);
    entry.set_perm(0o644);
    entry.set_mtime(mtime, 0);

    // `Warn` still wrote the header (binary hdrcharset fallback). `Failed`/`Fatal` wrote none.
    if !archive.write_header(entry).succeeded() {
        return Err("ArchiveHeaderError");
    }
    Ok(())
}

fn write_entry_body(archive: &libarchive::lib::Archive, data: &[u8]) -> Result<(), &'static str> {
    if archive.write_data(data) < 0 {
        return Err("ArchiveWriteError");
    }
    Ok(())
}

fn finish_entry(archive: &libarchive::lib::Archive) -> Result<(), &'static str> {
    if archive.write_finish_entry() != libarchive::lib::Result::Ok {
        return Err("ArchiveFinishEntryError");
    }
    Ok(())
}

/// One entry whose bytes are in memory.
fn write_entry(
    archive: &libarchive::lib::Archive,
    entry: &libarchive::lib::Entry,
    name: &ZStr,
    data: &[u8],
    mtime: isize,
) -> Result<(), &'static str> {
    write_entry_header(archive, entry, name, data.len() as u64, mtime)?;
    write_entry_body(archive, data)?;
    finish_entry(archive)
}

/// Shared helper that builds tarball bytes from a JS object
fn build_tarball_from_object(global: &JSGlobalObject, obj: JSValue) -> JsResult<ObjectForm> {
    use libarchive::lib;

    let Some(js_obj) = obj.get_object() else {
        return Err(global.throw_invalid_arguments(format_args!("Expected an object")));
    };
    let failed = |what: &'static str| {
        global.throw_invalid_arguments(format_args!("Failed to create tarball: {what}"))
    };

    // `growing_buffer` outlives all callback invocations: the archive is closed before return.
    let mut growing_buffer = lib::GrowingBuffer::init();
    let archive = lib::WriteArchive::new();
    let archive_ref: &lib::Archive = &archive;
    open_tar_writer(archive_ref, &raw mut growing_buffer).map_err(failed)?;

    let entry = lib::OwnedEntry::new();
    let entry_ref: &lib::Entry = &entry;

    let now_secs: isize = isize::try_from(bun_core::time::milli_timestamp() / 1000).unwrap_or(0);

    // Set at the first `Bun.file()`: the entries from there on, for the work pool to write.
    let mut draft: Option<Box<Draft>> = None;

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

        if let Some(draft) = &mut draft {
            let body = DraftBody::from_js(global, key_slice.slice(), value)?;
            draft.entries.push(DraftEntry {
                name: key_str,
                body,
            });
            continue;
        }

        // Get data - use view for Blob/ArrayBuffer, convert for strings
        let mut array_buffer = None;
        let data_slice = match get_entry_data(global, key_slice.slice(), value, &mut array_buffer)?
        {
            EntryData::Bytes(bytes) => bytes,
            EntryData::Recorded(body) => {
                draft = Some(Box::new(Draft {
                    head: Vec::new(),
                    entries: vec![DraftEntry {
                        name: key_str,
                        body,
                    }],
                    mtime: now_secs,
                }));
                continue;
            }
        };

        // Write entry to archive
        write_entry(
            archive_ref,
            entry_ref,
            key_str.as_zstr(),
            data_slice.slice(),
            now_secs,
        )
        .map_err(failed)?;
    }

    // Read before the close, which adds the end marker and the padding of the last block.
    let head_len = match &draft {
        Some(_) => usize::try_from(archive_ref.filter_bytes(0)).ok(),
        None => None,
    };

    if archive_ref.write_close() != lib::Result::Ok {
        return Err(failed("ArchiveCloseError"));
    }

    let Ok(mut tar) = growing_buffer.to_owned_slice() else {
        return Err(failed("OutOfMemory"));
    };
    let Some(mut draft) = draft else {
        return Ok(ObjectForm::Tar(tar));
    };
    let Some(head_len) = head_len.filter(|len| *len <= tar.len()) else {
        return Err(failed("ArchiveCloseError"));
    };
    let files = count_files_in_archive(&tar).saturating_add(draft.entries.len() as u32);
    tar.truncate(head_len);
    draft.head = tar;
    Ok(ObjectForm::Pending(Pending::new(
        Input::Draft(draft),
        Some(files),
    )))
}

/// The value of one entry of an object form.
enum EntryData<'a> {
    /// Its bytes: they are in memory.
    Bytes(Utf8Bytes<'a>),
    /// A `Bun.file()`. The work pool writes its entry.
    Recorded(DraftBody),
}

fn get_entry_data<'a>(
    global: &JSGlobalObject,
    name: &[u8],
    value: JSValue,
    array_buffer: &'a mut Option<bun_jsc::ArrayBuffer>,
) -> JsResult<EntryData<'a>> {
    // For a Blob in memory, use its view (no copy needed). The backing store outlives
    // the returned slice for the duration of the caller's tarball build.
    if let Some(blob) = blob_from_js(value) {
        return Ok(match blob.in_memory_view() {
            Some(view) => EntryData::Bytes(Utf8Bytes::Borrowed(view)),
            None => EntryData::Recorded(DraftBody::of_blob(global, name, blob)?),
        });
    }

    // For ArrayBuffer/TypedArray, use view (no copy needed)
    if let Some(buffer) = value.as_array_buffer(global) {
        return Ok(EntryData::Bytes(Utf8Bytes::Borrowed(
            array_buffer.insert(buffer).slice(),
        )));
    }

    // For strings, convert (allocates)
    Ok(EntryData::Bytes(value.to_utf8(global)?))
}

/// An object form from its first `Bun.file()` entry on. The work pool writes the rest of the tar.
struct Draft {
    /// The tar of the entries before the first file, without an end marker.
    head: Vec<u8>,
    /// The first file and every entry after it.
    entries: Vec<DraftEntry>,
    /// The one time that every entry of the archive has.
    mtime: isize,
}

struct DraftEntry {
    name: ZBox,
    body: DraftBody,
}

/// What the work pool needs to write the body of an entry.
enum DraftBody {
    /// A copy of a string or of an ArrayBuffer, which script can change later.
    Bytes(Vec<u8>),
    /// A Blob in memory: its store, and the part of it that is the Blob.
    Blob {
        store: RefPtr<Store>,
        offset: SizeType,
        size: SizeType,
    },
    File(FileWindow),
}

impl DraftBody {
    /// JS thread.
    fn from_js(global: &JSGlobalObject, name: &[u8], value: JSValue) -> JsResult<DraftBody> {
        if let Some(blob) = blob_from_js(value) {
            return DraftBody::of_blob(global, name, blob);
        }
        if let Some(buffer) = value.as_array_buffer(global) {
            return Ok(DraftBody::Bytes(buffer.slice().to_vec()));
        }
        Ok(DraftBody::Bytes(value.to_utf8(global)?.into_vec()))
    }

    /// JS thread. Throws for a Blob that has no path for the work pool to read.
    fn of_blob(global: &JSGlobalObject, name: &[u8], blob: &Blob) -> JsResult<DraftBody> {
        if let Some(file) = FileWindow::of_blob(blob) {
            return Ok(DraftBody::File(file));
        }
        let Some(store) = blob.store() else {
            return Ok(DraftBody::Bytes(Vec::new()));
        };
        let kind = match &store.data {
            StoreData::Bytes(_) => {
                return Ok(DraftBody::Blob {
                    store: store.clone(),
                    offset: blob.offset.get(),
                    size: blob.size.get(),
                });
            }
            StoreData::File(_) => FILE_DESCRIPTOR,
            StoreData::S3(_) => S3_FILE,
        };
        Err(global.throw_invalid_arguments(format_args!(
            "Archive: \"{}\" is {kind}. Pass the result of \"await file.bytes()\"",
            bstr::BStr::new(name)
        )))
    }
}

/// `size` bytes of `bytes` from `offset`, or as many as there are.
fn window(bytes: &[u8], offset: SizeType, size: SizeType) -> &[u8] {
    let rest = &bytes[(offset as usize).min(bytes.len())..];
    &rest[..(size as usize).min(rest.len())]
}

/// Where the second tar writer of a `Draft` puts its output: after the head.
struct TarOut {
    bytes: RefCell<Vec<u8>>,
    out_of_memory: Cell<bool>,
}

impl TarOut {
    fn append(&self, bytes: &[u8]) {
        let mut out = self.bytes.borrow_mut();
        if self.out_of_memory.get() || out.try_reserve(bytes.len()).is_err() {
            return self.out_of_memory.set(true);
        }
        out.extend_from_slice(bytes);
    }

    /// Make room for an entry of `size` bytes at once, not step by step during its write.
    fn reserve(&self, size: u64) -> Result<(), SourceError> {
        let size = usize::try_from(size).unwrap_or(usize::MAX);
        match self
            .bytes
            .borrow_mut()
            .try_reserve(size.saturating_add(TAR_BLOCK))
        {
            Ok(()) => Ok(()),
            Err(_) => Err(SourceError::OutOfMemory),
        }
    }

    /// libarchive is not told when `append` runs out of memory. The writer asks here.
    fn check(&self) -> Result<(), SourceError> {
        if self.out_of_memory.get() {
            return Err(SourceError::OutOfMemory);
        }
        Ok(())
    }

    fn write_entry(
        &self,
        archive: &libarchive::lib::Archive,
        entry: &libarchive::lib::Entry,
        name: &ZStr,
        data: &[u8],
        mtime: isize,
    ) -> Result<(), SourceError> {
        self.reserve(data.len() as u64)?;
        write_entry(archive, entry, name, data, mtime).map_err(SourceError::Tar)?;
        self.check()
    }
}

impl Draft {
    /// Work pool: the tar. After an error the draft is as it was, so the next use builds again.
    fn build(&mut self) -> Result<Vec<u8>, SourceError> {
        let head = core::mem::take(&mut self.head);
        let head_len = head.len();
        let (mut tar, written) = self.write_entries(head);
        // The second writer padded its own last block. The padding belongs to the whole tar.
        let padded = written.and_then(|entries_len| {
            tar.truncate(head_len + entries_len);
            let padded = (tar.len() + TAR_END_MARKER).next_multiple_of(TAR_BLOCK);
            match tar.try_reserve_exact(padded - tar.len()) {
                Ok(()) => Ok(padded),
                Err(_) => Err(SourceError::OutOfMemory),
            }
        });
        match padded {
            Ok(padded) => {
                tar.resize(padded, 0);
                Ok(tar)
            }
            Err(err) => {
                tar.truncate(head_len);
                tar.shrink_to_fit();
                self.head = tar;
                Err(err)
            }
        }
    }

    /// Append the entries to `tar`. Gives `tar` back, and the length of the entries in it.
    fn write_entries(&self, tar: Vec<u8>) -> (Vec<u8>, Result<usize, SourceError>) {
        use libarchive::lib;

        let out = TarOut {
            bytes: RefCell::new(tar),
            out_of_memory: Cell::new(false),
        };
        let mut append = |bytes: &[u8]| out.append(bytes);
        // `buffer` outlives all callback invocations: `archive` is dropped first.
        let mut buffer = lib::GrowingBuffer::forward_to(&mut append);
        let archive = lib::WriteArchive::new();
        let written = self.write_entries_to(&archive, &raw mut buffer, &out);
        if written.is_err() {
            // Or the drop closes the writer, which pads the open entry with zeros to its size.
            archive.write_fail();
        }
        drop(archive);
        (out.bytes.into_inner(), written)
    }

    fn write_entries_to(
        &self,
        archive: &libarchive::lib::Archive,
        buffer: *mut libarchive::lib::GrowingBuffer<'_>,
        out: &TarOut,
    ) -> Result<usize, SourceError> {
        use libarchive::lib;

        open_tar_writer(archive, buffer).map_err(SourceError::Tar)?;
        let entry = lib::OwnedEntry::new();
        let mut scratch = Vec::new();
        for draft_entry in &self.entries {
            let name = draft_entry.name.as_zstr();
            match &draft_entry.body {
                DraftBody::Bytes(bytes) => {
                    out.write_entry(archive, &entry, name, bytes, self.mtime)?;
                }
                DraftBody::Blob {
                    store,
                    offset,
                    size,
                } => {
                    let bytes = window(store.shared_view(), *offset, *size);
                    out.write_entry(archive, &entry, name, bytes, self.mtime)?;
                }
                DraftBody::File(file) => {
                    file.write_entry(archive, &entry, name, self.mtime, &mut scratch, out)?;
                }
            }
        }
        let entries_len = usize::try_from(archive.filter_bytes(0));
        if archive.write_close() != lib::Result::Ok {
            return Err(SourceError::Tar("ArchiveCloseError"));
        }
        out.check()?;
        entries_len.map_err(|_| SourceError::Tar("ArchiveCloseError"))
    }
}

/// The part of a file on disk that a `Bun.file()` with a path names.
struct FileWindow {
    path: Box<[u8]>,
    offset: SizeType,
    /// `MAX_SIZE` for a Blob with no end of its own: the read goes to the end of the file.
    size: SizeType,
}

impl FileWindow {
    /// JS thread. `None` for a Blob that is not a `Bun.file()` with a path.
    fn of_blob(blob: &Blob) -> Option<FileWindow> {
        let StoreData::File(file) = &blob.store()?.data else {
            return None;
        };
        let PathOrFileDescriptor::Path(path) = &file.pathlike else {
            return None;
        };
        Some(FileWindow {
            path: path.slice().into(),
            offset: blob.offset.get(),
            size: blob.size.get(),
        })
    }

    fn sys_error(&self, err: &bun_sys::Error) -> SourceError {
        SourceError::Sys(err.with_path(&self.path))
    }

    /// Work pool: open the file and give its size. Only a regular file has a size to rely on.
    fn open(&self) -> Result<(bun_sys::File, u64), SourceError> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        // The path that `Bun.file(path).bytes()` opens.
        let path = PathLike::borrowed(&self.path);
        let path = path.slice_z(&mut path_buf);
        let (file, stat) = bun_sys::File::open_for_read(Fd::cwd(), path.as_bytes())
            .map_err(|err| self.sys_error(&err))?;
        let not_a_file = match bun_core::kind_from_mode(stat.st_mode as Mode) {
            bun_core::FileKind::File => {
                return Ok((file, (stat.st_size as i64).max(0) as u64));
            }
            bun_core::FileKind::Directory => bun_sys::E::EISDIR,
            _ => bun_sys::E::ENODEV,
        };
        Err(self.sys_error(&bun_sys::Error::from_code(not_a_file, bun_sys::Tag::read)))
    }

    /// Work pool: read a small file to its end. procfs states 0 bytes and sysfs states a page.
    fn read_small<'a>(
        &self,
        file: &bun_sys::File,
        file_size: u64,
        scratch: &'a mut Vec<u8>,
    ) -> Result<Cow<'a, [u8]>, SourceError> {
        scratch.resize(FILE_CHUNK + 1, 0);
        let want = match file_size {
            0 => scratch.len(),
            stated => stated as usize,
        };
        let read = file
            .pread_all(&mut scratch[..want], 0)
            .map_err(|err| self.sys_error(&err))?;
        if read == scratch.len() {
            // More than `scratch` holds, from a file that stated no size.
            return match file.read_to_end() {
                Ok(bytes) => Ok(Cow::Owned(bytes)),
                Err(err) => Err(self.sys_error(&err)),
            };
        }
        Ok(Cow::Borrowed(&scratch[..read]))
    }

    /// Work pool: give `len` bytes of `file` from `offset` to `sink`, `FILE_CHUNK` at a time.
    fn read_large(
        &self,
        file: &bun_sys::File,
        mut offset: u64,
        mut len: u64,
        scratch: &mut Vec<u8>,
        mut sink: impl FnMut(&[u8]) -> Result<(), SourceError>,
    ) -> Result<(), SourceError> {
        scratch.resize(FILE_CHUNK + 1, 0);
        while len > 0 {
            let want = usize::try_from(len).map_or(FILE_CHUNK, |len| len.min(FILE_CHUNK));
            let read = file
                .pread_all(&mut scratch[..want], offset)
                .map_err(|err| self.sys_error(&err))?;
            if read < want {
                return Err(SourceError::Shrank(self.path.clone()));
            }
            sink(&scratch[..read])?;
            offset += read as u64;
            len -= read as u64;
        }
        Ok(())
    }

    /// Where the window starts in a file of `file_size` bytes, and how long it is there.
    fn clamp(&self, file_size: u64) -> (u64, u64) {
        let offset = self.offset.min(file_size);
        (offset, self.size.min(file_size - offset))
    }

    /// Work pool: the bytes of the window.
    fn read(&self) -> Result<Vec<u8>, SourceError> {
        let (file, file_size) = self.open()?;
        let mut scratch = Vec::new();
        if file_size <= FILE_CHUNK as u64 {
            let bytes = self.read_small(&file, file_size, &mut scratch)?;
            return Ok(window(&bytes, self.offset, self.size).to_vec());
        }
        let (offset, len) = self.clamp(file_size);
        let mut bytes = Vec::new();
        if bytes.try_reserve_exact(len as usize).is_err() {
            return Err(SourceError::OutOfMemory);
        }
        self.read_large(&file, offset, len, &mut scratch, |part| {
            bytes.extend_from_slice(part);
            Ok(())
        })?;
        Ok(bytes)
    }

    /// Work pool: write the entry `name` from the window. The entries of a tar share `scratch`.
    fn write_entry(
        &self,
        archive: &libarchive::lib::Archive,
        entry: &libarchive::lib::Entry,
        name: &ZStr,
        mtime: isize,
        scratch: &mut Vec<u8>,
        out: &TarOut,
    ) -> Result<(), SourceError> {
        let (file, file_size) = self.open()?;
        if file_size <= FILE_CHUNK as u64 {
            let bytes = self.read_small(&file, file_size, scratch)?;
            let bytes = window(&bytes, self.offset, self.size);
            return out.write_entry(archive, entry, name, bytes, mtime);
        }
        let (offset, len) = self.clamp(file_size);
        out.reserve(len)?;
        write_entry_header(archive, entry, name, len, mtime).map_err(SourceError::Tar)?;
        self.read_large(&file, offset, len, scratch, |part| {
            write_entry_body(archive, part).map_err(SourceError::Tar)?;
            out.check()
        })?;
        finish_entry(archive).map_err(SourceError::Tar)
    }
}

/// `Bun.file()` input of an archive, which the work pool reads once, at the first use.
pub(crate) struct Pending {
    /// A read holds this from its start to its end. Only pool threads take it.
    state: Guarded<PendingState>,
    /// The entry count of an object form, for `console.log` before the tar exists.
    files: Option<u32>,
}

enum PendingState {
    Input(Input),
    Built(RefPtr<Store>),
}

enum Input {
    Draft(Box<Draft>),
    /// A `Bun.file()` given as the archive.
    File(FileWindow),
}

impl Pending {
    fn new(input: Input, files: Option<u32>) -> Arc<Pending> {
        Arc::new(Pending {
            state: Guarded::new(PendingState::Input(input)),
            files,
        })
    }

    /// Work pool: reads at the first call and after a failed one. A call during a read waits.
    fn get_or_build(&self) -> Result<RefPtr<Store>, SourceError> {
        let mut state = self.state.lock();
        let input = match &mut *state {
            PendingState::Built(store) => return Ok(store.clone()),
            PendingState::Input(input) => input,
        };
        let store = Store::init(match input {
            Input::Draft(draft) => draft.build()?,
            Input::File(file) => file.read()?,
        });
        *state = PendingState::Built(store.clone());
        Ok(store)
    }
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
                WriteData::Archive(archive.source.clone()),
                path_slice.slice(),
                compress,
            );
        }

        // For Blobs, use store reference with options compression
        if let Some(blob) = blob_from_js(data_arg) {
            if let Some(source) = Source::of_blob(blob) {
                return start_write_task(
                    &cx,
                    WriteData::Archive(source),
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
            let data = match build_tarball_from_object(global, data_arg)? {
                ObjectForm::Tar(data) => WriteData::Owned(data),
                ObjectForm::Pending(pending) => WriteData::Archive(Source::Pending(pending)),
            };
            return start_write_task(&cx, data, path_slice.slice(), options_compress);
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

        start_extract_task(&cx, &self.source, path_slice.slice(), glob_patterns)
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
        start_blob_task(&cx, &self.source, self.compress, BlobOutputType::Blob)
    }

    /// Instance method: archive.bytes()
    /// Returns Promise<Uint8Array> with the archive data (compressed if gzip was set in options)
    pub(crate) fn bytes(&self, cx: &mut JsScope<'_>) -> JsResult<JSValue> {
        let cx = cx.js_thread();
        start_blob_task(&cx, &self.source, self.compress, BlobOutputType::Bytes)
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

        start_files_task(&cx, &self.source, glob_patterns)
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
    Source(Box<SourceError>),
}

pub(crate) struct ExtractContext {
    archive: Source,
    path: Box<[u8]>,
    glob_patterns: Option<Vec<GlobPattern>>,
    result: ExtractResult,
}

impl TaskContext for ExtractContext {
    fn run(&mut self) {
        self.result = match self.archive.with_bytes(|data| self.do_run(data)) {
            Ok(result) => result,
            Err(err) => ExtractResult::Source(Box::new(err)),
        };
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        Ok(match &self.result {
            ExtractResult::Success(count) => {
                PromiseResult::Resolve(JSValue::js_number(*count as f64))
            }
            ExtractResult::Err(e) => PromiseResult::Reject(
                global.create_error_instance(format_args!("{}", <&'static str>::from(e))),
            ),
            ExtractResult::Source(err) => PromiseResult::Reject(err.to_js(global)),
        })
    }
}

impl ExtractContext {
    fn do_run(&self, data: &[u8]) -> ExtractResult {
        // If we have glob patterns, use filtered extraction
        if self.glob_patterns.is_some() {
            let count =
                match extract_to_disk_filtered(data, &self.path, self.glob_patterns.as_deref()) {
                    Ok(c) => c,
                    Err(_) => return ExtractResult::Err(ExtractError::ReadError),
                };
            return ExtractResult::Success(count);
        }

        // Otherwise use the fast path without filtering
        let count = match libarchive::Archiver::extract_to_disk(
            data,
            &self.path,
            None,
            &mut (),
            libarchive::ExtractOptions {
                depth_to_skip: 0,
                close_handles: true,
                log: false,
                npm: false,
                skip_symlinks: false,
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
    cx: &bun_jsc::JsThread<'_>,
    archive: &Source,
    path: &[u8],
    glob_patterns: Option<Vec<GlobPattern>>,
) -> JsResult<JSValue> {
    let path_copy: Box<[u8]> = Box::from(path);
    // errdefer free(path_copy) — Drop handles it

    let archive = archive.clone();
    // errdefer store.deref() — Drop handles it

    Ok(ExtractTask::start(
        cx,
        ExtractContext {
            archive,
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
    Source(Box<SourceError>),
}

pub(crate) struct BlobContext {
    archive: Source,
    compress: Compression,
    output_type: BlobOutputType,
    result: BlobResult,
}

impl TaskContext for BlobContext {
    fn run(&mut self) {
        self.result = match &self.compress {
            Compression::Gzip(opts) => {
                match self
                    .archive
                    .with_bytes(|data| compress_gzip(data, opts.level))
                {
                    Ok(Ok(data)) => BlobResult::Compressed(data),
                    Ok(Err(e)) => BlobResult::Err(e),
                    Err(err) => BlobResult::Source(Box::new(err)),
                }
            }
            Compression::None => match &self.archive {
                Source::Store(_) => BlobResult::Uncompressed,
                // `run_from_js` takes the store that this read gives.
                Source::Pending(pending) => match pending.get_or_build() {
                    Ok(store) => {
                        self.archive = Source::Store(store);
                        BlobResult::Uncompressed
                    }
                    Err(err) => BlobResult::Source(Box::new(err)),
                },
            },
        };
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        match core::mem::replace(&mut self.result, BlobResult::Uncompressed) {
            BlobResult::Err(e) => Ok(PromiseResult::Reject(e.to_js(global))),
            BlobResult::Source(err) => Ok(PromiseResult::Reject(err.to_js(global))),
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
            BlobResult::Uncompressed => {
                // `Source::Pending` here is a job that the pool gave back without a run.
                let Source::Store(store) = &self.archive else {
                    return Ok(PromiseResult::Reject(
                        global.create_error_instance(format_args!("ReadError")),
                    ));
                };
                Ok(match self.output_type {
                    BlobOutputType::Blob => {
                        // `init_with_store` takes the ref that the clone made.
                        let store = store.clone();
                        let blob_ptr = Blob::new(Blob::init_with_store(store, global));
                        // SAFETY: blob_ptr is the heap allocation just produced by Blob::new.
                        PromiseResult::Resolve(unsafe { (*blob_ptr).to_js(global) })
                    }
                    BlobOutputType::Bytes => {
                        let view = match in_memory(store) {
                            Ok(view) => view,
                            Err(err) => return Ok(PromiseResult::Reject(err.to_js(global))),
                        };
                        // On allocation failure, reject the promise instead of aborting.
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
                })
            }
        }
    }
}

pub(crate) type BlobTask = AsyncTask<BlobContext>;

fn start_blob_task(
    cx: &bun_jsc::JsThread<'_>,
    archive: &Source,
    compress: Compression,
    output_type: BlobOutputType,
) -> JsResult<JSValue> {
    let archive = archive.clone();
    // errdefer store.deref() — Drop handles it

    Ok(BlobTask::start(
        cx,
        BlobContext {
            archive,
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
    Source(Box<SourceError>),
}

enum WriteData {
    Owned(Vec<u8>),
    Archive(Source),
}

pub(crate) struct WriteContext {
    data: WriteData,
    path: ZBox,
    compress: Compression,
    result: WriteResult,
}

impl TaskContext for WriteContext {
    fn run(&mut self) {
        self.result = match &self.data {
            WriteData::Owned(data) => self.do_run(data),
            // The read comes before the open, so a failed read leaves the destination as it is.
            WriteData::Archive(archive) => match archive.with_bytes(|data| self.do_run(data)) {
                Ok(result) => result,
                Err(err) => WriteResult::Source(Box::new(err)),
            },
        };
    }

    fn run_from_js(&mut self, global: &JSGlobalObject) -> JsResult<PromiseResult> {
        Ok(match &self.result {
            WriteResult::Success => PromiseResult::Resolve(JSValue::UNDEFINED),
            WriteResult::Err(e) => PromiseResult::Reject(e.to_js(global)),
            WriteResult::SysErr(sys_err) => PromiseResult::Reject(sys_err.to_js(global)),
            WriteResult::Source(err) => PromiseResult::Reject(err.to_js(global)),
        })
    }
}

impl WriteContext {
    fn do_run(&self, source_data: &[u8]) -> WriteResult {
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
    LibarchiveErr(CString),
    Err(FilesError),
    Source(Box<SourceError>),
}

// freeEntries deleted — Vec<FileEntry> drops each entry; FileEntry fields drop their boxes.

pub(crate) struct FilesContext {
    archive: Source,
    glob_patterns: Option<Vec<GlobPattern>>,
    result: FilesResult,
}

impl FilesContext {
    fn read_error(archive: &libarchive::lib::Archive) -> FilesResult {
        let err_str = archive.error_string();
        match CString::new(err_str) {
            Ok(err) if !err_str.is_empty() => FilesResult::LibarchiveErr(err),
            _ => FilesResult::Err(FilesError::ReadError),
        }
    }

    fn do_run(&self, data: &[u8]) -> Result<FilesResult, bun_alloc::AllocError> {
        use libarchive::lib;
        let archive = lib::ReadArchive::new();
        configure_archive_reader(&archive);

        if archive.read_open_memory(data) != lib::Result::Ok {
            return Ok(Self::read_error(&archive));
        }

        let mut entries: FileEntryList = Vec::new();
        // errdefer freeEntries(&entries) — handled by Drop on `entries`

        let mut entry: *mut lib::Entry = core::ptr::null_mut();
        loop {
            match archive.read_next_header(&mut entry) {
                lib::Result::Eof => break,
                lib::Result::Retry => continue,
                lib::Result::Failed | lib::Result::Fatal => return Ok(Self::read_error(&archive)),
                lib::Result::Ok | lib::Result::Warn => {}
            }
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

            let mut data: Vec<u8> = Vec::new();
            if !archive.read_data_to_vec(size, &mut data)? {
                return Ok(Self::read_error(&archive));
            }

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
        self.result = match self.archive.with_bytes(|data| self.do_run(data)) {
            Ok(Ok(r)) => r,
            Ok(Err(_)) => FilesResult::Err(FilesError::OutOfMemory),
            Err(err) => FilesResult::Source(Box::new(err)),
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
            FilesResult::LibarchiveErr(err_msg) => Ok(PromiseResult::Reject(
                EncodedSlice::utf8(err_msg.to_bytes()).to_error_instance(global),
            )),
            FilesResult::Err(e) => Ok(PromiseResult::Reject(
                global.create_error_instance(format_args!("{}", <&'static str>::from(&*e))),
            )),
            FilesResult::Source(err) => Ok(PromiseResult::Reject(err.to_js(global))),
        }
    }
}

pub(crate) type FilesTask = AsyncTask<FilesContext>;

fn start_files_task(
    cx: &bun_jsc::JsThread<'_>,
    archive: &Source,
    glob_patterns: Option<Vec<GlobPattern>>,
) -> JsResult<JSValue> {
    let archive = archive.clone();
    // errdefer store.deref() — Drop handles it
    // Ownership: On error, caller's errdefer frees glob_patterns.
    // On success, ownership transfers to FilesContext, which frees them in deinit().

    Ok(FilesTask::start(
        cx,
        FilesContext {
            archive,
            glob_patterns,
            result: FilesResult::Err(FilesError::ReadError),
        },
    ))
}

// ============================================================================
// Helpers
// ============================================================================

#[derive(thiserror::Error, strum::IntoStaticStr, Debug)]
pub(crate) enum CompressError {
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
    let mut write_strategy = lib::WriteStrategy::default();

    loop {
        match archive.read_next_header(&mut entry) {
            lib::Result::Eof => break,
            lib::Result::Retry => continue,
            lib::Result::Failed | lib::Result::Fatal => return Err(crate::Error::ReadError),
            lib::Result::Ok | lib::Result::Warn => {}
        }
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

                let write_success = size == 0
                    || archive.read_data_into_fd(file_fd, &mut write_strategy) == lib::Result::Ok;
                let _ = file_fd.close();

                if !write_success {
                    // Remove partial file on failure
                    let _ = bun_sys::unlinkat(dir_fd, pathname_z);
                    return Err(crate::Error::ReadError);
                }
                count += 1;
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
