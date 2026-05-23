#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

// ──────────────────────────────────────────────────────────────────────────
// Module tree wired with explicit `#[path]` attrs (files use PascalCase
// basenames, mirroring the Zig sources). Heavy leaf modules remain
// individually gated with `// TODO(port):` markers naming the
// lower-tier symbol they need. Un-gate one-by-one as `bun_jsc` /
// `bun_string` / `bun_runtime` grow real method surfaces.
// ──────────────────────────────────────────────────────────────────────────

// Local signature-compatible stubs for the JSC surface this crate names.
// Method signatures mirror `bun_jsc` exactly so once `bun_jsc` is taken on
// directly this whole module becomes `pub use bun_jsc as jsc;` with no
// callsite churn.
pub mod jsc;
pub use jsc::{CallFrame, JSGlobalObject, JSValue};

pub mod mysql;
pub mod postgres;

pub mod shared {
    #[path = "CachedStructure.rs"]
    pub mod cached_structure;

    #[path = "ObjectIterator.rs"]
    pub mod object_iterator;

    #[path = "QueryBindingIterator.rs"]
    pub mod query_binding_iterator;

    #[path = "SQLDataCell.rs"]
    pub mod sql_data_cell;

    pub use cached_structure::CachedStructure;
    pub use object_iterator::ObjectIterator;
    pub use query_binding_iterator::QueryBindingIterator;
    pub use sql_data_cell::SQLDataCell;
}
