//! epoll backend (Linux/Android). Implements core-semantics.md §1-2 poll
//! mechanics: epoll_pwait2 with an ENOSYS fallback latch, level-triggered
//! R/W with implicit EPOLLHUP|EPOLLERR, tagged-pointer udata routed to Bun's
//! FilePoll dispatch (`Bun__internal_dispatch_ready_poll`).

use core::ffi::c_void;
use core::ptr;

use crate::backend::{self, Backend, Events, PollState, POINTER_TAG_MASK};
use crate::loop_::Loop;
use crate::unsafe_core::{ffi, poll_access};
use crate::LIBUS_SOCKET_DESCRIPTOR;

/// `ready_polls` element type; `Bun__internal_dispatch_ready_poll` reads it
/// back via `Loop::current_ready_event`.
pub type EventType = libc::epoll_event;

/// Epoll delivers one coalesced entry per fd (R1.21).
pub(crate) const READY_DUPES: i32 = 1;

pub(crate) struct Epoll {
    epfd: i32,
}

impl Epoll {
    pub(crate) fn from_fd(epfd: i32) -> Self {
        Epoll { epfd }
    }
}

impl Backend for Epoll {
    fn create() -> Result<Self, i32> {
        let epfd = poll_access::epoll_create_cloexec();
        if epfd < 0 {
            return Err(poll_access::last_errno());
        }
        poll_access::probe_epoll_pwait2();
        Ok(Epoll { epfd })
    }

    /// Fresh registration (mirrors `poll_start_rc`'s EPOLL_CTL_ADD). The
    /// parity paths are `poll_start_rc`/`poll_change`.
    fn change(&mut self, fd: LIBUS_SOCKET_DESCRIPTOR, events: Events, user: usize) -> i32 {
        let bits = kernel_bits(events);
        poll_access::epoll_ctl(self.epfd, libc::EPOLL_CTL_ADD, fd, bits, user as u64)
    }

    fn remove(&mut self, fd: LIBUS_SOCKET_DESCRIPTOR) -> i32 {
        poll_access::epoll_ctl(self.epfd, libc::EPOLL_CTL_DEL, fd, 0, 0)
    }

    fn wait(&mut self, loop_: *mut Loop, timeout_ns: i64) -> i32 {
        poll_access::epoll_wait_ready(loop_, timeout_ns)
    }
}

/// Zero requested events → poll for implicit EPOLLHUP|EPOLLERR only (always
/// reported even when unrequested). NEVER EPOLLRDHUP: level-triggered RDHUP
/// for an already-received FIN would spin the loop (R2.7).
fn kernel_bits(events: Events) -> u32 {
    if events.is_empty() {
        (libc::EPOLLHUP | libc::EPOLLERR) as u32
    } else {
        events.0
    }
}

pub(crate) fn poll_start_rc(p: *mut PollState, loop_: *mut Loop, events: Events) -> i32 {
    let mut st = poll_access::read_poll(p);
    st.set_polling(events);
    poll_access::write_poll(p, st);
    poll_access::epoll_ctl(
        poll_access::loop_fd(loop_),
        libc::EPOLL_CTL_ADD,
        st.fd(),
        kernel_bits(events),
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
    poll_access::epoll_ctl(
        poll_access::loop_fd(loop_),
        libc::EPOLL_CTL_MOD,
        st.fd(),
        kernel_bits(events),
        p as usize as u64,
    );
    backend::update_pending_ready_polls(loop_, p, p, old_events, events);
}

pub(crate) fn poll_stop(p: *mut PollState, loop_: *mut Loop) {
    let st = poll_access::read_poll(p);
    let old_events = st.events();
    poll_access::epoll_ctl(poll_access::loop_fd(loop_), libc::EPOLL_CTL_DEL, st.fd(), 0, 0);
    backend::update_pending_ready_polls(loop_, p, ptr::null_mut(), old_events, Events::NONE);
}

pub(crate) fn poll_resize(old: *mut PollState, new: *mut PollState, loop_: *mut Loop) {
    let events = poll_access::read_poll(old).events();
    // Strip the polling bits so poll_change forces the EPOLL_CTL_MOD that
    // re-points the kernel udata. Zero events no-ops like C, leaving the OLD
    // udata armed for HUP|ERR — the OQ-4 generation guard drops those events.
    let mut st = poll_access::read_poll(new);
    st.set_polling(Events::NONE);
    poll_access::write_poll(new, st);
    poll_change(new, loop_, events);
    backend::update_pending_ready_polls(loop_, old, new, events, events);
}

pub(crate) fn accept_poll_event(p: *mut PollState) -> u64 {
    poll_access::read_eventfd8(poll_access::read_poll(p).fd())
}

pub(crate) fn wait_immediate(loop_: *mut Loop) -> i32 {
    poll_access::epoll_wait_ready(loop_, 0)
}

/// R1.18: `current_ready_poll` is the live loop cursor (nested ticks and
/// `update_pending_ready_polls` read/write it mid-iteration — verbatim quirk).
pub(crate) fn dispatch_ready_polls(loop_: *mut Loop) {
    poll_access::set_current_ready_poll(loop_, 0);
    while poll_access::current_ready_poll(loop_) < poll_access::num_ready_polls(loop_) {
        let i = poll_access::current_ready_poll(loop_);
        let entry = poll_access::ready_poll_at(loop_, i);
        let udata = entry.u64;
        if udata != 0 {
            if udata & POINTER_TAG_MASK != 0 {
                ffi::dispatch_ready_poll(loop_, udata as usize as *mut c_void);
            } else {
                let kernel_events = entry.events;
                // Normalized to 0/1 like kqueue's EV_ERROR: a raw EPOLLERR (8)
                // would read as errno 8 downstream (R1.18).
                let error = kernel_events & libc::EPOLLERR as u32 != 0;
                let eof = kernel_events & libc::EPOLLHUP as u32 != 0;
                backend::dispatch_untagged(udata, error, eof, Events(kernel_events));
            }
        }
        poll_access::set_current_ready_poll(loop_, poll_access::current_ready_poll(loop_) + 1);
    }
}
