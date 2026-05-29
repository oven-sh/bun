//! Confusingly, this is the barely used epoll/kqueue event loop
//! This is only used by Bun.write() and Bun.file(path).text() & friends.
//!
//! Most I/O happens on the main thread.

#![allow(unsafe_op_in_unsafe_fn)]
// ── submodules ──────────────────────────────────────────────────────────────

pub mod stub_event_loop;

#[cfg(windows)]
pub mod windows_event_loop;

mod keep_alive;
pub mod posix_event_loop;
pub use keep_alive::KeepAlive;

#[cfg(not(windows))]
#[path = "ParentDeathWatchdog.rs"]
pub mod parent_death_watchdog;
#[cfg(windows)]
pub mod parent_death_watchdog {
    use crate::posix_event_loop::EventLoopCtx;
    /// Unit struct — `FilePoll.Owner` dispatch needs a real pointee type.
    pub struct ParentDeathWatchdog;
    pub const EXIT_CODE: u8 = 128 + 1;
    #[inline]
    pub fn is_enabled() -> bool {
        false
    }
    #[inline]
    pub fn install() {}
    #[inline]
    pub fn enable() {}
    #[inline]
    pub fn install_on_event_loop(_handle: EventLoopCtx) {}
    #[inline]
    pub fn on_parent_exit(_this: &mut ParentDeathWatchdog) {
        debug_assert!(false, "ParentDeathWatchdog poll on Windows");
    }
}
pub use parent_death_watchdog as ParentDeathWatchdog;

// ─── public surface (was bun_io's crate root) ──────────────────────────────

#[cfg(not(windows))]
pub use posix_event_loop::{FilePoll, Loop};
#[cfg(windows)]
pub use windows_event_loop::{FilePoll, Loop};

#[inline]
pub fn uws_to_native(uws: *mut bun_uws_sys::Loop) -> *mut Loop {
    #[cfg(not(windows))]
    {
        uws
    }
    #[cfg(windows)]
    // SAFETY: `uws` is the live `us_loop` allocated by `us_create_loop`;
    // `uv_loop` is initialised in C before any Rust caller can observe the
    // handle and is never mutated.
    {
        unsafe { (*uws).uv_loop }
    }
}

pub use posix_event_loop::{AllocatorType, Owner, PollTag, get_vm_ctx, js_vm_ctx};

pub type OpaqueCallback = unsafe extern "C" fn(*mut core::ffi::c_void);

bun_dispatch::link_interface! {
    pub EventLoopCtx[Js, Mini] {
        fn platform_event_loop_ptr() -> *mut bun_uws_sys::Loop;
        fn file_polls_ptr() -> *mut Store;
        fn increment_pending_unref_counter();
        fn ref_concurrently();
        fn unref_concurrently();
        fn after_event_loop_callback() -> Option<OpaqueCallback>;
        fn set_after_event_loop_callback(
            cb: Option<OpaqueCallback>,
            ctx: Option<core::ptr::NonNull<core::ffi::c_void>>,
        );
        fn pipe_read_buffer() -> *mut [u8];
    }
}

pub type EventLoopKind = EventLoopCtxKind;

impl EventLoopCtx {
    /// SAFETY: caller must not hold another live `&mut` to the same loop
    /// across this borrow (resolver-style accessor; the loop is per-thread).
    #[inline]
    pub unsafe fn platform_event_loop(&self) -> &'static mut bun_uws_sys::Loop {
        // Route through the single nonnull-asref accessor below; the `unsafe`
        // on this fn's signature is the caller-side aliasing contract — the
        // body itself needs no extra `unsafe`.
        self.loop_mut()
    }
    /// SAFETY: same aliasing hazard as [`platform_event_loop`].
    #[inline]
    pub unsafe fn file_polls(&self) -> &'static mut Store {
        self.file_polls_mut()
    }

    #[inline]
    pub(crate) fn loop_mut(&self) -> &'static mut bun_uws_sys::Loop {
        // SAFETY: per-thread set-once pointer (the uws loop singleton); the
        // event loop is single-threaded so no concurrent `&mut` exists, and
        // every crate-internal caller is a leaf op that drops the borrow
        // before returning — see block comment above.
        unsafe { &mut *self.platform_event_loop_ptr() }
    }
    #[inline]
    pub(crate) fn file_polls_mut(&self) -> &'static mut Store {
        // SAFETY: per-thread set-once pointer (`BackRef`-shaped); the event
        // loop is single-threaded so no concurrent `&mut Store` exists, and
        // every crate-internal caller upholds the leaf-op / decayed-slot
        // discipline above — see block comment.
        unsafe { &mut *self.file_polls_ptr() }
    }
    #[inline]
    pub(crate) fn pipe_read_buffer_mut(&self) -> &'static mut [u8] {
        // SAFETY: per-thread set-once scratch buffer (`BackRef`-shaped); the
        // event loop is single-threaded so this is the sole live `&mut`, and
        // every crate-internal caller drops the borrow before any path that
        // could re-derive it — see doc comment above.
        unsafe { &mut *self.pipe_read_buffer() }
    }
    #[inline]
    pub fn loop_ref(&self) {
        self.loop_mut().ref_();
    }
    #[inline]
    pub fn loop_unref(&self) {
        self.loop_mut().unref();
    }
    #[inline]
    pub fn loop_inc(&self) {
        self.loop_mut().inc();
    }
    #[inline]
    pub fn loop_dec(&self) {
        self.loop_mut().dec();
    }
    #[inline]
    pub fn loop_add_active(&self, n: u32) {
        self.loop_mut().add_active(n);
    }
    #[inline]
    pub fn loop_sub_active(&self, n: u32) {
        self.loop_mut().sub_active(n);
    }
    #[cfg(not(windows))]
    #[inline]
    pub fn alloc_file_poll(&self, value: FilePoll) -> core::ptr::NonNull<FilePoll> {
        self.file_polls_mut().get_init(value)
    }

    #[inline]
    pub fn is_js(&self) -> bool {
        self.is(EventLoopCtxKind::Js)
    }
    #[inline]
    pub fn loop_(&self) -> *mut bun_uws_sys::Loop {
        self.platform_event_loop_ptr()
    }
    /// Platform-native loop pointer (`us_loop_t*` / `uv_loop_t*`); see
    /// [`uws_to_native`].
    #[inline]
    pub fn native_loop(&self) -> *mut Loop {
        uws_to_native(self.platform_event_loop_ptr())
    }
    #[inline]
    pub fn init(h: EventLoopCtx) -> EventLoopCtx {
        h
    }
    #[inline]
    pub fn as_event_loop_ctx(self) -> EventLoopCtx {
        self
    }
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
    pub use super::FilePoll;
    pub use super::Store;
    pub use super::posix_event_loop::{Flags, Flags as Flag, FlagsSet};
    /// Kqueue/epoll watch kind passed to `FilePoll::register`.
    #[allow(dead_code)]
    pub(crate) type Pollable = Flags;
}

// ── bun_io original submodules ──────────────────────────────────────────────

#[path = "heap.rs"]
pub mod heap;
// `source.rs` is Windows-only (libuv pipe/tty/file wrappers). On POSIX the
// `Source` type is never constructed; callers are themselves `#[cfg(windows)]`.
// TODO(port): bun_sys::windows::libuv — verify compiles on Windows in CI.
#[path = "MaxBuf.rs"]
pub mod max_buf;
#[path = "openForWriting.rs"]
pub mod open_for_writing_mod;
#[path = "PipeReader.rs"]
pub mod pipe_reader;
#[path = "PipeWriter.rs"]
pub mod pipe_writer;
#[path = "pipes.rs"]
pub mod pipes;
#[cfg(windows)]
#[path = "source.rs"]
pub mod source;
#[path = "write.rs"]
pub mod write;

pub use bun_core::fmt::SliceCursor;
pub use write::{
    AsFmt, BufWriter, DiscardingWriter, FixedBufferStream, FmtAdapter, IntBe, IntLe, Result, Write,
};

pub use max_buf as MaxBuf;
pub use pipes::{FileType, ReadState};

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

#[macro_export]
macro_rules! impl_buffered_reader_parent {
    // Single-lifetime generic: trait impl over `<'lt>`, link registered at `'static`.
    (
        $variant:ident for $T:ident<$lt:lifetime>;
        $($rest:tt)*
    ) => {
        $crate::buffered_reader_parent_link!($variant for $T<'static>);
        $crate::__impl_buffered_reader_parent_body! { [$lt] [$T<$lt>] $variant; $($rest)* }
    };
    // Non-generic.
    (
        $variant:ident for $T:ty;
        $($rest:tt)*
    ) => {
        $crate::buffered_reader_parent_link!($variant for $T);
        $crate::__impl_buffered_reader_parent_body! { [] [$T] $variant; $($rest)* }
    };
}

#[doc(hidden)]
#[macro_export]
macro_rules! __impl_buffered_reader_parent_body {
    (
        [$($lt:lifetime)?] [$T:ty] $variant:ident;
        has_on_read_chunk = $has:expr;
        $( on_read_chunk = |$rc_this:ident, $rc_chunk:ident, $rc_more:ident| $rc:expr; )?
        on_reader_done = |$rd_this:ident| $rd:expr;
        on_reader_error = |$re_this:ident, $re_err:ident| $re:expr;
        loop_ = |$l_this:ident| $lp:expr;
        event_loop = |$e_this:ident| $ev:expr;
        $( on_max_buffer_overflow = |$mb_this:ident, $mb_buf:ident| $mb:block; )?
    ) => {
        // SAFETY (all generated methods): see `BufferedReaderParent` aliasing
        // contract — `this` is the `*mut Self` registered via `set_parent`; a
        // `&mut` to the embedded reader may be live on the caller's stack.
        impl $(<$lt>)? $crate::pipe_reader::BufferedReaderParent for $T {
            const KIND: $crate::BufferedReaderParentLinkKind =
                $crate::BufferedReaderParentLinkKind::$variant;
            const HAS_ON_READ_CHUNK: bool = $has;
            $(
                #[allow(unused_unsafe, clippy::macro_metavars_in_unsafe)]
                unsafe fn on_read_chunk(
                    $rc_this: *mut Self,
                    $rc_chunk: &[u8],
                    $rc_more: $crate::ReadState,
                ) -> bool {
                    unsafe { $rc }
                }
            )?
            #[allow(unused_unsafe, clippy::macro_metavars_in_unsafe)]
            unsafe fn on_reader_done($rd_this: *mut Self) {
                unsafe { $rd }
            }
            #[allow(unused_unsafe, clippy::macro_metavars_in_unsafe)]
            unsafe fn on_reader_error($re_this: *mut Self, $re_err: $crate::__bun_sys::Error) {
                unsafe { $re }
            }
            #[allow(unused_unsafe, clippy::macro_metavars_in_unsafe)]
            unsafe fn loop_($l_this: *mut Self) -> *mut $crate::pipe_reader::Loop {
                unsafe { $lp }
            }
            #[allow(unused_unsafe, clippy::macro_metavars_in_unsafe)]
            unsafe fn event_loop($e_this: *mut Self) -> $crate::EventLoopHandle {
                unsafe { $ev }
            }
            $(
                #[allow(unused_unsafe, clippy::macro_metavars_in_unsafe)]
                unsafe fn on_max_buffer_overflow(
                    $mb_this: *mut Self,
                    $mb_buf: ::core::ptr::NonNull<$crate::max_buf::MaxBuf>,
                ) {
                    unsafe { $mb }
                }
            )?
        }
    };
}

#[doc(hidden)]
pub use bun_sys as __bun_sys;

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

// Stub for never-constructed-on-POSIX `Source` so cross-platform sigs
// (`Option<Source>`) typecheck.
#[cfg(not(windows))]
pub enum Source {}

pub use pipe_reader::{BufferedReader, BufferedReaderParent, PosixFlags};
/// Downstream alias (Zig: `bun.io.BufferedReader` is sometimes referenced as
/// `PipeReader`).
pub type PipeReader = BufferedReader;

pub use open_for_writing_mod::{open_for_writing, open_for_writing_impl};

// ════════════════════════════════════════════════════════════════════════════

#[cfg(not(windows))]
use core::ffi::c_int;
use core::sync::atomic::Ordering;

pub use crate::closer::Closer;
pub use crate::waker::Waker;
use bun_sys::{self as sys, E, Fd};

// Zig scope name is `.loop` (io.zig:11). `loop` is a Rust keyword, so the static is
// named `io_loop` but the runtime tagname is `"loop"` so `BUN_DEBUG_loop=1` works.
#[allow(non_upper_case_globals)]
#[allow(dead_code)]
pub(crate) static io_loop: bun_core::output::ScopedLogger =
    bun_core::output::ScopedLogger::new("loop", bun_core::output::Visibility::Visible);
// All `log!` call sites are inside epoll/kqueue paths (Linux/macOS/FreeBSD); on
// Windows the IoRequestLoop is `panic!`-stubbed, so gate the macro to match.
#[cfg(not(windows))]
bun_core::define_scoped_log!(log, io_loop); // hand-declared static above (tagname "loop" is a keyword)

#[cfg(windows)]
mod windows_ffi {
    // Bun C++ shim over `QueryPerformanceCounter` (src/bun.js/bindings/
    // c-bindings.cpp). Zig io.zig:314 declares it inline in `Loop`.
    unsafe extern "C" {
        // safe: out-params are `&mut i64` (non-null, valid for write); C++ side
        // only writes the slots and returns a status code — no preconditions.
        pub(super) safe fn clock_gettime_monotonic(
            sec: &mut i64,
            nsec: &mut i64,
        ) -> core::ffi::c_int;
    }
}

#[cfg(unix)]
mod safe_c {
    use core::ffi::c_int;
    unsafe extern "C" {
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        pub(super) safe fn kqueue() -> c_int;
        #[cfg(any(target_os = "linux", target_os = "android"))]
        pub(super) safe fn epoll_create1(flags: c_int) -> c_int;
        #[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
        pub(super) safe fn eventfd(initval: libc::c_uint, flags: c_int) -> c_int;
        // Out-param `tp` is `&mut timespec` (non-null, valid for write); libc
        // only writes the slot and reports failure via the return value —
        // bad `clk_id` → `EINVAL`, never UB.
        pub(super) safe fn clock_gettime(clk_id: libc::clockid_t, tp: &mut libc::timespec)
        -> c_int;
    }
}

// ─── platform type aliases ────────────────────────────────────────────────────

/// `bun_sys::linux` doesn't exist yet; use `libc` constants directly.
/// TODO(port): bun_sys::linux — replace with that module once available.
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

    pub cached_now: core::cell::Cell<libc::timespec>,
    pub active: core::cell::Cell<usize>,
}

static LOOP: bun_core::ThreadCell<core::mem::MaybeUninit<IoRequestLoop>> =
    bun_core::ThreadCell::new(core::mem::MaybeUninit::uninit());
#[cfg(not(windows))]
static ONCE: std::sync::OnceLock<()> = std::sync::OnceLock::new();

impl IoRequestLoop {
    #[cfg(not(windows))]
    fn load() {
        // SAFETY: called exactly once via `ONCE.get_or_init`; no other access
        // until this returns. `get_unchecked` because this runs on the
        // *spawning* thread, before the IO thread `claim()`s the cell.
        let loop_ = unsafe { (*LOOP.get_unchecked()).assume_init_mut() };
        *loop_ = IoRequestLoop {
            pending: RequestQueue::default(),
            waker: Waker::init().unwrap_or_else(|_| panic!("failed to initialize waker")),
            #[cfg(any(target_os = "linux", target_os = "android"))]
            epoll_fd: Fd::INVALID,
            #[cfg(target_os = "freebsd")]
            kqueue_fd: Fd::INVALID,
            cached_now: core::cell::Cell::new(libc::timespec {
                tv_sec: 0,
                tv_nsec: 0,
            }),
            active: core::cell::Cell::new(0),
        };

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let raw = safe_c::epoll_create1(libc::EPOLL_CLOEXEC);
            if raw < 0 {
                panic!("Failed to create epoll file descriptor");
            }
            loop_.epoll_fd = Fd::from_native(raw);
            // TODO(port): Zig used `std.posix.epoll_create1` which already error-checks; here we
            // only panic on negative, matching semantics.

            {
                // SAFETY: all-zero is a valid epoll_event (POD).
                let mut epoll: linux::epoll_event = bun_core::ffi::zeroed();
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
                    err => {
                        bun_core::Output::panic(format_args!("Failed to wait on epoll {:?}", err))
                    }
                }
            }
        }

        #[cfg(target_os = "freebsd")]
        {
            let kq = safe_c::kqueue();
            if kq < 0 {
                panic!("Failed to create kqueue");
            }
            loop_.kqueue_fd = Fd::from_native(kq);
            // Register the eventfd waker. udata = 0 → Pollable.tag() == .empty,
            // which onUpdateKQueue treats as a no-op (the wakeup just unblocks
            // the kevent() wait so the pending queue gets drained). EV_CLEAR
            // makes it edge-triggered so we never need to read() the eventfd.
            // SAFETY: all-zero is a valid kevent (POD).
            let mut change: KEvent = bun_core::ffi::zeroed();
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

    fn ensure_init() {
        #[cfg(windows)]
        {
            panic!("Do not use this API on windows");
        }
        #[cfg(not(windows))]
        {
            ONCE.get_or_init(|| {
                Self::load();
            });
        }
    }

    pub fn on_spawn_io_thread() {
        // From here on, only this thread may borrow `IoRequestLoop`;
        // `ThreadCell` enforces that in debug builds.
        LOOP.claim();
        // SAFETY: `ONCE` guarantees `LOOP` is initialized before this thread
        // is spawned (the spawn in `load()` is sequenced after the store, and
        // `OnceLock` provides the cross-thread happens-before). We take a
        // *shared* `&IoRequestLoop` — never `&mut` — because `schedule()` on
        // other threads concurrently touches `pending`/`waker` through a
        // sibling raw pointer derived from `LOOP.get_unchecked()`. A `&mut`
        // here would assert `noalias` over those bytes for the process
        // lifetime (tick never returns), which is UB under Stacked Borrows
        // regardless of the queue's internal atomics. All IO-thread-mutable
        // state lives behind `Cell` so `&self` suffices; thread-confinement
        // of those `Cell`s is debug-asserted by `ThreadCell::get()` above.
        unsafe { (*LOOP.get()).assume_init_ref() }.tick();
    }

    pub fn schedule(request: &mut Request) {
        Self::ensure_init();
        debug_assert!(!request.scheduled);
        request.scheduled = true;
        let request = core::ptr::NonNull::from(request);
        // SAFETY: `ONCE` above established happens-before for `load()`'s
        // init of `pending`/`waker`. We use `get_unchecked` (no owner assert)
        // and stay in raw-ptr land via `addr_of_mut!` so we never materialize
        // a `&mut IoRequestLoop` that would alias the IO thread's `tick()`
        // borrow. `pending.push` takes `&self` (lock-free MPSC); `waker.wake`
        // is async-signal-safe by design.
        unsafe {
            let loop_p = (*LOOP.get_unchecked()).as_mut_ptr();
            (*core::ptr::addr_of!((*loop_p).pending)).push(request);
            (*core::ptr::addr_of_mut!((*loop_p).waker)).wake();
        }
    }

    pub fn tick(&self) {
        // SAFETY: literal is NUL-terminated; len excludes the NUL.
        let name = bun_core::ZStr::from_static(b"IO Watcher\0");
        bun_core::Output::Source::configure_named_thread(name);

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            self.tick_epoll();
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            self.tick_kqueue();
        }
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        )))]
        {
            panic!("TODO on this platform");
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn tick_epoll(&self) {
        self.update_now();

        loop {
            // Process pending requests
            {
                let mut pending = self.pending.pop_batch().iterator();
                let watcher_fd = self.pollfd();

                loop {
                    let request_ptr = pending.next();
                    if request_ptr.is_null() {
                        break;
                    }
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
                                    (readable.on_error)(readable.ctx, &err);
                                }
                                Ok(()) => {
                                    self.active.set(self.active.get() + 1);
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
                                    (writable.on_error)(writable.ctx, &err);
                                }
                                Ok(()) => {
                                    self.active.set(self.active.get() + 1);
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
                                self.active.set(self.active.get() - 1);
                            }
                            (close.on_done)(close.ctx);
                        }
                    }
                }
            }

            // Zero-initialised (`epoll_event: Zeroable`) so the post-wait
            // `&events[..rc]` is a safe slice into an initialised array.
            let mut events: [EventType; 256] = [bun_core::ffi::zeroed(); 256];

            // SAFETY: valid epoll fd; events buffer length matches.
            let rc = unsafe {
                libc::epoll_wait(
                    self.pollfd().native(),
                    events.as_mut_ptr(),
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

            let current_events = &events[..rc as usize];
            if rc != 0 {
                log!("epoll_wait({}) = {}", self.pollfd(), rc);
            }

            for event in current_events {
                let pollable = Pollable::from(event.u64);
                if pollable.tag() == PollableTag::Empty {
                    if event.u64 == core::ptr::from_ref(self) as usize as u64 {
                        // Edge-triggered: no need to read the eventfd counter
                        continue;
                    }
                }
                // `pollable.poll()` is the `io_poll` field pointer this loop
                // registered via `register_for_epoll`; the owner is live and
                // non-null (the kernel hands back the udata we registered).
                let Some(poll) = core::ptr::NonNull::new(pollable.poll()) else {
                    continue;
                };
                Poll::on_update_epoll(poll, pollable.tag(), *event);
            }
        }
    }

    #[cfg(not(windows))]
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

    #[cfg(not(windows))]
    pub fn fd(&self) -> Fd {
        self.waker.get_fd()
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub fn tick_kqueue(&self) {
        self.update_now();

        loop {
            // PERF(port): was StackFallbackAllocator(256*sizeof(EventType)) — profile if it shows up on a hot path.
            let mut events_list: Vec<EventType> = Vec::with_capacity(256);

            // Process pending requests
            {
                let mut pending = self.pending.pop_batch().iterator();
                events_list.reserve(pending.batch.count);
                // Zig: `addOneAssumeCapacity`. `reserve` above ⇒ no realloc; apply_kqueue
                // fully overwrites the slot so the zero is a safe placeholder.
                #[inline(always)]
                fn add_one(list: &mut Vec<EventType>) -> &mut EventType {
                    debug_assert!(list.len() < list.capacity());
                    list.push(bun_core::ffi::zeroed());
                    list.last_mut().unwrap()
                }

                loop {
                    let request_ptr = pending.next();
                    if request_ptr.is_null() {
                        break;
                    }
                    // SAFETY: pop_batch yields live nodes pushed by `schedule()`.
                    let request = unsafe { &mut *request_ptr };
                    request.scheduled = false;
                    match (request.callback)(request) {
                        Action::Readable(readable) => {
                            Poll::apply_kqueue(
                                ApplyAction::Readable,
                                readable.tag,
                                readable.poll,
                                readable.fd,
                                add_one(&mut events_list),
                            );
                        }
                        Action::Writable(writable) => {
                            Poll::apply_kqueue(
                                ApplyAction::Writable,
                                writable.tag,
                                writable.poll,
                                writable.fd,
                                add_one(&mut events_list),
                            );
                        }
                        Action::Close(close) => {
                            if close.poll.flags.contains(Flags::PollReadable)
                                || close.poll.flags.contains(Flags::PollWritable)
                            {
                                Poll::apply_kqueue(
                                    ApplyAction::Cancel,
                                    close.tag,
                                    close.poll,
                                    close.fd,
                                    add_one(&mut events_list),
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
            // SAFETY: kernel wrote `rc_len` valid `KEvent`s into the Vec's
            // capacity (passed as `nevents` above); `rc_len <= capacity`.
            unsafe { events_list.set_len(rc_len) };

            for event in &events_list {
                Poll::on_update_kqueue(*event);
            }
        }
    }

    #[cfg(not(windows))]
    fn update_now(&self) {
        let mut ts = self.cached_now.get();
        Self::update_timespec(&mut ts);
        self.cached_now.set(ts);
    }

    // PORT NOTE: Zig nests the `extern "c" fn clock_gettime_monotonic` decl
    // inside the `Loop` namespace (io.zig:314); Rust forbids `extern` blocks
    // inside `impl`, so it's hoisted to `windows_ffi` at module scope.

    pub fn update_timespec(timespec: &mut libc::timespec) {
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            let rc = safe_c::clock_gettime(libc::CLOCK_MONOTONIC, timespec);
            debug_assert!(rc == 0);
        }
        #[cfg(windows)]
        {
            // `clock_gettime_monotonic` is a Bun C++ shim (src/bun.js/bindings/
            // c-bindings.cpp) over `QueryPerformanceCounter`; declared at module
            // scope in `windows_ffi` since `extern` blocks can't live in `impl`.
            let mut sec: i64 = 0;
            let mut nsec: i64 = 0;
            let rc = windows_ffi::clock_gettime_monotonic(&mut sec, &mut nsec);
            debug_assert!(rc == 0);
            timespec.tv_sec = sec.try_into().expect("infallible: size matches");
            timespec.tv_nsec = nsec.try_into().expect("infallible: size matches");
        }
        #[cfg(not(any(target_os = "linux", target_os = "android", windows)))]
        {
            let rc = safe_c::clock_gettime(libc::CLOCK_MONOTONIC, timespec);
            if rc != 0 {
                return;
            }
        }
    }
}

// ─── Request ──────────────────────────────────────────────────────────────────

pub struct Request {
    pub next: bun_threading::Link<Request>,
    pub callback: for<'a> fn(&'a mut Request) -> Action<'a>,
    pub scheduled: bool,
}

impl Request {
    #[inline]
    pub fn new(callback: for<'a> fn(&'a mut Request) -> Action<'a>) -> Self {
        Self {
            next: bun_threading::Link::new(),
            callback,
            scheduled: false,
        }
    }

    #[inline]
    pub fn store_callback_seq_cst(&mut self, cb: for<'a> fn(&'a mut Request) -> Action<'a>) {
        // SAFETY: `callback` is a plain pointer-sized field on `self`;
        // volatile write prevents the compiler from reordering or eliding it.
        unsafe { core::ptr::write_volatile(&raw mut self.callback, cb) };
        core::sync::atomic::fence(Ordering::SeqCst);
    }
}

/// A type that embeds an intrusive `io_request: `[`Request`] field. Declares the
/// byte offset once and provides the canonical container-of recovery used by
/// every `fn(&mut Request) -> Action` io-loop trampoline (the Rust equivalent of
/// Zig's per-site `@fieldParentPtr("io_request", req)`).
///
/// Implement via [`intrusive_io_request!`].
///
/// # Safety
/// `IO_REQUEST_OFFSET` MUST equal `core::mem::offset_of!(Self, <io_request
/// field>)`. [`from_io_request`](IntrusiveIoRequest::from_io_request) casts
/// through the offset; a mismatch is UB.
pub unsafe trait IntrusiveIoRequest: Sized {
    /// `core::mem::offset_of!(Self, io_request)`.
    const IO_REQUEST_OFFSET: usize;

    /// Recover `*mut Self` from a `*mut Request` pointing at `self.io_request`
    /// — the single canonical `container_of` for every io-loop trampoline.
    ///
    /// # Safety
    /// `req` must point to the [`Request`] field at `Self::IO_REQUEST_OFFSET`
    /// inside a live `Self` allocation that was scheduled via that field, and
    /// the pointer's provenance must cover the whole allocation.
    #[inline(always)]
    unsafe fn from_io_request(req: *mut Request) -> *mut Self {
        // SAFETY: caller upholds the trait safety contract above.
        unsafe { bun_core::container_of::<Self, _>(req, Self::IO_REQUEST_OFFSET) }
    }
}

#[macro_export]
macro_rules! intrusive_io_request {
    ($ty:ty, $field:ident) => {
        // SAFETY: `IO_REQUEST_OFFSET` is `offset_of!($ty, $field)`.
        unsafe impl $crate::IntrusiveIoRequest for $ty {
            const IO_REQUEST_OFFSET: usize = ::core::mem::offset_of!($ty, $field);
        }
    };
}

/// Windows analogue of [`IntrusiveIoRequest`] for types that embed an
/// intrusive `io_request: uv::fs_t` and recover the parent in
/// `extern "C" fn(*mut uv::fs_t)` libuv callbacks.
///
/// Implement via [`intrusive_uv_fs!`].
///
/// # Safety
/// `UV_FS_OFFSET` MUST equal `core::mem::offset_of!(Self, <io_request field>)`.
#[cfg(windows)]
pub unsafe trait IntrusiveUvFs: Sized {
    /// `core::mem::offset_of!(Self, io_request)`.
    const UV_FS_OFFSET: usize;

    /// Recover `*mut Self` from the `*mut uv::fs_t` libuv passes back.
    ///
    /// # Safety
    /// `req` must point to the `fs_t` field at `Self::UV_FS_OFFSET` inside a
    /// live `Self` allocation, and the pointer's provenance must cover the
    /// whole allocation.
    #[inline(always)]
    unsafe fn from_uv_fs(req: *mut bun_sys::windows::libuv::fs_t) -> *mut Self {
        // SAFETY: caller upholds the trait safety contract above.
        unsafe { bun_core::container_of::<Self, _>(req, Self::UV_FS_OFFSET) }
    }
}

/// Implements [`IntrusiveUvFs`] for a struct that embeds an intrusive
/// `io_request: uv::fs_t` field.
#[cfg(windows)]
#[macro_export]
macro_rules! intrusive_uv_fs {
    ($ty:ty, $field:ident) => {
        // SAFETY: `UV_FS_OFFSET` is `offset_of!($ty, $field)`.
        unsafe impl $crate::IntrusiveUvFs for $ty {
            const UV_FS_OFFSET: usize = ::core::mem::offset_of!($ty, $field);
        }
    };
}

impl Default for Request {
    fn default() -> Self {
        // TODO(port): Zig had `next: ?*Request = null, scheduled: bool = false` defaults
        // but `callback` has no default; callers must overwrite `callback`.
        Self {
            next: bun_threading::Link::new(),
            callback: |_| unreachable!(),
            scheduled: false,
        }
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
// SAFETY: `next` is the sole intrusive link for `UnboundedQueue(Request, .next)`.
unsafe impl bun_threading::Linked for Request {
    #[inline]
    unsafe fn link(item: *mut Self) -> *const bun_threading::Link<Self> {
        // SAFETY: `item` is valid and properly aligned per `UnboundedQueue` contract.
        unsafe { core::ptr::addr_of!((*item).next) }
    }
}

/// Zig: `pub const Queue = bun.UnboundedQueue(Request, .next);`
pub(crate) type RequestQueue = bun_threading::UnboundedQueue<Request>;

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
    pub on_error: fn(*mut (), &sys::Error),
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

#[cfg(not(windows))]
#[derive(Clone, Copy)]
struct Pollable {
    value: u64,
}

#[cfg(not(windows))]
const POLLABLE_ADDR_BITS: u64 = 49;
#[cfg(not(windows))]
const POLLABLE_ADDR_MASK: u64 = (1u64 << POLLABLE_ADDR_BITS) - 1;

#[cfg(not(windows))]
impl Pollable {
    pub(crate) fn init(t: PollableTag, p: *mut Poll) -> Pollable {
        let addr = p as usize as u64;
        debug_assert!(addr & !POLLABLE_ADDR_MASK == 0);
        Pollable {
            value: (addr & POLLABLE_ADDR_MASK) | ((t as u64) << POLLABLE_ADDR_BITS),
        }
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
    fn __bun_io_pollable_on_ready(tag: PollableTag, poll: *mut Poll);
    fn __bun_io_pollable_on_io_error(tag: PollableTag, poll: *mut Poll, err: &sys::Error);
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
        let udata: usize = Pollable::init(tag, std::ptr::from_mut::<Poll>(poll)).ptr() as usize;
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
        *kqueue_event = bun_core::ffi::zeroed();
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
            poll.generation_number =
                GENERATION_NUMBER_MONOTONIC.fetch_add(1, core::sync::atomic::Ordering::Relaxed) + 1;
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
                    &sys::Error::from_code_int(event.data as core::ffi::c_int, sys::Tag::kevent),
                )
            };
        } else {
            log!("ready({}) = {}", event.ident, event.data);
            // SAFETY: as above.
            unsafe { __bun_io_pollable_on_ready(tag, poll) };
        }
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn on_update_epoll(
        poll: core::ptr::NonNull<Poll>,
        tag: PollableTag,
        event: linux::epoll_event,
    ) {
        // ignore empty tags. This case should be unreachable in practice
        if tag == PollableTag::Empty {
            return;
        }
        let poll = poll.as_ptr();
        // CYCLEBREAK: owner (ReadFile/WriteFile) is T6; dispatch via link-time
        // `extern "Rust"` defined in `bun_runtime::dispatch`. The
        // container_of(io_poll) recovery happens there.
        if event.events & linux::EPOLL_ERR != 0 {
            let errno = sys::get_errno(event.events as isize);
            log!("error() = {:?}", errno);
            // SAFETY: poll is the `io_poll` field of a live owner; link-time
            // extern body matches on `tag`.
            // TODO(port): bun_sys::Tag::epoll_ctl
            unsafe {
                __bun_io_pollable_on_io_error(
                    tag,
                    poll,
                    &sys::Error::from_code(errno, sys::Tag::TODO),
                )
            };
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
            libc::epoll_ctl(
                watcher_fd.native(),
                op as c_int,
                fd.native(),
                &raw mut event,
            )
        };

        let errno = sys::get_errno(ctl);
        if errno != E::SUCCESS {
            // TODO(port): bun_sys::Tag::epoll_ctl
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
                // PORT NOTE: Zig's `Environment.isLinux` is true on Android too.
                if cfg!(any(target_os = "linux", target_os = "android")) {
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

#[cfg(not(windows))]
use crate::posix_event_loop::OneShotFlag;
use crate::posix_event_loop::{Flags as PollFlags, FlagsSet as PollFlagsSet};

pub type EventLoopHandle = EventLoopCtx;

pub type FilePollFlag = PollFlags;

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FilePollKind {
    Readable,
    Writable,
}

#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct FilePollRef(pub core::ptr::NonNull<FilePoll>);

impl FilePollRef {
    #[inline]
    pub fn init(ev: EventLoopHandle, fd: Fd, owner: Owner) -> FilePollRef {
        FilePollRef(
            core::ptr::NonNull::new(FilePoll::init(ev, fd, PollFlagsSet::empty(), owner))
                .expect("FilePoll::init returns a fresh hive slot"),
        )
    }
    #[inline]
    fn inner(self) -> &'static mut FilePoll {
        // SAFETY: type invariant — see doc comment above.
        unsafe { &mut *self.0.as_ptr() }
    }
    /// SAFETY: caller must not hold another live `&mut` to this slot (the event
    /// loop is single-threaded, so the only hazard is re-entrancy through a
    /// poll callback that touches the same slot).
    #[inline]
    pub unsafe fn get(self) -> &'static mut FilePoll {
        self.inner()
    }
    #[inline]
    pub fn as_ptr(self) -> *mut FilePoll {
        self.0.as_ptr()
    }
    #[inline]
    pub fn fd(self) -> Fd {
        self.inner().fd
    }
    #[inline]
    pub fn set_owner(self, owner: Owner) {
        self.inner().owner = owner;
    }
    #[inline]
    pub fn deinit_force_unregister(self) {
        self.inner().deinit_force_unregister();
    }
    #[inline(always)]
    fn uws_loop_mut<'a>(loop_: *mut bun_uws_sys::Loop) -> &'a mut bun_uws_sys::Loop {
        debug_assert!(!loop_.is_null());
        // SAFETY: type invariant — see doc comment above.
        unsafe { &mut *loop_ }
    }
    #[inline]
    pub fn unregister(self, loop_: *mut bun_uws_sys::Loop, force: bool) -> sys::Result<()> {
        let loop_ = Self::uws_loop_mut(loop_);
        #[cfg(not(windows))]
        {
            self.inner().unregister(loop_, force)
        }
        #[cfg(windows)]
        {
            let _ = force;
            if self.inner().unregister(loop_) {
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
        {
            self.inner().register_with_fd(
                Self::uws_loop_mut(loop_),
                flag,
                OneShotFlag::Dispatch,
                fd,
            )
        }
        #[cfg(windows)]
        {
            let _ = (loop_, flag, fd);
            unreachable!("FilePoll fd registration is POSIX-only");
        }
    }
    #[inline]
    pub fn has_flag(self, f: FilePollFlag) -> bool {
        self.inner().flags.contains(f)
    }
    #[inline]
    pub fn set_flag(self, f: FilePollFlag) {
        self.inner().flags.insert(f);
    }
    #[inline]
    pub fn file_type(self) -> crate::pipes::FileType {
        #[cfg(not(windows))]
        {
            self.inner().file_type()
        }
        #[cfg(windows)]
        {
            crate::pipes::FileType::File
        }
    }
    #[inline]
    pub fn is_registered(self) -> bool {
        self.inner().is_registered()
    }
    #[inline]
    pub fn is_watching(self) -> bool {
        self.inner().is_watching()
    }
    #[inline]
    pub fn is_active(self) -> bool {
        self.inner().is_active()
    }
    #[inline]
    pub fn can_enable_keeping_process_alive(self) -> bool {
        #[cfg(not(windows))]
        {
            self.inner().can_enable_keeping_process_alive()
        }
        #[cfg(windows)]
        {
            unreachable!("FilePoll::canEnableKeepingProcessAlive is POSIX-only")
        }
    }
    #[inline]
    pub fn enable_keeping_process_alive(self, ev: EventLoopHandle) {
        self.inner().enable_keeping_process_alive(ev);
    }
    #[inline]
    pub fn disable_keeping_process_alive(self, ev: EventLoopHandle) {
        self.inner().disable_keeping_process_alive(ev);
    }
    #[inline]
    pub fn set_keeping_process_alive(self, ev: EventLoopHandle, value: bool) {
        if value {
            self.enable_keeping_process_alive(ev)
        } else {
            self.disable_keeping_process_alive(ev)
        }
    }
}

/// Moved from `bun_runtime::webcore::PathOrFileDescriptor`.
/// Owned here so `open_for_writing` has no upward dep; runtime re-exports it.
pub enum PathOrFileDescriptor {
    Path(bun_core::PathString),
    Fd(Fd),
}

pub mod waker {
    #[cfg(not(windows))]
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
        #[allow(dead_code)]
        pub const fn placeholder() -> Self {
            Self { fd: Fd::INVALID }
        }

        pub fn init() -> Result<Self, bun_core::Error> {
            // TODO(port): migrate to bun_sys::eventfd (the wrapper exists);
            // currently falls back to crate::safe_c::eventfd.
            let raw = crate::safe_c::eventfd(0, 0);
            if raw < 0 {
                return Err(bun_core::Error::from_errno(bun_sys::last_errno()));
            }
            Ok(Self::init_with_file_descriptor(Fd::from_native(raw)))
        }

        #[inline]
        pub(crate) fn get_fd(&self) -> Fd {
            self.fd
        }

        #[inline]
        pub(crate) fn init_with_file_descriptor(fd: Fd) -> Self {
            Self { fd }
        }

        #[allow(dead_code)]
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
        // Defined in src/io/io_darwin.cpp. `mach_port` is a by-value `u32`;
        // bad/dead ports are reported by mach return codes, not UB.
        fn io_darwin_create_machport(kq: i32, buf: *mut c_void, len: usize) -> bun_core::mach_port;
        safe fn io_darwin_schedule_wakeup(port: bun_core::mach_port) -> bool;
    }

    #[cfg(target_os = "macos")]
    impl KEventWaker {
        // SAFETY: all-zero is a valid kevent64_s array (POD).
        const ZEROED: [Kevent64; 16] = bun_core::ffi::zeroed();

        /// Stand-in until `init()` runs. To be overwritten via `ptr::write`
        /// (no `Drop` of the empty `machport_buf` is required, but dropping
        /// it is also harmless).
        pub fn placeholder() -> Self {
            Self {
                kq: -1,
                machport: 0,
                machport_buf: Box::default(),
                has_pending_wake: false,
            }
        }

        pub fn wake(&mut self) {
            if io_darwin_schedule_wakeup(self.machport) {
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
            let kq = crate::safe_c::kqueue();
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
            Ok(Self {
                kq,
                machport,
                machport_buf,
                has_pending_wake: false,
            })
        }
    }

    // ── Windows (uws WindowsLoop wakeup) ──────────────────────────────────────

    #[cfg(windows)]
    pub struct WindowsWaker {
        pub loop_: Option<bun_ptr::BackRef<bun_uws_sys::WindowsLoop>>,
    }

    #[cfg(windows)]
    impl WindowsWaker {
        #[allow(dead_code)]
        pub const fn placeholder() -> Self {
            Self { loop_: None }
        }

        #[allow(dead_code)]
        pub fn init() -> Result<Self, bun_core::Error> {
            Ok(Self {
                loop_: Some(bun_ptr::BackRef::from(
                    core::ptr::NonNull::new(bun_uws_sys::WindowsLoop::get())
                        .expect("WindowsLoop::get() singleton"),
                )),
            })
        }

        /// Unwrap the back-reference. Panics on a `placeholder()` waker, which
        /// is the same precondition the previous raw-pointer deref carried
        /// (just loud instead of UB).
        #[inline]
        fn loop_ref(&self) -> bun_ptr::BackRef<bun_uws_sys::WindowsLoop> {
            self.loop_.expect("WindowsWaker used before init()")
        }

        #[allow(dead_code)]
        pub fn wait(&self) {
            // Do NOT route through `WindowsLoop::wait(&mut self)`: that would
            // materialize a `&mut WindowsLoop` over the process-global
            // singleton for the entire duration of `us_loop_run`/`uv_run`,
            // and a concurrent `wake()` from a worker thread (BundleThread,
            // HTTPThread) would alias it — two live `&mut T` to one
            // allocation is UB under Stacked/Tree Borrows. Call the C entry
            // point with the raw pointer directly so no Rust reference is
            // ever formed.
            // SAFETY: `loop_` is the live `WindowsLoop::get()` singleton,
            // non-null after `init()`.
            unsafe { bun_uws_sys::loop_::us_loop_run(self.loop_ref().as_ptr()) };
        }

        pub fn wake(&self) {
            // See `wait()` — this is the cross-thread wake path; forming a
            // `&mut WindowsLoop` here would alias the event-loop thread's
            // borrow held across `us_loop_run`. Pass the raw pointer to the
            // thread-safe C wake (`uv_async_send`) instead.
            // SAFETY: `loop_` is the live `WindowsLoop::get()` singleton;
            // `us_wakeup_loop` → `uv_async_send` is documented thread-safe.
            unsafe { bun_uws_sys::loop_::us_wakeup_loop(self.loop_ref().as_ptr()) };
        }

        #[inline]
        #[allow(dead_code)]
        pub fn uv_loop(&self) -> *mut bun_sys::windows::libuv::Loop {
            // `BackRef` deref is safe (process-lifetime singleton); `uv_loop`
            // is a `Copy` field set once by C `us_create_loop`.
            self.loop_ref().uv_loop
        }
    }
}

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

    #[cfg(not(windows))]
    bun_threading::intrusive_work_task!(Closer, task);
    // SAFETY: `Closer` is `Send` (`Fd` + intrusive `Task`).
    #[cfg(not(windows))]
    unsafe impl bun_threading::work_pool::OwnedTask for Closer {
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
    use crate::IntrusiveUvFs as _;
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
    crate::intrusive_uv_fs!(Closer, io_request);

    #[cfg(windows)]
    impl Closer {
        pub fn close(fd: Fd, loop_: *mut uv::Loop) {
            let io_request: uv::fs_t = bun_core::ffi::zeroed();
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
            // SAFETY: req points to Closer.io_request (set in `close` above).
            let closer: *mut Closer = unsafe { Closer::from_uv_fs(req) };
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
                    bun_core::Output::debug_warn(format_args!("libuv close() failed = {}", err));
                }

                (*req).deinit();
                drop(bun_core::heap::take(closer));
            }
        }
    }
}

// ported from: src/io/io.zig
