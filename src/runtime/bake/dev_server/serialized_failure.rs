//! `DevServer.SerializedFailure` — bundling/eval failures stored in HMR wire
//! format so serialization happens once. Full body (`init_from_log`,
//! `init_from_js`, wire encode) lives in the gated
//! `../DevServer/SerializedFailure.rs` draft (blocked on `bun_logger::Msg`
//! field access + `bun_jsc` exception formatting).

use super::incremental_graph::FileIndex;
use crate::bake::Side;

// Re-export the full enum form from the Phase-A body module so callers can
// match on `serialized_failure::Owner::{None,Route,Client,Server}`.
pub use super::serialized_failure_body::{Owner, Packed, PackedKind};

/// `SerializedFailure.Owner` — `packed struct(u32)` (1-bit side + 31-bit idx).
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug)]
pub struct OwnerPacked(pub u32);
impl OwnerPacked {
    #[inline] pub fn new(side: Side, file: FileIndex) -> Self {
        Self(file.get() | ((side as u32) << 31))
    }
    #[inline] pub fn side(self) -> Side {
        // SAFETY: Side is #[repr(u8)] with variants {0,1}.
        unsafe { core::mem::transmute::<u8, Side>((self.0 >> 31) as u8) }
    }
    #[inline] pub fn file(self) -> FileIndex { FileIndex(self.0 & 0x7FFF_FFFF) }
}

/// Stored in `dev.bundling_failures` keyed by its `OwnerPacked` (custom hash
/// ctx in Zig: `ArrayHashContextViaOwner`).
pub struct SerializedFailure {
    pub owner: OwnerPacked,
    /// Wire-format bytes (length-prefixed; see `hmr-runtime-error.ts`).
    pub data: Box<[u8]>,
}

impl SerializedFailure {
    /// `SerializedFailure.getOwner` — decodes the leading 4-byte `Owner.Packed`
    /// from `data` (Zig: `std.mem.bytesAsValue(Owner.Packed, data[0..4]).decode()`).
    pub fn get_owner(&self) -> Owner {
        let raw = u32::from_le_bytes(self.data[0..4].try_into().unwrap());
        Packed::from_bits(raw).decode()
    }

    /// `SerializedFailure.deinit` — releases `data`. The dev-server owns the
    /// allocator in Zig; here `Box<[u8]>` drop suffices, but we keep the
    /// signature so call sites stay 1:1 with the spec.
    pub fn deinit<D>(&self, _dev: &D) {
        // Drop happens via owner; nothing to do for the borrow form used by
        // `index_failures` (which iterates `&SerializedFailure`).
    }
}

