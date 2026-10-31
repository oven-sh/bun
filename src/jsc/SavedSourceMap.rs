#![warn(unused_must_use)]

use core::ffi::c_void;
use core::sync::atomic::{AtomicU8, AtomicUsize, Ordering};
use std::collections::VecDeque;
use std::sync::{Arc, OnceLock};

use bun_collections::{HashMap, IdentityContext, TaggedPtrUnion};
use bun_core::MutableString;
use bun_core::Ordinal;
use bun_core::StringView;
use bun_ptr::tagged_pointer::TagType;
use bun_sourcemap::parsed_source_map::AnySourceProvider;
use bun_sourcemap::{self as SourceMap, InternalSourceMap, ParsedSourceMap};
use bun_threading::Mutex;
use bun_wyhash::hash;

#[derive(Default)]
pub struct SavedSourceMap {
    /// Only accessed between [`Self::lock`] and [`Self::unlock`].
    map: HashTable,
    /// Keys in `map` of generated code's source maps, oldest first. A key can outlive its entry. Locked like `map`.
    generated_code: VecDeque<u64>,
    mutex: Mutex,
    /// A [`SourceMapsSupport`] as the bits of one word, so a reader on another thread never sees two calls mixed.
    source_maps_support: AtomicU8,
}

/// Must exceed the generated texts of one stack: a reader notes all frames, then looks them up. A dropped text is noted again.
const MAX_GENERATED_CODE_SOURCE_MAPS: usize = 128;

/// What `module.getSourceMapsSupport()` answers. `BunSourceMapsSupport` in headers-handwritten.h mirrors it.
#[repr(C)]
#[derive(Clone, Copy)]
pub struct SourceMapsSupport {
    pub enabled: bool,
    pub node_modules: bool,
    pub generated_code: bool,
}

impl SourceMapsSupport {
    const ENABLED: u8 = 1 << 0;
    const NODE_MODULES: u8 = 1 << 1;
    const GENERATED_CODE: u8 = 1 << 2;

    /// `--enable-source-maps` and `process.setSourceMapsEnabled()` set the three alike, as Node does.
    pub const fn all(enabled: bool) -> Self {
        Self {
            enabled,
            node_modules: enabled,
            generated_code: enabled,
        }
    }

    const fn to_bits(self) -> u8 {
        let mut bits = 0;
        if self.enabled {
            bits |= Self::ENABLED;
        }
        if self.node_modules {
            bits |= Self::NODE_MODULES;
        }
        if self.generated_code {
            bits |= Self::GENERATED_CODE;
        }
        bits
    }

    const fn from_bits(bits: u8) -> Self {
        Self {
            enabled: bits & Self::ENABLED != 0,
            node_modules: bits & Self::NODE_MODULES != 0,
            generated_code: bits & Self::GENERATED_CODE != 0,
        }
    }
}

impl SavedSourceMap {
    pub fn source_maps_support(&self) -> SourceMapsSupport {
        SourceMapsSupport::from_bits(self.source_maps_support.load(Ordering::SeqCst))
    }

    /// Whether `support` is another setting than the one it replaces.
    pub fn set_source_maps_support(&self, support: SourceMapsSupport) -> bool {
        let bits = support.to_bits();
        self.source_maps_support.swap(bits, Ordering::SeqCst) != bits
    }
}

impl SourceMapsSupport {
    /// Node.js asks this when a module loads and again at each lookup: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map_cache.js#L159-L169
    fn applies_to(self, path: &[u8]) -> bool {
        self.enabled && self.includes(path)
    }

    /// The `nodeModules` half of [`Self::applies_to`], which is all of it that `module.findSourceMap()` asks.
    fn includes(self, path: &[u8]) -> bool {
        self.node_modules || !bun_paths::strings::path_contains_node_modules_folder(path)
    }
}

/// The file that a reader of a stack position wants the position in. `BunPositionSpace` in headers-handwritten.h mirrors it.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PositionSpace {
    /// The file that was loaded. A `CallSite`, coverage, an inline snapshot and a profile are about that file.
    Loaded = 0,
    /// What the loaded file was made from. The same as `Loaded` unless the file has its own source map and the switch is on.
    Original = 1,
}

impl SavedSourceMap {
    #[inline]
    pub(crate) fn lock(&mut self) {
        self.mutex.lock();
        self.map.unlock_pointers();
    }

    #[inline]
    pub(crate) fn unlock(&mut self) {
        self.map.lock_pointers();
        self.mutex.unlock();
    }
}

/// `InternalSourceMap` is the storage for runtime-transpiled modules.
/// `AnySourceProvider` (boxed — the box is table-owned, the provider FFI
/// handle inside it borrowed) is a registered lazy external source provider.
/// `ParsedSourceMap` is materialized lazily from such a provider for sources
/// that ship their own external `.map`.
/// `ChainedSourceMap` is a text with the source map that it names for itself, see [`SavedSourceMap::put_mappings`].
pub(crate) type Value = TaggedPtrUnion<ValueTypes>;

/// Local type-list marker so `TypeList`/`UnionMember` impls satisfy orphan
/// rules — `bun_ptr::impl_tagged_ptr_union!` would impl on a tuple of foreign
/// types (three of the four members live in `bun_sourcemap`), which the coherence
/// checker rejects from this crate. Tags are `1024 - i`.
pub(crate) struct ValueTypes;

impl bun_ptr::tagged_pointer::TypeList for ValueTypes {}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for ParsedSourceMap {
    const TAG: TagType = 1024;
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for AnySourceProvider {
    const TAG: TagType = 1023;
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for InternalSourceMap {
    const TAG: TagType = 1022;
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for ChainedSourceMap {
    const TAG: TagType = 1021;
}

/// Two maps in a row: `loaded` goes from what runs to the text that was loaded, and `text` from there to what that was made from.
pub struct ChainedSourceMap {
    loaded: LoadedText,
    /// The text's own source map as it was at load. As in Node.js, what the map file becomes later changes no stack trace.
    text: OwnSourceMapText,
    /// What a relative entry of `sources` is beside: the map file, or for a `data:` URL the text, whose name can be a URL.
    sources_relative_to: Box<[u8]>,
    /// `text` parsed, by the first reader that asks for an original position. `None`: `text` is no usable map.
    original: OnceLock<Option<Arc<ParsedSourceMap>>>,
}

/// How a position in what runs becomes one in the text that was loaded.
enum LoadedText {
    /// A module that Bun transpiled: the printer's blob, in the shell that `get_with_content` hands out.
    Printed(Arc<ParsedSourceMap>),
    /// What `Module.prototype._compile` was given. It runs behind `first_line_column` columns of CommonJS wrapper on its first line.
    Compiled { first_line_column: i32 },
    /// What `eval()` or the `Function` constructor was given. `source` is its JavaScriptCore source provider's ID: texts can share a URL.
    Generated { source: AtomicUsize },
}

enum OwnSourceMapText {
    /// What the file that the `sourceMappingURL` comment names had in it.
    Json(Vec<u8>),
    /// The `data:` URL of the comment.
    DataUrl(Box<[u8]>),
}

impl ChainedSourceMap {
    /// The JSON of the module's own source map. `arena` has what a `data:` URL decodes to. `None`: the URL has none.
    pub fn json<'a>(&'a self, arena: &'a bun_alloc::Arena) -> Option<&'a [u8]> {
        match &self.text {
            OwnSourceMapText::Json(json) => Some(json),
            OwnSourceMapText::DataUrl(url) => SourceMap::json_of_data_url_for_node(arena, url).ok(),
        }
    }

    /// The URL that [`source_url`] resolves a relative one of the map's `sources` against.
    pub fn sources_base(&self) -> bun_core::String {
        if url_scheme(&self.sources_relative_to).is_some() {
            return bun_core::String::clone_utf8(&self.sources_relative_to);
        }
        bun_url::file_url_from_string(&StringView::from_bytes(&self.sources_relative_to))
    }

    /// The printer's map of a module that Bun transpiled, which readers of the loaded file use.
    fn printed(&self) -> Option<&Arc<ParsedSourceMap>> {
        match &self.loaded {
            LoadedText::Printed(map) => Some(map),
            LoadedText::Compiled { .. } | LoadedText::Generated { .. } => None,
        }
    }

    fn is_generated_code(&self) -> bool {
        matches!(self.loaded, LoadedText::Generated { .. })
    }

    /// Whether `other` takes the place of this in the table. The name of a module stays with the module.
    fn yields_to(&self, other: &ChainedSourceMap) -> bool {
        match self.loaded {
            LoadedText::Printed(_) => false,
            LoadedText::Compiled { .. } => matches!(other.loaded, LoadedText::Compiled { .. }),
            LoadedText::Generated { .. } => true,
        }
    }

    /// Where `line` and `column` of text that runs as it was loaded are in that text.
    fn without_wrapper(&self, line: Ordinal, column: Ordinal) -> (Ordinal, Ordinal) {
        match self.loaded {
            LoadedText::Compiled { first_line_column } if line.zero_based() == 0 => (
                line,
                Ordinal::from_zero_based(
                    column.zero_based().saturating_sub(first_line_column).max(0),
                ),
            ),
            _ => (line, column),
        }
    }

    /// `line` and `column` are as a `CallSite` has them: in the loaded file for a module that Bun printed, in what runs for other text.
    fn original_position_of_call_site(
        &self,
        line: Ordinal,
        column: Ordinal,
    ) -> Option<(&Arc<ParsedSourceMap>, SourceMap::Mapping)> {
        let (line, column) = self.without_wrapper(line, column);
        self.original_position(line, column)
    }

    fn is_of_generated_code(&self, source: usize, source_mapping_url: &bun_core::String) -> bool {
        let LoadedText::Generated { source: noted } = &self.loaded else {
            return false;
        };
        if noted.load(Ordering::SeqCst) == source {
            return true;
        }
        // The same text compiled again has another source provider.
        let OwnSourceMapText::DataUrl(url) = &self.text else {
            return false;
        };
        if !source_mapping_url.eql_utf8(url) {
            return false;
        }
        noted.store(source, Ordering::SeqCst);
        true
    }

    fn parse(&self, hint: SourceMap::ParseUrlResultHint) -> Option<SourceMap::ParseUrl> {
        let base = self.sources_base();
        let resolve_source = |source: &[u8]| shown_source_name(&base, source);
        let policy = SourceMap::ParsePolicy::Node {
            resolve_source: &resolve_source,
        };
        match &self.text {
            OwnSourceMapText::Json(json) => SourceMap::parse_json(json, hint, policy),
            OwnSourceMapText::DataUrl(url) => {
                SourceMap::parse_url(&bun_alloc::Arena::new(), url, hint, policy)
            }
        }
        .ok()
    }

    /// No file is read here: this can run on the heap collector thread, with the world stopped.
    fn original(&self) -> Option<&Arc<ParsedSourceMap>> {
        self.original
            .get_or_init(|| {
                self.parse(SourceMap::ParseUrlResultHint::MappingsOnly)
                    .and_then(|parsed| parsed.map)
            })
            .as_ref()
    }

    /// `line` and `column` are a position in the file that was loaded. `None`: the module's own map has nothing there.
    fn original_position(
        &self,
        line: Ordinal,
        column: Ordinal,
    ) -> Option<(&Arc<ParsedSourceMap>, SourceMap::Mapping)> {
        let original = self.original()?;
        let mapping = original.find_mapping(line, column)?;
        let name = usize::try_from(mapping.source_index)
            .ok()
            .and_then(|index| original.external_source_names.get(index))?;
        (!name.is_empty()).then_some((original, mapping))
    }

    /// `line` and `column` are a position in what runs. `None`: nothing maps that position.
    fn resolve(
        &self,
        line: Ordinal,
        column: Ordinal,
        source_handling: SourceMap::SourceContentHandling,
    ) -> Option<SourceMap::mapping::Lookup> {
        let printed = match self.printed() {
            Some(map) => Some((map, map.find_mapping(line, column)?)),
            None => None,
        };
        let (loaded_line, loaded_column) = match &printed {
            Some((_, loaded)) => (loaded.original.lines, loaded.original.columns),
            None => self.without_wrapper(line, column),
        };
        let Some((original, mapping)) = self.original_position(loaded_line, loaded_column) else {
            // Where the module's own map has nothing, the position stays in the file that was loaded.
            let (map, loaded) = printed?;
            return Some(SourceMap::mapping::Lookup {
                mapping: loaded,
                source_map: Some(Arc::clone(map)),
                prefetched_source_code: None,
                loaded: None,
            });
        };
        Some(SourceMap::mapping::Lookup {
            mapping,
            source_map: Some(Arc::clone(original)),
            prefetched_source_code: match source_handling {
                SourceMap::SourceContentHandling::NoSourceContents => None,
                SourceMap::SourceContentHandling::SourceContents => {
                    u32::try_from(mapping.source_index)
                        .ok()
                        .and_then(|index| {
                            self.parse(SourceMap::ParseUrlResultHint::SourceOnly(index))
                        })
                        .and_then(|parsed| parsed.source_contents)
                }
            },
            // Text that Bun did not print is no file that a reader can show lines of: JavaScriptCore has it.
            loaded: printed.map(|(_, loaded)| loaded.original),
        })
    }
}

/// The name Node.js shows for `source`, a `sources` entry after its `sourceRoot`: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map_cache.js#L325-L337
fn shown_source_name(base: &bun_core::String, source: &[u8]) -> Box<[u8]> {
    if bun_paths::is_absolute(source) {
        return resolved_absolute_source(source);
    }
    let url = bun_url::join(base, &StringView::from_bytes(source));
    let shown = if url.starts_with_ascii(b"file:") {
        bun_url::path_from_file_url(&url)
    } else {
        url
    };
    if shown.is_dead() {
        return Box::default();
    }
    Box::from(shown.to_utf8().slice())
}

/// The URL that Node.js writes for `source` in the `sources` of the map that it keeps. It is dead if there is none.
pub fn source_url(base: &bun_core::String, source: &[u8]) -> bun_core::String {
    if bun_paths::is_absolute(source) {
        return bun_url::file_url_from_string(&StringView::from_bytes(&resolved_absolute_source(
            source,
        )));
    }
    bun_url::join(base, &StringView::from_bytes(source))
}

/// An absolute `source` is a path, which Node.js resolves as `path.resolve()` does.
fn resolved_absolute_source(source: &[u8]) -> Box<[u8]> {
    let mut buf = bun_paths::path_buffer_pool::get();
    let normalized = bun_paths::resolve_path::join_abs_string_buf_checked::<
        bun_paths::platform::Auto,
    >(source, &mut buf[..], &[source]);
    Box::from(normalized.unwrap_or(source))
}

/// The scheme of `name` if Node.js takes `name` for a URL and not for a path: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map_cache.js#L43
pub fn url_scheme(name: &[u8]) -> Option<&[u8]> {
    let scheme = &name[..bun_core::strings::index_of(name, b"://")?];
    let is_word = |byte: &u8| byte.is_ascii_alphanumeric() || *byte == b'_';
    (!scheme.is_empty() && scheme.iter().all(is_word)).then_some(scheme)
}

/// `name`, which is no URL, as the path that Node.js makes a `file:` URL of: `path.resolve()` in the working directory.
pub fn resolved_path(name: &[u8]) -> Vec<u8> {
    let cwd = bun_core::working_directory_in_executable()
        .unwrap_or_else(|| bun_paths::fs::FileSystem::instance().top_level_dir());
    // `name` can have any length, so a buffer of the pool may be too short.
    let mut buf = vec![0u8; cwd.len() + name.len() + 2];
    bun_paths::resolve_path::join_abs_string_buf::<bun_paths::platform::Auto>(
        cwd,
        &mut buf,
        &[name],
    )
    .to_vec()
}

/// What the file at `path` has in it, if it is a regular file: a `sourceMappingURL` comment can name anything.
fn read_source_map_file(path: &[u8]) -> Option<Vec<u8>> {
    // NONBLOCK: a FIFO must not block the open. On Windows it would make the handle overlapped.
    #[cfg(unix)]
    let flags = bun_sys::O::RDONLY | bun_sys::O::NONBLOCK;
    #[cfg(not(unix))]
    let flags = bun_sys::O::RDONLY;
    let file = bun_sys::File::openat(bun_sys::Fd::cwd(), path, flags, 0).ok()?;
    if file.kind().ok()? != bun_sys::FileKind::File {
        return None;
    }
    file.read_to_end().ok()
}

/// What the `sourceMappingURL` comment at `url` in `source` names, and the file that its relative `sources` are beside.
fn read_own_source_map(
    source: &bun_ast::Source,
    url: bun_ast::Range,
    support: SourceMapsSupport,
) -> Option<(OwnSourceMapText, Box<[u8]>)> {
    let is_file = source.path.namespace.is_empty() || source.path.namespace == b"file";
    if url.len <= 0 || !is_file {
        return None;
    }
    let start = usize::try_from(url.loc.start).ok()?;
    let end = start.checked_add(usize::try_from(url.len).ok()?)?;
    read_source_map_named(
        source.path.text,
        source.contents().get(start..end)?,
        support,
    )
}

/// Like Node.js, this reads a `data:` URL or a path, which is a URL relative to the module, and reports nothing: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map_cache.js#L237-L255
fn read_source_map_named(
    path: &[u8],
    url: &[u8],
    support: SourceMapsSupport,
) -> Option<(OwnSourceMapText, Box<[u8]>)> {
    if !bun_paths::is_absolute(path) || !support.applies_to(path) {
        return None;
    }

    if bun_core::strings::has_prefix_case_insensitive(url, b"data:") {
        return Some((OwnSourceMapText::DataUrl(Box::from(url)), Box::from(path)));
    }
    if bun_url::whatwg::Parsed::from_utf8(url).is_some() {
        return None;
    }
    let module_url = bun_url::file_url_from_string(&StringView::from_bytes(path));
    let map_url = bun_url::join(&module_url, &StringView::from_bytes(url));
    if !map_url.starts_with_ascii(b"file:") {
        return None;
    }
    let map_path = bun_url::path_from_file_url(&map_url);
    if map_path.is_dead() || map_path.is_empty() {
        return None;
    }
    let map_path = map_path.to_utf8();
    let json = read_source_map_file(map_path.slice())?;
    Some((OwnSourceMapText::Json(json), Box::from(map_path.slice())))
}

impl SavedSourceMap {
    /// Releases whatever ownership a table value carries: the table's strong
    /// ref for a `ParsedSourceMap` or a `ChainedSourceMap`, the blob for an `InternalSourceMap`, or
    /// the box for an `AnySourceProvider` (whose provider FFI handle is
    /// borrowed and stays with its owner; see [`Self::put_source_provider`]).
    ///
    /// # Safety
    /// `value` must have been stored in the table by us, be live, and not be
    /// released again.
    unsafe fn release_value(value: Value) {
        if let Some(parsed) = value.get::<ParsedSourceMap>() {
            // SAFETY: per fn contract — the table held one strong ref.
            unsafe { ParsedSourceMap::deref(parsed) };
        } else if let Some(ism) = value.get::<InternalSourceMap>() {
            // The blob was heap-allocated via `put_mappings`
            // (`Box<[u8]>::into_raw`); the tagged pointer's address IS the
            // blob's data pointer (InternalSourceMap is a thin view).
            (InternalSourceMap {
                data: ism as *const u8,
            })
            .free_owned();
        } else if let Some(provider) = value.get::<AnySourceProvider>() {
            // SAFETY: the box was allocated by `put_source_provider`.
            unsafe { bun_core::heap::destroy(provider) };
        } else if let Some(chained) = value.get::<ChainedSourceMap>() {
            // SAFETY: per fn contract — `put_mappings` or `put_unprinted` stored it with `Arc::into_raw`.
            unsafe { Arc::decrement_strong_count(chained.cast_const()) };
        }
    }
}

/// Thin forwarder to the leaf-crate state in
/// `bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo` so the path
/// recorded here is the same one `run_command` prints.
pub(crate) mod missing_source_map_note_info {
    #[inline]
    pub(super) fn record(path: &[u8]) {
        bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo::set_path(path);
    }
}

impl SavedSourceMap {
    /// Registers a lazy external source provider for `path`, replacing any
    /// existing entry. The provider FFI handle is borrowed — its owner
    /// unregisters it via [`Self::remove_source_provider`] before freeing it —
    /// while the box holding the erased pair is owned by the table and freed
    /// by [`Self::release_value`] on replace / remove / drop.
    pub fn put_source_provider(&mut self, provider: AnySourceProvider, path: &[u8]) {
        let boxed = bun_core::heap::into_raw(Box::new(provider));
        // bun.handleOom → drop wrapper; Rust HashMap insert aborts on OOM.
        if self.put_value(path, Value::init(boxed)).is_err() {
            // SAFETY: the failed insert did not consume `boxed`.
            unsafe { bun_core::heap::destroy(boxed) };
        }
    }

    /// Drops the entry for `path` if it still refers to
    /// `opaque_source_provider` — either as a registered provider entry, or
    /// as a `ParsedSourceMap` materialized from that provider.
    pub fn remove_source_provider(&mut self, opaque_source_provider: *mut c_void, path: &[u8]) {
        self.lock();
        // Note: reshaped for borrowck — explicit unlock paired manually.
        // `get`+`remove(&key)`: the std
        // backing has no key-slot pointer to hand out, and the key is a u64 hash
        // we already have in hand.
        let key = hash(path);
        let Some(&ptr) = self.map.get(&key) else {
            self.unlock();
            return;
        };
        let old_value = Value::from(Some(ptr));
        let refers_to_provider = if let Some(provider) = old_value.get::<AnySourceProvider>() {
            // SAFETY: the box was stored by `put_source_provider` and is live
            // while in the table.
            core::ptr::eq(unsafe { (*provider).ptr() }, opaque_source_provider)
        } else if let Some(parsed) = old_value.get::<ParsedSourceMap>() {
            // SAFETY: `parsed` was stored by us and is live while in the table.
            unsafe { (*parsed).underlying_provider }
                .provider()
                .is_some_and(|prov| core::ptr::eq(prov.ptr(), opaque_source_provider))
        } else {
            false
        };
        if refers_to_provider {
            self.map.remove(&key);
            // SAFETY: `old_value` was stored by us; the table's ownership of
            // it ends here.
            unsafe { Self::release_value(old_value) };
        }
        self.unlock();
    }
}

// Keys are
// already wyhash u64s, so use the passthrough hasher; `bun_collections`'
// zig_hash_map uses an 80% max load factor.
type HashTable = HashMap<u64, *mut c_void, IdentityContext<u64>>;

impl bun_js_printer::OnSourceMapChunk for SavedSourceMap {
    fn on_source_map_chunk(
        &mut self,
        chunk: SourceMap::Chunk,
        source: &bun_ast::Source,
        source_mapping_url: bun_ast::Range,
    ) -> bun_js_printer::Result<()> {
        self.put_mappings(source, chunk.buffer, source_mapping_url)
    }
}

impl Drop for SavedSourceMap {
    fn drop(&mut self) {
        self.lock();
        for val in self.map.values() {
            let value = Value::from(Some(*val));
            // SAFETY: values were stored by us and are live until table
            // teardown.
            unsafe { Self::release_value(value) };
        }
        self.unlock();
    }
}

impl SavedSourceMap {
    /// `source_mapping_url` is `Ast::source_mapping_url` of `source`, from the parse or from the transpiler cache.
    pub fn put_mappings(
        &mut self,
        source: &bun_ast::Source,
        mut mappings: MutableString,
        source_mapping_url: bun_ast::Range,
    ) -> bun_js_printer::Result<()> {
        // Readers trust a stored blob's header, so validate it here.
        if !InternalSourceMap::is_valid_blob(mappings.list.as_slice()) {
            return Ok(());
        }

        // --hot can re-read a file mid-rewrite (truncate + write) and transpile
        // a comment-only prefix into a 0-mapping map. Overwriting a real map
        // with that would make any still-unreported error from the previous
        // transpile remap against nothing and leak transpiled coords. A map
        // with no mappings can never answer a lookup, so dropping it is never
        // worse than installing it.
        let incoming = InternalSourceMap {
            data: mappings.list.as_ptr(),
        };
        let has_mappings = incoming.mapping_count() != 0;
        if !has_mappings {
            self.lock();
            let contains = self.map.contains_key(&hash(source.path.text));
            self.unlock();
            if contains {
                return Ok(());
            }
        }

        // Outside the table's lock: this reads a file.
        let support = self.source_maps_support();
        let own_source_map = if support.enabled && has_mappings {
            read_own_source_map(source, source_mapping_url, support)
        } else {
            None
        };

        // Note: every caller MOVES an owned
        // `Vec<u8>` here (printer chunk by value, cache hit via `mem::take`),
        // so `into_boxed_slice()` transfers the existing allocation without
        // re-alloc+memcpy (1.38 MB for `_tsc.js`'s cached map). `heap::alloc`
        // is NOT a leak: ownership transfers to the table via `put_value`, and
        // is reclaimed by `InternalSourceMap::free_owned` (see `put_value` /
        // `Drop`), also on the error path.
        let blob: Box<[u8]> = core::mem::take(&mut mappings.list).into_boxed_slice();
        let blob_ptr: *mut [u8] = bun_core::heap::into_raw(blob);
        let value = match own_source_map {
            None => Value::init(blob_ptr.cast::<c_void>().cast::<InternalSourceMap>()),
            Some((text, sources_relative_to)) => {
                Value::init(Arc::into_raw(Arc::new(ChainedSourceMap {
                    loaded: LoadedText::Printed(Arc::new(ParsedSourceMap::from_internal(
                        InternalSourceMap {
                            data: blob_ptr.cast::<u8>(),
                        },
                    ))),
                    text,
                    sources_relative_to,
                    original: OnceLock::new(),
                })))
            }
        };
        // errdefer: on error, release what the table did not take.
        match self.put_value(source.path.text, value) {
            Ok(()) => Ok(()),
            Err(e) => {
                // SAFETY: `value` was made just above and was not consumed.
                unsafe { Self::release_value(value) };
                Err(e)
            }
        }
    }

    /// Frames name `url`, and `_compile` was given `path`. Node.js finds the map under both: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/modules/cjs/loader.js#L1806-L1811
    pub fn put_source_map_of_compiled_text(
        &mut self,
        url: &[u8],
        path: &[u8],
        source_mapping_url: &[u8],
        first_line_column: i32,
    ) {
        // Outside the table's lock: this reads a file.
        let Some((text, sources_relative_to)) =
            read_source_map_named(path, source_mapping_url, self.source_maps_support())
        else {
            return;
        };
        let record = Arc::new(ChainedSourceMap {
            loaded: LoadedText::Compiled { first_line_column },
            text,
            sources_relative_to,
            original: OnceLock::new(),
        });
        if url != path {
            self.put_unprinted(path, Arc::clone(&record));
        }
        self.put_unprinted(url, record);
    }

    /// Can run on the heap collector thread: no file is read, only a `data:` URL. Node.js v26.3.0 reads a file too, and does not read `generatedCode`.
    pub fn note_generated_source_map(
        &mut self,
        url: &[u8],
        source_mapping_url: &bun_core::String,
        source: usize,
    ) {
        let support = self.source_maps_support();
        if !support.enabled || !support.generated_code {
            return;
        }
        // Node.js has no source map for a builtin module: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map_cache.js#L377-L380
        if url.starts_with(b"node:") || url.starts_with(b"bun:") {
            return;
        }

        self.lock();
        let named = self.map.get(&hash(url)).map(|&value| {
            // SAFETY: the table is locked, and `value` is in it.
            unsafe { Self::chained_in(Value::from(Some(value))) }
        });
        self.unlock();
        match named {
            None => {}
            Some(Some(noted)) if noted.is_generated_code() => {
                if noted.is_of_generated_code(source, source_mapping_url) {
                    return;
                }
            }
            // The name is the name of a module, and the position of a frame is mapped once.
            Some(_) => return,
        }

        let source_mapping_url = source_mapping_url.to_utf8();
        if !bun_core::strings::has_prefix_case_insensitive(source_mapping_url.slice(), b"data:") {
            return;
        }
        // As in Node.js, a name with no scheme is a path: https://github.com/nodejs/node/blob/v26.3.0/lib/internal/source_map/source_map_cache.js#L105-L121
        let sources_relative_to: Box<[u8]> = match url_scheme(url) {
            Some(_) => Box::from(url),
            None => resolved_path(url).into_boxed_slice(),
        };
        if !support.includes(&sources_relative_to) {
            return;
        }
        self.put_unprinted(
            url,
            Arc::new(ChainedSourceMap {
                loaded: LoadedText::Generated {
                    source: AtomicUsize::new(source),
                },
                text: OwnSourceMapText::DataUrl(Box::from(source_mapping_url.slice())),
                sources_relative_to,
                original: OnceLock::new(),
            }),
        );
    }

    fn put_unprinted(&mut self, url: &[u8], record: Arc<ChainedSourceMap>) {
        use bun_collections::zig_hash_map::MapEntry as Entry;

        let key = hash(url);
        self.lock();
        match self.map.entry(key) {
            Entry::Occupied(mut o) => {
                let old_value = Value::from(Some(*o.get()));
                // SAFETY: `old_value` was stored by us and is live while locked.
                let yields = old_value
                    .get::<ChainedSourceMap>()
                    .is_some_and(|old| unsafe { (*old).yields_to(&record) });
                if yields {
                    // SAFETY: the table's ownership of `old_value` ends here.
                    unsafe { Self::release_value(old_value) };
                    *o.get_mut() = Value::init(Arc::into_raw(record)).ptr();
                }
            }
            Entry::Vacant(v) => {
                let is_generated_code = record.is_generated_code();
                v.insert(Value::init(Arc::into_raw(record)).ptr());
                if is_generated_code {
                    self.generated_code.push_back(key);
                    if self.generated_code.len() > MAX_GENERATED_CODE_SOURCE_MAPS {
                        self.forget_oldest_generated_code();
                    }
                }
            }
        }
        self.unlock();
    }

    /// The caller has locked the table.
    fn forget_oldest_generated_code(&mut self) {
        let Some(oldest) = self.generated_code.pop_front() else {
            return;
        };
        let Some(&value) = self.map.get(&oldest) else {
            return;
        };
        let value = Value::from(Some(value));
        // SAFETY: `value` was stored by us and is live while locked.
        let is_generated_code = value
            .get::<ChainedSourceMap>()
            .is_some_and(|chained| unsafe { (*chained).is_generated_code() });
        if is_generated_code {
            self.map.remove(&oldest);
            // SAFETY: the table's ownership of `value` ends here.
            unsafe { Self::release_value(value) };
        }
    }

    pub(crate) fn put_value(&mut self, path: &[u8], value: Value) -> bun_js_printer::Result<()> {
        use bun_collections::zig_hash_map::MapEntry as Entry;

        self.lock();
        // Note: reshaped for borrowck — explicit unlock paired manually.

        // `bun_collections::HashMap` derefs to `std::collections::HashMap`, so
        // the std `entry()` API is used directly.
        match self.map.entry(hash(path)) {
            Entry::Occupied(mut o) => {
                let old_value = Value::from(Some(*o.get()));
                // SAFETY: `old_value` was stored by us and is live until
                // replaced here.
                unsafe { Self::release_value(old_value) };
                *o.get_mut() = value.ptr();
            }
            Entry::Vacant(v) => {
                v.insert(value.ptr());
            }
        }
        self.unlock();
        Ok(())
    }

    /// You must call `sourcemap.map.deref()` or you will leak memory
    fn get_with_content(
        &mut self,
        path: &[u8],
        hint: SourceMap::ParseUrlResultHint,
    ) -> SourceMap::ParseUrl {
        let h = hash(path);

        // This lock is for the hash table
        self.lock();

        // This mapping entry is only valid while the mutex is locked
        let Some(mapping) = self.map.get_mut(&h) else {
            self.unlock();
            return SourceMap::ParseUrl::default();
        };

        let tagged = Value::from(Some(*mapping));
        let tag = tagged.tag();
        if tag == Value::case::<InternalSourceMap>() {
            // Runtime-transpiled module. Wrap the blob in a refcounted
            // ParsedSourceMap shell (no VLQ decode, no Mapping.List) so callers
            // can hold a ref while the table mutates. The shell takes ownership
            // of the blob.
            let ism = InternalSourceMap {
                data: tagged.as_unchecked::<InternalSourceMap>() as *const u8,
            };
            // Table holds one strong ref (leaked via `into_raw`); caller gets
            // the returned `Arc`.
            let result = Arc::new(ParsedSourceMap::from_internal(ism));
            *mapping = Value::init(Arc::into_raw(Arc::clone(&result))).ptr();
            self.unlock();
            return SourceMap::ParseUrl {
                map: Some(result),
                ..Default::default()
            };
        } else if tag == Value::case::<ParsedSourceMap>() {
            let parsed = tagged.as_unchecked::<ParsedSourceMap>();
            // SAFETY: pointer was stored by us via `Arc::into_raw` and is live
            // while locked. Bump the strong count for the caller's handle.
            let result = unsafe {
                Arc::increment_strong_count(parsed.cast_const());
                Arc::from_raw(parsed.cast_const())
            };
            self.unlock();
            return SourceMap::ParseUrl {
                map: Some(result),
                ..Default::default()
            };
        } else if let Some(chained) = tagged.get::<ChainedSourceMap>() {
            // SAFETY: it was stored with `Arc::into_raw`, and it is live while locked.
            let result = unsafe { (*chained).printed() }.map(Arc::clone);
            self.unlock();
            return SourceMap::ParseUrl {
                map: result,
                ..Default::default()
            };
        } else if let Some(provider) = tagged.get::<AnySourceProvider>() {
            // Copy the erased pair out while the lock is held: once unlocked,
            // a concurrent put/remove may free the box.
            // SAFETY: the box was stored by `put_source_provider` and is live
            // while in the table.
            let provider = unsafe { *provider };
            self.unlock();

            // Do not lock the mutex while we're parsing JSON!
            // The provider FFI handle is kept alive by its owner (JSC / the
            // registrar), which unregisters it before freeing; we did not
            // hold a ref.
            if let Some(parse) = provider.get_source_map(path, Default::default(), hint) {
                if let Some(ref parsed_map) = parse.map {
                    // The mutex is not locked. We have to check the hash table again.
                    // Leak one strong ref into the table; `put_value` releases
                    // the replaced provider box.
                    let _ =
                        self.put_value(path, Value::init(Arc::into_raw(Arc::clone(parsed_map))));

                    return parse;
                }
            }

            self.lock();
            // does not have a valid source map. let's not try again
            if let Some(removed) = self.map.remove(&h) {
                // SAFETY: whatever occupies the slot now was stored by us;
                // the table's ownership of it ends here.
                unsafe { Self::release_value(Value::from(Some(removed))) };
            }

            // Store path for a user note.
            missing_source_map_note_info::record(path);
            self.unlock();
            return SourceMap::ParseUrl::default();
        } else {
            if cfg!(debug_assertions) {
                panic!("Corrupt pointer tag");
            }
            self.unlock();

            return SourceMap::ParseUrl::default();
        }
    }

    /// You must `deref()` the returned value or you will leak memory
    pub fn get(&mut self, path: &[u8]) -> Option<std::sync::Arc<ParsedSourceMap>> {
        self.get_with_content(path, SourceMap::ParseUrlResultHint::MappingsOnly)
            .map
    }

    /// What `module.findSourceMap()` answers with. As in Node.js, a module that loaded with its own source map keeps it when the switch goes off.
    pub fn own_source_map(&mut self, path: &[u8]) -> Option<Arc<ChainedSourceMap>> {
        if !self.source_maps_support().includes(path) {
            return None;
        }
        // The table learns of the source map of generated code when a stack is read, which is not when Node.js does.
        self.get_chained(path)
            .filter(|chained| !chained.is_generated_code())
    }

    /// The entry for `path` if [`PositionSpace::Original`] readers go through it as the switch is now.
    fn get_applied(&mut self, path: &[u8]) -> Option<Arc<ChainedSourceMap>> {
        let support = self.source_maps_support();
        if !support.applies_to(path) {
            return None;
        }
        self.get_chained(path)
            .filter(|chained| match chained.loaded {
                // Generated code can name itself with a relative path, and Node.js looks at what that resolves to.
                LoadedText::Generated { .. } => {
                    support.generated_code && support.includes(&chained.sources_relative_to)
                }
                LoadedText::Printed(_) | LoadedText::Compiled { .. } => true,
            })
    }

    /// The entry for `path` if it is a text with its own source map.
    fn get_chained(&mut self, path: &[u8]) -> Option<Arc<ChainedSourceMap>> {
        self.lock();
        let chained = self.map.get(&hash(path)).and_then(|&value| {
            // SAFETY: the table is locked, and `value` is in it.
            unsafe { Self::chained_in(Value::from(Some(value))) }
        });
        self.unlock();
        chained
    }

    /// SAFETY: the table is locked, and `value` is in it.
    unsafe fn chained_in(value: Value) -> Option<Arc<ChainedSourceMap>> {
        let chained = value.get::<ChainedSourceMap>()?;
        // SAFETY: it was stored with `Arc::into_raw`, and it is live while locked. The count goes up for the
        // handle that leaves the lock.
        unsafe {
            Arc::increment_strong_count(chained.cast_const());
            Some(Arc::from_raw(chained.cast_const()))
        }
    }

    pub(crate) fn resolve_mapping(
        &mut self,
        path: &[u8],
        line: Ordinal,
        column: Ordinal,
        source_handling: SourceMap::SourceContentHandling,
        space: PositionSpace,
    ) -> Option<SourceMap::mapping::Lookup> {
        if space == PositionSpace::Original
            && let Some(chained) = self.get_applied(path)
        {
            return chained.resolve(line, column, source_handling);
        }

        let parse = self.get_with_content(
            path,
            match source_handling {
                SourceMap::SourceContentHandling::NoSourceContents => {
                    SourceMap::ParseUrlResultHint::MappingsOnly
                }
                SourceMap::SourceContentHandling::SourceContents => {
                    SourceMap::ParseUrlResultHint::All {
                        line: line.zero_based().max(0),
                        column: column.zero_based().max(0),
                        include_names: false,
                    }
                }
            },
        );
        let map = parse.map?;

        let mapping = match parse.mapping {
            Some(m) => m,
            // Pass `line`/`column` straight
            // through. `SourceMap::Ordinal` is a re-export of `bun_core::Ordinal`;
            // round-tripping via `from_zero_based(x.zero_based())` debug-asserts
            // on the legitimate INVALID (-1) sentinel.
            None => map.find_mapping(line, column)?,
        };

        Some(SourceMap::mapping::Lookup {
            mapping,
            source_map: Some(map),
            prefetched_source_code: parse.source_contents,
            loaded: None,
        })
    }

    /// [`PositionSpace::Original`] for a position that is in the loaded file already, as a `CallSite` has it. `None`: it stays there.
    pub(crate) fn resolve_loaded_mapping(
        &mut self,
        path: &[u8],
        line: Ordinal,
        column: Ordinal,
    ) -> Option<SourceMap::mapping::Lookup> {
        let chained = self.get_applied(path)?;
        let (original, mapping) = chained.original_position_of_call_site(line, column)?;
        Some(SourceMap::mapping::Lookup {
            mapping,
            source_map: Some(Arc::clone(original)),
            prefetched_source_code: None,
            loaded: Some(SourceMap::LineColumnOffset {
                lines: line,
                columns: column,
            }),
        })
    }
}
