use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    pub(crate) fd: Fd,
}

const CHANGELIST_COUNT: usize = 128;

/// Idents are per filter, so this cannot collide with an `EVFILT_VNODE` fd.
const WAKE_IDENT: usize = 0;

fn wake_event(flags: u16, fflags: u32) -> libc::kevent {
    let mut ev: libc::kevent = bun_core::ffi::zeroed();
    ev.ident = WAKE_IDENT;
    ev.filter = libc::EVFILT_USER;
    ev.flags = flags;
    ev.fflags = fflags;
    ev
}

impl KEventWatcher {
    pub(crate) fn new(_root: &[u8]) -> crate::Result<Self> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }
        let mut this = Self { fd };
        if let Err(err) = bun_sys::kevent(
            fd,
            &[wake_event(libc::EV_ADD | libc::EV_CLEAR, 0)],
            &mut [],
            None,
        ) {
            this.stop();
            return Err(err.into());
        }
        Ok(this)
    }

    pub(crate) fn stop(&mut self) {
        if self.fd.is_valid() {
            let _ = bun_sys::close(self.fd);
            self.fd = Fd::INVALID;
        }
    }

    /// Runs under `Watcher.mutex`, which `thread_body` takes before `stop()`, so `fd` is open.
    pub(crate) fn wake(&self) {
        let _ = bun_sys::kevent(self.fd, &[wake_event(0, libc::NOTE_TRIGGER)], &mut [], None);
    }
}

fn watch_event_from_kevent(kevent: &libc::kevent) -> WatchEvent {
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
    let _flush = Output::flush_guard();
    let fd = this.platform.fd;

    let mut changelist: [libc::kevent; CHANGELIST_COUNT] = bun_core::ffi::zeroed();

    let mut count = bun_sys::kevent(fd, &[], &mut changelist, None)?;

    // Give the events more time to coalesce
    if count < CHANGELIST_COUNT / 2 {
        let ts = libc::timespec {
            tv_sec: 0,
            tv_nsec: 100_000,
        }; // 0.0001 seconds
        count += bun_sys::kevent(fd, &[], &mut changelist[count..], Some(&ts))?;
    }

    // Drops the `EVFILT_USER` event posted by `wake()`.
    let mut changes = changelist[..count]
        .iter()
        .filter(|event| event.filter == libc::EVFILT_VNODE);
    let watchevents = &mut this.watch_events[..count];
    let mut out_len: usize = 0;
    if let Some(first) = changes.next() {
        watchevents[0] = watch_event_from_kevent(first);
        out_len = 1;
        let mut prev_event = first;
        for event in changes {
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
    if out_len == 0 {
        return Ok(());
    }

    this.dispatch_file_updates(out_len, out_len);
    Ok(())
}
