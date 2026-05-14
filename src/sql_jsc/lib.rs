#![allow(
    unused,
    non_snake_case,
    non_camel_case_types,
    non_upper_case_globals,
    clippy::all
)]
#![warn(unused_must_use)]

// ──────────────────────────────────────────────────────────────────────────
// B-2: top-level `` gates removed; module tree wired with
// explicit `#[path]` attrs (Phase-A draft files use PascalCase basenames).
// Heavy leaf modules remain individually gated with `// TODO(b2-blocked):`
// markers naming the lower-tier symbol they need. Un-gate one-by-one as
// `bun_jsc` / `bun_string` / `bun_runtime` grow real method surfaces.
// ──────────────────────────────────────────────────────────────────────────

// TODO(b2-blocked): bun_jsc fails to compile (concurrent B-2 work — `Counters`
// missing `Debug` derive at lib.rs:1649). Until it is green, expose local
// signature-compatible stubs for the JSC surface this crate names. Method
// signatures mirror `bun_jsc` exactly so once it compiles this whole module
// becomes `pub use bun_jsc as jsc;` with no callsite churn.
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
