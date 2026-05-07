//! `DevServer.Assets` — content-addressable store on `/_bun/asset/{hash}.ext`.

use core::mem::offset_of;

use bun_collections::{ArrayHashMap, StringArrayHashMap};
use bun_core::{fmt as bun_fmt, scoped_log, Output};
use bun_http::MimeType::MimeType;

use super::memory_cost_body::{memory_cost_array_hash_map, memory_cost_array_list};
use super::{DevServer, FileKind, Magic, ASSET_PREFIX};
use crate::server::static_route::InitFromBytesOptions;
use crate::server::StaticRoute;
use crate::webcore::AnyBlob;

/// `bun.GenericIndex(u30, Assets)`.
// PORT NOTE: Zig used `u30`; Rust has no u30, so store u32 and debug-assert range in `init`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, Default)]
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

#[derive(Default)]
pub struct Assets {
    /// Keys are absolute paths, sharing memory with `IncrementalGraph(.client)`
    /// key storage in Zig (`replacePath` writes `stable_abs_path` back into
    /// `key_ptr`). PORT NOTE: `StringArrayHashMap` stores owned `Box<[u8]>`
    /// keys; the borrow-from-graph optimization is dropped.
    // PERF(port): keys aliased IncrementalGraph storage in Zig.
    pub path_map: StringArrayHashMap<EntryIndex>,
    /// Content-addressable store. Multiple paths can point to the same content
    /// hash, tracked by `refs`. One ref held to each `StaticRoute` while stored
    /// (`StaticRoute` is intrusively ref-counted).
    // SAFETY: `*mut StaticRoute` is an intrusive RefPtr; `deref_()` on remove.
    pub files: ArrayHashMap<u64, *mut StaticRoute>,
    /// Parallel to `files`. Never `0`.
    pub refs: Vec<u32>,
    /// When mutating `files`'s keys, the map must be reindexed to function.
    pub needs_reindex: bool,
}

impl Assets {
    /// `@fieldParentPtr("assets", self)` — intrusive backref.
    #[inline]
    pub(super) fn owner(&self) -> &DevServer {
        // SAFETY: `Assets` is only ever constructed as the `assets` field of
        // `DevServer` (which is `Box`-allocated and never moved post-init).
        unsafe {
            &*(self as *const Self)
                .cast::<u8>()
                .sub(offset_of!(DevServer, assets))
                .cast::<DevServer>()
        }
    }

    /// Mutable variant of `owner`. Returns a raw `*mut DevServer` (not `&mut`)
    /// because `self` is a field of `DevServer` — materializing `&mut DevServer`
    /// while `&mut self` is live would alias. Callers dereference under `unsafe`
    /// and must only touch fields disjoint from `assets`.
    #[inline]
    fn owner_mut(&mut self) -> *mut DevServer {
        // SAFETY: see `owner`. Pointer arithmetic only; no reference is formed here.
        unsafe {
            (self as *mut Self)
                .cast::<u8>()
                .sub(offset_of!(DevServer, assets))
                .cast::<DevServer>()
        }
    }

    pub fn get_hash(&self, path: &[u8]) -> Option<u64> {
        debug_assert!(self.owner().magic == Magic::Valid);
        self.path_map.get(path).map(|idx| self.files.keys()[idx.get()])
    }

    /// When an asset is overwritten, it receives a new URL to get around
    /// browser caching. The old URL is immediately revoked.
    ///
    /// `abs_path` is not allocated. Ownership of `contents` is transferred to
    /// this function (Zig: `Ownership is transferred`).
    pub fn replace_path(
        &mut self,
        abs_path: &[u8],
        mut contents: AnyBlob,
        mime_type: &MimeType,
        content_hash: u64,
    ) -> Result<EntryIndex, bun_alloc::AllocError> {
        debug_assert!(self.owner().magic == Magic::Valid);
        // Zig: `defer assert(assets.files.count() == assets.refs.items.len);`
        // PORT NOTE: reshaped for borrowck — invariant re-checked before each return below.

        // Zig `std.fmt.bytesToHex(std.mem.asBytes(&content_hash), .lower)` —
        // hex-encodes the *native-endian bytes* of the u64.
        let mut hex_buf = [0u8; 16];
        let hex_len = bun_fmt::bytes_to_hex_lower(&content_hash.to_ne_bytes(), &mut hex_buf);
        scoped_log!(
            DevServer,
            "replacePath {} {} - {}/{} ({})",
            bun_fmt::quote(abs_path),
            content_hash,
            ASSET_PREFIX,
            bstr::BStr::new(&hex_buf[..hex_len]),
            bstr::BStr::new(&*mime_type.value),
        );

        // Captured up-front so borrows of `self.files` / `self.path_map` below don't
        // overlap with `owner()` (`&self`) calls. Zig: `assets.owner().server orelse unreachable`.
        let server = self.owner().server;
        debug_assert!(server.is_some());

        // PORT NOTE: reshaped for borrowck — Zig holds `gop` (key/value ptrs into
        // `path_map`) live across calls that take `&mut self`. Capture `index` /
        // `found_existing` and re-derive the value slot at the end instead.
        let gop = self.path_map.get_or_put(abs_path)?;
        let path_index = gop.index;
        let found_existing = gop.found_existing;
        let existing_entry = if found_existing { Some(*gop.value_ptr) } else { None };

        if !found_existing {
            // Locate a stable pointer for the file path.
            // PORT NOTE: in Zig, `path_map` keys borrow `client_graph`'s interned key storage
            // (the `gop.key_ptr.* = stable_abs_path` write shared the slice). Rust
            // `StringArrayHashMap` owns its keys as `Box<[u8]>`, and `get_or_put` already
            // boxed `abs_path` on insert, so the reassignment is a no-op here — we still call
            // `insert_empty` for its side effect of registering the file in `client_graph`.
            let owner = self.owner_mut();
            // SAFETY: accessing disjoint field `client_graph` via parent ptr; `assets` (self) is
            // not touched through `owner` for the duration of this borrow.
            let _ = unsafe { &mut (*owner).client_graph }.insert_empty(abs_path, FileKind::Unknown)?;
        } else {
            let entry_index = existing_entry.unwrap();
            // When there is one reference to the asset, the entry can be
            // replaced in-place with the new asset.
            if self.refs[entry_index.get()] == 1 {
                // PORT NOTE: Zig accessed `files.entries.slice()` (MultiArrayList SoA view) and
                // mutated `.key`/`.value` columns directly. Rust ArrayHashMap exposes keys_mut/values_mut.
                let prev = self.files.values()[entry_index.get()];
                // SAFETY: `prev` is a live intrusively-refcounted StaticRoute we hold one ref to.
                unsafe { StaticRoute::deref_(prev) };

                self.files.keys_mut()[entry_index.get()] = content_hash;
                self.files.values_mut()[entry_index.get()] = StaticRoute::init_from_any_blob(
                    contents,
                    InitFromBytesOptions { mime_type: Some(mime_type), server, ..Default::default() },
                );
                // Zig: `comptime assert(@TypeOf(slice.items(.hash)[0]) == void);`
                // PORT NOTE: AutoArrayHashMap<u64, _> stores hashes as `void` (key IS the hash).
                // The Rust ArrayHashMap<u64, _> upholds the same; nothing to assert at runtime.
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
        let file_index = file_index_gop.index;
        if !file_index_gop.found_existing {
            *file_index_gop.value_ptr = StaticRoute::init_from_any_blob(
                contents,
                InitFromBytesOptions { mime_type: Some(mime_type), server, ..Default::default() },
            );
            self.refs.push(1);
        } else {
            self.refs[file_index] += 1;
            // Zig: `var contents_mut = contents.*; contents_mut.detach();`
            // Release the owned blob on the duplicate-content path.
            contents.detach();
        }
        let entry = EntryIndex::init(u32::try_from(file_index).unwrap());
        self.path_map.values_mut()[path_index] = entry;
        debug_assert_eq!(self.files.count(), self.refs.len());
        Ok(entry)
    }

    /// Returns a slot to insert the `*mut StaticRoute`. If `None` is returned,
    /// then there is already data here.
    pub fn put_or_increment_ref_count(
        &mut self,
        content_hash: u64,
        ref_count: u32,
    ) -> Result<Option<&mut *mut StaticRoute>, bun_alloc::AllocError> {
        // Zig: `defer assert(assets.files.count() == assets.refs.items.len);`
        // PORT NOTE: reshaped for borrowck — `gop.value_ptr` borrows `self.files` mutably,
        // so re-derive the slot via `values_mut()[index]` after the invariant assert.
        let file_index_gop = self.files.get_or_put(content_hash)?;
        let index = file_index_gop.index;
        let found = file_index_gop.found_existing;
        if !found {
            self.refs.push(ref_count);
        } else {
            self.refs[index] += ref_count;
        }
        debug_assert_eq!(self.files.count(), self.refs.len());
        Ok(if found { None } else { Some(&mut self.files.values_mut()[index]) })
    }

    pub fn unref_by_hash(&mut self, content_hash: u64, dec_count: u32) {
        let index = self.files.get_index(&content_hash).unwrap_or_else(|| {
            Output::panic(format_args!("Asset double unref: {:x?}", content_hash.to_ne_bytes()))
        });
        self.unref_by_index(EntryIndex::init(u32::try_from(index).unwrap()), dec_count);
    }

    pub fn unref_by_index(&mut self, index: EntryIndex, dec_count: u32) {
        debug_assert!(dec_count > 0);
        self.refs[index.get()] -= dec_count;
        if self.refs[index.get()] == 0 {
            // SAFETY: value is a live intrusively-refcounted StaticRoute we hold one ref to.
            unsafe { StaticRoute::deref_(self.files.values()[index.get()]) };
            self.files.swap_remove_at(index.get());
            self.refs.swap_remove(index.get());
            // `swap_remove` moved the entry that was at the old last index into
            // `index`'s slot. Any `path_map` value that still points at the old
            // last index (now equal to `files.count()`) must be patched to point
            // at the new slot, otherwise the next lookup for that path would read
            // past the end of `files`/`refs`, or alias an unrelated asset if a
            // new entry is appended afterwards.
            let moved_from = u32::try_from(self.files.count()).unwrap();
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

    /// `Assets.reindexIfNeeded`.
    pub fn reindex_if_needed(&mut self) -> Result<(), bun_alloc::AllocError> {
        if self.needs_reindex {
            self.files.re_index()?;
            self.needs_reindex = false;
        }
        Ok(())
    }

    /// Look up a `StaticRoute` by content hash.
    pub fn get(&self, content_hash: u64) -> Option<*mut StaticRoute> {
        debug_assert!(self.owner().magic == Magic::Valid);
        debug_assert_eq!(self.files.count(), self.refs.len());
        self.files.get(&content_hash).copied()
    }

    /// `Assets.memoryCost`.
    pub fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        // `StringArrayHashMap` derefs to its inner `ArrayHashMap<Box<[u8]>, V, _>`.
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
            unsafe { StaticRoute::deref_(blob) };
        }
    }
}
