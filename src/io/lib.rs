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
mod keep_alive;
pub mod posix_event_loop;
pub use keep_alive::KeepAlive;

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

/// Project a `*mut bun_uws_sys::Loop` (the uws wrapper — `PosixLoop` /
/// `WindowsLoop`) to the platform-native [`Loop`] (`us_loop_t*` on POSIX,
/// `uv_loop_t*` on Windows).
///
/// On POSIX `bun_io::Loop` **is** `bun_uws_sys::Loop` (nominal identity), so
/// this is the identity. On Windows the wrapper stores the libuv loop in its
/// `uv_loop` field — set once in C at `us_create_loop` and immutable
/// thereafter — which we project here so callers needn't open an `unsafe`
/// block per site just to read a set-once field.
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
        // PORT NOTE: `alloc_file_poll() -> *mut FilePoll` was removed — it
        // returned an *uninitialized* hive slot, and any caller forming
        // `&mut FilePoll` over it hit validity-invariant UB on the niche-
        // bearing enum fields. `FilePoll::init` now goes through
        // `file_polls_ptr()` + `Store::get_init` (write-before-read).
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
        // Route through the single nonnull-asref accessor below; the `unsafe`
        // on this fn's signature is the caller-side aliasing contract — the
        // body itself needs no extra `unsafe`.
        self.loop_mut()
    }
    /// SAFETY: same aliasing hazard as [`platform_event_loop`].
    #[inline]
    pub unsafe fn file_polls(&self) -> &mut Store {
        self.file_polls_mut()
    }

    // ── safe leaf wrappers (nonnull-asref) ──────────────────────────────
    // The platform loop / poll store are per-thread, set-once back-pointers
    // (`BackRef`-shaped). [`platform_event_loop`] cannot be a safe fn because
    // handing out `&mut Loop` from `&self` would let a caller alias two
    // copies; these wrappers instead perform one counter adjustment and drop
    // the borrow before returning, so no `&mut` escapes. Collapses N
    // identical `ctx.platform_event_loop().op()` call sites into the single
    // deref inside [`loop_mut`].
    //
    // `loop_mut` is the single nonnull-asref accessor: `pub(crate)`,
    // `&self → &mut` (so it must NOT be called twice with overlapping live
    // results). Every in-crate caller is a leaf op — counter bump,
    // `FilePoll::activate`/`deactivate`, `unregister` — that consumes the
    // borrow before returning and never re-enters `EventLoopCtx`, so no two
    // `&mut Loop` ever coexist. Widened from impl-private to crate-private so
    // `posix_event_loop`/`windows_event_loop` route their N identical
    // `ctx.platform_event_loop()` derefs through this single accessor.
    #[inline]
    pub(crate) fn loop_mut(&self) -> &mut bun_uws_sys::Loop {
        // SAFETY: per-thread set-once pointer (the uws loop singleton); the
        // event loop is single-threaded so no concurrent `&mut` exists, and
        // every crate-internal caller is a leaf op that drops the borrow
        // before returning — see block comment above.
        unsafe { &mut *self.platform_event_loop_ptr() }
    }
    /// Single backref-deref accessor for the per-thread `Store`. Same contract
    /// as [`loop_mut`]: `pub(crate)`, `&self → &mut`, must NOT be called while
    /// another `&mut Store` (or a `&mut FilePoll` that lives inside the inline
    /// hive buffer) is live. Every in-crate caller is a leaf op that decays
    /// any conflicting `&mut FilePoll` to a raw slot pointer first
    /// (`deinit_possibly_defer`) or holds none (`init_with_owner`,
    /// `alloc_file_poll`), so no two `&mut Store` ever coexist.
    #[inline]
    pub(crate) fn file_polls_mut(&self) -> &mut Store {
        // SAFETY: per-thread set-once pointer (`BackRef`-shaped); the event
        // loop is single-threaded so no concurrent `&mut Store` exists, and
        // every crate-internal caller upholds the leaf-op / decayed-slot
        // discipline above — see block comment.
        unsafe { &mut *self.file_polls_ptr() }
    }
    /// Single nonnull-asref accessor for the per-loop pipe-read scratch
    /// buffer. Same contract as [`loop_mut`]: `pub(crate)`, the buffer is a
    /// per-thread set-once allocation owned by the VM/Mini loop, and the
    /// event loop is single-threaded, so no second `&mut [u8]` to it can be
    /// live. Every in-crate caller (`PipeReader::read_*`) uses it for one
    /// blocking syscall and drops the borrow before re-entering the loop.
    /// `'static` matches the unbounded lifetime the inline raw-ptr derefs at
    /// the call sites already produced; collapses their N identical
    /// `&mut *ctx.pipe_read_buffer()` derefs into this one block.
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
    pub type Pollable = Flags;
}

// ── bun_io original submodules ──────────────────────────────────────────────

#[path = "heap.rs"]
pub mod heap;
// `source.rs` is Windows-only (libuv pipe/tty/file wrappers). On POSIX the
// `Source` type is never constructed; callers are themselves `#[cfg(windows)]`.
// TODO(b2-blocked): bun_sys::windows::libuv — verify compiles on Windows in CI.
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

// ── re-exports for higher tiers ─────────────────────────────────────────────
// Byte-level `Write` trait + helpers (Zig `std.Io.Writer` surface). Downstream
// crates name these as `bun_io::Write` / `bun_io::BufWriter` /
// `bun_io::FmtAdapter` / `bun_io::Result`.
pub use bun_core::fmt::SliceCursor;
pub use write::{
    AsFmt, BufWriter, DiscardingWriter, FixedBufferStream, FmtAdapter, IntBe, IntLe, Result, Write,
};

#[allow(non_snake_case)]
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

/// One-stop generator for a `BufferedReader` parent: emits **both** the
/// `impl BufferedReaderParent for $T` block and the matching
/// `link_impl_BufferedReaderParentLink!` registration. Direct port of the Zig
/// comptime thunk-generator `BufferedReaderVTable.Fn.init(comptime Type)`
/// (PipeReader.zig:7-45) — every parent type just declares same-named inherent
/// methods and writes one macro invocation.
///
/// ## Shape
///
/// ```ignore
/// bun_io::impl_buffered_reader_parent! {
///     Variant for Ty;                 // or `Ty<'a>` (link uses `'static`)
///     has_on_read_chunk = true|false;
///     // ↓ omit when has_on_read_chunk = false (trait default fires)
///     on_read_chunk    = |this, chunk, has_more| (*this).on_read_chunk(chunk, has_more);
///     on_reader_done   = |this| (*this).on_reader_done();
///     on_reader_error  = |this, err| (*this).on_reader_error(err);
///     loop_            = |this| (*this).loop_();
///     event_loop       = |this| (*this).event_loop_handle.as_event_loop_ctx();
///     // ↓ optional — only `SubprocessPipeReader` overrides this
///     on_max_buffer_overflow = |this, maxbuf| { ... };
/// }
/// ```
///
/// Each `|this, ..|` body runs inside the generated
/// `unsafe fn(this: *mut Self, ..)` trait method, wrapped in an `unsafe {}`
/// block — `this` is the raw `*mut Self` registered via `set_parent` (see the
/// aliasing contract on [`pipe_reader::BufferedReaderParent`]). `Self` resolves
/// to `$T` inside every body. Autoref via `(*this).method()` covers the common
/// case where the inherent takes `&self`/`&mut self`; sites whose inherent must
/// stay raw-pointer (e.g. `Arc::from_raw` keepalive in shell `PipeReader`)
/// forward as `<Self>::method(this)` instead.
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

pub use crate::closer::Closer;
pub use crate::waker::Waker;
use bun_sys::{self as sys, E, Fd, FdExt};

// Zig scope name is `.loop` (io.zig:11). `loop` is a Rust keyword, so the static is
// named `io_loop` but the runtime tagname is `"loop"` so `BUN_DEBUG_loop=1` works.
#[allow(non_upper_case_globals)]
pub static io_loop: bun_core::output::ScopedLogger =
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

// ── libc shims with no preconditions ────────────────────────────────────────
// By-value scalar args only; the kernel validates and reports failure via the
// return value / errno — never UB. Local `safe fn` decls (vs. routing through
// the `libc` crate's raw items) move the proof into the type signature.
// Unused externs do not generate linker references, so per-target `#[cfg]` is
// unnecessary; every caller is gated.
#[cfg(unix)]
mod safe_c {
    use core::ffi::c_int;
    unsafe extern "C" {
        pub(super) safe fn kqueue() -> c_int;
        pub(super) safe fn epoll_create1(flags: c_int) -> c_int;
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

    /// IO-thread-only scratch state. Wrapped in `Cell` so the tick loop can
    /// run on `&self` (see [`on_spawn_io_thread`]): we must never hold a
    /// process-lifetime `&mut IoRequestLoop`, because cross-thread
    /// `schedule()` callers concurrently touch `pending`/`waker` through a
    /// sibling raw pointer, and a live `&mut` over the whole struct would
    /// assert `noalias` on those bytes too — UB under Stacked Borrows even
    /// though the queue itself is lock-free. `Cell` is sound here because the
    /// `ThreadCell` owner latch (debug-asserted in `LOOP.get()`) confines all
    /// `tick`-side access to the IO thread.
    pub cached_now: core::cell::Cell<libc::timespec>,
    pub active: core::cell::Cell<usize>,
}

// §Concurrency: `OnceLock` for init gate; the singleton itself stays raw because
// the IO thread mutates fields concurrently with `schedule()` callers (which only
// touch the lock-free `pending` queue + `waker`), so wrapping the whole struct in a
// `Mutex` would be wrong. Matches Zig `var loop: Loop = undefined;` + `std.once(load)`.
//
// `ThreadCell` (not `RacyCell`) to encode "IO-thread-only after init" in the
// type. `claim()` is invoked from `on_spawn_io_thread`. Cross-thread
// `schedule()` callers go through `get_unchecked` and touch only the
// lock-free `pending` + `waker` (see `schedule`); `ONCE` provides the
// happens-before for init.
static LOOP: bun_core::ThreadCell<core::mem::MaybeUninit<IoRequestLoop>> =
    bun_core::ThreadCell::new(core::mem::MaybeUninit::uninit());
static ONCE: std::sync::OnceLock<()> = std::sync::OnceLock::new();

impl IoRequestLoop {
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
            let raw = safe_c::epoll_create1(libc::EPOLL_CLOEXEC | 0);
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

    /// Enqueue `request` for the IO thread to pick up. Safe to call from any
    /// thread: only touches the lock-free `pending` queue and the
    /// async-signal-safe `waker`. This is the *only* cross-thread entry
    /// point — every other `IoRequestLoop` method is IO-thread-only.
    pub fn schedule(request: &mut Request) {
        Self::ensure_init();
        debug_assert!(!request.scheduled);
        request.scheduled = true;
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
                                    (readable.on_error)(readable.ctx, err);
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
                                    (writable.on_error)(writable.ctx, err);
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
                    // `self` *is* `(*LOOP.get()).assume_init_ref()` (see
                    // `on_spawn_io_thread`), and `MaybeUninit<T>` is
                    // `repr(transparent)`, so its address equals the sentinel
                    // stored in `load()` — no need to re-deref the cell.
                    if event.u64 == core::ptr::from_ref(self) as usize as u64 {
                        // Edge-triggered: no need to read the eventfd counter
                        continue;
                    }
                }
                Poll::on_update_epoll(pollable.poll(), pollable.tag(), *event);
            }
        }
    }

    // Zig: `Waker.getFd` / the loop's poll fd are `@compileError` on Windows
    // (src/io/windows_event_loop.zig:368-373). Gate these so any Windows
    // call site fails at compile time, matching the spec, rather than
    // compiling cleanly and only panicking at runtime.
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
            // PERF(port): was StackFallbackAllocator(256*sizeof(EventType)) — profile in Phase B.
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

// ─── Intrusive io_request → parent recovery ──────────────────────────────────
// Mirrors `bun_threading::IntrusiveWorkTask`/`intrusive_work_task!`
// (work_pool.rs:23) — same const-offset + provided `container_of` shape — so
// `ReadFile`/`WriteFile` use one idiom for BOTH their intrusive fields (`task`
// and `io_request`).

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

/// Implements [`IntrusiveIoRequest`] for a struct that embeds an intrusive
/// `io_request: `[`Request`] field. Brings
/// [`IntrusiveIoRequest::from_io_request`] into scope for the type's
/// `fn(&mut Request) -> Action` trampolines.
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
            unsafe {
                __bun_io_pollable_on_io_error(
                    tag,
                    poll,
                    sys::Error::from_code(errno, sys::Tag::TODO),
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
        FilePollRef(
            core::ptr::NonNull::new(FilePoll::init(ev, fd, PollFlagsSet::empty(), owner))
                .expect("FilePoll::init returns a fresh hive slot"),
        )
    }
    /// Single nonnull-asref accessor for the hive slot.
    ///
    /// Type invariant (encapsulated `unsafe`): `self.0` was produced by
    /// `FilePoll::init` (a fresh hive slot) and remains live until the owner
    /// calls `deinit_force_unregister`. The event loop is single-threaded, so
    /// no concurrent `&mut` alias exists; the only re-entrancy hazard (a poll
    /// callback touching its own slot) is structurally avoided by every
    /// wrapper below being a leaf accessor that does not dispatch user code.
    /// All wrapper methods are already safe `pub fn` — this private accessor
    /// merely collapses their N identical `unsafe { self.0.as_mut() }` blocks
    /// into one without widening the safe-API surface.
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
    /// Single nonnull-asref accessor for the process-global uWS loop pointer.
    ///
    /// Type invariant (encapsulated `unsafe`): every caller of
    /// [`unregister`](Self::unregister) / [`register_with_fd`](Self::register_with_fd)
    /// passes `Loop::get()` (the per-thread uWS loop singleton), which is
    /// non-null after init and lives for the program. The event loop is
    /// single-threaded so the returned `&mut` is the sole live borrow at the
    /// point of use. Collapses the two identical `&mut *loop_` deref blocks in
    /// those wrappers into one.
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
            // Zig spec: `canEnableKeepingProcessAlive` is POSIX-only (posix_event_loop.zig:656-658);
            // windows_event_loop.zig has no such method. The previous synthesized expression
            // `!closed && can_ref()` reduced to `!has_incremented_poll_count` — the OPPOSITE
            // polarity of the POSIX semantics (`keeps_event_loop_alive && has_incremented_poll_count`).
            // All callers (PipeWriter PosixWriter, process.rs PollerPosix) are POSIX-only.
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
            let raw = crate::safe_c::eventfd(0, 0);
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
        // Defined in src/io/io_darwin.cpp. `mach_port` is a by-value `u32`;
        // bad/dead ports are reported by mach return codes, not UB.
        safe fn io_darwin_close_machport(port: bun_core::mach_port);
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
        /// Process-global `WindowsLoop` singleton. `BackRef` invariant (pointee
        /// outlives holder) holds trivially: the loop is never freed. `None`
        /// only between [`placeholder`] and [`init`]; every dispatch path
        /// (`wake`/`wait`/`uv_loop`) unwraps and would have UB-derefed the old
        /// raw null anyway.
        ///
        /// [`placeholder`]: Self::placeholder
        /// [`init`]: Self::init
        pub loop_: Option<bun_ptr::BackRef<bun_uws_sys::WindowsLoop>>,
    }

    #[cfg(windows)]
    impl WindowsWaker {
        /// Stand-in until `init()` runs (e.g. a `BundleThread` allocated before
        /// its real waker is created). `loop_` is `None` and must never be
        /// dereferenced — overwrite via `ptr::write` before first
        /// `wake()`/`wait()`/`uv_loop()`. Mirrors `LinuxWaker::placeholder` /
        /// `KEventWaker::placeholder` so cross-platform call sites don't fall
        /// back to `mem::zeroed()` (UB for the niche-optimised `Option<BackRef>`).
        pub const fn placeholder() -> Self {
            Self { loop_: None }
        }

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

        /// Raw libuv `uv_loop_t*` underlying this waker's `WindowsLoop`.
        ///
        /// `loop_` is the process-global singleton from `WindowsLoop::get()`
        /// (set in [`init`]), so the returned pointer has process lifetime —
        /// safe to hand to `uv::Timer::init` and friends without an `unsafe`
        /// block at the call site. Mirrors Zig's `waker.loop.uv_loop` field
        /// chain (BundleThread.zig:79).
        #[inline]
        pub fn uv_loop(&self) -> *mut bun_sys::windows::libuv::Loop {
            // `BackRef` deref is safe (process-lifetime singleton); `uv_loop`
            // is a `Copy` field set once by C `us_create_loop`.
            self.loop_ref().uv_loop
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
    use bun_sys::windows::libuv as uv;
    #[cfg(windows)]
    use core::ffi::c_void;
    #[cfg(windows)]
    use crate::IntrusiveUvFs as _;

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
