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
pub mod watcher_trace;

#[path = "Watcher.rs"]
pub mod watcher_impl;

// ─── public re-exports ────────────────────────────────────────────────────

pub use WatchItemKind as Kind;
pub use watcher_impl::{
    AnyResolveWatcher, ChangedFilePath, Event, HashType, Item, ItemList, MAX_COUNT,
    MAX_EVICTION_COUNT, Op, PackageJSON, REQUIRES_FILE_DESCRIPTORS, WATCH_OPEN_FLAGS, WatchEvent,
    WatchItem, WatchItemColumns, WatchItemIndex, WatchItemKind, WatchList, Watcher, WatcherContext,
};

/// The watcher only stores `Loader` in `WatchItem.loader` and passes it
/// through. `bun_ast` has no dependency on `bun_watcher`, so depending on the
/// real type is acyclic; re-exporting it replaces the old duplicate `u8`
/// newtype (and the compile-time drift guard that kept the two in sync).
pub use bun_ast::Loader;
