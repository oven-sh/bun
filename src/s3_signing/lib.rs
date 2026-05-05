#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
pub mod error;
pub mod acl;
pub mod storage_class;

// ── B-1 gate ───────────────────────────────────────────────────────────────
// credentials.rs depends on bun_http (broken at this tier) plus several
// lower-tier symbols not yet on the stub surface (bun_wyhash::Wyhash,
// bun_core::fmt, bun_collections::BoundedArray). Body preserved; un-gate in B-2.
#[cfg(any())]
pub mod credentials;

// ── stub surface for downstream consumers ─────────────────────────────────
#[cfg(not(any()))]
pub mod credentials {
    /// TODO(b1): real S3Credentials lives in gated credentials.rs
    pub struct S3Credentials(());
    /// TODO(b1): real SignResult lives in gated credentials.rs
    pub struct SignResult(());
    /// TODO(b1): real SignOptions lives in gated credentials.rs
    pub struct SignOptions(());
    /// TODO(b1): real SignQueryOptions lives in gated credentials.rs
    pub struct SignQueryOptions(());
}

pub use acl::ACL;
pub use storage_class::StorageClass;
pub use error::{S3Error, ErrorCodeAndMessage};
pub use credentials::*;
