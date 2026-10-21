#![warn(unused_must_use)]

// ──────────────────────────────────────────────────────────────────────────
// Module tree wired with explicit `#[path]` attrs (files use PascalCase
// basenames).
// ──────────────────────────────────────────────────────────────────────────

// Local signature-compatible stubs for the JSC surface this crate names.
// Method signatures mirror `bun_jsc` exactly so once `bun_jsc` is taken on
// directly this whole module becomes `pub use bun_jsc as jsc;` with no
// callsite churn.
pub mod error;
pub use error::{Error, Result};

pub(crate) mod generated_bindgen;

pub mod jsc;
pub use jsc::{CallFrame, JSGlobalObject, JSValue};

pub mod mysql;
pub mod postgres;

pub mod shared {
    #[path = "CachedStructure.rs"]
    pub mod cached_structure;

    #[path = "ConnectionCtorArgs.rs"]
    pub mod connection_ctor_args;

    #[path = "ConnectionTimers.rs"]
    pub mod connection_timers;

    pub mod datetime_text;

    #[path = "QueryCtorArgs.rs"]
    pub mod query_ctor_args;

    #[path = "ServerIdentity.rs"]
    pub mod server_identity;

    #[path = "SQLDataCell.rs"]
    pub mod sql_data_cell;

    #[path = "StartTls.rs"]
    pub mod start_tls;

    #[path = "StatementCache.rs"]
    pub mod statement_cache;

    pub use cached_structure::CachedStructure;
    pub(crate) use statement_cache::StatementCache;
}
