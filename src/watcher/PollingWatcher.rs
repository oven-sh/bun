//! Stat-polling watch backend for mounts that accept a native watch and then
//! never report a change made on the other side: 9p (WSL2 `/mnt/*`, Docker
//! Desktop on Windows), NFS, SMB, VM shared folders. See `Watcher::init`.

use std::time::Duration;

use bun_collections::{HashMap, IdentityContext};
use bun_core::{Timespec, ZStr};
use bun_sys::{self as sys, PosixStat};

use crate::watcher_impl::{
    Backend, HashType, MAX_COUNT, Op, WatchEvent, WatchItemColumns, WatchItemIndex, WatchItemKind,
    Watcher,
};

pub(crate) const DEFAULT_INTERVAL_MS: u64 = 100;

/// Whether `root` is on a Linux filesystem where inotify does not see changes
/// made by the host or by another client. FUSE and overlayfs are not listed:
/// inotify works on their common local uses.
pub(crate) fn should_auto_poll(root: &[u8]) -> bool {
    #[cfg(target_os = "linux")]
    {
        // include/uapi/linux/magic.h, fs/smb/client/cifsglob.h, fs/smb/common/smb2pdu.h
        const V9FS_MAGIC: u32 = 0x0102_1997;
        const NFS_SUPER_MAGIC: u32 = 0x6969;
        const SMB_SUPER_MAGIC: u32 = 0x517B;
        const CIFS_SUPER_MAGIC: u32 = 0xFF53_4D42;
        const SMB2_SUPER_MAGIC: u32 = 0xFE53_4D42;
        // Parallels shared folders (`prl_fs`).
        const PRL_FS_MAGIC: u32 = 0x7C7C_6673;

        let mut buf = bun_paths::path_buffer_pool::get();
        if root.len() >= buf.len() {
            return false;
        }
        buf[..root.len()].copy_from_slice(root);
        buf[root.len()] = 0;
        let Ok(st) = sys::statfs(ZStr::from_buf(&buf[..], root.len())) else {
            return false;
        };
        // Every magic fits in 32 bits; `f_type` is a 64-bit word on our targets.
        matches!(
            st.f_type as u32,
            V9FS_MAGIC
                | NFS_SUPER_MAGIC
                | SMB_SUPER_MAGIC
                | CIFS_SUPER_MAGIC
                | SMB2_SUPER_MAGIC
                | PRL_FS_MAGIC
        )
    }
    #[cfg(not(target_os = "linux"))]
    {
        let _ = root;
        false
    }
}

#[derive(Clone, Copy, Default, PartialEq, Eq)]
struct Snapshot {
    exists: bool,
    mtime: Timespec,
    size: u64,
    ino: u64,
}

#[derive(Clone, Copy, Default)]
struct Tracked {
    last: Snapshot,
    /// The previous poll did not find the file. Only the second miss in a row
    /// is a DELETE, so an editor that saves in two steps (unlink or rename
    /// away, then create) produces one WRITE.
    missing_once: bool,
}

struct Candidate {
    index: WatchItemIndex,
    hash: HashType,
    /// The NUL-terminated path is `paths[path_start..][..path_len]`.
    path_start: u32,
    path_len: u32,
    /// `None`: `stat` failed with an errno that does not mean "gone".
    now: Option<Snapshot>,
}

pub(crate) struct PollingWatcher {
    interval: Duration,
    /// Keyed by `WatchItem.hash`. Guarded by `Watcher.mutex`.
    tracked: HashMap<HashType, Tracked, IdentityContext<HashType>>,
    /// Watcher-thread scratch, reused by every cycle.
    candidates: Vec<Candidate>,
    paths: Vec<u8>,
}

impl PollingWatcher {
    pub(crate) fn new(interval_ms: u64) -> Self {
        Self {
            interval: Duration::from_millis(interval_ms.max(1)),
            tracked: HashMap::default(),
            candidates: Vec::new(),
            paths: Vec::new(),
        }
    }

    /// Takes the baseline when the file joins the watchlist, so a write that
    /// lands before the first poll is a change. Caller holds `Watcher.mutex`.
    pub(crate) fn register(&mut self, hash: HashType, path: &[u8]) {
        let mut buf = bun_paths::path_buffer_pool::get();
        let last = if path.len() < buf.len() {
            buf[..path.len()].copy_from_slice(path);
            buf[path.len()] = 0;
            stat_path(ZStr::from_buf(&buf[..], path.len())).unwrap_or_default()
        } else {
            Snapshot::default()
        };
        self.tracked.insert(
            hash,
            Tracked {
                last,
                missing_once: false,
            },
        );
    }

    /// Caller holds `Watcher.mutex`.
    pub(crate) fn unregister(&mut self, hash: HashType) {
        self.tracked.remove(&hash);
    }
}

/// `None` when `stat` fails with anything other than ENOENT/ENOTDIR. A network
/// filesystem returns ESTALE, EIO or ETIMEDOUT during a short outage, and the
/// file is still there. The caller keeps the last snapshot.
fn stat_path(path: &ZStr) -> Option<Snapshot> {
    match sys::stat(path) {
        Ok(st) => {
            let st = PosixStat::init(&st);
            Some(Snapshot {
                exists: true,
                mtime: st.mtim,
                size: st.size,
                ino: st.ino,
            })
        }
        Err(err) => match err.get_errno() {
            sys::E::ENOENT | sys::E::ENOTDIR => Some(Snapshot::default()),
            _ => None,
        },
    }
}

/// One cycle: sleep, copy the watched file paths out under the mutex, `stat`
/// them with the mutex released, then diff and dispatch under the mutex.
pub(crate) fn watch_loop_cycle(this: &mut Watcher) -> sys::Result<()> {
    let _flush = bun_core::output::flush_guard();

    let Backend::Polling(poll) = &mut this.platform else {
        unreachable!("polling::watch_loop_cycle on the native backend")
    };

    // `shutdown()` only clears `running`. Sleep in slices so a long interval
    // does not delay the exit of this thread.
    const SLICE: Duration = Duration::from_millis(20);
    let mut remaining = poll.interval;
    while !remaining.is_zero() {
        if !this.running.load() {
            return Ok(());
        }
        let step = remaining.min(SLICE);
        std::thread::sleep(step);
        remaining -= step;
    }
    if !this.running.load() {
        return Ok(());
    }

    let mut candidates = core::mem::take(&mut poll.candidates);
    let mut paths = core::mem::take(&mut poll.paths);
    candidates.clear();
    paths.clear();

    // Other threads only append to the watchlist. Entries move only in
    // `flush_evictions`, which runs on this thread inside the dispatch below,
    // so an index read here names the same entry until then.
    {
        let _guard = this.mutex.lock_guard();
        let file_paths = this.watchlist.items_file_path();
        let hashes = this.watchlist.items_hash();
        let kinds = this.watchlist.items_kind();
        for (i, path) in file_paths.iter().enumerate() {
            if kinds[i] != WatchItemKind::File {
                continue;
            }
            candidates.push(Candidate {
                index: i as WatchItemIndex,
                hash: hashes[i],
                path_start: paths.len() as u32,
                path_len: path.len() as u32,
                now: None,
            });
            paths.extend_from_slice(path);
            paths.push(0);
        }
    }

    for c in &mut candidates {
        let start = c.path_start as usize;
        c.now = stat_path(ZStr::from_buf(&paths[start..], c.path_len as usize));
    }

    let mut event_count: usize = 0;
    {
        let _guard = this.mutex.lock_guard();
        let Backend::Polling(poll) = &mut this.platform else {
            unreachable!()
        };
        for c in &candidates {
            let Some(now) = c.now else { continue };
            let tracked = poll.tracked.entry(c.hash).or_insert_with(|| Tracked {
                last: now,
                missing_once: false,
            });

            let op = if now.exists {
                tracked.missing_once = false;
                if now == tracked.last {
                    continue;
                }
                Op::WRITE
            } else if !tracked.last.exists {
                continue;
            } else if !tracked.missing_once {
                tracked.missing_once = true;
                continue;
            } else {
                Op::DELETE
            };

            // The baseline moves only with an emitted event. The next poll
            // finds a change that does not fit in this batch.
            if event_count == MAX_COUNT {
                break;
            }
            tracked.last = now;
            tracked.missing_once = false;
            this.watch_events[event_count] = WatchEvent {
                index: c.index,
                op,
                name_off: 0,
                name_len: 0,
            };
            event_count += 1;
        }
    }

    if event_count > 0 {
        this.dispatch_file_updates(event_count, 0);
    }

    if let Backend::Polling(poll) = &mut this.platform {
        poll.candidates = candidates;
        poll.paths = paths;
    }
    Ok(())
}
