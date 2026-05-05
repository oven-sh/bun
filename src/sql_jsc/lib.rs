#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]

// ──────────────────────────────────────────────────────────────────────────
// B-2: top-level `#[cfg(any())]` gates removed; module tree wired with
// explicit `#[path]` attrs (Phase-A draft files use PascalCase basenames).
// Heavy leaf modules remain individually gated with `// TODO(b2-blocked):`
// markers naming the lower-tier symbol they need. Un-gate one-by-one as
// `bun_jsc` / `bun_string` / `bun_runtime` grow real method surfaces.
// ──────────────────────────────────────────────────────────────────────────

// TODO(b2-blocked): bun_jsc fails to compile (concurrent B-2 work in
// DOMURL.rs / JSBigInt.rs / TopExceptionScope.rs). Until it is green, expose
// local opaque stubs for the handful of JSC types this crate names in
// signatures. Swap to `pub use bun_jsc::{...}` once `bun_jsc` is a dep again.
pub mod jsc {
    #[repr(transparent)]
    #[derive(Debug, Clone, Copy, Default)]
    pub struct JSValue(pub i64);
    #[repr(C)]
    pub struct JSGlobalObject { _opaque: [u8; 0] }
    #[repr(C)]
    pub struct CallFrame { _opaque: [u8; 0] }
}
pub use jsc::{JSValue, JSGlobalObject, CallFrame};

pub mod mysql;
pub mod postgres;

pub mod shared {
    // TODO(b2-blocked): bun_jsc::Strong (type, not module) + bun_jsc::ExternColumnIdentifier
    #[cfg(any())]
    #[path = "CachedStructure.rs"]
    pub mod cached_structure;

    // TODO(b2-blocked): bun_jsc::JSValue::{is_empty_or_undefined_or_null,is_empty,get_own_by_value,is_undefined}
    // TODO(b2-blocked): bun_jsc::JSObject::get_index
    // TODO(b2-blocked): bun_jsc::JSGlobalObject::{throw,has_exception}
    #[cfg(any())]
    #[path = "ObjectIterator.rs"]
    pub mod object_iterator;

    // TODO(b2-blocked): bun_jsc::JSArrayIterator::{init,next,i}
    // TODO(b2-blocked): bun_jsc::JsResult
    #[cfg(any())]
    #[path = "QueryBindingIterator.rs"]
    pub mod query_binding_iterator;

    // TODO(b2-blocked): bun_jsc::js_object::ExternColumnIdentifier
    // TODO(b2-blocked): bun_string::wtf::{RefPtr,StringImpl}
    // TODO(b2-blocked): bun_jsc::JSType (real enum, not opaque stub)
    #[cfg(any())]
    #[path = "SQLDataCell.rs"]
    pub mod sql_data_cell;

    // ─── stub re-exports so sibling crates can name the types ───────────────
    #[cfg(not(any()))]
    pub mod cached_structure {
        #[derive(Default)]
        pub struct CachedStructure(());
    }
    #[cfg(not(any()))]
    pub mod sql_data_cell {
        #[derive(Default)]
        pub struct SQLDataCell(());
        #[derive(Default, Clone, Copy)]
        pub struct Flags {
            pub has_duplicate_columns: bool,
            pub has_named_columns: bool,
            pub has_indexed_columns: bool,
        }
    }
    #[cfg(not(any()))]
    pub mod query_binding_iterator {
        pub enum QueryBindingIterator {}
    }
    #[cfg(not(any()))]
    pub mod object_iterator {
        pub struct ObjectIterator(());
    }

    pub use cached_structure::CachedStructure;
    pub use sql_data_cell::SQLDataCell;
    pub use query_binding_iterator::QueryBindingIterator;
    pub use object_iterator::ObjectIterator;
}
