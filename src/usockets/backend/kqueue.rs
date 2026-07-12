//! kqueue backend (macOS/FreeBSD). Implements core-semantics.md §1-2 poll
//! mechanics: kevent64 changelists with KEVENT_FLAG_ERROR_EVENTS errno
//! mirroring, level-triggered EVFILT_READ + one-shot EVFILT_WRITE (incl. the
//! zero-events add-oneshot-WRITE-for-FIN rule), two-pass per-poll coalesce,
//! tagged-pointer udata routed to `Bun__internal_dispatch_ready_poll`.

use core::ffi::c_void;
use core::ptr;

use crate::backend::{self, Backend, Events, PollState, MAX_READY_POLLS, POINTER_TAG_MASK};
use crate::loop_::Loop;
use crate::unsafe_core::{ffi, poll_access};
use crate::LIBUS_SOCKET_DESCRIPTOR;

/// macOS uses `kevent64_s`; usockets aliases it to `struct kevent` on FreeBSD.
#[cfg(target_os = "macos")]
pub type EventType = libc::kevent64_s;
#[cfg(target_os = "freebsd")]
pub type EventType = libc::kevent;

/// Kqueue may deliver the same poll twice (one kevent per filter, R1.21).
pub(crate) const READY_DUPES: i32 = 2;

pub(crate) struct Kqueue {
    kqfd: i32,
}

impl Kqueue {
    pub(crate) fn from_fd(kqfd: i32) -> Self {
        Kqueue { kqfd }
    }
}

impl Backend for Kqueue {
    fn create() -> Result<Self, i32> {
        let kqfd = poll_access::kqueue_create();
        if kqfd < 0 {
            return Err(poll_access::last_errno());
        }
        Ok(Kqueue { kqfd })
    }

    /// Fresh registration (old-events assumed 0). The parity paths are
    /// `poll_start_rc`/`poll_change`, which carry the real old-events delta.
    fn change(&mut self, fd: LIBUS_SOCKET_DESCRIPTOR, events: Events, user: usize) -> i32 {
        kqueue_change(self.kqfd, fd, Events::NONE, events, user as u64)
    }

    fn remove(&mut self, fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
        // Two SEPARATE submissions (kqueue_change's zero-events branch would
        // leave an armed one-shot WRITE): FreeBSD's shim suppresses the
        // eventlist, so a batched ENOENT could abort the WRITE EV_DELETE.
        let mut read_del = [poll_access::make_kev(fd, libc::EVFILT_READ, libc::EV_DELETE, 0)];
        let rc_read = poll_access::kevent_error_events(self.kqfd, &mut read_del);
        let mut write_del = [poll_access::make_kev(fd, libc::EVFILT_WRITE, libc::EV_DELETE, 0)];
        let rc_write = poll_access::kevent_error_events(self.kqfd, &mut write_del);
        if rc_read != 0 { rc_read } else { rc_write }
    }

    fn wait(&mut self, loop_: *mut Loop, timeout_ns: i64) -> i32 {
        poll_access::kevent_wait_ready(loop_, timeout_ns, timeout_ns == 0)
    }
}

/// `kqueue_change` (R2.9): ≤2 kevent64 changes. EVFILT_READ is
/// level-triggered; EVFILT_WRITE is ALWAYS one-shot. Polling for neither
/// direction arms a one-shot WRITE so a half-open socket still learns about
/// the peer's FIN (epoll relies on implicit EPOLLHUP instead).
pub(crate) fn kqueue_change(
    kqfd: i32,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    old_events: Events,
    new_events: Events,
    udata: u64,
) -> i32 {
    let mut changes = [poll_access::zeroed_kev(); 2];
    let mut n = 0usize;

    let is_readable = new_events.contains(Events::READABLE);
    let is_writable = new_events.contains(Events::WRITABLE);

    if is_readable != old_events.contains(Events::READABLE) {
        changes[n] = poll_access::make_kev(
            fd,
            libc::EVFILT_READ,
            if is_readable { libc::EV_ADD } else { libc::EV_DELETE },
            udata,
        );
        n += 1;
    }

    if !is_readable && !is_writable {
        if !old_events.contains(Events::WRITABLE) {
            changes[n] = poll_access::make_kev(
                fd,
                libc::EVFILT_WRITE,
                libc::EV_ADD | libc::EV_ONESHOT,
                udata,
            );
            n += 1;
        }
    } else if is_writable != old_events.contains(Events::WRITABLE) {
        changes[n] = poll_access::make_kev(
            fd,
            libc::EVFILT_WRITE,
            if is_writable {
                libc::EV_ADD | libc::EV_ONESHOT
            } else {
                libc::EV_DELETE
            },
            udata,
        );
        n += 1;
    }

    poll_access::kevent_error_events(kqfd, &mut changes[..n])
}

pub(crate) fn poll_start_rc(p: *mut PollState, loop_: *mut Loop, events: Events) -> i32 {
    let mut st = poll_access::read_poll(p);
    st.set_polling(events);
    poll_access::write_poll(p, st);
    kqueue_change(
        poll_access::loop_fd(loop_),
        st.fd(),
        Events::NONE,
        events,
        p as usize as u64,
    )
}

pub(crate) fn poll_change(p: *mut PollState, loop_: *mut Loop, events: Events) {
    let mut st = poll_access::read_poll(p);
    let old_events = st.events();
    if old_events == events {
        return;
    }
    st.set_polling(events);
    poll_access::write_poll(p, st);
    kqueue_change(
        poll_access::loop_fd(loop_),
        st.fd(),
        old_events,
        events,
        p as usize as u64,
    );
    backend::update_pending_ready_polls(loop_, p, p, old_events, events);
}

/// R2.10: with no W armed, the zero-events rule ADDs a one-shot
/// EVFILT_WRITE carrying `udata = 0` — delivered later as a NULL ready
/// poll and skipped. Poll bits in `p` are NOT cleared.
pub(crate) fn poll_stop(p: *mut PollState, loop_: *mut Loop) {
    let st = poll_access::read_poll(p);
    let old_events = st.events();
    if !old_events.is_empty() {
        kqueue_change(poll_access::loop_fd(loop_), st.fd(), old_events, Events::NONE, 0);
    }
    backend::update_pending_ready_polls(loop_, p, ptr::null_mut(), old_events, Events::NONE);
}

/// R2.11: forcibly re-add both filters with `new` as udata (one-shot W
/// included even when not polled for — verbatim C behavior).
pub(crate) fn poll_resize(old: *mut PollState, new: *mut PollState, loop_: *mut Loop) {
    let events = poll_access::read_poll(old).events();
    let st = poll_access::read_poll(new);
    kqueue_change(
        poll_access::loop_fd(loop_),
        st.fd(),
        Events::NONE,
        Events::READABLE | Events::WRITABLE,
        new as usize as u64,
    );
    backend::update_pending_ready_polls(loop_, old, new, events, events);
}

/// Kqueue user events have no underlying fd to drain.
pub(crate) fn accept_poll_event(_p: *mut PollState) -> u64 {
    0
}

pub(crate) fn wait_immediate(loop_: *mut Loop) -> i32 {
    poll_access::kevent_wait_ready(loop_, 0, true)
}

// 1-byte coalesced flags (pass 1 writes every non-skipped index).
const FL_READABLE: u8 = 1 << 0;
const FL_WRITABLE: u8 = 1 << 1;
const FL_ERROR: u8 = 1 << 2;
const FL_EOF: u8 = 1 << 3;
const FL_SKIP: u8 = 1 << 4;

#[cfg(target_os = "macos")]
fn is_readable_filter(filter: i16) -> bool {
    filter == libc::EVFILT_READ || filter == libc::EVFILT_MACHPORT
}
#[cfg(target_os = "freebsd")]
fn is_readable_filter(filter: i16) -> bool {
    filter == libc::EVFILT_READ || filter == libc::EVFILT_USER
}

#[cfg(target_os = "macos")]
fn entry_parts(e: &EventType) -> (u64, i16, u16) {
    (e.udata, e.filter, e.flags)
}
#[cfg(target_os = "freebsd")]
fn entry_parts(e: &EventType) -> (u64, i16, u16) {
    (e.udata as u64, e.filter as i16, e.flags)
}

/// R1.19: kqueue delivers each filter as a separate kevent, so pass 1
/// coalesces same-poll entries (backward scan; ≤2 kevents per fd) and pass 2
/// dispatches in kernel order of each poll's FIRST kevent.
pub(crate) fn dispatch_ready_polls(loop_: *mut Loop) {
    // Zero-init: entries a nested tick appends beyond pass 1's count read as
    // no-flags in pass 2 and are dropped (the nested tick already dispatched
    // them); C reads uninitialized stack there — deliberate UB removal.
    let mut coalesced = [0u8; MAX_READY_POLLS];

    // Pass 1: decode + merge. No callbacks run here, so the count is stable.
    let n = poll_access::num_ready_polls(loop_).max(0);
    for i in 0..n {
        let entry = poll_access::ready_poll_at(loop_, i);
        let (udata, filter, flags) = entry_parts(&entry);
        if udata == 0 || udata & POINTER_TAG_MASK != 0 {
            coalesced[i as usize] = FL_SKIP;
            continue;
        }

        let mut bits = 0u8;
        if is_readable_filter(filter) {
            bits |= FL_READABLE;
        }
        if filter == libc::EVFILT_WRITE {
            bits |= FL_WRITABLE;
        }
        if flags & libc::EV_ERROR != 0 {
            bits |= FL_ERROR;
        }
        if flags & libc::EV_EOF != 0 {
            bits |= FL_EOF;
        }

        let mut merged = false;
        for j in (0..i).rev() {
            if coalesced[j as usize] & FL_SKIP == 0
                && poll_access::ready_poll_udata(loop_, j) == udata
            {
                coalesced[j as usize] |= bits;
                coalesced[i as usize] = FL_SKIP;
                merged = true;
                break;
            }
        }
        if !merged {
            coalesced[i as usize] = bits;
        }
    }

    // Pass 2: dispatch through the loop's live cursor (verbatim C quirk —
    // nested ticks and update_pending_ready_polls read/write it).
    poll_access::set_current_ready_poll(loop_, 0);
    while poll_access::current_ready_poll(loop_) < poll_access::num_ready_polls(loop_) {
        let i = poll_access::current_ready_poll(loop_);
        let udata = poll_access::ready_poll_udata(loop_, i);
        if udata != 0 {
            if udata & POINTER_TAG_MASK != 0 {
                ffi::dispatch_ready_poll(loop_, udata as usize as *mut c_void);
            } else {
                let bits = coalesced[i as usize];
                if bits & FL_SKIP == 0 {
                    let mut events = Events::NONE;
                    if bits & FL_READABLE != 0 {
                        events |= Events::READABLE;
                    }
                    if bits & FL_WRITABLE != 0 {
                        events |= Events::WRITABLE;
                    }
                    backend::dispatch_untagged(
                        udata,
                        bits & FL_ERROR != 0,
                        bits & FL_EOF != 0,
                        events,
                    );
                }
            }
        }
        poll_access::set_current_ready_poll(loop_, poll_access::current_ready_poll(loop_) + 1);
    }
}
