//! `DevServer.Assets` — content-addressable store on `/_bun/asset/{hash}.ext`.
//!
//! Method bodies (`replace_path`, `unrefByPath`, `reindex`) live in the gated
//! `../DevServer/Assets.rs` draft (blocked on `StaticRoute::initFromAnyBlob`
//! + `MimeType::by_extension`).

use core::mem::offset_of;

use bun_collections::{ArrayHashMap, StringArrayHashMap};

use super::{DevServer, Magic};
use crate::server::StaticRoute;

/// `bun.GenericIndex(u30, Assets)`.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct EntryIndex(u32);
impl EntryIndex {
    #[inline] pub const fn init(v: u32) -> Self { debug_assert!(v < (1 << 30)); Self(v) }
    #[inline] pub const fn get(self) -> usize { self.0 as usize }
}

#[derive(Default)]
pub struct Assets {
    /// Keys are absolute paths, sharing memory with `IncrementalGraph(.client)`
    /// key storage (Zig's `replace_path` writes `stable_abs_path` back into
    /// `key_ptr`). PORT NOTE: `StringArrayHashMap` stores owned `Box<[u8]>`
    /// keys; the borrow-from-graph optimization is dropped.
    // PERF(port): keys aliased IncrementalGraph storage in Zig.
    pub path_map: StringArrayHashMap<EntryIndex>,
    /// Content-addressable store. One ref held to each `StaticRoute` while
    /// stored (`StaticRoute` is intrusively ref-counted).
    // SAFETY: `*mut StaticRoute` is an intrusive RefPtr; `deref()` on remove.
    pub files: ArrayHashMap<u64, *mut StaticRoute>,
    /// Parallel to `files`. Never `0`.
    pub refs: Vec<u32>,
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

    pub fn get_hash(&self, path: &[u8]) -> Option<u64> {
        debug_assert!(self.owner().magic == Magic::Valid);
        self.path_map.get(path).map(|idx| self.files.keys()[idx.get()])
    }
}
