//! epoll backend (Linux/Android). Implements docs/semantics.md §1-2 poll
//! mechanics: epoll_pwait2 with an ENOSYS fallback latch, level-triggered
//! R/W with implicit EPOLLHUP|EPOLLERR. All udata are untagged slot pointers
//! (the poll registry removed the tagged-pointer FilePoll back-channel).

use core::ptr;

use crate::backend::{self, Backend, Events, PollState};
use crate::loop_::Loop;
use crate::unsafe_core::poll_access;
use crate::LIBUS_SOCKET_DESCRIPTOR;

/// `ready_polls` element type.
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

pub(crate) fn poll_change(p: *mut PollState, loop_: *mut Loop, events: Events) -> i32 {
    let mut st = poll_access::read_poll(p);
    let old_events = st.events();
    if old_events == events {
        return 0;
    }
    st.set_polling(events);
    poll_access::write_poll(p, st);
    let rc = poll_access::epoll_ctl(
        poll_access::loop_fd(loop_),
        libc::EPOLL_CTL_MOD,
        st.fd(),
        kernel_bits(events),
        p as usize as u64,
    );
    backend::update_pending_ready_polls(loop_, p, p, old_events, events);
    rc
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

// ── poll registry sources (Fd + Pri on epoll) ────────────────────────────────

pub(crate) fn registry_arm(
    p: *mut PollState,
    loop_: *mut Loop,
    source: crate::loop_::poll_registry::PollSource,
) -> i32 {
    match source {
        crate::loop_::poll_registry::PollSource::Fd {
            readable, writable, ..
        } => poll_start_rc(p, loop_, backend::fd_interest(readable, writable)),
        // PSI trigger fds signal via EPOLLPRI only; the slot's believed events
        // are READABLE (dispatch translates PRI→IN before the R1.18 mask).
        crate::loop_::poll_registry::PollSource::Pri { .. } => {
            let mut st = poll_access::read_poll(p);
            st.set_polling(Events::READABLE);
            poll_access::write_poll(p, st);
            poll_access::epoll_ctl(
                poll_access::loop_fd(loop_),
                libc::EPOLL_CTL_ADD,
                st.fd(),
                (libc::EPOLLPRI | libc::EPOLLERR) as u32,
                p as usize as u64,
            )
        }
    }
}

/// Interest update — same EPOLL_CTL_MOD as socket [`poll_change`], but the
/// slot's bits commit only after the kernel accepts the change: a failed MOD
/// keeps the old interest, so an identical retry re-issues the syscall.
pub(crate) fn registry_change(p: *mut PollState, loop_: *mut Loop, events: Events) -> i32 {
    let mut st = poll_access::read_poll(p);
    let old_events = st.events();
    if old_events == events {
        return 0;
    }
    let rc = poll_access::epoll_ctl(
        poll_access::loop_fd(loop_),
        libc::EPOLL_CTL_MOD,
        st.fd(),
        kernel_bits(events),
        p as usize as u64,
    );
    if rc != 0 {
        return rc;
    }
    st.set_polling(events);
    poll_access::write_poll(p, st);
    backend::update_pending_ready_polls(loop_, p, p, old_events, events);
    rc
}

pub(crate) fn registry_disarm(
    p: *mut PollState,
    loop_: *mut Loop,
    _armed: crate::loop_::poll_registry::ArmedSource,
) {
    poll_stop(p, loop_);
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
            let mut kernel_events = entry.events;
            // EPOLLPRI is only ever requested by registry Pri sources (PSI
            // trigger fds), whose believed events are READABLE — translate so
            // the R1.18 mask passes the event through.
            if kernel_events & libc::EPOLLPRI as u32 != 0 {
                kernel_events |= libc::EPOLLIN as u32;
            }
            // Normalized to 0/1 like kqueue's EV_ERROR: a raw EPOLLERR (8)
            // would read as errno 8 downstream (R1.18).
            let error = kernel_events & libc::EPOLLERR as u32 != 0;
            let eof = kernel_events & libc::EPOLLHUP as u32 != 0;
            backend::dispatch_untagged(udata, error, eof, Events(kernel_events));
        }
        poll_access::set_current_ready_poll(loop_, poll_access::current_ready_poll(loop_) + 1);
    }
}
