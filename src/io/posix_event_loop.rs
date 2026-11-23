#[cfg(not(windows))]
use core::cell::Cell;
#[cfg(not(windows))]
use core::ffi::c_void;
#[cfg(not(windows))]
use core::fmt;
#[cfg(unix)]
use core::ptr;

#[cfg(not(windows))]
use bun_sys::{self as sys, Fd};
#[cfg(not(windows))]
use bun_uws_sys::Loop as UwsLoop;

#[cfg(not(windows))]
pub type Loop = UwsLoop;

#[cfg(not(windows))]
use bun_sys::syslog;

/// Local `errno_sys` helper. `bun_sys`
/// does not yet expose this helper on `Result<T>`; once it does, drop this and
/// call `sys::Result::<()>::errno_sys` directly.
///
/// Decodes the -1-sentinel *return-code* convention (the thread-local errno is
/// only read when `rc` is the all-ones failure value). Do NOT feed it a value
/// that already is an errno — use [`kevent_change_error`] for those.
#[cfg(any(target_os = "linux", target_os = "android"))]
#[inline]
fn errno_sys<R>(rc: R, syscall: sys::Tag) -> Option<sys::Result<()>>
where
    R: sys::GetErrno,
{
    match sys::get_errno(rc) {
        sys::E::SUCCESS => None,
        e => Some(sys::Result::Err(sys::Error::from_code(e, syscall))),
    }
}

/// Error for a kevent changelist entry that came back with `EV_ERROR` set:
/// the kernel stores the errno *value* in `data`. That is not the -1-sentinel
/// return-code convention `errno_sys` decodes — feeding `data` through it
/// yields `None` for every real errno.
#[cfg(any(target_os = "macos", all(test, not(windows))))]
#[inline]
fn kevent_change_error(data: i64) -> sys::Result<()> {
    sys::Result::Err(sys::Error::from_code(
        sys::SystemErrno::init(data).unwrap_or(sys::E::EINVAL),
        sys::Tag::kevent,
    ))
}

/// Is this errno from a failed deregistration just "the registration is
/// already gone"? Two routine producers:
/// - the fd was closed while the poll was still registered (close() removes
///   an fd's kevents; epoll drops closed fds automatically) → EBADF/ENOENT
/// - on macOS, closing a pty master marks the slave's knotes
///   `EV_EOF|EV_ONESHOT`, so the kernel deletes them when the hangup event is
///   delivered; the reader's teardown `EV_DELETE` then finds nothing → ENOENT.
///   This happens on every terminal window/tab close while a tty is polled.
///
/// Both mean the kernel-side state already matches what unregistration wants,
/// so they count as success — in particular the registration flags must still
/// be cleared, which an error return would skip, leaving the poll claiming to
/// be registered and re-issuing doomed deletes on later teardown calls. libuv
/// ignores the same errnos for its kqueue/epoll delete operations.
#[cfg(not(windows))]
#[inline]
fn deregistration_already_gone(errno: sys::E) -> bool {
    matches!(errno, sys::E::ENOENT | sys::E::EBADF)
}

#[cfg(not(windows))]
use crate::OpaqueCallback;
use crate::max_buf::Kind;
pub use crate::{EventLoopCtx, EventLoopCtxKind};

unsafe extern "Rust" {
    /// Defined `#[no_mangle]` in `bun_runtime::jsc_hooks`.
    // safe: the `#[no_mangle] pub fn` body in
    // `bun_runtime::jsc_hooks` is itself a safe fn (reads process globals) —
    // no memory-safety preconditions.
    safe fn __bun_get_vm_ctx() -> EventLoopCtx;
}

/// Kind of fd a `FilePoll` (or pipe reader/writer) is wrapping. Lives here so
/// `bun_io` (which now depends on this crate) and `FilePoll::file_type` share
/// one definition; `bun_io::pipes` re-exports it for downstream callers.
// Note: sunk one tier to break the
// io↔aio cycle (FilePoll::file_type was the only aio→io edge).
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum FileType {
    File,
    Pipe,
    NonblockingPipe,
    Socket,
}

#[cfg(not(windows))]
impl FileType {
    pub(crate) fn is_blocking(self) -> bool {
        self == FileType::Pipe
    }
}

/// JS-thread [`EventLoopCtx`] for `KeepAlive::{ref_,unref}` / `FilePoll`.
#[inline]
pub fn js_vm_ctx() -> EventLoopCtx {
    __bun_get_vm_ctx()
}

// ──────────────────────────────────────────────────────────────────────────
// FilePoll
// ──────────────────────────────────────────────────────────────────────────

// `KQueueGenerationNumber` is `usize` on macOS-debug, else a zero-size sentinel.
#[cfg(all(target_os = "macos", debug_assertions))]
type KQueueGenerationNumber = usize;
#[cfg(all(unix, not(all(target_os = "macos", debug_assertions))))]
type KQueueGenerationNumber = u8; // Note: conceptually zero-width; smallest Rust int is u8. Gated by cfg below.

// Debug-only diagnostic; `Relaxed` (no synchronization implied).
#[cfg(all(target_os = "macos", debug_assertions))]
static MAX_GENERATION_NUMBER: core::sync::atomic::AtomicUsize =
    core::sync::atomic::AtomicUsize::new(0);

/// Darwin uses the extended `kevent64_s` (extra `ext` field carries our
/// generation number); FreeBSD only has the plain `struct kevent`.
#[cfg(target_os = "macos")]
type KQueueEvent = bun_sys::darwin::kevent64_s;
#[cfg(target_os = "freebsd")]
type KQueueEvent = bun_sys::freebsd::Kevent;

/// Build a `struct kevent` without naming every field. FreeBSD ≥12 added
/// `ext: [u64; 4]` to the struct, so a literal initializer fails to compile
/// against older/newer libc ABI variants. Start from zeroed and assign.
#[cfg(target_os = "freebsd")]
#[inline]
fn make_kevent(
    ident: usize,
    filter: i16,
    flags: u16,
    fflags: u32,
    udata: *mut core::ffi::c_void,
) -> KQueueEvent {
    // SAFETY: all-zero is a valid `struct kevent` (POD).
    let mut ev: KQueueEvent = bun_core::ffi::zeroed();
    ev.ident = ident;
    ev.filter = filter;
    ev.flags = flags;
    ev.fflags = fflags;
    ev.data = 0;
    ev.udata = udata;
    ev
}

/// The kernel value is the
/// same as Darwin/OpenBSD (sys/event.h: `#define EV_EOF 0x8000`).
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
const EV_EOF: u16 = 0x8000;

// ──────────────────────────────────────────────────────────────────────────
// FilePoll Owner — hot-path tag+ptr (CYCLEBREAK §Hot dispatch list).
// Low tier (here) stores a tag and a `*mut ()`; `bun_runtime::dispatch::__bun_run_io`
// owns the per-tag `match` so the variant types are never named in this crate.
// ──────────────────────────────────────────────────────────────────────────

/// Closed set of [`Owner`] kinds, which `bun_runtime::dispatch::__bun_run_io` matches on.
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PollTag {
    Null = 0,
    FileSink,
    SubprocessStdinWriter,
    ShellStdinWriter,
    SecurityScanWriter,
    #[cfg(not(windows))]
    DnsResolver,
    #[cfg(target_os = "macos")]
    GetAddrInfoRequest,
    #[cfg(not(windows))]
    Process,
    ShellIoWriter,
    TerminalWriter,
    #[cfg(windows)]
    WindowsNamedPipe,
    #[cfg(target_os = "macos")]
    ParentDeathWatchdog,
    #[cfg(not(windows))]
    MemoryPressure,
    SubprocessPipeReader,
    ShellPipeReader,
    ShellIoReader,
    FileReader,
    FileResponseStream,
    TerminalReader,
    Cron,
    FilterRunHandle,
    MultiRunPipeReader,
    TestParallelWorker,
    LifecycleScript,
    InstallGit,
    SecurityScanReader,
}

/// The receiver of an [`IoEvent`]. Safe to build: `set_owner` and `OwnedFilePoll::new` carry the contract.
#[derive(Copy, Clone)]
pub struct Owner {
    tag: PollTag,
    /// Tells the two readers of one owner apart.
    kind: Kind,
    ptr: *mut (),
}

impl Owner {
    pub(crate) const NULL: Owner = Owner::new(PollTag::Null, core::ptr::null_mut());
    #[inline]
    pub const fn new(tag: PollTag, ptr: *mut ()) -> Owner {
        Owner::with_kind(tag, Kind::Stdout, ptr)
    }
    #[inline]
    pub const fn with_kind(tag: PollTag, kind: Kind, ptr: *mut ()) -> Owner {
        Owner { tag, kind, ptr }
    }
    #[inline]
    pub fn tag(&self) -> PollTag {
        self.tag
    }
    #[inline]
    pub fn kind(&self) -> Kind {
        self.kind
    }
    #[inline]
    pub fn ptr(&self) -> *mut () {
        self.ptr
    }
}

#[cfg(windows)]
pub enum IoEvent {
    Read(crate::pipe_reader::ReadEvent),
    Write(crate::pipe_writer::WriteEvent),
}

/// What a poll that fired tells its owner.
#[cfg(not(windows))]
#[derive(Copy, Clone)]
pub struct IoEvent {
    pub fd: Fd,
    pub flags: FlagsSet,
    pub size_or_offset: i64,
}

#[cfg(not(windows))]
impl IoEvent {
    pub fn is_hup(&self) -> bool {
        self.flags.contains(Flags::Hup)
    }
}

unsafe extern "Rust" {
    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to.
    pub(crate) fn __bun_run_io(owner: Owner, event: IoEvent);
}

/// Shared borrows only: the kernel holds its address.
#[cfg(not(windows))]
pub struct FilePoll {
    fd: Fd,
    flags: Cell<FlagsSet>,
    owner: Cell<Owner>,

    /// We re-use FilePoll objects to avoid allocating new ones.
    ///
    /// That means we might run into situations where the event is stale.
    /// on macOS kevent64 has an extra pointer field so we use it for that
    /// linux doesn't have a field like that
    generation_number: KQueueGenerationNumber,
    next_to_free: Cell<*mut FilePoll>,

    /// Where it is registered and counted, and whose `Store` the slot is from.
    event_loop: EventLoopCtx,
}

#[cfg(not(windows))]
impl FilePoll {
    pub fn has_flag(&self, flag: Flags) -> bool {
        self.flags.get().contains(flag)
    }

    pub(crate) fn set_flag(&self, flag: Flags) {
        self.flags.update(|flags| flags | flag);
    }

    fn remove_flags(&self, removed: impl Into<FlagsSet>) {
        self.flags.update(|flags| flags - removed);
    }

    /// # Safety
    /// See [`crate::OwnedFilePoll::new`].
    pub(crate) unsafe fn set_owner(&self, owner: Owner) {
        self.owner.set(owner);
    }

    fn update_flags(&self, updated: FlagsSet) {
        self.remove_flags(
            Flags::Readable
                | Flags::Writable
                | Flags::Process
                | Flags::Machport
                | Flags::MemoryPressure
                | Flags::Eof
                | Flags::Hup,
        );
        self.flags.update(|flags| flags | updated);
    }

    pub(crate) fn file_type(&self) -> FileType {
        let flags = self.flags.get();
        if flags.contains(Flags::Socket) {
            return FileType::Socket;
        }
        if flags.contains(Flags::Tty) {
            return FileType::File;
        }
        if flags.contains(Flags::Nonblocking) {
            return FileType::NonblockingPipe;
        }
        FileType::Pipe
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    fn on_kqueue_event(&self, kqueue_event: &KQueueEvent) -> IoEvent {
        self.update_flags(Flags::from_kqueue_event(kqueue_event));
        syslog!("onKQueueEvent: {}", self);

        #[cfg(all(target_os = "macos", debug_assertions))]
        debug_assert!(self.generation_number == kqueue_event.ext[0] as usize);

        // EVFILT_MEMORYSTATUS reports the pressure level in `fflags`, not `data`;
        // thread it through `size_or_offset` so the dispatch arm can read it.
        #[cfg(target_os = "macos")]
        if kqueue_event.filter == bun_sys::darwin::EVFILT::MEMORYSTATUS {
            return self.on_update(kqueue_event.fflags as i64);
        }

        self.on_update(kqueue_event.data as i64)
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    fn on_epoll_event(&self, epoll_event: &bun_sys::linux::epoll_event) -> IoEvent {
        self.update_flags(Flags::from_epoll_event(epoll_event));
        self.on_update(0)
    }

    /// Returns whether it was ever registered.
    fn reset(&self, force_unregister: bool) -> bool {
        let _ = self.unregister(force_unregister);

        self.owner.set(Owner::NULL);
        self.flags.take().contains(Flags::WasEverRegistered)
    }

    pub(crate) fn is_registered(&self) -> bool {
        self.has_flag(Flags::PollWritable)
            || self.has_flag(Flags::PollReadable)
            || self.has_flag(Flags::PollProcess)
            || self.has_flag(Flags::PollMachport)
            || self.has_flag(Flags::PollMemoryPressure)
    }

    fn on_update(&self, size_or_offset: i64) -> IoEvent {
        if self.has_flag(Flags::OneShot) {
            self.set_flag(Flags::NeedsRearm);
        }

        IoEvent {
            fd: self.fd,
            flags: self.flags.get(),
            size_or_offset,
        }
    }

    #[inline]
    pub(crate) fn is_watching(&self) -> bool {
        !self.has_flag(Flags::NeedsRearm)
            && (self.has_flag(Flags::PollReadable)
                || self.has_flag(Flags::PollWritable)
                || self.has_flag(Flags::PollProcess))
    }

    /// This decrements the active counter if it was previously incremented
    /// "active" controls whether or not the event loop should potentially idle
    pub fn disable_keeping_process_alive(&self) {
        self.event_loop
            .loop_sub_active(self.has_flag(Flags::HasIncrementedActiveCount) as u32);

        self.remove_flags(Flags::KeepsEventLoopAlive | Flags::HasIncrementedActiveCount);
    }

    pub fn enable_keeping_process_alive(&self) {
        self.event_loop
            .loop_add_active((!self.has_flag(Flags::HasIncrementedActiveCount)) as u32);

        self.set_flag(Flags::KeepsEventLoopAlive);
        self.set_flag(Flags::HasIncrementedActiveCount);
    }

    pub(crate) fn set_keeping_process_alive(&self, value: bool) {
        if value {
            self.enable_keeping_process_alive()
        } else {
            self.disable_keeping_process_alive()
        }
    }

    /// Only intended to be used from EventLoop.Pollable
    fn deactivate(&self, loop_: &Loop) {
        if self.has_flag(Flags::HasIncrementedPollCount) {
            loop_.dec();
        }
        self.remove_flags(Flags::HasIncrementedPollCount);

        loop_.sub_active(self.has_flag(Flags::HasIncrementedActiveCount) as u32);
        self.remove_flags(Flags::KeepsEventLoopAlive | Flags::HasIncrementedActiveCount);
    }

    /// Only intended to be used from EventLoop.Pollable
    fn activate(&self, loop_: &Loop) {
        if !self.has_flag(Flags::HasIncrementedPollCount) {
            loop_.inc();
        }
        self.set_flag(Flags::HasIncrementedPollCount);

        if self.has_flag(Flags::KeepsEventLoopAlive) {
            loop_.add_active((!self.has_flag(Flags::HasIncrementedActiveCount)) as u32);
            self.set_flag(Flags::HasIncrementedActiveCount);
        }
    }

    pub fn register(&self, flag: Flags, one_shot: bool) -> sys::Result<()> {
        self.register_with(
            flag,
            if one_shot {
                OneShotFlag::OneShot
            } else {
                OneShotFlag::None
            },
        )
    }

    pub(crate) fn register_with(&self, flag: Flags, one_shot: OneShotFlag) -> sys::Result<()> {
        #[cfg(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        ))]
        return self.register_impl(flag, one_shot);
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        )))]
        {
            let _ = (flag, one_shot);
            sys::Result::Ok(())
        }
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd"
    ))]
    fn register_impl(&self, flag: Flags, one_shot: OneShotFlag) -> sys::Result<()> {
        let (loop_, fd) = (self.event_loop.loop_(), self.fd);
        let watcher_fd = loop_.fd();

        syslog!(
            "register: FilePoll(0x{:x}, generation_number={}) {} ({})",
            std::ptr::from_ref(self) as usize,
            self.generation_number,
            <&'static str>::from(flag),
            fd
        );

        debug_assert!(fd != INVALID_FD);

        if one_shot != OneShotFlag::None {
            self.set_flag(Flags::OneShot);
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            use bun_sys::linux::{self, EPOLL};
            let one_shot_flag: u32 = if !self.has_flag(Flags::OneShot) {
                0
            } else {
                EPOLL::ONESHOT
            };

            let mut flags: u32 = match flag {
                Flags::Process | Flags::Readable => EPOLL::IN | EPOLL::HUP | one_shot_flag,
                Flags::Writable => EPOLL::OUT | EPOLL::HUP | EPOLL::ERR | one_shot_flag,
                // PSI trigger fds signal via POLLPRI only.
                Flags::MemoryPressure => EPOLL::PRI | EPOLL::ERR | one_shot_flag,
                _ => unreachable!(),
            };
            // epoll keys on fd alone; if the other direction is already
            // registered on this poll, preserve it in the CTL_MOD mask.
            // (EPOLLONESHOT disarms the whole fd after the first event in
            // either direction, so bidirectional one-shot is not supported.)
            if flag == Flags::Readable && self.has_flag(Flags::PollWritable) {
                debug_assert!(!self.has_flag(Flags::OneShot));
                flags |= EPOLL::OUT | EPOLL::ERR;
            }
            if flag == Flags::Writable && self.has_flag(Flags::PollReadable) {
                debug_assert!(!self.has_flag(Flags::OneShot));
                flags |= EPOLL::IN;
            }

            // Note: libc::epoll_event flattens the data union to a single `u64` field.
            let event = linux::epoll_event {
                events: flags,
                u64: Pollable::init(self).ptr() as u64,
            };

            let op = if self.is_registered() || self.has_flag(Flags::NeedsRearm) {
                EPOLL::CTL_MOD
            } else {
                EPOLL::CTL_ADD
            };

            // SAFETY: `watcher_fd` is the epoll instance of `loop_`, whose dispatch decodes a
            // `Pollable`. `reset` removes the entry, or leaves one that `EPOLLONESHOT` disarmed
            // when it fired, which is not reported again. `Store::put` then holds the slot back,
            // marked `IgnoreUpdates`, until a tick returns, when no event fetched for it is left.
            let ctl = unsafe { linux::epoll_ctl(watcher_fd, op, fd.native(), &event) };
            self.set_flag(Flags::WasEverRegistered);
            if let Some(errno) = errno_sys(ctl, sys::Tag::epoll_ctl) {
                self.deactivate(loop_);
                return errno;
            }
        }
        #[cfg(target_os = "macos")]
        {
            use bun_sys::darwin::{EV, EVFILT, NOTE, kevent64_s};
            let one_shot_flag: u16 = if !self.has_flag(Flags::OneShot) {
                0
            } else if one_shot == OneShotFlag::Dispatch {
                EV::DISPATCH | EV::ENABLE
            } else {
                EV::ONESHOT
            };

            let change = match flag {
                Flags::Readable => kevent64_s {
                    ident: u64::try_from(fd.native()).expect("int cast"),
                    filter: EVFILT::READ,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::ADD | one_shot_flag,
                    ext: [self.generation_number as u64, 0],
                },
                Flags::Writable => kevent64_s {
                    ident: u64::try_from(fd.native()).expect("int cast"),
                    filter: EVFILT::WRITE,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::ADD | one_shot_flag,
                    ext: [self.generation_number as u64, 0],
                },
                Flags::Process => kevent64_s {
                    ident: u64::try_from(fd.native()).expect("int cast"),
                    filter: EVFILT::PROC,
                    data: 0,
                    fflags: NOTE::EXIT,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::ADD | one_shot_flag,
                    ext: [self.generation_number as u64, 0],
                },
                Flags::Machport => kevent64_s {
                    ident: u64::try_from(fd.native()).expect("int cast"),
                    filter: EVFILT::MACHPORT,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::ADD | one_shot_flag,
                    ext: [self.generation_number as u64, 0],
                },
                // System-wide memory pressure. ident is always 0; EV_CLEAR so each
                // transition delivers once (matches libdispatch's registration).
                Flags::MemoryPressure => kevent64_s {
                    ident: 0,
                    filter: EVFILT::MEMORYSTATUS,
                    data: 0,
                    fflags: NOTE::MEMORYSTATUS_PRESSURE_WARN | NOTE::MEMORYSTATUS_PRESSURE_CRITICAL,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::ADD | EV::CLEAR | one_shot_flag,
                    ext: [self.generation_number as u64, 0],
                },
                _ => unreachable!(),
            };

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS: u32 = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            let rc = 'rc: loop {
                // SAFETY: as for `epoll_ctl` above. No change asks for a message, so `ext` is no address.
                let rc = unsafe {
                    bun_sys::darwin::kevent64(
                        watcher_fd,
                        &[change],
                        // No room for events, so that an error on registration becomes errno.
                        &mut [],
                        KEVENT_FLAG_ERROR_EVENTS,
                        Some(&TIMEOUT),
                    )
                };
                if sys::get_errno(rc) == sys::E::EINTR {
                    continue;
                }
                break 'rc rc;
            };

            self.set_flag(Flags::WasEverRegistered);

            let errno = sys::get_errno(rc);
            if errno != sys::E::SUCCESS {
                self.deactivate(loop_);
                return sys::Result::Err(sys::Error::from_code(errno, sys::Tag::kqueue));
            }
        }
        #[cfg(target_os = "freebsd")]
        {
            use bun_sys::freebsd::{EV, EVFILT, NOTE};
            let one_shot_flag: u16 = if !self.has_flag(Flags::OneShot) {
                0
            } else if one_shot == OneShotFlag::Dispatch {
                EV::DISPATCH | EV::ENABLE
            } else {
                EV::ONESHOT
            };

            let ident = usize::try_from(fd.native()).expect("int cast");
            let udata = Pollable::init(self).ptr();
            let change = match flag {
                Flags::Readable => {
                    make_kevent(ident, EVFILT::READ, EV::ADD | one_shot_flag, 0, udata)
                }
                Flags::Writable => {
                    make_kevent(ident, EVFILT::WRITE, EV::ADD | one_shot_flag, 0, udata)
                }
                Flags::Process => make_kevent(
                    ident,
                    EVFILT::PROC,
                    EV::ADD | one_shot_flag,
                    NOTE::EXIT,
                    udata,
                ),
                Flags::Machport | Flags::MemoryPressure => {
                    return sys::Result::Err(sys::Error::from_code(
                        sys::E::EOPNOTSUPP,
                        sys::Tag::kevent,
                    ));
                }
                _ => unreachable!(),
            };

            // No room for events, so that an error on registration becomes errno.
            // SAFETY: as for `epoll_ctl` above.
            let registered =
                unsafe { sys::kevent(Fd::from_native(watcher_fd), &[change], &mut [], None) };

            self.set_flag(Flags::WasEverRegistered);
            if let Err(err) = registered {
                self.deactivate(loop_);
                return sys::Result::Err(sys::Error::from_code(err.get_errno(), sys::Tag::kevent));
            }
        }

        self.activate(loop_);
        self.set_flag(match flag {
            Flags::Readable => Flags::PollReadable,
            Flags::Process => {
                #[cfg(any(target_os = "linux", target_os = "android"))]
                {
                    Flags::PollReadable
                }
                #[cfg(not(any(target_os = "linux", target_os = "android")))]
                {
                    Flags::PollProcess
                }
            }
            Flags::Writable => Flags::PollWritable,
            Flags::Machport => Flags::PollMachport,
            Flags::MemoryPressure => Flags::PollMemoryPressure,
            _ => unreachable!(),
        });
        self.remove_flags(Flags::NeedsRearm);

        sys::Result::Ok(())
    }

    pub fn unregister(&self, force_unregister: bool) -> sys::Result<()> {
        let loop_ = self.event_loop.loop_();
        // Note: compute the syscall result first, then unconditionally
        // deactivate. Avoids a raw-pointer scopeguard.
        #[cfg(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        ))]
        let result = self.unregister_impl(loop_, force_unregister);
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        )))]
        let result: sys::Result<()> = {
            let _ = force_unregister;
            sys::Result::Ok(())
        };
        self.deactivate(loop_);
        result
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd"
    ))]
    fn unregister_impl(&self, loop_: &Loop, force_unregister: bool) -> sys::Result<()> {
        let fd = self.fd;
        debug_assert!(fd.native() >= 0 && fd != INVALID_FD);

        let registered = self.is_registered();
        // The `needs_rearm` skip below keeps the disarmed kernel registration, so teardown must still delete it.
        let disarmed_only = !registered && self.has_flag(Flags::NeedsRearm);
        if !registered && !(disarmed_only && force_unregister) {
            return sys::Result::Ok(());
        }

        let watcher_fd = loop_.fd();
        let both_directions = disarmed_only
            || (self.has_flag(Flags::PollReadable) && self.has_flag(Flags::PollWritable));
        let flag: Flags = 'brk: {
            if disarmed_only || self.has_flag(Flags::PollReadable) {
                break 'brk Flags::Readable;
            }
            if self.has_flag(Flags::PollWritable) {
                break 'brk Flags::Writable;
            }
            if self.has_flag(Flags::PollProcess) {
                break 'brk Flags::Process;
            }
            if self.has_flag(Flags::PollMachport) {
                break 'brk Flags::Machport;
            }
            if self.has_flag(Flags::PollMemoryPressure) {
                break 'brk Flags::MemoryPressure;
            }
            return sys::Result::Ok(());
        };

        if self.has_flag(Flags::NeedsRearm) && !force_unregister {
            syslog!(
                "unregister: {} ({}) skipped due to needs_rearm",
                <&'static str>::from(flag),
                fd
            );
            self.remove_flags(
                Flags::PollProcess
                    | Flags::PollReadable
                    | Flags::PollWritable
                    | Flags::PollMachport
                    | Flags::PollMemoryPressure,
            );
            return sys::Result::Ok(());
        }

        syslog!(
            "unregister: FilePoll(0x{:x}, generation_number={}) {}{} ({})",
            std::ptr::from_ref(self) as usize,
            self.generation_number,
            <&'static str>::from(flag),
            if both_directions { "+writable" } else { "" },
            fd
        );

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // CTL_DEL keys on fd alone, so both directions are removed together.
            let ctl = bun_sys::linux::epoll_ctl_del(watcher_fd, fd.native());

            match sys::get_errno(ctl) {
                sys::E::SUCCESS => {}
                e if deregistration_already_gone(e) => {}
                e => return sys::Result::Err(sys::Error::from_code(e, sys::Tag::epoll_ctl)),
            }
        }
        #[cfg(target_os = "macos")]
        {
            use bun_sys::darwin::{EV, EVFILT, NOTE, kevent64, kevent64_s};
            // SAFETY: all-zero is a valid kevent64_s
            let mut changelist: [kevent64_s; 2] = bun_core::ffi::zeroed();

            changelist[0] = match flag {
                Flags::Readable => kevent64_s {
                    ident: u64::try_from(fd.native()).expect("int cast"),
                    filter: EVFILT::READ,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                },
                Flags::Machport => kevent64_s {
                    ident: u64::try_from(fd.native()).expect("int cast"),
                    filter: EVFILT::MACHPORT,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                },
                Flags::Writable => kevent64_s {
                    ident: u64::try_from(fd.native()).expect("int cast"),
                    filter: EVFILT::WRITE,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                },
                Flags::Process => kevent64_s {
                    ident: u64::try_from(fd.native()).expect("int cast"),
                    filter: EVFILT::PROC,
                    data: 0,
                    fflags: NOTE::EXIT,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                },
                Flags::MemoryPressure => kevent64_s {
                    ident: 0,
                    filter: EVFILT::MEMORYSTATUS,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                },
                _ => unreachable!(),
            };

            let mut nchanges = 1;
            if both_directions {
                // kqueue keys on (fd, filter); delete EVFILT_WRITE as a second change.
                changelist[1] = kevent64_s {
                    ident: u64::try_from(fd.native()).expect("int cast"),
                    filter: EVFILT::WRITE,
                    data: 0,
                    fflags: 0,
                    udata: Pollable::init(self).ptr() as u64,
                    flags: EV::DELETE,
                    ext: [0, 0],
                };
                nchanges = 2;
            }

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS: u32 = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            let mut errors: [kevent64_s; 2] = bun_core::ffi::zeroed();
            // SAFETY: EV_DELETE registers nothing.
            let rc = unsafe {
                kevent64(
                    watcher_fd,
                    &changelist[..nchanges],
                    &mut errors[..nchanges],
                    KEVENT_FLAG_ERROR_EVENTS,
                    Some(&TIMEOUT),
                )
            };

            let errno = sys::get_errno(rc);
            // Global failure (e.g. EBADF on the kqueue fd): the eventlist was not written.
            if rc < 0 {
                return sys::Result::Err(sys::Error::from_code(errno, sys::Tag::kevent));
            }

            // If an error occurs while processing an element of the changelist
            // and there is enough room in the eventlist, then the event will be
            // placed in the eventlist with EV_ERROR set in flags and the system
            // error in data. With KEVENT_FLAG_ERROR_EVENTS, rc is the count of
            // such error events; they are packed from index 0 regardless of
            // which change failed. xnu ORs EV_ERROR into the existing action
            // bits (EV_DELETE|EV_ERROR = 0x4002), so test the bit, not equality.
            for error in &errors[..usize::try_from(rc.min(2)).expect("int cast")] {
                if (error.flags & EV::ERROR) == 0 || error.data == 0 {
                    continue;
                }
                if sys::SystemErrno::init(error.data).is_some_and(deregistration_already_gone) {
                    continue;
                }
                return kevent_change_error(error.data);
            }
        }
        #[cfg(target_os = "freebsd")]
        {
            use bun_sys::freebsd::{EV, EVFILT, Kevent, NOTE};
            // SAFETY: all-zero is a valid Kevent
            let mut changelist: [Kevent; 2] = bun_core::ffi::zeroed();
            let ident = usize::try_from(fd.native()).expect("int cast");
            let udata = Pollable::init(self).ptr();
            changelist[0] = match flag {
                Flags::Readable => make_kevent(ident, EVFILT::READ, EV::DELETE, 0, udata),
                Flags::Writable => make_kevent(ident, EVFILT::WRITE, EV::DELETE, 0, udata),
                Flags::Process => make_kevent(ident, EVFILT::PROC, EV::DELETE, NOTE::EXIT, udata),
                Flags::Machport | Flags::MemoryPressure => {
                    return sys::Result::Err(sys::Error::from_code(
                        sys::E::EOPNOTSUPP,
                        sys::Tag::kevent,
                    ));
                }
                _ => unreachable!(),
            };

            let mut nchanges = 1;
            if both_directions {
                changelist[1] = make_kevent(ident, EVFILT::WRITE, EV::DELETE, 0, udata);
                nchanges = 2;
            }

            // nevents=0: per-entry errors surface as rc=-1/errno for the
            // first failing change. For EV_DELETE (typically ENOENT) a silent
            // miss on the second entry is harmless.
            let kq = Fd::from_native(watcher_fd);
            // SAFETY: EV_DELETE registers nothing.
            let removed = unsafe { sys::kevent(kq, &changelist[..nchanges], &mut [], None) };
            match removed.map_err(|err| err.get_errno()) {
                Ok(_) => {}
                Err(e) if deregistration_already_gone(e) => {}
                Err(e) => return sys::Result::Err(sys::Error::from_code(e, sys::Tag::kevent)),
            }
        }

        self.remove_flags(
            Flags::NeedsRearm
                | Flags::OneShot
                | Flags::PollReadable
                | Flags::PollWritable
                | Flags::PollProcess
                | Flags::PollMachport
                | Flags::PollMemoryPressure,
        );

        sys::Result::Ok(())
    }
}

#[cfg(not(windows))]
impl fmt::Display for FilePoll {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(
            f,
            "FilePoll(fd={}, generation_number={}) = {}",
            self.fd,
            self.generation_number,
            FlagsFormatter(self.flags.get())
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Flags
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
#[derive(enumset::EnumSetType, strum::IntoStaticStr, Debug)]
#[strum(serialize_all = "snake_case")]
pub enum Flags {
    // What are we asking the event loop about?
    /// Poll for readable events
    PollReadable,
    /// Poll for writable events
    PollWritable,
    /// Poll for process-related events
    PollProcess,
    /// Poll for machport events
    PollMachport,
    /// Poll for memory-pressure events (Darwin `EVFILT_MEMORYSTATUS`, Linux PSI `EPOLLPRI`)
    PollMemoryPressure,

    // What did the event loop tell us?
    Readable,
    Writable,
    Process,
    Eof,
    Hup,
    Machport,
    MemoryPressure,

    // What is the type of file descriptor?
    Fifo,

    OneShot,
    NeedsRearm,

    HasIncrementedPollCount,
    HasIncrementedActiveCount,

    KeepsEventLoopAlive,

    Nonblocking,

    WasEverRegistered,
    IgnoreUpdates,

    Socket,
    Tty,
}

#[cfg(not(windows))]
pub type FlagsSet = enumset::EnumSet<Flags>;

#[cfg(not(windows))]
impl Flags {
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub(crate) fn from_kqueue_event(kqueue_event: &KQueueEvent) -> FlagsSet {
        #[cfg(target_os = "macos")]
        use bun_sys::darwin::EVFILT;
        #[cfg(target_os = "freebsd")]
        use bun_sys::freebsd::EVFILT;
        let mut flags = FlagsSet::empty();
        if kqueue_event.filter == EVFILT::READ {
            flags.insert(Flags::Readable);
            if kqueue_event.flags & EV_EOF != 0 {
                flags.insert(Flags::Hup);
            }
        } else if kqueue_event.filter == EVFILT::WRITE {
            flags.insert(Flags::Writable);
            if kqueue_event.flags & EV_EOF != 0 {
                flags.insert(Flags::Hup);
            }
        } else if kqueue_event.filter == EVFILT::PROC {
            flags.insert(Flags::Process);
        } else {
            #[cfg(target_os = "macos")]
            if kqueue_event.filter == EVFILT::MACHPORT {
                flags.insert(Flags::Machport);
            }
            #[cfg(target_os = "macos")]
            if kqueue_event.filter == EVFILT::MEMORYSTATUS {
                flags.insert(Flags::MemoryPressure);
            }
        }
        flags
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub(crate) fn from_epoll_event(epoll: &bun_sys::linux::epoll_event) -> FlagsSet {
        use bun_sys::linux::EPOLL;
        let mut flags = FlagsSet::empty();
        if epoll.events & EPOLL::IN != 0 {
            flags.insert(Flags::Readable);
        }
        if epoll.events & EPOLL::OUT != 0 {
            flags.insert(Flags::Writable);
        }
        if epoll.events & EPOLL::PRI != 0 {
            flags.insert(Flags::MemoryPressure);
        }
        if epoll.events & EPOLL::ERR != 0 {
            flags.insert(Flags::Eof);
        }
        if epoll.events & EPOLL::HUP != 0 {
            flags.insert(Flags::Hup);
        }
        flags
    }
}

#[cfg(not(windows))]
pub(crate) struct FlagsFormatter(pub FlagsSet);

#[cfg(not(windows))]
impl fmt::Display for FlagsFormatter {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut is_first = true;
        for flag in self.0.iter() {
            if !is_first {
                write!(f, " | ")?;
            }
            f.write_str(<&'static str>::from(flag))?;
            is_first = false;
        }
        Ok(())
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Store
// ──────────────────────────────────────────────────────────────────────────

#[cfg(not(windows))]
const HIVE_SIZE: usize = 128;
#[cfg(not(windows))]
type FilePollHive = bun_collections::hive_array::Fallback<FilePoll, HIVE_SIZE>;

/// We defer freeing FilePoll until the end of the next event loop iteration
/// This ensures that we don't free a FilePoll before the next callback is called
#[cfg(not(windows))]
pub struct Store {
    hive: FilePollHive,
    pending_free_head: Cell<*mut FilePoll>,
    pending_free_tail: Cell<*mut FilePoll>,
}

#[cfg(not(windows))]
impl Store {
    pub fn init() -> Store {
        Store {
            hive: FilePollHive::init(),
            pending_free_head: Cell::new(ptr::null_mut()),
            pending_free_tail: Cell::new(ptr::null_mut()),
        }
    }

    fn process_deferred_frees(&self) {
        let mut next = self.pending_free_head.replace(ptr::null_mut());
        self.pending_free_tail.set(ptr::null_mut());
        while !next.is_null() {
            let current = next;
            // SAFETY: `put` linked these slots of the hive, and nothing else names them.
            unsafe {
                next = (*current).next_to_free.get();
                self.hive.put(current);
            }
        }
    }

    /// Counts fired one-shot polls awaiting rearm. They're still in the JS loop's `num_polls` but can't fire.
    pub fn disarmed_count(&self) -> i32 {
        let mut count = 0;
        let mut used = self.hive.hive.used.iter_set();
        while let Some(index) = used.next() {
            // SAFETY: slots are only claimed through `get_init`, so a used slot is initialized.
            let poll = unsafe { &*self.hive.hive.ptr_at(index) };
            count += i32::from(
                poll.event_loop.is(EventLoopCtxKind::Js)
                    && poll.has_flag(Flags::HasIncrementedPollCount)
                    && poll.has_flag(Flags::NeedsRearm)
                    && !poll.has_flag(Flags::HasIncrementedActiveCount),
            );
        }
        count
    }

    /// # Safety
    /// `poll` is a slot of `self.hive` that the caller gives up, `vm` is the loop that has this store.
    unsafe fn put(&self, poll: ptr::NonNull<FilePoll>, vm: EventLoopCtx, ever_registered: bool) {
        let poll = poll.as_ptr();
        if !ever_registered {
            // SAFETY: caller contract, and the kernel was never told of it.
            unsafe { self.hive.put(poll) };
            return;
        }

        let tail = self.pending_free_tail.replace(poll);
        if tail.is_null() {
            debug_assert!(self.pending_free_head.get().is_null());
            self.pending_free_head.set(poll);
        } else {
            // SAFETY: a slot on the list is live until `process_deferred_frees`.
            unsafe { (*tail).next_to_free.set(poll) };
        }

        // SAFETY: caller contract.
        unsafe { (*poll).set_flag(Flags::IgnoreUpdates) };

        let callback: OpaqueCallback = Self::process_deferred_frees_thunk;
        debug_assert!(
            vm.after_event_loop_callback().is_none()
                || vm.after_event_loop_callback().map(|f| f as usize) == Some(callback as usize)
        );
        vm.set_after_event_loop_callback(
            Some(callback),
            Some(ptr::NonNull::from(self).cast::<c_void>()),
        );
    }

    unsafe extern "C" fn process_deferred_frees_thunk(ctx: *mut c_void) {
        // SAFETY: the store that `put` passed, which lives as long as the loop that calls this.
        unsafe { &*ctx.cast::<Store>() }.process_deferred_frees();
    }
}

/// Polls whose free is still deferred may be heap slots of the hive's fallback,
/// which only the pending list names.
#[cfg(not(windows))]
impl Drop for Store {
    fn drop(&mut self) {
        self.process_deferred_frees();
    }
}

/// A slot of the event loop's `Store`. Dropping it unregisters the poll and puts the slot back.
#[cfg(not(windows))]
pub struct OwnedFilePoll<const FORCE_UNREGISTER: bool = false>(ptr::NonNull<FilePoll>);

#[cfg(not(windows))]
impl<const FORCE_UNREGISTER: bool> OwnedFilePoll<FORCE_UNREGISTER> {
    /// # Safety
    /// `owner.ptr` points to a live value of the type `__bun_run_io` casts `owner.tag` to, until the poll
    /// is dropped or has another owner.
    pub unsafe fn new(event_loop: EventLoopCtx, fd: Fd, owner: Owner) -> Self {
        let poll = FilePoll {
            fd,
            flags: Cell::new(FlagsSet::empty()),
            owner: Cell::new(owner),
            next_to_free: Cell::new(ptr::null_mut()),
            event_loop,
            #[cfg(all(target_os = "macos", debug_assertions))]
            // Single-threaded event loop so `Relaxed` ordering is sufficient.
            generation_number: MAX_GENERATION_NUMBER
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed)
                .wrapping_add(1),
            #[cfg(not(all(target_os = "macos", debug_assertions)))]
            generation_number: 0,
        };
        let this = Self(event_loop.file_polls().hive.get_init(poll));
        syslog!(
            "FilePoll.init(0x{:x}, generation_number={}, fd={})",
            this.0.addr(),
            this.generation_number,
            fd
        );
        this
    }
}

#[cfg(not(windows))]
impl<const FORCE_UNREGISTER: bool> core::ops::Deref for OwnedFilePoll<FORCE_UNREGISTER> {
    type Target = FilePoll;
    fn deref(&self) -> &FilePoll {
        // SAFETY: the slot is this value's until it drops, and nothing borrows it mutably.
        unsafe { self.0.as_ref() }
    }
}

#[cfg(not(windows))]
impl<const FORCE_UNREGISTER: bool> Drop for OwnedFilePoll<FORCE_UNREGISTER> {
    fn drop(&mut self) {
        let was_ever_registered = self.reset(FORCE_UNREGISTER);
        let event_loop = self.event_loop;
        // SAFETY: `new` took the slot from this store.
        unsafe {
            event_loop
                .file_polls()
                .put(self.0, event_loop, was_ever_registered)
        };
    }
}

// ──────────────────────────────────────────────────────────────────────────
// onTick (exported)
// ──────────────────────────────────────────────────────────────────────────

// `Pollable` is a single-variant tagged-pointer union over `FilePoll`.
//
// Note: `bun_collections::TaggedPtrUnion<(FilePoll,)>` cannot be
// instantiated here — `impl_tagged_ptr_union!` would generate
// `impl TypeList for (FilePoll,)`, which trips the orphan rule (foreign trait
// on a tuple). Since the union has exactly one variant, wrap the raw
// `TaggedPtr` directly with the same tag scheme (`1024 - index`).
#[cfg(not(windows))]
#[derive(Copy, Clone)]
pub(crate) struct Pollable {
    repr: bun_collections::TaggedPtr,
}

#[cfg(not(windows))]
impl Pollable {
    /// Tag value for `FilePoll` (index 0 → `1024 - 0`).
    pub(crate) const FILE_POLL_TAG: u16 = 1024;

    #[inline]
    pub(crate) fn init(ptr: *const crate::FilePoll) -> Self {
        Self {
            repr: bun_collections::TaggedPtr::init(ptr, Self::FILE_POLL_TAG),
        }
    }

    #[inline]
    pub(crate) fn from(val: *mut c_void) -> Self {
        Self {
            repr: bun_collections::TaggedPtr::from(val),
        }
    }

    #[inline]
    pub(crate) fn tag(self) -> u16 {
        self.repr.data()
    }

    #[inline]
    pub(crate) fn as_file_poll(self) -> *mut crate::FilePoll {
        self.repr.get::<crate::FilePoll>()
    }

    #[inline]
    pub(crate) fn ptr(self) -> *mut c_void {
        self.repr.to()
    }
}

// `current_ready_poll`/`ready_polls` only exist on the POSIX uws loop layout;
// on Windows the libuv loop drives readiness, so this entry point is never
// linked there. Restrict to the platforms where the fields are present.
#[cfg(any(
    target_os = "linux",
    target_os = "android",
    target_os = "macos",
    target_os = "freebsd"
))]
#[unsafe(no_mangle)]
/// # Safety
/// uWS C callback: `loop_` is the live per-thread `us_loop_t`; `tagged_pointer`
/// was registered via `Pollable::init` in `register_impl`.
unsafe extern "C" fn Bun__internal_dispatch_ready_poll(loop_: &Loop, tagged_pointer: *mut c_void) {
    let tag = Pollable::from(tagged_pointer);

    if tag.tag() != Pollable::FILE_POLL_TAG {
        return;
    }

    // SAFETY: tag matched FilePoll; pointer was set via Pollable::init in register_impl.
    // Not used once the owner runs, which may free the slot.
    let file_poll = unsafe { &*tag.as_file_poll() };
    if file_poll.has_flag(Flags::IgnoreUpdates) {
        return;
    }

    let ev = loop_.current_ready_event();

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    let event = file_poll.on_kqueue_event(&ev);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    let event = file_poll.on_epoll_event(&ev);

    // SAFETY: the contract of `OwnedFilePoll::new` and `FilePoll::set_owner`.
    unsafe { __bun_run_io(file_poll.owner.get(), event) };
}

#[cfg(target_os = "macos")]
static TIMEOUT: bun_sys::posix::timespec = bun_sys::posix::timespec {
    tv_sec: 0,
    tv_nsec: 0,
};

#[cfg(not(windows))]
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub(crate) enum OneShotFlag {
    Dispatch,
    OneShot,
    None,
}

#[cfg(not(windows))]
const INVALID_FD: Fd = Fd::INVALID;

#[cfg(all(test, not(windows)))]
mod tests {
    use super::*;

    /// kevent `EV_ERROR` entries carry the errno value itself in `data`.
    /// These used to be round-tripped through `errno_sys`, which decodes the
    /// -1-sentinel return-code convention and therefore returned `None` for
    /// every real errno — panicking at the `.unwrap()` call sites whenever an
    /// `EV_DELETE` failed (e.g. EBADF/ENOENT from a pipe fd closed while its
    /// `FilePoll` was still registered).
    #[test]
    fn kevent_change_error_decodes_errno_value_not_return_code() {
        let err = kevent_change_error(sys::E::EBADF as i64).unwrap_err();
        assert_eq!(err.get_errno(), sys::E::EBADF);
        assert_eq!(err.syscall, sys::Tag::kevent);

        let err = kevent_change_error(sys::E::ENOENT as i64).unwrap_err();
        assert_eq!(err.get_errno(), sys::E::ENOENT);

        // Out-of-range data must not panic either.
        let err = kevent_change_error(i64::MAX).unwrap_err();
        assert_eq!(err.get_errno(), sys::E::EINVAL);
    }
}
