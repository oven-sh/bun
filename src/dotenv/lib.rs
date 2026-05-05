#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.

// GATED(b1): env_loader.rs depends on unresolved lower-tier surface
// (bun_logger, bun_s3, bun_schema, bun_str, bun_url, bun_which, bun_sys::fs,
// bun_core::time, bun_wyhash::hash) and the unstable `adt_const_params` feature.
// Phase-A draft body is preserved verbatim; un-gate in B-2 once deps land.
#[cfg(any())]
pub mod env_loader;

// ── minimal stub surface (opaque) ──────────────────────────────────────────
// Downstream crates reference these by name only; real defs live in the gated
// module above. Keep these zero-field so callers that only name the type still
// type-check; any field/method access will fail loudly until B-2.

/// Stub: see gated `env_loader::Loader`.
pub struct Loader<'a>(core::marker::PhantomData<&'a ()>);

/// Stub: see gated `env_loader::Map`.
#[derive(Default)]
pub struct Map(());

/// Stub: see gated `env_loader::DotEnvFileSuffix`.
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum DotEnvFileSuffix {
    Development,
    Production,
    Test,
}

/// Stub: see gated `env_loader::DefineStoreVTable`.
pub struct DefineStoreVTable(());

/// Stub: see gated `env_loader::DefineStoreRef`.
pub struct DefineStoreRef<'a>(core::marker::PhantomData<&'a ()>);

/// Stub: see gated `env_loader::HashTableValue`.
pub struct HashTableValue(());

pub static mut INSTANCE: Option<*mut Loader<'static>> = None;
