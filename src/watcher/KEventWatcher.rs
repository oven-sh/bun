use bun_core::{env_var, output as Output};
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

pub struct KEventWatcher {
    pub(crate) fd: Fd,
    /// See `INotifyWatcher::coalesce_interval` for rationale. Honours the
    /// same env var (despite its Linux-centric name) so tests can pin the
    /// window uniformly across platforms.
    pub(crate) coalesce_interval_ns: isize,
}

const CHANGELIST_COUNT: usize = 128;
const DEFAULT_COALESCE_INTERVAL_NS: isize = 10_000_000; // 10ms
/// `kevent()` returns as soon as one event is ready rather than waiting
/// the full timeout, so a burst of N writes a few ms apart consumes ~N
/// drain iterations. Keep this in step with
/// `INotifyWatcher::MAX_COALESCE_ITERATIONS` so the same save burst
/// collapses into one cycle on both backends; the quiet-timeout `break`
/// still terminates the common case after one idle interval.
const MAX_COALESCE_ITERATIONS: u32 = 32;

impl KEventWatcher {
    pub(crate) fn new(_root: &[u8]) -> crate::Result<Self> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }
        let coalesce_interval_ns = env_var::BUN_INOTIFY_COALESCE_INTERVAL
            .get()
            .and_then(|v| isize::try_from(v).ok())
            .unwrap_or(DEFAULT_COALESCE_INTERVAL_NS);
        Ok(Self {
            fd,
            coalesce_interval_ns,
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

    // A single editor save typically produces several kevents a few ms
    // apart (e.g. NOTE_WRITE on the file plus NOTE_WRITE on its parent
    // directory, or the rename/create pair from an atomic save). Keep
    // draining until the queue stays quiet for `coalesce_interval_ns`
    // so one save becomes one `on_file_update` call instead of several,
    // which in `--hot` mode would otherwise re-evaluate the entry point
    // once per burst.
    //
    // POSIX requires tv_nsec < 10^9; split so a user-supplied interval
    // >= 1 s doesn't make `kevent` fail with EINVAL.
    const NS_PER_S: isize = 1_000_000_000;
    let interval = this.platform.coalesce_interval_ns;
    let ts = libc::timespec {
        tv_sec: (interval / NS_PER_S) as _,
        tv_nsec: (interval % NS_PER_S) as _,
    };
    let mut iterations: u32 = 0;
    while count > 0 && count < CHANGELIST_COUNT && iterations < MAX_COALESCE_ITERATIONS {
        // A failed drain poll must not discard the events already read;
        // if the kqueue is really broken the next cycle's blocking
        // `kevent` above reports it.
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
