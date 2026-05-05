//! Confusingly, this is the barely used epoll/kqueue event loop
//! This is only used by Bun.write() and Bun.file(path).text() & friends.
//!
//! Most I/O happens on the main thread.

// ════════════════════════════════════════════════════════════════════════════
// B-1 GATE-AND-STUB SURFACE
// Phase-A draft bodies are preserved verbatim below inside
// `#[cfg(any())] mod __phase_a_draft { ... }` and in the `#[cfg(any())]`-gated
// `#[path]` submodules. Un-gating happens in B-2.
// ════════════════════════════════════════════════════════════════════════════

#![allow(dead_code, unused_variables, unused_imports)]

// ── gated submodules (Phase-A drafts, not yet compiling) ────────────────────
#[cfg(any())]
#[path = "heap.rs"]
pub mod heap;
#[cfg(any())]
#[path = "source.rs"]
pub mod source;
#[cfg(any())]
#[path = "pipes.rs"]
pub mod pipes;
#[cfg(any())]
#[path = "PipeReader.rs"]
pub mod pipe_reader;
#[cfg(any())]
#[path = "PipeWriter.rs"]
pub mod pipe_writer;
#[cfg(any())]
#[path = "openForWriting.rs"]
pub mod open_for_writing_mod;
#[cfg(any())]
#[path = "MaxBuf.rs"]
pub mod max_buf;

// ── minimal stub surface ────────────────────────────────────────────────────
// Opaque newtypes / `todo!()` fns. Higher tiers that need richer shapes will
// surface as errors there and get added incrementally.

use core::ffi::c_void;

/// TODO(b1): bun_collections::TaggedPtr missing from lower-tier stub surface.
#[allow(non_camel_case_types)]
type __TaggedPtr = u64;

pub struct Loop;
impl Loop {
    pub fn get() -> &'static mut Loop { todo!("B-2: Loop::get") }
    pub fn schedule(&mut self, _r: &mut Request) { todo!("B-2: Loop::schedule") }
}

#[derive(Default)]
pub struct Request {
    pub next: Option<core::ptr::NonNull<Request>>,
    pub scheduled: bool,
}

pub enum Action<'a> {
    Readable(&'a mut Poll),
    Writable(&'a mut Poll),
    Close(&'a mut Poll),
}

#[derive(Default)]
pub struct Poll;

#[repr(u16)]
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum PollableTag { Empty = 0, ReadFile, WriteFile }
pub type Tag = PollableTag;

pub struct Flags;
pub type FlagsSet = u32;

pub struct Waker;
impl Waker {
    pub fn init() -> Result<Self, ()> { todo!("B-2: Waker::init") }
    pub fn wake(&self) { todo!("B-2: Waker::wake") }
    pub fn wait(&self) { todo!("B-2: Waker::wait") }
}

pub struct Closer;

#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct EventLoopHandle(pub *mut c_void);
impl EventLoopHandle {
    #[inline] pub fn init(h: EventLoopHandle) -> EventLoopHandle { h }
    #[inline] pub fn loop_(self) -> *mut c_void { todo!("B-2: EventLoopHandle::loop_") }
}

pub type FilePollPtr = *mut c_void;
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct FilePoll(pub FilePollPtr);

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FilePollFlag { PollWritable, Nonblocking, Hup, WasEverRegistered }

#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FilePollKind { Readable, Writable }

pub struct FilePollVTable;
pub struct PollOwnerVTable;

pub enum PathOrFileDescriptor {
    Path(()),  // TODO(b1): bun_str::PathString missing
    Fd(()),    // TODO(b1): bun_sys::Fd shape
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum FileType { Pipe, Tty, File, Socket, Nonblocking }

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum ReadState { Progress, Done, Err, Drained }

pub struct Source;
pub struct BufferedReader;
pub struct PipeReader;
pub struct BufferedWriter;
pub struct StreamBuffer;
pub struct StreamingWriter;
pub struct WriteResult;
#[derive(Clone, Copy, PartialEq, Eq)]
pub enum WriteStatus { Pending, Done, EndOfFile, Drained }

pub mod heap_stub {
    pub struct IntrusiveHeap;
}
pub use heap_stub as heap;

#[allow(non_snake_case)]
pub mod MaxBuf {
    pub const VALUE: usize = 0;
}

pub fn open_for_writing() -> ! { todo!("B-2: open_for_writing") }
pub fn open_for_writing_impl() -> ! { todo!("B-2: open_for_writing_impl") }

// TODO(b1): bun_sys::Errno surface — RETRY constant deferred to B-2.

// ════════════════════════════════════════════════════════════════════════════
// Phase-A draft (gated; preserved verbatim modulo syntax-only fixes)
// ════════════════════════════════════════════════════════════════════════════
#[cfg(any())]
mod __phase_a_draft {

use core::ffi::{c_int, c_void};
use core::mem::offset_of;
use core::ptr::NonNull;
use core::sync::atomic::{AtomicPtr, Ordering};

// CYCLEBREAK(MOVE_DOWN): `Waker` moved from bun_aio (T3) into io (T2). See
// the `crate::waker` module body below.
use crate::waker::Waker;
use bun_collections::TaggedPtr;
use bun_sys::{self as sys, Fd};

pub use crate::heap;
pub use crate::open_for_writing::{open_for_writing, open_for_writing_impl};
pub use crate::source::Source;

// TODO(port): Zig scope name was `.loop`, which is a Rust keyword. Using `io_loop` here;
// Phase B should ensure `BUN_DEBUG_loop=1` still maps to this scope.
bun_output::declare_scope!(io_loop, visible);
macro_rules! log {
    ($($args:tt)*) => { bun_output::scoped_log!(io_loop, $($args)*) };
}

// ─── platform type aliases ────────────────────────────────────────────────────

#[cfg(target_os = "linux")]
use bun_sys::linux;

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

#[cfg(target_os = "linux")]
type EventType = linux::epoll_event;
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
type EventType = KEvent;

// ─── Loop ─────────────────────────────────────────────────────────────────────

pub struct Loop {
    pub pending: RequestQueue,
    pub waker: Waker,
    #[cfg(target_os = "linux")]
    pub epoll_fd: Fd,
    /// FreeBSD's `Waker` is `LinuxWaker` (an eventfd), so unlike macOS the
    /// waker fd is NOT itself a kqueue. We create one here and register the
    /// eventfd on it, mirroring how Linux registers the eventfd on epoll_fd.
    #[cfg(target_os = "freebsd")]
    pub kqueue_fd: Fd,

    pub cached_now: libc::timespec,
    pub active: usize,
}

// TODO(port): `static mut` singleton matching Zig's `var loop: Loop = undefined;` +
// `std.once(load)`. Phase B may want `OnceLock<UnsafeCell<Loop>>` instead, but the
// IO thread mutates fields concurrently with `schedule()` callers (which only touch
// the lock-free `pending` queue + `waker`), so a plain `static mut` mirrors the Zig.
static mut LOOP: core::mem::MaybeUninit<Loop> = core::mem::MaybeUninit::uninit();
static ONCE: std::sync::Once = std::sync::Once::new();

impl Loop {
    fn load() {
        // SAFETY: called exactly once via `ONCE.call_once`; no other access until this returns.
        let loop_ = unsafe { &mut *LOOP.as_mut_ptr() };
        *loop_ = Loop {
            pending: RequestQueue::default(),
            waker: Waker::init().unwrap_or_else(|_| panic!("failed to initialize waker")),
            #[cfg(target_os = "linux")]
            epoll_fd: Fd::INVALID,
            #[cfg(target_os = "freebsd")]
            kqueue_fd: Fd::INVALID,
            cached_now: libc::timespec { tv_sec: 0, tv_nsec: 0 },
            active: 0,
        };

        #[cfg(target_os = "linux")]
        {
            // SAFETY: direct syscall wrapper.
            loop_.epoll_fd = Fd::from_native(
                unsafe { libc::epoll_create1(libc::EPOLL_CLOEXEC | 0) }
                    .try_into()
                    .unwrap_or_else(|_| panic!("Failed to create epoll file descriptor")),
            );
            // TODO(port): Zig used `std.posix.epoll_create1` which already error-checks; here we
            // only panic on negative, matching semantics.

            {
                // SAFETY: all-zero is a valid epoll_event (POD).
                let mut epoll: linux::epoll_event = unsafe { core::mem::zeroed() };
                epoll.events =
                    linux::EPOLL_IN | linux::EPOLL_ET | linux::EPOLL_ERR | linux::EPOLL_HUP;
                epoll.data.ptr = loop_ as *mut Loop as usize;
                // SAFETY: valid epoll fd + waker fd just created.
                let rc = unsafe {
                    libc::epoll_ctl(
                        loop_.epoll_fd.cast(),
                        linux::EPOLL_CTL_ADD,
                        loop_.waker.get_fd().cast(),
                        &mut epoll,
                    )
                };
                match sys::get_errno(rc as isize) {
                    sys::Errno::SUCCESS => {}
                    err => bun_core::Output::panic(format_args!(
                        "Failed to wait on epoll {}",
                        <&'static str>::from(err)
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
            let mut change: KEvent = unsafe { core::mem::zeroed() };
            change.ident = usize::try_from(loop_.waker.get_fd().cast()).unwrap();
            change.filter = libc::EVFILT_READ;
            change.flags = libc::EV_ADD | libc::EV_CLEAR;
            // SAFETY: valid kqueue fd just created; passing 1 change, 0 events.
            let rc = unsafe {
                libc::kevent(
                    loop_.kqueue_fd.cast(),
                    &change as *const KEvent,
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

    pub fn get() -> &'static mut Loop {
        #[cfg(windows)]
        {
            panic!("Do not use this API on windows");
        }

        ONCE.call_once(Self::load);

        // SAFETY: LOOP initialized by `load()` exactly once above; callers uphold the
        // Zig invariant that only the IO thread mutates non-atomic fields and other
        // threads only call `schedule()` (lock-free queue + waker).
        unsafe { &mut *LOOP.as_mut_ptr() }
    }

    pub fn on_spawn_io_thread() {
        // SAFETY: ONCE guarantees LOOP is initialized before this thread is spawned.
        unsafe { &mut *LOOP.as_mut_ptr() }.tick();
    }

    pub fn schedule(&mut self, request: &mut Request) {
        debug_assert!(!request.scheduled);
        request.scheduled = true;
        self.pending.push(request);
        self.waker.wake();
    }

    pub fn tick(&mut self) {
        bun_core::Output::Source::configure_named_thread("IO Watcher");

        #[cfg(target_os = "linux")]
        {
            self.tick_epoll();
        }
        #[cfg(any(target_os = "macos", target_os = "freebsd"))]
        {
            self.tick_kqueue();
        }
        #[cfg(not(any(target_os = "linux", target_os = "macos", target_os = "freebsd")))]
        {
            panic!("TODO on this platform");
        }
    }

    #[cfg(target_os = "linux")]
    pub fn tick_epoll(&mut self) {
        self.update_now();

        loop {
            // Process pending requests
            {
                let mut pending_batch = self.pending.pop_batch();
                let mut pending = pending_batch.iterator();

                while let Some(request) = pending.next() {
                    request.scheduled = false;
                    match (request.callback)(request) {
                        Action::Readable(readable) => {
                            match readable.poll.register_for_epoll::<{ Flags::PollReadable }>(
                                readable.tag,
                                self,
                                true,
                                readable.fd,
                            ) {
                                sys::Result::Err(err) => {
                                    (readable.on_error)(readable.ctx, err);
                                }
                                sys::Result::Ok(()) => {
                                    self.active += 1;
                                }
                            }
                        }
                        Action::Writable(writable) => {
                            match writable.poll.register_for_epoll::<{ Flags::PollWritable }>(
                                writable.tag,
                                self,
                                true,
                                writable.fd,
                            ) {
                                sys::Result::Err(err) => {
                                    (writable.on_error)(writable.ctx, err);
                                }
                                sys::Result::Ok(()) => {
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
                                close.poll.unregister_with_fd(self.pollfd(), close.fd);
                                self.active -= 1;
                            }
                            (close.on_done)(close.ctx);
                        }
                    }
                }
            }

            let mut events: [EventType; 256] =
                // SAFETY: epoll_event is POD; kernel writes into it before we read.
                unsafe { core::mem::MaybeUninit::uninit().assume_init() };

            // SAFETY: valid epoll fd; events buffer length matches.
            let rc = unsafe {
                libc::epoll_wait(
                    self.pollfd().cast(),
                    events.as_mut_ptr().cast(),
                    c_int::try_from(events.len()).unwrap(),
                    i32::MAX,
                )
            };

            match sys::get_errno(rc as isize) {
                sys::Errno::INTR => continue,
                sys::Errno::SUCCESS => {}
                e => bun_core::Output::panic(format_args!(
                    "epoll_wait: {}",
                    <&'static str>::from(e)
                )),
            }

            self.update_now();

            let current_events: &[linux::epoll_event] = &events[0..rc as usize];
            if rc != 0 {
                log!("epoll_wait({}) = {}", self.pollfd(), rc);
            }

            for event in current_events {
                let pollable = Pollable::from(event.data.u64);
                if pollable.tag() == PollableTag::Empty {
                    // SAFETY: LOOP is initialized (we are running inside it).
                    if event.data.ptr == unsafe { LOOP.as_ptr() } as usize {
                        // Edge-triggered: no need to read the eventfd counter
                        continue;
                    }
                }
                Poll::on_update_epoll(pollable.poll(), pollable.tag(), *event);
            }
        }
    }

    pub fn pollfd(&self) -> Fd {
        #[cfg(target_os = "linux")]
        {
            return self.epoll_fd;
        }
        #[cfg(target_os = "freebsd")]
        {
            return self.kqueue_fd;
        }
        #[cfg(not(any(target_os = "linux", target_os = "freebsd")))]
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
                let mut pending_batch = self.pending.pop_batch();
                let mut pending = pending_batch.iterator();
                events_list.reserve(pending.batch.count);
                // SAFETY: zero the spare capacity; EventType is POD.
                unsafe {
                    core::ptr::write_bytes(
                        events_list.as_mut_ptr(),
                        0,
                        events_list.capacity(),
                    );
                }

                while let Some(request) = pending.next() {
                    match (request.callback)(request) {
                        Action::Readable(readable) => {
                            let i = events_list.len();
                            debug_assert!(i + 1 <= events_list.capacity());
                            // SAFETY: capacity reserved above; slot zeroed.
                            unsafe { events_list.set_len(i + 1) };

                            Poll::apply_kqueue::<{ ApplyAction::Readable }>(
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

                            Poll::apply_kqueue::<{ ApplyAction::Writable }>(
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
                                Poll::apply_kqueue::<{ ApplyAction::Cancel }>(
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
                self.pollfd().cast(),
                events_list.as_ptr(),
                // PERF(port): @intCast
                c_int::try_from(change_count).unwrap(),
                // The same array may be used for the changelist and eventlist.
                events_list.as_mut_ptr(),
                // we set 0 here so that if we get an error on
                // registration, it becomes errno
                // PERF(port): @intCast
                c_int::try_from(capacity).unwrap(),
                core::ptr::null(),
            );

            match sys::get_errno(rc) {
                sys::Errno::INTR => continue,
                sys::Errno::SUCCESS => {}
                e => bun_core::Output::panic(format_args!(
                    "kevent failed: {}",
                    <&'static str>::from(e)
                )),
            }

            self.update_now();

            let rc_len = usize::try_from(rc).unwrap();
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

    // TODO(port): move to io_sys — extern block can't live inside impl; hoist to module scope in B-2.
    // unsafe extern "C" {
    //     fn clock_gettime_monotonic(sec: *mut i64, nsec: *mut i64) -> c_int;
    // }

    pub fn update_timespec(timespec: &mut libc::timespec) {
        #[cfg(target_os = "linux")]
        {
            // SAFETY: valid out-pointer.
            let rc = unsafe { libc::clock_gettime(libc::CLOCK_MONOTONIC, timespec) };
            debug_assert!(rc == 0);
        }
        #[cfg(windows)]
        {
            let mut sec: i64 = 0;
            let mut nsec: i64 = 0;
            // SAFETY: valid out-pointers.
            let rc = unsafe { clock_gettime_monotonic(&mut sec, &mut nsec) };
            debug_assert!(rc == 0);
            timespec.tv_sec = sec.try_into().unwrap();
            timespec.tv_nsec = nsec.try_into().unwrap();
        }
        #[cfg(not(any(target_os = "linux", windows)))]
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
    pub next: Option<NonNull<Request>>,
    pub callback: for<'a> fn(&'a mut Request) -> Action<'a>,
    pub scheduled: bool,
}

impl Default for Request {
    fn default() -> Self {
        // TODO(port): Zig had `next: ?*Request = null, scheduled: bool = false` defaults
        // but `callback` has no default; callers must overwrite `callback`.
        Self { next: None, callback: |_| unreachable!(), scheduled: false }
    }
}

// TODO(port): `bun.UnboundedQueue(Request, .next)` — intrusive MPSC queue keyed on the
// `next` field. Assuming `bun_threading::UnboundedQueue<T, OFFSET>` shape in Phase B.
pub type RequestQueue = bun_threading::UnboundedQueue<Request, { offset_of!(Request, next) }>;

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

#[derive(Clone, Copy)]
struct Pollable {
    value: TaggedPtr,
}

impl Pollable {
    pub fn init(t: PollableTag, p: *mut Poll) -> Pollable {
        Pollable { value: TaggedPtr::init(p.cast::<c_void>(), t as u16) }
    }

    pub fn from(int: u64) -> Pollable {
        Pollable { value: TaggedPtr::from(int) }
    }

    pub fn poll(self) -> *mut Poll {
        self.value.get::<Poll>()
    }

    pub fn tag(self) -> PollableTag {
        if self.value.data() == 0 {
            return PollableTag::Empty;
        }
        // SAFETY: tag was written by `init` from a valid `PollableTag`.
        unsafe { core::mem::transmute::<u16, PollableTag>(self.value.data()) }
    }

    pub fn ptr(self) -> *mut c_void {
        self.value.to()
    }
}

// ─── Poll ─────────────────────────────────────────────────────────────────────

#[cfg(all(target_os = "macos", debug_assertions))]
type GenerationNumberInt = u64;
#[cfg(not(all(target_os = "macos", debug_assertions)))]
type GenerationNumberInt = (); // Zig: u0

#[cfg(all(target_os = "macos", debug_assertions))]
static mut GENERATION_NUMBER_MONOTONIC: GenerationNumberInt = 0;

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

/// CYCLEBREAK(vtable): dispatch for `Pollable` owners. The concrete owners
/// (`ReadFile` / `WriteFile`) live in `bun_runtime::webcore::blob` (T6); io (T2)
/// only knows the embedded `*mut Poll` and the tag. `bun_runtime` registers a
/// static `PollOwnerVTable` per `PollableTag` into `POLLABLE_DISPATCH` at init.
/// PERF(port): was inline switch (cold path — Bun.write / Bun.file().text() only).
pub struct PollOwnerVTable {
    /// `poll` points to the embedded `io_poll: Poll` field of the owning struct.
    pub on_ready: unsafe fn(poll: *mut Poll),
    pub on_io_error: unsafe fn(poll: *mut Poll, err: sys::Error),
}

/// Indexed by `PollableTag as usize`. Slot 0 (`Empty`) stays null.
pub static POLLABLE_DISPATCH: [AtomicPtr<PollOwnerVTable>; 3] =
    [const { AtomicPtr::new(core::ptr::null_mut()) }; 3];

#[inline]
fn pollable_vtable(tag: PollableTag) -> Option<&'static PollOwnerVTable> {
    let p = POLLABLE_DISPATCH[tag as usize].load(Ordering::Relaxed);
    // SAFETY: entries are &'static once written by bun_runtime::init().
    if p.is_null() { None } else { Some(unsafe { &*p }) }
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
#[derive(core::marker::ConstParamTy, PartialEq, Eq, Clone, Copy)]
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

    #[cfg(target_os = "linux")]
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
    pub fn apply_kqueue<const ACTION: ApplyAction>(
        tag: PollableTag,
        poll: &mut Poll,
        fd: Fd,
        kqueue_event: &mut KEvent,
    ) {
        log!(
            "register({}, {})",
            match ACTION {
                ApplyAction::Readable => "readable",
                ApplyAction::Writable => "writable",
                ApplyAction::Cancel => "cancel",
            },
            fd
        );

        let one_shot_flag = libc::EV_ONESHOT;
        let udata: usize = Pollable::init(tag, poll as *mut Poll).ptr() as usize;
        let (filter, flags_): (i16, u16) = match ACTION {
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
        *kqueue_event = unsafe { core::mem::zeroed() };
        kqueue_event.ident = usize::try_from(fd.native()).unwrap();
        kqueue_event.filter = filter;
        kqueue_event.flags = flags_;
        kqueue_event.udata = udata as _;
        // Darwin's kevent64_s.ext[0] carries the generation number for the
        // optional sanity assertion (GenerationNumberInt is u0 elsewhere).
        #[cfg(target_os = "macos")]
        {
            #[cfg(debug_assertions)]
            let gen_: u64 = if ACTION == ApplyAction::Cancel {
                poll.generation_number
            } else {
                // SAFETY: only the IO thread mutates this counter.
                unsafe { GENERATION_NUMBER_MONOTONIC }
            };
            #[cfg(not(debug_assertions))]
            let gen_: u64 = 0;
            kqueue_event.ext = [gen_, 0];
        }

        // Zig `defer` block — runs after the body above.
        match ACTION {
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
        if ACTION != ApplyAction::Cancel {
            // SAFETY: only the IO thread mutates this counter.
            unsafe {
                GENERATION_NUMBER_MONOTONIC += 1;
                poll.generation_number = GENERATION_NUMBER_MONOTONIC;
            }
        }
    }

    #[cfg(target_os = "linux")]
    pub fn unregister_with_fd(&mut self, watcher_fd: Fd, fd: Fd) {
        // SAFETY: valid fds; null event is allowed for CTL_DEL on Linux ≥ 2.6.9.
        unsafe {
            libc::epoll_ctl(
                watcher_fd.cast(),
                linux::EPOLL_CTL_DEL,
                fd.cast(),
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
        // CYCLEBREAK(vtable): owner (ReadFile/WriteFile) is T6; dispatch via
        // POLLABLE_DISPATCH. The container_of(io_poll) recovery moves to the
        // vtable impl in bun_runtime.
        let Some(vt) = pollable_vtable(tag) else {
            debug_assert!(false, "POLLABLE_DISPATCH[{}] unregistered", tag as usize);
            return;
        };
        if event.flags == libc::EV_ERROR {
            log!("error({}) = {}", event.ident, event.data);
            // SAFETY: poll is the `io_poll` field of a live owner; vtable was
            // registered by bun_runtime for this tag.
            unsafe {
                (vt.on_io_error)(
                    poll,
                    sys::Error::from_code(
                        core::mem::transmute::<i32, sys::Errno>(event.data as i32),
                        sys::Tag::Kevent,
                    ),
                )
            };
        } else {
            log!("ready({}) = {}", event.ident, event.data);
            // SAFETY: as above.
            unsafe { (vt.on_ready)(poll) };
        }
    }

    #[cfg(target_os = "linux")]
    pub fn on_update_epoll(poll: *mut Poll, tag: PollableTag, event: linux::epoll_event) {
        // ignore empty tags. This case should be unreachable in practice
        if tag == PollableTag::Empty {
            return;
        }
        // CYCLEBREAK(vtable): owner (ReadFile/WriteFile) is T6; dispatch via
        // POLLABLE_DISPATCH. The container_of(io_poll) recovery moves to the
        // vtable impl in bun_runtime.
        let Some(vt) = pollable_vtable(tag) else {
            debug_assert!(false, "POLLABLE_DISPATCH[{}] unregistered", tag as usize);
            return;
        };
        if event.events & linux::EPOLL_ERR != 0 {
            let errno = sys::get_errno(event.events as isize);
            log!("error() = {}", <&'static str>::from(errno));
            // SAFETY: poll is the `io_poll` field of a live owner; vtable was
            // registered by bun_runtime for this tag.
            unsafe { (vt.on_io_error)(poll, sys::Error::from_code(errno, sys::Tag::EpollCtl)) };
        } else {
            log!("ready()");
            // SAFETY: as above.
            unsafe { (vt.on_ready)(poll) };
        }
    }

    #[cfg(target_os = "linux")]
    // TODO(port): `Flags` derives `enumset::EnumSetType`, which may conflict with
    // `core::marker::ConstParamTy`; Phase B should add the derive (or a parallel
    // `#[derive(ConstParamTy)]` mirror enum) so `<const FLAG: Flags>` compiles.
    pub fn register_for_epoll<const FLAG: Flags>(
        &mut self,
        tag: PollableTag,
        loop_: &mut Loop,
        one_shot: bool,
        fd: Fd,
    ) -> sys::Result<()> {
        let watcher_fd = loop_.pollfd();

        log!("register: {} ({})", <&'static str>::from(FLAG), fd);

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
        let flags: u32 = match FLAG {
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
            data: linux::epoll_data {
                u64: Pollable::init(tag, self as *mut Poll).ptr() as u64,
            },
        };

        let op: u32 = if self.flags.contains(Flags::WasEverRegistered)
            || self.flags.contains(Flags::NeedsRearm)
        {
            linux::EPOLL_CTL_MOD
        } else {
            linux::EPOLL_CTL_ADD
        };

        // SAFETY: valid fds + event pointer.
        let ctl = unsafe {
            libc::epoll_ctl(watcher_fd.cast(), op as c_int, fd.cast(), &mut event)
        };

        if let Some(errno) = sys::Result::<()>::errno_sys(ctl as isize, sys::Tag::EpollCtl) {
            return errno;
        }
        // Only mark if it successfully registered.
        // If it failed to register, we don't want to unregister it later if
        // it never had done so in the first place.
        self.flags.insert(Flags::Registered);
        self.flags.insert(Flags::WasEverRegistered);

        self.flags.insert(match FLAG {
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

        sys::Result::Ok(())
    }
}

pub const RETRY: sys::Errno = sys::Errno::AGAIN;

// ─── Cycle-break: opaque upward types (CYCLEBREAK.md §io) ─────────────────────
// io (T2) must not name bun_aio (T3) / bun_jsc (T6) / bun_runtime (T6) / bun_uws
// types directly. These vtable + opaque-handle definitions let higher tiers
// register concrete impls at init; io calls through them.

/// Opaque event-loop handle. Concrete repr is `bun_jsc::EventLoopHandle` (T6);
/// io only stores it and passes it through `FilePollVTable` calls.
/// CYCLEBREAK(forward-decl): pointer-sized opaque newtype.
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct EventLoopHandle(pub *mut c_void);

impl EventLoopHandle {
    /// Identity; kept so existing `EventLoopHandle::init(x)` call sites compile.
    #[inline]
    pub fn init(h: EventLoopHandle) -> EventLoopHandle {
        h
    }
    /// Extract the underlying uws/uv loop pointer. Routes through the FilePoll
    /// vtable since only T3+ knows the EventLoopHandle layout.
    #[inline]
    pub fn loop_(self) -> *mut c_void {
        // SAFETY: FILE_POLL_VTABLE is set by bun_runtime::init() before any io path runs.
        unsafe { (file_poll_vtable().event_loop_to_loop)(self) }
    }
}

/// Opaque pointer to a `bun_aio::FilePoll` (T3). Stored in `PollOrFd::Poll`.
pub type FilePollPtr = *mut c_void;

/// Subset of `bun_aio::FilePoll::Flags` that io inspects.
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FilePollFlag {
    PollWritable,
    Nonblocking,
    Hup,
    WasEverRegistered,
}

/// Which edge to register on (mirrors `bun_aio::Pollable::{Readable,Writable}`
/// with `bun_aio::PollMode::Dispatch`).
#[derive(Clone, Copy, PartialEq, Eq)]
#[repr(u8)]
pub enum FilePollKind {
    Readable,
    Writable,
}

/// CYCLEBREAK(vtable): manual vtable for `bun_aio::FilePoll`. The static
/// instance is provided by `bun_aio` (move-in pass) and written into
/// `FILE_POLL_VTABLE` at init. PERF(port): was direct field access / inline
/// calls — cold path (per-register, not per-tick).
pub struct FilePollVTable {
    /// Allocate + init a FilePoll. `owner` is the type-erased `*mut Self` of the
    /// PipeReader/PipeWriter; the concrete owner-tag mapping is aio's concern.
    pub init: unsafe fn(ev: EventLoopHandle, fd: Fd, owner: *mut c_void) -> FilePollPtr,
    pub fd: unsafe fn(FilePollPtr) -> Fd,
    pub set_owner: unsafe fn(FilePollPtr, owner: *mut c_void),
    pub deinit_force_unregister: unsafe fn(FilePollPtr),
    /// Register for `kind` with `PollMode::Dispatch` on `loop_` (opaque uws/uv loop).
    pub register: unsafe fn(FilePollPtr, loop_: *mut c_void, kind: FilePollKind, fd: Fd) -> sys::Result<()>,
    pub unregister: unsafe fn(FilePollPtr, loop_: *mut c_void, force_unregister: bool) -> sys::Result<()>,
    pub has_flag: unsafe fn(FilePollPtr, FilePollFlag) -> bool,
    pub file_type: unsafe fn(FilePollPtr) -> crate::pipes::FileType,
    pub is_registered: unsafe fn(FilePollPtr) -> bool,
    pub is_active: unsafe fn(FilePollPtr) -> bool,
    pub can_enable_keeping_process_alive: unsafe fn(FilePollPtr) -> bool,
    pub enable_keeping_process_alive: unsafe fn(FilePollPtr, ev: EventLoopHandle),
    pub disable_keeping_process_alive: unsafe fn(FilePollPtr, ev: EventLoopHandle),
    /// Extract the uws/uv `*mut Loop` from an `EventLoopHandle`.
    pub event_loop_to_loop: unsafe fn(EventLoopHandle) -> *mut c_void,
}

/// Written once by `bun_runtime::init()` (or `bun_aio` ctor). Never null at use.
pub static FILE_POLL_VTABLE: AtomicPtr<FilePollVTable> = AtomicPtr::new(core::ptr::null_mut());

#[inline]
pub fn file_poll_vtable() -> &'static FilePollVTable {
    // SAFETY: bun_runtime::init() sets this before any io path runs.
    unsafe { &*FILE_POLL_VTABLE.load(Ordering::Relaxed) }
}

/// Thin method-style wrapper over `FilePollPtr` so PipeReader/PipeWriter call
/// sites read like the original `bun_aio::FilePoll` API.
#[repr(transparent)]
#[derive(Clone, Copy)]
pub struct FilePoll(pub FilePollPtr);

impl FilePoll {
    #[inline]
    pub fn init<T>(ev: EventLoopHandle, fd: Fd, _flags: T, owner: *mut c_void) -> FilePoll {
        // SAFETY: vtable registered at init; args forwarded opaquely.
        FilePoll(unsafe { (file_poll_vtable().init)(ev, fd, owner) })
    }
    #[inline]
    pub fn as_ptr(self) -> FilePollPtr {
        self.0
    }
    #[inline]
    pub fn fd(self) -> Fd {
        unsafe { (file_poll_vtable().fd)(self.0) }
    }
    #[inline]
    pub fn set_owner(self, owner: *mut c_void) {
        unsafe { (file_poll_vtable().set_owner)(self.0, owner) }
    }
    #[inline]
    pub fn deinit_force_unregister(self) {
        unsafe { (file_poll_vtable().deinit_force_unregister)(self.0) }
    }
    #[inline]
    pub fn unregister(self, loop_: *mut c_void, force: bool) -> sys::Result<()> {
        unsafe { (file_poll_vtable().unregister)(self.0, loop_, force) }
    }
    #[inline]
    pub fn register_with_fd(self, loop_: *mut c_void, kind: FilePollKind, fd: Fd) -> sys::Result<()> {
        unsafe { (file_poll_vtable().register)(self.0, loop_, kind, fd) }
    }
    #[inline]
    pub fn has_flag(self, f: FilePollFlag) -> bool {
        unsafe { (file_poll_vtable().has_flag)(self.0, f) }
    }
    #[inline]
    pub fn file_type(self) -> crate::pipes::FileType {
        unsafe { (file_poll_vtable().file_type)(self.0) }
    }
    #[inline]
    pub fn is_registered(self) -> bool {
        unsafe { (file_poll_vtable().is_registered)(self.0) }
    }
    #[inline]
    pub fn is_active(self) -> bool {
        unsafe { (file_poll_vtable().is_active)(self.0) }
    }
    #[inline]
    pub fn can_enable_keeping_process_alive(self) -> bool {
        unsafe { (file_poll_vtable().can_enable_keeping_process_alive)(self.0) }
    }
    #[inline]
    pub fn enable_keeping_process_alive(self, ev: EventLoopHandle) {
        unsafe { (file_poll_vtable().enable_keeping_process_alive)(self.0, ev) }
    }
    #[inline]
    pub fn disable_keeping_process_alive(self, ev: EventLoopHandle) {
        unsafe { (file_poll_vtable().disable_keeping_process_alive)(self.0, ev) }
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

/// CYCLEBREAK(hook): `bun_jsc::VirtualMachine::get().uv_loop()` for the
/// Windows-only `Source__setRawModeStdin` C export. `bun_runtime` writes the
/// fn-ptr at init; null on POSIX (never called there).
pub static UV_LOOP_HOOK: AtomicPtr<()> = AtomicPtr::new(core::ptr::null_mut());

/// CYCLEBREAK(TYPE_ONLY): moved from `bun_runtime::webcore::PathOrFileDescriptor`.
/// Owned here so `open_for_writing` has no upward dep; runtime re-exports it.
pub enum PathOrFileDescriptor {
    Path(bun_str::PathString),
    Fd(Fd),
}

// ─── Waker (CYCLEBREAK MOVE_DOWN from bun_aio) ────────────────────────────────
//
// Ported from src/aio/posix_event_loop.zig:1272-1384 (LinuxWaker / KEventWaker)
// and src/aio/windows_event_loop.zig:361-383 (Windows Waker). io (T2) owns the
// Waker so `Loop::load` has no upward dep on bun_aio (T3). bun_aio re-exports.

pub mod waker {
    use bun_sys::Fd;

    #[cfg(target_os = "macos")]
    pub type Waker = KEventWaker;
    /// FreeBSD 13+ has eventfd(2), so the Linux waker works as-is.
    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    pub type Waker = LinuxWaker;
    #[cfg(windows)]
    pub type Waker = WindowsWaker;

    // ── Linux / FreeBSD ───────────────────────────────────────────────────────

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    pub struct LinuxWaker {
        pub fd: Fd,
    }

    #[cfg(any(target_os = "linux", target_os = "freebsd"))]
    impl LinuxWaker {
        pub fn init() -> Result<Self, bun_core::Error> {
            // TODO(port): std.posix.eventfd(0, 0) → bun_sys::eventfd. Phase B
            // should confirm bun_sys exposes the wrapper; falls back to libc.
            // SAFETY: direct syscall wrapper.
            let raw = unsafe { libc::eventfd(0, 0) };
            if raw < 0 {
                return Err(bun_core::Error::last_os_error());
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
            let mut bytes: usize = 0;
            // SAFETY: usize is 8 bytes on supported targets; reinterpret as [u8; 8].
            let buf = unsafe { &mut *(&mut bytes as *mut usize as *mut [u8; 8]) };
            // SAFETY: valid fd + 8-byte buffer; result intentionally discarded.
            let _ = unsafe { libc::read(self.fd.cast(), buf.as_mut_ptr().cast(), 8) };
        }

        pub fn wake(&self) {
            let bytes: usize = 1;
            // SAFETY: usize is 8 bytes; reinterpret as [u8; 8].
            let buf = unsafe { &*(&bytes as *const usize as *const [u8; 8]) };
            // SAFETY: valid fd + 8-byte buffer; result intentionally discarded.
            let _ = unsafe { libc::write(self.fd.cast(), buf.as_ptr().cast(), 8) };
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
        const ZEROED: [Kevent64; 16] = unsafe { core::mem::zeroed() };

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
                    c_int::try_from(events.len()).unwrap(),
                    0,
                    core::ptr::null(),
                );
            }
        }

        pub fn init() -> Result<Self, bun_core::Error> {
            // SAFETY: direct syscall wrapper.
            let kq = unsafe { libc::kqueue() };
            if kq < 0 {
                return Err(bun_core::Error::last_os_error());
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

// ─── Closer (CYCLEBREAK MOVE_DOWN from bun_aio) ───────────────────────────────
//
// Ported from src/aio/posix_event_loop.zig:1386-1406 and
// src/aio/windows_event_loop.zig:385-411. Schedules an async fd close on the
// thread pool (POSIX) or via uv_fs_close (Windows). io (T2) owns it so
// `pipes::PollOrFd::close` has no upward dep on bun_aio (T3).

pub mod closer {
    use bun_sys::Fd;

    // ── POSIX ────────────────────────────────────────────────────────────────

    #[cfg(not(windows))]
    use bun_threading::work_pool::{Task as WorkPoolTask, WorkPool};

    #[cfg(not(windows))]
    #[repr(C)]
    pub struct Closer {
        pub fd: Fd,
        pub task: WorkPoolTask,
    }

    #[cfg(not(windows))]
    impl Closer {
        /// `_compat`: for signature compatibility with the Windows version.
        pub fn close(fd: Fd, _compat: ()) {
            debug_assert!(fd.is_valid());
            // Zig: bun.TrivialNew → heap-allocate, freed in on_close.
            let closer = Box::into_raw(Box::new(Closer {
                fd,
                task: WorkPoolTask { node: Default::default(), callback: Self::on_close },
            }));
            // SAFETY: closer is a valid heap allocation; task is its embedded field.
            WorkPool::schedule(unsafe { &mut (*closer).task });
        }

        unsafe fn on_close(task: *mut WorkPoolTask) {
            // SAFETY: `task` points to `Closer.task`; recover the parent via offset_of
            // (Zig: @fieldParentPtr("task", task)).
            let closer = unsafe {
                (task as *mut u8)
                    .sub(core::mem::offset_of!(Closer, task))
                    .cast::<Closer>()
            };
            // Zig: `defer bun.destroy(closer)` — reclaim Box; drop after fd.close().
            // SAFETY: closer was Box::into_raw'd in `close`; reclaim ownership.
            let closer_box = unsafe { Box::from_raw(closer) };
            closer_box.fd.close();
            // closer_box dropped here.
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
            let io_request: uv::fs_t = unsafe { core::mem::zeroed() };
            let closer = Box::into_raw(Box::new(Closer { io_request }));
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
                    drop(Box::from_raw(closer));
                }
            }
        }

        extern "C" fn on_close(req: *mut uv::fs_t) {
            // SAFETY: req points to Closer.io_request (set in `close` above);
            // recover the parent via offset_of (Zig: @fieldParentPtr).
            let closer: *mut Closer = unsafe {
                (req as *mut u8)
                    .sub(core::mem::offset_of!(Closer, io_request))
                    .cast::<Closer>()
            };
            // SAFETY: req.data was set to `closer` in `close`; both valid for the callback.
            unsafe {
                debug_assert!(closer == (*req).data.cast::<Closer>());
                bun_sys::syslog!(
                    "uv_fs_close({}) = {}",
                    Fd::from_uv((*req).file.fd),
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
                drop(Box::from_raw(closer));
            }
        }
    }
}

// ─── re-exports ───────────────────────────────────────────────────────────────

pub use crate::waker::Waker;
pub use crate::closer::Closer;
pub use crate::pipes::ReadState;
pub use crate::pipe_reader::{BufferedReader, PipeReader};
pub use crate::pipe_writer::{BufferedWriter, StreamBuffer, StreamingWriter, WriteResult, WriteStatus};
pub use crate::pipes::FileType;
pub use crate::max_buf as MaxBuf;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/io/io.zig (741 lines)
//   confidence: medium
//   todos:      10
//   notes:      static-mut singleton + heavy cfg branching; libc/bun_sys::linux constant names and UnboundedQueue generic shape will need Phase B fixup; tick_epoll has &mut self aliasing with poll.register_for_epoll(.., self, ..) — may need reshape; Flags needs ConstParamTy for register_for_epoll<const FLAG>.
// ──────────────────────────────────────────────────────────────────────────

} // end #[cfg(any())] mod __phase_a_draft
