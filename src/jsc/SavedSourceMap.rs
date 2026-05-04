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
use bun_str::MutableString;
use bun_threading::Mutex;
use bun_wyhash::hash;

pub struct SavedSourceMap {
    /// This is a pointer to the map located on the VirtualMachine struct
    pub map: *mut HashTable,
    pub mutex: Mutex,

    /// Warm cache for `remapStackFramePositions`: the last decoded sync window and
    /// the last (path_hash -> ISM) resolution. Guarded by `mutex`. Invalidated on
    /// any `putValue` since that may free the cached blob.
    pub find_cache: <InternalSourceMap as SourceMap::InternalSourceMapExt>::FindCache,
    // TODO(port): ^ InternalSourceMap.FindCache — verify path is `bun_sourcemap::internal_source_map::FindCache`
    pub last_path_hash: u64,
    pub last_ism: Option<InternalSourceMap>,
}

impl Default for SavedSourceMap {
    fn default() -> Self {
        Self {
            map: ptr::null_mut(),
            mutex: Mutex::default(),
            find_cache: Default::default(),
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
            find_cache: Default::default(),
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
pub type Value = TaggedPtrUnion<(
    ParsedSourceMap,
    SourceProviderMap,
    BakeSourceProvider,
    DevServerSourceProvider,
    InternalSourceMap,
)>;

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
                Output::note(format_args!(
                    "missing sourcemaps for {}",
                    bstr::BStr::new(note)
                ));
                Output::note(format_args!(
                    "consider bundling with '--sourcemap' to get unminified traces"
                ));
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
        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        let map = unsafe { &mut *self.map };
        let Some(entry) = map.get_entry(hash(path)) else {
            self.unlock();
            return;
        };
        let old_value = Value::from(*entry.value_ptr());
        if let Some(prov) = old_value.get::<DevServerSourceProvider>() {
            if (prov as *mut _ as usize) == (opaque_source_provider as usize) {
                // there is nothing to unref or deinit
                map.remove_by_ptr(entry.key_ptr());
            }
        } else if let Some(parsed) = old_value.get::<ParsedSourceMap>() {
            if let Some(prov) = parsed.underlying_provider.provider() {
                if (prov.ptr() as usize) == (opaque_source_provider as usize) {
                    map.remove_by_ptr(entry.key_ptr());
                    parsed.deref_();
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
        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        let map = unsafe { &mut *self.map };
        let Some(entry) = map.get_entry(hash(path)) else {
            self.unlock();
            return;
        };
        let old_value = Value::from(*entry.value_ptr());
        if let Some(prov) = old_value.get::<SourceProviderMap>() {
            if (prov as *mut _ as usize) == (opaque_source_provider as usize) {
                // there is nothing to unref or deinit
                map.remove_by_ptr(entry.key_ptr());
            }
        } else if let Some(parsed) = old_value.get::<ParsedSourceMap>() {
            if let Some(prov) = parsed.underlying_provider.provider() {
                if (prov.ptr() as usize) == (opaque_source_provider as usize) {
                    map.remove_by_ptr(entry.key_ptr());
                    parsed.deref_();
                }
            }
        }
        self.unlock();
    }
}

// TODO(port): std.HashMap(u64, *anyopaque, bun.IdentityContext(u64), 80) — needs identity (passthrough) hasher and 80% max load.
pub type HashTable = HashMap<u64, *mut c_void>;

impl SavedSourceMap {
    pub fn on_source_map_chunk(
        &mut self,
        chunk: SourceMap::Chunk,
        source: &logger::Source,
    ) -> Result<(), bun_core::Error> {
        self.put_mappings(source, chunk.buffer)
    }
}

// TODO(port): js_printer.SourceMapHandler.For(SavedSourceMap, onSourceMapChunk) — comptime type-generator;
// implement `bun_js_printer::SourceMapHandler` trait for `SavedSourceMap` in Phase B.
pub type SourceMapHandler = bun_js_printer::SourceMapHandler<SavedSourceMap>;

impl Drop for SavedSourceMap {
    fn drop(&mut self) {
        {
            self.lock();
            // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
            let map = unsafe { &mut *self.map };
            let mut iter = map.value_iterator();
            while let Some(val) = iter.next() {
                let value = Value::from(*val);
                if let Some(source_map) = value.get::<ParsedSourceMap>() {
                    source_map.deref_();
                } else if let Some(_provider) = value.get::<SourceProviderMap>() {
                    // do nothing, we did not hold a ref to ZigSourceProvider
                } else if let Some(ism) = value.get::<InternalSourceMap>() {
                    (InternalSourceMap {
                        data: ism as *mut _ as *mut u8,
                    })
                    .deinit();
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
        if mappings.list.items().len() >= InternalSourceMap::HEADER_SIZE {
            let incoming = InternalSourceMap {
                data: mappings.list.items().as_ptr() as *mut u8,
            };
            if incoming.mapping_count() == 0 {
                self.lock();
                // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
                let contains = unsafe { (*self.map).contains(hash(source.path.text())) };
                self.unlock();
                if contains {
                    return Ok(());
                }
                // PORT NOTE: reshaped for borrowck — Zig held the lock across the early return; here we
                // release before returning since no further table access follows.
            }
        }

        let blob: Box<[u8]> = Box::<[u8]>::from(mappings.list.items());
        let blob_ptr: *mut [u8] = Box::into_raw(blob);
        // errdefer: on error, reconstitute and drop the Box.
        match self.put_value(
            source.path.text(),
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
        // TODO(port): narrow error set
        self.lock();
        // PORT NOTE: reshaped for borrowck — explicit unlock before each return.

        self.find_cache.invalidate_all();
        self.last_ism = None;
        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine.
        let map = unsafe { &mut *self.map };
        let entry = match map.get_or_put(hash(path)) {
            Ok(e) => e,
            Err(e) => {
                self.unlock();
                return Err(e.into());
            }
        };
        if entry.found_existing {
            let old_value = Value::from(*entry.value_ptr());
            if let Some(parsed_source_map) = old_value.get::<ParsedSourceMap>() {
                let source_map: *mut ParsedSourceMap = parsed_source_map;
                // SAFETY: pointer was stored by us and is live until replaced.
                unsafe { (*source_map).deref_() };
            } else if let Some(_provider) = old_value.get::<SourceProviderMap>() {
                // do nothing, we did not hold a ref to ZigSourceProvider
            } else if let Some(ism) = old_value.get::<InternalSourceMap>() {
                (InternalSourceMap {
                    data: ism as *mut _ as *mut u8,
                })
                .deinit();
            }
        }
        *entry.value_ptr_mut() = value.ptr();
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
    }

    /// You must `deref()` the returned value or you will leak memory
    pub fn get(&mut self, path: &[u8]) -> Option<*mut ParsedSourceMap> {
        self.get_with_content(path, SourceMap::ParseUrlResultHint::MappingsOnly)
            .map
    }

    /// Mutex must already be held. Returns the raw table value for `hash` if any.
    pub fn get_value_locked(&mut self, h: u64) -> Option<Value> {
        // SAFETY: `map` points at the live sibling HashTable on VirtualMachine; caller holds mutex.
        let raw = unsafe { (*self.map).get(h)? };
        Some(Value::from(raw))
    }

    pub fn resolve_mapping(
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
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/jsc/SavedSourceMap.zig (370 lines)
//   confidence: medium
//   todos:      11
//   notes:      Heavy raw-ptr + manual lock/unlock interleave; TaggedPtrUnion tag API assumed; mutable statics need sync review; HashTable needs identity hasher + lockPointers shim.
// ──────────────────────────────────────────────────────────────────────────
