#![allow(non_snake_case, non_camel_case_types, non_upper_case_globals)]
#![warn(unused_must_use)]
#![allow(unexpected_cfgs)]

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

// TODO(port): bun_ast::Loader
/// Opaque forward-decl of `bun_ast::Loader`. Watcher only stores
/// the value in `WatchItem.loader` and passes it through.
#[derive(Clone, Copy, Default)]
pub struct Loader(pub u8);
impl Loader {
    pub const File: Loader = Loader(0);
}
