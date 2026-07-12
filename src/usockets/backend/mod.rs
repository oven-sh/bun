//! cfg-selected eventing backend (static dispatch; the future io_uring seam).
//! Poll semantics per docs/semantics.md §2 (POLL LAYER), including the
//! SEMI_SOCKET / CALLBACK / UDP / REGISTERED (poll registry) poll types.
//! Every udata is an untagged pointer owned by this crate (the poll registry deleted the
//! tagged-pointer FilePoll back-channel).

#[cfg(any(target_os = "linux", target_os = "android"))]
pub mod epoll;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub mod kqueue;
#[cfg(windows)]
pub mod libuv;

#[cfg(any(target_os = "linux", target_os = "android"))]
pub use epoll::EventType;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
pub use kqueue::EventType;

#[cfg(any(target_os = "linux", target_os = "android"))]
use epoll as platform;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
use kqueue as platform;

use core::ffi::c_void;

use crate::loop_::Loop;
use crate::unsafe_core::{deref, io, poll_access};
use crate::LIBUS_SOCKET_DESCRIPTOR;

/// `LIBUS_MAX_READY_POLLS` — capacity of `Loop.ready_polls`.
#[cfg(not(windows))]
pub(crate) const MAX_READY_POLLS: usize = 1024;

/// `POLL_TYPE_*` — low bits of the poll state (docs/semantics.md §2).
/// Deliberately renumbered vs internal.h (C: SOCKET=0..UDP=4); legal because
/// POLL_TYPE_* is crate-internal (docs/cabi.md §8) — do NOT "fix" to C.
#[repr(u8)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum PollType {
    // 0 is deliberately unassigned: a decommitted slab chunk reads as zeroed
    // memory, so kind bits 0 must resolve to dispatch's dropped arm — never
    // to a dispatchable kind (Callback polls have no generation guard).
    Callback = 1,
    /// A connect-in-progress or listen socket; dispatch bit-tests WRITABLE
    /// to tell them apart (loop.c:453).
    SemiSocket = 2,
    SocketShutDown = 3,
    Socket = 4,
    /// unsafe_core/io.rs packs `Udp as usize` into udata LOW bits (see
    /// [`UDP_TAG_MASK`]); the value must stay nonzero, odd, and ≤ 0xF.
    Udp = 5,
    /// First-class non-socket registration (loop_/poll_registry.rs).
    /// Slab-backed like sockets: dispatch generation-guards the slot, so a
    /// vacant slot retaining kind 6 drops the event.
    Registered = 6,
}

const KIND_CALLBACK: u8 = PollType::Callback as u8;
const KIND_SEMI_SOCKET: u8 = PollType::SemiSocket as u8;
const KIND_SOCKET_SHUT_DOWN: u8 = PollType::SocketShutDown as u8;
const KIND_SOCKET: u8 = PollType::Socket as u8;
pub(crate) const KIND_REGISTERED: u8 = PollType::Registered as u8;

/// Low 4 bits of an UNTAGGED udata word: `io::udp_tag` packs
/// `socket_ptr | PollType::Udp` (udp::Socket is align(16)); every other
/// udata is an aligned pointer with zero low bits.
pub(crate) const UDP_TAG_MASK: u64 = 0xF;

#[cfg(not(windows))]
const ECONNRESET_ERRNO: i32 = libc::ECONNRESET;
#[cfg(windows)]
const ECONNRESET_ERRNO: i32 = 10054; // WSAECONNRESET

/// Platform readiness bits (`LIBUS_SOCKET_READABLE`/`WRITABLE` differ per
/// platform and cross the ABI — docs/cabi.md §8).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct Events(pub u32);

impl Events {
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub const READABLE: Events = Events(libc::EPOLLIN as u32);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub const WRITABLE: Events = Events(libc::EPOLLOUT as u32);
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub const READABLE: Events = Events(1);
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub const WRITABLE: Events = Events(2);
    #[cfg(windows)]
    pub const READABLE: Events = Events(1); // UV_READABLE
    #[cfg(windows)]
    pub const WRITABLE: Events = Events(2); // UV_WRITABLE

    pub const NONE: Events = Events(0);

    #[inline]
    pub fn contains(self, other: Events) -> bool {
        self.0 & other.0 != 0
    }

    #[inline]
    pub fn is_empty(self) -> bool {
        self.0 == 0
    }
}

impl core::ops::BitOr for Events {
    type Output = Events;
    fn bitor(self, rhs: Events) -> Events {
        Events(self.0 | rhs.0)
    }
}

impl core::ops::BitAnd for Events {
    type Output = Events;
    fn bitand(self, rhs: Events) -> Events {
        Events(self.0 & rhs.0)
    }
}

impl core::ops::BitOrAssign for Events {
    fn bitor_assign(&mut self, rhs: Events) {
        self.0 |= rhs.0;
    }
}

/// `us_poll_t` state word: `{fd:27 signed, poll_type:5}` (R2.2). The 5-bit
/// poll_type holds the kind in its low 3 bits plus POLLING_OUT/POLLING_IN.
/// Every poll-owning object embeds this as its FIRST field (repr(C)) so the
/// kernel udata pointer doubles as the object pointer.
#[repr(transparent)]
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct PollState(pub(crate) u32);

impl PollState {
    const FD_BITS: u32 = 27;
    const FD_MASK: u32 = (1 << Self::FD_BITS) - 1;
    const KIND_MASK: u32 = 0b111 << Self::FD_BITS;
    /// `POLL_TYPE_POLLING_OUT` (8) / `POLL_TYPE_POLLING_IN` (16) within the
    /// 5-bit poll_type field.
    const POLLING_OUT: u32 = 1 << (Self::FD_BITS + 3);
    const POLLING_IN: u32 = 1 << (Self::FD_BITS + 4);

    /// `us_poll_init` (R2.5): sets fd + kind, clearing the polling bits.
    /// fd is limited to 2^26-1 (silently truncated like the C bitfield).
    pub(crate) const fn init(fd: LIBUS_SOCKET_DESCRIPTOR, kind: PollType) -> PollState {
        PollState((fd as u32 & Self::FD_MASK) | ((kind as u32) << Self::FD_BITS))
    }

    /// Signed 27-bit fd (−1 legal but never used). POSIX-only: a Windows
    /// SOCKET does not fit — libuv paths read the full-width `SocketHeader.fd`.
    #[cfg(not(windows))]
    pub(crate) const fn fd(self) -> LIBUS_SOCKET_DESCRIPTOR {
        ((self.0 << (32 - Self::FD_BITS)) as i32) >> (32 - Self::FD_BITS)
    }

    pub(crate) const fn kind_bits(self) -> u8 {
        ((self.0 & Self::KIND_MASK) >> Self::FD_BITS) as u8
    }

    /// `us_internal_poll_set_type` (R2.5): replaces the kind bits only,
    /// preserving polling bits — the poll must be inited first.
    pub(crate) fn set_kind(&mut self, kind: PollType) {
        self.0 = (self.0 & !Self::KIND_MASK) | ((kind as u32) << Self::FD_BITS);
    }

    /// `us_poll_events` (R2.6): the poll's *believed* registration; the
    /// source of truth for the dispatch-time event mask (R1.18).
    pub(crate) const fn events(self) -> Events {
        let mut e = 0u32;
        if self.0 & Self::POLLING_IN != 0 {
            e |= Events::READABLE.0;
        }
        if self.0 & Self::POLLING_OUT != 0 {
            e |= Events::WRITABLE.0;
        }
        Events(e)
    }

    pub(crate) fn set_polling(&mut self, events: Events) {
        self.0 &= !(Self::POLLING_IN | Self::POLLING_OUT);
        if events.contains(Events::READABLE) {
            self.0 |= Self::POLLING_IN;
        }
        if events.contains(Events::WRITABLE) {
            self.0 |= Self::POLLING_OUT;
        }
    }
}

/// Invoked with `loop_` when `cb_expects_the_loop`, else with the poll
/// pointer itself (the C `us_internal_callback_t` cast dance, type-erased).
pub(crate) type CallbackFn = unsafe extern "C" fn(*mut c_void);

/// `us_internal_callback_t` — the CALLBACK-kind poll body (wakeup async;
/// timers exist only on libuv). loop_/wakeup.rs owns creation/teardown.
#[repr(C)]
#[derive(Copy, Clone)]
pub(crate) struct CallbackPoll {
    pub state: PollState,
    pub loop_: *mut Loop,
    pub cb: Option<CallbackFn>,
    /// Skip `accept_poll_event` (edge-triggered eventfd wakeup on epoll).
    pub leave_poll_ready: bool,
    pub cb_expects_the_loop: bool,
    #[cfg(target_os = "macos")]
    pub port: u32, // mach_port_t
    #[cfg(target_os = "macos")]
    pub machport_buf: *mut c_void,
}

/// The eventing seam for kernel-ready-list backends, selected by cfg — no
/// vtables (closed set). libuv (Windows) does not implement it: readiness
/// dispatches inside uv callbacks and ticking is `libuv::run`/`pump` over
/// `*mut Loop` (no `&mut` may span a tick — C17).
#[cfg(not(windows))]
pub(crate) trait Backend {
    /// Create the kernel poller; returns its fd (`Loop.fd`).
    fn create() -> Result<Self, i32>
    where
        Self: Sized;

    /// Arm/modify interest for `fd` with a tagged-pointer user word.
    fn change(&mut self, fd: LIBUS_SOCKET_DESCRIPTOR, events: Events, user: usize) -> i32;

    /// Remove `fd` (tolerates EBADF/ENOENT on teardown).
    fn remove(&mut self, fd: LIBUS_SOCKET_DESCRIPTOR) -> i32;

    /// Block for up to `timeout_ns` (-1 = forever); fill `loop.ready_polls`,
    /// return the ready count. Pass 0 when the tick must not idle (pending
    /// wakeups) — kqueue maps that to KEVENT_FLAG_IMMEDIATE (R1.10 step 8).
    fn wait(&mut self, loop_: *mut Loop, timeout_ns: i64) -> i32;

    /// poll registry arm. Kqueue implements the darwin filter arms
    /// (EVFILT_PROC/MACHPORT/MEMORYSTATUS); epoll implements Fd + Pri
    /// (EPOLLPRI, Linux PSI trigger fds).
    fn arm_source(
        &mut self,
        p: *mut PollState,
        loop_: *mut Loop,
        source: crate::loop_::poll_registry::PollSource,
    ) -> i32;

    /// poll registry disarm (also nulls pending ready-list entries for `p`).
    fn disarm_source(
        &mut self,
        p: *mut PollState,
        loop_: *mut Loop,
        armed: crate::loop_::poll_registry::ArmedSource,
    );
}

// ── poll registration (R2.7-R2.11; per-platform kernel mechanics) ────────────

/// `us_poll_start_rc`: store polling bits, register with the kernel, return
/// the raw rc (0 success; epoll −1 + errno, kqueue >0 error events + errno).
#[cfg(not(windows))]
pub(crate) fn poll_start_rc(p: *mut PollState, loop_: *mut Loop, events: Events) -> i32 {
    platform::poll_start_rc(p, loop_, events)
}

/// `us_poll_start` — same as [`poll_start_rc`] ignoring the rc.
#[cfg(not(windows))]
pub(crate) fn poll_start(p: *mut PollState, loop_: *mut Loop, events: Events) {
    let _ = platform::poll_start_rc(p, loop_, events);
}

/// `us_poll_change` (R2.8): no-op if unchanged, else re-register and null
/// out removed instances in the pending ready-poll window.
#[cfg(not(windows))]
pub(crate) fn poll_change(p: *mut PollState, loop_: *mut Loop, events: Events) {
    platform::poll_change(p, loop_, events);
}

/// `us_poll_stop` (R2.10). Poll bits in `p` are NOT cleared.
#[cfg(not(windows))]
pub(crate) fn poll_stop(p: *mut PollState, loop_: *mut Loop) {
    platform::poll_stop(p, loop_);
}

/// Registration half of `us_poll_resize` (R2.11): re-point the kernel udata
/// from `old` to `new` and rewrite pending ready polls. Size checks,
/// allocation, memcpy, and `num_polls++` are the caller's.
#[cfg(not(windows))]
pub(crate) fn poll_resize(old: *mut PollState, new: *mut PollState, loop_: *mut Loop) {
    platform::poll_resize(old, new, loop_);
}

/// `us_internal_accept_poll_event`: epoll reads 8 bytes off the eventfd
/// (EINTR-retried); kqueue user events have no underlying fd (no-op, 0).
#[cfg(not(windows))]
pub(crate) fn accept_poll_event(p: *mut PollState) -> u64 {
    platform::accept_poll_event(p)
}

// ── poll registry registration (per-source kernel mechanics) ─────────────────

/// Interest-set → platform readiness bits for registry Fd sources.
pub(crate) fn fd_interest(readable: bool, writable: bool) -> Events {
    let mut e = Events::NONE;
    if readable {
        e |= Events::READABLE;
    }
    if writable {
        e |= Events::WRITABLE;
    }
    e
}

/// Arm a registry source; returns 0 on success, else the raw rc with errno
/// set (same contract as [`poll_start_rc`]).
#[cfg(not(windows))]
pub(crate) fn registry_arm(
    p: *mut PollState,
    loop_: *mut Loop,
    source: crate::loop_::poll_registry::PollSource,
) -> i32 {
    platform::registry_arm(p, loop_, source)
}

/// Update a registry Fd source's interest (level-triggered on both backends
/// — no oneshot-WRITE socket rule). Returns 0 on success, else the raw rc
/// with errno set (same contract as [`poll_start_rc`]).
#[cfg(not(windows))]
pub(crate) fn registry_change(p: *mut PollState, loop_: *mut Loop, events: Events) -> i32 {
    platform::registry_change(p, loop_, events)
}

/// Disarm a registry source and null its pending ready-list entries. Must
/// strictly precede the slot free.
#[cfg(not(windows))]
pub(crate) fn registry_disarm(
    p: *mut PollState,
    loop_: *mut Loop,
    armed: crate::loop_::poll_registry::ArmedSource,
) {
    platform::registry_disarm(p, loop_, armed)
}

// ── ready-poll pipeline (R1.18-R1.21) ─────────────────────────────────────────

/// `us_internal_dispatch_ready_polls`: iterate `ready_polls` via the loop's
/// live `current_ready_poll` cursor (nested ticks may clobber it — quirk
/// ported verbatim), routing tagged udata to Bun's FilePoll dispatch.
#[cfg(not(windows))]
pub(crate) fn dispatch_ready_polls(loop_: *mut Loop) {
    platform::dispatch_ready_polls(loop_);
}

/// `us_internal_drain_ready_polls` (R1.20): while the kernel filled the
/// whole buffer, re-poll non-blocking and dispatch again, at most 48 times.
#[cfg(not(windows))]
pub(crate) fn drain_ready_polls(loop_: *mut Loop) {
    let mut drain_count: i32 = 48;
    while poll_access::num_ready_polls(loop_) == MAX_READY_POLLS as i32 && {
        drain_count -= 1;
        drain_count != 0
    } && poll_access::num_polls(loop_) > 0
    {
        let n = platform::wait_immediate(loop_);
        if n <= 0 {
            poll_access::set_num_ready_polls(loop_, 0);
            break;
        }
        platform::dispatch_ready_polls(loop_);
    }
}

/// `us_internal_loop_update_pending_ready_polls` (R1.21): rewrite up to N
/// not-yet-dispatched entries whose udata equals `old` (N = 1 epoll,
/// 2 kqueue). `new` may be null (poll_stop / close).
#[cfg(not(windows))]
pub(crate) fn update_pending_ready_polls(
    loop_: *mut Loop,
    old: *mut PollState,
    new: *mut PollState,
    _old_events: Events,
    _new_events: Events,
) {
    let old_word = old as usize as u64;
    let new_word = new as usize as u64;
    let mut remaining = platform::READY_DUPES;
    let mut i = poll_access::current_ready_poll(loop_);
    while i < poll_access::num_ready_polls(loop_) && remaining > 0 {
        if poll_access::ready_poll_udata(loop_, i) == old_word {
            poll_access::set_ready_poll_udata(loop_, i, new_word);
            remaining -= 1;
        }
        i += 1;
    }
}

// ── per-poll dispatch (R2.12) ─────────────────────────────────────────────────

/// Untagged-udata router: a UDP udata is `socket_ptr | PollType::Udp` and
/// does NOT point at a PollState — decode it BEFORE the word is treated as
/// one. Masks kernel events with the poll's believed events (R1.18).
#[cfg(not(windows))]
pub(crate) fn dispatch_untagged(udata: u64, error: bool, eof: bool, raw: Events) {
    if udata & UDP_TAG_MASK == PollType::Udp as u64 {
        let s = (udata & !UDP_TAG_MASK) as usize as *mut crate::udp::Socket;
        let events = raw & Events(io::udp_poll_events(s));
        if !events.is_empty() || error || eof {
            // eof is unread in the UDP arm, as in C's POLL_TYPE_UDP case.
            crate::udp::dispatch_ready_poll(
                s,
                error,
                events.contains(Events::READABLE),
                events.contains(Events::WRITABLE),
            );
        }
        return;
    }
    let p = udata as usize as *mut PollState;
    let events = raw & poll_access::read_poll(p).events();
    if !events.is_empty() || error || eof {
        dispatch_ready_poll(p, error, eof, events);
    }
}

/// `us_internal_dispatch_ready_poll`: switch on the poll kind. Slab-backed
/// kinds probe the slot's generation PARITY (quirk OQ-4 — docs/semantics.md): vacant
/// drops the event; recycled slots are unreachable (deferred free + close DEL).
pub(crate) fn dispatch_ready_poll(p: *mut PollState, error: bool, eof: bool, events: Events) {
    let st = poll_access::read_poll(p);
    // INVARIANT: kind bits are read from possibly-recycled slab memory BEFORE
    // the generation probe; vacant slots keep kind in {2,3,4,6} — all
    // generation-guarded arms — and decommitted chunks read 0 (unassigned),
    // so neither reaches the unguarded CALLBACK arm.
    match st.kind_bits() {
        KIND_SEMI_SOCKET | KIND_SOCKET | KIND_SOCKET_SHUT_DOWN => {
            if poll_access::slab_generation(p) & 1 == 0 {
                return;
            }
            if st.kind_bits() == KIND_SEMI_SOCKET {
                // A connecting socket may have gained R via a pre-connect
                // partial write; test the W bit, not equality. Listen
                // sockets only ever poll READABLE (loop.c:446-453).
                if st.events().contains(Events::WRITABLE) {
                    let s = p.cast::<crate::socket::us_socket_t>();
                    // loop.c:453-467: report the kernel's actual SO_ERROR
                    // (0 → ECONNRESET for the completed-then-reset race),
                    // never the literal error/eof booleans. Full-width header
                    // fd — the packed PollState fd is 27-bit (POSIX-only).
                    let mut connect_error = 0;
                    if error || eof {
                        connect_error = io::so_error(deref::with_socket(s, |h| h.fd));
                        if connect_error == 0 {
                            connect_error = ECONNRESET_ERRNO;
                        }
                    }
                    let cs = deref::with_socket(s, |h| h.connect_state);
                    crate::socket::on_connect(s, cs, connect_error);
                } else {
                    crate::group::on_accept_poll_ready(p.cast());
                }
            } else {
                crate::socket::on_socket_poll_ready(p.cast(), error, eof, events);
            }
        }
        // poll registry polls; epoll/libuv route here. Unreachable on kqueue:
        // pass 1 tags registered udata FL_REGISTERED (per-kevent payload
        // dispatch) and pass 2 drops zero-flag nested-tick appends before
        // dispatch_untagged. Generation guard lives in dispatch_ready.
        KIND_REGISTERED => {
            crate::loop_::poll_registry::dispatch_ready(
                p,
                crate::loop_::poll_registry::PollEvents {
                    readable: events.contains(Events::READABLE),
                    writable: events.contains(Events::WRITABLE),
                    error,
                    eof,
                    fflags: 0,
                    data: 0,
                },
            );
        }
        KIND_CALLBACK => {
            let cb = poll_access::read_callback_poll(p.cast());
            if !cb.leave_poll_ready {
                #[cfg(not(windows))]
                accept_poll_event(p);
            }
            let arg = if cb.cb_expects_the_loop {
                cb.loop_.cast::<c_void>()
            } else {
                p.cast::<c_void>()
            };
            poll_access::invoke_callback(cb.cb.expect("CALLBACK poll without cb"), arg);
        }
        // Udp never reaches this switch (routed by the low-bit udata tag in
        // dispatch_untagged); 0 is unassigned (zeroed/decommitted slot reads
        // land here); garbage kind bits from a recycled slot are dropped.
        _ => {}
    }
}
