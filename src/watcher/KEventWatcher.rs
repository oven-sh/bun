use core::ffi::c_int;

use bun_core::{env_var, output as Output};
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type EventListIndex = u32;
pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    // Everything being watched
    pub eventlist_index: EventListIndex,

    pub fd: Option<Fd>,
    /// See `INotifyWatcher::coalesce_interval` for rationale. Honours the
    /// same env var (despite its Linux-centric name) so tests can pin the
    /// window uniformly across platforms.
    pub coalesce_interval_ns: isize,
}

impl Default for KEventWatcher {
    fn default() -> Self {
        Self {
            eventlist_index: 0,
            fd: None,
            coalesce_interval_ns: DEFAULT_COALESCE_INTERVAL_NS,
        }
    }
}

const CHANGELIST_COUNT: usize = 128;
const DEFAULT_COALESCE_INTERVAL_NS: isize = 10_000_000; // 10ms
/// `kevent()` returns as soon as one event is ready rather than waiting
/// the full timeout, so a burst of N writes a few ms apart consumes ~N
/// drain iterations. Keep this in step with
/// `INotifyWatcher::MAX_COALESCE_ITERATIONS` so the same save burst
/// collapses into one cycle on both backends; the quiet-timeout `break`
/// still terminates the common case after one idle interval.
const MAX_COALESCE_ITERATIONS: u32 = 32;

impl KEventWatcher {
    pub fn init(&mut self, _: &[u8]) -> Result<(), bun_core::Error> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(bun_core::err!("KQueueError"));
        }
        self.fd = Some(fd);
        self.coalesce_interval_ns = env_var::BUN_INOTIFY_COALESCE_INTERVAL
            .get()
            .and_then(|v| isize::try_from(v).ok())
            .unwrap_or(DEFAULT_COALESCE_INTERVAL_NS);
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(fd) = self.fd.take() {
            let _ = bun_sys::close(fd);
        }
    }
}

pub(crate) fn watch_event_from_kevent(kevent: &libc::kevent) -> WatchEvent {
    let mut op = Op::empty();
    if (kevent.fflags & libc::NOTE_DELETE) > 0 {
        op |= Op::DELETE;
    }
    if (kevent.fflags & libc::NOTE_ATTRIB) > 0 {
        op |= Op::METADATA;
    }
    if (kevent.fflags & (libc::NOTE_RENAME | libc::NOTE_LINK)) > 0 {
        op |= Op::RENAME;
    }
    if (kevent.fflags & libc::NOTE_WRITE) > 0 {
        op |= Op::WRITE;
    }
    WatchEvent {
        op,
        // @truncate(kevent.udata)
        index: kevent.udata as _,
        ..Default::default()
    }
}

pub(crate) fn watch_loop_cycle(this: &mut Watcher) -> bun_sys::Result<()> {
    use bun_sys::c;
    let fd: Fd = this
        .platform
        .fd
        .expect("KEventWatcher has an invalid file descriptor");

    // not initialized each time
    // SAFETY: all-zero is a valid Kevent (#[repr(C)] POD)
    let mut changelist_array: [libc::kevent; CHANGELIST_COUNT] = bun_core::ffi::zeroed();
    let changelist = &mut changelist_array;

    // SAFETY: fd is a valid kqueue fd; changelist points to CHANGELIST_COUNT zeroed entries
    let mut count: c_int = unsafe {
        c::kevent(
            fd.native(),
            changelist.as_ptr(),
            0,
            changelist.as_mut_ptr(),
            CHANGELIST_COUNT as c_int,
            core::ptr::null(), // timeout
        )
    };

    // A single editor save typically produces several kevents a few ms
    // apart (e.g. NOTE_WRITE on the file plus NOTE_WRITE on its parent
    // directory, or the rename/create pair from an atomic save). Keep
    // draining until the queue stays quiet for `coalesce_interval_ns`
    // so one save becomes one `on_file_update` call instead of several,
    // which in `--hot` mode would otherwise re-evaluate the entry point
    // once per burst.
    //
    // `count > 0` guards against the initial `kevent` returning -1
    // (error) — the `.max(0)` below already handles that for the final
    // slice, but the `as usize` offset cast here would wrap on a
    // negative.
    const NS_PER_S: isize = 1_000_000_000;
    let interval = this.platform.coalesce_interval_ns;
    let mut iterations: u32 = 0;
    while count > 0 && count < CHANGELIST_COUNT as c_int && iterations < MAX_COALESCE_ITERATIONS {
        let remain: c_int = CHANGELIST_COUNT as c_int - count;
        let off = count as usize;
        // POSIX requires tv_nsec < 10^9; split so a user-supplied
        // interval ≥ 1 s doesn't make `kevent` fail with EINVAL.
        let ts = libc::timespec {
            tv_sec: (interval / NS_PER_S) as _,
            tv_nsec: (interval % NS_PER_S) as _,
        };
        // SAFETY: off < CHANGELIST_COUNT (count > 0 and < 128),
        // remain entries fit in the buffer
        let extra: c_int = unsafe {
            c::kevent(
                fd.native(),
                changelist.as_ptr().add(off),
                0,
                changelist.as_mut_ptr().add(off),
                remain,
                &raw const ts,
            )
        };

        if extra <= 0 {
            break; // quiet (or error: fall through to existing processing)
        }
        count += extra;
        iterations += 1;
    }

    let changes_len = usize::try_from(count.max(0)).expect("int cast");
    let changes = &changelist[0..changes_len];
    // Track out_len and slice once at the end to avoid overlapping &mut
    // borrows of `this`.
    let watchevents = &mut this.watch_events[0..changes_len];
    let mut out_len: usize = 0;
    if changes_len > 0 {
        watchevents[0] = watch_event_from_kevent(&changes[0]);
        out_len = 1;
        let mut prev_event = changes[0];
        for event in &changes[1..] {
            if prev_event.udata == event.udata {
                let new = watch_event_from_kevent(event);
                watchevents[out_len - 1].merge(new);
                continue;
            }

            watchevents[out_len] = watch_event_from_kevent(event);
            prev_event = *event;
            out_len += 1;
        }
    }

    // RAII: `MutexGuard` holds the mutex by raw pointer (no borrow of `this`)
    // and unlocks on Drop.
    let _guard = this.mutex.lock_guard();
    if this.running.load() {
        // reshaped for borrowck — copy the (small, ≤128) deduped slice
        // into a local so `this` is no longer mutably borrowed via `watch_events`
        // when calling `write_trace_events(&self, …)`.
        let mut deduped: Vec<WatchEvent> = this.watch_events[0..out_len].to_vec();
        let changed = &this.changed_filepaths[0..out_len];
        this.write_trace_events(&deduped, changed);
        (this.on_file_update)(this.ctx, &mut deduped, changed, &this.watchlist);
    }

    // No early returns above, so flush once at the single exit point instead
    // of via scopeguard.
    Output::flush();
    Ok(())
}
