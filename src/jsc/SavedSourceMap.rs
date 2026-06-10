#![warn(unused_must_use)]

use core::ffi::c_void;
use core::ptr;
use std::sync::Arc;

use bun_collections::{HashMap, IdentityContext, TaggedPtrUnion};
use bun_core::MutableString;
use bun_core::Ordinal;
use bun_ptr::tagged_pointer::{TagType, TaggedPtr};
use bun_sourcemap::internal_source_map::FindCache;
use bun_sourcemap::parsed_source_map::{AnySourceProvider, ErasedGetSourceMap};
use bun_sourcemap::{self as SourceMap, InternalSourceMap, ParsedSourceMap};
use bun_threading::Mutex;
use bun_wyhash::hash;

pub struct SavedSourceMap {
    /// This is a pointer to the map located on the VirtualMachine struct
    pub map: *mut HashTable,
    pub mutex: Mutex,

    /// Dispatch fns for entries stored under the provider tags
    /// (`PROVIDER_TAG_BASE - slot`): a table value has room for the provider
    /// handle only, so its `get_source_map` dispatch is interned here and
    /// recovered from the tag. Slots are append-only; guarded by `mutex`.
    provider_dispatch: [Option<ErasedGetSourceMap>; PROVIDER_SLOTS],

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
            provider_dispatch: [None; PROVIDER_SLOTS],
            find_cache: FindCache::default(),
            last_path_hash: 0,
            last_ism: None,
        }
    }
}

impl SavedSourceMap {
    // In-place init — `this` is a pre-allocated field on VirtualMachine; `map` is a sibling field backref.
    pub unsafe fn init(this: &mut core::mem::MaybeUninit<Self>, map: *mut HashTable) {
        this.write(Self {
            map,
            mutex: Mutex::default(),
            provider_dispatch: [None; PROVIDER_SLOTS],
            find_cache: FindCache::default(),
            last_path_hash: 0,
            last_ism: None,
        });

        // SAFETY: `map` is a valid pointer to the sibling HashTable on VirtualMachine.
        unsafe { (*map).lock_pointers() };
    }

    /// Mutable access to the sibling `HashTable` on `VirtualMachine`.
    ///
    /// # Safety invariant
    /// `self.map` is set in [`Self::init`] to a non-null pointer at a sibling
    /// field on `VirtualMachine` and is never reassigned; the pointee outlives
    /// `self`. Exclusive access is upheld by `&mut self` (and, for table
    /// mutation, by `self.mutex` which callers must hold).
    #[inline]
    fn map_mut(&mut self) -> &mut HashTable {
        debug_assert!(!self.map.is_null());
        // SAFETY: see invariant above — non-null sibling backref, lives as long as `self`.
        unsafe { &mut *self.map }
    }

    #[inline]
    pub fn lock(&mut self) {
        self.mutex.lock();
        self.map_mut().unlock_pointers();
    }

    #[inline]
    pub fn unlock(&mut self) {
        self.map_mut().lock_pointers();
        self.mutex.unlock();
    }
}

/// `InternalSourceMap` is the storage for runtime-transpiled modules.
/// `ParsedSourceMap` is materialized lazily from a registered external source
/// provider for sources that ship their own external `.map`.
pub type Value = TaggedPtrUnion<ValueTypes>;

/// Local type-list marker so `TypeList`/`UnionMember` impls satisfy orphan
/// rules — `bun_ptr::impl_tagged_ptr_union!` would impl on a tuple of foreign
/// types (both typed members live in `bun_sourcemap`), which the coherence
/// checker rejects from this crate. Tags are `1024 - i`; the gap between the
/// two typed members holds the erased provider slots (see
/// [`PROVIDER_TAG_BASE`]).
pub struct ValueTypes;

impl bun_ptr::tagged_pointer::TypeList for ValueTypes {
    const LEN: usize = 2 + PROVIDER_SLOTS;
    const MIN_TAG: TagType = 1024 - 4;
    fn type_name_from_tag(tag: TagType) -> Option<&'static str> {
        match tag {
            1024 => Some("ParsedSourceMap"),
            1021..=1023 => Some("AnySourceProvider"),
            1020 => Some("InternalSourceMap"),
            _ => None,
        }
    }
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for ParsedSourceMap {
    const TAG: TagType = 1024;
    const NAME: &'static str = "ParsedSourceMap";
}
impl bun_ptr::tagged_pointer::UnionMember<ValueTypes> for InternalSourceMap {
    const TAG: TagType = 1020;
    const NAME: &'static str = "InternalSourceMap";
}

/// Tags `PROVIDER_TAG_BASE - slot` for `slot < PROVIDER_SLOTS` (1021..=1023)
/// hold lazy external source providers, erased to the raw handle (the tagged
/// word) plus its dispatch fn (`SavedSourceMap::provider_dispatch[slot]`).
/// Provider entries are borrowed: the owner unregisters the handle via
/// [`SavedSourceMap::remove_source_provider`] before freeing it, so replace /
/// remove / drop paths release nothing for them.
const PROVIDER_TAG_BASE: TagType = 1023;
/// One slot per `ErasedGetSourceMap` monomorphization that can reach
/// [`SavedSourceMap::put_source_provider`]. Three provider kinds exist, and
/// each kind's `AnySourceProvider::new` registration call lives in exactly
/// one crate (monomorphization is per-crate), so at most three distinct
/// dispatch fns register.
const PROVIDER_SLOTS: usize = 3;

impl SavedSourceMap {
    /// Mutex must be held. Interns `dispatch` and returns the provider tag
    /// whose slot recovers it.
    fn provider_tag_for_dispatch(&mut self, dispatch: ErasedGetSourceMap) -> TagType {
        for (slot, entry) in self.provider_dispatch.iter_mut().enumerate() {
            let tag = PROVIDER_TAG_BASE - slot as TagType;
            match entry {
                Some(f) => {
                    if core::ptr::fn_addr_eq(*f, dispatch) {
                        return tag;
                    }
                }
                None => {
                    *entry = Some(dispatch);
                    return tag;
                }
            }
        }
        panic!("SavedSourceMap: more distinct source-provider dispatch fns than provider slots");
    }

    /// Mutex must be held. Recovers the erased provider for a table value
    /// stored under a provider tag, or `None` if `value` is not a provider
    /// entry.
    fn provider_from_value(&self, value: Value) -> Option<AnySourceProvider> {
        let slot = usize::from(PROVIDER_TAG_BASE.checked_sub(value.tag())?);
        let dispatch = (*self.provider_dispatch.get(slot)?)?;
        Some(AnySourceProvider::from_raw_parts(
            value.as_uintptr() as usize as *mut c_void,
            dispatch,
        ))
    }
}

/// Thin forwarder to the leaf-crate state in
/// `bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo` so the path
/// recorded here is the same one `run_command` prints.
pub mod missing_source_map_note_info {
    pub use bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo::{
        print, seen_invalid, set_seen_invalid,
    };

    #[inline]
    pub(super) fn record(path: &[u8]) {
        bun_sourcemap::SavedSourceMap::MissingSourceMapNoteInfo::set_path(path);
    }
}

impl SavedSourceMap {
    /// Registers a lazy external source provider for `path`, replacing any
    /// existing entry. The handle is borrowed (see [`PROVIDER_TAG_BASE`]).
    pub fn put_source_provider(&mut self, provider: AnySourceProvider, path: &[u8]) {
        let (provider_ptr, dispatch) = provider.into_raw_parts();
        self.lock();
        let tag = self.provider_tag_for_dispatch(dispatch);
        self.unlock();
        // The slot index stays valid after unlocking: `provider_dispatch` is
        // append-only.
        // bun.handleOom → drop wrapper; Rust HashMap insert aborts on OOM.
        let _ = self.put_value(
            path,
            Value::from(Some(TaggedPtr::init(provider_ptr, tag).to())),
        );
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
        let Some(&ptr) = self.map_mut().get(&key) else {
            self.unlock();
            return;
        };
        let old_value = Value::from(Some(ptr));
        if let Some(prov) = self.provider_from_value(old_value) {
            if core::ptr::eq(prov.ptr(), opaque_source_provider) {
                // there is nothing to unref or deinit
                self.map_mut().remove(&key);
            }
        } else if let Some(parsed) = old_value.get::<ParsedSourceMap>() {
            // SAFETY: `parsed` was stored by us and is live while in the table.
            if let Some(prov) = unsafe { (*parsed).underlying_provider }.provider() {
                if core::ptr::eq(prov.ptr(), opaque_source_provider) {
                    self.map_mut().remove(&key);
                    // SAFETY: we held a strong ref while in the table; release it.
                    unsafe { ParsedSourceMap::deref(parsed) };
                }
            }
        }
        self.unlock();
    }
}

// Keys are
// already wyhash u64s, so use the passthrough hasher; `bun_collections`'
// zig_hash_map uses an 80% max load factor.
pub type HashTable = HashMap<u64, *mut c_void, IdentityContext<u64>>;

impl bun_js_printer::OnSourceMapChunk for SavedSourceMap {
    fn on_source_map_chunk(
        &mut self,
        chunk: SourceMap::Chunk,
        source: &bun_ast::Source,
    ) -> Result<(), bun_core::Error> {
        self.put_mappings(source, chunk.buffer)
    }
}

/// `SourceMapHandler::for_::<SavedSourceMap>` is
/// monomorphized over the `OnSourceMapChunk` impl above.
pub type SourceMapHandler<'a> = bun_js_printer::SourceMapHandler<'a>;

impl Drop for SavedSourceMap {
    fn drop(&mut self) {
        {
            self.lock();
            let map = self.map_mut();
            for val in map.values() {
                let value = Value::from(Some(*val));
                // Provider-tagged entries are borrowed handles — nothing to
                // release for them.
                if let Some(source_map) = value.get::<ParsedSourceMap>() {
                    // SAFETY: pointer was stored by us and is live until table teardown.
                    unsafe { ParsedSourceMap::deref(source_map) };
                } else if let Some(ism) = value.get::<InternalSourceMap>() {
                    // SAFETY: blob was heap-allocated via `put_mappings`
                    // (`Box<[u8]>::into_raw`); the tagged pointer's address IS
                    // the blob's data pointer (InternalSourceMap is a thin view).
                    (InternalSourceMap {
                        data: ism as *const u8,
                    })
                    .free_owned();
                }
            }
            self.unlock();
        }

        self.map_mut().unlock_pointers();
        // The HashTable storage is owned by the sibling `saved_source_map_table`
        // field on VirtualMachine; `deinit()` resets it to an empty default in
        // place, so the VM's later (or absent) drop of that field is a no-op —
        // no double free.
        self.map_mut().deinit();
    }
}

impl SavedSourceMap {
    pub fn put_mappings(
        &mut self,
        source: &bun_ast::Source,
        mut mappings: MutableString,
    ) -> Result<(), bun_core::Error> {
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
                let contains = self.map_mut().contains_key(&hash(source.path.text));
                self.unlock();
                if contains {
                    return Ok(());
                }
                // Note: reshaped for borrowck — the lock is
                // released before returning since no further table access follows.
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

    pub fn put_value(&mut self, path: &[u8], value: Value) -> Result<(), bun_core::Error> {
        use bun_collections::zig_hash_map::MapEntry as Entry;

        self.lock();
        // Note: reshaped for borrowck — explicit unlock paired manually.

        self.find_cache.invalidate_all();
        self.last_ism = None;

        // `bun_collections::HashMap` derefs to `std::collections::HashMap`, so
        // the std `entry()` API is used directly.
        match self.map_mut().entry(hash(path)) {
            Entry::Occupied(mut o) => {
                let old_value = Value::from(Some(*o.get()));
                // Provider-tagged entries are borrowed handles — nothing to
                // release for them.
                if let Some(parsed_source_map) = old_value.get::<ParsedSourceMap>() {
                    // SAFETY: pointer was stored by us and is live until replaced.
                    unsafe { ParsedSourceMap::deref(parsed_source_map) };
                } else if let Some(ism) = old_value.get::<InternalSourceMap>() {
                    // SAFETY: blob was heap-allocated via `put_mappings`
                    // (`Box<[u8]>::into_raw`); the tagged pointer's address IS
                    // the blob's data pointer (InternalSourceMap is a thin view).
                    (InternalSourceMap {
                        data: ism as *const u8,
                    })
                    .free_owned();
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
        let h = hash(path);

        // This lock is for the hash table
        self.lock();

        // This mapping entry is only valid while the mutex is locked
        let Some(mapping) = self.map_mut().get_mut(&h) else {
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
        } else if let Some(provider) = self.provider_from_value(tagged) {
            self.unlock();

            // Do not lock the mutex while we're parsing JSON!
            // The provider FFI handle is kept alive by its owner (JSC / the
            // registrar), which unregisters it before freeing; we did not
            // hold a ref.
            if let Some(parse) = provider.get_source_map(path, Default::default(), hint) {
                if let Some(ref parsed_map) = parse.map {
                    // The mutex is not locked. We have to check the hash table again.
                    // Leak one strong ref into the table.
                    let _ =
                        self.put_value(path, Value::init(Arc::into_raw(Arc::clone(parsed_map))));

                    return parse;
                }
            }

            self.lock();
            // does not have a valid source map. let's not try again
            self.map_mut().remove(&h);

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

    /// Mutex must already be held. Returns the raw table value for `hash` if any.
    pub fn get_value_locked(&mut self, h: u64) -> Option<Value> {
        let raw = *self.map_mut().get(&h)?;
        Some(Value::from(Some(raw)))
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
            name: None,
        })
    }
}
