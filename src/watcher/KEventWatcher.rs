use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

#[derive(Default)]
pub struct KEventWatcher {
    pub fd: Option<Fd>,
}

const CHANGELIST_COUNT: usize = 128;

impl KEventWatcher {
    pub fn init(&mut self, _: &[u8]) -> crate::Result<()> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }
        self.fd = Some(fd);
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
    // Zig: `defer Output.flush()` — flushes on the `?` early returns below
    // too (mirrors INotifyWatcher's watch_loop_cycle).
    let _flush = Output::flush_guard();

    let fd: Fd = this
        .platform
        .fd
        .expect("KEventWatcher has an invalid file descriptor");

    // not initialized each time
    // SAFETY: all-zero is a valid Kevent (#[repr(C)] POD)
    let mut changelist_array: [libc::kevent; CHANGELIST_COUNT] = bun_core::ffi::zeroed();
    let changelist = &mut changelist_array;

    // kevent(2) returns -1 on failure (e.g. EINTR). Zig called the raw syscall
    // and let a negative count fall through `@max(0, count)` into an empty
    // batch; the direct port's checked `usize::try_from(count)` panicked on
    // that -1 instead. Use the EINTR-retrying `bun_sys::kevent` wrapper and
    // propagate real errors to the watch loop.
    let mut count: usize = bun_sys::kevent(fd, &[], changelist, None)?;

    // Give the events more time to coalesce
    if count < CHANGELIST_COUNT / 2 {
        let ts = libc::timespec {
            tv_sec: 0,
            tv_nsec: 100_000,
        }; // 0.0001 seconds
        // Best-effort coalescing read: deliver the events we already have even
        // if this extra poll fails; a persistent kqueue error resurfaces on the
        // next cycle's blocking call.
        count += bun_sys::kevent(fd, &[], &mut changelist[count..], Some(&ts)).unwrap_or(0);
    }

    let changes_len = count;
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

    Ok(())
}
