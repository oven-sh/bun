#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]

// ──────────────────────────────────────────────────────────────────────────
// Module tree wired with explicit `#[path]` attrs (files use PascalCase
// basenames).
// ──────────────────────────────────────────────────────────────────────────

// SQL-specific glue over `bun_jsc` (extension traits, codegen, AutoFlusher).
pub mod jsc;

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
    pub use object_iterator::ObjectIterator;
    pub use query_binding_iterator::QueryBindingIterator;
    pub use sql_data_cell::SQLDataCell;
}
