//! `DevServer.Assets` — content-addressable store on `/_bun/asset/{hash}.ext`.

use bun_collections::{ArrayHashMap, MapEntry, StringArrayHashMap};
use bun_core::{fmt as bun_fmt, scoped_log};
use bun_http::MimeType::MimeType;
use bun_ptr::RefPtr;

use super::memory_cost::{memory_cost_array_hash_map, memory_cost_array_list};
use super::{ASSET_PREFIX, DevServer, FileKind, Magic};
use crate::server::StaticRoute;
use crate::server::static_route::InitFromBytesOptions;
use crate::webcore::AnyBlob;

/// `bun.GenericIndex(u30, Assets)`.
pub(crate) enum AssetsMarker {}
pub(crate) type EntryIndex = bun_core::GenericIndex<u32, AssetsMarker>;

#[derive(Default)]
pub(crate) struct Assets {
    /// Keys are absolute paths. `StringArrayHashMap` stores owned `Box<[u8]>`
    /// keys.
    pub(crate) path_map: StringArrayHashMap<EntryIndex>,
    /// Content-addressable store. Multiple paths can point to the same content
    /// hash, tracked by `refs`.
    pub(crate) files: ArrayHashMap<u64, RefPtr<StaticRoute>>,
    /// Parallel to `files`. Never `0`.
    pub(crate) refs: Vec<u32>,
    /// When mutating `files`'s keys, the map must be reindexed to function.
    pub(crate) needs_reindex: bool,
}

impl Assets {
    pub(crate) fn get_hash(&self, path: &[u8]) -> Option<u64> {
        self.path_map
            .get(path)
            .map(|idx| self.files.keys()[idx.get_usize()])
    }
}

impl DevServer {
    /// When an asset is overwritten, it receives a new URL to get around
    /// browser caching. The old URL is immediately revoked.
    ///
    /// `abs_path` is not allocated. Ownership of `contents` is transferred to
    /// this function.
    pub(crate) fn replace_asset_path(
        &mut self,
        abs_path: &[u8],
        mut contents: AnyBlob,
        mime_type: &MimeType,
        content_hash: u64,
    ) -> Result<EntryIndex, bun_alloc::AllocError> {
        debug_assert!(self.magic == Magic::Valid);
        let Self {
            assets,
            client_graph,
            server,
            ..
        } = self;
        // Invariant: `files.count() == refs.len()`, re-checked before each
        // return below.

        // Hex-encodes the *native-endian bytes* of the u64.
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

        debug_assert!(server.is_some());

        // `gop` holds key/value ptrs into `path_map` and cannot stay live
        // across calls that take `&mut Assets`. Capture `index` /
        // `found_existing` and re-derive the value slot at the end instead.
        let gop = assets.path_map.get_or_put(abs_path)?;
        let path_index = gop.index;
        let found_existing = gop.found_existing;
        let existing_entry = if found_existing {
            Some(*gop.value_ptr)
        } else {
            None
        };

        if !found_existing {
            // Locate a stable pointer for the file path.
            // `StringArrayHashMap` owns its keys as `Box<[u8]>`, and
            // `get_or_put` already boxed `abs_path` on insert, so no key
            // reassignment is needed — `insert_empty` is still called for its
            // side effect of registering the file in `client_graph`.
            let _ = client_graph.insert_empty(abs_path, FileKind::Unknown)?;
        } else {
            let entry_index = existing_entry.unwrap();
            // When there is one reference to the asset, the entry can be
            // replaced in-place with the new asset.
            if assets.refs[entry_index.get_usize()] == 1 {
                assets.files.keys_mut()[entry_index.get_usize()] = content_hash;
                assets.files.values_mut()[entry_index.get_usize()] =
                    StaticRoute::init_from_any_blob(
                        contents,
                        InitFromBytesOptions {
                            mime_type: Some(mime_type),
                            server: *server,
                            ..Default::default()
                        },
                    );
                // `ArrayHashMap<u64, _>` keys the entry on the hash itself.
                assets.needs_reindex = true;
                debug_assert_eq!(assets.files.count(), assets.refs.len());
                return Ok(entry_index);
            } else {
                assets.refs[entry_index.get_usize()] -= 1;
                debug_assert!(assets.refs[entry_index.get_usize()] > 0);
            }
        }

        assets.reindex_if_needed()?;
        let file_index = match assets.files.entry(content_hash) {
            MapEntry::Vacant(vacant) => {
                let file_index = vacant.index();
                vacant.insert(StaticRoute::init_from_any_blob(
                    contents,
                    InitFromBytesOptions {
                        mime_type: Some(mime_type),
                        server: *server,
                        ..Default::default()
                    },
                ));
                assets.refs.push(1);
                file_index
            }
            MapEntry::Occupied(occupied) => {
                let file_index = occupied.index();
                assets.refs[file_index] += 1;
                // Release the owned blob on the duplicate-content path.
                contents.detach();
                file_index
            }
        };
        let entry = EntryIndex::init(u32::try_from(file_index).expect("int cast"));
        assets.path_map.values_mut()[path_index] = entry;
        debug_assert_eq!(assets.files.count(), assets.refs.len());
        Ok(entry)
    }
}

impl Assets {
    pub(crate) fn unref_by_index(&mut self, index: EntryIndex, dec_count: u32) {
        debug_assert!(dec_count > 0);
        self.refs[index.get_usize()] -= dec_count;
        if self.refs[index.get_usize()] == 0 {
            drop(self.files.swap_remove_at(index.get_usize()));
            self.refs.swap_remove(index.get_usize());
            // `swap_remove` moved the entry that was at the old last index into
            // `index`'s slot. Any `path_map` value that still points at the old
            // last index (now equal to `files.count()`) must be patched to point
            // at the new slot, otherwise the next lookup for that path would read
            // past the end of `files`/`refs`, or alias an unrelated asset if a
            // new entry is appended afterwards.
            let moved_from = u32::try_from(self.files.count()).expect("int cast");
            if moved_from != index.get() {
                for entry_index in self.path_map.values_mut() {
                    if entry_index.get() == moved_from {
                        *entry_index = index;
                    }
                }
            }
        }
        debug_assert_eq!(self.files.count(), self.refs.len());
    }

    pub(crate) fn unref_by_path(&mut self, path: &[u8]) {
        let Some(entry) = self.path_map.fetch_swap_remove(path) else {
            return;
        };
        self.unref_by_index(entry.value, 1);
    }

    /// `Assets.reindexIfNeeded`.
    pub(crate) fn reindex_if_needed(&mut self) -> Result<(), bun_alloc::AllocError> {
        if self.needs_reindex {
            self.files.re_index()?;
            self.needs_reindex = false;
        }
        Ok(())
    }

    /// Look up a `StaticRoute` by content hash.
    pub(crate) fn get(&self, content_hash: u64) -> Option<&RefPtr<StaticRoute>> {
        debug_assert_eq!(self.files.count(), self.refs.len());
        self.files.get(&content_hash)
    }

    /// `Assets.memoryCost`.
    pub(crate) fn memory_cost(&self) -> usize {
        let mut cost: usize = 0;
        // `StringArrayHashMap` derefs to its inner `ArrayHashMap<Box<[u8]>, V, _>`.
        cost += memory_cost_array_hash_map(&self.path_map);
        for blob in self.files.values() {
            cost += blob.memory_cost();
        }
        cost += memory_cost_array_hash_map(&self.files);
        cost += memory_cost_array_list(&self.refs);
        cost
    }
}
