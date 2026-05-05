#![allow(unused, non_snake_case, non_camel_case_types, non_upper_case_globals, clippy::all)]
// AUTOGEN: mod declarations only — real exports added in B-1.
//
// B-1 gate-and-stub: all Phase-A draft modules are gated behind `#[cfg(any())]`
// because they depend on lower-tier crate surface that is itself still gated
// (bun_sys::c, bun_sys::linux, bun_sys::windows, bun_core::env_var, bun_core::fmt,
// bun_str, bun_fs, bun_output, bun_options_types, etc.). The draft bodies are
// preserved on disk for B-2 un-gating.
//
// A minimal stub surface is exposed below so downstream crates can name the
// public types. All behavior is `todo!()`.

#[cfg(any())] pub mod KEventWatcher;
#[cfg(any())] pub mod WatcherTrace;
#[cfg(any())] pub mod WindowsWatcher;
#[cfg(any())] pub mod INotifyWatcher;
#[cfg(any())] #[path = "Watcher.rs"] pub mod watcher_impl;

// ---------------------------------------------------------------------------
// Stub surface
// ---------------------------------------------------------------------------

pub type HashType = u32;
pub type WatchItemIndex = u16;

pub const MAX_COUNT: usize = 128;
pub const MAX_EVICTION_COUNT: usize = 8096;
pub const REQUIRES_FILE_DESCRIPTORS: bool = false;

/// Opaque stub for the file watcher. Real impl lives in `Watcher.rs` (gated).
#[derive(Default)]
pub struct Watcher(());

impl Watcher {
    pub fn get_hash(_path: &str) -> HashType {
        // TODO(b1): real impl in Watcher.rs (wyhash of path)
        todo!("bun_watcher::Watcher::get_hash stub")
    }
}

/// Stub for a single watch event.
#[derive(Default, Clone, Copy)]
pub struct WatchEvent {
    pub index: WatchItemIndex,
    pub op: Op,
    pub name_off: u32,
    pub name_len: u32,
}
pub type Event = WatchEvent;

bitflags::bitflags! {
    #[derive(Default, Clone, Copy, PartialEq, Eq)]
    pub struct Op: u8 {
        const delete = 1 << 0;
        const rename = 1 << 1;
        const write = 1 << 2;
        const move_to = 1 << 3;
    }
}

/// Stub for a watched item (file or directory).
#[derive(Default)]
pub struct WatchItem(());
pub type Item = WatchItem;

/// Kind of watched item.
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WatchItemKind {
    File,
    Directory,
}
pub use WatchItemKind as Kind;

// TODO(b1): real WatchList is `bun_collections::MultiArrayList<WatchItem>`, but
// MultiArrayList's stub surface lacks Default/len/items. Use an opaque newtype.
#[derive(Default)]
pub struct WatchList(());
pub type ItemList = WatchList;

pub type ChangedFilePath = Option<Box<core::ffi::CStr>>;

// TODO(b1): bun_options_types::PackageJSON missing — local placeholder.
pub struct PackageJSON(());

pub struct AnyResolveWatcher(());

pub trait WatcherContext {}

/// Stub re-export namespace so `bun_watcher::inotify_watcher::Event` resolves.
pub mod inotify_watcher {
    pub type Event = super::WatchEvent;
}
