#![allow(unused_imports, unused_variables, dead_code)]

use core::ffi::c_void;
use core::ptr;

use bun_collections::{HashMap, TaggedPtrUnion};
use bun_core::{Ordinal, Output};
use bun_logger as logger;
use bun_paths::PathBuffer;
use bun_sourcemap::{
    self as SourceMap, BakeSourceProvider, DevServerSourceProvider, InternalSourceMap,
    ParsedSourceMap, SourceProviderMap,
};
use bun_sourcemap::internal_source_map::FindCache;
use bun_string::MutableString;
use bun_threading::Mutex;
use bun_wyhash::hash;

pub struct SavedSourceMap {
    /// This is a pointer to the map located on the VirtualMachine struct
    pub map: *mut HashTable,
    pub mutex: Mutex,

    /// Warm cache for `remapStackFramePositions`: the last decoded sync window and
    /// the last (path_hash -> ISM) resolution. Guarded by `mutex`. Invalidated on
    /// any `putValue` since that may free the cached blob.
    pub find_cache: FindCache,
    pub last_path_hash: u64,
    pub last_ism: Option<InternalSourceMap>,
}

impl Default for SavedSourceMap {
    fn default() -> Self {
        Self {
            map: ptr::null_mut(),
            mutex: Mutex::default(),
            find_cache: FindCache::default(),
            last_path_hash: 0,
            last_ism: None,
        }
    }
}

impl SavedSourceMap {
    // TODO(port): in-place init — `this` is a pre-allocated field on VirtualMachine; `map` is a sibling field backref.
    pub fn init(this: &mut core::mem::MaybeUninit<Self>, map: *mut HashTable) {
        this.write(Self {
            map,
            mutex: Mutex::default(),
            find_cache: FindCache::default(),
            last_path_hash: 0,
            last_ism: None,
        });

        // SAFETY: `map` is a valid pointer to the sibling HashTable on VirtualMachine.
        unsafe { (*map).lock_pointers() };
    }

    #[inline]
    pub fn lock(&mut self) {
        self.mutex.lock();
        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        unsafe { (*self.map).unlock_pointers() };
    }

    #[inline]
    pub fn unlock(&mut self) {
        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        unsafe { (*self.map).lock_pointers() };
        self.mutex.unlock();
    }
}

/// `InternalSourceMap` is the storage for runtime-transpiled modules.
/// `ParsedSourceMap` is materialized lazily from a `SourceProviderMap` /
/// `BakeSourceProvider` / `DevServerSourceProvider` for sources that ship
/// their own external `.map`.
pub type Value = TaggedPtrUnion<ValueTypes>;

/// Local type-list marker so `TypeList`/`UnionMember` impls satisfy orphan
/// rules — `bun_ptr::impl_tagged_ptr_union!` would impl on a tuple of foreign
/// types (all five live in `bun_sourcemap`), which the coherence checker
/// rejects from this crate. Tags are `1024 - i` to match Zig's
/// `TagTypeEnumWithTypeMap` ordering in `SavedSourceMap.zig`.
pub struct ValueTypes;

impl bun_ptr::tagged_pointer::TypeList for ValueTypes {
    const LEN: usize = 5;
    const MIN_TAG: bun_ptr::tagged_pointer::TagType = 1024 - 4;
    fn type_name_from_tag(tag: bun_ptr::tagged_pointer::TagType) -> Option<&'static str> {
        match tag {
            1024 => Some("ParsedSourceMap"),
            1023 => Some("SourceProviderMap"),
            1022 => Some("BakeSourceProvider"),
            1021 => Some("DevServerSourceProvider"),
            1020 => Some("InternalSourceMap"),
            _ => None,
        }
    }
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for ParsedSourceMap {
    const TAG: bun_ptr::tagged_pointer::TagType = 1024;
    const NAME: &'static str = "ParsedSourceMap";
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for SourceProviderMap {
    const TAG: bun_ptr::tagged_pointer::TagType = 1023;
    const NAME: &'static str = "SourceProviderMap";
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for BakeSourceProvider {
    const TAG: bun_ptr::tagged_pointer::TagType = 1022;
    const NAME: &'static str = "BakeSourceProvider";
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for DevServerSourceProvider {
    const TAG: bun_ptr::tagged_pointer::TagType = 1021;
    const NAME: &'static str = "DevServerSourceProvider";
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for InternalSourceMap {
    const TAG: bun_ptr::tagged_pointer::TagType = 1020;
    const NAME: &'static str = "InternalSourceMap";
}

pub mod missing_source_map_note_info {
    use super::*;

    // TODO(port): mutable statics — Zig used plain `pub var`; consider a Mutex-guarded cell in Phase B.
    pub static mut STORAGE: PathBuffer = PathBuffer::ZEROED;
    pub static mut PATH: Option<&'static [u8]> = None;
    pub static mut SEEN_INVALID: bool = false;

    pub fn print() {
        // SAFETY: single-threaded access from the JS thread error-reporting path; matches Zig's unsynchronized `pub var`.
        unsafe {
            if SEEN_INVALID {
                return;
            }
            if let Some(note) = PATH {
                bun_core::note!(
                    "missing sourcemaps for {}",
                    bstr::BStr::new(note)
                );
                bun_core::note!(
                    "consider bundling with '--sourcemap' to get unminified traces"
                );
            }
        }
    }
}

impl SavedSourceMap {
    pub fn put_bake_source_provider(
        &mut self,
        opaque_source_provider: *mut BakeSourceProvider,
        path: &[u8],
    ) {
        // bun.handleOom → drop wrapper; Rust HashMap insert aborts on OOM.
        let _ = self.put_value(path, Value::init(opaque_source_provider));
    }

    pub fn put_dev_server_source_provider(
        &mut self,
        opaque_source_provider: *mut DevServerSourceProvider,
        path: &[u8],
    ) {
        let _ = self.put_value(path, Value::init(opaque_source_provider));
    }

    pub fn remove_dev_server_source_provider(
        &mut self,
        opaque_source_provider: *mut c_void,
        path: &[u8],
    ) {
        self.lock();
        // PORT NOTE: reshaped for borrowck — explicit unlock paired manually.
        // Zig `getEntry`/`removeByPtr` collapsed to `get`+`remove(&key)`; the std
        // backing has no key-slot pointer to hand out, and the key is a u64 hash
        // we already have in hand.
        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        let map = unsafe { &mut *self.map };
        let key = hash(path);
        let Some(&ptr) = map.get(&key) else {
            self.unlock();
            return;
        };
        let old_value = Value::from(Some(ptr));
        if let Some(prov) = old_value.get::<DevServerSourceProvider>() {
            if (prov as usize) == (opaque_source_provider as usize) {
                // there is nothing to unref or deinit
                map.remove(&key);
            }
        } else if let Some(parsed) = old_value.get::<ParsedSourceMap>() {
            // SAFETY: `parsed` was stored by us and is live while in the table.
            if let Some(prov) = unsafe { (*parsed).underlying_provider }.provider() {
                if (prov.ptr() as usize) == (opaque_source_provider as usize) {
                    map.remove(&key);
                    // SAFETY: we held a strong ref while in the table; release it.
                    unsafe { ParsedSourceMap::deref(parsed) };
                }
            }
        }
        self.unlock();
    }

    pub fn put_zig_source_provider(
        &mut self,
        opaque_source_provider: *mut c_void,
        path: &[u8],
    ) {
        let source_provider: *mut SourceProviderMap = opaque_source_provider.cast();
        let _ = self.put_value(path, Value::init(source_provider));
    }

    pub fn remove_zig_source_provider(
        &mut self,
        opaque_source_provider: *mut c_void,
        path: &[u8],
    ) {
        self.lock();
        // PORT NOTE: reshaped for borrowck — explicit unlock paired manually.
        // Zig `getEntry`/`removeByPtr` collapsed to `get`+`remove(&key)`; the std
        // backing has no key-slot pointer to hand out, and the key is a u64 hash
        // we already have in hand.
        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        let map = unsafe { &mut *self.map };
        let key = hash(path);
        let Some(&ptr) = map.get(&key) else {
            self.unlock();
            return;
        };
        let old_value = Value::from(Some(ptr));
        if let Some(prov) = old_value.get::<SourceProviderMap>() {
            if (prov as usize) == (opaque_source_provider as usize) {
                // there is nothing to unref or deinit
                map.remove(&key);
            }
        } else if let Some(parsed) = old_value.get::<ParsedSourceMap>() {
            // SAFETY: `parsed` was stored by us and is live while in the table.
            if let Some(prov) = unsafe { (*parsed).underlying_provider }.provider() {
                if (prov.ptr() as usize) == (opaque_source_provider as usize) {
                    map.remove(&key);
                    // SAFETY: we held a strong ref while in the table; release it.
                    unsafe { ParsedSourceMap::deref(parsed) };
                }
            }
        }
        self.unlock();
    }
}

// TODO(port): std.HashMap(u64, *anyopaque, bun.IdentityContext(u64), 80) — needs identity (passthrough) hasher and 80% max load.
pub type HashTable = HashMap<u64, *mut c_void>;

impl bun_js_printer::OnSourceMapChunk for SavedSourceMap {
    fn on_source_map_chunk(
        &mut self,
        chunk: SourceMap::Chunk,
        source: &logger::Source,
    ) -> Result<(), bun_core::Error> {
        self.put_mappings(source, chunk.buffer)
    }
}

/// Port of `SavedSourceMap.SourceMapHandler` (SavedSourceMap.zig) —
/// `js_printer.SourceMapHandler.For(SavedSourceMap, onSourceMapChunk)`. The Zig
/// comptime type-generator is replaced by `SourceMapHandler::for_::<SavedSourceMap>`,
/// monomorphized over the `OnSourceMapChunk` impl above.
pub type SourceMapHandler<'a> = bun_js_printer::SourceMapHandler<'a>;

impl Drop for SavedSourceMap {
    fn drop(&mut self) {
        {
            self.lock();
            // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
            let map = unsafe { &mut *self.map };
            // Zig `valueIterator()` → std `values()`.
            for val in map.values() {
                let value = Value::from(Some(*val));
                if let Some(source_map) = value.get::<ParsedSourceMap>() {
                    // SAFETY: pointer was stored by us and is live until table teardown.
                    unsafe { ParsedSourceMap::deref(source_map) };
                } else if let Some(_provider) = value.get::<SourceProviderMap>() {
                    // do nothing, we did not hold a ref to ZigSourceProvider
                } else if let Some(ism) = value.get::<InternalSourceMap>() {
                    // SAFETY: blob was heap-allocated via `put_mappings`
                    // (`Box<[u8]>::into_raw`); the tagged pointer's address IS
                    // the blob's data pointer (InternalSourceMap is a thin view).
                    (InternalSourceMap { data: ism as *const u8 }).free_owned();
                }
            }
            self.unlock();
        }

        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        unsafe {
            (*self.map).unlock_pointers();
            (*self.map).deinit();
            // TODO(port): deinit() on a backref-owned HashMap — ownership lives on VirtualMachine; verify Phase B.
        }
    }
}

impl SavedSourceMap {
    pub fn put_mappings(
        &mut self,
        source: &logger::Source,
        mappings: MutableString,
    ) -> Result<(), bun_core::Error> {
        // TODO(port): narrow error set
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
            if incoming.mapping_count() == 0 {
                self.lock();
                // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
                let contains =
                    unsafe { (*self.map).contains_key(&hash(source.path.text)) };
                self.unlock();
                if contains {
                    return Ok(());
                }
                // PORT NOTE: reshaped for borrowck — Zig held the lock across the early return; here we
                // release before returning since no further table access follows.
            }
        }

        // PORT NOTE: Zig `default_allocator.dupe(u8, mappings.list.items)` —
        // `MutableString.list` is `Vec<u8>`; box a copy so the table owns the
        // blob (the incoming `MutableString` may be backed by the printer's
        // recycled buffer or a moved-in cache record). `Box::into_raw` is NOT a
        // leak: ownership transfers to the table via `put_value`, and is
        // reclaimed by `InternalSourceMap::free_owned` (see `put_value` /
        // `Drop`). On the error path the Box is reconstituted and dropped.
        let blob: Box<[u8]> = Box::<[u8]>::from(mappings.list.as_slice());
        let blob_ptr: *mut [u8] = Box::into_raw(blob);
        // errdefer: on error, reconstitute and drop the Box.
        match self.put_value(
            source.path.text,
            Value::init(blob_ptr as *mut u8 as *mut InternalSourceMap),
        ) {
            Ok(()) => Ok(()),
            Err(e) => {
                // SAFETY: `blob_ptr` came from `Box::into_raw` just above and was not consumed.
                drop(unsafe { Box::<[u8]>::from_raw(blob_ptr) });
                Err(e)
            }
        }
    }

    pub fn put_value(&mut self, path: &[u8], value: Value) -> Result<(), bun_core::Error> {
        use std::collections::hash_map::Entry;

        // TODO(port): narrow error set
        self.lock();
        // PORT NOTE: reshaped for borrowck — explicit unlock paired manually.

        self.find_cache.invalidate_all();
        self.last_ism = None;

        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        // `bun_collections::HashMap` derefs to `std::collections::HashMap`, so
        // the std `entry()` API is used directly (Zig `getOrPut`).
        let map = unsafe { &mut *self.map };
        match map.entry(hash(path)) {
            Entry::Occupied(mut o) => {
                let old_value = Value::from(Some(*o.get()));
                if let Some(parsed_source_map) = old_value.get::<ParsedSourceMap>() {
                     // TODO(b2-blocked): `ParsedSourceMap: ThreadSafeRefCounted` — wire `ThreadSafeRefCount::deref` once the trait impl lands in bun_sourcemap.
                    {
                        // SAFETY: pointer was stored by us and is live until replaced.
                        unsafe {
                            bun_ptr::ThreadSafeRefCount::<ParsedSourceMap>::deref(
                                parsed_source_map,
                            )
                        };
                    }
                    let _ = parsed_source_map;
                } else if let Some(_provider) = old_value.get::<SourceProviderMap>() {
                    // do nothing, we did not hold a ref to ZigSourceProvider
                } else if let Some(ism) = old_value.get::<InternalSourceMap>() {
                    // SAFETY: blob was heap-allocated via `put_mappings`
                    // (`Box<[u8]>::into_raw`); the tagged pointer's address IS
                    // the blob's data pointer (InternalSourceMap is a thin view).
                    (InternalSourceMap { data: ism as *const u8 }).free_owned();
                }
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
         // TODO(b2-blocked): bun_collections::TaggedPtrUnion::{tag, tag_of, as_, init, from}, bun_sourcemap::ParsedSourceMap field shape, ParseUrl field shape
        {
        let h = hash(path);

        // This lock is for the hash table
        self.lock();

        // This mapping entry is only valid while the mutex is locked
        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        let map = unsafe { &mut *self.map };
        let Some(mapping) = map.get_entry(h) else {
            self.unlock();
            return SourceMap::ParseUrl::default();
        };

        let tagged = Value::from(*mapping.value_ptr());
        // TODO(port): Value.Tag via @typeName — assuming `TaggedPtrUnion::tag_of::<T>()` API in bun_collections.
        let tag = tagged.tag();
        if tag == Value::tag_of::<InternalSourceMap>() {
            // Runtime-transpiled module. Wrap the blob in a refcounted
            // ParsedSourceMap shell (no VLQ decode, no Mapping.List) so callers
            // can hold a ref while the table mutates. The shell takes ownership
            // of the blob.
            let ism = InternalSourceMap {
                data: tagged.as_::<InternalSourceMap>() as *mut _ as *mut u8,
            };
            let result = Box::into_raw(Box::new(ParsedSourceMap {
                ref_count: Default::default(),
                input_line_count: ism.input_line_count(),
                internal: ism,
                ..Default::default()
            }));
            // TODO(port): ParsedSourceMap likely has more fields with defaults — verify Default impl in Phase B.
            *mapping.value_ptr_mut() = Value::init(result).ptr();
            // SAFETY: `result` is a freshly boxed, non-null ParsedSourceMap.
            unsafe { (*result).ref_() };
            self.unlock();
            return SourceMap::ParseUrl {
                map: Some(result),
                ..Default::default()
            };
        } else if tag == Value::tag_of::<ParsedSourceMap>() {
            let parsed = tagged.as_::<ParsedSourceMap>();
            // SAFETY: pointer was stored by us and is live while locked.
            unsafe { (*parsed).ref_() };
            self.unlock();
            return SourceMap::ParseUrl {
                map: Some(parsed),
                ..Default::default()
            };
        } else if tag == Value::tag_of::<SourceProviderMap>() {
            let ptr: *mut SourceProviderMap = tagged.as_::<SourceProviderMap>();
            self.unlock();

            // Do not lock the mutex while we're parsing JSON!
            // SAFETY: SourceProviderMap is kept alive by JSC; we did not hold a ref.
            if let Some(parse) = unsafe { (*ptr).get_source_map(path, Default::default(), hint) } {
                // TODO(port): `.none` enum literal for second arg — verify SourceMap load-hint default.
                if let Some(parsed_map) = parse.map {
                    // SAFETY: returned map is a valid heap allocation from get_source_map.
                    unsafe { (*parsed_map).ref_() };
                    // The mutex is not locked. We have to check the hash table again.
                    let _ = self.put_value(path, Value::init(parsed_map));

                    return parse;
                }
            }

            self.lock();
            // does not have a valid source map. let's not try again
            // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
            unsafe { (*self.map).remove(h) };

            // Store path for a user note.
            // SAFETY: single-threaded JS-thread access; matches Zig's unsynchronized `pub var`.
            unsafe {
                let storage = &mut missing_source_map_note_info::STORAGE[..path.len()];
                storage.copy_from_slice(path);
                missing_source_map_note_info::PATH =
                    Some(core::slice::from_raw_parts(storage.as_ptr(), path.len()));
            }
            self.unlock();
            return SourceMap::ParseUrl::default();
        } else if tag == Value::tag_of::<BakeSourceProvider>() {
            // TODO: This is a copy-paste of above branch
            let ptr: *mut BakeSourceProvider = tagged.as_::<BakeSourceProvider>();
            self.unlock();

            // Do not lock the mutex while we're parsing JSON!
            // SAFETY: BakeSourceProvider is kept alive by its owner.
            if let Some(parse) = unsafe { (*ptr).get_source_map(path, Default::default(), hint) } {
                if let Some(parsed_map) = parse.map {
                    // SAFETY: returned map is a valid heap allocation from get_source_map.
                    unsafe { (*parsed_map).ref_() };
                    // The mutex is not locked. We have to check the hash table again.
                    let _ = self.put_value(path, Value::init(parsed_map));

                    return parse;
                }
            }

            self.lock();
            // does not have a valid source map. let's not try again
            // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
            unsafe { (*self.map).remove(h) };

            // Store path for a user note.
            // SAFETY: single-threaded JS-thread access; matches Zig's unsynchronized `pub var`.
            unsafe {
                let storage = &mut missing_source_map_note_info::STORAGE[..path.len()];
                storage.copy_from_slice(path);
                missing_source_map_note_info::PATH =
                    Some(core::slice::from_raw_parts(storage.as_ptr(), path.len()));
            }
            self.unlock();
            return SourceMap::ParseUrl::default();
        } else if tag == Value::tag_of::<DevServerSourceProvider>() {
            // TODO: This is a copy-paste of above branch
            let ptr: *mut DevServerSourceProvider = tagged.as_::<DevServerSourceProvider>();
            self.unlock();

            // Do not lock the mutex while we're parsing JSON!
            // SAFETY: DevServerSourceProvider is kept alive by its owner.
            if let Some(parse) = unsafe { (*ptr).get_source_map(path, Default::default(), hint) } {
                if let Some(parsed_map) = parse.map {
                    // SAFETY: returned map is a valid heap allocation from get_source_map.
                    unsafe { (*parsed_map).ref_() };
                    // The mutex is not locked. We have to check the hash table again.
                    let _ = self.put_value(path, Value::init(parsed_map));

                    return parse;
                }
            }

            self.lock();
            // does not have a valid source map. let's not try again
            // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
            unsafe { (*self.map).remove(h) };

            // Store path for a user note.
            // SAFETY: single-threaded JS-thread access; matches Zig's unsynchronized `pub var`.
            unsafe {
                let storage = &mut missing_source_map_note_info::STORAGE[..path.len()];
                storage.copy_from_slice(path);
                missing_source_map_note_info::PATH =
                    Some(core::slice::from_raw_parts(storage.as_ptr(), path.len()));
            }
            self.unlock();
            return SourceMap::ParseUrl::default();
        } else {
            if cfg!(debug_assertions) {
                panic!("Corrupt pointer tag");
            }
            self.unlock();

            return SourceMap::ParseUrl::default();
        }
        } // end 
        let _ = (path, hint);
        SourceMap::ParseUrl::default()
    }

    /// You must `deref()` the returned value or you will leak memory
    pub fn get(&mut self, path: &[u8]) -> Option<std::sync::Arc<ParsedSourceMap>> {
        self.get_with_content(path, SourceMap::ParseUrlResultHint::MappingsOnly).map
    }

    /// Mutex must already be held. Returns the raw table value for `hash` if any.
    pub fn get_value_locked(&mut self, h: u64) -> Option<Value> {
         // TODO(b2-blocked): bun_collections::HashMap::get, TaggedPtrUnion::from(*mut c_void)
        {
            // SAFETY: `map` points at the live sibling HashTable on VirtualMachine; caller holds mutex.
            let raw = unsafe { (*self.map).get(h)? };
            return Some(Value::from(raw));
        }
        let _ = h;
        None
    }

    pub fn resolve_mapping(
        &mut self,
        path: &[u8],
        line: Ordinal,
        column: Ordinal,
        source_handling: SourceMap::SourceContentHandling,
    ) -> Option<SourceMap::mapping::Lookup<'_>> {
         // TODO(b2-blocked): bun_sourcemap::{ParseUrl fields, ParsedSourceMap::find_mapping, mapping::Lookup fields}
        {
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
                    }
                }
            },
        );
        let map = parse.map?;

        let mapping = match parse.mapping {
            Some(m) => m,
            // SAFETY: `map` was just ref'd in get_with_content and is non-null.
            None => unsafe { (*map).find_mapping(line, column)? },
        };

        Some(SourceMap::mapping::Lookup {
            mapping,
            source_map: map,
            prefetched_source_code: parse.source_contents,
        })
        } // end 
        let _ = (path, line, column, source_handling);
        None
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/SavedSourceMap.zig (370 lines)
//   confidence: medium
//   todos:      11
//   notes:      Heavy raw-ptr + manual lock/unlock interleave; TaggedPtrUnion tag API assumed; mutable statics need sync review; HashTable needs identity hasher + lockPointers shim.
// ──────────────────────────────────────────────────────────────────────────
