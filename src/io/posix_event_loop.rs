use core::ffi::{c_int, c_void};
use core::fmt;
use core::ptr;
use core::sync::atomic::{AtomicBool, Ordering};

use bun_collections::HiveArray;
use bun_core::Output;
use bun_sys::{self as sys, Fd, FdExt};
use bun_uws_sys::Loop as UwsLoop;

use bun_threading::work_pool::{self, WorkPool};

pub type Loop = UwsLoop;

// PORT NOTE: `addActive`/`subActive` live on `PosixLoop` in Zig (uws_sys/Loop.zig)
// but the Rust `bun_uws_sys::Loop` only exposes `inc`/`dec`/`ref_`/`unref`. The
// `active` counter is a public field, so inline the saturating math here until
// `bun_uws_sys` grows `add_active`/`sub_active`. On Windows the uws loop has no
// such counter (libuv tracks active handles itself); `posix_event_loop` is only
// reachable from non-Windows `Loop` consumers, so the Windows arm is a no-op.
#[cfg(not(windows))]
#[inline]
fn loop_add_active(loop_: &mut Loop, value: u32) {
    loop_.active = loop_.active.saturating_add(value);
}
#[cfg(not(windows))]
#[inline]
fn loop_sub_active(loop_: &mut Loop, value: u32) {
    loop_.active = loop_.active.saturating_sub(value);
}
#[cfg(windows)]
#[inline]
fn loop_add_active(_loop: &mut Loop, _value: u32) {}
#[cfg(windows)]
#[inline]
fn loop_sub_active(_loop: &mut Loop, _value: u32) {}

bun_core::declare_scope!(KeepAlive, visible);

// TODO(b2-blocked): bun_sys::syslog — macro not exported from bun_sys yet.
// Local no-op shim so debug log call sites compile. All call sites live in
// `#[cfg(not(windows))] impl FilePoll`, so gate the definition to match.
#[cfg(not(windows))]
macro_rules! syslog {
    ($($arg:tt)*) => {{ let _ = ::core::format_args!($($arg)*); }};
}

/// Local port of `Maybe(T).errnoSys` (Zig: src/runtime/node.zig). `bun_sys`
/// does not yet expose this helper on `Result<T>`; once it does, drop this and
/// call `sys::Result::<()>::errno_sys` directly.
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

pub use crate::{EventLoopCtx, EventLoopCtxKind, EventLoopKind, OpaqueCallback};

unsafe extern "Rust" {
    /// Defined `#[no_mangle]` in `bun_runtime::jsc_hooks`.
    // safe: by-value enum arg only; the `#[no_mangle] pub fn` body in
    // `bun_runtime::jsc_hooks` is itself a safe fn (reads process globals) —
    // no memory-safety preconditions.
    safe fn __bun_get_vm_ctx(kind: AllocatorType) -> EventLoopCtx;
}

/// Kind of fd a `FilePoll` (or pipe reader/writer) is wrapping. Lives here so
/// `bun_io` (which now depends on this crate) and `FilePoll::file_type` share
/// one definition; `bun_io::pipes` re-exports it for downstream callers.
// PORT NOTE: Zig defines this in src/io/pipes.zig; sunk one tier to break the
// io↔aio cycle (FilePoll::file_type was the only aio→io edge).
#[derive(Copy, Clone, Eq, PartialEq)]
pub enum FileType {
    File,
    Pipe,
    NonblockingPipe,
    Socket,
}

impl FileType {
    pub fn is_pollable(self) -> bool {
        matches!(
            self,
            FileType::Pipe | FileType::NonblockingPipe | FileType::Socket
        )
    }

    pub fn is_blocking(self) -> bool {
        self == FileType::Pipe
    }
}

#[inline]
pub fn get_vm_ctx(kind: AllocatorType) -> EventLoopCtx {
    // Link-time-resolved Rust-ABI fn; `kind` selects between the
    // process-global JS VM and Mini loop, both initialised before any
    // `KeepAlive`/`FilePoll` caller reaches this.
    __bun_get_vm_ctx(kind)
}

/// JS-thread [`EventLoopCtx`] for `KeepAlive::{ref_,unref}` / `FilePoll`.
///
/// Zig passed `*jsc.VirtualMachine` directly via `anytype` dispatch
/// (`posix_event_loop.zig:45`); the Rust crate split routes through the
/// link-time `__bun_get_vm_ctx` hook installed by `bun_runtime::init()`.
/// Every `Js`-tier caller (i.e. everything outside the install/Mini loop)
/// wants exactly `get_vm_ctx(AllocatorType::Js)`, so this shorthand replaces
/// the ~21 byte-identical local wrappers each ported file grew independently.
#[inline]
pub fn js_vm_ctx() -> EventLoopCtx {
    get_vm_ctx(AllocatorType::Js)
}

// `KeepAlive` (struct + 14-method impl) was duplicated here and in
// `windows_event_loop.rs`; both copies now live in `crate::keep_alive`.

// ──────────────────────────────────────────────────────────────────────────
// FilePoll
// ──────────────────────────────────────────────────────────────────────────

// `KQueueGenerationNumber` is `usize` on macOS-debug, else a zero-size sentinel.
#[cfg(all(target_os = "macos", debug_assertions))]
type KQueueGenerationNumber = usize;
#[cfg(not(all(target_os = "macos", debug_assertions)))]
type KQueueGenerationNumber = u8; // PORT NOTE: Zig uses `u0`; smallest Rust int is u8. Gated by cfg below.

// PORTING.md §Global mutable state: counter → Atomic. Debug-only diagnostic;
// `Relaxed` matches Zig's `+%=` (no synchronization implied).
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

/// Zig std's `.freebsd` `EV` struct omits EOF; the kernel value is the
/// same as Darwin/OpenBSD (sys/event.h: `#define EV_EOF 0x8000`).
#[cfg(any(target_os = "macos", target_os = "freebsd"))]
const EV_EOF: u16 = 0x8000;

// PORT NOTE: Zig's `kqueue_or_epoll` comptime literal was only spliced into a
// `panicLog` that the Rust port routes through `bun_output::panic!` (which
// already names the syscall via `Tag`). No remaining call site → dropped.

// ──────────────────────────────────────────────────────────────────────────
// FilePoll Owner — hot-path tag+ptr (CYCLEBREAK §Hot dispatch list).
// Low tier (here) stores `(tag: u8, ptr: *mut ())`; `bun_runtime::dispatch::on_poll`
// owns the per-tag `match` so the variant types are never named in this crate.
// ──────────────────────────────────────────────────────────────────────────

/// Closed set of `FilePoll` owner kinds. Variant types live in higher-tier
/// crates; `__bun_run_file_poll` (link-time, in `bun_runtime::dispatch`)
/// matches on this and calls the per-kind handler directly — same enum-dispatch
/// shape as `EventLoopCtx`, with the match on the runtime side because there
/// are 13 variants × 1 dispatch fn (vs 2 × 9 for `EventLoopCtx`).
#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum PollTag {
    Null = 0,
    FileSink,
    StaticPipeWriter,
    ShellStaticPipeWriter,
    SecurityScanStaticPipeWriter,
    BufferedReader,
    DnsResolver,
    GetAddrInfoRequest,
    Request,
    Process,
    ShellBufferedWriter,
    TerminalPoll,
    ParentDeathWatchdog,
    LifecycleScriptSubprocessOutputReader,
}

/// Compatibility module — call sites in `bun_runtime`/`bun_install` still spell
/// `poll_tag::FILE_SINK`. Re-export the enum variants under the old constant
/// names; the literal values are unchanged. New code should use
/// `PollTag::FileSink` directly.
pub mod poll_tag {
    use super::PollTag;
    pub const NULL: PollTag = PollTag::Null;
    pub const FILE_SINK: PollTag = PollTag::FileSink;
    pub const STATIC_PIPE_WRITER: PollTag = PollTag::StaticPipeWriter;
    pub const SHELL_STATIC_PIPE_WRITER: PollTag = PollTag::ShellStaticPipeWriter;
    pub const SECURITY_SCAN_STATIC_PIPE_WRITER: PollTag = PollTag::SecurityScanStaticPipeWriter;
    pub const BUFFERED_READER: PollTag = PollTag::BufferedReader;
    pub const DNS_RESOLVER: PollTag = PollTag::DnsResolver;
    pub const GET_ADDR_INFO_REQUEST: PollTag = PollTag::GetAddrInfoRequest;
    pub const REQUEST: PollTag = PollTag::Request;
    pub const PROCESS: PollTag = PollTag::Process;
    pub const SHELL_BUFFERED_WRITER: PollTag = PollTag::ShellBufferedWriter;
    pub const TERMINAL_POLL: PollTag = PollTag::TerminalPoll;
    pub const PARENT_DEATH_WATCHDOG: PollTag = PollTag::ParentDeathWatchdog;
    pub const LIFECYCLE_SCRIPT_SUBPROCESS_OUTPUT_READER: PollTag =
        PollTag::LifecycleScriptSubprocessOutputReader;
}

#[derive(Copy, Clone)]
pub struct Owner {
    pub tag: PollTag,
    pub ptr: *mut (),
}

impl Owner {
    pub const NULL: Owner = Owner {
        tag: PollTag::Null,
        ptr: core::ptr::null_mut(),
    };
    #[inline]
    pub const fn new(tag: PollTag, ptr: *mut ()) -> Owner {
        Owner { tag, ptr }
    }
    #[inline]
    pub fn is_null(&self) -> bool {
        self.ptr.is_null()
    }
    #[inline]
    pub fn clear(&mut self) {
        *self = Self::NULL;
    }
    #[inline]
    pub fn tag(&self) -> PollTag {
        self.tag
    }
}

unsafe extern "Rust" {
    fn __bun_run_file_poll(poll: *mut crate::FilePoll, size_or_offset: i64);
}

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq, Default)]
pub enum AllocatorType {
    #[default]
    Js,
    Mini,
}

// `FilePoll`/`Store` here are POSIX-specific (kqueue/epoll registration,
// generation_number, allocator_type). On Windows the variants live in
// `windows_event_loop`; the shared `EventLoopCtxVTable` above names
// `crate::FilePoll`/`crate::Store` so the right one is picked.
#[cfg(not(windows))]
pub struct FilePoll {
    pub fd: Fd,
    pub flags: FlagsSet,
    pub owner: Owner,

    /// We re-use FilePoll objects to avoid allocating new ones.
    ///
    /// That means we might run into situations where the event is stale.
    /// on macOS kevent64 has an extra pointer field so we use it for that
    /// linux doesn't have a field like that
    pub generation_number: KQueueGenerationNumber,
    pub next_to_free: *mut FilePoll,

    pub allocator_type: AllocatorType,
}

#[cfg(not(windows))]
impl Default for FilePoll {
    fn default() -> Self {
        Self {
            fd: INVALID_FD,
            flags: FlagsSet::empty(),
            owner: Owner::NULL,
            generation_number: 0,
            next_to_free: ptr::null_mut(),
            allocator_type: AllocatorType::Js,
        }
    }
}

#[cfg(not(windows))]
impl FilePoll {
    fn update_flags(&mut self, updated: FlagsSet) {
        let mut flags = self.flags;
        flags.remove(Flags::Readable);
        flags.remove(Flags::Writable);
        flags.remove(Flags::Process);
        flags.remove(Flags::Machport);
        flags.remove(Flags::Eof);
        flags.remove(Flags::Hup);

        flags |= updated;
        self.flags = flags;
    }

    pub fn file_type(&self) -> FileType {
        let flags = self.flags;
        if flags.contains(Flags::Socket) {
            return FileType::Socket;
        }
        if flags.contains(Flags::Nonblocking) {
            return FileType::NonblockingPipe;
        }
        FileType::Pipe
    }

    // PORT NOTE: Zig `onKQueueEvent`/`onEpollEvent` take `_: *Loop` (unused, raw-pointer
    // semantics). The Rust signatures drop the loop parameter entirely: holding a
    // protected `&mut Loop` across `on_update` would alias the fresh `&mut Loop`
    // that downstream `__bun_run_file_poll` handlers conjure via
    // `EventLoopCtx::platform_event_loop()` when they re-enter the loop
    // (`register_with_fd`/`unregister`/`deinit`).
    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub fn on_kqueue_event(&mut self, kqueue_event: &KQueueEvent) {
        self.update_flags(Flags::from_kqueue_event(kqueue_event));
        syslog!("onKQueueEvent: {}", self);

        #[cfg(all(target_os = "macos", debug_assertions))]
        debug_assert!(self.generation_number == kqueue_event.ext[0] as usize);

        self.on_update(kqueue_event.data as i64);
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn on_epoll_event(&mut self, epoll_event: &bun_sys::linux::epoll_event) {
        self.update_flags(Flags::from_epoll_event(epoll_event));
        self.on_update(0);
    }

    pub fn clear_event(&mut self, flag: Flags) {
        self.flags.remove(flag);
    }

    pub fn is_readable(&mut self) -> bool {
        let readable = self.flags.contains(Flags::Readable);
        self.flags.remove(Flags::Readable);
        readable
    }

    pub fn is_hup(&mut self) -> bool {
        let readable = self.flags.contains(Flags::Hup);
        self.flags.remove(Flags::Hup);
        readable
    }

    pub fn is_eof(&mut self) -> bool {
        let readable = self.flags.contains(Flags::Eof);
        self.flags.remove(Flags::Eof);
        readable
    }

    pub fn is_writable(&mut self) -> bool {
        let readable = self.flags.contains(Flags::Writable);
        self.flags.remove(Flags::Writable);
        readable
    }

    // PORT NOTE: not `impl Drop` — FilePoll is pool-allocated (HiveArray) and explicitly
    // put back via `Store::put`; Drop would be wrong here.
    pub fn deinit(&mut self) {
        let ctx = get_vm_ctx(self.allocator_type);
        self.deinit_possibly_defer(ctx, false);
    }

    pub fn deinit_force_unregister(&mut self) {
        let ctx = get_vm_ctx(self.allocator_type);
        self.deinit_possibly_defer(ctx, true);
    }

    fn deinit_possibly_defer(&mut self, vm: EventLoopCtx, force_unregister: bool) {
        // `loop_mut()` is the crate-private nonnull-asref accessor (single
        // deref in `EventLoopCtx`); the `&mut Loop` is consumed by `unregister`
        // and dropped before any `&mut Store` is materialised.
        let _ = self.unregister(vm.loop_mut(), force_unregister);

        self.owner.clear();
        let was_ever_registered = self.flags.contains(Flags::WasEverRegistered);
        self.flags = FlagsSet::empty();
        self.fd = INVALID_FD;
        // `self` may live inside the `Store.hive` inline array, so a
        // `&mut Store` taken while `&mut self` is live would assert unique
        // access over the slot and invalidate `self`'s tag (Stacked Borrows).
        // Decay `self` to a raw slot pointer first, *then* materialise the
        // `&mut Store` via the crate-private backref-deref accessor.
        let this: *mut FilePoll = std::ptr::from_mut::<FilePoll>(self);
        // `file_polls_mut()` is the per-thread set-once `Store` back-pointer
        // (`BackRef`-shaped); `&mut self` has been retired to `this` above so
        // the `&mut Store` it produces is the sole unique borrow into the hive.
        // `Store::put` itself touches `this` only via raw-pointer ops.
        vm.file_polls_mut().put(this, vm, was_ever_registered);
    }

    pub fn deinit_with_vm(&mut self, vm: EventLoopCtx) {
        self.deinit_possibly_defer(vm, false);
    }

    pub fn is_registered(&self) -> bool {
        self.flags.contains(Flags::PollWritable)
            || self.flags.contains(Flags::PollReadable)
            || self.flags.contains(Flags::PollProcess)
            || self.flags.contains(Flags::PollMachport)
    }

    pub fn on_update(&mut self, size_or_offset: i64) {
        if self.flags.contains(Flags::OneShot) && !self.flags.contains(Flags::NeedsRearm) {
            self.flags.insert(Flags::NeedsRearm);
        }

        debug_assert!(!self.owner.is_null());

        // Hot-path hoisted-match: the per-tag `switch` lives in
        // `bun_runtime::dispatch::__bun_run_file_poll` (link-time extern) so
        // this T3 crate names no variant types. // PERF(port): was inline switch.
        // SAFETY: `self` is a live FilePoll for the duration of the call
        // (guaranteed by the uws loop callback contract).
        unsafe { __bun_run_file_poll(self, size_or_offset) };
    }

    #[inline]
    pub fn is_active(&self) -> bool {
        self.flags.contains(Flags::HasIncrementedPollCount)
    }

    #[inline]
    pub fn is_watching(&self) -> bool {
        !self.flags.contains(Flags::NeedsRearm)
            && (self.flags.contains(Flags::PollReadable)
                || self.flags.contains(Flags::PollWritable)
                || self.flags.contains(Flags::PollProcess))
    }

    /// This decrements the active counter if it was previously incremented
    /// "active" controls whether or not the event loop should potentially idle
    pub fn disable_keeping_process_alive(&mut self, event_loop_ctx: EventLoopCtx) {
        event_loop_ctx
            .loop_sub_active(self.flags.contains(Flags::HasIncrementedActiveCount) as u32);

        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.remove(Flags::HasIncrementedActiveCount);
    }

    #[inline]
    pub fn can_enable_keeping_process_alive(&self) -> bool {
        self.flags.contains(Flags::KeepsEventLoopAlive)
            && self.flags.contains(Flags::HasIncrementedPollCount)
    }

    pub fn set_keeping_process_alive(&mut self, event_loop_ctx: EventLoopCtx, value: bool) {
        if value {
            self.enable_keeping_process_alive(event_loop_ctx);
        } else {
            self.disable_keeping_process_alive(event_loop_ctx);
        }
    }

    pub fn enable_keeping_process_alive(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.flags.contains(Flags::Closed) {
            return;
        }

        event_loop_ctx
            .loop_add_active((!self.flags.contains(Flags::HasIncrementedActiveCount)) as u32);

        self.flags.insert(Flags::KeepsEventLoopAlive);
        self.flags.insert(Flags::HasIncrementedActiveCount);
    }

    /// Only intended to be used from EventLoop.Pollable
    fn deactivate(&mut self, loop_: &mut Loop) {
        if self.flags.contains(Flags::HasIncrementedPollCount) {
            loop_.dec();
        }
        self.flags.remove(Flags::HasIncrementedPollCount);

        loop_sub_active(
            loop_,
            self.flags.contains(Flags::HasIncrementedActiveCount) as u32,
        );
        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.remove(Flags::HasIncrementedActiveCount);
    }

    /// Only intended to be used from EventLoop.Pollable
    fn activate(&mut self, loop_: &mut Loop) {
        self.flags.remove(Flags::Closed);

        if !self.flags.contains(Flags::HasIncrementedPollCount) {
            loop_.inc();
        }
        self.flags.insert(Flags::HasIncrementedPollCount);

        if self.flags.contains(Flags::KeepsEventLoopAlive) {
            loop_add_active(
                loop_,
                (!self.flags.contains(Flags::HasIncrementedActiveCount)) as u32,
            );
            self.flags.insert(Flags::HasIncrementedActiveCount);
        }
    }

    /// Build a fully-initialized `FilePoll` value for `Store::get_init`.
    ///
    /// PORT NOTE: the previous `&mut *pool.get()` + field-assign pattern was
    /// instant validity UB — `FilePoll.owner`/`allocator_type` are enums with
    /// niches, and `&mut FilePoll` over an uninitialized hive slot asserts a
    /// valid discriminant. It also left `generation_number` uninitialized on
    /// non-macOS-debug builds and then read it in the `syslog!` below. Building
    /// the whole struct by value fixes both.
    #[inline]
    fn new_value(vm: EventLoopCtx, fd: Fd, flags: FlagsSet, owner: Owner) -> FilePoll {
        FilePoll {
            fd,
            flags,
            owner,
            next_to_free: ptr::null_mut(),
            allocator_type: if vm.is_js() { AllocatorType::Js } else { AllocatorType::Mini },
            #[cfg(all(target_os = "macos", debug_assertions))]
            // Matches Zig `max_generation_number +%= 1`; single-threaded event
            // loop so `Relaxed` ordering is sufficient.
            generation_number: MAX_GENERATION_NUMBER
                .fetch_add(1, core::sync::atomic::Ordering::Relaxed)
                .wrapping_add(1),
            #[cfg(not(all(target_os = "macos", debug_assertions)))]
            generation_number: 0,
        }
    }

    // TODO(port): Zig branches on @TypeOf(vm) for *PackageManager, EventLoopHandle, else.
    // Phase B: callers normalize to EventLoopCtx before calling.
    pub fn init(vm: EventLoopCtx, fd: Fd, flags: FlagsSet, owner: Owner) -> *mut FilePoll {
        let value = Self::new_value(vm, fd, flags, owner);
        let generation_number = value.generation_number;
        let poll = vm.alloc_file_poll(value).as_ptr();
        syslog!(
            "FilePoll.init(0x{:x}, generation_number={}, fd={})",
            poll as usize,
            generation_number,
            fd
        );
        poll
    }

    // PORT NOTE: Zig `initWithOwner` picks `allocator_type` from comptime
    // `@TypeOf(vm_) == *jsc.VirtualMachine`; here we derive it from the runtime
    // `EventLoopCtx` tag. The two agree only when `vm` is built from the
    // concrete VM/MiniEventLoop (the sole Zig call path, via `init`). Kept
    // non-`pub` so callers can't pass a re-wrapped handle and diverge.
    #[allow(dead_code)]
    fn init_with_owner(vm: EventLoopCtx, fd: Fd, flags: FlagsSet, owner: Owner) -> *mut FilePoll {
        let value = Self::new_value(vm, fd, flags, owner);
        let generation_number = value.generation_number;
        let poll = vm.alloc_file_poll(value).as_ptr();
        syslog!(
            "FilePoll.initWithOwner(0x{:x}, generation_number={}, fd={})",
            poll as usize,
            generation_number,
            fd
        );
        poll
    }

    #[inline]
    pub fn can_ref(&self) -> bool {
        // TODO(port): Zig checks `.disable` flag, but no such variant exists in Flags enum —
        // dead code in Zig? Preserving as no-op false check.
        !self.flags.contains(Flags::HasIncrementedPollCount)
    }

    #[inline]
    pub fn can_unref(&self) -> bool {
        self.flags.contains(Flags::HasIncrementedPollCount)
    }

    /// Prevent a poll from keeping the process alive.
    pub fn unref(&mut self, event_loop_ctx: EventLoopCtx) {
        syslog!("unref");
        self.disable_keeping_process_alive(event_loop_ctx);
    }

    /// Allow a poll to keep the process alive.
    pub fn ref_(&mut self, event_loop_ctx: EventLoopCtx) {
        if self.flags.contains(Flags::Closed) {
            return;
        }
        syslog!("ref");
        self.enable_keeping_process_alive(event_loop_ctx);
    }

    pub fn on_ended(&mut self, event_loop_ctx: EventLoopCtx) {
        self.flags.remove(Flags::KeepsEventLoopAlive);
        self.flags.insert(Flags::Closed);
        // `loop_mut()` — crate-private nonnull-asref accessor; `deactivate` is
        // a leaf counter op so the `&mut Loop` borrow does not escape.
        self.deactivate(event_loop_ctx.loop_mut());
    }

    #[inline]
    pub fn file_descriptor(&self) -> Fd {
        self.fd
    }

    pub fn register(&mut self, loop_: &mut Loop, flag: Flags, one_shot: bool) -> sys::Result<()> {
        self.register_with_fd(
            loop_,
            flag,
            if one_shot {
                OneShotFlag::OneShot
            } else {
                OneShotFlag::None
            },
            self.fd,
        )
    }

    pub fn register_with_fd(
        &mut self,
        loop_: &mut Loop,
        flag: Flags,
        one_shot: OneShotFlag,
        fd: Fd,
    ) -> sys::Result<()> {
        #[cfg(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        ))]
        return self.register_with_fd_impl(loop_, flag, one_shot, fd);
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        )))]
        {
            let _ = (loop_, flag, one_shot, fd);
            sys::Result::Ok(())
        }
    }

    #[cfg(any(
        target_os = "linux",
        target_os = "android",
        target_os = "macos",
        target_os = "freebsd"
    ))]
    fn register_with_fd_impl(
        &mut self,
        loop_: &mut Loop,
        flag: Flags,
        one_shot: OneShotFlag,
        fd: Fd,
    ) -> sys::Result<()> {
        let watcher_fd = loop_.fd;

        syslog!(
            "register: FilePoll(0x{:x}, generation_number={}) {} ({})",
            std::ptr::from_mut(self) as usize,
            self.generation_number,
            <&'static str>::from(flag),
            fd
        );

        debug_assert!(fd != INVALID_FD);

        if one_shot != OneShotFlag::None {
            self.flags.insert(Flags::OneShot);
        }

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            use bun_sys::linux::{self, EPOLL};
            let one_shot_flag: u32 = if !self.flags.contains(Flags::OneShot) {
                0
            } else {
                EPOLL::ONESHOT
            };

            let mut flags: u32 = match flag {
                Flags::Process | Flags::Readable => EPOLL::IN | EPOLL::HUP | one_shot_flag,
                Flags::Writable => EPOLL::OUT | EPOLL::HUP | EPOLL::ERR | one_shot_flag,
                _ => unreachable!(),
            };
            // epoll keys on fd alone; if the other direction is already
            // registered on this poll, preserve it in the CTL_MOD mask.
            // (EPOLLONESHOT disarms the whole fd after the first event in
            // either direction, so bidirectional one-shot is not supported.)
            if flag == Flags::Readable && self.flags.contains(Flags::PollWritable) {
                debug_assert!(!self.flags.contains(Flags::OneShot));
                flags |= EPOLL::OUT | EPOLL::ERR;
            }
            if flag == Flags::Writable && self.flags.contains(Flags::PollReadable) {
                debug_assert!(!self.flags.contains(Flags::OneShot));
                flags |= EPOLL::IN;
            }

            // PORT NOTE: Zig uses `linux.epoll_event{ .data = .{ .ptr = ... } }`;
            // libc::epoll_event flattens the union to a single `u64` field.
            let mut event = linux::epoll_event {
                events: flags,
                u64: Pollable::init(self).ptr() as u64,
            };

            let op: c_int = if self.is_registered() || self.flags.contains(Flags::NeedsRearm) {
                EPOLL::CTL_MOD
            } else {
                EPOLL::CTL_ADD
            };

            // SAFETY: FFI syscall; `event` is a stack-local valid for the call.
            let ctl = unsafe { linux::epoll_ctl(watcher_fd, op, fd.native(), &raw mut event) };
            self.flags.insert(Flags::WasEverRegistered);
            if let Some(errno) = errno_sys(ctl, sys::Tag::epoll_ctl) {
                self.deactivate(loop_);
                return errno;
            }
        }
        #[cfg(target_os = "macos")]
        {
            use bun_sys::darwin::{EV, EVFILT, NOTE, kevent64_s};
            // SAFETY: all-zero is a valid kevent64_s
            let mut changelist: [kevent64_s; 2] = bun_core::ffi::zeroed();
            let one_shot_flag: u16 = if !self.flags.contains(Flags::OneShot) {
                0
            } else if one_shot == OneShotFlag::Dispatch {
                EV::DISPATCH | EV::ENABLE
            } else {
                EV::ONESHOT
            };

            changelist[0] = match flag {
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
                _ => unreachable!(),
            };

            // output events only include change errors
            const KEVENT_FLAG_ERROR_EVENTS: u32 = 0x000002;

            // The kevent() system call returns the number of events placed in
            // the eventlist, up to the value given by nevents.  If the time
            // limit expires, then kevent() returns 0.
            let rc = 'rc: loop {
                // SAFETY: FFI syscall; pointers reference stack-local changelist valid for the call.
                let rc = unsafe {
                    bun_sys::darwin::kevent64(
                        watcher_fd,
                        changelist.as_ptr(),
                        1,
                        // The same array may be used for the changelist and eventlist.
                        changelist.as_mut_ptr(),
                        // we set 0 here so that if we get an error on
                        // registration, it becomes errno
                        0,
                        KEVENT_FLAG_ERROR_EVENTS,
                        &TIMEOUT,
                    )
                };
                if sys::get_errno(rc) == sys::E::EINTR {
                    continue;
                }
                break 'rc rc;
            };

            self.flags.insert(Flags::WasEverRegistered);

            // If an error occurs while
            // processing an element of the changelist and there is enough room
            // in the eventlist, then the event will be placed in the eventlist
            // with EV_ERROR set in flags and the system error in data. xnu ORs
            // EV_ERROR into the existing action bits, so test the bit.
            if (changelist[0].flags & EV::ERROR) != 0 && changelist[0].data != 0 {
                return errno_sys(changelist[0].data, sys::Tag::kevent).unwrap();
                // Otherwise, -1 will be returned, and errno will be set to
                // indicate the error condition.
            }

            let errno = sys::get_errno(rc);
            if errno != sys::E::SUCCESS {
                self.deactivate(loop_);
                return sys::Result::Err(sys::Error::from_code(errno, sys::Tag::kqueue));
            }
        }
        #[cfg(target_os = "freebsd")]
        {
            use bun_sys::freebsd::{EV, EVFILT, Kevent, NOTE, kevent};
            // SAFETY: all-zero is a valid Kevent
            let mut changelist: [Kevent; 1] = bun_core::ffi::zeroed();
            let one_shot_flag: u16 = if !self.flags.contains(Flags::OneShot) {
                0
            } else if one_shot == OneShotFlag::Dispatch {
                EV::DISPATCH | EV::ENABLE
            } else {
                EV::ONESHOT
            };

            let ident = usize::try_from(fd.native()).expect("int cast");
            let udata = Pollable::init(self).ptr();
            changelist[0] = match flag {
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
                Flags::Machport => {
                    return sys::Result::Err(sys::Error::from_code(
                        sys::E::EOPNOTSUPP,
                        sys::Tag::kevent,
                    ));
                }
                _ => unreachable!(),
            };

            let rc = 'rc: loop {
                // SAFETY: FFI syscall; pointers reference stack-local changelist valid for the call.
                let rc = unsafe {
                    kevent(
                        watcher_fd,
                        changelist.as_ptr(),
                        1,
                        // Same array for changelist and eventlist; nevents=0 so
                        // registration errors come back via errno.
                        changelist.as_mut_ptr(),
                        0,
                        ptr::null(),
                    )
                };
                if sys::get_errno(rc) == sys::E::EINTR {
                    continue;
                }
                break 'rc rc;
            };

            self.flags.insert(Flags::WasEverRegistered);
            if let Some(err) = errno_sys(rc, sys::Tag::kevent) {
                self.deactivate(loop_);
                return err;
            }
        }

        self.activate(loop_);
        self.flags.insert(match flag {
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
            _ => unreachable!(),
        });
        self.flags.remove(Flags::NeedsRearm);

        sys::Result::Ok(())
    }

    pub fn unregister(&mut self, loop_: &mut Loop, force_unregister: bool) -> sys::Result<()> {
        self.unregister_with_fd(loop_, self.fd, force_unregister)
    }

    pub fn unregister_with_fd(
        &mut self,
        loop_: &mut Loop,
        fd: Fd,
        force_unregister: bool,
    ) -> sys::Result<()> {
        // PORT NOTE: reshaped for borrowck (Zig `defer this.deactivate(loop)`) — compute the
        // syscall result first, then unconditionally deactivate. Avoids the raw-pointer scopeguard
        // the literal translation would require.
        #[cfg(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        ))]
        let result = self.unregister_with_fd_impl(loop_, fd, force_unregister);
        #[cfg(not(any(
            target_os = "linux",
            target_os = "android",
            target_os = "macos",
            target_os = "freebsd"
        )))]
        let result: sys::Result<()> = {
            let _ = (fd, force_unregister);
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
    fn unregister_with_fd_impl(
        &mut self,
        loop_: &mut Loop,
        fd: Fd,
        force_unregister: bool,
    ) -> sys::Result<()> {
        #[cfg(debug_assertions)]
        debug_assert!(fd.native() >= 0 && fd != INVALID_FD);

        if !(self.flags.contains(Flags::PollReadable)
            || self.flags.contains(Flags::PollWritable)
            || self.flags.contains(Flags::PollProcess)
            || self.flags.contains(Flags::PollMachport))
        {
            // no-op
            return sys::Result::Ok(());
        }

        debug_assert!(fd != INVALID_FD);
        let watcher_fd = loop_.fd;
        let both_directions =
            self.flags.contains(Flags::PollReadable) && self.flags.contains(Flags::PollWritable);
        let flag: Flags = 'brk: {
            if self.flags.contains(Flags::PollReadable) {
                break 'brk Flags::Readable;
            }
            if self.flags.contains(Flags::PollWritable) {
                break 'brk Flags::Writable;
            }
            if self.flags.contains(Flags::PollProcess) {
                break 'brk Flags::Process;
            }
            if self.flags.contains(Flags::PollMachport) {
                break 'brk Flags::Machport;
            }
            return sys::Result::Ok(());
        };

        if self.flags.contains(Flags::NeedsRearm) && !force_unregister {
            syslog!(
                "unregister: {} ({}) skipped due to needs_rearm",
                <&'static str>::from(flag),
                fd
            );
            self.flags.remove(Flags::PollProcess);
            self.flags.remove(Flags::PollReadable);
            self.flags.remove(Flags::PollWritable);
            self.flags.remove(Flags::PollMachport);
            return sys::Result::Ok(());
        }

        syslog!(
            "unregister: FilePoll(0x{:x}, generation_number={}) {}{} ({})",
            std::ptr::from_mut(self) as usize,
            self.generation_number,
            <&'static str>::from(flag),
            if both_directions { "+writable" } else { "" },
            fd
        );

        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            use bun_sys::linux::{self, EPOLL};
            // CTL_DEL keys on fd alone, so both directions are removed together.
            // SAFETY: FFI syscall; null event is valid for CTL_DEL on Linux ≥2.6.9.
            let ctl = unsafe {
                linux::epoll_ctl(watcher_fd, EPOLL::CTL_DEL, fd.native(), ptr::null_mut())
            };

            if let Some(errno) = errno_sys(ctl, sys::Tag::epoll_ctl) {
                return errno;
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
                _ => unreachable!(),
            };

            let mut nchanges: c_int = 1;
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
            // SAFETY: FFI syscall; pointers reference stack-local changelist valid for the call.
            let rc = unsafe {
                kevent64(
                    watcher_fd,
                    changelist.as_ptr(),
                    nchanges,
                    // The same array may be used for the changelist and eventlist.
                    changelist.as_mut_ptr(),
                    nchanges,
                    KEVENT_FLAG_ERROR_EVENTS,
                    &TIMEOUT,
                )
            };

            let errno = sys::get_errno(rc);
            // Global failure (e.g. EBADF on the kqueue fd): the eventlist
            // was not written, so per-entry checks below would read our
            // own input. Report errno and stop.
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
            if rc >= 1 && (changelist[0].flags & EV::ERROR) != 0 && changelist[0].data != 0 {
                return errno_sys(changelist[0].data, sys::Tag::kevent).unwrap();
            }
            if rc >= 2 && (changelist[1].flags & EV::ERROR) != 0 && changelist[1].data != 0 {
                return errno_sys(changelist[1].data, sys::Tag::kevent).unwrap();
            }
        }
        #[cfg(target_os = "freebsd")]
        {
            use bun_sys::freebsd::{EV, EVFILT, Kevent, NOTE, kevent};
            // SAFETY: all-zero is a valid Kevent
            let mut changelist: [Kevent; 2] = bun_core::ffi::zeroed();
            let ident = usize::try_from(fd.native()).expect("int cast");
            let udata = Pollable::init(self).ptr();
            changelist[0] = match flag {
                Flags::Readable => make_kevent(ident, EVFILT::READ, EV::DELETE, 0, udata),
                Flags::Writable => make_kevent(ident, EVFILT::WRITE, EV::DELETE, 0, udata),
                Flags::Process => make_kevent(ident, EVFILT::PROC, EV::DELETE, NOTE::EXIT, udata),
                Flags::Machport => {
                    return sys::Result::Err(sys::Error::from_code(
                        sys::E::EOPNOTSUPP,
                        sys::Tag::kevent,
                    ));
                }
                _ => unreachable!(),
            };

            let mut nchanges: c_int = 1;
            if both_directions {
                changelist[1] = make_kevent(ident, EVFILT::WRITE, EV::DELETE, 0, udata);
                nchanges = 2;
            }

            // nevents=0: per-entry errors surface as rc=-1/errno for the
            // first failing change. For EV_DELETE (typically ENOENT) a silent
            // miss on the second entry is harmless.
            // SAFETY: FFI syscall; pointers reference stack-local changelist valid for the call.
            let rc = unsafe {
                kevent(
                    watcher_fd,
                    changelist.as_ptr(),
                    nchanges,
                    changelist.as_mut_ptr(),
                    0,
                    ptr::null(),
                )
            };
            if let Some(err) = errno_sys(rc, sys::Tag::kevent) {
                return err;
            }
        }

        self.flags.remove(Flags::NeedsRearm);
        self.flags.remove(Flags::OneShot);
        self.flags.remove(Flags::PollReadable);
        self.flags.remove(Flags::PollWritable);
        self.flags.remove(Flags::PollProcess);
        self.flags.remove(Flags::PollMachport);

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
            FlagsFormatter(self.flags)
        )
    }
}

// ──────────────────────────────────────────────────────────────────────────
// Flags
// ──────────────────────────────────────────────────────────────────────────

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

    HasIncrementedPollCount,
    HasIncrementedActiveCount,
    Closed,

    KeepsEventLoopAlive,

    Nonblocking,

    WasEverRegistered,
    IgnoreUpdates,

    /// Was O_NONBLOCK set on the file descriptor?
    Nonblock,

    Socket,
}

pub type FlagsSet = enumset::EnumSet<Flags>;
// TODO(port): Zig `Flags.Struct = std.enums.EnumFieldStruct(Flags, bool, false)` — used as a
// builder for Set.init(). In Rust, callers should construct `FlagsSet` directly via `|`.
pub type FlagsStruct = FlagsSet;

impl Flags {
    pub fn poll(self) -> Flags {
        match self {
            Flags::Readable => Flags::PollReadable,
            Flags::Writable => Flags::PollWritable,
            Flags::Process => Flags::PollProcess,
            Flags::Machport => Flags::PollMachport,
            other => other,
        }
    }

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    pub fn from_kqueue_event(kqueue_event: &KQueueEvent) -> FlagsSet {
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
        }
        flags
    }

    #[cfg(any(target_os = "linux", target_os = "android"))]
    pub fn from_epoll_event(epoll: &bun_sys::linux::epoll_event) -> FlagsSet {
        use bun_sys::linux::EPOLL;
        let mut flags = FlagsSet::empty();
        if epoll.events & EPOLL::IN != 0 {
            flags.insert(Flags::Readable);
        }
        if epoll.events & EPOLL::OUT != 0 {
            flags.insert(Flags::Writable);
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

pub struct FlagsFormatter(pub FlagsSet);

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

// TODO(port): Zig uses `if (bun.heap_breakdown.enabled) 0 else 128` for the hive size.
#[cfg(not(windows))]
const HIVE_SIZE: usize = 128;
#[cfg(not(windows))]
type FilePollHive = bun_collections::hive_array::Fallback<FilePoll, HIVE_SIZE>;

/// We defer freeing FilePoll until the end of the next event loop iteration
/// This ensures that we don't free a FilePoll before the next callback is called
#[cfg(not(windows))]
pub struct Store {
    hive: FilePollHive,
    pending_free_head: *mut FilePoll,
    pending_free_tail: *mut FilePoll,
}

#[cfg(not(windows))]
impl Store {
    pub fn init() -> Store {
        Store {
            hive: FilePollHive::init(),
            pending_free_head: ptr::null_mut(),
            pending_free_tail: ptr::null_mut(),
        }
    }

    /// Claim a hive slot and move `value` into it. Infallible (heap fallback).
    #[inline]
    pub fn get_init(&mut self, value: FilePoll) -> ptr::NonNull<FilePoll> {
        self.hive.get_init(value)
    }

    pub fn process_deferred_frees(&mut self) {
        let mut next = self.pending_free_head;
        while !next.is_null() {
            let current = next;
            // SAFETY: intrusive list; nodes were allocated by this hive. Walk via
            // raw-pointer reads/writes only — materializing a `&mut FilePoll`
            // here would alias the `&mut self.hive` borrow taken by `put()`
            // below (the slot may live inside the inline hive array).
            unsafe {
                next = (*current).next_to_free;
                (*current).next_to_free = ptr::null_mut();
                // FilePoll has no drop glue; `put` is a no-op drop + recycle.
                self.hive.put(current);
            }
        }
        self.pending_free_head = ptr::null_mut();
        self.pending_free_tail = ptr::null_mut();
    }

    pub fn put(&mut self, poll: *mut FilePoll, vm: EventLoopCtx, ever_registered: bool) {
        // SAFETY: `poll` may point *inside* `self.hive`'s inline `[FilePoll; 128]`
        // buffer, so accepting it as `&mut FilePoll` while `&mut self` is live
        // would retag overlapping storage under Stacked Borrows (UB). Mirror Zig's
        // alias-tolerant `poll: *FilePoll` and touch fields only through raw
        // pointer ops — same rationale as `process_deferred_frees` above.
        if !ever_registered {
            // SAFETY: `poll` is a fully-initialized hive slot; FilePoll has no
            // drop glue, so `put` is a no-op drop + recycle.
            unsafe { self.hive.put(poll) };
            return;
        }

        debug_assert!(unsafe { (*poll).next_to_free }.is_null());

        if !self.pending_free_tail.is_null() {
            debug_assert!(!self.pending_free_head.is_null());
            // SAFETY: tail is non-null and points into the hive.
            unsafe {
                debug_assert!((*self.pending_free_tail).next_to_free.is_null());
                (*self.pending_free_tail).next_to_free = poll;
            }
        }

        if self.pending_free_head.is_null() {
            self.pending_free_head = poll;
            debug_assert!(self.pending_free_tail.is_null());
        }

        // SAFETY: see fn-level comment — raw-pointer field access only.
        unsafe { (*poll).flags.insert(Flags::IgnoreUpdates) };
        self.pending_free_tail = poll;

        let callback: OpaqueCallback = Self::process_deferred_frees_thunk;
        // TODO(port): Zig asserts the callback slot is empty or already this fn.
        debug_assert!(
            vm.after_event_loop_callback().is_none()
                || vm.after_event_loop_callback().map(|f| f as usize) == Some(callback as usize)
        );
        vm.set_after_event_loop_callback(
            Some(callback),
            std::ptr::from_mut::<Store>(self).cast::<c_void>(),
        );
    }

    // Safe fn item: module-private thunk, only coerced to the C-ABI
    // `OpaqueCallback` fn-pointer type — never callable by name outside
    // `Store`. Body wraps its raw-ptr op explicitly.
    extern "C" fn process_deferred_frees_thunk(ctx: *mut c_void) {
        // SAFETY: ctx was set to `self as *mut Store` in `put` above.
        let this = unsafe { bun_ptr::callback_ctx::<Store>(ctx) };
        this.process_deferred_frees();
    }
}

// ──────────────────────────────────────────────────────────────────────────
// onTick (exported)
// ──────────────────────────────────────────────────────────────────────────

// `Pollable` mirrors Zig `bun.TaggedPointerUnion(.{FilePoll})`.
//
// PORT NOTE: `bun_collections::TaggedPtrUnion<(FilePoll,)>` cannot be
// instantiated here — `impl_tagged_ptr_union!` would generate
// `impl TypeList for (FilePoll,)`, which trips the orphan rule (foreign trait
// on a tuple). Since the union has exactly one variant, wrap the raw
// `TaggedPtr` directly with the same tag scheme (`1024 - index`).
#[derive(Copy, Clone)]
pub struct Pollable {
    repr: bun_collections::TaggedPointer,
}

impl Pollable {
    /// Tag value for `FilePoll` (index 0 in the Zig type tuple → `1024 - 0`).
    pub const FILE_POLL_TAG: u16 = 1024;

    #[inline]
    pub fn init(ptr: *const crate::FilePoll) -> Self {
        Self {
            repr: bun_collections::TaggedPointer::init(ptr, Self::FILE_POLL_TAG),
        }
    }

    #[inline]
    pub fn from(val: *mut c_void) -> Self {
        Self {
            repr: bun_collections::TaggedPointer::from(val),
        }
    }

    #[inline]
    pub fn tag(self) -> u16 {
        self.repr.data()
    }

    #[inline]
    pub fn as_file_poll(self) -> *mut crate::FilePoll {
        self.repr.get::<crate::FilePoll>()
    }

    #[inline]
    pub fn ptr(self) -> *mut c_void {
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
pub extern "C" fn Bun__internal_dispatch_ready_poll(loop_: *mut Loop, tagged_pointer: *mut c_void) {
    let tag = Pollable::from(tagged_pointer);

    if tag.tag() != Pollable::FILE_POLL_TAG {
        return;
    }

    // SAFETY: tag matched FilePoll; pointer was set via Pollable::init in register_with_fd.
    let file_poll: &mut FilePoll = unsafe { &mut *tag.as_file_poll() };
    if file_poll.flags.contains(Flags::IgnoreUpdates) {
        return;
    }

    // SAFETY: `loop_` is the live uws loop. Do *not* materialize `&mut *loop_`
    // here — `on_update` (via `__bun_run_file_poll`) re-enters the loop and conjures
    // a fresh `&mut Loop` through `EventLoopCtx::platform_event_loop()`; a
    // protected `&mut Loop` spanning that call would be SB-UB. Take a short-lived
    // `&*loop_` only to copy the POD event onto the stack (the `BackRef`-style
    // accessor returns by value), then drop the borrow before dispatching so the
    // handler is free to form its own `&mut Loop`.
    let ev = unsafe { &*loop_ }.current_ready_event();

    #[cfg(any(target_os = "macos", target_os = "freebsd"))]
    file_poll.on_kqueue_event(&ev);
    #[cfg(any(target_os = "linux", target_os = "android"))]
    file_poll.on_epoll_event(&ev);
}

#[cfg(any(target_os = "macos", target_os = "freebsd"))]
static TIMEOUT: bun_sys::posix::timespec = bun_sys::posix::timespec {
    tv_sec: 0,
    tv_nsec: 0,
};

#[repr(u8)]
#[derive(Copy, Clone, PartialEq, Eq)]
pub enum OneShotFlag {
    Dispatch,
    OneShot,
    None,
}

const INVALID_FD: Fd = Fd::INVALID;

// ──────────────────────────────────────────────────────────────────────────
// Waker / Closer — canonical impls live in this crate's `mod waker` /
// `mod closer` (lib.rs). Before the bun_io→bun_io merge each crate had its
// own copy (this file was bun_io's, lib.rs was bun_io's, kept apart so
// `Loop::load` had no aio→io edge). With the merge there is one definition;
// re-export here so `posix_event_loop::Waker` / `::Closer` (and therefore
// the `bun_io::*` shim) keep resolving for downstream callers.
// ──────────────────────────────────────────────────────────────────────────

pub use crate::closer::Closer;
#[cfg(target_os = "macos")]
pub use crate::waker::KEventWaker;
#[cfg(any(target_os = "linux", target_os = "android", target_os = "freebsd"))]
pub use crate::waker::LinuxWaker;
pub use crate::waker::Waker;

// ported from: src/aio/posix_event_loop.zig
