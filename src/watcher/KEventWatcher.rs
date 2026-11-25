use std::time::{Duration, Instant};

use bun_core::output as Output;
use bun_sys::CloseOnDrop;

use crate::watcher_impl::{Op, WatchEvent, WatchItemColumns, WatchList, Watcher, WatcherThread};

pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    pub(crate) fd: CloseOnDrop,
}

const CHANGELIST_COUNT: usize = 128;

/// A save that opens with `O_TRUNC` empties the file, then writes it.
const WAIT_FOR_WRITE_TO_EMPTIED_FILE: Duration = Duration::from_millis(100);

impl KEventWatcher {
    pub(crate) fn new(_root: &[u8]) -> crate::Result<Self> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }
        Ok(Self {
            fd: CloseOnDrop::new(fd),
        })
    }
}

impl Watcher {
    pub(crate) fn wake(&self) {
        let mut add: libc::kevent = bun_core::ffi::zeroed();
        add.filter = libc::EVFILT_USER;
        let mut trigger = add;
        add.flags = libc::EV_ADD;
        trigger.fflags = libc::NOTE_TRIGGER;
        // SAFETY: only `watch_loop_cycle` waits on this kqueue, and it reads `udata` as an index.
        let _ = unsafe { bun_sys::kevent(self.platform.fd.fd(), &[add, trigger], &mut [], None) };
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

/// Returns whether the item at `index` is a file with a new size.
fn update_size(watchlist: &mut WatchList, index: usize) -> bool {
    let Some(&Some(before)) = watchlist.items_size().get(index) else {
        return false;
    };
    let Some(Ok(size)) = (watchlist.items_file()[index].as_ref()).map(|file| file.get_end_pos())
    else {
        return false;
    };
    watchlist.items_size_mut()[index] = Some(size);
    size != before
}

fn is_emptied(watchlist: &WatchList, event: WatchEvent) -> bool {
    event.op.contains(Op::WRITE)
        && watchlist.items_size().get(event.index as usize) == Some(&Some(0))
}

/// Appends to `events[..len]` and returns the new length.
fn append_events(
    watchlist: &mut WatchList,
    changes: &[libc::kevent],
    events: &mut [WatchEvent],
    mut len: usize,
) -> usize {
    for change in changes {
        let mut event = watch_event_from_kevent(change);
        if update_size(watchlist, event.index as usize) {
            event.op |= Op::WRITE;
        }
        // Not a truncation: `chmod`, `touch`, `mmap`, an extended attribute.
        if event.op == Op::METADATA {
            continue;
        }
        match events[..len].last_mut() {
            Some(last) if last.index == event.index => last.merge(event),
            _ => {
                events[len] = event;
                len += 1;
            }
        }
    }
    len
}

pub(crate) fn watch_loop_cycle(this: &Watcher, thread: &mut WatcherThread) -> bun_sys::Result<()> {
    let _flush = Output::flush_guard();
    let fd = this.platform.fd.fd();

    let mut changelist: [libc::kevent; CHANGELIST_COUNT] = bun_core::ffi::zeroed();

    let mut count = bun_sys::kevent_wait(fd, &mut changelist, None)?;

    // Give the events more time to coalesce
    if count < CHANGELIST_COUNT / 2 {
        let ts = libc::timespec {
            tv_sec: 0,
            tv_nsec: 100_000,
        }; // 0.0001 seconds
        count += bun_sys::kevent_wait(fd, &mut changelist[count..], Some(&ts))?;
    }

    let deadline = Instant::now() + WAIT_FOR_WRITE_TO_EMPTIED_FILE;
    let events = &mut thread.watch_events[..CHANGELIST_COUNT];
    let mut len: usize = 0;
    loop {
        let any_emptied = {
            let watchlist = &mut this.state.lock().watchlist;
            len = append_events(watchlist, &changelist[..count], events, len);
            (events[..len].iter()).any(|&event| is_emptied(watchlist, event))
        };
        let left = deadline.saturating_duration_since(Instant::now());
        if !any_emptied || left.is_zero() || len == events.len() || !this.running.load() {
            break;
        }
        let ts = libc::timespec {
            tv_sec: left.as_secs() as _,
            tv_nsec: left.subsec_nanos() as _,
        };
        count = bun_sys::kevent_wait(fd, &mut changelist[..events.len() - len], Some(&ts))?;
    }

    if len > 0 {
        this.dispatch_file_updates(thread, len, &[]);
    }
    Ok(())
}
