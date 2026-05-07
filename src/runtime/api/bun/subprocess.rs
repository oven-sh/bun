//! The Subprocess object is returned by `Bun.spawn`. This file also holds the
//! code for `Bun.spawnSync`

use core::ffi::{c_int, c_void};
use core::ptr::NonNull;
use std::sync::atomic::AtomicU32;

use bun_ptr::{RefCount, RefCounted, RefPtr};

use bun_aio::{FilePoll, KeepAlive};
use bun_core::Output;
use bun_jsc::{
    self as jsc, ArrayBuffer, CallFrame, JSGlobalObject, JSPromise, JSValue, JsRef, JsResult,
    VirtualMachine,
};
use bun_jsc::{JsClass, SysErrorJsc};
use bun_sys::{self, Fd, FdExt, SignalCode};
use enumset::{EnumSet, EnumSetType};

// Process / spawn machinery lives in this crate (api/bun/process.rs), not in an
// external `bun_spawn` crate. The `bun_spawn` workspace crate only carries the
// platform-thin `Stdio`/`Status` shims used by `bun.spawnSync` callers.
use crate::api::bun_process::{self as spawn_process, Process, Rusage, Status};
#[cfg(not(windows))]
use crate::api::bun_process::ExtraPipe;
#[cfg(windows)]
use crate::api::bun_process::WindowsStdioResult;
use crate::api::bun::Terminal;
use crate::api::js_bun_spawn_bindings;
use crate::jsc::ipc as IPC;
use crate::node::node_cluster_binding;
use crate::timer::{EventLoopTimer, EventLoopTimerState};
use crate::webcore::{self, AbortSignal, Blob, FileSink};

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
#[cfg(windows)]
pub type StdioResult = WindowsStdioResult;
#[cfg(not(windows))]
pub type StdioResult = Option<Fd>;

#[cfg(windows)]
type StdioPipeItem = StdioResult;
#[cfg(not(windows))]
type StdioPipeItem = ExtraPipe;

pub type StaticPipeWriter<'a> = NewStaticPipeWriter<Subprocess<'a>>;

impl<'a> static_pipe_writer::StaticPipeWriterProcess for Subprocess<'a> {
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

#[derive(EnumSetType, strum::IntoStaticStr)]
pub enum StdioKind {
    Stdin,
    Stdout,
    Stderr,
}

impl StdioKind {
    pub fn to_fd(self) -> Fd {
        match self {
            StdioKind::Stdin => Fd::stdin(),
            StdioKind::Stdout => Fd::stdout(),
            StdioKind::Stderr => Fd::stderr(),
        }
    }

    pub fn to_num(self) -> c_int {
        match self {
            StdioKind::Stdin => 0,
            StdioKind::Stdout => 1,
            StdioKind::Stderr => 2,
        }
    }
}

// PORT NOTE: `#[bun_jsc::JsClass]` does not yet handle generic structs (it emits the
// bare ident in extern signatures). The `JsClass` impl + finalize/construct C-ABI
// hooks are hand-expanded below for `Subprocess<'_>`.
pub struct Subprocess<'a> {
    pub ref_count: RefCount<Subprocess<'a>>,
    /// Intrusively-refcounted `Process` (Zig: `*Process`). Allocated via
    /// `Box::into_raw` in `Process::init_posix`/`init_windows`; the +1 ref
    /// from construction is released in [`Subprocess::finalize`] via
    /// `Process::deref()`. Not `Arc` — `Process` carries its own
    /// `ThreadSafeRefCount` and crosses the `ProcessAutoKiller`/waiter-thread
    /// boundary by raw identity, so wrapping in `Arc` would double-count and
    /// (worse) `Arc::from_raw` on a `Box` allocation is UB.
    pub process: *mut Process,
    pub stdin: Writable<'a>,
    pub stdout: Readable,
    pub stderr: Readable,
    pub stdio_pipes: Vec<StdioPipeItem>,
    pub pid_rusage: Option<Rusage>,

    /// Terminal attached to this subprocess (if spawned with terminal option)
    pub terminal: Option<NonNull<Terminal>>,

    // Raw pointer (Zig: `*jsc.JSGlobalObject`) — JSC global outlives every Subprocess.
    pub global_this: *const JSGlobalObject,
    pub observable_getters: EnumSet<ObservableGetter>,
    pub closed: EnumSet<StdioKind>,
    pub this_value: JsRef,

    /// `None` indicates all of the IPC data is uninitialized.
    pub ipc_data: Option<IPC::SendQueue>,
    pub flags: Flags,

    // TODO(port): lifetime — weak observer, nulled in onStdinDestroyed; no ownership
    pub weak_file_sink_stdin_ptr: Option<NonNull<FileSink>>,
    /// +1 C++-intrusive ref held; released in `clear_abort_signal` via
    /// `AbortSignal::unref()`. Not `Arc` — `AbortSignal` is an opaque FFI
    /// handle whose refcount lives on the C++ side.
    pub abort_signal: Option<NonNull<AbortSignal>>,

    pub event_loop_timer_refd: bool,
    pub event_loop_timer: EventLoopTimer,
    pub kill_signal: SignalCode,

    pub stdout_maxbuf: Option<NonNull<MaxBuf::MaxBuf>>,
    pub stderr_maxbuf: Option<NonNull<MaxBuf::MaxBuf>>,
    pub exited_due_to_maxbuf: Option<MaxBuf::Kind>,
}

// PORT NOTE: a `Default` impl for `Subprocess` was scaffolded here in Phase A
// to support `..Default::default()` struct-update syntax in
// `js_bun_spawn_bindings::spawn_maybe_sync`. That call site now fills every
// field explicitly (see PORT NOTE there), so the impl is dead and has been
// removed — `*mut Process` has no sound placeholder anyway.


// Intrusive ref-count: bun.ptr.RefCount(@This(), "ref_count", deinit, .{})
// `RefPtr<Subprocess>` provides ref/deref and frees the Box when ref_count → 0.
impl<'a> RefCounted for Subprocess<'a> {
    type DestructorCtx = ();
    unsafe fn get_ref_count(this: *mut Self) -> *mut RefCount<Self> {
        // SAFETY: caller contract — `this` points to a live Subprocess.
        unsafe { core::ptr::addr_of_mut!((*this).ref_count) }
    }
    unsafe fn destructor(this: *mut Self, _: ()) {
        // SAFETY: refcount hit 0; allocation came from Box::into_raw in spawn_maybe_sync.
        unsafe { drop(Box::from_raw(this)) };
    }
}
pub type SubprocessRc<'a> = RefPtr<Subprocess<'a>>;

// ── manual `#[bun_jsc::JsClass]` expansion (generic struct) ──────────────────
const _: () = {
    unsafe extern "C" {
        #[link_name = "Subprocess__fromJS"]
        fn __from_js(value: JSValue) -> *mut c_void;
        #[link_name = "Subprocess__fromJSDirect"]
        fn __from_js_direct(value: JSValue) -> *mut c_void;
        #[link_name = "Subprocess__create"]
        fn __create(global: *mut JSGlobalObject, ptr: *mut c_void) -> JSValue;
    }

    impl<'a> Subprocess<'a> {
        /// Wrap an already-heap-allocated `Subprocess` (via `Box::into_raw`) in
        /// its JS cell. `Bun.spawn` boxes early so address-dependent
        /// back-pointers (`stdin.pipe.signal`, MaxBuf owner, IPC owner) can be
        /// wired before `subprocess.toJS(globalThis)` runs; this is the raw-ptr
        /// entrypoint that avoids re-boxing.
        ///
        /// # Safety
        /// `ptr` must come from `Box::into_raw(Box::new(Subprocess { .. }))` and
        /// not yet be owned by any JS wrapper; ownership transfers to the C++
        /// side (released via `SubprocessClass__finalize`).
        #[inline]
        pub unsafe fn to_js_from_ptr(ptr: *mut Self, global: &JSGlobalObject) -> JSValue {
            // SAFETY: caller contract.
            unsafe { __create(global.as_mut_ptr(), ptr.cast()) }
        }
    }

    impl<'a> bun_jsc::JsClass for Subprocess<'a> {
        fn to_js(self, global: &JSGlobalObject) -> JSValue {
            let ptr = Box::into_raw(Box::new(self));
            // SAFETY: `global` is live; ownership of `ptr` transfers to the C++ wrapper
            // (freed via `SubprocessClass__finalize`).
            unsafe { __create(global.as_mut_ptr(), ptr.cast()) }
        }
        fn from_js(value: JSValue) -> Option<*mut Self> {
            // SAFETY: pure FFI downcast; null on type mismatch.
            let p = unsafe { __from_js(value) };
            if p.is_null() { None } else { Some(p.cast()) }
        }
        fn from_js_direct(value: JSValue) -> Option<*mut Self> {
            // SAFETY: pure FFI downcast; null on type mismatch.
            let p = unsafe { __from_js_direct(value) };
            if p.is_null() { None } else { Some(p.cast()) }
        }
        // `noConstructor: true` — no `Subprocess__getConstructor` export; trait default applies.
    }

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
        // SAFETY: `process` is set at construction from a freshly-boxed
        // `Process` and released only in `finalize()`; every caller is on the
        // owning JS thread before `finalize()` runs.
        unsafe { &*self.process }
    }

    /// # Safety
    /// Caller must be on the owning JS thread with no other live `&mut Process`.
    #[inline]
    fn process_mut(&mut self) -> &mut Process {
        // SAFETY: see `process()` — Zig `*Process` semantics. `&mut self`
        // guarantees no other `&Process`/`&mut Process` is live through this
        // `Subprocess`; `Process` itself is single-mutator (JS thread).
        unsafe { &mut *self.process }
    }

    /// Borrow the stored JSC global. Zig stores `*jsc.JSGlobalObject` raw; the
    /// global is guaranteed to outlive every Subprocess it created.
    #[inline]
    pub fn global_this(&self) -> &'a JSGlobalObject {
        // SAFETY: `global_this` is set at construction from a live `&JSGlobalObject`
        // and the JSC global outlives this Subprocess (it owns the heap that owns us).
        unsafe { &*self.global_this }
    }

    /// Intrusive `ref()` — Zig's `pub const ref = ref_count.ref`.
    #[inline]
    pub fn ref_(&mut self) {
        // SAFETY: &mut self → live *mut Self.
        unsafe { RefCount::<Self>::ref_(self as *mut Self) }
    }
    /// Intrusive `deref()` — Zig's `pub const deref = ref_count.deref`.
    /// May free `self`; do not use `self` after calling.
    #[inline]
    pub fn deref(&mut self) {
        // SAFETY: &mut self → live *mut Self; destructor handles the Box.
        unsafe { RefCount::<Self>::deref(self as *mut Self) }
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
pub fn assert_stdio_result(result: StdioResult) {
    #[cfg(debug_assertions)]
    {
        #[cfg(unix)]
        {
            if let Some(fd) = result {
                debug_assert!(fd.is_valid());
            }
        }
        #[cfg(not(unix))]
        let _ = result;
    }
    #[cfg(not(debug_assertions))]
    let _ = result;
}

pub extern "C" fn on_abort_signal(subprocess_ctx: *mut c_void, _reason: JSValue) {
    // SAFETY: subprocess_ctx was registered as `this` when the abort listener was attached.
    let this: &mut Subprocess = unsafe { &mut *(subprocess_ctx.cast::<Subprocess>()) };
    this.clear_abort_signal();
    let _ = this.try_kill(this.kill_signal);
}

/// Static vtable wired into `Process.set_exit_handler` so the low-tier
/// `Process` can call back into this JSC-aware owner without a direct upward
/// dependency (per §Dispatch).
pub static PROCESS_EXIT_VTABLE: spawn_process::ProcessExitVTable = spawn_process::ProcessExitVTable {
    on_process_exit: on_process_exit_thunk,
};

unsafe fn on_process_exit_thunk(
    owner: *mut (),
    process: *mut Process,
    status: Status,
    rusage: *const Rusage,
) {
    // SAFETY: owner was registered as `*mut Subprocess` in spawn_maybe_sync;
    // process/rusage are live for the duration of the callback. `process` is
    // forwarded as the raw `*mut Process` (not a `&Process` reborrow) so
    // `on_process_exit` can hand it to `VirtualMachine::on_subprocess_exit`
    // without a const→mut provenance cast.
    let this: &mut Subprocess = unsafe { &mut *(owner as *mut Subprocess) };
    let rusage_ref: &Rusage = unsafe { &*rusage };
    this.on_process_exit(process, status, rusage_ref);
}

impl Subprocess<'_> {
    #[bun_jsc::host_fn(method)]
    pub fn resource_usage(
        this: &mut Self,
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.create_resource_usage_object(global_object)
    }

    pub fn create_resource_usage_object(
        &mut self,
        global_object: &JSGlobalObject,
    ) -> JsResult<JSValue> {
        let rusage_ref = 'brk: {
            if self.pid_rusage.is_some() {
                break 'brk self.pid_rusage.as_ref().unwrap();
            }

            #[cfg(windows)]
            {
                if matches!(self.process().poller, spawn_process::Poller::Uv(_)) {
                    self.pid_rusage =
                        Some(spawn_process::uv_getrusage(self.process().poller.uv()));
                    break 'brk self.pid_rusage.as_ref().unwrap();
                }
            }

            return Ok(JSValue::UNDEFINED);
        };
        ResourceUsage::create(rusage_ref, global_object)
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
        if let Some(ipc) = &self.ipc_data {
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

    pub fn update_has_pending_activity(&mut self) {
        if self.flags.contains(Flags::IS_SYNC) {
            return;
        }

        let has_pending = self.compute_has_pending_activity();
        if cfg!(debug_assertions) {
            bun_output::scoped_log!(Subprocess, "updateHasPendingActivity() -> {}", has_pending);
        }

        // Upgrade or downgrade the reference based on pending activity
        if has_pending {
            self.this_value.upgrade(self.global_this());
        } else {
            self.this_value.downgrade();
        }
    }

    pub fn has_pending_activity_stdio(&self) -> bool {
        if self.stdin.has_pending_activity() {
            return true;
        }

        // PERF(port): was `inline for` over .{stdout, stderr} — unrolled manually.
        if self.stdout.has_pending_activity() {
            return true;
        }
        if self.stderr.has_pending_activity() {
            return true;
        }

        false
    }

    pub fn on_close_io(&mut self, kind: StdioKind) {
        match kind {
            StdioKind::Stdin => match &mut self.stdin {
                Writable::Pipe(pipe) => {
                    let pipe = *pipe;
                    // SAFETY: Writable::Pipe holds a live `*FileSink` for the
                    // subprocess lifetime; we're on the mutator thread.
                    unsafe { (*pipe.as_ptr()).signal.clear() };
                    self.stdin = Writable::Ignore;
                    // SAFETY: `Writable::Pipe` owns one intrusive ref (NonNull,
                    // no Drop impl); release it explicitly now that the variant
                    // has been overwritten. Ordered after the assignment so any
                    // re-entrant `on_stdin_destroyed` from `deinit` observes
                    // `.Ignore`.
                    unsafe { FileSink::deref(pipe.as_ptr()) };
                }
                Writable::Buffer(buffer) => {
                    // SAFETY: RefPtr has no DerefMut; StaticPipeWriter is single-thread
                    // ref-counted and we hold the owning ref via `self.stdin`.
                    unsafe { (*buffer.data.as_ptr()).source.detach() };
                    // PORT NOTE: Zig's `buffer.deref()` is the owner drop from the
                    // assignment below; do not deref explicitly.
                    self.stdin = Writable::Ignore;
                }
                _ => {}
            },
            StdioKind::Stdout | StdioKind::Stderr => {
                let out: &mut Readable = if kind == StdioKind::Stdout {
                    &mut self.stdout
                } else {
                    &mut self.stderr
                };
                if matches!(out, Readable::Pipe(_)) {
                    // Mirror Zig: copy the pipe pointer out, reassign `out.*`, then
                    // mutate/deref the pipe. In Rust, move the Rc<PipeReader> out of
                    // `*out` first so reassigning doesn't drop it while still borrowed.
                    let Readable::Pipe(mut pipe) =
                        core::mem::replace(out, Readable::Ignore)
                    else {
                        unreachable!()
                    };
                    // SAFETY: `pipe` is the sole RefPtr we just moved out of `*out`;
                    // mutator-thread-only access to PipeReader state.
                    let pipe_state = unsafe { &mut (*pipe.data.as_ptr()).state };
                    if let PipeReader::State::Done(done) = pipe_state {
                        let taken = core::mem::take(done);
                        *out = Readable::Buffer(readable::CowString::init_owned(
                            taken.into_boxed_slice(),
                        ));
                        // pipe.state was emptied via take()
                    }
                    // else: *out stays Readable::Ignore (set by mem::replace above).
                    // PORT NOTE: Zig's `pipe.deref()` is `drop(pipe)` (Rc strong release).
                    drop(pipe);
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

    pub fn js_ref(&mut self) {
        self.process_mut().enable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.r#ref();
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.ref_();
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.ref_();
        }

        self.update_has_pending_activity();
    }

    /// This disables the keeping process alive flag on the poll and also in the stdin, stdout, and stderr
    pub fn js_unref(&mut self) {
        self.process_mut().disable_keeping_event_loop_alive();

        if !self.has_called_getter(ObservableGetter::Stdin) {
            self.stdin.unref();
        }

        if !self.has_called_getter(ObservableGetter::Stdout) {
            self.stdout.unref();
        }

        if !self.has_called_getter(ObservableGetter::Stderr) {
            self.stderr.unref();
        }

        self.update_has_pending_activity();
    }

    pub fn constructor(
        global_object: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<*mut Self> {
        Err(global_object.throw(format_args!("Cannot construct Subprocess")))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stderr(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stderr goes through the terminal
        if this.terminal.is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters.insert(ObservableGetter::Stderr);
        let exited = this.has_exited();
        this.stderr.to_js(global_this, exited)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stdin(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stdin goes through the terminal
        if this.terminal.is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters.insert(ObservableGetter::Stdin);
        // PORT NOTE: reshaped for borrowck — Zig passed `&stdin` and `*Subprocess`
        // separately (aliasing). `Writable::to_js` now takes only the raw
        // `*mut Subprocess` and projects `stdin` internally so no two `&mut`
        // overlap here.
        Ok(Writable::to_js(this, global_this))
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_stdout(this: &mut Self, global_this: &JSGlobalObject) -> JsResult<JSValue> {
        // When terminal is used, stdout goes through the terminal
        if this.terminal.is_some() {
            return Ok(JSValue::NULL);
        }
        this.observable_getters.insert(ObservableGetter::Stdout);
        // NOTE: ownership of internal buffers is transferred to the JSValue, which
        // gets cached on JSSubprocess (created via bindgen). This makes it
        // re-accessable to JS code but not via `this.stdout`, which is now `.closed`.
        let exited = this.has_exited();
        this.stdout.to_js(global_this, exited)
    }

    #[bun_jsc::host_fn(getter)]
    pub fn get_terminal(this: &Self, global_this: &JSGlobalObject) -> JSValue {
        if let Some(terminal) = this.terminal {
            return crate::api::bun_terminal_body::to_js(terminal.as_ptr(), global_this);
        }
        JSValue::UNDEFINED
    }

    #[bun_jsc::host_fn(method)]
    pub fn async_dispose(
        this: &mut Self,
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
        this.stdin.unref();
        this.stdout.unref();
        this.stderr.unref();

        match this.try_kill(this.kill_signal) {
            bun_sys::Result::Ok(()) => {}
            bun_sys::Result::Err(err) => {
                // Signal 9 should always be fine, but just in case that somehow fails.
                return Err(global.throw_value(err.to_js(global)));
            }
        }

        Ok(this.get_exited(this_jsvalue, global))
    }

    pub fn set_event_loop_timer_refd(&mut self, refd: bool) {
        if self.event_loop_timer_refd == refd {
            return;
        }
        self.event_loop_timer_refd = refd;
        // SAFETY: `bun_vm()` returns the live VM owning `global_this`; mutator-thread only.
        let uws_loop = unsafe { (*self.global_this().bun_vm()).uws_loop() };
        let delta: i32 = if refd { 1 } else { -1 };
        // SAFETY: single JS thread; `timer_all()` points into the boxed
        // per-thread `RuntimeState`.
        unsafe { (*Self::timer_all()).increment_timer_ref(delta, uws_loop) };
    }

    /// Recover this thread's `timer::All` heap. b2-cycle: `vm.timer` is `()`
    /// on the low-tier `bun_jsc::VirtualMachine`; the real value lives in
    /// `jsc_hooks::RuntimeState.timer` (raw-ptr-per-field re-entry pattern).
    #[inline]
    fn timer_all() -> *mut crate::timer::All {
        let state = crate::jsc_hooks::runtime_state();
        // SAFETY: `runtime_state()` is non-null after `bun_runtime::init()`.
        unsafe { core::ptr::addr_of_mut!((*state).timer) }
    }

    pub fn timeout_callback(&mut self) {
        self.set_event_loop_timer_refd(false);
        if self.event_loop_timer.state == EventLoopTimerState::CANCELLED {
            return;
        }
        if self.has_exited() {
            self.event_loop_timer.state = EventLoopTimerState::CANCELLED;
            return;
        }
        self.event_loop_timer.state = EventLoopTimerState::FIRED;
        let _ = self.try_kill(self.kill_signal);
    }

    pub fn on_max_buffer(&mut self, kind: MaxBuf::Kind) {
        self.exited_due_to_maxbuf = Some(kind);
        let _ = self.try_kill(self.kill_signal);
    }

    #[bun_jsc::host_fn(method)]
    pub fn kill(
        this: &mut Self,
        global_this: &JSGlobalObject,
        callframe: &CallFrame,
    ) -> JsResult<JSValue> {
        // Safe: this method can only be called while the object is alive (reachable from JS)
        // The finalizer only runs when the object becomes unreachable
        this.this_value.update(global_this, callframe.this());

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

    pub fn try_kill(&mut self, sig: SignalCode) -> bun_sys::Result<()> {
        if self.has_exited() {
            return bun_sys::Result::Ok(());
        }
        self.process_mut().kill(sig.0)
    }

    fn has_called_getter(&self, getter: ObservableGetter) -> bool {
        self.observable_getters.contains(getter)
    }

    fn close_process(&mut self) {
        #[cfg(not(target_os = "linux"))]
        {
            return;
        }
        #[cfg(target_os = "linux")]
        {
            self.process_mut().close();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_ref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.js_ref();
        Ok(JSValue::UNDEFINED)
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_unref(
        this: &mut Self,
        _global: &JSGlobalObject,
        _frame: &CallFrame,
    ) -> JsResult<JSValue> {
        this.js_unref();
        Ok(JSValue::UNDEFINED)
    }

    pub fn on_stdin_destroyed(&mut self) {
        let must_deref = self.flags.contains(Flags::DEREF_ON_STDIN_DESTROYED);
        self.flags.remove(Flags::DEREF_ON_STDIN_DESTROYED);

        self.flags.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED);
        self.weak_file_sink_stdin_ptr = None;

        if !self.flags.contains(Flags::FINALIZED) {
            // otherwise update the pending activity flag
            self.update_has_pending_activity();
        }

        // Zig `defer if (must_deref) this.deref()` — there are no early returns
        // above, so running it last is the exact LIFO order. A scopeguard here
        // would alias `&mut self` with the body's borrows.
        if must_deref {
            self.deref();
        }
    }

    #[bun_jsc::host_fn(method)]
    pub fn do_send(
        this: &mut Self,
        global: &JSGlobalObject,
        call_frame: &CallFrame,
    ) -> JsResult<JSValue> {
        bun_output::scoped_log!(IPC, "Subprocess#doSend");

        let context = if this.has_exited() {
            crate::ipc_host::FromEnum::SubprocessExited
        } else {
            crate::ipc_host::FromEnum::Subprocess
        };
        let ipc_data = this.ipc_data.as_mut();
        crate::ipc_host::do_send(ipc_data, global, call_frame, context)
    }

    pub fn disconnect_ipc(&mut self, next_tick: bool) {
        let Some(ipc_data) = self.ipc() else { return };
        ipc_data.close_socket_next_tick(next_tick);
    }

    #[bun_jsc::host_fn(method)]
    pub fn disconnect(
        this: &mut Self,
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
            .as_ref()
            .map(|d| d.is_connected())
            .unwrap_or(false);
        JSValue::from(connected)
    }

    pub fn pid(&self) -> i32 {
        i32::try_from(self.process().pid).unwrap()
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

        for item in this.stdio_pipes.iter() {
            #[cfg(windows)]
            {
                if let StdioResult::Buffer(buffer) = item {
                    let fdno: usize = buffer.fd().cast() as usize;
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
            + self.stdin.memory_cost()
            + self.stdout.memory_cost()
            + self.stderr.memory_cost()
    }

    fn consume_exited_promise(this_jsvalue: JSValue, global_this: &JSGlobalObject) -> Option<JSValue> {
        if let Some(promise) = js::exited_promise_get_cached(this_jsvalue) {
            js::exited_promise_set_cached(this_jsvalue, global_this, JSValue::ZERO);
            return Some(promise);
        }
        None
    }

    fn consume_on_exit_callback(
        this_jsvalue: JSValue,
        global_this: &JSGlobalObject,
    ) -> Option<JSValue> {
        if let Some(callback) = js::on_exit_callback_get_cached(this_jsvalue) {
            js::on_exit_callback_set_cached(this_jsvalue, global_this, JSValue::ZERO);
            return Some(callback);
        }
        None
    }

    fn consume_on_disconnect_callback(
        this_jsvalue: JSValue,
        global_this: &JSGlobalObject,
    ) -> Option<JSValue> {
        if let Some(callback) = js::on_disconnect_callback_get_cached(this_jsvalue) {
            js::on_disconnect_callback_set_cached(this_jsvalue, global_this, JSValue::ZERO);
            return Some(callback);
        }
        None
    }

    pub fn on_process_exit(&mut self, process: *mut Process, status: Status, rusage: &Rusage) {
        bun_output::scoped_log!(Subprocess, "onProcessExit()");
        let this_jsvalue = self.this_value.try_get().unwrap_or(JSValue::ZERO);
        let global_this = self.global_this();
        let jsc_vm = global_this.bun_vm();
        this_jsvalue.ensure_still_alive();
        self.pid_rusage = Some(*rusage);
        let is_sync = self.flags.contains(Flags::IS_SYNC);
        self.clear_abort_signal();

        // defer this.deref();
        // defer this.disconnectIPC(true);
        // TODO(port): errdefer — using scopeguard for the two trailing defers; they capture
        // &mut self which conflicts with the body. Reshaped: explicit calls at every return point.
        // For now we run them at the end and at early-return sites manually.

        if self.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            // SAFETY: single JS thread; `timer_all()` points into the boxed
            // per-thread `RuntimeState`.
            unsafe { (*Self::timer_all()).remove(&mut self.event_loop_timer) };
        }
        self.set_event_loop_timer_refd(false);

        // SAFETY: `jsc_vm` is the live VM owning `global_this`; mutator-thread
        // only. `process` is the raw `*mut Process` threaded from the vtable
        // thunk so the auto-killer's `(*process).deref()` keeps mutable
        // provenance (no `&Process → *mut` round-trip).
        unsafe { (*jsc_vm).on_subprocess_exit(process) };

        #[cfg(windows)]
        if self.flags.contains(Flags::OWNS_TERMINAL) {
            // POSIX gets EOF on the master when the child (last slave_fd holder)
            // exits. ConPTY's conhost stays alive after the child exits, so close
            // the pseudoconsole now to deliver EOF and fire the terminal's exit
            // callback. Leaves the Terminal itself open to match POSIX.
            if let Some(mut terminal) = self.terminal {
                // SAFETY: terminal pointer is valid while subprocess is alive;
                // single mutator thread.
                unsafe { terminal.as_mut() }.close_pseudoconsole();
            }
        }

        let mut stdin: Option<NonNull<FileSink>> =
            if matches!(self.stdin, Writable::Pipe(_))
                && self.flags.contains(Flags::IS_STDIN_A_READABLE_STREAM)
            {
                if let Writable::Pipe(pipe) = &self.stdin {
                    // Writable::Pipe already stores `NonNull<FileSink>`; just copy it.
                    Some(*pipe)
                } else {
                    unreachable!()
                }
            } else {
                self.weak_file_sink_stdin_ptr
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

                    if !self.flags.contains(Flags::IS_STDIN_A_READABLE_STREAM) {
                        existing_stdin_value = existing_value;
                    }
                }
            }
        }

        // We won't be sending any more data.
        if let Writable::Buffer(buffer) = &mut self.stdin {
            // SAFETY: RefPtr has no DerefMut; StaticPipeWriter is single-thread
            // ref-counted and we hold the owning ref via `self.stdin`.
            unsafe { (*buffer.data.as_ptr()).close() };
        }

        if !existing_stdin_value.is_empty() {
            crate::webcore::file_sink::JSSink::set_destroy_callback(existing_stdin_value, 0);
        }

        if self.flags.contains(Flags::IS_SYNC) {
            // This doesn't match Node.js' behavior, but for synchronous
            // subprocesses the streams should not keep the timers going.
            if matches!(self.stdout, Readable::Pipe(_)) {
                self.stdout.close();
            }

            if matches!(self.stderr, Readable::Pipe(_)) {
                self.stderr.close();
            }
        } else {
            // This matches Node.js behavior. Node calls resume() on the streams.
            if let Readable::Pipe(pipe) = &mut self.stdout {
                if !pipe.reader.is_done() {
                    // SAFETY: RefPtr<PipeReader> has no DerefMut; mutator-thread-only.
                    unsafe { (*pipe.data.as_ptr()).reader.read() };
                }
            }

            if let Readable::Pipe(pipe) = &mut self.stderr {
                if !pipe.reader.is_done() {
                    // SAFETY: RefPtr<PipeReader> has no DerefMut; mutator-thread-only.
                    unsafe { (*pipe.data.as_ptr()).reader.read() };
                }
            }
        }

        if let Some(pipe_ptr) = stdin {
            self.weak_file_sink_stdin_ptr = None;
            self.flags.insert(Flags::HAS_STDIN_DESTRUCTOR_CALLED);

            // SAFETY: pipe_ptr came from a live FileSink (either self.stdin.pipe or the cached JS sink).
            let pipe = unsafe { pipe_ptr.as_ref() };

            // `onAttachedProcessExit()` → `writer.close()` → `FileSink.onClose`
            // fires `pipe.signal` synchronously on POSIX. When the signal still
            // targets `&self.stdin` (the user never read `.stdin`, or did and
            // `Writable.toJS` left it wired), that would re-enter
            // `Writable.onClose` → `pipe.deref()` while `onAttachedProcessExit`
            // is still running on `pipe`. Detach the signal first and drive the
            // `onStdinDestroyed()` deref ourselves instead; this also leaves
            // `self.stdin` as `.pipe` so reading `.stdin` after exit still
            // returns the sink.
            if pipe
                .signal
                .ptr
                .map(|p| p.as_ptr() as *const c_void)
                == Some(&self.stdin as *const Writable<'_> as *const c_void)
            {
                // SAFETY: `pipe_ptr` is unique on the mutator thread; Zig mutates
                // through `*FileSink` here.
                unsafe { (*pipe_ptr.as_ptr()).signal.clear() };
            }
            let must_deref = self.flags.contains(Flags::DEREF_ON_STDIN_DESTROYED);
            self.flags.remove(Flags::DEREF_ON_STDIN_DESTROYED);

            // SAFETY: `pipe_ptr` is live (see `pipe` borrow above); Zig mutates
            // through `*FileSink` here on the single mutator thread.
            unsafe { (*pipe_ptr.as_ptr()).on_attached_process_exit(&status) };

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
                if let Some(promise) = Self::consume_exited_promise(this_jsvalue, global_this) {
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

                if let Some(callback) = Self::consume_on_exit_callback(this_jsvalue, global_this) {
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

    fn close_io(&mut self, io: StdioKind) {
        if self.closed.contains(io) {
            return;
        }
        self.closed.insert(io);

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
                    self.stdin.finalize();
                } else {
                    self.stdin.close();
                }
            }
            StdioKind::Stdout => {
                if !called {
                    self.stdout.finalize();
                } else {
                    self.stdout.close();
                }
            }
            StdioKind::Stderr => {
                if !called {
                    self.stderr.finalize();
                } else {
                    self.stderr.close();
                }
            }
        }
    }

    // This must only be run once per Subprocess
    pub fn finalize_streams(&mut self) {
        bun_output::scoped_log!(Subprocess, "finalizeStreams");
        self.close_process();

        self.close_io(StdioKind::Stdin);
        self.close_io(StdioKind::Stdout);
        self.close_io(StdioKind::Stderr);

        for item in self.stdio_pipes.iter() {
            #[cfg(windows)]
            {
                if let StdioResult::Buffer(buffer) = item {
                    buffer.close(on_pipe_close);
                }
            }
            #[cfg(not(windows))]
            {
                match item {
                    ExtraPipe::OwnedFd(fd) => fd.close(),
                    ExtraPipe::UnownedFd(_) | ExtraPipe::Unavailable => {}
                }
            }
        }
        self.stdio_pipes.clear();
        self.stdio_pipes.shrink_to_fit();
    }

    fn clear_abort_signal(&mut self) {
        if let Some(signal) = self.abort_signal.take() {
            // SAFETY: `signal` was stored with a +1 C++ intrusive ref (taken in
            // `spawn_maybe_sync`); it stays live until `unref()` below.
            let signal: &AbortSignal = unsafe { signal.as_ref() };
            signal.pending_activity_unref();
            signal.clean_native_bindings(self as *mut Self as *mut c_void);
            signal.unref();
        }
    }

    pub fn finalize(this: *mut Self) {
        bun_output::scoped_log!(Subprocess, "finalize");
        // SAFETY: called from JSC finalizer on the mutator thread; `this` is the m_ctx payload.
        let this = unsafe { &mut *this };
        // Ensure any code which references the "this" value doesn't attempt to
        // access it after it's been freed We cannot call any methods which
        // access GC'd values during the finalizer
        this.this_value.finalize();

        this.clear_abort_signal();

        debug_assert!(
            !this.compute_has_pending_activity()
                // SAFETY: VirtualMachine::get() returns a non-null thread-local; finalize
                // runs on the JS thread so the VM is live.
                || unsafe { (*VirtualMachine::VirtualMachine::get()).is_shutting_down() }
        );
        this.finalize_streams();

        this.process_mut().detach();
        // Match Zig's `this.process.deref()`: release the intrusive ref now,
        // not when `ref_count` → 0. The raw `*mut Process` is left dangling but
        // no code path reads `this.process` after this (finalize runs once).
        // SAFETY: `process` is the live Box-backed Process; deref() frees it
        // when its own ThreadSafeRefCount reaches zero.
        unsafe { (*this.process).deref() };

        if this.event_loop_timer.state == EventLoopTimerState::ACTIVE {
            // SAFETY: single JS thread; `timer_all()` points into the boxed
            // per-thread `RuntimeState`.
            unsafe { (*Self::timer_all()).remove(&mut this.event_loop_timer) };
        }
        this.set_event_loop_timer_refd(false);

        MaxBuf::MaxBuf::remove_from_subprocess(&mut this.stdout_maxbuf);
        MaxBuf::MaxBuf::remove_from_subprocess(&mut this.stderr_maxbuf);

        if let Some(ipc_data) = this.ipc_data.take() {
            // In normal operation the socket is already `.closed` by the time we
            // get here (that is what allowed `computeHasPendingActivity` to drop
            // to false and let GC collect us). `disconnectIPC` would be a no-op
            // in that state and would leak the SendQueue's buffers; deinit it
            // instead. `SendQueue.deinit` handles the VM-shutdown case where the
            // socket is still open.
            drop(ipc_data);
        }

        this.flags.insert(Flags::FINALIZED);
        this.deref();
    }

    pub fn get_exited(&mut self, this_value: JSValue, global_this: &JSGlobalObject) -> JSValue {
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
                    bun_sys::SignalCode(*signal).to_exit_code().unwrap_or(254) as f64,
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
                return bun_jsc::zig_string::ZigString::init(name.as_bytes()).to_js(global);
            } else {
                return JSValue::js_number(signal as u32 as f64);
            }
        }

        JSValue::NULL
    }

    pub fn handle_ipc_message(&mut self, message: IPC::DecodedIPCMessage, handle: JSValue) {
        bun_output::scoped_log!(IPC, "Subprocess#handleIPCMessage");
        match message {
            // In future versions we can read this in order to detect version mismatches,
            // or disable future optimizations if the subprocess is old.
            IPC::DecodedIPCMessage::Version(v) => {
                bun_output::scoped_log!(IPC, "Child IPC version is {}", v);
            }
            IPC::DecodedIPCMessage::Data(data) => {
                bun_output::scoped_log!(IPC, "Received IPC message from child");
                let this_jsvalue = self.this_value.try_get().unwrap_or(JSValue::ZERO);
                let _keep = jsc::EnsureStillAlive(this_jsvalue);
                if !this_jsvalue.is_empty() {
                    if let Some(cb) = js::ipc_callback_get_cached(this_jsvalue) {
                        let global_this = self.global_this();
                        // SAFETY: bun_vm()/event_loop() return live VM-owned pointers.
                        let event_loop = unsafe { (*global_this.bun_vm()).event_loop() };
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
                let global_this = self.global_this();
                let _ =
                    node_cluster_binding::handle_internal_message_primary(global_this, self, data);
            }
        }
    }

    pub fn handle_ipc_close(&mut self) {
        bun_output::scoped_log!(IPC, "Subprocess#handleIPCClose");
        let this_jsvalue = self.this_value.try_get().unwrap_or(JSValue::ZERO);
        let _keep = jsc::EnsureStillAlive(this_jsvalue);
        let global_this = self.global_this();
        self.update_has_pending_activity();

        if !this_jsvalue.is_empty() {
            // Avoid keeping the callback alive longer than necessary
            js::ipc_callback_set_cached(this_jsvalue, global_this, JSValue::ZERO);

            // Call the onDisconnectCallback if it exists and prevent it from being kept alive longer than necessary
            if let Some(callback) = Self::consume_on_disconnect_callback(this_jsvalue, global_this)
            {
                // SAFETY: bun_vm()/event_loop() return live VM-owned pointers.
                let event_loop = unsafe { (*global_this.bun_vm()).event_loop() };
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

    pub fn ipc(&mut self) -> Option<&mut IPC::SendQueue> {
        self.ipc_data.as_mut()
    }

    pub fn get_global_this(&self) -> Option<&JSGlobalObject> {
        Some(self.global_this())
    }
}

pub enum Source {
    Blob(webcore::AnyBlob),
    ArrayBuffer(jsc::array_buffer::ArrayBufferStrong),
    Detached,
}

impl Source {
    pub fn memory_cost(&self) -> usize {
        // Memory cost of Source and each of the particular fields is covered by size_of::<Subprocess>().
        match self {
            Source::Blob(blob) => blob.memory_cost(),
            // ArrayBuffer is owned by GC.
            Source::ArrayBuffer(_) => 0,
            Source::Detached => 0,
        }
    }

    pub fn slice(&self) -> &[u8] {
        match self {
            Source::Blob(blob) => blob.slice(),
            Source::ArrayBuffer(ab) => ab.slice(),
            _ => panic!("Invalid source"),
        }
    }

    pub fn detach(&mut self) {
        match self {
            Source::Blob(blob) => {
                blob.detach();
            }
            Source::ArrayBuffer(ab) => {
                // ArrayBuffer.Strong.deinit() → drop releases the Strong handle.
                // TODO(port): verify ArrayBuffer::Strong has explicit deinit vs Drop.
                let _ = ab;
            }
            _ => {}
        }
        *self = Source::Detached;
    }
}

#[cfg(windows)]
pub extern "C" fn on_pipe_close(this: *mut bun_sys::windows::libuv::Pipe) {
    // safely free the pipes
    // SAFETY: pipe was Box::into_raw'd when created; we are the close callback owner.
    drop(unsafe { Box::from_raw(this) });
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
        let subprocess = unsafe { &mut *subprocess_ptr };
        let kind_str = kind_value.to_bun_string(global_this)?;
        // defer kind_str.deref() — bun_str::String Drop handles deref.

        let out: &mut Readable = if kind_str.eql_comptime(b"stdout") {
            &mut subprocess.stdout
        } else if kind_str.eql_comptime(b"stderr") {
            &mut subprocess.stderr
        } else {
            return Err(global_this.throw(format_args!("second argument must be 'stdout' or 'stderr'")));
        };

        let Readable::Pipe(pipe) = out else {
            return Ok(JSValue::FALSE);
        };

        // Mirror what the real error path does (onStreamRead on Windows,
        // read() on Posix) so the teardown exercised is identical.
        let fake_err = bun_sys::Error::from_code(bun_sys::Errno::EBADF, bun_sys::Tag::read);
        #[cfg(windows)]
        {
            // SAFETY: RefPtr<PipeReader> has no DerefMut; mutator-thread-only.
            let _ = unsafe { (*pipe.data.as_ptr()).reader.stop_reading() };
        }
        // SAFETY: RefPtr<PipeReader> has no DerefMut; mutator-thread-only.
        unsafe { (*pipe.data.as_ptr()).reader.on_error(fake_err) };
        Ok(JSValue::TRUE)
    }
}
// `generated_js2native.rs` snake-cases Zig's `TestingAPIs` as `testing_ap_is`
// (the converter splits the trailing `…APIs` cluster into `AP` + `Is`).
pub use testing_apis as testing_ap_is;

// ──────────────────────────────────────────────────────────────────────────
// PORT STATUS
//   source:     src/runtime/api/bun/subprocess.zig (1024 lines)
//   confidence: medium
//   todos:      8
//   notes:      Subprocess gained <'a> (terminal/global_this per LIFETIMES.tsv); ref/deref via bun_ptr::RefCount<Self> + RefCounted impl; PROCESS_EXIT_VTABLE wired for §Dispatch; process held as raw *mut Process (intrusive ThreadSafeRefCount, matches Zig *Process) so finalize releases at Zig timing; on_process_exit defers reshaped to manual calls at return points.
// ──────────────────────────────────────────────────────────────────────────
