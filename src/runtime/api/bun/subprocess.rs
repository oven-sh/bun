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
// R-2 Phase 2: every JS-exposed method takes `&self`; per-field interior
// mutability via `Cell` (Copy) / `JsCell` (non-Copy). Host-fn bodies re-enter
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
}

bun_event_loop::impl_timer_owner!(Subprocess<'_>; from_timer_ptr => event_loop_timer);

// PORT NOTE: a `Default` impl for `Subprocess` was scaffolded here in Phase A
// to support `..Default::default()` struct-update syntax in
// `js_bun_spawn_bindings::spawn_maybe_sync`. That call site now fills every
// field explicitly (see PORT NOTE there), so the impl is dead and has been
// removed — `*mut Process` has no sound placeholder anyway.

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
        const KILLED                       = 1 << 1;
        const HAS_STDIN_DESTRUCTOR_CALLED  = 1 << 2;
        const FINALIZED                    = 1 << 3;
        const DEREF_ON_STDIN_DESTROYED     = 1 << 4;
        const IS_STDIN_A_READABLE_STREAM   = 1 << 5;
        /// Terminal was created inline by spawn (vs. an existing Terminal passed
        /// by the caller). Owned terminals are closed when the subprocess exits
        /// so the exit callback fires; borrowed terminals are left open for reuse.
        const OWNS_TERMINAL                = 1 << 6;
    }
}

// TODO(port): Poll appears unreferenced (dead code per LIFETIMES.tsv). Porting for parity.
pub enum Poll {
    PollRef(Option<NonNull<FilePoll>>), // TODO(port): lifetime
    WaitThread(WaitThreadPoll),
}

pub struct WaitThreadPoll {
    pub ref_count: AtomicU32,
    pub poll_ref: KeepAlive,
}

impl Default for WaitThreadPoll {
    fn default() -> Self {
        Self {
            ref_count: AtomicU32::new(0),
            poll_ref: KeepAlive::default(),
        }
    }
}

#[inline]
pub fn assert_stdio_result(result: &StdioResult) {
    #[cfg(all(debug_assertions, unix))]
    if let Some(fd) = result {
        debug_assert!(fd.is_valid());
    }
    #[cfg(not(all(debug_assertions, unix)))]
    let _ = result;
}

impl Subprocess<'_> {
    #[bun_uws::uws_callback(thunk = "on_abort_signal_c")]
    fn handle_abort_signal(&self, _reason: JSValue) {
        self.clear_abort_signal();
        let _ = self.try_kill(self.kill_signal);
    }
}

/// Module-level wrapper so callers in `js_bun_spawn_bindings` (which alias the
/// module as `Subprocess`) keep their existing `Subprocess::on_abort_signal`
/// path *and* the original safe-`extern "C" fn` item kind. The macro-emitted
/// thunk is `unsafe extern "C" fn`; this thin shim re-asserts the invariant
/// (`ctx` is the `*mut Subprocess` registered with the abort listener) so the
/// public symbol stays a safe fn-item rather than an `unsafe` fn-pointer const.
pub extern "C" fn on_abort_signal(ctx: *mut c_void, reason: JSValue) {
    // SAFETY: ctx was registered as `*mut Subprocess` when the listener was
    // attached; AbortSignal guarantees it is live for the callback.
    unsafe { Subprocess::on_abort_signal_c(ctx, reason) }
}

bun_spawn::link_impl_ProcessExit! {
    Subprocess for Subprocess => |this| {
        // `process` forwarded raw (not reborrowed) so `on_process_exit` can
        // hand it to `VirtualMachine::on_subprocess_exit` without a const→mut
        // provenance cast.
        on_process_exit(process, status, rusage) =>
            (*this).on_process_exit(process, status, &*rusage),
    }
}

impl Subprocess<'_> {
    /// Shared borrow of the attached `AbortSignal`, if any.
    ///
    /// `abort_signal` holds a +1 C++-intrusive ref taken in
    /// `spawn_maybe_sync`; the pointee is therefore live for as long as the
    /// cell is `Some` (it is `take`n *before* `unref()` in
    /// [`clear_abort_signal`](Self::clear_abort_signal)) — i.e. the
    /// owner-outlives-holder `BackRef` invariant holds.
    #[inline]
    pub fn abort_signal_ref(&self) -> Option<bun_ptr::BackRef<AbortSignal>> {
        self.abort_signal.get().map(bun_ptr::BackRef::from)
    }

    #[bun_jsc::host_fn(method)]
    pub fn resource_usage(
        this: &Self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.create_resource_usage_object(global_object)
    }

    pub fn create_resource_usage_object(
        &self,
        global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let rusage = 'brk: {
            if let Some(r) = self.pid_rusage.get() {
                break 'brk r;
            }

            #[cfg(windows)]
            {
                let rusage =
                    if let spawn_process::Poller::Uv(uv_proc) = &mut self.process_mut().poller {
                        Some(spawn_process::uv_getrusage(uv_proc))
                    } else {
                        None
                    };
                if let Some(r) = rusage {
                    self.pid_rusage.set(Some(r));
                    break 'brk r;
                }
            }

            return Ok(JSValue::UNDEFINED);
        };
        ResourceUsage::create(&rusage, global_object)
    }

    pub fn has_exited(&self) -> bool {
        self.process().has_exited()
    }

    pub fn compute_has_pending_activity(&self) -> bool {
        // `ipc_data` is never set back to `None` after init, so checking only
        // for `is_some()` would keep the JSSubprocess strongly referenced for the
        // lifetime of the VM. The IPC side contributes pending activity until
        // `_onAfterIPCClosed` has actually run: gating on `close_event_sent`
        // (rather than `socket != .closed`) keeps the wrapper Strong across the
        // window where the socket is already `.closed` but the task holding a
        // raw `*SendQueue` into `ipc_data` is still queued.
        if let Some(ipc) = self.ipc_data.get() {
            if !ipc.close_event_sent {
                return true;
            }
        }

        if self.has_pending_activity_stdio() {
            return true;
        }

        if !self.process().has_exited() {
            return true;
        }

        false
    }

    pub fn update_has_pending_activity(&self) {
        if self.flags.get().contains(Flags::IS_SYNC) {
            return;
        }

        let has_pending = self.compute_has_pending_activity();
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(Subprocess, "updateHasPendingActivity() -> {}", has_pending);
        }

        // Upgrade or downgrade the reference based on pending activity
        if has_pending {
            let global_this = self.global_this;
            self.this_value.with_mut(|v| v.upgrade(global_this.get()));
        } else {
            self.this_value.with_mut(|v| v.downgrade());
        }
    }

    pub fn has_pending_activity_stdio(&self) -> bool {
        if self.stdin.get().has_pending_activity() {
            return true;
        }

        // PERF(port): was `inline for` over .{stdout, stderr} — unrolled manually.
        if self.stdout.get().has_pending_activity() {
            return true;
        }
        if self.stderr.get().has_pending_activity() {
            return true;
        }

        false
    }

    pub fn on_close_io(&self, kind: StdioKind) {
        match kind {
            StdioKind::Stdin => self.stdin.with_mut(|stdin| match stdin {
                Writable::Pipe(pipe) => {
                    let pipe = *pipe;
                    // `signal` is a `JsCell`, so the shared `&FileSink` from the
                    // centralised `pipe_sink` accessor suffices for `with_mut`.
                    Writable::pipe_sink(pipe).signal.with_mut(|s| s.clear());
                    *stdin = Writable::Ignore;
                    // `Writable::Pipe` owns one intrusive ref; release it now
                    // that the variant has been overwritten. Ordered after the
                    // assignment so any re-entrant `on_stdin_destroyed` from
                    // `deinit` observes `.Ignore`.
                    Writable::pipe_release(pipe);
                }
                Writable::Buffer(buffer) => {
                    Writable::buffer_writer_mut(buffer).source.detach();
                    // PORT NOTE: Zig's `buffer.deref()` is the owner drop from the
                    // assignment below; do not deref explicitly.
                    *stdin = Writable::Ignore;
                }
                _ => {}
            }),
            StdioKind::Stdout | StdioKind::Stderr => {
                let out: &JsCell<Readable> = if kind == StdioKind::Stdout {
                    &self.stdout
                } else {
                    &self.stderr
                };
                if matches!(out.get(), Readable::Pipe(_)) {
                    // Mirror Zig: copy the pipe pointer out, reassign `out.*`, then
                    // mutate/deref the pipe. In Rust, move the Rc<PipeReader> out of
                    // `*out` first so reassigning doesn't drop it while still borrowed.
                    let Readable::Pipe(pipe) = out.replace(Readable::Ignore) else {
                        unreachable!()
                    };
                    let pipe_state = &mut Readable::pipe_reader_mut(&pipe).state;
                    if let PipeReader::State::Done(done) = pipe_state {
                        let taken = core::mem::take(done);
                        out.set(Readable::Buffer(readable::CowString::init_owned(
                            taken.into_boxed_slice(),
                        )));
                        // pipe.state was emptied via take()
                    }
                    // else: *out stays Readable::Ignore (set by replace above).
                    // RefPtr has no Drop — release the ref this Readable held.
                    pipe.deref();
                }
            }
        }

        // When the process exits before its stdout/stderr pipes have finished
        // draining, onProcessExit's deferred updateHasPendingActivity() observes
        // the pipe as still pending and keeps `this_value` Strong. When the pipe
        // later completes and reaches here, we must re-evaluate so the JsRef can
        // be downgraded and the JSSubprocess + buffered output become collectable.
        self.update_has_pending_activity();
    }

    pub fn js_ref(&self) {
        self.process_mut().enable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.with_mut(|s| s.r#ref());
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.with_mut(|s| s.ref_());
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.with_mut(|s| s.ref_());
        }

        self.update_has_pending_activity();
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn js_unref(&self) {
        self.process_mut().disable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.with_mut(|s| s.unref());
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.with_mut(|s| s.unref());
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.with_mut(|s| s.unref());
        }

        self.update_has_pending_activity();
    }

    pub fn constructor(global_object: &JSGlobalObject, _frame: &CallFrame) -> JsResult<*mut Self> {
        Err(global_object.throw(format_args!("Cannot construct Subprocess")))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stderr(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stderr goes through the terminal
        if this.terminal.get().is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters
            .set(this.observable_getters.get() | ObservableGetter::Stderr);
        let exited = this.has_exited();
        this.stderr.with_mut(|s| s.to_js(global_this, exited))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stdin(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stdin goes through the terminal
        if this.terminal.get().is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters
            .set(this.observable_getters.get() | ObservableGetter::Stdin);
        // PORT NOTE: reshaped for borrowck — Zig passed `&stdin` and `*Subprocess`
        // separately (aliasing). `Writable::to_js` takes only the parent and
        // projects `stdin` internally so no two `&mut` overlap here.
        Ok(Writable::to_js(this, global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stdout(this: &Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stdout goes through the terminal
        if this.terminal.get().is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters
            .set(this.observable_getters.get() | ObservableGetter::Stdout);
        // NOTE: ownership of internal buffers is transferred to the JSValue, which
        // gets cached on JSSubprocess (created via bindgen). This makes it
        // re-accessable to JS code but not via `this.stdout`, which is now `.closed`.
        let exited = this.has_exited();
        this.stdout.with_mut(|s| s.to_js(global_this, exited))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_terminal(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        if let Some(terminal) = this.terminal.get() {
            return crate::api::bun_terminal_body::to_js(terminal.as_ptr(), global_this);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(method)]
    pub fn async_dispose(
        this: &Self,
        global: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        if this.process().has_exited() {
            // rely on GC to clean everything up in this case
            return Ok(JSValue::UNDEFINED);
        }

        let this_jsvalue = callframe.this();

        let _keep = jsc::EnsureStillAlive(this_jsvalue);

        // unref streams so that this disposed process will not prevent
        // the process from exiting causing a hang
        this.stdin.with_mut(|s| s.unref());
        this.stdout.with_mut(|s| s.unref());
        this.stderr.with_mut(|s| s.unref());

        match this.try_kill(this.kill_signal) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                // Signal 9 should always be fine, but just in case that somehow fails.
                return Err(global.throw_value(err.to_js(global)));
            }
        }

        Ok(this.get_exited(this_jsvalue, global))
    }

    pub fn set_event_loop_timer_refd(&self, refd: bool) {
        if self.event_loop_timer_refd.get() == refd {
            return;
        }
        self.event_loop_timer_refd.set(refd);
        let uws_loop = self.global_this().bun_vm().uws_loop();
        let delta: i32 = if refd { 1 } else { -1 };
        Self::timer_all().increment_timer_ref(delta, uws_loop);
    }

    #[inline]
    fn timer_all() -> &'static mut crate::timer::All {
        crate::jsc_hooks::timer_all_mut()
    }

    pub fn timeout_callback(&self) {
        self.set_event_loop_timer_refd(false);
        if self.event_loop_timer.get().state == EventLoopTimerState::CANCELLED {
            return;
        }
        if self.has_exited() {
            self.event_loop_timer
                .with_mut(|t| t.state = EventLoopTimerState::CANCELLED);
            return;
        }
        self.event_loop_timer
            .with_mut(|t| t.state = EventLoopTimerState::FIRED);
        let _ = self.try_kill(self.kill_signal);
    }

    pub fn on_max_buffer(&self, kind: MaxBuf::Kind) {
        self.exited_due_to_maxbuf.set(Some(kind));
        let _ = self.try_kill(self.kill_signal);
    }

    #[bun_jsc::host_fn(method)]
    pub fn kill(
        this: &Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Safe: this method can only be called while the object is alive (reachable from JS)
        // The finalizer only runs when the object becomes unreachable
        this.this_value
            .with_mut(|v| v.update(global_this, callframe.this()));

        let arguments = callframe.arguments_old::<1>();
        // If signal is 0, then no actual signal is sent, but error checking
        // is still performed.
        let sig: SignalCode = bun_sys_jsc::signal_code_jsc::from_js(arguments.ptr[0], global_this)?;

        if global_this.has_exception() {
            return Ok(JSValue::ZERO);
        }

        match this.try_kill(sig) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                // EINVAL or ENOSYS means the signal is not supported in the current platform (most likely unsupported on windows)
                return Err(global_this.throw_value(err.to_js(global_this)));
            }
        }

        Ok(JSValue::UNDEFINED)
    }

    pub fn has_killed(&self) -> bool {
        self.process().has_killed()
    }

    pub fn try_kill(&self, sig: SignalCode) -> bun_sys::Result<()> {
        if self.has_exited() {
            return bun_sys::Result::Ok(());
        }
        self.process_mut().kill(sig.0)
    }

    fn has_called_getter(&self, getter: ObservableGetter) -> bool {
        self.observable_getters.get().contains(getter)
    }

    fn close_process(&self) {
        #[cfg(not(any(target_os = "linux", target_os = "android")))]
        {
            return;
        }
        #[cfg(any(target_os = "linux", target_os = "android"))]
        {
            self.process_mut().close();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(this: &Self, _global: &JSGlobalObject, _frame: &CallFrame) -> JsResult<JSValue> {
        this.js_ref();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(
        this: &Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.js_unref();
        Ok(JSValue::UNDEFINED)
    }

    pub fn on_stdin_destroyed(&self) {
        let must_deref = self.flags.get().contains(Flags::DEREF_ON_STDIN_DESTROYED);
        self.update_flags(|f| {
            f.remove(Flags::DEREF_ON_STDIN_DESTROYED);
            f.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED);
        });
        self.weak_file_sink_stdin_ptr.set(None);

        if !self.flags.get().contains(Flags::FINALIZED) {
            // otherwise update the pending activity flag
            self.update_has_pending_activity();
        }

        // Zig `defer if (must_deref) this.deref()` — there are no early returns
        // above, so running it last is the exact LIFO order.
        if must_deref {
            self.deref();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_send(
        this: &Self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(IPC, "Subprocess#doSend");

        let context = if this.has_exited() {
            crate::ipc_host::FromEnum::SubprocessExited
        } else {
            crate::ipc_host::FromEnum::Subprocess
        };
        // `ipc()` centralises the single unsafe `JsCell` deref; `do_send` may
        // re-enter JS, but only the SendQueue is borrowed, not `*self`.
        crate::ipc_host::do_send(this.ipc(), global, call_frame, context)
    }

    pub fn disconnect_ipc(&self, next_tick: bool) {
        let Some(ipc_data) = self.ipc() else { return };
        ipc_data.close_socket_next_tick(next_tick);
    }

    #[bun_jsc::host_fn(method)]
    pub fn disconnect(
        this: &Self,
        _global_this: &JSGlobalObject,
        _callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        this.disconnect_ipc(true);
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_connected(this: &Self, _global_this: &JSGlobalObject) -> JSValue {
        let connected = this
            .ipc_data
            .get()
            .as_ref()
            .map(|d| d.is_connected())
            .unwrap_or(false);
        JSValue::from(connected)
    }

    pub fn pid(&self) -> i32 {
        i32::try_from(self.process().pid).expect("int cast")
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_pid(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::js_number(this.pid() as f64)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_killed(this: &Self, _global: &JSGlobalObject) -> JSValue {
        JSValue::from(this.has_killed())
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stdio(this: &Self, global: &JSGlobalObject) -> JsResult<JSValue> {
        let array = JSValue::create_empty_array(global, 0)?;
        array.push(global, JSValue::NULL)?;
        array.push(global, JSValue::NULL)?; // TODO: align this with options
        array.push(global, JSValue::NULL)?; // TODO: align this with options

        for item in this.stdio_pipes.get().iter() {
            #[cfg(windows)]
            {
                if let StdioResult::Buffer(buffer) = item {
                    // `UvHandle::fd()` returns a `HANDLE` (`*mut c_void`); Zig's
                    // `@intFromPtr(item.buffer.fd().cast())` is just the
                    // numeric handle value.
                    let fdno: usize = buffer.fd() as usize;
                    array.push(global, JSValue::js_number(fdno as f64))?;
                } else {
                    array.push(global, JSValue::NULL)?;
                }
            }
            #[cfg(not(windows))]
            {
                match item {
                    ExtraPipe::OwnedFd(fd) | ExtraPipe::UnownedFd(fd) => {
                        array.push(global, JSValue::js_number(fd.native() as f64))?;
                    }
                    ExtraPipe::Unavailable => {
                        array.push(global, JSValue::NULL)?;
                    }
                }
            }
        }
        Ok(array)
    }

    pub fn memory_cost(&self) -> usize {
        core::mem::size_of::<Self>()
            + self.process().memory_cost()
            + self.stdin.get().memory_cost()
            + self.stdout.get().memory_cost()
            + self.stderr.get().memory_cost()
    }

    pub fn on_process_exit(&self, process: *mut Process, status: Status, rusage: &Rusage) {
        bun_output::scoped_log!(Subprocess, "onProcessExit()");
        let this_jsvalue = self.this_value.get().try_get().unwrap_or(JSValue::ZERO);
        // Copy the BackRef out so the `&JSGlobalObject` borrow is detached from `&self`
        // (mirrors the original `&'a` return — the global outlives `self`).
        let global_this = self.global_this;
        let global_this = global_this.get();
        let jsc_vm = global_this.bun_vm().as_mut();
        this_jsvalue.ensure_still_alive();
        self.pid_rusage.set(Some(*rusage));
        let is_sync = self.flags.get().contains(Flags::IS_SYNC);
        self.clear_abort_signal();

        // defer this.deref();
        // defer this.disconnectIPC(true);
        // R-2: now that both take `&self`, scopeguard would no longer alias —
        // kept explicit at the tail for now (no early returns in this body).

        if self.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            Self::timer_all().remove(self.event_loop_timer.as_ptr());
        }
        self.set_event_loop_timer_refd(false);

        // SAFETY: `jsc_vm` is the live VM owning `global_this`; mutator-thread
        // only. `process` is the raw `*mut Process` threaded from the vtable
        // thunk so the auto-killer's `(*process).deref()` keeps mutable
        // provenance (no `&Process → *mut` round-trip).
        unsafe { (*jsc_vm).on_subprocess_exit(process) };

        #[cfg(windows)]
        if self.flags.get().contains(Flags::OWNS_TERMINAL) {
            // POSIX gets EOF on the master when the child (last slave_fd holder)
            // exits. ConPTY's conhost stays alive after the child exits, so close
            // the pseudoconsole now to deliver EOF and fire the terminal's exit
            // callback. Leaves the Terminal itself open to match POSIX.
            if let Some(terminal) = self.terminal.get() {
                // `BackRef` invariant holds: the terminal is owned by (or
                // borrowed from a JS wrapper kept live by) this subprocess and
                // outlives this scope; single JS thread.
                bun_ptr::BackRef::from(terminal).close_pseudoconsole();
            }
        }

        let mut stdin: Option<NonNull<FileSink>> = if matches!(self.stdin.get(), Writable::Pipe(_))
            && self.flags.get().contains(Flags::IS_STDIN_A_READABLE_STREAM)
        {
            if let Writable::Pipe(pipe) = self.stdin.get() {
                // Writable::Pipe already stores `NonNull<FileSink>`; just copy it.
                Some(*pipe)
            } else {
                unreachable!()
            }
        } else {
            self.weak_file_sink_stdin_ptr.get()
        };
        let mut existing_stdin_value = JSValue::ZERO;
        if !this_jsvalue.is_empty() {
            if let Some(existing_value) = js::stdin_get_cached(this_jsvalue) {
                if existing_value.is_cell() {
                    if stdin.is_none() {
                        // TODO: review this cast
                        stdin = crate::webcore::file_sink::JSSink::from_js(existing_value)
                            .and_then(|p| NonNull::new(p.cast::<FileSink>()));
                    }

                    if !self.flags.get().contains(Flags::IS_STDIN_A_READABLE_STREAM) {
                        existing_stdin_value = existing_value;
                    }
                }
            }
        }

        // We won't be sending any more data.
        if let Writable::Buffer(buffer) = self.stdin.get() {
            Writable::buffer_writer_mut(buffer).close();
        }

        if !existing_stdin_value.is_empty() {
            crate::webcore::file_sink::JSSink::set_destroy_callback(existing_stdin_value, 0);
        }

        if self.flags.get().contains(Flags::IS_SYNC) {
            // This doesn't match Node.js' behavior, but for synchronous
            // subprocesses the streams should not keep the timers going.
            if matches!(self.stdout.get(), Readable::Pipe(_)) {
                self.stdout.with_mut(|s| s.close());
            }

            if matches!(self.stderr.get(), Readable::Pipe(_)) {
                self.stderr.with_mut(|s| s.close());
            }
        } else {
            // This matches Node.js behavior. Node calls resume() on the streams.
            if let Readable::Pipe(pipe) = self.stdout.get() {
                if !pipe.reader.is_done() {
                    Readable::pipe_reader_mut(pipe).reader.read();
                }
            }

            if let Readable::Pipe(pipe) = self.stderr.get() {
                if !pipe.reader.is_done() {
                    Readable::pipe_reader_mut(pipe).reader.read();
                }
            }
        }

        if let Some(pipe_ptr) = stdin {
            self.weak_file_sink_stdin_ptr.set(None);
            self.update_flags(|f| f.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED));

            // `pipe_ptr` came from a live FileSink (either `self.stdin.pipe`'s
            // +1-intrusive ref or the cached JS sink kept live by GC) and
            // outlives this scope on the single mutator thread — `BackRef`
            // invariant. Shared deref via `BackRef::Deref`; the one mutable
            // call below stays unsafe.
            let pipe = bun_ptr::BackRef::from(pipe_ptr);

            // `onAttachedProcessExit()` → `writer.close()` → `FileSink.onClose`
            // fires `pipe.signal` synchronously on POSIX. When the signal still
            // targets `&self.stdin` (the user never read `.stdin`, or did and
            // `Writable.toJS` left it wired), that would re-enter
            // `Writable.onClose` → `pipe.deref()` while `onAttachedProcessExit`
            // is still running on `pipe`. Detach the signal first and drive the
            // `onStdinDestroyed()` deref ourselves instead; this also leaves
            // `self.stdin` as `.pipe` so reading `.stdin` after exit still
            // returns the sink. (Signal back-pointer is the `*mut Subprocess`,
            // not `&self.stdin` — see `SignalHandler for Subprocess`.)
            if pipe.signal.get().ptr.map(|p| p.as_ptr().cast_const())
                == Some(std::ptr::from_ref::<Self>(self).cast::<c_void>())
            {
                // `signal` is a `JsCell`; `with_mut` takes `&self`, so the
                // shared `pipe: &FileSink` deref above is sufficient.
                pipe.signal.with_mut(|s| s.clear());
            }
            let must_deref = self.flags.get().contains(Flags::DEREF_ON_STDIN_DESTROYED);
            self.update_flags(|f| f.remove(Flags::DEREF_ON_STDIN_DESTROYED));

            // `pipe_ptr` is live (see `pipe` borrow above) and is the canonical
            // `*mut FileSink` from `FileSink::create*`; pass it straight through —
            // `on_attached_process_exit` re-enters via the writer backref and may
            // free `this`, so no `&mut FileSink` is materialized at the boundary.
            // SAFETY: `pipe_ptr` is the canonical heap pointer with write+dealloc
            // provenance, held live by the `Writable::Pipe`/cache +1.
            unsafe { FileSink::on_attached_process_exit(pipe_ptr.as_ptr(), &status) };

            if must_deref {
                self.deref();
            }
        }

        let mut did_update_has_pending_activity = false;

        // SAFETY: `jsc_vm` is the live VM; `event_loop()` returns its owned EventLoop.
        // Kept as raw `*mut` so the enter guard and the body can both call
        // `&mut`-taking methods without tripping borrowck.
        let event_loop = unsafe { (*jsc_vm).event_loop() };

        if !is_sync {
            if !this_jsvalue.is_empty() {
                if let Some(promise) = js::exited_promise_take_cached(this_jsvalue, global_this) {
                    // SAFETY: event_loop points into the live VM and outlives this scope.
                    let _exit_guard =
                        unsafe { bun_jsc::event_loop::EventLoop::enter_scope(event_loop) };

                    if !did_update_has_pending_activity {
                        self.update_has_pending_activity();
                        did_update_has_pending_activity = true;
                    }

                    match status {
                        Status::Exited(exited) => {
                            let _ = promise
                                .as_any_promise()
                                .unwrap()
                                .resolve(global_this, JSValue::js_number(exited.code as f64));
                            // TODO: properly propagate exception upwards
                        }
                        Status::Err(ref err) => {
                            let js_err = err.to_js(global_this);
                            let _ = promise
                                .as_any_promise()
                                .unwrap()
                                .reject_with_async_stack(global_this, js_err);
                            // TODO: properly propagate exception upwards
                        }
                        Status::Signaled(signaled) => {
                            let _ = promise.as_any_promise().unwrap().resolve(
                                global_this,
                                JSValue::js_number(128u8.wrapping_add(signaled) as f64),
                            );
                            // TODO: properly propagate exception upwards
                        }
                        _ => {
                            // crash in debug mode
                            #[cfg(debug_assertions)]
                            unreachable!();
                        }
                    }
                }

                if let Some(callback) = js::on_exit_callback_take_cached(this_jsvalue, global_this)
                {
                    let waitpid_value: JSValue = if let Status::Err(err) = &status {
                        err.to_js(global_this)
                    } else {
                        JSValue::UNDEFINED
                    };

                    let this_value: JSValue = if this_jsvalue.is_empty_or_undefined_or_null() {
                        JSValue::UNDEFINED
                    } else {
                        this_jsvalue
                    };
                    this_value.ensure_still_alive();

                    let args = [
                        this_value,
                        self.get_exit_code(global_this),
                        self.get_signal_code(global_this),
                        waitpid_value,
                    ];

                    if !did_update_has_pending_activity {
                        self.update_has_pending_activity();
                        did_update_has_pending_activity = true;
                    }

                    // SAFETY: event_loop points into the live VM.
                    unsafe { (*event_loop).run_callback(callback, global_this, this_value, &args) };
                }
            }
        }

        // defer if (!did_update_has_pending_activity) this.updateHasPendingActivity();
        if !did_update_has_pending_activity {
            self.update_has_pending_activity();
        }
        // defer this.disconnectIPC(true);
        self.disconnect_ipc(true);
        // defer this.deref();
        self.deref();
    }

    fn close_io(&self, io: StdioKind) {
        if self.closed.get().contains(io) {
            return;
        }
        self.closed.set(self.closed.get() | io);

        // If you never referenced stdout/stderr, they won't be garbage collected.
        //
        // That means:
        //   1. We need to stop watching them
        //   2. We need to free the memory
        //   3. We need to halt any pending reads (1)

        let getter = match io {
            StdioKind::Stdin => ObservableGetter::Stdin,
            StdioKind::Stdout => ObservableGetter::Stdout,
            StdioKind::Stderr => ObservableGetter::Stderr,
        };
        let called = self.has_called_getter(getter);

        match io {
            StdioKind::Stdin => {
                if !called {
                    Writable::finalize(self);
                } else {
                    self.stdin.with_mut(|s| s.close());
                }
            }
            StdioKind::Stdout => {
                if !called {
                    self.stdout.with_mut(|s| s.finalize());
                } else {
                    self.stdout.with_mut(|s| s.close());
                }
            }
            StdioKind::Stderr => {
                if !called {
                    self.stderr.with_mut(|s| s.finalize());
                } else {
                    self.stderr.with_mut(|s| s.close());
                }
            }
        }
    }

    // This must only be run once per Subprocess
    pub fn finalize_streams(&self) {
        bun_output::scoped_log!(Subprocess, "finalizeStreams");
        self.close_process();

        self.close_io(StdioKind::Stdin);
        self.close_io(StdioKind::Stdout);
        self.close_io(StdioKind::Stderr);

        #[cfg(windows)]
        for item in self.stdio_pipes.replace(Vec::new()) {
            if let StdioResult::Buffer(buffer) = item {
                // `uv_close` is async — the pipe must outlive this scope until
                // `on_pipe_close` runs and reclaims the allocation. Hand the
                // `Box` back to libuv as a raw pointer (Zig keeps `*uv.Pipe`
                // and `clearAndFree` only frees the slice of pointers).
                Box::leak(buffer).close(on_pipe_close);
            }
        }
        #[cfg(not(windows))]
        {
            for item in self.stdio_pipes.get().iter() {
                match item {
                    ExtraPipe::OwnedFd(fd) => fd.close(),
                    ExtraPipe::UnownedFd(_) | ExtraPipe::Unavailable => {}
                }
            }
            self.stdio_pipes.with_mut(|v| v.clear());
        }
        self.stdio_pipes.with_mut(|v| v.shrink_to_fit());
    }

    fn clear_abort_signal(&self) {
        if let Some(signal) = self.abort_signal.replace(None).map(bun_ptr::BackRef::from) {
            // `signal` was stored with a +1 C++ intrusive ref (taken in
            // `spawn_maybe_sync`); it stays live until `unref()` below, so the
            // `BackRef` invariant (pointee outlives holder) holds for this scope.
            signal.pending_activity_unref();
            signal.clean_native_bindings(self.as_ctx_ptr().cast::<c_void>());
            signal.unref();
        }
    }

    pub fn finalize(self: Box<Self>) {
        bun_output::scoped_log!(Subprocess, "finalize");
        // Refcounted: the trailing `this.deref()` releases the JS wrapper's +1;
        // allocation may outlive this call if other refs remain, so hand
        // ownership back to the raw refcount.
        let this = bun_core::heap::release(self);
        // Ensure any code which references the "this" value doesn't attempt to
        // access it after it's been freed We cannot call any methods which
        // access GC'd values during the finalizer
        this.this_value.with_mut(|v| v.finalize());

        this.clear_abort_signal();

        debug_assert!(
            !this.compute_has_pending_activity()
                || VirtualMachine::VirtualMachine::get().is_shutting_down()
        );
        this.finalize_streams();

        this.process_mut().detach();
        // Match Zig's `this.process.deref()`: release the intrusive ref now,
        // not when `ref_count` → 0. The raw `*mut Process` is left dangling but
        // no code path reads `this.process` after this (finalize runs once).
        // SAFETY: `process` is the live Box-backed Process; deref() frees it
        // when its own ThreadSafeRefCount reaches zero.
        unsafe { Process::deref(this.process.as_ptr()) };

        if this.event_loop_timer.get().state == EventLoopTimerState::ACTIVE {
            Self::timer_all().remove(this.event_loop_timer.as_ptr());
        }
        this.set_event_loop_timer_refd(false);

        let mut mb = this.stdout_maxbuf.get();
        MaxBuf::MaxBuf::remove_from_subprocess(&mut mb);
        this.stdout_maxbuf.set(mb);
        let mut mb = this.stderr_maxbuf.get();
        MaxBuf::MaxBuf::remove_from_subprocess(&mut mb);
        this.stderr_maxbuf.set(mb);

        if let Some(ipc_data) = this.ipc_data.replace(None) {
            // In normal operation the socket is already `.closed` by the time we
            // get here (that is what allowed `computeHasPendingActivity` to drop
            // to false and let GC collect us). `disconnectIPC` would be a no-op
            // in that state and would leak the SendQueue's buffers; deinit it
            // instead. `SendQueue.deinit` handles the VM-shutdown case where the
            // socket is still open.
            drop(ipc_data);
        }

        this.update_flags(|f| f.insert(Flags::FINALIZED));
        this.deref();
    }

    pub fn get_exited(&self, this_value: JSValue, global_this: &JSGlobalObject) -> JSValue {
        if let Some(promise) = js::exited_promise_get_cached(this_value) {
            return promise;
        }

        match &self.process().status {
            Status::Exited(exit) => {
                JSPromise::resolved_promise_value(global_this, JSValue::js_number(exit.code as f64))
            }
            Status::Signaled(signal) => JSPromise::resolved_promise_value(
                global_this,
                JSValue::js_number(
                    bun_sys::SignalCode(*signal).to_exit_code().unwrap_or(254) as f64
                ),
            ),
            Status::Err(err) => {
                let js_err = err.to_js(global_this);
                JSPromise::dangerously_create_rejected_promise_value_without_notifying_vm(
                    global_this,
                    js_err,
                )
            }
            _ => {
                let promise = JSPromise::create(global_this).to_js();
                js::exited_promise_set_cached(this_value, global_this, promise);
                promise
            }
        }
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_exit_code(&self, _global: &JSGlobalObject) -> JSValue {
        if let Status::Exited(exited) = &self.process().status {
            return JSValue::js_number(exited.code as f64);
        }
        JSValue::NULL
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_signal_code(&self, global: &JSGlobalObject) -> JSValue {
        if let Some(signal) = self.process().signal_code() {
            // `process.signal_code()` returns the tier-0 `bun_core::SignalCode`
            // (bare `#[repr(u8)]` discriminant); name/exit-code helpers live on
            // `bun_sys::SignalCode`.
            let sys_sig = bun_sys::SignalCode(signal as u8);
            if let Some(name) = sys_sig.name() {
                use bun_jsc::ZigStringJsc as _;
                return bun_jsc::zig_string::ZigString::init(name.as_bytes()).to_js(global);
            } else {
                return JSValue::js_number(signal as u32 as f64);
            }
        }

        JSValue::NULL
    }

    pub fn handle_ipc_message(&self, message: IPC::DecodedIPCMessage, handle: JSValue) {
        bun_output::scoped_log!(IPC, "Subprocess#handleIPCMessage");
        match message {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            IPC::DecodedIPCMessage::Version(v) => {
                bun_output::scoped_log!(IPC, "Child IPC version is {}", v);
            }
            IPC::DecodedIPCMessage::Data(data) => {
                bun_output::scoped_log!(IPC, "Received IPC message from child");
                let this_jsvalue = self.this_value.get().try_get().unwrap_or(JSValue::ZERO);
                let _keep = jsc::EnsureStillAlive(this_jsvalue);
                if !this_jsvalue.is_empty() {
                    if let Some(cb) = js::ipc_callback_get_cached(this_jsvalue) {
                        let global_this = self.global_this();
                        let event_loop = global_this.bun_vm().as_mut().event_loop();
                        unsafe {
                            (*event_loop).run_callback(
                                cb,
                                global_this,
                                this_jsvalue,
                                &[data, this_jsvalue, handle],
                            )
                        };
                    }
                }
            }
            IPC::DecodedIPCMessage::Internal(data) => {
                bun_output::scoped_log!(IPC, "Received IPC internal message from child");
                let global_this = self.global_this;
                let _ = node_cluster_binding::handle_internal_message_primary(
                    global_this.get(),
                    self,
                    data,
                );
            }
        }
    }

    pub fn handle_ipc_close(&self) {
        bun_output::scoped_log!(IPC, "Subprocess#handleIPCClose");
        let this_jsvalue = self.this_value.get().try_get().unwrap_or(JSValue::ZERO);
        let _keep = jsc::EnsureStillAlive(this_jsvalue);
        let global_this = self.global_this;
        let global_this = global_this.get();
        self.update_has_pending_activity();

        if !this_jsvalue.is_empty() {
            // Avoid keeping the callback alive longer than necessary
            js::ipc_callback_set_cached(this_jsvalue, global_this, JSValue::ZERO);

            // Call the onDisconnectCallback if it exists and prevent it from being kept alive longer than necessary
            if let Some(callback) =
                js::on_disconnect_callback_take_cached(this_jsvalue, global_this)
            {
                let event_loop = global_this.bun_vm().as_mut().event_loop();
                unsafe {
                    (*event_loop).run_callback(
                        callback,
                        global_this,
                        this_jsvalue,
                        &[JSValue::TRUE],
                    )
                };
            }
        }
    }

    #[allow(clippy::mut_from_ref)]
    pub fn ipc(&self) -> Option<&mut IPC::SendQueue> {
        // SAFETY: single JS-mutator thread; the SendQueue is inline in the
        // `JsCell` and callers do not hold the borrow across JS re-entry that
        // touches `ipc_data` itself.
        unsafe { self.ipc_data.get_mut() }.as_mut()
    }

    pub fn get_global_this(&self) -> Option<&JSGlobalObject> {
        Some(self.global_this())
    }
}

pub use bun_spawn::subprocess::{Source, SourceData};

// JSC-tier payloads wrap as `Source::Any(Box<dyn SourceData>)` — the lower-tier
// `bun_spawn` crate cannot name `webcore`/`jsc`, so the vtable travels with the
// value (§Dispatch cold path).
impl SourceData for webcore::AnyBlob {
    fn slice(&self) -> &[u8] {
        webcore::AnyBlob::slice(self)
    }
    fn detach(&mut self) {
        webcore::AnyBlob::detach(self)
    }
    fn memory_cost(&self) -> usize {
        webcore::AnyBlob::memory_cost(self)
    }
}
/// Local newtype so the [`SourceData`] impl satisfies coherence —
/// `ArrayBufferStrong` lives in `bun_jsc` and the trait in `bun_spawn`, so
/// implementing it directly would be an orphan.
struct ArrayBufferSource(jsc::array_buffer::ArrayBufferStrong);
impl SourceData for ArrayBufferSource {
    fn slice(&self) -> &[u8] {
        self.0.slice()
    }
    fn detach(&mut self) { /* GC-owned; Drop releases the Strong handle */
    }
    fn memory_cost(&self) -> usize {
        0
    }
}
#[inline]
pub fn source_from_blob(b: webcore::AnyBlob) -> Source {
    Source::Any(Box::new(b))
}
#[inline]
pub fn source_from_array_buffer(ab: jsc::array_buffer::ArrayBufferStrong) -> Source {
    Source::Any(Box::new(ArrayBufferSource(ab)))
}

#[cfg(windows)]
pub extern "C" fn on_pipe_close(this: *mut bun_sys::windows::libuv::Pipe) {
    // safely free the pipes
    // SAFETY: pipe was heap-allocated when created; we are the close callback owner.
    drop(unsafe { bun_core::heap::take(this) });
}

pub mod testing_apis {
    use super::*;

    /// Inject a synthetic read error into a subprocess's stdout/stderr
    /// PipeReader, as if the underlying read() syscall (Posix) or libuv read
    /// callback (Windows) had failed with EBADF. Used by tests to exercise
    /// the onReaderError cleanup path, which is otherwise very hard to
    /// trigger deterministically — on Windows in particular, peer death on
    /// a named pipe maps to UV_EOF rather than an error.
    ///
    /// Returns true if an error was injected, false if the given stdio is
    /// not (or no longer) a buffered pipe reader.
    #[bun_jsc::host_fn]
    pub fn inject_stdio_read_error(
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        let [subprocess_value, kind_value] = callframe.arguments_as_array::<2>();
        let Some(subprocess_ptr) = Subprocess::from_js(subprocess_value) else {
            return Err(global_this.throw(format_args!("first argument must be a Subprocess")));
        };
        // SAFETY: `from_js` returned a live `*mut Subprocess` owned by the JS wrapper.
        // R-2: deref as shared (`&*const`) — fields are interior-mutable.
        let subprocess = unsafe { &*subprocess_ptr };
        let kind_str = kind_value.to_bun_string(global_this)?;
        // defer kind_str.deref() — bun_core::String Drop handles deref.

        let out: &JsCell<Readable> = if kind_str.eql_comptime(b"stdout") {
            &subprocess.stdout
        } else if kind_str.eql_comptime(b"stderr") {
            &subprocess.stderr
        } else {
            return Err(
                global_this.throw(format_args!("second argument must be 'stdout' or 'stderr'"))
            );
        };

        let Readable::Pipe(pipe) = out.get() else {
            return Ok(JSValue::FALSE);
        };

        // Mirror what the real error path does (onStreamRead on Windows,
        // read() on Posix) so the teardown exercised is identical.
        let fake_err = bun_sys::Error::from_code(bun_sys::Errno::EBADF, bun_sys::Tag::read);
        #[cfg(windows)]
        {
            let _ = Readable::pipe_reader_mut(pipe).reader.stop_reading();
        }
        Readable::pipe_reader_mut(pipe).reader.on_error(fake_err);
        Ok(JSValue::TRUE)
    }
}
// `generated_js2native.rs` snake-cases Zig's `TestingAPIs` as `testing_ap_is`
// (the converter splits the trailing `…APIs` cluster into `AP` + `Is`).
pub use testing_apis as testing_ap_is;

// ported from: src/runtime/api/bun/subprocess.zig
