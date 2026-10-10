use bun_core::output as Output;
use bun_sys::Fd;

use crate::watcher_impl::{Op, WatchEvent, Watcher};

pub(crate) type Platform = KEventWatcher;

// Defined in src/io/io_darwin.cpp.
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

/// XNU allows one kevent flavor per kqueue, and the mach port is registered with `kevent64()`.
#[cfg(target_os = "macos")]
pub(crate) type KEvent = libc::kevent64_s;
#[cfg(target_os = "macos")]
pub(crate) use bun_sys::kevent64 as kevent;
#[cfg(target_os = "freebsd")]
pub(crate) type KEvent = libc::kevent;
#[cfg(target_os = "freebsd")]
pub(crate) use bun_sys::kevent;

pub struct KEventWatcher {
    pub(crate) fd: Fd,
    #[cfg(target_os = "macos")]
    machport: libc::mach_port_t,
    /// Receive buffer of the `EVFILT_MACHPORT` registration; lives until `stop()`.
    #[cfg(target_os = "macos")]
    _machport_buf: Box<[u8]>,
}

const CHANGELIST_COUNT: usize = 128;

/// FreeBSD has no mach ports; use the kqueue-native EVFILT_USER wakeup there.
#[cfg(target_os = "freebsd")]
const WAKE_EVENT_IDENT: usize = 0x2307;

#[cfg(target_os = "freebsd")]
fn wake_event(flags: u16, fflags: u32) -> KEvent {
    let mut ev: KEvent = bun_core::ffi::zeroed();
    ev.ident = WAKE_EVENT_IDENT;
    ev.filter = libc::EVFILT_USER;
    ev.flags = flags;
    ev.fflags = fflags;
    ev
}

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
            if machport == 0 {
                let _ = bun_sys::close(fd);
                return Err(crate::Error::KQueueError);
            }
            Ok(Self {
                fd,
                machport,
                _machport_buf: machport_buf,
            })
        }

        #[cfg(target_os = "freebsd")]
        {
            let ev = wake_event(libc::EV_ADD | libc::EV_CLEAR, 0);
            if let Err(err) = kevent(fd, core::slice::from_ref(&ev), &mut [], None) {
                let _ = bun_sys::close(fd);
                return Err(err.into());
            }
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

    /// Unblocks the kqueue wait so the thread re-checks `running`. Runs under `Watcher.mutex`.
    pub(crate) fn wake(&self) {
        #[cfg(target_os = "macos")]
        if self.machport != 0 {
            let _ = io_darwin_schedule_wakeup(self.machport);
        }

        #[cfg(target_os = "freebsd")]
        if self.fd.is_valid() {
            let ev = wake_event(0, libc::NOTE_TRIGGER);
            let _ = kevent(self.fd, core::slice::from_ref(&ev), &mut [], None);
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

    let mut count = kevent(fd, &[], &mut changelist, None)?;

    // Give the events more time to coalesce
    if count < CHANGELIST_COUNT / 2 {
        let ts = libc::timespec {
            tv_sec: 0,
            tv_nsec: 100_000,
        }; // 0.0001 seconds
        count += kevent(fd, &[], &mut changelist[count..], Some(&ts))?;
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
    if out_len == 0 {
        return Ok(());
    }

    this.dispatch_file_updates(out_len, out_len);
    Ok(())
}
