#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
#![allow(unexpected_cfgs)]
//! Bun's cross-platform filesystem watcher.
//!
//! B-2 un-gate: the Phase-A draft modules now compile against the real T0/T1
//! crate surface where it exists. Function bodies that still depend on
//! lower-tier surface that hasn't landed yet (e.g. `bun_sys::linux` raw
//! inotify syscalls, `bun_collections::MultiArrayElement` derive, `bun_fs`)
//! are individually re-gated with `// TODO(b2-blocked): bun_X::Y` markers.

// ─── platform impls ───────────────────────────────────────────────────────
//
// Each platform watcher is compiled only for its target. All three backends
// are now un-gated against their respective `bun_sys` platform surfaces. The
// Windows backend's `init()` body alone remains re-gated on lower-tier
// symbols that have not landed (`bun_windows_sys::ntdll::NtCreateFile`,
// `bun_windows_sys::FILE_OPEN`); see the `TODO(b2-blocked)` marker in
// `WindowsWatcher.rs`. A host build never compiles the non-native backends.

#[cfg(target_os = "linux")]
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

pub use watcher_impl::{
    AnyResolveWatcher, ChangedFilePath, Event, HashType, Item, ItemList, Op, PackageJSON,
    WatchEvent, WatchItem, WatchItemColumns, WatchItemField, WatchItemIndex, WatchItemKind,
    WatchList, Watcher, WatcherContext, MAX_COUNT, MAX_EVICTION_COUNT, REQUIRES_FILE_DESCRIPTORS,
};
pub use WatchItemKind as Kind;

// ─── upward-crate placeholders (CYCLEBREAK) ───────────────────────────────
//
// These belong to higher-tier crates that don't yet expose a usable surface
// to depend on. Watcher only stores/passes them through; never dereferenced.

// TODO(b2-blocked): bun_options_types::Loader
/// Opaque forward-decl of `bun_options_types::Loader`. Watcher only stores
/// the value in `WatchItem.loader` and passes it through.
#[derive(Clone, Copy, Default)]
pub struct Loader(pub u8);
impl Loader {
    pub const File: Loader = Loader(0);
}
