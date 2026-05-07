//! `WatcherContext` trait impl for `DevServer` and `WatcherAtomics::init`.
//!
//! `Watcher::init::<DevServer>` dispatches through the generic
//! `WatcherContext` vtable, so the trait methods here are the *only* path the
//! watcher thread reaches — they forward to the inherent
//! `DevServer::{on_file_update, on_watch_error}` bodies in `../DevServer.rs`
//! (ported from `DevServer.zig:4093`/`4153`).
//!
//! Also provides `parse_hex_to_u64`, the asset-hash decoder used by the
//! request handlers.

// `feature = "bake_debugging_features"` is not yet a declared cargo feature; the
// struct field gate must mirror `mod.rs` so the initializer below stays in sync.
#![allow(unexpected_cfgs)]

use super::{DevServer, HotReloadEvent, WatcherAtomics};

// ──────────────────────────────────────────────────────────────────────────
// WatcherContext impl — wires `bun_watcher::Watcher::init::<DevServer>`.
// The watcher's stored fn-ptrs (`on_file_update_wrapped` / `on_error_wrapped`
// in `Watcher::init`) call *these* trait methods, never the inherent ones
// directly, so each forwards to the real ported body on `DevServer`.
// ──────────────────────────────────────────────────────────────────────────
impl bun_watcher::WatcherContext for DevServer {
    fn on_file_update(
        &mut self,
        events: &mut [bun_watcher::WatchEvent],
        changed_files: &[bun_watcher::ChangedFilePath],
        watchlist: &bun_watcher::WatchList,
    ) {
        DevServer::on_file_update(self, events, changed_files, watchlist);
    }

    /// DevServer.zig only defines `onWatchError` (not `onError`); the trait's
    /// default `on_watch_error` would forward here, so route both to the
    /// inherent path-aware impl rather than emitting a generic warn.
    fn on_error(&mut self, err: bun_sys::Error) {
        DevServer::on_watch_error(self, err);
    }

    fn on_watch_error(&mut self, err: bun_sys::Error) {
        DevServer::on_watch_error(self, err);
    }
}


impl WatcherAtomics {
    /// DevServer.zig `WatcherAtomics.init`.
    pub(crate) fn init(owner: *mut DevServer) -> Self {
        let mk_event = || HotReloadEvent::init_empty(owner);
        WatcherAtomics {
            events: [mk_event(), mk_event(), mk_event()],
            next_event: core::sync::atomic::AtomicU8::new(super::NextEvent::DONE.0),
            current_event: None,
            pending_event: None,
            #[cfg(debug_assertions)]
            dbg_watcher_event: None,
            #[cfg(debug_assertions)]
            dbg_server_event: None,
        }
    }
}


/// Parse a 16-char hex slice into a `u64` via native-endian byte
/// reinterpretation. Mirrors DevServer.zig:961-965 exactly:
/// `std.fmt.hexToBytes(&out, slice)` then `@bitCast([8]u8 → u64)` — i.e.
/// pairwise hex-decode into `[u8;8]` then `from_ne_bytes`, NOT a big-endian
/// numeric accumulator. Input `"0100000000000000"` → 1 on little-endian.
pub fn parse_hex_to_u64(slice: &[u8]) -> Option<u64> {
    if slice.len() != 16 {
        return None;
    }
    let mut out = [0u8; 8];
    for i in 0..8 {
        let hi = hex_nibble(slice[i * 2])?;
        let lo = hex_nibble(slice[i * 2 + 1])?;
        out[i] = (hi << 4) | lo;
    }
    Some(u64::from_ne_bytes(out))
}

#[inline]
fn hex_nibble(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
