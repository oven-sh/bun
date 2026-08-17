#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
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
pub use error::{Error, Result, ThrowSqlError};

pub mod jsc;
pub use jsc::{CallFrame, JSGlobalObject, JSValue};

pub mod mysql;
pub mod postgres;

pub mod shared {
    #[path = "CachedStructure.rs"]
    pub mod cached_structure;

    #[path = "ConnectionCtorArgs.rs"]
    pub mod connection_ctor_args;

    pub mod datetime_text;

    #[path = "ObjectIterator.rs"]
    pub mod object_iterator;

    #[path = "QueryBindingIterator.rs"]
    pub mod query_binding_iterator;

    #[path = "QueryCtorArgs.rs"]
    pub mod query_ctor_args;

    #[path = "SQLDataCell.rs"]
    pub mod sql_data_cell;

    pub use cached_structure::CachedStructure;
    pub(crate) use query_binding_iterator::QueryBindingIterator;
    pub use query_ctor_args::{SimpleQuery, UseBigint};

    bun_core::bool_enum!(
        /// Whether a result delivered to a query is the final one (vs. a partial response).
        pub IsLast
    );
}
