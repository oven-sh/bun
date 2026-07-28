use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    pub fd: Fd,
}

const CHANGELIST_COUNT: usize = 128;

/// Arbitrary non-zero `ident` for the EVFILT_USER wakeup event registered in
/// `new()` and triggered by `wake()`.
const WAKE_EVENT_IDENT: usize = 0x2307;

impl KEventWatcher {
    pub fn new(_root: &[u8]) -> crate::Result<Self> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }
        // Register a user-triggered event so `wake()` can unblock the
        // blocking `kevent()` in `watch_loop_cycle` during shutdown.
        let mut ev: libc::kevent = bun_core::ffi::zeroed();
        ev.ident = WAKE_EVENT_IDENT;
        ev.filter = libc::EVFILT_USER;
        ev.flags = (libc::EV_ADD | libc::EV_CLEAR) as _;
        let _ = bun_sys::kevent(fd, core::slice::from_ref(&ev), &mut [], None);
        Ok(Self { fd })
    }

    pub fn stop(&mut self) {
        if self.fd.is_valid() {
            let _ = bun_sys::close(self.fd);
            self.fd = Fd::INVALID;
        }
    }

    /// Unblock the watcher thread's blocking `kevent()` so it can observe
    /// `Watcher.running == false` and exit. Called from `Watcher::shutdown`
    /// on the main thread while holding `Watcher.mutex`.
    pub fn wake(&self) {
        if !self.fd.is_valid() {
            return;
        }
        let mut ev: libc::kevent = bun_core::ffi::zeroed();
        ev.ident = WAKE_EVENT_IDENT;
        ev.filter = libc::EVFILT_USER;
        ev.fflags = libc::NOTE_TRIGGER;
        let _ = bun_sys::kevent(self.fd, core::slice::from_ref(&ev), &mut [], None);
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

    let changes = &changelist[..count];
    let watchevents = &mut this.watch_events[..count];
    let mut out_len: usize = 0;
    let mut prev_event: Option<&libc::kevent> = None;
    for event in changes {
        // Only VNODE events map to watch items; skip the EVFILT_USER wakeup
        // posted by `wake()`.
        if event.filter != libc::EVFILT_VNODE {
            continue;
        }
        if let Some(prev) = prev_event {
            if prev.udata == event.udata {
                watchevents[out_len - 1].merge(watch_event_from_kevent(event));
                prev_event = Some(event);
                continue;
            }
        }
        watchevents[out_len] = watch_event_from_kevent(event);
        prev_event = Some(event);
        out_len += 1;
    }

    this.dispatch_file_updates(out_len, out_len);
    Ok(())
}
