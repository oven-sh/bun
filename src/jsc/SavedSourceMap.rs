#![warn(unused_must_use)]

use core::ffi::c_void;
use core::sync::atomic::{AtomicU8, Ordering};
use std::sync::Arc;

use bun_collections::{HashMap, IdentityContext, TaggedPtrUnion};
use bun_core::MutableString;
use bun_core::Ordinal;
use bun_ptr::tagged_pointer::TagType;
use bun_sourcemap::parsed_source_map::AnySourceProvider;
use bun_sourcemap::{self as SourceMap, InternalSourceMap, ParsedSourceMap};
use bun_threading::Mutex;
use bun_wyhash::hash;

#[derive(Default)]
pub struct SavedSourceMap {
    /// Only accessed between [`Self::lock`] and [`Self::unlock`].
    map: HashTable,
    mutex: Mutex,
    /// A [`SourceMapsSupport`] as bits, so a reader sees one whole write. Seeded from
    /// `--enable-source-maps` (a Worker inherits it with the flags of its parent), and set by
    /// `process.setSourceMapsEnabled()` and `module.setSourceMapsSupport()` for one VM.
    source_maps_support: AtomicU8,
}

/// What `module.getSourceMapsSupport()` answers. `BunSourceMapsSupport` in headers-handwritten.h mirrors it.
#[repr(C)]
#[derive(Clone, Copy, Default, PartialEq, Eq)]
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
        (self.enabled as u8 * Self::ENABLED)
            | (self.node_modules as u8 * Self::NODE_MODULES)
            | (self.generated_code as u8 * Self::GENERATED_CODE)
    }

    const fn from_bits(bits: u8) -> Self {
        Self {
            enabled: bits & Self::ENABLED != 0,
            node_modules: bits & Self::NODE_MODULES != 0,
            generated_code: bits & Self::GENERATED_CODE != 0,
        }
    }

    /// Whether the map of the module at `path` is kept for `module.findSourceMap()`: Node leaves
    /// out a path under `node_modules` unless `nodeModules` is set.
    pub fn applies_to(self, path: &[u8]) -> bool {
        self.enabled
            && (self.node_modules || !bun_paths::strings::path_contains_node_modules_folder(path))
    }
}

/// Whether the module at `path` is a file, which Node keeps a map of: not `bun -e` or stdin
/// (`[eval]` and `[stdin]` in the working directory) and not a URL such as `blob:`.
pub fn is_file_module(path: &[u8]) -> bool {
    bun_paths::is_absolute(path) && !is_eval_or_stdin(path)
}

/// The script of `bun -e` or of stdin. Node keeps no map of either, whatever the switch says.
pub fn is_eval_or_stdin(path: &[u8]) -> bool {
    let name = bun_paths::basename(path);
    name == b"[eval]" || name == b"[stdin]"
}

impl SavedSourceMap {
    pub fn source_maps_support(&self) -> SourceMapsSupport {
        SourceMapsSupport::from_bits(self.source_maps_support.load(Ordering::Relaxed))
    }

    pub fn set_source_maps_support(&self, support: SourceMapsSupport) {
        self.source_maps_support
            .store(support.to_bits(), Ordering::Relaxed);
    }

    /// Keeps the line lengths of the text that JSC compiled for the runtime-transpiled module at
    /// `path`, beside its map. `get_recorded` then answers for the module. Nothing is kept for a
    /// module whose map is not in the table, is not the runtime transpiler's (an external map,
    /// or one of the standalone module graph), or is of an earlier text of the module.
    pub fn record_line_lengths(&mut self, path: &[u8], line_lengths: Box<[u32]>) {
        let h = hash(path);
        self.lock();
        if let Some(slot) = self.map.get_mut(&h)
            && let Some(map) = Self::shell_locked(slot)
            && map.is_runtime_transpiled()
            && !map.text_changed.load(Ordering::Relaxed)
        {
            *map.line_lengths.lock() = Some(line_lengths);
        }
        self.unlock();
    }

    /// The map of the runtime-transpiled module at `path` whose text was compiled while source maps
    /// were enabled, with its line lengths. Reads no external map.
    pub fn get_recorded(&mut self, path: &[u8]) -> Option<Arc<ParsedSourceMap>> {
        let h = hash(path);
        self.lock();
        let map = self
            .map
            .get_mut(&h)
            .and_then(Self::shell_locked)
            .filter(|map| map.line_lengths.lock().is_some());
        self.unlock();
        map
    }

    /// The `Arc<ParsedSourceMap>` of a runtime-transpiled module's slot, with the blob of a
    /// fresh entry promoted to its shell as `get_with_content` does. `None` for an external map.
    /// The table holds one strong ref, the caller gets another.
    fn shell_locked(slot: &mut *mut c_void) -> Option<Arc<ParsedSourceMap>> {
        let tagged = Value::from(Some(*slot));
        if tagged.tag() == Value::case::<InternalSourceMap>() {
            let ism = InternalSourceMap {
                data: tagged.as_unchecked::<InternalSourceMap>() as *const u8,
            };
            let result = Arc::new(ParsedSourceMap::from_internal(ism));
            *slot = Value::init(Arc::into_raw(Arc::clone(&result))).ptr();
            return Some(result);
        }
        let parsed = tagged.get::<ParsedSourceMap>()?;
        // SAFETY: pointer was stored by us via `Arc::into_raw` and is live while locked.
        Some(unsafe {
            Arc::increment_strong_count(parsed.cast_const());
            Arc::from_raw(parsed.cast_const())
        })
    }
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
        self.put_value(path, Value::init(boxed));
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
    ) -> bun_js_printer::Result<()> {
        self.put_mappings(source, chunk.buffer)
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
    pub fn put_mappings(
        &mut self,
        source: &bun_ast::Source,
        mut mappings: MutableString,
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
        if incoming.mapping_count() == 0 {
            self.lock();
            let slot = self.map.get_mut(&hash(source.path.text));
            let contains = slot.is_some();
            if let Some(kept) = slot.and_then(Self::shell_locked) {
                // The map stays for the errors of the earlier text. `findSourceMap()` must not pair it with the text that runs now.
                kept.text_changed.store(true, Ordering::Relaxed);
                *kept.line_lengths.lock() = None;
            }
            self.unlock();
            if contains {
                return Ok(());
            }
        }

        // Note: every caller MOVES an owned
        // `Vec<u8>` here (printer chunk by value, cache hit via `mem::take`),
        // so `into_boxed_slice()` transfers the existing allocation without
        // re-alloc+memcpy (1.38 MB for `_tsc.js`'s cached map). `heap::alloc`
        // is NOT a leak: ownership transfers to the table via `put_value`, and
        // is reclaimed by `InternalSourceMap::free_owned` (see `put_value` /
        // `Drop`).
        let blob: Box<[u8]> = core::mem::take(&mut mappings.list).into_boxed_slice();
        let blob_ptr: *mut [u8] = bun_core::heap::into_raw(blob);
        self.put_value(
            source.path.text,
            Value::init(blob_ptr.cast::<c_void>().cast::<InternalSourceMap>()),
        );
        Ok(())
    }

    pub(crate) fn put_value(&mut self, path: &[u8], value: Value) {
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

        // Runtime-transpiled module: the blob in a refcounted ParsedSourceMap
        // shell (no VLQ decode, no Mapping.List), so callers can hold a ref
        // while the table mutates.
        if let Some(result) = Self::shell_locked(mapping) {
            self.unlock();
            return SourceMap::ParseUrl {
                map: Some(result),
                ..Default::default()
            };
        }
        let tagged = Value::from(Some(*mapping));
        if let Some(provider) = tagged.get::<AnySourceProvider>() {
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

    pub(crate) fn resolve_mapping(
        &mut self,
        path: &[u8],
        line: Ordinal,
        column: Ordinal,
        source_handling: SourceMap::SourceContentHandling,
    ) -> Option<SourceMap::mapping::Lookup> {
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
