//! `DevServer.PackedMap` — compact source-map slice (VLQ mappings + line
//! count) shared between `IncrementalGraph` files and `SourceMapStore`
//! entries. Body lives in `../DevServer/PackedMap.rs` (mounted as
//! `super::packed_map_body`); this module re-exports its types so the
//! un-gated `incremental_graph` / `source_map_store` agree on `Shared`.

pub use super::packed_map_body::{EndState, LineCount, PackedMap, Shared};

// `Shared` needs `Default` for `incremental_graph::File::default()` (slot is
// always overwritten on `!found_existing`); the body draft doesn't derive it.
impl Default for Shared {
    #[inline]
    fn default() -> Self { Shared::None }
}
