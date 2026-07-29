//! Stat-polling fallback for filesystems where native change notifications
//! don't fire (Docker/WSL bind mounts, NFS/SMB, virtiofs/9p). Enabled via
//! `BUN_WATCHER_USE_POLLING=1`; interval via `BUN_WATCHER_POLL_INTERVAL` (ms).

use std::time::Duration;

use bun_collections::{HashMap, IdentityContext};
use bun_core::ZStr;
use bun_sys::{self as sys, stat_mtime};

use crate::watcher_impl::{
    Backend, HashType, MAX_COUNT, Op, WatchEvent, WatchItemColumns, WatchItemIndex, WatchItemKind,
    Watcher,
};

bun_core::declare_scope!(watcher, visible);

pub const DEFAULT_INTERVAL_MS: u64 = 100;

#[derive(Clone, Copy, Default)]
struct Snapshot {
    mtime_sec: i64,
    mtime_nsec: i64,
    size: u64,
    ino: u64,
    /// last stat succeeded
    exists: bool,
}

impl Snapshot {
    fn differs(&self, other: &Snapshot) -> bool {
        self.exists != other.exists
            || self.mtime_sec != other.mtime_sec
            || self.mtime_nsec != other.mtime_nsec
            || self.size != other.size
            || self.ino != other.ino
    }
}

pub struct PollingWatcher {
    pub interval: Duration,
    /// Baseline stat per watched file, keyed by `WatchItem.hash` so
    /// `flush_evictions`' `swap_remove` reordering doesn't invalidate state.
    /// Guarded by `Watcher.mutex` (written from `add_file` on the JS thread
    /// and from the watcher thread's diff step).
    snapshots: HashMap<HashType, Snapshot, IdentityContext<HashType>>,
    /// Scratch reused across cycles; only touched by the watcher thread.
    scratch_idx: Vec<(WatchItemIndex, HashType)>,
    scratch_path: Vec<Vec<u8>>,
    scratch_stat: Vec<Snapshot>,
}

impl PollingWatcher {
    pub fn new(interval_ms: u64) -> Self {
        Self {
            interval: Duration::from_millis(interval_ms.max(1)),
            snapshots: HashMap::default(),
            scratch_idx: Vec::new(),
            scratch_path: Vec::new(),
            scratch_stat: Vec::new(),
        }
    }

    /// Capture the baseline stat for `path` at the moment it's registered
    /// (same point where inotify/kqueue would start listening), so a write
    /// that lands between registration and the first poll cycle is detected.
    /// Caller must hold `Watcher.mutex`.
    pub(crate) fn register(&mut self, hash: HashType, path: &[u8]) {
        self.snapshots.insert(hash, stat_path(path));
    }

    pub fn stop(&mut self) {}
}

fn stat_path(path: &[u8]) -> Snapshot {
    let mut buf = bun_paths::path_buffer_pool::get();
    if path.len() >= buf.len() {
        return Snapshot::default();
    }
    buf[..path.len()].copy_from_slice(path);
    buf[path.len()] = 0;
    let z = ZStr::from_buf(&buf[..], path.len());
    match sys::stat(z) {
        Ok(st) => {
            let mt = stat_mtime(&st);
            #[cfg(unix)]
            let (size, ino) = (st.st_size as u64, st.st_ino as u64);
            #[cfg(windows)]
            let (size, ino) = (st.st_size, st.st_ino);
            Snapshot {
                mtime_sec: mt.sec,
                mtime_nsec: mt.nsec,
                size,
                ino,
                exists: true,
            }
        }
        Err(_) => Snapshot::default(),
    }
}

/// One polling cycle: sleep, snapshot the watchlist under the mutex, stat each
/// file, diff against the previous snapshot, emit events.
pub(crate) fn watch_loop_cycle(this: &mut Watcher) -> sys::Result<()> {
    let _flush = bun_core::output::flush_guard();

    let interval = match &this.platform {
        Backend::Polling(p) => p.interval,
        Backend::Native(_) => unreachable!(),
    };

    // Sleep in short slices so `shutdown()` (which clears `running`) doesn't
    // have to wait out a long interval.
    let mut remaining = interval;
    let slice = Duration::from_millis(20);
    while remaining > Duration::ZERO {
        if !this.running.load() {
            return Ok(());
        }
        let step = remaining.min(slice);
        std::thread::sleep(step);
        remaining = remaining.saturating_sub(step);
    }
    if !this.running.load() {
        return Ok(());
    }

    // Move the watcher-thread-only scratch buffers out so `&mut this` stays
    // free for `dispatch_file_updates`; `snapshots` stays in place because the
    // JS thread's `register()` may write it concurrently under `this.mutex`.
    let Backend::Polling(poll) = &mut this.platform else {
        unreachable!()
    };
    let mut scratch_idx = core::mem::take(&mut poll.scratch_idx);
    let mut scratch_path = core::mem::take(&mut poll.scratch_path);
    let mut scratch_stat = core::mem::take(&mut poll.scratch_stat);
    scratch_idx.clear();
    scratch_path.clear();
    scratch_stat.clear();

    // Snapshot (index, hash, path) under the mutex. Between unlock and
    // `dispatch_file_updates`' re-lock the JS thread can only append, so
    // indices stay valid.
    {
        let _guard = this.mutex.lock_guard();
        let paths = this.watchlist.items_file_path();
        let hashes = this.watchlist.items_hash();
        let kinds = this.watchlist.items_kind();
        scratch_idx.reserve(paths.len());
        scratch_path.reserve(paths.len());
        for i in 0..paths.len() {
            if kinds[i] != WatchItemKind::File {
                continue;
            }
            scratch_idx.push((i as WatchItemIndex, hashes[i]));
            scratch_path.push(paths[i].to_vec());
        }
    }

    for path in &scratch_path {
        scratch_stat.push(stat_path(path));
    }

    // Diff under the mutex so `register()` from the JS thread can't interleave.
    let mut event_id: usize = 0;
    {
        let _guard = this.mutex.lock_guard();
        let Backend::Polling(poll) = &mut this.platform else {
            unreachable!()
        };
        for (k, &(index, hash)) in scratch_idx.iter().enumerate() {
            let now = scratch_stat[k];
            let op = match poll.snapshots.get(&hash) {
                Some(prev) if now.differs(prev) => {
                    if now.exists {
                        Op::WRITE
                    } else {
                        Op::DELETE
                    }
                }
                Some(_) => continue,
                None => {
                    poll.snapshots.insert(hash, now);
                    continue;
                }
            };
            poll.snapshots.insert(hash, now);

            if event_id < MAX_COUNT {
                this.watch_events[event_id] = WatchEvent {
                    index,
                    op,
                    name_off: 0,
                    name_len: 0,
                };
                event_id += 1;
            }
        }
    }

    if event_id > 0 {
        this.dispatch_file_updates(event_id, 0);
    }

    if let Backend::Polling(poll) = &mut this.platform {
        poll.scratch_idx = scratch_idx;
        poll.scratch_path = scratch_path;
        poll.scratch_stat = scratch_stat;
    }
    Ok(())
}
