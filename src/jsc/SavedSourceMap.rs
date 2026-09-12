#![warn(unused_must_use)]

use core::ffi::c_void;
use std::sync::Arc;

use bun_collections::{HashMap, IdentityContext, TaggedPtrUnion};
use bun_core::MutableString;
use bun_core::Ordinal;
use bun_ptr::tagged_pointer::TagType;
use bun_sourcemap::parsed_source_map::AnySourceProvider;
use bun_sourcemap::{self as SourceMap, InternalSourceMap, ParsedSourceMap};
use bun_threading::Guarded;
use bun_wyhash::hash;

/// Per-VM path → source-map table. Shared between the JS thread, the
/// transpiler work-pool threads that store mappings as they print, and the
/// heap-collector thread that remaps stack frames, so every method takes
/// `&self` and goes through the lock.
#[derive(Default)]
pub struct SavedSourceMap {
    map: Guarded<HashTable>,
}

// SAFETY: the table is only reached through `map`'s mutex, and what its values
// own — a `ParsedSourceMap` strong ref, an `InternalSourceMap` blob, a boxed
// `AnySourceProvider` — is thread-agnostic heap data (the provider's FFI
// handle is only *compared* or asked for its source map, which C++ serves from
// any thread).
unsafe impl Send for SavedSourceMap {}
// SAFETY: as above.
unsafe impl Sync for SavedSourceMap {}

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

impl bun_ptr::tagged_pointer::TypeList for ValueTypes {
    const MIN_TAG: TagType = 1024 - 2;
}
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
    pub fn put_source_provider(&self, provider: AnySourceProvider, path: &[u8]) {
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
    pub fn remove_source_provider(&self, opaque_source_provider: *mut c_void, path: &[u8]) {
        let mut map = self.map.lock();
        // `get`+`remove(&key)`: the std
        // backing has no key-slot pointer to hand out, and the key is a u64 hash
        // we already have in hand.
        let key = hash(path);
        let Some(&ptr) = map.get(&key) else {
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
            map.remove(&key);
            // SAFETY: `old_value` was stored by us; the table's ownership of
            // it ends here.
            unsafe { Self::release_value(old_value) };
        }
    }
}

// Keys are
// already wyhash u64s, so use the passthrough hasher; `bun_collections`'
// zig_hash_map uses an 80% max load factor.
type HashTable = HashMap<u64, *mut c_void, IdentityContext<u64>>;

impl bun_js_printer::OnSourceMapChunk for &SavedSourceMap {
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
        for val in self.map.get_mut().values() {
            let value = Value::from(Some(*val));
            // SAFETY: values were stored by us and are live until table
            // teardown.
            unsafe { Self::release_value(value) };
        }
    }
}

impl SavedSourceMap {
    pub fn put_mappings(
        &self,
        source: &bun_ast::Source,
        mut mappings: MutableString,
    ) -> bun_js_printer::Result<()> {
        // --hot can re-read a file mid-rewrite (truncate + write) and transpile
        // a comment-only prefix into a 0-mapping map. Overwriting a real map
        // with that would make any still-unreported error from the previous
        // transpile remap against nothing and leak transpiled coords. A map
        // with no mappings can never answer a lookup, so dropping it is never
        // worse than installing it.
        if mappings.list.len() >= SourceMap::internal_source_map::HEADER_SIZE {
            let incoming = InternalSourceMap {
                data: mappings.list.as_ptr(),
            };
            if incoming.mapping_count() == 0
                && self.map.lock().contains_key(&hash(source.path.text))
            {
                return Ok(());
            }
        }

        // Note: every caller MOVES an owned
        // `Vec<u8>` here (printer chunk by value, cache hit via `mem::take`),
        // so `into_boxed_slice()` transfers the existing allocation without
        // re-alloc+memcpy (1.38 MB for `_tsc.js`'s cached map). `heap::alloc`
        // is NOT a leak: ownership transfers to the table via `put_value`, and
        // is reclaimed by `InternalSourceMap::free_owned` (see `put_value` /
        // `Drop`). On the error path the Box is reconstituted and dropped.
        let blob: Box<[u8]> = core::mem::take(&mut mappings.list).into_boxed_slice();
        let blob_ptr: *mut [u8] = bun_core::heap::into_raw(blob);
        // errdefer: on error, reconstitute and drop the Box.
        match self.put_value(
            source.path.text,
            Value::init(blob_ptr.cast::<c_void>().cast::<InternalSourceMap>()),
        ) {
            Ok(()) => Ok(()),
            Err(e) => {
                // SAFETY: `blob_ptr` came from `heap::alloc` just above and was not consumed.
                drop(unsafe { Box::<[u8]>::from_raw(blob_ptr) });
                Err(e)
            }
        }
    }

    pub(crate) fn put_value(&self, path: &[u8], value: Value) -> bun_js_printer::Result<()> {
        use bun_collections::zig_hash_map::MapEntry as Entry;

        let mut map = self.map.lock();
        // `bun_collections::HashMap` derefs to `std::collections::HashMap`, so
        // the std `entry()` API is used directly.
        match map.entry(hash(path)) {
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
        Ok(())
    }

    /// You must call `sourcemap.map.deref()` or you will leak memory
    fn get_with_content(
        &self,
        path: &[u8],
        hint: SourceMap::ParseUrlResultHint,
    ) -> SourceMap::ParseUrl {
        let h = hash(path);

        // This lock is for the hash table
        let mut map = self.map.lock();

        // This mapping entry is only valid while the mutex is locked
        let Some(mapping) = map.get_mut(&h) else {
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
            return SourceMap::ParseUrl {
                map: Some(result),
                ..Default::default()
            };
        } else if let Some(provider_box) = tagged.get::<AnySourceProvider>() {
            // Copy the erased pair out while the lock is held: once unlocked,
            // a concurrent put/remove may free the box.
            // SAFETY: the box was stored by `put_source_provider` and is live
            // while in the table.
            let provider = unsafe { *provider_box };
            let registered = *mapping;
            drop(map);

            // Do not lock the mutex while we're parsing JSON!
            // The provider FFI handle is kept alive by its owner (JSC / the
            // registrar), which unregisters it (`remove_source_provider`, on
            // the JS thread) before freeing; we hold no ref of our own, as
            // before this table had `&self` methods.
            let parse = provider.get_source_map(path, Default::default(), hint);

            // The table may have changed while unlocked (the provider removed,
            // or a newer one registered for `path`): only the entry this parse
            // started from is replaced — by the parsed map, or dropped so a
            // provider without a valid map is not asked again.
            let mut map = self.map.lock();
            let still_registered = map.get(&h).is_some_and(|&p| p == registered);
            if let Some(parse) = parse {
                if let Some(ref parsed_map) = parse.map {
                    if still_registered {
                        // Leak one strong ref into the table; releasing the
                        // old value frees the provider box.
                        let new = Value::init(Arc::into_raw(Arc::clone(parsed_map))).ptr();
                        let old = map.insert(h, new).expect("still registered");
                        // SAFETY: `old` is the provider box this table owned.
                        unsafe { Self::release_value(Value::from(Some(old))) };
                    }
                    return parse;
                }
            }
            if still_registered {
                if let Some(removed) = map.remove(&h) {
                    // SAFETY: `removed` is the provider box this table owned;
                    // its ownership ends here.
                    unsafe { Self::release_value(Value::from(Some(removed))) };
                }
            }

            // Store path for a user note.
            missing_source_map_note_info::record(path);
            return SourceMap::ParseUrl::default();
        } else {
            if cfg!(debug_assertions) {
                panic!("Corrupt pointer tag");
            }

            return SourceMap::ParseUrl::default();
        }
    }

    /// You must `deref()` the returned value or you will leak memory
    pub fn get(&self, path: &[u8]) -> Option<std::sync::Arc<ParsedSourceMap>> {
        self.get_with_content(path, SourceMap::ParseUrlResultHint::MappingsOnly)
            .map
    }

    pub(crate) fn resolve_mapping(
        &self,
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
