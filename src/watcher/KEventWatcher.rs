use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{
    MAX_COALESCE_ITERATIONS, Op, WatchEvent, Watcher, coalesce_interval_ns, coalesce_timespec,
};

pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    pub(crate) fd: Fd,
    /// See [`coalesce_interval_ns`].
    pub(crate) coalesce_interval: u64,
}

const CHANGELIST_COUNT: usize = 128;

impl KEventWatcher {
    pub(crate) fn new(_root: &[u8]) -> crate::Result<Self> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }
        Ok(Self {
            fd,
            coalesce_interval: coalesce_interval_ns(),
        })
    }

    pub(crate) fn stop(&mut self) {
        if self.fd.is_valid() {
            let _ = bun_sys::close(self.fd);
            self.fd = Fd::INVALID;
        }
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

    // Drain until quiet.
    let ts = coalesce_timespec(this.platform.coalesce_interval);
    let mut iterations: u32 = 0;
    while count > 0 && count < CHANGELIST_COUNT && iterations < MAX_COALESCE_ITERATIONS {
        // Don't let a failed drain poll discard the events already read.
        match bun_sys::kevent(fd, &[], &mut changelist[count..], Some(&ts)) {
            Ok(0) | Err(_) => break,
            Ok(extra) => count += extra,
        }
        iterations += 1;
    }

    let changes = &changelist[..count];
    let watchevents = &mut this.watch_events[..count];
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
