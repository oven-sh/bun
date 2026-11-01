#![warn(unused_must_use)]

use core::ffi::c_void;
use core::sync::atomic::{AtomicU8, Ordering};
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

use crate::resolved_source::OwnSourceMapBinding;

#[derive(Default)]
pub struct SavedSourceMap {
    /// Only accessed between [`Self::lock`] and [`Self::unlock`].
    map: HashTable,
    mutex: Mutex,
    /// A [`SourceMapsSupport`] as the bits of one word, so a reader on another thread never sees two calls mixed.
    source_maps_support: AtomicU8,
}

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

    pub fn set_source_maps_support(&self, support: SourceMapsSupport) {
        self.source_maps_support
            .store(support.to_bits(), Ordering::SeqCst);
    }
}

impl SourceMapsSupport {
    /// Whether the own source map of the module at `path` is applied: Node.js asks when the module loads and again at each lookup, and leaves out a path with a `node_modules` directory unless `nodeModules` is set.
    pub(crate) fn applies_to(self, path: &[u8]) -> bool {
        self.enabled
            && (self.node_modules || !bun_paths::strings::path_contains_node_modules_folder(path))
    }
}

/// Which file a reader of a stack position wants the position in. `BunPositionSpace` in headers-handwritten.h mirrors it.
#[repr(u8)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PositionSpace {
    /// Through the maps that Bun wrote and no further: the file that was loaded, or what the sidecar map of a `// @bun` file names. A `CallSite`, coverage, an inline snapshot and a profile read this one.
    Loaded = 0,
    /// On through the own source map of a module that [`SavedSourceMap::put_mappings`] kept the URL of, while `process.sourceMapsEnabled` is on. Otherwise the same as `Loaded`. `Error.stack` and a printed error read this one.
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
/// `ChainedSourceMap` is a runtime-transpiled module with the URL of its own source map, see [`SavedSourceMap::put_mappings`].
pub(crate) type Value = TaggedPtrUnion<ValueTypes>;

/// Local type-list marker so `TypeList`/`UnionMember` impls satisfy orphan
/// rules — `bun_ptr::impl_tagged_ptr_union!` would impl on a tuple of foreign
/// types (all three members live in `bun_sourcemap`), which the coherence
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

/// A runtime-transpiled module whose source names a source map of its own, put in the table while `process.sourceMapsEnabled` was on.
pub(crate) struct ChainedSourceMap {
    /// The printer's blob in the shell that `get_with_content` hands out: from what runs to the file that was loaded.
    loaded: Arc<ParsedSourceMap>,
    /// From the file that was loaded to what that file was made from.
    own: OwnSourceMap,
}

/// The source map that a module's `sourceMappingURL` comment names.
pub(crate) struct OwnSourceMap {
    /// The URL of the comment.
    url: Box<[u8]>,
    /// The path of the module, which a relative `url` is beside.
    module: Box<[u8]>,
    /// The map, read and parsed by the first reader that asks for a position in it, which is when Node.js reads it. `None`: there is no usable map.
    parsed: OnceLock<Option<Arc<ParsedSourceMap>>>,
}

impl OwnSourceMap {
    /// Reads the map as Node.js does: `url` is a `data:` URL, or a path, which is a URL relative to the module. A `file:`, `http:` or other URL with a scheme names nothing, and nothing is reported.
    fn parse(&self, hint: SourceMap::ParseUrlResultHint) -> Option<SourceMap::ParseUrl> {
        let module_url = bun_url::file_url_from_string(&StringView::from_bytes(&self.module));
        // A collection can run this while a loader on the same thread walks an AST in the thread's store, which `parse_json` resets.
        let mut ast_memory_allocator = bun_ast::ASTMemoryAllocator::default();
        let _ast_scope = ast_memory_allocator.enter();

        if bun_core::strings::has_prefix_case_insensitive(&self.url, b"data:") {
            let resolve_source = |source: &[u8]| shown_source_name(&module_url, source);
            let policy = SourceMap::ParsePolicy::Node {
                resolve_source: &resolve_source,
            };
            return SourceMap::parse_url(&bun_alloc::Arena::new(), &self.url, hint, policy).ok();
        }
        if bun_url::whatwg::Parsed::from_utf8(&self.url).is_some() {
            return None;
        }
        let map_url = bun_url::join(&module_url, &StringView::from_bytes(&self.url));
        if !map_url.starts_with_ascii(b"file:") {
            return None;
        }
        let map_path = bun_url::path_from_file_url(&map_url);
        if map_path.is_dead() || map_path.is_empty() {
            return None;
        }
        let json = SourceMap::read_file_that_a_map_names(map_path.to_utf8().slice())?;
        // A relative `sources` entry is beside the map file.
        let resolve_source = |source: &[u8]| shown_source_name(&map_url, source);
        let policy = SourceMap::ParsePolicy::Node {
            resolve_source: &resolve_source,
        };
        SourceMap::parse_json(&json, hint, policy).ok()
    }

    /// Where `line` and `column` of the module's file are in what that file was made from, with the text of that source if `source_handling` asks for it. `None`: the map has nothing there. The first call reads a file and parses JSON, and a collection can be what calls it, on the collector thread or on the JS thread.
    fn lookup(
        &self,
        line: Ordinal,
        column: Ordinal,
        source_handling: SourceMap::SourceContentHandling,
    ) -> Option<SourceMap::mapping::Lookup> {
        // The parse that reads the map for a printed error gives the text of the source as well.
        let mut text_of_first_parse: Option<(i32, Option<Box<[u8]>>)> = None;
        let parsed = self
            .parsed
            .get_or_init(|| {
                let parse = self.parse(match source_handling {
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
                })?;
                if let Some(mapping) = &parse.mapping {
                    text_of_first_parse = Some((mapping.source_index, parse.source_contents));
                }
                parse.map
            })
            .as_ref()?;
        let mapping = parsed.find_mapping(line, column)?;
        let name = usize::try_from(mapping.source_index)
            .ok()
            .and_then(|index| parsed.external_source_names.get(index))?;
        if name.is_empty() {
            return None;
        }
        let text = match (source_handling, text_of_first_parse) {
            (SourceMap::SourceContentHandling::NoSourceContents, _) => None,
            (_, Some((index, text))) if index == mapping.source_index => text,
            _ => self.source_text(mapping.source_index),
        };
        Some(SourceMap::mapping::Lookup {
            mapping,
            source_map: Some(Arc::clone(parsed)),
            prefetched_source_code: text,
        })
    }

    /// The `sourcesContent` entry of the source at `index`. The map is read again: as for every map, a printed error does not keep the text.
    fn source_text(&self, index: i32) -> Option<Box<[u8]>> {
        self.parse(SourceMap::ParseUrlResultHint::SourceOnly(
            u32::try_from(index).ok()?,
        ))?
        .source_contents
    }
}

/// Whose text a printed error shows for a top frame that was renamed before, see [`SavedSourceMap::shown_source`].
pub(crate) enum ShownSource {
    /// No own source map that was read shows a source under the name.
    Unclaimed,
    /// More than one does and their texts differ, or the name is a module of the table too.
    Ambiguous,
    /// `map` shows its source at `source_index` under the name, and `text` is the `sourcesContent` entry.
    Claimed {
        map: Arc<ParsedSourceMap>,
        source_index: i32,
        text: Option<Box<[u8]>>,
    },
}

impl ChainedSourceMap {
    /// `line` and `column` are a position in what runs. `None`: the printer mapped nothing there.
    fn resolve(
        &self,
        line: Ordinal,
        column: Ordinal,
        source_handling: SourceMap::SourceContentHandling,
    ) -> Option<SourceMap::mapping::Lookup> {
        let loaded = self.loaded.find_mapping(line, column)?;
        // Where the module's own map has nothing, the position stays in the file that was loaded.
        self.own
            .lookup(
                loaded.original.lines,
                loaded.original.columns,
                source_handling,
            )
            .or_else(|| {
                Some(SourceMap::mapping::Lookup {
                    mapping: loaded,
                    source_map: Some(Arc::clone(&self.loaded)),
                    prefetched_source_code: None,
                })
            })
    }
}

/// The name Node.js shows for `source`, a `sources` entry after its `sourceRoot`, in a map at the URL `base`: a path for what resolves to a file, and the URL for anything else.
fn shown_source_name(base: &bun_core::String, source: &[u8]) -> Box<[u8]> {
    if bun_paths::is_absolute(source) {
        let mut buf = bun_paths::path_buffer_pool::get();
        let normalized = bun_paths::resolve_path::join_abs_string_buf_checked::<
            bun_paths::platform::Auto,
        >(source, &mut buf[..], &[source]);
        return Box::from(normalized.unwrap_or(source));
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

/// The URL at `url` in `contents`, if V8 takes a URL from the `//# sourceMappingURL=` comment that the lexer found there: only white space follows the URL on its line.
fn url_of_comment(contents: &[u8], url: bun_ast::Range) -> Option<&[u8]> {
    let start = usize::try_from(url.loc.start).ok()?;
    let end = start.checked_add(usize::try_from(url.len).ok()?)?;
    let text = contents.get(start..end).filter(|text| !text.is_empty())?;
    let rest_of_line = bun_core::strings::js_lines(&contents[end..]).next()?;
    bun_core::strings::is_all_js_whitespace(rest_of_line).then_some(text)
}

/// What [`SavedSourceMap::put_mappings`] does with the `sourceMappingURL` comment at `url` in `source` while the switch is `support`.
pub fn own_source_map_binding(
    source: &bun_ast::Source,
    url: bun_ast::Range,
    support: SourceMapsSupport,
) -> OwnSourceMapBinding {
    let path = source.path.text;
    let is_file = source.path.namespace.is_empty() || source.path.namespace == b"file";
    let has_url = url_of_comment(source.contents(), url).is_some();
    if !has_url || !is_file || !bun_paths::is_absolute(path) {
        OwnSourceMapBinding::None
    } else if support.applies_to(path) {
        OwnSourceMapBinding::Kept
    } else {
        OwnSourceMapBinding::NotKept
    }
}

/// The URL of the `sourceMappingURL` comment at `url` in `source`, if `support` asks for the own source map of that module.
fn own_source_map_url<'a>(
    source: &'a bun_ast::Source,
    url: bun_ast::Range,
    support: SourceMapsSupport,
) -> Option<&'a [u8]> {
    if own_source_map_binding(source, url, support) != OwnSourceMapBinding::Kept {
        return None;
    }
    url_of_comment(source.contents(), url)
}

impl SavedSourceMap {
    /// Releases whatever ownership a table value carries: the table's strong
    /// ref for a `ParsedSourceMap`, the blob for an `InternalSourceMap`, or
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
            // SAFETY: per fn contract — `put_mappings` stored it with `Arc::into_raw`.
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
    /// `source_mapping_url` is `Ast::source_mapping_url` of `source`, from the parse or from the transpiler cache, and `support` is the switch as the JS thread had it when it asked for the module. While the switch is on, the URL is kept with `mappings` for [`PositionSpace::Original`] readers. No file is read here.
    pub fn put_mappings(
        &mut self,
        source: &bun_ast::Source,
        mut mappings: MutableString,
        source_mapping_url: bun_ast::Range,
        support: SourceMapsSupport,
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

        let own_source_map_url = if support.enabled && has_mappings {
            own_source_map_url(source, source_mapping_url, support)
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
        let value = match own_source_map_url {
            None => Value::init(blob_ptr.cast::<c_void>().cast::<InternalSourceMap>()),
            Some(url) => Value::init(Arc::into_raw(Arc::new(ChainedSourceMap {
                loaded: Arc::new(ParsedSourceMap::from_internal(InternalSourceMap {
                    data: blob_ptr.cast::<u8>(),
                })),
                own: OwnSourceMap {
                    url: Box::from(url),
                    module: Box::from(source.path.text),
                    parsed: OnceLock::new(),
                },
            }))),
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
            // SAFETY: `put_mappings` stored it with `Arc::into_raw`, and it is live while locked.
            let result = Arc::clone(unsafe { &(*chained).loaded });
            self.unlock();
            return SourceMap::ParseUrl {
                map: Some(result),
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

    /// The own source map that shows a source as `name`. A printed error asks for a top frame that a read of `.stack` or a collection renamed: such a frame no longer says which module it is from.
    pub(crate) fn shown_source(&mut self, name: &[u8]) -> ShownSource {
        let mut claimants: Vec<(Arc<ChainedSourceMap>, i32)> = Vec::new();
        self.lock();
        let is_module = self.map.contains_key(&hash(name));
        for &value in self.map.values() {
            let Some(chained) = Value::from(Some(value)).get::<ChainedSourceMap>() else {
                continue;
            };
            // SAFETY: `put_mappings` stored it with `Arc::into_raw`, and it is live while locked. The count goes up for the handle that leaves the lock.
            let chained = unsafe {
                Arc::increment_strong_count(chained.cast_const());
                Arc::from_raw(chained.cast_const())
            };
            let index = match chained.own.parsed.get() {
                Some(Some(parsed)) => parsed
                    .external_source_names
                    .iter()
                    .position(|source| **source == *name),
                _ => None,
            };
            if let Some(index) = index.and_then(|index| i32::try_from(index).ok()) {
                claimants.push((chained, index));
            }
        }
        self.unlock();

        let Some((first, source_index)) = claimants.first() else {
            return ShownSource::Unclaimed;
        };
        let text = first.own.source_text(*source_index);
        let same_text = claimants[1..]
            .iter()
            .all(|(other, index)| other.own.source_text(*index) == text);
        match first.own.parsed.get() {
            Some(Some(map)) if !is_module && same_text => ShownSource::Claimed {
                map: Arc::clone(map),
                source_index: *source_index,
                text,
            },
            _ => ShownSource::Ambiguous,
        }
    }

    /// You must `deref()` the returned value or you will leak memory
    pub fn get(&mut self, path: &[u8]) -> Option<std::sync::Arc<ParsedSourceMap>> {
        self.get_with_content(path, SourceMap::ParseUrlResultHint::MappingsOnly)
            .map
    }

    /// The entry for `path` if it is a module with its own source map that `support` asks for.
    fn get_chained(
        &mut self,
        path: &[u8],
        support: SourceMapsSupport,
    ) -> Option<Arc<ChainedSourceMap>> {
        if !support.applies_to(path) {
            return None;
        }
        self.lock();
        let chained = self
            .map
            .get(&hash(path))
            .and_then(|&value| Value::from(Some(value)).get::<ChainedSourceMap>())
            .map(|chained| {
                // SAFETY: `put_mappings` stored it with `Arc::into_raw`, and it is live while locked. The count
                // goes up for the handle that leaves the lock.
                unsafe {
                    Arc::increment_strong_count(chained.cast_const());
                    Arc::from_raw(chained.cast_const())
                }
            });
        self.unlock();
        chained
    }

    pub(crate) fn resolve_mapping(
        &mut self,
        path: &[u8],
        line: Ordinal,
        column: Ordinal,
        source_handling: SourceMap::SourceContentHandling,
        space: PositionSpace,
    ) -> Option<SourceMap::mapping::Lookup> {
        if space == PositionSpace::Original {
            let support = self.source_maps_support();
            if support.enabled
                && let Some(chained) = self.get_chained(path, support)
            {
                return chained.resolve(line, column, source_handling);
            }
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
        })
    }
}
