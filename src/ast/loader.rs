// Canonical defs live in bun_core::loader (bun_watcher and bun_http_types sit
// below bun_ast and need the real enum); re-exported here so the ubiquitous
// bun_ast::Loader spelling is unchanged.
pub use bun_core::loader::{LOADER_NAMES, Loader, LoaderOptional, SideEffects};

// E0658: inherent assoc types are nightly-only; lifted to module scope.
pub type LoaderHashTable = bun_collections::StringArrayHashMap<Loader>;
