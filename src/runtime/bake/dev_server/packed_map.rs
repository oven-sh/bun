//! `DevServer.PackedMap` — compact source-map slice (VLQ mappings + line
//! count) shared between `IncrementalGraph` files and `SourceMapStore`
//! entries. Full body (`from_chunk`, `Shared::ref_/deref_`) lives in the
//! gated `../DevServer/PackedMap.rs` draft.

/// Line count newtype (mappings are 1-based; `0` = no mapping).
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Hash, Debug, Default)]
pub struct LineCount(pub u32);

pub struct PackedMap {
    pub vlq: Box<[u8]>,
    pub end_state: bun_sourcemap::SourceMapState,
    pub line_count: LineCount,
}

/// `PackedMap.Shared` — intrusive `Rc<PackedMap>` (Zig used `RefCount(...)`;
/// non-FFI, so plain `Rc`).
pub type Shared = Option<std::rc::Rc<PackedMap>>;
