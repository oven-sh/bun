use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

// Darwin: `src/io/io_darwin.cpp` (same helpers `bun_io::waker::KEventWaker`
// uses). The non-Darwin stubs there are no-ops so the symbols exist
// everywhere the C++ link step runs, but we only call them on macOS.
#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn io_darwin_create_machport(
        kq: i32,
        buf: *mut core::ffi::c_void,
        len: usize,
    ) -> bun_core::mach_port;
    safe fn io_darwin_schedule_wakeup(port: bun_core::mach_port) -> bool;
    safe fn io_darwin_close_machport(port: bun_core::mach_port);
}

pub struct KEventWatcher {
    pub fd: Fd,
    #[cfg(target_os = "macos")]
    machport: bun_core::mach_port,
    /// Receive buffer handed to `EVFILT_MACHPORT` via `kevent64_s.ext[0]`;
    /// must outlive the registration (i.e. until `stop()`).
    #[cfg(target_os = "macos")]
    _machport_buf: Box<[u8]>,
}

const CHANGELIST_COUNT: usize = 128;

/// FreeBSD has no mach ports; use the kqueue-native EVFILT_USER wakeup there.
#[cfg(target_os = "freebsd")]
const WAKE_EVENT_IDENT: usize = 0x2307;

impl KEventWatcher {
    pub fn new(_root: &[u8]) -> crate::Result<Self> {
        let fd = bun_sys::kqueue()?;
        if fd.native() == 0 {
            return Err(crate::Error::KQueueError);
        }

        #[cfg(target_os = "macos")]
        {
            let mut machport_buf = vec![0u8; 1024].into_boxed_slice();
            // SAFETY: fd is a live kqueue; buf is valid for `len` bytes and
            // outlives the registration (owned by the returned Self).
            let machport = unsafe {
                io_darwin_create_machport(
                    fd.native(),
                    machport_buf.as_mut_ptr().cast::<core::ffi::c_void>(),
                    machport_buf.len(),
                )
            };
            // machport == 0 means creation failed; `wake()` degrades to a
            // no-op and shutdown falls back to waiting for an fs event.
            Ok(Self {
                fd,
                machport,
                _machport_buf: machport_buf,
            })
        }

        #[cfg(target_os = "freebsd")]
        {
            let mut ev: libc::kevent = bun_core::ffi::zeroed();
            ev.ident = WAKE_EVENT_IDENT;
            ev.filter = libc::EVFILT_USER;
            ev.flags = (libc::EV_ADD | libc::EV_CLEAR) as _;
            let _ = bun_sys::kevent(fd, core::slice::from_ref(&ev), &mut [], None);
            Ok(Self { fd })
        }
    }

    pub fn stop(&mut self) {
        #[cfg(target_os = "macos")]
        if self.machport != 0 {
            io_darwin_close_machport(self.machport);
            self.machport = 0;
        }
        if self.fd.is_valid() {
            let _ = bun_sys::close(self.fd);
            self.fd = Fd::INVALID;
        }
    }

    /// Unblock the watcher thread's `kevent()` so it re-checks `running`.
    /// Called from `Watcher::shutdown` under `Watcher.mutex`.
    pub fn wake(&self) {
        #[cfg(target_os = "macos")]
        if self.machport != 0 {
            let _ = io_darwin_schedule_wakeup(self.machport);
        }

        #[cfg(target_os = "freebsd")]
        if self.fd.is_valid() {
            let mut ev: libc::kevent = bun_core::ffi::zeroed();
            ev.ident = WAKE_EVENT_IDENT;
            ev.filter = libc::EVFILT_USER;
            ev.fflags = libc::NOTE_TRIGGER;
            let _ = bun_sys::kevent(self.fd, core::slice::from_ref(&ev), &mut [], None);
        }
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
        // Only VNODE events map to watch items (filters out the wakeup event).
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
