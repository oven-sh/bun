//! `DevServer.IncrementalGraph(side)` — port of `IncrementalGraph.zig`.
//!
//! The Phase-A draft formerly defined a *second*, layout-incompatible
//! `IncrementalGraph<S: GraphSide>` struct here (trait-param `Client`/`Server`
//! markers, `ArrayHashMap<Box<[u8]>, S::FilePacked>`, `Vec<OptionalEdgeIndex>`)
//! parallel to the canonical `dev_server::incremental_graph::IncrementalGraph
//! <const SIDE>` actually held in `DevServer.{client,server}_graph`. Its
//! `owner()` did `offset_of!(DevServer, client_graph)` against the *other*
//! type's field and cast `self` — UB if it ever ran. Nothing instantiated the
//! draft type and nothing imported from this module via
//! `incremental_graph_body::*`, so every method body was dead-compiled.
//!
//! That draft has been **dissolved**: the canonical struct, all method bodies
//! (`receive_chunk`, `process_chunk_dependencies`, `trace_dependencies`,
//! `trace_imports`, `insert_*`, `invalidate`, `take_js_bundle*`,
//! `take_source_map`, …), and all associated newtypes live in
//! `crate::bake::dev_server::incremental_graph` and are re-exported here so
//! `incremental_graph_body` resolves to the same nominal types. Per-side
//! `ServerFile`/`ClientFile` are folded into the canonical `File` (see the
//! `TODO(port)` there for the eventual layout split).

pub use crate::bake::dev_server::incremental_graph::*;
