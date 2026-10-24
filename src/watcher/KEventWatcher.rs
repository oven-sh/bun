use std::time::{Duration, Instant};

use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    pub(crate) fd: Fd,
}

const CHANGELIST_COUNT: usize = 128;

/// A save in place is `open(O_TRUNC)`, then `write()`. The watch loop waits this long for the write.
const SAVE_IN_PLACE_WAIT: Duration = Duration::from_millis(10);

impl KEventWatcher {
    pub(crate) fn new(_root: &[u8]) -> crate::Result<Self> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }
        Ok(Self { fd })
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

/// kqueue reports a truncation as `NOTE_ATTRIB` alone: true when the file of such an event is empty now.
fn is_emptied(kevent: &libc::kevent) -> bool {
    const CHANGES: u32 =
        libc::NOTE_ATTRIB | libc::NOTE_WRITE | libc::NOTE_DELETE | libc::NOTE_RENAME;
    kevent.fflags & CHANGES == libc::NOTE_ATTRIB
        && bun_sys::fstat(Fd::from_native(kevent.ident as i32)).is_ok_and(|stat| stat.st_size == 0)
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

    // The write of a save in place comes after its truncation: wait for it, so that no reload reads the empty file.
    let mut deadline = None;
    while count < CHANGELIST_COUNT && changelist[..count].iter().any(is_emptied) {
        let deadline = *deadline.get_or_insert_with(|| Instant::now() + SAVE_IN_PLACE_WAIT);
        let timeout = libc::timespec {
            tv_sec: 0,
            tv_nsec: deadline.saturating_duration_since(Instant::now()).subsec_nanos() as _,
        };
        let more = bun_sys::kevent(fd, &[], &mut changelist[count..], Some(&timeout))?;
        if more == 0 {
            break;
        }
        count += more;
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
