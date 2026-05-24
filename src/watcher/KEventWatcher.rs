use core::ffi::c_int;

use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type EventListIndex = u32;
pub(crate) type Platform = KEventWatcher;

#[derive(Default)]
pub struct KEventWatcher {
    // Everything being watched
    pub eventlist_index: EventListIndex,

    pub fd: Option<Fd>,
}

const CHANGELIST_COUNT: usize = 128;

impl KEventWatcher {
    // TODO(port): narrow error set
    pub fn init(&mut self, _: &[u8]) -> Result<(), bun_core::Error> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(bun_core::err!("KQueueError"));
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

    // Give the events more time to coalesce
    if count < 128 / 2 {
        let remain: c_int = 128 - count;
        let off = usize::try_from(count).expect("int cast");
        let ts = libc::timespec {
            tv_sec: 0,
            tv_nsec: 100_000,
        }; // 0.0001 seconds
        // SAFETY: off < CHANGELIST_COUNT (count < 64), remain entries fit in the buffer
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

        count += extra;
    }

    let changes_len = usize::try_from(count.max(0)).expect("int cast");
    let changes = &changelist[0..changes_len];
    // PORT NOTE: reshaped for borrowck — Zig re-slices `watchevents` in place; Rust tracks out_len
    // and slices once at the end to avoid overlapping &mut borrows of `this`.
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
    // and unlocks on Drop — Zig: `this.mutex.lock(); defer this.mutex.unlock();`.
    let _guard = this.mutex.lock_guard();
    if this.running.load() {
        // PORT NOTE: reshaped for borrowck — copy the (small, ≤128) deduped slice
        // into a local so `this` is no longer mutably borrowed via `watch_events`
        // when calling `write_trace_events(&self, …)`.
        let mut deduped: Vec<WatchEvent> = this.watch_events[0..out_len].to_vec();
        let changed = &this.changed_filepaths[0..out_len];
        this.write_trace_events(&deduped, changed);
        (this.on_file_update)(this.ctx, &mut deduped, changed, &this.watchlist);
    }

    // Zig: `defer Output.flush()`. No early returns above, so flush once at the
    // single exit point instead of via scopeguard.
    Output::flush();
    Ok(())
}

// ported from: src/watcher/KEventWatcher.zig
