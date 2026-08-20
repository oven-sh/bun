use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    pub(crate) fd: Fd,
}

const CHANGELIST_COUNT: usize = 128;

/// `EVFILT_USER` ident that `wake` triggers so `shutdown` can unpark the thread blocked in `kevent`.
const WAKE_IDENT: usize = 0;

impl KEventWatcher {
    pub(crate) fn new(_root: &[u8]) -> crate::Result<Self> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }
        let this = Self { fd };
        let mut wake: libc::kevent = bun_core::ffi::zeroed();
        wake.ident = WAKE_IDENT;
        wake.filter = libc::EVFILT_USER;
        wake.flags = (libc::EV_ADD | libc::EV_CLEAR) as _;
        bun_sys::kevent(fd, &[wake], &mut [], None)?;
        Ok(this)
    }

    pub(crate) fn wake(&self) {
        if !self.fd.is_valid() {
            return;
        }
        let mut wake: libc::kevent = bun_core::ffi::zeroed();
        wake.ident = WAKE_IDENT;
        wake.filter = libc::EVFILT_USER;
        wake.fflags = libc::NOTE_TRIGGER;
        let _ = bun_sys::kevent(self.fd, &[wake], &mut [], None);
    }

    pub(crate) fn stop(&mut self) {
        if self.fd.is_valid() {
            let _ = bun_sys::close(self.fd);
            self.fd = Fd::INVALID;
        }
    }
}

impl Drop for KEventWatcher {
    fn drop(&mut self) {
        self.stop();
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

    let mut changes = &changelist[..count];
    // The wake event is only ever the last (and sole) event; `running` is already false when it arrives.
    if let [rest @ .., last] = changes {
        if last.filter == libc::EVFILT_USER {
            changes = rest;
        }
    }
    let watchevents = &mut this.watch_events[..changes.len()];
    let mut out_len: usize = 0;
    if let [first, rest @ ..] = changes {
        watchevents[0] = watch_event_from_kevent(first);
        out_len = 1;
        let mut prev_event = first;
        for event in rest {
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

    this.dispatch_file_updates(out_len, out_len);
    Ok(())
}
