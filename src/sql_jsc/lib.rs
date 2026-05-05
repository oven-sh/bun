#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// ──────────────────────────────────────────────────────────────────────────
// B-1 gate-and-stub: Phase-A draft bodies preserved on disk but gated out of
// compilation behind `#[cfg(any())]`. Minimal stub surface re-exposed below.
// Un-gating happens in B-2 once lower-tier crates (bun_jsc, bun_runtime,
// bun_sql) expose the required symbols.
// ──────────────────────────────────────────────────────────────────────────

#[cfg(any())]
pub mod mysql;
#[cfg(any())]
pub mod postgres;

// TODO(b1): `shared/` submodules (CachedStructure, ObjectIterator,
// QueryBindingIterator, SQLDataCell) are not yet wired into the module tree.
// They depend on bun_jsc::{JSValue, JSGlobalObject, Structure} which are
// currently stub-only. Wire in B-2.

// ─── stub surface ─────────────────────────────────────────────────────────

#[cfg(not(any()))]
pub mod mysql {
    // TODO(b1): bun_jsc::{JSGlobalObject, JSValue, JSFunction} missing/unstable;
    // TODO(b1): bun_str::ZigString missing (crate is bun_string);
    // TODO(b1): submodule filenames are PascalCase (JSMySQLConnection.rs) but
    //           draft mod decls use snake_case — fix in B-2.
    pub struct MySQLConnection(());
    pub struct MySQLQuery(());
    pub struct MySQLContext(());
    pub struct MySQLStatement(());

    pub fn create_binding(_global_object: *mut core::ffi::c_void) -> *mut core::ffi::c_void {
        todo!("b1: mysql::create_binding gated")
    }
}

#[cfg(not(any()))]
pub mod postgres {
    // TODO(b1): bun_jsc::{JSGlobalObject, JSValue, JSFunction} missing/unstable;
    // TODO(b1): bun_sql::postgres::{postgres_protocol, postgres_types} missing;
    // TODO(b1): submodule filenames are PascalCase (PostgresSQLConnection.rs)
    //           but draft mod decls use snake_case — fix in B-2.
    pub struct PostgresSQLConnection(());
    pub struct PostgresSQLQuery(());
    pub struct PostgresSQLContext(());
    pub struct PostgresSQLStatement(());

    pub fn create_binding(_global_object: *mut core::ffi::c_void) -> *mut core::ffi::c_void {
        todo!("b1: postgres::create_binding gated")
    }
}
