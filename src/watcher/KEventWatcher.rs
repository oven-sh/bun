use core::ffi::c_int;

use bun_core::Output;
use bun_sys::Fd;
// TODO(port): verify exact module path for libc Kevent struct + NOTE_* constants + kevent() syscall
use bun_sys::c::{self, Kevent, NOTE_ATTRIB, NOTE_DELETE, NOTE_LINK, NOTE_RENAME, NOTE_WRITE};

use crate::Watcher;

pub type EventListIndex = u32;

pub struct KEventWatcher {
    // Everything being watched
    pub eventlist_index: EventListIndex,

    pub fd: Option<Fd>,
}

impl Default for KEventWatcher {
    fn default() -> Self {
        Self {
            eventlist_index: 0,
            fd: None,
        }
    }
}

const CHANGELIST_COUNT: usize = 128;

impl KEventWatcher {
    // TODO(port): narrow error set
    pub fn init(&mut self, _: &[u8]) -> Result<(), bun_core::Error> {
        // TODO(port): std.posix.kqueue() — confirm bun_sys wrapper name/signature
        let fd = bun_sys::kqueue()?;
        if fd == 0 {
            return Err(bun_core::err!("KQueueError"));
        }
        self.fd = Some(Fd::from_native(fd));
        Ok(())
    }

    pub fn stop(&mut self) {
        if let Some(fd) = self.fd.take() {
            fd.close();
        }
    }
}

pub fn watch_event_from_kevent(kevent: Kevent) -> crate::Event {
    crate::Event {
        op: crate::Op {
            delete: (kevent.fflags & NOTE_DELETE) > 0,
            metadata: (kevent.fflags & NOTE_ATTRIB) > 0,
            rename: (kevent.fflags & (NOTE_RENAME | NOTE_LINK)) > 0,
            write: (kevent.fflags & NOTE_WRITE) > 0,
        },
        // @truncate(kevent.udata)
        index: kevent.udata as EventListIndex,
    }
}

pub fn watch_loop_cycle(this: &mut Watcher) -> bun_sys::Result<()> {
    let fd: Fd = this
        .platform
        .fd
        .expect("KEventWatcher has an invalid file descriptor");

    // not initialized each time
    // SAFETY: all-zero is a valid Kevent (#[repr(C)] POD)
    let mut changelist_array: [Kevent; CHANGELIST_COUNT] = unsafe { core::mem::zeroed() };
    let changelist = &mut changelist_array;

    let _flush = scopeguard::guard((), |_| Output::flush());

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
        let off = usize::try_from(count).unwrap();
        let ts = c::timespec { tv_sec: 0, tv_nsec: 100_000 }; // 0.0001 seconds
        // SAFETY: off < CHANGELIST_COUNT (count < 64), remain entries fit in the buffer
        let extra: c_int = unsafe {
            c::kevent(
                fd.native(),
                changelist.as_ptr().add(off),
                0,
                changelist.as_mut_ptr().add(off),
                remain,
                &ts,
            )
        };

        count += extra;
    }

    let changes_len = usize::try_from(count.max(0)).unwrap();
    let changes = &changelist[0..changes_len];
    // PORT NOTE: reshaped for borrowck — Zig re-slices `watchevents` in place; Rust tracks out_len
    // and slices once at the end to avoid overlapping &mut borrows of `this`.
    let watchevents = &mut this.watch_events[0..changes_len];
    let mut out_len: usize = 0;
    if changes_len > 0 {
        watchevents[0] = watch_event_from_kevent(changes[0]);
        out_len = 1;
        let mut prev_event = changes[0];
        for &event in &changes[1..] {
            if prev_event.udata == event.udata {
                let new = watch_event_from_kevent(event);
                watchevents[out_len - 1].merge(new);
                continue;
            }

            watchevents[out_len] = watch_event_from_kevent(event);
            prev_event = event;
            out_len += 1;
        }
    }
    let watchevents = &mut this.watch_events[0..out_len];

    // TODO(port): borrowck — `_guard` borrows `this.mutex` while subsequent lines borrow other
    // `this` fields; Phase B may need to split borrows or use a raw lock/unlock pair.
    let _guard = this.mutex.lock();
    if this.running {
        this.write_trace_events(watchevents, &this.changed_filepaths[0..out_len]);
        this.on_file_update(
            this.ctx,
            watchevents,
            &this.changed_filepaths[0..out_len],
            this.watchlist,
        );
    }

    bun_sys::Result::success(())
}

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/watcher/KEventWatcher.zig (108 lines)
//   confidence: medium
//   todos:      4
//   notes:      raw kevent()/kqueue() + NOTE_* need bun_sys::c bindings; watch_loop_cycle has borrowck overlap on Watcher fields (mutex guard vs. watch_events/changed_filepaths)
// ──────────────────────────────────────────────────────────────────────────
