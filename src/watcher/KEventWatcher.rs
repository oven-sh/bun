use std::time::{Duration, Instant};

use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, SizeCheck, WatchEvent, Watcher, diag};
use core::sync::atomic::Ordering::Relaxed;

pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    pub(crate) fd: Fd,
}

const CHANGELIST_COUNT: usize = 128;

/// A save in place is `open(O_TRUNC)`, then `write()`. An emptied file waits this long for the write.
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

pub(crate) fn watch_loop_cycle(this: &mut Watcher) -> bun_sys::Result<()> {
    let _flush = Output::flush_guard();
    let fd = this.platform.fd;

    let mut changelist: [libc::kevent; CHANGELIST_COUNT] = bun_core::ffi::zeroed();

    diag::KEVENT.fetch_add(1, Relaxed);
    let mut count = bun_sys::kevent(fd, &[], &mut changelist, None)?;

    // Give the events more time to coalesce
    if count < CHANGELIST_COUNT / 2 {
        let ts = libc::timespec {
            tv_sec: 0,
            tv_nsec: 100_000,
        }; // 0.0001 seconds
        diag::KEVENT.fetch_add(1, Relaxed);
        count += bun_sys::kevent(fd, &[], &mut changelist[count..], Some(&ts))?;
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
    while any_held(&this.watch_events[..out_len]) {
        out_len = wait_for_writes(this, &mut changelist, &mut count, out_len);
        this.dispatch_file_updates(out_len, out_len);
    }
    Ok(())
}

fn any_held(events: &[WatchEvent]) -> bool {
    events
        .iter()
        .any(|event| event.size_check == SizeCheck::Held)
}

/// Reads kevents until each held file has its write, or for `SAVE_IN_PLACE_WAIT`. Then no event is held.
fn wait_for_writes(
    this: &mut Watcher,
    changelist: &mut [libc::kevent; CHANGELIST_COUNT],
    count: &mut usize,
    mut out_len: usize,
) -> usize {
    diag::HOLD.fetch_add(1, Relaxed);
    let deadline = Instant::now() + SAVE_IN_PLACE_WAIT;
    while any_held(&this.watch_events[..out_len]) {
        let left = deadline.saturating_duration_since(Instant::now());
        let timeout = libc::timespec {
            tv_sec: 0,
            tv_nsec: left.subsec_nanos() as _,
        };
        // A failed call ends the wait like the deadline: the events that are read still go out.
        let free = &mut changelist[*count..];
        diag::KEVENT.fetch_add(1, Relaxed);
        let more = bun_sys::kevent(this.platform.fd, &[], free, Some(&timeout)).unwrap_or(0);
        if more == 0 {
            for event in &mut this.watch_events[..out_len] {
                if event.size_check == SizeCheck::Held {
                    event.op |= Op::WRITE;
                    event.size_check = SizeCheck::Due;
                }
            }
            break;
        }
        for kevent in &free[..more] {
            let new = watch_event_from_kevent(kevent);
            let events = &mut this.watch_events[..out_len];
            if let Some(held) = events
                .iter_mut()
                .find(|event| event.size_check == SizeCheck::Held && event.index == new.index)
            {
                held.merge(new);
                if held.op.intersects(Op::WRITE | Op::DELETE | Op::RENAME) {
                    held.size_check = SizeCheck::Due;
                }
            } else if let Some(last) = events
                .last_mut()
                .filter(|last| last.size_check == SizeCheck::Due && last.index == new.index)
            {
                last.merge(new);
            } else {
                this.watch_events[out_len] = new;
                out_len += 1;
            }
        }
        *count += more;
    }
    out_len
}
