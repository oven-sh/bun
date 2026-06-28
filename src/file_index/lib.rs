//! In-memory codebase index: path store, parallel ignore-aware crawl, queries.
//! See /tmp/file-index-design.md ("Crate 4: bun_file_index").
//!
//! # Threading model (load-bearing)
//!
//! The [`Store`] is owned, mutated, and read by exactly one thread. It has no
//! locks and is not `Sync`. All concurrency in this crate follows one shape:
//! the owner builds an owned, `Send` job ([`crawl`]), the thread pool produces
//! an owned, inert result ([`CrawlResult`]), and the last worker hands it to a
//! `Send + FnOnce` completion. Workers never see the `Store`.
//!
//! The query functions ([`complete`], [`glob`], [`grep_file`]) are pure: the
//! first two read a `&Store` on the owning thread, the last operates on bytes
//! its caller already read.

mod budget;
mod complete;
mod crawl;
mod glob;
mod grep;
mod store;
#[cfg(test)]
mod test_link_stubs;

pub use budget::BudgetExceeded;
pub use complete::{
    CompleteCache, CompleteMatch, CompleteOptions, DEFAULT_COMPLETE_LIMIT, complete,
    complete_with_cache,
};
pub use crawl::{CrawlOptions, CrawlResult, crawl, crawl_batched};
pub use glob::glob;
pub use grep::{GrepHit, GrepOutcome, GrepQuery, grep_file};
pub use store::{EntryKind, FileId, Meta, Store};
