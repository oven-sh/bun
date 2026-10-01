use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

/// XNU ties a kqueue to the event struct of the first call made on it. On
/// Darwin that call is the `kevent64()` in `io_darwin_create_machport`, so
/// every later call on this kqueue uses `kevent64_s` too: a plain `kevent()`
/// there fails with EINVAL.
#[cfg(target_os = "macos")]
pub(crate) type KEvent = libc::kevent64_s;
#[cfg(target_os = "freebsd")]
pub(crate) type KEvent = libc::kevent;

/// `kevent64()` on Darwin, `kevent()` on FreeBSD. Retries on EINTR.
pub(crate) fn kevent_call(
    fd: Fd,
    changelist: &[KEvent],
    eventlist: &mut [KEvent],
    timeout: Option<&libc::timespec>,
) -> bun_sys::Result<usize> {
    #[cfg(target_os = "freebsd")]
    {
        bun_sys::kevent(fd, changelist, eventlist, timeout)
    }
    #[cfg(target_os = "macos")]
    loop {
        // SAFETY: fd is a valid kqueue; slices give exact (ptr,len); timeout
        // is either null or a valid timespec.
        let rc = unsafe {
            libc::kevent64(
                fd.native(),
                changelist.as_ptr(),
                changelist.len() as core::ffi::c_int,
                eventlist.as_mut_ptr(),
                eventlist.len() as core::ffi::c_int,
                0,
                timeout.map_or(core::ptr::null(), std::ptr::from_ref),
            )
        };
        match bun_sys::get_errno(rc) {
            bun_sys::E::SUCCESS => return Ok(rc as usize),
            bun_sys::E::EINTR => continue,
            e => return Err(bun_sys::Error::from_code(e, bun_sys::Tag::kevent).with_fd(fd)),
        }
    }
}

// Darwin: `src/io/io_darwin.cpp`. `bun_io::waker::KEventWaker` uses the first
// two; `io_darwin_close_machport` is for this watcher only and has no
// non-Darwin stub.
#[cfg(target_os = "macos")]
unsafe extern "C" {
    fn io_darwin_create_machport(
        kq: i32,
        buf: *mut core::ffi::c_void,
        len: usize,
    ) -> libc::mach_port_t;
    safe fn io_darwin_schedule_wakeup(port: libc::mach_port_t) -> bool;
    safe fn io_darwin_close_machport(port: libc::mach_port_t);
}

pub struct KEventWatcher {
    pub(crate) fd: Fd,
    #[cfg(target_os = "macos")]
    machport: libc::mach_port_t,
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
    pub(crate) fn new(_root: &[u8]) -> crate::Result<Self> {
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

    pub(crate) fn stop(&mut self) {
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
    pub(crate) fn wake(&self) {
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

fn watch_event_from_kevent(kevent: &KEvent) -> WatchEvent {
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

    let mut changelist: [KEvent; CHANGELIST_COUNT] = bun_core::ffi::zeroed();

    let mut count = kevent_call(fd, &[], &mut changelist, None)?;

    // Give the events more time to coalesce
    if count < CHANGELIST_COUNT / 2 {
        let ts = libc::timespec {
            tv_sec: 0,
            tv_nsec: 100_000,
        }; // 0.0001 seconds
        count += kevent_call(fd, &[], &mut changelist[count..], Some(&ts))?;
    }

    let changes = &changelist[..count];
    let watchevents = &mut this.watch_events[..count];
    let mut out_len: usize = 0;
    let mut prev_event: Option<&KEvent> = None;
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
