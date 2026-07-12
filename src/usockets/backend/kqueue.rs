//! kqueue backend (macOS/FreeBSD). Implements core-semantics.md §1-2 poll
//! mechanics: kevent64 changelists with KEVENT_FLAG_ERROR_EVENTS errno
//! mirroring, level-triggered EVFILT_READ + one-shot EVFILT_WRITE (incl. the
//! zero-events add-oneshot-WRITE-for-FIN rule), two-pass per-poll coalesce.
//! All udata are untagged slot pointers (P10 removed the tagged-pointer
//! FilePoll back-channel).

use core::ptr;

use crate::backend::{self, Backend, Events, PollState, MAX_READY_POLLS};
use crate::loop_::Loop;
use crate::unsafe_core::poll_access;
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

    fn arm_source(
        &mut self,
        p: *mut PollState,
        loop_: *mut Loop,
        source: crate::loop_::poll_registry::PollSource,
    ) -> i32 {
        registry_arm(p, loop_, source)
    }

    fn disarm_source(
        &mut self,
        p: *mut PollState,
        loop_: *mut Loop,
        armed: crate::loop_::poll_registry::ArmedSource,
    ) {
        registry_disarm(p, loop_, armed)
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

// ── P0c registry sources ─────────────────────────────────────────────────────
// Registry Fd polls are LEVEL-triggered in both directions — the socket
// oneshot-WRITE / zero-events-FIN rules above do not apply to them.

/// `EVFILT_MEMORYSTATUS` (xnu <sys/event_private.h>; not in libc). fflags per
/// libdispatch's pressure registration.
#[cfg(target_os = "macos")]
const EVFILT_MEMORYSTATUS: i16 = -14;
#[cfg(target_os = "macos")]
const NOTE_MEMORYSTATUS_PRESSURE_WARN: u32 = 0x00000002;
#[cfg(target_os = "macos")]
const NOTE_MEMORYSTATUS_PRESSURE_CRITICAL: u32 = 0x00000004;

/// ≤2 EV_ADD/EV_DELETE deltas moving an Fd registration `old` → `new`.
/// One submission per filter (same discipline as `Kqueue::remove`):
/// FreeBSD's no-ERROR_EVENTS shim can abort a batched changelist at the
/// first error, which would leave the second filter's knote armed with
/// soon-stale udata (W2). Returns the first nonzero rc plus the interest
/// actually reached (a failed filter keeps its old bit), so callers commit
/// only kernel truth to the slot.
fn registry_fd_delta(
    kqfd: i32,
    fd: LIBUS_SOCKET_DESCRIPTOR,
    old: Events,
    new: Events,
    udata: u64,
) -> (i32, Events) {
    let mut rc = 0;
    let mut achieved = old;
    for (bit, filter) in [
        (Events::READABLE, libc::EVFILT_READ),
        (Events::WRITABLE, libc::EVFILT_WRITE),
    ] {
        let now = new.contains(bit);
        if now != old.contains(bit) {
            let mut ch = [poll_access::make_kev(
                fd,
                filter,
                if now { libc::EV_ADD } else { libc::EV_DELETE },
                udata,
            )];
            let r = poll_access::kevent_error_events(kqfd, &mut ch);
            if r == 0 {
                achieved = if now {
                    achieved | bit
                } else {
                    Events(achieved.0 & !bit.0)
                };
            } else if rc == 0 {
                rc = r;
            }
        }
    }
    (rc, achieved)
}

pub(crate) fn registry_arm(
    p: *mut PollState,
    loop_: *mut Loop,
    source: crate::loop_::poll_registry::PollSource,
) -> i32 {
    use crate::loop_::poll_registry::PollSource;
    let kqfd = poll_access::loop_fd(loop_);
    let udata = p as usize as u64;
    let mut st = poll_access::read_poll(p);
    match source {
        PollSource::Fd {
            readable, writable, ..
        } => {
            let events = backend::fd_interest(readable, writable);
            // Commit only the achieved interest: on partial-arm failure the
            // register unwind's purge then deletes exactly the armed filters.
            let (rc, achieved) = registry_fd_delta(kqfd, st.fd(), Events::NONE, events, udata);
            st.set_polling(achieved);
            poll_access::write_poll(p, st);
            rc
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        PollSource::Proc { pid } => {
            st.set_polling(Events::READABLE);
            poll_access::write_poll(p, st);
            let mut ch = [poll_access::make_kev_ex(
                pid as u64,
                libc::EVFILT_PROC,
                libc::EV_ADD,
                libc::NOTE_EXIT,
                udata,
            )];
            poll_access::kevent_error_events(kqfd, &mut ch)
        }
        #[cfg(target_os = "macos")]
        PollSource::Machport { port } => {
            st.set_polling(Events::READABLE);
            poll_access::write_poll(p, st);
            let mut ch = [poll_access::make_kev_ex(
                u64::from(port),
                libc::EVFILT_MACHPORT,
                libc::EV_ADD,
                0,
                udata,
            )];
            poll_access::kevent_error_events(kqfd, &mut ch)
        }
        #[cfg(target_os = "macos")]
        PollSource::Memorystatus => {
            st.set_polling(Events::READABLE);
            poll_access::write_poll(p, st);
            // EV_CLEAR: each pressure transition delivers once (libdispatch
            // parity, same as io/'s registration).
            let mut ch = [poll_access::make_kev_ex(
                0,
                EVFILT_MEMORYSTATUS,
                libc::EV_ADD | libc::EV_CLEAR,
                NOTE_MEMORYSTATUS_PRESSURE_WARN | NOTE_MEMORYSTATUS_PRESSURE_CRITICAL,
                udata,
            )];
            poll_access::kevent_error_events(kqfd, &mut ch)
        }
    }
}

/// Level-triggered interest update for a registry Fd source. Commits only
/// the interest the kernel accepted (see [`registry_fd_delta`]): a failed
/// filter keeps its old bit, so an identical retry re-issues the kevent.
pub(crate) fn registry_change(p: *mut PollState, loop_: *mut Loop, events: Events) -> i32 {
    let mut st = poll_access::read_poll(p);
    let old_events = st.events();
    if old_events == events {
        return 0;
    }
    let (rc, achieved) = registry_fd_delta(
        poll_access::loop_fd(loop_),
        st.fd(),
        old_events,
        events,
        p as usize as u64,
    );
    if achieved != old_events {
        st.set_polling(achieved);
        poll_access::write_poll(p, st);
        backend::update_pending_ready_polls(loop_, p, p, old_events, achieved);
    }
    rc
}

pub(crate) fn registry_disarm(
    p: *mut PollState,
    loop_: *mut Loop,
    armed: crate::loop_::poll_registry::ArmedSource,
) {
    use crate::loop_::poll_registry::ArmedSource;
    let kqfd = poll_access::loop_fd(loop_);
    let st = poll_access::read_poll(p);
    match armed {
        ArmedSource::Fd => {
            let old = st.events();
            if !old.is_empty() {
                let _ = registry_fd_delta(kqfd, st.fd(), old, Events::NONE, 0);
            }
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        ArmedSource::Proc { pid } => {
            let mut ch = [poll_access::make_kev_ex(
                pid as u64,
                libc::EVFILT_PROC,
                libc::EV_DELETE,
                0,
                0,
            )];
            let _ = poll_access::kevent_error_events(kqfd, &mut ch);
        }
        #[cfg(target_os = "macos")]
        ArmedSource::Machport { port } => {
            let mut ch = [poll_access::make_kev_ex(
                u64::from(port),
                libc::EVFILT_MACHPORT,
                libc::EV_DELETE,
                0,
                0,
            )];
            let _ = poll_access::kevent_error_events(kqfd, &mut ch);
        }
        #[cfg(target_os = "macos")]
        ArmedSource::Memorystatus => {
            let mut ch = [poll_access::make_kev_ex(
                0,
                EVFILT_MEMORYSTATUS,
                libc::EV_DELETE,
                0,
                0,
            )];
            let _ = poll_access::kevent_error_events(kqfd, &mut ch);
        }
    }
    backend::update_pending_ready_polls(loop_, p, ptr::null_mut(), st.events(), Events::NONE);
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
/// P0c registry poll: dispatched per-kevent in pass 2 (no coalesce) so the
/// filter payload (fflags/data) survives to the handler.
const FL_REGISTERED: u8 = 1 << 5;

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

#[cfg(target_os = "macos")]
fn entry_payload(e: &EventType) -> (u32, i64) {
    (e.fflags, e.data)
}
#[cfg(target_os = "freebsd")]
fn entry_payload(e: &EventType) -> (u32, i64) {
    (e.fflags, e.data as i64)
}

/// Untagged, non-UDP udata pointing at an occupied-or-vacant slot with kind
/// bits == Registered. UDP low-bit tags are excluded FIRST — a tagged word
/// does not point at a PollState.
fn is_registered_udata(udata: u64) -> bool {
    udata & backend::UDP_TAG_MASK == 0
        && poll_access::read_poll(udata as usize as *mut PollState).kind_bits()
            == backend::KIND_REGISTERED
}

/// Per-kevent registry dispatch: direction from the filter (everything that
/// is not EVFILT_WRITE reads as readable — PROC/MACHPORT/MEMORYSTATUS
/// included), error/eof from the flags, raw filter payload passed through.
/// R1.18 parity with epoll's `dispatch_untagged` mask: the filter direction
/// is ANDed with the slot's believed polling bits, so a same-batch stale
/// kevent for a direction removed by `PollRef::change` is dropped.
fn dispatch_registered_kevent(e: &EventType) {
    let (udata, filter, flags) = entry_parts(e);
    let (fflags, data) = entry_payload(e);
    let p = udata as usize as *mut PollState;
    let believed = poll_access::read_poll(p).events();
    let readable = filter != libc::EVFILT_WRITE && believed.contains(Events::READABLE);
    let writable = filter == libc::EVFILT_WRITE && believed.contains(Events::WRITABLE);
    let error = flags & libc::EV_ERROR != 0;
    let eof = flags & libc::EV_EOF != 0;
    if !readable && !writable && !error && !eof {
        return;
    }
    crate::loop_::poll_registry::dispatch_ready(
        p,
        crate::loop_::poll_registry::PollEvents {
            readable,
            writable,
            error,
            eof,
            fflags,
            data,
        },
    );
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
        if udata == 0 {
            coalesced[i as usize] = FL_SKIP;
            continue;
        }
        // P0c registry entries skip the coalesce entirely — pass 2 dispatches
        // each kevent with its filter payload intact.
        if is_registered_udata(udata) {
            coalesced[i as usize] = FL_REGISTERED;
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
            if coalesced[j as usize] & (FL_SKIP | FL_REGISTERED) == 0
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
            if coalesced[i as usize] & FL_REGISTERED != 0 {
                let entry = poll_access::ready_poll_at(loop_, i);
                dispatch_registered_kevent(&entry);
            } else {
                let bits = coalesced[i as usize];
                // bits == 0: nested-tick-appended entry beyond pass 1's count
                // (already dispatched by the nested tick) — dropped here, so
                // dispatch_untagged never sees an all-empty kqueue event.
                if bits & FL_SKIP == 0 && bits != 0 {
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
