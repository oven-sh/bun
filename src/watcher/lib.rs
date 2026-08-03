#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
#![allow(unexpected_cfgs)]
//! Bun's cross-platform filesystem watcher.

// ─── platform impls ───────────────────────────────────────────────────────
//
// Each platform watcher is compiled only for its target. A host build never
// compiles the non-native backends.

// Android: same kernel inotify ABI as glibc/musl Linux.
#[cfg(any(target_os = "linux", target_os = "android"))]
#[path = "INotifyWatcher.rs"]
pub mod inotify_watcher;

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
#[path = "KEventWatcher.rs"]
pub mod kevent_watcher;

#[cfg(windows)]
#[path = "WindowsWatcher.rs"]
pub mod windows_watcher;

#[path = "WatcherTrace.rs"]
pub(crate) mod watcher_trace;

#[path = "Watcher.rs"]
pub mod watcher_impl;

pub mod error;

// ─── public re-exports ────────────────────────────────────────────────────

pub use error::{Error, Result};

pub use WatchItemKind as Kind;
pub use watcher_impl::{
    AnyResolveWatcher, ChangedFilePath, Event, HashType, MAX_COUNT, MAX_EVICTION_COUNT, Op,
    PackageJSON, REQUIRES_FILE_DESCRIPTORS, WATCH_OPEN_FLAGS, WatchEvent, WatchItem,
    WatchItemColumns, WatchItemIndex, WatchItemKind, WatchList, Watcher, WatcherContext,
};

// ─── upward-crate placeholders (CYCLEBREAK) ───────────────────────────────
//
// These belong to higher-tier crates that don't yet expose a usable surface
// to depend on. Watcher only stores/passes them through; never dereferenced.

/// Opaque forward-decl of `bun_ast::Loader` (cycle-break: bun_watcher sits
/// below bun_ast in the crate graph). Watcher only stores the value in
/// `WatchItem.loader` and passes it through; callers construct it via
/// `Loader(bun_ast::Loader as u8)` at the boundary.
#[derive(Clone, Copy, Default)]
pub struct Loader(pub u8);
impl Loader {
    /// Mirrors `bun_ast::Loader::File as u8`;
    /// keep the discriminant in sync with `src/ast/loader.rs`. A compile-time
    /// drift guard lives in `src/jsc/hot_reloader.rs` (a crate that sees both
    /// types).
    pub const File: Loader = Loader(5);
}
