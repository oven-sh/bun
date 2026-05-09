//! Confusingly, this is the barely used epoll/kqueue event loop
//! This is only used by Bun.write() and Bun.file(path).text() & friends.
//!
//! Most I/O happens on the main thread.

// ════════════════════════════════════════════════════════════════════════════
// B-2 UN-GATED. Loop / Poll / Waker / Closer / FilePoll-vtable / heap / pipes /
// MaxBuf / openForWriting / PipeReader / PipeWriter compile on POSIX. `source`
// and the Windows*Reader/Writer impls are `#[cfg(windows)]`-gated (libuv-only;
// not B-2-verifiable on this host). See TODO(b2-blocked) notes for remaining
// T0/T1 shims (`bun_sys::syslog`, `bun_sys::Error::oom`, `bun_core::debug_warn`).
// ════════════════════════════════════════════════════════════════════════════

#![allow(dead_code, unused_variables, unused_imports, unused_mut, clippy::all)]
#![allow(unsafe_op_in_unsafe_fn)]

// ── submodules ──────────────────────────────────────────────────────────────
#![warn(unreachable_pub)]

// ── merged from bun_io ──────────────────────────────────────────────────────
//
// `bun_io`'s `FilePoll`/`EventLoopCtx`/`ParentDeathWatchdog`/`Loop`/`Waker`
// scaffolding now lives here. The two crates were at the same dependency tier
// (both T2, neither reachable from `bun_event_loop`'s upward direction) and
// shared every dep; the only effect of the split was forcing the
// `bun_io::EventLoopHandle = *mut c_void` type-erasure seam between
// `BufferedReader` and `FilePoll`, which let callers smuggle a pointer to the
// wrong enum (`&AnyEventLoop` instead of `&EventLoopHandle`) and reinterpret
// the discriminant — a SIGABRT-at-best bug class. With both halves in one
// crate, `EventLoopHandle` is `EventLoopCtx` (the by-value `{kind, owner}`
// pair) and the seam is type-checked.

pub mod stub_event_loop;

#[cfg(windows)]
pub mod windows_event_loop;

// `posix_event_loop` also defines the *shared* event-loop scaffolding
// (`EventLoopCtx`, `AllocatorType`, `Owner`, `Flags`, `PollTag`, `Store`,
// `OpaqueCallback`); `windows_event_loop` re-uses those types and only
// overrides `FilePoll`/`KeepAlive`/`Closer`/`Loop`/`Waker`. The platform-
// specific bits inside (kqueue/epoll wakers, fd polling) are individually
// `#[cfg(unix)]`-gated so the module still compiles on Windows.
pub mod posix_event_loop;

// ParentDeathWatchdog is POSIX-only (uses `libc::pid_t`, `getppid`, signals);
// Windows handles orphan death via Job Objects in `spawn`. The Zig original
// compiles on all targets and short-circuits each fn with
// `if (comptime !Environment.isPosix) return;`, so downstream code calls
// `install()` / `enable()` / `is_enabled()` unconditionally. Mirror that with a
// no-op Windows stub so the cross-platform call sites (main.rs, bunfig,
// run_command, filter_run, dispatch) keep compiling.
#[cfg(not(windows))]
#[path = "ParentDeathWatchdog.rs"]
pub mod parent_death_watchdog;
#[cfg(windows)]
pub mod parent_death_watchdog {
    use crate::posix_event_loop::EventLoopCtx;
    /// Unit struct — `FilePoll.Owner` dispatch needs a real pointee type.
    pub struct ParentDeathWatchdog;
    pub const EXIT_CODE: u8 = 128 + 1;
    #[inline] pub fn is_enabled() -> bool { false }
    #[inline] pub fn install() {}
    #[inline] pub fn enable() {}
    #[inline] pub fn install_on_event_loop(_handle: EventLoopCtx) {}
    #[inline] pub fn on_parent_exit(_this: &mut ParentDeathWatchdog) {
        debug_assert!(false, "ParentDeathWatchdog poll on Windows");
    }
}
pub use parent_death_watchdog as ParentDeathWatchdog;

// ─── public surface (was bun_io's crate root) ──────────────────────────────

#[cfg(not(windows))]
pub use posix_event_loop::{FilePoll, KeepAlive, Loop};
#[cfg(windows)]
pub use windows_event_loop::{FilePoll, KeepAlive, Loop};

pub use posix_event_loop::{AllocatorType, Owner, PollTag};

pub type OpaqueCallback = unsafe extern "C" fn(*mut core::ffi::c_void);

// At crate root so the per-method `$crate::__EventLoopCtx__*` type aliases the
// macro emits (and the impl-macro reads back) actually resolve from impl
// crates. `Store`/`FilePoll` here are the *platform* re-exports above.
//
// `platform_event_loop_ptr` is typed `*mut bun_uws_sys::Loop` (the uws
// wrapper — `PosixLoop`/`WindowsLoop`), NOT the cfg-aliased `crate::Loop`
// re-export. On POSIX those coincide, but on Windows `crate::Loop` is the raw
// `uv_loop_t` (Zig `windows_event_loop.zig:1`) whereas the impl bodies
// (`VirtualMachine::uws_loop` / `MiniEventLoop::loop_ptr`) and the Zig spec
// (`EventLoopHandle.loop() -> *uws.Loop`) hand back the wrapper.
bun_dispatch::link_interface! {
    pub EventLoopCtx[Js, Mini] {
        fn platform_event_loop_ptr() -> *mut bun_uws_sys::Loop;
        fn file_polls_ptr() -> *mut Store;
        fn alloc_file_poll() -> *mut FilePoll;
        fn increment_pending_unref_counter();
        fn ref_concurrently();
        fn unref_concurrently();
        fn after_event_loop_callback() -> Option<OpaqueCallback>;
        fn set_after_event_loop_callback(cb: Option<OpaqueCallback>, ctx: *mut core::ffi::c_void);
        fn pipe_read_buffer() -> *mut [u8];
    }
}

pub type EventLoopKind = EventLoopCtxKind;

impl EventLoopCtx {
    /// SAFETY: caller must not hold another live `&mut` to the same loop
    /// across this borrow (resolver-style accessor; the loop is per-thread).
    #[inline]
    pub unsafe fn platform_event_loop(&self) -> &mut bun_uws_sys::Loop {
        unsafe { &mut *self.platform_event_loop_ptr() }
    }
    /// SAFETY: same aliasing hazard as [`platform_event_loop`].
    #[inline]
    pub unsafe fn file_polls(&self) -> &mut Store {
        unsafe { &mut *self.file_polls_ptr() }
    }
    #[inline]
    pub fn is_js(&self) -> bool { self.is(EventLoopCtxKind::Js) }
    #[inline]
    pub fn loop_(&self) -> *mut bun_uws_sys::Loop { self.platform_event_loop_ptr() }
    #[inline]
    pub fn init(h: EventLoopCtx) -> EventLoopCtx { h }
    #[inline]
    pub fn as_event_loop_ctx(self) -> EventLoopCtx { self }
}
#[cfg(not(windows))]
pub use posix_event_loop::Store;
#[cfg(windows)]
pub use windows_event_loop::Store;

/// Mirrors posix_event_loop::Flags.
pub use posix_event_loop::Flags as PollFlag;
/// Mirrors poll kind enum used by process.rs.
pub use posix_event_loop::Flags as PollKind;

/// `file_poll` module — real one lives in {posix,windows}_event_loop.rs.
pub mod file_poll {
    pub use super::FilePoll as FilePoll;
    pub use super::Store;
    pub use super::posix_event_loop::{Flags, Flags as Flag, FlagsSet};
    /// Kqueue/epoll watch kind passed to `FilePoll::register`.
    pub type Pollable = Flags;
}

// ── bun_io original submodules ──────────────────────────────────────────────

#[path = "heap.rs"]
pub mod heap;
// `source.rs` is Windows-only (libuv pipe/tty/file wrappers). On POSIX the
// `Source` type is never constructed; callers are themselves `#[cfg(windows)]`.
// TODO(b2-blocked): bun_sys::windows::libuv — verify compiles on Windows in CI.
#[cfg(windows)]
#[path = "source.rs"]
pub mod source;
#[path = "pipes.rs"]
pub mod pipes;
#[path = "PipeReader.rs"]
pub mod pipe_reader;
#[path = "PipeWriter.rs"]
pub mod pipe_writer;
#[path = "openForWriting.rs"]
pub mod open_for_writing_mod;
#[path = "MaxBuf.rs"]
pub mod max_buf;
#[path = "write.rs"]
pub mod write;

// ── re-exports for higher tiers ─────────────────────────────────────────────
// Byte-level `Write` trait + helpers (Zig `std.Io.Writer` surface). Downstream
// crates name these as `bun_io::Write` / `bun_io::BufWriter` /
// `bun_io::FmtAdapter` / `bun_io::Result`.
pub use write::{BufWriter, DiscardingWriter, FixedBufferStream, FmtAdapter, IntLe, Result, Write};

pub use pipes::{FileType, ReadState};
#[allow(non_snake_case)]
pub use max_buf as MaxBuf;

// `BufferedReader` parent callback dispatch. Each variant's `link_impl_*!` (in
// `bun_runtime`/`bun_install`) forwards to that type's `BufferedReaderParent`
// trait impl — see `buffered_reader_parent_link!` below.
bun_dispatch::link_interface! {
    pub BufferedReaderParentLink[
        SubprocessPipeReader,
        ShellPipeReader,
        ShellIoReader,
        FileReader,
        FileResponseStream,
        Terminal,
        CronRegister,
        CronRemove,
        FilterRunHandle,
        MultiRunPipeReader,
        TestParallelWorkerPipe,
        LifecycleScript,
        SecurityScan,
    ] {
        fn has_on_read_chunk() -> bool;
        fn on_read_chunk(chunk: &[u8], has_more: pipes::ReadState) -> bool;
        fn on_reader_done();
        fn on_reader_error(err: bun_sys::Error);
        fn loop_ptr() -> *mut Loop;
        fn event_loop() -> EventLoopCtx;
        // Only the `SubprocessPipeReader` arm acts on this; everything else
        // no-ops (no other parent type wires a `MaxBuf`).
        fn on_max_buffer_overflow(maxbuf: core::ptr::NonNull<max_buf::MaxBuf>);
    }
}

/// Generates the `link_impl_BufferedReaderParentLink!` body for a type that
/// already implements [`pipe_reader::BufferedReaderParent`]. Used once per
/// variant in the impl crates (`bun_runtime`/`bun_install`).
#[macro_export]
macro_rules! buffered_reader_parent_link {
    ($variant:ident for $T:ty) => {
        $crate::link_impl_BufferedReaderParentLink! {
            $variant for $T => |this| {
                has_on_read_chunk() =>
                    <$T as $crate::pipe_reader::BufferedReaderParent>::HAS_ON_READ_CHUNK,
                on_read_chunk(chunk, has_more) =>
                    <$T as $crate::pipe_reader::BufferedReaderParent>::on_read_chunk(this, chunk, has_more),
                on_reader_done() =>
                    <$T as $crate::pipe_reader::BufferedReaderParent>::on_reader_done(this),
                on_reader_error(err) =>
                    <$T as $crate::pipe_reader::BufferedReaderParent>::on_reader_error(this, err),
                loop_ptr() =>
                    <$T as $crate::pipe_reader::BufferedReaderParent>::loop_(this),
                event_loop() =>
                    <$T as $crate::pipe_reader::BufferedReaderParent>::event_loop(this),
                on_max_buffer_overflow(maxbuf) =>
                    <$T as $crate::pipe_reader::BufferedReaderParent>::on_max_buffer_overflow(this, maxbuf),
            }
        }
    };
}
pub use pipe_writer::{BufferedWriter, StreamBuffer, StreamingWriter, WriteResult, WriteStatus};
#[cfg(windows)]
pub use source::Source;

// B-2: stub for never-constructed-on-POSIX `Source` so cross-platform sigs
// (`Option<Source>`) typecheck.
#[cfg(not(windows))]
pub enum Source {}

pub use pipe_reader::{BufferedReader, BufferedReaderParent, PosixFlags};
/// Downstream alias (Zig: `bun.io.BufferedReader` is sometimes referenced as
/// `PipeReader`).
pub type PipeReader = BufferedReader;

pub use open_for_writing_mod::{open_for_writing, open_for_writing_impl};

// ════════════════════════════════════════════════════════════════════════════

use core::ffi::{c_int, c_void};
use core::mem::offset_of;
use core::ptr::{self, NonNull};
use core::sync::atomic::{AtomicPtr, Ordering};

pub use crate::waker::Waker;
pub use crate::closer::Closer;
use bun_sys::{self as sys, Fd, FdExt, E};

// Zig scope name is `.loop` (io.zig:11). `loop` is a Rust keyword, so the static is
// named `io_loop` but the runtime tagname is `"loop"` so `BUN_DEBUG_loop=1` works.
#[allow(non_upper_case_globals)]
pub static io_loop: bun_core::output::ScopedLogger =
    bun_core::output::ScopedLogger::new("loop", bun_core::output::Visibility::Visible);
macro_rules! log {
    ($($args:tt)*) => { bun_core::scoped_log!(io_loop, $($args)*) };
}

#[cfg(windows)]
mod windows_ffi {
    // Bun C++ shim over `QueryPerformanceCounter` (src/bun.js/bindings/
    // c-bindings.cpp). Zig io.zig:314 declares it inline in `Loop`.
    unsafe extern "C" {
        pub(super) fn clock_gettime_monotonic(sec: *mut i64, nsec: *mut i64) -> core::ffi::c_int;
    }
}

// ─── platform type aliases ────────────────────────────────────────────────────

/// `bun_sys::linux` doesn't exist yet; use `libc` constants directly.
/// TODO(b2-blocked): bun_sys::linux — replace with that module once available.
#[cfg(any(target_os = "linux", target_os = "android"))]
mod linux {
    pub(crate) use libc::epoll_event;
    pub(crate) const EPOLL_IN: u32 = libc::EPOLLIN as u32;
    pub(crate) const EPOLL_OUT: u32 = libc::EPOLLOUT as u32;
    pub(crate) const EPOLL_ERR: u32 = libc::EPOLLERR as u32;
    pub(crate) const EPOLL_HUP: u32 = libc::EPOLLHUP as u32;
    pub(crate) const EPOLL_ET: u32 = libc::EPOLLET as u32;
    pub(crate) const EPOLL_ONESHOT: u32 = libc::EPOLLONESHOT as u32;
    pub(crate) const EPOLL_CTL_ADD: i32 = libc::EPOLL_CTL_ADD;
    pub(crate) const EPOLL_CTL_MOD: i32 = libc::EPOLL_CTL_MOD;
    pub(crate) const EPOLL_CTL_DEL: i32 = libc::EPOLL_CTL_DEL;
}

/// Zig std's `.freebsd` `EV` struct lacks `.EOF`; the value (0x8000) is the
/// same on Darwin and FreeBSD (sys/event.h: `#define EV_EOF 0x8000`).
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
const EV_EOF: u16 = 0x8000;

/// Kqueue event struct. Darwin's kevent64_s carries a 2-slot ext[] used for
/// the optional generation-number assertion; FreeBSD's plain `struct kevent`
/// has `_ext[4]` but no public accessor, and we don't use it. See
/// `kevent_call` for the syscall difference.
#[cfg(target_os = "freebsd")]
type KEvent = libc::kevent;
#[cfg(target_os = "macos")]
type KEvent = libc::kevent64_s;

/// Thin shim over kevent64() vs kevent(). Darwin's kevent64 takes an extra
/// `flags` arg between nevents and timeout; FreeBSD's kevent does not.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
#[inline(always)]
fn kevent_call(
    kq: i32,
    changes: *const KEvent,
    nchanges: c_int,
    events: *mut KEvent,
    nevents: c_int,
    timeout: *const libc::timespec,
) -> isize {
    #[cfg(target_os = "freebsd")]
    {
        // SAFETY: thin wrapper over libc kevent; caller upholds invariants.
        return unsafe { libc::kevent(kq, changes, nchanges, events, nevents, timeout) as isize };
    }
    #[cfg(target_os = "macos")]
    {
        // SAFETY: thin wrapper over libc kevent64; caller upholds invariants.
        return unsafe {
            libc::kevent64(kq, changes, nchanges, events, nevents, 0, timeout) as isize
        };
    }
}

#[cfg(any(target_os = "linux", target_os = "android"))]
type EventType = linux::epoll_event;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
type EventType = KEvent;

// ─── IoRequestLoop ──────────────────────────────────────────────────────────
// This is io.zig's `Loop` — the bare-kqueue/epoll request loop that backs
// `Bun.file(path).text()` / `Bun.write()` & friends (and nothing else; see the
// crate doc above). NOT the main event loop. Renamed from `Loop` so this
// crate's `Loop` (= `posix_event_loop::Loop` = the uws `us_loop_t` everyone
// actually means by "the loop") keeps its short name. Only one external caller
// (`bun_runtime::webcore::Blob`).

pub struct IoRequestLoop {
    pub pending: RequestQueue,
    pub waker: Waker,
    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub epoll_fd: Fd,
    /// FreeBSD's `Waker` is `LinuxWaker` (an eventfd), so unlike macOS the
    /// waker fd is NOT itself a kqueue. We create one here and register the
    /// eventfd on it, mirroring how Linux registers the eventfd on epoll_fd.
    #[cfg(target_os = "freebsd")]
    pub kqueue_fd: Fd,

    pub cached_now: libc::timespec,
    pub active: usize,
}

// §Concurrency: `OnceLock` for init gate; the singleton itself stays raw because
// the IO thread mutates fields concurrently with `schedule()` callers (which only
// touch the lock-free `pending` queue + `waker`), so wrapping the whole struct in a
// `Mutex` would be wrong. Matches Zig `var loop: Loop = undefined;` + `std.once(load)`.
// PORTING.md §Global mutable state: RacyCell — `ONCE` provides the
// happens-before for init; afterwards only the IO thread mutates non-atomic
// fields and other threads only touch the lock-free `pending` + `waker`.
static LOOP: bun_core::RacyCell<core::mem::MaybeUninit<IoRequestLoop>> =
    bun_core::RacyCell::new(core::mem::MaybeUninit::uninit());
static ONCE: std::sync::OnceLock<()> = std::sync::OnceLock::new();

impl IoRequestLoop {
    fn load() {
        // SAFETY: called exactly once via `ONCE.get_or_init`; no other access until this returns.
        let loop_ = unsafe { (*LOOP.get()).assume_init_mut() };
        *loop_ = IoRequestLoop {
            pending: RequestQueue::default(),
            waker: Waker::init().unwrap_or_else(|_| panic!("failed to initialize waker")),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            epoll_fd: Fd::INVALID,
            #[cfg(target_os = "freebsd")]
            kqueue_fd: Fd::INVALID,
            cached_now: libc::timespec { tv_sec: 0, tv_nsec: 0 },
            active: 0,
        };

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // SAFETY: direct syscall wrapper.
            let raw = unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC | 0) };
            if raw < 0 {
                panic!("Failed to create epoll file descriptor");
            }
            loop_.epoll_fd = Fd::from_native(raw);
            // TODO(port): Zig used `std.posix.epoll_create1` which already error-checks; here we
            // only panic on negative, matching semantics.

            {
                // SAFETY: all-zero is a valid epoll_event (POD).
                let mut epoll: linux::epoll_event = unsafe { bun_core::ffi::zeroed() };
                epoll.events =
                    linux::EPOLL_IN | linux::EPOLL_ET | linux::EPOLL_ERR | linux::EPOLL_HUP;
                epoll.u64 = std::ptr::from_mut::<IoRequestLoop>(loop_) as usize as u64;
                // SAFETY: valid epoll fd + waker fd just created.
                let rc = unsafe {
                    libc::epoll_ctl(
                        loop_.epoll_fd.native(),
                        linux::EPOLL_CTL_ADD,
                        loop_.waker.get_fd().native(),
                        &raw mut epoll,
                    )
                };
                match sys::get_errno(rc) {
                    E::SUCCESS => {}
                    err => bun_core::Output::panic(format_args!(
                        "Failed to wait on epoll {:?}",
                        err
                    )),
                }
            }
        }

        #[cfg(target_os = "freebsd")]
        {
            // SAFETY: direct syscall wrapper.
            let kq = unsafe { libc::kqueue() };
            if kq < 0 {
                panic!("Failed to create kqueue");
            }
            loop_.kqueue_fd = Fd::from_native(kq);
            // Register the eventfd waker. udata = 0 → Pollable.tag() == .empty,
            // which onUpdateKQueue treats as a no-op (the wakeup just unblocks
            // the kevent() wait so the pending queue gets drained). EV_CLEAR
            // makes it edge-triggered so we never need to read() the eventfd.
            // SAFETY: all-zero is a valid kevent (POD).
            let mut change: KEvent = unsafe { bun_core::ffi::zeroed() };
            change.ident = usize::try_from(loop_.waker.get_fd().native()).expect("int cast");
            change.filter = libc::EVFILT_READ;
            change.flags = libc::EV_ADD | libc::EV_CLEAR;
            // SAFETY: valid kqueue fd just created; passing 1 change, 0 events.
            let rc = unsafe {
                libc::kevent(
                    loop_.kqueue_fd.native(),
                    core::ptr::from_ref::<KEvent>(&change),
                    1,
                    core::ptr::null_mut(),
                    0,
                    core::ptr::null(),
                )
            };
            match sys::get_errno(rc as isize) {
                sys::Errno::SUCCESS => {}
                err => bun_core::Output::panic(format_args!(
                    "Failed to register waker on kqueue: {}",
                    <&'static str>::from(err)
                )),
            }
        }

        // smaller thread, since it's not doing much.
        std::thread::Builder::new()
            .stack_size(1024 * 1024 * 2)
            .spawn(Self::on_spawn_io_thread)
            .unwrap_or_else(|_| panic!("Failed to spawn IO watcher thread"));
        // Zig: thread.detach() — Rust JoinHandle detaches on drop.
    }

    pub fn get() -> &'static mut IoRequestLoop {
        #[cfg(windows)]
        {
            panic!("Do not use this API on windows");
        }

        ONCE.get_or_init(|| { Self::load(); });

        // SAFETY: LOOP initialized by `load()` exactly once above; callers uphold the
        // Zig invariant that only the IO thread mutates non-atomic fields and other
        // threads only call `schedule()` (lock-free queue + waker).
        unsafe { (*LOOP.get()).assume_init_mut() }
    }

    pub fn on_spawn_io_thread() {
        // SAFETY: ONCE guarantees LOOP is initialized before this thread is spawned.
        unsafe { (*LOOP.get()).assume_init_mut() }.tick();
    }

    pub fn schedule(&mut self, request: &mut Request) {
        debug_assert!(!request.scheduled);
        request.scheduled = true;
        self.pending.push(request);
        self.waker.wake();
    }

    pub fn tick(&mut self) {
        // SAFETY: literal is NUL-terminated; len excludes the NUL.
        let name = unsafe { bun_core::ZStr::from_raw(b"IO Watcher\0".as_ptr(), 10) };
        bun_core::Output::Source::configure_named_thread(name);

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            self.tick_epoll();
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            self.tick_kqueue();
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "macos", target_os = "freebsd")))]
        {
            panic!("TODO on this platform");
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn tick_epoll(&mut self) {
        self.update_now();

        loop {
            // Process pending requests
            {
                let mut pending = self.pending.pop_batch().iterator();
                let watcher_fd = self.pollfd();

                loop {
                    let request_ptr = pending.next();
                    if request_ptr.is_null() { break; }
                    // SAFETY: pop_batch yields live nodes pushed by `schedule()`.
                    let request = unsafe { &mut *request_ptr };
                    request.scheduled = false;
                    match (request.callback)(request) {
                        Action::Readable(readable) => {
                            match readable.poll.register_for_epoll(
                                Flags::PollReadable,
                                readable.tag,
                                watcher_fd,
                                true,
                                readable.fd,
                            ) {
                                Err(err) => {
                                    (readable.on_error)(readable.ctx, err);
                                }
                                Ok(()) => {
                                    self.active += 1;
                                }
                            }
                        }
                        Action::Writable(writable) => {
                            match writable.poll.register_for_epoll(
                                Flags::PollWritable,
                                writable.tag,
                                watcher_fd,
                                true,
                                writable.fd,
                            ) {
                                Err(err) => {
                                    (writable.on_error)(writable.ctx, err);
                                }
                                Ok(()) => {
                                    self.active += 1;
                                }
                            }
                        }
                        Action::Close(close) => {
                            log!(
                                "close({}, registered={})",
                                close.fd,
                                close.poll.flags.contains(Flags::Registered)
                            );
                            // Only remove from the interest list if it was previously registered.
                            // Otherwise, epoll gets confused.
                            // This state can happen if polling for readable/writable previously failed.
                            if close.poll.flags.contains(Flags::WasEverRegistered) {
                                close.poll.unregister_with_fd(watcher_fd, close.fd);
                                self.active -= 1;
                            }
                            (close.on_done)(close.ctx);
                        }
                    }
                }
            }

            let mut events: [core::mem::MaybeUninit<EventType>; 256] =
                [const { core::mem::MaybeUninit::uninit() }; 256];

            // SAFETY: valid epoll fd; events buffer length matches.
            let rc = unsafe {
                libc::epoll_wait(
                    self.pollfd().native(),
                    events.as_mut_ptr().cast(),
                    c_int::try_from(events.len()).expect("int cast"),
                    i32::MAX,
                )
            };

            match sys::get_errno(rc) {
                E::EINTR => continue,
                E::SUCCESS => {}
                e => bun_core::Output::panic(format_args!("epoll_wait: {:?}", e)),
            }

            self.update_now();

            // SAFETY: kernel wrote `rc` valid events into the buffer.
            let current_events: &[linux::epoll_event] =
                unsafe { core::slice::from_raw_parts(events.as_ptr().cast(), rc as usize) };
            if rc != 0 {
                log!("epoll_wait({}) = {}", self.pollfd(), rc);
            }

            for event in current_events {
                let pollable = Pollable::from(event.u64);
                if pollable.tag() == PollableTag::Empty {
                    // SAFETY: LOOP is initialized (we are running inside it).
                    if event.u64 == unsafe { (*LOOP.get()).as_ptr() } as usize as u64 {
                        // Edge-triggered: no need to read the eventfd counter
                        continue;
                    }
                }
                Poll::on_update_epoll(pollable.poll(), pollable.tag(), *event);
            }
        }
    }

    pub fn pollfd(&self) -> Fd {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            return self.epoll_fd;
        }
        #[cfg(target_os = "freebsd")]
        {
            return self.kqueue_fd;
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", target_os = "freebsd")))]
        {
            self.waker.get_fd()
        }
    }

    pub fn fd(&self) -> Fd {
        self.waker.get_fd()
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub fn tick_kqueue(&mut self) {
        self.update_now();

        loop {
            // PERF(port): was StackFallbackAllocator(256*sizeof(EventType)) — profile in Phase B.
            let mut events_list: Vec<EventType> = Vec::with_capacity(256);

            // Process pending requests
            {
                let mut pending = self.pending.pop_batch().iterator();
                events_list.reserve(pending.batch.count);
                // SAFETY: zero the spare capacity; EventType is POD.
                unsafe {
                    core::ptr::write_bytes(
                        events_list.as_mut_ptr(),
                        0,
                        events_list.capacity(),
                    );
                }

                loop {
                    let request_ptr = pending.next();
                    if request_ptr.is_null() { break; }
                    // SAFETY: pop_batch yields live nodes pushed by `schedule()`.
                    let request = unsafe { &mut *request_ptr };
                    request.scheduled = false;
                    match (request.callback)(request) {
                        Action::Readable(readable) => {
                            let i = events_list.len();
                            debug_assert!(i + 1 <= events_list.capacity());
                            // SAFETY: capacity reserved above; slot zeroed.
                            unsafe { events_list.set_len(i + 1) };

                            Poll::apply_kqueue(
                                ApplyAction::Readable,
                                readable.tag,
                                readable.poll,
                                readable.fd,
                                &mut events_list[i],
                            );
                        }
                        Action::Writable(writable) => {
                            let i = events_list.len();
                            debug_assert!(i + 1 <= events_list.capacity());
                            // SAFETY: capacity reserved above; slot zeroed.
                            unsafe { events_list.set_len(i + 1) };

                            Poll::apply_kqueue(
                                ApplyAction::Writable,
                                writable.tag,
                                writable.poll,
                                writable.fd,
                                &mut events_list[i],
                            );
                        }
                        Action::Close(close) => {
                            if close.poll.flags.contains(Flags::PollReadable)
                                || close.poll.flags.contains(Flags::PollWritable)
                            {
                                let i = events_list.len();
                                debug_assert!(i + 1 <= events_list.capacity());
                                // SAFETY: capacity reserved above; slot zeroed.
                                unsafe { events_list.set_len(i + 1) };
                                Poll::apply_kqueue(
                                    ApplyAction::Cancel,
                                    close.tag,
                                    close.poll,
                                    close.fd,
                                    &mut events_list[i],
                                );
                            }
                            (close.on_done)(close.ctx);
                        }
                    }
                }
            }

            let change_count = events_list.len();
            let capacity = events_list.capacity();

            let rc = kevent_call(
                self.pollfd().native(),
                events_list.as_ptr(),
                // PERF(port): @intCast
                c_int::try_from(change_count).expect("int cast"),
                // The same array may be used for the changelist and eventlist.
                events_list.as_mut_ptr(),
                // we set 0 here so that if we get an error on
                // registration, it becomes errno
                // PERF(port): @intCast
                c_int::try_from(capacity).expect("int cast"),
                core::ptr::null(),
            );

            match sys::get_errno(rc) {
                sys::Errno::EINTR => continue,
                sys::Errno::SUCCESS => {}
                e => bun_core::Output::panic(format_args!(
                    "kevent failed: {}",
                    <&'static str>::from(e)
                )),
            }

            self.update_now();

            let rc_len = usize::try_from(rc).expect("int cast");
            debug_assert!(rc_len <= capacity);
            // SAFETY: kernel wrote `rc` valid events into the buffer.
            let current_events: &[KEvent] =
                unsafe { core::slice::from_raw_parts(events_list.as_ptr(), rc_len) };

            for event in current_events {
                Poll::on_update_kqueue(*event);
            }
        }
    }

    fn update_now(&mut self) {
        Self::update_timespec(&mut self.cached_now);
    }

    // PORT NOTE: Zig nests the `extern "c" fn clock_gettime_monotonic` decl
    // inside the `Loop` namespace (io.zig:314); Rust forbids `extern` blocks
    // inside `impl`, so it's hoisted to `windows_ffi` at module scope.

    pub fn update_timespec(timespec: &mut libc::timespec) {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            // SAFETY: valid out-pointer.
            let rc = unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, timespec) };
            debug_assert!(rc == 0);
        }
        #[cfg(windows)]
        {
            // `clock_gettime_monotonic` is a Bun C++ shim (src/bun.js/bindings/
            // c-bindings.cpp) over `QueryPerformanceCounter`; declared at module
            // scope in `windows_ffi` since `extern` blocks can't live in `impl`.
            let mut sec: i64 = 0;
            let mut nsec: i64 = 0;
            // SAFETY: valid out-pointers.
            let rc = unsafe { windows_ffi::clock_gettime_monotonic(&mut sec, &mut nsec) };
            debug_assert!(rc == 0);
            timespec.tv_sec = sec.try_into().expect("infallible: size matches");
            timespec.tv_nsec = nsec.try_into().expect("infallible: size matches");
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
        {
            // SAFETY: valid out-pointer.
            let rc = unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, timespec) };
            if rc != 0 {
                return;
            }
        }
    }
}

// ─── Request ──────────────────────────────────────────────────────────────────

pub struct Request {
    pub next: AtomicPtr<Request>,
    pub callback: for<'a> fn(&'a mut Request) -> Action<'a>,
    pub scheduled: bool,
}

impl Request {
    #[inline]
    pub fn new(callback: for<'a> fn(&'a mut Request) -> Action<'a>) -> Self {
        Self { next: AtomicPtr::new(ptr::null_mut()), callback, scheduled: false }
    }

    /// Atomic-ordered store of `callback` — mirrors Zig
    /// `@atomicStore(?*const fn, &this.io_request.callback, cb, .seq_cst)`.
    ///
    /// The io thread reads `callback` after popping `self` from the MPSC
    /// queue (which already provides acquire on `next`); this SeqCst fence
    /// guarantees the callback write is visible to that read even when the
    /// store happens on a different thread than the one that scheduled the
    /// request. Rust has no `AtomicFnPtr`, so we lower to a volatile write
    /// followed by a full fence (matches the existing pattern in
    /// `webcore::blob::{read_file,write_file}`).
    #[inline]
    pub fn store_callback_seq_cst(&mut self, cb: for<'a> fn(&'a mut Request) -> Action<'a>) {
        // SAFETY: `callback` is a plain pointer-sized field on `self`;
        // volatile write prevents the compiler from reordering or eliding it.
        unsafe { core::ptr::write_volatile(&raw mut self.callback, cb) };
        core::sync::atomic::fence(Ordering::SeqCst);
    }
}

impl Default for Request {
    fn default() -> Self {
        // TODO(port): Zig had `next: ?*Request = null, scheduled: bool = false` defaults
        // but `callback` has no default; callers must overwrite `callback`.
        Self { next: AtomicPtr::new(ptr::null_mut()), callback: |_| unreachable!(), scheduled: false }
    }
}

// `bun.UnboundedQueue(Request, .next)` — intrusive MPSC queue keyed on the
// `next` field.
//
// Zig's `Request.next: ?*Request` is a plain optional pointer that the queue
// reads/writes both atomically and non-atomically via `@atomicLoad`/`@field`.
// The Rust port stores it as `AtomicPtr<Request>`; the non-atomic accessor
// paths (`get_next`/`set_next`, used only by the batch iterator and the
// debug-mode `pushBatch` reachability assert) lower to `Relaxed` ops, which is
// no weaker than the original.
// SAFETY: all four accessors touch the same `next` field; `atomic_*` delegate
// to `AtomicPtr` with the requested ordering.
unsafe impl bun_threading::unbounded_queue::Node for Request {
    #[inline]
    unsafe fn get_next(item: *mut Self) -> *mut Self {
        (*item).next.load(Ordering::Relaxed)
    }
    #[inline]
    unsafe fn set_next(item: *mut Self, ptr: *mut Self) {
        (*item).next.store(ptr, Ordering::Relaxed);
    }
    #[inline]
    unsafe fn atomic_load_next(item: *mut Self, ordering: Ordering) -> *mut Self {
        (*item).next.load(ordering)
    }
    #[inline]
    unsafe fn atomic_store_next(item: *mut Self, ptr: *mut Self, ordering: Ordering) {
        (*item).next.store(ptr, ordering);
    }
}

/// Zig: `pub const Queue = bun.UnboundedQueue(Request, .next);`
pub type RequestQueue = bun_threading::UnboundedQueue<Request>;
pub type RequestBatch = bun_threading::unbounded_queue::Batch<Request>;
pub type RequestBatchIter = bun_threading::unbounded_queue::BatchIterator<Request>;

// ─── Action ───────────────────────────────────────────────────────────────────

pub enum Action<'a> {
    Readable(FileAction<'a>),
    Writable(FileAction<'a>),
    Close(CloseAction<'a>),
}

pub struct FileAction<'a> {
    pub fd: Fd,
    pub poll: &'a mut Poll,
    pub ctx: *mut (),
    pub tag: PollableTag,
    pub on_error: fn(*mut (), sys::Error),
}

pub struct CloseAction<'a> {
    pub fd: Fd,
    pub poll: &'a mut Poll,
    pub ctx: *mut (),
    pub tag: PollableTag,
    pub on_done: fn(*mut ()),
}

// ─── Pollable ─────────────────────────────────────────────────────────────────

// TODO(port): repr must match `bun.TaggedPointer.Tag` (15-bit tag in TaggedPtr).
#[repr(u16)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PollableTag {
    Empty = 0,
    ReadFile,
    WriteFile,
}

/// §Dispatch (PORTING.md): `bun.ptr.TaggedPointer` should normally be split
/// into `(tag: u8, ptr: *mut ())`. Here the value must round-trip through a
/// single `u64` (`epoll_event.data.u64` / `kevent.udata`), so we keep the
/// packed addr:49 + tag:15 layout locally.
/// PERF(port): was TaggedPointer pack — load-bearing (kernel-surface u64).
#[derive(Clone, Copy)]
struct Pollable {
    value: u64,
}

const POLLABLE_ADDR_BITS: u64 = 49;
const POLLABLE_ADDR_MASK: u64 = (1u64 << POLLABLE_ADDR_BITS) - 1;

impl Pollable {
    pub(crate) fn init(t: PollableTag, p: *mut Poll) -> Pollable {
        let addr = p as usize as u64;
        debug_assert!(addr & !POLLABLE_ADDR_MASK == 0);
        Pollable { value: (addr & POLLABLE_ADDR_MASK) | ((t as u64) << POLLABLE_ADDR_BITS) }
    }

    pub(crate) fn from(int: u64) -> Pollable {
        Pollable { value: int }
    }

    pub(crate) fn poll(self) -> *mut Poll {
        (self.value & POLLABLE_ADDR_MASK) as usize as *mut Poll
    }

    pub(crate) fn tag(self) -> PollableTag {
        // Tag was written by `init` from a valid `PollableTag` discriminant.
        match (self.value >> POLLABLE_ADDR_BITS) as u16 {
            0 => PollableTag::Empty,
            1 => PollableTag::ReadFile,
            2 => PollableTag::WriteFile,
            // Only `init` writes the tag bits, so any other value is memory
            // corruption / a logic bug — match Zig's safety-checked
            // `@enumFromInt` and trap rather than fabricate a discriminant.
            n => unreachable!("invalid PollableTag {n}"),
        }
    }

    pub(crate) fn ptr(self) -> u64 {
        self.value
    }
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

#[cfg(all(target_os = "macos", debug_assertions))]
type GenerationNumberInt = u64;
#[cfg(not(all(target_os = "macos", debug_assertions)))]
type GenerationNumberInt = (); // Zig: u0

// PORTING.md §Global mutable state: counter → Atomic. Only the IO thread
// touches this, so `Relaxed` matches the Zig non-atomic `+= 1`.
#[cfg(all(target_os = "macos", debug_assertions))]
static GENERATION_NUMBER_MONOTONIC: core::sync::atomic::AtomicU64 =
    core::sync::atomic::AtomicU64::new(0);

pub struct Poll {
    pub flags: FlagsSet,
    #[cfg(all(target_os = "macos", debug_assertions))]
    pub generation_number: GenerationNumberInt,
}

impl Default for Poll {
    fn default() -> Self {
        Self {
            flags: FlagsSet::empty(),
            #[cfg(all(target_os = "macos", debug_assertions))]
            generation_number: 0,
        }
    }
}

pub type Tag = PollableTag;

unsafe extern "Rust" {
    /// Hot-path dispatch for `Pollable` owners. The concrete owners
    /// (`ReadFile` / `WriteFile`) live in `bun_runtime::webcore::blob` (T6);
    /// io (T2) only knows the embedded `*mut Poll` and the tag. The body is
    /// `#[no_mangle]` in `bun_runtime::dispatch` and recovers the parent
    /// struct via `container_of(io_poll)` per spec `io.zig:626`.
    /// PERF(port): was inline switch (cold path — Bun.write / Bun.file().text() only).
    fn __bun_io_pollable_on_ready(tag: PollableTag, poll: *mut Poll);
    fn __bun_io_pollable_on_io_error(tag: PollableTag, poll: *mut Poll, err: sys::Error);
}

#[derive(enumset::EnumSetType)]
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

    // What did the event loop tell us?
    Readable,
    Writable,
    Process,
    Eof,
    Hup,
    Machport,

    // What is the type of file descriptor?
    Fifo,
    Tty,

    OneShot,
    NeedsRearm,

    Closed,

    Nonblocking,

    WasEverRegistered,
    IgnoreUpdates,

    Cancelled,
    Registered,
}

pub type FlagsSet = enumset::EnumSet<Flags>;
// TODO(port): `pub const Struct = std.enums.EnumFieldStruct(Flags, bool, false);` — a struct with
// one `bool` field per variant. Unused in this file; provide if external callers need it.

// PORT NOTE: Zig used a `comptime action: enum` const-generic. `adt_const_params`
// is nightly-only and the body never uses ACTION in a type position — it just
// `match`es on it — so demote to a runtime parameter (PORTING.md §Idiom-map).
// Three call sites, each with a literal variant — trivially inlined; kqueue
// registration is not hot enough for the lost monomorphization to matter.
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
#[derive(PartialEq, Eq, Clone, Copy)]
pub enum ApplyAction {
    Readable,
    Writable,
    Cancel,
}

impl Flags {
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub fn from_kqueue_event(kqueue_event: &KEvent) -> FlagsSet {
        let mut flags = FlagsSet::empty();
        if kqueue_event.filter == libc::EVFILT_READ {
            flags.insert(Flags::Readable);
            log!("readable");
            if kqueue_event.flags & EV_EOF != 0 {
                flags.insert(Flags::Hup);
                log!("hup");
            }
        } else if kqueue_event.filter == libc::EVFILT_WRITE {
            flags.insert(Flags::Writable);
            log!("writable");
            if kqueue_event.flags & EV_EOF != 0 {
                flags.insert(Flags::Hup);
                log!("hup");
            }
        } else if kqueue_event.filter == libc::EVFILT_PROC {
            log!("proc");
            flags.insert(Flags::Process);
        } else {
            #[cfg(target_os = "macos")]
            if kqueue_event.filter == libc::EVFILT_MACHPORT {
                log!("machport");
                flags.insert(Flags::Machport);
            }
        }
        flags
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn from_epoll_event(epoll: linux::epoll_event) -> FlagsSet {
        let mut flags = FlagsSet::empty();
        if epoll.events & linux::EPOLL_IN != 0 {
            flags.insert(Flags::Readable);
            log!("readable");
        }
        if epoll.events & linux::EPOLL_OUT != 0 {
            flags.insert(Flags::Writable);
            log!("writable");
        }
        if epoll.events & linux::EPOLL_ERR != 0 {
            flags.insert(Flags::Eof);
            log!("eof");
        }
        if epoll.events & linux::EPOLL_HUP != 0 {
            flags.insert(Flags::Hup);
            log!("hup");
        }
        flags
    }
}

impl Poll {
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    #[inline]
    pub fn apply_kqueue(
        action: ApplyAction,
        tag: PollableTag,
        poll: &mut Poll,
        fd: Fd,
        kqueue_event: &mut KEvent,
    ) {
        log!(
            "register({}, {})",
            match action {
                ApplyAction::Readable => "readable",
                ApplyAction::Writable => "writable",
                ApplyAction::Cancel => "cancel",
            },
            fd
        );

        let one_shot_flag = libc::EV_ONESHOT;
        let udata: usize = Pollable::init(tag, poll as *mut Poll).ptr() as usize;
        let (filter, flags_): (i16, u16) = match action {
            ApplyAction::Readable => (libc::EVFILT_READ, libc::EV_ADD | one_shot_flag),
            ApplyAction::Writable => (libc::EVFILT_WRITE, libc::EV_ADD | one_shot_flag),
            ApplyAction::Cancel => {
                if poll.flags.contains(Flags::PollReadable) {
                    (libc::EVFILT_READ, libc::EV_DELETE)
                } else if poll.flags.contains(Flags::PollWritable) {
                    (libc::EVFILT_WRITE, libc::EV_DELETE)
                } else {
                    unreachable!()
                }
            }
        };
        // SAFETY: all-zero is a valid KEvent (POD).
        *kqueue_event = unsafe { bun_core::ffi::zeroed() };
        // `ident` is `u64` on Darwin's `kevent64_s`, `usize` on FreeBSD `kevent`.
        // Zig `@intCast` would trap on a negative fd in safe builds — keep that
        // safety net so a stray -1 doesn't silently register ident=u64::MAX.
        debug_assert!(fd.native() >= 0, "register: negative fd {:?}", fd);
        kqueue_event.ident = fd.native() as _;
        kqueue_event.filter = filter;
        kqueue_event.flags = flags_;
        kqueue_event.udata = udata as _;
        // Darwin's kevent64_s.ext[0] carries the generation number for the
        // optional sanity assertion (GenerationNumberInt is u0 elsewhere).
        #[cfg(target_os = "macos")]
        {
            #[cfg(debug_assertions)]
            let gen_: u64 = if action == ApplyAction::Cancel {
                poll.generation_number
            } else {
                GENERATION_NUMBER_MONOTONIC.load(core::sync::atomic::Ordering::Relaxed)
            };
            #[cfg(not(debug_assertions))]
            let gen_: u64 = 0;
            kqueue_event.ext = [gen_, 0];
        }

        // Zig `defer` block — runs after the body above.
        match action {
            ApplyAction::Readable => {
                poll.flags.insert(Flags::PollReadable);
            }
            ApplyAction::Writable => {
                poll.flags.insert(Flags::PollWritable);
            }
            ApplyAction::Cancel => {
                if poll.flags.contains(Flags::PollReadable) {
                    poll.flags.remove(Flags::PollReadable);
                } else if poll.flags.contains(Flags::PollWritable) {
                    poll.flags.remove(Flags::PollWritable);
                } else {
                    unreachable!();
                }
            }
        }

        // The generation-number sanity check rides in kevent64_s.ext[0],
        // which only exists on Darwin (GenerationNumberInt is u0 elsewhere).
        #[cfg(all(target_os = "macos", debug_assertions))]
        if action != ApplyAction::Cancel {
            // Only the IO thread mutates this counter; Relaxed matches Zig's
            // non-atomic `+= 1`.
            poll.generation_number = GENERATION_NUMBER_MONOTONIC
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed)
                + 1;
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn unregister_with_fd(&mut self, watcher_fd: Fd, fd: Fd) {
        // SAFETY: valid fds; null event is allowed for CTL_DEL on Linux ≥ 2.6.9.
        unsafe {
            libc::epoll_ctl(
                watcher_fd.native(),
                linux::EPOLL_CTL_DEL,
                fd.native(),
                core::ptr::null_mut(),
            );
        }
        self.flags.remove(Flags::Registered);
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub fn on_update_kqueue(event: KEvent) {
        #[cfg(target_os = "macos")]
        if event.filter == libc::EVFILT_MACHPORT {
            return;
        }

        let pollable = Pollable::from(event.udata as u64);
        let tag = pollable.tag();
        // The waker is registered with udata=0 → tag=.empty. The wakeup exists
        // only to unblock kevent() so the pending queue drains.
        if tag == PollableTag::Empty {
            return;
        }
        let poll = pollable.poll();
        // CYCLEBREAK: owner (ReadFile/WriteFile) is T6; dispatch via link-time
        // `extern "Rust"` defined in `bun_runtime::dispatch`. The
        // container_of(io_poll) recovery happens there.
        if event.flags == libc::EV_ERROR {
            log!("error({}) = {}", event.ident, event.data);
            // SAFETY: poll is the `io_poll` field of a live owner; link-time
            // extern body matches on `tag`.
            unsafe {
                __bun_io_pollable_on_io_error(
                    tag,
                    poll,
                    // `event.data` is a kernel-supplied errno; do NOT transmute into the
                    // closed `sys::Errno` enum (size mismatch on darwin/freebsd where it
                    // is `#[repr(u16)]`, and UB for unmapped discriminants). Store the
                    // raw integer via `from_code_int` (Zig: `@enumFromInt(event.data)`).
                    sys::Error::from_code_int(event.data as core::ffi::c_int, sys::Tag::kevent),
                )
            };
        } else {
            log!("ready({}) = {}", event.ident, event.data);
            // SAFETY: as above.
            unsafe { __bun_io_pollable_on_ready(tag, poll) };
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn on_update_epoll(poll: *mut Poll, tag: PollableTag, event: linux::epoll_event) {
        // ignore empty tags. This case should be unreachable in practice
        if tag == PollableTag::Empty {
            return;
        }
        // CYCLEBREAK: owner (ReadFile/WriteFile) is T6; dispatch via link-time
        // `extern "Rust"` defined in `bun_runtime::dispatch`. The
        // container_of(io_poll) recovery happens there.
        if event.events & linux::EPOLL_ERR != 0 {
            let errno = sys::get_errno(event.events as isize);
            log!("error() = {:?}", errno);
            // SAFETY: poll is the `io_poll` field of a live owner; link-time
            // extern body matches on `tag`.
            // TODO(b2-blocked): bun_sys::Tag::epoll_ctl
            unsafe { __bun_io_pollable_on_io_error(tag, poll, sys::Error::from_code(errno, sys::Tag::TODO)) };
        } else {
            log!("ready()");
            // SAFETY: as above.
            unsafe { __bun_io_pollable_on_ready(tag, poll) };
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    // PORT NOTE: `flag` was a comptime param in Zig; `enumset::EnumSetType` cannot be a
    // const generic, so it's a runtime arg. The `match` below preserves the exhaustiveness check.
    pub fn register_for_epoll(
        &mut self,
        flag: Flags,
        tag: PollableTag,
        watcher_fd: Fd,
        one_shot: bool,
        fd: Fd,
    ) -> sys::Result<()> {
        log!("register: {:?} ({})", flag as u8, fd);

        debug_assert!(fd != Fd::INVALID);

        if one_shot {
            self.flags.insert(Flags::OneShot);
        }

        let one_shot_flag: u32 = if !self.flags.contains(Flags::OneShot) {
            0
        } else {
            linux::EPOLL_ONESHOT
        };

        // "flag" is comptime to make sure we always check
        let flags: u32 = match flag {
            Flags::Process | Flags::PollReadable => {
                linux::EPOLL_IN | linux::EPOLL_HUP | linux::EPOLL_ERR | one_shot_flag
            }
            Flags::PollWritable => {
                linux::EPOLL_OUT | linux::EPOLL_HUP | linux::EPOLL_ERR | one_shot_flag
            }
            _ => unreachable!(),
        };

        let mut event = linux::epoll_event {
            events: flags,
            u64: Pollable::init(tag, std::ptr::from_mut::<Poll>(self)).ptr(),
        };

        let op: i32 = if self.flags.contains(Flags::WasEverRegistered)
            || self.flags.contains(Flags::NeedsRearm)
        {
            linux::EPOLL_CTL_MOD
        } else {
            linux::EPOLL_CTL_ADD
        };

        // SAFETY: valid fds + event pointer.
        let ctl = unsafe {
            libc::epoll_ctl(watcher_fd.native(), op as c_int, fd.native(), &raw mut event)
        };

        let errno = sys::get_errno(ctl);
        if errno != E::SUCCESS {
            // TODO(b2-blocked): bun_sys::Tag::epoll_ctl
            return Err(sys::Error::from_code(errno, sys::Tag::TODO));
        }
        // Only mark if it successfully registered.
        // If it failed to register, we don't want to unregister it later if
        // it never had done so in the first place.
        self.flags.insert(Flags::Registered);
        self.flags.insert(Flags::WasEverRegistered);

        self.flags.insert(match flag {
            Flags::PollReadable => Flags::PollReadable,
            Flags::PollProcess => {
                if cfg!(target_os = "linux") {
                    Flags::PollReadable
                } else {
                    Flags::PollProcess
                }
            }
            Flags::PollWritable => Flags::PollWritable,
            _ => unreachable!(),
        });
        self.flags.remove(Flags::NeedsRearm);

        Ok(())
    }
}

pub const RETRY: E = E::EAGAIN;

use crate::posix_event_loop::{Flags as PollFlags, FlagsSet as PollFlagsSet, OneShotFlag};

pub type EventLoopHandle = EventLoopCtx;

pub type FilePollFlag = PollFlags;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FilePollKind {
    Readable,
    Writable,
}

/// Non-null handle into the event loop's `Store` hive. Slot is released by
/// `deinit_force_unregister` (returns to pool), never `Drop`. Method bodies
/// dereference into the hive — `unsafe` because nothing stops a caller holding
/// a `FilePollRef` past `deinit_force_unregister`; a generational-index
/// `Store::get(ref) -> Option<&mut FilePoll>` is the safe follow-up.
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct FilePollRef(pub core::ptr::NonNull<FilePoll>);

impl FilePollRef {
    #[inline]
    pub fn init(ev: EventLoopHandle, fd: Fd, owner: Owner) -> FilePollRef {
        // SAFETY: `FilePoll::init` returns a fresh hive slot; never null.
        FilePollRef(unsafe {
            core::ptr::NonNull::new_unchecked(FilePoll::init(ev, fd, PollFlagsSet::empty(), owner))
        })
    }
    /// SAFETY: caller must not hold another live `&mut` to this slot (the event
    /// loop is single-threaded, so the only hazard is re-entrancy through a
    /// poll callback that touches the same slot).
    #[inline]
    pub unsafe fn get(self) -> &'static mut FilePoll {
        unsafe { &mut *self.0.as_ptr() }
    }
    #[inline]
    pub fn as_ptr(self) -> *mut FilePoll { self.0.as_ptr() }
    #[inline]
    pub fn fd(self) -> Fd { unsafe { self.get() }.fd }
    #[inline]
    pub fn set_owner(self, owner: Owner) { unsafe { self.get() }.owner = owner; }
    #[inline]
    pub fn deinit_force_unregister(self) { unsafe { self.get() }.deinit_force_unregister(); }
    #[inline]
    pub fn unregister(self, loop_: *mut bun_uws_sys::Loop, force: bool) -> sys::Result<()> {
        #[cfg(not(windows))]
        { unsafe { self.get().unregister(&mut *loop_, force) } }
        #[cfg(windows)]
        {
            let _ = force;
            if unsafe { self.get().unregister(&mut *loop_) } {
                Ok(())
            } else {
                Err(sys::Error::from_code(sys::E::INVAL, sys::Tag::TODO))
            }
        }
    }
    #[inline]
    pub fn register_with_fd(
        self,
        loop_: *mut bun_uws_sys::Loop,
        kind: FilePollKind,
        fd: Fd,
    ) -> sys::Result<()> {
        let flag = match kind {
            FilePollKind::Readable => PollFlags::Readable,
            FilePollKind::Writable => PollFlags::Writable,
        };
        #[cfg(not(windows))]
        { unsafe { self.get().register_with_fd(&mut *loop_, flag, OneShotFlag::Dispatch, fd) } }
        #[cfg(windows)]
        {
            let _ = (loop_, flag, fd);
            unreachable!("FilePoll fd registration is POSIX-only");
        }
    }
    #[inline]
    pub fn has_flag(self, f: FilePollFlag) -> bool { unsafe { self.get() }.flags.contains(f) }
    #[inline]
    pub fn set_flag(self, f: FilePollFlag) { unsafe { self.get() }.flags.insert(f); }
    #[inline]
    pub fn file_type(self) -> crate::pipes::FileType {
        #[cfg(not(windows))]
        { unsafe { self.get() }.file_type() }
        #[cfg(windows)]
        { crate::pipes::FileType::File }
    }
    #[inline]
    pub fn is_registered(self) -> bool { unsafe { self.get() }.is_registered() }
    #[inline]
    pub fn is_watching(self) -> bool { unsafe { self.get() }.is_watching() }
    #[inline]
    pub fn is_active(self) -> bool { unsafe { self.get() }.is_active() }
    #[inline]
    pub fn can_enable_keeping_process_alive(self) -> bool {
        #[cfg(not(windows))]
        { unsafe { self.get() }.can_enable_keeping_process_alive() }
        #[cfg(windows)]
        { unsafe { !self.get().flags.contains(PollFlags::Closed) && self.get().can_ref() } }
    }
    #[inline]
    pub fn enable_keeping_process_alive(self, ev: EventLoopHandle) {
        unsafe { self.get() }.enable_keeping_process_alive(ev);
    }
    #[inline]
    pub fn disable_keeping_process_alive(self, ev: EventLoopHandle) {
        unsafe { self.get() }.disable_keeping_process_alive(ev);
    }
    #[inline]
    pub fn set_keeping_process_alive(self, ev: EventLoopHandle, value: bool) {
        if value { self.enable_keeping_process_alive(ev) } else { self.disable_keeping_process_alive(ev) }
    }
}

/// Moved from `bun_runtime::webcore::PathOrFileDescriptor`.
/// Owned here so `open_for_writing` has no upward dep; runtime re-exports it.
pub enum PathOrFileDescriptor {
    Path(bun_string::PathString),
    Fd(Fd),
}

// ─── Waker (moved from bun_io) ──────────────────────────────────────────────
//
// Ported from src/aio/posix_event_loop.zig:1272-1384 (LinuxWaker / KEventWaker)
// and src/aio/windows_event_loop.zig:361-383 (Windows Waker). io (T2) owns the
// Waker so `Loop::load` has no upward dep on bun_io (T3). bun_io re-exports.

pub mod waker {
    use bun_sys::Fd;

    #[cfg(target_os = "macos")]
    pub type Waker = KEventWaker;
    /// FreeBSD 13+ has eventfd(2), so the Linux waker works as-is.
    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    pub type Waker = LinuxWaker;
    #[cfg(windows)]
    pub type Waker = WindowsWaker;

    // ── Linux / FreeBSD ───────────────────────────────────────────────────────

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    pub struct LinuxWaker {
        pub fd: Fd,
    }

    #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
    impl LinuxWaker {
        /// Stand-in until `init()` runs (e.g. a `BundleThread` allocated before
        /// its real waker is created). `Fd::INVALID` is sentinel-only; never
        /// poll/wake through it.
        pub const fn placeholder() -> Self {
            Self { fd: Fd::INVALID }
        }

        pub fn init() -> Result<Self, bun_core::Error> {
            // TODO(port): std.posix.eventfd(0, 0) → bun_sys::eventfd. Phase B
            // should confirm bun_sys exposes the wrapper; falls back to libc.
            // SAFETY: direct syscall wrapper.
            let raw = unsafe { libc::eventfd(0, 0) };
            if raw < 0 {
                return Err(bun_core::Error::from_errno(bun_sys::last_errno()));
            }
            Ok(Self::init_with_file_descriptor(Fd::from_native(raw)))
        }

        #[inline]
        pub fn get_fd(&self) -> Fd {
            self.fd
        }

        #[inline]
        pub fn init_with_file_descriptor(fd: Fd) -> Self {
            Self { fd }
        }

        pub fn wait(&self) {
            // eventfd reads are always exactly 8 bytes (u64 counter). Use a u64
            // directly instead of type-punning through usize, which would be UB
            // on any 32-bit target and needs no `&mut *raw` reborrow here.
            let mut bytes: u64 = 0;
            // SAFETY: valid fd; `bytes` is an 8-byte buffer; result intentionally discarded.
            let _ = unsafe { libc::read(self.fd.native(), (&raw mut bytes).cast(), 8) };
        }

        pub fn wake(&self) {
            // eventfd writes are always exactly 8 bytes (u64 increment).
            let bytes: u64 = 1;
            // SAFETY: valid fd; `bytes` is an 8-byte buffer; result intentionally discarded.
            let _ = unsafe { libc::write(self.fd.native(), (&raw const bytes).cast(), 8) };
        }
    }

    // ── macOS (kqueue + machport) ─────────────────────────────────────────────

    #[cfg(target_os = "macos")]
    use core::ffi::{c_int, c_void};

    #[cfg(target_os = "macos")]
    pub struct KEventWaker {
        pub kq: i32,
        pub machport: bun_core::mach_port,
        pub machport_buf: Box<[u8]>,
        pub has_pending_wake: bool,
    }

    #[cfg(target_os = "macos")]
    type Kevent64 = libc::kevent64_s;

    #[cfg(target_os = "macos")]
    unsafe extern "C" {
        // Defined in src/io/io_darwin.cpp.
        fn io_darwin_close_machport(port: bun_core::mach_port);
        fn io_darwin_create_machport(
            kq: i32,
            buf: *mut c_void,
            len: usize,
        ) -> bun_core::mach_port;
        fn io_darwin_schedule_wakeup(port: bun_core::mach_port) -> bool;
    }

    #[cfg(target_os = "macos")]
    impl KEventWaker {
        // SAFETY: all-zero is a valid kevent64_s array (POD).
        const ZEROED: [Kevent64; 16] = unsafe { bun_core::ffi::zeroed() };

        /// Stand-in until `init()` runs. To be overwritten via `ptr::write`
        /// (no `Drop` of the empty `machport_buf` is required, but dropping
        /// it is also harmless).
        pub fn placeholder() -> Self {
            Self { kq: -1, machport: 0, machport_buf: Box::default(), has_pending_wake: false }
        }

        pub fn wake(&mut self) {
            // SAFETY: FFI call with a valid mach_port created in init.
            if unsafe { io_darwin_schedule_wakeup(self.machport) } {
                self.has_pending_wake = false;
                return;
            }
            self.has_pending_wake = true;
        }

        #[inline]
        pub fn get_fd(&self) -> Fd {
            Fd::from_native(self.kq)
        }

        pub fn wait(&self) {
            if !Fd::from_native(self.kq).is_valid() {
                return;
            }
            let mut events = Self::ZEROED;
            // SAFETY: FFI syscall; pointers reference a stack-local array valid for the call.
            unsafe {
                libc::kevent64(
                    self.kq,
                    events.as_ptr(),
                    0,
                    events.as_mut_ptr(),
                    c_int::try_from(events.len()).expect("int cast"),
                    0,
                    core::ptr::null(),
                );
            }
        }

        pub fn init() -> Result<Self, bun_core::Error> {
            // SAFETY: direct syscall wrapper.
            let kq = unsafe { libc::kqueue() };
            if kq < 0 {
                return Err(bun_core::Error::from_errno(bun_errno::posix::errno()));
            }
            Self::init_with_file_descriptor(kq)
        }

        pub fn init_with_file_descriptor(kq: i32) -> Result<Self, bun_core::Error> {
            debug_assert!(kq > -1);
            // PERF(port): Zig used bun.default_allocator.alloc(u8, 1024); Box<[u8]>
            // owns the buffer for the machport's lifetime.
            let mut machport_buf = vec![0u8; 1024].into_boxed_slice();
            // SAFETY: FFI call; buf outlives the machport (owned by the returned Waker).
            let machport = unsafe {
                io_darwin_create_machport(kq, machport_buf.as_mut_ptr().cast::<c_void>(), 1024)
            };
            if machport == 0 {
                return Err(bun_core::err!("MachportCreationFailed"));
            }
            Ok(Self { kq, machport, machport_buf, has_pending_wake: false })
        }
    }

    // ── Windows (uws WindowsLoop wakeup) ──────────────────────────────────────

    #[cfg(windows)]
    pub struct WindowsWaker {
        pub loop_: *mut bun_uws_sys::WindowsLoop,
    }

    #[cfg(windows)]
    impl WindowsWaker {
        pub fn init() -> Result<Self, bun_core::Error> {
            Ok(Self { loop_: bun_uws_sys::WindowsLoop::get() })
        }

        // TODO(port): Zig used @compileError; on Windows these must never be linked.
        #[allow(unused)]
        pub fn get_fd(&self) -> Fd {
            unreachable!("Waker.getFd is unsupported on Windows");
        }

        // TODO(port): Zig used @compileError; on Windows these must never be linked.
        #[allow(unused)]
        pub fn init_with_file_descriptor(_fd: Fd) -> Self {
            unreachable!("Waker.initWithFileDescriptor is unsupported on Windows");
        }

        pub fn wait(&self) {
            // SAFETY: loop_ is the process-global WindowsLoop singleton.
            unsafe { (*self.loop_).wait() };
        }

        pub fn wake(&self) {
            // SAFETY: loop_ is the process-global WindowsLoop singleton.
            unsafe { (*self.loop_).wakeup() };
        }
    }
}

// ─── Closer (moved from bun_io) ─────────────────────────────────────────────
//
// Ported from src/aio/posix_event_loop.zig:1386-1406 and
// src/aio/windows_event_loop.zig:385-411. Schedules an async fd close on the
// thread pool (POSIX) or via uv_fs_close (Windows). io (T2) owns it so
// `pipes::PollOrFd::close` has no upward dep on bun_io (T3).

pub mod closer {
    use bun_sys::Fd;

    // ── POSIX ────────────────────────────────────────────────────────────────

    #[cfg(not(windows))]
    use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

    #[cfg(not(windows))]
    #[repr(C)]
    pub struct Closer {
        pub fd: Fd,
        task: WorkPoolTask,
    }

    // SAFETY: `TASK_OFFSET` is `offset_of!(Closer, task)`; `task_mut` returns
    // that same field. `Closer` is `Send` (`Fd` + intrusive `Task`).
    #[cfg(not(windows))]
    unsafe impl bun_threading::work_pool::OwnedTask for Closer {
        const TASK_OFFSET: usize = core::mem::offset_of!(Closer, task);
        fn task_mut(&mut self) -> &mut WorkPoolTask { &mut self.task }
        fn run(self: Box<Self>) {
            use bun_sys::FdExt;
            self.fd.close();
        }
    }

    #[cfg(not(windows))]
    impl Closer {
        /// `_compat`: for signature compatibility with the Windows version.
        pub fn close(fd: Fd, _compat: ()) {
            debug_assert!(fd.is_valid());
            WorkPool::schedule_owned(Box::new(Closer {
                fd,
                task: WorkPoolTask {
                    node: Default::default(),
                    callback: <Self as bun_threading::work_pool::OwnedTask>::__callback,
                },
            }));
        }
    }

    // ── Windows ──────────────────────────────────────────────────────────────

    #[cfg(windows)]
    use bun_sys::windows::libuv as uv;
    #[cfg(windows)]
    use core::ffi::c_void;

    #[cfg(windows)]
    #[repr(C)]
    pub struct Closer {
        io_request: uv::fs_t,
    }

    #[cfg(windows)]
    impl Closer {
        pub fn close(fd: Fd, loop_: *mut uv::Loop) {
            // SAFETY: all-zero is a valid uv::fs_t (libuv C struct, zero-init by convention).
            let io_request: uv::fs_t = unsafe { bun_core::ffi::zeroed() };
            let closer = bun_core::heap::into_raw(Box::new(Closer { io_request }));
            // data is not overridden by libuv when calling uv_fs_close, its ok to set it here
            // SAFETY: closer is a freshly-boxed valid pointer.
            unsafe {
                (*closer).io_request.data = closer.cast::<c_void>();
                if let Some(err) = uv::uv_fs_close(
                    loop_,
                    &mut (*closer).io_request,
                    fd.uv(),
                    Some(Self::on_close),
                )
                .err_enum()
                {
                    bun_core::Output::debug_warn(format_args!("libuv close() failed = {}", err));
                    drop(bun_core::heap::take(closer));
                }
            }
        }

        extern "C" fn on_close(req: *mut uv::fs_t) {
            // SAFETY: req points to Closer.io_request (set in `close` above);
            // recover the parent via offset_of.
            let closer: *mut Closer = unsafe {
                bun_core::from_field_ptr!(Closer, io_request, req)
            };
            // SAFETY: req.data was set to `closer` in `close`; both valid for the callback.
            unsafe {
                debug_assert!(closer == (*req).data.cast::<Closer>());
                bun_sys::syslog!(
                    "uv_fs_close({}) = {}",
                    // SAFETY: `uv_fs_close` populated the `fd` arm of the union.
                    Fd::from_uv((*req).file_fd()),
                    (*req).result
                );

                #[cfg(debug_assertions)]
                if let Some(err) = (*closer).io_request.result.err_enum() {
                    bun_core::Output::debug_warn(format_args!(
                        "libuv close() failed = {}",
                        err
                    ));
                }

                (*req).deinit();
                drop(bun_core::heap::take(closer));
            }
        }
    }
}

// ported from: src/io/io.zig
