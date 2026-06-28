//! In-memory codebase index: path store, parallel ignore-aware crawl, queries.
//!
//! This is the engine behind `Bun.FileIndex`: a single-threaded [`Store`] of
//! root-relative path bytes plus pure query functions over it, filled by a
//! parallel, gitignore-aware, enumeration-only crawl. It never touches JSC
//! or the event loop; the runtime layer (`src/runtime/file_index/`) owns all
//! JS marshalling, the filesystem watcher, and git.
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
//!
//! One deliberate extension of that shape: a `complete()` over a large
//! candidate set scores it on the work pool while the owning thread blocks
//! inside the call (see `parallel`). Workers still never see the `Store` —
//! only raw, read-only views that the blocked owner keeps alive — and the
//! call remains synchronous and observationally identical to the sequential
//! path.

mod budget;
mod complete;
mod crawl;
mod exempt;
mod glob;
mod grep;
mod parallel;
mod read;
mod store;
#[cfg(test)]
mod test_link_stubs;

pub use budget::BudgetExceeded;
pub use complete::{
    CompleteCache, CompleteMatch, CompleteOptions, DEFAULT_COMPLETE_LIMIT, complete,
    complete_with_cache,
};
pub use crawl::{CrawlEntry, CrawlOptions, CrawlResult, crawl, crawl_batched};
pub use exempt::{EntryVerdict, ExemptSet, classify_entry, classify_path};
pub use glob::glob;
pub use grep::{BINARY_SNIFF_BYTES, GrepHit, GrepOutcome, GrepQuery, grep_file, is_binary_prefix};
pub use read::{FileReadOutcome, read_regular_at};
pub use store::{EntryKind, FileId, Meta, Store};
