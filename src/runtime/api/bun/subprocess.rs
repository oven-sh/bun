//! The Subprocess object is returned by `Bun.spawn`. This file also holds the
//! code for `Bun.spawnSync`

use core::cell::Cell;
use core::ffi::c_void;
use core::ptr::NonNull;
use std::sync::atomic::AtomicU32;

use bun_ptr::{RefCount, RefCounted, RefPtr};

use bun_core::Output;
use bun_io::{FilePoll, KeepAlive};
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSGlobalObject, JSPromise, JSValue, JsCell, JsRef,
    JsResult, VirtualMachine,
};
use bun_jsc::{JsClass, SysErrorJsc};
use bun_sys::{self, Fd, FdExt, SignalCode};
use enumset::{EnumSet, EnumSetType};

// Process / spawn machinery lives in this crate (api/bun/process.rs), not in an
// external `bun_spawn` crate. The `bun_spawn` workspace crate only carries the
// platform-thin `Stdio`/`Status` shims used by `bun.spawnSync` callers.
use crate::api::bun::Terminal;
#[cfg(not(windows))]
use crate::api::bun_process::ExtraPipe;
use crate::api::bun_process::{self as spawn_process, Process, Rusage, Status};
use crate::api::js_bun_spawn_bindings;
use crate::jsc::ipc as IPC;
use crate::node::node_cluster_binding;
use crate::timer::{EventLoopTimer, EventLoopTimerState};
use crate::webcore::{self, AbortSignal, Blob, FileSink};
#[cfg(windows)]
use bun_libuv_sys::UvHandle as _;

#[path = "subprocess/ResourceUsage.rs"]
pub mod resource_usage;
pub use resource_usage::ResourceUsage;

#[path = "subprocess/SubprocessPipeReader.rs"]
pub mod subprocess_pipe_reader;
pub use subprocess_pipe_reader as PipeReader;

#[path = "subprocess/Readable.rs"]
pub mod readable;
pub use readable::Readable;

#[path = "subprocess/Writable.rs"]
pub mod writable;
pub use writable::Writable;

#[path = "subprocess/StaticPipeWriter.rs"]
pub mod static_pipe_writer;
pub use static_pipe_writer::StaticPipeWriter as NewStaticPipeWriter;

pub use bun_io::MaxBuf;
pub use js_bun_spawn_bindings::{spawn, spawn_sync};

bun_output::declare_scope!(Subprocess, visible);
bun_output::declare_scope!(IPC, visible);

// `toJS`/`fromJS`/`fromJSDirect` are wired manually below (the `#[bun_jsc::JsClass]`
// proc-macro doesn't support generic structs); cached-property accessors
// (exitedPromiseGetCached, stdinGetCached, …) from `jsc.Codegen.JSSubprocess` are
// emitted here via `codegen_cached_accessors!`.
pub mod js {
    bun_jsc::codegen_cached_accessors!(
        "Subprocess";
        stdin,
        stdout,
        stderr,
        terminal,
        exitedPromise,
        onExitCallback,
        onDisconnectCallback,
        ipcCallback
    );
}

/// Platform-dependent stdio result type.
pub use bun_spawn::subprocess::StdioResult;

#[cfg(windows)]
type StdioPipeItem = StdioResult;
#[cfg(not(windows))]
type StdioPipeItem = ExtraPipe;

pub type StaticPipeWriter<'a> = NewStaticPipeWriter<Subprocess<'a>>;

impl<'a> static_pipe_writer::StaticPipeWriterProcess for Subprocess<'a> {
    const POLL_OWNER_TAG: bun_io::PollTag = bun_io::posix_event_loop::poll_tag::STATIC_PIPE_WRITER;
    unsafe fn on_close_io(this: *mut Self, kind: StdioKind) {
        // SAFETY: caller (StaticPipeWriter) guarantees `this` is live.
        unsafe { (*this).on_close_io(kind) }
    }
}

#[derive(EnumSetType, strum::IntoStaticStr)]
pub enum ObservableGetter {
    Stdin,
    Stdout,
    Stderr,
}

pub use bun_spawn::process::StdioKind;

// PORT NOTE: `#[bun_jsc::JsClass]` does not yet handle generic structs (it emits the
// bare ident in extern signatures). The `JsClass` impl + finalize/construct C-ABI
// hooks are hand-expanded below for `Subprocess<'_>`.
//
// R-2 (host-fn re-entrancy): every JS-exposed method takes `&self`; per-field
// interior mutability via `Cell` (Copy) / `JsCell` (non-Copy). Host-fn bodies re-enter
// JS (`run_callback`, promise resolve, getters that materialise streams) and a
// live `&mut Self` across those calls would alias the fresh `&mut Self` the
// codegen shim hands to whichever method JS calls next. `UnsafeCell`-backed
// fields suppress `noalias` on the outer `&Subprocess`, making the miscompile
// structurally impossible.
// Intrusive ref-count: bun.ptr.RefCount(@This(), "ref_count", deinit, .{})
// `RefPtr<Subprocess>` provides ref/deref and frees the Box when ref_count → 0.
#[derive(bun_ptr::RefCounted)]
pub struct Subprocess<'a> {
    pub ref_count: RefCount<Subprocess<'a>>,
    /// Intrusively-refcounted `Process` (Zig: `*Process`). Allocated via
    /// `heap::alloc` in `Process::init_posix`/`init_windows`; the +1 ref
    /// from construction is released in [`Subprocess::finalize`] via
    /// `Process::deref()`. Not `Arc` — `Process` carries its own
    /// `ThreadSafeRefCount` and crosses the `ProcessAutoKiller`/waiter-thread
    /// boundary by raw identity, so wrapping in `Arc` would double-count and
    /// (worse) `Arc::from_raw` on a `Box` allocation is UB.
    pub process: bun_ptr::BackRef<Process>,
    pub stdin: JsCell<Writable<'a>>,
    pub stdout: JsCell<Readable>,
    pub stderr: JsCell<Readable>,
    pub stdio_pipes: JsCell<Vec<StdioPipeItem>>,
    pub pid_rusage: Cell<Option<Rusage>>,

    /// Terminal attached to this subprocess (if spawned with terminal option)
    pub terminal: Cell<Option<NonNull<Terminal>>>,

    // Zig: `*jsc.JSGlobalObject` — JSC global outlives every Subprocess.
    pub global_this: bun_ptr::BackRef<JSGlobalObject>,
    pub observable_getters: Cell<EnumSet<ObservableGetter>>,
    pub closed: Cell<EnumSet<StdioKind>>,
    pub this_value: JsCell<JsRef>,

    /// `None` indicates all of the IPC data is uninitialized.
    pub ipc_data: JsCell<Option<IPC::SendQueue>>,
    pub flags: Cell<Flags>,

    // TODO(port): lifetime — weak observer, nulled in onStdinDestroyed; no ownership
    pub weak_file_sink_stdin_ptr: Cell<Option<NonNull<FileSink>>>,
    /// +1 C++-intrusive ref held; released in `clear_abort_signal` via
    /// `AbortSignal::unref()`. Not `Arc` — `AbortSignal` is an opaque FFI
    /// handle whose refcount lives on the C++ side.
    pub abort_signal: Cell<Option<NonNull<AbortSignal>>>,

    pub event_loop_timer_refd: Cell<bool>,
    /// Intrusive timer node. `JsCell` so `&self` can hand `*mut EventLoopTimer`
    /// to the timer heap; `JsCell` is `#[repr(transparent)]` so
    /// `from_field_ptr!(Subprocess, event_loop_timer, t)` in
    /// `dispatch.rs` still recovers the correct container address.
    pub event_loop_timer: JsCell<EventLoopTimer>,
    pub kill_signal: SignalCode,

    pub stdout_maxbuf: Cell<Option<NonNull<MaxBuf::MaxBuf>>>,
    pub stderr_maxbuf: Cell<Option<NonNull<MaxBuf::MaxBuf>>>,
    pub exited_due_to_maxbuf: Cell<Option<MaxBuf::Kind>>,

    /// Track whether the process has exited to properly handle kill() calls
    pub has_exited: Cell<bool>,
}

bun_event_loop::impl_timer_owner!(Subprocess<'_>; from_timer_ptr => event_loop_timer);

// PORT NOTE: no `Default` impl for `Subprocess`. `js_bun_spawn_bindings::
// spawn_maybe_sync` fills every field explicitly (see PORT NOTE there), and
// `*mut Process` has no sound placeholder anyway.

pub type SubprocessRc<'a> = RefPtr<Subprocess<'a>>;

// ── manual `#[bun_jsc::JsClass]` expansion (generic struct) ──────────────────
// Routes through the codegen'd `crate::generated_classes::js_Subprocess`
// wrappers (which are typed against `Subprocess<'static>`) so the extern
// symbols are declared exactly once.
const _: () = {
    use crate::generated_classes::js_Subprocess as js;

    impl<'a> Subprocess<'a> {
        /// Wrap an already-heap-allocated `Subprocess` (via `heap::alloc`) in
        /// its JS cell. `Bun.spawn` boxes early so address-dependent
        /// back-pointers (`stdin.pipe.signal`, MaxBuf owner, IPC owner) can be
        /// wired before `subprocess.toJS(globalThis)` runs; this is the raw-ptr
        /// entrypoint that avoids re-boxing.
        ///
        /// `ptr` must come from `heap::alloc(Box::new(Subprocess { .. }))` and
        /// not yet be owned by any JS wrapper; ownership transfers to the C++
        /// side (released via `SubprocessClass__finalize`). Thin forwarder to
        /// the (already safe) generated `js_Subprocess::to_js`, which
        /// encapsulates the FFI `__create` call internally.
        #[inline]
        pub fn to_js_from_ptr(ptr: *mut Self, global: &JSGlobalObject) -> JSValue {
            // The codegen wrapper is monomorphized at `'static`; the lifetime
            // parameter is purely a borrow-checker artifact (C++ stores the
            // pointer as opaque `m_ctx`), so erase it via `cast`.
            js::to_js(ptr.cast(), global)
        }
    }

    bun_jsc::impl_js_class_via_generated!(for<'a> Subprocess<'a> => crate::generated_classes::js_Subprocess, no_constructor);

    // `SubprocessClass__finalize` / `SubprocessClass__construct` are now emitted
    // by `generateRust()` (`build/*/codegen/generated_classes.rs`); the
    // hand-expanded copies that used to live here collided at link time and
    // have been removed.
};

impl<'a> Subprocess<'a> {
    /// Debug-assert the per-stdio spawn result is well-formed.
    #[inline]
    pub fn assert_stdio_result(result: &StdioResult) {
        #[cfg(all(debug_assertions, unix))]
        if let Some(fd) = result {
            debug_assert!(fd.is_valid());
        }
        #[cfg(not(all(debug_assertions, unix)))]
        let _ = result;
    }

    /// Borrow the intrusively-refcounted `Process`. Zig stores `*Process` and
    /// reads/mutates freely; every access site is single-threaded on the JS
    /// mutator, so projecting `&`/`&mut` through the raw pointer mirrors the
    /// original semantics.
    #[inline]
    pub fn process(&self) -> &Process {
        self.process.get()
    }

    /// Mutably borrow the owned [`Process`].
    ///
    /// Centralises the `BackRef<Process> → &mut Process` projection so callers
    /// (including `js_bun_spawn_bindings`) stay safe. Caller must be on the
    /// owning JS thread with no other live `&mut Process`.
    #[inline]
    #[allow(clippy::mut_from_ref)]
    pub(super) fn process_mut(&self) -> &mut Process {
        // SAFETY: see `process()` — Zig `*Process` semantics. R-2: `&self`
        // (interior-mutability) so callers don't need `&mut Subprocess`;
        // `Process` lives in a separate allocation (BackRef) so the returned
        // `&mut` never aliases `*self`. Single JS-mutator thread.
        unsafe { &mut *self.process.as_ptr() }
    }

    /// Borrow the stored JSC global. Zig stores `*jsc.JSGlobalObject` raw; the
    /// global is guaranteed to outlive every Subprocess it created.
    #[inline]
    pub fn global_this(&self) -> &JSGlobalObject {
        self.global_this.get()
    }

    /// `self`'s address as `*mut Self` for C-callback ctx slots / abort-signal
    /// native bindings. Callbacks deref it as `&*const` (shared) — see the
    /// `*_c` thunks below — so no write provenance is required; the `*mut`
    /// spelling is purely to match the C signature.
    #[inline]
    pub fn as_ctx_ptr(&self) -> *mut Self {
        (self as *const Self).cast_mut()
    }

    /// Read-modify-write the packed `Cell<Flags>` through `&self`.
    #[inline]
    pub fn update_flags(&self, f: impl FnOnce(&mut Flags)) {
        let mut v = self.flags.get();
        f(&mut v);
        self.flags.set(v);
    }

    /// Intrusive `ref()` — Zig's `pub const ref = ref_count.ref`.
    #[inline]
    pub fn ref_(&self) {
        // SAFETY: `&self` → live `*const Self`; `RefCount::ref_` only touches
        // the intrusive counter via `addr_of_mut!`.
        unsafe { RefCount::<Self>::ref_(self.as_ctx_ptr()) }
    }
    /// Intrusive `deref()` — Zig's `pub const deref = ref_count.deref`.
    /// May free `self`; do not use `self` after calling.
    #[inline]
    pub fn deref(&self) {
        // SAFETY: `&self` → live `*const Self`; destructor handles the Box.
        // R-2: `&self` so callers can `defer self.deref()` without holding a
        // unique borrow across re-entrant JS.
        unsafe { RefCount::<Self>::deref(self.as_ctx_ptr()) }
    }
}

bitflags::bitflags! {
    #[repr(transparent)]
    #[derive(Clone, Copy, Default)]
    pub struct Flags: u8 {
        const IS_SYNC                      = 1 << 0;
    }
}
