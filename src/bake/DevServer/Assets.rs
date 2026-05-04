//! Storage for hashed assets on `/_bun/asset/{hash}.ext`

use core::mem::offset_of;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{fmt as bun_fmt, Output};
use bun_http::MimeType;
use bun_runtime::api::server::StaticRoute;
use bun_runtime::webcore::blob::AnyBlob;

use super::{memory_cost_array_hash_map, memory_cost_array_list, DevServer};

/// Storage for hashed assets on `/_bun/asset/{hash}.ext`
pub struct Assets {
    /// Keys are absolute paths, sharing memory with the keys in IncrementalGraph(.client)
    /// Values are indexes into files
    // PORT NOTE: Zig keys are `[]const u8` slices borrowed from `client_graph`'s key storage
    // (see `replacePath` writing `stable_abs_path` back into `key_ptr`). Phase B must ensure
    // `StringArrayHashMap` can store non-owning byte-slice keys without copying.
    // TODO(port): lifetime — keys alias IncrementalGraph(.client) key storage
    pub path_map: StringArrayHashMap<EntryIndex>,
    /// Content-addressable store. Multiple paths can point to the same content
    /// hash, which is tracked by the `refs` array. One reference is held to
    /// contained StaticRoute instances when they are stored.
    // TODO(port): lifetime — `*StaticRoute` is intrusively ref-counted (deref()); consider IntrusiveRc<StaticRoute>
    pub files: ArrayHashMap<u64, *mut StaticRoute>,
    /// Indexed by the same index of `files`. The value is never `0`.
    pub refs: Vec<u32>,
    /// When mutating `files`'s keys, the map must be reindexed to function.
    pub needs_reindex: bool,
}

impl Default for Assets {
    fn default() -> Self {
        Self {
            path_map: StringArrayHashMap::default(),
            files: ArrayHashMap::default(),
            refs: Vec::new(),
            needs_reindex: false,
        }
    }
}

// Zig: `bun.GenericIndex(u30, Assets)` — newtype index; the `Assets` type-tag is dropped.
// PORT NOTE: Zig used `u30`; Rust has no u30, so we store u32 and debug-assert range in `init`.
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
#[repr(transparent)]
pub struct EntryIndex(u32);

impl EntryIndex {
    #[inline]
    pub const fn init(v: u32) -> Self {
        debug_assert!(v < (1 << 30));
        Self(v)
    }
    #[inline]
    pub const fn get(self) -> usize {
        self.0 as usize
    }
}

impl Assets {
    fn owner(&self) -> &DevServer {
        // SAFETY: `Assets` is only ever constructed as the `assets` field of `DevServer`
        // (intrusive backref via `@fieldParentPtr("assets", assets)` in Zig).
        unsafe {
            &*(self as *const Self as *const u8)
                .sub(offset_of!(DevServer, assets))
                .cast::<DevServer>()
        }
    }

    // PORT NOTE: returns a raw `*mut DevServer` (not `&mut`) because `self` is a field of
    // DevServer — materializing `&mut DevServer` while `&mut self` is live would alias. Zig's
    // `@fieldParentPtr` has no such restriction; callers dereference under `unsafe` and must only
    // touch fields disjoint from `assets`.
    fn owner_mut(&mut self) -> *mut DevServer {
        // SAFETY: see `owner`. Pointer arithmetic only; no reference is formed here.
        unsafe {
            (self as *mut Self as *mut u8)
                .sub(offset_of!(DevServer, assets))
                .cast::<DevServer>()
        }
    }

    pub fn get_hash(&self, path: &[u8]) -> Option<u64> {
        debug_assert!(self.owner().magic == super::Magic::Valid);
        if let Some(idx) = self.path_map.get(path) {
            Some(self.files.keys()[idx.get()])
        } else {
            None
        }
    }

    /// When an asset is overwritten, it receives a new URL to get around browser caching.
    /// The old URL is immediately revoked.
    pub fn replace_path(
        &mut self,
        /// not allocated
        abs_path: &[u8],
        /// Ownership is transferred to this function
        contents: &AnyBlob,
        mime_type: &MimeType,
        /// content hash of the asset
        content_hash: u64,
    ) -> Result<EntryIndex, bun_core::Error> {
        // TODO(port): narrow error set (only alloc + client_graph.insert_empty can fail)
        debug_assert!(self.owner().magic == super::Magic::Valid);
        // Zig: `defer assert(assets.files.count() == assets.refs.items.len);`
        // PORT NOTE: reshaped for borrowck — invariant re-checked before each return below.

        bun_output::scoped_log!(
            DevServer,
            "replacePath {} {} - {}/{} ({})",
            bun_fmt::quote(abs_path),
            content_hash,
            DevServer::ASSET_PREFIX,
            // TODO(port): Zig `std.fmt.bytesToHex(std.mem.asBytes(&content_hash), .lower)` —
            // hex-encodes the *native-endian bytes* of the u64. Provide a helper in bun_core::fmt.
            bun_fmt::bytes_to_hex_lower(&content_hash.to_ne_bytes()),
            bstr::BStr::new(mime_type.value()),
        );

        let gop = self.path_map.get_or_put(abs_path)?;
        if !gop.found_existing {
            // Locate a stable pointer for the file path
            let owner = self.owner_mut();
            // SAFETY: accessing disjoint field `client_graph` via parent ptr; `assets` (self) is
            // not touched through `owner` for the duration of this borrow.
            let stable_abs_path = unsafe { &mut (*owner).client_graph }
                .insert_empty(abs_path, bun_bundler::options::Loader::Unknown)?
                .key;
            // TODO(port): writing a borrowed slice key back into the map entry — see PORT NOTE on `path_map`.
            *gop.key_ptr = stable_abs_path;
        } else {
            let entry_index = *gop.value_ptr;
            // When there is one reference to the asset, the entry can be
            // replaced in-place with the new asset.
            if self.refs[entry_index.get()] == 1 {
                // PORT NOTE: Zig accessed `files.entries.slice()` (MultiArrayList SoA view) and
                // mutated `.key`/`.value` columns directly. Rust ArrayHashMap exposes keys_mut/values_mut.
                let prev = self.files.values()[entry_index.get()];
                // SAFETY: `prev` is a live intrusively-refcounted StaticRoute we hold one ref to.
                unsafe { (*prev).deref() };

                self.files.keys_mut()[entry_index.get()] = content_hash;
                self.files.values_mut()[entry_index.get()] = StaticRoute::init_from_any_blob(
                    contents,
                    StaticRoute::InitOptions {
                        mime_type,
                        server: self.owner().server.expect("unreachable"),
                    },
                );
                // Zig: `comptime assert(@TypeOf(slice.items(.hash)[0]) == void);`
                // PORT NOTE: AutoArrayHashMap<u64, _> stores hashes as `void` (key IS the hash).
                // The Rust ArrayHashMap<u64, _> must uphold the same; nothing to assert at runtime.
                self.needs_reindex = true;
                debug_assert_eq!(self.files.count(), self.refs.len());
                return Ok(entry_index);
            } else {
                self.refs[entry_index.get()] -= 1;
                debug_assert!(self.refs[entry_index.get()] > 0);
            }
        }

        self.reindex_if_needed()?;
        let file_index_gop = self.files.get_or_put(content_hash)?;
        if !file_index_gop.found_existing {
            self.refs.push(1);
            // PERF(port): was assume_capacity-style append in Zig path — profile in Phase B
            *file_index_gop.value_ptr = StaticRoute::init_from_any_blob(
                contents,
                StaticRoute::InitOptions {
                    mime_type,
                    server: self.owner().server.expect("unreachable"),
                },
            );
        } else {
            self.refs[file_index_gop.index] += 1;
            let mut contents_mut = *contents;
            contents_mut.detach();
        }
        *gop.value_ptr = EntryIndex::init(u32::try_from(file_index_gop.index).unwrap());
        debug_assert_eq!(self.files.count(), self.refs.len());
        Ok(*gop.value_ptr)
    }

    /// Returns a pointer to insert the *StaticRoute. If `None` is returned, then it
    /// means there is already data here.
    pub fn put_or_increment_ref_count(
        &mut self,
        content_hash: u64,
        ref_count: u32,
    ) -> Result<Option<&mut *mut StaticRoute>, bun_alloc::AllocError> {
        // Zig: `defer assert(assets.files.count() == assets.refs.items.len);`
        let file_index_gop = self.files.get_or_put(content_hash)?;
        let result = if !file_index_gop.found_existing {
            self.refs.push(ref_count);
            Some(file_index_gop.value_ptr)
        } else {
            self.refs[file_index_gop.index] += ref_count;
            None
        };
        debug_assert_eq!(self.files.count(), self.refs.len());
        Ok(result)
    }

    pub fn unref_by_hash(&mut self, content_hash: u64, dec_count: u32) {
        let index = self.files.get_index(&content_hash).unwrap_or_else(|| {
            Output::panic(format_args!(
                "Asset double unref: {:x?}",
                content_hash.to_ne_bytes()
            ))
        });
        self.unref_by_index(EntryIndex::init(u32::try_from(index).unwrap()), dec_count);
    }

    pub fn unref_by_index(&mut self, index: EntryIndex, dec_count: u32) {
        debug_assert!(dec_count > 0);
        self.refs[index.get()] -= dec_count;
        if self.refs[index.get()] == 0 {
            // SAFETY: value is a live intrusively-refcounted StaticRoute we hold one ref to.
            unsafe { (*self.files.values()[index.get()]).deref() };
            self.files.swap_remove_at(index.get());
            let _ = self.refs.swap_remove(index.get());
            // `swap_remove` moved the entry that was at the old last index into
            // `index`'s slot. Any `path_map` value that still points at the old
            // last index (now equal to `files.count()`) must be patched to point
            // at the new slot, otherwise the next lookup for that path would read
            // past the end of `files`/`refs`, or alias an unrelated asset if a
            // new entry is appended afterwards.
            let moved_from: u32 = u32::try_from(self.files.count()).unwrap();
            if moved_from != index.0 {
                for entry_index in self.path_map.values_mut() {
                    if entry_index.0 == moved_from {
                        *entry_index = index;
                    }
                }
            }
        }
        debug_assert_eq!(self.files.count(), self.refs.len());
    }

    pub fn unref_by_path(&mut self, path: &[u8]) {
        let Some(entry) = self.path_map.fetch_swap_remove(path) else {
            return;
        };
        self.unref_by_index(entry.value, 1);
    }

    pub fn reindex_if_needed(&mut self) -> Result<(), bun_alloc::AllocError> {
        if self.needs_reindex {
            self.files.reindex()?;
            self.needs_reindex = false;
        }
        Ok(())
    }

    pub fn get(&self, content_hash: u64) -> Option<*mut StaticRoute> {
        debug_assert!(self.owner().magic == super::Magic::Valid);
        debug_assert_eq!(self.files.count(), self.refs.len());
        self.files.get(&content_hash).copied()
    }

    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        cost += memory_cost_array_hash_map(&self.path_map);
        for &blob in self.files.values() {
            // SAFETY: every stored StaticRoute pointer is live while held in `files`.
            cost += unsafe { (*blob).memory_cost() };
        }
        cost += memory_cost_array_hash_map(&self.files);
        cost += memory_cost_array_list(&self.refs);
        cost
    }
}

impl Drop for Assets {
    fn drop(&mut self) {
        // Zig `deinit(assets, alloc)`: path_map/files/refs storage is freed by their own Drop;
        // only the manual StaticRoute derefs remain as a side effect.
        for &blob in self.files.values() {
            // SAFETY: we hold one ref to each stored StaticRoute; release it.
            unsafe { (*blob).deref() };
        }
    }
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/bake/DevServer/Assets.zig (193 lines)
//   confidence: medium
//   todos:      5
//   notes:      path_map keys alias client_graph storage (non-owning); ArrayHashMap needs get_or_put/keys_mut/swap_remove_at/reindex; owner_mut kept raw *mut (fieldParentPtr) — callers deref disjoint fields under unsafe.
// ──────────────────────────────────────────────────────────────────────────
