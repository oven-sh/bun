//! First-class non-socket poll registrations (docs/design.md §Non-socket poll registrations).
//! Consumers register a [`PollSource`] with a refcounted owner; readiness
//! dispatches through the Protocol-v2 guard (a strong owner ref is held
//! across the handler, so an owner dropping to zero refs mid-callback stays
//! alive until dispatch returns). Slots live in the loop's `polls` slab with
//! the same generation scheme as sockets: a stale [`PollRef`] is a no-op,
//! never a dangling deref. Keep-alive is integrated with `num_polls`/`active`
//! (`Loop::ref_`/`unref`) — consumers never poke loop fields.
//!
//! `src/io/`'s FilePoll moved onto this registry; the
//! `Bun__internal_dispatch_ready_poll` extern, the `ready_polls`/
//! `current_ready_poll` back-channel, and the tagged-pointer udata
//! convention are gone.

use core::ffi::c_void;
use core::ptr::NonNull;

use crate::backend::{PollState, PollType};
use crate::loop_::Loop;
use crate::protocol::OwnerRef;
use crate::unsafe_core::ext::deref_mut;
use crate::unsafe_core::{ffi, poll_access, slab, trampolines};

/// What a registration watches. `Fd` is cross-platform; the darwin variants
/// map to kqueue filters (EVFILT_PROC/NOTE_EXIT, EVFILT_MACHPORT,
/// EVFILT_MEMORYSTATUS) and only exist on macOS.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub enum PollSource {
    /// Level-triggered fd readiness. At least one direction must be set.
    Fd {
        fd: crate::LIBUS_SOCKET_DESCRIPTOR,
        readable: bool,
        writable: bool,
    },
    /// Exceptional-condition readiness (`EPOLLPRI` — Linux PSI trigger fds);
    /// delivered to the handler as `readable`.
    #[cfg(any(target_os = "linux", target_os = "android"))]
    Pri { fd: crate::LIBUS_SOCKET_DESCRIPTOR },
    /// Process-exit watch (`EVFILT_PROC`/`NOTE_EXIT` on `pid`).
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    Proc { pid: i32 },
    /// Mach port receive-readiness (`EVFILT_MACHPORT`; the handler performs
    /// its own receive).
    #[cfg(target_os = "macos")]
    Machport { port: u32 },
    /// System memory-pressure transitions (`EVFILT_MEMORYSTATUS`,
    /// WARN|CRITICAL, EV_CLEAR); the level arrives in [`PollEvents::fflags`].
    #[cfg(target_os = "macos")]
    Memorystatus,
}

/// Armed-source discriminant stored in the slot. Fd interest deliberately
/// lives ONLY in the slot's `PollState` polling bits (single source of truth
/// — `PollRef::change` updates them); this enum carries what disarm needs.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub(crate) enum ArmedSource {
    Fd,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    Pri,
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    Proc {
        pid: i32,
    },
    #[cfg(target_os = "macos")]
    Machport {
        port: u32,
    },
    #[cfg(target_os = "macos")]
    Memorystatus,
}

/// Readiness payload. `fflags`/`data` are the raw kqueue filter payload
/// (memory-pressure level, NOTE_EXIT status); 0 on epoll/libuv.
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct PollEvents {
    pub readable: bool,
    pub writable: bool,
    pub error: bool,
    pub eof: bool,
    pub fflags: u32,
    pub data: i64,
}

/// Safe registered-poll handler set (the non-socket sibling of
/// [`crate::protocol::Protocol`]). The handler may synchronously call any
/// [`PollRef`] method, including `unregister` (C17).
pub trait PollProtocol: Sized + 'static {
    /// Loop-local (!Send) interior-mutable owner. `register` transfers one
    /// strong ref to the slot; the trampoline additionally brackets every
    /// dispatch with its own ref, so the owner's LAST release always happens
    /// outside a running handler.
    type Owner: bun_ptr::RefCounted<DestructorCtx: Default> + 'static;

    fn on_event(owner: &Self::Owner, poll: PollRef, events: PollEvents);
}

/// Type-erased owner ops for a registered poll (monomorphized once per
/// protocol by `trampolines::poll_owner_ops`).
pub(crate) struct PollOwnerOps {
    /// SAFETY (caller): `word` points to a live registered owner whose slot
    /// still holds the transferred strong ref.
    pub(crate) dispatch: unsafe fn(*mut c_void, PollRef, PollEvents),
    /// SAFETY (caller): releases the one outstanding transferred strong ref.
    pub(crate) deref: unsafe fn(*mut c_void),
}

/// Slab-resident registration. `PollState` is the FIRST field (repr(C)) so
/// the kernel udata pointer doubles as the slot pointer, exactly like
/// sockets (poll kind byte = `PollType::Registered`).
#[repr(C)]
pub struct RegisteredPoll {
    pub(crate) state: PollState,
    source: ArmedSource,
    loop_: *mut Loop,
    /// One strong owner ref, transferred at `register`. INVARIANT: always
    /// taken out (nulled) BEFORE the slot is freed — `unregister`, the
    /// register-failure unwind, and loop teardown all release it outside
    /// every slab borrow (an owner destructor may re-enter the registry;
    /// deliberately no `Drop` impl, so a missed release leaks, never UB).
    owner: *mut c_void,
    ops: &'static PollOwnerOps,
    keep_alive: bool,
}

const _: () = assert!(core::mem::offset_of!(RegisteredPoll, state) == 0);

/// Loop-teardown extraction: take the slot's owner word (nulling it) so the
/// ref can be released AFTER the slab borrow ends (ffi::free_loop_raw).
pub(crate) fn take_owner_for_teardown(
    p: NonNull<RegisteredPoll>,
) -> (&'static PollOwnerOps, *mut c_void) {
    poll_access::with_registered(p.as_ptr(), |q| {
        (
            q.ops,
            core::mem::replace(&mut q.owner, core::ptr::null_mut()),
        )
    })
}

/// Generation-checked Copy handle to a registration. Every method validates
/// against the slab slot; stale == silent no-op (same rule as `SocketRef`).
#[derive(Copy, Clone, Eq, PartialEq, Debug)]
pub struct PollRef {
    ptr: NonNull<RegisteredPoll>,
    generation: u64,
}

impl PollRef {
    pub(crate) fn from_live(ptr: NonNull<RegisteredPoll>) -> PollRef {
        PollRef {
            ptr,
            generation: slab::generation_of(ptr),
        }
    }

    fn resolve(self) -> Option<NonNull<RegisteredPoll>> {
        (slab::generation_of(self.ptr) == self.generation).then_some(self.ptr)
    }

    pub fn is_alive(self) -> bool {
        self.resolve().is_some()
    }

    /// Toggle loop keep-alive (`Loop::ref_`/`unref`). Idempotent per state.
    pub fn set_keep_alive(self, keep_alive: bool) {
        let Some(p) = self.resolve() else { return };
        let (loop_, prev) = poll_access::with_registered(p.as_ptr(), |q| {
            let prev = q.keep_alive;
            q.keep_alive = keep_alive;
            (q.loop_, prev)
        });
        if prev == keep_alive {
            return;
        }
        if keep_alive {
            deref_mut(loop_).ref_();
        } else {
            deref_mut(loop_).unref();
        }
    }

    /// Update an `Fd` source's interest set. `Ok` no-op for stale handles,
    /// non-Fd sources, and the empty interest set; a kernel failure (e.g.
    /// ENOENT after the fd was closed while armed) surfaces as `Err(errno)`.
    pub fn change(self, readable: bool, writable: bool) -> Result<(), i32> {
        let Some(p) = self.resolve() else {
            return Ok(());
        };
        let loop_ = poll_access::with_registered(p.as_ptr(), |q| q.loop_);
        Self::change_via(p, loop_, readable, writable)
    }

    /// [`Self::change`] with loop mutation routed through the caller-held
    /// borrow — required when a `&mut Loop` is live in the calling frame
    /// (a write through the slot's stored loop pointer would be a foreign
    /// mutation under that borrow's protector).
    pub fn change_on(self, loop_: &mut Loop, readable: bool, writable: bool) -> Result<(), i32> {
        let Some(p) = self.resolve() else {
            return Ok(());
        };
        debug_assert!(core::ptr::eq(
            poll_access::with_registered(p.as_ptr(), |q| q.loop_),
            loop_
        ));
        Self::change_via(p, loop_, readable, writable)
    }

    fn change_via(
        p: NonNull<RegisteredPoll>,
        loop_: *mut Loop,
        readable: bool,
        writable: bool,
    ) -> Result<(), i32> {
        if !readable && !writable {
            return Ok(());
        }
        let is_fd =
            poll_access::with_registered(p.as_ptr(), |q| matches!(q.source, ArmedSource::Fd));
        if !is_fd {
            return Ok(());
        }
        #[cfg(not(windows))]
        {
            let rc = crate::backend::registry_change(
                p.as_ptr().cast::<PollState>(),
                loop_,
                crate::backend::fd_interest(readable, writable),
            );
            if rc != 0 {
                return Err(poll_access::last_errno());
            }
        }
        #[cfg(windows)]
        let _ = loop_;
        Ok(())
    }

    /// Disarm the kernel registration, drop keep-alive, free the slot
    /// (generation bump — every outstanding `PollRef` goes stale), then
    /// release the transferred owner ref. Safe to call from inside the
    /// owner's own `on_event` (the dispatch guard keeps the owner alive).
    pub fn unregister(self) {
        let Some(p) = self.resolve() else { return };
        let loop_ = poll_access::with_registered(p.as_ptr(), |q| q.loop_);
        Self::unregister_via(p, loop_);
    }

    /// [`Self::unregister`] with loop mutation routed through the caller-held
    /// borrow (same protector rule as [`Self::change_on`]). The transferred
    /// owner ref is released inside: an owner destructor that touches the
    /// loop other than via `loop_` would still be a foreign access.
    pub fn unregister_on(self, loop_: &mut Loop) {
        let Some(p) = self.resolve() else { return };
        debug_assert!(core::ptr::eq(
            poll_access::with_registered(p.as_ptr(), |q| q.loop_),
            loop_
        ));
        Self::unregister_via(p, loop_);
    }

    fn unregister_via(p: NonNull<RegisteredPoll>, loop_: *mut Loop) {
        let (armed, keep_alive, word, ops) = poll_access::with_registered(p.as_ptr(), |q| {
            (
                q.source,
                q.keep_alive,
                core::mem::replace(&mut q.owner, core::ptr::null_mut()),
                q.ops,
            )
        });
        // Disarm discipline: kernel disarm (incl. pending ready-list nulling)
        // strictly precedes the slot free.
        #[cfg(not(windows))]
        crate::backend::registry_disarm(p.as_ptr().cast::<PollState>(), loop_, armed);
        #[cfg(windows)]
        let _ = armed;
        if keep_alive {
            deref_mut(loop_).unref();
        }
        ffi::slab_free_poll(loop_, p.as_ptr());
        // Owner release LAST, outside every slab/loop borrow — the owner's
        // destructor may run here and re-enter the registry.
        trampolines::release_poll_owner(ops, word);
    }
}

/// Register `source` with `owner` (ONE strong ref transferred; released
/// exactly once — at `unregister`, or at loop teardown). `keep_alive` counts
/// the poll in `num_polls`/`active`; `false` = fallthrough (like the wakeup
/// async). On kernel-registration failure the ref is released and the errno
/// returned. Windows: the slot and keep-alive accounting exist but no kernel
/// registration happens (uv-driven readiness stays outside for now).
///
/// A source already registered on `loop_` must not be registered again: the
/// backends diverge (epoll fails with EEXIST; kqueue's EV_ADD silently
/// re-points the knote's udata, orphaning the earlier slot).
///
/// pub(crate): the safe public entry is [`Loop::register_poll`] — a safe pub
/// fn must not deref a caller-supplied raw pointer.
pub(crate) fn register<P: PollProtocol>(
    loop_: *mut Loop,
    source: PollSource,
    owner: OwnerRef<P::Owner>,
    keep_alive: bool,
) -> Result<PollRef, i32> {
    let (armed, fd) = match source {
        PollSource::Fd {
            fd,
            readable,
            writable,
        } => {
            if !readable && !writable {
                owner.deref();
                return Err(libc::EINVAL);
            }
            (ArmedSource::Fd, fd)
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        PollSource::Pri { fd } => (ArmedSource::Pri, fd),
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        PollSource::Proc { pid } => (ArmedSource::Proc { pid }, 0),
        #[cfg(target_os = "macos")]
        PollSource::Machport { port } => (ArmedSource::Machport { port }, 0),
        #[cfg(target_os = "macos")]
        PollSource::Memorystatus => (ArmedSource::Memorystatus, 0),
    };

    let p = ffi::slab_alloc_poll(
        loop_,
        RegisteredPoll {
            state: PollState::init(fd, PollType::Registered),
            source: armed,
            loop_,
            owner: owner.into_raw().cast::<c_void>(),
            ops: trampolines::poll_owner_ops::<P>(),
            keep_alive,
        },
    );

    #[cfg(not(windows))]
    {
        let rc = crate::backend::registry_arm(p.cast::<PollState>(), loop_, source);
        if rc != 0 {
            let err = poll_access::last_errno();
            // Purge any partially-armed filter (kqueue arms ≤2 separate
            // submissions) — kernel-held udata must never outlive the slot
            // (disarm-before-free). NOT on epoll: its single EPOLL_CTL_ADD is atomic, and a
            // DEL here would disarm a sibling registration on EEXIST.
            #[cfg(any(target_os = "macos", target_os = "freebsd"))]
            crate::backend::registry_disarm(p.cast::<PollState>(), loop_, armed);
            // Take the owner out BEFORE the slab free so its release (and a
            // possibly re-entrant destructor) runs outside the slab borrow.
            let (word, ops) = poll_access::with_registered(p, |q| {
                (
                    core::mem::replace(&mut q.owner, core::ptr::null_mut()),
                    q.ops,
                )
            });
            ffi::slab_free_poll(loop_, p);
            trampolines::release_poll_owner(ops, word);
            return Err(err);
        }
    }

    if keep_alive {
        deref_mut(loop_).ref_();
    }
    Ok(PollRef::from_live(
        NonNull::new(p).expect("slab returned null poll slot"),
    ))
}

impl Loop {
    /// Safe registration entry: see [`register`] for the ownership and
    /// duplicate-source contract. `&mut self` proves the loop is live and
    /// that the caller runs on the loop thread.
    pub fn register_poll<P: PollProtocol>(
        &mut self,
        source: PollSource,
        owner: OwnerRef<P::Owner>,
        keep_alive: bool,
    ) -> Result<PollRef, i32> {
        register::<P>(self, source, owner, keep_alive)
    }
}

/// Backend dispatch entry (kind byte == `PollType::Registered`). Generation
/// parity guards stale kernel udata (vacant/decommitted slots drop the
/// event); the owner guard is taken by the trampoline.
pub(crate) fn dispatch_ready(p: *mut PollState, events: PollEvents) {
    let Some(nn) = NonNull::new(p.cast::<RegisteredPoll>()) else {
        return;
    };
    if slab::generation_of(nn) & 1 == 0 {
        return;
    }
    let r = PollRef::from_live(nn);
    let (word, ops) = poll_access::with_registered(nn.as_ptr(), |q| (q.owner, q.ops));
    if word.is_null() {
        return;
    }
    trampolines::dispatch_poll_owner(ops, word, r, events);
}

#[cfg(all(test, not(miri), any(target_os = "linux", target_os = "android")))]
mod tests {
    use core::cell::{Cell, RefCell};
    use std::rc::Rc;

    use super::*;
    use crate::backend::{Events, KIND_REGISTERED};
    use crate::unsafe_core::io;
    use crate::unsafe_core::test_support::{create_test_loop, free_test_loop};

    #[derive(bun_ptr::RefCounted)]
    struct TestOwner {
        ref_count: bun_ptr::RefCount<TestOwner>,
        events: RefCell<Vec<PollEvents>>,
        poll: Cell<Option<PollRef>>,
        dropped: Rc<Cell<bool>>,
        reenter_in_drop: bool,
    }

    impl Drop for TestOwner {
        fn drop(&mut self) {
            self.dropped.set(true);
            if self.reenter_in_drop {
                if let Some(r) = self.poll.get() {
                    // Teardown regression: a destructor running during loop
                    // free must see a stale handle and no-op — never touch a
                    // mid-drop slab.
                    assert!(!r.is_alive());
                    r.unregister();
                }
            }
        }
    }

    struct FdProto;
    impl PollProtocol for FdProto {
        type Owner = TestOwner;
        fn on_event(owner: &TestOwner, poll: PollRef, events: PollEvents) {
            owner.events.borrow_mut().push(events);
            owner.poll.set(Some(poll));
        }
    }

    fn new_owner(dropped: &Rc<Cell<bool>>, reenter_in_drop: bool) -> OwnerRef<TestOwner> {
        OwnerRef::new(TestOwner {
            ref_count: bun_ptr::RefCount::init(),
            events: RefCell::new(Vec::new()),
            poll: Cell::new(None),
            dropped: Rc::clone(dropped),
            reenter_in_drop,
        })
    }

    fn fd_source(fd: i32, readable: bool, writable: bool) -> PollSource {
        PollSource::Fd {
            fd,
            readable,
            writable,
        }
    }

    /// Drain + deliver pending epoll events exactly the way
    /// `backend::dispatch_untagged` routes KIND_REGISTERED udata (the full
    /// socket dispatch graph cannot link in a crate-local test binary),
    /// asserting every kernel round-trip produced a registered slot pointer.
    fn dispatch_pending(loop_: *mut Loop) -> i32 {
        let n = poll_access::epoll_wait_ready(loop_, 0);
        for i in 0..n.max(0) {
            let entry = poll_access::ready_poll_at(loop_, i);
            let p = entry.u64 as usize as *mut PollState;
            let st = poll_access::read_poll(p);
            assert_eq!(st.kind_bits(), KIND_REGISTERED, "udata is our slab slot");
            let masked = Events(entry.events) & st.events();
            dispatch_ready(
                p,
                PollEvents {
                    readable: masked.contains(Events::READABLE),
                    writable: masked.contains(Events::WRITABLE),
                    error: entry.events & libc::EPOLLERR as u32 != 0,
                    eof: entry.events & libc::EPOLLHUP as u32 != 0,
                    fflags: 0,
                    data: 0,
                },
            );
        }
        n
    }

    #[test]
    fn fd_register_dispatch_change_unregister_round_trip() {
        let loop_ = create_test_loop();
        let efd = poll_access::eventfd::create();
        assert!(efd >= 0);
        let dropped = Rc::new(Cell::new(false));
        let owner = new_owner(&dropped, false);
        let probe = owner.dupe_ref();
        let r =
            register::<FdProto>(loop_, fd_source(efd, true, false), owner, true).expect("register");
        assert!(r.is_alive());
        assert_eq!(
            poll_access::num_polls(loop_),
            1,
            "keep_alive counts the poll"
        );

        poll_access::eventfd::send(efd);
        assert_eq!(dispatch_pending(loop_), 1);
        {
            let ev = probe.data().events.borrow();
            assert_eq!(ev.len(), 1);
            assert!(ev[0].readable && !ev[0].writable && !ev[0].error && !ev[0].eof);
        }
        assert_eq!(
            probe.data().poll.get(),
            Some(r),
            "handler got a live handle"
        );

        // Interest change to writable-only: the eventfd counter is nonzero
        // (readable at the fd level), but only WRITABLE may be delivered.
        r.change(false, true).expect("interest change");
        assert!(dispatch_pending(loop_) >= 1);
        {
            let ev = probe.data().events.borrow();
            assert!(ev.len() >= 2);
            assert!(ev[1..].iter().all(|e| e.writable && !e.readable));
        }

        r.unregister();
        assert!(!r.is_alive());
        assert_eq!(poll_access::num_polls(loop_), 0, "keep-alive dropped");
        assert!(!dropped.get(), "probe ref still holds the owner");
        r.unregister(); // stale handle: silent no-op
        assert_eq!(r.change(true, true), Ok(())); // stale handle: silent no-op
        poll_access::eventfd::send(efd);
        assert_eq!(dispatch_pending(loop_), 0, "disarmed source must be silent");

        probe.deref();
        assert!(dropped.get(), "slot ref was released at unregister");
        free_test_loop(loop_);
        io::close(efd, false);
    }

    #[test]
    fn loop_teardown_releases_outstanding_owner_outside_slab() {
        let loop_ = create_test_loop();
        let efd = poll_access::eventfd::create();
        let dropped = Rc::new(Cell::new(false));
        let owner = new_owner(&dropped, true);
        let probe = owner.dupe_ref();
        let r =
            register::<FdProto>(loop_, fd_source(efd, true, false), owner, true).expect("register");
        probe.data().poll.set(Some(r));
        probe.deref(); // the slot now holds the ONLY ref
        assert!(!dropped.get());
        // Freeing the loop with the registration outstanding runs the owner
        // destructor during teardown; its Drop re-enters PollRef methods.
        free_test_loop(loop_);
        assert!(dropped.get(), "teardown released the transferred ref");
        io::close(efd, false);
    }

    #[test]
    fn register_failure_paths_release_the_owner() {
        let loop_ = create_test_loop();

        // Empty interest set: EINVAL before any slot or kernel state exists.
        let dropped = Rc::new(Cell::new(false));
        let owner = new_owner(&dropped, false);
        assert_eq!(
            register::<FdProto>(loop_, fd_source(0, false, false), owner, true).unwrap_err(),
            libc::EINVAL
        );
        assert!(dropped.get());

        // Kernel arm failure: errno surfaced, slot unwound, owner released,
        // keep-alive untouched.
        let dropped = Rc::new(Cell::new(false));
        let owner = new_owner(&dropped, false);
        assert_eq!(
            register::<FdProto>(loop_, fd_source(-1, true, false), owner, true).unwrap_err(),
            libc::EBADF
        );
        assert!(dropped.get());
        assert_eq!(poll_access::num_polls(loop_), 0);

        // Duplicate source: loud EEXIST on epoll (see `register` docs); the
        // first registration stays live.
        let efd = poll_access::eventfd::create();
        let d1 = Rc::new(Cell::new(false));
        let o1 = new_owner(&d1, false);
        let probe1 = o1.dupe_ref();
        let r1 = register::<FdProto>(loop_, fd_source(efd, true, false), o1, false)
            .expect("first register");
        let d2 = Rc::new(Cell::new(false));
        assert_eq!(
            register::<FdProto>(
                loop_,
                fd_source(efd, true, false),
                new_owner(&d2, false),
                false
            )
            .unwrap_err(),
            libc::EEXIST
        );
        assert!(d2.get(), "losing owner released");
        assert!(!d1.get() && r1.is_alive(), "winner untouched");
        // The loser's unwind must NOT have disarmed the winner's kernel
        // registration (epoll's failed ADD is atomic — no purge DEL).
        poll_access::eventfd::send(efd);
        assert_eq!(dispatch_pending(loop_), 1);
        assert_eq!(probe1.data().events.borrow().len(), 1);
        probe1.deref();
        r1.unregister();
        assert!(d1.get());
        free_test_loop(loop_);
        io::close(efd, false);
    }

    #[test]
    fn change_surfaces_kernel_errno() {
        let loop_ = create_test_loop();
        let efd = poll_access::eventfd::create();
        let dropped = Rc::new(Cell::new(false));
        let r = register::<FdProto>(
            loop_,
            fd_source(efd, true, false),
            new_owner(&dropped, false),
            false,
        )
        .expect("register");
        // Closing the fd auto-removes it from epoll; the next interest
        // update must surface the kernel failure, not report success.
        io::close(efd, false);
        assert_eq!(r.change(true, true), Err(libc::EBADF));
        // A failed change must not cache the requested bits: the identical
        // retry re-issues the kernel op instead of short-circuiting to Ok.
        assert_eq!(r.change(true, true), Err(libc::EBADF));
        r.unregister();
        assert!(dropped.get());
        free_test_loop(loop_);
    }

    #[test]
    fn pri_source_registers_and_ignores_interest_changes() {
        let loop_ = create_test_loop();
        let efd = poll_access::eventfd::create();
        let dropped = Rc::new(Cell::new(false));
        let owner = new_owner(&dropped, false);
        let r = register::<FdProto>(loop_, PollSource::Pri { fd: efd }, owner, true)
            .expect("register Pri");
        assert!(r.is_alive());
        assert_eq!(poll_access::num_polls(loop_), 1);

        // Pri watches EPOLLPRI only: ordinary readability must not dispatch,
        // and `change` must be a no-op for a non-Fd source (a real change
        // would arm EPOLLIN and make the eventfd dispatch here).
        assert_eq!(r.change(true, true), Ok(())); // non-Fd source: silent no-op
        poll_access::eventfd::send(efd);
        assert_eq!(dispatch_pending(loop_), 0, "no EPOLLIN interest armed");

        r.unregister();
        assert!(!r.is_alive());
        assert_eq!(poll_access::num_polls(loop_), 0);
        assert!(dropped.get(), "owner released at unregister");
        free_test_loop(loop_);
        io::close(efd, false);
    }

    #[test]
    fn keep_alive_toggles_num_polls() {
        let loop_ = create_test_loop();
        let efd = poll_access::eventfd::create();
        let dropped = Rc::new(Cell::new(false));
        let r = register::<FdProto>(
            loop_,
            fd_source(efd, true, false),
            new_owner(&dropped, false),
            false,
        )
        .expect("register");
        assert_eq!(poll_access::num_polls(loop_), 0, "fallthrough registration");
        r.set_keep_alive(true);
        assert_eq!(poll_access::num_polls(loop_), 1);
        r.set_keep_alive(true); // idempotent per state
        assert_eq!(poll_access::num_polls(loop_), 1);
        r.set_keep_alive(false);
        assert_eq!(poll_access::num_polls(loop_), 0);
        r.unregister();
        assert!(dropped.get());
        free_test_loop(loop_);
        io::close(efd, false);
    }
}
