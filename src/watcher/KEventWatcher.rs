use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    pub(crate) fd: Fd,
    /// See [`crate::watcher_impl::Watcher::init`].
    pub(crate) subscription: Op,
}

/// Translate a subscription into EVFILT_VNODE `fflags`.
///
/// NOTE_ATTRIB is requested for files only. A directory vnode reports it solely
/// for changes to the directory's own metadata — entry-level `chmod`/`touch`
/// raise nothing on the parent — and no consumer acts on that, so requesting it
/// there only adds wakeups. (This differs from inotify, where IN_ATTRIB on a
/// directory *does* report its entries; see `dir_mask` in INotifyWatcher.)
pub(crate) fn vnode_fflags(subscription: Op, kind: crate::watcher_impl::WatchItemKind) -> u32 {
    let mut fflags = 0u32;
    if subscription.contains(Op::DELETE) {
        fflags |= libc::NOTE_DELETE;
    }
    if subscription.contains(Op::RENAME) {
        fflags |= libc::NOTE_RENAME | libc::NOTE_LINK;
    }
    if subscription.contains(Op::WRITE) {
        fflags |= libc::NOTE_WRITE;
    }
    if subscription.contains(Op::METADATA) && kind == crate::watcher_impl::WatchItemKind::File {
        fflags |= libc::NOTE_ATTRIB;
    }
    fflags
}

const CHANGELIST_COUNT: usize = 128;

impl KEventWatcher {
    pub(crate) fn new(_root: &[u8], subscription: Op) -> crate::Result<Self> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }
        Ok(Self { fd, subscription })
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
