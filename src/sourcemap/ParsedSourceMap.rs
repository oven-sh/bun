use core::ffi::c_void;
use core::fmt;
use std::sync::OnceLock;

use bun_core::strings;

use crate::Ordinal;

use crate::mapping;
use crate::vlq::VLQ;
use crate::{
    InternalSourceMap, Mapping, ParseUrl, ParseUrlResultHint, SourceMapLoadHint, SourceProvider,
    SourceProviderMap,
};

/// ParsedSourceMap can be acquired by different threads via the thread-safe
/// source map store (SavedSourceMap), so the reference count must be thread-safe.
pub struct ParsedSourceMap {
    pub mappings: mapping::List,
    /// What `parse_json` found in `sourcesContent`.
    /// [`Self::original_line_bound`] reads it.
    pub(crate) source_text: SourceText,
    /// Set when this map's mappings are backed by an InternalSourceMap blob
    /// instead of a materialized `Mapping.List`. The blob is *owned* (freed in
    /// `Drop`) unless [`Self::is_standalone_module_graph`] — in that case the
    /// bytes live in the embedded `bun build --compile` section and are
    /// borrowed.
    pub(crate) internal: Option<InternalSourceMap>,

    /// If this is empty, this implies that the source code is a single file
    /// transpiled on-demand. If there are items, then it means this is a file
    /// loaded without transpilation but with external sources. This array
    /// maps `source_index` to the correct filename.
    pub external_source_names: Vec<Box<[u8]>>,
    /// In order to load source contents from a source-map after the fact,
    /// a handle to the underlying source provider is stored, along with a
    /// load hint recording whether the map is known to be inline or external.
    ///
    /// Source contents are large, we don't preserve them in memory. This has
    /// the downside of repeatedly re-decoding sourcemaps if multiple errors
    /// are emitted (specifically with Bun.inspect / unhandled; the ones that
    /// rely on source contents)
    pub underlying_provider: SourceContentPtr,

    pub is_standalone_module_graph: bool,
}

impl Drop for ParsedSourceMap {
    fn drop(&mut self) {
        // When the mappings are backed
        // by an `InternalSourceMap` blob the blob is *owned* (allocated by
        // `SavedSourceMap::put_mappings`) unless this is the
        // standalone-module-graph case where the bytes live in the embedded
        // section. The doc on the `internal` field only describes that latter
        // borrowed case; the owned case is the runtime-transpiler upgrade in
        // `SavedSourceMap::get_with_content`, which previously stranded the
        // blob and showed up as the `print_ast` LSan suppression.
        //
        // `mappings`/`external_source_names` free via their own `Drop`.
        if let Some(ism) = self.internal.take() {
            if !self.is_standalone_module_graph {
                ism.free_owned();
            }
        }
    }
}

impl Default for ParsedSourceMap {
    fn default() -> Self {
        Self {
            mappings: mapping::List::default(),
            source_text: SourceText::NoSources,
            internal: None,
            external_source_names: Vec::new(),
            underlying_provider: SourceContentPtr::NONE,
            is_standalone_module_graph: false,
        }
    }
}

/// How much source text the JSON of a map carries in `sourcesContent`. A text
/// of `n` bytes has at most `n + 1` lines, so the bytes held bound the lines
/// that a mapping can name. Only `parse_json` makes one that is not
/// `NoSources`.
#[derive(Default)]
pub(crate) enum SourceText {
    /// The map names no source, or it did not come from JSON.
    #[default]
    NoSources,
    /// Every source has text. The longest text has this many bytes.
    Whole(u32),
    /// At least one source has no text.
    Partial(Box<PartialSourceText>),
}

pub(crate) struct PartialSourceText {
    /// Bytes in the longest text, or 0 when no source has text.
    longest: u32,
    /// Indices into `external_source_names`: the sources with no text.
    textless: Box<[u32]>,
    /// What `count_lines_on_disk` found. It runs once, so every reader of
    /// the map gets the same bound.
    lines_on_disk: OnceLock<Result<u32, UnreadableSource>>,
}

impl SourceText {
    /// `longest` is the byte length of the longest `sourcesContent` entry.
    /// `textless` lists the sources whose entry is not a string with text.
    pub(crate) fn new(source_count: usize, longest: usize, textless: Vec<u32>) -> SourceText {
        if source_count == 0 {
            return SourceText::NoSources;
        }
        let longest = u32::try_from(longest).unwrap_or(u32::MAX);
        if textless.is_empty() {
            return SourceText::Whole(longest);
        }
        SourceText::Partial(Box::new(PartialSourceText {
            longest,
            textless: textless.into_boxed_slice(),
            lines_on_disk: OnceLock::new(),
        }))
    }

    fn memory_cost(&self) -> usize {
        match self {
            SourceText::NoSources | SourceText::Whole(_) => 0,
            SourceText::Partial(partial) => {
                core::mem::size_of::<PartialSourceText>()
                    + core::mem::size_of_val::<[u32]>(&partial.textless)
                    + match partial.lines_on_disk.get() {
                        Some(Err(unreadable)) => unreadable.path.len(),
                        Some(Ok(_)) | None => 0,
                    }
            }
        }
    }
}

/// A source with no text in the map, whose file could not be read either.
pub struct UnreadableSource {
    /// Where `sources` puts the file.
    pub path: Box<[u8]>,
    /// The name of the errno, or what makes the file not a source.
    pub reason: &'static [u8],
}

/// Why [`ParsedSourceMap::original_line_bound`] has no bound.
pub enum NoLineBound<'a> {
    /// The map names no source, so there is no text to count lines in.
    NoSources,
    Unreadable(&'a UnreadableSource),
}

/// One past the bytes of `path` that can end a line, counted until the result
/// is `enough`. LF, CR and 0xE2 (the first byte of U+2028 and of U+2029) each
/// count, so the result is never below the line count that
/// [`crate::LineOffsetTable`] gives the same text. `Err` says why `path` is
/// not a file to count in.
fn count_lines_in_file(
    path: &bun_core::ZStr,
    chunk: &mut [u8],
    enough: u32,
) -> Result<u32, &'static [u8]> {
    use bun_sys::O;
    // With O_NONBLOCK the open of a FIFO that has no writer returns at once.
    // On Windows the flag opens the file for overlapped I/O, which the read
    // below is not.
    let nonblock = if cfg!(unix) { O::NONBLOCK } else { 0 };
    let file = bun_sys::File::openat(
        bun_sys::Fd::cwd(),
        path.as_bytes(),
        O::RDONLY | O::CLOEXEC | nonblock,
        0,
    )
    .map_err(|err| err.name())?;
    match file.kind() {
        Ok(bun_sys::FileKind::File) => {}
        Ok(_) => return Err(b"not a regular file"),
        Err(err) => return Err(err.name()),
    }
    // No parser takes a longer text, so a longer file is not a source. This
    // also keeps the read below from taking a sparse file of any size.
    match file.get_end_pos() {
        Ok(len) if len <= bun_ast::Source::MAX_PARSEABLE_LEN => {}
        Ok(_) => return Err(b"larger than 2 GiB"),
        Err(err) => return Err(err.name()),
    }
    let mut lines: u32 = 1;
    while lines < enough {
        let read = match file.read(chunk) {
            Ok(0) => break,
            Ok(n) => &chunk[..n],
            Err(err) => return Err(err.name()),
        };
        let ends = strings::count_char(read, b'\n')
            + strings::count_char(read, b'\r')
            + strings::count_char(read, 0xE2);
        lines = lines.saturating_add(u32::try_from(ends).unwrap_or(u32::MAX));
    }
    Ok(lines)
}

/// Type-erased `get_source_map` dispatch for a provider handle stored in a
/// [`SourceContentPtr`]: one monomorphization of [`erased_get_source_map`]
/// per [`SourceProvider`] impl. The handle round-trips as a plain pointer
/// without this module naming any concrete provider type.
type ErasedGetSourceMap = unsafe fn(
    provider: *mut c_void,
    source_filename: &[u8],
    load_hint: SourceMapLoadHint,
    result: ParseUrlResultHint,
) -> Option<ParseUrl>;

/// # Safety
/// `provider` must be the pointer packed by
/// [`SourceContentPtr::from_source_provider`] for the same `P`, still live.
unsafe fn erased_get_source_map<P: SourceProvider>(
    provider: *mut c_void,
    source_filename: &[u8],
    load_hint: SourceMapLoadHint,
    result: ParseUrlResultHint,
) -> Option<ParseUrl> {
    // SAFETY: caller contract — `provider` originates from
    // `SourceContentPtr::from_source_provider::<P>`, so it is a live
    // `*const P` for the duration of this call.
    let provider = unsafe { &*provider.cast::<P>() };
    crate::get_source_map_impl(provider, source_filename, load_hint, result)
}

/// An erased source provider: the raw FFI handle plus the `get_source_map`
/// dispatch monomorphized for its concrete type. Recovered from a
/// [`SourceContentPtr`], or stored whole (boxed) where the pair must travel
/// together (`bun_jsc::SavedSourceMap`'s provider entries).
#[derive(Clone, Copy)]
pub struct AnySourceProvider {
    ptr: *mut c_void,
    get_source_map: ErasedGetSourceMap,
}

impl AnySourceProvider {
    /// Erases a provider handle. Like [`SourceContentPtr::from_source_provider`],
    /// `p` must stay live for as long as the returned value (or any copy of
    /// it) is dispatched through.
    pub fn new<P: SourceProvider>(p: *const P) -> AnySourceProvider {
        AnySourceProvider {
            ptr: p.cast_mut().cast::<c_void>(),
            get_source_map: erased_get_source_map::<P>,
        }
    }

    pub fn ptr(&self) -> *mut c_void {
        self.ptr
    }

    pub fn get_source_map(
        &self,
        source_filename: &[u8],
        load_hint: SourceMapLoadHint,
        result: ParseUrlResultHint,
    ) -> Option<ParseUrl> {
        // SAFETY: `ptr` and `get_source_map` were packed together by
        // `SourceContentPtr::from_source_provider`; the provider FFI handle
        // outlives any `ParsedSourceMap` that stores it, so it is valid for
        // the duration of this call.
        unsafe { (self.get_source_map)(self.ptr, source_filename, load_hint, result) }
    }
}

/// A provider handle (stored as a raw address in `data`), the erased
/// `get_source_map` dispatch for its concrete type, and a load hint.
#[derive(Copy, Clone)]
pub struct SourceContentPtr {
    data: u64,
    load_hint: SourceMapLoadHint,
    get_source_map: Option<ErasedGetSourceMap>,
}

impl SourceContentPtr {
    pub(crate) const NONE: SourceContentPtr = SourceContentPtr {
        data: 0,
        load_hint: SourceMapLoadHint::None,
        get_source_map: None,
    };

    #[inline]
    pub(crate) fn load_hint(self) -> SourceMapLoadHint {
        self.load_hint
    }

    #[inline]
    pub(crate) fn set_load_hint(&mut self, hint: SourceMapLoadHint) {
        self.load_hint = hint;
    }

    #[inline]
    pub(crate) fn data(self) -> u64 {
        self.data
    }

    /// Pack a provider handle. [`Self::provider`] recovers it together with
    /// the `get_source_map` dispatch for `P`.
    pub fn from_source_provider<P: SourceProvider>(p: *const P) -> SourceContentPtr {
        SourceContentPtr {
            data: u64::try_from(p as usize).expect("int cast"),
            load_hint: SourceMapLoadHint::None,
            get_source_map: Some(erased_get_source_map::<P>),
        }
    }

    /// `SourceProviderMap` packing helper. Also used by the standalone module
    /// graph, which stores a `*mut SerializedSourceMap::Loaded` here (guarded
    /// by [`ParsedSourceMap::is_standalone_module_graph`], so the provider
    /// dispatch is never invoked for it).
    pub fn from_provider(p: *const SourceProviderMap) -> SourceContentPtr {
        Self::from_source_provider(p)
    }

    pub fn provider(self) -> Option<AnySourceProvider> {
        Some(AnySourceProvider {
            ptr: self.data as usize as *mut c_void,
            get_source_map: self.get_source_map?,
        })
    }
}

impl ParsedSourceMap {
    /// Thread-safe ref-count helper.
    ///
    /// Every
    /// table-stored `ParsedSourceMap` is allocated via `Arc::into_raw` (see
    /// `SavedSourceMap::get_with_content` and `ParseUrl.map:
    /// Option<Arc<ParsedSourceMap>>`), so the strong count lives in the `Arc`
    /// header *before* the data pointer. Reconstituting that pointer with
    /// `heap::take` would free an interior offset and trips
    /// `mi_validate_block_from_ptr` (mimalloc free.c:123). Route through
    /// `Arc::decrement_strong_count` instead — same observable
    /// `deref()` semantics, with the allocator that
    /// actually owns the bytes.
    ///
    /// # Safety
    /// `this` must come from `Arc::<Self>::into_raw` and must still have at
    /// least one strong ref. Drops the allocation when the count reaches 0.
    #[inline]
    pub unsafe fn deref(this: *mut Self) {
        // SAFETY: caller contract — `this` is a live `Arc::into_raw` pointer.
        unsafe { std::sync::Arc::decrement_strong_count(this.cast_const()) };
    }

    /// Construct a `ParsedSourceMap` whose mappings are backed by an
    /// `InternalSourceMap` blob (e.g. one embedded in a `bun build --compile`
    /// executable's standalone module graph) instead of a materialized
    /// `mapping::List`. Ownership of the blob transfers to the returned value
    /// (freed in `Drop`) unless the caller subsequently sets
    /// [`Self::is_standalone_module_graph`].
    pub fn from_internal(internal: InternalSourceMap) -> Self {
        Self {
            mappings: mapping::List::default(),
            source_text: SourceText::NoSources,
            internal: Some(internal),
            external_source_names: Vec::new(),
            underlying_provider: SourceContentPtr::NONE,
            is_standalone_module_graph: false,
        }
    }

    pub fn is_external(&self) -> bool {
        !self.external_source_names.is_empty()
    }

    pub fn find_mapping(&self, line: Ordinal, column: Ordinal) -> Option<Mapping> {
        if let Some(ism) = &self.internal {
            return ism.find(line, column);
        }
        self.mappings.find(line, column)
    }

    pub fn internal_cursor(&self) -> Option<crate::internal_source_map::Cursor> {
        self.internal.as_ref().map(|ism| ism.cursor())
    }

    /// How many lines a reader that indexes by the original line of a mapping
    /// makes room for. A mapping that names a line at or past the bound names
    /// no line of a text that bun holds, and the reader drops it.
    ///
    /// A blob stores the line count of the text it was printed from. A map
    /// from JSON has no stored count: the bound is one past the largest line
    /// that a mapping names, and at most one past the bytes of the longest
    /// source text. That text is the `sourcesContent` entry. For a source
    /// with no entry it is the file that `sources` names, relative to
    /// `generated_path`, and only its line ends are counted.
    pub fn original_line_bound(&self, generated_path: &[u8]) -> Result<u32, NoLineBound<'_>> {
        if let Some(internal) = &self.internal {
            return Ok((internal.input_line_count() as u32).saturating_add(1));
        }
        let named = self
            .mappings
            .original()
            .iter()
            .map(|at| at.lines.zero_based())
            .max()
            .map_or(0, |line| line.max(0) as u32 + 1);
        let (held, partial) = match &self.source_text {
            SourceText::Whole(longest) => return Ok(named.min(longest.saturating_add(1))),
            SourceText::Partial(partial) => (partial.longest.saturating_add(1), Some(partial)),
            SourceText::NoSources => (1, None),
        };
        if named <= held {
            return Ok(named);
        }
        let Some(partial) = partial else {
            return Err(NoLineBound::NoSources);
        };
        partial
            .lines_on_disk
            .get_or_init(|| self.count_lines_on_disk(&partial.textless, generated_path, named))
            .as_ref()
            .map(|&on_disk| named.min(held.max(on_disk)))
            .map_err(NoLineBound::Unreadable)
    }

    /// The largest [`count_lines_in_file`] of the files of `textless`.
    fn count_lines_on_disk(
        &self,
        textless: &[u32],
        generated_path: &[u8],
        enough: u32,
    ) -> Result<u32, UnreadableSource> {
        let mut path_buf = bun_paths::path_buffer_pool::get();
        let mut chunk = vec![0u8; 64 * 1024];
        let mut most: u32 = 0;
        for &source in textless {
            let path = mapping::source_file_path(
                generated_path,
                &self.external_source_names[source as usize],
                &mut path_buf[..],
            );
            match count_lines_in_file(path, &mut chunk, enough) {
                Ok(lines) => most = most.max(lines),
                Err(reason) => {
                    return Err(UnreadableSource {
                        path: Box::from(path.as_bytes()),
                        reason,
                    });
                }
            }
            if most >= enough {
                break;
            }
        }
        Ok(most)
    }

    pub(crate) fn standalone_module_graph_data(&self) -> *mut crate::SerializedSourceMap::Loaded {
        debug_assert!(self.is_standalone_module_graph);
        self.underlying_provider.data() as usize as *mut crate::SerializedSourceMap::Loaded
    }

    pub fn memory_cost(&self) -> usize {
        let mappings_cost = if let Some(ism) = &self.internal {
            ism.memory_cost()
        } else {
            self.mappings.memory_cost()
        };
        core::mem::size_of::<ParsedSourceMap>()
            + mappings_cost
            + self.source_text.memory_cost()
            + self.external_source_names.len() * core::mem::size_of::<Box<[u8]>>()
    }

    pub(crate) fn write_vlqs<W: bun_io::Write + ?Sized>(
        &self,
        writer: &mut W,
    ) -> bun_io::Result<()> {
        if let Some(ism) = &self.internal {
            let mut buf = bun_core::MutableString::init_empty();
            ism.append_vlq_to(&mut buf);
            writer.write_all(buf.list.as_slice())?;
            return Ok(());
        }
        let mut last_col: i32 = 0;
        let mut last_src: i32 = 0;
        let mut last_ol: i32 = 0;
        let mut last_oc: i32 = 0;
        let mut current_line: i32 = 0;
        debug_assert_eq!(
            self.mappings.generated().len(),
            self.mappings.original().len()
        );
        debug_assert_eq!(
            self.mappings.generated().len(),
            self.mappings.source_index().len()
        );
        for (i, ((gn, orig), source_index)) in self
            .mappings
            .generated()
            .iter()
            .zip(self.mappings.original())
            .zip(self.mappings.source_index())
            .enumerate()
        {
            if current_line != gn.lines.zero_based() {
                debug_assert!(gn.lines.zero_based() > current_line);
                let inc = gn.lines.zero_based() - current_line;
                writer.splat_byte_all(b';', usize::try_from(inc).expect("int cast"))?;
                current_line = gn.lines.zero_based();
                last_col = 0;
            } else if i != 0 {
                writer.write_byte(b',')?;
            }
            writer.write_all(VLQ::encode(gn.columns.zero_based() - last_col).slice())?;
            last_col = gn.columns.zero_based();
            writer.write_all(VLQ::encode(*source_index - last_src).slice())?;
            last_src = *source_index;
            writer.write_all(VLQ::encode(orig.lines.zero_based() - last_ol).slice())?;
            last_ol = orig.lines.zero_based();
            writer.write_all(VLQ::encode(orig.columns.zero_based() - last_oc).slice())?;
            last_oc = orig.columns.zero_based();
        }
        Ok(())
    }

    pub fn format_vlqs(&self) -> VlqsFmt<'_> {
        VlqsFmt(self)
    }
}

pub struct VlqsFmt<'a>(&'a ParsedSourceMap);

impl<'a> fmt::Display for VlqsFmt<'a> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut adapter = bun_io::FmtAdapter::new(f);
        self.0.write_vlqs(&mut adapter).map_err(|_| fmt::Error)
    }
}
